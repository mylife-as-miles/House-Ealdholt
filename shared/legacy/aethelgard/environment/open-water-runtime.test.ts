import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtOpenWater as desktop } from '../../../../main game/src/legacy/aethelgard/open-water-runtime';
import { createEaldholtOpenWater as native } from '../../../../main-game-vr/src/legacy/aethelgard/open-water-runtime';

const weather = { wind: [1, .2] as const, windStrength: .6, rain: .3 };
function harness(settings: { pixelRatio?: number; foreign?: boolean; explicit?: boolean } = {}) {
  const pixelRatio = settings.pixelRatio ?? 1, physical = (values: number[]) => values.map(value => Math.floor(value * pixelRatio));
  const vector = (x: number, y: number, z: number, w: number) => ({ x, y, z, w, toArray: () => [x, y, z, w] });
  const oldTarget: any = { borrowed: true };
  if (settings.foreign) { oldTarget.viewport = vector(1, 2, 17, 19); oldTarget.scissor = vector(3, 4, 5, 6); oldTarget.scissorTest = true; }
  const draws: { shader: string; inputs: unknown[]; target: unknown; stage?: number; axis?: number }[] = [];
  const listeners = new Map<string, Set<() => void>>(), owned = new Set<unknown>(), disposed = new Map<unknown, number>();
  let current: any = oldTarget, face = 3, mip = 2, viewport = [7, 9, 320, 180], scissor = [4, 5, 200, 100], scissorTest = settings.foreign ? false : true, colour = [.1, .2, .3], alpha = .7;
  let currentViewport = settings.foreign && !settings.explicit ? oldTarget.viewport.toArray() : physical(viewport);
  let currentScissor = settings.foreign && !settings.explicit ? oldTarget.scissor.toArray() : physical(scissor);
  let currentScissorTest = settings.foreign && !settings.explicit ? oldTarget.scissorTest : scissorTest;
  let expectedViewport = currentViewport.slice();
  const expectedScissor = currentScissor.slice(), expectedTest = currentScissorTest;
  const originalTargetViewport = oldTarget.viewport?.toArray(), originalTargetScissor = oldTarget.scissor?.toArray();
  let targetWrites = 0;
  let milliseconds = 0;
  let lost = false, floatSupported = true, framebufferChecks = 0, throwAt = -1, shaderFailure = false, onDraw: (() => void) | null = null;
  const track = (value: any) => { if (value?.addEventListener && !owned.has(value)) { owned.add(value); value.addEventListener('dispose', () => disposed.set(value, (disposed.get(value) ?? 0) + 1)); } };
  const context = { MAX_DRAW_BUFFERS: 1, MAX_COLOR_ATTACHMENTS: 2, MAX_TEXTURE_SIZE: 3, MAX_TEXTURE_IMAGE_UNITS: 4, FRAMEBUFFER: 5, FRAMEBUFFER_COMPLETE: 6, SCISSOR_BOX: 7, SCISSOR_TEST: 8,
    drawBuffers() {}, texStorage2D() {}, isContextLost: () => lost, getParameter: (parameter: number) => parameter === 7 ? Int32Array.from(currentScissor) : parameter === 3 ? 2048 : parameter === 4 ? 16 : 4, isEnabled: () => currentScissorTest,
    checkFramebufferStatus() { framebufferChecks++; return 6; } };
  const canvas = { addEventListener(name: string, callback: () => void) { let set = listeners.get(name); if (!set) { set = new Set(); listeners.set(name, set); } set.add(callback); },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); } };
  const originalShaderError = () => {};
  const renderer = { domElement: canvas, xr: { enabled: true }, info: { autoReset: true }, debug: { checkShaderErrors: false, onShaderError: originalShaderError as ((...args: any[]) => void) | null }, autoClear: true,
    getContext: () => context, extensions: { has: () => floatSupported },
    getRenderTarget: () => current, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    getPixelRatio: () => pixelRatio, getCurrentViewport: (value: any) => value.set(...currentViewport),
    getViewport: (value: any) => value.set(...viewport), getScissor: (value: any) => value.set(...scissor), getScissorTest: () => scissorTest,
    getClearColor: (value: any) => value.setRGB(...colour), getClearAlpha: () => alpha,
    setRenderTarget(value: any, nextFace = 0, nextMip = 0) { targetWrites++; current = value; face = nextFace; mip = nextMip; currentViewport = value?.viewport?.toArray() ?? physical(viewport); currentScissor = value?.scissor?.toArray() ?? physical(scissor); currentScissorTest = value?.scissorTest ?? scissorTest; track(value); },
    setViewport(...args: any[]) { viewport = args.length === 1 ? args[0].toArray() : args; currentViewport = physical(viewport); }, setScissor(value: any) { scissor = value.toArray(); currentScissor = physical(scissor); },
    setScissorTest(value: boolean) { scissorTest = value; currentScissorTest = value; }, setClearColor(value: any, nextAlpha: number) { colour = typeof value === 'number' ? [0, 0, 0] : [value.r, value.g, value.b]; alpha = nextAlpha; }, clear() {},
    render(object: any) {
      assert.deepEqual(currentViewport, [0, 0, current.width, current.height], 'Every FFT texel is rendered at physical target resolution regardless of pixel ratio.');
      assert.equal(currentScissorTest, false);
      const material = object.material, uniforms = material.uniforms; track(material); track(object.geometry);
      const inputs = [uniforms.uNoise?.value, uniforms.uH0?.value, uniforms.uIn0?.value, uniforms.uIn1?.value, uniforms.uF0?.value, uniforms.uF1?.value, uniforms.uPrev?.value].filter(Boolean);
      for (const input of inputs) { track(input); assert.ok(!current.textures.includes(input), 'A compute pass never samples its attached output.'); }
      draws.push({ shader: material.fragmentShader, target: current, inputs, stage: uniforms.uStage?.value, axis: uniforms.uDir?.value });
      onDraw?.();
      if (shaderFailure) renderer.debug.onShaderError?.(context, {}, {}, {});
      if (draws.length === throwAt) throw Error('injected GPU render failure');
    },
  };
  return { renderer, draws, track, disposed, now: () => milliseconds, set milliseconds(value: number) { milliseconds = value; },
    dispatch(name: string) { for (const listener of listeners.get(name) ?? []) listener(); },
    get listeners() { return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
    set lost(value: boolean) { lost = value; }, set supported(value: boolean) { floatSupported = value; },
    set throwAt(value: number) { throwAt = value; }, set shaderFailure(value: boolean) { shaderFailure = value; }, set onDraw(value: (() => void) | null) { onDraw = value; },
    get framebufferChecks() { return framebufferChecks; }, get targetWrites() { return targetWrites; },
    set subview(value: number[]) { currentViewport = value.slice(); expectedViewport = value.slice(); },
    representableViewport() { currentViewport = oldTarget.viewport?.toArray() ?? physical(viewport); expectedViewport = currentViewport.slice(); },
    assertStateRestored() {
      assert.equal(current, oldTarget); assert.equal(face, 3); assert.equal(mip, 2); assert.deepEqual(viewport, [7, 9, 320, 180]); assert.deepEqual(scissor, [4, 5, 200, 100]);
      assert.equal(scissorTest, settings.foreign ? false : true); assert.deepEqual(currentViewport, expectedViewport); assert.deepEqual(currentScissor, expectedScissor); assert.equal(currentScissorTest, expectedTest);
      assert.deepEqual(oldTarget.viewport?.toArray(), originalTargetViewport); assert.deepEqual(oldTarget.scissor?.toArray(), originalTargetScissor);
      assert.deepEqual(colour, [.1, .2, .3]); assert.equal(alpha, .7); assert.equal(renderer.xr.enabled, true); assert.equal(renderer.autoClear, true);
      assert.equal(renderer.info.autoReset, true); assert.equal(renderer.debug.checkShaderErrors, false); assert.equal(renderer.debug.onShaderError, originalShaderError);
    },
  };
}

for (const [platform, create] of [['desktop', desktop], ['native', native]] as const) {
  test(`${platform}: actual FFT owner executes all Stockham axes and atomically publishes four fields with renderer state restored`, () => {
    const h = harness(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, maxUpdatesPerSecond: 8, now: h.now });
    h.track(runtime.uniforms.surface0.value); const empty = runtime.uniforms.surface0.value;
    h.onDraw = () => { for (const sampler of [runtime.uniforms.surface0, runtime.uniforms.surface1, runtime.uniforms.surface2, runtime.uniforms.surface3]) assert.equal(sampler.value, empty); };
    runtime.update(100, false, weather); assert.equal(h.draws.length, 0); assert.equal(runtime.diagnostics.ready, false);
    runtime.update(100, true, weather); h.onDraw = null;
    assert.equal(runtime.diagnostics.backend, 'gpu-fft'); assert.equal(runtime.diagnostics.fieldUpdates, 1); assert.equal(runtime.diagnostics.spectrumBuilds, 1);
    assert.equal(runtime.diagnostics.passes, 52); assert.equal(runtime.diagnostics.maxPassesObserved, 52); assert.equal(runtime.diagnostics.renderTargets, 14);
    const fft = h.draws.filter(draw => draw.stage !== undefined); assert.equal(fft.length, 40);
    for (let cascade = 0; cascade < 4; cascade++) assert.deepEqual(fft.slice(cascade * 10, cascade * 10 + 10).map(draw => [draw.axis, draw.stage]), [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]);
    assert.equal(new Set(runtime.textures).size, 4); for (const texture of runtime.textures) assert.notEqual(texture, empty);
    assert.ok(runtime.diagnostics.significantHeightMetres > 0); h.assertStateRestored();
    for (let frame = 1; frame <= 500; frame++) { h.milliseconds = frame * 10; runtime.update(100 + frame / 100, true, { ...weather, windStrength: .6 + frame / 2000 }); }
    assert.ok(runtime.diagnostics.fieldUpdates <= 42); assert.ok(runtime.diagnostics.spectrumBuilds <= 4); assert.ok(runtime.diagnostics.maxPassesObserved <= runtime.diagnostics.maxPassesPerUpdate);
    runtime.dispose(); runtime.dispose(); assert.equal(runtime.diagnostics.disposed, true); assert.equal(h.listeners, 0);
    for (const count of h.disposed.values()) assert.equal(count, 1); assert.equal(h.disposed.size, 24); assert.equal(runtime.diagnostics.renderTargets, 0); h.assertStateRestored();
  });


  test(`${platform}: compute uses physical texels at fractional/high DPR and restores foreign target metadata or explicit overrides`, () => {
    for (const pixelRatio of [.5, .75, 1.5, 2]) for (const mode of ['default', 'target', 'override'] as const) {
      const h = harness({ pixelRatio, foreign: mode !== 'default', explicit: mode === 'override' });
      const runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: h.now });
      runtime.update(0, true, weather); assert.equal(runtime.diagnostics.backend, 'gpu-fft'); assert.equal(runtime.diagnostics.passes, 52);
      h.assertStateRestored(); runtime.dispose(); h.assertStateRestored();
    }
  });


  test(`${platform}: an ArrayCamera last-eye viewport uses recoverable analytic water without touching renderer state`, () => {
    const h = harness({ pixelRatio: .75, foreign: true }), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: h.now });
    h.subview = [9, 11, 23, 29]; const writes = h.targetWrites;
    runtime.update(0, true, weather);
    assert.equal(runtime.diagnostics.reason, 'array-camera/subview-analytic-fallback'); assert.equal(runtime.uniforms.ready.value, 0);
    assert.equal(h.targetWrites, writes); assert.equal(h.draws.length, 0); assert.equal(h.framebufferChecks, 0); h.assertStateRestored();
    const shader = { uniforms: {}, vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}', fragmentShader: '#include <common>\nvoid main(){\n#include <normal_fragment_maps>\n}' };
    runtime.patchShader(shader, { worldToSource: { value: {} }, sourceToWorldRotation: { value: {} } }, 'pond');
    assert.match(shader.fragmentShader, /CROWNFALL_OPEN_WATER_FFT/, 'transient fallback still binds the recoverable shader with ready0');
    h.representableViewport(); h.milliseconds = 100; runtime.update(.1, true, weather);
    assert.equal(runtime.diagnostics.ready, true); assert.equal(runtime.diagnostics.fieldUpdates, 1); h.assertStateRestored();
    h.subview = [9, 11, 23, 29]; const after = h.targetWrites;
    h.milliseconds = 200; runtime.update(.2, true, weather); assert.equal(runtime.diagnostics.ready, false); assert.equal(h.targetWrites, after); h.assertStateRestored();
    h.representableViewport(); h.milliseconds = 300; runtime.update(.3, true, weather); h.milliseconds = 400; runtime.update(.4, true, weather);
    assert.equal(runtime.diagnostics.ready, true); assert.equal(runtime.diagnostics.fieldUpdates, 2); assert.equal(runtime.diagnostics.subviewFallbacks, 2);
    h.assertStateRestored(); runtime.dispose();
  });

  test(`${platform}: GPU failure restores the borrowed renderer and retains an honest analytic fallback`, () => {
    const h = harness(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: h.now });
    h.throwAt = 7; runtime.update(0, true, weather);
    assert.equal(runtime.diagnostics.backend, 'analytic-fallback'); assert.match(runtime.diagnostics.reason!, /injected GPU render failure/);
    assert.equal(runtime.uniforms.ready.value, 0); assert.equal(runtime.diagnostics.fieldUpdates, 0); assert.equal(runtime.diagnostics.renderTargets, 0); h.assertStateRestored();
    const calls = h.draws.length; runtime.update(.5, true, weather); assert.equal(h.draws.length, calls); runtime.dispose();
    const unsupported = harness(); unsupported.supported = false;
    const fallback = create(unsupported.renderer as unknown as Parameters<typeof create>[0]); fallback.update(0, true, weather);
    assert.equal(fallback.diagnostics.reason, 'float-color-buffer-unavailable'); assert.equal(unsupported.draws.length, 0); assert.equal(fallback.diagnostics.renderTargets, 0); fallback.dispose();
  });

  test(`${platform}: loss and restoration between paused frames invalidate all GPU history before fresh publication`, () => {
    const h = harness(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: h.now });
    runtime.update(0, true, weather); assert.equal(runtime.uniforms.ready.value, 1); const firstBuilds = runtime.diagnostics.spectrumBuilds, checks = h.framebufferChecks;
    h.lost = true; h.dispatch('webglcontextlost'); assert.equal(runtime.uniforms.ready.value, 0); assert.equal(runtime.diagnostics.reason, 'context-lost');
    const calls = h.draws.length; runtime.update(100, false, weather); assert.equal(h.draws.length, calls);
    h.lost = false; h.dispatch('webglcontextrestored'); assert.equal(runtime.diagnostics.backend, 'pending-gpu'); assert.equal(runtime.uniforms.ready.value, 0);
    runtime.update(200, false, weather); assert.equal(h.draws.length, calls); runtime.update(200, true, weather);
    assert.equal(runtime.diagnostics.ready, true); assert.equal(runtime.diagnostics.spectrumBuilds, firstBuilds + 1); assert.equal(runtime.diagnostics.contextRestores, 1);
    assert.ok(h.framebufferChecks >= checks + 14); assert.equal(runtime.diagnostics.historyClears, 16); h.assertStateRestored();
    h.lost = true; runtime.update(201, false, weather); assert.equal(runtime.uniforms.ready.value, 0, 'loss is checked even before paused cadence admission');
    h.lost = false; runtime.update(202, false, weather); assert.equal(runtime.uniforms.ready.value, 0); runtime.update(202, true, weather); assert.equal(runtime.diagnostics.ready, true);
    runtime.dispose(); assert.equal(h.listeners, 0);
  });


  test(`${platform}: four-times observer speed cannot exceed the monotonic GPU budget or spectrum rebuild rate`, () => {
    const h = harness(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, maxUpdatesPerSecond: 15, now: h.now });
    runtime.update(0, true, weather);
    for (let frame = 1; frame <= 120; frame++) {
      h.milliseconds = frame * 1000 / 120;
      runtime.update(frame * 4 / 120, true, { ...weather, windStrength: .6 + frame / 1200 });
    }
    assert.ok(runtime.diagnostics.fieldUpdates <= 16, 'one cold initialization plus at most15 admitted updates in one real second');
    assert.equal(runtime.diagnostics.spectrumBuilds, 1, 'four simulated seconds cannot bypass the two-real-second spectrum gate');
    assert.ok(runtime.diagnostics.timeSeconds > 3.7, 'the existing observer clock, not performance time, still owns wave phase');
    const updates = runtime.diagnostics.fieldUpdates;
    runtime.update(4.1, false, weather); assert.equal(runtime.diagnostics.fieldUpdates, updates);
    h.assertStateRestored(); runtime.dispose();
  });

  test(`${platform}: reset during compute invalidates publication and shader errors restore the caller's debug hook`, () => {
    const h = harness(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: h.now });
    h.onDraw = () => runtime.reset(); runtime.update(0, true, weather);
    assert.equal(runtime.diagnostics.backend, 'pending-gpu'); assert.equal(runtime.diagnostics.ready, false); assert.equal(runtime.diagnostics.fieldUpdates, 0);
    h.assertStateRestored(); h.onDraw = null; runtime.update(1, false, weather); runtime.update(1, true, weather);
    assert.equal(runtime.diagnostics.ready, true); assert.equal(runtime.diagnostics.spectrumBuilds, 1); runtime.dispose();
    const failed = harness(), broken = create(failed.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, now: failed.now });
    failed.shaderFailure = true; broken.update(0, true, weather);
    assert.equal(broken.diagnostics.backend, 'analytic-fallback'); assert.match(broken.diagnostics.reason!, /shader compilation failed/);
    assert.equal(broken.diagnostics.ready, false); failed.assertStateRestored(); broken.dispose();
  });

  test(`${platform}: abort during a real pass cannot publish stale fields or leak renderer state`, () => {
    const h = harness(), controller = new AbortController(), runtime = create(h.renderer as unknown as Parameters<typeof create>[0], { resolution: 32, signal: controller.signal, now: h.now });
    h.onDraw = () => controller.abort(); runtime.update(0, true, weather);
    assert.equal(runtime.diagnostics.backend, 'disposed'); assert.equal(runtime.diagnostics.reason, 'aborted'); assert.equal(runtime.uniforms.ready.value, 0);
    assert.equal(runtime.diagnostics.fieldUpdates, 0); assert.equal(runtime.diagnostics.renderTargets, 0); assert.equal(h.listeners, 0); h.assertStateRestored();
    runtime.dispose(); for (const count of h.disposed.values()) assert.equal(count, 1);
  });
}
