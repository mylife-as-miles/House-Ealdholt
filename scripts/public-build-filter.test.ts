import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { excludedFromBuild, publicBuildFilter, publicBuildRules } from './public-build-filter.ts';
import { QUEST_CREDITS_FILM_PATH, QUEST_SORCERER_MODEL, questMenuArt } from '../shared/menu/derived-assets.ts';
import { CREDITS_FILM, CREDITS_FILM_QUEST } from '../shared/menu/credits-film.ts';
import { OPENING_FILMS } from '../shared/menu/opening-film.ts';
import { BATTLEFIELD_PREVIEWS } from '../shared/play/setup.ts';
import { RELEASE_VILLAGE_PATH } from '../shared/legacy/aethelgard/release-village.ts';

const desktop = publicBuildRules('desktop', { shipsVillage: false }), quest = publicBuildRules('quest', { shipsVillage: false });
const kept = (rules: ReturnType<typeof publicBuildRules>, path: string) => !excludedFromBuild(path, rules);

test('desktop builds leave out the Quest copies and Quest-only fonts, and keep what the desktop requests', () => {
  for (const path of [QUEST_SORCERER_MODEL, QUEST_CREDITS_FILM_PATH, 'quest/assets/home/my-legacy.webp', 'fonts/locales/NotoSansJP.ttf', 'derived-assets.json']) assert.ok(!kept(desktop, path), path);
  for (const path of ['models/crownfall-sorcerer.glb', 'models/crownfall-sorcerer-menu.glb', 'fonts/7cHpv4kjgoGqM7EPCw.woff2', 'fonts/7cHpv4kjgoGqM7EPCw.ttf',
    'assets/environments/card-new-1600.webp', 'assets/environments/card-new.webp', 'assets/play/kingdoms/korvenia.webp', 'assets/legacy/environment/textures/stone.png',
    CREDITS_FILM.src, ...Object.values(OPENING_FILMS).map((film) => film.src), 'gameport/scene-01/arena.glb']) assert.ok(kept(desktop, path), path);
  assert.ok(!kept(desktop, 'assets/legacy/ealdholt-loading.webp'));
});

test('Quest builds keep their own copies and leave out desktop-only files', () => {
  for (const path of [QUEST_SORCERER_MODEL, CREDITS_FILM_QUEST.src, questMenuArt('/assets/environments/card-new.webp').slice(1), 'fonts/7cHpv4kjgoGqM7EPCw.ttf', 'fonts/locales/NotoSansSC.ttf',
    'decoders/draco/draco_decoder.wasm', ...Object.values(BATTLEFIELD_PREVIEWS).flatMap((item) => [item.preview.slice(1), item.overview.slice(1)]),
    ...Object.values(OPENING_FILMS).map((film) => film.src), 'assets/legacy/environment/textures/stone.png', 'assets/chronicles/chronicles-map.webp']) assert.ok(kept(quest, path), path);
  for (const path of ['fonts/7cHpv4kjgoGqM7EPCw.woff2', 'models/crownfall-sorcerer.glb', CREDITS_FILM.src, 'assets/play/kingdoms/korvenia.webp', 'assets/play/vfx/spark.webp',
    'assets/play/scene-01-card.webp', 'assets/play/scene-02.webp', 'decoders/basis/basis_transcoder.wasm']) assert.ok(!kept(quest, path), path);
});

test('the village files ship only with the release village', () => {
  const file = 'assets/legacy/environment/aethelgard/regional-v1/vegetation-quest.glb';
  assert.ok(!kept(desktop, file) && !kept(quest, file));
  assert.ok(kept(publicBuildRules('desktop', { shipsVillage: true }), file));
  assert.ok(kept(publicBuildRules('quest', { shipsVillage: true }), file));
  assert.ok(kept(publicBuildRules('desktop', { shipsVillage: true }), 'assets/legacy/ealdholt-loading.webp'));
  // The release village itself is copied by its own plugin under its own path, never from public/.
  assert.ok(kept(desktop, `${RELEASE_VILLAGE_PATH}x.glb`));
});

test('prefix rules match whole path segments only', () => {
  assert.ok(kept(desktop, 'questing/notes.txt'));
  assert.ok(kept(quest, 'models/crownfall-sorcerer.glb.bak') === true);
  assert.ok(!kept(quest, 'assets/play/vfx/a/b.webp'));
});

test('no app source names a file its build leaves out', async () => {
  // A literal reference to a left-out path in the app's own code (or shared code it imports) would 404 in production.
  const root = new URL('..', import.meta.url).pathname;
  const sources = async (folder: string): Promise<string[]> => {
    const out: string[] = [];
    for (const entry of await readdir(join(root, folder), { withFileTypes: true, recursive: true })) {
      const parent = (entry as unknown as { parentPath: string }).parentPath;
      if (entry.isFile() && /\.(ts|tsx|css|html)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) out.push(join(parent, entry.name));
    }
    return out;
  };
  const check = async (folders: string[], rules: ReturnType<typeof publicBuildRules>, ignore: RegExp) => {
    for (const file of (await Promise.all(folders.map(sources))).flat()) {
      if (ignore.test(relative(root, file))) continue;
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/["'`(/]((?:assets|fonts|models|video|decoders|quest)\/[A-Za-z0-9_./-]+\.(?:webp|png|jpg|glb|mp4|ttf|woff2|wasm|js|json))/gu)) {
        const rule = excludedFromBuild(match[1], rules);
        assert.equal(rule, undefined, `${relative(root, file)} requests ${match[1]}, which the build leaves out (${rule?.reason})`);
      }
    }
  };
  // Village files are named by code that only runs on the village route, which builds without the village drop
  // (VILLAGE_ROUTE_BUILT); so this check uses the rules of a build that ships the village.
  const ignore = /\/derived-assets\.ts$|credits-film\.ts$/u;
  await check(['main-game-vr/src', 'shared/menu', 'shared/chronicles', 'shared/legacy'], publicBuildRules('quest', { shipsVillage: true }), ignore);
  await check(['main game/src', 'shared/menu', 'shared/play', 'shared/legacy'], publicBuildRules('desktop', { shipsVillage: true }), ignore);
});

test('the build copies the public folder through the filter', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'crownfall-public-filter-'));
  try {
    const publicDir = join(folder, 'public'), outDir = join(folder, 'dist');
    for (const path of ['quest/models/crownfall-sorcerer.glb', 'models/crownfall-sorcerer.glb', 'fonts/a.woff2', 'fonts/locales/b.ttf', 'assets/home/c.webp']) {
      await mkdir(join(publicDir, path, '..'), { recursive: true });
      await writeFile(join(publicDir, path), path);
    }
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'index.html'), 'bundle');
    const lines: string[] = [];
    const plugin = publicBuildFilter('desktop', (line) => lines.push(line));
    assert.deepEqual(plugin.config(), { build: { copyPublicDir: false } });
    plugin.configResolved({ command: 'build', publicDir, root: folder, build: { outDir }, plugins: [{ name: 'crownfall-release-village', api: { shipsVillage: () => false } }] });
    await plugin.writeBundle({ dir: outDir });
    const files = (await readdir(outDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())
      .map((entry) => relative(outDir, join((entry as unknown as { parentPath: string }).parentPath, entry.name))).sort();
    assert.deepEqual(files, ['assets/home/c.webp', 'fonts/a.woff2', 'index.html', 'models/crownfall-sorcerer.glb']);
    assert.equal(lines.length, 2);
    assert.match(lines.join('\n'), /left out quest\/ .*\(1 files/u);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
