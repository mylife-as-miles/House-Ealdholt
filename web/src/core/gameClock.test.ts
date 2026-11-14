import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameController } from "./gameController";

const held = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

describe("chess clocks around cinematic moves", () => {
  const games: GameController[] = [];
  const game = (minutes = 1) => {
    const controller = new GameController(); games.push(controller);
    controller.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: minutes });
    return controller;
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] }); });
  afterEach(() => { for (const controller of games.splice(0)) controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("charges the mover's final fraction of a clock tick before handing over the turn", async () => {
    const controller = game();
    await vi.advanceTimersByTimeAsync(75);
    expect(await controller.tryMove("e2", "e4")).toBe(true);
    expect(controller.getSnapshot().clock.whiteMs).toBe(59925);
    expect(controller.getSnapshot().clock.blackMs).toBe(60000);
    await vi.advanceTimersByTimeAsync(25);
    expect(controller.getSnapshot().clock.blackMs).toBe(59975);
  });

  it("does not spend either player's time while the next input is locked by a capture", async () => {
    const controller = game(), animation = held();
    await controller.tryMove("e2", "e4"); await controller.tryMove("d7", "d5");
    controller.setAnimator(() => animation.promise);
    await vi.advanceTimersByTimeAsync(235);
    const capture = controller.tryMove("e4", "d5");
    expect(controller.getSnapshot().busy).toBe(true);
    const committed = { ...controller.getSnapshot().clock };
    await vi.advanceTimersByTimeAsync(20000);
    expect(controller.getSnapshot().clock).toEqual(committed);
    expect(controller.getSnapshot().status).toBe("playing");
    expect(await controller.tryMove("g8", "f6")).toBe(false);
    animation.release(); expect(await capture).toBe(true);
    await vi.advanceTimersByTimeAsync(165);
    expect(controller.getSnapshot().clock.blackMs).toBe(committed.blackMs-165);
  });

  it("rejects a move after the flag falls between two scheduled clock ticks", async () => {
    const controller = game(.001), original = controller.getSnapshot().fen;
    await vi.advanceTimersByTimeAsync(80);
    expect(await controller.tryMove("e2", "e4")).toBe(false);
    expect(controller.getSnapshot().fen).toBe(original);
    expect(controller.getSnapshot().result).toEqual({ winner: "b", reason: "timeout" });
  });

  it("settles elapsed time when pausing and accepts no moves until resumed", async () => {
    const controller = game(); await vi.advanceTimersByTimeAsync(75); controller.setPaused(true);
    expect(controller.getSnapshot().clock.whiteMs).toBe(59925);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await controller.tryMove("e2", "e4")).toBe(false);
    expect(controller.getSnapshot().clock.whiteMs).toBe(59925);
    controller.setPaused(false); await vi.advanceTimersByTimeAsync(50);
    expect(await controller.tryMove("e2", "e4")).toBe(true);
    expect(controller.getSnapshot().clock.whiteMs).toBe(59875);
  });

  it("releases the presentation hold after a renderer failure and resumes the next clock", async () => {
    const controller = game(); const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    controller.setAnimator(async () => { await new Promise<void>((_, reject) => setTimeout(() => reject(new Error("effect failed")), 2000)); });
    const move = controller.tryMove("e2", "e4"); await vi.advanceTimersByTimeAsync(2000); expect(await move).toBe(true);
    expect(errors).toHaveBeenCalled(); expect(controller.getSnapshot().busy).toBe(false);
    expect(controller.getSnapshot().clock.blackMs).toBe(60000);
    await vi.advanceTimersByTimeAsync(100); expect(controller.getSnapshot().clock.blackMs).toBe(59900);
  });

  it("does not let a stale animator change the new game's clock baseline", async () => {
    const controller = game(), animation = held(); controller.setAnimator(() => animation.promise);
    const old = controller.tryMove("e2", "e4"); await vi.advanceTimersByTimeAsync(10000);
    controller.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 1 });
    await vi.advanceTimersByTimeAsync(10); animation.release(); await old;
    await vi.advanceTimersByTimeAsync(90);
    expect(controller.getSnapshot().clock.whiteMs).toBe(59900);
    expect(controller.getSnapshot().sanList).toHaveLength(0);
  });

  it("does not revive a zero-move finished game when Undo cannot remove anything", () => {
    const controller = game(); controller.resign();
    const result = controller.getSnapshot().result;
    expect(controller.undo()).toBe(false); expect(controller.isHumanTurn()).toBe(false);
    expect(controller.getSnapshot().result).toEqual(result);
  });

  it("settles the outgoing clock before Undo changes whose turn it is", async () => {
    const controller = game(); await controller.tryMove("e2", "e4");
    await vi.advanceTimersByTimeAsync(75); expect(controller.undo()).toBe(true);
    expect(controller.getSnapshot().clock.blackMs).toBe(59925);
    await vi.advanceTimersByTimeAsync(25); expect(controller.getSnapshot().clock.whiteMs).toBe(59975);
  });

  it("restarts a valid decision clock after taking back a terminal position", async () => {
    const controller = game(); await controller.tryMove("e2", "e4"); controller.resign();
    expect(controller.undo()).toBe(true); expect(controller.getSnapshot().status).toBe("playing");
    await vi.advanceTimersByTimeAsync(200); expect(controller.getSnapshot().clock.whiteMs).toBe(59800);
  });

  it("keeps a timeout terminal instead of reviving an exhausted clock", async () => {
    const controller = game(.001); await controller.tryMove("e2", "e4"); await vi.advanceTimersByTimeAsync(100);
    expect(controller.getSnapshot().result?.reason).toBe("timeout");
    expect(controller.undo()).toBe(false); expect(controller.getSnapshot().status).toBe("over");
    expect(controller.getSnapshot().result?.reason).toBe("timeout");
  });

  it("keeps the elapsed tally consistent with decision clocks during a long animation", async () => {
    const controller = game(), animation = held();
    await vi.advanceTimersByTimeAsync(75);
    controller.setAnimator(() => animation.promise);
    const move = controller.tryMove("e2", "e4");
    await vi.advanceTimersByTimeAsync(20000);
    expect(controller.getElapsed()).toEqual({ whiteMs: 75, blackMs: 0, totalMs: 75 });
    animation.release(); await move;
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.getElapsed()).toEqual({ whiteMs: 75, blackMs: 50, totalMs: 125 });
  });

  it("attributes partial takeback time to the outgoing side in the elapsed tally", async () => {
    const controller = game(); await vi.advanceTimersByTimeAsync(40);
    await controller.tryMove("e2", "e4"); await vi.advanceTimersByTimeAsync(75);
    expect(controller.undo()).toBe(true); await vi.advanceTimersByTimeAsync(25);
    expect(controller.getElapsed()).toEqual({ whiteMs: 65, blackMs: 75, totalMs: 140 });
  });

  it("freezes elapsed time after disposal", async () => {
    const controller = game(); await vi.advanceTimersByTimeAsync(75); controller.dispose();
    const stopped = controller.getElapsed(); await vi.advanceTimersByTimeAsync(5000);
    expect(controller.getElapsed()).toEqual(stopped);
    expect(stopped.totalMs).toBe(75);
  });
});
