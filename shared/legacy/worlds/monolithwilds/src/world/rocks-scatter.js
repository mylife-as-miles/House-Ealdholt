// Loose-rock placement: embedding boulders in the terrain, an occupancy grid (so boulders, and
// other modules, can avoid the big formations), the basin-wide cluster scatter and talus/scree
// aprons at the foot of the great cliffs.

import * as THREE from 'crownfall-world-three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Rock recipe indices inside the BoulderField (see rocks.js)
export const KIND = { round: 0, block: 1, slab: 2 };

// ---------------------------------------------------------------------------
// Occupancy: discs covered by formations (hash grid)
// ---------------------------------------------------------------------------

export class Occupancy {
  constructor(cell = 64) {
    this.cell = cell;
    this.map = new Map();
    this.discs = [];
  }

  add(x, z, r) {
    const d = { x, z, r };
    this.discs.push(d);
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 100003 + j;
        let l = this.map.get(k);
        if (!l) this.map.set(k, (l = []));
        l.push(d);
      }
    }
  }

  /** True if (x,z) is within any disc (+ margin). */
  blocked(x, z, margin = 0) {
    const c = this.cell;
    const reach = Math.ceil(margin / c);
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        const l = this.map.get(i * 100003 + j);
        if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const d = l[k];
          const dx = x - d.x, dz = z - d.z, rr = d.r + margin;
          if (dx * dx + dz * dz < rr * rr) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Embedding one boulder
// ---------------------------------------------------------------------------

/**
 * Place a rock instance on the terrain, half-embedded and roughly aligned with the slope.
 * size = characteristic radius (m). Returns the instance index or -1 if rejected.
 *   o.embed   0..0.6 fraction of the rock's height pushed below the lowest ground under it
 *   o.align   0..1 how much the rock follows the terrain normal
 *   o.tilt    random tilt (rad)
 *   o.water   allow placement where the ground is under water
 *   o.tint    [r,g,b]
 *   o.stretch [sx, sy, sz] extra non-uniform scale
 *   o.maxSlope reject where the ground gradient (rise/run) exceeds this (default 1.3)
 *   o.fast    approximate height sampler for the footprint (defaults to field.fast); the centre
 *             always uses H
 */
export function placeBoulder(field, H, kind, x, z, size, rng, o = {}) {
  const k = field.kinds[kind];
  if (field.avoid && field.avoid(x, z, size)) return -1;
  const reach = size * 0.9;
  const hc = H(x, z);
  // footprint samples may come from a fast approximate sampler (grid) — unless the grid disagrees
  // with the exact centre (metre-scale relief such as the terrain's rock tors): then go exact
  let Hf = o.fast || field.fast || H;
  if (Hf !== H && Math.abs(Hf(x, z) - hc) > 0.35) Hf = H;
  const extra = Hf === H ? 0 : 0.2 + 0.04 * size;
  let hmin = hc;
  let hmax = hc;
  let nx = 0, nz = 0;
  if (size > 1.4) {
    const h1 = Hf(x + reach, z), h2 = Hf(x - reach, z), h3 = Hf(x, z + reach), h4 = Hf(x, z - reach);
    hmin = Math.min(hc, h1, h2, h3, h4);
    hmax = Math.max(hc, h1, h2, h3, h4);
    nx = (h2 - h1) / (2 * reach);
    nz = (h4 - h3) / (2 * reach);
    if (size > 3) {
      // big rocks: also the diagonals, a little further out (their shapes overhang the axes)
      const q = reach * 0.85;
      const d1 = Hf(x + q, z + q), d2 = Hf(x - q, z + q), d3 = Hf(x + q, z - q), d4 = Hf(x - q, z - q);
      hmin = Math.min(hmin, d1, d2, d3, d4);
      hmax = Math.max(hmax, d1, d2, d3, d4);
    }
  } else {
    // three samples at 120 degrees: enough for a plane fit on small stones
    const h1 = Hf(x + reach, z);
    const h2 = Hf(x - reach * 0.5, z + reach * 0.866);
    const h3 = Hf(x - reach * 0.5, z - reach * 0.866);
    hmin = Math.min(hc, h1, h2, h3);
    nx = -(2 * h1 - h2 - h3) / (3 * reach);
    nz = -(h2 - h3) / (1.732 * reach);
  }
  if (!o.water && hmin < 0.6) return -1;
  // nothing clings to sheer walls (its downhill side would hang in the air)
  if (Math.hypot(nx, nz) > (o.maxSlope ?? 1.3)) return -1;
  const stretch = o.stretch || null;
  const sx = size * (stretch ? stretch[0] : 1);
  const sy = size * (stretch ? stretch[1] : 1);
  const sz = size * (stretch ? stretch[2] : 1);
  // orientation: random yaw + tilt, then partially aligned to the ground normal
  // big rocks settle flat (a tilted slab would show a wedge of air under its high edge)
  const tilt = (o.tilt ?? 0.22) * Math.min(1, 2.5 / size);
  _e.set(rng.range(-tilt, tilt), rng.range(0, Math.PI * 2), rng.range(-tilt, tilt), 'YXZ');
  _q.setFromEuler(_e);
  _n.set(nx, 1, nz).normalize();
  _qt.setFromUnitVectors(_up, _n);
  _qi.identity().slerp(_qt, o.align ?? 0.7);
  _q.premultiply(_qi);
  // vertical: bottom goes below the lowest footprint sample by embed * height + margin
  const hgt = (k.maxY - k.minY) * sy;
  const embed = o.embed ?? rng.range(0.12, 0.4);
  // uneven ground (relief not explained by the plane fit) needs a deeper seat
  const rough = Math.max(0, hmax - hmin - 2 * reach * Math.hypot(nx, nz));
  const margin = 0.1 * size + 0.12 + Math.hypot(nx, nz) * 0.3 * size + rough * 0.3 + extra;
  const y = hmin - k.minY * sy - embed * hgt - margin;
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  const t = o.tint || DEFAULT_TINT;
  const r = Math.max(sx, sy, sz) * 1.05;
  return field.add(kind, _m, r, t[0], t[1], t[2]);
}

const DEFAULT_TINT = [1, 1, 1];

/** Pareto-ish size: many small rocks, few big ones. */
export function rockSize(rng, rmin, rmax, alpha = 1.5) {
  const u = rng();
  const r = rmin / Math.pow(1 - u * 0.999, 1 / alpha);
  return Math.min(r, rmax);
}

/** Slightly varied natural tint around a base colour multiplier. */
export function tintAround(rng, base, v = 0.12) {
  const l = 1 + rng.range(-v, v);
  const w = rng.range(-0.04, 0.04);
  return [base[0] * l * (1 + w), base[1] * l, base[2] * l * (1 - w)];
}

// ---------------------------------------------------------------------------
// Basin-wide cluster scatter
// ---------------------------------------------------------------------------

/**
 * Jittered-grid cluster seeds; each seed rolls a probability from slope, altitude, shoreline and a
 * macro "boulder field" noise, then spawns a clump of rocks with a power-law size distribution.
 */
export function scatterClusters(ctx, field, occ, rng, { density = 1, tintFn, G = null } = {}) {
  const H = ctx.heightAt;
  const Hs = G ? G.at : H; // seed tests only need the lay of the land
  const { fbm2 } = ctx.noise.worldNoise;
  const { smoothstep } = ctx.noise;
  const R = ctx.layout.WORLD.playRadius + 200;
  const cell = 90;
  let placed = 0;
  for (let gx = -R; gx < R; gx += cell) {
    for (let gz = -R; gz < R; gz += cell) {
      const x = gx + rng() * cell;
      const z = gz + rng() * cell;
      const roll = rng();
      const rd = Math.hypot(x, z);
      if (rd > R) continue;
      // cheap macro gate first (no height samples)
      const field01 = 0.5 + 0.5 * fbm2(x * 0.0014 + 21.3, z * 0.0014 - 8.1, 3);
      if (roll > 0.12 + field01 * 0.9) continue;
      if (ctx.layout.isReserved(x, z, 30)) continue;
      if (occ.blocked(x, z, 12)) continue;
      const h = Hs(x, z);
      if (h < 0.4) continue;
      const hx = Hs(x + 8, z), hz = Hs(x, z + 8);
      const slope = Math.hypot(hx - h, hz - h) / 8; // rise over run
      const steep = smoothstep(0.25, 0.9, slope);
      const shore = 1 - smoothstep(1.5, 7, h);
      const high = smoothstep(260, 600, h);
      let p = 0.14 + 0.5 * steep + 0.55 * shore + 0.3 * high;
      p *= 0.25 + 1.1 * field01 * field01;
      if (slope > 1.1) p *= 0.12; // sheer walls shed their rocks (and boulders can't sit there)
      p *= density;
      if (roll > p) continue;
      // clump; where the macro field peaks, a whole boulder field (glacial debris) spills out
      const fieldBoost = smoothstep(0.72, 0.9, field01);
      const n = Math.round((3 + rng() * (6 + 16 * p)) * (1 + 2.5 * fieldBoost));
      const spread = (6 + rng() * (12 + 22 * p)) * (1 + 0.9 * fieldBoost);
      const baseTint = tintFn ? tintFn(x, z, h) : [1, 1, 1];
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = spread * Math.sqrt(rng());
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        let size = rockSize(rng, shore > 0.5 ? 0.3 : 0.4, shore > 0.5 ? 2.2 : 5.5, 1.45);
        if (i === 0 && rng() < 0.35 * field01) size = 2.5 + rng() * 4; // one anchor boulder
        let kind;
        const kr = rng();
        if (shore > 0.5) kind = kr < 0.75 ? KIND.round : KIND.slab;
        else if (steep > 0.4) kind = kr < 0.55 ? KIND.block : kr < 0.85 ? KIND.slab : KIND.round;
        else kind = kr < 0.5 ? KIND.round : kr < 0.85 ? KIND.block : KIND.slab;
        if (occ.blocked(px, pz, size) || ctx.layout.isReserved(px, pz, 25)) continue;
        const idx = placeBoulder(field, H, kind, px, pz, size, rng, {
          tint: tintAround(rng, baseTint),
          embed: shore > 0.5 ? rng.range(0.25, 0.5) : undefined,
          water: shore > 0.5,
        });
        if (idx >= 0) placed++;
      }
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Talus / scree aprons
// ---------------------------------------------------------------------------

/**
 * Scatter a talus apron outward from a cliff foot.
 *   foot: [{ x, z, ox, oz, w }] foot points with unit outward direction and a weight (0..1)
 *   step: spacing of foot samples (m)
 */
export function scatterScree(ctx, field, occ, rng, foot, { step = 10, perMetre = 1.1, reach = 150, tint = [1, 1, 1], bigChance = 0.05, H = ctx.heightAt, fast = null } = {}) {
  const { fbm2 } = ctx.noise.worldNoise;
  let placed = 0;
  for (const f of foot) {
    if (f.h === undefined) f.h = (fast || H)(f.x, f.z);
    // talus cones below gullies: strongly varying density along the cliff
    const cone = 0.5 + 0.5 * fbm2(f.x * 0.012 + 3.3, f.z * 0.012 - 1.1, 2);
    const w = f.w * (0.25 + 1.3 * cone * cone);
    const n = Math.round(step * perMetre * w * (0.6 + rng() * 0.8));
    for (let i = 0; i < n; i++) {
      // distance out from the foot: most rocks close in, big ones roll farther
      const u = rng();
      let size = rockSize(rng, 0.35, 4.5, 1.35);
      const big = rng() < bigChance * w;
      if (big) size = 4 + rng() * 7;
      const out = 1 + Math.pow(u, 1.6) * reach * (0.45 + 0.35 * cone) * (0.7 + size * 0.12);
      const along = (rng() - 0.5) * step * 1.2;
      const px = f.x + f.ox * out - f.oz * along;
      const pz = f.z + f.oz * out + f.ox * along;
      if (ctx.layout.isReserved(px, pz, 30)) continue;
      // stay on the apron (or a talus cone), never up on the cliff's ledges
      if ((fast || H)(px, pz) > f.h + 12 + out * 0.9) continue;
      const kr = rng();
      const kind = kr < 0.6 ? KIND.block : kr < 0.9 ? KIND.slab : KIND.round;
      const idx = placeBoulder(field, H, kind, px, pz, size, rng, {
        tint: tintAround(rng, tint, 0.1),
        align: 0.85,
        tilt: 0.35,
        embed: rng.range(0.08, 0.3),
        fast,
      });
      if (idx >= 0) placed++;
    }
  }
  return placed;
}

/**
 * Find the foot of a cliff along a ray: walk outward from (x,z) along (dx,dz) until the ground
 * stops dropping steeply. Returns distance from the start or -1.
 */
export function findCliffFoot(H, x, z, dx, dz, maxDist = 260, step = 6, flat = 0.45) {
  let prev = H(x, z);
  let wasSteep = false;
  for (let d = step; d <= maxDist; d += step) {
    const h = H(x + dx * d, z + dz * d);
    const drop = (prev - h) / step;
    if (drop > 1.0) wasSteep = true;
    else if (wasSteep && drop < flat) return d - step * 0.5;
    prev = h;
  }
  return -1;
}
