// THE UNMOORED ISLES — pieces of the land that forgot the weight of the world.
//
// Eight rock islands hang 250–460 m over the eastern forest, stepping up into the sky from the
// tethered isle in the south-west (its chains still reach the forest floor) to a tiny rock in
// the north-east carrying nothing but a lonely arch. Each isle is an inverted mountain: a grassy
// cap with small cliffs, a ribbed underside narrowing to a long bent spike, roots and broken
// chains dangling far below, waterfalls dissolving into mist in mid-air. The mother isle holds a
// ruined sanctuary and a tower whose crown hovers above its own shaft; a ring of small rocks
// orbits it. Rope bridges stretch between drifting isles; a stone bridge has broken in two and
// its fragments hang frozen mid-fall.
//
// Motion: every vertex carries an isle slot (isles-geo.js). update() writes one matrix per slot
// (bob, drift, slight yaw/tilt; the orbit rings and the hovering crown ride on the mother isle),
// so the whole landmark stays one draw call per material.
//
// Files: isles-geo.js (accumulator, slot shader patch), isles-rock.js (bodies, boulders, orbit
// rocks), isles-arch.js (buildings, bridges, chains), isles-flora.js (trees, vines, roots),
// isles-water.js (falls, mist).

import * as THREE from 'crownfall-world-three';
import { createGlowMaterial } from '../core/materials.js';
import { IsleAcc, T, makeIsleUniform, patchIsleMaterial, makeIsleDepthMaterial } from './isles-geo.js';
import { makeShape, buildIsleBody, scatterBoulders, orbitRocks, ROCKS } from './isles-rock.js';
import { buildArchitecture, slotAll } from './isles-arch.js';
import { plantIsle, vines, roots } from './isles-flora.js';
import { buildWater } from './isles-water.js';
import { yieldToMain } from '../core/yield.js';

// Isle specs, root-local (site-relative) x/z, absolute top height (m). Pads are flattened
// building sites relative to the isle centre. Motion: bob amplitude (m) / period (s).
const ISLES = [
  {
    id: 'A', slot: 1, x: 0, z: 0, top: 340, rx: 114, rz: 84, rot: 0.35, cliff: 24, depth: 196, mound: 15, bumps: 2.0,
    taper: 1.75, drop: 1.0, ribs: 0.5, ribF: 5.5, flutes: 26, rough: 9, tipOff: [16, -12], na: 176, nt: 18, nu: 40, spikes: 5, seed: 1.3,
    pads: [{ x: 6, z: -4, r: 31, blend: 12, dh: 0.4 }, { x: 58, z: 20, r: 10, blend: 8 }, { x: -20, z: 44, r: 13, blend: 8 }],
    bob: 1.6, per: 92, drift: 1.2, yaw: 0.005, tilt: 0.0035,
    trees: 64, shrubs: 140, roots: 34, rootLen: 95, rootR: 1.3, vines: 60,
  },
  {
    id: 'B', slot: 2, x: -215, z: 110, top: 305, rx: 62, rz: 48, rot: -0.4, cliff: 16, depth: 112, mound: 5, bumps: 1.6,
    taper: 1.6, drop: 1.05, ribs: 0.55, ribF: 4.5, flutes: 18, rough: 6, tipOff: [-10, 8], na: 128, nt: 12, nu: 30, spikes: 3, seed: 2.7,
    pads: [{ x: 4, z: -2, r: 14, blend: 7 }],
    bob: 2.2, per: 71, drift: 1.4, yaw: 0.007, tilt: 0.005,
    trees: 24, shrubs: 60, roots: 18, rootLen: 70, rootR: 0.9, vines: 30,
  },
  {
    id: 'C', slot: 3, x: -340, z: 250, top: 250, rx: 44, rz: 38, rot: 0.9, cliff: 12, depth: 76, mound: 3, bumps: 1.2,
    taper: 1.5, drop: 1.0, ribs: 0.5, ribF: 4, flutes: 14, rough: 4, tipOff: [6, 6], na: 96, nt: 10, nu: 24, spikes: 2, seed: 3.9,
    pads: [{ x: 0, z: 0, r: 17, blend: 6 }],
    bob: 0.9, per: 58, drift: 0.5, yaw: 0.004, tilt: 0.004,
    trees: 8, shrubs: 26, roots: 10, rootLen: 50, rootR: 0.7, vines: 18,
  },
  {
    id: 'D', slot: 4, x: 185, z: 150, top: 400, rx: 46, rz: 38, rot: 1.2, cliff: 14, depth: 92, mound: 4, bumps: 1.2,
    taper: 1.8, drop: 1.0, ribs: 0.55, ribF: 4, flutes: 16, rough: 5, tipOff: [8, -6], na: 104, nt: 11, nu: 26, spikes: 2, seed: 5.2,
    pads: [{ x: 3, z: 3, r: 11, blend: 6 }],
    bob: 2.8, per: 64, drift: 1.5, yaw: 0.008, tilt: 0.006,
    trees: 12, shrubs: 34, roots: 12, rootLen: 60, rootR: 0.8, vines: 20,
  },
  {
    id: 'E', slot: 5, x: 310, z: -95, top: 458, rx: 24, rz: 19, rot: 0.3, cliff: 8, depth: 58, mound: 1.5, bumps: 0.6,
    taper: 1.6, drop: 1.0, ribs: 0.5, ribF: 3.5, flutes: 10, rough: 3, tipOff: [-4, 3], na: 72, nt: 8, nu: 20, spikes: 1, seed: 6.6,
    pads: [{ x: 0, z: 0, r: 9, blend: 4 }],
    bob: 3.2, per: 52, drift: 1.8, yaw: 0.01, tilt: 0.007,
    trees: 3, shrubs: 12, roots: 7, rootLen: 40, rootR: 0.5, vines: 8,
  },
  {
    id: 'F', slot: 6, x: -130, z: -200, top: 300, rx: 72, rz: 55, rot: -0.8, cliff: 18, depth: 122, mound: 13, bumps: 1.6,
    taper: 1.65, drop: 1.0, ribs: 0.5, ribF: 5, flutes: 20, rough: 6, tipOff: [12, 10], na: 136, nt: 13, nu: 32, spikes: 3, seed: 7.4,
    pads: [],
    bob: 2.0, per: 80, drift: 1.2, yaw: 0.006, tilt: 0.004,
    trees: 30, shrubs: 70, roots: 20, rootLen: 75, rootR: 1.0, vines: 34,
  },
  {
    id: 'G', slot: 7, x: 170, z: -265, top: 245, rx: 34, rz: 28, rot: 0.5, cliff: 10, depth: 62, mound: 3, bumps: 1.0,
    taper: 1.5, drop: 1.0, ribs: 0.5, ribF: 4, flutes: 12, rough: 4, tipOff: [5, -4], na: 88, nt: 9, nu: 22, spikes: 2, seed: 8.8,
    pads: [{ x: -8, z: 6, r: 6, blend: 4 }],
    bob: 2.6, per: 58, drift: 1.4, yaw: 0.008, tilt: 0.006,
    trees: 16, shrubs: 30, roots: 10, rootLen: 45, rootR: 0.6, vines: 14,
  },
  {
    id: 'H', slot: 8, x: 245, z: 30, top: 432, rx: 26, rz: 22, rot: -0.2, cliff: 8, depth: 52, mound: 2, bumps: 0.7,
    taper: 1.6, drop: 1.0, ribs: 0.5, ribF: 3.5, flutes: 10, rough: 3, tipOff: [3, 5], na: 72, nt: 8, nu: 20, spikes: 1, seed: 9.5,
    pads: [{ x: 2, z: -2, r: 7, blend: 4 }],
    bob: 3.0, per: 56, drift: 1.6, yaw: 0.01, tilt: 0.007,
    trees: 5, shrubs: 12, roots: 7, rootLen: 36, rootR: 0.5, vines: 8,
  },
];

const RING_SLOTS = [9, 10];
const CROWN_SLOT = 11;

export async function build(ctx, site) {
  const t0 = performance.now();
  const rng = ctx.noise.createRng('isles');
  const q = ctx.quality?.level === 'low' ? 0.65 : 1;

  const root = new THREE.Group();
  root.name = 'landmark:isles';
  root.position.set(site.x, 0, site.z);
  root.updateMatrixWorld(true);
  const groundAt = (x, z) => ctx.heightAt(site.x + x, site.z + z);

  // --- materials (object-space detail: the isles move) ------------------------------------------
  const U = makeIsleUniform();
  const depth = makeIsleDepthMaterial(U);
  const mk = (preset, o) => patchIsleMaterial(ctx.materials.create(preset, { ...o, local: true }), U);
  const M = {
    rock: mk('rock', { color: '#a08d77', alt: '#b89a78', moss: '#56652f', mossAmount: 0.4, streaks: 0.6, grime: 0.28, bump: 1.4, macroScale: 34, variation: 0.42 }),
    grass: mk('rock', { color: '#7a9450', alt: '#98a05c', moss: '#4f6e2e', mossAmount: 0.7, streaks: 0.05, grime: 0.25, bump: 0.7, macroScale: 20, variation: 0.5, fine: 1.4, rough: [0.85, 1] }),
    stone: mk('stone', { color: '#cbbea7', alt: '#dcc8ab', blocks: [2.3, 0.95], mortar: 0.05, grooveDepth: 0.06, mossAmount: 0.5 }),
    glyph: mk('glyphStone', { color: '#8f8577', alt: '#a89a86', blocks: [2.3, 0.95], mortar: 0.05, glyphs: { cell: 0.75, band: 1.25, height: 0.9, intensity: 2.4, color: '#5fe6ff' } }),
    wood: mk('rock', { color: '#6b5642', alt: '#54402f', moss: '#4d5a2b', mossAmount: 0.3, streaks: 0.35, grime: 0.5, bump: 0.9, macroScale: 8, variation: 0.4, fine: 1.4, rough: [0.75, 0.95] }),
    iron: mk('iron', {}),
    foliage: mk('rock', { color: '#56733a', alt: '#6f8440', moss: '#3f5c28', mossAmount: 0.35, streaks: 0, grime: 0.3, bump: 1.4, macroScale: 7, variation: 0.55, fine: 1.8, rough: [0.8, 1] }),
    water: mk('obsidian', { color: '#1d2e34', alt: '#283b42', moss: '#1d2e34', mossAmount: 0, streaks: 0, grime: 0, bump: 0.05, rough: [0.02, 0.07], variation: 0.1 }),
    glow: patchIsleMaterial(createGlowMaterial('#ffb35c', { day: 0.12, night: 5.0, flicker: 0.2 }), U),
    // keel stones: carved obsidian lodestones set into every isle's point — why they float
    keel: mk('obsidianGlyph', { glyphs: { cell: 0.8, band: 3.2, height: 1.1, intensity: 1.3, color: '#5fe6ff' }, mossAmount: 0.02 }),
  };
  const A = {};
  for (const k of Object.keys(M)) A[k] = new IsleAcc(k);

  // --- bodies ------------------------------------------------------------------------------------------
  const S = {};
  const bodies = {};
  for (const spec of ISLES) {
    const sh = makeShape({ ...spec, pads: spec.pads.map((p) => ({ ...p })) });
    S[spec.id] = sh;
    slotAll(A, spec.slot);
    bodies[spec.id] = buildIsleBody(sh, A.rock, A.grass, rng, q);
  }
  await yieldToMain();

  // --- architecture, bridges, chains ---------------------------------------------------------------------
  const out = { falls: [], anchors: [] };
  buildArchitecture(ctx, A, S, bodies, rng, groundAt, out);
  // keep bridge heads clear of trees
  for (const [a, b, key] of [['A', 'B', 'bridgeAB'], ['B', 'C', 'bridgeBC'], ['A', 'F', 'bridgeAF']]) {
    const [p0, p1] = out[key];
    S[a].reserve.push({ x: p0[0], z: p0[2], r: 8 });
    S[b].reserve.push({ x: p1[0], z: p1[2], r: 8 });
  }

  // --- life: trees, shrubs, vines, roots, boulders --------------------------------------------------------
  for (const spec of ISLES) {
    const sh = S[spec.id];
    const body = bodies[spec.id];
    slotAll(A, spec.slot);
    scatterBoulders(sh, A.rock, rng, Math.round(spec.shrubs * 0.2), 0.8, spec.id === 'A' || spec.id === 'F' ? 7 : 3.5);
    plantIsle(A, sh, rng, { trees: Math.round(spec.trees * q), shrubs: Math.round(spec.shrubs * q), scale: spec.id === 'E' || spec.id === 'H' ? 0.85 : 1.15 });
    vines(A, sh, body, rng, Math.round(spec.vines * q));
    roots(A, sh, body, rng, Math.round(spec.roots * q), spec.rootLen, spec.rootR, groundAt);
  }

  // --- keel stones at the points (obsidian bipyramids bound with iron, glyph bands) ----------
  for (const spec of ISLES) {
    const sh = S[spec.id];
    slotAll(A, spec.slot);
    const k = Math.sqrt(spec.rx / 60);
    const x = spec.x + spec.tipOff[0], z = spec.z + spec.tipOff[1];
    const h = 16 * k, r = 3.4 * k;
    const y = sh.yTip + h * 0.25;
    A.keel.put(T.cone6, x, y, z, r, h * 0.55, r, 0, 0.3, 0, 1);
    A.keel.put(T.cone6, x, y, z, r, h * 0.8, r, Math.PI, 0.3, 0, 1);
    A.iron.put(T.cyl6, x, y - 0.4 * k, z, r * 0.93, 0.8 * k, r * 0.93, 0, 0.3, 0, 0.7);
    for (const sp of bodies[spec.id].spikes) {
      if (rng() < 0.5) continue;
      const s2 = k * 0.45;
      A.keel.put(T.cone6, sp.x, sp.y + 6 * s2, sp.z, 2.4 * s2, 5 * s2, 2.4 * s2, 0, rng() * 3, 0, 1);
      A.keel.put(T.cone6, sp.x, sp.y + 6 * s2, sp.z, 2.4 * s2, 9 * s2, 2.4 * s2, Math.PI, rng() * 3, 0, 1);
    }
  }

  // --- orbiting rocks around the mother isle ---------------------------------------------------------------
  const cA = [ISLES[0].x, ISLES[0].top - 58, ISLES[0].z];
  A.rock.setSlot(RING_SLOTS[0]);
  orbitRocks(A.rock, cA[0], cA[1], cA[2], rng, Math.round(26 * q), 142, 170, 14, 1.6, 8);
  A.rock.setSlot(RING_SLOTS[1]);
  orbitRocks(A.rock, cA[0], cA[1] - 40, cA[2], rng, Math.round(16 * q), 138, 156, 10, 1.2, 5);
  // a few loose stones drifting near the other isles
  for (const spec of ISLES.slice(1)) {
    A.rock.setSlot(spec.slot);
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      const r = spec.rx * (1.25 + rng() * 0.5);
      const s = 1.5 + rng() * 3.5;
      A.rock.put(ROCKS[k + 1], spec.x + Math.cos(a) * r, spec.top - spec.cliff - 10 - rng() * 30, spec.z + Math.sin(a) * r, s, s * 0.7, s * 0.9, rng() * 3, rng() * 3, rng() * 3, 0.85);
    }
  }

  // fragments that did fall: boulders and a column drum lying in the forest below
  A.rock.setSlot(0);
  A.stone.setSlot(0);
  for (let k = 0; k < 9; k++) {
    const spec = ISLES[k % 4];
    const a = rng() * Math.PI * 2;
    const r = spec.rx * (0.2 + rng() * 0.9);
    const x = spec.x + Math.cos(a) * r, z = spec.z + Math.sin(a) * r;
    const s = 5 + rng() * 9;
    A.rock.put(ROCKS[k % 4], x, groundAt(x, z) + s * 0.2, z, s, s * 0.7, s * 0.85, rng(), rng() * 3, rng(), 0.8);
  }
  {
    const x = 30, z = 50;
    A.stone.put(T.col12, x, groundAt(x, z) + 0.7, z, 0.85, 2.2, 0.85, Math.PI / 2, 0.7, 0, 0.85);
    A.stone.put(T.col12, x + 4, groundAt(x + 4, z + 2) + 0.4, z + 2, 0.85, 2.2, 0.85, Math.PI / 2 + 0.2, 1.9, 0, 0.85);
  }

  await yieldToMain();

  // --- meshes ------------------------------------------------------------------------------------------------
  let tris = 0;
  for (const k of Object.keys(A)) {
    tris += A[k].triangles;
    const glowy = k === 'glow';
    const mesh = A[k].toMesh(M[k], { castShadow: !glowy && k !== 'water', receiveShadow: !glowy, depth });
    if (mesh) root.add(mesh);
  }

  // --- water ---------------------------------------------------------------------------------------------------
  const clouds = [];
  for (const spec of ISLES) {
    const n = Math.round((spec.rx / 20) * q) + 1;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = spec.rx * (0.35 + rng() * 0.6);
      const y = spec.top - spec.cliff - spec.depth * (0.25 + rng() * 0.45);
      clouds.push({ slot: spec.slot, x: spec.x + Math.cos(a) * r, y, z: spec.z + Math.sin(a) * r, size: spec.rx * (0.5 + rng() * 0.35), alpha: 0.1 + rng() * 0.08 });
    }
  }
  for (const h of out.halos) clouds.push({ slot: h.slot, x: h.x, y: h.y, z: h.z, size: h.size, alpha: -0.55 });
  const water = buildWater(ctx, U, rng, out.falls, clouds);
  for (const m of water.meshes) root.add(m);
  tris += water.triangles;

  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // --- motion --------------------------------------------------------------------------------------------------------
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _r = new THREE.Matrix4();
  const _t = new THREE.Matrix4();
  const TAU = Math.PI * 2;
  const motion = ISLES.map((s, i) => ({ slot: s.slot, c: [s.x, s.top, s.z], bob: s.bob, w: TAU / s.per, ph: i * 1.7 + 0.4, drift: s.drift, yaw: s.yaw, tilt: s.tilt }));
  // pivot matrix: T(c + d) * R * T(-c)
  const pivot = (m, cx, cy, cz, dx, dy, dz, rx, ry, rz) => {
    _e.set(rx, ry, rz, 'YXZ');
    m.makeRotationFromEuler(_e);
    _v.set(cx, cy, cz).applyMatrix4(m);
    m.setPosition(cx + dx - _v.x, cy + dy - _v.y, cz + dz - _v.z);
  };
  const crownC = out.crown;
  const setMotion = (t) => {
    for (const m of motion) {
      const w = m.w;
      const dy = m.bob * (Math.sin(t * w + m.ph) + 0.3 * Math.sin(t * w * 2.3 + m.ph * 2.1));
      const dx = m.drift * Math.sin(t * w * 0.6 + m.ph * 3.1);
      const dz = m.drift * Math.cos(t * w * 0.47 + m.ph * 5.3);
      const yaw = m.yaw * Math.sin(t * w * 0.38 + m.ph);
      const pitch = m.tilt * Math.sin(t * w * 0.8 + m.ph * 1.3);
      const roll = m.tilt * Math.cos(t * w * 0.9 + m.ph * 0.7);
      pivot(U.value[m.slot], m.c[0], m.c[1], m.c[2], dx, dy, dz, pitch, yaw, roll);
    }
    const MA = U.value[1];
    // orbit rings: tilted, counter-rotating, riding on the mother isle
    pivot(_t, cA[0], cA[1], cA[2], 0, 0, 0, 0.13, (t * TAU) / 1100, 0.05);
    U.value[RING_SLOTS[0]].multiplyMatrices(MA, _t);
    pivot(_t, cA[0], cA[1] - 40, cA[2], 0, 0, 0, -0.1, (-t * TAU) / 760 + 1.3, -0.07);
    U.value[RING_SLOTS[1]].multiplyMatrices(MA, _t);
    // the hovering crown: slow turn about the tower axis + a breath up and down
    pivot(_r, crownC[0], crownC[1], crownC[2], 0, 0.9 * Math.sin((t * TAU) / 23), 0, 0.012 * Math.sin((t * TAU) / 31), (t * TAU) / 400, 0.012 * Math.cos((t * TAU) / 37));
    U.value[CROWN_SLOT].multiplyMatrices(MA, _r);
  };
  setMotion(0);

  // --- viewpoints (world space) ------------------------------------------------------------------------------------
  const W = (x, y, z) => [Math.round(site.x + x), Math.round(y), Math.round(site.z + z)];
  const tA = out.templeA;
  const tb = S.B.spec.pads[0];
  const [, bB] = out.bridgeAB;
  // intimate: on the broken tholos' isle, the rope bridge leading the eye up to the sanctuary
  const ix = tb.ax + (bB[0] - tb.ax) * 0.55, iz = tb.az + (bB[2] - tb.az) * 0.55;
  const viewpoints = [
    { label: 'establishing', pos: [1320, 390, 610], look: W(-10, 290, -10) },
    { label: 'approach', pos: W(-470, 330, -300), look: W(0, 318, 0) },
    { label: 'dramatic', pos: W(-280, 150, 200), look: W(0, 250, 0) },
    { label: 'intimate', pos: W(ix, S.B.topAt(ix, iz) + 7.5, iz), look: W(tA.F.x, tA.F.y + 16, tA.F.z) },
    { label: 'backlit', pos: W(420, 470, -240), look: W(out.lookTower[0], out.lookTower[1] - 10, out.lookTower[2]) },
    { label: 'north', pos: W(-60, 330, -420), look: W(-60, 300, -90) },
    { label: 'night', pos: W(-300, 380, -150), look: W(0, 330, 0), hour: 22 },
  ];

  const ms = performance.now() - t0;
  if (ctx.params.debug) console.log(`[isles] build ${ms.toFixed(0)} ms, ~${Math.round(tris / 1000)}k tris, meshes ${root.children.length}`);
  if (typeof window !== 'undefined' && window.__MW) window.__MW.isles = { tris, ms: Math.round(ms), meshes: root.children.length, out };

  return {
    object: root,
    viewpoints,
    update(dt, t) {
      setMotion(t);
    },
  };
}
