/**
 * The pieces of a burst body in the physics world: one box each, thrown
 * outward from the blast, bouncing and settling on the board.
 *
 * No three.js; Jolt only through {@link PhysicsWorld}.
 */
import type { PhysicsBody, PhysicsWorld } from "../physics/PhysicsWorld";
import { RestWatch, type RestOptions } from "../physics/restWatch";
import type { Q4, V3 } from "../physics/math";
import { burstVelocity } from "./gibPlan";

export interface GibBody {
  /** Centre of the piece's box, world. */
  centre: V3;
  rotation: Q4;
  half: V3;
  /** Indices (into the same list) of pieces it was cut from: they start touching, so they pass through each other. */
  neighbours: readonly number[];
}

/** A burst that has not settled by now is stopped where it is. */
export const GIB_MAX_SECONDS = 6;
const DAMPING = { linear: 0.12, turn: 0.5 };
const REST: RestOptions = { shift: 0.006, turn: 0.05, seconds: 0.3, damping: DAMPING, calm: { linear: 5, turn: 12 }, calmFrom: 2.2, calmBy: 3.4, maxSeconds: GIB_MAX_SECONDS };
/** Flesh, about the weight of water: kilograms a cubic metre, and the lightest and heaviest a piece may be. */
const DENSITY = 950, MASS = [0.8, 45] as const;
/** Metres of simulated world per scene unit, as the world keeps it. */
const SCALE = 2.25;

export class GibSim {
  readonly bodies: PhysicsBody[] = [];
  private readonly rest: RestWatch;
  private released = false;
  /** Whether each piece has met the stone yet, and whether it had before this frame. */
  private readonly down: boolean[] = [];

  constructor(private readonly world: PhysicsWorld, readonly pieces: readonly GibBody[], blast: V3, power: number, seed: number) {
    const apart: [number, number][] = [];
    pieces.forEach((piece, index) => { for (const other of piece.neighbours) if (other > index && other < pieces.length) apart.push([index, other]); });
    const set = world.partSet(pieces.length, apart);
    // How far the furthest piece is from the blast: the nearest are thrown hardest.
    const reach = Math.max(1e-3, ...pieces.map(piece => Math.hypot(piece.centre[0] - blast[0], piece.centre[1] - blast[1], piece.centre[2] - blast[2])));
    pieces.forEach((piece, index) => {
      const { velocity, spin } = burstVelocity(piece.centre, blast, power, reach, seed, index);
      const volume = 8 * piece.half[0] * piece.half[1] * piece.half[2] * SCALE ** 3;
      this.bodies.push(world.add({
        shape: { kind: "box", half: piece.half }, position: piece.centre, rotation: piece.rotation, velocity, spin,
        mass: Math.min(MASS[1], Math.max(MASS[0], volume * DENSITY * 0.5)), friction: 0.85, restitution: 0.22,
        linearDamping: DAMPING.linear, angularDamping: DAMPING.turn, set, part: index,
      }));
      this.down.push(false);
    });
    this.rest = new RestWatch(world, this.bodies, REST);
  }

  /** True once every piece lies still (or the clock has run out). */
  get atRest(): boolean { return this.released || this.rest.atRest; }
  get age(): number { return this.rest.age; }

  position(index: number, out: V3): V3 { return this.world.position(this.bodies[index], out); }
  rotation(index: number, out: Q4): Q4 { return this.world.rotation(this.bodies[index], out); }

  /** Pieces that have reached the stone since this was last asked, each once: where blood is thrown. */
  landings(): number[] {
    const found: number[] = [], at: V3 = [0, 0, 0];
    if (this.released) return found;
    this.bodies.forEach((body, index) => {
      if (this.down[index]) return;
      const piece = this.pieces[index], reach = Math.max(piece.half[0], piece.half[1], piece.half[2]);
      this.world.position(body, at);
      // Low enough that some face must be on the stone, and no longer on its way up.
      if (at[1] - this.world.groundY <= reach * 1.05 && this.world.velocity(body, [0, 0, 0])[1] <= 0.05 && this.rest.age > 0.12) { this.down[index] = true; found.push(index); }
    });
    return found;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.rest.stop();
    for (const body of this.bodies) this.world.remove(body);
  }
}
