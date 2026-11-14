import type {VoxelRegionSource, createVoxelSourceIndex} from '../../../../shared/legacy/aethelgard/environment/voxel-source-index';
import type {VoxelVolumeGrid} from '../../../../shared/legacy/aethelgard/environment/voxel-volume';
import type {WorldBakeCache} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';
export function createVoxelPreparationWorker(signal: AbortSignal, wake: () => void) {
  const worker = new Worker(new URL('./voxel-prepare.worker.ts', import.meta.url), {type: 'module', name: 'Crownfall static voxel transport'});
  type Pending = {resolve(value: any): void; reject(reason: unknown): void; cancelled: boolean; cleanup(): void};
  const pending = new Map<number, Pending>(); let serial = 0, disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; worker.terminate();
    for (const p of pending.values()) {p.cleanup(); p.reject(Error('Voxel source worker retired.'));} pending.clear(); signal.removeEventListener('abort', dispose);
  }
  worker.onmessage = ({data}) => {
    const p = pending.get(data.id); if (!p) return; pending.delete(data.id); p.cleanup();
    if (!p.cancelled) {if (data.error) p.reject(Error(data.error)); else p.resolve(data);} wake();
  };
  worker.onerror = event => {for (const p of pending.values()) {p.cleanup(); p.reject(Error(event.message || 'Voxel worker failed.'));} pending.clear(); dispose();};
  signal.addEventListener('abort', dispose, {once: true});
  function run<T>(data: object, transfer: Transferable[], requestSignal: AbortSignal) {
    if (disposed || signal.aborted || requestSignal.aborted) return Promise.reject(Error('Voxel preparation retired.'));
    if (pending.size >= 2) return Promise.reject(Error('Voxel background backlog is full; retain the previous volume.'));
    const id = serial++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {const p = pending.get(id); if (!p || p.cancelled) return; p.cancelled = true; p.cleanup(); worker.postMessage({kind: 'cancel', requestId: id}); reject(Error('Obsolete voxel volume.'));};
      pending.set(id, {resolve, reject, cancelled: false, cleanup() {requestSignal.removeEventListener('abort', abort);}});
      requestSignal.addEventListener('abort', abort, {once: true}); worker.postMessage({...data, id}, transfer);
    });
  }
  return {
    get pending() {return pending.size;},
    init(source: VoxelRegionSource) {
      return run<{bytes: number}>({kind: 'init', source}, source.terrain.flatMap(t => [t.positions.buffer, t.indices.buffer]), signal);
    },
    volume(grid: VoxelVolumeGrid, requestSignal: AbortSignal) {
      return run<ReturnType<ReturnType<typeof createVoxelSourceIndex>['prepare']> & {cacheHit: boolean; cache: WorldBakeCache['stats']}>({kind: 'volume', grid}, [], requestSignal);
    },
    clearCache() {return run<{cleared: boolean; cache: WorldBakeCache['stats']}>({kind: 'clear-cache'}, [], signal);},
    dispose,
  };
}
export type VoxelPreparationWorker = ReturnType<typeof createVoxelPreparationWorker>;
