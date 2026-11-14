/**
 * The gore lifecycle: which impact left what, keyed by ply and impact id, and
 * when each part of a plan appears on the fight clock.
 *
 * Pure: it plans through the Gore Director and speaks to a {@link GoreSink}
 * (GoreSystem in the scene, a recorder in tests). The clock is the one it is
 * fed through `update(delta)`, the same frame delta that drives both
 * skeletons and the pair's CombatSession, so blood can never run ahead of or
 * behind the blow that drew it.
 *
 *   begin(event)     plan the impact and schedule spray, wound (and its runs of blood) and stains
 *   land(impactId)   the body is down (the moment of the gore sound): the pool starts
 *   bodyGone(id)     the body was banished: a wound decal goes with it (a wound mask stays on the figure
 *                    until it has gone, its runs still painted), the blood stays
 *   undoTo(ply)      remove everything left by later plies
 *   reset()          a new game: nothing remains
 */
import { planGore } from "./GoreDirector";
import type { GoreEvent, GorePlan, PoolPlan, SplashPlan, SprayPlan, StainPlan, WeaponStainPlan, WoundPlan } from "./GoreTypes";

export interface GoreSink {
  spray(plan: GorePlan, spray: SprayPlan): void;
  stain(plan: GorePlan, stain: StainPlan): void;
  wound(plan: GorePlan, wound: WoundPlan): void;
  /** A run of blood from the wound, painted into the figure's mask down the body as it hangs then (`wound.mask.runs[index]`). */
  woundRun?(plan: GorePlan, wound: WoundPlan, index: number): void;
  weaponStain(plan: GorePlan, stain: WeaponStainPlan): void;
  /** A decal on the weapon or the attacker. Released with the weapon stain (`releaseWeapon`). */
  splash(plan: GorePlan, splash: SplashPlan): void;
  /** `at` is the pool's centre: the planned one, or the body's real resting point. */
  pool(plan: GorePlan, pool: PoolPlan, at: { x: number; z: number }): void;
  /** The body left the board: remove what was attached to it. */
  releaseBody(impactId: string): void;
  releaseWeapon(impactId: string): void;
  /** Remove everything this impact left, at once. */
  remove(impactId: string): void;
  clear(): void;
}

/** `body`: the step belongs to the body (its wound, not yet opened) and goes when the body does. */
type Step = { at: number; run: () => void; body?: boolean };
interface Entry { plan: GorePlan; clock: number; queue: Step[]; landed: boolean; bodyGone: boolean }

export class GoreLedger {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly sink: GoreSink, private readonly planner: (event: GoreEvent) => GorePlan = planGore) {}

  /** Plans in the order they were begun. */
  get plans(): readonly GorePlan[] { return [...this.entries.values()].map(entry => entry.plan); }
  has(impactId: string): boolean { return this.entries.has(impactId); }
  /** Something is still waiting on the clock. */
  get pending(): boolean {
    for (const entry of this.entries.values()) if (entry.queue.length) return true;
    return false;
  }

  begin(event: GoreEvent): GorePlan {
    const plan = this.planner(event);
    if (this.disposed) return plan;
    // Playing ply N means nothing from N or later can still be on the board
    // (Undo then the same capture, or a replay stepping back); an impact that
    // follows others in the same move keeps theirs (a summon's many wounds).
    this.undoTo(event.follows ? event.ply : event.ply - 1);
    this.drop(event.impactId);
    if (plan.silent) return plan;
    const entry: Entry = { plan, clock: 0, queue: [], landed: false, bodyGone: false };
    this.entries.set(plan.impactId, entry);
    const sink = this.sink;
    if (plan.wound) {
      const wound = plan.wound;
      entry.queue.push({ at: 0, run: () => { if (!entry.bodyGone) sink.wound(plan, wound); }, body: true });
      // Its blood runs down the body while it bleeds, each run painted where gravity takes it on that frame. The runs
      // are the mask's, and the mask stays on the body through the banishing until the figure has gone: they go on
      // (a figure with no mask by then simply takes none).
      wound.mask?.runs.forEach((run, index) => entry.queue.push({ at: run.at, run: () => sink.woundRun?.(plan, wound, index) }));
    }
    // Decals first: the weapon's plain smear is only the fallback when no decal could be laid on it.
    for (const splash of plan.splashes) entry.queue.push({ at: splash.at, run: () => sink.splash(plan, splash) });
    if (plan.weaponStain) {
      const stain = plan.weaponStain;
      entry.queue.push({ at: 0, run: () => sink.weaponStain(plan, stain) });
      if (stain.linger !== null) entry.queue.push({ at: stain.linger, run: () => sink.releaseWeapon(plan.impactId) });
    }
    for (const spray of plan.sprays) entry.queue.push({ at: spray.delay, run: () => sink.spray(plan, spray) });
    for (const stain of plan.stains) entry.queue.push({ at: stain.at, run: () => sink.stain(plan, stain) });
    entry.queue.sort((a, b) => a.at - b.at);
    this.flush(entry);
    return plan;
  }

  /** The body has landed. `at` overrides the planned centre with where it really lies. */
  land(impactId: string, at?: { x: number; z: number }): void {
    const entry = this.entries.get(impactId);
    if (!entry || entry.landed || !entry.plan.pool) return;
    entry.landed = true;
    const plan = entry.plan, pool = entry.plan.pool;
    const centre = at ? { x: at.x, z: at.z } : { x: pool.x, z: pool.z };
    entry.queue.push({ at: entry.clock + pool.delay, run: () => this.sink.pool(plan, pool, centre) });
    entry.queue.sort((a, b) => a.at - b.at);
    this.flush(entry);
  }

  /** Banish: the wound leaves with the body. Stains and pool remain until Undo or reset. */
  bodyGone(impactId: string): void {
    const entry = this.entries.get(impactId);
    if (!entry || entry.bodyGone) return;
    entry.bodyGone = true;
    // A wound not yet opened on it never will be.
    entry.queue = entry.queue.filter(step => !step.body);
    this.sink.releaseBody(impactId);
  }

  update(delta: number): void {
    if (!(delta > 0)) return;
    for (const entry of this.entries.values()) {
      if (!entry.queue.length) continue;
      entry.clock += delta;
      this.flush(entry);
    }
  }

  /** Keeps what plies 1..ply left; removes everything later. Returns the impacts removed. */
  undoTo(ply: number): string[] {
    const removed: string[] = [];
    for (const [id, entry] of this.entries) if (entry.plan.ply > ply) removed.push(id);
    for (const id of removed) this.drop(id);
    return removed;
  }

  /** A fight that was cut short: whatever its impact left goes with it. */
  cancel(impactId: string): void { this.drop(impactId); }

  reset(): void {
    this.entries.clear();
    this.sink.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
  }

  private drop(impactId: string): void {
    if (!this.entries.delete(impactId)) return;
    this.sink.remove(impactId);
  }

  private flush(entry: Entry): void {
    while (entry.queue.length && entry.queue[0].at <= entry.clock + 1e-9) entry.queue.shift()!.run();
  }
}
