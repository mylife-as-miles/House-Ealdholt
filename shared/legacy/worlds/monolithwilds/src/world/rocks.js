// Rocks — the natural formations that make the land spectacular between the landmarks.
//
//   loose boulders   instanced (3 recipes x 3 tessellation levels), camera-driven LOD
//                    (rocks-boulders.js); scattered in clumps, shingle on the lake shore,
//                    talus aprons under the escarpment / plateau / mesa (rocks-scatter.js)
//   formations      sea stacks, islets and a sea arch in the lake; natural arches; hoodoo fields
//                    at the mesa foot and on the crater slopes; basalt colonnades on the canyon rims
//                    and a causeway into the lake; foothill spires; giant erratics, a few balanced
//                    (rocks-formations.js) — merged into one mesh per region x material
//
// Publishes ctx.rocks = { blocked(x, z, margin), surfaceAt(x, z), discs } so later scatter modules
// (vegetation, ruins) can keep trees and rubble out of the big formations and off the talus cones.

import * as THREE from 'crownfall-world-three';
import { BoulderField } from './rocks-boulders.js';
import { Occupancy, scatterClusters } from './rocks-scatter.js';
import { createHeightGrid } from './rocks-grid.js';
import { createKit, buildLake, buildArches, buildHoodoos, buildBasalt, buildSpires, buildErratics, buildScree } from './rocks-formations.js';
import { yieldToMain as nextFrame } from '../core/yield.js';


export async function build(ctx) {
  const t0 = performance.now();
  const root = new THREE.Group();
  root.name = 'rocks';
  ctx.scene.add(root);

  const M = ctx.materials;
  const materials = {
    rock: M.get('rock'),
    // rust-red hoodoo rock: the sandstone preset's evenly spaced strata grooves read as brick
    // courses on slender pillars (especially at night), so the fine Bryce banding is carried by
    // vertex colours instead
    redrock: M.create('rock', {
      color: '#a9623f',
      alt: '#d09468',
      moss: '#5a6230',
      macroScale: 40,
      variation: 0.35,
      mossAmount: 0.28,
      streaks: 0.6,
      grime: 0.6,
      bump: 1.2,
      fine: 1.2,
    }),
    basalt: M.get('basalt'),
    // pale grey-beige limestone for stacks, spires, the crater tuff and two arches. Deliberately
    // not the sandstone preset: its evenly spaced strata grooves read as masonry courses on tall
    // pillars; the bedding here comes from the geometry and irregular vertex-colour bands instead.
    strata: M.create('rock', {
      color: '#a19584',
      alt: '#c2b49c',
      moss: '#4c5a2b',
      macroScale: 60,
      variation: 0.4,
      mossAmount: 0.5,
      streaks: 0.75,
      grime: 0.6,
      bump: 1.25,
      fine: 1.2,
    }),
  };

  const occ = new Occupancy(64);
  const field = new BoulderField({
    kinds: [
      { name: 'round', kind: 'round', seed: 'boulder-round' },
      { name: 'block', kind: 'block', seed: 'boulder-block' },
      { name: 'slab', kind: 'slab', seed: 'boulder-slab' },
    ],
    material: materials.rock,
    quality: ctx.quality,
  });
  field.prepare();
  const G = createHeightGrid(ctx);
  field.fast = G.at;
  // no loose rock inside a landmark's clear radius, nor on the lake sites that have none
  // (the Stair's islet and the drowned Observatory keep a 180 m ring of open water)
  const lakeSites = ['stair', 'observatory'].map((id) => ctx.layout.LANDMARK_BY_ID[id]);
  field.avoid = (x, z, r) => {
    if (ctx.layout.isReserved(x, z, r)) return true;
    for (const s of lakeSites) if (Math.hypot(x - s.x, z - s.z) < 180 + r) return true;
    return false;
  };
  const K = createKit(ctx, field, occ, G);
  const timings = {};
  const phase = async (name, fn) => {
    const t = performance.now();
    fn(K);
    timings[name] = Math.round(performance.now() - t);
    if (performance.now() - t > 120) await nextFrame();
  };

  await phase('lake', buildLake);
  await phase('arches', buildArches);
  await phase('hoodoos', buildHoodoos);
  await phase('basalt', buildBasalt);
  await phase('spires', buildSpires);
  await phase('erratics', buildErratics);
  await phase('scree', buildScree);

  // merged formation meshes: one per region x material
  let tris = 0;
  let t = performance.now();
  for (const e of K.writers.values()) {
    if (!e.writer || e.writer.ni === 0) continue;
    const geo = e.writer.geometry();
    e.writer = null;
    const mesh = new THREE.Mesh(geo, materials[e.material]);
    mesh.name = `rocks:${e.region}:${e.material}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
    tris += geo.index.count / 3;
  }
  timings.merge = Math.round(performance.now() - t);
  await nextFrame();

  // basin-wide loose boulders
  t = performance.now();
  const L = ctx.layout.LANDMARK_BY_ID;
  const sand = [1.3, 0.88, 0.72];
  const dark = [0.62, 0.62, 0.66];
  const clusterRng = ctx.noise.createRng('rocks-clusters');
  const placed = scatterClusters(ctx, field, occ, clusterRng, {
    G,
    density: ctx.quality.level === 'low' ? 0.6 : 1,
    tintFn: (x, z) => {
      const dm = Math.hypot(x - L.temple.x, z - L.temple.z);
      const ms = ctx.noise.smoothstep(800, 480, dm);
      const cd = ctx.canyonDistance(x, z).d;
      const cs = ctx.noise.smoothstep(520, 260, cd) * 0.8;
      return [1 + (sand[0] - 1) * ms + (dark[0] - 1) * cs, 1 + (sand[1] - 1) * ms + (dark[1] - 1) * cs, 1 + (sand[2] - 1) * ms + (dark[2] - 1) * cs];
    },
  });
  K.count('clusterRocks', placed);
  timings.clusters = Math.round(performance.now() - t);

  field.finalize(root);
  field.update(ctx.camera.position, true);

  const stats = {
    ms: Math.round(performance.now() - t0),
    grid: G.shared ? 'terrain' : `lazy(${G.computed})`,
    timings,
    counts: K.stats,
    instances: field.n,
    staticTris: tris,
    meshes: root.children.length - 1 + field.meshes.length,
  };
  // notable formations (for the tour / map / debugging): [{ kind, x, y, z }]
  const r1 = (v) => Math.round(v);
  const sites = [
    ...(K.erratics || []).map((c) => ({ kind: c.kind, x: r1(c.x), y: r1(c.h), z: r1(c.z) })),
    ...(K.spireSites || []).map(([x, z]) => ({ kind: 'spires', x: r1(x), y: r1(ctx.heightAt(x, z)), z: r1(z) })),
    ...(K.hoodooSites || []).map(([region, x, z]) => ({ kind: region, x, y: r1(ctx.heightAt(x, z)), z })),
    ...(K.archSites || []),
  ];
  ctx.rocks = {
    sites,
    blocked: (x, z, margin = 0) => occ.blocked(x, z, margin),
    /** Ground height including the talus cones (max of terrain and cone surfaces). */
    surfaceAt: K.surfaceAt || ctx.heightAt,
    discs: occ.discs,
    stats,
    field,
  };
  if (ctx.params.debug) console.warn('[rocks]', JSON.stringify(stats));

  return {
    order: 50, // after the camera controls have moved the camera this frame
    update() {
      field.update(ctx.camera.position);
    },
  };
}
