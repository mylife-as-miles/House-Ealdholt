import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WYVERN_DOWNSTROKE, WYVERN_FLOOR, WYVERN_GRIP, WYVERN_HOVER, WYVERN_MIN_ALTITUDE, WYVERN_TIMING,
  createWyvernPath, mulberry32, wyvernBeats, wyvernFlap, type Vec3Like, type WyvernPathPlan,
} from "../../web/src/scene/rites/wyvern-path";

const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));

const TILE = 1.02;
const square = (file: number, rank: number, y: number): Vec3Like => ({ x: (file - 3.5) * TILE, y, z: (3.5 - (rank - 1)) * TILE });

/** The queen on d1 takes on d7: out of the sky behind her, away past the far edge. */
const plan = (over: Partial<WyvernPathPlan> = {}): WyvernPathPlan & { carry: "drop" | "away" | "eat" } => ({
  from: { x: -4, y: 10, z: 13 },
  target: square(3, 7, 0.95),
  away: { x: 6, y: 13, z: -22 },
  carry: "drop",
  seed: 7,
  ...over,
});

const distance = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Plans from every side of the board, including awkward ones (exit behind the entry, low entry, corner victim). */
const awkward: WyvernPathPlan[] = [
  plan(),
  plan({ carry: "away" }),
  plan({ from: { x: 5, y: 9, z: -12 }, target: square(0, 1, 0.9), away: { x: -18, y: 11, z: 9 } }),
  plan({ from: { x: 0, y: 8, z: 12 }, target: square(7, 8, 1.1), away: { x: 0, y: 12, z: 24 } }),
  plan({ from: { x: 12, y: 0.2, z: 0 }, target: square(4, 4, 0.9), away: { x: -20, y: 0.1, z: 0 } }),
  plan({ from: { x: 0.01, y: 14, z: 0.01 }, target: square(3, 4, 0.9), away: { x: 0, y: 30, z: 0 } }),
  plan({ carry: "eat" }),
  plan({ carry: "eat", from: { x: 5, y: 9, z: -12 }, target: square(0, 1, 0.9), away: { x: -18, y: 11, z: 9 } }),
  plan({ carry: "eat", hover: { x: 0, y: 6, z: 2 }, face: { x: 0, y: 6.4, z: 8.6 } }),
  plan({ carry: "eat", hover: { x: 0, y: 0.1, z: 0 } }),
];

test("the beat times add up to a run of about five seconds", () => {
  const beats = wyvernBeats("drop");
  assert.equal(beats.dive, WYVERN_TIMING.approach);
  assert.equal(beats.strike, WYVERN_TIMING.approach + WYVERN_TIMING.dive);
  assert.equal(beats.release, beats.strike + WYVERN_TIMING.carry);
  assert.equal(beats.gone, beats.release! + WYVERN_TIMING.leave);
  assert.equal(beats.duration, beats.gone);
  assert.ok(beats.duration >= 4.5 && beats.duration <= 5.5, `duration ${beats.duration}`);
  assert.ok(beats.screech < beats.dive && beats.dive < beats.flare && beats.flare < beats.strike);
  // Carrying the body off has the same clock but never lets go.
  const away = wyvernBeats("away");
  assert.equal(away.release, null);
  assert.equal(away.strike, beats.strike);
  assert.equal(away.gone, beats.gone);
});

test("wingbeats are in order, never overlap, and none falls in the dive", () => {
  for (const carry of ["drop", "away"] as const) {
    const beats = wyvernBeats(carry);
    assert.ok(beats.wingbeats.length >= 6);
    for (let i = 0; i < beats.wingbeats.length; i += 1) {
      const beat = beats.wingbeats[i];
      assert.ok(beat.time >= 0 && beat.time < beats.gone);
      if (i > 0) assert.ok(beat.time >= beats.wingbeats[i - 1].time + beats.wingbeats[i - 1].period - 1e-9, `beat ${i} overlaps`);
      assert.ok(beat.time + beat.period <= beats.dive || beat.time >= beats.strike, `beat ${i} is inside the dive`);
    }
    // The carry is flown on heavier beats than the approach.
    const carried = beats.wingbeats.filter((beat) => beat.time > beats.strike && beat.time < beats.strike + WYVERN_TIMING.carry - 0.1);
    assert.ok(carried.length >= 2);
    for (const beat of carried) assert.ok(beat.power > 1.1);
  }
});

test("the wings glide in the dive and are mid-stroke on a beat", () => {
  const beats = wyvernBeats("drop");
  assert.equal(wyvernFlap(beats, beats.dive + 0.3).amount, 0);
  const first = beats.wingbeats[0];
  const mid = wyvernFlap(beats, first.time + first.period * WYVERN_DOWNSTROKE);
  assert.equal(mid.amount, 1);
  assert.ok(Math.abs(mid.phase - WYVERN_DOWNSTROKE) < 1e-9);
  assert.equal(mid.index, 0);
  // The amount never jumps: the wings ease in and out of every group of beats.
  let previous = wyvernFlap(beats, 0).amount;
  for (let t = 0.005; t <= beats.gone; t += 0.005) {
    const now = wyvernFlap(beats, t).amount;
    assert.ok(Math.abs(now - previous) < 0.08, `flap amount jumps at ${t.toFixed(3)}`);
    previous = now;
  }
});

test("the talons are on the victim's chest at the strike, flying level", () => {
  for (const p of awkward) {
    const path = createWyvernPath(p);
    const strike = path.beats.strike;
    assert.ok(distance(path.grip(strike), p.target) < 1e-9, "grip point is on the target");
    const body = path.position(strike);
    assert.ok(Math.abs(body.y - (p.target.y + WYVERN_GRIP.up)) < 1e-9, "body rides one grip height above the chest");
    const velocity = path.velocity(strike);
    assert.ok(Math.abs(velocity.y) < 1e-9, "level at the bottom of the swoop");
    const speed = Math.hypot(velocity.x, velocity.z);
    assert.ok(speed > 4 && speed < 10, `strike speed ${speed}`);
    // Flying along the strike heading, which is a unit horizontal vector.
    assert.ok(Math.abs(Math.hypot(path.strikeHeading.x, path.strikeHeading.z) - 1) < 1e-9);
    assert.ok((velocity.x * path.strikeHeading.x + velocity.z * path.strikeHeading.z) / speed > 0.999999);
  }
});

test("it never passes through the board or below its top", () => {
  const boardTop = Number(/export const BOARD_TOP = (-?[\d.]+);/.exec(readFileSync(web("src/scene/board.ts"), "utf8"))?.[1]);
  assert.equal(WYVERN_FLOOR, boardTop, "WYVERN_FLOOR mirrors BOARD_TOP");
  for (const p of awkward) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const path = createWyvernPath({ ...p, seed });
      for (let t = 0; t <= path.beats.duration + 0.2; t += 1 / 240) {
        const body = path.position(t);
        assert.ok(body.y >= boardTop + WYVERN_MIN_ALTITUDE - 1e-9, `body at ${body.y.toFixed(3)} at t=${t.toFixed(3)} (seed ${seed})`);
      }
      assert.ok(path.grip(path.beats.strike).y > boardTop, "the talons strike above the board");
    }
  }
  // A raised board raises the whole run.
  const raised = createWyvernPath(plan({ floor: 3, target: square(3, 7, 3.95) }));
  for (let t = 0; t <= raised.beats.duration; t += 1 / 120) assert.ok(raised.position(t).y >= 3 + WYVERN_MIN_ALTITUDE - 1e-9);
});

test("it starts in the sky, ends at the exit, and climbs with the body", () => {
  for (const p of awkward) {
    const path = createWyvernPath(p);
    const from = { ...p.from, y: Math.max(p.from.y, WYVERN_FLOOR + WYVERN_MIN_ALTITUDE) };
    const away = { ...p.away, y: Math.max(p.away.y, WYVERN_FLOOR + WYVERN_MIN_ALTITUDE) };
    assert.ok(distance(path.position(0), from) < 1e-9, "starts at from");
    assert.ok(distance(path.position(path.beats.gone), away) < 1e-9, "ends at away");
    assert.ok(distance(path.position(path.beats.gone + 5), away) < 1e-9, "and stays there");
    const strike = path.position(path.beats.strike);
    if (p.carry !== "eat") {
      const release = path.position(path.beats.strike + WYVERN_TIMING.carry);
      assert.ok(release.y - strike.y >= 3, `carried ${release.y - strike.y} up before the release`);
    }
    // The dive really is a dive: it starts well above the strike.
    assert.ok(path.position(path.beats.dive).y - strike.y > 4);
    assert.ok(path.velocity(path.beats.dive + 0.2).y < -3);
  }
});

test("the path is continuous in position and velocity, at a believable speed", () => {
  for (const p of awkward.slice(0, 4)) {
    const path = createWyvernPath(p);
    const step = 1 / 480;
    let previous = path.position(0);
    let previousVelocity = path.velocity(0);
    for (let t = step; t <= path.beats.duration; t += step) {
      const now = path.position(t);
      const velocity = path.velocity(t);
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      assert.ok(speed < 40, `speed ${speed.toFixed(1)} at ${t.toFixed(2)}`);
      assert.ok(distance(now, previous) <= 40 * step + 1e-9, `position jumps at ${t.toFixed(3)}`);
      assert.ok(distance(velocity, previousVelocity) < 2.5, `velocity jumps at ${t.toFixed(3)}`);
      previous = now;
      previousVelocity = velocity;
    }
  }
});

test("a run is deterministic for a seed and differs between seeds", () => {
  const a = createWyvernPath(plan({ seed: 42 }));
  const b = createWyvernPath(plan({ seed: 42 }));
  assert.equal(a.side, b.side);
  for (let t = 0; t <= a.beats.duration; t += 0.05) assert.deepEqual(a.position(t), b.position(t));
  // Sampling out of order or twice gives the same answer: there is no hidden state.
  assert.deepEqual(a.position(1.234), a.position(1.234));
  assert.deepEqual(a.velocity(3.3), b.velocity(3.3));
  // Both circling directions turn up across seeds, and the approach differs between them.
  const sides = new Set<number>();
  for (let seed = 1; seed <= 24; seed += 1) sides.add(createWyvernPath(plan({ seed })).side);
  assert.deepEqual([...sides].sort(), [-1, 1]);
  const left = createWyvernPath(plan({ seed: 1 }));
  let other = 2;
  while (createWyvernPath(plan({ seed: other })).side === left.side) other += 1;
  const right = createWyvernPath(plan({ seed: other }));
  assert.ok(distance(left.position(0.75), right.position(0.75)) > 2, "the two circling sides are far apart mid-approach");
  // Whatever the seed, the strike itself is in the same place at the same time.
  assert.ok(distance(left.grip(left.beats.strike), right.grip(right.beats.strike)) < 1e-9);
  // The default seed is stable.
  assert.deepEqual(createWyvernPath(plan({ seed: undefined })).position(1), createWyvernPath(plan({ seed: 1 })).position(1));
});

test("eating: strike, bite, tears, release and gone come in that order, inside six and a half seconds", () => {
  const beats = wyvernBeats("eat");
  assert.deepEqual(wyvernBeats(), beats, "eat is the default");
  assert.ok(beats.hover !== null && beats.bite !== null && beats.release !== null && beats.triumph !== null);
  assert.equal(beats.tears.length, WYVERN_TIMING.tears);
  const order = [beats.screech, beats.dive, beats.flare, beats.strike, beats.hover, beats.bite, ...beats.tears, beats.release, beats.triumph, beats.gone];
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i] > order[i - 1], `beat ${i} at ${order[i]} is not after ${order[i - 1]}`);
  assert.ok(beats.duration <= 6.5, `eat takes ${beats.duration}`);
  // The dive and the strike are exactly as strong as in the other modes.
  const drop = wyvernBeats("drop");
  assert.equal(beats.dive, drop.dive);
  assert.equal(beats.strike, drop.strike);
  // The other modes have no feed.
  for (const other of [drop, wyvernBeats("away")]) {
    assert.equal(other.hover, null);
    assert.equal(other.bite, null);
    assert.equal(other.triumph, null);
    assert.deepEqual(other.tears, []);
  }
  // It beats hardest while it holds height to feed, and a beat is under way at the bite and at each tear.
  const hard = beats.wingbeats.filter((beat) => beat.time > beats.hover! - 0.3 && beat.time < beats.release!);
  assert.ok(hard.length >= 3);
  for (const beat of hard) assert.ok(beat.power >= 1.3 && beat.period <= 0.5);
  for (const at of [beats.bite, ...beats.tears]) assert.equal(wyvernFlap(beats, at).amount, 1, `no wingbeat under way at ${at}`);
});

test("eating: it holds a hover a few metres over the board from the bite to the release", () => {
  const boardTop = WYVERN_FLOOR;
  for (const p of awkward.filter((each) => each.carry === "eat")) {
    for (let seed = 1; seed <= 8; seed += 1) {
      const path = createWyvernPath({ ...p, seed });
      const { bite, release, hover, tears } = path.beats;
      assert.ok(path.hover && path.hoverFacing && hover !== null && bite !== null && release !== null);
      // The victim rides in the talons until the bite, and the talons hang under the body: the body is
      // where it was told to hover, nearly still, so the jaws can come to the talons and stay on them.
      assert.ok(distance(path.position(hover), path.hover) < 1e-9, "at the hover point when the hover begins");
      for (const at of [bite, ...tears, release]) {
        const body = path.position(at);
        const velocity = path.velocity(at);
        assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) < 1.6, `moving ${Math.hypot(velocity.x, velocity.y, velocity.z).toFixed(2)} at ${at}`);
        assert.ok(distance(body, path.hover) < 1.2, "still by the hover point");
        assert.ok(body.y >= boardTop + WYVERN_MIN_ALTITUDE - 1e-9);
      }
      if (!p.hover) {
        // By default: 4 to 7 m up, a short way past the victim's square.
        assert.ok(path.hover.y - boardTop >= 4 && path.hover.y - boardTop <= 7, `hover height ${path.hover.y}`);
        assert.ok(Math.hypot(path.hover.x - p.target.x, path.hover.z - p.target.z) <= WYVERN_HOVER.run + WYVERN_GRIP.back + 1e-9);
      } else {
        assert.ok(Math.abs(path.hover.x - p.hover.x) < 1e-9 && Math.abs(path.hover.z - p.hover.z) < 1e-9, "hovers where it was told");
        assert.ok(path.hover.y >= boardTop + WYVERN_MIN_ALTITUDE - 1e-9, "but never lower than the minimum altitude");
      }
      assert.ok(Math.abs(Math.hypot(path.hoverFacing.x, path.hoverFacing.z) - 1) < 1e-9, "the facing is a unit horizontal vector");
      // The same seed gives the same feed.
      const again = createWyvernPath({ ...p, seed });
      for (const at of [bite, ...tears, release]) assert.deepEqual(again.position(at), path.position(at));
      assert.deepEqual(again.hoverFacing, path.hoverFacing);
    }
  }
  // It faces its queen by default, or wherever it is told.
  const path = createWyvernPath(plan({ carry: "eat" }));
  const toQueen = { x: plan().from.x - path.hover!.x, z: plan().from.z - path.hover!.z };
  assert.ok((path.hoverFacing!.x * toQueen.x + path.hoverFacing!.z * toQueen.z) / Math.hypot(toQueen.x, toQueen.z) > 0.999999);
  const told = createWyvernPath(plan({ carry: "eat", face: { x: 30, y: 2, z: path.hover!.z } }));
  assert.ok(told.hoverFacing!.x > 0.999999);
  assert.equal(createWyvernPath(plan({ carry: "drop" })).hover, null);
});

test("mulberry32 is a repeatable stream in [0, 1)", () => {
  const a = mulberry32(99);
  const b = mulberry32(99);
  for (let i = 0; i < 200; i += 1) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});
