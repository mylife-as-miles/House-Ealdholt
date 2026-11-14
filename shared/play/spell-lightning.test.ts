import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEADER_BRIGHT, STROKE_DECAY, channelCapacity, mergeChannels, solveChannel, steppedReach, strikeState, strikeTimeline,
} from "../../web/src/scene/vfx/spells/shared/lightningPlan";

const close = (actual: number, expected: number, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);
const sky = { x: 1.2, y: 5.5, z: -0.8 }, chest = { x: 0.5, y: 0.9, z: -0.5 };
const span = Math.hypot(chest.x - sky.x, chest.y - sky.y, chest.z - sky.z);
const point = (points: Float32Array, i: number) => ({ x: points[i * 3], y: points[i * 3 + 1], z: points[i * 3 + 2] });

test("a channel runs exactly from one end to the other and is the same for the same seed", () => {
  const options = { levels: 5, jag: 0.16, forks: 3 };
  const a = solveChannel(11, sky, chest, options), again = solveChannel(11, sky, chest, options), other = solveChannel(12, sky, chest, options);
  assert.equal(a.points.length / 3, channelCapacity(5, 3)); assert.equal(channelCapacity(5, 3), 33 + 27);
  assert.deepEqual(Array.from(a.points), Array.from(again.points));
  assert.notDeepEqual(Array.from(a.points), Array.from(other.points));
  const first = point(a.points, 0), last = point(a.points, 32);
  for (const axis of ["x", "y", "z"] as const) { close(first[axis], sky[axis], 1e-6); close(last[axis], chest[axis], 1e-6); }
  close(a.length, span, 1e-9);
  assert.equal(a.strips.length, 4);
  assert.deepEqual({ ...a.strips[0] }, { start: 0, count: 33, width: 1, bright: 1, along: 0, span: 1, fork: false });
});

test("it is jagged but never strays far: every point is within the sum of the pushes of its line", () => {
  const jag = 0.16, channel = solveChannel(5, sky, chest, { levels: 5, jag });
  const reachLimit = span * jag * (1 / (1 - 0.55));
  let path = 0, off = 0;
  for (let i = 0; i < 33; i += 1) {
    const p = point(channel.points, i), t = ((p.x - sky.x) * (chest.x - sky.x) + (p.y - sky.y) * (chest.y - sky.y) + (p.z - sky.z) * (chest.z - sky.z)) / (span * span);
    const d = Math.hypot(p.x - (sky.x + (chest.x - sky.x) * t), p.y - (sky.y + (chest.y - sky.y) * t), p.z - (sky.z + (chest.z - sky.z) * t));
    assert.ok(d <= reachLimit, `point ${i} is ${d.toFixed(3)} off the line, over ${reachLimit.toFixed(3)}`);
    off = Math.max(off, d);
    if (i > 0) { const q = point(channel.points, i - 1); path += Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); }
  }
  assert.ok(off > span * 0.02, "it is not a ruler line");
  assert.ok(path > span * 1.03 && path < span * 1.9, `a tortuous path is longer than its chord, not absurdly (${(path / span).toFixed(2)})`);
});

test("forks leave the channel where it is, are shorter and dimmer than it, lean where asked and stay above the stone", () => {
  const down = { x: 0, y: -1, z: 0 };
  let leaning = 0, free = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const channel = solveChannel(seed, sky, chest, { levels: 5, jag: 0.16, forks: 4, lean: down, leaning: 0.7, floor: 0 });
    const loose = solveChannel(seed, sky, chest, { levels: 5, jag: 0.16, forks: 4 });
    const starts = new Set<number>();
    for (const [index, strip] of channel.strips.entries()) {
      if (!strip.fork) continue;
      const root = point(channel.points, strip.start), on = point(channel.points, Math.round(strip.along * 32));
      for (const axis of ["x", "y", "z"] as const) close(root[axis], on[axis], 1e-6);
      assert.ok(strip.along > 0 && strip.along < 1 && strip.width < 1 && strip.bright < 1 && strip.span > 0 && strip.span <= 0.3);
      const tip = point(channel.points, strip.start + strip.count - 1);
      assert.ok(Math.hypot(tip.x - root.x, tip.y - root.y, tip.z - root.z) < span * 0.4, "a fork is much shorter than the channel");
      starts.add(Math.round(strip.along * 32));
      leaning += tip.y - root.y; free += point(loose.points, loose.strips[index].start + 8).y - point(loose.points, loose.strips[index].start).y;
    }
    assert.equal(starts.size, 4, "no two forks leave from the same corner");
    for (let i = 0; i < channel.points.length / 3; i += 1) assert.ok(channel.points[i * 3 + 1] >= 0.015 - 1e-6 || i === 0 || i === 32);
  }
  assert.ok(leaning < free, "forks told to lean down end lower than forks left alone");
});

test("several small arcs merge into one channel", () => {
  const a = solveChannel(1, sky, chest, { levels: 3, jag: 0.2 }), b = solveChannel(2, chest, sky, { levels: 3, jag: 0.2, forks: 1, forkLevels: 2 });
  const merged = mergeChannels([a, b]);
  assert.equal(merged.points.length, a.points.length + b.points.length);
  assert.deepEqual(merged.strips.map((strip) => [strip.start, strip.count]), [[0, 9], [9, 9], [18, 5]]);
  close(merged.points[9 * 3 + 1], chest.y, 1e-6);
});

test("a leader comes down in steps: it waits, then jumps, and never goes back", () => {
  close(steppedReach(0, 6), 0); close(steppedReach(1, 6), 1); close(steppedReach(2, 6), 1); close(steppedReach(-1, 6), 0);
  let last = 0, still = 0, moved = 0;
  for (let i = 1; i <= 600; i += 1) {
    const now = steppedReach(i / 600, 6);
    assert.ok(now >= last - 1e-12);
    if (now - last < 1e-9) still += 1; else moved += 1;
    last = now;
  }
  assert.ok(still > moved, "it spends more of its time waiting than moving");
  // in the middle of a pause it stands on a whole step
  close(steppedReach((2 + 0.3) / 6, 6), 2 / 6);
});

test("the return stroke is far brighter than the leader, re-strikes dim down the same channel, and it cools", () => {
  const timeline = strikeTimeline(3, { leaderStart: 0.2, connect: 0.5, restrikes: 3, gap: 0.07, afterglow: 0.4 });
  assert.deepEqual(timeline, strikeTimeline(3, { leaderStart: 0.2, connect: 0.5, restrikes: 3, gap: 0.07, afterglow: 0.4 }));
  assert.equal(timeline.strokes.length, 4); assert.equal(timeline.strokes[0], 0.5);
  for (let i = 1; i < 4; i += 1) {
    const gap = timeline.strokes[i] - timeline.strokes[i - 1];
    assert.ok(gap >= 0.07 * 0.6 - 1e-4 && gap <= 0.07 * 1.5 + 1e-4, `stroke ${i} is ${gap.toFixed(3)} after the last`);
    assert.ok(timeline.peaks[i] < timeline.peaks[i - 1], "each stroke is dimmer than the one before");
  }
  const gaps = [1, 2, 3].map((i) => +(timeline.strokes[i] - timeline.strokes[i - 1]).toFixed(4));
  assert.ok(new Set(gaps).size > 1, "the strokes are not evenly spaced");

  const before = strikeState(timeline, 0.1), coming = strikeState(timeline, 0.4), almost = strikeState(timeline, 0.4999), landed = strikeState(timeline, 0.5);
  assert.deepEqual([before.head, before.bright, before.connected], [0, 0, false]);
  assert.ok(coming.head > 0 && coming.head < 1 && coming.bright === LEADER_BRIGHT && coming.forks === LEADER_BRIGHT && !coming.connected);
  assert.ok(almost.head < 1, "the leader has not arrived until it connects");
  assert.deepEqual([landed.head, landed.bright, landed.forks, landed.swell, landed.connected, landed.stroke], [1, 1, 1, 1, true, 0]);
  assert.ok(landed.bright / coming.bright > 4, "the return stroke is several times the leader");
  close(strikeState(timeline, 0.5 + STROKE_DECAY).bright, Math.exp(-1), 1e-9);

  // each re-strike jumps back up, lower than the last; the forks do not come back; the path is kept throughout
  let lastPeak = 1;
  for (let i = 1; i < 4; i += 1) {
    const at = timeline.strokes[i], justBefore = strikeState(timeline, at - 1e-4), on = strikeState(timeline, at);
    assert.ok(on.bright > justBefore.bright && on.bright < lastPeak && on.stroke === i);
    assert.ok(on.forks < 0.3 && on.forks <= justBefore.forks, "later strokes leave the forks dark");
    assert.equal(on.path, 0);
    lastPeak = on.bright;
  }
  const last = timeline.strokes[3];
  assert.ok(strikeState(timeline, last + 0.2).bright > 0 && strikeState(timeline, last + 0.2).bright < 0.14);
  assert.ok(strikeState(timeline, last + 0.3).bright < strikeState(timeline, last + 0.2).bright, "it cools");
  const over = strikeState(timeline, timeline.end);
  assert.deepEqual([over.bright, over.forks, over.done], [0, 0, true]);
  assert.ok(!strikeState(timeline, timeline.end - 0.01).done);
});

test("a crackle that keeps its path for one stroke finds a new one each time", () => {
  const timeline = strikeTimeline(9, { leaderStart: 0, connect: 0, restrikes: 5, gap: 0.04, keep: 2, afterglow: 0.1 });
  assert.deepEqual(timeline.strokes.map((at) => strikeState(timeline, at).path), [0, 0, 1, 1, 2, 2]);
  assert.equal(strikeState(timeline, 0).head, 1, "with no descent it is connected at once");
});
