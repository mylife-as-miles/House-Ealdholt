import assert from "node:assert/strict";
import test from "node:test";
import { planSevers, stumpWoundPlan, type StumpLook } from "../../web/src/scene/death/sever/severPlan";
import { goreBudget, goreShow, type KillMoment, type TierSettings } from "../../web/src/scene/gore/goreTiers";
import { STUMP_WOUND, WOUND_STROKES, planWoundMask } from "../../web/src/scene/gore/woundMaskPlan";

// A forearm taken off at the elbow, the cut facing down and out along the upper arm.
const stump = { point: { x: 0.2, y: 0.45, z: -0.1 }, axis: { x: 0.6, y: -0.8, z: 0 }, radius: 0.04 };
const look = (extra: Partial<StumpLook> = {}): StumpLook => ({ intensity: "full", quality: "high", tier: 2, reducedMotion: false, seed: 11, ...extra });

test("a stump's wound is a burst's broad, ragged stroke round the cut, facing out of it, sized to it", () => {
  const wound = stumpWoundPlan(stump, look());
  assert.ok(wound && wound.mask, "a wound at tier 2 on Full");
  assert.equal(wound.kind, "burst");
  assert.deepEqual(wound.point, stump.point);
  assert.deepEqual(wound.normal, stump.axis);
  assert.equal(wound.bind, "skin");
  assert.ok(Math.abs(wound.size - stump.radius * STUMP_WOUND.size) < 1e-9);
  const [stroke] = wound.mask.strokes;
  assert.equal(stroke.shape, "broad");
  assert.equal(stroke.ragged, WOUND_STROKES.burst.ragged);
  // It tears past the cut's own edge and soaks further, about two of the cut's radii up the stump.
  assert.ok(stroke.open > stump.radius * 1.5 && stroke.open < stump.radius * 2.5, `open ${stroke.open}`);
  assert.ok(stroke.blood > stroke.open, "the blood soaks past the tear");
  // It reaches about two of the cut's radii up the stump, not the length of the limb to the bone's far end.
  assert.ok(wound.mask.back !== undefined && Math.abs(wound.mask.back - stump.radius * STUMP_WOUND.back) < 1e-9);
  assert.ok(wound.mask.back < stump.radius * 3);
  // Severing is tier 2 at Full: the wound opens to its interiors and tears the cloth round it.
  assert.equal(wound.mask.interiors, true);
  assert.equal(wound.mask.fabric, true);
  assert.ok(wound.mask.sink > 0);
});

test("an ordinary wound still reaches through the body to its anchor bone; only a stump's is held short", () => {
  const stab = planWoundMask({ kind: "stab", size: 0.05, power: 1, intensity: "full", quality: "high", tier: 2, mask: 128, interiors: true, fabric: true, bleed: 2, seed: 4 });
  assert.ok(stab);
  assert.equal(stab.back, undefined);
  assert.ok(stumpWoundPlan(stump, look())!.mask!.back! > 0);
});

test("the mask is the kill's tier's size: an execution's, or a fatality's", () => {
  for (const quality of ["low", "medium", "high", "ultra"] as const) {
    assert.equal(stumpWoundPlan(stump, look({ quality, tier: 2 }))!.mask!.size, goreBudget(2, quality).mask, `tier 2 ${quality}`);
    assert.equal(stumpWoundPlan(stump, look({ quality, tier: 3 }))!.mask!.size, goreBudget(3, quality).mask, `tier 3 ${quality}`);
  }
});

test("nothing is painted where no limb comes off: below Full, below tier 2, or a cut of no size", () => {
  assert.equal(stumpWoundPlan(stump, look({ intensity: "cinematic" })), null);
  assert.equal(stumpWoundPlan(stump, look({ intensity: "minimal" })), null);
  assert.equal(stumpWoundPlan(stump, look({ tier: 1 })), null);
  assert.equal(stumpWoundPlan(stump, look({ tier: 0 })), null);
  assert.equal(stumpWoundPlan({ ...stump, radius: 0 }, look()), null);
});

test("it bleeds down the body while the stump beats; under reduced motion its runs are simply there", () => {
  const wound = stumpWoundPlan(stump, look())!;
  assert.equal(wound.bleed, STUMP_WOUND.bleed);
  const runs = wound.mask!.runs;
  assert.ok(runs.length > 1, "several paints down the body");
  assert.ok(runs.every(run => run.at > 0 && run.at <= STUMP_WOUND.bleed), "each while it bleeds");
  for (let i = 1; i < runs.length; i += 1) assert.ok(runs[i].at >= runs[i - 1].at, "in time order");
  const still = stumpWoundPlan(stump, look({ reducedMotion: true }))!;
  assert.equal(still.bleed, 0);
  assert.ok(still.mask!.runs.length > 0 && still.mask!.runs.every(run => run.at === 0));
});

test("the same stump paints the same wound; another seed tears it another way", () => {
  assert.deepEqual(stumpWoundPlan(stump, look()), stumpWoundPlan(stump, look()));
  assert.notDeepEqual(stumpWoundPlan(stump, look({ seed: 11 }))!.mask!.strokes[0].seed, stumpWoundPlan(stump, look({ seed: 12 }))!.mask!.strokes[0].seed);
});

test("the sever rule carries the kill's tier, so the stump's mask is painted at its size", () => {
  const settings: TierSettings = { violence: "full", reducedMotion: false, captureCinematics: true };
  const execution: KillMoment = { attacker: "n", victim: "r", style: "melee", weapon: "axe" };
  const fatality: KillMoment = { attacker: "q", victim: "q", style: "summon" };
  assert.equal(planSevers({ show: goreShow(execution, settings, "high"), physics: true, cut: "cleave", by: "duel", seed: 3 }).tier, 2);
  assert.equal(planSevers({ show: goreShow(fatality, settings, "high"), physics: true, cut: "tear", by: "summon", seed: 3 }).tier, 3);
});
