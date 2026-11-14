// The opening before a match's first move (src/play/MatchOpening.tsx, shared/play/match-opening.ts): that it plays its
// beats in order, holds the game while it does, can be skipped, is short on a rematch, and is off when it should be.
// A script-driven browser gets no opening unless the address asks for it with ?opening=match, as here.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const base = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true });
const errors = [], checks = [];
const record = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const seconds = (text) => { const [minutes, rest] = text.split(':'); return Number(minutes) * 60 + Number(rest); };

async function open(context, query) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?model=none${query}`);
  await waitForBootReady(page);
  await page.waitForFunction(() => document.querySelector('.menu-shell')?.dataset.bootState === 'ready', undefined, { timeout: 120000 });
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  return page;
}
const choose = async (page, group, name) => {
  const input = page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });
  const label = input.locator('xpath=ancestor::label[1]');
  await (await label.count() ? label : input).click();
};
/** Notes each beat of the opening on the page's own clock, with what the screen showed while it lasted: the words on
 * its card, and whether the match ever looked begun (ready, a move made, its controls on screen). */
const watch = (page) => page.evaluate(() => {
  const host = document.querySelector('.match-experience');
  window.__opening = []; window.__openingShown = null;
  const note = () => {
    const beat = host.getAttribute('data-match-opening'), text = host.querySelector('.match-opening')?.innerText ?? '';
    if (window.__openingShown === null && host.querySelector('.match-opening')) window.__openingShown = performance.now();
    let last = window.__opening[window.__opening.length - 1];
    if (!last || last.beat !== beat) window.__opening.push(last = { beat, at: performance.now(), ready: 'false', plies: '0', hud: false, text: '' });
    if (host.getAttribute('data-match-ready') === 'true') last.ready = 'true';
    if (host.getAttribute('data-match-plies') !== '0') last.plies = host.getAttribute('data-match-plies');
    if (host.querySelector('.match-hud')) last.hud = true;
    if (text.length > last.text.length) last.text = text;
  };
  note();
  new MutationObserver(note).observe(host, { attributes: true, subtree: true, childList: true });
});
const beatsOf = (page) => page.evaluate(() => window.__opening);
const matchReady = (page) => page.locator('.match-experience[data-match-ready="true"]').waitFor({ timeout: 300000 });

await mkdir('../artifacts/play', { recursive: true });
let failure;
try {
  // 1. A Local Duel from the setup: the whole opening, then a playable match whose clocks have not run.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  let page = await open(context, '&opening=match');
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  await choose(page, 'Match clock', '5 minutes each');
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience').waitFor();
  await watch(page);
  await page.locator('.match-experience .match-opening').waitFor({ timeout: 300000 });
  assert.equal(await page.locator('.match-experience .loading-screen').count(), 0, 'the loading screen is gone once the opening shows');
  assert.equal(await page.locator('.match-hud').count(), 0, 'no match controls during the opening');
  await page.screenshot({ path: '../artifacts/play/opening-arena.png' });
  await page.locator('.match-experience[data-match-opening="black"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1900);
  await page.screenshot({ path: '../artifacts/play/opening-kingdom.png' });
  await page.locator('.match-experience[data-match-opening="versus"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: '../artifacts/play/opening-versus.png' });
  await matchReady(page);
  const full = (await beatsOf(page)).filter((entry) => entry.beat !== 'none' || entry.ready === 'true');
  assert.deepEqual([...new Set(full.map((entry) => entry.beat))], ['arena', 'white', 'black', 'versus', 'begin', 'none']);
  const shown = full.filter((entry) => entry.beat !== 'none');
  assert.ok(shown.every((entry) => entry.ready === 'false' && entry.plies === '0' && !entry.hud), 'the match has not begun, and shows no controls, during the opening');
  const text = (beat) => shown.filter((entry) => entry.beat === beat).map((entry) => entry.text.toUpperCase()).join(' ');
  assert.match(text('arena'), /ECLIPSE/);
  assert.match(text('white'), /AETHELGARD/); assert.match(text('white'), /PLAYER 1/);
  assert.match(text('black'), /SOLFORIZ/); assert.match(text('black'), /PLAYER 2/);
  assert.match(text('versus'), /AETHELGARD[\s\S]*SOLFORIZ/);
  // Timed from when it could first be seen (it is held on its first frame under the loading screen until then). It
  // keeps real time, so a slow renderer does not stretch it much.
  const length = (full[full.length - 1].at - await page.evaluate(() => window.__openingShown)) / 1000;
  assert.ok(length > 9 && length < 20, `the whole opening took ${length.toFixed(1)}s`);
  // The clocks were held for all of it: both still show (all but) their five minutes as the match begins.
  const clocks = await page.locator('.match-clocks b').allInnerTexts();
  assert.equal(clocks.length, 2);
  assert.ok(clocks.every((clock) => seconds(clock) >= 298), `clocks after the opening: ${clocks.join(' / ')}`);
  await page.locator('canvas[aria-label="Crownfall chessboard"]').focus();
  for (const key of ['Enter', 'ArrowUp', 'ArrowUp', 'Enter']) await page.keyboard.press(key);
  await page.locator('.match-experience[data-match-plies="1"][data-match-busy="false"]').waitFor();
  record(`The whole opening plays arena, each kingdom, versus and the turn to the match (${length.toFixed(1)}s), holding the clocks, and leaves a playable Local Duel`);

  // 2. A rematch: only the two armies against each other and the turn to the match.
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.locator('.match-experience[data-match-ready="false"]').waitFor();
  await watch(page);
  await matchReady(page);
  const short = (await beatsOf(page)).filter((entry) => entry.beat !== 'none');
  assert.deepEqual([...new Set(short.map((entry) => entry.beat))], ['versus', 'begin']);
  record('A rematch plays the short opening: versus, then the turn to the match');

  // 3. Skipped with a key during the arena: the match is there at once.
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  await page.getByRole('button', { name: /Setting 2 Violet Night/ }).click();
  await choose(page, 'Your side', 'Second move');
  await choose(page, 'Computer strength', 'Easy');
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience').waitFor();
  await watch(page);
  await page.locator('.match-experience .match-opening').waitFor({ timeout: 300000 });
  assert.match((await page.locator('.match-opening').innerText()).toUpperCase(), /VIOLET NIGHT/);
  await page.waitForTimeout(700);
  // The computer has the first move, and the opening holds it.
  assert.equal(await page.locator('.match-experience').getAttribute('data-match-plies'), '0');
  const pressed = Date.now();
  await page.keyboard.press('Escape');
  await matchReady(page);
  const skipped = Date.now() - pressed;
  assert.ok(skipped < 2500, `skipping took ${skipped}ms`);
  assert.equal(await page.locator('.match-opening').count(), 0);
  assert.deepEqual([...new Set((await beatsOf(page)).filter((entry) => entry.beat !== 'none').map((entry) => entry.beat))], ['arena']);
  // Released, the computer (White here) makes the move it was holding.
  await page.locator('.match-experience:not([data-match-plies="0"])[data-match-busy="false"]').waitFor({ timeout: 60000 });
  record(`A key skips the opening (${skipped}ms to the match); Classic as the second mover gets the computer's first move only after it`);
  await context.close();

  // 4. Reduced motion: no opening, even when the address asks for one.
  const still = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  page = await open(still, '&opening=match');
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience').waitFor();
  await watch(page);
  await matchReady(page);
  assert.ok((await beatsOf(page)).every((entry) => entry.beat === 'none'), 'no opening with reduced motion');
  assert.equal(await page.locator('.match-opening').count(), 0);
  record('With reduced motion there is no opening and the match starts as before');
  await still.close();
  assert.deepEqual(errors, []);
} catch (error) { failure = error; }
finally {
  await writeFile('../artifacts/play/opening-verification.json', JSON.stringify({ passed: !failure, checks, errors, failure: failure?.stack }, null, 2));
  await browser.close();
}
if (failure) throw failure;
