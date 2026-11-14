// Job dispatcher shared by the terrain workers and the main-thread fallback.
// `state` holds the world grid and a small LRU of recently sampled chunk grids (so a leaf chunk can
// reuse the samples of its parent computed by the same worker).
import { worldRows, coarseRows, sampleChunk, buildChunk, worldMapRows, worldGlobal, sunVisibility, MAX_LEVEL } from './terrain-jobs.js';

const CACHE_MAX = 72;

function cacheGet(state, key) {
  const v = state.cache.get(key);
  if (v) {
    state.cache.delete(key);
    state.cache.set(key, v);
  }
  return v;
}

function cachePut(state, key, v) {
  state.cache.set(key, v);
  if (state.cache.size > CACHE_MAX) state.cache.delete(state.cache.keys().next().value);
}

export function runJob(state, msg) {
  switch (msg.type) {
    case 'rows': {
      const data = worldRows(msg.j0, msg.j1);
      return { result: { data }, transfer: [data.buffer] };
    }
    case 'crows': {
      const data = coarseRows(msg.j0, msg.j1);
      return { result: { data }, transfer: [data.buffer] };
    }
    case 'setWorld': {
      state.world = msg.world;
      state.coarse = msg.coarse || null;
      state.cache.clear();
      return { result: true };
    }
    case 'maprows': {
      const r = worldMapRows(state.world, msg.j0, msg.j1);
      return { result: r, transfer: [r.A.buffer, r.B.buffer] };
    }
    case 'global': {
      const r = worldGlobal(state.world);
      return { result: r, transfer: [r.cavity.buffer, r.flow.buffer] };
    }
    case 'sun': {
      const vis = sunVisibility(state.world, msg.dir, state.coarse);
      return { result: { vis }, transfer: [vis.buffer] };
    }
    case 'chunk': {
      const { L, ix, iz } = msg;
      const parent = L > 0 ? cacheGet(state, `${L - 1}:${ix >> 1}:${iz >> 1}`) : null;
      const H = sampleChunk(L, ix, iz, state.world, parent || null, state.coarse);
      // Only fine levels are worth caching: their children re-use the samples.
      if (L >= 6 && L < MAX_LEVEL) cachePut(state, `${L}:${ix}:${iz}`, H);
      const c = buildChunk(L, ix, iz, H);
      c.computed = H.computed;
      return { result: c, transfer: [c.pos.buffer, c.nrm.buffer, c.mor.buffer, c.morN.buffer] };
    }
    default:
      throw new Error(`terrain: unknown job ${msg.type}`);
  }
}
