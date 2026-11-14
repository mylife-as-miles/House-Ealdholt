import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateQuestUI } from './generate-quest-ui.ts';
import { generateQuestNowPlaying } from './generate-quest-now-playing.ts';
import { QUEST_NOW_PLAYING } from '../main-game-vr/src/now-playing.ts';
import { generateQuestLegacyUI } from './generate-quest-legacy-ui.ts';
import { generateEaldholtPreviewUI, generateEaldholtTouchUI } from './generate-ealdholt-preview-ui.ts';
import { EALDHOLT_PREVIEW_ACTIONS, EALDHOLT_PREVIEW_VIEWS, EALDHOLT_PREVIEW_PANEL_PATH, EALDHOLT_TOUCH_PATH, EALDHOLT_TOUCH_TARGETS, previewId } from '../main-game-vr/src/legacy/aethelgard/preview-contract.ts';
import { sharedAssetPaths, menuPublicSource, questPublicDestination } from './sync-menu-assets.mjs';
import { CHAPTERS, HOME_CONTENT, NAV_TABS, PLAY_CARDS, ARENAS } from '../shared/menu/content.ts';
import { MENU_LAYOUT, MENU_THEME } from '../shared/menu/theme.ts';
import { CROWNFALL_SOUNDTRACK } from '../shared/menu/soundtrack.ts';
import { CREDITS_FILM, CREDITS_FILM_QUEST } from '../shared/menu/credits-film.ts';
import { DERIVED_ASSETS_MANIFEST, derivedAssetPlan, type DerivedAssetManifest } from '../shared/menu/derived-assets.ts';
import { OPENING_FILMS } from '../shared/menu/opening-film.ts';
import { applyMenuTheme } from '../main game/src/theme.ts';
import { checkChroniclesSync } from './check-chronicles-sync.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'crownfall-sync-'));
try {
  const output = join(scratch, 'menu.uikitml');
  await generateQuestUI(output);
  const expected = await readFile(output, 'utf8');
  assert.equal(await readFile(join(root, 'main-game-vr/public/ui/menu.uikitml'), 'utf8'), expected, 'Quest UI is stale; rebuild both experiences');
  const resourcePaths = new Set([
    ...Array.from(expected.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g), match => match[1]),
    ...Array.from(expected.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g), match => match[1]),
  ]);
  for (const path of resourcePaths) await readFile(resolve(root, 'main-game-vr/public/ui', path));
  const musicPath=join(scratch,'now-playing.uikitml'),musicReport=await generateQuestNowPlaying(musicPath);
  const musicSource=await readFile(musicPath,'utf8'),publicMusic=join(root,'main-game-vr/public',QUEST_NOW_PLAYING.path);
  assert.equal(await readFile(publicMusic,'utf8'),musicSource,'Quest Now Playing UI is stale; regenerate the notice');
  assert.equal(musicReport.elements,4);assert.equal(musicReport.targets,0);
  for(const match of musicSource.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g))await readFile(resolve(dirname(publicMusic),match[1]));
  for (const item of NAV_TABS) assert.ok(expected.includes(`id="Nav_${item.aria}"`));
  for (const item of PLAY_CARDS) assert.ok(expected.includes(`id="Play_${item.id}"`));
  for (const item of HOME_CONTENT) assert.ok(expected.includes(`id="Home_${item.action}"`));
  for (const item of CHAPTERS) assert.ok(expected.includes(`id="Chapter_${item.id}"`));
  ARENAS.forEach((_, index) => assert.ok(expected.includes(`id="Arena_${index}"`)));
  // Chronicles parity lives with the Chronicles workflow (docs/chronicles/ARCHITECTURE.md).
  await checkChroniclesSync(expected, root);
  const variables = new Map<string, string>();
  applyMenuTheme({ style: { setProperty: (name: string, value: string) => variables.set(name, value) } } as unknown as HTMLElement);
  assert.equal(variables.get('--menu-accent'), MENU_THEME.colors.accent);
  assert.equal(variables.get('--menu-play-card-width'), `${MENU_LAYOUT.play.cardWidth / MENU_LAYOUT.reference.width * 100}cqw`);
  const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
  let verifiedFiles = 0;
  const compare = async (relative: string) => {
    const source = join(menuPublicSource, relative), destination = join(questPublicDestination, relative);
    try {
      for (const child of await readdir(source)) await compare(join(relative, child));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
      assert.equal(await digest(destination), await digest(source), `Shared asset differs: ${relative}`); verifiedFiles++;
    }
  };
  for (const path of sharedAssetPaths) await compare(path);
  // Generated light copies (shared/menu/derived-assets.ts): each is recorded, present, and made from today's
  // original. The Quest copies under quest/ were compared byte for byte above.
  const regenerate = 'run node main-game-vr/node_modules/tsx/dist/cli.mjs scripts/generate-light-assets.ts';
  const derived = JSON.parse(await readFile(join(menuPublicSource, DERIVED_ASSETS_MANIFEST), 'utf8')) as DerivedAssetManifest;
  for (const entry of derivedAssetPlan()) {
    const record = derived.files.find((file) => file.path === entry.path);
    assert.ok(record, `Derived asset is not recorded: ${entry.path}; ${regenerate}`);
    assert.equal(record.source, entry.source, `Derived asset records another original: ${entry.path}`);
    assert.equal(await digest(join(menuPublicSource, entry.source)), record.sourceSha256, `Derived asset is stale (${entry.source} changed): ${entry.path}; ${regenerate}`);
    assert.equal(await digest(join(menuPublicSource, entry.path)), record.sha256, `Derived asset differs from its record: ${entry.path}; ${regenerate}`);
  }
  const questFilm = derived.files.find((file) => file.path === CREDITS_FILM_QUEST.src);
  assert.deepEqual(
    { bytes: questFilm?.bytes, sha256: questFilm?.sha256, sourceSha256: questFilm?.sourceSha256, width: questFilm?.settings.width, height: questFilm?.settings.height, durationSeconds: questFilm?.settings.durationSeconds },
    { bytes: CREDITS_FILM_QUEST.bytes, sha256: CREDITS_FILM_QUEST.sha256, sourceSha256: CREDITS_FILM_QUEST.sourceSha256, width: CREDITS_FILM_QUEST.width, height: CREDITS_FILM_QUEST.height, durationSeconds: CREDITS_FILM_QUEST.durationSeconds },
    'The Quest end-credits encode and shared/menu/credits-film.ts disagree');
  console.log(`PASS ${derived.files.length} generated light copies match their records and today's originals`);
  // Both copies must also match the original upload digest; comparing the apps
  // alone would miss a changed MP3 copied to both destinations.
  const soundtrack = JSON.parse(await readFile(join(menuPublicSource, 'audio/soundtrack/provenance.json'), 'utf8'));
  assert.equal(soundtrack.tracks.length, CROWNFALL_SOUNDTRACK.length);
  for (const [index, track] of CROWNFALL_SOUNDTRACK.entries()) {
    const original = soundtrack.tracks[index];
    assert.deepEqual({ id: original.id, title: original.title, ...(original.artist === undefined ? {} : { artist: original.artist }), src: original.src, durationSeconds: original.durationSeconds }, track);
    const bytes = await readFile(join(menuPublicSource, track.src));
    assert.equal(bytes.length, original.bytes, `Soundtrack upload size differs: ${track.id}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.sha256, `Soundtrack upload hash differs: ${track.id}`);
  }
  // The end-credits film: both copies match the supplied encode recorded in its
  // provenance, and the shared record both adapters play matches it too.
  const filmProvenance = JSON.parse(await readFile(join(menuPublicSource, 'video/provenance.json'), 'utf8'));
  const film = filmProvenance.files.find((file: { id: string }) => file.id === CREDITS_FILM.id);
  assert.ok(film, 'End-credits film provenance is missing');
  assert.deepEqual(
    { src: film.src, bytes: film.bytes, sha256: film.sha256, durationSeconds: film.durationSeconds, width: film.width, height: film.height, framesPerSecond: film.framesPerSecond },
    { src: CREDITS_FILM.src, bytes: CREDITS_FILM.bytes, sha256: CREDITS_FILM.sha256, durationSeconds: CREDITS_FILM.durationSeconds, width: CREDITS_FILM.width, height: CREDITS_FILM.height, framesPerSecond: CREDITS_FILM.framesPerSecond },
    'End-credits film provenance and shared/menu/credits-film.ts disagree');
  assert.equal(film.source?.commit, '60b737a04303ee1e17f9ffc91f0cba3ddabccadd', 'End-credits film source commit changed');
  for (const [copy, base] of [['desktop', menuPublicSource], ['Quest', questPublicDestination]] as const) {
    const bytes = await readFile(join(base, CREDITS_FILM.src));
    assert.equal(bytes.length, CREDITS_FILM.bytes, `End-credits film size differs (${copy})`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), CREDITS_FILM.sha256, `End-credits film hash differs (${copy})`);
  }
  assert.ok(expected.includes('id="View_Film"'), 'Quest UI lacks the end-credits film view');
  console.log(`PASS shared desktop/Quest content, design tokens, ${verifiedFiles} byte-identical assets and ${resourcePaths.size} resolvable UI resources`);
  console.log(`PASS end-credits film: desktop and Quest copies match provenance (${CREDITS_FILM.bytes} bytes, sha256 ${CREDITS_FILM.sha256.slice(0, 12)}...)`);
  // The opening, both cuts: the same three-way agreement (provenance, shared record, both copies).
  for (const record of Object.values(OPENING_FILMS)) {
    const entry = filmProvenance.files.find((file: { id: string }) => file.id === record.id);
    assert.ok(entry, `Opening film provenance is missing: ${record.id}`);
    assert.deepEqual(
      { src: entry.src, bytes: entry.bytes, sha256: entry.sha256, durationSeconds: entry.durationSeconds, width: entry.width, height: entry.height, framesPerSecond: entry.framesPerSecond },
      { src: record.src, bytes: record.bytes, sha256: record.sha256, durationSeconds: record.durationSeconds, width: record.width, height: record.height, framesPerSecond: record.framesPerSecond },
      `Opening film provenance and shared/menu/opening-film.ts disagree: ${record.id}`);
    for (const [copy, base] of [['desktop', menuPublicSource], ['Quest', questPublicDestination]] as const) {
      const bytes = await readFile(join(base, record.src));
      assert.equal(bytes.length, record.bytes, `Opening film size differs (${record.id}, ${copy})`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, `Opening film hash differs (${record.id}, ${copy})`);
    }
    console.log(`PASS opening film ${record.cut}: desktop and Quest copies match provenance (${record.bytes} bytes, sha256 ${record.sha256.slice(0, 12)}...)`);
  }
  // My Legacy panels are generated from shared Legacy content; stale copies or unresolvable resources fail here.
  const legacyPanel = join(scratch, 'legacy.uikitml'), legacyDock = join(scratch, 'legacy-dock.uikitml');
  const legacyReport = await generateQuestLegacyUI({ panel: legacyPanel, dock: legacyDock });
  for (const [generated, committed] of [[legacyPanel, 'legacy.uikitml'], [legacyDock, 'legacy-dock.uikitml']]) {
    const expectedLegacy = await readFile(generated, 'utf8');
    assert.equal(await readFile(join(root, 'main-game-vr/public/ui', committed), 'utf8'), expectedLegacy, `Quest ${committed} is stale; rebuild the Quest experience`);
    for (const match of expectedLegacy.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) await readFile(resolve(root, 'main-game-vr/public/ui', match[1]));
  }
  console.log(`PASS My Legacy Quest panels match shared Legacy content (${legacyReport.panelElements + legacyReport.dockElements} elements, ${legacyReport.hitTargets} controls of at least ${legacyReport.smallestHitDegrees} degrees, touch-tray controls of at least ${(legacyReport.smallestTouchMetres * 100).toFixed(1)} cm, text of at least ${legacyReport.smallestTextDegrees} degrees)`);
  // The opt-in Ealdholt preview is generated separately; comparing a temporary
  // output catches stale shared labels without repairing the public copy here.
  const ealdholtPanel = join(scratch, 'ealdholt-preview.uikitml');
  const ealdholtReport = await generateEaldholtPreviewUI(ealdholtPanel);
  const expectedEaldholt = await readFile(ealdholtPanel, 'utf8');
  const publicEaldholt = join(root, 'main-game-vr/public', EALDHOLT_PREVIEW_PANEL_PATH);
  assert.equal(await readFile(publicEaldholt, 'utf8'), expectedEaldholt, 'Quest Ealdholt preview is stale; regenerate the preview panel');
  const ealdholtIds = Array.from(expectedEaldholt.matchAll(/\bid="([^"]+)"/g), match => match[1]);
  assert.equal(new Set(ealdholtIds).size, ealdholtIds.length, 'Ealdholt preview IDs must be unique');
  assert.equal(ealdholtReport.elements, ealdholtIds.length);
  for (const action of EALDHOLT_PREVIEW_ACTIONS) assert.ok(ealdholtIds.includes(previewId(action)), `Missing Ealdholt action: ${action}`);
  for (const view of EALDHOLT_PREVIEW_VIEWS) assert.ok(ealdholtIds.includes(previewId('View_' + view)), `Missing Ealdholt view: ${view}`);
  for (const region of ['HouseTitle', 'BannerHeading', 'BannerImage', 'BannerPlaceholder', 'PresetRail', 'Editor', 'EditorFieldValue', 'Info']) {
    assert.ok(ealdholtIds.includes(previewId(region)), `Missing world-first Ealdholt region: ${region}`);
  }
  for (const match of expectedEaldholt.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) await readFile(resolve(dirname(publicEaldholt), match[1]));
  console.log(`PASS world-first Ealdholt reader matches shared copy (${ealdholtReport.elements} stable elements; legacy controls retained only for binding compatibility)`);
  const touchPath=join(scratch,'ealdholt-inherited-touch.uikitml'),touchReport=await generateEaldholtTouchUI(touchPath);
  const touchSource=await readFile(touchPath,'utf8'),publicTouch=join(root,'main-game-vr/public',EALDHOLT_TOUCH_PATH);
  assert.equal(await readFile(publicTouch,'utf8'),touchSource,'Quest Ealdholt near tray is stale; regenerate the preview UI');
  for(const match of touchSource.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) await readFile(resolve(dirname(publicTouch),match[1]));
  const touchIds=Array.from(touchSource.matchAll(/\bid="([^"]+)"/g),match=>match[1]);
  assert.equal(new Set(touchIds).size,touchIds.length,'Ealdholt near-control IDs must be unique');
  for(const target of EALDHOLT_TOUCH_TARGETS)for(const name of [target.name,target.name+'_Label']) {
    assert.ok(touchIds.includes(previewId(name)),`Missing Ealdholt near-control binding: ${name}`);
  }
  assert.equal(touchReport.targets,EALDHOLT_TOUCH_TARGETS.length);assert.equal(touchReport.minimumTouchMetres,.042);
  console.log(`PASS Ealdholt contextual touch tray (${touchReport.targets} authored targets, ${touchReport.minimumTouchMetres*100} cm minimum near hit; only the current group is enabled)`);
  // Optional check owned by the Legacy environment workflow (docs/legacy/WORKFLOWS.md).
  const environmentCheck = join(root, 'scripts/check-legacy-environment.ts');
  if (existsSync(environmentCheck)) await (await import(pathToFileURL(environmentCheck).href)).checkLegacyEnvironment();
} finally { await rm(scratch, { recursive: true, force: true }); }
