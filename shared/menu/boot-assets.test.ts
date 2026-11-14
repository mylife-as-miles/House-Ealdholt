import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOT_ARTWORK, DEFERRED_ARTWORK } from './boot-assets';
import { CHRONICLES_MAP } from '../chronicles/content';
import { HOME_CONTENT, PLAY_CARDS } from './content';
import { MENU_ASSETS } from './theme';
import {
  DERIVED_ASSETS_MANIFEST, MENU_TTF_FONTS, PLAY_CARD_ARTWORK, QUEST_DERIVED_ROOT, QUEST_MENU_ART_SOURCES,
  derivedAssetPlan, playCardArt, questMenuArt, woff2Copy,
} from './derived-assets';

test('boot waits only for the art of the first screen (Play)', () => {
  assert.deepEqual(BOOT_ARTWORK.map(([url]) => url).sort(), PLAY_CARDS.map((card) => playCardArt(card.artwork)).sort());
  assert.equal(new Set(BOOT_ARTWORK.map(([, name]) => name)).size, BOOT_ARTWORK.length, 'failure names stay distinct');
  for (const [url] of BOOT_ARTWORK) assert.match(url, /-1600\.webp$/, 'boot loads the Play-sized copies');
});

test('Home, Chronicles and the illustrated sorcerer load behind the menu, not before it', () => {
  for (const item of HOME_CONTENT) if (item.imageSrc) assert.ok(DEFERRED_ARTWORK.includes(item.imageSrc));
  assert.ok(DEFERRED_ARTWORK.includes(CHRONICLES_MAP.src));
  assert.ok(DEFERRED_ARTWORK.includes(MENU_ASSETS.illustration));
  for (const source of DEFERRED_ARTWORK) assert.ok(!BOOT_ARTWORK.some(([url]) => url === source));
});

test('Quest menu art maps to its small copies and leaves every other image alone', () => {
  assert.equal(questMenuArt('/assets/environments/card-new.webp'), `/${QUEST_DERIVED_ROOT}assets/environments/card-new.webp`);
  assert.equal(questMenuArt('/assets/home/herald-board.webp'), '/quest/assets/home/herald-board.webp');
  assert.equal(questMenuArt(CHRONICLES_MAP.src), CHRONICLES_MAP.src, 'the Atlas diorama drapes the full map');
  assert.equal(questMenuArt('/assets/play/scene-01-selection.webp'), '/assets/play/scene-01-selection.webp');
  for (const artwork of PLAY_CARD_ARTWORK) assert.ok(QUEST_MENU_ART_SOURCES.includes(`/assets/environments/card-${artwork}.webp`));
});

test('the derived plan writes each copy once, desktop copies outside quest/ and Quest copies inside it', () => {
  const plan = derivedAssetPlan();
  assert.equal(new Set(plan.map((entry) => entry.path)).size, plan.length);
  for (const entry of plan) {
    assert.notEqual(entry.path, entry.source, `${entry.path} must not overwrite its original`);
    assert.equal(entry.path.startsWith(QUEST_DERIVED_ROOT), entry.app === 'quest', entry.path);
    assert.ok(!entry.path.startsWith('/') && !entry.source.startsWith('/'));
  }
  assert.deepEqual(plan.filter((entry) => entry.kind === 'woff2').map((entry) => entry.path), MENU_TTF_FONTS.map(woff2Copy));
  assert.equal(DERIVED_ASSETS_MANIFEST, 'derived-assets.json');
});

test('the desktop font faces offer the WOFF2 copy first and keep the TTF as a fallback', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../main game/src/fonts.css', import.meta.url), 'utf8');
  for (const ttf of MENU_TTF_FONTS) {
    assert.ok(css.includes(`src: url(/${woff2Copy(ttf)}) format("woff2"), url(/${ttf}) format("truetype");`), ttf);
  }
});

test('the desktop Play cards draw the same copies the boot screen waits for', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../main game/src/styles.css', import.meta.url), 'utf8');
  for (const artwork of PLAY_CARD_ARTWORK) assert.ok(css.includes(`url("${playCardArt(artwork)}")`), artwork);
  assert.ok(!/environments\/card-(new|resume|load|browse)\.webp/.test(css), 'no Play card draws the 2048-pixel original');
});
