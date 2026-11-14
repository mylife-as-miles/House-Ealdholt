/**
 * What a kill throws (web/src/scene/vfx/flourish/shardPlan.ts, drawn by sparks.ts and chips.ts), each kingdom's flourish
 * colours and the budgets (flourishPlan.ts), and when flourishes are drawn at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FLOURISH_BUDGET, FLOURISH_LOOK, KEPT_FAMILY, flourishAllowed, hue, keptLook, saturation, withHue } from "../../web/src/scene/vfx/flourish/flourishPlan";
import { KINGDOM_ACCENT, blowAccent } from "../../web/src/scene/moments/momentPlan";
import { SHATTER, SMEAR, SPARK_KIND, blankShard, curl, planFlare, planShatter, planSmear, shardFade, smearsDue, type ShardSpec } from "../../web/src/scene/vfx/flourish/shardPlan";
import { sequence } from "../../web/src/scene/vfx/spells/shared/particlePlan";
import { SPELL_LOOK } from "../../web/src/scene/spellLook";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../web/src/scene/${path}`, import.meta.url)), "utf8");
const ARMIES = ["sun", "ivory", "kwind", "empire"] as const;

test("the wind is the curl of a field: it swirls without bunching up or thinning out, and stays gentle", () => {
  const h = 1e-4;
  for (let i = 0; i < 60; i += 1) {
    const x = Math.sin(i * 1.7) * 3, y = Math.cos(i * 0.9) * 1.5 + 0.8, z = Math.sin(i * 2.3 + 1) * 3, t = i * 0.37;
    const dx = (curl(x + h, y, z, t).x - curl(x - h, y, z, t).x) / (2 * h);
    const dy = (curl(x, y + h, z, t).y - curl(x, y - h, z, t).y) / (2 * h);
    const dz = (curl(x, y, z + h, t).z - curl(x, y, z - h, t).z) / (2 * h);
    assert.ok(Math.abs(dx + dy + dz) < 1e-5, `divergence-free at sample ${i} (${(dx + dy + dz).toExponential(2)})`);
    const v = curl(x, y, z, t);
    assert.ok(Math.hypot(v.x, v.y, v.z) < 6, "bounded");
  }
  // the GLSL in sparks.ts and chips.ts is this field
  for (const file of ["vfx/flourish/sparks.ts", "vfx/flourish/chips.ts"]) assert.match(source(file), /\$\{CURL_GLSL\}/);
});

function shatter(seed: number, army: (typeof ARMIES)[number] = "sun", power = 1) {
  const out: ShardSpec[] = [];
  const made = planShatter({
    at: { x: 1, y: 0.5, z: -1 }, floor: { x: 1, y: 0, z: -1 }, direction: { x: 0, y: 0, z: -2 }, power,
    flakes: FLOURISH_BUDGET.medium.flakes, chips: FLOURISH_BUDGET.medium.chips, look: FLOURISH_LOOK[army],
  }, sequence(seed), (spec) => out.push({ ...spec }), blankShard());
  return { made, out };
}

test("a kill throws glinting flakes along the blow and dark chips up from the stone, the same for the same seed", () => {
  const a = shatter(42), b = shatter(42), c = shatter(43);
  assert.deepEqual(a.out, b.out);
  assert.notDeepEqual(a.out.slice(0, 3), c.out.slice(0, 3));
  const flakes = a.out.filter((s) => s.kind === SPARK_KIND.flake), chips = a.out.filter((s) => s.kind === SPARK_KIND.chip);
  assert.equal(a.made, a.out.length);
  assert.equal(flakes.length, FLOURISH_BUDGET.medium.flakes);
  assert.equal(chips.length, FLOURISH_BUDGET.medium.chips);
  // flakes leave the wound and are thrown on along the blow (-z), held by the air, and they turn
  const along = flakes.reduce((sum, s) => sum + s.vz, 0) / flakes.length;
  assert.ok(along < -0.5, `on along the blow (${along.toFixed(2)})`);
  for (const s of flakes) {
    assert.ok(Math.hypot(s.x - 1, s.y - 0.5, s.z + 1) < 0.12, "from the wound");
    assert.ok(s.drag >= 2.5 && s.gravity > 0 && s.gravity < 1, "held by the air: they hang and drift down");
    assert.ok(s.wander > 0, "carried by the wind");
    assert.ok(Math.abs(s.spin) >= 4, "turning, so they catch the light");
    assert.ok([FLOURISH_LOOK.sun.flake, FLOURISH_LOOK.sun.flakeAccent].includes(s.colour), "in the killer's colours");
  }
  assert.ok(flakes.some((s) => s.colour === FLOURISH_LOOK.sun.flakeAccent) && flakes.some((s) => s.colour === FLOURISH_LOOK.sun.flake), "both of its metals");
  // chips are torn up from the stone round the feet, climb, and are dark with the blow's light on their edges
  for (const s of chips) {
    assert.ok(Math.abs(s.y - 0.03) < 1e-9 && Math.hypot(s.x - 1, s.z + 1) <= 0.31, "off the stone under the victim");
    assert.ok(s.vy > 0.8 && s.vy < 2.2, "thrown up, not over the body's head");
    assert.equal(s.colour, FLOURISH_LOOK.sun.chip); assert.equal(s.edge, FLOURISH_LOOK.sun.chipEdge);
    assert.ok(s.size >= 0.01 && s.size <= 0.035, "chips, not rocks: the duel camera is close");
  }
  // everything a kill throws is gone well before the Claiming's beat
  for (const s of a.out) assert.ok(s.delay + s.life <= SHATTER.longest, `gone by ${SHATTER.longest} s`);
  // a Queen's blow throws more
  assert.ok(shatter(42, "sun", 1.75).made > a.made);
  // given the eye, none is thrown toward it, across the body
  const seen: ShardSpec[] = [];
  planShatter({ at: { x: 0, y: 0.5, z: 0 }, floor: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, away: { x: 0, z: -3 }, power: 1.4,
    flakes: 40, chips: 30, look: FLOURISH_LOOK.ivory }, sequence(11), (s) => seen.push({ ...s }), blankShard());
  for (const s of seen) assert.ok(s.vz <= 0.05 * Math.hypot(s.vx, s.vz) + 1e-9, `nothing toward the eye (${s.vx.toFixed(2)}, ${s.vz.toFixed(2)})`);
});

test("a flake or a chip comes up at once and goes smoothly: none pops in or out", () => {
  assert.equal(shardFade(0), 0); assert.equal(shardFade(1), 0);
  assert.ok(shardFade(0.003) < 0.01 && shardFade(0.997) < 0.01, "near nothing at either end");
  assert.ok(shardFade(0.3) > 0.99, "held whole between");
  let last = 0;
  for (let u = 0; u <= 1; u += 0.002) { const now = shardFade(u); assert.ok(Math.abs(now - last) < 0.06, `no jump at ${u.toFixed(3)}`); last = now; }
  // the shaders evaluate the same curve
  for (const file of ["vfx/flourish/sparks.ts"]) assert.match(source(file), /leave = 1\.0 - max\(0\.0, \(u - 0\.6\) \/ 0\.4\)/);
});

test("each kingdom's flourish is in its own colours: a white-hot heart, its spell's hue at the edge, deep at the side", () => {
  for (const army of ARMIES) {
    const look = FLOURISH_LOOK[army], spell = SPELL_LOOK[army];
    assert.ok(saturation(look.core) < 0.2, `${army}: the heart is near white`);
    assert.ok(saturation(look.edge) > 0.5 && saturation(look.deep) > 0.8, `${army}: saturated edge and depth (Aethelgard's witchfire is the palest)`);
    const gap = Math.abs(((hue(look.edge) - hue(spell.flame) + 540) % 360) - 180);
    assert.ok(gap < 16, `${army}: the edge is the spell's own hue (${hue(look.edge).toFixed(0)} against ${hue(spell.flame).toFixed(0)})`);
    assert.ok(saturation(look.chip) < 0.5 && Math.max((look.chip >> 16) & 255, (look.chip >> 8) & 255, look.chip & 255) < 80, `${army}: chips are dark stone`);
  }
  // no two kingdoms share an edge colour's hue
  for (let i = 0; i < ARMIES.length; i += 1) for (let j = i + 1; j < ARMIES.length; j += 1) {
    const gap = Math.abs(((hue(FLOURISH_LOOK[ARMIES[i]].edge) - hue(FLOURISH_LOOK[ARMIES[j]].edge) + 540) % 360) - 180);
    assert.ok(gap > 25, `${ARMIES[i]} and ${ARMIES[j]} are told apart (${gap.toFixed(0)} degrees)`);
  }
});

test("a blow's flourishes keep their colour on the hue its black and white keeps, so they burn through it, never grey", () => {
  const value = (hex: number) => Math.max((hex >> 16) & 255, (hex >> 8) & 255, hex & 255);
  const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  // a colour turned to a hue keeps its saturation and value
  for (const hex of [0xff7a1c, 0x2a7cf0, 0x7c62ff, 0xc458ff, 0xdaf6ff]) for (const to of [0, 18, 33, 190, 202, 253, 278]) {
    const turned = withHue(hex, to);
    assert.ok(turn(hue(turned), to) < 1.5, `${hex.toString(16)} to ${to}: ${hue(turned).toFixed(1)}`);
    assert.ok(Math.abs(saturation(turned) - saturation(hex)) < 0.02 && Math.abs(value(turned) - value(hex)) <= 1);
  }
  const SIDES = ["w", "b"] as const;
  for (const attacker of ARMIES) {
    // the kingdom's own colours are of its accent's family, whatever the accent is moved to
    for (const name of ["edge", "deep", "flake", "chipEdge"] as const) assert.ok(turn(hue(FLOURISH_LOOK[attacker][name]), KINGDOM_ACCENT[attacker].hue * 360) < KEPT_FAMILY - 16, `${attacker} ${name}`);
    for (const victim of ARMIES) for (const side of SIDES) {
      const accent = blowAccent(attacker, victim, side), at = accent.hue * 360, look = FLOURISH_LOOK[attacker], kept = keptLook(look, accent.hue);
      for (const name of ["edge", "deep", "flake", "chipEdge"] as const) {
        // inside the band the black and white keeps whole (moments/momentShader.ts moNear: a third of its half-width)
        assert.ok(turn(hue(kept[name]), at) <= Math.max(1.5, accent.width * 360 * 0.35), `${attacker} on ${victim} (${side}): ${name} ${hue(kept[name]).toFixed(1)} against ${at.toFixed(1)}`);
        assert.ok(Math.abs(saturation(kept[name]) - saturation(look[name])) < 0.02, "as saturated as the kingdom's own");
      }
      // the white-hot heart and the dark stone are left alone, and so is a second metal
      assert.equal(kept.core, look.core); assert.equal(kept.chip, look.chip);
      if (attacker === "kwind" || attacker === "empire") assert.equal(kept.flakeAccent, look.flakeAccent, `${attacker}'s second metal`);
    }
  }
  assert.equal(keptLook(FLOURISH_LOOK.sun, Number.NaN), FLOURISH_LOOK.sun);
  // the engine works the hue out from the very armies and side the blow's moment does, and gives it to every flourish of
  // the blow: the killing swing's arc (traced before the blow) and the giant's, the summons' slashes, the sigils, the fire,
  // the shards
  const engine = source("sceneEngine.ts");
  assert.match(engine, /private blowHue\(attacker: PieceView, victim: PieceView\): number \{\n\s+return blowAccent\(this\.spellArmy\(attacker\), this\.spellArmy\(victim\), victim\.color, this\.blowPalette\(attacker, victim\)\)\.hue;/);
  // and a spell's or a summon's own colours reach the moment's band and the flourishes' alike (the sun's gold core)
  assert.match(engine, /palette = this\.blowPalette\(attacker, victim\);\n\s+this\.moments\.blow\(/);
  assert.match(engine, /attackerArmy: skins\[attacker\.color\], victimArmy: skins\[victim\.color\], victimSide: victim\.color,/);
  assert.match(engine, /private spellArmy\(caster: PieceView\): ArmySkinId \{\n\s+return this\.factory\.getSkins\(\)\[caster\.color\];/);
  const region = engine.slice(engine.indexOf("  // ------------------------------------------------------------------ flourishes (vfx/flourish)"), engine.indexOf("  // ------------------------------------------------------------------ summons"));
  const blows = region.match(/flourish\.(?:beginArc|slash|shatter|stamp|flare)\([^;]*;/g) ?? [];
  assert.equal(blows.length, 11);
  for (const call of blows) assert.match(call, /(?:\bhue|this\.blowHue\(\w+, victim\))\)(?: \? id : null)?;$/, call);
  assert.match(engine, /this\.traceRiteBlade\(`\$\{revision\}:rite-blade`, lent, entry\.army, attacker, victim\);/);
  // and they hang through the blow's hit-stops (the combat feel's and the moment's): the frame gives them its delta,
  // which carries the stronger of the two; they add none of their own
  const frame = engine.slice(engine.indexOf("  private frame(): void {"), engine.indexOf("  private guardAgainstBlackFrames(): void {"));
  assert.match(frame, /const moment = this\.moments\.advance\(/);
  assert.match(frame, /const hold = this\.combatFeel\.timeScale\(/);
  assert.match(frame, /const delta = played \* \([^;]*\bhold\b[^;]*\bmoment\b[^;]*\);/);
  assert.match(frame, /this\.flourish\?\.update\(delta, /);
  assert.doesNotMatch(source("vfx/flourish/flourish.ts"), /combatFeel|MomentDirector|\.advance\(/);
});

test("budgets grow with the preset, and every pool holds two kills, a sigil's starburst and two arcs' sparks", () => {
  const order = ["low", "medium", "high", "ultra"] as const;
  for (let i = 1; i < order.length; i += 1) {
    const a = FLOURISH_BUDGET[order[i - 1]], b = FLOURISH_BUDGET[order[i]];
    for (const key of ["arcSparks", "sparks", "flakes", "chips", "glyphStreaks", "glyphSparks"] as const) assert.ok(b[key] >= a[key], `${key} ${order[i]}`);
  }
  for (const preset of order) {
    const b = FLOURISH_BUDGET[preset];
    const peak = 2 * Math.round(b.flakes * 1.2) + b.glyphStreaks + b.glyphSparks + 4 * b.arcSparks;
    assert.ok(b.sparks >= peak, `${preset}: ${b.sparks} slots for ${peak}`);
    assert.ok(b.chipPool >= 2 * Math.round(b.chips * 1.25), `${preset}: chips`);
    assert.ok(b.ribbons >= 3 && b.ribbons <= 5, `${preset}: three to five ribbons`);
    assert.ok(b.arcSubdivide >= 1 && b.arcSubdivide <= 6);
  }
});

test("flourishes keep the restraint of reduced motion, the tactical map and the menu's board", () => {
  assert.equal(flourishAllowed({ reducedMotion: false, tactical: false, menuBoard: false }), true);
  assert.equal(flourishAllowed({ reducedMotion: true, tactical: false, menuBoard: false }), false);
  assert.equal(flourishAllowed({ reducedMotion: false, tactical: true, menuBoard: false }), false);
  assert.equal(flourishAllowed({ reducedMotion: false, tactical: false, menuBoard: true }), false);
  const engine = source("sceneEngine.ts");
  const gate = engine.slice(engine.indexOf("  private flourishing(): CombatFlourish | null {"), engine.indexOf("  private traceKillingSwing("));
  for (const flag of ["this.reducedMotion", "this.tactical", "this.menuPresentation", "this.attract", "this.silentBoard()"]) assert.ok(gate.includes(flag), flag);
  // a rebuilt board (Undo, a new game, a new army), the map and reduced motion leave nothing alive
  const rebuild = engine.slice(engine.indexOf("    this.vfx?.clear(); this.vfxDuelVictim = null;"), engine.indexOf("    this.claiming.clear();"));
  assert.match(rebuild, /this\.flourish\?\.clear\(\);/);
  assert.equal((engine.match(/if \(active\) this\.vfx\?\.clear\(\);\n\s+if \(active\) this\.flourish\?\.clear\(\);/g) ?? []).length, 2);
  assert.match(engine, /this\.flourish\?\.setQuality\(preset\);/);
  assert.match(engine, /this\.flourish\?\.dispose\(\); this\.flourish = null;/);
  // the hook a hit-stop sets
  assert.match(source("vfx/flourish/flourish.ts"), /timeScale = 1;/);
});

test("a flourish's dice are the match's own show dice, so a replay draws the same; what it is never comes from dice", () => {
  const engine = source("sceneEngine.ts");
  assert.match(engine, /private flourishSeed\(salt: string\): number \{\n\s+return Math\.floor\(this\.showDice\(`flourish \$\{salt\}`\)\(\) \* 0x100000000\) >>> 0;/);
  // every flourish the match starts takes its dice there: none from the move list alone, the board's revision or the clock
  const region = engine.slice(engine.indexOf("  // ------------------------------------------------------------------ flourishes (vfx/flourish)"), engine.indexOf("  // ------------------------------------------------------------------ summons"));
  assert.ok(region.length > 1000);
  assert.doesNotMatch(region, /combatSeed\(|Math\.random|flourishSeed\(`/);
  assert.match(region, /seed = this\.flourishSeed\("summon"\)[,;]/);
  const calls = engine.match(/flourish(?:ing\(\))?\??\.(?:beginArc|slash|shatter|stamp|flare|beginGather|beginSmear)\([^;]*;/g) ?? [];
  assert.ok(calls.length >= 16, `${calls.length} calls`);
  for (const call of calls) assert.match(call, /this\.flourishSeed\("[a-z ]+"\)|\bseed\b/, call);
  // and the flourishes throw no dice of their own; how many shards there are is the preset's and the blow's alone
  for (const file of ["flourish.ts", "arcs.ts", "arcPlan.ts", "sparks.ts", "chips.ts", "shardPlan.ts", "sigils.ts", "glyphPlan.ts", "glyphs.ts", "gatherPlan.ts", "gather.ts", "flourishPlan.ts"])
    assert.doesNotMatch(source(`vfx/flourish/${file}`), /Math\.random/, file);
  const counts = [0.6, 1, 1.8].map((power) => shatter(7, "sun", power).made);
  assert.deepEqual(counts, [0.6, 1, 1.8].map((power) => shatter(99, "sun", power).made), "the same blow throws as many shards whatever its dice");
});

test("a fire spell breaks as blades of crystalline fire thrown round and up from behind the body, never toward the eye", () => {
  const out: ShardSpec[] = [];
  // the eye looks along -z: "away" is -z, and the blades start behind the chest
  const made = planFlare({ x: 0, y: 0.6, z: -0.16 }, { x: 0, z: -1 }, FLOURISH_BUDGET.medium.flares, 1, FLOURISH_LOOK.sun, sequence(5), (s) => out.push({ ...s }), blankShard());
  assert.equal(made, out.length);
  assert.ok(made >= FLOURISH_BUDGET.medium.flares * 0.9);
  for (const s of out) {
    assert.equal(s.kind, SPARK_KIND.blade);
    assert.ok(s.vz < 0, "thrown away from the eye, so none crosses in front of the body");
    assert.ok(s.life <= 0.5 && s.drag >= 4.5, "shot out and gone within half a second");
    assert.ok(s.spin >= 2.5 && s.spin <= 8, "how far it reaches, in widths");
    assert.ok([FLOURISH_LOOK.sun.edge, FLOURISH_LOOK.sun.flake].includes(s.colour), "Solforiz's fire and gold");
  }
  assert.ok(out.filter((s) => s.vy > 0).length > out.length * 0.6, "mostly up");
  const sides = new Set(out.map((s) => Math.sign(s.vx)));
  assert.equal(sides.size, 2, "round both sides of the body");
  assert.match(source("sceneEngine.ts"), /if \(army === "sun"\) flourish\.flare\(chest, this\.camera\.position, army, power,/);
});

test("a body smears only when it moves faster than a walk, trailing faint strokes behind it, frame rate or not", () => {
  assert.deepEqual(smearsDue(1.2, 1 / 60, 0), { now: 0, owed: 0 });
  assert.deepEqual(smearsDue(SMEAR.threshold, 1 / 60, 0.5), { now: 0, owed: 0 });
  // written into the caller's own record, so a lunge's frames allocate nothing
  const record = { now: 9, owed: 9 };
  assert.equal(smearsDue(3.2, 1 / 60, 0, record), record);
  assert.ok(record.now >= 0 && record.now <= SMEAR.most && record.owed >= 0 && record.owed <= 1);
  assert.match(source("vfx/flourish/flourish.ts"), /smearsDue\(smear\.velocity\.length\(\), step, smear\.owed, this\.due\)/);
  // the same second sheds the same number of smears at 30 and at 120 frames a second
  const shed = (fps: number) => { let owed = 0, total = 0; for (let i = 0; i < fps; i += 1) { const due = smearsDue(3.2, 1 / fps, owed); total += due.now; owed = due.owed; } return total; };
  assert.ok(Math.abs(shed(30) - shed(120)) <= 1, `${shed(30)} against ${shed(120)}`);
  assert.ok(shed(60) > 20 && shed(60) <= 60 * SMEAR.most);
  const spec = planSmear({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: -3 }, 0xffffff, sequence(3), blankShard());
  assert.equal(spec.kind, SPARK_KIND.streak);
  assert.ok(spec.vz > 0, "it trails behind the body, away from what the body goes for");
  assert.ok(spec.heat < 0.4 && spec.life < 0.25, "faint and brief");
  assert.ok(Math.hypot(spec.x, spec.z) <= SMEAR.radius + 1e-9 && Math.abs(spec.y - 0.5) <= SMEAR.reach + 1e-9, "round the body");
  const engine = source("sceneEngine.ts");
  assert.equal((engine.match(/beginSmear\(`\$\{[^}]+\}:lunge`, out => attacker\.combatPoint\(out\)/g) ?? []).length, 2, "the duel and the plain capture");
  const contact = engine.slice(engine.indexOf("  private meleeContact("), engine.indexOf("  private async passSentence("));
  assert.match(contact, /this\.flourish\?\.endSmear\(\);/);
});
