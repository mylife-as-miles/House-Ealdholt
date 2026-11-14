import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Color, DoubleSide, Matrix4, MeshStandardMaterial, Vector4, type WebGLRenderer} from 'three';
import {captureVegetationAtlas} from './vegetation-atlas-capture';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {VegetationCaptureEmptyError} from '../../../../shared/legacy/aethelgard/environment/vegetation-capture-diagnostics';

async function verifyCaptureFailure(cancel: boolean, maximum = 0, autoReset = true, finiteRange = false, pixelRatio = 1) {
  const signal = new AbortController(), queue = createWorldPreparationQueue(() => {});
  const originalTarget = {}, geometry = new BoxGeometry(200, 1800, 200), material = new MeshStandardMaterial({side: DoubleSide});
  if(finiteRange)geometry.setDrawRange(3,12);
  let target: unknown = originalTarget, release!: () => void, targetDisposals = 0, borrowedDisposals = 0;
  geometry.addEventListener('dispose', () => borrowedDisposals++); material.addEventListener('dispose', () => borrowedDisposals++);
  const colour = new Color(.2, .3, .4), viewport = new Vector4(5, 6, 320, 240), scissor = new Vector4(1, 2, 100, 100);
  const physicalViewport=viewport.clone().multiplyScalar(pixelRatio).round(),originalPhysicalViewport=physicalViewport.clone();
  let alpha = .7, scissorTest = true;
  const fake = {
    xr: {enabled: true}, shadowMap: {enabled: true}, toneMapping: 4, autoClear: false,
    info:{autoReset,render:{calls:9,triangles:99,frame:10}},
    getContext:()=>({isContextLost:()=>false,getError(){throw Error('Atlas diagnostics must never drain the world error queue.');}}),
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getClearColor: (out: Color) => out.copy(colour), getClearAlpha: () => alpha,
    getViewport: (out: Vector4) => out.copy(viewport), getScissor: (out: Vector4) => out.copy(scissor), getScissorTest: () => scissorTest,
    setRenderTarget(value: any) {target = value; if (value !== originalTarget){physicalViewport.copy(value.viewport);value.addEventListener('dispose', () => targetDisposals++);}else physicalViewport.copy(viewport).multiplyScalar(pixelRatio).floor();},
    setViewport(...args: any[]) {if (args.length === 1) viewport.copy(args[0]); else viewport.set(args[0], args[1], args[2], args[3]);physicalViewport.copy(viewport).multiplyScalar(pixelRatio).round();},
    setScissor: (value: Vector4) => scissor.copy(value), setScissorTest: (value: boolean) => {scissorTest = value;},
    setClearColor(value: Color | number, nextAlpha: number) {colour.set(value); alpha = nextAlpha;}, clear() {},
    render() {assert.deepEqual(physicalViewport.toArray(),[0,0,64,64],'Atlas viewport must use target pixels independently of renderScale/DPR.');fake.info.render={calls:(autoReset?0:fake.info.render.calls)+1,triangles:(autoReset?0:fake.info.render.triangles)+(finiteRange?4:12),frame:11};},
    readRenderTargetPixels() {throw Error('Synchronous readback must never run.');},
    readRenderTargetPixelsAsync: (_target:unknown,_x:number,_y:number,_width:number,_height:number,pixels:Uint8Array) => new Promise<Uint8Array>(resolve => {release = () => {if(maximum){pixels[3]=maximum;pixels[7]=1;}resolve(pixels);};}),
  };
  const worker: VegetationPreparationWorker = {simplify: async () => {throw Error('unreachable');}, packed: async () => {throw Error('unused');}, foliageNormals: async () => {throw Error('unused');}, ground: async () => {throw Error('unused');}, mips: async () => {throw Error('unreachable');}, dispose() {}};
  const capture = captureVegetationAtlas({renderer: fake as unknown as WebGLRenderer,
    parts: [{geometry, material, frame: new Matrix4(), foliage: true}], views: 8, tileSize: 64,
    queue, worker, signal: signal.signal, priority: () => 0});
  const rejected = assert.rejects(capture,error=>{
    if(cancel){assert.match(String(error),/abort|retired/i);return true;}
    assert.ok(error instanceof VegetationCaptureEmptyError);
    assert.match(error.message,/capture view 0 is empty/i);
    assert.deepEqual(error.diagnostics,{view:0,topDown:false,tileSize:64,
      parts:[{positions:24,indices:36,drawStart:finiteRange?3:0,drawCount:finiteRange?12:'unbounded'}],
      submission:{calls:1,triangles:finiteRange?4:12,autoReset,frame:11},
      alpha:{maximum,nonzeroPixels:maximum?2:0,pixels:4096},webgl:{contextLost:false,errorQueuePolled:false}});
    assert.doesNotThrow(()=>JSON.parse(error.message.split('Capture facts: ')[1]),'Facts must survive the existing string-only canopy error channel.');return true;
  });
  queue.step();
  assert.equal(target, originalTarget); assert.equal(fake.xr.enabled, true); assert.equal(fake.shadowMap.enabled, true);
  assert.equal(fake.toneMapping, 4); assert.equal(fake.autoClear, false); assert.equal(alpha, .7);
  assert.deepEqual(viewport.toArray(), [5, 6, 320, 240]); assert.deepEqual(scissor.toArray(), [1, 2, 100, 100]);
  assert.deepEqual(physicalViewport.toArray(),originalPhysicalViewport.toArray(),'The original logical and physical viewport must be restored while the fence is pending.');
  assert.equal(scissorTest, true); assert.equal(targetDisposals, 0, 'GPU resources remain alive while the fence is pending');
  fake.info.render={calls:5000,triangles:50000,frame:90};
  if (cancel) signal.abort(); release(); await rejected; assert.equal(targetDisposals, 1); assert.equal(borrowedDisposals, 0);
  queue.dispose(); geometry.dispose(); material.dispose();
}

test('pending GPU readback restores live state and retires resources after the fence', {timeout: 2000}, () => verifyCaptureFailure(true));
test('a blank source capture rejects before a transparent LOD can publish', {timeout: 2000}, () => verifyCaptureFailure(false));
test('partial alpha stays rejected while finite source ranges and cumulative submission counters survive later world draws', {timeout: 2000}, () => verifyCaptureFailure(false,41,false,true));
test('target-pixel capture preserves the full tile and pending-frame restoration at half, normal and double renderer pixel ratios', {timeout:2000},async()=>{
  for(const ratio of [.5,1,2])await verifyCaptureFailure(false,0,true,false,ratio);
});
