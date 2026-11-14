// Controlled art diagnosis only. Production modules and source assets are never
// written: the local browser receives scoped copies of Vite's transformed JS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const fixture = process.argv[2];
assert.ok(fixture, 'Pass one private loopback GLB URL.');
const fixtureUrl = new URL(fixture);
assert.ok(['127.0.0.1', 'localhost'].includes(fixtureUrl.hostname) && fixtureUrl.pathname.endsWith('.glb'));
const origin = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.CROWNFALL_WALL_ARTIFACTS || 'artifacts/ealdholt-preview/wall-controls');
const allowedVariants = ['baseline', 'normal-off', 'sheen-off', 'shadow-off', 'sheen-floor'];
const onlyIndex = process.argv.indexOf('--only');
const variantArgument = process.argv.find(value => value.startsWith('--only='))?.slice('--only='.length)
  ?? (onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined);
const variants = (variantArgument || process.env.CROWNFALL_WALL_VARIANTS || allowedVariants.slice(0, 4).join(',')).split(',');
assert.ok(variants.length && new Set(variants).size === variants.length && variants.every(value => allowedVariants.includes(value)), 'Choose unique named wall diagnostic variants.');
const records = [];
await mkdir(output, { recursive: true });

// This function is serialized into the renderer's lexical model scope.
function wallControl() {
  const variant = window.__ealdholtWallVariant;
  const meshes = [], materials = new Map();
  model.traverse(object => {
    if (!object.isMesh || !/^S_Mossy_Stone_Wall_ukhgdfyga_lod3_Var1(?:_cell_-?\d+_-?\d+(?:_\d+)?|_\d+)?$/.test(object.name)) return;
    const matched = (Array.isArray(object.material) ? object.material : [object.material])
      .filter(material => material.name === 'Elderbloom_material_14');
    if (!matched.length) return;
    meshes.push(object);
    for (const material of matched) materials.set(material.uuid, material);
  });
  if (!meshes.length || materials.size !== 1) throw Error('Verified wall diagnostic binding changed.');
  const before = [...materials.values()].map(material => ({ name: material.name,
    normalMap: material.normalMap?.name ?? null, sheen: material.sheen ?? null,
    sheenRoughness: material.sheenRoughness ?? null, sheenRoughnessMap: material.sheenRoughnessMap?.name ?? null,
    metalness: material.metalness, aoMapIntensity: material.aoMapIntensity }));
  window.__ealdholtWallBefore ??= before;
  for (const material of materials.values()) {
    if (variant === 'normal-off') material.normalMap = null;
    if (variant === 'sheen-off') {
      if (typeof material.sheen !== 'number') throw Error('Verified wall has no sheen property.');
      material.sheen = 0;
    }
    if (variant === 'sheen-floor' && !material.userData.ealdholtDiagnosticSheenFloor) {
      const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
      material.onBeforeCompile = function(shader, renderer) {
        previous.call(this, shader, renderer);
        const seam = '#include <lights_physical_fragment>';
        if (shader.fragmentShader.split(seam).length !== 2) throw Error('Verified sheen-floor shader seam changed.');
        shader.fragmentShader = shader.fragmentShader.replace(seam, seam + '\n#ifdef USE_SHEEN\nmaterial.sheenRoughness = max(material.sheenRoughness, 0.07);\n#endif');
        window.__ealdholtWallFloorCompiles = (window.__ealdholtWallFloorCompiles ?? 0) + 1;
      };
      material.customProgramCacheKey = function() { return previousKey.call(this) + ':wall-diagnostic-sheen-floor:v1'; };
      material.userData.ealdholtDiagnosticSheenFloor = 0.07;
    }
    material.needsUpdate = true;
  }
  if (variant === 'shadow-off') for (const mesh of meshes) mesh.receiveShadow = false;
  window.__ealdholtWallControl = { variant, meshCount: meshes.length, materialCount: materials.size,
    before: window.__ealdholtWallBefore,
    after: [...materials.values()].map(material => ({ name: material.name,
      normalMap: material.normalMap?.name ?? null, sheen: material.sheen ?? null,
      sheenRoughness: material.sheenRoughness ?? null, sheenRoughnessMap: material.sheenRoughnessMap?.name ?? null,
      diagnosticSheenFloor: material.userData.ealdholtDiagnosticSheenFloor ?? null,
      metalness: material.metalness, aoMapIntensity: material.aoMapIntensity })),
    receivingMeshes: meshes.filter(mesh => mesh.receiveShadow).length,
    injections: (window.__ealdholtWallControl?.injections ?? 0) + 1 };
}
function replaceOne(body, expression, replacement) {
  assert.equal([...body.matchAll(new RegExp(expression.source, 'g'))].length, 1, `Diagnostic seam changed: ${expression}`);
  return body.replace(expression, replacement);
}
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><base href=${JSON.stringify(new URL('/', origin).href)}><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="stage"></div><script type="module">
    import { createEaldholtVillageView } from ${JSON.stringify(new URL('/src/legacy/aethelgard/village-view.ts', origin).href)};
    const host=document.querySelector('#stage');
    window.control=createEaldholtVillageView({host,modelUrl:${JSON.stringify(fixture)},quality:{preset:'high',renderScale:100,frameLimit:30},active:true,reducedMotion:true,panelMode:'village',label:'Controlled wall diagnosis',onReady(){host.dataset.controlReady='true'},onError(){host.dataset.controlError='true'}});
  </script></body></html>`);
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [], seams = { renderer: 0, view: 0, productionFloorBypass: 0 };
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(value => { window.__ealdholtWallVariant = value; }, variant);
    await page.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path !== '/src/legacy/aethelgard/village-view.ts' && path !== '/src/legacy/aethelgard/export-repairs.ts' && !path.endsWith('/shared/legacy/aethelgard/village-views.ts')) { await route.continue(); return; }
      const response = await route.fetch(); let body = await response.text();
      if (path === '/src/legacy/aethelgard/village-view.ts') {
        const injection = `\n(${wallControl.toString()})();\n`;
        body = replaceOne(body, /exportRepairs = applyEaldholtExportRepairs\(model\);/, match => match + injection);
        // setQuality restores receiveShadow=true, so reapply after its final call.
        body = replaceOne(body, /setQuality\(quality\);\s*readyPending = true;/, match => match.replace('readyPending = true;', injection + 'readyPending = true;'));
        seams.renderer++;
      } else if (path === '/src/legacy/aethelgard/export-repairs.ts') {
        // Production now contains the guarded fix. Remove only its shader
        // insertion in these diagnostic copies to retain a genuine before/after.
        body = replaceOne(body, /patchEaldholtSheenRoughnessShader\(shader\);/, '/* Diagnostic: production floor bypassed; sheen-floor variant reapplies the identical floor. */');
        seams.productionFloorBypass++;
      } else {
        // Exact CPU-audit camera, on every variant. This changes only the served
        // diagnostic copy, never the application's shared authored viewpoints.
        body = replaceOne(body, /(id:\s*["']well["'],\s*label:\s*["']Well["'],\s*position:\s*)\[[^\]]+\](,\s*target:\s*)\[[^\]]+\](,\s*fov:\s*)\d+/, (_all, a, b, c) => `${a}[22,2.8,29]${b}[14.5,1.9,29.5]${c}55`);
        seams.view++;
      }
      await route.fulfill({ response, body });
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => { const d = document.querySelector('#stage')?.dataset; return d?.controlReady === 'true' || d?.controlError === 'true'; }, undefined, { timeout: 180000 });
      assert.equal(await page.locator('#stage').getAttribute('data-control-error'), null);
      const before = await page.locator('#stage').getAttribute('data-render-frames');
      await page.evaluate(() => window.control.setView('well'));
      await page.waitForFunction(value => document.querySelector('#stage')?.dataset.renderFrames !== value, before, { timeout: 120000 });
      const record = await page.evaluate(() => ({ ...window.__ealdholtWallControl, floorShaderCompiles: window.__ealdholtWallFloorCompiles ?? 0, dataset: { ...document.querySelector('#stage').dataset } }));
      assert.ok(seams.renderer >= 1 && seams.view >= 1, 'Both diagnostic module seams must be exercised.');
      assert.ok(seams.productionFloorBypass >= 1, 'Production floor must be bypassed in every diagnostic variant.');
      assert.ok(record.meshCount > 0 && record.materialCount === 1 && record.injections >= 2);
      for (const [actual, expected] of [[JSON.parse(record.dataset.cameraPosition), [22, 2.8, 29]], [JSON.parse(record.dataset.cameraTarget), [14.5, 1.9, 29.5]]]) {
        assert.ok(actual.every((coordinate, index) => Math.abs(coordinate - expected[index]) < 1e-6), 'CPU-audit camera must remain unchanged.');
      }
      assert.equal(record.dataset.cameraFov, '55.000');
      if (variant === 'normal-off') assert.equal(record.after[0].normalMap, null);
      if (variant === 'sheen-off') assert.equal(record.after[0].sheen, 0);
      if (variant === 'shadow-off') assert.equal(record.receivingMeshes, 0);
      if (variant === 'sheen-floor') { assert.equal(record.after[0].diagnosticSheenFloor, 0.07); assert.ok(record.floorShaderCompiles > 0, 'The diagnostic shader floor must actually compile.'); }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `${variant}.png`), timeout: 120000 });
      const pixels = await sharp(resolve(output, `${variant}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      record.auditPixels = [[520, 218], [519, 210], [625, 225]].map(([x, y]) => {
        const offset = (y * pixels.info.width + x) * 4; let zeros = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const at = ((y + dy) * pixels.info.width + x + dx) * 4;
          if (pixels.data[at] === 0 && pixels.data[at + 1] === 0 && pixels.data[at + 2] === 0) zeros++;
        }
        return { pixel: [x, y], rgb: [...pixels.data.subarray(offset, offset + 3)], zeroPixelsIn5x5: zeros };
      });
      records.push({ ...record, fixture, seams, errors });
      console.log(`CAPTURED wall ${variant}: ${record.meshCount} meshes / ${record.materialCount} material`);
    } finally {
      await page.evaluate(() => window.control?.dispose()).catch(() => {});
      await context.close();
    }
  }
  const tiles = await Promise.all(variants.map(async (variant, index) => ({
    input: await sharp(resolve(output, `${variant}.png`)).resize(300, 169).jpeg({ quality: 76 }).toBuffer(),
    left: (index % 2) * 300, top: Math.floor(index / 2) * 193 + 24,
  })));
  const height = Math.ceil(variants.length / 2) * 193;
  const labels = Buffer.from(`<svg width="600" height="${height}"><style>text{font:13px sans-serif;fill:#ead6aa}</style>${variants.map((v,i) => `<text x="${i%2*300+8}" y="${Math.floor(i/2)*193+17}">${v}</text>`).join('')}</svg>`);
  await sharp({ create: { width: 600, height, channels: 3, background: '#141914' } }).composite([...tiles, { input: labels, left: 0, top: 0 }]).jpeg({ quality: 78 }).toFile(resolve(output, 'wall-controls.jpg'));
} finally {
  await writeFile(resolve(output, 'wall-controls.json'), JSON.stringify({ diagnostic: 'Same real Desktop renderer, exact CPU-audit camera and model; one verified wall property changed per diagnostic browser module copy. No production source or source-asset changes. Software rendering does not prove headset or hardware performance.', records }, null, 2));
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
