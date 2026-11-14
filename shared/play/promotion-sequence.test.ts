import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_SHARE, CHOICE_SCALE, PICKER_HALF_WIDTH, PROMOTION_LIFT, PROMOTION_LOOK, PROMOTION_TIMING,
  arrivalFrame, choiceStage, choiceStaged, clearestFacing, columnPower, cuesBetween, figureFormed, figureLift, landingSquash, pawnLift, pawnUnmade,
  planPromotion, promotionFacing, promotionMode, type PromotionArmy, type PromotionContext, type PromotionPlan, type PromotionRank,
} from "../../web/src/scene/promotion/promotionPlan";
import {
  DEFAULT_PROMOTION_FOCUS, PROMOTION_ORDER, focusEase, isPromotionChoice, promotionFocusLook, promotionKeyAction, stepPromotionFocus,
} from "../../web/src/scene/promotion/promotionChoice";

const armies: PromotionArmy[] = ["ivory", "sun", "empire", "kwind"];
const ranks: PromotionRank[] = ["q", "r", "b", "n"];
const live = (extra: Partial<PromotionContext> = {}): PromotionContext => ({
  army: "ivory", rank: "q", side: "w", quality: "medium", reducedMotion: false, tactical: false, menuBoard: false,
  replay: false, cinematics: true, hurried: false, capture: false, ...extra,
});
const sample = (plan: PromotionPlan, step = 1 / 60) => {
  const out: { t: number; column: number; unmade: number; formed: number; pawn: number; figure: number }[] = [];
  for (let t = 0; t <= plan.total + 1e-9; t += step) {
    out.push({ t, column: columnPower(plan, t), unmade: pawnUnmade(plan, t), formed: figureFormed(plan, t), pawn: pawnLift(plan, t), figure: figureLift(plan, t) });
  }
  return out;
};

test("the full sequence runs its beats in order and lasts three to five seconds with the camera's way home", () => {
  const plan = planPromotion(live());
  assert.equal(plan.mode, "full");
  assert.ok(plan.ignite.from === 0 && plan.ignite.to > plan.ignite.from);
  assert.ok(plan.rise.from >= plan.ignite.from && plan.rise.to > plan.rise.from, "lifted once the column stands");
  assert.ok(plan.unmake.from > plan.rise.from, "the Pawn rises before it burns");
  assert.ok(plan.form.from > plan.unmake.from && plan.form.from < plan.unmake.to, "the figure begins before the Pawn is wholly gone: something always stands in the light");
  assert.ok(plan.form.to > plan.unmake.to);
  assert.ok(plan.hold.from === plan.form.to && plan.hold.to > plan.hold.from, "it hangs whole a beat");
  assert.ok(plan.fall.from === plan.hold.to && plan.fall.to - plan.fall.from < 0.4, "the drop is short");
  assert.equal(plan.landAt, plan.fall.to);
  assert.ok(plan.release > plan.landAt && plan.release <= plan.total, "the camera goes home after the landing");
  const seen = plan.release + PROMOTION_TIMING.home;
  assert.ok(seen >= 3 && seen <= 5, `seen for ${seen}s`);
  assert.ok(plan.total >= 3 && plan.total <= 4.2, `the move waits ${plan.total}s`);
  assert.ok(PROMOTION_TIMING.comeIn > 0 && PROMOTION_TIMING.comeIn <= PROMOTION_TIMING.easeIn, "after a fight the light waits for the camera, no longer than its way in");
  assert.ok(plan.total + PROMOTION_TIMING.comeIn <= 4.6, "and the whole still fits the moment");
});

test("the full sequence takes the camera, draws the column, the kingdom's sigil and motes and borrows a light", () => {
  const plan = planPromotion(live());
  assert.deepEqual([plan.camera, plan.column, plan.sigil, plan.motes, plan.light], [true, true, true, true, true]);
  assert.equal(plan.lift, PROMOTION_LIFT);
  assert.ok(plan.particles.landing > 0 && plan.particles.stand > 0);
});

test("the Pawn rises and burns away while the figure forms at the lift, then drops onto the square", () => {
  const plan = planPromotion(live());
  const states = sample(plan);
  for (let i = 1; i < states.length; i += 1) {
    assert.ok(states[i].unmade >= states[i - 1].unmade - 1e-9, "the burn never undoes itself");
    assert.ok(states[i].formed >= states[i - 1].formed - 1e-9, "nor the forming");
    assert.ok(states[i].pawn >= states[i - 1].pawn - 1e-9, "the Pawn only rises");
    if (states[i].t > plan.hold.to) assert.ok(states[i].figure <= states[i - 1].figure + 1e-9, "the figure only falls");
  }
  assert.equal(pawnLift(plan, plan.rise.to), PROMOTION_LIFT);
  assert.equal(pawnUnmade(plan, plan.unmake.to), 1);
  assert.equal(figureFormed(plan, plan.form.from), 0);
  assert.equal(figureFormed(plan, plan.form.to), 1);
  assert.equal(figureLift(plan, plan.form.from), PROMOTION_LIFT, "it forms in the air");
  assert.equal(figureLift(plan, plan.landAt), 0);
  assert.equal(figureLift(plan, plan.total), 0);
  // Falling as a weight: slow off the top, fastest at the stone.
  const fall = plan.fall, early = figureLift(plan, fall.from) - figureLift(plan, fall.from + 0.05), late = figureLift(plan, fall.to - 0.05) - figureLift(plan, fall.to);
  assert.ok(late > early * 3);
});

test("the column stands up, flares as the figure stands whole, and is gone soon after the landing", () => {
  const plan = planPromotion(live());
  assert.equal(columnPower(plan, 0), 0);
  assert.ok(columnPower(plan, plan.ignite.to) > 0.95);
  assert.ok(columnPower(plan, plan.form.to + 0.02) > columnPower(plan, plan.form.to - 0.05), "the flare");
  assert.equal(columnPower(plan, plan.total), 0);
  for (const state of sample(plan)) assert.ok(state.column >= 0 && state.column <= 1.5);
});

test("the landing pushes once and lets go", () => {
  const plan = planPromotion(live());
  assert.equal(landingSquash(plan, plan.landAt - 0.01), 0);
  const peak = Math.max(...[0.01, 0.02, 0.03, 0.05].map((dt) => landingSquash(plan, plan.landAt + dt)));
  assert.ok(peak > 0.4 && peak <= 1);
  assert.ok(landingSquash(plan, plan.landAt + 0.5) < 0.01);
});

test("its sounds and its line come at their moments, each once", () => {
  const plan = planPromotion(live());
  const heard: string[] = [];
  let clock = -1;
  for (let t = 0; t <= plan.total + 1e-9; t += 1 / 30) { heard.push(...cuesBetween(plan, clock, t)); clock = t; }
  heard.push(...cuesBetween(plan, clock, plan.total));
  assert.deepEqual(heard, ["promote", "charge", "stand", "land", "speak"]);
  const at = Object.fromEntries(plan.cues.map((entry) => [entry.cue, entry.at]));
  assert.equal(at.stand, plan.form.to);
  assert.equal(at.land, plan.landAt);
  assert.equal(at.speak, plan.landAt, "the new figure speaks as it lands, not before");
});

test("each kingdom has its own light (its burning edge matches the muster's: web/src/scene/promotion/promotionLook.test.ts)", () => {
  const glows = new Set(armies.map((army) => PROMOTION_LOOK[army].glow));
  assert.equal(glows.size, 4);
  assert.equal(new Set(armies.map((army) => PROMOTION_LOOK[army].burn)).size, 4);
  for (const army of armies) assert.equal(planPromotion(live({ army })).look, PROMOTION_LOOK[army]);
  // Solforiz comes down hardest, Korvenia lightest.
  const weight = (army: PromotionArmy) => planPromotion(live({ army })).weight;
  assert.ok(weight("sun") > weight("ivory") && weight("ivory") > weight("empire"));
});

test("a Queen or a Rook comes down heavier than a Bishop; every rank inside the board's range", () => {
  const weight = (rank: PromotionRank) => planPromotion(live({ rank })).weight;
  assert.ok(weight("q") > weight("b") && weight("r") > weight("b"));
  for (const army of armies) for (const rank of ranks) {
    const plan = planPromotion(live({ army, rank }));
    assert.ok(plan.weight > 0.8 && plan.weight <= 1.6);
    assert.equal(plan.total, planPromotion(live()).total, "the timing is the same whatever is chosen");
  }
});

test("reduced motion: a crossfade on the square under 0.6 s, nothing lifted, no camera, no light", () => {
  const plan = planPromotion(live({ reducedMotion: true }));
  assert.equal(plan.mode, "calm");
  assert.ok(plan.total < 0.6);
  assert.deepEqual([plan.camera, plan.column, plan.sigil, plan.motes, plan.light], [false, false, false, false, false]);
  assert.equal(plan.lift, 0);
  assert.equal(plan.shake, 0);
  for (const state of sample(plan, 0.01)) { assert.equal(state.pawn, 0); assert.equal(state.figure, 0); assert.equal(state.column, 0); }
  assert.ok(plan.form.from < plan.unmake.to, "a crossfade: the figure comes in as the Pawn goes");
  assert.equal(figureFormed(plan, plan.total), 1);
  // Reduced motion wins over a hurried move, and over every preset.
  assert.equal(planPromotion(live({ reducedMotion: true, hurried: true, quality: "ultra" })).mode, "calm");
});

test("the low preset keeps the timing but draws less: no kingdom motes, no extra light, fewer embers", () => {
  const low = planPromotion(live({ quality: "low" })), medium = planPromotion(live({ quality: "medium" }));
  assert.equal(low.mode, "full");
  assert.equal(low.total, medium.total);
  assert.equal(low.camera, true);
  assert.equal(low.column, true);
  assert.equal(low.sigil, true);
  assert.equal(low.motes, false);
  assert.equal(low.light, false);
  assert.ok(low.particles.landing < medium.particles.landing);
  assert.equal(low.particles.stand, 0);
  assert.equal(low.particles.budget, "low");
});

test("a hurried move takes the brief form: the same light at a third of the length, no camera", () => {
  const brief = planPromotion(live({ hurried: true })), full = planPromotion(live());
  assert.equal(brief.mode, "brief");
  assert.ok(Math.abs(brief.total - full.total * BRIEF_SHARE) < 1e-9);
  assert.ok(brief.total < 1.3);
  assert.equal(brief.camera, false);
  assert.equal(brief.column, true);
  assert.equal(brief.light, false);
  assert.ok(brief.lift < full.lift);
  assert.ok(!brief.cues.some((entry) => entry.cue === "charge"));
});

test("the plain swap for the menu's board and the tactical map; a replay plays it in full, and briefly when skipped", () => {
  assert.equal(promotionMode(live({ replay: true })).mode, "full");
  assert.equal(promotionMode(live({ replay: true, hurried: true })).mode, "brief");
  for (const [extra, reason] of [[{ menuBoard: true }, "menu-board"], [{ tactical: true }, "tactical"]] as const) {
    const plan = planPromotion(live(extra));
    assert.equal(plan.mode, "plain");
    assert.equal(plan.reason, reason);
    assert.deepEqual([plan.camera, plan.column, plan.light], [false, false, false]);
    assert.ok(Math.abs(plan.total - 0.44) < 1e-9, "the old fade");
    // The plain swap wins over reduced motion and a hurried move too.
    assert.equal(planPromotion(live({ ...extra, reducedMotion: true, hurried: true })).mode, "plain");
  }
});

test("capture cinematics off: the transformation still plays where it stands, the camera stays with the player", () => {
  const plan = planPromotion(live({ cinematics: false }));
  assert.equal(plan.mode, "full");
  assert.equal(plan.camera, false);
  assert.equal(plan.column, true);
});

test("a promotion with a capture plays the full sequence after its fight", () => {
  assert.deepEqual(promotionMode(live({ capture: true })), { mode: "full", reason: "after-capture" });
  assert.equal(planPromotion(live({ capture: true })).total, planPromotion(live()).total);
});

test("the choice is staged with its close shot only where the sequence could take the camera", () => {
  const base = { reducedMotion: false, tactical: false, menuBoard: false, cinematics: true, replay: false };
  assert.equal(choiceStaged(base), true);
  for (const off of [{ reducedMotion: true }, { tactical: true }, { menuBoard: true }, { cinematics: false }, { replay: true }]) assert.equal(choiceStaged({ ...base, ...off }), false);
});

test("the close shots look from the promoting side, leaning toward the middle of the board", () => {
  for (const x of [-3.57, -0.51, 0.51, 3.57]) {
    const white = promotionFacing("w", x), black = promotionFacing("b", x);
    assert.ok(Math.abs(Math.hypot(white.x, white.z) - 1) < 1e-9);
    assert.ok(white.z > 0.8, "White's player sits at +z");
    assert.ok(black.z < -0.8);
    assert.ok(Math.sign(white.x) === -Math.sign(x), "toward the middle");
  }
  assert.ok(Math.abs(promotionFacing("w", 3.57).x) > Math.abs(promotionFacing("w", 0.51).x), "more from the edge files");
});

test("the arrival shot keeps the square and the column up past the tallest figure at the lift", () => {
  const frame = arrivalFrame({ x: 1.53, z: -3.57 }, 0);
  assert.ok(frame.some((p) => p.y <= 0), "down to the stone, with a margin under it");
  assert.ok(Math.max(...frame.map((p) => p.y)) > PROMOTION_LIFT + 1.32);
  // Framed for the figure chosen: a Knight's shot stands nearer than a Queen's.
  const knight = arrivalFrame({ x: 1.53, z: -3.57 }, 0, PROMOTION_LIFT, 1.0);
  assert.ok(Math.max(...knight.map((p) => p.y)) > PROMOTION_LIFT + 1.0);
  assert.ok(Math.max(...knight.map((p) => p.y)) < Math.max(...frame.map((p) => p.y)));
  for (const p of frame) assert.ok(Math.hypot(p.x - 1.53, p.z + 3.57) < 0.5);
});

test("the picker floats beyond the Pawn over the far square, over the board, and the shot keeps both", () => {
  const edge = 4.08;
  for (const file of [0, 3, 7]) {
    const x = (file - 3.5) * 1.02;
    const stage = choiceStage({ pawn: { x, z: -2.55 }, square: { x, z: -3.57 }, side: "w", boardTop: 0, edge });
    assert.equal(stage.scale, CHOICE_SCALE);
    assert.ok(stage.anchor.z < -3.57, "beyond the square, away from White's player");
    assert.ok(stage.anchor.y > 0.85 + 0.5, "high enough that the Pawn stands clear under it");
    assert.ok(Math.abs(stage.anchor.x) + PICKER_HALF_WIDTH * CHOICE_SCALE <= edge + 1e-9, "nothing of it hangs off the board");
    assert.ok(stage.frame.some((p) => p.x === x && p.z === -2.55 && p.y < 0), "the Pawn's feet are framed, kept off the bottom edge");
    assert.ok(stage.frame.some((p) => p.y > stage.anchor.y), "and the candidates");
  }
  const black = choiceStage({ pawn: { x: 0.51, z: 2.55 }, square: { x: 0.51, z: 3.57 }, side: "b", boardTop: 0, edge });
  assert.ok(black.anchor.z > 3.57);
  assert.ok(black.facing.z < 0);
});

test("the plan is a pure function of its context: the same promotion plans the same sequence", () => {
  for (const army of armies) for (const rank of ranks) assert.deepEqual(planPromotion(live({ army, rank })), planPromotion(live({ army, rank })));
});

test("the close shot turns off a figure standing in its way, and keeps the plain lean when nothing is", () => {
  const a8 = { x: -3.57, z: -3.57 };
  assert.deepEqual(clearestFacing("w", a8, []), promotionFacing("w", a8.x), "an empty rank: the plain lean");
  // A Rook beside the square, a Knight a little in front: the plain lean toward the middle looks past the Rook.
  const crowded = [{ x: -2.55, z: -3.57, height: 0.98 }, { x: -2.2, z: -2.4, height: 1 }];
  const turned = clearestFacing("w", a8, crowded);
  assert.notDeepEqual(turned, promotionFacing("w", a8.x));
  assert.ok(turned.z > 0.8 && Math.abs(Math.hypot(turned.x, turned.z) - 1) < 1e-9, "still from White's side");
  // Figures on the square itself, or behind it, are never in the way.
  assert.deepEqual(clearestFacing("w", a8, [{ x: -3.57, z: -3.57, height: 1.3 }, { x: -3.57, z: -4.6, height: 1.3 }]), promotionFacing("w", a8.x));
  // Black's square, Black's side.
  assert.ok(clearestFacing("b", { x: 1.53, z: 3.57 }, crowded).z < -0.8);
});

test("the staged picker is larger than before, and a wide screen frames it closer", () => {
  assert.ok(CHOICE_SCALE >= 0.7, "the candidates read at 1280x720");
  const at = (aspect: number) => choiceStage({ pawn: { x: 0.51, z: -2.55 }, square: { x: 0.51, z: -3.57 }, side: "w", boardTop: 0, edge: 4.08, aspect });
  const span = (frame: { x: number }[]) => Math.max(...frame.map((p) => p.x)) - Math.min(...frame.map((p) => p.x));
  assert.ok(span(at(16 / 9).frame) < span(at(1).frame), "the row is counted at the share of its width the height gives it");
  assert.deepEqual(at(0.8).frame, at(1).frame, "a tall screen frames the whole row");
  // The Pawn stands clear under it.
  assert.ok(at(16 / 9).anchor.y - 0.2 > 0.78 + 0.4);
});

test("the picker opens on the Queen, and its focus runs Queen, Rook, Bishop, Knight, wrapping round", () => {
  assert.equal(DEFAULT_PROMOTION_FOCUS, "q");
  assert.deepEqual([...PROMOTION_ORDER], ["q", "r", "b", "n"]);
  assert.equal(stepPromotionFocus("q", 1), "r");
  assert.equal(stepPromotionFocus("r", 1), "b");
  assert.equal(stepPromotionFocus("b", 1), "n");
  assert.equal(stepPromotionFocus("n", 1), "q", "on past the Knight is the Queen again");
  assert.equal(stepPromotionFocus("q", -1), "n", "back past the Queen is the Knight");
  assert.equal(stepPromotionFocus("b", -1), "r");
  assert.equal(stepPromotionFocus("q", 4), "q");
  assert.equal(stepPromotionFocus("r", -6), "n");
  // Queen, Rook, Knight and back to the Queen, as the film holds it.
  let at: ReturnType<typeof stepPromotionFocus> = DEFAULT_PROMOTION_FOCUS;
  const seen = [at];
  for (const step of [1, 2, 1]) { at = stepPromotionFocus(at, step); seen.push(at); }
  assert.deepEqual(seen, ["q", "r", "n", "q"]);
});

test("the keys over the picker: the letters choose, the arrows move, Enter and Space choose the focus, Escape backs out", () => {
  for (const kind of ["q", "r", "b", "n"] as const) {
    assert.deepEqual(promotionKeyAction(kind), { type: "choose", kind });
    assert.deepEqual(promotionKeyAction(kind.toUpperCase()), { type: "choose", kind }, "with Shift or Caps Lock too");
  }
  assert.deepEqual(promotionKeyAction("ArrowLeft"), { type: "move", step: -1 });
  assert.deepEqual(promotionKeyAction("ArrowUp"), { type: "move", step: -1 });
  assert.deepEqual(promotionKeyAction("ArrowRight"), { type: "move", step: 1 });
  assert.deepEqual(promotionKeyAction("ArrowDown"), { type: "move", step: 1 });
  assert.deepEqual(promotionKeyAction("Enter"), { type: "confirm" });
  assert.deepEqual(promotionKeyAction(" "), { type: "confirm" });
  assert.deepEqual(promotionKeyAction("Escape"), { type: "back" });
  for (const other of ["k", "p", "u", "f", "Tab", "Shift", "Home"]) assert.equal(promotionKeyAction(other), null, other);
  assert.ok(isPromotionChoice("n") && !isPromotionChoice("k") && !isPromotionChoice("p"));
});

test("the focused candidate lifts and turns to the camera, its pedestal glows; the others turn away, dimmed; reduced motion only glows", () => {
  const on = promotionFocusLook(true, false), off = promotionFocusLook(false, false);
  assert.ok(on.lift > 0 && on.turn === 0 && on.glow === 1 && on.opacity === 1);
  assert.ok(off.lift === 0 && off.turn > 0 && off.glow === 0 && off.opacity < 1 && off.opacity >= 0.6, "dimmed a little, still solid enough to draw its depth");
  const calmOn = promotionFocusLook(true, true), calmOff = promotionFocusLook(false, true);
  assert.equal(calmOn.lift, 0);
  assert.equal(calmOff.turn, 0);
  assert.equal(calmOn.glow, 1);
  assert.ok(calmOff.opacity < calmOn.opacity, "the glow and the dimming still say which");
  assert.equal(focusEase(0.016, true), 1, "no easing where motion is reduced");
  assert.ok(focusEase(0.016, false) > 0 && focusEase(0.016, false) < 0.5);
  assert.ok(focusEase(0.5, false) > 0.99);
});
