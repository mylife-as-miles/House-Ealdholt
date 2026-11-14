// Capture the real Crownfall village through its existing entry and Views UI.
// The coordinator owns the browser/GPU lease; this script never creates a scene,
// changes a renderer/camera directly, hides UI, or prepares an inherited save.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { tsImport } from '../../main-game-vr/node_modules/tsx/dist/esm/api/index.mjs';

const [{ INHERITED_SESSION_STORAGE_KEY }, { parseInheritedSession }] = await Promise.all([
  tsImport('../../shared/legacy/aethelgard/inherited-storage.ts', import.meta.url),
  tsImport('../../shared/legacy/aethelgard/inherited-session.ts', import.meta.url),
]);
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(process.env.CROWNFALL_EALDHOLT_ARTIFACTS, 'Choose a private output directory.');
const directory = resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS);
const outputRelative = relative(checkout, directory);
assert.ok(outputRelative === '..' || outputRelative.startsWith('../'), 'Evidence must remain outside the checkout.');
await mkdir(directory, { recursive: true, mode: 0o700 });
const url = new URL(process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:4191');
assert.ok(['http:', 'https:'].includes(url.protocol), 'Use the actual running game URL.');
url.searchParams.delete('ealdholt-preview');
url.searchParams.set('ealdholt-house', '1');
const views = ['overview', 'well', 'churchyard', 'lakeside', 'riverside'];
const limits = { instances: 200, triangles: 2_000_000, drawCalls: 4 };
const report = {
  schemaVersion: 1, passed: false, startedAt: new Date().toISOString(), stage: 'setup',
  viewport: { width: 1280, height: 800 },
  preferences: { quality: 'high', motion: false, volume: 65, showHints: true },
  reducedMotion: 'reduce', woodlandLimits: limits,
  isolation: { freshContext: true, preparedInheritedSaves: 0, clockOverrides: 0,
    directAppActions: 0, directCameraChanges: 0, rendererMutations: 0, hiddenUI: false, standInScenes: 0 },
  views: [], errors: [], browserClosed: false,
  limitations: [
    'Actual desktop game captures; not physical Quest, headset comfort or hardware performance evidence.',
    'Host datasets report authored/runtime diagnostics; they do not prove pixel visibility or foliage coverage.',
    'Only the newly confirmed inherited-session raw bytes are checked during inspection; this fresh context has no predecessor save.',
    'Normal Reduce Motion preferences are used; no simulation clock override or renderer suppression is applied.',
  ],
};
let browser, context, page, savedRaw;
const root = () => page.locator('.ealdholt-preview[aria-hidden="false"]');
const control = selector => root().locator(selector);
const world = () => control('.ealdholt-world');
const digest = raw => ({ utf8Bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') });

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + ' exceeded its deadline.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function until(read, label, milliseconds = 60000) {
  let stopped = false;
  try {
    return await bounded((async () => {
      while (!stopped) {
        const result = await read();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    })(), milliseconds, label);
  } finally { stopped = true; }
}
async function stage(label, action, milliseconds = 60000) {
  report.stage = label;
  console.log('STAGE ' + label);
  return bounded(action(), milliseconds, label);
}
const dataset = () => world().evaluate(element => ({ ...element.dataset }));
const sessionRaw = () => page.evaluate(key => localStorage.getItem(key), INHERITED_SESSION_STORAGE_KEY);
function assertEnvironment(data) {
  assert.equal(data.modelReady, 'true');
  assert.equal(data.modelProfile, 'desktop');
  assert.equal(data.foliageQuality, 'high');
  assert.equal(data.valleyGrassStatus, 'ready');
  assert.equal(data.valleyGrassSource, 'Grass001');
  assert.equal(data.valleyGrassTileMetres, '1.4');
  assert.equal(data.coverageMipsStatus, 'applied');
  assert.equal(data.coverageMipsAppearanceDiagnostic, 'false');
  assert.equal(Number(data.coverageMipsTextures), 2, 'Both audited Desktop leaf maps retain corrected mip coverage.');
  assert.equal(data.outerContinuationContourRows, '3');
  const landform = JSON.parse(data.outerContinuationLandform);
  assert.equal(landform.mode, 'relief');
  assert.ok(landform.movedVertices > 0 && landform.addedTriangles === 0 && landform.extraGpuBytes === 0);
  assert.ok(landform.minimumChangedShoreDistance > landform.protectedShoreWidth && landform.maximumRaise > 0, 'Mainland relief must protect whole shore corridor faces.');
  assert.ok(Number(data.outerContinuationTriangles) <= 640 && Number(data.outerContinuationBufferBytes) <= 65536, 'Contour apron budget exceeded.');
  assert.equal(data.farSurroundStatus, 'ready');
  assert.equal(data.farSurroundMode, 'geometry');
  assert.equal(data.farSurroundLocalPlacementEligible, 'false');
  assert.ok(JSON.parse(data.farSurroundRelief), 'The actual Desktop terrain must use the opt-in layered mainland.');
  assert.equal(data.farWoodlandStatus, 'ready');
  assert.equal(data.farWoodlandSourceKind, 'borrowed-detailed');
  assert.equal(data.farWoodlandAssetSha256, '');
  assert.equal(Number(data.farWoodlandTrianglesPerTree), Number(data.woodlandTriangles) / Number(data.woodlandInstances));
  assert.ok(Number(data.farWoodlandInstances) > 0 && Number(data.farWoodlandInstances) <= 48);
  assert.ok(Number(data.farWoodlandTriangles) <= 500000 && Number(data.farWoodlandDrawCalls) <= 3);
  assert.equal(Number(data.farWoodlandExtraTextureBytes), 0);
  assert.ok(Number(data.combinedExteriorWoodlandActors) <= 328
    && Number(data.combinedExteriorWoodlandTriangles) <= 2500000
    && Number(data.combinedExteriorWoodlandDrawCalls) <= 6);

  assert.equal(Number(data.farSurroundExtraTextureBytes), 0);
  assert.ok(Number(data.farSurroundTriangles) > 0 && Number(data.farSurroundTriangles) <= 2048);
  assert.ok(Number(data.farSurroundBufferBytes) > 0 && Number(data.farSurroundBufferBytes) <= 131072);
  assert.ok(Number(data.farSurroundDrawCalls) > 0 && Number(data.farSurroundDrawCalls) <= 3);
  const farBounds = JSON.parse(data.farSurroundRenderBounds), localBounds = JSON.parse(data.farSurroundLocalBounds);
  assert.ok(farBounds.min[0] < localBounds.min[0] - 870 && farBounds.max[0] > localBounds.max[0] + 870
    && farBounds.min[2] < localBounds.min[2] - 870 && farBounds.max[2] > localBounds.max[2] + 870,
  'Real distant geometry must extend beyond local inspection, orbit and rendering reach.');
  const counters = Object.fromEntries(['woodlandInstances', 'woodlandTriangles', 'woodlandDrawCalls',
    'woodlandNorthShoulderInstances', 'woodlandEastShoulderInstances'].map(key => [key, Number(data[key])]));
  for (const [key, value] of Object.entries(counters)) assert.ok(Number.isFinite(value) && value >= 0, 'Missing or invalid ' + key);
  assert.ok(counters.woodlandNorthShoulderInstances > 0, 'The real woodland must populate the northern shoulder.');
  assert.ok(counters.woodlandEastShoulderInstances > 0, 'The real woodland must populate the eastern shoulder.');
  const regions = JSON.parse(data.woodlandAcceptedRegions);
  assert.equal(Object.values(regions).reduce((sum, count) => sum + count, 0), counters.woodlandInstances);
  assert.ok(regions.near > 0 && regions.farFringe > 0, 'Both real riparian reservations must be represented.');
  const composition = JSON.parse(data.woodlandComposition);
  assert.equal(composition.version, 'cluster-and-fringe-satellites-v2');
  assert.equal(composition.pool, 'complete-high');
  assert.equal(composition.candidateActors, counters.woodlandInstances);
  assert.ok(composition.anchorsPreserved && composition.ordinalsScaleYawPreserved && composition.spacingUnchanged && composition.moved > 0);
  assert.ok(composition.mainlandPreservedFromClusteredPool && composition.satelliteStage.moved > 0);
  assert.equal(composition.satelliteStage.moved + composition.satelliteStage.fallback, regions.farDeep, 'Each Deep slot must have a grounded satellite or its reserved fallback.');
  assert.ok(counters.woodlandInstances <= limits.instances, 'Woodland instance budget exceeded.');
  assert.ok(counters.woodlandTriangles <= limits.triangles, 'Woodland triangle budget exceeded.');
  assert.ok(counters.woodlandDrawCalls <= limits.drawCalls, 'Woodland draw budget exceeded.');
  const understory = Object.fromEntries(['woodlandUnderstoryInstances', 'woodlandUnderstoryTriangles',
    'woodlandUnderstoryDrawCalls', 'woodlandUnderstorySourceRoots'].map(key => [key, Number(data[key])]));
  for (const [key, value] of Object.entries(understory)) assert.ok(Number.isFinite(value) && value > 0, 'Missing real understory ' + key);
  assert.ok(understory.woodlandUnderstoryInstances <= 512 && understory.woodlandUnderstoryTriangles <= 64000
    && understory.woodlandUnderstoryDrawCalls <= 3, 'Whole source understory budget exceeded.');
  return { ...counters, ...understory };
}
async function unchangedSession() {
  const raw = await sessionRaw();
  assert.equal(raw, savedRaw, 'Named-view inspection must preserve the confirmed inherited session exactly.');
  return { ...digest(raw), exactRawStringUnchanged: true };
}

try {
  await stage('browser-start', async () => {
    browser = await chromium.launch({ headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--disable-dev-shm-usage'] });
    context = await browser.newContext({ viewport: report.viewport, reducedMotion: report.reducedMotion });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => report.errors.push({ kind: 'page', message: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') report.errors.push({ kind: 'console', message: message.text() });
    });
    // Only normal settings in this isolated browser. No Legacy state is seeded.
    await page.addInitScript(preferences => {
      if (!sessionStorage.getItem('ealdholt-environment-preferences')) {
        localStorage.setItem('crownfall.main-game.preferences', JSON.stringify(preferences));
        sessionStorage.setItem('ealdholt-environment-preferences', '1');
      }
    }, report.preferences);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 150000 });
  }, 150000);
  await stage('normal-menu-and-village-entry', async () => {
    await until(async () => await page.locator('.menu-shell').count() > 0
      && await page.locator('.loading-screen').count() === 0, 'normal menu boot', 150000);
    assert.equal(await sessionRaw(), null, 'A fresh context starts without an inherited save.');
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.locator('.home-grid').waitFor();
    await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
    await root().waitFor();
    await until(async () => {
      const data = await world().evaluate(element => ({ ...element.dataset }), undefined, { timeout: 150000 });
      return data.modelReady === 'true' && Number(data.renderFrames) > 0;
    }, 'real High village model and first frame', 150000);
    assert.equal(await root().getAttribute('data-ealdholt-ui'), 'world-first');
    assertEnvironment(await dataset());
  }, 150000);
  await stage('actual-inherited-confirmation', async () => {
    await control('[data-ealdholt-intro-continue]').click();
    await control('[data-ealdholt-preset]').first().click();
    assert.equal(await control('[data-ealdholt-preset]').first().getAttribute('aria-pressed'), 'true');
    await control('[data-ealdholt-confirm]').click();
    await until(async () => await root().getAttribute('data-ealdholt-step') === 'village'
      && await root().getAttribute('data-ealdholt-busy') === 'false', 'actual inherited village entry');
    savedRaw = await sessionRaw();
    assert.equal(typeof savedRaw, 'string');
    assert.ok(parseInheritedSession(savedRaw).ok, 'The actual Begin action creates a valid inherited session.');
    report.confirmedSession = digest(savedRaw);
  });
  for (const id of views) await stage('view-' + id, async () => {
    const before = await dataset();
    await control('[data-ealdholt-tool="views"]').click();
    const drawer = control('[data-ealdholt-tool-drawer="views"]');
    await drawer.waitFor();
    await control(`[data-ealdholt-view="${id}"]`).click();
    await until(async () => {
      const data = await dataset();
      return data.selectedView === id && Number(data.renderFrames) > Number(before.renderFrames);
    }, 'actual ' + id + ' view and rendered frame');
    assert.equal(await drawer.count(), 0, 'Selecting a view closes its real drawer without hiding capture UI.');
    const data = await dataset();
    assert.equal(data.selectedView, id);
    assert.ok(Number(data.renderFrames) > Number(before.renderFrames));
    const counters = assertEnvironment(data);
    const session = await unchangedSession();
    const file = resolve(directory, id + '.png');
    await page.screenshot({ path: file, timeout: 60000 });
    const after = await dataset();
    assert.equal(after.selectedView, id);
    assert.ok(Number(after.renderFrames) >= Number(data.renderFrames));
    await unchangedSession();
    report.views.push({ id, file, beforeRenderFrames: Number(before.renderFrames),
      renderedFrames: Number(data.renderFrames), afterCaptureRenderFrames: Number(after.renderFrames),
      hostDataset: data, afterCaptureHostDataset: after, woodland: counters, inheritedSession: session,
      drawerClosed: true, uiUnmodified: true });
    console.log('CAPTURED ' + id);
  }, 150000);
  await unchangedSession();
  assert.deepEqual(report.errors, [], 'The actual desktop environment must not log browser errors.');
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
  // Bounded state-only failure evidence; never create a debug screenshot loop.
  if (page && !page.isClosed()) try {
    report.failureState = await bounded(page.evaluate(() => ({ readyState: document.readyState,
      visibility: document.visibilityState, roots: [...document.querySelectorAll('.ealdholt-preview')].map(element => ({
        ariaHidden: element.getAttribute('aria-hidden'), dataset: { ...element.dataset },
        world: element.querySelector('.ealdholt-world') ? { ...element.querySelector('.ealdholt-world').dataset } : null,
      })) })), 8000, 'failure state observation');
  } catch (diagnosticError) { report.failureState = { unavailable: diagnosticError.name }; }
} finally {
  try {
    if (context) await bounded(context.close(), 15000, 'context cleanup');
    if (browser) await bounded(browser.close(), 15000, 'browser cleanup');
    report.browserClosed = true;
  } catch (error) {
    report.cleanupFailure = String(error.message);
    report.passed = false;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ passed: report.passed, stage: report.stage, views: report.views.length,
  browserErrors: report.errors.length, browserClosed: report.browserClosed,
  evidence: resolve(directory, 'verification.json'), failure: report.failure ? 'See private report.' : null }));
