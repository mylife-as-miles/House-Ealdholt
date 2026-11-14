import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = resolve('artifacts/chronicles-book');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const captureVideo = process.env.CROWNFALL_CAPTURE_VIDEO === '1';
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference', ...(captureVideo ? { recordVideo: { dir: resolve(output, 'video'), size: { width: 1280, height: 800 } } } : {}) });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(15000);
const check = (name, detail = true) => { checks.push({ name, detail }); console.log(`PASS ${name}`); };
const stage = () => page.locator('.chronicles-stage');
const state = () => stage().evaluate(element => ({ ...element.dataset }));
const wait = phase => page.waitForSelector(`.chronicles-stage[data-book-state="${phase}"]`, { timeout: 30000 });
try {
  await page.addInitScript(() => {
    window.bookSamples = [];
    new MutationObserver(() => {
      const element = document.querySelector('.chronicles-stage');
      if (element && window.bookSamples.length < 5000) window.bookSamples.push({ ...element.dataset, time: performance.now() });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-book-progress'] });
  });
  await page.goto(process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.menu-shell[data-boot-state="ready"]', { timeout: 60000 });
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Chronicles', exact: true }).click();
  await wait('open');
  const samples = await page.evaluate(() => window.bookSamples);
  assert.ok(samples.some(s => +s.bookProgress > .15 && +s.bookProgress < .85));
  assert.ok(samples.some(s => +s.bookCurl > .02));
  const lift10 = samples.find(s => +s.bookProgress >= .1 && +s.bookProgress < .9);
  const lift90 = samples.find(s => +s.bookProgress >= .9);
  assert.ok(lift10 && lift90 && lift90.time - lift10.time >= 700, 'opening must lift visibly instead of snapping');
  assert.equal((await state()).bookProgress, '1.0000');
  check('opening lifts slowly, crosses real hinge angles, flexes and settles', { mainLiftMs: Math.round(lift90.time - lift10.time) });
  await page.screenshot({ path: resolve(output, 'open-verified.png') });

  const toggle = page.getByRole('button', { name: 'Open and close book' });
  await toggle.click(); await wait('closed');
  assert.equal((await state()).bookProgress, '0.0000');
  assert.ok(Math.abs(+(await state()).bookCenterX - 640) < 12, 'closed book is centred');
  assert.equal(await page.locator('.chronicles-marker').first().isVisible(), false);
  await page.screenshot({ path: resolve(output, 'closed-verified.png') });
  check('bound cover closes fully and hides gameplay markers');
  await toggle.focus(); await page.keyboard.press('Enter'); await wait('open');
  check('keyboard opens the book control');

  const box = await page.locator('.chronicles-stage-canvas').boundingBox(), data = await state();
  assert.ok(box);
  const x = box.x + +data.bookCornerX, y = box.y + +data.bookCornerY;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + box.width * .21, y - 10, { steps: 12 });
  await wait('dragging');
  const held = await state();
  assert.ok(+held.bookProgress > .4 && +held.bookProgress < .65);
  assert.ok(Math.abs(+held.bookCenterX - 640) < 24, 'partially open book stays centred');
  await page.screenshot({ path: resolve(output, 'held-flip-verified.png') });
  await page.mouse.move(x + box.width * .08, y - 10, { steps: 8 }); await page.mouse.up();
  await wait('open');
  check('pointer can hold a partial flip and reverse it on release');

  await page.getByRole('button', { name: 'Korvenia — The Grand Duchy', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.chronicles-screen[data-entry="korvenia"]');
  assert.match(await page.locator('#chronicles-record').textContent(), /Veiled Archduke/);
  await page.keyboard.press('Escape'); await page.waitForSelector('.chronicles-screen[data-entry=""]'); await page.keyboard.press('Escape');
  await page.waitForSelector('.chronicles-screen[data-focus="overview"]');
  check('original map selection, approved records and Back hierarchy remain usable');
  await page.getByRole('tab', { name: 'The Interregnum', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'The Interregnum' }).waitFor();
  await page.getByRole('tab', { name: 'The Atlas', exact: true }).click();
  check('existing archive collections remain accessible');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForSelector('.chronicles-screen--still');
  await toggle.click(); await wait('closed'); await toggle.click(); await wait('open');
  assert.equal((await state()).bookCurl, '0.0000');
  check('reduced motion snaps covers and leaves without residual curl');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: resolve(output, 'landscape-verified.png') });
  const buttonBox = await toggle.boundingBox();
  assert.ok(buttonBox && buttonBox.x >= 0 && buttonBox.y >= 0 && buttonBox.x + buttonBox.width <= 844 && buttonBox.y + buttonBox.height <= 390);
  check('book control stays reachable in short landscape');
  assert.deepEqual(errors, []); check('no page or shader errors');
  let video;
  if (captureVideo) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForSelector('.chronicles-screen:not(.chronicles-screen--still)');
    const start = Date.now();
    await toggle.click(); await wait('closed'); await page.screenshot({ path: resolve(output, 'closed-centred-final.png') });
    await toggle.click(); await wait('open'); await page.screenshot({ path: resolve(output, 'open-centred-final.png') });
    video = { raw: await page.video().path(), tailSeconds: (Date.now() - start) / 1000 + .4 };
  }
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ checks, errors, final: await state(), video }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.message, errors, state: await state().catch(() => null), samples: await page.evaluate(() => window.bookSamples || []).catch(() => []) }, null, 2));
  throw error;
} finally { await browser.close(); }
