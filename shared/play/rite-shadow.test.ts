import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLOSSUS_RESERVE, SHADOW_BLAST, SHADOW_BUDGET, SHADOW_FOG, SHADOW_SHOTS, SHADOW_TIMING, burnt, colossusPose, placeColossus, recoil, shadowCounts, shadowEnvelope,
  shadowFrames, shadowShot, soldierBeats,
} from "../../web/src/scene/rites/shadow/shadowPlan";
import { CROWD_BUDGET, MUSTER_LIMIT, type Flat } from "../../web/src/scene/rites/armies/crowdPlan";
import { frontArrival } from "../../web/src/scene/rites/armies/groundPlan";

const TILE = 1.02, HALF = 4 * TILE;
const tiers = ["low", "medium", "high", "ultra"] as const;
const FILES = "abcdefgh";
const sq = (name: string): Flat => ({ x: (FILES.indexOf(name[0]) - 3.5) * TILE, z: (3.5 - (Number(name[1]) - 1)) * TILE });
const distance = (a: Flat, b: Flat) => Math.hypot(a.x - b.x, a.z - b.z);
const TAKE = ["a1", "b1", "c1", "e1", "f1", "g1", "h1", "a2", "b2", "c2", "d2", "f2", "g2", "h2", "e5", "g4", "a6", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "a8", "b8", "c8", "d8", "e8", "f8", "h8"].map(sq);
const WHITE: Flat = { x: 0, z: 8.6 }, BLACK: Flat = { x: 0, z: -8.6 };

test("the shadow army fits the crowd budget, the match's limit with its colossus, and thins on the lowest tier", () => {
  for (const tier of tiers) {
    const counts = shadowCounts(tier);
    assert.equal(counts.fusiliers + counts.cuirassiers, Math.min(CROWD_BUDGET[tier].troops, MUSTER_LIMIT - COLOSSUS_RESERVE));
    assert.ok(counts.cuirassiers >= 1 && counts.fusiliers > counts.cuirassiers, "mostly the musket line, some sabres");
    assert.ok(counts.fusiliers + counts.cuirassiers + COLOSSUS_RESERVE <= MUSTER_LIMIT);
  }
  for (let i = 1; i < tiers.length; i += 1) for (const key of ["silhouettes", "fog", "smoke", "dust", "embers", "sparks", "slabs", "shrapnel", "arcs"] as const) {
    assert.ok(SHADOW_BUDGET[tiers[i]][key] > SHADOW_BUDGET[tiers[i - 1]][key], `${key} at ${tiers[i]}`);
  }
  assert.ok(SHADOW_BUDGET.low.bolts >= 1 && SHADOW_BUDGET.low.fog > 0 && SHADOW_BUDGET.low.slabs > 0, "the lowest tier still has its lightning, its fog and its broken stone");
});

test("the fog is inky: every tone of it far below pale stone, deep below fog, and it never hides more than 0.6 of the board", () => {
  const linear = (byte: number) => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = (hex: number) => 0.2126 * linear((hex >> 16) & 255) + 0.7152 * linear((hex >> 8) & 255) + 0.0722 * linear(hex & 255);
  // the lavender it was (0xa89cb8) stood at about 0.36, as pale as the light squares
  for (const key of ["fog", "deep", "hot", "mid", "cool"] as const) assert.ok(luminance(SHADOW_FOG[key]) < 0.1, `${key} is ink, not lavender`);
  assert.ok(luminance(SHADOW_FOG.deep) < luminance(SHADOW_FOG.fog), "it is darkest in its depths");
  assert.ok(SHADOW_FOG.cover > 0.3 && SHADOW_FOG.cover <= 0.6, "the shadows stand on it, the board shows through it");
});

test("the beats follow one another, the blow lands between 1.5 and 3 seconds, and it is all over within 8", () => {
  const T = SHADOW_TIMING;
  assert.ok(T.strike >= 1.5 && T.strike <= 3);
  assert.ok(T.done <= 8 && T.done >= 5);
  assert.ok(T.seal < T.sealDrawn && T.fog < T.rise.from && T.rise.from + T.rise.spread + T.rise.length < T.arrive.first + T.arrive.spread);
  assert.ok(T.arrive.first + T.arrive.spread < T.strike, "the ring is closed before the blow");
  assert.ok(T.colossus < T.stands && T.stands < T.windup && T.windup < T.strike && T.strike < T.withdraw && T.withdraw < T.gone);
  assert.ok(T.burn.from > T.strike && T.burn.from + T.burn.spread + T.burn.length < T.done, "the soldiers burn away after the blow and are gone before the end");
  assert.ok(T.sealGone < T.done && T.healed < T.done && T.fogGone < T.done, "nothing of it is left on the board when it is done");
  // the slabs the front reaches last are down before the cracks have closed
  assert.ok(T.strike + frontArrival(SHADOW_BLAST.outer, SHADOW_BLAST.reach, SHADOW_BLAST.spread) + 2.2 < T.healed);
});

test("the seal opens behind the victim from the player's side, on the board, where the fewest pieces stand", () => {
  for (const [victim, eye] of [[sq("e4"), WHITE], [sq("e4"), BLACK], [sq("d6"), WHITE], [sq("c3"), BLACK]] as const) {
    const spot = placeColossus({ victim, viewer: eye, standing: TAKE, half: HALF, tile: TILE });
    const away = { x: victim.x - eye.x, z: victim.z - eye.z }, toSeal = { x: spot.at.x - victim.x, z: spot.at.z - victim.z };
    assert.ok(away.x * toSeal.x + away.z * toSeal.z > 0, "beyond the victim, not between it and the player");
    assert.ok(Math.abs(spot.at.x) <= HALF - 0.35 + 1e-9 && Math.abs(spot.at.z) <= HALF - 0.35 + 1e-9, "its middle on the board");
    assert.ok(distance(spot.at, victim) >= 1.5 * TILE && distance(spot.at, victim) <= 2.7 * TILE);
    assert.ok(Math.abs(Math.hypot(spot.facing.x, spot.facing.z) - 1) < 1e-9);
    // no piece stands inside the colossus's waist where it comes up through the stone
    assert.ok(spot.room >= 0.65, `room ${spot.room.toFixed(2)} at ${JSON.stringify(victim)}`);
  }
  // a victim on the far rank: the seal turns to the side rather than off the board
  const edge = placeColossus({ victim: sq("e8"), viewer: WHITE, standing: [], half: HALF, tile: TILE });
  assert.ok(Math.abs(edge.at.z) <= HALF - 0.35 + 1e-9);
});

test("the colossus climbs out, winds up, comes down on the blow, sits on it, and sinks away", () => {
  const T = SHADOW_TIMING;
  assert.equal(colossusPose(T.colossus - 0.01).shown, false);
  assert.ok(colossusPose(T.stands + 0.01).risen > 0.99);
  assert.ok(colossusPose(T.windup + 0.2).lean < -0.05, "back for the wind-up");
  const blow = colossusPose(T.strike);
  assert.ok(blow.lean > 0.35, "over on the blow");
  let last = colossusPose(T.colossus);
  for (let t = T.colossus; t < T.gone; t += 1 / 120) {
    const pose = colossusPose(t);
    assert.ok(Math.abs(pose.lean - last.lean) < 0.08 && Math.abs(pose.risen - last.risen) < 0.05, `no jump at ${t.toFixed(3)}`);
    last = pose;
  }
  assert.equal(colossusPose(T.gone).shown, false);
  assert.ok(colossusPose(T.gone - 0.02).risen < 0.02, "it is under the stone before it is put away");
});

test("the envelopes: the seal written then gone, the blow's flash and shake, the board healed by the end", () => {
  const T = SHADOW_TIMING;
  const at = (t: number) => shadowEnvelope(t, 7);
  assert.equal(at(0).sealDrawn, 0); assert.equal(at(T.sealDrawn).sealDrawn, 1);
  assert.ok(at(T.strike).flash > 2 && at(T.strike).shake > 0.8 && at(T.strike - 0.01).flash === 0);
  assert.equal(at(T.done).light, 0); assert.equal(at(T.done).scar, 0); assert.equal(at(T.done).fog, 0); assert.equal(at(T.sealGone + 0.01).sealGlow, 0);
  assert.ok(at(T.done).done && !at(T.done - 0.01).done);
  for (let t = 0; t <= T.done; t += 0.05) {
    const e = at(t);
    assert.ok(e.shake >= 0 && e.shake <= 0.9 && e.light >= 0 && Number.isFinite(e.light + e.flicker + e.heat + e.scar));
    assert.equal(shadowEnvelope(t, 7, true).shake, 0, "nothing shakes in the brief form");
    assert.equal(shadowEnvelope(t, 7, true).flash, 0, "nothing flashes in the brief form");
  }
});

test("the soldiers thrust before the blow and burn away after it, each in its own time", () => {
  const beats = soldierBeats([1.7, 1.8, 1.9, 2.0, 2.15], 11);
  for (const [i, beat] of beats.entries()) {
    assert.ok(beat.thrust >= [1.7, 1.8, 1.9, 2.0, 2.15][i] && beat.thrust < SHADOW_TIMING.strike);
    assert.ok(beat.burn >= SHADOW_TIMING.burn.from && beat.burn <= SHADOW_TIMING.burn.from + SHADOW_TIMING.burn.spread);
    assert.equal(burnt(beat.burn, beat), 0); assert.ok(burnt(beat.burn + SHADOW_TIMING.burn.length + 1e-9, beat) === 1);
  }
  assert.ok(new Set(beats.map((b) => b.burn.toFixed(3))).size === beats.length, "not all at once");
  const near = recoil(0.1, 0.62), far = recoil(0.1, 2);
  assert.ok(near.lean < far.lean && near.lean < -0.1, "the ring nearest the blow is thrown hardest");
  assert.deepEqual(recoil(-0.1, 0.62), { lean: 0, push: 0 });
  assert.ok(Math.abs(recoil(3, 0.62).lean) < 1e-3, "and stands again");
});

test("the camera has four beats, each with what it must keep in frame, the colossus's crown among them", () => {
  assert.deepEqual([0, SHADOW_SHOTS.army, SHADOW_SHOTS.colossus, SHADOW_SHOTS.after].map(shadowShot), [0, 1, 2, 3]);
  assert.ok(SHADOW_SHOTS.colossus + 0.95 < SHADOW_TIMING.strike, "the camera has arrived on the colossus before the blow");
  const frames = shadowFrames({ queen: { x: 2.55, y: 0, z: 0.51 }, victim: { x: 0.51, y: 0, z: 0.51 }, seal: sq("e6"), spawns: [sq("d3"), sq("f3")], colossus: 2.4, boardTop: 0 });
  assert.equal(frames.length, 4);
  for (const frame of frames) assert.ok(frame.length >= 2);
  assert.ok(Math.max(...frames[2].map((p) => p.y)) >= 2.4, "the colossus shot keeps its crown in frame");
  assert.ok(frames[1].length >= 4, "the army shot keeps every place a soldier rises");
  for (const frame of frames) assert.ok(Math.max(...frame.map((p) => p.y)) >= 2.7, "high enough to look over the pieces in front");
});
