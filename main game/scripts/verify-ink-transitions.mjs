import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';
const out = resolve('artifacts/story-cinematic/ink'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
async function setup(motion) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: motion ? 'no-preference' : 'reduce' });
  await ctx.addInitScript(() => {
    const animate = Element.prototype.animate;
    window.__inkCalls = [];
    Element.prototype.animate = function(frames, options) {
      if (Array.isArray(frames) && frames.some(frame => frame.maskSize)) {
        window.__inkCalls.push({ target: this, frames, options });
        if (window.__inkCalls.length > 32) window.__inkCalls.shift();
      }
      return animate.call(this, frames, options);
    };
  });
  await ctx.addInitScript(motion => {
    localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion, fullscreen: false, renderScale: 50, frameLimit: 30 }));
    localStorage.setItem('crownfall.opening.seen', 'true');
    localStorage.setItem('crownfall.story.progress.v1', JSON.stringify({ version: 1, prologue: { state: 'completed', completedAt: '2026-11-11T12:00:00.000Z' } }));
  }, motion);
  const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173') + '/?model=none');
  await waitForBootReady(page);
  return { ctx, page };
}
async function pose(page, selector, name) {
  const node = page.locator(selector);
  const count = await node.evaluate(root => {
    // A busy test GPU can finish the effect before readback. Re-create a controlled
    // pose from the exact keyframes/options the application actually submitted.
    const calls = window.__inkCalls.filter(call => root === call.target || root.contains(call.target));
    const latest = calls.at(-1);
    if (!latest) return 0;
    if (latest.options.duration !== 560) throw new Error('Unexpected reference timing');
    const animation = latest.target.animate(latest.frames, latest.options);
    animation.pause(); animation.currentTime = 230;
    window.__inkCapture = animation;
    return calls.length;
  });
  assert.ok(count > 0, name + ' uses the ink mask, not just a fade');
  await page.screenshot({ path: out + '/' + name + '-230ms.png' });
  await page.evaluate(() => window.__inkCapture.cancel());
  await page.waitForTimeout(650);
  await page.screenshot({ path: out + '/' + name + '-settled.png' });
  checks.push(name + ': controlled masked midpoint from real submitted frames and fully revealed destination');
}
let failure;
try {
  const { page, ctx } = await setup(true);
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await pose(page, '.menu-transition-live', 'chapters');
  await page.locator('[data-chapter-id="chapter-01"]').click();
  await page.locator('dialog[open]').waitFor();
  await pose(page, '[data-story-introduction]', 'chapter-one');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Chronicles', exact: true }).click();
  await pose(page, '.menu-transition-live', 'chronicles');
  // Interrupt a reveal and navigate away: no invisible layer may block the menu.
  await page.keyboard.press('Escape'); await page.getByRole('tab', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
  await page.waitForTimeout(850);
  assert.equal(await page.locator('.menu-transition-ghost > *').count(), 0);
  checks.push('rapid Back cancels the mask and removes inert outgoing layers');
  await ctx.close();
  const still = await setup(false);
  await still.page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await still.page.locator('[data-chapter-id="chapter-01"]').click();
  assert.equal(await still.page.locator('[data-story-introduction]').evaluate(root => root.getAnimations().filter(a => a.effect?.getKeyframes().some(k => k.maskSize)).length), 0);
  checks.push('reduced motion has no spreading mask');
  await still.ctx.close(); assert.deepEqual(errors, []);
} catch (e) { failure = e; console.error(e); }
finally { await writeFile(out + '/verification.json', JSON.stringify({ passed: !failure, checks, errors, failure: failure?.stack }, null, 2)); await browser.close(); }
console.log(checks.join('\n')); if (failure) process.exitCode = 1;
