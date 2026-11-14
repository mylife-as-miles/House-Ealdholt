/**
 * Reactions that differ by meaning (web/src/scene/battleEmotion.ts through BoardReactionDirector) and the scene adapter's
 * hooks (web/src/scene/battleBonds.ts). The director's plain behaviour is held here too, as web/src/scene/
 * boardReactionDirector.test.ts holds it under vitest: a meaning only ever adds to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { BoardReactionDirector, boardFieldOfView, boardLineOfSight, type BoardObserver, type BoardReactionCue, type BoardReactionEvent } from "../../web/src/scene/boardReactionDirector";
import { BOND_SCALE, cueEnvelope, emotionalCue, feel, partingWeight, WHOLE_FIELD } from "../../web/src/scene/battleEmotion";
import { BattleBonds, HOME_FACING, type BattleEmotionEvent, type BondsActor } from "../../web/src/scene/battleBonds";
import type { Faction, GameSnapshot, PieceKind } from "../../web/src/core/types";
import { COMPANION } from "./battle-memory";
import { emptyBarkMemory, lastMoveFacts, planBarks, type MoveFacts, type Witness } from "./gambit-barks";

/** A witness on a one-unit board: x is the file, z the rank (so White faces +z here). */
function actor(square: string, kind: PieceKind = "p", color: Faction = "b", facing = false): BoardObserver {
  return { id: `${color}-${square}`, square, kind, color, point: at(square), ...(facing ? { facing: { x: 0, z: color === "w" ? 1 : -1 } } : {}) };
}
const at = (square: string) => ({ x: square.charCodeAt(0) - 97, y: 0, z: Number(square[1]) - 1 });
const seeing = (square: string, kind: PieceKind = "p", color: Faction = "w") => actor(square, kind, color, true);
const cues = (plan: { reactions: readonly { id: string; cue: BoardReactionCue }[] }) => new Map(plan.reactions.map(row => [row.id, row.cue]));
const impact: BoardReactionEvent = { id: "capture-1", type: "capture-impact", point: { x: 3, y: 0, z: 4 }, victimColor: "b" };

// ---------------------------------------------------------------- the plain policy, unchanged

test("plain: nearby witnesses first, the duel excluded, distant soldiers left alone", () => {
  const nearby = actor("c4"), primary = actor("e5"), far = actor("h1"), director = new BoardReactionDirector("high");
  const plan = director.plan({ ...impact, primary: [primary.id] }, [nearby, primary, far]);
  assert.deepEqual(plan.reactions.map(item => item.id), [nearby.id]);
  assert.equal(plan.reactions[0].cue.pose, "flinch");
});

test("plain: the same loss gives Pawn, Queen and the other army different responses", () => {
  const pawn = actor("c4"), queen = actor("f5", "q"), enemy = actor("e3", "p", "w");
  const c = cues(new BoardReactionDirector("high").plan(impact, [pawn, queen, enemy]));
  assert.ok(c.get(pawn.id)!.flinch > c.get(enemy.id)!.flinch);
  assert.equal(c.get(queen.id)!.flinch, 0);
  assert.ok(c.get(queen.id)!.duration > c.get(pawn.id)!.duration);
  assert.equal(c.get(queen.id)!.pose, "watch");
});

test("plain: standing pieces occlude, the active fighters do not", () => {
  const observer = actor("a1"), blocker = actor("a3"), target = actor("a5");
  assert.equal(boardLineOfSight(observer, target.point, [observer, blocker, target], new Set()), false);
  assert.equal(boardLineOfSight(observer, target.point, [observer, blocker, target], new Set([blocker.id])), true);
});

test("plain: budgets hold across events; Low turns only heads, except for a killing", () => {
  const roster = [actor("c4"), actor("f5", "q"), actor("e6", "n"), actor("c6", "r"), actor("b5", "b"), actor("d3", "k"), actor("e4", "p", "w")];
  for (const quality of ["low", "medium", "high", "ultra"] as const) {
    const director = new BoardReactionDirector(quality);
    for (const type of ["move-started", "capture-impact", "ally-fallen"] as const) {
      const plan = director.plan({ ...impact, type, id: type }, roster);
      assert.ok(director.activeCount <= director.budget);
      if (quality === "low") assert.ok(plan.reactions.every(item => item.cue.headOnly === (type === "move-started")));
    }
    assert.ok(director.activeCount > 0);
  }
});

test("plain: repeated notifications are deduplicated and each observer has a cooldown", () => {
  const roster = [actor("c4")], director = new BoardReactionDirector();
  assert.equal(director.plan(impact, roster).reactions.length, 1);
  assert.equal(director.plan(impact, roster).reactions.length, 0);
  assert.equal(director.plan({ ...impact, id: "capture-2" }, roster).reactions.length, 0);
  director.update(10);
  assert.equal(director.activeCount, 0);
  assert.equal(director.plan({ ...impact, id: "capture-3" }, roster).reactions.length, 1);
});

test("plain: an observer the Combat Director takes is released", () => {
  const pawn = actor("c4"), director = new BoardReactionDirector();
  director.plan(impact, [pawn]);
  const plan = director.plan({ ...impact, id: "next", primary: [pawn.id] }, [pawn]);
  assert.ok(plan.release.includes(pawn.id)); assert.equal(plan.reactions.length, 0); assert.equal(director.activeCount, 0);
});

test("plain: a checked King stays guarded until check clears; checkmate leaves him defiant", () => {
  const king = actor("a1", "k"), director = new BoardReactionDirector("low");
  const event: BoardReactionEvent = { ...impact, id: "check", type: "check", kingId: king.id, point: king.point, focus: actor("h8", "q", "w").point, checks: 4 };
  const first = director.plan(event, [king]).reactions[0].cue;
  assert.equal(first.pose, "royal-guard"); assert.equal(first.sustained, true);
  director.update(120); assert.equal(director.activeCount, 1);
  assert.deepEqual(director.releaseRoyal(), [king.id]); assert.equal(director.activeCount, 0);
  const mate = director.plan({ ...event, id: "mate", type: "checkmate" }, [king]).reactions[0].cue;
  assert.equal(mate.pose, "defiant"); assert.ok(mate.grip < 0);
  director.update(120); assert.equal(director.activeCount, 1);
  director.reset(); assert.equal(director.activeCount, 0);
});

test("plain: deterministic after reset or reordering, and positions are never touched", () => {
  const roster = [actor("c4"), actor("f5", "q"), actor("e6", "n")];
  for (const value of roster) { Object.freeze(value.point); Object.freeze(value); }
  const before = JSON.stringify(roster), director = new BoardReactionDirector("high");
  const first = director.plan(impact, roster);
  director.reset(); const again = director.plan(impact, [...roster].reverse());
  assert.deepEqual(again, first); assert.equal(JSON.stringify(roster), before);
});

// ---------------------------------------------------------------- reactions by meaning

// White's d5 Pawn falls to a Black Pawn from c6.
const fall: BoardReactionEvent = { id: "fall", type: "ally-fallen", point: at("d5"), focus: at("c6"), victimColor: "w", power: 1 };

test("the director names who grieves hardest, for the camera to keep in frame, until the grief has passed", () => {
  const companion = seeing("d1"), other = seeing("f4");
  const director = new BoardReactionDirector("high");
  assert.equal(director.mourner(), null, "no one grieves yet");
  director.plan({ ...fall, meaning: { loss: "companion", bonds: { [companion.id]: .9, [other.id]: .2 } } }, [companion, other]);
  assert.equal(director.mourner(), companion.id);
  director.update(30);
  assert.equal(director.mourner(), null, "the grief has passed");
});

test("a companion turns from farther off than any stranger, and grieves over the body", () => {
  const companion = seeing("d1"), farStranger = seeing("h5"), nearStranger = seeing("f4");
  const roster = [companion, farStranger, nearStranger];
  const c = cues(new BoardReactionDirector("high").plan({ ...fall, meaning: { loss: "companion", bonds: { [companion.id]: .9 } } }, roster));
  const grief = c.get(companion.id)!;
  assert.equal(grief.pose, "grief");
  assert.deepEqual(grief.target, fall.point, "the gaze is held on the body, not the killer");
  assert.ok((grief.bow ?? 0) > .1 && grief.grip < 0 && grief.posture > 0, "head bowed, shoulders falling");
  assert.ok(grief.duration >= 4 && grief.duration <= 5, "long enough to read, and it ends");
  assert.ok((grief.onset ?? 0) >= .5 && (grief.release ?? 0) >= 1, "slow to come and slow to leave");
  assert.ok((grief.sigh ?? 0) > 0);
  assert.ok(grief.delay >= .3, "a beat of realization first");
  assert.equal(c.has(farStranger.id), false, "a stranger as far away does not turn");
  const glance = c.get(nearStranger.id)!;
  assert.ok(glance.duration <= 1.2 && !glance.bow, "a stranger glances");
});

test("the same fall of a stranger: nobody grieves, the near ones glance", () => {
  const companion = seeing("d1"), nearStranger = seeing("f4");
  const c = cues(new BoardReactionDirector("high").plan({ ...fall, meaning: { loss: "stranger", bonds: {} } }, [companion, nearStranger]));
  assert.equal(c.has(companion.id), false);
  assert.ok(c.get(nearStranger.id)!.duration <= 1.2);
  assert.ok([...c.values()].every(cue => !cue.bow));
});

test("a renowned death is felt across the field by all who can see it, and by none who cannot", () => {
  const victim = "d4", killer = "e5";
  const event: BoardReactionEvent = { ...fall, point: at(victim), focus: at(killer) };
  const far = seeing("a1"), behind = seeing("h8"), hidden = seeing("d1"), blocker = seeing("d2"), enemy = seeing("e6", "p", "b"), farEnemy = seeing("a7", "p", "b");
  const roster = [far, behind, hidden, blocker, enemy, farEnemy];
  const veteran = cues(new BoardReactionDirector("high").plan({ ...event, meaning: { loss: "veteran", renown: 1, bonds: {} } }, roster));
  assert.equal(veteran.get(far.id)?.pose, "dread", "four squares off, in plain sight");
  assert.deepEqual(veteran.get(far.id)!.target, at(killer), "a veteran's army looks at who could do it");
  assert.equal(veteran.get(blocker.id)?.pose, "dread");
  assert.equal(veteran.has(behind.id), false, "behind its back");
  assert.equal(veteran.has(hidden.id), false, "a figure in the way");
  assert.equal(veteran.get(enemy.id)?.pose, "resolve", "the killer's army, grimly");
  assert.ok((veteran.get(enemy.id)!.bow ?? 0) < 0, "chin up");
  assert.equal(veteran.has(farEnemy.id), false);
  const royal = cues(new BoardReactionDirector("high").plan({ ...event, id: "queen", meaning: { loss: "royal", renown: .5, bonds: {} } }, roster));
  assert.equal(royal.get(far.id)?.pose, "dread");
  assert.deepEqual(royal.get(far.id)!.target, at(victim), "the Queen's army looks at her");
  assert.ok(royal.get(far.id)!.flinch > 0);
});

test("the King feels his guard fall, and dreads the last of them, even under the tightest budget", () => {
  const king = seeing("e1", "k"), guardSpot = "f2";
  const crowd = ["c3", "d3", "e3", "g3", "h3", "c2", "d2"].map(square => seeing(square));
  const event: BoardReactionEvent = { ...fall, point: at(guardSpot), focus: at("h4"), meaning: { loss: "last-guard", king: king.id, bonds: {} } };
  const plan = new BoardReactionDirector("low").plan(event, [...crowd, king]);
  const c = cues(plan);
  assert.equal(c.get(king.id)?.pose, "dread");
  assert.deepEqual(c.get(king.id)!.target, at(guardSpot));
  assert.ok(plan.reactions.length <= 4);
});

test("warriors turn on the killer, unless a figure stands between them: then they grieve over the body", () => {
  const knight = seeing("b3", "n"), meaning = { loss: "companion" as const, bonds: { "w-b3": .9 } };
  const event: BoardReactionEvent = { ...fall, point: at("d4"), focus: at("e5"), meaning };
  const open = cues(new BoardReactionDirector("high").plan(event, [knight])).get(knight.id)!;
  assert.equal(open.pose, "rage");
  assert.deepEqual(open.target, at("e5"));
  assert.ok(open.grip > .1, "the weapon comes up");
  const wall = seeing("c4", "p", "b");
  const blocked = cues(new BoardReactionDirector("high").plan({ ...event, id: "again" }, [knight, wall])).get(knight.id)!;
  assert.equal(blocked.pose, "grief");
  assert.deepEqual(blocked.target, at("d4"));
});

test("a figure that took a veteran or a Queen is watched warily by the army it took them from", () => {
  const watcher = seeing("e7", "p", "b"), friend = seeing("c3", "p", "w");
  const move: BoardReactionEvent = { id: "move", type: "move-started", point: at("e4"), primary: ["mover"], meaning: { feared: true, side: "w" } };
  const c = cues(new BoardReactionDirector("high").plan(move, [watcher, friend]));
  assert.equal(c.get(watcher.id)?.pose, "wary", "three squares off: a plain glance would not reach it");
  assert.ok(c.get(watcher.id)!.grip > 0);
  assert.equal(c.has(friend.id), false, "its own army does not watch it so");
  const unfeared = cues(new BoardReactionDirector("high").plan({ ...move, id: "plain", meaning: undefined }, [watcher, friend]));
  assert.equal(unfeared.has(watcher.id), false);
});

test("the avenger of a companion has its own moment; those who knew the avenged answer it", () => {
  const avenger = seeing("d3"), friend = seeing("c2"), stranger = seeing("f2"), enemy = seeing("e7", "p", "b");
  const event: BoardReactionEvent = { id: "avenged", type: "avenged", point: at("d5"), focus: avenger.point, victimColor: "w",
    meaning: { avenger: avenger.id, companion: true, bonds: { [friend.id]: .6, [avenger.id]: 1 } } };
  const c = cues(new BoardReactionDirector("high").plan(event, [avenger, friend, stranger, enemy]));
  const own = c.get(avenger.id)!;
  assert.equal(own.pose, "vindicated");
  assert.ok((own.bow ?? 0) < 0 && own.posture < 0 && (own.sigh ?? 0) > 0, "chin up, chest out, a long breath");
  assert.ok(own.gaze > 0, "it looks to where its companion fell");
  assert.equal(c.get(friend.id)?.pose, "resolve");
  assert.deepEqual(c.get(friend.id)!.target, avenger.point);
  assert.equal(c.has(stranger.id), false);
  assert.equal(c.has(enemy.id), false);
  // Where they fell is behind the avenger: it lifts its chin without turning its head; a stranger's avenger only stands firm.
  const behind = cues(new BoardReactionDirector("high").plan({ ...event, id: "behind", point: at("d1"), meaning: { avenger: avenger.id, companion: false, bonds: {} } }, [avenger])).get(avenger.id)!;
  assert.equal(behind.pose, "resolve");
  assert.equal(behind.gaze, 0);
});

test("the King's tension grows as his guard falls", () => {
  const king = actor("e1", "k", "w"), check = (guardLost: number) => new BoardReactionDirector("high").plan({ id: `check-${guardLost}`, type: "check", point: king.point, focus: at("e8"),
    kingId: king.id, victimColor: "w", checks: 1, meaning: { guardLost } }, [king]).reactions[0].cue;
  const calm = check(0), alone = check(1);
  assert.equal(alone.pose, "royal-guard");
  assert.ok(alone.grip > calm.grip && alone.posture > calm.posture);
  assert.ok((alone.bow ?? 0) > 0 && !calm.bow);
});

test("nobody reacts to a death behind its back; a figure that does not know its facing sees all round, as before", () => {
  const event: BoardReactionEvent = { ...impact, point: at("d4"), victimColor: "w" };
  assert.equal(new BoardReactionDirector("high").plan(event, [seeing("d6")]).reactions.length, 0);
  assert.equal(new BoardReactionDirector("high").plan(event, [actor("d6", "p", "w")]).reactions.length, 1);
  assert.equal(boardFieldOfView(seeing("d6"), at("d7")), true);
  assert.equal(boardFieldOfView(seeing("d6"), at("a6")), true, "beside it");
  assert.equal(boardFieldOfView(seeing("d6"), at("d4")), false);
});

test("a stranger already watching the blow keeps that look for the fall instead of turning again", () => {
  const stranger = seeing("f4"), director = new BoardReactionDirector("high");
  const blow = director.plan({ ...fall, id: "blow", type: "capture-impact", meaning: { loss: "stranger", bonds: {} } }, [stranger]);
  assert.equal(blow.reactions.length, 1);
  director.update(.9);
  const down = director.plan({ ...fall, meaning: { loss: "stranger", bonds: {} } }, [stranger]);
  assert.equal(down.reactions.length, 0);
  assert.equal(down.release.length, 0);
  assert.equal(director.activeCount, 1);
});

test("a companion wins the budget over strangers standing nearer", () => {
  const companion = seeing("d1"), crowd = ["c4", "e4", "c3", "e3", "b4", "f4", "b3", "f3"].map(square => seeing(square));
  const plan = new BoardReactionDirector("low").plan({ ...fall, meaning: { loss: "companion", bonds: { [companion.id]: 1 } } }, [...crowd, companion]);
  assert.ok(plan.reactions.length <= 4);
  assert.equal(plan.reactions[0].id, companion.id);
});

test("never the duel's fighters, however bonded", () => {
  const fighter = seeing("d4");
  const plan = new BoardReactionDirector("high").plan({ ...fall, primary: [fighter.id], meaning: { loss: "companion", bonds: { [fighter.id]: 1 } } }, [fighter]);
  assert.equal(plan.reactions.length, 0);
});

test("the reaction table: reach and pose by what the witness was to the fallen", () => {
  const pawn = seeing("d2"), knight = seeing("b1", "n"), king = seeing("e1", "k");
  assert.equal(feel("ally-fallen", { loss: "stranger", bonds: {} }, pawn, true, 3.1)?.pose, "glance");
  assert.equal(feel("ally-fallen", { loss: "stranger", bonds: { [pawn.id]: .4 } }, pawn, true, 3.1)?.pose, "mourn");
  assert.equal(feel("ally-fallen", { loss: "companion", bonds: { [pawn.id]: .8 } }, pawn, true, 3.1)?.pose, "grief");
  assert.equal(feel("ally-fallen", { loss: "companion", bonds: { [knight.id]: .8 } }, knight, true, 3.1)?.pose, "rage");
  assert.equal(feel("ally-fallen", { loss: "last-guard", king: king.id, bonds: {} }, king, true, 4.6)?.pose, "dread");
  assert.equal(feel("ally-fallen", { loss: "royal", bonds: {} }, pawn, true, 3.1)?.reach, WHOLE_FIELD);
  assert.equal(feel("ally-fallen", { loss: "stranger", bonds: {} }, pawn, false, 3.1), null, "the other army's plain look");
  assert.ok(feel("ally-fallen", { loss: "companion", bonds: { [pawn.id]: 1 } }, pawn, true, 3.1)!.reach >= 6.5);
  // The memory's companion threshold is where grief begins.
  assert.equal(feel("ally-fallen", { loss: "companion", bonds: { [pawn.id]: COMPANION / BOND_SCALE } }, pawn, true, 3.1)?.pose, "grief");
  assert.equal(feel("ally-fallen", { loss: "companion", bonds: { [pawn.id]: COMPANION / BOND_SCALE - .01 } }, pawn, true, 3.1)?.pose, "mourn");
});

test("every emotional cue stays within the overlay's bounds", () => {
  const plain: BoardReactionCue = { target: at("d5"), pose: "watch", gaze: .8, flinch: .3, grip: .2, posture: .1, duration: 1.6, delay: .1, sustained: false, headOnly: false };
  for (const kind of ["p", "n", "b", "r", "q", "k"] as const) for (const pose of ["grief", "mourn", "rage", "dread", "resolve", "wary", "vindicated"] as const) {
    const cue = emotionalCue(plain, { pose, reach: 5, bond: 1, look: "point", strength: 1, score: 0, keep: false }, seeing("d2", kind), 3, 1, at("d5"));
    assert.ok(cue.gaze >= 0 && cue.gaze <= 1, `${kind} ${pose} gaze`);
    assert.ok(Math.abs(cue.grip) <= .2 && Math.abs(cue.posture) <= .1 && Math.abs(cue.bow ?? 0) <= .2 && Math.abs(cue.flinch) <= .2, `${kind} ${pose} body`);
    assert.ok(cue.duration > 0 && cue.duration <= 5 && !cue.sustained, `${kind} ${pose} ends`);
    assert.ok((cue.onset ?? 0) + (cue.release ?? 0) < cue.duration);
  }
});

// ---------------------------------------------------------------- no pops

test("a cue starts and ends at rest, never jumps, and a grief holds long enough to read", () => {
  const grief = emotionalCue({ target: at("d5"), pose: "watch", gaze: .8, flinch: 0, grip: 0, posture: 0, duration: 1.6, delay: .1, sustained: false, headOnly: false },
    { pose: "grief", reach: 5, bond: 1, look: "point", strength: 1, score: 0, keep: false }, seeing("d2"), 2, 1, at("d5"));
  let previous = 0, biggest = 0, held = 0;
  for (let t = 0; t <= grief.delay + grief.duration + .5; t += 1 / 120) {
    const value = cueEnvelope(grief, t);
    biggest = Math.max(biggest, Math.abs(value - previous)); previous = value;
    if (value >= .9) held += 1 / 120;
  }
  assert.equal(cueEnvelope(grief, 0), 0);
  assert.equal(cueEnvelope(grief, grief.delay + grief.duration), 0);
  assert.ok(biggest < .03, `largest step at 120 Hz: ${biggest}`);
  assert.ok(held >= 2, `held ${held.toFixed(2)} s near full`);
  // A sustained cue holds until let go.
  assert.equal(cueEnvelope({ delay: 0, duration: 1, sustained: true }, 99), 1);
});

test("a new look takes over from the old one without a jump, and a look let go eases back", () => {
  const old = { delay: 0, duration: 4, sustained: false, onset: .2, release: .5 };
  const next = { delay: .3, duration: 3, sustained: false, onset: .4, release: .6 };
  const swap = 1.5, from = cueEnvelope(old, swap);
  let previous = from, biggest = 0;
  for (let since = 0; since <= 2; since += 1 / 120) {
    // The visible weight: the old look fading from where it stood, the new one rising.
    const value = partingWeight(from, since, next.delay, next.onset!) + cueEnvelope(next, since);
    biggest = Math.max(biggest, Math.abs(value - previous)); previous = value;
  }
  assert.ok(biggest < .03, `largest step across the hand-over: ${biggest}`);
  assert.equal(partingWeight(from, 0, next.delay, next.onset!), from, "nothing changes at the moment of the hand-over");
  assert.equal(partingWeight(.8, .32, 0, .32), 0, "let go, it is gone in a third of a second");
});

// ---------------------------------------------------------------- the scene adapter and its hooks

/** A settled (or busy) snapshot as the controller publishes it, from moves in standard notation. */
function snapshot(sans: string, { busy = false, fen }: { busy?: boolean; fen?: string } = {}): GameSnapshot {
  const game = fen ? new Chess(fen) : new Chess();
  const moves = sans.split(" ").filter(Boolean).map((san, ply) => {
    const m = game.move(san);
    return { ply, number: Math.floor(ply / 2) + 1, color: m.color, kind: m.piece, san: m.san, from: m.from, to: m.to, capture: !!m.captured,
      castle: m.flags.includes("k") || m.flags.includes("q"), promotion: m.promotion ?? null, check: m.san.includes("+"), mate: m.san.includes("#") };
  });
  return { moves, pgn: game.pgn(), fen: game.fen(), turn: game.turn(), busy, inCheck: game.isCheck(), status: "playing" } as unknown as GameSnapshot;
}
/** The standing figures, named `id:<square>`: before the last move (as the scene's witnesses are during it), or after it. */
function standing(sans: string, before: boolean, fen?: string): BondsActor[] {
  const game = fen ? new Chess(fen) : new Chess(), list = sans.split(" ").filter(Boolean);
  for (const san of before ? list.slice(0, -1) : list) game.move(san);
  return game.board().flat().filter(cell => cell !== null).map(cell => ({ id: `id:${cell!.square}`, square: cell!.square }));
}
const COMPANIONS = "e4 e6 d4 b6 Nf3 Bb7 Bd3 Ne7 O-O Ng6 Nc3 Be7 Be3 O-O Qe2 c5 h3 cxd4";
const STRANGERS = "e4 Nc6 c3 e6 Nf3 Nf6 Bd3 Nd4 cxd4 c5 h3 cxd4";

test("the scene adapter: the same capture on d4 means a companion's fall in one game and a stranger's in another", () => {
  const bonds = new BattleBonds();
  const companion = bonds.meaning("ally-fallen", snapshot(COMPANIONS, { busy: true }), standing(COMPANIONS, true))!;
  assert.equal(companion.loss, "companion");
  assert.ok(companion.bonds!["id:e4"] >= COMPANION / BOND_SCALE, "the e4 Pawn stood beside it for fifteen plies");
  const stranger = bonds.meaning("ally-fallen", snapshot(STRANGERS, { busy: true }), standing(STRANGERS, true))!;
  assert.equal(stranger.loss, "stranger");
  assert.ok((stranger.bonds!["id:e4"] ?? 0) < .2, "the same e4 Pawn is a stranger to the c-Pawn that came to d4");
  assert.ok(stranger.bonds!["id:b2"] > 0, "its old comrades still know it");
  // Only its own army's bonds are carried, by observer id.
  assert.equal(companion.bonds!["id:e6"], undefined);
});

test("the scene adapter: a feared mover, the King's lost guard in check, and nothing for a quiet move", () => {
  const bonds = new BattleBonds();
  const raid = "b4 c6 b5 a6 bxc6 Nf6 cxb7 Bxb7 e3 Bxg2";
  assert.deepEqual(bonds.meaning("move-started", snapshot(raid, { busy: true }), standing(raid, true)), { feared: true, side: "b" });
  assert.equal(bonds.meaning("move-started", snapshot("e4 e5", { busy: true }), standing("e4 e5", true)), undefined);
  const fen = "6kr/8/8/8/8/8/7P/6K1 b - - 0 1", line = "Rxh2 Kf1 Rh1+";
  assert.deepEqual(bonds.meaning("check", snapshot(line, { fen }), standing(line, false, fen)), { guardLost: 1 });
  assert.equal(bonds.meaning("ally-fallen", snapshot("e4 e5", { busy: true }), standing("e4 e5", true)), undefined, "no capture, no fall");
});

test("the scene adapter: the avenger's moment, from the board after the move", () => {
  const bonds = new BattleBonds(), line = "e4 d5 exd5 Qxd5";
  const moment = bonds.avenging(snapshot(line, { busy: true }), standing(line, false))!;
  assert.equal(moment.avenger, "d5");
  assert.equal(moment.fellAt, "d5", "the Queen stands where the Pawn she avenged fell");
  assert.equal(moment.meaning.avenger, "id:d5");
  assert.equal(moment.meaning.companion, false, "old comrades, not yet companions");
  assert.equal(bonds.avenging(snapshot("e4 d5 exd5", { busy: true }), standing("e4 d5 exd5", false)), null);
});

test("onEmotion: each fall told once as its body comes down, then the vengeance; a failing listener spoils nothing", () => {
  const bonds = new BattleBonds(), heard: BattleEmotionEvent[] = [];
  const quiet = console.warn; console.warn = () => {};
  try {
    bonds.onEmotion(() => { throw new Error("a broken voice"); });
    const stop = bonds.onEmotion(event => heard.push(event));
    const line = snapshot("e4 d5 exd5 Qxd5", { busy: true });
    bonds.tell(line, 7); bonds.tell(line, 7);
    assert.deepEqual(heard.map(event => [event.kind, event.side, event.ply]), [["stranger", "w", 3], ["avenged", "b", 3]]);
    const [loss, vengeance] = heard;
    assert.deepEqual([loss.fallen.id, loss.fallen.name, loss.fallen.square, loss.killer.id], ["w:e2", "the e-file Pawn", "d5", "b:d8"]);
    assert.ok(loss.bond && loss.bond.survivor.side === "w" && !loss.bond.companion);
    assert.deepEqual([vengeance.avenged?.fallen.id, vengeance.avenged?.companion], ["b:d7", false]);
    assert.ok(loss.morale.b > loss.morale.w);
    // The same capture on a rebuilt board (an Undo and the move again) is told again.
    bonds.tell(line, 8);
    assert.equal(heard.length, 4);
    const companion = snapshot(COMPANIONS, { busy: true });
    bonds.tell(companion, 8);
    assert.equal(heard.at(-1)!.kind, "companion");
    assert.equal(heard.at(-1)!.bond!.survivor.id, "w:e2");
    assert.ok(heard.at(-1)!.bond!.companion);
    stop(); bonds.tell(snapshot("e4 d5 exd5", { busy: true }), 9);
    assert.equal(heard.length, 5);
  } finally { console.warn = quiet; }
});

test("onMorale: told once a move has settled and the morale changed; an Undo tells the morale gone back to", () => {
  const bonds = new BattleBonds(), heard: number[] = [];
  bonds.onMorale(morale => heard.push(morale.w.value));
  const before = snapshot("e4 e5 Qh5 Nc6 Qxf7+"), playing = snapshot("e4 e5 Qh5 Nc6 Qxf7+ Kxf7", { busy: true }), after = snapshot("e4 e5 Qh5 Nc6 Qxf7+ Kxf7");
  bonds.publishMorale(before); bonds.publishMorale(before);
  assert.equal(heard.length, 1);
  bonds.publishMorale(playing);
  assert.equal(heard.length, 1, "nothing while the capture is still being played");
  assert.equal(bonds.morale(playing).ply, 5, "the board still shows the Queen alive");
  bonds.publishMorale(after);
  assert.equal(heard.length, 2);
  assert.ok(heard[1] < heard[0] - .2, "the Queen's fall");
  bonds.publishMorale(before);
  assert.deepEqual([heard.length, heard[2]], [3, heard[0]], "Undo: the morale before her fall, exactly");
});

test("moods: a broken army sags, a King whose guard has fallen is tense, and a figure first seen takes its mood at once", () => {
  const bonds = new BattleBonds();
  const fen = "6kr/8/8/8/8/8/7P/6K1 b - - 0 1", alone = snapshot("Rxh2 Kf1 Rh1+", { fen });
  const mood = bonds.moods(alone);
  assert.ok(mood("f1").tension >= .8, "the King, alone and in check");
  assert.equal(mood("e4").slump, 0, "an empty square has no mood");
  const rout = "e4 e5 Qh5 Nc6 Qxf7+ Kxf7";
  const broken = bonds.moods(snapshot(rout));
  assert.ok(broken("d2").slump > .25, "White has thrown its Queen away: shaken");
  assert.ok(broken("e1").slump > 0 && broken("e1").slump < broken("d2").slump, "its King carries it with more composure");
  assert.equal(broken("f7").slump, 0, "Black stands");
  assert.equal(broken("e2").slump, 0, "an empty square");
  const calls: [number, number, number, boolean | undefined][] = [];
  const figure = { setBattleMood: (slump: number, tension: number, pride: number, immediate?: boolean) => { calls.push([slump, tension, pride, immediate]); } };
  bonds.applyMoods(snapshot(rout), new Map([["d2", figure]]));
  bonds.applyMoods(snapshot(rout), new Map([["d2", figure]]));
  assert.deepEqual(calls.map(call => call[3]), [true, false]);
});

test("no stale mood: one more move is felt over seconds, an Undo or a replay's seek is shown at once", () => {
  const bonds = new BattleBonds(), calls: (boolean | undefined)[] = [];
  const kept = { setBattleMood: (_s: number, _t: number, _p: number, immediate?: boolean) => { calls.push(immediate); } };
  const line = "e4 e5 Qh5 Nc6 Qxf7+ Kxf7 Nc3 Nf6 d3 d5".split(" "), at = (plies: number) => snapshot(line.slice(0, plies).join(" "));
  const board = new Map([["e1", kept]]);
  bonds.applyMoods(at(6), board);   // first sight: at once
  bonds.applyMoods(at(7), board);   // one more move: eased
  bonds.applyMoods(at(7), board);   // the same board again (a setting changed): eased
  bonds.applyMoods(at(10), board);  // a replay's seek forward: at once
  bonds.applyMoods(at(4), board);   // an Undo or a seek back, before the Queen fell: at once
  bonds.applyMoods(at(5), board);   // and the game goes on from there: eased
  assert.deepEqual(calls, [true, false, false, true, true, false]);
});

test("no stale emotion: after an Undo the meaning is the shorter game's", () => {
  const bonds = new BattleBonds(), played = snapshot(COMPANIONS, { busy: true });
  assert.equal(bonds.meaning("ally-fallen", played, standing(COMPANIONS, true))?.loss, "companion");
  const undone = COMPANIONS.split(" ").slice(0, -1).join(" ");
  assert.equal(bonds.meaning("ally-fallen", snapshot(undone, { busy: true }), standing(undone, true)), undefined);
  assert.equal(bonds.story(snapshot(undone)).bondsBroken.length, 0);
  assert.equal(bonds.memory(snapshot(undone)).plies, 17);
});

test("home facing: White toward the eighth rank, Black toward the first, as the scene places them", () => {
  // squareToWorld puts rank 8 at -z.
  assert.deepEqual(HOME_FACING.w, { x: 0, z: -1 });
  assert.deepEqual(HOME_FACING.b, { x: 0, z: 1 });
});

// ---------------------------------------------------------------- the voices' witness hook

test("the voices hear a familiar companion's death as a companion's, where the board alone hears a stranger's", () => {
  // The d- and e-Pawns stood side by side for fifteen plies; the e-Pawn stepped to e5 two plies before ...cxd4, so the
  // board's own rule (both on the same squares six plies ago) sees no pair, and calls the e5 Pawn a stranger.
  const line = "e4 e6 d4 b6 Nf3 Bb7 Bd3 Ne7 O-O Ng6 Nc3 Be7 Be3 O-O Qe2 c5 e5 cxd4";
  const announced = snapshot(line, { busy: true });
  const facts = lastMoveFacts(announced.pgn)!, witness = facts.witnesses.find(seen => seen.square === "e5")!;
  assert.equal(witness.kind, "stranger");
  const bonds = new BattleBonds(), hook = (f: MoveFacts, w: Witness) => bonds.witnessKind(announced, f, w);
  assert.equal(hook(facts, witness), "companion");
  // Through the voices' own planning, with the same rolls: the killer's line passes, the e5 Pawn is the one who speaks,
  // and it says a companion's line where the board's answer would have stayed silent.
  const index = facts.witnesses.indexOf(witness);
  const plan = (witnessKind?: typeof hook) => {
    const rolls = [.4, (index + .5) / facts.witnesses.length, .4];
    return planBarks(facts, () => rolls.shift() ?? .99, { ply: 18, memory: emptyBarkMemory(), voiceOf: piece => `${piece.side}_${piece.rank}_${piece.square}`, ...(witnessKind ? { witnessKind } : {}) });
  };
  assert.deepEqual(plan(hook).map(bark => [bark.event, bark.speaker.square]), [["companion", "e5"]]);
  assert.ok(!plan().some(bark => bark.event === "companion"), "the board alone: no companion's line");
  // A witness the memory knows no better than the board keeps the board's answer.
  const knight = facts.witnesses.find(seen => seen.square === "c3")!;
  assert.equal(hook(facts, knight), null);
});

test("the voices' vengeance hook: the memory remembers a killing the board's few plies have forgotten", () => {
  const bonds = new BattleBonds();
  // The queen takes the pawn that killed its own d-Pawn five plies before: past the board's window, still a vengeance.
  const late = snapshot("e4 d5 exd5 a6 h3 h6 h4 Qxd5", { busy: true });
  const facts = lastMoveFacts(late.pgn)!;
  assert.equal(facts.avenged, false, "the board alone has forgotten");
  assert.equal(bonds.avenged(late, facts), true);
  // The same through the voices' planning: the queen says the avenger's line.
  const plan = planBarks(facts, () => 0, { ply: 8, memory: emptyBarkMemory(), voiceOf: piece => `${piece.side}_${piece.rank}_${piece.square}`, avenged: f => bonds.avenged(late, f) });
  assert.deepEqual(plan.map(bark => [bark.event, bark.speaker.square]), [["avenged", "d5"]]);
  // A capture of one who had killed no one, and a quiet move, are not.
  const plain = snapshot("e4 d5 exd5 Qxd5 Nc3 Qa5 Nd5 Qxd5", { busy: true });
  assert.equal(bonds.avenged(plain, lastMoveFacts(plain.pgn)!), false, "that knight had killed no one");
  const quiet = snapshot("e4 e5", { busy: true });
  assert.equal(bonds.avenged(quiet, lastMoveFacts(quiet.pgn)!), null);
});

test("the voices' witness hook: the Queen and the King's last guard are royal, a renowned fallen a veteran", () => {
  const bonds = new BattleBonds(), anyone = (square: string, side: Faction): Witness => ({ square, rank: "p", side, kind: "stranger" });
  const queen = snapshot("e4 e5 Qh5 Nc6 Qxf7+ Kxf7", { busy: true });
  assert.equal(bonds.witnessKind(queen, lastMoveFacts(queen.pgn)!, anyone("e2", "w")), "royal");
  const raid = snapshot("b4 c6 b5 a6 bxc6 Nf6 cxb7 Bxb7", { busy: true });
  assert.equal(bonds.witnessKind(raid, lastMoveFacts(raid.pgn)!, anyone("a2", "w")), "veteran", "the b-Pawn that took two and reached the seventh");
  const fen = "6kr/8/8/8/8/8/7P/6K1 b - - 0 1", guard = snapshot("Rxh2", { busy: true, fen });
  assert.equal(bonds.witnessKind(guard, lastMoveFacts(guard.pgn)!, anyone("g2", "w")), "royal");
  // No capture, or a move the memory has not read: the rules decide.
  const quiet = snapshot("e4 e5", { busy: true });
  assert.equal(bonds.witnessKind(quiet, lastMoveFacts(quiet.pgn)!, anyone("d2", "w")), null);
});
