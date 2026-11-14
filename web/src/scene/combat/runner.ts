/**
 * The timeline runner: plays a resolved {@link CombatPlan} through a
 * {@link CombatStage}. It knows nothing of three.js, PieceView or the engine,
 * so it runs in node tests on a fake stage with a fake clock.
 *
 * The runner only ever waits on the stage clock. Clips, moves, poses, camera
 * and effects are started at their moment and left to the stage; a stalled
 * frame therefore delays the whole fight together and can never let a sound
 * or a death run ahead of the skeletons (the pairedCombat.ts rule).
 *
 * Guarantees, whatever the data or the stage does:
 *  - a capture ends with `decisive`, `fall`, `settle` and `finish` called, in
 *    that order, exactly once each (unless cancelled: then only `finish`);
 *  - the killing strike sounds at most once;
 *  - cancellation (undo, reset, board rebuilt) is honoured between beats and
 *    fires nothing further;
 *  - skip jumps to the wind-up of the killing blow and plays the resolution;
 *  - the fight is over by `plan.cap` seconds on the stage clock.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATION PLAN (sceneEngine.ts / gameController.ts; nothing here edits them)
 * ---------------------------------------------------------------------------
 * Wired for Pawn takes Pawn: pawnDuel.ts (what the controller commits),
 * engineStage.ts + pieceFigure.ts (the stage) and
 * SceneEngine.playDirectedCombat (the host). Two things differ from the plan
 * below. The cast comes from the match's armies (`setCombatArmies`), not a
 * `setCombatCast` callback. And `fall` / `settle` only start the ending: an
 * authored death (1.7 to 2.2 s) does not fit the fall-to-settle window, so the
 * stage lets it play out and the engine awaits `stage.aftermath()` after the
 * runner returns, before the move is settled on the board.
 * Every other capture still runs the notes' "today" path, untouched.
 *
 * 1. Choose where the move is committed. `GameController.commit()` calls
 *    `selectCombatSequence(...)` today. Replace that call with
 *      const plan = capture ? directCombat({ attacker, defender, geometry:
 *        { from: move.from, to: move.to, victim: capture.square },
 *        context: { check: inCheck, history: this.combatMemory, speed },
 *        seed: combatSeed(this.chess.history()) }) : undefined;
 *    and keep its three follow-ups, now fed by the plan:
 *      - comment: `this.chess.setComment(withCombatRecord(previous, plan.record))`
 *        (record.ts; for Pawn-vs-Pawn this is the very same `[%cfcombat 1 ...]`);
 *      - `MoveEvent.choreography = plan.choreography` (unchanged type), plus a
 *        new optional `MoveEvent.combat?: CombatDirection`;
 *      - `this.combatMemory = rememberCombat(this.combatMemory, input, plan)`,
 *        truncated in `undo()` and cleared in `start()`.
 *    The controller does not know armies or props, so it needs one new setter,
 *    `setCombatCast((side, kind, square) => Pick<Combatant, "kingdom" | "shield"
 *    | "style" | "armed" | "identity" | "clips">)`, fed by the scene from
 *    `PieceFactory.getSkins()`, `ARMY_SKINS[...].arsenal`, `attackStyle(...)`
 *    and the clip names the rig holds. With no `clips` the class catalogs that
 *    require authored clips answer "fallback", which is the safe default.
 *    Checkmate is not directed here: `playEndCinematic` hands it to Codex's
 *    CheckmatePresentation and the king's pose comes from the "checkmate"
 *    BoardReactionEvent. A kneeling or yielding king would be a future variant
 *    inside that tableau (a pose choice on the checkmate reaction), not a
 *    combat sequence.
 *
 * 2. Hook in `SceneEngine.runMove`, inside the existing
 *    `const pair = this.combatDirector.begin(piece, victim, ...)` try-block,
 *    before the style switch:
 *      const plan = event.combat;
 *      if (plan?.kind === "sequence") {
 *        this.combatControl = new CombatControl();
 *        const outcome = await runCombat(plan, new EngineCombatStage(this, piece,
 *          victim, pair, from, to, strikeSquare, plan), this.combatControl);
 *        if (outcome.status !== "fallback") handled = true;
 *      }
 *      if (!handled) { ...today's playSpellCinematic / playGunCinematic /
 *        playCaptureCinematic, unchanged... }
 *    The existing `catch` (crumble the victim if it is not slain) and
 *    `finally` (clearCombatTargets, pair.close) stay as they are: the runner
 *    rethrows a stage error after calling `finish("failed")`.
 *    Undo/reset: `rebuildPieces()` already bumps `boardRevision`, which makes
 *    the session's `valid()` false, so the pending `pair.wait` rejects with
 *    CombatCancelled and the runner returns "cancelled". Also call
 *    `this.combatControl?.cancel()` there so it stops within the same frame.
 *    Skip: call `this.combatControl?.skip()` from the input that skips the
 *    intro today (`skipIntro` and its key/tap handler).
 *
 * 3. `EngineCombatStage implements CombatStage` (new file, about 200 lines):
 *    clock      the CombatSession that the engine's existing
 *               PairedCombatDirector returned from `begin(attacker, defender,
 *               valid)`. wait: `session.wait(seconds)`, driven by the frame
 *               delta of `combatDirector.update`, no wall timers. now: the
 *               delta accumulated by that same session (its `elapsed` is
 *               private today; a public getter is all that is missing, and
 *               until then the adapter sums the delta it passes to update).
 *               When the board is replaced the session rejects the pending
 *               wait with CombatCancelled: the runner ends with status
 *               "cancelled" and calls `finish("cancelled")` exactly once.
 *    phase      `pair.phase = phase` (CombatSession.phase is public).
 *    actor.clip    authored ids: `PieceView.hasCombatVariant(id)`, with duration and
 *               markers from the variant metadata (`contact` also exposed as
 *               `impact`). Generic roles: attack/death/idle/walk/run are
 *               `hasClip(name)`, with `impact` from `retimedCombatEvent` or
 *               today's 42% / 56% estimate. block/hit/stagger have no generic
 *               clip. PieceView needs one small accessor for this:
 *               `combatClipInfo(id): { duration, markers } | null`.
 *    actor.play    variants: `playReaction(id)` generalised with a rate
 *               (`playVariant(id, rate)` is private today: make it public or
 *               add `playCombatClip(id, rate, fade)`). Generic attack:
 *               `playAttack({ seconds: duration / rate })`.
 *    actor.pose    brace: `braceForImpact(point)`; block: brace plus
 *               `contactIK.setGuardTarget(point)`; recoil / stagger:
 *               `livingRig.impact(direction, strength)` via `takeHit`-less
 *               access (add `PieceView.flinch(direction, strength)` so the
 *               hit flash and hit clip of `takeHit` are not triggered).
 *    actor.move    `this.glide(piece, here, point, leap, cadence)` for walk / run /
 *               leap, a plain position tween for `step`. Points:
 *               reference + (file, -rank) * TILE, where the references are
 *               `squareToWorld(from)`, the victim's position, `to`, and
 *               `stageCombatPair(from, victimSpot, to, reach).standoff`.
 *    actor.face    `faceTowards` (duration 0) or `turnTowards(point, tweens, d)`.
 *    actor.anchor  weaponTip `weaponContact`, shieldFace `shieldContact`,
 *               torso `combatPoint`, ground the container position.
 *    contact    aim: `contactIK.setWeaponTarget` / `setGuardTarget` on the two
 *               figures (`configureCombat` already points them at each other);
 *               release: `clearTargets()`.
 *    camera     `focusPoint(point, tightness)` per framing and an FOV tween of
 *               `lensPunch(-fov)`; `finish` restores `lensFov`.
 *    effect     sparks/flash/slash/dust/ring: `effects.spawnBurst`, `spawnFlash`,
 *               `spawnSlash`, `strikeImpact`; shake: `shake.add`; hitstop:
 *               `holdContact`. projectile/restraint/mist/rite are not
 *               implemented: leave them out of `context.stage` and the
 *               director never selects a sequence that needs them.
 *    audio      one `CombatAudioLayer` (audio.ts) per fight over a bank that
 *               maps `kill` to `livePlea?.cut()` + `audio.strike(kind, { flesh })`.
 *    decisive   `meleeContact(...)` WITHOUT its own `audio.strike` (the layer
 *               has just played it): split the sound out of meleeContact, or
 *               pass a flag. `victim.configureCombat(piece, choreography, true)`
 *               makes `takeHit` / `playDeath` use resolution.hit / .death.
 *    fall       `this.slay(victim, blow, true, pair)`; its `audio.bodyFall`
 *               duplicates the `fall.*` cue once the sound agent ships it, so
 *               give slay a `silentFall` flag then. `seconds` is the time to
 *               `settle`: use it to rate the death clip.
 *    settle     `Promise.all([this.banish(victim, blow), this.glide(attacker,
 *               here, to, false, 1.5)])`, then `resolution.claim.clip`.
 *    witnesses  none of ours. `meleeContact` already calls the engine's
 *               `reactToImpact(victimSpot, power, victim, attacker)`, which
 *               goes through dispatchBoardReaction to Codex's
 *               BoardReactionDirector (line of sight, quality budget,
 *               personalities, cooldowns; both fighters are `primary` and are
 *               left alone). The adapter's `decisive` must pass `plan.power`
 *               as that power, once. An upset is expressed only there: the
 *               director multiplies the power by 1.15 from a value gap of 4
 *               and by 1.35 from a gap of 8 (a Pawn felling a Queen).
 *    finish     `clearCombatTargets()` on both, restore FOV and strike tilt.
 *               On "cancelled" touch nothing on the board: it has been rebuilt.
 */
import {
  MARKERS, MARKER_PHASE,
  type ActorAction, type Actor, type Anchor, type AudioCue, type BoardPoint, type CameraAction, type ClipRequest, type ClipRole,
  type ContactAction, type EffectAction, type Gait, type Locus, type Marker, type Planned, type Pose, type Resolution,
} from "./choreography";
import type { CombatPlan } from "./director";
import { windupTiming } from "./feel";

export interface Vec3 { x: number; y: number; z: number }
/** A clip the rig holds. `events` are seconds into the clip at rate 1. */
export interface ClipInfo { id: string; duration: number; events: Readonly<Record<string, number>> }

export interface CombatActor {
  /** The best clip for a role: the first held `prefer` id, else the rig's
   * generic clip for the role, else null. Never plays anything. */
  clip(role: ClipRole, prefer: readonly string[]): ClipInfo | null;
  /** `from`: seconds into the clip to join it at (a skip lands on the blow, not on its wind-up). */
  play(clip: ClipInfo, options: { rate: number; fade: number; from?: number }): void;
  /**
   * Changes the speed of the clip now playing, easing over `ease` seconds.
   * With `land`, the stage sets the speed itself from where the clip really
   * is, so that it reaches `clipTime` in `seconds` (kept within `slack` of
   * `rate`): the blow lands on its marker whatever the frame rate did to the
   * steps before it. Optional: a stage without it plays one-clip double blows
   * straight through.
   */
  rate?(rate: number, ease: number, land?: { clipTime: number; seconds: number; slack: number }): void;
  pose(pose: Pose, options: { strength: number; hold: number; toward: Locus<BoardPoint> | null; drive: "ik" | "bones" | "auto" }): void;
  /** `duration` 0 places the figure there at once (skip). */
  move(to: BoardPoint, options: { duration: number; gait: Gait; arc: number }): void;
  face(toward: Locus<BoardPoint>, duration: number): void;
  /** World position of an anchor right now, or null if the rig has none. */
  anchor(name: Anchor): Vec3 | null;
}

export type FinishStatus = "completed" | "skipped" | "capped" | "cancelled" | "failed";

export interface CombatStage {
  /** The scene's animation clock. `wait` may reject when the fight is cancelled. */
  readonly clock: { now(): number; wait(seconds: number): Promise<void> };
  readonly attacker: CombatActor;
  readonly defender: CombatActor;
  /**
   * The combat feel layer's terms (feel.ts), read once when the fight starts.
   * `worldHitstop`: a `hitstop` cue holds the whole board, this clock
   * included, so no clip has time to make up for it. `windup`: the killing
   * blow is wound up slower and thrown faster, its contact frame unmoved.
   */
  readonly feel?: { worldHitstop: boolean; windup: boolean };
  begin?(plan: CombatPlan): void;
  phase?(phase: typeof MARKER_PHASE[Marker], marker: Marker): void;
  camera(cue: CameraAction): void;
  effect(cue: EffectAction<BoardPoint>, seed: number): void;
  audio(cue: AudioCue, options: { volume: number; from: Actor | null }): void;
  /** aim: start steering the IK towards the contact; release: let go. */
  contact(cue: ContactAction, state: "aim" | "release"): void;
  /** Observational socket sample at the existing authored marker. Skip omits
   * skipped decoration; cancellation never emits deferred contact samples. */
  sampleContact?(cue: ContactAction, sampled: { from: Vec3 | null; to: Vec3 | null }): void;
  /** The killing blow lands: impact, hit reaction, board shock. No strike sound
   * (the runner has just asked for `decisive` through `audio`). Witnesses are
   * the engine's business: route them through its existing `reactToImpact`
   * (Codex's BoardReactionDirector) with `plan.power`, here and only here. */
  decisive(resolution: Resolution, plan: CombatPlan): void;
  /** The defender dies. `seconds` is what the plan allows before `settle` (0: at once). */
  fall(resolution: Resolution, seconds: number): Promise<void> | void;
  /** The body is cleared and the attacker takes the square. */
  settle(resolution: Resolution, seconds: number): Promise<void> | void;
  /** The player asked to get on with it after the killing blow was under way: play what is left fast. */
  hurry?(): void;
  /** Always the last call: snap both figures, camera and IK to the final state. */
  finish(status: FinishStatus): void;
}

/** Undo, reset and skip reach a running fight through this. */
export class CombatControl {
  private cancelRequested = false;
  private skipRequested = false;
  private presses = 0;
  /** How many times skip was asked for: the first lands on the killing blow, a later one hurries what is left. */
  get skips(): number { return this.presses; }
  private waiters: (() => void)[] = [];
  get cancelled(): boolean { return this.cancelRequested; }
  get skipping(): boolean { return this.skipRequested; }
  cancel(): void { this.cancelRequested = true; this.notify(); }
  skip(): void { this.skipRequested = true; this.presses += 1; this.notify(); }
  /** Resolves at the next cancel() or skip(). */
  wake(): Promise<void> { return new Promise(resolve => { this.waiters.push(resolve); }); }
  private notify(): void { const waiters = this.waiters; this.waiters = []; for (const wake of waiters) wake(); }
}

export interface CombatOutcome {
  status: FinishStatus | "fallback";
  /** Why nothing was played (status "fallback"). The stage was not touched. */
  reason?: string;
  /** Stage-clock seconds from begin to finish. */
  elapsed: number;
  killed: boolean;
  /** Distance between the two anchors at each contact moment (null: no anchors). */
  contacts: { id: string; error: number | null }[];
  /** Every clip the runner started and the speed it gave it, as a multiple of the clip's natural speed. */
  rates?: { actor: Actor; clip: string; at: number; rate: number }[];
}

/** The killing strike is the loudest hit of a fight: its level before the mixer, and its ceiling. */
export const KILL_VOLUME = { gain: 1.6, max: 1.6 } as const;

/** Clip retiming never leaves this range (at speed 1): past it a clip reads as broken. */
export const CLIP_RATE = { min: 0.5, max: 2.5 } as const;
/** Skip lands this long before the killing blow, whenever it is asked for: the blow is seen to arrive. */
export const SKIP_LEAD = 0.15;
/** A clip's rate change is eased over this long, so a held beat is breathed into, not switched on. */
export const RATE_EASE = 0.1;
/** The held beat between two blows of one clip crawls at this share of natural speed unless the cue says otherwise. */
const CRAWL = 0.12;
/** A synced clip's speed is trimmed once, this long before its event is due, from where the clip really is. */
const TRIM_LEAD = 0.26;
/** The longest a hitstop holds a rig (LivingPieceRig.hold). */
const HITSTOP_MAX = 0.14;
const EPSILON = 1e-6;

type Resolved = { clip: ClipInfo } | { pose: Pose; strength: number } | null | "missing";

function resolveClip(actor: CombatActor, request: ClipRequest): Resolved {
  const first = actor.clip(request.role, request.prefer ?? []);
  if (first) return { clip: first };
  for (const fallback of request.fallbacks ?? []) {
    if ("pose" in fallback) return { pose: fallback.pose, strength: fallback.strength ?? 0.8 };
    const clip = actor.clip(fallback.role, fallback.prefer ?? []);
    if (clip) return { clip };
  }
  return request.required ? "missing" : null;
}

/** When to start a clip, and how fast, so its authored event lands on `target`. */
export function retime(clip: ClipInfo, events: readonly string[], start: number, target: number, timeScale: number, held: (from: number, to: number) => number = () => 0): { start: number; rate: number } {
  const base = 1 / timeScale;
  const name = events.find(event => clip.events[event] !== undefined);
  if (name === undefined) return { start, rate: base };
  const event = clip.events[name];
  if (event <= EPSILON) return { start: target, rate: base };
  // A hitstop on the way freezes the rig, not the fight's clock: that time is not the clip's to use.
  const window = target - start - held(start, target);
  if (held(start, target) > 0 && window > EPSILON) {
    const rate = Math.min(CLIP_RATE.max * base, Math.max(CLIP_RATE.min * base, event / window));
    let begin = target - event / rate;
    begin -= held(begin, target);
    if (begin >= 0) return { start: begin, rate };
  }
  const rate = Math.min(CLIP_RATE.max * base, Math.max(CLIP_RATE.min * base, window > EPSILON ? event / window : Infinity));
  const begin = target - event / rate;
  // No room before the marker: start now and let the rate exceed the comfort range.
  return begin < 0 ? { start: 0, rate: event / Math.max(target, EPSILON) } : { start: begin, rate };
}

export interface TwoBlowTiming { start: number; rate: number; holdAt: number; crawl: number; resume: number; resumeRate: number }

/**
 * One clip, two blows (see `via` in choreography.ts): the first event lands on
 * `via.to`, the clip crawls through a held beat, then is paced so the second
 * event lands on `target`. Rate changes are eased over {@link RATE_EASE}; the
 * clip time the eases use up is accounted for, so the second blow is not late.
 */
export function retimeTwoBlows(
  clip: ClipInfo, events: readonly string[], via: { event: string; to: number; follow?: number; resume: number; crawl?: number },
  start: number, target: number, timeScale: number, held: (from: number, to: number) => number = () => 0,
): TwoBlowTiming | null {
  const base = 1 / timeScale, name = events.find(event => clip.events[event] !== undefined);
  const first = clip.events[via.event], second = name === undefined ? undefined : clip.events[name];
  if (first === undefined || second === undefined || second <= first) return null;
  const opening = retime(clip, [via.event], start, via.to, timeScale, held);
  const ease = RATE_EASE * timeScale, crawl = (via.crawl ?? CRAWL) * base;
  const follow = Math.min(Math.max(0, via.follow ?? 0), (second - first) * 0.5);
  // The clip runs on past the first blow; a hitstop on that blow holds it where it is for a moment first.
  const holdAt = via.to + follow / opening.rate + held(via.to - EPSILON, via.to + follow / opening.rate + HITSTOP_MAX);
  const resume = Math.max(via.resume, holdAt + ease);
  const run = target - resume - ease - held(resume, target);
  const spent = follow + (opening.rate + crawl) / 2 * ease + crawl * (resume - holdAt - ease) + crawl * ease / 2;
  const left = second - first - spent;
  if (run + ease / 2 <= EPSILON || left <= EPSILON) return null;
  const resumeRate = Math.min(CLIP_RATE.max * base, Math.max(CLIP_RATE.min * base, left / (run + ease / 2)));
  return { start: opening.start, rate: opening.rate, holdAt, crawl, resume, resumeRate };
}

interface Step {
  time: number;
  /** State steps still run, instantly, when the timeline is skipped past them. */
  state: boolean;
  fire(instant: boolean): void;
}

const CANCELLED = Symbol("cancelled");

export async function runCombat(plan: CombatPlan, stage: CombatStage, control: CombatControl = new CombatControl()): Promise<CombatOutcome> {
  const outcome: CombatOutcome = { status: "completed", elapsed: 0, killed: false, contacts: [] };
  const resolution = plan.resolution;

  // ---- prepare: resolve every clip against the real rigs before touching anything
  const steps: Step[] = [];
  const add = (time: number, state: boolean, fire: Step["fire"]) => { steps.push({ time: Math.max(0, time), state, fire }); };
  const decisiveAt = plan.markers.decisive;
  const clock = stage.clock;
  let began = 0, origin = 0;
  const position = () => clock.now() - origin;
  const feel = stage.feel;
  // A hitstop that holds the whole board holds this clock too: no clip loses time to it, so none is sped up for it.
  const hitstops = feel?.worldHitstop ? [] : plan.effects.filter(cue => cue.fx === "hitstop").map(cue => ({ at: cue.at, seconds: Math.min(HITSTOP_MAX, Math.max(0, cue.strength ?? 1)) }));
  const held = (from: number, to: number) => hitstops.reduce((sum, stop) => sum + (stop.at > from + EPSILON && stop.at < to - EPSILON ? stop.seconds : 0), 0);
  /** The attack that carries the killing blow: where a skip joins it. */
  let finisher: { clip: ClipInfo; rate: number; event: number; fade: number } | null = null;
  const applied: CombatOutcome["rates"] = [];
  /** Every clip the defender is given, in order: a skip lands him in the one he would be in, as far into it as he would be. */
  const guards: { start: number; clip: ClipInfo; rate: number }[] = [];
  for (const role of ["attacker", "defender"] as const) {
    const actor = stage[role];
    for (const cue of plan[role] as Planned<ActorAction<BoardPoint, number>>[]) {
      if (cue.do === "clip") {
        const resolved = resolveClip(actor, cue.clip);
        if (resolved === "missing") return { ...outcome, status: "fallback", reason: `${role} has no ${cue.clip.role} clip` };
        if (!resolved) continue;
        if ("pose" in resolved) {
          add(cue.at, false, () => actor.pose(resolved.pose, { strength: resolved.strength, hold: 0.3 * plan.timeScale, toward: null, drive: "auto" }));
          continue;
        }
        const fade = cue.fade ?? 0.08 * plan.timeScale, natural = (value: number) => Math.round(value * plan.timeScale * 1000) / 1000;
        const two = cue.sync && cue.via && actor.rate ? retimeTwoBlows(resolved.clip, cue.sync.events, cue.via, cue.at, cue.sync.to, plan.timeScale, held) : null;
        const timing = two ?? (cue.sync ? retime(resolved.clip, cue.sync.events, cue.at, cue.sync.to, plan.timeScale, held) : { start: cue.at, rate: 1 / plan.timeScale });
        const rate = timing.rate * (cue.rate ?? 1);
        const event = cue.sync?.events.map(name => resolved.clip.events[name]).find(time => time !== undefined);
        const landing = (to: number, planned: number, slack: number) => event === undefined ? undefined : { clipTime: event, seconds: Math.max(1e-3, to - position() - held(position(), to)), slack: planned * slack };
        // The last attack launched before the kill carries the killing blow.
        const killing = role === "attacker" && cue.clip.role === "attack" && timing.start < decisiveAt && event !== undefined && !!cue.sync && Math.abs(cue.sync.to - decisiveAt) < 0.12 * plan.timeScale;
        // Anticipation (feel.ts): that blow is wound up slower and thrown faster, its contact frame where the plan put it.
        const windup = feel?.windup && killing && !two && actor.rate && event !== undefined ? windupTiming(resolved.clip, event, timing.start, rate) : null;
        const opening = windup ? windup.slowRate : rate;
        add(timing.start, false, () => actor.play(resolved.clip, { rate: opening, fade }));
        if (role === "defender") guards.push({ start: timing.start, clip: resolved.clip, rate });
        applied.push({ actor: role, clip: resolved.clip.id, at: timing.start, rate: natural(opening) });
        if (windup) {
          add(windup.driveAt, false, () => actor.rate?.(windup.driveRate, RATE_EASE * plan.timeScale * 0.5, landing(cue.sync!.to, windup.driveRate, 0.3)));
          applied.push({ actor: role, clip: `${resolved.clip.id} (thrust)`, at: windup.driveAt, rate: natural(windup.driveRate) });
        }
        if (two) {
          add(two.holdAt, false, () => actor.rate?.(two.crawl, RATE_EASE * plan.timeScale));
          add(two.resume, false, () => actor.rate?.(two.resumeRate, RATE_EASE * plan.timeScale, landing(cue.sync!.to, two.resumeRate, 0.3)));
          applied.push({ actor: role, clip: `${resolved.clip.id} (second blow)`, at: two.resume, rate: natural(two.resumeRate) });
        }
        const planned = two ? two.resumeRate : windup ? windup.driveRate : rate;
        // A last trim on the way in: the steps before it fired on whole frames, and a blow a frame late is a miss.
        // After a wound-up blow's thrust has begun only: before it, the thrust's own step carries the landing.
        if (cue.sync && event !== undefined && actor.rate && cue.sync.to - timing.start > TRIM_LEAD * plan.timeScale * 2
          && (!windup || cue.sync.to - TRIM_LEAD * plan.timeScale > windup.driveAt + EPSILON)) {
          const to = cue.sync.to;
          add(to - TRIM_LEAD * plan.timeScale, false, () => actor.rate?.(planned, 0, landing(to, planned, 0.2)));
        }
        if (killing && event !== undefined) finisher = { clip: resolved.clip, rate: planned, event, fade };
      } else if (cue.do === "pose") {
        add(cue.at, false, () => actor.pose(cue.pose, { strength: cue.strength ?? 1, hold: cue.hold ?? 0.25 * plan.timeScale, toward: cue.toward ?? null, drive: cue.drive ?? "auto" }));
      } else if (cue.do === "move") {
        add(cue.at, true, instant => actor.move(cue.to, { duration: instant ? 0 : cue.duration, gait: cue.gait, arc: cue.arc ?? 0 }));
      } else {
        add(cue.at, true, instant => actor.face(cue.toward, instant ? 0 : cue.duration ?? 0.2 * plan.timeScale));
      }
    }
  }
  const skipTo = Math.max(decisiveAt - SKIP_LEAD * plan.timeScale, 0);
  outcome.rates = applied;

  for (const marker of MARKERS) add(plan.markers[marker], true, () => stage.phase?.(MARKER_PHASE[marker], marker));
  for (const cue of plan.camera) add(cue.at, true, instant => stage.camera(instant ? { ...cue, duration: 0 } : cue));
  for (const cue of plan.effects) add(cue.at, false, () => stage.effect(cue, plan.seed));
  for (const cue of plan.contacts) {
    let aimed = false;
    add(cue.at - (cue.lead ?? 0.12 * plan.timeScale), false, () => { aimed = true; stage.contact(cue, "aim"); });
    add(cue.at, false, () => {
      const a = stage[cue.from.actor].anchor(cue.from.anchor), b = stage[cue.to.actor].anchor(cue.to.anchor);
      outcome.contacts.push({ id: cue.id, error: a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null });
      stage.sampleContact?.(cue, { from: a, to: b });
    });
    add(cue.at + (cue.hold ?? 0.08 * plan.timeScale), true, () => { if (aimed) { aimed = false; stage.contact(cue, "release"); } });
  }

  // ---- the ending: structural, not authored
  const pending: Promise<void>[] = [];
  let fell = false, settled = false;
  const kill = () => {
    if (outcome.killed) return;
    outcome.killed = true;
    stage.audio("decisive", { volume: Math.min(KILL_VOLUME.max, KILL_VOLUME.gain * plan.power), from: "attacker" });
    stage.decisive(resolution, plan);
  };
  const fall = (instant: boolean) => {
    if (fell) return;
    kill(); fell = true;
    pending.push(Promise.resolve(stage.fall(resolution, instant ? 0 : Math.max(0, plan.markers.settle - plan.markers.fall))));
  };
  const settle = (instant: boolean) => {
    if (settled) return;
    fall(instant); settled = true;
    pending.push(Promise.resolve(stage.settle(resolution, instant ? 0 : Math.max(0, plan.seconds - plan.markers.settle))));
  };
  for (const cue of plan.audio) {
    if (cue.cue === "decisive") add(cue.at, true, kill);
    else add(cue.at, false, () => stage.audio(cue.cue, { volume: cue.volume ?? 1, from: cue.from ?? null }));
  }
  add(decisiveAt, true, kill);
  add(plan.markers.fall, true, fall);
  add(plan.markers.settle, true, settle);
  // Stable: equal times keep the order above (phases before cues before the ending).
  steps.map((step, index) => ({ step, index })).sort((a, b) => a.step.time - b.step.time || a.index - b.index).forEach((item, index) => { steps[index] = item.step; });

  // ---- run
  stage.begin?.(plan);
  began = clock.now(); origin = began;
  let skipped = false, hurried = false;
  const capLeft = () => plan.cap - (clock.now() - began);
  const sleep = async (duration: number, also?: Promise<unknown>): Promise<void> => {
    try { await Promise.race([clock.wait(Math.max(duration, 1e-4)), control.wake(), ...(also ? [also] : [])]); }
    catch { throw CANCELLED; } // the session was closed under us: the board is gone
    if (control.cancelled) throw CANCELLED;
  };
  let status: FinishStatus = "completed";
  try {
    let next = 0;
    while (next < steps.length) {
      if (control.cancelled) throw CANCELLED;
      if (capLeft() <= EPSILON) { status = "capped"; break; }
      if (control.skipping && !skipped) {
        skipped = true;
        if (position() < skipTo - EPSILON) {
          status = "skipped";
          for (; next < steps.length && steps[next].time < skipTo - EPSILON; next += 1) if (steps[next].state) steps[next].fire(true);
          origin = clock.now() - skipTo;
          // The blow itself is joined just short of its contact, so it is seen to land.
          const blow = finisher as { clip: ClipInfo; rate: number; event: number; fade: number } | null;
          if (blow) stage.attacker.play(blow.clip, { rate: blow.rate, fade: Math.min(blow.fade, 0.06 * plan.timeScale), from: Math.max(0, blow.event - (decisiveAt - skipTo) * blow.rate) });
          // The defender is put where the exchange had left him: a guard that had been knocked open is open when the blow comes.
          const stance = guards.filter(item => item.start < skipTo - EPSILON).sort((a, b) => a.start - b.start).pop();
          if (stance && (skipTo - stance.start) * stance.rate < stance.clip.duration - 0.02) stage.defender.play(stance.clip, { rate: stance.rate, fade: 0.06 * plan.timeScale, from: (skipTo - stance.start) * stance.rate });
          continue;
        }
        // Asked for after the blow was already on its way: what is left is hurried instead.
        hurried = true; stage.hurry?.();
      }
      if (control.skips > 1 && !hurried) { hurried = true; stage.hurry?.(); }
      const remaining = steps[next].time - position();
      if (remaining > EPSILON) { await sleep(Math.min(remaining, capLeft())); continue; }
      steps[next].fire(false);
      next += 1;
    }
    if (status === "capped") {
      // Out of time: the capture still happens, at once.
      for (; next < steps.length; next += 1) if (steps[next].state) steps[next].fire(true);
      settle(true);
    } else {
      // Let the fall and the claim finish, but never past the cap.
      let done = false;
      const ending = Promise.allSettled(pending).then(() => { done = true; });
      while (!done || position() < plan.seconds - EPSILON) {
        if (capLeft() <= EPSILON) { status = "capped"; break; }
        if (control.skipping && (!skipped || control.skips > 1) && !hurried) { hurried = true; skipped = true; stage.hurry?.(); }
        const tail = plan.seconds - position();
        await sleep(Math.min(tail > EPSILON ? tail : capLeft(), capLeft()), done ? undefined : ending);
      }
    }
  } catch (error) {
    status = error === CANCELLED ? "cancelled" : "failed";
    outcome.status = status; outcome.elapsed = clock.now() - began;
    try { stage.finish(status); } catch (inner) { if (status === "cancelled") throw inner; }
    if (status === "failed") throw error;
    return outcome;
  }
  outcome.status = status; outcome.elapsed = clock.now() - began;
  stage.finish(status);
  return outcome;
}
