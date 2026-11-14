// Separate engine/asset calibration. Root runs the GPU; importing this module
// for CPU tests does not start either app, an SDK runtime, browser or renderer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const PRIVATE_ROOT = '/workspace/private-assets/elderbloom';

export function parsePondProbeCalibrationArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--platform', '--origin', '--output', '--mode'].includes(key) || key in values || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --platform desktop|quest --origin APP_LOOPBACK_ORIGIN --output NEW_PRIVATE_JSON [--mode procedural|capture].');
    values[key] = args[i + 1];
  }
  const platform = values['--platform'];
  if (!['desktop', 'quest'].includes(platform) || !values['--origin'] || !values['--output']) throw Error('Platform, actual app origin and new private JSON output are required.');
  const mode = values['--mode'] ?? 'procedural';
  if (!['procedural', 'capture'].includes(mode) || (mode === 'capture' && platform !== 'desktop')) throw Error('Capture/export/HDR-load calibration is Desktop-only; Native remains procedural and does not capture.');
  const url = new URL(values['--origin']), desktop = platform === 'desktop';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || url.protocol !== (desktop ? 'http:' : 'https:') || url.port !== (desktop ? '5173' : '8081')) {
    throw Error('Desktop must use its own loopback HTTP5173 origin; Quest must use its actual Native loopback HTTPS8081 origin. Never import Native through Desktop Vite.');
  }
  const output = values['--output'];
  if (!isAbsolute(output) || !/^[a-z0-9][a-z0-9._-]*\.json$/i.test(basename(output))) throw Error('Output must be an absolute new private JSON file.');
  return { platform, mode, origin: url.origin, output: resolve(output) };
}

export async function preparePrivateCalibrationArtifact(filename, privateRoot = PRIVATE_ROOT) {
  const root = resolve(privateRoot), output = resolve(filename), rel = relative(root, output);
  if (!isAbsolute(filename) || !rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('Calibration artifacts must stay inside private storage.');
  const assertDirectory = async path => {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw Error('Private calibration output cannot have symlink ancestors.');
  };
  await assertDirectory(root);
  let directory = root;
  for (const part of relative(root, dirname(output)).split(sep).filter(Boolean)) {
    directory = resolve(directory, part);
    try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await assertDirectory(directory);
  }
  try { await lstat(output); throw Error('Calibration output already exists; overwrite is refused.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { path: directory, root, filename: basename(output) };
}

async function writePrivateCalibrationFile(output, bytes, namePattern) {
  const file = resolve(output.path, output.filename), rel = relative(output.root, file), info = await lstat(output.path);
  if (!namePattern.test(output.filename) || !rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
    || !info.isDirectory() || info.isSymbolicLink() || await realpath(output.path) !== output.path) throw Error('Private calibration output changed or escaped its guarded directory.');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

export async function writePrivateCalibrationArtifact(output, bytes) {
  await writePrivateCalibrationFile(output, bytes, /^[a-z0-9][a-z0-9._-]*\.json$/i);
}

export async function preparePrivateCalibrationHdrArtifact(output) {
  const filename = output.filename.replace(/\.json$/i, '-synthetic-calibration.hdr');
  return preparePrivateCalibrationArtifact(resolve(output.path, filename), output.root);
}

export async function writePrivateCalibrationHdr(output, bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100 || bytes.byteLength > 8 * 1024 * 1024
    || Buffer.from(bytes.subarray(0, 11)).toString() !== '#?RADIANCE\n') throw Error('Expected a bounded original synthetic Radiance HDR.');
  await writePrivateCalibrationFile(output, bytes, /^[a-z0-9][a-z0-9._-]*-synthetic-calibration\.hdr$/i);
}

export async function calibrateEaldholtPondProbe(args = process.argv.slice(2)) {
  const options = parsePondProbeCalibrationArgs(args), output = await preparePrivateCalibrationArtifact(options.output);
  const hdrOutput = options.mode === 'capture' ? await preparePrivateCalibrationHdrArtifact(output) : null;
  const report = { passed: false, platform: options.platform, mode: options.mode, actualAppOrigin: options.origin, errors: [],
    limitations: 'Original synthetic engine/asset calibration using a separate software browser. Not village reflection, World/XR/UI input, actual Native AssetManager HDR loading, real pond parallax or physical headset performance proof.' };
  let browser, server, failure;
  const recordFailure = error => { failure ??= error; report.passed = false; report.errors.push(String(error.stack || error)); };
  try {
    server = createServer((request, response) => {
      if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (request.url !== '/') { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', 'text/html'); response.setHeader('Cache-Control', 'no-store');
      response.end(`<!doctype html><html><head><base href=${JSON.stringify(options.origin + '/')}><title>Private pond engine calibration</title></head><body><script type="module">
        let renderer,outcome;
        try {const {createEaldholtPondProbeCalibrationRenderer,runEaldholtPondProbeCalibration,runEaldholtPondProbeCaptureCalibration}=await import(${JSON.stringify(options.origin + '/src/legacy/aethelgard/pond-probe-calibration.ts')});
          renderer=createEaldholtPondProbeCalibrationRenderer();renderer.setPixelRatio(1);renderer.setSize(32,32,false);
          const value=${JSON.stringify(options.mode)}==='capture'?await runEaldholtPondProbeCaptureCalibration(renderer,'quest'):runEaldholtPondProbeCalibration(renderer,'quest');
          const {hdrBytes,...result}=value;let hdrBase64;
          if(hdrBytes){let binary='';for(let i=0;i<hdrBytes.length;i+=32768)binary+=String.fromCharCode(...hdrBytes.subarray(i,i+32768));hdrBase64=btoa(binary)}
          outcome={state:'ready',result,hdrBase64};
        } catch(error) {outcome={state:'failed',error:error?.stack||String(error)}}
        finally {try {renderer?.dispose();renderer?.forceContextLoss()}catch(error){outcome={state:'failed',error:'Renderer cleanup: '+(error?.stack||String(error))}}renderer=null}
        window.__privatePondCalibrationResult=outcome;
      </script></body></html>`);
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 64, height: 64 }, serviceWorkers: 'block', ignoreHTTPSErrors: options.platform === 'quest' });
    page.on('pageerror', error => report.errors.push(error.stack || error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__privatePondCalibrationResult, undefined, { timeout: 180000 });
    const outcome = await page.evaluate(() => { const value = window.__privatePondCalibrationResult; delete window.__privatePondCalibrationResult; return value; });
    if (outcome.state !== 'ready') throw Error(outcome.error || 'Engine calibration failed.');
    report.result = outcome.result;
    assert.equal(report.result.namespace, options.platform === 'quest' ? '@iwsdk/core' : 'three');
    assert.equal(report.result.threeRevision, '185'); assert.equal(report.result.samples.length, 8);
    if (options.mode === 'capture') {
      assert.equal(report.result.mode, 'capture');
      if (typeof outcome.hdrBase64 !== 'string' || outcome.hdrBase64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(outcome.hdrBase64)) throw Error('Invalid transient synthetic HDR export.');
      const bytes = Buffer.from(outcome.hdrBase64, 'base64'); await writePrivateCalibrationHdr(hdrOutput, bytes);
      report.syntheticHdr = { label: 'Original six-plane calibration only; not village reflection', file: hdrOutput.filename,
        bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    assert.equal(report.result.passed, true, 'Actual GPU cardinal/quarter-turn pixel checks failed; inspect the private JSON samples.');
    assert.deepEqual(report.errors, [], 'Unexpected browser errors during engine calibration.'); report.passed = true;
  } catch (error) { recordFailure(error); }
  finally {
    try { await browser?.close(); } catch (error) { recordFailure(error); }
    try { if (server?.listening) await new Promise(done => server.close(done)); } catch (error) { recordFailure(error); }
    try { await writePrivateCalibrationArtifact(output, JSON.stringify(report, null, 2)); } catch (error) { recordFailure(error); }
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const report = await calibrateEaldholtPondProbe(); console.log(`PRIVATE CALIBRATION PASS: ${report.platform} ${report.mode} / ${report.result.namespace} r${report.result.threeRevision}`); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
