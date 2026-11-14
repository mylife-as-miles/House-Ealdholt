import { describe, expect, it, vi } from "vitest";
import { releaseContextWhenDetached } from "./contextRelease";

function fakeContext() {
  const loseContext = vi.fn();
  return { loseContext, gl: { getExtension: vi.fn(() => ({ loseContext, restoreContext: vi.fn() })) } };
}

describe("releasing a disposed engine's context (A-05)", () => {
  it("loses the context once the canvas has left the page", () => {
    const { gl, loseContext } = fakeContext();
    const canvas = { isConnected: true };
    let task: (() => void) | null = null;
    releaseContextWhenDetached(canvas, gl as never, (next) => { task = next; });
    expect(loseContext).not.toHaveBeenCalled();
    canvas.isConnected = false; // React removes the old canvas in the same commit
    task!();
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("keeps the context of a canvas that stays in the page for the next engine", () => {
    const { gl, loseContext } = fakeContext();
    let task: (() => void) | null = null;
    releaseContextWhenDetached({ isConnected: true }, gl as never, (next) => { task = next; });
    task!();
    expect(loseContext).not.toHaveBeenCalled();
  });

  it("waits for the current task to end by default, and tolerates a context with no extension", () => {
    vi.useFakeTimers();
    const gl = { getExtension: vi.fn(() => null) };
    releaseContextWhenDetached({ isConnected: false }, gl as never);
    expect(gl.getExtension).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(gl.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    vi.useRealTimers();
  });
});
