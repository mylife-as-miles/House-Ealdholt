// Reusable architectural parts for the ruins: arch profiles, voussoir rings, arcade walls,
// fluted drums / columns, stepped plinths, ragged broken tops, rubble. Everything writes into a
// RuinBuilder (see ruins-builder.js). Local frames are THREE.Matrix4 (x across, y up, z depth).

import * as THREE from 'crownfall-world-three';

const _vc = new Float32Array(24);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** New matrix from translation / euler (YXZ) / scale. */
export function mat(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

const _local = new THREE.Matrix4();
/** parent * local (new matrix). */
export function sub(parent, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _local.compose(_p, _q, _s);
  return parent.clone().multiply(_local);
}

/**
 * Bottom y of the glyph row nearest to y for the ruins' inscribed materials (band = 3 cells,
 * glyph row = the middle cell of each band): amber cell 1.2, cyan cell 1.0.
 */
export function glyphRow(y, cell = 1.2) {
  const band = cell * 3;
  return band * Math.round((y - cell) / band) + cell;
}

/** Transform local point by matrix into out array at offset. */
export function tp(m, x, y, z, out, o) {
  const e = m.elements;
  out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
  out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
  out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
}

// ---------------------------------------------------------------------------
// Arch profiles: intrados points from the left springing (-span/2, 0) to the right (span/2, 0)
// ---------------------------------------------------------------------------

/**
 * kind: 'round' (semi-ellipse, rise defaults to span/2), 'pointed' (two-centred lancet,
 * rise > span/2), 'parabolic', 'corbel' (stepped, false arch), 'flat' (lintel: two points)
 */
export function archPoints(kind, span, rise, n = 16) {
  const r = span / 2;
  const pts = [];
  if (kind === 'pointed') {
    const h = Math.max(rise, r * 1.02);
    const c = (h * h - r * r) / (2 * r); // centre offset of each arc
    const R = r + c;
    const ta = Math.acos(-c / R); // angle of apex on the left arc (centred at +c)
    const half = Math.max(2, Math.round(n / 2));
    for (let i = 0; i <= half; i++) {
      const t = Math.PI + (ta - Math.PI) * (i / half);
      pts.push([c + R * Math.cos(t), R * Math.sin(t)]);
    }
    for (let i = half - 1; i >= 0; i--) {
      const [x, y] = pts[i];
      pts.push([-x, y]);
    }
  } else if (kind === 'parabolic') {
    for (let i = 0; i <= n; i++) {
      const x = -r + (2 * r * i) / n;
      pts.push([x, rise * (1 - (x / r) * (x / r))]);
    }
  } else if (kind === 'corbel') {
    // stepped false arch: each course projects inward
    const steps = Math.max(2, Math.round(n / 3));
    const sh = rise / steps;
    let x = -r;
    pts.push([x, 0]);
    for (let i = 0; i < steps; i++) {
      pts.push([x, sh * (i + 1)]);
      x = -r + (r * 0.92 * (i + 1)) / steps;
      if (i < steps - 1) pts.push([x, sh * (i + 1)]);
    }
    const left = pts.slice();
    const last = left[left.length - 1];
    pts.push([-last[0], last[1]]);
    for (let i = left.length - 2; i >= 0; i--) pts.push([-left[i][0], left[i][1]]);
  } else if (kind === 'flat') {
    pts.push([-r, 0], [-r, rise], [r, rise], [r, 0]);
  } else {
    const h = rise ?? r;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (1 - i / n);
      pts.push([Math.cos(a) * r, Math.sin(a) * h]);
    }
  }
  return pts;
}

/**
 * Ring of voussoirs along an intrados polyline (in the frame's XY plane, depth along z).
 * opts: thick (radial), depth, gap (joint width, m), skip(i, n) -> bool, slip (max drop, m),
 *       jit, rng, tint, from/to (0..1 range of the ring to build), key (keystone scale)
 */
export function voussoirs(b, material, m, pts, opts = {}) {
  const { thick = 1.4, depth = 3, gap = 0.08, skip = null, slip = 0, jit = 0, rng = null, tint = null, from = 0, to = 1, key = 1.0 } = opts;
  const n = pts.length - 1;
  const nrm = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n, i + 1)];
    let tx = c[0] - a[0];
    let ty = c[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    nrm.push([-ty / l, tx / l]);
  }
  const c = _vc;
  const i0 = Math.floor(from * n);
  const i1 = Math.ceil(to * n);
  const hd = depth / 2;
  for (let i = i0; i < i1; i++) {
    if (skip && skip(i, n)) continue;
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const g = Math.min(gap, len * 0.3) / len;
    const ax = p0[0] + dx * g, ay = p0[1] + dy * g;
    const bx = p1[0] - dx * g, by = p1[1] - dy * g;
    const isKey = i === Math.floor(n / 2) || (n % 2 === 0 && i === n / 2 - 1);
    const th = thick * (isKey ? key : 1);
    const n0 = nrm[i], n1 = nrm[i + 1];
    let drop = 0;
    let dz = 0;
    if (slip > 0 && rng) {
      drop = rng() < 0.25 ? rng() * slip : 0;
      dz = rng() < 0.2 ? (rng() - 0.5) * slip * 0.8 : 0;
    }
    const z0 = -hd + dz;
    const z1 = hd + dz;
    const ox0 = ax + n0[0] * th, oy0 = ay + n0[1] * th - drop;
    const ox1 = bx + n1[0] * th, oy1 = by + n1[1] * th - drop;
    tp(m, ax, ay - drop, z0, c, 0);
    tp(m, bx, by - drop, z0, c, 3);
    tp(m, bx, by - drop, z1, c, 6);
    tp(m, ax, ay - drop, z1, c, 9);
    tp(m, ox0, oy0, z0, c, 12);
    tp(m, ox1, oy1, z0, c, 15);
    tp(m, ox1, oy1, z1, c, 18);
    tp(m, ox0, oy0, z1, c, 21);
    b.hexa(material, c, tint, jit);
  }
}

// ---------------------------------------------------------------------------
// Walls with openings (ExtrudeGeometry, cached by parameters)
// ---------------------------------------------------------------------------

const shapeCache = new Map();

/**
 * Wall of width W and height H (base y=0, centred on x) with arched openings that reach the
 * bottom edge (an arcade). openings: [{ cx, span, spring, rise, kind }]. Extruded along z (depth).
 */
export function arcadeGeometry(W, H, openings, depth, n = 14, top = null) {
  const key = `a|${W.toFixed(2)}|${H.toFixed(2)}|${depth.toFixed(2)}|${n}|` + openings.map((o) => `${o.cx.toFixed(2)},${o.span.toFixed(2)},${o.spring.toFixed(2)},${(o.rise ?? 0).toFixed(2)},${o.kind}`).join(';') + (top ? '|' + top.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(';') : '');
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const pts = [[-W / 2, 0]];
  const ops = openings.slice().sort((a, b) => a.cx - b.cx);
  for (const o of ops) {
    const r = o.span / 2;
    const spring = Math.max(0.05, o.spring);
    pts.push([o.cx - r, 0]);
    const ap = archPoints(o.kind || 'round', o.span, o.rise ?? r, n);
    for (const [x, y] of ap) pts.push([o.cx + x, Math.min(H - 0.3, spring + y)]);
    pts.push([o.cx + r, 0]);
  }
  // top edge: flat, or a custom polyline from right to left (fractured tops)
  if (top) {
    pts.push([W / 2, 0]);
    for (const p of top) pts.push(p);
  } else {
    pts.push([W / 2, 0], [W / 2, H], [-W / 2, H]);
  }
  const shape = new THREE.Shape(dedupe(pts).map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  shapeCache.set(key, g);
  return g;
}

/** Wall with window holes (not touching the edges). holes: [{ cx, sill, span, height, kind, rise }] */
export function windowWallGeometry(W, H, holes, depth, n = 12) {
  const key = `w|${W.toFixed(2)}|${H.toFixed(2)}|${depth.toFixed(2)}|` + holes.map((o) => `${o.cx.toFixed(2)},${o.sill.toFixed(2)},${o.span.toFixed(2)},${o.height.toFixed(2)},${o.kind},${(o.rise ?? 0).toFixed(2)}`).join(';');
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const shape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(W / 2, H), new THREE.Vector2(-W / 2, H)]);
  for (const o of holes) {
    const r = o.span / 2;
    const rise = o.rise ?? r;
    const jamb = Math.max(0.1, o.height - rise);
    const hp = [[o.cx - r, o.sill], [o.cx + r, o.sill]];
    const ap = archPoints(o.kind || 'round', o.span, rise, n);
    for (let i = ap.length - 1; i >= 0; i--) hp.push([o.cx + ap[i][0], o.sill + jamb + ap[i][1]]);
    const path = new THREE.Path(dedupe(hp).map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  shapeCache.set(key, g);
  return g;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-3 && Math.abs(q[1] - p[1]) < 1e-3) continue;
    out.push(p);
  }
  const f = out[0];
  const l = out[out.length - 1];
  if (out.length > 2 && Math.abs(f[0] - l[0]) < 1e-3 && Math.abs(f[1] - l[1]) < 1e-3) out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

let drumProto = null;
let drumPlain = null;
/** Unit fluted drum: radius 1, y in [0, 1], 14 crisp ridges. */
export function drumGeometry(fluted = true) {
  if (fluted && drumProto) return drumProto;
  if (!fluted && drumPlain) return drumPlain;
  const pts = [];
  const N = fluted ? 28 : 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = fluted ? (i % 2 ? 0.9 : 1) : 1;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  if (fluted) drumProto = g;
  else drumPlain = g;
  return g;
}

let octProto = null;
/** Octagonal frustum, unit radius at bottom, y in [0,1] — scale top via separate geometry. */
export function discGeometry() {
  if (octProto) return octProto;
  octProto = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false).translate(0, 0.5, 0);
  octProto.deleteAttribute('uv');
  return octProto;
}

const frustCache = new Map();
/** Round frustum (lathe-free cylinder with different radii), y in [0,1], base radius 1. */
export function frustumGeometry(topRatio, sides = 16) {
  const k = `${topRatio.toFixed(3)}|${sides}`;
  if (frustCache.has(k)) return frustCache.get(k);
  const g = new THREE.CylinderGeometry(topRatio, 1, 1, sides, 1, false).translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  frustCache.set(k, g);
  return g;
}

/**
 * A standing column at (x, groundY, z) in world space (yaw ry).
 * opts: H (full design height), r, drumH, broken (0..1 fraction standing), rng, mat (shaft),
 *       capMat, fluted, lean ([rx, rz] radians), capital (bool), slip (drum offsets)
 * Returns the world height of the top of what stands.
 */
export function column(b, x, gy, z, opts) {
  const { H = 16, r = 1.1, drumH = r * 1.75, broken = 1, rng, mat: shaftMat, capMat = shaftMat, baseMat = capMat, fluted = true, lean = [0, 0], capital = true, bury = 0.6, slip = 0.05, ry = 0, hover = false } = opts;
  const root = mat(x, gy - bury, z, ry, lean[0], lean[1]);
  b.setGround(gy);
  // base: square plinth + round torus-like disc
  const pw = r * 2.9;
  b.box(baseMat, root, pw, 0.9 + bury, pw, { taper: 0.96 });
  b.geo(baseMat, discGeometry(), sub(root, 0, 0.9 + bury, 0, 0, 0, 0, r * 1.28, 0.55, r * 1.28));
  b.geo(baseMat, frustumGeometry(0.88, 20), sub(root, 0, 1.45 + bury, 0, 0, 0, 0, r * 1.14, 0.4, r * 1.14));
  let y = 1.85 + bury;
  const shaftH = H - 1.85 - (capital ? 2.6 : 0);
  const nd = Math.max(1, Math.round(shaftH / drumH));
  const dh = shaftH / nd;
  const standDrums = broken >= 1 ? nd : Math.max(0, Math.floor(nd * broken));
  const drumGeo = drumGeometry(fluted);
  for (let i = 0; i < standDrums; i++) {
    // entasis: slight swelling at a third of the height
    const t = (i + 0.5) / nd;
    const rr = r * (1 - 0.12 * t + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.5)));
    const ox = (rng() - 0.5) * slip * 2;
    const oz = (rng() - 0.5) * slip * 2;
    const last = i === standDrums - 1 && broken < 1;
    const h = last ? dh * (0.35 + 0.5 * rng()) : dh - 0.04;
    const tilt = last ? (rng() - 0.5) * 0.25 : 0;
    b.geo(shaftMat, drumGeo, sub(root, ox, y, oz, rng() * 0.4, tilt, tilt * 0.5, rr, h, rr));
    y += dh;
  }
  if (hover && broken < 1) {
    // the lost drums hang in the air where they once stood, drifting apart with height
    let gap = 0.9;
    for (let i = standDrums; i < nd; i++) {
      y += gap;
      const t = (i + 0.5) / nd;
      const rr = r * (1 - 0.12 * t + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.5)));
      b.geo(shaftMat, drumGeo, sub(root, (rng() - 0.5) * 0.5, y, (rng() - 0.5) * 0.5, rng() * 0.6, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.12, rr, dh - 0.04, rr));
      y += dh;
      gap *= 1.28;
    }
    if (capital) {
      y += gap;
      const rt = r * 0.9;
      const cm = sub(root, (rng() - 0.5) * 0.6, y, (rng() - 0.5) * 0.6, rng(), (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15);
      b.geo(capMat, discGeometry(), sub(cm, 0, 0, 0, 0, 0, 0, rt * 1.08, 0.35, rt * 1.08));
      b.geo(capMat, frustumGeometry(1.75, 16), sub(cm, 0, 0.35, 0, 0, 0, 0, rt * 1.02, 1.1, rt * 1.02));
      b.box(capMat, sub(cm, 0, 1.45, 0), r * 3.3, 0.55, r * 3.3);
      b.box(capMat, sub(cm, 0, 2.0, 0), r * 3.7, 0.6, r * 3.7, { taper: 0.97 });
      y += 2.6;
    }
    return gy - bury + y;
  }
  if (broken >= 1 && capital) {
    // capital: thin necking disc, flaring inverted cone, stepped square abacus (two slabs)
    const rt = r * 0.9;
    b.geo(capMat, discGeometry(), sub(root, 0, y, 0, 0, 0, 0, rt * 1.08, 0.35, rt * 1.08));
    b.geo(capMat, frustumGeometry(1.75, 16), sub(root, 0, y + 0.35, 0, 0, 0, 0, rt * 1.02, 1.1, rt * 1.02));
    b.box(capMat, sub(root, 0, y + 1.45, 0, Math.PI / 4 * 0), r * 3.3, 0.55, r * 3.3);
    b.box(capMat, sub(root, 0, y + 2.0, 0), r * 3.7, 0.6, r * 3.7, { taper: 0.97 });
    y += 2.6;
  }
  return gy - bury + y;
}

/**
 * A fallen column: drums lying along direction `dir` (radians) from (x, z), toppling away from a
 * stump. Drums separate progressively (they rolled apart when they hit the ground).
 */
export function fallenColumn(ctx, b, x, z, opts) {
  const { dir = 0, count = 6, r = 1.1, drumH = 2.2, rng, mat: m, fluted = true, spread = 0.5, capital = true, capMat = m } = opts;
  const dx = Math.sin(dir);
  const dz = Math.cos(dir);
  let d = 1.5;
  const drumGeo = drumGeometry(fluted);
  for (let i = 0; i < count; i++) {
    const side = (rng() - 0.5) * spread * (1 + i * 0.5);
    const px = x + dx * d + dz * side;
    const pz = z + dz * d - dx * side;
    const gy = ctx.heightAt(px, pz);
    b.setGround(gy, 3.5);
    const yaw = dir + (rng() - 0.5) * 0.35 * (1 + i * 0.2);
    // lie the drum on its side: its axis along the fall direction
    const mm = mat(px, gy + r * 0.62, pz, yaw, Math.PI / 2, 0).multiply(mat(0, -drumH / 2, 0, rng() * 6.28, 0, (rng() - 0.5) * 0.12));
    b.geo(m, drumGeo, mm.multiply(mat(0, 0, 0, 0, 0, 0, r, drumH - 0.05, r)));
    d += drumH + rng() * spread * (0.2 + i * 0.25);
  }
  if (capital) {
    const px = x + dx * (d + 1.8);
    const pz = z + dz * (d + 1.8);
    const gy = ctx.heightAt(px, pz);
    b.setGround(gy, 3);
    const mm = mat(px, gy - 0.5, pz, dir + rng(), (rng() - 0.5) * 0.5, 1.2 + rng() * 0.4);
    b.box(capMat, mm, r * 3.6, 1.1, r * 3.6, { taper: 0.9 });
  }
}

// ---------------------------------------------------------------------------
// Masonry helpers
// ---------------------------------------------------------------------------

/** Stepped plinth: `steps` slabs shrinking upward. Returns top y (local). */
export function steppedPlinth(b, material, m, w, d, stepH, steps, inset, opts = null) {
  let y = 0;
  for (let i = 0; i < steps; i++) {
    b.box(material, sub(m, 0, y, 0), w - 2 * inset * i, stepH, d - 2 * inset * i, opts);
    y += stepH;
  }
  return y;
}

/**
 * Ragged broken top along local x from -W/2..W/2 at local height y0: courses of blocks whose
 * height follows a smooth eroded profile (a slow random walk with the odd deep notch), upper
 * blocks shrinking, slipping and turning loose — a crumbling line, never a battlement.
 */
export function raggedTop(b, material, m, W, depth, y0, maxH, rng, { course = 1.4, blockW = 2.6, slope = 0, tint = null, jit = 0.06, mode = 'slope' } = {}) {
  const n = Math.max(1, Math.round(W / blockW));
  const bw = W / n;
  // 'slope': one diagonal fracture falling from one end (the classic ruin break);
  // 'walk': a slow wandering profile for low remnants
  const dir = slope !== 0 ? Math.sign(slope) : rng() < 0.5 ? -1 : 1;
  const pw = 0.6 + rng() * 0.9;
  const keep = 0.15 + rng() * 0.35;
  let h = maxH * (0.35 + 0.55 * rng());
  let v = (rng() - 0.5) * course * 0.6;
  for (let i = 0; i < n; i++) {
    if (mode === 'slope') {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const u = dir > 0 ? t : 1 - t; // 0 at the high end
      h = maxH * (keep + (1 - keep) * Math.pow(1 - u, pw)) + (rng() - 0.5) * course * 0.5;
      h = Math.max(0, Math.min(maxH, h));
    } else {
      v = v * 0.7 + (rng() - 0.5) * course * 0.7;
      h = Math.max(0, Math.min(maxH, h + v));
    }
    const hi = mode === 'walk' && rng() < 0.12 ? h * 0.35 : h;
    const courses = Math.floor(hi / course + rng() * 0.6);
    const x = -W / 2 + bw * (i + 0.5);
    for (let k = 0; k < courses; k++) {
      const top = k === courses - 1;
      const w = bw * (top ? 0.55 + 0.4 * rng() : 0.97);
      const dd = depth * (top ? 0.45 + 0.5 * rng() : k === courses - 2 ? 0.8 + 0.2 * rng() : 1);
      const ox = top ? (rng() - 0.5) * bw * 0.4 : (rng() - 0.5) * 0.06;
      const oz = (depth - dd) * (rng() - 0.5);
      const turn = top ? (rng() - 0.5) * 0.25 : (rng() - 0.5) * 0.03;
      b.box(material, sub(m, x + ox, y0 + k * course, oz, turn, top ? (rng() - 0.5) * 0.08 : 0, top ? (rng() - 0.5) * 0.08 : 0), w - 0.04, course - 0.03, dd, { jit }, tint);
    }
    // a loose stone resting askew on the break
    if (courses > 0 && rng() < 0.18) {
      const ls = course * (0.6 + 0.5 * rng());
      b.box(material, sub(m, x + (rng() - 0.5) * bw * 0.5, y0 + courses * course - 0.1, (rng() - 0.5) * depth * 0.4, rng() * 3, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6), ls * 1.3, ls * 0.8, ls, { jit: jit * 2 }, tint);
    }
  }
}

/**
 * A slab (local x from -W/2..W/2, base y=0, depth along z) whose top is a single jagged fracture
 * running from height hL at the left to hR at the right: reads as stone snapped along a line,
 * never as battlements. A couple of loose blocks sit on the break.
 */
export function fracturedSlab(b, material, m, W, depth, hL, hR, rng, { jag = 1.2, loose = true, tint = null } = {}) {
  const n = Math.max(2, Math.round(W / 2.2));
  const top = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; // right to left
    const x = W / 2 - W * t;
    let y = hR + (hL - hR) * t;
    if (i > 0 && i < n) y += (rng() - 0.5) * 2 * jag - (rng() < 0.15 ? jag * 1.5 : 0);
    top.push([x, Math.max(0.4, y)]);
  }
  const H = Math.max(hL, hR) + jag * 2;
  b.geo(material, arcadeGeometry(W, H, [], depth, 1, top), m, tint);
  if (loose) {
    const k = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < k; i++) {
      const t = 0.15 + rng() * 0.7;
      const x = W / 2 - W * t;
      const y = hR + (hL - hR) * t;
      const sz = Math.min(depth, 1.2 + rng() * 1.2);
      b.box(material, sub(m, x, y - 0.4, (rng() - 0.5) * depth * 0.3, rng() * 3, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4), sz * 1.3, sz * 0.8, sz, { jit: 0.1 }, tint);
    }
  }
}

/**
 * Scatter rubble blocks (fast hexas) around (x, z) in a disc/ellipse; blocks sink partly into the
 * ground and tilt with random rotations. `size` = [min, max] edge length.
 */
export function rubble(ctx, b, material, x, z, count, radius, rng, { size = [0.5, 2.2], sink = 0.35, rx = null, rz = null, yaw = 0, tint = null, flat = 0.6, jit = 0.12 } = {}) {
  const RX = rx ?? radius;
  const RZ = rz ?? radius;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const n = Math.round(count * (b.detail ?? 1));
  for (let i = 0; i < n; i++) {
    // cluster toward the centre
    const a = rng() * Math.PI * 2;
    const rr = Math.pow(rng(), 0.7);
    const lx = Math.cos(a) * rr * RX;
    const lz = Math.sin(a) * rr * RZ;
    const px = x + lx * cy + lz * sy;
    const pz = z - lx * sy + lz * cy;
    const gy = ctx.heightAt(px, pz);
    const s = size[0] + (size[1] - size[0]) * Math.pow(rng(), 2.2);
    const w = s * (0.8 + 0.7 * rng());
    const h = s * (flat + (1 - flat) * rng());
    const d = s * (0.7 + 0.6 * rng());
    b.setGround(gy, 2.5);
    b.box(material, mat(px, gy - h * sink, pz, rng() * 6.28, (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5), w, h, d, { jit: jit * s }, tint);
  }
}
