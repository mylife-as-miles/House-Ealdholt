// THE DROWNED OBSERVATORY — a 240 m ribbed dome that tipped ~20° as the ground under the lake
// subsided, half-sunk and cracked open, its colossal telescope slid in its fork and now thrusting
// out of the observation slot toward the north-western sky, snapped at the end; the lost end lies
// in the shallows. Around it the level precinct — a ring gallery whose arches spring at the
// waterline, a ring of colossal columns — stands in the lake as it always did.
//
// Files: observatory-sink.js (geometry sink), observatory-dome.js (dome, drum, interior),
// observatory-scope.js (telescope + armillary + cables), observatory-rings.js (gallery, columns,
// bridges, fragments, rubble), observatory-flora.js (trees + vines).
//
// Composition: the dome leans ESE while the instrument points NW — two counter-diagonals, read in
// profile from the south-west (where the player arrives) and backlit from the east at golden hour.

import * as THREE from 'crownfall-world-three';
import { Sink } from './observatory-sink.js';
import { buildDome } from './observatory-dome.js';
import { buildScope, SCOPE } from './observatory-scope.js';
import { buildRings } from './observatory-rings.js';
import { buildFlora } from './observatory-flora.js';
import { yieldToMain as yieldFrame } from '../core/yield.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// the dome
const R = 118;
const OY = -6; // centre of the spring circle (below the lake surface)
const TILT = 20 * DEG;
const TILT_DIR = new THREE.Vector3(0.83, 0, 0.56).normalize(); // the crown leans ESE
const DRUM_H = 30;
// the instrument
const SCOPE_ELEV = 36 * DEG;
const SCOPE_DIR_H = new THREE.Vector3(-0.74, 0, -0.67).normalize(); // points NW
const PIVOT_H = 34; // on the dome axis, dome-local

export async function build(ctx, site) {
  const t0 = performance.now();
  const mats = ctx.materials;
  const runeLocal = mats.create('obsidianGlyph', {
    local: true,
    glyphs: { cell: 1.35, band: 3.4, height: 3.8, intensity: 1.1, color: '#5fe6ff' },
  });
  const M = {
    shell: mats.get('marble'),
    rib: mats.get('bronze'),
    base: mats.get('basalt'),
    stone: mats.get('stone'),
    glyph: mats.get('glyphStone'),
    leaf: mats.get('rock'),
    cable: mats.get('iron'),
    lamp: mats.glow('#ffb35c', { day: 0.12, night: 5.5, flicker: 0.25 }),
    lens: mats.glow('#5fe6ff', { day: 0.2, night: 3.4 }),
    runeLocal,
    runeStatic: runeLocal,
  };
  M.marbleCol = M.shell;
  M.bark = M.base;

  const root = new THREE.Group();
  root.name = 'landmark:observatory';
  root.position.set(site.x, 0, site.z);

  // ---------------------------------------------------------------- frames
  const axis = new THREE.Vector3().crossVectors(UP, TILT_DIR).normalize();
  const rot = new THREE.Matrix4().makeRotationAxis(axis, TILT);
  const frame = new THREE.Matrix4().makeTranslation(0, OY, 0).multiply(rot);
  const qInv = new THREE.Quaternion().setFromRotationMatrix(rot).invert();
  const e = frame.elements;
  const wy = (v) => e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
  const toSite = (v) => v.clone().applyMatrix4(frame);
  const toLocalDir = (v) => v.clone().applyQuaternion(qInv);

  const dir = new THREE.Vector3(SCOPE_DIR_H.x * Math.cos(SCOPE_ELEV), Math.sin(SCOPE_ELEV), SCOPE_DIR_H.z * Math.cos(SCOPE_ELEV)).normalize();
  const dl = toLocalDir(dir);
  const slotAz = Math.atan2(dl.z, dl.x);
  const P = new THREE.Vector3(0, PIVOT_H, 0);
  const pd = P.dot(dl);
  const tExit = -pd + Math.sqrt(pd * pd - (P.lengthSq() - (R + 2) ** 2));
  const exitL = P.clone().addScaledVector(dl, tExit);
  const uS = new THREE.Vector3(Math.cos(slotAz), 0, Math.sin(slotAz));
  const nG = new THREE.Vector3(-Math.sin(slotAz), 0, Math.cos(slotAz));
  const alphaExit = Math.atan2(exitL.y, exitL.dot(uS));
  const slot = { az: slotAz, w: 34, alphaMax: 128 * DEG, clearA0: alphaExit - 0.17, clearA1: alphaExit + 0.17 };

  // breaches, given as world directions (azimuth measured from +x toward +z, elevation) -> local
  const fdir = new THREE.Vector3(Math.sin(site.facing), 0, Math.cos(site.facing)); // SSW
  const wdir = (h, el) => new THREE.Vector3(h.x * Math.cos(el), Math.sin(el), h.z * Math.cos(el)).normalize();
  const rotH = (h, a) => new THREE.Vector3(h.x * Math.cos(a) - h.z * Math.sin(a), 0, h.x * Math.sin(a) + h.z * Math.cos(a));
  const breaches = [
    { dir: toLocalDir(wdir(fdir, 36 * DEG)), rad: 0.32, seed: 1.7, hanging: 7 },
    { dir: toLocalDir(wdir(rotH(fdir, -1.9), 24 * DEG)), rad: 0.17, seed: 5.3, hanging: 3 },
    { dir: toLocalDir(wdir(rotH(fdir, 2.3), 60 * DEG)), rad: 0.13, seed: 9.1, hanging: 2 },
    { dir: toLocalDir(wdir(rotH(fdir, 0.95), 16 * DEG)), rad: 0.1, seed: 3.3, hanging: 1 },
  ];

  const F = {
    site,
    R,
    drumH: DRUM_H,
    frame,
    wy,
    slot,
    breaches,
    pierTop: PIVOT_H - 21,
  };

  const S = new Sink();

  // ---------------------------------------------------------------- dome
  const T = [performance.now()];
  const domeA = buildDome(ctx, S, M, F);
  T.push(performance.now());
  await yieldFrame();

  // ---------------------------------------------------------------- instrument
  const pivot = toSite(P);
  // stays from high on the slot rails to the upper side of the tube
  const railPt = (side, alpha, r) => {
    const rr = Math.sqrt(r * r - (slot.w / 2) ** 2);
    return uS.clone().multiplyScalar(Math.cos(alpha) * rr).addScaledVector(UP, Math.sin(alpha) * rr).addScaledVector(nG, side * slot.w / 2);
  };
  const stayAnchors = [];
  for (const side of [-1, 1]) {
    stayAnchors.push({ p: toSite(railPt(side, alphaExit + 0.55, R + 7)), s: 196, th: Math.PI / 2 - side * 0.55 });
    stayAnchors.push({ p: toSite(railPt(side, alphaExit + 0.95, R + 7)), s: 140, th: Math.PI / 2 - side * 0.35 });
  }
  const breakSite = pivot.clone().addScaledVector(dir, SCOPE.breakS);
  const azNW = Math.atan2(breakSite.z, breakSite.x);
  const tang = new THREE.Vector3(-Math.sin(azNW), 0, Math.cos(azNW));
  const fallH = tang.clone().multiplyScalar(0.8).add(new THREE.Vector3(Math.cos(azNW), 0, Math.sin(azNW)).multiplyScalar(0.6)).normalize();
  const fallen = {
    pos: new THREE.Vector3(Math.cos(azNW + 0.1) * 184, -7, Math.sin(azNW + 0.1) * 184),
    dir: new THREE.Vector3(fallH.x * Math.cos(24 * DEG), Math.sin(24 * DEG), fallH.z * Math.cos(24 * DEG)),
  };
  T.push(performance.now());
  const scope = buildScope(ctx, S, M, { pivot, dir, exitS: tExit, stayAnchors, fallen });
  T.push(performance.now());
  // fork: from the pier top (tilted with the dome) up to the trunnions
  {
    const X = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const r0 = SCOPE.radius(0) + 5;
    S.setMatrix(new THREE.Matrix4());
    for (const side of [-1, 1]) {
      const tr = pivot.clone().addScaledVector(X, side * r0);
      const foot = toSite(new THREE.Vector3(0, F.pierTop, 0)).addScaledVector(X, side * (r0 - 3));
      S.beam(M.rib, foot, tr, new THREE.Vector3().crossVectors(X, tr.clone().sub(foot)).normalize(), 6, 4.5, 0.85);
    }
  }
  await yieldFrame();

  // ---------------------------------------------------------------- precinct
  const tiltAz = Math.atan2(TILT_DIR.z, TILT_DIR.x);
  // fragments of shell in the shallows: which cells (band j.., meridian i0..) and where they lie
  const frag = (azW, r, y, j, bands, cells, yaw, tilt, roll = 0) => ({
    i0: Math.floor((azW * 13.7) % 20) + 3, j, bands, cells, x: Math.cos(azW) * r, y, z: Math.sin(azW) * r, yaw, tilt, roll,
  });
  const fa = Math.atan2(fdir.z, fdir.x); // main breach azimuth
  const ringA = buildRings(ctx, S, M, {
    site,
    R,
    fragAz0: slotAz + (Math.PI * 2) / 80,
    collapseAz: [
      { az: azNW + 0.08, half: 0.2 },
      { az: fa + 0.9, half: 0.09 },
      { az: tiltAz + 0.3, half: 0.12 },
    ],
    bridgeAz: [fa - 0.25, fa + 1.5, fa - 1.6, fa + 3.3, fa + 4.4].filter((a) => Math.abs(((a - azNW + Math.PI * 5) % (Math.PI * 2)) - Math.PI) > 0.45),
    domeFoot: (a) => 121 + 9 * Math.max(0, -Math.cos(a - tiltAz)),
    fragments: [
      frag(fa - 0.18, 134, -1.2, 2, 1, 3, 0.6, 0.7),
      frag(fa + 0.22, 140, -2.2, 3, 2, 2, 2.1, 1.05, 0.3),
      frag(fa + 0.55, 131, -0.8, 1, 1, 2, 4.0, 0.45),
      frag(fa - 0.6, 138, -3.0, 4, 1, 3, 5.2, 1.3, -0.2),
      frag(fa + 1.3, 136, -1.5, 2, 1, 2, 1.2, -0.6),
      frag(fa - 1.35, 176, -2.5, 3, 1, 3, 3.1, 0.9),
      frag(fa + 0.05, 188, -1.8, 1, 2, 2, 0.2, 0.62, 0.4),
    ],
  });
  T.push(performance.now());
  await yieldFrame();

  // ---------------------------------------------------------------- flora + lamps
  const trees = [];
  for (const t of domeA.trees) trees.push({ p: toSite(t.p), s: t.s });
  for (const t of ringA.trees) trees.push(t);
  const vines = [];
  for (const v of domeA.vines) vines.push({ p: toSite(v.p), len: v.len });
  for (const v of ringA.vines) vines.push(v);
  for (const v of scope.anchors.vines) vines.push(v);
  T.push(performance.now());
  buildFlora(ctx, S, M, trees, vines);
  T.push(performance.now());

  S.setMatrix(new THREE.Matrix4());
  const lampAt = (p, s = 1.2) => {
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeScale(s, s * 1.5, s));
    S.box(M.lamp, m, 1);
  };
  for (const p of domeA.lamps) lampAt(toSite(p), 1.3);
  for (const p of domeA.railLamps) lampAt(toSite(p), 1.6);
  for (const p of ringA.lamps) lampAt(p, 1.1);
  for (const p of scope.anchors.lamps) lampAt(p, 1.4);

  const group = S.build('observatory');
  T.push(performance.now());
  root.add(group);
  root.add(scope.moving);
  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // ---------------------------------------------------------------- viewpoints (world space)
  const W = (x, y, z) => [site.x + x, y, site.z + z];
  const breakW = breakSite.clone();
  const viewpoints = [
    // from high over the south shore: dome side-lit by the western sun, Wardens and Loom beyond
    { pos: W(-10, 230, 970), look: W(0, 50, -30), label: 'establishing' },
    { pos: W(1320, 150, 380), look: W(-40, 80, -30), label: 'dramatic backlit' },
    { pos: W(-330, 36, 390), look: W(-10, 70, -20), label: 'approach' },
    { pos: W(235, 7, 175), look: W(breakW.x * 0.55, 120, breakW.z * 0.55), label: 'dramatic' },
    { pos: W(Math.cos(fa + 0.3) * 152, 18.2, Math.sin(fa + 0.3) * 152), look: W(Math.cos(fa) * 60, 58, Math.sin(fa) * 60), label: 'intimate' },
  ];

  const ms = performance.now() - t0;
  if (ctx.params?.debug) {
    const ph = T.slice(1).map((t, i) => (t - T[i]).toFixed(0)).join('/');
    console.info(`[observatory] built in ${ms.toFixed(0)} ms (dome/yield/scope/rings/yield/flora/merge ${ph}), ${S.tris} tris`);
  }

  return {
    object: root,
    viewpoints,
    update(dt) {
      scope.update(dt);
    },
  };
}
