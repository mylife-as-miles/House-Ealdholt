import { afterEach, describe, expect, it, vi } from 'vitest';
// The real Desktop factory imports this exact package. A second Three copy
// would make its instanceof Mesh/Material checks silently test the wrong path.
const desktopThreePath = new URL('../../../main game/node_modules/three/build/three.module.js', import.meta.url).href;
const THREE = await import(desktopThreePath) as typeof import('../../../main game/node_modules/@types/three');
import { REGIONAL_VEGETATION_PROTOTYPES } from '../../../shared/legacy/aethelgard/environment/regional-assets';
import { createRegionalForest } from '../../../main game/src/legacy/aethelgard/regional-forest';

const harness = vi.hoisted(() => ({ resources: null as any, workers: [] as any[] }));
vi.mock('../../../main game/src/legacy/aethelgard/vegetation-prototype', () => ({
  createVegetationPrototypeResources: () => harness.resources,
}));
vi.mock('../../../main game/src/legacy/aethelgard/regional-groundcover', async () => {
  const path = new URL('../../../main game/node_modules/three/build/three.module.js', import.meta.url).href;
  const three = await import(path) as typeof import('../../../main game/node_modules/@types/three');
  // as the real one: the forest waits for its groundcover to retire before releasing what it shares
  return { createRegionalGroundcover: () => ({ object: new three.Group(), stats: {}, beginFrame() {}, update() {}, dispose() {}, whenRetired: () => Promise.resolve() }) };
});
vi.mock('../../../main game/src/legacy/aethelgard/regional-village-source', () => ({
  collectRegionalVillageSource: () => ({ village: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, villageLand: [] }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
async function finishRemainingCaptures(f: ReturnType<typeof fixture>, first: number) {
  for (let i = first; i < 15; i++) {
    expect(f.captures[i]).toBeDefined(); f.captures[i].resolve(f.atlas); await settle();
    f.compilations[f.compilations.length - 1].resolve({}); await settle();
  }
}
function fixture() {
  const prototypes = new THREE.Group(), sourceRoot = new THREE.Group();
  for (const prototype of REGIONAL_VEGETATION_PROTOTYPES) {
    const family = new THREE.Group(); family.name = prototype.id;
    family.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })));
    prototypes.add(family);
  }
  const atlas = { bytes: 8, maps: [new THREE.Texture(), new THREE.Texture()], record: {
    centre: [0, 1, 0], extent: [1, 2], views: 8, columns: 4, rows: 2, tileSize: 64, mips: [{ width: 256, height: 128 }],
  } };
  const captures: ReturnType<typeof deferred<typeof atlas>>[] = [], compilations: ReturnType<typeof deferred<object>>[] = [];
  const releases = vi.fn();
  harness.resources = {
    stats: {}, trim() {}, dispose: vi.fn(),
    atlas(_parts: unknown, _size: number, _views: number, canopy = false) {
      if (!canopy) return { ready: Promise.resolve(atlas), release: releases };
      const pending = deferred<typeof atlas>(); captures.push(pending); return { ready: pending.promise, release: releases };
    },
    compile(key: string) {
      if (key === 'regional-far-v1') return { ready: Promise.resolve({}), release: releases };
      const pending = deferred<object>(); compilations.push(pending); return { ready: pending.promise, release: releases };
    },
  };
  class Worker {
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    constructor() { harness.workers.push(this); }
    postMessage() {} terminate() {}
  }
  vi.stubGlobal('Worker', Worker);
  const parent = new AbortController();
  const forest = createRegionalForest({ sourceRoot, prototypes, geography: {} as any, land: [], renderer: {} as any,
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), queue: { whenIdle: async () => {} } as any,
    worker: {} as any, signal: parent.signal, changed: vi.fn(), active: () => true });
  const placements = new Float32Array(15 * 6);
  for (let i = 0; i < 15; i++) placements.set([i * 10, 0, 0, 0, 1, i], i * 6);
  harness.workers[harness.workers.length - 1].onmessage({ data: { layout: {
    version: 'actual-factory-readiness-test', placements, treeCount: 12, shrubCount: 3, cells: [], species: Array(15).fill(1), landmarks: [],
  } } });
  return { forest, captures, compilations, atlas, releases, parent };
}
afterEach(() => vi.unstubAllGlobals());
describe('actual Desktop regional forest canopy readiness', () => {
  it('keeps upright draws usable but does not publish initial readiness before all overhead materials compile', async () => {
    const f = fixture(); await settle();
    expect(f.forest.stats.status).toBe('ready'); expect(f.forest.stats.readyPrototypes).toBe(15);
    expect(f.forest.stats.readyCanopies).toBe(0); expect(f.forest.preparationReady).toBe(false);
    expect(f.forest.object.children.filter((object: any) => object.name.startsWith('Regional L3 ') && !object.name.endsWith('overhead crown'))).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(f.captures[i]).toBeDefined(); f.captures[i].resolve(f.atlas); await settle();
      expect(f.forest.stats.readyCanopies).toBe(i); expect(f.forest.preparationReady).toBe(false);
      f.compilations[i].resolve({}); await settle();
    }
    expect(f.forest.stats.readyCanopies).toBe(15); expect(f.forest.stats.canopyPreparation).toBe('ready');
    expect(f.forest.preparationReady).toBe(true); f.forest.dispose();
  });
  it('makes a rejected cap atlas an explicit degraded fallback while retaining upright geometry', async () => {
    const f = fixture(); await settle(); f.captures[0].reject(new Error('Canopy atlas unavailable')); await settle();
    expect(f.forest.stats.canopyPreparation).toBe('preparing'); expect(f.forest.preparationReady).toBe(false);
    await finishRemainingCaptures(f, 1);
    expect(f.forest.stats.canopyPreparation).toBe('failed'); expect(f.forest.stats.canopyError).toContain('Canopy atlas unavailable');
    expect(f.forest.stats.canopyError).toContain(REGIONAL_VEGETATION_PROTOTYPES[0].id);
    expect(f.forest.stats.readyCanopies).toBe(14); expect(f.forest.stats.readyPrototypes).toBe(15);
    expect(f.forest.preparationReady).toBe(true);
    expect(f.forest.object.children.filter((object: any) => object.name.startsWith('Regional L3 ') && !object.name.endsWith('overhead crown'))).toHaveLength(15);
    expect(f.forest.object.children.filter((object: any) => object.name.endsWith('overhead crown'))).toHaveLength(14);
    f.forest.dispose();
  });
  it('does not count an overhead atlas as ready when its actual material lease rejects', async () => {
    const f = fixture(); await settle(); f.captures[0].resolve(f.atlas); await settle();
    expect(f.forest.preparationReady).toBe(false); f.compilations[0].reject(new Error('Overhead shader failed')); await settle();
    expect(f.forest.stats.readyCanopies).toBe(0); expect(f.forest.preparationReady).toBe(false);
    const failedCap = f.forest.object.children.find((object: any) => object.name.endsWith('overhead crown'));
    expect(failedCap?.visible).toBe(false);
    await finishRemainingCaptures(f, 1);
    expect(f.forest.stats.readyCanopies).toBe(14); expect(f.forest.stats.canopyPreparation).toBe('failed');
    expect(f.forest.stats.canopyError).toContain('Overhead shader failed'); expect(f.forest.preparationReady).toBe(true);
    f.forest.dispose();
  });
});
