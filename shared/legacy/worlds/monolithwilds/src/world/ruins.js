// Ruins — the scattered remains of the vanished civilisation between the landmarks.
//
//   ruins-builder.js   fast merged-geometry accumulator (chunked by region, rising-damp tint)
//   ruins-parts.js     arches, voussoirs, arcades, columns, broken tops, rubble
//   ruins-aqueduct.js  The Long Conduit (key linear feature, western hills)
//   ruins-avenue.js    The Processional Way to the Kneeling Wardens (key linear feature)
//   ruins-sites.js     site archetypes (gates, colonnades, obelisks, rings, descents, door
//                      processions, colossal fragments, waymarkers, plaza, walls, drowned ruins)
//   ruins-place.js     deterministic placement of ~70 sites
//
// Everything is merged per (region chunk x material): a few dozen draw calls for the whole module.

import * as THREE from 'crownfall-world-three';
import { RuinBuilder } from './ruins-builder.js';
import { buildAqueduct } from './ruins-aqueduct.js';
import { buildAvenue, AVENUE } from './ruins-avenue.js';
import { planSites, buildSite } from './ruins-place.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


export async function build(ctx) {
  const t0 = performance.now();
  const { materials } = ctx;
  const M = {
    stone: materials.get('stone'),
    smooth: materials.get('stoneSmooth'),
    basalt: materials.get('basalt'),
    marble: materials.get('marble'),
    marbleSmooth: materials.get('marbleSmooth'),
    plaster: materials.get('plaster'),
    obsidianPlain: materials.get('obsidian'),
    // Inscribed variants with a dense, cell-aligned band rhythm: one glyph row every third row
    // (band = 3 cells, height = 1 cell), so a frieze placed on a glyph row (see ruins-parts
    // glyphRow) carries exactly one clean line of runes, and big surfaces get thin inscribed rings.
    glyph: materials.create('glyphStone', { glyphs: { cell: 1.2, band: 3.6, height: 1.2, intensity: 1.35, color: '#ffb35c' } }),
    obsidian: materials.create('obsidianGlyph', { glyphs: { cell: 1.0, band: 3.0, height: 1.0, intensity: 0.7, color: '#5fe6ff' } }),
  };
  M.glyph.userData.preset = 'ruinGlyph';
  M.obsidian.userData.preset = 'ruinObsidian';

  // Region chunks: west (aqueduct, Choir surroundings), north-east, south-east.
  const b = new RuinBuilder({ chunkOf: (x, z) => (x < -900 ? 'W' : z < 0 ? 'N' : 'S') });
  const low = ctx.quality?.level === 'low';
  b.detail = low ? 0.45 : 1;

  const aq = buildAqueduct(ctx, b, M, ctx.noise.createRng('ruins:aqueduct'));
  const tAq = performance.now();
  const av = buildAvenue(ctx, b, M, ctx.noise.createRng('ruins:avenue'));
  const tAv = performance.now();
  if (performance.now() - t0 > 250) await nextFrame();

  // keep scattered sites clear of both linear features
  const corridor = [];
  for (let i = 0; i < aq.piers.length; i += 2) corridor.push([aq.piers[i].x, aq.piers[i].z, 50]);
  {
    const c = new THREE.CatmullRomCurve3(AVENUE.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    for (let i = 0; i <= 40; i++) {
      const p = c.getPointAt(i / 40);
      corridor.push([p.x, p.z, 34]);
    }
  }
  const tp0 = performance.now();
  const sites = planSites(ctx, ctx.noise.createRng('ruins:plan'), { corridor });
  const tPlan = performance.now() - tp0;
  let tl = performance.now();
  const tBy = {};
  for (const s of sites) {
    if (low && s.type === 'fragment') continue;
    const ts = performance.now();
    buildSite(ctx, b, M, s);
    tBy[s.type] = (tBy[s.type] || 0) + performance.now() - ts;
    if (performance.now() - tl > 250) {
      await nextFrame();
      tl = performance.now();
    }
  }

  const tm0 = performance.now();
  const group = b.build({ name: 'ruins' });
  const tMerge = performance.now() - tm0;
  ctx.scene.add(group);
  // Named places + curated shots, for the tour / discovery UI owners (optional to use).
  const named = [
    { name: 'The Long Conduit', subtitle: 'It carried water from the cliffs to a crater that was never thirsty.', pos: [-1500, 110, -690], radius: 500 },
    { name: 'The Processional Way', subtitle: 'The pillars still walk toward the Wardens, two by two.', pos: [-860, 90, -715], radius: 300 },
  ];
  const NAMES = {
    gatePylon: ['The Sagging Gate', 'The lintel has been falling for a thousand years.'],
    gateSlab: ['The Snapped Monolith', 'One stone, one door, one crack.'],
    gateTriple: ['The Narrowing Arches', 'Each is smaller than the last, as if the way were meant for something shrinking.'],
    gateRing: ['The Unclosed Ring', 'Its keystones still hang where they were meant to be.'],
    greatRing: ['A Wheel of the Land', 'Half of it turns inside the hill.'],
    descent: ['The Descent', 'The stair goes down. The door at the bottom does not open.'],
    doorProcession: ['The Turning Doors', 'Walk through them in order. Nobody knows what happens.'],
    colossalHead: ['The Mirror-Faced', 'It has no face, only a surface that shows you yours.'],
    colossalHand: ['The Open Hand', 'Whatever it held is gone.'],
    sunkenPlaza: ['The Court of Stumps', 'Forty-eight columns, and not one roof.'],
  };
  for (const st of sites) {
    const n = NAMES[st.type];
    if (n) named.push({ name: n[0], subtitle: n[1], pos: [Math.round(st.x), Math.round(st.g), Math.round(st.z)], radius: Math.max(120, st.r * 3) });
  }
  const viewpoints = [
    { pos: [-1300, 200, -400], look: [-2000, 60, -700], label: 'the long conduit' },
    { pos: [-899, 142, -700], look: [-300, 20, -850], label: 'the processional way' },
    { pos: [-864, 79, 821], look: [-820, 98, 760], label: 'the sagging gate' },
  ];
  ctx.ruins = { sites, aqueduct: aq, avenue: av, named, viewpoints };
  if (ctx.params.debug) {
    const counts = {};
    for (const s of sites) counts[s.type] = (counts[s.type] || 0) + 1;
    console.warn(`[ruins] ${group.children.length} meshes, ${Math.round(b.triangles / 1000)}k tris, ${sites.length} sites, aqueduct ${aq.bays} bays / ${Math.round(aq.length)} m, avenue ${av.pairs} pairs, ${Math.round(performance.now() - t0)} ms`);
    console.warn(`[ruins] ${JSON.stringify(counts)} mouths ${JSON.stringify(aq.mouths)} towers ${JSON.stringify(aq.towers.map((p) => [Math.round(p.x), Math.round(p.g), Math.round(p.z)]))}`);
    console.warn(`[ruins] sites ${JSON.stringify(sites.map((s) => [s.type, Math.round(s.x), Math.round(s.g), Math.round(s.z)]))}`);
    console.warn(`[ruins] phases aqueduct ${Math.round(tAq - t0)} avenue ${Math.round(tAv - tAq)} plan ${Math.round(tPlan)} merge ${Math.round(tMerge)}`);
    console.warn(`[ruins] ms by type ${JSON.stringify(Object.fromEntries(Object.entries(tBy).map(([k, v]) => [k, Math.round(v)])))}`);
  }
  return { object: group, viewpoints };
}
