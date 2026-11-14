import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';

const base = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const out = resolve('artifacts/story-cinematic');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const motion = process.env.CROWNFALL_STORY_MOTION === '1';
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
await context.addInitScript(motion => {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion, fullscreen: false }));
  if (motion) localStorage.setItem('crownfall.opening.seen', 'true');
  window.__songStarts = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    if (this.tagName === 'AUDIO') window.__songStarts.push({ element: this, src: this.currentSrc || this.src, time: this.currentTime });
    return play.call(this);
  };
}, motion);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [], errors = [], requests = [];
const progressKey = 'crownfall.story.progress.v1';
page.on('pageerror', e => errors.push(e.message));
page.on('request', request => { if (request.url().includes('crownfall-prologue.mp4')) requests.push(request.resourceType()); });
const pass = message => { checks.push(message); console.log('PASS ' + message); };
const film = page.locator('.opening-film[data-opening-cut="prologue"]');
const chapter = id => page.locator(`[data-chapter-id="${id}"]`);
const intro = page.locator('dialog[open][data-panel="chapter-preview"]');
async function comingSoon() {
  await film.waitFor({ state: 'detached' });
  await intro.waitFor();
  assert.match(await intro.innerText(), /The Pawn Who Would Not Die/);
  assert.match(await intro.innerText(), /Coming soon/i);
  assert.equal(await chapter('chapter-01').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.launch-artwork').count(), 0);
  assert.equal(await chapter('chapter-02').getAttribute('aria-disabled'), 'true');
}
let release;
const held = new Promise(resolve => { release = resolve; });
await page.route('**/video/crownfall-prologue.mp4', async route => { await held; await route.continue(); });
let failure;
try {
  await page.goto(base + '/?model=none');
  await waitForBootReady(page);
  const startupMarker = await page.evaluate(() => localStorage.getItem('crownfall.opening.seen'));
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await waitForMenuIdle(page);
  assert.equal(await chapter('chapter-01').getAttribute('aria-disabled'), 'true', 'Chapter One starts locked until the Prologue is watched');
  assert.equal(await chapter('chapter-01').locator('.chapter-availability').count(), 0);
  assert.equal(await chapter('chapter-01').locator('.chapter-lock').count(), 1);
  await chapter('chapter-01').click({ force: true });
  assert.equal(await intro.count(), 0);
  assert.match(await page.locator('.chapters-screen [role="status"]').innerText(), /Watch the Prologue to unlock Chapter One/);
  await page.screenshot({ path: out + '/chapters-before-prologue.png' });
  await page.waitForFunction(() => document.querySelector('.menu-shell')?.getAttribute('data-audio-music-playing') === 'true');
  const songBefore = await page.locator('.menu-shell').getAttribute('data-audio-track');
  const sequenceBefore = Number(await page.locator('.menu-shell').getAttribute('data-audio-track-sequence'));
  await page.evaluate(() => { window.__songStarts.at(-1).element.currentTime = 17; });
  await chapter('prologue').click();
  await film.waitFor();
  assert.equal(await film.locator('.launch-artwork').count(), 0, 'a story cinematic must never display the launch splash, even while the video buffers');
  assert.equal(await film.getByRole('button').count(), 1);
  await film.getByRole('button', { name: 'Skip cinematic', exact: true }).waitFor();
  assert.equal(await page.locator('.opening-film-begin').count(), 0);
  await page.screenshot({ path: out + '/buffering-no-splash.png' });
  pass('Prologue enters its own cinematic directly, with only Skip cinematic and no launch artwork or Begin gate');
  release();
  await page.waitForFunction(() => { const v = document.querySelector('.opening-film video'); return v && !v.paused && v.currentTime > .05; });
  assert.ok(requests.includes('media'), 'the prologue streams as video instead of waiting for a complete blob download');
  assert.ok(!(await film.locator('video').getAttribute('src')).startsWith('blob:'));
  assert.equal(await chapter('chapter-01').getAttribute('aria-disabled'), 'true');
  await film.getByRole('button', { name: 'Skip cinematic', exact: true }).click();
  await film.waitFor({ state: 'detached' });
  assert.equal(await intro.count(), 0);
  assert.equal(await chapter('chapter-01').getAttribute('aria-disabled'), 'true');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), progressKey), null);
  pass('skipping an unwatched Prologue keeps Chapter One locked and writes no completion');
  await page.waitForFunction(({ track, sequence }) => {
    const root = document.querySelector('.menu-shell');
    return root?.getAttribute('data-audio-music-playing') === 'true' && root.getAttribute('data-audio-track') !== track
      && Number(root.getAttribute('data-audio-track-sequence')) > sequence;
  }, { track: songBefore, sequence: sequenceBefore });
  assert.equal(await page.evaluate(() => window.__songStarts.at(-1).time), 0);
  pass('returning from the Prologue starts a different real soundtrack track at zero without manual resume');

  await chapter('prologue').click();
  await page.waitForFunction(() => { const v = document.querySelector('.opening-film video'); return v && !v.paused && v.currentTime > .05; });

  await page.screenshot({ path: out + '/prologue-playing.png' });
  pass('the real prologue streams and plays automatically from its chapter click');
  await film.locator('video').evaluate(video => { video.currentTime = video.duration - .2; });
  await comingSoon();
  const reveal = await intro.evaluate(root => ({
    animation: getComputedStyle(root.querySelector('#dialog-note')).animationName,
    art: getComputedStyle(root.querySelector('.chapter-introduction-art')).backgroundImage,
  }));
  assert.equal(reveal.animation, motion ? 'chapter-milestone' : 'none');
  assert.match(reveal.art, /\.webp/);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#dialog-note')).opacity) > .95);
  await page.screenshot({ path: out + '/chapter-one-coming-soon.png' });
  pass('a natural end introduces Chapter One, The Pawn Who Would Not Die, with Coming soon');
  assert.equal(await intro.locator('[data-new-unlock]').count(), 1);
  assert.equal(await chapter('chapter-01').getAttribute('aria-disabled'), 'false');
  await page.keyboard.press('Escape');
  await chapter('prologue').click();
  await film.getByRole('button', { name: 'Skip cinematic', exact: true }).click();
  await film.waitFor({ state: 'detached' });
  assert.equal(await intro.count(), 0, 'skipping a replay returns to selection without a new completion ceremony');
  await chapter('chapter-01').click();
  await intro.waitFor();
  assert.match(await intro.innerText(), /Coming soon/i);
  await page.keyboard.press('Escape');
  const locked = await page.locator('.chapter-tile[data-chapter-id^="chapter-"]').evaluateAll(tiles => tiles.filter(t => t.dataset.chapterId !== 'chapter-01').every(t => t.getAttribute('aria-disabled') === 'true'));
  assert.equal(locked, true);
  await chapter('chapter-02').click({ force: true });
  assert.equal(await intro.count(), 0);
  assert.equal(await page.locator('.match-experience').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('crownfall.opening.seen')), startupMarker);
  pass('a completed Prologue leaves Chapter One available; later chapters stay locked, with no game launch or startup-history write');
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).prologue.state, progressKey), 'completed');
  await page.reload(); await waitForBootReady(page);
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  assert.equal(await chapter('chapter-01').getAttribute('aria-disabled'), 'false');
  assert.equal(await chapter('chapter-01').locator('.chapter-availability').count(), 1);
  assert.equal(await chapter('chapter-02').getAttribute('aria-disabled'), 'true');
  pass('completion survives a page reload and rehydrates only Chapter One as Coming soon');
  await page.route('**/video/crownfall-prologue.mp4', route => route.fulfill({ status: 404, body: 'Expected media failure' }));
  const failedMedia = page.waitForResponse(response => response.url().includes('crownfall-prologue.mp4') && response.status() === 404);
  await chapter('prologue').click(); await failedMedia;
  await film.waitFor({ state: 'detached' });
  assert.equal(await intro.count(), 0);
  assert.equal(await chapter('prologue').getAttribute('aria-pressed'), 'true');
  pass('a failed media load returns to Prologue without showing a launch splash or introducing an unwatched chapter');
  assert.deepEqual(errors, []);
} catch (e) { failure = e; await page.screenshot({ path: out + '/failure.png' }).catch(() => {}); console.error(e); }
finally {
  release();
  await writeFile(out + '/verification.json', JSON.stringify({ passed: !failure, checks, errors, failure: failure?.stack }, null, 2));
  await browser.close();
}
if (failure) process.exitCode = 1;
