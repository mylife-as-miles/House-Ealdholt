import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { GameController } from "../core/gameController";
import type { Faction, MoveEvent, PieceKind, SquareId } from "../core/types";
import type { TapAction } from "./boardInput";
import { SceneEngine } from "./sceneEngine";

const options = { mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null } as const;
type Figure = { color: Faction; kind: PieceKind; container: { position: THREE.Vector3 }; setHovered: ReturnType<typeof vi.fn> };
/** Lets everything already queued behind a settled move run (the queued move is played a moment after it). */
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

/** The scene's own press handling over a real game, with the figures and everything drawn stood in for. */
function playedScene(controller: GameController) {
  const pieces = new Map<SquareId, Figure>();
  const stage: { finish: (() => void) | null } = { finish: null };
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    controller, releaseGameEvents: [], interactive: true, promotionGroup: null, selected: null as SquareId | null,
    heldTap: null as { square: SquareId; piece: Figure; to: SquareId | null } | null, heldReachCache: null,
    hoveredPiece: null as Figure | null, drag: null, legalTargets: new Map<SquareId, boolean>(), passingVictims: new Map<SquareId, SquareId>(), pieces, campaignBattle: false,
    cursorSquare: "e2", cursorSeats: { w: "e2", b: "e7" }, cursorByKeys: false, movesInFlight: 0, disposed: false,
    quietStage: false, walkHurry: 1, combatHurry: 1, held: false,
    queuedEvents: [] as unknown[][],
    // A move stays on stage until the test lets it finish.
    animateMove: vi.fn((_event: MoveEvent) => new Promise<void>((resolve) => { stage.finish = resolve; })),
    onState: vi.fn(), beginGameSound: vi.fn(), playEndCinematic: vi.fn(async () => {}), rejectMove: vi.fn(async () => {}),
    stereoPan: () => 0, recallCheck: vi.fn(),
    // The pieces' voices (boardVoices.ts) and the downfall hear the controller's moves, resets and settles.
    voices: { interrupt: vi.fn(), moved: vi.fn(), settled: vi.fn() }, taken: [], downfall: { reset: vi.fn(), cancel: vi.fn() },
    board: { setHover: vi.fn(), setQueued: vi.fn() },
    rebuildPieces: vi.fn(() => {
      pieces.clear();
      for (const entry of controller.getBoard()) pieces.set(entry.square, { color: entry.color, kind: entry.kind, container: { position: new THREE.Vector3() }, setHovered: vi.fn() });
    }),
    selectWithTap: vi.fn(function (this: { selected: SquareId | null }, square: SquareId) { this.selected = square; }),
    clearSelection: vi.fn(function (this: { selected: SquareId | null }) { this.selected = null; }),
    commitMove: vi.fn(async () => {}),
  });
  scene.callbacks = { onMoveQueued: (...args: unknown[]) => { scene.queuedEvents.push(args); } };
  const call = (name: string, ...args: unknown[]) => Reflect.apply(Reflect.get(SceneEngine.prototype, name), scene, args);
  const press = (square: SquareId | null) => call("performTap", call("readTap", square)) as TapAction;
  return { scene, pieces, stage, call, press };
}

describe("presses on the board over a real game", () => {
  it("holds a piece pressed while a move is on stage and picks it up when the board is free", async () => {
    const game = new GameController(), { scene, pieces, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");
    expect(game.getSnapshot().busy).toBe(true);

    // White's move is still walking; Black presses the Knight on g8.
    expect(press("g8")).toEqual({ type: "hold", square: "g8" });
    expect(pieces.get("g8")!.setHovered).toHaveBeenLastCalledWith(true);
    expect(scene.selectWithTap).not.toHaveBeenCalled();
    expect(scene.pieceInHand).toBe(true);
    // White, who has just moved, cannot queue anything: a press on a White piece is not a square the Knight can go to.
    expect(press("d2")).toEqual({ type: "reject", from: "g8" });
    expect(scene.heldTap).toBeNull();
    expect(pieces.get("g8")!.setHovered).toHaveBeenLastCalledWith(false);
    expect(press("b8")).toEqual({ type: "hold", square: "b8" });

    stage.finish!(); await moving; await settle();
    expect(scene.selectWithTap).toHaveBeenCalledOnce();
    expect(scene.selectWithTap.mock.calls[0]![0]).toBe("b8");
    expect(scene.heldTap).toBeNull();
    call("unbindGameController"); game.dispose();
  });

  it("does not pick up a held piece that was taken meanwhile, whoever stands on its square now", async () => {
    const game = new GameController(), { scene, pieces, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");
    press("g8");
    // Another figure of the same side is on g8 when the move settles: not the one that was pressed.
    pieces.set("g8", { color: "b", kind: "q", container: { position: new THREE.Vector3() }, setHovered: vi.fn() });
    stage.finish!(); await moving; await settle();
    expect(scene.selectWithTap).not.toHaveBeenCalled();
    expect(scene.heldTap).toBeNull();
    call("unbindGameController"); game.dispose();
  });

  it("lets a held piece go on Escape, and forgets it when the game ends", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");
    press("g8");
    call("cancelKeyboardSelection");
    expect(scene.heldTap).toBeNull();
    press("g8");
    game.resign();
    expect(scene.heldTap).toBeNull();
    stage.finish!(); await moving; await settle();
    expect(scene.selectWithTap).not.toHaveBeenCalled();
    call("unbindGameController"); game.dispose();
  });

  it("plays, refuses and lets go as the reading of the press says", async () => {
    const game = new GameController(), { scene, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    expect(press("g1")).toEqual({ type: "select", square: "g1" });
    for (const target of game.legalTargets("g1")) scene.legalTargets.set(target.to, target.capture);
    // The King has no move at the start: it refuses, and the Knight stays in hand.
    expect(press("e1")).toEqual({ type: "stuck", square: "e1" });
    expect(scene.rejectMove).toHaveBeenLastCalledWith("e1");
    expect(scene.selected).toBe("g1");
    expect(press("g5")).toEqual({ type: "reject", from: "g1" });
    expect(scene.clearSelection).toHaveBeenCalled();
    scene.selected = "g1";
    expect(press("f3")).toEqual({ type: "move", from: "g1", to: "f3" });
    expect(scene.commitMove).toHaveBeenCalledWith("g1", "f3");
    call("unbindGameController"); game.dispose();
  });

  it("steps the keyboard's cursor as the camera sees the board, and seats it for each player of a duel", async () => {
    const game = new GameController(), { scene, stage, call } = playedScene(game);
    scene.camera = new THREE.PerspectiveCamera();
    scene.cursorForward = new THREE.Vector3();
    const seat = (z: number) => { scene.camera.position.set(0, 6.4, z); scene.camera.lookAt(0, 0, 0); scene.camera.updateMatrixWorld(); };
    call("bindGameController"); game.start(options); await Promise.resolve();
    seat(8.6);
    expect(call("moveKeyboardCursor", "up")).toBe("e3");
    expect(call("moveKeyboardCursor", "right")).toBe("f3");
    // The move is made and the camera swings round to Black's side.
    const moving = game.tryMove("e2", "e4"); stage.finish!(); await moving;
    seat(-8.6);
    expect(scene.keyboardCursor).toBe("e7");
    expect(call("moveKeyboardCursor", "up")).toBe("e6");
    expect(call("moveKeyboardCursor", "right")).toBe("d6");
    // Black moves; White finds the cursor where it was left.
    const reply = game.tryMove("e7", "e5"); stage.finish!(); await reply;
    expect(scene.keyboardCursor).toBe("f3");
    // The map looks straight down: Up is the top of the picture.
    scene.camera.position.set(0, 20, 0); scene.camera.up.set(0, 0, -1); scene.camera.lookAt(0, 0, 0); scene.camera.updateMatrixWorld();
    expect(call("moveKeyboardCursor", "up")).toBe("f4");
    call("unbindGameController"); game.dispose();
  });
});

describe("a move queued while the board is busy", () => {
  it("is shown on the board, and played the moment the board is free", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");

    // White's move is still walking: Black picks the Knight, then where it goes.
    expect(press("g8")).toEqual({ type: "hold", square: "g8" });
    expect(scene.board.setQueued).toHaveBeenLastCalledWith("g8");
    expect(press("f6")).toEqual({ type: "queue", from: "g8", to: "f6" });
    expect(scene.board.setQueued).toHaveBeenLastCalledWith("g8", "f6");
    expect(scene.heldTap).toMatchObject({ square: "g8", to: "f6" });
    expect(scene.pieceInHand).toBe(true);
    // A square the Knight cannot go to in the position that is already on the board is refused at once.
    expect(press("h6")).toEqual({ type: "queue", from: "g8", to: "h6" });
    expect(scene.commitMove).not.toHaveBeenCalled();

    stage.finish!(); await moving; await settle();
    expect(scene.commitMove).toHaveBeenCalledOnce();
    expect(scene.commitMove).toHaveBeenCalledWith("g8", "h6");
    expect(scene.selectWithTap).not.toHaveBeenCalled();
    expect(scene.heldTap).toBeNull();
    expect(scene.board.setQueued).toHaveBeenLastCalledWith(null);
    // The HUD hears of each step, and of how it ended.
    expect(scene.queuedEvents).toEqual([[{ from: "g8", to: null }], [{ from: "g8", to: "f6" }], [{ from: "g8", to: "h6" }], [null, "played"]]);
    call("unbindGameController"); game.dispose();
  });

  it("is called off by Escape (or the other mouse button) and by a second press on its piece", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");
    scene.movesInFlight = 1;
    press("g8"); press("f6");
    call("cancelKeyboardSelection");
    expect(scene.heldTap).toBeNull();
    expect(scene.board.setQueued).toHaveBeenLastCalledWith(null);
    // With a move on stage and nothing selected, the squares' own markers are left to that move.
    expect(scene.clearSelection).not.toHaveBeenCalled();
    press("g8"); press("f6");
    // The other mouse button lets go of whatever is in hand, and a queued move is.
    expect(scene.pieceInHand).toBe(true);
    call("cancelKeyboardSelection");
    expect(scene.heldTap).toBeNull();
    expect(scene.pieceInHand).toBe(false);
    press("g8"); press("f6");
    expect(press("g8")).toEqual({ type: "release" });
    expect(scene.heldTap).toBeNull();

    stage.finish!(); await moving; await settle();
    expect(scene.commitMove).not.toHaveBeenCalled();
    expect(scene.selectWithTap).not.toHaveBeenCalled();
    call("unbindGameController"); game.dispose();
  });

  it("refuses at once what is known to be illegal while the other side's move is shown", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start(options);
    const moving = game.tryMove("e2", "e4");
    // The Rook on a8 has no move in the position Black will play from.
    expect(press("a8")).toEqual({ type: "stuck", square: "a8" });
    expect(scene.heldTap).toBeNull();
    press("g8");
    // g6 is a Knight's move away from nothing: not a square the Knight can go to.
    expect(press("g6")).toEqual({ type: "reject", from: "g8" });
    expect(scene.rejectMove).toHaveBeenLastCalledWith("g8");
    expect(scene.heldTap).toBeNull();
    stage.finish!(); await moving; await settle();
    expect(scene.commitMove).not.toHaveBeenCalled();
    call("unbindGameController"); game.dispose();
  });

  it("against the computer, waits through its thinking and its move, and is refused if it is not legal by then", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    const reply = vi.fn(async () => ({ from: "d7", to: "d5", promotion: null, score: 0, depth: 1 }));
    Object.assign(game as unknown as { ai: object }, { ai: { bestMove: reply, cancel() {}, dispose() {} } });
    call("bindGameController"); game.start({ ...options, mode: "ai" });
    const moving = game.tryMove("e2", "e4");

    // The player's own move is on stage: the reply is not known, so any square a Queen could reach may be asked for,
    // whatever stands in the way now.
    expect(press("d1")).toEqual({ type: "hold", square: "d1" });
    expect(press("e4")).toEqual({ type: "reject", from: "d1" });
    press("d1");
    expect(press("d5")).toEqual({ type: "queue", from: "d1", to: "d5" });
    // A press that asks for nothing else hurries the walk; it does not disturb the queue.
    expect(press("d5")).toEqual({ type: "hurry" });
    expect(scene.heldTap).toMatchObject({ square: "d1", to: "d5" });

    stage.finish!(); stage.finish = null; await moving; await settle();
    // The computer is thinking: the move waits.
    expect(game.getSnapshot().thinking).toBe(true);
    expect(scene.heldTap).toMatchObject({ square: "d1", to: "d5" });
    await vi.waitFor(() => expect(stage.finish).not.toBeNull(), { timeout: 3000 });
    // Its reply is being shown, and the board is not yet free.
    expect(game.getSnapshot().busy).toBe(true);
    expect(scene.commitMove).not.toHaveBeenCalled();
    stage.finish!(); await vi.waitFor(() => expect(scene.heldTap).toBeNull());
    // Qd1 to d5 is blocked by the Queen's own Pawn: refused, by the Queen, and nothing is played.
    expect(scene.commitMove).not.toHaveBeenCalled();
    expect(scene.rejectMove).toHaveBeenLastCalledWith("d1");
    expect(scene.queuedEvents.at(-1)).toEqual([null, "refused"]);
    call("unbindGameController"); game.dispose();
  });

  it("against the computer, is played when the computer's reply has been shown", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    Object.assign(game as unknown as { ai: object }, { ai: { bestMove: async () => ({ from: "d7", to: "d5", promotion: null, score: 0, depth: 1 }), cancel() {}, dispose() {} } });
    call("bindGameController"); game.start({ ...options, mode: "ai" });
    const moving = game.tryMove("e2", "e4");
    stage.finish!(); stage.finish = null; await moving; await settle();
    // While the computer thinks: the Knight, to f3.
    expect(game.getSnapshot().thinking).toBe(true);
    expect(press("g1")).toEqual({ type: "hold", square: "g1" });
    expect(press("f3")).toEqual({ type: "queue", from: "g1", to: "f3" });
    await vi.waitFor(() => expect(stage.finish).not.toBeNull(), { timeout: 3000 });
    expect(scene.commitMove).not.toHaveBeenCalled();
    stage.finish!(); await vi.waitFor(() => expect(scene.heldTap).toBeNull());
    expect(scene.commitMove).toHaveBeenCalledExactlyOnceWith("g1", "f3");
    expect(scene.queuedEvents.at(-1)).toEqual([null, "played"]);
    call("unbindGameController"); game.dispose();
  });

  it("is not played over a game the last move has ended, whatever is legal on the board", async () => {
    // White takes the last Bishop: bare Kings, a draw the game declares only after the move has settled.
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    call("bindGameController"); game.start({ ...options, startingFen: "4k3/8/8/8/8/8/3b4/4K3 w - - 0 1" });
    const moving = game.tryMove("e1", "d2");
    press("e8");
    expect(press("e7")).toEqual({ type: "queue", from: "e8", to: "e7" });
    stage.finish!(); await moving; await settle();
    expect(game.getSnapshot().result).toEqual({ winner: null, reason: "insufficient" });
    expect(scene.commitMove).not.toHaveBeenCalled();
    expect(scene.rejectMove).not.toHaveBeenCalled();
    expect(scene.heldTap).toBeNull();
    call("unbindGameController"); game.dispose();
  });

  it("still asks what a Pawn is to become when the queued move promotes it", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    const requestPromotion = vi.fn(async () => "n" as PieceKind);
    Object.assign(scene, { requestPromotion, commitMove: (from: SquareId, to: SquareId) => call("commitMove", from, to) });
    call("bindGameController"); game.start({ ...options, startingFen: "7k/P7/8/8/8/8/8/K7 b - - 0 1" });
    const moving = game.tryMove("h8", "g8");
    press("a7");
    expect(press("a8")).toEqual({ type: "queue", from: "a7", to: "a8" });
    expect(requestPromotion).not.toHaveBeenCalled();
    stage.finish!(); stage.finish = null; await moving;
    await vi.waitFor(() => expect(stage.finish).not.toBeNull());
    expect(requestPromotion).toHaveBeenCalledExactlyOnceWith("w");
    expect(game.pieceAt("a8")).toEqual({ kind: "n", color: "w" });
    call("unbindGameController"); game.dispose();
  });

  it("plays nothing when the promotion it asks for is backed out of, and puts the Pawn back in hand", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    const answers: (PieceKind | "back" | "gone")[] = ["back", "gone"];
    const select = vi.fn();
    Object.assign(scene, { select, requestPromotion: vi.fn(async () => answers.shift()), commitMove: (from: SquareId, to: SquareId) => call("commitMove", from, to) });
    call("bindGameController"); game.start({ ...options, startingFen: "7k/P7/8/8/8/8/8/K7 b - - 0 1" });
    const moving = game.tryMove("h8", "g8");
    press("a7"); press("a8");
    stage.finish!(); stage.finish = null; await moving; await settle();
    // Backed out of: the Pawn has not moved, and it is in hand again.
    expect(game.pieceAt("a7")).toEqual({ kind: "p", color: "w" });
    expect(game.getSnapshot().sanList).toHaveLength(1);
    expect(select).toHaveBeenCalledExactlyOnceWith("a7");
    // The game moved on under the picker (it ended, was taken back or begun again): nothing is played or picked up.
    await call("commitMove", "a7", "a8");
    expect(game.getSnapshot().sanList).toHaveLength(1);
    expect(select).toHaveBeenCalledOnce();
    expect(scene.rejectMove).not.toHaveBeenCalled();
    call("unbindGameController"); game.dispose();
  });

  it("answers an open promotion picker itself when the game ends, is taken back or begins again under it", () => {
    const game = new GameController(), { scene, call } = playedScene(game);
    const answered: string[] = [];
    call("bindGameController"); game.start({ ...options, startingFen: "7k/P7/8/8/8/8/8/K6R w - - 0 1" });
    scene.promotionResolve = (answer: string) => { answered.push(answer); scene.promotionResolve = null; };
    game.resign();
    expect(answered).toEqual(["gone"]);
    scene.promotionResolve = (answer: string) => { answered.push(answer); scene.promotionResolve = null; };
    game.start(options);
    expect(answered).toEqual(["gone", "gone"]);
    // The player's own way out says so, and is heard.
    scene.promotionResolve = (answer: string) => { answered.push(answer); scene.promotionResolve = null; };
    call("cancelPromotion");
    expect(answered).toEqual(["gone", "gone", "back"]);
    call("cancelPromotion");
    expect(answered).toHaveLength(3);
    call("unbindGameController"); game.dispose();
  });

  it("is forgotten, not played or refused, when the move it waited for is checkmate", async () => {
    const game = new GameController(), { scene, pieces, stage, call, press } = playedScene(game);
    Object.assign(game as unknown as { ai: object }, { ai: { bestMove: async () => ({ from: "d8", to: "h4", promotion: null, score: 0, depth: 1 }), cancel() {}, dispose() {} } });
    call("bindGameController"); game.start({ ...options, mode: "ai", startingFen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2" });
    const moving = game.tryMove("g2", "g4");
    stage.finish!(); stage.finish = null; await moving; await settle();
    press("g4"); press("g5");
    await vi.waitFor(() => expect(stage.finish).not.toBeNull(), { timeout: 3000 });
    // Checkmate: the game is over when the board is free, and nothing is asked of the Pawn.
    stage.finish!(); await vi.waitFor(() => expect(game.getSnapshot().status).toBe("over"));
    await settle();
    expect(scene.commitMove).not.toHaveBeenCalled();
    expect(scene.heldTap).toBeNull();
    expect(pieces.size).toBeGreaterThan(0);
    call("unbindGameController"); game.dispose();
  });
});

describe("a press that hurries the move on stage", () => {
  it("hurries a quiet walk once, and never a fight or a move already skipped", () => {
    const game = new GameController(), { scene, call } = playedScene(game);
    expect(call("hurryMove")).toBe(false);
    scene.quietStage = true;
    expect(call("hurryMove")).toBe(true);
    expect(scene.walkHurry).toBeGreaterThan(1);
    expect(call("hurryMove")).toBe(false);
    scene.walkHurry = 1; scene.combatHurry = 3;
    expect(call("hurryMove")).toBe(false);
    scene.combatHurry = 1; scene.held = true;
    expect(call("hurryMove")).toBe(false);
    game.dispose();
  });

  it("is what a press on an empty square means while a move is on stage, and nothing while the board is free", async () => {
    const game = new GameController(), { scene, stage, call, press } = playedScene(game);
    scene.hurryMove = vi.fn(() => true);
    call("bindGameController"); game.start(options);
    expect(press("e4")).toEqual({ type: "none" });
    expect(scene.hurryMove).not.toHaveBeenCalled();
    const moving = game.tryMove("e2", "e4");
    expect(press("e4")).toEqual({ type: "hurry" });
    expect(scene.hurryMove).toHaveBeenCalledOnce();
    stage.finish!(); await moving;
    call("unbindGameController"); game.dispose();
  });
});
