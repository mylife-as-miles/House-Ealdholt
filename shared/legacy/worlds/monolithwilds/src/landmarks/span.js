// THE VERTEBRAL SPAN — a ~420 m bridge across the canyon, grown rather than built.
//
// A chain of colossal vertebrae hangs rim to rim like a spine in a catenary, twisting a little
// along its length. A processional walkway runs on its back through the neural arches; fins
// (spinous processes) rise above it like a sail; ribs hang beneath as an inverted nave, some
// broken and dangling, fringed with bone stalactites. A skull-like mass fuses into the west rim,
// a pelvis into the east. The bones are hollow and full of a warm amber "marrow" light that
// leaks out at night through joints, cracks and broken ends.
//
// Files: span-frame (curve), span-units (vertebrae), span-deck (walkway), span-geo (helpers).

import * as THREE from 'crownfall-world-three';
import { createSpineFrame } from './span-frame.js';
import { SpanBuilder } from './span-geo.js';
import { layoutUnits, buildUnits, buildJoints, buildCracks, buildMoss } from './span-units.js';
import { buildDeck, halfWidthAt } from './span-deck.js';
import { buildRibs, buildDrips, buildDangling, buildFallen, mossBeards } from './span-ribs.js';
import { buildCables } from './span-cables.js';
import { buildSkull, buildPelvis, buildCliffStair, buildPortal, buildFlight, buildGateObelisk } from './span-ends.js';
import { yieldToMain as yieldFrame } from '../core/yield.js';


export async function build(ctx, site) {
  const T0 = performance.now();
  const marks = [];
  const mark = (name) => marks.push(`${name}:${Math.round(performance.now() - T0)}`);
  const F = createSpineFrame(ctx, site);
  const rng = ctx.noise.createRng('span');
  const M = {
    bone: ctx.materials.get('bone'),
    boneLocal: ctx.materials.create('bone', { local: true }),
    stoneSmooth: ctx.materials.get('stoneSmooth'),
    basalt: ctx.materials.get('basaltSmooth'),
    bronze: ctx.materials.get('bronze'),
    iron: ctx.materials.get('iron'),
    glow: ctx.materials.glow('#ffb35c', { day: 0.12, night: 5.5, flicker: 0.12 }),
    glyph: ctx.materials.get('glyphStone'),
    rock: ctx.materials.get('rock'),
  };
  // "void": black by day, warm marrow light by night (sockets, cracks, doorways, foramina)
  M.void = ctx.materials.glow('#ff8f3a', { day: 0.02, night: 3.0 });

  const B = new SpanBuilder();
  const { units } = layoutUnits(F);
  units[6].brokenFin = 0.6;
  units[11].brokenFin = 0.72;
  buildUnits(ctx, F, B, M, rng, units);
  mark('units');
  await yieldFrame();
  buildJoints(F, B, M, units);
  buildCracks(B, M, rng, units);
  buildMoss(F, B, M, ctx.noise.createRng('span-moss'), units);
  buildDeck(ctx, F, B, M, rng, units);
  mark('deck');
  const ribs = buildRibs(ctx, F, B, M, rng, units);
  buildFallen(ctx, B, M, rng, ribs.fallen, F);
  mark('ribs');
  buildCables(ctx, F, B, M, units);
  mark('cables');
  await yieldFrame();
  buildSkull(ctx, F, B, M, rng, units);
  buildPelvis(ctx, F, B, M, rng, units);
  mark('ends');
  const westStair = buildCliffStair(ctx, F, B, M, rng, { dir: -1, off0: 34, yTop: F.groundAt(F.rimW - 4, 34) + 0.5, yBot: 1.5 });
  const eastStair = buildCliffStair(ctx, F, B, M, rng, { dir: 1, off0: -34, yTop: F.groundAt(F.rimE + 4, -34) + 0.5, yBot: 1.5, flightDrop: 30 });
  if (westStair.length > 2) buildPortal(ctx, F, B, M, westStair[1], -1);
  // the east wall takes the evening sun: its landings open into the rock
  if (eastStair.length > 3) buildPortal(ctx, F, B, M, eastStair[1], 1);
  if (eastStair.length > 3) buildPortal(ctx, F, B, M, eastStair[3], 1);
  if (eastStair.length > 1) buildPortal(ctx, F, B, M, eastStair[eastStair.length - 1], 1);
  // access: side flights from the deck down to the ground by the skull (the sacrum carries its
  // own flight between the pelvic fans)
  {
    const s = units[1].s + units[1].L * 0.5;
    const f = F.frameAt(s);
    for (const sd of [-1, 1]) {
      const top = f.P.clone().addScaledVector(f.S, sd * (units[1].hw + 1.2)).addScaledVector(f.U, -0.3);
      const out = F.world(s + 10, sd * 26, 0);
      out.y = ctx.heightAt(out.x, out.z) + 0.3;
      buildFlight(ctx, B, M, top, out, 4.5);
    }
  }
  // gate obelisks: the builders' own marks at both ends of the processional way
  {
    const yaw = Math.atan2(F.axis.x, F.axis.z);
    for (const sd of [-1, 1]) {
      const w = F.world(F.sW + 12, sd * 15, 0);
      buildGateObelisk(ctx, B, M, w.x, w.z, 30, yaw, sd * 0.015);
      const e = F.world(F.sE + 50, sd * 10, 0);
      buildGateObelisk(ctx, B, M, e.x, e.z, 26 + (sd > 0 ? 0 : 3), yaw, sd > 0 ? 0.05 : -0.01);
    }
  }
  mark('stairs');
  await yieldFrame();

  const root = new THREE.Group();
  root.name = 'landmark:span';
  const merged = B.build({ name: 'span' });
  for (const mesh of merged.children) {
    if (mesh.material === M.glow || mesh.material === M.void) mesh.castShadow = false;
  }
  root.add(merged);
  const beards = mossBeards(F, ctx.noise.createRng('span-beards'), units, halfWidthAt);
  let drips = ribs.drips.concat(beards);
  if (ctx.quality?.level === 'low') drips = drips.filter((d, i) => i % 2 === 0);
  root.add(buildDrips(ctx, M, drips));
  const dang = buildDangling(ctx, M, ribs.dangling);
  root.add(dang.mesh);
  ctx.scene.add(root);
  mark('merge');
  if (ctx.params?.debug || typeof window === 'undefined') console.log(`[span] build ${marks.join(' ')}`);

  // curated shots (local s/off → world). Sun at golden hour sits low in the west (-x).
  const P = (s, off, y) => F.world(s, off, y).toArray();
  const deck = (s, lift = 0) => F.deckY(s) + lift;
  const viewpoints = [
    // broadside from the south-west hills: the sail of fins lit by the low sun across the chasm
    { pos: P(40, 1250, 290), look: P(20, 0, 165), label: 'establishing' },
    // hovering over the canyon south-west of the span, fins raked by the light
    { pos: P(90, 430, 215), look: P(0, 0, 160), label: 'approach' },
    // from a ledge on the east wall, looking up the axis: the ribs become a receding nave
    { pos: P(117, 1, F.groundAt(117, 1) + 4), look: P(-40, 0, 112), label: 'dramatic' },
    // from the river downstream: the span hung across the chasm overhead
    { pos: [site.x - 64, 6, site.z + 300], look: [site.x, 125, site.z], label: 'dramatic river' },
    // from the east rim, between the gate obelisks and through the pelvic fans, into the low sun
    { pos: P(F.sE + 170, 0, deck(F.sE, 34)), look: P(-60, 0, deck(-60, 22)), label: 'dramatic backlit' },
    // across the chasm: the spine's shadow thrown onto the sunlit east wall
    { pos: [site.x - 90, 60, site.z + 190], look: [site.x + 130, 105, site.z + 50], label: 'dramatic shadow' },
    // on the processional way at a joint, the tallest fins overhead
    { pos: P(units[3].s + units[3].L / 2, 0.6, deck(units[3].s + units[3].L / 2, 1.8)), look: P(units[9].s, -1, deck(units[9].s, 14)), label: 'intimate' },
    // at the skull's sunlit flank, under the orbit and the gaping jaws
    { pos: P(F.sW - 45, 72, F.groundAt(F.sW - 45, 72) + 5), look: P(F.sW - 70, 18, F.groundAt(F.sW - 70, 0) + 20), label: 'intimate skull' },
  ];

  return {
    object: root,
    viewpoints,
    update(dt, t) {
      dang.update(t);
    },
  };
}
