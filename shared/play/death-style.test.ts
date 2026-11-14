import assert from "node:assert/strict";
import test from "node:test";
import type { PieceKind } from "../../web/src/core/types";
import { DEATH_STYLES, burnsOrFades, deathCause, deathStyle, isBigBlast, isFireKill, type DeathCause, type DeathSettings, type DeathSource, type DeathStyle, riteDeathStyle } from "../../web/src/scene/death/deathStyle";
import { GORE_INTENSITIES, type GoreIntensity } from "../../web/src/scene/gore/GoreTypes";

const KILLERS: PieceKind[] = ["p", "n", "b", "r", "q", "k"];
const SOURCES: DeathSource[] = ["melee", "musket", "fieldGun", "spell"];
const at = (intensity: GoreIntensity, over: Partial<DeathSettings> = {}): DeathSettings => ({ intensity, reducedMotion: false, physics: false, ...over });
const cause = (source: DeathSource, by: PieceKind = "b"): DeathCause => ({ source, by });
const FIRE: DeathCause[] = [cause("spell", "b"), cause("spell", "q"), cause("fieldGun", "r")];
const OTHER: DeathCause[] = [cause("melee", "p"), cause("melee", "n"), cause("melee", "r"), cause("musket", "p"), cause("musket", "q"), cause("musket", "b"), cause("musket", "k")];

test("a fire kill is a kill that leaves a burn mark: every spell and the field gun, never a ball or steel", () => {
  for (const by of KILLERS) {
    assert.equal(isFireKill(cause("spell", by)), true);
    assert.equal(isFireKill(cause("fieldGun", by)), true);
    assert.equal(isFireKill(cause("musket", by)), false);
    assert.equal(isFireKill(cause("melee", by)), false);
  }
});

test("the biggest blasts are the field gun and the Queen's spell", () => {
  assert.equal(isBigBlast(cause("fieldGun", "r")), true);
  assert.equal(isBigBlast(cause("spell", "q")), true);
  assert.equal(isBigBlast(cause("spell", "b")), false);
  assert.equal(isBigBlast(cause("musket", "q")), false);
  assert.equal(isBigBlast(cause("melee", "q")), false);
});

test("the scene's attack styles map onto causes: only a gun with a wave is the field gun", () => {
  assert.deepEqual(deathCause("spell", "q"), { source: "spell", by: "q" });
  assert.deepEqual(deathCause("gun", "r", true), { source: "fieldGun", by: "r" });
  assert.deepEqual(deathCause("gun", "p", false), { source: "musket", by: "p" });
  assert.deepEqual(deathCause("gun", "q"), { source: "musket", by: "q" });
  assert.deepEqual(deathCause("melee", "n"), { source: "melee", by: "n" });
  // A wave on a blade (the Rook's ground slam) is not a gun.
  assert.deepEqual(deathCause("melee", "r", true), { source: "melee", by: "r" });
});

test("Minimal: a fire kill fades, every other kill keeps its authored death, whatever physics says", () => {
  for (const physics of [false, true]) {
    for (const fire of FIRE) assert.equal(deathStyle(fire, at("minimal", { physics })), "fade");
    for (const other of OTHER) assert.equal(deathStyle(other, at("minimal", { physics })), "clip");
  }
});

test("Cinematic: fire kills burn; other kills ragdoll when physics is there, else the authored death", () => {
  for (const fire of FIRE) {
    assert.equal(deathStyle(fire, at("cinematic")), "burn");
    assert.equal(deathStyle(fire, at("cinematic", { physics: true })), "burn", "nothing explodes below Full");
  }
  for (const other of OTHER) {
    assert.equal(deathStyle(other, at("cinematic")), "clip");
    assert.equal(deathStyle(other, at("cinematic", { physics: true })), "ragdoll");
  }
});

test("Full: the field gun and the Queen's spell explode the body when physics is there; the rest burn", () => {
  assert.equal(deathStyle(cause("fieldGun", "r"), at("full", { physics: true })), "explode");
  assert.equal(deathStyle(cause("spell", "q"), at("full", { physics: true })), "explode");
  assert.equal(deathStyle(cause("spell", "b"), at("full", { physics: true })), "burn");
  for (const fire of FIRE) assert.equal(deathStyle(fire, at("full")), "burn", "no physics: it burns");
  for (const other of OTHER) {
    assert.equal(deathStyle(other, at("full")), "clip");
    assert.equal(deathStyle(other, at("full", { physics: true })), "ragdoll");
  }
});

test("without the physics deaths nothing ever asks for them", () => {
  for (const intensity of GORE_INTENSITIES) for (const source of SOURCES) for (const by of KILLERS) for (const reducedMotion of [false, true]) {
    const style = deathStyle({ source, by }, at(intensity, { reducedMotion }));
    assert.ok(style !== "ragdoll" && style !== "explode", `${intensity} ${source} ${by}`);
  }
});

test("reduced motion never throws a body about: no ragdoll, no explosion, the calmer burn or the clip", () => {
  for (const intensity of GORE_INTENSITIES) for (const source of SOURCES) for (const by of KILLERS) {
    const style = deathStyle({ source, by }, at(intensity, { reducedMotion: true, physics: true }));
    assert.equal(style, deathStyle({ source, by }, at(intensity, { reducedMotion: true })));
    assert.ok(style === "clip" || style === "fade" || style === "burn");
  }
  assert.equal(deathStyle(cause("fieldGun", "r"), at("full", { reducedMotion: true, physics: true })), "burn");
  assert.equal(deathStyle(cause("spell", "q"), at("minimal", { reducedMotion: true })), "fade");
});

test("the flat map and the menu's board keep the authored death", () => {
  for (const intensity of GORE_INTENSITIES) for (const source of SOURCES) for (const physics of [false, true]) {
    assert.equal(deathStyle(cause(source, "q"), at(intensity, { physics, tactical: true })), "clip");
    assert.equal(deathStyle(cause(source, "q"), at(intensity, { physics, menuBoard: true })), "clip");
  }
});

test("every style is reachable, and only burn and fade are presented here", () => {
  const seen = new Set<DeathStyle>();
  for (const intensity of GORE_INTENSITIES) for (const source of SOURCES) for (const by of KILLERS) for (const physics of [false, true])
    seen.add(deathStyle({ source, by }, at(intensity, { physics })));
  assert.deepEqual([...seen].sort(), [...DEATH_STYLES].sort());
  assert.deepEqual(DEATH_STYLES.filter(burnsOrFades), ["fade", "burn"]);
});

test("a summon's kill takes the Violence setting's form, and nothing is carried where nothing may move", () => {
  const at = (intensity: "minimal" | "cinematic" | "full", extra: Partial<{ reducedMotion: boolean; physics: boolean; tactical: boolean; menuBoard: boolean }> = {}) =>
    ({ intensity, reducedMotion: false, physics: true, ...extra });
  // held: carried at every setting, the authored death where nothing may move
  for (const level of ["minimal", "cinematic", "full"] as const) assert.equal(riteDeathStyle("held", at(level)), "held");
  assert.equal(riteDeathStyle("held", at("full", { reducedMotion: true })), "clip");
  assert.equal(riteDeathStyle("held", at("full", { tactical: true })), "clip");
  assert.equal(riteDeathStyle("held", at("full", { menuBoard: true })), "clip");
  // held-burn: carried burning, carried unburnt at Minimal; where nothing may be carried, the Queen's fire kill where it stands
  assert.equal(riteDeathStyle("held-burn", at("full")), "held-burn");
  assert.equal(riteDeathStyle("held-burn", at("cinematic")), "held-burn");
  assert.equal(riteDeathStyle("held-burn", at("full", { physics: false })), "held-burn");
  assert.equal(riteDeathStyle("held-burn", at("minimal")), "held");
  assert.equal(riteDeathStyle("held-burn", at("full", { reducedMotion: true })), "burn");
  assert.equal(riteDeathStyle("held-burn", at("minimal", { reducedMotion: true })), "fade");
  assert.equal(riteDeathStyle("held-burn", at("full", { tactical: true })), "clip");
  assert.equal(riteDeathStyle("held-burn", at("full", { menuBoard: true })), "clip");
  // burn: a fire kill by the Queen
  assert.equal(riteDeathStyle("burn", at("minimal")), "fade");
  assert.equal(riteDeathStyle("burn", at("cinematic")), "burn");
  assert.equal(riteDeathStyle("burn", at("full")), "explode");
  assert.equal(riteDeathStyle("burn", at("full", { physics: false })), "burn");
  // burst: torn apart at Full, thrown down at Cinematic, the authored death at Minimal or without physics
  assert.equal(riteDeathStyle("burst", at("full")), "explode");
  assert.equal(riteDeathStyle("burst", at("cinematic")), "ragdoll");
  assert.equal(riteDeathStyle("burst", at("minimal")), "clip");
  assert.equal(riteDeathStyle("burst", at("full", { physics: false })), "clip");
  assert.equal(riteDeathStyle("burst", at("full", { reducedMotion: true })), "clip");
  // thrown: steel
  assert.equal(riteDeathStyle("thrown", at("cinematic")), "ragdoll");
  assert.equal(riteDeathStyle("thrown", at("minimal")), "clip");
});
