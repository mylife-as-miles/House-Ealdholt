import { Chess, type Move, type Square } from "chess.js";

import { Emitter } from "./emitter";
import {
  type Animator,
  type CapturedPiece,
  type ClockState,
  type DemoOptions,
  type Difficulty,
  type ElapsedState,
  type Faction,
  type GameMode,
  type GameResult,
  type GameSnapshot,
  type HistoryRow,
  type LedgerMove,
  type MoveEvent,
  type PieceKind,
  type SquareId,
  PIECE_VALUE,
} from "./types";
import { AiClient } from "../ai/aiClient";
import { CLOCK_SHARE } from "../ai/protocol";
import { selectCombatSequence, combatComment, combatSequenceFromComment, type CombatSequence } from "../../../shared/play/combat-sequences";
import { encodeShowSeed, newShowSeed, SHOW_SEED_HEADER, withoutVoiceLines } from "../../../shared/play/replay-show";
import type { CombatMemory } from "../scene/combat/director";
import { directPawnDuel, type DuelArmies } from "../scene/combat/pawnDuel";
import { directRankDuel } from "../scene/combat/rankDuel";
import { withCombatRecord } from "../scene/combat/record";

export interface StartOptions {
  mode: GameMode;
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  /** Optional legal position for handcrafted campaign missions and trials. */
  startingFen?: string;
  /** Only read when `mode === "demo"`. */
  demo?: DemoOptions;
  /** The match's own seed (recorded as the PGN's `CFSeed`); a fresh one is drawn when omitted. */
  seed?: number;
}

/**
 * A recorded game to play back through the very path a live move takes (see {@link GameController.beginReplay}).
 * shared/play/replay-show.ts `replayScriptOf` builds one from a validated match record.
 */
export interface ReplaySource {
  initialFen: string;
  /** The opening position's comment (the murmurs said as the game began), where the record has one. */
  openingComment?: string | null;
  /** Each recorded move with its own PGN comment, where the Combat Director's record rides. */
  moves: readonly { from: SquareId; to: SquareId; promotion?: PieceKind; comment: string | null }[];
  /** The match's seed (`CFSeed`), or null for an older record. */
  seed: number | null;
  /** How the record ends: shown, never emitted as a gameover. */
  result: GameResult | null;
  /** The mode the match was played in, and the player's side in a Classic game. */
  mode: GameMode;
  playerColor: Faction;
}

export const DEFAULT_DEMO: DemoOptions = {
  white: "medium",
  black: "medium",
  speed: 1,
  autoRematch: true,
};

/**
 * How long the board sits on the final position before the next showcase game.
 *
 * Exported because the result dialog counts this down on screen: a viewer who is
 * about to be moved on to a fresh duel should be able to see it coming and stop
 * it, rather than have the board reset under them mid-sentence.
 */
export const DEMO_REMATCH_DELAY_MS = 9000;

interface ControllerEvents {
  state: GameSnapshot;
  move: MoveEvent;
  check: Faction;
  gameover: GameResult;
  /** Fires after the renderer has completed the move and state is stable. */
  settled: MoveEvent;
  reset: StartOptions;
  /** A successful takeback, distinct from starting a new Legacy match. */
  rewind: { fen: string };
  /** A replay jumped to another ply without playing the moves between (see {@link GameController.seekReplay}). */
  replaySeek: { ply: number; from: number };
  illegal: { from: SquareId; to: SquareId };
}

/** One square a piece may legally go to, and what kind of move takes it there. */
export interface LegalTarget {
  to: SquareId;
  capture: boolean;
  castle: boolean;
  promotion: boolean;
  /** A capture in passing: the square of the Pawn it takes. Null for every other move. */
  enPassant: SquareId | null;
}

const CLOCK_TICK_MS = 100;
type PositionSnapshot = Pick<GameSnapshot, "turn" | "fen" | "pgn" | "inCheck" | "history" | "sanList" | "moves" | "captured" | "materialDiff" | "lastMove">;

/**
 * Owns all chess state. Rendering, audio and UI subscribe to it; it knows
 * nothing about three.js or the DOM.
 */
export class GameController extends Emitter<ControllerEvents> {
  private chess = new Chess();
  private ai = new AiClient();
  private animator: Animator | null = null;
  private animatorRevision = 0;
  private disposed = false;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private rematchTimer: ReturnType<typeof setTimeout> | null = null;
  /** `performance.now()` stamp the queued showcase rematch is due to fire at. */
  private rematchAt = 0;
  private lastTickAt = 0;
  private generation = 0;
  private paused = false;
  private demoRound = 1;
  /** Resolvers waiting for the showcase to leave the paused state. */
  private resumeWaiters: (() => void)[] = [];

  private status: GameSnapshot["status"] = "idle";
  private options: StartOptions = {
    mode: "ai",
    difficulty: "medium",
    playerColor: "w",
    clockMinutes: null,
  };
  private clock: ClockState = { enabled: false, initialMs: 0, whiteMs: 0, blackMs: 0 };
  /** Wall time already charged to each army, in ms. */
  private elapsed: Record<Faction, number> = { w: 0, b: 0 };
  /** Army the meter is currently charging, or null while idle / paused / over. */
  private timingSide: Faction | null = null;
  private timingSince = 0;
  private result: GameResult | null = null;
  private thinking = false;
  private engineError: string | null = null;
  private busy = false;
  private readonly combatRecords = new Map<string, CombatSequence>();
  /** The army each side fields (ARMY_KINGDOMS names them); the scene sets it with the match's skins. */
  private combatArmies: DuelArmies = { w: "ivory", b: "sun" };
  /** The Combat Director's no-repeat memory after each directed capture, by the ply that fought it. */
  private combatMemory: { ply: number; history: CombatMemory[] }[] = [];
  /** Rebuilt only when board/history/comments change, never on clock ticks. */
  private positionCache: PositionSnapshot | null = null;
  /** The match's seed: what every show-time choice of this game is drawn from (shared/play/replay-show.ts). */
  private matchSeed = 0;
  /** The recorded game being played back, and how many of its moves the board has played. */
  private replay: { source: ReplaySource; ply: number } | null = null;
  private snapshot: GameSnapshot = this.buildSnapshot();

  /** Which kingdom's army each side fields: decides what a Pawn fights with (see pawnCombatant). */
  setCombatArmies(armies: DuelArmies): void {
    this.combatArmies = { w: armies.w, b: armies.b };
  }

  /** Drops the memory of fights that are no longer part of the game (undo). */
  private trimCombatMemory(): void {
    const plies = this.chess.history().length;
    this.combatMemory = this.combatMemory.filter(entry => entry.ply < plies);
  }

  /** The renderer registers an async animator; moves wait for it to finish. */
  setAnimator(animator: Animator | null): () => void {
    if (this.disposed) return () => {};
    const revision = ++this.animatorRevision;
    this.animator = animator;
    return () => { if (this.animatorRevision === revision) this.animator = null; };
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  /**
   * Live per-side elapsed time. Read directly (rather than off the snapshot) by
   * the tally panel, which ticks on its own so a running second never forces the
   * whole interface to re-render.
   */
  getElapsed(): ElapsedState {
    const live: Record<Faction, number> = { w: this.elapsed.w, b: this.elapsed.b };
    if (this.timingSide !== null) {
      live[this.timingSide] += Math.max(0, performance.now() - this.timingSince);
    }
    return { whiteMs: live.w, blackMs: live.b, totalMs: live.w + live.b };
  }

  /**
   * Charges the time since the last sync to whoever was on the move, then
   * re-points the meter at whoever is on the move now. Called on every event
   * that changes who is thinking: a played move, a pause, an undo, the end of
   * the battle.
   */
  private syncElapsed(): void {
    const now = performance.now();
    if (this.timingSide !== null) {
      this.elapsed[this.timingSide] += Math.max(0, now - this.timingSince);
    }
    this.timingSince = now;
    this.timingSide = this.status === "playing" && !this.paused && !this.busy ? (this.chess.turn() as Faction) : null;
  }

  getBoard(): { square: SquareId; kind: PieceKind; color: Faction }[] {
    const out: { square: SquareId; kind: PieceKind; color: Faction }[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        out.push({ square: cell.square, kind: cell.type as PieceKind, color: cell.color as Faction });
      }
    }
    return out;
  }

  /**
   * Destinations for a piece, deduplicated by square (a promotion generates one
   * move per candidate piece) and tagged so the board can colour-code them.
   * `enPassant` is the square of the Pawn a capture in passing takes: not the
   * square the capturing Pawn lands on, so the board marks it as well.
   */
  legalTargets(from: SquareId): LegalTarget[] {
    const moves = this.chess.moves({ square: from as Square, verbose: true }) as Move[];
    const targets = new Map<SquareId, LegalTarget>();
    for (const move of moves) {
      const existing = targets.get(move.to);
      const entry = existing ?? { to: move.to, capture: false, castle: false, promotion: false, enPassant: null };
      entry.capture = entry.capture || move.flags.includes("c") || move.flags.includes("e");
      entry.castle = entry.castle || move.flags.includes("k") || move.flags.includes("q");
      entry.promotion = entry.promotion || move.flags.includes("p");
      if (move.flags.includes("e")) entry.enPassant = `${move.to[0]}${move.from[1]}`;
      targets.set(move.to, entry);
    }
    return [...targets.values()];
  }

  isPromotion(from: SquareId, to: SquareId): boolean {
    const moves = this.chess.moves({ square: from as Square, verbose: true }) as Move[];
    return moves.some((move) => move.to === to && move.flags.includes("p"));
  }

  pieceAt(square: SquareId): { kind: PieceKind; color: Faction } | null {
    const piece = this.chess.get(square as Square);
    if (!piece) return null;
    return { kind: piece.type as PieceKind, color: piece.color as Faction };
  }

  isHumanTurn(): boolean {
    if (this.status !== "playing" || this.busy || this.paused || this.replay) return false;
    if (this.options.mode === "attract" || this.options.mode === "demo") return false;
    if (this.options.mode === "hotseat") return true;
    return this.chess.turn() === this.options.playerColor;
  }

  /**
   * Begins a game. `held` begins it paused, before anything runs: no clock, and no search for a computer that moves
   * first, until `setPaused(false)`. Pausing just after starting is not the same, because by then the computer's
   * first search has already begun, and its deadline (aiClient.ts) runs out if the page is busy meanwhile.
   */
  start(options: StartOptions, { held = false }: { held?: boolean } = {}): void {
    if (this.disposed) return;
    this.generation += 1;
    this.ai.cancel();
    this.clearRematchTimer();
    this.releasePause();
    this.paused = held;
    if (options.mode !== "demo" || this.options.mode !== "demo") this.demoRound = 1;
    this.options = options.mode === "demo" ? { ...options, demo: options.demo ?? DEFAULT_DEMO } : options;
    this.chess = options.startingFen ? new Chess(options.startingFen) : new Chess();
    this.replay = null;
    this.matchSeed = (options.seed ?? newShowSeed()) >>> 0;
    this.chess.setHeader(SHOW_SEED_HEADER, encodeShowSeed(this.matchSeed));
    this.combatRecords.clear();
    this.combatMemory = [];
    this.positionCache = null;
    this.status = "playing";
    this.result = null;
    this.thinking = false;
    this.engineError = null;
    this.busy = false;
    const ms = options.clockMinutes ? options.clockMinutes * 60_000 : 0;
    this.clock = {
      enabled: options.clockMinutes !== null,
      initialMs: ms,
      whiteMs: ms,
      blackMs: ms,
    };
    this.elapsed = { w: 0, b: 0 };
    this.timingSide = null;
    this.syncElapsed();
    this.emit("reset", options);
    this.publish();
    this.startClock();
    void this.maybeRunEngine();
  }

  stop(): void {
    this.generation += 1;
    this.ai.cancel();
    this.clearRematchTimer();
    this.stopClock();
    this.status = "idle";
    this.thinking = false;
    this.engineError = null;
    this.busy = false;
    this.paused = false;
    this.releasePause();
    this.syncElapsed();
    this.publish();
  }

  /** Read-only playback: no clocks, AI, move or gameover events, or match completion. */
  showReplayPosition(fen: string): void {
    const board = new Chess(fen);
    this.stop();
    this.replay = null;
    this.chess = board;
    this.combatRecords.clear();
    this.combatMemory = [];
    this.positionCache = null;
    this.result = null;
    this.clock = { enabled: false, initialMs: 0, whiteMs: 0, blackMs: 0 };
    this.publish();
    this.emit("reset", { ...this.options, startingFen: fen });
  }

  // ------------------------------------------------------ cinematic playback

  /**
   * Plays a recorded game back through the very path a live move takes: each recorded move is committed as the live
   * game committed it (its PGN comment, the Combat Director's record, put back first), so the renderer is handed the
   * same MoveEvent, fight plan and choreography and performs them as it did. Nothing a live game starts is started:
   * no clock, no computer, no input, no Undo or resignation, and the end of the record is shown, never emitted as a
   * gameover (nothing listening for completed matches, Legacy among them, hears a replay). The snapshot keeps the
   * original mode, so the board behaves between moves as it did (a duel's view swings between turns).
   *
   * `ply` is where the board stands to begin with (0, the opening position, by default).
   */
  beginReplay(source: ReplaySource, ply = 0): void {
    if (this.disposed) return;
    this.stop();
    this.options = {
      mode: source.mode, difficulty: this.options.difficulty, playerColor: source.playerColor, clockMinutes: null,
      ...(source.mode === "demo" ? { demo: { white: this.options.difficulty, black: this.options.difficulty, speed: 1, autoRematch: false } } : {}),
    };
    this.clock = { enabled: false, initialMs: 0, whiteMs: 0, blackMs: 0 };
    this.elapsed = { w: 0, b: 0 };
    this.replay = { source, ply: 0 };
    this.matchSeed = (source.seed ?? 0) >>> 0;
    this.placeReplay(ply);
    this.publish();
    this.emit("reset", { ...this.options, startingFen: source.initialFen });
  }

  /**
   * Puts the replay's board at `ply` at once, with the history up to it (the ledger, the comments, the duels' memory),
   * so whatever is played from there is chosen as the game chose it. A move still being performed is abandoned.
   */
  seekReplay(ply: number): void {
    const replay = this.replay;
    if (!replay || this.disposed) return;
    const from = replay.ply;
    this.generation += 1;
    this.busy = false;
    this.placeReplay(ply);
    this.publish();
    this.emit("replaySeek", { ply: replay.ply, from });
  }

  /** Plays the replay's next move as the live game played it. Resolves once it has been performed; false at the end. */
  async stepReplay(): Promise<boolean> {
    const replay = this.replay;
    if (!replay || this.busy || this.disposed || replay.ply >= replay.source.moves.length) return false;
    const recorded = replay.source.moves[replay.ply];
    let move: Move;
    try { move = this.chess.move({ from: recorded.from, to: recorded.to, ...(recorded.promotion ? { promotion: recorded.promotion } : {}) }) as Move; }
    catch { return false; }
    if (recorded.comment) this.chess.setComment(recorded.comment);
    replay.ply += 1;
    const generation = this.generation;
    await this.commit(move);
    if (generation !== this.generation || this.replay !== replay) return false;
    if (replay.ply === replay.source.moves.length) this.concludeReplay();
    return true;
  }

  /** The comment the record keeps for `ply` (0: the opening position), in a replay; null outside one. */
  getReplayComment(ply: number): string | null {
    const source = this.replay?.source;
    if (!source) return null;
    return ply <= 0 ? source.openingComment ?? null : source.moves[ply - 1]?.comment ?? null;
  }

  /**
   * Adds a token to the comment of the position the board stands at (its last move's, or the opening position's
   * before any move): what the show did there that the record must keep for its replay (a line a piece said). A
   * live game only.
   */
  annotate(token: string): void {
    if (this.replay || this.status !== "playing" || this.disposed || !token) return;
    this.chess.setComment([this.chess.getComment() ?? "", token].filter(Boolean).join(" "));
    this.positionCache = null;
  }

  /** The replay's ply and length, or null outside a replay. */
  getReplayPly(): { ply: number; plies: number } | null {
    return this.replay ? { ply: this.replay.ply, plies: this.replay.source.moves.length } : null;
  }

  /** The match's own seed: the live game's, or the record's in a replay; null for an older record that has none. */
  getMatchSeed(): number | null {
    return this.replay && this.replay.source.seed === null ? null : this.matchSeed;
  }

  /** The board, ledger and comments of the replay after its first `ply` moves. */
  private placeReplay(ply: number): void {
    const replay = this.replay!;
    const moves = replay.source.moves;
    const target = Math.max(0, Math.min(moves.length, Math.floor(Number.isFinite(ply) ? ply : 0)));
    this.chess = new Chess(replay.source.initialFen);
    this.combatRecords.clear();
    this.combatMemory = [];
    for (let i = 0; i < target; i += 1) {
      const recorded = moves[i];
      const move = this.chess.move({ from: recorded.from, to: recorded.to, ...(recorded.promotion ? { promotion: recorded.promotion } : {}) }) as Move;
      if (recorded.comment) this.chess.setComment(recorded.comment);
      // The duels' no-repeat memory, as each recorded fight left it, and each capture's choreography as the live move
      // kept it: a directed duel's from its plan (a `[%cfcombat 2 ...]` record names a sequence, not a v1 tuple), any
      // other capture's from the v1 tuple its comment names.
      let choreography: CombatSequence | undefined = combatSequenceFromComment(recorded.comment ?? "") ?? undefined;
      const capture = this.buildCapture(move);
      if (capture && move.piece === "p" && capture.kind === "p") {
        const duel = directPawnDuel({
          color: move.color, from: move.from, to: move.to, victim: capture.square, check: this.chess.isCheck(), armies: this.combatArmies,
          history: this.combatMemory[this.combatMemory.length - 1]?.history ?? [], sanMoves: this.chess.history(), comment: recorded.comment,
        });
        if (duel.direction.kind === "sequence") {
          this.combatMemory.push({ ply: i, history: duel.history });
          choreography = duel.direction.choreography;
        }
      }
      if (choreography) this.combatRecords.set(move.after, choreography);
    }
    replay.ply = target;
    this.positionCache = null;
    this.thinking = false;
    this.engineError = null;
    this.busy = false;
    this.paused = false;
    this.status = "playing";
    this.result = null;
    if (target === moves.length) this.concludeReplay(false);
  }

  /** The end of the record, as the board shows it: the result is set; no gameover is emitted. */
  private concludeReplay(publish = true): void {
    const result = this.replay?.source.result;
    if (!result) return;
    this.status = "over";
    this.result = result;
    if (publish) this.publish();
  }

  // ------------------------------------------------------- showcase controls

  /**
   * Halts the showcase between plies. A search already in flight is allowed to
   * finish, but its move is held back until playback resumes.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused || this.status !== "playing" || this.replay) return;
    if (paused) this.tickClock();
    if (this.status !== "playing") return;
    this.paused = paused;
    if (paused) {
      this.stopClock();
      this.syncElapsed();
    } else {
      this.engineError = null;
      this.releasePause();
      this.syncElapsed();
      this.startClock();
    }
    this.publish();
    if (!paused) void this.maybeRunEngine();
  }

  togglePaused(): void {
    this.setPaused(!this.paused);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Live pacing change — takes effect on the next ply. */
  setDemoSpeed(speed: number): void {
    if (!this.options.demo) return;
    this.options = { ...this.options, demo: { ...this.options.demo, speed: clamp(speed, 0.25, 4) } };
    this.publish();
  }

  setDemoAutoRematch(autoRematch: boolean): void {
    if (!this.options.demo) return;
    this.options = { ...this.options, demo: { ...this.options.demo, autoRematch } };
    if (!autoRematch) this.clearRematchTimer();
    this.publish();
  }

  /** Restart the showcase immediately with the same settings. */
  restartDemo(): void {
    if (this.options.mode !== "demo") return;
    this.demoRound += 1;
    this.start({ ...this.options });
  }

  /**
   * Milliseconds left before the showcase loop starts the next duel, or null
   * when nothing is queued. Read on the dialog's own tick so a running countdown
   * never re-renders the whole interface.
   */
  getDemoRematchRemaining(): number | null {
    if (this.rematchTimer === null) return null;
    return Math.max(0, this.rematchAt - performance.now());
  }

  private releasePause(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && this.status === "playing") {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  private clearRematchTimer(): void {
    if (this.rematchTimer !== null) {
      clearTimeout(this.rematchTimer);
      this.rematchTimer = null;
    }
  }

  async tryMove(from: SquareId, to: SquareId, promotion?: PieceKind): Promise<boolean> {
    if (!this.isHumanTurn()) return false;
    return this.play(from, to, promotion);
  }

  private async play(from: SquareId, to: SquareId, promotion?: PieceKind): Promise<boolean> {
    if (this.status !== "playing" || this.paused || this.busy) return false;
    // Settle the mover's last partial timer tick before chess.move flips the
    // turn, and reject late input before it can change the position.
    this.tickClock();
    if (this.status !== "playing") return false;
    let move: Move | null = null;
    try {
      move = this.chess.move({ from, to, promotion: promotion ?? "q" }) as Move;
    } catch {
      move = null;
    }
    if (!move) {
      this.emit("illegal", { from, to });
      return false;
    }
    await this.commit(move);
    return true;
  }

  private async commit(move: Move): Promise<void> {
    const generation = this.generation;
    this.busy = true;
    // A move taken back and played again says its own lines: none the earlier take recorded at this position.
    if (!this.replay) {
      const comment = this.chess.getComment();
      if (comment && /\[%cfvoice /.test(comment)) { const rest = withoutVoiceLines(comment); if (rest) this.chess.setComment(rest); else this.chess.deleteComment(); }
    }
    // Charge the mover's decision time, then suspend both meters while input
    // is locked by the presentation. The reply starts after the animation.
    this.syncElapsed();

    const capture = this.buildCapture(move);
    const rook = this.buildRookTrip(move);
    const inCheck = this.chess.isCheck();
    const gameOver = this.chess.isGameOver();
    // Pawn takes Pawn (en passant included) is staged by the Combat Director.
    // Its plan is a pure function of the move list, the armies and the fights
    // before it, so the same capture after an Undo is the same fight, and a
    // replay rebuilds it from the record with planFromRecord.
    const ply = this.chess.history().length - 1;
    const duel = capture && move.piece === "p" && capture.kind === "p" ? directPawnDuel({
      color: move.color, from: move.from, to: move.to, victim: capture.square, check: inCheck, armies: this.combatArmies,
      history: this.combatMemory[this.combatMemory.length - 1]?.history ?? [], sanMoves: this.chess.history(), comment: this.chess.getComment(),
    }) : capture ? directRankDuel({
      // A Knight, Rook or King taking a Knight or a Rook is staged the same way, on the rank libraries (rankDuel.ts);
      // it answers undefined for every other capture, which keeps the path below.
      color: move.color, from: move.from, to: move.to, victim: capture.square, attacker: move.piece as PieceKind, defender: capture.kind,
      check: inCheck, armies: this.combatArmies, history: this.combatMemory[this.combatMemory.length - 1]?.history ?? [],
      sanMoves: this.chess.history(), comment: this.chess.getComment(),
    }) : undefined;
    const combat = duel?.direction.kind === "sequence" ? duel.direction : undefined;
    const recent = this.snapshot.moves.map(item => item.choreography).filter((item): item is CombatSequence => !!item);
    // Every other capture, and a Pawn duel the director hands back, keeps the Pawn foundation's selector.
    // A replay keeps the tuple its record names, whatever a later selector would pick.
    const recorded = this.replay && capture && !combat ? combatSequenceFromComment(this.chess.getComment() ?? "") : undefined;
    const choreography = combat ? combat.choreography : recorded ?? (capture ? selectCombatSequence({ attacker: move.piece, defender: capture.kind,
      from: move.from, to: move.to, enPassant: move.flags.includes("e"), recent: recent.slice(-3) }) : undefined);
    if (combat && duel) {
      // For the Pawn foundation's three pairings this is the very same
      // `[%cfcombat 1 ...]` token, so older builds and stored replays read it.
      this.chess.setComment(withCombatRecord(this.chess.getComment(), combat.record));
      this.combatMemory.push({ ply, history: duel.history });
      if (choreography) this.combatRecords.set(this.chess.fen(), choreography);
    } else if (choreography) {
      const previous = (this.chess.getComment() ?? "").replace(/\[%cfcombat[^\]]*\]/g, "").trim();
      this.chess.setComment([previous, combatComment(choreography)].filter(Boolean).join(" "));
      this.combatRecords.set(this.chess.fen(), choreography);
    }
    this.positionCache = null;

    const event: MoveEvent = {
      color: move.color as Faction,
      kind: move.piece as PieceKind,
      from: move.from,
      to: move.to,
      san: move.san,
      capture,
      rook,
      promotion: (move.promotion as PieceKind | undefined) ?? null,
      isCheck: inCheck,
      isGameOver: gameOver,
      ...(choreography ? { choreography } : {}),
      ...(combat ? { combat } : {}),
    };

    this.publish();
    this.emit("move", event);
    if (inCheck) this.emit("check", this.chess.turn() as Faction);

    if (this.animator) {
      try {
        await this.animator(event);
      } catch (error) {
        console.error("[game] animator failed", error);
      }
    }
    if (generation !== this.generation) return;

    // The next player could not act during the renderer's performance. Start
    // their decision time here, including when a frame/asset or effect failed.
    this.lastTickAt = performance.now();
    this.busy = false;
    this.syncElapsed();
    this.publish();
    this.emit("settled", event);

    if (this.status !== "playing" || this.replay) return;
    if (this.checkEnd()) return;
    void this.maybeRunEngine();
  }

  private buildCapture(move: Move): MoveEvent["capture"] {
    if (move.flags.includes("e")) {
      const square = `${move.to[0]}${move.from[1]}`;
      return { square, kind: "p", color: move.color === "w" ? "b" : "w" };
    }
    if (move.captured) {
      return {
        square: move.to,
        kind: move.captured as PieceKind,
        color: move.color === "w" ? "b" : "w",
      };
    }
    return null;
  }

  private buildRookTrip(move: Move): MoveEvent["rook"] {
    if (move.flags.includes("k")) {
      const rank = move.color === "w" ? "1" : "8";
      return { from: `h${rank}`, to: `f${rank}` };
    }
    if (move.flags.includes("q")) {
      const rank = move.color === "w" ? "1" : "8";
      return { from: `a${rank}`, to: `d${rank}` };
    }
    return null;
  }

  private checkEnd(): boolean {
    if (!this.chess.isGameOver()) return false;
    const loser = this.chess.turn() as Faction;
    if (this.chess.isCheckmate()) {
      this.finish({ winner: loser === "w" ? "b" : "w", reason: "checkmate" });
      return true;
    }
    if (this.chess.isStalemate()) {
      this.finish({ winner: null, reason: "stalemate" });
      return true;
    }
    if (this.chess.isThreefoldRepetition()) {
      this.finish({ winner: null, reason: "threefold" });
      return true;
    }
    if (this.chess.isInsufficientMaterial()) {
      this.finish({ winner: null, reason: "insufficient" });
      return true;
    }
    if (this.chess.isDrawByFiftyMoves()) {
      this.finish({ winner: null, reason: "fiftymove" });
      return true;
    }
    this.finish({ winner: null, reason: "draw" });
    return true;
  }

  private finish(result: GameResult): void {
    this.generation += 1;
    this.ai.cancel();
    this.stopClock();
    this.releasePause();
    this.status = "over";
    this.thinking = false;
    this.engineError = null;
    this.busy = false;
    this.result = result;
    this.syncElapsed();
    this.publish();
    this.emit("gameover", result);
    this.scheduleDemoRematch();
  }

  /** Keeps a recording session rolling: a new duel starts on its own. */
  private scheduleDemoRematch(): void {
    if (this.options.mode !== "demo" || !this.options.demo?.autoRematch) return;
    this.clearRematchTimer();
    this.rematchAt = performance.now() + DEMO_REMATCH_DELAY_MS;
    this.rematchTimer = setTimeout(() => {
      this.rematchTimer = null;
      if (this.status !== "over" || this.options.mode !== "demo") return;
      this.demoRound += 1;
      this.start({ ...this.options });
    }, DEMO_REMATCH_DELAY_MS);
  }

  resign(): void {
    if (this.status !== "playing" || this.replay) return;
    const loser =
      this.options.mode === "ai" || this.options.mode === "campaign"
        ? this.options.playerColor
        : (this.chess.turn() as Faction);
    this.finish({ winner: loser === "w" ? "b" : "w", reason: "resignation" });
  }

  /** Ends a campaign mission whose data-driven objective has been satisfied. */
  completeObjective(winner: Faction): void {
    if (this.status !== "playing" || this.replay) return;
    this.finish({ winner, reason: "objective" });
  }

  /** Undo one ply (hotseat) or a full move pair (vs computer). */
  undo(): boolean {
    const wasOver = this.status === "over";
    if (this.replay || (!wasOver && this.status !== "playing") || this.busy || this.thinking || !this.hasUndoTurn(this.snapshot.moves)) return false;
    if (wasOver && this.clock.enabled && (this.clock.whiteMs <= 0 || this.clock.blackMs <= 0)) return false;
    if (!wasOver) { this.tickClock(); if (this.status !== "playing") return false; }
    this.status = "playing"; this.result = null;
    this.generation += 1;
    this.ai.cancel();
    this.combatRecords.delete(this.chess.fen());
    this.chess.undo();
    if (
      (this.options.mode === "ai" || this.options.mode === "campaign") &&
      this.chess.turn() !== this.options.playerColor
    ) {
      this.combatRecords.delete(this.chess.fen());
      this.chess.undo();
    }
    this.trimCombatMemory();
    this.positionCache = null;
    this.thinking = false;
    this.busy = false;
    this.lastTickAt = performance.now();
    if (wasOver) this.startClock();
    this.syncElapsed();
    this.publish();
    this.emit("rewind", { fen: this.chess.fen() });
    return true;
  }

  private async maybeRunEngine(): Promise<void> {
    if (this.status !== "playing" || this.paused || this.busy || this.replay) return;
    const mode = this.options.mode;
    if (mode === "hotseat") return;
    const turn = this.chess.turn() as Faction;
    if ((mode === "ai" || mode === "campaign") && turn === this.options.playerColor) return;
    if (this.thinking) return;

    const generation = this.generation;
    this.thinking = true;
    this.publish();

    const demo = mode === "demo" ? (this.options.demo ?? DEFAULT_DEMO) : null;
    const difficulty: Difficulty =
      mode === "attract" ? "medium" : demo ? (turn === "w" ? demo.white : demo.black) : this.options.difficulty;
    const started = performance.now();
    const remainingMs = this.clock.enabled ? (turn === "w" ? this.clock.whiteMs : this.clock.blackMs) : null;
    const best = await this.ai.bestMove(this.chess.fen(), difficulty, { remainingMs });
    if (generation !== this.generation || this.status !== "playing") {
      return;
    }

    // A tiny floor on think time keeps instant replies from feeling robotic;
    // the showcase lingers longer so captures and camera work land on camera.
    const elapsed = performance.now() - started;
    const base = mode === "attract" ? 900 : demo ? 1150 : 420;
    let floor = demo ? clamp(base / demo.speed, 120, 6000) : base;
    // In time trouble the pause shrinks with the clock, as the search does.
    if (remainingMs !== null) floor = Math.min(floor, remainingMs / CLOCK_SHARE);
    if (elapsed < floor) await wait(floor - elapsed);
    if (generation !== this.generation || this.status !== "playing") {
      return;
    }

    // Pausing holds the finished move back instead of throwing the search away.
    if (this.paused) {
      // Keep ownership of this turn while the ready reply is held. Otherwise
      // resume starts a second search before this continuation can play it.
      await this.waitWhilePaused();
      if (generation !== this.generation || this.status !== "playing") return;
    }

    this.thinking = false;
    if (!best) {
      if (!this.checkEnd()) this.pauseFailedEngine();
      this.publish();
      return;
    }
    const moved = await this.play(best.from, best.to, best.promotion ?? undefined);
    if (!moved && generation === this.generation && this.status === "playing") this.pauseFailedEngine();
  }

  private pauseFailedEngine(): void {
    this.setPaused(true);
    if (this.status !== "playing") return;
    this.engineError = "Computer unavailable. Retry the turn to continue.";
    this.publish();
  }

  private startClock(): void {
    this.stopClock();
    if (!this.clock.enabled || this.paused || this.status !== "playing" || this.replay) return;
    this.lastTickAt = performance.now();
    this.clockTimer = setInterval(() => this.tickClock(), CLOCK_TICK_MS);
  }

  private stopClock(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private tickClock(): void {
    if (!this.clock.enabled || this.status !== "playing" || this.paused) return;
    const now = performance.now();
    const delta = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    if (this.busy) return;
    const turn = this.chess.turn() as Faction;
    const before = turn === "w" ? this.clock.whiteMs : this.clock.blackMs;
    if (turn === "w") this.clock.whiteMs = Math.max(0, this.clock.whiteMs - delta);
    else this.clock.blackMs = Math.max(0, this.clock.blackMs - delta);

    if (this.clock.whiteMs === 0 || this.clock.blackMs === 0) {
      const loser: Faction = this.clock.whiteMs === 0 ? "w" : "b";
      this.finish({ winner: loser === "w" ? "b" : "w", reason: "timeout" });
      return;
    }
    // Clocks are shown in whole seconds (rounded down in one shell, up in the other), so a "state" event, and the
    // panel redraw and sound ramps it sets off, goes out only when the shown second changes, not on every tick
    // (M-07). getSnapshot() still reads the exact time: between events only its clock is refreshed, at no cost.
    const after = turn === "w" ? this.clock.whiteMs : this.clock.blackMs;
    if (Math.floor(after / 1000) !== Math.floor(before / 1000) || Math.ceil(after / 1000) !== Math.ceil(before / 1000)) this.publish();
    else this.snapshot = { ...this.snapshot, clock: { ...this.clock } };
  }

  /** A computer opening alone cannot be undone into an unowned AI turn. */
  private hasUndoTurn(moves: readonly { color: Faction }[]): boolean {
    if (this.options.mode === "demo" || this.options.mode === "attract" || moves.length === 0) return false;
    return this.options.mode === "hotseat" || moves.some(move => move.color === this.options.playerColor);
  }

  private buildPositionSnapshot(): PositionSnapshot {
    const verbose = this.chess.history({ verbose: true }) as Move[];
    const sanList = verbose.map((move) => move.san);
    const history: HistoryRow[] = [];
    for (let i = 0; i < sanList.length; i += 2) {
      history.push({
        number: i / 2 + 1,
        white: sanList[i] ?? null,
        black: sanList[i + 1] ?? null,
      });
    }

    const moves: LedgerMove[] = verbose.map((move, index) => ({
      ply: index,
      number: Math.floor(index / 2) + 1,
      color: move.color as Faction,
      kind: move.piece as PieceKind,
      san: move.san,
      from: move.from,
      to: move.to,
      capture: move.flags.includes("c") || move.flags.includes("e"),
      ...(move.captured ? { captured: move.captured as PieceKind } : {}),
      castle: move.flags.includes("k") || move.flags.includes("q"),
      promotion: (move.promotion as PieceKind | undefined) ?? null,
      check: move.san.endsWith("+"),
      mate: move.san.endsWith("#"),
      ...(this.combatRecords.has(move.after) ? { choreography: this.combatRecords.get(move.after) } : {}),
    }));

    const captured: CapturedPiece[] = [];
    let diff = 0;
    for (const move of verbose) {
      if (!move.captured) continue;
      const kind = move.captured as PieceKind;
      const color: Faction = move.color === "w" ? "b" : "w";
      captured.push({ kind, color });
      diff += color === "b" ? PIECE_VALUE[kind] : -PIECE_VALUE[kind];
    }
    for (const move of verbose) {
      if (!move.promotion) continue;
      const gain = PIECE_VALUE[move.promotion as PieceKind] - PIECE_VALUE.p;
      diff += move.color === "w" ? gain : -gain;
    }

    const last = verbose.length > 0 ? verbose[verbose.length - 1] : null;

    return {
      turn: this.chess.turn() as Faction,
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      inCheck: this.chess.isCheck(),
      history,
      sanList,
      moves,
      captured,
      materialDiff: diff,
      lastMove: last ? { from: last.from, to: last.to } : null,
    };
  }

  private buildSnapshot(): GameSnapshot {
    const position = this.positionCache ?? (this.positionCache = this.buildPositionSnapshot());
    return {
      ...position,
      status: this.status,
      mode: this.options.mode,
      difficulty: this.options.difficulty,
      playerColor: this.options.playerColor,
      thinking: this.thinking,
      engineError: this.engineError,
      busy: this.busy,
      result: this.result,
      clock: { ...this.clock },
      elapsed: this.getElapsed(),
      canUndo:
        (this.status === "playing" || (this.status === "over" && (!this.clock.enabled || (this.clock.whiteMs > 0 && this.clock.blackMs > 0)))) &&
        this.hasUndoTurn(position.moves) &&
        !this.thinking &&
        !this.busy &&
        this.options.mode !== "attract" &&
        this.options.mode !== "demo",
      demo: this.options.mode === "demo" ? { ...(this.options.demo ?? DEFAULT_DEMO) } : null,
      paused: this.paused,
      demoRound: this.demoRound,
      replay: this.getReplayPly(),
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    this.emit("state", this.snapshot);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation += 1; this.animatorRevision += 1; this.replay = null;
    this.animator = null; this.status = "idle"; this.busy = false; this.thinking = false; this.paused = false;
    this.engineError = null;
    this.syncElapsed();
    this.stopClock();
    this.clearRematchTimer();
    this.releasePause();
    this.ai.dispose();
    this.clear();
    this.snapshot = this.buildSnapshot();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
