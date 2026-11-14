/**
 * The pieces' barks, as rules. Every piece on the board is a person held in a trance and moved by an unseen hand, and
 * it says so: who moved me, where am I, it's coming for me, they were right beside me, what have my hands done.
 *
 * - moveFacts reads what a move did to the pieces: where the mover went and how (a leap, an advance, a retreat),
 *   whether it now stands where it can be taken, whether it got out of reach, which enemy pieces it put in reach,
 *   whose comrade fell, who stood beside them and who the fallen was to each (witnessKind), whether the mover has
 *   just taken its comrade's killer, whether it stands by the enemy king or where a comrade just died.
 * - planBarks says which piece speaks about it, about what, and at which moment of the move (as the hand lifts it,
 *   as it lands, as the castling rook lands, as a promoted piece is remade). At most one piece a move, but for the
 *   king and rook of a castling and the two voices of a promotion. Its chances come from the match seed (the move
 *   list, as the Combat Director's), so the same game says the same things.
 * - nextBark and takeBark give the line: a shuffle bag per voice and per event, kept across games so a rematch does not
 *   open with the same words, and never the same line twice running.
 * - barkMaySound keeps the floor: a bark never starts over a plea, a death cry, a whisper of the fallen or a king's line
 *   (nor over another bark, nor too soon after one), and anything with words that starts while a bark plays cuts it.
 *
 * No audio here: the scene's adapter (web/src/scene/boardVoices.ts) asks these rules, and the mixer plays the clips
 * (barkClips in ./gambit-sound.ts). The menu's background board stays silent: the adapter never asks.
 */
import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import {
  barkClips, peekBag, takeFromBag, type BarkEvent, type GambitKingdom, type GambitRank, type GambitSide, type Random, type ShuffleBag,
  type WitnessKind,
} from "./gambit-sound";

/** What a piece is worth to whoever might take it; the king is never taken (his danger is check). */
const WORTH: Readonly<Record<GambitRank, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

/** A comrade's death square is a grave for this many plies (three moves a side). */
export const GRAVE_PLIES = 6;
/** Taking the piece that killed a comrade avenges it, within this many plies of the killing. */
export const AVENGE_PLIES = 4;
/** Two pieces that have stood side by side this many plies have fought beside each other: companions. */
export const COMPANION_PLIES = 6;

export interface PieceAt {
  square: string;
  rank: GambitRank;
  side: GambitSide;
}

/** A comrade who saw the piece fall, and who the fallen was to it. */
export interface Witness extends PieceAt {
  kind: WitnessKind;
}

/** Which way a piece went: toward the enemy's back rank, back toward its own, or along its rank. */
export type Direction = "advance" | "retreat" | "level";

/** What a move did to the pieces on the board. */
export interface MoveFacts {
  side: GambitSide;
  rank: GambitRank;
  from: string;
  to: string;
  direction: Direction;
  /** A knight's move: it leaps. */
  leap: boolean;
  /** The piece that fell, where it stood (en passant: not the square the mover took). */
  capture: PieceAt | null;
  castle: { rookFrom: string; rookTo: string } | null;
  promotion: GambitRank | null;
  check: boolean;
  /** The mover now stands where it can be taken for less than it is worth, or for nothing. */
  intoDanger: boolean;
  /** The mover stood in such danger before the move and does not now; the king walked out of check. */
  escaped: boolean;
  /** Enemy pieces this move put in such danger, the most valuable first (the king's danger is check). */
  threatened: PieceAt[];
  /** The fallen piece's comrades on the squares round where it fell, the most valuable first (no king). */
  witnesses: Witness[];
  /** The fallen piece had killed one of the mover's comrades within AVENGE_PLIES plies. */
  avenged: boolean;
  /** The mover stands on a square beside the enemy king. */
  besideKing: boolean;
  /** The mover stands where one of its comrades died within the last GRAVE_PLIES plies. */
  grave: boolean;
}

const sideOf = (color: Color): GambitSide => color;
const enemyOf = (side: GambitSide): GambitSide => (side === "w" ? "b" : "w");
const fileOf = (square: string) => square.charCodeAt(0) - 97;
const rankOf = (square: string) => Number(square[1]);
const distance = (a: string, b: string) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

/** True when the piece on `square` can be taken for less than it is worth, or for nothing. */
export function inDanger(game: Chess, square: string): boolean {
  const piece = game.get(square as Square);
  if (!piece || piece.type === "k") return false;
  const attackers = game.attackers(square as Square, enemyOf(sideOf(piece.color)));
  if (attackers.length === 0) return false;
  if (game.attackers(square as Square, piece.color).length === 0) return true;
  const cheapest = Math.min(...attackers.map((at) => WORTH[(game.get(at)?.type ?? "k") as GambitRank]));
  return cheapest < WORTH[piece.type as GambitRank];
}

function kingSquare(game: Chess, side: GambitSide): string | null {
  for (const row of game.board()) for (const cell of row) if (cell?.type === "k" && cell.color === side) return cell.square;
  return null;
}

/** Where the piece a move took had stood: the square it went to, or beside it for en passant. */
function fallenSquare(move: Pick<Move, "from" | "to" | "flags">): string {
  return move.flags.includes("e") ? `${move.to[0]}${move.from[1]}` : move.to;
}

/**
 * What one move did, from the position before it. `recent` is the moves before it, oldest first (for the graves of
 * the last GRAVE_PLIES plies). Null for a move that is not legal there.
 */
/** The moves before this one, oldest first, as chess.js gives them (verbose, each with the position before it). */
export type MoveHistory = readonly Pick<Move, "from" | "to" | "flags" | "color" | "captured" | "piece" | "before">[];

/**
 * Who a fallen piece was to a comrade who saw it fall, as the board's own history tells it: royal for the Queen or the
 * King's last guard, veteran for a piece that had killed this game, companion for one that stood beside this comrade
 * for the last COMPANION_PLIES plies, stranger otherwise. (A richer memory of the battle can replace this: planBarks
 * takes a witnessKind of its own.)
 */
export function witnessKind(before: Chess, after: Chess, fallen: PieceAt, witness: PieceAt, history: MoveHistory): WitnessKind {
  if (fallen.rank === "q") return "royal";
  const king = kingSquare(before, fallen.side);
  if (king && distance(king, fallen.square) === 1) {
    const guards = after.board().flat().filter((cell) => cell && cell.color === fallen.side && cell.type !== "k" && distance(cell.square, king) === 1);
    if (guards.length === 0) return "royal";
  }
  // Follow the fallen piece back along its own moves: did it kill on the way?
  let square = fallen.square;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const move = history[i];
    if (move.to !== square || move.color !== fallen.side) continue;
    if (move.captured) return "veteran";
    square = move.from;
  }
  const then = history.length >= COMPANION_PLIES ? history[history.length - COMPANION_PLIES].before : history[0]?.before;
  if (then) {
    const old = new Chess(then);
    const stood = (at: PieceAt) => { const cell = old.get(at.square as Square); return !!cell && cell.type === at.rank && cell.color === at.side; };
    if (stood(fallen) && stood(witness)) return "companion";
  }
  return "stranger";
}

export function moveFacts(fenBefore: string, move: { from: string; to: string; promotion?: string }, recent: MoveHistory = []): MoveFacts | null {
  const before = new Chess(fenBefore);
  const after = new Chess(fenBefore);
  let played: Move;
  try {
    played = after.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
  } catch {
    return null;
  }
  const side = sideOf(played.color);
  const enemy = enemyOf(side);
  const rank = played.piece as GambitRank;
  const forward = side === "w" ? 1 : -1;
  const rise = (rankOf(played.to) - rankOf(played.from)) * forward;
  const capture: PieceAt | null = played.captured ? { square: fallenSquare(played), rank: played.captured as GambitRank, side: enemy } : null;
  const castle = played.flags.includes("k") || played.flags.includes("q")
    ? { rookFrom: `${played.flags.includes("k") ? "h" : "a"}${played.from[1]}`, rookTo: `${played.flags.includes("k") ? "f" : "d"}${played.from[1]}` }
    : null;

  const threatened: PieceAt[] = [];
  for (const row of after.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.type === "k") continue;
      if (inDanger(after, cell.square) && !inDanger(before, cell.square)) threatened.push({ square: cell.square, rank: cell.type as GambitRank, side: enemy });
    }
  }
  threatened.sort((a, b) => WORTH[b.rank] - WORTH[a.rank] || a.square.localeCompare(b.square));

  const witnesses: Witness[] = [];
  if (capture) {
    for (const row of after.board()) {
      for (const cell of row) {
        if (!cell || cell.color !== enemy || cell.type === "k" || distance(cell.square, capture.square) !== 1) continue;
        const seen: PieceAt = { square: cell.square, rank: cell.type as GambitRank, side: enemy };
        witnesses.push({ ...seen, kind: witnessKind(before, after, capture, seen, recent) });
      }
    }
    witnesses.sort((a, b) => WORTH[b.rank] - WORTH[a.rank] || a.square.localeCompare(b.square));
  }
  // The fallen piece killed one of ours lately: follow it from where it killed to where it fell.
  let avenged = false;
  if (capture) {
    const lately = recent.slice(-AVENGE_PLIES);
    lately.forEach((kill, i) => {
      if (kill.color !== enemy || !kill.captured) return;
      let at: string | null = kill.to;
      for (const next of lately.slice(i + 1)) {
        if (next.color === enemy && next.from === at) at = next.to;
        else if (next.color !== enemy && fallenSquare(next) === at && next.captured) at = null;   // it fell already
        if (at === null) break;
      }
      if (at === capture.square) avenged = true;
    });
  }

  const theirKing = kingSquare(after, enemy);
  const graves = new Set(recent.slice(-GRAVE_PLIES).filter((m) => m.captured && m.color !== played.color).map((m) => fallenSquare(m)));
  return {
    side, rank, from: played.from, to: played.to,
    direction: rise > 0 ? "advance" : rise < 0 ? "retreat" : "level",
    leap: rank === "n",
    capture, castle,
    promotion: (played.promotion as GambitRank | undefined) ?? null,
    check: after.inCheck(),
    intoDanger: inDanger(after, played.to),
    escaped: rank === "k" ? before.inCheck() : inDanger(before, played.from) && !inDanger(after, played.to),
    threatened, witnesses, avenged,
    besideKing: theirKing !== null && distance(theirKing, played.to) === 1,
    grave: graves.has(played.to),
  };
}

/** The last move of a game in PGN, as moveFacts reads it (a game set up from a position keeps its [FEN] header). */
export function lastMoveFacts(pgn: string): MoveFacts | null {
  const game = new Chess();
  try {
    game.loadPgn(pgn);
  } catch {
    return null;
  }
  const history = game.history({ verbose: true }) as Move[];
  const last = history[history.length - 1];
  if (!last) return null;
  return moveFacts(last.before, { from: last.from, to: last.to, promotion: last.promotion as PieceSymbol | undefined }, history.slice(0, -1));
}

/** When in a move a bark is said. */
export type BarkMoment =
  /** As the hand lifts the piece (a step it did not choose, a footsoldier's last step before it is remade). */
  | "lift"
  /** As the mover lands (its own danger or escape, the square it took, its kill; the threatened piece answers it). */
  | "land"
  /** As the castling rook lands beside the king. */
  | "rook"
  /** As a promoted piece is remade, in its new voice. */
  | "promoted";

export interface BarkPlan {
  event: BarkEvent;
  /** Who speaks: their side, rank and the square they stand on when they do. */
  speaker: PieceAt;
  moment: BarkMoment;
  /** Seconds a capture's aftermath may wait for the death cry and the plea to end before it gives up. */
  wait?: number;
}

/**
 * How likely each event is to be said when it happens, before the floor is asked. A promotion and a castling are rare
 * and always remarked; a kill is already a plea and a cry, so its aftermath is spoken now and then; a plain step is
 * the most common thing on the board and the least often remarked.
 */
export const BARK_CHANCE: Readonly<Record<BarkEvent, number>> = {
  promote: 1, promoted: 1, castle: 0.9, avenged: 0.85, grave: 0.75, king: 0.7, killer: 0.35,
  royal: 0.9, veteran: 0.6, companion: 0.5, stranger: 0.3, danger: 0.6, threat: 0.4, escape: 0.5,
  moved: 0.22, advance: 0.22, retreat: 0.22, murmur: 1, idle: 1, despair: 1, victory: 1,
};
/** The rook answers its king in a castling this often. */
export const CASTLE_ANSWER_CHANCE = 0.8;
/** A voice that has spoken rests this many plies before it speaks again (a castling, a promotion and an escape excepted). */
export const VOICE_REST_PLIES = 8;
/** A plain step is remarked at most once in this many plies. */
export const STEP_REST_PLIES = 3;
/** A line once said is not said again for this many plies (thirty moves), so a long game does not hear it come round. */
export const LINE_REST_PLIES = 60;
/** Seconds a capture's aftermath (the killer, a witness) may wait for the death cry to end. */
export const AFTERMATH_WAIT = 2.5;

export interface BarkContext {
  /** The ply this move is (sanList.length after it). */
  ply: number;
  /** Who the fallen was to a witness, when a fuller memory of the battle knows better than witnessKind. */
  witnessKind?: (facts: MoveFacts, witness: Witness) => WitnessKind | null;
  /** Whether this capture avenges a comrade, when a fuller memory of the battle knows (it remembers every killing, not
   * only the last AVENGE_PLIES plies): null keeps the board's own answer (`facts.avenged`). */
  avenged?: (facts: MoveFacts) => boolean | null;
  /** Exhibition playback speed; a fast exhibition remarks half as often. */
  speed?: number;
  /** The voice each speaker would use, so a resting voice is passed over (the adapter knows each pawn's voice). */
  voiceOf: (piece: PieceAt) => string;
  memory: BarkMemory;
}

/** What the barks remember: when each voice and the plain steps last spoke, the bags, the last line heard. */
export interface BarkMemory {
  /** The ply each voice last spoke at. */
  spokeAt: Partial<Record<string, number>>;
  /** The ply a plain step was last remarked at. */
  steppedAt?: number;
  /** One shuffle bag per voice and event (and per kingdom for the murmurs and the long silence). */
  bags: Partial<Record<string, ShuffleBag<string>>>;
  /** The last line said, by anyone: never heard twice running. */
  last?: string;
  /** The ply each line was last said at: a line rests LINE_REST_PLIES. */
  saidAt?: Partial<Record<string, number>>;
}

export function emptyBarkMemory(): BarkMemory {
  return { spokeAt: {}, bags: {} };
}

/**
 * A new game: the plies start again, so who rested when is forgotten; the bags and the last line are kept, so a
 * rematch does not open with the same words.
 */
export function newGameBarkMemory(memory: BarkMemory): BarkMemory {
  return { spokeAt: {}, bags: memory.bags, last: memory.last, saidAt: {} };
}

/** What a plain step says, by the way it went: an advance or a retreat adds the lines that only fit it. */
export function stepEvents(direction: Direction): BarkEvent[] {
  return direction === "advance" ? ["moved", "advance"] : direction === "retreat" ? ["moved", "retreat"] : ["moved"];
}

/**
 * Who says what about a move, and when. The candidates are tried in order of how much the moment means, each with its
 * chance from `random`, and the first that is drawn speaks (with a castling's rook and a promotion's second voice).
 * A check belongs to the king's own line (the mixer's check), so only a castling or a footsoldier's last step is
 * remarked then.
 */
export function planBarks(facts: MoveFacts, random: Random, context: BarkContext): BarkPlan[] {
  const fast = (context.speed ?? 1) > 1.5 ? 0.5 : 1;
  const mover: PieceAt = { square: facts.to, rank: facts.rank, side: facts.side };
  const rested = (piece: PieceAt) => {
    const at = context.memory.spokeAt[context.voiceOf(piece)];
    return at === undefined || context.ply - at >= VOICE_REST_PLIES;
  };
  const roll = (event: BarkEvent) => random() < BARK_CHANCE[event] * (event === "promote" || event === "promoted" || event === "castle" ? 1 : fast);

  if (facts.promotion) {
    const plans: BarkPlan[] = [];
    // The footsoldier on its last step, as itself (not when it fights for the square: the plea and the cry have it),
    // then the same piece remade, in the voice of what it became.
    if (!facts.capture && roll("promote")) plans.push({ event: "promote", speaker: { square: facts.from, rank: "p", side: facts.side }, moment: "lift" });
    // A promotion that gives check: the king's line has the moment it is remade in.
    if (!facts.check && roll("promoted")) plans.push({ event: "promoted", speaker: { square: facts.to, rank: facts.promotion, side: facts.side }, moment: "promoted", wait: AFTERMATH_WAIT });
    return plans;
  }
  if (facts.castle) {
    const plans: BarkPlan[] = [];
    if (roll("castle")) {
      plans.push({ event: "castle", speaker: mover, moment: "land" });
      if (random() < CASTLE_ANSWER_CHANCE) plans.push({ event: "castle", speaker: { square: facts.castle.rookTo, rank: "r", side: facts.side }, moment: "rook", wait: AFTERMATH_WAIT });
    }
    return plans;
  }
  if (facts.check) return [];

  const candidates: { event: BarkEvent; speaker: PieceAt; moment: BarkMoment; wait?: number }[] = [];
  if (context.avenged?.(facts) ?? facts.avenged) candidates.push({ event: "avenged", speaker: mover, moment: "land", wait: AFTERMATH_WAIT });
  if (facts.grave && mover.rank !== "k") candidates.push({ event: "grave", speaker: mover, moment: "land", ...(facts.capture ? { wait: AFTERMATH_WAIT } : {}) });
  if (facts.besideKing && mover.rank !== "k") candidates.push({ event: "king", speaker: mover, moment: "land", ...(facts.capture ? { wait: AFTERMATH_WAIT } : {}) });
  if (facts.capture) {
    candidates.push({ event: "killer", speaker: mover, moment: "land", wait: AFTERMATH_WAIT });
    if (facts.witnesses.length) candidates.push({ event: "stranger", speaker: facts.witnesses[0], moment: "land", wait: AFTERMATH_WAIT });
  }
  if (facts.intoDanger) candidates.push({ event: "danger", speaker: mover, moment: "land" });
  if (facts.threatened.length) candidates.push({ event: "threat", speaker: facts.threatened[0], moment: "land" });
  if (facts.escaped) candidates.push({ event: "escape", speaker: mover, moment: "land" });
  const stepAllowed = !facts.capture && (context.memory.steppedAt === undefined || context.ply - context.memory.steppedAt >= STEP_REST_PLIES);
  if (stepAllowed) candidates.push({ event: "moved", speaker: { square: facts.from, rank: facts.rank, side: facts.side }, moment: "lift" });

  for (const candidate of candidates) {
    if (candidate.speaker === facts.witnesses[0] && facts.capture) {
      // Any comrade who stood beside the fallen and has not spoken lately may be the one who cries out; what they say
      // is who the fallen was to them, and how likely they are to say it too.
      const fresh = facts.witnesses.filter(rested);
      if (fresh.length === 0) continue;
      const seen = fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
      const kind = context.witnessKind?.(facts, seen) ?? seen.kind;
      if (!roll(kind)) continue;
      return [{ ...candidate, event: kind, speaker: seen }];
    }
    // A piece that got out of reach may say so though it spoke of the threat a move ago: the two belong together.
    if (candidate.event !== "escape" && !rested(candidate.speaker)) continue;
    if (roll(candidate.event)) return [candidate];
  }
  return [];
}

/** A plan's events as the bags know them: a plain step can be said with any of its direction's lines. */
export function planEvents(plan: BarkPlan, facts: Pick<MoveFacts, "direction" | "leap">): BarkEvent[] {
  return plan.event === "moved" && !facts.leap ? stepEvents(facts.direction) : [plan.event];
}

/**
 * The line a voice would say for these events (all their lines in one bag), without taking it; null when the voice
 * has none, when its next was the last line heard, or when it was said within LINE_REST_PLIES of `ply`.
 */
export function nextBark(voice: string, events: readonly BarkEvent[], memory: BarkMemory, random: Random, ply?: number): string | null {
  const options = events.flatMap((event) => barkClips(voice, event));
  if (options.length === 0) return null;
  const state = (memory.bags[`${voice}:${events.join("+")}`] ??= { bag: [] });
  const clip = peekBag(options, state, random);
  if (clip === memory.last) return null;
  const said = memory.saidAt?.[clip];
  return ply !== undefined && said !== undefined && ply - said < LINE_REST_PLIES ? null : clip;
}

/** The line nextBark gave has sounded: it leaves its bag, and its voice (and a plain step) rests from this ply. */
export function takeBark(voice: string, events: readonly BarkEvent[], memory: BarkMemory, ply: number): string {
  const state = memory.bags[`${voice}:${events.join("+")}`] as ShuffleBag<string>;
  const clip = takeFromBag(state);
  memory.last = clip;
  memory.spokeAt[voice] = ply;
  (memory.saidAt ??= {})[clip] = ply;
  if (events.includes("moved")) memory.steppedAt = ply;
  return clip;
}

/** Seconds after a game's bell that its two murmurs come: after "It begins again", one from each side. */
export const MURMUR_AT = [4.6, 8.6] as const;
/** A murmur waits this long for the floor (the other side's murmur still ending) before it gives up. */
export const MURMUR_WAIT = 2.5;
/** Who murmurs as a game begins, and who speaks into a long silence: the footsoldiers, the queen and the king. */
export const MURMUR_SLOTS = ["p1", "p2", "q", "k"] as const;
/** Seconds of silence after a move before someone on the side to move speaks, then between further lines. */
export const IDLE_FIRST = 25;
export const IDLE_AGAIN = 45;
/** At most this many lines into one silence. */
export const IDLE_MAX = 3;

/**
 * The voice that speaks for a kingdom's murmur or its line into a long silence: the next from that kingdom's bag of
 * the voices that have such a line and stand on the board, so a rematch hears someone else.
 */
export function nextAmbientVoice(kingdom: GambitKingdom, event: "murmur" | "idle", present: readonly string[], memory: BarkMemory, random: Random): string | null {
  const voices = MURMUR_SLOTS.map((slot) => `${kingdom}_${slot}`).filter((voice) => present.includes(voice));
  if (voices.length === 0) return null;
  const state = (memory.bags[`${kingdom}:${event}:voice`] ??= { bag: [] });
  // A voice that has left the board since the bag was filled is skipped.
  while (state.bag.length && !voices.includes(state.bag[state.bag.length - 1])) state.bag.pop();
  return peekBag(voices, state, random);
}

export function takeAmbientVoice(kingdom: GambitKingdom, event: "murmur" | "idle", memory: BarkMemory): void {
  const state = memory.bags[`${kingdom}:${event}:voice`];
  if (state?.bag.length) takeFromBag(state);
}

/** Seconds of quiet between the end of one bark and the start of the next. */
export const BARK_GAP = 6;
/** A line that answers the one before it (the rook its king, the promoted piece its own last cry) follows this closely. */
export const ANSWER_GAP = 0.3;
/** A rare moment (a castling, a promotion) or the second of a game's two murmurs waits only this long after a bark. */
export const RARE_GAP = 1.5;

/** The quiet a bark needs after the last one, by what it is about: rare moments are not lost to the common gap. */
export function barkGap(event: BarkEvent): number {
  return event === "castle" || event === "promote" || event === "promoted" || event === "murmur" ? RARE_GAP : BARK_GAP;
}
/** Seconds a bark keeps clear of any other voice, before it starts and after it ends. */
export const VOICE_CLEARANCE = 0.4;

/** The voices on the floor: when each other line (a plea, a cry, a whisper, a king's line) sounds, and the last bark. */
export interface VoiceFloor {
  /** Every other voice line, scheduled or sounding, in seconds on the mixer's clock. */
  voices: readonly { from: number; to: number }[];
  /** When the last bark ends (or ended). */
  barkUntil: number;
}

/**
 * Whether a bark of `length` seconds may start at `at`: no other voice sounds or is due within VOICE_CLEARANCE of it,
 * and the last bark ended `gap` seconds before (a castling's rook answers its king sooner: its own gap).
 */
export function barkMaySound(floor: VoiceFloor, at: number, length: number, gap = BARK_GAP): boolean {
  if (at < floor.barkUntil + gap) return false;
  return floor.voices.every((voice) => voice.to + VOICE_CLEARANCE <= at || voice.from >= at + length + VOICE_CLEARANCE);
}

/** The voices a bark gives way to: anything else with a voice. A bark that is sounding when one starts is cut. */
export function barkYieldsTo(clip: string, isBark: (clip: string) => boolean): boolean {
  return !isBark(clip);
}

/** Where the barks' chances come from: the match seed (the move list, salted), as the Combat Director's. */
export function barkSeed(sanMoves: readonly string[], salt: string): number {
  let hash = 0x811c9dc5;
  const text = `bark:${salt}|${sanMoves.join(" ")}`;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

/** A small seeded generator (mulberry32) for the barks' chances. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
