import assert from "node:assert/strict";
import test from "node:test";
import { goreBudget, goreShow, goreTier, naturalTier, type KillMoment, type TierSettings } from "../../web/src/scene/gore/goreTiers";

const at = (violence: TierSettings["violence"], extra: Partial<TierSettings> = {}): TierSettings =>
  ({ violence, reducedMotion: false, captureCinematics: true, ...extra });
const kill = (extra: Partial<KillMoment> = {}): KillMoment => ({ attacker: "p", victim: "p", style: "melee", ...extra });
const QUALITIES = ["low", "medium", "high", "ultra"] as const;

test("the moment sets the tier: ordinary fights 1, executions 2, fatalities 3", () => {
  // Ordinary combat: a Pawn's duel, a musket ball, a Bishop's spell on a Pawn.
  assert.equal(naturalTier(kill()), 1);
  assert.equal(naturalTier(kill({ attacker: "r", style: "gun" })), 1);
  assert.equal(naturalTier(kill({ attacker: "b", style: "spell" })), 1);
  assert.equal(naturalTier(kill({ attacker: "n", weapon: "sword" })), 1);
  // Executions: a major piece falls, a heavy weapon kills, a Queen casts or summons.
  for (const victim of ["n", "b", "r", "q"] as const) assert.equal(naturalTier(kill({ victim })), 2, victim);
  assert.equal(naturalTier(kill({ weapon: "mace" })), 2);
  assert.equal(naturalTier(kill({ weapon: "axe" })), 2);
  assert.equal(naturalTier(kill({ attacker: "q", style: "spell" })), 2);
  assert.equal(naturalTier(kill({ attacker: "q", victim: "n", style: "summon" })), 2);
  // Fatalities: the capture that mates, a Queen taking a Queen, a side's last piece.
  assert.equal(naturalTier(kill({ mate: true })), 3);
  assert.equal(naturalTier(kill({ last: true })), 3);
  assert.equal(naturalTier(kill({ attacker: "q", victim: "q", style: "summon" })), 3);
  // A King is never taken, and shows nothing if asked.
  assert.equal(naturalTier(kill({ victim: "k", mate: true })), 0);
});

test("the settings cap it: no gore at Minimal or off the real board, tier 1 without staged fights, tier 2 at Cinematic", () => {
  const fatal = kill({ mate: true });
  assert.equal(goreTier(fatal, at("full")), 3);
  assert.equal(goreTier(fatal, at("cinematic")), 2);
  assert.equal(goreTier(fatal, at("minimal")), 0);
  assert.equal(goreTier(fatal, at("full", { reducedMotion: true })), 1);
  assert.equal(goreTier(fatal, at("full", { captureCinematics: false })), 1);
  assert.equal(goreTier(fatal, at("full", { tactical: true })), 0);
  assert.equal(goreTier(fatal, at("full", { menuBoard: true })), 0);
  // Caps never raise a tier.
  assert.equal(goreTier(kill(), at("cinematic")), 1);
  assert.equal(goreTier(kill({ victim: "r" }), at("full", { reducedMotion: true })), 1);
});

test("what each tier shows: severing and opened wounds only at tier 2 or above at Full, fatalities only at tier 3", () => {
  // A Pawn's duel at Full: cuts, splashes, torn cloth and stains; nothing comes away.
  const duel = goreShow(kill({ weapon: "sword" }), at("full"), "high");
  assert.deepEqual([duel.tier, duel.cuts, duel.splash, duel.fabric, duel.stains], [1, true, true, true, true]);
  assert.deepEqual([duel.sever, duel.interiors, duel.trails, duel.linger, duel.fatality, duel.fluid], [false, false, false, false, false, false]);
  // A Rook's fall at Full: limbs may come away and wounds open; trails and what lingers.
  const execution = goreShow(kill({ victim: "r", weapon: "axe" }), at("full"), "high");
  assert.deepEqual([execution.tier, execution.sever, execution.interiors, execution.trails, execution.linger, execution.fatality], [2, true, true, true, true, false]);
  // The same at Cinematic: trails and lingering, but nothing severed or opened.
  const softer = goreShow(kill({ victim: "r", weapon: "axe" }), at("cinematic"), "high");
  assert.deepEqual([softer.tier, softer.sever, softer.interiors, softer.trails, softer.linger], [2, false, false, true, true]);
  // A fatality at Full: everything, fluid where the preset affords it.
  const fatal = goreShow(kill({ attacker: "q", victim: "q", style: "summon" }), at("full"), "high");
  assert.deepEqual([fatal.tier, fatal.fatality, fatal.fluid, fatal.sever], [3, true, true, true]);
  assert.equal(goreShow(kill({ mate: true }), at("full"), "low").fluid, false, "Low plays it without its fluid");
  // Minimal: nothing at all.
  const none = goreShow(kill({ mate: true }), at("minimal"), "ultra");
  assert.ok(!none.cuts && !none.splash && !none.sever && !none.fatality && none.budget.mask === 0);
});

test("budgets grow with the tier and the preset, and masks are powers of two", () => {
  for (const quality of QUALITIES) {
    for (const tier of [1, 2, 3] as const) {
      const b = goreBudget(tier, quality);
      assert.ok(b.mask >= 32 && (b.mask & (b.mask - 1)) === 0, `${tier} ${quality}: mask ${b.mask}`);
      if (tier < 3) assert.equal(b.fluid, 0, "fluid only in a fatality");
      if (tier === 1) assert.ok(b.severs === 0 && b.trails === 0, "ordinary combat severs nothing and trails nothing");
      if (tier > 1) {
        const lower = goreBudget((tier - 1) as 1 | 2, quality);
        for (const key of ["mask", "severs", "trails", "fluid"] as const) assert.ok(b[key] >= lower[key], `${tier} ${quality} ${key}`);
      }
    }
  }
  for (const tier of [1, 2, 3] as const) for (let i = 1; i < QUALITIES.length; i++) {
    const b = goreBudget(tier, QUALITIES[i]), lower = goreBudget(tier, QUALITIES[i - 1]);
    for (const key of ["mask", "severs", "trails", "fluid"] as const) assert.ok(b[key] >= lower[key], `${tier} ${QUALITIES[i]} ${key}`);
  }
  assert.deepEqual(goreBudget(0, "ultra"), { mask: 0, severs: 0, trails: 0, fluid: 0 });
  assert.equal(goreBudget(3, "low").fluid, 0);
});
