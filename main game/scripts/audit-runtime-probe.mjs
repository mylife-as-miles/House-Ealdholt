// Runtime probe: drives the built desktop game through the menu and a Local Duel in both arenas and records what a
// player's browser has to do. For each step: requests and megabytes downloaded by kind, draw calls and triangles per
// frame, JS heap, WebGL contexts and GPU objects created, console errors, page errors and failed requests.
// It is the measuring stick for docs/GAME_AUDIT_FIX_PLAN.md: run it before and after a fix.
//
//   npm run build:desktop                       # from the repository root (the arenas must be installed in public/gameport)
//   npx vite preview --port 5198 --host 127.0.0.1 --strictPort    # in "main game"
//   CHROMIUM_PATH=/usr/bin/google-chrome node scripts/audit-runtime-probe.mjs http://127.0.0.1:5198 ../artifacts/audit/probe.json
//
// Counts come from wrapping the WebGL draw and create calls, so they need no hook in the game. Frame rate is NOT a
// result of this probe on a machine without a GPU (software WebGL runs at about one frame a second); draw calls,
// triangles, bytes, heap and context counts are the same on any machine.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { waitForBootReady } from './boot-helpers.mjs';

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:5198', outFile = process.argv[3] || '../artifacts/audit/probe.json';
await mkdir(dirname(outFile), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--enable-precise-memory-info'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const report = { base, startedAt: new Date().toISOString(), steps: [], consoleIssues: [], pageErrors: [], failedRequests: [], notes: [] };
let stepName = 'boot';
page.on('pageerror', (e) => report.pageErrors.push({ step: stepName, message: e.message.slice(0, 400) }));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') report.consoleIssues.push({ step: stepName, type: m.type(), text: m.text().slice(0, 300) }); });
page.on('requestfailed', (r) => report.failedRequests.push({ step: stepName, url: r.url().slice(0, 160), error: r.failure()?.errorText }));
const net = [];
page.on('response', (r) => { if (r.status() >= 400) report.failedRequests.push({ step: stepName, url: r.url().slice(0, 160), status: r.status() }); });
page.on('requestfinished', async (r) => {
  try { const s = await r.sizes(); const res = await r.response(); net.push({ step: stepName, url: r.url(), bytes: s.responseBodySize, transfer: s.responseBodySize + s.responseHeadersSize, fromCache: res ? await res.fromServiceWorker().valueOf() : false, status: res?.status() }); } catch { /* closed */ }
});
const kind = (url) => /\/gameport\//.test(url) ? 'arena (gameport)' : /r2-pub\.rork\.com/.test(url) ? 'piece models and clips (third-party CDN)' : /\/audio\/gambit|gambit\/.*\.mp3|[a-z_0-9]+-[A-Za-z0-9_-]{8}\.mp3/.test(url) ? 'match audio' : /\.(mp3|ogg|m4a|wav)(\?|$)/.test(url) ? 'music' : /\.(mp4|webm)(\?|$)/.test(url) ? 'video' : /\.(js|mjs)(\?|$)/.test(url) ? 'javascript' : /\.css(\?|$)/.test(url) ? 'css' : /\.(woff2?|ttf|otf)(\?|$)/.test(url) ? 'fonts' : /\.(png|jpe?g|webp|avif|svg|ktx2|exr|hdr)(\?|$)/.test(url) ? 'images' : /\.(glb|gltf|bin)(\?|$)/.test(url) ? 'models (own)' : /\.(wasm)(\?|$)/.test(url) ? 'wasm' : 'other';

await page.addInitScript(() => {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'medium', motion: true, volume: 0 }));
  localStorage.setItem('crownfall.opening.seen', 'true');
  const P = (window.__probe = { draws: 0, tris: 0, frames: 0, contexts: [], textures: 0, buffers: 0, programs: 0, longTasks: [], raf: 0 });
  const wrapDraw = (proto) => {
    if (!proto) return;
    const count = (mode, n, inst = 1) => { P.draws += 1; P.tris += (mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0) * inst; };
    for (const [name, fn] of [['drawElements', (a) => count(a[0], a[1])], ['drawArrays', (a) => count(a[0], a[2])], ['drawElementsInstanced', (a) => count(a[0], a[1], a[4])], ['drawArraysInstanced', (a) => count(a[0], a[2], a[3])]]) {
      const orig = proto[name]; if (!orig) continue; proto[name] = function (...args) { fn(args); return orig.apply(this, args); };
    }
    for (const [name, key] of [['createTexture', 'textures'], ['createBuffer', 'buffers'], ['createProgram', 'programs']]) { const orig = proto[name]; proto[name] = function (...a) { P[key] += 1; return orig.apply(this, a); }; }
  };
  wrapDraw(window.WebGL2RenderingContext?.prototype); wrapDraw(window.WebGLRenderingContext?.prototype);
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const ctx = getContext.call(this, type, ...rest); if (ctx && /webgl/.test(type) && !this.__counted) { this.__counted = true; P.contexts.push({ type, w: this.width, h: this.height, at: Math.round(performance.now()) }); } return ctx; };
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = (cb) => raf((t) => { P.raf += 1; cb(t); });
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) P.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
});

const snapshot = async (label, extra = {}) => {
  // per-frame draw cost over a short window
  const win = await page.evaluate(() => new Promise((resolve) => { const P = window.__probe, d0 = P.draws, t0 = P.tris, r0 = P.raf, start = performance.now(); setTimeout(() => resolve({ ms: performance.now() - start, draws: P.draws - d0, tris: P.tris - t0, raf: P.raf - r0 }), 6000); }));
  const info = await page.evaluate(() => { const P = window.__probe; const m = performance.memory; return { heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null, heapTotalMB: m ? Math.round(m.totalJSHeapSize / 1048576) : null, domNodes: document.getElementsByTagName('*').length, canvases: document.querySelectorAll('canvas').length, liveContexts: [...document.querySelectorAll('canvas')].filter((c) => c.__counted).length, contextsEver: P.contexts.length, texturesCreated: P.textures, buffersCreated: P.buffers, programsCreated: P.programs, longTasks: P.longTasks.length, longTaskMsTotal: P.longTasks.reduce((s, t) => s + t.ms, 0), longTaskMax: P.longTasks.reduce((s, t) => Math.max(s, t.ms), 0) }; });
  const bytes = {}; let total = 0, requests = 0;
  for (const n of net) { if (n.step !== stepName) continue; const k = kind(n.url); bytes[k] = (bytes[k] || 0) + n.bytes; total += n.bytes; requests += 1; }
  const frames = Math.max(1, win.raf);
  const row = { step: stepName, label, ...extra, requests, downloadedMB: +(total / 1048576).toFixed(2), byKindMB: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, +(v / 1048576).toFixed(2)])), rafPerSecond: +(win.raf / (win.ms / 1000)).toFixed(1), drawCallsPerFrame: Math.round(win.draws / frames), trianglesPerFrame: Math.round(win.tris / frames), ...info };
  report.steps.push(row); console.log(JSON.stringify(row)); await writeFile(outFile, JSON.stringify(report, null, 1));
  return row;
};
const step = (name) => { stepName = name; };
const board = () => page.locator('canvas[aria-label="Crownfall chessboard"]');
const move = async (keys, plies) => { await board().focus(); for (const k of keys) await page.keyboard.press(k); await page.locator(`.match-experience[data-match-plies="${plies}"][data-match-busy="false"]`).waitFor({ timeout: 240000 }); };
const startDuel = async (setting) => {
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(setting) }).click();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience[data-match-ready="true"]').waitFor({ timeout: 600000 });
  return (Date.now() - t0) / 1000;
};

try {
  step('1 boot to menu');
  const t0 = Date.now();
  await page.goto(base + '/');
  await waitForBootReady(page);
  await snapshot('menu ready, Home idle', { secondsToReady: +((Date.now() - t0) / 1000).toFixed(1) });

  step('2 menu tabs');
  for (const tab of ['Play', 'Showcase', 'Settings', 'Home']) { await page.locator(`.main-nav [role="tab"][aria-label="${tab}"]`).click().catch((e) => report.notes.push(`tab ${tab}: ${e.message.slice(0, 120)}`)); await page.waitForTimeout(2500); }
  await snapshot('after visiting Play, Showcase, Settings, Home');

  step('3 match: Eclipse');
  await page.locator('.main-nav [role="tab"][aria-label="Play"]').click(); await page.waitForTimeout(1500);
  const s1 = await startDuel('Setting 1 Eclipse');
  await page.waitForTimeout(8000);
  await snapshot('Eclipse loaded, board idle', { secondsToPlayable: +s1.toFixed(1) });

  step('4 match: Eclipse, three moves with a capture');
  await move(['Enter', 'ArrowUp', 'ArrowUp', 'Enter'], 1);
  await move(['ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'], 2);
  await move(['ArrowRight', 'ArrowDown', 'Enter', 'ArrowLeft', 'ArrowUp', 'Enter'], 3);
  await page.waitForTimeout(4000);
  await snapshot('after e4 d5 exd5');

  step('5 match: Eclipse rematch');
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  const tr = Date.now();
  await page.locator('.match-experience[data-match-ready="true"][data-match-plies="0"]').waitFor({ timeout: 600000 });
  await page.waitForTimeout(8000);
  await snapshot('rematch loaded', { secondsToPlayable: +((Date.now() - tr) / 1000).toFixed(1) });

  step('6 leave match to menu');
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();
  await page.waitForTimeout(6000);
  await snapshot('back on Play after leaving the match');

  step('7 match: Violet Night');
  const s2 = await startDuel('Setting 2 Violet Night');
  await page.waitForTimeout(8000);
  await snapshot('Violet Night loaded, board idle', { secondsToPlayable: +s2.toFixed(1) });
  await page.getByRole('button', { name: 'Back to Play', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('region', { name: 'Play options', exact: true }).waitFor();

  step('8 after two arenas, back on menu');
  await page.waitForTimeout(6000);
  await snapshot('menu after Eclipse and Violet Night');
} catch (error) { report.failure = String(error.stack || error).slice(0, 1500); console.log('PROBE FAILED', report.failure); }
report.contexts = await page.evaluate(() => window.__probe.contexts).catch(() => []);
report.longTasksTop = await page.evaluate(() => window.__probe.longTasks.sort((a, b) => b.ms - a.ms).slice(0, 15)).catch(() => []);
report.largestRequests = net.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 25).map((n) => ({ step: n.step, MB: +(n.bytes / 1048576).toFixed(2), url: n.url.replace(base, '').slice(0, 120) }));
report.requestsByHost = Object.entries(net.reduce((m, n) => { const h = new URL(n.url).host; (m[h] ||= { n: 0, bytes: 0 }); m[h].n += 1; m[h].bytes += n.bytes; return m; }, {})).map(([h, v]) => ({ host: h, requests: v.n, MB: +(v.bytes / 1048576).toFixed(2) }));
await writeFile(outFile, JSON.stringify(report, null, 1));
await browser.close();
console.log('probe done');
