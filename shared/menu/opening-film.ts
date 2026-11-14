/**
 * The game's story films, drawn in the creator's cines-engine. The opening plays
 * when the game starts: the whole narrated film the first time, and afterwards
 * only its title sequence (the Project EON studio mark, Year 33 and the
 * Crownfall: Aethelgard title). The Story-mode prologue, "The Name They Buried",
 * plays from the Prologue entry in Chapters. The House Ealdholt opening plays
 * once, the first time a player enters My Legacy's village, and ends on the
 * house's title. All four are canonical files under `main game/public/video`;
 * Quest plays the copies the asset sync mirrors, and check:sync verifies the
 * bytes and hashes below against provenance.json.
 */
export type OpeningCut = 'full' | 'short' | 'prologue' | 'ealdholt';

export interface OpeningFilmRecord {
  readonly id: string;
  readonly cut: OpeningCut;
  /** Relative to the application's public deployment directory. */
  readonly src: string;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly framesPerSecond: number;
  readonly durationSeconds: number;
  readonly bytes: number;
  readonly sha256: string;
}

export const OPENING_FILMS: Readonly<Record<OpeningCut, OpeningFilmRecord>> = Object.freeze({
  full: Object.freeze({
    id: 'crownfall-opening',
    cut: 'full',
    src: 'video/crownfall-opening.mp4',
    type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
    width: 1280,
    height: 720,
    framesPerSecond: 24,
    durationSeconds: 241.408,
    bytes: 27606154,
    sha256: '6615895dda443928b810dc08d28ca144d13bfac734b3838e0211b1a887e49c91',
  }),
  short: Object.freeze({
    id: 'crownfall-opening-titles',
    cut: 'short',
    src: 'video/crownfall-opening-titles.mp4',
    type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
    width: 1280,
    height: 720,
    framesPerSecond: 24,
    durationSeconds: 28.333333,
    bytes: 1291470,
    sha256: '4e663041a60343a7e5325f3d02bc280312239dd0749dd599731f0cbb0c6a9db8',
  }),
  prologue: Object.freeze({
    id: 'crownfall-prologue',
    cut: 'prologue',
    src: 'video/crownfall-prologue.mp4',
    type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
    width: 1280,
    height: 720,
    framesPerSecond: 24,
    durationSeconds: 356,
    bytes: 31593586,
    sha256: '4eea5e4849a9ac47d9ad4886ced021abf3ac94f768def88233d33a224217f6cd',
  }),
  // The picture and the soundtrack are final: the soundtrack was laid in with the picture copied unchanged, so these
  // are the bytes of the cut with sound (main game/public/video/provenance.json).
  ealdholt: Object.freeze({
    id: 'crownfall-ealdholt-opening',
    cut: 'ealdholt',
    src: 'video/crownfall-ealdholt-opening.mp4',
    type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
    width: 1280,
    height: 720,
    framesPerSecond: 30,
    durationSeconds: 30,
    bytes: 13820923,
    sha256: 'cabfcb4780ee7a27675122c9350d257d351e3c7b257da8c18a0d62dfa698fa9e',
  }),
});

/** The adapter supplies an absolute public base, including its deployment path. */
export function resolveOpeningFilm(cut: OpeningCut, baseUrl: string | URL): string {
  const base = new URL(baseUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(OPENING_FILMS[cut].src, base).href;
}

// Quest draws this copy through questText, which maps the typographic dash and
// middle dot to its printable-ASCII text atlas; status lines are ASCII already.
export const OPENING_FILM_COPY = Object.freeze({
  title: 'Crownfall: Aethelgard — Opening',
  /** Per film, for the screen title and the skip button's tooltip. */
  titles: Object.freeze({
    full: 'Crownfall: Aethelgard — Opening',
    short: 'Crownfall: Aethelgard — Opening',
    prologue: 'Crownfall: Aethelgard — Prologue',
    ealdholt: 'House Ealdholt',
  }),
  accessibleName: Object.freeze({
    full: 'Crownfall: Aethelgard opening film',
    short: 'Crownfall: Aethelgard title sequence',
    prologue: 'Crownfall: Aethelgard prologue film, The Name They Buried',
    ealdholt: 'House Ealdholt opening film',
  }),
  description: Object.freeze({
    full: 'The opening film, four minutes, narrated, with subtitles in the picture: the Project EON studio mark, the chronicle of the Seven That Remained, Year 33 and the Crownfall: Aethelgard title. A film by Osita Miles; music from the Crownfall soundtrack, Cyning Slieht and La Felure Demure by Osita Miles.',
    short: 'The title sequence: the Project EON studio mark, Year 33 and the Crownfall: Aethelgard title. Music from the Crownfall soundtrack by Osita Miles.',
    prologue: 'The Story mode prologue, six minutes, with subtitles in the picture: the coup of the twelfth year, the curse the Seven never knew they made, Cael raised as an orphan of Ealdholt, his rise through the King\'s Gambit, and his death on the road home, ending at Chapter One, The Pawn Who Would Not Die. A film by Osita Miles; music from the Crownfall soundtrack, Le Roi Muet, Slay the Iron Slave, Krom Shahid and La Felure Demure by Osita Miles.',
    ealdholt: 'The My Legacy opening, thirty seconds, without words: before dawn the village of Ealdholt lies dark in its trees under the mountains while the sky turns from night to day; then, in full morning, the view races low through its lanes and over the pond, leaps over the treetops and dives between the long houses, climbs through the trees, swoops round the church towers and draws back until the whole village lies in its woods; it ends on the House Ealdholt title in gold.',
  }),
  byline: 'A film by Osita Miles · Music: Cyning Slieht and La Felure Demure by Osita Miles',
  bylines: Object.freeze({
    full: 'A film by Osita Miles · Music: Cyning Slieht and La Felure Demure by Osita Miles',
    short: 'A film by Osita Miles · Music: Cyning Slieht and La Felure Demure by Osita Miles',
    prologue: 'A film by Osita Miles · Music: Le Roi Muet, Slay the Iron Slave, Krom Shahid and La Felure Demure by Osita Miles',
    // The music and sound were generated for this film (main game/public/video/provenance.json, credits.soundtrack).
    ealdholt: 'Filmed in the game\u2019s own village of Ealdholt \u00b7 The low run after FIRST BLOOM by Leonxlnx \u00b7 Music and sound made with Stable Audio 3.0 Small',
  }),
  begin: Object.freeze({
    /** Desktop: the browser wants a press before a film may play with sound. */
    prompt: 'Press any key to begin',
    /** Quest: the same moment on the film screen. */
    questPrompt: 'Pinch Begin to start',
    note: 'The opening plays with sound.',
    button: 'Begin',
  }),
  row: Object.freeze({
    label: 'Play the opening',
    value: 'Play',
    description: 'Watch the Crownfall: Aethelgard opening film again, with sound (4 min). A film by Osita Miles. Back skips it at any time.',
    reducedMotion: 'Reduce motion is on, so the opening does not play by itself when the game starts.',
  }),
  skip: 'Skip',
  pause: 'Pause',
  resume: 'Resume',
  questHint: 'Back skips the film.',
  status: Object.freeze({
    starting: 'Starting the film...',
    paused: 'Paused',
    muted: 'The browser blocked the film\'s sound, so it is playing silently. Pause and resume to hear it.',
    failed: 'The film could not play.',
  }),
});

/**
 * Whether this player has started Crownfall before. A browser that cannot
 * store it counts as a first start: the whole opening plays, and Back skips it.
 */
export const OPENING_SEEN_KEY = 'crownfall.opening.seen';
export interface OpeningStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function openingSeen(storage: OpeningStorage | null | undefined): boolean {
  try { return !!storage && storage.getItem(OPENING_SEEN_KEY) !== null; }
  catch { return false; }
}

/** Records the first start; returns false when the browser refuses storage. */
export function markOpeningSeen(storage: OpeningStorage | null | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(OPENING_SEEN_KEY, OPENING_FILMS.full.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this player has watched (or skipped) the House Ealdholt opening. It
 * is its own flag: starting Crownfall and entering My Legacy are different
 * first times. A browser that cannot store it shows the film on every first
 * entry of a page visit; Skip closes it at any time.
 */
export const EALDHOLT_OPENING_SEEN_KEY = 'crownfall.legacy.ealdholt-opening.seen.v1';

export function ealdholtOpeningSeen(storage: OpeningStorage | null | undefined): boolean {
  try { return !!storage && storage.getItem(EALDHOLT_OPENING_SEEN_KEY) !== null; }
  catch { return false; }
}

/** Records that the film was shown; returns false when the browser refuses storage. */
export function markEaldholtOpeningSeen(storage: OpeningStorage | null | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(EALDHOLT_OPENING_SEEN_KEY, OPENING_FILMS.ealdholt.id);
    return true;
  } catch {
    return false;
  }
}

/** The URL parameter that plays the film under automation: `?opening=legacy`. */
export const EALDHOLT_OPENING_OVERRIDE = Object.freeze({ parameter: 'opening', value: 'legacy' });

/**
 * Whether entering My Legacy's village plays the House Ealdholt opening first:
 * only when it has not been seen, the menu is not asked to reduce motion (the
 * film is then left unseen, for a later entry with motion on), and the page is
 * not driven by automation (`navigator.webdriver`), unless its URL asks for
 * the film with `?opening=legacy`. The override never replays a seen film.
 */
export function ealdholtOpeningShouldPlay(options: { seen: boolean; reducedMotion: boolean; automated: boolean; search: string }): boolean {
  if (options.seen || options.reducedMotion) return false;
  if (!options.automated) return true;
  try { return new URLSearchParams(options.search).get(EALDHOLT_OPENING_OVERRIDE.parameter) === EALDHOLT_OPENING_OVERRIDE.value; }
  catch { return false; }
}

/**
 * What plays when the game starts: the whole film the first time, the title
 * sequence afterwards, nothing when the player asked the menu to reduce motion
 * (Play the opening, in Credits, still plays it on request).
 */
export function openingAtStartup(options: { seen: boolean; reducedMotion: boolean }): OpeningCut | null {
  if (options.reducedMotion) return null;
  return options.seen ? 'short' : 'full';
}

/**
 * waiting: the browser has not been given a press yet, so the film holds on its
 * first frame behind a press-to-begin prompt and starts, with sound, on that press.
 */
export type OpeningFilmPhase = 'closed' | 'waiting' | 'starting' | 'playing' | 'paused';
/**
 * startup: the game is starting and the menu follows. credits: the opening replayed from Credits, which it returns to.
 * chapters: the prologue played from the Prologue entry in Chapters, which it returns to.
 * legacy: the House Ealdholt opening played from the My Legacy tile on Home; My Legacy follows it.
 */
export type OpeningFilmOrigin = 'startup' | 'credits' | 'chapters' | 'legacy';
/** muted: the browser refused sound even after a press, so it plays silently. failed: it could not play at all. */
export type OpeningFilmNotice = 'muted' | 'failed' | null;
export interface OpeningFilmState {
  readonly phase: OpeningFilmPhase;
  readonly notice: OpeningFilmNotice;
  /** Increases once per playthrough from the first frame, so an adapter can tell a start from a resume. */
  readonly sequence: number;
  readonly cut: OpeningCut;
  readonly origin: OpeningFilmOrigin;
  /** Present only after the media element naturally reached its ending. */
  readonly completed?: true;
}
export type OpeningFilmEvent =
  | { type: 'open'; cut: OpeningCut; origin: OpeningFilmOrigin; awaitPress?: boolean }
  /** The browser refused sound before any press: hold for one. */
  | { type: 'blocked' }
  /** The press that the waiting film asked for. */
  | { type: 'begin' }
  | { type: 'playing' }
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'ended' }
  | { type: 'failed' }
  | { type: 'muted' }
  | { type: 'audible' };

export const OPENING_FILM_CLOSED: OpeningFilmState = Object.freeze({ phase: 'closed', notice: null, sequence: 0, cut: 'short', origin: 'startup' });

export function openingFilmIsOpen(state: OpeningFilmState): boolean {
  return state.phase !== 'closed';
}

/**
 * Pure lifecycle shared by desktop and Quest. A no-op returns the very same
 * state. Skipping, the natural end and a failure all close the film; where the
 * player lands is decided by its origin (the menu, or the Credits page).
 */
export function reduceOpeningFilm(state: OpeningFilmState, event: OpeningFilmEvent): OpeningFilmState {
  const open = openingFilmIsOpen(state);
  switch (event.type) {
    case 'open':
      return event.awaitPress
        ? { phase: 'waiting', notice: null, sequence: state.sequence, cut: event.cut, origin: event.origin }
        : { phase: 'starting', notice: null, sequence: state.sequence + 1, cut: event.cut, origin: event.origin };
    case 'blocked':
      return state.phase === 'starting' ? { ...state, phase: 'waiting', notice: null } : state;
    case 'begin':
      return state.phase === 'waiting' ? { ...state, phase: 'starting', notice: null, sequence: state.sequence + 1 } : state;
    case 'playing':
      return state.phase === 'starting' ? { ...state, phase: 'playing' } : state;
    case 'toggle':
      // While waiting, the press that would pause is the press that begins.
      return state.phase === 'waiting' ? reduceOpeningFilm(state, { type: 'begin' })
        : state.phase === 'paused' ? reduceOpeningFilm(state, { type: 'resume' })
          : open ? reduceOpeningFilm(state, { type: 'pause' }) : state;
    case 'pause':
      return state.phase === 'starting' || state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'resume':
      // Resuming happens in a trusted press, which also restores refused sound.
      return state.phase === 'paused' ? { ...state, phase: 'playing', notice: state.notice === 'muted' ? null : state.notice } : state;
    case 'skip':
      return open ? { ...state, phase: 'closed', notice: null } : state;
    case 'ended':
      return open ? { ...state, phase: 'closed', notice: null, completed: true } : state;
    case 'failed':
      return open ? { ...state, phase: 'closed', notice: 'failed' } : state;
    case 'muted':
      return open && state.phase !== 'waiting' && state.notice !== 'muted' ? { ...state, notice: 'muted' } : state;
    case 'audible':
      return open && state.notice === 'muted' ? { ...state, notice: null } : state;
  }
}

/**
 * What the media element should be doing. hold: paused on the first frame,
 * waiting for a press. blocked: paused, hidden or obscured.
 */
export function openingFilmPlayback(state: OpeningFilmState, blocked: boolean): 'play' | 'pause' | 'hold' | 'stop' {
  if (!openingFilmIsOpen(state)) return 'stop';
  if (state.phase === 'waiting') return 'hold';
  return state.phase === 'paused' || blocked ? 'pause' : 'play';
}

/** The one status line each adapter shows; empty while the film plays normally or waits for its press. */
export function openingFilmStatus(state: OpeningFilmState): string {
  if (state.notice === 'failed') return OPENING_FILM_COPY.status.failed;
  if (!openingFilmIsOpen(state) || state.phase === 'waiting') return '';
  if (state.notice === 'muted') return OPENING_FILM_COPY.status.muted;
  if (state.phase === 'starting') return OPENING_FILM_COPY.status.starting;
  return state.phase === 'paused' ? OPENING_FILM_COPY.status.paused : '';
}

/** True once a startup opening has closed by any route: the player has started Crownfall. */
export function openingStartupFinished(previous: OpeningFilmState, next: OpeningFilmState): boolean {
  return previous.origin === 'startup' && openingFilmIsOpen(previous) && !openingFilmIsOpen(next);
}

/**
 * Whether closing the startup opening should record the first start, so later
 * starts show the title sequence. A film that could not play records nothing:
 * the player never saw it, and the next start tries the whole film again.
 */
export function openingStartupSeen(previous: OpeningFilmState, next: OpeningFilmState): boolean {
  return openingStartupFinished(previous, next) && next.notice !== 'failed';
}

/** The Credits category's replay row, identical in both menus. It plays the whole film. */
export function openingFilmRow(options: { reducedMotion: boolean }): { id: 'play-opening'; label: string; value: string; description: string } {
  const copy = OPENING_FILM_COPY.row;
  return {
    id: 'play-opening', label: copy.label, value: copy.value,
    description: options.reducedMotion ? `${copy.description} ${copy.reducedMotion}` : copy.description,
  };
}

/** The Prologue entry in Chapters plays the prologue film and returns there. */
export function prologueFromChapters(): OpeningFilmEvent {
  return { type: 'open', cut: 'prologue', origin: 'chapters' };
}


/** Story playback is separate from the application's launch presentation. */
export const STORY_CINEMATIC_COPY = Object.freeze({ skip: 'Skip cinematic' });

/**
 * The cuts that play as a story cinematic rather than as the launch
 * presentation: they stream, start on the press that chose them (no Begin
 * prompt, no launch artwork) and offer the one "Skip cinematic" action.
 */
export function openingFilmIsStory(cut: OpeningCut): boolean {
  return cut === 'prologue' || cut === 'ealdholt';
}

/** The My Legacy tile plays the House Ealdholt opening on the press that chose it; My Legacy follows. */
export function ealdholtFromLegacy(): OpeningFilmEvent {
  return { type: 'open', cut: 'ealdholt', origin: 'legacy' };
}

/**
 * How a House Ealdholt opening just closed, or null when this change did not
 * close one. ended and skipped both count as shown (the film plays once only)
 * and lead into My Legacy; failed leads there too, but is not recorded, so the
 * film is offered again at the next entry.
 */
export function ealdholtOpeningClosed(previous: OpeningFilmState, next: OpeningFilmState): 'ended' | 'skipped' | 'failed' | null {
  if (previous.cut !== 'ealdholt' || previous.origin !== 'legacy' || !openingFilmIsOpen(previous) || openingFilmIsOpen(next)) return null;
  return next.notice === 'failed' ? 'failed' : next.completed === true ? 'ended' : 'skipped';
}

/** Only a naturally completed Prologue introduces Chapter One. Skips and failures do not. */
export function prologueFinished(previous: OpeningFilmState, next: OpeningFilmState): boolean {
  return previous.cut === 'prologue' && previous.origin === 'chapters'
    && openingFilmIsOpen(previous) && !openingFilmIsOpen(next) && next.completed === true;
}
