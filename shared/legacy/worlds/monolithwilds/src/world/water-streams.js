// Streams and ponds above the waterline: plunge pools under the falls, streams that run from them
// toward the Mirror, the little ponds they fill on the way, and a tarn where one ends.
//
// Drainage is computed properly rather than by greedy descent (which gets stuck in every hollow):
// a priority-flood from the lake over a 10 m grid of the land between the escarpment and the lake
// gives every cell a spill level and a downstream neighbour, so a path followed from any source
// always reaches the lake without climbing more than the depressions force it to. Landmark
// clearings are treated as high ground, so streams route around the Choir, the Wardens, etc.
// Shallow depressions along a path become ponds (filled to their spill level); a deep one ends the
// stream in a tarn.
//
// Everything is drawn with the W_LOCAL variant of the water surface material: a vertex attribute
// aWater = (depth m, rapids 0..1, flow x, flow z) replaces the baked lake map.

import * as THREE from 'crownfall-world-three';

const REGION = { x0: -2450, x1: 1550, z0: -1560, z1: 760, step: 12 };

/** Binary min-heap over (value, index) stored in typed arrays. */
class Heap {
  constructor(cap) {
    this.v = new Float64Array(cap);
    this.k = new Int32Array(cap);
    this.n = 0;
  }
  push(key, val) {
    let i = this.n++;
    const v = this.v;
    const k = this.k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      v[i] = v[p];
      k[i] = k[p];
      i = p;
    }
    v[i] = val;
    k[i] = key;
  }
  pop() {
    const v = this.v;
    const k = this.k;
    const top = k[0];
    const n = --this.n;
    const lv = v[n];
    const lk = k[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && v[r] < v[l] ? r : l;
      if (v[m] >= lv) break;
      v[i] = v[m];
      k[i] = k[m];
      i = m;
    }
    v[i] = lv;
    k[i] = lk;
    return top;
  }
}

function priorityFlood(ctx, coarse) {
  const { x0, x1, z0, z1, step } = REGION;
  const nx = Math.round((x1 - x0) / step) + 1;
  const nz = Math.round((z1 - z0) / step) + 1;
  const N = nx * nz;
  const H = new Float32Array(N);
  const C = new Float32Array(N); // routing cost: reserved clearings count as high ground
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const h = coarse.sample(x, z);
      const k = j * nx + i;
      H[k] = h;
      C[k] = ctx.layout.isReserved(x, z, 30) ? h + 400 : h;
    }
  }
  const F = new Float64Array(N).fill(Infinity);
  const P = new Int32Array(N).fill(-1);
  const heap = new Heap(N + 8);
  for (let k = 0; k < N; k++) {
    if (H[k] < 0) {
      F[k] = H[k];
      heap.push(k, H[k]);
    }
  }
  const DI = [1, -1, 0, 0, 1, 1, -1, -1];
  const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  const DW = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
  while (heap.n) {
    const k = heap.pop();
    const v = F[k];
    const i = k % nx;
    const j = (k - i) / nx;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d];
      const jj = j + DJ[d];
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const kk = jj * nx + ii;
      if (F[kk] !== Infinity) continue;
      const nv = Math.max(C[kk], v + 0.002 * DW[d]);
      F[kk] = nv;
      P[kk] = k;
      heap.push(kk, nv);
    }
  }
  return { nx, nz, H, F, P, ...REGION };
}

/** Follow the drainage from (x, z) down to the lake. Returns cells with ground and fill level. */
function drainPath(fl, x, z) {
  const { nx, nz, x0, z0, step, H, F, P } = fl;
  const i = Math.round((x - x0) / step);
  const j = Math.round((z - z0) / step);
  if (i < 0 || j < 0 || i >= nx || j >= nz) return [];
  let k = j * nx + i;
  const out = [];
  let guard = 0;
  while (k >= 0 && H[k] >= 0 && guard++ < 5000) {
    const ii = k % nx;
    const jj = (k - ii) / nx;
    out.push({ x: x0 + ii * step, z: z0 + jj * step, h: H[k], fill: Math.min(F[k], H[k] + 500) - H[k], k });
    k = P[k];
  }
  if (k >= 0) {
    const ii = k % nx;
    const jj = (k - ii) / nx;
    out.push({ x: x0 + ii * step, z: z0 + jj * step, h: H[k], fill: 0, k, lake: true });
  }
  return out;
}

/** Chaikin-smooth a polyline twice, then resample at `ds` metres. */
function smoothResample(pts, ds) {
  let p = pts.map((q) => [q.x, q.z]);
  for (let it = 0; it < 3; it++) {
    const o = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    o.push(p[p.length - 1]);
    p = o;
  }
  const out = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const l = Math.hypot(bx - ax, bz - az);
    let t = ds - acc;
    while (t <= l) {
      out.push([ax + ((bx - ax) * t) / l, az + ((bz - az) * t) / l]);
      t += ds;
    }
    acc = l - (t - ds);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// ponds: flood-fill a 4 m grid around a seed up to `level`
// ---------------------------------------------------------------------------------------------

// Pond grids sit on one global 4 m lattice whose heights are cached: the fits along a stream try
// several overlapping hollows (a tarn search can probe the same basin a dozen times).
const heightCache = new Map();
function latticeHeight(ctx, i, j) {
  const key = (i + 32768) * 65536 + (j + 32768);
  let h = heightCache.get(key);
  if (h === undefined) {
    h = ctx.heightAt(i * 4, j * 4);
    heightCache.set(key, h);
  }
  return h;
}

function sampleGrid(ctx, x, z, maxR) {
  const s = 4;
  const ci = Math.round(x / s);
  const cj = Math.round(z / s);
  const R = Math.ceil(maxR / s);
  const n = 2 * R + 1;
  const hs = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = latticeHeight(ctx, ci + i - R, cj + j - R);
  return { cx: ci * s, cz: cj * s, s, R, n, hs };
}

/** Flood-fill the sampled grid from its lowest central sample up to `level`. */
function makePond(grid, level, allowClip = false) {
  const { cx, cz, s, R, n, hs } = grid;
  const inside = new Uint8Array(n * n);
  const stack = [];
  // seed at the lowest sample near the centre
  let seed = R * n + R;
  for (let j = R - 3; j <= R + 3; j++) for (let i = R - 3; i <= R + 3; i++) if (hs[j * n + i] < hs[seed]) seed = j * n + i;
  if (hs[seed] >= level) return null;
  stack.push(seed);
  inside[seed] = 1;
  let count = 0;
  let touchesEdge = false;
  while (stack.length) {
    const k = stack.pop();
    count++;
    const i = k % n;
    const j = (k - i) / n;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) touchesEdge = true;
    for (let d = 0; d < 4; d++) {
      const ii = i + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const jj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj * n + ii;
      if (inside[kk] || hs[kk] >= level) continue;
      const r2 = (ii - R) * (ii - R) + (jj - R) * (jj - R);
      // plunge pools may be cut off by an irregular basin rim (the fall scoured it out)
      const a = Math.atan2(jj - R, ii - R);
      const rim = allowClip ? R * (0.8 + 0.12 * Math.sin(3 * a + 1.3) + 0.08 * Math.sin(7 * a + 0.4)) : R;
      if (r2 > rim * rim) {
        if (!allowClip) touchesEdge = true;
        continue;
      }
      inside[kk] = 1;
      stack.push(kk);
    }
  }
  return { cx, cz, level, n, R, s, hs, inside, count, touchesEdge, area: count * s * s };
}

/** Pick a level for a pool at (x, z): fill the hollow a little above its lowest point. */
function fitPond(ctx, x, z, { depth = 2, maxR = 60, minArea = 500, maxArea = 9000, minDepth = 0.7, clip = false } = {}) {
  // lowest ground nearby
  let lx = x;
  let lz = z;
  let lh = ctx.heightAt(x, z);
  for (let r = 6; r <= 30; r += 8) {
    for (let a = 0; a < 12; a++) {
      const px = x + Math.cos((a / 12) * Math.PI * 2) * r;
      const pz = z + Math.sin((a / 12) * Math.PI * 2) * r;
      const h = ctx.heightAt(px, pz);
      if (h < lh) {
        lh = h;
        lx = px;
        lz = pz;
      }
    }
  }
  const grid = sampleGrid(ctx, lx, lz, maxR);
  let best = null;
  for (let d = depth; d <= depth + 3.5; d += 0.5) {
    const p = makePond(grid, lh + d, clip);
    if (!p) continue;
    if (p.touchesEdge || p.area > maxArea) break;
    best = p;
    if (p.area >= minArea) break;
  }
  // a wide, flat hollow: settle for a shallower pool rather than none
  for (let d = Math.min(depth, 1.6) - 0.3; !best && d >= minDepth; d -= 0.3) {
    const p = makePond(grid, lh + d, clip);
    if (p && !p.touchesEdge && p.area <= maxArea) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------------------------

function addPond(out, pond, ctx) {
  const { n, R, s, hs, inside, level, cx, cz } = pond;
  // include every cell with an inside corner; vertices carry depth = level - ground
  const vid = new Int32Array(n * n).fill(-1);
  const useCell = (i, j) =>
    i >= 0 && j >= 0 && i < n - 1 && j < n - 1 &&
    (inside[j * n + i] || inside[j * n + i + 1] || inside[(j + 1) * n + i] || inside[(j + 1) * n + i + 1]);
  const vert = (i, j) => {
    const k = j * n + i;
    if (vid[k] >= 0) return vid[k];
    vid[k] = out.pos.length / 3;
    const x = cx + (i - R) * s;
    const z = cz + (j - R) * s;
    out.pos.push(x, level, z);
    // outside the flooded region the depth goes negative -> the shader fades it out
    const d = inside[k] ? level - hs[k] : Math.min(level - hs[k], -0.05);
    out.water.push(d, 0, 0, 0);
    return vid[k];
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (!useCell(i, j)) continue;
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i, j + 1);
      const d = vert(i + 1, j + 1);
      out.idx.push(a, c, b, b, c, d);
    }
  }
}

/** True if any flooded cell of p (or a margin around it) lies in an existing pond: never stack two
 *  water surfaces (they would z-fight). */
function overlapsPonds(p, ponds) {
  const { n, R, s, cx, cz, inside } = p;
  for (let j = 0; j < n; j += 2) {
    for (let i = 0; i < n; i += 2) {
      if (!inside[j * n + i]) continue;
      const x = cx + (i - R) * s;
      const z = cz + (j - R) * s;
      for (const q of ponds) {
        if (Math.abs(x - q.cx) > q.R * q.s + 8 || Math.abs(z - q.cz) > q.R * q.s + 8) continue;
        const qi = Math.round((x - q.cx) / q.s) + q.R;
        const qj = Math.round((z - q.cz) / q.s) + q.R;
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const ii = qi + di;
            const jj = qj + dj;
            if (ii >= 0 && jj >= 0 && ii < q.n && jj < q.n && q.inside[jj * q.n + ii]) return true;
          }
        }
      }
    }
  }
  return false;
}

function pondLevelAt(ponds, x, z) {
  for (const p of ponds) {
    const i = Math.round((x - p.cx) / p.s) + p.R;
    const j = Math.round((z - p.cz) / p.s) + p.R;
    if (i < 0 || j < 0 || i >= p.n || j >= p.n) continue;
    if (p.inside[j * p.n + i]) return p.level;
  }
  return -Infinity;
}

/** A stream ribbon along resampled points. width grows downstream. */
function addStream(out, ctx, pts, { w0 = 3.5, w1 = 9, ponds, fadeIn = 12, fadeOut = 20, feeder = 0 }) {
  const n = pts.length;
  if (n < 3) return;
  const M = 5;
  let rowStart = -1;
  let prevRow = -1;
  const len = (n - 1) * 5;
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    const [ax, az] = pts[Math.max(0, i - 1)];
    const [bx, bz] = pts[Math.min(n - 1, i + 1)];
    let tx = bx - ax;
    let tz = bz - az;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const px = -tz;
    const pz = tx;
    const g = ctx.heightAt(x, z);
    const inPond = pondLevelAt(ponds, x, z) > g + 0.15;
    if (inPond || g < 0.35) {
      prevRow = -1;
      continue;
    }
    // local slope along the stream -> speed and rapids
    const gA = ctx.heightAt(ax, az);
    const gB = ctx.heightAt(bx, bz);
    const slope = Math.max(0, (gA - gB) / (tl || 1));
    const along = i * 5;
    const toLip = len - along;
    let speed = Math.min(3.2, 0.5 + slope * 9);
    let rapids = Math.min(1, Math.max(0, (slope - 0.04) * 8));
    let w = (w0 + (w1 - w0) * Math.min(1, along / 1600)) * (1 + 0.25 * Math.sin(i * 0.37) * Math.sin(i * 0.11));
    if (feeder > 0) {
      // feeders spread out and speed up over the last metres before the lip
      const near = 1 - Math.min(1, toLip / 40);
      speed = Math.max(speed, 0.8 + 2.2 * near);
      rapids = Math.max(rapids, near * near);
      w = Math.max(w, feeder * (1 - Math.min(1, toLip / 45)));
    }
    // fade in/out at the ends and where the ribbon is cut by a pond
    const endFade = Math.min(1, along / fadeIn, fadeOut > 0.01 ? toLip / fadeOut : 1);
    const row = out.pos.length / 3;
    for (let k = 0; k < M; k++) {
      const u = (k / (M - 1)) * 2 - 1;
      const vx = x + px * u * w * 0.5;
      const vz = z + pz * u * w * 0.5;
      const gy = ctx.heightAt(vx, vz);
      // surface follows the bed but never tilts sideways more than the bed does at the centre
      const y = Math.max(gy, g - 0.4) + 0.3;
      out.pos.push(vx, y, vz);
      const depth = (0.95 * (1 - u * u) - 0.1) * Math.max(0.05, endFade) - (1 - endFade) * 0.3;
      out.water.push(depth, rapids, tx * speed, tz * speed);
    }
    if (prevRow >= 0) {
      for (let k = 0; k < M - 1; k++) {
        const a = prevRow + k;
        const b = row + k;
        out.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    } else rowStart = row;
    prevRow = row;
  }
  return rowStart;
}

// ---------------------------------------------------------------------------------------------

/**
 * Build pools under the falls, streams to the lake, ponds along the way.
 * falls: [{ id, base, dir, lip, site }] from water-falls.js. Returns a merged geometry.
 */
export function buildStreams(ctx, coarse, falls) {
  const t0 = performance.now();
  const fl = priorityFlood(ctx, coarse);
  const tFlood = performance.now();
  const ponds = [];
  const streams = [];
  const feeders = [];
  const out = { pos: [], water: [], idx: [] };
  const visited = new Uint8Array(fl.nx * fl.nz);

  for (const f of falls) {
    if (f.site.stop !== 'ground') continue;
    // plunge pool
    const pr = Math.min(75, 22 + f.width * 0.8 + f.drop * 0.05);
    const pool = fitPond(ctx, f.base.x + f.dir.x * 8, f.base.z + f.dir.z * 8, { depth: 2.0, maxR: pr, minArea: pr * pr * 1.2, maxArea: 20000, clip: true });
    if (pool) {
      pool.kind = 'plunge';
      pool.fall = f.id;
      ponds.push(pool);
    }
    // stream from the pool's far side
    const path = drainPath(fl, f.base.x + f.dir.x * 20, f.base.z + f.dir.z * 20);
    if (path.length < 4) continue;
    const cells = [];
    let endPond = null;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (visited[c.k] && i > 3) {
        cells.push(c);
        break; // joins an earlier stream: the confluence
      }
      visited[c.k] = 1;
      cells.push(c);
      const along = i * fl.step;
      // a deep hollow ends the stream in a tarn (unless we are still at the pool)
      if (c.fill > 5.5 && along > 180) {
        endPond = fitPond(ctx, c.x, c.z, { depth: 2.4, maxR: 120, minArea: 3000, maxArea: 30000, minDepth: 0.6 });
        if (endPond && overlapsPonds(endPond, ponds)) endPond = null;
        if (endPond) {
          endPond.kind = 'tarn';
          ponds.push(endPond);
          break;
        }
        // no basin that holds a tarn (a broad flat): the stream simply carries on
      }
    }
    // small ponds in shallow hollows along the way
    let lastPond = -1e9;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const along = i * fl.step;
      if (c.fill > 0.6 && c.fill <= 5.5 && along > 120 && along - lastPond > 160) {
        const p = fitPond(ctx, c.x, c.z, { depth: Math.min(2.0, c.fill * 0.8), maxR: 50, minArea: 400, maxArea: 5000 });
        if (p && !overlapsPonds(p, ponds)) {
          p.kind = 'pond';
          ponds.push(p);
          lastPond = along;
        }
      }
    }
    const pts = smoothResample(cells, 5);
    streams.push({ fall: f.id, pts, reachesLake: !!cells[cells.length - 1]?.lake, endPond: !!endPond, length: pts.length * 5 });
  }

  // feeders: the streams on the high ground that run to each lip (meandering, narrowing upstream)
  for (const f of falls) {
    const L = f.site.feeder || 0;
    if (L < 20) continue;
    const pts = [];
    const px = -f.dir.z;
    const pz = f.dir.x;
    const ph = f.site.seed * 2.1;
    for (let s = 0; s <= L; s += 5) {
      const back = L - s; // distance upstream of the lip
      const k = Math.min(1, back / 60);
      const wig = k * (14 * Math.sin(back / 47 + ph) + 6 * Math.sin(back / 13 + ph * 3));
      pts.push([f.lip.x - f.dir.x * back + px * wig, f.lip.z - f.dir.z * back + pz * wig]);
    }
    // stop half a step short of the lip so the fall ribbon takes over
    pts.pop();
    feeders.push({ fall: f.id, pts, width: f.width });
  }

  for (const p of ponds) addPond(out, p, ctx);
  for (const s of streams) addStream(out, ctx, s.pts, { ponds });
  for (const fd of feeders) addStream(out, ctx, fd.pts, { ponds, w0: fd.width * 0.35, w1: fd.width * 0.35, fadeIn: 30, fadeOut: 0.001, feeder: fd.width * 0.75 });

  heightCache.clear();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  const nrm = new Float32Array(out.pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('aWater', new THREE.Float32BufferAttribute(out.water, 4));
  geo.setIndex(out.idx);
  geo.computeBoundingSphere();

  return {
    geometry: geo,
    ponds: ponds.map((p) => ({ x: p.cx, z: p.cz, level: p.level, r: p.R * p.s, kind: p.kind, area: p.area, inside: p.inside, n: p.n, R: p.R, s: p.s })),
    streams,
    stats: {
      floodMs: Math.round(tFlood - t0),
      ms: Math.round(performance.now() - t0),
      ponds: ponds.length,
      triangles: out.idx.length / 3,
      streams: streams.map((s) => `${s.fall}:${s.length}m${s.reachesLake ? '->lake' : s.endPond ? '->tarn' : ''}`),
    },
  };
}
