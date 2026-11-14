import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';
import { installBoardProbe, verifyActualBoard, clickBoardSquare } from './board-helpers.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(45000);
const errors = [], checks = [], assets = new Set(), boards = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => { if (message.type() === 'error') console.log(`BROWSER ${message.text()}`); });
page.on('response', (r) => { if (/\/gameport\/scene-0[12]\/(arena|environment)\.exr$|\/gameport-look\/optimized\/scene-0[12]\/(arena|environment)\.glb$|\/gameport-look\/look\/board\/board\.glb$/.test(r.url())) { assert.equal(r.status(), 200, r.url()); assets.add(new URL(r.url()).pathname); } });
const record = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const chooseSetupRadio = async (group, name) => {
  const input = page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });
  const label = input.locator('xpath=ancestor::label[1]');
  await (await label.count() ? label : input).click();
  assert.equal(await input.isChecked(), true);
};
const ready = async (mode, setting) => {
  await Promise.race([
    page.locator(`.match-experience[data-match-ready="true"][data-match-mode="${mode}"][data-match-setting="${setting}"]`).waitFor({ timeout: 240000 }),
    page.locator('.match-experience .loading-screen[data-loading-state="degraded"]').waitFor({ timeout: 240000 }).then(async () => { throw new Error(await page.locator('.match-experience .loading-status-line').innerText()); }),
  ]);
  await page.locator('.match-experience[data-match-busy="false"]').waitFor();
};
const move = async (keys, plies) => {
  await page.locator('canvas[aria-label="Crownfall chessboard"]').focus();
  for (const key of keys) await page.keyboard.press(key);
  await page.locator(`.match-experience[data-match-plies="${plies}"][data-match-busy="false"]`).waitFor();
};
const leave = async () => {
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
};
await mkdir('../artifacts/play', { recursive: true });
let failure;
try {
  await page.goto(`${process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173'}/?model=none`);
  await waitForBootReady(page);
  await installBoardProbe(page);
  await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Start match', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  assert.equal(await page.locator('.match-experience').count(), 0);
  await chooseSetupRadio('Match clock', '5 minutes each');
  // Fail one real request to exercise the recovery UI, then retry normally.
  await page.route('**/gameport-look/optimized/scene-01/environment.glb', (route) => route.abort('failed'), { times: 1 });
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience .loading-screen[data-loading-state="degraded"]').waitFor({ timeout: 180000 });
  await page.getByRole('heading', { name: 'CROWNFALL', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back to setup', exact: true }).waitFor();
  await page.screenshot({ path: '../artifacts/play/loading-recovery.png' });
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  record('Crownfall branded loading screen exposes Retry and Back to setup after a failed asset request');
  assert.equal(await page.locator('.match-clocks').count(), 0, 'no running clocks during loading');
  await ready('hotseat', 'scene-01');
  boards.push({ setting: 'scene-01', ...await verifyActualBoard(page) });
  await page.locator('canvas[aria-label="Crownfall chessboard"]').focus();
  await page.keyboard.press('Enter'); // Select e2 without aiming through another animated character.
  await clickBoardSquare(page, 'e4');
  await page.locator('.match-experience[data-match-plies="1"][data-match-busy="false"]').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('.match-experience').getAttribute('data-match-plies'), '1', 'Local Duel waits for the second human');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); await clickBoardSquare(page, 'e5');
  await page.locator('.match-experience[data-match-plies="2"][data-match-busy="false"]').waitFor();
  await page.screenshot({ path: '../artifacts/play/local-scene-01.png' });
  record('Local Duel: 64 baked squares align, mouse plays e4, clocks start after loading, two humans play e4/e5');
  await leave();
  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  await page.getByRole('button', { name: /Setting 2 Violet Night/ }).click();
  await chooseSetupRadio('Computer strength', 'Easy');
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await ready('ai', 'scene-02');
  boards.push({ setting: 'scene-02', ...await verifyActualBoard(page) });
  await page.locator('canvas[aria-label="Crownfall chessboard"]').focus();
  await page.keyboard.press('Enter'); await clickBoardSquare(page, 'e4');
  await page.locator('.match-experience[data-match-plies="2"][data-match-busy="false"]').waitFor();
  await page.screenshot({ path: '../artifacts/play/classic-scene-02.png' });
  record('Classic: 64 baked squares align in Setting 2, mouse plays e4 and receives a legal computer reply');
  for (const setting of ['scene-01', 'scene-02']) for (const part of ['arena', 'environment']) {
    assert.ok(assets.has(`/gameport-look/optimized/${setting}/${part}.glb`), `loaded ${setting}/${part}.glb`);
    assert.ok(assets.has(`/gameport/${setting}/${part}.exr`), `loaded ${setting}/${part}.exr`);
  }
  assert.ok(assets.has('/gameport-look/look/board/board.glb'), 'loaded the baked board');
  await leave();
  record('All eight real asset files and the baked board return HTTP 200; both matches return to the current Play menu');
  // Optional board failures must not prevent a match from starting.
  await page.route('**/gameport-look/look/board/board.glb', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await ready('hotseat', 'scene-01');
  await page.locator('[data-battlefield-stats][data-board-model="procedural"]').waitFor({ state: 'attached' });
  await move(['Enter', 'ArrowUp', 'ArrowUp', 'Enter'], 1);
  await page.screenshot({ path: '../artifacts/play/board-fallback.png' });
  await leave();
  record('A missing board GLB keeps the procedural board and a playable match');
  assert.deepEqual(errors, []);
} catch (error) { failure = error; await page.screenshot({ path: '../artifacts/play/board-test-failure.png' }).catch(() => {}); }
finally {
  await writeFile('../artifacts/play/verification.json', JSON.stringify({ passed: !failure, checks, boards, errors, assets: [...assets], failure: failure?.stack }, null, 2));
  await browser.close();
}
if (failure) throw failure;
