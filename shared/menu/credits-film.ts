import { normalizeMenuAudioPreferences, type MenuAudioPreferences } from './audio';

/**
 * The Crownfall end-credits film. Both menus play this one canonical file:
 * desktop from `main game/public`, Quest from the copy the asset sync mirrors.
 * check:sync verifies the bytes and hash below against provenance.json.
 */
export const CREDITS_FILM = Object.freeze({
  id: 'crownfall-end-credits',
  /** Relative to the application's public deployment directory. */
  src: 'video/crownfall-end-credits.mp4',
  type: 'video/mp4; codecs="avc1.640032, mp4a.40.2"',
  width: 1920,
  height: 1080,
  framesPerSecond: 24,
  durationSeconds: 182.252993,
  bytes: 7606715,
  sha256: '4e27cc61f5b61613eb6a85be023d1867a7ce6fca80f7b8ede9233497529d9b56',
});

/**
 * The Quest plays a 1280x720 encode of the same cut (Q-07): its film screen is about 1,000-1,200 display pixels
 * across, so 1080p frames cost 2.25 times the decode and upload for nothing visible. Generated from the file above
 * by scripts/generate-light-assets.ts with the original audio copied; check:sync verifies it against
 * derived-assets.json.
 */
export const CREDITS_FILM_QUEST = Object.freeze({
  id: 'crownfall-end-credits-720p',
  src: 'quest/video/crownfall-end-credits-720p.mp4',
  type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
  width: 1280,
  height: 720,
  framesPerSecond: 24,
  durationSeconds: 182.252993,
  bytes: 7450546,
  sha256: '97048eca2e4ad28c5674b44a9ab530bdb1a11b12deceb3ed3f1e8986cb4d530f',
  sourceSha256: CREDITS_FILM.sha256,
});

/** The adapter supplies an absolute public base, including its deployment path. */
export function resolveCreditsFilm(baseUrl: string | URL): string {
  const base = new URL(baseUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(CREDITS_FILM.src, base).href;
}

// Quest draws this copy through questText, which maps the typographic dash and
// middle dot to its printable-ASCII text atlas; status lines are ASCII already.
export const CREDITS_FILM_COPY = Object.freeze({
  title: 'Crownfall: Aethelgard — End Credits',
  accessibleName: 'Crownfall: Aethelgard end credits film',
  description: 'A three-minute film drawn in code: the Project EON studio mark, the Crownfall: Aethelgard title and the credit cards. A film by Osita Miles, scored to Sanguis et Terra by Osita Miles. The same credits and notices are listed on the Credits page.',
  byline: 'A film by Osita Miles · Music: Sanguis et Terra by Osita Miles',
  row: {
    label: 'Play end credits',
    value: 'Play',
    description: 'Watch the Crownfall: Aethelgard end-credits film again, with sound (3 min). A film by Osita Miles, scored to Sanguis et Terra by Osita Miles. Back skips it at any time.',
    reducedMotion: 'Reduce motion is on, so the film waits until you choose it.',
  },
  back: 'Back',
  skip: 'Skip',
  pause: 'Pause',
  resume: 'Resume',
  questHint: 'Back returns to the credits.',
  status: {
    starting: 'Starting the end credits...',
    paused: 'Paused',
    muted: 'The browser blocked the film\'s sound, so it is playing silently. Pause and resume, or play it again, to hear it.',
    failed: 'The end-credits film could not play. The credits are listed here instead.',
  },
});

export type CreditsFilmPhase = 'closed' | 'starting' | 'playing' | 'paused';
/** muted: the browser refused sound, so the film plays silently. failed: it could not play at all. */
export type CreditsFilmNotice = 'muted' | 'failed' | null;
export interface CreditsFilmState {
  readonly phase: CreditsFilmPhase;
  readonly notice: CreditsFilmNotice;
  /** Increases once per opening, so an adapter can tell a new playthrough from a resume. */
  readonly sequence: number;
}
export type CreditsFilmEvent =
  | { type: 'open' }
  | { type: 'playing' }
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'ended' }
  | { type: 'failed' }
  | { type: 'muted' };

export const CREDITS_FILM_CLOSED: CreditsFilmState = Object.freeze({ phase: 'closed', notice: null, sequence: 0 });

export function creditsFilmIsOpen(state: CreditsFilmState): boolean {
  return state.phase !== 'closed';
}

/**
 * Pure film lifecycle shared by desktop and Quest. A no-op returns the very
 * same state. Skipping and the natural end both return to the Credits page;
 * a failure returns there with a notice instead of leaving a blank player.
 */
export function reduceCreditsFilm(state: CreditsFilmState, event: CreditsFilmEvent): CreditsFilmState {
  const open = creditsFilmIsOpen(state);
  switch (event.type) {
    case 'open':
      return { phase: 'starting', notice: null, sequence: state.sequence + 1 };
    case 'playing':
      return state.phase === 'starting' ? { ...state, phase: 'playing' } : state;
    case 'toggle':
      return state.phase === 'paused' ? reduceCreditsFilm(state, { type: 'resume' })
        : open ? reduceCreditsFilm(state, { type: 'pause' }) : state;
    case 'pause':
      return state.phase === 'starting' || state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'resume':
      // Resuming happens in a trusted press, which also restores refused sound.
      return state.phase === 'paused' ? { ...state, phase: 'playing', notice: state.notice === 'muted' ? null : state.notice } : state;
    case 'skip':
    case 'ended':
      return open ? { ...state, phase: 'closed', notice: null } : state;
    case 'failed':
      return open ? { ...state, phase: 'closed', notice: 'failed' } : state;
    case 'muted':
      return open && state.notice !== 'muted' ? { ...state, notice: 'muted' } : state;
  }
}

/**
 * Choosing Credits plays the film at once, unless the player asked the menu to
 * reduce motion: then the notices page opens with the Play end credits row.
 */
export function creditsEntry(options: { reducedMotion: boolean }): 'film' | 'notices' {
  return options.reducedMotion ? 'notices' : 'film';
}

/** What the media element should be doing. blocked: paused, hidden or obscured. */
export function creditsFilmPlayback(state: CreditsFilmState, blocked: boolean): 'play' | 'pause' | 'stop' {
  if (!creditsFilmIsOpen(state)) return 'stop';
  return state.phase === 'paused' || blocked ? 'pause' : 'play';
}

/** The one status line each adapter shows; empty while the film plays normally. */
export function creditsFilmStatus(state: CreditsFilmState): string {
  if (state.notice === 'failed') return CREDITS_FILM_COPY.status.failed;
  if (!creditsFilmIsOpen(state)) return '';
  if (state.notice === 'muted') return CREDITS_FILM_COPY.status.muted;
  if (state.phase === 'starting') return CREDITS_FILM_COPY.status.starting;
  return state.phase === 'paused' ? CREDITS_FILM_COPY.status.paused : '';
}

/** The Credits category's replay row, identical in both menus. */
export function creditsFilmRow(options: { reducedMotion: boolean }): { id: 'play-credits'; label: string; value: string; description: string } {
  const copy = CREDITS_FILM_COPY.row;
  return {
    id: 'play-credits', label: copy.label, value: copy.value,
    description: options.reducedMotion ? `${copy.description} ${copy.reducedMotion}` : copy.description,
  };
}

/**
 * The film's score is music: it follows Master and Music volume and the Music
 * switch, exactly as the soundtrack does. Used where no audio graph exists.
 */
export function creditsFilmGain(preferences: MenuAudioPreferences): number {
  const p = normalizeMenuAudioPreferences(preferences);
  return p.music ? (p.volume / 100) * (p.musicVolume / 100) : 0;
}
