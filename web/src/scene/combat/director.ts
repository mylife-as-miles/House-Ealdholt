/**
 * The Combat Director: which fight a capture gets. Pure and deterministic. The
 * same input always yields the same plan, so the choice can be made where the
 * move is committed (gameController, like the Pawn foundation's selector that
 * this supersedes) and replayed from its record.
 *
 * It never decides an outcome. It answers either a resolved plan for runner.ts
 * or "fallback", on which the engine runs today's playCaptureCinematic /
 * playSpellCinematic / playGunCinematic untouched.
 */
import { COMBAT_LIBRARY_VERSION, combatComment, combatSequenceFromComment, type CombatSequence } from "../../../../shared/play/combat-sequences";
import {
  CHOREOGRAPHY_VERSION, DISBELIEF_GAP, LIMITS, MARKERS, PIECE_VALUE, UNDERDOG_GAP, familyOf, seconds,
  type ActorAction, type At, type AttackStyle, type AudioAction, type BoardPoint, type CameraAction, type ClipRequest,
  type ContactAction, type Cue, type DuelPoint, type EffectAction, type Kind, type Kingdom, type Locus,
  type Marker, type Planned, type Resolution, type Sequence, type ShieldMaterial, type Side, type Tier, type When,
} from "./choreography";
import { combatRecordFromComment, encodeCombatRecord } from "./record";
import { CATALOG } from "./sequences/index";
import { PAWN_V1_SEQUENCES } from "./sequences/pawnV1";

export interface Combatant {
  kind: Kind;
  side: Side;
  kingdom: Kingdom;
  /** A named character (`"cael"`): may unlock a signature style, never a rule. */
  identity?: string;
  /** A stable key for this very piece, for the no-repeat memory. */
  id?: string;
  armed?: boolean;
  shield?: ShieldMaterial | null;
  style?: AttackStyle;
  /** Clip names the rig holds: generic (`attack`, `death`, `walk`, ...) and
   * authored variant ids (`attack.thrust`, ...). Omit when unknown: the runner
   * checks again against the real rigs before it touches the stage. */
  clips?: readonly string[];
}

export interface CombatMemory { family: string; matchup: string; attacker?: string }

export interface CombatInput {
  attacker: Combatant;
  defender: Combatant;
  /** `victim` is the captured piece's square when it is not `to` (en passant). */
  geometry: { from: string; to: string; victim?: string };
  context?: {
    check?: boolean;
    /** Defender value minus attacker value; derived from the kinds when omitted. */
    valueGap?: number;
    /** Recent fights, oldest first. */
    history?: readonly CombatMemory[];
    /** Exhibition speed: 2 plays the fight in half the time. */
    speed?: number;
    /** False on the low preset: decoration cues are dropped. */
    detail?: boolean;
    /** What the stage adapter can perform beyond clips, poses and moves. */
    stage?: readonly ("projectile" | "restraint" | "rite")[];
  };
  /** From the game's move record: see {@link combatSeed}. */
  seed: number;
}

export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export interface Geometry {
  from: string; to: string; victim: string;
  /** Unit attack line in board squares: file towards h, rank towards 8. */
  heading: { file: number; rank: number };
  /** Unit open flank: what `side: 1` means for this capture. */
  lateral: { file: number; rank: number };
  /** +1 when the open flank is the attacker's right, -1 when mirrored to its left. */
  side: 1 | -1;
  compass: Compass;
  line: "orthogonal" | "diagonal" | "knight";
  distance: number;
  knightJump: boolean;
  enPassant: boolean;
}

export interface CombatPlan {
  animationLibrary?: "crownfall-pawn-combat-1" | "crownfall-pawn-combat-2" | "crownfall-rank-combat-1";
  kind: "sequence";
  version: typeof CHOREOGRAPHY_VERSION;
  sequenceId: string;
  family: string;
  tier: Tier;
  /** The PGN comment token to store with the move. */
  record: string;
  /** Set for a Pawn-foundation tuple: hand it to MoveEvent.choreography. */
  choreography?: CombatSequence;
  seed: number;
  geometry: Geometry;
  /** Authored seconds are multiplied by this. Mirroring never changes time. */
  timeScale: number;
  seconds: number;
  /** The runner ends the fight by this many seconds, finished or not. */
  cap: number;
  markers: Record<Marker, number>;
  attacker: Planned<ActorAction<BoardPoint, number>>[];
  defender: Planned<ActorAction<BoardPoint, number>>[];
  camera: Planned<CameraAction>[];
  effects: Planned<EffectAction<BoardPoint>>[];
  audio: Planned<AudioAction>[];
  contacts: Planned<ContactAction>[];
  resolution: Resolution;
  /**
   * How hard the killing blow lands: `resolution.power`, raised for an upset
   * (x1.15 from a value gap of UNDERDOG_GAP, x1.35 from DISBELIEF_GAP, capped
   * at 2). This is the only witness signal the director gives. The stage hands
   * it to the engine's existing `reactToImpact(point, power, victim, attacker)`,
   * and Codex's BoardReactionDirector decides who reacts and how.
   */
  power: number;
}
export interface CombatFallback { kind: "fallback"; reason: string; record: "" }
export type CombatDirection = CombatPlan | CombatFallback;

const fallback = (reason: string): CombatFallback => ({ kind: "fallback", reason, record: "" });
const TIER_PRIORITY: Readonly<Record<Tier, number>> = { standard: 0, rite: 0, underdog: 10, signature: 20 };
const COMPASS: readonly Compass[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const SQUARE = /^[a-h][1-8]$/;

/** FNV-1a over the move record: the same game always seeds the same fights. */
export function combatSeed(sanMoves: readonly string[], salt = ""): number {
  let hash = 0x811c9dc5;
  const text = `${salt}|${sanMoves.join(" ")}`;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const matchupKey = (attacker: Kind, defender: Kind): string => `${attacker}x${defender}`;
export const valueGap = (attacker: Kind, defender: Kind): number => PIECE_VALUE[defender] - PIECE_VALUE[attacker];

/**
 * Direction and mirroring. The open flank is the side of the attack line that
 * faces the middle of the board, so a sidestep never leaves the board; exactly
 * on the middle line the seed decides. `side` overrides it (replay).
 */
export function resolveGeometry(squares: CombatInput["geometry"], seed: number, side?: 1 | -1): Geometry | null {
  const victim = squares.victim ?? squares.to;
  if (!SQUARE.test(squares.from) || !SQUARE.test(squares.to) || !SQUARE.test(victim) || squares.from === victim) return null;
  const file = (square: string) => square.charCodeAt(0) - 97, rank = (square: string) => Number(square[1]) - 1;
  const df = file(victim) - file(squares.from), dr = rank(victim) - rank(squares.from);
  const distance = Math.hypot(df, dr);
  const heading = { file: df / distance, rank: dr / distance };
  // The attacker's right hand, looking down the attack line.
  const right = { file: heading.rank, rank: -heading.file };
  const inward = right.file * (3.5 - file(victim)) + right.rank * (3.5 - rank(victim));
  const chosen: 1 | -1 = side ?? (inward > 1e-9 ? 1 : inward < -1e-9 ? -1 : seed & 1 ? 1 : -1);
  const octant = Math.round(Math.atan2(df, dr) / (Math.PI / 4));
  const knightJump = Math.abs(df * dr) === 2;
  return {
    from: squares.from, to: squares.to, victim, heading,
    lateral: { file: right.file * chosen, rank: right.rank * chosen },
    side: chosen,
    compass: COMPASS[(octant + 8) % 8],
    line: knightJump ? "knight" : df === 0 || dr === 0 ? "orthogonal" : "diagonal",
    distance, knightJump, enPassant: victim !== squares.to,
  };
}

/** A duel-frame place as a board offset for this capture. */
export function boardPoint(point: DuelPoint, geometry: Geometry): BoardPoint {
  const along = point.along ?? 0, side = point.side ?? 0;
  return {
    ref: point.ref,
    file: along * geometry.heading.file + side * geometry.lateral.file,
    rank: along * geometry.heading.rank + side * geometry.lateral.rank,
  };
}

const shieldMatches = (wanted: When["defenderShield"], held: ShieldMaterial | null | undefined): boolean =>
  wanted === undefined || (wanted === "none" ? !held : wanted === "any" ? !!held : held === wanted);

function fits(sequence: Sequence, input: CombatInput, geometry: Geometry, gap: number): boolean {
  const f = sequence.fits, a = input.attacker, d = input.defender;
  return f.attacker.includes(a.kind) && f.defender.includes(d.kind)
    && (!f.attackerKingdom || f.attackerKingdom.includes(a.kingdom))
    && (!f.defenderKingdom || f.defenderKingdom.includes(d.kingdom))
    && (!f.identity || (!!a.identity && f.identity.includes(a.identity)))
    && (!f.style || f.style.includes(a.style ?? "melee"))
    && (f.attackerShield === undefined || f.attackerShield === !!a.shield)
    && (f.defenderShield === undefined || f.defenderShield === !!d.shield)
    && (f.defenderArmed === undefined || f.defenderArmed === (d.armed ?? true))
    && (!f.line || f.line.includes(geometry.line))
    && (f.minDistance === undefined || geometry.distance >= f.minDistance - 1e-9)
    && (f.maxDistance === undefined || geometry.distance <= f.maxDistance + 1e-9)
    && (f.enPassant === undefined || f.enPassant === geometry.enPassant)
    && (f.check === undefined || f.check === !!input.context?.check)
    && (f.minGap === undefined || gap >= f.minGap)
    && (f.maxGap === undefined || gap <= f.maxGap);
}

function resolvable(request: ClipRequest, clips: readonly string[] | undefined): boolean {
  if (!request.required || !clips) return true;
  const has = (role: string, prefer?: readonly string[]) => clips.includes(role) || !!prefer?.some(id => clips.includes(id));
  return has(request.role, request.prefer) || !!request.fallbacks?.some(item => "pose" in item || has(item.role, item.prefer));
}

/** Null when the fighters and stage can perform it, else what is missing. */
export function unplayable(sequence: Sequence, input: Pick<CombatInput, "attacker" | "defender" | "context">): string | null {
  for (const actor of ["attacker", "defender"] as const) {
    const clips = input[actor].clips;
    for (const id of sequence.requires?.[actor] ?? []) if (!clips?.includes(id)) return `${actor} lacks ${id}`;
    for (const cue of sequence.tracks[actor]) if (cue.do === "clip" && !resolvable(cue.clip, clips)) return `${actor} lacks ${cue.clip.role}`;
  }
  for (const ability of sequence.requires?.stage ?? []) if (!input.context?.stage?.includes(ability)) return `stage lacks ${ability}`;
  return null;
}

function choose(candidates: readonly Sequence[], input: CombatInput): Sequence {
  const priority = (sequence: Sequence) => sequence.priority ?? TIER_PRIORITY[sequence.tier];
  const top = Math.max(...candidates.map(priority));
  let pool = candidates.filter(sequence => priority(sequence) === top);
  // Never the variation this matchup, or this very piece, performed last time.
  const history = input.context?.history ?? [];
  const matchup = matchupKey(input.attacker.kind, input.defender.kind), piece = input.attacker.id;
  const sameMatchup = history.filter(entry => entry.matchup === matchup);
  const samePiece = piece ? history.filter(entry => entry.attacker === piece) : [];
  // Indexed rather than `.at()`: the Quest build's lib is older than ES2022.
  const banned = new Set([sameMatchup[sameMatchup.length - 1]?.family, samePiece[samePiece.length - 1]?.family].filter((family): family is string => !!family));
  const fresh = pool.filter(sequence => !banned.has(familyOf(sequence)));
  if (fresh.length) pool = fresh;
  // ...and lean away from the one before that.
  const stale = sameMatchup[sameMatchup.length - 2]?.family;
  const weights = pool.map(sequence => sequence.weight * (familyOf(sequence) === stale ? 0.4 : 1));
  let roll = mulberry32(input.seed)() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < pool.length; i += 1) { roll -= weights[i]; if (roll < 0) return pool[i]; }
  return pool[pool.length - 1];
}

function recordOf(sequence: Sequence, geometry: Geometry, seed: number): { record: string; choreography?: CombatSequence } {
  if (sequence.performance) {
    const choreography: CombatSequence = { version: 1, library: COMBAT_LIBRARY_VERSION, ...sequence.performance };
    return { record: sequence.animationLibrary === "crownfall-pawn-combat-2"
      ? encodeCombatRecord({ sequence: sequence.id, side: geometry.side, seed }) : combatComment(choreography), choreography };
  }
  return { record: encodeCombatRecord({ sequence: sequence.id, side: geometry.side, seed }) };
}

function resolve(sequence: Sequence, input: CombatInput, found: Geometry, gap: number): CombatPlan {
  // A sequence staged round the shield arm names its own open flank.
  const geometry = sequence.openSide ? resolveGeometry(input.geometry, input.seed, sequence.openSide === "attackerRight" ? 1 : -1) ?? found : found;
  const speed = Math.min(LIMITS.maxSpeed, Math.max(LIMITS.minSpeed, input.context?.speed ?? 1));
  const timeScale = Math.max(1 / speed, LIMITS.minSeconds / sequence.budget.seconds);
  const length = sequence.budget.seconds * timeScale;
  const detail = input.context?.detail !== false && speed <= 2;
  const keep = (cue: { when?: When }) => !cue.when || (
    shieldMatches(cue.when.defenderShield, input.defender.shield) && shieldMatches(cue.when.attackerShield, input.attacker.shield)
    && (!cue.when.detail || detail));
  const time = (moment: At) => seconds(sequence, moment) * timeScale;
  const scaled = (value: number | undefined) => value === undefined ? undefined : value * timeScale;
  const place = (point: DuelPoint) => boardPoint(point, geometry);
  const locus = (where: Locus<DuelPoint>): Locus<BoardPoint> => "actor" in where ? where : { point: place(where.point) };
  const strip = <T extends object>(value: T): T => {
    for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
    return value;
  };
  const actor = (cues: readonly Cue<ActorAction<DuelPoint, At>>[]): Planned<ActorAction<BoardPoint, number>>[] =>
    cues.filter(keep).map((cue): Planned<ActorAction<BoardPoint, number>> => {
      const when = time(cue.at);
      if (cue.do === "clip") return strip({ at: when, do: "clip", clip: cue.clip, sync: cue.sync && { events: cue.sync.events, to: time(cue.sync.to) }, via: cue.via && strip({ event: cue.via.event, to: time(cue.via.to), follow: cue.via.follow, resume: time(cue.via.resume), crawl: cue.via.crawl }), rate: cue.rate, fade: scaled(cue.fade) });
      if (cue.do === "pose") return strip({ at: when, do: "pose", pose: cue.pose, strength: cue.strength, hold: scaled(cue.hold), toward: cue.toward && locus(cue.toward), drive: cue.drive });
      if (cue.do === "move") return strip({ at: when, do: "move", to: place(cue.to), duration: cue.duration * timeScale, gait: cue.gait, arc: cue.arc });
      return strip({ at: when, do: "face", toward: locus(cue.toward), duration: scaled(cue.duration) });
    }).sort((a, b) => a.at - b.at);
  const markers = Object.fromEntries(MARKERS.map(marker => [marker, sequence.markers[marker] * timeScale])) as Record<Marker, number>;
  const power = Math.min(2, sequence.resolution.power * (gap >= DISBELIEF_GAP ? 1.35 : gap >= UNDERDOG_GAP ? 1.15 : 1));
  return strip({
    kind: "sequence" as const, animationLibrary: sequence.animationLibrary ?? COMBAT_LIBRARY_VERSION,
    version: CHOREOGRAPHY_VERSION,
    sequenceId: sequence.id, family: familyOf(sequence), tier: sequence.tier,
    ...recordOf(sequence, geometry, input.seed),
    seed: input.seed >>> 0,
    geometry, timeScale, seconds: length,
    cap: Math.max(length, Math.min(LIMITS.hardCapSeconds, sequence.budget.max * timeScale)),
    markers,
    attacker: actor(sequence.tracks.attacker),
    defender: actor(sequence.tracks.defender),
    camera: sequence.tracks.camera.filter(keep).map(cue => strip({ at: time(cue.at), framing: cue.framing, fov: cue.fov, duration: cue.duration * timeScale })).sort((a, b) => a.at - b.at),
    effects: sequence.tracks.effects.filter(keep).map(cue => strip({ at: time(cue.at), fx: cue.fx, where: locus(cue.where), target: cue.target && locus(cue.target), strength: cue.strength, duration: scaled(cue.duration), id: cue.id })).sort((a, b) => a.at - b.at),
    audio: sequence.tracks.audio.filter(keep).map(cue => strip({ at: time(cue.at), cue: cue.cue, volume: cue.volume, from: cue.from })).sort((a, b) => a.at - b.at),
    contacts: (sequence.contacts ?? []).filter(keep).map(cue => strip({ at: time(cue.at), id: cue.id, from: cue.from, to: cue.to, lead: scaled(cue.lead), hold: scaled(cue.hold), weight: cue.weight })).sort((a, b) => a.at - b.at),
    resolution: sequence.resolution,
    power,
  });
}

/** Retained tuples have v1 semantics. Current mixed/new rigs select the same
 * qualified v1 catalog; an old bp v2 bake is never claimed for its new body. */
function pawnCatalog(input: Pick<CombatInput, "attacker" | "defender">, catalog: readonly Sequence[], forceV1 = false): readonly Sequence[] {
  if (catalog !== CATALOG) return catalog;
  const bothV2 = [input.attacker, input.defender].every(actor => actor.clips?.includes("attack.jab") && actor.clips?.includes("ready.guard"));
  if (!forceV1 && (input.attacker.kind !== "p" || input.defender.kind !== "p" || bothV2 || !input.attacker.clips || !input.defender.clips)) return catalog;
  const retained = new Map(PAWN_V1_SEQUENCES.filter(item => item.tier === "standard").map(item => [item.id, item]));
  return catalog.map(item => retained.get(item.id) ?? item);
}

/** The fight for a capture, or "fallback" for today's cinematic. Checkmate is
 * not a capture and never comes here: the engine's CheckmatePresentation owns it. */
export function directCombat(input: CombatInput, catalog: readonly Sequence[] = CATALOG): CombatDirection {
  if (input.defender.kind === "k") return fallback("a king is never captured");
  if (input.attacker.side === input.defender.side) return fallback("no fight within one army");
  const geometry = resolveGeometry(input.geometry, input.seed);
  if (!geometry) return fallback("bad squares");
  const gap = input.context?.valueGap ?? valueGap(input.attacker.kind, input.defender.kind);
  const fitting = pawnCatalog(input, catalog).filter(sequence => fits(sequence, input, geometry, gap));
  if (!fitting.length) return fallback("no sequence fits");
  const playable = fitting.filter(sequence => !unplayable(sequence, input));
  if (!playable.length) return fallback(`clips missing: ${unplayable(fitting[0], input)}`);
  return resolve(choose(playable, input), input, geometry, gap);
}

/**
 * The fight a replay recorded. Reads both tokens: the Pawn foundation's
 * version 1 (its tuple names the sequence; flank and seed come from the move,
 * as they did live) and the director's version 2. An unknown or unplayable
 * record is a fallback, never an error: old and new builds replay each other.
 */
export function planFromRecord(comment: string | null | undefined, input: CombatInput, catalog: readonly Sequence[] = CATALOG): CombatDirection {
  const record = combatRecordFromComment(comment);
  const tuple = record ? undefined : combatSequenceFromComment(comment ?? "");
  const selected = pawnCatalog(input, catalog, !!tuple);
  const sequence = record ? selected.find(item => item.id === record.sequence)
    : tuple ? selected.find(item => item.performance?.attack === tuple.attack && item.performance.defense === tuple.defense
      && item.performance.hit === tuple.hit && item.performance.death === tuple.death) : undefined;
  if (!sequence) return fallback(record || tuple ? "unknown recorded sequence" : "no record");
  if (input.defender.kind === "k") return fallback("record does not match the move");
  const seed = record ? record.seed : input.seed;
  const geometry = resolveGeometry(input.geometry, seed, record?.side);
  if (!geometry) return fallback("bad squares");
  const missing = unplayable(sequence, input);
  if (missing) return fallback(`clips missing: ${missing}`);
  return resolve(sequence, { ...input, seed }, geometry, input.context?.valueGap ?? valueGap(input.attacker.kind, input.defender.kind));
}

/** The memory after this fight: pass it back as `context.history` next time.
 * On undo, drop the entries of the moves taken back. */
export function rememberCombat(history: readonly CombatMemory[], input: Pick<CombatInput, "attacker" | "defender">, plan: CombatDirection, limit = 8): CombatMemory[] {
  if (plan.kind !== "sequence") return history.slice();
  const entry: CombatMemory = { family: plan.family, matchup: matchupKey(input.attacker.kind, input.defender.kind) };
  if (input.attacker.id) entry.attacker = input.attacker.id;
  return [...history, entry].slice(-limit);
}
