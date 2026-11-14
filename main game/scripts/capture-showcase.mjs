import { waitForBootReady } from './boot-helpers.mjs';
import { waitForMenuIdle } from './motion-helpers.mjs';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = 'artifacts/showcase-functional/high';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const captures = [], errors = [];
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'high', renderScale: 100, motion: false, volume: 0 })));
 const target = new URL(process.env.CROWNFALL_TEST_URL || 'http://localhost:5173');
 if (process.env.CROWNFALL_CAPTURE_MODEL !== 'real') target.searchParams.set('model', 'none');
 await page.goto(target.href); await waitForBootReady(page);
 await page.getByRole('tab', { name: 'Showcase', exact: true }).click(); await waitForMenuIdle(page);
 const shot = async name => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const path = `${directory}/${name}.png`; await page.screenshot({ path }); captures.push(path); console.log(path);
 };
 const control = key => page.locator(`.showcase-screen [data-control="${key}"]`);
 await shot('overview-1280');
 await page.getByRole('button', { name: 'AI Battles', exact: true }).click(); await waitForMenuIdle(page);
 await page.waitForFunction(() => document.querySelector('.showcase-screen')?.dataset.showcasePhase === 'ready');
 await page.waitForFunction(() => Number(document.querySelector('.showcase-stage')?.dataset.stagePly) >= Math.min(8, Number(document.querySelector('[data-control="timeline"]')?.max || 8)));
 await control('transport-play').click(); await control('camera-cinematic').click(); await shot('battles-1280');
 await control('save').click(); await control('open-archive').click(); await waitForMenuIdle(page); await shot('replays-1280');
 await control('back').click(); await waitForMenuIdle(page); await page.getByRole('button', { name: 'Arenas', exact: true }).click(); await waitForMenuIdle(page);
 for (let index = 0; index < 4; index++) { await control(`arena-${index}`).click(); await shot(`arena-${index + 1}-1280`); }
 for (const viewport of [{ width: 1920, height: 1080 }, { width: 844, height: 390 }]) { await page.setViewportSize(viewport); await shot(`arenas-${viewport.width}`); }
 await writeFile(`${directory}/screenshots.json`, JSON.stringify({ captures, errors, renderer: 'Desktop Chromium SwiftShader; actual original3Dstage, highquality, reducedmotion. No hardware performance claim.', model: process.env.CROWNFALL_CAPTURE_MODEL === 'real' ? 'Actual supplied menu GLB on overview' : 'Overview GLB disabled for bounded Showcase-only capture' }, null, 2));
 if (errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); }
