import type { Faction, PieceKind } from "../core/types";
import type { QualityPreset } from "./quality";
import { emotionalCue, feel, lookAway, type ReactionMeaning } from "./battleEmotion";

export interface ReactionPoint { readonly x: number; readonly y: number; readonly z: number; }
export interface BoardObserver {
  readonly id: string;
  readonly square: string;
  readonly kind: PieceKind;
  readonly color: Faction;
  readonly point: ReactionPoint;
  /** Where the figure faces on the board (unit x/z). Given, a witness reacts only to what is in front of it. */
  readonly facing?: { readonly x: number; readonly z: number };
}
export type BoardReactionEventKind = "move-started" | "capture-impact" | "ally-fallen" | "avenged" | "check" | "checkmate";
export interface BoardReactionEvent {
  readonly id: string;
  readonly type: BoardReactionEventKind;
  readonly point: ReactionPoint;
  readonly focus?: ReactionPoint;
  readonly victimColor?: Faction;
  readonly kingId?: string;
  readonly checks?: number;
  readonly power?: number;
  /** The active duel owns these actors; observers never overwrite its pose. */
  readonly primary?: readonly string[];
  /** What the moment means to each witness, from the battle memory (battleEmotion.ts). Absent: the plain reaction. */
  readonly meaning?: ReactionMeaning;
}
export interface BoardReactionCue {
  readonly target: ReactionPoint;
  readonly pose: "watch" | "flinch" | "challenge" | "protect" | "royal-guard" | "grief" | "resolve" | "defiant"
    | "mourn" | "rage" | "dread" | "wary" | "vindicated";
  readonly gaze: number;
  readonly flinch: number;
  readonly grip: number;
  readonly posture: number;
  readonly duration: number;
  readonly delay: number;
  readonly sustained: boolean;
  readonly headOnly: boolean;
  /** Head pitch: positive bows the head, negative lifts the chin. Kept on Low, as the head is. */
  readonly bow?: number;
  /** A slow deep breath through the hold (grief, vindication). */
  readonly sigh?: number;
  /** Seconds to ease in and out: grief comes slowly and leaves slowly. Default .18 and .35. */
  readonly onset?: number;
  readonly release?: number;
}
export interface BoardReactionPlan {
  readonly reactions: readonly { id: string; cue: BoardReactionCue }[];
  readonly release: readonly string[];
}

/** How many bystanders may hold a reaction at once. Raised so a capture is seen to be seen. */
const BUDGET: Record<QualityPreset, number> = { low: 4, medium: 8, high: 12, ultra: 12 };
const PRIORITY: Record<BoardReactionEventKind, number> = { "move-started": 1, "capture-impact": 3, "ally-fallen": 4, avenged: 4, check: 5, checkmate: 6 };
const PERSONALITY: Record<PieceKind, { gaze: number; flinch: number; grip: number; posture: number; duration: number }> = {
  p: { gaze: .85, flinch: .35, grip: .2, posture: .12, duration: 1.55 },
  n: { gaze: .95, flinch: .12, grip: .12, posture: -.035, duration: 1.4 },
  b: { gaze: .75, flinch: .012, grip: .018, posture: .008, duration: 1.8 },
  r: { gaze: .72, flinch: .08, grip: .15, posture: .065, duration: 1.85 },
  q: { gaze: 1, flinch: 0, grip: .025, posture: -.018, duration: 2.6 },
  k: { gaze: .9, flinch: .012, grip: .08, posture: .025, duration: 2.4 },
};
const finite = (point: ReactionPoint) => Number.isFinite(point.x + point.y + point.z);
const distance = (a: ReactionPoint, b: ReactionPoint) => Math.hypot(a.x-b.x, a.z-b.z);
/** Cosine of the widest bearing a figure notices: 110 degrees either side of where it faces. */
const FIELD_OF_VIEW = Math.cos(110 * Math.PI / 180);

/** Whether a point is in front of a figure that knows its facing; one that does not sees all round, as before. */
export function boardFieldOfView(observer: BoardObserver, point: ReactionPoint): boolean {
  const facing = observer.facing;
  if (!facing) return true;
  const dx = point.x-observer.point.x, dz = point.z-observer.point.z, length = Math.hypot(dx, dz), norm = Math.hypot(facing.x, facing.z);
  return length < 1e-6 || norm < 1e-6 || (facing.x*dx+facing.z*dz)/(length*norm) >= FIELD_OF_VIEW;
}

/** Cheap board-space visibility, not a claim of mesh/terrain ray tracing.
 * Standing pieces occlude a narrow segment; primary fighters are endpoints. */
export function boardLineOfSight(observer: BoardObserver, point: ReactionPoint, roster: readonly BoardObserver[], ignored: ReadonlySet<string>, squareSize = 1): boolean {
  const dx = point.x-observer.point.x, dz = point.z-observer.point.z, length = dx*dx+dz*dz;
  if (length < 1e-8) return true;
  return !roster.some(other => {
    if (other.id === observer.id || ignored.has(other.id)) return false;
    const along = ((other.point.x-observer.point.x)*dx+(other.point.z-observer.point.z)*dz)/length;
    if (along <= .06 || along >= .94) return false;
    return Math.hypot(other.point.x-observer.point.x-dx*along, other.point.z-observer.point.z-dz*along) < squareSize*.3;
  });
}

interface Active { id: string; square: string; priority: number; score: number; until: number; cue: BoardReactionCue; fresh?: boolean; }

/** Visual-only, event-driven policy. No moves, chess clocks, navigation, RNG,
 * audio or asynchronous jobs. At most six observers hold meaningful poses. */
export class BoardReactionDirector {
  private now = 0;
  private readonly active = new Map<string, Active>();
  private readonly cooldowns = new Map<string, { until: number; priority: number }>();
  private readonly seen = new Set<string>();

  constructor(private quality: QualityPreset = "medium", private readonly squareSize = 1) {}
  get activeCount(): number { return this.active.size; }
  get budget(): number { return BUDGET[this.quality]; }
  reset(): void { this.active.clear(); this.cooldowns.clear(); this.seen.clear(); this.now = 0; }
  setQuality(quality: QualityPreset): void { if (quality !== this.quality) { this.quality = quality; this.reset(); } }
  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.now += delta;
    for (const [id, active] of this.active) if (active.until <= this.now) this.active.delete(id);
    for (const [id, entry] of this.cooldowns) if (entry.until <= this.now) this.cooldowns.delete(id);
  }

  /**
   * The figure grieving hardest right now, for the camera to keep in frame: a companion's grief before a mourner's,
   * then the deeper feeling; null when no one grieves.
   */
  mourner(): string | null {
    let best: Active | null = null;
    const rank = (value: Active) => (value.cue.pose === "grief" ? 2 : value.cue.pose === "mourn" ? 1 : 0);
    for (const value of this.active.values()) {
      if (value.until <= this.now || rank(value) === 0) continue;
      if (!best || rank(value) > rank(best) || (rank(value) === rank(best) && value.score > best.score)) best = value;
    }
    return best?.id ?? null;
  }

  releaseRoyal(): readonly string[] {
    const released: string[] = [];
    for (const [id, value] of this.active) if (value.cue.pose === "royal-guard") {
      this.active.delete(id); this.cooldowns.delete(id); released.push(id);
    }
    return released;
  }

  plan(event: BoardReactionEvent, roster: readonly BoardObserver[]): BoardReactionPlan {
    const empty: BoardReactionPlan = { reactions: [], release: [] };
    if (this.seen.has(event.id) || !finite(event.point) || (event.focus && !finite(event.focus))) return empty;
    this.seen.add(event.id);
    if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    const priority = PRIORITY[event.type], primary = new Set(event.primary ?? []);
    const live = new Set(roster.map(actor => actor.id));
    const removed: string[] = [];
    for (const id of this.active.keys()) if (!live.has(id) || primary.has(id)) {
      this.active.delete(id); this.cooldowns.delete(id); removed.push(id);
    }
    const candidates: Active[] = [...this.active.values()].map(value => ({ ...value, fresh: false }));
    const meaning = event.meaning;
    for (const actor of roster) {
      if (primary.has(actor.id) || !finite(actor.point)) continue;
      const royal = actor.id === event.kingId && actor.kind === "k";
      // The avenger's own moment: it is the event, wherever it stands.
      const self = !!meaning?.avenger && actor.id === meaning.avenger;
      const d = distance(actor.point, event.point)/this.squareSize;
      const allied = actor.color === event.victimColor;
      const plainRadius = event.type === "move-started" ? 1.9 : event.type === "check" || event.type === "checkmate" ? 3.2 : (actor.kind === "q" || actor.kind === "k") ? 4.6 : 3.1;
      let feeling = meaning ? feel(event.type, meaning, actor, allied, plainRadius) : null;
      // An avenging is only ever felt by those the meaning names.
      if (event.type === "avenged" && !feeling) continue;
      const radius = feeling ? feeling.reach : plainRadius;
      if (!royal && !self && (d > radius || d < .1)) continue;
      // Nobody reacts to what it cannot see: a figure in the way, or the moment behind its back (check and mate are a state, not a sight).
      if (!royal && !self && !boardLineOfSight(actor, event.point, roster, primary, this.squareSize)) continue;
      if (!royal && !self && event.type !== "check" && event.type !== "checkmate" && !boardFieldOfView(actor, event.point)) continue;
      const previous = this.active.get(actor.id), cooldown = this.cooldowns.get(actor.id);
      if (!royal && !self && ((previous && previous.priority > priority) || (cooldown && cooldown.until > this.now && cooldown.priority >= priority))) continue;
      // A stranger still looking at the blow keeps that look rather than turning again for the fall.
      if (feeling?.keep && previous) continue;
      const capture = event.type === "capture-impact" || event.type === "ally-fallen";
      const profile = PERSONALITY[actor.kind], strength = royal || self ? 1 : Math.max(capture ? .35 : .15, feeling?.strength ?? 0, 1-d/(radius+.5));
      let pose: BoardReactionCue["pose"] = actor.kind === "n" ? "challenge" : actor.kind === "r" && allied ? "protect" : "watch";
      if (capture && actor.kind === "p" && allied) pose = "flinch";
      if (event.type === "check" && royal) pose = "royal-guard";
      if (event.type === "checkmate") pose = royal ? "defiant" : allied ? "grief" : "resolve";
      // The King's tension grows as his guard falls.
      const guardLost = royal && event.type === "check" ? Math.min(1, Math.max(0, meaning?.guardLost ?? 0)) : 0;
      // The plain look goes to the killer; if a figure stands between, it goes to the body instead (never through anyone).
      let plainTarget = event.focus ?? event.point;
      if (!royal && event.focus && distance(event.focus, event.point) > .5*this.squareSize && !boardLineOfSight(actor, event.focus, roster, primary, this.squareSize)) plainTarget = event.point;
      const plain: BoardReactionCue = {
        target: { ...plainTarget }, pose,
        gaze: profile.gaze*strength,
        flinch: capture ? profile.flinch*strength*(allied ? 1 : .6)*Math.min(1.4, Math.max(.2, event.power ?? 1)) : 0,
        grip: pose === "defiant" || pose === "grief" ? -.07 : royal ? .13+Math.min(4, Math.max(0, event.checks ?? 0))*.012+guardLost*.06 : profile.grip*strength,
        posture: pose === "defiant" ? -.055 : pose === "grief" ? .09 : pose === "royal-guard" ? .12+guardLost*.05 : profile.posture*strength,
        duration: event.type === "checkmate" ? 6.4 : profile.duration,
        // A blow ripples outward: the nearest flinch first, the far ranks a beat later.
        delay: royal ? 0 : capture ? Math.min(.4, d*.09) : 0.08+Math.min(.22, d*.045),
        sustained: royal && (event.type === "check" || event.type === "checkmate"),
        // A killing a few squares away moves the whole body on every preset: a turned head alone reads as idle.
        headOnly: this.quality === "low" && !capture,
        ...(guardLost > 0 ? { bow: guardLost*.04 } : {}),
      };
      let cue = plain;
      if (feeling?.pose && feeling.pose !== "glance") {
        // The look the feeling wants must be seen: the killer behind another figure is not glared at through it.
        let target = feeling.look === "focus" && event.focus ? event.focus : event.point;
        if (!self && target !== event.point && !boardLineOfSight(actor, target, roster, primary, this.squareSize)) { feeling = lookAway(feeling); target = event.point; }
        const sees = distance(actor.point, target) > .3*this.squareSize && boardFieldOfView(actor, target);
        cue = emotionalCue(plain, feeling, actor, d, strength, target, sees);
      } else if (feeling) cue = emotionalCue(plain, feeling, actor, d, strength, plain.target);
      const score = (royal ? 1000 : 0)+strength*10+(allied ? 2 : 0)+(actor.kind === "q" ? 1 : 0)+(feeling?.score ?? 0);
      const index = candidates.findIndex(value => value.id === actor.id);
      if (index >= 0) candidates.splice(index, 1);
      candidates.push({ id: actor.id, square: actor.square, priority, score, until: cue.sustained ? Infinity : this.now+cue.delay+cue.duration, cue, fresh: true });
    }
    candidates.sort((a, b) => b.priority-a.priority || b.score-a.score || a.square.localeCompare(b.square));
    const chosen = candidates.slice(0, this.budget), ids = new Set(chosen.map(value => value.id));
    const release = [...removed, ...[...this.active.keys()].filter(id => !ids.has(id))];
    this.active.clear();
    for (const value of chosen) {
      this.active.set(value.id, { ...value, fresh: false });
      if (value.fresh) this.cooldowns.set(value.id, { until: this.now+value.cue.delay+value.cue.duration+.65, priority });
    }
    return { reactions: chosen.filter(value => value.fresh).map(value => ({ id: value.id, cue: value.cue })), release };
  }
}
