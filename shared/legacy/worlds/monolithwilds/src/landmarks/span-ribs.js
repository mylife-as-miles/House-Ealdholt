// Ribs, bone fringes and fallen fragments of the Vertebral Span.
//
// Each thoracic unit hangs a pair of ribs from the knobs of its transverse processes. They bow
// outward, then sweep down and inward to meet at a keel knot — seen from the river the pairs
// form an upside-down nave. Rib depth follows a hull curve (deepest mid-span) and is clamped by
// sampling the canyon walls. Some ribs are snapped: jagged shards, a marrow-glow core, and the
// lost piece either dangling from a dried tendon (slow sway) or lying in the river below.
// Stalactite-like bone drips hang from every underside (one InstancedMesh).

import * as THREE from 'crownfall-world-three';
import { sweep, blob, bezier3, curvePts, smoothLathe, h1 } from './span-geo.js';
import { mergeGeometries } from '../core/geometry-utils.js';
import { trs, makeInstanced } from '../core/builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const roundEnd = (t, e0) => (t <= e0 ? 1 : Math.sqrt(Math.max(0.0, 1 - ((t - e0) / (1 - e0)) ** 2)));

// Rib fates by unit index: [west side, east side]. c = complete, b = broken, d = broken + dangling
// piece, f = broken + piece fallen into the river, x = missing entirely (a stub)
const FATES = {
  3: ['c', 'b'], 4: ['c', 'c'], 5: ['d', 'c'], 6: ['c', 'c'], 7: ['c', 'f'], 9: ['f', 'd'],
};

function ribControl(u, sd, D) {
  const W = u.wingTip[sd < 0 ? 0 : 1];
  const z0 = Math.abs(W.z);
  const rk = 0.3 * D;
  return [
    V(W.x, W.y - 1.0, sd * z0),
    V(W.x + rk * 0.15, W.y - D * 0.38, sd * (z0 + 13 * u.size)),
    V(W.x + rk * 0.7, -D * 0.96, sd * (z0 * 0.62)),
    V(W.x + rk, -D, sd * 1.6),
  ];
}

export function buildRibs(ctx, F, B, M, rng, units) {
  const drips = []; // [x,y,z, radius, length] world
  const dangling = []; // { pivot: Vector3 (world), len, scale, phase, yaw }
  const fallen = []; // world xz of fragments to scatter on the floor
  const keels = [];
  const tmp = V(0, 0, 0);

  for (const u of units) {
    if (u.type !== 'thor') continue;
    const fate = FATES[u.i] || ['c', 'c'];
    const k = (u.i - 3) / 6;
    let D = 30 + 72 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, k * 0.9 + 0.06))), 0.7);
    // clamp against the canyon walls: every rib sample must clear the ground by 6 m
    for (let it = 0; it < 30; it++) {
      let ok = true;
      for (const sd of [-1, 1]) {
        const f = bezier3(...ribControl(u, sd, D));
        for (let q = 0; q <= 12 && ok; q++) {
          tmp.copy(f(q / 12)).applyMatrix4(u.matrix);
          if (tmp.y < ctx.heightAt(tmp.x, tmp.z) + 6) ok = false;
        }
      }
      if (ok || D < 10) break;
      D *= 0.9;
    }
    u.ribD = D;
    for (let si = 0; si < 2; si++) {
      const sd = si === 0 ? -1 : 1;
      const f = fate[si];
      const ctrl = ribControl(u, sd, D);
      const fn = bezier3(...ctrl);
      const tEnd = f === 'c' ? 1 : f === 'x' ? 0.18 : 0.34 + 0.4 * h1(u.i, si * 3.1);
      const N = 36;
      const pts = curvePts((t) => fn(t * tEnd), N);
      const sz = u.size;
      const g = sweep(pts, (t0) => {
        const t = t0 * tEnd;
        const fil = 1 + 0.5 * (1 - ss(0, 0.1, t));
        const e = f === 'c' ? roundEnd(t, 0.97) : 1;
        return [sz * (1.5 - 0.5 * t) * fil * Math.max(0.3, e), sz * (3.4 - 1.5 * t) * fil * Math.max(0.3, e)];
      }, { radial: 12, up: V(1, 0, 0), lump: 0.06, lumpFreq: 0.12, lumpSeed: u.i * 4.1 + si, capStart: false, capBulge: f === 'c' ? 0.3 : 0.02 });
      B.add(g, M.bone, u.matrix, 0.96 - 0.05 * h1(u.i, si));

      // drips along the lower half of the rib
      for (let q = 0; q < 6; q++) {
        const t = 0.45 + 0.5 * h1(u.i * 7 + q, si);
        if (t > tEnd) continue;
        tmp.copy(fn(t)).applyMatrix4(u.matrix);
        drips.push([tmp.x, tmp.y - 1.0, tmp.z, 0.5 + 0.4 * h1(q, u.i), 2 + 7 * h1(u.i, q + si)]);
      }

      if (f !== 'c') {
        // the break: shards + marrow glow core
        const endP = pts[N - 1];
        const endT = V().subVectors(pts[N - 1], pts[N - 3]).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), endT);
        const mm = new THREE.Matrix4();
        for (let s = 0; s < 4; s++) {
          const hh = 1.2 + 2.2 * h1(u.i + s, si + 9);
          const cg = new THREE.ConeGeometry(0.45 + 0.5 * h1(s, u.i), hh, 5);
          cg.translate((h1(s, 2) - 0.5) * 2.4 * sz, hh * 0.4, (h1(s, 5) - 0.5) * 1.4 * sz);
          cg.applyQuaternion(q);
          mm.makeTranslation(endP.x, endP.y, endP.z);
          B.add(cg, M.bone, mm.clone().premultiply(u.matrix), 0.9);
        }
        const core = blob(0.75 * sz, 0.75 * sz, 0.75 * sz, { ws: 8, hs: 6, lump: 0.2, freq: 1 });
        B.add(core, M.glow, new THREE.Matrix4().makeTranslation(endP.x, endP.y, endP.z).premultiply(u.matrix), 0.55);
        const wp = endP.clone().applyMatrix4(u.matrix);
        if (f === 'd') {
          dangling.push({ pivot: wp, len: 3 + 5 * h1(u.i, 4), scale: sz * (0.7 + 0.5 * (1 - tEnd)), phase: h1(u.i, si) * 6.28, yaw: h1(si, u.i) * 6.28 });
        } else if (f === 'f') {
          fallen.push(wp);
        }
      } else if (si === 0) {
        // keel knot (only once per complete pair)
        const other = fate[1] === 'c';
        const kp = ctrl[3].clone().setZ(0);
        const knot = blob(3.2 * sz, 2.6 * sz, other ? 3.6 * sz : 2.6 * sz, { ws: 16, hs: 12, lump: 0.12, freq: 0.25, seed: u.i });
        B.add(knot, M.bone, new THREE.Matrix4().makeTranslation(kp.x, kp.y, kp.z).premultiply(u.matrix), 0.94);
        const wk = kp.clone().applyMatrix4(u.matrix);
        keels.push({ u, p: wk, complete: other });
        for (let q = 0; q < 4; q++) {
          drips.push([wk.x + (h1(q, 3) - 0.5) * 4, wk.y - 1.5, wk.z + (h1(q, 7) - 0.5) * 4, 0.9 + 0.6 * h1(q, u.i), 8 + 20 * h1(u.i * 3, q)]);
        }
      }
    }
  }

  // drips under the centra and the wings
  for (const u of units) {
    if (u.type === 'patch') continue;
    const n = Math.round(9 + 8 * u.size);
    for (let q = 0; q < n; q++) {
      const th = Math.PI * (1.12 + 0.76 * h1(u.i * 13 + q, 1));
      const x = (h1(u.i, q * 2.7) - 0.5) * u.Lc * 0.9;
      const r = u.Rc * 0.93;
      tmp.set(x, Math.sin(th) * r, Math.cos(th) * r).applyMatrix4(u.matrix);
      const deep = -Math.sin(th); // 1 at the very bottom
      drips.push([tmp.x, tmp.y + 0.8, tmp.z, 0.5 + 0.7 * h1(q, u.i * 3), 1.5 + 11 * deep * h1(q * 5, u.i) + 2 * deep]);
    }
    for (const W of u.wingTip) {
      for (let q = 0; q < 4; q++) {
        const f = 0.3 + 0.65 * h1(u.i + q, W.z);
        tmp.set(W.x * f, W.y * f - 1.2 * u.size, W.z * f).applyMatrix4(u.matrix);
        drips.push([tmp.x, tmp.y, tmp.z, 0.4 + 0.4 * h1(q, W.z), 1.5 + 5 * h1(W.z, q)]);
      }
    }
  }

  // bronze keel ligament between consecutive complete keel knots
  for (let i = 0; i < keels.length - 1; i++) {
    const a = keels[i];
    const b = keels[i + 1];
    if (!a.complete || !b.complete || b.u.i - a.u.i !== 1) continue;
    const pts = curvePts((t) => V(a.p.x + (b.p.x - a.p.x) * t, a.p.y + (b.p.y - a.p.y) * t - 4 * Math.sin(Math.PI * t) - 2.2, a.p.z + (b.p.z - a.p.z) * t), 14);
    B.add(sweep(pts, () => [0.55, 0.55], { radial: 7, capBulge: 0 }), M.bronze, null, 1);
  }

  return { drips, dangling, fallen, keels };
}

/** Hanging moss beards under the deck edges and the wings (green-tinted drips). */
export function mossBeards(F, rng, units, halfWidthAt) {
  const out = [];
  for (let s = F.sW + 10; s < F.sE - 10; s += 3 + rng() * 9) {
    const f = F.frameAt(s);
    const sd = rng() < 0.5 ? -1 : 1;
    const hw = halfWidthAt(units, s);
    const p = f.P.clone().addScaledVector(f.S, sd * (hw + 0.7)).addScaledVector(f.U, -2.0);
    out.push([p.x, p.y, p.z, 0.3 + 0.25 * rng(), 2.5 + 7 * rng(), true]);
  }
  for (const u of units) {
    if (!u.wingPath) continue;
    for (const w of u.wingPath) {
      for (let k = 0; k < 3; k++) {
        const t = 0.3 + 0.55 * rng();
        const c = w.path(t);
        const [, b] = w.r(t);
        const p = c.clone().setY(c.y - b * 0.8).applyMatrix4(u.matrix);
        out.push([p.x, p.y, p.z, 0.3 + 0.3 * rng(), 3 + 8 * rng(), true]);
      }
    }
  }
  return out;
}

/** One InstancedMesh for every bone drip (hangs straight down from its anchor). */
export function buildDrips(ctx, M, drips) {
  const g = smoothLathe([
    [0.01, -1], [0.1, -0.93], [0.22, -0.8], [0.3, -0.64], [0.42, -0.5], [0.5, -0.36], [0.62, -0.22],
    [0.8, -0.1], [1.0, 0.0], [0.9, 0.12], [0.01, 0.14],
  ], 7);
  const mats = [];
  const colors = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < drips.length; i++) {
    const [x, y, z, r, L, moss] = drips[i];
    e.set((h1(i, 1) - 0.5) * 0.08, h1(i, 2) * 6.28, (h1(i, 3) - 0.5) * 0.08);
    q.setFromEuler(e);
    mats.push(new THREE.Matrix4().compose(V(x, y, z), q, V(r, L, r)));
    const k = 0.85 + 0.2 * h1(i, 9);
    colors.push(moss ? new THREE.Color(0.24 + 0.06 * h1(i, 4), 0.34 + 0.08 * h1(i, 5), 0.16) : new THREE.Color(k, k * 0.98, k * 0.95));
  }
  return makeInstanced(g, M.bone, mats, { colors, name: 'span:drips' });
}

/**
 * Dangling rib pieces: one InstancedMesh (object-space material so the surface doesn't swim),
 * each hanging from a dried tendon at its pivot and swaying over ~30 s.
 */
export function buildDangling(ctx, M, dangling) {
  // geometry: tendon from the pivot (origin) down `1` unit, then a curved rib piece below it
  const tendon = sweep(curvePts((t) => V(0.2 * Math.sin(t * 3), -6 * t, 0), 8), () => [0.28, 0.28], { radial: 6, capBulge: 0 });
  const frag = sweep(curvePts(bezier3(V(0, -5.5, 0), V(2.5, -11, 0), V(3, -18, 0), V(1.5, -24, 0)), 18),
    (t) => [1.1 - 0.35 * t, 2.6 - 1.0 * t], { radial: 10, up: V(0, 0, 1), lump: 0.08, lumpFreq: 0.2, capBulge: 0.05 });
  const knot = blob(1.3, 1.1, 1.3, { ws: 10, hs: 8, lump: 0.2, freq: 0.8 });
  knot.translate(0.2, -5.6, 0);
  const merged = mergeGeometries([tendon, frag, knot], false);
  const mats = [];
  const q = new THREE.Quaternion();
  for (const d of dangling) {
    q.setFromEuler(new THREE.Euler(0, d.yaw, 0));
    mats.push(new THREE.Matrix4().compose(d.pivot, q, V(d.scale, d.scale, d.scale)));
  }
  const mesh = makeInstanced(merged, M.boneLocal, mats, { name: 'span:dangling' });
  mesh.frustumCulled = false;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const eul = new THREE.Euler();
  const mtx = new THREE.Matrix4();
  function update(t) {
    for (let i = 0; i < dangling.length; i++) {
      const d = dangling[i];
      pos.copy(d.pivot);
      scl.setScalar(d.scale);
      const a = 0.045 * Math.sin(t * 0.21 + d.phase) + 0.02 * Math.sin(t * 0.13 + d.phase * 2);
      const b = 0.035 * Math.sin(t * 0.17 + d.phase * 1.7);
      eul.set(a, d.yaw + 0.05 * Math.sin(t * 0.07 + d.phase), b);
      quat.setFromEuler(eul);
      mtx.compose(pos, quat, scl);
      mesh.setMatrixAt(i, mtx);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}

/** Fallen rib fragments half-sunk in the river (and one on a ledge), static. */
export function buildFallen(ctx, B, M, rng, fallen, F) {
  const spots = fallen.map((p) => ({ x: p.x, z: p.z }));
  // extra debris further downstream: the river has carried pieces away over the centuries
  spots.push({ x: F.world(30, 70).x, z: F.world(30, 70).z });
  spots.push({ x: F.world(-20, -55).x, z: F.world(-20, -55).z });
  spots.push({ x: F.world(60, 150).x, z: F.world(60, 150).z });
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    for (let k = 0; k < 3; k++) {
      const x = s.x + (rng() - 0.5) * 34;
      const z = s.z + (rng() - 0.5) * 34;
      const gy = ctx.heightAt(x, z);
      const len = 16 + rng() * 18;
      const bend = 7 + rng() * 7;
      const pts = curvePts((t) => V((t - 0.5) * len, Math.sin(Math.PI * t) * bend, 0), 14);
      const g = sweep(pts, (t) => [1.4 * (1 - 0.3 * t), 3.2 * (1 - 0.3 * t)], { radial: 10, up: V(0, 0, 1), lump: 0.08, lumpFreq: 0.2, lumpSeed: i * 3 + k, capBulge: 0.05 });
      // arching out of the river like half-drowned ribs (or lying on a dry bank)
      const y = gy < 0 ? -bend * 0.55 - rng() * 2 : gy - 1;
      B.add(g, M.bone, trs(x, y, z, (rng() - 0.5) * 0.3, rng() * 6.28, (rng() - 0.5) * 0.35), 0.78 + rng() * 0.1);
    }
  }
}
