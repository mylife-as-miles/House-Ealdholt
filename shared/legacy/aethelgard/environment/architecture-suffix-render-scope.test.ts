import assert from 'node:assert/strict';
import test from 'node:test';
import {createArchitectureSuffixRenderScope} from './architecture-suffix-render-scope';

function fixture() {
  const scene = {}, camera = {}, otherCamera = {}, matrices = Float32Array.from({length: 256}, (_, i) => i / 7);
  const child = {name: 'ordinary repaired child'}, source = {count: 16, matrices, children: [child],
    raycast() {return Array.from({length: this.count}, (_, id) => id);}};
  let draw: (scene: object, camera: object) => unknown = () => source.count, held: string | null = null;
  const renderer = {render(scene: object, camera: object): unknown {return draw(scene, camera);}};
  const beforeRender = renderer.render, beforeRaycast = source.raycast;
  const create = (prefix: () => number | null = () => 12) => createArchitectureSuffixRenderScope({renderer, scene, camera,
    bindings: [{source, selectPrefix: prefix}], heldReason: () => held});
  return {scene, camera, otherCamera, source, child, matrices, renderer, beforeRender, beforeRaycast, create,
    setDraw(value: typeof draw) {draw = value;}, setHeld(value: string | null) {held = value;}};
}

test('only the render count changes; original matrices, ordinals, source count and repaired child are retained', () => {
  const f = fixture(), bytes = f.matrices.slice(), owner = f.create();
  assert.equal(f.source.count, 16); assert.equal(f.renderer.render(f.scene, f.camera), 12);
  assert.equal(f.source.count, 16); assert.strictEqual(f.source.matrices, f.matrices); assert.deepEqual(f.matrices, bytes);
  assert.strictEqual(f.source.children[0], f.child); assert.deepEqual(f.source.raycast(), Array.from({length:16},(_,i)=>i));
  assert.equal(owner.stats.lastOmittedInstances, 4); assert.equal(owner.stats.scopedTrimCalls, 1);
  owner.dispose(); assert.strictEqual(f.renderer.render, f.beforeRender); assert.strictEqual(f.source.raycast, f.beforeRaycast);
});

test('renderer and synchronous raycast failures restore the full source without masking the real exception', () => {
  const f = fixture(), failure = Error('Renderer failed.'), owner = f.create();
  f.setDraw(() => {assert.equal(f.source.count, 12); throw failure;});
  assert.throws(() => f.renderer.render(f.scene, f.camera), error => error === failure);
  assert.equal(f.source.count, 16); assert.equal(owner.stats.restoredOnThrow, 1); owner.dispose();
  f.source.raycast = () => {throw failure;}; const next = f.create();
  f.setDraw(() => f.source.raycast());
  assert.throws(() => f.renderer.render(f.scene, f.camera), error => error === failure);
  assert.equal(f.source.count, 16); next.dispose();
});

test('nested or reflected camera calls invalidate the outer selection and retain full source for both passes', () => {
  const f = fixture(), counts: number[] = [], owner = f.create();
  f.setDraw((_scene, camera) => {counts.push(f.source.count);
    if (camera === f.camera) {f.renderer.render(f.scene, f.otherCamera); counts.push(f.source.count);}});
  f.renderer.render(f.scene, f.camera);
  assert.deepEqual(counts, [12, 16, 16]); assert.equal(f.source.count, 16);
  assert.equal(owner.stats.nestedFallbacks, 1); assert.equal(owner.stats.scopedTrimCalls, 0); owner.dispose();
});

test('unknown scenes/cameras and held shadow/XR/offscreen configurations never trim', () => {
  const f = fixture(), owner = f.create();
  assert.equal(f.renderer.render({}, f.camera), 16); assert.equal(f.renderer.render(f.scene, {}), 16);
  for (const reason of ['shadow-full-source', 'xr-full-source', 'reflection-full-source', 'offscreen-full-source']) {
    f.setHeld(reason); assert.equal(f.renderer.render(f.scene, f.camera), 16); assert.equal(f.source.count, 16);
  }
  assert.equal(owner.stats.scopedTrimCalls, 0); owner.dispose();
});

test('a raycast inside the draw uses full original instance IDs and disables clipping for the rest of that draw', () => {
  const f = fixture(), owner = f.create(); let hits: number[] = [];
  f.setDraw(() => {assert.equal(f.source.count, 12); hits = f.source.raycast(); return f.source.count;});
  assert.equal(f.renderer.render(f.scene, f.camera), 16); assert.equal(hits.length, 16); assert.equal(hits[15], 15);
  assert.equal(f.source.count, 16); assert.equal(owner.stats.raycastFallbacks, 1); assert.equal(owner.stats.lastOmittedInstances, 0); owner.dispose();
});

test('disposing inside render restores count and callbacks before returning to the real renderer', () => {
  const f = fixture(), owner = f.create(); f.setDraw(() => {owner.dispose(); return f.source.count;});
  assert.equal(f.renderer.render(f.scene, f.camera), 16); assert.equal(f.source.count, 16);
  assert.strictEqual(f.renderer.render, f.beforeRender); assert.strictEqual(f.source.raycast, f.beforeRaycast); owner.dispose();
});

test('invalid selection, selection errors and explicit source-owner changes keep the existing source', () => {
  for (const prefix of [() => 17, () => -1, () => .5, () => {throw Error('Unknown geometry.');}, () => null]) {
    const f = fixture(), owner = f.create(prefix); assert.equal(f.renderer.render(f.scene, f.camera), 16); assert.equal(f.source.count, 16); owner.dispose();
  }
  const f = fixture(), owner = f.create(); f.source.count = 7;
  assert.equal(f.renderer.render(f.scene, f.camera), 7); assert.equal(f.source.count, 7); assert.equal(owner.stats.sourceChanges, 1); owner.dispose();
});

test('callback ownership is bounded and disposal does not overwrite a newer renderer owner', () => {
  const f = fixture(), owner = f.create(), other = f.create();
  assert.equal(other.stats.status, 'held'); assert.equal(other.stats.reason, 'source-or-owner-budget-held'); other.dispose();
  const chained = f.renderer.render, newer = (scene: object, camera: object) => chained.call(f.renderer, scene, camera);
  f.renderer.render = newer; owner.dispose();
  assert.strictEqual(f.renderer.render, newer); assert.equal(f.renderer.render(f.scene, f.camera), 16);
  assert.strictEqual(f.source.raycast, f.beforeRaycast); assert.equal(f.source.count, 16);
});

test('duplicate source registration is rejected without changing the renderer or source callbacks', () => {
  const f = fixture(), binding = {source: f.source, selectPrefix: () => 12};
  const owner = createArchitectureSuffixRenderScope({renderer: f.renderer, scene: f.scene, camera: f.camera,
    bindings: [binding, binding], heldReason: () => null});
  assert.equal(owner.stats.status, 'held'); assert.strictEqual(f.renderer.render, f.beforeRender); assert.strictEqual(f.source.raycast, f.beforeRaycast); owner.dispose();
});

test('held/selection callbacks cannot republish a prefix after invalidation, disposal or external ownership changes', () => {
  for (const stage of ['held', 'selection']) for (const action of ['raycast','nested','dispose','count','raycast-owner','render-owner']) {
    const f=fixture();let owner:ReturnType<typeof createArchitectureSuffixRenderScope>;
    const act=()=>{
      if(action==='raycast')f.source.raycast();
      else if(action==='nested')f.renderer.render(f.scene,f.otherCamera);
      else if(action==='dispose')owner.dispose();
      else if(action==='count')f.source.count=7;
      else if(action==='raycast-owner')f.source.raycast=()=>[];
      else {const prior=f.renderer.render;f.renderer.render=(scene,camera)=>prior.call(f.renderer,scene,camera);}
    };
    owner=createArchitectureSuffixRenderScope({renderer:f.renderer,scene:f.scene,camera:f.camera,
      bindings:[{source:f.source,selectPrefix(){if(stage==='selection')act();return 12;}}],
      heldReason(){if(stage==='held')act();return null;}});
    try{
      assert.equal(f.renderer.render(f.scene,f.camera),action==='count'?7:16,stage+'/'+action);
      assert.equal(f.source.count,action==='count'?7:16,stage+'/'+action+' source');assert.equal(owner.stats.lastOmittedInstances,0);
    }finally{owner.dispose();}
  }
});
