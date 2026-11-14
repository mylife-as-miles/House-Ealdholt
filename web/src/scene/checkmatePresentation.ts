export interface CheckmateSample {
  /** Seconds since the conclusion began, on the render clock. */
  readonly time: number;
  /** 0 to 1 through it. */
  readonly progress: number;
  /** The beat at `time`, as the timeline names it. */
  readonly phase: string;
}

/** How long a conclusion holds the camera, and the name of its beat at any instant. */
export interface ConclusionTimeline {
  readonly duration: number;
  phaseAt(time: number): string;
}

/** The old six-second tableau: toward the King, held on the realization, a pullback. The default when no downfall is staged. */
export const TABLEAU: ConclusionTimeline = {
  duration: 6,
  phaseAt: time => time < 1.35 ? "realization" : time < 4.45 ? "hold" : "final-shot",
};

/**
 * The conclusion's clock: the render clock, never wall time, so a paused or hidden tab stops it and a slow frame
 * does not skip a beat. It owns no actors, chess state, camera or audio: each sample tells its caller where in
 * the timeline it is (the downfall's shots are `downfall/downfallCamera.ts`). Skip goes straight to the end once;
 * a newer board or conclusion cancels it without applying its last sample.
 */
export class CheckmatePresentation {
  private current: { revision: number; elapsed: number; timeline: ConclusionTimeline; sample(value: CheckmateSample): void; resolve(completed: boolean): void } | null = null;
  get active(): boolean { return this.current !== null; }
  /** Seconds the running conclusion has been going, or null. */
  get elapsed(): number | null { return this.current?.elapsed ?? null; }
  start(revision: number, sample: (value: CheckmateSample) => void, timeline: ConclusionTimeline = TABLEAU): Promise<boolean> {
    this.cancel();
    return new Promise(resolve => { this.current = { revision, elapsed: 0, timeline, sample, resolve }; this.emit(); });
  }
  update(delta: number, revision: number): void {
    if (!this.current) return;
    if (revision !== this.current.revision) { this.cancel(); return; }
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.current.elapsed = Math.min(this.current.timeline.duration, this.current.elapsed + delta);
    this.emit();
    if (this.current && this.current.elapsed >= this.current.timeline.duration) this.finish(true);
  }
  private emit(): void {
    const value = this.current;
    if (!value) return;
    const time = value.elapsed, duration = Math.max(1e-6, value.timeline.duration);
    try {
      value.sample({ time, progress: Math.min(1, time / duration), phase: value.timeline.phaseAt(time) });
    } catch { this.finish(false); }
  }
  private finish(completed: boolean): void { const previous = this.current; this.current = null; previous?.resolve(completed); }
  skip(): void { if (this.current) { this.current.elapsed = this.current.timeline.duration; this.emit(); this.finish(true); } }
  cancel(): void { this.finish(false); }
}
