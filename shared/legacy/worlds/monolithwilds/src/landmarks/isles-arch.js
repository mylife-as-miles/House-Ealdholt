// Unmoored Isles — architecture: the sanctuary and its tower (whose crown hovers above the
// shaft), a broken tholos, the tether plaza whose chains still hold one isle to the forest floor,
// the glyph shrine, the lonely arch on the highest rock, a colonnade walking off the edge,
// hermit cells, rope bridges that stretch between drifting isles, a stone bridge broken in two
// with its fragments frozen mid-fall, and chains dangling into the void.
//
// Everything is emitted into the per-material IsleAcc accumulators with the right slot (see
// isles-geo.js); bridges/chains use a per-vertex slot blend.

import * as THREE from 'crownfall-world-three';
import { T, frustum4 } from './isles-geo.js';
import { ROCKS } from './isles-rock.js';
import { archRing } from '../core/shapes.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _R = new THREE.Vector3();

export function slotAll(A, a, b = a, w = 0) {
  for (const k in A) A[k].setSlot(a, b, w);
}
function slotFnAll(A, fn) {
  for (const k in A) A[k].setSlotFn(fn);
}

/** Local frame: origin + yaw. Local +X -> (cos, -sin), +Z -> (sin, cos) (three's rotation.y). */
function frame(x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x, y, z, yaw, px: (lx, lz) => x + lx * c + lz * s, pz: (lx, lz) => z - lx * s + lz * c };
}
function fput(acc, F, tpl, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = null) {
  acc.put(tpl, F.px(lx, lz), F.y + ly, F.pz(lx, lz), sx, sy, sz, rx, F.yaw + ry, rz, tint);
}
function fbox(acc, F, lx, ly, lz, sx, sy, sz, tint = null, ry = 0) {
  acc.put(T.box, F.px(lx, lz), F.y + ly, F.pz(lx, lz), sx, sy, sz, 0, F.yaw + ry, 0, tint);
}

/** Tapered tube along points [[x,y,z],...]; rad number or fn(t). Parallel-transport frames. */
export function tube(acc, pts, rad, sides = 5, tint = null) {
  const n = pts.length;
  if (n < 2) return;
  const P = new Float32Array(n * sides * 3), N = new Float32Array(n * sides * 3);
  const I = [];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    if (i === 0) {
      // initial normal: perpendicular to t
      const rx = Math.abs(ty) < 0.9 ? 0 : 1, ry = Math.abs(ty) < 0.9 ? 1 : 0;
      nx = ry * tz - 0 * ty; ny = 0 * tx - rx * tz; nz = rx * ty - ry * tx;
    } else {
      const d = nx * tx + ny * ty + nz * tz;
      nx -= tx * d; ny -= ty * d; nz -= tz * d;
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const r = typeof rad === 'function' ? rad(i / (n - 1)) : rad;
    for (let k = 0; k < sides; k++) {
      const an = (k / sides) * TAU;
      const c = Math.cos(an), s = Math.sin(an);
      const dx = nx * c + bx * s, dy = ny * c + by * s, dz = nz * c + bz * s;
      const o = (i * sides + k) * 3;
      P[o] = pts[i][0] + dx * r;
      P[o + 1] = pts[i][1] + dy * r;
      P[o + 2] = pts[i][2] + dz * r;
      N[o] = dx;
      N[o + 1] = dy;
      N[o + 2] = dz;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k, b = i * sides + ((k + 1) % sides), c = a + sides, d = b + sides;
      I.push(a, b, c, b, d, c);
    }
  }
  let C = null;
  if (tint != null) {
    const col = new THREE.Color();
    if (typeof tint === 'number') col.setRGB(tint, tint, tint);
    else if (Array.isArray(tint)) col.setRGB(tint[0], tint[1], tint[2]);
    else col.set(tint);
    C = new Float32Array(P.length);
    for (let i = 0; i < C.length; i += 3) {
      C[i] = col.r;
      C[i + 1] = col.g;
      C[i + 2] = col.b;
    }
  }
  acc.raw(P, N, I, C);
}

/** Chain links along a polyline (alternating 90°). `open` drops the last link askew (snapped). */
export function chain(acc, pts, L, tint = 0.9, open = false) {
  const step = L * 0.9;
  let seg = 0, along = 0, idx = 0;
  const segLen = [];
  for (let i = 0; i < pts.length - 1; i++) segLen.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]));
  let d = step * 0.5;
  while (seg < segLen.length) {
    while (seg < segLen.length && d - along > segLen[seg]) {
      along += segLen[seg];
      seg++;
    }
    if (seg >= segLen.length) break;
    const a = pts[seg], b = pts[seg + 1];
    const t = (d - along) / segLen[seg];
    _Y.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    _R.set(Math.abs(_Y.y) < 0.9 ? 0 : 1, Math.abs(_Y.y) < 0.9 ? 1 : 0, 0);
    _X.crossVectors(_R, _Y).normalize();
    if (idx % 2) _X.crossVectors(_Y, _X).normalize();
    _Z.crossVectors(_X, _Y);
    _m.makeBasis(_X, _Y, _Z);
    _m.scale(_R.set(L, L, L));
    _m.setPosition(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    acc.putM(T.link, _m, tint);
    idx++;
    d += step;
  }
  if (open && idx > 0) {
    const e = pts[pts.length - 1];
    acc.put(T.link, e[0] + L * 0.3, e[1] - L * 0.5, e[2], L, L * 0.8, L, 0.9, 0.4, 0.6, tint);
  }
}

/** Points of a sagging span p0 -> p1 (parabolic sag in y). */
function sagPoints(p0, p1, sag, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t]);
  }
  return out;
}

/** Slot blend along the horizontal axis p0 -> p1. */
function axisSlot(p0, p1, sa, sb) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
  const L2 = dx * dx + dz * dz || 1;
  return (x, y, z, o) => {
    o[0] = sa;
    o[1] = sb;
    o[2] = clamp(((x - p0[0]) * dx + (z - p0[2]) * dz) / L2, 0, 1);
  };
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/** Column with plinth + capital; `broken` < 1 truncates the shaft (no capital). */
function column(acc, F, lx, lz, y0, h, r, tint, broken = 1) {
  fbox(acc, F, lx, y0 + 0.3, lz, r * 2.7, 0.9, r * 2.7, tint);
  const hs = (h - 1.6) * broken;
  fput(acc, F, T.col12, lx, y0 + 0.75, lz, r, hs, r, 0, 0, 0, tint);
  if (broken >= 1) {
    fput(acc, F, frustum4(1.5), lx, y0 + 0.75 + hs, lz, r * 1.75, 0.55, r * 1.75, 0, 0, 0, tint);
    fbox(acc, F, lx, y0 + 0.75 + hs + 0.7, lz, r * 2.8, 0.35, r * 2.8, tint);
  } else {
    // jagged break: a tilted half-drum on top
    fput(acc, F, T.col12, lx + r * 0.2, y0 + 0.6 + hs, lz, r * 0.8, r * 0.9, r * 0.8, 0.35, 0.5, 0.2, tint);
  }
}

/** Drums of a fallen column lying on the ground. */
function fallenColumn(acc, groundAt, x, z, dir, r, n, tint, rng) {
  for (let k = 0; k < n; k++) {
    const d = k * r * 2.9 + rng() * 0.8;
    const px = x + Math.sin(dir) * d, pz = z + Math.cos(dir) * d;
    const y = groundAt(px, pz) + r * 0.85;
    acc.put(T.col12, px, y, pz, r, r * 2.6, r, Math.PI / 2 + (rng() - 0.5) * 0.2, dir + (rng() - 0.5) * 0.5, 0, tint);
  }
}

/** Straight stair flight from bottom (x0,y0,z0) to top (x1,y1,z1); ground fn for block feet. */
function stairs(acc, x0, y0, z0, x1, y1, z1, width, ground = null, tint = null) {
  const n = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 0.34));
  const dx = x1 - x0, dz = z1 - z0;
  const yaw = Math.atan2(dx, dz);
  const run = Math.hypot(dx, dz) / n;
  for (let s = 0; s < n; s++) {
    const t = (s + 0.5) / n;
    const x = x0 + dx * t, z = z0 + dz * t;
    const top = y0 + ((y1 - y0) * (s + 1)) / n;
    const foot = ground ? Math.min(ground(x, z) - 0.6, top - 0.5) : top - 1.6;
    acc.put(T.box, x, (top + foot) / 2, z, width, top - foot, run * 1.02, 0, yaw, 0, tint);
  }
}

/** Stepped path hugging the terrain along a polyline. */
function pathSteps(acc, pts, width, ground, rng) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / 0.8));
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const g = ground(x, z);
      const top = Math.ceil((g + 0.12) / 0.3) * 0.3;
      acc.put(T.box, x, (top + g - 0.9) / 2, z, width * (0.94 + rng() * 0.12), top - g + 0.9, 0.84, 0, yaw + (rng() - 0.5) * 0.06, 0, 0.85 + rng() * 0.25);
    }
  }
}

/** Lantern on a post: iron post + cage, glowing core. */
let HALOS = [];
function lantern(A, x, y, z, h = 3.2) {
  if (!A.glow.slotFn) HALOS.push({ slot: A.glow.sa, x, y: y + h + 0.5, z, size: 4.5 });
  A.iron.put(T.box, x, y + h / 2, z, 0.22, h, 0.22, 0, 0.3, 0, 0.8);
  A.iron.put(T.box, x, y + h + 0.05, z, 0.8, 0.1, 0.8, 0, 0.3, 0, 0.8);
  A.glow.put(T.box, x, y + h + 0.5, z, 0.46, 0.75, 0.46, 0, 0.3, 0, 1);
  A.iron.put(frustum4(0.1), x, y + h + 0.9, z, 0.85, 0.5, 0.85, 0, 0.3 + Math.PI / 4, 0, 0.8);
}

// ---------------------------------------------------------------------------------------------
// Bridges and chains
// ---------------------------------------------------------------------------------------------

function ropeBridge(A, rng, p0, p1, sa, sb, { width = 2.3, sag = 8, lanternAt = -1 } = {}) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const Lh = Math.hypot(dx, dz);
  const L = Math.hypot(Lh, dy);
  const yaw = Math.atan2(dx, dz);
  const sx = Math.cos(yaw), sz = -Math.sin(yaw); // local +X (side)
  slotFnAll(A, axisSlot(p0, p1, sa, sb));
  const deck = (t) => [p0[0] + dx * t, p0[1] + dy * t - sag * 4 * t * (1 - t), p0[2] + dz * t];
  const n = Math.floor(L / 0.8);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    if (t > 0.04 && t < 0.96 && rng() < 0.06) continue; // missing planks
    const p = deck(t);
    const slope = Math.atan2(dy - sag * 4 * (1 - 2 * t), Lh);
    const hang = rng() < 0.025 ? 0.9 : 0;
    A.wood.put(T.box, p[0], p[1] - hang * 0.6, p[2], width * (0.92 + rng() * 0.16), 0.13, 0.55, -slope + hang, yaw, (rng() - 0.5) * 0.07, 0.75 + rng() * 0.35);
  }
  const N = Math.max(8, Math.round(L / 3));
  for (const side of [-1, 1]) {
    const off = side * (width / 2 + 0.06);
    const low = sagPoints(p0, p1, sag, N).map((p) => [p[0] + sx * off, p[1] - 0.12, p[2] + sz * off]);
    const high = sagPoints(p0, p1, sag * 0.92, N).map((p) => [p[0] + sx * off * 1.08, p[1] + 1.15, p[2] + sz * off * 1.08]);
    tube(A.wood, low, 0.1, 4, 0.5);
    tube(A.wood, high, 0.085, 4, 0.5);
    for (let i = 1; i < N; i += 1) {
      const a = low[i], b = high[i];
      A.wood.put(T.box, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 0.06, b[1] - a[1], 0.06, 0, yaw, 0, 0.5);
    }
  }
  if (lanternAt > 0) {
    const p = deck(lanternAt);
    const hx = p[0] + sx * (width / 2 + 0.1), hz = p[2] + sz * (width / 2 + 0.1);
    A.iron.put(T.box, hx, p[1] + 0.75, hz, 0.05, 0.8, 0.05, 0, 0, 0, 0.7);
    A.glow.put(T.box, hx, p[1] + 0.2, hz, 0.34, 0.5, 0.34, 0, 0.4, 0, 1);
  }
  // anchor posts at both ends
  for (const p of [p0, p1]) {
    for (const side of [-1, 1]) {
      const off = side * (width / 2 + 0.55);
      A.stone.put(T.boxBase, p[0] + sx * off, p[1] - 1.5, p[2] + sz * off, 0.95, 4.2, 0.95, 0, yaw, 0, 0.9);
      A.stone.put(frustum4(0.3), p[0] + sx * off, p[1] + 2.7, p[2] + sz * off, 1.15, 0.7, 1.15, 0, yaw, 0, 0.9);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Isles
// ---------------------------------------------------------------------------------------------

/**
 * @param A accumulators {rock, grass, stone, glyph, wood, iron, foliage, glow, water}
 * @param S shapes by id (A..H) with spec.slot
 * @param bodies isle body samplers by id (under, cliff)
 */
export function buildArchitecture(ctx, A, S, bodies, rng, groundAt, out) {
  HALOS = [];
  out.halos = HALOS;
  const tintJ = () => 0.86 + rng() * 0.24;

  // ---------------------------------------------------------------- A: the sanctuary
  {
    const sh = S.A;
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const yaw = sh.spec.rot; // front (local -X) faces west-south-west, toward B and the lake
    const F = frame(pad.ax, pad.h, pad.az, yaw);
    const g = (x, z) => sh.topAt(x, z);
    // podium
    const tiers = [[52, 38, 1.7], [47, 33, 3.4], [42, 28, 5.1]];
    for (const [w, d, top] of tiers) fbox(A.stone, F, 0, (top - 4) / 2, 0, w, top + 4, d, 0.92);
    const FL = 5.1;
    // front stair (local -X)
    {
      const x0 = F.px(-21 - 9.5, 0), z0 = F.pz(-21 - 9.5, 0);
      const x1 = F.px(-21, 0), z1 = F.pz(-21, 0);
      stairs(A.stone, x0, pad.h, z0, x1, pad.h + FL, z1, 13, g, 0.95);
      for (const side of [-1, 1]) fbox(A.stone, F, -25.5, 1.4, side * 7.6, 10, 3.4 + 2, 1.6, 0.85);
    }
    // peristyle 10 x 6 on a 38 x 24 rectangle
    const cols = [];
    const nx = 10, nz = 6, hx = 19, hz = 12;
    for (let i = 0; i < nx; i++) for (const zs of [-1, 1]) cols.push([-hx + (2 * hx * i) / (nx - 1), zs * hz]);
    for (let j = 1; j < nz - 1; j++) for (const xs of [-1, 1]) cols.push([xs * hx, -hz + (2 * hz * j) / (nz - 1)]);
    const H = 13;
    const intact = new Set();
    cols.forEach(([lx, lz], i) => {
      const r = rng();
      // the north-west corner collapsed
      const nw = lx < -8 && lz < 0;
      if ((nw && r < 0.7) || r < 0.1) {
        if (r < 0.45) column(A.stone, F, lx, lz, FL, H, 0.85, tintJ(), 0.12 + rng() * 0.3);
        fallenColumn(A.stone, g, F.px(lx - 3, lz - 2), F.pz(lx - 3, lz - 2), yaw + Math.PI * (0.8 + rng() * 0.6), 0.8, 3, 0.9, rng);
      } else {
        column(A.stone, F, lx, lz, FL, H, 0.85, tintJ(), 1);
        intact.add(i);
      }
    });
    // architrave + glyph frieze + cornice over bays whose two columns stand
    const top = FL + H + 0.1;
    const bay = (a, b) => {
      const ia = cols.findIndex((c) => c[0] === a[0] && c[1] === a[1]);
      const ib = cols.findIndex((c) => c[0] === b[0] && c[1] === b[1]);
      if (!intact.has(ia) || !intact.has(ib)) return;
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 2.2;
      const along = Math.abs(b[0] - a[0]) > 0.1 ? 0 : Math.PI / 2;
      fbox(A.stone, F, cx, top + 0.8, cz, len, 1.6, 2.3, 0.95, along);
      fbox(A.glyph, F, cx, top + 2.25, cz, len - 0.3, 1.3, 1.9, 1, along);
      fbox(A.stone, F, cx, top + 3.2, cz, len + 0.4, 0.6, 3.0, 0.9, along);
    };
    for (let i = 0; i < nx - 1; i++) for (const zs of [-1, 1]) bay([-hx + (2 * hx * i) / (nx - 1), zs * hz], [-hx + (2 * hx * (i + 1)) / (nx - 1), zs * hz]);
    for (let j = 0; j < nz - 1; j++) for (const xs of [-1, 1]) bay([xs * hx, -hz + (2 * hz * j) / (nz - 1)], [xs * hx, -hz + (2 * hz * (j + 1)) / (nz - 1)]);
    // cella with a west door
    const cw = 24, cd = 14, ch = 14.5, t = 1.4;
    fbox(A.stone, F, 0, FL + ch / 2, cd / 2, cw, ch, t, 0.9);
    fbox(A.stone, F, 0, FL + ch / 2, -cd / 2, cw, ch, t, 0.9);
    fbox(A.stone, F, cw / 2, FL + ch / 2, 0, t, ch, cd, 0.9);
    fbox(A.stone, F, -cw / 2, FL + ch / 2, -4.6, t, ch, 4.8, 0.9);
    fbox(A.stone, F, -cw / 2, FL + ch / 2, 4.6, t, ch, 4.8, 0.9);
    fbox(A.stone, F, -cw / 2, FL + 8.5 + (ch - 8.5) / 2, 0, t, ch - 8.5, 4.4, 0.9);
    fbox(A.glyph, F, -cw / 2 - 0.75, FL + 9.4, 0, 0.3, 1.2, 5.6, 1);
    fbox(A.stone, F, 0, FL + 0.2, 0, cw - 1, 0.4, cd - 1, 0.6); // dark floor
    fbox(A.glow, F, cw / 2 - 1.2, FL + 3.2, 0, 0.3, 3.4, 2.2, 0.9); // altar light seen through the door
    // roof: the south half still stands, the north half lies in pieces on the podium
    fbox(A.stone, F, 0, FL + ch + 0.7, 5.2, 27, 1.4, 17, 0.88);
    fbox(A.stone, F, 2, FL + ch + 2.2, 3.5, 20, 1.6, 11, 0.9);
    fput(A.stone, F, frustum4(0.2), 2, FL + ch + 3.0, 3.0, 16, 7.5, 8, 0, 0, 0, 0.92);
    fput(A.stone, F, T.box, -6, FL + 2.2, -9.5, 9, 1.4, 7, 0.25, 0.3, 0.12, 0.85);
    fput(A.stone, F, T.box, 5, FL + 1.4, -11, 7, 1.4, 5, -0.18, -0.2, 0.2, 0.85);
    for (let k = 0; k < 14; k++) {
      const lx = -16 + rng() * 32, lz = -13 + rng() * 5;
      const sz = 0.8 + rng() * 1.6;
      fput(A.stone, F, ROCKS[k % 4], lx, FL + sz * 0.3, lz, sz, sz * 0.7, sz, rng(), rng() * 3, rng(), 0.9);
    }
    lantern(A, F.px(-31, -8.5), pad.h, F.pz(-31, -8.5), 3.6);
    lantern(A, F.px(-31, 8.5), pad.h, F.pz(-31, 8.5), 3.6);
    out.lookA = [pad.ax, pad.h + 14, pad.az];
    out.templeA = { F, FL };

    // --- the tower, its crown hovering above the shaft
    const tp = sh.spec.pads[1];
    const TF = frame(tp.ax, tp.h, tp.az, sh.spec.rot + 0.2);
    fbox(A.stone, TF, 0, -1, 0, 15, 4, 15, 0.9);
    fbox(A.stone, TF, 0, 1.5, 0, 12.5, 3, 12.5, 0.92);
    const shaftH = 46;
    fput(A.stone, TF, frustum4(0.78), 0, 3, 0, 9.5, shaftH, 9.5, 0, 0, 0, 0.95);
    for (let k = 1; k <= 3; k++) {
      const y = 3 + (shaftH * k) / 4;
      const w = 9.5 * (1 - (0.22 * k) / 4) + 0.9;
      fbox(A.stone, TF, 0, y, 0, w, 0.9, w, 0.85);
      fbox(A.glyph, TF, 0, y + 1.4, 0, w - 0.7, 1.4, w - 0.7, 1);
    }
    // slit windows (some lit)
    for (let lv = 0; lv < 4; lv++) {
      const y = 8 + lv * 10.5;
      const hw = (9.5 * (1 - (0.22 * (y - 3)) / shaftH)) / 2 + 0.02;
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        const lit = rng() < 0.45;
        const acc = lit ? A.glow : A.iron;
        fput(acc, TF, T.box, Math.sin(a) * hw, y, Math.cos(a) * hw, 0.7, 3.4, 0.2, 0, a, 0, lit ? 0.8 : 0.25);
      }
    }
    const topY = 3 + shaftH;
    const tw = 9.5 * 0.78;
    fbox(A.stone, TF, 0, topY + 0.5, 0, tw + 2.4, 1.0, tw + 2.4, 0.9);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fbox(A.stone, TF, sx * (tw / 2), topY + 4.5, sz * (tw / 2), 1.3, 7, 1.3, 0.92);
    fbox(A.stone, TF, 0, topY + 8.4, 0, tw + 1.6, 0.9, tw + 1.6, 0.9);
    A.glow.put(T.ico1, TF.px(0, 0), TF.y + topY + 4.2, TF.pz(0, 0), 1.7, 1.7, 1.7, 0, 0, 0, 1.2);
    HALOS.push({ slot: sh.spec.slot, x: TF.x, y: TF.y + topY + 4.2, z: TF.z, size: 13 });
    // hovering crown (own slot, bobbing relative to the shaft)
    slotAll(A, 11);
    fput(A.stone, TF, frustum4(0.62), 0, topY + 12.5, 0, tw + 1.2, 2.2, tw + 1.2, 0, 0, 0, 0.9);
    fput(A.stone, TF, frustum4(0.04), 0, topY + 14.7, 0, tw * 0.74, 13, tw * 0.74, 0, 0, 0, 0.95);
    fbox(A.glyph, TF, 0, topY + 13.6, 0, tw + 0.2, 0.9, tw + 0.2, 1);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      const r = 7 + rng() * 3;
      fput(A.stone, TF, T.box, Math.cos(a) * r, topY + 10 + rng() * 6, Math.sin(a) * r, 1.2, 0.8, 1.6, rng(), rng() * 3, rng(), 0.9);
    }
    out.crown = [TF.x, TF.y + topY + 11, TF.z];
    slotAll(A, sh.spec.slot);
    out.lookTower = [TF.x, TF.y + topY, TF.z];

    // --- spring pool, channel to the south rim -> waterfall
    const pp = sh.spec.pads[2];
    const PF = frame(pp.ax, pp.h, pp.az, sh.spec.rot);
    const pw = 19, pd = 11;
    fbox(A.stone, PF, 0, -0.6, 0, pw + 2, 1.2, pd + 2, 0.85);
    A.water.put(T.box, PF.px(0, 0), pp.h - 0.3, PF.pz(0, 0), pw, 0.2, pd, 0, PF.yaw, 0, 1);
    for (const s of [-1, 1]) {
      fbox(A.stone, PF, 0, 0.1, s * (pd / 2 + 0.6), pw + 2.4, 0.9, 1.2, 0.9);
      fbox(A.stone, PF, s * (pw / 2 + 0.6), 0.1, 0, 1.2, 0.9, pd, 0.9);
    }
    // channel to the rim
    const thF = sh.angleTo(PF.px(0, pd / 2), PF.pz(0, pd / 2)) + 0.06;
    const rp = sh.rimPoint(thF, 0.5);
    const cx0 = PF.px(0, pd / 2 + 0.8), cz0 = PF.pz(0, pd / 2 + 0.8);
    const cl = Math.hypot(rp[0] - cx0, rp[2] - cz0);
    const cyaw = Math.atan2(rp[0] - cx0, rp[2] - cz0);
    const ns = Math.max(2, Math.ceil(cl / 2));
    for (let i = 0; i < ns; i++) {
      const t = (i + 0.5) / ns;
      const x = cx0 + (rp[0] - cx0) * t, z = cz0 + (rp[2] - cz0) * t;
      const y = Math.min(pp.h - 0.3, sh.topAt(x, z) + 0.05);
      A.water.put(T.box, x, y - 0.05, z, 2.0, 0.2, cl / ns + 0.3, 0, cyaw, 0, 1);
      A.stone.put(T.box, x + Math.cos(cyaw) * 1.5, y - 0.1, z - Math.sin(cyaw) * 1.5, 0.9, 0.8, cl / ns + 0.2, 0, cyaw, 0, 0.85);
      A.stone.put(T.box, x - Math.cos(cyaw) * 1.5, y - 0.1, z + Math.sin(cyaw) * 1.5, 0.9, 0.8, cl / ns + 0.2, 0, cyaw, 0, 0.85);
    }
    out.falls.push({ slot: sh.spec.slot, x: rp[0] + Math.sin(cyaw) * 0.8, y: Math.min(pp.h - 0.4, sh.topAt(rp[0], rp[2])) - 0.1, z: rp[2] + Math.cos(cyaw) * 0.8, a: cyaw, w: 3.4, drop: 205, v0: 2.6 });
    out.pool = [PF.x, PF.y, PF.z];

    // a spring bursting from the east cliff
    const thE = sh.spec.rot + 0.15;
    const cp = bodies.A.cliff(thE, 0.5);
    out.falls.push({ slot: sh.spec.slot, x: cp.x + cp.c * 0.8, y: cp.y, z: cp.z + cp.s * 0.8, a: Math.atan2(cp.c, cp.s), w: 2.4, drop: 170, v0: 3.4 });
    A.rock.put(T.box, cp.x, cp.y - 0.3, cp.z, 3.8, 3.4, 3.0, 0, Math.atan2(cp.c, cp.s), 0, 0.35);

    // --- a stair down the west cliff, continuing upside down under the shoulder to a shrine
    //     that hangs inverted from the rock (its builders did not agree which way was up)
    {
      const bA = bodies.A;
      const thA = Math.PI * 0.98, thB = Math.PI * 1.1;
      const n = 74;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const th = thA + (thB - thA) * f;
        const p0 = bA.cliff(th, 0), p1 = bA.cliff(th, 1);
        const c = Math.cos(th), sn = Math.sin(th);
        const x = p0.x + (p1.x - p0.x) * f + c * 2.4, z = p0.z + (p1.z - p0.z) * f + sn * 2.4;
        const y = p0.y + 0.3 + (p1.y - p0.y) * f;
        A.stone.put(T.box, x, y, z, 3.0, 0.34, 0.95, 0, -th, 0, 0.9);
        A.stone.put(T.box, x - c * 1.2, y - 1.0, z - sn * 1.2, 3.6, 1.7, 0.95, 0, -th, 0, 0.8);
        if (i % 2 === 0) A.stone.put(T.box, x + c * 1.45, y + 0.55, z + sn * 1.45, 0.3, 0.8, 1.9, 0, -th, 0, 0.85);
        if (i === 30) lantern(A, x + c * 1.2, y + 0.2, z + sn * 1.2, 2.2);
      }
      const thC = thB + 0.07;
      // a balcony slab cantilevered from the cliff foot; the shrine hangs beneath it in open air
      const p1 = bA.cliff(thC, 1);
      const F = frame(p1.x + p1.c * 6, p1.y - 1.5, p1.z + p1.s * 6, -thC);
      fbox(A.stone, F, 0, 0, 0, 22, 4, 16, 0.85);
      for (const lz of [-7, 7]) fbox(A.stone, F, 9.5, 2.6, lz, 3, 1.2, 1.2, 0.9);
      fbox(A.stone, F, 4, -2.6, 0, 17, 1.2, 12, 0.9);
      fbox(A.stone, F, 4, -3.7, 0, 15, 1.0, 10, 0.92);
      const FL = -4.2, H = 8.5;
      for (const [lx, lz] of [[-2, -3.6], [2, -3.6], [6, -3.6], [10, -3.6], [-2, 3.6], [2, 3.6], [6, 3.6], [10, 3.6]]) {
        fbox(A.stone, F, lx, FL - 0.3, lz, 1.6, 0.6, 1.6, 0.9);
        fput(A.stone, F, T.col12, lx, FL - 0.6, lz, 0.55, H - 1.2, 0.55, Math.PI, 0, 0, 0.93);
        fput(A.stone, F, frustum4(1.5), lx, FL - H + 0.6, lz, 1.0, 0.5, 1.0, Math.PI, 0, 0, 0.9);
      }
      fbox(A.stone, F, 4, FL - H / 2, 0, 7, H - 1, 5, 0.88);
      fbox(A.iron, F, 7.52, FL - H / 2 - 1.2, 0, 0.1, 4.2, 2.2, 0.3);
      fbox(A.stone, F, 4, FL - H - 0.4, 0, 15.5, 1.0, 9.5, 0.9);
      fbox(A.glyph, F, 4, FL - H - 1.35, 0, 14.6, 0.9, 8.8, 1);
      fput(A.stone, F, frustum4(0.05), 4, FL - H - 1.8, 0, 14.5, 7.5, 8.5, Math.PI, 0, 0, 0.92);
      const lx = F.px(4, 0), lz = F.pz(4, 0);
      A.iron.put(T.box, lx, F.y + FL - H - 10.6, lz, 0.12, 1.6, 0.12, 0, 0, 0, 0.7);
      A.glow.put(T.box, lx, F.y + FL - H - 11.8, lz, 0.6, 0.9, 0.6, 0, 0.3, 0, 1);
      HALOS.push({ slot: sh.spec.slot, x: lx, y: F.y + FL - H - 11.8, z: lz, size: 7 });
      out.inverted = [F.x, F.y + FL - H / 2, F.z];
    }
  }

  // ---------------------------------------------------------------- B: broken tholos
  {
    const sh = S.B;
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const F = frame(pad.ax, pad.h, pad.az, 0.4);
    const steps = [[12.5, 0.9], [11.3, 1.8], [10.1, 2.7]];
    for (const [r, top] of steps) fput(A.stone, F, T.cyl12, 0, -3, 0, r, top + 3, r, 0, 0, 0, 0.92);
    const FL = 2.7, H = 9.5, rc = 7.8, NC = 12;
    const standing = [];
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * TAU;
      const down = i === 3 || i === 4;
      if (down) {
        column(A.stone, F, Math.cos(a) * rc, Math.sin(a) * rc, FL, H, 0.6, tintJ(), 0.25);
        fallenColumn(A.stone, (x, z) => sh.topAt(x, z), F.px(Math.cos(a) * 12, Math.sin(a) * 12), F.pz(Math.cos(a) * 12, Math.sin(a) * 12), F.yaw - a + Math.PI / 2, 0.6, 3, 0.9, rng);
      } else {
        column(A.stone, F, Math.cos(a) * rc, Math.sin(a) * rc, FL, H, 0.6, tintJ(), 1);
        standing.push(i);
      }
    }
    const ty = FL + H + 0.1;
    for (let i = 0; i < NC; i++) {
      if (i === 2 || i === 3 || i === 4) continue;
      const a = ((i + 0.5) / NC) * TAU;
      const len = 2 * rc * Math.sin(Math.PI / NC) + 1.4;
      fbox(A.stone, F, Math.cos(a) * rc, ty + 0.7, Math.sin(a) * rc, 1.8, 1.4, len, 0.93, -a);
      fbox(A.glyph, F, Math.cos(a) * (rc + 0.25), ty + 1.9, Math.sin(a) * (rc + 0.25), 1.2, 1.0, len - 0.2, 1, -a);
    }
    // dome with a collapsed wedge
    const dg = new THREE.SphereGeometry(8.9, 24, 8, 1.2, TAU * 0.74, 0, Math.PI / 2);
    _m.makeRotationY(F.yaw).setPosition(F.x, F.y + ty + 2.4, F.z);
    A.stone.geo(dg, _m, 0.9);
    const dgi = new THREE.SphereGeometry(8.3, 24, 8, 1.2, TAU * 0.74, 0, Math.PI / 2);
    dgi.index.array.reverse();
    dgi.computeVertexNormals();
    A.stone.geo(dgi, _m, 0.55);
    fput(A.stone, F, T.cyl8, 0, ty + 10.9, 0, 1.6, 1.4, 1.6, 0, 0, 0, 0.9);
    for (let k = 0; k < 7; k++) {
      const a = 2.1 + rng() * 1.1;
      const r = 10 + rng() * 9;
      const x = F.px(Math.cos(a) * r, Math.sin(a) * r), z = F.pz(Math.cos(a) * r, Math.sin(a) * r);
      const s = 1 + rng() * 1.8;
      A.stone.put(ROCKS[k % 4], x, sh.topAt(x, z) + s * 0.2, z, s * 1.4, s * 0.6, s, rng(), rng() * 3, rng(), 0.85);
    }
    // brazier
    A.iron.put(T.cyl8, F.x, F.y + FL, F.z, 1.3, 1.1, 1.3, 0, 0, 0, 0.7);
    A.glow.put(T.ico0, F.x, F.y + FL + 1.3, F.z, 0.9, 0.7, 0.9, 0, 0, 0, 1.1);
    HALOS.push({ slot: sh.spec.slot, x: F.x, y: F.y + FL + 1.6, z: F.z, size: 9 });
    out.lookB = [F.x, F.y + 8, F.z];
  }

  // ---------------------------------------------------------------- C: tether plaza
  {
    const sh = S.C;
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const F = frame(pad.ax, pad.h, pad.az, sh.spec.rot);
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        if (rng() < 0.12) continue;
        fbox(A.stone, F, i * 3.3 + (rng() - 0.5) * 0.2, -0.2 + rng() * 0.12, j * 3.3 + (rng() - 0.5) * 0.2, 3.1, 0.7, 3.1, 0.8 + rng() * 0.3, (rng() - 0.5) * 0.05);
      }
    }
    // gate facing B
    const gB = Math.atan2(S.B.cx - pad.ax, S.B.cz - pad.az) - F.yaw;
    const gx = Math.sin(gB) * 13, gz = Math.cos(gB) * 13;
    const GF = frame(F.px(gx, gz), pad.h, F.pz(gx, gz), F.yaw + gB);
    for (const s of [-1, 1]) fbox(A.stone, GF, s * 3.4, 4.5, 0, 1.7, 9, 1.7, 0.9);
    fbox(A.stone, GF, 0, 9.6, 0, 9.4, 1.4, 2.2, 0.92);
    fbox(A.glyph, GF, 0, 8.4, 0, 5.2, 1.0, 1.6, 1);
    lantern(A, GF.px(4.8, 1.8), pad.h, GF.pz(4.8, 1.8), 2.8);

    // bollards and the tether chains
    const bolls = [0.6, 2.2, 3.7, 5.2];
    bolls.forEach((a0, k) => {
      const a = a0 + sh.spec.rot;
      const rb = sh.R(a) * 0.72;
      const bx = sh.cx + Math.cos(a) * rb, bz = sh.cz + Math.sin(a) * rb;
      const by = sh.topAt(bx, bz);
      slotAll(A, sh.spec.slot);
      A.stone.put(frustum4(0.75), bx, by - 1, bz, 3.4, 5.6, 3.4, 0, a, 0, 0.85);
      A.iron.put(T.box, bx, by + 3.2, bz, 3.1, 0.5, 3.1, 0, a, 0, 0.7);
      A.iron.put(T.box, bx, by + 1.0, bz, 3.3, 0.4, 3.3, 0, a, 0, 0.7);
      const rim = sh.rimPoint(a, -0.8);
      const top = [bx, by + 4.2, bz];
      const lip = [rim[0], rim[1] + 0.9, rim[2]];
      const reach = 55 + k * 9;
      const gx2 = sh.cx + Math.cos(a) * (sh.R(a) + reach), gz2 = sh.cz + Math.sin(a) * (sh.R(a) + reach);
      const gy = groundAt(gx2, gz2);
      const broken = k === 2;
      chain(A.iron, [top, lip], 1.8, 0.85);
      if (!broken) {
        const yTop = lip[1], yBot = gy + 5;
        for (const kk in A) A[kk].setSlotFn((x, y, z, o) => {
          o[0] = sh.spec.slot;
          o[1] = 0;
          o[2] = clamp((yTop - y) / (yTop - yBot), 0, 1);
        });
        const pts = sagPoints(lip, [gx2, gy + 5, gz2], 3, 24);
        chain(A.iron, pts, 3.2, 0.8);
        slotAll(A, 0);
      } else {
        // snapped: the upper half hangs from the lip, the lower half lies around its anchor
        const hang = [];
        for (let i = 0; i <= 10; i++) hang.push([lip[0] + Math.cos(a) * (1 + i * 0.35), lip[1] - i * 5.5, lip[2] + Math.sin(a) * (1 + i * 0.35)]);
        slotAll(A, sh.spec.slot);
        chain(A.iron, hang, 3.2, 0.8, true);
        slotAll(A, 0);
        const coil = [];
        for (let i = 0; i <= 12; i++) {
          const x = gx2 + Math.cos(a + 0.6) * i * 2.4 + Math.sin(i * 0.7) * 2, z = gz2 + Math.sin(a + 0.6) * i * 2.4 + Math.cos(i * 0.6) * 2;
          coil.push([x, groundAt(x, z) + 0.8, z]);
        }
        chain(A.iron, coil, 3.2, 0.75, true);
      }
      // ground anchor block with an iron ring
      slotAll(A, 0);
      A.stone.put(frustum4(0.7), gx2, gy - 2, gz2, 9, 8.5, 9, 0, a, 0, 0.8);
      A.glyph.put(T.box, gx2, gy + 5.5, gz2, 6.4, 1.2, 6.4, 0, a, 0, 1);
      A.iron.put(T.link, gx2, gy + 7.4, gz2, 3.2, 3.2, 3.2, 0, a, 0, 0.8);
      out.anchors.push([gx2, gy, gz2]);
    });
    slotAll(A, sh.spec.slot);
    out.lookC = [pad.ax, pad.h + 4, pad.az];
  }

  // ---------------------------------------------------------------- D: glyph shrine
  {
    const sh = S.D;
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const F = frame(pad.ax, pad.h, pad.az, sh.spec.rot);
    fbox(A.stone, F, 0, -1, 0, 16, 3, 16, 0.9);
    fbox(A.stone, F, 0, 1.0, 0, 11, 1.0, 11, 0.92);
    fput(A.glyph, F, frustum4(0.62), 0, 1.5, 0, 3.8, 21, 2.6, 0, 0, 0, 1);
    fput(A.stone, F, frustum4(0.05), 0, 22.5, 0, 2.5, 3.2, 1.7, 0, 0, 0, 0.9);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + 0.2;
      const r = 13 + rng() * 2;
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      const x = F.px(lx, lz), z = F.pz(lx, lz);
      const h = 3 + rng() * 3.5;
      A.stone.put(T.boxBase, x, sh.topAt(x, z) - 0.8, z, 1.4, h, 0.9, (rng() - 0.5) * 0.25, F.yaw - a, (rng() - 0.5) * 0.2, 0.8 + rng() * 0.2);
    }
    lantern(A, F.px(-6.5, -6.5), pad.h + 1.5, F.pz(-6.5, -6.5), 2.4);
    lantern(A, F.px(6.5, 6.5), pad.h + 1.5, F.pz(6.5, 6.5), 2.4);
    // basin + fall off the west rim
    const thW = Math.PI + 0.25;
    const rp = sh.rimPoint(thW, 0.5);
    const bx = sh.cx + Math.cos(thW) * sh.R(thW) * 0.62, bz = sh.cz + Math.sin(thW) * sh.R(thW) * 0.62;
    const by = sh.topAt(bx, bz);
    A.water.put(T.cyl12, bx, by - 0.2, bz, 4.2, 0.2, 4.2, 0, 0, 0, 1);
    A.stone.put(T.cyl12, bx, by - 1.1, bz, 5.0, 1.0, 5.0, 0, 0, 0, 0.85);
    const cyaw = Math.atan2(rp[0] - bx, rp[2] - bz);
    const cl = Math.hypot(rp[0] - bx, rp[2] - bz);
    A.water.put(T.box, (bx + rp[0]) / 2, (by + rp[1]) / 2 - 0.25, (bz + rp[2]) / 2, 1.4, 0.2, cl, Math.atan2(by - rp[1], cl), cyaw, 0, 1);
    out.falls.push({ slot: sh.spec.slot, x: rp[0] + Math.sin(cyaw) * 0.6, y: rp[1] - 0.3, z: rp[2] + Math.cos(cyaw) * 0.6, a: cyaw, w: 2.2, drop: 160, v0: 2.2 });
    out.lookD = [F.x, F.y + 10, F.z];
  }

  // ---------------------------------------------------------------- E: the lonely arch
  {
    const sh = S.E;
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const F = frame(pad.ax, pad.h, pad.az, 0.55); // arch plane faces roughly toward the lake
    fbox(A.stone, F, 0, -0.8, 0, 17, 2.2, 5, 0.9);
    stairs(A.stone, F.px(0, -9), pad.h - 1.2, F.pz(0, -9), F.px(0, -2.5), pad.h + 0.3, F.pz(0, -2.5), 5, (x, z) => sh.topAt(x, z), 0.9);
    const span = 10, pier = 2.6, ph = 13;
    for (const s of [-1, 1]) {
      fbox(A.stone, F, s * (span / 2 + pier / 2), 0.3 + ph / 2, 0, pier, ph, 3.0, 0.93);
      fbox(A.stone, F, s * (span / 2 + pier / 2), 0.3 + ph + 0.35, 0, pier + 0.6, 0.7, 3.5, 0.9);
    }
    const ag = archRing({ span, rise: 7.5, thick: 2.2, depth: 3.0, segments: 22, pointed: 0.55 });
    _m.makeRotationY(F.yaw).setPosition(F.x, F.y + 0.3 + ph + 0.7, F.z);
    A.stone.geo(ag, _m, 0.95);
    const ag2 = archRing({ span: span - 1.2, rise: 6.8, thick: 0.6, depth: 1.2, segments: 22, pointed: 0.55 });
    A.glyph.geo(ag2, _m, 1);
    out.lookE = [F.x, F.y + 11, F.z];
    out.archE = { x: F.x, y: F.y, z: F.z, yaw: F.yaw };
  }

  // ---------------------------------------------------------------- F: colonnade to the edge
  {
    const sh = S.F;
    slotAll(A, sh.spec.slot);
    const g = (x, z) => sh.topAt(x, z);
    const dirA = sh.angleTo(sh.cx - 100, sh.cz - 60); // toward the north-west rim
    const ux = Math.cos(dirA), uz = Math.sin(dirA);
    const sx = -uz, sz = ux;
    const Rr = sh.R(dirA);
    const n = 7;
    const walkY = [];
    for (let i = 0; i < n; i++) {
      const d = 6 + (i * (Rr - 9)) / (n - 1);
      for (const s of [-1, 1]) {
        const x = sh.cx + ux * d + sx * s * 4.4, z = sh.cz + uz * d + sz * s * 4.4;
        const y = g(x, z);
        const F = frame(x, y, z, 0);
        const r = rng();
        if (r < 0.2 && i > 1) fallenColumn(A.stone, g, x + sx * s * 2, z + sz * s * 2, Math.atan2(sx * s, sz * s) + (rng() - 0.5), 0.7, 3, 0.9, rng);
        else column(A.stone, F, 0, 0, -0.4, 10, 0.7, tintJ(), r < 0.35 ? 0.3 + rng() * 0.4 : 1);
      }
      walkY.push(g(sh.cx + ux * d, sh.cz + uz * d));
    }
    // lintels along rows (where both neighbours still stand is not tracked: sparse, deliberate)
    for (const i of [0, 3]) {
      for (const s of [-1, 1]) {
        const d = 6 + ((i + 0.5) * (Rr - 9)) / (n - 1);
        const x = sh.cx + ux * d + sx * s * 4.4, z = sh.cz + uz * d + sz * s * 4.4;
        A.stone.put(T.box, x, g(x, z) + 10.3, z, 1.5, 1.3, (Rr - 9) / (n - 1) + 2, 0, Math.atan2(ux, uz), 0, 0.92);
      }
    }
    // paved walk to the edge
    const pts = [];
    for (let d = 2; d < Rr - 1; d += 4) pts.push([sh.cx + ux * d, sh.cz + uz * d]);
    pathSteps(A.stone, pts, 5.5, g, rng);
    // stele on the knoll + zigzag stair up to it
    const kx = sh.cx - ux * 22 + sx * 8, kz = sh.cz - uz * 22 + sz * 8;
    const ky = g(kx, kz);
    A.stone.put(T.boxBase, kx, ky - 1, kz, 5, 2, 5, 0, dirA, 0, 0.9);
    A.glyph.put(frustum4(0.8), kx, ky + 0.9, kz, 2.2, 7.5, 0.9, 0, Math.atan2(ux, uz), 0, 1);
    const zig = [[sh.cx + ux * 3, sh.cz + uz * 3], [sh.cx - ux * 6 + sx * 10, sh.cz - uz * 6 + sz * 10], [sh.cx - ux * 13 - sx * 2, sh.cz - uz * 13 - sz * 2], [kx + ux * 3, kz + uz * 3]];
    pathSteps(A.stone, zig, 2.6, g, rng);
    sh.reserve.push({ x: sh.cx + ux * Rr * 0.5, z: sh.cz + uz * Rr * 0.5, r: Rr * 0.5 + 6 });
    sh.reserve.push({ x: kx, z: kz, r: 6 });
    for (const [x, z] of zig) sh.reserve.push({ x, z, r: 4 });
    out.lookF = [sh.cx + ux * Rr * 0.5, walkY[3] + 5, sh.cz + uz * Rr * 0.5];
    out.edgeF = [sh.cx + ux * (Rr - 3), walkY[n - 1], sh.cz + uz * (Rr - 3), dirA];
  }

  // ---------------------------------------------------------------- G, H: cells
  for (const id of ['G', 'H']) {
    const sh = S[id];
    slotAll(A, sh.spec.slot);
    const pad = sh.spec.pads[0];
    const F = frame(pad.ax, pad.h, pad.az, sh.spec.rot + 0.6);
    const w = id === 'H' ? 7 : 6, d = id === 'H' ? 6 : 5, h = id === 'H' ? 5.5 : 4.5;
    fbox(A.stone, F, 0, -0.5, 0, w + 2, 1.4, d + 2, 0.85);
    fbox(A.stone, F, 0, h / 2, d / 2 - 0.4, w, h, 0.8, 0.9);
    fbox(A.stone, F, 0, h / 2, -d / 2 + 0.4, w, h, 0.8, 0.9);
    fbox(A.stone, F, w / 2 - 0.4, h / 2, 0, 0.8, h, d, 0.9);
    fbox(A.stone, F, -w / 2 + 0.4, h / 2, -d / 4 - 0.7, 0.8, h, d / 2 - 0.6, 0.9);
    fbox(A.stone, F, -w / 2 + 0.4, h / 2, d / 4 + 0.7, 0.8, h, d / 2 - 0.6, 0.9);
    fbox(A.stone, F, -w / 2 + 0.4, h - 0.7, 0, 0.8, 1.4, 2, 0.9);
    fbox(A.stone, F, 0, h + 0.4, 0, w + 1.2, 0.8, d + 1.2, 0.88);
    fput(A.stone, F, frustum4(0.3), 0, h + 0.8, 0, w, 1.6, d, 0, 0, 0, 0.9);
    fbox(A.stone, F, 0, 0.1, 0, w - 1.6, 0.2, d - 1.6, 0.5);
    if (id === 'H') {
      fbox(A.glow, F, w / 2 - 0.9, 2.2, 0, 0.2, 2.2, 1.4, 0.9);
      fbox(A.glow, F, 0, 3.1, d / 2 - 0.05, 1.0, 1.3, 0.1, 0.7);
      lantern(A, F.px(-w / 2 - 2.2, 1.5), pad.h, F.pz(-w / 2 - 2.2, 1.5), 2.6);
      out.lookH = [F.x, F.y + 3, F.z];
    } else out.lookG = [F.x, F.y + 3, F.z];
    // falls from G's south rim
    if (id === 'G') {
      const th = Math.PI * 0.5 + 0.3;
      const rp = sh.rimPoint(th, 0.3);
      out.falls.push({ slot: sh.spec.slot, x: rp[0] + Math.cos(th) * 0.6, y: rp[1] - 0.4, z: rp[2] + Math.sin(th) * 0.6, a: Math.atan2(Math.cos(th), Math.sin(th)), w: 2.0, drop: 140, v0: 1.8 });
    }
  }

  // B: small spring fall off the north rim
  {
    const sh = S.B;
    const th = -Math.PI * 0.5 - 0.2;
    const rp = sh.rimPoint(th, 0.3);
    out.falls.push({ slot: sh.spec.slot, x: rp[0] + Math.cos(th) * 0.6, y: rp[1] - 0.5, z: rp[2] + Math.sin(th) * 0.6, a: Math.atan2(Math.cos(th), Math.sin(th)), w: 2.4, drop: 150, v0: 1.6 });
  }

  // ---------------------------------------------------------------- bridges
  const bridgeEnds = (a, b, inset = 3) => {
    const tha = a.angleTo(b.cx, b.cz), thb = b.angleTo(a.cx, a.cz);
    const pa = a.rimPoint(tha, inset), pb = b.rimPoint(thb, inset);
    pa[1] += 0.2;
    pb[1] += 0.2;
    return [pa, pb];
  };
  {
    const [p0, p1] = bridgeEnds(S.A, S.B, 3.5);
    ropeBridge(A, rng, p0, p1, S.A.spec.slot, S.B.spec.slot, { sag: 9, lanternAt: 0.5 });
    out.bridgeAB = [p0, p1];
    // paved way from the temple stair to the bridge head
    slotAll(A, S.A.spec.slot);
    const F = out.templeA.F;
    const sx = F.px(-31, 0), sz = F.pz(-31, 0);
    const pts = [[sx, sz], [(sx + p0[0]) / 2, (sz + p0[2]) / 2], [p0[0], p0[2]]];
    pathSteps(A.stone, pts, 4, (x, z) => S.A.topAt(x, z), rng);
    S.A.reserve.push({ x: (sx + p0[0]) / 2, z: (sz + p0[2]) / 2, r: Math.hypot(sx - p0[0], sz - p0[2]) / 2 + 2 });
    lantern(A, p0[0] + 3, S.A.topAt(p0[0] + 3, p0[2] + 3), p0[2] + 3, 3.2);
  }
  {
    const [p0, p1] = bridgeEnds(S.B, S.C, 3);
    ropeBridge(A, rng, p0, p1, S.B.spec.slot, S.C.spec.slot, { sag: 11 });
    out.bridgeBC = [p0, p1];
    // worn paths: bridge head -> tholos -> bridge head on B, bridge head -> gate on C
    slotAll(A, S.B.spec.slot);
    const tb = S.B.spec.pads[0];
    const q0 = out.bridgeAB[1];
    const gB = (x, z) => S.B.topAt(x, z);
    const pathB = [[q0[0], q0[2]], [tb.ax + (q0[0] - tb.ax) * 0.3, tb.az + (q0[2] - tb.az) * 0.3]];
    const pathB2 = [[tb.ax + (p0[0] - tb.ax) * 0.3, tb.az + (p0[2] - tb.az) * 0.3], [p0[0], p0[2]]];
    pathSteps(A.stone, pathB, 3, gB, rng);
    pathSteps(A.stone, pathB2, 3, gB, rng);
    for (const pth of [pathB, pathB2]) {
      const [[x0, z0], [x1, z1]] = pth;
      for (let t = 0; t <= 1; t += 0.2) S.B.reserve.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, r: 7 });
    }
    slotAll(A, S.C.spec.slot);
    const tc = S.C.spec.pads[0];
    const pathC = [[p1[0], p1[2]], [tc.ax + (p1[0] - tc.ax) * 0.45, tc.az + (p1[2] - tc.az) * 0.45]];
    pathSteps(A.stone, pathC, 3, (x, z) => S.C.topAt(x, z), rng);
    for (let t = 0; t <= 1; t += 0.25) S.C.reserve.push({ x: p1[0] + (tc.ax - p1[0]) * t, z: p1[2] + (tc.az - p1[2]) * t, r: 4 });
  }
  // broken stone bridge A <-> F, fragments hovering in the gap
  {
    const a = S.A, b = S.F;
    const tha = a.angleTo(b.cx, b.cz), thb = b.angleTo(a.cx, a.cz);
    const pa = a.rimPoint(tha, 4), pb = b.rimPoint(thb, 4);
    const dx = pb[0] - pa[0], dz = pb[2] - pa[2];
    const Lh = Math.hypot(dx, dz);
    const ux = dx / Lh, uz = dz / Lh;
    const yaw = Math.atan2(ux, uz);
    const deckY = (t) => pa[1] + (pb[1] - pa[1]) * t + 0.4;
    const half = (from, to, slot, ext, sign) => {
      slotAll(A, slot);
      const seg = 3.2;
      const n = Math.ceil((Lh * ext) / seg);
      for (let i = 0; i < n; i++) {
        const t = from + ((to - from) * (i + 0.5)) / n;
        const x = pa[0] + dx * t, z = pa[2] + dz * t, y = deckY(t);
        const last = i === n - 1;
        const jag = last ? 0.5 + rng() * 0.4 : 1;
        A.stone.put(T.box, x, y - 0.7, z, 5.6, 1.4, seg * jag, last ? (rng() - 0.5) * 0.12 : 0, yaw, 0, 0.9);
        for (const s of [-1, 1]) {
          if (last && s === sign) continue;
          A.stone.put(T.box, x + Math.cos(yaw) * s * 2.55, y + 0.55, z - Math.sin(yaw) * s * 2.55, 0.5, 1.1, seg * jag, 0, yaw, 0, 0.88);
        }
        // haunch under the deck, deepest at the cliff
        const k = i / n;
        const depth = 12 * Math.pow(1 - k, 1.6) + 1.2;
        A.stone.put(T.box, x, y - 1.4 - depth / 2, z, 3.8, depth, seg * 1.01, 0, yaw, 0, 0.84);
      }
    };
    half(0, 0.34, a.spec.slot, 0.34, 1);
    // B side: its own deck from F
    slotAll(A, b.spec.slot);
    {
      const seg = 3.2;
      const n = Math.ceil((Lh * 0.26) / seg);
      for (let i = 0; i < n; i++) {
        const t = 1 - (0.26 * (i + 0.5)) / n;
        const x = pa[0] + dx * t, z = pa[2] + dz * t, y = deckY(t) - 1.2;
        const last = i === n - 1;
        const jag = last ? 0.6 : 1;
        A.stone.put(T.box, x, y - 0.7, z, 5.6, 1.4, seg * jag, last ? 0.08 : 0, yaw, 0, 0.9);
        for (const s of [-1, 1]) A.stone.put(T.box, x + Math.cos(yaw) * s * 2.55, y + 0.55, z - Math.sin(yaw) * s * 2.55, 0.5, 1.1, seg * jag, 0, yaw, 0, 0.88);
        const k = i / n;
        const depth = 10 * Math.pow(1 - k, 1.6) + 1.2;
        A.stone.put(T.box, x, y - 1.4 - depth / 2, z, 3.8, depth, seg * 1.01, 0, yaw, 0, 0.84);
      }
    }
    // hovering fragments (blend between the two isles by position)
    slotFnAll(A, axisSlot(pa, pb, a.spec.slot, b.spec.slot));
    for (let k = 0; k < 9; k++) {
      const t = 0.38 + rng() * 0.34;
      const x = pa[0] + dx * t + (rng() - 0.5) * 6, z = pa[2] + dz * t + (rng() - 0.5) * 6;
      const y = deckY(t) - 3 - rng() * 14;
      const s = 1.2 + rng() * 2.2;
      A.stone.put(T.box, x, y, z, s * 1.6, s * 0.8, s * 1.2, rng() * 0.8, rng() * TAU, rng() * 0.8, 0.85 + rng() * 0.2);
    }
    out.bridgeAF = [pa, pb];
    slotAll(A, a.spec.slot);
  }

  // iron chain mooring D to A (sagging, blended)
  {
    const a = S.A, d = S.D;
    const tha = a.angleTo(d.cx, d.cz), thd = d.angleTo(a.cx, a.cz);
    const ua = bodies.A.under(tha, 0.08), ud = bodies.D.under(thd, 0.1);
    const p0 = [ua.x, ua.y, ua.z], p1 = [ud.x, ud.y, ud.z];
    slotFnAll(A, axisSlot(p0, p1, a.spec.slot, d.spec.slot));
    chain(A.iron, sagPoints(p0, p1, 34, 40), 2.6, 0.85);
    slotAll(A, a.spec.slot);
    A.iron.put(T.box, ua.x, ua.y + 1, ua.z, 3.2, 2.4, 3.2, 0, tha, 0, 0.7);
    slotAll(A, d.spec.slot);
    A.iron.put(T.box, ud.x, ud.y + 1, ud.z, 2.8, 2.2, 2.8, 0, thd, 0, 0.7);
  }

  // broken chains dangling into the void
  const dangle = [['A', 0.4, 0.3, 95], ['A', 2.6, 0.35, 70], ['A', 4.4, 0.22, 120], ['F', 1.5, 0.3, 60], ['B', 3.3, 0.3, 80], ['G', 1.0, 0.3, 45], ['D', 4.0, 0.25, 55]];
  for (const [id, th, t, len] of dangle) {
    const sh = S[id];
    slotAll(A, sh.spec.slot);
    const u = bodies[id].under(th + sh.spec.rot, t);
    const floor = groundAt(u.x, u.z) + 45;
    const L = Math.max(10, Math.min(len, u.y - floor));
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([u.x + u.c * i * 0.15, u.y - (L * i) / 8, u.z + u.s * i * 0.15]);
    A.iron.put(T.box, u.x, u.y + 0.6, u.z, 2.4, 1.8, 2.4, 0, th, 0, 0.7);
    chain(A.iron, pts, 2.3, 0.8, true);
  }
}
