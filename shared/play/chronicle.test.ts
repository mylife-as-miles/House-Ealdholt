import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { chronicleFacts, chronicleHeadline, fallenList, recordRenown, replayHeadline, storyRenown, writeChronicle, type ChronicleRecord, type RenownSource } from "./chronicle";
import { readBattle } from "./battle-memory";

const SIDES = { w: "Aethelgard", b: "Solforiz" } as const;
const FOOL = ["f3", "e5", "g4", "Qh4#"];
const SCHOLAR = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
const record = (sanMoves: string[], result: ChronicleRecord["result"], sides: ChronicleRecord["sides"] = SIDES): ChronicleRecord => ({ sanMoves, result, sides });

test("a checkmate: which kingdom fell, in how many moves, how its King yielded and to whom", () => {
  const chronicle = writeChronicle(record(SCHOLAR, { winner: "w", reason: "checkmate" }));
  assert.equal(chronicle.title, "The fall of Solforiz");
  assert.deepEqual(chronicle.lines, [
    "Solforiz fell in 4 moves.",
    "Its King was not slain: he yielded on e8, checkmated by the Aethelgard Queen.",
    "Fallen defending the crown: a Pawn.",
    "Aethelgard lost no one.",
    "Renowned: the Aethelgard Queen, who gave the final check.",
  ]);
  const fool = writeChronicle(record(FOOL, { winner: "b", reason: "checkmate" }));
  assert.equal(fool.lines[0], "Aethelgard fell in 2 moves.");
  assert.equal(fool.lines[2], "Not one of Aethelgard's soldiers fell.");
});

test("it is written from the record: the same game read from its PGN says the same, and nothing says the King died", () => {
  const game = new Chess();
  for (const move of SCHOLAR) game.move(move);
  game.setComment("[%cfcombat 1 x]");
  const fromPgn = writeChronicle({ pgn: game.pgn(), result: { winner: "w", reason: "checkmate" }, sides: SIDES });
  assert.deepEqual(fromPgn, writeChronicle(record(SCHOLAR, { winner: "w", reason: "checkmate" })));
  for (const line of fromPgn.lines) assert.doesNotMatch(line, /\b(died|dies|death|slew|killed)\b/i);
});

test("who fell defending the crown is counted by rank, in the game's own words", () => {
  const facts = chronicleFacts(record(["e4", "d5", "exd5", "Qxd5", "Nc3", "Qxa2", "Rxa2", "e5", "Rxa7", "Rxa7"], { winner: "b", reason: "resignation" }));
  const white = facts.figures.filter(figure => figure.side === "w" && figure.fell), black = facts.figures.filter(figure => figure.side === "b" && figure.fell);
  assert.equal(fallenList(white), "a Rook and two Pawns");
  assert.equal(fallenList(black), "the Queen and two Pawns");
  assert.equal(fallenList([]), "");
  const chronicle = writeChronicle(record(["e4", "d5", "exd5", "Qxd5", "Nc3", "Qxa2", "Rxa2", "e5", "Rxa7", "Rxa7"], { winner: "b", reason: "resignation" }));
  assert.equal(chronicle.title, "Aethelgard yields");
  assert.deepEqual(chronicle.lines.slice(0, 4), [
    "Aethelgard yielded after 5 moves.",
    "Its King was not slain: he yielded the field on e1.",
    "Fallen defending the crown: a Rook and two Pawns.",
    "Solforiz lost the Queen and two Pawns.",
  ]);
});

test("the renowned are read off the record: the final check, the most taken, the crowned", () => {
  const moves = ["e4", "d5", "exd5", "c6", "dxc6", "Qd7", "cxb7", "Kd8", "bxa8=Q"];
  const chronicle = writeChronicle(record(moves, { winner: "w", reason: "timeout" }));
  assert.equal(chronicle.title, "Solforiz's time ran out");
  assert.equal(chronicle.lines[1], "Its King was not slain: he yielded on d8 when his time was gone.");
  assert.equal(chronicle.lines[chronicle.lines.length - 1], "Renowned: the Aethelgard e-file Pawn, who took four and was crowned a Queen on a8.");
  const facts = chronicleFacts(record(moves, { winner: "w", reason: "timeout" }));
  const pawn = facts.figures.find(figure => figure.origin === "e2")!;
  assert.equal(pawn.rank, "q"); assert.equal(pawn.born, "p"); assert.deepEqual(pawn.crowned, { rank: "q", on: "a8", ply: 8 });
  assert.equal(pawn.took.length, 4);
  // En passant and castling keep every piece's identity: the pawn taken is the one that stood beside, the rook goes with its King.
  const tricky = chronicleFacts(record(["e4", "a6", "e5", "d5", "exd6", "e6", "Nf3", "Qxd6", "Be2", "Qd8", "O-O"], { winner: null, reason: "draw" }));
  assert.equal(tricky.figures.find(figure => figure.origin === "d7")!.fell?.by, "e2");
  assert.equal(tricky.figures.find(figure => figure.origin === "h1")!.square, "f1");
  assert.equal(tricky.figures.find(figure => figure.origin === "e2")!.fell?.by, "d8");
});

test("a mate by a crowned Pawn names it by its file and what it had become", () => {
  const start = "7k/4P3/6K1/8/8/8/8/8 w - - 0 1";
  const game = new Chess(start);
  game.move("e8=Q#");
  assert.ok(game.isCheckmate());
  const chronicle = writeChronicle({ startFen: start, sanMoves: ["e8=Q#"], result: { winner: "w", reason: "checkmate" }, sides: SIDES });
  assert.equal(chronicle.lines[0], "Solforiz fell in 1 move.");
  assert.equal(chronicle.lines[1], "Its King was not slain: he yielded on h8, checkmated by the Aethelgard e-file Pawn, crowned Queen.");
});

test("a piece is named by its post in the starting array, never by its starting square alone: the Opera game's mating Rook", () => {
  // The h1 Rook went to d1 and gave mate from d8. "The Rook from h1" read as if it had moved from h1.
  const opera = ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5",
    "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+", "Nxd7", "Qb8+", "Nxb8", "Rd8#"];
  const chronicle = writeChronicle(record(opera, { winner: "w", reason: "checkmate" }));
  assert.equal(chronicle.lines[1], "Its King was not slain: he yielded on e8, checkmated by the Aethelgard King's Rook.");
  assert.equal(chronicle.lines[chronicle.lines.length - 1],
    "Renowned: the Aethelgard King's Rook, who gave the final check; the Aethelgard King's Bishop, who took two; the Solforiz King's Knight, who took two.");
  for (const line of chronicle.lines) assert.doesNotMatch(line, /\bfrom [a-h][1-8]\b/, line);
  // Off its post (a set-up position), a piece keeps the memory's own name: "the Knight of c3".
  const set = writeChronicle({ startFen: "4k3/8/8/8/8/2N5/8/4K3 w - - 0 1", sanMoves: ["Nd5"], result: { winner: "w", reason: "resignation" }, sides: SIDES },
    () => [{ side: "w", rank: "n", origin: "c3", deeds: ["held the centre"] }]);
  assert.equal(set.lines[set.lines.length - 1], "Renowned: the Aethelgard Knight of c3, who held the centre.");
});

test("draws and stalemates say that neither crown fell, and why", () => {
  const draw = writeChronicle(record(["e4", "e5"], { winner: null, reason: "stalemate" }));
  assert.equal(draw.title, "Neither crown fell");
  assert.match(draw.lines[0], /^The battle ended in a draw after 1 move, by stalemate/);
  assert.equal(draw.lines[1], "No one fell on either side.");
  assert.equal(chronicleHeadline(record(["e4"], { winner: null, reason: "threefold" })), "Neither crown fell. A draw after 1 move.");
});

test("renown comes through a small interface: another source replaces it and changes nothing else", () => {
  const story: RenownSource = (facts) => [{ side: "w", rank: "n", origin: "g1", deeds: ["stood beside the King's Bishop to the end"] }].filter(() => facts.plies > 0);
  const base = writeChronicle(record(SCHOLAR, { winner: "w", reason: "checkmate" }));
  const swapped = writeChronicle(record(SCHOLAR, { winner: "w", reason: "checkmate" }), story);
  assert.deepEqual(swapped.lines.slice(0, -1), base.lines.slice(0, -1));
  assert.equal(swapped.lines[swapped.lines.length - 1], "Renowned: the Aethelgard King's Knight, who stood beside the King's Bishop to the end.");
  assert.deepEqual(writeChronicle(record(SCHOLAR, { winner: "w", reason: "checkmate" }), () => []).lines, base.lines.slice(0, -1), "no renown, no line");
  assert.ok(recordRenown(chronicleFacts(record(SCHOLAR, { winner: "w", reason: "checkmate" })), record(SCHOLAR, { winner: "w", reason: "checkmate" })).length <= 3);
});

test("a side whose kingdom the record does not know is named plainly (the Quest replay's headline)", () => {
  assert.equal(chronicleHeadline(record(FOOL, { winner: "b", reason: "checkmate" }, { w: "White", b: "Black" })), "White fell in 2 moves.");
  assert.equal(chronicleHeadline(record(["e4"], { winner: "w", reason: "resignation" }, { w: "White", b: "Black" })), "Black yielded after 1 move.");
});

test("a replay's result line: the headline when the record says how it ended and the line fits, otherwise nothing", () => {
  const start = new Chess().fen();
  assert.equal(replayHeadline({ moves: FOOL, initialFen: start, result: "0-1", termination: "checkmate" }), "White fell in 2 moves.");
  assert.equal(replayHeadline({ moves: ["e4"], initialFen: start, result: "1-0", termination: "recorded", match: { reason: "resignation" } }), "Black yielded after 1 move.");
  assert.equal(replayHeadline({ moves: ["e4"], initialFen: start, result: "*", termination: "move-limit" }), null);
  assert.equal(replayHeadline({ moves: ["e4"], initialFen: start, result: "1-0", termination: "imported" }), null, "an import that does not say how it ended");
  assert.equal(replayHeadline({ moves: ["e4", "e5"], initialFen: start, result: "1/2-1/2", termination: "draw" }), null, "too long for the line: the caller keeps its own words");
  assert.equal(replayHeadline({ moves: ["e4", "e5"], initialFen: start, result: "1/2-1/2", termination: "draw" }, 60), "Neither crown fell. A draw after 1 move.");
});

test("in the game it tells the battle memory's story: its renowned, a companionship a death broke, an avenging, in its own names", () => {
  const sans = ["d4", "d6", "Nd2", "g5", "Ne4", "e5", "dxe5", "Bf5", "Bxg5", "dxe5", "Qxd8#"];
  const game = new Chess();
  for (const san of sans) game.move(san);
  const moves = game.history({ verbose: true }).map(move => ({ color: move.color, from: move.from, to: move.to, promotion: move.promotion ?? null }));
  const story = readBattle(moves).story();
  const chronicle = writeChronicle(record(sans, { winner: "w", reason: "checkmate" }), storyRenown(story), story);
  const plain = writeChronicle(record(sans, { winner: "w", reason: "checkmate" }));
  // What the record says stays as it was: the fall, the King's yielding, the fallen.
  assert.deepEqual(chronicle.lines.slice(0, 4), plain.lines.slice(0, 4));
  const renowned = chronicle.lines.find(line => line.startsWith("Renowned: "));
  if (story.renowned.some(entry => entry.deeds.length)) {
    const first = story.renowned.find(entry => entry.deeds.length)!;
    assert.ok(renowned?.includes(`the ${SIDES[first.soldier.side]} ${first.soldier.name.replace(/^the /, "")}, who ${first.deeds[0]}`), renowned);
  }
  if (story.bondsBroken.length) assert.ok(chronicle.lines.some(line => line.startsWith("Companions parted: ") && line.includes(story.bondsBroken[0].survivor.name)));
  if (story.avengers.length) assert.ok(chronicle.lines.some(line => line.startsWith("Avenged: ")));
  for (const line of chronicle.lines) assert.doesNotMatch(line, /\b(died|dies|death|slew|killed)\b/i);
  assert.ok(story.renowned.length + story.bondsBroken.length + story.avengers.length > 0, "the scripted game has a story to tell");
});
