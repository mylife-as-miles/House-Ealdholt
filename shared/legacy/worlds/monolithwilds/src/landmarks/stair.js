// THE STAIR TO NOWHERE — a marble staircase that climbs ~700 m from a rocky islet at the west
// shore of the Mirror, in a slow helix that widens as it rises, on stilts that thin out with
// height until the last 150 m hang from nothing; the helix finally unwinds into one straight
// flight thrown out over the lake, ending at a free-standing door, ajar, opening onto air.
//
// Construction logic (see stair-path.js): each turn lies ~17 m outside the one below, so every
// flight has its own clear column of air and a single impossibly thin pier can reach it from the
// ground. Steps are human scale (0.17 / 0.34 m) — about 4100 of them, in flights of 118–176
// with a landing, a bay and a small shrine, bench, lamp or arch after each.
//
// Materials grade with height: lichened, weathered marble below 190 m, marble to 440 m, clean
// marbleSmooth above; bronze fittings; the gate and the door frame in basalt; a bronze door.
//
// Files: stair-path (the helix + profile), stair-geo (raw triangle writer), stair-flight (body,
// steps, balustrades, breaches), stair-piers, stair-landings, stair-ends (podium, jetty, door,
// fragments), stair-light (lamp sprites + the light through the door).

import * as THREE from 'crownfall-world-three';
import { smoothstep } from '../core/noise.js';
import { createPath } from './stair-path.js';
import { Writer, writerMesh } from './stair-geo.js';
import { buildFlights } from './stair-flight.js';
import { buildPiers } from './stair-piers.js';
import { buildLandings } from './stair-landings.js';
import { buildBase, buildTop, buildFragments } from './stair-ends.js';
import { buildSprites, createDoorLightMaterial } from './stair-light.js';
import { buildGrowth } from './stair-growth.js';
import { yieldToMain as yieldFrame } from '../core/yield.js';


export async function build(ctx, site) {
  const T0 = performance.now();
  const marks = [];
  const mark = (n) => marks.push(`${n}:${Math.round(performance.now() - T0)}`);
  const rng = ctx.noise.createRng('stair');

  // the helix axis sits a little lakeward of the islet centre so the widening turns fly over water
  const P = createPath(ctx, site, rng, { dir: -1, endDir: [0.93, -0.36], axisShift: [6, -3] });

  const M = {
    low: ctx.materials.create('marble', {
      color: '#d8d0c1', moss: '#6d7143', mossAmount: 0.8, streaks: 0.8, grime: 0.95, variation: 0.24, bump: 0.75,
    }),
    mid: ctx.materials.get('marble'),
    top: ctx.materials.get('marbleSmooth'),
    bronze: ctx.materials.get('bronze'),
    basalt: ctx.materials.get('basalt'),
    obsidian: ctx.materials.get('obsidian'),
    glow: ctx.materials.glow('#ffb35c', { day: 0.08, night: 4.5, flicker: 0.3 }),
    leaf: ctx.materials.create('bronze', { local: true, color: '#5c4428', patina: 0.6 }),
  };
  const W = {};
  for (const k of ['low', 'mid', 'top', 'bronze', 'basalt', 'obsidian', 'glow']) W[k] = new Writer(k);
  W.low.setTint(0.96, 0.97, 0.93);
  W.top.setTint(1.03, 1.03, 1.02);

  const zoneOf = (y) => (y < 190 ? 'low' : y < 440 ? 'mid' : 'top');
  // darker, greyer low down (spray, lichen, grime); clean toward the sky
  const weather = (y) => 0.8 + 0.2 * smoothstep(P.yBase, P.yBase + 320, y);

  const info = buildFlights(ctx, P, W, rng, zoneOf, weather);
  mark('flights');
  await yieldFrame();
  const piers = buildPiers(ctx, P, W, zoneOf, weather, info.breaches);
  mark('piers');
  const land = buildLandings(ctx, P, W, rng, zoneOf, weather);
  const base = buildBase(ctx, P, W, rng);
  const top = buildTop(ctx, P, W, M.leaf);
  const nFrag = buildFragments(ctx, P, W, ctx.noise.createRng('stair-fragments'), info);
  const nStrands = buildGrowth(ctx, P, W, ctx.noise.createRng('stair-growth'));
  mark('ends');
  await yieldFrame();

  const root = new THREE.Group();
  root.name = 'landmark:stair';
  for (const k of Object.keys(W)) {
    const mesh = writerMesh(W[k], M[k], { castShadow: k !== 'glow' && k !== 'obsidian' });
    if (mesh) root.add(mesh);
  }
  root.add(top.pivot);
  // light through the door
  const lightMesh = new THREE.Mesh(top.lightQuads.geometry(), createDoorLightMaterial(ctx, '#d4f0ff'));
  lightMesh.name = 'stair:door-light';
  lightMesh.renderOrder = 3;
  lightMesh.matrixAutoUpdate = false;
  root.add(lightMesh);
  // star sprites: lamps (warm) and the door (cold)
  const sprites = [
    ...land.lamps.map((p) => ({ p, size: 2.2, b: 1.0, kind: 0 })),
    ...base.lamps.map((p) => ({ p, size: 2.2, b: 1.0, kind: 0 })),
    { p: top.glowAt, size: 9, b: 1.25, kind: 1 },
  ];
  const spr = buildSprites(ctx, sprites, ctx.noise.createRng('stair-sprites'));
  root.add(spr.object);
  ctx.scene.add(root);
  mark('merge');

  let tris = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3;
  });
  const stats = { steps: info.steps, balusters: info.balusters, piers: piers.length, fragments: nFrag, strands: nStrands, tris: Math.round(tris), yTop: Math.round(P.yTop) };
  if (ctx.params?.debug || typeof window === 'undefined') console.log(`[stair] build ${marks.join(' ')}`, stats);
  root.userData.stats = stats;

  // ---- viewpoints (sun at golden hour sits in the west, -x)
  const cx = P.cx, cz = P.cz;
  const midY = P.yBase + 330;
  const ground = (x, z, lift) => Math.max(ctx.heightAt(x, z), 0) + lift;
  const doorF = P.plan(P.sTop0 - 22, {});
  const doorEye = [doorF.x - doorF.nx * 1.0, P.yLine(P.sTop0 - 22) + 1.7, doorF.z - doorF.nz * 1.0];
  const doorLook = top.at(9, 0.8, 8);
  // a shrine landing low enough to see the lake close below
  const shrine = P.landings.find((g) => g.feature === 'shrine' && g.y0 > 100) || P.landings[1];
  const sm = P.plan((shrine.s0 + shrine.s1) / 2, {});
  const sHw = P.width((shrine.s0 + shrine.s1) / 2) / 2;
  const sAt = (t, u, v) => [sm.x + sm.tx * t + sm.nx * u, shrine.y0 + v, sm.z + sm.tz * t + sm.nz * u];
  const jd = Math.atan2(40 - cz, 80 - cx);
  const jx = Math.cos(jd), jz = Math.sin(jd);
  const gate = P.plan(4.5, {});
  const viewpoints = [
    // from the Wardens' shore, 1.1 km north: the whole helix side-lit, the southern hills behind
    { pos: [cx + 90, ground(cx + 90, cz - 1150, 70), cz - 1150], look: [cx, midY, cz], label: 'establishing' },
    // from far out on the Mirror, into the evening light: silhouette and reflection
    { pos: [cx + 780, 16, cz - 540], look: [cx, 250, cz], label: 'establishing lake', hour: 17.9 },
    // over the water, ~500 m out: the stilts standing in the lake, the unwound flight overhead
    { pos: [cx + 470, 95, cz + 250], look: [cx - 10, 300, cz - 20], label: 'approach' },
    // on the podium beside the well: straight up the vortex
    { pos: [cx + 4, P.yBase + 1.7, cz + 3], look: [cx + 26, P.yBase + 400, cz - 18], label: 'dramatic' },
    // on the last flight, below the door: nothing beyond it
    { pos: doorEye, look: doorLook, label: 'dramatic door' },
    // from the water beside the jetty: the gate, the podium, the first coils overhead
    { pos: [cx + jx * 118 - jz * 30, 4.5, cz + jz * 118 + jx * 30], look: [gate.x, P.yBase + 26, gate.z], label: 'base' },
    // standing in a landing's bay: the shrine and its lamp, the helix and the stilts behind
    { pos: sAt(-2.2, sHw + 1.2, 1.65), look: sAt(0.2, -sHw + 1.2, 2.1), label: 'intimate' },
  ];

  // ---- motion: the door breathes open and shut over minutes
  const leaf = top.leaf;
  const baseA = top.baseOpen * top.openSign;
  const amp = 0.05 * top.openSign;
  return {
    object: root,
    viewpoints,
    update(dt, t) {
      leaf.rotation.y = baseA + amp * Math.sin(t * 0.045) * Math.sin(t * 0.017 + 0.7);
      spr.update();
    },
  };
}
