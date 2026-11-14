// Focused setup verification. Real app captures/navigation are separate from
// the component-boundary onStart checks; neither certifies headset behavior.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const base = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const out = resolve(process.env.CROWNFALL_SETUP_ARTIFACTS || 'artifacts/play/setup');
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirtyFiles = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { passed: false, commit, dirtyFiles, untrackedFiles, componentOnly: process.env.CROWNFALL_SETUP_COMPONENT_ONLY === '1', checks: [], captures: [], componentConfigCases: 0, errors: [], limits: 'Desktop Chromium with software rendering. Controller and touch are browser input emulation. The isolated component checks observe MatchSetup onStart; they do not prove game launch, gameplay or physical Quest behavior.' };
await mkdir(out, { recursive: true });
let currentPage;
const observe = page => {
  currentPage = page;
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
};
const pass = message => { report.checks.push(message); console.log(`PASS ${message}`); };
const group = (page, label) => page.getByRole('radiogroup', { name: label, exact: true });
const radio = (page, label, choice) => group(page, label).getByRole('radio', { name: choice, exact: true });
const clockLabel = minutes => minutes === null ? 'No clock' : `${minutes} minutes each`;
async function choose(page, label, choice, touch = false) {
  const input = radio(page, label, choice);
  if (!await input.isChecked()) {
    const wrapper = input.locator('xpath=ancestor::label[1]');
    const target = await wrapper.count() ? wrapper : input;
    if (touch) await target.tap(); else await target.click();
  }
  assert.equal(await input.isChecked(), true, `${label}: ${choice} is selected`);
}
async function openSetup(page, mode) {
  await page.getByRole('button', { name: mode === 'classic' ? 'Classic' : 'Local Duel', exact: true }).click();
  await page.getByRole('region', { name: mode === 'classic' ? 'Classic setup' : 'Local Duel setup', exact: true }).waitFor();
}
async function back(page) {
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
}
async function settled(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.locator('.match-setup img').evaluateAll(async images => {
    for (const image of images) if (!image.complete) await image.decode();
  });
  if (process.env.CROWNFALL_SETUP_REQUIRE_PREVIEWS !== '0') {
    const urls = await page.locator('.setup-battlefield-art').evaluateAll(elements => elements.map(el => /^url\([\"']?(.*?)[\"']?\)$/.exec(getComputedStyle(el).backgroundImage)?.[1]).filter(Boolean));
    assert.equal(urls.length, 2, 'both battlefield choices have source preview images');
    await page.evaluate(async urls => { for (const url of urls) { const image = new Image(); image.src = url; await image.decode(); if (!image.naturalWidth || !image.naturalHeight) throw Error('Battlefield preview did not decode: '+url); } }, urls);
  }
}
async function fit(page) {
  const result = await page.locator('.match-setup').evaluate(root => ({
    viewport: [innerWidth, innerHeight],
    document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    root: [root.scrollWidth, root.clientWidth],
    horizontalControls: [...root.querySelectorAll('button,input[type="radio"]')].filter(el => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1);
    }).map(el => el.getAttribute('aria-label') || el.textContent?.trim()),
  }));
  assert.ok(result.document[0] <= result.document[1] + 1, `no page overflow: ${JSON.stringify(result)}`);
  assert.ok(result.root[0] <= result.root[1] + 1, `no setup overflow: ${JSON.stringify(result)}`);
  assert.deepEqual(result.horizontalControls, [], 'all controls stay inside horizontal viewport');
  return result;
}
async function capture(page, name) {
  await settled(page);
  const layout = await fit(page);
  const image = `${name}.png`;
  await page.screenshot({ path: `${out}/${image}` });
  report.captures.push({ image, viewport: page.viewportSize(), reducedMotion: await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), layout });
}
async function injectPad(page) {
  await page.evaluate(() => {
    const pad = { id: 'Crownfall setup verification gamepad', index: 0, connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: performance.now() };
    window.__setupPad = pad;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
  });
  // Software rendering may deliver sparse animation frames. Observe neutral
  // frames rather than making a short synthetic pulse between poll samples.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function padButton(page, index) {
  await page.evaluate(index => { const p = window.__setupPad; p.buttons[index] = { pressed: true, touched: true, value: 1 }; p.timestamp = performance.now(); }, index);
  if (index === 0) await page.locator('.match-setup [data-setup-pressed="true"]').waitFor();
  else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(index => { const p = window.__setupPad; p.buttons[index] = { pressed: false, touched: false, value: 0 }; p.timestamp = performance.now(); }, index);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function padAxis(page, axis, value, expectedFocus) {
  await page.evaluate(([axis,value]) => { window.__setupPad.axes[axis] = value; window.__setupPad.timestamp = performance.now(); }, [axis,value]);
  await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, expectedFocus);
  await page.evaluate(axis => { window.__setupPad.axes[axis] = 0; window.__setupPad.timestamp = performance.now(); }, axis);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  if (process.env.CROWNFALL_SETUP_COMPONENT_ONLY !== '1') {
  // Actual application navigation and screenshots; no module/game replacement.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: false, renderScale: 50, frameLimit: 30 })));
  const page = await context.newPage(); observe(page);
  await page.goto(`${base}/?model=none`); await waitForBootReady(page);
  await openSetup(page, 'classic');
  const start = page.getByRole('button', { name: 'Start match', exact: true });
  assert.equal(await start.isDisabled(), true);
  assert.equal(await page.locator('.match-experience').count(), 0);
  assert.equal(await radio(page, 'Match clock', 'No clock').isChecked(), true);
  assert.equal(await radio(page, 'Computer strength', 'Medium').isChecked(), true);
  assert.equal(await radio(page, 'Your side', 'First move').isChecked(), true);
  await capture(page, 'classic-1280x720-unselected');
  pass('Classic requires explicit battlefield selection and preserves Untimed/Medium/first-move defaults, with you leading Aethelgard against Solforiz');

  const eclipse = page.getByRole('button', { name: 'Setting 1 Eclipse', exact: true });
  const violet = page.getByRole('button', { name: 'Setting 2 Violet Night', exact: true });
  await eclipse.focus(); await page.keyboard.press('Enter');
  assert.equal(await eclipse.getAttribute('aria-pressed'), 'true');
  await violet.focus(); await page.keyboard.press('Space');
  assert.equal(await violet.getAttribute('aria-pressed'), 'true');
  assert.equal(await eclipse.getAttribute('aria-pressed'), 'false');
  assert.equal(await start.isEnabled(), true);
  assert.equal(await page.locator('.match-experience').count(), 0, 'changing setup never launches a match');
  await radio(page, 'Match clock', 'No clock').focus();
  for (const name of ['5 minutes each','10 minutes each','15 minutes each','No clock']) {
    await page.keyboard.press('ArrowRight'); assert.equal(await radio(page, 'Match clock', name).isChecked(), true);
  }
  await radio(page, 'Match clock', '10 minutes each').focus(); await page.keyboard.press('Space');
  await choose(page, 'Computer strength', 'Hard'); await choose(page, 'Your side', 'Second move');
  const focusable = await page.locator('.match-setup button,.match-setup input[type="radio"]').count();
  await eclipse.focus();
  for (let i = 0; i < focusable + 3; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.match-setup').evaluate(root => document.activeElement === document.body || root.contains(document.activeElement)), true, 'Tab must not reach covered menu controls');
  }
  await capture(page, 'classic-1280x720-selected');
  assert.equal(await page.locator('.match-setup').evaluate(root => root.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0);
  pass('Real keyboard supports battlefield Enter/Space, clock arrows/wrap, native radios and no covered-menu focus leakage; reduced motion has no running setup animations');
  await page.keyboard.press('Escape'); await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'setup Escape must not leak into the newly mounted main menu');
  await openSetup(page, 'classic'); assert.equal(await start.isDisabled(), true); await back(page);
  pass('Escape and Back return to Play; re-entry starts a fresh explicit setup');

  await openSetup(page, 'local-duel');
  assert.equal(await group(page, 'Computer strength').count(), 0); assert.equal(await group(page, 'Your side').count(), 0);
  assert.equal(await start.isDisabled(), true); await eclipse.click(); await choose(page, 'Match clock', '5 minutes each');
  await capture(page, 'local-duel-1280x720'); await back(page);
  pass('Local Duel keeps battlefield/clock controls and does not expose computer-strength or single-player-side controls');

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ['classic','local-duel']) {
      await openSetup(page, mode); await eclipse.click(); await choose(page, 'Match clock', '15 minutes each');
      if (mode === 'classic') await choose(page, 'Computer strength', 'Easy');
      if (viewport.height < 600) await page.locator('.setup-terms').evaluate(element => { element.scrollTop = 0; });
      await capture(page, `${mode}-${viewport.width}x${viewport.height}`);
      if (viewport.height < 600) {
        for (const arena of [eclipse, violet]) {
          const visibleTitle = await arena.locator('.setup-battlefield-name').boundingBox();
          const body = await page.locator('.setup-body').boundingBox();
          assert.ok(visibleTitle && body && visibleTitle.y >= body.y && visibleTitle.y + visibleTitle.height <= body.y + body.height, 'each battlefield title is visible in the first landscape view');
        }
        if (mode === 'classic') {
          await radio(page, 'Match clock', '15 minutes each').focus();
          await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
          assert.equal(await radio(page, 'Your side', 'First move').evaluate(element => element === document.activeElement), true);
          await page.keyboard.press('ArrowRight');
          assert.equal(await radio(page, 'Your side', 'Second move').isChecked(), true);
          const reveal = await radio(page, 'Your side', 'Second move').evaluate(element => {
            const box = element.getBoundingClientRect(), pane = element.closest('.setup-terms'), bounds = pane.getBoundingClientRect();
            return { visible: box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1, scrollTop: pane.scrollTop };
          });
          assert.ok(reveal.visible && reveal.scrollTop > 0, 'keyboard focus reveals lower match terms in the independent landscape scroller');
        }
      }
      await start.scrollIntoViewIfNeeded(); const box = await start.boundingBox();
      assert.ok(box && box.y >= -1 && box.y + box.height <= viewport.height + 1, 'Start is reachable in viewport');
      await back(page);
    }
  }
  pass('Both modes fit 1920x1080 and 844x390 landscape without horizontal page/setup overflow and keep Start/Back reachable');

  // The fake browser gamepad exercises the same polling/input path as a pad;
  // it makes no claim about a physical controller or headset.
  if (process.env.CROWNFALL_SETUP_GAMEPAD !== '0') {
    await page.setViewportSize({ width: 1280, height: 720 }); await openSetup(page, 'classic');
    await injectPad(page); await eclipse.focus(); await padButton(page, 0);
    assert.equal(await eclipse.getAttribute('aria-pressed'), 'true');
    await radio(page, 'Match clock', 'No clock').focus(); await padAxis(page, 0, .95, '5 minutes each'); await padButton(page, 0);
    assert.equal(await radio(page, 'Match clock', '5 minutes each').isChecked(), true);
    await page.evaluate(() => { window.__setupPad.buttons[1] = { pressed: true, touched: true, value: 1 }; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('region', { name: 'Classic setup', exact: true }).isVisible(), true, 'Back waits for release so a held B cannot affect the returning main menu');
    await page.evaluate(() => { window.__setupPad.buttons[1] = { pressed: false, touched: false, value: 0 }; });
    await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
    await page.waitForTimeout(450);
    assert.equal(await page.getByRole('tab', { name: 'Play', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('dialog').count(), 0, 'one setup Back press must not leak into another menu action');
    pass('Emulated browser gamepad A selects, right navigation reaches clock choice, and B returns to Play');

    await page.setViewportSize({ width: 844, height: 390 }); await openSetup(page, 'classic');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await radio(page, 'Your side', 'First move').focus();
    await padAxis(page, 0, .95, 'Second move'); await padButton(page, 0);
    assert.equal(await radio(page, 'Your side', 'Second move').isChecked(), true);
    const controllerReveal = await radio(page, 'Your side', 'Second move').evaluate(element => {
      const box = element.getBoundingClientRect(), pane = element.closest('.setup-terms'), bounds = pane.getBoundingClientRect();
      return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 && pane.scrollTop > 0;
    });
    assert.equal(controllerReveal, true, 'gamepad focus reveals the selected side in the independent landscape scroller');
    await back(page);
    pass('Landscape keeps both battlefield titles visible and keyboard/gamepad focus reveals lower match terms');
  }
  await context.close();

  const touch = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, reducedMotion: 'reduce' });
  await touch.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: false, renderScale: 50, frameLimit: 30 })));
  const touchPage = await touch.newPage(); observe(touchPage);
  await touchPage.goto(`${base}/?model=none`); await waitForBootReady(touchPage);
  await touchPage.getByRole('button', { name: 'Local Duel', exact: true }).tap();
  await touchPage.getByRole('button', { name: 'Setting 2 Violet Night', exact: true }).tap();
  await choose(touchPage, 'Match clock', '10 minutes each', true);
  assert.equal(await touchPage.getByRole('button', { name: 'Start match', exact: true }).isEnabled(), true);
  await touchPage.getByRole('button', { name: 'Back to Play', exact: true }).tap();
  await touchPage.getByRole('region', { name: 'Play options', exact: true }).waitFor();
  await touch.close(); pass('Landscape touch selects a battlefield and clock and returns to Play');
  }

  // Isolated real-component harness. Its callback observes actual onStart
  // payloads; no engine is mocked into a gameplay pass and no domain state is
  // directly mutated. A stable dev-only fixture avoids runtime file writes
  // that would otherwise reload other watched desktop/Quest sessions.
  const harnessContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const harness = await harnessContext.newPage(); observe(harness);
  // Classic: you lead Aethelgard (ivory) on your chosen side and pick the computer's kingdom; a duel picks both, never the
  // same (a kingdom the other player holds is disabled, so each case frees the one it needs first).
  const armyCases = (mode, playerColor) => mode === 'classic'
    ? [['Solforiz','sun'], ['Korvenia','empire'], ['Kwind-09','kwind']].map(([label, rival]) => [() => choose(harness, "Opponent's army", label),
        playerColor === 'w' ? { w: 'ivory', b: rival } : { w: rival, b: 'ivory' }])
    : [[async () => { await choose(harness, "Player two's army", 'Solforiz'); await choose(harness, "Player one's army", 'Aethelgard'); }, { w: 'ivory', b: 'sun' }],
       [async () => { await choose(harness, "Player one's army", 'Korvenia'); await choose(harness, "Player two's army", 'Aethelgard'); }, { w: 'empire', b: 'ivory' }],
       [async () => { await choose(harness, "Player one's army", 'Kwind-09'); await choose(harness, "Player two's army", 'Korvenia'); }, { w: 'kwind', b: 'empire' }]];
  const response = await harness.goto(`${base}/scripts/fixtures/match-setup-harness.html`);
  assert.ok((await response.text()).includes('Match setup component boundary verification'), 'the actual dev server must serve the component harness HTML');
  await harness.getByRole('region', { name: 'Classic setup', exact: true }).waitFor();
  for (const mode of ['classic','local-duel']) {
    await harness.evaluate(mode => window.__mountSetup(mode), mode);
    await harness.getByRole('region', { name: mode === 'classic' ? 'Classic setup' : 'Local Duel setup', exact: true }).waitFor();
    assert.equal(await harness.getByRole('button', { name: 'Start match', exact: true }).isDisabled(), true);
    for (const setting of ['scene-01','scene-02']) {
      await harness.getByRole('button', { name: setting === 'scene-01' ? 'Setting 1 Eclipse' : 'Setting 2 Violet Night', exact: true }).click();
      for (const difficulty of mode === 'classic' ? ['easy','medium','hard'] : ['medium']) {
        if (mode === 'classic') await choose(harness, 'Computer strength', difficulty[0].toUpperCase()+difficulty.slice(1));
        for (const playerColor of mode === 'classic' ? ['w','b'] : ['w']) {
          if (mode === 'classic') await choose(harness, 'Your side', playerColor === 'w' ? 'First move' : 'Second move');
          for (const [armyPick, armies] of armyCases(mode, playerColor)) {
          await armyPick();
          for (const clockMinutes of [null,5,10,15]) {
            await choose(harness, 'Match clock', clockLabel(clockMinutes));
            const count = await harness.evaluate(() => window.__setupLaunches.length);
            await harness.getByRole('button', { name: 'Start match', exact: true }).click();
            const launches = await harness.evaluate(() => window.__setupLaunches);
            assert.equal(launches.length, count+1);
            assert.deepEqual(launches.at(-1), { mode,setting,difficulty,playerColor,clockMinutes,armies });
            assert.equal('legacy' in launches.at(-1), false, 'ordinary setup must not silently attach house consequences');
            report.componentConfigCases++;
          }
          }
        }
      }
    }
  }
  await harnessContext.close(); pass(`${report.componentConfigCases} real-component onStart configurations preserve both settings, all strength/side/clock values, every army choice and no inferred Legacy context`);
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  if (currentPage && !currentPage.isClosed()) report.failurePage = { url: currentPage.url(), title: await currentPage.title().catch(() => '') };
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: `${out}/failure.png` }).catch(() => {});
} finally {
  await writeFile(`${out}/verification.json`, JSON.stringify(report,null,2));
  await browser.close();
}
if (!report.passed) throw Error(report.failure);
console.log(`Saved setup verification and ${report.captures.length} screenshots to ${out}`);
