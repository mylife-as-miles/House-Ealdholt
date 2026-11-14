// When a My Legacy environment redraws its directional shadow map. The key
// light and its shadow camera are fixed, so with renderer.shadowMap.autoUpdate
// off the map only needs redrawing when a caster may have moved or changed.

/**
 * A one-off change (a rebuild, a state change) redraws on the next frame.
 * Continuous motion (figures walking, wind, a moving view that thins distance-
 * faded vegetation) redraws every other frame. A skipped redraw is always made
 * up on the very next rendered frame, so an on-demand renderer that keeps
 * drawing while `owed` is true settles with current shadows.
 */
export class ShadowRefresh {
  private pending = true;
  private urgent = true;
  private skipped = false;
  private redraws = 0;
  private frames = 0;

  /** Something changed that the next frame's shadows must show. */
  invalidate(): void {
    this.pending = true;
    this.urgent = true;
  }

  /** Call once per rendered frame. `moving`: casters or the view may have moved since the previous frame. */
  frame(moving: boolean): boolean {
    this.frames++;
    if (moving) this.pending = true;
    if (!this.pending) return false;
    if (this.urgent || this.skipped) {
      this.pending = false;
      this.urgent = false;
      this.skipped = false;
      this.redraws++;
      return true;
    }
    this.skipped = true;
    return false;
  }

  /** True while a change has not reached the shadow map yet. */
  get owed(): boolean {
    return this.pending;
  }

  /** Lifetime counters, for ?legacyStats. */
  counts(): { frames: number; redraws: number } {
    return { frames: this.frames, redraws: this.redraws };
  }
}
