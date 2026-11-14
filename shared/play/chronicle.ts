/**
 * The end-of-battle chronicle: what the battle meant, in a few plain lines, written from the record alone.
 *
 * Chess decides what happens, Crownfall shows how, and this says what it means: which kingdom fell and in how
 * many moves, how its King yielded (he is never slain), who fell defending the crown, and who was renowned. Every
 * statement is read off the moves as played: who stood where, who took whom, who was crowned, who gave the final
 * check. Nothing is invented: no names the record does not hold, no deeds it does not show.
 *
 * Renown comes through a small interface (`RenownSource`). The game gives it the battle memory's own story
 * (shared/play/battle-memory.ts, `storyRenown`), so the chronicle names the renowned, the companions parted and the
 * avengers as the battlefield showed them; `recordRenown` is the plain fallback read off the record alone.
 */
import { Chess, type Move } from "chess.js";
import { soldierName, type BattleStory, type Brief } from "./battle-memory";

export type ChronicleSide = "w" | "b";
export type ChronicleRank = "p" | "n" | "b" | "r" | "q" | "k";

export interface ChronicleRecord {
  /** The game as played. Either its PGN, or its moves in standard notation from `startFen` (the usual start when omitted). */
  readonly pgn?: string;
  readonly sanMoves?: readonly string[];
  readonly startFen?: string;
  readonly result: { readonly winner: ChronicleSide | null; readonly reason: string };
  /** What each side is called: its kingdom when the record knows it ("Solforiz"), otherwise a plain name ("Black"). */
  readonly sides: Readonly<Record<ChronicleSide, string>>;
}

/** One piece's life in the record. */
export interface ChronicleFigure {
  /** Its starting square: how the record tells it apart from the rest of its rank. */
  readonly origin: string;
  readonly side: ChronicleSide;
  /** What it was when the battle ended (or when it fell). */
  rank: ChronicleRank;
  /** What it began as. */
  readonly born: ChronicleRank;
  /** Where it stood at the end (null once it fell). */
  square: string | null;
  /** Those it took, in order. */
  readonly took: { readonly rank: ChronicleRank; readonly side: ChronicleSide; readonly origin: string; readonly ply: number }[];
  fell: { readonly ply: number; readonly by: string } | null;
  crowned: { readonly rank: ChronicleRank; readonly on: string; readonly ply: number } | null;
  gaveMate: boolean;
}

export interface ChronicleFacts {
  readonly figures: readonly ChronicleFigure[];
  readonly plies: number;
  /** The number of the last move, as the move list counts it. */
  readonly moves: number;
  /** The beaten King's square at the end (decisive results). */
  readonly kingSquare: string | null;
  /** The piece that gave the final check (checkmate). */
  readonly mate: ChronicleFigure | null;
}

/** A renowned figure and what it is remembered for: one clause, from the record ("took three"). */
export interface RenownEntry {
  readonly side: ChronicleSide;
  readonly rank: ChronicleRank;
  readonly origin: string;
  readonly deeds: readonly string[];
  /** For a crowned Pawn: what it was born as, so it is named as the record knows it. */
  readonly born?: ChronicleRank;
  /** The battle memory's own name for it ("the King's Knight", "the e-file Pawn, crowned Queen"), when it has one. */
  readonly name?: string;
}
export type RenownSource = (facts: ChronicleFacts, record: ChronicleRecord) => readonly RenownEntry[];

export interface Chronicle {
  readonly title: string;
  readonly lines: readonly string[];
}

const RANK_NAME: Readonly<Record<ChronicleRank, string>> = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };
const PLURAL: Readonly<Record<ChronicleRank, string>> = { p: "Pawns", n: "Knights", b: "Bishops", r: "Rooks", q: "Queens", k: "Kings" };
const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
const word = (n: number) => NUMBERS[n] ?? String(n);
const ORDER: readonly ChronicleRank[] = ["q", "r", "b", "n", "p"];

/** Replays the record and follows every piece from its starting square to its end. */
export function chronicleFacts(record: ChronicleRecord): ChronicleFacts {
  const game = new Chess();
  let moves: Move[];
  if (record.pgn) {
    game.loadPgn(record.pgn);
    moves = game.history({ verbose: true });
  } else {
    if (record.startFen) game.load(record.startFen);
    for (const san of record.sanMoves ?? []) game.move(san);
    moves = game.history({ verbose: true });
  }
  const start = new Chess(moves[0]?.before ?? (record.startFen ?? game.fen()));
  const at = new Map<string, ChronicleFigure>();
  const figures: ChronicleFigure[] = [];
  for (const row of start.board()) for (const cell of row) {
    if (!cell) continue;
    const figure: ChronicleFigure = { origin: cell.square, side: cell.color, rank: cell.type, born: cell.type, square: cell.square, took: [], fell: null, crowned: null, gaveMate: false };
    figures.push(figure);
    at.set(cell.square, figure);
  }
  moves.forEach((move, ply) => {
    const mover = at.get(move.from);
    if (!mover) return;
    if (move.captured) {
      const square = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to;
      const victim = at.get(square);
      if (victim) {
        victim.fell = { ply, by: mover.origin };
        victim.square = null;
        mover.took.push({ rank: victim.rank, side: victim.side, origin: victim.origin, ply });
        at.delete(square);
      }
    }
    at.delete(move.from);
    at.set(move.to, mover);
    mover.square = move.to;
    if (move.promotion) { mover.rank = move.promotion as ChronicleRank; mover.crowned = { rank: move.promotion as ChronicleRank, on: move.to, ply }; }
    if (move.isKingsideCastle() || move.isQueensideCastle()) {
      const rank = move.from[1], [from, to] = move.isKingsideCastle() ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
      const rook = at.get(from);
      if (rook) { at.delete(from); at.set(to, rook); rook.square = to; }
    }
    if (move.san.endsWith("#")) mover.gaveMate = true;
  });
  const plies = moves.length;
  const winner = record.result.winner, loser: ChronicleSide | null = winner ? (winner === "w" ? "b" : "w") : null;
  const king = loser ? figures.find(figure => figure.side === loser && figure.rank === "k" && !figure.fell) ?? null : null;
  const firstNumber = Number((moves[0]?.before ?? start.fen()).split(" ")[5] ?? 1) || 1;
  const blackFirst = (moves[0]?.before ?? start.fen()).split(" ")[1] === "b";
  const lastMove = plies === 0 ? 0 : firstNumber + Math.floor((plies - 1 + (blackFirst ? 1 : 0)) / 2);
  return {
    figures, plies, moves: lastMove, kingSquare: king?.square ?? null,
    mate: record.result.reason === "checkmate" ? figures.find(figure => figure.gaveMate) ?? null : null,
  };
}

/** Who is remembered, read straight off the record: the final check, the most taken, the crowned. */
export const recordRenown: RenownSource = (facts, record) => {
  const entries = new Map<ChronicleFigure, string[]>();
  const add = (figure: ChronicleFigure, deed: string) => { const list = entries.get(figure) ?? []; list.push(deed); entries.set(figure, list); };
  if (facts.mate) add(facts.mate, "gave the final check");
  const takers = facts.figures.filter(figure => figure.took.length >= 2).sort((a, b) => b.took.length - a.took.length || a.origin.localeCompare(b.origin)).slice(0, 2);
  for (const figure of takers) add(figure, `took ${word(figure.took.length)}`);
  for (const figure of facts.figures) {
    const queen = figure.took.find(victim => victim.rank === "q");
    if (queen && !takers.includes(figure)) add(figure, `brought down the ${record.sides[queen.side]} Queen`);
    if (figure.crowned) add(figure, `was crowned a ${RANK_NAME[figure.crowned.rank]} on ${figure.crowned.on}`);
  }
  const ranked = [...entries].sort(([a], [b]) => Number(b === facts.mate) - Number(a === facts.mate) || b.took.length - a.took.length || a.origin.localeCompare(b.origin));
  return ranked.slice(0, 3).map(([figure, deeds]) => ({ side: figure.side, rank: figure.rank, origin: figure.origin, deeds, born: figure.born }));
};

/** "the Queen, both Rooks, a Knight and four Pawns". */
export function fallenList(fallen: readonly ChronicleFigure[]): string {
  const parts: string[] = [];
  for (const rank of ORDER) {
    const count = fallen.filter(figure => figure.rank === rank).length;
    if (!count) continue;
    if (rank === "q") parts.push(count === 1 ? "the Queen" : `${word(count)} Queens`);
    else if (rank === "p") parts.push(count === 1 ? "a Pawn" : count === 8 ? "all eight Pawns" : `${word(count)} Pawns`);
    else parts.push(count === 1 ? `a ${RANK_NAME[rank]}` : count === 2 ? `both ${PLURAL[rank]}` : `${word(count)} ${PLURAL[rank]}`);
  }
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const moveWord = (n: number) => `${n} ${n === 1 ? "move" : "moves"}`;
const DRAWS: Readonly<Record<string, string>> = {
  stalemate: "by stalemate: a King with no move left and none against him",
  threefold: "when the same position came a third time",
  insufficient: "when neither army had enough left to give mate",
  fiftymove: "under the fifty-move rule",
  draw: "by agreement",
};

/**
 * A piece as the record knows it, in the battle memory's own words (battle-memory.ts `soldierName`): by its army and
 * its post in the starting array ("the Aethelgard King's Rook", "the Solforiz Queen", "the Aethelgard e-file Pawn").
 * Not by its starting square alone: "the Rook from h1" read as if it had moved from h1, when it gave mate from d8.
 * A crowned Pawn is named by what it was born as, or, `asNow`, by what it had become ("the e-file Pawn, crowned Queen").
 */
function figureName(entry: { side: ChronicleSide; rank: ChronicleRank; origin: string; born?: ChronicleRank }, sides: ChronicleRecord["sides"], asNow = false): string {
  const born = entry.born ?? entry.rank;
  return `the ${sides[entry.side]} ${unnamed(soldierName(born, entry.origin, asNow ? entry.rank : born))}`;
}

/** The headline alone ("Solforiz fell in 4 moves."), for a small panel (the Quest replay's result line). */
export function chronicleHeadline(record: ChronicleRecord, facts = chronicleFacts(record)): string {
  const { winner, reason } = record.result;
  if (!winner) return `Neither crown fell. A draw after ${moveWord(facts.moves)}.`;
  const loser = record.sides[winner === "w" ? "b" : "w"];
  if (reason === "checkmate") return `${loser} fell in ${moveWord(facts.moves)}.`;
  if (reason === "resignation") return `${loser} yielded after ${moveWord(facts.moves)}.`;
  if (reason === "timeout") return `${loser} ran out of time after ${moveWord(facts.moves)}.`;
  return `${record.sides[winner]} won after ${moveWord(facts.moves)}.`;
}

/**
 * The headline for a replay that has ended (the Quest showcase's result line): a replay does not say which kingdom
 * fielded which side, so the sides are named by colour. Null when the record does not say how it ended, or when
 * the line would not fit `maxLength` characters (the caller keeps its own shorter wording then).
 */
export function replayHeadline(record: { readonly moves: readonly string[]; readonly initialFen?: string; readonly result: string; readonly termination?: string; readonly match?: { readonly reason?: string } }, maxLength = 30): string | null {
  const winner: ChronicleSide | null | undefined = record.result === "1-0" ? "w" : record.result === "0-1" ? "b" : record.result === "1/2-1/2" ? null : undefined;
  const reason = record.match?.reason ?? (record.termination === "checkmate" ? "checkmate" : record.termination === "draw" ? "draw" : null);
  if (winner === undefined || !reason) return null;
  try {
    const line = chronicleHeadline({ sanMoves: record.moves, startFen: record.initialFen, result: { winner, reason }, sides: { w: "White", b: "Black" } });
    return line.length <= maxLength ? line : null;
  } catch { return null; }
}

/** The chronicle, in the game's voice, from the record. */
/** The battle memory's renowned, as the chronicle names them: the most renowned three, with their deeds. */
export function storyRenown(story: BattleStory): RenownSource {
  return () => story.renowned.filter(entry => entry.deeds.length > 0).slice(0, 3).map(({ soldier, deeds }) => ({
    side: soldier.side, rank: soldier.kind, born: soldier.born, origin: soldier.id.split(":")[1] ?? soldier.square, deeds, name: soldier.name,
  }));
}

/**
 * Writes the chronicle. With the battle memory's `story`, it also tells the strongest bond a death broke and an
 * avenging, in the memory's own words and names.
 */
export function writeChronicle(record: ChronicleRecord, renown: RenownSource = recordRenown, story?: BattleStory): Chronicle {
  const facts = chronicleFacts(record);
  const { winner, reason } = record.result;
  const sides = record.sides;
  const lines: string[] = [chronicleHeadline(record, facts)];
  const lost = (side: ChronicleSide) => facts.figures.filter(figure => figure.side === side && figure.fell);
  let title: string;
  if (!winner) {
    title = "Neither crown fell";
    lines[0] = `The battle ended in a draw after ${moveWord(facts.moves)}, ${DRAWS[reason] ?? "by agreement"}.`;
    const white = lost("w"), black = lost("b");
    if (!white.length && !black.length) lines.push("No one fell on either side.");
    else for (const side of ["w", "b"] as const) {
      const list = side === "w" ? white : black;
      lines.push(list.length ? `${sides[side]} lost ${fallenList(list)}.` : `${sides[side]} lost no one.`);
    }
  } else {
    const loser: ChronicleSide = winner === "w" ? "b" : "w";
    title = reason === "checkmate" ? `The fall of ${sides[loser]}` : reason === "resignation" ? `${sides[loser]} yields` : reason === "timeout" ? `${sides[loser]}'s time ran out` : `${sides[winner]} prevails`;
    const square = facts.kingSquare ? ` on ${facts.kingSquare}` : "";
    if (reason === "checkmate") {
      const by = facts.mate ? `, checkmated by ${figureName(facts.mate, sides, true)}` : "";
      lines.push(`Its King was not slain: he yielded${square}${by}.`);
    } else if (reason === "resignation") lines.push(`Its King was not slain: he yielded the field${square}.`);
    else if (reason === "timeout") lines.push(`Its King was not slain: he yielded${square} when his time was gone.`);
    const fallen = lost(loser);
    lines.push(fallen.length ? `Fallen defending the crown: ${fallenList(fallen)}.` : `Not one of ${sides[loser]}'s soldiers fell.`);
    const theirs = lost(winner);
    lines.push(theirs.length ? `${sides[winner]} lost ${fallenList(theirs)}.` : `${sides[winner]} lost no one.`);
  }
  if (story) {
    const parted = story.bondsBroken[0];
    if (parted) lines.push(`Companions parted: ${briefName(parted.fallen, sides)} fell, and ${parted.survivor.name} lost a companion (${parted.reasons.join(", ") || "side by side in the field"}).`);
    const avenging = story.avengers.find(entry => entry.companion) ?? story.avengers[0];
    if (avenging) lines.push(`Avenged: ${briefName(avenging.avenged, sides)}, by ${avenging.avenger.name}${avenging.companion ? ", its companion" : ""}.`);
  }
  const renowned = renown(facts, record);
  if (renowned.length) lines.push(`Renowned: ${renowned.map(entry => `${entry.name ? `the ${sides[entry.side]} ${unnamed(entry.name)}` : figureName(entry, sides)}, who ${joinDeeds(entry.deeds)}`).join("; ")}.`);
  return { title, lines };
}

/** "the King's Knight" as "King's Knight", to follow an army's name ("the Aethelgard King's Knight"). */
const unnamed = (name: string) => name.replace(/^the /, "");
const briefName = (brief: Brief, sides: ChronicleRecord["sides"]) => `the ${sides[brief.side]} ${unnamed(brief.name)}`;

function joinDeeds(deeds: readonly string[]): string {
  if (deeds.length <= 1) return deeds[0] ?? "";
  return `${deeds.slice(0, -1).join(", ")} and ${deeds[deeds.length - 1]}`;
}
