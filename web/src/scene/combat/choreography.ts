/**
 * Combat Director data model.
 *
 * A capture is a short coordinated fight. The chess engine has already decided
 * the outcome; a {@link Sequence} only tells its story. Everything here is
 * plain data: serialisable, versioned, free of three.js objects, so sequences
 * can be authored as catalog files, validated in node tests and recorded with
 * the move.
 *
 * This builds on the Pawn foundation rather than replacing it:
 *  - clip ids are the Blender-authored ids of `combatAnimationLibrary.ts`
 *    (`attack.thrust`, `defend.block`, `hit.light`, `death.front`, ...), and
 *    clip events are that library's marker names (`contact`/`impact`, `clash`,
 *    `feint`, `guard`, `evade`, `hit`, `land`, `ready`, `recovery`);
 *  - a Pawn-vs-Pawn sequence carries the `CombatSequence` tuple of
 *    `shared/play/combat-sequences.ts`, so `PieceView.configureCombat`,
 *    `playDefense`, `takeHit` and `playDeath` keep working unchanged;
 *  - beats are timed on the paired animation clock of `pairedCombat.ts`.
 *
 * Space. A sequence is authored in the *duel frame*, never in board or world
 * coordinates: `along` runs from the attacker towards the defender, `side` is
 * the open flank. The director turns that into board offsets for the actual
 * capture direction, so one sequence serves all eight directions, both armies
 * and en passant. Distances are in squares.
 */
import type { CombatSequence } from "../../../../shared/play/combat-sequences";

export const CHOREOGRAPHY_VERSION = 1;

export type Kind = "p" | "n" | "b" | "r" | "q" | "k";
export type Side = "w" | "b";
/** Army skin ids of `web/src/assets/generated.ts`; `ARMY_KINGDOMS` names them. */
export type Kingdom = "ivory" | "sun" | "empire" | "kwind";
export const KINGDOMS: readonly Kingdom[] = ["ivory", "sun", "empire", "kwind"];
export const KINGDOM_NAMES: Readonly<Record<Kingdom, string>> = { ivory: "Aethelgard", sun: "Solforiz", empire: "Korvenia", kwind: "Kwind-09" };
export type AttackStyle = "melee" | "spell" | "gun";
export type ShieldMaterial = "wood" | "iron";
/** What a kingdom's line troops carry unless the stage says otherwise (Kwind-09 carries no shields). */
export const KINGDOM_SHIELD: Readonly<Record<Kingdom, ShieldMaterial | null>> = { ivory: "iron", sun: "wood", empire: "iron", kwind: null };

export const PIECE_VALUE: Readonly<Record<Kind, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** Defender worth this much more than its killer: the fight must look hard. */
export const UNDERDOG_GAP = 4;
/** A Pawn felling a Queen. The director raises the plan's `power` for it, and
 * the engine's own witness system (BoardReactionDirector) reads that power. */
export const DISBELIEF_GAP = 8;

/** The named moments of every fight, in order. A beat starts at its marker. */
export const MARKERS = ["approach", "ready", "clash", "recoil", "counter", "decisive", "fall", "settle"] as const;
export type Marker = typeof MARKERS[number];
/** `CombatPhase` of pairedCombat.ts that each beat reports to its session. */
export const MARKER_PHASE: Readonly<Record<Marker, "approach" | "anticipate" | "strike" | "contact" | "fall" | "advance">> = {
  approach: "approach", ready: "anticipate", clash: "strike", recoil: "strike", counter: "strike",
  decisive: "contact", fall: "fall", settle: "advance",
};

export const CLIP_ROLES = ["attack", "block", "hit", "stagger", "death", "idle", "walk", "run"] as const;
export type ClipRole = typeof CLIP_ROLES[number];
export const POSES = ["brace", "block", "recoil", "stagger"] as const;
/** Procedural, layered over whatever clip is playing (livingPieceRig / contactIK). */
export type Pose = typeof POSES[number];
export const ANCHORS = ["weaponTip", "shieldFace", "torso", "head", "ground"] as const;
export type Anchor = typeof ANCHORS[number];
export type Actor = "attacker" | "defender";

/** The only sounds a sequence may ask for. `decisive` is the existing killing strike. */
export const AUDIO_CUES = [
  "clash.shield.wood", "clash.shield.iron", "clash.parry.steel", "bash.shield",
  "effort.light", "effort.heavy", "brace", "recoil", "stagger",
  "whoosh.light", "whoosh.heavy", "decisive", "fall.light", "fall.heavy",
] as const;
export type AudioCue = typeof AUDIO_CUES[number];

export const FRAMINGS = ["wide", "duel", "attacker", "defender", "contact", "victor"] as const;
export type Framing = typeof FRAMINGS[number];
export const EFFECTS = ["sparks", "dust", "flash", "shake", "hitstop", "slash", "ring", "projectile", "restraint", "mist", "rite"] as const;
export type Effect = typeof EFFECTS[number];
/** `step` is a guarded pace taken on the step clips; `dodge` is a hop off the line or back out of reach. */
export type Gait = "walk" | "run" | "step" | "leap" | "dodge";

/** Performance and safety limits, enforced by {@link validateSequence} and the runner. */
export const LIMITS = {
  /** No capture may hold the board longer than this, whatever the data says. */
  hardCapSeconds: 6,
  minSeconds: 0.9,
  cues: 96,
  effects: 14,
  contacts: 8,
  /** How far a fighter may be displaced from its reference point, in squares. */
  attackerDrift: 0.9,
  defenderDrift: 0.45,
  minSpeed: 0.5,
  maxSpeed: 4,
} as const;

/** A moment: a named marker plus an offset in seconds (authored at speed 1). */
export interface At { marker: Marker; offset?: number }
export const at = (marker: Marker, offset = 0): At => (offset ? { marker, offset } : { marker });

/** A place in the duel frame, relative to a reference point, in squares. */
export interface DuelPoint {
  /** defender: where the victim stands. standoff: where the attacker's weapon
   * reaches it from (the stage knows the reach). origin: the square the
   * attacker left. destination: the square it ends on (not the victim's square
   * in en passant). */
  ref: "defender" | "standoff" | "origin" | "destination";
  /** Towards (+) or away from (-) the defender, along the attack line. */
  along?: number;
  /** Towards the open flank (+). Mirrored per capture by the director. */
  side?: number;
}
/** The same place after the director has resolved direction and mirroring: an
 * offset in board squares (file, rank) from the reference point. */
export interface BoardPoint { ref: DuelPoint["ref"]; file: number; rank: number }

export interface AnchorRef { actor: Actor; anchor: Anchor }
export type Locus<P> = AnchorRef | { point: P };

/** Cue filter, resolved by the director against the two fighters. */
export interface When {
  defenderShield?: ShieldMaterial | "any" | "none";
  attackerShield?: ShieldMaterial | "any" | "none";
  /** Decoration only: dropped on low quality and at exhibition speeds above 2. */
  detail?: true;
}

export type ClipFallback = { role: ClipRole; prefer?: readonly string[] } | { pose: Pose; strength?: number };
/** A clip asked for by role. `prefer` lists authored variant ids, best first;
 * the stage then tries its generic clip for the role, then the fallbacks. */
export interface ClipRequest {
  role: ClipRole;
  prefer?: readonly string[];
  fallbacks?: readonly ClipFallback[];
  /** Nothing resolves: the whole sequence is unplayable and the engine falls back. */
  required?: boolean;
}

export type ActorAction<P, T> =
  | {
    do: "clip"; clip: ClipRequest;
    /** Retimes the clip so its first listed authored event lands on a moment:
     * this is what keeps both rigs on the same contact frame. */
    sync?: { events: readonly string[]; to: T };
    /**
     * Two blows in one clip, timed apart. The clip's `event` (the first blow)
     * lands on `to`; the clip runs `follow` more of its own seconds, then crawls
     * (`crawl`, a share of natural speed: the held beat) until `resume`, and
     * from there is paced so that the `sync` event (the second blow) lands on
     * its own moment. Needs `sync`.
     */
    via?: { event: string; to: T; follow?: number; resume: T; crawl?: number };
    rate?: number; fade?: number;
  }
  | { do: "pose"; pose: Pose; strength?: number; hold?: number; toward?: Locus<P>; drive?: "ik" | "bones" }
  | { do: "move"; to: P; duration: number; gait: Gait; arc?: number }
  | { do: "face"; toward: Locus<P>; duration?: number };

export interface CameraAction { framing: Framing; fov?: number; duration: number }
export interface EffectAction<P> { fx: Effect; where: Locus<P>; target?: Locus<P>; strength?: number; duration?: number; id?: string }
export interface AudioAction { cue: AudioCue; volume?: number; from?: Actor }
/** Which anchor meets which, at the cue's moment. `lead` seconds before it the
 * stage starts steering the IK; `hold` seconds after, it lets go. */
export interface ContactAction { id: string; from: AnchorRef; to: AnchorRef; lead?: number; hold?: number; weight?: number }

export type Cue<A> = A & { at: At; when?: When };
export type Planned<A> = A & { at: number };

export interface Tracks {
  attacker: readonly Cue<ActorAction<DuelPoint, At>>[];
  defender: readonly Cue<ActorAction<DuelPoint, At>>[];
  camera: readonly Cue<CameraAction>[];
  effects: readonly Cue<EffectAction<DuelPoint>>[];
  audio: readonly Cue<AudioAction>[];
}

/** How a capture ends. Not a track: it cannot be authored away. The defender
 * dies at `decisive`/`fall`, the attacker owns the square at `settle`. */
export interface Resolution {
  /** Impact strength handed to the engine's contact (board shock, particles). */
  power: number;
  weight: "light" | "heavy";
  hit: ClipRequest;
  death: ClipRequest;
  claim: { gait: Gait; clip?: ClipRequest };
}

export interface Fit {
  attacker: readonly Kind[];
  defender: readonly Kind[];
  attackerKingdom?: readonly Kingdom[];
  defenderKingdom?: readonly Kingdom[];
  /** Named characters only (`"cael"`). Without this, anyone of the class fits. */
  identity?: readonly string[];
  style?: readonly AttackStyle[];
  attackerShield?: boolean;
  defenderShield?: boolean;
  defenderArmed?: boolean;
  line?: readonly ("orthogonal" | "diagonal" | "knight")[];
  minDistance?: number;
  maxDistance?: number;
  enPassant?: boolean;
  check?: boolean;
  /** Defender value minus attacker value. */
  minGap?: number;
  maxGap?: number;
}

export type Tier = "standard" | "underdog" | "signature" | "rite";

export interface Sequence {
  /** Select a source-qualified clip profile; defaults to the original v1. Knights, Rooks and Kings fight on their own
   * rank libraries (`crownfall-rank-combat-1`, sequences/rank.ts). */
  animationLibrary?: "crownfall-pawn-combat-1" | "crownfall-pawn-combat-2" | "crownfall-rank-combat-1";
  version: typeof CHOREOGRAPHY_VERSION;
  /** `class.name[.variant]`, lowercase. Recorded with the move: never reuse one. */
  id: string;
  /** The variation this belongs to, for the no-repeat memory. Defaults to `id`. */
  family?: string;
  tier: Tier;
  fits: Fit;
  /** Higher priorities win outright; weights choose among equals. */
  priority?: number;
  weight: number;
  /** Authored clip ids (all of them) and stage abilities this needs. Without
   * them the director answers "fallback" and today's cinematic runs. */
  requires?: { attacker?: readonly string[]; defender?: readonly string[]; stage?: readonly ("projectile" | "restraint" | "rite")[] };
  budget: { seconds: number; max: number };
  markers: Readonly<Record<Marker, number>>;
  tracks: Tracks;
  contacts?: readonly Cue<ContactAction>[];
  resolution: Resolution;
  /**
   * Fixes which flank is the open one (`side: +`) instead of leaving it to the
   * board: a fight that is staged round a shield has to know which arm holds
   * it. The lateral moves of such a sequence must stay within half a square.
   */
  openSide?: "attackerLeft" | "attackerRight";
  /** The Pawn foundation's tuple this sequence performs, if it is one of them. */
  performance?: Pick<CombatSequence, "attack" | "defense" | "hit" | "death">;
  note?: string;
}

export const seconds = (sequence: Pick<Sequence, "markers">, moment: At): number => sequence.markers[moment.marker] + (moment.offset ?? 0);
export const familyOf = (sequence: Pick<Sequence, "id" | "family">): string => sequence.family ?? sequence.id;

const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const isAnchor = <P>(locus: Locus<P>): locus is AnchorRef => "actor" in locus;

/** Every reason a sequence may not ship. Empty means valid. Catalogs are
 * checked when they are built, so a bad entry fails a test, not a match. */
export function validateSequence(sequence: Sequence): string[] {
  const errors: string[] = [];
  const fail = (message: string) => { errors.push(`${sequence.id}: ${message}`); };
  if (sequence.version !== CHOREOGRAPHY_VERSION) fail("unknown version");
  if (!ID.test(sequence.id) || sequence.id.length > 48 || sequence.id === "fallback") fail("bad id");
  if (sequence.family !== undefined && !ID.test(sequence.family)) fail("bad family");
  if (!(sequence.weight > 0) || !Number.isFinite(sequence.weight)) fail("weight must be positive");
  if (!sequence.fits.attacker.length || !sequence.fits.defender.length) fail("fits nobody");

  if (!sequence.resolution) fail("a capture needs a resolution");
  // Checkmate is not a fight: it belongs to the engine's CheckmatePresentation.
  if (sequence.fits.defender.includes("k")) fail("a king is never captured");

  let previous = 0;
  for (const marker of MARKERS) {
    const time = sequence.markers[marker];
    if (!Number.isFinite(time) || time < previous) fail(`marker ${marker} is out of order`);
    else previous = time;
  }
  if (sequence.markers.approach !== 0) fail("approach starts the sequence");
  const length = sequence.budget.seconds;
  if (!(length >= sequence.markers.settle) || !(sequence.budget.max >= length) || sequence.budget.max > LIMITS.hardCapSeconds || length < LIMITS.minSeconds)
    fail("budget does not hold the sequence");

  const inside = (moment: At, label: string): number => {
    const time = seconds(sequence, moment);
    if (!MARKERS.includes(moment.marker) || !Number.isFinite(time) || time < 0 || time > length + 1e-9) fail(`${label} lies outside the sequence`);
    return time;
  };
  const point = (place: DuelPoint, actor: Actor, label: string) => {
    const drift = Math.hypot(place.along ?? 0, place.side ?? 0);
    const limit = actor === "defender" ? LIMITS.defenderDrift : LIMITS.attackerDrift;
    if (!Number.isFinite(drift) || drift > limit) fail(`${label} strays ${drift.toFixed(2)} squares`);
    if (actor === "defender" && place.ref !== "defender") fail(`${label}: a defender stays on its square`);
  };
  const locus = (where: Locus<DuelPoint>, label: string) => {
    if (isAnchor(where)) { if (!ANCHORS.includes(where.anchor)) fail(`${label}: unknown anchor`); }
    else point(where.point, "attacker", label);
  };
  const clip = (request: ClipRequest, label: string) => {
    if (!CLIP_ROLES.includes(request.role)) fail(`${label}: unknown clip role`);
    for (const fallback of request.fallbacks ?? []) {
      if ("pose" in fallback ? !POSES.includes(fallback.pose) : !CLIP_ROLES.includes(fallback.role)) fail(`${label}: unknown fallback`);
    }
  };

  let cues = 0;
  for (const actor of ["attacker", "defender"] as const) {
    for (const cue of sequence.tracks[actor]) {
      cues += 1;
      const label = `${actor} ${cue.do}`;
      const time = inside(cue.at, label);
      if (actor === "defender" && time > sequence.markers.decisive + 1e-9) fail(`${label}: the defender is dead after the decisive hit`);
      if (time > sequence.markers.settle + 1e-9) fail(`${label}: nothing is authored after settle`);
      if (cue.do === "clip") {
        clip(cue.clip, label);
        if (cue.clip.role === "death") fail(`${label}: death belongs to the resolution`);
        if (cue.sync) {
          if (!cue.sync.events.length) fail(`${label}: sync names no event`);
          if (inside(cue.sync.to, `${label} sync`) < time) fail(`${label}: sync target precedes the clip`);
        }
        if (cue.via) {
          const first = inside(cue.via.to, `${label} via`), resume = inside(cue.via.resume, `${label} resume`);
          if (!cue.sync || first < time || resume < first || resume > seconds(sequence, cue.sync.to)) fail(`${label}: the first blow, the held beat and the second blow are out of order`);
          if ((cue.via.crawl ?? 0) < 0 || (cue.via.crawl ?? 0) > 1 || (cue.via.follow ?? 0) < 0) fail(`${label}: bad held beat`);
        }
      } else if (cue.do === "pose") {
        if (!POSES.includes(cue.pose)) fail(`${label}: unknown pose`);
        if (cue.toward) locus(cue.toward, label);
      } else if (cue.do === "move") {
        point(cue.to, actor, label);
        if (!(cue.duration >= 0)) fail(`${label}: bad duration`);
      } else locus(cue.toward, label);
    }
  }
  for (const cue of sequence.tracks.camera) {
    cues += 1; inside(cue.at, "camera");
    if (!FRAMINGS.includes(cue.framing) || !(cue.duration >= 0) || Math.abs(cue.fov ?? 0) > 14) fail("camera cue is out of range");
  }
  let effects = 0;
  for (const cue of sequence.tracks.effects) {
    cues += 1; effects += 1; inside(cue.at, `effect ${cue.fx}`);
    if (!EFFECTS.includes(cue.fx)) fail("unknown effect");
    locus(cue.where, `effect ${cue.fx}`);
    if (cue.target) locus(cue.target, `effect ${cue.fx}`);
    if (cue.fx === "rite" && !cue.id) fail("a rite names its catalog entry");
  }
  if (effects > LIMITS.effects) fail("too many effects");
  let kills = 0;
  for (const cue of sequence.tracks.audio) {
    cues += 1; inside(cue.at, `audio ${cue.cue}`);
    if (!AUDIO_CUES.includes(cue.cue)) fail(`unknown audio cue ${String(cue.cue)}`);
    if (cue.cue === "decisive") {
      kills += 1;
      if (cue.at.marker !== "decisive" || cue.at.offset || cue.when) fail("the killing strike sounds exactly on the decisive marker");
    }
  }
  if (kills !== 1) fail("exactly one killing strike");
  if (sequence.openSide !== undefined) {
    if (sequence.openSide !== "attackerLeft" && sequence.openSide !== "attackerRight") fail("unknown open side");
    // The flank is not chosen to keep the fight on the board, so nobody may be sent far across it.
    for (const actor of ["attacker", "defender"] as const) for (const cue of sequence.tracks[actor]) if (cue.do === "move" && Math.abs(cue.to.side ?? 0) > 0.5) fail(`${actor} move leaves the square's flank with a fixed open side`);
  }
  const ids = new Set<string>();
  for (const cue of sequence.contacts ?? []) {
    cues += 1; inside(cue.at, `contact ${cue.id}`);
    if (ids.has(cue.id)) fail(`duplicate contact ${cue.id}`);
    ids.add(cue.id);
    if (!ANCHORS.includes(cue.from.anchor) || !ANCHORS.includes(cue.to.anchor) || cue.from.actor === cue.to.actor) fail(`contact ${cue.id} must join two fighters`);
    if (cue.to.actor === "defender" && seconds(sequence, cue.at) > sequence.markers.decisive + 1e-9) fail(`contact ${cue.id} follows the kill`);
  }
  if ((sequence.contacts?.length ?? 0) > LIMITS.contacts) fail("too many contacts");
  if (cues > LIMITS.cues) fail("too many cues");
  if (sequence.resolution) {
    clip(sequence.resolution.hit, "resolution hit"); clip(sequence.resolution.death, "resolution death");
    if (sequence.resolution.death.role !== "death") fail("the resolution ends in a death");
    if (!(sequence.resolution.power > 0 && sequence.resolution.power <= 2)) fail("resolution power is out of range");
  }
  return errors;
}

/** A frozen, validated catalog. Throws on any invalid or duplicated entry. */
export function createCatalog(...lists: readonly (readonly Sequence[])[]): readonly Sequence[] {
  const all = lists.flat(), seen = new Set<string>(), errors: string[] = [];
  for (const sequence of all) {
    if (seen.has(sequence.id)) errors.push(`${sequence.id}: duplicate id`);
    seen.add(sequence.id);
    errors.push(...validateSequence(sequence));
  }
  for (const sequence of all) if (sequence.family && !seen.has(sequence.family)) errors.push(`${sequence.id}: family ${sequence.family} is not in the catalog`);
  if (errors.length) throw new Error(`Invalid combat catalog:\n${errors.join("\n")}`);
  return Object.freeze(all.slice());
}
