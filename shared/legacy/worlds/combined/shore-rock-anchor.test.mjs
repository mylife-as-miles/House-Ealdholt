import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceShoreRockAnchor } from './shore-rock-anchor.ts';
import { rockShape, rockGeometry } from '../monolithwilds/src/world/rocks-geo.js';
import { sourceShoreSites, sourceShoreColliders } from './shore-layout.ts';
import { AUTUMN_WATER_LEVEL, settlementHeight } from '../../environment/settlement/layout.ts';

test('the exact source rock vertices stay inside every unchanged collider while more of the shoreline emerges', () => {
  const sites = sourceShoreSites(), colliders = sourceShoreColliders();
  const canonical = JSON.stringify({ sites, colliders });
  for (const lod of [1, 2]) {
    const shapes = Object.fromEntries(['block', 'slab', 'shard'].map(kind => [kind, rockGeometry(rockShape('crownfall-source-' + kind, kind), lod)]));
    let visibleBefore = 0, visibleAfter = 0, verticesBefore = 0, verticesAfter = 0;
    try {
      for (const [index, site] of sites.entries()) {
        const geometry = shapes[site.kind]; geometry.computeBoundingBox();
        const box = geometry.boundingBox, p = geometry.attributes.position, originalPositions = p.array.slice();
        const collider = colliders[index], ground = settlementHeight(site.x, site.z), beforeY = ground - .2;
        const afterY = sourceShoreRockAnchor({ groundY: ground, previousAnchorY: collider.center[1], scale: site.scale, radius: collider.halfExtents[1], localMinY: box.min.y, localMaxY: box.max.y });
        assert.ok(afterY >= beforeY && afterY + box.min.y * site.scale <= ground - .119999, 'the new rock remains grounded and partly buried');
        let before = 0, after = 0;
        const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
        for (let vertex = 0; vertex < p.count; vertex++) {
          const x = site.x + site.scale * (c * p.getX(vertex) + s * p.getZ(vertex));
          const z = site.z + site.scale * (-s * p.getX(vertex) + c * p.getZ(vertex));
          const y = afterY + p.getY(vertex) * site.scale;
          for (const [axis, value] of [[0, x], [1, y], [2, z]]) {
            assert.ok(value >= collider.center[axis] - collider.halfExtents[axis] - 1e-6 && value <= collider.center[axis] + collider.halfExtents[axis] + 1e-6, 'every actual source vertex stays inside the original XYZ collider');
          }
          if (beforeY + p.getY(vertex) * site.scale > AUTUMN_WATER_LEVEL) before++;
          if (y > AUTUMN_WATER_LEVEL) after++;
        }
        if (before > 0) visibleBefore++; if (after > 0) visibleAfter++;
        verticesBefore += before; verticesAfter += after;
        assert.deepEqual(p.array, originalPositions, 'anchoring never edits the source geometry or attributes');
      }
      assert.ok(visibleAfter >= visibleBefore + 10, 'existing submerged source objects become visible without adding instances');
      assert.ok(verticesAfter > verticesBefore * 3, 'the improvement is substantial rather than a token anchor change');
    } finally { for (const geometry of Object.values(shapes)) geometry.dispose(); }
  }
  assert.equal(JSON.stringify({ sites: sourceShoreSites(), colliders: sourceShoreColliders() }), canonical, 'placement and collision metadata remain byte-identical');
});

test('a shallow existing collision volume clamps grounding safely and rejects impossible source bounds', () => {
  const spec = { groundY: 0, previousAnchorY: -.2, scale: 1, radius: 1, localMinY: -.7, localMaxY: .8 };
  const anchor = sourceShoreRockAnchor(spec);
  assert.equal(anchor, 0, 'the original upper collider face limits the otherwise higher grounded anchor');
  assert.ok(anchor + spec.localMinY >= spec.previousAnchorY - spec.radius);
  assert.ok(anchor + spec.localMaxY <= spec.previousAnchorY + spec.radius);
  assert.throws(() => sourceShoreRockAnchor({ ...spec, localMinY: -2 }), /cannot fit/);
  assert.throws(() => sourceShoreRockAnchor({ ...spec, scale: NaN }), /Invalid/);
});
