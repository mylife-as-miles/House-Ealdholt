// The large natural formations: sea stacks + islets + a sea arch in the lake, natural arches,
// hoodoo fields (mesa foot, crater slopes), basalt colonnades (canyon rims, lake causeway),
// foothill spires, giant erratics (some impossibly balanced) and talus aprons under the cliffs.
//
// Each builder writes into per-region MeshWriters (`K.w(region, material)`) — merged later into one
// mesh per region x material — and adds loose debris to the instanced BoulderField.

import * as THREE from 'crownfall-world-three';
import { MeshWriter, rockShape, rockGeometry, writePillar, writeArch, writeColumn, writeLyingColumn } from './rocks-geo.js';
import { KIND, placeBoulder, rockSize, tintAround, scatterScree, findCliffFoot } from './rocks-scatter.js';

const TAU = Math.PI * 2;
const SUN_GATE = -Math.PI + 0.087; // bearing of the western Sun Gate (see core/terrain-height.js)
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function mat4(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Min ground height over a disc (centre + n points on the rim). */
export function groundMin(H, x, z, r, n = 6) {
  let m = H(x, z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    m = Math.min(m, H(x + Math.cos(a) * r, z + Math.sin(a) * r));
  }
  return m;
}

/**
 * Irregular hard/soft layering: every bed gets its own random resistance, neighbours blend over
 * part of the bed. There is no repeating period, so pillars don't read as stacked coins.
 * Returns roughly -1..1.
 */
function layers(y, step, seed) {
  const s = y / step + 0.6 * Math.sin(y * 0.045 + seed) + 0.3 * Math.sin(y * 0.13 - seed);
  const k = Math.floor(s);
  const f = s - k;
  const a = hash1(k + seed * 7.3);
  const b = hash1(k + 1 + seed * 7.3);
  const m = f < 0.55 ? 0 : (f - 0.55) / 0.45;
  return (a + (b - a) * m * m * (3 - 2 * m)) * 2 - 1;
}

/** Irregular colour bedding (vertex-tint multiplier ~0.8..1.15) matching the geometric layers. */
function bandTint(y, step, seed) {
  const s = y / step + 0.5 * Math.sin(y * 0.037 + seed) + 0.25 * Math.sin(y * 0.11 - seed);
  const k = Math.floor(s);
  const f = s - k;
  const a = hash1(k * 1.7 + seed);
  const b = hash1((k + 1) * 1.7 + seed);
  const m = f < 0.8 ? 0 : (f - 0.8) / 0.2;
  const v = a + (b - a) * m;
  return 0.76 + 0.4 * v * v;
}

function hash1(k) {
  return frac(Math.sin(k * 91.7 + 13.13) * 43758.5453);
}

function frac(x) {
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Shared kit: writers, rng, precomputed rock recipes for caps / islets / erratics
// ---------------------------------------------------------------------------

export function createKit(ctx, field, occ, G) {
  const writers = new Map();
  const kit = {
    ctx,
    H: ctx.heightAt,
    /** fast approximate heights (terrain world grid) for searches and footprint tests */
    Hg: G ? G.at : ctx.heightAt,
    field,
    occ,
    rng: ctx.noise.createRng('rocks-formations'),
    writers,
    detail: ctx.quality.level === 'low' ? 0.6 : 1,
    stats: {},
    w(region, material) {
      const key = `${region}|${material}`;
      let e = writers.get(key);
      if (!e) writers.set(key, (e = { region, material, writer: null }));
      if (!e.writer) e.writer = new MeshWriter(8192, kit.detail);
      return e.writer;
    },
    count(name, n = 1) {
      kit.stats[name] = (kit.stats[name] || 0) + n;
    },
  };
  // precomputed recipes: slab caps (320 / 720 tris), big boulders (980 / 2880 tris)
  kit.caps = [0, 1, 2, 3].map((i) => {
    const sh = rockShape(`cap${i}`, i % 2 ? 'slab' : 'block');
    return { lo: rockGeometry(sh, 3), hi: rockGeometry(sh, 5) };
  });
  kit.bigs = [0, 1, 2, 3, 4, 5].map((i) => {
    const sh = rockShape(`erratic${i}`, i < 3 ? 'round' : i < 5 ? 'block' : 'slab');
    const g4 = rockGeometry(sh, 11);
    return { g3: rockGeometry(sh, 6), g4, minY: g4.boundingBox.min.y, maxY: g4.boundingBox.max.y };
  });
  return kit;
}

// ---------------------------------------------------------------------------
// Lake: sea stacks, islets, a sea arch
// ---------------------------------------------------------------------------

/**
 * A sea stack: a main column with one or two fused, shorter sub-columns (so the silhouette steps),
 * irregular hard/soft layers, vertical joint fluting, a wave-cut notch and a dark wet band at the
 * waterline, and a slight overhang where a resistant cap bed survives.
 */
function seaStack(K, w, x, z, top, R, opts = {}) {
  const { H, rng } = K;
  const type = opts.type ?? 'column';
  const parts = [{ x, z, top, R }];
  const nSub = type === 'squat' ? rng.int(2, 3) : type === 'needle' ? rng.int(0, 1) : top > 30 ? rng.int(1, 2) : rng.int(0, 1);
  for (let i = 0; i < nSub; i++) {
    const a = rng() * TAU;
    const d = R * rng.range(0.55, 0.9);
    parts.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, top: top * rng.range(0.35, 0.8), R: R * rng.range(0.5, 0.75) });
  }
  let res = null;
  for (const p of parts) {
    const bed = groundMin(H, p.x, p.z, p.R * 1.2, 6);
    const y0 = Math.min(bed, -2) - 5;
    const h = p.top - y0;
    const seed = rng() * 100;
    const ecc = rng.range(0.1, 0.35);
    const ea = rng() * TAU;
    const step = rng.range(4, 9);
    const lean = [rng.range(-1, 1) * h * 0.035, rng.range(-1, 1) * h * 0.035];
    const overhang = opts.overhang ?? rng.range(0.0, 0.16);
    const main = p === parts[0];
    const taper = type === 'needle' && main ? rng.range(0.55, 0.7) : type === 'squat' ? rng.range(0.02, 0.12) : rng.range(0.1, 0.35);
    const r3 = rng.range(0.06, 0.14), r5 = rng.range(0.03, 0.08);
    const s5 = rng() * TAU;
    const out = writePillar(w, {
      x: p.x,
      z: p.z,
      y0,
      h,
      segs: opts.segs ?? 24,
      rings: Math.max(14, Math.min(72, Math.round(h / 1.7))),
      angle: rng() * TAU,
      seed,
      radius: (t, a, y) => {
        let r = p.R * (1 + ecc * Math.cos(2 * (a - ea)) + r3 * Math.cos(3 * a + seed) + r5 * Math.cos(5 * a + s5));
        r *= 1 - taper * t;
        r *= 1 + 0.12 * Math.sin(y * 0.05 + seed) + 0.07 * Math.sin(y * 0.11 + seed * 2.1);
        if (y < -1) r *= 1 + 0.35 * smooth(-1, y0 + 4, y); // skirt under water
        r *= 1 - 0.17 * Math.exp(-(((y - 1.2) / 2.2) ** 2)); // wave-cut notch
        r *= 1 + 0.07 * layers(y, step, seed);
        // soft beds weather back into deep horizontal recesses
        const soft = Math.sin(y * 0.19 + seed * 3.1) * Math.sin(y * 0.071 - seed);
        r *= 1 - 0.07 * Math.max(0, soft - 0.55) / 0.45;
        r *= 1 + overhang * smooth(0.84, 0.97, t);
        return r;
      },
      lean,
      flute: 0.1,
      lump: 0.16,
      freq: 0.06,
      cap: type === 'needle' && main ? 'point' : 'flat',
      capH: type === 'needle' && main ? p.R * 0.5 : p.R * 0.16,
      tint: (t, y) => {
        if (y < 4) return [0.5, 0.52, 0.5]; // wet / algae band
        const soft = Math.sin(y * 0.19 + seed * 3.1) * Math.sin(y * 0.071 - seed);
        const k = (0.84 + 0.28 * smooth(0.55, 1, t)) * bandTint(y, step * 0.8, seed) * (1 - 0.25 * Math.max(0, soft - 0.5) / 0.5);
        const warm = 0.03 * Math.sin(y * 0.09 + seed);
        return [k * (1 + warm), k * 0.98, k * (0.95 - warm)];
      },
    });
    if (!res) res = out;
  }
  K.occ.add(x, z, R * 1.5);
  K.count('seaStacks');
  // fallen blocks around the foot, half drowned
  const n = Math.round(5 + R * 0.7);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const d = R * rng.range(1.0, 2.4);
    const size = rockSize(rng, 0.8, R * 0.35, 1.3);
    placeBoulder(K.field, H, rng() < 0.7 ? KIND.block : KIND.slab, x + Math.cos(a) * d, z + Math.sin(a) * d, size, rng, {
      water: true,
      embed: 0.1,
      tint: tintAround(rng, [0.8, 0.8, 0.8]),
    });
  }
  return res;
}

function islet(K, w, x, z, top, rx, rz, yaw) {
  const { H, rng } = K;
  const bed = groundMin(H, x, z, Math.max(rx, rz) * 0.8, 6);
  const big = K.bigs[rng.int(0, 5)];
  // scale the recipe so its top lands at `top` and its bottom goes below the lake bed
  const bottom = Math.min(bed, -3) - 3;
  const sy = (top - bottom) / (big.maxY - big.minY);
  const y = bottom - big.minY * sy;
  w.append(Math.max(rx, rz) > 18 ? big.g4 : big.g3, mat4(x, y, z, rng.range(-0.08, 0.08), yaw, rng.range(-0.08, 0.08), rx, sy, rz), 0.95, 0.93, 0.9);
  K.occ.add(x, z, Math.max(rx, rz));
  K.count('islets');
  const n = Math.round(6 + Math.max(rx, rz) * 0.4);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const d = rng.range(0.8, 1.35);
    const size = rockSize(rng, 0.7, 4, 1.3);
    placeBoulder(K.field, H, rng() < 0.5 ? KIND.round : KIND.block, x + Math.cos(a) * rx * d, z + Math.sin(a) * rz * d, size, rng, {
      water: true,
      embed: 0.15,
      tint: tintAround(rng, [0.85, 0.85, 0.83]),
    });
  }
}

export function buildLake(K) {
  const { ctx, H } = K;
  const L = ctx.layout.LANDMARK_BY_ID;
  const avoid = [L.stair, L.observatory];
  const clearOf = (x, z, r) => avoid.every((s) => Math.hypot(x - s.x, z - s.z) > 180 + r);
  const w = K.w('lake', 'strata');
  const wr = K.w('lake', 'rock');
  // [x, z, top above water, base radius, overhang]
  // "The Sentinels": a tall trio off the south shore, with satellites and stumps; a second
  // group off the east shore; a lone pair near the north shore.
  const stacks = [
    [-120, 515, 92, 17, 0.12, 'column'],
    [-58, 572, 62, 10, 0, 'needle'],
    [-182, 566, 30, 15, 0.05, 'squat'],
    [-20, 500, 14, 8, 0, 'column'],
    [-160, 470, 8, 6, 0, 'column'],
    [175, 535, 70, 16, 0.14, 'squat'],
    [236, 574, 44, 8, 0.2, 'needle'],
    [128, 588, 12, 7, 0, 'column'],
    [555, -175, 58, 13, 0.14, 'column'],
    [520, -250, 36, 7, 0, 'needle'],
    [-40, -420, 46, 12, 0.1, 'squat'],
    [30, -455, 22, 8, 0, 'column'],
  ];
  for (const [x, z, top, R, oh, type] of stacks) {
    if (!clearOf(x, z, R)) continue;
    if (H(x, z) > -4) continue;
    seaStack(K, w, x, z, top, R, { overhang: oh, type });
  }
  // islets
  const islets = [
    [-40, 250, 7, 34, 22],
    [60, 300, 4, 16, 12],
    [140, -120, 9, 40, 28],
    [210, -60, 3, 14, 10],
    [-250, -180, 6, 26, 18],
    [-120, 60, 3.5, 18, 12],
    [430, -330, 5, 20, 14],
    [-330, 70, 2.5, 12, 9],
  ];
  for (const [x, z, top, rx, rz] of islets) {
    if (!clearOf(x, z, rx)) continue;
    if (H(x, z) > -2) continue;
    islet(K, wr, x, z, top, rx, rz, K.rng() * TAU);
  }
  // sea arch off the east shore: one foot in the water, the other on a drowned buttress
  {
    const a = [470, -60];
    const b = [540, 10];
    if (clearOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 50)) {
      const ya = Math.min(H(a[0], a[1]), -2);
      const yb = Math.min(H(b[0], b[1]), 2);
      writeArch(w, {
        a: [a[0], ya, a[1]],
        b: [b[0], yb, b[1]],
        crown: 34,
        n: 90,
        segs: 26,
        dCrown: 9,
        dLeg: 30,
        wCrown: 11,
        wLeg: 26,
        sink: 12,
        pw: 0.55,
        lump: 0.28,
        freq: 0.045,
        seed: 7.7,
        ledges: 1.6,
        ledgeStep: 4.2,
        twist: 4,
        tint: (y) => (y < 3 ? [0.55, 0.55, 0.55] : [0.95, 0.93, 0.9]),
      });
      K.occ.add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 55);
      K.count('arches');
    }
  }
}

// ---------------------------------------------------------------------------
// Natural arches on land
// ---------------------------------------------------------------------------

/**
 * One land arch. Feet at a / b ([x, z]); crown = rise above the higher foot. A layered rock fin
 * (abutment) swallows one or both legs, so the span reads as a window eroded through a wall.
 */
function landArch(K, region, material, a, b, rise, o = {}) {
  const { H, rng } = K;
  const w = K.w(region, material);
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const legR = (o.wLeg ?? span * 0.3) * 0.5;
  const legS = Math.max(legR, (o.dLeg ?? span * 0.3) * 0.5) * 1.6; // flare + lumps reach this far
  const ya = groundMin(H, a[0], a[1], legS, 10);
  const yb = groundMin(H, b[0], b[1], legS, 10);
  const crown = Math.max(ya, yb) + rise;
  (K.archSites || (K.archSites = [])).push({ kind: region, x: Math.round((a[0] + b[0]) / 2), y: Math.round(crown), z: Math.round((a[1] + b[1]) / 2) });
  writeArch(w, {
    a: [a[0], ya, a[1]],
    b: [b[0], yb, b[1]],
    crown,
    n: o.n ?? 110,
    segs: o.segs ?? 30,
    dCrown: o.dCrown ?? span * 0.11,
    dLeg: o.dLeg ?? span * 0.3,
    wCrown: o.wCrown ?? span * 0.13,
    wLeg: o.wLeg ?? span * 0.3,
    sink: o.sink ?? 26,
    pw: o.pw ?? 0.6,
    lump: o.lump ?? 0.3,
    freq: o.freq ?? 0.04,
    seed: o.seed ?? rng() * 50,
    ledges: o.ledges ?? 1.1,
    ledgeStep: o.ledgeStep ?? 8,
    twist: o.twist ?? 0,
    peak: o.peak ?? 0.5,
    pinch: o.pinch ?? 0.25,
    tint: (y) => {
      const t = smooth(Math.min(ya, yb), crown, y);
      const k = (0.82 + 0.28 * t) * bandTint(y, 5.5, 3.3);
      const c = o.tint ?? [1, 0.98, 0.96];
      return [k * c[0], k * c[1], k * c[2]];
    },
  });
  // abutment: a layered rock fin the arch grows out of, so the span reads as a window eroded
  // through a wall rather than a hoop set on the grass
  const abut = o.abut ?? 'a';
  const dx = (b[0] - a[0]) / span, dz = (b[1] - a[1]) / span;
  for (const foot of abut === 'both' ? ['a', 'b'] : abut === 'none' ? [] : [abut]) {
    const p = foot === 'a' ? a : b;
    const dir = foot === 'a' ? -1 : 1;
    const finLen = (o.finLen ?? span * 0.55) * rng.range(0.85, 1.15);
    const finH = (o.abutH ?? rise * 0.85) * rng.range(0.85, 1.1);
    const Rf = finLen / 2 / 1.6;
    const fx = p[0] + dx * dir * (finLen * 0.5 - legR * 0.6);
    const fz = p[1] + dz * dir * (finLen * 0.5 - legR * 0.6);
    const hc = H(fx, fz);
    const y0 = groundMin(H, fx, fz, Rf * 1.75, 12) - 5; // elongated section: sample its long ends
    const top = Math.max(ya, yb) + finH;
    const seed = rng() * 50;
    const ea = Math.atan2(dz, dx);
    const step = o.ledgeStep ?? 5;
    writePillar(w, {
      x: fx,
      z: fz,
      y0,
      h: top - y0,
      segs: 26,
      rings: Math.max(16, Math.round((top - y0) / 2.2)),
      seed,
      radius: (t, ang, y) => {
        const u = Math.max(0, (y - hc) / (top - hc));
        let r = Rf * (1 + 0.6 * Math.cos(2 * (ang - ea)) + 0.1 * Math.cos(3 * ang + seed));
        r *= 1 - 0.3 * u;
        r *= 1 + 0.1 * layers(y, step * 1.3, seed);
        r *= 1 - 0.3 * smooth(0.75, 1, u);
        if (y - hc < Rf) r *= 1 + 0.35 * (1 - Math.max(0, y - hc) / Rf) ** 2;
        return r;
      },
      flute: 0.14,
      lump: 0.14,
      freq: 0.05,
      cap: 'dome',
      capH: Rf * 0.25,
      tint: (t, y) => {
        const k = (0.8 + 0.3 * smooth(Math.min(ya, yb), crown, y)) * bandTint(y, 5.5, 3.3);
        const c = o.tint ?? [1, 0.98, 0.96];
        return [k * c[0], k * c[1], k * c[2]];
      },
    });
    K.occ.add(fx, fz, finLen * 0.55);
  }
  K.occ.add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, span * 0.5 + legR);
  K.occ.add(a[0], a[1], legR * 1.8);
  K.occ.add(b[0], b[1], legR * 1.8);
  // fallen fragments of the arch around its feet
  for (let i = 0; i < 26; i++) {
    const t = rng();
    const px = a[0] + (b[0] - a[0]) * t + rng.range(-1, 1) * span * 0.25;
    const pz = a[1] + (b[1] - a[1]) * t + rng.range(-1, 1) * span * 0.25;
    const size = rockSize(rng, 0.6, span * 0.06, 1.2);
    placeBoulder(K.field, H, rng() < 0.6 ? KIND.block : KIND.slab, px, pz, size, rng, { tint: tintAround(rng, o.debrisTint ?? [1, 1, 1]) });
  }
  K.count('arches');
  return { crown, ya, yb };
}

export function buildArches(K) {
  // 1. The Spawn Window — on the rise west of the lake, seen from the arrival ridge, framing the
  //    Stair to Nowhere across the water.
  landArch(K, 'arch-west', 'strata', [-988, 524], [-856, 622], 58, {
    wLeg: 30, dLeg: 36, dCrown: 17, wCrown: 16, abut: 'a', seed: 3.1, twist: 8, peak: 0.44, pinch: 0.28, finLen: 64, abutH: 56, n: 150, pw: 0.42,
  });
  // 2. The Sunset Gate — in the western hills beyond the Choir; from the monolith plain the low sun
  //    sets through it at golden hour.
  landArch(K, 'arch-choir', 'strata', [-2484, -240], [-2466, -100], 84, {
    wLeg: 28, dLeg: 32, dCrown: 12, wCrown: 14, abut: 'b', seed: 9.4, pw: 0.5, peak: 0.55, pinch: 0.25, finLen: 56, abutH: 60, n: 140,
  });
  // 3. The Canyon Bow — a thin sandstone ribbon leaping a side gully on the east canyon rim.
  landArch(K, 'arch-canyon', 'strata', [2100, -646], [2172, -516], 48, {
    wLeg: 18, dLeg: 20, dCrown: 6, wCrown: 8, abut: 'both', abutH: 30, finLen: 40, seed: 5.5, pw: 0.45, peak: 0.46,
    ledges: 1.2, ledgeStep: 6, pinch: 0.35, debrisTint: [1.25, 0.86, 0.7], tint: [1.32, 0.8, 0.6],
  });
}

// ---------------------------------------------------------------------------
// Hoodoos
// ---------------------------------------------------------------------------

/**
 * One hoodoo. style: 'totem' (irregular hard/soft bulges + neck + cap rock), 'tent' (cone, sometimes
 * with a perched boulder), 'fin' (long thin section — a remnant wall). `o.baseY` / `o.y0` let
 * spires rise from a fin's crest instead of the ground.
 */
function hoodoo(K, w, wCap, x, z, H0, R, style, palette, o = {}) {
  const { H, rng } = K;
  const hc = o.baseY ?? H(x, z);
  const y0 = o.y0 ?? groundMin(H, x, z, R * 1.75, 7) - (1.2 + 0.35 * R);
  const top = hc + H0;
  const h = top - y0;
  const seed = rng() * 100;
  const period = rng.range(2.6, 5.5);
  const ecc = style === 'fin' ? rng.range(0.68, 0.76) : rng.range(0.05, 0.22);
  const ea = o.along ?? rng() * TAU;
  const neck = style === 'totem' ? rng.range(0.5, 0.75) : 1;
  const lean = [rng.range(-1, 1) * H0 * 0.035, rng.range(-1, 1) * H0 * 0.035];
  const taper = style === 'fin' ? 0.15 : rng.range(0.15, 0.4);
  const r3 = rng.range(0.04, 0.12);
  const res = writePillar(w, {
    x,
    z,
    y0,
    h,
    segs: style === 'fin' ? 18 : R > 5 ? 14 : 11,
    rings: Math.max(9, Math.min(60, Math.round(h / 1.1))),
    angle: rng() * TAU,
    seed,
    radius: (t, a, y) => {
      const yr = y - hc;
      const u = Math.max(0, yr / H0);
      let r = R * (1 + ecc * Math.cos(2 * (a - ea)) + r3 * Math.cos(3 * a + seed));
      if (style === 'tent') {
        r *= Math.pow(Math.max(0.02, 1 - 0.9 * u), 0.8);
        r *= 1 + 0.07 * layers(yr, period * 1.6, seed);
      } else {
        r *= 1 - taper * u;
        r *= 1 + (style === 'fin' ? 0.08 : 0.2) * layers(yr, period, seed);
        r *= 1 - (1 - neck) * smooth(0.76, 0.92, u);
      }
      // apron flaring into the slope (not for spires standing on a fin; fins only a little)
      if (!o.y0 && style !== 'fin' && yr < R * 1.6) r *= 1 + 0.55 * (1 - Math.max(0, yr) / (R * 1.6)) ** 2;
      return r;
    },
    lean,
    flute: 0.15,
    lump: 0.12,
    freq: 0.11,
    cap: style === 'tent' ? 'point' : style === 'fin' ? 'flat' : 'dome',
    capH: style === 'tent' ? R * 0.5 : style === 'fin' ? R * 0.08 : R * 0.3,
    tint: (t, y) => {
      const u = Math.max(0, (y - (o.groundY ?? hc)) / (H0 + hc - (o.groundY ?? hc)));
      const k = (palette.base + palette.lift * smooth(0.5, 1, u)) * (palette.bands ? bandTint(y, palette.bands, 1.7) : 1);
      // pale bleached bands every so often (the white Claron limestone look)
      const pale = palette.bands < 3 ? 0.25 * Math.max(0, Math.sin(y * 0.31 + 1.1) - 0.7) / 0.3 : 0;
      return [k * palette.c[0] * (1 + pale * 0.6), k * palette.c[1] * (1 + pale), k * palette.c[2] * (1 + pale * 1.3)];
    },
  });
  // cap rock: a harder slab protecting the column (only some survive)
  if ((style === 'totem' && rng() < 0.6) || (style === 'tent' && rng() < 0.5)) {
    const cap = K.caps[rng.int(0, 3)];
    const cr = style === 'tent' ? R * rng.range(0.5, 0.75) : res.topR * rng.range(1.25, 1.75);
    const cy = style === 'tent' ? res.top[1] + cr * 0.15 : res.topY + cr * 0.32;
    const ct = palette.cap ?? [1.05, 0.95, 0.85];
    wCap.append(cr > 4 ? cap.hi : cap.lo, mat4(res.top[0], cy, res.top[2], rng.range(-0.18, 0.18), rng() * TAU, rng.range(-0.18, 0.18), cr, cr * rng.range(0.55, 0.85), cr * rng.range(0.85, 1.15)), ct[0], ct[1], ct[2]);
  }
  K.occ.add(x, z, R * (1 + ecc) * 1.3);
  K.count('hoodoos');
  return res;
}

/**
 * A field of hoodoo clusters along an annulus around (cx, cz). Each cluster is an eroding
 * amphitheatre: one or two fins (remnant walls) with spires breaking out of their crests, and
 * free-standing totems and tent rocks around them, tallest in the middle.
 */
function hoodooField(K, region, material, cx, cz, rMin, rMax, nClusters, perCluster, palette, debrisTint, scale = 1, angles = null) {
  const { H, rng, ctx } = K;
  const w = K.w(region, material);
  const wCap = K.w(region, 'rock');
  const a0 = rng() * TAU;
  const ok = (x, z, r) => !ctx.layout.isReserved(x, z, 30) && K.Hg(x, z) > 2 && !K.occ.blocked(x, z, r);
  for (let c = 0; c < nClusters; c++) {
    const a = angles ? angles[c % angles.length] + rng.range(-0.08, 0.08) : a0 + (c / nClusters) * TAU + rng.range(-0.25, 0.25);
    const d = rng.range(rMin, rMax);
    const ccx = cx + Math.cos(a) * d;
    const ccz = cz + Math.sin(a) * d;
    (K.hoodooSites || (K.hoodooSites = [])).push([region, Math.round(ccx), Math.round(ccz)]);
    const spread = rng.range(45, 80) * scale;
    // clusters are elongated along the slope contour
    const ta = a + Math.PI / 2 + rng.range(-0.35, 0.35);
    const hero = rng.range(1.0, 1.3) * scale;
    // fins
    const nFins = rng.int(1, 2);
    for (let f = 0; f < nFins; f++) {
      const off = (f - (nFins - 1) / 2) * spread * 0.5 + rng.range(-8, 8);
      const x = ccx + Math.cos(ta) * off + Math.cos(a) * rng.range(-10, 10);
      const z = ccz + Math.sin(ta) * off + Math.sin(a) * rng.range(-10, 10);
      const Rf = rng.range(10, 14) * scale;
      if (!ok(x, z, Rf * 0.6)) continue;
      const finH = rng.range(28, 44) * hero;
      const fyaw = ta + rng.range(-0.3, 0.3);
      const ground = groundMin(H, x, z, Rf * 1.2, 6);
      const fin = hoodoo(K, w, wCap, x, z, finH, Rf, 'fin', palette, { along: fyaw });
      // spires breaking out of the crest
      const ns = rng.int(3, 6);
      for (let k = 0; k < ns; k++) {
        const t = (k / (ns - 1) - 0.5) * 1.5 * Rf * rng.range(0.8, 1.0);
        const sx = x + Math.cos(fyaw) * t;
        const sz = z + Math.sin(fyaw) * t;
        const baseY = fin.topY - rng.range(3, 7);
        const sH = rng.range(10, 26) * hero * (1 - Math.abs(t) / (Rf * 1.6));
        const sR = Math.max(2, sH * rng.range(0.13, 0.19));
        // the spire's shaft runs down inside the fin to the ground, so wherever it is wider than
        // the fin it simply reads as a buttress, never as an open stump
        const y0s = groundMin(H, sx, sz, sR * 1.3, 6) - 2;
        hoodoo(K, w, wCap, sx, sz, sH, sR, rng() < 0.8 ? 'totem' : 'tent', palette, { baseY, y0: y0s, groundY: ground });
      }
    }
    // free-standing hoodoos
    const n = Math.round(perCluster * rng.range(0.7, 1.3));
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const along = rng.range(-1, 1) * spread;
      const across = rng.range(-1, 1) * spread * 0.45;
      const x = ccx + Math.cos(ta) * along + Math.cos(a) * across;
      const z = ccz + Math.sin(ta) * along + Math.sin(a) * across;
      const centre = 1 - Math.abs(along) / spread;
      const H0 = (12 + 46 * centre * rng.range(0.55, 1.1) + rng() * 8) * hero;
      const R = Math.max(1.8, H0 * rng.range(0.1, 0.16));
      if (!ok(x, z, R * 1.1)) continue;
      const sr = rng();
      const style = sr < 0.72 ? 'totem' : 'tent';
      hoodoo(K, w, wCap, x, z, H0, R, style, palette);
      made++;
      for (let k = 0; k < 3; k++) {
        const aa = rng() * TAU;
        const dd = R * rng.range(1.5, 4);
        placeBoulder(K.field, H, rng() < 0.5 ? KIND.block : KIND.slab, x + Math.cos(aa) * dd, z + Math.sin(aa) * dd, rockSize(rng, 0.4, 2.8, 1.4), rng, { tint: tintAround(rng, debrisTint) });
      }
    }
  }
}

export function buildHoodoos(K) {
  const L = K.ctx.layout.LANDMARK_BY_ID;
  // Mesa foot: rust-orange totems with pale tops (Bryce-like)
  // clusters placed so the south-east approach (the classic view from the Isles road) is densest
  const mesaAngles = [0.98, 0.62, 1.42, 2.2, 2.95, 3.75, 4.5, 5.3, 0.2];
  hoodooField(K, 'hoodoo-mesa', 'redrock', L.temple.x, L.temple.z, 285, 450, 9, 8, { base: 0.88, lift: 0.5, c: [1, 1, 1], cap: [1.15, 1.0, 0.86], bands: 2.3 }, [1.3, 0.88, 0.72], 1, mesaAngles);
  // Crater outer slopes: pale tuff cones (Cappadocia-like), limestone strata material
  hoodooField(K, 'hoodoo-crater', 'strata', L.orrery.x, L.orrery.z, 510, 700, 7, 6, { base: 0.95, lift: 0.25, c: [1.05, 1, 0.94], bands: 4.5 }, [1, 1, 1], 0.85);
}

// ---------------------------------------------------------------------------
// Basalt colonnades
// ---------------------------------------------------------------------------

/** Walk outward from the canyon centre line to the rim edge (distance from the centre line). */
function canyonRim(K, x, z, nx, nz) {
  const H = K.Hg;
  const far = H(x + nx * 320, z + nz * 320);
  for (let d = 60; d < 320; d += 6) {
    const h = H(x + nx * d, z + nz * d);
    if (h > far - 16) return { d, h, far };
  }
  return null;
}

/**
 * A colonnade band along one canyon rim: the top `capDepth` metres of the wall become a lava-flow
 * cap of hex-packed columns (hex-offset rows), their tops stepping down row by row toward the
 * canyon like organ pipes, plus a thin fringe of low columns on the lip. Coherent noise (not per-
 * column randomness) shapes the tops and the rust/ash weathering patches.
 */
function basaltRimBand(K, w, seg, t0, t1, side, o = {}) {
  const { H, rng, ctx } = K;
  const C = ctx.layout.CANYON;
  const [ax, az] = C[seg];
  const [bx, bz] = C[seg + 1];
  const l = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / l, uz = (bz - az) / l;
  const nx = -uz * side, nz = ux * side;
  const r = o.r ?? 2.8;
  const s = r * 1.74;
  const rowStep = s * 0.866;
  const stepH = o.stepH ?? 2.6;
  const wallBand = o.wall ?? 55;
  const topBand = o.top ?? 26;
  const height = o.height ?? 16;
  const capDepth = o.capDepth ?? 46;
  const noise2 = ctx.noise.worldNoise.noise2;
  const seed = rng() * 100;
  const len = (t1 - t0) * l;
  // rim distance sampled every ~24 m and interpolated
  const rimStep = 24;
  const rims = [];
  const rimH = [];
  for (let a = 0; a <= len + rimStep; a += rimStep) {
    const px = ax + ux * (t0 * l + a), pz = az + uz * (t0 * l + a);
    const rim = canyonRim(K, px, pz, nx, nz);
    rims.push(rim ? rim.d : null);
    rimH.push(rim ? rim.h : null);
  }
  let made = 0;
  for (let along = 0; along <= len; along += s) {
    const ri = along / rimStep;
    const i0 = Math.floor(ri);
    const r0 = rims[i0], r1 = rims[Math.min(rims.length - 1, i0 + 1)];
    if (r0 == null || r1 == null) continue;
    const dr = r0 + (r1 - r0) * (ri - i0);
    const endFade = Math.min(1, Math.min(along, len - along) / (0.22 * len));
    const wob = 0.5 + 0.5 * noise2(along * 0.012 + seed, side * 3.1);
    const tb = topBand * (0.35 + 0.65 * endFade) * (0.55 + 0.45 * wob);
    const wb = wallBand * (0.4 + 0.6 * endFade) * (0.7 + 0.3 * wob);
    let row = 0;
    for (let dd = dr - wb; dd <= dr + tb; dd += rowStep, row++) {
      const a2 = t0 * l + along + (row % 2) * s * 0.5 + rng.range(-0.25, 0.25);
      const x = ax + ux * a2 + nx * dd;
      const z = az + uz * a2 + nz * dd;
      if (ctx.layout.isReserved(x, z, 30)) continue;
      const gc = H(x, z);
      // footprint on the fall line: the ground gradient tells how far the downhill side drops
      const gx = (K.Hg(x + r, z) - K.Hg(x - r, z)) / (2 * r);
      const gz = (K.Hg(x, z + r) - K.Hg(x, z - r)) / (2 * r);
      const drop = Math.hypot(gx, gz) * r * 1.15;
      const gmin = gc - drop - 0.8;
      const gmax = gc + drop;
      if (gmin < 1) continue;
      // spatially coherent top surface (no per-column randomness: that reads as battlements)
      const coh = 0.5 + 0.5 * noise2(x * 0.021 + seed, z * 0.021 - seed);
      const coh2 = noise2(x * 0.07 - seed, z * 0.07 + seed);
      let top;
      if (dd < dr) {
        // on the wall: columns rise from the ledges to a colonnade just under the rim, stepping
        // down row by row toward the canyon, so the wall becomes one great fluted face. Only the
        // top `capDepth` metres of the wall are basalt: a lava flow capping the red sandstone.
        const lip = rimH[Math.min(rimH.length - 1, Math.round(ri))] ?? gc;
        if (gc < lip - capDepth * (0.75 + 0.5 * coh)) continue;
        top = lip - (dr - dd) * (0.22 + 0.3 * coh) + height * 0.2 * endFade + coh2 * 1.5;
        top = Math.ceil(top / (stepH * 0.6)) * stepH * 0.6;
        if (rng() < 0.04) top -= stepH * rng.int(2, 5); // a few snapped columns expose the next row
      } else {
        const prof = Math.pow(Math.max(0, 1 - (dd - dr) / (tb + 1)), 0.7);
        top = gc + height * prof * endFade * (0.45 + 0.8 * coh) + coh2 * 1.2;
        top = Math.ceil(top / stepH) * stepH;
      }
      top = Math.max(top, gmax + 0.5);
      if (top < gmax + 0.3) continue;
      // colour: coherent weathering patches (rusty / ashen) plus per-column jitter
      const k = (1.05 + 0.5 * coh) * rng.range(0.85, 1.2);
      const rust = Math.max(0, coh2) * 0.25;
      const sides = rng() < 0.14 ? 5 : rng() < 0.84 ? 6 : 7;
      // bottoms go deep: below a heightfield everything is solid, and coarse terrain LODs can
      // sit well below heightAt() on steep walls
      writeColumn(w, x, z, r * 0.95, gmin - 3 - drop * 3 - (dd < dr ? 18 : 0), top, Math.atan2(uz, ux) + rng.range(-0.1, 0.1), rng, [k * (1 + rust), k * (1 + rust * 0.4), k * (1.02 - rust * 0.3)], sides, rng.range(-0.07, 0.07), rng.range(-0.07, 0.07));
      made++;
    }
    // loose drums on the lip
    if (rng() < 0.12) {
      const dd = dr + tb + rng.range(2, 12);
      const x = ax + ux * (t0 * l + along) + nx * dd, z = az + uz * (t0 * l + along) + nz * dd;
      const g = H(x, z);
      if (g > 1 && !ctx.layout.isReserved(x, z, 30)) writeLyingColumn(w, x, g + r * 0.3, z, r * 0.95, rng.range(2.5, 8), rng() * TAU, rng.range(-0.15, 0.15), rng, [0.9, 0.9, 0.92]);
    }
  }
  K.count('basaltColumns', made);
  // occupancy: a few discs along the band
  for (let a = 0; a <= len; a += 40) {
    const i = Math.min(rims.length - 1, Math.round(a / rimStep));
    if (rims[i] == null) continue;
    K.occ.add(ax + ux * (t0 * l + a) + nx * rims[i], az + uz * (t0 * l + a) + nz * rims[i], 40);
  }
  return made;
}

export function buildBasalt(K) {
  const { ctx } = K;
  // [segment, t0, t1, side, options] — stretches of both rims, away from the Span
  // long stretches of both rims read as one continuous cap-rock layer rather than patches
  const bands = [
    [1, 0.4, 0.97, 1, { height: 10 }],
    [1, 0.45, 0.97, -1, { height: 8 }],
    [2, 0.02, 0.5, 1, { height: 12 }],
    [2, 0.02, 0.55, -1, { height: 10 }],
    [3, 0.68, 1.0, -1, { height: 8 }],
    [3, 0.72, 1.0, 1, { height: 8 }],
    [4, 0.04, 0.5, 1, { height: 9 }],
  ];
  for (const [seg, t0, t1, side, o] of bands) {
    const w = K.w(seg < 2 ? 'basalt-canyon-n' : 'basalt-canyon-s', 'basalt');
    basaltRimBand(K, w, seg, t0, t1, side, { r: 2.9 + K.rng() * 0.4, wall: 40, top: 3, stepH: 2.2, capDepth: 44, ...o, height: 1.5 });
  }
  // lake-shore causeway: columns stepping down into the water on the north-east shore
  {
    const L = ctx.layout.LAKE;
    const a = -1.1; // direction from lake centre (north-east shore, clear of the stacks)
    const dx = Math.cos(a), dz = Math.sin(a);
    let shore = null;
    for (let d = 300; d < 1000; d += 5) {
      if (K.H(L.x + dx * d, L.z + dz * d) > 0.5) {
        shore = [L.x + dx * d, L.z + dz * d];
        break;
      }
    }
    if (shore) basaltCauseway(K, K.w('basalt-lake', 'basalt'), shore[0], shore[1], -dx, -dz);
  }
}

/**
 * A Giant's-Causeway headland: close-packed columns rising in big uneven steps to a rounded crown
 * at the waterline (a sheer fluted face toward the lake), then a tongue of stepping stones running
 * out under the water until they drown. (sx, sz) is the waterline, (ox, oz) points into the lake.
 */
function basaltCauseway(K, w, sx, sz, ox, oz) {
  const { H, rng, ctx } = K;
  const noise2 = ctx.noise.worldNoise.noise2;
  const r = 1.7;
  const s = r * 1.74;
  const ux = -oz, uz = ox; // along the shore
  const seed = rng() * 100;
  const plateau = 22;
  const n = Math.ceil(95 / s);
  let made = 0;
  for (let q = -n; q <= n; q++) {
    for (let p = -n; p <= n; p++) {
      const lu = s * (q + p * 0.5);
      const lv = s * p * 0.866; // + out into the lake, - inland
      if (lv < -40 || lv > 44) continue;
      // tongue: wide on the shore, narrowing out into the water, ragged edges
      const half = (lv < 6 ? 46 : 46 - (lv - 6) * 0.8) * (0.75 + 0.35 * noise2(lv * 0.05 + seed, 1.3));
      if (Math.abs(lu) > half) continue;
      const x = sx + ux * lu + ox * lv;
      const z = sz + uz * lu + oz * lv;
      if (ctx.layout.isReserved(x, z, 30) || K.occ.blocked(x, z, r)) continue;
      const gc = H(x, z);
      const g1 = K.Hg(x + r, z), g2 = K.Hg(x - r * 0.5, z + r * 0.87), g3 = K.Hg(x - r * 0.5, z - r * 0.87);
      const gmin = Math.min(gc, g1, g2, g3) - 0.8;
      const gmax = Math.max(gc, g1, g2, g3);
      const coh = noise2(x * 0.045 + seed, z * 0.045 - seed);
      let top;
      if (lv > 6) {
        // stepping stones sinking into the lake
        top = 2.2 - (lv - 6) * 0.13 + coh * 0.6;
        top = Math.round(top / 0.45) * 0.45;
        if (top < -1.6) continue;
      } else {
        // the headland: a rounded "organ" of columns rising in big uneven steps to a crown, its
        // lake face a sheer fluted wall, its back merging into the rising shore
        const d = Math.hypot(lu, lv + 8) / 40;
        if (d > 1.05) continue;
        top = Math.max(gc, 0) + 1.5 + plateau * Math.max(0, 1 - Math.pow(d, 1.7)) * (0.8 + 0.4 * coh) + 0.8 * noise2(x * 0.2, z * 0.2);
        top = Math.round(top / 1.25) * 1.25;
      }
      top = Math.max(top, gmax + 0.35);
      const wet = top < 1.2 ? 0.7 : 1;
      const k = (1.1 + 0.35 * (0.5 + 0.5 * coh)) * rng.range(0.88, 1.12) * wet;
      const sides = rng() < 0.12 ? 5 : rng() < 0.85 ? 6 : 7;
      writeColumn(w, x, z, r * 0.95, gmin - 1.5, top, rng.range(0, TAU), rng, [k, k, k * 1.03], sides, rng.range(-0.04, 0.04), rng.range(-0.04, 0.04));
      made++;
    }
  }
  // a few loose drums on the pavement and in the shallows
  for (let i = 0; i < 14; i++) {
    const lu = rng.range(-30, 30), lv = rng.range(-20, 30);
    const x = sx + ux * lu + ox * lv, z = sz + uz * lu + oz * lv;
    const g = Math.max(H(x, z), -1);
    writeLyingColumn(w, x, g + r * 0.4, z, r * 0.9, rng.range(1.5, 4), rng() * TAU, rng.range(-0.2, 0.2), rng, [1.1, 1.1, 1.13]);
  }
  K.occ.add(sx, sz, 50);
  K.count('basaltColumns', made);
}

// ---------------------------------------------------------------------------
// Spires on the foothills of the outer mountains
// ---------------------------------------------------------------------------

/**
 * A foothill spire: a tapering, bedded pillar with one or two fused shoulders (shorter sub-spires)
 * so the silhouette steps and splits like weathered dolomite, never a clean chimney.
 */
function spire(K, w, x, z, H0, R, style) {
  const { H, rng } = K;
  const needle = style === 'needle';
  const parts = [{ x, z, H0, R, main: true }];
  const nSub = rng.int(1, 2);
  for (let i = 0; i < nSub; i++) {
    const a = rng() * TAU;
    const d = R * rng.range(0.6, 0.95);
    parts.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, H0: H0 * rng.range(0.3, 0.65), R: R * rng.range(0.5, 0.75), main: false });
  }
  for (const p of parts) {
    const hc = H(p.x, p.z);
    const y0 = groundMin(H, p.x, p.z, p.R * 1.8, 8) - (2 + p.R * 0.4);
    const h = hc + p.H0 - y0;
    const seed = rng() * 100;
    const step = rng.range(5, 11);
    const ecc = rng.range(0.08, 0.35);
    const ea = rng() * TAU;
    const lean = [rng.range(-1, 1) * p.H0 * 0.06, rng.range(-1, 1) * p.H0 * 0.06];
    const taper = needle ? 0.92 : rng.range(0.45, 0.7);
    const pointy = needle || (!p.main && rng() < 0.5);
    const r3 = rng.range(0.06, 0.14), r5 = rng.range(0.03, 0.08);
    writePillar(w, {
      x: p.x,
      z: p.z,
      y0,
      h,
      segs: p.R > 12 ? 16 : 12,
      rings: Math.max(16, Math.min(66, Math.round(h / 2.8))),
      angle: rng() * TAU,
      seed,
      radius: (t, a, y) => {
        const u = Math.max(0, (y - hc) / p.H0);
        let r = p.R * (1 + ecc * Math.cos(2 * (a - ea)) + r3 * Math.cos(3 * a + seed) + r5 * Math.cos(5 * a - seed));
        r *= Math.pow(Math.max(0.03, 1 - taper * u), pointy ? 0.75 : 0.9);
        r *= 1 + 0.1 * layers(y, step, seed) + 0.12 * Math.sin(y * 0.045 + seed) + 0.06 * Math.sin(y * 0.13 - seed);
        if (y - hc < p.R * 2) r *= 1 + 0.5 * (1 - Math.max(0, y - hc) / (p.R * 2)) ** 2;
        return r;
      },
      lean,
      flute: 0.2,
      lump: 0.18,
      freq: 0.045,
      cap: pointy ? 'point' : 'dome',
      capH: pointy ? p.R * 0.8 : p.R * 0.3,
      tint: (t, y) => {
        const u = Math.max(0, (y - hc) / p.H0);
        const k = (0.78 + 0.3 * u) * bandTint(y, step * 0.9, seed);
        return [k, k * 0.98, k * 0.96];
      },
    });
  }
  K.occ.add(x, z, R * 1.8);
  K.count('spires');
  for (let k = 0; k < 6; k++) {
    const aa = rng() * TAU;
    const dd = R * rng.range(1.6, 4);
    placeBoulder(K.field, H, rng() < 0.6 ? KIND.block : KIND.slab, x + Math.cos(aa) * dd, z + Math.sin(aa) * dd, rockSize(rng, 0.8, R * 0.35, 1.3), rng, { tint: tintAround(rng, [0.95, 0.94, 0.92]) });
  }
}

export function buildSpires(K) {
  const { ctx, H, rng } = K;
  const Lm = ctx.layout.LANDMARK_BY_ID;
  // (and off the escarpment plateau above the Honeycomb Cloister, whose cliff is the star there)
  const hoodooCentres = [[Lm.temple.x, Lm.temple.z], [Lm.orrery.x, Lm.orrery.z], [Lm.monastery.x, Lm.monastery.z - 200]];
  const n = 11;
  let quadrant = 0;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + 0.3 + rng.range(-0.18, 0.18);
    // keep the western Sun Gate sector clear (terrain-height.js: the ring dips there so the
    // evening sun pours into the basin; foothill spires would clutter the notch)
    const dGate = Math.abs(((az - SUN_GATE + Math.PI) % TAU + TAU) % TAU - Math.PI);
    if (dGate < 0.4) continue;
    const dx = Math.cos(az), dz = Math.sin(az);
    let site = null;
    for (let r = 2150; r < 3000; r += 40) {
      const x = dx * r, z = dz * r;
      if (ctx.layout.isReserved(x, z, 120)) continue;
      if (ctx.canyonDistance(x, z).d < 380) continue;
      // keep clear of the hoodoo fields (mesa, crater): one erosional style per place
      if (hoodooCentres.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 950)) continue;
      const h = K.Hg(x, z);
      if (h < 120) continue;
      const sl = Math.abs(K.Hg(x + 20, z) - h) + Math.abs(K.Hg(x, z + 20) - h);
      if (sl > 26) continue;
      site = [x, z];
      break;
    }
    if (!site) continue;
    (K.spireSites || (K.spireSites = [])).push(site);
    quadrant = Math.floor(((az % TAU) + TAU) % TAU / (TAU / 4));
    const w = K.w(`spires-${quadrant}`, 'strata');
    const count = rng.int(4, 9);
    const heroH = rng.range(120, 210);
    for (let k = 0; k < count; k++) {
      const a = rng() * TAU;
      const d = k === 0 ? 0 : rng.range(40, 190);
      const x = site[0] + Math.cos(a) * d;
      const z = site[1] + Math.sin(a) * d;
      if (ctx.layout.isReserved(x, z, 40) || K.occ.blocked(x, z, 20)) continue;
      if (H(x, z) < 20) continue;
      const H0 = k === 0 ? heroH : heroH * rng.range(0.3, 0.8);
      const style = rng() < 0.45 ? 'needle' : 'pillar';
      const R = H0 * (style === 'needle' ? rng.range(0.1, 0.14) : rng.range(0.085, 0.12));
      spire(K, w, x, z, H0, R, style);
    }
  }
}

// ---------------------------------------------------------------------------
// Erratics: giant boulders left on ridges; a few impossibly balanced
// ---------------------------------------------------------------------------

export function buildErratics(K) {
  const { ctx, H, rng } = K;
  const cands = [];
  const step = 150;
  for (let x = -2700; x <= 2700; x += step) {
    for (let z = -2700; z <= 2700; z += step) {
      const px = x + rng.range(-40, 40), pz = z + rng.range(-40, 40);
      if (Math.hypot(px, pz) > 2750) continue;
      if (ctx.layout.isReserved(px, pz, 90)) continue;
      if (K.occ.blocked(px, pz, 60)) continue;
      if (ctx.canyonDistance(px, pz).d < 260) continue;
      const Hg = K.Hg;
      const h = Hg(px, pz);
      if (h < 25) continue;
      let mean = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        mean += Hg(px + Math.cos(a) * 130, pz + Math.sin(a) * 130);
      }
      mean /= 6;
      const prom = h - mean;
      if (prom < 9) continue;
      const sl = Math.abs(Hg(px + 15, pz) - h) + Math.abs(Hg(px, pz + 15) - h);
      if (sl > 9) continue;
      cands.push({ x: px, z: pz, h, prom });
    }
  }
  cands.sort((a, b) => b.prom - a.prom);
  // composed heroes first: the Balanced Rock on the south shore knoll, framing the Sentinel
  // stacks across the water from the lakeside path
  const chosen = [{ x: -284, z: 741, h: H(-284, 741), kind: 'balanced' }];
  let k = 0;
  for (const c of cands) {
    if (chosen.length >= 16) break;
    if (chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 420)) continue;
    c.h = H(c.x, c.z); // exact height for the chosen few
    c.kind = k % 5 === 1 ? 'balanced' : k % 5 === 3 ? 'tor' : 'erratic';
    k++;
    chosen.push(c);
  }
  chosen.forEach((c) => {
    const region = c.z < 0 ? 'erratics-n' : 'erratics-s';
    const w = K.w(region, 'rock');
    const kind = c.kind;
    const yaw = rng() * TAU;
    let size;
    if (kind === 'balanced') {
      // Balanced Rock: a hard, angular block resting on a tapering neck of soft layered rock.
      size = rng.range(10, 13);
      // a weathered, rounded cap stone (the fractured recipes read as cut gems at this size)
      const big = K.bigs[rng.int(0, 2)];
      const wp = K.w(region, 'strata');
      const pedH = size * rng.range(1.15, 1.4);
      const R0 = size * 0.6, R1 = size * 0.3;
      const gm = groundMin(H, c.x, c.z, R0 * 1.2, 8);
      const seed = rng() * 50;
      const pd = writePillar(wp, {
        x: c.x,
        z: c.z,
        y0: gm - 4,
        h: c.h + pedH - (gm - 4),
        segs: 16,
        rings: 22,
        seed,
        radius: (t, a, y) => {
          const u = Math.min(1, Math.max(0, (y - c.h) / pedH));
          let r = R0 + (R1 - R0) * Math.pow(u, 0.55);
          r *= 1 - 0.1 * Math.sin(Math.PI * u) + 0.1 * Math.cos(2 * a + seed) + 0.06 * Math.cos(3 * a - seed);
          r *= 1 + 0.06 * layers(y, 3.2, seed);
          if (y < c.h + 2) r *= 1 + 0.12 * (1 - Math.max(0, y - c.h) / 2);
          return r;
        },
        flute: 0.16,
        lump: 0.14,
        freq: 0.1,
        cap: 'dome',
        capH: R1 * 0.35,
        tint: () => [1.02, 0.97, 0.9],
      });
      const sx = size * rng.range(1.25, 1.45), sy = size * rng.range(0.62, 0.72), sz = size * rng.range(0.95, 1.1);
      const tilt = rng.range(0.08, 0.2);
      // bottom of the block sits into the pedestal's crown: a small contact patch
      w.append(big.g4, mat4(pd.top[0], pd.top[1] - big.minY * sy * 0.94, pd.top[2], tilt, yaw, rng.range(-0.08, 0.08), sx, sy, sz), 0.92, 0.9, 0.88);
      K.count('balanced');
    } else if (kind === 'tor') {
      // Tor: a stack of weathered slabs, each shifted and tipped a little more than the last,
      // the top one overhanging the void.
      const slab = K.bigs[rng.int(3, 4)];
      size = rng.range(11, 15);
      let sx = size * 1.25, sz = size * 1.1, sy = size * 0.5;
      const gm = groundMin(H, c.x, c.z, size, 8);
      let y = gm - slab.minY * sy - (slab.maxY - slab.minY) * sy * 0.35;
      let px = c.x, pz = c.z;
      const dir = rng() * TAU;
      const n = rng.int(3, 4);
      for (let k = 0; k < n; k++) {
        const tilt = k === 0 ? 0 : rng.range(0.04, 0.12) * k;
        w.append(slab.g4, mat4(px, y, pz, tilt, yaw + k * rng.range(0.3, 0.9), rng.range(-0.05, 0.05) * k, sx, sy, sz), 0.95 + 0.05 * k, 0.93 + 0.05 * k, 0.9 + 0.05 * k);
        const top = y + slab.maxY * sy;
        const shrink = rng.range(0.66, 0.8);
        sx *= shrink;
        sz *= shrink;
        sy *= rng.range(0.75, 0.95);
        px += Math.cos(dir + k * 1.9) * size * 0.1;
        pz += Math.sin(dir + k * 1.9) * size * 0.1;
        y = top - slab.minY * sy - (slab.maxY - slab.minY) * sy * 0.1;
      }
      K.count('tors');
    } else {
      size = rng.range(10, 26);
      const big = K.bigs[rng.int(0, 4)];
      const sx = size * rng.range(0.95, 1.2), sz = size * rng.range(0.85, 1.05);
      const sy = size * rng.range(0.8, 1.0);
      const sink = rng.range(0.18, 0.35);
      const gm = groundMin(H, c.x, c.z, size * 0.9, 8);
      const y = gm - big.minY * sy - (big.maxY - big.minY) * sy * sink;
      w.append(big.g4, mat4(c.x, y, c.z, rng.range(-0.12, 0.12), yaw, rng.range(-0.12, 0.12), sx, sy, sz), 1, 0.98, 0.95);
    }
    K.occ.add(c.x, c.z, size * 1.3);
    K.count('erratics');
    // a scatter of spalled fragments
    for (let k = 0; k < 10; k++) {
      const a = rng() * TAU;
      const d = size * rng.range(1.2, 3);
      placeBoulder(K.field, H, rng() < 0.6 ? KIND.block : KIND.round, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, rockSize(rng, 0.5, size * 0.18, 1.3), rng);
    }
  });
  K.erratics = chosen;
}

// ---------------------------------------------------------------------------
// Talus cones and scree aprons at the foot of the escarpment, the plateau cliff and the mesa
// ---------------------------------------------------------------------------

const CONE_SPAN = 1.95; // half-angle (rad) of the cone surface around its outward direction

/** Cone surface height (with lumps) at (x, z), or -Infinity outside its footprint. */
function coneY(c, x, z) {
  const dx = x - c.ax, dz = z - c.az;
  const r = Math.hypot(dx, dz);
  if (r > c.R * 1.15) return -Infinity;
  const cosT = (dx * c.ox + dz * c.oz) / (r || 1);
  if (r > 4 && cosT < Math.cos(CONE_SPAN - 0.1)) return -Infinity;
  const t = r / c.R;
  // slightly concave profile: steeper under the cliff, flattening at the toe
  let y = c.ay - c.h * t * (1.3 - 0.3 * t);
  y += c.lump * (c.noise3(x * 0.035, c.seed, z * 0.035) + 0.45 * c.noise3(x * 0.12, c.seed + 5, z * 0.12)) * Math.min(1, t * 4);
  // debris chutes and ribs radiating from the apex (wavy, so they don't read as a fan of lines)
  const ang = Math.atan2(dz, dx) + 0.12 * c.noise3(x * 0.02, c.seed + 9, z * 0.02);
  const rib = Math.sin(ang * 13 + c.seed);
  y += c.lump * 0.9 * (Math.max(0, rib) ** 2 - 0.6 * Math.max(0, -rib) ** 3) * Math.min(1, t * 3);
  return y;
}

/**
 * A talus cone leaning against a cliff at foot point (fx, fz) with outward direction (ox, oz):
 * a lumpy, slightly concave fan at the angle of repose, apex buried in the wall, toe sunk into
 * the ground. Registered in K.cones so scree can be scattered on its surface.
 */
function talusCone(K, w, fx, fz, ox, oz, hApex, tint) {
  const { H, rng } = K;
  const slope = rng.range(0.62, 0.78);
  const R = hApex / slope;
  const g = H(fx, fz);
  const inset = 6 + hApex * 0.14;
  const c = {
    ax: fx - ox * inset,
    az: fz - oz * inset,
    ay: g + hApex,
    h: hApex,
    R: R + inset,
    ox,
    oz,
    seed: rng() * 100,
    lump: 1.2 + hApex * 0.04,
    noise3: K.ctx.noise.worldNoise.noise3,
    tint,
  };
  (K.cones || (K.cones = [])).push(c);
  const rings = 20;
  const segs = 34;
  const base = w.nv;
  for (let i = 0; i <= rings; i++) {
    const rr = c.R * 1.14 * Math.pow(i / rings, 0.9);
    for (let j = 0; j <= segs; j++) {
      const th = -CONE_SPAN + (2 * CONE_SPAN * j) / segs;
      const ct = Math.cos(th), st = Math.sin(th);
      const dx = ox * ct - oz * st, dz = oz * ct + ox * st;
      const x = c.ax + dx * rr, z = c.az + dz * rr;
      let y = coneY(c, x, z);
      if (!Number.isFinite(y)) y = c.ay - c.h * 1.1;
      if (i === rings || j === 0 || j === segs) y = Math.min(y, H(x, z) - 1.5);
      const k = 0.92 + 0.14 * (i / rings);
      w.v(x, y, z, tint[0] * k, tint[1] * k, tint[2] * k);
    }
  }
  // winding: faces up
  const P = w.pos;
  const a = base + segs + 2, b = a + 1, d = a + segs + 1;
  const ux = P[d * 3] - P[a * 3], uz = P[d * 3 + 2] - P[a * 3 + 2];
  const vx = P[b * 3] - P[a * 3], vz = P[b * 3 + 2] - P[a * 3 + 2];
  const up = uz * vx - ux * vz > 0; // y component of (d - a) x (b - a)
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const p0 = base + i * (segs + 1) + j;
      const p1 = p0 + 1;
      const p2 = p0 + segs + 1;
      const p3 = p2 + 1;
      if (up) w.q(p0, p2, p3, p1);
      else w.q(p0, p1, p3, p2);
    }
  }
  K.occ.add(c.ax + ox * c.R * 0.5, c.az + oz * c.R * 0.5, c.R * 0.45);
  K.count('talusCones');
  return c;
}

/** Height function that includes the talus cones (for scattering scree on them). */
function coneAwareHeight(K, H = K.H) {
  return (x, z) => {
    let h = H(x, z);
    const cones = K.cones;
    if (!cones) return h;
    for (let i = 0; i < cones.length; i++) {
      const c = cones[i];
      const dx = x - c.ax, dz = z - c.az;
      if (dx * dx + dz * dz > c.R * c.R * 1.33) continue;
      const y = coneY(c, x, z);
      if (y > h) h = y;
    }
    return h;
  };
}

/** Graded scree on a cone: small stones high up, big blocks rolled out to the toe. */
function coneScree(K, Hc, c, density = 1, fast = null) {
  const { rng } = K;
  const n = Math.round(c.R * 2.4 * density);
  for (let i = 0; i < n; i++) {
    const t = Math.sqrt(rng()) * 1.06; // uniform per area (the fan narrows toward its apex)
    const th = rng.range(-1, 1) * (CONE_SPAN - 0.25);
    const ct = Math.cos(th), st = Math.sin(th);
    const dx = c.ox * ct - c.oz * st, dz = c.oz * ct + c.ox * st;
    const x = c.ax + dx * c.R * t, z = c.az + dz * c.R * t;
    // only where the cone is exposed (near the apex it is buried in the cliff)
    if (coneY(c, x, z) < K.Hg(x, z) + 0.5) continue;
    let size = (0.3 + 1.6 * t * t) * rng.range(0.5, 1.4);
    if (t > 0.8 && rng() < 0.08) size = rng.range(3, 7);
    const kr = rng();
    placeBoulder(K.field, Hc, kr < 0.6 ? KIND.block : kr < 0.9 ? KIND.slab : KIND.round, x, z, size, rng, {
      tint: tintAround(rng, c.tint, 0.1),
      align: 0.9,
      tilt: 0.35,
      embed: rng.range(0.1, 0.3),
      fast,
    });
  }
}

export function buildScree(K) {
  const { ctx, H, rng } = K;
  const E = ctx.layout.ESCARPMENT;
  const L = ctx.layout.LANDMARK_BY_ID;
  const fbm2 = ctx.noise.worldNoise.fbm2;
  const step = 10;
  let total = 0;
  const sets = [];
  // escarpment: the cliff rises north of cliffLineZ(x); walk south from above the lip
  {
    const foot = [];
    // only where the escarpment is at full height (it fades into the hills at both ends)
    for (let x = E.xStart + 250; x <= E.xEnd - 250; x += step) {
      const cz = ctx.cliffLineZ(x);
      const z0 = cz - 50;
      if (ctx.layout.isReserved(x, cz + 30, 40)) continue;
      const d = findCliffFoot(K.Hg, x, z0, 0, 1, 220, 5);
      if (d < 0) continue;
      foot.push({ x, z: z0 + d, ox: 0, oz: 1, w: 1 });
    }
    sets.push({ foot, region: 'talus-escarpment', hMin: 50, hMax: 125, gap: 0.8, gully: 0.32, tint: [1.12, 1.08, 1.02], perMetre: 1.1, reach: 190 });
  }
  // plateau of the Needle City
  {
    const s = L.needles;
    const foot = [];
    const R0 = 430;
    const n = Math.round((TAU * 520) / step);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const dx = Math.cos(a), dz = Math.sin(a);
      if (ctx.canyonDistance(s.x + dx * 560, s.z + dz * 560).d < 220) continue;
      const d = findCliffFoot(K.Hg, s.x + dx * R0, s.z + dz * R0, dx, dz, 260, 5);
      if (d < 0) continue;
      const fx = s.x + dx * (R0 + d), fz = s.z + dz * (R0 + d);
      if (H(fx, fz) < 2) continue;
      foot.push({ x: fx, z: fz, ox: dx, oz: dz, w: 1 });
    }
    sets.push({ foot, region: 'talus-plateau', hMin: 22, hMax: 55, gap: 1.3, tint: [1.05, 1.02, 0.98], perMetre: 0.9, reach: 150 });
  }
  // mesa of the Descending Temple (sandstone debris)
  {
    const s = L.temple;
    const foot = [];
    const n = Math.round((TAU * 260) / step);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const dx = Math.cos(a), dz = Math.sin(a);
      const d = findCliffFoot(K.Hg, s.x + dx * 195, s.z + dz * 195, dx, dz, 160, 4);
      if (d < 0) continue;
      foot.push({ x: s.x + dx * (195 + d), z: s.z + dz * (195 + d), ox: dx, oz: dz, w: 1 });
    }
    sets.push({ foot, region: 'talus-mesa', hMin: 18, hMax: 40, gap: 1.6, tint: [1.3, 0.88, 0.72], perMetre: 0.9, reach: 110, big: 0.08 });
  }
  // keep only true feet: a real cliff behind, and level-ish ground in front (not a ledge on the
  // cliff face, which would leave a cone or its scree hanging over the drop below)
  for (const set of sets) {
    set.foot = set.foot.filter((f) => {
      const g = K.Hg(f.x, f.z);
      if (K.Hg(f.x - f.ox * 25, f.z - f.oz * 25) - g < 22) return false;
      return K.Hg(f.x + f.ox * 30, f.z + f.oz * 30) > g - 8 && K.Hg(f.x + f.ox * 70, f.z + f.oz * 70) > g - 22;
    });
  }
  // talus cones below the gullies (where a slow noise is high), spaced by their size
  for (const set of sets) {
    const w = K.w(set.region, 'rock');
    let lastX = -1e9, lastZ = -1e9, lastR = 0;
    for (const f of set.foot) {
      const g = 0.5 + 0.5 * fbm2(f.x * 0.004 + 11, f.z * 0.004 - 3, 2);
      const g0 = set.gully ?? 0.45;
      if (g < g0) continue;
      let hA = set.hMin + (set.hMax - set.hMin) * Math.min(1, (g - g0) * 2.2) * rng.range(0.7, 1);
      // the apex must be buried in the cliff, never hanging in the air
      const inset = 6 + hA * 0.14;
      const behind = K.Hg(f.x - f.ox * inset, f.z - f.oz * inset) - K.Hg(f.x, f.z);
      hA = Math.min(hA, behind - 3);
      if (hA < set.hMin * 0.6) continue;
      const R = hA / 0.7;
      // the whole fan must rest on the apron: nowhere along its axis or edges may the ground fall
      // away more than a few metres below the cone's toe line
      const gf = K.Hg(f.x, f.z);
      let supported = true;
      for (const th of [-1.2, -0.6, 0, 0.6, 1.2]) {
        const ct = Math.cos(th), st = Math.sin(th);
        const dx = f.ox * ct - f.oz * st, dz = f.oz * ct + f.ox * st;
        for (const t of [0.35, 0.7, 1.05]) {
          if (K.Hg(f.x + dx * R * t, f.z + dz * R * t) < gf - 6 - 0.15 * R * t) supported = false;
        }
      }
      if (!supported) continue;
      if (Math.hypot(f.x - lastX, f.z - lastZ) < (R + lastR) * 0.5 * set.gap) continue;
      if (ctx.layout.isReserved(f.x, f.z, R * 1.2)) continue;
      talusCone(K, w, f.x, f.z, f.ox, f.oz, hA, set.tint);
      lastX = f.x;
      lastZ = f.z;
      lastR = R;
    }
  }
  const Hc = coneAwareHeight(K);
  const Hcf = coneAwareHeight(K, K.Hg);
  K.surfaceAt = Hc;
  for (const c of K.cones || []) coneScree(K, Hc, c, 1, Hcf);
  for (const set of sets) {
    total += scatterScree(ctx, K.field, K.occ, rng, set.foot, { step, perMetre: set.perMetre, reach: set.reach, tint: set.tint, bigChance: set.big ?? 0.05, H: Hc, fast: Hcf });
  }
  K.count('scree', total);
}
