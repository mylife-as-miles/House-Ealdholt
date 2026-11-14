import { STARTUP_TRACK_ID, type CrownfallTrack } from './soundtrack';

export interface MenuNowPlaying {
  trackId: string;
  title: string;
  artist?: string;
  /** Changes once per newly audible track, never for pause/resume. */
  sequence: number;
  playing: boolean;
}
export type MenuMusicState = 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

/** A shuffled cycle contains every track once; adjoining cycles cannot repeat. */
export class SoundtrackShuffleBag {
  private bag: number[] = [];
  private previous = -1;
  constructor(private readonly count: number, private readonly random: () => number = Math.random, private opener = -1) {}

  next(): number | null {
    if (!this.count) return null;
    if (!this.bag.length) {
      this.bag = Array.from({ length: this.count }, (_, index) => index);
      for (let index = this.bag.length - 1; index > 0; index--) {
        const value = this.random();
        const target = Math.min(index, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * (index + 1))));
        [this.bag[index], this.bag[target]] = [this.bag[target], this.bag[index]];
      }
      if (this.count > 1 && this.bag[0] === this.previous) {
        [this.bag[0], this.bag[1]] = [this.bag[1], this.bag[0]];
      }
      if (this.opener >= 0 && this.opener < this.count) {
        const position = this.bag.indexOf(this.opener);
        [this.bag[0], this.bag[position]] = [this.bag[position], this.bag[0]];
      }
      this.opener = -1;
    }
    this.previous = this.bag.shift()!;
    return this.previous;
  }
}

interface SoundtrackPlayerOptions {
  tracks: readonly CrownfallTrack[];
  createMedia?: () => HTMLAudioElement;
  random?: () => number;
  onChange: () => void;
}
interface CurrentTrack { track: CrownfallTrack; started: boolean; position: number }

/**
 * One streaming element and one source node at a time. No MP3 is fetched until
 * the adapter has supplied a gesture and enabled music. The audio graph owns
 * audibility; media/network promises never hold up a menu action.
 */
export class CrownfallSoundtrackPlayer {
  private readonly bag: SoundtrackShuffleBag;
  private readonly createMedia: () => HTMLAudioElement;
  private context: AudioContext | null = null;
  private destination: GainNode | null = null;
  private current: CurrentTrack | null = null;
  private media: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private removeMediaListeners: (() => void) | null = null;
  private enabled = false;
  private audible = false;
  private mediaPlaying = false;
  private playPending = false;
  private attempt = 0;
  private sequence = 0;
  private failures = 0;
  private deferredFailure = false;
  private disposed = false;
  private stopped: 'blocked' | 'error' | null = null;
  private failureMessage = '';

  constructor(private readonly options: SoundtrackPlayerOptions) {
    this.bag = new SoundtrackShuffleBag(options.tracks.length, options.random, options.tracks.findIndex(track => track.id === STARTUP_TRACK_ID));
    this.createMedia = options.createMedia ?? (() => new Audio());
  }

  get nowPlaying(): MenuNowPlaying | null {
    const current = this.current;
    if (!current?.started) return null;
    return {
      trackId: current.track.id, title: current.track.title,
      ...(current.track.artist ? { artist: current.track.artist } : {}),
      sequence: this.sequence, playing: this.isPlaying,
    };
  }

  get isPlaying(): boolean {
    return Boolean(!this.disposed && this.enabled && this.audible && this.mediaPlaying && this.media && !this.media.paused);
  }

  get state(): MenuMusicState {
    if (this.disposed || !this.current) return 'idle';
    if (this.stopped) return this.stopped;
    if (!this.enabled) return 'paused';
    return this.isPlaying ? 'playing' : 'loading';
  }

  get error(): string { return this.failureMessage; }

  /** A closed AudioContext requires a fresh media/source pair, preserving song position. */
  setOutput(context: AudioContext | null, destination: GainNode | null): void {
    if (this.context === context && this.destination === destination) return;
    this.releaseMedia(true);
    this.context = context;
    this.destination = destination;
  }

  /** retry is reserved for a new trusted gesture or an explicit Next action. */
  update(enabled: boolean, audible: boolean, retry = false): void {
    if (this.disposed) return;
    this.enabled = enabled;
    this.audible = audible;
    if (!enabled) {
      this.pause();
      return;
    }
    if (retry && this.stopped) {
      this.stopped = null;
      this.failureMessage = '';
      this.failures = 0;
    }
    if (this.stopped) return;
    if (!this.current) this.chooseNext();
    if (!this.current || !this.context || !this.destination) return;
    if (this.deferredFailure) {
      this.deferredFailure = false;
      this.failTrack();
      return;
    }
    if (this.media?.ended) {
      this.next();
      return;
    }
    if (!this.media && !this.createBinding()) return;
    this.confirmAudible();
    if (this.media && !this.playPending && this.media.paused) this.startMedia(this.media);
  }

  next(): void {
    if (this.disposed || !this.options.tracks.length) return;
    this.failures = 0;
    this.stopped = null;
    this.failureMessage = '';
    this.deferredFailure = false;
    this.chooseNext();
    this.update(this.enabled, this.audible);
    this.options.onChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.audible = false;
    this.releaseMedia(false);
    this.context = null;
    this.destination = null;
    this.current = null;
  }

  private chooseNext(): void {
    this.releaseMedia(false);
    const index = this.bag.next();
    this.current = index === null ? null : { track: this.options.tracks[index], started: false, position: 0 };
  }

  private createBinding(): boolean {
    let media: HTMLAudioElement | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    try {
      media = this.createMedia();
      media.preload = 'none';
      media.loop = false;
      media.crossOrigin = 'anonymous';
      media.muted = true;
      media.volume = 0;
      // Bind before setting src so an unavailable WebAudio route cannot leak music.
      source = this.context!.createMediaElementSource(media);
      source.connect(this.destination!);
      media.volume = 1;
      media.muted = false;
      this.media = media;
      this.source = source;
      const currentMedia = media;
      const listen = (name: string, listener: () => void) => currentMedia.addEventListener(name, listener);
      const playing = () => {
        if (this.media !== currentMedia || this.disposed) return;
        if (!this.enabled) { this.pause(); return; }
        if (currentMedia.paused) return;
        this.mediaPlaying = true;
        this.confirmAudible();
        this.options.onChange();
      };
      const waiting = () => {
        if (this.media !== currentMedia || this.disposed) return;
        this.mediaPlaying = false;
        this.options.onChange();
      };
      const ended = () => {
        if (this.media !== currentMedia || this.disposed || !currentMedia.ended) return;
        this.mediaPlaying = false;
        if (this.enabled) {
          if (!this.current?.started) this.failTrack();
          else {
            this.chooseNext();
            this.update(this.enabled, this.audible);
          }
        }
        this.options.onChange();
      };
      const error = () => {
        if (this.media !== currentMedia || this.disposed || !currentMedia.error) return;
        if (this.enabled) this.failTrack();
        else this.deferredFailure = true;
        this.options.onChange();
      };
      const listeners: Array<[string, () => void]> = [
        ['playing', playing], ['waiting', waiting], ['pause', waiting], ['ended', ended], ['error', error],
      ];
      for (const [name, listener] of listeners) listen(name, listener);
      this.removeMediaListeners = () => { for (const [name, listener] of listeners) currentMedia.removeEventListener(name, listener); };
      media.src = this.current!.track.src;
      if (this.current!.position > 0) {
        try { media.currentTime = this.current!.position; } catch { /* Older engines apply seek once metadata is available. */ }
        const restore = () => {
          if (this.media !== currentMedia || !this.current) return;
          try { currentMedia.currentTime = this.current.position; } catch { /* Seeking is optional when media is not seekable. */ }
        };
        media.addEventListener('loadedmetadata', restore, { once: true });
        const remove = this.removeMediaListeners;
        this.removeMediaListeners = () => { remove(); currentMedia.removeEventListener('loadedmetadata', restore); };
      }
      return true;
    } catch {
      // Binding failure is a graph/browser failure, not evidence that all tracks are bad.
      source?.disconnect();
      if (this.media === media) this.releaseMedia(false);
      else if (media) this.clearElement(media);
      this.stopped = 'error';
      this.failureMessage = 'Music could not start. Select to try again.';
      this.options.onChange();
      return false;
    }
  }

  private startMedia(media: HTMLAudioElement): void {
    const attempt = ++this.attempt;
    this.playPending = true;
    try {
      // Must run in the gesture call stack. Do not await network or playback here.
      const pending = media.play();
      void Promise.resolve(pending).then(() => {
        if (this.disposed || this.media !== media || this.attempt !== attempt) return;
        this.playPending = false;
        this.confirmAudible();
        this.options.onChange();
      }).catch((error: unknown) => {
        if (this.disposed || this.media !== media || this.attempt !== attempt) return;
        this.playPending = false;
        this.rejectPlay(error);
      });
    } catch (error) {
      this.playPending = false;
      this.rejectPlay(error);
    }
  }

  private rejectPlay(error: unknown): void {
    if (!this.enabled) return;
    const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'AbortError') {
      this.stopped = 'blocked';
      this.failureMessage = 'Music is paused. Select to try again.';
      this.pause();
    } else this.failTrack();
    this.options.onChange();
  }

  private confirmAudible(): void {
    if (!this.current || !this.isPlaying) return;
    this.failures = 0;
    this.failureMessage = '';
    if (!this.current.started) {
      this.current.started = true;
      this.sequence++;
    }
  }

  private failTrack(): void {
    this.failures++;
    this.releaseMedia(false);
    if (this.failures >= this.options.tracks.length) {
      this.stopped = 'error';
      this.failureMessage = 'Music is unavailable. Select to try again.';
      return;
    }
    this.chooseNext();
    this.update(this.enabled, this.audible);
  }

  private pause(): void {
    this.attempt++;
    this.playPending = false;
    this.mediaPlaying = false;
    if (this.media && !this.media.paused) this.media.pause();
  }

  private releaseMedia(preservePosition: boolean): void {
    this.attempt++;
    this.playPending = false;
    this.mediaPlaying = false;
    const media = this.media;
    if (preservePosition && media && this.current && Number.isFinite(media.currentTime)) this.current.position = media.currentTime;
    this.removeMediaListeners?.();
    this.removeMediaListeners = null;
    this.media = null;
    this.source?.disconnect();
    this.source = null;
    if (media) this.clearElement(media);
  }

  private clearElement(media: HTMLAudioElement): void {
    // Browser teardown and a failed factory must not be able to block navigation.
    try { media.pause(); } catch { /* The element may already have been released by the browser. */ }
    try { media.removeAttribute('src'); media.load(); } catch { /* Retired elements are never reused. */ }
  }
}
