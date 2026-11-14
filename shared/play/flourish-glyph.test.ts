/**
 * The kingdoms' sigils (web/src/scene/vfx/flourish/sigils.ts) and the glyph a spell or a summon stamps with one
 * (glyphPlan.ts, drawn by glyphs.ts): what each mark may and may not be, its clock, where it stands, its starburst.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GLYPH, glyphCentre, glyphEnvelope, packSigil, planStarburst, sigilReach } from "../../web/src/scene/vfx/flourish/glyphPlan";
import { FLOURISH_BUDGET, FLOURISH_LOOK } from "../../web/src/scene/vfx/flourish/flourishPlan";
import { SPARK_KIND, blankShard, type ShardSpec } from "../../web/src/scene/vfx/flourish/shardPlan";
import { SIGILS, lineCrossing, strokePoints, type LineStroke } from "../../web/src/scene/vfx/flourish/sigils";
import { sequence } from "../../web/src/scene/vfx/spells/shared/particlePlan";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../web/src/scene/${path}`, import.meta.url)), "utf8");
const ARMIES = ["ivory", "sun", "empire", "kwind"] as const;
const lines = (army: (typeof ARMIES)[number]) => SIGILS[army].strokes.filter((s): s is LineStroke => s.kind === "line");

test("every sigil is a mark of its own, drawn within its disc in the order a hand would strike it", () => {
  const names = new Set(ARMIES.map((army) => SIGILS[army].name));
  assert.equal(names.size, 4);
  for (const army of ARMIES) {
    const sigil = SIGILS[army];
    assert.ok(sigil.strokes.length >= 12 && sigil.strokes.length <= 40, `${army}: ${sigil.strokes.length} strokes`);
    assert.ok(sigilReach(sigil) <= 1.06, `${army}: within its disc (${sigilReach(sigil).toFixed(3)})`);
    for (const stroke of sigil.strokes) {
      assert.ok(stroke.order[0] >= 0 && stroke.order[1] <= 1 && stroke.order[1] > stroke.order[0], `${army}: a pen run in 0..1`);
      assert.ok(stroke.width > 0.01 && stroke.width < 0.1, `${army}: a stroke's width`);
      for (const [x, y] of strokePoints(stroke)) assert.ok(Number.isFinite(x + y));
    }
    // the pen starts at once and finishes the mark
    assert.equal(Math.min(...sigil.strokes.map((s) => s.order[0])), 0);
    assert.ok(Math.max(...sigil.strokes.map((s) => s.order[1])) >= 0.9);
  }
});

test("no sigil is any faith's symbol: no two straight strokes cross anywhere in it, and none has a lozenge or a crescent", () => {
  for (const army of ARMIES) {
    const straight = lines(army);
    for (let i = 0; i < straight.length; i += 1) for (let j = i + 1; j < straight.length; j += 1)
      assert.equal(lineCrossing(straight[i], straight[j]), null, `${army}: strokes ${i} and ${j} cross`);
    // no closed figure of four straight sides (a lozenge, a square): Korvenia's hex brand is a cog round a lozenge
    const key = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const next = new Map<string, Set<string>>();
    for (const s of straight) {
      const a = key(s.a), b = key(s.b);
      if (!next.has(a)) next.set(a, new Set()); if (!next.has(b)) next.set(b, new Set());
      next.get(a)!.add(b); next.get(b)!.add(a);
    }
    for (const [a, around] of next) for (const b of around) for (const c of next.get(b) ?? []) if (c !== a) for (const d of next.get(c) ?? [])
      if (d !== b && d !== a && next.get(d)?.has(a)) assert.fail(`${army}: a four-sided figure at ${a}`);
    // an arc is a ring, a bead or an orbit, never a crescent: every circular arc but a full ring keeps to one circle's rim
    for (const stroke of SIGILS[army].strokes) if (stroke.kind === "arc") assert.ok(stroke.width < Math.max(stroke.r[0], stroke.r[1]) || stroke.r[0] === 0, `${army}: a thin arc or a dot`);
  }
  // the brand itself is not a sigil
  const brand = source("vfx/scorchPlan.ts");
  assert.match(brand, /hex/);
  for (const army of ARMIES) assert.doesNotMatch(SIGILS[army].name, /cog|gear|lozenge|cross|star|crescent/i);
});

test("nothing rises straight up out of the sigil's heart: it stands behind the victim's head, and a spike there is a horn", () => {
  for (const army of ARMIES) for (const s of lines(army)) {
    const [x0, y0] = s.a, [x1, y1] = s.b;
    const upright = Math.abs(x1 - x0) < 0.02 && Math.abs(x0) < 0.05;
    assert.ok(!(upright && Math.max(y0, y1) > 0.3), `${army}: an upright stroke over the heart (${s.a} to ${s.b})`);
  }
});

test("the glyph is stamped, flashes, holds and burns away in about two thirds of a second", () => {
  const at = (t: number) => ({ ...glyphEnvelope(t) });
  assert.equal(at(-1).glow, 0);
  assert.ok(at(0.02).pen > 0.3 && at(0.02).pen < 1, "the pen is striking it");
  assert.ok(at(GLYPH.draw).pen > 0.999, "the whole mark is struck by the end of its draw");
  const peak = at(GLYPH.flashPeak).flash;
  assert.ok(peak > 0.99 && at(0.25).flash < 0.3, "the flash comes and goes at once");
  assert.ok(at(0.15).glow > 0.9 && at(0.15).burn === 0, "held whole");
  const life = GLYPH.hold + GLYPH.burn;
  assert.ok(life >= 0.5 && life <= 0.75, `a fraction of a second (${life})`);
  assert.equal(at(life).done, true); assert.equal(at(life).glow, 0);
  let burn = 0, scale = 1;
  for (let t = 0; t <= life; t += 0.01) { const e = at(t); assert.ok(e.burn >= burn - 1e-12 && e.scale >= scale - 1e-12); burn = e.burn; scale = e.scale; }
  assert.ok(scale > 1 && scale <= 1 + GLYPH.grow + 1e-9, "it widens a little as it burns away");
});

test("it stands behind the victim, away from the eye, upright and clear of the stone", () => {
  const chest = { x: 1, y: 0.45, z: -1 }, eye = { x: 1, y: 3, z: 4 };
  const at = glyphCentre(chest, eye, GLYPH.radius, 0);
  assert.ok(at.z < chest.z - GLYPH.behind + 1e-9 && Math.abs(at.x - chest.x) < 1e-9, "behind it, along the floor away from the eye");
  assert.ok(at.y - GLYPH.radius * (1 + GLYPH.grow) >= GLYPH.clearance - 1e-9, "its lowest stroke clears the stone, even as it widens");
  const tall = glyphCentre({ x: 0, y: 1.2, z: 0 }, eye, GLYPH.radius, 0);
  assert.equal(tall.y, 1.2, "a tall figure's chest is high enough already");
});

test("its starburst fans out in the sigil's plane, fast and soon stopped, in the kingdom's colours", () => {
  const plane = { centre: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, out: { x: 0, y: 0, z: 1 } };
  const b = FLOURISH_BUDGET.medium, out: ShardSpec[] = [];
  const made = planStarburst(plane, GLYPH.radius, b.glyphStreaks, b.glyphSparks, FLOURISH_LOOK.empire, sequence(9), (s) => out.push({ ...s }), blankShard());
  assert.equal(made, b.glyphStreaks + b.glyphSparks);
  const streaks = out.filter((s) => s.kind === SPARK_KIND.streak);
  assert.equal(streaks.length, b.glyphStreaks);
  let angles = 0;
  for (const s of streaks) {
    const inPlane = Math.hypot(s.vx, s.vy), speed = Math.hypot(s.vx, s.vy, s.vz);
    assert.ok(inPlane / speed > 0.9, "mostly in the plane of the mark");
    assert.ok(speed > 5 && s.drag > 6, "shot out and stopped");
    assert.ok(s.spin > 0, "drawn out along its flight");
    assert.ok([FLOURISH_LOOK.empire.core, FLOURISH_LOOK.empire.edge].includes(s.colour));
    angles += Math.atan2(s.vy, s.vx);
  }
  // round the whole compass, not a fan to one side
  const quadrants = new Set(streaks.map((s) => `${Math.sign(s.vx)},${Math.sign(s.vy)}`));
  assert.equal(quadrants.size, 4);
  assert.ok(Number.isFinite(angles));
});

test("a sigil is laid out once for one instanced draw, and the glyph is stamped where spells and summons strike", () => {
  for (const army of ARMIES) {
    const packed = packSigil(SIGILS[army]);
    assert.equal(packed.count, SIGILS[army].strokes.length);
    assert.equal(packed.a.length, packed.count * 4); assert.equal(packed.d.length, packed.count * 4);
  }
  // where two straight strokes meet, both ends are marked joined (each carries half the light there: no bead); a free
  // end is not (it keeps its whole round cap)
  const kwind = packSigil(SIGILS.kwind), hexagon = SIGILS.kwind.strokes.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "line" && s.width === 0.045);
  assert.equal(hexagon.length, 6);
  for (const { i } of hexagon) { assert.equal(kwind.d[i * 4 + 2], 1); assert.equal(kwind.d[i * 4 + 3], 1); }
  const sun = packSigil(SIGILS.sun), tower = SIGILS.sun.strokes.findIndex((s) => s.kind === "line" && s.a[0] === -0.38 && s.b[1] === 0.04);
  assert.ok(tower >= 0);
  assert.equal(sun.d[tower * 4 + 2], 1, "a tower stands on the terrace's end");
  assert.equal(sun.d[tower * 4 + 3], 0, "and its top is free");
  for (let i = 0; i < SIGILS.sun.strokes.length; i += 1) if (SIGILS.sun.strokes[i].kind === "arc") assert.equal(sun.d[i * 4 + 2] + sun.d[i * 4 + 3], 0);
  const engine = source("sceneEngine.ts");
  assert.match(engine, /this\.spellBurst\(attacker, impact, strikeSquare, spell\.blast, spell\.ring, entry\);\n\s+\/\/ The caster's sigil[^\n]*\n\s+this\.stampBlow\(attacker, victim, blow, queen \? 1\.75 : 1\);/);
  assert.match(engine, /this\.summonFlourish\(entry, attacker, victim, blow, riteBlade\);/);
  assert.match(engine, /flourish\.stamp\(chest, this\.camera\.position, entry\.army, 1\.5,/);
});
