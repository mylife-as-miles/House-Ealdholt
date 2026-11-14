import { test } from "node:test";
import assert from "node:assert/strict";
import { acrossProfile, dice, kink, linearNoise, pinned, pixelFloor, ribbonIndex, ribbonSize, ribbonVertices, strandSeeds, strandShape } from "../../web/src/scene/vfx/spells/shared/ribbonPlan";

const close = (actual: number, expected: number, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);

test("a strand is a strip of (t, side): two vertices at every cut and two triangles between cuts", () => {
  const segments = 8, vertices = ribbonVertices(segments), index = ribbonIndex(segments);
  assert.deepEqual(ribbonSize(segments), { vertices: 18, indices: 48 });
  assert.equal(vertices.length, 18 * 3); assert.equal(index.length, 48);
  for (let i = 0; i <= segments; i += 1) {
    close(vertices[i * 6], i / segments, 1e-6); close(vertices[i * 6 + 3], i / segments, 1e-6);
    assert.equal(vertices[i * 6 + 1], -1); assert.equal(vertices[i * 6 + 4], 1);
    assert.equal(vertices[i * 6 + 2], 0); assert.equal(vertices[i * 6 + 5], 0);
  }
  assert.ok(Math.max(...index) === 17 && Math.min(...index) === 0);
  // every triangle joins neighbouring cuts and none is degenerate
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
    assert.equal(new Set([a, b, c]).size, 3);
    assert.ok(Math.max(a, b, c) - Math.min(a, b, c) <= 3);
  }
});

test("dice are seeded: the same seed gives the same strands, another seed gives others", () => {
  const a = dice(7), b = dice(7), c = dice(8);
  const first = [a(), a(), a()], again = [b(), b(), b()], other = [c(), c(), c()];
  assert.deepEqual(first, again); assert.notDeepEqual(first, other);
  for (const value of first) assert.ok(value >= 0 && value < 1);
  const seeds = strandSeeds(42, 5);
  assert.deepEqual(Array.from(seeds), Array.from(strandSeeds(42, 5)));
  assert.notDeepEqual(Array.from(seeds), Array.from(strandSeeds(43, 5)));
  // x is the strand's place in the bundle, the first to the last
  for (let i = 0; i < 5; i += 1) close(seeds[i * 4], i / 4, 1e-6);
  assert.equal(strandSeeds(42, 1)[0], 0);
});

test("a kink is a zigzag: straight between corners, a corner at every whole number, never beyond its octaves", () => {
  for (const seed of [0, 3.3, 91]) {
    for (let i = 0; i < 6; i += 1) {
      const a = linearNoise(i, seed), b = linearNoise(i + 1, seed);
      assert.ok(a >= -1 && a <= 1);
      // straight between whole numbers: the midpoint is the mean, a quarter of the way is a quarter of the way
      close(linearNoise(i + 0.5, seed), (a + b) / 2, 1e-9); close(linearNoise(i + 0.25, seed), a + (b - a) * 0.25, 1e-9);
    }
  }
  // it has corners: the slope either side of a whole number is not the same
  const slopes = [1, 2, 3, 4].map((i) => [linearNoise(i, 5) - linearNoise(i - 0.01, 5), linearNoise(i + 0.01, 5) - linearNoise(i, 5)]);
  assert.ok(slopes.some(([before, after]) => Math.abs(before - after) > 1e-3));
  for (const t of [0, 0.13, 0.5, 0.77, 1]) {
    const three = kink(t, 9, 6, 3, 0.5), one = kink(t, 9, 6, 1, 0.5);
    assert.ok(Math.abs(three.x) <= 1.75 && Math.abs(three.y) <= 1.75 && Math.abs(one.x) <= 1 && Math.abs(one.y) <= 1);
  }
  assert.notDeepEqual(kink(0.4, 9, 6), kink(0.4, 10, 6));
});

test("a filament is pinned at the hand and, when asked, at the target", () => {
  close(pinned(0, 0.12), 0); close(pinned(1, 0.12), 0); close(pinned(0.5, 0.12), 1);
  assert.ok(pinned(0.04, 0.12) < pinned(0.08, 0.12));
  // with no convergence it is free at the far end and still pinned at the hand
  close(pinned(1, 0.12, 0), 1); close(pinned(0, 0.12, 0), 0);
  assert.ok(pinned(0.97, 0.12, 0.5) > pinned(0.97, 0.12, 1));
});

test("the channel keeps its shape for a few strikes while the filaments round it are new every time", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((tick) => strandShape(0, tick, 4)), [0, 0, 0, 0, 1, 1, 1, 1, 2]);
  assert.deepEqual([0, 1, 2, 3].map((tick) => strandShape(3, tick, 4)), [0, 1, 2, 3]);
  assert.equal(strandShape(0, 5, 0), 5);
});

test("a ribbon never thins below a pixel, and a sheath is brightest at its limbs", () => {
  const pixel = (2 * Math.tan((40 * Math.PI) / 360)) / 720;
  close(pixelFloor(pixel, 1.5, 12), pixel * 0.75 * 12);
  assert.equal(pixelFloor(pixel, 1.5, -1), 0);
  assert.ok(pixelFloor(pixel, 1.5, 12) > 0.005 && pixelFloor(pixel, 1.5, 12) < 0.02, "about a hundredth of a unit at the player's camera");
  close(acrossProfile(0, "thread"), 1); close(acrossProfile(1, "thread"), 0); close(acrossProfile(-1, "thread"), 0);
  assert.ok(acrossProfile(0.5, "thread", 4) < acrossProfile(0.5, "thread", 1.5));
  assert.ok(acrossProfile(0.8, "shell") > acrossProfile(0.4, "shell") && acrossProfile(0.4, "shell") > acrossProfile(0, "shell") && acrossProfile(0, "shell") > 0.2);
  close(acrossProfile(1, "shell"), 0);
  close(acrossProfile(0.6, "shell"), acrossProfile(-0.6, "shell"));
});
