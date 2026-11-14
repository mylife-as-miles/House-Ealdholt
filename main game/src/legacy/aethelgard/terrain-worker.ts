import type {TerrainWorkerSource} from '../../../../shared/legacy/aethelgard/environment/terrain-worker-source';
import type {deriveAuthoredTerrainTile} from '../../../../shared/legacy/aethelgard/environment/terrain-derived-geometry';
import type {TerrainLevel, TerrainTileLayout} from '../../../../shared/legacy/aethelgard/environment/terrain-tiles';
export type TerrainTileMetadata = Omit<TerrainTileLayout['tiles'][number], 'indices' | 'borderVertices'> & {readonly maximumBytes: number; readonly triangles: number};
export type TerrainLayoutMetadata = Omit<TerrainTileLayout, 'tiles'> & {readonly tiles: readonly TerrainTileMetadata[]};
export function createTerrainPreparationWorker(signal: AbortSignal, wake: () => void = () => {}) {
  const worker = new Worker(new URL('./terrain-prepare.worker.ts', import.meta.url), {type: 'module', name: 'Crownfall authored terrain preparation'});
  const pending = new Map<number, {resolve(value: any): void; reject(reason: unknown): void; cleanup(): void; cancelled: boolean}>();
  let serial = 0, disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; worker.terminate();
    for (const p of pending.values()) {p.cleanup(); p.reject(Error('Terrain worker retired.'));} pending.clear(); signal.removeEventListener('abort', dispose);
  }
  worker.onmessage = ({data}) => {const p = pending.get(data.id); if (!p) return; pending.delete(data.id); p.cleanup(); if (!p.cancelled) {if (data.error) p.reject(Error(data.error)); else p.resolve(data);} wake();};
  worker.onerror = e => {for (const p of pending.values()) {p.cleanup(); p.reject(Error(e.message || 'Terrain worker failed.'));} pending.clear(); dispose();};
  signal.addEventListener('abort', dispose, {once: true});
  function run<T>(data: object, transfer: Transferable[], requestSignal = signal): Promise<T> {
    if (disposed || signal.aborted || requestSignal.aborted) return Promise.reject(Error('Terrain request retired.'));
    if (pending.size >= 4) return Promise.reject(Error('Terrain worker backlog exceeded.'));
    const id = serial++;
    return new Promise<T>((resolve, reject) => {
      // A cancelled promise does not cancel already posted CPU work. Keep its
      // slot until acknowledgement, preventing rapid teleports from flooding
      // the worker with an invisible unbounded backlog.
      const abort = () => {const p = pending.get(id); if (!p || p.cancelled) return; p.cancelled = true; p.cleanup(); reject(Error('Obsolete terrain request.'));};
      pending.set(id, {resolve, reject, cancelled: false, cleanup() {requestSignal.removeEventListener('abort', abort);}});
      requestSignal.addEventListener('abort', abort, {once: true}); worker.postMessage({...data, id}, transfer);
    });
  }
  return {
    get pending() {return pending.size;},
    source(sourceId: number, source: TerrainWorkerSource) {return run<{layout: TerrainLayoutMetadata; sourceBytes: number}>({kind: 'source', sourceId, source}, [source.positions.buffer, source.attributes.buffer, source.indices.buffer]);},
    async tile(sourceId: number, tileId: string, level: TerrainLevel, requestSignal: AbortSignal) {
      const {result} = await run<{result: Awaited<ReturnType<typeof deriveAuthoredTerrainTile>>}>({kind: 'tile', sourceId, tileId, level}, [], requestSignal); return result;
    },
    retire(sourceId: number) {if (!disposed) worker.postMessage({kind: 'retire', sourceId, id: -1}); return Promise.resolve();},
    dispose,
  };
}
export type TerrainPreparationWorker = ReturnType<typeof createTerrainPreparationWorker>;
