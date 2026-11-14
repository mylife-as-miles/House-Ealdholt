import { test } from "node:test";
import assert from "node:assert/strict";
import { frontArrival, frontRadius, lightAt, planSlabs, scarLeft, slabEnd, slabPose, squareAt, type SlabOptions } from "../../web/src/scene/rites/armies/groundPlan";
import type { Flat } from "../../web/src/scene/rites/armies/crowdPlan";

const TILE = 1.02, HALF = 4 * TILE;
const FILES = "abcdefgh";
const sq = (name: string): Flat => ({ x: (FILES.indexOf(name[0]) - 3.5) * TILE, z: (3.5 - (Number(name[1]) - 1)) * TILE });
const distance = (a: Flat, b: Flat) => Math.hypot(a.x - b.x, a.z - b.z);
const TAKE = ["a1", "b1", "c1", "e1", "f1", "g1", "h1", "a2", "b2", "c2", "d2", "f2", "g2", "h2", "e5", "g4", "a6", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "a8", "b8", "c8", "d8", "e8", "f8", "h8"].map(sq);

const slabs = (over: Partial<SlabOptions> = {}) => planSlabs({
  centre: sq("e4"), standing: TAKE, count: 14, inner: 0.7, outer: 2.6, clearance: 0.36, bounds: HALF - 0.05, tile: TILE, seed: 77, blow: 2.85, reach: 3.2, spread: 0.7, ...over,
});

test("the front is fast out of the blow and slows as it spreads; its arrival is the inverse of its run", () => {
  let last = 0, lastStep = Infinity;
  for (let t = 0.02; t <= 0.7; t += 0.02) {
    const r = frontRadius(t, 3.2, 0.7);
    assert.ok(r > last, "it always runs on");
    assert.ok(r - last <= lastStep + 1e-9, "and slows as it goes");
    lastStep = r - last; last = r;
    assert.ok(Math.abs(frontArrival(r, 3.2, 0.7) - t) < 1e-9);
  }
  assert.equal(frontRadius(0, 3.2, 0.7), 0); assert.ok(Math.abs(frontRadius(5, 3.2, 0.7) - 3.2) < 1e-12);
  assert.equal(frontArrival(4, 3.2, 0.7), Infinity);
});

test("a square's stone is the board's: light and dark as board.ts has them", () => {
  // a1 is dark, h1 light, a8 light, e4 light
  assert.equal(lightAt(sq("a1"), TILE), false); assert.equal(lightAt(sq("h1"), TILE), true);
  assert.equal(lightAt(sq("a8"), TILE), true); assert.equal(lightAt(sq("e4"), TILE), true); assert.equal(lightAt(sq("d4"), TILE), false);
  assert.deepEqual(squareAt(sq("c6"), TILE), { file: 2, rank: 5 });
  assert.equal(squareAt({ x: 5, z: 0 }, TILE), null);
});

test("slabs come up from free stone only, each inside one square, never under a piece, never on each other", () => {
  for (const seed of [1, 77, 4040]) {
    const list = slabs({ seed });
    assert.ok(list.length >= 8, `seed ${seed}: ${list.length} slabs`);
    for (const slab of list) {
      const reach = Math.hypot(slab.width, slab.depth) / 2;
      for (const piece of TAKE) assert.ok(distance(piece, slab.at) >= 0.36 + reach - 1e-9, "a slab under a piece");
      assert.ok(distance(slab.at, sq("e4")) >= 0.7 * 0.9 - 1e-9, "never from under the victim");
      // all four corners are on the same square as its middle
      const home = squareAt(slab.at, TILE)!;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) assert.deepEqual(squareAt({ x: slab.at.x + sx * slab.width / 2, z: slab.at.z + sz * slab.depth / 2 }, TILE), home);
      assert.equal(slab.light, lightAt(slab.at, TILE));
      assert.ok(slab.birth >= 2.85 && slab.birth <= 2.85 + 0.7, "it goes up when the front reaches it");
      assert.ok(Math.abs(slab.birth - 2.85 - frontArrival(distance(slab.at, sq("e4")), 3.2, 0.7)) < 1e-9);
    }
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      assert.ok(distance(a.at, b.at) >= (Math.hypot(a.width, a.depth) + Math.hypot(b.width, b.depth)) / 2 * 0.92 - 1e-9, "slabs overlap");
    }
    // the big ones nearest the blow
    const nearest = [...list].sort((a, b) => distance(a.at, sq("e4")) - distance(b.at, sq("e4")));
    assert.ok(nearest[0].width * nearest[0].depth >= nearest[nearest.length - 1].width * nearest[nearest.length - 1].depth);
  }
  assert.deepEqual(slabs(), slabs(), "the same blow lifts the same slabs");
  const zone = { at: sq("e6"), radius: 0.9 };
  for (const slab of slabs({ avoid: [zone] })) assert.ok(distance(slab.at, zone.at) >= zone.radius);
});

test("a slab is thrown, hangs, falls back into its own place, bounces and lies flush: the board is whole again", () => {
  for (const slab of slabs()) {
    assert.equal(slabPose(slab, slab.birth - 0.01).shown, false);
    let peak = 0, last = slabPose(slab, slab.birth);
    for (let t = slab.birth; t <= slabEnd(slab) + 0.1; t += 1 / 240) {
      const pose = slabPose(slab, t);
      assert.ok(pose.lift >= 0 && Number.isFinite(pose.lift + pose.tilt + pose.spin + pose.hole), "never below the stone, never undefined");
      assert.ok(Math.abs(pose.lift - last.lift) < 0.12, `no jump at ${t.toFixed(3)}`);
      peak = Math.max(peak, pose.lift);
      last = pose;
    }
    assert.ok(peak >= slab.lift * 0.99, "it reaches its height");
    const end = slabPose(slab, slabEnd(slab) + 1e-6);
    assert.deepEqual(end, { lift: 0, tilt: 0, spin: 0, hole: 0, shown: false });
    const almost = slabPose(slab, slabEnd(slab) - 0.02);
    assert.ok(almost.lift < 0.01 && almost.hole < 0.05, "nearly flush before it is put away");
    assert.ok(slabEnd(slab) < 2.85 + 0.7 + 2.2, "every slab is down within about two seconds of the front");
  }
});

test("a scar opens, stays, and closes smoothly by the time it should be healed", () => {
  assert.equal(scarLeft(1, 2, 4, 6), 0); assert.equal(scarLeft(3, 2, 4, 6), 1); assert.equal(scarLeft(6, 2, 4, 6), 0);
  let last = 1;
  for (let t = 4; t <= 6; t += 0.05) { const left = scarLeft(t, 2, 4, 6); assert.ok(left <= last + 1e-12); last = left; }
  assert.ok(Math.abs(scarLeft(5, 2, 4, 6) - 0.5) < 1e-9);
});
