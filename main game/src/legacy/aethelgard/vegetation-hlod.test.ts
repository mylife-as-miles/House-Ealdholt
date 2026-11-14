import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer} from 'three';
import {applyEaldholtNeutralFill} from './neutral-fill';
import {createEaldholtWoodlandVisibility} from './woodland-visibility';
import {createEaldholtTreeHlod} from './vegetation-hlod';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';

test('failed derived preparation retains real source actors and releases only owned rendering resources', async () => {
  const root = new Group(), materials = ['Bark', 'TwoSided', 'Decoration'].map(name => new MeshStandardMaterial({name}));
  const geometries = materials.map(() => new BoxGeometry(2, 8, 2));
  const parts = geometries.map((geometry, part) => {
    const mesh = new InstancedMesh(geometry, materials[part], 2); mesh.position.y = .01 * part;
    for (let id = 0; id < 2; id++) mesh.setMatrixAt(id, new Matrix4().makeTranslation(id * 10, 0, -30));
    root.add(mesh); return mesh;
  });
  // Counterpart transforms include each component's authored root frame.
  root.userData.crownfallRiverWoodland = {wholeTree: true}; root.userData.crownfallFoliageDensity = {counts: {low: 1, medium: 2, high: 2}};
  const neutral = applyEaldholtNeutralFill(root);
  const adapted = parts.map(mesh => mesh.material);
  const visibility = createEaldholtWoodlandVisibility(root), queue = createWorldPreparationQueue(() => {}), signal = new AbortController();
  const worker: VegetationPreparationWorker = {simplify: async () => {throw Error('Capture device unavailable');}, packed: async () => {throw Error('unused');}, foliageNormals: async () => {throw Error('unused');}, ground: async () => {throw Error('unused');}, mips: async () => {throw Error('unreachable');}, dispose() {}};
  const camera = new PerspectiveCamera(60, 1, .1, 1000); camera.updateMatrixWorld();
  let borrowedDisposals = 0;
  [...geometries, ...materials].forEach(resource => resource.addEventListener('dispose', () => borrowedDisposals++));
  const hlod = createEaldholtTreeHlod(root, visibility, {renderer: {} as WebGLRenderer, scene: new Scene(), camera, queue, worker, signal: signal.signal, changed() {}});
  await hlod.preparation; assert.equal(hlod.stats.status, 'error'); assert.match(hlod.stats.error, /device unavailable/);
  visibility.update([camera], 'high'); hlod.update(0, camera, 'high'); assert.equal(hlod.stats.readyMask, 1);
  assert.equal(hlod.stats.levels[0], 2); assert.ok(parts.every(mesh => mesh.count === 2));
  hlod.restore();
  assert.equal(parts[0].geometry, geometries[0], 'source shadow/reflection geometry never gains colour-fade attributes');
  assert.equal(parts[0].geometry.hasAttribute('crownfallLodRange'), false);
  const restoredDraws = root.getObjectByName('Source-derived tree HLOD')!.children as InstancedMesh[];
  assert.ok(restoredDraws.every(draw => draw.count === 0));
  assert.equal(restoredDraws[0].geometry.getAttribute('crownfallLodRange').getY(0), 1);
  hlod.dispose(); hlod.dispose(); assert.equal(borrowedDisposals, 0);
  parts.forEach((mesh, i) => {assert.equal(mesh.geometry, geometries[i]); assert.equal(mesh.material, adapted[i]); assert.equal(mesh.geometry.hasAttribute('crownfallLodRange'), false);});
  neutral.dispose(); parts.forEach((mesh, i) => assert.equal(mesh.material, materials[i], 'reverse ownership restores the original PBR binding'));
  visibility.dispose(); queue.dispose(); parts.forEach(p => p.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
});

test('an unprepared replacement stays outside the live render traversal', async () => {
  const root = new Group(), material = new MeshStandardMaterial({name: 'Bark'}), leaf = new MeshStandardMaterial({name: 'TwoSided'}), geometry = new BoxGeometry(2, 8, 2);
  const sources = [material, leaf, material].map(m => {const mesh = new InstancedMesh(geometry, m, 1); mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, -30)); root.add(mesh); return mesh;});
  root.userData.crownfallRiverWoodland = {wholeTree: true}; root.userData.crownfallFoliageDensity = {counts: {low: 1, medium: 1, high: 1}};
  const visibility = createEaldholtWoodlandVisibility(root), queue = createWorldPreparationQueue(() => {}), controller = new AbortController();
  const worker: VegetationPreparationWorker = {simplify: async input => ({indices: input.indices, error: 0}), packed: async () => {throw Error('unused');}, foliageNormals: async () => {throw Error('unused');}, ground: async () => {throw Error('unused');}, mips: async () => {throw Error('unreachable');}, dispose() {}};
  const hlod = createEaldholtTreeHlod(root, visibility, {renderer: {} as WebGLRenderer, scene: new Scene(), camera: new PerspectiveCamera(),
    queue, worker, signal: controller.signal, changed() {}});
  for (let i = 0; i < 16 && !queue.pending; i++) await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(queue.pending, true);
  const draws = root.getObjectByName('Source-derived tree HLOD')!.children as InstancedMesh[];
  assert.equal(draws.length, 3, 'only the immediately usable original-detail colour draws are attached; unprepared replacement levels remain detached');
  assert.ok(draws.every(draw => draw.count === 0));
  assert.equal(hlod.stats.readyMask, 1); assert.ok(sources.every(mesh => mesh.parent === root));
  controller.abort(); queue.dispose(); await hlod.preparation; hlod.dispose(); visibility.dispose();
  sources.forEach(mesh => mesh.dispose()); geometry.dispose(); material.dispose(); leaf.dispose();
});

test('submitted shader work retains owned programs while source bindings restore immediately', async () => {
  const root = new Group(), geometry = new BoxGeometry(2, 8, 2), bark = new MeshStandardMaterial({name: 'Bark'}), canopy = new MeshStandardMaterial({name: 'TwoSided'});
  const sources = [bark, canopy, bark].map(m => {const mesh = new InstancedMesh(geometry, m, 1); mesh.setMatrixAt(0, new Matrix4()); root.add(mesh); return mesh;});
  root.userData.crownfallRiverWoodland = {wholeTree: true}; root.userData.crownfallFoliageDensity = {counts: {low: 1, medium: 1, high: 1}};
  const visibility = createEaldholtWoodlandVisibility(root), queue = createWorldPreparationQueue(() => {}), controller = new AbortController();
  const worker: VegetationPreparationWorker = {simplify: async input => ({indices: input.indices, error: 0}), packed: async () => {throw Error('unused');}, foliageNormals: async () => {throw Error('unused');}, ground: async () => {throw Error('unused');}, mips: async () => {throw Error('unreachable');}, dispose() {}};
  let finish!: () => void, retired = 0;
  const renderer = {compileAsync: () => new Promise<void>(resolve => {finish = resolve;})} as unknown as WebGLRenderer;
  const hlod = createEaldholtTreeHlod(root, visibility, {renderer, scene: new Scene(), camera: new PerspectiveCamera(), queue, worker, signal: controller.signal, changed() {}});
  const ownedGeometry = (root.getObjectByName('Source-derived tree HLOD')!.children[0] as InstancedMesh).geometry;
  assert.notEqual(ownedGeometry, geometry); ownedGeometry.addEventListener('dispose', () => retired++);
  for (let i = 0; i < 16 && !queue.pending; i++) await new Promise<void>(resolve => queueMicrotask(resolve));
  queue.step(); hlod.dispose(); queue.dispose();
  assert.equal(sources[0].geometry, geometry); assert.equal(retired, 0, 'do not delete programs/buffers that the asynchronous compiler still owns');
  finish(); await hlod.preparation; await queue.whenIdle(); await new Promise<void>(resolve => queueMicrotask(resolve));
  assert.equal(retired, 1); visibility.dispose(); sources.forEach(mesh => mesh.dispose()); geometry.dispose(); bark.dispose(); canopy.dispose();
});
