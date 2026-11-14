import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { createEaldholtOuterContinuationBuffers, type EaldholtOuterMesh, type EaldholtOuterLandformDiagnostics } from '../../../../shared/legacy/aethelgard/environment/outer-continuation';
import type { EaldholtContinuityBounds } from '../../../../shared/legacy/aethelgard/environment/coastal-continuity';
export interface EaldholtOuterContinuation {
  readonly object: Object3D; readonly triangles: number; readonly drawCalls: 2; readonly bufferBytes: number;
  readonly bounds: EaldholtContinuityBounds; readonly southWidth: number; readonly westWidth: number;
  readonly landContourRows: 3 | 4; readonly landform: EaldholtOuterLandformDiagnostics; readonly landSegments: number; readonly seaSegments: number; dispose(): void;
}
/** Parentless valley-local continuation. Caller adds object to valley after the
 * bank/continuity passes and before margin/final bounds/material adaptation.
 * Dispose final material owners first, then this handle, then the valley. */
export function createEaldholtOuterContinuation(privateModel: Object3D, valley: Object3D, options: { profile?: 'desktop' | 'quest' } = {}): EaldholtOuterContinuation {
  const profile = options.profile ?? 'desktop';
  if (valley.userData.crownfallRiverValley?.profile !== profile) throw Error('Outer-continuation profile must match the existing valley.');
  privateModel.updateWorldMatrix(true, true); valley.updateWorldMatrix(true, true);
  const land = valley.children.find(o => o instanceof Mesh && /outside village valley/.test(o.name));
  const sea = valley.children.find(o => o instanceof Mesh && /open sea surface/.test(o.name));
  const channel = valley.children.find(o => o instanceof Mesh && /regional river surface/.test(o.name));
  if (!(land instanceof Mesh) || !(sea instanceof Mesh) || !(channel instanceof Mesh) || Array.isArray(land.material) || Array.isArray(sea.material)) throw Error('Outer continuation requires the existing single-material coastal surfaces.');
  if (land.geometry.userData.crownfallCoastalContinuity?.schema !== 1) throw Error('Outer continuation requires the completed bank/continuity graph.');
  for (const mesh of [land, sea, channel]) if (!mesh.matrix.equals(new Matrix4())) throw Error('Outer continuation requires valley-local surfaces.');
  const inverse = new Matrix4().copy(valley.matrixWorld).invert(), frame = new Matrix4(), composed = new Matrix4(), instance = new Matrix4();
  const point = new Vector3(), full = new Box3(), source = new Box3();
  privateModel.traverse(o => {
    if (!(o instanceof Mesh)) return; const position = o.geometry.getAttribute('position'); if (!position) return;
    frame.multiplyMatrices(inverse, o.matrixWorld); const terrain = /^LandscapeComponent_\d+(?:_\d+)?$/.test(o.name);
    const copies = o instanceof InstancedMesh ? o.instanceMatrix.count : 1;
    for (let copy = 0; copy < copies; copy++) {
      if (o instanceof InstancedMesh) { o.getMatrixAt(copy, instance); composed.multiplyMatrices(frame, instance); } else composed.copy(frame);
      for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i).applyMatrix4(composed); full.expandByPoint(point); if (terrain) source.expandByPoint(point); }
    }
  });
  if (full.isEmpty() || source.isEmpty()) throw Error('Outer continuation requires complete source and model bounds.');
  const attribute = (mesh: Mesh, name: string, size: number) => {
    const a = mesh.geometry.getAttribute(name), p = mesh.geometry.getAttribute('position');
    if (!a || a.itemSize !== size || a.count !== p.count || !(a.array instanceof Float32Array)) throw Error(`Incomplete outer-continuation attribute ${name}.`); return a.array;
  };
  const surface = (mesh: Mesh) => ({ positions: attribute(mesh, 'position', 3), normals: attribute(mesh, 'normal', 3), colours: attribute(mesh, 'color', 3), uv: attribute(mesh, 'uv', 2), indices: mesh.geometry.index?.array ?? [] });
  for (const mesh of [land, sea]) for (const name of ['uv1', 'uv2', 'uv3']) if (mesh.geometry.getAttribute(name)?.array !== mesh.geometry.getAttribute('uv').array) throw Error('Outer continuation requires the existing projected UV aliases.');
  const local = (v: number) => Math.round(v * 1e5) / 1e5;
  const data = createEaldholtOuterContinuationBuffers({ profile,
    sourceEnvelope: { minX: local(source.min.x), maxX: local(source.max.x), minZ: local(source.min.z), maxZ: local(source.max.z) },
    fullBounds: { min: full.min.toArray(), max: full.max.toArray() }, land: { ...surface(land), wetness: attribute(land, 'ealdholtShoreWetness', 1) },
    sea: { ...surface(sea), across: attribute(sea, 'ealdholtWaterAcross', 1), halfWidth: attribute(sea, 'ealdholtWaterHalfWidth', 1) },
    channel: { positions: attribute(channel, 'position', 3), indices: channel.geometry.index?.array ?? [] } });
  const geometries: BufferGeometry[] = [];
  const geometry = (mesh: EaldholtOuterMesh) => {
    const g = new BufferGeometry(), uv = new BufferAttribute(mesh.uv, 2); geometries.push(g);
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3)); g.setAttribute('normal', new BufferAttribute(mesh.normals, 3)); g.setAttribute('color', new BufferAttribute(mesh.colours, 3));
    for (const name of ['uv', 'uv1', 'uv2', 'uv3']) g.setAttribute(name, uv); g.setIndex(new BufferAttribute(mesh.indices, 1)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  };
  try {
    const lg = geometry(data.land), sg = geometry(data.sea);
    lg.setAttribute('ealdholtShoreWetness', new BufferAttribute(data.land.wetness, 1)); sg.setAttribute('ealdholtWaterAcross', new BufferAttribute(data.sea.across, 1)); sg.setAttribute('ealdholtWaterHalfWidth', new BufferAttribute(data.sea.halfWidth, 1));
    const mainland = new Mesh(lg, land.material), ocean = new Mesh(sg, sea.material);
    mainland.name = 'Ealdholt southern mainland continuation'; ocean.name = 'Ealdholt western open sea continuation';
    mainland.userData.crownfallElderbloom = { kind: 'terrain' }; ocean.userData.crownfallElderbloom = { kind: 'water' };
    mainland.castShadow = ocean.castShadow = false; mainland.receiveShadow = true; ocean.receiveShadow = false;
    const object = new Group(); object.name = 'House Ealdholt Outer Continuation'; object.add(mainland, ocean);
    object.userData.crownfallOuterContinuation = { schema: 1, profile, sourceGeometryUntouched: true, workingMapFrame: '+X east/-Z north; not georeferenced',
      triangles: data.triangles, drawCalls: 2, bufferBytes: data.bufferBytes, southWidth: data.southWidth, westWidth: data.westWidth,
      landContourRows: data.landContourRows, landform: data.landform, landSegments: data.landSegments, seaSegments: data.seaSegments, extraTextureBytes: 0, fullBoundsRequired: true };
    let disposed = false;
    return { object, triangles: data.triangles, drawCalls: 2, bufferBytes: data.bufferBytes, bounds: data.bounds, southWidth: data.southWidth, westWidth: data.westWidth,
      landContourRows: data.landContourRows, landform: data.landform, landSegments: data.landSegments, seaSegments: data.seaSegments,
      dispose() { if (disposed) return; disposed = true; object.removeFromParent(); object.clear(); for (const g of geometries) g.dispose(); } };
  } catch (error) { for (const g of geometries) g.dispose(); throw error; }
}
