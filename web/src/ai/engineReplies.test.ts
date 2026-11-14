import { afterEach, describe, expect, it, vi } from "vitest";
import { AiClient } from "./aiClient";

describe("search worker reply identities", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

  it("keeps the request id even when a terminal position has no move", async () => {
    const worker = { postMessage: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
    vi.stubGlobal("self", worker); await import("./engine.worker");
    worker.onmessage!({ data: { id: 17, fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", difficulty: "easy" } } as MessageEvent);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 17, from: null, to: null, promotion: null, score: 0, depth: 0 });
  });

  it("keeps the request id on search failure", async () => {
    const worker = { postMessage: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("self", worker); await import("./engine.worker");
    worker.onmessage!({ data: { id: 18, fen: "invalid", difficulty: "easy" } } as MessageEvent);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 18, from: null, to: null, promotion: null, score: 0, depth: 0 });
  });

  it("does not let a cancelled empty reply consume the current search", async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      postMessage = vi.fn(); terminate = vi.fn();
      constructor() { workers.push(this); }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const ai = new AiClient(), first = ai.bestMove("old", "easy"), current = ai.bestMove("new", "easy");
    expect(await first).toBeNull();
    const complete = vi.fn(); current.then(complete);
    workers[0].onmessage!({ data: { id: 1, from: null, to: null, promotion: null, score: 0, depth: 0 } } as MessageEvent);
    workers[0].onmessage!({ data: null } as MessageEvent); await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    workers[0].onmessage!({ data: { id: 2, from: "e2", to: "e4", promotion: null, score: 10, depth: 2 } } as MessageEvent);
    expect(await current).toEqual({ from: "e2", to: "e4", promotion: null, score: 10, depth: 2 });
    ai.dispose(); expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
});
