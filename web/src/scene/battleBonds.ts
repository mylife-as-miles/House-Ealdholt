/**
 * The battle memory (shared/play/battle-memory.ts) as the scene uses it: what each witnessed moment means to each
 * witness (for BoardReactionDirector, through battleEmotion.ts), the army's morale in each figure's carriage, and three
 * hooks for the rest of the game:
 *
 * - `onEmotion`: each fall's meaning as its body comes down (companion, veteran, stranger, royal, last-guard), and each
 *   vengeance (avenged). For the voices; no clip is chosen here.
 * - `onMorale` / `morale`: both armies' morale once each move has settled. For the score.
 * - `story`: the bonds broken, the renowned and the avengers. For the end-of-battle story.
 * - `witnessKind`: who a fallen comrade was to each witness, for the voices (BoardVoices.witnessKind).
 *
 * Nothing is remembered here but the listeners: every answer is read from the controller's move list when asked (the
 * memory folds one new ply per move and re-reads after an Undo), so a rebuilt board or a replay of the same moves means
 * the same. It never touches a move, a clock or a result. Pure: no three.js.
 */
import { BattleChronicle, COMPANION, VETERAN, startingFen, type BattleMemory, type BattleMorale, type BattleStory, type Fall, type LossKind, type Side } from "../../../shared/play/battle-memory";
import type { MoveFacts, Witness } from "../../../shared/play/gambit-barks";
import type { WitnessKind } from "../../../shared/play/gambit-sound";
import type { Faction, GameSnapshot, PieceKind, SquareId } from "../core/types";
import { BOND_SCALE, type ReactionMeaning } from "./battleEmotion";
import type { BoardReactionEventKind } from "./boardReactionDirector";

/** A figure as an emotion event names it. */
export interface EmotionFigure {
  /** The memory's identity: side and starting square ("w:g1"), kept through a promotion. */
  readonly id: string;
  readonly side: Faction;
  readonly kind: PieceKind;
  /** "the King's Knight", "the e-file Pawn, crowned Queen". The kingdom's name is the reader's to add. */
  readonly name: string;
  /** Where it stands, or where it fell. */
  readonly square: SquareId;
  readonly renown: number;
}

export type BattleEmotionKind = LossKind | "avenged";

/** One moment of the battle's meaning: a fall, or a vengeance. */
export interface BattleEmotionEvent {
  readonly kind: BattleEmotionKind;
  /** The army that feels it: the fallen's for a loss, the avenger's for "avenged". */
  readonly side: Faction;
  /** The ply of the capture (0-based half-move). */
  readonly ply: number;
  /** This capture: who fell, and who took it. */
  readonly fallen: EmotionFigure;
  readonly killer: EmotionFigure;
  /** The fallen's closest survivor and their bond (1 is old comrades, 2 companions), when anyone had one. */
  readonly bond: { readonly survivor: EmotionFigure; readonly strength: number; readonly companion: boolean } | null;
  /** "avenged": the earlier fallen this capture avenges (the avenger's companion first), and the avenger's bond to it. */
  readonly avenged: { readonly fallen: EmotionFigure; readonly companion: boolean; readonly bond: number } | null;
  /** Both armies' morale once this capture is counted. */
  readonly morale: { readonly w: number; readonly b: number };
}

/** A standing figure as the scene knows it: its observer id and its square. */
export interface BondsActor { readonly id: string; readonly square: string; }

/** The army's morale on one figure: see LivingPieceRig.setMood. */
export interface BattleMood { readonly slump: number; readonly tension: number; readonly pride: number; }

/** A figure that can carry a mood (PieceView). */
export interface MoodBearer { setBattleMood(slump: number, tension: number, pride: number, immediate?: boolean): void; }

/** Where each army's figures face at rest: White toward the eighth rank (-z), Black toward the first. */
export const HOME_FACING: Readonly<Record<Faction, { readonly x: number; readonly z: number }>> = { w: { x: 0, z: -1 }, b: { x: 0, z: 1 } };

const NO_MOOD: BattleMood = { slump: 0, tension: 0, pride: 0 };
const unit = (value: number) => Math.min(1, Math.max(0, value));

export class BattleBonds {
  private readonly chronicle = new BattleChronicle();
  private readonly emotionListeners = new Set<(event: BattleEmotionEvent) => void>();
  private readonly moraleListeners = new Set<(morale: BattleMorale) => void>();
  private readonly told = new Set<string>();
  private moraleKey = "";
  /** Figures already given a mood: a new one (a rebuilt board, a crowned Pawn) takes it at once instead of easing in. */
  private readonly placed = new WeakSet<MoodBearer>();
  /** The history the moods were last given for: one more move is felt over seconds, any other change shown at once. */
  private moodHistory: { plies: number; last: string } | null = null;

  /** The memory of the game the snapshot is at. */
  memory(snapshot: Pick<GameSnapshot, "moves" | "pgn">): BattleMemory {
    return this.chronicle.read(snapshot.moves, startingFen(snapshot.pgn));
  }

  /**
   * What a reaction event means to the witnesses in `roster`. A move's start, its blow and its fall are watched from the
   * board before it (the figures standing still have not moved); a check from the board after it. An avenging has its
   * own call, {@link avenging}.
   */
  meaning(type: BoardReactionEventKind, snapshot: GameSnapshot, roster: readonly BondsActor[]): ReactionMeaning | undefined {
    const memory = this.memory(snapshot), ply = memory.plies - 1;
    if (ply < 0 || memory.plies !== snapshot.moves.length) return undefined;
    if (type === "move-started") {
      const mover = memory.soldier(memory.occupant(snapshot.moves[ply].from, ply) ?? "");
      return mover?.feared ? { feared: true, side: mover.side } : undefined;
    }
    if (type === "check") {
      if (snapshot.busy) return undefined;
      const guardLost = memory.morale()[snapshot.turn as Side].guardLost;
      return guardLost > 0 ? { guardLost } : undefined;
    }
    if (type !== "capture-impact" && type !== "ally-fallen") return undefined;
    const fall = memory.fallAt(ply);
    if (!fall) return undefined;
    const mourners = new Map(fall.mourners.map(m => [m.id, m.bond]));
    const bonds: Record<string, number> = {};
    let king: string | undefined;
    for (const actor of roster) {
      const id = memory.occupant(actor.square, ply);
      if (!id) continue;
      const bond = mourners.get(id) ?? 0;
      if (bond > 0) bonds[actor.id] = unit(bond / BOND_SCALE);
      if (fall.guard && memory.soldier(id)?.kind === "k" && memory.soldier(id)?.side === fall.side) king = actor.id;
    }
    return { loss: fall.loss, bonds, renown: unit(fall.renown / 4), ...(king ? { king } : {}) };
  }

  /**
   * The avenger's moment, once it has landed on the square it took: null unless the last capture took the killer of one
   * of its own. `roster` is the board after the move. Returns the meaning, where the avenged fell, and the avenger's square.
   */
  avenging(snapshot: GameSnapshot, roster: readonly BondsActor[]): { meaning: ReactionMeaning; fellAt: SquareId; avenger: SquareId } | null {
    const memory = this.memory(snapshot), ply = memory.plies - 1;
    const fall = ply >= 0 && memory.plies === snapshot.moves.length ? memory.fallAt(ply) : null;
    const entry = fall ? headline(fall) : null;
    const avenger = fall ? memory.soldier(fall.killer) : null;
    const earlier = entry ? memory.fallAt(entry.ply) : null;
    if (!fall || !entry || !avenger?.square || !earlier) return null;
    const bonds: Record<string, number> = {};
    let id: string | undefined;
    for (const actor of roster) {
      const who = memory.occupant(actor.square);
      if (!who) continue;
      if (who === fall.killer) id = actor.id;
      const bond = memory.bond(who, entry.fallen);
      if (bond > 0) bonds[actor.id] = unit(bond / BOND_SCALE);
    }
    if (!id) return null;
    return { meaning: { avenger: id, companion: entry.bond >= COMPANION, bonds }, fellAt: earlier.square, avenger: avenger.square };
  }

  /**
   * Tells the listeners what the last capture means: the fall, then the vengeance if it was one. Once per capture and
   * board (`revision`): the same fall told again after an Undo and a replay is a new telling.
   */
  tell(snapshot: GameSnapshot, revision: number): void {
    if (!this.emotionListeners.size) return;
    const memory = this.memory(snapshot), ply = memory.plies - 1;
    const fall = ply >= 0 && memory.plies === snapshot.moves.length ? memory.fallAt(ply) : null;
    const key = `${revision}:${ply}`;
    if (!fall || this.told.has(key)) return;
    this.told.add(key);
    if (this.told.size > 64) this.told.delete(this.told.values().next().value!);
    const morale = memory.morale(), figure = (id: string) => this.figure(memory, id);
    const survivor = fall.mourners[0];
    const loss: BattleEmotionEvent = {
      kind: fall.loss, side: fall.side, ply, fallen: figure(fall.victim), killer: figure(fall.killer),
      bond: survivor ? { survivor: figure(survivor.id), strength: survivor.bond, companion: survivor.bond >= COMPANION } : null,
      avenged: null, morale: { w: morale.w.value, b: morale.b.value },
    };
    this.emit(loss);
    const entry = headline(fall);
    if (entry) this.emit({ ...loss, kind: "avenged", side: other(fall.side), avenged: { fallen: figure(entry.fallen), companion: entry.bond >= COMPANION, bond: entry.bond } });
  }

  /**
   * Who a fallen comrade was to a witness standing beside it, for the voices (BoardVoices.witnessKind, asked as the move
   * is announced): royal for the Queen or the King's last guard; companion when the memory's bond says so, though the
   * board alone saw no pair standing still (a pair that marched or fought together); veteran for a fallen of renown.
   * The witness's own bond comes first: to a companion, the fallen is a companion before it is a name. Null for
   * anything weaker, or a move the memory cannot place: the rules' own answer from the board stands.
   */
  witnessKind(snapshot: GameSnapshot, facts: MoveFacts, witness: Witness): WitnessKind | null {
    const memory = this.memory(snapshot), ply = memory.plies - 1;
    const fall = facts.capture && ply >= 0 && memory.plies === snapshot.moves.length ? memory.fallAt(ply) : null;
    if (!fall || fall.square !== facts.capture?.square) return null;
    if (fall.victimKind === "q" || fall.lastGuard) return "royal";
    const id = memory.occupant(witness.square, ply);
    if ((fall.mourners.find(mourner => mourner.id === id)?.bond ?? 0) >= COMPANION) return "companion";
    return fall.renown >= VETERAN ? "veteran" : null;
  }

  /**
   * Whether the last capture avenges a fallen comrade, for the voices (BoardVoices.avenged): the memory remembers every
   * killing of the game, so a vengeance the board's few plies have forgotten is still one, and the avenger speaks when
   * the battlefield honours it (honourAvenger). Null for a move the memory cannot place: the rules' answer stands.
   */
  avenged(snapshot: GameSnapshot, facts: MoveFacts): boolean | null {
    const memory = this.memory(snapshot), ply = memory.plies - 1;
    const fall = facts.capture && ply >= 0 && memory.plies === snapshot.moves.length ? memory.fallAt(ply) : null;
    if (!fall || fall.square !== facts.capture?.square) return null;
    return fall.avenges.length > 0;
  }

  /** Each standing figure's mood, by square, for the board after the last move. */
  moods(snapshot: GameSnapshot): (square: string) => BattleMood {
    const memory = this.memory(snapshot);
    if (memory.plies !== snapshot.moves.length) return () => NO_MOOD;
    const morale = memory.morale();
    const army = (side: Side) => {
      const m = morale[side];
      // Below steady the army sags; well above it, it stands proud. An army under checks is tense; its King more so,
      // and more again as his guard falls.
      const slump = unit((.5 - m.value) / .35), pride = unit((m.value - .72) / .2), tension = unit(m.pressure * 1.5);
      return { soldier: { slump, tension: Math.min(.5, tension), pride }, king: { slump: slump * .5, tension: unit(m.guardLost * .8 + m.pressure * 3), pride } };
    };
    const sides = { w: army("w"), b: army("b") };
    return square => {
      const soldier = memory.soldier(memory.occupant(square) ?? "");
      return soldier ? sides[soldier.side][soldier.kind === "k" ? "king" : "soldier"] : NO_MOOD;
    };
  }

  /**
   * Gives every standing figure its army's mood for the board after the last move. One more move is felt over seconds;
   * any other change of history (an Undo, a replay's seek, a new game) is shown at once, so no figure kept standing
   * through it carries the mood of a moment that is no longer the board's.
   */
  applyMoods(snapshot: GameSnapshot, pieces: ReadonlyMap<string, MoodBearer>): void {
    const mood = this.moods(snapshot), plies = snapshot.moves.length;
    const at = (index: number) => { const move = snapshot.moves[index]; return move ? `${move.from}${move.to}${move.promotion ?? ""}` : ""; };
    const before = this.moodHistory, last = at(plies - 1);
    const onward = !!before && ((plies === before.plies + 1 && at(plies - 2) === before.last) || (plies === before.plies && last === before.last));
    for (const [square, piece] of pieces) {
      const { slump, tension, pride } = mood(square);
      piece.setBattleMood(slump, tension, pride, !onward || !this.placed.has(piece));
      this.placed.add(piece);
    }
    this.moodHistory = { plies, last };
  }

  /** Both armies' morale as the board shows it: while a move is still being played, the morale before it. */
  morale(snapshot: GameSnapshot): BattleMorale {
    const memory = this.memory(snapshot);
    return memory.morale(snapshot.busy ? memory.plies - 1 : memory.plies);
  }

  /** Tells the morale listeners once a move has settled and the morale has changed (a move, an Undo, a new game). */
  publishMorale(snapshot: GameSnapshot): void {
    if (snapshot.busy || !this.moraleListeners.size) return;
    const morale = this.morale(snapshot), key = `${snapshot.pgn.length}:${morale.ply}:${morale.w.value.toFixed(4)}:${morale.b.value.toFixed(4)}`;
    if (key === this.moraleKey) return;
    this.moraleKey = key;
    for (const listener of [...this.moraleListeners]) {
      try { listener(morale); } catch (error) { console.warn("[bonds] morale listener failed", error); }
    }
  }

  story(snapshot: GameSnapshot): BattleStory { return this.memory(snapshot).story(); }

  onEmotion(listener: (event: BattleEmotionEvent) => void): () => void {
    this.emotionListeners.add(listener);
    return () => { this.emotionListeners.delete(listener); };
  }

  onMorale(listener: (morale: BattleMorale) => void): () => void {
    this.moraleListeners.add(listener);
    return () => { this.moraleListeners.delete(listener); };
  }

  private emit(event: BattleEmotionEvent): void {
    for (const listener of [...this.emotionListeners]) {
      try { listener(event); } catch (error) { console.warn("[bonds] emotion listener failed", error); }
    }
  }

  private figure(memory: BattleMemory, id: string): EmotionFigure {
    const soldier = memory.soldier(id), brief = memory.brief(id);
    return { id, side: soldier?.side ?? "w", kind: soldier?.kind ?? "p", name: soldier?.name ?? id, square: brief?.square ?? "", renown: soldier?.renown ?? 0 };
  }
}

const other = (side: Side): Side => (side === "w" ? "b" : "w");

/** The vengeance a capture is told as: the avenger's companion first, then the closest bond, then the latest fallen. */
function headline(fall: Fall): Fall["avenges"][number] | null {
  let best: Fall["avenges"][number] | null = null;
  for (const entry of fall.avenges) if (!best || entry.bond > best.bond || (entry.bond === best.bond && entry.ply > best.ply)) best = entry;
  return best;
}
