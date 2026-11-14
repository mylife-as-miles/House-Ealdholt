// Desktop software asset comparison only. Private GLBs never enter the repo.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const basenames = [
  'elderbloom-field02-original-source-control', 'elderbloom-field02-lod3000-guarded',
  'elderbloom-forest01-original-source-control', 'elderbloom-forest01-lod3000-guarded',
  'elderbloom-forest01-lod5000-guarded', 'elderbloom-forest01-lod8000-guarded',
  'elderbloom-forest01-lod8000-unpruned',
];
const args = process.argv.slice(2), requested = args.filter(value => !value.startsWith('--'));
const fixtures = requested.length ? requested : basenames.map(name => `http://127.0.0.1:8068/${name}.glb`);
assert.ok(fixtures.length <= 7 && new Set(fixtures).size === fixtures.length, 'Choose at most seven unique private prototypes.');
for (const value of fixtures) {
  const url = new URL(value);
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash
    && /^\/[a-z0-9][a-z0-9_-]*\.glb$/.test(url.pathname), 'Only simple private loopback GLB URLs are accepted.');
}
const views = (process.env.CROWNFALL_TREE_LOD_VIEWS || (args.includes('--front') ? 'quarter,front' : 'quarter')).split(',');
assert.ok(views.length && new Set(views).size === views.length && views.every(view => ['quarter', 'front'].includes(view)));
const looks = (process.env.CROWNFALL_TREE_LOD_LOOKS || 'material').split(',');
assert.ok(looks.length && new Set(looks).size === looks.length && looks.every(look => ['material', 'clay'].includes(look)));
const privateRoot = await realpath('/workspace/private-assets/elderbloom');
const output = resolve(process.env.CROWNFALL_TREE_LOD_ARTIFACTS || `${privateRoot}/tree-lod-prototypes-v1/captures-v1`);
assert.ok(output.startsWith(privateRoot + sep), 'Comparison outputs must stay in the private Elderbloom directory.');
await mkdir(output, { recursive: true });
assert.ok((await realpath(output)).startsWith(privateRoot + sep), 'Refusing an output symlink outside private storage.');
const origin = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const records = [];
let browser, passed = false;
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1'), index = Number(url.pathname.slice(1)), view = url.searchParams.get('view');
  const look = url.searchParams.get('look');
  if (!Number.isInteger(index) || !fixtures[index] || !views.includes(view) || !looks.includes(look)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html'); response.setHeader('Cache-Control', 'no-store');
  response.end(`<!doctype html><html><head><base href=${JSON.stringify(new URL('/', origin).href)}><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="stage"></div><script type="module">
    import { createTreeLodView } from ${JSON.stringify(new URL('/scripts/tree-lod-view.ts', origin).href)};
    const host=document.querySelector('#stage');
    try { window.treeComparison=await createTreeLodView(host,${JSON.stringify(fixtures[index])},${JSON.stringify(view)},${JSON.stringify(look)});host.dataset.ready='true'; }
    catch(error) {window.comparisonFailure=error?.stack||String(error);host.dataset.failed='true';}
  </script></body></html>`);
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [index, fixture] of fixtures.entries()) for (const view of views) for (const look of looks) {
    const context = await browser.newContext({ viewport: { width: 600, height: 450 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const stem = new URL(fixture).pathname.slice(1, -4), filename = `${stem}-${view}${look === 'material' ? '' : '-clay'}.png`;
    let record;
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/${index}?view=${view}&look=${look}`);
      await page.waitForFunction(() => { const d = document.querySelector('#stage')?.dataset; return d?.ready === 'true' || d?.failed === 'true'; }, undefined, { timeout: 180000 });
      const result = await page.evaluate(() => ({ failure: window.comparisonFailure ?? null, stats: window.treeComparison?.stats ?? null }));
      record = { fixture, view, look, filename, ...result, errors }; records.push(record);
      assert.equal(result.failure, null); assert.ok(result.stats);
      assert.equal(result.stats.completeComponents, 3);
      assert.deepEqual(result.stats.camera.position, view === 'front' ? [0, 10.4, 43] : [30, 16, 30]);
      assert.deepEqual(result.stats.camera.target, [0, 10.4, 0]); assert.equal(result.stats.camera.fov, 40);
      assert.equal(result.stats.floorY, -.03); assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, filename), timeout: 120000 });
      console.log(`CAPTURED ${stem} ${view}: ${result.stats.modelTriangles} model triangles`);
    } catch (error) {
      if (!record) records.push({ fixture, view, look, filename, failure: String(error), errors });
      throw error;
    } finally {
      await page.evaluate(() => window.treeComparison?.dispose()).catch(() => {});
      await context.close();
    }
  }
  for (const view of views) {
    const items = records.filter(record => record.view === view), height = Math.ceil(items.length / 2) * 251;
    const tiles = await Promise.all(items.map(async (record, i) => ({ input: await sharp(resolve(output, record.filename)).resize(300, 225).toBuffer(), left: i % 2 * 300, top: Math.floor(i / 2) * 251 + 26 })));
    const text = items.map((record, i) => {
      const family = record.filename.includes('forest05') ? 'Forest05' : record.filename.includes('field02') ? 'Field02' : 'Forest01';
      const kind = /original-source|exact-source/.test(record.filename) ? 'source' : record.filename.includes('native525') ? 'reduced' : record.filename.includes('unpruned') ? 'unpruned' : 'LOD';
      return `<text x="${i%2*300+7}" y="${Math.floor(i/2)*251+17}">${family} ${kind} ${record.look} · ${record.stats.modelTriangles.toLocaleString('en')} tris</text>`;
    }).join('');
    const labels = Buffer.from(`<svg width="600" height="${height}"><style>text{font:12px sans-serif;fill:#ead6aa}</style>${text}</svg>`);
    await sharp({ create: { width: 600, height, channels: 3, background: '#151b17' } }).composite([...tiles, { input: labels, left: 0, top: 0 }]).jpeg({ quality: 80 }).toFile(resolve(output, `tree-lod-${view}-comparison.jpg`));
  }
  assert.deepEqual(records.flatMap(record => record.errors), []); passed = true;
} finally {
  try {
    await writeFile(resolve(output, 'comparison.json'), JSON.stringify({ passed,
      label: 'Desktop software asset comparison. Recorded map sizes may differ. Not Native runtime or physical-headset proof.',
      unchanged: 'Source roots, model scale, geometry and alpha. Material look retains source bindings; clay suppresses colour and changes roughness/metalness. No artificial leaf compensation.', records }, null, 2));
  } finally {
    try { await browser?.close(); }
    finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      console.log(`PRIVATE OUTPUT: ${output}`);
    }
  }
}
