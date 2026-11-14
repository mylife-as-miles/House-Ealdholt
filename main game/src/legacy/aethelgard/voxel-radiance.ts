import {Color, Data3DTexture, DataTexture, LinearFilter, Matrix4, Mesh, NearestFilter, NoToneMapping, OrthographicCamera, PlaneGeometry, RGBAFormat, RGFormat, Scene,
  ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget, type Texture, type WebGLRenderer} from 'three';
import {packVoxelAtlas, type StaticVoxelVolume} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import {VOXEL_PASS_VERTEX, VOXEL_SOURCE_FRAGMENT, VOXEL_GATHER_FRAGMENT, VOXEL_BOUNCE_FRAGMENT} from '../../../../shared/legacy/aethelgard/environment/voxel-radiance-shaders';
import {VOXEL_INDIRECT_STEPS,VOXEL_RADIANCE_ATLAS_UNITS,VOXEL_RADIANCE_VOLUME_BUDGET,VOXEL_RADIANCE_OWNER_BUDGET} from '../../../../shared/legacy/aethelgard/environment/voxel-indirect';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

/** Live source-metre lighting only; changing these values never rebuilds static occupancy. */
export interface VoxelLiveLight {
  readonly sunDirection: readonly [number, number, number];
  readonly sunRadiance: readonly [number, number, number]; readonly skyRadiance: readonly [number, number, number];
  readonly cloudTransmission: number;
  readonly local: readonly {position: readonly [number, number, number]; radius: number; radiance: readonly [number, number, number]}[];
}
/** A borrowed static cloud texture plus a snapshot of its live weather. This
 * pass owns neither the texture nor its cache; it only samples it while relighting. */
export interface VoxelCloudField {
  readonly texture: Texture; readonly revision: string; readonly coverage: number; readonly globalTransmission: number;
  readonly offset: readonly [number, number]; readonly enabled: boolean;
  readonly sourceToWorld: readonly number[]; readonly sunDirection: readonly [number, number, number];
}
/** GPU live relighting is separate from immutable occupancy/transport. The
 * previous complete pair remains sampleable until injection, both indirect reflection steps and final gather complete. */
export function createVoxelRadiancePass(renderer: WebGLRenderer, queue: WorldPreparationQueue) {
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 10), plane = new PlaneGeometry(2, 2);
  camera.position.z = 1;
  const emptyCloud = new Data3DTexture(new Uint8Array([0, 0]), 1, 1, 1);
  emptyCloud.format = RGFormat; emptyCloud.type = UnsignedByteType;
  emptyCloud.minFilter = emptyCloud.magFilter = LinearFilter; emptyCloud.unpackAlignment = 1; emptyCloud.needsUpdate = true;
  const uniforms = {
    cfOccupancy: {value: null as Texture | null}, cfTransport: {value: null as Texture | null}, cfSourceRadiance: {value: null as Texture | null}, cfBounceSeed: {value: null as Texture | null},
    cfResolution: {value: new Vector3(4, 4, 4)}, cfGridMin: {value: new Vector3()}, cfGridSize: {value: new Vector3(4, 4, 4)},
    cfAtlasSize: {value: new Vector2(16, 16)}, cfColumns: {value: 4}, cfRadianceScale: {value: 8}, cfSunDirection: {value: new Vector3(0, 1, 0)},
    cfSunRadiance: {value: new Vector3()}, cfSkyRadiance: {value: new Vector3()}, cfCloudTransmission: {value: 1},
    cfCloudDensity: {value: emptyCloud as Texture}, cfCloudCoverage: {value: 0}, cfCloudGlobalTransmission: {value: 1}, cfCloudLightingEnabled: {value: 0}, cfCloudOffset: {value: new Vector2()},
    cfCloudSourceToWorld: {value: new Matrix4()}, cfWorldSun: {value: new Vector3(0, 1, 0)}, cfSurfaceWeatherEnabled: {value: 0}, cfEnvironmentSeconds: {value: 0},
    cfLocalPositionRadius: {value: Array.from({length: 16}, () => new Vector4())},
    cfLocalRadiance: {value: Array.from({length: 16}, () => new Vector3())}, cfLocalCount: {value: 0},
  };
  const sourceMaterial = new ShaderMaterial({uniforms, vertexShader: VOXEL_PASS_VERTEX, fragmentShader: VOXEL_SOURCE_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false});
  const bounceMaterial = new ShaderMaterial({uniforms, vertexShader: VOXEL_PASS_VERTEX, fragmentShader: VOXEL_BOUNCE_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false});
  const gatherMaterial = new ShaderMaterial({uniforms, vertexShader: VOXEL_PASS_VERTEX, fragmentShader: VOXEL_GATHER_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false});
  const draw = new Mesh(plane, sourceMaterial); draw.frustumCulled = false; scene.add(draw);
  let allocatedBytes=0;
  let disposed = false, compiled: Promise<void> | null = null;
  const owners = new Set<{dispose(): void}>();
  const colour = new Color(), viewport = new Vector4(), scissor = new Vector4();
  function render(material: ShaderMaterial, target: WebGLRenderTarget) {
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    renderer.getClearColor(colour); renderer.getViewport(viewport); renderer.getScissor(scissor);
    const alpha = renderer.getClearAlpha(), test = renderer.getScissorTest(), xr = renderer.xr.enabled,
      shadows = renderer.shadowMap.enabled, tone = renderer.toneMapping, auto = renderer.autoClear;
    try {
      renderer.xr.enabled = false; renderer.shadowMap.enabled = false; renderer.toneMapping = NoToneMapping; renderer.autoClear = true;
      renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setClearColor(0, 0);
      draw.material = material; renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previous, face, mip); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(test);
      renderer.setClearColor(colour, alpha); renderer.xr.enabled = xr; renderer.shadowMap.enabled = shadows; renderer.toneMapping = tone; renderer.autoClear = auto;
    }
  }
  function compile(signal: AbortSignal) {
    return compiled ??= (async () => {
      for (const material of [sourceMaterial, bounceMaterial, gatherMaterial]) await queue.enqueue({bytes: 0, signal, priority: () => 120,
        work: () => {draw.material = material; return renderer.compileAsync(scene, camera);}});
    })().catch(cause => {compiled = null; throw cause;});
  }
  return {
    async prepare(volume: StaticVoxelVolume, signal: AbortSignal) {
      if (disposed || signal.aborted) throw Error('Voxel radiance owner retired.');
      const occupancy = packVoxelAtlas(volume.albedoOpacity, volume.grid), transport = packVoxelAtlas(volume.transport, volume.grid);
      if (occupancy.width > renderer.capabilities.maxTextureSize || occupancy.height > renderer.capabilities.maxTextureSize) throw Error('Voxel slice atlas exceeds this graphics backend.');
      const bytes=occupancy.pixels.byteLength*VOXEL_RADIANCE_ATLAS_UNITS;
      if(bytes>VOXEL_RADIANCE_VOLUME_BUDGET||allocatedBytes+bytes>VOXEL_RADIANCE_OWNER_BUDGET)throw Error('Bounded voxel radiance memory budget exceeded.');
      allocatedBytes+=bytes;
      const controller = new AbortController(), abort = () => controller.abort(), textures: DataTexture[] = [], targets: WebGLRenderTarget[] = [];
      signal.addEventListener('abort', abort, {once: true});
      let dead = false, active = 0, relighting = false, chain = Promise.resolve();
      const initializedTargets = new Set<number>();
      const stats = {relights: 0, failures: 0, bytes, ready: false, indirectSteps:VOXEL_INDIRECT_STEPS, transportPasses:VOXEL_INDIRECT_STEPS+1, localLights:0, encoding:'sqrt-rgba8', localOcclusion:'fractional-128-cell-ray'};
      const owner = {dispose() {
        if (dead) return; dead = true; stats.ready=false; controller.abort(); signal.removeEventListener('abort', abort); owners.delete(owner);
        // Compilation owns the shared scene/materials until the queue is idle.
        void queue.whenIdle().then(() => {for (const t of textures) t.dispose(); for (const t of targets) t.dispose();allocatedBytes-=bytes;});
      }}; owners.add(owner);
      try {
        for (const atlas of [occupancy, transport]) {
          const texture = new DataTexture(atlas.pixels, atlas.width, atlas.height, RGBAFormat, UnsignedByteType);
          texture.minFilter = texture.magFilter = NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true; textures.push(texture);
          await queue.enqueue({bytes: atlas.pixels.byteLength, signal: controller.signal, priority: () => 120, work: () => renderer.initTexture(texture)});
        }
        for (let i = 0; i < 6; i++) targets.push(new WebGLRenderTarget(occupancy.width, occupancy.height,
          {format: RGBAFormat, type: UnsignedByteType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false, stencilBuffer: false}));
        await compile(controller.signal); controller.signal.throwIfAborted();
        return {
          stats, grid: volume.grid, atlas: {width: occupancy.width, height: occupancy.height, columns: occupancy.columns},
          get radiance() {return targets[active * 2 + 1].texture;},
          get sunlight() {return targets[active * 2].texture;},
          relight(light: VoxelLiveLight, cloud?: VoxelCloudField | null) {
            if (relighting) return Promise.reject(Error('Voxel relight already pending; coalesce the newest world lighting.'));
            if (dead || disposed || light.local.length > 16 || !Number.isFinite(light.cloudTransmission) || light.cloudTransmission < 0 || light.cloudTransmission > 1
              || [light.sunDirection, light.sunRadiance, light.skyRadiance].some(a => a.length !== 3 || !a.every(Number.isFinite))
              || light.sunRadiance.some(n => n < 0 || n > 32) || light.skyRadiance.some(n => n < 0 || n > 32) || Math.hypot(...light.sunDirection) < .00001
              || light.local.some(l => l.position.length !== 3 || !l.position.every(Number.isFinite) || !Number.isFinite(l.radius) || l.radius <= 0 || l.radius > 1024 || l.radiance.length !== 3 || l.radiance.some(n => !Number.isFinite(n) || n < 0 || n > 32))) return Promise.reject(Error('Invalid bounded voxel live lighting.'));
            if (cloud && (typeof cloud.enabled !== 'boolean' || !cloud.texture?.isTexture || !cloud.revision || cloud.revision.length > 256
              || !Number.isFinite(cloud.coverage) || cloud.coverage < 0 || cloud.coverage > 1 || !Number.isFinite(cloud.globalTransmission) || cloud.globalTransmission <= 0 || cloud.globalTransmission > 1 || cloud.offset.length !== 2 || !cloud.offset.every(Number.isFinite)
              || cloud.sourceToWorld.length !== 16 || !cloud.sourceToWorld.every(Number.isFinite) || cloud.sunDirection.length !== 3 || !cloud.sunDirection.every(Number.isFinite) || Math.hypot(...cloud.sunDirection) < .00001)) return Promise.reject(Error('Invalid bounded voxel cloud field.'));
            const cloudInput: VoxelCloudField | null = cloud ? {texture: cloud.texture, revision: cloud.revision, coverage: cloud.coverage, globalTransmission: cloud.globalTransmission, offset: [...cloud.offset], enabled: cloud.enabled, sourceToWorld: [...cloud.sourceToWorld], sunDirection: [...cloud.sunDirection]} : null;
            // Own a stable request snapshot across the asynchronous upload queue.
            const input: VoxelLiveLight = {sunDirection: [...light.sunDirection], sunRadiance: [...light.sunRadiance], skyRadiance: [...light.skyRadiance],
              cloudTransmission: light.cloudTransmission, local: light.local.map(l => ({position: [...l.position], radius: l.radius, radiance: [...l.radiance]}))};
            relighting = true;
            const next = chain.then(async () => {
              controller.signal.throwIfAborted(); const pending = active === 0 ? 1 : 0;
              const apply = (readIndex:number) => {
                uniforms.cfOccupancy.value = textures[0]; uniforms.cfTransport.value = textures[1]; uniforms.cfSourceRadiance.value = readIndex<0?textures[0]:targets[readIndex].texture; uniforms.cfBounceSeed.value = readIndex<0?textures[0]:targets[pending*2].texture;
                uniforms.cfResolution.value.fromArray(volume.grid.resolution); uniforms.cfGridMin.value.fromArray(volume.grid.min); uniforms.cfGridSize.value.fromArray(volume.grid.size);
                uniforms.cfAtlasSize.value.set(occupancy.width, occupancy.height); uniforms.cfColumns.value = occupancy.columns;
                uniforms.cfSunDirection.value.fromArray(input.sunDirection).normalize(); uniforms.cfSunRadiance.value.fromArray(input.sunRadiance);
                uniforms.cfSkyRadiance.value.fromArray(input.skyRadiance); uniforms.cfCloudTransmission.value = input.cloudTransmission; uniforms.cfLocalCount.value = input.local.length;
                uniforms.cfCloudDensity.value = cloudInput?.enabled ? cloudInput.texture : emptyCloud;
                uniforms.cfCloudCoverage.value = cloudInput?.coverage ?? 0; uniforms.cfCloudGlobalTransmission.value = cloudInput?.globalTransmission ?? 1; uniforms.cfCloudLightingEnabled.value = cloudInput?.enabled ? 1 : 0; uniforms.cfCloudOffset.value.fromArray(cloudInput?.offset ?? [0, 0]);
                uniforms.cfCloudSourceToWorld.value.fromArray(cloudInput?.sourceToWorld ?? [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
                uniforms.cfWorldSun.value.fromArray(cloudInput?.sunDirection ?? input.sunDirection).normalize(); uniforms.cfSurfaceWeatherEnabled.value = cloudInput?.enabled ? 1 : 0;
                for (let i = 0; i < input.local.length; i++) {const l = input.local[i]; uniforms.cfLocalPositionRadius.value[i].set(...l.position, l.radius); uniforms.cfLocalRadiance.value[i].fromArray(l.radiance);}
              };
              const stages=[{material:sourceMaterial,target:pending*2,read:-1}];
              for(let step=0;step<VOXEL_INDIRECT_STEPS;step++)stages.push({material:bounceMaterial,target:4+step%2,read:step===0?pending*2:4+(step-1)%2});
              stages.push({material:gatherMaterial,target:pending*2+1,read:4+(VOXEL_INDIRECT_STEPS-1)%2});
              for(const stage of stages)await queue.enqueue({bytes:initializedTargets.has(stage.target)?0:occupancy.pixels.byteLength,signal:controller.signal,priority:()=>130,
                work(){apply(stage.read);render(stage.material,targets[stage.target]);initializedTargets.add(stage.target);
                  const gl=renderer.getContext(),error=gl.getError();if(error!==gl.NO_ERROR)throw Error('Voxel radiance GPU validation failed: '+error);
                }});
              controller.signal.throwIfAborted(); active = pending; stats.ready = true; stats.relights++;stats.localLights=input.local.length;
            });
            chain = next.catch(() => {stats.failures++;}).finally(() => {relighting = false;}); return next;
          },
          dispose: owner.dispose,
        };
      } catch (cause) {owner.dispose(); throw cause;}
    },
    dispose() {
      if (disposed) return; disposed = true; for (const owner of [...owners]) owner.dispose();
      void queue.whenIdle().then(() => {plane.dispose(); sourceMaterial.dispose(); bounceMaterial.dispose(); gatherMaterial.dispose(); emptyCloud.dispose(); scene.clear();});
    },
  };
}
export type VoxelRadiancePass = ReturnType<typeof createVoxelRadiancePass>;
export type VoxelGpuVolume = Awaited<ReturnType<VoxelRadiancePass['prepare']>>;
