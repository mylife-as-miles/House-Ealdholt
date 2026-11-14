import {FOREST01_DENSITY_LOD,densityWoodPart,matchesForest01DensityInput,matchesForest01DensityPacked,validPackedVegetationResult} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import {VEGETATION_BRANCH_L2} from '../../../../shared/legacy/aethelgard/environment/vegetation-branch-l2';
/** One renderer owns derived source resources; cells hold leases, not copies of
 * captured atlases. Persistent CPU captures and live GPU residency have
 * independent budgets and lifetimes. */
import {Box3, BufferAttribute, BufferGeometry, DataTexture, Group, InstancedMesh, InterleavedBufferAttribute, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Mesh, MeshStandardMaterial, RGBAFormat, Sphere, Vector3,
  type Camera, type Material, type Scene, type WebGLRenderer} from 'three';
import {uploadWorldGeometry} from './world-buffer-upload';
import {createVegetationResourcePool} from '../../../../shared/legacy/aethelgard/environment/vegetation-resource-pool';
import {vegetationAtlasByteLength, type VegetationAtlasRecord} from '../../../../shared/legacy/aethelgard/environment/vegetation-atlas';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {captureVegetationAtlas, type VegetationCapturePart} from './vegetation-atlas-capture';
import {createVegetationBakeIdentity} from './vegetation-bake-identity';
import {createWorldBakeCache, worldBakeKey} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';
import {createIndexedWorldBakeStore} from '../../../../shared/legacy/aethelgard/environment/world-bake-idb';
import {decodeVegetationBake, encodeVegetationBake, VEGETATION_CAPTURE_VERSION} from '../../../../shared/legacy/aethelgard/environment/vegetation-bake';

/** Derived geometry only; source art, captures and actor frames are unchanged. */
export type VegetationGeometryDetail = 'l1' | 'l2-branches' | 'forest01-density';
interface OwnerBufferReservation {bytes:number;dispose():void}
interface Indices {bytes: number; indices: Uint32Array; dispose(): void}
interface GeometryResource {bytes: number; geometry: BufferGeometry; sourceTriangles: number; triangles: number; error: number; densityProof?: 0|1|2; dispose(): void}
interface GeometryLease {ready:Promise<GeometryResource>;release():void;releaseUnsubmitted?():void}
interface Compilation {bytes: number; dispose(): void}
interface SharedMaterial {bytes: number; material: MeshStandardMaterial; dispose(): void}
export interface PreparedVegetationAtlas {
  bytes: number; record: VegetationAtlasRecord; maps: readonly [DataTexture, DataTexture]; dispose(): void;
}
export function vegetationPrototypeKey(parts: readonly VegetationCapturePart[]): string {
  return parts.map(part => [part.geometry.uuid, part.geometry.index?.version ?? 0,
    ...Object.entries(part.geometry.attributes).map(([name, value]) => name + ':' + (value instanceof InterleavedBufferAttribute ? value.data.version : value.version)),
    part.material.uuid, part.material.version,
    // Inverting two identical authored actor frames can leave ~1e-14 noise.
    // Quantize far below the validated 0.1mm component-frame tolerance.
    ...part.frame.elements.map(value => Math.round(value * 1e7) / 1e7), part.foliage].join(':')).join('|');
}
export interface VegetationPersistentIdentity {worldRegion:string;sourceSha256:string;backend:string}
export function createVegetationPrototypeResources(renderer: WebGLRenderer, queue: WorldPreparationQueue,
  worker: VegetationPreparationWorker, maximumBytes: number,
  persistent?: VegetationPersistentIdentity, capturePersistentIdentity?:(parts:readonly VegetationCapturePart[])=>VegetationPersistentIdentity|undefined) {
  const pool = createVegetationResourcePool<Indices | PreparedVegetationAtlas | GeometryResource | Compilation | SharedMaterial | OwnerBufferReservation>(maximumBytes, 256);
  const bakeCache = persistent && /^[a-f0-9]{64}$/.test(persistent.sourceSha256) ? createWorldBakeCache({store: createIndexedWorldBakeStore()}) : null;
  const captureIdentity = createVegetationBakeIdentity(), stats = Object.assign(pool.stats, {persistent: bakeCache?.stats ?? null});
  const clearCache = () => {void bakeCache?.clear();};
  if (bakeCache && import.meta.env?.DEV && typeof window !== 'undefined') window.addEventListener('crownfall:clear-environment-cache', clearCache);
  return {
    stats,
    ownerBuffers(key:string,bytes:number){
      if(!Number.isSafeInteger(bytes)||bytes<1||bytes>65536)throw Error('Invalid owned vegetation buffer reservation.');
      const lease=pool.acquire('owner-buffers:v1:'+key,bytes,async()=>({bytes,dispose(){}}));
      return{ready:lease.ready as Promise<OwnerBufferReservation>,release:lease.release};
    },
    material(key: string, build: () => MeshStandardMaterial) {
      const lease = pool.acquire('material:v1:' + key, 1024, async () => {
        const material = build(); return {bytes: 1024, material, dispose() {material.dispose();}};
      });
      return {ready: lease.ready as Promise<SharedMaterial>, release: lease.release};
    },
    compile(key: string, draws: readonly Mesh[], camera: Camera, scene: Scene) {
      const lease = pool.acquire('compile:v1:' + key, 1, async signal => {
        const preview = new Group(), materials: Material[] = [];
        const meshes = draws.map(draw => {
          if (Array.isArray(draw.material)) throw Error('Prototype compilation requires qualified single-material draws.');
          const material = draw.material.clone(); material.onBeforeCompile = draw.material.onBeforeCompile;
          material.customProgramCacheKey = draw.material.customProgramCacheKey;
          materials.push(material); const mesh = draw instanceof InstancedMesh ? new InstancedMesh(draw.geometry, material, 1) : new Mesh(draw.geometry, material); preview.add(mesh); return mesh;
        });
        const dispose = () => {preview.clear(); for (const mesh of meshes) if (mesh instanceof InstancedMesh) mesh.dispose(); for (const material of materials) material.dispose();};
        try {
          await queue.enqueue({bytes: 0, signal, priority: () => 80, work: () => renderer.compileAsync(preview, camera, scene)});
          // Keep an owned material reference so eviction of the first source
          // cell cannot silently invalidate another cell's precompiled program.
          return {bytes: 0, dispose};
        } catch (cause) {dispose(); throw cause;}
      });
      return {ready: lease.ready as Promise<Compilation>, release: lease.release};
    },
    indices(key: string, input: Parameters<VegetationPreparationWorker['simplify']>[0]) {
      const lease = pool.acquire('indices:v1:' + key + ':' + JSON.stringify([input.ratio, input.error, input.foliage, input.attributeWeights]), input.indices.byteLength, async signal => {
        const result = await worker.simplify(input); signal.throwIfAborted();
        return {bytes: result.indices.byteLength, indices: result.indices, dispose() {}};
      });
      return {ready: lease.ready as Promise<Indices>, release: lease.release};
    },
    geometry(part: VegetationCapturePart, detail: VegetationGeometryDetail = 'l1'):GeometryLease {
      if (detail === 'l2-branches' && part.foliage) throw Error('L2 branch derivatives require nonfoliage source geometry.');
      const density=detail==='forest01-density';if(density&&!part.foliage)throw Error('Whole-leaf density requires the qualified foliage source.');
      const branch = detail === 'l2-branches', ratio = branch ? VEGETATION_BRANCH_L2.ratio : part.foliage ? .6 : .35, error = branch ? VEGETATION_BRANCH_L2.error : part.foliage ? .008 : .015;
      const source = part.geometry, position = source.getAttribute('position');
      const bytes = Object.values(source.attributes).reduce((sum, a) => sum + position.count * a.itemSize * 4, (source.index?.count ?? position.count) * 4);
      const lease = pool.acquire((density ? 'geometry:'+FOREST01_DENSITY_LOD.version+':'+FOREST01_DENSITY_LOD.sourceSha256+':'+FOREST01_DENSITY_LOD.selectionSha256+':' : branch ? 'geometry:' + VEGETATION_BRANCH_L2.version + ':' + ratio + ':' + error + ':' : 'geometry:v1:') + vegetationPrototypeKey([part]), bytes, async signal => {
        const entries = Object.entries(source.attributes).filter(([name]) => name !== 'position');
        const stride = entries.reduce((sum, [, a]) => sum + a.itemSize, 0), positions = new Float32Array(position.count * 3), attributes = new Float32Array(position.count * stride);
        for (let start = 0; start < position.count; start += 8192) {
          signal.throwIfAborted();
          for (let i = start; i < Math.min(position.count, start + 8192); i++) {
            for (let c = 0; c < 3; c++) positions[i * 3 + c] = position.getComponent(i, c);
            let offset = i * stride; for (const [, a] of entries) for (let c = 0; c < a.itemSize; c++) attributes[offset++] = a.getComponent(i, c);
          }
          if (start + 8192 < position.count) await new Promise(resolve => setTimeout(resolve, 0));
        }
        const input = source.index ? Uint32Array.from(source.index.array) : Uint32Array.from({length: position.count}, (_, i) => i);
        const sourceTriangles = input.length / 3;
        const packedInput={positions,attributes,indices:input,stride,foliage:part.foliage,
          channels:entries.map(([name,a])=>({name,size:a.itemSize})),attributeWeights:entries.flatMap(([name,a])=>Array<number>(a.itemSize).fill(name==='normal'?.1:name==='tangent'?.01:.2)),ratio,error,
          ...(density?{profile:FOREST01_DENSITY_LOD.version}:{})};
        const possibleWood=!branch&&!part.foliage?densityWoodPart(position.count,sourceTriangles):null;
        const woodSource=possibleWood!==null&&await matchesForest01DensityInput(packedInput,possibleWood).catch(()=>false);
        const result=await worker.packed(packedInput);
        if(!validPackedVegetationResult(result,sourceTriangles))throw Error('Invalid or inflated derived vegetation worker result.');
        const densityProof:0|1|2|undefined=density?(await matchesForest01DensityPacked(result,2)?2:undefined):woodSource&&possibleWood!==null&&await matchesForest01DensityPacked(result,possibleWood).catch(()=>false)?possibleWood:undefined;
        if(density&&densityProof!==2)throw Error('Whole-leaf worker output differs from its source-bound selection.');
        if (branch && (!Number.isFinite(result.error) || result.error < 0 || result.error > error + 1e-7)) throw Error('L2 branch derivative exceeded its error budget.');
        signal.throwIfAborted();
        const geometry = new BufferGeometry();
        try {
          geometry.setAttribute('position', new BufferAttribute(result.positions, 3));
          for (const a of result.attributes) geometry.setAttribute(a.name, new BufferAttribute(a.values, a.size));
          geometry.setIndex(new BufferAttribute(result.indices, 1));
          geometry.boundingBox = new Box3(new Vector3().fromArray(result.bounds), new Vector3().fromArray(result.bounds, 3));
          geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
          const gpu = await uploadWorldGeometry(geometry, renderer, queue, signal, () => 60);
          return {bytes: gpu.bytes, geometry: gpu.geometry, sourceTriangles, triangles: result.indices.length / 3, error: result.error, densityProof, dispose: gpu.dispose};
        } finally {geometry.dispose();}
      });
      // Only a ready derivative rejected before any draw/compile may bypass a scope's retirement fence.
      return {ready: lease.ready as Promise<GeometryResource>, release: lease.release, releaseUnsubmitted: lease.release};
    },
    atlas(parts: readonly VegetationCapturePart[], tileSize: 64 | 128, views: 8 | 16, canopyOnly = false, topDown = false, capturePriority = 90) {
      const persistentSource=capturePersistentIdentity?.(parts)??persistent;
      const bytes = vegetationAtlasByteLength(tileSize, views);
      const key = 'atlas:v2:' + tileSize + ':' + views + ':' + canopyOnly + ':' + topDown + ':' + vegetationPrototypeKey(parts);
      const lease = pool.acquire(key, Math.ceil(bytes), async signal => {
        let record: VegetationAtlasRecord | null = null, bakeKey: string | null = null;
        const epoch = bakeCache?.generation;
        if (bakeCache && persistentSource) {
          try {
            bakeKey = await worldBakeKey('vegetation-atlas', JSON.stringify([persistentSource, VEGETATION_CAPTURE_VERSION, tileSize, views, canopyOnly, topDown, await captureIdentity(parts)]));
            signal.throwIfAborted();
            const cached = await bakeCache.get(bakeKey, blob => !!decodeVegetationBake(blob, tileSize, views), signal);
            if (cached) record = decodeVegetationBake(cached, tileSize, views);
          } catch (cause) {bakeCache.stats.warning = cause instanceof Error ? cause.message : String(cause);}
        }
        signal.throwIfAborted();
        if (!record) {
          record = await captureVegetationAtlas({renderer, parts, tileSize, views, canopyOnly, topDown, queue, worker,
            signal, priority: () => capturePriority});
          if (bakeKey && bakeCache) {
            try {await bakeCache.put(bakeKey, encodeVegetationBake(record), signal, epoch);} catch (cause) {bakeCache.stats.warning = String(cause);}
          }
        }
        signal.throwIfAborted();
        const maps: DataTexture[] = [];
        try {
          for (const channel of ['colour', 'normal'] as const) {
            const base = record.mips[0], texture = new DataTexture(base[channel], base.width, base.height, RGBAFormat);
            maps.push(texture); texture.mipmaps = record.mips.map(mip => ({data: mip[channel], width: mip.width, height: mip.height}));
            texture.generateMipmaps = false; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
            if (channel === 'colour') texture.colorSpace = LinearSRGBColorSpace;
            texture.needsUpdate = true;
            const channelBytes = record.mips.reduce((sum, mip) => sum + mip[channel].byteLength, 0);
            await queue.enqueue({bytes: channelBytes, signal, priority: () => 80, work: () => renderer.initTexture(texture)});
          }
          const actual = record.mips.reduce((sum, mip) => sum + mip.colour.byteLength + mip.normal.byteLength, 0);
          return {bytes: actual, record, maps: maps as [DataTexture, DataTexture], dispose() {for (const map of maps) map.dispose();}};
        } catch (cause) {for (const map of maps) map.dispose(); throw cause;}
      });
      return {ready: lease.ready as Promise<PreparedVegetationAtlas>, release: lease.release};
    },
    trim: pool.trim,
    dispose() {
      if (bakeCache && import.meta.env?.DEV && typeof window !== 'undefined') window.removeEventListener('crownfall:clear-environment-cache', clearCache);
      bakeCache?.close(); if (queue.pending) void queue.whenIdle().then(() => pool.dispose()); else pool.dispose();
    },
  };
}
export type VegetationPrototypeResources = ReturnType<typeof createVegetationPrototypeResources>;
