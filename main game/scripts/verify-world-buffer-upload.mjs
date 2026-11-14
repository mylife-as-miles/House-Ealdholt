// Real WebGL2 API regression, not a village/demo scene or performance test.
// Run against the Desktop development server. No source assets or screenshots.
import assert from 'node:assert/strict';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const host = new URL(process.env.CROWNFALL_TEST_URL ?? 'http://127.0.0.1:4191');
assert.ok(['127.0.0.1', 'localhost'].includes(host.hostname));
const shared = resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/legacy/aethelgard/environment/world-preparation-queue.ts');
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
  await page.route('**/__crownfall-buffer-api-check', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><canvas id="canvas"></canvas>'}));
  await page.goto(new URL('/__crownfall-buffer-api-check', host).href);
  const result = await page.evaluate(async shared => {
    const T = await import('/node_modules/three/build/three.module.js');
    const {uploadWorldGeometry} = await import('/src/legacy/aethelgard/world-buffer-upload.ts');
    const {createWorldPreparationQueue} = await import('/@fs/' + shared);
    const renderer = new T.WebGLRenderer({canvas: document.querySelector('canvas'), antialias: false});
    renderer.setSize(16, 16); renderer.setClearColor(0x0000ff, 1);
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2;
    const original = new T.PlaneGeometry(1.8, 1.8), material = new T.MeshBasicMaterial({color: 0xff0000});
    const source = new T.Mesh(original, material); scene.add(source); renderer.render(scene, camera);
    const gl = renderer.getContext(), sample = () => {const pixel = new Uint8Array(4); gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel];};
    const before = sample(), cpu = original.clone(); cpu.computeBoundingBox(); cpu.computeBoundingSphere();
    const queue = createWorldPreparationQueue(() => {}); let value, error, done = false;
    uploadWorldGeometry(cpu, renderer, queue, new AbortController().signal, () => 0).then(v => {value = v; done = true;}, e => {error = e.message; done = true;});
    for (let i = 0; i < 100 && !done; i++) {queue.step(); await new Promise(r => setTimeout(r, 0));}
    if (!value) throw Error(error ?? 'Bounded upload did not complete.');
    const mesh = new T.Mesh(value.geometry, material), preview = new T.Group(); preview.add(mesh);
    await renderer.compileAsync(preview, camera, scene); preview.remove(mesh); cpu.dispose(); source.visible = false;
    const group = new T.Group(); group.matrixAutoUpdate = false; group.matrix.copy(source.matrix); scene.add(group); group.add(mesh);
    renderer.render(scene, camera); const after = sample(), glError = gl.getError();
    value.dispose(); queue.dispose(); original.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    return {before, after, glError};
  }, shared);
  console.log(JSON.stringify({result, errors, scope: '16px real WebGL API check; no world, asset, performance or headset claim.'}));
  assert.deepEqual(errors, []); assert.equal(result.glError, 0); assert.deepEqual(result.after, result.before); assert.equal(result.after[0], 255);
} finally {await browser.close();}
