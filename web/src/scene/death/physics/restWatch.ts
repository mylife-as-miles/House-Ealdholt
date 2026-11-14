/**
 * Decides when a set of bodies has come to rest, and makes sure it does.
 *
 * Rest is read off the pose, not the speeds, after every fixed step: nothing has moved further than
 * `shift` (scene units) or turned further than `turn` (radians) for
 * `seconds`. A contact that trembles without going anywhere is at rest; a
 * limb that creeps is not. From `calmFrom` on, what motion is left is damped
 * harder every step, so a piece that would rock or roll on for seconds is
 * brought down, and at `maxSeconds` whatever is still moving is stopped
 * where it is: nothing slides forever.
 */
import { PHYSICS_STEP } from "./fixedStep";
import type { PhysicsBody, PhysicsWorld } from "./PhysicsWorld";
import type { Q4, V3 } from "./math";

export interface RestOptions {
  shift: number; turn: number; seconds: number;
  /** Damping (a share lost a second) the bodies were made with, and what it rises to between `calmFrom` and `calmBy`. */
  damping: { linear: number; turn: number };
  calm: { linear: number; turn: number };
  calmFrom: number; calmBy: number;
  maxSeconds: number;
}

export class RestWatch {
  private quiet = 0;
  private elapsed = 0;
  private rested = false;
  private readonly held: { at: V3; turn: Q4 }[] = [];
  private readonly at: V3 = [0, 0, 0];
  private readonly turn: Q4 = [0, 0, 0, 1];

  private readonly stopListening: () => void;

  constructor(private readonly world: PhysicsWorld, private readonly bodies: readonly PhysicsBody[], private readonly options: RestOptions) {
    // Watched step by step, inside the world's own loop: a frame of two steps is judged exactly as two frames of one.
    this.stopListening = world.eachStep(() => this.step());
  }

  /** Stops watching: the bodies are about to leave the world. */
  stop(): void { this.stopListening(); }

  private step(): void {
    const o = this.options;
    if (!this.rested) {
      this.elapsed += PHYSICS_STEP;
      if (this.elapsed > o.calmFrom) {
        const calm = Math.min(1, (this.elapsed - o.calmFrom) / (o.calmBy - o.calmFrom)), eased = calm * calm;
        for (const body of this.bodies) this.world.damp(body, o.damping.linear + (o.calm.linear - o.damping.linear) * eased, o.damping.turn + (o.calm.turn - o.damping.turn) * eased);
      }
      let still = this.held.length > 0;
      for (let b = 0; b < this.bodies.length && still; b += 1) {
        const at = this.world.position(this.bodies[b], this.at), turn = this.world.rotation(this.bodies[b], this.turn), held = this.held[b];
        const same = Math.abs(turn[0] * held.turn[0] + turn[1] * held.turn[1] + turn[2] * held.turn[2] + turn[3] * held.turn[3]);
        if (Math.hypot(at[0] - held.at[0], at[1] - held.at[1], at[2] - held.at[2]) > o.shift || 2 * Math.acos(Math.min(1, same)) > o.turn) still = false;
      }
      if (still) this.quiet += PHYSICS_STEP;
      else {
        // Something moved: this is the pose the next quiet spell is measured against.
        this.quiet = 0;
        this.bodies.forEach((body, b) => { const held = this.held[b] ??= { at: [0, 0, 0], turn: [0, 0, 0, 1] }; this.world.position(body, held.at); this.world.rotation(body, held.turn); });
      }
      if (this.quiet >= o.seconds || this.elapsed >= o.maxSeconds) this.rested = true;
    }
  }

  /** True once everything is at rest (or out of time). */
  get atRest(): boolean { return this.rested; }
  /** Seconds simulated. */
  get age(): number { return this.elapsed; }
}
