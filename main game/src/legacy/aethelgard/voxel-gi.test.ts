import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer} from 'three';
import {createWorldVoxelGI} from './voxel-gi';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

test('standalone Native fallback creates no workers or GPU state and leaves materials intact', async () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial(), mesh = new Mesh(geometry, material); root.add(mesh);
  const queue = createWorldPreparationQueue(() => {}), gi = createWorldVoxelGI({sourceRoot: root,
    renderer: {getContext() {throw Error('Native ambient fallback must not initialize GPU work.');}} as unknown as WebGLRenderer,
    scene: new Scene(), camera: new PerspectiveCamera(), queue, signal: new AbortController().signal,
    active: () => true, prepareEnabled: () => true, preset: () => 'high', native: true,
    readSourceLighting() {throw Error('Native fallback must not start a second light controller.');}, wake() {}, service() {}});
  await gi.sourceReady; gi.update(new PerspectiveCamera(), 0); assert.equal(gi.stats.status, 'native-ambient-fallback');
  assert.equal(mesh.material, material); assert.equal(queue.stats.pending, 0); gi.dispose(); queue.dispose(); geometry.dispose(); material.dispose();
});

test('deferred material groups warm progressively and restore the exact source array after partial admission', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker'); let worker: FakeWorker;
  class FakeWorker {
    onmessage: ((e: {data: any}) => void) | null = null; onerror = null; sent: any[] = [];
    constructor() {worker = this;}
    postMessage(data: any) {this.sent.push(data);}
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', {value: FakeWorker, configurable: true});
  try {
    const root = new Group(), geometry = new BoxGeometry(), a = new MeshStandardMaterial(), b = new MeshStandardMaterial();
    const original = [a, b], mesh = new Mesh(geometry, original); root.add(mesh);
    const queue = createWorldPreparationQueue(() => {}), camera = new PerspectiveCamera(), scene = new Scene();
    let preset:'low'|'medium'='medium';
    const renderer = {getContext: () => ({fenceSync() {}}), debug: {onShaderError: null}, compileAsync: async () => {}} as unknown as WebGLRenderer;
    const gi = createWorldVoxelGI({sourceRoot: root, renderer, scene, camera, queue, signal: new AbortController().signal,
      source: Promise.resolve({source: {worldRegion: 'test-region', sourceSha256: 'a'.repeat(64), generatorVersion: '1', backend: 'webgl2-rgba8', terrain: [], proxies: []},
        diagnostics: {meshes: 0, terrainChunks: 0, vertices: 0, proxies: 0, materialFallbacks: 0}}),
      active: () => true, prepareEnabled: () => true, preset: () => preset,
      readSourceLighting: () => ({sunDirection: [0, 1, 0], sunRadiance: [1, 1, 1], skyRadiance: [.2, .2, .2], cloudTransmission: 1, local: []}), wake() {}, service() {}});
    await new Promise(resolve => setTimeout(resolve, 0)); worker!.onmessage!({data: {id: 0, bytes: 0}}); await gi.sourceReady;
    gi.update(camera, 0); assert.equal(mesh.material, original, 'GPU programs must prepare before source bindings change');
    queue.step(); await new Promise(resolve => setTimeout(resolve, 0)); gi.update(camera, 1);
    assert.notEqual(mesh.material, original); const partial = mesh.material as MeshStandardMaterial[];
    assert.notEqual(partial[0], a); assert.equal(partial[1], b);
    queue.step(); await new Promise(resolve => setTimeout(resolve, 0)); gi.update(camera, 2);
    assert.notEqual((mesh.material as MeshStandardMaterial[])[1], b);
    const warmed=mesh.material as MeshStandardMaterial[];preset='low';gi.update(camera,3);assert.equal(gi.stats.status,'low-ambient-fallback');assert.equal(gi.stats.lowAmbientFallback,true);assert.equal(mesh.material,original,'Low restores the complete original PBR array');const sent=worker!.sent.length;gi.update(camera,4);assert.equal(worker!.sent.length,sent,'Low must not schedule occupancy or live lighting work');assert.equal(queue.stats.pending,0);preset='medium';gi.update(camera,5);assert.equal(gi.stats.lowAmbientFallback,false);assert.deepEqual(mesh.material,warmed,'Returning to Medium reuses the warmed material variants');
    gi.dispose(); await queue.whenIdle(); assert.equal(mesh.material, original, 'reverse unwinding restores pre-integration PBR bindings');
    assert.equal(renderer.debug.onShaderError, null); queue.dispose(); geometry.dispose(); a.dispose(); b.dispose();
  } finally {if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker');}
});

test('retired meshes release their assignments and clones, so roaming never exhausts the lighting budget (L-16)', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker'); let worker: {onmessage: ((e: {data: unknown}) => void) | null} | undefined;
  class FakeWorker {onmessage: ((e: {data: unknown}) => void) | null = null; onerror = null; constructor() {worker = this;} postMessage() {} terminate() {}}
  Object.defineProperty(globalThis, 'Worker', {value: FakeWorker, configurable: true});
  try {
    const root = new Group(), geometry = new BoxGeometry(), queue = createWorldPreparationQueue(() => {}), camera = new PerspectiveCamera(), scene = new Scene();
    const renderer = {getContext: () => ({fenceSync() {}}), debug: {onShaderError: null}, compileAsync: async () => {}} as unknown as WebGLRenderer;
    const gi = createWorldVoxelGI({sourceRoot: root, renderer, scene, camera, queue, signal: new AbortController().signal,
      source: Promise.resolve({source: {worldRegion: 'test-region', sourceSha256: 'a'.repeat(64), generatorVersion: '1', backend: 'webgl2-rgba8', terrain: [], proxies: []},
        diagnostics: {meshes: 0, terrainChunks: 0, vertices: 0, proxies: 0, materialFallbacks: 0}}),
      active: () => true, prepareEnabled: () => true, preset: () => 'medium',
      readSourceLighting: () => ({sunDirection: [0, 1, 0], sunRadiance: [1, 1, 1], skyRadiance: [.2, .2, .2], cloudTransmission: 1, local: []}), wake() {}, service() {}});
    await new Promise(resolve => setTimeout(resolve, 0)); worker!.onmessage!({data: {id: 0, bytes: 0}}); await gi.sourceReady;
    let now = 0;
    const settle = async () => {for (let i = 0; i < 4; i++) {now += 1000; gi.update(camera, now); queue.step(); await new Promise(resolve => setTimeout(resolve, 0));} now += 1000; gi.update(camera, now);};
    // 600 cells, each with its own material, enter and later leave the world, one wave at a time.
    let peak = 0;
    for (let wave = 0; wave < 300; wave++) {
      const cell = new Group(), materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
      for (const material of materials) cell.add(new Mesh(geometry, material));
      root.add(cell); await settle();
      assert.ok(cell.children.every(node => (node as Mesh).material !== materials[0] && (node as Mesh).material !== materials[1]), 'each new cell receives its lighting clones');
      peak = Math.max(peak, gi.stats.materials);
      cell.removeFromParent(); now += 1000; gi.update(camera, now);
      assert.equal((cell.children[0] as Mesh).material, materials[0], 'a retired mesh gets its source material back');
    }
    assert.equal(gi.stats.assignments, 0); assert.equal(gi.stats.materials, 0); assert.ok(peak <= 2, `at most one cell's clones were alive, saw ${peak}`);
    assert.equal(gi.stats.retiredAssignments, 600); assert.equal(gi.stats.retiredMaterials, 600); assert.notEqual(gi.stats.status, 'ambient-fallback');
    gi.dispose(); await queue.whenIdle(); queue.dispose(); geometry.dispose();
  } finally {if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker');}
});
