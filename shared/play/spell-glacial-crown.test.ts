import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLADE_RISE, GLACIAL_BUDGET, GROWTH_STEPS, QUEEN_POWER, SWEEP_TIME, angleDelta, bladeAxis, bladeGeometry, bladeGrowth, glacialBlades, glacialCounts, glacialLine, glacialParticles,
  glacialPlates, glacialSize, glacialState, glacialTimeline, type GlacialCast,
} from "../../web/src/scene/vfx/spells/glacial/glacialPlan";
import { PARTICLE_KIND } from "../../web/src/scene/vfx/spells/shared/particlePlan";
import { chunkFlight } from "../../web/src/scene/vfx/spells/shared/solidPlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.4 * TILE };
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number; violence?: "minimal" | "cinematic" | "full" } = {}): GlacialCast => {
  const power = options.power ?? 1, size = glacialSize(power, TILE), line = glacialLine(hand, stone, size.seat, TILE);
  return {
    stone, chest: { x: stone.x, y: 0.62, z: stone.z }, line, timeline: glacialTimeline(line.length, power, options.brief ?? false), size, counts: glacialCounts(options.quality ?? "high", power),
    power, seed: options.seed ?? 41, tile: TILE, violence: options.violence ?? "cinematic",
  };
};

test("the spell runs in order: the gather, the front, the freeze, the crown closing, the blow, the hold, the shatter, the thaw", () => {
  for (const length of [0.4, 2, 4.6, 9.5]) for (const power of [1, 1.75]) {
    const t = glacialTimeline(length, power, false);
    assert.equal(t.gather[0], 0); assert.equal(t.gather[1], t.front[0]); assert.equal(t.front[1], t.freeze[0]);
    assert.ok(t.front[1] - t.front[0] >= 0.2 - 1e-9 && t.front[1] - t.front[0] <= 0.62 + 1e-9, "the front is seen to run, and is quick");
    assert.ok(t.crown[0] > t.front[1] && t.crown[0] < t.freeze[1] && Math.abs(t.crown[1] - t.crown[0] - SWEEP_TIME) < 2e-3, "the crown rises while the sheet freezes");
    assert.ok(Math.abs(t.strikeAt - t.crown[1] - BLADE_RISE) < 2e-3, "the blow is the last blade up: the crown closed");
    assert.ok(t.shatter[0] - t.strikeAt >= 1.05, "it stands a second and more");
    assert.ok(t.thaw[0] > t.shatter[0] && t.thaw[1] < t.duration && t.duration - t.shatter[1] >= 1 && t.duration < 5.7, `no cast is long (${t.duration})`);
  }
  assert.ok(glacialTimeline(9.5, 1, false).strikeAt > glacialTimeline(2, 1, false).strikeAt, "a longer front arrives later");
  assert.ok(glacialTimeline(4, 1.75, false).shatter[0] - glacialTimeline(4, 1.75, false).strikeAt > glacialTimeline(4, 1, false).shatter[0] - glacialTimeline(4, 1, false).strikeAt, "a Queen's stands longer");
  const brief = glacialTimeline(9.5, 1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 1 && brief.duration <= 2.9);
  assert.deepEqual(brief, glacialTimeline(1, 1, true));
});

test("the blow lands as the crown closes and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const t = glacialTimeline(4.6, 1, brief), first = glacialState(t, 0);
    for (const key of ["freeze", "frost", "flash", "rime", "thaw", "wet", "shake"] as const) assert.equal(first[key], 0, `${key} ${brief}`);
    assert.ok(first.hand < 1e-9 && first.light < 1e-9);
    assert.equal(first.struck, false); assert.equal(first.done, false);
    assert.equal(glacialState(t, t.strikeAt - 1e-6).struck, false);
    assert.equal(glacialState(t, t.strikeAt).struck, true);
    assert.equal(glacialState(t, t.duration - 1e-6).done, false);
    const last = glacialState(t, t.duration);
    assert.equal(last.done, true);
    for (const key of ["rime", "wet", "shake", "light", "flash"] as const) assert.ok(last[key] < 1e-6, `${key} is over`);
    assert.ok(last.thaw > 0.99, "the sheet has drawn back");
  }
});

test("a blade freezes up in jumps and holds between them; the brief form eases up smoothly", () => {
  assert.equal(bladeGrowth(-0.1, 0.2, 4), 0); assert.equal(bladeGrowth(0, 0.2, 4), 0); assert.equal(bladeGrowth(0.2, 0.2, 4), 1); assert.equal(bladeGrowth(5, 0.2, 4), 1);
  let before = 0;
  for (let age = 0; age <= 0.2; age += 0.001) { const now = bladeGrowth(age, 0.2, GROWTH_STEPS); assert.ok(now >= before - 1e-12); before = now; }
  for (let step = 0; step < GROWTH_STEPS; step += 1) {
    const from = (step / GROWTH_STEPS) * 0.2, held = [0.05, 0.25, 0.45].map((share) => bladeGrowth(from + (share / GROWTH_STEPS) * 0.2, 0.2, GROWTH_STEPS));
    assert.ok(Math.max(...held) - Math.min(...held) < 1e-9, "it holds for the first half of each step");
    assert.ok(bladeGrowth(from + (0.99 / GROWTH_STEPS) * 0.2, 0.2, GROWTH_STEPS) - held[0] > 0.2, "and then jumps");
  }
  const smooth = [0.25, 0.5, 0.75].map((share) => bladeGrowth(share * 0.6, 0.6, 0));
  assert.ok(smooth[0] < smooth[1] && smooth[1] < smooth[2] && Math.abs(smooth[1] - 0.5) < 1e-9);
});

test("the crown is a ring round an open middle, its crest uneven, leaning out; it closes from the near side and breaks back from the far", () => {
  for (const power of [1, 1.75]) {
    const cast = make({ power }), blades = glacialBlades(cast), { size, line, timeline, counts } = cast;
    const ring = blades.filter((blade) => blade.role === "ring"), skirt = blades.filter((blade) => blade.role === "skirt");
    assert.equal(ring.length, counts.ring); assert.equal(skirt.length, counts.skirt);
    assert.ok(blades.slice(0, counts.ring).every((blade) => blade.role === "ring"), "the ring first, so a cut list keeps the crown");
    for (const blade of blades) {
      const out = Math.hypot(blade.root.x - stone.x, blade.root.z - stone.z);
      assert.ok(out > size.seat * 0.6, "the middle stays open");
      if (blade.role === "ring") {
        assert.ok(Math.abs(out - size.seat) <= size.seat * 0.12);
        const axis = bladeAxis(blade);
        assert.ok(axis.x * Math.cos(blade.bearing) + axis.z * Math.sin(blade.bearing) > 0, "leaning outward");
      }
      assert.ok(blade.birth >= timeline.crown[0] - 1e-9 && blade.breakAt + blade.breakTime <= timeline.shatter[1] + 0.05);
      // the impalers break first, to let the body go (shared/play/spell-pierce.test.ts)
      if (blade.role !== "impaler") assert.ok(blade.breakAt >= timeline.shatter[0] - 0.06);
    }
    const heights = ring.map((blade) => blade.height);
    assert.ok(Math.max(...heights) > Math.min(...heights) * 1.6, "an uneven crest");
    const near = ring.reduce((a, b) => (Math.abs(angleDelta(a.bearing, line.entry)) < Math.abs(angleDelta(b.bearing, line.entry)) ? a : b));
    const far = ring.reduce((a, b) => (Math.abs(angleDelta(a.bearing, line.entry)) > Math.abs(angleDelta(b.bearing, line.entry)) ? a : b));
    assert.ok(near.birth < far.birth - SWEEP_TIME * 0.7, "the nearest blade first, the far side last");
    assert.ok(Math.max(...ring.map((blade) => blade.birth + blade.rise)) <= timeline.strikeAt + 0.05, "every blade is up when the crown closes");
    assert.ok(far.breakAt < near.breakAt, "the shatter runs back from where it closed");
  }
  const bishop = glacialSize(1, TILE), queen = glacialSize(1.75, TILE);
  assert.ok(bishop.seat < 0.51 * TILE && queen.seat > bishop.seat * 1.25 && queen.blade > bishop.blade && queen.sheet > bishop.sheet);
  assert.ok(bishop.sheet > bishop.seat * 1.5, "the sheet reaches past the crown's feet");
  assert.ok(1 < QUEEN_POWER && 1.75 >= QUEEN_POWER);
});

test("the front runs from in front of the caster to the crown's near side, and the crown starts there", () => {
  const size = glacialSize(1, TILE), line = glacialLine(hand, stone, size.seat, TILE), reach = Math.hypot(stone.x - hand.x, stone.z - hand.z);
  assert.ok(Math.abs(Math.hypot(line.from.x - hand.x, line.from.z - hand.z) - 0.5 * TILE) < 1e-9 && line.from.y === 0);
  assert.ok(Math.abs(Math.hypot(line.to.x - stone.x, line.to.z - stone.z) - size.seat) < 1e-9 && Math.abs(line.length - (reach - 0.5 * TILE - size.seat)) < 1e-9);
  const toward = Math.atan2(hand.z - stone.z, hand.x - stone.x);
  assert.ok(Math.abs(angleDelta(line.entry, toward)) < 1e-9, "the crown closes from the side facing the caster");
});

test("every envelope stays in range; the closing flashes and shakes, the thaw leaves wet stone, and the brief form does neither", () => {
  for (const power of [1, 1.75]) for (const brief of [false, true]) {
    const t = glacialTimeline(4.6, power, brief);
    for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
      const now = glacialState(t, s, power);
      for (const key of ["hand", "front", "freeze", "frost", "flash", "rime", "thaw", "wet"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, `${key} ${now[key]} at ${s.toFixed(2)}`);
      assert.ok(now.shake >= 0 && now.shake <= 1 && now.light >= 0 && now.light < 6 && [0, 1, 2].includes(now.lightAt));
    }
    if (!brief) {
      const blow = glacialState(t, t.strikeAt + 0.005, power);
      assert.ok(blow.flash > 0.9 && blow.light > 3 && blow.shake > 0.3);
      assert.ok(glacialState(t, t.strikeAt + 0.4, power).rime > 0.9, "the air inside has frozen white");
      assert.ok(glacialState(t, t.front[1] - 1e-6).front > 0.99 && glacialState(t, t.front[0]).front === 0);
    }
    assert.ok(glacialState(t, (t.thaw[0] + t.thaw[1]) / 2 + 0.2, power).wet > 0.2, "wet stone where it thawed");
  }
  const b = glacialTimeline(4.6, 1.75, true);
  let jump = 0, before = glacialState(b, 0, 1.75);
  for (let s = 0; s <= b.duration; s += 1 / 120) {
    const now = glacialState(b, s, 1.75);
    assert.equal(now.flash, 0); assert.equal(now.shake, 0);
    jump = Math.max(jump, Math.abs(now.light - before.light)); before = now;
  }
  assert.ok(jump < 0.05, `nothing rushes (${jump.toFixed(3)})`);
});

test("a blade's cut is a blunt faceted wedge standing in the stone", () => {
  for (const sides of [6, 7]) {
    const cut = bladeGeometry(9, sides);
    assert.equal(cut.length, sides * 5 * 9, "two bands of two faces a side, and the point");
    let top = 0, widest = 0, high = 0;
    for (let i = 0; i < cut.length; i += 3) {
      const r = Math.hypot(cut[i], cut[i + 2]);
      assert.ok(cut[i + 1] >= 0 && cut[i + 1] <= 1 && r <= 0.56);
      top = Math.max(top, cut[i + 1]); widest = Math.max(widest, cut[i + 1] < 0.01 ? r : 0);
      if (cut[i + 1] > 0.8 && cut[i + 1] < 0.95) high = Math.max(high, r);
    }
    assert.equal(top, 1); assert.ok(widest > 0.4 && high > 0.1 && high < widest * 0.5, "blunt: about a third as wide near its point");
  }
  assert.deepEqual(bladeGeometry(9), bladeGeometry(9)); assert.notDeepEqual(bladeGeometry(9), bladeGeometry(10));
});

test("the shatter throws loose plates outward that land and skid near the crown; the brief form throws none", () => {
  const cast = make(), blades = glacialBlades(cast), plates = glacialPlates(cast, blades);
  assert.equal(plates.length, cast.counts.plates);
  for (const plate of plates) {
    assert.ok(plate.loose && plate.end <= cast.timeline.duration + 1e-9 && plate.birth >= cast.timeline.shatter[0] - 0.12 && plate.birth <= cast.timeline.shatter[1] + 0.05);
    const out = { x: plate.root.x - stone.x, z: plate.root.z - stone.z };
    assert.ok(out.x * plate.fling!.x + out.z * plate.fling!.z > -0.3, "thrown outward, more or less");
    const rest = chunkFlight(plate.root, plate.fling!, plate.radius * 0.6, plate.end - plate.birth);
    assert.ok(Math.hypot(rest.x - stone.x, rest.z - stone.z) < 2.6 * TILE, "and lying near the crown");
  }
  assert.equal(glacialPlates(make({ brief: true }), glacialBlades(make({ brief: true }))).length, 0);
});

test("a higher tier has more of everything, a Queen's has more again, and each keeps to its budget", () => {
  let before = { light: 0, mist: 0, blades: 0 };
  for (const quality of tiers) {
    const cast = make({ quality }), blades = glacialBlades(cast), loose = glacialParticles(cast, blades, hand), budget = GLACIAL_BUDGET[quality];
    assert.ok(loose.light.length > before.light && loose.mist.length > before.mist && blades.length > before.blades, quality);
    assert.ok(loose.light.length <= budget.sparks * 1.2 + blades.length + 6, `${quality} light (${loose.light.length})`);
    assert.ok(loose.mist.length <= budget.mist);
    before = { light: loose.light.length, mist: loose.mist.length, blades: blades.length };
  }
  assert.ok(glacialCounts("high", 1.75).ring === glacialCounts("high", 1).ring + 6);
  assert.ok(glacialParticles(make({ power: 1.75 }), glacialBlades(make({ power: 1.75 })), hand).light.length > glacialParticles(make(), glacialBlades(make()), hand).light.length * 1.2);
});

test("the dice are the cast's, nothing loose outlives the spell, the front glitters as it passes, and the air inside freezes on the blow", () => {
  const blades = (cast: GlacialCast) => glacialBlades(cast);
  assert.deepEqual(glacialParticles(make({ seed: 3 }), blades(make({ seed: 3 })), hand), glacialParticles(make({ seed: 3 }), blades(make({ seed: 3 })), hand));
  assert.deepEqual(glacialBlades(make({ seed: 3 })), glacialBlades(make({ seed: 3 })));
  assert.notDeepEqual(glacialBlades(make({ seed: 3 })), glacialBlades(make({ seed: 4 })));
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const cast = make({ brief, power }), loose = glacialParticles(cast, blades(cast), hand), { timeline, line, size } = cast;
    for (const particle of [...loose.light, ...loose.mist]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.y + particle.size));
      if (brief) {
        assert.ok(particle.kind !== PARTICLE_KIND.streak, "nothing in the brief form streaks");
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.7, "everything drifts");
      }
    }
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its light");
    assert.ok(loose.mist.every((particle) => particle.kind === PARTICLE_KIND.puff));
    if (!brief) {
      const along = (p: { x: number; z: number }) => ((p.x - line.from.x) * (line.to.x - line.from.x) + (p.z - line.from.z) * (line.to.z - line.from.z)) / (line.length * line.length);
      const front = loose.light.filter((particle) => !particle.anchored && particle.birth >= timeline.front[0] && particle.birth < timeline.front[1] + 0.03 && particle.origin.y < 0.05);
      assert.ok(front.length > 10);
      for (const glint of front) assert.ok(glint.birth >= timeline.front[0] + (timeline.front[1] - timeline.front[0]) * Math.max(0, along(glint.origin)) ** (1 / 1.4) - 0.01, "born as the front passes, not before");
      const frozen = loose.mist.filter((puff) => puff.birth >= timeline.strikeAt && puff.birth < timeline.strikeAt + 0.06);
      assert.ok(frozen.length >= 3 && frozen.every((puff) => Math.hypot(puff.origin.x - stone.x, puff.origin.z - stone.z) < size.seat && puff.velocity.y > 0.5), "the air inside the crown freezes and rises");
    }
  }
});
