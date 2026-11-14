/**
 * Lighter copies of supplied menu assets, generated from the originals in `main game/public` by
 * scripts/generate-light-assets.ts and recorded with both hashes in `main game/public/derived-assets.json`
 * (check:sync fails when a copy is missing or its original changed). The originals stay the source of truth.
 *
 * Desktop (U-05): WOFF2 fonts beside the TTFs, Play card art at the width the card slot can show, and a menu
 * copy of the sorcerer with only the Idle clip. Quest (Q-03, Q-07, Q-09) gets its own copies under `quest/`:
 * menu art no wider than 1024 pixels, a 720p end-credits film and a light sorcerer. Each app's build leaves out
 * the other app's copies (scripts/public-build-filter.ts).
 */

export const DERIVED_ASSETS_MANIFEST = 'derived-assets.json';
/** Every Quest-only copy lives under this public folder; the desktop build leaves it out. */
export const QUEST_DERIVED_ROOT = 'quest/';

export type PlayCardArtwork = 'new' | 'resume' | 'load' | 'browse';
export const PLAY_CARD_ARTWORK: readonly PlayCardArtwork[] = ['new', 'resume', 'load', 'browse'];
/** The supplied card art is 2048x1143; the Play card shows it about 800 CSS pixels wide (cover-cropped), so
 * 1600 pixels covers a 2x display. */
export const PLAY_CARD_ART_WIDTH = 1600;
export const playCardArtSource = (artwork: PlayCardArtwork): string => `/assets/environments/card-${artwork}.webp`;
export const playCardArt = (artwork: PlayCardArtwork): string => `/assets/environments/card-${artwork}-${PLAY_CARD_ART_WIDTH}.webp`;

/** The desktop menu's sorcerer: Idle only (the menu plays nothing else), normal and roughness maps at 1024. */
export const MENU_SORCERER_MODEL = 'models/crownfall-sorcerer-menu.glb';
/** The Quest backdrop's sorcerer: Idle only, every map at 1024. */
export const QUEST_SORCERER_MODEL = `${QUEST_DERIVED_ROOT}models/crownfall-sorcerer.glb`;
export const SORCERER_SOURCE_MODEL = 'models/crownfall-sorcerer.glb';
export const SORCERER_KEPT_CLIPS: readonly string[] = ['Idle'];

/** The Quest end-credits film: the same cut, 1280x720 (the Quest screen is about 1,000-1,200 pixels across). */
export const QUEST_CREDITS_FILM_PATH = `${QUEST_DERIVED_ROOT}video/crownfall-end-credits-720p.mp4`;

/** The Quest menu draws a texture per image element; these supplied images are 2048 pixels on their long side
 * and drawn at 320-815 headset pixels, so Quest loads copies no larger than this. (The Chronicles map is not
 * here: the Atlas diorama drapes it at full size.) */
export const QUEST_MENU_ART_MAX = 1024;
export const QUEST_MENU_ART_SOURCES: readonly string[] = Object.freeze([
  ...PLAY_CARD_ARTWORK.map(playCardArtSource),
  '/assets/home/my-legacy.webp',
  '/assets/home/herald-board.webp',
]);

/** The image a Quest panel should load for a supplied menu image: the small copy when there is one. */
export function questMenuArt(source: string): string {
  if (!QUEST_MENU_ART_SOURCES.includes(source)) return source;
  return `/${QUEST_DERIVED_ROOT}${source.replace(/^\/+/u, '')}`;
}

/** Fonts the desktop menu declares (main game/src/fonts.css), each with a generated WOFF2 copy beside it. */
export const MENU_TTF_FONTS: readonly string[] = Object.freeze([
  'fonts/7cHqv4kjgoGqM7E3p-kc4A.ttf', 'fonts/7cHpv4kjgoGqM7EPCw.ttf', 'fonts/7cHqv4kjgoGqM7E3_-gc4A.ttf', 'fonts/7cHqv4kjgoGqM7E30-8c4A.ttf',
  'fonts/HTxwL3I-JCGChYJ8VI-L6OO_au7B47rx_3E.ttf', 'fonts/HTx3L3I-JCGChYJ8VI-L6OO_au7B2xY.ttf', 'fonts/HTxwL3I-JCGChYJ8VI-L6OO_au7B4-Lw_3E.ttf',
]);
export const woff2Copy = (ttf: string): string => ttf.replace(/\.ttf$/u, '.woff2');

export interface DerivedAssetRecord {
  /** Relative to the public root. */
  readonly path: string;
  readonly app: 'desktop' | 'quest';
  /** The original it was made from, relative to the public root. */
  readonly source: string;
  readonly sourceSha256: string;
  readonly sha256: string;
  readonly bytes: number;
  /** How it was made, for the record (sizes, quality, codec). */
  readonly settings: Readonly<Record<string, unknown>>;
}
export interface DerivedAssetManifest {
  readonly version: 1;
  readonly generator: 'scripts/generate-light-assets.ts';
  readonly files: readonly DerivedAssetRecord[];
}

/** Every path the generator writes, in a fixed order. */
export function derivedAssetPlan(): readonly { path: string; app: 'desktop' | 'quest'; source: string; kind: 'woff2' | 'image' | 'model' | 'film' }[] {
  return [
    ...MENU_TTF_FONTS.map((ttf) => ({ path: woff2Copy(ttf), app: 'desktop' as const, source: ttf, kind: 'woff2' as const })),
    ...PLAY_CARD_ARTWORK.map((artwork) => ({ path: playCardArt(artwork).slice(1), app: 'desktop' as const, source: playCardArtSource(artwork).slice(1), kind: 'image' as const })),
    { path: MENU_SORCERER_MODEL, app: 'desktop', source: SORCERER_SOURCE_MODEL, kind: 'model' },
    ...QUEST_MENU_ART_SOURCES.map((source) => ({ path: questMenuArt(source).slice(1), app: 'quest' as const, source: source.slice(1), kind: 'image' as const })),
    { path: QUEST_SORCERER_MODEL, app: 'quest', source: SORCERER_SOURCE_MODEL, kind: 'model' },
    { path: QUEST_CREDITS_FILM_PATH, app: 'quest', source: 'video/crownfall-end-credits.mp4', kind: 'film' },
  ];
}
