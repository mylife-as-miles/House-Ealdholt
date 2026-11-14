import { Box3, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Sphere, Vector3, type Material, type Object3D } from 'three';
import { createEaldholtUnderstoryPlacements, EALDHOLT_WOODLAND_UNDERSTORY, type EaldholtUnderstoryPlacement } from '../../../../shared/legacy/aethelgard/environment/woodland-understory';
import type { EaldholtWoodlandPlacement, EaldholtWoodlandSurface } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import { mergeEaldholtTerrainSupport } from '../../../../shared/legacy/aethelgard/environment/terrain-support';

type Bounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };
type GrassFamily = { mesh: InstancedMesh; bounds: Box3; triangles: number; name: string; material: Material };
export interface EaldholtWoodlandUnderstory {
  readonly object: Object3D; readonly placements: readonly EaldholtUnderstoryPlacement[];
  readonly instanceCount: number; readonly triangles: number; readonly drawCalls: number; readonly trianglesPerClump: number;
  readonly sourceGrassFamily: string | null; readonly sourceRootCount: number; readonly budgetLimited: boolean; readonly limit: string | null;
  readonly bounds: Bounds | null; readonly supportBounds: Bounds; readonly ownedInstanceBytes: number;
  dispose(): void;
}
export interface EaldholtWoodlandUnderstoryOptions {
  readonly profile?: 'desktop' | 'quest'; readonly woodlandPlacements: readonly EaldholtWoodlandPlacement[]; readonly canopyRadius: number;
}

/** A removable exterior-only layer, borrowing one complete original grass
 * family. It never writes source matrices, bounds, geometry, maps or materials.
 * Add before composite bounds / light-material clones; dispose clones first. */
export function createEaldholtWoodlandUnderstory(privateModel: Object3D, valley: Object3D, options: EaldholtWoodlandUnderstoryOptions): EaldholtWoodlandUnderstory {
  const profile = options.profile ?? 'desktop', settings = EALDHOLT_WOODLAND_UNDERSTORY[profile];
  privateModel.updateWorldMatrix(true, true); valley.updateWorldMatrix(true, true);
  const inverseRoot = new Matrix4().copy(privateModel.matrixWorld).invert(), point = new Vector3(), village = new Box3();
  function geometryBounds(mesh: Mesh): Box3 {
    const box = new Box3(), positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) box.expandByPoint(point.fromBufferAttribute(positions, i));
    return box;
  }
  function generated(object: Object3D): boolean {
    for (let parent: Object3D | null = object; parent && parent !== privateModel; parent = parent.parent)
      if (parent === valley || parent.userData.crownfallRiverWoodland || parent.userData.crownfallRiverMargin || parent.userData.crownfallWoodlandUnderstory) return true;
    return false;
  }
  privateModel.traverse(object => {
    if (!(object instanceof Mesh) || generated(object) || !/^LandscapeComponent_\d+(?:_\d+)?$/.test(object.name)) return;
    const frame = new Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld), positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) village.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(frame));
  });
  if (village.isEmpty()) throw Error('Woodland understory needs the original Landscape envelope.');
  const families: GrassFamily[] = [], seen = new Set<Object3D>();
  privateModel.traverse(candidate => {
    if (!(candidate instanceof InstancedMesh) || candidate.instanceMatrix.count < 1 || generated(candidate) || !/Grass_Clumps/i.test(candidate.name)) return;
    let owner: Object3D = candidate;
    while (owner.parent && owner.parent !== privateModel && /Grass_Clumps/i.test(owner.parent.name)) owner = owner.parent;
    if (seen.has(owner)) return; seen.add(owner);
    const parts: Mesh[] = []; owner.traverse(child => { if (child instanceof Mesh) parts.push(child); });
    if (parts.length !== 1 || parts[0] !== candidate) return;
    const source = candidate.geometry, positions = source.getAttribute('position'), normals = source.getAttribute('normal');
    const material = Array.isArray(candidate.material) ? candidate.material.length === 1 ? candidate.material[0] : null : candidate.material;
    const count = source.index?.count ?? positions?.count ?? 0;
    if (!positions || !normals || normals.count !== positions.count || !material || count <= 0 || count % 3 || source.drawRange.start !== 0
      || (source.drawRange.count !== Infinity && source.drawRange.count !== count) || source.isInstancedBufferGeometry
      || source.morphAttributes.position?.length || candidate.morphTexture) return;
    const bounds = geometryBounds(candidate), height = bounds.max.y - bounds.min.y;
    const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), height + .01, Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
    if (bounds.isEmpty() || height <= 0 || height > .7 || !Number.isFinite(radius) || radius > 2) return;
    families.push({ mesh: candidate, bounds, triangles: count / 3, name: owner.name.replace(/_cell_-?\d+_-?\d+$/, ''), material });
  });
  families.sort((a, b) => a.triangles - b.triangles || a.name.localeCompare(b.name)); const family = families[0];
  const land = valley.children.find(object => object instanceof Mesh && /outside village valley/.test(object.name)) as Mesh | undefined;
  const waters: Mesh[] = [];
  valley.traverse(object => { if (object instanceof Mesh && (/regional river surface/.test(object.name) || object.userData.crownfallElderbloom?.kind === 'water')) waters.push(object); });
  if (!land || !waters.length) throw Error('Woodland understory needs actual exterior land and water triangles.');
  let attached = false;
  for (let current: Object3D | null = valley; current; current = current.parent) if (current === privateModel) attached = true;
  if (valley.parent && !attached) throw Error('Woodland valley belongs to a different source owner.');
  const inverseSurface = attached ? inverseRoot : new Matrix4();
  function surface(mesh: Mesh): EaldholtWoodlandSurface {
    const positions = mesh.geometry.getAttribute('position'), data = new Float64Array(positions.count * 3);
    const frame = new Matrix4().multiplyMatrices(inverseSurface, mesh.matrixWorld);
    for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(frame); data[i * 3] = point.x; data[i * 3 + 1] = point.y; data[i * 3 + 2] = point.z; }
    return { positions: data, indices: mesh.geometry.index?.array ?? Uint32Array.from({ length: positions.count }, (_, i) => i) };
  }
  const ownedLand = [land];
  valley.traverse(object => {
    if (!(object instanceof Mesh) || object === land || object.userData.crownfallElderbloom?.kind !== 'terrain') return;
    for (let parent = object.parent; parent && parent !== valley; parent = parent.parent)
      if (parent.userData.crownfallOuterContinuation?.schema === 1) { ownedLand.push(object); break; }
  });
  // Coordinate-identical seam edges cancel in the exact boundary guard. Neither
  // rendered geometry nor its material ownership is combined or modified.
  const landSurface = mergeEaldholtTerrainSupport(ownedLand.map(surface)), support = new Box3();
  for (let i = 0; i < landSurface.positions.length; i += 3) support.expandByPoint(point.set(landSurface.positions[i], landSurface.positions[i + 1], landSurface.positions[i + 2]));
  const maximumActors = family ? Math.min(settings.maximumActors, Math.floor(settings.maximumTriangles / family.triangles)) : 0;
  // Include the complete rooted height after its source-local Y offset is
  // removed, plus the small embed: slope alignment can project it into XZ.
  const grassRadius = family ? Math.hypot(Math.max(Math.abs(family.bounds.min.x), Math.abs(family.bounds.max.x)), family.bounds.max.y - family.bounds.min.y + .01, Math.max(Math.abs(family.bounds.min.z), Math.abs(family.bounds.max.z))) : 0;
  const placements = family ? createEaldholtUnderstoryPlacements({ land: landSurface, water: waters.map(surface),
    sourceEnvelope: { minX: village.min.x, maxX: village.max.x, minZ: village.min.z, maxZ: village.max.z },
    woodlandPlacements: options.woodlandPlacements, canopyRadius: options.canopyRadius, grassRadius, maximumActors, profile }) : [];
  const object = new Group(); object.name = 'House Ealdholt Woodland Understory';
  const owned: InstancedMesh[] = [], bounds = new Box3(), matrix = new Matrix4(), rotation = new Quaternion(), alignment = new Quaternion();
  const normal = new Vector3(), up = new Vector3(0, 1, 0), scale = new Vector3();
  if (family && placements.length) {
    const mesh = new InstancedMesh(family.mesh.geometry, family.material, placements.length);
    mesh.name = 'Ealdholt exterior understory grass';
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i]; rotation.setFromAxisAngle(up, placement.yaw); normal.set(...placement.normal);
      alignment.setFromUnitVectors(up, normal); rotation.premultiply(alignment);
      point.set(placement.x, placement.y, placement.z).addScaledVector(normal, -family.bounds.min.y * placement.scale - .008);
      scale.setScalar(placement.scale); matrix.compose(point, rotation, scale); mesh.setMatrixAt(i, matrix); mesh.getMatrixAt(i, matrix);
      bounds.union(family.bounds.clone().applyMatrix4(matrix));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.boundingBox = bounds.clone(); mesh.boundingSphere = bounds.getBoundingSphere(new Sphere());
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.crownfallElderbloom = { kind: 'groundcover' };
    object.add(mesh); owned.push(mesh);
    object.userData.crownfallFoliageDensity = { schema: 1, family: 'exterior-understory-source-v1', components: 1,
      counts: { low: Math.floor(placements.length * settings.lowFraction), medium: Math.floor(placements.length * settings.mediumFraction), high: placements.length } };
  }
  const triangles = placements.length * (family?.triangles ?? 0), budgetLimited = maximumActors < settings.maximumActors || placements.length < maximumActors;
  if (triangles > settings.maximumTriangles) throw Error('Whole woodland understory exceeded its triangle budget.');
  const limit = !family ? 'No complete bounded single-primitive source Grass_Clumps family; no replacement geometry.'
    : budgetLimited ? 'Whole source clumps retained; profile budget, dry footprint and exterior tangent support limit count.' : null;
  const sourceRootCount = new Set(placements.map(placement => placement.anchor)).size;
  const packedBounds = (box: Box3): Bounds => ({ min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] });
  object.userData.crownfallWoodlandUnderstory = { schema: 1, sourceGrassFamily: family?.name ?? null, instanceCount: placements.length,
    sourceRootCount, sourceEnvelopeProtected: true, borrowedGeometryAndMaterials: true, sourceActorsUntouched: true,
    exactWaterAndOpenEdgeClearance: true, maximumTangentErrorMetres: .055, triangles, drawCalls: owned.length,
    supportSurfaceCount: ownedLand.length, supportTriangles: landSurface.indices.length / 3 };
  let disposed = false;
  return { object, placements, instanceCount: placements.length, triangles, drawCalls: owned.length, trianglesPerClump: family?.triangles ?? 0,
    sourceGrassFamily: family?.name ?? null, sourceRootCount, budgetLimited, limit, bounds: bounds.isEmpty() ? null : packedBounds(bounds),
    supportBounds: packedBounds(support), ownedInstanceBytes: owned.reduce((bytes, mesh) => bytes + mesh.instanceMatrix.array.byteLength, 0),
    dispose() { if (disposed) return; disposed = true; object.removeFromParent(); for (const mesh of owned) mesh.dispose(); object.clear(); owned.length = 0; },
  };
}
