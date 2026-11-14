/** Independently designed presentation execution beneath the resident's selected action.
 * It owns no clock, route, save, gameplay completion or contact authority. A marker
 * says only that an authored clip interval was evaluated. */
export type ResidentAnimationState = 'requested' | 'ready' | 'playing' | 'finishing' | 'completed' | 'failed' | 'cancelled';
export type ResidentAnimationHold = 'none' | 'cadence' | 'blend-zero-weight' | 'paused' | 'reduced-motion' | 'clip-unavailable' | 'root-motion-unqualified' | 'disposed';
export type ResidentAnimationMarkerKind = 'contact' | 'attachment' | 'effect' | 'phase' | 'completion';
export interface ResidentAnimationMarker {
  readonly id: string; readonly name: string; readonly seconds: number; readonly kind: ResidentAnimationMarkerKind;
}
export interface ResidentAnimationClip {
  readonly id: string; readonly duration: number; readonly loop: boolean; readonly markers: readonly ResidentAnimationMarker[];
}
export interface ResidentAnimationExecutionSnapshot {
  readonly ownerId: string; readonly requestId: number; readonly requestedMotion: string;
  readonly clipId: string | null; readonly state: ResidentAnimationState; readonly hold: ResidentAnimationHold;
  /** Unwrapped selected-clip seconds. This never measures physical travel or work. */
  readonly timeSeconds: number; readonly evaluatedTimeSeconds: number; readonly loop: number;
  readonly lastOutcome: 'completed' | 'failed' | 'cancelled' | null;
  readonly lastOutcomeMotion: string | null; readonly lastOutcomeRequestId: number | null;
  readonly markerEvents: number; readonly lifecycleEvents: number; readonly droppedEvents: number;
}
/** Borrowed only during drainEvents: consumers must copy a record they retain. */
export interface ResidentAnimationEvent {
  readonly ownerId: string; readonly requestId: number; readonly motion: string; readonly clipId: string | null;
  readonly kind: 'lifecycle' | 'marker'; readonly state: ResidentAnimationState;
  readonly seconds: number; readonly loop: number; readonly hold: ResidentAnimationHold;
  readonly markerId: string | null; readonly markerName: string | null; readonly markerKind: ResidentAnimationMarkerKind | null;
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const identifierControls = /[\u0000-\u001f\u007f]/u;
const validName = (s: string) => typeof s === 'string' && s.length > 0 && s.length <= 256 && s.trim() === s && !identifierControls.test(s);
const time = (s: number) => Number.isFinite(s) && s >= 0;
const kinds: readonly ResidentAnimationMarkerKind[] = ['contact', 'attachment', 'effect', 'phase', 'completion'];
const boundedAdd = (a: number, b: number) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
const terminal = (state: ResidentAnimationState) => state === 'completed' || state === 'failed' || state === 'cancelled';

/** Setup-only validation; ordering is authored and is never repaired at runtime.
 * Multiple distinct markers may share a timestamp. A completion marker must be
 * the one-shot's final timestamp; loops have no completion marker. */
export function qualifyResidentAnimationClip(id: string, duration: number, loop: boolean,
  markers: readonly ResidentAnimationMarker[] = []): ResidentAnimationClip {
  if (!validName(id) || !time(duration) || duration <= 0 || typeof loop !== 'boolean' || markers.length > 128) throw Error('Invalid resident animation clip metadata.');
  const ids = new Set<string>(); let previous = -1, completions = 0;
  for (const marker of markers) {
    if (!validName(marker.id) || !validName(marker.name) || ids.has(marker.id) || !time(marker.seconds)
      || marker.seconds < previous || marker.seconds > duration || !kinds.includes(marker.kind)
      || marker.kind === 'completion' && (loop || marker.seconds !== duration || ++completions > 1)) throw Error('Resident animation markers require unique IDs, authored order and valid clip phases.');
    ids.add(marker.id); previous = marker.seconds;
  }
  return Object.freeze({ id, duration, loop, markers: Object.freeze(markers.map(marker => Object.freeze({ ...marker }))) });
}

/** One instance per real actor. Storage is allocated at setup; advancing a pose
 * and emitting/draining events allocate nothing. The fixed queue drops its oldest
 * record on overflow and reports the loss instead of replaying unbounded history. */
export class ResidentAnimationExecution {
  readonly snapshot: ResidentAnimationExecutionSnapshot;
  private readonly view: Mutable<ResidentAnimationExecutionSnapshot>;
  private readonly events: Mutable<ResidentAnimationEvent>[];
  private head = 0; private count = 0;
  private clip: ResidentAnimationClip | null = null;
  private playbackId: string | undefined;
  /** High water survives seeks. Only a new request/replay can re-arm old markers. */
  private markerThrough = 0;
  private evaluated = false;
  constructor(ownerId: string, capacity = 128) {
    if (!validName(ownerId) || !Number.isSafeInteger(capacity) || capacity < 8 || capacity > 1024) throw Error('Invalid resident animation owner or event capacity.');
    this.view = { ownerId, requestId: 0, requestedMotion: 'idle', clipId: null, state: 'cancelled', hold: 'none', timeSeconds: 0,
      evaluatedTimeSeconds: 0, loop: 0, lastOutcome: null, lastOutcomeMotion: null, lastOutcomeRequestId: null,
      markerEvents: 0, lifecycleEvents: 0, droppedEvents: 0 };
    this.snapshot = this.view;
    this.events = Array.from({ length: capacity }, () => ({ ownerId, requestId: 0, motion: 'idle', clipId: null,
      kind: 'lifecycle', state: 'cancelled', seconds: 0, loop: 0, hold: 'none', markerId: null, markerName: null, markerKind: null }));
  }
  /** Return true exactly when the real owner must initialize a new playback.
   * Requesting a missing clip fails this request without claiming a fallback is
   * that action. The owner retains its previously evaluated qualified pose. */
  request(motion: string, clip: ResidentAnimationClip | null, playbackId: string | undefined, initialTime: number,
    unavailable: 'clip-unavailable' | 'root-motion-unqualified' = 'clip-unavailable'): boolean {
    if (!validName(motion) || playbackId !== undefined && !validName(playbackId) || !time(initialTime)) throw Error('Invalid resident animation request.');
    if (this.view.requestId && motion === this.view.requestedMotion && clip === this.clip && playbackId === this.playbackId) return false;
    if (this.view.requestId === Number.MAX_SAFE_INTEGER) throw Error('Resident animation request counter exhausted.');
    if (this.view.requestId && !terminal(this.view.state)) this.cancel();
    this.view.requestId++; this.view.requestedMotion = motion; this.view.clipId = clip?.id ?? null;
    this.clip = clip; this.playbackId = playbackId; this.evaluated = false;
    this.view.timeSeconds = clip && !clip.loop ? Math.min(initialTime, clip.duration) : initialTime;
    this.view.evaluatedTimeSeconds = this.view.timeSeconds; this.view.loop = this.loopAt(this.view.timeSeconds);
    this.markerThrough = this.view.timeSeconds; this.view.hold = clip ? 'cadence' : unavailable;
    this.change('requested'); this.change(clip ? 'ready' : 'failed');
    return true;
  }
  hold(reason: ResidentAnimationHold): void { this.view.hold = reason; }
  /** Logical time may advance while cadence suspends evaluation. Explicit pose
   * samples and backwards samples are seeks: they never dispatch crossed markers.
   * Seeking backwards cannot re-arm an already crossed marker in this request. */
  stage(seconds: number, seek = false): void {
    if (!time(seconds) || !this.clip || this.view.state === 'failed' || this.view.state === 'cancelled') return;
    const next = this.clip.loop ? seconds : Math.min(seconds, this.clip.duration);
    if (seek || next < this.view.timeSeconds) this.markerThrough = Math.max(this.markerThrough, next);
    this.view.timeSeconds = next; this.view.loop = this.loopAt(next);
    if (!terminal(this.view.state) && !this.clip.loop && next === this.clip.duration) this.change('finishing');
  }
  /** Called only after the matching pose has actually been evaluated. A
   * one-shot endpoint still mixed with an outgoing clip remains finishing. */
  evaluate(fullyWeighted = true): void {
    if (!this.clip || this.view.state === 'failed' || this.view.state === 'cancelled') return;
    this.view.hold = 'none'; this.view.evaluatedTimeSeconds = this.view.timeSeconds;
    if (!terminal(this.view.state)) {
      if (!this.evaluated && this.view.state !== 'finishing') this.change('playing');
      this.dispatch(this.markerThrough, this.view.timeSeconds);
      if (!this.clip.loop && this.view.timeSeconds === this.clip.duration) this.change(fullyWeighted ? 'completed' : 'finishing');
      else this.change('playing');
    }
    this.markerThrough = Math.max(this.markerThrough, this.view.timeSeconds); this.evaluated = true;
  }
  cancel(disposed = false): void {
    if (disposed) this.view.hold = 'disposed';
    if (this.view.requestId && !terminal(this.view.state)) this.change('cancelled');
  }
  drainEvents(consume: (event: ResidentAnimationEvent) => void): void {
    while (this.count) {
      const event = this.events[this.head]; this.head = (this.head + 1) % this.events.length; this.count--;
      consume(event);
    }
  }
  private loopAt(seconds: number): number {
    return this.clip?.loop ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(seconds / this.clip.duration)) : 0;
  }
  private change(state: ResidentAnimationState): void {
    if (this.view.state === state) return;
    this.view.state = state;
    if (terminal(state)) { this.view.lastOutcome = state as 'completed' | 'failed' | 'cancelled'; this.view.lastOutcomeMotion = this.view.requestedMotion; this.view.lastOutcomeRequestId = this.view.requestId; }
    this.view.lifecycleEvents = boundedAdd(this.view.lifecycleEvents, 1); this.emit(null, this.view.timeSeconds, this.view.loop);
  }
  private emit(marker: ResidentAnimationMarker | null, seconds: number, loop: number): void {
    if (this.count === this.events.length) { this.head = (this.head + 1) % this.events.length; this.count--; this.view.droppedEvents = boundedAdd(this.view.droppedEvents, 1); }
    const e = this.events[(this.head + this.count++) % this.events.length];
    e.requestId = this.view.requestId; e.motion = this.view.requestedMotion; e.clipId = this.view.clipId;
    e.kind = marker ? 'marker' : 'lifecycle'; e.state = this.view.state; e.seconds = seconds; e.loop = loop; e.hold = this.view.hold;
    e.markerId = marker?.id ?? null; e.markerName = marker?.name ?? null; e.markerKind = marker?.kind ?? null;
  }
  private dispatch(from: number, to: number): void {
    const clip = this.clip!; if (to <= from || !clip.markers.length) return;
    if (!clip.loop) {
      for (const marker of clip.markers) if (marker.seconds > from && marker.seconds <= to) {
        this.view.markerEvents = boundedAdd(this.view.markerEvents, 1); this.emit(marker, marker.seconds, 0);
      }
      return;
    }
    // Count all crossings arithmetically, then produce only a bounded tail. Tiny
    // loops or a distant absolute sample cannot create a frame-long catchup loop.
    if (!Number.isSafeInteger(Math.floor(to / clip.duration))) {
      this.view.markerEvents = Number.MAX_SAFE_INTEGER; this.view.droppedEvents = Number.MAX_SAFE_INTEGER; return;
    }
    let total = 0;
    for (const marker of clip.markers) {
      const first = Math.max(0, Math.floor((from - marker.seconds) / clip.duration) + 1), last = Math.floor((to - marker.seconds) / clip.duration);
      if (last >= first) total = boundedAdd(total, last - first + 1);
    }
    this.view.markerEvents = boundedAdd(this.view.markerEvents, total);
    if (!total) return;
    let skip = Math.max(0, total - this.events.length);
    this.view.droppedEvents = boundedAdd(this.view.droppedEvents, skip);
    // At most capacity+1 loops need visiting: every full loop has a marker.
    const lastLoop = Math.floor(to / clip.duration), firstLoop = Math.max(0, Math.floor(from / clip.duration), lastLoop - this.events.length);
    let omitted = 0;
    for (const marker of clip.markers) {
      const first = Math.max(0, Math.floor((from - marker.seconds) / clip.duration) + 1), last = Math.min(firstLoop - 1, Math.floor((to - marker.seconds) / clip.duration));
      if (last >= first) omitted = boundedAdd(omitted, last - first + 1);
    }
    skip = Math.max(0, skip - omitted);
    for (let loop = firstLoop; loop <= lastLoop; loop++) {
      // Unrepresentable cycle indices are pose-only. This guard also prevents
      // an IEEE-754 loop counter from ceasing to advance on hostile metadata.
      if (!Number.isSafeInteger(loop)) { this.view.droppedEvents = boundedAdd(this.view.droppedEvents, Math.min(total, this.events.length)); break; }
      for (const marker of clip.markers) {
        const at = loop * clip.duration + marker.seconds;
        if (at <= from || at > to) continue;
        if (skip) { skip--; continue; }
        this.emit(marker, at, loop);
      }
    }
  }
}

/** Adapter for the existing authored household sidecar tables. These are exact
 * publisher seconds, including prop swaps; no contact fractions are inferred. */
export function householdResidentAnimationMarkers(events: Readonly<Record<string, readonly number[]>> | undefined,
  swaps: readonly { readonly seconds: number; readonly node: string; readonly to: 'hand' | 'rest' }[] = []): readonly ResidentAnimationMarker[] {
  const markers: ResidentAnimationMarker[] = [];
  for (const [name, seconds] of Object.entries(events ?? {})) for (let i = 0; i < seconds.length; i++) {
    markers.push({ id: `${name}:${i}`, name, seconds: seconds[i], kind: name === 'impactSeconds' ? 'contact' : 'phase' });
  }
  for (let i = 0; i < swaps.length; i++) {
    const swap = swaps[i]; markers.push({ id: `attachment:${i}`, name: `${swap.node}:${swap.to}`, seconds: swap.seconds, kind: 'attachment' });
  }
  return markers.sort((a, b) => a.seconds - b.seconds);
}

/** Current request counts plus consumed cosmetic records, for existing runtime
 * diagnostics. They grant no presentation, route or gameplay permission. */
export interface ResidentAnimationMetrics {
  readonly ready: number; readonly playing: number; readonly finishing: number;
  readonly completed: number; readonly failed: number; readonly held: number;
  readonly markerEvents: number; readonly lifecycleEvents: number; readonly droppedEvents: number;
}
