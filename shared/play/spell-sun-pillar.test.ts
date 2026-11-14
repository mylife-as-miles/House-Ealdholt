import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORONA_POWER, SUN_BUDGET, WARN_PULSES, headFallen, penStart, sunGrit, sunParticles, sunShafts, sunSizes, sunState, sunTimeline, type SunCast,
} from "../../web/src/scene/vfx/spells/sun/sunPlan";
import { PARTICLE_KIND } from "../../web/src/scene/vfx/spells/shared/particlePlan";
import { chunkFlight } from "../../web/src/scene/vfx/spells/shared/solidPlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.2 * TILE };
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number } = {}): SunCast => {
  const power = options.power ?? 1;
  return { stone, hand, timeline: sunTimeline(power, options.brief ?? false), sizes: sunSizes(power, TILE), budget: SUN_BUDGET[options.quality ?? "high"], power, seed: options.seed ?? 5, tile: TILE };
};

test("the spell runs in order: gather, the pens, the warning, the fall, the burn, the collapse, the cooling", () => {
  for (const power of [1, 1.75]) {
    const t = sunTimeline(power, false);
    assert.equal(t.gather[0], 0);
    assert.ok(t.pen[0] > 0 && t.pen[1] > t.pen[0] + 0.4, "the ring is seen to be drawn");
    assert.ok(t.warn[0] >= t.pen[1], "it warns once it is whole");
    assert.ok(t.fall[0] - t.warn[0] >= 0.5, "and warns for half a second before anything falls");
    assert.ok(t.fall[1] === t.strikeAt && t.warn[1] === t.strikeAt && t.fall[1] - t.fall[0] >= 0.15 && t.fall[1] - t.fall[0] <= 0.3);
    assert.ok(t.collapse[0] - t.strikeAt >= 0.85 && t.collapse[1] - t.collapse[0] >= 1, "it burns, and the collapse is slow");
    assert.ok(t.duration > t.collapse[1] + 0.5 && t.duration < 5.2);
  }
  assert.equal(sunTimeline(1, false).strikeAt, sunTimeline(1.75, false).strikeAt, "the blow lands at the same moment whoever casts");
  assert.ok(sunTimeline(1.75, false).collapse[0] > sunTimeline(1, false).collapse[0], "a Queen's burns longer");
  const brief = sunTimeline(1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 0.9 && brief.duration <= 2.6);
});

test("the blow lands at strikeAt and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const t = sunTimeline(1, brief), first = sunState(t, 0);
    for (const key of ["hand", "ring", "warn", "thread", "column", "flash", "heat", "scorch", "shake", "glow", "erode"] as const) assert.equal(first[key], 0, `${key} ${brief}`);
    assert.equal(first.struck, false); assert.equal(first.done, false); assert.equal(first.sinceStrike, -1);
    assert.equal(sunState(t, t.strikeAt - 1e-6).struck, false);
    assert.equal(sunState(t, t.strikeAt).struck, true);
    assert.equal(sunState(t, t.duration - 1e-6).done, false);
    const last = sunState(t, t.duration);
    assert.equal(last.done, true);
    for (const key of ["hand", "ring", "thread", "column", "heat", "scorch", "shake"] as const) assert.ok(last[key] < 1e-6, `${key} is over`);
    assert.ok(last.glow < 0.02 && last.flash < 1e-6 && last.erode === 1);
  }
});

test("the ring is whole before it warns, the warning builds in quickening pulses, and a thread comes before the column", () => {
  const t = sunTimeline(1, false);
  assert.equal(sunState(t, t.pen[0]).drawn, 0);
  assert.ok(Math.abs(sunState(t, (t.pen[0] + t.pen[1]) / 2).drawn - 0.5) < 1e-9, "the pens keep one speed");
  assert.equal(sunState(t, t.warn[0]).drawn, 1); assert.equal(sunState(t, t.warn[0]).warn, 0);
  let last = 0;
  for (let s = t.warn[0]; s < t.strikeAt; s += 0.01) { const now = sunState(t, s); assert.ok(now.warn >= last); last = now.warn; }
  assert.ok(last > 0.95);
  for (let i = 1; i < WARN_PULSES.length - 1; i += 1) assert.ok(WARN_PULSES[i + 1] - WARN_PULSES[i] < WARN_PULSES[i] - WARN_PULSES[i - 1], "each pulse comes sooner than the last");
  const span = t.warn[1] - t.warn[0], at = t.warn[0] + WARN_PULSES[1] * span;
  assert.ok(sunState(t, at).ring > sunState(t, at - 0.07).ring + 0.3 && sunState(t, at).ring > sunState(t, at + 0.07).ring + 0.2, "a pulse stands out of the ring's own light");
  assert.ok(sunState(t, t.fall[0] - 0.05).thread > 0.9 && sunState(t, t.fall[0] - 0.05).column > 0, "the thread stands before the fall");
  assert.equal(sunState(t, t.warn[0]).thread, 0); assert.ok(sunState(t, t.strikeAt).thread < 1e-6, "and is gone into the column");
});

test("the column's head comes down faster and faster and lands on the blow; in the brief form nothing falls", () => {
  const t = sunTimeline(1, false), fall = t.fall[1] - t.fall[0];
  assert.equal(headFallen(t, -0.2), 0); assert.equal(headFallen(t, 0), 0); assert.equal(headFallen(t, fall), 1); assert.equal(headFallen(t, 5), 1);
  assert.ok(headFallen(t, fall / 2) < 0.3, "it is still high at half time");
  assert.ok(Math.abs(sunState(t, t.strikeAt).sinceFall - fall) < 1e-9);
  assert.ok(sunState(t, t.fall[0] - 0.2).sinceFall < 0);
  const brief = sunTimeline(1, true);
  for (const s of [-1, 0, 0.1, 3]) assert.equal(headFallen(brief, s), 1);
  let before = 0;
  for (let s = 0; s <= brief.collapse[0]; s += 0.01) { const now = sunState(brief, s); assert.ok(now.column >= before - 1e-9, "the column only swells into being"); before = now.column; assert.equal(now.thread, 0); }
});

test("every envelope stays in range; the column swells as it lands, narrows as it collapses, and the stone cools", () => {
  for (const power of [1, 1.75]) {
    const t = sunTimeline(power, false);
    let hottest = 0;
    for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
      const now = sunState(t, s, power);
      for (const key of ["hand", "drawn", "warn", "thread", "column", "erode", "flash", "heat", "scorch"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, `${key} ${now[key]} at ${s.toFixed(2)}`);
      assert.ok(now.ring >= 0 && now.ring <= 1.7 && now.width > 0.45 && now.width <= 1.31 && now.shake >= 0 && now.shake <= 1 && now.glow >= 0 && now.glow < 8);
      hottest = Math.max(hottest, now.heat);
    }
    assert.equal(hottest, 1);
    assert.ok(sunState(t, t.strikeAt + 0.01).width > 1.25 && sunState(t, t.collapse[1]).width < 0.52);
    const burning = sunState(t, t.strikeAt + 0.5), cooling = sunState(t, t.collapse[1] + 0.2);
    assert.ok(burning.column === 1 && burning.heat >= 0.75 && burning.scorch === 1);
    assert.ok(cooling.column === 0 && cooling.heat > 0.03 && cooling.heat < burning.heat && cooling.ring > 0.3, "the ring outlasts the column, cooling");
  }
});

test("the column lands whole, then its foot thins round the body it burns, and stays thin until it is gone", () => {
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const t = sunTimeline(power, brief);
    assert.equal(sunState(t, t.strikeAt - 0.01, power).clear, 0, "nothing thins before it lands");
    assert.ok(sunState(t, t.strikeAt + 0.05, power).clear < 0.05, "the blow is seen whole");
    let last = 0;
    for (let s = t.strikeAt; s <= t.duration; s += 1 / 120) {
      const clear = sunState(t, s, power).clear;
      assert.ok(clear >= last - 1e-9 && clear <= 1, `it only thins, ${clear} at ${s.toFixed(2)}`);
      last = clear;
    }
    assert.equal(sunState(t, t.strikeAt + 0.4, power).clear, 1, "a beat after the blow the kill is seen");
  }
  // the thinning reaches past the tallest figure's chest, and stays well under the column's height
  assert.ok(sunSizes(1, TILE).clear >= 1.4 && sunSizes(1.75, TILE).clear < sunSizes(1.75, TILE).height * 0.2);
});

test("the blow shakes and flashes; the brief form does neither, and its light only swells and ebbs", () => {
  const t = sunTimeline(1, false), b = sunTimeline(1, true);
  assert.ok(sunState(t, t.strikeAt + 0.01).shake > 0.45 && sunState(t, t.strikeAt + 0.01, 1.75).shake > sunState(t, t.strikeAt + 0.01, 1).shake);
  assert.ok(sunState(t, t.strikeAt + 0.01).glow > 4);
  assert.equal(sunState(t, t.strikeAt - 0.01).shake, 0); assert.equal(sunState(t, t.collapse[0] + 0.4).shake < 0.01, true);
  let brightest = 0, jump = 0, before = 0;
  for (let s = 0; s <= b.duration; s += 1 / 120) {
    const now = sunState(b, s);
    assert.equal(now.shake, 0); assert.equal(now.flash, 0);
    brightest = Math.max(brightest, now.glow); jump = Math.max(jump, Math.abs(now.glow - before)); before = now.glow;
  }
  assert.ok(brightest <= 2 && jump < 0.05);
});

test("the ring fits the victim's square for a Bishop; a Queen's is larger and has a corona that lands first", () => {
  const bishop = sunSizes(1, TILE), queen = sunSizes(1.75, TILE);
  assert.ok(bishop.ring < 0.5 * TILE && bishop.ring > 0.4 * TILE);
  assert.ok(queen.ring > bishop.ring * 1.15 && queen.ring < 0.62 * TILE && queen.reach > bishop.reach);
  assert.ok(bishop.core < bishop.column * 0.5 && bishop.column < bishop.ring, "a white core inside a sheath inside the ring");
  assert.ok(bishop.height > 10, "it comes from above the arena");
  assert.equal(bishop.corona, 0); assert.equal(queen.corona, 6); assert.ok(1 < CORONA_POWER && 1.75 >= CORONA_POWER);
  const t = sunTimeline(1.75, false), shafts = sunShafts(queen, t), fall = t.fall[1] - t.fall[0];
  assert.deepEqual(shafts.slice(0, 3).map((shaft) => shaft.kind), ["sheath", "core", "thread"]);
  const corona = shafts.filter((shaft) => shaft.kind === "corona");
  assert.equal(corona.length, 6);
  corona.forEach((shaft, i) => {
    assert.ok(Math.abs(Math.hypot(shaft.x, shaft.z) - queen.ring) < 1e-9, "on the ring");
    assert.ok(shaft.delay < 0 && shaft.delay + fall < fall, "landed before the column does");
    assert.ok(shaft.delay >= -0.3, "and not before the spell lets anything fall");
    if (i > 0) assert.ok(shaft.delay > corona[i - 1].delay, "one after another round the ring");
    assert.equal(headFallen(t, -0.3, shaft.delay), 0); assert.equal(headFallen(t, fall - 0.1, shaft.delay), 1);
  });
  assert.equal(sunShafts(bishop, sunTimeline(1, false)).length, 3);
});

test("the pens start on the side of the ring that faces the caster", () => {
  const start = penStart({ stone, hand });
  const toward = { x: Math.cos(start), z: Math.sin(start) }, want = { x: hand.x - stone.x, z: hand.z - stone.z }, far = Math.hypot(want.x, want.z);
  assert.ok(Math.abs(toward.x - want.x / far) < 1e-9 && Math.abs(toward.z - want.z / far) < 1e-9);
});

test("a higher tier has more of everything, each keeps to its budget, and the lowest has no grit and no cracks", () => {
  let before = { light: 0, dust: 0, grit: -1 };
  for (const quality of tiers) {
    const cast = make({ quality }), loose = sunParticles(cast), grit = sunGrit(cast);
    assert.ok(loose.light.length > before.light && loose.dust.length > before.dust && grit.length > before.grit, quality);
    const budget = SUN_BUDGET[quality];
    assert.ok(loose.light.length <= budget.embers + budget.sparks + budget.motes + 8, `${quality} (${loose.light.length})`);
    assert.ok(loose.dust.length <= budget.dust && grit.length <= budget.grit);
    before = { light: loose.light.length, dust: loose.dust.length, grit: grit.length };
  }
  assert.equal(SUN_BUDGET.low.grit, 0); assert.equal(SUN_BUDGET.low.cracks, 0);
  const queen = sunParticles(make({ power: 1.75 })), bishop = sunParticles(make());
  assert.ok(queen.light.length > bishop.light.length * 1.2 && queen.dust.length > bishop.dust.length);
});

test("the dice are the cast's: the same seed gives the same spell, another seed a different one", () => {
  assert.deepEqual(sunParticles(make({ seed: 3 })), sunParticles(make({ seed: 3 })));
  assert.deepEqual(sunGrit(make({ seed: 3 })), sunGrit(make({ seed: 3 })));
  assert.notDeepEqual(sunParticles(make({ seed: 3 })).light.slice(0, 40), sunParticles(make({ seed: 4 })).light.slice(0, 40));
});

test("sparks are thrown at the blow and never before; embers come off the column as it collapses, the top's first", () => {
  const cast = make(), { timeline, sizes } = cast, loose = sunParticles(cast);
  const thrown = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && Math.hypot(particle.velocity.x, particle.velocity.z) > 2);
  assert.ok(thrown.length > 40);
  for (const spark of thrown) {
    assert.ok(spark.birth >= timeline.strikeAt && spark.birth < timeline.strikeAt + 0.05);
    assert.ok(spark.velocity.y > 0 && spark.velocity.y < Math.hypot(spark.velocity.x, spark.velocity.z), "low along the stone");
    assert.ok((spark.origin.x - stone.x) * spark.velocity.x + (spark.origin.z - stone.z) * spark.velocity.z > 0, "outward");
  }
  const shed = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.mote && !particle.anchored && particle.birth >= timeline.collapse[0] + 0.05);
  assert.ok(shed.length > 80);
  const high = shed.filter((ember) => ember.origin.y > 2), low = shed.filter((ember) => ember.origin.y < 0.8);
  const mean = (list: typeof shed) => list.reduce((sum, ember) => sum + ember.birth, 0) / list.length;
  assert.ok(high.length > 5 && mean(high) < mean(low), "the top of the column goes first");
  for (const ember of shed) {
    assert.ok(Math.hypot(ember.origin.x - stone.x, ember.origin.z - stone.z) <= sizes.ring * 0.76 && ember.birth <= timeline.collapse[1] + 1e-9);
    assert.ok((ember.gravity ?? 0) < 0 && (ember.wander ?? 0) > 0, "they drift on rising air");
  }
  const pens = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth < timeline.pen[1] + 0.03);
  assert.ok(pens.length > 10);
  for (const spark of pens) assert.ok(Math.abs(Math.hypot(spark.origin.x - stone.x, spark.origin.z - stone.z) - sizes.ring) < 1e-9 && spark.birth >= timeline.pen[0], "pen sparks start on the ring while it is drawn");
});

test("nothing loose outlives the spell; grit lands near the square; the brief form has nothing that rushes", () => {
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const cast = make({ brief, power }), loose = sunParticles(cast), grit = sunGrit(cast);
    for (const particle of [...loose.light, ...loose.dust]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= cast.timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.x + particle.size));
      if (brief) {
        assert.notEqual(particle.kind, PARTICLE_KIND.streak);
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.7, "everything drifts");
      }
    }
    assert.ok(loose.dust.every((particle) => particle.kind === PARTICLE_KIND.puff) && loose.light.every((particle) => particle.kind !== PARTICLE_KIND.puff));
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its light");
    if (brief) assert.equal(grit.length, 0);
    for (const piece of grit) {
      assert.ok(piece.loose && piece.birth >= cast.timeline.strikeAt && piece.end <= cast.timeline.duration && piece.radius < 0.06);
      const rest = chunkFlight(piece.root, piece.fling!, piece.radius * 0.6, piece.end - piece.birth);
      assert.ok(Math.hypot(rest.x - stone.x, rest.z - stone.z) < 3.4 * TILE);
    }
  }
});
