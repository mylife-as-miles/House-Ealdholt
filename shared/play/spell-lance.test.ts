import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LANCE_BUDGET, LANCE_SPEED, QUEEN_POWER, gearStation, gearTurn, lanceCounts, lanceSize, lanceState, lanceTimeline, lanceWaver,
} from "../../web/src/scene/vfx/spells/lance/lancePlan";

const close = (actual: number, expected: number, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
const tiers = ["low", "medium", "high", "ultra"] as const;
const TILE = 1.02;

test("the budget falls with the tier and a Queen's lance has more to it than a Bishop's", () => {
  for (let i = 1; i < tiers.length; i += 1) {
    const less = LANCE_BUDGET[tiers[i - 1]], more = LANCE_BUDGET[tiers[i]];
    for (const key of ["streamers", "segments", "gears", "motes", "sparks", "dust"] as const) assert.ok(more[key] > less[key], `${key} at ${tiers[i]}`);
  }
  assert.ok(LANCE_BUDGET.low.streamers >= 1 && LANCE_BUDGET.low.gears >= 1 && LANCE_BUDGET.low.dust > 0, "the lowest tier still has streamers, script and dust");
  assert.ok(LANCE_BUDGET.low.streamers * 3 <= LANCE_BUDGET.ultra.streamers + 2, "the lowest tier has about a third of the instances");
  for (const tier of tiers) {
    const bishop = lanceCounts(tier, 1), queen = lanceCounts(tier, 1.75);
    assert.deepEqual(bishop, { ...LANCE_BUDGET[tier] });
    assert.ok(queen.streamers > bishop.streamers && queen.gears === bishop.gears + 1 && queen.sparks > bishop.sparks && queen.rings === 2 && bishop.rings === 1);
    assert.equal(bishop.arcs, 0);
    assert.equal(queen.arcs > 0, tier !== "low", "arcs crawl on a Queen's lance wherever there is budget for them");
  }
  assert.equal(lanceCounts("high", QUEEN_POWER).rings, 2); assert.equal(lanceCounts("high", QUEEN_POWER - 0.01).rings, 1);
});

test("it is sized in board units: a lance, not a pillar, with its sigil about a square across", () => {
  const bishop = lanceSize(1, TILE), queen = lanceSize(1.75, TILE);
  assert.ok(bishop.core < bishop.sheath && bishop.sheath < bishop.wind && bishop.wind < bishop.star && bishop.star < bishop.impact);
  assert.ok(bishop.sheath * 2 < TILE * 0.2, "a Bishop's lance is under a fifth of a square thick");
  assert.ok(bishop.sigil * 2 > TILE * 0.8 && bishop.sigil * 2 < TILE * 1.2);
  for (const key of ["core", "sheath", "wind", "star", "impact", "muzzle", "sigil"] as const) assert.ok(queen[key] > bishop[key], key);
  assert.ok(queen.sheath / bishop.sheath > 1.3 && queen.sheath / bishop.sheath < 1.5 && queen.sigil <= 0.72 * 1.0001);
  close(lanceSize(1, 2.04).sheath, bishop.sheath * 2);
});

test("the star where it lands stands behind the victim: past the back of any body, and still wider than the gap", () => {
  for (const power of [1, 1.75]) {
    const size = lanceSize(power, TILE);
    // a figure is about a fifth of a square from its chest to its back; the star's light must break round it
    assert.ok(size.behind > TILE * 0.25, "the body hides the star's heart, not the star the body");
    assert.ok(size.behind < size.impact * 0.7, "and its rays still reach past the body's edges");
  }
  close(lanceSize(1, 2.04).behind, lanceSize(1, TILE).behind * 2);
});

test("the blow lands when the front arrives: sooner for a near victim, never instantly, never slowly", () => {
  const near = lanceTimeline(1 * TILE, 1), mid = lanceTimeline(4 * TILE, 1), far = lanceTimeline(10 * TILE, 1);
  close(mid.strikeAt - mid.fire, (4 * TILE) / LANCE_SPEED, 1e-3);
  close(near.strikeAt - near.fire, 0.08, 1e-9); close(far.strikeAt - far.fire, 0.26, 1e-9);
  for (const timeline of [near, mid, far, lanceTimeline(4 * TILE, 1.75), lanceTimeline(4 * TILE, 1, true)]) {
    assert.ok(0 < timeline.fire && timeline.fire < timeline.strikeAt && timeline.strikeAt < timeline.release && timeline.release < timeline.gone && timeline.gone < timeline.total);
    assert.ok(timeline.total < 3.2, "a cast is over in about three seconds");
  }
  const queen = lanceTimeline(4 * TILE, 1.75);
  assert.ok(queen.fire > mid.fire && queen.release - queen.strikeAt > mid.release - mid.strikeAt, "a Queen gathers longer and holds longer");
  assert.ok(lanceTimeline(4, 1, true).total < mid.total && lanceTimeline(4, 1, true).brief);
});

test("it has a life: gather, a front, the blow, a hold, the hand lets go, the star goes in, the sigil cools", () => {
  const timeline = lanceTimeline(4 * TILE, 1), at = (seconds: number) => lanceState(timeline, seconds, 1);
  const { fire, strikeAt, release, gone, total } = timeline;
  // gather: nothing has left the hand; the star swells; the pen is at work on both rings
  const early = at(fire * 0.5), ready = at(fire - 0.001);
  assert.equal(at(0).star, 0); assert.equal(at(0).power, 0); assert.equal(at(0).sigilDrawn, 0);
  assert.ok(early.star > 0 && early.star < ready.star && early.head === 0 && early.power === 0 && !early.struck);
  assert.ok(early.muzzleDrawn > 0 && early.muzzleDrawn < 1 && early.inflow > 0 && early.inflowGlow > 0.9);
  assert.ok(ready.muzzleDrawn === 1 && ready.sigilDrawn > 0.3 && ready.sigilDrawn < 1, "the ring at the hand is written first; the sigil is still being written as it fires");
  // the front runs at one speed and the blow is the frame it arrives
  const mid = at((fire + strikeAt) / 2);
  close(mid.head, 0.5, 1e-9); assert.ok(mid.power > 0 && !mid.struck && mid.impact === 0 && mid.tail === 0 && mid.sinceStrike === -1);
  assert.ok(!at(strikeAt - 1e-4).struck && at(strikeAt).struck);
  const blow = at(strikeAt);
  assert.deepEqual([blow.head, blow.sinceStrike, blow.sigilDrawn], [1, 0, 1]);
  assert.ok(blow.impact > 1.5 && blow.girth > 1.4 && blow.shake > 0.3 && blow.light > 3, "the blow swells the lance, lights the star and shakes the camera");
  assert.ok(at(strikeAt + 0.3).shake < 0.06 && at(strikeAt + 0.3).light < 1.5, "and is gone in a few tenths");
  // hold: it stands and beats
  const beats = [0.05, 0.12, 0.2, 0.28, 0.36, 0.44].map((after) => at(strikeAt + after).power);
  assert.ok(Math.max(...beats) - Math.min(...beats) > 0.08 && Math.min(...beats) > 0.8);
  assert.equal(at(release - 0.01).tail, 0);
  // the hand lets go: the tail runs into the star, slowly at first, and the streamers are flung
  const going = at(release + (gone - release) * 0.5), nearly = at(gone - 0.01);
  assert.ok(going.tail > 0 && going.tail < 0.5 && nearly.tail > 0.9 && nearly.wind > 2.2 && nearly.streamers < 0.3 && nearly.girth < 0.6 && at(gone - 0.001).power > 0);
  assert.ok(nearly.impact < 0.3, "the star has been drawn in to a point");
  // the star goes in and throws a last ring; then only the stone is left, cooling
  const last = at(gone);
  assert.ok(last.power === 0 && last.sinceGone === 0 && last.impact > 1 && last.sigilGlow > nearly.sigilGlow, "the last ring flares the sigil");
  const cooling = at(gone + 0.5);
  assert.ok(cooling.sigilGlow > 0 && cooling.sigilGlow < 0.5 && cooling.rise > 0 && cooling.impact < 0.1 && cooling.star === 0 && !cooling.done);
  assert.ok(at(total - 0.05).sigilGlow < cooling.sigilGlow);
  const over = at(total);
  assert.deepEqual([over.done, over.sigilGlow, over.light, over.shake, over.power], [true, 0, 0, 0, 0]);
  assert.ok(at(total + 5).done && at(total + 5).struck);
});

test("the light follows the lance: at the hand, then with the front, then on the victim", () => {
  const timeline = lanceTimeline(4 * TILE, 1), at = (seconds: number) => lanceState(timeline, seconds, 1);
  assert.equal(at(0.3).lightAt, 0); close(at((timeline.fire + timeline.strikeAt) / 2).lightAt, 0.5); assert.equal(at(timeline.strikeAt + 0.1).lightAt, 1);
  assert.ok(lanceState(timeline, timeline.strikeAt, 1.75).shake > lanceState(timeline, timeline.strikeAt, 1).shake, "a Queen's blow shakes harder");
  for (let seconds = 0; seconds <= timeline.total + 0.2; seconds += 0.01) {
    const state = at(seconds);
    assert.ok(state.shake >= 0 && state.shake <= 0.8 && state.light >= 0 && state.light < 6 && state.head >= state.tail);
  }
});

test("the brief form does not rush, flash or shake", () => {
  const timeline = lanceTimeline(6 * TILE, 1.75, true);
  let last = lanceState(timeline, 0, 1.75);
  assert.ok(last.head === 1 && last.power === 0, "the lance is whole from the start and dark");
  let struck = false;
  for (let seconds = 0.01; seconds <= timeline.total + 0.1; seconds += 0.01) {
    const state = lanceState(timeline, seconds, 1.75);
    assert.equal(state.shake, 0); assert.equal(state.head, 1); assert.equal(state.tail, 0); assert.equal(state.sinceRelease, -1); assert.equal(state.sinceGone, -1);
    assert.ok(state.light <= 0.75 && state.power <= 0.6 && state.impact <= 0.5);
    for (const key of ["power", "light", "impact", "star", "sigilGlow"] as const) assert.ok(Math.abs(state[key] - last[key]) < 0.06, `${key} moves gently at ${seconds.toFixed(2)}`);
    if (state.struck && !struck) { struck = true; close(seconds, timeline.strikeAt, 0.011); }
    last = state;
  }
  assert.ok(struck && last.done && last.light === 0);
});

test("the clockwork ticks: a wheel stands, then goes on a tooth with a little overshoot", () => {
  close(gearTurn(0, 4), 0); close(gearTurn(0.1, 4), 0); close(gearTurn(0.25, 4), 1); close(gearTurn(1, 4), 4);
  // standing for the first two thirds of a beat
  close(gearTurn(0.25 + 0.6 * 0.25, 4), 1);
  // the tick overshoots the tooth before it settles on it
  let peak = 0;
  for (let i = 0; i <= 100; i += 1) peak = Math.max(peak, gearTurn((0.66 + 0.34 * (i / 100)) * 0.25, 4));
  assert.ok(peak > 1.02 && peak < 1.2, `it overshoots a little (${peak.toFixed(3)})`);
  assert.equal(gearTurn(-3, 4), 0);
});

test("rings of script are threaded clear of the hand and the star, and the lance wavers only in its middle", () => {
  for (const count of [2, 4, 6]) {
    const stations = Array.from({ length: count }, (_, i) => gearStation(i, count));
    assert.ok(stations[0] > 0.2 && stations[count - 1] < 0.82);
    for (let i = 1; i < count; i += 1) close(stations[i] - stations[i - 1], 0.62 / count);
  }
  close(lanceWaver(0, 0.03), 0); close(lanceWaver(1, 0.03), 0, 1e-12);
  assert.ok(lanceWaver(0.55, 0.03) > lanceWaver(0.2, 0.03) && lanceWaver(0.55, 0.03) <= 0.03 && lanceWaver(0.55, 0.03) > 0.02);
});
