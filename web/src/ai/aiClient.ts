import type { Difficulty, PieceKind, SquareId } from "../core/types";
import type { EngineReply, EngineRequest } from "./protocol";

export interface BestMoveOptions {
  /** Time left on the searching side's clock; caps the search budget. Null or absent in an untimed game. */
  remainingMs?: number | null;
}

export interface EngineMove {
  from: SquareId;
  to: SquareId;
  promotion: PieceKind | null;
  score: number;
  depth: number;
}

/**
 * Main-thread handle for the search worker. Only one search runs at a time;
 * `cancel()` invalidates any in-flight result (new game, undo, resign).
 */
export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (move: EngineMove | null) => void } | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private complete(move: EngineMove | null): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
    const pending = this.pending; this.pending = null;
    pending?.resolve(move);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<EngineReply>) => {
      if (this.worker !== worker) return;
      const pending = this.pending;
      if (!pending) return;
      const data = event.data;
      // Empty and failed replies carry the id too; a cancelled search cannot
      // consume the next game's request with an uncorrelated null message.
      if (!data || data.id !== pending.id) return;
      const empty = data.from === null && data.to === null && data.promotion === null;
      const square = (value: unknown): value is SquareId => typeof value === "string" && /^[a-h][1-8]$/u.test(value);
      if (!empty && (!square(data.from) || !square(data.to) ||
          (data.promotion !== null && !["q", "r", "b", "n"].includes(data.promotion)) ||
          !Number.isFinite(data.score) || !Number.isInteger(data.depth) || data.depth < 1)) {
        worker.terminate(); this.worker = null; this.complete(null); return;
      }
      this.complete(
        data.from && data.to
          ? {
              from: data.from,
              to: data.to,
              promotion: (data.promotion as PieceKind | null) ?? null,
              score: data.score,
              depth: data.depth,
            }
          : null,
      );
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      console.error("[ai] worker error", event.message);
      worker.terminate(); this.worker = null;
      this.complete(null);
    };
    this.worker = worker;
    return worker;
  }

  bestMove(fen: string, difficulty: Difficulty, options: BestMoveOptions = {}): Promise<EngineMove | null> {
    if (this.disposed) return Promise.resolve(null);
    this.cancel();
    let worker: Worker;
    try { worker = this.ensureWorker(); }
    catch (error) { console.error("[ai] worker unavailable", error); return Promise.resolve(null); }
    const id = this.nextId++;
    return new Promise<EngineMove | null>((resolve) => {
      this.pending = { id, resolve };
      // Search budgets are 0 / 700 / 3200 ms (protocol.ts), less when the clock
      // is short. Allow startup and slower devices a bounded grace period, then
      // recycle a worker that cannot answer.
      const remainingMs = options.remainingMs ?? null;
      const timeout = difficulty === "hard" ? 8000 : difficulty === "medium" ? 5000 : 3000;
      this.deadline = setTimeout(() => {
        if (this.pending?.id !== id || this.worker !== worker) return;
        worker.terminate(); this.worker = null; this.complete(null);
      }, timeout);
      const request: EngineRequest = { id, fen, difficulty, remainingMs };
      try { worker.postMessage(request); }
      catch (error) {
        console.error("[ai] search could not start", error);
        worker.terminate(); this.worker = null; this.complete(null);
      }
    });
  }

  /** Drops the current request; a late reply is ignored. */
  cancel(): void {
    this.complete(null);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
