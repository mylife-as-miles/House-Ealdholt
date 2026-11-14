import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APERTURE_TIME, FIRE_PORTAL_BUDGET, QUEEN_POWER, SCRIBE_TIME, firePortalCounts, firePortalGeometry, firePortalParticles, firePortalSize, firePortalState, firePortalTimeline,
  gutter, jetPoint, jetTangent, type FirePortalCast,
} from "../../web/src/scene/vfx/spells/portal/firePortalPlan";
import { landing, portalAperture, portalFacing, portalScribe, portalSparks, ringFrame, ringPoint, strokeHeat } from "../../web/src/scene/vfx/spells/portal/portalPlan";
import { PARTICLE_KIND, flightPoint, sequence } from "../../web/src/scene/vfx/spells/shared/particlePlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE }, hand = { x: -1.2 * TILE, y: 1.2, z: 1.4 * TILE }, chest = { x: stone.x, y: 0.95, z: stone.z };
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number } = {}): FirePortalCast => {
  const power = options.power ?? 1, size = firePortalSize(power, TILE), { placement, jet } = firePortalGeometry(stone, hand, chest, size);
  const timeline = firePortalTimeline(Math.hypot(placement.centre.x - hand.x, placement.centre.y - hand.y, placement.centre.z - hand.z), power, options.brief ?? false);
  return { stone, hand, placement, jet, timeline, size, counts: firePortalCounts(options.quality ?? "high", power), power, seed: options.seed ?? 31, tile: TILE };
};

test("a portal faces what it is turned to, its top is up and its foot is its lowest point, and its ring runs round anticlockwise seen from the front", () => {
  const door = portalFacing({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: 4 }, 0.8);
  assert.deepEqual([door.normal.x, door.normal.y, door.normal.z], [0, 0, 1]);
  assert.ok(Math.abs(door.up.y - 1) < 1e-9 && Math.abs(door.right.x - 1) < 1e-9, "upright, with its right on the right seen from in front");
  const foot = ringPoint(door, 0), right = ringPoint(door, 0.25), top = ringPoint(door, 0.5);
  assert.ok(Math.abs(foot.y - 0.7) < 1e-9 && Math.abs(top.y - 2.3) < 1e-9 && right.x > 0.79);
  for (const turn of [0, 0.13, 0.5, 0.77]) {
    const p = ringPoint(door, turn), { tangent, radial } = ringFrame(door, turn);
    assert.ok(Math.abs(Math.hypot(p.x, p.y - 1.5, p.z) - 0.8) < 1e-9);
    assert.ok(Math.abs(dot(tangent, radial)) < 1e-9 && Math.abs(dot(tangent, door.normal)) < 1e-9 && Math.abs(Math.hypot(tangent.x, tangent.y, tangent.z) - 1) < 1e-9);
  }
  const tilted = portalFacing({ x: 0, y: 2.3, z: 0 }, { x: 0, y: 0.9, z: 1.2 }, 0.5);
  assert.ok(Math.abs(dot(tilted.up, tilted.normal)) < 1e-9 && tilted.up.y > 0 && Math.abs(Math.hypot(tilted.right.x, tilted.right.y, tilted.right.z) - 1) < 1e-9);
  assert.ok(ringPoint(tilted, 0).y < ringPoint(tilted, 0.25).y && ringPoint(tilted, 0).y < ringPoint(tilted, 0.75).y, "the foot is still its lowest point");
  const flat = portalFacing({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }, 0.5);
  assert.ok(Number.isFinite(flat.up.x + flat.right.z) && Math.abs(dot(flat.up, flat.normal)) < 1e-9, "a portal facing straight down still has a frame");
});

test("the ring is struck: the spark eases off and home, the way through waits for it, and the stroke behind it is the hottest", () => {
  assert.equal(portalScribe(-1, 0.55), 0); assert.equal(portalScribe(0, 0.55), 0); assert.equal(portalScribe(0.55, 0.55), 1); assert.equal(portalScribe(2, 0.55), 1);
  assert.ok(Math.abs(portalScribe(0.275, 0.55) - 0.5) < 1e-9);
  assert.ok(portalScribe(0.05, 0.55) < 0.05 && 1 - portalScribe(0.5, 0.55) < 0.05, "slow at both ends");
  let before = 0;
  for (let s = 0; s <= 0.6; s += 0.005) { const now = portalScribe(s, 0.55); assert.ok(now >= before); before = now; }
  assert.equal(portalAperture(0.55 * 0.75, 0.55, 0.4), 0, "shut until the spark is three quarters round");
  assert.ok(portalAperture(0.55 * 0.76 + 0.1, 0.55, 0.4) > 0.5 && portalAperture(0.55 * 0.76 + 0.4, 0.55, 0.4) === 1);
  assert.equal(strokeHeat(-0.1, 1), 0); assert.equal(strokeHeat(0, 1), 1); assert.ok(strokeHeat(0.5, 1) < strokeHeat(0.1, 1));
});

test("a falling spark finds the board, and the ring's heavy sparks skip once on it and die", () => {
  const at = landing({ x: 0, y: 2, z: 0 }, { x: 1, y: 0.5, z: 0 }, 6, 1, 0, 3);
  assert.ok(at > 0 && Math.abs(flightPoint({ x: 0, y: 2, z: 0 }, { x: 1, y: 0.5, z: 0 }, 6, 1, at).y) < 1e-4);
  assert.equal(landing({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 0.1, 3, 0, 0.5), -1, "a light spark does not reach it");
  const door = portalFacing({ x: 0, y: 2.2, z: 0 }, { x: 0, y: 1, z: 2 }, 0.55);
  const sparks = portalSparks(door, { struck: 1, scribeTime: 0.55, until: 2.5, running: 80, standing: 60, floor: 0 }, sequence(7));
  assert.ok(sparks.length >= 140 && sparks.every((spark) => spark.kind === PARTICLE_KIND.streak && spark.life > 0 && spark.birth >= 1 && spark.birth < 3.6));
  const born = sparks.filter((spark) => spark.origin.y > 0.1);
  assert.ok(born.every((spark) => Math.abs(Math.hypot(spark.origin.x, spark.origin.y - 2.2, spark.origin.z) - 0.55) < 1e-6), "every thrown spark leaves from the ring");
  const skips = sparks.filter((spark) => spark.origin.y < 0.05);
  assert.ok(skips.length > 5, "some reach the board and skip");
  for (const skip of skips) {
    assert.ok(skip.velocity.y > 0 && skip.life < 0.4);
    const parent = sparks.find((spark) => spark.origin.y > 0.1 && Math.abs(spark.birth + spark.life - skip.birth) < 1e-9);
    assert.ok(parent, "each skip is where a falling spark came down, at that moment");
    const end = flightPoint(parent!.origin, parent!.velocity, parent!.gravity ?? 0, parent!.drag ?? 0, parent!.life);
    assert.ok(Math.hypot(end.x - skip.origin.x, end.z - skip.origin.z) < 1e-6);
  }
  const running = sparks.filter((spark) => spark.birth < 1.55 && spark.origin.y > 0.1);
  for (const spark of running) {
    const p = spark.origin, head = ringPoint(door, portalScribe(spark.birth - 1, 0.55));
    assert.ok(Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z) < 0.35, "while it runs, they leave from just behind the spark");
  }
});

test("the spell runs in order: the gather, the flick, the struck ring, the way through, the stir, the breath, the shutting, the breaking up", () => {
  for (const distance of [1, 3, 6, 11]) for (const power of [1, 1.75]) {
    const t = firePortalTimeline(distance, power, false);
    assert.ok(t.flick[0] < t.gather[1] && t.flick[1] === t.scribe[0] && Math.abs(t.scribe[1] - t.scribe[0] - SCRIBE_TIME) < 2e-3);
    assert.ok(t.open[0] > t.scribe[0] + 0.7 * SCRIBE_TIME && t.open[0] < t.scribe[1] && Math.abs(t.open[1] - t.open[0] - APERTURE_TIME) < 1e-9, "the way through opens as the spark comes home");
    assert.ok(t.stir[0] > t.scribe[1] - 0.01 && t.stir[1] === t.breath[0] && t.strikeAt > t.breath[0] && t.strikeAt - t.breath[0] < 0.2);
    assert.ok(t.breath[1] - t.strikeAt >= 0.7, "it roars for most of a second");
    assert.ok(t.shut[0] > t.breath[1] && t.crumble[1] > t.shut[1] && t.duration > t.crumble[1] && t.duration < 4.6);
  }
  assert.ok(firePortalTimeline(11, 1, false).strikeAt > firePortalTimeline(1, 1, false).strikeAt, "a spark flicked further arrives later");
  assert.ok(firePortalTimeline(5, 1.75, false).breath[1] - firePortalTimeline(5, 1.75, false).strikeAt > firePortalTimeline(5, 1, false).breath[1] - firePortalTimeline(5, 1, false).strikeAt, "a Queen's breath is longer");
  const brief = firePortalTimeline(9, 1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 1.3 && brief.duration <= 3);
  assert.deepEqual(brief, firePortalTimeline(1, 1, true));
});

test("the portal hangs behind the victim, clear of the next square's head, and its breath leaves along its face and falls through the chest", () => {
  for (const power of [1, 1.75]) {
    const size = firePortalSize(power, TILE), { placement, jet } = firePortalGeometry(stone, hand, chest, size);
    const away = { x: stone.x - hand.x, z: stone.z - hand.z }, behind = (placement.centre.x - stone.x) * away.x + (placement.centre.z - stone.z) * away.z;
    assert.ok(behind > 0, "on the side away from the caster");
    let lowest = Infinity;
    for (let turn = 0; turn < 1; turn += 0.01) lowest = Math.min(lowest, ringPoint(placement, turn).y);
    assert.ok(lowest > 1.85, `its foot clears a figure's head (${lowest.toFixed(2)})`);
    const out = jetTangent(jet, 0);
    assert.ok(dot(out, placement.normal) > 0.999, "the breath leaves along the portal's face");
    assert.ok(out.y < 0 && Math.asin(-out.y) < 0.5, "tipped only a little below level, so it is seen from above as well as from the side");
    const through = jetPoint(jet, jet.chestAt);
    assert.ok(Math.hypot(through.x - chest.x, through.y - chest.y, through.z - chest.z) < 1e-6, "through the chest");
    assert.ok(Math.abs(jet.splash.y) < 1e-9);
    const front = (jet.splash.x - stone.x) * away.x + (jet.splash.z - stone.z) * away.z;
    assert.ok(front < 0 && Math.hypot(jet.splash.x - stone.x, jet.splash.z - stone.z) < 0.7 * TILE, "it comes down just in front of the victim");
    let last = jet.source.y;
    for (let u = 0.05; u <= 1; u += 0.05) { const p = jetPoint(jet, u); assert.ok(p.y <= last + 1e-9, "it only falls"); last = p.y; }
    assert.ok(jet.length > Math.hypot(jet.splash.x - jet.source.x, jet.splash.y - jet.source.y, jet.splash.z - jet.source.z) - 1e-9);
  }
  assert.ok(firePortalSize(1.75, TILE).radius > firePortalSize(1, TILE).radius && firePortalSize(1.75, TILE).spread > firePortalSize(1, TILE).spread);
  assert.ok(1 < QUEEN_POWER && 1.75 >= QUEEN_POWER);
});

test("the blow lands when the breath reaches the chest and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const { timeline: t, jet } = make({ brief }), first = firePortalState(t, jet, 0);
    for (const key of ["open", "head", "aperture", "stir", "blaze", "jetHead", "jet", "cool", "crumble", "burn", "scorch", "flash", "shake"] as const) assert.equal(first[key], 0, `${key} ${brief}`);
    assert.equal(first.struck, false); assert.equal(first.done, false);
    assert.equal(firePortalState(t, jet, t.strikeAt - 1e-6).struck, false);
    const blow = firePortalState(t, jet, t.strikeAt);
    assert.equal(blow.struck, true); assert.ok(Math.abs(blow.jetHead - jet.chestAt) < 1e-6, "the head is at the chest on the blow");
    assert.equal(firePortalState(t, jet, t.duration - 1e-6).done, false);
    const last = firePortalState(t, jet, t.duration);
    assert.equal(last.done, true);
    for (const key of ["open", "aperture", "stir", "blaze", "jet", "burn", "scorch", "shake", "light"] as const) assert.ok(last[key] < 1e-6, `${key} is over`);
    assert.equal(last.crumble, 1);
  }
});

test("every envelope stays in range; the breath runs out and lands, its tail follows it out, the way through shuts and the ring cools and breaks", () => {
  for (const power of [1, 1.75]) for (const brief of [false, true]) {
    const { timeline: t, jet } = make({ power, brief });
    for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
      const now = firePortalState(t, jet, s, power);
      for (const key of ["hand", "scribe", "scribe2", "head", "aperture", "stir", "blaze", "jetHead", "jetTail", "cool", "crumble", "burn", "scorch", "flash"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, `${key} ${now[key]} at ${s.toFixed(2)}`);
      assert.ok(now.open >= 0 && now.open < 1.7 && now.jet >= 0 && now.jet < 1.3 && now.shake >= 0 && now.shake <= 1 && now.light >= 0 && now.light < 6.5);
      assert.ok(now.flick === -1 || (now.flick >= 0 && now.flick < 1));
      assert.ok(now.jetTail <= now.jetHead + 1e-9, "the tail never passes the head");
    }
    assert.equal(firePortalState(t, jet, t.breath[1] - 0.01).jetTail, 0);
    assert.ok(firePortalState(t, jet, t.strikeAt + 0.3).jetHead === 1 && firePortalState(t, jet, t.strikeAt + 0.3).sinceSplash > 0, "it has landed");
    assert.ok(firePortalState(t, jet, t.shut[1] + 0.01).aperture < 1e-6, "shut");
    assert.ok(firePortalState(t, jet, t.crumble[0] - 0.05).crumble === 0 && firePortalState(t, jet, t.crumble[1]).crumble === 1);
    if (!brief) {
      assert.ok(firePortalState(t, jet, t.scribe[0] + 0.2).head > 0.5 && firePortalState(t, jet, t.scribe[1]).head === 0, "the running spark, and it is home");
      assert.ok(firePortalState(t, jet, t.stir[1] - 0.01).stir > 0.9 && firePortalState(t, jet, t.stir[0]).stir === 0, "something stirs before it comes");
      assert.ok(firePortalState(t, jet, t.strikeAt + 0.005).flash > 0.9 && firePortalState(t, jet, t.strikeAt + 0.005).shake > 0.3);
      assert.ok(firePortalState(t, jet, (t.scribe[0] + t.flick[0]) / 2).flick > 0.4, "the flicked spark is in the air before the ring is struck");
    }
  }
});

test("the breath gutters on two unrelated beats and never shimmers; the brief form neither flashes nor shakes", () => {
  let low = 1, high = 0;
  for (let s = 0; s < 3; s += 0.01) { const g = gutter(s); low = Math.min(low, g); high = Math.max(high, g); }
  assert.ok(low > 0.7 && low < 0.8 && high > 0.99, `it gutters between ${low.toFixed(2)} and ${high.toFixed(2)}`);
  const { timeline: t, jet } = make({ brief: true, power: 1.75 });
  let jump = 0, before = firePortalState(t, jet, 0, 1.75);
  for (let s = 0; s <= t.duration; s += 1 / 120) {
    const now = firePortalState(t, jet, s, 1.75);
    assert.equal(now.shake, 0); assert.equal(now.flash, 0); assert.equal(now.head, 0); assert.equal(now.flick, -1);
    jump = Math.max(jump, Math.abs(now.light - before.light), Math.abs(now.aperture - before.aperture)); before = now;
  }
  assert.ok(jump < 0.06, `nothing rushes (${jump.toFixed(3)})`);
});

test("a higher tier has more of everything, a Queen's has more again, and each keeps to its budget", () => {
  let before = { light: 0, matter: 0 };
  for (const quality of tiers) {
    const cast = make({ quality }), loose = firePortalParticles(cast), budget = FIRE_PORTAL_BUDGET[quality];
    assert.ok(loose.light.length > before.light && loose.matter.length > before.matter, quality);
    assert.ok(loose.light.length <= budget.sparks * 1.5 + budget.flames * 1.1 + budget.embers + 8, `${quality} light (${loose.light.length})`);
    assert.ok(loose.matter.length <= budget.smoke);
    before = { light: loose.light.length, matter: loose.matter.length };
  }
  assert.ok(firePortalCounts("high", 1.75).strands === firePortalCounts("high", 1).strands + 1);
  assert.ok(firePortalParticles(make({ power: 1.75 })).light.length > firePortalParticles(make()).light.length * 1.2);
});

test("the dice are the cast's, nothing loose outlives the spell, the flicked spark reaches the foot, and the flame burns along the breath", () => {
  assert.deepEqual(firePortalParticles(make({ seed: 3 })), firePortalParticles(make({ seed: 3 })));
  assert.notDeepEqual(firePortalParticles(make({ seed: 3 })).light.slice(0, 40), firePortalParticles(make({ seed: 4 })).light.slice(0, 40));
  for (const brief of [false, true]) for (const power of [1, 1.75]) {
    const cast = make({ brief, power }), loose = firePortalParticles(cast), { timeline, placement, jet } = cast;
    for (const particle of [...loose.light, ...loose.matter]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.y + particle.size));
      if (brief) {
        assert.ok(particle.kind !== PARTICLE_KIND.streak, "nothing in the brief form streaks");
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.9, "everything drifts");
      }
    }
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its light");
    assert.ok(loose.matter.every((particle) => particle.kind === PARTICLE_KIND.puff));
    const flames = loose.light.filter((particle) => particle.kind === PARTICLE_KIND.puff && particle.birth >= timeline.breath[0] && particle.birth <= timeline.breath[1]);
    assert.ok(flames.length >= cast.counts.flames * 0.9);
    for (const flame of flames) {
      let near = Infinity;
      for (let u = 0; u <= 1; u += 0.02) { const p = jetPoint(jet, u); near = Math.min(near, Math.hypot(flame.origin.x - p.x, Math.max(0, flame.origin.y - Math.max(p.y, 0.04)), flame.origin.z - p.z)); }
      assert.ok(near < cast.size.spread * 1.2, "born on the breath");
    }
    if (!brief) {
      const flick = loose.light.find((particle) => particle.kind === PARTICLE_KIND.streak && particle.birth === timeline.flick[0] && particle.size > 0.02)!;
      const end = flightPoint(flick.origin, flick.velocity, flick.gravity ?? 0, flick.drag ?? 0, flick.life), foot = ringPoint(placement, 0);
      assert.ok(Math.hypot(end.x - foot.x, end.y - foot.y, end.z - foot.z) < 1e-6 && Math.abs(flick.birth + flick.life - timeline.scribe[0]) < 1e-9, "it arrives at the foot as the ring is struck");
    }
  }
});
