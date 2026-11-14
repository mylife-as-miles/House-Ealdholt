import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHAMBLE, UNDEAD_BUDGET, UNDEAD_SHOTS, UNDEAD_TIMING, UNDEAD_TORN, UNDEAD_WOUNDS, cornerPlates, haulRise, seamCorners, shambleWarp, twitch, undeadCounts,
  undeadEnvelope, undeadFrames, undeadShot, woundSchedule,
} from "../../web/src/scene/rites/undead/undeadPlan";
import { CROWD_BUDGET, type Flat } from "../../web/src/scene/rites/armies/crowdPlan";
import { slabEnd, squareAt } from "../../web/src/scene/rites/armies/groundPlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const FILES = "abcdefgh";
const sq = (name: string): Flat => ({ x: (FILES.indexOf(name[0]) - 3.5) * TILE, z: (3.5 - (Number(name[1]) - 1)) * TILE });
const distance = (a: Flat, b: Flat) => Math.hypot(a.x - b.x, a.z - b.z);
const TAKE = ["a1", "b1", "c1", "e1", "f1", "g1", "h1", "a2", "b2", "c2", "d2", "f2", "g2", "h2", "e5", "g4", "a6", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "a8", "b8", "c8", "d8", "e8", "f8", "h8"].map(sq);

test("the undead army is the crowd budget's, and thins on the lowest tier", () => {
  for (const tier of tiers) assert.equal(undeadCounts(tier).troops, CROWD_BUDGET[tier].troops);
  for (let i = 1; i < tiers.length; i += 1) for (const key of ["chains", "seamArcs", "sparks", "grit", "smoke"] as const) assert.ok(UNDEAD_BUDGET[tiers[i]][key] > UNDEAD_BUDGET[tiers[i - 1]][key], key);
});

test("the goriest sequence answers to the Violence setting: a frenzy at Full, fewer at Cinematic, none at Minimal", () => {
  for (const tier of tiers) {
    assert.equal(UNDEAD_WOUNDS.minimal[tier], 0);
    assert.ok(UNDEAD_WOUNDS.cinematic[tier] >= 2 && UNDEAD_WOUNDS.full[tier] >= UNDEAD_WOUNDS.cinematic[tier] * 1.8);
  }
  assert.deepEqual(UNDEAD_TORN.minimal, { tear: 0, bone: 0 }, "nothing torn and no bone at Minimal");
  assert.equal(UNDEAD_TORN.cinematic.bone, 0, "no bone at Cinematic");
  assert.ok(UNDEAD_TORN.cinematic.tear > 0 && UNDEAD_TORN.cinematic.tear < UNDEAD_TORN.full.tear, "a little torn at Cinematic, more at Full");
  const arrivals = [1.9, 2.0, 2.1, 2.2, 2.3, 2.35];
  assert.deepEqual(woundSchedule("minimal", "ultra", arrivals, 3), []);
  for (const violence of ["cinematic", "full"] as const) for (const tier of tiers) {
    const wounds = woundSchedule(violence, tier, arrivals, 9);
    assert.equal(wounds.length, UNDEAD_WOUNDS[violence][tier]);
    const kills = wounds.filter((w) => w.kills);
    assert.equal(kills.length, 1, "one blow kills");
    assert.equal(kills[0].at, UNDEAD_TIMING.strike, "and it lands on strikeAt");
    for (let i = 1; i < wounds.length; i += 1) assert.ok(wounds[i].at >= wounds[i - 1].at, "in order");
    for (const wound of wounds) {
      assert.ok(wound.at >= arrivals[wound.by] + 0.12 - 1e-9, "dealt only by one who has reached the victim");
      assert.ok(wound.power > 0 && wound.power <= 2);
    }
    const after = wounds.filter((w) => w.at > UNDEAD_TIMING.strike);
    assert.equal(after.length > 0, violence === "full", "only at Full do they tear at what is left");
    for (const w of after) assert.ok(w.at <= UNDEAD_TIMING.feed);
  }
  assert.deepEqual(woundSchedule("full", "high", arrivals, 9), woundSchedule("full", "high", arrivals, 9));
});

test("the beats: split, rise, shamble, swarm, the blow between 1.5 and 3 s, sink, and all gone within 8", () => {
  const T = UNDEAD_TIMING;
  assert.ok(T.strike >= 1.5 && T.strike <= 3 && T.done <= 8 && T.done >= 5);
  assert.ok(T.split < T.rise.from && T.rise.from + T.rise.spread + T.rise.length < T.arrive.first + T.arrive.spread);
  assert.ok(T.arrive.first < T.strike - 0.5, "the dead are at the victim well before the blow");
  assert.ok(T.feed < T.sink.from && T.sink.from + T.sink.spread + T.sink.length < T.done);
  assert.ok(T.healed < T.done);
  const end = undeadEnvelope(T.done, 3);
  assert.equal(end.scar, 0); assert.equal(end.seams, 0); assert.equal(end.light, 0); assert.ok(end.done);
  for (let t = 0; t <= T.done; t += 0.05) {
    const e = undeadEnvelope(t, 3);
    assert.ok(e.seamFront >= 0 && e.seamFront <= T.seamReach + 1e-9 && e.shake <= 0.6 && Number.isFinite(e.light));
    assert.equal(undeadEnvelope(t, 3, true).shake, 0);
  }
});

test("the dead come up at the corners between the squares, clear of every piece, spread round the victim", () => {
  const victim = sq("e4");
  const corners = seamCorners({ centre: victim, standing: TAKE, count: 16, inner: 1.05, outer: 2.25, clearance: 0.42, spacing: 0.7, tile: TILE, seed: 5, favour: { x: 0, z: 1 } });
  assert.ok(corners.length >= 7, `${corners.length} corners`);
  for (const at of corners) {
    assert.ok(Math.abs(at.x / TILE - Math.round(at.x / TILE)) < 1e-9 && Math.abs(at.z / TILE - Math.round(at.z / TILE)) < 1e-9, "on a corner");
    assert.ok(Math.abs(at.x) <= 3 * TILE + 1e-9 && Math.abs(at.z) <= 3 * TILE + 1e-9, "inside the rim");
    const r = distance(at, victim);
    assert.ok(r >= 1.05 && r <= 2.25);
    for (const piece of TAKE) assert.ok(distance(at, piece) >= 0.42);
  }
  for (let i = 0; i < corners.length; i += 1) for (let j = i + 1; j < corners.length; j += 1) assert.ok(distance(corners[i], corners[j]) >= 0.7 - 1e-9);
});

test("the stone heaves round each corner: a quarter of each free square, never under a piece, down again after", () => {
  const corner = { x: TILE, z: 0 };
  const plates = cornerPlates(corner, TILE, 0.5, 0.85, 3, [sq("f4")], 0.55);
  assert.equal(plates.length, 3, "the square a piece stands on keeps its stone down");
  for (const plate of plates) {
    const home = squareAt(plate.at, TILE)!;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) assert.deepEqual(squareAt({ x: plate.at.x + sx * plate.width / 2, z: plate.at.z + sz * plate.depth / 2 }, TILE), home, "inside its own square");
    assert.ok(plate.birth >= 0.5 && plate.birth < 0.6 && slabEnd(plate) < 0.5 + 0.85 + 0.9, "up as the body pushes through, down soon after");
    assert.ok((plate.at.x - corner.x) * plate.away.x + (plate.at.z - corner.z) * plate.away.z > 0, "heaved on its corner's side");
  }
});

test("a body hauls itself up in heaves, shambles in lurches that keep its arrival, and twitches", () => {
  assert.equal(haulRise(0), 0); assert.ok(Math.abs(haulRise(1) - 1) < 1e-9);
  let last = 0, pauses = 0;
  for (let u = 0.005; u <= 1; u += 0.005) {
    const h = haulRise(u);
    assert.ok(h >= last - 1e-12, "it never slips back");
    if (h - last < 1e-4) pauses += 1;
    last = h;
  }
  assert.ok(pauses > 5, "it hangs between heaves");
  for (const lurches of [2, 3, 5]) {
    assert.equal(shambleWarp(0, lurches), 0); assert.ok(Math.abs(shambleWarp(1, lurches) - 1) < 1e-12, "it arrives when the march says");
    let previous = 0, slowest = Infinity, fastest = 0;
    for (let u = 0.01; u <= 1.0001; u += 0.01) {
      const w = shambleWarp(u, lurches), step = w - previous;
      assert.ok(step >= -1e-12);
      slowest = Math.min(slowest, step); fastest = Math.max(fastest, step);
      previous = w;
    }
    assert.ok(fastest > slowest * 4, "lurches: surges and near stops");
  }
  let moved = 0;
  for (let t = 0; t < 7; t += 0.02) moved = Math.max(moved, Math.abs(twitch(t, 4)));
  assert.ok(moved > 0.08 && moved < 0.5, "a sudden turn, not a spin");
  assert.ok(SHAMBLE.top < 2, "a shamble, not a run");
});

test("the camera's beats keep the rising, the swarm and what is left in frame", () => {
  assert.deepEqual([0, UNDEAD_SHOTS.rise, UNDEAD_SHOTS.swarm, UNDEAD_SHOTS.after].map(undeadShot), [0, 1, 2, 3]);
  assert.ok(UNDEAD_SHOTS.swarm + 0.95 < UNDEAD_TIMING.strike, "the camera is on the swarm before the blow");
  const frames = undeadFrames({ queen: { x: 2.55, y: 0, z: 0.51 }, victim: { x: 0.51, y: 0, z: 0.51 }, spawns: [sq("d3"), sq("f5"), sq("c5")], boardTop: 0 });
  assert.equal(frames.length, 4);
  assert.equal(frames[1].length, 6, "every place one rises, the victim, and a point above it");
  for (const frame of frames) assert.ok(Math.max(...frame.map((p) => p.y)) >= 2.7, "high enough to look over the pieces in front");
});

test("the dead who never get out reach up through the split seams, clear of the pieces and of the risen, and go back under", async () => {
  const { seamHands, handPose } = await import("../../web/src/scene/rites/undead/undeadPlan");
  const victim = sq("e4"), keepOut = [sq("d3"), sq("f5")];
  const hands = seamHands({ centre: victim, standing: TAKE, keepOut, count: 20, tile: TILE, seed: 8 });
  assert.ok(hands.length >= 10, `${hands.length} hands`);
  for (const hand of hands) {
    const onSeamX = Math.abs(hand.at.x / TILE - Math.round(hand.at.x / TILE)) < 1e-9, onSeamZ = Math.abs(hand.at.z / TILE - Math.round(hand.at.z / TILE)) < 1e-9;
    assert.ok(onSeamX || onSeamZ, "on a seam");
    for (const piece of TAKE) assert.ok(distance(hand.at, piece) >= 0.36);
    for (const spot of keepOut) assert.ok(distance(hand.at, spot) >= 0.34);
    assert.ok(hand.rise > UNDEAD_TIMING.split && hand.rise < UNDEAD_TIMING.strike && hand.sink + 0.5 < UNDEAD_TIMING.done);
    assert.equal(handPose(hand, hand.rise - 0.01).shown, false);
    assert.ok(handPose(hand, hand.rise + 0.5).up > 0.99);
    assert.equal(handPose(hand, hand.sink + 0.51).shown, false);
    for (let t = hand.rise; t < hand.sink + 0.5; t += 0.05) { const pose = handPose(hand, t); assert.ok(pose.grasp >= 0 && pose.grasp <= 1 && pose.up >= 0 && pose.up <= 1); }
  }
});
