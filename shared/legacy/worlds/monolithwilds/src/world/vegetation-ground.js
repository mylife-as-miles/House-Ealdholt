// Ground cover that follows the camera: grass tufts, wildflowers and ferns.
//
// The ground around the camera is split into world-aligned cells in two tiers:
//   tier 0  8 m cells, out to ~34 m    dense, fine tufts (fades out 16..34 m)
//   tier 1  24 m cells, out to ~120 m  sparse, larger clumps (thins 40..110 m, gone by ~120 m)
// A cell's plants are generated on demand from a hash of its coordinates (so the same place always
// grows the same grass), placed on the exact ground height, and cached; cells far behind are
// evicted. When the camera moves or turns, the visible cells (frustum-tested) are copied into one
// dynamic instance buffer per plant type — three draw calls for all of it. Beyond ~120 m the
// terrain shader's meadow colours carry the look. New cells are generated under a per-frame time
// budget (or all at once in screenshot mode).

import * as THREE from 'crownfall-world-three';
import { STRIDE, paddedFrustum } from './vegetation-lod.js';
import { mulberry32 } from '../core/noise.js';

const _sphere = new THREE.Sphere();
const _dir = new THREE.Vector3();

export class GroundCover {
  /**
   * kinds: { grass: InstBuf, flower: InstBuf, fern: InstBuf }
   * tiers: [{ cell, radius, dens: { grass, flower, fern }, scale: [a, b] }]
   */
  constructor(ctx, densityAt, kinds, tiers, { sync = false } = {}) {
    this.ctx = ctx;
    this.densityAt = densityAt;
    this.kinds = kinds;
    this.names = Object.keys(kinds);
    this.tiers = tiers.map((t, ti) => {
      const R = Math.ceil(t.radius / t.cell) + 1;
      const offs = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) offs.push([dx, dz, dx * dx + dz * dz]);
      offs.sort((a, b) => a[2] - b[2]);
      const flat = new Int16Array(offs.length * 2);
      offs.forEach((o, i) => {
        flat[i * 2] = o[0];
        flat[i * 2 + 1] = o[1];
      });
      return { ...t, index: ti, offs: flat };
    });
    this.cache = new Map();
    this.sync = sync;
    this.frustum = new THREE.Frustum();
    this.lastPos = new THREE.Vector3(1e9, 0, 0);
    this.lastDir = new THREE.Vector3();
    this.dirty = true;
    this.stats = { cells: 0, generated: 0, lastMs: 0, frame: 0 };
    this.visible = [];
    // cells not needed for a while are dropped (bound once: no per-frame closures)
    this.evictBefore = 0;
    this.evict = (c, k) => {
      if ((c.stamp || 0) < this.evictBefore) this.cache.delete(k);
    };
  }

  key(ti, ci, cj) {
    return (ti * 8192 + (ci + 4096)) * 8192 + (cj + 4096);
  }

  /** Generate one cell's plants. */
  gen(tier, ci, cj) {
    const C = tier.cell;
    const x0 = ci * C, z0 = cj * C;
    const seed = (Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663) ^ Math.imul(tier.index + 7, 83492791)) >>> 0;
    const r = mulberry32(seed);
    const H = this.ctx.heightAt;
    const cell = { lists: {}, counts: {}, y0: 1e9, y1: -1e9, x: x0 + C / 2, z: z0 + C / 2 };
    const area = C * C;
    for (const name of this.names) {
      const want = Math.round(area * (tier.dens[name] || 0));
      const arr = new Float32Array(Math.max(1, want) * STRIDE);
      let n = 0;
      for (let k = 0; k < want; k++) {
        const x = x0 + r() * C, z = z0 + r() * C;
        const u = r(), yaw = r() * 6.2832, sd = r(), sc = r();
        const d = this.densityAt(x, z);
        const dens = name === 'grass' ? d.grass : name === 'flower' ? d.flower : d.fern;
        if (u >= dens) continue;
        const y = H(x, z);
        const o = n * STRIDE;
        arr[o] = x;
        arr[o + 1] = y;
        arr[o + 2] = z;
        arr[o + 3] = tier.scale[0] + (tier.scale[1] - tier.scale[0]) * sc * (name === 'grass' ? 0.6 + 0.4 * dens : 1);
        arr[o + 4] = yaw;
        arr[o + 5] = sd;
        arr[o + 6] = 0;
        arr[o + 7] = Math.min(0.995, name === 'grass' ? d.dry : name === 'flower' ? Math.max(0, d.flowerCol + (sd - 0.5) * 0.35) : Math.max(0, d.dry * 0.8 + (sd - 0.5) * 0.3));
        if (y < cell.y0) cell.y0 = y;
        if (y > cell.y1) cell.y1 = y;
        n++;
      }
      // generation order is random, so rank = index gives a random thinning subset
      for (let i = 0; i < n; i++) arr[i * STRIDE + 6] = tier.index + Math.min(0.999, (i + 0.5) / n);
      cell.lists[name] = arr;
      cell.counts[name] = n;
    }
    if (cell.y0 > cell.y1) {
      cell.y0 = cell.y1 = H(cell.x, cell.z);
    }
    cell.y1 += 1.5 * tier.scale[1];
    this.stats.generated++;
    return cell;
  }

  update(camera, force = false) {
    const t0 = performance.now();
    const p = camera.position;
    camera.getWorldDirection(_dir);
    const moved = p.distanceToSquared(this.lastPos) > 0.6 * 0.6 || _dir.dot(this.lastDir) < 0.9975;
    const budget = this.sync ? 1e9 : 1.2;
    let generated = false;
    // make sure the needed cells exist (nearest first, within budget)
    const vis = this.visible;
    vis.length = 0;
    const Hc = this.ctx.terrain?.heightApprox ? this.ctx.terrain.heightApprox(p.x, p.z) : this.ctx.heightAt(p.x, p.z);
    const hag = p.y - Hc;
    for (const tier of this.tiers) {
      if (hag > tier.radius) continue;
      const C = tier.cell;
      const ci0 = Math.floor(p.x / C), cj0 = Math.floor(p.z / C);
      const offs = tier.offs;
      for (let s = 0; s < offs.length; s += 2) {
        const ci = ci0 + offs[s], cj = cj0 + offs[s + 1];
        const cx = (ci + 0.5) * C, cz = (cj + 0.5) * C;
        const ex = Math.max(0, Math.abs(cx - p.x) - C / 2), ez = Math.max(0, Math.abs(cz - p.z) - C / 2);
        const dh = Math.sqrt(ex * ex + ez * ez + hag * hag * 0.9);
        if (dh > tier.radius) continue;
        const k = this.key(tier.index, ci, cj);
        let cell = this.cache.get(k);
        if (!cell) {
          if (performance.now() - t0 > budget) continue;
          cell = this.gen(tier, ci, cj);
          this.cache.set(k, cell);
          generated = true;
        }
        cell.stamp = this.stats.frame;
        vis.push(tier, cell, dh);
      }
    }
    this.stats.frame++;
    if (!(moved || generated || force || this.dirty)) return;
    this.dirty = false;
    this.lastPos.copy(p);
    this.lastDir.copy(_dir);

    const fr = paddedFrustum(camera, 12, 400, this.frustum);
    for (const n of this.names) this.kinds[n].begin();
    let cells = 0;
    for (let v = 0; v < vis.length; v += 3) {
      const tier = vis[v], cell = vis[v + 1], d = vis[v + 2];
      if (d > 6) {
        _sphere.center.set(cell.x, (cell.y0 + cell.y1) * 0.5, cell.z);
        const hy = (cell.y1 - cell.y0) * 0.5;
        _sphere.radius = Math.sqrt(tier.cell * tier.cell * 0.5 + hy * hy) + 1;
        if (!fr.intersectsSphere(_sphere)) continue;
      }
      cells++;
      const th = tier.thin;
      const keep = th ? 1 + (th[2] - 1) * sstep(th[0], th[1], Math.max(0, d - 2)) : 1;
      for (const n of this.names) {
        const cnt = cell.counts[n];
        if (!cnt) continue;
        this.kinds[n].pushRange(cell.lists[n], 0, Math.min(cnt, Math.ceil(cnt * Math.min(1, keep + 0.05))));
      }
    }
    for (const n of this.names) this.kinds[n].end();
    this.stats.cells = cells;
    // evict cells not needed for a while
    if (this.cache.size > 900) {
      this.evictBefore = this.stats.frame - 120;
      this.cache.forEach(this.evict);
    }
    this.stats.lastMs = performance.now() - t0;
  }
}

function sstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
