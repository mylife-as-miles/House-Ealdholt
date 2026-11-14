import * as THREE from "three";

export type CombatPhase = "approach" | "anticipate" | "strike" | "flight" | "contact" | "fall" | "advance" | "complete" | "cancelled";
export class CombatCancelled extends Error {
  constructor() { super("The combat pair no longer belongs to the active board."); this.name = "CombatCancelled"; }
}

interface Beat {
  remaining: number;
  resolve(): void;
  reject(reason: Error): void;
}

export interface MeleePerformance {
  approachAttacker(): Promise<unknown>;
  faceDefender(): Promise<unknown>;
  faceAttacker(): void;
  wind: number;
  prepare?(): Promise<void>;
  strike(): { duration: number; impact: number; events?: readonly { name: string; time: number }[] } | null;
  exchange?(event: { name: string; time: number }): void;
  swing?(): void;
  fallbackStrike(): Promise<void>;
  contact(): void;
  hold: number;
  recover(fallback: boolean): void;
  fall(): Promise<void>;
  advance(): Promise<void>;
}

/** Authored combat staging, including en passant's separate victim square.
 * Inputs stay untouched; only the attacker's temporary approach point moves. */
export function stageCombatPair(from: THREE.Vector3, victim: THREE.Vector3, destination: THREE.Vector3, reach: number) {
  const direction = victim.clone().sub(from).setY(0);
  if (direction.lengthSq() < 1e-6) direction.copy(destination).sub(from).setY(0);
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  const distance = from.distanceTo(victim);
  direction.normalize();
  const gap = Math.min(Math.max(0, reach), distance * .98);
  const standoff = victim.clone().addScaledVector(direction, -gap);
  standoff.y = from.y;
  return { standoff, direction, focus: standoff.clone().lerp(victim, .5) };
}

/** One paired performance, timed by exactly the delta used by both mixers.
 * No wall timers: pausing/stalling rendering cannot skip the strike or fall. */
export class CombatSession {
  phase: CombatPhase = "approach";
  private beats = new Set<Beat>();
  private closed = false;
  private elapsed = 0;
  private cancelled: Promise<void>;
  private notifyCancelled!: () => void;

  constructor(private readonly valid: () => boolean, private readonly release: () => void) {
    this.cancelled = new Promise(resolve => { this.notifyCancelled = resolve; });
  }

  /** Seconds of animation delta this pair has been given: the fight's own clock. */
  get elapsedSeconds(): number { return this.elapsed; }

  private check(): void {
    if (this.closed || !this.valid()) throw new CombatCancelled();
  }

  async stage<T>(phase: CombatPhase, perform: () => T | Promise<T>): Promise<T> {
    this.check(); this.phase = phase;
    const result = await Promise.race([
      Promise.resolve().then(() => { this.check(); return perform(); }),
      this.cancelled.then(() => { throw new CombatCancelled(); }),
    ]);
    this.check();
    return result;
  }

  wait(seconds: number): Promise<void> {
    this.check();
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid combat beat duration");
    if (seconds === 0) return Promise.resolve();
    return new Promise((resolve, reject) => { this.beats.add({ remaining: seconds, resolve, reject }); });
  }

  update(delta: number): void {
    if (this.closed) return;
    if (!this.valid()) { this.cancel(); return; }
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.elapsed += delta;
    for (const beat of this.beats) {
      beat.remaining -= delta;
      if (beat.remaining <= 1e-8) { this.beats.delete(beat); beat.resolve(); }
    }
  }

  async melee(performance: MeleePerformance): Promise<void> {
    await this.stage("approach", () => Promise.all([performance.approachAttacker(), performance.faceDefender()]));
    await this.stage("anticipate", async () => {
      performance.faceAttacker();
      await this.wait(performance.wind);
      if (performance.prepare) await performance.prepare();
    });
    let strike: ReturnType<MeleePerformance["strike"]> = null;
    await this.stage("strike", async () => {
      strike = performance.strike();
      if (strike && strike.duration > 0) {
        const started = this.elapsed;
        const lead = Math.min(.18, Math.max(0, strike.impact));
        const cues = (strike.events ?? []).filter(event => (event.name === "clash" || event.name === "feint") && event.time < strike!.impact)
          .map(event => ({ ...event }));
        cues.push({ name: "swing", time: Math.max(0, strike.impact - lead) });
        cues.sort((a, b) => a.time - b.time);
        for (const cue of cues) {
          await this.wait(Math.max(0, started + cue.time - this.elapsed));
          if (cue.name === "swing") performance.swing?.(); else performance.exchange?.(cue);
        }
        // An absolute contact marker avoids accumulating a frame of rounding
        // at each preceding cue (e.g. .22 + .18 on a 50 ms frame budget).
        await this.wait(Math.max(0, started + strike.impact - this.elapsed));
      } else {
        performance.swing?.();
        await performance.fallbackStrike();
      }
    });
    await this.stage("contact", async () => { performance.contact(); await this.wait(performance.hold); });
    await this.stage("fall", async () => {
      performance.recover(!strike || strike.duration <= 0);
      const recovery = strike ? Math.min(.45, Math.max(0, strike.duration - strike.impact)) : .18;
      await Promise.all([performance.fall(), this.wait(recovery)]);
    });
    await this.stage("advance", () => performance.advance());
    this.check(); this.phase = "complete";
  }

  cancel(): void {
    if (this.closed) return;
    this.phase = "cancelled";
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const beat of this.beats) beat.reject(new CombatCancelled());
    this.beats.clear(); this.notifyCancelled(); this.release();
  }
}

/** Reserves both actors until the performance ends or the board is replaced. */
export class PairedCombatDirector {
  private readonly actors = new Map<object, CombatSession>();
  private readonly sessions = new Set<CombatSession>();

  begin(attacker: object, defender: object, valid: () => boolean): CombatSession {
    if (attacker === defender || this.actors.has(attacker) || this.actors.has(defender)) throw new Error("Combat actor already reserved");
    const session = new CombatSession(valid, () => {
      this.actors.delete(attacker); this.actors.delete(defender); this.sessions.delete(session);
    });
    this.actors.set(attacker, session); this.actors.set(defender, session); this.sessions.add(session);
    return session;
  }

  update(delta: number): void { for (const session of this.sessions) session.update(delta); }
  cancelAll(): void { for (const session of this.sessions) session.cancel(); }
  get activePairs(): number { return this.sessions.size; }
}
