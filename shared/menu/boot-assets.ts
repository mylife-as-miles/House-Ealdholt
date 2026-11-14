import { HOME_CONTENT, PLAY_CARDS } from './content';
import { MENU_ASSETS } from './theme';
import { playCardArt } from './derived-assets';

/**
 * What the desktop boot screen waits for (U-05). The menu opens on Play, so only the Play cards' art (the
 * loading screen also draws one of them) gates it, with the fonts and the sorcerer. Home, Chronicles and the
 * illustrated fallback load behind the open menu, once boot has finished.
 */
export const BOOT_ARTWORK: readonly (readonly [url: string, name: string])[] = Object.freeze(
  PLAY_CARDS.map((card) => [playCardArt(card.artwork), `${card.label} artwork`] as const));

/** Fetched after the menu is shown, so a later Home or Chronicles visit finds them in the cache. */
export const DEFERRED_ARTWORK: readonly string[] = Object.freeze([
  ...HOME_CONTENT.map((item) => item.imageSrc).filter((source): source is string => !!source),
  MENU_ASSETS.illustration,
].filter((source, index, all) => all.indexOf(source) === index));
