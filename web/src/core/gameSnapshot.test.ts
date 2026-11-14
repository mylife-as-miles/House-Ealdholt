import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameController } from "./gameController";

describe("position data stays stable while only time changes", () => {
  let game: GameController;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    game = new GameController(); game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 1 });
  });
  afterEach(() => { game.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("does not replay the move history or regenerate PGN for clock ticks", async () => {
    await game.tryMove("e2", "e4");
    const before = game.getSnapshot();
    const chess = Reflect.get(game, "chess"), history = vi.spyOn(chess, "history"), pgn = vi.spyOn(chess, "pgn");
    await vi.advanceTimersByTimeAsync(500);
    expect(history).not.toHaveBeenCalled(); expect(pgn).not.toHaveBeenCalled();
    expect(game.getSnapshot().moves).toBe(before.moves);
    expect(game.getSnapshot().clock.blackMs).toBe(59500);
    expect(game.getSnapshot().pgn).toBe(before.pgn);
  });

  it("tells listeners about a running clock once per shown second, not on every tick (M-07)", async () => {
    await game.tryMove("e2", "e4");
    const states: number[] = [];
    game.on("state", (snapshot) => states.push(snapshot.clock.blackMs));
    await vi.advanceTimersByTimeAsync(3000);
    // Thirty ticks. Each second is announced where it changes rounded down and where it changes rounded up (the two
    // shells round differently): six events, not thirty.
    expect(states.length).toBeGreaterThanOrEqual(3);
    expect(states.length).toBeLessThanOrEqual(6);
    expect(game.getSnapshot().clock.blackMs).toBe(57000);
    for (let i = 1; i < states.length; i += 1) {
      const [a, b] = [states[i - 1], states[i]];
      expect(Math.floor(a / 1000) !== Math.floor(b / 1000) || Math.ceil(a / 1000) !== Math.ceil(b / 1000)).toBe(true);
    }
  });

  it("refreshes position data on captures, takebacks, restarts and replay seeks", async () => {
    await game.tryMove("e2", "e4"); const opening = game.getSnapshot();
    await game.tryMove("d7", "d5"); await game.tryMove("e4", "d5");
    const capture = game.getSnapshot();
    expect(capture.captured).toHaveLength(1); expect(capture.pgn).toContain("%cfcombat");
    expect(game.undo()).toBe(true);
    expect(game.getSnapshot().captured).toHaveLength(0);
    expect(game.getSnapshot().pgn).not.toContain("%cfcombat");
    expect(opening.sanList).toEqual(["e4"]); expect(capture.sanList).toEqual(["e4", "d5", "exd5"]);
    game.showReplayPosition(opening.fen);
    expect(game.getSnapshot().fen).toBe(opening.fen); expect(game.getSnapshot().sanList).toEqual([]);
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 1 });
    expect(game.getSnapshot().moves).toEqual([]); expect(game.getSnapshot().lastMove).toBeNull();
  });
});
