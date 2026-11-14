/**
 * The pieces' voices on the board: the scene's side of shared/play/gambit-barks.ts. It reads each move as the game
 * controller announces it, asks the rules who speaks about it and when, and has the mixer say it at the moment it
 * belongs to: as the unseen hand lifts the piece, as the piece lands, as the castling rook lands, as a promoted piece
 * is remade. It murmurs as a game begins and speaks into a long silence, plays the hand's pull and release and each
 * figure's gear and footfalls by what it wears, and keeps each footsoldier's voice for the whole game, so the voice
 * that asked "who moved me?" is the voice that pleads and dies. The menu's background board hears none of it.
 *
 * Each line that sounds is handed to the host (`spoke`) for the match record; a replay hands back what its record
 * says was spoken at each ply (`recorded`), and the board says exactly those lines at their moments instead of
 * choosing again (shared/play/replay-show.ts, docs/PLAY_REPLAYS.md).
 */
import type * as THREE from "three";
import { audio } from "../audio/audioManager";
import type { Faction, GameSnapshot, MoveEvent, SquareId } from "../core/types";
import type { PieceView } from "./pieces";
import { worldToSquare } from "./board";
import {
  ANSWER_GAP, barkGap, barkSeed, emptyBarkMemory, IDLE_AGAIN, IDLE_FIRST, IDLE_MAX, lastMoveFacts, MURMUR_AT, MURMUR_SLOTS, MURMUR_WAIT, newGameBarkMemory, nextAmbientVoice,
  nextBark, planBarks, planEvents, seededRandom, takeAmbientVoice, takeBark, type BarkPlan, type MoveFacts, type PieceAt, type Witness,
} from "../../../shared/play/gambit-barks";
import { gearOf, pawnSlot, STEP_TIMBRE, voiceId, type GambitKingdom, type GambitTimbre, type WitnessKind } from "../../../shared/play/gambit-sound";
import type { RecordedVoiceLine, VoiceMoment } from "../../../shared/play/replay-show";

/** What the adapter needs from the scene. */
export interface BoardVoicesHost {
  /** The menu's background board: no voices, no hand, no gear. */
  silent(): boolean;
  snapshot(): GameSnapshot;
  /** The figure standing on a square now (the engine's own map). */
  pieceAt(square: SquareId): PieceView | undefined;
  /** Every figure standing on the board. */
  pieces(): Iterable<[SquareId, PieceView]>;
  /** Where a point sits across the screen, -1..1 (the engine's stereo pan). */
  pan(position: THREE.Vector3): number;
  /** Whether the camera can see a point: no hand and no gear for a figure it cannot. */
  onScreen(position: THREE.Vector3): boolean;
  /** The kingdom a side fields (its army id). */
  kingdom(side: Faction): GambitKingdom;
  /** A line has sounded: the record keeps it for the replay. */
  spoke?(line: RecordedVoiceLine): void;
  /** In a replay, the lines its record says were spoken at `ply` (0: as the game began); null in a live game. */
  recorded?(ply: number): readonly RecordedVoiceLine[] | null;
}

/** Seconds into a move that a lifted piece speaks: the hand has it and its first step is down. */
const LIFT_DELAY = 0.22;
/** Seconds after landing that it speaks: its boots on the stone first. */
const LAND_DELAY = 0.12;
/** The promoted piece speaks as its new figure fades in. */
const PROMOTED_DELAY = 0.3;
/** How often a line that waits for the floor asks again. */
const WAIT_STEP = 0.1;
/** A piece the player has just chosen was already taken by the hand: its move does not pull twice. */
const LIFT_MEMORY_MS = 60_000;
/** How long a recorded line waits for the floor in a replay beyond the moment it was said, before it is given up. */
const RECORDED_WAIT = 2.5;
/** In a replay, the beat before a line said into the silence after a move (the silence itself is not replayed), and between two. */
const RECORDED_IDLE_BEAT = 1;

export class BoardVoices {
  private memory = emptyBarkMemory();
  /** Each footsoldier's voice, kept for the game (gambit-sound.ts pawnSlot). */
  private readonly slots = new WeakMap<PieceView, "p1" | "p2">();
  /** The move being performed: its facts and who is to speak in it. */
  private move: { ply: number; facts: MoveFacts; plans: BarkPlan[]; san: string[]; recorded: readonly RecordedVoiceLine[] | null } | null = null;
  /** When the game's bell rang and the last move settled (audio clock): what a recorded murmur's or idle line's offset counts from. */
  private bellAt: number | null = null;
  private settledAt: number | null = null;
  /** Until when (audio clock) a line this board said is sounding. */
  private speakingUntil = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private idleSpoken = 0;
  private lifted: { square: SquareId; at: number } | null = null;
  /** Bumped by every interruption: a line still waiting for the floor from before it gives up. */
  private generation = 0;
  /**
   * Who a fallen comrade was to a witness, when a fuller memory of the battle knows better than the board's own
   * history (gambit-barks.ts witnessKind): return null to keep the rules' own answer.
   */
  witnessKind: ((facts: MoveFacts, witness: Witness) => WitnessKind | null) | null = null;
  /** Whether a capture avenges a comrade, from the battle's memory (gambit-barks.ts BarkContext.avenged): the same
   * vengeance the battlefield honours. Null keeps the rules' own answer. */
  avenged: ((facts: MoveFacts) => boolean | null) | null = null;

  constructor(private readonly host: BoardVoicesHost) {}

  /** The voice a figure speaks in ("kwind_p2"): a footsoldier keeps the one its starting file gave it. */
  voiceOf(view: PieceView): string {
    const kingdom = this.host.kingdom(view.color);
    if (view.kind !== "p") return voiceId(kingdom, view.kind);
    let slot = this.slots.get(view);
    if (!slot) {
      const square = worldToSquare(view.container.position.x, view.container.position.z);
      slot = pawnSlot(square ?? "a1");
      this.slots.set(view, slot);
    }
    return voiceId(kingdom, "p", slot);
  }

  /** What a figure's feet sound like, by what its kingdom puts on them (gambit-sound.ts STEP_TIMBRE). */
  stepTimbre(view: PieceView, fallback: GambitTimbre): GambitTimbre {
    return STEP_TIMBRE[this.host.kingdom(view.color)]?.[view.kind] ?? fallback;
  }

  /** Whether a footfall at this point should sound at all: not for a step the camera cannot see. */
  stepHeard(position: THREE.Vector3): boolean {
    return this.host.onScreen(position);
  }

  /** A new game: the voices are handed out by file, the plies start again, and two pieces murmur after the bell. */
  gameBegins(): void {
    this.interrupt();
    if (this.host.silent()) return;
    audio.setKingdoms({ w: this.host.kingdom("w"), b: this.host.kingdom("b") });
    this.memory = newGameBarkMemory(this.memory);
    for (const [square, view] of this.host.pieces()) if (view.kind === "p") this.slots.set(view, pawnSlot(square));
    // The murmurs come seconds after the bell: their lines are fetched now, ahead of the rest.
    for (const side of ["w", "b"] as const) for (const slot of MURMUR_SLOTS) audio.clipReady(`${this.host.kingdom(side)}_${slot}_murmur_1`);
    this.bellAt = audio.now();
    // A replay says the murmurs its record kept, when they were said.
    const recorded = this.host.recorded?.(0);
    if (recorded) { for (const line of recorded) if (line.moment === "murmur") this.speakRecorded(line, 0, () => true); return; }
    const generation = this.generation;
    const random = seededRandom(barkSeed([], `murmur:${this.host.kingdom("w")}:${this.host.kingdom("b")}`));
    const first: Faction = random() < 0.5 ? "w" : "b";
    const begun = audio.now();
    MURMUR_AT.forEach((at, i) => {
      const side: Faction = i === 0 ? first : first === "w" ? "b" : "w";
      // The second waits for the first to end, a moment, never longer than MURMUR_WAIT; neither once the game has moved,
      // nor when the page was too busy to say it in time (its timers held, the mixer's clock ran on).
      const attempt = (waited: number) => {
        const now = audio.now();
        if (begun !== null && now !== null && now - begun > at + MURMUR_WAIT + 0.5) return;
        if (generation !== this.generation || this.ambient(side, "murmur", random) !== "busy") return;
        if (waited + WAIT_STEP <= MURMUR_WAIT) this.later(WAIT_STEP, () => attempt(waited + WAIT_STEP));
      };
      this.later(at, () => attempt(0));
    });
  }

  /**
   * A move is played (the controller's "move", before its performance): what it did, who will speak about it, the
   * hand taking the piece and the piece's gear as it sets off, and a line said as it is lifted.
   */
  moved(event: MoveEvent): void {
    this.cancelIdle();
    this.move = null;
    if (this.host.silent()) return;
    const snapshot = this.host.snapshot();
    const facts = lastMoveFacts(snapshot.pgn);
    if (!facts || facts.from !== event.from || facts.to !== event.to) return;
    const ply = snapshot.sanList.length;
    const speed = snapshot.mode === "demo" ? snapshot.demo?.speed ?? 1 : 1;
    // A replay does not choose: it says what its record kept for this ply.
    const recorded = this.host.recorded?.(ply) ?? null;
    const plans = recorded ? [] : planBarks(facts, seededRandom(barkSeed(snapshot.sanList, "plan")), {
      ply, speed, memory: this.memory, voiceOf: (piece) => this.voiceAt(piece), ...(this.witnessKind ? { witnessKind: this.witnessKind } : {}), ...(this.avenged ? { avenged: this.avenged } : {}),
    });
    this.move = { ply, facts, plans, san: [...snapshot.sanList], recorded };
    const view = this.host.pieceAt(event.from);
    if (view && this.host.onScreen(view.container.position)) {
      const pan = this.host.pan(view.container.position);
      if (!(this.lifted && this.lifted.square === event.from && performance.now() - this.lifted.at < LIFT_MEMORY_MS)) audio.trance("pull", { pan });
      audio.gear(gearOf(this.host.kingdom(view.color), view.kind), { pan, delay: 0.12 });
    }
    this.lifted = null;
    for (const plan of plans) if (plan.moment === "lift") this.say(plan, { delay: LIFT_DELAY });
    this.sayRecorded("lift", LIFT_DELAY);
  }

  /** The mover has landed on its square (after its fight, if it fought): its own line, or the piece it threatens. */
  landed(event: MoveEvent): void {
    if (this.move?.facts.to !== event.to) return;
    for (const plan of this.move.plans) if (plan.moment === "land") this.say(plan, { delay: LAND_DELAY });
    this.sayRecorded("land", LAND_DELAY);
  }

  /** A castling's rook has landed beside its king: its answer. */
  rookLanded(event: MoveEvent): void {
    if (this.move?.facts.to !== event.to) return;
    for (const plan of this.move.plans) if (plan.moment === "rook") this.say(plan, { delay: LAND_DELAY, gap: ANSWER_GAP });
    this.sayRecorded("rook", LAND_DELAY);
  }

  /** A footsoldier has been remade as it lands: from now on it speaks as what it became. */
  promoted(event: MoveEvent): void {
    if (this.move?.facts.to !== event.to) return;
    for (const plan of this.move.plans) if (plan.moment === "promoted") this.say(plan, { delay: PROMOTED_DELAY, gap: ANSWER_GAP });
    this.sayRecorded("promoted", PROMOTED_DELAY);
  }

  /** The move's performance is over and the board waits: after a long silence, someone on the side to move speaks. */
  settled(): void {
    this.idleSpoken = 0;
    this.settledAt = audio.now();
    const recorded = this.move?.recorded ?? (this.host.recorded?.(this.host.snapshot().sanList.length) ?? null);
    if (!recorded) { this.armIdle(IDLE_FIRST); return; }
    // The silence the live game waited through is not replayed: what was said into it comes after a beat, line by line.
    let at = RECORDED_IDLE_BEAT;
    for (const line of recorded) if (line.moment === "idle") { this.speakRecorded({ ...line, offset: at }, 0, () => true); at += audio.clipLength(line.clip) + RECORDED_IDLE_BEAT; }
  }

  /** The player chooses a piece: the hand takes hold of it. False on the menu's board (its wooden tick stays). */
  lift(view: PieceView): boolean {
    if (this.host.silent()) return false;
    const square = worldToSquare(view.container.position.x, view.container.position.z);
    if (square) this.lifted = { square, at: performance.now() };
    if (this.host.onScreen(view.container.position)) audio.trance("pull", { pan: this.host.pan(view.container.position) });
    return true;
  }

  /** A figure is set down on its square: the hand lets go. False on the menu's board (its wooden knock stays). */
  setDown(view: PieceView, strength = 1): boolean {
    if (this.host.silent()) return false;
    if (this.host.onScreen(view.container.position)) {
      audio.trance("release", { pan: this.host.pan(view.container.position), volume: Math.min(1.2, 0.7 + strength * 0.3) });
    }
    return true;
  }

  /** Undo, a new game or leaving: whatever is being said stops with a short fade, and nothing waiting is said. */
  interrupt(): void {
    this.generation += 1;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.cancelIdle();
    this.move = null;
    audio.silenceBarks();
  }

  dispose(): void {
    this.interrupt();
  }

  // ------------------------------------------------------------- inside

  /** The voice a planned speaker would use, from the figure on its square (the rules pass over a resting voice). */
  private voiceAt(piece: PieceAt): string {
    const view = this.host.pieceAt(piece.square);
    if (view && view.kind === piece.rank && view.color === piece.side) return this.voiceOf(view);
    return voiceId(this.host.kingdom(piece.side), piece.rank, pawnSlot(piece.square));
  }

  /**
   * Says a planned line if the floor is free (gambit-barks.ts barkMaySound): only from a figure still standing where
   * the plan put it, never from one slain or being claimed. A line that may wait (a kill's aftermath, an answer) asks
   * again until it may sound or its wait runs out.
   */
  private say(plan: BarkPlan, options: { delay?: number; gap?: number } = {}): void {
    const move = this.move;
    if (!move || this.host.silent()) return;
    const generation = this.generation;
    const attempt = (waited: number) => {
      if (generation !== this.generation || this.move !== move) return;
      const view = this.host.pieceAt(plan.speaker.square);
      if (!view || view.kind !== plan.speaker.rank || view.color !== plan.speaker.side || view.isSlain) return;
      const voice = this.voiceOf(view);
      const events = planEvents(plan, move.facts);
      const clip = nextBark(voice, events, this.memory, seededRandom(barkSeed(move.san, `${plan.event}:${plan.speaker.square}`)), move.ply);
      if (!clip) return;
      const gap = options.gap ?? barkGap(plan.event);
      if (audio.canBark(options.delay ?? 0, audio.clipLength(clip), gap) && audio.clipReady(clip)) {
        const length = audio.bark({ clip, side: view.color, pan: this.host.pan(view.container.position), delay: options.delay, gap });
        if (length !== null) {
          takeBark(voice, events, this.memory, move.ply);
          this.spoken({ clip, moment: plan.moment, square: plan.speaker.square, offset: waited }, (options.delay ?? 0) + length);
        }
        return;
      }
      if (waited + WAIT_STEP <= (plan.wait ?? 0) + 1e-9) this.later(WAIT_STEP, () => attempt(waited + WAIT_STEP));
    };
    attempt(0);
  }

  /**
   * A murmur as the game begins, or a line into a long silence, from one of the side's pieces that has one: "said",
   * "busy" when the floor is not free (it may try again), or "none" when there is nothing to say now.
   */
  private ambient(side: Faction, event: "murmur" | "idle", random: () => number): "said" | "busy" | "none" {
    if (this.host.silent()) return "none";
    const snapshot = this.host.snapshot();
    if (snapshot.status !== "playing" || snapshot.busy || (event === "murmur" && snapshot.sanList.length > 0)) return "none";
    const kingdom = this.host.kingdom(side);
    const speakers = new Map<string, PieceView>();
    for (const [, view] of this.host.pieces()) if (view.color === side && !view.isSlain && !speakers.has(this.voiceOf(view))) speakers.set(this.voiceOf(view), view);
    const voice = nextAmbientVoice(kingdom, event, [...speakers.keys()], this.memory, random);
    const view = voice ? speakers.get(voice) : undefined;
    if (!voice || !view) return "none";
    const clip = `${voice}_${event}_1`;
    if (clip === this.memory.last) return "none";
    if (!audio.clipReady(clip)) return "busy";                          // still on its way: it may try again
    const length = audio.bark({ clip, side, pan: this.host.pan(view.container.position), gap: barkGap(event) });
    if (length === null) return "busy";
    takeAmbientVoice(kingdom, event, this.memory);
    this.memory.last = clip;
    const now = audio.now(), since = event === "murmur" ? this.bellAt : this.settledAt;
    this.spoken({ clip, moment: event, square: worldToSquare(view.container.position.x, view.container.position.z), offset: now !== null && since !== null ? now - since : 0 }, length);
    return "said";
  }

  private armIdle(seconds: number): void {
    this.cancelIdle();
    if (this.host.silent()) return;
    const generation = this.generation;
    this.idle = setTimeout(() => {
      this.idle = null;
      if (generation !== this.generation) return;
      const snapshot = this.host.snapshot();
      if (snapshot.status !== "playing" || snapshot.result) return;
      const random = seededRandom(barkSeed(snapshot.sanList, `idle:${this.idleSpoken}`));
      if (this.ambient(snapshot.turn, "idle", random) === "said") this.idleSpoken += 1;
      if (this.idleSpoken < IDLE_MAX) this.armIdle(IDLE_AGAIN);
    }, seconds * 1000);
  }

  private cancelIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  /** A footsoldier keeps the voice its starting file gave it, however the board got here (a replay seeked part-way). */
  restoreSlots(origins: ReadonlyMap<SquareId, SquareId>): void {
    for (const [square, view] of this.host.pieces()) if (view.kind === "p") this.slots.set(view, pawnSlot(origins.get(square) ?? square));
  }

  /** A line is waiting to be said, or one this board said is still sounding: a replay waits for it before moving on. */
  get busy(): boolean {
    const now = audio.now();
    return this.timers.size > 0 || (now !== null && now < this.speakingUntil);
  }

  /** A line has sounded for `seconds`: the record keeps it. */
  private spoken(line: RecordedVoiceLine, seconds: number): void {
    const now = audio.now();
    if (now !== null) this.speakingUntil = Math.max(this.speakingUntil, now + seconds);
    this.host.spoke?.(line);
  }

  /** In a replay: the move's recorded lines for this moment, each at its recorded offset after it. */
  private sayRecorded(moment: VoiceMoment, delay: number): void {
    const move = this.move;
    if (!move?.recorded) return;
    for (const line of move.recorded) if (line.moment === moment) this.speakRecorded(line, delay, () => this.move === move);
  }

  /**
   * Says a recorded line as the live game said it: asked for when its offset has passed (at once for a line that did
   * not wait), and sounded `delay` later by the mixer, from the figure that said it (on its square, else one with its
   * voice). It keeps no gap to an earlier line (the live game already kept it) but never talks over another voice: a
   * floor still taken lets it wait up to RECORDED_WAIT before it is given up.
   */
  private speakRecorded(line: RecordedVoiceLine, delay: number, live: () => boolean): void {
    if (this.host.silent()) return;
    const generation = this.generation;
    const attempt = (waited: number) => {
      if (generation !== this.generation || !live()) return;
      const view = this.speakerOf(line);
      if (!view) return;
      const length = audio.clipReady(line.clip) ? audio.bark({ clip: line.clip, side: view.color, pan: this.host.pan(view.container.position), delay, gap: 0 }) : null;
      if (length !== null) { const now = audio.now(); if (now !== null) this.speakingUntil = Math.max(this.speakingUntil, now + delay + length); return; }
      if (waited + WAIT_STEP <= RECORDED_WAIT + 1e-9) this.later(WAIT_STEP, () => attempt(waited + WAIT_STEP));
    };
    if (line.offset > 0) this.later(line.offset, () => attempt(0)); else attempt(0);
  }

  /** The figure a recorded line came from: on its square with its voice, else any standing figure that has its voice. */
  private speakerOf(line: RecordedVoiceLine): PieceView | null {
    const voice = line.clip.split("_").slice(0, 2).join("_");
    const there = line.square ? this.host.pieceAt(line.square) : undefined;
    if (there && !there.isSlain && this.voiceOf(there) === voice) return there;
    for (const [, view] of this.host.pieces()) if (!view.isSlain && this.voiceOf(view) === voice) return view;
    return null;
  }

  private later(seconds: number, run: () => void): void {
    const timer = setTimeout(() => { this.timers.delete(timer); run(); }, seconds * 1000);
    this.timers.add(timer);
  }
}

