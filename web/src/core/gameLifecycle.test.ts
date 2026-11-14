import { describe, expect, it, vi } from "vitest";
import { GameController } from "./gameController";

const options = { mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null } as const;

describe("controller ownership and takeback lifecycle", () => {
  it("rebuilds a position through a dedicated rewind event without starting another Legacy match", async () => {
    const game = new GameController(), rewinds = vi.fn(), resets = vi.fn();
    game.on("rewind", rewinds); game.on("reset", resets); game.start(options);
    await game.tryMove("e2", "e4"); expect(game.undo()).toBe(true);
    expect(resets).toHaveBeenCalledOnce(); expect(rewinds).toHaveBeenCalledExactlyOnceWith({ fen: game.getSnapshot().fen });
    expect(game.pieceAt("e2")).toEqual({ kind: "p", color: "w" }); expect(game.pieceAt("e4")).toBeNull();
    expect(game.undo()).toBe(false); expect(rewinds).toHaveBeenCalledOnce(); game.dispose();
  });

  it("lets an old renderer detach without deleting a newer renderer's animator", async () => {
    const game = new GameController(), old = vi.fn(async () => {}), current = vi.fn(async () => {});
    game.start(options); const releaseOld = game.setAnimator(old), releaseCurrent = game.setAnimator(current);
    releaseOld(); await game.tryMove("e2", "e4"); expect(old).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledOnce();
    releaseCurrent(); await game.tryMove("e7", "e5"); expect(current).toHaveBeenCalledOnce(); game.dispose();
  });

  it("tracks registrations even when two owners provide the same callback", async () => {
    const game = new GameController(), animate = vi.fn(async () => {}); game.start(options);
    const old = game.setAnimator(animate), current = game.setAnimator(animate); old();
    await game.tryMove("e2", "e4"); expect(animate).toHaveBeenCalledOnce(); current(); game.dispose();
  });

  it("invalidates an in-flight move on disposal and cannot resurrect a disposed controller", async () => {
    const game = new GameController(); game.start(options);
    let release!: () => void; game.setAnimator(() => new Promise<void>(resolve => { release = resolve; }));
    const move = game.tryMove("e2", "e4"); expect(game.getSnapshot().busy).toBe(true);
    game.dispose(); release(); await move;
    expect(game.getSnapshot().status).toBe("idle"); expect(game.getSnapshot().busy).toBe(false);
    expect(game.isHumanTurn()).toBe(false); game.start(options); expect(game.getSnapshot().status).toBe("idle");
    expect(await game.tryMove("e7", "e5")).toBe(false); game.dispose();
  });
});
