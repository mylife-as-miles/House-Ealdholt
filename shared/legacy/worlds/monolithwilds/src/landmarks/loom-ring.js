// The Loom of Hours — the ring itself.
//
// Construction logic (ring-local frame: x = in-plane horizontal, y = up, z = ring axis / depth):
//   * 192 angular slots (1.875° each). Every 8th pair of slots is an "hour-block": 24 dark,
//     glyph-carved collars that clamp the ring and project a stepped tooth outward (the clock
//     face silhouette) and a heddle inward. Midnight (the bottom) has fallen out.
//   * Between hour-blocks, 6 pale limestone voussoirs per hour form the core of the section.
//     A dark basalt crown course (extrados) and soffit course (intrados) run with joints
//     staggered by half a slot, so the section reads as three courses from 300 m.
//   * Face fillets and glyph plates (amber at night) run along both faces; bronze clamp frames
//     wrap the section mid-hour.
//   * A comb of hundreds of basalt heddle teeth lines the intrados; the warp hangs from them.
//   * Weathering: missing voussoirs (see-through gaps), slipped / cracked / rotated blocks,
//     missing crown blocks notching the silhouette, broken teeth. Debris is placed by loom.js.

import * as THREE from 'crownfall-world-three';

export const RING = {
  NSLOT: 192,
  SLOT: (Math.PI * 2) / 192,
  OFF: Math.PI / 2 - (Math.PI * 2) / 192, // slots 8j, 8j+1 straddle hour position j
  R_CORE0: 248,
  R_CORE1: 276.5,
  R_CROWN1: 282,
  R_SOFFIT0: 242.5,
  R_TOOTH: 234.8, // heddle tooth tips (threads hang from here)
  A_CORE: 19.5,
  A_HOUR: 23.5,
  TOOTH_ROWS: [-8.5, 8.5],
};

/** Angle of hour position j (0 = top, counter-clockwise in local frame). */
export const hourAngle = (j) => Math.PI / 2 + (j * Math.PI * 2) / 24;
/** Clock hour shown by position j (noon at the top, hours run clockwise seen from the front). */
export const hourOf = (j) => (((12 - j) % 24) + 24) % 24;
const slotAngle = (k) => RING.OFF + k * RING.SLOT;

// ---------------------------------------------------------------------------
// Triangle soup with per-vertex colour (growable typed arrays), oriented outward by hint vectors.
// ---------------------------------------------------------------------------
export class Tris {
  constructor(capTris = 4096) {
    this.p = new Float32Array(capTris * 9);
    this.c = new Float32Array(capTris * 9);
    this.n = 0; // triangles
  }
  /** Vertex count. */
  get count() {
    return this.n * 3;
  }
  _reserve(extra) {
    const need = (this.n + extra) * 9;
    if (need <= this.p.length) return;
    let cap = this.p.length * 2;
    while (cap < need) cap *= 2;
    const p = new Float32Array(cap);
    p.set(this.p);
    const c = new Float32Array(cap);
    c.set(this.c);
    this.p = p;
    this.c = c;
  }
  _put(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    this._reserve(1);
    const o = this.n * 9;
    const p = this.p;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    const c = this.c;
    for (let i = 0; i < 9; i += 3) {
      c[o + i] = col[0];
      c[o + i + 1] = col[1];
      c[o + i + 2] = col[2];
    }
    this.n++;
  }
  tri(a, b, c, out, col) {
    if (out) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) {
        const t = b;
        b = c;
        c = t;
      }
    }
    this._put(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
  }
  /** Transform vertices from vertex index `start` on by a Matrix4. */
  transformFrom(start, m4) {
    const e = m4.elements;
    const p = this.p;
    for (let i = start * 3, n = this.n * 9; i < n; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
  }
  /** Append another sink, optionally transformed. */
  append(other, m4 = null) {
    const start = this.count;
    this._reserve(other.n);
    this.p.set(other.p.subarray(0, other.n * 9), this.n * 9);
    this.c.set(other.c.subarray(0, other.n * 9), this.n * 9);
    this.n += other.n;
    if (m4) this.transformFrom(start, m4);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.slice(0, this.n * 9), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.slice(0, this.n * 9), 3));
    g.computeVertexNormals();
    return g;
  }
}

// unit box corners and faces (outward CCW)
const BOX_V = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
const BOX_F = [
  [4, 5, 6], [4, 6, 7], [1, 0, 3], [1, 3, 2], [5, 1, 2], [5, 2, 6],
  [0, 4, 7], [0, 7, 3], [7, 6, 2], [7, 2, 3], [0, 1, 5], [0, 5, 4],
];
const _bv = new Float32Array(24);

/** Box (sx, sy, sz centred at origin) transformed by m4, appended as triangles. */
export function boxTris(sink, sx, sy, sz, m4, col) {
  const e = m4.elements;
  for (let i = 0; i < 8; i++) {
    const x = BOX_V[i][0] * sx, y = BOX_V[i][1] * sy, z = BOX_V[i][2] * sz;
    _bv[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    _bv[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    _bv[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  for (const [a, b, c] of BOX_F) {
    sink._put(_bv[a * 3], _bv[a * 3 + 1], _bv[a * 3 + 2], _bv[b * 3], _bv[b * 3 + 1], _bv[b * 3 + 2], _bv[c * 3], _bv[c * 3 + 1], _bv[c * 3 + 2], col);
  }
}

/** Any geometry appended as triangles (transformed by m4). Keeps the geometry's own winding. */
export function geoTris(sink, geo, m4, col) {
  const pa = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : pa.length / 3;
  const e = m4 ? m4.elements : null;
  sink._reserve(n / 3);
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx[i + k] : i + k;
      const x = pa[vi * 3], y = pa[vi * 3 + 1], z = pa[vi * 3 + 2];
      if (e) {
        v[k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        v[k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        v[k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      } else {
        v[k * 3] = x;
        v[k * 3 + 1] = y;
        v[k * 3 + 2] = z;
      }
    }
    sink._put(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], col);
  }
}

const P = (r, a, t) => [r * Math.cos(t), r * Math.sin(t), a];

function octagon(r0, r1, a0, a1, b) {
  return [
    [r0 + b, a0], [r1 - b, a0], [r1, a0 + b], [r1, a1 - b],
    [r1 - b, a1], [r0 + b, a1], [r0, a1 - b], [r0, a0 + b],
  ];
}

/**
 * Chamfered curved block: section [r0,r1] x [a0,a1] swept from angle t0 to t1 (local frame).
 * `segs` flat facets along the arc. Colour `col` = [r,g,b] tint.
 */
export function arcBlock(sink, r0, r1, a0, a1, t0, t1, bv, col, segs = 1) {
  const rm = (r0 + r1) / 2;
  const am = (a0 + a1) / 2;
  bv = Math.min(bv, (r1 - r0) * 0.3, (a1 - a0) * 0.3);
  const db = Math.min(bv / rm, (t1 - t0) * 0.2);
  const full = octagon(r0, r1, a0, a1, bv);
  const inset = octagon(r0 + bv, r1 - bv, a0 + bv, a1 - bv, bv * 0.35);
  const st = [[t0, inset]];
  for (let s = 0; s <= segs; s++) st.push([t0 + db + ((t1 - t0 - 2 * db) * s) / segs, full]);
  st.push([t1, inset]);
  for (let s = 0; s < st.length - 1; s++) {
    const [ta, pa] = st[s];
    const [tb, pb] = st[s + 1];
    const tm = (ta + tb) / 2;
    const cen = P(rm, am, tm);
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      const q0 = P(pa[k][0], pa[k][1], ta);
      const q1 = P(pa[k2][0], pa[k2][1], ta);
      const q2 = P(pb[k2][0], pb[k2][1], tb);
      const q3 = P(pb[k][0], pb[k][1], tb);
      const out = [
        (q0[0] + q1[0] + q2[0] + q3[0]) / 4 - cen[0],
        (q0[1] + q1[1] + q2[1] + q3[1]) / 4 - cen[1],
        (q0[2] + q1[2] + q2[2] + q3[2]) / 4 - cen[2],
      ];
      sink.tri(q0, q1, q2, out, col);
      sink.tri(q0, q2, q3, out, col);
    }
  }
  // caps
  for (const [t, prof, sgn] of [[t0, inset, -1], [t1, inset, 1]]) {
    const out = [-Math.sin(t) * sgn, Math.cos(t) * sgn, 0];
    const c = P(rm, am, t);
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      sink.tri(c, P(prof[k][0], prof[k][1], t), P(prof[k2][0], prof[k2][1], t), out, col);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Build the ring in its local frame. Returns sinks per material plus layout info:
 *   { sinks: {stone, basalt, glyph, bronze, glow}, teeth: [{t, a, x, y, z, ok}], missing, slipped }
 */
export function buildRingLocal(rng) {
  const { NSLOT, SLOT } = RING;
  const stone = new Tris();
  const basalt = new Tris();
  const glyph = new Tris();
  const bronze = new Tris();
  const glow = new Tris(); // hour discs (colour.r carries the hour index / 24)

  const gapJ = 3 * 0.35 / 262; // joint gap (rad) ~0.35 m
  const tint = (lo, hi, warm = 0) => {
    const v = lo + (hi - lo) * rng();
    return [v * (1 + warm), v, v * (1 - warm * 0.6)];
  };

  // --- which slots are missing / damaged -----------------------------------
  const missingCore = new Set([59, 60, 115, 172]);
  const missingAll = new Set([59, 60, 115]); // whole section gone (sky visible)
  const MIDNIGHT = 12; // hour position j at the bottom: fallen
  const slipped = new Map(); // slot -> {dr, rot, dt}
  for (const k of [58, 61, 114, 116, 171, 173]) slipped.set(k, { dr: rng.range(-1.6, 2.4), rot: rng.range(-0.012, 0.012), dt: rng.range(-0.002, 0.002) });
  for (let k = 0; k < NSLOT; k++) {
    if (!slipped.has(k) && rng.chance(0.07)) slipped.set(k, { dr: rng.range(-0.7, 0.9), rot: rng.range(-0.004, 0.004), dt: 0 });
  }
  const isHourSlot = (k) => k % 8 === 0 || k % 8 === 1;
  const hourOfSlot = (k) => Math.floor(k / 8);

  const blockMatrix = (k, s) => {
    // rotate about the block's own centre on the ring axis, then push radially
    const t = slotAngle(k + 0.5);
    const cx = 262 * Math.cos(t), cy = 262 * Math.sin(t);
    const m = new THREE.Matrix4().makeTranslation(-cx, -cy, 0);
    m.premultiply(new THREE.Matrix4().makeRotationZ(s.rot));
    m.premultiply(new THREE.Matrix4().makeTranslation(cx + Math.cos(t) * s.dr, cy + Math.sin(t) * s.dr, 0));
    m.premultiply(new THREE.Matrix4().makeRotationZ(s.dt));
    return m;
  };

  // --- core voussoirs: inner lip, recessed glyph channel, main block, roll moulding ----------
  // Radially each voussoir is three stones: a thin inner lip, a glyph-carved channel recessed
  // 1.3 m into both faces (a continuous inscribed circle, amber at night) and the main block.
  for (let k = 0; k < NSLOT; k++) {
    if (isHourSlot(k)) continue;
    const t0 = slotAngle(k) + gapJ * 0.5;
    const t1 = slotAngle(k + 1) - gapJ * 0.5;
    const s = slipped.get(k);
    if (missingCore.has(k)) continue;
    const st0 = stone.count;
    const gl0 = glyph.count;
    const col = tint(1.16, 1.46, rng.range(-0.03, 0.05));
    const A = RING.A_CORE;
    arcBlock(stone, RING.R_CORE0, 250.4, -A, A, t0, t1, 0.35, col);
    if (!rng.chance(0.05)) arcBlock(glyph, 250.2, 258.9, -A + 1.3, A - 1.3, t0, t1, 0.2, tint(0.92, 1.05));
    const cracked = rng.chance(0.14);
    if (cracked) {
      // split through the depth: two halves with a dark crack between them
      const ac = rng.range(-9, 9);
      arcBlock(stone, 258.7, RING.R_CORE1, -A, ac - 0.3, t0, t1, 0.45, col);
      arcBlock(stone, 258.7 + rng.range(-0.3, 0.6), RING.R_CORE1 + rng.range(-0.9, 0.3), ac + 0.3, A, t0, t1, 0.45, col);
    } else {
      arcBlock(stone, 258.7, RING.R_CORE1, -A, A, t0, t1, 0.5, col);
    }
    // raised roll mouldings on both faces
    for (const sg of [-1, 1]) {
      const a0 = sg > 0 ? A - 0.2 : -A - 1.6;
      const a1 = sg > 0 ? A + 1.6 : -A + 0.2;
      arcBlock(stone, 268.5, 273.5, a0, a1, t0, t1, 0.6, col);
    }
    if (s) {
      const m = blockMatrix(k, s);
      stone.transformFrom(st0, m);
      glyph.transformFrom(gl0, m);
    }
  }

  // --- crown (extrados, pale) and soffit (intrados, basalt) courses, staggered --------
  const crownMissing = new Set();
  for (let i = 0; i < 9; i++) crownMissing.add(rng.int(0, NSLOT - 1));
  for (let k = 0; k < NSLOT; k++) {
    const t0 = slotAngle(k + 0.5) + gapJ * 0.5;
    const t1 = slotAngle(k + 1.5) - gapJ * 0.5;
    const kc = (k + 1) % NSLOT; // slot this piece is centred on the boundary of
    if (k % 8 === 0) continue; // fully inside an hour-block
    // pieces touching a fully missing slot are gone too
    if (missingAll.has(k) || missingAll.has(kc)) continue;
    if (hourOfSlot(k) === MIDNIGHT && isHourSlot(k)) continue;
    if (hourOfSlot(kc) === MIDNIGHT && isHourSlot(kc)) continue;
    const s = slipped.get(k) || slipped.get(kc);
    const b0 = basalt.count;
    const s0 = stone.count;
    if (!crownMissing.has(k)) {
      arcBlock(stone, 275.8, RING.R_CROWN1, -14.5, 14.5, t0, t1, 0.45, tint(1.2, 1.45, 0.04));
      // dark transverse ribs on the crown (a stair no one could climb: it runs up the sides)
      for (let r = 0; r < 3; r++) {
        const tr = t0 + ((t1 - t0) * (r + 0.5)) / 3;
        arcBlock(basalt, RING.R_CROWN1 - 0.2, RING.R_CROWN1 + 1.2, -11, 11, tr - 0.0024, tr + 0.0024, 0.2, tint(0.8, 1.0));
      }
    }
    const soffitGone = (k === 171 || k === 172) || rng.chance(0.03);
    if (!soffitGone) arcBlock(basalt, RING.R_SOFFIT0, 248.6, -15.5, 15.5, t0, t1, 0.45, tint(0.8, 1.1));
    if (s) {
      const m = blockMatrix(k, { ...s, rot: s.rot * 0.5 });
      basalt.transformFrom(b0, m);
      stone.transformFrom(s0, m);
    }
  }

  // --- hour-blocks -----------------------------------------------------------
  const hourDiscs = [];
  const hourTip = {}; // j -> outer radius of the finial (for tethers)
  for (let j = 0; j < 24; j++) {
    if (j === MIDNIGHT) continue;
    const tc = hourAngle(j);
    const hs = SLOT;
    const col = tint(0.85, 1.05);
    const cardinal = j % 6 === 0; // noon, 6 and 18: the great hours
    const quarter = j % 3 === 0;
    const broken = quarter && !cardinal && rng.chance(0.25); // finial snapped off
    const ext = cardinal ? 1.9 : 1.25;
    hourTip[j] = !quarter ? 289 : broken ? 292 : 284.5 + 8 * ext + 16.5 * ext;
    // body: collar bigger than the section in every direction
    arcBlock(glyph, 240.5, 285.5, -RING.A_HOUR, RING.A_HOUR, tc - hs + gapJ * 0.5, tc + hs - gapJ * 0.5, 0.9, col);
    if (!quarter) {
      // minor hours: a low stepped cap only
      arcBlock(glyph, 285, 289.5, -15, 15, tc - hs * 0.7, tc + hs * 0.7, 0.6, col);
    } else {
      // every third hour: a stepped finial (the clock-face silhouette), the great hours doubled
      arcBlock(glyph, 285, 285 + 8 * ext, -17, 17, tc - hs * 0.78, tc + hs * 0.78, 0.6, col);
      if (!broken) {
        const r2 = 284.5 + 8 * ext;
        arcBlock(glyph, r2, r2 + 9.5 * ext, -12.5, 12.5, tc - hs * 0.52, tc + hs * 0.52, 0.5, col);
        arcBlock(glyph, r2 + 9.5 * ext - 0.5, r2 + 9.5 * ext + 7 * ext, -8, 8, tc - hs * 0.28, tc + hs * 0.28, 0.4, col);
        if (cardinal) arcBlock(bronze, r2 + 16.5 * ext - 0.6, r2 + 16.5 * ext + 5, -3.5, 3.5, tc - hs * 0.12, tc + hs * 0.12, 0.3, [1, 1, 1]);
      } else {
        // jagged stump
        arcBlock(glyph, 292.5, 292.5 + rng.range(2, 6), -12.5, rng.range(-4, 8), tc - hs * 0.52, tc + hs * rng.range(0, 0.5), 0.5, col);
      }
    }
    // inward heddle (a heavier tooth at every hour)
    arcBlock(basalt, 231, 241, -13, 13, tc - hs * 0.45, tc + hs * 0.45, 0.5, tint(0.8, 1.0));
    arcBlock(basalt, 224, 231.5, -6, 6, tc - hs * 0.22, tc + hs * 0.22, 0.4, tint(0.8, 1.0));
    // a doorway on each face of the collar, oriented radially — on the lower arc the doors hang
    // upside-down, as if the ring once turned and every hour passed through noon
    for (const sg of [-1, 1]) {
      const af = sg * RING.A_HOUR;
      const dw = 4.4 / 278;
      arcBlock(basalt, 273.2, 282.6, af - 0.25, af + 0.25, tc - dw / 2, tc + dw / 2, 0.1, [0.14, 0.13, 0.12]);
      const a0 = sg > 0 ? af : af - 1.45;
      arcBlock(stone, 282.2, 284.9, a0, a0 + 1.45, tc - 3.6 / 278, tc + 3.6 / 278, 0.2, [1.05, 1.0, 0.92]);
      const b0 = sg > 0 ? af : af - 2.2;
      arcBlock(stone, 271.6, 273.2, b0, b0 + 2.2, tc - 3.9 / 272, tc + 3.9 / 272, 0.2, [1.05, 1.0, 0.92]);
    }
    // bronze rims on the collar's faces
    for (const sg of [-1, 1]) {
      const a0 = sg > 0 ? RING.A_HOUR - 0.1 : -RING.A_HOUR - 0.9;
      const a1 = sg > 0 ? RING.A_HOUR + 0.9 : -RING.A_HOUR + 0.1;
      arcBlock(bronze, 241.5, 244, a0, a1, tc - hs * 0.9, tc + hs * 0.9, 0.2, [1, 1, 1]);
      arcBlock(bronze, 282, 284.5, a0, a1, tc - hs * 0.9, tc + hs * 0.9, 0.2, [1, 1, 1]);
      // hour disc boss + glowing eye
      const dr = 262.5;
      const boss = new THREE.CylinderGeometry(8.5, 9.5, 1.6, 28, 1);
      const eye = new THREE.CylinderGeometry(4.2, 4.2, 0.4, 24, 1);
      const ring = new THREE.TorusGeometry(6.3, 0.55, 6, 32);
      const m = new THREE.Matrix4()
        .makeTranslation(dr * Math.cos(tc), dr * Math.sin(tc), sg * (RING.A_HOUR + 0.8))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 * sg));
      geoTris(glyph, boss, m, col);
      const me = new THREE.Matrix4()
        .makeTranslation(dr * Math.cos(tc), dr * Math.sin(tc), sg * (RING.A_HOUR + 1.65))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 * sg));
      geoTris(glow, eye, me, [hourOf(j) / 24, 0, 0]);
      const mr = new THREE.Matrix4().makeTranslation(dr * Math.cos(tc), dr * Math.sin(tc), sg * (RING.A_HOUR + 1.7));
      geoTris(bronze, ring, mr, [1, 1, 1]);
      boss.dispose();
      eye.dispose();
      ring.dispose();
    }
    hourDiscs.push({ j, t: tc });
  }

  // --- bronze clamp frames mid-hour ---------------------------------------------
  for (let k = 0; k < NSLOT; k++) {
    if (k % 8 !== 5) continue;
    if (missingCore.has(k) || missingCore.has(k - 1)) continue;
    const t = slotAngle(k);
    const w = 0.9 / 262;
    const r0 = 241.2, r1 = 283.6, A = 21.2, th = 1.2;
    arcBlock(bronze, r1 - th, r1, -A, A, t - w, t + w, 0.15, [1, 1, 1]);
    arcBlock(bronze, r0, r0 + th, -A, A, t - w, t + w, 0.15, [1, 1, 1]);
    arcBlock(bronze, r0, r1, A - th, A, t - w, t + w, 0.15, [1, 1, 1]);
    arcBlock(bronze, r0, r1, -A, -A + th, t - w, t + w, 0.15, [1, 1, 1]);
  }

  // --- heddle teeth comb ----------------------------------------------------------
  const teeth = [];
  const toothGeo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  {
    // tapered tooth: base 1.6 x 1.6 at y=0, tip 0.5 x 0.5 at y=1 (scaled by length)
    const p = toothGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 0.5;
      const w = 1.6 + (0.5 - 1.6) * y;
      p.setXYZ(i, p.getX(i) * w, y, p.getZ(i) * w);
    }
  }
  const NT = NSLOT * 3;
  for (let i = 0; i < NT; i++) {
    const k = Math.floor(i / 3);
    const tr = RING.OFF + (i + 0.5) * (SLOT / 3);
    const t = tr % (Math.PI * 2); // keep in [0, 2π) so the warp layout can filter by angle
    if (isHourSlot(k)) continue;
    if (missingAll.has(k) || k === 171 || k === 172) continue;
    if (k % 8 === 5 && i % 3 === 0) continue; // clamp frame
    // the comb is dense where the warp hangs (upper arc) and thins out, worn and broken, below
    const lowerHalf = Math.sin(t) < -0.2;
    if (lowerHalf && i % 3 !== 1) continue;
    for (const a of RING.TOOTH_ROWS) {
      const broken = rng.chance(lowerHalf ? 0.45 : 0.05);
      if (lowerHalf && broken && rng.chance(0.5)) continue;
      const len = broken ? rng.range(2, 5) : 242.6 - RING.R_TOOTH;
      const m = new THREE.Matrix4()
        .makeTranslation(242.6 * Math.cos(t), 242.6 * Math.sin(t), a)
        .multiply(new THREE.Matrix4().makeRotationZ(t + Math.PI / 2))
        .multiply(new THREE.Matrix4().makeScale(1, len, 1));
      geoTris(bronze, toothGeo, m, tint(0.85, 1.05));
      const tipR = 242.6 - len;
      teeth.push({ t, a, k, x: tipR * Math.cos(t), y: tipR * Math.sin(t), ok: !broken });
    }
  }
  toothGeo.dispose();

  return {
    sinks: { stone, basalt, glyph, bronze, glow },
    teeth,
    hourDiscs,
    hourTip,
    missingAll,
    missingCore,
    slotAngle,
    midnight: MIDNIGHT,
  };
}

/**
 * Hour-disc glow material: unlit, faint by day, bright at night; the disc whose hour matches the
 * current time of day burns brightest (the ring is a clock). colour.r of the geometry = hour/24.
 */
export function createHourGlowMaterial(ctx) {
  const uniforms = { uLoomTime: { value: ctx.atmo.time } };
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb35c') });
  mat.name = 'loom-hours';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying float vHour;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHour = color.r * 24.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uLoomTime;\nvarying float vHour;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float dh = abs(vHour - uLoomTime.w);
          dh = min(dh, 24.0 - dh);
          float now = 1.0 - smoothstep(0.0, 1.2, dh);
          float night = uLoomTime.y;
          float breathe = 0.8 + 0.2 * sin(uLoomTime.x * 0.35 + vHour * 1.7);
          float lvl = mix(0.08, 1.6, night) * breathe + now * mix(1.2, 6.5, night);
          diffuseColor.rgb *= lvl;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.0, 0.85, 0.7), now);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'loom-hours-v1';
  return mat;
}

/**
 * Small conifers and shrubs rooted in cracks along the crown of the upper arc — a scale cue and
 * a sign of age. Ring-local, into the given sink (dark basalt with a green vertex tint reads as
 * foliage in silhouette). Trees grow toward world up (the ring is only yawed, so local y = up).
 */
export function addCrownTrees(sink, rng) {
  const cone = new THREE.ConeGeometry(1, 1, 7, 1);
  const trunk = new THREE.CylinderGeometry(0.28, 0.4, 1, 5, 1);
  const m = new THREE.Matrix4();
  const place = (x, y, z, h) => {
    const w = h * rng.range(0.22, 0.3);
    geoTris(sink, trunk, m.compose(new THREE.Vector3(x, y + h * 0.12, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.3, 1)), [0.9, 0.75, 0.6]);
    for (let k = 0; k < 3; k++) {
      const hk = h * (0.5 - k * 0.1);
      const yk = y + h * (0.28 + k * 0.22) + hk / 2;
      const wk = w * (1 - k * 0.28);
      const g = rng.range(1.5, 2.3);
      geoTris(sink, cone, m.compose(new THREE.Vector3(x, yk, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6), new THREE.Vector3(wk, hk, wk)), [0.75, g, 0.6]);
    }
  };
  let clusters = 0;
  for (let i = 0; i < 400 && clusters < 16; i++) {
    const t = rng.range(0.35, Math.PI - 0.35);
    // only where the crown is roughly level enough to hold soil
    if (Math.sin(t) < 0.8) continue;
    const hourPos = ((t - Math.PI / 2) / ((Math.PI * 2) / 24) + 48) % 1;
    if (hourPos < 0.12 || hourPos > 0.88) continue; // not on the hour-block finials
    clusters++;
    const n = rng.int(2, 6);
    for (let k = 0; k < n; k++) {
      const tt = t + rng.range(-0.012, 0.012);
      const a = rng.range(-12, 12);
      const r = 282.2;
      const h = rng.chance(0.3) ? rng.range(2, 4) : rng.range(6, 15);
      place(r * Math.cos(tt), r * Math.sin(tt) - 0.4, a, h);
    }
  }
  cone.dispose();
  trunk.dispose();
}
