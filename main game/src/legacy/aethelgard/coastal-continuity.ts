import { Box3, BufferGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { createEaldholtCoastalContinuityPatch, type EaldholtContinuityBounds } from '../../../../shared/legacy/aethelgard/environment/coastal-continuity';
import type { EaldholtBankLandform } from './bank-landform';
export interface EaldholtCoastalContinuity {
  readonly verticesChanged: number; readonly eligibleVertices: number; readonly maximumRaise: number;
  readonly outerBoundaryVerticesChanged: number; readonly cpuPatchBytes: number;
  readonly trianglesAdded: 0; readonly drawCallsAdded: 0; readonly textureBytesAdded: 0;
  readonly fullBounds: EaldholtContinuityBounds; readonly landBounds: EaldholtContinuityBounds;
  dispose(): void;
}
const owners = new WeakSet<BufferGeometry>();
/** Apply after baseline woodland and the bank owner, before final margin/bounds
 * and material adaptation. It borrows that owner's geometry without cloning it;
 * dispose this pass before the bank. No global scene, camera or GPU resources. */
export function createEaldholtCoastalContinuity(modelRoot: Object3D, valley: Object3D, bank: Pick<EaldholtBankLandform, 'protectedFootprints' | 'riparianCorridor'>,
  options: { profile?: 'desktop' | 'quest' } = {}): EaldholtCoastalContinuity {
  const profile = options.profile ?? 'desktop';
  if (valley.userData.crownfallRiverValley?.profile !== profile || !bank.protectedFootprints.length) throw Error('Continuity needs matching valley and complete bank support guards.');
  modelRoot.updateWorldMatrix(true, true); valley.updateWorldMatrix(true, true);
  const land = valley.children.find(o => o instanceof Mesh && /outside village valley/.test(o.name));
  const channel = valley.children.find(o => o instanceof Mesh && /regional river surface/.test(o.name));
  const sea = valley.children.find(o => o instanceof Mesh && /open sea surface/.test(o.name));
  if (!(land instanceof Mesh) || !(channel instanceof Mesh) || !(sea instanceof Mesh)) throw Error('Continuity requires all three coastal surfaces.');
  for (const mesh of [land, channel, sea]) if (!mesh.matrix.equals(new Matrix4())) throw Error('Continuity requires valley-local surface buffers.');
  const geometry = land.geometry, marker = geometry.userData.crownfallBankLandform;
  if (marker?.schema !== 1 || marker.profile !== profile || marker.sourceGeometryUntouched !== true) throw Error('Continuity can patch only the existing bank-owned geometry.');
  if (owners.has(geometry)) throw Error('Continuity geometry already has a live owner.');
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!position || !normal || position.isInterleavedBufferAttribute || normal.isInterleavedBufferAttribute
    || !(position.array instanceof Float32Array) || !(normal.array instanceof Float32Array)) throw Error('Continuity requires owned Float32 bank attributes.');
  const positionArray = position.array, normalArray = normal.array;
  const inverseValley = new Matrix4().copy(valley.matrixWorld).invert(), frame = new Matrix4(), instance = new Matrix4(), composed = new Matrix4();
  const point = new Vector3(), source = new Box3(), full = new Box3();
  // Enumerate complete HIGH instance pools, including components culled by a
  // later quality setting. Root/display transforms cancel in this local frame.
  modelRoot.traverse(o => {
    if (!(o instanceof Mesh)) return; const attribute = o.geometry.getAttribute('position'); if (!attribute) return;
    frame.multiplyMatrices(inverseValley, o.matrixWorld);
    const sourceTerrain = /^LandscapeComponent_\d+(?:_\d+)?$/.test(o.name);
    const copies = o instanceof InstancedMesh ? o.instanceMatrix.count : 1;
    for (let copy = 0; copy < copies; copy++) {
      if (o instanceof InstancedMesh) { o.getMatrixAt(copy, instance); composed.multiplyMatrices(frame, instance); } else composed.copy(frame);
      for (let i = 0; i < attribute.count; i++) {
        point.fromBufferAttribute(attribute, i).applyMatrix4(composed); full.expandByPoint(point); if (sourceTerrain) source.expandByPoint(point);
      }
    }
  });
  if (source.isEmpty() || full.isEmpty()) throw Error('Continuity requires complete source and full model bounds.');
  const local = (v: number) => Math.round(v * 1e5) / 1e5;
  const fullBounds: EaldholtContinuityBounds = { min: full.min.toArray(), max: full.max.toArray() };
  const attribute = (name: string, size: number) => {
    const a = geometry.getAttribute(name); if (!a || a.itemSize !== size || a.count !== position.count) throw Error(`Incomplete continuity attribute ${name}.`); return a.array;
  };
  const surface = (mesh: Mesh) => ({ positions: mesh.geometry.getAttribute('position').array, indices: mesh.geometry.index?.array ?? [] });
  const patch = createEaldholtCoastalContinuityPatch({ profile, fullBounds,
    sourceEnvelope: { minX: local(source.min.x), maxX: local(source.max.x), minZ: local(source.min.z), maxZ: local(source.max.z) },
    protectedFootprints: bank.protectedFootprints, riparianCorridor: bank.riparianCorridor,
    land: { positions: position.array, normals: normal.array, colours: attribute('color', 3), uv: attribute('uv', 2), wetness: attribute('ealdholtShoreWetness', 1), indices: geometry.index?.array ?? [] },
    water: [surface(channel), surface(sea)] });
  const beforeMetadata = geometry.userData.crownfallCoastalContinuity;
  const metadata = { schema: 1, profile, workingMapFrame: '+X east/-Z north; design orientation, not georeferenced',
    sourceGeometryUntouched: true, riparianCorridor: bank.riparianCorridor ?? null, southernBankUntouched: true, fullEnvelopeUnchanged: true,
    verticesChanged: patch.vertices.length, eligibleVertices: patch.eligibleVertices, maximumRaise: patch.maximumRaise,
    outerBoundaryVerticesChanged: patch.outerBoundaryVerticesChanged, cpuPatchBytes: patch.cpuPatchBytes,
    trianglesAdded: 0, drawCallsAdded: 0, textureBytesAdded: 0 };
  for (let at = 0; at < patch.vertices.length; at++) {
    const id = patch.vertices[at]; position.setY(id, patch.afterY[at]); normal.setXYZ(id, patch.afterNormals[at * 3], patch.afterNormals[at * 3 + 1], patch.afterNormals[at * 3 + 2]);
  }
  if (patch.vertices.length) { position.needsUpdate = normal.needsUpdate = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  geometry.userData.crownfallCoastalContinuity = metadata; owners.add(geometry);
  let disposed = false, geometryDisposed = false;
  const onDispose = () => { geometryDisposed = true; }; geometry.addEventListener('dispose', onDispose);
  return { verticesChanged: patch.vertices.length, eligibleVertices: patch.eligibleVertices, maximumRaise: patch.maximumRaise,
    outerBoundaryVerticesChanged: patch.outerBoundaryVerticesChanged, cpuPatchBytes: patch.cpuPatchBytes,
    trianglesAdded: 0, drawCallsAdded: 0, textureBytesAdded: 0, fullBounds, landBounds: patch.bounds,
    dispose() {
      if (disposed) return; disposed = true; owners.delete(geometry); geometry.removeEventListener('dispose', onDispose);
      let restored = false;
      if (!geometryDisposed && land.geometry === geometry && geometry.getAttribute('position') === position && geometry.getAttribute('normal') === normal
        && position.array === positionArray && normal.array === normalArray) {
        for (let at = 0; at < patch.vertices.length; at++) {
          const id = patch.vertices[at];
          // Compare the whole position/normal tuple. A later owner changing any
          // component keeps its tuple; never restore half of a foreign edit.
          if (position.getX(id) !== patch.xz[at * 2] || position.getY(id) !== patch.afterY[at] || position.getZ(id) !== patch.xz[at * 2 + 1]
            || normal.getX(id) !== patch.afterNormals[at * 3] || normal.getY(id) !== patch.afterNormals[at * 3 + 1] || normal.getZ(id) !== patch.afterNormals[at * 3 + 2]) continue;
          position.setY(id, patch.beforeY[at]); normal.setXYZ(id, patch.beforeNormals[at * 3], patch.beforeNormals[at * 3 + 1], patch.beforeNormals[at * 3 + 2]); restored = true;
        }
        if (restored) { position.needsUpdate = normal.needsUpdate = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
      }
      if (geometry.userData.crownfallCoastalContinuity === metadata) {
        if (beforeMetadata === undefined) delete geometry.userData.crownfallCoastalContinuity; else geometry.userData.crownfallCoastalContinuity = beforeMetadata;
      }
    } };
}
