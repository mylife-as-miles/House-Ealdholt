/**
 * The moment of one capture, as the gore tiers read it (goreTiers.ts {@link KillMoment}): who takes whom, how, with
 * what, and whether the capture ends the game or a side. The engine builds it at each capture from the move record
 * and the position after the move (sceneEngine.ts `recordKill`), keeps the {@link GoreShow} it gives per victim,
 * and every system that draws gore asks for it there (`goreShowOf(victim)`).
 *
 * Pure, no three.js: shared/play/kill-moment.test.ts.
 */
import type { ArsenalId } from "../../assets/generated";
import type { Faction, PieceKind } from "../../core/types";
import { weaponOf } from "../death/sever/severPlan";
import type { GoreWeapon } from "./GoreTypes";
import type { KillMoment } from "./goreTiers";

/** What the engine knows of a capture when it is played. */
export interface CaptureRecord {
  attacker: PieceKind;
  /** The attacker's weapon family (its army's arsenal). */
  arsenal: ArsenalId;
  victim: PieceKind;
  victimColor: Faction;
  style: KillMoment["style"];
  /** A Combat Director duel (Pawn takes Pawn): fought with the spear, or the bayonet fixed for it. */
  directed?: boolean;
  /** The move in standard notation: a capture that mates ends in "#". */
  san: string;
  /** The position after the move (FEN). */
  fenAfter: string;
  /** The controller's own word that the move mates, where it has one (its ledger's `mate`). */
  mate?: boolean;
}

/**
 * The weapon of the blow where it is known: steel for a melee kill, powder for a shot, as the figure holds it (one
 * table for the tiers and for dismemberment: death/sever/severPlan.ts weaponOf); a spell or a summon has none. A
 * Combat Director Pawn duel is fought with the spear (Korvenia's line fixes bayonets for it); a rank duel
 * (combat/rankDuel.ts) with the figure's own steel.
 */
export function killWeapon(style: KillMoment["style"], arsenal: ArsenalId, attacker: PieceKind, directed = false): GoreWeapon | undefined {
  if (directed && attacker === "p") return "spear";
  if (directed) return weaponOf(arsenal, attacker);
  if (style === "melee" || style === "gun") return weaponOf(arsenal, attacker);
  return undefined;
}

/** Whether a move in standard notation gives checkmate. */
export function givesMate(san: string): boolean {
  return /#[!?]*$/.test(san.trim());
}

/** Whether `side` has nothing left but its King in a position (FEN): its last piece has just been taken. */
export function lastBesideKing(fen: string, side: Faction): boolean {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  if (!/[kK]/.test(placement)) return false;
  return !(side === "w" ? /[PNBRQ]/ : /[pnbrq]/).test(placement);
}

/** The moment a capture is, for goreShow: the tier is the moment's, before the settings cap it. */
export function killMoment(record: CaptureRecord): KillMoment {
  const moment: KillMoment = { attacker: record.attacker, victim: record.victim, style: record.style };
  const weapon = killWeapon(record.style, record.arsenal, record.attacker, record.directed);
  if (weapon) moment.weapon = weapon;
  if (record.mate || givesMate(record.san)) moment.mate = true;
  if (lastBesideKing(record.fenAfter, record.victimColor)) moment.last = true;
  return moment;
}
