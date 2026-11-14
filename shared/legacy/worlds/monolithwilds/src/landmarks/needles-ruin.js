// Needle City — the ground and the ruin.
//
//   fallen   a needle snapped ~70 m up; its upper part lies across the plateau in four broken
//            lengths along a cleared scar, collars burst off, rubble and crushed pods around it
//   caught   a needle snapped ~100 m up; its whole upper part slid off the stump and now leans
//            against a great needle, its blunt top resting on a collar ~200 m up
//   alleys   narrow paved causeways between neighbouring plinths, with lamp posts here and there

import * as THREE from 'crownfall-world-three';
import { BOX, prismTpl } from './needles-geo.js';
import { emitTower, emitPlinth } from './needles-tower.js';
import { rAt, axisAt } from './needles-plan.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** Frame placing tower-local height `yFrom` at world point p with the axis along dir (unit). */
function lieFrame(p, dir, yFrom, roll) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const qr = new THREE.Quaternion().setFromAxisAngle(UP, roll);
  q.multiply(qr);
  const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
  return m.multiply(new THREE.Matrix4().makeTranslation(0, -yFrom, 0));
}

export function buildRuins(ctx, plan, A, rng, out) {
  const H = (x, z) => ctx.heightAt(x, z);
  const stats = { debris: 0, alleys: 0 };

  // --- the caught needle --------------------------------------------------------------------
  if (plan.caught) {
    const { S, T } = plan.caught;
    const dx = T.x - S.x, dz = T.z - S.z;
    const l = Math.hypot(dx, dz);
    const ux = dx / l, uz = dz / l;
    const L = S.H - S.snapY;
    const p0 = new THREE.Vector3(S.x + ux * (S.r0 + 3), 0, S.z + uz * (S.r0 + 3));
    p0.y = H(p0.x, p0.z) + rAt(S, S.snapY) * 0.35;
    // contact: T's surface at the height where a length-L piece from p0 reaches it
    const rTop = rAt(S, S.H);
    let yc = 200;
    for (let it = 0; it < 6; it++) {
      const ax = axisAt(T, yc - T.baseY, new THREE.Vector3());
      const rt = rAt(T, yc - T.baseY) * 1.2 + 0.35 + rTop;
      const hx = ax.x - ux * rt - p0.x, hz = ax.z - uz * rt - p0.z;
      const dh = Math.hypot(hx, hz);
      yc = p0.y + Math.sqrt(Math.max(1, L * L - dh * dh));
    }
    // snap T's nearest collar to the contact (the piece rests ON a collar)
    const ax = axisAt(T, yc - T.baseY, new THREE.Vector3());
    const rt = rAt(T, yc - T.baseY) * 1.2 + 0.35 + rTop * 0.9;
    const p1 = new THREE.Vector3(ax.x - ux * rt, yc, ax.z - uz * rt);
    const dir = p1.clone().sub(p0).normalize();
    const f = lieFrame(p0, dir, S.snapY, rng() * TAU);
    emitTower(S, A, rng, out, { frame: f, y0: S.snapY, y1: S.H, rings: false, loggia: false });
    plan.caughtSeg = { a: p0.clone(), b: p1.clone(), r: 12 };
    // a bronze saddle where it rests, rubble at the foot
    for (const k in A) A[k].setFrame(null);
    A.bronze.box(p1.x, p1.y - 1.5, p1.z, 3.5, 2.2, 3.5, Math.atan2(ux, uz), 0.8);
    debris(ctx, A, rng, S, p0.x, p0.z, 26, 40, stats);
    debris(ctx, A, rng, S, S.x, S.z, 18, 30, stats);
  }

  // --- the fallen needle ----------------------------------------------------------------------
  if (plan.fallen) {
    const { F, dir } = plan.fallen;
    const L = F.H - F.snapY;
    const cuts = [F.snapY];
    const nP = 4;
    for (let k = 1; k < nP; k++) cuts.push(F.snapY + (L * k) / nP + rng.range(-L * 0.06, L * 0.06));
    cuts.push(F.H);
    let s = F.r0 + 6;
    let yaw = 0;
    for (let k = 0; k < nP; k++) {
      const a = cuts[k], b = cuts[k + 1];
      const len = b - a;
      yaw += rng.range(-0.09, 0.09);
      const cx = Math.cos(yaw), sx = Math.sin(yaw);
      const ddx = dir.x * cx - dir.z * sx, ddz = dir.x * sx + dir.z * cx;
      const x0 = F.x + dir.x * s, z0 = F.z + dir.z * s;
      const x1 = x0 + ddx * len, z1 = z0 + ddz * len;
      const r0 = rAt(F, a), r1 = rAt(F, b);
      const y0 = H(x0, z0) + r0 * 0.45, y1 = H(x1, z1) + r1 * 0.45;
      const p = new THREE.Vector3(x0, y0, z0);
      const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
      const fr = lieFrame(p, d, a, rng() * TAU);
      emitTower(F, A, rng, out, { frame: fr, y0: a, y1: b, pods: false, rings: false, loggia: false, crown: false });
      if (k === nP - 1) {
        // the spike, snapped off and lying beside the last length
        for (const kk in A) A[kk].setFrame(null);
        const ex = x1 + ddz * 4, ez = z1 - ddx * 4;
        A.bronze.standAlong(prismTpl(6, 0.02), x1 - ddx * 3, H(x1, z1) + 0.6, z1 - ddz * 3, ex + ddx * 32, H(ex + ddx * 32, ez + ddz * 32) + 0.3, ez + ddz * 32, r1 * 0.7, 0.9);
      }
      for (const kk in A) A[kk].setFrame(null);
      debris(ctx, A, rng, F, (x0 + x1) / 2, (z0 + z1) / 2, len * 0.5, 18 + len * 0.1, stats);
      // burst collars lying near the break
      if (rng() < 0.8) {
        const bx = x1 + rng.range(-10, 10), bz = z1 + rng.range(-10, 10);
        const rc = r1 * 1.25 + 0.4;
        A.bronze.put(prismTpl(F.n, 1, false), bx, H(bx, bz) + rc * 0.8, bz, rc, 1.6, rc, rng() * TAU, 0.85, Math.PI / 2 + rng.range(-0.3, 0.3));
      }
      s += len + rng.range(3, 9);
    }
    debris(ctx, A, rng, F, F.x, F.z, 16, 30, stats);
    // crushed pods
    for (let k = 0; k < 5; k++) {
      const t = rng.range(0.15, 0.9) * L;
      const side = rng.sign() * rng.range(8, 20);
      const x = F.x + dir.x * t - dir.z * side, z = F.z + dir.z * t + dir.x * side;
      const w = rng.range(3.5, 6), h = rng.range(3, 4.5), d = rng.range(4, 7);
      A.plaster.put(BOX, x, H(x, z) + h * 0.3, z, w, h, d, rng() * TAU, [0.8, 0.72, 0.64], rng.range(-0.4, 0.4), rng.range(-0.5, 0.5));
    }
  }

  // --- plinths --------------------------------------------------------------------------------
  for (const t of plan.towers) {
    if (!t.plinth || t.bundle) continue;
    emitPlinth(A, rng, { x: t.x, z: t.z, pr: t.pr, g0: t.g0, g1: t.g1, baseY: t.baseY, n: t.n, rot: t.rot, tint: [0.92, 0.9, 0.86] });
  }
  for (const B of plan.bundles) {
    emitPlinth(A, rng, { x: B.x, z: B.z, pr: B.pr, g0: B.g0, g1: B.g1, baseY: B.baseY, n: 8, rot: B.members[0].rot, tint: [0.9, 0.88, 0.84] });
    // bands binding the shafts together
    const minHs = Math.min(...B.members.map((m) => m.Hs));
    const bandMat = B.members[0].dark ? A.pale : A.bronze;
    let y = B.baseY + rng.range(25, 40);
    const rr = B.ro + B.rm * 1.15 + 0.6;
    while (y < B.baseY + minHs * 0.9) {
      bandMat.put(prismTpl(8, 1, true), B.x, y, B.z, rr, 1.8, rr, B.members[0].rot, 0.9);
      y += rng.range(24, 44);
    }
  }
  // hung needles: a round well beneath where each would have stood
  for (const h of plan.hung) {
    const g = H(h.x, h.z);
    A.stone.put(prismTpl(12, 1, true), h.x, g - 1.5, h.z, 7.5, 2.8, 7.5, 0, 0.8);
    A.iron.put(prismTpl(12, 1, true), h.x, g + 1.3, h.z, 5.8, 0.1, 5.8, 0, 0.12);
  }

  // --- alleys between neighbouring plinths ---------------------------------------------------
  const feet = plan.towers.filter((t) => t.plinth && !t.bundle).map((t) => ({ x: t.x, z: t.z, pr: t.pr }));
  for (const B of plan.bundles) feet.push({ x: B.x, z: B.z, pr: B.pr });
  for (let i = 0; i < feet.length; i++) {
    const a = feet[i];
    let links = 0;
    for (let j = i + 1; j < feet.length && links < 3; j++) {
      const b = feet[j];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > a.pr + b.pr + 26 || d < a.pr + b.pr + 1) continue;
      const ux = (b.x - a.x) / d, uz = (b.z - a.z) / d;
      const x0 = a.x + ux * a.pr * 0.9, z0 = a.z + uz * a.pr * 0.9;
      const x1 = b.x - ux * b.pr * 0.9, z1 = b.z - uz * b.pr * 0.9;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const g = Math.max(H(x0, z0), H(mx, mz), H(x1, z1));
      const w = rng.range(2.4, 3.4);
      A.stone.box(mx, g - 0.35, mz, w, 1.3, Math.hypot(x1 - x0, z1 - z0), Math.atan2(ux, uz), 0.78);
      stats.alleys++;
      links++;
      if (rng() < 0.12) {
        const sx = mx - uz * (w / 2 + 0.4), sz = mz + ux * (w / 2 + 0.4);
        A.stone.box(sx, g + 1.6, sz, 0.45, 3.4, 0.45, 0, 0.85);
        A.glowF.box(sx, g + 3.6, sz, 0.55, 0.7, 0.55, 0, 1);
        A.iron.box(sx, g + 4.05, sz, 0.8, 0.18, 0.8, 0, 0.6);
      }
    }
  }
  return stats;
}

function debris(ctx, A, rng, t, cx, cz, R, n, stats) {
  const acc = t.dark ? A.dark : A.pale;
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, r = R * Math.sqrt(rng());
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const s = rng.range(0.6, 1) * rng.range(0.8, 3.6);
    acc.box(x, ctx.heightAt(x, z) + s * 0.2, z, s * rng.range(0.8, 1.6), s * rng.range(0.5, 1), s * rng.range(0.7, 1.3), rng() * TAU, [t.tint[0] * 0.85, t.tint[1] * 0.83, t.tint[2] * 0.8], rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
    stats.debris++;
  }
}
