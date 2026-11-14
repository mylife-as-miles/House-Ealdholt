import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SPELL_LOOK, spellLookFor, type SpellLook } from "../../web/src/scene/spellLook";
import { VFX_RECIPES } from "../../web/src/scene/vfx/library";
import {
  MIST_ARMY,
  SPELL_BURST,
  SPELL_BURST_COLOUR,
  VFX_GLOW_EXPOSURE,
  burstCore,
  vfxCue,
  type VfxArmy,
  type VfxFlags,
} from "../../web/src/scene/vfx/wiring";
import { ARMY_KINGDOMS } from "./match";

const ARMIES: VfxArmy[] = ["ivory", "sun", "empire", "kwind"];
const SIDES = ["w", "b"] as const;
const FLAGS: VfxFlags = { quality: "high", reducedMotion: false, tactical: false, menuBoard: false };

/** A 0xrrggbb colour as red, green and blue from 0 to 1, as the eye is shown it (sRGB). */
const shown = (hex: number): [number, number, number] => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
/** Linear light as the screen shows it: brought to full brightness, then sRGB-encoded. Hue is compared there. */
const screen = (rgb: readonly number[]): [number, number, number] => {
  const max = Math.max(...rgb);
  const encode = (value: number) => { const c = value / max; return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  return [encode(rgb[0]), encode(rgb[1]), encode(rgb[2])];
};
/** Hue in degrees, 0 to 360. */
const hue = ([r, g, b]: readonly number[]): number => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  assert.ok(max - min > 1e-6, "a grey has no hue");
  const h = max === r ? (g - b) / (max - min) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
};
/** How far apart two hues are, 0 to 180. */
const apart = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** How much colour there is: 0 grey or white, 1 pure. */
const saturation = ([r, g, b]: readonly number[]) => { const max = Math.max(r, g, b); return max > 0 ? (max - Math.min(r, g, b)) / max : 0; };
const within = (value: number, low: number, high: number, what: string) => assert.ok(value >= low && value <= high, `${what}: ${value.toFixed(1)} is outside ${low} to ${high}`);

test("every army has a spell look, and the armies are the game's four", () => {
  assert.deepEqual(Object.keys(SPELL_LOOK).sort(), [...ARMIES].sort());
  assert.deepEqual(Object.keys(ARMY_KINGDOMS).sort(), [...ARMIES].sort());
  for (const army of ARMIES) for (const key of ["core", "flame", "ember", "light", "smoke"] as const) {
    const value = SPELL_LOOK[army][key];
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffff, `${army}.${key}`);
  }
});

test("Solforiz throws a small sun: a gold core, a red-orange edge, orange motes and light", () => {
  const sun = SPELL_LOOK.sun;
  within(hue(shown(sun.core)), 35, 55, "core, gold");
  within(hue(shown(sun.flame)), 0, 22, "flame, red-orange");
  within(hue(shown(sun.ember)), 20, 40, "ember, orange");
  within(hue(shown(sun.light)), 10, 35, "light, orange");
  // The edge is redder than the heart, so the ball runs gold to orange to red-orange outwards.
  assert.ok(hue(shown(sun.flame)) < hue(shown(sun.ember)) && hue(shown(sun.ember)) < hue(shown(sun.core)));
  assert.ok(saturation(shown(sun.core)) > 0.5, "the core is gold, not white");
});

test("Aethelgard burns pale cyan-white, Kwind-09 electric blue-violet, Korvenia arcane violet", () => {
  const ivory = SPELL_LOOK.ivory, kwind = SPELL_LOOK.kwind, empire = SPELL_LOOK.empire;
  for (const key of ["flame", "ember", "light"] as const) {
    within(hue(shown(ivory[key])), 180, 205, `Aethelgard ${key}, cyan`);
    within(hue(shown(kwind[key])), 238, 258, `Kwind-09 ${key}, blue-violet`);
    within(hue(shown(empire[key])), 262, 285, `Korvenia ${key}, violet`);
  }
  // Pale: the witchfire's core is all but white and its envelope is a light cyan, not a saturated blue.
  assert.ok(saturation(shown(ivory.core)) < 0.15);
  assert.ok(Math.min(...shown(ivory.flame)) > 0.15, "a pale cyan keeps some red");
  // Electric: the arc's envelope is a hard, saturated blue-violet.
  assert.ok(saturation(shown(kwind.flame)) > 0.7 && saturation(shown(kwind.flame)) > 2 * saturation(shown(ivory.flame)) - 0.3);
  // The three cold magics are told apart by hue.
  assert.ok(apart(hue(shown(ivory.flame)), hue(shown(kwind.flame))) > 35);
  assert.ok(apart(hue(shown(kwind.flame)), hue(shown(empire.flame))) > 12);
});

test("the same army looks the same on White and on Black, and each side takes its own army's look", () => {
  for (const army of ARMIES) for (const other of ARMIES) {
    const asWhite = spellLookFor({ w: army, b: other }, "w"), asBlack = spellLookFor({ w: other, b: army }, "b");
    assert.equal(asWhite, SPELL_LOOK[army]);
    assert.equal(asBlack, asWhite, `${army} as White and as Black`);
    assert.equal(spellLookFor({ w: army, b: other }, "b"), SPELL_LOOK[other]);
  }
  // The burst is asked for by army alone: there is no side in the question.
  for (const army of ARMIES) {
    const first = { ...vfxCue("spell", FLAGS, { army, power: 1 })! }, second = { ...vfxCue("spell", FLAGS, { army, power: 1 })! };
    assert.deepEqual(first, second);
  }
});

test("for every army the burst agrees with the orb that broke: recipe, colour and core", () => {
  for (const army of ARMIES) {
    const look: SpellLook = SPELL_LOOK[army];
    const cue = { ...vfxCue("spell", FLAGS, { army, power: 1 })! };
    assert.equal(cue.recipe, SPELL_BURST[army]);
    assert.equal(cue.colour, SPELL_BURST_COLOUR[army]);
    const warm = hue(shown(look.flame)) < 60;
    if (warm) {
      // Fire: the flame frames keep their own colours, which are the sun's.
      assert.equal(army, "sun");
      assert.equal(cue.recipe, "spellBurst");
      assert.equal(cue.colour, null);
      for (const part of VFX_RECIPES.spellBurst) {
        assert.ok(!part.mono, "the fire is not reduced to brightness");
        // The recipe's tint is all but neutral and never cold: red is its strongest channel.
        assert.ok(part.tint[0] >= part.tint[1] && part.tint[1] >= part.tint[2] && part.tint[2] >= 0.6);
      }
    } else {
      // Arcane: light with no colour of its own, so the colour it is given is its colour, and it is the orb's.
      assert.equal(cue.recipe, "arcaneBurst");
      for (const part of VFX_RECIPES.arcaneBurst) assert.equal(part.mono, 1);
      const colour = cue.colour!;
      assert.equal(Math.max(...colour), 1, `${army}: the colour is given at full brightness`);
      for (const key of ["flame", "light"] as const) assert.ok(apart(hue(screen(colour)), hue(shown(look[key]))) <= 12, `${army} burst hue ${hue(screen(colour)).toFixed(0)} against its orb's ${key} ${hue(shown(look[key])).toFixed(0)}`);
      // Where the layers stack it cannot clip to white, and it is still the same colour there.
      const core = burstCore(cue.recipe, colour);
      assert.ok(Math.max(...core) <= 1.3, `${army} core ${core}`);
      // A dark arena draws it up to VFX_GLOW_EXPOSURE times brighter: its weakest channel still stays well short of white.
      assert.ok(Math.min(...core) * VFX_GLOW_EXPOSURE <= 0.65, `${army} core at a high exposure ${core}`);
      assert.ok(Math.abs(hue(screen(core)) - hue(screen(colour))) < 1e-6);
      // The low preset and the menu's board drop the last flare: every layer has the one hue, so nothing changes.
      for (const flags of [{ ...FLAGS, quality: "low" as const }, { ...FLAGS, menuBoard: true }]) assert.equal(vfxCue("spell", flags, { army, power: 1 })!.colour, colour);
    }
  }
  // Uncoloured, the arcane recipe is as it was.
  assert.deepEqual(burstCore("arcaneBurst"), VFX_RECIPES.arcaneBurst.reduce((sum, part) => sum.map((value, c) => value + part.tint[c] * (part.alpha ?? 1)), [0, 0, 0]));
  // Each arcane army has its own colour.
  assert.ok(apart(hue(screen(SPELL_BURST_COLOUR.ivory!)), hue(screen(SPELL_BURST_COLOUR.kwind!))) > 35);
  assert.ok(apart(hue(screen(SPELL_BURST_COLOUR.kwind!)), hue(screen(SPELL_BURST_COLOUR.empire!))) > 12);
  // Pale cyan keeps its red; the arc and the violet are hard colours.
  assert.ok(SPELL_BURST_COLOUR.ivory![1] > 0.75 && SPELL_BURST_COLOUR.ivory![0] > 0.2 && SPELL_BURST_COLOUR.kwind![1] < 0.2 && SPELL_BURST_COLOUR.empire![1] < 0.2);
  // Only Solforiz stands in mist, and it is the army that bursts into fire.
  assert.equal(SPELL_BURST[MIST_ARMY], "spellBurst");
  // Other moments carry no army colour.
  assert.equal(vfxCue("fall", FLAGS)!.colour, null);
  assert.equal(vfxCue("slam", FLAGS, { army: "ivory", power: 1, source: "melee" })!.colour, null);
});

test("the scene looks a spell up by the caster's army, never by its side", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const engine = read("../../web/src/scene/sceneEngine.ts"), spells = read("../../web/src/scene/spells.ts"), look = read("../../web/src/scene/spellLook.ts");
  // No lookup by side is left anywhere, and the table is not keyed by side.
  assert.doesNotMatch(engine, /SPELL_LOOK\s*\[/);
  assert.doesNotMatch(engine, /spellLookFor\([^)]*\)\s*;?[^\n]*\.color\]/);
  assert.match(look, /SPELL_LOOK: Readonly<Record<VfxArmy, SpellLook>>/);
  assert.doesNotMatch(look + spells, /Record<Faction, SpellLook>/);
  // One way in: the army each side musters, then that side.
  assert.match(engine, /private spellLook\(caster: PieceView\): SpellLook \{\s*return spellLookFor\(this\.factory\.getSkins\(\), caster\.color\);\s*\}/);
  assert.match(engine, /private spellArmy\(caster: PieceView\): ArmySkinId \{\s*return this\.factory\.getSkins\(\)\[caster\.color\];\s*\}/);
  const body = (start: string, end: string) => { const from = engine.indexOf(start); assert.ok(from >= 0, start); const to = engine.indexOf(end, from + start.length); assert.ok(to > from, end); return engine.slice(from, to); };
  // The gather, the bolt and the burst each take their look from the caster.
  const gather = body("private async gatherSpell(", "private async throwFireball(");
  const bolt = body("private async throwFireball(", "private spellBurst(");
  const burst = body("private spellBurst(", "this.shake.add(Math.min(1, 0.6 * scale));\n\n    if (ring > 0)");
  const ring = body("if (ring > 0) {\n      // Fire thrown out flat", "\n  }\n");
  for (const [name, text] of [["gatherSpell", gather], ["throwFireball", bolt]] as const) {
    assert.match(text, /const look = this\.spellLook\(attacker\);/, name);
    assert.match(text, /new SpellOrb\(look, size, [^\n]*this\.spellLights\.acquire\(look\.light, 4\.6\), this\.spellGlow\(\)\)/, name);
    assert.match(text, /spawnBurst\([^,]+, look\.ember,/, name);
  }
  assert.match(bolt, /color: look\.smoke/);
  assert.match(burst, /const army = this\.spellArmy\(caster\);\s*const look = this\.spellLook\(caster\);/);
  assert.match(burst, /this\.strikeImpact\(square, [^\n]*, this\.spellTone\(look\.light\), look\.ember, this\.spellTone\(look\.core\)\)/);
  // A library spell draws its own blow: the match only jolts the stone under it (no ring, no flare, no flash, sparks or
  // shake of its own), and the plain bolt's strike is played after it has returned.
  const drawn = body("    if (drawn) {\n      // A library spell draws its own blow", "      return;\n    }");
  assert.match(drawn, /this\.board\.impact\(square, [^\n]*, 0, 0\);/);
  assert.doesNotMatch(drawn, /this\.strikeImpact|this\.effects\.|this\.shake/);
  assert.ok(burst.indexOf("this.strikeImpact(") > burst.indexOf("    if (drawn) {"), "the plain bolt strikes after the library branch");
  assert.match(burst, /this\.playVfx\("spell", this\.onStone\(at\), this\.vfxFor\(scale, army\)/);
  assert.match(burst, /color: look\.smoke/);
  assert.match(burst, /this\.effects\.spawnFlash\(at, [^\n]*, look\.core\);/);
  assert.match(bolt, /this\.effects\.spawnFlash\(aim, 1\.5, 0\.2, look\.core\);/);
  assert.match(ring, /color: this\.spellTone\(look\.flame\)/);
  // Nothing in the spell is drawn in a side's colour.
  for (const text of [gather, bolt, burst, ring]) assert.doesNotMatch(text, /FACTION_ACCENT|\.color\]/);
  // The burst's army tint reaches the flipbook.
  assert.match(body("private playVfx(", "vfx.play(cue.recipe, point, options);"), /options\.colour = cue\.colour \? this\.vfxColour\.setRGB\(cue\.colour\[0\], cue\.colour\[1\], cue\.colour\[2\]\) : undefined;/);
});
