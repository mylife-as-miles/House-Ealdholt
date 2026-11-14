import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { QUALITY_ORDER, type QualityPreset } from "../../web/src/scene/quality";
import { FLIPBOOK_BUDGET, FlipbookPool } from "../../web/src/scene/vfx/flipbookCore";
import { DUST_SHADE, STEP_DUST_SHADE, VFX_ATLASES, VFX_RECIPES, type VfxEffectId, type VfxRecipeId } from "../../web/src/scene/vfx/library";
import {
  MIST_ARMY,
  PROCEDURAL_SHARE,
  SPELL_BURST,
  dustShade,
  hidesContact,
  seatFromEye,
  stoneUnder,
  vfxBudget,
  vfxCost,
  vfxCue,
  vfxGlow,
  vfxLight,
  type VfxArmy,
  type VfxCue,
  type VfxFlags,
  type VfxMoment,
} from "../../web/src/scene/vfx/wiring";

const MOMENTS: VfxMoment[] = ["fall", "step", "bash", "musket", "spell", "mist", "slam"];
const ARMIES: VfxArmy[] = ["ivory", "sun", "empire", "kwind"];
const match = (quality: QualityPreset = "high", over: Partial<VfxFlags> = {}): VfxFlags => ({ quality, reducedMotion: false, tactical: false, menuBoard: false, ...over });
/** A copy: `vfxCue` hands back one shared object. */
const cue = (...args: Parameters<typeof vfxCue>): VfxCue | null => { const made = vfxCue(...args); return made ? { ...made } : null; };

test("a spell's burst follows the caster's army: Solforiz fire, the others arcane", () => {
  assert.equal(SPELL_BURST.sun, "spellBurst");
  assert.equal(SPELL_BURST.empire, "arcaneBurst");
  assert.equal(SPELL_BURST.ivory, "arcaneBurst");
  assert.equal(SPELL_BURST.kwind, "arcaneBurst");
  for (const army of ARMIES) assert.equal(cue("spell", match(), { army, power: 1 })?.recipe, SPELL_BURST[army]);
  // No army, no guess.
  assert.equal(cue("spell", match(), { power: 1 }), null);
  // The sorceress's blast is bigger than the mage's, within bounds.
  const mage = cue("spell", match(), { army: "sun", power: 1 })!, queen = cue("spell", match(), { army: "sun", power: 1.75 })!;
  assert.ok(queen.scale > mage.scale && queen.scale <= 1.3);
});

test("each moment plays its recipe", () => {
  assert.equal(cue("fall", match())?.recipe, "fallDust");
  assert.equal(cue("step", match())?.recipe, "stepDust");
  assert.equal(cue("bash", match())?.recipe, "stepDust");
  assert.equal(cue("musket", match(), { power: 0.4 })?.recipe, "musketSmoke");
  assert.equal(cue("slam", match(), { source: "melee", power: 1 })?.recipe, "fallDust");
  assert.equal(cue("slam", match(), { source: "gun", power: 1.4 })?.recipe, "blast");
  // A whole recipe on the full presets.
  for (const moment of ["fall", "musket"] as const) assert.equal(cue(moment, match())!.parts, VFX_RECIPES[cue(moment, match())!.recipe].length);
});

test("only a Solforiz caster stands in mist, and it ends on its own", () => {
  assert.equal(MIST_ARMY, "sun");
  for (const army of ARMIES) {
    const mist = cue("mist", match(), { army, seconds: 0.9 });
    if (army !== "sun") { assert.equal(mist, null, army); continue; }
    assert.equal(mist!.recipe, "solforizMist");
    // Short: the gather plus a fade, never the loop's "until released". Subtle: under half size, well under full alpha.
    assert.ok(mist!.life > 0.9 && mist!.life <= 3);
    assert.ok(mist!.scale < 0.5 && mist!.alpha <= 0.6);
  }
  assert.ok(cue("mist", match(), { army: "sun", seconds: 30 })!.life <= 3);
});

test("a ground wave raises dust or a blast in proportion to its power", () => {
  const light = cue("slam", match(), { source: "melee", power: 0.6 })!, heavy = cue("slam", match(), { source: "melee", power: 1.6 })!;
  assert.ok(heavy.scale > light.scale);
  assert.ok(heavy.scale <= 1.7);
  const small = cue("slam", match(), { source: "gun", power: 0.4 })!, big = cue("slam", match(), { source: "gun", power: 1.6 })!;
  assert.ok(big.scale > small.scale && big.scale < 1, "a blast on a chessboard stays under its full siege size");
  assert.ok(big.life > 0 && big.life < 48 / 28, "the soot column is cut short");
});

test("the tactical map shows nothing", () => {
  for (const quality of QUALITY_ORDER) for (const moment of MOMENTS)
    assert.equal(cue(moment, match(quality, { tactical: true }), { army: "sun", power: 1, source: "gun", seconds: 1 }), null, `${quality} ${moment}`);
});

test("reduced motion: nothing moves, and only a landing or a slam keeps one still puff", () => {
  for (const quality of QUALITY_ORDER) for (const moment of MOMENTS) {
    const made = cue(moment, match(quality, { reducedMotion: true }), { army: "sun", power: 1.4, source: "gun", seconds: 1 });
    if (moment !== "fall" && moment !== "slam") { assert.equal(made, null, `${quality} ${moment}`); continue; }
    assert.ok(made, `${quality} ${moment}`);
    assert.equal(made.still, true);
    assert.equal(made.parts, 1);
    // Dust, never a fireball, and no stretched life for it to linger through.
    assert.equal(made.recipe, "fallDust");
    assert.equal(made.life, 0);
    assert.ok(made.alpha < 1.15);
  }
  // With motion on, nothing is held still.
  for (const moment of MOMENTS) assert.notEqual(cue(moment, match(), { army: "sun", source: "gun" })?.still, true);
});

test("the menu's board keeps smoke and dust, but subtle: fewer, smaller, fainter, and no step dust, mist or blast", () => {
  const menu = match("high", { menuBoard: true });
  for (const moment of ["step", "bash", "mist"] as const) assert.equal(cue(moment, menu, { army: "sun", seconds: 1 }), null, moment);
  for (const moment of ["fall", "musket", "spell", "slam"] as const) {
    const detail = { army: "sun" as const, power: 1, source: "gun" as const };
    const there = cue(moment, menu, detail), here = cue(moment, match(), detail);
    assert.ok(there && here, moment);
    assert.notEqual(there.recipe, "blast", "no powder blast behind the menu");
    assert.ok(there.alpha <= 0.7, `${moment} alpha ${there.alpha}`);
    assert.ok(there.parts <= here.parts && there.parts <= 2);
    if (there.recipe === here.recipe) assert.ok(there.scale < here.scale, moment);
  }
});

test("Violence Intensity is not an input: the flags carry no such thing", () => {
  assert.deepEqual(Object.keys(match()).sort(), ["menuBoard", "quality", "reducedMotion", "tactical"]);
});

test("the low preset plays fewer and smaller sprites, and no step dust or mist", () => {
  for (const moment of ["step", "bash", "mist"] as const) assert.equal(cue(moment, match("low"), { army: "sun", seconds: 1 }), null, moment);
  for (const moment of ["fall", "musket", "spell", "slam"] as const) for (const army of ARMIES) {
    const detail = { army, power: 1, source: "melee" as const };
    const low = cue(moment, match("low"), detail)!, high = cue(moment, match("high"), detail)!;
    assert.ok(low.scale < high.scale, `${moment} smaller`);
    assert.ok(low.parts <= high.parts, `${moment} no more sprites`);
    assert.ok(low.parts < VFX_RECIPES[low.recipe].length || VFX_RECIPES[low.recipe].length === 1, `${moment} fewer than the whole recipe`);
  }
  // medium, high and ultra play the same look; only the pool behind it grows.
  for (const moment of MOMENTS) assert.deepEqual(cue(moment, match("medium"), { army: "sun", source: "gun" }), cue(moment, match("ultra"), { army: "sun", source: "gun" }), moment);
});

test("the busiest captures fit every preset's budget without replacing a live sprite", () => {
  // What can be in the air at once, generously: every sprite of a capture alive together.
  const captures: Record<string, [VfxMoment, Parameters<typeof vfxCue>[2]][]> = {
    // A long Pawn duel: every step of both fighters, both bashes of the underdog take, then the body.
    duel: [...Array.from({ length: 10 }, () => ["step", { power: 0.5 }] as [VfxMoment, { power: number }]), ["bash", {}], ["bash", {}], ["fall", {}]],
    // The sorceress: mist, the burst, the body.
    spell: [["mist", { army: "sun", seconds: 1 }], ["spell", { army: "sun", power: 1.75 }], ["fall", {}]],
    arcane: [["spell", { army: "ivory", power: 1.75 }], ["fall", {}]],
    // The field gun: muzzle smoke, the blast under the target, the body.
    cannon: [["musket", { power: 1 }], ["slam", { source: "gun", power: 1.6 }], ["fall", {}]],
    // A Rook's slam, then the body.
    slam: [["slam", { source: "melee", power: 1.5 }], ["fall", {}]],
  };
  for (const quality of QUALITY_ORDER) {
    const budget = vfxBudget(quality);
    assert.equal(budget, FLIPBOOK_BUDGET[quality]);
    for (const [name, moments] of Object.entries(captures)) {
      const cost: Partial<Record<VfxEffectId, number>> = {};
      for (const [moment, detail] of moments) vfxCost(vfxCue(moment, match(quality), detail), cost);
      for (const [effect, count] of Object.entries(cost)) assert.ok(count <= budget.instances, `${quality} ${name}: ${count} ${effect} sprites in ${budget.instances} slots`);
      // Two such captures back to back (a fast exchange) still fit.
      for (const [effect, count] of Object.entries(cost)) assert.ok(count * 2 <= budget.instances * 2 && count <= 16, `${quality} ${name} ${effect}`);
    }
  }
  // Fewer on low than on high, for the same capture.
  const total = (quality: QualityPreset) => Object.values(captures).flat().reduce((sum, [moment, detail]) => sum + Object.values(vfxCost(vfxCue(moment, match(quality), detail))).reduce((a, b) => a + b, 0), 0);
  assert.ok(total("low") < total("high"));
  assert.ok(FLIPBOOK_BUDGET.low.instances < FLIPBOOK_BUDGET.high.instances);
});

test("asking for a cue allocates nothing: one shared record is refilled", () => {
  const first = vfxCue("fall", match()), second = vfxCue("musket", match(), { power: 1 });
  assert.equal(first, second);
  assert.equal(second!.recipe, "musketSmoke");
  const own: VfxCue = { recipe: "fallDust", scale: 0, alpha: 0, parts: 0, still: true, life: 9, colour: [9, 9, 9] };
  assert.equal(vfxCue("step", match(), { power: 1 }, own), own);
  assert.deepEqual(own, { recipe: "stepDust", scale: 1.2, alpha: 1, parts: 1, still: false, life: 0, colour: null });
});

test("Undo and reset leave nothing in the air: a capture's sprites are gone the moment the pools are cleared", () => {
  const pools = new Map<VfxEffectId, FlipbookPool>();
  const pool = (effect: VfxEffectId) => pools.get(effect) ?? pools.set(effect, new FlipbookPool(VFX_ATLASES[effect], FLIPBOOK_BUDGET.high.instances)).get(effect)!;
  const play = (moment: VfxMoment, detail: Parameters<typeof vfxCue>[2], now: number) => {
    const made = vfxCue(moment, match(), detail)!;
    VFX_RECIPES[made.recipe].slice(0, made.parts).forEach(part => pool(part.effect).spawn(now, { x: 0, y: 0, z: 0, size: part.size * made.scale, ...(made.life > 0 ? { life: made.life } : {}) }));
  };
  play("mist", { army: "sun", seconds: 1.2 }, 0);
  play("spell", { army: "sun", power: 1.75 }, 1.2);
  play("fall", {}, 1.9);
  const alive = () => [...pools.values()].reduce((sum, item) => sum + item.active, 0);
  assert.equal(alive(), 3 + 2 + 2);
  // The mist is a loop, but it was given a life: it ends without a release.
  pool("smoke").expire(0 + 3.01);
  assert.equal(pool("smoke").active, 0);
  play("mist", { army: "sun", seconds: 1.2 }, 4);
  assert.ok(alive() > 0);
  for (const item of pools.values()) item.clear();
  assert.equal(alive(), 0);
  for (const item of pools.values()) for (let slot = 0; slot < item.capacity; slot++) assert.equal(item.data[slot * 24 + 10], 0, "a cleared slot draws nothing");
});

test("the scene clears its flipbooks wherever the board is rebuilt, and Undo and a new game both rebuild it", () => {
  const source = readFileSync(fileURLToPath(new URL("../../web/src/scene/sceneEngine.ts", import.meta.url)), "utf8");
  const body = (start: string, end: string) => { const from = source.indexOf(start); assert.ok(from >= 0, start); const to = source.indexOf(end, from); assert.ok(to > from, end); return source.slice(from, to); };
  assert.match(body("private rebuildPieces(): void {", "if (!this.factory.isReady) return;"), /this\.vfx\?\.clear\(\)/);
  assert.match(body('this.controller.on("reset"', "}),"), /this\.rebuildPieces\(\)/);
  assert.match(body('this.controller.on("rewind"', "}),"), /this\.rebuildPieces\(\)/);
  // One system, updated on the fight's delta beside the blood, following the preset, freed with the scene.
  assert.equal(source.match(/new FlipbookSystem\(/g)?.length, 1);
  assert.match(source, /this\.gore\?\.update\(delta\);\s*\/\/[^\n]*\n\s*this\.vfx\?\.update\(delta\);/);
  assert.match(body("setQuality(preset: QualityPreset): void {", "this.handleResize();"), /this\.vfx\?\.setQuality\(preset\)/);
  assert.match(body("  dispose(): void {", "this.renderer.dispose();"), /this\.vfx\?\.dispose\(\)/);
  assert.match(body("setTacticalView(active: boolean", "if (active) {"), /if \(active\) this\.vfx\?\.clear\(\)/);
});

test("the older sprite smoke thins where a flipbook covers the moment", () => {
  assert.ok(PROCEDURAL_SHARE > 0 && PROCEDURAL_SHARE <= 0.5);
});

test("dust is tuned to read as dust: low, and always faded into the board", () => {
  // The dust atlas is a thin sheet by shape (a tenth as high as wide), and its own alpha averages a quarter where there
  // is dust: at a third of that it could not be seen in a filmed duel.
  for (const part of VFX_RECIPES.fallDust) assert.ok((part.alpha ?? 1) >= 0.3 && (part.alpha ?? 1) <= 0.6, "fall dust alpha");
  // A footfall is one soft puff, not the scuff: the scuff's smear (a sixth of its cell high, a sixth opaque) was a strip
  // about ten pixels high behind the heel at the duel camera, and no footfall in a filmed duel could be seen.
  const step = VFX_RECIPES.stepDust;
  assert.equal(step.length, 1);
  assert.equal(step[0].effect, "smokePuff");
  assert.equal(VFX_ATLASES.smokePuff.pivot[1], 0.5, "the puff's middle on the stone: the stone hides its lower half");
  // Past full alpha (the renderer holds each pixel at 1): the ball's own alpha averages about a quarter and thins to
  // nothing at its rim, and at 1 a filmed puff changed the stone by about 2 %. Not so far past that it is a cloud.
  assert.ok((step[0].alpha ?? 1) >= 1.5 && (step[0].alpha ?? 1) <= 3, "a puff, not a cloud");
  assert.ok((step[0].life ?? 99) <= 1 && (step[0].fadeOut ?? 0) >= 0.3, "gone in under a second, thinning as it goes");
  // At its densest (a fifth of a second in, where the puff's ball reaches a quarter of its cell above its middle) its top
  // stays under the shin of the smallest figure (a Pawn stands about 0.78), at the largest step scale.
  const at = 0.2, scale = 1.3;
  const top = step[0].size * scale * (1 + (step[0].growth ?? 0) * at) * 0.25 + (step[0].rise ?? 0) * at;
  assert.ok(top < 0.2, `step dust top ${top.toFixed(3)}`);
  // They lie within a fifth of a unit of the stone: a long board fade would fade the sheet itself away.
  for (const id of ["fallDust", "stepDust"] as const) for (const part of VFX_RECIPES[id]) assert.ok((part.soft ?? 0) <= 0.06, `${id} board fade`);
  // The mist darkens: alpha-blended, and darker than any stone it lies on.
  for (const part of VFX_RECIPES.solforizMist) assert.ok((part.additive ?? 0) === 0 && Math.max(...part.tint) <= 0.08, "mist is dark");
  // Every sprite that can touch the stone fades into it instead of being cut by it.
  for (const [id, parts] of Object.entries(VFX_RECIPES)) for (const part of parts) assert.ok((part.soft ?? 0) > 0, `${id} has a board fade`);
});

test("dust takes its shade from the stone under it: darker over a pale square, pale over a dark one", () => {
  const TILE = 1.02;
  // Every square agrees with the board's own colouring (board.ts isLightSquare: a1 dark, a2 light, b1 light).
  for (let file = 0; file < 8; file += 1) for (let rank = 1; rank <= 8; rank += 1) {
    const x = (file - 3.5) * TILE, z = (3.5 - (rank - 1)) * TILE, light = (file + rank) % 2 === 0;
    for (const [dx, dz] of [[0, 0], [0.45, 0.45], [-0.45, 0.3]]) assert.equal(stoneUnder(x + dx, z + dz, TILE), light ? "light" : "dark", `${"abcdefgh"[file]}${rank}`);
  }
  // Off the board (its frame, the hall): no stone, and the dust keeps its own cream.
  assert.equal(stoneUnder(4.5 * TILE, 0, TILE), null);
  assert.equal(stoneUnder(0, -4.3 * TILE, TILE), null);
  assert.equal(dustShade("stepDust", null), null);
  // Fall and step dust take the shade; nothing else does. A footfall's puff is darker over pale stone: unlit, in the fall
  // dust's grey it was as bright as the lit marble under it.
  assert.deepEqual(dustShade("fallDust", "light"), DUST_SHADE.light);
  assert.deepEqual(dustShade("fallDust", "dark"), DUST_SHADE.dark);
  assert.deepEqual(dustShade("stepDust", "light"), STEP_DUST_SHADE.light);
  assert.deepEqual(dustShade("stepDust", "dark"), DUST_SHADE.dark);
  for (let c = 0; c < 3; c += 1) assert.ok(STEP_DUST_SHADE.light[c] < DUST_SHADE.light[c], "darker over pale stone than the fall dust");
  for (const recipe of Object.keys(VFX_RECIPES) as VfxRecipeId[]) if (recipe !== "fallDust" && recipe !== "stepDust") assert.equal(dustShade(recipe, "light"), null, recipe);
  // Over pale marble the cream had no contrast: there it is a darker, still warm grey; over dark stone a pale cream.
  for (const [recipe, shades] of [["fallDust", DUST_SHADE], ["stepDust", STEP_DUST_SHADE]] as const) {
    const cream = VFX_RECIPES[recipe][0].tint;
    const over = (stone: "light" | "dark") => cream.map((value, channel) => value * shades[stone][channel]);
    assert.ok(Math.max(...over("light")) < 0.45 && Math.min(...over("dark")) > 0.55, `${recipe}: ${over("light")} / ${over("dark")}`);
    for (const stone of ["light", "dark"] as const) { const [r, g, b] = over(stone); assert.ok(r >= g && g >= b, `${recipe}: ${stone} dust stays warm`); }
  }
});

test("the arcane burst's core cannot clip to white", () => {
  const sum = [0, 0, 0];
  for (const part of VFX_RECIPES.arcaneBurst) part.tint.forEach((value, channel) => { sum[channel] += value * (part.alpha ?? 1); });
  // Blue leads; red and green together stay well under it, so the stacked core is violet-blue, not white.
  assert.ok(sum[2] <= 1.3, `blue ${sum[2]}`);
  assert.ok(sum[0] < 0.5 && sum[1] < 0.5, `red ${sum[0]} green ${sum[1]}`);
  for (const part of VFX_RECIPES.arcaneBurst) assert.ok(Math.max(...part.tint) <= 1, "no tint feeds bloom past 1");
});

test("dust never stands between the duel camera and the point the blow goes in", () => {
  const eye = { x: 0, y: 1.2, z: 4 }, contact = { x: 0, y: 0.6, z: 0 };
  // On the sight line, in front of the contact.
  assert.equal(hidesContact(eye, contact, { x: 0, y: 0, z: 1.2 }, 1.4), true);
  // A small puff at a foot is under a sight line to the torso: it stays. The same puff in front of a low wound does not.
  assert.equal(hidesContact(eye, contact, { x: 0.05, y: 0, z: 0.4 }, 0.5), false);
  assert.equal(hidesContact({ x: 0, y: 0.5, z: 2.5 }, { x: 0, y: 0.25, z: 0 }, { x: 0.05, y: 0, z: 0.5 }, 0.5), true);
  // Off to the side, behind the camera, or well beyond the contact: clear.
  assert.equal(hidesContact(eye, contact, { x: 1.2, y: 0, z: 0.8 }, 0.5), false);
  assert.equal(hidesContact(eye, contact, { x: 0, y: 0, z: 5 }, 0.5), false);
  assert.equal(hidesContact(eye, contact, { x: 0, y: 0, z: -0.8 }, 0.5), false);
  // A step puff at a foot beside the bodies, seen from the side: clear.
  assert.equal(hidesContact({ x: 3, y: 1, z: 0 }, contact, { x: -0.1, y: 0, z: 0.5 }, 0.5), false);
  assert.equal(hidesContact(eye, eye, eye, 1), false);
});

test("effects are seated behind a figure (or in front of it) along the camera's line on the floor", () => {
  const eye = { x: 0, y: 3, z: 5 };
  const behind = seatFromEye({ x: 0, y: 0, z: 1 }, eye, 0.3);
  assert.deepEqual(behind, { x: 0, y: 0, z: 0.7 });
  const front = seatFromEye({ x: 0, y: 0, z: 1 }, eye, -0.28);
  assert.ok(Math.abs(front.z - 1.28) < 1e-9 && front.y === 0);
  const side = seatFromEye({ x: 3, y: 0, z: 5 }, eye, 0.5);
  assert.ok(Math.abs(side.x - 3.5) < 1e-9 && side.z === 5);
  // Straight under the camera there is no direction: left where it is.
  assert.deepEqual(seatFromEye({ x: 0, y: 0, z: 5 }, eye, 0.3), { x: 0, y: 0, z: 5 });
});

test("smoke and dust are seated in the arena's light: full at the baked exposure, dimmer in a dark arena pushed bright", () => {
  assert.equal(vfxLight(1), 1);
  assert.equal(vfxLight(2.5), 1);
  // The baked battlefields run at about 5: dust comes down to the stone's level, never to nothing.
  assert.ok(Math.abs(vfxLight(5) - 0.5) < 1e-9);
  assert.equal(vfxLight(50), 0.22);
  assert.equal(vfxLight(0), 1);
  // Powder smoke keeps more of its white; the mist is brought down with the dust, so it stays dark.
  assert.ok(vfxLight(5, "musket") > vfxLight(5, "fall") && vfxLight(5, "musket") < 1);
  assert.equal(vfxLight(5, "mist"), vfxLight(5, "fall"));
  // Fire is brought down too, or its core clips to white at a high exposure; as baked at exposure 1.
  assert.equal(vfxGlow(1), 1);
  assert.ok(Math.abs(vfxGlow(5) - 0.35) < 1e-9);
  assert.equal(vfxGlow(0), 1);
  for (const moment of MOMENTS) assert.equal(vfxLight(1, moment), 1, moment);
});
