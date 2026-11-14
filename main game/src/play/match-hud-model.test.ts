import assert from "node:assert/strict";
import test from "node:test";
import { activeSide, capturedBy, capturedWorth, formatClock, hudTier, materialLead, movePairs, resultSummary, sideRole, sideState, stageSize, statusLine, queuedAnnouncement, tapAnnouncement, viewHints } from "./match-hud-model";

const names = (side: "w" | "b") => (side === "w" ? "Aethelgard" : "Solforiz");
const playing = { status: "playing" as const, turn: "w" as const, result: null, thinking: false, inCheck: false, paused: false };

test("a clock reads as minutes and seconds and never below zero", () => {
  assert.equal(formatClock(300000), "5:00");
  assert.equal(formatClock(299999), "4:59");
  assert.equal(formatClock(61000), "1:01");
  assert.equal(formatClock(-40), "0:00");
  assert.equal(formatClock(905000), "15:05");
});

test("the screens the HUD is laid out for fall in the tier that fits them", () => {
  // The checks drive every action by its button at 1280 by 720 and 1280 by 800: those must be the whole HUD.
  for (const [width, height] of [[1600, 900], [1440, 900], [1280, 720], [1280, 800], [1920, 1080]]) assert.equal(hudTier(width, height), "wide", `${width}x${height}`);
  assert.equal(hudTier(1024, 768), "mid");
  // A phone in landscape is pillarboxed to 16:9 before the HUD sees it.
  const [width, height] = stageSize(844, 390);
  assert.ok(Math.abs(width - 699.2) < 0.5 && height === 390);
  assert.equal(hudTier(width, height), "small");
  assert.deepEqual(stageSize(1600, 900), [1600, 900]);
  assert.equal(hudTier(390, 844), "small");
});

test("moves are paired by number, the last pair open until Black replies", () => {
  assert.deepEqual(movePairs([]), []);
  assert.deepEqual(movePairs(["e4"]), [{ number: 1, white: "e4", black: null }]);
  assert.deepEqual(movePairs(["e4", "d5", "exd5", "Qxd5", "Nc3"]), [
    { number: 1, white: "e4", black: "d5" }, { number: 2, white: "exd5", black: "Qxd5" }, { number: 3, white: "Nc3", black: null },
  ]);
});

test("a side's captures are the other side's pieces, the most valuable first", () => {
  const captured = [{ kind: "p", color: "b" }, { kind: "p", color: "w" }, { kind: "q", color: "b" }, { kind: "p", color: "b" }, { kind: "n", color: "w" }] as const;
  assert.deepEqual(capturedBy(captured, "w"), [{ kind: "q", count: 1 }, { kind: "p", count: 2 }]);
  assert.deepEqual(capturedBy(captured, "b"), [{ kind: "n", count: 1 }, { kind: "p", count: 1 }]);
  assert.equal(capturedWorth(capturedBy(captured, "w")), 11);
  assert.equal(materialLead(7, "w"), 7);
  assert.equal(materialLead(7, "b"), 0);
  assert.equal(materialLead(-2, "b"), 2);
});

test("each side is led by who the mode says", () => {
  assert.equal(sideRole({ mode: "classic", playerColor: "b" }, "b"), "You");
  assert.equal(sideRole({ mode: "classic", playerColor: "b" }, "w"), "Computer");
  assert.equal(sideRole({ mode: "local-duel", playerColor: "w" }, "w"), "Player 1");
  assert.equal(sideRole({ mode: "local-duel", playerColor: "w" }, "b"), "Player 2");
  assert.equal(sideRole({ mode: "ai-battle", playerColor: "w" }, "b"), "Computer");
});

test("only the side to move is lit, and it says whether it is thinking, in check or held", () => {
  assert.equal(sideState(null, "w"), "waiting");
  assert.equal(sideState(playing, "w"), "move");
  assert.equal(sideState(playing, "b"), "waiting");
  assert.equal(activeSide(playing), "w");
  assert.equal(sideState({ ...playing, inCheck: true }, "w"), "check");
  assert.equal(sideState({ ...playing, turn: "b", thinking: true, inCheck: true }, "b"), "thinking");
  assert.equal(sideState({ ...playing, turn: "b", paused: true }, "b"), "paused");
  assert.equal(sideState({ ...playing, status: "idle" }, "w"), "waiting");
  assert.equal(activeSide({ ...playing, status: "idle" }), null);
});

test("a finished game lights the winner; a draw lights neither", () => {
  const won = { ...playing, status: "over" as const, result: { winner: "b" as const, reason: "checkmate" as const } };
  assert.equal(sideState(won, "b"), "won");
  assert.equal(sideState(won, "w"), "lost");
  assert.equal(activeSide(won), "b");
  const drawn = { ...playing, status: "over" as const, result: { winner: null, reason: "stalemate" as const } };
  assert.equal(sideState(drawn, "w"), "drawn");
  assert.equal(activeSide(drawn), null);
});

test("the status sentence is the one the old header carried", () => {
  assert.deepEqual(statusLine(null, names), { headline: "Aethelgard to move", note: null });
  assert.deepEqual(statusLine({ turn: "b", result: null, thinking: true, inCheck: true }, names), { headline: "Solforiz to move", note: "Thinking…" });
  assert.deepEqual(statusLine({ turn: "w", result: null, thinking: false, inCheck: true }, names), { headline: "Aethelgard to move", note: "Check" });
  assert.deepEqual(statusLine({ turn: "w", result: { winner: "b", reason: "checkmate" }, thinking: false, inCheck: true }, names), { headline: "Solforiz wins", note: null });
  assert.deepEqual(statusLine({ turn: "w", result: { winner: null, reason: "threefold" }, thinking: false, inCheck: false }, names), { headline: "Draw", note: null });
});

test("the result says who won and why", () => {
  assert.deepEqual(resultSummary({ winner: "b", reason: "checkmate" }, names), { reason: "Checkmate", title: "Solforiz wins", line: "Aethelgard is checkmated." });
  assert.deepEqual(resultSummary({ winner: "w", reason: "resignation" }, names), { reason: "Resignation", title: "Aethelgard wins", line: "Solforiz resigned." });
  assert.deepEqual(resultSummary({ winner: "w", reason: "timeout" }, names), { reason: "Time out", title: "Aethelgard wins", line: "Solforiz ran out of time." });
  assert.deepEqual(resultSummary({ winner: null, reason: "stalemate" }, names), { reason: "Stalemate", title: "Draw", line: "No legal move remains." });
  assert.equal(resultSummary({ winner: null, reason: "draw" }, names).title, "Draw");
});

test("a press from the keyboard is read out as what it did", () => {
  const board: Record<string, string> = { g1: "Aethelgard Knight", e1: "Aethelgard King", d8: "Solforiz Queen" };
  const pieceAt = (square: string) => board[square] ?? null;
  assert.equal(tapAnnouncement({ type: "select", square: "g1" }, "g1", pieceAt, 2, false), "Aethelgard Knight on G1 selected. 2 legal moves.");
  assert.equal(tapAnnouncement({ type: "select", square: "e1" }, "e1", pieceAt, 1, true), "Aethelgard King on E1 selected. 1 legal move.");
  assert.equal(tapAnnouncement({ type: "move", from: "g1", to: "f3" }, "f3", pieceAt, 0, false), "G1 to F3.");
  assert.equal(tapAnnouncement({ type: "deselect" }, "g1", pieceAt, 0, false), "Selection cleared.");
  assert.equal(tapAnnouncement({ type: "release" }, "g1", pieceAt, 0, false), "Selection cleared.");
  // A refusal says so, and says why when the King is in check.
  assert.equal(tapAnnouncement({ type: "reject", from: "g1" }, "g5", pieceAt, 0, false), "G5 is not a legal move.");
  assert.equal(tapAnnouncement({ type: "reject", from: "g1" }, "g5", pieceAt, 0, true), "G5 is not a legal move. Your King is in check.");
  assert.equal(tapAnnouncement({ type: "stuck", square: "e1" }, "e1", pieceAt, 0, false), "Aethelgard King on E1 has no legal move.");
  assert.equal(tapAnnouncement({ type: "stuck", square: "g1" }, "g1", pieceAt, 0, true), "Aethelgard Knight on G1 has no legal move. Your King is in check.");
  // A piece pressed while a move is still on stage is kept, not dropped.
  assert.equal(tapAnnouncement({ type: "hold", square: "d8" }, "d8", pieceAt, 0, false), "Solforiz Queen on D8 will be selected when the board is free. Choose a square now to queue its move.");
  // ...and told where to go, it is a queued move.
  assert.equal(tapAnnouncement({ type: "queue", from: "d8", to: "h4" }, "h4", pieceAt, 0, false), "Solforiz Queen on D8 to H4 queued. It is played when the board is free, if it is legal then.");
  // A press that only hurries the move on stage reads the square, as the arrows do.
  assert.equal(tapAnnouncement({ type: "hurry" }, "e4", pieceAt, 0, false), "E4, empty.");
  // Nothing done: the square is read as the arrows read it.
  assert.equal(tapAnnouncement({ type: "none" }, "e4", pieceAt, 0, false), "E4, empty.");
  assert.equal(tapAnnouncement({ type: "none" }, "d8", pieceAt, 0, false), "D8, Solforiz Queen.");
});

test("a queued move says how it ended, and says nothing when it was only let go", () => {
  assert.equal(queuedAnnouncement("played"), "The queued move is played.");
  assert.equal(queuedAnnouncement("refused"), "The queued move is not legal now. Nothing is played.");
  assert.equal(queuedAnnouncement("let-go"), null);
  assert.equal(queuedAnnouncement(undefined), null);
});

test("the view's controls are shown as the device in use names them", () => {
  // The keyboard: what MatchExperience and the HUD read (Shift with an arrow, + and -, R).
  assert.deepEqual(viewHints("keyboard"), [
    { keys: ["Shift", "← ↑ ↓ →"], chord: true, label: "Turn and tilt" },
    { keys: ["+", "−"], label: "Zoom" },
    { keys: ["R"], label: "Reset view" },
  ]);
  // A controller: the right stick, the triggers (the left one pulls back, the right one closes in) and a press on the stick.
  assert.deepEqual(viewHints("xbox").map((hint) => hint.keys), [["RS"], ["LT", "RT"], ["RS"]]);
  assert.deepEqual(viewHints("playstation").map((hint) => hint.keys), [["R"], ["L2", "R2"], ["R3"]]);
  assert.deepEqual(viewHints("nintendo").map((hint) => hint.keys), [["R"], ["ZL", "ZR"], ["R"]]);
  for (const device of ["keyboard", "xbox", "playstation", "nintendo"] as const) {
    const hints = viewHints(device);
    assert.deepEqual(hints.map((hint) => hint.label.replace("Press to reset view", "Reset view")), ["Turn and tilt", "Zoom", "Reset view"], device);
    // A stick that both turns the view and, pressed, puts it back says which is which.
    if (hints[0]!.keys[0] === hints[2]!.keys[0]) assert.equal(hints[2]!.label, "Press to reset view", device);
    assert.ok(hints.every((hint) => hint.keys.every((key) => key.length > 0)));
  }
});
