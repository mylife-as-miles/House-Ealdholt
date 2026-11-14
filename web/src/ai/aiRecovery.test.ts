import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiClient } from "./aiClient";
import { GameController } from "../core/gameController";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}

describe("bounded search-worker recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    vi.stubGlobal("Worker", FakeWorker); FakeWorker.instances = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("recycles an unanswered worker after a bounded startup/search allowance", async () => {
    const ai = new AiClient(), pending = ai.bestMove("position", "easy"), old = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(3000); expect(await pending).toBeNull(); expect(old.terminate).toHaveBeenCalledOnce();
    const retried = ai.bestMove("position", "easy"); expect(FakeWorker.instances).toHaveLength(2);
    ai.dispose(); expect(await retried).toBeNull();
    expect(await ai.bestMove("position", "easy")).toBeNull(); expect(FakeWorker.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears a failed worker and ignores late errors from that worker after retry", async () => {
    const ai = new AiClient(), first = ai.bestMove("position", "easy"), old = FakeWorker.instances[0];
    old.onerror!({ message: "failed" } as ErrorEvent); expect(await first).toBeNull();
    const current = ai.bestMove("position", "easy"); old.onerror!({ message: "late" } as ErrorEvent);
    const fresh = FakeWorker.instances[1]; expect(fresh.terminate).not.toHaveBeenCalled();
    fresh.onmessage!({ data: { id: 2, from: "e2", to: "e4", promotion: null, score: 0, depth: 1 } } as MessageEvent);
    expect((await current)?.to).toBe("e4"); ai.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("turns a blocked Worker constructor into a recoverable empty reply", async () => {
    vi.stubGlobal("Worker", class { constructor() { throw new Error("blocked"); } });
    const ai = new AiClient(); expect(await ai.bestMove("position", "easy")).toBeNull(); ai.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects malformed move replies without handing them to the chess controller", async () => {
    const ai = new AiClient(), pending = ai.bestMove("position", "easy"), worker = FakeWorker.instances[0];
    worker.onmessage!({ data: { id: 1, from: "z9", to: "e4", promotion: "k", score: NaN, depth: 1 } } as MessageEvent);
    expect(await pending).toBeNull(); expect(worker.terminate).toHaveBeenCalledOnce(); ai.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses a failed computer turn and retries at the same difficulty and position", async () => {
    const game = new GameController();
    const search = vi.spyOn(Reflect.get(game, "ai"), "bestMove").mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ from: "e2", to: "e4", promotion: null, score: 0, depth: 3 });
    game.start({ mode: "ai", difficulty: "hard", playerColor: "b", clockMinutes: 1 });
    const fen = game.getSnapshot().fen; await vi.advanceTimersByTimeAsync(420);
    expect(game.getSnapshot().engineError).toContain("Retry"); expect(game.getSnapshot().paused).toBe(true);
    expect(game.getSnapshot().result).toBeNull(); const time = game.getSnapshot().clock.whiteMs;
    await vi.advanceTimersByTimeAsync(10000); expect(game.getSnapshot().clock.whiteMs).toBe(time);
    game.setPaused(false); await vi.advanceTimersByTimeAsync(420);
    // Same position and difficulty; the search is told the computer's time left (M-08).
    expect(search.mock.calls).toEqual([[fen, "hard", { remainingMs: 60000 }], [fen, "hard", { remainingMs: time }]]);
    expect(game.getSnapshot().engineError).toBeNull(); expect(game.getSnapshot().sanList).toEqual(["e4"]);
    game.dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it("also pauses a syntactically valid but illegal engine move without changing the board", async () => {
    const game = new GameController();
    vi.spyOn(Reflect.get(game, "ai"), "bestMove").mockResolvedValue({ from: "e2", to: "e5", promotion: null, score: 0, depth: 1 });
    game.start({ mode: "ai", difficulty: "easy", playerColor: "b", clockMinutes: null });
    const fen = game.getSnapshot().fen; await vi.advanceTimersByTimeAsync(420);
    expect(game.getSnapshot().fen).toBe(fen); expect(game.getSnapshot().paused).toBe(true);
    expect(game.getSnapshot().engineError).toContain("Retry");
    game.resign(); expect(game.getSnapshot().engineError).toBeNull(); game.dispose();
  });
});
