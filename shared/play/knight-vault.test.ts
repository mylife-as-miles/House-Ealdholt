import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALM_TIMING, VAULT_BUDGET, VAULT_CHANCE, VAULT_LOOK, VAULT_SHOT, VAULT_TIMING,
  earlierKnightCaptures, fitShot, frameShare, planKnightVault, sightBlocked, strikeTiming, vaultChosen, vaultCuesBetween,
  vaultEligible, vaultFlakePeak, vaultLanding, vaultLift, vaultMode, vaultPose, vaultShotPoints, vaultShots, vaultStreakPeak,
  type VaultArmy, type VaultContext, type VaultHistoryMove, type VaultStage,
} from "../../web/src/scene/finisher/knightVaultPlan";
import { FLOURISH_BUDGET, FLOURISH_LOOK } from "../../web/src/scene/vfx/flourish/flourishPlan";

const presets = ["low", "medium", "high", "ultra"] as const;
const armies: VaultArmy[] = ["ivory", "sun", "empire", "kwind"];
const live = (extra: Partial<VaultContext> = {}): VaultContext => ({
  attacker: "n", victim: "p", side: "w", style: "melee", directed: false, summon: false, menuBoard: false, tactical: false,
  cinematics: true, reducedMotion: false, quality: "medium", history: [], roll: 0.9, ...extra,
});
const knightTook = (color: "w" | "b", captured: VaultHistoryMove["captured"]): VaultHistoryMove => ({ color, kind: "n", capture: true, captured });

// ------------------------------------------------------------------------------------------------ the rule

test("a side's first Knight capture of the match always plays the vault, whatever the dice", () => {
  for (const roll of [0, 0.5, 0.999]) {
    const choice = vaultChosen(live({ roll }));
    assert.equal(choice.chosen, true);
    assert.equal(choice.reason, "first-knight-capture");
  }
  // The other side's Knight kills do not count against this side's first.
  assert.equal(vaultChosen(live({ history: [knightTook("b", "p"), knightTook("b", "b")], roll: 0.99 })).chosen, true);
  // Nor does a Knight's duel with a Knight or a Rook, which the Director fights.
  assert.equal(vaultChosen(live({ history: [knightTook("w", "n"), knightTook("w", "r")], roll: 0.99 })).chosen, true);
  assert.equal(earlierKnightCaptures([knightTook("w", "p"), knightTook("w", "n"), knightTook("b", "q"), { color: "w", kind: "b", capture: true, captured: "p" }], "w"), 1);
});

test("after the first, about a third of a side's Knight captures play it, as the show dice fall", () => {
  const after = [knightTook("w", "p")];
  assert.equal(vaultChosen(live({ history: after, roll: 0 })).chosen, true);
  assert.equal(vaultChosen(live({ history: after, roll: VAULT_CHANCE - 1e-6 })).reason, "show-dice");
  assert.equal(vaultChosen(live({ history: after, roll: VAULT_CHANCE })).chosen, false);
  assert.equal(vaultChosen(live({ history: after, roll: 0.99 })).reason, "passed-over");
  // Over an even spread of rolls, a third are taken.
  let taken = 0;
  for (let i = 0; i < 300; i += 1) if (vaultChosen(live({ history: after, roll: (i + 0.5) / 300 })).chosen) taken += 1;
  assert.equal(taken, 100);
  // A roll that is not a number never plays it (no dice: no chosen capture past the first).
  assert.equal(vaultChosen(live({ history: after, roll: Number.NaN })).chosen, false);
  // The same game gives the same answer.
  assert.deepEqual(vaultChosen(live({ history: after, roll: 0.2 })), vaultChosen(live({ history: after, roll: 0.2 })));
});

test("it never replaces a summon, a gun, a spell or a Director's duel, and never plays off a live, cinematic board", () => {
  const refused: [Partial<VaultContext>, string][] = [
    [{ menuBoard: true }, "menu-board"], [{ tactical: true }, "tactical"], [{ cinematics: false }, "cinematics-off"],
    [{ attacker: "q" }, "not-a-knight"], [{ attacker: "r" }, "not-a-knight"], [{ attacker: "p" }, "not-a-knight"],
    [{ style: "gun" }, "not-melee"], [{ style: "spell" }, "not-melee"], [{ summon: true }, "not-melee"],
    [{ directed: true }, "directed-duel"], [{ victim: "n" }, "directed-duel"], [{ victim: "r" }, "directed-duel"], [{ victim: "k" }, "king"],
  ];
  for (const [extra, reason] of refused) {
    const gate = vaultEligible(live({ ...extra, roll: 0 }));
    assert.equal(gate.eligible, false, reason);
    assert.equal(gate.reason, reason);
    assert.equal(vaultMode(live({ ...extra, roll: 0 })).mode, "none", reason);
    assert.equal(planKnightVault(live({ ...extra, roll: 0 })).total, 0, reason);
  }
  for (const victim of ["p", "b", "q"] as const) assert.equal(vaultEligible(live({ victim })).eligible, true, victim);
});

test("reduced motion gets the calm form on the same captures: no camera, no flash, no shake, under a second", () => {
  const plan = planKnightVault(live({ reducedMotion: true }));
  assert.equal(plan.mode, "calm");
  assert.equal(plan.camera, false);
  assert.deepEqual(plan.cameraBeats, []);
  assert.equal(plan.fx.flash, false); assert.equal(plan.fx.shake, false); assert.equal(plan.fx.light, false);
  assert.equal(plan.fx.wings, false); assert.equal(plan.fx.streaks, 0); assert.equal(plan.fx.cross, false); assert.equal(plan.fx.crescent, false);
  assert.equal(plan.fx.ring, true); assert.equal(plan.fx.calm, true);
  assert.ok(plan.total > 0 && plan.total < 1, `${plan.total}s`);
  assert.equal(plan.total, CALM_TIMING.total);
  // The rule is the same with motion reduced: a passed-over capture stays passed over.
  assert.equal(planKnightVault(live({ reducedMotion: true, history: [knightTook("w", "p")], roll: 0.9 })).mode, "none");
});

// ------------------------------------------------------------------------------------------------ the timeline

test("the full form runs its beats in the reference's order and at its times, and lasts as long as the reference", () => {
  const plan = planKnightVault(live());
  assert.equal(plan.mode, "full");
  assert.ok(plan.spin.from === 0 && plan.spin.to > plan.spin.from);
  assert.ok(plan.staggerAt > plan.spin.from && plan.staggerAt < plan.spin.to, "the piece reels inside the whirl");
  assert.ok(plan.crouch.from >= plan.spin.to && plan.crouch.to === plan.vault.from, "the spring loads, then it vaults");
  const air = plan.vault.to - plan.vault.from;
  assert.ok(air >= 0.6 && air <= 1.1, `${air}s in the air`);
  assert.ok(Math.abs(plan.apexAt - (plan.vault.from + plan.vault.to) / 2) < 1e-9, "the top is halfway");
  assert.ok(plan.crossAt > plan.vault.from && plan.crossAt < plan.apexAt, "the X crosses as it rises");
  assert.equal(plan.landAt, plan.vault.to);
  assert.ok(plan.strikeAt > plan.landAt && plan.strikeAt - plan.landAt < 0.5, "the blade goes in just after it lands");
  assert.ok(plan.pose.from > plan.strikeAt + 0.3, "the strike and its hit-stop are held before the pose");
  assert.ok(plan.ring.from === plan.pose.to && plan.ring.to > plan.ring.from);
  assert.ok(plan.swirl.from === plan.ring.from && plan.expand.from > plan.swirl.from && plan.expand.to <= plan.ring.to, "the flakes swirl, then the ring runs out");
  assert.ok(plan.release < plan.total && plan.release > plan.expand.from);
  // The creator's reference clip runs 6.23 s from the lead-in to its last frame; its beats, from the whirl, at
  // (seconds): cut low 0.5, X 0.84, blade in ~1.7, pose ~2.17, wide again ~2.5, the ring out ~2.84 to ~3.67, end 4.9.
  const seen = VAULT_TIMING.leadIn + plan.total;
  assert.ok(Math.abs(seen - 6.23) <= 0.25, `seen for ${seen}s`);
  const near = (at: number, reference: number, slack: number, what: string) => assert.ok(Math.abs(at - reference) <= slack, `${what} at ${at}s, the reference's at ${reference}s`);
  near(plan.crouch.from, 0.5, 0.1, "the cut low");
  near(plan.crossAt, 0.84, 0.1, "the X");
  near(plan.strikeAt, 1.75, 0.2, "the blade going in");
  near(plan.pose.from, 2.17, 0.2, "the pose");
  near(plan.ring.from, 2.5, 0.2, "the wide shot");
  near(plan.expand.from, 2.84, 0.2, "the ring");
  // Its sounds come in order, each at its beat.
  const cues = plan.cues.map(entry => entry.cue);
  assert.deepEqual(cues, ["whoosh.light", "stagger", "effort.heavy", "whoosh.heavy", "blade-light", "strike", "ring"]);
  assert.deepEqual(vaultCuesBetween(plan, -Infinity, plan.spin.to - 0.01), ["whoosh.light", "stagger"]);
  assert.deepEqual(vaultCuesBetween(plan, plan.landAt, plan.strikeAt), ["strike"]);
});

test("the camera: wide for the whirl, a straight cut low for the vault that moves with it, a cut on the way down, the pose, and wide again", () => {
  const plan = planKnightVault(live());
  const beats = plan.cameraBeats;
  assert.deepEqual(beats.map(beat => beat.shot), ["wide", "vault", "drift", "strike", "pose", "ring"]);
  for (let i = 1; i < beats.length; i += 1) assert.ok(beats[i].at >= beats[i - 1].at, "in order");
  const by = Object.fromEntries(beats.map(beat => [beat.shot, beat]));
  assert.ok(by.wide.at < 0 && by.wide.ease > 0, "the wide shot comes in while it charges");
  assert.equal(by.vault.ease, 0, "a straight cut to the vault");
  assert.ok(by.vault.at > plan.crouch.from && by.vault.at < plan.vault.from);
  assert.ok(by.drift.ease > 0 && by.drift.at === plan.vault.from && by.drift.at + by.drift.ease <= plan.landAt + 1e-9, "the low shot moves with the vault");
  assert.ok(by.strike.at > plan.apexAt && by.strike.at > plan.crossAt && by.strike.at < plan.landAt, "the X is seen from below, then a cut on the way down"); assert.equal(by.strike.ease, 0);
  assert.equal(by.pose.at, plan.pose.from); assert.equal(by.pose.ease, 0);
  assert.equal(by.ring.at, plan.ring.from); assert.equal(by.ring.ease, 0);
});

test("the strike is fitted to the Knight's own clip: held at its raised frame, driven in from the landing", () => {
  // Aethelgard's Knight (combat-ranks/wn.json): ready 0.1, clash 0.5, contact 1.167.
  const wn = strikeTiming({ ready: 0.1, clash: 0.5, contact: 1.167, impact: 1.167, recovery: 1.567 }, 2);
  assert.equal(wn.hold, 0.5);
  assert.ok(wn.rate >= 0.8 && wn.rate <= 2.6);
  assert.ok(Math.abs(wn.lead - (1.167 - 0.5) / wn.rate) < 1e-9);
  assert.ok(wn.lead >= VAULT_TIMING.strikeLead - 1e-9 && wn.lead < 0.4, `${wn.lead}s`);
  // Kwind-09's (kn.json) has no clash: it is held part way from its ready to its contact.
  const kn = strikeTiming({ ready: 1.333, contact: 1.6, impact: 1.6 }, 2.533);
  assert.ok(kn.hold > 1.333 && kn.hold < 1.6);
  assert.ok(Math.abs(kn.lead - (1.6 - kn.hold) / kn.rate) < 1e-9);
  // A clip with nothing marked still gets a strike.
  const bare = strikeTiming({}, 1.2);
  assert.ok(bare.contact > bare.hold && bare.lead > 0);
  // The plan takes the clip's lead, held to a sensible window.
  const plan = planKnightVault(live(), wn.lead);
  assert.ok(Math.abs(plan.strikeAt - plan.landAt - wn.lead) < 1e-9);
  assert.ok(planKnightVault(live(), 5).strikeAt - planKnightVault(live(), 5).landAt <= 0.45 + 1e-9);
});

test("the vault's path: off the stone, over the piece's head at the top, down behind it, turned round to face it", () => {
  for (const victim of [0.78, 1.04, 1.32]) {
    const lift = vaultLift(victim);
    assert.ok(lift > victim, "the feet clear the head");
    assert.equal(vaultPose(0, lift).height, 0);
    assert.ok(Math.abs(vaultPose(1, lift).height) < 1e-9);
    assert.ok(Math.abs(vaultPose(0.5, lift).height - lift) < 1e-9);
  }
  let last = -1;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const pose = vaultPose(u, 1);
    assert.ok(pose.progress >= last - 1e-9, "never goes back");
    last = pose.progress;
  }
  assert.equal(vaultPose(0, 1).progress, 0); assert.ok(Math.abs(vaultPose(1, 1).progress - 1) < 1e-9);
  assert.ok(Math.abs(vaultPose(0.5, 1).progress - 0.5) < 1e-9, "over the piece at the top");
  assert.equal(vaultPose(0, 1).turn, 0); assert.equal(vaultPose(1, 1).turn, 1);
  assert.ok(vaultPose(0.5, 1).arch > 0.9, "arched back over the top");
});

test("it lands behind the piece, off any figure standing there, and on the board where it can", () => {
  const standoff = { x: 0, y: 0, z: 1 }, victim = { x: 0, y: 0, z: 0 };
  const plain = vaultLanding({ standoff, victim, reach: 0.53, edge: 4, obstacles: [] });
  assert.equal(plain.turn, 0);
  assert.ok(Math.abs(plain.point.z + 0.53) < 1e-9 && Math.abs(plain.point.x) < 1e-9, "straight behind");
  // A figure standing right behind it: it comes down to one side, clear of it.
  const crowded = vaultLanding({ standoff, victim, reach: 0.53, edge: 4, obstacles: [{ x: 0, z: -1.02, radius: 0.27, height: 0.78 }] });
  assert.notEqual(crowded.turn, 0);
  assert.ok(Math.hypot(crowded.point.x - 0, crowded.point.z + 1.02) - 0.27 >= 0.3, "clear of the figure");
  // At the board's edge: turned back onto it.
  const edge = vaultLanding({ standoff: { x: 0, y: 0, z: -3.0 }, victim: { x: 0, y: 0, z: -3.57 }, reach: 0.53, edge: 3.96, obstacles: [] });
  assert.ok(Math.abs(edge.point.z) <= 3.96 + 1e-9 && Math.abs(edge.point.x) <= 3.96 + 1e-9, JSON.stringify(edge));
});

// ------------------------------------------------------------------------------------------------ the shots

const stage = (extra: Partial<VaultStage> = {}): VaultStage => ({
  start: { x: 1.02, y: 0, z: 2.04 }, standoff: { x: 0.24, y: 0, z: 0.47 }, victim: { x: 0, y: 0, z: 0 }, landing: { x: -0.24, y: 0, z: -0.47 },
  attackerHeight: 1, victimHeight: 0.78, lift: vaultLift(0.78),
  home: { position: { x: 0, y: 6.5, z: 8.5 }, target: { x: 0, y: 0, z: 0 } }, aspect: 16 / 9, fov: 42, boardTop: 0, radius: 10.6,
  obstacles: [], ...extra,
});

test("every shot keeps what it must see in the frame, above the stone and inside the hall", () => {
  for (const extra of [{}, { victimHeight: 1.32, lift: vaultLift(1.32) }, { aspect: 9 / 16 }, { home: { position: { x: 0, y: 6.5, z: -8.5 }, target: { x: 0, y: 0, z: 0 } } }]) {
    const s = stage(extra), shots = vaultShots(s), points = vaultShotPoints(s);
    for (const name of Object.keys(shots) as (keyof typeof shots)[]) {
      const view = shots[name];
      assert.ok(view.position.y >= s.boardTop + 0.35, `${name} above the stone`);
      assert.ok(Math.hypot(view.position.x, view.position.z) <= s.radius + 1e-6, `${name} inside the hall`);
      for (const point of points[name]) {
        const at = frameShare(view, point, s.aspect);
        assert.ok(at && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1, `${name} sees ${JSON.stringify(point)}: ${JSON.stringify(at)}`);
      }
    }
  }
});

test("the vault is seen from low, the strike and the pose from close, and the pose from in front of the Knight", () => {
  const s = stage(), shots = vaultShots(s);
  const distance = (name: keyof typeof shots) => Math.hypot(shots[name].position.x - shots[name].target.x, shots[name].position.y - shots[name].target.y, shots[name].position.z - shots[name].target.z);
  assert.ok(shots.vault.position.y < shots.wide.position.y - 1 && shots.vault.position.y < 1.2, `low: ${shots.vault.position.y}`);
  assert.ok(shots.vault.position.y < shots.vault.target.y, "looking up at it going over");
  assert.ok(distance("strike") < distance("wide") && distance("pose") < distance("wide"));
  assert.ok(distance("pose") < 3.2, `the pose is a close shot: ${distance("pose")}`);
  // In front: on the far side of the Knight from the piece it has just killed.
  const front = { x: s.landing.x - s.victim.x, z: s.landing.z - s.victim.z };
  assert.ok((shots.pose.position.x - s.landing.x) * front.x + (shots.pose.position.z - s.landing.z) * front.z > 0);
  // The low shot moves on as it flies.
  assert.ok(Math.hypot(shots.drift.position.x - shots.vault.position.x, shots.drift.position.z - shots.vault.position.z) > 0.3);
  // The wide shots are from the player's side.
  assert.ok(shots.wide.position.z > 0 && shots.ring.position.z > 0);
  // Same board, same shots.
  assert.deepEqual(vaultShots(stage()), shots);
});

test("a close shot turns to the side no standing figure blocks", () => {
  const open = vaultShots(stage());
  // A tall figure on the line from the strike's preferred eye to the fight.
  const eye = open.strike.position, mid = { x: 0, z: 0 };
  const blocker = { x: (eye.x + mid.x) / 2, z: (eye.z + mid.z) / 2, radius: 0.3, height: 1.5 };
  const crowded = vaultShots(stage({ obstacles: [blocker] }));
  const sights = vaultShotPoints(stage()).strike;
  assert.ok(sightBlocked(open.strike.position, sights, [blocker]) > 0, "the blocker does stand in the open shot's way");
  assert.ok(sightBlocked(crowded.strike.position, sights, [blocker]) < sightBlocked(open.strike.position, sights, [blocker]), "the crowded board's shot sees past it");
});

test("fitShot frames from the side asked, steps back until everything fits, and widens the lens only at the wall", () => {
  const points = [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1.5, z: 0 }];
  const view = fitShot(points, { facing: { x: 0, z: 1 }, elevation: 20, fov: 40, aspect: 16 / 9, fill: 0.7, near: 1, far: 20, floor: 0.3, radius: 50 });
  assert.equal(view.confined, false);
  assert.ok(view.position.z > 0, "from the side asked");
  for (const p of points) { const at = frameShare(view, p, 16 / 9)!; assert.ok(Math.abs(at.x) <= 0.7 + 1e-9 && Math.abs(at.y) <= 0.7 + 1e-9); }
  const walled = fitShot(points, { facing: { x: 0, z: 1 }, elevation: 20, fov: 40, aspect: 16 / 9, fill: 0.7, near: 1, far: 20, floor: 0.3, radius: 1.6 });
  assert.equal(walled.confined, true);
  assert.ok(walled.fov > 40 && Math.hypot(walled.position.x, walled.position.z) <= 1.6 + 1e-9);
});

// ------------------------------------------------------------------------------------------------ what it draws

test("the low preset keeps the timing and draws less: fewer flakes and streaks, shorter wings, no light", () => {
  const low = planKnightVault(live({ quality: "low" })), medium = planKnightVault(live({ quality: "medium" }));
  assert.deepEqual({ ...low, fx: null, budget: null }, { ...medium, fx: null, budget: null }, "the same beats");
  assert.equal(low.fx.light, false);
  assert.equal(medium.fx.light, true);
  assert.ok(low.fx.ringFlakes < medium.fx.ringFlakes && low.fx.sprayFlakes < medium.fx.sprayFlakes && low.fx.streaks < medium.fx.streaks);
  assert.ok(low.budget.wingSegments < medium.budget.wingSegments);
});

test("every preset's flakes and streaks fit their pools at the busiest moment, and the pools grow with the preset", () => {
  let previous = null as null | (typeof VAULT_BUDGET)["low"];
  for (const quality of presets) {
    const budget = VAULT_BUDGET[quality], plan = planKnightVault(live({ quality }));
    assert.ok(vaultFlakePeak(plan) <= budget.flakePool, `${quality}: ${vaultFlakePeak(plan)} flakes in ${budget.flakePool}`);
    assert.ok(vaultStreakPeak(plan) <= budget.streakPool, `${quality}: ${vaultStreakPeak(plan)} streaks in ${budget.streakPool}`);
    const calm = planKnightVault(live({ quality, reducedMotion: true }));
    assert.ok(vaultFlakePeak(calm) <= budget.flakePool && vaultFlakePeak(calm) <= 12);
    // The vault's own pools stay small beside the flourishes' shared spark pool.
    assert.ok(budget.flakePool + budget.streakPool <= FLOURISH_BUDGET[quality].sparks / 4, `${quality} beside the flourishes`);
    // Its two shatters (the stagger's and the kill's) fit the flourishes' pools at once.
    assert.ok(FLOURISH_BUDGET[quality].flakes * 2 + FLOURISH_BUDGET[quality].arcSparks <= FLOURISH_BUDGET[quality].sparks);
    assert.ok(FLOURISH_BUDGET[quality].chips * 2 <= FLOURISH_BUDGET[quality].chipPool);
    if (previous) for (const key of ["wingSegments", "streaks", "ringFlakes", "sprayFlakes", "flakePool", "streakPool"] as const) assert.ok(budget[key] >= previous[key], `${quality} ${key}`);
    previous = budget;
  }
});

test("each kingdom's vault is in its own colours: dark ink, its edge, pale flakes", () => {
  const value = (hex: number) => Math.max((hex >> 16) & 255, (hex >> 8) & 255, hex & 255) / 255;
  for (const army of armies) {
    const look = VAULT_LOOK[army];
    assert.ok(value(look.ink) < 0.3, `${army} ink is dark`);
    assert.equal(look.edge, FLOURISH_LOOK[army].edge);
    assert.equal(look.core, FLOURISH_LOOK[army].core);
    assert.ok(value(look.flake) > 0.9, `${army} flakes are pale`);
  }
  assert.notEqual(VAULT_LOOK.sun.edge, VAULT_LOOK.ivory.edge);
});

test("the shot table is well formed", () => {
  for (const name of ["wide", "vault", "drift", "strike", "pose", "ring"] as const) {
    const shot = VAULT_SHOT[name];
    assert.ok(shot.near < shot.far && shot.fill > 0 && shot.fill < 1 && shot.floor > 0);
  }
});
