import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WOUND_POWER, bloodOf, crownThrusts, insideTorso, pierceWounds, spikeThrust, torsoDistance, torsoFrame, twistWounds, type PierceLine, type TorsoFrame,
} from "../../web/src/scene/vfx/spells/shared/piercePlan";
import {
  bladeThrust, glacialBlades, glacialBlood, glacialCounts, glacialLine, glacialSize, glacialState, glacialThrusts, glacialTimeline, glacialWounds, impalerRadius, thrustTime,
  type GlacialCast,
} from "../../web/src/scene/vfx/spells/glacial/glacialPlan";
import { FROST_BUDGET, frostBlood, frostLine, frostSpikes, frostState, frostTimeline, frostWounds, kingHeight, kingRadius, kingThrust, type FrostCast } from "../../web/src/scene/vfx/spells/frost/frostPlan";

/** A library entry's line, read from its source: the entries pull in three.js, which the node tests do not load. */
const entry = (path: string, name: string) => {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"), line = text.split("\n").find((row) => row.startsWith(`export const ${name}: SpellEntry`));
  assert.ok(line, name);
  return line;
};

const TILE = 1.02;
const violences = ["minimal", "cinematic", "full"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.4 * TILE };
// the match aims a spell at the chest, 0.62 over the stone
const chest = { x: stone.x, y: 0.62, z: stone.z };
const frame = torsoFrame(stone, hand, chest);
const at = (line: PierceLine, t: number) => ({ x: line.root.x + line.axis.x * t, y: line.root.y + line.axis.y * t, z: line.root.z + line.axis.z * t });
const flat = (p: { x: number; z: number }, f: TorsoFrame) => ({ x: p.x - f.chest.x, z: p.z - f.chest.z });
const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;
/** The nearest the line comes to the torso along its whole length (negative: it goes in). */
const nearest = (f: TorsoFrame, line: PierceLine) => { let n = Infinity; for (let t = 0; t <= line.length; t += 0.004) n = Math.min(n, torsoDistance(f, at(line, t))); return n; };
/** The head stands above the shoulders: it is never touched. */
const headGap = (f: TorsoFrame, line: PierceLine) => {
  const head = { x: f.chest.x, y: f.chest.y + 0.53 * (f.chest.y - f.floor), z: f.chest.z };
  let n = Infinity;
  for (let t = 0; t <= line.length; t += 0.004) { const p = at(line, t); n = Math.min(n, Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z)); }
  return n - 0.15 * (f.chest.y - f.floor);
};

test("the torso is in proportion to the chest the match aims at, and faces the caster", () => {
  assert.ok(Math.abs(frame.radius - 0.112) < 0.002 && Math.abs(frame.low - 0.496) < 0.002 && Math.abs(frame.high - 0.806) < 0.002);
  assert.deepEqual({ x: frame.chest.x, z: frame.chest.z }, { x: stone.x, z: stone.z });
  const toward = { x: hand.x - stone.x, z: hand.z - stone.z }, far = Math.hypot(toward.x, toward.z);
  assert.ok(Math.abs(dot(frame.forward, toward) / far - 1) < 1e-9 && Math.abs(dot(frame.forward, frame.right)) < 1e-12);
  assert.ok(insideTorso(frame, chest) && !insideTorso(frame, { x: stone.x, y: 0.2, z: stone.z }) && !insideTorso(frame, { ...chest, y: 1.0 }), "hips to shoulders, not the legs or the head");
  const king = torsoFrame(stone, hand, { ...chest, y: 0.9 });
  assert.ok(king.radius > frame.radius && king.high > frame.high, "a taller chest is a larger torso");
});

test("an impaler stands in the stone, goes in low at the front of it and comes out high on the far side, and misses the head", () => {
  for (const violence of ["cinematic", "full"] as const) for (const seed of [1, 7, 41, 20261111]) for (const count of [2, 3, 4]) {
    const lines = crownThrusts(frame, count, 0.41, seed, violence, 0.047);
    assert.equal(lines.length, count);
    for (const line of lines) {
      assert.equal(line.root.y, 0); assert.ok(!insideTorso(frame, line.root) && Math.hypot(line.root.x - stone.x, line.root.z - stone.z) <= 0.41 + 1e-9, "within the crown");
      assert.ok(Math.abs(Math.hypot(line.axis.x, line.axis.y, line.axis.z) - 1) < 1e-9 && line.axis.y > 0.75, "a slant up, not a skewer across");
      assert.ok(Math.abs(torsoDistance(frame, line.entry)) < 2e-3 && Math.abs(torsoDistance(frame, line.exit)) < 2e-3, "in and out on the body's surface");
      assert.ok(torsoDistance(frame, at(line, ((line.entryAt + line.exitAt) / 2) * line.length)) < -0.03, "and deep through it between");
      assert.ok(line.entry.y < frame.chest.y - 0.05 && line.entry.y > frame.low - frame.radius - 1e-3, "in at the belly");
      assert.ok(line.exit.y > frame.chest.y + 0.08 && line.exit.y < frame.high + frame.radius, "out of the back or a shoulder");
      assert.ok(dot(flat(line.exit, frame), flat(line.root, frame)) < 0, "on the far side from where it stands");
      assert.ok(line.entryAt > 0.25 && line.entryAt < line.exitAt && line.exitAt < 0.9 && line.length - line.exitAt * line.length > 0.12, "its point stands out of the body");
      assert.ok(headGap(frame, line) > 0.05, `clear of the head (${headGap(frame, line).toFixed(3)})`);
    }
  }
  const lines = crownThrusts(frame, 4, 0.41, 7, "cinematic", 0.047);
  assert.ok(dot(flat(lines[0].root, frame), frame.forward) > 0 && dot(flat(lines[1].root, frame), frame.forward) > 0, "the first two from in front");
  assert.ok(dot(flat(lines[3].root, frame), frame.forward) < 0 && dot(flat(lines[3].exit, frame), frame.forward) > 0, "the fourth from behind, out of the front");
});

test("at Minimal the blades rise beside the body, a hand's width off it, and open nothing", () => {
  for (const seed of [1, 7, 41, 20261111]) {
    for (const line of crownThrusts(frame, 4, 0.41, seed, "minimal", 0.047)) {
      assert.equal(line.entryAt, 0); assert.equal(line.exitAt, 0);
      assert.ok(nearest(frame, line) > 0.047 + 0.03, `it never touches the body (${nearest(frame, line).toFixed(3)})`);
      assert.ok(headGap(frame, line) > 0.05 && at(line, line.length).y > frame.high, "nor the head, and stands past the shoulder");
    }
    const king = spikeThrust(frame, seed, "minimal", 1.95, 0.075);
    assert.ok(king.exitAt === 0 && nearest(frame, king) > 0.075 + 0.02 && Math.abs(king.length - 1.95) < 1e-6);
  }
  assert.deepEqual(pierceWounds(crownThrusts(frame, 4, 0.41, 7, "minimal", 0.047), "minimal"), []);
  assert.equal(bloodOf("minimal"), 0);
});

test("the great spike comes up in front of the victim, leans back through it and stands on out of its back, clear of the head", () => {
  for (const seed of [1, 9, 41, 20261111]) for (const length of [1.95, 2.5]) {
    const line = spikeThrust(frame, seed, "cinematic", length, 0.075);
    assert.ok(Math.abs(line.length - length) < 1e-6 && line.root.y === 0);
    assert.ok(dot(flat(line.root, frame), frame.forward) > frame.radius * 2.5, "rooted in front of the victim");
    assert.ok(dot(flat(line.exit, frame), frame.forward) < 0 && line.exit.y > frame.chest.y, "out of its back");
    assert.ok(line.entry.y < frame.chest.y && torsoDistance(frame, at(line, ((line.entryAt + line.exitAt) / 2) * line.length)) < -0.03, "in at the belly, deep through");
    assert.ok(headGap(frame, line) > 0.075 * 0.85, `clear of the head (${headGap(frame, line).toFixed(3)})`);
  }
});

test("each blade through the body opens two wounds, the way the blood goes; Full bleeds harder and again", () => {
  const lines = crownThrusts(frame, 3, 0.41, 7, "full", 0.047);
  for (const violence of ["cinematic", "full"] as const) {
    const wounds = pierceWounds(lines, violence);
    assert.equal(wounds.length, 6);
    wounds.forEach((wound, i) => {
      const line = lines[Math.floor(i / 2)], sign = i % 2 === 0 ? -1 : 1;
      assert.equal(wound.power, WOUND_POWER[violence]);
      assert.deepEqual(wound.at, i % 2 === 0 ? line.entry : line.exit);
      assert.ok(Math.abs(wound.direction.x - sign * line.axis.x) + Math.abs(wound.direction.y - sign * line.axis.y) + Math.abs(wound.direction.z - sign * line.axis.z) < 1e-12, "back along the blade at the entry, on with the point at the exit");
    });
  }
  assert.equal(WOUND_POWER.cinematic, 1.2); assert.equal(WOUND_POWER.full, 1.6);
  assert.deepEqual(twistWounds(lines, "cinematic"), []);
  const again = twistWounds(lines, "full");
  assert.equal(again.length, 3);
  for (const [i, wound] of again.entries()) {
    assert.deepEqual(wound.at, lines[i].exit); assert.ok(wound.power < WOUND_POWER.full && wound.direction.y < lines[i].axis.y, "a little less, and lower");
    assert.ok(Math.abs(Math.hypot(wound.direction.x, wound.direction.y, wound.direction.z) - 1) < 1e-9);
  }
  assert.deepEqual([bloodOf("minimal"), bloodOf("cinematic"), bloodOf("full")], [0, 1, 1.6]);
});

const glacial = (options: { power?: number; brief?: boolean; violence?: (typeof violences)[number]; quality?: "low" | "medium" | "high" | "ultra"; seed?: number } = {}): GlacialCast => {
  const power = options.power ?? 1, size = glacialSize(power, TILE), line = glacialLine(hand, stone, size.seat, TILE);
  return {
    stone, chest, line, timeline: glacialTimeline(line.length, power, options.brief ?? false), size, counts: glacialCounts(options.quality ?? "high", power), power,
    seed: options.seed ?? 41, tile: TILE, violence: options.violence ?? "cinematic",
  };
};

test("the Glacial crown runs the piece through: two to four impalers whose points come out of the body as the crown closes", () => {
  const crown = entry("../../web/src/scene/vfx/spells/glacial/index.ts", "GLACIAL_CROWN");
  assert.match(crown, /death: "pierce"/); assert.match(crown, /mark: "thaw"/);
  const counts = { low: 2, medium: 2, high: 3, ultra: 3 } as const;
  for (const quality of ["low", "medium", "high", "ultra"] as const) for (const power of [1, 1.75]) {
    assert.equal(glacialCounts(quality, power).impalers, Math.min(4, counts[quality] + (power > 1.4 ? 1 : 0)));
  }
  for (const brief of [false, true]) for (const violence of violences) for (const power of [1, 1.75]) {
    const cast = glacial({ brief, violence, power }), { timeline } = cast, blades = glacialBlades(cast), impalers = blades.filter((blade) => blade.role === "impaler");
    const thrusts = glacialThrusts(cast);
    assert.equal(impalers.length, cast.counts.impalers); assert.equal(thrusts.length, impalers.length);
    assert.equal(thrusts[0].at, timeline.strikeAt, "the first is through on the frame of the blow");
    impalers.forEach((blade, i) => {
      const thrust = thrusts[i], out = Math.hypot(thrust.line.exit.x - thrust.line.root.x, thrust.line.exit.y - thrust.line.root.y, thrust.line.exit.z - thrust.line.root.z) / thrust.line.length;
      assert.ok(blade.through && blade.through.at === thrust.at && thrust.at <= timeline.strikeAt + 0.25, "within moments of the blow");
      assert.ok(Math.abs(blade.radius - impalerRadius(cast.size)) < 1e-12 && blade.radius < cast.size.girth, "slimmer than the crown's blades");
      assert.ok(blade.birth > timeline.crown[0], "out of the frozen disc once the crown has begun to close");
      assert.ok(Math.abs(bladeThrust(thrust.at - blade.birth, blade.rise, brief) - out) < 2e-3, "its point is out of the body at its moment");
      assert.ok(bladeThrust(thrust.at - 0.02 - blade.birth, blade.rise, brief) < out, "and not before");
      if (violence === "minimal") assert.ok(blade.through.exit === 0, "beside it at Minimal");
      else assert.ok(blade.through.entry > 0 && blade.through.exit > blade.through.entry);
      assert.ok(blades.filter((other) => other.role !== "impaler").every((other) => blade.breakAt < other.breakAt), "and it breaks before the crown does");
      assert.ok(blade.breakAt < timeline.shatter[0] && blade.breakAt + blade.breakTime > timeline.shatter[0], "breaking as the body is let go");
    });
    if (!brief) assert.ok(impalers.every((blade) => blade.rise <= 0.15), "a punch");
    else assert.ok(impalers.every((blade) => blade.rise >= 0.5), "the brief form thrusts slowly and smoothly");
  }
  // the thrust's inverse is its inverse
  for (const brief of [false, true]) for (const share of [0.1, 0.5, 0.83]) assert.ok(Math.abs(bladeThrust(thrustTime(share, 0.13, brief), 0.13, brief) - share) < 1e-9);
});

test("the crown holds the body up from the blow until the shatter starts, and opens its wounds by the Violence setting", () => {
  for (const brief of [false, true]) {
    const t = glacialTimeline(4.6, 1, brief);
    assert.equal(glacialState(t, t.strikeAt - 1e-6).pinned, false);
    assert.equal(glacialState(t, t.strikeAt).pinned, true);
    assert.equal(glacialState(t, t.shatter[0] - 1e-6).pinned, true);
    assert.equal(glacialState(t, t.shatter[0]).pinned, false);
    assert.equal(glacialState(t, t.duration).pinned, false);
    for (let s = 0; s <= t.duration; s += 1 / 60) assert.equal(glacialState(t, s).pinned, s >= t.strikeAt && s < t.shatter[0]);
  }
  for (const power of [1, 1.75]) for (const brief of [false, true]) {
    const count = glacialCounts("high", power).impalers;
    for (const violence of violences) {
      const cast = glacial({ violence, power, brief }), thrusts = glacialThrusts(cast), events = glacialWounds(cast, thrusts);
      const wounds = events.flatMap((event) => event.wounds);
      if (violence === "minimal") { assert.deepEqual(events, [], "no wound at Minimal"); continue; }
      const twist = violence === "full" && !brief ? count : 0;
      assert.equal(wounds.length, 2 * count + twist, `${violence} ${brief}`);
      assert.deepEqual(events.slice(0, count).map((event) => event.at), thrusts.map((thrust) => thrust.at), "each impaler's two as its point comes out");
      for (const event of events.slice(0, count)) assert.ok(event.wounds.every((wound) => wound.power === WOUND_POWER[violence]));
      if (twist) {
        const last = events.at(-1)!;
        assert.ok(last.at > cast.timeline.strikeAt + 0.3 && last.at < cast.timeline.shatter[0] - 0.3, "the twist comes in the hold");
        assert.ok(glacialState(cast.timeline, last.at + 0.01, power, "full").shake > glacialState(cast.timeline, last.at + 0.01, power, "cinematic").shake, "with a jolt");
      }
      for (const wound of wounds) assert.ok(Math.abs(torsoDistance(torsoFrame(stone, cast.line.from, chest), wound.at)) < 2e-3, "every wound on the body");
    }
  }
});

test("the crown's blood: none at Minimal, a pool under the body and one at each impaler's foot, more at Full", () => {
  const none = glacial({ violence: "minimal" });
  assert.deepEqual(glacialBlood(none, glacialThrusts(none)), { amount: 0, pools: [] });
  const cinematic = glacial({ violence: "cinematic" }), full = glacial({ violence: "full" });
  const a = glacialBlood(cinematic, glacialThrusts(cinematic)), b = glacialBlood(full, glacialThrusts(full));
  assert.equal(a.amount, 1); assert.equal(b.amount, 1.6);
  assert.equal(a.pools.length, 1 + cinematic.counts.impalers);
  assert.ok(Math.hypot(a.pools[0].x, a.pools[0].z) < 0.08 && a.pools[0].delay < 0.3, "under the body, at once");
  for (const [i, pool] of a.pools.entries()) {
    assert.ok(pool.size > 0 && pool.size <= b.pools[i].size - 0.01, "more at Full");
    if (i > 0) assert.ok(pool.delay > 0.3 && pool.delay < 1.5 && pool.delay > b.pools[i].delay - 1e-9, "at a blade's foot once its blood has run down, sooner at Full");
    assert.ok(Math.hypot(pool.x, pool.z) < cinematic.size.sheet * 0.8, "in the sheet");
  }
});

const frost = (options: { power?: number; brief?: boolean; violence?: (typeof violences)[number]; seed?: number } = {}): FrostCast => {
  const line = frostLine(hand, stone, 0, TILE), power = options.power ?? 1;
  return { line, chest, timeline: frostTimeline(line.length, power, options.brief ?? false), budget: FROST_BUDGET.high, power, seed: options.seed ?? 9, tile: TILE, violence: options.violence ?? "cinematic" };
};

test("the frost line's great spike runs the piece through at the blow and holds it up: nearly two seconds, about one in the brief form", () => {
  const line = entry("../../web/src/scene/vfx/spells/frost/index.ts", "FROST_LINE");
  assert.match(line, /death: "pierce"/); assert.match(line, /mark: "thaw"/);
  for (const brief of [false, true]) for (const violence of violences) for (const power of [1, 1.75]) {
    const cast = frost({ brief, violence, power }), spikes = frostSpikes(cast), king = spikes[0], line = kingThrust(cast), { timeline } = cast;
    assert.equal(king.role, "king"); assert.deepEqual(king.root, line.root); assert.ok(Math.abs(king.height - line.length) < 1e-12);
    assert.ok(king.radius === kingRadius(power, TILE) && king.radius < frame.radius * 0.8, "slim enough to run a body through");
    const out = Math.hypot(line.exit.x - line.root.x, line.exit.y - line.root.y, line.exit.z - line.root.z);
    assert.ok(Math.abs(kingHeight(spikes, timeline.strikeAt, brief) - out) < 3e-3, "its point is out of the body at the blow");
    if (violence === "minimal") assert.ok(!king.blood && line.exitAt === 0, "beside the body at Minimal, unbloodied");
    else assert.deepEqual(king.blood, { entry: line.entryAt, exit: line.exitAt });
    const held = timeline.release - timeline.strikeAt;
    assert.ok(brief ? held >= 0.95 && held <= 1.45 : held >= 1.6 && held <= 2.2, `held ${held.toFixed(2)} s`);
    assert.equal(frostState(timeline, timeline.strikeAt - 1e-6).pinned, false);
    assert.equal(frostState(timeline, timeline.strikeAt).pinned, true);
    assert.equal(frostState(timeline, timeline.release - 1e-6).pinned, true);
    assert.equal(frostState(timeline, timeline.release).pinned, false);
    assert.ok(timeline.release >= king.breakAt - 1e-9 && timeline.release < king.breakAt + king.end, "it lets go as the spike breaks through it, or sinks from under it");
    assert.ok(spikes.slice(1).every((spike) => spike.breakAt <= king.breakAt), "the great spike goes last");
  }
});

test("the frost line opens its wounds by the Violence setting, and its blood soaks the rime", () => {
  for (const brief of [false, true]) for (const violence of violences) {
    const cast = frost({ brief, violence }), line = kingThrust(cast), events = frostWounds(cast, line), blood = frostBlood(cast, line);
    if (violence === "minimal") { assert.deepEqual(events, []); assert.deepEqual(blood, { amount: 0, pools: [] }); continue; }
    assert.equal(events[0].at, cast.timeline.strikeAt); assert.equal(events[0].wounds.length, 2);
    assert.ok(events[0].wounds.every((wound) => wound.power === WOUND_POWER[violence]));
    if (violence === "full" && !brief) {
      assert.equal(events.length, 2); assert.equal(events[1].at, cast.timeline.crack); assert.equal(events[1].wounds.length, 1);
      assert.ok(frostState(cast.timeline, cast.timeline.crack + 0.01, 1, "full").shake > frostState(cast.timeline, cast.timeline.crack + 0.01, 1, "cinematic").shake, "with a jolt");
    } else assert.equal(events.length, 1);
    assert.equal(blood.amount, violence === "full" ? 1.6 : 1);
    assert.equal(blood.pools.length, 4);
    assert.ok(Math.hypot(blood.pools[0].x - stone.x, blood.pools[0].z - stone.z) < 0.08 && blood.pools[0].delay < 0.3, "under the body, at once");
    assert.ok(Math.hypot(blood.pools[1].x - line.root.x, blood.pools[1].z - line.root.z) < 1e-9 && blood.pools[1].delay > 0.2, "at the spike's foot once it has run down");
    assert.ok(Math.hypot(blood.pools[2].x - line.exit.x, blood.pools[2].z - line.exit.z) < 1e-9 && Math.hypot(blood.pools[3].x - line.entry.x, blood.pools[3].z - line.entry.z) < 1e-9, "and under each wound");
    assert.ok(blood.pools.length <= 5, "no more than the rime holds");
  }
  const a = frostBlood(frost({ violence: "cinematic" }), kingThrust(frost({ violence: "cinematic" }))), b = frostBlood(frost({ violence: "full" }), kingThrust(frost({ violence: "full" })));
  assert.ok(b.pools.every((pool, i) => pool.size > a.pools[i].size), "more at Full");
});

test("the ice leaves Aethelgard's sear as it melts: the thaw begins after the blow, while the spell still stands, and is told once", () => {
  for (const brief of [false, true]) for (const length of [1, 4, 9]) for (const power of [1, 1.75]) {
    const crown = glacialTimeline(length, power, brief), line = frostTimeline(length, power, brief);
    for (const [name, t, thawAt] of [["crown", crown, (s: number) => glacialState(crown, s, power).thaw], ["line", line, (s: number) => frostState(line, s, power).thaw]] as const) {
      assert.ok(t.thaw[0] > t.strikeAt && t.thaw[0] < t.duration - 0.2, `${name}: the sear comes after the blow and before the spell is gone`);
      assert.equal(thawAt(t.thaw[0] - 0.01), 0, `${name}: nothing melts before the thaw`);
      assert.ok(thawAt(t.thaw[0] + 0.05) > 0, `${name}: and it has begun just after`);
    }
  }
  // Each spell says so (SpellState.thawing), the stage tells the match once, and the match lays the burn then, filed
  // under the move that cast it, on a board that has not moved on.
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  for (const path of ["../../web/src/scene/vfx/spells/glacial/glacialCrown.ts", "../../web/src/scene/vfx/spells/frost/frostLine.ts"]) assert.match(read(path), /this\.state\.thawing = now\.thaw > 0;/);
  assert.match(read("../../web/src/scene/vfx/spells/stage.ts"), /if \(state\.thawing && !flight\.thawed\) \{ flight\.thawed = true; flight\.events\.thaw\?\.\(\); \}/);
  const engine = read("../../web/src/scene/sceneEngine.ts");
  const thaw = engine.slice(engine.indexOf('if (entry.mark === "thaw") {'), engine.indexOf('if (entry.mark === "thaw") {') + 700);
  assert.ok(thaw.includes("this.isStale(revision)") && thaw.includes("sanList.length !== record.length") && thaw.includes("this.burnStone(\"spell\", army, at, from, spell.blast, spell.ring, false, record)"));
});

test("the ice holds the body up long enough to be watched up close, and lets it go before the match stops waiting", async () => {
  const { glacialTimeline } = await import("../../web/src/scene/vfx/spells/glacial/glacialPlan");
  const { frostTimeline } = await import("../../web/src/scene/vfx/spells/frost/frostPlan");
  for (const length of [1, 4, 9]) for (const power of [1, 1.75]) {
    const crown = glacialTimeline(length, power, false), line = frostTimeline(length, power, false);
    const crownHold = crown.shatter[0] - crown.strikeAt, lineHold = line.release - line.strikeAt;
    // The match's shot takes half a second to come in close; the wound is then watched for over a second.
    assert.ok(crownHold >= 1.6 && crownHold <= 2.2, `the crown holds ${crownHold.toFixed(2)} s`);
    assert.ok(lineHold >= 1.6 && lineHold <= 2.2, `the spike holds ${lineHold.toFixed(2)} s`);
    // sceneEngine.ts PIERCE_HOLD: the longest the match holds a body up for a spell that never lets go.
    assert.ok(crownHold < 4 && lineHold < 4);
  }
});
