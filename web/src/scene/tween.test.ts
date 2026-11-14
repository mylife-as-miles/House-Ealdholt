import { afterEach, describe, expect, it, vi } from "vitest";
import { holdWaits, wait } from "./tween";

describe("wait held by the pause menu", () => {
  afterEach(() => { holdWaits(false); vi.useRealTimers(); });

  it("runs out on time when nothing holds it", async () => {
    vi.useFakeTimers();
    let done = false;
    void wait(0.5).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });

  it("stands still while held and keeps the time it had left", async () => {
    vi.useFakeTimers();
    let done = false;
    void wait(1).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(400);
    holdWaits(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    holdWaits(false);
    await vi.advanceTimersByTimeAsync(590);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
  });

  it("a wait begun while held starts its clock only when let go", async () => {
    vi.useFakeTimers();
    holdWaits(true);
    let done = false;
    void wait(0.2).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done).toBe(false);
    holdWaits(false);
    await vi.advanceTimersByTimeAsync(210);
    expect(done).toBe(true);
  });
});
