// Isolated art diagnostic using the real Desktop village renderer. This is not
// a gameplay or headset test. Fixtures must come from the private asset server.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { createHash } from 'node:crypto';
import sharp from "sharp";

// Test-only observation of the browser's real WebGL calls. Original calls,
// arguments, results and application render scheduling remain unchanged.
function installRenderObservation({ readDrawErrors = false } = {}) {
  const values = { draws: 0, submittedTriangles: 0, lifetimeDraws: 0, lifetimeTriangles: 0, shaderCompiles: [], programLinks: [], contextLosses: [],
    frames: [], textureCompareEvents: [], drawErrorChecks: 0, drawErrors: [] };
  const clock = () => { const at = performance.now(); return { at, epochMs: performance.timeOrigin + at }; };
  const state = () => {
    const d = document.querySelector('#stage')?.dataset;
    return d ? { renderFrames: d.renderFrames, renderTriangles: d.renderTriangles, planarPondStatus: d.planarPondStatus, planarPondUpdates: d.planarPondUpdates,
      shadowMapSize: d.shadowMapSize, shadowHalfSize: d.shadowHalfSize, shadowTreeTriangles: d.shadowTreeTriangles } : null;
  };
  let previousDraws = 0, previousTriangles = 0;
  const documentObserver = new MutationObserver(() => {
    const host = document.querySelector('#stage'); if (!host) return;
    documentObserver.disconnect();
    new MutationObserver(() => {
      values.frames.push({ ...clock(), state: state(), submittedDrawDelta: values.lifetimeDraws - previousDraws,
        submittedTriangleDelta: values.lifetimeTriangles - previousTriangles });
      previousDraws = values.lifetimeDraws; previousTriangles = values.lifetimeTriangles;
    }).observe(host, { attributes: true, attributeFilter: ['data-render-frames'] });
  });
  documentObserver.observe(document, { childList: true, subtree: true });
  const contexts = new WeakSet();
  const remember = gl => {
    if (contexts.has(gl)) return;
    contexts.add(gl);
    gl.canvas.addEventListener('webglcontextlost', event => values.contextLosses.push({ at: performance.now(), status: event.statusMessage ?? '' }));
  };
  for (const proto of [globalThis.WebGLRenderingContext?.prototype, globalThis.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'compileShader', 'linkProgram', 'texParameteri']) {
      const original = proto[name];
      if (typeof original !== 'function' || original.__crownfallRenderObserver) continue;
      const observed = function (...args) {
        remember(this);
        const result = original.apply(this, args);
        if (name === 'compileShader') {
          const compiled = this.getShaderParameter(args[0], this.COMPILE_STATUS);
          values.shaderCompiles.push({ compiled, log: compiled ? '' : this.getShaderInfoLog(args[0]) });
        } else if (name === 'linkProgram') {
          const linked = this.getProgramParameter(args[0], this.LINK_STATUS);
          values.programLinks.push({ linked, log: linked ? '' : this.getProgramInfoLog(args[0]) });
        } else if (name === 'texParameteri') {
          if (args[1] === this.TEXTURE_COMPARE_MODE || args[1] === this.TEXTURE_COMPARE_FUNC) values.textureCompareEvents.push({ ...clock(), parameter: args[1], value: args[2], state: state() });
        } else {
          values.draws++;
          const count = name.startsWith('drawArrays') ? args[2] : name === 'drawRangeElements' ? args[3] : args[1];
          const instances = name.endsWith('Instanced') ? args[name === 'drawArraysInstanced' ? 3 : 4] : 1;
          const triangles = args[0] === this.TRIANGLES ? count / 3 : args[0] === this.TRIANGLE_STRIP || args[0] === this.TRIANGLE_FAN ? Math.max(0, count - 2) : 0;
          values.submittedTriangles += triangles * instances;
          values.lifetimeDraws++; values.lifetimeTriangles += triangles * instances;
          if (readDrawErrors) {
            const code = this.getError(); values.drawErrorChecks++;
            if (code !== this.NO_ERROR) values.drawErrors.push({ ...clock(), code, afterCall: name, state: state(), latestTextureCompare: values.textureCompareEvents.at(-1) ?? null });
          }
        }
        return result;
      };
      observed.__crownfallRenderObserver = true;
      proto[name] = observed;
    }
  }
  window.__crownfallRenderObservation = {
    snapshot: () => structuredClone(values),
    resetDraws: () => { values.draws = 0; values.submittedTriangles = 0; },
  };
}

const fixtures = process.argv.slice(2).filter(argument => argument !== '--prepare-only');
const villageViews = process.env.CROWNFALL_CAPTURE_VIEWS === "1";
const environmentPair = process.env.CROWNFALL_CAPTURE_ENVIRONMENT_PAIR === '1';
const comparisonTerrainView = process.env.CROWNFALL_CAPTURE_TERRAIN_VIEW || 'overview';
assert.ok(['overview', 'riverside'].includes(comparisonTerrainView), 'The matched terrain diagnostic uses an existing authored view.');
const flatPondControl = process.env.CROWNFALL_FLAT_POND_CONTROL === "1";
const planarPondControl = process.env.CROWNFALL_CAPTURE_PLANAR_POND === '1';
const pondShoreControl = process.env.CROWNFALL_CAPTURE_POND_SHORE === '1';
const readDrawErrors = process.env.CROWNFALL_CAPTURE_GL_ERRORS === '1';
const normalFactoryDefaults = process.env.CROWNFALL_CAPTURE_NORMAL_DEFAULTS === '1';
const normalEntryRequested = process.env.CROWNFALL_CAPTURE_NORMAL_ENTRY === '1';
const cdpScreenshots = process.env.CROWNFALL_CAPTURE_CDP === '1';
const pausedFrameCapture = process.env.CROWNFALL_CAPTURE_PAUSED_FRAME === '1';
const screenshotTimeoutMs = Number(process.env.CROWNFALL_CAPTURE_SHOT_TIMEOUT_MS || 15000);
assert.ok(Number.isSafeInteger(screenshotTimeoutMs) && screenshotTimeoutMs >= 1000 && screenshotTimeoutMs <= 30000);
const flatPondRoughness = process.env.CROWNFALL_FLAT_POND_ROUGHNESS === undefined ? undefined : Number(process.env.CROWNFALL_FLAT_POND_ROUGHNESS);
if (flatPondRoughness !== undefined) assert.ok(flatPondControl && Number.isFinite(flatPondRoughness) && flatPondRoughness >= 0 && flatPondRoughness <= 1, 'Explicit pond roughness is restricted to the flat diagnostic.');
const distantCoastControl = process.env.CROWNFALL_CAPTURE_DISTANT_COAST === "1";
const captureOrbit = process.env.CROWNFALL_CAPTURE_ORBIT?.split(',').map(Number);
if (captureOrbit) assert.ok(villageViews && captureOrbit.length === 3 && captureOrbit.every(value => Number.isFinite(value) && Math.abs(value) <= 1.5), 'Orbit diagnostic needs three finite bounded deltas.');
const captureQuality = process.env.CROWNFALL_CAPTURE_QUALITY || "high";
assert.ok(["low", "medium", "high"].includes(captureQuality));
assert.ok(!planarPondControl || (captureQuality === 'high' && !flatPondControl), 'The planar pond diagnostic requires High and cannot combine with flat-pond controls.');
assert.ok(!pondShoreControl || (captureQuality === 'high' && !flatPondControl), 'The shore study uses High with the authored pond normal.');
if (normalFactoryDefaults) assert.ok(!environmentPair && !flatPondControl && !planarPondControl && !pondShoreControl && !distantCoastControl && !captureOrbit && flatPondRoughness === undefined, 'Normal factory captures leave every optional study flag unset.');
assert.ok(!distantCoastControl || captureQuality !== "low", "Distant coast is a Desktop geometry diagnostic; Low uses the bounded Quest geometry profile.");
const captureWidth = Number(process.env.CROWNFALL_CAPTURE_WIDTH || (villageViews ? 1280 : 960));
assert.ok(Number.isInteger(captureWidth) && captureWidth >= 320 && captureWidth <= 1920);
const viewport = { width: captureWidth, height: Math.round(captureWidth * (villageViews ? 9 / 16 : 3 / 4)) };
const requestedViews = (process.env.CROWNFALL_CAPTURE_ONLY || (environmentPair ? `lakeside,${comparisonTerrainView}` : "overview,churchyard,well,lakeside,aerial-reference")).split(",");
for (const view of requestedViews) assert.ok(["overview", "churchyard", "well", "lakeside", "riverside", "aerial-reference"].includes(view));
assert.ok(fixtures.length, "Pass one or more loopback fixture GLB URLs.");
for (const value of fixtures) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.endsWith(".glb"));
}
if (environmentPair) {
  assert.ok(villageViews && captureQuality === 'high' && captureWidth === 1280 && fixtures.length === 1, 'The bounded environment comparison uses one unchanged Desktop source at High1280.');
  assert.deepEqual(requestedViews, ['lakeside', comparisonTerrainView]);
  assert.ok(!flatPondControl && flatPondRoughness === undefined && !captureOrbit && !planarPondControl && !pondShoreControl && !distantCoastControl, 'The comparison owns its isolated feature toggles; no additional camera/material controls.');
}
const variants = environmentPair ? [
  { id: 'baseline', views: ['lakeside', comparisonTerrainView], flat: false, planar: false, coast: false },
  { id: 'planar-pond', views: ['lakeside'], flat: false, planar: true, coast: false },
  { id: 'distant-coast', views: [comparisonTerrainView], flat: false, planar: false, coast: true },
] : [{ id: 'control', views: requestedViews, flat: flatPondControl, planar: planarPondControl, shore: pondShoreControl, coast: distantCoastControl }];
const output = resolve(process.env.CROWNFALL_TREE_ARTIFACTS || "artifacts/ealdholt-preview/tree-controls");
await mkdir(output, { recursive: true });
if (process.argv.includes('--prepare-only')) {
  console.log(JSON.stringify({ browserStarted: false, quality: captureQuality, viewport, requestedViews, variants, flatPondControl, flatPondRoughness, planarPondControl, pondShoreControl, distantCoastControl, readDrawErrors, normalFactoryDefaults, normalEntryRequested, cdpScreenshots, pausedFrameCapture, screenshotTimeoutMs, fixtureCount: fixtures.length }));
  process.exit(0);
}
let browser;
let failure = null;
const records = [];
let contact = null;
let normalEntry = null;
async function screenshot(page, file) {
  if (!cdpScreenshots) { await page.screenshot({ path: file, timeout: 120000 }); return { method: 'Playwright page screenshot' }; }
  const session = await page.context().newCDPSession(page); let timer;
  const startedAt = Date.now();
  try {
    const shot = await Promise.race([
      session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x: 0, y: 0, ...viewport, scale: 1 } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Public CDP screenshot exceeded ${screenshotTimeoutMs}ms; no retry.`)), screenshotTimeoutMs); }),
    ]);
    const bytes = Buffer.from(shot.data, 'base64'); await writeFile(file, bytes);
    return { method: 'Public CDP Page.captureScreenshot; no font wait or application mutation', startedAt, completedAt: Date.now(), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
  } finally { clearTimeout(timer); await session.detach().catch(() => undefined); }
}
async function captureNormalEntry() {
  const page = await browser.newPage({ viewport }), errors = [], warnings = [];
  normalEntry = { passed: false, fixturesSeeded: 0, confirmationClicks: 0, interactions: [], errors, warnings };
  const digest = values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null ? null : { bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') }]));
  const stores = () => page.evaluate(() => { const values = { 'crownfall.legacy.save': localStorage.getItem('crownfall.legacy.save'), 'crownfall.legacy.aethelgard.inherited-session': localStorage.getItem('crownfall.legacy.aethelgard.inherited-session') }; for (const key of Object.keys(localStorage)) if (/^crownfall\.(legacy|estate)\./.test(key)) values[key] = localStorage.getItem(key); return values; });
  const uiState = () => page.evaluate(() => ({ url: location.href, menu: document.querySelector('.menu-shell')?.dataset ? { ...document.querySelector('.menu-shell').dataset } : null, visibleButtons: [...document.querySelectorAll('button')].filter(e => e.getClientRects().length).map(e => e.getAttribute('aria-label') || e.textContent), bodyText: document.body.innerText.slice(0, 16000) }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); else if (message.type() === 'warning') warnings.push(message.text()); });
  try {
    await page.addInitScript(() => { window.__normalCaptureWrites = []; for (const name of ['setItem', 'removeItem', 'clear']) { const original = Storage.prototype[name]; Storage.prototype[name] = function (...args) { if (this === localStorage) window.__normalCaptureWrites.push({ operation: name, key: name === 'clear' ? '*' : String(args[0]) }); return original.apply(this, args); }; } });
    await page.goto(new URL('/', appOrigin).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal(new URL(page.url()).search, '');
    await page.waitForFunction(() => document.querySelector('.menu-shell')?.getAttribute('data-boot-state') === 'ready' || [...document.querySelectorAll('button')].some(e => e.getClientRects().length && e.textContent?.startsWith('Continue to menu')), undefined, { timeout: 60000 });
    const proceed = page.getByRole('button', { name: 'Continue to menu', exact: false });
    if (await proceed.isVisible()) { await proceed.click(); normalEntry.interactions.push('Continue to menu'); }
    await page.locator('.menu-shell[data-boot-state="ready"]').waitFor({ timeout: 45000 });
    await page.getByRole('tab', { name: 'Home', exact: true }).click(); normalEntry.interactions.push('Home tab');
    await page.locator('.home-grid').waitFor(); const before = await stores(); normalEntry.before = digest(before);
    await page.getByRole('button', { name: 'My Legacy', exact: true }).click(); normalEntry.interactions.push('My Legacy home tile');
    const ui = page.locator('.ealdholt-preview[aria-hidden="false"]'); await ui.waitFor({ timeout: 45000 });
    assert.equal(await ui.getAttribute('data-ealdholt-mode'), 'inherited');
    await ui.locator('.ealdholt-intro .is-primary').waitFor({ timeout: 45000 });
    normalEntry.ui = await uiState(); const after = await stores(); normalEntry.after = digest(after);
    assert.ok(Object.keys(before).length === Object.keys(after).length && Object.keys(before).every(key => before[key] === after[key]), 'Save bytes changed; only digests are retained.');
    normalEntry.relevantWrites = await page.evaluate(() => window.__normalCaptureWrites.filter(write => write.operation === 'clear' || /^crownfall\.(legacy|estate)\./.test(write.key)));
    assert.equal(normalEntry.relevantWrites.length, 0); normalEntry.passed = true;
    normalEntry.storageQualification = Object.values(before).some(v => v !== null) ? 'Observed populated entries retained; no fixtures.' : 'Empty isolated context; absence retained, not a populated-save migration test.';
    console.log('PASS normal plain-URL Home -> My Legacy; zero save writes');
    await writeFile(resolve(output, 'normal-entry.json'), JSON.stringify(normalEntry, null, 2));
    try { await page.locator('.ealdholt-preview[data-ealdholt-world="ready"]').waitFor({ timeout: 90000 }); normalEntry.worldReady = true; } catch (error) { normalEntry.worldReady = false; normalEntry.worldWaitFailure = String(error.message); }
    const file = resolve(output, 'normal-home-my-legacy.png');
    try { normalEntry.capture = await screenshot(page, file); normalEntry.file = file; await sharp(file).resize({ width: 600 }).jpeg({ quality: 82 }).toFile(resolve(output, 'normal-home-my-legacy-600.jpg')); }
    catch (error) { normalEntry.screenshotFailure = String(error.message); }
  } catch (error) { normalEntry.failure = String(error.stack || error); try { normalEntry.failureUI = await uiState(); } catch {} }
  finally { await writeFile(resolve(output, 'normal-entry.json'), JSON.stringify(normalEntry, null, 2)); await page.close(); }
}
async function writeContact() {
  const captured = records.filter(record => record.file);
  if (normalEntry?.file) captured.push({ file: normalEntry.file, variant: 'ordinary plain-URL UI', pose: 'inherited intro', qualityLabel: 'actual menu preference' });
  if (environmentPair) captured.sort((a, b) => requestedViews.indexOf(a.pose) - requestedViews.indexOf(b.pose) || Number(a.variant !== 'baseline') - Number(b.variant !== 'baseline'));
  if (!captured.length) return;
  const imageHeight = Math.round(600 * viewport.height / viewport.width), rowHeight = imageHeight + 30;
  const layers = [];
  for (const [row, record] of captured.entries()) {
    const title = `${record.variant || 'Control'} / ${record.pose} / ${record.qualityLabel || captureQuality}${record.pausedActualFrame ? ' / paused actual frame' : ''}`;
    layers.push({ input: Buffer.from(`<svg width="600" height="30"><rect width="600" height="30" fill="#171b1b"/><text x="12" y="21" fill="#ffffff" font-family="sans-serif" font-size="15">${title}</text></svg>`), left: 0, top: row * rowHeight });
    layers.push({ input: await sharp(record.file).resize(600, imageHeight).toBuffer(), left: 0, top: row * rowHeight + 30 });
  }
  contact = resolve(output, 'environment-review-contact-600.jpg');
  await sharp({ create: { width: 600, height: rowHeight * captured.length, channels: 3, background: '#171b1b' } }).composite(layers).jpeg({ quality: 85 }).toFile(contact);
}
const appOrigin = process.env.CROWNFALL_TEST_URL || "http://127.0.0.1:5173";
const server = createServer((request, response) => {
  if (request.url === "/favicon.ico") { response.writeHead(204).end(); return; }
  const requestURL = new URL(request.url, "http://127.0.0.1"), index = Number(requestURL.pathname.slice(1));
  const variant = variants.find(value => value.id === requestURL.searchParams.get('variant')) || variants[0];
  if (!Number.isInteger(index) || !fixtures[index]) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html><head><base href=${JSON.stringify(new URL('/', appOrigin).href)}><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="stage"></div><script type="module">
    import { createEaldholtVillageView } from ${JSON.stringify(new URL('/src/legacy/aethelgard/village-view.ts', appOrigin).href)};
    const host=document.querySelector('#stage');
    window.control=createEaldholtVillageView({host,modelUrl:${JSON.stringify(fixtures[index])},quality:{preset:${JSON.stringify(captureQuality)},renderScale:100,frameLimit:30},active:true,reducedMotion:true,panelMode:'village',label:'Source tree control',diagnosticFlatPond:${variant.flat ? 'true' : 'undefined'},diagnosticFlatPondRoughness:${flatPondRoughness ?? 'undefined'},diagnosticPlanarPond:${variant.planar ? 'true' : 'undefined'},diagnosticPondShore:${variant.shore ? 'true' : 'undefined'},diagnosticDistantCoast:${variant.coast ? 'true' : 'undefined'},onReady(){host.dataset.controlReady='true'},onError(){host.dataset.controlError='true'}});
    window.control.setInteractive(true);
    ${villageViews && variant.views[0] !== 'riverside' && variant.views[0] !== 'aerial-reference'
      ? `window.control.setView(${JSON.stringify(variant.views[0])});` : ''}
  </script></body></html>`);
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  for (const [index, fixture] of fixtures.entries()) {
   for (const variant of variants) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors = [];
    const warnings = [], failedRequests = [];
    const consoleEntries = [], protocolEntries = []; let phase = 'initialization';
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); else if (message.type() === 'warning') warnings.push(message.text());
      if (['error', 'warning'].includes(message.type())) consoleEntries.push({ receivedAt: Date.now(), phase, level: message.type(), message: message.text(), location: message.location() }); });
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? '' }));
    const protocol = await page.context().newCDPSession(page);
    protocol.on('Log.entryAdded', ({ entry }) => { if (['warning', 'error'].includes(entry.level)) protocolEntries.push({ ...entry, phase, method: 'Log.entryAdded' }); });
    protocol.on('Runtime.consoleAPICalled', event => { if (['warning', 'error'].includes(event.type)) protocolEntries.push({ timestamp: event.timestamp, level: event.type, text: event.args.map(arg => arg.value ?? arg.description ?? '').join(' '), phase, method: 'Runtime.consoleAPICalled' }); });
    await protocol.send('Log.enable'); await protocol.send('Runtime.enable');
    await page.addInitScript(installRenderObservation, { readDrawErrors });
    await page.goto(`http://127.0.0.1:${server.address().port}/${index}?variant=${variant.id}`);
    try {
      await page.waitForFunction(() => { const d = document.querySelector("#stage")?.dataset; return d?.controlReady === "true" || d?.controlError === "true"; }, undefined, { timeout: 180000 });
      assert.equal(await page.locator("#stage").getAttribute("data-control-error"), null);
      if (normalFactoryDefaults) {
        const data = await page.locator('#stage').evaluate(node => ({ ...node.dataset }));
        assert.equal(data.bankLandformStatus, 'active');
        assert.ok(Number(data.bankLandformTrianglesAdded) > 0 && Number(data.bankLandformMovedVertices) > 0);
        assert.equal(data.distantCoastStatus, 'disabled');
        assert.equal(data.planarPondStatus, 'disabled');
        assert.equal(data.pondShoreStatus, 'disabled');
      }
      if (variant.coast) {
        assert.equal(await page.locator("#stage").getAttribute("data-distant-coast-status"), "active");
        assert.equal(await page.locator("#stage").getAttribute("data-distant-coast-draw-calls"), "2");
        const triangles = Number(await page.locator("#stage").getAttribute("data-distant-coast-triangles"));
        // Frozen V5 bank intake:3186 extension+1800 conforming bank=4986.
        // Root-approved aggregate cap6000; model also bounds bank delta<=2000.
        assert.ok(triangles > 0 && triangles <= 6000);
        const totalBytes = Number(await page.locator('#stage').getAttribute('data-distant-coast-buffer-bytes'));
        const foregroundBytes = Number(await page.locator('#stage').getAttribute('data-distant-coast-foreground-bytes'));
        const extensionBytes = Number(await page.locator('#stage').getAttribute('data-distant-coast-extension-bytes'));
        // Owned foreground268848(including54000 new bank bytes)+extension108716
        // =377564 actual bytes. Bank tessellation adds no extra draw.
        assert.ok(foregroundBytes > 0 && extensionBytes > 0 && extensionBytes < 256 * 1024);
        assert.equal(totalBytes, foregroundBytes + extensionBytes);
        assert.ok(totalBytes <= 512 * 1024);
        const bounds = JSON.parse(await page.locator("#stage").getAttribute("data-distant-coast-bounds"));
        assert.ok(bounds.min[0] < -650 && bounds.min[2] < -650 && bounds.max[0] > 650 && bounds.max[2] > 650);
      }
      if (variant.flat) {
        assert.equal(await page.locator("#stage").getAttribute("data-pond-probe-status"), "bound");
        assert.equal(await page.locator("#stage").getAttribute("data-pond-normal-control"), "flat-diagnostic");
        if (flatPondRoughness !== undefined) assert.equal(Number(await page.locator("#stage").getAttribute("data-pond-probe-roughness")), flatPondRoughness);
      }
      if (variant.shore) {
        const data = await page.locator('#stage').evaluate(node => ({ ...node.dataset }));
        assert.equal(data.pondShoreRequested, 'true');
        assert.equal(data.pondShoreAppearanceDiagnostic, 'true');
        assert.equal(data.pondShoreStatus, 'applied');
        assert.equal(data.pondShoreError, '');
        const total = Number(data.pondShoreMaterials), pond = Number(data.pondShorePondMaterials);
        const terrain = Number(data.pondShoreTerrainMaterials), groundcover = Number(data.pondShoreGroundcoverMaterials);
        assert.ok(total > 0 && pond > 0 && terrain >= 0 && groundcover >= 0);
        assert.equal(total, pond + terrain + groundcover, 'Record the actual full-scene material roles without assuming the isolated fixture counts.');
        assert.equal(Number(data.pondShoreTextures), 1); assert.equal(Number(data.pondShoreTextureBytes), 87380);
        const qualification = JSON.parse(data.pondShoreQualification), field = JSON.parse(data.pondShoreField);
        assert.deepEqual([qualification.metrics.triangles, qualification.metrics.vertices, qualification.metrics.boundaryEdges], [46, 37, 26]);
        assert.ok(Math.abs(qualification.metrics.area - 176.25375547231903) < .000001);
        assert.equal(qualification.metrics.maximumDeviation, 0);
        assert.ok(qualification.metrics.projectedFraction >= .8);
        assert.deepEqual([field.width, field.height], [128, 128]);
        const contact = field.contact;
        assert.equal(contact?.mode, 'terrain-contact', 'The shore field must use actual drawn terrain contact.');
        assert.ok(Number.isSafeInteger(contact.terrainTriangles) && contact.terrainTriangles > 0);
        assert.ok(contact.segments > 0 && contact.terrainContactSegments > 0 && contact.capEdgeSegments >= 0);
        assert.equal(contact.segments, contact.terrainContactSegments + contact.capEdgeSegments);
        assert.ok(contact.length > 0 && contact.terrainContactLength > 0 && contact.terrainContactLength <= contact.length + .000001);
        // Input cropping can split collinear segments; preserve physical length,
        // not the uncropped CPU segment/triangle counts.
        assert.ok(Math.abs(contact.terrainContactLength - 27.4069717250557) < .00001);
      }
      if (environmentPair || variant.planar) {
        const data = await page.locator('#stage').evaluate(node => ({ ...node.dataset }));
        assert.equal(data.modelProfile, 'desktop');
        assert.equal(data.pondProbeStatus, 'bound');
        assert.equal(data.pondNormalControl, 'authored');
        assert.equal(Number(data.pondProbeRoughness), .24);
        assert.equal(data.planarPondStatus, variant.planar ? 'active' : 'disabled');
        if (variant.planar) {
          assert.equal(Number(data.planarPondSize), 512);
          assert.ok(Number(data.planarPondUpdates) > 0);
          assert.ok(Number(data.planarPondLastDrawCalls) > 0 && Number(data.planarPondLastTriangles) > 0);
          assert.ok(Number.isFinite(Number(data.planarPondPlaneDeviation)) && Number(data.planarPondPlaneDeviation) <= .0001);
          assert.ok(Number(data.planarPondCapTriangles) > 0 && Number(data.planarPondCapVertices) > 0);
          assert.ok(Number(data.planarPondCapArea) > 0 && Number.isFinite(Number(data.planarPondCapHeight)));
          assert.ok(Number(data.planarPondCapProjectedFraction) >= .8, 'The qualified top cap must cover the supported projected pond surface.');
          assert.equal(data.planarPondError || '', '');
        }
      }
    } catch (error) {
      records.push({ fixture, variant: variant.id, errors, failed: true, ...(await page.locator("#stage").evaluate(node => ({ ...node.dataset }))) });
      await screenshot(page, resolve(output, `control-load-failure-${index}-${variant.id}.png`));
      throw error;
    }
    const name = new URL(fixture).pathname.split("/").at(-1).replace(/\.glb$/, "");
    for (const pose of villageViews ? variant.views : ["far", "near"]) {
      phase = 'requested-view';
      const before = await page.locator("#stage").getAttribute("data-render-frames");
      if (villageViews || pose === 'near') await page.evaluate(() => window.__crownfallRenderObservation.resetDraws());
      if (villageViews) {
        await page.evaluate(({id, orbit}) => {
          window.control.setActive(true);
          window.control.setView(id === "aerial-reference" ? "overview" : id);
          if (id === "aerial-reference") window.control.orbit(-1.1965, -.079, .092);
          if (orbit) window.control.orbit(...orbit);
        }, {id: pose, orbit: captureOrbit});
        await page.waitForFunction(value => document.querySelector("#stage")?.dataset.renderFrames !== value, before, { timeout: 120000 });
      } else if (pose === "near") {
        await page.evaluate(() => window.control.orbit(0, .28, -.5));
        await page.waitForFunction(value => document.querySelector("#stage")?.dataset.renderFrames !== value, before);
      }
      if (variant.planar) await page.waitForFunction(() => Number(document.querySelector('#stage')?.dataset.planarPondUpdates) >= 2, undefined, { timeout: 120000 });
      const stem = `${name}${environmentPair ? '-' + variant.id : ''}-${pose}`, file = resolve(output, `${stem}.png`);
      phase = 'capture';
      let pausedActualFrame = null;
      if (pausedFrameCapture) {
        const before = await page.evaluate(() => { const state = { dataset: { ...document.querySelector('#stage').dataset }, gl: window.__crownfallRenderObservation.snapshot() }; window.control.setActive(false); return state; });
        await page.waitForTimeout(250);
        const after = await page.evaluate(() => ({ dataset: { ...document.querySelector('#stage').dataset }, gl: window.__crownfallRenderObservation.snapshot() }));
        for (const key of ['renderFrames', 'renderTriangles', 'environmentTime', 'fireTime', 'cameraPosition', 'cameraTarget', 'cameraFov', 'cameraYaw', 'cameraPitch', 'cameraDistance']) assert.equal(after.dataset[key], before.dataset[key], `Pause changed ${key}`);
        assert.equal(after.gl.lifetimeDraws, before.gl.lifetimeDraws); assert.equal(after.gl.lifetimeTriangles, before.gl.lifetimeTriangles);
        pausedActualFrame = { method: 'Genuine requested world frame, then existing setActive(false); no geometry/camera/time change.', before, after, stable: true };
      }
      const captureCheckpoint = { fixture, variant: variant.id, pose, ...(await page.locator('#stage').evaluate(node => ({ ...node.dataset }))),
        pausedActualFrame, observation: await page.evaluate(() => window.__crownfallRenderObservation.snapshot()), errors: [...errors], warnings: [...warnings] };
      await writeFile(resolve(output, `${stem}-before-capture.json`), JSON.stringify(captureCheckpoint, null, 2));
      let capture;
      try { capture = await screenshot(page, file); }
      catch (error) { records.push({ ...captureCheckpoint, failed: true, screenshotFailure: String(error.message) }); throw error; }
      await sharp(file).resize({ width: 600 }).jpeg({ quality: 82 }).toFile(resolve(output, `${stem}-600.jpg`));
      const observation = await page.evaluate(() => window.__crownfallRenderObservation.snapshot());
      records.push({ fixture, variant: variant.id, pose, file, capture, pausedActualFrame, ...(await page.locator("#stage").evaluate(node => ({ ...node.dataset }))), observation, reducedMotion: true,
        drawObservationScope: 'Actual browser submissions since the requested view redraw; includes all shadow/reflection passes, not an in-view hardware performance budget.',
        errors: [...errors], warnings: [...warnings], consoleEntries: [...consoleEntries], protocolEntries: [...protocolEntries], failedRequests: [...failedRequests] });
      await writeFile(resolve(output, `${stem}.json`), JSON.stringify(records.at(-1), null, 2));
      assert.ok(observation.shaderCompiles.length > 0 && observation.programLinks.length > 0, 'The real browser must compile and link renderer programs.');
      assert.ok(observation.shaderCompiles.every(shader => shader.compiled) && observation.programLinks.every(program => program.linked), 'Actual WebGL shader compilation/linking failed.');
      assert.equal(observation.contextLosses.length, 0, 'The captured renderer must retain its live WebGL context.');
      assert.equal(observation.drawErrors.length, 0, 'The browser reported real WebGL errors after submitted draw calls.');
      console.log(JSON.stringify({ captured: pose, variant: variant.id, file, renderTriangles: records.at(-1).renderTriangles,
        submittedDraws: observation.draws, planarPondStatus: records.at(-1).planarPondStatus, shaderFailures: 0, errors: errors.length }));
    }
    const lifecycle = { method: 'Renderer-method diagnostic; not an application Pause input test.' };
    records.at(-1).lifecycle = lifecycle;
    const readLifecycle = () => page.locator('#stage').evaluate(node => ({ ...node.dataset }));
    lifecycle.beforePause = await readLifecycle();
    phase = 'pause'; await page.evaluate(() => window.control.setActive(false));
    await page.waitForTimeout(250);
    lifecycle.paused = await readLifecycle();
    assert.equal(lifecycle.paused.renderFrames, lifecycle.beforePause.renderFrames);
    assert.equal(lifecycle.paused.environmentTime, lifecycle.beforePause.environmentTime);
    if (variant.planar) assert.equal(lifecycle.paused.planarPondUpdates, lifecycle.beforePause.planarPondUpdates);
    phase = 'resume'; await page.evaluate(() => window.control.setActive(true));
    await page.waitForFunction(before => document.querySelector('#stage')?.dataset.renderFrames !== before, lifecycle.paused.renderFrames, { timeout: 120000 });
    lifecycle.reducedMotionResumed = await readLifecycle();
    assert.equal(lifecycle.reducedMotionResumed.environmentTime, lifecycle.paused.environmentTime);
    assert.equal(lifecycle.reducedMotionResumed.fireAnimated, 'false');
    lifecycle.finalRenderObservation = await page.evaluate(() => window.__crownfallRenderObservation.snapshot());
    lifecycle.consoleEntries = [...consoleEntries]; lifecycle.protocolEntries = [...protocolEntries];
    phase = 'dispose'; await page.evaluate(() => window.control.dispose());
    lifecycle.disposed = await readLifecycle();
    lifecycle.remainingCanvasCount = await page.locator('#stage canvas').count();
    assert.equal(lifecycle.disposed.pondProbeStatus, 'disposed');
    if (variant.planar) assert.equal(lifecycle.disposed.planarPondStatus, 'disposed');
    if (variant.shore) assert.equal(lifecycle.disposed.pondShoreStatus, 'disposed');
    assert.equal(lifecycle.remainingCanvasCount, 0);
    assert.equal(lifecycle.finalRenderObservation.drawErrors.length, 0, 'The resumed renderer reported a real WebGL error.');
    assert.deepEqual(lifecycle.protocolEntries.filter(entry => /GL_INVALID_|WebGL: INVALID_|GL_OUT_OF_MEMORY/i.test(entry.text ?? '')), [], 'Native WebGL warnings during lifecycle prevent a clean rendering pass.');
    await protocol.detach();
    await page.close();
    console.log(`CAPTURED ${name} ${variant.id}`);
   }
  }
  if (normalEntryRequested) { await captureNormalEntry(); assert.equal(normalEntry.passed, true, 'Ordinary plain-URL entry failed; state retained.'); }
  if (environmentPair) {
    const keys = ['modelFile', 'modelProfile', 'environment', 'cameraPosition', 'cameraTarget', 'cameraFov', 'cameraYaw', 'cameraPitch', 'cameraDistance',
      'pondNormalControl', 'pondProbeSource', 'pondProbeProfile', 'pondProbeModelSha256', 'pondProbeLightingVersion', 'pondProbeWidth', 'pondProbeHeight',
      'pondProbeRoughness', 'pondProbeNormalScaleMultiplier', 'pondProbeNormalScales', 'pondProbeFormat', 'pondProbeType', 'pondProbeColorSpace', 'pondProbeMapping', 'pondProbeFlipY'];
    for (const [pose, candidate] of [['lakeside', 'planar-pond'], [comparisonTerrainView, 'distant-coast']]) {
      const baseline = records.find(record => record.variant === 'baseline' && record.pose === pose);
      const result = records.find(record => record.variant === candidate && record.pose === pose);
      assert.ok(baseline && result);
      for (const key of keys) { assert.notEqual(baseline[key], undefined, `Missing matched metadata ${key}`); assert.equal(result[key], baseline[key], `Matched ${pose} metadata changed: ${key}`); }
    }
  }
  assert.deepEqual(records.flatMap(record => record.errors), []);
  assert.deepEqual(records.flatMap(record => record.warnings ?? []).filter(message => /GL_INVALID_|WebGL: INVALID_|GL_OUT_OF_MEMORY/i.test(message)), [], 'Native WebGL warnings prevent a clean rendering pass.');
  await writeContact();
} catch (error) {
  failure = String(error.stack || error);
  throw error;
} finally {
  try {
    await writeFile(resolve(output, "tree-controls.json"), JSON.stringify({ failure, passed: failure === null, contact, quality: captureQuality, viewport, captureOrbit, environmentPair, comparisonTerrainView, variants, flatPondControl, flatPondRoughness, planarPondControl, pondShoreControl, distantCoastControl, readDrawErrors, normalFactoryDefaults, normalEntryRequested, normalEntry, cdpScreenshots, screenshotTimeoutMs, comparisonScope: normalFactoryDefaults ? 'Normal factory defaults with every optional experiment disabled. Historical R6 coast included additional opt-in geometry; comparisons are not a pure material delta.' : null, getErrorObservation: readDrawErrors ? 'One original getError read after every observed draw; consumes its native error flag, no result override. CPU wall timings include diagnostic reads and are not GPU timing.' : 'Disabled', diagnostic: normalEntryRequested ? 'Three real factory views plus an ordinary plain-URL Home/My Legacy UI path. Factory-method lifecycle checks are not UI input coverage; the separate entry receipt identifies actual clicks. No Native/hardware performance evidence.' : villageViews ? "Art diagnostic using the real Desktop renderer/shared poses. HUD absent. Not UI interaction, Native rendering or hardware performance evidence." : "Same real Desktop renderer, shared overview then identical orbit delta. Isolated fixture, not full-village quality or gameplay evidence.", records }, null, 2));
  } finally {
    try { await browser?.close(); }
    finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
  }
}
