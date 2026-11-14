// Landings: every flight ends on a flat landing with a semicircular bay thrown out over the
// void on a pendant corbel, and one small human thing — a shrine with a votive lamp, a bench
// facing the view, a lamp post, or (on the long landings) a slender pointed arch spanning the
// stair with a bronze lantern hanging from its keystone. From afar the bays and arches are the
// knots that give the ribbon its mid-scale rhythm; at night the lamps trace the spiral.

import * as THREE from 'crownfall-world-three';
import { archRing } from '../core/shapes.js';
import { STAIR } from './stair-path.js';

const ws = STAIR.stringer;
const CURB = STAIR.curb;

/** A small bronze lantern: base plate, glowing body, pyramid cap, ring. (x, y = bottom, z) */
export function lantern(W, x, y, z, s = 1, yaw = 0) {
  W.bronze.block(x, y + 0.04 * s, z, 0.42 * s, 0.08 * s, 0.42 * s, yaw);
  W.glow.block(x, y + 0.3 * s, z, 0.3 * s, 0.44 * s, 0.3 * s, yaw);
  // corner posts
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const ox = (a * c + b * sn) * 0.16 * s, oz = (-a * sn + b * c) * 0.16 * s;
    W.bronze.block(x + ox, y + 0.3 * s, z + oz, 0.05 * s, 0.46 * s, 0.05 * s, yaw);
  }
  W.bronze.lathe(x, y + 0.52 * s, z, [[0.3 * s, 0], [0.26 * s, 0.06 * s], [0.05 * s, 0.3 * s], [0.02 * s, 0.4 * s]], 4, yaw + Math.PI / 4);
}

export function buildLandings(ctx, P, W, rng, zoneOf, weather) {
  const lamps = [];
  const f = {};
  for (const g of P.landings) {
    if (g.feature === 'gate' || g.feature === 'door') continue;
    const mid = (g.s0 + g.s1) / 2;
    P.plan(mid, f);
    const y0 = g.y0;
    const hw = P.width(mid) / 2;
    const w = W[zoneOf(y0)];
    const t0 = w.tint;
    const kk = weather(y0);
    w.tint = [t0[0] * kk, t0[1] * kk, t0[2] * kk];
    const T = [f.tx, 0, f.tz];
    const N = [f.nx, 0, f.nz];
    const yaw = Math.atan2(f.tx, f.tz);
    const at = (t, u, v) => [f.x + T[0] * t + N[0] * u, y0 + v, f.z + T[2] * t + N[2] * u];

    // ---- the bay: a half-disc platform on the outer side
    const rb = 4.0;
    const cu = hw - ws * 0.5; // bay centre on the outer stringer axis
    const segN = 10;
    const ring = (r, v, k) => {
      const a = (k / segN) * Math.PI;
      return at(Math.cos(a) * r, cu + Math.sin(a) * r, v);
    };
    const UP = [0, 1, 0];
    const DN = [0, -1, 0];
    const rimIn = rb - 0.55;
    const dBay = 1.25;
    for (let k = 0; k < segN; k++) {
      const a0 = ring(rimIn, 0, k), a1 = ring(rimIn, 0, k + 1);
      const c = at(0, cu, 0);
      w.triN(c, a1, a0, UP);
      // rim curb top
      w.quadN(ring(rimIn, CURB + 0.04, k), ring(rb + 0.1, CURB + 0.04, k), ring(rb + 0.1, CURB + 0.04, k + 1), ring(rimIn, CURB + 0.04, k + 1), UP);
      // rim inner face
      const am = (k + 0.5) / segN * Math.PI;
      const inward = [-(T[0] * Math.cos(am) + N[0] * Math.sin(am)), 0, -(T[2] * Math.cos(am) + N[2] * Math.sin(am))];
      w.quadN(ring(rimIn, 0, k), ring(rimIn, 0, k + 1), ring(rimIn, CURB + 0.04, k + 1), ring(rimIn, CURB + 0.04, k), inward);
      // outer face (with a projecting cornice lip)
      const outward = [-inward[0], 0, -inward[2]];
      w.quadN(ring(rb, -dBay, k), ring(rb, -dBay, k + 1), ring(rb, CURB - 0.16, k + 1), ring(rb, CURB - 0.16, k), outward);
      w.quadN(ring(rb, CURB - 0.16, k), ring(rb, CURB - 0.16, k + 1), ring(rb + 0.1, CURB - 0.1, k + 1), ring(rb + 0.1, CURB - 0.1, k), [outward[0], -1, outward[2]]);
      w.quadN(ring(rb + 0.1, CURB - 0.1, k), ring(rb + 0.1, CURB - 0.1, k + 1), ring(rb + 0.1, CURB + 0.04, k + 1), ring(rb + 0.1, CURB + 0.04, k), outward);
      // underside
      w.triN(at(0, cu, -dBay), ring(rb, -dBay, k), ring(rb, -dBay, k + 1), DN);
    }
    // pendant corbel under the bay (a stepped cone, the "drop" seen from below)
    w.lathe(f.x + N[0] * cu, y0 - dBay - 7.5, f.z + N[2] * cu, [[0.0, 0], [0.4, 0.4], [0.8, 2.0], [1.7, 4.0], [2.1, 4.3], [2.9, 6.0], [rb - 0.2, 7.5]], 10, yaw, { capTop: false });
    // bay balusters + rail segments
    const nb = 13;
    let prevTop = null;
    for (let k = 0; k <= nb; k++) {
      const a = 0.08 + (k / nb) * (Math.PI - 0.16);
      const r = rb - 0.28;
      const p = at(Math.cos(a) * r, cu + Math.sin(a) * r, CURB + 0.04);
      w.lathe(p[0], p[1], p[2], [[0.085, 0], [0.05, 0.16], [0.1, 0.44], [0.05, 0.74], [0.085, 0.86]], 4, yaw + a);
      const top = [p[0], p[1] + 0.86, p[2]];
      if (prevTop) {
        const mx = (prevTop[0] + top[0]) / 2, mz = (prevTop[2] + top[2]) / 2;
        const len = Math.hypot(top[0] - prevTop[0], top[2] - prevTop[2]);
        const ry = Math.atan2(top[0] - prevTop[0], top[2] - prevTop[2]);
        w.block(mx, top[1] + 0.11, mz, 0.52, 0.22, len + 0.28, ry);
        W.bronze.block(mx, top[1] + 0.24, mz, 0.12, 0.06, len + 0.2, ry);
      }
      prevTop = top;
    }

    // ---- the feature
    const feat = g.feature;
    if (feat === 'shrine') {
      // an aedicule against the inner rail, facing the bay and the view
      const ub = -hw + ws + 0.15;
      const ctr = (du, v) => at(0, ub + du, v);
      const c1 = ctr(0.75, 0.45);
      w.block(c1[0], c1[1], c1[2], 1.5, 0.9, 3.0, yaw);
      const c2 = ctr(0.2, 0.9 + 1.5);
      w.block(c2[0], c2[1], c2[2], 0.4, 3.0, 2.7, yaw);
      for (const t of [-1.12, 1.12]) {
        const p = at(t, ub + 1.25, 0.9);
        w.lathe(p[0], p[1], p[2], [[0.2, 0], [0.16, 0.18], [0.14, 2.0], [0.2, 2.2]], 8, 0);
      }
      const c3 = ctr(0.72, 3.1 + 0.18);
      w.block(c3[0], c3[1], c3[2], 1.7, 0.36, 3.2, yaw);
      // pediment: a gable facing outward
      {
        const e0 = at(-1.6, ub - 0.1, 3.46), e1 = at(1.6, ub - 0.1, 3.46), e2 = at(0, ub - 0.1, 4.3);
        const f0 = at(-1.6, ub + 1.55, 3.46), f1 = at(1.6, ub + 1.55, 3.46), f2 = at(0, ub + 1.55, 4.3);
        w.triN(f0, f1, f2, N);
        w.triN(e0, e2, e1, [-N[0], 0, -N[2]]);
        w.quadN(f0, e0, e2, f2, [-T[0], 0.9, -T[2]]);
        w.quadN(f1, f2, e2, e1, [T[0], 0.9, T[2]]);
      }
      // the votive: a small stele and a lamp at its foot
      const st = ctr(0.55, 0.9 + 0.75);
      w.block(st[0], st[1], st[2], 0.22, 1.5, 0.55, yaw);
      const lp = at(0.0, ub + 1.1, 0.9);
      lantern(W, lp[0], lp[1], lp[2], 0.9, yaw);
      lamps.push(lp);
    } else if (feat === 'bench' || feat === 'arch') {
      // a stone bench in the bay, facing out
      const bc = at(0, cu + 1.25, 0);
      const byaw = yaw;
      w.block(bc[0], bc[1] + 0.47, bc[2], 0.62, 0.14, 2.5, byaw);
      for (const t of [-0.95, 0.95]) {
        const p = at(t, cu + 1.25, 0.2);
        w.block(p[0], p[1], p[2], 0.42, 0.4, 0.34, byaw);
      }
    } else if (feat === 'lamp') {
      const p = at(0, cu + 1.6, 0);
      W.bronze.lathe(p[0], p[1], p[2], [[0.22, 0], [0.18, 0.2], [0.07, 0.3], [0.06, 3.0], [0.12, 3.1]], 6, 0);
      lantern(W, p[0], p[1] + 3.1, p[2], 1.1, yaw);
      lamps.push([p[0], p[1] + 3.1, p[2]]);
    }
    if (feat === 'arch') {
      // two pylons on the stringers + a slender pointed arch spanning the flight
      const Hp = 9.5;
      const uP = hw - ws * 0.5;
      for (const sd of [-1, 1]) {
        const p = at(0, sd * uP, Hp / 2 + CURB * 0.5);
        w.block(p[0], p[1], p[2], 1.15, Hp + CURB, 1.4, yaw);
        const cap = at(0, sd * uP, Hp + CURB + 0.2);
        w.block(cap[0], cap[1], cap[2], 1.45, 0.4, 1.55, yaw);
        const bs = at(0, sd * uP, 0.35);
        w.block(bs[0], bs[1], bs[2], 1.5, 0.7, 1.6, yaw);
      }
      const span = 2 * uP - 1.15;
      const geo = archRing({ span, rise: span * 0.95, thick: 0.95, depth: 1.35, segments: 16, pointed: 0.45 });
      // local X → N (across), Y → up, Z → T (along the path)
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(N[0], 0, N[2]),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(T[0], 0, T[2]),
      );
      if (m.determinant() < 0) m.makeBasis(new THREE.Vector3(N[0], 0, N[2]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-T[0], 0, -T[2]));
      const o = at(0, 0, Hp + CURB + 0.4);
      m.setPosition(o[0], o[1], o[2]);
      w.addGeometry(geo, m);
      geo.dispose();
      // keystone + hanging lantern
      const apexY = Hp + CURB + 0.4 + span * 0.95 * (1 + 0.45 * 0.35);
      const ks = at(0, 0, apexY + 0.2);
      w.block(ks[0], ks[1], ks[2], 1.0, 1.3, 1.45, yaw);
      const hook = at(0, 0, apexY - 0.55);
      W.bronze.strut([hook[0], hook[1] + 0.6, hook[2]], [hook[0], hook[1] - 1.6, hook[2]], 0.035, 0.035, 4);
      lantern(W, hook[0], hook[1] - 2.25, hook[2], 1.2, yaw);
      lamps.push([hook[0], hook[1] - 2.25, hook[2]]);
    }
    w.tint = t0;
  }
  return { lamps };
}
