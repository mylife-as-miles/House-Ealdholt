/**
 * Cinematic replays: what a recorded match carries so its replay shows every move as the live game did, and the
 * history a replay rebuilds at any ply. Chess decided what happened; this keeps how it was shown.
 *
 * A match record is its legal PGN. Beside the Combat Director's per-move tokens (`[%cfcombat ...]`, the duel's
 * choreography), it carries two headers:
 *
 *  - `CFSeed`, the match's own seed (8 hex digits). Every choice that used to be a coin toss at show time (whether a
 *    doomed piece wakes and the words it says, the King's line in check, the mated King's last words, the whisper
 *    that opens the game, the pitch and beat of a death cry, a slash's tilt, a volley's spread, a footfall's pitch) is
 *    drawn from it, the moves so far and what is being chosen ({@link showSeed}). The live game and its replay draw
 *    the very same. The choices the engine already seeded from the move list (the duel, the spell drawn, the summon,
 *    the fatality, the sever, the blood, the burns) stay as they were.
 *  - `CFArmies`, the kingdom each side fielded ("ivory sun"): skins, arsenals, spells and summons follow from it.
 *
 * The pieces' own lines (the barks of web/src/scene/boardVoices.ts) depend on a memory that runs across games and on
 * the floor being free at the moment, so they are not drawn again: each line that sounded is recorded in its move's
 * comment as `[%cfvoice <clip> <moment> <square> <seconds>]` ({@link encodeVoiceLine}), the opening murmurs on the
 * opening position's, and a replay says exactly those, at their moments.
 *
 * Everything else a capture's show depends on is the history before it, and is read from the ledger at that ply
 * rather than kept by the engine as it goes: whether a piece has died yet (the first to die always pleads), the run
 * of checks, how many bodies have been claimed (the first claim is watched), the spell each kingdom cast last, the
 * pieces in the trays. So a replay seeked to any ply plays on from there as the game did.
 *
 * Older records carry neither header and still read: they replay plainly (see {@link replayProvenance}).
 *
 * Pure (chess.js only): shared/play/replay-show.test.ts.
 */
import { Chess, type Move } from "chess.js";
import type { ShowcaseRecord } from "../showcase/types";
import type { EndReason, Faction, GameMode, GameResult, PieceKind } from "../../web/src/core/types";
import type { ArmyId, MatchArmies } from "./match";

export const SHOW_SEED_HEADER = "CFSeed";
export const SHOW_ARMIES_HEADER = "CFArmies";
const ARMY_IDS: readonly ArmyId[] = ["ivory", "sun", "empire", "kwind"];
const KINGDOM_NAMES: Readonly<Record<ArmyId, string>> = { ivory: "Aethelgard", sun: "Solforiz", empire: "Korvenia", kwind: "Kwind-09" };
const END_REASONS: readonly EndReason[] = ["checkmate", "stalemate", "resignation", "timeout", "threefold", "insufficient", "fiftymove", "objective", "draw"];

// ------------------------------------------------------------------ headers

export function encodeShowSeed(seed: number): string {
  return (seed >>> 0).toString(16).padStart(8, "0");
}

/** The seed a `CFSeed` header holds, or null for anything else (an older record, a hand-edited one). */
export function decodeShowSeed(value: unknown): number | null {
  return typeof value === "string" && /^[0-9a-f]{8}$/.test(value) ? parseInt(value, 16) >>> 0 : null;
}

/** A fresh seed for a new match: from the platform's crypto source where there is one. */
export function newShowSeed(): number {
  const crypto = (globalThis as { crypto?: { getRandomValues?(array: Uint32Array): Uint32Array } }).crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export function encodeArmies(armies: Readonly<MatchArmies>): string {
  return `${armies.w} ${armies.b}`;
}

/** The armies a `CFArmies` header names, or null when it is missing or names anything but two kingdoms. */
export function decodeArmies(value: unknown): MatchArmies | null {
  if (typeof value !== "string") return null;
  const [w, b, rest] = value.trim().split(/\s+/);
  if (rest !== undefined || !ARMY_IDS.includes(w as ArmyId) || !ARMY_IDS.includes(b as ArmyId)) return null;
  return { w: w as ArmyId, b: b as ArmyId };
}

// ------------------------------------------------------------------ seeds

/**
 * The seed for one choice of one ply: FNV-1a over the match's seed, what is chosen, and the moves so far. The same
 * match, the same moves and the same choice always give the same seed; another match gives another.
 */
export function showSeed(matchSeed: number, sanMoves: readonly string[], salt: string): number {
  let hash = 0x811c9dc5;
  const text = `${encodeShowSeed(matchSeed)}|${salt}|${sanMoves.join(" ")}`;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

/** A repeatable stream of numbers in [0, 1) (mulberry32). */
export function showRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs `choose` with `Math.random` drawing from `seed`'s stream, and puts `Math.random` back afterwards, however
 * `choose` ends. For synchronous choices only: nothing else runs while it holds the stream.
 *
 * This is the seam the engine uses for the mixer's spoken lines (web/src/audio/audioManager.ts draws them with
 * Math.random, by rules in shared/play/gambit-sound.ts): a line chosen under it is the same line in the live game
 * and its replay, without the mixer knowing about replays at all.
 */
export function withSeededRandom<T>(seed: number, choose: () => T): T {
  const original = Math.random;
  Math.random = showRandom(seed);
  try { return choose(); }
  finally { Math.random = original; }
}

// ------------------------------------------------------------------ spoken lines

/** When a recorded line was said: as its piece was lifted, as it (or a castling's rook, or a promoted piece) landed,
 * into the silence after the move, or as the game began. */
export type VoiceMoment = "lift" | "land" | "rook" | "promoted" | "idle" | "murmur";
const VOICE_MOMENTS: readonly VoiceMoment[] = ["lift", "land", "rook", "promoted", "idle", "murmur"];

/** One line a piece said, as the record keeps it. */
export interface RecordedVoiceLine {
  clip: string;
  moment: VoiceMoment;
  /** The square its speaker stood on as it spoke (null when it is named by its voice alone). */
  square: string | null;
  /** Seconds after its moment: the wait for the floor; after the bell for a murmur, after the move settled for a line into silence. */
  offset: number;
}

const VOICE_TOKEN = /\[%cfvoice ([a-z0-9]+(?:_[a-z0-9]+)+) (lift|land|rook|promoted|idle|murmur) ([a-h][1-8]|-) (\d{1,4}(?:\.\d{1,2})?)\]/g;

export function encodeVoiceLine(line: RecordedVoiceLine): string {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(line.clip) || !VOICE_MOMENTS.includes(line.moment)) throw new Error("Unrecordable voice line");
  const offset = Math.max(0, Math.min(9999, Math.round(line.offset * 100) / 100));
  return `[%cfvoice ${line.clip} ${line.moment} ${line.square && /^[a-h][1-8]$/.test(line.square) ? line.square : "-"} ${offset}]`;
}

/** The lines a comment records, in the order they were said. */
export function voiceLinesFromComment(comment: string | null | undefined): RecordedVoiceLine[] {
  if (typeof comment !== "string") return [];
  return [...comment.matchAll(VOICE_TOKEN)].map(match => ({
    clip: match[1], moment: match[2] as VoiceMoment, square: match[3] === "-" ? null : match[3], offset: Number(match[4]),
  }));
}

/** A comment without its recorded lines (a move taken back and played again says its own). */
export function withoutVoiceLines(comment: string | null | undefined): string {
  return (comment ?? "").replace(/\s*\[%cfvoice [^\]]*\]/g, "").trim();
}

/**
 * The square each footsoldier on the board started the game on, by the square it stands on after the PGN's moves: a
 * footsoldier keeps the voice its starting file gave it (gambit-sound.ts pawnSlot), however the board got here.
 */
export function pawnOrigins(pgn: string): Map<string, string> {
  const game = new Chess();
  try { game.loadPgn(pgn); } catch { return new Map(); }
  const history = game.history({ verbose: true });
  const start = new Chess(history[0]?.before ?? game.fen());
  const origins = new Map<string, string>();
  for (const row of start.board()) for (const piece of row) if (piece?.type === "p") origins.set(piece.square, piece.square);
  for (const move of history) {
    origins.delete(move.flags.includes("e") ? `${move.to[0]}${move.from[1]}` : move.to);
    const origin = origins.get(move.from);
    origins.delete(move.from);
    if (move.piece === "p" && origin && !move.promotion) origins.set(move.to, origin);
  }
  return origins;
}

// ------------------------------------------------------------------ history at a ply

/** What the history needs of one played move (the controller's LedgerMove satisfies it). */
export interface HistoryMove {
  color: Faction;
  kind: PieceKind;
  san: string;
  to: string;
  capture: boolean;
  /** The kind taken, where the move took one. */
  captured?: PieceKind | null;
}

/** Captures among the moves before `index` (0-based): 0 means the capture at `index` is the game's first death. */
export function capturesBefore(moves: readonly Pick<HistoryMove, "capture">[], index: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(index, moves.length); i += 1) if (moves[i].capture) count += 1;
  return count;
}

/** How many checks in a row end at the move at `index`, that one counted; 0 when it gives none. */
export function checkRunAt(moves: readonly Pick<HistoryMove, "san">[], index: number): number {
  let run = 0;
  for (let i = Math.min(index, moves.length - 1); i >= 0 && /[+#]/.test(moves[i].san); i -= 1) run += 1;
  return run;
}

/** The pieces taken by the first `ply` moves, oldest first: what the trays hold at that ply. */
export function takenThrough(moves: readonly Pick<HistoryMove, "color" | "captured" | "capture">[], ply: number): { kind: PieceKind; color: Faction }[] {
  const taken: { kind: PieceKind; color: Faction }[] = [];
  for (let i = 0; i < Math.min(ply, moves.length); i += 1) {
    const move = moves[i];
    if (move.capture && move.captured) taken.push({ kind: move.captured, color: move.color === "w" ? "b" : "w" });
  }
  return taken;
}

/** How the engine draws a library spell, given to {@link lastSpellBefore} so the history is walked by its own rules. */
export interface SpellHistoryRules<Spell extends string> {
  /** The army a side fields. */
  army(color: Faction): string;
  /** Whether this capture is cast with a spell from the page (a caster that does not summon instead). */
  casts(move: HistoryMove): boolean;
  /** The spell the cast at `index` draws, given the one its kingdom cast last. */
  draw(move: HistoryMove, index: number, last: Spell | null): Spell | null;
}

/**
 * The spell `army` cast last before the move at `index`, walked from the start of the game by the engine's own
 * rules: a kingdom does not cast the same spell twice running while its page offers another, and that memory is the
 * history's, so a replay seeked to any ply, and the live game after an Undo, draw what the game drew.
 */
export function lastSpellBefore<Spell extends string>(moves: readonly HistoryMove[], index: number, army: string, rules: SpellHistoryRules<Spell>): Spell | null {
  const last = new Map<string, Spell>();
  for (let i = 0; i < Math.min(index, moves.length); i += 1) {
    const move = moves[i];
    if (!move.capture || !rules.casts(move)) continue;
    const kingdom = rules.army(move.color);
    const drawn = rules.draw(move, i, last.get(kingdom) ?? null);
    if (drawn) last.set(kingdom, drawn);
  }
  return last.get(army) ?? null;
}

// ------------------------------------------------------------------ the script a replay plays

export interface ReplayScriptMove {
  from: string;
  to: string;
  promotion?: PieceKind;
  /** The move's PGN comment as recorded: the Combat Director's token rides in it. */
  comment: string | null;
  san: string;
  capture: boolean;
}

/** How faithfully a record can be shown: `exact` replays every capture as it was shown; `plain` cannot. */
export type ReplayFidelity = "exact" | "plain";

export interface ReplayScript {
  initialFen: string;
  /** The opening position's comment: the murmurs said as the game began. */
  openingComment: string | null;
  moves: readonly ReplayScriptMove[];
  /** The match's seed, when the record carries one. */
  seed: number | null;
  armies: MatchArmies;
  /** True when the record names its kingdoms (or names them by its players' titles). */
  armiesRecorded: boolean;
  /** The board's verdict at the end of the record, or the recorded claim (resignation, time) when the board has none. */
  result: GameResult | null;
  /** The controller mode the match was played in: a duel swings the view between turns, a Classic game does not. */
  mode: GameMode;
  /** The side the player held in a Classic game (the closing cue is a victory or a loss for them). */
  playerColor: Faction;
  fidelity: ReplayFidelity;
}

const MODES: Readonly<Record<NonNullable<ShowcaseRecord["match"]>["mode"], GameMode>> = {
  classic: "ai", "local-duel": "hotseat", "ai-battle": "demo", chapters: "campaign", "online-duel": "hotseat",
};

/** A kingdom named in an AI Battle's player titles ("Computer Korvenia"). */
function kingdomIn(title: string): ArmyId | null {
  return ARMY_IDS.find(id => title.endsWith(KINGDOM_NAMES[id])) ?? null;
}

/**
 * The armies of a record: its `CFArmies` header; else, for an AI Battle, the kingdoms its titles name; else the
 * defaults every older match was played with unless a kingdom was picked (Aethelgard against Solforiz). `recorded`
 * says which it is, so the viewer can say so.
 */
export function recordArmies(headers: Readonly<Record<string, string>>, mode?: string): { armies: MatchArmies; recorded: boolean } {
  const named = decodeArmies(headers[SHOW_ARMIES_HEADER]);
  if (named) return { armies: named, recorded: true };
  if (mode === "ai-battle") {
    const w = kingdomIn(headers.White ?? ""), b = kingdomIn(headers.Black ?? "");
    if (w && b && w !== b) return { armies: { w, b }, recorded: true };
  }
  return { armies: { w: "ivory", b: "sun" }, recorded: false };
}

/** The moves of a PGN with each one's own comment (chess.js keeps comments by the position they follow). */
function movesWithComments(pgn: string): { history: Move[]; comments: (string | null)[]; opening: string | null; headers: Record<string, string> } {
  const game = new Chess();
  game.loadPgn(pgn, { strict: true });
  const byFen = new Map(game.getComments().map(item => [item.fen, item.comment]));
  const history = game.history({ verbose: true });
  return { history, comments: history.map(move => byFen.get(move.after) ?? null), opening: byFen.get(history[0]?.before ?? game.fen()) ?? null, headers: game.getHeaders() };
}

/**
 * The script a cinematic replay plays, from a validated match record (shared/showcase/records.ts has already refused
 * an illegal or contradictory one). Null for a record that is not a match.
 */
export function replayScriptOf(record: ShowcaseRecord): ReplayScript | null {
  const match = record.match;
  if (!match) return null;
  const { history, comments, opening, headers } = movesWithComments(record.pgn);
  const seed = decodeShowSeed(headers[SHOW_SEED_HEADER]);
  const { armies, recorded } = recordArmies(headers, match.mode);
  const end = new Chess(record.initialFen);
  for (const move of history) end.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
  const winner: Faction | null = record.result === "1-0" ? "w" : record.result === "0-1" ? "b" : null;
  const claimed = END_REASONS.find(reason => reason === headers.Termination);
  const reason: EndReason | null = end.isCheckmate() ? "checkmate" : end.isStalemate() ? "stalemate" : end.isThreefoldRepetition() ? "threefold"
    : end.isInsufficientMaterial() ? "insufficient" : end.isDrawByFiftyMoves() ? "fiftymove" : claimed ?? null;
  const result: GameResult | null = record.result === "*" || !reason ? null : { winner, reason };
  const playerColor: Faction = match.mode === "classic" && headers.Black === "You" ? "b" : "w";
  return {
    initialFen: record.initialFen,
    openingComment: opening,
    moves: history.map((move, index) => ({
      from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion as PieceKind } : {}),
      comment: comments[index], san: move.san, capture: move.flags.includes("c") || move.flags.includes("e"),
    })),
    seed, armies, armiesRecorded: recorded, result, mode: MODES[match.mode], playerColor,
    fidelity: seed === null ? "plain" : "exact",
  };
}

/** Whether a recorded move carries a fight the Combat Director recorded (its own choreography, kept in the record). */
export function hasRecordedFight(move: Pick<ReplayScriptMove, "comment">): boolean {
  return !!move.comment && /\[%cfcombat\s/.test(move.comment);
}

/**
 * What the viewer is told about how faithful the replay is. An exact record says nothing. An older one (no seed)
 * plays its captures plainly, but for the duels whose choreography it recorded, and says so; a record that does not
 * name its kingdoms says which it shows.
 */
export function replayNotes(script: Pick<ReplayScript, "fidelity" | "armiesRecorded" | "armies" | "moves">): string[] {
  const notes: string[] = [];
  if (script.fidelity === "plain") {
    notes.push(script.moves.some(hasRecordedFight)
      ? "Recorded before battles were kept: captures are shown plainly, and only the duels it recorded play their original choreography."
      : "Recorded before battles were kept: captures are shown plainly.");
  }
  if (!script.armiesRecorded) notes.push(`Kingdoms were not recorded: shown as ${KINGDOM_NAMES[script.armies.w]} and ${KINGDOM_NAMES[script.armies.b]}.`);
  return notes;
}

/**
 * Where "battles only" goes next from `ply`: the next move that is a capture, or the last move (the ending is always
 * shown). Moves before it are jumped. Null at the end.
 */
export function nextBattle(moves: readonly Pick<ReplayScriptMove, "capture">[], ply: number): number | null {
  for (let i = Math.max(0, ply); i < moves.length; i += 1) if (moves[i].capture || i === moves.length - 1) return i;
  return null;
}
