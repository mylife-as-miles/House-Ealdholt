import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const output = resolve('artifacts/chronicles-book/materials'); await mkdir(output, { recursive: true });
// A disposable local inspection route, never included in the production build.
const fixture = resolve('main game/artifacts/book-material.html');
await mkdir(resolve('main game/artifacts'), { recursive: true });
await writeFile(fixture, '<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"><title>Book material inspection</title><style>html,body{margin:0;background:#19130f}canvas{display:block}</style></head><body><script type="module" src="../scripts/fixtures/book-material-inspection.ts"></script></body></html>');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', response => { if (response.url().includes('book-cover-v1/')) requests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
try {
  await page.goto('http://127.0.0.1:5173/artifacts/book-material.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.inspectBook === 'function');
  await page.waitForFunction(() => window.bookTexturesReady());
  const views = [];
  for (const view of ['front', 'quarter', 'spine', 'close']) {
    const stats = await page.evaluate(view => window.inspectBook(view), view);
    await page.screenshot({ path: resolve(output, `${view}.png`) }); views.push({ view, ...stats });
  }
  assert.equal(requests.length, 3); assert.ok(requests.every(item => item.status === 200));
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'inspection.json'), JSON.stringify({ requests, views, errors }, null, 2));
  console.log(JSON.stringify({ requests, views, errors }, null, 2));
} finally { await browser.close(); }
