import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { GameController } from "../../web/src/core/gameController";
import type { MoveEvent } from "../../web/src/core/types";
import { captureCompletedMatch } from "./replay";
import { openReplay } from "../showcase/records";
import type { MatchConfig } from "./match";
import { chooseSpell, type SpellId } from "../../web/src/scene/vfx/spells/spellbook";
import {
  capturesBefore, checkRunAt, decodeArmies, decodeShowSeed, encodeArmies, encodeShowSeed, encodeVoiceLine, hasRecordedFight, lastSpellBefore,
  nextBattle, pawnOrigins, replayNotes, replayScriptOf, showRandom, showSeed, takenThrough, voiceLinesFromComment, withoutVoiceLines,
  withSeededRandom, type HistoryMove,
} from "./replay-show";

// A scripted Local Duel, Aethelgard against Solforiz: two Pawn duels (one each way), a Bishop's spell, and a Queen
// taking the Queen with mate, which is her kingdom's summon and a fatality at Full.
const GAME = ["d2d4", "d7d6", "b1d2", "g7g5", "d2e4", "e7e5", "d4e5", "c8f5", "c1g5", "d6e5", "d1d8"];
const config: MatchConfig = { mode: "local-duel", setting: "scene-01", difficulty: "easy", playerColor: "w", clockMinutes: null, armies: { w: "ivory", b: "sun" } };
const at = "2026-11-12T10:00:00.000Z";

/** What the renderer is handed for a move, compared whole: the fight plan, the choreography and the board facts. */
const handed = (event: MoveEvent) => JSON.parse(JSON.stringify(event));

async function playLive(seed: number) {
  const game = new GameController(), events: MoveEvent[] = [];
  let gameovers = 0;
  game.setCombatArmies(config.armies!);
  game.setAnimator(async event => { events.push(handed(event)); });
  game.on("gameover", () => { gameovers += 1; });
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, seed });
  for (const move of GAME) assert.equal(await game.tryMove(move.slice(0, 2), move.slice(2, 4)), true, move);
  return { game, events, gameovers };
}

test("the live game records its seed and kingdoms; old records still read", async () => {
  const { game } = await playLive(0x5eed1234);
  assert.equal(game.getSnapshot().status, "over"); assert.equal(game.getSnapshot().result?.reason, "checkmate");
  const entry = captureCompletedMatch(game.getSnapshot(), config, "scripted-duel", at);
  assert.match(entry.pgn, /\[CFSeed "5eed1234"\]/); assert.match(entry.pgn, /\[CFArmies "ivory sun"\]/);
  const script = replayScriptOf(openReplay(entry))!;
  assert.equal(script.seed, 0x5eed1234); assert.deepEqual(script.armies, { w: "ivory", b: "sun" });
  assert.equal(script.fidelity, "exact"); assert.deepEqual(replayNotes(script), []);
  assert.deepEqual(script.result, { winner: "w", reason: "checkmate" }); assert.equal(script.mode, "hotseat");
  assert.equal(script.moves.filter(hasRecordedFight).length, 2, "both Pawn duels carry the Combat Director's record");
  // The same record without the two headers is an older one: it reads, plays plainly and says so.
  const older = openReplay({ ...entry, pgn: entry.pgn.replace(/\[CFSeed "[^"]*"\]\n/, "").replace(/\[CFArmies "[^"]*"\]\n/, "") });
  const plain = replayScriptOf(older)!;
  assert.equal(plain.seed, null); assert.equal(plain.fidelity, "plain"); assert.equal(plain.armiesRecorded, false);
  assert.deepEqual(plain.armies, { w: "ivory", b: "sun" });
  assert.equal(replayNotes(plain).length, 2); assert.match(replayNotes(plain)[0], /only the duels it recorded/);
  assert.equal(plain.moves.filter(hasRecordedFight).length, 2);
  game.dispose();
});

test("a replay hands the renderer exactly the moves, fights and choreography the live game did, and never ends a match", async () => {
  const { game, events, gameovers } = await playLive(0x00c0ffee);
  assert.equal(gameovers, 1);
  const script = replayScriptOf(openReplay(captureCompletedMatch(game.getSnapshot(), config, "scripted-duel", at)))!;
  const replay = new GameController(), replayed: MoveEvent[] = [];
  let ended = 0, states = 0;
  replay.setCombatArmies(script.armies);
  replay.setAnimator(async event => {
    replayed.push(handed(event));
    // While a move is performed, nobody can move, undo, resign or start a clock.
    assert.equal(replay.isHumanTurn(), false); assert.equal(replay.getSnapshot().clock.enabled, false);
  });
  replay.on("gameover", () => { ended += 1; });
  replay.on("state", () => { states += 1; });
  replay.beginReplay(script);
  assert.equal(replay.getMatchSeed(), 0x00c0ffee); assert.equal(replay.getSnapshot().mode, "hotseat");
  assert.deepEqual(replay.getSnapshot().replay, { ply: 0, plies: GAME.length });
  assert.equal(await replay.tryMove("e2", "e4"), false); assert.equal(replay.undo(), false);
  replay.resign(); assert.equal(replay.getSnapshot().status, "playing");
  while (await replay.stepReplay()) { /* every move, performed in turn */ }
  assert.deepEqual(replayed, events, "the same MoveEvents, fight plans and choreography");
  assert.ok(replayed.some(event => event.combat?.kind === "sequence"), "a directed duel was replayed from its record");
  assert.equal(ended, 0, "a replay never emits gameover"); assert.ok(states > 0);
  assert.equal(replay.getSnapshot().status, "over"); assert.deepEqual(replay.getSnapshot().result, { winner: "w", reason: "checkmate" });
  assert.equal(replay.getSnapshot().fen, game.getSnapshot().fen); assert.deepEqual(replay.getSnapshot().sanList, game.getSnapshot().sanList);
  assert.equal(await replay.stepReplay(), false);
  game.dispose(); replay.dispose();
});

test("seeking rebuilds the history at that ply, and play goes on from there as the game did", async () => {
  const { game, events } = await playLive(0xdecade01);
  const live = game.getSnapshot();
  const script = replayScriptOf(openReplay(captureCompletedMatch(live, config, "scripted-duel", at)))!;
  const replay = new GameController(), replayed: MoveEvent[] = [];
  replay.setCombatArmies(script.armies);
  replay.setAnimator(async event => { replayed.push(handed(event)); });
  const seeks: { ply: number; from: number }[] = [];
  replay.on("replaySeek", seek => seeks.push(seek));
  replay.beginReplay(script);
  for (const ply of [9, 3, 7, 11, 6]) {
    replay.seekReplay(ply);
    const at = replay.getSnapshot(), reference = new Chess();
    for (const move of GAME.slice(0, ply)) reference.move({ from: move.slice(0, 2), to: move.slice(2, 4) });
    assert.equal(at.fen, reference.fen()); assert.equal(at.sanList.length, ply);
    assert.deepEqual(at.moves, live.moves.slice(0, ply), `ledger at ${ply}, choreography and captures included`);
    assert.equal(at.status, ply === GAME.length ? "over" : "playing");
  }
  assert.deepEqual(seeks.map(seek => seek.ply), [9, 3, 7, 11, 6]);
  // From ply 6 on, the remaining five moves are the live game's, the duels' memory included.
  while (await replay.stepReplay()) { /* play on */ }
  assert.deepEqual(replayed, events.slice(6));
  game.dispose(); replay.dispose();
});

test("a seek during a move abandons it: its continuation changes nothing", async () => {
  const { game } = await playLive(7);
  const script = replayScriptOf(openReplay(captureCompletedMatch(game.getSnapshot(), config, "scripted-duel", at)))!;
  const replay = new GameController();
  let release: () => void = () => {};
  replay.setCombatArmies(script.armies);
  replay.setAnimator(() => new Promise<void>(resolve => { release = resolve; }));
  replay.beginReplay(script, 6);
  const stepping = replay.stepReplay();
  assert.equal(replay.getSnapshot().busy, true);
  replay.seekReplay(2);
  release();
  assert.equal(await stepping, false);
  assert.equal(replay.getSnapshot().sanList.length, 2); assert.equal(replay.getSnapshot().busy, false);
  game.dispose(); replay.dispose();
});

test("history facts are read at the ply: first death, the run of checks, the trays, the kingdom's last spell", () => {
  const ledger: HistoryMove[] = [
    { color: "w", kind: "p", san: "e4", to: "e4", capture: false },
    { color: "b", kind: "p", san: "d5", to: "d5", capture: false },
    { color: "w", kind: "p", san: "exd5", to: "d5", capture: true, captured: "p" },
    { color: "b", kind: "q", san: "Qxd5", to: "d5", capture: true, captured: "p" },
    { color: "w", kind: "b", san: "Bb5+", to: "b5", capture: false },
    { color: "b", kind: "q", san: "Qxb5", to: "b5", capture: true, captured: "b" },
    { color: "w", kind: "b", san: "Bxf7+", to: "f7", capture: true, captured: "p" },
    { color: "b", kind: "k", san: "Kxf7", to: "f7", capture: true, captured: "b" },
  ];
  assert.equal(capturesBefore(ledger, 2), 0); assert.equal(capturesBefore(ledger, 3), 1); assert.equal(capturesBefore(ledger, 8), 5);
  assert.equal(checkRunAt(ledger, 4), 1); assert.equal(checkRunAt(ledger, 5), 0); assert.equal(checkRunAt(ledger, 6), 1);
  assert.deepEqual(takenThrough(ledger, 4), [{ kind: "p", color: "b" }, { kind: "p", color: "w" }]);
  // The engine's rule: casters (Bishop, Queen) cast from their page, but a Queen taking more than a Pawn summons.
  const armies = { w: "ivory", b: "sun" } as const;
  const rules = {
    army: (color: "w" | "b") => armies[color],
    casts: (move: HistoryMove) => (move.kind === "b" || move.kind === "q") && !(move.kind === "q" && move.captured !== "p"),
    draw: (move: HistoryMove, index: number, last: SpellId | null) => chooseSpell(armies[move.color], move.kind, (index + 1) * 7919 + move.to.charCodeAt(0) * 31 + move.to.charCodeAt(1), { last }),
  };
  const sun = rules.draw(ledger[3], 3, null);
  assert.equal(lastSpellBefore(ledger, 3, "sun", rules), null);
  assert.equal(lastSpellBefore(ledger, 8, "sun", rules), sun, "the Queen's summon at 5 casts nothing");
  assert.equal(lastSpellBefore(ledger, 8, "ivory", rules), rules.draw(ledger[6], 6, null));
  assert.equal(nextBattle(ledger, 0), 2); assert.equal(nextBattle(ledger, 4), 5); assert.equal(nextBattle(ledger, 8), null);
  assert.equal(nextBattle([{ capture: false }, { capture: false }], 0), 1, "the ending is always shown");
});

test("seeds: one choice of one ply in one match, the same every time and different elsewhere", () => {
  assert.equal(decodeShowSeed(encodeShowSeed(0x1234abcd)), 0x1234abcd); assert.equal(decodeShowSeed("12g4"), null); assert.equal(decodeShowSeed(undefined), null);
  assert.deepEqual(decodeArmies(encodeArmies({ w: "empire", b: "kwind" })), { w: "empire", b: "kwind" });
  assert.equal(decodeArmies("ivory"), null); assert.equal(decodeArmies("ivory sun empire"), null); assert.equal(decodeArmies("ivory orcs"), null);
  const moves = ["e4", "d5", "exd5"];
  assert.equal(showSeed(1, moves, "plea"), showSeed(1, [...moves], "plea"));
  assert.notEqual(showSeed(1, moves, "plea"), showSeed(2, moves, "plea"));
  assert.notEqual(showSeed(1, moves, "plea"), showSeed(1, moves, "cry"));
  assert.notEqual(showSeed(1, moves, "plea"), showSeed(1, moves.slice(0, 2), "plea"));
  const a = showRandom(99), b = showRandom(99);
  for (let i = 0; i < 5; i += 1) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test("the seeded seam draws the same choices and always gives Math.random back", () => {
  const original = Math.random;
  const draw = () => [Math.random(), Math.random(), Math.random()];
  assert.deepEqual(withSeededRandom(42, draw), withSeededRandom(42, draw));
  assert.notDeepEqual(withSeededRandom(42, draw), withSeededRandom(43, draw));
  assert.equal(Math.random, original);
  assert.throws(() => withSeededRandom(1, () => { throw new Error("mixer failed"); }), /mixer failed/);
  assert.equal(Math.random, original);
});

test("an AI Battle replays as the exhibition it was; an older one names its kingdoms in its titles", async () => {
  // The moves are played by hand here; what the record says about the match is what is under test.
  const game = new GameController();
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, seed: 99 });
  for (const move of ["f2f3", "e7e5", "g2g4", "d8h4"]) assert.equal(await game.tryMove(move.slice(0, 2), move.slice(2, 4)), true);
  const battle: MatchConfig = { mode: "ai-battle", setting: "scene-02", difficulty: "easy", playerColor: "w", clockMinutes: null, armies: { w: "empire", b: "kwind" } };
  const entry = captureCompletedMatch(game.getSnapshot(), battle, "battle-record", at);
  const script = replayScriptOf(openReplay(entry))!;
  assert.equal(script.mode, "demo"); assert.deepEqual(script.armies, { w: "empire", b: "kwind" }); assert.equal(script.armiesRecorded, true);
  assert.deepEqual(script.result, { winner: "b", reason: "checkmate" });
  const older = replayScriptOf(openReplay({ ...entry, pgn: entry.pgn.replace(/\[CFArmies "[^"]*"\]\n/, "") }))!;
  assert.deepEqual(older.armies, { w: "empire", b: "kwind" }, "Computer Korvenia against Computer Kwind-09");
  assert.equal(older.armiesRecorded, true); assert.deepEqual(replayNotes(older), []);
  // A Classic game played as Black: the replay's seat and closing cue are the player's.
  const classic = replayScriptOf(openReplay(captureCompletedMatch(game.getSnapshot(), { ...battle, mode: "classic", playerColor: "b" }, "classic-record", at)))!;
  assert.equal(classic.mode, "ai"); assert.equal(classic.playerColor, "b");
  const replay = new GameController();
  replay.beginReplay(script);
  assert.equal(replay.getSnapshot().mode, "demo"); assert.equal(replay.getSnapshot().demo?.autoRematch, false);
  assert.equal(replay.getSnapshot().thinking, false, "no computer thinks in a replay");
  game.dispose(); replay.dispose();
});

test("a computer battle still plays itself live; its replay never asks the computer", async () => {
  // The computer, answered at once with the first legal move (the search worker is the browser's).
  type Computer = { bestMove(fen: string): Promise<unknown>; cancel(): void; dispose(): void };
  const asked: string[] = [];
  const computer: Computer = { cancel() {}, dispose() {}, bestMove(fen) {
    asked.push(fen);
    const move = new Chess(fen).moves({ verbose: true })[0];
    return Promise.resolve(move ? { from: move.from, to: move.to, promotion: null, score: 0, depth: 1 } : null);
  } };
  const until = async (done: () => boolean) => { for (let i = 0; i < 150 && !done(); i += 1) await new Promise(resolve => setTimeout(resolve, 20)); };
  const battle = new GameController();
  (battle as unknown as { ai: Computer }).ai = computer;
  battle.setAnimator(async () => {});
  battle.start({ mode: "demo", difficulty: "easy", playerColor: "w", clockMinutes: null, demo: { white: "easy", black: "easy", speed: 10, autoRematch: false } });
  await until(() => battle.getSnapshot().sanList.length >= 2);
  assert.ok(battle.getSnapshot().sanList.length >= 2, "the computer plays both sides from the start");
  assert.equal(battle.getSnapshot().paused, false); assert.equal(battle.getSnapshot().engineError ?? null, null);
  assert.match(battle.getSnapshot().pgn, /\[CFSeed "[0-9a-f]{8}"\]/);
  battle.dispose();
  asked.length = 0;
  const replay = new GameController();
  (replay as unknown as { ai: Computer }).ai = computer;
  replay.setAnimator(async () => {});
  replay.beginReplay({ initialFen: new Chess().fen(), moves: [{ from: "e2", to: "e4", comment: null }, { from: "e7", to: "e5", comment: null }], seed: 7, result: null, mode: "demo", playerColor: "w" });
  assert.equal(await replay.stepReplay(), true); assert.equal(await replay.stepReplay(), true);
  replay.seekReplay(1); replay.setPaused(true); replay.setPaused(false);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(asked, [], "a replay never asks the computer, whatever its transport does");
  assert.equal(replay.getSnapshot().paused, false); assert.equal(replay.getSnapshot().sanList.length, 1);
  replay.dispose();
});

test("the lines the pieces said are kept with their moves, and a replay hands them back ply by ply", async () => {
  const murmur = encodeVoiceLine({ clip: "sun_q_murmur_1", moment: "murmur", square: "d8", offset: 4.73 });
  assert.equal(murmur, "[%cfvoice sun_q_murmur_1 murmur d8 4.73]");
  const lines = voiceLinesFromComment(`[%cfcombat 1 x] ${encodeVoiceLine({ clip: "ivory_p1_killer_2", moment: "land", square: "e5", offset: 0.3 })} ${encodeVoiceLine({ clip: "ivory_k_castle_1", moment: "rook", square: null, offset: 0 })} [%cfvoice BAD land e5 1]`);
  assert.deepEqual(lines, [
    { clip: "ivory_p1_killer_2", moment: "land", square: "e5", offset: 0.3 },
    { clip: "ivory_k_castle_1", moment: "rook", square: null, offset: 0 },
  ]);
  assert.equal(withoutVoiceLines(`[%cfcombat 1 x] ${murmur}`), "[%cfcombat 1 x]");
  assert.throws(() => encodeVoiceLine({ clip: "../x", moment: "land", square: null, offset: 0 }), /Unrecordable/);

  const game = new GameController();
  game.setCombatArmies(config.armies!);
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, seed: 5 });
  game.annotate(murmur);                                       // said as the game began, before any move
  assert.equal(await game.tryMove("e2", "e4"), true);
  game.annotate(encodeVoiceLine({ clip: "ivory_p1_moved_1", moment: "lift", square: "e2", offset: 0 }));
  assert.equal(await game.tryMove("d7", "d5"), true);
  assert.equal(await game.tryMove("e4", "d5"), true);         // a Pawn duel: its combat token and its lines share the comment
  game.annotate(encodeVoiceLine({ clip: "ivory_p1_killer_1", moment: "land", square: "d5", offset: 0.4 }));
  // Taken back and played again: the earlier take's lines are not said twice.
  assert.equal(game.undo(), true);
  assert.equal(await game.tryMove("e4", "d5"), true);
  game.annotate(encodeVoiceLine({ clip: "sun_p2_stranger_1", moment: "land", square: "c7", offset: 1.2 }));
  game.resign();
  const script = replayScriptOf(openReplay(captureCompletedMatch(game.getSnapshot(), config, "spoken", at)))!;
  assert.deepEqual(voiceLinesFromComment(script.openingComment), [{ clip: "sun_q_murmur_1", moment: "murmur", square: "d8", offset: 4.73 }]);
  assert.deepEqual(voiceLinesFromComment(script.moves[0].comment).map(line => line.clip), ["ivory_p1_moved_1"]);
  assert.deepEqual(voiceLinesFromComment(script.moves[2].comment).map(line => line.clip), ["sun_p2_stranger_1"]);
  assert.ok(hasRecordedFight(script.moves[2]), "the duel's record is kept beside the lines");
  const replay = new GameController();
  replay.setCombatArmies(script.armies);
  replay.beginReplay(script);
  assert.equal(replay.getReplayComment(0), script.openingComment);
  assert.equal(replay.getReplayComment(3), script.moves[2].comment);
  replay.annotate(encodeVoiceLine({ clip: "sun_k_idle_1", moment: "idle", square: "e8", offset: 30 }));
  assert.equal(replay.getReplayComment(0), script.openingComment, "a replay records nothing of its own");
  assert.equal(game.getReplayComment(1), null, "a live game has no replay comments");
  game.dispose(); replay.dispose();
});

test("each footsoldier keeps the voice of the file it started on, however the board got here", () => {
  const chess = new Chess();
  for (const san of ["e4", "d5", "exd5", "c6", "dxc6", "bxc6", "a4", "h5"]) chess.move(san);
  const origins = pawnOrigins(chess.pgn());
  assert.equal(origins.get("c6"), "b7", "the b-pawn that took on c6");
  assert.equal(origins.get("a4"), "a2"); assert.equal(origins.get("h5"), "h7");
  assert.equal(origins.has("d5"), false); assert.equal(origins.has("e4"), false, "the e-pawn was taken on c6");
  assert.equal(origins.size, 13, "three footsoldiers have fallen");
});
