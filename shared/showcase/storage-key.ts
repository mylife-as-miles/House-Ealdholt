/**
 * Where the replay archive is stored. Kept apart from the catalog, whose labels
 * the menus read at startup: the archive and its rules load with Showcase only
 * (scripts/check-legacy-lazy.mjs looks for this key in the startup modules).
 */
export const SHOWCASE_STORAGE_KEY = 'crownfall.showcase.replays.v1';
