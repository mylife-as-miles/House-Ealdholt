import {acquireWorldGeometryReader} from '../../../../shared/legacy/aethelgard/environment/world-geometry-readers';
import type {VoxelRegionSource} from '../../../../shared/legacy/aethelgard/environment/voxel-source-index';
/** Camera-local approximate GI owner. It neither owns the world clock nor
 * changes geometry, collision, navigation, residents or permanent game facts. */
import {DataTexture, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, RGBAFormat, ShaderChunk, Vector2, Vector3,
  type Camera, type Material, type Object3D, type Scene, type WebGLRenderer} from 'three';
import {centredVoxelGrid, type VoxelVolumeGrid} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import {patchVoxelMaterial, VOXEL_RADIANCE_VERSION} from '../../../../shared/legacy/aethelgard/environment/voxel-radiance-shaders';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {collectVoxelRegionSource} from './voxel-source';
import {createVoxelPreparationWorker} from './voxel-worker';
import {createVoxelRadiancePass, type VoxelGpuVolume, type VoxelLiveLight, type VoxelCloudField} from './voxel-radiance';
import type {WorldBakeCache} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';

export function createWorldVoxelGI(options: {
  sourceRoot: Object3D; renderer: WebGLRenderer; scene: Scene; camera: Camera; queue: WorldPreparationQueue;
  source?: Promise<{source:VoxelRegionSource;diagnostics:Awaited<ReturnType<typeof collectVoxelRegionSource>>['diagnostics']}>; signal: AbortSignal;
  active(): boolean; prepareEnabled(): boolean; preset(): 'low' | 'medium' | 'high'; native?: boolean;
  readSourceLighting(): VoxelLiveLight; readCloudField?(): VoxelCloudField | null; wake(): void; service(): void;
}) {
  options.signal.throwIfAborted();
  const stats = {status: 'waiting-source', error: '', sourceBytes: 0, sourceProxies: 0, sourceTerrain: 0, staticBuilds: 0, relights: 0,
    obsolete: 0, gpuBytes: 0, materials: 0, assignments: 0, retiredAssignments: 0, retiredMaterials: 0, assignmentBudgetHeld: false, materialProgramsPending: 0, materialBudgetFallbacks: 0, pending: false, sourceMaterialFallbacks: 0, nativeAmbientFallback: !!options.native,
    cache: null as WorldBakeCache['stats'] | null, restoredStaticVolumes: 0, lowAmbientFallback:false, indirectSteps:0, localLights:0, radianceEncoding:'sqrt-rgba8'};
  const supported = !options.native && 'fenceSync' in options.renderer.getContext() && !!options.source;
  if (!supported) {
    stats.status = options.native ? 'native-ambient-fallback' : 'backend-or-source-ambient-fallback';
    return {stats, sourceReady: options.source?.then(() => {}).catch(() => {}) ?? Promise.resolve(), update(_camera: Camera, _now: number) {}, dispose() {stats.status = 'disposed';}};
  }
  const root = options.sourceRoot, renderer = options.renderer, controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(); options.signal.addEventListener('abort', abort, {once: true});
  const worker = createVoxelPreparationWorker(signal, options.service), pass = createVoxelRadiancePass(renderer, options.queue);
  // No production UI/control change. This explicit development event only
  // clears derived environment bakes, never saved villages or imported assets.
  const clearCache = () => {void worker.clearCache().then(result => {stats.cache = result.cache; options.wake();}).catch(cause => {stats.error = String(cause);});};
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.addEventListener('crownfall:clear-environment-cache', clearCache);
  const dummy = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat); dummy.needsUpdate = true;
  const uniforms = {
    cfGiRadiance: {value: dummy as DataTexture | VoxelGpuVolume['radiance']}, cfGiSunVisibility: {value: dummy as DataTexture | VoxelGpuVolume['sunlight']},
    cfGiWorldToSource: {value: new Matrix4()}, cfGiMin: {value: new Vector3()}, cfGiSize: {value: new Vector3(4, 4, 4)},
    cfGiResolution: {value: new Vector3(4, 4, 4)}, cfGiAtlasSize: {value: new Vector2(16, 16)}, cfGiColumns: {value: 4},
    cfGiEnabled: {value: 0}, cfGiRadianceScale: {value: 8}, cfGiSunShadow: {value: 1}, cfGiSunWorldDirection: {value: new Vector3(0, 1, 0)},
  };
  const materials = new Map<Material, Map<string, {material: MeshStandardMaterial; ready: boolean}>>(), assignments: {mesh: Mesh; original: Material | Material[]; assigned: Material | Material[]}[] = [];
  const ownedMaterials = new Set<Material>(), ownerId = root.uuid;
  // L-16: each owned clone counts the live assignments using it and remembers
  // its original, so clones of retired cells are disposed and free the budget.
  const cloneUsers = new Map<Material, number>(), cloneSources = new Map<Material, {original: Material; variant: string}>();
  // L-17: meshes whose material was already settled skip the per-mesh variant
  // work; `seen` finds assignments whose mesh has left the model.
  const settled = new WeakMap<Mesh, Material | Material[]>(), seen = new Set<Mesh>();
  // L-27: lighting is read (and its signature built) at most every 250 ms, and
  // the grid identity is rebuilt only when the observer crosses a grid step.
  const HIGH_RESOLUTION: [number, number, number] = [64, 32, 64], HIGH_SIZE: [number, number, number] = [192, 64, 192];
  const RESOLUTION: [number, number, number] = [32, 16, 32], SIZE: [number, number, number] = [128, 64, 128];
  let lighting: VoxelLiveLight | null = null, cloud: VoxelCloudField | null = null, lightingAt = -Infinity, lightingSignature = '';
  let grid: VoxelVolumeGrid | null = null, gridKey = '', gridX = NaN, gridY = NaN, gridZ = NaN, gridHigh = false;
  const materialBudgetFallbacks = new WeakSet<Material>();
  let disposed = false, failed = false, sourceReady = false, active: VoxelGpuVolume | null = null, activeGrid = '', requestedGrid = '';
  let request: AbortController | null = null, requestSerial = 0, building = false, relighting = false, lastLight = '', lastRelightAt = -Infinity;
  let registryAt = -Infinity, ambientFallback=false, wakeTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new Vector3(), worldSun = new Vector3();
  function serviceLater() {if (!disposed && wakeTimer === null) wakeTimer = setTimeout(() => {wakeTimer = null; if (!disposed) options.service();}, 500);}
  function restore() {for (let i = assignments.length - 1; i >= 0; i--) {const a = assignments[i]; if (a.mesh.material === a.assigned) a.mesh.material = a.original;}}
  const priorShaderError = renderer.debug.onShaderError;
  const shaderError: NonNullable<WebGLRenderer['debug']['onShaderError']> = (gl, program, vertex, fragment) => {
    const code = gl.getShaderSource(fragment) ?? '';
    if (code.includes('cfGiRadiance')) {
      failed = true; stats.status = 'fallback-shader'; stats.error = (gl.getProgramInfoLog(program) ?? 'Unsupported voxel material program.').slice(0, 1200);
      uniforms.cfGiEnabled.value = 0; restore(); options.wake();
    }
    if (priorShaderError) priorShaderError(gl, program, vertex, fragment);
    else console.error('World shader compilation failed:', [gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n').slice(0,6000));
  };
  renderer.debug.onShaderError = shaderError;
  function adapt(original: Material, object: Mesh): Material {
    if (!(original instanceof MeshStandardMaterial) || original.userData.crownfallVoxelOwner === ownerId) return original;
    const variant = [object instanceof InstancedMesh, object instanceof InstancedMesh && object.instanceColor !== null, 'isSkinnedMesh' in object,
      Object.keys(object.geometry.attributes).sort(), Object.entries(object.geometry.morphAttributes).map(([k, v]) => [k, v.length])].join(':');
    const variants = materials.get(original), cached = variants?.get(variant); if (cached) return cached.ready ? cached.material : original;
    if (stats.materialProgramsPending >= 2) return original;
    if (ownedMaterials.size >= 512) {if (!materialBudgetFallbacks.has(original)) {materialBudgetFallbacks.add(original); stats.materialBudgetFallbacks++;} return original;}
    acquireWorldGeometryReader(object.geometry,()=>{
    const material = original.clone(), compile = original.onBeforeCompile, key = original.customProgramCacheKey;
    material.onBeforeRender = original.onBeforeRender;
    material.onBeforeCompile = function(shader, renderer) {compile.call(this, shader, renderer); patchVoxelMaterial(shader, uniforms, ShaderChunk.lights_fragment_begin);};
    material.customProgramCacheKey = () => key.call(original) + ':crownfall-voxel-gi:' + VOXEL_RADIANCE_VERSION;
    material.userData.crownfallVoxelOwner = ownerId; material.needsUpdate = true;
    const entry = {material, ready: false}, group = variants ?? new Map(); group.set(variant, entry); materials.set(original, group); cloneSources.set(material, {original, variant});
    ownedMaterials.add(material); stats.materials = ownedMaterials.size; stats.materialProgramsPending++;
    // Warm the exact static/instanced/skinned shader variant before binding it
    // to the real mesh. No source reparenting or source GPU disposal.
    const preview = new Group(), clone = object.clone(false); clone.material = material; clone.visible = true; clone.frustumCulled = false; preview.add(clone);
    const ready=options.queue.enqueue({bytes: 0, signal, priority: () => 125, work: () => renderer.compileAsync(preview, options.camera, options.scene)})
      .then(() => {if (!disposed && !failed) {entry.ready = true; registryAt = -Infinity; options.service();}})
      .catch(cause => {
        if (!disposed && !signal.aborted) {
          stats.error = cause instanceof Error ? cause.message : String(cause);
          if (/bounded job\/upload budget/.test(stats.error)) {group.delete(variant); ownedMaterials.delete(material); cloneSources.delete(material); material.dispose(); registryAt = -Infinity; serviceLater();}
        }
      })
      .finally(() => {stats.materialProgramsPending--; preview.clear(); if (clone instanceof InstancedMesh) clone.dispose();});
    return{ready,release(){}};});
    return original;
  }
  function useClones(assigned: Material | Material[], delta: number) {
    for (const material of Array.isArray(assigned) ? assigned : [assigned]) {
      if (!cloneSources.has(material)) continue;
      const users = (cloneUsers.get(material) ?? 0) + delta;
      if (users > 0) { cloneUsers.set(material, users); continue; }
      // No live mesh uses this clone: dispose it with its cache entry so the
      // 512-clone budget tracks the world in view, not every cell ever made.
      cloneUsers.delete(material); const source = cloneSources.get(material)!; cloneSources.delete(material);
      const group = materials.get(source.original); group?.delete(source.variant); if (group && !group.size) materials.delete(source.original);
      ownedMaterials.delete(material); stats.materials = ownedMaterials.size; stats.retiredMaterials++; material.dispose();
    }
  }
  function register() {
    let changed = false;
    seen.clear();
    root.traverse(node => {
      if (!(node instanceof Mesh)) return;
      seen.add(node);
      const original = node.material;
      if (settled.get(node) === original) return;
      const list = Array.isArray(original) ? original : [original];
      // Existing water/probe shaders retain their dedicated reflection path.
      if (list.some(m => m.userData.crownfallWaterLook || m.userData.crownfallRiver || /water/i.test(m.name))) {settled.set(node, original); return;}
      if (list.every(m => !(m instanceof MeshStandardMaterial) || m.userData.crownfallVoxelOwner === ownerId)) {settled.set(node, original); return;}
      if (assignments.length >= 50000) {stats.assignmentBudgetHeld = true; return;}
      const assigned = Array.isArray(original) ? original.map(material => adapt(material, node)) : adapt(original, node);
      if (Array.isArray(original) && Array.isArray(assigned) ? original.every((m, i) => m === assigned[i]) : original === assigned) return;
      node.material = assigned; assignments.push({mesh: node, original, assigned}); useClones(assigned, 1); changed = true;
      // Settle only a complete binding; a partly warmed group is revisited until every material is bound.
      if ((Array.isArray(assigned) ? assigned : [assigned]).every(m => !(m instanceof MeshStandardMaterial) || m.userData.crownfallVoxelOwner === ownerId)) settled.set(node, assigned);
    });
    // Assignments whose mesh left the model (retired cells) are released.
    let kept = 0;
    for (const a of assignments) {
      if (seen.has(a.mesh)) {assignments[kept++] = a; continue;}
      if (a.mesh.material === a.assigned) a.mesh.material = a.original;
      settled.delete(a.mesh); useClones(a.assigned, -1); stats.retiredAssignments++;
    }
    assignments.length = kept; seen.clear(); stats.assignments = kept; if (kept < 50000) stats.assignmentBudgetHeld = false;
    // A compiled clone that no mesh in the model took (its cell retired while compiling) is released too.
    if (!stats.assignmentBudgetHeld) for (const [clone, source] of cloneSources)
      if (!cloneUsers.has(clone) && materials.get(source.original)?.get(source.variant)?.ready) {cloneUsers.set(clone, 1); useClones(clone, -1);}
    if (changed && stats.materialProgramsPending === 0) options.wake();
  }
  const sourcePromise = options.source!.then(async result => {
    signal.throwIfAborted(); const ready = await worker.init(result.source); signal.throwIfAborted(); sourceReady = true;
    stats.sourceBytes = ready.bytes; stats.sourceMaterialFallbacks = result.diagnostics.materialFallbacks;
    stats.sourceProxies = result.source.proxies.length; stats.sourceTerrain = result.source.terrain.length; stats.status = 'waiting-entry'; options.service();
  }).catch(cause => {if (!disposed && !signal.aborted) {failed = true; stats.status = 'fallback-source'; stats.error = cause instanceof Error ? cause.message : String(cause);}});
  function bind(volume: VoxelGpuVolume) {
    uniforms.cfGiRadiance.value = volume.radiance; uniforms.cfGiSunVisibility.value = volume.sunlight;
    uniforms.cfGiMin.value.fromArray(volume.grid.min); uniforms.cfGiSize.value.fromArray(volume.grid.size); uniforms.cfGiResolution.value.fromArray(volume.grid.resolution);
    uniforms.cfGiAtlasSize.value.set(volume.atlas.width, volume.atlas.height); uniforms.cfGiColumns.value = volume.atlas.columns;
    uniforms.cfGiEnabled.value = 1; stats.gpuBytes = volume.stats.bytes;stats.indirectSteps=volume.stats.indirectSteps;stats.localLights=volume.stats.localLights; stats.status = 'ready';
  }
  async function replace(grid: VoxelVolumeGrid, gridKey: string, lighting: VoxelLiveLight, cloud: VoxelCloudField | null) {
    if (worker.pending >= 2 || disposed || !sourceReady) return;
    request?.abort(); const current = new AbortController(); request = current; const serial = ++requestSerial;
    requestedGrid = gridKey; building = true; stats.pending = true; stats.status = active ? 'recentering' : 'preparing';
    let candidate: VoxelGpuVolume | null = null;
    try {
      const prepared = await worker.volume(grid, current.signal); current.signal.throwIfAborted();
      stats.cache = prepared.cache; if (prepared.cacheHit) stats.restoredStaticVolumes++;
      candidate = await pass.prepare(prepared.volume, current.signal); await candidate.relight(lighting, cloud); current.signal.throwIfAborted();
      if (disposed || serial !== requestSerial || failed || options.preset()==='low') {stats.obsolete++; candidate.dispose(); return;}
      const old = active; active = candidate; candidate = null; activeGrid = gridKey; stats.staticBuilds++; stats.relights++;
      bind(active); old?.dispose(); options.wake();
    } catch (cause) {
      candidate?.dispose(); if (!disposed && !current.signal.aborted) {stats.error = cause instanceof Error ? cause.message : String(cause); stats.status = active ? 'ready-with-preparation-error' : 'ambient-fallback';}
    } finally {if (serial === requestSerial) {building = false; request = null; requestedGrid = ''; stats.pending = false;} options.service();}
  }
  return {
    stats, sourceReady: sourcePromise,
    update(camera: Camera, now: number) {
      try {
      if (disposed || failed || !supported) return;
      const preset = options.preset();
      if (!options.active()) {uniforms.cfGiEnabled.value = 0; stats.status = 'inactive'; return;}
      if(preset==='low'){
        // Low uses the existing sun/HDRI ambient path. Reducing the volume
        // alone does not bound the cost of compiling every source material.
        if(!ambientFallback){request?.abort();restore();for(const a of assignments)settled.delete(a.mesh);assignments.length=0;cloneUsers.clear();stats.assignments=0;/* warmed clones stay cached for a return to Medium */active?.dispose();active=null;activeGrid='';registryAt=-Infinity;uniforms.cfGiRadiance.value=dummy;uniforms.cfGiSunVisibility.value=dummy;ambientFallback=true;}
        uniforms.cfGiEnabled.value=0;stats.gpuBytes=0;stats.indirectSteps=0;stats.localLights=0;stats.lowAmbientFallback=true;stats.status='low-ambient-fallback';return;
      }
      ambientFallback=false;stats.lowAmbientFallback=false;
      if (!sourceReady) return;
      if (!active && !options.prepareEnabled()) {stats.status = 'waiting-foundations'; serviceLater(); return;}
      root.updateWorldMatrix(true, false); uniforms.cfGiWorldToSource.value.copy(root.matrixWorld).invert();
      if (!lighting || now - lightingAt >= 250) {
        lighting = options.readSourceLighting(); cloud = options.readCloudField?.() ?? null; lightingAt = now;
        lightingSignature = JSON.stringify({lighting, cloud: cloud ? [cloud.revision, cloud.enabled, cloud.coverage, cloud.globalTransmission, cloud.offset, cloud.sunDirection, cloud.sourceToWorld] : null}, (_key, value) => typeof value === 'number' ? Math.round(value * 1000) / 1000 : value);
      }
      worldSun.fromArray(lighting.sunDirection).transformDirection(root.matrixWorld); uniforms.cfGiSunWorldDirection.value.copy(worldSun);
      if (now - registryAt >= 1000) {register(); registryAt = now;}
      camera.getWorldPosition(observer).applyMatrix4(uniforms.cfGiWorldToSource.value);
      uniforms.cfGiSunShadow.value = preset === 'medium' ? .85 : 1;
      const high = preset === 'high', size = high ? HIGH_SIZE : SIZE;
      const cellX = Math.floor(observer.x / (size[0] / 4)), cellY = Math.floor(observer.y / (size[1] / 4)), cellZ = Math.floor(observer.z / (size[2] / 4));
      if (!grid || cellX !== gridX || cellY !== gridY || cellZ !== gridZ || high !== gridHigh) {
        grid = centredVoxelGrid([observer.x, observer.y, observer.z], high ? HIGH_RESOLUTION : RESOLUTION, size);
        gridKey = JSON.stringify(grid); gridX = cellX; gridY = cellY; gridZ = cellZ; gridHigh = high;
      }
      if (building && gridKey !== requestedGrid) {request?.abort(); stats.obsolete++;}
      if (!building && gridKey !== activeGrid && options.prepareEnabled()) void replace(grid, gridKey, lighting, cloud);
      if (active && activeGrid === gridKey) {
        bind(active);
        const signature = lightingSignature, light = lighting, field = cloud;
        if (!relighting && signature !== lastLight && now - lastRelightAt >= 500 && options.prepareEnabled()) {
          relighting = true; lastRelightAt = now; const volume = active;
          void volume.relight(light, field).then(() => {if (!disposed && active === volume && !failed && options.preset()!=='low') {lastLight = signature; stats.relights++; bind(volume); options.wake();}})
            .catch(cause => {if (!disposed && active === volume) stats.error = cause instanceof Error ? cause.message : String(cause);})
            .finally(() => {relighting = false; serviceLater();});
        }
      }
      serviceLater();
      } catch (cause) {
        failed = true; uniforms.cfGiEnabled.value = 0; request?.abort(); restore();
        stats.status = 'ambient-fallback'; stats.error = cause instanceof Error ? cause.message : String(cause); options.wake();
      }
    },
    dispose() {
      if (disposed) return; disposed = true; controller.abort(); options.signal.removeEventListener('abort', abort); request?.abort(); request = null;
      if (import.meta.env?.DEV && typeof window !== 'undefined') window.removeEventListener('crownfall:clear-environment-cache', clearCache);
      if (wakeTimer !== null) clearTimeout(wakeTimer); uniforms.cfGiEnabled.value = 0; restore();
      if (renderer.debug.onShaderError === shaderError) renderer.debug.onShaderError = priorShaderError;
      active?.dispose(); active = null; worker.dispose(); pass.dispose();
      void options.queue.whenIdle().then(() => {for (const material of ownedMaterials) material.dispose(); dummy.dispose(); assignments.length = 0; materials.clear(); ownedMaterials.clear();});
      stats.status = 'disposed';
    },
  };
}
export type WorldVoxelGI = ReturnType<typeof createWorldVoxelGI>;
