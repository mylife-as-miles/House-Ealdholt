// The one cooperative yield used while a world is being built. It is a timer, never a frame:
// window requestAnimationFrame callbacks are not guaranteed during an immersive XR session or in a
// hidden page, and waiting for a frame would also wait for whatever the GPU has queued.
export const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A yield for long synchronous work on the main thread. It gives way only once work has run for
 * max(minWorkMs, the last yield's wait), so a slow frame between tasks buys equally long work instead
 * of one short slice per wait: work never takes less than half of the elapsed time while frames stay live.
 */
export function createWorkYield(minWorkMs = 8) {
  let resumedAt = performance.now(), lastWait = 0;
  return async () => {
    const start = performance.now();
    if (start - resumedAt < Math.max(minWorkMs, lastWait)) return;
    await yieldToMain();
    resumedAt = performance.now();
    lastWait = resumedAt - start;
  };
}
