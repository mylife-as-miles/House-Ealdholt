/**
 * The battle's memory, read only from the move list: who stood beside whom, who covered whom, who avenged whom, who
 * earned a name, and how each army is holding up. Nothing is kept between moves. The same moves give the same memory,
 * so an Undo, a rebuilt board or a replay remembers exactly what the game remembers, and no more.
 *
 * Chess decides what happens; Crownfall shows how it happens; this is where the story decides what it means. It only
 * observes: it never changes a move, a clock or a result. Pure TypeScript, no three.js and no chess engine. Attacks
 * are read off the board by hand (shared/play/battle-memory.test.ts checks them against chess.js over whole games).
 *
 * Identity: every figure is named by its side and the square it started on ("w:g1" is White's King's Knight). A Pawn
 * that is crowned keeps its name: it is the same person.
 *
 * The scene reads it through web/src/scene/battleBonds.ts; the reactions it drives are in
 * web/src/scene/battleEmotion.ts. docs/play/BATTLE_MEMORY.md has the model and the tables.
 */

export type Side = "w" | "b";
export type Rank = "p" | "n" | "b" | "r" | "q" | "k";

/** What is read of a move. The controller's ledger rows (LedgerMove) fit as they are. */
export interface MemoryMove {
  readonly color: Side;
  readonly from: string;
  readonly to: string;
  readonly promotion?: Rank | null;
}

/**
 * Bond from which two figures are old comrades, and from which they are companions (see {@link bondValue}): starting
 * side by side is not enough to be companions; ten plies together in the field, or covering each other for a few, is.
 */
export const COMRADE = 1;
export const COMPANION = 2.2;
/** Renown from which a figure is a veteran (see {@link renownValue}). */
export const VETERAN = 3;

const VALUE: Record<Rank, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** What a kill adds to the killer's renown, by what it took. */
const KILL: Record<Rank, number> = { p: 1, n: 1.6, b: 1.6, r: 2.2, q: 3.2, k: 0 };
const NAMES: Record<Rank, string> = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

/** How one pair's bond was made, term by term. */
export interface BondTerms {
  /** 1 when they started side by side, or one directly behind the other: old comrades. */
  readonly comrades: number;
  /** Plies they stood next to each other in the field (at least one had left its first square). */
  readonly shoulder: number;
  /** Plies one guarded the other's square while an enemy attacked it, counted both ways. */
  readonly cover: number;
  /** Dangers come through together: both attacked at once, near each other, and both still standing after. */
  readonly danger: number;
  /** Times one took the other's killer. */
  readonly avenged: number;
}

/**
 * A pair's bond: 1 for old comrades, 0.1 per ply side by side and 0.25 per ply of cover (up to 2 each), 0.4 per danger
 * come through together (up to 1.5), 2 per vengeance.
 */
export function bondValue(t: BondTerms): number {
  return t.comrades + Math.min(2, t.shoulder * .1) + Math.min(2, t.cover * .25) + Math.min(1.5, t.danger * .4) + t.avenged * 2;
}

/** How a figure earned its name, term by term. */
export interface RenownTerms {
  /** Kills, weighted by what was taken: a Pawn 1, a Knight or Bishop 1.6, a Rook 2.2, a Queen 3.2. */
  readonly kills: number;
  /** A Pawn's furthest rank, counted from its own side (2 to 8); 0 for every other figure. */
  readonly march: number;
  readonly crowned: boolean;
  /** Threats outlived: attacked, then standing unattacked. */
  readonly threats: number;
  /** Plies at its King's side while an enemy attacked the King or a square around him. */
  readonly guard: number;
  /** Captures that took the killer of a fallen ally. */
  readonly avenged: number;
  /** Veterans and Queens it took. */
  readonly slewRenowned: number;
}

/** A figure's renown: its kills, a Pawn's march past the middle (and its crown), threats outlived, guard kept, vengeance. */
export function renownValue(t: RenownTerms): number {
  return t.kills + Math.max(0, t.march - 4) * .6 + (t.crowned ? 2.4 : 0) + Math.min(2.1, t.threats * .35) + Math.min(1.8, t.guard * .12)
    + t.avenged + t.slewRenowned;
}

/** What a fall is to the army that suffers it, the most telling first. */
export type LossKind = "royal" | "last-guard" | "veteran" | "companion" | "stranger";

export interface Mourner { readonly id: string; readonly bond: number; }

export interface Fall {
  /** The ply (0-based half-move) of the capture. */
  readonly ply: number;
  readonly victim: string;
  readonly victimKind: Rank;
  /** The army that suffers it. */
  readonly side: Side;
  /** Where it fell: under en passant, the square the Pawn stood on, not the captor's destination. */
  readonly square: string;
  readonly killer: string;
  readonly killerKind: Rank;
  /** What it is to its army: its Queen, its King's last guard, a veteran, someone's companion, or a stranger. */
  readonly loss: LossKind;
  /** The fallen's renown as it fell; the killer's once the kill is counted. */
  readonly renown: number;
  readonly killerRenown: number;
  /** It stood at its King's side; and once it fell, nobody of its army did. */
  readonly guard: boolean;
  readonly lastGuard: boolean;
  /** Every living ally with any bond to it as it fell, the strongest first. */
  readonly mourners: readonly Mourner[];
  /** The killer's own fallen whom this capture avenges (the victim had taken them), with the avenger's bond to each. */
  readonly avenges: readonly { readonly fallen: string; readonly ply: number; readonly bond: number }[];
}

export type MoraleMood = "proud" | "steady" | "shaken" | "breaking";

export interface ArmyMorale {
  /** 0 (broken) to 1 (exultant). A fresh army stands at 0.62. */
  readonly value: number;
  readonly mood: MoraleMood;
  /**
   * The terms, as subtracted or added. Falls: 0.016 per point of material, up to 0.045 more for the fallen's renown and
   * 0.035 for the bond of its closest survivor.
   */
  readonly losses: number;
  /** Enemies taken: 0.014 per point, up to 0.03 more for a renowned one. Their bonds are their army's grief, not this one's joy. */
  readonly gains: number;
  /** 0.08 once its Queen has fallen, on top of her loss. */
  readonly queen: number;
  /** Checks against its King in the last 8 plies (0.045 each), and 0.05 more while in check. */
  readonly pressure: number;
  /** Captures made minus captures suffered in the last 6 plies, 0.04 each, within ±0.12. */
  readonly momentum: number;
  /** Its King's guards fallen, 0.05 each up to 0.15. */
  readonly guard: number;
  /** How much of his guard the King has lost: a third per guard fallen, all of it once the last one fell and he stands alone. */
  readonly guardLost: number;
}

export interface BattleMorale {
  readonly ply: number;
  readonly w: ArmyMorale;
  readonly b: ArmyMorale;
  /** White's morale minus Black's. */
  readonly edge: number;
  /** Each army's change over the last ply. */
  readonly trend: { readonly w: number; readonly b: number };
}

/** One figure, as the story names it. */
export interface Brief {
  readonly id: string;
  readonly side: Side;
  readonly kind: Rank;
  readonly born: Rank;
  /** "the King's Knight", "the e-file Pawn, crowned Queen". The side's kingdom is the reader's to add. */
  readonly name: string;
  /** Where it stands, or where it fell. */
  readonly square: string;
  readonly fell: number | null;
}

export interface BattleStory {
  readonly plies: number;
  /** Companions parted by a death, the strongest bond first. */
  readonly bondsBroken: readonly { readonly fallen: Brief; readonly survivor: Brief; readonly bond: number; readonly reasons: readonly string[]; readonly ply: number }[];
  /** The veterans, the most renowned first, fallen or standing. */
  readonly renowned: readonly { readonly soldier: Brief; readonly renown: number; readonly deeds: readonly string[] }[];
  /** Every capture that took an ally's killer; `companion` when the avenger was the fallen's companion. */
  readonly avengers: readonly { readonly avenger: Brief; readonly avenged: Brief; readonly ply: number; readonly companion: boolean }[];
  readonly morale: BattleMorale;
}

/** A figure as the memory knows it now. */
export interface SoldierView {
  readonly id: string;
  readonly side: Side;
  readonly born: Rank;
  readonly kind: Rank;
  readonly origin: string;
  readonly name: string;
  /** Where it stands; null once it has fallen. */
  readonly square: string | null;
  readonly fell: number | null;
  readonly killer: string | null;
  readonly renown: number;
  readonly terms: RenownTerms;
  /** It took a veteran or a Queen: the army it took them from watches it. */
  readonly feared: boolean;
}

export interface BattleMemory {
  /** Plies read. Less than the move list only if a move did not fit the board (never for a game the controller played). */
  readonly plies: number;
  readonly soldiers: readonly SoldierView[];
  soldier(id: string): SoldierView | null;
  /** Who stood on `square` before the move with index `ply` (0 is the start); the board now by default. */
  occupant(square: string, ply?: number): string | null;
  /** The bond between two figures of one army (0 for anyone else), dead or alive. */
  bond(a: string, b: string): number;
  bondTerms(a: string, b: string): BondTerms | null;
  readonly falls: readonly Fall[];
  fallAt(ply: number): Fall | null;
  /** Both armies' morale after `ply` plies, now by default. */
  morale(ply?: number): BattleMorale;
  story(): BattleStory;
  brief(id: string): Brief | null;
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const DIAGONAL = [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
const STRAIGHT = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

const indexOf = (square: string): number => {
  if (typeof square !== "string" || square.length !== 2) return -1;
  const file = square.charCodeAt(0) - 97, rank = square.charCodeAt(1) - 49;
  return file >= 0 && file < 8 && rank >= 0 && rank < 8 ? rank * 8 + file : -1;
};
const squareOf = (index: number) => String.fromCharCode(97 + (index & 7)) + String.fromCharCode(49 + (index >> 3));
/** King's-move distance between two squares. */
const near = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const ordinal = (n: number) => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const keyOf = (move: MemoryMove) => `${move.from}${move.to}${move.promotion ?? ""}`;

/** The starting position a game's PGN declares (its FEN header), if it did not start from the usual array. */
export function startingFen(pgn: string | null | undefined): string | undefined {
  return /\[FEN "([^"]+)"\]/.exec(pgn ?? "")?.[1];
}

function placementOf(fen: string | undefined): string {
  const field = (fen ?? "").trim().split(/\s+/)[0] ?? "";
  const rows = field.split("/");
  const fits = rows.length === 8 && rows.every(row => /^[pnbrqkPNBRQK1-8]+$/.test(row) && [...row].reduce((sum, c) => sum + (/\d/.test(c) ? Number(c) : 1), 0) === 8);
  return fits ? field : START;
}

/** What the story calls a figure: its post in the starting array where it has one. */
export function soldierName(born: Rank, origin: string, kind: Rank = born): string {
  const file = origin[0], home = origin[1] === "1" || origin[1] === "8";
  const posts: Partial<Record<Rank, string>> = { n: "bg", b: "cf", r: "ah" };
  let name: string;
  if (born === "p") name = `the ${file}-file Pawn`;
  else if (born === "k") name = "the King";
  else if (born === "q") name = home && file === "d" ? "the Queen" : `the Queen of ${origin}`;
  else if (home && posts[born]?.includes(file)) name = `the ${file <= "d" ? "Queen's" : "King's"} ${NAMES[born]}`;
  else name = `the ${NAMES[born]} of ${origin}`;
  return kind === born ? name : `${name}, crowned ${NAMES[kind]}`;
}

/**
 * The squares a figure attacks, pushed as its index onto `out[square]`: blocked sliders stop on the first figure, and a
 * pinned figure still attacks, as chess counts it.
 */
function rays(board: Int8Array, kind: Rank, side: Side, at: number, index: number, out: number[][]): void {
  const file = at & 7, rank = at >> 3;
  if (kind === "p") {
    const y = rank + (side === "w" ? 1 : -1);
    if (y >= 0 && y < 8) { if (file > 0) out[y * 8 + file - 1].push(index); if (file < 7) out[y * 8 + file + 1].push(index); }
    return;
  }
  const steps = kind === "n" ? KNIGHT : kind === "k" ? KING : null;
  if (steps) {
    for (let i = 0; i < steps.length; i += 1) {
      const x = file + steps[i][0], y = rank + steps[i][1];
      if (x >= 0 && x < 8 && y >= 0 && y < 8) out[y * 8 + x].push(index);
    }
    return;
  }
  const directions = kind === "b" ? DIAGONAL : kind === "r" ? STRAIGHT : KING;
  for (let i = 0; i < directions.length; i += 1) {
    const df = directions[i][0], dr = directions[i][1];
    for (let x = file + df, y = rank + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
      out[y * 8 + x].push(index);
      if (board[y * 8 + x] >= 0) break;
    }
  }
}

/**
 * Every square's attackers of one side in a position (FEN), by square ("e4" -> ["d3", "f3"]): the very rule the memory
 * reads threats and cover with, exposed so it can be held to chess.js.
 */
export function attackMap(fen: string, side: Side): Record<string, string[]> {
  const fold = new Fold(placementOf(fen)), out: number[][] = Array.from({ length: 64 }, () => []);
  const board = new Int8Array(64).fill(-1);
  for (const figure of fold.soldiers) board[figure.at] = figure.index;
  for (const figure of fold.soldiers) if (figure.side === side) rays(board, figure.kind, figure.side, figure.at, figure.index, out);
  const map: Record<string, string[]> = {};
  out.forEach((list, at) => { map[squareOf(at)] = list.map(index => squareOf(fold.soldiers[index].at)).sort(); });
  return map;
}

class Figure implements SoldierView {
  readonly id: string;
  kind: Rank;
  at: number;
  moved = false;
  fellAt = -1;
  killedBy: Figure | null = null;
  readonly slain: Figure[] = [];
  readonly avengedFor: Figure[] = [];
  kills = 0;
  march: number;
  crowned = false;
  threats = 0;
  guard = 0;
  avengedCount = 0;
  slewRenowned = 0;

  constructor(readonly index: number, readonly side: Side, readonly born: Rank, readonly origin: string) {
    this.id = `${side}:${origin}`;
    this.kind = born;
    this.at = indexOf(origin);
    this.march = born === "p" ? this.relativeRank() : 0;
  }
  get square(): string | null { return this.at < 0 ? null : squareOf(this.at); }
  get fell(): number | null { return this.fellAt < 0 ? null : this.fellAt; }
  get killer(): string | null { return this.killedBy?.id ?? null; }
  get name(): string { return soldierName(this.born, this.origin, this.kind); }
  get feared(): boolean { return this.slewRenowned > 0; }
  get terms(): RenownTerms {
    return { kills: this.kills, march: this.march, crowned: this.crowned, threats: this.threats, guard: this.guard, avenged: this.avengedCount, slewRenowned: this.slewRenowned };
  }
  get renown(): number { return renownValue(this.terms); }
  relativeRank(): number { const rank = (this.at >> 3) + 1; return this.side === "w" ? rank : 9 - rank; }
}

/** The memory after some plies; extended one ply at a time. */
class Fold implements BattleMemory {
  readonly soldiers: Figure[] = [];
  readonly falls: Fall[] = [];
  private readonly n: number;
  private readonly board = new Int8Array(64).fill(-1);
  /** The board before each ply: boards[0] is the start, boards[k] the position after k plies. */
  private readonly boards: Int8Array[] = [];
  private readonly keys: string[] = [];
  private readonly byId = new Map<string, Figure>();
  private readonly kings: Partial<Record<Side, Figure>> = {};
  // Pair terms. Symmetric terms keep the low index first; directed ones are [from * n + to].
  private readonly comrades: Uint8Array;
  private readonly shoulder: Uint16Array;
  private readonly danger: Uint16Array;
  private readonly cover: Uint16Array;
  private readonly avenged: Uint8Array;
  /** The army each check was against, and its ply. */
  private readonly checks: { ply: number; side: Side }[] = [];
  private threatNow: Uint8Array;
  private threatBefore: Uint8Array;
  private dangerPairs: number[] = [];
  private readonly attackers: number[][] = Array.from({ length: 64 }, () => []);
  private broken = false;

  constructor(readonly placement: string) {
    const rows = placement.split("/");
    const found: { side: Side; rank: Rank; at: number }[] = [];
    rows.forEach((row, r) => {
      let file = 0;
      for (const char of row) {
        if (/\d/.test(char)) { file += Number(char); continue; }
        const lower = char.toLowerCase() as Rank;
        found.push({ side: char === lower ? "b" : "w", rank: lower, at: (7 - r) * 8 + file });
        file += 1;
      }
    });
    found.sort((a, b) => a.at - b.at);
    for (const entry of found) {
      const figure = new Figure(this.soldiers.length, entry.side, entry.rank, squareOf(entry.at));
      this.soldiers.push(figure);
      this.byId.set(figure.id, figure);
      this.board[entry.at] = figure.index;
      if (entry.rank === "k" && !this.kings[entry.side]) this.kings[entry.side] = figure;
    }
    const n = this.n = this.soldiers.length;
    this.comrades = new Uint8Array(n * n); this.shoulder = new Uint16Array(n * n); this.danger = new Uint16Array(n * n);
    this.cover = new Uint16Array(n * n); this.avenged = new Uint8Array(n * n);
    this.threatNow = new Uint8Array(n); this.threatBefore = new Uint8Array(n);
    // Old comrades: side by side in the line, or one directly behind the other.
    for (const a of this.soldiers) for (const b of this.soldiers) {
      if (a.index >= b.index || a.side !== b.side) continue;
      if (Math.abs((a.at & 7) - (b.at & 7)) + Math.abs((a.at >> 3) - (b.at >> 3)) === 1) this.comrades[a.index * n + b.index] = 1;
    }
    this.boards.push(this.board.slice());
    this.evaluate(-1);
  }

  get plies(): number { return this.keys.length; }

  /** Whether `moves` starts with every ply already read. */
  continues(moves: readonly MemoryMove[]): boolean {
    if (moves.length < this.keys.length) return false;
    for (let i = 0; i < this.keys.length; i += 1) if (keyOf(moves[i]) !== this.keys[i]) return false;
    return true;
  }

  extend(moves: readonly MemoryMove[]): void {
    for (let ply = this.keys.length; ply < moves.length && !this.broken; ply += 1) this.read(moves[ply], ply);
  }

  soldier(id: string): SoldierView | null { return this.byId.get(id) ?? null; }

  occupant(square: string, ply = this.plies): string | null {
    const board = this.boards[clamp(Math.floor(ply), 0, this.plies)], at = indexOf(square);
    const index = at < 0 || !board ? -1 : board[at];
    return index < 0 ? null : this.soldiers[index].id;
  }

  bond(a: string, b: string): number {
    const terms = this.bondTerms(a, b);
    return terms ? bondValue(terms) : 0;
  }

  bondTerms(a: string, b: string): BondTerms | null {
    const x = this.byId.get(a), y = this.byId.get(b);
    return x && y && x !== y && x.side === y.side ? this.terms(x.index, y.index) : null;
  }

  fallAt(ply: number): Fall | null {
    for (const fall of this.falls) if (fall.ply === ply) return fall;
    return null;
  }

  morale(ply = this.plies): BattleMorale {
    const at = clamp(Math.floor(ply), 0, this.plies);
    const w = this.army("w", at), b = this.army("b", at);
    const before = at > 0 ? { w: this.army("w", at - 1), b: this.army("b", at - 1) } : { w, b };
    return { ply: at, w, b, edge: w.value - b.value, trend: { w: w.value - before.w.value, b: b.value - before.b.value } };
  }

  brief(id: string): Brief | null {
    const figure = this.byId.get(id);
    return figure ? this.briefOf(figure) : null;
  }

  story(): BattleStory {
    const bondsBroken: BattleStory["bondsBroken"][number][] = [];
    const avengers: BattleStory["avengers"][number][] = [];
    for (const fall of this.falls) {
      const victim = this.byId.get(fall.victim)!, closest = fall.mourners[0];
      if (closest && closest.bond >= COMPANION) {
        const survivor = this.byId.get(closest.id)!;
        bondsBroken.push({ fallen: this.briefOf(victim), survivor: this.briefOf(survivor), bond: closest.bond, reasons: this.reasons(victim, survivor), ply: fall.ply });
      }
      for (const entry of fall.avenges) {
        const fallen = this.byId.get(entry.fallen)!, earlier = this.fallAt(entry.ply);
        const bondThen = earlier?.mourners.find(m => m.id === fall.killer)?.bond ?? 0;
        avengers.push({ avenger: this.briefOf(this.byId.get(fall.killer)!), avenged: this.briefOf(fallen), ply: fall.ply, companion: bondThen >= COMPANION });
      }
    }
    bondsBroken.sort((a, b) => b.bond - a.bond || a.ply - b.ply);
    const renowned = this.soldiers.filter(f => f.renown >= VETERAN).sort((a, b) => b.renown - a.renown || a.index - b.index)
      .slice(0, 6).map(f => ({ soldier: this.briefOf(f), renown: f.renown, deeds: this.deeds(f) }));
    return { plies: this.plies, bondsBroken: bondsBroken.slice(0, 6), renowned, avengers, morale: this.morale() };
  }

  // ---------------------------------------------------------------- reading one ply

  private read(move: MemoryMove, ply: number): void {
    const from = indexOf(move.from), to = indexOf(move.to);
    const moverIndex = from < 0 ? -1 : this.board[from];
    const mover = moverIndex < 0 ? null : this.soldiers[moverIndex];
    if (!mover || to < 0 || mover.side !== move.color || from === to) { this.broken = true; return; }
    let fallAt = to, victimIndex = this.board[to];
    // En passant: a Pawn's diagonal step onto an empty square takes the Pawn beside it.
    if (victimIndex < 0 && mover.kind === "p" && (from & 7) !== (to & 7)) { fallAt = (from & ~7) | (to & 7); victimIndex = this.board[fallAt]; }
    const victim = victimIndex < 0 ? null : this.soldiers[victimIndex];
    if (victim && (victim.side === mover.side || victim.kind === "k")) { this.broken = true; return; }
    // What the fall is to its army is read before the board changes: its bonds and renown as it stood.
    const before = victim ? this.beforeFall(victim, mover) : null;

    this.keys.push(keyOf(move));
    if (victim) {
      victim.at = -1; victim.fellAt = ply; victim.killedBy = mover; mover.slain.push(victim);
      this.board[fallAt] = -1;
    }
    this.board[from] = -1; this.board[to] = mover.index; mover.at = to; mover.moved = true;
    // Castling: the Rook makes its own trip.
    if (mover.kind === "k" && Math.abs((to & 7) - (from & 7)) === 2) {
      const rank = from & ~7, rook = this.board[rank | ((to & 7) > (from & 7) ? 7 : 0)];
      if (rook >= 0 && this.soldiers[rook].side === mover.side) {
        const landing = rank | ((to & 7) > (from & 7) ? 5 : 3);
        this.board[this.soldiers[rook].at] = -1; this.board[landing] = rook;
        this.soldiers[rook].at = landing; this.soldiers[rook].moved = true;
      }
    }
    if (mover.born === "p") mover.march = Math.max(mover.march, mover.relativeRank());
    if (move.promotion && mover.kind === "p") { mover.kind = move.promotion; mover.crowned = true; }
    if (victim && before) {
      mover.kills += KILL[victim.kind];
      if (before.renown >= VETERAN || victim.kind === "q") mover.slewRenowned += 1;
      for (const entry of before.avenges) {
        const fallen = this.byId.get(entry.fallen)!;
        this.avenged[mover.index * this.n + fallen.index] += 1;
        mover.avengedFor.push(fallen);
      }
      if (before.avenges.length) mover.avengedCount += 1;
      this.falls.push({
        ply, victim: victim.id, victimKind: victim.kind, side: victim.side, square: squareOf(fallAt), killer: mover.id, killerKind: mover.kind,
        loss: before.loss, renown: before.renown, killerRenown: mover.renown, guard: before.guard, lastGuard: before.lastGuard,
        mourners: before.mourners, avenges: before.avenges,
      });
    }
    this.evaluate(ply);
    this.boards.push(this.board.slice());
  }

  private beforeFall(victim: Figure, killer: Figure) {
    const mourners: Mourner[] = [];
    for (const ally of this.soldiers) {
      if (ally === victim || ally.side !== victim.side || ally.at < 0) continue;
      const bond = bondValue(this.terms(victim.index, ally.index));
      if (bond > 0) mourners.push({ id: ally.id, bond });
    }
    mourners.sort((a, b) => b.bond - a.bond || (a.id < b.id ? -1 : 1));
    const king = this.kings[victim.side];
    const guard = !!king && king.at >= 0 && near(victim.at, king.at) === 1;
    const lastGuard = guard && !this.soldiers.some(f => f !== victim && f !== king && f.side === victim.side && f.at >= 0 && near(f.at, king!.at) === 1);
    const renown = victim.renown;
    // The killer avenges every ally of its own this victim had taken.
    const avenges = victim.slain.filter(f => f.side === killer.side)
      .map(f => ({ fallen: f.id, ply: f.fellAt, bond: bondValue(this.terms(killer.index, f.index)) }));
    const loss: LossKind = victim.kind === "q" ? "royal" : lastGuard ? "last-guard" : renown >= VETERAN ? "veteran"
      : (mourners[0]?.bond ?? 0) >= COMPANION ? "companion" : "stranger";
    return { mourners, guard, lastGuard, renown, avenges, loss };
  }

  /** After a ply (or at the start, ply -1): attacks, threats, cover, dangers shared, time side by side, guard kept, check. */
  private evaluate(ply: number): void {
    const n = this.n, all = this.soldiers, attackers = this.attackers;
    for (const list of attackers) list.length = 0;
    for (const figure of all) if (figure.at >= 0) rays(this.board, figure.kind, figure.side, figure.at, figure.index, attackers);
    const threat = this.threatNow;
    for (const figure of all) {
      threat[figure.index] = 0;
      if (figure.at < 0) continue;
      for (const a of attackers[figure.at]) if (all[a].side !== figure.side) { threat[figure.index] = 1; break; }
    }
    if (ply >= 0) {
      for (const figure of all) {
        if (figure.at < 0) continue;
        if (this.threatBefore[figure.index] && !threat[figure.index]) figure.threats += 1;
        if (threat[figure.index]) for (const a of attackers[figure.at]) if (a !== figure.index && all[a].side === figure.side) this.cover[a * n + figure.index] += 1;
      }
      for (const pair of this.dangerPairs) {
        const i = Math.floor(pair / n), j = pair % n;
        if (all[i].at >= 0 && all[j].at >= 0 && !(threat[i] && threat[j])) this.danger[pair] += 1;
      }
    }
    this.dangerPairs = [];
    const alive = all.filter(figure => figure.at >= 0);
    for (let x = 0; x < alive.length; x += 1) for (let y = x + 1; y < alive.length; y += 1) {
      const a = alive[x], b = alive[y];
      if (a.side !== b.side) continue;
      const d = near(a.at, b.at), i = a.index, j = b.index;
      if (ply >= 0 && d === 1 && (a.moved || b.moved)) this.shoulder[i * n + j] += 1;
      if (threat[i] && threat[j] && d <= 2) this.dangerPairs.push(i * n + j);
    }
    if (ply >= 0) for (const side of ["w", "b"] as const) {
      const king = this.kings[side];
      if (!king || king.at < 0) continue;
      let pressed = false;
      for (let at = 0; at < 64 && !pressed; at += 1) {
        if (near(at, king.at) > 1) continue;
        for (const a of attackers[at]) if (all[a].side !== side) { pressed = true; break; }
      }
      if (pressed) for (const figure of all) if (figure !== king && figure.side === side && figure.at >= 0 && near(figure.at, king.at) === 1) figure.guard += 1;
      if (threat[king.index]) this.checks.push({ ply, side });
    }
    this.threatNow = this.threatBefore; this.threatBefore = threat;
  }

  private terms(i: number, j: number): BondTerms {
    const n = this.n, low = Math.min(i, j) * n + Math.max(i, j);
    return { comrades: this.comrades[low], shoulder: this.shoulder[low], cover: this.cover[i * n + j] + this.cover[j * n + i], danger: this.danger[low], avenged: this.avenged[i * n + j] + this.avenged[j * n + i] };
  }

  private army(side: Side, at: number): ArmyMorale {
    let losses = 0, gains = 0, queen = 0, guardFalls = 0, lastGuard = false, made = 0, suffered = 0;
    for (const fall of this.falls) {
      if (fall.ply >= at) break;
      const renown = Math.min(1, fall.renown / 4), recent = fall.ply >= at - 6;
      if (fall.side === side) {
        losses += .016 * VALUE[fall.victimKind] + .045 * renown + .035 * Math.min(1, (fall.mourners[0]?.bond ?? 0) / 3);
        if (fall.victimKind === "q") queen = .08;
        if (fall.guard) guardFalls += 1;
        if (fall.lastGuard) lastGuard = true;
        if (recent) suffered += 1;
      } else {
        gains += .014 * VALUE[fall.victimKind] + .03 * renown;
        if (recent) made += 1;
      }
    }
    let checks = 0, inCheck = false;
    for (const check of this.checks) {
      if (check.ply >= at) break;
      if (check.side !== side) continue;
      if (check.ply >= at - 8) checks += 1;
      if (check.ply === at - 1) inCheck = true;
    }
    const pressure = checks * .045 + (inCheck ? .05 : 0), momentum = clamp((made - suffered) * .04, -.12, .12), guard = Math.min(.15, guardFalls * .05);
    const value = clamp(.62 - losses + gains - queen - pressure + momentum - guard, .02, .98);
    const mood: MoraleMood = value >= .72 ? "proud" : value >= .5 ? "steady" : value >= .3 ? "shaken" : "breaking";
    const guardLost = Math.max(Math.min(1, guardFalls / 3), lastGuard && this.kingAlone(side, at) ? 1 : 0);
    return { value, mood, losses, gains, queen, pressure, momentum, guard, guardLost };
  }

  /** Nobody of his army stands beside the King after `at` plies. */
  private kingAlone(side: Side, at: number): boolean {
    const board = this.boards[at], king = this.kings[side];
    if (!board || !king) return false;
    const square = board.indexOf(king.index);
    if (square < 0) return false;
    for (let s = 0; s < 64; s += 1) {
      const index = board[s];
      if (index >= 0 && index !== king.index && this.soldiers[index].side === side && near(s, square) === 1) return false;
    }
    return true;
  }

  private briefOf(figure: Figure): Brief {
    const square = figure.square ?? this.falls.find(fall => fall.victim === figure.id)?.square ?? figure.origin;
    return { id: figure.id, side: figure.side, kind: figure.kind, born: figure.born, name: figure.name, square, fell: figure.fell };
  }

  private reasons(a: Figure, b: Figure): string[] {
    const t = this.terms(a.index, b.index), out: string[] = [];
    if (t.comrades) out.push("old comrades from the first line");
    if (t.shoulder >= 3) out.push(`side by side for ${t.shoulder} plies`);
    if (t.cover) out.push(`covered one another ${t.cover} ${t.cover === 1 ? "time" : "times"} under attack`);
    if (t.danger) out.push(`came through ${t.danger === 1 ? "a danger" : `${t.danger} dangers`} together`);
    if (this.avenged[b.index * this.n + a.index]) out.push(`${b.name} avenged ${a.name}`);
    if (this.avenged[a.index * this.n + b.index]) out.push(`${a.name} avenged ${b.name}`);
    return out;
  }

  private deeds(f: Figure): string[] {
    const out: string[] = [];
    const queen = f.slain.find(victim => victim.kind === "q");
    if (queen) out.push("took the enemy Queen");
    const others = f.slain.length - (queen ? 1 : 0);
    if (others) out.push(queen ? `took ${others} more` : `took ${others} of the enemy`);
    if (f.crowned) out.push("marched the length of the field and was crowned");
    else if (f.march >= 6) out.push(`marched to the ${ordinal(f.march)} rank`);
    if (f.threats >= 2) out.push(`outlived ${f.threats} threats`);
    if (f.guard >= 3) out.push(`kept the King's side under attack for ${f.guard} plies`);
    for (const fallen of f.avengedFor) out.push(`avenged ${fallen.name}`);
    return out;
  }
}

/**
 * Reads a game's memory, and keeps reading the same game as it grows: a longer move list that starts with the moves
 * already read costs one ply per new move. Anything else (an Undo, a new game, another start) is read again from the
 * start, so the memory is always exactly the move list's. A returned memory stays valid until the next `read`.
 */
export class BattleChronicle {
  private fold: Fold | null = null;

  read(moves: readonly MemoryMove[], startFen?: string): BattleMemory {
    const placement = placementOf(startFen);
    if (!this.fold || this.fold.placement !== placement || !this.fold.continues(moves)) this.fold = new Fold(placement);
    this.fold.extend(moves);
    return this.fold;
  }

  clear(): void { this.fold = null; }
}

/** The memory of a game: a pure function of its moves (and its starting position, if not the usual one). */
export function readBattle(moves: readonly MemoryMove[], startFen?: string): BattleMemory {
  return new BattleChronicle().read(moves, startFen);
}
