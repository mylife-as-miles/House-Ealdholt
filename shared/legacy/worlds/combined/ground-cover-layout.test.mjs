// CPU only. The fixed source generators are sampled, never rendered.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUND_COVER_CLEAR_ZONES, GROUND_COVER_LIMITS, GROUND_COVER_RADIUS, GROUND_COVER_SCALE, GROUND_COVER_SEEDS, planGroundCover } from './ground-cover-layout.ts';
import { AUTUMN_SETTLEMENT_BUILDINGS, AUTUMN_SETTLEMENT_EXTENT, AUTUMN_SETTLEMENT_PATHS, AUTUMN_WATER_LEVEL, SETTLEMENT_OPEN_GROUND, settlementHeight, settlementShore } from '../../environment/settlement/layout.ts';
import { settlementTreeSites } from '../../environment/settlement/nature.ts';
import { sourceShoreSites } from './shore-layout.ts';
import { grassTuft, reeds, shrub } from '../monolithwilds/src/world/vegetation-geo.js';
import { createRng, worldNoise } from '../monolithwilds/src/core/noise.js';

function edgeDistance(x, z, path) {
  let distance = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    const [ax, az] = path.points[i - 1], [bx, bz] = path.points[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance - path.width / 2;
}
const points = (site, radius) => Array.from({ length: 64 }, (_, i) => ({ x: site.x + Math.cos(i / 64 * Math.PI * 2) * radius, z: site.z + Math.sin(i / 64 * Math.PI * 2) * radius }));
function inside(point, rect, margin = 0) {
  const c = Math.cos(rect.yaw ?? 0), s = Math.sin(rect.yaw ?? 0), dx = point.x - rect.x, dz = point.z - rect.z;
  return Math.abs(c * dx - s * dz) < rect.width / 2 + margin && Math.abs(s * dx + c * dz) < rect.depth / 2 + margin;
}

test('the bounded pure plan is deterministic, detached and does not change canonical ground', () => {
  const before = JSON.stringify({ buildings: AUTUMN_SETTLEMENT_BUILDINGS, roads: AUTUMN_SETTLEMENT_PATHS, open: SETTLEMENT_OPEN_GROUND, trees: settlementTreeSites(), shore: sourceShoreSites() });
  const plan = planGroundCover();
  assert.deepEqual(planGroundCover(), plan);
  for (const [kind, sites] of Object.entries(plan)) {
    assert.ok(sites.length > 0 && sites.length <= GROUND_COVER_LIMITS[kind], kind);
    assert.ok(Object.isFrozen(sites));
    for (const site of sites) {
      assert.ok(Object.isFrozen(site));
      assert.ok(Object.values(site).every(Number.isFinite));
      assert.ok(site.scale >= GROUND_COVER_SCALE[kind][0] && site.scale <= GROUND_COVER_SCALE[kind][1]);
      assert.ok(site.seed >= 0 && site.seed < 1 && site.yaw >= 0 && site.yaw < Math.PI * 2);
    }
  }
  assert.equal(JSON.stringify({ buildings: AUTUMN_SETTLEMENT_BUILDINGS, roads: AUTUMN_SETTLEMENT_PATHS, open: SETTLEMENT_OPEN_GROUND, trees: settlementTreeSites(), shore: sourceShoreSites() }), before);
});

test('full source footprints occupy existing exclusions and avoid houses, clear zones, roads, rocks and each other', () => {
  const trees = settlementTreeSites().slice(0, 760), rocks = sourceShoreSites(), reserved = [...AUTUMN_SETTLEMENT_BUILDINGS, ...SETTLEMENT_OPEN_GROUND, ...GROUND_COVER_CLEAR_ZONES];
  const all = [];
  for (const [kind, sites] of Object.entries(planGroundCover())) for (const site of sites) {
    const radius = GROUND_COVER_RADIUS[kind] * site.scale, ring = points(site, radius);
    for (const p of [site, ...ring]) {
      assert.ok(p.x > AUTUMN_SETTLEMENT_EXTENT.minX && p.x < AUTUMN_SETTLEMENT_EXTENT.maxX && p.z > AUTUMN_SETTLEMENT_EXTENT.minZ && p.z < AUTUMN_SETTLEMENT_EXTENT.maxZ);
      assert.ok(reserved.every(rect => !inside(p, rect, .3)), `${kind} stays outside all protected lots`);
      for (const path of AUTUMN_SETTLEMENT_PATHS) assert.ok(edgeDistance(p.x, p.z, path) >= path.width / 2 * .035 + .005, `${kind} stays outside the actual road ribbon, including its width variation`);
      for (const rock of rocks) assert.ok(Math.hypot(p.x - rock.x, p.z - rock.z) >= rock.radius + .05, `${kind} avoids actual source boulder bounds`);
    }
    const shore = ring.every(p => p.x < settlementShore(p.z) + 7)
      && settlementHeight(site.x, site.z) >= AUTUMN_WATER_LEVEL - .25
      && settlementHeight(site.x, site.z) <= AUTUMN_WATER_LEVEL + 1.25;
    const trunk = trees.some(tree => ring.every(p => Math.abs(p.x - tree.x) < .8 * tree.scale && Math.abs(p.z - tree.z) < .8 * tree.scale));
    const verge = ring.every(p => Math.min(...AUTUMN_SETTLEMENT_PATHS.map(path => edgeDistance(p.x, p.z, path))) <= .65);
    assert.ok(shore || trunk || verge, `${kind} never consumes ordinary buildable ground`);
    if (kind.startsWith('reeds')) assert.ok(shore, 'reeds are confined to grounded near-water exclusions');
    for (const other of all) assert.ok(Math.hypot(site.x - other.site.x, site.z - other.site.z) >= radius + other.radius + .039, 'conservative decorative footprints do not overlap');
    all.push({ site, radius });
  }
});

test('declared footprint radii bound the exact source seeds including their maximum shader wind', () => {
  const source = {
    grass: { geometry: grassTuft(worldNoise, createRng(GROUND_COVER_SEEDS.grass)), triangles: 34 },
    reeds: reeds(worldNoise, createRng(GROUND_COVER_SEEDS.reeds)),
    shrubs: shrub(worldNoise, createRng(GROUND_COVER_SEEDS.shrub)),
  };
  const geometry = { grass: source.grass.geometry, reedsHero: source.reeds.lods[0], reedsFar: source.reeds.lods[1], shrubs: source.shrubs.lods[1] };
  try {
    for (const [kind, g] of Object.entries(geometry)) {
      let radius = 0, flutter = 0;
      for (let i = 0; i < g.attributes.position.count; i++) {
        radius = Math.max(radius, Math.hypot(g.attributes.position.getX(i), g.attributes.position.getZ(i)));
        flutter = Math.max(flutter, g.attributes.aVeg.getZ(i));
      }
      const sway = ( .55 + .2 + .4 ) * .55 * .035;
      const flutterRadius = Math.SQRT2 * flutter * .012 * .55;
      assert.ok(radius + sway + flutterRadius <= GROUND_COVER_RADIUS[kind], `${kind} accounts for source geometry and animated displacement`);
      assert.equal(g.index.count / 3, { grass: 34, reedsHero: 248, reedsFar: 5, shrubs: 20 }[kind]);
    }
    const worst = GROUND_COVER_LIMITS.grass * 34 + GROUND_COVER_LIMITS.reedsHero * 248 + GROUND_COVER_LIMITS.reedsFar * 5 + GROUND_COVER_LIMITS.shrubs * 20;
    assert.equal(worst, 6860, 'bounded source dressing costs at most6860 triangles in four draws');
  } finally {
    source.grass.geometry.dispose(); for (const g of [...source.reeds.lods, ...source.shrubs.lods]) g.dispose();
  }
});
