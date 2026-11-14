import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';
import { grid, categoryName } from './settings-helpers.mjs';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifacts/pull-8089448'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const checks = [], errors = [];
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const target = `${process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173'}/?model=none`;
async function context(extra = {}) {
  const result = await browser.newContext({ viewport: { width: 1600, height: 700 } });
  await result.addInitScript(preferences => {
    localStorage.setItem('crownfall.main-game.preferences', JSON.stringify(preferences));
    window.__activated = false; window.__pad = [];
    window.addEventListener('pointerdown', () => { window.__activated = true; }, true);
    window.addEventListener('keydown', () => { window.__activated = true; }, true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !window.__activated) return Promise.reject(new DOMException('A visitor has not interacted', 'NotAllowedError'));
      return play.call(this);
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
      const pressed = window.__pad;
      return pressed ? [{ index: 0, id: 'Test standard controller', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 })) }] : [];
    } });
  }, { quality: 'low', volume: 80, musicVolume: 50, music: true, motion: true, fullscreen: false, ...extra });
  return result;
}
async function pageFor(ctx) {
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message)); return page;
}
const movie = page => page.locator('.opening-film video');
const phase = (page, value) => page.locator(`.opening-film[data-opening-film="${value}"]`).waitFor();
async function playing(page) { await phase(page, 'playing'); await page.waitForFunction(() => { const v = document.querySelector('.opening-film video'); return v && !v.paused && v.currentTime > .05; }); }
async function pad(page, index) { await page.evaluate(i => { window.__pad = [i]; }, index); await page.waitForTimeout(350); await page.evaluate(() => { window.__pad = []; }); await page.waitForTimeout(350); }
let failure;
try {
  const ctx = await context(), page = await pageFor(ctx);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/video/crownfall-opening.mp4', async route => { await gate; await route.continue(); });
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.locator('.opening-film .launch-artwork').waitFor();
  assert.equal(await page.locator('.launch-artwork h1').last().innerText(), 'Crownfall: Aethelgard');
  assert.ok((await page.locator('.launch-artwork img').last().getAttribute('src')).endsWith('assets/launch/cinematic-v2/splash.webp'));
  assert.equal(await page.locator('.loading-title, .boot-brand, .opening-film-prompt').count(), 0);
  await page.locator('.launch-artwork img').last().evaluate(img => img.decode());
  for (const size of [{ width: 1920, height: 1080 }, { width: 1600, height: 700 }, { width: 844, height: 390 }, { width: 800, height: 1000 }]) {
    await page.setViewportSize(size);
    const art = await page.locator('.launch-artwork img').last().evaluate(img => {
      const r = img.getBoundingClientRect();
      return { fit: getComputedStyle(img).objectFit, width: r.width, height: r.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
    });
    assert.equal(art.fit, 'contain');
    assert.equal(art.width, size.width); assert.equal(art.height, size.height);
    assert.ok(art.naturalWidth >= 1600 && art.naturalHeight >= 900);
    assert.equal(await page.locator('.launch-artwork-title').last().evaluate(title => getComputedStyle(title).clipPath), 'inset(50%)');
    await page.screenshot({ path: `${output}/cinematic-launch-${size.width}x${size.height}.png` });
  }
  await page.setViewportSize({ width: 1600, height: 700 });
  check('cinematic title artwork covers the full download with no duplicated text or cropping at four screen sizes');
  release(); await playing(page);
  assert.equal(await page.title(), 'Crownfall: Aethelgard');
  assert.equal(await page.locator('.opening-film-begin').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Enable sound', exact: true }).count(), 0);
  assert.equal(await movie(page).evaluate(v => v.muted), true);
  assert.equal(await movie(page).evaluate(async v => (await (await fetch(v.currentSrc)).blob()).size), 27606154);
  check('the complete first-start film autoplays without a key press or a sound option when audible autoplay is refused');
  await page.getByRole('button', { name: 'Pause', exact: true }).click(); await phase(page, 'paused');
  assert.equal(await movie(page).evaluate(v => v.paused), true);
  await page.getByRole('button', { name: 'Resume', exact: true }).click(); await playing(page);
  assert.equal(await movie(page).evaluate(v => v.muted), false);
  check('clickable Pause and Resume work, and a normal interaction restores audio');
  for (const size of [{ width: 1600, height: 700 }, { width: 844, height: 390 }, { width: 800, height: 1000 }]) {
    await page.setViewportSize(size);
    const fit = await movie(page).evaluate(v => { const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, fit: getComputedStyle(v).objectFit, viewport: [innerWidth, innerHeight] }; });
    assert.equal(fit.fit, 'contain'); assert.equal(fit.x, 0); assert.equal(fit.y, 0);
    assert.ok(Math.abs(fit.width - size.width) < 2 && Math.abs(fit.height - size.height) < 2);
  }
  await page.screenshot({ path: `${output}/intro-portrait.png` });
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.screenshot({ path: `${output}/intro-wide.png` });
  check('wide, short landscape and portrait windows show the entire contained video frame');
  await pad(page, 0); await phase(page, 'paused');
  await pad(page, 0); await playing(page);
  await pad(page, 1); await page.locator('.opening-film').waitFor({ state: 'detached' });
  await waitForBootReady(page);
  check('standard gamepad A pauses/resumes and B skips to the menu');
  await page.reload(); await playing(page);
  assert.equal(await page.locator('.opening-film').getAttribute('data-opening-cut'), 'short');
  await page.getByRole('button', { name: 'Skip', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.locator('.opening-film').waitFor({ state: 'detached' });
  check('the returning title sequence autoplays, and Enter on the Skip button skips instead of pausing');
  await ctx.close();

  const full = await context({ fullscreen: true }), screen = await pageFor(full);
  await screen.goto(target); await playing(screen);
  await screen.getByRole('button', { name: 'Pause', exact: true }).click();
  await screen.waitForFunction(() => !!document.fullscreenElement);
  await screen.getByRole('button', { name: 'Skip', exact: true }).click(); await waitForBootReady(screen);
  await screen.getByRole('tab', { name: 'Settings', exact: true }).click(); await waitForMenuIdle(screen);
  await grid(screen).getByRole('button', { name: categoryName('Video') }).click();
  await screen.getByRole('button', { name: 'Change window mode', exact: true }).click();
  await screen.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await screen.evaluate(() => JSON.parse(localStorage.getItem('crownfall.main-game.preferences')).fullscreen), false);
  check('fullscreen is requested by default on the first gesture and Settings can switch it off persistently');
  await full.close();
  const degraded = await context(), fallback = await pageFor(degraded);
  await degraded.addInitScript(() => localStorage.setItem('crownfall.opening.seen', 'true'));
  await fallback.route('**/assets/environments/card-load-1600.webp', route => route.fulfill({ status: 404, body: 'Expected optional artwork failure' }));
  await fallback.goto(target); await playing(fallback);
  await movie(fallback).evaluate(video => { video.currentTime = video.duration - .2; });
  await fallback.locator('.opening-film').waitFor({ state: 'detached' });
  await fallback.waitForFunction(() => document.querySelector('.menu-shell')?.getAttribute('data-boot-state') === 'ready');
  assert.equal(await fallback.locator('.launch-artwork, .launch-continue').count(), 0);
  assert.equal(await fallback.locator('.menu-content').evaluate(element => element.inert), false);
  check('the startup film ends directly in the main menu even if optional artwork failed, with no second splash or Continue gate');
  await degraded.close();
  assert.deepEqual(errors, []); check('no JavaScript page errors');
} catch (error) { failure = error; console.error(error); }
finally { await writeFile(`${output}/launch-verification.json`, JSON.stringify({ passed: !failure, checks, errors, failure: failure?.stack }, null, 2)); await browser.close(); }
if (failure) process.exitCode = 1;
