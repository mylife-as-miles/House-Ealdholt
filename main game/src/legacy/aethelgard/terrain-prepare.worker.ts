// Static CPU source lives in this worker, separate from GPU tile residency.
import {MeshoptSimplifier} from 'meshoptimizer';
import {prepareTerrainWorkerSource, type TerrainWorkerSource} from '../../../../shared/legacy/aethelgard/environment/terrain-worker-source';
import {deriveAuthoredTerrainTile} from '../../../../shared/legacy/aethelgard/environment/terrain-derived-geometry';
import type {TerrainLevel, TerrainTileLayout} from '../../../../shared/legacy/aethelgard/environment/terrain-tiles';
type Message = {id: number; sourceId: number} & ({kind: 'source'; source: TerrainWorkerSource} | {kind: 'tile'; tileId: string; level: TerrainLevel} | {kind: 'retire'});
const sources = new Map<number, {source: TerrainWorkerSource; layout: TerrainTileLayout; bytes: number}>();
let bytes = 0;
self.onmessage = async ({data}: MessageEvent<Message>) => {
  try {
    if (data.kind === 'retire') {
      const old = sources.get(data.sourceId); if (old) {bytes -= old.bytes; sources.delete(data.sourceId);}
      self.postMessage({id: data.id}); return;
    }
    if (data.kind === 'source') {
      const sourceBytes = data.source.positions.byteLength + data.source.attributes.byteLength + data.source.indices.byteLength;
      if (sources.has(data.sourceId) || sources.size >= 256 || sourceBytes + bytes > 128 * 1024 * 1024) throw Error('Terrain worker source budget exceeded.');
      const layout = prepareTerrainWorkerSource(data.source);
      const layoutBytes = layout.tiles.reduce((n, t) => n + t.indices.byteLength + t.borderVertices.byteLength, 0);
      if (sourceBytes + layoutBytes + bytes > 128 * 1024 * 1024) throw Error('Terrain worker tile index budget exceeded.');
      sources.set(data.sourceId, {source: data.source, layout, bytes: sourceBytes + layoutBytes}); bytes += sourceBytes + layoutBytes;
      // Tile index arrays remain worker-owned. Only metadata crosses back.
      const stride = data.source.channels.reduce((n, c) => n + c.size, 3);
      self.postMessage({id: data.id, layout: {...layout, tiles: layout.tiles.map(t => ({...t, indices: undefined, borderVertices: undefined,
        triangles: t.indices.length / 3, maximumBytes: new Set(t.indices).size * stride * 4 + t.indices.byteLength}))}, sourceBytes: bytes}); return;
    }
    const owner = sources.get(data.sourceId), tile = owner?.layout.tiles.find(t => t.id === data.tileId);
    if (!owner || !tile) throw Error('Terrain source page is no longer available.');
    const result = await deriveAuthoredTerrainTile(owner.source, tile, data.level, MeshoptSimplifier);
    if (sources.get(data.sourceId) !== owner) throw Error('Terrain source page retired during preparation.');
    self.postMessage({id: data.id, result}, {transfer: [result.positions.buffer, result.indices.buffer, ...result.attributes.map(a => a.values.buffer)]});
  } catch (cause) {self.postMessage({id: data.id, error: cause instanceof Error ? cause.message : String(cause)});}
};
