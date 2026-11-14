import { describe, expect, it, vi } from "vitest";
import { GameController } from "../core/gameController";
import { SceneEngine } from "./sceneEngine";

const options = { mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null } as const;
const invoke = (name: string, scene: object) => Reflect.apply(Reflect.get(SceneEngine.prototype, name), scene, []);
function observedScene(controller: GameController) {
  return Object.assign(Object.create(SceneEngine.prototype), {
    controller, releaseGameEvents: [], animateMove: vi.fn(async () => {}), onState: vi.fn(),
    rebuildPieces: vi.fn(), beginGameSound: vi.fn(), rejectMove: vi.fn(), playEndCinematic: vi.fn(async () => {}), campaignBattle: false,
    // The pieces' voices (boardVoices.ts) hear the controller's moves, resets and settles; the history's takings.
    voices: { interrupt: vi.fn(), moved: vi.fn(), settled: vi.fn() }, taken: [], downfall: { reset: vi.fn(), cancel: vi.fn() },
    homeCursor: vi.fn(), seatCursor: vi.fn(), releaseHeldTap: vi.fn(), dropHeldTap: vi.fn(),
  });
}

describe("actual scene/controller subscriptions", () => {
  it("requests exactly one board rebuild after an accepted Undo in Play", async () => {
    const game = new GameController(), scene = observedScene(game); invoke("bindGameController", scene);
    game.start(options); expect(scene.rebuildPieces).toHaveBeenCalledOnce();
    await game.tryMove("e2", "e4"); expect(scene.animateMove).toHaveBeenCalledOnce();
    expect(game.undo()).toBe(true); expect(scene.rebuildPieces).toHaveBeenCalledTimes(2);
    expect(game.undo()).toBe(false); expect(scene.rebuildPieces).toHaveBeenCalledTimes(2);
    invoke("unbindGameController", scene); game.dispose();
  });

  it("detaches all old view callbacks while a replacement view keeps its animator", async () => {
    const game = new GameController(), old = observedScene(game), current = observedScene(game);
    invoke("bindGameController", old); invoke("bindGameController", current); invoke("unbindGameController", old);
    game.start(options); await game.tryMove("e2", "e4"); game.emit("illegal", { from: "e4", to: "e6" }); game.resign();
    for (const spy of [old.onState, old.rebuildPieces, old.animateMove, old.rejectMove, old.playEndCinematic]) expect(spy).not.toHaveBeenCalled();
    expect(current.animateMove).toHaveBeenCalledOnce(); expect(current.rebuildPieces).toHaveBeenCalledOnce();
    expect(current.rejectMove).toHaveBeenCalledOnce(); expect(current.playEndCinematic).toHaveBeenCalledOnce();
    invoke("unbindGameController", current); game.dispose();
  });
});
