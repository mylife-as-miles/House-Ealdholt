import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix3, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { createEaldholtFarSurroundBuffers, type EaldholtFarProjectionPacket, type EaldholtFarSurroundInput } from '../../../../shared/legacy/aethelgard/environment/far-surround';
import { clipEaldholtFarSurroundToLocalBounds } from '../../../../shared/legacy/aethelgard/environment/far-surround-bridge';
import type { EaldholtContinuityBounds } from '../../../../shared/legacy/aethelgard/environment/coastal-continuity';

export interface EaldholtFarSurroundOptions {
  readonly profile?: 'desktop' | 'quest';
  /** Complete LOCAL HIGH bounds in the source-model frame, before this owner. */
  readonly localBounds?: EaldholtContinuityBounds;
  readonly coverage?: EaldholtFarSurroundInput['coverage'];
  /** Desktop only, preserving the default/Quest geometry byte-for-byte. */
  readonly layeredMainland?: boolean;
}
export interface EaldholtFarSurround {
  readonly object: Object3D;
  /** Complete LOCAL + FAR solid bounds. These never become placement support. */
  readonly bounds: EaldholtContinuityBounds;
  readonly localBounds: EaldholtContinuityBounds;
  /** Canonical non-solid field; remains usable after unattached meshes dispose. */
  readonly projectionPacket: EaldholtFarProjectionPacket;
  readonly triangles: number;
  readonly drawCalls: 3;
  readonly bufferBytes: number;
  readonly extraTextureBytes: 0;
  dispose(): void;
}
export interface EaldholtFarSurroundBridge {
  readonly object: Object3D;
  /** Actual clipped owned solids only; null when every role clips empty. */
  readonly bounds: EaldholtContinuityBounds | null;
  readonly localBounds: EaldholtContinuityBounds;
  readonly projectionPacket: EaldholtFarProjectionPacket;
  readonly triangles: number;
  readonly drawCalls: 0 | 1 | 2 | 3;
  readonly bufferBytes: number;
  readonly extraTextureBytes: 0;
  dispose(): void;
}
const identity = new Matrix4();
const frameFor = (inverse: Matrix4, object: Object3D) => {
  const frame = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
  // Display-scale cancellation must not perturb exact shared seam tuples.
  if (frame.elements.every((v, i) => Math.abs(v - identity.elements[i]) < 1e-11)) frame.identity();
  return frame;
};
const boundsOf = (box: Box3): EaldholtContinuityBounds => ({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
const boundsBox = (bounds: EaldholtContinuityBounds) => {
  if (![...bounds.min, ...bounds.max].every(Number.isFinite) || bounds.min.some((v, i) => v >= bounds.max[i])) throw Error('Far surround requires complete finite local bounds.');
  return new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
};
function completeLocalBounds(root: Object3D, inverse: Matrix4): Box3 {
  const result = new Box3(), boxes = new Map<BufferGeometry, Box3>(), point = new Vector3(), instance = new Matrix4(), composed = new Matrix4();
  root.traverse(o => {
    if (!(o instanceof Mesh)) return;
    const p = o.geometry.getAttribute('position'); if (!p) return;
    let box = boxes.get(o.geometry);
    if (!box) { box = new Box3(); for (let i = 0; i < p.count; i++) box.expandByPoint(point.fromBufferAttribute(p, i)); boxes.set(o.geometry, box); }
    const frame = frameFor(inverse, o), copies = o instanceof InstancedMesh ? o.instanceMatrix.count : 1;
    for (let copy = 0; copy < copies; copy++) {
      if (o instanceof InstancedMesh) { o.getMatrixAt(copy, instance); composed.multiplyMatrices(frame, instance); } else composed.copy(frame);
      result.union(box.clone().applyMatrix4(composed));
    }
  });
  return result;
}
/** Copy actual completed owned surfaces into the source-model frame, retaining
 * all seam material attributes. No borrowed geometry bounds are computed. */
function mergeSurfaces(meshes: readonly Mesh[], inverse: Matrix4, water: boolean) {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], uv: number[] = [], indices: number[] = [], wetness: number[] = [], across: number[] = [], halfWidth: number[] = [];
  const point = new Vector3(), normal = new Vector3(); let offset = 0;
  for (const mesh of meshes) {
    if (mesh instanceof InstancedMesh || !mesh.geometry.index) throw Error('Far surround requires indexed owned surfaces.');
    const attributes = Object.fromEntries([['position', 3], ['normal', 3], ['color', 3], ['uv', 2], ...(water ? [['ealdholtWaterAcross', 1], ['ealdholtWaterHalfWidth', 1]] : [['ealdholtShoreWetness', 1]])].map(([name, size]) => {
      const a = mesh.geometry.getAttribute(String(name));
      if (!a || a.itemSize !== size || a.count !== mesh.geometry.getAttribute('position')?.count) throw Error(`Incomplete far-surround attribute ${name}.`);
      return [name, a];
    }));
    const frame = frameFor(inverse, mesh), normalFrame = new Matrix3().getNormalMatrix(frame), isIdentity = frame.equals(identity);
    for (let i = 0; i < attributes.position.count; i++) {
      point.fromBufferAttribute(attributes.position, i).applyMatrix4(frame); positions.push(point.x, point.y, point.z);
      normal.fromBufferAttribute(attributes.normal, i); if (!isIdentity) normal.applyMatrix3(normalFrame).normalize(); normals.push(normal.x, normal.y, normal.z);
      colours.push(attributes.color.getX(i), attributes.color.getY(i), attributes.color.getZ(i)); uv.push(attributes.uv.getX(i), attributes.uv.getY(i));
      if (water) { across.push(attributes.ealdholtWaterAcross.getX(i)); halfWidth.push(attributes.ealdholtWaterHalfWidth.getX(i)); }
      else wetness.push(attributes.ealdholtShoreWetness.getX(i));
    }
    const count = attributes.position.count;
    for (const index of mesh.geometry.index.array) { if (!Number.isInteger(index) || index < 0 || index >= count) throw Error('Invalid far-surround source index.'); indices.push(index + offset); }
    offset += count;
  }
  return { positions: new Float64Array(positions), normals: new Float32Array(normals), colours: new Float32Array(colours), uv: new Float32Array(uv), indices: new Uint32Array(indices), wetness: new Float32Array(wetness), across: new Float32Array(across), halfWidth: new Float32Array(halfWidth) };
}

function collectFarSurroundInput(privateModel: Object3D, valley: Object3D, options: EaldholtFarSurroundOptions) {
  const profile = options.profile ?? 'desktop';
  if (valley.userData.crownfallRiverValley?.profile !== profile) throw Error('Far-surround profile must match the completed valley.');
  let attached = false, duplicate = false;
  privateModel.traverse(o => { if (o === valley) attached = true; if (o.userData.crownfallFarSurround) duplicate = true; });
  if (!attached || duplicate) throw Error('Far surround requires one completed local graph attached to the source model.');
  privateModel.updateWorldMatrix(true, true);
  const inverse = privateModel.matrixWorld.clone().invert(), source = new Box3(), point = new Vector3();
  privateModel.traverse(o => {
    if (!(o instanceof Mesh) || !/^LandscapeComponent_\d+(?:_\d+)?$/.test(o.name)) return;
    if (o instanceof InstancedMesh) throw Error('Far surround requires original Landscape mesh supports.');
    const positions = o.geometry.getAttribute('position'), frame = frameFor(inverse, o);
    if (positions) for (let i = 0; i < positions.count; i++) source.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(frame));
  });
  const land = valley.children.find(o => o instanceof Mesh && /outside village valley/.test(o.name));
  const sea = valley.children.find(o => o instanceof Mesh && /open sea surface/.test(o.name));
  const channel = valley.children.find(o => o instanceof Mesh && /regional river surface/.test(o.name));
  const outer = valley.children.find(o => o.userData.crownfallOuterContinuation?.schema === 1);
  if (source.isEmpty() || !(land instanceof Mesh) || !(sea instanceof Mesh) || !(channel instanceof Mesh) || !outer
    || land.geometry.userData.crownfallCoastalContinuity?.schema !== 1) throw Error('Far surround requires the actual completed bank, continuity and outer surfaces.');
  const outerLand: Mesh[] = [], outerSea: Mesh[] = [];
  outer.traverse(o => { if (o instanceof Mesh) { if (o.userData.crownfallElderbloom?.kind === 'terrain') outerLand.push(o); else if (o.userData.crownfallElderbloom?.kind === 'water') outerSea.push(o); } });
  if (!outerLand.length || !outerSea.length || [land, sea, channel, ...outerLand, ...outerSea].some(o => Array.isArray(o.material))
    || outerLand.some(o => o.material !== land.material) || outerSea.some(o => o.material !== sea.material)) throw Error('Far surround borrows one existing material per surface role.');
  const measured = completeLocalBounds(privateModel, inverse), local = options.localBounds ? boundsBox(options.localBounds) : measured;
  if (local.clone().expandByScalar(1e-5).containsBox(measured) === false) throw Error('Far-surround local bounds must contain every actual HIGH solid.');
  const input: EaldholtFarSurroundInput = {
    profile, land: mergeSurfaces([land, ...outerLand], inverse, false),
    sea: mergeSurfaces([sea, ...outerSea], inverse, true), channel: mergeSurfaces([channel], inverse, true),
    sourceEnvelope: { minX: source.min.x, maxX: source.max.x, minZ: source.min.z, maxZ: source.max.z },
    localFocusBounds: boundsOf(local), coverage: options.coverage, layeredMainland: options.layeredMainland,
  };
  return { input, landMaterial: land.material, seaMaterial: sea.material, channelMaterial: channel.material };
}
type FarSurface = ReturnType<typeof createEaldholtFarSurroundBuffers>['land' | 'sea' | 'channel'];
function geometry(surface: FarSurface, water: boolean, geometries: BufferGeometry[]) {
  const g = new BufferGeometry(), uv = new BufferAttribute(surface.uv, 2); geometries.push(g);
  g.setAttribute('position', new BufferAttribute(surface.positions, 3)); g.setAttribute('normal', new BufferAttribute(surface.normals, 3)); g.setAttribute('color', new BufferAttribute(surface.colours, 3));
  for (const name of ['uv', 'uv1', 'uv2', 'uv3']) g.setAttribute(name, uv);
  g.setIndex(new BufferAttribute(surface.indices, 1));
  if ('wetness' in surface && !water) g.setAttribute('ealdholtShoreWetness', new BufferAttribute(surface.wetness, 1));
  else if ('across' in surface) { g.setAttribute('ealdholtWaterAcross', new BufferAttribute(surface.across, 1)); g.setAttribute('ealdholtWaterHalfWidth', new BufferAttribute(surface.halfWidth, 1)); }
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

/** Parentless source-model-local Desktop geometry. Attach under privateModel
 * AFTER local woodland/grass and material adaptation. This owner must never
 * be supplied to the local terrain-support or village-focus collectors. */
export function createEaldholtFarSurround(privateModel: Object3D, valley: Object3D, options: EaldholtFarSurroundOptions = {}): EaldholtFarSurround {
  const { input, landMaterial, seaMaterial, channelMaterial } = collectFarSurroundInput(privateModel, valley, options), profile = input.profile;
  const data = createEaldholtFarSurroundBuffers(input), geometries: BufferGeometry[] = [];
  try {
    const object = new Group(); object.name = 'House Ealdholt Far Surround';
    for (const [surface, material, water, label] of [[data.land, landMaterial, false, 'mainland'], [data.sea, seaMaterial, true, 'western sea'], [data.channel, channelMaterial, true, 'eastern river']] as const) {
      const mesh = new Mesh(geometry(surface, water, geometries), material); mesh.name = `Ealdholt distant ${label}`;
      mesh.castShadow = false; mesh.receiveShadow = !water;
      mesh.userData.crownfallElderbloom = { kind: water ? 'water' : 'terrain' };
      mesh.userData.crownfallFarSurround = { schema: 1, localPlacementEligible: false, ownedSurface: label };
      object.add(mesh);
    }
    const bounds = boundsOf(boundsBox(data.localFocusBounds).union(boundsBox(data.bounds)));
    object.userData.crownfallFarSurround = { schema: 1, profile, localPlacementEligible: false, sourceGeometryUntouched: true,
      triangles: data.triangles, drawCalls: 3, bufferBytes: data.bufferBytes, extraTextureBytes: 0,
      coverage: data.coverage, seams: data.seams, localBounds: data.localFocusBounds, farOwnedBounds: data.bounds, completeSolidBounds: bounds,
      workingMapFrame: '+X east/-Z north; not georeferenced', fullBoundsRequired: true };
    let disposed = false;
    return { object, bounds, localBounds: data.localFocusBounds, projectionPacket: { geography: data.geography, localBounds: data.localFocusBounds }, triangles: data.triangles, drawCalls: 3, bufferBytes: data.bufferBytes, extraTextureBytes: 0,
      dispose() { if (disposed) return; disposed = true; object.removeFromParent(); object.clear(); for (const g of geometries) g.dispose(); } };
  } catch (error) { for (const g of geometries) g.dispose(); throw error; }
}

/** Only canonical far faces inside the pre-bridge complete local XYZ box are
 * installed. No kilometre geometry is allocated; attach before remeasuring
 * actual HIGH solids and keep this owner out of vegetation placement. */
export function createEaldholtFarSurroundBridge(privateModel: Object3D, valley: Object3D, options: EaldholtFarSurroundOptions = {}): EaldholtFarSurroundBridge {
  const { input, landMaterial, seaMaterial, channelMaterial } = collectFarSurroundInput(privateModel, valley, options);
  const canonical = createEaldholtFarSurroundBuffers(input), data = clipEaldholtFarSurroundToLocalBounds(canonical, input.localFocusBounds), geometries: BufferGeometry[] = [];
  try {
    const object = new Group(); object.name = 'House Ealdholt Local Perimeter Bridge';
    for (const [surface, material, water, label] of [[data.land, landMaterial, false, 'mainland'], [data.sea, seaMaterial, true, 'western sea'], [data.channel, channelMaterial, true, 'eastern river']] as const) {
      if (!surface) continue;
      const mesh = new Mesh(geometry(surface, water, geometries), material); mesh.name = `Ealdholt local bridge ${label}`;
      mesh.castShadow = false; mesh.receiveShadow = !water;
      mesh.userData.crownfallElderbloom = { kind: water ? 'water' : 'terrain' };
      mesh.userData.crownfallFarSurround = { schema: 1, localBridge: true, localPlacementEligible: false, ownedSurface: label };
      mesh.userData.crownfallFarSurroundBridge = { schema: 1, localPlacementEligible: false };
      object.add(mesh);
    }
    object.userData.crownfallFarSurroundBridge = { schema: 1, profile: input.profile, localPlacementEligible: false, clippedToLocalXYZ: true,
      sourceGeometryUntouched: true, triangles: data.triangles, drawCalls: data.drawCalls, bufferBytes: data.bufferBytes, extraTextureBytes: 0,
      localBounds: data.localBounds, ownedBounds: data.bounds, fullBoundsRequired: true };
    // Same explicit far-owner marker also prevents a second intake from
    // recruiting this bridge into a newly collected local support envelope.
    object.userData.crownfallFarSurround = { schema: 1, localBridge: true, localPlacementEligible: false };
    let disposed = false;
    return { object, bounds: data.bounds, localBounds: data.localBounds, projectionPacket: { geography: canonical.geography, localBounds: data.localBounds },
      triangles: data.triangles, drawCalls: data.drawCalls, bufferBytes: data.bufferBytes, extraTextureBytes: 0,
      dispose() { if (disposed) return; disposed = true; object.removeFromParent(); object.clear(); for (const g of geometries) g.dispose(); } };
  } catch (error) { for (const g of geometries) g.dispose(); throw error; }
}
