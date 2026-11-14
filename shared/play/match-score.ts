/**
 * The match score's director, as rules: what the board is doing (the phase from the move number and the material, the
 * captures of the last few moves, pieces left hanging, a king hemmed in, check, a fight on screen, how the game ended)
 * and which cue of the score that asks for, and how hard. No audio here: the desktop mixer's score player
 * (web/src/audio/scorePlayer.ts) reads the board with `readScoreBoard`, asks `directScore` what to play, and crossfades
 * the cues of web/src/audio/score-assets.ts on their bars. The cues are made in web/sound-design/score.
 *
 * It answers quickly and settles slowly. Check is urgent (the next bar); a change up the ladder (a capture, a fight on
 * screen) comes on the next two bars once the wish has held a moment; a change down waits out the cue's dwell and a
 * longer settle, and the tension bands overlap, so one quiet move never undoes a fight and nothing flip-flops. A
 * capture's weight fades with the plies and with time, so the music settles back after a fight. The game's end stops
 * the loops and reports its closing cue once; the mixer times it to the bell and the mated King's last word.
 *
 * The armies' morale (the battle memory, read from the moves alone, so an Undo, a seek and a replay hear the same) colours
 * it: an army losing heart adds a little tension, and a middle game in which one is breaking is already the Last Stand.
 */

import { BattleChronicle, startingFen, type MemoryMove, type MoraleMood } from "./battle-memory";

export type ScoreSide = "w" | "b";
export type ScoreCue = "theme" | "rest" | "rising" | "battle" | "peril" | "laststand";
export type ScoreSting = "victory" | "defeat" | "draw";
export type ScorePhase = "opening" | "middlegame" | "endgame";
/** What is on screen while a capture plays out: a Pawn duel, a Queen's summon, or any other killing. */
export type ScoreFight = "none" | "capture" | "duel" | "summon";

/** The parts of the game's published state the director reads (web/src/core/types.ts GameSnapshot fits it). */
export interface ScoreBoard {
  status: "idle" | "playing" | "over";
  mode: string;
  playerColor: ScoreSide;
  fen: string;
  inCheck: boolean;
  /** A move is being performed on the board (the capture's fight, when there is one). */
  busy: boolean;
  /** An exhibition halted between moves. */
  paused?: boolean;
  result: { winner: ScoreSide | null; reason: string } | null;
  /** The moves so far. With their squares (the controller's ledger has them), the battle memory reads each army's morale. */
  moves: readonly { color: ScoreSide; kind: string; capture: boolean; check: boolean; from?: string; to?: string; promotion?: string | null }[];
  /** The pieces taken, in the order they fell. */
  captured: readonly { kind: string; color: ScoreSide }[];
  /** The game's PGN, for a game that did not start from the usual array (its FEN header). */
  pgn?: string;
}

/** The board as the director hears it. */
export interface ScoreReading {
  /** The menu's background game keeps its board silent: no score. */
  quiet: boolean;
  status: ScoreBoard["status"];
  paused: boolean;
  ply: number;
  phase: ScorePhase;
  /** Non-king material on the board, in pawns (a full army is 39). */
  material: Record<ScoreSide, number>;
  /** Pieces taken so far. */
  captures: number;
  /** The captures of the last moves, each weighed by how recent it was and what fell (0 for none). */
  bloodshed: number;
  /** Pieces of either army attacked and either undefended or attacked by something worth less. */
  hanging: number;
  /** The worse-off king: the share of its own and its neighbouring squares the enemy attacks (0 to 1). */
  kingDanger: number;
  inCheck: boolean;
  fight: ScoreFight;
  /** The game's closing cue, once it is over. */
  ending: ScoreSting | null;
  /**
   * The armies' morale as the battle memory reads it from the moves (shared/play/battle-memory.ts), once the move on
   * stage has settled: the lower army's value (0 broken to 1 exultant; a fresh army stands at 0.62) and its mood, and
   * whether an army has been breaking since the move before (a trade leaves the side that lost first breaking for one
   * ply only). Null where the moves carry no squares.
   */
  morale?: { low: number; mood: MoraleMood; breaking?: boolean } | null;
}

export const PIECE_VALUES: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** How far back a capture still counts, in plies. */
export const BLOODSHED_PLIES = 6;

// ------------------------------------------------------------------ the position

type Piece = { side: ScoreSide; kind: string };

/** The squares of a FEN's board, a1 = 0 ... h8 = 63. */
export function boardOf(fen: string): (Piece | null)[] {
  const squares: (Piece | null)[] = new Array(64).fill(null);
  const ranks = fen.split(" ")[0].split("/");
  ranks.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      if (file < 8 && i < 8) squares[(7 - i) * 8 + file] = { side: ch === ch.toUpperCase() ? "w" : "b", kind: ch.toLowerCase() };
      file += 1;
    }
  });
  return squares;
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const LINES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Every square `side` attacks, as the cheapest attacker's value per square (Infinity where none does). Pseudo-attacks:
 * pins and checks are ignored, which is enough to hear how tense a position is.
 */
export function attackMap(squares: readonly (Piece | null)[], side: ScoreSide): number[] {
  const cheapest = new Array(64).fill(Infinity);
  const mark = (file: number, rank: number, value: number) => {
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return false;
    const sq = rank * 8 + file;
    cheapest[sq] = Math.min(cheapest[sq], value);
    return true;
  };
  for (let sq = 0; sq < 64; sq += 1) {
    const piece = squares[sq];
    if (!piece || piece.side !== side) continue;
    const file = sq % 8, rank = Math.floor(sq / 8);
    const value = piece.kind === "k" ? 100 : PIECE_VALUES[piece.kind] ?? 1;
    if (piece.kind === "p") {
      const forward = side === "w" ? 1 : -1;
      mark(file - 1, rank + forward, value); mark(file + 1, rank + forward, value);
    } else if (piece.kind === "n" || piece.kind === "k") {
      for (const [df, dr] of piece.kind === "n" ? KNIGHT : KING) mark(file + df, rank + dr, value);
    } else {
      const directions = piece.kind === "b" ? DIAGONALS : piece.kind === "r" ? LINES : [...DIAGONALS, ...LINES];
      for (const [df, dr] of directions) {
        for (let f = file + df, r = rank + dr; mark(f, r, value); f += df, r += dr) if (squares[r * 8 + f]) break;
      }
    }
  }
  return cheapest;
}

/** Non-king material per army, in pawns. */
export function materialOf(squares: readonly (Piece | null)[]): Record<ScoreSide, number> {
  const out: Record<ScoreSide, number> = { w: 0, b: 0 };
  for (const piece of squares) if (piece) out[piece.side] += PIECE_VALUES[piece.kind] ?? 0;
  return out;
}

/**
 * The opening runs to move eight with most of the material still on the board; the endgame is when neither army has
 * more than a queen's worth besides its pawns (a queen, two rooks, a rook and a minor piece, three minor pieces), or
 * the whole board holds less than twenty pawns' worth.
 */
export function phaseOf(ply: number, squares: readonly (Piece | null)[]): ScorePhase {
  const pieces: Record<ScoreSide, number> = { w: 0, b: 0 };
  for (const piece of squares) if (piece && piece.kind !== "p" && piece.kind !== "k") pieces[piece.side] += PIECE_VALUES[piece.kind];
  const material = materialOf(squares);
  if ((pieces.w <= 10 && pieces.b <= 10) || material.w + material.b < 20) return "endgame";
  if (ply < 16 && material.w + material.b >= 70) return "opening";
  return "middlegame";
}

/** Pieces left hanging, both armies counted: attacked and undefended, or attacked by something worth less. */
export function hangingPieces(squares: readonly (Piece | null)[]): number {
  const attacks = { w: attackMap(squares, "w"), b: attackMap(squares, "b") };
  let count = 0;
  squares.forEach((piece, sq) => {
    if (!piece || piece.kind === "k") return;
    const enemy = attacks[piece.side === "w" ? "b" : "w"][sq];
    if (enemy === Infinity) return;
    const defended = attacks[piece.side][sq] !== Infinity;
    if (!defended || enemy < (PIECE_VALUES[piece.kind] ?? 1)) count += 1;
  });
  return count;
}

/** The worse-off king's share of its own square and its neighbours that the enemy attacks. */
export function kingDangerOf(squares: readonly (Piece | null)[]): number {
  let worst = 0;
  for (const side of ["w", "b"] as const) {
    const at = squares.findIndex((piece) => piece?.side === side && piece.kind === "k");
    if (at < 0) continue;
    const enemy = attackMap(squares, side === "w" ? "b" : "w");
    let zone = 0, hit = 0;
    for (const [df, dr] of [[0, 0], ...KING]) {
      const f = (at % 8) + df, r = Math.floor(at / 8) + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      zone += 1;
      if (enemy[r * 8 + f] !== Infinity) hit += 1;
    }
    worst = Math.max(worst, zone ? hit / zone : 0);
  }
  return worst;
}

/** How a game ends in the score: in a duel or an exhibition nobody at the screen lost, so a decisive end is a victory. */
export function scoreEnding(result: { winner: ScoreSide | null }, listener: ScoreSide | null): ScoreSting {
  if (!result.winner) return "draw";
  return listener && listener !== result.winner ? "defeat" : "victory";
}

/** The board as the director hears it. */
export function readScoreBoard(board: ScoreBoard): ScoreReading {
  const squares = boardOf(board.fen);
  const ply = board.moves.length;
  // The captures of the last plies, weighed by recency and by what fell. The n-th capture in the ledger took the n-th
  // piece of `captured`.
  let bloodshed = 0, taken = 0;
  board.moves.forEach((move, i) => {
    if (!move.capture) return;
    const fallen = board.captured[taken++];
    const ago = ply - 1 - i;
    if (ago >= BLOODSHED_PLIES) return;
    const weight = ({ p: 0.8, n: 1, b: 1, r: 1.15, q: 1.3 } as Record<string, number>)[fallen?.kind ?? "p"] ?? 0.8;
    bloodshed += weight * (1 - ago / BLOODSHED_PLIES);
  });
  const last = board.moves[ply - 1];
  const victim = last?.capture ? board.captured[taken - 1] : undefined;
  const fight: ScoreFight = !board.busy || !last?.capture ? "none"
    : last.kind === "q" && victim && victim.kind !== "p" && victim.kind !== "k" ? "summon"
      : last.kind === "p" && victim?.kind === "p" ? "duel" : "capture";
  const listener = board.mode === "ai" ? board.playerColor : null;
  return {
    morale: moraleOf(board),
    quiet: board.mode === "attract",
    status: board.status,
    // A game held before its first move is not paused: the match's opening plays over it, and the Theme comes in as the
    // opening hands over to the board. (The pause menu holds the score itself: the mixer's holdMatch.)
    paused: !!board.paused && ply > 0,
    ply,
    phase: phaseOf(ply, squares),
    material: materialOf(squares),
    captures: taken,
    bloodshed,
    hanging: hangingPieces(squares),
    kingDanger: kingDangerOf(squares),
    inCheck: board.status === "playing" && board.inCheck,
    fight,
    ending: board.status === "over" && board.result ? scoreEnding(board.result, listener) : null,
  };
}

/** The battle memory, kept from one reading to the next: it reads only new moves, and starts over for another game. */
const chronicle = new BattleChronicle();

/** The lower army's morale, from the moves as settled (the move still on stage is not counted yet). */
function moraleOf(board: ScoreBoard): ScoreReading["morale"] {
  const moves = board.moves;
  if (moves.length === 0 || !moves.every((m) => typeof m.from === "string" && typeof m.to === "string")) return null;
  const read: MemoryMove[] = moves.map((m) => ({ color: m.color, from: m.from!, to: m.to!, promotion: (m.promotion ?? null) as MemoryMove["promotion"] }));
  const memory = chronicle.read(read, startingFen(board.pgn));
  const settled = board.busy ? memory.plies - 1 : memory.plies;
  const lowAt = (ply: number) => { const m = memory.morale(ply); return m.w.value <= m.b.value ? m.w : m.b; };
  const low = lowAt(settled);
  return { low: low.value, mood: low.mood, breaking: low.mood === "breaking" && settled > 0 && lowAt(settled - 1).mood === "breaking" };
}

// ------------------------------------------------------------------ tension

/** A capture's weight halves every this many seconds, so the music settles back after a fight even while nobody moves. */
export const BLOOD_HALF_LIFE = 30;

/**
 * How tense the board is, 0 to 1: a little in the opening and a quiet middle game, more in the endgame; each recent capture
 * adds to it (more for a queen than a pawn, less as it recedes; `bloodFade` is the time fade since the last one), and
 * so do pieces left hanging, a king hemmed in, and a fight on screen (a summon most of all). Check is not here: it is
 * Peril's, and urgent.
 */
export function scoreTension(reading: ScoreReading, bloodFade = 1): number {
  // A quiet middle game sits under Rest's way down (0.22), so the music can settle back there after a fight.
  const base = { opening: 0.08, middlegame: 0.18, endgame: 0.45 }[reading.phase];
  const fight = { none: 0, capture: 0.3, duel: 0.35, summon: 0.45 }[reading.fight];
  // An army losing heart adds to it: nothing while both stand steady (0.5), up to 0.1 as one breaks (0.3).
  const heart = reading.morale ? Math.max(0, Math.min(0.1, (0.5 - reading.morale.low) * 0.5)) : 0;
  const tension = base + 0.22 * reading.bloodshed * bloodFade + Math.min(0.28, 0.07 * reading.hanging) + 0.25 * reading.kingDanger + fight + heart;
  return Math.max(0, Math.min(1, tension));
}

// ------------------------------------------------------------------ the director

/**
 * How high each cue stands. A change up the ladder (the board heating) is quick, so a capture is felt within a phrase;
 * a change down it (settling back) waits out the cue's dwell and a longer settle, so one quiet move never undoes a fight.
 */
export const SCORE_RANK: Readonly<Record<ScoreCue, number>> = { rest: 0, rising: 1, theme: 1, battle: 2, laststand: 2, peril: 3 };
/** Going up: the cue has played this long (two bars) and the wish has held this long. */
export const SCORE_RISE = { dwell: 5, settle: 1.5 };
/** Going down: each cue's own dwell, and a wish that has held this long. */
export const SCORE_DWELL: Readonly<Record<ScoreCue, number>> = { theme: 30, rest: 16, rising: 14, battle: 16, peril: 8, laststand: 20 };
export const SCORE_FALL_SETTLE = 5;
/** Peril stays this long after the king is out of check. */
export const PERIL_HOLD = 4;
/** The Theme lets go this long before its end (its last held note), so the next cue can come in under its tail. */
export const THEME_LEAD = 5;
/** After its first thirty seconds the Theme gives way to a fight: tension this high, held this long. */
export const THEME_BREAK = { tension: 0.5, seconds: 1.5 };
/** The tension bands, with overlap: up takes more than staying. */
export const SCORE_BANDS = { risingUp: 0.35, restDown: 0.22, battleUp: 0.62, risingDown: 0.45 };
/** A king hemmed in this much in the middle game is Peril even out of check. */
export const PERIL_DANGER = 0.6;
/** Each cue's intensity range, which the tension is mapped into. */
export const SCORE_INTENSITY: Readonly<Record<ScoreCue, readonly [number, number]>> = {
  theme: [0.5, 0.5], rest: [0, 0.4], rising: [0.3, 0.6], battle: [0.6, 1], peril: [0.7, 1], laststand: [0.6, 1],
};

export interface ScoreMemory {
  /** The cue asked for, and since when. */
  cue: ScoreCue | null;
  since: number;
  /** A non-urgent wish waiting to settle, and since when it has held. */
  want: ScoreCue | null;
  wantSince: number;
  /** The tension band the board is in (Rest, Rising or Battle), held with overlap. */
  band: "rest" | "rising" | "battle";
  /** When the king was last seen in check. */
  lastCheck: number;
  /** Pieces taken as last seen, and when the last of them fell. */
  captures: number;
  bloodAt: number;
  /** When the Theme began and how long it is; done once it has given way. */
  themeAt: number;
  themeSeconds: number;
  themeDone: boolean;
  /** Since when tension has been at the Theme's breaking point (NaN when it is not). */
  hotSince: number;
  /** The closing cue already reported for this ending. */
  sting: ScoreSting | null;
}

export interface ScoreDecision {
  /** The cue that should be playing (null: none, as in the menu's background game and once a game is over). */
  cue: ScoreCue | null;
  /** 0 to 1, within the cue's range. */
  intensity: number;
  /** The change is urgent (check): crossfade on the next bar rather than the next phrase. */
  urgent: boolean;
  /** The change goes up the ladder: on the next two-bar boundary rather than the next phrase. */
  rising: boolean;
  /** The closing cue, reported once as the game ends (the mixer times it to the bell and the last words). */
  sting: ScoreSting | null;
  /** An exhibition is halted: the score draws back and waits. */
  paused: boolean;
  tension: number;
}

/**
 * A new game: the Theme plays as it begins (from its first moves; a game picked up later starts on the board's own
 * cue). `themeSeconds` is how long the Theme runs.
 */
export function newScoreMemory(now: number, themeSeconds: number, ply = 0): ScoreMemory {
  const theme = ply <= 2;
  return {
    cue: theme ? "theme" : null, since: now, want: null, wantSince: now, band: "rest", lastCheck: -Infinity,
    captures: -1, bloodAt: -Infinity, themeAt: now, themeSeconds, themeDone: !theme, hotSince: Number.NaN, sting: null,
  };
}

function bandFor(band: ScoreMemory["band"], tension: number): ScoreMemory["band"] {
  const b = SCORE_BANDS;
  if (band === "rest") return tension >= b.battleUp ? "battle" : tension >= b.risingUp ? "rising" : "rest";
  if (band === "rising") return tension >= b.battleUp ? "battle" : tension < b.restDown ? "rest" : "rising";
  return tension < b.restDown ? "rest" : tension < b.risingDown ? "rising" : "battle";
}

function intensityOf(cue: ScoreCue, tension: number): number {
  const [lo, hi] = SCORE_INTENSITY[cue];
  return Math.round((lo + (hi - lo) * Math.max(0, Math.min(1, tension))) * 1000) / 1000;
}

/**
 * One step of the director at time `now` (seconds, any steady clock): returns the decision and updates `memory`.
 * Call it on every published state and a few times a second between them, since dwell, settle and the fade of a
 * fight run on time.
 */
export function directScore(memory: ScoreMemory, reading: ScoreReading, now: number): ScoreDecision {
  const quiet = (tension: number): ScoreDecision => ({ cue: null, intensity: 0, urgent: false, rising: false, sting: null, paused: reading.paused, tension });
  if (reading.quiet || reading.status === "idle") {
    memory.cue = null; memory.want = null;
    return quiet(0);
  }
  if (reading.ending) {
    // The end: the loops stop (the mixer fades them under the bell) and the closing cue is reported once.
    const sting = memory.sting === reading.ending ? null : reading.ending;
    memory.sting = reading.ending; memory.cue = null; memory.want = null; memory.themeDone = true;
    return { ...quiet(0), sting };
  }
  memory.sting = null;
  // A new capture starts the fade of the bloodshed over again; an undone one changes nothing but the count. A game taken
  // up mid-way (a replay seeked to a ply, a page that woke late) hears the captures of its last plies as just made: the
  // board is as it stood a moment after them.
  if (memory.captures >= 0 ? reading.captures > memory.captures : reading.bloodshed > 0) memory.bloodAt = now;
  memory.captures = reading.captures;
  const tension = scoreTension(reading, Math.pow(0.5, Math.max(0, now - memory.bloodAt) / BLOOD_HALF_LIFE));
  if (reading.inCheck) memory.lastCheck = now;
  memory.band = bandFor(memory.band, tension);
  memory.hotSince = tension >= THEME_BREAK.tension ? (Number.isNaN(memory.hotSince) ? now : memory.hotSince) : Number.NaN;

  // What the board asks for, before dwell and settle.
  let wish: ScoreCue;
  let urgent = false;
  const themeEnding = memory.themeAt + memory.themeSeconds - now <= THEME_LEAD;
  if (reading.inCheck) { wish = "peril"; urgent = memory.cue !== "peril"; }
  else if (memory.cue === "peril" && now - memory.lastCheck < PERIL_HOLD) wish = "peril";
  // The endgame is the Last Stand, and so is a middle game in which an army has been breaking since the move before: the
  // game's end is in sight.
  else if (reading.phase === "endgame" || (reading.phase === "middlegame" && reading.morale?.breaking)) wish = "laststand";
  else if (reading.phase === "middlegame" && reading.kingDanger >= PERIL_DANGER) wish = "peril";
  else if (!memory.themeDone && !themeEnding) {
    const fighting = !Number.isNaN(memory.hotSince) && now - memory.hotSince >= THEME_BREAK.seconds;
    wish = fighting ? memory.band : "theme";
  } else wish = memory.band;

  let rising = false;
  if (memory.cue === null) {
    memory.cue = wish; memory.since = now; memory.want = null;
  } else if (wish === memory.cue) {
    memory.want = null;
  } else if (urgent) {
    memory.cue = wish; memory.since = now; memory.want = null;
  } else {
    if (memory.want !== wish) { memory.want = wish; memory.wantSince = now; }
    rising = SCORE_RANK[wish] > SCORE_RANK[memory.cue];
    // The Theme that has run its length gives way at once: there is nothing left of it to dwell in.
    const themeOver = memory.cue === "theme" && themeEnding;
    const dwell = memory.cue === "theme" ? SCORE_DWELL.theme : rising ? SCORE_RISE.dwell : SCORE_DWELL[memory.cue];
    // The Theme's own break rule (tension held THEME_BREAK.seconds) is its settle.
    const settle = memory.cue === "theme" ? 0 : rising ? SCORE_RISE.settle : SCORE_FALL_SETTLE;
    if (themeOver || (now - memory.since >= dwell && now - memory.wantSince >= settle)) {
      memory.cue = wish; memory.since = now; memory.want = null;
    } else rising = false;
  }
  if (memory.cue !== "theme") memory.themeDone = true;
  return { cue: memory.cue, intensity: intensityOf(memory.cue, tension), urgent, rising, sting: null, paused: reading.paused, tension };
}
