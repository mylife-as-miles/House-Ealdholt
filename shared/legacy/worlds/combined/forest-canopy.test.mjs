// CPU geometry/shader-contract verification; no renderer, GPU or visual-score claim.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'crownfall-world-three';
import { forestGroveColour, forestLotClearance, forestProtectedLots, forestTintRamp, planForestCanopy } from './forest-canopy.ts';
import { createMonolithKit } from './monolith.js';
import { aspen, parasolPine, spireConifer } from '../monolithwilds/src/world/vegetation-geo.js';
import { createRng, worldNoise } from '../monolithwilds/src/core/noise.js';
import { AUTUMN_SETTLEMENT_BUILDINGS, SETTLEMENT_OPEN_GROUND, SETTLEMENT_MEADOW_CLEARINGS, settlementHeight, settlementShore } from '../../environment/settlement/layout.ts';
import { settlementTreeSites } from '../../environment/settlement/nature.ts';

test('canopy expansion respects rotated protected lots and the canonical starter plots', () => {
  const yaw = Math.PI / 4, lot = { x: 0, z: 0, width: 10, depth: 4, yaw };
  assert.ok(Math.abs(forestLotClearance(Math.cos(yaw) * 6, -Math.sin(yaw) * 6, [lot]) - 1) < 1e-10);
  const plan = planForestCanopy(8, 0, 3, .2, [{ ...lot, yaw: 0 }]);
  assert.ok(plan.width > 0 && plan.width < 1, 'a close canopy narrows instead of entering a protected lot');
  assert.ok(plan.radius + plan.margin <= plan.clearance + 1e-10);
  assert.equal(planForestCanopy(30, 0, 3, .2, [lot]).width, 1.5);
  const protectedLots = forestProtectedLots();
  assert.ok(protectedLots.length >= AUTUMN_SETTLEMENT_BUILDINGS.length + SETTLEMENT_OPEN_GROUND.length + SETTLEMENT_MEADOW_CLEARINGS.length);
  for (const site of [...SETTLEMENT_OPEN_GROUND,...SETTLEMENT_MEADOW_CLEARINGS]) assert.ok(protectedLots.some(lot => lot.x === site.x && lot.z === site.z && lot.width === site.width && lot.depth === site.depth));
});

test('actual source trees retain topology/wind channels and share width across colour and depth shaders', () => {
  const sources = { aspen, parasol: parasolPine, spire: spireConifer };
  for (const profile of ['desktop', 'quest']) {
    const kit = createMonolithKit({ THREE: T, profile, quality: 'medium', groundAt: settlementHeight, shoreAt: settlementShore, treeSites: settlementTreeSites() });
    const forest = [];
    kit.root.traverse(object => { if (object.isMesh && object.name.includes('edge forest')) forest.push(object); });
    try {
      assert.equal(forest.length, 4, 'wider canopies introduce no additional forest draws');
      assert.equal(forest.reduce((sum, mesh) => sum + mesh.geometry.instanceCount, 0), profile === 'quest' ? 330 : 760);
      let expanded = 0, capped = 0;
      for (const mesh of forest) {
        const { generator, sourceLod } = mesh.userData.sourceAsset;
        const source = sources[generator](worldNoise, createRng('combined-source-' + generator));
        const original = source.lods[sourceLod], geometry = mesh.geometry;
        assert.deepEqual(geometry.index.array, original.index.array, 'actual source triangles are preserved');
        for (const name of ['position', 'normal', 'color', 'aVeg', 'aVeg2', 'aInstA', 'aInstB', 'aCanopyWidth']) assert.ok(geometry.attributes[name], `${name} survives`);
        for (let i = 0; i < original.attributes.position.count; i++) {
          for (const axis of [0, 2, 3]) assert.equal(geometry.attributes.aVeg.getComponent(i, axis), original.attributes.aVeg.getComponent(i, axis), 'source leaf/flutter/AO channels remain unchanged');
          assert.equal(geometry.attributes.aVeg2.getY(i), original.attributes.aVeg2.getY(i), 'source part identity survives');
          const n = geometry.attributes.normal; assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5);
        }
        const widths = geometry.attributes.aCanopyWidth;
        for (const [i, plan] of mesh.userData.canopyPlans.entries()) {
          assert.ok(Number.isFinite(widths.getX(i)) && widths.getX(i) > 0 && widths.getX(i) <= (generator === 'spire' ? 1 : 1.5));
          assert.ok(plan.radius + plan.margin <= plan.clearance + 1e-6, 'full source canopy plus lean/wind stays outside protected lots');
          if (widths.getX(i) > 1.25) expanded++;
          if (widths.getX(i) < (generator === 'spire' ? 1 : 1.5) - .001) capped++;
          const bounds = geometry.boundingBox;
          assert.ok(bounds.min.x <= plan.x - plan.radius && bounds.max.x >= plan.x + plan.radius);
          assert.ok(bounds.min.z <= plan.z - plan.radius && bounds.max.z >= plan.z + plan.radius);
        }
        for (const material of [mesh.material, mesh.customDepthMaterial]) {
          const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <lights_fragment_end>' };
          material.onBeforeCompile(shader);
          assert.match(shader.vertexShader, /attribute float aCanopyWidth/);
          assert.match(shader.vertexShader, /p\.xz \*= aCanopyWidth/);
          assert.match(shader.vertexShader, /uVegTime/);
          assert.ok(shader.uniforms.uMwSourceFromWorld && shader.uniforms.uMwSourceCamera, 'the real miniature/source camera adapter remains active');
          if (material === mesh.material) assert.match(shader.vertexShader, /objectNormal\.xz \/= max\(aCanopyWidth/);
        }
        for (const geometry of source.lods) geometry.dispose();
      }
      assert.ok(expanded > 100 && capped > 0, 'the actual forest broadens while nearby lots constrain individual trees');
    } finally { kit.dispose(); }
  }
});

test('source-noise groves use finite fractional tints with rust/copper/gold range', () => {
  const parameters = [];
  for (let x = -100; x <= 100; x += 5) for (let z = -100; z <= 100; z += 5) parameters.push(forestGroveColour(x, z, .5, worldNoise.noise2));
  assert.ok(Math.max(...parameters) - Math.min(...parameters) > .6);
  assert.ok(parameters.every(value => value >= .025 && value <= .975));
  assert.ok(Math.abs(forestGroveColour(1, 1, .5, worldNoise.noise2) - forestGroveColour(1.1, 1.1, .5, worldNoise.noise2)) < .05, 'neighbouring trees form a coherent grove');
  for (const species of ['aspen', 'parasol', 'spire']) assert.ok(forestTintRamp(T, species).flat().every(value => Number.isFinite(value) && value > 0));
});
