/**
 * A ragdoll in the physics world: the bodies and joints of a
 * {@link RagdollPlan}, started from the animated pose and the speed it was
 * moving at, given the killing blow, and read back joint by joint until it
 * has come to rest.
 *
 * No three.js; Jolt only through {@link PhysicsWorld}.
 */
import type Jolt from "jolt-physics";
import type { PhysicsBody, PhysicsWorld, ShapeSpec } from "../physics/PhysicsWorld";
import { RestWatch, type RestOptions } from "../physics/restWatch";
import { angularVelocity, length, limit, scale, sub, type Q4, type V3 } from "../physics/math";
import { BLOW, blowVelocity, partBody, partJoint, type BlowInput, type RagdollPlan, type RigPose } from "./ragdollPlan";

/** At rest: no part has moved 0.008 of a square or turned 0.06 of a radian for 0.3 s. See {@link RestWatch}. */
export const REST_SHIFT = 0.008, REST_TURN = 0.06, REST_SECONDS = 0.3;
/** A fall that has not come to rest by now is stopped where it is: nothing slides forever. */
export const RAGDOLL_MAX_SECONDS = 4.5;
const DAMPING = { linear: 0.25, turn: 0.9 };
const REST: RestOptions = { shift: REST_SHIFT, turn: REST_TURN, seconds: REST_SECONDS, damping: DAMPING, calm: { linear: 6, turn: 14 }, calmFrom: 1.3, calmBy: 2.3, maxSeconds: RAGDOLL_MAX_SECONDS };
/** The animated pose may be moving fast (a hit reaction snaps); the bodies start no faster than this. */
const START_SPEED = 3.5, START_TURN = 9;
/**
 * The trunk is down when the lowest point of its pelvis or chest is within this of the stone (scene units, about a
 * fiftieth of a Pawn: a frame's fall at most), and its centre lies lower than this share of the figure's height,
 * which a figure standing on its legs, or a figure of one body standing on its base, does not.
 */
export const TRUNK_TOUCH = 0.015, TRUNK_LOW = 0.25;

/** How far below its centre a body's shape reaches, turned by `rotation`: its centre's height less this is its lowest point. */
export function reachBelow(shape: ShapeSpec, rotation: Q4): number {
  const [x, y, z, w] = rotation;
  // The world height of each of the body's own axes: the second row of its rotation matrix.
  const ax = Math.abs(2 * (x * y + w * z)), ay = Math.abs(1 - 2 * (x * x + z * z)), az = Math.abs(2 * (y * z - w * x));
  if (shape.kind === "box") return ax * shape.half[0] + ay * shape.half[1] + az * shape.half[2];
  if (shape.kind === "capsule") return ay * shape.halfHeight + shape.radius;
  return shape.radius;
}

export class RagdollSim {
  readonly bodies: PhysicsBody[] = [];
  private readonly joints: Jolt.Constraint[] = [];
  private readonly rest: RestWatch;
  private released = false;
  private readonly at: V3 = [0, 0, 0];
  private readonly turn: Q4 = [0, 0, 0, 1];
  /** The parts the trunk is made of (the pelvis and the chest; the one body of a figure without a skeleton). */
  private readonly trunk: number[];
  /** Where the trunk first came down on the stone, once it has. */
  private down: V3 | null = null;

  /**
   * `now` is the pose the bodies are made in; `before` the pose `elapsed`
   * seconds earlier, which is where their starting speed comes from.
   */
  constructor(private readonly world: PhysicsWorld, readonly plan: RagdollPlan, now: RigPose, before: RigPose | null = null, elapsed = 0) {
    const set = world.partSet(plan.parts.length, plan.apart);
    plan.parts.forEach((part, index) => {
      const body = partBody(part, now.positions[part.joint], now.rotations[part.joint]);
      let velocity: V3 | undefined, spin: V3 | undefined;
      if (before && elapsed > 1e-4) {
        const was = partBody(part, before.positions[part.joint], before.rotations[part.joint]);
        velocity = limit(scale(sub(body.position, was.position), 1 / elapsed), START_SPEED);
        spin = limit(angularVelocity(was.rotation, body.rotation, elapsed), START_TURN);
      }
      this.bodies.push(world.add({
        shape: part.shape, position: body.position, rotation: body.rotation, velocity, spin, mass: part.mass,
        // Flesh on stone: it grips, it does not bounce, and it stops turning.
        friction: 0.9, restitution: 0.02, linearDamping: DAMPING.linear, angularDamping: DAMPING.turn, set, part: index,
      }));
    });
    plan.parts.forEach((part, index) => { if (part.link) this.joints.push(world.join(this.bodies[part.parent], this.bodies[index], part.link)); });
    this.rest = new RestWatch(world, this.bodies, REST);
    this.trunk = plan.parts.flatMap((part, index) => part.name === "pelvis" || part.name === "chest" ? [index] : []);
  }

  /**
   * The killing blow: the whole body is thrown the way it travels, most at
   * the head, and the part it met is struck where it was met. A figure that
   * is one body (`topple`) is tipped over its base instead, since it has no
   * knees to give way.
   */
  blow(blow: BlowInput, topple = false): void {
    const centres = this.bodies.map(body => this.world.position(body, [0, 0, 0]));
    const low = Math.min(...centres.map(c => c[1])), high = Math.max(...centres.map(c => c[1])), span = Math.max(1e-4, high - low);
    let struck = 0, nearest = Infinity;
    this.bodies.forEach((body, index) => {
      this.world.push(body, blowVelocity(blow, (centres[index][1] - low) / span));
      const distance = length(sub(centres[index], blow.point));
      if (distance < nearest) { nearest = distance; struck = index; }
    });
    const l = Math.hypot(blow.direction.x, blow.direction.z) || 1, power = Math.min(2, Math.max(0.3, blow.power));
    if (topple) {
      const x = blow.direction.x / l, z = blow.direction.z / l;
      this.world.push(this.bodies[0], [x * BLOW.carry * 0.5 * power, BLOW.lift * power, z * BLOW.carry * 0.5 * power]);
      // Turning about the line across the blow, top first.
      this.world.twirl(this.bodies[0], [z * BLOW.topple * power, 0, -x * BLOW.topple * power]);
    }
    // A contact point that is nowhere near the body (a spell, a shot from across the board) strikes the chest at its centre.
    const far = nearest > this.plan.height * 0.6;
    const index = far ? Math.max(0, this.plan.parts.findIndex(part => part.name === "chest")) : struck;
    this.world.strike(this.bodies[index], [blow.direction.x / l * BLOW.strike * power, 0, blow.direction.z / l * BLOW.strike * power], far ? centres[index] : blow.point);
  }

  /**
   * Watches for the trunk coming down: call once a frame, after the world has stepped. Returns the point on the stone
   * under the pelvis or the chest, whichever met it first, from the frame it first did (where a fallen body's dust
   * rises); null before then, and for a fall whose trunk never comes down.
   */
  watchTrunk(): V3 | null {
    if (this.down || this.released) return this.down;
    const floor = this.world.groundY;
    for (const index of this.trunk) {
      const centre = this.world.position(this.bodies[index], this.at), low = centre[1] - reachBelow(this.plan.parts[index].shape, this.world.rotation(this.bodies[index], this.turn));
      if (low <= floor + TRUNK_TOUCH && centre[1] - floor <= this.plan.height * TRUNK_LOW) { this.down = [centre[0], floor, centre[2]]; break; }
    }
    return this.down;
  }

  /** True once the body has come to rest (or run out of time). */
  get atRest(): boolean { return this.released || this.rest.atRest; }
  /** Seconds simulated. */
  get age(): number { return this.rest.age; }

  /** The pose of part `index`'s joint, from where its body is now. */
  joint(index: number): { position: V3; rotation: Q4 } {
    const body = this.bodies[index];
    return partJoint(this.plan.parts[index], this.world.position(body, this.at), this.world.rotation(body, this.turn));
  }
  /** The centre of part `index`'s body. */
  centre(index: number, out: V3): V3 { return this.world.position(this.bodies[index], out); }

  /** Takes the joints and bodies out of the world. The pose is whatever was last read. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.rest.stop();
    for (const joint of this.joints) this.world.unjoin(joint);
    for (const body of this.bodies) this.world.remove(body);
    this.joints.length = 0;
  }
}
