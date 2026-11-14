/**
 * Media transport for the end-credits film, shared by the desktop <video> and
 * the Quest video texture. It owns playback and the muted flag only; the menu
 * audio graph owns loudness (CrownfallMenuAudio.attachFilm).
 *
 * Browsers allow a muted, inline video to load and play without a gesture, so
 * the element is prepared muted with playsinline. A trusted press unmutes it
 * and calls play() in the same call stack; if the browser still refuses sound,
 * the film continues silently and reports 'muted' rather than failing.
 * A start that asks to hold instead (the opening, before the player has pressed
 * anything) stays paused and reports 'blocked', so the adapter can ask for a press.
 */
export type CreditsFilmMediaEvent = 'playing' | 'ended' | 'failed' | 'muted' | 'blocked';

export interface CreditsFilmPlayerOptions {
  src: string;
  onEvent(event: CreditsFilmMediaEvent): void;
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
}

/** Applies the attributes every film element needs before it has a source. */
export function prepareCreditsFilmElement(media: HTMLVideoElement, src: string): void {
  media.playsInline = true;
  media.setAttribute('playsinline', '');
  media.setAttribute('webkit-playsinline', '');
  media.muted = true;
  media.setAttribute('muted', '');
  media.loop = false;
  media.controls = false;
  media.preload = 'auto';
  media.crossOrigin = 'anonymous';
  media.src = src;
}

export class CreditsFilmPlayer {
  private disposed = false;
  private attempt = 0;
  private readonly removeListeners: () => void;

  constructor(readonly media: HTMLVideoElement, private readonly options: CreditsFilmPlayerOptions) {
    prepareCreditsFilmElement(media, options.src);
    const emit = (event: CreditsFilmMediaEvent) => { if (!this.disposed) options.onEvent(event); };
    const playing = () => emit('playing');
    const ended = () => { if (media.ended) emit('ended'); };
    const error = () => { if (media.error) emit('failed'); };
    media.addEventListener('playing', playing);
    media.addEventListener('ended', ended);
    media.addEventListener('error', error);
    this.removeListeners = () => {
      media.removeEventListener('playing', playing);
      media.removeEventListener('ended', ended);
      media.removeEventListener('error', error);
    };
  }

  get muted(): boolean { return this.media.muted; }

  /**
   * A new playthrough from the first frame. Call inside the trusted press when there is one.
   * holdIfRefused: if the browser refuses sound, stay paused and report 'blocked' instead of playing silently.
   */
  start(trusted: boolean, options: { holdIfRefused?: boolean } = {}): void {
    if (this.disposed) return;
    this.rewind();
    this.play(trusted, !!options.holdIfRefused);
  }

  /** Paused, silent, on the first frame: a film waiting for the press that starts it. */
  hold(): void {
    if (this.disposed) return;
    this.attempt++;
    if (!this.media.paused) this.media.pause();
    this.media.muted = true;
    this.media.setAttribute('muted', '');
    this.rewind();
  }

  /** Continue from the current frame. A trusted press also restores sound. */
  resume(trusted: boolean): void {
    if (!this.disposed) this.play(trusted);
  }

  pause(): void {
    if (this.disposed) return;
    this.attempt++;
    if (!this.media.paused) this.media.pause();
  }

  /** Stops loading and decoding; the element is never reused. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.attempt++;
    this.removeListeners();
    try { this.media.pause(); } catch { /* Already released by the browser. */ }
    try { this.media.removeAttribute('src'); this.media.load(); } catch { /* Teardown never blocks navigation. */ }
  }

  private rewind(): void {
    try { if (this.media.currentTime > 0) this.media.currentTime = 0; } catch { /* Seeking before metadata is optional. */ }
  }

  private play(trusted: boolean, holdIfRefused = false): void {
    const attempt = ++this.attempt;
    if (trusted) { this.media.muted = false; this.media.removeAttribute('muted'); }
    const refused = (error: unknown) => {
      if (this.disposed || attempt !== this.attempt) return;
      const name = errorName(error);
      // A pause or new source supersedes this request; that is not a failure.
      if (name === 'AbortError') return;
      if (name === 'NotAllowedError' && !this.media.muted && holdIfRefused) {
        this.media.muted = true;
        this.media.setAttribute('muted', '');
        try { if (!this.media.paused) this.media.pause(); } catch { /* Never started. */ }
        this.options.onEvent('blocked');
        return;
      }
      if (name === 'NotAllowedError' && !this.media.muted) {
        this.media.muted = true;
        this.options.onEvent('muted');
        this.request(attempt, error => {
          if (!this.disposed && attempt === this.attempt && errorName(error) !== 'AbortError') this.options.onEvent('failed');
        });
        return;
      }
      this.options.onEvent('failed');
    };
    this.request(attempt, refused);
  }

  private request(attempt: number, refused: (error: unknown) => void): void {
    try {
      // Must stay in the press's call stack: no awaiting before play().
      void Promise.resolve(this.media.play()).catch(refused);
    } catch (error) {
      if (attempt === this.attempt) refused(error);
    }
  }
}
