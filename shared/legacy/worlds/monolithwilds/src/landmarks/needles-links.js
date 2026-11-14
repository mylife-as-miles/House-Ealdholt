// Needle City — the hair-thin bridges, cables and lanterns between the needles, the swinging
// halves of broken bridges and the armillary hoops that turn around some crowns.
//
// Construction logic: every bridge springs from a collar (drum joint) and lands on the collar of
// the neighbour nearest in height (so decks may climb a little). Walkways are U-channel decks
// hanging in a shallow catenary; rope bridges are two sagging iron cables; a few short heavy
// "sky streets" are straight covered galleries; broken ones leave stubs and a dangling half that
// sways (instanced, local-space material). Hung needles are held by taut heavy cables running up
// to their neighbours' collars.

import * as THREE from 'crownfall-world-three';
import { makeInstanced } from '../core/builder.js';
import { BOX, CHANNEL, ROD, QUAD } from './needles-geo.js';
import { rAt, axisAt, segDist2D } from './needles-plan.js';

const TAU = Math.PI * 2;
const _a = new THREE.Vector3();

/** Closest distance between 3D segments p1-q1 and p2-q2 (approximate, sampled). */
function segSegDist(p1, q1, p2, q2) {
  let best = Infinity;
  for (let i = 0; i <= 12; i++) {
    const s = i / 12;
    const x = p1.x + (q1.x - p1.x) * s, y = p1.y + (q1.y - p1.y) * s, z = p1.z + (q1.z - p1.z) * s;
    const vx = q2.x - p2.x, vy = q2.y - p2.y, vz = q2.z - p2.z;
    const l2 = vx * vx + vy * vy + vz * vz || 1e-9;
    let t = ((x - p2.x) * vx + (y - p2.y) * vy + (z - p2.z) * vz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = p2.x + vx * t - x, dy = p2.y + vy * t - y, dz = p2.z + vz * t - z;
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return best;
}

export function buildLinks(ctx, plan, A, M, rng, opts = {}) {
  const { towers } = plan;
  const density = opts.density ?? 0.5;
  for (const k in A) A[k].setFrame(null);
  const CELL = 64;
  const grid = new Map();
  const key = (i, j) => i * 4096 + j;
  for (const t of towers) {
    const k = key(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(t);
  }
  const near = (x, z, R, fn) => {
    const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL);
    const j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = grid.get(key(i, j));
      if (l) for (const t of l) fn(t);
    }
  };
  const topOf = (t) => (t.kind === 'snapped' ? t.snapY - 6 : t.Hs - 6);
  const obstacles = [];
  if (plan.caughtSeg) obstacles.push(plan.caughtSeg);

  const bridges = [];
  const danglers = [];
  const used = new Map(); // tower id -> Map(seg index -> count)
  const useCount = (t, i) => used.get(t.id)?.get(i) ?? 0;
  const markUse = (t, i) => {
    let m = used.get(t.id);
    if (!m) used.set(t.id, (m = new Map()));
    m.set(i, (m.get(i) ?? 0) + 1);
  };

  // is the straight line pa-pb clear of every other needle (and earlier bridges)?
  const clearPath = (pa, pb, ta, tb) => {
    const mx = (pa.x + pb.x) / 2, mz = (pa.z + pb.z) / 2;
    const span = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const ymin = Math.min(pa.y, pb.y) - 4, ymax = Math.max(pa.y, pb.y) + 2;
    let ok = true;
    near(mx, mz, span / 2 + 30, (c) => {
      if (!ok || c === ta || c === tb) return;
      const tipBelow = c.kind === 'hung' ? c.baseY - 20 - c.r0 * 5 : c.g0;
      if (ymax < tipBelow) return;
      if (ymin > c.baseY + (c.kind === 'snapped' ? c.snapY : c.H) + 3) return;
      const yl = (pa.y + pb.y) / 2 - c.baseY;
      const ax = axisAt(c, Math.max(0, yl), _a);
      const rr = rAt(c, Math.max(0, yl)) * 1.3 + 1.5 + (c.inhabited ? 1.5 : 0);
      if (segDist2D(ax.x, ax.z, pa.x, pa.z, pb.x, pb.z) < rr) ok = false;
    });
    if (!ok) return false;
    for (const o of obstacles) if (segSegDist(pa, pb, o.a, o.b) < o.r) return false;
    // earlier bridges: only those whose cells overlap this one
    const i0 = Math.floor((Math.min(pa.x, pb.x) - 4) / BC), i1 = Math.floor((Math.max(pa.x, pb.x) + 4) / BC);
    const j0 = Math.floor((Math.min(pa.z, pb.z) - 4) / BC), j1 = Math.floor((Math.max(pa.z, pb.z) + 4) / BC);
    stamp++;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = bgrid.get(key(i, j));
      if (!l) continue;
      for (const b of l) {
        if (b.stamp === stamp) continue;
        b.stamp = stamp;
        if (Math.max(b.a.y, b.b.y) < ymin - 3 || Math.min(b.a.y, b.b.y) > ymax + 3) continue;
        if (segSegDist(pa, pb, b.a, b.b) < 3.5) return false;
      }
    }
    return true;
  };
  const BC = 32;
  const bgrid = new Map();
  let stamp = 0;
  const addBridge = (b) => {
    bridges.push(b);
    const i0 = Math.floor(Math.min(b.a.x, b.b.x) / BC), i1 = Math.floor(Math.max(b.a.x, b.b.x) / BC);
    const j0 = Math.floor(Math.min(b.a.z, b.b.z) / BC), j1 = Math.floor(Math.max(b.a.z, b.b.z) / BC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      let l = bgrid.get(key(i, j));
      if (!l) bgrid.set(key(i, j), (l = []));
      l.push(b);
    }
  };

  const attach = (t, i, toward, out) => {
    const y = t.segs[i];
    axisAt(t, y, out);
    const dx = toward.x - out.x, dz = toward.z - out.z;
    const l = Math.hypot(dx, dz) || 1;
    const r = rAt(t, y) * 1.2 + 0.3;
    out.x += (dx / l) * r;
    out.z += (dz / l) * r;
    return out;
  };

  // candidate pairs
  let tried = 0;
  for (const ta of towers) {
    near(ta.x, ta.z, 125, (tb) => {
      if (tb.id <= ta.id) return;
      if (ta.bundle && ta.bundle === tb.bundle) return;
      const d = Math.hypot(tb.x - ta.x, tb.z - ta.z);
      if (d < 14 || d > 125) return;
      const exp = density * (d < 40 ? 0.95 : d < 75 ? 0.4 : 0.12) * (ta.inhabited || tb.inhabited ? 1.2 : 0.8);
      const nb = Math.floor(exp + rng());
      for (let k = 0; k < nb; k++) {
        tried++;
        const la = ta.segs.length;
        if (la < 3) return;
        const i = rng.int(1, la - 2);
        const yA = ta.baseY + ta.segs[i];
        if (ta.segs[i] > topOf(ta) || yA > tb.baseY + topOf(tb) || yA < ta.g1 + 22) continue;
        let j = -1, bestDy = Infinity;
        for (let q = 1; q < tb.segs.length - 1; q++) {
          if (tb.segs[q] > topOf(tb)) break;
          const dy = Math.abs(tb.baseY + tb.segs[q] - yA);
          if (dy < bestDy) { bestDy = dy; j = q; }
        }
        if (j < 0 || bestDy > Math.min(14, d * 0.2)) continue;
        if (useCount(ta, i) >= 3 || useCount(tb, j) >= 3) continue;
        const cb = axisAt(tb, tb.segs[j], new THREE.Vector3());
        const pa = attach(ta, i, cb, new THREE.Vector3());
        const pb = attach(tb, j, pa, new THREE.Vector3());
        if (!clearPath(pa, pb, ta, tb)) continue;
        const span = pa.distanceTo(pb);
        const heavy = span < 55 && ta.r0 > 2.8 && tb.r0 > 2.8 && !ta.lean && !tb.lean && rng() < 0.16;
        const p = rng();
        const type = heavy ? 'covered' : p < 0.55 ? 'walk' : p < 0.84 ? 'cable' : 'broken';
        addBridge({ a: pa, b: pb, type, span, lit: ta.inhabited || tb.inhabited, stamp: 0 });
        markUse(ta, i);
        markUse(tb, j);
      }
    });
  }

  // heavy suspension cables for the hung needles
  const cables = [];
  for (const h of plan.hung) {
    for (const nb of h.anchors) {
      const nc = rng.int(2, 3);
      for (let c = 0; c < nc; c++) {
        const i = rng.int(1, Math.max(1, Math.floor((h.segs.length - 1) * 0.6)));
        const yH = h.baseY + h.segs[i];
        const cands = [];
        for (let q = 1; q < nb.segs.length - 1; q++) {
          const y = nb.baseY + nb.segs[q];
          if (y > yH + 18 && y < yH + 110 && nb.segs[q] < topOf(nb)) cands.push(q);
        }
        if (!cands.length) continue;
        const q = rng.pick(cands);
        const pn = axisAt(nb, nb.segs[q], new THREE.Vector3());
        const ph = attach(h, i, pn, new THREE.Vector3());
        const pn2 = attach(nb, q, ph, new THREE.Vector3());
        cables.push({ a: ph, b: pn2 });
      }
    }
  }

  // --- emit -----------------------------------------------------------------------------------
  const lanterns = [];
  const pts = [];
  const curve = (pa, pb, sag, N, s0 = 0, s1 = 1) => {
    pts.length = 0;
    for (let k = 0; k <= N; k++) {
      const s = s0 + ((s1 - s0) * k) / N;
      pts.push(new THREE.Vector3(pa.x + (pb.x - pa.x) * s, pa.y + (pb.y - pa.y) * s - sag * 4 * s * (1 - s), pa.z + (pb.z - pa.z) * s));
    }
    return pts;
  };
  const deck = (acc, P, w, h, tint) => {
    for (let k = 0; k < P.length - 1; k++) acc.beamUp(CHANNEL, P[k].x, P[k].y, P[k].z, P[k + 1].x, P[k + 1].y, P[k + 1].z, w, h, tint);
  };
  for (const b of bridges) {
    const { a: pa, b: pb, span } = b;
    const N = Math.max(3, Math.min(14, Math.ceil(span / 7)));
    const pale = rng() < 0.45;
    const acc = pale ? A.pale : A.iron;
    const tint = pale ? rng.range(0.75, 0.95) : rng.range(0.6, 0.9);
    // brackets on the collars
    for (const p of [pa, pb]) A.bronze.box(p.x, p.y - 0.8, p.z, 1.2, 1.6, 1.2, Math.atan2(pb.x - pa.x, pb.z - pa.z), 0.9);
    if (b.type === 'walk') {
      const sag = span * rng.range(0.02, 0.055);
      const w = rng.range(1.4, 2.3);
      deck(acc, curve(pa, pb, sag, N), w, 1.1, tint);
      if (b.lit && rng() < 0.3) lanterns.push(curve(pa, pb, sag, 2)[1].clone());
    } else if (b.type === 'cable') {
      const sag = span * rng.range(0.045, 0.1);
      const w = rng.range(0.6, 1.0);
      const dx = pb.x - pa.x, dz = pb.z - pa.z;
      const l = Math.hypot(dx, dz) || 1;
      const ox = (-dz / l) * w, oz = (dx / l) * w;
      for (const s of [-1, 1]) {
        const qa = new THREE.Vector3(pa.x + ox * s, pa.y, pa.z + oz * s);
        const qb = new THREE.Vector3(pb.x + ox * s, pb.y, pb.z + oz * s);
        const P = curve(qa, qb, sag, N);
        for (let k = 0; k < P.length - 1; k++) A.iron.beamUp(ROD, P[k].x, P[k].y, P[k].z, P[k + 1].x, P[k + 1].y, P[k + 1].z, 0.22, 0.22, 0.8);
      }
    } else if (b.type === 'covered') {
      const w = rng.range(2.8, 3.6), h = rng.range(3.2, 4.2);
      A.pale.beamUp(BOX, pa.x, pa.y + h / 2 - 0.6, pa.z, pb.x, pb.y + h / 2 - 0.6, pb.z, w, h, [0.92, 0.88, 0.82]);
      A.terra.beamUp(BOX, pa.x, pa.y + h - 0.35, pa.z, pb.x, pb.y + h - 0.35, pb.z, w + 0.8, 0.5, 0.9);
      const nw = Math.floor(span / 4.5);
      const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      for (let k = 1; k < nw; k++) {
        const s = k / nw;
        const x = pa.x + (pb.x - pa.x) * s, y = pa.y + (pb.y - pa.y) * s + h * 0.45 - 0.6, z = pa.z + (pb.z - pa.z) * s;
        for (const side of [-1, 1]) {
          const lit = b.lit && rng() < 0.35;
          (lit ? A.glowF : A.iron).put(QUAD, x + sx * side * (w / 2 + 0.04), y, z + sz * side * (w / 2 + 0.04), 0.8, 1.4, 1, yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2), lit ? 1 : 0.2);
        }
      }
    } else {
      // broken walkway: a long stub from one side, a short one from the other, the lost half dangles
      const sag = span * rng.range(0.02, 0.05);
      const w = rng.range(1.4, 2.1);
      const sBreak = rng.range(0.25, 0.5);
      const P = curve(pa, pb, sag, Math.max(2, Math.round(N * sBreak)), 0, sBreak);
      deck(acc, P, w, 1.1, tint);
      const P2 = curve(pa, pb, sag, 2, rng.range(0.85, 0.93), 1);
      deck(acc, P2, w, 1.1, tint);
      const end = P[P.length - 1];
      const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      const L = Math.min(60, span * (1 - sBreak) * rng.range(0.35, 0.7));
      danglers.push({ x: end.x, y: end.y - 0.3, z: end.z, yaw, L, w, h: 1.1, tilt: rng.range(-0.25, 0.1), amp: rng.range(0.012, 0.03), speed: TAU / rng.range(16, 34), phase: rng() * TAU, pale, tint });
    }
  }
  for (const c of cables) {
    A.iron.beamUp(ROD, c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, 0.75, 0.75, 0.75);
    A.bronze.box(c.b.x, c.b.y, c.b.z, 1.4, 1.4, 1.4, 0, 0.9);
  }
  for (const p of lanterns) {
    A.iron.beamUp(ROD, p.x, p.y - 0.4, p.z, p.x, p.y - 3.2, p.z, 0.12, 0.12, 0.7);
    A.glowF.box(p.x, p.y - 3.8, p.z, 0.7, 1.0, 0.7, 0, 1);
    A.iron.box(p.x, p.y - 3.2, p.z, 0.9, 0.2, 0.9, 0, 0.6);
  }

  // --- instanced: dangling halves ------------------------------------------------------------
  const meshes = [];
  const dangGeo = new THREE.BufferGeometry();
  dangGeo.setAttribute('position', new THREE.BufferAttribute(CHANNEL.pos.slice(), 3));
  dangGeo.setAttribute('normal', new THREE.BufferAttribute(CHANNEL.nrm.slice(), 3));
  dangGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(CHANNEL.idx), 1));
  dangGeo.translate(0, -0.5, 0);
  const dangMats = danglers.map(() => new THREE.Matrix4());
  let dang = null;
  if (danglers.length) {
    dang = makeInstanced(dangGeo, M.ironL, dangMats, { name: 'needles:danglers', colors: danglers.map((d) => new THREE.Color(d.tint * 0.9, d.tint * 0.9, d.tint * 0.9)) });
    meshes.push(dang);
  }
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const setDanglers = (time) => {
    if (!dang) return;
    for (let i = 0; i < danglers.length; i++) {
      const d = danglers[i];
      const sw = d.amp * Math.sin(time * d.speed + d.phase);
      const tw = d.amp * 0.6 * Math.sin(time * d.speed * 0.63 + d.phase * 1.7);
      _e.set(d.tilt + sw, d.yaw, tw, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(d.x, d.y, d.z);
      _s.set(d.w, d.L, d.h);
      _m.compose(_p, _q, _s);
      dang.setMatrixAt(i, _m);
    }
    dang.instanceMatrix.needsUpdate = true;
  };
  setDanglers(0);
  if (dang) {
    dang.computeBoundingSphere();
    dang.boundingSphere.radius += 20;
  }

  return { meshes, setDanglers, stats: { bridges: bridges.length, tried, cables: cables.length, danglers: danglers.length, lanterns: lanterns.length }, bridges };
}

/** Armillary hoops: a tilted ring on a horizontal axle through the shaft, turning slowly. */
export function buildRings(rings, M) {
  if (!rings.length) return { mesh: null, update() {} };
  const torus = new THREE.TorusGeometry(1, 0.028, 4, 36).rotateX(Math.PI / 2);
  const axle = new THREE.BoxGeometry(2, 0.035, 0.035);
  const pin = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 6);
  const a = torus.toNonIndexed(), b = axle.toNonIndexed(), c = pin.toNonIndexed();
  for (const g of [a, b, c]) { g.deleteAttribute('uv'); }
  const pos = [a, b, c].reduce((n, g) => n + g.attributes.position.count, 0);
  const P = new Float32Array(pos * 3), N = new Float32Array(pos * 3);
  let o = 0;
  for (const g of [a, b, c]) {
    P.set(g.attributes.position.array, o);
    N.set(g.attributes.normal.array, o);
    o += g.attributes.position.array.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  const mats = rings.map(() => new THREE.Matrix4());
  const mesh = makeInstanced(geo, M.bronzeL, mats, { name: 'needles:rings' });
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const update = (time) => {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      _e.set(r.tilt, r.phase + time * r.speed, 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(0, r.y, 0);
      _s.set(r.R, r.R, r.R);
      _m.compose(_p, _q, _s).premultiply(r.frame);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 30;
  return { mesh, update };
}
