/** Open Water GPU FFT adapter for the existing renderer.
 * Adapted from Leonxlnx/open-water@3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8,
 * Copyright (c) 2026 Leonxlnx, MIT; see LICENSE.open-water.txt. No audio is used.
 * Publishes packed slope/height/foam fields, never displaced village geometry. */
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, FloatType, GLSL3, HalfFloatType,
  LinearFilter, LinearMipmapLinearFilter, Mesh, NearestFilter, NoBlending, NoColorSpace, OrthographicCamera,
  RawShaderMaterial, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget,
  type Texture, type WebGLRenderer } from 'three';
import { createOpenWaterBands, createOpenWaterNoise, computeOpenWaterSpectrumStats, OPEN_WATER_LENGTHS,
  type OpenWaterBand, type OpenWaterResolution, type OpenWaterSpectrumParameters } from '../../../../shared/legacy/aethelgard/environment/open-water-spectrum';
import { createOpenWaterClock, openWaterCapabilityFailure } from '../../../../shared/legacy/aethelgard/environment/open-water-clock';
import { OPEN_WATER_ASSEMBLE_FRAGMENT, OPEN_WATER_EVOLVE_FRAGMENT, OPEN_WATER_FFT_FRAGMENT,
  OPEN_WATER_FULLSCREEN_VERTEX, OPEN_WATER_SPECTRUM_FRAGMENT } from '../../../../shared/legacy/aethelgard/environment/open-water-programs';
import { patchEaldholtOpenWater, type EaldholtOpenWaterProfile, type EaldholtOpenWaterUniforms } from '../../../../shared/legacy/aethelgard/environment/open-water-shader';
import type { EaldholtRippleShader, EaldholtWaterWind } from '../../../../shared/legacy/aethelgard/environment/water-ripples';
export { EALDHOLT_OPEN_WATER_PROGRAM_KEY, patchEaldholtOpenWater } from '../../../../shared/legacy/aethelgard/environment/open-water-shader';
export type { EaldholtOpenWaterProfile, EaldholtOpenWaterUniforms } from '../../../../shared/legacy/aethelgard/environment/open-water-shader';
export interface EaldholtOpenWaterOptions {
  readonly profile?: 'desktop' | 'quest'; readonly quality?: 'low' | 'medium' | 'high';
  readonly resolution?: OpenWaterResolution; readonly maxUpdatesPerSecond?: number;
  /** Monotonic milliseconds for work admission only; never a wave/world clock. */
  readonly now?: () => number; readonly seed?: number; readonly signal?: AbortSignal;
}
export interface EaldholtOpenWaterDiagnostics {
  readonly backend: 'pending-gpu' | 'gpu-fft' | 'analytic-fallback' | 'disposed'; readonly reason: string | null;
  readonly resolution: OpenWaterResolution; readonly cascades: 4; readonly lengths: typeof OPEN_WATER_LENGTHS;
  readonly updatesPerSecond: number; readonly updates: number; readonly passes: number; readonly spectrumUpdates: number;
  readonly spectrumBuilds: number; readonly fieldUpdates: number; readonly maxPassesPerUpdate: number; readonly maxPassesObserved: number; readonly historyClears: number;
  readonly timeSeconds: number; readonly significantHeightMetres: number; readonly resolvedSlopeVariance: number;
  readonly renderTargets: number; readonly estimatedTextureBytes: number; readonly resets: number;
  readonly subviewFallbacks: number; readonly contextLosses: number; readonly contextRestores: number;
  readonly ready: boolean; readonly geometryDisplacement: false; readonly disposed: boolean;
}
export interface EaldholtOpenWater {
  readonly uniforms: EaldholtOpenWaterUniforms; readonly diagnostics: EaldholtOpenWaterDiagnostics;
  /** Four shared RGBA[slopeX,slopeZ,heightMetres,foam] textures. References are
   * atomically republished after all cascades finish; no vertex displacement. */
  readonly textures: readonly (Texture | null)[];
  update(elapsedSeconds: number, animated: boolean, weather?: (EaldholtWaterWind & { readonly rain?: number }) | null): void;
  patchShader(shader: EaldholtRippleShader, sourceFrame: { readonly worldToSource: { value: unknown }; readonly sourceToWorldRotation: { value: unknown } }, profile: EaldholtOpenWaterProfile): void;
  reset(): void; dispose(): void;
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Cascade = { band: OpenWaterBand; noise: DataTexture; spectrum: WebGLRenderTarget; surface: [WebGLRenderTarget, WebGLRenderTarget]; current: number };
const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** One owner is shared by all village water materials. All compute work uses
 * the supplied renderer, one full-screen mesh and no world scene or clock. */
export function createEaldholtOpenWater(renderer: WebGLRenderer, options: EaldholtOpenWaterOptions = {}): EaldholtOpenWater {
  const resolution = options.resolution ?? (options.profile === 'quest' || options.quality === 'low' ? 32 : 64);
  const rate = options.maxUpdatesPerSecond ?? (options.profile === 'quest' || options.quality === 'low' ? 8 : options.quality === 'high' ? 15 : 10);
  const now = options.now ?? (() => performance.now());
  const seed = options.seed ?? 1337, bands = createOpenWaterBands(resolution), clock = createOpenWaterClock(rate);
  if (!Number.isSafeInteger(seed)) throw Error('Open Water seed must be a safe integer.');
  const empty = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType);
  empty.name = 'Open Water analytic fallback'; empty.colorSpace = NoColorSpace; empty.needsUpdate = true;
  const textures: (Texture | null)[] = [empty, empty, empty, empty];
  const uniforms: EaldholtOpenWaterUniforms = { surface0: { value: empty }, surface1: { value: empty }, surface2: { value: empty }, surface3: { value: empty },
    lengths: { value: new Float32Array(OPEN_WATER_LENGTHS) }, resolution: { value: resolution }, ready: { value: 0 }, slopeVariance: { value: new Float32Array(4) }, windStrength: { value: 0 } };
  const samplers = [uniforms.surface0, uniforms.surface1, uniforms.surface2, uniforms.surface3];
  const diagnostics: Mutable<EaldholtOpenWaterDiagnostics> = { backend: 'pending-gpu', reason: null, resolution, cascades: 4, lengths: OPEN_WATER_LENGTHS,
    updatesPerSecond: rate, updates: 0, passes: 0, spectrumUpdates: 0, spectrumBuilds: 0, fieldUpdates: 0, maxPassesPerUpdate: 4 * (2 * Math.log2(resolution) + 3), maxPassesObserved: 0, historyClears: 0, timeSeconds: 0, significantHeightMetres: 0, resolvedSlopeVariance: 0,
    renderTargets: 0, estimatedTextureBytes: 0, resets: 0, subviewFallbacks: 0, contextLosses: 0, contextRestores: 0, ready: false, geometryDisplacement: false, disposed: false };
  const targets: WebGLRenderTarget[] = [], noises: DataTexture[] = [], materials: RawShaderMaterial[] = [], cascades: Cascade[] = [], validated = new Set<WebGLRenderTarget>();
  const viewport = new Vector4(), currentViewport = new Vector4(), logicalRounded = new Vector4(), logicalFloored = new Vector4(), scissor = new Vector4(), currentScissor = new Vector4(), clearColor = new Color(), windDirection = new Vector2(1, 0);
  const phase = { value: 0 }, metresPerWorldUnit = { value: 1 }, direction = { value: windDirection };
  let gl: WebGL2RenderingContext | null = null, disposed = false, running = false, contextSuspended = false, subviewFallback = false, releasePending = false, generation = 0, activeGeneration = 0, needsClear = true, spectrumInitialized = false, spectrumAtMilliseconds = 0;
  let lastWorkMilliseconds: number | null = null, lastFieldTimeSeconds: number | null = null, fieldDeltaSeconds = 0;
  let spectrumStrength = 0, spectrumDirection = 0, updateStartPasses = 0;
  let previousShaderError: typeof renderer.debug.onShaderError;
  const shaderError: NonNullable<WebGLRenderer['debug']['onShaderError']> = (context, program, vertex, fragment) => {
    previousShaderError?.(context, program, vertex, fragment); throw Error('Open Water GPU shader compilation failed.');
  };
  let geometry: BufferGeometry | null = null, mesh: Mesh<BufferGeometry, RawShaderMaterial> | null = null, camera: OrthographicCamera | null = null;
  let spectrumMaterial: RawShaderMaterial | null = null, evolveMaterial: RawShaderMaterial | null = null, fftMaterial: RawShaderMaterial | null = null, assembleMaterial: RawShaderMaterial | null = null;
  let ping: WebGLRenderTarget | null = null, pong: WebGLRenderTarget | null = null;
  const parameters: Mutable<OpenWaterSpectrumParameters> = { wind: .5, fetch: 20000, direction: 0, scale: 0 };

  function releaseGpu(): void {
    for (const target of targets) target.dispose(); targets.length = 0;
    for (const noise of noises) noise.dispose(); noises.length = 0;
    for (const material of materials) material.dispose(); materials.length = 0;
    geometry?.dispose(); geometry = null; mesh = null; camera = null; cascades.length = 0; validated.clear();
    ping = null; pong = null; spectrumMaterial = null; evolveMaterial = null; fftMaterial = null; assembleMaterial = null;
    diagnostics.renderTargets = 0; diagnostics.estimatedTextureBytes = 0;
  }
  function fallback(reason: string): void {
    diagnostics.backend = 'analytic-fallback'; diagnostics.reason = reason; diagnostics.ready = false; uniforms.ready.value = 0;
    for (let i = 0; i < 4; i++) { textures[i] = empty; samplers[i].value = empty; }
    releaseGpu();
  }
  function target(count: number, half = false, mipmaps = false): WebGLRenderTarget {
    const value = new WebGLRenderTarget(resolution, resolution, { count, type: half ? HalfFloatType : FloatType, format: RGBAFormat,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: mipmaps, minFilter: mipmaps ? LinearMipmapLinearFilter : NearestFilter, magFilter: half ? LinearFilter : NearestFilter });
    for (const texture of value.textures) { texture.colorSpace = NoColorSpace; texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping; }
    targets.push(value); return value;
  }
  function material(fragmentShader: string, values: RawShaderMaterial['uniforms']): RawShaderMaterial {
    const value = new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: OPEN_WATER_FULLSCREEN_VERTEX, fragmentShader, uniforms: values,
      depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false });
    materials.push(value); return value;
  }
  function setupGpu(): void {
  try {
    const context = renderer.getContext(), candidate = context as WebGL2RenderingContext;
    const webgl2 = typeof candidate.drawBuffers === 'function' && typeof candidate.texStorage2D === 'function';
    const lost = webgl2 && candidate.isContextLost();
    const capabilityError = lost ? null : openWaterCapabilityFailure({ webgl2, floatColorBuffer: renderer.extensions.has('EXT_color_buffer_float'),
      maximumDrawBuffers: webgl2 ? Number(candidate.getParameter(candidate.MAX_DRAW_BUFFERS)) : 0, maximumColorAttachments: webgl2 ? Number(candidate.getParameter(candidate.MAX_COLOR_ATTACHMENTS)) : 0,
      maximumTextureSize: Number(context.getParameter(context.MAX_TEXTURE_SIZE)), fragmentTextureUnits: Number(context.getParameter(context.MAX_TEXTURE_IMAGE_UNITS)) }, resolution);
    if (lost) { gl = candidate; contextSuspended = true; diagnostics.backend = 'analytic-fallback'; diagnostics.reason = 'context-lost'; diagnostics.contextLosses++; }
    else if (capabilityError) fallback(capabilityError);
    else if (options.signal?.aborted) fallback('aborted');
    else {
      gl = candidate;
      spectrumMaterial = material(OPEN_WATER_SPECTRUM_FRAGMENT, { uNoise: { value: empty }, uL: { value: 1 }, uBand: { value: new Vector2() },
        uWind: { value: new Vector4() }, uSwell: { value: new Vector4(0, 10, 0, 8) }, uShortCut: { value: .004 }, uSpreadBlend: { value: 0 } });
      evolveMaterial = material(OPEN_WATER_EVOLVE_FRAGMENT, { uH0: { value: empty }, uL: { value: 1 }, uTime: phase });
      fftMaterial = material(OPEN_WATER_FFT_FRAGMENT, { uIn0: { value: empty }, uIn1: { value: empty }, uStage: { value: 0 }, uDir: { value: 0 } });
      assembleMaterial = material(OPEN_WATER_ASSEMBLE_FRAGMENT, { uF0: { value: empty }, uF1: { value: empty }, uPrev: { value: empty },
        uLambda: { value: .8 }, uDt: { value: 0 }, uFoam: { value: new Vector3() }, uDrift: { value: new Vector2() } });
      geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      mesh = new Mesh(geometry, spectrumMaterial); mesh.name = 'Shared Open Water FFT compute'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1); ping = target(2); pong = target(2);
      for (let i = 0; i < 4; i++) {
        const noise = new DataTexture(createOpenWaterNoise(resolution, (seed + i * 0x9e3779b9) >>> 0), resolution, resolution, RGBAFormat, FloatType);
        noise.colorSpace = NoColorSpace; noise.minFilter = NearestFilter; noise.magFilter = NearestFilter; noise.needsUpdate = true; noises.push(noise);
        cascades.push({ band: bands[i], noise, spectrum: target(1), surface: [target(1, true, true), target(1, true, true)], current: 0 });
      }
      diagnostics.renderTargets = targets.length;
      diagnostics.estimatedTextureBytes = Math.ceil(resolution * resolution * (64 + 4 * (32 + 16 * 4 / 3)));
    }
  } catch (error) { fallback(`setup-failed:${error instanceof Error ? error.message : String(error)}`); }
  }
  setupGpu();
  function invalidatePublication(reason: string | null): void {
    generation++; uniforms.ready.value = 0; diagnostics.ready = false; validated.clear();
    needsClear = true; spectrumInitialized = false; lastWorkMilliseconds = null; lastFieldTimeSeconds = null; fieldDeltaSeconds = 0; clock.reset(); phase.value = 0; diagnostics.timeSeconds = 0;
    if (cascades.length || reason === 'context-lost') { diagnostics.backend = reason ? 'analytic-fallback' : 'pending-gpu'; diagnostics.reason = reason; }
  }
  function contextLost(): void {
    if (disposed || contextSuspended) return;
    contextSuspended = true; diagnostics.contextLosses++; invalidatePublication('context-lost');
  }
  function contextRestored(): void {
    if (disposed || gl?.isContextLost()) return;
    const wasLost = contextSuspended;
    if (!cascades.length) setupGpu();
    if (cascades.length && gl) {
      if (!renderer.extensions.has('EXT_color_buffer_float')) { contextSuspended = false; fallback('float-color-buffer-unavailable'); return; }
      contextSuspended = false; invalidatePublication(null);
      for (const noise of noises) noise.needsUpdate = true;
      if (wasLost) diagnostics.contextRestores++;
    }
  }
  const canvas = renderer.domElement;
  canvas?.addEventListener('webglcontextlost', contextLost);
  canvas?.addEventListener('webglcontextrestored', contextRestored);

  function bindTarget(destination: WebGLRenderTarget): void {
    // Target.viewport is already N physical texels. Logical setViewport here
    // would multiply by the village's render-scale/pixel ratio and crop the FFT.
    renderer.setRenderTarget(destination);
    if (!validated.has(destination)) {
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw Error('Open Water float framebuffer is incomplete.');
      validated.add(destination);
    }
  }
  function draw(pass: RawShaderMaterial, destination: WebGLRenderTarget): void {
    if (disposed || activeGeneration !== generation) throw Error('Open Water compute invalidated.');
    if (gl!.isContextLost()) { contextLost(); throw Error('Open Water context lost.'); }
    if (diagnostics.passes - updateStartPasses >= diagnostics.maxPassesPerUpdate) throw Error('Open Water compute pass budget exceeded.');
    bindTarget(destination);
    mesh!.material = pass; renderer.render(mesh!, camera!); diagnostics.passes++;
    if (gl!.isContextLost()) contextLost();
    if (disposed || activeGeneration !== generation) throw Error('Open Water compute invalidated.');
  }
  function setSpectrum(strength: number, angle: number, rain: number): void {
    parameters.wind = Math.max(.5, 2 + 10 * strength); parameters.direction = angle; parameters.scale = strength * strength;
    const stats = computeOpenWaterSpectrumStats(parameters, bands);
    const wind = spectrumMaterial!.uniforms.uWind.value as Vector4; wind.set(parameters.wind, parameters.fetch, angle, parameters.scale);
    for (const cascade of cascades) {
      const values = spectrumMaterial!.uniforms;
      values.uNoise.value = cascade.noise; values.uL.value = cascade.band.length;
      (values.uBand.value as Vector2).set(cascade.band.minimum, cascade.band.maximum);
      draw(spectrumMaterial!, cascade.spectrum);
    }
    uniforms.slopeVariance.value.set(stats.bandSlopeVariance); uniforms.windStrength.value = strength;
    diagnostics.significantHeightMetres = stats.significantHeight; diagnostics.resolvedSlopeVariance = stats.resolvedSlopeVariance;
    spectrumStrength = strength; spectrumDirection = angle; spectrumAtMilliseconds = lastWorkMilliseconds ?? 0; spectrumInitialized = true;
    diagnostics.spectrumUpdates++; diagnostics.spectrumBuilds++;
  }
  function run(strength: number, angle: number, rain: number): void {
    if (needsClear) {
      renderer.setClearColor(0, 0);
      for (const cascade of cascades) for (const output of cascade.surface) { bindTarget(output); renderer.clear(true, false, false); diagnostics.historyClears++; }
      needsClear = false;
    }
    const turn = Math.abs(Math.atan2(Math.sin(angle - spectrumDirection), Math.cos(angle - spectrumDirection)));
    if (!spectrumInitialized || (lastWorkMilliseconds ?? 0) - spectrumAtMilliseconds >= 2000 && (Math.abs(strength - spectrumStrength) > .04 || turn > .12)) setSpectrum(strength, angle, rain);
    phase.value = clock.timeSeconds % 1000;
    for (let i = 0; i < cascades.length; i++) {
      const cascade = cascades[i];
      evolveMaterial!.uniforms.uH0.value = cascade.spectrum.texture; evolveMaterial!.uniforms.uL.value = cascade.band.length;
      draw(evolveMaterial!, ping!);
      let source = ping!, destination = pong!;
      for (let axis = 0; axis < 2; axis++) for (let stage = 0; stage < Math.log2(resolution); stage++) {
        const values = fftMaterial!.uniforms; values.uIn0.value = source.textures[0]; values.uIn1.value = source.textures[1]; values.uStage.value = stage; values.uDir.value = axis;
        draw(fftMaterial!, destination); const swap = source; source = destination; destination = swap;
      }
      const sigma = .8 * Math.sqrt(Math.max(uniforms.slopeVariance.value[i], 1e-8)), values = assembleMaterial!.uniforms;
      values.uF0.value = source.textures[0]; values.uF1.value = source.textures[1]; values.uPrev.value = cascade.surface[cascade.current].texture;
      values.uDt.value = fieldDeltaSeconds; (values.uFoam.value as Vector3).set(1 - 1.2 * sigma, (.8 + rain * .3) / Math.max(sigma, .02), .3);
      (values.uDrift.value as Vector2).set(Math.cos(spectrumDirection) * parameters.wind * .02 / cascade.band.length, Math.sin(spectrumDirection) * parameters.wind * .02 / cascade.band.length);
      const next = 1 - cascade.current; draw(assembleMaterial!, cascade.surface[next]); cascade.current = next;
    }
    for (let i = 0; i < 4; i++) { const texture = cascades[i].surface[cascades[i].current].texture; textures[i] = texture; samplers[i].value = texture; }
    uniforms.ready.value = 1; diagnostics.ready = true; diagnostics.backend = 'gpu-fft'; diagnostics.reason = null; diagnostics.updates++; diagnostics.fieldUpdates++; lastFieldTimeSeconds = clock.timeSeconds;
  }
  function dispose(reason: string): void {
    if (disposed) return; disposed = true; generation++; options.signal?.removeEventListener('abort', abort);
    canvas?.removeEventListener('webglcontextlost', contextLost); canvas?.removeEventListener('webglcontextrestored', contextRestored);
    uniforms.ready.value = 0; for (let i = 0; i < 4; i++) { textures[i] = null; samplers[i].value = null; }
    if (running) releasePending = true; else { releaseGpu(); empty.dispose(); } diagnostics.disposed = true; diagnostics.ready = false; diagnostics.backend = 'disposed'; diagnostics.reason = reason;
  }
  const abort = () => dispose('aborted');
  const result: EaldholtOpenWater = { uniforms, diagnostics, textures,
    update(elapsedSeconds, animated, weather) {
      if (disposed || running || !gl) return;
      if (gl.isContextLost()) { contextLost(); return; }
      if (contextSuspended) contextRestored();
      if (diagnostics.backend === 'analytic-fallback' && !subviewFallback) return;
      const oldTarget = renderer.getRenderTarget(), oldFace = renderer.getActiveCubeFace(), oldMip = renderer.getActiveMipmapLevel();
      renderer.getViewport(viewport);
      if (typeof renderer.getCurrentViewport === 'function') renderer.getCurrentViewport(currentViewport); else currentViewport.copy(viewport);
      const ratio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
      logicalRounded.copy(viewport).multiplyScalar(ratio).round(); logicalFloored.copy(viewport).multiplyScalar(ratio).floor();
      const targetViewport = !!oldTarget?.viewport && currentViewport.equals(oldTarget.viewport);
      const logicalViewport = currentViewport.equals(logicalRounded) || currentViewport.equals(logicalFloored);
      if (!targetViewport && !logicalViewport) {
        // ArrayCamera/XR can leave a physical last-eye viewport which has no
        // public logical setter. Preserve every caller state and use animated
        // analytic water rather than corrupt Three's private current cache.
        if (!subviewFallback) diagnostics.subviewFallbacks++;
        subviewFallback = true; uniforms.ready.value = 0; diagnostics.ready = false;
        diagnostics.backend = 'analytic-fallback'; diagnostics.reason = 'array-camera/subview-analytic-fallback';
        clock.step(elapsedSeconds, false); return;
      }
      if (subviewFallback) { subviewFallback = false; diagnostics.backend = 'pending-gpu'; diagnostics.reason = null; }
      const clockDue = clock.step(elapsedSeconds, animated);
      if (!animated || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0
        || !clockDue && (lastFieldTimeSeconds === null || clock.timeSeconds <= lastFieldTimeSeconds)) return;
      const milliseconds = now();
      if (!Number.isFinite(milliseconds) || lastWorkMilliseconds !== null && milliseconds - lastWorkMilliseconds + 1e-7 < 1000 / rate) return;
      // Work admission follows monotonic real time, independently of a fast
      // observer's world-clock rate. Only source time drives spectral phase.
      lastWorkMilliseconds = milliseconds;
      fieldDeltaSeconds = lastFieldTimeSeconds === null ? 0 : Math.min(.25, Math.max(0, clock.timeSeconds - lastFieldTimeSeconds));
      diagnostics.timeSeconds = clock.timeSeconds;
      const x = weather?.wind[0] ?? 0, z = weather?.wind[1] ?? 0, length = Math.hypot(x, z);
      const strength = Number.isFinite(length) && length > 1e-6 ? clamp01(weather?.windStrength ?? 0) : 0;
      const angle = strength > 0 ? Math.atan2(z, x) : spectrumDirection, rain = clamp01(weather?.rain ?? 0);
      windDirection.set(Math.cos(angle), Math.sin(angle));
      renderer.getScissor(scissor); const oldScissorTest = renderer.getScissorTest();
      const box = oldTarget && typeof gl.SCISSOR_BOX === 'number' ? gl.getParameter(gl.SCISSOR_BOX) as ArrayLike<number> | null : null;
      if (box && box.length === 4) currentScissor.fromArray(box);
      else if (oldTarget?.scissor) currentScissor.copy(oldTarget.scissor); else currentScissor.copy(scissor);
      const actualScissorTest = oldTarget && typeof gl.isEnabled === 'function' ? gl.isEnabled(gl.SCISSOR_TEST) : oldTarget?.scissorTest ?? oldScissorTest;
      // setRenderTarget restores target-owned physical state. Explicit logical
      // overrides are the exception: reapply their unchanged global values.
      const viewportOverride = !!oldTarget?.viewport && !currentViewport.equals(oldTarget.viewport);
      const scissorOverride = !!oldTarget?.scissor && !currentScissor.equals(oldTarget.scissor);
      const scissorTestOverride = !!oldTarget && actualScissorTest !== oldTarget.scissorTest;
      renderer.getClearColor(clearColor); const oldAlpha = renderer.getClearAlpha(), oldAutoClear = renderer.autoClear, oldXr = renderer.xr.enabled, oldInfoReset = renderer.info.autoReset;
      const oldShaderCheck = renderer.debug.checkShaderErrors; previousShaderError = renderer.debug.onShaderError;
      let failure: string | null = null; running = true; activeGeneration = generation; updateStartPasses = diagnostics.passes;
      try { renderer.xr.enabled = false; renderer.autoClear = false; renderer.info.autoReset = false; renderer.debug.checkShaderErrors = true; renderer.debug.onShaderError = shaderError; run(strength, angle, rain); }
      catch (error) { failure = `gpu-render-failed:${error instanceof Error ? error.message : String(error)}`; }
      finally {
        try {
          renderer.setRenderTarget(oldTarget, oldFace, oldMip);
          if (viewportOverride) renderer.setViewport(viewport);
          if (scissorOverride) renderer.setScissor(scissor);
          if (scissorTestOverride) renderer.setScissorTest(oldScissorTest);
          renderer.setClearColor(clearColor, oldAlpha);
        } finally {
          renderer.autoClear = oldAutoClear; renderer.xr.enabled = oldXr; renderer.info.autoReset = oldInfoReset;
          renderer.debug.checkShaderErrors = oldShaderCheck; renderer.debug.onShaderError = previousShaderError; running = false;
          diagnostics.maxPassesObserved = Math.max(diagnostics.maxPassesObserved, diagnostics.passes - updateStartPasses);
          if (releasePending) { releaseGpu(); empty.dispose(); releasePending = false; }
        }
      }
      if (!disposed && activeGeneration === generation && failure) fallback(failure);
    },
    patchShader(shader, sourceFrame, profile) {
      if (disposed || diagnostics.backend === 'analytic-fallback' && !subviewFallback && !contextSuspended) return;
      patchEaldholtOpenWater(shader, uniforms, { ...sourceFrame, time: phase, metresPerWorldUnit, windDirection: direction, windStrength: uniforms.windStrength }, profile);
    },
    reset() { if (disposed) return; invalidatePublication(contextSuspended ? 'context-lost' : null); diagnostics.resets++; },
    dispose() { dispose('disposed'); },
  };
  if (options.signal?.aborted) dispose('aborted'); else options.signal?.addEventListener('abort', abort, { once: true });
  return result;
}
