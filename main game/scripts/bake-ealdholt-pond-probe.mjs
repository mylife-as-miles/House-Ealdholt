// PRIVATE offline authoring on a separate non-XR Desktop factory. This does
// not connect to the app's current page, expose its scene, or publish assets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { FloatType, REVISION } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const MAX_MODEL_BYTES = 256 * 1024 * 1024;
const PRIVATE_ROOT = '/workspace/private-assets/elderbloom';
const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:5173';
const SIZES = { desktop: [1024, 512], quest: [512, 256] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Reuse an already-owned Desktop server; this helper never starts Vite. */
export function readPondProbeAppOrigin(value) {
  if (value === undefined || value === '') return DEFAULT_APP_ORIGIN;
  const message = 'Pond probe app origin must be a simple HTTP loopback origin without credentials, path, query or fragment.';
  if (typeof value !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/i.test(value)) throw Error(message);
  let url;
  try { url = new URL(value); } catch { throw Error(message); }
  if (url.port === '0') throw Error(message);
  return url.origin;
}

export function parsePondProbeBakeArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--profile', '--model-url', '--output', '--lighting-version'].includes(key) || key in values || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw Error('Use --profile desktop|quest --model-url LOOPBACK_GLB --output NEW_PRIVATE_DIRECTORY --lighting-version EXPLICIT_REVISION.');
    }
    values[key] = args[i + 1];
  }
  const profile = values['--profile'], modelUrl = values['--model-url'], output = values['--output'], lightingVersion = values['--lighting-version'];
  if (!['desktop', 'quest'].includes(profile) || !modelUrl || !output || !lightingVersion || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(lightingVersion)) throw Error('Profile, model URL, private output and explicit lighting/assembly revision are required.');
  validatePondProbeModelUrl(modelUrl, profile);
  if (!isAbsolute(output)) throw Error('Private output must be an absolute NEW directory.');
  return { profile, modelUrl, output, lightingVersion };
}

export function validatePondProbeModelUrl(value, profile) {
  const url = new URL(value);
  if (!['desktop', 'quest'].includes(profile) || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !new RegExp(`^/elderbloom-village-${profile}-[a-z0-9][a-z0-9-]*\\.glb$`).test(url.pathname)) {
    throw Error('Use a simple loopback optimized GLB URL whose desktop/quest filename matches the requested geometry profile; original source is refused.');
  }
  return url;
}

/** Hash actual served bytes without retaining a model copy. Large originals,
 * redirects and mismatched GLB lengths fail before a browser is launched. */
export async function hashServedPondProbeModel(value, profile) {
  validatePondProbeModelUrl(value, profile);
  const response = await fetch(value, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw Error(`Private model request failed: ${response.status}.`);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || +declared > MAX_MODEL_BYTES || +declared < 28)) {
    await response.body.cancel(); throw Error('Private model must be a complete optimized GLB of at most 256 MiB.');
  }
  const hash = createHash('sha256'), header = Buffer.alloc(12), reader = response.body.getReader(); let bytes = 0, headerBytes = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read(); if (done) break;
      bytes += chunk.byteLength;
      if (bytes > MAX_MODEL_BYTES) throw Error('Private model exceeds 256 MiB; original source is refused.');
      if (headerBytes < 12) { const count = Math.min(12 - headerBytes, chunk.byteLength); header.set(chunk.subarray(0, count), headerBytes); headerBytes += count; }
      hash.update(chunk);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (bytes < 28 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== bytes
    || (declared !== null && +declared !== bytes)) throw Error('Served bytes are not a complete GLB2.');
  return { sha256: hash.digest('hex'), bytes };
}

function contained(path, root) { const rel = relative(root, path); return rel && !rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel); }
async function assertNoSymlinkChain(path) {
  const absolute = resolve(path); let current = absolute;
  for (;;) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error('Private output ancestors must be real directories, never symlinks.');
    const parent = dirname(current); if (parent === current) break; current = parent;
  }
  if (await realpath(absolute) !== absolute) throw Error('Private output has a noncanonical ancestor.');
}

export async function preparePrivatePondProbeOutput(output, privateRoot = PRIVATE_ROOT) {
  const root = resolve(privateRoot), destination = resolve(output);
  await assertNoSymlinkChain(root);
  if (!isAbsolute(output) || !contained(destination, root)) throw Error('Probe output must remain strictly inside private asset storage.');
  const parts = relative(root, dirname(destination)).split(sep).filter(Boolean); let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await assertNoSymlinkChain(current);
  }
  // Refuse even an empty existing output directory. Never overwrite a bake.
  await mkdir(destination, { mode: 0o700 });
  await assertNoSymlinkChain(destination);
  return { path: destination, root };
}

export async function writePrivatePondProbeFile(output, filename, bytes) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(filename) || !contained(output.path, output.root)) throw Error('Invalid private probe output.');
  await assertNoSymlinkChain(output.path);
  const handle = await open(resolve(output.path, filename), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

/** Decode through the public installed engine loader, not a handwritten
 * decoder. Record actual linear energy and spatial variation before writing. */
export function qualifyPondProbeHdr(bytes, profile) {
  assert.equal(REVISION, '185', 'Unexpected Desktop Three revision; refuse accidental renderer alias changes.');
  const size = SIZES[profile]; if (!['desktop', 'quest'].includes(profile) || bytes.length > 8 * 1024 * 1024 || bytes.length < 100) throw Error('Invalid private HDR size/profile.');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoded = new HDRLoader().setDataType(FloatType).parse(buffer);
  if (!decoded || decoded.width !== size[0] || decoded.height !== size[1] || !(decoded.data instanceof Float32Array)
    || decoded.data.length !== size[0] * size[1] * 4) throw Error('HDR loader dimensions/type do not match the requested profile.');
  let minimum = Infinity, maximum = -Infinity, nonblackPixels = 0, sum = 0, sumSquared = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i], g = decoded.data[i + 1], b = decoded.data[i + 2], alpha = decoded.data[i + 3];
    if (![r, g, b, alpha].every(Number.isFinite) || Math.min(r, g, b) < 0) throw Error('Decoded HDR contains invalid linear radiance.');
    minimum = Math.min(minimum, r, g, b); maximum = Math.max(maximum, r, g, b);
    const luminance = r * .2126 + g * .7152 + b * .0722; sum += luminance; sumSquared += luminance * luminance;
    if (luminance > 1e-6) nonblackPixels++;
  }
  const pixels = size[0] * size[1], meanLuminance = sum / pixels, varianceLuminance = Math.max(0, sumSquared / pixels - meanLuminance ** 2);
  const statistics = { passed: true, loader: 'public Three HDRLoader / FloatType', threeRevision: REVISION, width: size[0], height: size[1],
    minimumLinearRgb: minimum, maximumLinearRgb: maximum, meanLuminance, varianceLuminance, nonblackPixels, totalPixels: pixels,
    hdrBytes: bytes.length, hdrSha256: sha256(bytes), limitations: 'Finite varied radiance only; local landmarks, cube/HDR handedness and actual Native HDR loading still require visual/runtime qualification.' };
  if (nonblackPixels < pixels * .005 || maximum < 1e-4 || varianceLuminance < 1e-8) {
    throw Object.assign(Error('HDR is black or spatially constant; no qualified local probe was produced.'), { qualification: { ...statistics, passed: false } });
  }
  return statistics;
}

export async function bakeEaldholtPondProbe(args = process.argv.slice(2)) {
  const options = parsePondProbeBakeArgs(args), appOrigin = readPondProbeAppOrigin(process.env.EALDHOLT_POND_PROBE_APP_ORIGIN);
  const output = await preparePrivatePondProbeOutput(options.output);
  const requestedAdditionalBrowserArgs = ['--disable-dev-shm-usage'];
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const report = { passed: false, profile: options.profile, lightingVersion: options.lightingVersion, modelUrl: options.modelUrl,
    appOrigin, namespace: 'three', threeRevision: REVISION, errors: [], requestedAdditionalBrowserArgs,
    browserExecutableSelection: executablePath ? 'explicit-CHROMIUM_PATH' : 'playwright-bundled', requestedBrowserExecutablePath: executablePath ?? null,
    browserDefaultArguments: 'Playwright supplies default arguments in addition to the requested list; defaults may include sandbox-related flags. This is not a complete actual browser command line or a no-security-overrides claim.',
    limitations: 'Separate offline Desktop authoring with actual target-profile geometry and no explicit graphics-backend selection. Not Native HDR-loader, XR input, physical Quest, map-location or performance proof.' };
  let browser, server, failure;
  const recordFailure = error => { failure ??= error; report.passed = false; report.errors.push(String(error.stack || error)); };
  try {
    report.model = await hashServedPondProbeModel(options.modelUrl, options.profile);
    const quality = options.profile === 'quest' ? 'low' : 'high';
    report.factoryQuality = quality;
    server = createServer((request, response) => {
      if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (request.url !== '/') { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', 'text/html'); response.setHeader('Cache-Control', 'no-store');
      response.end(`<!doctype html><html><head><base href=${JSON.stringify(appOrigin + '/')}><style>html,body,#stage{margin:0;width:640px;height:360px;overflow:hidden}</style></head><body><div id="stage"></div><script type="module">
        import {createEaldholtVillageView} from ${JSON.stringify(appOrigin + '/src/legacy/aethelgard/village-view.ts')};
        let view; const finish=()=>setTimeout(()=>{view?.dispose();view=null},0);
        const fail=error=>{window.__privatePondProbeResult={state:'failed',error:error?.stack||String(error)};finish()};
        view=createEaldholtVillageView({host:document.querySelector('#stage'),modelUrl:${JSON.stringify(options.modelUrl)},
          quality:{preset:${JSON.stringify(quality)},renderScale:100,frameLimit:30},active:false,reducedMotion:true,panelMode:'village',label:'Private pond radiance authoring',
          onReady(){},onError(){fail(new Error('Private village factory failed'))},
          authorPondProbe:{profile:${JSON.stringify(options.profile)},modelSha256:${JSON.stringify(report.model.sha256)},lightingVersion:${JSON.stringify(options.lightingVersion)},
            onCapture(result){try {let binary='';for(let i=0;i<result.hdrBytes.length;i+=32768)binary+=String.fromCharCode(...result.hdrBytes.subarray(i,i+32768));
              window.__privatePondProbeResult={state:'ready',metadata:result.metadata,hdrBase64:btoa(binary),factoryDataset:{...document.querySelector('#stage').dataset}};finish()}catch(error){fail(error)}},onError:fail}});
      </script></body></html>`);
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: requestedAdditionalBrowserArgs });
    const page = await browser.newPage({ viewport: { width: 640, height: 360 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    page.on('pageerror', error => report.errors.push(error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__privatePondProbeResult, undefined, { timeout: 240000 });
    const result = await page.evaluate(() => { const result = window.__privatePondProbeResult; delete window.__privatePondProbeResult; return result; });
    if (result.state !== 'ready') throw Error(result.error || 'Private probe capture failed.');
    assert.equal(result.metadata.version, 1); assert.equal(result.metadata.format, 'radiance-rgbe');
    assert.equal(result.metadata.width, SIZES[options.profile][0]); assert.equal(result.metadata.height, SIZES[options.profile][1]);
    assert.ok(Number.isInteger(result.metadata.hiddenWaterSurfaceCount) && result.metadata.hiddenWaterSurfaceCount > 0);
    assert.equal(result.metadata.profile, options.profile); assert.equal(result.metadata.modelSha256, report.model.sha256);
    assert.equal(result.metadata.lightingVersion, options.lightingVersion); assert.equal(result.metadata.sourceAxes, true);
    assert.equal(result.metadata.neutralFillAlreadyBaked, true); assert.equal(result.metadata.realtime, false);
    if (typeof result.hdrBase64 !== 'string' || result.hdrBase64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.hdrBase64)) throw Error('Invalid transient HDR export.');
    const hdr = Buffer.from(result.hdrBase64, 'base64'); report.hdr = qualifyPondProbeHdr(hdr, options.profile);
    const finalModel = await hashServedPondProbeModel(options.modelUrl, options.profile);
    assert.deepEqual(finalModel, report.model, 'Served model changed during authoring; discard the probe.');
    assert.deepEqual(report.errors, [], 'Browser capture reported errors.');
    report.metadata = result.metadata;
    report.factoryDataset = result.factoryDataset;
    await writePrivatePondProbeFile(output, `pond-probe-${options.profile}.hdr`, hdr);
    await writePrivatePondProbeFile(output, `pond-probe-${options.profile}.metadata.json`, JSON.stringify(result.metadata, null, 2));
    report.passed = true;
  } catch (error) { if (error.qualification) report.hdr = error.qualification; recordFailure(error); }
  finally {
    try { await browser?.close(); } catch (error) { recordFailure(error); }
    try { if (server?.listening) await new Promise(done => server.close(done)); } catch (error) { recordFailure(error); }
    try { await writePrivatePondProbeFile(output, 'qualification.json', JSON.stringify(report, null, 2)); } catch (error) { recordFailure(error); }
  }
  if (failure) throw failure;
  return { output: output.path, ...report };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = await bakeEaldholtPondProbe(); console.log(`PRIVATE HDR READY: ${result.output}\nModel ${result.model.sha256}\nHDR ${result.hdr.hdrSha256}\nLinear range ${result.hdr.minimumLinearRgb}..${result.hdr.maximumLinearRgb}`); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
