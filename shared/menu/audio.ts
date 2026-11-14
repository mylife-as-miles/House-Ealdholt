import type { CrownfallTrack } from './soundtrack';
import { CrownfallSoundtrackPlayer, type MenuMusicState, type MenuNowPlaying } from './soundtrack-player';

/** Streaming soundtrack and original feedback tones; no audio before a gesture. */
export interface MenuAudioPreferences {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
  music: boolean;
  soundEffects: boolean;
}

export const DEFAULT_MENU_AUDIO_PREFERENCES: Readonly<MenuAudioPreferences> = Object.freeze({
  volume: 65, musicVolume: 35, sfxVolume: 70, music: true, soundEffects: true,
});

export const AUDIO_SETTINGS_COPY = {
  masterVolume: { label: 'Master Volume', description: 'Adjust all menu audio. Zero is silent.' },
  music: { label: 'Music', description: 'Start with La Felure Demure, then shuffle the Crownfall soundtrack. Turning music off pauses the current track.' },
  musicVolume: { label: 'Music Volume', description: 'Adjust the soundtrack independently of menu sound effects.' },
  nextTrack: { label: 'Next track', description: 'Play another track from the shuffled soundtrack.' },
  soundEffects: { label: 'Sound Effects', description: 'Play feedback for menu selection, navigation and confirmation.' },
  sfxVolume: { label: 'Effects Volume', description: 'Adjust menu feedback independently of the soundtrack.' },
  test: { label: 'Test Sound', description: 'Play a short tone using the current master and sound-effects settings. Muted settings remain silent.' },
  playback: { label: 'Playback', description: 'A fresh shuffled track starts when you return from a cinematic or gameplay.' },
  output: { label: 'Audio Output', value: 'System default', description: 'Your browser or headset manages the output device. Choose it in your system settings.' },
  status: {
    unsupported: 'Unavailable in this browser', locked: 'Select to enable audio', running: 'Ready',
    suspended: 'Paused', closed: 'Stopped',
  },
  musicStatus: {
    idle: 'Ready', loading: 'Loading', playing: 'Playing', paused: 'Paused',
    blocked: 'Select to enable music', error: 'Music unavailable',
  },
} as const;

function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : fallback;
}

/** Adds new channels safely to preferences saved by older menu versions. */
export function normalizeMenuAudioPreferences(value: unknown): MenuAudioPreferences {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const d = DEFAULT_MENU_AUDIO_PREFERENCES;
  return {
    volume: volume(p.volume, d.volume), musicVolume: volume(p.musicVolume, d.musicVolume), sfxVolume: volume(p.sfxVolume, d.sfxVolume),
    music: typeof p.music === 'boolean' ? p.music : d.music,
    soundEffects: typeof p.soundEffects === 'boolean' ? p.soundEffects : d.soundEffects,
  };
}

export type MenuSound = 'navigate' | 'select' | 'back' | 'confirm' | 'cancel';
export type MenuAudioState = keyof typeof AUDIO_SETTINGS_COPY.status;
export interface MenuAudioStatus {
  supported: boolean;
  unlocked: boolean;
  state: MenuAudioState;
  contextState: AudioContextState | 'uninitialized' | 'unsupported';
  musicPlaying: boolean;
  musicState: MenuMusicState;
  nowPlaying: MenuNowPlaying | null;
  suspended: boolean;
  masterGain: number;
  musicGain: number;
  sfxGain: number;
  /** True while the end-credits film holds the music channel; the soundtrack waits. */
  filmAttached: boolean;
  filmGain: number;
  error: string;
}

/** Factories permit deterministic lifecycle tests without speakers or network. */
export interface MenuAudioOptions {
  createContext?: () => AudioContext | null;
  tracks?: readonly CrownfallTrack[];
  createMedia?: () => HTMLAudioElement;
  random?: () => number;
}
interface Voice { source: OscillatorNode; gain: GainNode; effect: boolean; stopped: boolean }
/** music: a scored film (the end credits) follows Master and Music. cinematic: a narrated film (the opening) follows Master only. */
export type MenuFilmKind = 'music' | 'cinematic';
interface FilmBinding { media: HTMLMediaElement; source: MediaElementAudioSourceNode | null; kind: MenuFilmKind }
const SOUNDS: Record<MenuSound, readonly [number, number, number]> = {
  navigate: [350, 440, 0.045], select: [440, 660, 0.075],
  back: [330, 220, 0.09], confirm: [523.25, 783.99, 0.13], cancel: [294, 196, 0.1],
};

function audioConstructor(): typeof AudioContext | undefined {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** A lazy, gesture-unlocked graph shared by the desktop and immersive adapters. */
/** Borrowed existing SFX bus; consumers must never close its context or disconnect the bus. */
export interface MenuEffectsOutput { readonly context:AudioContext; readonly destination:GainNode }

export class CrownfallMenuAudio {
  private preferences: MenuAudioPreferences = { ...DEFAULT_MENU_AUDIO_PREFERENCES };
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private filmBus: GainNode | null = null;
  private film: FilmBinding | null = null;
  // An element binds to one source node for its lifetime; a remount reuses it.
  private readonly filmSources = new WeakMap<HTMLMediaElement, { context: AudioContext; source: MediaElementAudioSourceNode }>();
  private readonly voices = new Set<Voice>();
  private readonly soundtrack: CrownfallSoundtrackPlayer;
  private readonly listeners = new Set<(status: MenuAudioStatus) => void>();
  private supported: boolean;
  private unlocked = false;
  private suspended = false;
  private freshTrackPending = false;
  private disposed = false;
  private error = '';
  private lastNavigation = -Infinity;
  private unlocking: Promise<boolean> | null = null;
  /** True until the input turn that asked for the pending resume has finished. */
  private unlockTurn = false;
  private gestureUnlock = false;
  private readonly createContext: () => AudioContext | null;

  constructor(options: MenuAudioOptions = {}) {
    this.supported = Boolean(options.createContext || audioConstructor());
    this.createContext = options.createContext ?? (() => {
      const Constructor = audioConstructor();
      return Constructor ? new Constructor() : null;
    });
    this.soundtrack = new CrownfallSoundtrackPlayer({
      tracks: options.tracks ?? [], createMedia: options.createMedia, random: options.random,
      onChange: () => this.emit(),
    });
  }

  get status(): MenuAudioStatus {
    const running = this.context?.state === 'running';
    const state: MenuAudioState = this.disposed || this.context?.state === 'closed' ? 'closed' : !this.supported ? 'unsupported'
      : this.suspended ? 'suspended' : running ? 'running' : this.unlocked ? 'suspended' : 'locked';
    return {
      supported: this.supported, unlocked: this.unlocked, state,
      contextState: this.disposed ? 'closed' : this.context?.state ?? (this.supported ? 'uninitialized' : 'unsupported'),
      musicPlaying: this.soundtrack.isPlaying, musicState: this.soundtrack.state, nowPlaying: this.soundtrack.nowPlaying,
      suspended: this.suspended, masterGain: this.master?.gain.value ?? 0,
      musicGain: this.musicBus?.gain.value ?? 0, sfxGain: this.effectsBus?.gain.value ?? 0,
      filmAttached: !!this.film, filmGain: this.film ? this.filmBus && this.film.source ? this.filmBus.gain.value : this.film.media.volume : 0,
      error: this.error || this.soundtrack.error,
    };
  }

  effectsOutput():MenuEffectsOutput|null {
    return !this.disposed&&this.unlocked&&this.context?.state!=='closed'&&this.context&&this.effectsBus
      ?{context:this.context,destination:this.effectsBus}:null;
  }

  subscribe(listener: (status: MenuAudioStatus) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  nextTrack(): void {
    if (!this.disposed) this.soundtrack.next();
  }

  configure(preferences: MenuAudioPreferences): void {
    if (this.disposed) return;
    this.preferences = normalizeMenuAudioPreferences(preferences);
    this.sync();
  }

  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    if (suspended && this.soundtrack.nowPlaying) this.freshTrackPending = true;
    this.suspended = suspended;
    this.sync();
  }

  /**
   * A film borrows the music channel. On return, an already-started soundtrack
   * advances to a fresh shuffled track. A scored film (the end credits) follows Master and Music volume and
   * the Music switch; a narrated cinematic (the opening) follows Master volume
   * only, so its voice is never lost with the music. Either is silenced with
   * the rest of the menu while suspended. Returns a release function that
   * restores the soundtrack.
   */
  attachFilm(media: HTMLMediaElement, kind: MenuFilmKind = 'music'): () => void {
    if (this.disposed) return () => {};
    if (this.film && (this.film.media !== media || this.film.kind !== kind)) this.releaseFilm(this.film);
    if (!this.film) {
      if (this.soundtrack.nowPlaying) this.freshTrackPending = true;
      this.film = { media, source: null, kind };
      this.routeFilm();
      this.sync();
    }
    const binding = this.film;
    return () => {
      if (this.film !== binding) return;
      this.releaseFilm(binding);
      if (!this.disposed) this.sync();
    };
  }

  /**
   * Call from a real user gesture. A rejected resume is safe and retryable.
   * Calls within one input turn share one request. A resume asked for outside
   * a user activation (Esc, a gamepad button) can stay pending for good, so a
   * later call asks again inside its own gesture instead of waiting on it.
   */
  unlock(): Promise<boolean> {
    if (this.disposed || !this.supported) return Promise.resolve(false);
    if (this.unlocking && (this.unlockTurn || this.context?.state === 'running')) return this.unlocking;
    try {
      if (this.context?.state === 'closed') {
        this.clearGraph();
        this.unlocked = false;
      }
      if (!this.context) this.createGraph();
    } catch {
      this.error = 'Audio could not start. Select Test Sound to try again.';
      this.emit();
      return Promise.resolve(false);
    }
    const context = this.context;
    if (!context || context.state === 'closed') { this.emit(); return Promise.resolve(false); }
    // Start media inside the gesture, while resume is still permitted. Its play
    // promise may wait on network indefinitely and must never delay navigation.
    this.gestureUnlock = true;
    this.sync(true);
    let resume: Promise<void>;
    try { resume = context.state === 'running' ? Promise.resolve() : context.resume(); }
    catch { resume = Promise.reject(new Error('Audio resume was refused')); }
    const pending = resume.then(() => {
      if (this.disposed || this.context !== context || context.state !== 'running') return false;
      this.gestureUnlock = false;
      this.unlocked = true;
      this.error = '';
      this.sync();
      return true;
    }).catch(() => {
      // A later gesture has asked again; its request owns the state now.
      if (this.disposed || this.context !== context || this.unlocking !== pending) return false;
      this.gestureUnlock = false;
      this.error = 'Audio is blocked. Select Test Sound to try again.';
      this.sync();
      return false;
    });
    this.unlocking = pending;
    this.unlockTurn = true;
    queueMicrotask(() => { this.unlockTurn = false; });
    void pending.then(() => {
      if (this.unlocking === pending) {
        this.unlocking = null;
        this.gestureUnlock = false;
      }
    });
    return pending;
  }

  /** No implicit resume: input adapters unlock in the gesture before feedback. */
  play(kind: MenuSound): void {
    const context = this.context;
    if (this.disposed || this.suspended || context?.state !== 'running' || !this.unlocked
      || !this.preferences.soundEffects || this.preferences.volume === 0 || this.preferences.sfxVolume === 0) return;
    const now = context.currentTime;
    if (kind === 'navigate' && now - this.lastNavigation < 0.075) return;
    if (kind === 'navigate') this.lastNavigation = now;
    // Rapid pointer travel must not build an unbounded queue of feedback tones.
    let effectCount = 0;
    for (const voice of this.voices) if (voice.effect && !voice.stopped) effectCount++;
    if (effectCount >= 12) return;
    const [from, to, duration] = SOUNDS[kind];
    const voice = this.tone(from, 'sine', this.effectsBus!, true, 0);
    voice.source.frequency.exponentialRampToValueAtTime(to, now + duration * 0.8);
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(0.075, now + 0.008);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    voice.source.stop(now + duration + 0.01);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.suspended = true;
    this.gestureUnlock = false;
    this.soundtrack.dispose();
    if (this.film) this.releaseFilm(this.film);
    const context = this.clearGraph();
    this.listeners.clear();
    if (context && context.state !== 'closed') void context.close().catch(() => { /* Teardown cannot block navigation. */ });
  }

  private clearGraph(): AudioContext | null {
    for (const voice of this.voices) this.release(voice);
    this.voices.clear();
    this.soundtrack.setOutput(null, null);
    if (this.film?.source) { this.film.source.disconnect(); this.film.source = null; }
    for (const bus of [this.musicBus, this.effectsBus, this.filmBus, this.master]) bus?.disconnect();
    const context = this.context;
    context?.removeEventListener('statechange', this.contextChanged);
    this.context = null; this.musicBus = null; this.effectsBus = null; this.filmBus = null; this.master = null;
    return context;
  }

  private readonly contextChanged = (): void => { if (!this.disposed) this.sync(); };

  private createGraph(): void {
    const context = this.createContext();
    if (!context) { this.supported = false; return; }
    try {
      const master = context.createGain(), music = context.createGain(), effects = context.createGain(), film = context.createGain();
      // Silence before connecting: construction cannot briefly use GainNode's 1.0 default.
      master.gain.value = 0; music.gain.value = 0; effects.gain.value = 0; film.gain.value = 0;
      music.connect(master); effects.connect(master); film.connect(master); master.connect(context.destination);
      this.context = context; this.master = master; this.musicBus = music; this.effectsBus = effects; this.filmBus = film;
      this.soundtrack.setOutput(context, music);
      context.addEventListener('statechange', this.contextChanged);
      this.routeFilm();
    } catch (error) {
      void context.close().catch(() => {});
      throw error;
    }
  }

  /** Routes the film through its bus once a graph exists; until then its element volume carries the preferences. */
  private routeFilm(): void {
    const film = this.film, context = this.context, bus = this.filmBus;
    if (!film || film.source || !context || !bus) { this.syncFilmFallback(); return; }
    try {
      const existing = this.filmSources.get(film.media);
      let source = existing?.context === context ? existing.source : null;
      if (!source && !existing) {
        source = context.createMediaElementSource(film.media);
        this.filmSources.set(film.media, { context, source });
      }
      if (!source) { this.syncFilmFallback(); return; }
      source.connect(bus);
      film.source = source;
      // The graph owns loudness from here; the element plays at unity.
      film.media.volume = 1;
    } catch {
      // A refused binding leaves the element's own volume in charge.
      this.syncFilmFallback();
    }
  }

  private syncFilmFallback(): void {
    const film = this.film;
    if (!film || film.source) return;
    const p = this.preferences;
    const gain = this.suspended ? 0 : film.kind === 'cinematic' ? p.volume / 100 : !p.music ? 0 : (p.volume / 100) * (p.musicVolume / 100);
    try { film.media.volume = Math.max(0, Math.min(1, gain)); } catch { /* Volume may be read-only on some platforms. */ }
  }

  private releaseFilm(binding: FilmBinding): void {
    binding.source?.disconnect();
    binding.source = null;
    if (this.film === binding) this.film = null;
  }

  private sync(retryMusic = false): void {
    const context = this.context;
    if (!context || !this.master || !this.musicBus || !this.effectsBus) {
      this.syncFilmFallback();
      this.emit();
      return;
    }
    const active = !this.suspended && this.unlocked && context.state === 'running';
    const prefs = this.preferences;
    this.master.gain.setValueAtTime(active ? prefs.volume / 100 : 0, context.currentTime);
    this.musicBus.gain.setValueAtTime(active && prefs.music ? prefs.musicVolume / 100 : 0, context.currentTime);
    this.effectsBus.gain.setValueAtTime(active && prefs.soundEffects ? prefs.sfxVolume / 100 : 0, context.currentTime);
    const cinematic = this.film?.kind === 'cinematic';
    this.filmBus?.gain.setValueAtTime(active && (cinematic || prefs.music) ? cinematic ? 1 : prefs.musicVolume / 100 : 0, context.currentTime);
    this.syncFilmFallback();
    // The film holds the music channel; returning starts a fresh shuffled track.
    const musicEnabled = !this.film && !this.suspended && (active || this.gestureUnlock) && prefs.music && prefs.volume > 0 && prefs.musicVolume > 0;
    if (musicEnabled && this.freshTrackPending) {
      this.freshTrackPending = false;
      this.soundtrack.next();
    }
    this.soundtrack.update(musicEnabled, Boolean(!this.film && active && prefs.music && prefs.volume > 0 && prefs.musicVolume > 0), retryMusic);
    if (!active || !prefs.soundEffects || prefs.volume === 0 || prefs.sfxVolume === 0) {
      for (const voice of this.voices) if (voice.effect) this.release(voice);
    }
    this.emit();
  }

  private emit(): void {
    if (this.disposed || !this.listeners.size) return;
    const status = this.status;
    for (const listener of this.listeners) listener(status);
  }

  private tone(frequency: number, type: OscillatorType, destination: GainNode, effect: boolean, amplitude: number): Voice {
    const context = this.context!;
    const source = context.createOscillator(), gain = context.createGain();
    source.type = type; source.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(amplitude, context.currentTime);
    source.connect(gain); gain.connect(destination);
    const voice = { source, gain, effect, stopped: false };
    source.onended = () => this.release(voice);
    this.voices.add(voice);
    source.start();
    return voice;
  }

  private release(voice: Voice): void {
    if (voice.stopped) return;
    voice.stopped = true;
    voice.source.onended = null;
    try { voice.source.stop(); } catch { /* A naturally completed tone may already be stopped. */ }
    voice.source.disconnect(); voice.gain.disconnect();
    this.voices.delete(voice);
  }
}
