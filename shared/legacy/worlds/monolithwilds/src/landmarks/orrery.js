// THE STONE ORRERY — a clockwork of mountains still keeping the hours of a vanished calendar.
//
// Six colossal stone rings (Ø 690 → 160 m) nested round a floating, cracked masonry sphere
// (Ø 100 m) whose centre hangs 262 m above the crater floor. The two outer rings — the Ecliptic
// and the steep Meridian — spin in their own planes about fixed tilted axes; inside the Meridian a
// true gimbal chain (C → D → E → F → sphere) turns on stone axles, each ring about the pins of the
// ring outside it. Rings are sized so their radial shells never overlap, so they turn forever
// without touching (see SHELLS). On the floor: the dial-dais and the snapped pillar that held the
// sphere, cradle pylons, spokes and curbs, hour stones, a fallen seventh ring, the stair and gate.
//
// Rendering: every moving part and the static floor share ONE BatchedMesh per material (7 draw
// calls for the whole landmark); each ring / the sphere / the floor is an instance whose matrix
// is updated per frame. Materials are local:true variants so carved detail rides with the stone.
//
// Files: orrery-mesh.js (triangle sink, profile sweeps), orrery-rings.js (rings, signs, planets,
//        axles), orrery-sphere.js (the cracked sphere), orrery-floor.js (crater floor + stair).

import * as THREE from 'crownfall-world-three';
import { Mesh3 } from './orrery-mesh.js';
import { buildRingA, buildRingB, buildRingC, buildRingD, buildRingE, buildRingF, buildBelt } from './orrery-rings.js';
import { buildSphere } from './orrery-sphere.js';
import { buildFloor } from './orrery-floor.js';
import { yieldToMain as nextFrame } from '../core/yield.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Mechanism (radii in m; periods in s; negative period = turning the other way).
const HOVER = 262; // sphere centre above the crater floor
const RS = 50; // sphere radius
const SPEC = {
  A: {
    R: 340, tilt: 24 * DEG, yaw: 315 * DEG, period: 900, phase: 0.6,
    planets: [
      { a: 0.45, len: 33, lift: 0.34, r: 13, kind: 'marble' },
      { a: 2.62, len: 30, lift: -0.2, r: 10, kind: 'dark' },
      { a: 4.3, len: 36, lift: 0.5, r: 11, kind: 'binary' },
    ],
  },
  B: {
    R: 270, tilt: 50 * DEG, yaw: 122 * DEG, period: -660, phase: 1.1, childHubR: 221.5, axleR: 4.2,
    riders: [
      { a: 1.2, stem: 8, r: 9, kind: 'marble' },
      { a: 4.1, stem: 6, r: 7, kind: 'dark' },
    ],
  },
  C: { R: 205, period: 720, phase: 0.9, childHubR: 163.5, axleR: 3.6 },
  D: { R: 155, period: -540, phase: 2.2, childHubR: 121.5, axleR: 3.0 },
  E: { R: 112, period: 420, phase: -0.7, childHubR: 87.5, axleR: 2.6 },
  F: { R: 80, period: -300, phase: 1.3, childHubR: RS + 5.3, axleR: 2.2 },
  S: { period: 240, phase: 0.4 },
  // the shattered eighth ring: a level belt of fragments far outside the Ecliptic, above the rim
  belt: { R: 458, lift: 25, period: 1500, phase: 0.2 },
};

/**
 * Radial shells (distance from the mechanism centre) occupied by each part in any pose; each
 * turns inside the gap of the next, so nothing can collide. Axles bridge the gaps along the
 * child's own rotation axis only.
 */
export const SHELLS = {
  A: [322, 421],
  B: [259, 308],
  C: [196, 222],
  D: [146, 164],
  E: [105.9, 122],
  F: [61.5, 88],
  S: [0, 58],
  belt: [437, 482],
};

const MATS = ['stone', 'glyph', 'bronze', 'dark', 'marble', 'moss', 'glow'];

function createMaterials(ctx) {
  const M = ctx.materials;
  return {
    stone: M.create('stone', { local: true, color: '#c2b39c', blocks: [6.5, 2.9], mortar: 0.1, grooveDepth: 0.12, macroScale: 70, variation: 0.38, streaks: 0.75 }),
    glyph: M.create('glyphStone', {
      local: true,
      color: '#3f3a35',
      blocks: [5.2, 2.4],
      glyphs: { cell: 2.1, band: 400, height: 400, intensity: 1.25, color: '#ffb35c' },
    }),
    bronze: M.create('bronze', { local: true }),
    dark: M.create('basalt', { local: true, blocks: [7.5, 3.2], macroScale: 70 }),
    marble: M.create('marble', { local: true, blocks: [7, 3.2] }),
    moss: M.create('rock', { local: true, color: '#4b5a2a', alt: '#65703a', moss: '#3a4a22', mossAmount: 1.0, streaks: 0.2, bump: 1.6, variation: 0.5 }),
    glow: ctx.materials.glow('#ffb061', { day: 0.22, night: 5.5, flicker: 0.12 }),
  };
}

export async function build(ctx, site) {
  const t0 = performance.now();
  const rng = ctx.noise.createRng('orrery');
  const cx = site.x;
  const cz = site.z;
  const g = (x, z) => ctx.heightAt(cx + x, cz + z);
  const floorY = g(0, 0);
  const cy = floorY + HOVER;

  // --- orientation of the two free rings -------------------------------------------------
  const qA = new THREE.Quaternion().setFromEuler(new THREE.Euler(SPEC.A.tilt, SPEC.A.yaw, 0, 'YXZ'));
  const qB = new THREE.Quaternion().setFromEuler(new THREE.Euler(SPEC.B.tilt, SPEC.B.yaw, 0, 'YXZ'));
  const nA = new THREE.Vector3(0, 1, 0).applyQuaternion(qA);
  const nB = new THREE.Vector3(0, 1, 0).applyQuaternion(qB);

  // --- sinks per moving object + the static floor ---------------------------------------
  const OBJ = ['A', 'B', 'C', 'D', 'E', 'F', 'S', 'belt', 'floor'];
  const sinks = {};
  for (const o of OBJ) {
    sinks[o] = {};
    for (const m of MATS) sinks[o][m] = new Mesh3(2048);
  }

  const armsA = buildRingA(sinks.A, SPEC.A, ctx.noise.createRng('orrery-A')).arms;
  buildRingB(sinks.B, SPEC.B, ctx.noise.createRng('orrery-B'));
  buildRingC(sinks.C, SPEC.C, ctx.noise.createRng('orrery-C'));
  await nextFrame();
  buildRingD(sinks.D, SPEC.D);
  buildRingE(sinks.E, SPEC.E);
  buildRingF(sinks.F, SPEC.F);
  buildSphere(sinks.S, RS, ctx.noise.createRng('orrery-S'), ctx.noise.worldNoise);
  buildBelt(sinks.belt, SPEC.belt, ctx.noise.createRng('orrery-belt'));
  await nextFrame();

  // --- clearance under the swept volumes (for tall things on the floor) --------------------
  // A and B keep their shape while spinning, so their swept volume is a solid of revolution about
  // their fixed normals: test against (rho, h) discs. The gimbal chain can take any pose: a ball.
  const attachA = [[SPEC.A.R, 0, 18]];
  for (const arm of armsA) {
    const p = arm.pc;
    attachA.push([Math.hypot(p[0], p[2]), p[1], arm.reach - Math.hypot(p[0], p[1], p[2]) + 4]);
  }
  const attachB = [[SPEC.B.R, 0, 15], [SPEC.B.R + 30, 0, 11], [SPEC.B.R - 3, -22, 9]];
  const _d = new THREE.Vector3();
  const sweptDist = (n, attach, x, y, z) => {
    _d.set(x, y - cy, z);
    const h = _d.dot(n);
    const rho = Math.sqrt(Math.max(0, _d.lengthSq() - h * h));
    let best = Infinity;
    for (const [r0, h0, rad] of attach) best = Math.min(best, Math.hypot(rho - r0, h - h0) - rad);
    return best;
  };
  const clearance = (x, y, z) => {
    const dChain = Math.hypot(x, y - cy, z) - SHELLS.C[1];
    const dBelt = Math.hypot(Math.hypot(x, z) - SPEC.belt.R, y - cy - SPEC.belt.lift) - 28;
    return Math.min(dChain, dBelt, sweptDist(nA, attachA, x, y, z), sweptDist(nB, attachB, x, y, z));
  };

  const floorInfo = buildFloor(sinks.floor, { g, rng, clearance });
  await nextFrame();

  // --- one BatchedMesh per material -------------------------------------------------------
  const mats = createMaterials(ctx);
  const root = new THREE.Group();
  root.name = 'landmark:orrery';
  root.position.set(cx, 0, cz);
  const batches = []; // { mesh, ids: {obj: instanceId} }
  let tris = 0;
  for (const m of MATS) {
    const geos = [];
    let nv = 0;
    let ni = 0;
    for (const o of OBJ) {
      const s = sinks[o][m];
      if (!s.ni) continue;
      const geo = s.toGeometry();
      geos.push([o, geo]);
      nv += s.nv;
      ni += s.ni;
      tris += s.ni / 3;
    }
    if (!geos.length) continue;
    const mesh = new THREE.BatchedMesh(geos.length, nv, ni, mats[m]);
    mesh.name = `orrery:${m}`;
    mesh.castShadow = m !== 'glow';
    mesh.receiveShadow = m !== 'glow';
    mesh.sortObjects = false;
    const ids = {};
    for (const [o, geo] of geos) {
      const gid = mesh.addGeometry(geo);
      ids[o] = mesh.addInstance(gid);
      geo.dispose();
    }
    // whole-mechanism bound (the instances move; never let the batch be culled wrongly)
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, cy - 60, 0), 660);
    root.add(mesh);
    batches.push({ mesh, ids });
  }
  for (const o of OBJ) for (const m of MATS) sinks[o][m] = null;
  ctx.scene.add(root);

  // --- animation ------------------------------------------------------------------------------
  const W = {};
  for (const o of OBJ) W[o] = new THREE.Matrix4();
  W.floor.identity();
  const T = new THREE.Matrix4().makeTranslation(0, cy, 0);
  const TB = new THREE.Matrix4().makeTranslation(0, cy + SPEC.belt.lift, 0);
  const MA0 = new THREE.Matrix4().multiplyMatrices(T, new THREE.Matrix4().makeRotationFromQuaternion(qA));
  const MB0 = new THREE.Matrix4().multiplyMatrices(T, new THREE.Matrix4().makeRotationFromQuaternion(qB));
  const RY90 = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const _r = new THREE.Matrix4();
  const ang = (s, t) => s.phase + (TAU * t) / s.period;

  // flat (mesh, instance, matrix) list so the per-frame update allocates nothing
  const slots = [];
  for (const b of batches) for (const o of Object.keys(b.ids)) slots.push({ mesh: b.mesh, id: b.ids[o], m: W[o] });

  const pose = (t) => {
    W.A.multiplyMatrices(MA0, _r.makeRotationY(ang(SPEC.A, t)));
    W.B.multiplyMatrices(MB0, _r.makeRotationY(ang(SPEC.B, t)));
    W.belt.multiplyMatrices(TB, _r.makeRotationY(ang(SPEC.belt, t)));
    W.C.multiplyMatrices(W.B, _r.makeRotationX(ang(SPEC.C, t)));
    W.D.multiplyMatrices(W.C, RY90).multiply(_r.makeRotationX(ang(SPEC.D, t)));
    W.E.multiplyMatrices(W.D, RY90).multiply(_r.makeRotationX(ang(SPEC.E, t)));
    W.F.multiplyMatrices(W.E, RY90).multiply(_r.makeRotationX(ang(SPEC.F, t)));
    W.S.multiplyMatrices(W.F, RY90).multiply(_r.makeRotationX(ang(SPEC.S, t)));
    for (let i = 0; i < slots.length; i++) slots[i].mesh.setMatrixAt(slots[i].id, slots[i].m);
  };
  pose(0);

  // --- viewpoints --------------------------------------------------------------------------
  const V = (x, y, z) => [cx + x, y, cz + z];
  const tr = floorInfo.treads[Math.floor(floorInfo.treads.length * 0.55)];
  const gate = floorInfo.gate;
  const sd = floorInfo.stairDir;
  const py = floorInfo.pylons[0];
  const viewpoints = [
    // from the open basin to the north-east: the gyroscope above the crater rim, mountains behind
    { pos: V(900, g(900, -900) + 270, -900), look: V(0, cy - 40, 0), label: 'establishing' },
    // from the western heights at golden hour: front-lit, the crater floor in the rim's shadow
    { pos: V(-1250, g(-1250, -420) + 230, -420), look: V(0, cy - 60, 0), label: 'establishing-west' },
    // behind the rim gate at the head of the stair, the orrery framed between its monoliths
    { pos: [cx + gate[0] + Math.cos(sd) * 55, gate[1] + 24, cz + gate[2] + Math.sin(sd) * 55], look: V(0, cy - 40, 0), label: 'approach' },
    // from the floor, under the Meridian, into the low sun: the rings in silhouette
    { pos: V(140, floorY + 9, -40), look: V(-160, cy - 30, 40), label: 'dramatic' },
    // beside the snapped pillar on the dial-dais, looking up through the gimbals at the sphere
    { pos: V(58, floorY + 8, 30), look: V(0, cy, 0), label: 'dramatic-up' },
    // on the processional stair, mid-flight, looking down it into the crater
    { pos: V(tr[0], tr[1] + 3.2, tr[2]), look: V(tr[0] * 0.2, floorY + 120, tr[2] * 0.2), label: 'intimate' },
    // on the dial-dais beside the snapped pillar and its fallen drums
    { pos: V(44, floorY + 7.5, 40), look: V(0, floorY + 60, 0), label: 'intimate-dais' },
    // at the foot of a cradle pylon, its empty saddle against the turning rings
    { pos: V(py.x * 0.84 + 12, py.gy + 6, py.z * 0.84), look: V(py.x, py.gy + py.H * 0.8, py.z), label: 'dramatic-pylon' },
  ];

  ctx.orrery = { SPEC, SHELLS, center: [cx, cy, cz], clearance, pose };
  const ms = Math.round(performance.now() - t0);
  if (ctx.params?.debug) console.log(`[orrery] built in ${ms} ms, ${Math.round(tris)} tris, ${batches.length} batches`);

  return {
    object: root,
    viewpoints,
    update(dt, t) {
      pose(t);
    },
  };
}
