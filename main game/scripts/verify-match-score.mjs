// The score's edges in a real match (a Local Duel): the Theme opens it 1.2 s after the match's opening hands over to the
// board (its last beat; the bell, where there is no opening); a move taken back
// to the first position (Undo) leaves the cue playing (the Theme) untouched; a resignation lands the closing cue at once while the loops
// step aside (a duel's decisive end is a victory); a new game from the result opens with the Theme again and the
// closing cue gone; and leaving the match leaves nothing of the score playing.
// The mixer is exposed by rewriting one line of audioManager.ts in flight; nothing in the repository changes.
// Run against the desktop dev server, from main game/:
//   CROWNFALL_TEST_URL=http://127.0.0.1:5173 CHROMIUM_PATH=/usr/bin/google-chrome node scripts/verify-match-score.mjs
// Writes ../artifacts/match-score/verification.json.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const BASE = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const out = '../artifacts/match-score';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [], checks = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
const record = (message, detail) => { checks.push({ message, detail }); console.log(`PASS ${message} ${detail ? JSON.stringify(detail) : ''}`); };
// A timing that misses is noted and the run goes on, so one late cue does not hide how the other edges behave.
const failures = [];
const soft = (ok, message) => { if (!ok) { failures.push(message); console.log(`FAIL ${message}`); } return ok; };
await page.route('**/audio/audioManager.ts*', async (route) => {
  const response = await route.fetch();
  const body = (await response.text()).replace('export const audio = new AudioManager();', 'export const audio = new AudioManager(); globalThis.__cfAudio = audio;');
  await route.fulfill({ response, body });
});
await page.addInitScript(() => {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: true, volume: 65 }));
  localStorage.setItem('crownfall.opening.seen', 'true');
  window.__played = [];
  const urlOf = new WeakMap(), bufferUrl = new WeakMap();
  const fetch0 = window.fetch;
  window.fetch = async (...args) => {
    const response = await fetch0(...args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (/\/(gambit|score)\/[^/]+\.mp3/.test(url)) { const read = response.arrayBuffer.bind(response); response.arrayBuffer = async () => { const d = await read(); bufferUrl.set(d, url); return d; }; }
    return response;
  };
  const decode0 = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) { const url = bufferUrl.get(data); return decode0.call(this, data, ...rest).then((b) => { if (url) urlOf.set(b, url); return b; }); };
  const start0 = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, offset, duration) {
    const url = this.buffer && urlOf.get(this.buffer);
    if (url) window.__played.push({ clip: (url.split('/').pop().match(/^([a-z0-9_]+?)(?:-[A-Za-z0-9_-]{8})?\.mp3/) || [])[1], at: Math.max(this.context.currentTime, when), now: this.context.currentTime, loop: this.loop });
    return start0.call(this, when, offset, duration);
  };
});
const state = () => page.evaluate(() => { const a = globalThis.__cfAudio; return a ? { ...a.scoreState, now: a.ctx?.currentTime ?? null } : null; });
const played = () => page.evaluate(() => window.__played);
let failure;
try {
  await page.goto(`${BASE}/?model=none`);
  await waitForBootReady(page);
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  // The match's opening (MatchOpening) is heard beat by beat through the mixer; each beat and its end are logged on the
  // audio clock, since the Theme waits for its last beat (or for its end, if it is cut short).
  await page.waitForFunction(() => !!globalThis.__cfAudio, null, { timeout: 120000 }).catch(() => undefined);
  await page.evaluate(() => {
    const a = globalThis.__cfAudio;
    if (!a || a.__logged) return;
    a.__logged = true; window.__opening = [];
    for (const name of ['prepareOpening', 'openingCue', 'stopOpening']) {
      const f = a[name].bind(a);
      a[name] = (...args) => { window.__opening.push({ name, arg: name === 'prepareOpening' ? args[0].map((b) => b.id) : args[0], at: a.ctx?.currentTime ?? null }); return f(...args); };
    }
  }).catch(() => undefined);
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience[data-match-ready="true"][data-match-mode="hotseat"]').waitFor({ timeout: 600000 });
  await page.locator('.match-experience[data-match-opening="none"]').waitFor({ timeout: 600000 });
  await page.locator('.match-experience[data-match-busy="false"]').waitFor({ timeout: 300000 });
  await page.waitForTimeout(4000);
  // The Theme starts once it is decoded: on time where the page can decode it while the board loads.
  await page.waitForFunction(() => window.__played.some((r) => r.clip === 'score_theme'), null, { timeout: 180000 });
  let rows = await played();
  const toll = rows.find((r) => r.clip === 'start_toll');
  const theme = rows.find((r) => r.clip === 'score_theme');
  assert.ok(theme, `the Theme opens the match: ${rows.map((r) => r.clip)}`);
  // Its cue: the opening's last beat (begin), or the opening's end if it was cut short; with no opening, the bell.
  const opening = await page.evaluate(() => window.__opening ?? []);
  const beats = opening.find((o) => o.name === 'prepareOpening')?.arg ?? null;
  const last = beats ? opening.find((o) => o.name === 'openingCue' && o.arg === Math.max(0, beats.indexOf('begin') >= 0 ? beats.indexOf('begin') : beats.length - 1)) : null;
  const stop = opening.find((o) => o.name === 'stopOpening');
  const anchor = beats ? (last && (!stop || last.at <= stop.at) ? { what: 'the opening\'s last beat', at: last.at } : { what: 'the opening\'s end', at: stop?.at }) : { what: 'the opening bell', at: toll?.at };
  const themeAfter = anchor.at != null ? +(theme.at - anchor.at).toFixed(3) : null;
  if (soft(themeAfter !== null && themeAfter > 1.0 && themeAfter < 1.6, `the Theme comes in 1.2 s after ${anchor.what} (${themeAfter} s; scheduled as its decode finished, ${anchor.at != null ? (theme.now - anchor.at).toFixed(1) : '?'} s after it)`)) {
    record(`Local Duel: the Theme opens the match, 1.2 s after ${anchor.what}`, { after: themeAfter, beats });
  }
  await page.waitForTimeout(1000);
  let s = await state();
  assert.equal(s.cue, 'theme', `the score is on the Theme: ${JSON.stringify(s)}`);
  record('Local Duel: the Theme opens the match', { cue: s.cue, decoded: s.decoded });
  // One move (1. e4), taken back: the board is at its first position again and the cue playing plays on, untouched (the
  // Theme, unless the move took longer than the Theme here: at this frame rate a move can take minutes).
  const board = page.locator('canvas[aria-label="Crownfall chessboard"]');
  await board.focus();
  for (const key of ['Enter', 'ArrowUp', 'ArrowUp', 'Enter']) await page.keyboard.press(key);
  await page.locator('.match-experience[data-match-plies="1"][data-match-busy="false"]').waitFor({ timeout: 300000 });
  const beforeUndo = await state();
  let mark = (await played()).length;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.match-experience[data-match-plies="0"][data-match-busy="false"]').waitFor({ timeout: 120000 });
  await page.waitForTimeout(3000);
  s = await state();
  const restarted = (await played()).slice(mark).filter((r) => r.clip?.startsWith('score_'));
  assert.ok(beforeUndo.cue, `a cue is playing before the Undo: ${JSON.stringify(beforeUndo)}`);
  assert.equal(s.cue, beforeUndo.cue, `Undo to the first position leaves the cue playing (${beforeUndo.cue}): ${JSON.stringify(s)}`);
  assert.deepEqual(restarted.map((r) => r.clip), [], 'and starts nothing of the score anew');
  record('Undo back to the first position: the cue playing plays on, and nothing of the score starts anew', { cueBefore: beforeUndo.cue, cue: s.cue, takes: s.takes });
  // Resign: the loops step aside, and the closing cue is placed for the downfall's results (or at once, without one).
  const before = (await played()).length;
  await page.getByRole('button', { name: 'Resign', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction((from) => window.__played.slice(from).some((r) => r.clip === 'score_victory'), before, { timeout: 180000 });
  rows = (await played()).slice(before);
  const closing = rows.find((r) => r.clip === 'score_victory');
  assert.ok(!rows.some((r) => /^sting_/.test(r.clip)), 'not the old one');
  s = await state();
  assert.equal(s.cue, null, `no loop is left playing under it: ${JSON.stringify(s)}`);
  assert.equal(s.sting, true, 'the closing cue is placed');
  record('Resign: the loops step aside and the closing cue is placed (for the downfall\'s results, where one is staged)', { scheduledAhead: +(closing.at - closing.now).toFixed(3), state: { cue: s.cue, takes: s.takes } });
  // The downfall is frame-clocked, and slow at this frame rate: its Skip takes it to the result.
  const skip = page.getByRole('button', { name: 'Skip ending' });
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => undefined);
  await page.locator('.match-result').waitFor({ timeout: 300000 });
  // A new game from the result: the Theme opens it again, and the closing cue gives way.
  mark = (await played()).length;
  await page.getByRole('button', { name: 'Play again', exact: true }).click();
  // The new game has begun when its opening bell rings.
  await page.waitForFunction((from) => window.__played.slice(from).some((r) => r.clip === 'start_toll'), mark, { timeout: 600000 });
  await page.locator('.match-experience[data-match-ready="true"][data-match-busy="false"]').waitFor({ timeout: 300000 });
  await page.waitForTimeout(4000);
  rows = (await played()).slice(mark);
  s = await state();
  assert.ok(rows.some((r) => r.clip === 'score_theme'), `the new game opens with the Theme again: ${rows.map((r) => r.clip)}`);
  assert.ok(s.cue === 'theme' && !s.sting, `on the Theme, the closing cue gone: ${JSON.stringify(s)}`);
  record('Play again: the new game opens with the Theme, and the closing cue has given way', { cue: s.cue, sting: s.sting });
  // Leave the match: nothing of the score is left playing, and nothing new starts
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForTimeout(1500);
  const left = (await played()).length;
  s = await state();
  assert.ok(s && s.takes === 0 && !s.sting, `nothing of the score is left after leaving: ${JSON.stringify(s)}`);
  await page.waitForTimeout(6000);
  const after = (await played()).slice(left).filter((r) => r.clip?.startsWith('score_'));
  assert.deepEqual(after, [], 'and nothing of it starts afterwards');
  record('Leaving the match: nothing of the score is left playing, and nothing starts afterwards', { takes: s.takes, sting: s.sting });
  assert.deepEqual(errors, []);
  record('No page or console errors');
  if (failures.length) throw new Error(`missed: ${failures.join('; ')}`);
} catch (error) { failure = error; }
finally {
  await writeFile(`${out}/verification.json`, JSON.stringify({ passed: !failure, checks, failures, errors, failure: failure?.stack, played: await played().catch(() => []) }, null, 1));
  await browser.close();
}
if (failure) throw failure;
console.log(`${checks.length} checks passed`);
