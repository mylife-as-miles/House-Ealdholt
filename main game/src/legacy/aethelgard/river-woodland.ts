import { Box3, Group, InstancedMesh, Matrix4, Mesh, Quaternion, Sphere, Vector3, type Material, type Object3D } from 'three';
import { readEaldholtSourceTreeDensityMetadata, type EaldholtWoodlandSurface, type EaldholtWoodlandCrown, type EaldholtWoodlandPlacement } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import { mergeEaldholtTerrainSupport } from '../../../../shared/legacy/aethelgard/environment/terrain-support';
import { createEaldholtClusteredWoodlandPlacements } from '../../../../shared/legacy/aethelgard/environment/woodland-composition';

export interface EaldholtRiverWoodland {
  readonly object: Object3D; readonly triangles: number; readonly drawCalls: number; readonly instanceCount: number;
  readonly sourceFamily: string; readonly trianglesPerTree: number;
  readonly placements?: readonly EaldholtWoodlandPlacement[]; readonly canopyRadius?: number;
  readonly sourceBeltInstanceCount: number; readonly sourceTerrainTriangles: number; readonly existingCrownCount: number;
  readonly bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] } | null;
  /** Already qualified complete hidden family. Read before material/LOD owners
   * are installed; consumers borrow these sources and never own their disposal. */
  readonly borrowedPrototype?: { readonly name: string; readonly components: readonly { readonly source: InstancedMesh; readonly frame: Matrix4 }[] };
  dispose(): void;
}
type Component = { source: InstancedMesh; frame: Matrix4; bounds: Box3; triangles: number; draws: number };
type Family = { prototype: boolean; name: string; components: Component[]; bounds: Box3; triangles: number; draws: number };

/** Borrow one COMPLETE existing tree family. Only the new instance buffers and
 * hierarchy are owned here; source actors, geometry, maps and materials remain
 * untouched. Add before composite framing and before clone-owned lighting. */
export function createEaldholtRiverWoodland(privateModel: Object3D, valley: Object3D, options: { profile?: 'desktop' | 'quest' } = {}): EaldholtRiverWoodland {
  const quest = options.profile === 'quest', triangleBudget = quest ? 40000 : 2000000, maximumDraws = quest ? 3 : 4;
  privateModel.updateWorldMatrix(true, true); valley.updateWorldMatrix(true, true);
  const inverseRoot = new Matrix4().copy(privateModel.matrixWorld).invert(), point = new Vector3(), instance = new Matrix4();
  const sourceBounds = new Box3(), componentBounds = new Map<InstancedMesh, Box3>();
  function geometryBounds(mesh: Mesh): Box3 {
    const existing = componentBounds.get(mesh as InstancedMesh); if (existing) return existing;
    const bounds = new Box3(), positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(point.fromBufferAttribute(positions, i));
    componentBounds.set(mesh as InstancedMesh, bounds); return bounds;
  }
  function ownedDressing(object: Object3D) { for (let parent: Object3D | null = object; parent && parent !== privateModel; parent = parent.parent) if (parent === valley || parent.userData.crownfallRiverWoodland || parent.userData.crownfallRiverMargin || parent.userData.crownfallWoodlandUnderstory) return true; return false; }
  function prototypeOwner(object: Object3D) { for (let parent: Object3D | null = object; parent && parent !== privateModel; parent = parent.parent) if (parent.userData.crownfallWoodlandPrototype) return parent; return null; }
  function isFoliage(object: Object3D) { for (let parent: Object3D | null = object; parent && parent !== privateModel; parent = parent.parent) if (/Grass_Clumps|BlackAlder|flower_|SM_vmcob|SM_vgzte/i.test(parent.name) || parent.userData.crownfallFoliageDensity) return true; return false; }
  const sourceTerrain: Mesh[] = [], protectedBounds = new Box3();
  privateModel.traverse(object => {
    if (!(object instanceof Mesh) || ownedDressing(object) || prototypeOwner(object)) return;
    const frame = new Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld);
    if (/^LandscapeComponent_\d+(?:_\d+)?$/.test(object.name)) {
      sourceTerrain.push(object); sourceBounds.union(geometryBounds(object).clone().applyMatrix4(frame)); return;
    }
    if (isFoliage(object)) return;
    const box = geometryBounds(object);
    if (object instanceof InstancedMesh) for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, instance); protectedBounds.union(box.clone().applyMatrix4(frame.clone().multiply(instance))); }
    else protectedBounds.union(box.clone().applyMatrix4(frame));
  });
  if (sourceBounds.isEmpty()) throw Error('Woodland requires the actual source Landscape.');
  // A source-only synthetic fixture can have no buildings. Real private models
  // derive the conservative architecture/prop/pond footprint here, never the
  // whole Landscape envelope that used to exclude the former exterior ridge.
  const protectedVillage = (protectedBounds.isEmpty() ? sourceBounds : protectedBounds.clone().expandByScalar(2));
  const crowns: EaldholtWoodlandCrown[] = [];
  // The three original single-component saplings are real crowns too, but
  // never substitutes for the complete borrowed Forest/Field family.
  privateModel.traverse(object => {
    if (!(object instanceof Mesh) || ownedDressing(object) || prototypeOwner(object) || !/SM_BlackAlder_Sapling_\d+/i.test(object.name)) return;
    const frame = new Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld), box = geometryBounds(object), count = object instanceof InstancedMesh ? object.count : 1;
    for (let actor = 0; actor < count; actor++) { const actorFrame = frame.clone(); if (object instanceof InstancedMesh) { object.getMatrixAt(actor, instance); actorFrame.multiply(instance); } const crown = box.clone().applyMatrix4(actorFrame), centre = crown.getCenter(new Vector3()); crowns.push({ x: centre.x, z: centre.z, radius: Math.hypot((crown.max.x - crown.min.x) / 2, (crown.max.z - crown.min.z) / 2) }); }
  });
  const families: Family[] = [];
  privateModel.traverse(candidate => {
    if (candidate instanceof Mesh || ownedDressing(candidate)) return;
    const sourceTree=readEaldholtSourceTreeDensityMetadata(candidate.userData.crownfallFoliageDensity);
    if (!sourceTree&&!/SM_BlackAlder_(?:Forest|Field)_\d+/i.test(candidate.name)) return;
    // A validated source owner can wrap an importer-renamed nested family.
    // Count its complete HIGH pool once, independently of its visible tier.
    for(let parent=candidate.parent;parent&&parent!==privateModel;parent=parent.parent)if(readEaldholtSourceTreeDensityMetadata(parent.userData.crownfallFoliageDensity))return;
    const prototype = candidate.userData.crownfallWoodlandPrototype;
    if (prototype) { if (prototype.schema !== 1 || prototype.hidden !== true || prototype.components !== 3 || prototype.family !== 'SM_BlackAlder_Forest_05_PP3') throw Error('Unqualified hidden woodland prototype.'); candidate.visible = false; }
    const parts: InstancedMesh[] = [], allParts: Mesh[] = [];
    candidate.traverse(object => { if (object instanceof Mesh && object.geometry.getAttribute('position')) { allParts.push(object); if (object instanceof InstancedMesh && object.count > 0) parts.push(object); } });
    if (prototype && parts.length !== 3) throw Error('Hidden woodland prototype is incomplete.');
    // Existing crown avoidance must include every source tree, even when its
    // material/LOD/root frame is unsuitable as the borrowed new prototype.
    const actorCount = sourceTree?.counts.high ?? (allParts[0] instanceof InstancedMesh ? allParts[0].count : 1);
    if(sourceTree&&(allParts.length!==sourceTree.components||allParts.some(part=>!(part instanceof InstancedMesh)||part.instanceMatrix.count<actorCount)))throw Error('Incomplete authored source-tree HIGH crown pool.');
    if (!prototype && allParts.length && allParts.every(part => sourceTree ? part instanceof InstancedMesh&&part.instanceMatrix.count>=actorCount : (part instanceof InstancedMesh ? part.count : 1) === actorCount)) for (let actor = 0; actor < actorCount; actor++) {
      const crown = new Box3();
      for (const part of allParts) { const frame = new Matrix4().multiplyMatrices(inverseRoot, part.matrixWorld); if (part instanceof InstancedMesh) { part.getMatrixAt(actor, instance); frame.multiply(instance); } crown.union(geometryBounds(part).clone().applyMatrix4(frame)); }
      const centre = crown.getCenter(new Vector3()); crowns.push({ x: centre.x, z: centre.z, radius: Math.hypot((crown.max.x - crown.min.x) / 2, (crown.max.z - crown.min.z) / 2) });
    }
    // Source density owners contribute exclusion crowns, never replace the
    // separately qualified borrowed prototype or its material/geometry binding.
    if(sourceTree)return;
    if (parts.length < 3 || parts.length > 8) return;
    const materials = parts.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
    // Unreal exports the bark and branch materials as MASK too. A zero
    // alphaTest is not a reliable trunk discriminator: use the rooted part.
    if (!materials.some(material => material.alphaTest > 0 || material.transparent)) return;
    const primary = [...parts].filter(mesh => geometryBounds(mesh).min.y <= .1)
      .sort((a, b) => (geometryBounds(b).max.y - geometryBounds(b).min.y) - (geometryBounds(a).max.y - geometryBounds(a).min.y))[0];
    if (!primary || parts.some(mesh => mesh.count !== primary.count)) return;
    primary.getMatrixAt(0, instance);
    const reference = new Matrix4().multiplyMatrices(inverseRoot, primary.matrixWorld).multiply(instance), undoActor = reference.clone().invert();
    const components: Component[] = [], bounds = new Box3(); let triangles = 0, draws = 0;
    for (const mesh of parts) {
      mesh.getMatrixAt(0, instance);
      const frame = new Matrix4().multiplyMatrices(undoActor, inverseRoot).multiply(mesh.matrixWorld).multiply(instance);
      const count = Math.min(mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count, mesh.geometry.drawRange.count);
      const componentTriangles = count / 3, componentDraws = Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.length) : 1;
      if (!Number.isInteger(componentTriangles) || componentTriangles <= 0) return;
      const localBounds = geometryBounds(mesh); bounds.union(localBounds.clone().applyMatrix4(frame));
      components.push({ source: mesh, frame, bounds: localBounds, triangles: componentTriangles, draws: componentDraws });
      triangles += componentTriangles; draws += componentDraws;
    }
    if (bounds.isEmpty()) return;
    if (draws > maximumDraws || triangles > triangleBudget) return;
    families.push({ prototype: !!prototype, name: candidate.name, components, bounds, triangles, draws });
  });
  families.sort((a, b) => Number(b.prototype) - Number(a.prototype) || a.draws - b.draws || a.triangles - b.triangles || a.name.localeCompare(b.name));
  const family = families[0];
  if (!family) throw Error('No complete bounded BlackAlder trunk/branch/canopy family is available.');
  const land = valley.children.find(object => object instanceof Mesh && /outside village valley/.test(object.name)) as Mesh | undefined;
  const water = valley.children.find(object => object instanceof Mesh && /regional river surface/.test(object.name)) as Mesh | undefined;
  if (!land || !water) throw Error('Woodland requires the actual valley land and paired water strip.');
  let attached = false;
  for (let current: Object3D | null = valley; current; current = current.parent) if (current === privateModel) attached = true;
  if (valley.parent && !attached) throw Error('Woodland valley belongs to a different source owner.');
  const inverseSurface = attached ? inverseRoot : new Matrix4();
  function surface(mesh: Mesh, inverse = inverseSurface): EaldholtWoodlandSurface {
    const positions = mesh.geometry.getAttribute('position'), data = new Float64Array(positions.count * 3), frame = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i).applyMatrix4(frame); data[i * 3] = point.x; data[i * 3 + 1] = point.y; data[i * 3 + 2] = point.z; }
    const indices = mesh.geometry.index?.array ?? Uint32Array.from({ length: positions.count }, (_, index) => index);
    return { positions: data, indices };
  }
  const canopyRadius = Math.hypot(Math.max(Math.abs(family.bounds.min.x), Math.abs(family.bounds.max.x)), Math.max(Math.abs(family.bounds.min.z), Math.abs(family.bounds.max.z)));
  const ownedLand = [land];
  valley.traverse(object => {
    if (!(object instanceof Mesh) || object === land || object.userData.crownfallElderbloom?.kind !== 'terrain') return;
    for (let parent = object.parent; parent && parent !== valley; parent = parent.parent)
      if (parent.userData.crownfallOuterContinuation?.schema === 1) { ownedLand.push(object); break; }
  });
  // Merge support buffers only; rendered surfaces and their owners stay separate.
  const finalLand = mergeEaldholtTerrainSupport(ownedLand.map(mesh => surface(mesh)));
  const sourceLand = sourceTerrain.map(mesh => surface(mesh, inverseRoot)), extraWater: EaldholtWoodlandSurface[] = [];
  valley.traverse(object => { if (object instanceof Mesh && object !== water && object.userData.crownfallElderbloom?.kind === 'water') extraWater.push(surface(object)); });
  const composition = createEaldholtClusteredWoodlandPlacements({ land: finalLand, water: surface(water), sourceLand, extraWater,
    village: { minX: protectedVillage.min.x, maxX: protectedVillage.max.x, minZ: protectedVillage.min.z, maxZ: protectedVillage.max.z },
    sourceEnvelope: { minX: sourceBounds.min.x, maxX: sourceBounds.max.x, minZ: sourceBounds.min.z, maxZ: sourceBounds.max.z }, existingCrowns: crowns,
    canopyRadius, maximumTrees: Math.min(quest ? 76 : 200, Math.floor(triangleBudget / family.triangles)), profile: quest ? 'quest' : 'desktop' });
  const placements = composition.placements;
  const sourceBeltInstanceCount = placements.filter(p => p.x >= sourceBounds.min.x && p.x <= sourceBounds.max.x && p.z >= sourceBounds.min.z && p.z <= sourceBounds.max.z).length;
  const sourceTerrainTriangles = sourceLand.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
  const object = new Group(); object.name = 'House Ealdholt Borrowed River Woodland';
  const owned: InstancedMesh[] = [], bounds = new Box3(), scale = new Vector3(), rotation = new Quaternion(), up = new Vector3(0, 1, 0), matrix = new Matrix4(), placementFrame = new Matrix4();
  for (const component of family.components) {
    if (!placements.length) break;
    const material: Material | Material[] = Array.isArray(component.source.material) ? [...component.source.material] : component.source.material;
    const mesh = new InstancedMesh(component.source.geometry, material, placements.length); mesh.name = 'Ealdholt river woodland ' + component.source.name;
    mesh.castShadow = false; mesh.receiveShadow = true; const meshBounds = new Box3();
    placements.forEach((placement, index) => {
      scale.setScalar(placement.scale); rotation.setFromAxisAngle(up, placement.yaw);
      point.set(placement.x, placement.y - family.bounds.min.y * placement.scale, placement.z);
      placementFrame.compose(point, rotation, scale); matrix.multiplyMatrices(placementFrame, component.frame); mesh.setMatrixAt(index, matrix); mesh.getMatrixAt(index, matrix);
      meshBounds.union(component.bounds.clone().applyMatrix4(matrix));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.boundingBox = meshBounds; mesh.boundingSphere = meshBounds.getBoundingSphere(new Sphere());
    object.add(mesh); owned.push(mesh); bounds.union(meshBounds);
  }
  const northShoulderOrdinals = placements.flatMap((p, index) => p.z < sourceBounds.min.z ? [index] : []);
  const eastShoulderOrdinals = placements.flatMap((p, index) => p.x > sourceBounds.max.x && p.z >= sourceBounds.min.z && p.z <= sourceBounds.max.z ? [index] : []);
  const northShoulderInstanceCount = northShoulderOrdinals.length, eastShoulderInstanceCount = eastShoulderOrdinals.length;
  const acceptedRegionCounts = { source: 0, near: 0, farFringe: 0, farDeep: 0, mainland: 0 };
  for (const placement of placements) {
    const key = placement.region === 'far-fringe' ? 'farFringe' : placement.region === 'far-deep' ? 'farDeep' : placement.region;
    if (key) acceptedRegionCounts[key]++;
  }
  object.userData.crownfallRiverWoodland = { sourceFamily: family.name, wholeTree: true, borrowedGeometryAndMaterials: true, sourceActorsUntouched: true, instanceCount: placements.length, sourceBeltInstanceCount, sourceTerrainTriangles, existingCrownCount: crowns.length, northShoulderInstanceCount, eastShoulderInstanceCount, northShoulderOrdinals, eastShoulderOrdinals, supportSurfaceCount: ownedLand.length, supportTriangles: finalLand.indices.length / 3, acceptedRegionCounts, composition: { version: 'cluster-and-fringe-satellites-v2', ...composition.metrics } };
  object.userData.crownfallFoliageDensity = { schema: 1, family: 'exterior-woodland-pp3-v1', components: family.components.length, counts: { low: Math.min(quest ? 38 : 100, placements.length), medium: Math.min(quest ? 56 : 150, placements.length), high: placements.length } };
  const resultBounds = bounds.isEmpty() ? null : { min: bounds.min.toArray() as [number, number, number], max: bounds.max.toArray() as [number, number, number] };
  let disposed = false;
  return { object, triangles: placements.length * family.triangles, drawCalls: placements.length ? family.draws : 0, instanceCount: placements.length,
    sourceFamily: family.name, trianglesPerTree: family.triangles, placements, canopyRadius, sourceBeltInstanceCount, sourceTerrainTriangles, existingCrownCount: crowns.length, bounds: resultBounds,
    borrowedPrototype: family.prototype ? { name: family.name, components: family.components } : undefined,
    dispose() { if (disposed) return; disposed = true; object.removeFromParent(); for (const mesh of owned) mesh.dispose(); object.clear(); owned.length = 0; },
  };
}
