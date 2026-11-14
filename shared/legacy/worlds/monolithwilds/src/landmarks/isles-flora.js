// Unmoored Isles — living things: umbrella pines, cypresses and round trees on the caps (the
// ones at the rim lean out over the void), shrubs, vines draping the cliffs, and roots hanging
// from the undersides — long tapering tubes, some forked, reaching far into the air.

import { T } from './isles-geo.js';
import { tube, slotAll } from './isles-arch.js';
import { worldNoise } from '../core/noise.js';

const TAU = Math.PI * 2;

const LEAF_TINTS = [
  [0.9, 1.0, 0.9], [0.78, 0.9, 0.85], [1.05, 1.05, 0.82], [0.7, 0.82, 0.78], [1.0, 0.95, 0.75], [0.85, 0.95, 1.0],
];

/** One tree. lean (rad) tilts it toward leanDir (yaw). */
function tree(A, rng, x, y, z, kind, s, lean = 0, leanDir = 0) {
  const lx = Math.sin(leanDir) * Math.sin(lean), lz = Math.cos(leanDir) * Math.sin(lean);
  const tint = LEAF_TINTS[Math.floor(rng() * LEAF_TINTS.length)];
  const k = 0.85 + rng() * 0.3;
  const leaf = [tint[0] * k, tint[1] * k, tint[2] * k];
  const bark = 0.7 + rng() * 0.3;
  if (kind === 'pine') {
    const h = 12 * s;
    const pts = [];
    const bend = (rng() - 0.5) * 0.3;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const w = Math.sin(t * Math.PI) * bend * h * 0.12;
      pts.push([x + lx * h * t + w, y - 0.8 + h * t * Math.cos(lean), z + lz * h * t + w * 0.5]);
    }
    tube(A.wood, pts, (t) => 0.42 * s * (1 - t * 0.6), 5, bark);
    const top = pts[5];
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const r = (i === 0 ? 0 : 1.6 + rng() * 2.4) * s;
      const cx = top[0] + Math.cos(a) * r, cz = top[2] + Math.sin(a) * r;
      const cy = top[1] + (i === 0 ? 0.6 : -rng() * 1.6) * s;
      if (i > 0) tube(A.wood, [[top[0], top[1] - 1.2 * s, top[2]], [cx, cy - 0.3 * s, cz]], 0.16 * s, 4, bark);
      A.foliage.put(T.ico1, cx, cy, cz, (3.2 + rng() * 1.4) * s, (1.05 + rng() * 0.5) * s, (3.0 + rng() * 1.4) * s, 0, rng() * TAU, 0, leaf);
    }
  } else if (kind === 'cypress') {
    const h = 15 * s;
    tube(A.wood, [[x, y - 0.6, z], [x + lx * 3, y + 3 * s, z + lz * 3]], 0.35 * s, 5, bark);
    A.foliage.put(T.ico1, x + lx * h * 0.45, y + h * 0.45, z + lz * h * 0.45, 2.0 * s, h * 0.45, 2.0 * s, lean * Math.cos(leanDir), rng() * TAU, -lean * Math.sin(leanDir), leaf);
    A.foliage.put(T.ico1, x + lx * h * 0.25, y + h * 0.28, z + lz * h * 0.25, 2.5 * s, h * 0.22, 2.5 * s, 0, rng() * TAU, 0, [leaf[0] * 0.9, leaf[1] * 0.9, leaf[2] * 0.9]);
  } else {
    const h = 6 * s;
    const pts = [[x, y - 0.6, z], [x + lx * h * 0.5, y + h * 0.5, z + lz * h * 0.5], [x + lx * h, y + h, z + lz * h]];
    tube(A.wood, pts, (t) => 0.5 * s * (1 - t * 0.5), 5, bark);
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const r = (i === 0 ? 0 : 2 + rng() * 1.8) * s;
      A.foliage.put(T.ico1, pts[2][0] + Math.cos(a) * r, pts[2][1] + (1.2 + rng() * 2.2 - r * 0.25) * s, pts[2][2] + Math.sin(a) * r, (2.4 + rng() * 1.2) * s, (2.0 + rng() * 1.0) * s, (2.4 + rng() * 1.2) * s, 0, rng() * TAU, 0, leaf);
    }
  }
}

/** Trees + shrubs on one isle's cap. */
export function plantIsle(A, sh, rng, { trees, shrubs, kinds = ['pine', 'round', 'cypress'], scale = 1 }) {
  slotAll(A, sh.spec.slot);
  let planted = 0;
  for (let tries = 0; planted < trees && tries < trees * 20; tries++) {
    const th = rng() * TAU;
    const rimTree = rng() < 0.3;
    const u = rimTree ? 0.84 + rng() * 0.1 : Math.sqrt(rng()) * 0.86;
    const r = sh.R(th) * u;
    const x = sh.cx + Math.cos(th) * r, z = sh.cz + Math.sin(th) * r;
    if (!sh.free(x, z, 3, 0.95)) continue;
    // loose groves: accept more readily where a noise field is high
    if (worldNoise.fbm2(x * 0.02 + sh.spec.seed, z * 0.02, 2) < -0.25 && rng() < 0.7) continue;
    const kind = rimTree ? (rng() < 0.7 ? 'pine' : 'round') : kinds[Math.floor(rng() * kinds.length)];
    const s = scale * (0.7 + rng() * 0.6);
    const lean = rimTree ? 0.18 + rng() * 0.35 : rng() * 0.08;
    const leanDir = Math.atan2(Math.cos(th), Math.sin(th));
    tree(A, rng, x, sh.topAt(x, z), z, kind, s, lean, rimTree ? leanDir : rng() * TAU);
    sh.reserve.push({ x, z, r: 2.5 * s });
    planted++;
  }
  for (let n = 0; n < shrubs; n++) {
    const th = rng() * TAU;
    const u = Math.sqrt(rng()) * 0.97;
    const r = sh.R(th) * u;
    const x = sh.cx + Math.cos(th) * r, z = sh.cz + Math.sin(th) * r;
    if (!sh.free(x, z, 1, 0.99)) continue;
    const s = (0.7 + rng() * 1.3) * scale;
    const tint = LEAF_TINTS[Math.floor(rng() * LEAF_TINTS.length)];
    A.foliage.put(T.ico0, x, sh.topAt(x, z) + s * 0.25, z, s * 1.3, s * 0.8, s * 1.2, 0, rng() * TAU, 0, [tint[0] * 0.8, tint[1] * 0.85, tint[2] * 0.8]);
  }
}

/** Vines draping the cliff band (outward-facing ribbons following the rock). */
export function vines(A, sh, body, rng, count) {
  slotAll(A, sh.spec.slot);
  for (let n = 0; n < count; n++) {
    const th = rng() * TAU;
    const w = 1.2 + rng() * 2.2;
    const extra = rng() * 14;
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const p = body.cliff(th, k / 5);
      pts.push([p.x + p.c * 0.5, p.y + (k === 0 ? 0.8 : 0), p.z + p.s * 0.5, p.c, p.s]);
    }
    if (extra > 3) {
      const p = body.under(th, 0.04);
      pts.push([p.x + p.c * 0.6, p.y - extra, p.z + p.s * 0.6, p.c, p.s]);
    }
    const nv = pts.length * 2;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const I = [];
    const tint = LEAF_TINTS[Math.floor(rng() * LEAF_TINTS.length)];
    pts.forEach((p, k) => {
      const f = k / (pts.length - 1);
      const hw = (w / 2) * (1 - f * 0.7);
      const sx = -p[4], sz = p[3];
      for (let e = 0; e < 2; e++) {
        const sg = e ? 1 : -1;
        const o = (k * 2 + e) * 3;
        P[o] = p[0] + sx * hw * sg;
        P[o + 1] = p[1] - (e ? f * 1.5 : 0);
        P[o + 2] = p[2] + sz * hw * sg;
        N[o] = p[3];
        N[o + 1] = 0.25;
        N[o + 2] = p[4];
        const d = 0.75 - f * 0.25;
        C[o] = tint[0] * d;
        C[o + 1] = tint[1] * d;
        C[o + 2] = tint[2] * d;
      }
    });
    for (let k = 0; k < pts.length - 1; k++) {
      const l0 = k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
      I.push(l0, r0, l1, r0, r1, l1);
    }
    A.foliage.raw(P, N, I, C);
  }
}

/** Roots hanging from the underside (and a few long ones from the spike tips). */
export function roots(A, sh, body, rng, count, maxLen, r0, groundAt) {
  slotAll(A, sh.spec.slot);
  const one = (x, y, z, c, s, len, rad, depth) => {
    const floor = groundAt(x, z) + 42;
    const L = Math.max(4, Math.min(len, y - floor));
    const n = Math.max(6, Math.round(L / 4));
    const pts = [[x - c * 0.6, y + 0.8, z - s * 0.6]];
    const out = 1.5 + rng() * 3;
    const ph = rng() * 10;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const w = Math.sin(t * 5 + ph) * L * 0.035;
      pts.push([x + c * out * Math.sqrt(t) + s * w, y - L * t, z + s * out * Math.sqrt(t) - c * w]);
    }
    tube(A.wood, pts, (t) => rad * Math.pow(1 - t, 1.3) + 0.05, 5, 0.55 + rng() * 0.25);
    if (depth === 0 && rng() < 0.45) {
      const k = Math.floor(n * (0.25 + rng() * 0.3));
      const p = pts[k];
      one(p[0], p[1], p[2], c * 0.4 + s * 0.6, s * 0.4 - c * 0.6, L * (0.35 + rng() * 0.3), rad * 0.45, 1);
    }
  };
  for (let i = 0; i < count; i++) {
    const th = rng() * TAU;
    const t = 0.03 + Math.pow(rng(), 1.4) * 0.6;
    const p = body.under(th, t);
    one(p.x, p.y, p.z, p.c, p.s, maxLen * (0.3 + rng() * 0.7), r0 * (0.5 + rng() * 0.6), 0);
  }
  for (const sp of body.spikes) {
    if (rng() < 0.5) one(sp.x, sp.y + 2, sp.z, 1, 0, maxLen * (0.4 + rng() * 0.4), r0 * 0.5, 1);
  }
}
