// THE HONEYCOMB CLOISTER — ten thousand cells cut into the northern escarpment.
//
// "Ten thousand cells cut into the cliff, each facing the same unseen star."
//
// Construction logic
//   * A pointy-top hexagonal lattice of cells (R = 4.2 m) is hung on a smooth reference sheet that
//     stands a few metres proud of the real cliff (monastery-face.js fits it to the terrain).
//   * The core is one colossal hexagon (~325 m wide, ~375 m tall) whose bottom vertex hides behind
//     the portal. Inside it the cells' protrusion depth draws a two-armed hexagonal spiral that
//     swells toward the centre and plunges into the great oculus — a telescoping hexagonal shaft
//     with a bronze star at its end. The low evening sun rakes the relief from the west.
//   * Stair ribbons trace the core's slanted edges (from the portal up to the side vertices, and
//     from the upper vertices to the summit pavilion) and zig-zag up the wings in between.
//   * The wings are older, sparser colonies that thin out along the cliff, broken by two waterfall
//     channels (cells collapsed, rock exposed) and a collapse scar.
//   * A socle wall with a walk runs along the foot; a 70 m telescoping hex portal with bronze doors,
//     two stacked-drum towers, a grand stair and a hexagonal forecourt sit on its axis.
//   * Night: lanterns in scattered cells (the spiral's crests and the stair cells are lit more
//     often) + additive point sprites turn the cliff into a constellation.
//
// Files: monastery-geo.js (accumulator, hex helpers), monastery-face.js (cliff fit),
// monastery-cells.js (cell kit, layout, instancing), monastery-works.js (socle, portal, stairs,
// platforms, oculus, debris, vines), monastery-water.js (falls, basins, mist),
// monastery-lights.js (constellation sprites).

import * as THREE from 'crownfall-world-three';
import { Acc, hexDist, SQ3 } from './monastery-geo.js';
import { sampleFace } from './monastery-face.js';
import { makeCellKit, layoutCells, buildCellMeshes, cellPoint } from './monastery-cells.js';
import { buildSocle, buildPortal, buildApproach, stairRibbon, buildPlatform, buildOculus, buildDebris, buildVines, facePoint } from './monastery-works.js';
import { buildWater } from './monastery-water.js';
import { buildConstellation } from './monastery-lights.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


/** Distance from p to segment ab (2D). */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The master plan: every design decision in one place (face coordinates u = x - xc, y). */
function makePlan(ctx, site, face) {
  const N = ctx.noise.worldNoise;
  const xc = site.x;
  const R = ctx.profile === 'quest' ? 7.4 : 4.2;
  const ySocle = 98;
  // the great hexagon (bottom vertex hidden behind the portal)
  const Rg = 187.5;
  const yc = 264.5;
  const a = (Rg * SQ3) / 2;
  const V = [
    [0, yc - Rg], [a, yc - Rg / 2], [a, yc + Rg / 2], [0, yc + Rg], [-a, yc + Rg / 2], [-a, yc - Rg / 2],
  ];
  const portal = { frames: 5, w0: 11, dw: 3.3, h0: 30, dh: 2.4, a0: 47, da: 5.2, step: 3.2, zDoor: -4, towerGap: 14 };
  const portalHalf = portal.w0 + portal.dw * portal.frames; // outer half-width
  const portalApex = ySocle + portal.a0 + portal.da * portal.frames;
  const ySide = yc - Rg / 2; // side vertices (bottom)
  const yTopSide = yc + Rg / 2;

  // stair ribbons (u, y)
  const stairs = [
    // processional stairs from the socle walk up the lower edges of the great hexagon
    { pts: [[portalHalf + 10, ySocle], [a, ySide]], landingAtEnd: true },
    { pts: [[-(portalHalf + 10), ySocle], [-a, ySide]], landingAtEnd: true },
    // right wing: six short flights (tight zig-zag)
    { pts: [[a, ySide], [a + 54, ySide + 31.2], [a, ySide + 62.4], [a + 54, ySide + 93.6], [a, ySide + 124.8], [a + 54, ySide + 156], [a, yTopSide]] },
    // left wing: four long flights
    { pts: [[-a, ySide], [-a - 81, ySide + 46.75], [-a, ySide + 93.5], [-a - 81, ySide + 140.25], [-a, yTopSide]] },
    // upper edges to the summit
    { pts: [[a, yTopSide], [8, yc + Rg - 4.6]], landingAtStart: true },
    { pts: [[-a, yTopSide], [-8, yc + Rg - 4.6]], landingAtStart: true },
  ];
  // groove lines (cells along them are flush, with doors): the stairs + the core's vertical edges
  const grooves = [];
  for (const s of stairs) for (let i = 0; i < s.pts.length - 1; i++) grooves.push([s.pts[i], s.pts[i + 1], 6.2]);
  grooves.push([[a, ySide], [a, yTopSide], 3.0]);
  grooves.push([[-a, ySide], [-a, yTopSide], 3.0]);

  const falls = [
    { u: -272, ySrc: 392, w: 10, width: 7.5, v0: 3.2, seed: 1.7 },
    { u: 262, ySrc: 376, w: 10, width: 6.5, v0: 3.6, seed: 5.3 },
  ];
  const scars = [
    [[54, 170], [104, 238], 7],
    [[-118, 392], [-64, 360], 5.5],
  ];
  const oculus = { y: yc, r: 23, frames: 6, frontP: 20, backD: 5 };

  const P = {
    xc, R, ySocle, socleD: 7, Rg, yc, a, V, portal, portalHalf, portalApex, stairs, grooves, falls, scars, oculus,
    xs0: xc - 318, xs1: xc + 318,
    terraceD: 16,
  };

  P.inPortal = (x) => Math.abs(x - xc) < portalHalf + 3;
  P.inChannel = (x, y, margin = 0) => {
    for (const f of falls) {
      const w = f.w + 3 * N.noise2(y * 0.05, f.seed) + margin;
      if (Math.abs(x - (xc + f.u)) < w && y < f.ySrc + 3) return true;
    }
    return false;
  };
  P.wetness = (x, y) => {
    let w = 0;
    for (const f of falls) {
      const d = Math.abs(x - (xc + f.u));
      if (y < f.ySrc + 12) w = Math.max(w, smooth(34, 8, d));
    }
    return w;
  };
  // core-relative hex distance
  const coreHD = (u, v) => hexDist(u, v - yc, Rg);

  /** Presence 0..1: the core hexagon is solid; the wings are ragged colonies thinning outward. */
  P.member = (x, y) => {
    const u = x - xc;
    if (y < ySocle + R * 0.35) return 0;
    const hd = coreHD(u, y);
    if (hd < 1) return 1;
    const au = Math.abs(u);
    const side = u < 0 ? -1 : 1;
    // wing envelope: tops sag toward the ends of the colony, edges are eaten by noise
    const n = N.fbm2(x * 0.012, y * 0.012 + 3.3, 3);
    const wMax = (side < 0 ? 312 : 305) + 18 * N.noise2(y * 0.01, side * 4.1);
    const top = 438 - 90 * Math.pow(Math.max(0, (au - a) / (wMax - a)), 1.6) + 22 * N.noise2(x * 0.008, 1.3);
    const m = smooth(wMax, wMax - 70, au) * smooth(top, top - 26, y) * (0.82 + 0.45 * n);
    // the lowest band above the socle stays well populated
    return Math.min(1, m + (y < ySocle + 30 && au < wMax - 30 ? 0.35 : 0));
  };

  P.excluded = (x, y) => {
    const u = x - xc;
    // portal (and its towers' clearance)
    if (Math.abs(u) < portalHalf + R * 0.9 + portal.towerGap + 8 && y < ySocle + 60) return true;
    if (Math.abs(u) < portalHalf + R * 0.9) {
      const apexLine = ySocle + portal.h0 + portal.dh * portal.frames + (portalHalf - Math.abs(u)) * ((portal.a0 + portal.da * portal.frames - portal.h0 - portal.dh * portal.frames) / portalHalf);
      if (y < apexLine + R * 1.1) return true;
    }
    // the great oculus
    if (hexDist(u, y - oculus.y, oculus.r + R * 0.95) < 1) return true;
    if (P.inChannel(x, y)) return true;
    for (const [p0, p1, w] of scars) {
      const d = segDist(u, y, p0[0], p0[1], p1[0], p1[1]);
      if (d < w + 5 * N.noise2(x * 0.06, y * 0.06)) return true;
    }
    return false;
  };

  P.groove = (x, y) => {
    const u = x - xc;
    let g = 0;
    for (const [p0, p1, w] of grooves) {
      const d = segDist(u, y, p0[0], p0[1], p1[0], p1[1]);
      g = Math.max(g, smooth(w + R * 1.3, w, d));
    }
    return g;
  };

  // the spiral relief of the core
  const spiral = (u, y) => {
    const v = y - yc;
    const hd = coreHD(u, y);
    const th = Math.atan2(v, u);
    const ph = hd * 5.2 - th / Math.PI + 0.15;
    return { hd, s: 0.5 + 0.5 * Math.cos(Math.PI * 2 * ph) };
  };

  P.protrusion = (x, y, h) => {
    const u = x - xc;
    const hd = coreHD(u, y);
    let p;
    if (hd < 1.02) {
      const { s } = spiral(u, y);
      const ridge = smooth(0.32, 0.92, s);
      const bulge = 1 - Math.pow(Math.min(1, hd), 1.7);
      p = 1.4 + 9.5 * bulge + 9 * ridge * (0.3 + 0.7 * bulge);
      // raised collar around the oculus
      const ho = hexDist(u, y - oculus.y, oculus.r);
      p += 9 * Math.exp(-(((ho - 1.25) / 0.28) ** 2));
      // the core's rim settles down to meet the wings
      p *= 0.35 + 0.65 * smooth(1.02, 0.86, hd);
    } else {
      // wings: slow diagonal swells, older and shallower
      const w = 0.5 + 0.5 * Math.sin(y * 0.075 + u * 0.028 + 2 * N.noise2(x * 0.01, y * 0.01));
      p = 0.8 + 3.2 * w + 1.8 * N.fbm2(x * 0.03, y * 0.03, 2);
    }
    return Math.max(0.3, p + (h - 0.5) * 0.9);
  };

  P.tone = (x, y, h) => {
    const u = x - xc;
    let t = 0.9 + 0.18 * h + 0.08 * N.noise2(x * 0.02, y * 0.02);
    const hd = coreHD(u, y);
    if (hd < 1) {
      const { s } = spiral(u, y);
      t *= 0.95 + 0.14 * smooth(0.6, 0.95, s);
    } else t *= 0.9;
    const wet = P.wetness(x, y);
    const r = t * (1.03 - 0.36 * wet), g = t * (1 - 0.3 * wet), b = t * (0.95 - 0.28 * wet);
    return [r, g, b];
  };

  P.litChance = (x, y) => {
    const u = x - xc;
    const hd = coreHD(u, y);
    let c = hd < 1 ? 0.06 : 0.045;
    if (hd < 1) {
      const { s } = spiral(u, y);
      c += 0.2 * smooth(0.86, 0.98, s);
    }
    c += 0.3 * P.groove(x, y);
    return c;
  };
  return P;
}

export async function build(ctx, site) {
  const t0 = performance.now();
  const mats = ctx.materials;
  const root = new THREE.Group();
  root.name = 'landmark:monastery';

  const xc = site.x;
  const face = sampleFace(ctx, { x0: xc - 360, x1: xc + 360, y0: 60, y1: 480, margin: 8, lean: 0.05, yFoot: 70 });
  const P = makePlan(ctx, site, face);
  const tFace = performance.now();

  // --- materials ------------------------------------------------------------
  const M = {
    cell: mats.get('stone'),
    stone: mats.get('stone'),
    glyph: mats.get('glyphStone'),
    bronze: mats.get('bronze'),
    rock: mats.get('rock'),
    glow: mats.glow('#ffb35c', { day: 0.06, night: 4.2, flicker: 0.22 }),
  };

  // --- cells -----------------------------------------------------------------
  const kit = makeCellKit(P.R);
  const cells = layoutCells(ctx, face, {
    R: P.R, x0: P.xs0, x1: P.xs1, yBottom: P.ySocle + P.R * 0.55, yTop: P.yc + P.Rg + 4,
    member: P.member, excluded: P.excluded, protrusion: P.protrusion, groove: P.groove, tone: P.tone, litChance: P.litChance,
  }, kit);
  const cellOut = buildCellMeshes(ctx, cells, kit, { cell: M.cell, lamp: M.glow });
  for (const m of cellOut.meshes) root.add(m);
  const tCells = performance.now();
  await nextFrame();

  // --- works -------------------------------------------------------------------
  const W = { stone: new Acc('stone'), glyph: new Acc('glyph'), bronze: new Acc('bronze'), rock: new Acc('rock'), glow: new Acc('glow'), lights: [] };
  buildSocle(ctx, W, face, P);
  const portalInfo = buildPortal(ctx, W, face, P);
  const approach = buildApproach(ctx, W, face, P, portalInfo);
  let steps = 0;
  for (const s of P.stairs) {
    steps += stairRibbon(ctx, W, face, s.pts.map(([u, y]) => [P.xc + u, y]), { landingAtStart: s.landingAtStart, landingAtEnd: s.landingAtEnd });
  }
  // prayer platforms
  const plats = [
    buildPlatform(ctx, W, face, P.xc, P.yc + P.Rg + 2, 58, 0, { bell: true, platR: 7.5 }),
    buildPlatform(ctx, W, face, P.xc - P.a - 81, P.yc - P.Rg / 2 + 140.25, 44, -0.35, {}),
    buildPlatform(ctx, W, face, P.xc + P.a + 54, P.yc - P.Rg / 2 + 93.6, 66, 0.3, { bell: true }),
    buildPlatform(ctx, W, face, P.xc + 2, P.oculus.y - P.oculus.r * 0.72, 34, 0, { beamW: 2.6, beamH: 3.5, platR: 5 }),
  ];
  buildOculus(ctx, W, face, P);
  buildDebris(ctx, W, face, P, cells, kit);
  buildVines(ctx, W, face, P, cells, kit);
  // fall sources: bronze spouts on the source cells
  const fallDefs = [];
  for (const f of P.falls) {
    const x = P.xc + f.u;
    const yaw = face.yaw(x);
    const zb = face.zBase(x, f.ySrc);
    const spoutOut = 9;
    const lip = facePoint(face, x, f.ySrc, spoutOut);
    // a projecting hexagonal spout tube (a cell pushed far out) with a bronze lip
    W.stone.box(lip.x - Math.sin(yaw) * spoutOut / 2, f.ySrc - 2.2, lip.z - Math.cos(yaw) * spoutOut / 2, f.width + 3.2, 4.4, spoutOut + 8, yaw, 0.9);
    W.bronze.box(lip.x, f.ySrc + 0.1, lip.z, f.width + 1.2, 0.5, 1.2, yaw, 1);
    const groundY = ctx.heightAt(lip.x + Math.sin(yaw) * 30, lip.z + Math.cos(yaw) * 30);
    fallDefs.push({ x: lip.x, y: f.ySrc + 0.3, z: lip.z + Math.cos(yaw) * 0.5, yaw, width: f.width, v0: f.v0, seed: f.seed, groundY });
    void zb;
  }

  await nextFrame();
  let triangles = cellOut.triangles;
  for (const k of ['stone', 'glyph', 'bronze', 'rock', 'glow']) {
    const glowy = k === 'glow';
    const mesh = W[k].toMesh(M[k], { castShadow: !glowy, receiveShadow: !glowy });
    if (mesh) {
      root.add(mesh);
      triangles += W[k].triangles;
    }
  }
  const water = buildWater(ctx, fallDefs);
  for (const o of water.objects) root.add(o);
  triangles += water.triangles;

  // --- the constellation -----------------------------------------------------------
  const lights = W.lights.slice();
  for (const c of cellOut.lamps) {
    const L = c.type === 'oculus' ? kit.lampOc : kit.lampDoor;
    const p = cellPoint(c, 0, L.y, -kit.dR + 0.6);
    lights.push({ x: p.x, y: p.y, z: p.z, size: 3.4, b: 0.75 + 0.5 * c.h });
  }
  const stars = buildConstellation(ctx, lights);
  root.add(stars.object);

  ctx.scene.add(root);
  root.updateMatrixWorld(true);

  // --- viewpoints --------------------------------------------------------------------
  const yc = P.yc;
  const zFace = face.zBase(xc, yc);
  const viewpoints = [
    { label: 'establishing', pos: [xc - 520, 330, zFace + 1450], look: [xc + 20, yc - 10, zFace] },
    { label: 'approach', pos: [xc + 210, 150, zFace + 470], look: [xc - 30, yc - 20, zFace] },
    { label: 'dramatic', pos: [xc + 20, approach.fTopY + 1.7, approach.fc.z + 30], look: [xc, P.portalApex + 90, zFace] },
    { label: 'raking', pos: [xc + 430, 200, zFace + 140], look: [xc - 120, 260, zFace - 5] },
    { label: 'intimate', pos: [plats[3].pc.x + 3, P.oculus.y - P.oculus.r * 0.72 + 1.7, plats[3].pc.z + 2], look: [xc - 60, yc + 40, zFace + 10] },
    { label: 'summit', pos: [plats[0].pc.x - 6, P.yc + P.Rg + 3.8, plats[0].pc.z + 4], look: [xc - 200, 150, zFace - 20] },
  ];

  const ms = performance.now() - t0;
  const stats = {
    ms: Math.round(ms), face: Math.round(tFace - t0), cellsMs: Math.round(tCells - tFace),
    cells: cells.length, lamps: cellOut.lamps.length, lights: lights.length, steps, tris: Math.round(triangles), meshes: root.children.length,
  };
  if (ctx.params?.debug) console.log('[monastery]', JSON.stringify(stats));
  if (typeof window !== 'undefined' && window.__MW) window.__MW.monastery = stats;

  return {
    object: root,
    viewpoints,
    update: stars.update,
  };
}
