import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameController } from "./gameController";
import type { EngineMove } from "../ai/aiClient";

const options = { mode: "ai", difficulty: "easy", playerColor: "b", clockMinutes: null } as const;
const move: EngineMove = { from: "e2", to: "e4", promotion: null, score: 0, depth: 1 };
const pending = () => {
  let resolve!: (value: EngineMove | null) => void;
  const promise = new Promise<EngineMove | null>(done => { resolve = done; }); return { promise, resolve };
};

describe("AI replies belong to their match generation", () => {
  let game: GameController;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    game = new GameController();
  });
  afterEach(() => { game.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("ignores an old search reply while the new match is still searching", async () => {
    const old = pending(), current = pending();
    const search = vi.spyOn(Reflect.get(game, "ai"), "bestMove")
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    game.start(options); game.start(options); old.resolve(move); await Promise.resolve();
    game.setPaused(true);
    expect(game.getSnapshot().thinking).toBe(true);
    game.setPaused(false); expect(search).toHaveBeenCalledTimes(2);
    game.dispose(); current.resolve(null);
  });

  it("ignores an old reply's pacing delay after a new match begins", async () => {
    const current = pending();
    vi.spyOn(Reflect.get(game, "ai"), "bestMove").mockResolvedValueOnce(move).mockReturnValueOnce(current.promise);
    game.start(options); await Promise.resolve();
    game.start(options); await vi.advanceTimersByTimeAsync(420);
    game.setPaused(true);
    expect(game.getSnapshot().thinking).toBe(true);
    expect(game.getSnapshot().sanList).toHaveLength(0);
    game.dispose(); current.resolve(null);
  });

  it("resumes a paused ready reply without launching a second search for the same turn", async () => {
    const search = vi.spyOn(Reflect.get(game, "ai"), "bestMove").mockResolvedValue(move);
    game.start(options); game.setPaused(true); await vi.advanceTimersByTimeAsync(420);
    expect(game.getSnapshot().sanList).toHaveLength(0);
    game.setPaused(false); await vi.advanceTimersByTimeAsync(0);
    expect(search).toHaveBeenCalledTimes(1);
    expect(game.getSnapshot().sanList).toEqual(["e4"]);
  });

  it("does not offer a takeback of the computer's opening before the human has played", async () => {
    vi.spyOn(Reflect.get(game, "ai"), "bestMove").mockResolvedValue(move);
    game.start(options); await vi.advanceTimersByTimeAsync(420);
    expect(game.getSnapshot().sanList).toEqual(["e4"]);
    expect(game.getSnapshot().canUndo).toBe(false);
    expect(game.undo()).toBe(false);
    expect(game.isHumanTurn()).toBe(true);
  });
});
