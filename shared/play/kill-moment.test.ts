import assert from "node:assert/strict";
import test from "node:test";
import { givesMate, killMoment, killWeapon, lastBesideKing, type CaptureRecord } from "../../web/src/scene/gore/killMoment";
import { weaponOf } from "../../web/src/scene/death/sever/severPlan";
import { goreShow, type TierSettings } from "../../web/src/scene/gore/goreTiers";

const at = (violence: TierSettings["violence"], extra: Partial<TierSettings> = {}): TierSettings =>
  ({ violence, reducedMotion: false, captureCinematics: true, ...extra });
const OPENING = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const record = (extra: Partial<CaptureRecord> = {}): CaptureRecord =>
  ({ attacker: "p", arsenal: "kingdom", victim: "p", victimColor: "b", style: "melee", san: "exd5", fenAfter: OPENING, ...extra });

test("mate is read off the move record: a capture that mates ends in #", () => {
  assert.equal(givesMate("Qxf7#"), true);
  assert.equal(givesMate("Qxh4"), false);
  assert.equal(givesMate("Qxh4+"), false);
  assert.equal(givesMate(" Rxe8# "), true);
  // The controller's own word for it is taken too.
  assert.equal(killMoment(record({ san: "Qxe7", mate: true })).mate, true);
});

test("a side's last piece beside its King is read off the position after the capture", () => {
  assert.equal(lastBesideKing(OPENING, "b"), false);
  assert.equal(lastBesideKing("8/8/4k3/8/8/2K5/5P2/8 b - - 0 60", "b"), true, "Black has only its King");
  assert.equal(lastBesideKing("8/8/4k3/8/8/2K5/5P2/8 b - - 0 60", "w"), false, "White keeps a Pawn");
  assert.equal(lastBesideKing("8/8/4k3/8/8/2K5/8/8 w - - 0 60", "w"), true);
  // A Pawn is a piece of the side, as much as a Queen is.
  assert.equal(lastBesideKing("8/5p2/4k3/8/8/2K5/8/8 w - - 0 60", "b"), false);
  // Nonsense in, no fatality out.
  assert.equal(lastBesideKing("", "w"), false);
});

test("the weapon is known for steel and powder, not for a spell or a summon", () => {
  assert.equal(killWeapon("melee", "kingdom", "r"), "mace", "Aethelgard's Rook swings a warhammer");
  assert.equal(killWeapon("melee", "sun", "n"), "axe", "Solforiz's Knight a cleaver");
  assert.equal(killWeapon("melee", "kwind", "n"), "fist", "Kwind-09's courier kicks");
  assert.equal(killWeapon("gun", "empire", "k"), "musket", "the Emperor's flintlock");
  assert.equal(killWeapon("spell", "kingdom", "q"), undefined);
  assert.equal(killWeapon("summon", "sun", "q"), undefined);
  // The Combat Director's duel is fought with the spear, the bayonet fixed for it included.
  assert.equal(killWeapon("gun", "empire", "p", true), "spear");
  // A rank duel (combat/rankDuel.ts) is fought with the figure's own steel: the hammer, the cleaver, the kick.
  assert.equal(killWeapon("melee", "kingdom", "r", true), "mace");
  assert.equal(killWeapon("melee", "sun", "n", true), "axe");
  assert.equal(killWeapon("melee", "kwind", "n", true), "fist");
  // One table for the tiers and for dismemberment: what a figure kills with in a duel is what it may sever with.
  for (const arsenal of ["kingdom", "sun", "empire", "kwind"] as const) for (const kind of ["k", "n", "r", "p"] as const)
    assert.equal(killWeapon("melee", arsenal, kind), weaponOf(arsenal, kind), `${arsenal} ${kind}`);
});

test("the Scholar's mate is a fatality at Full: a Queen's spell that mates", () => {
  const moment = killMoment(record({ attacker: "q", victim: "p", style: "spell", san: "Qxf7#",
    fenAfter: "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4" }));
  assert.deepEqual(moment, { attacker: "q", victim: "p", style: "spell", mate: true });
  const show = goreShow(moment, at("full"), "high");
  assert.deepEqual([show.tier, show.fatality, show.fluid], [3, true, true]);
  // The same capture under each cap.
  assert.equal(goreShow(moment, at("cinematic"), "high").fatality, false, "no fatality below Full");
  assert.equal(goreShow(moment, at("full", { reducedMotion: true }), "high").fatality, false);
  assert.equal(goreShow(moment, at("full", { captureCinematics: false }), "high").fatality, false);
  assert.equal(goreShow(moment, at("full", { menuBoard: true }), "high").tier, 0);
  assert.equal(goreShow(moment, at("full"), "low").fluid, false, "Low plays it without its fluid");
});

test("a Queen taking a Queen is a fatality, whatever else it is", () => {
  const moment = killMoment(record({ attacker: "q", victim: "q", style: "summon", san: "Qxh4",
    fenAfter: "rnb1kbnr/pppp1ppp/8/4p3/4P2Q/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3" }));
  assert.equal(moment.mate, undefined);
  assert.equal(moment.last, undefined);
  assert.equal(goreShow(moment, at("full"), "medium").fatality, true);
  // An ordinary duel stays ordinary; the last man standing beside his King does not.
  assert.equal(goreShow(killMoment(record()), at("full"), "high").tier, 1);
  const last = killMoment(record({ fenAfter: "8/8/4k3/8/8/2K5/5P2/8 b - - 0 60" }));
  assert.deepEqual([last.last, last.weapon, goreShow(last, at("full"), "high").tier], [true, "spear", 3]);
});
