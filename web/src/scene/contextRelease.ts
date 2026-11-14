/**
 * Lets the browser free a disposed engine's WebGL context now rather than whenever the canvas is collected (A-05),
 * once the canvas has left the page. A canvas still in the page is about to carry the next engine (a Showcase arena
 * switch, React's development double mount), and losing its context would leave that engine blank.
 */
export function releaseContextWhenDetached(
  canvas: Pick<HTMLCanvasElement, "isConnected">,
  gl: Pick<WebGLRenderingContext, "getExtension">,
  schedule: (task: () => void) => void = (task) => { setTimeout(task, 0); },
): void {
  schedule(() => {
    if (canvas.isConnected) return;
    try {
      (gl.getExtension("WEBGL_lose_context") as WEBGL_lose_context | null)?.loseContext();
    } catch {
      /* Already lost. */
    }
  });
}
