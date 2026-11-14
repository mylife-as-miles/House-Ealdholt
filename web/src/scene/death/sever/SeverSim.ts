// Adapted from Lim-Young/SkeletalMeshDestruction (MIT). Copyright (c) 2025 Lim Young. See public/licenses/SkeletalMeshDestruction-MIT.txt.
/**
 * A severed limb in the physics world, and what it held: one box each, thrown from where they were cut.
 *
 * Each starts as a ghost (PhysicsWorld `ghost`): it flies, falls and tumbles but collides with nothing, not the body
 * it came off, not the weapon that leaves with it, not the stone, for its avoidance phase (severPlan.ts
 * `avoidSeconds`: inversely proportional to its launch speed, at least one step). The phase also ends the step before
 * its lowest corner would pass into the stone. Then it is solid: it lands, bounces, settles and sleeps like a burst's
 * pieces, and is held still once everything has come to rest. A limb and its weapon never collide with each other.
 *
 * No three.js; Jolt only through {@link PhysicsWorld}.
 */
import { PHYSICS_STEP } from "../physics/fixedStep";
import type { PhysicsBody, PhysicsWorld } from "../physics/PhysicsWorld";
import { RestWatch, type RestOptions } from "../physics/restWatch";
import { length, type Q4, type V3 } from "../physics/math";
import { avoidSeconds, boxBottom } from "./severPlan";

export interface SeverBody {
  /** Centre of the piece's box, world, and its turn and half sides. */
  centre: V3; rotation: Q4; half: V3;
  velocity: V3;
  /** Angular velocity, radians a second. */
  spin: V3;
  /** Kilograms; by default from its size, as flesh. */
  mass?: number;
}

/** A severed limb that has not settled by now is stopped where it is. */
export const SEVER_MAX_SECONDS = 4;
const DAMPING = { linear: 0.12, turn: 0.5 };
const REST: RestOptions = { shift: 0.006, turn: 0.05, seconds: 0.3, damping: DAMPING, calm: { linear: 5, turn: 12 }, calmFrom: 1.6, calmBy: 2.6, maxSeconds: SEVER_MAX_SECONDS };
/** Flesh, about the weight of water: kilograms a cubic metre, and the lightest and heaviest a limb may be. */
const DENSITY = 950, MASS = [0.6, 14] as const;
/** Metres of simulated world per scene unit, as the world keeps it. */
const SCALE = 2.25;
/** The avoidance phase ends this far (scene units) above the stone at the latest. */
const FLOOR_MARGIN = 0.01;

export class SeverSim {
  readonly bodies: PhysicsBody[] = [];
  /** When each piece stops being a ghost, in seconds of simulation, and whether it has. */
  readonly avoid: number[] = [];
  private readonly solid: boolean[] = [];
  private readonly rest: RestWatch;
  private readonly stopListening: () => void;
  private released = false;
  private elapsed = 0;
  private readonly down: boolean[] = [];
  private readonly at: V3 = [0, 0, 0];
  private readonly turn: Q4 = [0, 0, 0, 1];

  constructor(private readonly world: PhysicsWorld, readonly pieces: readonly SeverBody[]) {
    const apart: [number, number][] = [];
    for (let a = 0; a < pieces.length; a += 1) for (let b = a + 1; b < pieces.length; b += 1) apart.push([a, b]);
    const set = world.partSet(Math.max(1, pieces.length), apart);
    pieces.forEach((piece, index) => {
      const volume = 8 * piece.half[0] * piece.half[1] * piece.half[2] * SCALE ** 3;
      this.bodies.push(world.add({
        shape: { kind: "box", half: piece.half }, position: piece.centre, rotation: piece.rotation, velocity: piece.velocity, spin: piece.spin,
        mass: piece.mass ?? Math.min(MASS[1], Math.max(MASS[0], volume * DENSITY * 0.5)), friction: 0.85, restitution: 0.25,
        linearDamping: DAMPING.linear, angularDamping: DAMPING.turn, set, part: index, ghost: true,
      }));
      this.avoid.push(avoidSeconds(length(piece.velocity)));
      this.solid.push(false);
      this.down.push(false);
    });
    // Judged step by step, inside the world's own loop, so the frame rate cannot change when a limb turns solid.
    this.stopListening = world.eachStep(() => this.step());
    this.rest = new RestWatch(world, this.bodies, REST);
  }

  private step(): void {
    if (this.released) return;
    this.elapsed += PHYSICS_STEP;
    this.bodies.forEach((body, index) => {
      if (this.solid[index]) return;
      const piece = this.pieces[index];
      // Where it will be after the next step, near enough: the phase ends before the stone could be passed into.
      const bottom = boxBottom(this.world.position(body, this.at), this.world.rotation(body, this.turn), piece.half) + this.world.velocity(body, [0, 0, 0])[1] * PHYSICS_STEP;
      if (this.elapsed + 1e-9 >= this.avoid[index] || bottom <= this.world.groundY + FLOOR_MARGIN) {
        this.solid[index] = true;
        this.world.solidify(body);
      }
    });
  }

  /** True once every piece lies still (or the clock has run out). */
  get atRest(): boolean { return this.released || this.rest.atRest; }
  get age(): number { return this.rest.age; }
  /** Whether piece `index` has come out of its avoidance phase. */
  isSolid(index: number): boolean { return this.solid[index] ?? false; }

  position(index: number, out: V3): V3 { return this.world.position(this.bodies[index], out); }
  rotation(index: number, out: Q4): Q4 { return this.world.rotation(this.bodies[index], out); }

  /** Pieces that have reached the stone since this was last asked, each once: where blood is thrown. */
  landings(): number[] {
    const found: number[] = [], at: V3 = [0, 0, 0];
    if (this.released) return found;
    this.bodies.forEach((body, index) => {
      if (this.down[index] || !this.solid[index]) return;
      const piece = this.pieces[index], reach = Math.max(piece.half[0], piece.half[1], piece.half[2]);
      this.world.position(body, at);
      if (at[1] - this.world.groundY <= reach * 1.05 && this.world.velocity(body, [0, 0, 0])[1] <= 0.05) { this.down[index] = true; found.push(index); }
    });
    return found;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.stopListening();
    this.rest.stop();
    for (const body of this.bodies) this.world.remove(body);
  }
}
