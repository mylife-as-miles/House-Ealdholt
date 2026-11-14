// Worker for the water map bake (water-bake-core.js): heightAt() and the distance / flow passes
// run off the main thread while it builds the falls and streams. { grid } -> { ok, r } | { ok, error }.
import { heightAt } from '../core/terrain-height.js';
import { createCoarseSampler, bakeWaterCore } from './water-bake-core.js';

self.onmessage = (e) => {
  self.postMessage({ started: true });
  try {
    const coarse = createCoarseSampler(heightAt, e.data.grid);
    const cstep = coarse.grid ? coarse.grid.step : coarse.own.step;
    const r = bakeWaterCore(heightAt, coarse.sample, cstep);
    self.postMessage({ ok: true, r }, [r.active.buffer, r.height.buffer, r.sdf.buffer, r.px.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.stack || err) });
  }
};
