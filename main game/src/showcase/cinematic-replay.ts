/**
 * The cinematic replay's transport. A recorded match is played move by move through the real game controller and
 * renderer (GameController.beginReplay/stepReplay, SceneEngine), so every move is performed as it was in the live game:
 * walks, duels, spells, summons, fatalities, claims, check and the ending. Each move takes as long as its own
 * performance; the transport only decides which move comes next and how the scene's time runs.
 *
 * - Play / pause: pause holds a move in flight still (the scene's time stops) and fades the sound out; between moves the
 *   board idles as it did in the game. Play picks the move up where it stopped, with its sound.
 * - Next: the next move, performed (a move held mid-way by pause is finished, then held again).
 * - Seek (Previous, Start, End, the timeline, the move list): the board is rebuilt at that ply at once
 *   (GameController.seekReplay), and play goes on from there if it was playing.
 * - Speed: the scene's time runs at 0.5x to 4x; sound keeps its own pace.
 * - Battles only: quiet moves are jumped at once; captures and the last move (the ending) are performed.
 * - Skip: a Combat Director duel cuts to its killing blow, any other move on stage plays out fast, and the ending's
 *   framing goes straight to its end.
 *
 * Nothing here can start a clock, the computer, a gameover or a Legacy effect: the controller refuses all of them in a
 * replay. Pure TypeScript: shared/play/cinematic-replay.test.ts drives it with stand-ins.
 */
import { hasRecordedFight, nextBattle, type ReplayScript } from "../../../shared/play/replay-show";
import type { ReplaySource } from "../../../web/src/core/gameController";

/** What the transport needs of the game controller. */
export interface ReplayBoard {
  beginReplay(source: ReplaySource, ply?: number): void;
  seekReplay(ply: number): void;
  stepReplay(): Promise<boolean>;
}

/** What the transport needs of the renderer (SceneEngine). */
export interface ReplayRenderer {
  /** Nothing of the last move is still going on (a body being claimed, a shot coming home). */
  readonly replaySettled: boolean;
  setReplayTimeScale(scale: number): void;
  setCaptureCinematics(enabled: boolean): void;
  ringReplayBell(): void;
  /** The mixer's state of the game at `ply` (an ending undone, the fallen counted), silently. */
  restoreReplaySound(ply: number): void;
  playReplayEnding(): Promise<void>;
  skipMove(): void;
  skipEndCinematic(): void;
}

/** The match mixer, as far as the transport touches it: heard while the replay plays, faded out otherwise. */
export interface ReplaySound { setHeard(heard: boolean): void }

export interface ReplayEvents {
  /** A move has begun that brings the board to `ply`. */
  reached(ply: number): void;
  /** The replay has been shown to its end: its last move, then the ending. */
  finished(): void;
  /** A move or the ending is being performed (true), or the board is at rest (false). */
  performing?(active: boolean): void;
}

/** The beat between two moves, in seconds at 1x: long enough to see where a piece came to rest. */
export const BETWEEN_MOVES = 0.6;
/** After the opening bell, before the first move: the toll is heard first, as it was before anyone moved. */
export const AFTER_BELL = 1.4;
/** The longest a replay waits for the last move to settle (its claim, its shot coming home, the lines said after it), in seconds at 1x. */
export const SETTLE_LIMIT = 15;

export class CinematicReplay {
  private ply = 0;
  private playing = false;
  /** Next while paused: perform one move, then hold. */
  private once = false;
  private performing = false;
  private speed = 1;
  private battlesOnly = false;
  private rang = false;
  private concluded = false;
  /** Bumped by every seek and by dispose: a loop or a beat that sees another number gives up. */
  private generation = 0;
  private running = false;
  private disposed = false;
  private beat: { timer: ReturnType<typeof setTimeout>; resolve(): void } | null = null;

  constructor(
    private readonly board: ReplayBoard,
    private readonly renderer: ReplayRenderer,
    private readonly script: ReplayScript,
    private readonly sound: ReplaySound,
    private readonly events: ReplayEvents,
    private readonly timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = globalThis,
  ) {}

  get position(): number { return this.ply; }
  get isPlaying(): boolean { return this.playing; }
  get isPerforming(): boolean { return this.performing; }
  get isConcluded(): boolean { return this.concluded; }

  /** Puts the record on the board at `ply` (the opening position by default), at rest and silent. */
  open(ply = 0): void {
    this.board.beginReplay(this.script, ply);
    this.ply = this.clamp(ply);
    this.concluded = false; this.rang = this.ply > 0;
    this.sound.setHeard(false);
    this.renderer.restoreReplaySound(this.ply);
    this.apply();
  }

  play(): void {
    if (this.disposed || this.playing) return;
    if (this.concluded && !this.performing) { this.seek(0); }
    this.playing = true;
    this.apply();
    this.run();
  }

  pause(): void {
    if (this.disposed || !this.playing) return;
    this.playing = false;
    this.apply();
  }

  /** The next move, performed; then the board holds (unless the replay is playing anyway). */
  next(): void {
    if (this.disposed) return;
    if (this.performing) { if (!this.playing) { this.once = true; this.apply(); } return; }
    if (this.ply >= this.script.moves.length) return;
    this.once = true;
    this.apply();
    this.run();
  }

  /** The board at `ply` at once, with the history up to it; a playing replay plays on from there. */
  seek(ply: number): void {
    if (this.disposed) return;
    this.generation += 1;
    this.cancelBeat();
    this.once = false;
    this.performing = false; this.events.performing?.(false);
    this.board.seekReplay(ply);
    this.ply = this.clamp(ply);
    this.concluded = false;
    this.rang = this.ply > 0;
    this.running = false;
    // What was being said and played stops with the move; the mixer's memory goes back to this ply, unheard.
    this.sound.setHeard(false);
    this.renderer.restoreReplaySound(this.ply);
    this.apply();
    if (this.playing) this.run();
  }

  setSpeed(speed: number): void {
    this.speed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.apply();
  }

  setBattlesOnly(active: boolean): void { this.battlesOnly = active; }

  /** Skips what is on stage: a duel to its blow, any other move fast, the ending to its end. */
  skip(): void {
    if (this.disposed || !this.performing) return;
    if (this.ply >= this.script.moves.length) this.renderer.skipEndCinematic();
    else this.renderer.skipMove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.cancelBeat();
    this.disposed = true; this.playing = false; this.once = false;
    this.sound.setHeard(false);
  }

  private clamp(ply: number): number {
    return Math.max(0, Math.min(this.script.moves.length, Math.floor(Number.isFinite(ply) ? ply : 0)));
  }

  /**
   * The scene's time and the sound for the transport's state: a move in flight runs at the chosen speed and stops
   * still while paused; a board at rest idles at its own pace. Sound is heard only while the replay plays.
   */
  private apply(): void {
    if (this.disposed) return;
    const moving = this.playing || this.once;
    this.renderer.setReplayTimeScale(this.performing ? (moving ? this.speed : 0) : 1);
    this.sound.setHeard(moving);
  }

  /** Performs moves while the replay plays (or once, for Next), then the ending. One loop at a time. */
  private run(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    const generation = this.generation;
    void this.loop(generation).finally(() => { if (generation === this.generation) this.running = false; });
  }

  private async loop(generation: number): Promise<void> {
    const moves = this.script.moves;
    const live = () => generation === this.generation && !this.disposed;
    while (live() && (this.playing || this.once)) {
      if (this.ply >= moves.length) { await this.conclude(generation); return; }
      if (this.battlesOnly && !this.once) {
        const target = nextBattle(moves, this.ply);
        // Quiet moves are jumped at once; the battle (or the last move) after them is performed.
        if (target !== null && target > this.ply) {
          this.board.seekReplay(target);
          this.ply = target; this.rang = true;
        }
      }
      if (this.ply === 0 && !this.rang) {
        this.rang = true;
        // The bell, and the murmurs the record kept, are heard before anyone moves, as they were.
        this.renderer.ringReplayBell();
        await this.settle(generation);
        await this.wait(AFTER_BELL, generation);
      } else {
        // As a player did, the next move waits until the last one has settled (its body claimed, the view home).
        await this.settle(generation);
        await this.wait(BETWEEN_MOVES, generation);
      }
      if (!live() || (!this.playing && !this.once)) return;
      // An older record shows its captures plainly, but for the duels it recorded (shared/play/replay-show.ts).
      this.renderer.setCaptureCinematics(this.script.fidelity === "exact" || hasRecordedFight(moves[this.ply]));
      this.performing = true; this.events.performing?.(true);
      this.apply();
      this.events.reached(this.ply + 1);
      const played = await this.board.stepReplay();
      if (!live()) return;
      this.performing = false; this.events.performing?.(false);
      if (!played) { this.apply(); return; }
      this.ply += 1;
      const single = this.once;
      // The last move is followed by the ending, whether it was played on or stepped to: a stepped one keeps its Next
      // (and so its clock and sound) until the ending has been shown.
      if (this.ply >= moves.length) { if (this.playing || single) await this.conclude(generation); else this.apply(); return; }
      this.once = false;
      this.apply();
      if (single && !this.playing) return;
    }
  }

  /** The record's end, as the live game showed it: the ending's sound and framing, once. */
  private async conclude(generation: number): Promise<void> {
    if (this.concluded) return;
    this.concluded = true;
    if (this.script.result) {
      this.performing = true; this.events.performing?.(true);
      this.apply();
      try { await this.renderer.playReplayEnding(); } catch (error) { console.warn("[replay] the ending could not be shown", error); }
      if (generation !== this.generation || this.disposed) return;
      this.performing = false; this.events.performing?.(false);
    }
    this.once = false;
    this.playing = false;
    this.apply();
    this.events.finished();
  }

  /** Until the board has settled, the replay stops playing, or SETTLE_LIMIT runs out. */
  private async settle(generation: number): Promise<void> {
    for (let waited = 0; waited < SETTLE_LIMIT && !this.renderer.replaySettled; waited += 0.1) {
      if (generation !== this.generation || this.disposed || (!this.playing && !this.once)) return;
      await this.wait(0.1, generation);
    }
  }

  /** A beat between moves, on the transport's clock: shorter at a higher speed, given up by a seek. */
  private wait(seconds: number, generation: number): Promise<void> {
    if (generation !== this.generation) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { if (this.beat?.resolve === done) this.beat = null; resolve(); };
      this.beat = { timer: this.timers.setTimeout(done, (seconds / this.speed) * 1000), resolve: done };
    });
  }

  private cancelBeat(): void {
    const beat = this.beat;
    if (!beat) return;
    this.beat = null;
    this.timers.clearTimeout(beat.timer);
    beat.resolve();
  }
}
