// Real-app checks for the map-selection presentation. Does not launch a match
// or certify physical controller / Quest behavior; verify-match-setup covers
// the component's complete onStart configuration matrix separately.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const base = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.CROWNFALL_SELECTION_ARTIFACTS || 'artifacts/play/selection');
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = { passed: false, checks: [], images: [], locales: [], errors: [], limits: 'Desktop Chromium. Browser gamepads are emulated. Arena previews are existing game captures; no actual match or physical headset is launched by this check.' };
await mkdir(output, { recursive: true });
const bindings = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', select: 'KeyF', back: 'KeyV', previousTab: 'KeyQ', nextTab: 'KeyE', first: 'Home', last: 'End' };
let currentPage;
const pass = text => { result.checks.push(text); console.log(`PASS ${text}`); };

async function menu(locale = 'en', viewport = { width: 1280, height: 720 }, touch = false) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: touch });
  await context.addInitScript(({ locale, bindings }) => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ locale, bindings, quality: 'low', automaticGraphics: false, motion: false, fullscreen: false, renderScale: 50, frameLimit: 30, musicVolume: 0, soundVolume: 0 })), { locale, bindings });
  const page = await context.newPage(); currentPage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(`${base}/?model=none`);
  await waitForBootReady(page);
  return { page, context };
}

async function open(page, name = 'Classic') {
  await page.getByRole('button', { name, exact: true }).click();
  await page.locator('.match-setup').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function preview(page, setting, view) {
  const root = page.locator('.setup-preview');
  await page.waitForFunction(({ setting, view }) => {
    const element = document.querySelector('.setup-preview');
    return element?.dataset.previewSetting === setting && element?.dataset.preview === view;
  }, { setting, view });
  const image = root.locator('.setup-preview-image');
  await image.waitFor();
  await image.evaluate(async element => { if (!element.complete) await element.decode(); });
  const dimensions = await image.evaluate(element => ({ src: element.currentSrc, width: element.naturalWidth, height: element.naturalHeight }));
  assert.ok(dimensions.width >= 640 && dimensions.height >= 320, `usable decoded ${setting}/${view} game capture`);
  return dimensions;
}

async function layout(page, columns) {
  const boxes = await page.locator('.match-setup').evaluate(root => {
    const box = selector => { const r = root.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    return { width: innerWidth, height: innerHeight, overflow: root.scrollWidth - root.clientWidth, list: box('.setup-battlefields'), preview: box('.setup-preview'), terms: box('.setup-terms'), start: box('.setup-start'), back: box('.setup-back') };
  });
  assert.ok(boxes.overflow <= 1, `selection screen has no horizontal overflow: ${JSON.stringify(boxes)}`);
  for (const control of [boxes.start, boxes.back]) assert.ok(control.left >= -1 && control.right <= boxes.width + 1 && control.top >= -1 && control.bottom <= boxes.height + 1, 'Start and Back remain reachable');
  if (columns) {
    assert.ok(boxes.list.right <= boxes.preview.left + 1 && boxes.preview.right <= boxes.terms.left + 1, 'wide layout places arena list, large preview and terms left to right');
    assert.ok(boxes.preview.width > boxes.list.width, 'selected preview is larger than a list item column');
  }
  const overflowing = await page.locator('.setup-choice-face strong').evaluateAll(labels => labels.flatMap(label => {
    const text = label.getBoundingClientRect(), face = label.closest('.setup-choice-face').getBoundingClientRect();
    return text.left < face.left - 1 || text.right > face.right + 1 ? [label.textContent] : [];
  }));
  assert.deepEqual(overflowing, [], 'choice labels stay inside their own controls');
  return boxes;
}

async function pulseA(page) {
  await page.evaluate(() => {
    const pad = { id: 'Sony DualSense Wireless Controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: performance.now() };
    window.__selectionPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  await page.bringToFront();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { window.__selectionPad.buttons[0] = { pressed: true, touched: true, value: 1 }; });
  await page.locator('.match-setup [data-setup-pressed="true"]').waitFor();
  await page.evaluate(() => { window.__selectionPad.buttons[0] = { pressed: false, touched: false, value: 0 }; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  const { page, context } = await menu();
  await open(page);
  const start = page.locator('.setup-start');
  assert.equal(await start.isDisabled(), true);
  assert.equal(await page.locator('.setup-battlefield').count(), 2, 'only the two playable arenas are offered');
  await preview(page, 'scene-01', 'arena');
  assert.equal(await start.isDisabled(), true, 'default preview does not silently select an arena');
  await layout(page, true);
  await page.locator('.setup-battlefield').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.setup-battlefield').last().getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('.setup-battlefield').first().getAttribute('aria-pressed'), 'true');
  const sources = new Set();
  for (const [setting, title] of [['scene-01', 'Setting 1 Eclipse'], ['scene-02', 'Setting 2 Violet Night']]) {
    const choice = page.getByRole('button', { name: title, exact: true });
    await choice.focus(); await page.keyboard.press('f');
    assert.equal(await choice.getAttribute('aria-pressed'), 'true', 'remapped select activates the focused arena');
    assert.equal(await start.isEnabled(), true);
    await page.getByRole('button', { name: 'Arena view', exact: true }).click();
    sources.add((await preview(page, setting, 'arena')).src);
    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    sources.add((await preview(page, setting, 'board')).src);
  }
  assert.equal(sources.size, 4, 'both arenas have distinct arena and board game captures');
  assert.equal(await page.locator('.match-experience').count(), 0, 'browsing arenas/previews does not launch gameplay');
  assert.equal(await page.getByRole('combobox', { name: /graphics|quality/i }).count(), 0, 'graphics remain owned by Settings');
  await page.getByRole('button', { name: 'Arena view', exact: true }).focus();
  await pulseA(page);
  await page.waitForFunction(() => document.querySelector('.setup-back kbd')?.textContent?.trim() === '○');
  await page.evaluate(() => { window.__selectionPad.connected = false; window.dispatchEvent(new Event('gamepaddisconnected')); });
  await page.getByRole('button', { name: 'Board view', exact: true }).focus(); await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('.setup-back kbd')?.textContent?.trim() === 'V');
  await preview(page, 'scene-02', 'board');
  await page.screenshot({ path: `${output}/classic-selection-1280.png` });
  result.images.push('classic-selection-1280.png');
  await page.keyboard.press('v');
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
  pass('Both arenas offer real arena/board previews, explicit selection gates Start, remapped select/back work, and prompts follow PlayStation then keyboard input');

  await page.setViewportSize({ width: 844, height: 390 });
  await open(page, 'Local Duel');
  await page.getByRole('button', { name: 'Setting 2 Violet Night', exact: true }).click();
  assert.equal(await page.getByRole('radiogroup', { name: 'Computer strength', exact: true }).count(), 0);
  assert.equal(await page.getByRole('radiogroup', { name: 'Your side', exact: true }).count(), 0);
  await preview(page, 'scene-02', 'arena'); await layout(page, false);
  await page.screenshot({ path: `${output}/local-selection-844.png` });
  result.images.push('local-selection-844.png');
  await context.close();
  pass('Local Duel preserves truthful two-player options and Start/Back fit short landscape');

  const locales = [
    ['es', 'Clásico'], ['fr', 'Classique'], ['zh-CN', '经典对局'], ['ja', 'クラシック'], ['pcm', 'Classic'],
  ];
  for (const [locale, classic] of locales) {
    const { page, context } = await menu(locale);
    await open(page, classic);
    await page.locator('.setup-battlefield').nth(1).click();
    await page.locator('.setup-preview-controls button').nth(1).click();
    await preview(page, 'scene-02', 'board'); await layout(page, true);
    const labels = await page.locator('.setup-preview-controls button').allTextContents();
    assert.ok(labels.every(label => label.trim().length), 'localized view controls have names');
    if (locale !== 'pcm') assert.ok(!labels.includes('Arena view') && !labels.includes('Board view'), `${locale} preview controls are translated`);
    assert.equal(await page.locator('.setup-start').isEnabled(), true);
    result.locales.push({ locale, labels });
    await context.close();
  }
  pass('All six supported menu locales render usable arena selection and translated preview controls');
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = String(error.stack || error);
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(`${output}/verification.json`, JSON.stringify(result, null, 2));
  await browser.close();
}
if (!result.passed) throw Error(result.failure);
console.log(`Saved Play selection evidence to ${output}`);
