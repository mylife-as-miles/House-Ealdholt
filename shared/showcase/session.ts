import { EXHIBITION_PLIES, MAX_REPLAYS, MOVE_SECONDS, PLAYBACK_SPEEDS, SHOWCASE_COPY } from './catalog';
import { compactReplay } from './records';
import { discoverShowcaseStorage, readReplayArchiveSource, writeReplayArchive } from './storage';
import { runReplayJob } from './worker-client';
import type { GenerationOptions, PlaybackSpeed, ReplayEntry, ShowcaseOperation, ShowcaseRecord, ShowcaseSnapshot, ShowcaseStorage } from './types';

export type { ShowcaseFrame, ShowcaseMove, ShowcasePiece, ShowcaseRecord, ShowcaseSnapshot, ReplayEntry } from './types';

interface SessionOptions { storage?: ShowcaseStorage | null; now?: () => Date }
type Listener = (snapshot: ShowcaseSnapshot) => void;

/** Isolated exhibition viewer. It never imports or mutates chess/Legacy saves. */
export class ShowcaseSession {
  private readonly storage: ShowcaseStorage | null;
  private readonly now: () => Date;
  private readonly listeners = new Set<Listener>();
  private state: ShowcaseSnapshot;
  private expectedRaw: string | null;
  private persistedIds: Set<string>;
  private elapsed = 0;
  private suspended = false;
  /** A cinematic stage paces playback: each move takes as long as its own performance (see setCinematic). */
  private cinematic = false;
  private disposed = false;
  private generation = 0;
  private abort: AbortController | null = null;
  private openAbort: AbortController | null = null;
  private archiveAbort: AbortController | null = null;
  private archiveGeneration = 0;
  private archiveTask: Promise<ShowcaseOperation> = Promise.resolve({ ok: true, message: '' });

  constructor(options: SessionOptions = {}) {
    this.storage = options.storage === undefined ? discoverShowcaseStorage() : options.storage;
    this.now = options.now || (() => new Date());
    const source = readReplayArchiveSource(this.storage);
    this.expectedRaw = source.raw;
    this.persistedIds = new Set();
    const loading = source.status === 'saved' && source.raw !== null;
    this.state = Object.freeze({
      phase: 'idle', progress: 0, record: null, frame: null, ply: 0, playing: false, speed: 1, arena: 0,
      library: Object.freeze([]), storage: loading ? 'loading' : source.status,
      message: loading ? SHOWCASE_COPY.loadingArchive : source.status === 'session' ? SHOWCASE_COPY.unavailable : '',
      error: '', ended: false, saved: false,
    });
    if (loading) this.archiveTask = this.hydrateArchive(source.raw);
  }

  get snapshot(): ShowcaseSnapshot { return this.state; }
  get ready(): Promise<ShowcaseOperation> { return this.archiveTask; }
  /** Paused while the Showcase is not on screen (see setSuspended). */
  get isSuspended(): boolean { return this.suspended; }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener); listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private patch(next: Partial<ShowcaseSnapshot>): void {
    if (this.disposed) return;
    const state = { ...this.state, ...next };
    state.frame = state.record?.frames[state.ply] || null;
    // A cinematic replay is still showing its last move (and the ending) while it plays.
    state.ended = !!state.record && state.ply >= state.record.plies && !(this.cinematic && state.playing);
    state.saved = !!state.record && state.storage === 'saved' && this.persistedIds.has(state.record.id)
      && state.library.some(entry => entry.id === state.record!.id && entry.arena === state.arena && entry.pgn === state.record!.pgn);
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener(this.state);
  }

  async generate(options: GenerationOptions = {}): Promise<ShowcaseRecord | null> {
    if (this.disposed || this.suspended) return null;
    this.cancelGeneration();
    this.cancelOpening();
    const generation = ++this.generation;
    const abort = this.abort = new AbortController();
    const cancel = () => abort.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) abort.abort();
    this.elapsed = 0;
    this.patch({ phase: 'generating', progress: 0, playing: false, error: '', message: SHOWCASE_COPY.generating });
    try {
      const record = await runReplayJob<ShowcaseRecord>({ kind: 'generate', options: { seed: options.seed, arena: options.arena ?? this.state.arena, maxPlies: options.maxPlies ?? EXHIBITION_PLIES } }, abort.signal, progress => {
        if (!this.disposed && generation === this.generation && !abort.signal.aborted) this.patch({ progress });
      });
      if (this.disposed || this.suspended || generation !== this.generation || abort.signal.aborted) return null;
      this.abort = null;
      this.patch({ phase: 'ready', progress: 1, record, arena: record.arena, ply: 0, playing: false, error: '', message: 'Computer exhibition ready.' });
      return record;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return null;
      this.abort = null;
      const cancelled = abort.signal.aborted;
      this.patch({ phase: this.state.record ? 'ready' : cancelled ? 'idle' : 'error', progress: 0, playing: false,
        error: cancelled ? '' : 'The exhibition could not be prepared. Try again.', message: cancelled ? '' : 'The exhibition could not be prepared. Try again.' });
      return null;
    } finally { options.signal?.removeEventListener('abort', cancel); }
  }

  cancelGeneration(): void {
    if (!this.abort) return;
    this.abort.abort(); this.abort = null; this.generation++;
    this.patch({ phase: this.state.record ? 'ready' : 'idle', progress: 0, playing: false, message: '', error: '' });
  }

  async load(input: ReplayEntry | ShowcaseRecord, autoplay = false): Promise<ShowcaseOperation> {
    if (this.disposed) return { ok: false, message: 'The Showcase viewer is closed.' };
    if (this.suspended) return { ok: false, message: 'Return to Showcase before opening a replay.' };
    this.cancelGeneration(); this.cancelOpening(); this.elapsed = 0;
    const generation = ++this.generation, abort = this.openAbort = new AbortController();
    this.patch({ phase: 'opening', playing: false, error: '', message: SHOWCASE_COPY.openingReplay });
    try {
      // Even records passed by an adapter are validated; user JSON cannot inject frames.
      const record = await runReplayJob<ShowcaseRecord>({ kind: 'open', entry: compactReplay(input) }, abort.signal);
      if (this.disposed || this.suspended || abort.signal.aborted || generation !== this.generation) return { ok: false, message: '' };
      this.patch({ phase: 'ready', progress: 1, record, arena: record.arena, ply: 0, playing: autoplay && !this.suspended, error: '', message: '' });
      return { ok: true, message: '', entry: compactReplay(record) };
    } catch (error) {
      if (this.disposed || abort.signal.aborted || generation !== this.generation) return { ok: false, message: '' };
      this.patch({ phase: this.state.record ? 'ready' : 'error' });
      return this.fail(error instanceof Error ? error.message : 'The replay could not be opened.');
    } finally { if (generation === this.generation) this.openAbort = null; }
  }

  cancelOpening(): void {
    if (!this.openAbort) return;
    this.openAbort.abort(); this.openAbort = null; this.generation++;
    this.patch({ phase: this.state.record ? 'ready' : 'idle', playing: false, message: '', error: '' });
  }

  /** Moves the timeline to `ply`. It pauses, unless `keepPlaying` asks a playing replay to play on from there. */
  seek(ply: number, keepPlaying = false): void {
    if (this.disposed || !this.state.record || !Number.isFinite(ply) || this.state.phase === 'generating' || this.state.phase === 'opening') return;
    this.elapsed = 0;
    this.patch({ ply: Math.max(0, Math.min(this.state.record.plies, Math.floor(ply))), playing: keepPlaying && this.state.playing, error: '', message: '' });
  }

  /**
   * Hands playback to a cinematic stage (or takes it back): while it holds it, the session's timer does not advance
   * the replay; the stage plays each move through the real game renderer at the pace of its own performance, says
   * when a move begins ({@link reach}) and when the replay has been shown to its end ({@link finishPlayback}).
   */
  setCinematic(active: boolean): void {
    if (this.cinematic === active) return;
    this.cinematic = active; this.elapsed = 0;
    if (this.state.record) this.patch({});
  }

  /** A cinematic stage has begun the move that brings the board to `ply`; playback goes on. */
  reach(ply: number): void {
    if (this.disposed || !this.state.record || !Number.isFinite(ply)) return;
    this.patch({ ply: Math.max(0, Math.min(this.state.record.plies, Math.floor(ply))), error: '', message: '' });
  }

  /** A cinematic stage has shown the replay to its end (its last move and the ending). */
  finishPlayback(): void {
    if (this.disposed || !this.state.record || !this.state.playing) return;
    this.patch({ playing: false, message: this.state.record.termination === 'move-limit' ? SHOWCASE_COPY.moveLimit : SHOWCASE_COPY.complete });
  }

  step(delta: number): void { if (Number.isFinite(delta)) this.seek(this.state.ply + Math.sign(delta)); }
  play(): void {
    if (this.disposed || this.suspended || !this.state.record || this.state.phase === 'generating' || this.state.phase === 'opening') return;
    this.elapsed = 0;
    this.patch({ ply: this.state.ended ? 0 : this.state.ply, phase: 'ready', playing: true, error: '', message: '' });
  }
  pause(): void { if (this.state.playing) this.patch({ playing: false }); this.elapsed = 0; }
  toggle(): void { if (this.state.playing) this.pause(); else this.play(); }
  setSpeed(speed: PlaybackSpeed): void { if (PLAYBACK_SPEEDS.includes(speed)) { this.elapsed = 0; this.patch({ speed }); } }
  setArena(arena: number): void { if (Number.isInteger(arena) && arena >= 0 && arena < 4) this.patch({ arena }); }

  /** A delayed frame advances at most one move; background time cannot skip a battle. */
  update(deltaSeconds: number): void {
    if (this.disposed || this.suspended || this.cinematic || !this.state.playing || !this.state.record || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.elapsed += Math.min(.25, deltaSeconds);
    const interval = MOVE_SECONDS / this.state.speed;
    if (this.elapsed < interval) return;
    this.elapsed -= interval;
    const ply = Math.min(this.state.record.plies, this.state.ply + 1);
    const ended = ply === this.state.record.plies;
    this.patch({ ply, playing: !ended, message: ended ? this.state.record.termination === 'move-limit' ? SHOWCASE_COPY.moveLimit : SHOWCASE_COPY.complete : '' });
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended; this.elapsed = 0;
    if (suspended) { this.pause(); this.cancelGeneration(); this.cancelOpening(); this.archiveAbort?.abort(); this.archiveAbort = null; this.archiveGeneration++; }
    else if (this.state.storage === 'loading') void this.reloadArchive();
  }

  private fail(message: string): ShowcaseOperation {
    this.patch({ error: message, message, phase: this.state.record ? this.state.phase : 'error' });
    return { ok: false, message };
  }

  save(): ShowcaseOperation {
    const record = this.state.record;
    if (this.disposed || !record) return this.fail('Open an exhibition before saving a replay.');
    if (this.state.phase === 'opening') return this.fail(SHOWCASE_COPY.openingReplay);
    if (this.state.storage === 'loading') return this.fail(SHOWCASE_COPY.loadingArchive);
    return this.store(compactReplay(record, this.state.arena), true);
  }

  /**
   * Adds a finished match's replay to the archive without opening it in the viewer (M-22): saving from a match used to
   * load the entry into this session, which put it in place of whatever replay the Showcase had open. The entry is
   * checked as an opened one is; the viewer's own replay, position and messages are left as they are.
   */
  async archive(input: ReplayEntry): Promise<ShowcaseOperation> {
    // Asked again after the check below: the archive may start loading while the entry is checked.
    const loading = () => this.state.storage === 'loading';
    if (this.disposed) return { ok: false, message: 'The Showcase viewer is closed.' };
    if (loading()) return { ok: false, message: SHOWCASE_COPY.loadingArchive };
    let entry: ReplayEntry;
    try { entry = compactReplay(await runReplayJob<ShowcaseRecord>({ kind: 'open', entry: compactReplay(input) })); }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'The replay could not be opened.' }; }
    if (this.disposed) return { ok: false, message: 'The Showcase viewer is closed.' };
    if (loading()) return { ok: false, message: SHOWCASE_COPY.loadingArchive };
    return this.store(entry, false);
  }

  /** Writes `entry` at the head of the archive. `announce` puts the outcome in the viewer's messages (its own Save). */
  private store(entry: ReplayEntry, announce: boolean): ShowcaseOperation {
    const said = (message: string, error = '') => announce ? { message, error } : {};
    const exists = this.state.library.some(item => item.id === entry.id);
    if (!exists && this.state.library.length >= MAX_REPLAYS) {
      const message = `The archive holds ${MAX_REPLAYS} replays. Export or remove one before saving another.`;
      return announce ? this.fail(message) : { ok: false, message };
    }
    const entries = Object.freeze([entry, ...this.state.library.filter(item => item.id !== entry.id)]);
    if (this.state.storage === 'corrupt') {
      this.patch({ library: entries, ...said(SHOWCASE_COPY.corrupt, SHOWCASE_COPY.corrupt) });
      return { ok: false, message: SHOWCASE_COPY.corrupt, entry };
    }
    const result = writeReplayArchive(this.storage, entries, this.expectedRaw);
    if (result.ok) {
      this.expectedRaw = result.raw!; this.persistedIds = new Set(entries.map(item => item.id));
      this.patch({ library: entries, storage: 'saved', ...said(result.message) });
    } else this.patch({ library: entries, storage: 'session', ...said(result.message, result.message) });
    return { ok: result.ok, message: result.message, entry };
  }

  removeReplay(id: string): ShowcaseOperation {
    if (this.state.storage === 'loading') return this.fail(SHOWCASE_COPY.loadingArchive);
    if (this.disposed || !this.state.library.some(entry => entry.id === id)) return this.fail('That replay is no longer in the archive.');
    const entries = Object.freeze(this.state.library.filter(entry => entry.id !== id));
    if (!this.persistedIds.has(id)) {
      this.patch({ library: entries, error: '', message: 'Replay removed from this visit.' });
      return { ok: true, message: 'Replay removed from this visit.' };
    }
    if (this.state.storage === 'corrupt') return this.fail(SHOWCASE_COPY.corrupt);
    const result = writeReplayArchive(this.storage, entries, this.expectedRaw);
    if (!result.ok) return this.fail('The replay could not be deleted. Its saved data is unchanged. Try again.');
    this.expectedRaw = result.raw!; this.persistedIds = new Set(entries.map(entry => entry.id));
    this.patch({ library: entries, storage: 'saved', error: '', message: 'Replay deleted.' });
    return { ok: true, message: 'Replay deleted.' };
  }

  async import(text: string): Promise<ShowcaseOperation> {
    if (this.disposed) return { ok: false, message: 'The Showcase viewer is closed.' };
    if (this.suspended) return { ok: false, message: 'Return to Showcase before importing a replay.' };
    if (this.state.storage === 'loading') return this.fail(SHOWCASE_COPY.loadingArchive);
    this.cancelGeneration(); this.cancelOpening(); this.elapsed = 0;
    const generation = ++this.generation, abort = this.openAbort = new AbortController();
    this.patch({ phase: 'opening', playing: false, error: '', message: SHOWCASE_COPY.openingReplay });
    try {
      const record = await runReplayJob<ShowcaseRecord>({ kind: 'import', text, arena: this.state.arena, createdAt: this.now().toISOString() }, abort.signal);
      if (this.disposed || this.suspended || abort.signal.aborted || generation !== this.generation) return { ok: false, message: '' };
      const duplicate = this.state.library.find(entry => entry.pgn === record.pgn);
      if (duplicate) { const opened = await this.load(duplicate); return opened.ok ? { ok: true, message: 'This replay is already in the archive.', entry: duplicate } : opened; }
      if (this.state.library.length >= MAX_REPLAYS) { this.patch({ phase: this.state.record ? 'ready' : 'error' }); return this.fail(`The archive holds ${MAX_REPLAYS} replays. Export or remove one before importing another.`); }
      this.patch({ phase: 'ready', record, ply: 0, arena: record.arena, playing: false, progress: 1, error: '', message: '' });
      return this.save();
    } catch (error) {
      if (this.disposed || abort.signal.aborted || generation !== this.generation) return { ok: false, message: '' };
      this.patch({ phase: this.state.record ? 'ready' : 'error' });
      return this.fail(error instanceof Error ? error.message : 'The replay file could not be imported.');
    } finally { if (generation === this.generation) this.openAbort = null; }
  }

  exportPGN(): string { return this.state.record?.pgn || ''; }
  exportJSON(): string { return this.state.record ? JSON.stringify({ format: 'crownfall-showcase-replay', version: 1, entry: compactReplay(this.state.record, this.state.arena) }, null, 2) : ''; }

  reloadArchive(): Promise<ShowcaseOperation> {
    if (this.disposed) return Promise.resolve({ ok: false, message: 'The Showcase viewer is closed.' });
    this.archiveAbort?.abort(); this.archiveGeneration++;
    const source = readReplayArchiveSource(this.storage);
    if (source.status !== 'saved') {
      this.patch({ storage: 'session', message: SHOWCASE_COPY.unavailable, error: SHOWCASE_COPY.unavailable });
      return this.archiveTask = Promise.resolve({ ok: false, message: SHOWCASE_COPY.unavailable });
    }
    this.patch({ storage: 'loading', message: SHOWCASE_COPY.loadingArchive, error: '' });
    return this.archiveTask = this.hydrateArchive(source.raw);
  }

  private async hydrateArchive(raw: string | null): Promise<ShowcaseOperation> {
    const generation = ++this.archiveGeneration, abort = this.archiveAbort = new AbortController();
    try {
      const stored = await runReplayJob<readonly ReplayEntry[]>({ kind: 'archive', raw }, abort.signal);
      if (this.disposed || abort.signal.aborted || generation !== this.archiveGeneration) return { ok: false, message: '' };
      const staged = this.state.library.filter(entry => !this.persistedIds.has(entry.id));
      const entries = Object.freeze([...staged, ...stored.filter(entry => !staged.some(item => item.id === entry.id))]);
      if (entries.length > MAX_REPLAYS) {
        const message = 'The stored archive changed and is full. Export the replay from this visit before reloading.';
        this.patch({ storage: 'session', error: message, message });
        return { ok: false, message };
      }
      this.expectedRaw = raw; this.persistedIds = new Set(stored.map(entry => entry.id));
      this.patch({ library: entries, storage: staged.length ? 'session' : 'saved', message: staged.length ? 'Visit-only replays are retained. Save one to try storage again.' : '', error: '' });
      return { ok: true, message: 'Replay archive reloaded.' };
    } catch (error) {
      if (this.disposed || abort.signal.aborted || generation !== this.archiveGeneration) return { ok: false, message: '' };
      const message = error instanceof Error ? `${error.message} The stored archive is unchanged; new replays stay in this visit.` : SHOWCASE_COPY.corrupt;
      this.patch({ storage: 'corrupt', error: message, message });
      return { ok: false, message };
    } finally { if (generation === this.archiveGeneration) this.archiveAbort = null; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.abort?.abort(); this.abort = null; this.generation++;
    this.openAbort?.abort(); this.openAbort = null;
    this.archiveAbort?.abort(); this.archiveAbort = null; this.archiveGeneration++;
    this.disposed = true; this.listeners.clear(); this.elapsed = 0;
  }
}
