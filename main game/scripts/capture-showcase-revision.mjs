import { chromium } from 'playwright';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';
const dir = 'artifacts/showcase-functional/revision';
await mkdir(`${dir}/recordings`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], shots = [];
let context, video, failure;
try {
 context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, recordVideo: { dir: `${dir}/recordings`, size: { width: 1280, height: 720 } } });
 const page = await context.newPage();
 page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
 await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'high', renderScale: 100, motion: true, volume: 0 })));
 const url = new URL(process.env.CROWNFALL_TEST_URL || 'http://localhost:5173'); url.searchParams.set('model', 'none');
 await page.goto(url.href); await waitForBootReady(page);
 await page.getByRole('tab', { name: 'Showcase', exact: true }).click(); await waitForMenuIdle(page);
 await page.getByRole('button', { name: 'AI Battles', exact: true }).click(); await waitForMenuIdle(page);
 await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase === 'ready');
 const control = key => page.locator(`.showcase-screen [data-control="${key}"]`);
 await page.waitForFunction(() => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) >= 2);
 const shot = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const path = `${dir}/${name}.png`; await page.screenshot({ path }); shots.push(path); console.log(path); };
 await shot('battle-1280');
 await control('transport-play').click(); await control('camera-board').click(); await control('camera-cinematic').click();
 await control('save').click(); await control('open-archive').click(); await waitForMenuIdle(page); await shot('replays-1280');
 await control('back').click(); await waitForMenuIdle(page); await page.getByRole('button', { name: 'Arenas', exact: true }).click(); await waitForMenuIdle(page); await control('arena-1').click(); await shot('arena-1280');
 await page.setViewportSize({ width: 844, height: 390 }); await shot('arena-landscape');
 await control('back').click(); await waitForMenuIdle(page); await page.getByRole('button', { name: 'AI Battles', exact: true }).click(); await waitForMenuIdle(page); await shot('battle-landscape');
 video = page.video();
 if (errors.length) throw new Error(errors.join('\n'));
} catch (error) { failure = error; }
finally {
 await context?.close();
 if (video) { const path = await video.path(); await rename(path, `${dir}/showcase-motion.webm`); }
 await browser.close();
 await writeFile(`${dir}/capture.json`, JSON.stringify({ passed: !failure, shots, errors, settings: { quality: 'high', renderScale: 100, motion: true }, renderer: 'Chromium SwiftShader, GLB disabled for Showcase-only capture; no hardware performance claim', recording: `${dir}/showcase-motion.webm`, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2));
}
if (failure) throw failure;
