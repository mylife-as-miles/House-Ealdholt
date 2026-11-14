import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEASH_SPEED, LIMBS, QUEEN_POWER, RATCHETS, SNAP_TIME, SNARE_BUDGET, leashLine, ratchet, ringOpen, snareCounts, snareLimbs, snareParticles, snareSize, snareState,
  snareTimeline, tendrilHead, tendrilRoot, type SnareCast,
} from "../../web/src/scene/vfx/spells/snare/snarePlan";
import { PARTICLE_KIND } from "../../web/src/scene/vfx/spells/shared/particlePlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.4 * TILE };
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number } = {}): SnareCast => {
  const power = options.power ?? 1, size = snareSize(power, TILE), counts = snareCounts(options.quality ?? "high", power), line = leashLine({ stone, hand, size, tile: TILE });
  return { stone, hand, limbs: snareLimbs(stone, hand, 0.95, counts.tendrils), timeline: snareTimeline(line.length, power, options.brief ?? false), size, counts, power, seed: options.seed ?? 21, tile: TILE };
};

test("the spell runs in order: the gather, the leash, the snap, the cage and the tendrils, the bind, the crush, the hold, the collapse", () => {
  for (const distance of [0.6, 2, 4.4, 9.5]) for (const power of [1, 1.75]) {
    const t = snareTimeline(distance, power, false);
    assert.equal(t.gather[0], 0); assert.equal(t.gather[1], t.leash[0]); assert.equal(t.leash[1], t.snap);
    assert.ok(t.leash[1] - t.leash[0] >= 0.12 - 1e-9 && t.leash[1] - t.leash[0] <= 0.38 + 1e-9, "the leash is seen to run, and is quick");
    assert.ok(t.climb[0] > t.snap && t.reach[0] > t.climb[0] && t.reach[1] <= t.bind[0] + 1e-9, "the cage climbs and the tendrils reach before it binds");
    assert.equal(t.bind[1], t.strikeAt);
    assert.ok(t.strikeAt - t.bind[0] >= 0.35, "the bind is long enough to be watched");
    assert.ok(t.collapse[0] - t.strikeAt >= 0.8 && t.collapse[1] - t.collapse[0] >= 0.4 && t.duration - t.collapse[1] >= 0.8 && t.duration < 4.6);
  }
  assert.ok(snareTimeline(9.5, 1, false).strikeAt > snareTimeline(2, 1, false).strikeAt, "a longer leash lands later");
  assert.ok(Math.abs(snareTimeline(4.4, 1, false).snap - (0.42 + 4.4 / LEASH_SPEED)) < 2e-3);
  assert.ok(snareTimeline(4, 1.75, false).strikeAt > snareTimeline(4, 1, false).strikeAt && snareTimeline(4, 1.75, false).duration > snareTimeline(4, 1, false).duration, "a Queen binds and holds longer");
  const brief = snareTimeline(9.5, 1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 1.3 && brief.duration <= 3.3);
  assert.deepEqual(brief, snareTimeline(1, 1, true), "the brief form is the same for every cast");
});

test("the crush lands at strikeAt and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const t = snareTimeline(4.4, 1, brief), first = snareState(t, 0);
    for (const key of ["leash", "open", "ring", "climb", "cage", "reach", "tendrils", "taut", "squeeze", "rim", "flash", "jerk", "scorch", "heat", "shake"] as const) assert.equal(first[key], 0, `${key} ${brief}`);
    assert.ok(first.hand < 1e-9 && first.light < 1e-9);
    assert.equal(first.struck, false); assert.equal(first.done, false); assert.equal(first.sinceStrike, -1);
    assert.equal(snareState(t, t.strikeAt - 1e-6).struck, false);
    assert.equal(snareState(t, t.strikeAt).struck, true);
    assert.equal(snareState(t, t.duration - 1e-6).done, false);
    const last = snareState(t, t.duration);
    assert.equal(last.done, true);
    for (const key of ["leash", "ring", "climb", "cage", "reach", "tendrils", "rim", "scorch", "heat", "shake", "light"] as const) assert.ok(last[key] < 1e-6, `${key} is over`);
  }
});

test("the ring slams open past its radius and pulls back onto it", () => {
  assert.equal(ringOpen(-0.1), 0); assert.equal(ringOpen(0), 0);
  let most = 0;
  for (let s = 0; s <= SNAP_TIME; s += 0.002) most = Math.max(most, ringOpen(s));
  assert.ok(most > 1.08 && most < 1.2, `it overshoots (${most.toFixed(3)})`);
  assert.ok(Math.abs(ringOpen(SNAP_TIME) - 1) < 1e-9 && ringOpen(1) === 1, "and settles on its line");
  assert.ok(ringOpen(SNAP_TIME * 0.25) > 0.5, "fast out");
});

test("the bind closes in three ratchets, each sooner than the last, and the crush shuts it", () => {
  for (let i = 1; i < RATCHETS.length - 1; i += 1) assert.ok(RATCHETS[i + 1] - RATCHETS[i] < RATCHETS[i] - RATCHETS[i - 1]);
  let before = 0;
  for (let share = 0; share <= 1; share += 0.005) { const now = ratchet(share); assert.ok(now >= before - 1e-12 && now <= 0.8); before = now; }
  for (const at of RATCHETS) {
    assert.ok(ratchet(at + 0.07) - ratchet(at - 0.03) > 0.2, "a jerk");
    assert.ok(Math.abs(ratchet(at + 0.1) - ratchet(at + 0.07)) < 0.01, "and a hold");
  }
  const t = snareTimeline(4.4, 1, false), held = snareState(t, t.strikeAt - 0.01), crush = snareState(t, t.strikeAt + 0.005);
  assert.ok(held.squeeze > 0.7 && held.squeeze < 0.8 && crush.squeeze > 0.99, "it shuts at the crush");
  assert.ok(crush.flash > 0.9 && crush.tendrils > 1.8 && crush.light > 4 && crush.shake > 0.35);
  const span = t.bind[1] - t.bind[0];
  for (const at of RATCHETS) assert.ok(snareState(t, t.bind[0] + at * span + 0.01).jerk > 0.8, "each ratchet jerks");
  assert.ok(snareState(t, t.bind[0] + 0.3 * span).taut > snareState(t, t.bind[0] + 0.01).taut, "the tendrils go taut as it binds");
  assert.ok(snareState(t, t.strikeAt + 0.8).taut < 0.6 && snareState(t, t.strikeAt + 0.8).squeeze < 0.75, "and slacken once the body is taken");
});

test("every envelope stays in range, and the leash runs to the ring and is dropped as it snaps", () => {
  for (const power of [1, 1.75]) for (const brief of [false, true]) {
    const t = snareTimeline(4.4, power, brief);
    for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
      const now = snareState(t, s, power);
      for (const key of ["hand", "front", "leash", "climb", "reach", "taut", "squeeze", "rim", "flash", "jerk", "collapse", "scorch", "heat"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, `${key} ${now[key]} at ${s.toFixed(2)}`);
      assert.ok(now.open >= 0 && now.open < 1.2 && now.ring >= 0 && now.ring < 2.6 && now.cage >= 0 && now.cage < 2.2 && now.tendrils >= 0 && now.tendrils < 2.7);
      assert.ok(now.shake >= 0 && now.shake <= 1 && now.light >= 0 && now.light < 6.5 && [0, 1, 2].includes(now.lightAt));
    }
    if (!brief) {
      assert.equal(snareState(t, t.leash[0]).front, 0); assert.ok(Math.abs(snareState(t, t.snap - 1e-6).front - 1) < 1e-3);
      assert.ok(snareState(t, t.snap - 0.01).leash > 0.9 && snareState(t, t.snap + 0.12).leash === 0, "dropped as the ring snaps");
      assert.ok(snareState(t, t.collapse[1]).climb < 0.05 && snareState(t, t.collapse[1]).reach < 0.05, "the cage and the tendrils are drawn back in");
    }
  }
});

test("the brief form neither flashes, jerks nor shakes, does not strobe, and its light only swells and ebbs", () => {
  const t = snareTimeline(4.4, 1.75, true);
  let jump = 0, before = snareState(t, 0, 1.75);
  for (let s = 0; s <= t.duration; s += 1 / 120) {
    const now = snareState(t, s, 1.75);
    assert.equal(now.shake, 0); assert.equal(now.flash, 0); assert.equal(now.jerk, 0); assert.equal(now.restrike, 0); assert.equal(now.leash, 0);
    jump = Math.max(jump, Math.abs(now.light - before.light), Math.abs(now.squeeze - before.squeeze)); before = now;
  }
  assert.ok(jump < 0.05, `nothing rushes (${jump.toFixed(3)})`);
});

test("a Bishop's ring stands just outside the victim's square and a Queen's reaches its neighbours; the cage holds a figure", () => {
  const bishop = snareSize(1, TILE), queen = snareSize(1.75, TILE);
  assert.ok(bishop.ring > 0.51 * TILE && bishop.ring < 0.62 * TILE);
  assert.ok(queen.ring > 0.7 * TILE && queen.ring < 0.85 * TILE);
  assert.ok(bishop.throat > 0.25 && bishop.throat < bishop.ring && bishop.crown > bishop.throat && bishop.height > 2.2);
  assert.ok(queen.height > bishop.height && queen.filament > bishop.filament && bishop.coil > 0.06);
  assert.ok(1 < QUEEN_POWER && 1.75 >= QUEEN_POWER);
});

test("the tendrils bind ankles, wrists and throat, and a Queen's knees and waist too, on a figure facing the caster", () => {
  const limbs = snareLimbs(stone, hand, 0.95, 8);
  assert.equal(limbs.length, LIMBS.length); assert.equal(snareLimbs(stone, hand, 0.95, 5).length, 5);
  const [ankleL, ankleR, wristL, wristR, throat, kneeL, , waist] = limbs;
  assert.ok(ankleL.y < 0.15 && throat.y > 1.2 && kneeL.y > ankleL.y && waist.y > kneeL.y && throat.y > wristL.y);
  const across = (p: { x: number; z: number }) => Math.hypot(p.x - stone.x, p.z - stone.z);
  assert.ok(across(wristL) > across(ankleL) && Math.abs(across(wristL) - across(wristR)) < 1e-9, "the wrists hang wider than the ankles, either side");
  const toward = { x: hand.x - stone.x, z: hand.z - stone.z }, mid = { x: (wristL.x + wristR.x) / 2 - stone.x, z: (wristL.z + wristR.z) / 2 - stone.z };
  assert.ok(mid.x * toward.x + mid.z * toward.z > 0, "the hands hang a little forward, toward the caster");
  assert.ok(Math.abs((ankleL.x - stone.x) + (ankleR.x - stone.x) - 2 * ((ankleL.x + ankleR.x) / 2 - stone.x)) < 1e-9);
  const tall = snareLimbs(stone, hand, 1.4, 5);
  assert.ok(tall[4].y > throat.y * 1.3, "a taller figure is bound higher");
  for (let i = 0; i < 5; i += 1) {
    const limb = limbs[i], bearing = tendrilRoot(stone, limb, 0.5), angle = Math.atan2(limb.z - stone.z, limb.x - stone.x);
    if (across(limb) > 0.05) assert.ok(Math.abs(Math.atan2(Math.sin(bearing - angle), Math.cos(bearing - angle))) < 0.4, "a tendril leaves the ring under its limb");
  }
  assert.equal(tendrilHead(0, 0, 5), 0); assert.equal(tendrilHead(1, 4, 5), 1);
  assert.ok(tendrilHead(0.4, 0, 5) > tendrilHead(0.4, 4, 5), "the ankles first");
});

test("the leash runs from half a square in front of the caster to the near edge of the ring", () => {
  const size = snareSize(1, TILE), line = leashLine({ stone, hand, size, tile: TILE }), reach = Math.hypot(stone.x - hand.x, stone.z - hand.z);
  assert.ok(Math.abs(Math.hypot(line.from.x - hand.x, line.from.z - hand.z) - 0.5 * TILE) < 1e-9 && line.from.y === 0);
  assert.ok(Math.abs(Math.hypot(line.to.x - stone.x, line.to.z - stone.z) - size.ring) < 1e-9);
  assert.ok(Math.abs(line.length - (reach - 0.5 * TILE - size.ring)) < 1e-9);
  const close = leashLine({ stone, hand: { x: stone.x, y: 1.2, z: stone.z + TILE }, size, tile: TILE });
  assert.ok(close.length >= 0 && close.length < 0.2, "a cast at the next square has almost no leash on the stone");
});

test("a higher tier has more of everything, a Queen binds more limbs, and each keeps to its budget", () => {
  let before = { light: 0, matter: 0 };
  for (const quality of tiers) {
    const cast = make({ quality }), loose = snareParticles(cast), budget = SNARE_BUDGET[quality];
    assert.ok(loose.light.length > before.light && loose.matter.length > before.matter, quality);
    assert.ok(loose.light.length <= budget.sparks * 1.25 + 4 + 3 * budget.tendrils * Math.max(1, Math.round(budget.sparks * 0.012)), `${quality} light (${loose.light.length})`);
    assert.ok(loose.matter.length <= budget.smoke);
    before = { light: loose.light.length, matter: loose.matter.length };
  }
  const queen = snareCounts("high", 1.75), bishop = snareCounts("high", 1);
  assert.ok(queen.tendrils === 8 && bishop.tendrils === 5 && queen.column > bishop.column && queen.rim > bishop.rim);
  assert.ok(snareParticles(make({ power: 1.75 })).light.length > snareParticles(make()).light.length * 1.2);
});

test("the dice are the cast's, nothing loose outlives the spell, and the crush bursts off the coils", () => {
  assert.deepEqual(snareParticles(make({ seed: 3 })), snareParticles(make({ seed: 3 })));
  assert.notDeepEqual(snareParticles(make({ seed: 3 })).light.slice(0, 30), snareParticles(make({ seed: 4 })).light.slice(0, 30));
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const cast = make({ brief, power }), loose = snareParticles(cast), { timeline, limbs } = cast;
    for (const particle of [...loose.light, ...loose.matter]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.y + particle.size));
      if (brief) {
        assert.ok(loose.matter.includes(particle) || particle.kind !== PARTICLE_KIND.streak, "nothing in the brief form streaks");
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.7, "everything drifts");
      }
    }
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its light");
    assert.ok(loose.matter.every((particle) => particle.kind === PARTICLE_KIND.puff));
    if (!brief) {
      const crush = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth >= timeline.strikeAt && particle.birth < timeline.strikeAt + 0.04);
      assert.ok(crush.length > 20);
      for (const spark of crush) assert.ok(limbs.some((limb) => limb.x === spark.origin.x && limb.y === spark.origin.y && limb.z === spark.origin.z), "off the coils");
      const track = loose.light.filter((particle) => particle.birth >= timeline.leash[0] && particle.birth < timeline.snap && !particle.anchored);
      const line = leashLine(cast), along = (p: { x: number; z: number }) => (p.x - line.from.x) * (line.to.x - line.from.x) + (p.z - line.from.z) * (line.to.z - line.from.z);
      assert.ok(track.length > 6);
      const sorted = [...track].sort((a, b) => a.birth - b.birth);
      for (let i = 1; i < sorted.length; i += 1) assert.ok(along(sorted[i].origin) >= along(sorted[i - 1].origin) - 0.08, "laid down in order as the tip runs");
    }
  }
});
