import {createVoxelSourceIndex, type VoxelRegionSource} from '../../../../shared/legacy/aethelgard/environment/voxel-source-index';
import type {VoxelVolumeGrid} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import {hashVoxelRegionSource} from '../../../../shared/legacy/aethelgard/environment/voxel-source-hash';
import {createWorldBakeCache, worldBakeKey} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';
import {createIndexedWorldBakeStore} from '../../../../shared/legacy/aethelgard/environment/world-bake-idb';
import {decodeVoxelBake, encodeVoxelBake} from '../../../../shared/legacy/aethelgard/environment/voxel-bake';
type Message = {id: number} & ({kind: 'init'; source: VoxelRegionSource} | {kind: 'volume'; grid: VoxelVolumeGrid} | {kind: 'clear-cache'}) | {kind: 'cancel'; requestId: number};
let source: ReturnType<typeof createVoxelSourceIndex> | null = null;
let initializing = false;
const cache = createWorldBakeCache({store: createIndexedWorldBakeStore()}), requests = new Map<number, AbortController>();
self.onmessage = async ({data}: MessageEvent<Message>) => {
  if (data.kind === 'cancel') {requests.get(data.requestId)?.abort(); return;}
  let ownsInitialization = false;
  try {
    if (data.kind === 'clear-cache') {
      if (!import.meta.env.DEV) throw Error('Environment cache clearing is development-only.');
      const cleared = await cache.clear(); self.postMessage({id: data.id, cleared, cache: cache.stats}); return;
    }
    if (data.kind === 'init') {
      if (source || initializing) throw Error('Voxel worker already has a static world owner.');
      initializing = true; ownsInitialization = true; const owned = {...data.source}, prepared = createVoxelSourceIndex(owned);
      const snapshotHash = await hashVoxelRegionSource(owned);
      owned.generatorVersion += ':snapshot:' + snapshotHash; source = prepared; initializing = false;
      self.postMessage({id: data.id, bytes: source.bytes, snapshotHash}); return;
    }
    if (!source) throw Error('Voxel worker has no authored source data.');
    const controller = new AbortController(); requests.set(data.id, controller);
    const signal = controller.signal, epoch = cache.generation, identity = source.key(data.grid), key = await worldBakeKey('voxel-static', identity);
    signal.throwIfAborted();
    const cached = await cache.get(key, blob => !!decodeVoxelBake(blob, identity, data.grid), signal);
    signal.throwIfAborted();
    const restored = cached ? decodeVoxelBake(cached, identity, data.grid) : null, result = restored ?? source.prepare(data.grid);
    if (!restored) await cache.put(key, encodeVoxelBake(result), signal, epoch);
    signal.throwIfAborted();
    self.postMessage({id: data.id, ...result, cacheHit: !!restored, cache: cache.stats}, {transfer: [result.volume.albedoOpacity.buffer, result.volume.transport.buffer]});
  } catch (cause) {if (ownsInitialization) initializing = false; self.postMessage({id: data.id, error: cause instanceof Error ? cause.message : String(cause)});}
  finally {requests.delete(data.id);}
};
