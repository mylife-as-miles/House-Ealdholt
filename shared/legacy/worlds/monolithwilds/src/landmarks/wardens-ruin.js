// Kneeling Wardens — the one that fell.
//
// Its legs still kneel and one arm still props the ground, but the torso broke at the waist:
// the upper body lies face-down in two great coursed sections, the collar drums rolled free,
// and the head rolled down to the water's edge: it lies along the shoreline half drowned, its
// slit a seam just above the waterline (cyan at night, doubled by the reflection).
// Authored in the fallen warden's local frame (sink matrix set by the caller).

import * as THREE from 'crownfall-world-three';
import { Sink, stack, keyed } from './wardens-sink.js';
import { torsoSection, headShape, SPINE_KEYS, SLIT_TINT } from './wardens-body.js';

const _v = new THREE.Vector3();

export function buildRuin(sink, M, W, anchors) {
  const s = W.s;
  const rng = W.rng;
  const B = W.body;
  const plant = anchors.plant;
  const fallYaw = 0.34; // falls forward and a little outward (away from the others)
  const dir = [Math.sin(fallYaw), Math.cos(fallYaw)];
  const stumpZ = B.at(W.stumpT).z;

  // --- the two torso sections, lying face-down
  const pieces = [
    { t0: W.stumpT + 0.03, t1: 0.66, dist: 78 * s, yawOff: 0.05, roll: 0.22, lat: 0 },
    { t0: 0.69, t1: 0.95, dist: 140 * s, yawOff: 0.42, roll: -0.35, lat: 16 * s },
  ];
  let lastEnd = null;
  for (const P of pieces) {
    const sec = torsoSection(W, P.t0, P.t1, rng);
    const tmp = new Sink();
    stack(tmp, M.stone, sec.courses, { N: 36, cuts: sec.cuts, capBottom: true, loft: true });
    const [hx, hz] = keyed(SPINE_KEYS, (P.t0 + P.t1) / 2);
    const px = dir[0] * P.dist + dir[1] * P.lat;
    const pz = stumpZ + dir[1] * P.dist - dir[0] * P.lat;
    const g = W.groundMin(px, pz, hz * s * 0.8);
    const yawL = fallYaw + P.yawOff;
    const m = new THREE.Matrix4()
      .makeTranslation(px, g + hz * s * 0.55, pz)
      .multiply(new THREE.Matrix4().makeRotationY(yawL))
      .multiply(new THREE.Matrix4().makeRotationZ(P.roll))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.04))
      .multiply(new THREE.Matrix4().makeTranslation(0, -sec.len / 2, 0));
    sink.addSink(tmp, m);
    // spine rib along the (now upward) back
    for (let i = 0; i < sec.courses.length; i++) {
      const c = sec.courses[i];
      if (i < 2 || i > sec.courses.length - 3 || rng() < 0.2) continue;
      _v.set(c.cx, (c.y0 + c.y1) / 2, c.cz - c.hz - 0.4).applyMatrix4(m);
      sink.box(M.spine, _v.x, _v.y, _v.z, 3.2 * s, 1.6, 2.9, yawL, 1, 0, P.roll);
    }
    // plants along the top
    const nP = 6;
    for (let k = 0; k < nP; k++) {
      const t = (k + 0.5) / nP;
      _v.set(rng.range(-0.4, 0.4) * hx * s, t * sec.len, -hz * s * 0.85).applyMatrix4(m);
      plant.push({ x: _v.x, y: _v.y - 1.2, z: _v.z, rx: 3, rz: 3, n: rng.int(1, 2), kind: rng() < 0.5 ? 'pine' : 'shrub' });
    }
    // rubble spilled along both flanks
    for (let k = 0; k < 26; k++) {
      const t = rng.range(-0.5, 0.5) * sec.len;
      const side = rng.sign() * rng.range(hx * s * 0.9, hx * s * 1.7);
      const bx = px + Math.sin(yawL) * t + Math.cos(yawL) * side;
      const bz = pz + Math.cos(yawL) * t - Math.sin(yawL) * side;
      rubble(sink, M, W, bx, bz, rng.range(1.2, 4.5), rng);
    }
    _v.set(0, sec.len, 0).applyMatrix4(m);
    lastEnd = { x: _v.x, z: _v.z };
  }

  // --- the fallen outer arm: two broken lengths beside the first section
  for (let k = 0; k < 2; k++) {
    const tmp = new Sink();
    const courses = [];
    const n = 9 + k * 3;
    for (let i = 0; i < n; i++) {
      const endK = Math.min(i, n - 1 - i);
      courses.push({
        y0: i * 3, y1: i * 3 + 3, cx: 0, cz: 0, hx: (9.4 - i * 0.15) * s, hz: (10 - i * 0.15) * s, e: 2.5, yaw: 0,
        tint: i % 5 === 2 ? 0.82 : rng.range(0.85, 1), cut: [endK < 2 ? rng.range(2, 6) : 0, endK < 2 && rng() < 0.6 ? rng.range(2, 5) : 0],
      });
    }
    stack(tmp, M.stone, courses, { N: 24, cuts: [[1.2, 0.5], [4.2, 0.6]], capBottom: true });
    const px = 62 * s + k * 20 * s;
    const pz = 70 * s + k * 42 * s;
    const g = W.groundMin(px, pz, 10);
    const m = new THREE.Matrix4()
      .makeTranslation(px, g + 9.4 * s * 0.55, pz)
      .multiply(new THREE.Matrix4().makeRotationY(0.5 + k * 0.5))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(0, -n * 1.5, 0));
    sink.addSink(tmp, m);
  }

  // --- collar drums rolled free near the second section
  for (let k = 0; k < 2; k++) {
    const r = (13.5 - k * 1.5) * s;
    const g = new THREE.CylinderGeometry(r, r, 2.6, 28, 1, false);
    const px = lastEnd.x + (k ? 18 : -10) * s;
    const pz = lastEnd.z + (k ? 6 : 22) * s;
    const gy = W.groundMin(px, pz, 6);
    const m = new THREE.Matrix4()
      .makeTranslation(px, gy + r * (k ? 0.2 : 0.75), pz)
      .multiply(new THREE.Matrix4().makeRotationY(rng.range(0, 3)))
      .multiply(new THREE.Matrix4().makeRotationX(k ? 0.12 : 1.35));
    sink.geo(M.stone, g, m, 0.9);
    g.dispose();
  }

  // --- the head, rolled down to the shore: search a fan for the nearest water
  let best = null;
  for (let a = -0.9; a <= 0.9; a += 0.06) {
    const yaw = fallYaw + a;
    for (let d = 20; d < 520; d += 4) {
      const x = lastEnd.x + Math.sin(yaw) * d;
      const z = lastEnd.z + Math.cos(yaw) * d;
      if (W.groundAt(x, z) < 0.6) {
        if (!best || d < best.d) best = { d, x, z, yaw };
        break;
      }
    }
  }
  if (best) {
    const H = headShape('egg', s);
    const hx = best.x + Math.sin(best.yaw) * 6;
    const hz = best.z + Math.cos(best.yaw) * 6;
    // lying along the shoreline on its side: the slit plane is almost horizontal, so the seam
    // runs along the flank facing the land, just above the waterline
    const m = new THREE.Matrix4()
      .makeTranslation(hx, 1.6, hz)
      .multiply(new THREE.Matrix4().makeRotationY(Math.PI + best.yaw))
      .multiply(new THREE.Matrix4().makeRotationX(0.2))
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
      .multiply(new THREE.Matrix4().makeTranslation(0, -H.len / 2, 0));
    sink.geo(M.head, H.shell, m, 1.2);
    sink.geo(M.lamp, H.slit, m, SLIT_TINT);
    H.shell.dispose();
    H.slit.dispose();
    // a shard broken from the crown, lying beside it
    sink.box(M.stone, hx - Math.cos(best.yaw) * 16 * s, W.groundAt(hx - Math.cos(best.yaw) * 16 * s, hz + Math.sin(best.yaw) * 16 * s) + 1, hz + Math.sin(best.yaw) * 16 * s, 6, 3.5, 4.5, best.yaw + 0.7, 0.9, 0.3, 0.4);
    anchors.fallenHead = { x: hx, y: 1.2, z: hz, yaw: best.yaw };
    // the trail it cut through the terrace: a dark furrow of torn turf and shattered blocks,
    // with shards chipped from the head where it bounced, thinning toward the water
    const L = Math.hypot(hx - lastEnd.x, hz - lastEnd.z);
    const ux = (hx - lastEnd.x) / L, uz = (hz - lastEnd.z) / L;
    const n = 90;
    for (let k = 0; k < n; k++) {
      const t = rng();
      const w = rng.range(-1, 1) * (7 + 10 * t);
      const x = lastEnd.x + ux * L * t - uz * w;
      const z = lastEnd.z + uz * L * t + ux * w;
      rubble(sink, M, W, x, z, rng.range(0.8, 3.2) * (1.3 - t * 0.5), rng);
    }
    // bounce marks: flat slabs of turf-darkened stone pressed into the slope
    for (let k = 1; k <= 3; k++) {
      const t = k / 4 + rng.range(-0.05, 0.05);
      const x = lastEnd.x + ux * L * t, z = lastEnd.z + uz * L * t;
      const g = W.groundAt(x, z);
      if (g < 0.5) continue;
      sink.box(M.basalt, x, g + 0.05, z, 14, 0.5, 9, Math.atan2(ux, uz), 0.45, 0, 0);
      for (let j = 0; j < 4; j++) rubble(sink, M, W, x + rng.range(-8, 8), z + rng.range(-8, 8), rng.range(2.5, 5), rng, true);
    }
    // curved shards of the head's shell near where it came to rest
    for (let k = 0; k < 5; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(18, 34) * s;
      const x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
      const g = W.groundAt(x, z);
      if (g < -1.5) continue;
      const sh = rng.range(4, 7);
      sink.box(M.head, x, Math.max(g, -0.5) + sh * 0.2, z, sh * 1.6, sh * 0.45, sh, rng.range(0, 3), 1.15, rng.range(-0.4, 0.4), rng.range(-0.3, 0.3));
    }
  }

  // --- debris field around the stump
  for (let k = 0; k < 70; k++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(40, 105) * s;
    const x = Math.cos(a) * r * 0.9 + 12 * s;
    const z = stumpZ + Math.sin(a) * r + 10 * s;
    const big = rng() < 0.12;
    rubble(sink, M, W, x, z, big ? rng.range(5, 9) : rng.range(1, 4), rng, big);
  }
  // rubble heaped on the stump's broken top
  plant.push({ x: 0, y: B.at(W.stumpT).y - 6 * s, z: stumpZ, rx: 14 * s, rz: 12 * s, n: 5, kind: 'mix' });
}

function rubble(sink, M, W, x, z, size, rng, slab = false) {
  const g = W.groundAt(x, z);
  if (g < -2) return;
  const sx = size * rng.range(1, slab ? 2.6 : 1.8);
  const sy = size * rng.range(slab ? 0.3 : 0.55, slab ? 0.45 : 1);
  const sz = size * rng.range(0.8, slab ? 1.8 : 1.2);
  sink.box(rng() < 0.2 ? M.basalt : M.stone, x, g + sy * 0.32, z, sx, sy, sz, rng.range(0, 3.1), rng.range(0.78, 0.98), rng.range(-0.3, 0.3), rng.range(-0.25, 0.25));
}
