import {
  directScore, newScoreMemory, readScoreBoard, type ScoreBoard, type ScoreCue, type ScoreDecision, type ScoreMemory, type ScoreSting,
} from "../../../shared/play/match-score";
import { SCORE_CLIPS, type ScoreClip, type ScoreClipId } from "./score-assets";

/**
 * The match score's player (web/sound-design/score/README.md). The director's rules (shared/play/match-score.ts) say
 * which cue the board asks for; this plays it: two decks crossfaded on the cues' bars, each loop looping
 * sample-accurately, the Theme as a match begins, a closing cue at the exact moment the mixer gives it.
 *
 * Every cue shares one pulse (72 BPM; a 2.5 s bar, Rising's 4/4 apart) and the key of D minor, so a change is made on
 * a bar line of the cue it leaves: the next bar for check, the next two bars for a change up (a capture, a fight), the
 * next four-bar phrase for settling back. A
 * loop enters pre-rolled from its own last beats, which lead into its first downbeat, so the new cue's bar one lands
 * on the old cue's bar line, with an equal-power crossfade across it.
 *
 * Mix: the cues play into the beds' bus, which every voice line ducks (duckBeds, as far as the voices chose for that
 * line: a bark lightly, a plea or the King's last words deeply) and which follows the Music setting. The score adds no
 * level duck of its own; it listens to the voices' bus and dips the presence band where speech lives while anyone
 * speaks, and it dips under each blow and wound at a kill, scheduled to the blow's own sample. The closing cue plays on
 * the music bus, where the old closing cues played: it lands on the King's last word, and the beds' duck for his line
 * (held to the end of his clip, then released over half a second) would swallow its first beat. For a voice that
 * begins after it lands it ducks itself, as far as a bark ducks the beds. Files are fetched lazily (the Theme first,
 * as a match opens) and at most a few loops are kept decoded at once.
 *
 * A replay (Showcase's Match Replays) is followed as a live match is: it plays through the same controller and scene,
 * its bell (the mixer's beginGambit) brings the Theme in, a seek takes the game up at its ply (beginGambit again, on the
 * board at that ply) with the board's own cue on the next bar, and its ending lands the closing cue on the King's last
 * word. Held by its transport (paused), the score draws back as for a paused exhibition and comes back on play.
 */

/** What the mixer lends the player. Getters, since the mixer's audio graph is rebuilt after it is disposed. */
export interface ScoreHost {
  context(): AudioContext | null;
  /** Where the score plays: the beds' bus (ducked under voices, then the Music setting). */
  output(): AudioNode | null;
  /** The voices' bus, listened to so the score can step aside for every word. */
  voices(): AudioNode | null;
  /** Where the closing cue plays: the music bus, past the beds' duck (the beds' bus when there is none). */
  music?(): AudioNode | null;
}

/** How the score answers the board's tension within a cue: a level trim over this range (dB), eased in. */
const INTENSITY_DB: readonly [number, number] = [-1.5, 0];
/** A halted exhibition, or a replay held by its transport: the score draws back this far and waits. */
const PAUSED_GAIN = 0.35;
/** Under a voice: the dip in the presence band where words are understood (the level is the beds' duck). */
const PRESENCE = { hz: 2400, q: 0.9, db: -6 };
/** The closing cue, past the beds' duck, ducks itself this far for a voice that begins after it lands (a bark's duck). */
const STING_DUCK = 0.75;
/** The voices' bus level (RMS, dBFS) above which someone is speaking; and how long the score waits after the last word. */
const VOICE_GATE_DB = -42;
const VOICE_HOLD = 0.2;
/** The closing cue does not step aside for the line it answers: the voices are not heard until this long after it ends. */
const ANSWER_GRACE = VOICE_HOLD + 0.05;
/** At a kill: the score's level under the blow and its wound, from just before the blow, held, then eased back. */
const KILL_DIP = { gain: 0.5, lead: 0.03, hold: 0.45, release: 0.25 };
/** Scheduling: how far ahead a change is placed, at the least. */
const LOOKAHEAD = 0.3;
/** Crossfade lengths in bars: check, a change up, settling back; and a cue coming in from silence after the end. */
const FADE_BARS = { urgent: 1, rising: 1, falling: 2 };
const AFTER_FADE_BARS = 2;
/** Bars to the boundary a change waits for: check the next bar, a change up the next two, settling the next phrase. */
const BOUNDARY_BARS = { urgent: 1, rising: 2, falling: 4 };
/** The Theme comes in this long after the opening bell, under its decay. */
const THEME_DELAY = 1.2;
/** The closing cue's level: the old closing cues' (STING_GAIN on the music bus), since the default Music setting is low. */
const STING_LEVEL = 2;
/** After the closing cue the waltz returns, quietly, under the result. */
const AFTER_GAIN = 0.55;
/** At most this many loops stay decoded (the Theme and the closing cues apart). */
const DECODED_LOOPS = 3;
/** Muted this long (left the match), the decoded audio is let go. */
const RELEASE_AFTER_MUTE = 15;
const TICK_MS = 250;

/** Whether a running fade can be held and redirected (Chrome, Safari); elsewhere a change waits for it to end. */
const CAN_HOLD = typeof AudioParam !== "undefined" && typeof (AudioParam.prototype as { cancelAndHoldAtTime?: unknown }).cancelAndHoldAtTime === "function";
/** The kinds of change, most urgent first. */
const FADE_ORDER = ["urgent", "rising", "falling"] as const;
/** Kept decoded whatever the budget says: check's cue cannot wait for a decoder. */
const ALWAYS_DECODED: readonly ScoreClipId[] = ["peril"];
const CLIP_OF: Record<ScoreCue, ScoreClipId> = { theme: "theme", rest: "rest", rising: "rising", battle: "battle", peril: "peril", laststand: "laststand" };
const STING_OF: Record<ScoreSting, ScoreClipId> = { victory: "victory", defeat: "defeat", draw: "draw" };

/** A gain ramp as scheduled: from a to b over `seconds` from `start`, on a quarter circle (equal power). */
interface Ramp { a: number; b: number; start: number; seconds: number }

function rampValue(ramp: Ramp | null, t: number): number {
  if (!ramp) return 0;
  if (t <= ramp.start) return ramp.a;
  if (t >= ramp.start + ramp.seconds) return ramp.b;
  const u = (t - ramp.start) / ramp.seconds;
  return ramp.b >= ramp.a ? ramp.a + (ramp.b - ramp.a) * Math.sin(u * Math.PI / 2) : ramp.b + (ramp.a - ramp.b) * Math.cos(u * Math.PI / 2);
}

/**
 * One cue as it is being played: its own gain node and source, faded in once and out once. The two of these heard at
 * a crossfade are the player's two decks; a fresh pair of nodes for every entry means two fades never share a node.
 */
interface Take {
  gain: GainNode;
  source: AudioBufferSourceNode;
  clip: ScoreClipId;
  /** Context time of the file's t = 0 (its first downbeat), for the bar grid. */
  zero: number;
  /** When its source starts. */
  startAt: number;
  /** Its fade-in, then (once scheduled) its fade-out. */
  fadeIn: Ramp;
  fadeOut: Ramp | null;
}

interface Graph {
  ctx: AudioContext;
  /** The cues (and nothing else) go through the intensity trim and the pause. */
  intensity: GainNode;
  pause: GainNode;
  /** The cues go through the kill dip and the presence dip, into the beds' bus. */
  kill: GainNode;
  presence: BiquadFilterNode;
  out: AudioNode;
  /** The closing cue's own voice duck and presence dip, and its share of the pause, into the music bus. */
  stingDuck: GainNode;
  stingPresence: BiquadFilterNode;
  stingPause: GainNode;
  analyser: AnalyserNode | null;
  probe: Float32Array<ArrayBuffer>;
  /** The closing cue now sounding, if any. */
  sting: { source: AudioBufferSourceNode; gain: GainNode } | null;
}

export class ScorePlayer {
  private graph: Graph | null = null;
  /** Files whose bytes have been fetched once, so the HTTP cache has them for a later decode. */
  private warmed = new Set<ScoreClipId>();
  private buffers = new Map<ScoreClipId, AudioBuffer>();
  private decoding = new Map<ScoreClipId, Promise<AudioBuffer | null>>();
  private leads = new WeakMap<AudioBuffer, number>();
  /** Loops in the order last used, for the decoded budget. */
  private used: ScoreClipId[] = [];
  private memory: ScoreMemory | null = null;
  private board: ScoreBoard | null = null;
  private decision: ScoreDecision | null = null;
  /** The cues playing, scheduled or fading, oldest first. */
  private takes: Take[] = [];
  /** A cue waiting for its audio to be decoded (kept out of the decoded budget's way). */
  private waiting: ScoreClipId | null = null;
  /** The change the director last asked for and how urgently: kept until it is made, so a check that had to wait a
   * tick for its audio still comes in on the next bar rather than the next phrase. */
  private wish: { cue: ScoreCue; kind: keyof typeof FADE_BARS } | null = null;
  private muted = false;
  /** What holds the game, the score drawn back while anything does: a replay's transport ("replay": paused, or at rest
   * after a seek) or the match's pause menu ("match"). */
  private holds = new Set<string>();
  /** The game was taken up mid-way (begin at a later ply): the board's cue comes in on the next bar. */
  private retake = false;
  /** The game is over: the loops have stepped aside for the closing cue. */
  private ended = false;
  /** When the waltz returns after the closing cue (0: not due). */
  private afterAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fast: ReturnType<typeof setInterval> | null = null;
  private voiceLast = -Infinity;
  private voiceOn = false;
  /** Until when the closing cue does not hear the voices (the line it answers), and whether it is stepping aside. */
  private stingGrace = 0;
  private stingDucked = false;
  /** Until when a kill holds the score down. */
  private killUntil = -Infinity;
  private killOn = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private themeAt = 0;

  constructor(private readonly host: ScoreHost) {}

  // ------------------------------------------------------------------ the mixer's calls

  /** As a match opens: fetch and decode the Theme now, so the first seconds are not silent; the rest follows lazily. */
  preload(): void {
    if (!this.ensureGraph()) return;
    void this.decode("theme").then(() => {
      // The cues a game reaches first, and the closing cues (short, and needed to the beat); the others are fetched so
      // the HTTP cache holds them, and decoded when they are first asked for.
      for (const id of ["peril", "rest", "battle", "victory", "defeat", "draw"] as const) void this.decode(id);
      for (const id of ["rising", "laststand"] as const) this.warm(id);
    });
  }

  /**
   * A new game, or a game taken up at the board's ply (a replay opened or seeked there: the mixer's beginGambit puts its
   * memory back), and the director starts afresh. At the opening (the first two plies) the Theme comes in under the
   * opening bell's decay. Later in a game the board's own cue comes in on the next bar of what is playing, and a cue the
   * board still asks for plays on.
   */
  begin(): void {
    const g = this.ensureGraph();
    if (!g) return;
    const now = g.ctx.currentTime;
    const ply = this.board?.moves.length ?? 0;
    const wasEnded = this.ended;
    this.ended = false;
    this.afterAt = 0;
    this.wish = null;
    this.stopSting(now, 0.4);
    if (ply <= 2) {
      // The Theme waits for the opening bell (bell()): at once, or on the bell beat of the match's opening.
      this.fadeAll(now, 0.6);
      this.themeAt = Number.POSITIVE_INFINITY;
      this.memory = newScoreMemory(now, SCORE_CLIPS.theme.dur, ply);
    } else {
      // A game taken back from its end (the post-game waltz is quieter) starts its cue afresh.
      if (wasEnded) this.fadeAll(now, 0.6);
      this.memory = newScoreMemory(now, SCORE_CLIPS.theme.dur, ply);
      this.retake = true;
    }
    this.decision = null;
    this.startClocks();
    // The Theme is scheduled now, for its moment under the bell: a source started ahead lands to the sample, however
    // late the page's timers run.
    this.tick();
  }

  /** The board as published (GameSnapshot fits ScoreBoard): the director hears it at once. */
  update(board: ScoreBoard): void {
    this.board = board;
    // A new game's first state arrives just before the mixer's beginGambit (which calls begin, and begin starts the
    // Theme afresh): it is left for begin. A board taken back to its first move (Undo) keeps the game's memory, so the
    // Theme or the cue playing carries on. Only a game already under way (the page woke late) is taken up here, on the
    // board's own cue, with no Theme.
    if (!this.memory && board.status === "playing" && board.mode !== "attract" && board.moves.length > 0) {
      const g = this.ensureGraph();
      if (g) this.memory = newScoreMemory(g.ctx.currentTime, SCORE_CLIPS.theme.dur, Math.max(3, board.moves.length));
    }
    this.startClocks();
    this.tick();
  }

  /**
   * The game is over: the loops step aside now, and the closing cue lands at context time `at` (the mated King's last
   * word, or the moment of the end). `answers`: when the line it answers ends (context time; 0 for none), the cue not
   * stepping aside for it. False when it cannot play (not decoded yet, muted), so the mixer can fall back.
   */
  close(sting: ScoreSting, at: number, answers = 0): boolean {
    const g = this.ensureGraph();
    if (!g || this.muted) return false;
    const now = g.ctx.currentTime;
    this.ended = true;
    this.afterAt = 0;
    // The loops give way across the bell (or at once), and are gone by the closing cue's first beat.
    this.fadeAll(now, Math.max(0.3, Math.min(1.2, at - now)));
    const id = STING_OF[sting];
    const buffer = this.buffers.get(id);
    if (!buffer) { void this.decode(id); return false; }
    this.stopSting(now, 0.2);
    this.stingGrace = answers > 0 ? answers + ANSWER_GRACE : 0;
    this.stingDucked = false;
    this.stingAside(g, false, now);
    const source = g.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = g.ctx.createGain();
    gain.gain.value = STING_LEVEL;
    source.connect(gain);
    gain.connect(g.stingDuck);
    const when = Math.max(now + 0.01, at);
    source.start(when, this.leadOf(buffer));
    g.sting = { source, gain };
    source.onended = () => { if (this.graph?.sting?.source === source) this.graph.sting = null; };
    // Then the waltz again, quietly, under the result, unless something else has begun by then.
    this.afterAt = when + SCORE_CLIPS[id].dur - 2.5;
    return true;
  }

  /**
   * A blow lands at context time `at`, with its wound: the score dips from just before it, to the sample, and comes back
   * once the last of a run of blows has had its hold.
   */
  kill(at: number): void {
    const g = this.graph;
    if (!g || this.muted) return;
    const start = Math.max(g.ctx.currentTime, at - KILL_DIP.lead);
    g.kill.gain.setTargetAtTime(KILL_DIP.gain, start, 0.008);
    this.killUntil = Math.max(this.killUntil, at + KILL_DIP.hold);
    this.killOn = true;
  }

  /**
   * The opening bell has rung (the mixer's beginGambit rings it at once, or holds it for the bell beat of the match's
   * opening): a new game's Theme comes in under its decay.
   */
  bell(): void {
    const g = this.graph;
    if (!g || Number.isFinite(this.themeAt)) return;
    this.themeAt = g.ctx.currentTime + THEME_DELAY;
    this.tick();
  }

  /**
   * Something holds the game or lets it go on: a replay's transport (paused, or seeked while paused) or the match's pause
   * menu. Held, the score draws back as for a paused exhibition and waits, the closing cue with it; let go by everything
   * that held it, it comes back.
   */
  setHeld(held: boolean, reason = "replay"): void {
    const before = this.holds.size > 0;
    if (held) this.holds.add(reason); else this.holds.delete(reason);
    if (before !== this.holds.size > 0) this.applyPause(this.decision?.paused ?? false);
  }

  /** Muting (and leaving the match, which mutes) stops the score outright; its decoded audio is let go soon after. */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const g = this.graph;
    if (this.releaseTimer) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    if (muted) {
      if (g) { this.fadeAll(g.ctx.currentTime, 0.3); this.stopSting(g.ctx.currentTime, 0.3); }
      this.stopClocks();
      // Once the fades have run, nothing is left playing. The game's memory is let go (leaving a match mutes the mixer,
      // and the next match unmutes it before its own first state): the score starts again with a new game's opening, a
      // game taken up at a ply (a replay's beginGambit), or, for a game under way (Sound off and on again), on its next
      // published state. The last board is kept, so a game taken up while muted knows its ply; it is read again only
      // with a memory, which a new match's own first state or opening brings.
      this.memory = null; this.wish = null; this.ended = false; this.afterAt = 0; this.holds.clear(); this.retake = false;
      this.applyPause(false);
      setTimeout(() => { if (this.muted) this.reap(Infinity); }, 450);
      this.releaseTimer = setTimeout(() => { this.releaseTimer = null; this.release(); }, RELEASE_AFTER_MUTE * 1000);
    } else {
      this.startClocks();
      this.tick();
    }
  }

  dispose(): void {
    this.stopClocks();
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    const g = this.graph;
    for (const take of [...this.takes]) this.drop(take);
    if (g) {
      try { g.sting?.source.stop(); } catch { /* not started */ }
      try { g.presence.disconnect(); } catch { /* gone */ }
      try { g.stingPause.disconnect(); } catch { /* gone */ }
      try { if (g.analyser) this.host.voices()?.disconnect(g.analyser); } catch { /* gone */ }
    }
    this.graph = null;
    this.buffers.clear();
    this.decoding.clear();
    this.used = [];
    this.memory = null;
    this.board = null;
    this.decision = null;
  }

  /** What is playing and why, for the verification scripts and the film harness. */
  get state(): { cue: ScoreClipId | null; decision: ScoreDecision | null; decoded: ScoreClipId[]; sting: boolean; takes: number } {
    const main = this.main();
    return { cue: main ? main.clip : null, decision: this.decision, decoded: [...this.buffers.keys()], sting: !!this.graph?.sting, takes: this.takes.length };
  }

  // ------------------------------------------------------------------ the graph

  private ensureGraph(): Graph | null {
    const ctx = this.host.context();
    const out = this.host.output();
    if (!ctx || !out) return null;
    if (this.graph && this.graph.ctx === ctx && this.graph.out === out) return this.graph;
    if (this.graph) { this.buffers.clear(); this.decoding.clear(); this.used = []; this.takes = []; }
    const intensity = ctx.createGain();
    const pause = ctx.createGain();
    const kill = ctx.createGain();
    const dip = (): BiquadFilterNode => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = PRESENCE.hz;
      filter.Q.value = PRESENCE.q;
      filter.gain.value = 0;
      return filter;
    };
    const presence = dip();
    intensity.connect(pause);
    pause.connect(kill);
    kill.connect(presence);
    presence.connect(out);
    const stingDuck = ctx.createGain();
    const stingPresence = dip();
    const stingPause = ctx.createGain();
    stingDuck.connect(stingPresence);
    stingPresence.connect(stingPause);
    stingPause.connect(this.host.music?.() ?? out);
    let analyser: AnalyserNode | null = null;
    const voices = this.host.voices();
    if (voices) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      voices.connect(analyser);
    }
    this.graph = { ctx, intensity, pause, kill, presence, out, stingDuck, stingPresence, stingPause, analyser, probe: new Float32Array(1024), sting: null };
    return this.graph;
  }

  // ------------------------------------------------------------------ loading

  /** Fetches a file once and lets the bytes go: the HTTP cache keeps them for when the cue is first decoded. */
  private warm(id: ScoreClipId): void {
    if (this.warmed.has(id) || this.buffers.has(id) || this.decoding.has(id)) return;
    this.warmed.add(id);
    void fetch(SCORE_CLIPS[id].url).then((response) => response.arrayBuffer()).catch(() => { this.warmed.delete(id); });
  }

  /**
   * Fetches and decodes a cue. The fetched bytes are handed to the decoder as they are (it takes them), so the score
   * holds no compressed copy: a cue let go and wanted again is fetched again, from the HTTP cache.
   */
  private decode(id: ScoreClipId): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    let job = this.decoding.get(id);
    if (!job) {
      job = (async () => {
        const g = this.graph;
        if (!g) return null;
        try {
          const response = await fetch(SCORE_CLIPS[id].url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw = await response.arrayBuffer();
          if (this.graph !== g) return null;
          const buffer = await g.ctx.decodeAudioData(raw);
          if (this.graph !== g) return null;
          this.buffers.set(id, buffer);
          this.budget(id);
          return buffer;
        } catch (error) {
          console.warn(`[score] could not load "${id}"`, error);
          return null;
        } finally {
          this.decoding.delete(id);
        }
      })();
      this.decoding.set(id, job);
    }
    return job;
  }

  /**
   * At most DECODED_LOOPS loops stay decoded besides Peril: the least recently used one that is neither playing nor
   * awaited goes.
   */
  private budget(id: ScoreClipId): void {
    if (!SCORE_CLIPS[id].loop || ALWAYS_DECODED.includes(id)) return;
    this.used = [id, ...this.used.filter((other) => other !== id)];
    const busy = new Set<ScoreClipId | null>([...this.takes.map((t) => t.clip), this.waiting]);
    for (let i = this.used.length - 1; i >= 0 && this.used.length > DECODED_LOOPS; i -= 1) {
      const old = this.used[i];
      if (busy.has(old)) continue;
      this.buffers.delete(old);
      this.used.splice(i, 1);
    }
  }

  /** Lets go of the decoded audio once the match has been left (the HTTP cache keeps the files for the next match). */
  private release(): void {
    for (const take of [...this.takes]) this.drop(take);
    this.buffers.clear();
    this.used = [];
    this.memory = null;
  }

  /**
   * Seconds of silence a decoder put before the music. Browsers that read the MP3's gapless header put none; one that
   * does not puts the encoder's delay there, and the cue's loop points move by as much.
   */
  private leadOf(buffer: AudioBuffer): number {
    const known = this.leads.get(buffer);
    if (known !== undefined) return known;
    let lead = 0;
    const clip = (Object.values(SCORE_CLIPS) as ScoreClip[]).find((c) => Math.abs(c.dur + 2 * c.pad - buffer.duration) < 0.2);
    if (clip && buffer.duration - (clip.dur + 2 * clip.pad) > 0.01) {
      const limit = Math.min(buffer.length, Math.floor(0.08 * buffer.sampleRate));
      let first = limit;
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < limit; i += 1) if (Math.abs(data[i]) > 1e-4) { first = Math.min(first, i); break; }
      }
      lead = first < limit ? first / buffer.sampleRate : 0;
    }
    this.leads.set(buffer, lead);
    return lead;
  }

  // ------------------------------------------------------------------ the director, on a clock

  private startClocks(): void {
    if (this.muted) return;
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!this.fast) this.fast = setInterval(() => this.listen(), 20);
  }

  private stopClocks(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.fast) clearInterval(this.fast);
    this.timer = null; this.fast = null;
  }

  private tick(): void {
    const g = this.ensureGraph();
    if (!g || this.muted) return;
    const now = g.ctx.currentTime;
    this.reap(now);
    if (!this.board || !this.memory) return;
    const reading = readScoreBoard(this.board);
    const decision = directScore(this.memory, reading, now);
    this.decision = decision;
    this.applyPause(decision.paused);
    if (reading.quiet) { this.fadeAll(now, 1); return; }
    if (decision.cue === null) {
      // Over: the mixer's close() times the closing cue; then the waltz returns, quietly, under the result.
      if (!this.ended) { this.ended = true; this.fadeAll(now, 1.2); }
      if (this.afterAt && now >= this.afterAt - LOOKAHEAD && this.play("rest", "falling", AFTER_GAIN)) this.afterAt = 0;
      return;
    }
    if (this.ended) {
      // Taken back after the end (an Undo): the closing cue gives way and the board's cue returns.
      this.ended = false; this.afterAt = 0;
      this.stopSting(now, 1);
    }
    this.applyIntensity(decision.intensity);
    const kind = decision.urgent || this.retake ? "urgent" : decision.rising ? "rising" : "falling";
    if (!this.wish || this.wish.cue !== decision.cue) this.wish = { cue: decision.cue, kind };
    else if (FADE_ORDER.indexOf(kind) < FADE_ORDER.indexOf(this.wish.kind)) this.wish.kind = kind;
    if (this.play(CLIP_OF[decision.cue], this.wish.kind, 1)) this.retake = false;
  }

  // ------------------------------------------------------------------ playing

  /** The cue being heard now and not going out: the one a change leaves from. */
  private main(): Take | null {
    const now = this.graph?.ctx.currentTime ?? 0;
    for (let i = this.takes.length - 1; i >= 0; i -= 1) {
      const take = this.takes[i];
      if (take.startAt <= now + 1e-3 && !take.fadeOut) return take;
    }
    return null;
  }

  /**
   * Brings `id` in on the right boundary of whatever is playing (or at once, from silence). True once it is playing or
   * scheduled; false while its audio is still being decoded (a later tick tries again, if the board still wants it).
   */
  private play(id: ScoreClipId, kind: keyof typeof FADE_BARS, level: number): boolean {
    const g = this.graph;
    if (!g) return false;
    const now = g.ctx.currentTime;
    // A new game's Theme waits for its bell.
    if (id === "theme" && !Number.isFinite(this.themeAt)) return false;
    const newest = this.takes[this.takes.length - 1];
    if (newest && newest.clip === id && !newest.fadeOut) return true;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      // Placed the moment its audio is decoded, not on the next tick (a busy page can starve its timers).
      this.waiting = id;
      void this.decode(id).then((decoded) => { if (decoded && this.waiting === id) this.tick(); });
      return false;
    }
    // A change already scheduled but not yet begun is called off: its cue never starts, and the cue it was to replace
    // keeps playing (its fade-out had not begun either).
    for (const take of [...this.takes]) {
      if (take.startAt > now + 1e-3) { this.drop(take); continue; }
      if (take.fadeOut && take.fadeOut.start > now + 1e-3) {
        take.gain.gain.cancelScheduledValues(take.fadeOut.start);
        take.fadeOut = null;
      }
    }
    const from = this.main();
    // The board asks for the cue that is still playing (the change it was leaving for has been called off): keep it.
    if (from && from.clip === id) { this.waiting = null; return true; }
    const clip = SCORE_CLIPS[id];
    // From silence: the Theme opens on its own soft bars; a loop (a game taken up mid-way) fades in over a bar.
    const fade = (from ? FADE_BARS[kind] : level < 1 ? AFTER_FADE_BARS : clip.loop ? 1 : 0) * clip.bar;
    // A loop entering under another cue is pre-rolled from its own last beats (which lead into its first downbeat), so
    // its bar one lands on the boundary, with the crossfade centred there.
    const pre = clip.loop && from ? fade / 2 : 0;
    let at: number;
    if (from) {
      // The next line of BOUNDARY_BARS bars in the playing cue's own grid, far enough ahead to schedule. Where the
      // browser can hold a running fade (cancelAndHoldAtTime), a change may cut into the playing cue's own fade-in;
      // elsewhere it waits for that fade to end, since two fades never overlap on one node.
      const ready = (CAN_HOLD ? now + LOOKAHEAD : Math.max(now + LOOKAHEAD, from.fadeIn.start + from.fadeIn.seconds)) + pre;
      at = this.nextBoundary(from, BOUNDARY_BARS[kind], ready);
    } else {
      at = id === "theme" ? Math.max(now + 0.05, this.themeAt) : now + 0.05;
    }
    const startAt = at - pre;
    const lead = this.leadOf(buffer);
    const gain = g.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(g.intensity);
    const source = g.ctx.createBufferSource();
    source.buffer = buffer;
    // A loop runs between its inner points (the file carries `pad` seconds of its own end before them and of its start
    // after them), so the wrap is between two samples from the middle of the encoded stream.
    const loopAt = lead + clip.pad;
    if (clip.loop) {
      source.loop = true;
      source.loopStart = loopAt;
      source.loopEnd = loopAt + clip.dur;
    }
    source.connect(gain);
    source.start(startAt, clip.loop ? loopAt + (pre > 0 ? clip.dur - pre : 0) : lead);
    const seconds = Math.max(0.03, fade);
    const take: Take = { gain, source, clip: id, zero: at, startAt, fadeIn: this.curve(gain.gain, 0, level, startAt, seconds), fadeOut: null };
    this.takes.push(take);
    if (from) from.fadeOut = this.curve(from.gain.gain, rampValue(from.fadeIn, startAt), 0, startAt, seconds, from.fadeIn);
    if (id === "theme" && this.memory) this.memory.themeAt = at;
    // The director's dwell counts from when the cue is heard, not from when it was asked for.
    if (this.memory && this.memory.cue && CLIP_OF[this.memory.cue] === id) this.memory.since = Math.max(this.memory.since, at);
    this.waiting = null;
    if (clip.loop) this.budget(id);
    return true;
  }

  /** The first boundary every `bars` bars (counted from the cue's downbeat, afresh each time round a loop) at or after `after`. */
  private nextBoundary(take: Take, bars: number, after: number): number {
    const clip = SCORE_CLIPS[take.clip];
    const step = clip.bar * bars;
    if (!clip.loop) {
      const k = Math.max(0, Math.ceil((after - (take.zero + clip.downbeat)) / step - 1e-6));
      // A Theme near its end gives way at its end rather than after it.
      return Math.min(take.zero + clip.downbeat + k * step, take.zero + clip.dur);
    }
    const since = after - take.zero;
    const round = Math.floor(since / clip.dur);
    const into = since - round * clip.dur;
    const t = clip.downbeat + Math.max(0, Math.ceil((into - clip.downbeat) / step - 1e-6)) * step;
    // Past the last whole boundary of this time round, the loop's own start is the next one.
    return take.zero + round * clip.dur + (t <= clip.dur - 0.05 ? t : clip.dur);
  }

  /**
   * An equal-power curve on `param` from `a` to `b` over `seconds` from `at`. Only ever laid on a node whose earlier
   * curve has ended (a fade-out after its fade-in), since Web Audio refuses overlapping curves.
   */
  private curve(param: AudioParam, a: number, b: number, at: number, seconds: number, running: Ramp | null = null): Ramp {
    const n = 32;
    const values = new Float32Array(n);
    for (let i = 0; i < n; i += 1) values[i] = rampValue({ a, b, start: 0, seconds: 1 }, i / (n - 1));
    let start = at;
    if (running && at < running.start + running.seconds && CAN_HOLD) {
      // Cutting into a fade still running: hold it where it is at `at`, and go on from there a sample later.
      (param as AudioParam & { cancelAndHoldAtTime(t: number): AudioParam }).cancelAndHoldAtTime(at);
      start = at + 1 / 48000;
    } else param.cancelScheduledValues(at);
    param.setValueCurveAtTime(values, start, seconds);
    return { a, b, start, seconds };
  }

  /** Every cue out over `seconds` from `at` (each once its own fade-in has ended); one not yet begun is called off. */
  private fadeAll(at: number, seconds: number): void {
    for (const take of [...this.takes]) {
      if (take.startAt > at + 1e-3) { this.drop(take); continue; }
      if (take.fadeOut && take.fadeOut.start + take.fadeOut.seconds <= at + seconds) continue;
      if (take.fadeOut) {
        // Already going out, but slower than this: held where it is and taken out in time (where the browser can
        // hold a running fade); elsewhere it keeps its own fade, which ends a little later.
        if (CAN_HOLD && take.fadeOut.start < at) {
          take.fadeOut = this.curve(take.gain.gain, rampValue(take.fadeOut, at), 0, at, seconds, take.fadeOut);
        }
        continue;
      }
      const start = CAN_HOLD ? at : Math.max(at, take.fadeIn.start + take.fadeIn.seconds);
      take.fadeOut = this.curve(take.gain.gain, rampValue(take.fadeIn, start), 0, start, seconds, take.fadeIn);
    }
  }

  /** Lets go of the cues whose fade-out has ended (their gain is already nothing, so there is no click). */
  private reap(now: number): void {
    for (const take of [...this.takes]) {
      if (take.fadeOut && now >= take.fadeOut.start + take.fadeOut.seconds + 0.02) this.drop(take);
    }
  }

  /** A cue stopped and unplugged: only ever one that is silent or has not begun. */
  private drop(take: Take): void {
    try { take.source.stop(); } catch { /* stopped */ }
    try { take.source.disconnect(); } catch { /* gone */ }
    try { take.gain.disconnect(); } catch { /* gone */ }
    this.takes = this.takes.filter((other) => other !== take);
  }

  private stopSting(at: number, seconds: number): void {
    const s = this.graph?.sting;
    if (!s) return;
    s.gain.gain.setTargetAtTime(0, at, seconds / 4);
    try { s.source.stop(at + seconds + 0.05); } catch { /* stopped */ }
    if (this.graph) this.graph.sting = null;
  }

  private applyIntensity(intensity: number): void {
    const g = this.graph;
    if (!g) return;
    const db = INTENSITY_DB[0] + (INTENSITY_DB[1] - INTENSITY_DB[0]) * Math.max(0, Math.min(1, intensity));
    g.intensity.gain.setTargetAtTime(Math.pow(10, db / 20), g.ctx.currentTime, 1.2);
  }

  private applyPause(paused: boolean): void {
    const g = this.graph;
    if (!g) return;
    const down = paused || this.holds.size > 0;
    for (const node of [g.pause, g.stingPause]) node.gain.setTargetAtTime(down ? PAUSED_GAIN : 1, g.ctx.currentTime, down ? 0.6 : 0.4);
  }

  /**
   * Twenty times a second: the sidechain (someone is speaking on the voices' bus, so the score steps aside, and comes
   * back after the last word) and the end of a kill's hold.
   */
  private listen(): void {
    const g = this.graph;
    if (!g || this.muted) return;
    const now = g.ctx.currentTime;
    if (this.killOn && now >= this.killUntil) {
      this.killOn = false;
      g.kill.gain.setTargetAtTime(1, now, KILL_DIP.release);
    }
    if (!g.analyser) return;
    g.analyser.getFloatTimeDomainData(g.probe);
    let sum = 0;
    for (let i = 0; i < g.probe.length; i += 1) sum += g.probe[i] * g.probe[i];
    if (10 * Math.log10(sum / g.probe.length + 1e-12) > VOICE_GATE_DB) this.voiceLast = now;
    const on = now - this.voiceLast < VOICE_HOLD;
    if (on !== this.voiceOn) {
      this.voiceOn = on;
      this.dipFor(g.presence, on, now);
    }
    // The closing cue steps aside for a voice that begins after it lands, never for the line it answers.
    const stingOn = on && now >= this.stingGrace;
    if (stingOn !== this.stingDucked) {
      this.stingDucked = stingOn;
      this.stingAside(g, stingOn, now);
    }
  }

  /** The presence dip under a voice: in quickly, out gently. */
  private dipFor(presence: BiquadFilterNode, on: boolean, now: number): void {
    presence.gain.setTargetAtTime(on ? PRESENCE.db : 0, now, on ? 0.03 : 0.3);
  }

  /** The closing cue stepping aside for a voice (its own duck and presence dip), or back. */
  private stingAside(g: Graph, on: boolean, now: number): void {
    g.stingDuck.gain.setTargetAtTime(on ? STING_DUCK : 1, now, on ? 0.02 : 0.25);
    this.dipFor(g.stingPresence, on, now);
  }
}
