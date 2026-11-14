import assert from "node:assert/strict";
import { test } from "node:test";
import { GameController } from "../../../web/src/core/gameController";
import type { MoveEvent } from "../../../web/src/core/types";
import { captureCompletedMatch } from "../../../shared/play/replay";
import { openReplay } from "../../../shared/showcase/records";
import { replayScriptOf, type ReplayScript } from "../../../shared/play/replay-show";
import type { MatchConfig } from "../../../shared/play/match";
import { CinematicReplay, type ReplayRenderer } from "../showcase/cinematic-replay";

// The scripted duel of shared/play/replay-show.test.ts: quiet opening, two Pawn duels, a Bishop's spell, Qxd8#.
const GAME = ["d2d4", "d7d6", "b1d2", "g7g5", "d2e4", "e7e5", "d4e5", "c8f5", "c1g5", "d6e5", "d1d8"];
const CAPTURES = [7, 9, 10, 11];
const config: MatchConfig = { mode: "local-duel", setting: "scene-02", difficulty: "easy", playerColor: "w", clockMinutes: null, armies: { w: "ivory", b: "sun" } };

async function recorded(): Promise<ReplayScript> {
  const game = new GameController();
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, seed: 4242 });
  for (const move of GAME) assert.equal(await game.tryMove(move.slice(0, 2), move.slice(2, 4)), true);
  const script = replayScriptOf(openReplay(captureCompletedMatch(game.getSnapshot(), config, "transport", "2026-11-12T00:00:00.000Z")))!;
  game.dispose();
  return script;
}

/** The real controller under a stand-in renderer whose moves finish when the test says (or at once). */
function rig(script: ReplayScript, options: { hold?: boolean } = {}) {
  const board = new GameController(), log: string[] = [], performed: MoveEvent[] = [], reached: number[] = [];
  const pending: (() => void)[] = [];
  let scale = 1, heard = false, finished = 0, gameovers = 0, ending: (() => void) | null = null;
  board.setCombatArmies(script.armies);
  board.on("gameover", () => { gameovers += 1; });
  board.setAnimator(event => { performed.push(event); return options.hold ? new Promise<void>(resolve => pending.push(resolve)) : Promise.resolve(); });
  const renderer: ReplayRenderer = {
    replaySettled: true,
    setReplayTimeScale: value => { scale = value; },
    setCaptureCinematics: on => log.push(`cinematics ${on}`),
    ringReplayBell: () => log.push("bell"),
    restoreReplaySound: ply => log.push(`sound at ${ply}`),
    playReplayEnding: () => { log.push("ending"); return new Promise<void>(resolve => { ending = resolve; if (!options.hold) resolve(); }); },
    skipMove: () => log.push("skip move"),
    skipEndCinematic: () => log.push("skip ending"),
  };
  const timers = { setTimeout: ((fn: () => void) => { queueMicrotask(fn); return 0; }) as unknown as typeof setTimeout, clearTimeout: (() => {}) as typeof clearTimeout };
  const replay = new CinematicReplay(board, renderer, script, { setHeard: on => { heard = on; } }, {
    reached: ply => reached.push(ply), finished: () => { finished += 1; },
  }, timers);
  const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise<void>(resolve => setImmediate(resolve)); };
  return { board, replay, log, performed, reached, pending, settle, get scale() { return scale; }, get heard() { return heard; }, get finished() { return finished; }, get gameovers() { return gameovers; }, finishEnding: () => ending?.() };
}

test("played from the start: the bell, every move in turn through the controller, then the ending; never a gameover", async () => {
  const script = await recorded();
  const r = rig(script);
  r.replay.open(0);
  assert.equal(r.heard, false, "silent until played");
  r.replay.play();
  assert.equal(r.heard, true);
  await r.settle();
  assert.deepEqual(r.reached, GAME.map((_, i) => i + 1));
  assert.deepEqual(r.performed.map(event => `${event.from}${event.to}`), GAME);
  assert.equal(r.log.filter(line => line === "bell").length, 1);
  assert.deepEqual(r.log.slice(0, 2), ["sound at 0", "bell"], "the mixer's state, silently, then the bell before the first move");
  assert.equal(r.log.at(-1), "ending"); assert.equal(r.finished, 1); assert.equal(r.gameovers, 0);
  assert.equal(r.replay.isPlaying, false); assert.equal(r.heard, false, "finished: the sound gate closes");
  assert.equal(r.board.getSnapshot().status, "over");
  // Play at the end restarts from the opening position, bell and all.
  r.replay.play(); await r.settle();
  assert.equal(r.log.filter(line => line === "bell").length, 2); assert.equal(r.finished, 2);
  r.replay.dispose(); r.board.dispose();
});

test("pause holds a move in flight still and silent; play picks it up; Next performs one move and holds", async () => {
  const script = await recorded();
  const r = rig(script, { hold: true });
  r.replay.open(0); r.replay.play(); await r.settle();
  assert.equal(r.performed.length, 1); assert.equal(r.replay.isPerforming, true); assert.equal(r.scale, 1);
  r.replay.pause();
  assert.equal(r.scale, 0, "the scene's time stops"); assert.equal(r.heard, false);
  r.replay.setSpeed(2); assert.equal(r.scale, 0, "still held at another speed");
  r.replay.play(); assert.equal(r.scale, 2); assert.equal(r.heard, true);
  r.replay.pause();
  r.pending.shift()!(); await r.settle();
  assert.equal(r.replay.isPerforming, false); assert.equal(r.performed.length, 1, "paused: the next move waits");
  assert.equal(r.scale, 1, "a board at rest idles at its own pace");
  r.replay.next(); await r.settle();
  assert.equal(r.performed.length, 2); assert.equal(r.heard, true); assert.equal(r.scale, 2, "Next performs at the chosen speed");
  r.pending.shift()!(); await r.settle();
  assert.equal(r.performed.length, 2, "and then holds"); assert.equal(r.heard, false); assert.equal(r.replay.position, 2);
  r.replay.dispose(); r.board.dispose();
});

test("a seek rebuilds at once, abandons the move on stage and plays on from there", async () => {
  const script = await recorded();
  const r = rig(script, { hold: true });
  r.replay.open(0); r.replay.play(); await r.settle();
  assert.equal(r.performed.length, 1);
  r.replay.seek(8);
  assert.equal(r.board.getSnapshot().sanList.length, 8); assert.equal(r.replay.position, 8);
  r.pending.shift()!(); await r.settle();
  assert.equal(r.performed.length, 2); assert.equal(`${r.performed[1].from}${r.performed[1].to}`, GAME[8], "the move after the seek ply");
  assert.deepEqual(r.reached, [1, 9]);
  assert.equal(r.log.filter(line => line === "bell").length, 1, "no bell part-way");
  r.replay.seek(0); r.pending.shift()!(); await r.settle();
  assert.equal(r.log.filter(line => line === "bell").length, 2, "back to the start, the bell again");
  r.replay.dispose(); r.board.dispose();
});

test("battles only jumps the quiet moves and performs every capture and the ending", async () => {
  const script = await recorded();
  const r = rig(script);
  r.replay.setBattlesOnly(true);
  r.replay.open(0); r.replay.play(); await r.settle();
  assert.deepEqual(r.performed.map(event => `${event.from}${event.to}`), CAPTURES.map(ply => GAME[ply - 1]));
  assert.ok(r.performed.every(event => event.capture));
  assert.equal(r.log.at(-1), "ending"); assert.equal(r.log.includes("bell"), false, "the opening was jumped");
  assert.equal(r.board.getSnapshot().sanList.length, GAME.length); assert.equal(r.board.getSnapshot().result?.reason, "checkmate");
  r.replay.dispose(); r.board.dispose();
});

test("an older record plays its captures plainly but for the duels it recorded", async () => {
  const script = await recorded();
  const older: ReplayScript = { ...script, seed: null, fidelity: "plain" };
  const r = rig(older);
  r.replay.setBattlesOnly(true);
  r.replay.open(0); r.replay.play(); await r.settle();
  // The two Pawn duels carry their records; the Bishop's spell and the Queen's summon do not.
  assert.deepEqual(r.log.filter(line => line.startsWith("cinematics")), ["cinematics true", "cinematics false", "cinematics true", "cinematics false"]);
  assert.equal(r.board.getMatchSeed(), null);
  r.replay.dispose(); r.board.dispose();
});

test("the last move stepped to with Next is followed by its ending, on a running clock and heard", async () => {
  const script = await recorded();
  const r = rig(script, { hold: true });
  r.replay.open(10); r.replay.next(); await r.settle();
  r.pending.shift()!(); await r.settle();
  assert.equal(r.log.at(-1), "ending");
  assert.equal(r.scale, 1, "the ending's framing runs at the chosen speed, not held still"); assert.equal(r.heard, true);
  r.finishEnding(); await r.settle();
  assert.equal(r.finished, 1); assert.equal(r.heard, false); assert.equal(r.replay.isConcluded, true);
  r.replay.dispose(); r.board.dispose();
});

test("Skip reaches the fight on stage, then the ending's framing", async () => {
  const script = await recorded();
  const r = rig(script, { hold: true });
  r.replay.open(10); r.replay.skip();
  assert.deepEqual(r.log, ["sound at 10"], "nothing on stage, nothing to skip; the mixer's state restored silently");
  r.replay.play(); await r.settle();
  r.replay.skip(); assert.equal(r.log.at(-1), "skip move");
  r.pending.shift()!(); await r.settle();
  assert.equal(r.log.at(-1), "ending"); r.replay.skip(); assert.equal(r.log.at(-1), "skip ending");
  r.finishEnding(); await r.settle();
  assert.equal(r.finished, 1);
  r.replay.dispose(); r.board.dispose();
});
