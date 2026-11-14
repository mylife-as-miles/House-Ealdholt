// Actual-input acceptance of the NEW world-first composition. The previous
// recolouring harness is preserved privately. Root owns the browser/GPU lease.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { tsImport } from '../../main-game-vr/node_modules/tsx/dist/esm/api/index.mjs';
const shared = path => tsImport(`../../shared/legacy/${path}.ts`, import.meta.url);
const [state, reducer, heraldry, persistence, archive, entryStorage, entry, typography, interfaceCopy] = await Promise.all([
  shared('domain/state'), shared('domain/reducer'), shared('content/heraldry'), shared('domain/persistence'),
  shared('aethelgard/storage'), shared('aethelgard/inherited-storage'), shared('aethelgard/inherited-session'), shared('aethelgard/typography'), shared('aethelgard/interface-copy'),
]);
const peopleOnly = process.argv.includes('--people-only');
const phone = process.argv.includes('--phone-only') || peopleOnly;
const scope = peopleOnly ? 'world-first-phone-People-continuation' : phone ? 'world-first-phone' : 'world-first-desktop';
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(resolve(checkout, 'main game/src/legacy/aethelgard/AethelgardPreview.tsx'), 'utf8');
if (process.argv.includes('--prepare-only')) {
  const ready = source.includes('world-first') && source.includes('data-ealdholt-ui');
  console.log(JSON.stringify({ prepared: ready, browserStarted: false, scope }));
  process.exit(ready ? 0 : 1);
}
assert.ok(process.env.CROWNFALL_EALDHOLT_ARTIFACTS, 'Choose a private output directory.');
const directory = resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS), outputRelative = relative(checkout, directory);
assert.ok(outputRelative.startsWith('../') || outputRelative === '..', 'Keep evidence outside the checkout.');
await mkdir(directory, { recursive: true, mode: 0o700 });
const base = new URL(process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:4191');
base.searchParams.delete('ealdholt-preview'); base.searchParams.set('ealdholt-house', '1');
const hash = value => createHash('sha256').update(value).digest('hex');
const at = '2026-11-06T10:00:00.000Z';
const founded = reducer.reduceLegacy(state.createLegacyState({ at }), { type: 'found-banner', name: 'QA predecessor', nationId: 'aethelgard', heraldry: heraldry.defaultHeraldry('aethelgard'), motto: null, seed: 711, at });
const predecessor = `\n${JSON.stringify(founded.state, null, 2)}\n`; assert.ok(persistence.parseLegacySave(predecessor).ok);
const fixtures = { [persistence.LEGACY_STORAGE_KEY]: predecessor, [archive.AETHELGARD_STORAGE_KEY]: 'synthetic earlier experiment retained verbatim\n', 'crownfall.estate.save': 'synthetic independent estate retained verbatim\n' };
const ENTRY = entryStorage.INHERITED_SESSION_STORAGE_KEY;
const S = {
  intro: '[data-ealdholt-intro-continue]', presets: '[data-ealdholt-preset]', hero: '.wf-banner-scene .ealdholt-banner-display', rail: '[data-ealdholt-ui-region="crest"]',
  edit: '[data-ealdholt-customize]', editor: '[data-ealdholt-banner-drawer]', editorClose: '[data-ealdholt-banner-drawer] [data-ealdholt-drawer-close]',
  tab: '[data-ealdholt-section]', part: '[data-ealdholt-part="division"]', confirm: '[data-ealdholt-confirm]',
  views: '[data-ealdholt-tool="views"]', viewsPanel: '[data-ealdholt-tool-drawer="views"]', viewsClose: '[data-ealdholt-tool-drawer="views"] [data-ealdholt-drawer-close]',
  camera: '[data-ealdholt-tool="camera"]', cameraPanel: '[data-ealdholt-tool-drawer="camera"]', cameraClose: '[data-ealdholt-tool-drawer="camera"] [data-ealdholt-drawer-close]',
  people: '[data-ealdholt-household]', peoplePanel: '[data-ealdholt-ui-region="people"]', peopleClose: '[data-ealdholt-ui-region="people"] [data-ealdholt-drawer-close]',
  person: '[data-ealdholt-person-id]', personBack: '[data-ealdholt-person-back]', option: '[data-ealdholt-option]',
  activityOpen: 'button[data-ealdholt-activity-open]', activity: '[data-ealdholt-household-activity]', activityClose: '[data-ealdholt-activity-close]',
  home: '[data-ealdholt-home]', play: '[data-ealdholt-play]',
};
const report = { schemaVersion: 2, passed: false, startedAt: new Date().toISOString(), stage: 'setup',
  scope, viewport: phone ? { width: 844, height: 390 } : { width: 1280, height: 800 },
  preferences: { quality: 'high', motion: false, volume: 65, showHints: true }, reducedMotion: 'reduce',
  browserArgs: ['--disable-dev-shm-usage'], playwrightDefaultArgsPreserved: true,
  isolation: { freshContext: true, preparedInheritedSaves: 0, clockOverrides: 0, directAppActions: 0 },
  checks: [], stages: [], density: [], controls: [], assets: [], captures: [], errors: [], browserClosed: false,
  limitations: ['Software browser evidence does not establish physical Quest or hardware performance.',
    'UI bounding coverage includes transparent space and is not pixel occlusion.', 'Word budgets guide review; they never suppress truthful copy.',
    'Computed contrast qualifies opaque CSS backgrounds only, not composited glass pixels.', 'This is interface acceptance, not a recurring village day or physical NPC movement.'] };
let browser, context, page, savedRaw = null, assetIdentity = null, baselineCanvases = 0;
const requests = [], navigationEvents = [], root = () => page.locator('.ealdholt-preview[aria-hidden="false"]'), control = selector => root().locator(selector);
const safeDocumentUrl = raw => {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol)
    ? { origin: url.origin, pathname: url.pathname, queryKeys: [...url.searchParams.keys()], legacyRoute: url.searchParams.has('ealdholt-house') ? 'inherited' : url.searchParams.has('ealdholt-preview') ? 'preview' : null }
    : { protocol: url.protocol }; } catch { return { unreadable: true }; }
};
function navigationSummary() {
  const documentRequests = requests.filter(request => request.type === 'document');
  return { mainFrameUrl: page ? safeDocumentUrl(page.url()) : null, documentRequestCount: documentRequests.length,
    inferredAdditionalDocumentRequests: Math.max(0, documentRequests.length - 1), mainFrameNavigationCount: navigationEvents.length,
    mainFrameNavigations: [...navigationEvents] };
}
async function failureDiagnostics() {
  report.navigation = navigationSummary();
  if (!page || page.isClosed()) { report.failureDom = { unavailable: 'Page was not available.' }; return; }
  try {
    report.failureDom = await bounded(page.evaluate(() => {
      const roots = [...document.querySelectorAll('.ealdholt-preview')];
      const count = selector => document.querySelectorAll(selector).length;
      return { readyState: document.readyState, visibility: document.visibilityState,
        menuCount: count('.menu-shell'), homeCount: count('.home-grid'), loadingCount: count('.loading-screen'), viteOverlayCount: count('vite-error-overlay'),
        rootCount: roots.length, roots: roots.map(node => ({ ariaHidden: node.getAttribute('aria-hidden'), inert: node.hasAttribute('inert'),
          state: Object.fromEntries(['ealdholtUi', 'ealdholtStep', 'ealdholtWorld', 'ealdholtPaused', 'ealdholtMode', 'ealdholtSaved', 'ealdholtBusy', 'ealdholtDrawer'].map(key => [key, node.dataset[key] ?? null])),
          worldCount: node.querySelectorAll('.ealdholt-world').length })),
        navigationTypes: performance.getEntriesByType('navigation').map(entry => ({ type: entry.type, redirectCount: entry.redirectCount })) };
    }), 8000, 'read-only failure DOM diagnostics');
  } catch (error) { report.failureDom = { unavailable: 'Bounded read-only DOM observation did not finish.', errorName: error.name }; }
}
async function bounded(promise, ms, name) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(name + ' exceeded its bounded deadline.')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(read, name, ms = 45000) {
  let stopped = false;
  try { return await bounded((async () => { while (!stopped) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 200)); } })(), ms, name); }
  finally { stopped = true; }
}
async function stage(name, action, ms = 45000) {
  report.stage = name; report.stages.push({ name, at: new Date().toISOString() }); console.log('STAGE ' + name);
  return bounded(action(), ms, name);
}
const pass = name => { report.checks.push(name); console.log('PASS ' + name); };
async function stored(label, allowEntryChange = false) {
  const values = await bounded(page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))), 45000, 'storage observation');
  for (const [key, raw] of Object.entries(fixtures)) assert.equal(values[key], raw, 'Synthetic predecessor bytes changed.');
  if (savedRaw && !allowEntryChange) assert.equal(values[ENTRY], savedRaw, 'Read-only navigation must preserve confirmed entry.');
  report.stages.push({ name: label, storageDigests: Object.fromEntries(Object.entries(values).filter(([key]) => /^crownfall\.(legacy|estate)/.test(key)).map(([key, raw]) => [key, hash(raw)])) });
  return values;
}
async function assets(label) {
  const data = await bounded(control('.ealdholt-world').evaluate(node => ({ ...node.dataset })), 45000, 'actual source identity');
  assert.equal(data.modelReady, 'true'); assert.equal(data.modelProfile, 'desktop'); assert.equal(data.foliageQuality, 'high');
  assert.equal(data.pondProbeStatus, 'bound'); assert.equal(data.pondProbeProfile, 'desktop'); assert.equal(data.residentPreviewStatus, 'ready'); assert.equal(data.residentPreviewCount, '1');
  const identity = Object.fromEntries(['modelFile', 'modelProfile', 'foliageQuality', 'pondProbeModelSha256', 'pondProbeLightingVersion', 'pondProbeWidth', 'pondProbeHeight', 'residentPreviewRevision', 'daylightSunOffset', 'daylightSunIntensity'].map(key => [key, data[key]]));
  if (assetIdentity) assert.deepEqual(identity, assetIdentity, 'The interface must retain actual model/probe/resident/quality identity.'); else assetIdentity = identity;
  assert.ok(Number(data.renderFrames) > 0); assert.equal(await control('.ealdholt-world canvas').count(), 1); assert.ok(await page.locator('canvas').count() <= baselineCanvases + 1); assert.equal(await page.locator('iframe').count(), 0);
  report.assets.push({ label, identity, renderFrames: Number(data.renderFrames) });
}
async function focusReturns(selector, label) {
  const evidence = { label, selector, first: null, latest: null }; report.focusReturns ??= []; report.focusReturns.push(evidence);
  await until(async () => {
    const value = await bounded(root().evaluate((node, selector) => {
      const target = node.querySelector(selector), active = document.activeElement;
      const describe = element => element instanceof HTMLElement ? { tag: element.tagName, classes: String(element.className), dataset: { ...element.dataset },
        connected: element.isConnected, inertOrHidden: !!element.closest('[inert],[hidden]') } : null;
      return { matches: !!target && active === target, target: describe(target), active: describe(active), activeInside: !!active && node.contains(active) };
    }, selector), 45000, 'focus return observation');
    evidence.first ??= value; evidence.latest = value; return value.matches;
  }, label, 5000);
}
const rgba = color => {
  const values = color.match(/[\d.]+/g)?.map(Number); if (!values || !color.startsWith('rgb')) return null;
  return { channels: values.slice(0, 3), alpha: values[3] ?? 1 };
};
const luminance = channels => channels.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
async function auditControls(label, sweep = phone) {
  const info = await bounded(root().evaluate(node => {
    const all = [...node.querySelectorAll('[data-nav]')], visible = all.filter(element => element.checkVisibility() && !element.closest('[inert]'));
    const textOverflow = [];
    for (const button of node.querySelectorAll('button')) {
      if (!button.checkVisibility() || button.closest('[inert]')) continue;
      const outer = button.getBoundingClientRect(), walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT), rects = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('[aria-hidden="true"],svg,.ealdholt-sr-only')) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode); rects.push(...range.getClientRects());
      }
      rects.push(...[...button.querySelectorAll('svg')].map(svg => svg.getBoundingClientRect()));
      if (rects.some(rect => rect.left < outer.left - 1 || rect.right > outer.right + 1 || rect.top < outer.top - 1 || rect.bottom > outer.bottom + 1))
        textOverflow.push({ buttonIndex: [...node.querySelectorAll('button')].indexOf(button), button: { x: outer.x, y: outer.y, width: outer.width, height: outer.height },
          childRects: rects.map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) });
    }
    return { buttons: [...node.querySelectorAll('button')].filter(button => button.checkVisibility() && !button.closest('[inert]')).map(button => {
      const rect = button.getBoundingClientRect(), style = getComputedStyle(button); return { native: button instanceof HTMLButtonElement, disabled: button.disabled, nav: button.hasAttribute('data-nav'), groupedArrow: button.tabIndex < 0 && !!button.parentElement.closest('[data-nav]'), height: rect.height, fontSize: parseFloat(style.fontSize), color: style.color, background: style.backgroundColor, backgroundImage: style.backgroundImage };
    }), navIndices: visible.filter(element => !(element instanceof HTMLButtonElement && element.disabled)).map(element => all.indexOf(element)), textOverflow, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  }), 45000, 'control measurements');
  const group = { label, ...info, focusSamples: [], opaqueContrast: [] }; report.controls.push(group);
  assert.equal(info.horizontalOverflow, false); assert.deepEqual(info.textOverflow, [], 'Visible button text and SVGs must remain inside actual control bounds.'); assert.ok(info.buttons.length > 0);
  for (const button of info.buttons) {
    assert.ok(button.native && (button.nav || button.groupedArrow) && button.height >= 43.9 && button.fontSize >= 12);
    const foreground = rgba(button.color), background = rgba(button.background);
    if (!button.disabled && foreground?.alpha === 1 && background?.alpha === 1 && button.backgroundImage === 'none') {
      const a = luminance(foreground.channels), b = luminance(background.channels), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      group.opaqueContrast.push(ratio); assert.ok(ratio >= 4.5, 'Opaque small button text needs readable computed contrast.');
    }
  }
  if (!sweep) return;
  const seen = new Set();
  for (let index = 0; index < info.navIndices.length + 2; index++) {
    await page.keyboard.press('Tab');
    const sample = await bounded(root().evaluate(node => {
      const active = document.activeElement, all = [...node.querySelectorAll('[data-nav]')];
      if (!(active instanceof HTMLElement) || !node.contains(active)) return { inside: false };
      const rect = active.getBoundingClientRect(); let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom); const clips = [];
      for (let parent = active.parentElement; parent && parent !== node.parentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if ([style.overflowX, style.overflowY].some(value => ['hidden', 'clip', 'auto', 'scroll'].includes(value))) clips.push({ classes: String(parent.className), x: box.x, y: box.y, width: box.width, height: box.height, overflowX: style.overflowX, overflowY: style.overflowY, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight, scrollTop: parent.scrollTop });
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      }
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const hitNav = hit?.closest('[data-nav]') ?? null, hitButton = hit?.closest('button') ?? null;
      const centerHitMatches = active instanceof HTMLButtonElement ? hitNav === active && hitButton === active : hitNav === active;
      const style = getComputedStyle(active); return { inside: true, index: all.indexOf(active), label: active.textContent.trim(), disabled: active instanceof HTMLButtonElement && active.disabled,
        nav: active.hasAttribute('data-nav'), x: rect.x, y: rect.y, width: rect.width, height: rect.height, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top),
        focusVisible: active.matches(':focus-visible'), outline: style.outline, boxShadow: style.boxShadow, clips, centerHitMatches,
        centerHit: hit ? { tag: hit.tagName, classes: String(hit.className), navIndex: all.indexOf(hitNav) } : null };
    }), 45000, 'actual Tab input');
    group.focusSamples.push(sample); assert.equal(sample.inside, true); assert.equal(sample.disabled, false); assert.equal(sample.nav, true);
    assert.ok(sample.height >= 43.9 && sample.visibleWidth >= sample.width - 1 && sample.visibleHeight >= sample.height - 1, 'Real Tab must reveal the complete control within actual clipping ancestors.');
    assert.equal(sample.centerHitMatches, true, 'The actual focused control center must hit that control, not an overlapping drawer or dock.');
    seen.add(sample.index);
  }
  assert.ok(info.navIndices.every(index => seen.has(index)), 'Every enabled visible control must be keyboard reachable.');
}
async function density(label, guide) {
  const info = await bounded(root().evaluate(node => {
    const visible = (rect, element) => {
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = element; parent && parent !== node.parentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      } return right > left && bottom > top;
    };
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let wordCount = 0;
    while (walker.nextNode()) {
      const text = walker.currentNode, parent = text.parentElement;
      if (!parent?.checkVisibility() || parent.closest('[aria-hidden="true"],svg,style,script')) continue;
      for (const match of text.textContent.matchAll(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)) {
        const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
        if ([...range.getClientRects()].some(rect => visible(rect, parent))) wordCount++;
      }
    }
    const headings = [...node.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(element => element.checkVisibility() && visible(element.getBoundingClientRect(), element)).map(element => ({ tag: element.tagName, text: element.textContent.trim().replace(/\s+/g, ' ').toLowerCase() }));
    const regions = [...node.querySelectorAll('[data-ealdholt-ui-region]')].filter(element => element.checkVisibility()).map(element => { const rect = element.getBoundingClientRect(); return { region: element.dataset.ealdholtUiRegion, x: Math.max(0, rect.left), y: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) }; }).filter(rect => rect.right > rect.x && rect.bottom > rect.y);
    const xs = [...new Set(regions.flatMap(rect => [rect.x, rect.right]))].sort((a, b) => a - b); let area = 0;
    for (let i = 1; i < xs.length; i++) { const intervals = regions.filter(rect => rect.x < xs[i] && rect.right > xs[i - 1]).map(rect => [rect.y, rect.bottom]).sort((a, b) => a[0] - b[0]); let length = 0, end = -Infinity;
      for (const [start, finish] of intervals) { length += Math.max(0, finish - Math.max(start, end)); end = Math.max(end, finish); } area += (xs[i] - xs[i - 1]) * length; }
    return { wordCount, headings, regions, boundingCoverageFraction: area / (innerWidth * innerHeight) };
  }), 45000, 'visible information density');
  const counts = new Map(); for (const heading of info.headings) counts.set(heading.text, (counts.get(heading.text) ?? 0) + 1);
  report.density.push({ label, guide, guideMet: info.wordCount <= guide, wordCount: info.wordCount, regions: info.regions, boundingCoverageFraction: info.boundingCoverageFraction,
    headings: info.headings.map(heading => ({ tag: heading.tag, textSha256: hash(heading.text) })), duplicateHeadingGroups: [...counts.values()].filter(count => count > 1) });
  assert.equal(await control('.ealdholt-steps,.ealdholt-preview-tag,.ealdholt-footer').count(), 0, 'Old step navigation, preview badge and verbose footer must be structurally removed.');
}
async function capture(name) {
  const png = resolve(directory, name + '.png'), jpeg = resolve(directory, name + '-600.jpg');
  await bounded(page.screenshot({ path: png, timeout: 45000 }), 45000, 'actual ' + name + ' capture');
  await sharp(png).resize({ width: 600 }).jpeg({ quality: 70 }).toFile(jpeg); report.captures.push({ name, png, jpeg });
}
async function contactSheet() {
  if (report.captures.length !== 4) return;
  const width = 640, height = Math.round(width * report.viewport.height / report.viewport.width), labelHeight = 28, layers = [];
  for (const [index, capture] of report.captures.entries()) {
    const left = index % 2 * width, top = Math.floor(index / 2) * (height + labelHeight);
    layers.push({ input: await sharp(capture.png).resize({ width }).png().toBuffer(), left, top: top + labelHeight });
    layers.push({ input: Buffer.from(`<svg width="${width}" height="${labelHeight}"><rect width="100%" height="100%" fill="#171c18"/><text x="12" y="19" fill="#eee5d3" font-family="sans-serif" font-size="15">${capture.name} · ${report.viewport.width}×${report.viewport.height} · High · Reduce Motion</text></svg>`), left, top });
  }
  const png = resolve(directory, 'world-first-contact.png'), jpeg = resolve(directory, 'world-first-contact-600.jpg');
  await sharp({ create: { width: width * 2, height: (height + labelHeight) * 2, channels: 4, background: '#171c18' } }).composite(layers).png().toFile(png);
  await sharp(png).resize({ width: 600 }).jpeg({ quality: 70 }).toFile(jpeg); report.contactSheet = { png, jpeg, sources: report.captures.map(capture => capture.name) };
}
async function enter() {
  await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.locator('.home-grid').waitFor();
  await page.getByRole('button', { name: 'My Legacy', exact: true }).click(); await root().waitFor();
  await until(async () => { const data = await control('.ealdholt-world').evaluate(node => ({ ...node.dataset }), undefined, { timeout: 150000 }); return data.modelReady === 'true' && Number(data.renderFrames) > 0; }, 'current High village first frame', 150000);
  assert.equal(await root().getAttribute('data-ealdholt-ui'), 'world-first');
}
try {
  await stage('browser-start', async () => {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: report.browserArgs });
    context = await browser.newContext({ viewport: report.viewport, reducedMotion: report.reducedMotion }); page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.errors.push({ kind: 'page', message: error.message })); page.on('console', message => { if (message.type() === 'error') report.errors.push({ kind: 'console', message: message.text() }); });
    page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigationEvents.push({ at: new Date().toISOString(), url: safeDocumentUrl(frame.url()) }); });
    await page.addInitScript(({ fixtures, preferences }) => {
      if (!sessionStorage.getItem('world-first-qa-seeded')) {
        for (const [key, raw] of Object.entries(fixtures)) localStorage.setItem(key, raw);
        localStorage.setItem('crownfall.main-game.preferences', JSON.stringify(preferences)); sessionStorage.setItem('world-first-qa-seeded', '1');
      }
    }, { fixtures, preferences: report.preferences });
    await page.goto(base.href, { waitUntil: 'domcontentloaded' });
  });
  await stage('menu-boot', async () => {
    await until(async () => await page.locator('.menu-shell').count() > 0 && await page.locator('.loading-screen').count() === 0, 'normal menu boot', 150000);
    baselineCanvases = await page.locator('canvas').count(); assert.equal((await stored('before entry'))[ENTRY], undefined);
  }, 150000);
  await stage('world-first-intro', async () => {
    await enter(); await assets('intro');
    if (!peopleOnly) {
    await density('intro', 45); await auditControls('intro');
    assert.equal(await control(S.editor).count(), 0); assert.equal(await control(S.peoplePanel).count(), 0); assert.equal(await control(S.cameraPanel).count(), 0);
    const TYPE = typography.EALDHOLT_TYPOGRAPHY;
    await until(async () => await page.evaluate(({ family, weight }) => [...document.fonts].some(face => face.family.replaceAll('"', '') === family && face.status === 'loaded') && document.fonts.check(`${weight} 32px "${family}"`), { family: TYPE.heroFamily, weight: TYPE.heroWeight }), 'local hero font');
    await capture('intro');
    }
    await control(S.intro).click();
  }, 150000);
  await stage('central-banner-and-crest-rail', async () => {
    if (!peopleOnly) {
    await control(S.hero).waitFor(); assert.equal(await control(S.presets).count(), 4); assert.equal(await control(S.rail).count(), 1); assert.equal(await control(S.confirm).isDisabled(), true);
    const box = await control(S.hero).evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
    const minimumWidthFraction = phone ? .09 : .12;
    assert.ok(box.width >= report.viewport.width * minimumWidthFraction && box.height >= report.viewport.height * .24); assert.ok(Math.abs((box.x + box.width / 2) / report.viewport.width - .5) <= .18, 'The banner must occupy the responsive central composition.');
    report.bannerHero = { ...box, minimumWidthFraction, minimumHeightFraction: .24 }; await density('banner', 65); await auditControls('banner');
    }
    await control(S.presets).first().click(); assert.equal(await control(S.presets).first().getAttribute('aria-pressed'), 'true'); assert.equal(await control(S.confirm).isEnabled(), true);
    if (!peopleOnly) {
    await control('[data-ealdholt-info]').click();
    assert.equal(await control('#ealdholt-commit-info').innerText(), interfaceCopy.EALDHOLT_INTERFACE_COPY.fullInfo);
    await control('[data-ealdholt-info]').click(); assert.equal(await control('#ealdholt-commit-info').count(), 0);
    await capture('banner'); pass('new-central-banner-four-crest-rail-and-short-default-copy-observed');
    }
  });
  if (!peopleOnly) {
  await stage('real-banner-editor', async () => {
    await control(S.edit).click(); await control(S.editor).waitFor(); await auditControls('editor');
    for (const id of ['ordinary', 'charge', 'field']) { const tab = control(S.tab + `[data-ealdholt-section="${id}"]`); await tab.click(); assert.equal(await tab.getAttribute('aria-pressed'), 'true'); }
    const part = control(S.part), before = await part.getAttribute('aria-label'); await part.click(); await page.keyboard.press('ArrowRight');
    await until(async () => await part.getAttribute('aria-label') !== before, 'actual banner edit');
    await control(S.editorClose).click(); assert.equal(await control(S.editor).count(), 0);
    await focusReturns(S.edit, 'editor focus returns to opener');
    const bytes = await stored('unsaved edit'); assert.equal(bytes[ENTRY], undefined); assert.equal(bytes[archive.PRE_AETHELGARD_ARCHIVE_KEY], undefined);
    pass('conditional-editor-tabs-real-change-and-close-preserve-unsaved-entry');
  });
  }
  await stage('actual-entry-confirmation', async () => {
    await control(S.confirm).click(); await control(S.people).waitFor(); const bytes = await stored('actual confirmation'); assert.ok(entry.parseInheritedSession(bytes[ENTRY]).ok); savedRaw = bytes[ENTRY];
    assert.equal(bytes[archive.PRE_AETHELGARD_ARCHIVE_KEY], predecessor); assert.equal(JSON.parse(savedRaw).choices.length, 0);
    if (!peopleOnly) { await density('village', 25); await auditControls('village'); await assets('village'); await capture('village'); }
    pass('actual-confirmation-retains-predecessor-and-opens-world-first-village');
  });
  if (!peopleOnly) {
  await stage('real-Pause-Resume', async () => {
    await control('[data-ealdholt-pause]').click();
    await until(async () => await root().getAttribute('data-ealdholt-paused') === 'true', 'actual Pause state');
    const dialog = root().getByRole('dialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: interfaceCopy.EALDHOLT_INTERFACE_COPY.resume, exact: true }).click();
    await until(async () => await root().getAttribute('data-ealdholt-paused') === 'false', 'actual Resume state');
    await stored('real Pause and Resume preserve the confirmed session');
    pass('real-Pause-and-Resume-transition-the-active-interface-without-changing-save');
  });
  await stage('views-and-Camera', async () => {
    await control(S.views).click(); await control(S.viewsPanel).waitFor(); await auditControls('views');
    const previousFrames = Number(await control('.ealdholt-world').getAttribute('data-render-frames')); await control('[data-ealdholt-view="well"]').click();
    await until(async () => { const data = await control('.ealdholt-world').evaluate(node => ({ ...node.dataset })); return data.selectedView === 'well' && Number(data.renderFrames) > previousFrames; }, 'actual Well frame');
    assert.equal(await control(S.viewsPanel).count(), 0, 'Choosing a view clears the scene automatically');
    await focusReturns(S.views, 'View selection returns focus to Views');
    await control(S.camera).click(); await control(S.cameraPanel).waitFor(); await auditControls('Camera'); await control(S.cameraClose).click(); assert.equal(await control(S.cameraPanel).count(), 0);
    await focusReturns(S.camera, 'Camera focus returns to opener');
    await assets('Well and Camera'); pass('existing-views-and-conditional-Camera-dock-work');
  });
  }
  await stage('People-open', async () => {
    await control(S.people).click(); await control(S.peoplePanel).waitFor();
    if (!peopleOnly) await auditControls('People');
    assert.equal(await control(S.person).count(), 3);
  });
  await stage('dialogue-choice', async () => {
    await control(S.person).first().click(); await control(S.option).first().waitFor(); if (!peopleOnly) await auditControls('dialogue');
    const previous = JSON.parse(savedRaw), optionId = await control(S.option).first().getAttribute('data-ealdholt-option');
    await control(S.option).first().click();
    await until(async () => await control('[data-ealdholt-acknowledgement="immediate"]').count() === 1 && await root().getAttribute('data-ealdholt-busy') === 'false', 'actual dialogue acknowledgement');
    const bytes = await stored('actual dialogue choice', true), next = JSON.parse(bytes[ENTRY]);
    assert.equal(next.choices.length, previous.choices.length + 1); assert.equal(next.choices.at(-1).optionId, optionId);
    for (const key of ['house', 'banner', 'entry']) assert.deepEqual(next[key], previous[key]); savedRaw = bytes[ENTRY];
  });
  if (!peopleOnly) {
    await stage('cinematic-dialogue-visual', async () => { await capture('dialogue'); });
    await stage('dialogue-Details-Escape', async () => {
      await control('[data-ealdholt-details]').click(); await control('[data-ealdholt-person-details]').waitFor();
      const followup = control('[data-ealdholt-followup]'), followupPresent = await followup.count() > 0;
      report.detailsEscape = { followupPresent, followupFocusedBeforeEscape: false };
      if (followupPresent) {
        await followup.click();
        report.detailsEscape.followupFocusedBeforeEscape = await followup.evaluate(node => node === document.activeElement);
        assert.equal(report.detailsEscape.followupFocusedBeforeEscape, true, 'The actual follow-up click must focus the control that Details will unmount.');
      }
      await page.keyboard.press('Escape'); assert.equal(await control('[data-ealdholt-person-details]').count(), 0);
      await focusReturns('[data-ealdholt-details]', 'Details Escape restores the mounted Details opener');
      await stored('reading and escaping Details preserves the actual choice');
      pass('Details-Escape-restores-opener-after-unmounting-focused-content');
    });
  }
  await stage('activity-reading', async () => {
    await control(S.personBack).click(); await control(S.activityOpen).waitFor(); await control(S.activityOpen).click(); await control(S.activity).waitFor();
    if (!peopleOnly) await auditControls('activity');
    await stored('activity reading preserves confirmed entry and choice');
  });
  await stage('People-close', async () => {
    await control(S.activityClose).click(); await control(S.peopleClose).click(); assert.equal(await control(S.peoplePanel).count(), 0);
    await focusReturns(S.people, 'People focus returns to opener'); await stored('People reading after explicit choice');
    pass('ordinary-People-dialogue-and-activity-open-and-close-through-real-input');
  });
  await stage('Home-and-Play', async () => {
    await control(S.home).click(); await page.locator('.home-grid').waitFor(); await stored('Home'); await enter(); await assets('Home re-entry'); await control(S.play).click(); await page.locator('.game-cards').waitFor();
    await page.getByRole('button', { name: 'Classic', exact: true }).click(); await page.locator('.match-setup').waitFor(); assert.equal(await page.getByRole('button', { name: 'Start match', exact: true }).isVisible(), true);
    await page.keyboard.press('Escape'); await page.locator('.game-cards').waitFor(); await stored('existing Classic setup'); pass('Home-and-existing-Classic-Play-remain-reachable');
  }, 150000);
  const remoteUi = requests.filter(request => { const url = new URL(request.url); return ['http:', 'https:'].includes(url.protocol) && url.origin !== base.origin && /threeui|mengto|geist/i.test(url.href); });
  report.network = { requestCount: requests.length, remoteUiAssets: remoteUi.length }; assert.equal(remoteUi.length, 0); assert.deepEqual(report.errors, []);
  await contactSheet(); report.passed = true;
} catch (error) { report.failure = String(error.stack || error); process.exitCode = 1; await failureDiagnostics(); }
finally {
  report.navigation = navigationSummary();
  try { if (context) await bounded(context.close(), 15000, 'context cleanup'); if (browser) await bounded(browser.close(), 15000, 'browser cleanup'); report.browserClosed = true; }
  catch (error) { report.cleanupFailure = String(error.message); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ passed: report.passed, stage: report.stage, checks: report.checks.length, browserErrors: report.errors.length, browserClosed: report.browserClosed, evidence: resolve(directory, 'verification.json'), failure: report.failure ? 'See private stage report; private identities are not printed.' : null }));
