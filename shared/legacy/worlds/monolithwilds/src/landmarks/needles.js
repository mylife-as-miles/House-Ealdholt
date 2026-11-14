// THE NEEDLE CITY — "A city built only upward, as though the ground were a rumour."
//
// ~450 hair-thin stone needles (120-715 m) crowd the plateau: telescoping drums with collars,
// galleries, loggias and cantilevered pods; crowns of spikes, lantern chambers and forks; bundles
// bound by bronze bands; a few twisted, a few leaning; some hung between neighbours, never
// touching the ground. Hundreds of thin bridges sag between collars at every height. One needle
// has fallen across the plateau; another snapped and leans on a great needle. At night sparse
// windows, lanterns and crown beacons glow amber, with cyan seams on the great needles.
//
// Files: needles-plan.js (site + city plan), needles-tower.js (one needle, plinths),
// needles-links.js (bridges, cables, danglers, armillary hoops), needles-ruin.js (fallen, caught,
// ground alleys), needles-geo.js (accumulator + templates).

import * as THREE from 'crownfall-world-three';
import { Acc } from './needles-geo.js';
import { analyseSite, planCity, rAt, axisAt, segDist2D } from './needles-plan.js';
import { emitTower } from './needles-tower.js';
import { buildLinks, buildRings } from './needles-links.js';
import { buildRuins } from './needles-ruin.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


export async function build(ctx, site) {
  const t0 = performance.now();
  const mats = ctx.materials;
  const low = ctx.quality?.level === 'low';

  const M = {
    pale: mats.create('marble', { blocks: [1.5, 0.72], mortar: 0.05, grooveDepth: 0.05, color: '#ddd3c1', alt: '#c9bba5', streaks: 0.75, grime: 0.75, mossAmount: 0.22, macroScale: 16 }),
    dark: mats.create('basalt', { blocks: [1.7, 0.8], mortar: 0.08, color: '#3e3c3e', alt: '#5e5750', streaks: 0.55, macroScale: 18 }),
    stone: mats.get('stone'),
    bronze: mats.get('bronze'),
    iron: mats.get('iron'),
    plaster: mats.get('plaster'),
    terra: mats.get('terracotta'),
    glowF: mats.glow('#ffb35c', { day: 0.05, night: 5.2, flicker: 0.28 }),
    glowS: mats.glow('#fff1dc', { day: 0.3, night: 6.5 }),
    bronzeL: mats.create('bronze', { local: true }),
    ironL: mats.create('iron', { local: true }),
  };
  const A = {};
  const CAP = { pale: 300000, dark: 150000, stone: 70000, bronze: 150000, iron: 260000, plaster: 26000, terra: 12000, glowF: 26000, glowS: 3000 };
  for (const k of Object.keys(CAP)) A[k] = new Acc(k, CAP[k]);

  const S = analyseSite(ctx, site);
  const plan = planCity(ctx, site, S, { count: low ? 250 : 400 });
  const rng = plan.rng;
  const tPlan = performance.now();

  const out = { rings: [] };
  for (const t of plan.towers) emitTower(t, A, rng, out);
  const tTowers = performance.now();
  await nextFrame();

  const ruin = buildRuins(ctx, plan, A, rng, out);
  const links = buildLinks(ctx, plan, A, M, rng, { density: low ? 0.6 : 1.0 });
  const rings = buildRings(out.rings, M);
  const tLinks = performance.now();

  const root = new THREE.Group();
  root.name = 'landmark:needles';
  let tris = 0;
  for (const k of Object.keys(A)) {
    const glow = k.startsWith('glow');
    tris += A[k].triangles;
    const mesh = A[k].toMesh(M[k], { castShadow: !glow, receiveShadow: !glow, name: `needles:${k}` });
    if (mesh) root.add(mesh);
  }
  for (const m of links.meshes) root.add(m);
  if (rings.mesh) root.add(rings.mesh);
  ctx.scene.add(root);

  // --- viewpoints -------------------------------------------------------------------------------
  const C = { x: site.x, z: site.z };
  const top = S.top;
  const surf = (x, z) => Math.max(ctx.heightAt(x, z), 0);
  const fd = S.fdir;
  const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.z * Math.sin(a), z: v.x * Math.sin(a) + v.z * Math.cos(a) });
  const vp = [];
  {
    // establishing: from above the lake to the south-west, the sun behind the left shoulder
    const x = C.x + Math.cos(2.3) * 1300, z = C.z + Math.sin(2.3) * 1300;
    vp.push({ label: 'establishing', pos: [x, Math.max(surf(x, z) + 120, 200), z], look: [C.x, top + 200, C.z] });
  }
  {
    // approach: over the lowland beside the waterfall, ~700 m out
    const d = rot(fd, 0.38);
    const x = C.x + d.x * 700, z = C.z + d.z * 700;
    vp.push({ label: 'approach', pos: [x, Math.max(surf(x, z) + 60, top + 30), z], look: [C.x, top + 200, C.z] });
  }
  {
    // from the south: the canyon mouth on the right, the waterfall on the left
    const x = C.x, z = C.z + 1500;
    vp.push({ label: 'from the south', pos: [x, Math.max(surf(x, z) + 150, 300), z], look: [C.x, top + 180, C.z] });
  }
  {
    // dramatic: from the canyon rim, the needles black against the low sun
    const x = C.x + 780, z = C.z - 100;
    vp.push({ label: 'dramatic', pos: [x, Math.max(surf(x, z) + 60, 255), z], look: [C.x - 40, top + 220, C.z + 20], hour: 18.2 });
  }
  // between: a clear point among the needles, ~260 m up
  {
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      for (const r of [140, 190, 240]) {
        for (const h of [200, 260, 320]) {
          const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r, y = top + h;
          let clear = Infinity;
          for (const t of plan.towers) {
            const yl = y - t.baseY;
            if (yl < -40 || yl > t.H + 10) continue;
            const ax = axisAt(t, Math.max(0, yl));
            clear = Math.min(clear, Math.hypot(ax.x - x, ax.z - z) - rAt(t, Math.max(0, yl)) - 9);
          }
          for (const b of links.bridges) {
            if (Math.abs((b.a.y + b.b.y) / 2 - y) > 16) continue;
            clear = Math.min(clear, segDist2D(x, z, b.a.x, b.a.z, b.b.x, b.b.z) - 6);
          }
          if (!best || clear > best.clear) best = { x, y, z, clear, a };
        }
      }
    }
    const la = best.a + Math.PI + 0.35;
    vp.push({ label: 'among the needles', pos: [best.x, best.y, best.z], look: [best.x + Math.cos(la) * 300, best.y + 70, best.z + Math.sin(la) * 300] });
    vp.lanterns = { label: 'lanterns', pos: [best.x, best.y, best.z], look: [best.x + Math.cos(la) * 300, best.y + 20, best.z + Math.sin(la) * 300], hour: 21.8 };
  }
  // the caught needle, seen side-on from a clear point
  const clearAt = (x, y, z) => {
    let clear = Infinity;
    for (const t of plan.towers) {
      const yl = y - t.baseY;
      if (yl < -40 || yl > t.H + 10) continue;
      const ax = axisAt(t, Math.max(0, yl));
      clear = Math.min(clear, Math.hypot(ax.x - x, ax.z - z) - rAt(t, Math.max(0, yl)) - 9);
    }
    return clear;
  };
  if (plan.caught && plan.caughtSeg) {
    // the caught needle from outside the city (it leans inward from the western edge)
    const { a, b } = plan.caughtSeg;
    const ang = plan.caught.a;
    const x = C.x + Math.cos(ang) * 760, z = C.z + Math.sin(ang) * 760;
    vp.push({ label: 'the caught needle', pos: [x, Math.max(surf(x, z) + 40, top + 50), z], look: [(a.x + b.x) / 2, (a.y + b.y) / 2 + 10, (a.z + b.z) / 2] });
  }
  if (plan.fallen) {
    // down the scar: the fallen lengths lead back to the stump
    const { F, dir, L } = plan.fallen;
    const x = F.x + dir.x * L * 0.92 - dir.z * 7, z = F.z + dir.z * L * 0.92 + dir.x * 7;
    vp.push({ label: 'the fallen needle', pos: [x, ctx.heightAt(x, z) + 13, z], look: [F.x + dir.x * L * 0.15, F.baseY + 10, F.z + dir.z * L * 0.15] });
  }
  // a hung needle from below: its spike hovers over the well where it would have stood
  if (plan.hung.length) {
    let best = null;
    for (const h of plan.hung) {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        for (const d of [40, 55, 70]) {
          const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
          let clear = Infinity;
          for (const t of plan.towers) {
            if (t.kind === 'hung') continue;
            const R = t.bundle ? t.bundle.pr : Math.max(t.pr, t.r0 + 1);
            clear = Math.min(clear, Math.hypot(t.x - x, t.z - z) - R);
          }
          for (const c of plan.corridors) clear = Math.min(clear, segDist2D(x, z, c.ax, c.az, c.bx, c.bz) - c.w);
          // nothing between the camera and the spike
          let open = Infinity;
          for (const t of plan.towers) {
            if (t === h) continue;
            open = Math.min(open, segDist2D(t.x, t.z, x, z, h.x, h.z) - t.r0 * 1.4 - (t.inhabited ? 7 : 2));
          }
          const sc = Math.min(clear, 10) + Math.min(open, 6) - Math.cos(a) * 3 - (h.baseY - ctx.heightAt(h.x, h.z)) * 0.02;
          if (clear > 3 && open > 0 && (!best || sc > best.sc)) best = { x, z, sc, h };
        }
      }
    }
    if (best) {
      const h = best.h;
      vp.push({ label: 'the hung needle', pos: [best.x, ctx.heightAt(best.x, best.z) + 5, best.z], look: [h.x, h.baseY - 12, h.z] });
    }
  }
  // intimate: in an alley at the foot of a great needle, looking up
  {
    const G = plan.greats[1] ?? plan.greats[0] ?? plan.towers[0];
    let best = null;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      for (const r of [G.pr + 12, G.pr + 22, G.pr + 34]) {
        const x = G.x + Math.cos(a) * r, z = G.z + Math.sin(a) * r;
        let clear = Infinity;
        for (const t of plan.towers) {
          if (t.kind === 'hung') continue;
          const R = t.bundle ? t.bundle.pr : Math.max(t.pr, t.r0 + 1);
          clear = Math.min(clear, Math.hypot(t.x - x, t.z - z) - R);
        }
        for (const c of plan.corridors) clear = Math.min(clear, segDist2D(x, z, c.ax, c.az, c.bx, c.bz) - c.w);
        // prefer the sunward (west) side
        const score = Math.min(clear, 12) - Math.cos(a) * 3;
        if (clear > 3 && (!best || score > best.score)) best = { x, z, score };
      }
    }
    if (best) {
      const g = ctx.heightAt(best.x, best.z);
      vp.push({ label: 'intimate', pos: [best.x, g + 2.2, best.z], look: [G.x, G.baseY + 260, G.z] });
    }
  }
  if (vp.lanterns) vp.push(vp.lanterns);
  const viewpoints = vp.map((v) => ({ ...v, pos: v.pos.map((n) => Math.round(n * 10) / 10), look: v.look.map((n) => Math.round(n * 10) / 10) }));

  const stats = {
    ms: Math.round(performance.now() - t0), plan: Math.round(tPlan - t0), towers: Math.round(tTowers - tPlan), links: Math.round(tLinks - tTowers),
    needles: plan.towers.length, bundles: plan.bundles.length, hung: plan.hung.length, greats: plan.greats.length,
    tris, meshes: root.children.length, rings: out.rings.length, ...links.stats, ...ruin,
  };
  if (ctx.params.debug) console.warn('[needles]', JSON.stringify(stats), JSON.stringify(viewpoints));
  if (typeof window !== 'undefined' && window.__MW) window.__MW.needles = { stats, viewpoints };

  return {
    object: root,
    viewpoints,
    update(dt, time) {
      rings.update(time);
      links.setDanglers(time);
    },
  };
}
