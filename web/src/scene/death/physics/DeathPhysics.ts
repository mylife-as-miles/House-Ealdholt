/**
 * Physics-driven deaths: the one object sceneEngine.ts talks to.
 *
 *   const death = new DeathPhysics({ quality, groundY: BOARD_TOP, tile: TILE });
 *   scene.add(death.root);
 *   death.fall(victim, { direction, point, power, height, standing })   // knockDown(): true if the ragdoll took the fall
 *   death.explode(victim, blastPoint, power, { ply, seed, standing })    // true if the body burst apart
 *   death.sever(victim, { point, direction, power, ply, seed })         // the limb a killing blow took off, or null
 *   death.onTrunkDown(victim, at => ...)                                 // where and when a ragdoll's trunk first meets the stone
 *   death.update(delta, wanted);                                         // every frame, after the pieces
 *   death.setQuality(preset); death.undoTo(ply); death.clear(); death.dispose();
 *
 * Jolt is fetched in the background the first frame a match wants it and
 * nothing waits for it: until it has arrived `fall()` answers false and the
 * death plays as it did before. The physics world exists only while a body
 * is falling; it is built for the first one and freed when the last has come
 * to rest, so every death starts in a world with no history.
 */
import * as THREE from "three";
import type { PieceView } from "../../pieces";
import type { QualityPreset } from "../../quality";
import { GibSystem, type ExplodeContext, type GibBlood, type GibStats } from "../gibs/GibSystem";
import { RagdollSystem, type RagdollRequest, type RagdollStats } from "../ragdoll/RagdollSystem";
import { SeverSystem, type SeverRequest, type SeverStats } from "../sever/SeverSystem";
import type { SeverLimb } from "../sever/severPlan";
import { joltReady, loadJolt } from "./joltLoader";
import { PhysicsWorld, type JoltModule, type Obstacle } from "./PhysicsWorld";

export interface DeathPhysicsOptions {
  quality: QualityPreset;
  /** Height of the board's surface. */
  groundY: number;
  /** One square, scene units. */
  tile: number;
  /** A Jolt module already in hand (tests). Otherwise it is loaded lazily. */
  jolt?: JoltModule;
  /** The scene's gore system: a burst body and a severed limb bleed through it. Without one both are dry. */
  gore?: GibBlood | null;
  /** A piece of a burst body or a severed limb has reached the stone, `trunk` for a burst's biggest: where the engine plays a cue it already has. */
  onLanding?: (at: THREE.Vector3, trunk: boolean) => void;
}

/**
 * What each quality preset gives a death.
 *  - low: one body an arm (9 bodies, 8 joints), one ragdoll falling at a time, fewer solver passes.
 *  - medium and up: upper arm and forearm (11 bodies, 10 joints), two falling at once.
 * A burst body is 6, 8 or 11 pieces: see GIB_BUDGET in gibs/gibPlan.ts.
 */
export const DEATH_BUDGET: Readonly<Record<QualityPreset, { simpleArms: boolean; falling: number; velocitySteps: number; positionSteps: number }>> = {
  low: { simpleArms: true, falling: 1, velocitySteps: 6, positionSteps: 1 },
  medium: { simpleArms: false, falling: 2, velocitySteps: 8, positionSteps: 2 },
  high: { simpleArms: false, falling: 2, velocitySteps: 10, positionSteps: 2 },
  ultra: { simpleArms: false, falling: 2, velocitySteps: 10, positionSteps: 2 },
};

/** How far past the board's edge a body may come to rest: the width of the board's own frame, in squares. */
const ARENA_MARGIN = 0.45;
/** A standing figure is a post this wide, in squares. */
const POST_RADIUS = 0.24;

export interface FallRequest extends RagdollRequest {
  /** Every figure still standing, the killer included. */
  standing: readonly { x: number; z: number }[];
}

export class DeathPhysics {
  /** Holds what physics draws that no figure owns (the pieces of a burst body, severed limbs). */
  readonly root = new THREE.Group();
  readonly ragdolls: RagdollSystem;
  readonly gibs: GibSystem;
  /** Limbs taken off by a killing blow (death/sever). */
  readonly severs: SeverSystem;
  private world: PhysicsWorld | null = null;
  private posts: Obstacle[] = [];
  private quality: QualityPreset;
  private readonly given: JoltModule | null;
  private disposed = false;

  constructor(private readonly options: DeathPhysicsOptions) {
    this.root.name = "death-physics";
    this.quality = options.quality;
    this.given = options.jolt ?? null;
    this.ragdolls = new RagdollSystem(() => this.ensureWorld());
    this.gibs = new GibSystem(() => this.ensureWorld(), this.root, options.quality, options.gore ?? null, { top: options.groundY, tile: options.tile }, options.onLanding ?? null);
    this.severs = new SeverSystem(() => this.ensureWorld(), this.root, options.quality, options.gore ?? null, { top: options.groundY, tile: options.tile }, options.onLanding ?? null, {
      falling: victim => this.ragdolls.falling(victim), burst: victim => this.gibs.owns(victim),
    });
    this.applyBudget();
  }

  /** Starts fetching Jolt, if it is not already here or on its way. */
  preload(): void { if (!this.given && !this.disposed) void loadJolt(); }
  /** Physics can take a death now. */
  get ready(): boolean { return !this.disposed && (this.given ?? joltReady()) !== null; }

  private ensureWorld(): PhysicsWorld | null {
    if (this.world || this.disposed) return this.world;
    const jolt = this.given ?? joltReady();
    if (!jolt) return null;
    const budget = DEATH_BUDGET[this.quality];
    this.world = new PhysicsWorld(jolt, {
      groundY: this.options.groundY, arena: (4 + ARENA_MARGIN) * this.options.tile, maxBodies: 160,
      velocitySteps: budget.velocitySteps, positionSteps: budget.positionSteps,
    });
    this.world.setObstacles(this.posts);
    return this.world;
  }

  /** The figures standing now: posts in the world. */
  setStanding(standing: readonly { x: number; z: number }[]): void {
    this.posts = standing.map(spot => ({ x: spot.x, z: spot.z, radius: POST_RADIUS * this.options.tile }));
    this.world?.setObstacles(this.posts);
  }

  /** Hands a killed figure's fall to a ragdoll. False when physics is not ready: the caller plays today's fall. */
  fall(victim: PieceView, request: FallRequest): boolean {
    // A body that has already burst has nothing left to fall, and must not be given the hand-animated fall either.
    if (this.gibs.owns(victim)) return true;
    if (!this.ready) { this.preload(); return false; }
    this.setStanding(request.standing);
    // A limb that came off has no body in the ragdoll: its bones are folded into the stump.
    const without = this.severs.without(victim);
    return this.ragdolls.begin(victim, without.length ? { ...request, without } : request);
  }

  /**
   * Calls `then` once, with the point on the stone under it, on the frame this figure's ragdoll first brings its trunk
   * (the pelvis or the chest) down on the stone: where and when the body's dust rises. False when no ragdoll has its
   * fall (physics did not take it, or it burst). A fall that ends before its trunk comes down never calls it.
   */
  onTrunkDown(victim: PieceView, then: (at: THREE.Vector3) => void): boolean { return this.ragdolls.onTrunkDown(victim, then); }

  /**
   * Bursts a figure apart at `blast`, a world point; `power` is about 0.4 to 2.
   * Its pieces fly, bounce and settle on the board, with blood at the burst and
   * where they land. False when physics is not ready or the figure cannot be
   * cut: the caller plays the death it would have played. The caller decides
   * whether a death bursts at all (only at the Violence setting Full).
   */
  explode(victim: PieceView, blast: { x: number; y: number; z: number }, power: number, context: ExplodeContext = {}): boolean {
    if (!this.ready) { this.preload(); return false; }
    // A body that had begun to fall as a ragdoll is taken from it: it cannot do both.
    this.ragdolls.release(victim);
    if (context.standing) this.setStanding(context.standing);
    // What a killing blow already took off is not in the burst: its skin is folded into the stump.
    const hidden = this.severs.owns(victim) ? this.severs.hidden(victim) : null;
    return this.gibs.explode(victim, blast, power, hidden ? { ...context, hidden } : context);
  }

  /**
   * Takes a limb off a figure on its killing blow: the head, upper arm, forearm, leg or lower leg whose bone runs
   * nearest `request.point` is cut from the posed skin and thrown along `request.direction` (death/sever). Returns the
   * limb, or null when physics is not ready, the body is already burst or still being thrown about, or nothing can come
   * off: the death goes on whole. The caller decides whether the blow severs at all (death/sever/severPlan.ts).
   */
  sever(victim: PieceView, request: SeverRequest & { standing?: readonly { x: number; z: number }[] }): SeverLimb | null {
    if (!this.ready) { this.preload(); return null; }
    if (this.gibs.owns(victim) || this.ragdolls.falling(victim)) return null;
    if (request.standing) this.setStanding(request.standing);
    return this.severs.sever(victim, request);
  }

  /**
   * True once physics has finished with this figure: its ragdoll lies as it
   * settled, or every piece of its burst has stopped. Also true for a figure
   * physics never took. For whatever comes next (the pool under the body, the
   * exit) to wait on.
   */
  settled(victim: PieceView): boolean { return !this.ragdolls.falling(victim) && !this.gibs.flying(victim) && !this.severs.flying(victim); }

  /** `wanted`: a match is in play and its settings allow a physics death, so Jolt is worth fetching now. */
  update(delta: number, wanted = false): void {
    if (this.disposed) return;
    if (wanted && !this.ready) this.preload();
    this.world?.step(delta);
    this.ragdolls.update(delta);
    this.gibs.update(delta);
    // After the ragdolls have written their bones: a severed limb's are folded away again.
    this.severs.update(delta);
    // Nothing left moving: the world is freed, and the next death builds a new one.
    if (this.world && this.world.count === 0 && !this.ragdolls.busy && !this.gibs.busy && !this.severs.busy) { this.world.dispose(); this.world = null; }
  }

  setQuality(quality: QualityPreset): void { this.quality = quality; this.gibs.setQuality(quality); this.severs.setQuality(quality); this.applyBudget(); }
  private applyBudget(): void { const budget = DEATH_BUDGET[this.quality]; this.ragdolls.setBudget(budget.simpleArms, budget.falling); }

  /** Undo back to `ply` half-moves: every body leaves the world and the pieces of a burst go, with the blood the plies taken back threw. */
  undoTo(ply: number): void {
    this.ragdolls.clear();
    this.gibs.undoTo(ply);
    this.severs.undoTo(ply);
    this.world?.dispose(); this.world = null;
    this.posts = [];
  }

  /** A new game or a rebuilt board: nothing of the old one stays. */
  clear(): void {
    this.undoTo(-1);
    this.gibs.clear();
    this.severs.clear();
  }

  /** For browser checks: what is falling, what lies, and whether a world is alive (it must not be after an Undo). */
  get stats(): RagdollStats & { ready: boolean; world: boolean; bodies: number; gibs: GibStats; severs: SeverStats } {
    return { ...this.ragdolls.stats, ready: this.ready, world: this.world !== null, bodies: this.world?.count ?? 0, gibs: this.gibs.stats, severs: this.severs.stats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.root.removeFromParent();
    this.disposed = true;
  }
}
