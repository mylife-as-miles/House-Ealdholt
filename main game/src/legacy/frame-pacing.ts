// Frame pacing for the automatic quality step-down (adaptive-quality.ts,
// docs/legacy/PERFORMANCE.md). The step-down needs the interval between frames
// rendered back to back: a slow graphics card stretches that interval while the
// main-thread cost of submitting a frame stays small, so submission time alone
// never shows GPU-bound slowness. Submission time is kept as a separate series.

/** Samples kept per series; the step-down needs at least 60. */
export const FRAME_PACING_SAMPLES = 120;
/** Longer intervals (a hidden tab, a debugger, a blocked main thread) are stalls, not frame pacing. */
export const FRAME_STALL_MS = 1500;

function ringToArray(ring: Float32Array, count: number, cursor: number): number[] {
  const out = new Array<number>(count);
  const start = count < ring.length ? 0 : cursor;
  for (let i = 0; i < count; i++) out[i] = ring[(start + i) % ring.length];
  return out;
}

/**
 * Records the interval between consecutive rendered frames. A frame is a
 * sample only when the frame before it was rendered in the same run: call
 * interrupt() whenever the loop skips a frame for any reason other than its
 * frame limit (paused, hidden, nothing to draw), so the next frame starts a new
 * run instead of counting the gap. No allocation per frame.
 */
export class FramePacing {
  private readonly intervals: Float32Array;
  private readonly submissions: Float32Array;
  private intervalCount = 0;
  private intervalCursor = 0;
  private submissionCount = 0;
  private submissionCursor = 0;
  private lastRenderedAt = 0;
  private continuing = false;

  constructor(samples = FRAME_PACING_SAMPLES) {
    this.intervals = new Float32Array(samples);
    this.submissions = new Float32Array(samples);
  }

  /** The loop is not rendering for a while: the next rendered frame starts a new run. */
  interrupt(): void {
    this.continuing = false;
  }

  /** A frame was rendered at animation-frame time `now` after `submissionMs` of main-thread submission. */
  rendered(now: number, submissionMs: number): void {
    this.submissions[this.submissionCursor] = submissionMs;
    this.submissionCursor = (this.submissionCursor + 1) % this.submissions.length;
    if (this.submissionCount < this.submissions.length) this.submissionCount++;
    const interval = now - this.lastRenderedAt;
    if (this.continuing && interval > 0 && interval < FRAME_STALL_MS) {
      this.intervals[this.intervalCursor] = interval;
      this.intervalCursor = (this.intervalCursor + 1) % this.intervals.length;
      if (this.intervalCount < this.intervals.length) this.intervalCount++;
    }
    this.lastRenderedAt = now;
    this.continuing = true;
  }

  /** Recent intervals between frames rendered back to back, oldest first. */
  frameIntervals(): number[] {
    return ringToArray(this.intervals, this.intervalCount, this.intervalCursor);
  }

  /** Recent main-thread submission times, oldest first. */
  submissionTimes(): number[] {
    return ringToArray(this.submissions, this.submissionCount, this.submissionCursor);
  }
}
