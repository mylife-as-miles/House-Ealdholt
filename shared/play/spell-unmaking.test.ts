import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GLYPH_CLIMB, GLYPH_RING, QUEEN_POWER, RUNE_CELLS, UNMAKING_BUDGET, cordHead, glyphFlight, glyphPeels, grainLoop, penStart, runeTurn, unmakingCounts, unmakingParticles,
  unmakingSize, unmakingState, unmakingTimeline, type UnmakingCast,
} from "../../web/src/scene/vfx/spells/unmaking/unmakingPlan";
import { PARTICLE_KIND } from "../../web/src/scene/vfx/spells/shared/particlePlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.4 * TILE };
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number } = {}): UnmakingCast => {
  const power = options.power ?? 1;
  return { stone, hand, timeline: unmakingTimeline(power, options.brief ?? false), size: unmakingSize(power, TILE), counts: unmakingCounts(options.quality ?? "high", power), power, seed: options.seed ?? 11, tile: TILE };
};

test("the spell runs in order: written, a held beat that ends in an inhale, the blow, the column standing, the close, the cooling", () => {
  for (const power of [1, 1.75]) {
    const t = unmakingTimeline(power, false);
    assert.ok(t.write[0] >= 0 && t.write[1] - t.write[0] >= 0.45, "the rune is seen to be written");
    assert.equal(t.beat[0], t.write[1]); assert.equal(t.beat[1], t.strikeAt);
    assert.ok(t.strikeAt - t.write[1] >= 0.6, "and is held, whole, for a beat before anything comes");
    assert.ok(t.inhale[1] === t.strikeAt && t.inhale[1] - t.inhale[0] >= 0.25 && t.inhale[0] > t.beat[0] + 0.2, "the beat ends in an inhale");
    assert.ok(t.rise > 0.1 && t.rise < 0.3);
    assert.ok(t.close[0] - t.strikeAt >= 1.1, "the column stands for over a second while the body burns");
    assert.ok(t.close[1] - t.close[0] >= 0.35 && t.duration - t.close[1] >= 0.8 && t.duration < 4.5);
  }
  assert.ok(unmakingTimeline(1.75, false).strikeAt > unmakingTimeline(1, false).strikeAt, "a Queen's beat is a little longer");
  assert.ok(unmakingTimeline(1.75, false).close[0] - unmakingTimeline(1.75, false).strikeAt > unmakingTimeline(1, false).close[0] - unmakingTimeline(1, false).strikeAt, "and her column stands longer");
  const brief = unmakingTimeline(1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 0.8 && brief.duration <= 2.7);
  assert.deepEqual(brief, unmakingTimeline(1, true), "the brief form is the same for every cast");
});

test("the blow lands at strikeAt and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const t = unmakingTimeline(1, brief), first = unmakingState(t, 0);
    // the brief form's rune is whole from the start (nothing writes it), but unlit
    for (const key of ["ink", "dark", "inhale", "reach", "column", "cords", "grains", "flash", "burnt", "shake"] as const) assert.equal(first[key], 0, `${key} ${brief}`);
    if (!brief) { assert.equal(first.drawn, 0); assert.equal(first.girth, 0); }
    assert.ok(first.hand < 1e-9 && first.light < 1e-9);
    assert.equal(first.struck, false); assert.equal(first.done, false); assert.equal(first.sinceStrike, -1);
    assert.equal(unmakingState(t, t.strikeAt - 1e-6).struck, false);
    assert.equal(unmakingState(t, t.strikeAt).struck, true);
    assert.equal(unmakingState(t, t.duration - 1e-6).done, false);
    const last = unmakingState(t, t.duration);
    assert.equal(last.done, true);
    for (const key of ["hand", "ink", "dark", "reach", "column", "cords", "grains", "shake", "light"] as const) assert.ok(last[key] < 1e-6, `${key} is over`);
    assert.ok(last.burnt > 0.99 && last.cold > 0.99, "the rune has burnt out and cooled");
  }
});

test("the rune is written by a pen and turns, holds still through the beat, and is ratcheted on by the blow", () => {
  const t = unmakingTimeline(1, false);
  assert.equal(unmakingState(t, t.write[0]).drawn, 0); assert.equal(unmakingState(t, t.write[1]).drawn, 1);
  assert.ok(Math.abs(unmakingState(t, (t.write[0] + t.write[1]) / 2).drawn - 0.5) < 1e-9);
  assert.ok(runeTurn(t, t.write[1]) > runeTurn(t, t.write[0]) + 0.3, "it turns as it is written");
  const still = runeTurn(t, t.write[1] + 0.36);
  for (let s = t.write[1] + 0.36; s < t.strikeAt; s += 0.02) assert.ok(Math.abs(runeTurn(t, s) - still) < 1e-9, "and is still through the beat");
  assert.ok(runeTurn(t, t.strikeAt + 0.14) > still + 0.1, "the blow ratchets it on");
  assert.ok(runeTurn(t, t.close[0]) < runeTurn(t, t.strikeAt + 0.14), "and it turns slowly back while the column stands");
  const written = unmakingState(t, t.write[1] + 0.05);
  assert.ok(written.scale > 0.97 && written.scale < 1.12, "it has irised out to its size");
  assert.ok(unmakingState(t, t.write[0] + 0.01).scale < 0.7, "from smaller");
});

test("the inhale draws everything in: the rune goes dark and tightens, the stone darkens, and the column erupts from it", () => {
  const t = unmakingTimeline(1, false), before = unmakingState(t, t.inhale[0]), held = unmakingState(t, t.strikeAt - 0.005);
  assert.equal(before.inhale, 0); assert.ok(held.inhale > 0.99);
  assert.ok(held.ink < before.ink * 0.3, "its light is drawn in and out");
  assert.ok(held.scale < before.scale - 0.07, "it tightens");
  assert.ok(held.dark > before.dark + 0.2 && held.dark >= 0.7, "the void under it is deepest just before the blow");
  assert.ok(held.shake > 0 && held.shake < 0.05, "a tremor, no more");
  const blow = unmakingState(t, t.strikeAt + 0.004);
  assert.equal(blow.inhale, 0); assert.ok(blow.flash > 0.9 && blow.ink > 1.5 && blow.light > 4 && blow.shake > 0.35);
  assert.ok(unmakingState(t, t.strikeAt + t.rise * 0.1).reach > 0.45, "half its height in the first tenth of its rise");
  assert.equal(unmakingState(t, t.strikeAt + t.rise).reach, 1);
  assert.ok(unmakingState(t, t.strikeAt + 0.01).girth > 1.35, "fat as it comes out of the stone");
  assert.ok(Math.abs(unmakingState(t, t.strikeAt + t.rise + 0.01).girth - 1) < 0.06, "and settling to its own width");
});

test("every envelope stays in range; the column breathes while it stands and is drawn down into the rune as a thread", () => {
  for (const power of [1, 1.75]) for (const brief of [false, true]) {
    const t = unmakingTimeline(power, brief);
    let peak = 0, last = { reach: 0 };
    for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
      const now = unmakingState(t, s, power);
      for (const key of ["hand", "handDrawn", "drawn", "dark", "inhale", "reach", "cords", "fling", "grains", "closing", "flash", "burnt", "cold"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, `${key} ${now[key]} at ${s.toFixed(2)}`);
      assert.ok(now.scale > 0.5 && now.scale < 1.2 && now.girth >= 0 && now.girth < 1.5 && now.column >= 0 && now.column < 1.4 && now.ink >= 0 && now.ink < 2.6);
      assert.ok(now.shake >= 0 && now.shake <= 1 && now.light >= 0 && now.light < 6.5);
      if (s > t.close[0]) assert.ok(now.reach <= last.reach + 1e-9, "it only sinks once it closes");
      peak = Math.max(peak, now.reach); last = now;
    }
    assert.ok(peak > 0.99, "it stands at its full height");
    if (!brief) {
      const standing = [0.4, 0.6, 0.8].map((at) => unmakingState(t, t.strikeAt + at, power).girth);
      assert.ok(Math.max(...standing) - Math.min(...standing) > 0.01, "it breathes");
      const thread = unmakingState(t, t.close[1] - 0.02, power);
      assert.ok(thread.girth < 0.2 && thread.reach < 0.1, "a thread, nearly gone into the stone");
      assert.ok(unmakingState(t, t.close[1] + 0.05, power).ink > unmakingState(t, t.close[0] - 0.05, power).ink, "the rune takes the last of the light");
      assert.ok(unmakingState(t, (t.close[0] + t.close[1]) / 2, power).fling > 0.4, "the cords are flung off as it closes");
    }
  }
});

test("the column comes up whole, then its foot thins round the body it unmakes, and stays thin until it is drawn back", () => {
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const t = unmakingTimeline(power, brief);
    assert.equal(unmakingState(t, t.strikeAt - 0.01, power).clear, 0, "nothing thins before it comes");
    assert.ok(unmakingState(t, t.strikeAt + 0.1, power).clear < 0.05, "its eruption is seen whole");
    let last = 0;
    for (let s = t.strikeAt; s <= t.duration; s += 1 / 120) {
      const clear = unmakingState(t, s, power).clear;
      assert.ok(clear >= last - 1e-9 && clear <= 1, `it only thins, ${clear} at ${s.toFixed(2)}`);
      last = clear;
    }
    assert.equal(unmakingState(t, t.strikeAt + 0.5, power).clear, 1, "half a second on, the body is seen");
    assert.ok(t.strikeAt + 0.5 < t.close[0], "while the column still stands");
  }
  const size = unmakingSize(1.75, TILE);
  assert.ok(unmakingSize(1, TILE).clear >= 1.4 && size.clear < size.height * 0.5, "past a figure's chest, well under the column's height");
});

test("the brief form neither flashes nor shakes, nothing in it erupts, and its light only swells and ebbs", () => {
  const t = unmakingTimeline(1.75, true);
  let jump = 0, before = unmakingState(t, 0, 1.75), brightest = 0;
  for (let s = 0; s <= t.duration; s += 1 / 120) {
    const now = unmakingState(t, s, 1.75);
    assert.equal(now.shake, 0); assert.equal(now.flash, 0); assert.equal(now.inhale, 0);
    jump = Math.max(jump, Math.abs(now.light - before.light), Math.abs(now.reach - before.reach) * 0.5);
    brightest = Math.max(brightest, now.light); before = now;
  }
  assert.ok(jump < 0.05, `nothing rushes (${jump.toFixed(3)})`);
  assert.ok(brightest < 1.4);
});

test("a Bishop's rune fits the victim's square and a Queen's spills over it; the column holds a figure and stands twice its height", () => {
  const bishop = unmakingSize(1, TILE), queen = unmakingSize(1.75, TILE);
  assert.ok(bishop.rune <= 0.51 * TILE && bishop.rune > 0.4 * TILE);
  assert.ok(queen.rune > 0.6 * TILE && queen.rune < 0.75 * TILE);
  assert.ok(bishop.column > 0.28 && bishop.column < bishop.rune * GLYPH_RING, "the glyphs lie outside the column's foot");
  assert.ok(queen.column > bishop.column && queen.height > bishop.height && bishop.height > 3 && queen.height < 5);
  assert.ok(bishop.cord > bishop.column && bishop.shock > 2 * bishop.rune);
  assert.ok(1 < QUEEN_POWER && 1.75 >= QUEEN_POWER);
});

test("a higher tier has more of everything, a Queen's has more again, and no more glyphs lift than the rune has cells", () => {
  let before = { light: 0, matter: 0, grains: 0 };
  for (const quality of tiers) {
    const cast = make({ quality }), loose = unmakingParticles(cast);
    assert.ok(loose.light.length > before.light && loose.matter.length > before.matter && cast.counts.grains > before.grains, quality);
    const budget = UNMAKING_BUDGET[quality];
    assert.ok(loose.light.length <= budget.sparks * 1.25 + 8, `${quality} light (${loose.light.length})`);
    assert.ok(loose.matter.length <= budget.dust * 1.4 + budget.ash + 3, `${quality} matter (${loose.matter.length})`);
    before = { light: loose.light.length, matter: loose.matter.length, grains: cast.counts.grains };
  }
  const queen = make({ power: 1.75 }), bishop = make();
  assert.ok(queen.counts.cords === bishop.counts.cords + 2 && queen.counts.grains > bishop.counts.grains * 1.2);
  assert.ok(unmakingParticles(queen).light.length > unmakingParticles(bishop).light.length * 1.2);
  for (const quality of tiers) assert.ok(unmakingCounts(quality, 1.75).glyphs <= RUNE_CELLS);
});

test("the glyphs lift in no readable order, spread round the ring, within the first breath of the column", () => {
  for (const count of [0, 7, 10, 14, 20]) {
    const peels = glyphPeels(5, count), lifted = peels.filter((peel) => peel >= 0);
    assert.equal(peels.length, RUNE_CELLS); assert.equal(lifted.length, count);
    for (const peel of lifted) assert.ok(peel >= 0.04 && peel <= 0.8);
    if (count >= 10) {
      const cells = peels.flatMap((peel, cell) => (peel >= 0 ? [cell] : []));
      for (let i = 1; i < cells.length; i += 1) assert.ok(cells[i] - cells[i - 1] <= 2, "spread round the ring, not bunched");
      const inOrder = lifted.every((peel, i) => i === 0 || peel >= lifted[i - 1]);
      assert.ok(!inOrder, "not round the ring in turn");
    }
  }
  assert.deepEqual(glyphPeels(5, 14), glyphPeels(5, 14)); assert.notDeepEqual(glyphPeels(5, 14), glyphPeels(6, 14));
});

test("a lifted glyph leaves its cell, is drawn in to the column, climbs it, and is unwritten before the crown", () => {
  const size = unmakingSize(1, TILE), start = 1.3, first = glyphFlight(size, start, 0), last = glyphFlight(size, start, GLYPH_CLIMB);
  assert.ok(Math.abs(first.radius - size.rune * GLYPH_RING) < 1e-9 && first.angle === start && first.height < 0.03 && first.ink === 1);
  assert.ok(Math.abs(last.radius - size.column * 1.08) < 1e-9 && last.height < size.height * 0.85 && last.height > size.height * 0.7 && last.ink === 0 && last.scale < 0.55);
  let height = -1;
  for (let age = 0; age <= GLYPH_CLIMB; age += 0.01) { const now = glyphFlight(size, start, age); assert.ok(now.height >= height - 1e-9 && now.ink >= 0 && now.ink <= 1); height = now.height; }
  assert.ok(glyphFlight(size, start, GLYPH_CLIMB * 0.3).ink > 0.9, "it is still written as it is pulled in");
});

test("the grains loop on clocks of their own, and the cords are drawn up just behind the head", () => {
  for (const [s, rate, phase] of [[0, 0.5, 0.3], [1.7, 0.4, 0.9], [12.3, 0.72, 0]] as const) { const loop = grainLoop(s, rate, phase); assert.ok(loop >= 0 && loop < 1); }
  assert.ok(Math.abs(grainLoop(0, 0.5, 0.3) - 0.3) < 1e-9 && Math.abs(grainLoop(2, 0.5, 0.3) - 0.3) < 1e-9, "a loop comes round again");
  assert.equal(cordHead(0.6, -1), 0); assert.ok(cordHead(1, 0.05) < 1 && cordHead(1, 0.05) > 0.2); assert.equal(cordHead(1, 0.3), 1); assert.ok(cordHead(0.4, 0.3) === 0.4, "never above the column's own head");
});

test("the pen starts on the side of the rune that faces the caster", () => {
  const start = penStart({ stone, hand }), want = { x: hand.x - stone.x, z: hand.z - stone.z }, far = Math.hypot(want.x, want.z);
  assert.ok(Math.abs(Math.cos(start) - want.x / far) < 1e-9 && Math.abs(Math.sin(start) - want.z / far) < 1e-9);
});

test("the dice are the cast's, nothing loose outlives the spell, and what is drawn in dies as the column comes", () => {
  assert.deepEqual(unmakingParticles(make({ seed: 3 })), unmakingParticles(make({ seed: 3 })));
  assert.notDeepEqual(unmakingParticles(make({ seed: 3 })).light.slice(0, 30), unmakingParticles(make({ seed: 4 })).light.slice(0, 30));
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const cast = make({ brief, power }), loose = unmakingParticles(cast), { timeline } = cast;
    for (const particle of [...loose.light, ...loose.matter]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.y + particle.size + (particle.drag ?? 0)));
      if (brief) {
        if (loose.light.includes(particle)) assert.notEqual(particle.kind, PARTICLE_KIND.streak, "nothing in the brief form streaks");
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.7, "everything drifts");
      }
    }
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its light");
    assert.ok(loose.matter.every((particle) => particle.kind !== PARTICLE_KIND.halo && particle.kind !== PARTICLE_KIND.glint));
    if (!brief) {
      const drawnIn = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth < timeline.strikeAt);
      assert.ok(drawnIn.length > 10);
      for (const grit of drawnIn) {
        if (grit.anchored) continue;
        const inward = (grit.origin.x - stone.x) * grit.velocity.x + (grit.origin.z - stone.z) * grit.velocity.z;
        if (Math.hypot(grit.origin.x - stone.x, grit.origin.z - stone.z) > cast.size.rune * 1.02) assert.ok(inward < 0, "drawn in toward the middle");
      }
      const inhaled = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth >= timeline.inhale[0] - 0.15 && particle.birth < timeline.strikeAt);
      for (const grit of inhaled) assert.ok(Math.abs(grit.birth + grit.life - timeline.strikeAt) < 0.02, "and gone as the column comes");
      const thrown = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth >= timeline.strikeAt && particle.birth < timeline.strikeAt + 0.05);
      assert.ok(thrown.length > 15 && thrown.every((spark) => spark.velocity.y > 0), "the blow throws sparks up with the column");
      const ash = loose.matter.filter((particle) => particle.birth > timeline.strikeAt + 0.03 && particle.birth < timeline.close[0] && particle.kind !== PARTICLE_KIND.puff);
      assert.ok(ash.length >= cast.counts.ash * 0.9 && ash.every((flake) => flake.velocity.y > 0 && (flake.gravity ?? 0) < 0), "dark flakes climb while it stands");
    }
  }
});
