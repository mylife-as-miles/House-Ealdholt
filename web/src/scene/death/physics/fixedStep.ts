/**
 * The physics clock: whole fixed steps out of whatever the frame delta was.
 *
 * Jolt gives the same result for the same sequence of steps, so the world is
 * never stepped by the frame's own delta. The frame delta is banked here and
 * paid out in steps of one size; the same sequence of deltas (the capture
 * harness's virtual clock, a replay) pays out the same steps on the same
 * frames, and a fall that is given enough time ends in the same place however
 * the frames were cut.
 */
export const PHYSICS_STEP = 1 / 60;
/** A frame that took longer than this many steps is not caught up: the fall slows instead of the frame. */
export const PHYSICS_MAX_STEPS = 4;

export class FixedStep {
  private banked = 0;

  constructor(readonly step: number = PHYSICS_STEP, readonly maxSteps: number = PHYSICS_MAX_STEPS) {}

  /** Banks a frame and returns the whole steps now owed. */
  advance(delta: number): number {
    if (!(delta > 0) || !Number.isFinite(delta)) return 0;
    this.banked += delta;
    // A float that is a hair short of a whole step still counts as one: 1/30 is two steps, never one.
    let steps = Math.floor(this.banked / this.step + 1e-6);
    if (steps <= 0) return 0;
    this.banked = Math.max(0, this.banked - steps * this.step);
    if (steps > this.maxSteps) { steps = this.maxSteps; this.banked = 0; }
    return steps;
  }

  /** Time banked towards the next step. */
  get remainder(): number { return this.banked; }
  reset(): void { this.banked = 0; }
}
