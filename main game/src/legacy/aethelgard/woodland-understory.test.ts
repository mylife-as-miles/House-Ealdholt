import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Texture, Vector3 } from 'three';
import { createEaldholtWoodlandUnderstory } from './woodland-understory';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtFoliageDensity } from './foliage-density';
import type { EaldholtWoodlandPlacement } from '../../../../shared/legacy/aethelgard/environment/river-woodland';

// CPU adapter fixtures; no fabricated preview environment is rendered.
function fixture(triangles = 96) {
  const root = new Group(); root.scale.setScalar(.02); root.position.set(3, 2, -4); root.rotation.y = .4;
  const ground = new PlaneGeometry(20, 20, 4, 4).rotateX(-Math.PI / 2), sourceMaterial = new MeshStandardMaterial();
  const terrain = new Mesh(ground, sourceMaterial); terrain.name = 'LandscapeComponent_0'; terrain.position.y = 2; root.add(terrain);
  const grass = new BufferGeometry(); grass.setAttribute('position', new BufferAttribute(new Float32Array([-.3, 0, -.1, .3, 0, .1, 0, .22, 0]), 3));
  grass.setIndex(Array.from({ length: triangles * 3 }, (_, i) => i % 3)); grass.translate(0, -.18, 0); grass.computeVertexNormals();
  const map = new Texture(), material = new MeshStandardMaterial({ map, alphaTest: .3333 }), source = new InstancedMesh(grass, material, 1);
  source.name = 'S_Grass_Clumps_test_complete_cell_0_0'; source.setMatrixAt(0, new Matrix4().makeTranslation(3, 2, 1)); source.count = 0; root.add(source);
  const valley = createEaldholtRiverValley(root, undefined, { profile: 'quest' });
  const roots: EaldholtWoodlandPlacement[] = [[-22, 0], [22, 0], [0, -22], [-20, 24], [20, 24], [0, 36]].map(([x, z]) => ({ x, z, y: 2, yaw: 0, scale: 1 }));
  return { root, ground, sourceMaterial, grass, map, material, source, valley, roots,
    cleanup() { valley.dispose(); source.dispose(); for (const resource of [ground, sourceMaterial, grass, map, material]) resource.dispose(); } };
}
test('understory borrows a complete original family without editing it, with actual surface transforms and owned disposal', () => {
  const f = fixture(), originalMatrices = Array.from(f.source.instanceMatrix.array), originalBounds = f.grass.boundingBox;
  let borrowedDisposals = 0;
  for (const resource of [f.ground, f.sourceMaterial, f.grass, f.material, f.map]) resource.addEventListener('dispose', () => borrowedDisposals++);
  const options = { profile: 'quest' as const, woodlandPlacements: f.roots, canopyRadius: 3 };
  const layer = createEaldholtWoodlandUnderstory(f.root, f.valley.object, options);
  assert.ok(layer.instanceCount > 20 && layer.instanceCount <= 128); assert.equal(layer.drawCalls, 1); assert.equal(layer.trianglesPerClump, 96);
  assert.equal(layer.triangles, 96 * layer.instanceCount); assert.ok(layer.triangles <= 16000); assert.equal(layer.ownedInstanceBytes, layer.instanceCount * 64);
  assert.ok(layer.sourceRootCount >= 3); assert.ok(layer.bounds); assert.equal(layer.object.parent, null);
  const mesh = layer.object.children[0] as InstancedMesh;
  assert.equal(mesh.geometry, f.grass); assert.equal(mesh.material, f.material); assert.equal(mesh.frustumCulled, true);
  assert.equal(mesh.userData.crownfallElderbloom.cellSize, undefined); assert.equal(layer.object.userData.crownfallWoodlandUnderstory.sourceEnvelopeProtected, true);
  const data = Array.from(mesh.instanceMatrix.array);
  const instance = new Matrix4(), vertex = new Vector3(), positions = f.grass.getAttribute('position');
  layer.placements.forEach((placement, i) => { mesh.getMatrixAt(i, instance);
    for (let j = 0; j < positions.count; j++) { vertex.fromBufferAttribute(positions, j).applyMatrix4(instance);
      assert.ok(Math.hypot(vertex.x - placement.x, vertex.z - placement.z) <= placement.footprint + 1e-5, 'every rooted, slope-aligned source vertex fits its dry footprint'); }
  });
  f.root.add(f.valley.object); const attached = createEaldholtWoodlandUnderstory(f.root, f.valley.object, options);
  assert.equal(attached.instanceCount, layer.instanceCount);
  Array.from((attached.object.children[0] as InstancedMesh).instanceMatrix.array).forEach((value, i) => assert.ok(Math.abs(value - data[i]) < 1e-5));
  assert.deepEqual(Array.from(f.source.instanceMatrix.array), originalMatrices); assert.equal(f.source.count, 0);
  assert.equal(f.grass.boundingBox, originalBounds); assert.equal(f.source.material, f.material);
  let ownedDisposals = 0; mesh.addEventListener('dispose', () => ownedDisposals++);
  f.root.add(layer.object); layer.dispose(); layer.dispose(); attached.dispose();
  assert.equal(ownedDisposals, 1); assert.equal(borrowedDisposals, 0); assert.equal(layer.object.parent, null);
  f.cleanup();
});
test('authored quality prefixes keep complete HIGH matrices and conservative bounds, with no per-frame owner', () => {
  const f = fixture(), layer = createEaldholtWoodlandUnderstory(f.root, f.valley.object, { profile: 'quest', woodlandPlacements: f.roots, canopyRadius: 3 });
  const mesh = layer.object.children[0] as InstancedMesh, matrices = Array.from(mesh.instanceMatrix.array), highBox = mesh.boundingBox!.clone();
  const density = createEaldholtFoliageDensity(layer.object, 'low');
  assert.equal(mesh.count, Math.floor(layer.instanceCount * .25)); assert.equal(density.diagnostics.familyCount, 1);
  density.setQuality('medium'); assert.equal(mesh.count, Math.floor(layer.instanceCount * .625));
  density.setQuality('high'); assert.equal(mesh.count, layer.instanceCount);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), matrices); assert.deepEqual(mesh.boundingBox, highBox);
  density.dispose(); layer.dispose(); f.cleanup();
});
test('whole high-triangle clumps reduce actor capacity to honor each profile triangle budget', () => {
  const f = fixture(190);
  for (const [profile, actors, budget] of [['quest', 128, 16000], ['desktop', 512, 64000]] as const) {
    const layer = createEaldholtWoodlandUnderstory(f.root, f.valley.object, { profile, woodlandPlacements: f.roots, canopyRadius: 3 });
    assert.ok(layer.instanceCount > 0 && layer.instanceCount <= Math.min(actors, Math.floor(budget / 190)));
    assert.equal(layer.triangles, layer.instanceCount * 190); assert.ok(layer.triangles <= budget);
    assert.equal(layer.budgetLimited, true); assert.equal((layer.object.children[0] as InstancedMesh).geometry, f.grass);
    layer.dispose();
  }
  f.cleanup();
});
test('multipart or partial source grass stays whole and yields an explicit empty layer', () => {
  const f = fixture(), family = new Group(); family.name = 'S_Grass_Clumps_multipart'; f.root.add(family); family.add(f.source);
  const second = new InstancedMesh(f.grass, f.material, 1); second.name = 'S_Grass_Clumps_second'; family.add(second);
  const options = { profile: 'quest' as const, woodlandPlacements: f.roots, canopyRadius: 3 };
  const whole = createEaldholtWoodlandUnderstory(f.root, f.valley.object, options);
  assert.equal(whole.instanceCount, 0); assert.equal(whole.drawCalls, 0); assert.equal(whole.sourceGrassFamily, null);
  assert.equal(whole.object.userData.crownfallFoliageDensity, undefined); assert.match(whole.limit!, /No complete/); whole.dispose();
  f.root.add(f.source); family.remove(second); f.grass.setDrawRange(0, 3);
  const partial = createEaldholtWoodlandUnderstory(f.root, f.valley.object, options); assert.equal(partial.instanceCount, 0); partial.dispose();
  second.dispose(); f.cleanup();
});
test('every actual water-marked surface participates, and a valley attached to another owner is refused', () => {
  const f = fixture(), seaGeometry = new PlaneGeometry(200, 200).rotateX(-Math.PI / 2), sea = new Mesh(seaGeometry, f.material);
  sea.name = 'actual water-marked surface'; sea.userData.crownfallElderbloom = { kind: 'water' }; f.valley.object.add(sea);
  const options = { profile: 'quest' as const, woodlandPlacements: f.roots, canopyRadius: 3 };
  const wet = createEaldholtWoodlandUnderstory(f.root, f.valley.object, options);
  assert.equal(wet.instanceCount, 0); assert.equal(wet.bounds, null); assert.equal(wet.drawCalls, 0); wet.dispose();
  const unrelated = new Group(); unrelated.add(f.valley.object);
  assert.throws(() => createEaldholtWoodlandUnderstory(f.root, f.valley.object, options), /different source owner/);
  f.valley.object.removeFromParent(); sea.removeFromParent(); seaGeometry.dispose(); f.cleanup();
});
test('merged numeric support treats the apron seam as interior while retaining the actual cut and source exclusion', () => {
  const f = fixture(), valley = new Group(), outer = new Group();
  outer.userData.crownfallOuterContinuation = { schema: 1 };
  const geometries: BufferGeometry[] = [];
  const rectangle = (minZ: number, maxZ: number) => {
    const geometry = new BufferGeometry(); geometries.push(geometry);
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-40, 2, minZ, -40, 2, maxZ, 40, 2, maxZ, 40, 2, minZ]), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals(); return geometry;
  };
  const main = new Mesh(rectangle(-30, 30), f.material); main.name = 'Ealdholt outside village valley'; valley.add(main);
  const apron = new Mesh(rectangle(30, 50), f.material); apron.userData.crownfallElderbloom = { kind: 'terrain' }; outer.add(apron); valley.add(outer);
  const unqualified = new Mesh(rectangle(50, 90), f.material); unqualified.userData.crownfallElderbloom = { kind: 'terrain' }; valley.add(unqualified);
  const waterGeometry = new BufferGeometry(); geometries.push(waterGeometry);
  waterGeometry.setAttribute('position', new BufferAttribute(new Float32Array([-100, 0, -100, -99, 0, -100, -100, 0, -99]), 3)); waterGeometry.setIndex([0, 1, 2]);
  const water = new Mesh(waterGeometry, f.material); water.name = 'Ealdholt regional river surface'; valley.add(water); f.root.add(valley);
  const roots = [[-18, 30], [0, 30], [18, 30], [0, 49.8], [0, 80]].map(([x, z]) => ({ x, z, y: 2, yaw: 0, scale: 1 }));
  const originalMain = Array.from(main.geometry.getAttribute('position').array), originalApron = Array.from(apron.geometry.getAttribute('position').array);
  const layer = createEaldholtWoodlandUnderstory(f.root, valley, { profile: 'quest', woodlandPlacements: roots, canopyRadius: 3 });
  assert.equal(layer.object.userData.crownfallWoodlandUnderstory.supportSurfaceCount, 2);
  assert.ok(Math.abs(layer.supportBounds.max[2] - 50) < 1e-8, 'an unqualified terrain marker or sea/model AABB cannot prove land');
  assert.ok(layer.placements.some(p => p.z > 30));
  assert.ok(layer.placements.some(p => Math.abs(p.z - 30) < p.footprint), 'whole clumps may straddle the welded, supported join');
  for (const p of layer.placements) {
    assert.ok(p.z + p.footprint < 48 && p.z - p.footprint > -28);
    assert.ok(p.x + p.footprint < 38 && p.x - p.footprint > -38);
    assert.ok(p.x + p.footprint < -10.25 || p.x - p.footprint > 10.25 || p.z + p.footprint < -10.25 || p.z - p.footprint > 10.25);
    assert.equal(p.y, 2); assert.notEqual(p.anchor, 4, 'unqualified extension never supports remote roots');
  }
  assert.deepEqual(Array.from(main.geometry.getAttribute('position').array), originalMain); assert.deepEqual(Array.from(apron.geometry.getAttribute('position').array), originalApron);
  let borrowed = 0; [f.grass, f.material, ...geometries].forEach(resource => resource.addEventListener('dispose', () => borrowed++));
  layer.dispose(); layer.dispose(); assert.equal(borrowed, 0); valley.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); f.cleanup();
});
