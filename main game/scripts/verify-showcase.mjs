import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';
const url = new URL(process.env.CROWNFALL_TEST_URL || 'http://localhost:5173');
url.searchParams.set('model', 'none');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], layouts = [], errors = [], downloads = [];
let failure;
const pass = label => { checks.push(label); console.log(`PASS ${label}`); };
const dir = 'artifacts/showcase-functional';
await mkdir(dir, { recursive: true });
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce', acceptDownloads: true, hasTouch: true });
 page.setDefaultTimeout(15000);
 page.on('pageerror', error => errors.push(error.message));
 const responses = [];
 page.on('response', response => responses.push(response.url()));
 await page.addInitScript(() => {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', renderScale: 70, motion: false, volume: 0 }));
  localStorage.setItem('crownfall.banner.untouched', 'preserve');
  window.__showcaseButtons = []; window.__showcaseReads = 0;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
   window.__showcaseReads++;
   const pressed = [...window.__showcaseButtons]; window.__showcaseButtons = [];
   return [{ index: 0, mapping: 'standard', connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: pressed.includes(index) ? 1 : 0, touched: false })) }];
  }});
 });
 const screen = () => page.locator('.showcase-screen');
 const control = key => screen().locator(`[data-control="${key}"]`);
 const waitIdle = () => waitForMenuIdle(page);
 const open = async name => { await screen().getByRole('button', { name, exact: true }).click(); await waitIdle(); };
 const back = async () => { await control('back').click(); await waitIdle(); };
 const pad = async button => {
  await page.waitForTimeout(400);
  const prior = await page.evaluate(index => { window.__showcaseButtons = [index]; return window.__showcaseReads; }, button);
  await page.waitForFunction(value => window.__showcaseReads > value, prior);
  await waitIdle();
 };
 await page.goto(url.href); await waitForBootReady(page);
 assert.equal(responses.some(value => /Showcase\.tsx|showcase\/(session|records|ShowcaseStage)/.test(value)), false, 'heavy Showcase is absent from cold startup');
 await page.getByRole('tab', { name: 'Showcase', exact: true }).click(); await waitIdle();
 await screen().locator('.showcase-overview').waitFor();
 pass('Showcase/system/stage are lazy: none loaded during cold menu startup');
 await open('AI Battles');
 await screen().locator('[data-stage-ply]').waitFor();
 await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase === 'ready', undefined, { timeout: 60000 });
 await page.waitForFunction(() => document.querySelector('.showcase-stage')?.dataset.stagePly !== '0');
 await control('transport-play').click();
 assert.equal(await screen().getAttribute('data-showcase-playing'), 'false');
 const initialPly = Number(await screen().locator('.showcase-stage').getAttribute('data-stage-ply'));
 await page.waitForTimeout(450); assert.equal(Number(await screen().locator('.showcase-stage').getAttribute('data-stage-ply')), initialPly);
 await control('transport-next').click(); assert.equal(Number(await screen().locator('.showcase-stage').getAttribute('data-stage-ply')), initialPly + 1);
 await control('transport-previous').click(); assert.equal(Number(await screen().locator('.showcase-stage').getAttribute('data-stage-ply')), initialPly);
 await control('transport-last').click();
 const max = Number(await control('timeline').getAttribute('max')); assert.equal(Number(await control('timeline').inputValue()), max);
 assert.equal(await control('transport-next').isDisabled(), true);
 await control('transport-play').click(); await page.waitForFunction(() => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) < 4);
 await control('transport-play').click(); if (await control('transport-first').isEnabled()) await control('transport-first').click();
 await control('speed-4').click(); assert.equal(await control('speed-4').getAttribute('aria-pressed'), 'true');
 await control('transport-play').click(); await page.waitForFunction(() => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) >= 2);
 await control('transport-play').click();
 await control('timeline').press('Home');
 const targetPly = Math.min(12, max);
 for (let index = 0; index < targetPly; index++) await control('timeline').press('ArrowRight');
 assert.equal(await control('timeline').inputValue(), String(targetPly));
 await control('camera-board').click(); assert.equal(await screen().locator('.showcase-stage').getAttribute('data-stage-view'), 'board');
 assert.equal(await page.locator('.creature-stage').getAttribute('data-suspended'), 'true');
 assert.equal(await screen().locator('.showcase-stage').getAttribute('data-stage-reduced-motion'), 'true');
 await control('transport-play').click();
 await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
 const hiddenPly = await control('timeline').inputValue(); await page.waitForTimeout(650);
 assert.equal(await control('timeline').inputValue(), hiddenPly);
 await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
 assert.equal(await screen().getAttribute('data-showcase-playing'), 'false');
 await control('save').click(); assert.equal(await control('save').isDisabled(), true);
 const archive = await page.evaluate(() => localStorage.getItem('crownfall.showcase.replays.v1'));
 assert.ok(archive && archive.length > 100);
 pass('Legal computer exhibition renders and advances; pause/step/seek/end/restart/speed/camera/save work with redundant hero suspended');
 await page.screenshot({ path: `${dir}/desktop-battles-1280.png` });
 await control('open-archive').click(); await waitIdle();
 assert.equal(await screen().locator('.showcase-replay-row').count(), 1);
 await screen().locator('.showcase-replay-row>button:first-child').click(); await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase === 'ready'); assert.equal(await control('timeline').inputValue(), '0');
 await screen().locator('.showcase-delete-button').click();
 assert.equal(await control('dialog-cancel').evaluate(element => element === document.activeElement), true);
 await page.keyboard.press('Escape'); assert.equal(await screen().locator('dialog').count(), 0);
 assert.equal(await screen().locator('.showcase-replay-row').count(), 1);
 for (const format of ['export', 'export-json']) {
  const pending = page.waitForEvent('download'); await control(format).click(); const download = await pending;
  downloads.push(download.suggestedFilename()); await download.saveAs(`${dir}/${download.suggestedFilename()}`);
 }
 await control('import').click(); await control('import-text').fill('not a legal PGN'); await control('dialog-confirm').click();
 await screen().getByRole('alert').waitFor();
 assert.equal(await page.evaluate(() => localStorage.getItem('crownfall.showcase.replays.v1')), archive);
 await control('import-text').fill('[Event "Local import"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *'); await control('dialog-confirm').click();
 await screen().locator('dialog').waitFor({ state: 'detached' });
 assert.equal(await screen().locator('.showcase-replay-row').count(), 2);
 await page.screenshot({ path: `${dir}/desktop-replays-1280.png` });
 await screen().locator('.showcase-delete-button').first().click(); await control('dialog-confirm').click();
 await screen().locator('dialog').waitFor({ state: 'detached' }); assert.equal(await screen().locator('.showcase-replay-row').count(), 1);
 assert.equal(await page.evaluate(() => localStorage.getItem('crownfall.banner.untouched')), 'preserve');
 pass('Local replay open/import/export/delete work; deletion defaults Cancel; illegal import preserves saved bytes and unrelated data');
 const changedRaw = await page.evaluate(() => { const key = 'crownfall.showcase.replays.v1'; const next = localStorage.getItem(key) + '\n'; localStorage.setItem(key, next); return next; });
 await control('save').click();
 assert.equal(await page.evaluate(() => localStorage.getItem('crownfall.showcase.replays.v1')), changedRaw);
 await control('reload-archive').click(); await control('reload-archive').waitFor({ state: 'visible' });
 await page.waitForFunction(() => !document.querySelector('[data-control="save"]')?.disabled);
 await control('save').click(); assert.equal(await control('save').isDisabled(), true);
 assert.equal(await screen().locator('.showcase-replay-row').count(), 2);
 pass('External archive conflict preserves bytes; visible Reload archive recovers, keeps the active record and permits retry-save');

 await back(); await open('Arenas');
 for (let index = 0; index < 4; index++) { await control(`arena-${index}`).click(); assert.equal(await screen().locator('.showcase-stage').getAttribute('data-stage-arena'), `${index}`); }
 await control('artwork').click();
 assert.equal(await screen().locator('.showcase-artwork img').evaluate(async image => { await image.decode(); return image.complete && image.naturalWidth === 2048 && getComputedStyle(image).objectFit === 'contain'; }), true);
 await control('artwork').click();
 await page.screenshot({ path: `${dir}/desktop-arenas-1280.png` });
 pass('All four original 3D arena variants select correctly; original supplied artwork is available uncropped');
 await back();
 await page.keyboard.press('Home'); assert.equal(await control('category-0').evaluate(element => element === document.activeElement), true);
 await pad(15); assert.equal(await control('category-1').evaluate(element => element === document.activeElement), true);
 await pad(0); await screen().locator('.showcase-detail--arenas').waitFor();
 await pad(1); await screen().locator('.showcase-overview').waitFor();
 assert.equal(await control('category-1').evaluate(element => element === document.activeElement), true);
 pass('Keyboard Home and simulated standard-controller D-pad/A/B preserve category origin and route focus');
 for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
  await page.setViewportSize(viewport);
  for (const name of ['AI Battles', 'Arenas', 'Match Replays']) {
   await open(name);
   if (name === 'AI Battles') await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase !== 'generating');
   const metrics = await screen().evaluate(element => {
    const viewport = { width: innerWidth, height: innerHeight };
    const bad = [...element.querySelectorAll('button,input,textarea')].filter(node => { const r = node.getBoundingClientRect(); return r.width && !node.closest('.showcase-moves') && (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1); }).map(node => node.dataset.control);
    const stage = element.querySelector('.showcase-stage-wrap').getBoundingClientRect();
    const info = element.querySelector('.showcase-information').getBoundingClientRect();
    const targetSizes = [...element.querySelectorAll('[data-showcase-control]')].filter(node => !node.disabled && node.getBoundingClientRect().width).map(node => ({ key: node.dataset.control, height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width }));
    const primaryText = [...element.querySelectorAll('.showcase-file-actions button,.showcase-replay-row strong,.showcase-replay-row small,.showcase-feedback,.showcase-game-status,.showcase-primary-action,.showcase-moves button,.showcase-camera-group button')].map(node => ({ text: node.textContent.slice(0,40), size: parseFloat(getComputedStyle(node).fontSize) }));
    const timeline = element.querySelector('.showcase-timeline input'), playback = element.querySelector('.showcase-playback-row');
    return { targetSizes, primaryText, timelineHeight: timeline?.getBoundingClientRect().height, transportOverlap: !!timeline && timeline.getBoundingClientRect().bottom > playback.getBoundingClientRect().top + 1, viewport, overflow: document.documentElement.scrollWidth > innerWidth, bad, stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, info: { x: info.x, y: info.y, width: info.width, height: info.height }, overlap: stage.right > info.left };
   });
   assert.equal(metrics.overflow, false); assert.deepEqual(metrics.bad, []); assert.equal(metrics.overlap, false);
   assert.deepEqual(metrics.targetSizes.filter(item => item.height < 23.9 || item.width < 23.9), []);
   assert.deepEqual(metrics.primaryText.filter(item => item.size < 10.9), []);
   if (metrics.timelineHeight) { assert.ok(metrics.timelineHeight >= (viewport.height < 460 ? 32 : 24)); assert.equal(metrics.transportOverlap, false); }
   layouts.push({ name, ...metrics });
   if (viewport.width === 844 && name === 'AI Battles') { const box = await control('timeline').boundingBox(); await page.touchscreen.tap(box.x + box.width * .55, box.y + box.height / 2); assert.ok(Number(await control('timeline').inputValue()) > 0); }
   await page.screenshot({ path: `${dir}/${name.toLowerCase().replaceAll(' ', '-')}-${viewport.width}.png` });
   await back();
  }
 }
 pass('Three detail flows fit 1280×720, 1920×1080 and 844×390 with no page overflow, offscreen controls or stage/sidebar overlap');
 await open('AI Battles');
 const supportsLoss = await screen().locator('.showcase-stage-host canvas').evaluate(canvas => { const gl = canvas.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_lose_context'); if (!extension) return false; extension.loseContext(); return true; });
 assert.equal(supportsLoss, true); await screen().locator('.showcase-stage-failure').waitFor();
 if (await control('transport-first').isEnabled()) await control('transport-first').click(); assert.equal(await control('timeline').inputValue(), '0');
 await screen().locator('.showcase-stage-failure button').click(); await screen().locator('.showcase-stage-failure').waitFor({ state: 'detached' });
 assert.equal(await screen().locator('.showcase-stage-host canvas').count(), 1);
 pass('Context-loss fallback keeps playback controls usable; explicit Retry creates one fresh 3D stage');
 await back(); await back(); assert.equal(await page.getByRole('tab', { name: 'Play', exact: true }).getAttribute('aria-selected'), 'true');
 assert.deepEqual(errors, []); pass('Back restores Play; no browser JavaScript errors');
} catch (error) { failure = error; }
finally { await writeFile(`${dir}/verification.json`, JSON.stringify({ passed: !failure, scope: 'Desktop Chromium SwiftShader/model=none; no physical headset/performance claim', checks, layouts, downloads, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2)); await browser.close(); }
if (failure) throw failure;
