import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { readBattle } from "./battle-memory";
import {
  attackMap, boardOf, directScore, hangingPieces, kingDangerOf, materialOf, newScoreMemory, phaseOf, readScoreBoard,
  scoreEnding, scoreTension, BLOOD_HALF_LIFE, PERIL_HOLD, SCORE_DWELL, SCORE_FALL_SETTLE, SCORE_RISE, THEME_BREAK, THEME_LEAD,
  type ScoreBoard, type ScoreCue, type ScoreDecision, type ScoreMemory, type ScoreReading,
} from "./match-score";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function board(overrides: Partial<ScoreBoard> = {}): ScoreBoard {
  return { status: "playing", mode: "hotseat", playerColor: "w", fen: START, inCheck: false, busy: false, result: null, moves: [], captured: [], ...overrides };
}

/** A reading with everything quiet, for driving the director directly. */
function reading(overrides: Partial<ScoreReading> = {}): ScoreReading {
  return {
    quiet: false, status: "playing", paused: false, ply: 20, phase: "middlegame", material: { w: 30, b: 30 }, captures: 0, bloodshed: 0,
    hanging: 0, kingDanger: 0, inCheck: false, fight: "none", ending: null, ...overrides,
  };
}

/** Steps the director every 0.25 s from `from` to `to` with the same reading; returns the last decision and every cue change. */
function run(memory: ScoreMemory, r: ScoreReading, from: number, to: number) {
  let last: ScoreDecision | null = null;
  const changes: { at: number; cue: ScoreCue | null; urgent: boolean; rising: boolean }[] = [];
  let cue = memory.cue;
  for (let t = from; t <= to + 1e-9; t += 0.25) {
    last = directScore(memory, r, t);
    if (last.cue !== cue) { changes.push({ at: t, cue: last.cue, urgent: last.urgent, rising: last.rising }); cue = last.cue; }
  }
  return { last: last!, changes };
}

test("the position: material, phase, hanging pieces and a hemmed-in king are read from the FEN", () => {
  const start = boardOf(START);
  assert.deepEqual(materialOf(start), { w: 39, b: 39 });
  assert.equal(phaseOf(0, start), "opening");
  assert.equal(phaseOf(20, start), "middlegame", "the opening ends with move eight");
  assert.equal(hangingPieces(start), 0);
  assert.equal(kingDangerOf(start), 0);
  // White attacks e3 with the d2 and f2 pawns and nothing on rank 5.
  const white = attackMap(start, "w");
  assert.equal(white[20], 1, "e3 is attacked by a pawn");
  assert.equal(white[36], Infinity, "e5 is not attacked");
  // Queens facing each other down the d-file: Black's is undefended, White's is guarded by its king.
  const queens = boardOf("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1");
  assert.equal(hangingPieces(queens), 1);
  assert.equal(phaseOf(40, queens), "endgame", "a queen each and nothing else is an endgame");
  // A king boxed in by a queen and a king: five of its six squares are covered.
  assert.ok(Math.abs(kingDangerOf(boardOf("6k1/5Q2/6K1/8/8/8/8/8 b - - 0 1")) - 5 / 6) < 1e-9);
  // Sliding pieces stop at the first piece in their way.
  const blocked = attackMap(boardOf("4k3/8/8/8/8/8/3P4/3QK3 w - - 0 1"), "w");
  assert.notEqual(blocked[11], Infinity, "the queen defends its own pawn");
  assert.equal(blocked[19], Infinity, "but sees nothing behind it on the file");
});

test("reading the board: recent captures weigh by recency and by what fell; the fight on screen is named", () => {
  const moves = [
    { color: "w" as const, kind: "p", capture: false, check: false },
    { color: "b" as const, kind: "p", capture: false, check: false },
    { color: "w" as const, kind: "p", capture: true, check: false },
    { color: "b" as const, kind: "q", capture: true, check: false },
  ];
  const r = readScoreBoard(board({ moves, captured: [{ kind: "p", color: "b" }, { kind: "n", color: "w" }], busy: true }));
  assert.equal(r.captures, 2);
  // The queen took a knight on the last ply (weight 1, full), the pawn fell one ply before (0.8 x 5/6).
  assert.ok(Math.abs(r.bloodshed - (1 + 0.8 * (5 / 6))) < 1e-9, `bloodshed ${r.bloodshed}`);
  assert.equal(r.fight, "summon", "a Queen taking a piece larger than a Pawn calls her kingdom's summon");
  const duel = readScoreBoard(board({ moves: moves.slice(0, 3), captured: [{ kind: "p", color: "b" }], busy: true }));
  assert.equal(duel.fight, "duel", "Pawn takes Pawn is a directed duel");
  assert.equal(readScoreBoard(board({ moves: moves.slice(0, 3), captured: [{ kind: "p", color: "b" }], busy: false })).fight, "none",
    "once the move has been performed the fight is over");
  const old = readScoreBoard(board({ moves: [...moves, ...Array.from({ length: 6 }, () => ({ color: "w" as const, kind: "n", capture: false, check: false }))], captured: [{ kind: "p", color: "b" }, { kind: "n", color: "w" }] }));
  assert.equal(old.bloodshed, 0, "captures six plies back no longer count");
});

test("endings: a decisive end is a victory unless the player lost to the computer; a draw is a draw", () => {
  assert.equal(scoreEnding({ winner: null }, "w"), "draw");
  assert.equal(scoreEnding({ winner: "w" }, "w"), "victory");
  assert.equal(scoreEnding({ winner: "b" }, "w"), "defeat");
  assert.equal(scoreEnding({ winner: "b" }, null), "victory", "a duel or an exhibition: nobody at the screen lost");
  const ai = readScoreBoard(board({ mode: "ai", playerColor: "b", status: "over", result: { winner: "w", reason: "checkmate" } }));
  assert.equal(ai.ending, "defeat");
  assert.equal(readScoreBoard(board({ mode: "attract" })).quiet, true, "the menu's background game is silent");
});

test("a game opens on the Theme, and the menu's background game has no score", () => {
  const memory = newScoreMemory(0, 148);
  assert.equal(directScore(memory, reading({ phase: "opening", ply: 0 }), 0).cue, "theme");
  assert.equal(directScore(newScoreMemory(0, 148), reading({ quiet: true }), 0).cue, null);
  assert.equal(newScoreMemory(0, 148, 30).cue, null, "a game picked up in the middle skips the Theme");
});

test("the Theme plays out a quiet opening and gives way at its end, under its last note", () => {
  const memory = newScoreMemory(0, 148);
  const { changes } = run(memory, reading({ phase: "opening", ply: 4 }), 0, 160);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cue, "rest");
  assert.ok(Math.abs(changes[0].at - (148 - THEME_LEAD)) < 0.3, `it gives way ${THEME_LEAD} s before its end (${changes[0].at})`);
});

test("check is urgent, even over the Theme; Peril then holds, and the score settles back without flip-flopping", () => {
  const memory = newScoreMemory(0, 148);
  run(memory, reading({ phase: "opening", ply: 6 }), 0, 10);
  const check = directScore(memory, reading({ phase: "opening", ply: 7, inCheck: true }), 10.25);
  assert.equal(check.cue, "peril");
  assert.equal(check.urgent, true);
  // The king steps out at once: Peril stays its hold, its dwell and the settle of a change down the ladder.
  const after = run(memory, reading({ phase: "opening", ply: 8 }), 10.5, 60);
  assert.equal(after.changes.length, 1, "one change back, no flip-flop");
  assert.equal(after.changes[0].cue, "rest", "the Theme does not come back once it has given way");
  assert.ok(after.changes[0].at >= 10.25 + Math.max(SCORE_DWELL.peril, PERIL_HOLD + SCORE_FALL_SETTLE) - 0.3, `Peril held until ${after.changes[0].at}`);
});

test("a capture is felt within a phrase: a fight on screen takes the music up in seconds", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 30);
  assert.equal(memory.cue, "rest", "a quiet middle game sits in Rest");
  const fight = reading({ fight: "capture", captures: 1, bloodshed: 1 });
  const { changes } = run(memory, fight, 30.25, 40);
  assert.equal(changes[0]?.cue, "battle");
  assert.equal(changes[0].rising, true, "a change up the ladder comes on the next two bars");
  assert.ok(changes[0].at - 30.25 <= SCORE_RISE.settle + 0.25, `within ${changes[0].at - 30.25} s of the blow`);
});

test("after the first thirty seconds the Theme gives way to a fight", () => {
  const early = newScoreMemory(0, 148);
  run(early, reading({ phase: "opening", ply: 6 }), 0, 10);
  const soon = run(early, reading({ phase: "opening", ply: 7, fight: "duel", captures: 1, bloodshed: 1 }), 10.25, 20);
  assert.equal(soon.changes.length, 0, "a duel in the first seconds leaves the Theme playing");
  const later = newScoreMemory(0, 148);
  run(later, reading({ phase: "opening", ply: 6 }), 0, 40);
  const { changes } = run(later, reading({ phase: "middlegame", ply: 17, fight: "capture", captures: 1, bloodshed: 1 }), 40.25, 50);
  assert.equal(changes[0]?.cue, "battle");
  assert.ok(changes[0].at - 40.25 <= THEME_BREAK.seconds + 0.3, `the Theme gives way ${changes[0].at - 40.25} s into the fight`);
});

test("the music settles back after a fight, even while nobody moves", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 20);
  run(memory, reading({ fight: "capture", captures: 1, bloodshed: 1 }), 20.25, 26);
  assert.equal(memory.cue, "battle");
  // The fight is over; nobody moves. The capture still weighs on the board (bloodshed 1) but fades with time:
  // first down to Rising once Battle has had its dwell, then to Rest as the capture fades.
  const { changes } = run(memory, reading({ captures: 1, bloodshed: 1 }), 26.25, 200);
  assert.deepEqual(changes.map((c) => c.cue), ["rising", "rest"]);
  assert.ok(changes[0].at >= 26.25 + SCORE_FALL_SETTLE, `Rising at ${changes[0].at}`);
  assert.ok(changes[1].at <= 20.25 + BLOOD_HALF_LIFE * 4, `Rest at ${changes[1].at}, about three half-lives after the blow`);
  assert.ok(changes.every((c) => !c.rising && !c.urgent), "settling back is never hurried");
});

test("one move never flip-flops the score: a brief spike does not change the cue", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 30);
  // A hanging piece for a single second (a threat made and parried within one quick exchange).
  const spike = run(memory, reading({ hanging: 4, kingDanger: 0.4 }), 30.25, 31);
  const back = run(memory, reading(), 31.25, 60);
  assert.deepEqual([...spike.changes, ...back.changes], [], "the wish never settles, so nothing changes");
});

test("hysteresis: tension hovering at a band's edge does not toggle the cue", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 20);
  const changes: (ScoreCue | null)[] = [];
  let cue = memory.cue;
  // Threats swinging across Rising's way up (0.35) and back, but not below Rest's way down (0.22): 0.18 + 0.07 a piece.
  for (let t = 20.25, i = 0; t < 200; t += 0.25, i += 1) {
    const hanging = i % 40 < 20 ? 3 : 1;
    const d = directScore(memory, reading({ hanging }), t);
    if (d.cue !== cue) { changes.push(d.cue); cue = d.cue; }
  }
  assert.deepEqual(changes, ["rising"], "it rises once and stays");
});

test("the endgame is the Last Stand; check still cuts in, and the Last Stand returns", () => {
  const memory = newScoreMemory(0, 148, 60);
  run(memory, reading({ phase: "endgame", material: { w: 9, b: 6 } }), 0, 30);
  assert.equal(memory.cue, "laststand");
  assert.equal(directScore(memory, reading({ phase: "endgame", inCheck: true }), 30.25).cue, "peril");
  const { changes } = run(memory, reading({ phase: "endgame" }), 30.5, 80);
  assert.deepEqual(changes.map((c) => c.cue), ["laststand"]);
});

test("a king hemmed in during the middle game is Peril, out of check too", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 20);
  const { changes } = run(memory, reading({ kingDanger: 0.7 }), 20.25, 30);
  assert.equal(changes[0]?.cue, "peril");
  assert.equal(changes[0].urgent, false, "only check is urgent");
});

test("the end stops the loops and reports its closing cue once; a game taken back resumes the score", () => {
  const memory = newScoreMemory(0, 148, 40);
  run(memory, reading(), 0, 20);
  const end = directScore(memory, reading({ status: "over", ending: "defeat" }), 20.25);
  assert.deepEqual([end.cue, end.sting], [null, "defeat"]);
  assert.equal(directScore(memory, reading({ status: "over", ending: "defeat" }), 20.5).sting, null, "the closing cue is reported once");
  const undone = directScore(memory, reading(), 21);
  assert.equal(undone.cue, "rest", "an undo after the end brings the board's cue back");
  assert.equal(directScore(memory, reading({ status: "over", ending: "victory" }), 30).sting, "victory", "and a new ending reports again");
});

test("pausing is passed on, and tension stays in range", () => {
  const memory = newScoreMemory(0, 148, 40);
  assert.equal(directScore(memory, reading({ paused: true }), 0).paused, true);
  // An exhibition halted mid-game is paused; a game held before its first move (its opening playing) is not.
  const first = { color: "w" as const, kind: "p", capture: false, check: false };
  assert.equal(readScoreBoard(board({ paused: true, moves: [first] })).paused, true);
  assert.equal(readScoreBoard(board({ paused: true })).paused, false);
  const wild = reading({ phase: "endgame", bloodshed: 9, hanging: 12, kingDanger: 1, fight: "summon" });
  assert.equal(scoreTension(wild), 1);
  assert.equal(scoreTension(reading({ phase: "opening" })), 0.08);
});

test("a game taken up mid-way (a replay seeked to a ply) lands on the board's own cue at once, its last captures fresh", () => {
  // A fight just fought: the captures of the last plies are heard as just made, so the score is in Battle at once.
  let memory = newScoreMemory(0, 148, 30);
  let decision = directScore(memory, reading({ ply: 30, captures: 6, bloodshed: 2.2 }), 0);
  assert.equal(decision.cue, "battle");
  // ...and it settles back as a live game would, once those captures are old.
  const { changes } = run(memory, reading({ ply: 30, captures: 6, bloodshed: 2.2 }), 0.25, 240);
  assert.deepEqual(changes.map((c) => c.cue), ["rising", "rest"]);
  // A quiet middle game is Rest, the endgame the Last Stand, check Peril: no Theme, whatever the ply.
  memory = newScoreMemory(0, 148, 24);
  assert.equal(directScore(memory, reading({ ply: 24 }), 0).cue, "rest");
  memory = newScoreMemory(0, 148, 60);
  assert.equal(directScore(memory, reading({ ply: 60, phase: "endgame" }), 0).cue, "laststand");
  memory = newScoreMemory(0, 148, 40);
  decision = directScore(memory, reading({ ply: 40, inCheck: true }), 0);
  assert.equal(decision.cue, "peril");
  assert.equal(decision.urgent, true);
  // Taken up at the opening, it is the Theme.
  assert.equal(directScore(newScoreMemory(0, 148, 1), reading({ ply: 1, phase: "opening" }), 0).cue, "theme");
});

test("morale colours the score: an army losing heart adds tension, and one breaking in the middle game is the Last Stand", () => {
  // Read from the moves alone (the controller's ledger rows carry their squares), as the battle memory reads it.
  const chess = new Chess();
  const moves: ScoreBoard["moves"][number][] = [];
  const captured: { kind: string; color: "w" | "b" }[] = [];
  for (const san of "e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#".split(" ")) {
    const m = chess.move(san);
    moves.push({ color: m.color, kind: m.piece, capture: !!m.captured, check: chess.isCheck(), from: m.from, to: m.to, promotion: m.promotion ?? null });
    if (m.captured) captured.push({ kind: m.captured, color: m.color === "w" ? "b" : "w" });
  }
  const read = readScoreBoard(board({ fen: chess.fen(), moves, captured }));
  const memory = readBattle(moves.map((m) => ({ color: m.color, from: m.from!, to: m.to!, promotion: null })));
  const expected = Math.min(memory.morale().w.value, memory.morale().b.value);
  assert.ok(read.morale && Math.abs(read.morale.low - expected) < 1e-9, `the lower army's morale, as the memory reads it: ${JSON.stringify(read.morale)}`);
  // While a move is on stage it is not counted yet; without squares there is no morale at all.
  const settled = readScoreBoard(board({ fen: chess.fen(), moves, captured, busy: true }));
  assert.equal(settled.morale!.low, Math.min(memory.morale(memory.plies - 1).w.value, memory.morale(memory.plies - 1).b.value));
  assert.equal(readScoreBoard(board({ fen: chess.fen(), moves: moves.map(({ from: _f, to: _t, ...rest }) => rest), captured })).morale, null);

  // Losing heart adds up to 0.1 of tension, nothing while both armies stand steady.
  assert.equal(scoreTension(reading({ morale: { low: 0.55, mood: "steady" } })), scoreTension(reading()));
  assert.ok(Math.abs(scoreTension(reading({ morale: { low: 0.3, mood: "shaken" } })) - scoreTension(reading()) - 0.1) < 1e-9);
  // A middle game in which an army breaks goes up to the Last Stand, as a change up does; steady, it is the board's band.
  const memoryA = newScoreMemory(0, 148, 30);
  directScore(memoryA, reading(), 0);
  const { changes } = run(memoryA, reading({ morale: { low: 0.25, mood: "breaking", breaking: true } }), 30, 60);
  assert.deepEqual(changes.map((c) => [c.cue, c.rising]), [["laststand", true]]);
  const memoryB = newScoreMemory(0, 148, 30);
  assert.equal(directScore(memoryB, reading({ morale: { low: 0.4, mood: "shaken" } }), 0).cue, "rest");
  // Breaking for one ply (the side that lost its Queen first in a trade) is not enough; breaking through a reply is.
  const line = "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nxd4 Qxd4 Qf6 e5 Qb6 Qxb6 axb6 Nc3 Bc5 Bf4 Ne7 O-O-O O-O Bc4 d6 exd6 cxd6 Bxd6 Bxd6 Rxd6 Nf5 Rd5 Be6 Rd2 Bxc4 Rd7 Rfc8 Rxb7 Rxa2 Kb1 Ra1+ Kxa1".split(" ");
  const game = new Chess();
  const rows: ScoreBoard["moves"][number][] = [];
  const taken: { kind: string; color: "w" | "b" }[] = [];
  const at: Record<number, ScoreReading> = {};
  line.forEach((san, i) => {
    const m = game.move(san);
    rows.push({ color: m.color, kind: m.piece, capture: !!m.captured, check: game.isCheck(), from: m.from, to: m.to });
    if (m.captured) taken.push({ kind: m.captured, color: m.color === "w" ? "b" : "w" });
    at[i + 1] = readScoreBoard(board({ fen: game.fen(), moves: [...rows], captured: [...taken] }));
  });
  assert.equal(at[13].morale!.mood, "breaking", "the Queen taken first: Black reads breaking for a ply");
  assert.equal(at[13].morale!.breaking, false);
  assert.equal(at[38].morale!.breaking, true, "White, breaking since the move before");
});

