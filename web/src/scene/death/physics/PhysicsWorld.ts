/**
 * The death physics world: one small Jolt world for falling bodies and flying
 * pieces. The board is static ground, four unseen walls keep everything in
 * the arena, and the figures still standing are static posts.
 *
 * It is built when a death needs it and freed when the last body has come to
 * rest, so a match that is not burying anyone runs no physics at all, and a
 * world always starts from nothing: the same fall from the same inputs is
 * the same fall, whatever died before it.
 *
 * Everything callers pass and read is in the scene's own units (one square is
 * about one unit). Inside, the world is simulated at human scale, in metres,
 * so Jolt's tolerances and real gravity apply and a body falls in the time a
 * man does.
 *
 * No three.js, and Jolt only as a type: the module is handed in (see
 * joltLoader.ts), which is what lets `npm run test:play` run this in Node.
 */
import type Jolt from "jolt-physics";
import { FixedStep, PHYSICS_STEP } from "./fixedStep";
import type { Q4, V3 } from "./math";

export type JoltModule = typeof Jolt;

/** Metres of simulated world per scene unit: a Pawn 0.78 units tall falls as a man of 1.75 m. */
export const PHYSICS_SCALE = 2.25;

/**
 * Object layers. A ghost moves like any body but meets nothing at all, not the stone, not a post, not another body:
 * the avoidance phase of a severed limb (death/sever), until {@link PhysicsWorld.solidify} puts it among the rest.
 */
const LAYER_STATIC = 0, LAYER_MOVING = 1, LAYER_GHOST = 2;

export interface WorldOptions {
  /** Height of the board's surface. */
  groundY: number;
  /** Half the side of the square that bodies are kept inside; the walls stand there. */
  arena: number;
  /** Bodies the world must be able to hold, obstacles included. */
  maxBodies?: number;
  /** Solver iterations, by quality: 6 and 2 on the lowest preset, Jolt's own 10 and 2 otherwise. */
  velocitySteps?: number;
  positionSteps?: number;
}

/** A standing figure: a post nothing may fall into or come to rest on. */
export interface Obstacle { x: number; z: number; radius: number }

export type ShapeSpec =
  | { kind: "box"; half: V3 }
  /** A capsule along the body's own y axis: `halfHeight` is half the straight part. */
  | { kind: "capsule"; halfHeight: number; radius: number }
  | { kind: "sphere"; radius: number };

export interface BodySpec {
  shape: ShapeSpec;
  /** Centre of the shape, which is the centre of mass. */
  position: V3;
  rotation: Q4;
  velocity?: V3;
  /** Angular velocity, radians a second. */
  spin?: V3;
  /** Kilograms. */
  mass: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Parts of one figure: `set` from {@link PhysicsWorld.partSet}, `part` its index in it. */
  set?: PartSet; part?: number;
  /** Starts as a ghost: it falls and turns but collides with nothing until {@link PhysicsWorld.solidify}. */
  ghost?: boolean;
}

/** Limits of a swing-twist joint, radians. Frames are in each body's own space, about its centre. */
export interface JointSpec {
  anchorA: V3; twistA: V3; planeA: V3;
  anchorB: V3; twistB: V3; planeB: V3;
  /** Swing in the plane of the twist and plane axes (a hinge's whole travel), half-angle. */
  planeHalfCone: number;
  /** Swing out of that plane, half-angle. */
  normalHalfCone: number;
  twistMin: number; twistMax: number;
  /** A hinge: the two swings are limited each on its own (a pyramid), not together (a cone). */
  hinge?: boolean;
}

export interface PartSet { readonly filter: Jolt.GroupFilterTable; readonly id: number }

export class PhysicsBody {
  /** @internal */
  constructor(readonly body: Jolt.Body, readonly id: Jolt.BodyID, readonly mass: number) {}
}

export class PhysicsWorld {
  readonly J: JoltModule;
  readonly groundY: number;
  readonly arena: number;
  private readonly jolt: Jolt.JoltInterface;
  private readonly system: Jolt.PhysicsSystem;
  private readonly bodies: Jolt.BodyInterface;
  private readonly clock = new FixedStep();
  private readonly statics: Jolt.Body[] = [];
  private readonly posts: Jolt.Body[] = [];
  private readonly live = new Set<PhysicsBody>();
  private readonly joints = new Set<Jolt.Constraint>();
  private readonly v: Jolt.Vec3;
  private readonly v2: Jolt.Vec3;
  private readonly r: Jolt.RVec3;
  private readonly q: Jolt.Quat;
  private readonly listeners = new Set<() => void>();
  private sets = 0;
  private stepped = 0;
  private disposed = false;

  constructor(jolt: JoltModule, options: WorldOptions) {
    const J = this.J = jolt;
    this.groundY = options.groundY; this.arena = options.arena;
    const settings = new J.JoltSettings();
    settings.mMaxBodies = options.maxBodies ?? 96;
    settings.mMaxBodyPairs = 2048;
    settings.mMaxContactConstraints = 1024;
    const pairs = new J.ObjectLayerPairFilterTable(3);
    pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING);
    pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    // LAYER_GHOST is enabled with nothing.
    const broad = new J.BroadPhaseLayerInterfaceTable(3, 2);
    const still = new J.BroadPhaseLayer(0), moving = new J.BroadPhaseLayer(1);
    broad.MapObjectToBroadPhaseLayer(LAYER_STATIC, still);
    broad.MapObjectToBroadPhaseLayer(LAYER_MOVING, moving);
    broad.MapObjectToBroadPhaseLayer(LAYER_GHOST, moving);
    J.destroy(still); J.destroy(moving);
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = broad;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(broad, 2, pairs, 3);
    this.jolt = new J.JoltInterface(settings);
    J.destroy(settings);
    this.system = this.jolt.GetPhysicsSystem();
    this.bodies = this.system.GetBodyInterface();
    this.v = new J.Vec3(0, 0, 0); this.v2 = new J.Vec3(0, 0, 0); this.r = new J.RVec3(0, 0, 0); this.q = new J.Quat(0, 0, 0, 1);

    const tuning = this.system.GetPhysicsSettings();
    tuning.mNumVelocitySteps = options.velocitySteps ?? 10;
    tuning.mNumPositionSteps = options.positionSteps ?? 2;
    // A body that has stopped is put to sleep quickly: a corpse must not creep.
    tuning.mTimeBeforeSleep = 0.35;
    tuning.mPointVelocitySleepThreshold = 0.05;
    this.system.SetPhysicsSettings(tuning);
    this.v.Set(0, -9.81, 0);
    this.system.SetGravity(this.v);

    const S = PHYSICS_SCALE, reach = (options.arena + 2) * S, wall = 4 * S;
    // The stone: one slab under the whole arena, its top at the board's surface.
    this.statics.push(this.addStatic({ kind: "box", half: [reach, 1, reach] }, [0, options.groundY * S - 1, 0]));
    // Unseen walls at the arena's edge. Nothing is thrown hard enough to need them often; they are what "never leaves" rests on.
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const half: V3 = x ? [0.5, wall, reach] : [reach, wall, 0.5];
      this.statics.push(this.addStatic({ kind: "box", half }, [x * (options.arena * S + 0.5), options.groundY * S + wall, z * (options.arena * S + 0.5)]));
    }
  }

  /** Static shape, sizes and position already in metres. */
  private addStatic(shape: ShapeSpec, position: V3): Jolt.Body {
    const J = this.J;
    this.r.Set(position[0], position[1], position[2]); this.q.Set(0, 0, 0, 1);
    const settings = new J.BodyCreationSettings(this.shape(shape, 1), this.r, this.q, J.EMotionType_Static, LAYER_STATIC);
    settings.mFriction = 0.9; settings.mRestitution = 0.05;
    return this.place(settings);
  }

  /** A body id returned by value is a view of one shared slot, so statics are kept as bodies and asked for their id when it is needed. */
  private place(settings: Jolt.BodyCreationSettings): Jolt.Body {
    const body = this.bodies.CreateBody(settings);
    this.J.destroy(settings);
    this.bodies.AddBody(body.GetID(), this.J.EActivation_DontActivate);
    return body;
  }
  private drop(body: Jolt.Body): void { const id = body.GetID(); this.bodies.RemoveBody(id); this.bodies.DestroyBody(id); }

  private shape(spec: ShapeSpec, S: number): Jolt.Shape {
    const J = this.J;
    if (spec.kind === "capsule") return new J.CapsuleShape(Math.max(1e-3, spec.halfHeight * S), Math.max(5e-3, spec.radius * S));
    if (spec.kind === "sphere") return new J.SphereShape(Math.max(5e-3, spec.radius * S));
    const half = spec.half.map(value => Math.max(5e-3, value * S)) as V3;
    this.v.Set(half[0], half[1], half[2]);
    return new J.BoxShape(this.v, Math.min(0.05, Math.min(half[0], half[1], half[2]) * 0.5));
  }

  /** The figures standing now. Replaces the posts of the last call. */
  setObstacles(obstacles: readonly Obstacle[]): void {
    for (const post of this.posts.splice(0)) this.drop(post);
    const J = this.J, S = PHYSICS_SCALE, half = 3 * S;
    for (const post of obstacles) {
      this.r.Set(post.x * S, this.groundY * S + half, post.z * S); this.q.Set(0, 0, 0, 1);
      // Taller than anything can be thrown: a body slides off a post, it never lies on one.
      const shape = new J.CylinderShape(half, Math.max(0.02, post.radius * S), 0.02);
      const settings = new J.BodyCreationSettings(shape, this.r, this.q, J.EMotionType_Static, LAYER_STATIC);
      settings.mFriction = 0.3; settings.mRestitution = 0.05;
      this.posts.push(this.place(settings));
    }
  }

  /** A group of bodies that belong to one figure. Pairs named in `apart` do not collide with each other. */
  partSet(parts: number, apart: readonly (readonly [number, number])[]): PartSet {
    const filter = new this.J.GroupFilterTable(parts);
    for (const [a, b] of apart) filter.DisableCollision(a, b);
    this.sets += 1;
    return { filter, id: this.sets };
  }

  add(spec: BodySpec): PhysicsBody {
    const J = this.J, S = PHYSICS_SCALE;
    this.r.Set(spec.position[0] * S, spec.position[1] * S, spec.position[2] * S);
    this.q.Set(spec.rotation[0], spec.rotation[1], spec.rotation[2], spec.rotation[3]);
    const settings = new J.BodyCreationSettings(this.shape(spec.shape, S), this.r, this.q, J.EMotionType_Dynamic, spec.ghost ? LAYER_GHOST : LAYER_MOVING);
    settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
    settings.mMassPropertiesOverride.mMass = spec.mass;
    settings.mFriction = spec.friction ?? 0.8;
    settings.mRestitution = spec.restitution ?? 0.05;
    settings.mLinearDamping = spec.linearDamping ?? 0.1;
    settings.mAngularDamping = spec.angularDamping ?? 0.3;
    settings.mMaxLinearVelocity = 30; settings.mMaxAngularVelocity = 40;
    if (spec.velocity) { this.v.Set(spec.velocity[0] * S, spec.velocity[1] * S, spec.velocity[2] * S); settings.mLinearVelocity = this.v; }
    if (spec.spin) { this.v.Set(spec.spin[0], spec.spin[1], spec.spin[2]); settings.mAngularVelocity = this.v; }
    if (spec.set) {
      const group = settings.mCollisionGroup;
      group.SetGroupFilter(spec.set.filter); group.SetGroupID(spec.set.id); group.SetSubGroupID(spec.part ?? 0);
    }
    const body = this.bodies.CreateBody(settings);
    J.destroy(settings);
    this.bodies.AddBody(body.GetID(), J.EActivation_Activate);
    const handle = new PhysicsBody(body, body.GetID(), spec.mass);
    this.live.add(handle);
    return handle;
  }

  remove(body: PhysicsBody): void {
    if (!this.live.delete(body)) return;
    this.bodies.RemoveBody(body.id); this.bodies.DestroyBody(body.id);
  }

  /** A ghost becomes an ordinary body: from the next step it collides with the stone, the posts and every other body. */
  solidify(body: PhysicsBody): void {
    if (!this.live.has(body) || this.bodies.GetObjectLayer(body.id) !== LAYER_GHOST) return;
    this.bodies.SetObjectLayer(body.id, LAYER_MOVING);
    this.bodies.ActivateBody(body.id);
  }
  /** Whether a body is still a ghost. */
  isGhost(body: PhysicsBody): boolean { return this.live.has(body) && this.bodies.GetObjectLayer(body.id) === LAYER_GHOST; }

  /** A swing-twist joint between two bodies: limbs that bend like limbs. */
  join(a: PhysicsBody, b: PhysicsBody, spec: JointSpec): Jolt.Constraint {
    const J = this.J, S = PHYSICS_SCALE, settings = new J.SwingTwistConstraintSettings();
    settings.mSpace = J.EConstraintSpace_LocalToBodyCOM;
    this.r.Set(spec.anchorA[0] * S, spec.anchorA[1] * S, spec.anchorA[2] * S); settings.mPosition1 = this.r;
    this.r.Set(spec.anchorB[0] * S, spec.anchorB[1] * S, spec.anchorB[2] * S); settings.mPosition2 = this.r;
    this.v.Set(spec.twistA[0], spec.twistA[1], spec.twistA[2]); settings.mTwistAxis1 = this.v;
    this.v.Set(spec.planeA[0], spec.planeA[1], spec.planeA[2]); settings.mPlaneAxis1 = this.v;
    this.v.Set(spec.twistB[0], spec.twistB[1], spec.twistB[2]); settings.mTwistAxis2 = this.v;
    this.v.Set(spec.planeB[0], spec.planeB[1], spec.planeB[2]); settings.mPlaneAxis2 = this.v;
    settings.mSwingType = spec.hinge ? J.ESwingType_Pyramid : J.ESwingType_Cone;
    settings.mNormalHalfConeAngle = spec.normalHalfCone; settings.mPlaneHalfConeAngle = spec.planeHalfCone;
    settings.mTwistMinAngle = spec.twistMin; settings.mTwistMaxAngle = spec.twistMax;
    const joint = settings.Create(a.body, b.body);
    J.destroy(settings);
    this.system.AddConstraint(joint);
    this.joints.add(joint);
    return joint;
  }

  unjoin(joint: Jolt.Constraint): void { if (this.joints.delete(joint)) this.system.RemoveConstraint(joint); }

  position(body: PhysicsBody, out: V3): V3 {
    const p = body.body.GetPosition(), S = PHYSICS_SCALE;
    out[0] = p.GetX() / S; out[1] = p.GetY() / S; out[2] = p.GetZ() / S;
    return out;
  }
  rotation(body: PhysicsBody, out: Q4): Q4 {
    const q = body.body.GetRotation();
    out[0] = q.GetX(); out[1] = q.GetY(); out[2] = q.GetZ(); out[3] = q.GetW();
    return out;
  }
  /** Speed of the body's centre, scene units a second. */
  speed(body: PhysicsBody): number { return body.body.GetLinearVelocity().Length() / PHYSICS_SCALE; }
  /** Rate of turn, radians a second. */
  turning(body: PhysicsBody): number { return body.body.GetAngularVelocity().Length(); }
  velocity(body: PhysicsBody, out: V3): V3 {
    const v = body.body.GetLinearVelocity(), S = PHYSICS_SCALE;
    out[0] = v.GetX() / S; out[1] = v.GetY() / S; out[2] = v.GetZ() / S;
    return out;
  }
  asleep(body: PhysicsBody): boolean { return !body.body.IsActive(); }
  /** How fast the body's own motion dies away, each a share lost a second. */
  damp(body: PhysicsBody, linear: number, angular: number): void {
    const motion = body.body.GetMotionProperties();
    motion.SetLinearDamping(linear); motion.SetAngularDamping(angular);
  }

  /** A change of velocity for the whole body, scene units a second. */
  push(body: PhysicsBody, velocity: V3): void {
    const S = PHYSICS_SCALE;
    this.v.Set(velocity[0] * S, velocity[1] * S, velocity[2] * S);
    this.bodies.AddLinearVelocity(body.id, this.v);
  }
  /** Adds to the body's rate of turn, radians a second. */
  twirl(body: PhysicsBody, spin: V3): void {
    this.v.Set(0, 0, 0); this.v2.Set(spin[0], spin[1], spin[2]);
    this.bodies.AddLinearAndAngularVelocity(body.id, this.v, this.v2);
  }
  /** A blow at a point: `impulse` is kilograms times scene units a second, `at` a world point. Off the centre it turns the body. */
  strike(body: PhysicsBody, impulse: V3, at: V3): void {
    const S = PHYSICS_SCALE;
    this.v.Set(impulse[0] * S, impulse[1] * S, impulse[2] * S); this.r.Set(at[0] * S, at[1] * S, at[2] * S);
    this.bodies.ActivateBody(body.id);
    body.body.AddImpulse(this.v, this.r);
  }

  /** Banks the frame and runs the whole steps owed. Returns how many ran. */
  step(delta: number): number {
    if (this.disposed) return 0;
    const steps = this.clock.advance(delta);
    for (let i = 0; i < steps; i += 1) {
      this.jolt.Step(PHYSICS_STEP, 1);
      // Whatever reacts to the simulation does so once a step, not once a frame: the frame rate must not change a fall.
      for (const listener of this.listeners) listener();
    }
    this.stepped += steps;
    return steps;
  }

  /** Calls `listener` after every fixed step. Returns the way to stop. */
  eachStep(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Steps run since the world was made. */
  get steps(): number { return this.stepped; }
  /** Moving bodies in the world. */
  get count(): number { return this.live.size; }
  get jointCount(): number { return this.joints.size; }
  get obstacleCount(): number { return this.posts.length; }

  /** Frees the world and everything in it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    for (const joint of this.joints) this.system.RemoveConstraint(joint);
    this.joints.clear();
    for (const body of this.live) { this.bodies.RemoveBody(body.id); this.bodies.DestroyBody(body.id); }
    this.live.clear();
    for (const body of [...this.posts, ...this.statics]) this.drop(body);
    this.posts.length = 0; this.statics.length = 0;
    const J = this.J;
    J.destroy(this.v); J.destroy(this.v2); J.destroy(this.r); J.destroy(this.q);
    J.destroy(this.jolt);
  }
}
