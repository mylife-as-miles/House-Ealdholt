// The analytic landscape. heightAt(x, z) is the single source of truth for the ground:
// the terrain mesh, vegetation, rocks, ruins, landmarks and the camera all sample it.
//
// Layers (in order):
//   1. domain-warped rolling hills + interior ridges, small-scale hummocks and rock tors
//   2. the outer mountain ring: massifs with cols, glacial cirques / aretes / horns, rock spires,
//      and the low western "Sun Gate" that lets the evening sun into the basin
//   3. sculpted features for each landmark site (lake, canyon, plateau, mesa, crater,
//      escarpment, valley, terraces) — these override layers 1-2 where they apply
//
// Everything is continuous, deterministic and fast (~2 µs per sample).
// shots/terrain/checkpoints.mjs verifies the sculpted sites against the original heights.

import { worldNoise as N, smoothstep, lerp, saturate, clamp } from './noise.js';
import { WORLD, LAKE, CANYON, ESCARPMENT, LANDMARK_BY_ID } from './layout.js';

const { noise2, fbm2, ridged2 } = N;

const SITE = LANDMARK_BY_ID;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Terraced remap of t in [0,1] into `steps` ledges; `sharp` in (0,0.5) controls riser steepness. */
function terrace(t, steps, sharp = 0.3) {
  const v = t * steps;
  const k = Math.floor(v);
  const f = v - k;
  return (k + smoothstep(sharp, 1 - sharp, f)) / steps;
}

// Precompute canyon segments with cumulative length for the along-parameter.
const canyonSegs = [];
let canyonLength = 0;
for (let i = 0; i < CANYON.length - 1; i++) {
  const [ax, az] = CANYON[i];
  const [bx, bz] = CANYON[i + 1];
  const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
  canyonSegs.push({ ax, az, bx, bz, len, start: canyonLength });
  canyonLength += len;
}

/** Distance from (x,z) to the canyon polyline and the normalised along-parameter t in [0,1]. */
export function canyonDistance(x, z) {
  let best = Infinity;
  let bestAlong = 0;
  for (let i = 0; i < canyonSegs.length; i++) {
    const s = canyonSegs[i];
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + dx * t - x;
    const pz = s.az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) {
      best = d;
      bestAlong = s.start + t * s.len;
    }
  }
  return { d: Math.sqrt(best), t: bestAlong / canyonLength };
}

// Non-allocating variant for the hot path (results in _cq[0] = distance, _cq[1] = along).
// (A typed array, not module-level `let`s: assigning doubles to those allocates a heap number.)
const _cq = new Float64Array(2);
function canyonQuery(x, z) {
  let best = Infinity;
  let bestAlong = 0;
  for (let i = 0; i < canyonSegs.length; i++) {
    const s = canyonSegs[i];
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + dx * t - x;
    const pz = s.az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) {
      best = d;
      bestAlong = s.start + t * s.len;
    }
  }
  _cq[0] = Math.sqrt(best);
  _cq[1] = bestAlong / canyonLength;
}

/** z coordinate of the escarpment cliff line at x (land north of it is raised). */
export function cliffLineZ(x) {
  return ESCARPMENT.baseZ + 110 * Math.sin(x * 0.0021 + 0.5) + 35 * noise2(x * 0.0011, 7.7);
}

/** Canyon half-width at along-parameter t (metres, at the rim). */
function canyonHalfWidth(t, x, z) {
  return 175 + 45 * noise2(x * 0.0017, z * 0.0017) - 40 * smoothstep(0.85, 1, t);
}

// ---------------------------------------------------------------------------
// the outer mountain ring
// ---------------------------------------------------------------------------
//
// Majestic massifs (not uniform teeth): a few named mountain masses spaced around the basin with
// cols between them, carved by glacial cirques (Worley cells: bowls at the cell centres, knife-edge
// aretes on the cell borders, horn peaks where three cirques meet), ridged detail on top, a handful
// of sheer rock spires, and in the west the Sun Gate: the ring sinks to a low col with a notch
// between two spires, so the evening sun still pours into the basin at golden hour.

const TAU = Math.PI * 2;
const RING_BLEND0 = 2450;
const RING_BLEND1 = 3050;
const GATE_ANGLE = -Math.PI + 0.087; // ~5 deg north of due west (the golden-hour sun path)
const GATE_C = Math.cos(GATE_ANGLE);
const GATE_S = Math.sin(GATE_ANGLE);

/** [angle (atan2(z, x)), centre radius, height, angular half-width] */
const MASSIFS = [
  [-1.83, 3750, 1450, 0.3], // NNW: west flank of the Loom valley head
  [-1.12, 3950, 1700, 0.26], // NNE: between the Loom valley and the canyon gorge
  [-0.52, 3850, 1850, 0.3], // NE: the great massif beyond the Needle City
  [0.12, 3750, 1300, 0.26], // E
  [0.7, 3850, 1650, 0.3], // SE: behind the Unmoored Isles
  [1.36, 3650, 1200, 0.28], // S
  [1.98, 3800, 1550, 0.26], // SSW: behind the Descending Temple
  [2.28, 4150, 1100, 0.2], // SW (kept south of the Temple's evening sun line)
  [-2.42, 3900, 1150, 0.28], // NW: beyond the escarpment
  [GATE_ANGLE + 0.5, 4450, 760, 0.14], // the two dark shoulders framing the Sun Gate (far out, so
  [GATE_ANGLE - 0.52, 4400, 700, 0.14], // their evening shadows stay in the western foothills)
].map(([a, rc, hc, w]) => ({ a, rc, hc, w, ca: Math.cos(a), sa: Math.sin(a) }));

/** Rock spires: [angle, radius, height above ground, radius at the base] */
const SPIRES = [
  [GATE_ANGLE + 0.115, 3380, 820, 170], // the Sun Gate pair
  [GATE_ANGLE - 0.105, 3330, 700, 150],
  [-0.78, 3280, 560, 120], // NE shoulder
  [1.62, 3240, 480, 110], // south
  [1.7, 3390, 400, 95],
  [-2.08, 3350, 430, 105], // NW
].map(([a, rc, hc, rb]) => ({ x: rc * Math.cos(a), z: rc * Math.sin(a), hc, rb }));

/** Worley F1 (distance to the nearest jittered feature point), in cell units. */
function worley(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cz = zi + dz;
      let hh = (Math.imul(cx, 374761393) + Math.imul(cz, 668265263)) | 0;
      hh = Math.imul(hh ^ (hh >>> 13), 1274126177);
      const hx = ((hh ^ (hh >>> 16)) >>> 0) / 4294967296;
      hh = Math.imul(hh ^ (hh >>> 15), 2246822519);
      const hz = ((hh ^ (hh >>> 13)) >>> 0) / 4294967296;
      const px = cx + 0.12 + 0.76 * hx - x, pz = cz + 0.12 + 0.76 * hz - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function outerRing(x, z, r, rn, wx, wz) {
  const ir = 1 / Math.max(r, 1);
  const ux = x * ir, uz = z * ir;
  // massif envelope (cos/sin of the angular offset via dot products: no atan2 needed)
  let env = 0;
  for (let i = 0; i < MASSIFS.length; i++) {
    const m = MASSIFS[i];
    const c = ux * m.ca + uz * m.sa; // cos(da)
    if (c < 0.6) continue;
    const da = (ux * m.sa - uz * m.ca) / m.w; // sin(angular offset) / width
    const dr = (r - m.rc) / (r < m.rc ? 750 : 1700);
    const e = da * da + dr * dr;
    if (e < 9) env += m.hc * Math.exp(-e);
  }
  // the Sun Gate sector sinks low
  const gc = ux * GATE_C + uz * GATE_S;
  const gate = smoothstep(0.74, 0.96, gc);
  const notch = smoothstep(0.985, 0.9985, gc) * smoothstep(2500, 2900, r);
  // foothills + distant ranges beyond the world edge
  let base = 300 * smoothstep(2350, 3300, rn);
  if (r > 5200) base += 520 * smoothstep(5200, 7600, r) * (0.7 + 0.6 * noise2(x * 0.0003, z * 0.0003));
  base *= 1 - 0.45 * gate;
  env *= 1 - 0.85 * gate;
  // ...but far out (~5 km) the western wall rises again, notched right behind the gate spires:
  // around 18:00 the sun sinks behind it and its last light pours through the notch alone.
  if (gate > 0) {
    const dw = (r - 5300) / 900;
    const farNotch = smoothstep(0.9965, 0.9993, gc);
    env += gate * 820 * Math.exp(-dw * dw) * (1 - 0.85 * farNotch);
  }

  // glacial carving
  // (wx, wz: the hills' domain warp, re-used so ridge lines meander)
  // big cirques: flat-floored bowls, steep headwalls, knife-edge aretes, horns at the triple points
  const c1 = Math.min(1, worley(wx * (1 / 900), wz * (1 / 900)) * 1.42);
  const cirque = c1 * Math.sqrt(c1);
  // hanging cirques on the flanks
  const c2 = Math.min(1, worley(wx * (1 / 340) + 17.3, wz * (1 / 340) - 5.1) * 1.42);
  const rg = ridged2(wx * 0.0017 + 3.3, wz * 0.0017 - 1.1, 3);
  const shape = 0.3 + 0.56 * cirque + 0.12 * c2 * c2 + 0.14 * rg * rg;
  let hr = base * (0.7 + 0.5 * cirque) + env * shape + (30 + env * 0.02) * fbm2(x * 0.0065, z * 0.0065, 2);
  hr *= 1 - 0.55 * notch;

  // spires
  for (let i = 0; i < SPIRES.length; i++) {
    const sp = SPIRES[i];
    const dx = x - sp.x, dz = z - sp.z;
    const d2 = dx * dx + dz * dz;
    const rb = sp.rb;
    if (d2 > 4 * rb * rb) continue;
    // fluted cross-section
    const d = Math.sqrt(d2) * (1 + 0.22 * noise2(dx * 0.03 + i * 7.1, dz * 0.03));
    const tower = smoothstep(rb, rb * 0.6, d); // sheer flanks
    const tip = 1 - smoothstep(0, rb * 0.6, d); // pointed summit
    const apron = 1 - smoothstep(rb * 0.8, rb * 2.0, d); // talus-buried foot
    hr += sp.hc * (0.72 * tower + 0.28 * tip * tip) + 90 * apron;
  }
  return hr;
}

const dist2 = (dx, dz) => Math.sqrt(dx * dx + dz * dz);

// ---------------------------------------------------------------------------
// main height function
// ---------------------------------------------------------------------------

export function heightAt(x, z) {
  // --- 1. warped rolling hills ------------------------------------------------
  const wx = x + 230 * fbm2(x * 0.00045 + 3.1, z * 0.00045 - 1.7, 3);
  const wz = z + 230 * fbm2(x * 0.00045 - 5.3, z * 0.00045 + 2.9, 3);

  const hb = fbm2(wx * 0.0011, wz * 0.0011, 5);
  let h = 72 + 52 * hb;
  h += 9 * fbm2(x * 0.0065, z * 0.0065, 3);
  // small-scale relief: hummocks everywhere, and weathered rock tors breaking through the crests
  // (the sculpted flats below override this, so landmark sites are untouched)
  h += 2.2 * fbm2(x * 0.037 + 3.7, z * 0.037 - 8.1, 3);
  const crest = smoothstep(0.12, 0.5, hb);
  if (crest > 0) {
    const k = ridged2(x * 0.0105 + 5.2, z * 0.0105 - 2.6, 2);
    if (k > 0.66) h += 11 * crest * smoothstep(0.66, 0.95, k);
  }

  // interior ridges, stronger away from the lake (the massif ring replaces them further out)
  const rLake = dist2(x - LAKE.x, z - LAKE.z);
  const r = Math.sqrt(x * x + z * z);
  const ridgeMask = smoothstep(700, 1600, rLake) * (1 - smoothstep(RING_BLEND1, RING_BLEND1 + 600, r));
  if (ridgeMask > 0) {
    const rg = ridged2(wx * 0.00075 + 11.0, wz * 0.00075 - 4.0, 5);
    h += 190 * rg * rg * ridgeMask;
  }

  // --- 2. outer mountain ring ----------------------------------------------
  // Old ridged ring inside ~2.45 km (keeps every sculpted site exactly as it was), blending into
  // the massif ring (see outerRing) further out.
  const rn = r + 320 * noise2(x * 0.0007, z * 0.0007);
  const ringT = smoothstep(2350, 4200, rn);
  if (ringT > 0) {
    // (the Orrery's crater rim keeps the old ring under it)
    const oc = SITE.orrery;
    const b = smoothstep(RING_BLEND0, RING_BLEND1, rn) * smoothstep(640, 900, dist2(x - oc.x, z - oc.z));
    let ring = 0;
    if (b < 1) {
      const m = ridged2(wx * 0.00052 - 2.0, wz * 0.00052 + 9.0, 6);
      ring = ringT * (380 + 1150 * m * m + 120 * fbm2(x * 0.002, z * 0.002, 3));
    }
    if (b > 0) ring = lerp(ring, outerRing(x, z, r, rn, wx, wz), b);
    h += ring;
  }

  // --- 3. features ---------------------------------------------------------

  // 3a. Northern valley that the Loom of Hours straddles (runs N–S).
  {
    const s = SITE.loom;
    const zMask = smoothstep(-1150, -1450, z) * (1 - smoothstep(-2900, -3400, z));
    if (zMask > 0) {
      const cx = s.x + 60 * Math.sin(z * 0.0024);
      const dx = Math.abs(x - cx);
      const floor = 46 + 10 * fbm2(x * 0.004, z * 0.004, 2);
      const wall = Math.max(h, 250 + 60 * fbm2(x * 0.0025, z * 0.0025, 3));
      const side = smoothstep(110, 470, dx);
      const valleyH = lerp(floor, wall, side * side * (3 - 2 * side));
      h = lerp(h, valleyH, zMask);
    }
  }

  // 3b. Highlands around the canyon, then the canyon itself.
  {
    canyonQuery(x, z);
    const d = _cq[0], t = _cq[1];
    if (d < 1100) {
      const hl = (1 - smoothstep(260, 1000, d)) * (1 - smoothstep(0.72, 0.97, t));
      if (hl > 0) {
        const plateau = 168 + 26 * fbm2(x * 0.0022, z * 0.0022, 3);
        h = lerp(h, Math.max(h, plateau), hl);
      }
      const w = canyonHalfWidth(t, x, z);
      if (d < w * 1.15) {
        const floor = -18 + 4 * noise2(x * 0.01, z * 0.01);
        // jagged walls with ledges
        const jag = d + 14 * fbm2(x * 0.012, z * 0.012, 3);
        let wt = smoothstep(w * 0.28, w * 1.05, jag);
        wt = terrace(wt, 4, 0.22);
        const canyonH = lerp(floor, h, wt);
        h = Math.min(h, canyonH);
      }
    }
  }

  // 3c. Great lake basin ("The Mirror").
  if (rLake < (LAKE.radius + 150) * 1.06) {
    const R = LAKE.radius + 150 * fbm2(x * 0.0011 + 40, z * 0.0011 - 12, 3);
    const m = 1 - smoothstep(R * 0.42, R * 1.06, rLake);
    if (m > 0) {
      const bottom = -42 + 12 * fbm2(x * 0.003, z * 0.003, 2);
      const mm = m * m * (3 - 2 * m);
      h = lerp(h, bottom, mm);
    }
  }

  // 3d. The rocky islet under the Stair to Nowhere.
  {
    const s = SITE.stair;
    const d = dist2(x - s.x, z - s.z);
    if (d < 260) {
      const jag = 10 * fbm2(x * 0.03, z * 0.03, 2);
      const islet = 9 + jag * 0.4 - Math.max(0, d - 48) * 1.4;
      h = Math.max(h, islet);
    }
  }

  // 3e. Plateau of the Needle City: flat top, sheer eroded cliffs.
  {
    const s = SITE.needles;
    const d = dist2(x - s.x, z - s.z);
    if (d < 1200) {
      const R = 470 + 55 * fbm2(x * 0.003 + 5, z * 0.003 - 5, 3);
      const top = 222 + 4 * fbm2(x * 0.006, z * 0.006, 2);
      const fins = 22 * ridged2(x * 0.011, z * 0.011, 3);
      const cliff = top - Math.max(0, d - R) * 2.6 + (fins - 11) * smoothstep(R, R + 45, d);
      h = Math.max(h, Math.min(top, cliff));
    }
  }

  // 3f. The mesa beneath the Descending Temple.
  {
    const s = SITE.temple;
    const d = dist2(x - s.x, z - s.z);
    if (d < 900) {
      const R = 205 + 22 * fbm2(x * 0.006, z * 0.006, 2);
      const top = 236 + 3 * noise2(x * 0.01, z * 0.01);
      let side = top - Math.max(0, d - R) * 3.2;
      side += 5 * Math.sin(side * 0.13) * smoothstep(R, R + 25, d); // horizontal strata ledges
      // talus apron at the foot
      side = Math.max(side, top - 150 - Math.max(0, d - R - 45) * 0.55);
      h = Math.max(h, Math.min(top, side));
    }
  }

  // 3g. The crater of the Stone Orrery.
  {
    const s = SITE.orrery;
    const d = dist2(x - s.x, z - s.z);
    if (d < 1300) {
      const Rr = 470 + 25 * noise2(x * 0.004, z * 0.004);
      const inner = 1 - smoothstep(Rr * 0.86, Rr * 1.02, d);
      const bowl = 24 + 80 * Math.pow(Math.min(d / Rr, 1), 4);
      h = lerp(h, bowl, inner);
      const width = d < Rr ? 55 : 190;
      const gully = 0.75 + 0.25 * noise2((x - s.x) * 0.012, (z - s.z) * 0.012);
      const q = (d - Rr) / width;
      h += 95 * gully * Math.exp(-q * q);
    }
  }

  // 3h. The northern escarpment (cliff for the Honeycomb Cloister).
  {
    const e = ESCARPMENT;
    const ex = smoothstep(e.xStart - 250, e.xStart + 150, x) * (1 - smoothstep(e.xEnd - 150, e.xEnd + 250, x));
    if (ex > 0) {
      const cz = cliffLineZ(x);
      const s = cz - z + 16 * fbm2(x * 0.02, z * 0.02, 2); // > 0 north of the cliff line
      if (s > -440) {
        // foot of the cliff: a level apron that blends back into the hills further south
        const foot = lerp(70 + 6 * fbm2(x * 0.01, z * 0.01, 2), h, smoothstep(-40, -420, s));
        // the raised land behind the cliff
        const top = Math.max(h, 72 + e.rise + 60 * fbm2(x * 0.003, z * 0.003, 3) * smoothstep(30, 220, s));
        const riseT = terrace(smoothstep(-12, 34, s), 3, 0.28);
        h = lerp(h, lerp(foot, top, riseT), ex);
      }
    }
  }

  // 3i. Terraces / plains.
  // Choir plain — broad, calm, slightly undulating.
  {
    const s = SITE.choir;
    const d = dist2(x - s.x, z - s.z);
    const m = 1 - smoothstep(470, 820, d);
    if (m > 0) h = lerp(h, 44 + 5 * fbm2(x * 0.004, z * 0.004, 2), m * m * (3 - 2 * m));
  }
  // Wardens' shore terrace — a flat ledge stepping down into the lake.
  {
    const s = SITE.wardens;
    const d = dist2(x - s.x, z - s.z);
    const m = 1 - smoothstep(250, 430, d);
    if (m > 0) h = lerp(h, 15 + 1.5 * noise2(x * 0.01, z * 0.01), m);
  }
  // The lowland forest under the Unmoored Isles.
  {
    const s = SITE.isles;
    const d = dist2(x - s.x, z - s.z);
    const m = 1 - smoothstep(420, 780, d);
    if (m > 0) h = lerp(h, 48 + 22 * fbm2(x * 0.003, z * 0.003, 3), m * 0.85);
  }

  return h;
}

// ---------------------------------------------------------------------------
// derived queries
// ---------------------------------------------------------------------------

const EPS = 1.5;

/** Unit surface normal at (x, z). Writes into `out` ({x,y,z}) if given. */
export function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
  const hL = heightAt(x - EPS, z);
  const hR = heightAt(x + EPS, z);
  const hD = heightAt(x, z - EPS);
  const hU = heightAt(x, z + EPS);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * EPS;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

/** Slope in [0,1]: 0 = flat, 1 = vertical. */
export function slopeAt(x, z) {
  return 1 - normalAt(x, z).y;
}

/** True if the point is under water (ground below water level + margin). */
export function isUnderwater(x, z, margin = 0) {
  return heightAt(x, z) < WORLD.waterLevel + margin;
}

/** Height that never dips below the water surface — handy for placing floating things. */
export function surfaceAt(x, z) {
  return Math.max(heightAt(x, z), WORLD.waterLevel);
}

export { clamp, saturate };
