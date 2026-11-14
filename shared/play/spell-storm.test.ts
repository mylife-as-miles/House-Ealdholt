import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUEEN_POWER, STORM_BUDGET, STORM_KEEP, STORM_RATE, STORM_SPEED, stormCounts, stormEarth, stormFlicker, stormSize, stormSky, stormSparks, stormState,
  stormStrike, stormTimeline,
} from "../../web/src/scene/vfx/spells/storm/stormPlan";
import { strikeState } from "../../web/src/scene/vfx/spells/shared/lightningPlan";

const close = (actual: number, expected: number, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
const tiers = ["low", "medium", "high", "ultra"] as const;
const TILE = 1.02, stone = { x: 0.5, y: 0, z: -0.5 };

test("the budget falls with the tier and a Queen's bolt has more to it than a Bishop's", () => {
  for (let i = 1; i < tiers.length; i += 1) {
    const less = STORM_BUDGET[tiers[i - 1]], more = STORM_BUDGET[tiers[i]];
    for (const key of ["filaments", "segments", "sparks", "forks", "crackle", "smoke"] as const) assert.ok(more[key] > less[key], `${key} at ${tiers[i]}`);
    assert.ok(more.earth >= less.earth && more.levels >= less.levels);
  }
  assert.equal(STORM_BUDGET.low.filaments * 3, STORM_BUDGET.ultra.filaments, "the lowest tier has a third of the filaments");
  assert.ok(STORM_BUDGET.low.forks > 0 && STORM_BUDGET.low.smoke > 0 && STORM_BUDGET.low.earth > 0, "and still forks, earths and smokes");
  for (const tier of tiers) {
    const bishop = stormCounts(tier, 1), queen = stormCounts(tier, 1.75);
    assert.deepEqual(bishop, { ...STORM_BUDGET[tier] });
    assert.ok(queen.filaments === bishop.filaments + 2 && queen.forks === bishop.forks + 2 && queen.earth === bishop.earth + 2 && queen.sparks > bishop.sparks);
    assert.deepEqual([bishop.strikes, queen.strikes], [1, 2], "a Queen's bolt calls a second leader");
  }
  assert.equal(stormCounts("high", QUEEN_POWER - 0.01).strikes, 1);
});

test("it is sized in board units", () => {
  const bishop = stormSize(1, TILE), queen = stormSize(1.75, TILE);
  assert.ok(bishop.filament * 2 < 0.05 && bishop.fan < TILE * 0.25 && bishop.kink < bishop.fan, "filaments are thin and the bundle stays inside a file");
  assert.ok(bishop.height > 4 && bishop.height < 5.5 && queen.height > bishop.height, "the leader starts well over a figure's head");
  assert.ok(bishop.earth > TILE && bishop.earth < TILE * 1.3 && queen.earth <= 1.7 * 1.0001, "the charge runs out about a square");
  for (const key of ["filament", "fan", "kink", "knot", "shell", "leader", "height", "earth"] as const) assert.ok(queen[key] > bishop[key], key);
  close(stormSize(1, 2.04).fan, bishop.fan * 2);
});

test("the blow lands when the front arrives, and the leader connects on the same instant", () => {
  const near = stormTimeline(1 * TILE, 1), mid = stormTimeline(6 * TILE, 1), far = stormTimeline(10 * TILE, 1);
  close(mid.strikeAt - mid.front, (6 * TILE) / STORM_SPEED, 1e-3);
  close(near.strikeAt - near.front, 0.05, 1e-9); close(far.strikeAt - far.front, 0.14, 1e-9);
  for (const timeline of [near, mid, far, stormTimeline(4, 1.75), stormTimeline(4, 1, true)]) {
    assert.ok(0 < timeline.front && timeline.front < timeline.strikeAt && timeline.strikeAt < timeline.blow && timeline.blow < timeline.out && timeline.out < timeline.total);
    assert.ok(timeline.total < 2.6);
  }
  const strike = stormStrike(mid, 5, 1), second = stormStrike(mid, 5, 1.75, 1);
  assert.equal(strike.strokes[0], mid.strikeAt); assert.ok(strike.leader[0] < mid.front, "the leader is already on its way down when the front leaves");
  assert.equal(strike.strokes.length, 4); assert.equal(stormStrike(mid, 5, 1.75).strokes.length, 5);
  assert.ok(second.strokes[0] > mid.strikeAt && second.strokes[0] < mid.strikeAt + 0.2 && second.strokes.length === 3, "a second leader lands a beat later");
  assert.ok(strike.end < mid.total, "the leader has cooled before the cast is over");
  assert.ok(strikeState(strike, mid.strikeAt).bright === 1 && !strikeState(strike, mid.strikeAt - 0.001).connected);
});

test("it stutters: a stroke, dimmer gutterings down the same channel, then a new stroke", () => {
  const ticks = Array.from({ length: 12 }, (_, i) => stormFlicker(3, (i + 0.001) / STORM_RATE));
  assert.deepEqual(ticks.map((t) => t.tick), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (let i = 0; i < 12; i += 1) {
    if (i % STORM_KEEP === 0) assert.ok(ticks[i].bright > 1, `tick ${i} is a stroke`);
    else assert.ok(ticks[i].bright < 0.8 && ticks[i].bright > 0.2, `tick ${i} gutters (${ticks[i].bright.toFixed(2)})`);
  }
  // quantised: it steps between brightnesses and sags a little inside a tick
  const inside = [0.1, 0.5, 0.9].map((f) => stormFlicker(3, (2 + f) / STORM_RATE).bright);
  assert.ok(inside[0] > inside[1] && inside[1] > inside[2] && inside[0] - inside[2] < 0.3 * inside[0]);
  assert.deepEqual(stormFlicker(3, 0.2), stormFlicker(3, 0.2));
  assert.notEqual(stormFlicker(3, 0.2).bright, stormFlicker(4, 0.2).bright);
  assert.equal(stormFlicker(3, -1).tick, 0);
});

test("it has a life: gather, a front, the blow, a hold, the blow-out, and a trail that lifts", () => {
  const timeline = stormTimeline(4 * TILE, 1), at = (seconds: number) => stormState(timeline, seconds, 1, 9);
  const { front, strikeAt, blow, out, total } = timeline;
  // gather: the knot tightens, arcs crackle, the feeler stabs out in steps; no bundle yet
  const early = at(front * 0.5), ready = at(front - 0.001);
  assert.ok(at(0).knot === 0 && at(0).power === 0 && at(0).feeler === 0);
  assert.ok(early.knot > 0 && early.crackle === 1 && early.power === 0 && early.reach === 0 && early.feeler > 0 && early.feeler < 1 && early.feelerGlow > 0);
  assert.ok(ready.feeler === 1 && ready.knot > early.knot * 0.9);
  const reaches = new Set<number>(); let lastFeeler = 0;
  for (let seconds = 0; seconds < front; seconds += 0.004) { const f = at(seconds).feeler; assert.ok(f >= lastFeeler - 1e-9); lastFeeler = f; reaches.add(+f.toFixed(3)); }
  for (const rung of [0.2, 0.4, 0.6, 0.8]) assert.ok(reaches.has(rung), `the feeler rests at ${rung}`);
  // the front runs at one speed; the blow is the frame it arrives
  const mid = at((front + strikeAt) / 2);
  close(mid.reach, 0.5, 1e-9); assert.ok(mid.power > 0 && !mid.struck && mid.shell === 0 && mid.tail === 0);
  assert.ok(!at(strikeAt - 1e-4).struck && at(strikeAt).struck);
  const hit = at(strikeAt);
  assert.ok(hit.reach === 1 && hit.sinceStrike === 0 && hit.shake > 0.4 && hit.light > 4 && hit.shell > 1 && hit.power > mid.power);
  assert.ok(at(strikeAt + 0.3).shake < 0.05);
  // hold: the re-strike clock runs and the brightness jumps between ticks
  const ticks = new Set<number>(), levels: number[] = [];
  for (let seconds = strikeAt + 0.1; seconds < blow; seconds += 0.01) { const s = at(seconds); ticks.add(s.tick); levels.push(s.power); assert.ok(s.tail === 0 && s.breakup === 0 && s.trail === 0); }
  assert.ok(ticks.size >= 6 && Math.max(...levels) > 1 && Math.min(...levels) < 0.75);
  // blow-out: a surge, the fan flies open, it breaks up and lets go from the hand
  const surge = at(blow), going = at((blow + out) / 2), nearly = at(out - 0.005);
  assert.ok(surge.power > at(blow - 0.005).power && surge.sinceBlow === 0);
  close(going.breakup, 0.5, 1e-6); assert.ok(going.spread > 1.4 && going.tail > 0 && going.tail < 0.5);
  assert.ok(nearly.spread > 3 && nearly.tail > 0.9 && nearly.knot < 0.1);
  // after: the bundle is gone, and what is left is a trail that lifts and thins, and smoke
  const after = at(out + 0.2), late = at(total - 0.2);
  assert.ok(after.power === 0 && after.trail > 0.2 && after.drift > 0 && after.smoke === 1 && after.shell === 0 && after.knot === 0 && !after.done);
  assert.ok(late.trail < after.trail && late.drift > after.drift && late.smoke < 1);
  const over = at(total);
  assert.deepEqual([over.done, over.light, over.shake, over.power, over.trail], [true, 0, 0, 0, 0]);
  for (let seconds = 0; seconds <= total + 0.2; seconds += 0.005) {
    const s = at(seconds);
    assert.ok(s.shake >= 0 && s.shake <= 0.8 && s.light >= 0 && s.light < 7 && s.reach >= s.tail - 1e-9 && s.power >= 0);
  }
  assert.ok(stormState(timeline, strikeAt, 1.75, 9).shake > hit.shake);
});

test("the brief form is steady: one shape, no strobe, nothing travels, nothing shakes", () => {
  const timeline = stormTimeline(6 * TILE, 1.75, true);
  let last = stormState(timeline, 0, 1.75, 9), struck = false;
  for (let seconds = 0.01; seconds <= timeline.total + 0.1; seconds += 0.01) {
    const state = stormState(timeline, seconds, 1.75, 9);
    assert.equal(state.shake, 0); assert.equal(state.tick, 0); assert.equal(state.reach, 1); assert.equal(state.tail, 0); assert.equal(state.crackle, 0); assert.equal(state.breakup, 0);
    assert.ok(state.light <= 0.75 && state.power <= 0.55 && state.shell <= 0.45);
    for (const key of ["power", "light", "shell", "knot", "trail", "smoke"] as const) assert.ok(Math.abs(state[key] - last[key]) < 0.06, `${key} moves gently at ${seconds.toFixed(2)}`);
    if (state.struck && !struck) { struck = true; close(seconds, timeline.strikeAt, 0.011); }
    last = state;
  }
  assert.ok(struck && last.done);
  const sparks = stormSparks(4, 60, timeline, [timeline.strikeAt]);
  let alive = 0;
  for (let i = 0; i < 60; i += 1) { if (sparks.birth[i * 4 + 1] >= 0) { alive += 1; assert.ok(sparks.birth[i * 4 + 3] <= 1.1 && sparks.birth[i * 4 + 1] >= timeline.strikeAt); } }
  assert.equal(alive, 20, "a third of the sparks, and slow ones");
});

test("the leader starts high and to one side; the charge runs out on an uneven star", () => {
  const sky = stormSky(stone, 12, 1, TILE), again = stormSky(stone, 12, 1, TILE), other = stormSky(stone, 12, 1.75, TILE, 1);
  assert.deepEqual(sky, again);
  const off = Math.hypot(sky.x - stone.x, sky.z - stone.z);
  assert.ok(sky.y > 4 && sky.y < 5.6 && off > 0.7 * TILE - 1e-9 && off < 1.5 * TILE + 1e-9);
  assert.ok(other.y > sky.y * 0.95 && Math.hypot(other.x - sky.x, other.z - sky.z) > 0.3, "a second leader comes from somewhere else");
  const ends = stormEarth(stone, 12, 6, 1.07);
  assert.equal(ends.length, 6); assert.deepEqual(ends, stormEarth(stone, 12, 6, 1.07));
  const turns = ends.map((p) => Math.atan2(p.z - stone.z, p.x - stone.x)), far = ends.map((p) => Math.hypot(p.x - stone.x, p.z - stone.z));
  for (const [i, p] of ends.entries()) { assert.equal(p.y, stone.y); assert.ok(far[i] >= 1.07 * 0.55 - 1e-9 && far[i] <= 1.07 + 1e-9); }
  assert.ok(Math.max(...far) - Math.min(...far) > 0.08, "at uneven distances");
  for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) {
    const gap = Math.abs(Math.atan2(Math.sin(turns[i] - turns[j]), Math.cos(turns[i] - turns[j])));
    assert.ok(gap > 0.2, `arcs ${i} and ${j} do not run out the same way`);
  }
});

test("sparks are shed the whole way: along the bolt as the front passes, hard on every stroke, and in the blow-out", () => {
  const timeline = stormTimeline(4 * TILE, 1), strike = stormStrike(timeline, 5, 1);
  const sparks = stormSparks(8, 400, timeline, strike.strokes);
  assert.deepEqual(Array.from(sparks.birth), Array.from(stormSparks(8, 400, timeline, strike.strokes).birth));
  let landing = 0, along = 0, shower = 0;
  for (let i = 0; i < 400; i += 1) {
    const [u, when, life, speed] = [sparks.birth[i * 4], sparks.birth[i * 4 + 1], sparks.birth[i * 4 + 2], sparks.birth[i * 4 + 3]];
    const away = Math.hypot(sparks.away[i * 3], sparks.away[i * 3 + 1], sparks.away[i * 3 + 2]);
    close(away, 1, 1e-5); assert.ok(u >= 0 && u <= 1 && life > 0.3 && life < 0.95 && speed > 0.8);
    assert.ok(when + life < timeline.total + 0.2, "none outlives the cast by much");
    if (u === 1) { landing += 1; assert.ok(when >= timeline.strikeAt - 1e-6 && strike.strokes.some((s) => when >= s - 1e-6 && when <= s + 0.031), "a landing spark is thrown on a stroke"); }
    else if (when >= timeline.blow) shower += 1;
    else { along += 1; assert.ok(when >= timeline.front + u * (timeline.strikeAt - timeline.front) - 1e-6, "no spark is shed ahead of the front"); }
  }
  assert.ok(landing > 120 && along > 100 && shower > 40, `${landing} at the landing, ${along} along the bolt, ${shower} in the blow-out`);
});
