import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { planGore } from "../../web/src/scene/gore/GoreDirector";
import { GoreLedger, type GoreSink } from "../../web/src/scene/gore/GoreLedger";
import { GORE_PROFILES } from "../../web/src/scene/gore/GoreProfiles";
import { goreBudget as tierBudget, type GoreTier } from "../../web/src/scene/gore/goreTiers";
import { goreSeed, impactIdOf, type GoreEvent, type GorePlan, type GoreWeapon } from "../../web/src/scene/gore/GoreTypes";
import {
  GORE_WOUND_KINDS, WEAPON_WOUND, WOUND_GATES, WOUND_GATE_FLOATS, WOUND_MASK_BUDGET, WOUND_MASK_CHANNELS, WOUND_SINK, WOUND_STROKES, maskBytes, paintDraws,
  planWoundMask, strokeAt, wetness, type GoreWoundKind, type WoundMaskInput,
} from "../../web/src/scene/gore/woundMaskPlan";
import {
  WOUND_FRAGMENT_ALBEDO, WOUND_FRAGMENT_MASK, WOUND_FRAGMENT_NORMAL, WOUND_FRAGMENT_PARS, WOUND_FRAGMENT_ROUGHNESS, WOUND_VERTEX,
  applyWounds, clearWounds, createWoundUniforms, woundUvSet, woundVertexPars,
} from "../../web/src/scene/gore/woundMaskShader";
import type { QualityPreset } from "../../web/src/scene/quality";

const QUALITIES: readonly QualityPreset[] = ["low", "medium", "high", "ultra"];
const SIZE = 0.061;
const input = (over: Partial<WoundMaskInput> = {}): WoundMaskInput => ({
  kind: "stab", size: SIZE, power: 1, intensity: "cinematic", quality: "high", tier: 1, mask: 128, interiors: false, fabric: true, bleed: 2.5, seed: 1234,
  ...over,
});
const plan = (over: Partial<WoundMaskInput> = {}) => {
  const out = planWoundMask(input(over));
  assert.ok(out, "a wound is painted");
  return out;
};

/** A Pawn's killing blow in a duel, as the engine reports it. */
const blow = (over: Partial<GoreEvent> = {}): GoreEvent => ({
  impactId: impactIdOf(3, "kill"), seed: goreSeed(4242, "kill"), ply: 3,
  attacker: { kind: "p", kingdom: "ivory", weapon: "spear" }, defender: { kind: "p", kingdom: "sun", shield: "wood" },
  contact: { point: { x: 0, y: 0.5, z: 0 }, normal: { x: 0, y: 0, z: 1 }, direction: { x: 0, y: 0, z: -1 }, anchor: "torso" },
  power: 1, outcome: "kill", intensity: "full", quality: "high",
  flags: { menuBoard: false, reducedMotion: false, tactical: false },
  ...over,
});

// ---------------------------------------------------------------- paint parameters

test("each kind of wound has its stroke: a blob for a stab, pierce or bite, a capsule along a cut or a tear, something broad for a crush or a burst", () => {
  const shapes = Object.fromEntries(GORE_WOUND_KINDS.map(kind => [kind, plan({ kind }).strokes[0]]));
  for (const kind of ["stab", "pierce", "bite"] as const) assert.equal(shapes[kind].shape, "blob", kind);
  for (const kind of ["slash", "tear"] as const) assert.equal(shapes[kind].shape, "capsule", kind);
  for (const kind of ["crush", "burst"] as const) assert.equal(shapes[kind].shape, "broad", kind);
  // A cut runs along its length; a stab is round, a bite only a little long.
  assert.ok(shapes.slash.half > shapes.slash.open * 5, "a slash is long and narrow");
  assert.ok(shapes.tear.half > shapes.tear.open * 2, "a tear is long and ragged");
  assert.equal(shapes.stab.half, 0);
  assert.ok(shapes.bite.half > 0 && shapes.bite.half < shapes.bite.open, "a bite is a short oval");
  // Broad wounds are the widest and the most torn; a slash the cleanest.
  for (const kind of GORE_WOUND_KINDS) if (kind !== "crush" && kind !== "burst") assert.ok(shapes.crush.open > shapes[kind].open, `a crush opens wider than a ${kind}`);
  assert.ok(shapes.burst.blood > shapes.crush.blood && shapes.burst.open > shapes.crush.open);
  assert.ok(shapes.slash.ragged < shapes.stab.ragged && shapes.tear.ragged > shapes.slash.ragged && shapes.crush.ragged > shapes.stab.ragged);
  for (const stroke of Object.values(shapes)) {
    assert.ok(Math.abs(Math.hypot(stroke.axis.x, stroke.axis.y) - 1) < 1e-5, "a unit axis");
    assert.ok(stroke.blood > stroke.open && stroke.open > stroke.deep && stroke.deep > 0, "the soak reaches past the opening, the core is inside it");
    assert.ok(stroke.front > 0);
  }
  // A cut is diagonal across the body, a tear rakes down it.
  assert.ok(Math.abs(shapes.slash.axis.y) > 0.2 && Math.abs(shapes.slash.axis.x) > 0.2);
  assert.ok(Math.abs(shapes.tear.axis.y) > Math.abs(shapes.tear.axis.x));
});

test("Violence: nothing at Minimal, Cinematic moderate, Full deeper, bloodier and wetter, with longer runs", () => {
  assert.equal(planWoundMask(input({ intensity: "minimal" })), null);
  for (const kind of GORE_WOUND_KINDS) {
    const cinematic = plan({ kind, intensity: "cinematic" }), full = plan({ kind, intensity: "full", bleed: 4 });
    const [c, f] = [cinematic.strokes[0], full.strokes[0]];
    assert.ok(f.open > c.open && f.blood > c.blood, `${kind}: wider at Full`);
    assert.ok(f.amount.open > c.amount.open && f.amount.blood > c.amount.blood && f.amount.deep >= c.amount.deep, `${kind}: more at Full`);
    assert.ok(full.wet > cinematic.wet, `${kind}: wetter at Full`);
    const reach = (p: typeof full) => Math.max(...p.runs.map(run => run.to));
    assert.ok(reach(full) > reach(cinematic), `${kind}: the blood runs further at Full`);
    assert.ok(full.runs.length > cinematic.runs.length, `${kind}: more runs at Full (a second rivulet)`);
  }
  // A harder blow goes deeper, never past the cap.
  assert.ok(plan({ power: 1.8 }).strokes[0].amount.deep > plan({ power: 0.6 }).strokes[0].amount.deep);
  assert.ok(plan({ power: 2, intensity: "full", kind: "pierce" }).strokes[0].amount.deep <= 1.5);
});

test("opened interiors sink the deepest part only at tier 2 on Full; torn cloth is tier 1 and up", () => {
  assert.equal(plan({ interiors: false }).sink, 0);
  const opened = plan({ interiors: true, tier: 2, intensity: "full" });
  assert.ok(opened.interiors && opened.sink > 0 && opened.sink <= WOUND_SINK, "the surface sinks, a few hundredths of the figure's height at most");
  assert.ok(plan({ fabric: true }).fabric);
  // Tier 0 and no mask on the preset paint nothing.
  assert.equal(planWoundMask(input({ tier: 0 })), null);
  assert.equal(planWoundMask(input({ mask: 0 })), null);
  assert.equal(planWoundMask(input({ size: 0 })), null);
});

test("the runs of blood come while the wound bleeds, further down each time; under reduced motion they are simply there", () => {
  for (const quality of QUALITIES) for (const intensity of ["cinematic", "full"] as const) {
    const bleed = intensity === "full" ? 4 : 2.5, out = plan({ quality, intensity, bleed });
    const main = out.runs.filter(run => run.side === 0);
    assert.equal(main.length, WOUND_MASK_BUDGET[quality].runs + (intensity === "full" ? 1 : 0), `${quality} ${intensity}`);
    for (let i = 1; i < out.runs.length; i += 1) assert.ok(out.runs[i].at >= out.runs[i - 1].at, "in order");
    for (const run of out.runs) {
      assert.ok(run.at > 0 && run.at <= bleed * 1.2, "while it bleeds");
      assert.ok(run.to > run.from && run.width > 0 && run.blood > 0);
    }
    for (let i = 1; i < main.length; i += 1) assert.ok(main[i].to > main[i - 1].to && main[i].from < main[i - 1].to, "each further down, overlapping the last");
  }
  const still = plan({ bleed: 0 });
  assert.ok(still.runs.every(run => run.at === 0), "all at once");
  assert.equal(still.runs.length, 1, "one paint, the whole run");
  assert.ok(Math.abs(still.runs[0].to - Math.max(...plan({ bleed: 2.5 }).runs.map(run => run.to))) < 1e-9, "as long as the animated one ends");
});

test("the same wound paints the same strokes; another seed turns a cut another way", () => {
  assert.deepEqual(plan({ kind: "slash" }), plan({ kind: "slash" }));
  assert.notDeepEqual(plan({ kind: "slash", seed: 1 }).strokes[0].axis, plan({ kind: "slash", seed: 99 }).strokes[0].axis);
});

test("a weapon opens its own kind of wound, and a source may name another", () => {
  const expected: Record<GoreWeapon, GoreWoundKind> = { spear: "stab", lance: "stab", sword: "slash", axe: "slash", mace: "crush", staff: "crush", musket: "pierce", fist: "crush" };
  assert.deepEqual(WEAPON_WOUND, expected);
  for (const weapon of Object.keys(expected) as GoreWeapon[]) {
    assert.equal(GORE_PROFILES[weapon].wound, expected[weapon], weapon);
    assert.equal(planGore(blow({ attacker: { kind: "p", kingdom: "ivory", weapon } })).wound?.kind, expected[weapon], weapon);
  }
  // A spell's ice runs the body through; a summon bites and tears.
  assert.equal(planGore(blow({ wound: "pierce" })).wound?.mask?.kind, "pierce");
  assert.equal(planGore(blow({ wound: "bite", attacker: { kind: "q", kingdom: "empire", weapon: "sword" }, moment: { style: "summon" } })).wound?.kind, "bite");
});

// ---------------------------------------------------------------- through the planner: tiers and sizes

test("the mask's size is the gore tier's: 64 for an ordinary fight on Low and Medium, up to 256 for a fatality", () => {
  for (const quality of QUALITIES) {
    const duel = planGore(blow({ quality }));
    assert.equal(duel.wound?.mask?.tier, 1);
    assert.equal(duel.wound?.mask?.size, tierBudget(1, quality).mask, `a Pawn's duel on ${quality}`);
    const summon = planGore(blow({ quality, attacker: { kind: "q", kingdom: "kwind", weapon: "sword" }, wound: "tear", moment: { style: "summon" } }));
    assert.equal(summon.wound?.mask?.tier, 2);
    assert.equal(summon.wound?.mask?.size, tierBudget(2, quality).mask, `a Queen's summon on ${quality}`);
    const mate = planGore(blow({ quality, moment: { style: "melee", mate: true } }));
    assert.equal(mate.wound?.mask?.tier, 3);
    assert.equal(mate.wound?.mask?.size, tierBudget(3, quality).mask, `the capture that mates on ${quality}`);
  }
  assert.equal(planGore(blow({ quality: "low" })).wound?.mask?.size, 64);
  assert.equal(planGore(blow({ quality: "medium" })).wound?.mask?.size, 64);
  assert.equal(planGore(blow({ quality: "high" })).wound?.mask?.size, 128);
  assert.equal(planGore(blow({ quality: "ultra", moment: { style: "melee", mate: true } })).wound?.mask?.size, 256);
});

test("the tier decides what opens: interiors at tier 2 on Full only, torn cloth for every kill, nothing at Minimal or off the board", () => {
  const queen = { attacker: { kind: "q" as const, kingdom: "kwind" as const, weapon: "sword" as const }, wound: "tear" as const, moment: { style: "summon" as const } };
  assert.equal(planGore(blow(queen)).wound?.mask?.interiors, true, "a summon's tearing at Full opens the wound");
  assert.ok((planGore(blow(queen)).wound?.mask?.sink ?? 0) > 0);
  assert.equal(planGore(blow({ ...queen, intensity: "cinematic" })).wound?.mask?.interiors, false, "nothing is opened at Cinematic");
  assert.equal(planGore(blow()).wound?.mask?.interiors, false, "a Pawn's duel is ordinary combat");
  assert.equal(planGore(blow({ defender: { kind: "r", kingdom: "sun" }, power: 2, attacker: { kind: "p", kingdom: "ivory", weapon: "spear" } })).wound?.mask?.tier ?? 2, 2);
  for (const event of [blow(), blow(queen), blow({ intensity: "cinematic" })]) assert.equal(planGore(event).wound?.mask?.fabric, true);
  // Nothing at Minimal, on the map or the menu's board; reduced motion and capture cinematics off cap it at tier 1.
  assert.equal(planGore(blow({ intensity: "minimal" })).wound, null);
  assert.equal(planGore(blow({ flags: { menuBoard: false, reducedMotion: false, tactical: true } })).wound, null);
  assert.equal(planGore(blow({ flags: { menuBoard: true, reducedMotion: false, tactical: false } })).silent, "menu");
  assert.equal(planGore(blow({ ...queen, flags: { menuBoard: false, reducedMotion: true, tactical: false } })).wound?.mask?.tier, 1);
  assert.equal(planGore(blow({ ...queen, flags: { menuBoard: false, reducedMotion: false, tactical: false, captureCinematics: false } })).wound?.mask?.tier, 1);
  // Under reduced motion the wound does not run: its runs are painted at once.
  assert.ok(planGore(blow({ flags: { menuBoard: false, reducedMotion: true, tactical: false } })).wound?.mask?.runs.every(run => run.at === 0));
  // A King is never captured.
  assert.equal(planGore(blow({ defender: { kind: "k", kingdom: "sun" } })).wound, null);
});

test("the same event gives the same mask, bit for bit", () => {
  for (const event of [blow(), blow({ wound: "bite", attacker: { kind: "q", kingdom: "empire", weapon: "sword" }, moment: { style: "summon" } }), blow({ intensity: "cinematic", quality: "low" })]) {
    assert.deepEqual(planGore(event).wound?.mask, planGore(event).wound?.mask);
    assert.deepEqual(JSON.parse(JSON.stringify(planGore(event))), JSON.parse(JSON.stringify(planGore(event))));
  }
});

// ---------------------------------------------------------------- budgets and costs

test("budgets: more masks alive and more runs per wound as the preset rises; costs per paint and per mask", () => {
  for (let i = 1; i < QUALITIES.length; i += 1) {
    const lower = WOUND_MASK_BUDGET[QUALITIES[i - 1]], budget = WOUND_MASK_BUDGET[QUALITIES[i]];
    assert.ok(budget.live >= lower.live && budget.runs >= lower.runs && budget.rings >= lower.rings, QUALITIES[i]);
  }
  for (const quality of QUALITIES) {
    assert.ok(WOUND_MASK_BUDGET[quality].live >= 2, "a victim and the figure before it");
    assert.ok(WOUND_MASK_BUDGET[quality].rings >= 1 && WOUND_MASK_BUDGET[quality].rings <= 3, "the dilation reads at most three rings");
  }
  // One sculpt mesh per figure: a paint is two draws, the bake and the dilation that adds it in.
  assert.equal(paintDraws(1), 2);
  assert.equal(paintDraws(3), 4);
  assert.deepEqual([64, 128, 256].map(maskBytes), [16384, 65536, 262144]);
  // A duel's wound on High at Full: the stroke and its runs.
  const duel = planGore(blow()).wound!.mask!;
  assert.equal(duel.strokes.length + duel.runs.length, 1 + 2 * (WOUND_MASK_BUDGET.high.runs + 1));
  assert.equal(WOUND_GATES, 12);
});

test("a stroke paints the surface on the wound's side of the anchor bone, never the far side of the body, and fades to nothing at its radius", () => {
  const stroke = plan({ kind: "stab" }).strokes[0];
  const middle = strokeAt(stroke, 0, 0, 0.1);
  assert.deepEqual(middle, stroke.amount, "the full amount at the stroke's middle");
  assert.equal(strokeAt(stroke, stroke.open * 0.2, 0, 0.1).open, stroke.amount.open, "the opening has a flat top");
  assert.deepEqual(strokeAt(stroke, stroke.blood * 1.01, 0, 0.1), { open: 0, blood: 0, deep: 0 }, "nothing past the soak");
  assert.equal(strokeAt(stroke, stroke.open * 1.01, 0, 0.1).open, 0, "the opening ends at its radius");
  assert.ok(strokeAt(stroke, stroke.open * 1.01, 0, 0.1).blood > 0, "the blood goes on past it");
  // Wherever along the normal the surface lies between the bone and a little in front, it is reached.
  assert.equal(strokeAt(stroke, 0, -0.04, 0.1).open, stroke.amount.open, "a surface behind the wound's point");
  assert.equal(strokeAt(stroke, 0, stroke.front * 0.5, 0.1).open, stroke.amount.open, "a surface in front of it");
  assert.equal(strokeAt(stroke, 0, -0.15, 0.1).blood, 0, "the far side of the body, past the bone");
  assert.equal(strokeAt(stroke, 0, stroke.front * 1.01, 0.1).blood, 0, "nothing far in front");
  // The plan's own numbers back the shapes: each kind's radii as the table says.
  for (const kind of GORE_WOUND_KINDS) assert.ok(Math.abs(plan({ kind }).strokes[0].open - WOUND_STROKES[kind].open * SIZE) < 1e-6, kind);
});

test("fresh blood shines and dulls as it dries, never to nothing within a match", () => {
  assert.equal(wetness(1, 0), 1);
  assert.ok(wetness(1, 5) < wetness(1, 0) && wetness(1, 30) < wetness(1, 5));
  assert.ok(wetness(1, 600) >= 0.4 - 1e-9);
  assert.ok(wetness(0.7, 0) < wetness(1, 0));
});

// ---------------------------------------------------------------- the ledger

class Recorder implements GoreSink {
  log: { what: string; at: number; index?: number; impact?: string }[] = [];
  clock = 0;
  spray(): void {}
  stain(): void {}
  wound(plan: GorePlan): void { this.log.push({ what: "wound", at: this.clock, impact: plan.impactId }); }
  woundRun(plan: GorePlan, _wound: unknown, index: number): void { this.log.push({ what: "run", at: this.clock, index, impact: plan.impactId }); }
  weaponStain(): void {}
  splash(): void {}
  pool(): void {}
  releaseBody(impactId: string): void { this.log.push({ what: "release-body", at: this.clock, impact: impactId }); }
  releaseWeapon(): void {}
  remove(impactId: string): void { this.log.push({ what: "remove", at: this.clock, impact: impactId }); }
  clear(): void { this.log.push({ what: "clear", at: this.clock }); }
}
const run = (ledger: GoreLedger, sink: Recorder, seconds: number, step: number) => {
  for (let t = 0; t < seconds; t += step) { sink.clock += step; ledger.update(step); }
};

test("the ledger paints the wound at the blow and each run at its time on the fight clock, on through the banishing", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const begun = ledger.begin(blow());
  const runs = begun.wound!.mask!.runs;
  assert.deepEqual(sink.log.map(item => item.what), ["wound"], "the wound on the contact frame");
  run(ledger, sink, 6, 1 / 60);
  const painted = sink.log.filter(item => item.what === "run");
  assert.deepEqual(painted.map(item => item.index).sort((a, b) => a! - b!), runs.map((_, index) => index));
  for (const item of painted) assert.ok(Math.abs(item.at - runs[item.index!].at) < 1 / 60 + 1e-6, "on the frame it is due");
  // The banishing begins part-way through: the mask stays on the body until the figure has gone, so its runs go on.
  const early = new Recorder(), second = new GoreLedger(early);
  const plan2 = second.begin(blow());
  run(second, early, 0.5, 1 / 60);
  second.bodyGone(plan2.impactId);
  run(second, early, 6, 1 / 60);
  assert.equal(early.log.filter(item => item.what === "run").length, runs.length);
  assert.equal(second.pending, false);
  // A wound not yet opened when the body goes is never opened.
  const late = new Recorder(), third = new GoreLedger(late);
  const plan3 = third.begin(blow({ impactId: impactIdOf(4, "kill"), ply: 4 }));
  assert.equal(late.log.filter(item => item.what === "wound").length, 1);
  third.bodyGone(plan3.impactId);
  assert.equal(late.log.filter(item => item.what === "release-body").length, 1);
});

test("Undo takes a wound's paint back with its impact; a summon's later wounds keep the earlier ones", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const at = (index: number) => blow({ ply: 7, impactId: impactIdOf(7, `rite-${index}`), seed: goreSeed(7 * 7919 + index, `rite-${index}`), follows: index > 0, wound: "tear", attacker: { kind: "q", kingdom: "kwind", weapon: "sword" }, moment: { style: "summon" } });
  ledger.begin(at(0)); ledger.begin(at(1)); ledger.begin(at(2));
  assert.equal(sink.log.filter(item => item.what === "remove").length, 0, "follows: the earlier wounds stay");
  assert.equal(sink.log.filter(item => item.what === "wound").length, 3);
  ledger.undoTo(6);
  assert.deepEqual(sink.log.filter(item => item.what === "remove").map(item => item.impact).sort(), ["7:rite-0", "7:rite-1", "7:rite-2"]);
});

// ---------------------------------------------------------------- the figure's own materials

test("the figure's block: a mask is worn and taken off without touching anything else; the patch composes with the char", () => {
  const uniforms = createWoundUniforms();
  const gates = new Float32Array(WOUND_GATES * WOUND_GATE_FLOATS).fill(0.5);
  applyWounds(uniforms, { map: "texture", wet: 1.4, interiors: true, sink: 0.02, fabric: true, gates, gateCount: 30 });
  assert.equal(uniforms.uWoundOn.value, 1);
  assert.deepEqual(uniforms.uWoundLook.value, [1, 1, 0.02, 1], "wetness clamped");
  assert.equal(uniforms.uWoundGateCount.value, WOUND_GATES, "never more gates than the shader holds");
  clearWounds(uniforms);
  assert.deepEqual(JSON.parse(JSON.stringify(uniforms)), JSON.parse(JSON.stringify(createWoundUniforms())));
  // SkinGore's choice of UV set: the second where there is one. The figures have only the first.
  assert.equal(woundUvSet(true), "uv1");
  assert.equal(woundUvSet(false), "uv");
  assert.match(woundVertexPars("uv1"), /attribute vec2 uv1;/);
  assert.doesNotMatch(woundVertexPars("uv"), /attribute vec2 uv1;/);
  assert.match(WOUND_VERTEX, /textureLod\(uWoundMap/);
  for (const chunk of [WOUND_FRAGMENT_PARS, WOUND_FRAGMENT_MASK, WOUND_FRAGMENT_ALBEDO, WOUND_FRAGMENT_ROUGHNESS, WOUND_FRAGMENT_NORMAL]) assert.ok(chunk.length > 0);
  // One patch per material in pieces.ts: the wounds before the char in each chunk, so a burning husk chars over them.
  const pieces = readFileSync(fileURLToPath(new URL("../../web/src/scene/pieces.ts", import.meta.url)), "utf8");
  assert.equal(pieces.match(/material\.onBeforeCompile = /g)?.length, 1);
  for (const [wound, char] of [["WOUND_FRAGMENT_ALBEDO", "CHAR_FRAGMENT_ALBEDO"], ["WOUND_FRAGMENT_ROUGHNESS", "CHAR_FRAGMENT_ROUGHNESS"], ["WOUND_FRAGMENT_METALNESS", "CHAR_FRAGMENT_METALNESS"]]) {
    const line = pieces.split("\n").find(text => text.includes(`\${wound(${wound})}`));
    assert.ok(line && line.indexOf(wound) < line.indexOf(char), `${wound} comes before ${char}`);
  }
  assert.match(pieces, /\.\.\.createWoundUniforms\(\),/);
  assert.match(pieces, /-wound-\$\{wounds\}/, "the sculpt's program is keyed apart from the props'");
  const reset = pieces.slice(pieces.indexOf("  resetPose(): void {"), pieces.indexOf("  get object(): THREE.Object3D {"));
  assert.match(reset, /this\.wearWounds\(null\);/, "a figure in the tray stands whole");
  // The channels are written down for whoever deepens them.
  assert.deepEqual(WOUND_MASK_CHANNELS, { r: "open", g: "blood", b: "deep", a: "cover" });
});

test("tiers keep their order of mask sizes", () => {
  for (const quality of QUALITIES) for (const tier of [2, 3] as GoreTier[]) assert.ok(tierBudget(tier, quality).mask >= tierBudget((tier - 1) as GoreTier, quality).mask);
});
