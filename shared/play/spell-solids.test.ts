import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK_FLIGHT, EMERGENCE_PEAK, chunkFlight, chunkGeometry, crystalGeometry, emergence, packSolids, type Solid } from "../../web/src/scene/vfx/spells/shared/solidPlan";

type V = [number, number, number];
const triangles = (positions: Float32Array) => {
  const out: [V, V, V][] = [];
  for (let i = 0; i < positions.length; i += 9) out.push([[positions[i], positions[i + 1], positions[i + 2]], [positions[i + 3], positions[i + 4], positions[i + 5]], [positions[i + 6], positions[i + 7], positions[i + 8]]]);
  return out;
};
const normal = ([a, b, c]: [V, V, V]): V => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};

test("a crystal is a closed-sided faceted spike in a unit space: base on the stone, tip at one", () => {
  for (const seed of [1, 2, 3, 17, 404]) for (const sides of [5, 6, 7]) {
    const positions = crystalGeometry(seed, { sides, rough: 0.6, bend: 0.35 });
    assert.equal(positions.length, (sides * 2 * 2 + sides) * 9, "two rings of sides and a tip");
    let top = -1, low = 9, reach = 0;
    for (let i = 0; i < positions.length; i += 3) {
      top = Math.max(top, positions[i + 1]); low = Math.min(low, positions[i + 1]);
      reach = Math.max(reach, Math.hypot(positions[i], positions[i + 2]));
      assert.ok(Number.isFinite(positions[i]) && Number.isFinite(positions[i + 1]) && Number.isFinite(positions[i + 2]));
    }
    assert.equal(top, 1); assert.equal(low, 0);
    assert.ok(reach > 0.4 && reach < 0.7, `the base is about half a unit out (${reach.toFixed(2)})`);
  }
});

test("every face of a crystal and of a broken piece looks outward, so it is lit from outside", () => {
  for (const seed of [1, 2, 3, 17, 404]) {
    const faces = triangles(crystalGeometry(seed, { rough: 0.6, bend: 0.3 }));
    const tip = faces.flat().find((point) => point[1] === 1)!;
    for (const face of faces) {
      const n = normal(face), mid = [0, 1, 2].map((k) => (face[0][k] + face[1][k] + face[2][k]) / 3);
      // the axis bends over to the tip as it climbs; a face looks away from the axis at its own height
      const drift = mid[1] ** 1.6;
      assert.ok(n[0] * (mid[0] - tip[0] * drift) + n[2] * (mid[2] - tip[2] * drift) > 0, `crystal ${seed}`);
      assert.ok(Math.hypot(...n) > 1e-5, "no face is a sliver");
    }
    const chunk = chunkGeometry(seed);
    assert.equal(chunk.length, 10 * 9);
    for (const face of triangles(chunk)) {
      const n = normal(face), mid = [0, 1, 2].map((k) => (face[0][k] + face[1][k] + face[2][k]) / 3);
      assert.ok(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0, `chunk ${seed}`);
    }
    for (let i = 0; i < chunk.length; i += 3) assert.ok(Math.hypot(chunk[i], chunk[i + 1], chunk[i + 2]) <= 0.62);
  }
});

test("the same seed cuts the same crystal, and different seeds cut different ones", () => {
  assert.deepEqual([...crystalGeometry(5)], [...crystalGeometry(5)]);
  assert.notDeepEqual([...crystalGeometry(5)], [...crystalGeometry(6)]);
  assert.notDeepEqual([...chunkGeometry(5)], [...chunkGeometry(6)]);
});

test("a spike is buried until it breaks through, grows fast, overshoots once and settles", () => {
  const rise = 0.2, bounce = 0.16;
  assert.equal(emergence(-1, rise, bounce), 0); assert.equal(emergence(0, rise, bounce), 0);
  assert.ok(emergence(rise * 0.5, rise, bounce) > 0.6, "most of the way up by half the rise");
  let peak = 0, peakAt = 0, last = 0;
  for (let t = 0; t <= rise * EMERGENCE_PEAK + 1e-9; t += rise / 400) { const e = emergence(t, rise, bounce); assert.ok(e >= last - 1e-9, "it only rises until its peak"); last = e; }
  for (let t = 0; t < 1.5; t += 0.0005) { const e = emergence(t, rise, bounce); if (e > peak) { peak = e; peakAt = t; } assert.ok(e > -1e-9 && e < 1.2); }
  assert.ok(Math.abs(peak - (1 + bounce)) < 2e-3, `it passes its height by the bounce (${peak.toFixed(4)})`);
  assert.ok(Math.abs(peakAt - rise * EMERGENCE_PEAK) < 2e-3);
  assert.ok(emergence(rise * 1.6, rise, bounce) < 1, "then dips under it");
  assert.ok(Math.abs(emergence(1.5, rise, bounce) - 1) < 1e-4, "and settles at its height");
});

test("with no bounce a spike eases up and stops: nothing springs in the brief form", () => {
  let last = 0;
  for (let t = 0; t <= 1; t += 0.01) { const e = emergence(t, 0.6, 0); assert.ok(e >= last && e <= 1); last = e; }
  assert.equal(emergence(0.6, 0.6, 0), 1); assert.equal(emergence(5, 0.6, 0), 1);
  assert.ok(Math.abs(emergence(0.3, 0.6, 0) - 0.5) < 1e-9);
});

test("a broken piece flies, lands, hops once, skids and lies still, and never goes under the stone", () => {
  const from = { x: 0, y: 1.2, z: 0 }, fling = { x: 2.4, y: 2.2, z: -1 }, floor = 0.05;
  let landedAt = -1, last = chunkFlight(from, fling, floor, 0);
  assert.deepEqual([last.x, last.y, last.z], [0, 1.2, 0]);
  for (let t = 0.002; t < 4; t += 0.002) {
    const at = chunkFlight(from, fling, floor, t);
    assert.ok(at.y >= floor - 1e-9, `above the stone at ${t.toFixed(3)}`);
    assert.ok(Math.hypot(at.x - last.x, at.y - last.y, at.z - last.z) < 0.03, `no jump at ${t.toFixed(3)}`);
    assert.ok(at.turned >= last.turned - 1e-12, "it never untumbles");
    if (at.landed && landedAt < 0) landedAt = t;
    last = at;
  }
  const expected = (fling.y + Math.sqrt(fling.y ** 2 + 2 * CHUNK_FLIGHT.gravity * (from.y - floor))) / CHUNK_FLIGHT.gravity;
  assert.ok(Math.abs(landedAt - expected) < 0.004);
  const rest = chunkFlight(from, fling, floor, 4), later = chunkFlight(from, fling, floor, 9);
  assert.equal(rest.y, floor);
  assert.ok(Math.hypot(later.x - rest.x, later.z - rest.z) < 1e-5, "it has stopped");
  assert.ok(rest.x > fling.x * expected, "it skidded on past where it landed");
  assert.ok(rest.x < fling.x * (expected + 1 / CHUNK_FLIGHT.friction) + 1e-9, "but only as far as friction allows");
  assert.ok(Math.abs(later.turned - rest.turned) < 1e-5, "and stopped turning");
});

const spike: Solid = { loose: false, root: { x: 1, y: 0, z: 2 }, radius: 0.1, height: 0.9, lean: { x: 0.2, z: -0.1 }, yaw: 1, seed: 0.4, birth: 0.5, rise: 0.2, breakAt: 2, end: 0.3 };
const piece: Solid = { loose: true, root: { x: 1, y: 0.6, z: 2 }, radius: 0.05, height: 0.08, lean: { x: 0, z: 0 }, spin: 7, yaw: 2, seed: 0.7, birth: 2.1, rise: 0.5, breakAt: 0, end: 3.4, fling: { x: 1, y: 2, z: 0 } };

test("a field of solids is written once, rooted and loose alike, and knows when its last piece is gone", () => {
  const packed = packSolids([spike, piece], 8);
  assert.equal(packed.count, 2);
  assert.deepEqual([...packed.size].map((v) => +v.toFixed(3)), [0.1, 0.9, 0, 0.05, 0.08, 1]);
  assert.deepEqual([...packed.lean].map((v) => +v.toFixed(3)), [0.2, -0.1, 1, 0.4, 7, 0, 2, 0.7]);
  assert.deepEqual([...packed.life].map((v) => +v.toFixed(3)), [0.5, 0.2, 2, 0.3, 2.1, 0.5, 0, 3.4]);
  assert.deepEqual([...packed.fling], [0, 0, 0, 1, 2, 0]);
  assert.ok(Math.abs(packed.spent - 3.4) < 1e-9);
  assert.ok(Math.abs(packSolids([spike], 8).spent - 2.3) < 1e-9, "a spike is gone when it has finished breaking");
  assert.equal(packSolids([spike, piece], 1).count, 1);
  assert.equal(packSolids([spike, piece], 1).size[2], 0, "what is listed first is kept");
});
