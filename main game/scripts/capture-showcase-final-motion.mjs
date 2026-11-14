import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';

const directory = 'artifacts/showcase-functional/final-motion';
await mkdir(`${directory}/raw`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], actions = [];
let context, video, failure, segmentStartSeconds = 0;
let recordingStart = Date.now();
try {
 context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: `${directory}/raw`, size: { width: 1280, height: 720 } } });
 recordingStart = Date.now();
 const page = await context.newPage(); video = page.video();
 page.setDefaultTimeout(15000);
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'high', renderScale: 100, motion: true, volume: 0 })));
 const target = new URL(process.env.CROWNFALL_TEST_URL || 'http://localhost:5173'); target.searchParams.set('model', 'none');
 await page.goto(target.href); await waitForBootReady(page);
 await page.getByRole('tab', { name: 'Showcase', exact: true }).click(); await waitForMenuIdle(page);
 const clipStart = Date.now(); segmentStartSeconds = (clipStart - recordingStart) / 1000;
 const log = label => actions.push({ seconds: (Date.now() - clipStart) / 1000, label });
 const control = key => page.locator(`.showcase-screen [data-control="${key}"]`);
 log('Overview to live exhibition');
 await page.getByRole('button', { name: 'AI Battles', exact: true }).click(); await waitForMenuIdle(page);
 await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase === 'ready');
 await page.waitForFunction(() => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) >= 2);
 log('Pause after actual AI moves'); await control('transport-play').click();
 const pausedPly = Number(await control('timeline').inputValue());
 await page.waitForTimeout(300); assert.equal(Number(await control('timeline').inputValue()), pausedPly);
 log('Explicit resume'); await control('transport-play').click();
 await page.waitForFunction(value => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) > value, pausedPly);
 log('Resumed interpolation advances'); await control('transport-play').click();
 log('Return to overview'); await control('back').click(); await waitForMenuIdle(page);
 log('Open contrasting arena'); await page.getByRole('button', { name: 'Arenas', exact: true }).click(); await waitForMenuIdle(page); await control('arena-3').click();
 const remaining = 10000 - (Date.now() - clipStart); if (remaining > 0) await page.waitForTimeout(remaining);
 const contextLost = await page.locator('.showcase-stage-host canvas').evaluate(canvas => canvas.getContext('webgl2')?.isContextLost() ?? true);
 assert.equal(contextLost, false); assert.equal(await page.locator('.showcase-stage-failure').count(), 0);
 assert.equal(await page.locator('.showcase-stage').getAttribute('data-stage-reduced-motion'), 'false');
 await page.screenshot({ path: `${directory}/final-frame.png` });
 log('Clip complete'); assert.deepEqual(errors, []);
} catch (error) { failure = error; }
finally {
 await context?.close(); await browser.close();
 if (video) {
  const original = await video.path(); const rawPath = `${directory}/raw-final-motion.webm`; await rename(original, rawPath);
  try {
   const rawDuration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', rawPath], { encoding: 'utf8' }).trim());
   const pause = actions.find(action => action.label === 'Pause after actual AI moves');
   assert.ok(pause, 'A captured pause is required');
   const relativeStart = Math.max(0, Math.min(pause.seconds - .3, rawDuration - segmentStartSeconds - 8.2));
   const sourceStart = segmentStartSeconds + relativeStart;
   const requestedDuration = Math.min(11.8, rawDuration - sourceStart);
   execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(sourceStart), '-i', rawPath, '-t', String(requestedDuration), '-c:v', 'libvpx-vp9', '-b:v', '1200k', '-an', `${directory}/showcase-final-motion.webm`]);
   const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', `${directory}/showcase-final-motion.webm`], { encoding: 'utf8' }).trim());
   assert.ok(duration >= 8 && duration <= 12);
   for (const label of ['Pause after actual AI moves', 'Explicit resume', 'Resumed interpolation advances', 'Return to overview', 'Open contrasting arena']) {
    const event = actions.find(action => action.label === label);
    assert.ok(event && event.seconds >= relativeStart && event.seconds < relativeStart + duration, `The clip must contain ${label}`);
   }
   actions.push({ label: 'Final WebM duration', seconds: duration }, { label: 'Continuous actual-speed source window', seconds: sourceStart });
  } catch (error) { failure ??= error; }
 }
 await writeFile(`${directory}/capture.json`, JSON.stringify({ passed: !failure, actions, errors, segmentStartSeconds, quality: 'high', renderScale: 100, motion: true, renderer: 'Desktop Chromium SwiftShader; menu GLB disabled for bounded Showcase recording. No physical hardware performance claim.', raw: `${directory}/raw-final-motion.webm`, clip: `${directory}/showcase-final-motion.webm`, priorRecordingPreserved: 'artifacts/showcase-functional/revision/showcase-motion.webm', ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2));
}
if (failure) throw failure;
console.log(`${directory}/showcase-final-motion.webm`);
