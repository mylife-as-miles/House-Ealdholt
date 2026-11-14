import type {TerrainLevel, TerrainTileDemand} from './terrain-tiles';
export interface TerrainResidentPage {readonly bytes: number; dispose(): void;}
/** Resident pages are GPU resources, not CPU collision/nav or persistent cache.
 * Coarse pages remain a continuous fallback; only unused finer pages can be
 * evicted. A pending replacement never hides its current selected page. */
export function createTerrainResidency<T extends TerrainResidentPage>(maximumBytes: number, maximumPages = 512) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !Number.isSafeInteger(maximumPages) || maximumPages < 1) throw Error('Invalid terrain residency budget.');
  type Entry = {tile: string; level: TerrainLevel; estimate: number; touched: number; controller: AbortController; value: T | null};
  const entries = new Map<string, Entry>(), demands = new Map<string, TerrainLevel>();
  let serial = 0, disposed = false;
  const stats = {bytes: 0, reservedBytes: 0, pages: 0, pending: 0, cancelled: 0, stale: 0, evictions: 0, rejected: 0};
  const key = (tile: string, level: TerrainLevel) => tile + '/' + level;
  function selected(tile: string): Entry | null {
    const wanted = demands.get(tile) ?? 2;
    for (let level = wanted; level <= 2; level++) {const e = entries.get(key(tile, level as TerrainLevel)); if (e?.value) return e;}
    for (let level = wanted - 1; level >= 0; level--) {const e = entries.get(key(tile, level as TerrainLevel)); if (e?.value) return e;}
    return null;
  }
  function remove(e: Entry) {
    if (entries.get(key(e.tile, e.level)) !== e) return;
    entries.delete(key(e.tile, e.level)); e.controller.abort();
    if (e.value) {stats.bytes -= e.value.bytes; stats.pages--; e.value.dispose(); e.value = null;}
    else {stats.reservedBytes -= e.estimate; stats.pending--; stats.cancelled++;}
  }
  function room(bytes: number) {
    while (stats.bytes + stats.reservedBytes + bytes > maximumBytes || entries.size >= maximumPages) {
      let candidate: Entry | null = null;
      for (const e of entries.values()) if (e.value && e.level !== 2 && e !== selected(e.tile) && e.level !== demands.get(e.tile)
        && (!candidate || e.touched < candidate.touched)) candidate = e;
      if (!candidate) return false;
      remove(candidate); stats.evictions++;
    }
    return true;
  }
  return {
    stats,
    demand(next: readonly TerrainTileDemand[]) {
      if (disposed) return;
      demands.clear(); for (const d of next) demands.set(d.id, d.level);
      for (const e of [...entries.values()]) if (!e.value && e.level !== 2 && demands.get(e.tile) !== e.level) remove(e);
      for (const d of next) if (!d.retainFine) for (const e of [...entries.values()]) {
        if (e.tile === d.id && e.level !== 2 && e.value && e !== selected(d.id) && e.level !== d.level) {remove(e); stats.evictions++;}
      }
    },
    selected(tile: string): {readonly level: TerrainLevel; readonly value: T} | null {
      const e = selected(tile); if (!e?.value) return null; e.touched = ++serial; return {level: e.level, value: e.value};
    },
    has(tile: string, level: TerrainLevel) {return entries.has(key(tile, level));},
    retireTile(tile: string) {for (const e of [...entries.values()]) if (e.tile === tile) remove(e); demands.delete(tile);},
    begin(tile: string, level: TerrainLevel, estimate: number) {
      if (disposed || !tile || tile.length > 256 || ![0, 1, 2].includes(level) || !Number.isSafeInteger(estimate) || estimate < 1
        || estimate > maximumBytes || entries.has(key(tile, level)) || !room(estimate)) {stats.rejected++; return null;}
      const e: Entry = {tile, level, estimate, touched: ++serial, controller: new AbortController(), value: null};
      entries.set(key(tile, level), e); stats.pending++; stats.reservedBytes += estimate;
      return {
        signal: e.controller.signal,
        commit(value: T) {
          if (disposed || e.controller.signal.aborted || entries.get(key(tile, level)) !== e || e.value !== null) {stats.stale++; value.dispose(); return false;}
          if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > estimate) {value.dispose(); remove(e); throw Error('Terrain page exceeded its reserved upload budget.');}
          stats.reservedBytes -= estimate; stats.pending--; stats.bytes += value.bytes; stats.pages++; e.value = value; e.touched = ++serial; return true;
        },
        cancel() {if (!e.value) remove(e);},
      };
    },
    dispose() {if (disposed) return; disposed = true; for (const e of [...entries.values()]) remove(e); demands.clear();},
  };
}
