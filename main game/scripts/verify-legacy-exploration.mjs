// Real city-reference Legacy UI verification. A public, validated production
// house is seeded as TEST SETUP; this does not test founding or earn progress.
// Every tested selection, walk, inspection and Back action uses actual UI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const origin = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const renderScale = Number(process.env.CROWNFALL_VERIFY_RENDER_SCALE || 100);
assert.ok(Number.isFinite(renderScale) && renderScale >= 50 && renderScale <= 100);
const phase = 'buildings-only';
assert.ok(!process.env.CROWNFALL_LEGACY_PHASE || ['full', phase].includes(process.env.CROWNFALL_LEGACY_PHASE), 'run the current building-only suite; retired field/prior-report phases cannot certify this revision');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let directory = resolve(process.env.CROWNFALL_LEGACY_ARTIFACTS || `artifacts/legacy-reference-ui/${stamp}`);
if (existsSync(directory)) directory = `${directory}-${stamp}`;
const shared = `/@fs${fileURLToPath(new URL('../../shared/legacy/', import.meta.url))}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = {
  passed: false, commit, verifierSha256: hash(await readFile(new URL(import.meta.url))),
  phase, scope: 'Fresh building-only Legacy verification, including retired-v1-field migration; prior farming evidence is historical and is not reused as a current pass.',
  preset: 'low', renderScale, environment: 'bannerhold', checks: [], captures: [], errors: [], consoleErrors: [],
  estatePlacementVerified: false,
  hybridSourceVerified: false, landmarkGeometryImmutableVerified: false, retiredFieldMigrationVerified: false,
  optionalStates: [], snapshots: [],
  sourceScope: {
    licensedRepositoriesRequired: ['Leonxlnx/golden-temple', 'Leonxlnx/monolithwilds', 'Leonxlnx/athenaion'],
    unresolved: [{ repository: 'Leonxlnx/procedural-alpine-lake', reason: 'Permission record remains unresolved; its source is not treated as licensed or verified.' }],
    completeRequestedFourRepositoryScope: false,
    alpineLocalPermissionBasis: 'The creator asserted permission; a written redistribution record remains pending.',
    publicationPermissionRecordComplete: false,
  },
  limits: [
    'Chromium/SwiftShader with emulated browser gamepad; no physical controller, Quest comfort or GPU frame-rate claim.',
    'The stored production house is explicit test setup. Only a bounded guest-founding happy path is exercised through UI; match-earned progression is not tested.',
    'This focused run covers Bannerhold. Other environment-selector worlds are outside its rendering and interaction scope.',
    'The external winter-cats video is reference-only and is not incorporated as game artwork.',
  ],
};
report.runtimeSourceHashes = Object.fromEntries(await Promise.all([
  'main game/src/legacy/LegacyScreen.tsx', 'main game/src/legacy/LegacyExploration.tsx', 'main game/src/legacy/LegacySettlementEditor.tsx',
  'main game/src/legacy/environment/environment.ts', 'main game/src/legacy/environment/collection-environment.ts',
  'shared/legacy/worlds/combined/kit.ts', 'shared/legacy/worlds/combined/architecture.js', 'shared/legacy/worlds/combined/monolith.js',
  'shared/legacy/worlds/combined/alpine.js', 'shared/legacy/environment/settlement/controller.ts', 'shared/legacy/settlement/contract.ts',
].map(async path => [path, hash(await readFile(new URL(`../../${path}`, import.meta.url)))])));
report.runtimeSourceHashesScope = 'Selected public runtime files used by these scenes/controls, not a complete bundled-dependency fingerprint.';
await mkdir(directory, { recursive: true });
console.log(`Legacy ${phase} artifact directory: ${directory}`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let page, initialRaw, estateKey;
const videos = [];
const record = text => { report.checks.push(text); console.log(`PASS ${text}`); };
const snapshot = () => page.evaluate(() => window.__legacyExploration?.() ?? null);
const estate = () => page.evaluate(() => window.__legacySettlement?.() ?? null);
const estateSave = () => page.evaluate(key => localStorage.getItem(key), estateKey);
const estateWrites = () => page.evaluate(() => window.__estateWrites ?? []);
const estateDebug = () => page.evaluate(() => window.__legacySettlementDebug?.() ?? null);
const dock = id => page.locator(`[data-settlement-dock] [data-dock-landmark="${id}"]`);
const active = () => page.locator('[data-exploration="active"]');
const panel = id => page.locator(`[data-landmark-panel="${id}"]`);
const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const POINTS = { cottage: { x: 4, z: 7 }, secondBuilding: { x: 32, z: 56 }, water: { x: -60, z: 10 }, road: { x: -6, z: 10 }, building: { x: 8, z: -23 } };
const BUILDING_KINDS = ['cottage', 'storehouse', 'pavilion', 'ruin-arch'];
const REQUIRED_SOURCE_REPOSITORIES = ['leonxlnx/golden-temple', 'leonxlnx/monolithwilds', 'leonxlnx/athenaion'];
const repositoryId = value => String(value).replace(/^https?:\/\/github\.com\//i, '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
let originalLandmarks, originalLandmarkGeometry;

const sourceKit = () => page.evaluate(() => window.__legacySettlementDebug?.()?.sourceKit ?? null);
function coreGeometry(kit, landmarks) {
  assert.ok(kit?.fixed?.length, 'actual source kit exposes its physical fixed nodes');
  return landmarks.map(landmark => {
    if (landmark.id === 'banner-hall') {
      const matches = kit.fixed.filter(node => node.landmark === landmark.id && node.ownership === 'Crownfall');
      assert.equal(matches.length, 1, 'one actual Crownfall-owned worker record identifies the compound Banner Hall');
      const node = matches[0];
      assert.match(node.geometryHash, /^fnv1a32:[a-f\d]{8}$/i, 'host geometry hash comes from the actual tagged worker triangles');
      assert.ok(Number.isInteger(node.triangles) && node.triangles > 0 && Number.isInteger(node.meshCount) && node.meshCount > 0);
      assert.equal(node.coordinateSpace, 'source root blueprint metres');
      assert.deepEqual(node.sources, [], 'the original Crownfall compound does not claim external-repository provenance');
      assert.ok(node.parts.length > 0 && node.parts.every(part => part.triangles > 0 && part.matrix.length === 16 && [...part.matrix, ...part.bounds.min, ...part.bounds.max].every(Number.isFinite)));
      assert.equal(node.parts.reduce((count, part) => count + part.triangles, 0), node.triangles, 'actual rendered parts account for the host triangle count');
      assert.ok([...node.bounds.min, ...node.bounds.max].every(Number.isFinite));
      assert.ok(node.bounds.max.every((value, axis) => value > node.bounds.min[axis]), 'the original compound has actual three-dimensional rendered bounds');
      return { id: landmark.id, ownership: node.ownership, geometryHash: node.geometryHash, triangles: node.triangles, meshCount: node.meshCount, bounds: node.bounds, parts: node.parts, coordinateSpace: node.coordinateSpace };
    }
    const matches = kit.fixed.filter(node => !node.batched && Array.isArray(node.position) && Math.abs(node.position[0] - landmark.position[0]) < .001 && Math.abs(node.position[2] - landmark.position[2]) < .001);
    assert.equal(matches.length, 1, `one actual unbatched source node occupies ${landmark.id}`);
    const node = matches[0]; assertSourceMetadata(node, landmark.id);
    assert.ok([...node.bounds.min, ...node.bounds.max, ...node.matrix].every(Number.isFinite));
    assert.ok(node.bounds.max[0] > node.bounds.min[0] && node.bounds.max[1] > node.bounds.min[1] && node.bounds.max[2] > node.bounds.min[2], 'original landmark has actual three-dimensional geometry');
    return { id: landmark.id, name: node.name, assetId: node.assetId, sources: node.sources, position: node.position, rotation: node.rotation, matrix: node.matrix, bounds: node.bounds };
  });
}

async function assertHouseUnchanged() {
  assert.equal(await page.evaluate(() => localStorage.getItem('crownfall.legacy.save')), initialRaw);
  assert.deepEqual(await page.evaluate(() => window.__explorationSaveWrites), []);
}

async function assertLandmarksUnchanged() {
  assert.deepEqual((await estateDebug())?.landmarks, originalLandmarks, 'all four original house landmarks remain unchanged');
  assert.deepEqual(coreGeometry(await sourceKit(), originalLandmarks), originalLandmarkGeometry, 'actual original source landmark nodes, bounds and matrices remain unchanged');
  report.landmarkGeometryImmutableVerified = true;
}

async function beginBuilding(kind = 'cottage') {
  await page.locator('[data-settlement-build]').click();
  await page.locator('[data-estate-chooser="build"]').waitFor();
  await page.locator(`[data-settlement-kind="${kind}"]`).click();
  await page.locator('[data-estate-panel="preview"]').waitFor();
  assert.equal((await estate()).tool, kind);
}

function assertSourceMetadata(drawn, label) {
  assert.ok(drawn.assetId && Array.isArray(drawn.sources) && drawn.sources.length > 0, `${label} identifies actual source-derived geometry, not an original stand-in with a new label`);
  assert.ok(drawn.sources.some(source => REQUIRED_SOURCE_REPOSITORIES.includes(repositoryId(source.repository))), `${label} contains geometry/code from a requested licensed source repository`);
  for (const source of drawn.sources) {
    assert.ok(source.id && source.path && source.generator && source.license, 'rendered source records identity, path, generator and license provenance');
    assert.match(source.commit, /^[a-f\d]{7,40}$/i, 'rendered source records an actual pinned upstream commit');
  }
}

async function buildingPreviewEvidence() {
  const state = (await estate()).preview, drawn = (await estateDebug()).renderInfo.preview;
  assert.ok(state && BUILDING_KINDS.includes(state.kind) && state.crop === null && drawn?.visible && drawn.meshCount > 0);
  assert.ok(typeof drawn.renderSignature === 'string' && drawn.renderSignature.length > 3);
  assertSourceMetadata(drawn, 'building preview');
  return drawn;
}

function comparePreviewToPlacement(preview, placed) {
  assert.equal(placed.assetId, preview.assetId, 'the committed source asset is the asset the ghost showed');
  assert.deepEqual(placed.sources, preview.sources, 'preview and committed geometry share pinned source provenance');
  for (const axis of [0, 2]) {
    const previewSize = preview.bounds.max[axis] - preview.bounds.min[axis], placedSize = placed.bounds.max[axis] - placed.bounds.min[axis];
    assert.ok(Math.abs(previewSize - placedSize) < .75, 'preview and committed source geometry have the same ground footprint');
  }
  // Ghost materials intentionally differ; their render hashes need not match.
}

async function assertBuildingOnlyControls() {
  for (const selector of ['[data-settlement-fields]', '[data-settlement-kind="field"]', '[data-settlement-crop]', '[data-settlement-change-crop]', '[data-estate-chooser="fields"]', '[data-estate-chooser="crops"]', '#settlement-width', '#settlement-depth']) {
    assert.equal(await page.locator(selector).count(), 0, 'retired farming controls are absent, not merely disabled or hidden');
  }
  const state = await estate(), drawn = (await estateDebug()).renderInfo;
  assert.ok(state.placements.every(p => BUILDING_KINDS.includes(p.kind) && p.crop === null), 'only supported buildings enter the live layout');
  assert.ok(drawn.placements.every(p => BUILDING_KINDS.includes(p.kind) && p.crop === null), 'retired fields are not rendered as estate objects');
}

async function assertCatalogueFullyVisible() {
  await tick();
  const measured = await page.locator('[data-estate-chooser="build"]').evaluate(root => {
    const list = root.querySelector('.legacy-estate-choices');
    if (!list) throw Error('Building catalogue scroll container is absent');
    const outer = root.getBoundingClientRect(), inner = list.getBoundingClientRect();
    const clip = { left: Math.max(0, outer.left, inner.left), right: Math.min(innerWidth, outer.right, inner.right), top: Math.max(0, outer.top, inner.top), bottom: Math.min(innerHeight, outer.bottom, inner.bottom) };
    return { viewport: [innerWidth, innerHeight], clip, scrollTop: list.scrollTop, tools: [...list.querySelectorAll('[data-settlement-kind]')].map(element => { const box = element.getBoundingClientRect(); return { kind: element.getAttribute('data-settlement-kind'), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; }) };
  });
  assert.deepEqual(measured.tools.map(tool => tool.kind), BUILDING_KINDS);
  assert.equal(measured.scrollTop, 0, 'the catalogue opens at its first tool, before any saved items are scrolled');
  for (const tool of measured.tools) {
    assert.ok(tool.width >= 43.99 && tool.height >= 43.99, `catalogue tool keeps a 44 px target: ${JSON.stringify(tool)}`);
    assert.ok(tool.left >= measured.clip.left - .5 && tool.right <= measured.clip.right + .5 && tool.top >= measured.clip.top - .5 && tool.bottom <= measured.clip.bottom + .5, `all four building tools are fully visible inside their actual scroll viewport: ${JSON.stringify({ tool, clip: measured.clip })}`);
  }
  (report.catalogueLayouts ??= []).push(measured);
}

async function hoverWorld(point, label) {
  // Projection is a read-only locator for genuine pointer input. No editor
  // cursor, layout, validation result or renderer state is directly mutated.
  const locate = async () => page.evaluate(anchor => {
    const hit = anchor?.visible ? document.elementFromPoint(anchor.x, anchor.y) : null;
    return { anchor, hit: hit?.tagName, hitClass: hit?.className };
  }, await stableProjection(point, label));
  let target = await locate(), signX = 1, signY = 1;
  for (let attempt = 0; attempt < 6 && (!target.anchor?.visible || target.hit !== 'CANVAS'); attempt++) {
    assert.ok(target.anchor && Number.isFinite(target.anchor.x) && Number.isFinite(target.anchor.y), `${label} has a real camera projection`);
    const world = await page.evaluate(() => {
      for (const [fx, fy] of [[.25, .4], [.35, .45], [.25, .6], [.4, .3]]) {
        const x = innerWidth * fx, y = innerHeight * fy;
        if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y, width: innerWidth, height: innerHeight };
      }
      return null;
    });
    assert.ok(world, `${label} can be revealed by ordinary canvas pan`);
    const differenceX = world.x - target.anchor.x, differenceY = world.y - target.anchor.y;
    let dx = 0, dy = 0;
    if (Math.abs(differenceX) > 40) dx = Math.max(-210, Math.min(210, differenceX / signX));
    else dy = Math.max(-120, Math.min(120, differenceY / signY));
    if (Math.abs(dx) + Math.abs(dy) < 10) dy = -70;
    await page.mouse.move(world.x, world.y); await page.mouse.down({ button: 'right' });
    await page.mouse.move(Math.max(2, Math.min(world.width - 2, world.x + dx)), Math.max(2, Math.min(world.height - 2, world.y + dy)), { steps: 6 });
    await page.mouse.up({ button: 'right' }); await tick();
    const next = await locate();
    if (dx && Math.abs(next.anchor.x - target.anchor.x) > 1) signX = Math.sign((next.anchor.x - target.anchor.x) / dx);
    if (dy && Math.abs(next.anchor.y - target.anchor.y) > 1) signY = Math.sign((next.anchor.y - target.anchor.y) / dy);
    (report.targetRevealGestures ??= []).push({ label, fixedWorldPoint: point, from: target.anchor, drag: { start: world, dx, dy }, to: next.anchor, resultingHit: next.hit });
    target = next;
  }
  assert.ok(target.anchor?.visible, `${label} must project inside the real camera view: ${JSON.stringify(target)}`);
  assert.equal(target.hit, 'CANVAS', `${label} must be reachable without clicking through UI: ${JSON.stringify(target)}`);
  await page.mouse.move(target.anchor.x, target.anchor.y, { steps: 3 });
  await page.waitForFunction(({ x, z }) => { const p = window.__legacySettlement?.()?.preview; return p && p.x === Math.round(x) && p.z === Math.round(z); }, point, { timeout: 5000 });
  return target.anchor;
}

async function stableProjection(point, label) {
  const started = Date.now(), samples = [];
  let previous, stable = 0;
  // Software rendering can take two seconds per presented frame. Keep the
  // same subpixel stability requirement instead of guessing a moving target.
  for (let attempt = 0; attempt < 30 && Date.now() - started < 45000; attempt++) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const anchor = await page.evaluate(point => window.__legacyProjectSettlement?.(point.x, point.z), point);
    assert.ok(anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y), `${label} has a finite read-only projection`);
    samples.push(anchor);
    stable = previous && Math.hypot(anchor.x - previous.x, anchor.y - previous.y) <= .2 ? stable + 1 : 0;
    if (stable >= 3) {
      (report.projectionSettles ??= []).push({ label, point, samples: samples.length, elapsedMs: Date.now() - started, final: anchor });
      return anchor;
    }
    previous = anchor;
  }
  (report.projectionSettleFailures ??= []).push({ label, point, samples, elapsedMs: Date.now() - started });
  assert.fail(`${label}: camera projection did not settle within 30 samples/45 seconds; pointer coordinates were not guessed`);
}

async function cancelPreview() {
  await page.locator('[data-settlement-cancel]').click();
  await page.locator('[data-estate-panel="preview"]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !window.__legacySettlement?.()?.tool);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-settlement-build'));
  assert.equal((await estateDebug()).renderInfo.preview, null, 'Cancel removes real ghost geometry');
}

async function ensureCurrentPlotUncovered() {
  const before = (await estate()).preview;
  assert.ok(before);
  const inspect = () => page.evaluate(({ x, z }) => {
    const anchor = window.__legacyProjectSettlement?.(x, z);
    return { anchor, hit: anchor?.visible ? document.elementFromPoint(anchor.x, anchor.y)?.tagName : null };
  }, before);
  let view = await inspect();
  if (!view.anchor?.visible || view.hit !== 'CANVAS' || before.reason === 'Bring this plot into view before placing.') {
    assert.equal(before.valid, false, 'a ghost behind opaque UI cannot be presented as Ready to place');
    await page.locator('[data-settlement-show-plot]:visible').waitFor();
    await page.locator('[data-settlement-show-plot]:visible').click();
    await page.waitForFunction(() => window.__legacySettlement?.()?.preview?.valid === true);
    view = await inspect();
    for (const key of ['x', 'z', 'width', 'depth', 'rotation', 'crop']) assert.equal((await estate()).preview[key], before[key], 'explicit Show plot preserves the draft plot');
    (report.showPlotRequests ??= []).push({ draft: before, recoveredProjection: view.anchor, recoveredHit: view.hit });
  }
  assert.ok(view.anchor?.visible && view.hit === 'CANVAS', `the actual selected ghost must be visible outside opaque UI: ${JSON.stringify(view)}`);
  assert.equal((await estate()).preview.valid, true);
}

async function verifyOffscreenRecovery() {
  const before = (await estate()).preview, saved = await estateSave(), writes = (await estateWrites()).length;
  assert.ok(before?.valid);
  const point = { x: before.x, z: before.z };
  const initialAnchor = await hoverWorld(point, 'plot before camera guard test');
  // Deliberately move the camera, never the placement cursor. These are actual
  // right-drag gestures on the world, not calls to the renderer/editor API.
  await page.mouse.move(initialAnchor.x, initialAnchor.y); await page.mouse.down({ button: 'right' });
  const end = { x: page.viewportSize().width - 2, y: initialAnchor.y };
  await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up({ button: 'right' }); await tick();
  const anchor = await page.evaluate(point => window.__legacyProjectSettlement(point.x, point.z), point);
  const gestures = [{ start: initialAnchor, end, resultingProjection: anchor }];
  await page.waitForFunction(() => window.__legacySettlement?.()?.preview?.valid === false);
  assert.equal(await page.locator('[data-settlement-confirm]').isDisabled(), true, 'offscreen or UI-covered Place is unavailable');
  await page.locator('[data-settlement-show-plot]:visible').waitFor();
  assert.equal(await estateSave(), saved); assert.equal((await estateWrites()).length, writes);
  const blocked = (await estate()).preview;
  for (const property of ['x', 'z', 'width', 'depth', 'rotation', 'kind', 'crop']) assert.equal(blocked[property], before[property], 'camera movement cannot relocate or mutate a plot');
  await capture('1280x720-offscreen-placement-blocked');
  await page.locator('[data-settlement-show-plot]:visible').click();
  await page.waitForFunction(point => window.__legacyProjectSettlement?.(point.x, point.z)?.visible && window.__legacySettlement?.()?.preview?.valid, point);
  const recovered = (await estate()).preview;
  for (const property of ['x', 'z', 'width', 'depth', 'rotation', 'kind', 'crop']) assert.equal(recovered[property], before[property], 'Show plot only changes the camera');
  assert.equal(await page.locator('[data-settlement-confirm]').isEnabled(), true);
  const visible = await hoverWorld(point, 'Show plot recovered ghost');
  assert.equal((await estateDebug()).renderInfo.preview?.visible, true);
  assert.equal(await estateSave(), saved); assert.equal((await estateWrites()).length, writes);
  await capture('1280x720-show-plot-recovered');
  report.offscreenGuard = { gestures, blockedReason: blocked.reason, recoveredProjection: visible, estateWrites: 0 };
  record('Actual camera gestures move a plot out of view: Place becomes unavailable without saving, and explicit Show plot restores the same real ghost and reachable Place.');
  return visible;
}

async function assertRendered(placement) {
  await page.waitForFunction(id => window.__legacySettlementDebug?.()?.renderInfo?.placements?.some(p => p.id === id && p.visible && p.meshCount > 0), placement.id);
  const drawn = (await estateDebug()).renderInfo.placements.find(p => p.id === placement.id);
  assert.ok(typeof drawn.renderSignature === 'string' && drawn.renderSignature.length > 3, 'actual geometry/material buffers provide a stable render signature');
  assert.ok(BUILDING_KINDS.includes(placement.kind) && placement.crop === null);
  assertSourceMetadata(drawn, 'placed building');
  for (const property of ['kind', 'x', 'z', 'width', 'depth', 'rotation', 'crop']) assert.equal(drawn[property], placement[property], `rendered ${property} matches the committed placement`);
  assert.ok([...drawn.bounds.min, ...drawn.bounds.max].every(Number.isFinite));
  const width = drawn.bounds.max[0] - drawn.bounds.min[0], depth = drawn.bounds.max[2] - drawn.bounds.min[2];
  const expectedWidth = placement.rotation % 2 ? placement.depth : placement.width, expectedDepth = placement.rotation % 2 ? placement.width : placement.depth;
  if (placement.kind === 'ruin-arch') {
    // Its 8×3 m catalogue lot reserves approach clearance. The original source
    // voussoir arch is intentionally thin, rather than a three-metre wall.
    const long = Math.max(width, depth), short = Math.min(width, depth);
    const reservedLong = Math.max(expectedWidth, expectedDepth), reservedShort = Math.min(expectedWidth, expectedDepth);
    const height = drawn.bounds.max[1] - drawn.bounds.min[1];
    assert.equal(drawn.assetId, 'monolith-voussoir-arch');
    assert.ok(drawn.sources.some(source => source.id === drawn.assetId && repositoryId(source.repository) === 'leonxlnx/monolithwilds' && source.path === 'src/world/ruins-parts.js' && source.commit === report.villageSourceEvidence.sources.monolith.commit), 'the standing arch is the actual pinned Monolith source generator');
    assert.ok(long >= reservedLong * .8 && long <= reservedLong + .1 && short > 0 && short <= reservedShort + .1 && height >= reservedLong * .5, 'a real standing source arch fits inside its reserved plot with positive physical depth');
  } else assert.ok(width >= expectedWidth * .8 && width <= expectedWidth * 1.5 && depth >= expectedDepth * .8 && depth <= expectedDepth * 1.5, 'a real building mesh occupies the committed footprint');
  return drawn;
}

async function connectPad() {
  await page.bringToFront();
  assert.equal(await page.evaluate(() => document.hasFocus()), true);
  await page.evaluate(() => {
    const pad = { id: 'Simulated standard gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__legacyTestPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await tick();
}

async function verifyRetiredFieldMigration() {
  await assertHouseUnchanged();
  await page.context().close(); // one actual world renderer at a time
  const building = report.corePlacementFirst.placement;
  const bannerId = JSON.parse(initialRaw).banner.id;
  // TEST SETUP: one real, UI-authored building record plus the old public v1
  // field shape. This is storage migration input, not a new placement action.
  const retiredField = { id: 'retired-field-fixture', kind: 'field', x: 32, z: 56, width: 10, depth: 8, rotation: 0, crop: 'carrots' };
  const mixedLayout = { version: 1, bannerId, worldId: 'bannerhold', placements: [building, retiredField] };
  const mixedRaw = JSON.stringify(mixedLayout);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', recordVideo: { dir: `${directory}/migration-video`, size: { width: 1280, height: 720 } } });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  if (page.video()) videos.push({ label: 'retired v1 field migration and actual building edit', handle: page.video() });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.addInitScript(({ house, estateKey, mixedRaw, renderScale }) => {
    if (!sessionStorage.getItem('__buildingMigrationSeeded')) {
      localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', renderScale, motion: false, volume: 65 }));
      localStorage.setItem('crownfall.legacy.save', house);
      localStorage.setItem(estateKey, mixedRaw);
      sessionStorage.setItem('__buildingMigrationSeeded', '1');
    }
    // Observe writes after fixture setup. Loading an older field record must
    // not silently rewrite it; only the later actual Place may save a layout.
    window.__explorationSaveWrites = []; window.__estateWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'set' });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'set', key });
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'remove' });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'remove', key });
      return remove.call(this, key);
    };
  }, { house: initialRaw, estateKey, mixedRaw, renderScale });
  const openStored = async () => {
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
    await page.locator('.legacy-screen[data-environment-ready="true"][data-session="stored"]').waitFor();
  };
  await page.goto(`${origin}/?model=none&legacyStats=1`); await waitForBootReady(page);
  const parser = await page.evaluate(async ({ root, mixedLayout }) => {
    const { parseSettlementLayout } = await import(`${root}settlement/storage.ts`);
    const parse = layout => parseSettlementLayout(JSON.stringify(layout), mixedLayout.bannerId, mixedLayout.worldId);
    return {
      migrated: parse(mixedLayout),
      unknownRejected: parse({ ...mixedLayout, placements: [...mixedLayout.placements, { ...mixedLayout.placements[0], id: 'unknown-kind-fixture', kind: 'unknown-kind' }] }) === null,
      malformedBuildingRejected: parse({ ...mixedLayout, placements: [{ ...mixedLayout.placements[0], width: -1 }, mixedLayout.placements[1]] }) === null,
    };
  }, { root: shared, mixedLayout });
  assert.deepEqual(parser.migrated, { ...mixedLayout, placements: [building] }, 'v1 parser preserves the exact valid building and discards only the recognized retired field');
  assert.equal(parser.unknownRejected, true, 'unknown records still reject the layout');
  assert.equal(parser.malformedBuildingRejected, true, 'invalid building records still reject the layout');
  await openStored();
  assert.deepEqual((await estate()).placements, [building], 'the real stored-session scene uses the building-only migrated layout');
  const migratedMesh = await assertRendered(building);
  assert.equal((await estateDebug()).renderInfo.placements.some(p => p.id === retiredField.id), false, 'the retired field does not create a live estate mesh');
  await assertBuildingOnlyControls(); await assertHouseUnchanged(); await assertLandmarksUnchanged();
  assert.equal(await estateSave(), mixedRaw, 'read-time migration leaves the original stored v1 bytes unchanged');
  assert.deepEqual(await estateWrites(), [], 'reading/migrating does not write or remove estate storage');
  for (const [key, expected] of Object.entries(report.fixture.expectedCounters)) {
    assert.equal(Number((await page.locator(`[data-house-stat="${key}"]`).innerText()).replace(/[^\d-]/g, '')), expected, 'migration does not change actual house counters');
  }
  await capture('1280x720-retired-v1-field-migrated-in-memory');
  record('A mixed v1 save loads its exact valid Cottage and drops the retired field from live geometry, while original storage bytes, house counters and landmark meshes remain unchanged with zero read-time writes.');
  await beginBuilding('storehouse');
  await hoverWorld(POINTS.secondBuilding, 'migration clean-save Storehouse plot');
  await ensureCurrentPlotUncovered();
  const preview = await buildingPreviewEvidence();
  await page.locator('[data-settlement-confirm]').click();
  await page.waitForFunction(() => window.__legacySettlement?.()?.placements.length === 2);
  const added = (await estate()).placements.find(p => p.id !== building.id);
  assert.ok(added && added.kind === 'storehouse');
  const addedMesh = await assertRendered(added); comparePreviewToPlacement(preview, addedMesh);
  assert.deepEqual((await estate()).placements.find(p => p.id === building.id), building, 'an authorized new edit preserves the migrated building record exactly');
  const cleanRaw = await estateSave(), cleanLayout = JSON.parse(cleanRaw);
  assert.deepEqual(cleanLayout, { ...mixedLayout, placements: [building, added] }, 'the real Place action writes schema-1 building-only data through the existing key');
  const migrationWrites = await estateWrites();
  assert.ok(migrationWrites.length > 0 && migrationWrites.every(write => write.key === estateKey && write.operation === 'set'), 'only the existing estate key is written after the explicit building edit');
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  await page.reload(); await waitForBootReady(page); await openStored();
  assert.deepEqual((await estate()).placements, [building, added]);
  assert.equal(await estateSave(), cleanRaw);
  assert.deepEqual(await estateWrites(), [], 'loading the now-clean save does not rewrite it');
  assert.equal((await assertRendered(building)).renderSignature, migratedMesh.renderSignature);
  assert.equal((await assertRendered(added)).renderSignature, addedMesh.renderSignature);
  await assertBuildingOnlyControls(); await assertHouseUnchanged(); await assertLandmarksUnchanged();
  await capture('1280x720-retired-v1-field-clean-save-after-building-edit');
  report.retiredFieldMigration = {
    setupOnly: true, schema: 1, key: estateKey, retainedBuilding: building, retiredField,
    mixedSaveSha256: hash(mixedRaw), cleanSaveSha256: hash(cleanRaw),
    readWrites: 0, originalHouseSha256: hash(initialRaw), buildingPreservedExactly: true,
    liveFieldRemoved: true, nextActualEdit: added, nextEditWrites: migrationWrites,
    cleanSaveReloaded: true, unknownAndInvalidBuildingRejected: true,
  };
  report.retiredFieldMigrationVerified = true;
  record('Only a subsequent real Storehouse Place writes the clean building-only v1 layout; reload restores both actual meshes and the Legacy house remains byte-for-byte unchanged.');
}

async function verifyGuestLayoutIsolation(productionEstateRaw) {
  await assertHouseUnchanged();
  await page.context().close(); // never render two worlds simultaneously
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, reducedMotion: 'reduce', recordVideo: { dir: `${directory}/guest-video`, size: { width: 844, height: 390 } } });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  if (page.video()) videos.push({ label: 'guest founding and in-memory placement', handle: page.video() });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.addInitScript(({ house, estateKey, estateLayout, renderScale }) => {
    if (!sessionStorage.getItem('__guestIsolationSeeded')) {
      // Protected pre-existing device records are TEST SETUP. The guest below
      // must found and place through actual UI and must never overwrite them.
      localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', renderScale, motion: false, volume: 65 }));
      localStorage.setItem('crownfall.legacy.save', house);
      if (estateLayout !== null) localStorage.setItem(estateKey, estateLayout);
      sessionStorage.setItem('__guestIsolationSeeded', '1');
    }
    window.__explorationSaveWrites = []; window.__estateWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'set' });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'set', key });
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'remove' });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'remove', key });
      return remove.call(this, key);
    };
  }, { house: initialRaw, estateKey, estateLayout: productionEstateRaw, renderScale });
  const openGuest = async () => {
    await page.getByRole('tab', { name: 'Home', exact: true }).tap();
    await page.getByRole('button', { name: 'My Legacy', exact: true }).tap();
    await page.locator('.legacy-screen[data-environment-ready="true"][data-session="guest"][data-legacy-mode="founding"]').waitFor();
  };
  await page.goto(`${origin}/?model=none&legacy=fresh&legacyStats=1`); await waitForBootReady(page); await openGuest();
  await page.locator('[data-nation="solforiz"]').tap();
  await page.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.locator('[data-founding-step="name"]').waitFor();
  await page.locator('#legacy-banner-name').fill('House Amberwell');
  await page.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.locator('[data-founding-step="heraldry"]').waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).tap();
  await page.locator('[data-founding-step="confirm"]').waitFor();
  await page.getByRole('button', { name: 'Raise the banner', exact: true }).tap();
  await page.locator('.legacy-beat').waitFor({ state: 'detached', timeout: 15000 }); // Passive timed status; no input required.
  await page.locator('.legacy-screen[data-legacy-mode="bannerhold"][data-session="guest"]').waitFor();
  assert.match(await page.locator('.legacy-settlement-session').innerText(), /Guest.*not saved/i);
  await assertBuildingOnlyControls();
  const before = (await estate()).placements;
  const touchPlaceCottage = async () => {
    await page.locator('[data-settlement-build]').tap();
    await page.locator('[data-settlement-kind="cottage"]').tap();
    await page.locator('[data-estate-panel="preview"]').waitFor();
    const draft = (await estate()).preview;
    assert.equal(draft.x, POINTS.cottage.x); assert.equal(draft.z, POINTS.cottage.z);
    if (await page.locator('[data-settlement-confirm]').isDisabled()) {
      await page.locator('[data-settlement-show-plot]:visible').waitFor();
      await page.locator('[data-settlement-show-plot]:visible').tap();
    }
    await page.waitForFunction(() => window.__legacySettlement?.()?.preview?.valid === true);
    assert.equal((await estateDebug()).renderInfo.preview?.visible, true);
    await page.locator('[data-settlement-confirm]').tap();
    await page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, before.length);
    const placed = (await estate()).placements.find(p => !before.some(old => old.id === p.id));
    assert.ok(placed); await assertRendered(placed);
    await assertHouseUnchanged(); assert.equal(await estateSave(), productionEstateRaw); assert.deepEqual(await estateWrites(), []);
    return placed;
  };
  const removedCottage = await touchPlaceCottage();
  await page.locator('[data-settlement-delete]').tap();
  await page.waitForFunction(id => !window.__legacySettlement?.()?.placements.some(p => p.id === id), removedCottage.id);
  assert.deepEqual((await estate()).placements, before);
  assert.equal((await estateDebug()).renderInfo.placements.some(p => p.id === removedCottage.id), false);
  await assertHouseUnchanged(); assert.equal(await estateSave(), productionEstateRaw); assert.deepEqual(await estateWrites(), []);
  // Leave a second real touch-placed cottage in memory so reload's absence is
  // meaningful, rather than merely checking an object already removed above.
  const cottage = await touchPlaceCottage();
  await capture('844x390-guest-touch-in-memory-estate');
  await page.reload(); await waitForBootReady(page); await openGuest();
  assert.equal((await estate()).available, false, 'reload does not persist a guest-founded banner');
  assert.equal((await estate()).placements.some(p => p.id === cottage.id), false, 'guest placement does not return after reload');
  await assertHouseUnchanged(); assert.equal(await estateSave(), productionEstateRaw); assert.deepEqual(await estateWrites(), []);
  report.guestIsolation = { actualGuestFounding: true, touch: { emulatedBrowser: true, physicalPhoneOrHeadset: false, viewport: [844, 390], realTaps: ['founding navigation', 'Build', 'cottage', 'Show plot when required', 'Place', 'Remove', 'Place again'] }, removedCottage, inMemoryPlacement: cottage, estateWrites: 0, protectedHouseSha256: hash(initialRaw), protectedEstateSha256: productionEstateRaw === null ? null : hash(productionEstateRaw), reloadReturnsToFounding: true };
  record('At 844×390, emulated browser touch taps complete guest founding and Build/Place/Remove/re-place real cottage geometry; reload returns to founding with zero estate writes and exact production house/layout bytes protected.');
}

async function seedProductionHouse() {
  const seed = await page.evaluate(async root => {
    const [{ createLegacyState }, { reduceLegacy }, { defaultHeraldry }, { serializeLegacy }, { settlementStorageKey }] = await Promise.all([
      import(`${root}domain/state.ts`), import(`${root}domain/reducer.ts`),
      import(`${root}content/heraldry.ts`), import(`${root}domain/persistence.ts`), import(`${root}settlement/storage.ts`),
    ]);
    const at = '2026-02-01T10:00:00.000Z';
    let state = createLegacyState({ at });
    // Existing public domain-test vocabulary. No private canon or invented
    // production match/history is added by this test fixture.
    for (const event of [
      { type: 'found-banner', name: 'House Amberwell', nationId: 'solforiz', heraldry: defaultHeraldry('solforiz'), motto: null, at, seed: 11 },
      { type: 'nominate', memberId: 'member-2', file: 'g', at },
    ]) {
      const next = reduceLegacy(state, event);
      if (next.error) throw new Error(`Fixture refused: ${next.error}`);
      state = next.state;
    }
    const serialized = serializeLegacy(state);
    if (!serialized.ok) throw new Error(serialized.error);
    localStorage.setItem('crownfall.legacy.save', serialized.json);
    window.__explorationSaveWrites = [];
    window.__estateWrites = [];
    return {
      raw: serialized.json,
      estateKey: settlementStorageKey(state.banner.id, 'bannerhold'),
      expected: { members: state.members.length, recognition: state.standing.recognition, matches: state.matches.length, notices: state.notices.filter(notice => notice.status === 'unread').length },
    };
  }, shared);
  initialRaw = seed.raw;
  estateKey = seed.estateKey;
  report.fixture = { setupOnly: true, name: 'House Amberwell', nation: 'solforiz', saveSha256: hash(seed.raw), expectedCounters: seed.expected };
  return seed.expected;
}

async function layout() {
  const result = await page.locator('.legacy-screen').evaluate(root => {
    const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[inert]'); };
    const critical = [...root.querySelectorAll('[data-settlement-dock] button,.legacy-settlement-stats button,.legacy-settlement-nameplate,.legacy-view-switch button,.legacy-world-picker button,[data-legacy-back],[data-legacy-play],[data-settlement-confirm],[data-settlement-cancel]')].filter(visible);
    const canvas = root.querySelector('.legacy-stage canvas');
    return {
      viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
      environment: root.dataset.environment, quality: root.dataset.quality,
      canvas: canvas ? { drawingBuffer: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight], display: getComputedStyle(canvas).display, opacity: getComputedStyle(canvas).opacity } : null,
      critical: critical.map(element => { const r = element.getBoundingClientRect(); return { name: element.getAttribute('aria-label') || element.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }),
      stats: window.__legacyStats?.() ?? null,
    };
  });
  assert.ok(result.documentWidth <= result.viewport[0] + 1, 'no horizontal document overflow');
  assert.equal(result.environment, 'environment', 'captures must show the actual Bannerhold renderer, not a stand-in');
  assert.ok(result.stats?.drawCalls > 0 && result.stats?.triangles > 0, 'the real world has rendered geometry');
  for (const box of result.critical) {
    assert.ok(box.width >= 43.99 && box.height >= 43.99, `critical target is at least 44 px: ${JSON.stringify(box)}`);
    assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= result.viewport[0] + 1 && box.y + box.height <= result.viewport[1] + 1, `critical control is reachable: ${JSON.stringify(box)}`);
  }
  return result;
}

async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await tick();
  const dimensions = await layout();
  const image = `${name}.png`;
  await page.screenshot({ path: `${directory}/${image}` });
  report.captures.push({ image, at: new Date().toISOString(), viewport: page.viewportSize(), state: await snapshot(), layout: dimensions });
  console.log(`CAPTURE ${directory}/${image}`);
  assert.deepEqual(report.errors, [], 'stop promptly on a browser exception');
  assert.deepEqual(report.consoleErrors, [], 'stop promptly on a shader/resource/runtime console error');
}

async function closeHousePanel(id) {
  await page.keyboard.press('Escape');
  await panel(id).waitFor({ state: 'hidden' });
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-dock-landmark') === id, id);
}

async function verifyCorePlacementFirst(baseline) {
  // Prove the fundamental actual editor path before camera-edge scenarios.
  await beginBuilding();
  await ensureCurrentPlotUncovered();
  await hoverWorld(POINTS.cottage, 'first real cottage placement');
  await ensureCurrentPlotUncovered();
  const preview = await buildingPreviewEvidence();
  await page.locator('[data-settlement-confirm]').click();
  await page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, baseline.placements.length);
  const placement = (await estate()).placements.find(p => !baseline.placements.some(old => old.id === p.id));
  assert.ok(placement && placement.kind === 'cottage');
  const mesh = await assertRendered(placement);
  comparePreviewToPlacement(preview, mesh);
  const persisted = await estateSave();
  assert.ok(persisted, 'the real Place action persists a separate estate layout');
  await assertHouseUnchanged();
  await capture('1280x720-core-first-placed-cottage');
  record('Core builder: actual Place creates visible source-derived cottage geometry and persists only the separate estate layout.');
  const expected = (await estate()).placements;
  await page.reload(); await waitForBootReady(page);
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
  await page.locator('.legacy-screen[data-environment-ready="true"][data-session="stored"]').waitFor();
  assert.deepEqual((await estate()).placements, expected);
  assert.equal(await estateSave(), persisted);
  await assertRendered(placement); await assertHouseUnchanged();
  await page.locator('[data-settlement-build]').click();
  await page.locator(`[data-settlement-select="${placement.id}"]`).click();
  await page.locator('[data-estate-panel="selected"]').waitFor();
  await capture('1280x720-core-first-reloaded-selected-cottage');
  await page.locator('[data-settlement-delete]').click();
  await page.waitForFunction(id => !window.__legacySettlement?.()?.placements.some(p => p.id === id), placement.id);
  assert.deepEqual((await estate()).placements, baseline.placements);
  assert.equal((await estateDebug()).renderInfo.placements.some(p => p.id === placement.id), false);
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  report.corePlacementFirst = { placement, mesh, reloaded: true, selectedViaActualCatalogue: true, removedOnlySelectedObject: true, houseUnchanged: true };
  record('Core builder: actual reload restores the cottage, catalogue selection targets it, and Remove deletes only that object without changing house progression or original landmarks.');
}

async function verifyWorldRoofSelection() {
  const before = (await estate()).placements;
  await beginBuilding(); await hoverWorld(POINTS.cottage, 'roof-pick cottage plot'); await ensureCurrentPlotUncovered();
  await page.locator('[data-settlement-confirm]').click();
  await page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, before.length);
  const cottage = (await estate()).placements.find(p => !before.some(old => old.id === p.id));
  const mesh = await assertRendered(cottage);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__legacySettlement?.()?.selectedId === null);
  const point = {
    x: (mesh.bounds.min[0] + mesh.bounds.max[0]) / 2,
    z: (mesh.bounds.min[2] + mesh.bounds.max[2]) / 2,
    worldY: mesh.bounds.min[1] + (mesh.bounds.max[1] - mesh.bounds.min[1]) * .75,
  };
  await stableProjection(point, 'roof-pick settled camera');
  const locator = await page.evaluate(({ x, z, worldY }) => {
    const ground = window.__legacyProjectSettlement?.(x, z);
    const roof = window.__legacyProjectSettlement?.(x, z, worldY);
    return { ground, roof, hit: roof?.visible ? document.elementFromPoint(roof.x, roof.y)?.tagName : null };
  }, point);
  assert.ok(locator.roof?.visible && locator.ground);
  assert.ok(Math.hypot(locator.roof.x - locator.ground.x, locator.roof.y - locator.ground.y) > 4, 'the real pointer ray targets the upper building volume, not its ground footprint');
  assert.equal(locator.hit, 'CANVAS', 'the projected building roof is actually unobstructed');
  await page.mouse.click(locator.roof.x, locator.roof.y);
  await page.waitForFunction(id => window.__legacySettlement?.()?.selectedId === id, cottage.id);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-settlement-delete'));
  await capture('1280x720-world-roof-selected-cottage');
  await page.locator('[data-settlement-delete]').click();
  await page.waitForFunction(id => !window.__legacySettlement?.()?.placements.some(p => p.id === id), cottage.id);
  assert.deepEqual((await estate()).placements, before);
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  report.worldRoofSelection = { actualMeshPick: true, cottage, point, projectedLocator: locator, selectedPaneFocus: true, removedOnlySelectedObject: true };
  record('A genuine world-roof click selects the actual tall cottage mesh, hands focus to its selected-pane action, and Remove preserves every other estate object.');
}

async function verifyFiveCachedLegacyRoundtrips() {
  await tick();
  assert.equal((await estate()).tool, null, 'start with no placement preview');
  assert.equal((await estate()).selectedId, null, 'start with no selected-object editor');
  assert.equal(await page.locator('[data-exploration="overview"]').isVisible(), true);
  const layer = page.locator('.legacy-layer');
  const back = layer.locator('[data-legacy-back]');
  assert.equal(await back.getAttribute('aria-label'), 'Return to Home', 'finish overlay unwinding before counting roundtrips');
  const canvas = await layer.locator('.legacy-stage canvas').elementHandle();
  assert.ok(canvas, 'the real Legacy renderer canvas exists');
  const before = {
    estateRaw: await estateSave(),
    placements: (await estate()).placements,
    writes: (await estateWrites()).length,
    attempt: await layer.getAttribute('data-legacy-attempt'),
    quality: await page.locator('.legacy-screen').getAttribute('data-quality'),
    stats: await page.evaluate(() => window.__legacyStats?.()),
  };
  await assertHouseUnchanged();
  const samples = [];
  let warmedResources;
  try {
    for (let cycle = 1; cycle <= 5; cycle++) {
      assert.equal(await back.getAttribute('aria-label'), 'Return to Home');
      await back.click();
      await page.locator('.home-grid').waitFor();
      await page.locator('.legacy-layer[data-legacy-layer="hidden"].is-dormant').waitFor({ state: 'attached' });
      assert.equal(await layer.getAttribute('aria-hidden'), 'true');
      assert.equal(await layer.evaluate(element => element.inert), true);
      assert.equal(await layer.locator('canvas').count(), 1, 'no duplicate Legacy canvas while hidden');
      assert.equal(await canvas.evaluate(element => element.isConnected && element === document.querySelector('.legacy-layer .legacy-stage canvas')), true, 'hidden Legacy retains its original cached canvas');
      await assertHouseUnchanged();
      assert.equal(await estateSave(), before.estateRaw);
      assert.equal((await estateWrites()).length, before.writes);

      // Home is already the actual current menu. Its My Legacy tile is the
      // ordinary entry path; do not invoke an imperative Legacy handle.
      await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
      await page.locator('.legacy-layer[data-legacy-layer="active"]').waitFor();
      await page.locator('.legacy-screen[data-environment-ready="true"][data-session="stored"]').waitFor();
      await tick();
      assert.equal(await layer.evaluate(element => element.inert), false);
      assert.notEqual(await layer.getAttribute('aria-hidden'), 'true');
      assert.equal(await layer.getAttribute('data-legacy-attempt'), before.attempt, 'no boundary retry/replacement was needed');
      assert.equal(await canvas.evaluate(element => element.isConnected && element === document.querySelector('.legacy-layer .legacy-stage canvas')), true, 're-entry resumes the cached renderer rather than replacing its canvas');
      assert.equal(await layer.locator('canvas').count(), 1);
      assert.equal(await page.locator('.legacy-screen').getAttribute('data-quality'), before.quality, 'compare an unchanged quality preset');
      const stats = await page.evaluate(() => window.__legacyStats?.());
      assert.ok(stats && Number.isFinite(stats.geometries) && Number.isFinite(stats.textures) && Number.isFinite(stats.programs));
      assert.ok(stats.drawCalls > 0 && stats.triangles > 0, 'the returned active world exposes real rendered geometry');
      const resources = { geometries: stats.geometries, textures: stats.textures, programs: stats.programs };
      // The first completed return permits lazy GPU-cache warming. With the
      // same retained canvas, same layout/preset and no edits, later returns
      // should not keep allocating more geometry/texture entries.
      if (!warmedResources) warmedResources = resources;
      else {
        assert.ok(resources.geometries <= warmedResources.geometries, `geometry count grew after warm re-entry: ${JSON.stringify({ cycle, warmedResources, resources })}`);
        assert.ok(resources.textures <= warmedResources.textures, `texture count grew after warm re-entry: ${JSON.stringify({ cycle, warmedResources, resources })}`);
        assert.ok(resources.programs <= warmedResources.programs, `compiled-program count grew after warm re-entry: ${JSON.stringify({ cycle, warmedResources, resources })}`);
      }
      await assertHouseUnchanged();
      assert.equal(await estateSave(), before.estateRaw);
      assert.deepEqual((await estate()).placements, before.placements);
      assert.equal((await estateWrites()).length, before.writes);
      samples.push({ cycle, resources, drawCalls: stats.drawCalls, triangles: stats.triangles });
    }
  } finally {
    await canvas.dispose(); // do not retain this test's remote DOM reference
  }
  report.cachedHomeLegacyRoundtrips = {
    cycles: 5,
    baselineResources: { geometries: before.stats.geometries, textures: before.stats.textures, programs: before.stats.programs },
    warmedResources,
    samples,
    sameCanvas: true,
    houseAndEstateUnchanged: true,
    estateWrites: 0,
    limits: [
      'Counts cover this cached Legacy WebGL renderer only; retained nonzero counts on Home are intentional.',
      'Compiled-program counts are renderer objects; this does not measure GPU byte memory.',
      'This is a bounded resource-count/persistence regression check, not a JS-heap/old-context leak proof, byte-memory measurement, FPS or hardware performance test.',
      'Draw calls and triangles are observed as positive, not required to match exactly across culling/animation frames.',
    ],
  };
  record('Five actual Home/My Legacy roundtrips retain one cached canvas, preserve house/layout bytes without writes, and do not grow geometry/texture/program counts after warm re-entry.');
}


async function pulse(button, effect) {
  await page.waitForTimeout(380); // existing App controller action debounce
  await page.evaluate(index => { window.__legacyTestPad.buttons[index] = { pressed: true, touched: true, value: 1 }; }, button);
  await effect();
  await page.evaluate(index => { window.__legacyTestPad.buttons[index] = { pressed: false, touched: false, value: 0 }; }, button);
  await tick();
}

try {
  page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', recordVideo: { dir: `${directory}/video`, size: { width: 1280, height: 720 } } });
  if (page.video()) videos.push({ label: 'production estate controls and placement', handle: page.video() });
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.addInitScript(scale => {
    localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', renderScale: scale, motion: false, volume: 65 }));
    localStorage.removeItem('crownfall.legacy.environment.v1');
    window.__explorationSaveWrites = [];
    window.__estateWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'set', bytes: value.length });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'set', key, bytes: value.length });
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      if (key === 'crownfall.legacy.save') window.__explorationSaveWrites.push({ operation: 'remove' });
      if (key.startsWith('crownfall.legacy.estate.v1.')) window.__estateWrites.push({ operation: 'remove', key });
      return remove.call(this, key);
    };
  }, renderScale);
  await page.goto(`${origin}/?model=none&legacyStats=1`);
  await waitForBootReady(page);
  const expectedCounters = await seedProductionHouse();
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
  await page.locator('.legacy-screen[data-environment-ready="true"][data-session="stored"]').waitFor();
  if (await page.locator('.legacy-aftermath').count()) await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-session-label]').count(), 0, 'normal stored session must not show a development-preview label');
  assert.equal(await page.locator('[data-settlement-dock] [data-dock-landmark]').count(), 4);
  for (const [key, expected] of Object.entries(expectedCounters)) {
    const text = await page.locator(`[data-house-stat="${key}"]`).innerText();
    const number = Number(text.replace(/[^\d-]/g, ''));
    assert.equal(number, expected, `${key} shows real seeded house data`);
  }
  record('A validated stored house opens normally; four HUD counters reflect actual house data and the dock contains the four real landmarks.');
  await capture('1280x720-initial-hybrid-idle');
  const initialEstate = await estate();
  assert.ok(initialEstate?.available, 'the real estate editor is available');
  originalLandmarks = (await estateDebug()).landmarks;
  assert.equal(originalLandmarks.length, 4);
  const initialKit = await sourceKit();
  assert.ok(initialKit && typeof initialKit.alpineIncluded === 'boolean', 'actual source-kit evidence declares Alpine integration explicitly');
  for (const repository of REQUIRED_SOURCE_REPOSITORIES) assert.ok(initialKit.components.some(component => repositoryId(component.source) === repository && component.meshes > 0 && component.triangles > 0), `${repository} has actual source meshes in the drawn village`);
  if (initialKit.alpineIncluded) {
    const alpineRepository = 'leonxlnx/procedural-alpine-lake';
    const component = initialKit.components.find(entry => repositoryId(entry.source) === alpineRepository && entry.meshes > 0 && entry.triangles > 0);
    const provenance = Object.values(initialKit.sources).find(entry => repositoryId(entry.repository) === alpineRepository);
    assert.ok(component && provenance, 'an Alpine integration flag requires actual drawn source components and provenance');
    assert.match(provenance.commit, /^[a-f\d]{7,40}$/i, 'the actual locally used Alpine source has a pinned revision');
    assert.notEqual(provenance.license, 'MIT', 'creator-asserted Alpine permission is not described as an MIT license');
    assert.ok(initialKit.alpine?.included && initialKit.alpine.triangles === 2 && initialKit.alpine.drawCalls === 1 && initialKit.alpine.shader, 'actual Alpine water shader/geometry is active, not only an integration flag');
    const shader = initialKit.alpine.shader;
    assert.equal(repositoryId(shader.repository), alpineRepository);
    for (const name of ['waterNormalA', 'waterGust', 'W_ABS', 'W_SCA']) assert.ok(shader.executedFunctions.includes(name), `actual Alpine shader executes ${name}`);
    for (const path of ['engine/shaders/common.glsl', 'engine/shaders/water.glsl', 'engine/shaders/water_shade.glsl']) assert.match(shader.upstreamHashes[path], /^[a-f\d]{64}$/i, 'executed source records its upstream SHA-256');
    assert.equal(shader.waveBands, 22, 'desktop uses the actual desktop source-water profile');
    report.sourceScope.alpineRuntimeEvidence = { component, provenance, water: initialKit.alpine };
    report.sourceScope.completeRequestedFourRepositoryScope = true;
    report.sourceScope.unresolved = [{ repository: 'Leonxlnx/procedural-alpine-lake', reason: 'Runtime source integration verified locally on the creator’s permission assertion; written redistribution permission remains pending before public publication.' }];
  }
  originalLandmarkGeometry = coreGeometry(initialKit, originalLandmarks);
  report.villageSourceEvidence = initialKit; report.hybridSourceVerified = true;
  await assertBuildingOnlyControls();
  assert.deepEqual(initialEstate.placements, [], 'new estates do not contain retired field defaults');
  await verifyCorePlacementFirst(initialEstate);
  const initialEstateRaw = await estateSave(), initialEstateWrites = (await estateWrites()).length;

  // Current reference states show the drawn settlement, real house inspector,
  // actual source-building ghost and the current building-only catalogue.
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const prefix = `${viewport.width}x${viewport.height}`;
    if (viewport.width !== 1280) await capture(`${prefix}-idle-settlement`);
    await dock('banner-hall').click();
    await panel('banner-hall').waitFor();
    await capture(`${prefix}-selected-inspector`);
    await closeHousePanel('banner-hall');
    await beginBuilding(); await hoverWorld(POINTS.cottage, 'cottage plot');
    await ensureCurrentPlotUncovered();
    await page.locator('[data-settlement-rotate]').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__legacySettlement?.()?.preview?.rotation === 1);
    await buildingPreviewEvidence();
    await capture(`${prefix}-building-preview`);
    await cancelPreview();
    await page.locator('[data-settlement-build]').click();
    await page.locator('[data-estate-chooser="build"]').waitFor();
    assert.deepEqual(await page.locator('[data-settlement-kind]').evaluateAll(elements => elements.map(element => element.getAttribute('data-settlement-kind'))), BUILDING_KINDS, 'the real catalogue exposes all four building kinds and no retired field tool');
    await assertCatalogueFullyVisible();
    await capture(`${prefix}-building-catalogue`);
    await page.keyboard.press('Escape');
    await page.locator('[data-estate-chooser="build"]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-settlement-build'));
    await assertBuildingOnlyControls();
    assert.equal(await estateSave(), initialEstateRaw, 'all visual preview/cancel actions leave the estate save unchanged');
    assert.equal((await estateWrites()).length, initialEstateWrites);
    assert.deepEqual((await estate()).placements, initialEstate.placements);
    await assertHouseUnchanged(); await assertLandmarksUnchanged();
  }
  record('Idle, inspector, real building preview and the four-kind building catalogue fit 1280×720, 1920×1080 and 844×390; keyboard rotation and Cancel restore focus without writing either save, and retired farming controls are absent.');

  await page.setViewportSize({ width: 1280, height: 720 });
  await beginBuilding(); await hoverWorld(POINTS.cottage, 'RMB cancel plot'); await ensureCurrentPlotUncovered();
  const cancelAnchor = await page.evaluate(() => { const p = window.__legacySettlement().preview; return window.__legacyProjectSettlement(p.x, p.z); });
  await page.mouse.click(cancelAnchor.x, cancelAnchor.y, { button: 'right' });
  await page.waitForFunction(() => window.__legacySettlement?.()?.tool === null);
  assert.deepEqual((await estate()).placements, initialEstate.placements);
  assert.equal((await estateDebug()).renderInfo.preview, null);
  assert.equal(await estateSave(), initialEstateRaw); assert.equal((await estateWrites()).length, initialEstateWrites);
  record('A genuine right-click cancels the ghost without placing or saving; right-drag target reveals keep placement active.');
  await beginBuilding();
  report.rejectedPlacements = [];
  for (const [category, reason] of [['water', /dry ground|water/i], ['road', /paths|road/i], ['building', /building/i]]) {
    const point = await hoverWorld(POINTS[category], category);
    const invalid = (await estate()).preview;
    assert.equal(invalid.valid, false); assert.match(invalid.reason, reason);
    assert.equal(await page.locator('[data-settlement-confirm]').isDisabled(), true);
    await page.mouse.click(point.x, point.y);
    assert.deepEqual((await estate()).placements, initialEstate.placements, 'a genuine click on rejected terrain cannot commit a ghost');
    assert.equal((await estate()).preview.x, POINTS[category].x); assert.equal((await estate()).preview.z, POINTS[category].z, 'the cursor cannot silently relocate to a valid plot');
    assert.equal(await estateSave(), initialEstateRaw); assert.equal((await estateWrites()).length, initialEstateWrites);
    report.rejectedPlacements.push({ category, point: POINTS[category], reason: invalid.reason });
  }
  record('Real canvas input rejects water, roads and an existing original building; invalid clicks do not relocate the cursor, create geometry records or write a layout.');
  let cottagePoint = await hoverWorld(POINTS.cottage, 'valid cottage plot');
  assert.equal((await estate()).preview.valid, true);
  await page.locator('[data-settlement-rotate]').click();
  await page.waitForFunction(() => window.__legacySettlement?.()?.preview?.rotation === 1);
  assert.equal((await estate()).preview.valid, true);
  cottagePoint = await verifyOffscreenRecovery();
  const cottagePreview = await buildingPreviewEvidence();
  await page.mouse.click(cottagePoint.x, cottagePoint.y);
  await page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, initialEstate.placements.length);
  const cottage = (await estate()).placements.find(p => !initialEstate.placements.some(old => old.id === p.id));
  assert.ok(cottage && cottage.kind === 'cottage' && cottage.rotation === 1);
  const cottageMesh = await assertRendered(cottage);
  comparePreviewToPlacement(cottagePreview, cottageMesh);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-settlement-delete'));
  assert.ok((await estateWrites()).length > initialEstateWrites);
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  record('A real pointer click commits a rotated cottage with actual building meshes, isolated estate persistence and a reachable selected-object Remove action.');
  await page.keyboard.press('Escape');

  await beginBuilding('storehouse');
  await hoverWorld(POINTS.secondBuilding, 'second building plot');
  await ensureCurrentPlotUncovered();
  const originalDraft = (await estate()).preview;
  await page.locator('[data-settlement-nudge="east"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(x => window.__legacySettlement?.()?.preview?.x === x + 1, originalDraft.x);
  await page.locator('[data-settlement-nudge="west"]').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(x => window.__legacySettlement?.()?.preview?.x === x, originalDraft.x);
  await page.locator('[data-settlement-rotate]').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(rotation => window.__legacySettlement?.()?.preview?.rotation === (rotation + 1) % 4, originalDraft.rotation);
  await ensureCurrentPlotUncovered();
  const storehousePreview = await buildingPreviewEvidence();
  await connectPad(); await page.locator('[data-settlement-confirm]').focus();
  await pulse(0, () => page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, initialEstate.placements.length + 1));
  const storehouse = (await estate()).placements.find(p => p.id !== cottage.id && !initialEstate.placements.some(old => old.id === p.id));
  assert.ok(storehouse && storehouse.kind === 'storehouse' && storehouse.crop === null);
  assert.equal(storehouse.x, originalDraft.x); assert.equal(storehouse.z, originalDraft.z);
  assert.equal(storehouse.rotation, (originalDraft.rotation + 1) % 4);
  const storehouseMesh = await assertRendered(storehouse);
  comparePreviewToPlacement(storehousePreview, storehouseMesh);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-settlement-delete'));
  await assertBuildingOnlyControls();
  await capture('1280x720-placed-cottage-storehouse');
  record('Real keyboard Enter/Space nudges and rotates the Storehouse ghost; emulated gamepad A places its actual source-derived geometry at that exact plot, without house progression writes.');
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  const expectedPlacements = (await estate()).placements, savedLayout = await estateSave();
  assert.deepEqual(JSON.parse(savedLayout).placements, expectedPlacements);
  const beforeReloadWrites = await estateWrites();
  await page.reload(); await waitForBootReady(page);
  await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
  await page.locator('.legacy-screen[data-environment-ready="true"][data-session="stored"]').waitFor();
  assert.deepEqual((await estate()).placements, expectedPlacements, 'both source-building records, plots and rotations survive an actual app reload');
  await assertRendered(cottage);
  assert.equal((await assertRendered(storehouse)).renderSignature, storehouseMesh.renderSignature, 'actual source Storehouse geometry is restored after reload');
  await assertHouseUnchanged(); await assertLandmarksUnchanged();
  assert.equal(await estateSave(), savedLayout);
  await capture('1280x720-reloaded-estate');
  await page.locator('[data-settlement-build]').click(); await page.locator(`[data-settlement-select="${cottage.id}"]`).click();
  const beforeDelete = (await estate()).placements;
  await page.locator('[data-settlement-delete]').click();
  await page.waitForFunction(id => !window.__legacySettlement?.()?.placements.some(p => p.id === id), cottage.id);
  assert.deepEqual((await estate()).placements, beforeDelete.filter(p => p.id !== cottage.id));
  assert.equal((await estateDebug()).renderInfo.placements.some(p => p.id === cottage.id), false);
  await assertRendered(storehouse); await assertLandmarksUnchanged(); await assertHouseUnchanged();
  for (const id of ['banner-hall', 'muster-grounds', 'war-record', 'heralds-station']) {
    await dock(id).click(); await panel(id).waitFor();
    assert.equal(await page.locator('[data-settlement-delete]').isVisible().catch(() => false), false, 'original landmarks never expose placed-object Remove');
    await closeHousePanel(id);
  }
  report.buildingCatalogueEvidence = [{ kind: 'cottage', preview: cottagePreview, placed: cottageMesh }];
  for (const kind of ['storehouse', 'pavilion', 'ruin-arch']) {
    const before = (await estate()).placements;
    await beginBuilding(kind); await hoverWorld(POINTS.cottage, `${kind} plot`); await ensureCurrentPlotUncovered();
    const preview = await buildingPreviewEvidence();
    const anchor = await page.evaluate(() => { const p = window.__legacySettlement().preview; return window.__legacyProjectSettlement(p.x, p.z); });
    await page.mouse.click(anchor.x, anchor.y);
    await page.waitForFunction(count => window.__legacySettlement?.()?.placements.length === count + 1, before.length);
    const placement = (await estate()).placements.find(p => !before.some(old => old.id === p.id));
    assert.equal(placement?.kind, kind);
    const rendered = await assertRendered(placement); comparePreviewToPlacement(preview, rendered);
    await capture(`1280x720-source-${kind}`);
    report.buildingCatalogueEvidence.push({ kind, preview, placed: rendered });
    await page.locator('[data-settlement-delete]').click();
    await page.waitForFunction(id => !window.__legacySettlement?.()?.placements.some(p => p.id === id), placement.id);
    assert.deepEqual((await estate()).placements, before, 'removing one source building leaves every other placement unchanged');
    await assertHouseUnchanged(); await assertLandmarksUnchanged();
  }
  record('All supported building kinds preview and place real licensed-source components; preview/source identity matches the committed mesh and Remove affects only that object.');
  await verifyWorldRoofSelection();
  const allEstateWrites = [...beforeReloadWrites, ...await estateWrites()];
  assert.ok(allEstateWrites.length > 0 && allEstateWrites.every(write => write.key === estateKey), 'only this banner/world estate key receives layout writes');
  report.estateEvidence = { key: estateKey, cottage, cottageMesh, storehouse, storehouseMesh, persistedSha256: hash(savedLayout), estateWrites: allEstateWrites, originalLandmarks, deletedOnlyId: cottage.id };
  report.estatePlacementVerified = true;
  record('Real app reload restores both source-building meshes; Remove deletes only the selected Cottage, preserves the Storehouse and all four original landmark meshes, and never writes house progression.');

  await page.locator('[data-house-stat="members"]').click();
  await page.locator('[data-party-panel]').waitFor();
  await page.keyboard.press('Escape'); await page.locator('[data-party-panel]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-house-stat') === 'members');
  for (const [counter, id] of [['recognition', 'banner-hall'], ['matches', 'war-record'], ['notices', 'heralds-station']]) {
    await page.locator(`[data-house-stat="${counter}"]`).click();
    await panel(id).waitFor(); await closeHousePanel(id);
  }
  await page.locator('.legacy-settlement-nameplate').click(); await panel('banner-hall').waitFor(); await closeHousePanel('banner-hall');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-dock-landmark') === 'heralds-station');
  await page.keyboard.press('Enter'); await panel('heralds-station').waitFor(); await closeHousePanel('heralds-station');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-dock-landmark') === 'banner-hall');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-dock-landmark') === 'muster-grounds');
  await page.keyboard.press('Enter'); await panel('muster-grounds').waitFor(); await closeHousePanel('muster-grounds');
  record('All four real-data counters and the house nameplate open honest destinations; keyboard Home/End/arrows/Enter navigate the dock and Escape returns to its selected landmark.');

  await page.locator('[data-exploration-enter]').click(); await active().waitFor();
  const initial = await snapshot();
  assert.ok(initial?.available && initial.enabled && initial.members.length > 0);
  await page.locator('[data-party-toggle]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-party-panel]').waitFor();
  assert.equal(await page.locator('[data-party-member]').count(), initial.members.length);
  await page.keyboard.press('Escape');
  await page.locator('[data-party-panel]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-party-toggle'));
  assert.equal((await snapshot()).enabled, true, 'closing Members must not leave Explore');
  await page.locator('[data-party-toggle]').click();
  const alternate = initial.members.find(member => member.available && member.id !== initial.selectedMemberId);
  assert.ok(alternate, 'founded house has another available member');
  await page.locator(`[data-party-member="${alternate.id}"]`).click();
  await page.waitForFunction(id => window.__legacyExploration?.()?.selectedMemberId === id, alternate.id);
  if (await page.locator('[data-party-panel]').isVisible().catch(() => false)) await page.keyboard.press('Escape');
  record('Members opens from a genuine keyboard action, closes before Explore unwinds, restores focus, and real roster selection changes the renderer/session.');

  // App Gamepad API polling, not imperative LegacyHandle calls. Full presses
  // wait for their observed effects so software rendering cannot miss a pulse.
  await page.evaluate(() => {
    const pad = { id: 'Simulated standard gamepad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__legacyTestPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await tick();
  await page.locator('[data-party-toggle]').focus();
  await pulse(0, () => page.locator('[data-party-panel]').waitFor());
  await pulse(1, () => page.locator('[data-party-panel]').waitFor({ state: 'hidden' }));
  assert.equal((await snapshot()).enabled, true);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-party-toggle'));
  await pulse(15, () => page.waitForFunction(() => document.activeElement?.getAttribute('data-dock-landmark') === 'banner-hall'));
  record('Emulated standard-gamepad A opens Members, B closes it once and D-pad moves to the first landmark, preserving Explore and focus.');

  const walk = initial.destinations.find(entry => entry.available && entry.travelMode !== 'fast-travel' && entry.id !== 'muster-grounds');
  assert.ok(walk, 'Bannerhold exposes a genuine walking destination');
  await dock(walk.id).focus();
  await pulse(0, () => page.locator(`[data-landmark-preview="${walk.id}"]`).waitFor());
  await page.waitForFunction(() => ['moving', 'arrived'].includes(window.__legacyExploration?.()?.status));
  const started = await snapshot(); report.snapshots.push({ moment: 'travel-start', value: started });
  if (started.status === 'moving') {
    await page.waitForFunction(point => { const state = window.__legacyExploration?.(), p = state?.location; return state?.status === 'moving' && p && Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) > 1.5; }, started.location);
    assert.equal(await page.locator('[data-interact]').count(), 0, 'interaction remains unavailable while moving');
    await capture('1280x720-travel-context');
    await page.locator(`[data-landmark-preview="${walk.id}"]`).getByRole('button', { name: /^Stop travelling/ }).click();
    await page.waitForFunction(() => window.__legacyExploration?.()?.status === 'idle');
  } else assert.fail('The chosen walk ended before actual movement could be observed; choose a longer real route.');
  record('Travel preview does not pause movement: real world position changes, interaction stays hidden and Stop cancels before arrival.');
  if (await page.locator('[data-landmark-preview]').count()) await page.keyboard.press('Escape');

  const destination = 'muster-grounds';
  await dock(destination).click();
  await page.waitForFunction(id => { const state = window.__legacyExploration?.(); return state?.status === 'arrived' && state.destination === id; }, destination, { timeout: 120000 });
  report.snapshots.push({ moment: 'actual-arrival', value: await snapshot() });
  await capture('1280x720-actual-arrival');
  await page.locator(`[data-interact="${destination}"]`).click(); await panel(destination).waitFor();
  await capture('1280x720-arrival-house-inspector');
  await closeHousePanel(destination); await active().waitFor();
  record('Only real arrival enables Interact; it opens the existing meaningful Muster Grounds house inspector and Back restores exploration.');

  await page.locator('[data-exploration-overview]').click();
  await page.locator('[data-exploration="overview"]').waitFor();
  await dock('war-record').focus(); await page.keyboard.press('Enter'); await panel('war-record').waitFor();
  await closeHousePanel('war-record');
  record('Overview retains direct keyboard inspection of War Record and restores dock focus on Escape.');
  const raw = await page.evaluate(() => localStorage.getItem('crownfall.legacy.save'));
  assert.equal(raw, initialRaw);
  assert.deepEqual(await page.evaluate(() => window.__explorationSaveWrites), []);
  report.saveIsolation = { unchanged: true, initialSha256: hash(initialRaw), finalSha256: hash(raw), writes: 0 };
  record('Exploration, roster selection, travel, Stop, grid/view changes and inspectors leave exact stored-house bytes unchanged with zero save writes/removals.');
  await verifyFiveCachedLegacyRoundtrips();
  await verifyRetiredFieldMigration();
  await verifyGuestLayoutIsolation(await estateSave());
  assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []);
  record('No browser page/console errors; reduced-motion preference preserves deliberate exploration and inspector navigation.');
  assert.equal(report.estatePlacementVerified, true, 'The current building-only editor flow must be verified in this fresh run.');
  assert.deepEqual(report.buildingCatalogueEvidence.map(entry => entry.kind), BUILDING_KINDS, 'all four source buildings need current actual preview/place/delete evidence');
  assert.equal(report.worldRoofSelection?.actualMeshPick, true);
  assert.equal(report.cachedHomeLegacyRoundtrips?.cycles, 5);
  assert.equal(report.guestIsolation?.touch?.emulatedBrowser, true);
  assert.equal(report.retiredFieldMigrationVerified, true, 'Old v1 fields must be removed only from the live layout on read, with clean storage written only after a real building edit.');
  assert.equal(report.hybridSourceVerified, true, 'Actual licensed-source components must be verified in the drawn village and placed geometry; Alpine Lake remains explicitly unresolved.');
  assert.equal(report.landmarkGeometryImmutableVerified, true, 'Immutability requires the actual four authored landmark meshes/transforms, not static descriptors alone.');
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  if (page) {
    report.failureContext = {
      url: page.url(), snapshot: await snapshot().catch(() => null),
      settlement: await estateDebug().catch(() => null),
      houseWrites: await page.evaluate(() => window.__explorationSaveWrites ?? []).catch(() => null),
      estateWrites: await estateWrites().catch(() => null),
      focus: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500)).catch(() => null),
      text: await page.locator('.legacy-screen').innerText().catch(() => ''),
      stats: await page.evaluate(() => window.__legacyStats?.()).catch(() => null),
    };
    await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
  }
} finally {
  await browser.close();
  report.videos = await Promise.all(videos.map(async ({ label, handle }) => ({ label, path: await handle.path().catch(() => null) })));
  await writeFile(`${directory}/verification.json`, JSON.stringify(report, null, 2));
}
console.log(`Legacy reference evidence: ${directory}`);
if (!report.passed) throw Error(report.failure);
