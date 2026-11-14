/**
 * The battle memory (battle-memory.ts): bonds, renown, falls, morale and the story, read only from the move list.
 * Moves are played through chess.js and handed over as the controller's ledger rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import {
  BattleChronicle, COMPANION, COMRADE, VETERAN, attackMap, bondValue, readBattle, renownValue, soldierName, startingFen,
  type MemoryMove,
} from "./battle-memory";

/** The controller's ledger rows for moves in standard notation (only what the memory reads, plus the flags it ignores). */
function ledger(sans: string, fen?: string): MemoryMove[] {
  const game = fen ? new Chess(fen) : new Chess();
  return sans.split(" ").filter(Boolean).map(san => {
    const move = game.move(san);
    return { color: move.color, kind: move.piece, from: move.from, to: move.to, promotion: move.promotion ?? null, capture: !!move.captured, check: move.san.includes("+") } as MemoryMove;
  });
}
const FRENCH = "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 a6 Nf3 c5 Qd2 Nc6 dxc5 Qxc5 Bd3 b5 Qf2 Qxf2+ Kxf2 b4 Ne2 Nc5";

test("each figure keeps its name, from where it started, through castling, en passant and a crown", () => {
  const memory = readBattle(ledger("e4 d5 e5 f5 exf6 Nc6 fxg7 Nf6 gxh8=Q Bg4 Nf3 Qd7 Bb5 O-O-O O-O"));
  assert.equal(memory.plies, 15);
  assert.equal(memory.occupant("h8"), "w:e2", "the e-file Pawn wears the crown on h8");
  const pawn = memory.soldier("w:e2")!;
  assert.deepEqual([pawn.kind, pawn.born, pawn.name], ["q", "p", "the e-file Pawn, crowned Queen"]);
  // En passant: the Pawn fell where it stood, on f5, not on the captor's square.
  assert.equal(memory.fallAt(4)?.victim, "b:f7");
  assert.equal(memory.fallAt(4)?.square, "f5");
  // Both castlings: the King and his Rook each keep their names.
  assert.deepEqual([memory.occupant("g1"), memory.occupant("f1"), memory.occupant("c8"), memory.occupant("d8")], ["w:e1", "w:h1", "b:e8", "b:a8"]);
  // The board before any ply is still there to ask.
  assert.equal(memory.occupant("e2", 0), "w:e2");
  assert.equal(memory.occupant("e4", 1), "w:e2");
  assert.equal(memory.occupant("e2", 1), null);
  assert.equal(memory.soldier("b:f7")?.square, null);
  assert.equal(memory.soldier("b:f7")?.killer, "w:e2");
});

test("attacks are read as chess.js reads them, square by square, over whole games", () => {
  let seed = 20261112;
  const random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let positions = 0;
  for (let gameIndex = 0; gameIndex < 10; gameIndex += 1) {
    const game = new Chess();
    for (let ply = 0; ply < 90 && !game.isGameOver(); ply += 1) {
      const fen = game.fen();
      for (const side of ["w", "b"] as const) {
        const map = attackMap(fen, side);
        for (const square of Object.keys(map)) assert.deepEqual(map[square], game.attackers(square as never, side).sort(), `${fen} ${side} ${square}`);
      }
      positions += 1;
      const legal = game.moves();
      game.move(legal[Math.floor(random() * legal.length)]);
    }
  }
  assert.ok(positions > 500, `${positions} positions`);
});

test("old comrades are the figures that started side by side or one behind the other", () => {
  const memory = readBattle([]);
  assert.equal(memory.bond("w:e2", "w:d2"), COMRADE, "side by side in the line");
  assert.equal(memory.bond("w:e2", "w:e1"), COMRADE, "the King behind his Pawn");
  assert.equal(memory.bond("w:a1", "w:b1"), COMRADE);
  assert.equal(memory.bond("w:e2", "w:f1"), 0, "a diagonal is not a comrade");
  assert.equal(memory.bond("w:e2", "b:e7"), 0, "an enemy is never bonded");
  assert.equal(memory.bond("w:e2", "w:e2"), 0);
  assert.equal(memory.bondTerms("w:e2", "b:e7"), null);
  assert.equal(memory.soldiers.length, 32);
});

test("standing shoulder to shoulder in the field, and covering one another, forge companions", () => {
  const memory = readBattle(ledger(FRENCH.split(" ").slice(0, 13).join(" ")));
  const terms = memory.bondTerms("w:e2", "w:d2")!;
  // d4 and e4, then d4 and e5, side by side from the second ply on.
  assert.equal(terms.comrades, 1);
  assert.ok(terms.shoulder >= 10, `side by side ${terms.shoulder} plies`);
  assert.ok(memory.bond("w:e2", "w:d2") >= COMPANION);
  // The f-Pawn arrived beside the e-Pawn only on the last ply: still just a comrade.
  assert.ok(memory.bond("w:e2", "w:f2") < COMPANION);
  // Cover is counted only while an enemy attacks the square: the e5 Pawn under the d7 Knight, guarded by d4 and f4.
  const later = readBattle(ledger(FRENCH));
  assert.ok(later.bondTerms("w:e2", "w:f2")!.cover > 0);
  assert.ok(later.bondTerms("w:e2", "w:d2")!.cover > 0);
});

test("dangers come through together bind a pair: both attacked at once, near each other, and both still standing", () => {
  // A Knight forks the Rook and the Knight on the first rank; the Rook steps out of it and both live.
  const fen = "4k3/8/8/8/3n4/8/8/R1N1K3 b - - 0 1";
  const memory = readBattle(ledger("Nb3 Ra2", fen), fen);
  const terms = memory.bondTerms("w:a1", "w:c1")!;
  assert.equal(terms.danger, 1);
  // The Rook also guarded the forked Knight along the rank while it was attacked: one ply of cover.
  assert.equal(terms.cover, 1);
  assert.equal(memory.bond("w:a1", "w:c1"), .4 + .25);
  // A pair is only counted once it has come through: had the Rook been taken, nothing would bind it.
  const taken = readBattle(ledger("Nb3 Kd1 Nxa1", fen), fen);
  assert.equal(taken.bondTerms("w:a1", "w:c1")!.danger, 0);
});

test("renown: kills by what was taken, a Pawn's march and crown, threats outlived, vengeance", () => {
  const crowned = readBattle(ledger("e4 d5 e5 f5 exf6 Nc6 fxg7 Nf6 gxh8=Q Bg4 Nf3 Qd7 Bb5 O-O-O O-O")).soldier("w:e2")!;
  assert.equal(crowned.terms.kills, 1 + 1 + 2.2, "two Pawns and a Rook");
  assert.equal(crowned.terms.march, 8);
  assert.equal(crowned.terms.crowned, true);
  assert.ok(crowned.renown >= VETERAN);
  assert.equal(crowned.renown, renownValue(crowned.terms));
  // The b-Pawn's raid: two Pawns taken and the seventh rank reached, then cut down: a veteran's fall.
  const raid = readBattle(ledger("b4 c6 b5 a6 bxc6 Nf6 cxb7 Bxb7"));
  const fall = raid.fallAt(7)!;
  assert.equal(fall.victim, "w:b2");
  assert.ok(fall.renown >= VETERAN, `renown ${fall.renown}`);
  assert.equal(fall.loss, "veteran");
  // The Bishop that took it avenged both Pawns of its own, and took a veteran.
  const bishop = raid.soldier("b:c8")!;
  assert.equal(bishop.terms.avenged, 1);
  assert.equal(bishop.terms.slewRenowned, 1);
  assert.equal(bishop.feared, true);
  assert.deepEqual(fall.avenges.map(entry => entry.fallen), ["b:c7", "b:b7"]);
});

test("each fall is told as what it is to its army: the Queen, the King's last guard, a veteran, a companion, a stranger", () => {
  assert.equal(readBattle(ledger("e4 e5 Qh5 Nc6 Qxf7+ Kxf7")).fallAt(5)!.loss, "royal");
  const alone = readBattle(ledger("Rxh2", "6kr/8/8/8/8/8/7P/6K1 b - - 0 1"), "6kr/8/8/8/8/8/7P/6K1 b - - 0 1").fallAt(0)!;
  assert.deepEqual([alone.loss, alone.guard, alone.lastGuard], ["last-guard", true, true]);
  assert.equal(readBattle(ledger("b4 c6 b5 a6 bxc6 Nf6 cxb7 Bxb7")).fallAt(7)!.loss, "veteran");
  const french = readBattle(ledger(FRENCH));
  const companion = french.fallAt(19)!;
  assert.equal(companion.victim, "w:d2");
  assert.equal(companion.loss, "companion");
  assert.equal(companion.mourners[0].id, "w:e2", "the e-Pawn it stood beside");
  assert.ok(companion.mourners[0].bond >= COMPANION);
  const stranger = readBattle(ledger("e4 d5 exd5")).fallAt(2)!;
  assert.equal(stranger.loss, "stranger");
  assert.ok(stranger.mourners[0].bond < COMPANION, "an old comrade is not yet a companion");
  // The mourners are its living allies only, strongest first.
  for (const fall of french.falls) {
    for (const mourner of fall.mourners) assert.equal(french.soldier(mourner.id)!.side, fall.side);
    for (let i = 1; i < fall.mourners.length; i += 1) assert.ok(fall.mourners[i - 1].bond >= fall.mourners[i].bond);
  }
});

test("a capture that takes an ally's killer avenges it, and binds the avenger to the fallen", () => {
  const memory = readBattle(ledger("e4 d5 exd5 Qxd5"));
  const fall = memory.fallAt(3)!;
  assert.equal(fall.killer, "b:d8");
  assert.deepEqual(fall.avenges.map(entry => [entry.fallen, entry.ply]), [["b:d7", 2]]);
  assert.equal(memory.bondTerms("b:d8", "b:d7")!.avenged, 1);
  assert.ok(memory.bond("b:d8", "b:d7") >= 3, "old comrades, and now avenged");
  assert.equal(memory.soldier("b:d8")!.terms.avenged, 1);
});

test("morale: losses weighed by bond and renown, the Queen's fall, check pressure and momentum", () => {
  const fresh = readBattle([]).morale();
  assert.equal(fresh.w.value, .62); assert.equal(fresh.b.value, .62); assert.equal(fresh.edge, 0); assert.equal(fresh.w.mood, "steady");
  const blunder = readBattle(ledger("e4 e5 Qh5 Nc6 Qxf7+ Kxf7"));
  const before = blunder.morale(5), after = blunder.morale(6);
  assert.ok(before.b.pressure >= .045 + .05, "in check after Qxf7+");
  assert.ok(before.w.momentum > 0, "White had just taken a Pawn");
  assert.equal(after.w.queen, .08);
  assert.ok(before.w.value - after.w.value > .2, `the Queen's fall: ${before.w.value} -> ${after.w.value}`);
  assert.ok(after.trend.w < -.2 && after.trend.b > 0);
  assert.ok(after.edge < 0);
  // A loss weighs more for a companion's survivor and a renowned fallen than for a stranger.
  const french = readBattle(ledger(FRENCH));
  const weight = (ply: number) => { const f = french.fallAt(ply)!; return .016 + .045 * Math.min(1, f.renown / 4) + .035 * Math.min(1, (f.mourners[0]?.bond ?? 0) / 3); };
  assert.ok(weight(19) > weight(18), "the companion Pawn cost White more than the stranger Pawn cost Black");
  // Every morale stays within its range, ply by ply.
  for (let ply = 0; ply <= french.plies; ply += 1) for (const side of ["w", "b"] as const) {
    const m = french.morale(ply)[side];
    assert.ok(m.value >= .02 && m.value <= .98);
    assert.ok(Math.abs(m.momentum) <= .12 + 1e-9);
    assert.ok(m.guardLost >= 0 && m.guardLost <= 1);
  }
  // The King alone: his last guard fell and nobody stands beside him.
  const alone = readBattle(ledger("Rxh2", "6kr/8/8/8/8/8/7P/6K1 b - - 0 1"), "6kr/8/8/8/8/8/7P/6K1 b - - 0 1");
  assert.equal(alone.morale().w.guardLost, 1);
  assert.equal(alone.morale().w.guard, .05);
});

test("the memory is the move list's and only the move list's: the same moves, an Undo, a replay", () => {
  const moves = ledger(FRENCH);
  for (const move of moves) Object.freeze(move);
  Object.freeze(moves);
  const once = readBattle(moves), twice = readBattle(moves);
  assert.deepEqual(twice.falls, once.falls);
  assert.deepEqual(twice.morale(), once.morale());
  assert.deepEqual(twice.story(), once.story());
  // Read as the game grows, one ply at a time, it is the same memory as read whole.
  const chronicle = new BattleChronicle();
  for (let k = 0; k <= moves.length; k += 1) chronicle.read(moves.slice(0, k));
  const grown = chronicle.read(moves);
  assert.deepEqual(grown.falls, once.falls);
  assert.deepEqual(grown.morale(), once.morale());
  for (const a of once.soldiers) {
    assert.equal(grown.soldier(a.id)!.renown, a.renown);
    for (const b of once.soldiers) assert.equal(grown.bond(a.id, b.id), once.bond(a.id, b.id));
  }
  // Undo: the shorter list is read afresh, and nothing of the plies taken back remains.
  const undone = chronicle.read(moves.slice(0, 18));
  const prefix = readBattle(moves.slice(0, 18));
  assert.equal(undone.plies, 18);
  assert.equal(undone.fallAt(19), null);
  assert.deepEqual(undone.falls, prefix.falls);
  assert.deepEqual(undone.morale(), prefix.morale());
  assert.equal(undone.bond("w:e2", "w:d2"), prefix.bond("w:e2", "w:d2"));
  // ...and the same moves played again after it are the same memory again.
  assert.deepEqual(chronicle.read(moves).story(), once.story());
});

test("another starting position is read from its FEN, and a move that does not fit the board stops the reading", () => {
  const fen = "6kr/8/8/8/8/8/7P/6K1 b - - 0 1";
  assert.equal(startingFen(`[SetUp "1"]\n[FEN "${fen}"]\n\n1... Rxh2`), fen);
  assert.equal(startingFen("1. e4 e5"), undefined);
  const chronicle = new BattleChronicle();
  assert.equal(chronicle.read([]).soldiers.length, 32);
  assert.equal(chronicle.read([], fen).soldiers.length, 4, "a new start is a new memory");
  // Garbage in: no throw, the plies that fit are kept.
  const broken = readBattle([...ledger("e4 e5"), { color: "w", from: "a3", to: "a4" }, ...ledger("e4 e5 Nf3").slice(2)]);
  assert.equal(broken.plies, 2);
  assert.equal(readBattle([{ color: "b", from: "e2", to: "e4" }]).plies, 0, "the wrong army's figure");
  assert.equal(readBattle([], "not a fen").soldiers.length, 32, "an unreadable start is the usual array");
});

test("the story: companions parted, the renowned, and the avengers", () => {
  const story = readBattle(ledger(FRENCH)).story();
  const parted = story.bondsBroken.find(entry => entry.fallen.id === "w:d2")!;
  assert.equal(parted.survivor.id, "w:e2");
  assert.equal(parted.fallen.name, "the d-file Pawn");
  assert.equal(parted.fallen.square, "c5", "where it fell");
  assert.ok(parted.reasons.some(reason => reason.startsWith("side by side")));
  assert.ok(parted.reasons.includes("old comrades from the first line"));
  for (let i = 1; i < story.bondsBroken.length; i += 1) assert.ok(story.bondsBroken[i - 1].bond >= story.bondsBroken[i].bond);
  const queen = story.renowned.find(entry => entry.soldier.id === "b:d8")!;
  assert.ok(queen.deeds.includes("took the enemy Queen"));
  assert.ok(story.renowned.every(entry => entry.renown >= VETERAN));
  const king = story.avengers.find(entry => entry.avenger.id === "w:e1" && entry.avenged.id === "w:d1")!;
  assert.equal(king.ply, 24);
  assert.equal(story.morale.ply, story.plies);
});

test("names follow the starting array", () => {
  assert.equal(soldierName("n", "g1"), "the King's Knight");
  assert.equal(soldierName("b", "c8"), "the Queen's Bishop");
  assert.equal(soldierName("r", "h8"), "the King's Rook");
  assert.equal(soldierName("q", "d1"), "the Queen");
  assert.equal(soldierName("q", "e3"), "the Queen of e3");
  assert.equal(soldierName("k", "e1"), "the King");
  assert.equal(soldierName("p", "a7"), "the a-file Pawn");
  assert.equal(soldierName("p", "a7", "n"), "the a-file Pawn, crowned Knight");
  assert.equal(soldierName("n", "d4"), "the Knight of d4");
  assert.equal(bondValue({ comrades: 1, shoulder: 100, cover: 100, danger: 100, avenged: 0 }), 1 + 2 + 2 + 1.5, "each term has its cap");
});
