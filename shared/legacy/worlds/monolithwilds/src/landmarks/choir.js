// THE CHOIR OF MONOLITHS — "When the wind crosses the plain, the stones answer."
//
// ~500 black obsidian monoliths on the western plain in five choir rows along a spiral band, all
// turned toward a centre, growing from ~6 m at the band's outer end to ~100 m at the inner ring.
// Each row stands on a low basalt stall; each stone on a pale limestone plinth. The stones are
// knapped blades (a shallow ridge down each broad face), many pierced by a slit or a long cut
// (the mouths the wind sings through), all inscribed just under the crown. A paved path spirals
// 1.5 turns inward, half a turn out of phase with the band, to a stepped amphitheatre gated toward
// the sunset, over which a 185 m monolith hovers, turning once every half hour; the sun sets
// through the slit in its heart. Some stones float and turn above their plinths, some lean
// together in pairs, some are split, sunk or fallen; a few plinths stand empty. At night the
// glyphs pulse in slow waves travelling outward from the giant.
//
// Files: choir-plan.js (layout + fates), choir-stones.js (monoliths, plinths, giant),
// choir-ground.js (amphitheatre, path, stalls), choir-mesh.js (geometry kernel),
// choir-mats.js (glyph wave + vertex-animated floaters).
//
// Draw calls: 6 (standing obsidian, moving obsidian, dead obsidian, limestone, basalt, glow).

import * as THREE from 'crownfall-world-three';
import { Mesher } from './choir-mesh.js';
import { choirGlyphMaterial, choirDepthMaterial } from './choir-mats.js';
import { makePlan } from './choir-plan.js';
import { buildStones } from './choir-stones.js';
import { buildAmphitheatre, buildPath, buildRibbons } from './choir-ground.js';
import { yieldToMain } from '../core/yield.js';

export async function build(ctx, site) {
  const t0 = performance.now();
  const rng = ctx.noise.createRng('choir');
  const mats = ctx.materials;

  const root = new THREE.Group();
  root.name = 'landmark:choir';
  root.position.set(site.x, 0, site.z);
  root.updateMatrixWorld(true);

  const plan = makePlan(ctx, site, rng);

  const K = {
    stones: new Mesher('stones'),
    float: new Mesher('float', { anim: true }),
    dead: new Mesher('dead'),
    stone: new Mesher('stone'),
    basalt: new Mesher('basalt'),
    glow: new Mesher('glow'),
  };
  const { stats, floaters } = buildStones(ctx, K, plan, rng);
  await yieldToMain();
  buildAmphitheatre(ctx, K, plan, rng);
  const pathInfo = buildPath(ctx, K, plan, rng);
  const ribbons = buildRibbons(ctx, K, plan, rng);

  const M = {
    stones: choirGlyphMaterial(ctx, { center: [site.x, site.z] }),
    float: choirGlyphMaterial(ctx, { local: true, anim: true, center: [0, 0] }),
    dead: mats.get('obsidian'),
    stone: mats.create('stone', { blocks: [2.8, 1.2], color: '#b7ab96', mossAmount: 0.6 }),
    basalt: mats.create('basalt', { blocks: [3.6, 1.2], mossAmount: 0.55 }),
    glow: mats.glow('#5fe6ff', { day: 0.12, night: 3.2 }),
  };
  let tris = 0;
  for (const k of Object.keys(K)) {
    tris += K[k].triangles;
    const glowy = k === 'glow';
    const mesh = K[k].toMesh(M[k], { castShadow: !glowy, receiveShadow: !glowy });
    if (!mesh) continue;
    if (k === 'float') {
      mesh.customDepthMaterial = choirDepthMaterial(M.float.userData.mwUniforms.uMwTime.value);
      mesh.geometry.boundingSphere.radius += 12;
    }
    mesh.updateMatrix();
    root.add(mesh);
  }
  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // --- viewpoints (world space) ---------------------------------------------------------------
  const cx = site.x, cz = site.z;
  const g0 = plan.amph.floorY;
  const W = (lx, y, lz) => [Math.round(cx + lx), Math.round(y), Math.round(cz + lz)];
  const free = (lx, lz, margin) => plan.stones.every((s) => Math.hypot(s.x - lx, s.z - lz) > s.foot + margin);
  const freeNear = (lx, lz, margin) => {
    for (let r = 0; r < 60; r += 3) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = lx + Math.cos(a) * r, z = lz + Math.sin(a) * r;
        if (free(x, z, margin)) return [x, z];
        if (r === 0) break;
      }
    }
    return [lx, lz];
  };
  const gAt = (lx, lz) => ctx.heightAt(cx + lx, cz + lz);
  // intimate: on the path, ~220 m out, looking inward past the stones to the giant
  let pi = plan.path.findIndex((p) => p.r > 225);
  if (pi < 0) pi = 0;
  const pp = plan.path[pi];
  // backlit: low among the eastern stones, looking west through them into the setting sun
  const [bx, bz] = freeNear(430, -30, 4);
  const [ax, az] = freeNear(330, 390, 6);
  const viewpoints = [
    { pos: [-1210, 290, 700], look: W(-10, g0 + 45, -20), label: 'establishing' },
    { pos: W(ax, gAt(ax, az) + 38, az), look: W(0, g0 + 70, 0), label: 'approach' },
    { pos: W(bx, gAt(bx, bz) + 9, bz), look: W(-320, g0 + 95, 12), label: 'dramatic', hour: 17.6 },
    { pos: W(150, g0 + 640, 360), look: W(0, g0, -10), label: 'spiral from above' },
    { pos: W(pp.x, gAt(pp.x, pp.z) + 1.7, pp.z), look: W(0, g0 + 110, 0), label: 'intimate' },
    { pos: W(-240, g0 + 75, 430), look: W(0, g0 + 60, 0), label: 'night', hour: 22 },
  ];

  const ms = performance.now() - t0;
  root.userData.stats = { ...stats, floaters: floaters.length, stones: plan.stones.length, tris, ms, path: pathInfo, ribbons };
  if (ctx.params?.debug) console.info('[choir]', JSON.stringify(root.userData.stats));

  return { object: root, viewpoints };
}
