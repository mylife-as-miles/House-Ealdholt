// THE DESCENDING TEMPLE — an inverted stepped ziggurat balanced on its tip on the mesa.
//
// "Built from the sky downward. It stopped one step short of the earth."
// Sixteen terraces widen upward from a 3.5 m point to a ~300 m plaza ~330 m above the mesa;
// the tip hovers one step above its plinth. The whole mass leans ~2° toward the lake. Waterfalls
// pour off the plaza rim and dissolve into mist long before they reach the ground.
//
// Files: temple-geo.js (accumulator), temple-tiers.js (terraces), temple-crown.js (plaza, spire),
// temple-base.js (plinth, pool, ruins, path, cliff stair), temple-garden.js (trees, vines),
// temple-water.js (falls, mist, pools).

import * as THREE from 'crownfall-world-three';
import { Acc, frustumTemplate } from './temple-geo.js';
import { makeTiers, buildTiers } from './temple-tiers.js';
import { buildCrown } from './temple-crown.js';
import { buildBase } from './temple-base.js';
import { buildGardens } from './temple-garden.js';
import { buildWater } from './temple-water.js';
import { yieldToMain } from '../core/yield.js';

const TILT_DEG = 2.1;

export async function build(ctx, site) {
  const t0 = performance.now();
  // debug-only: ?tskip=garden,water,falls,mist,shadow to bisect costs in the screenshot harness
  const tskip = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tskip')) || '';
  const rng = ctx.noise.createRng('temple');
  const mats = ctx.materials;

  const root = new THREE.Group();
  root.name = 'landmark:temple';
  root.position.set(site.x, 0, site.z);
  root.rotation.y = site.facing;
  root.updateMatrixWorld(true);

  const cf = Math.cos(site.facing), sf = Math.sin(site.facing);
  const toWorld = (lx, lz) => [site.x + lx * cf + lz * sf, site.z - lx * sf + lz * cf];
  const groundAt = (lx, lz) => {
    const [x, z] = toWorld(lx, lz);
    return ctx.heightAt(x, z);
  };

  const M = {
    stone: mats.get('stone'),
    plaster: mats.get('plaster'),
    terra: mats.get('terracotta'),
    glyph: mats.get('glyphStone'),
    gold: mats.get('gold'),
    bronze: mats.get('bronze'),
    glow: mats.glow('#ffb35c', { day: 0.05, night: 5.5, flicker: 0.15 }),
    tip: mats.glow('#ffe7c2', { day: 1.4, night: 9.0 }),
    // night-only warm light on the coffered soffits (additive, invisible by day)
    ember: mats.glow('#d9743a', { day: 0.0, night: 0.34, transparent: true }),
  };
  M.ember.blending = THREE.AdditiveBlending;
  M.ember.depthWrite = false;
  M.ember.fog = false;
  const A = {};
  for (const k of Object.keys(M)) A[k] = new Acc(k);

  // --- vertical plan ---------------------------------------------------------------------
  let gMin = Infinity;
  for (let x = -24; x <= 24; x += 6) for (let z = -24; z <= 24; z += 6) gMin = Math.min(gMin, groundAt(x, z));
  // the reflecting pool is a raised basin; its water level is set by the highest ground under it
  let poolG = -Infinity;
  for (let x = -92; x <= 92; x += 8) {
    for (let z = -92; z <= 92; z += 8) if (Math.max(Math.abs(x), Math.abs(z)) >= 27) poolG = Math.max(poolG, groundAt(x, z));
  }
  const daisTop = Math.max(gMin + 1.6, poolG + 0.35 + 1.45);
  const plinthTop = daisTop + 10.5;
  const gap = 1.2; // one step short of the earth
  const tipY = plinthTop + gap;
  const tipH = 9;
  const tiers = makeTiers(tipY + tipH);

  const out = { trees: [], plazaTrees: [], lamps: [], falls: [], fallenPendants: [], waterQuads: [] };

  // --- the tilted mass --------------------------------------------------------------------
  const axisW = new THREE.Vector3(-1, 0, 0); // world axis: top leans north (toward the lake)
  const axisL = axisW.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -site.facing).normalize();
  const tilt = new THREE.Matrix4()
    .makeTranslation(0, tipY, 0)
    .multiply(new THREE.Matrix4().makeRotationAxis(axisL, THREE.MathUtils.degToRad(TILT_DEG)))
    .multiply(new THREE.Matrix4().makeTranslation(0, -tipY, 0));
  for (const k in A) A[k].setFrame(tilt);

  // the tip: inverted frustum from a 3.5 m point up to tier 0
  const tipW = 3.5;
  A.stone.put(frustumTemplate(tiers[0].W / tipW), 0, tipY, 0, tipW, tipH, tipW, 0, [1.08, 1.04, 0.97]);
  A.gold.put(frustumTemplate(1.12), 0, tipY + tipH * 0.42, 0, tipW + (tiers[0].W - tipW) * 0.42 + 0.3, 0.7, tipW + (tiers[0].W - tipW) * 0.42 + 0.3, 0, 1);
  // light leaks from the underside of the point, across the one-step gap
  A.tip.box(0, tipY + 0.04, 0, tipW * 0.92, 0.08, tipW * 0.92, 0, 0.55);

  buildTiers(ctx, A, tiers, rng, out);
  buildCrown(ctx, A, tiers, rng, out);
  const gardenPieces = buildGardens(ctx, A, tiers, rng, out, tilt);

  // tilted points (lamps, falls, trees) -> site-local
  const _v = new THREE.Vector3();
  const tiltPoint = (p) => {
    _v.set(p.x, p.y, p.z).applyMatrix4(tilt);
    p.x = _v.x; p.y = _v.y; p.z = _v.z;
    return p;
  };
  out.lamps.forEach(tiltPoint);
  out.falls.forEach(tiltPoint);
  A.glow.setFrame(null);
  A.bronze.setFrame(null);
  for (const lamp of out.lamps) {
    A.bronze.box(lamp.x, lamp.y + lamp.s * 0.9, lamp.z, lamp.s * 0.9, lamp.s * 0.3, lamp.s * 0.9, 0, 1);
    A.glow.box(lamp.x, lamp.y, lamp.z, lamp.s * 0.6, lamp.s * 1.3, lamp.s * 0.6, Math.PI / 4, 1.2);
  }

  // --- untilted: plinth, pool, ruins, path, cliff stair ------------------------------------
  for (const k in A) A[k].setFrame(null);
  const base = buildBase(ctx, A, { site, tiers, rng, groundAt, toWorld, daisTop, plinthTop, gMin, out });

  await yieldToMain();

  // --- meshes --------------------------------------------------------------------------------
  let tris = 0;
  for (const k in A) {
    tris += A[k].triangles;
    const glowy = k === 'glow' || k === 'tip' || k === 'ember';
    const mesh = A[k].toMesh(M[k], { castShadow: !glowy, receiveShadow: !glowy });
    if (mesh) {
      if (k === 'ember') mesh.renderOrder = 1;
      root.add(mesh);
    }
  }
  if (!tskip.includes('garden')) for (const m of gardenPieces.meshes) root.add(m);
  tris += gardenPieces.triangles;

  const reflect = tskip.includes('refl') ? [] : ['temple:stone', 'temple:plaster', 'temple:glow', 'temple:tip', 'temple:gold'];
  const water = buildWater(ctx, { root, tilt, out, base, rng, tiers, reflect });
  tris += water.triangles;

  if (tskip.includes('shadow')) root.traverse((o) => { o.castShadow = false; });
  if (tskip.includes('water')) for (const n of ['temple:falls', 'temple:mist', 'temple:pools']) root.remove(root.getObjectByName(n));
  if (tskip.includes('mist')) root.remove(root.getObjectByName('temple:mist'));
  if (tskip.includes('falls')) root.remove(root.getObjectByName('temple:falls'));
  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // --- viewpoints (world space) ---------------------------------------------------------------
  const gy = gMin;
  const topY = out.plazaY;
  const midY = (tiers[6].yb + topY) / 2;
  const W = (lx, y, lz) => {
    const [x, z] = toWorld(lx, lz);
    return [Math.round(x), Math.round(y), Math.round(z)];
  };
  const viewpoints = [
    { label: 'establishing', pos: [-1560, 340, 498], look: [site.x, midY - 40, site.z] },
    { label: 'approach', pos: W(-520, gy + 40, -170), look: W(0, midY + 10, 0) },
    { label: 'dramatic', pos: [site.x + 860, 150, site.z + 40], look: [site.x, topY - 90, site.z] },
    { label: 'plains', pos: [-980, 98, 640], look: [site.x, midY - 20, site.z] },
    { label: 'intimate', pos: W(-44, base.poolY + 2.3, 1.5), look: W(0, plinthTop + 12, 0) },
    { label: 'beneath', pos: W(-62, base.poolY + 2.2, 38), look: W(20, plinthTop + 150, -18) },
    { label: 'reflection', pos: W(-86, base.poolY + 1.4, 64), look: W(0, base.poolY + 26, 0) },
  ];

  if (ctx.params.debug) {
    console.log(`[temple] build ${(performance.now() - t0).toFixed(0)} ms, ~${Math.round(tris / 1000)}k tris, meshes ${root.children.length}`);
  }
  if (typeof window !== 'undefined' && window.__MW) (window.__MW.temple = { tris, ms: Math.round(performance.now() - t0), meshes: root.children.length, tiers, plazaY: topY });

  return {
    object: root,
    viewpoints,
    update: water.update,
    order: 50, // after the camera controls
  };
}
