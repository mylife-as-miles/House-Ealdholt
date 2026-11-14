// Actual Desktop media and UI QA. Run only with the coordinator's sole browser
// lease. Never enables autoplay without user activation or calls app actions.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { tsImport } from '../../main-game-vr/node_modules/tsx/dist/esm/api/index.mjs';
import { installCrownfallAudioProbe } from '../../scripts/audio-playback-probe.mjs';
import { waitForBootReady } from './boot-helpers.mjs';
import { openCategory, leaveSettings } from './settings-helpers.mjs';
const { CROWNFALL_SOUNDTRACK: tracks, NOW_PLAYING_COPY: copy } = await tsImport('../../shared/menu/soundtrack.ts', import.meta.url);
const { createLegacyState } = await tsImport('../../shared/legacy/domain/state.ts', import.meta.url);
const { parseLegacySave } = await tsImport('../../shared/legacy/domain/persistence.ts', import.meta.url);
const fixtures = { 'crownfall.legacy.save': `\n${JSON.stringify(createLegacyState({ at: '2020-01-01T00:00:00.000Z' }), null, 2)}\n`,
  'crownfall.legacy.estate.v1.qa.bannerhold': JSON.stringify({ version: 1, bannerId: 'qa', worldId: 'bannerhold', placements: [] }) };
assert.ok(parseLegacySave(fixtures['crownfall.legacy.save']).ok); assert.equal(tracks.length, 6);
const out = resolve(process.env.CROWNFALL_AUDIO_ARTIFACTS || 'artifacts/soundtrack');
const base = new URL(process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173'); base.searchParams.set('ealdholt-preview', '1');
const scopes = ['transport', 'toast', 'playlist', 'controls', 'legacy', 'missing'];
const selected = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',') || scopes;
for (const scope of selected) assert.ok(scopes.includes(scope));
const report = { startedAt: new Date().toISOString(), profile: { quality: 'low', geometry: 'normal app-selected assets; Quest representative only for Legacy on this software host', rendering: 'SwiftShader', autoplayPolicy: 'Chromium default; no autoplay flags', physicalHeadset: false, subjectiveHeardQualityClaim: false },
  checks: [], observations: [], history: [], network: [], errors: [], console: [], testSetups: [], captures: [], failures: [], browserClosed: false };
await mkdir(out, { recursive: true });
if (process.argv.includes('--prepare-only')) { console.log(JSON.stringify({ prepared: true, scopes, tracks: tracks.map(track => ({ id: track.id, title: track.title, artist: track.artist })), fixtureValid: true, browserStarted: false })); process.exit(0); }
let browser, page, context;
const pass = (scope, name, detail) => { report.checks.push({ scope, name, detail }); console.log(`PASS [${scope}] ${name}`); };
const save = () => writeFile(resolve(out, 'verification.json'), JSON.stringify(report, null, 2));
async function open(missing = false) {
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' }); page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push({ missing, message: error.message }));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push({ missing, type: message.type(), message: message.text() }); });
  page.on('request', request => { if (/\.mp3(?:\?|$)/i.test(request.url())) report.network.push({ event: 'request', missing, url: request.url(), range: request.headers().range ?? null, at: Date.now() }); });
  page.on('response', response => { if (/\.mp3(?:\?|$)/i.test(response.url())) report.network.push({ event: 'response', missing, url: response.url(), status: response.status(), headers: response.headers(), at: Date.now() }); });
  await page.addInitScript(installCrownfallAudioProbe);
  await page.addInitScript(({ fixtures }) => {
    for (const [key, raw] of Object.entries(fixtures)) localStorage.setItem(key, raw);
    localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: false, volume: 65, musicVolume: 35, sfxVolume: 70, music: true, soundEffects: true, showHints: true }));
    window.__soundtrackWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) { if (this === localStorage && /^crownfall\.(legacy|estate)/.test(key)) window.__soundtrackWrites.push({ key, operation: 'set' }); return set.call(this, key, value); };
    Storage.prototype.removeItem = function (key) { if (this === localStorage && /^crownfall\.(legacy|estate)/.test(key)) window.__soundtrackWrites.push({ key, operation: 'remove' }); return remove.call(this, key); };
  }, { fixtures });
  const fault = { injected: false, url: null };
  if (missing) await page.route(/\.mp3(?:\?|$)/i, async route => {
    if (!fault.injected) { fault.injected = true; fault.url = route.request().url(); await route.fulfill({ status: 404, body: 'Declared isolated QA missing track' }); }
    else await route.continue();
  });
  await page.goto(base.href, { waitUntil: 'domcontentloaded' }); await waitForBootReady(page);
  const before = await read(); assert.equal(before.probe.media.length, 0, 'No media is constructed before a real gesture.');
  assert.equal(report.network.filter(item => item.event === 'request' && item.missing === missing).length, 0, 'No MP3 prefetch before unlock.');
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await playing(); return fault;
}
async function read(label) {
  const value = await page.evaluate(() => ({ probe: window.__crownfallAudioProbe.snapshot(), audio: { ...document.querySelector('main.menu-shell').dataset },
    stores: Object.fromEntries(Object.keys(localStorage).filter(key => /^crownfall\.(legacy|estate)/.test(key)).sort().map(key => [key, localStorage.getItem(key)])), writes: window.__soundtrackWrites,
    toast: [...document.querySelectorAll('[data-now-playing]')].map(node => ({ id: node.dataset.nowPlaying, sequence: Number(node.dataset.nowPlayingSequence), surface: node.dataset.nowPlayingSurface, title: node.querySelector('.now-playing-title')?.textContent, credit: node.querySelector('.now-playing-credit')?.textContent, shown: node.classList.contains('is-shown'), opacity: getComputedStyle(node).opacity })) }));
  if (label) report.observations.push({ label, ...value }); return value;
}
function current(value) {
  const track = tracks.find(track => track.id === value.audio.audioTrack); assert.ok(track, 'Actual status refers to shared manifest.');
  const live = value.probe.media.filter(media => media.srcAttribute && !media.paused && media.readyState >= 2);
  assert.equal(live.length, 1, 'Exactly one real current media element plays.');
  assert.ok(new URL(live[0].currentSrc || live[0].src).pathname.endsWith('/' + track.src));
  return { track, media: live[0], sequence: Number(value.audio.audioTrackSequence) };
}
async function playing(after = -1) {
  await page.waitForFunction(after => { const root = document.querySelector('main.menu-shell'); return root?.dataset.audioMusicState === 'playing' && Number(root.dataset.audioTrackSequence) > after && window.__crownfallAudioProbe.elements.some(media => !media.paused && media.readyState >= 2 && media.getAttribute('src')); }, after, { timeout: 45000 });
  const value = await read(), item = current(value);
  if (!report.history.some(record => record.sequence === item.sequence)) report.history.push({ sequence: item.sequence, id: item.track.id, mediaId: item.media.id, readyState: item.media.readyState, duration: item.media.duration });
  return { value, ...item };
}
async function advancing(label) {
  const before = await playing(); await page.waitForFunction(({ id, time }) => { const media = window.__crownfallAudioProbe.elements[id - 1]; return media && !media.paused && media.currentTime > time + .2; }, { id: before.media.id, time: before.media.currentTime }, { timeout: 15000 });
  const value = await read(label), after = current(value); assert.equal(after.media.id, before.media.id); return { value, ...after };
}
async function next() {
  await openCategory(page, 'Audio'); const before = await playing();
  await page.getByRole('button', { name: copy.nextTrack, exact: true }).click(); const after = await playing(before.sequence);
  assert.notEqual(after.track.id, before.track.id); assert.notEqual(after.media.id, before.media.id); return after;
}
async function seekEnded(label) {
  const before = await playing(); report.testSetups.push({ kind: 'Declared currentMedia.currentTime=duration-.3; await genuine native ended event', label, id: before.media.id, sequence: before.sequence });
  await page.evaluate(id => { const media = window.__crownfallAudioProbe.elements[id - 1]; if (!Number.isFinite(media.duration) || media.duration < 1) throw Error('Duration is not ready for declared ended setup'); media.currentTime = media.duration - .3; }, before.media.id);
  const after = await playing(before.sequence); assert.notEqual(after.track.id, before.track.id);
  assert.ok(after.value.probe.events.some(event => event.id === before.media.id && event.name === 'ended'), 'A native ended event, never a synthetic dispatch, advanced the track.'); return after;
}
async function noWrites(label) { const value = await read(label); assert.deepEqual(value.stores, fixtures); assert.deepEqual(value.writes, []); }
async function toastLayout(label) {
  await page.locator('[data-now-playing].is-shown').waitFor();
  const result = await page.locator('[data-now-playing]').evaluate(node => {
    const r = node.getBoundingClientRect(), visible = element => element.checkVisibility() && getComputedStyle(element).visibility !== 'hidden';
    const overlaps = [...document.querySelectorAll('button,input,select,[role=switch]')].filter(visible).map(element => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.height > 0 && Math.min(rect.right, r.right) > Math.max(rect.left, r.left) + 1 && Math.min(rect.bottom, r.bottom) > Math.max(rect.top, r.top) + 1).map(({ element }) => element.getAttribute('aria-label') || element.textContent.trim());
    return { viewport: [innerWidth, innerHeight], rect: { x: r.x, y: r.y, width: r.width, height: r.height }, pointerEvents: getComputedStyle(node).pointerEvents, opacity: Number(getComputedStyle(node).opacity), ariaHidden: node.getAttribute('aria-hidden'), imageCount: node.querySelectorAll('img').length, overlaps, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(result.pointerEvents, 'none'); assert.equal(result.ariaHidden, 'true'); assert.equal(result.imageCount, 0); assert.equal(result.horizontalOverflow, false);
  assert.deepEqual(result.overlaps, [], 'Toast must not cover active controls.');
  const value = await read(), item = current(value), card = value.toast[0];
  assert.equal(card.title, item.track.title); assert.equal(card.credit, item.track.artist || copy.collection); assert.equal(card.sequence, item.sequence);
  assert.notEqual(await page.evaluate(() => document.activeElement?.closest('[data-now-playing]') !== null), true);
  report.observations.push({ label, layout: result, card }); return card;
}
async function screenshot(name) { const file = resolve(out, name); await page.screenshot({ path: file, timeout: 120000 }); report.captures.push({ file, viewport: page.viewportSize() }); console.log('CAPTURE ' + name); await save(); }
async function toastMenu() {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await next(); await toastLayout('menu now-playing ' + viewport.width); await screenshot('menu-playing-' + viewport.width + '.png');
    await page.waitForTimeout(5400); assert.equal(await page.locator('[data-now-playing]').count(), 0, 'Toast expires after its genuine5s clock without restarting media.');
    if (viewport.width === 1280) await screenshot('menu-faded-1280.png');
  }
  await page.setViewportSize({ width: 1280, height: 720 }); pass('toast', 'Actual manifest title/credit appears on new playing events, is pointer-free/non-overlapping at desktop+landscape, then expires after5s');
}
async function playlist() {
  while (report.history.length < 14) await next();
  const ids = report.history.slice(0, 14).map(item => item.id); assert.equal(new Set(ids.slice(0, 6)).size, 6); assert.equal(new Set(ids.slice(6, 12)).size, 6);
  for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1]);
  await advancing('two full bags plus two boundary starts');
  await seekEnded('playlist native-ended transition');
  const value = await read('native ended'), starts = value.probe.events.filter(event => event.name === 'playing');
  assert.ok(value.probe.playCalls.some(call => call.outcome === 'resolved' && call.trustedActivation)); assert.ok(new Set(starts.map(event => new URL(event.src).pathname)).size >= 6);
  pass('playlist', 'All6 MP3s actually start; two complete shuffled bags plus two starts have no adjacent repeat; genuine ended automatically advances');
}
async function setRange(label, target) { const slider = page.getByRole('slider', { name: label, exact: true }); await slider.focus(); const before = Number(await slider.inputValue()); for (let i = 0; i < Math.abs(target - before); i++) await slider.press(target > before ? 'ArrowRight' : 'ArrowLeft'); assert.equal(Number(await slider.inputValue()), target); }
async function assertPausedResume(action, undo, label) {
  const before = await advancing(label + ' before'); await action(); await page.waitForFunction(id => window.__crownfallAudioProbe.elements[id - 1].paused, before.media.id);
  const stopped = await read(label + ' stopped'); const offset = stopped.probe.media.find(media => media.id === before.media.id).currentTime; await page.waitForTimeout(350);
  const after = await read(label + ' remains stopped'); assert.ok(Math.abs(after.probe.media.find(media => media.id === before.media.id).currentTime - offset) < .05);
  await undo(); const resumed = await advancing(label + ' resumed'); assert.equal(resumed.media.id, before.media.id); assert.equal(resumed.sequence, before.sequence); assert.equal(resumed.track.id, before.track.id); assert.ok(resumed.media.currentTime >= offset);
  assert.equal(await page.locator('[data-now-playing]').count(), 0, 'Resume cannot reannounce an existing sequence.');
}
async function controls() {
  await openCategory(page, 'Audio'); await page.waitForTimeout(5400);
  const music = page.getByRole('switch', { name: 'Music', exact: true });
  await assertPausedResume(() => music.click(), () => music.click(), 'Music off/on');
  await assertPausedResume(() => setRange('Master Volume', 0), () => setRange('Master Volume', 65), 'master mute/resume');
  await assertPausedResume(() => setRange('Music Volume', 0), () => setRange('Music Volume', 35), 'music bus mute/resume');
  const before = await advancing('before independent SFX toggle');
  await page.getByRole('switch', { name: 'Sound Effects', exact: true }).click(); const count = (await read()).probe.oscillators.length;
  await page.getByRole('button', { name: 'Test Sound', exact: true }).click(); assert.equal((await read()).probe.oscillators.length, count);
  const after = await advancing('music continues with SFX disabled'); assert.equal(after.media.id, before.media.id); assert.equal(after.sequence, before.sequence);
  await page.getByRole('switch', { name: 'Sound Effects', exact: true }).click(); await music.click();
  const silentMusic = await read(); const oldCount = silentMusic.probe.oscillators.length; await page.getByRole('button', { name: 'Test Sound', exact: true }).click();
  assert.ok((await read()).probe.oscillators.length > oldCount); await music.click(); await playing();
  const gains = await read('real channel gains'); assert.ok(Math.abs(Number(gains.audio.audioMasterGain) - .65) < .00001); assert.ok(Math.abs(Number(gains.audio.audioMusicGain) - .35) < .00001); assert.ok(Math.abs(Number(gains.audio.audioSfxGain) - .7) < .00001);
  const actual = current(gains), source = gains.probe.mediaSources.find(source => source.mediaId === actual.media.id);
  const musicNode = gains.probe.edges.find(edge => edge.from === source.sourceNode)?.to, masterNode = gains.probe.edges.find(edge => edge.from === musicNode)?.to;
  assert.ok(Math.abs(gains.probe.nodes.find(node => node.id === musicNode).gain - .35) < .00001); assert.ok(Math.abs(gains.probe.nodes.find(node => node.id === masterNode).gain - .65) < .00001);
  const primaryPage = page, beforeHide = await advancing('before real tab visibility change');
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  const hidden = await primaryPage.evaluate(() => document.hidden);
  if (hidden) {
    await primaryPage.waitForFunction(id => window.__crownfallAudioProbe.elements[id - 1].paused, beforeHide.media.id);
    const position = await primaryPage.evaluate(id => window.__crownfallAudioProbe.elements[id - 1].currentTime, beforeHide.media.id);
    await primaryPage.waitForTimeout(350); assert.ok(Math.abs(await primaryPage.evaluate(id => window.__crownfallAudioProbe.elements[id - 1].currentTime, beforeHide.media.id) - position) < .05);
    await primaryPage.bringToFront(); const restored = await advancing('real foreground return'); assert.notEqual(restored.media.id, beforeHide.media.id); assert.ok(restored.sequence > beforeHide.sequence); assert.notEqual(restored.track.id, beforeHide.track.id); assert.ok(restored.media.currentTime < 5);
    pass('controls', 'Real browser tab hiding pauses current media and foregrounding starts a fresh shuffled song at the beginning');
  } else { report.observations.push({ label: 'real tab switch', status: 'unexercised', limitation: 'This headless browser did not expose document.hidden; no synthetic visibility event or suspension hook was used.' }); await primaryPage.bringToFront(); }
  await other.close();
  pass('controls', 'Music/master/music-bus mute preserves element+offset+sequence; SFX and music operate independently with real channel gains');
}
async function enterLegacy() {
  if (await page.locator('.settings-detail, .settings-grid').count()) await leaveSettings(page);
  await page.getByRole('tab', { name: 'Home', exact: true }).click(); await page.getByRole('button', { name: 'My Legacy', exact: true }).click();
  await page.locator('.ealdholt-preview[aria-hidden=false]').waitFor();
  if (await page.locator('.ealdholt-preview[data-ealdholt-step=intro]').count()) await page.locator('.ealdholt-preview').getByRole('button', { name: 'Explore the village', exact: true }).click();
  await page.locator('.ealdholt-preview[data-ealdholt-world=ready][data-ealdholt-step=village]').waitFor({ timeout: 240000 });
}
async function legacy() {
  const before = await advancing('before route navigation'); await enterLegacy(); const after = await advancing('Legacy same media'); assert.equal(after.media.id, before.media.id); assert.equal(after.sequence, before.sequence); assert.equal(after.track.id, before.track.id);
  const root = page.locator('.ealdholt-preview');
  await page.waitForTimeout(5400); await assertPausedResume(() => root.getByRole('button', { name: 'Pause', exact: true }).click(), () => root.getByRole('dialog').getByRole('button', { name: 'Resume', exact: true }).click(), 'actual Ealdholt Pause/Resume');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await seekEnded('ready LegacyOverview toast ' + viewport.width); await toastLayout('Legacy now-playing ' + viewport.width); await screenshot('legacy-playing-' + viewport.width + '.png');
  }
  await root.getByRole('button', { name: 'Return to Home', exact: true }).click(); await page.locator('.home-grid').waitFor(); await noWrites('Legacy conservation after soundtrack');
  pass('legacy', 'Home/MyLegacy keeps track/element/time/sequence; actual Pause/Resume preserves offset; safe Overview toast fits desktop+landscape; zero Legacy/estate writes');
}
async function transport() {
  const item = await advancing('first genuine gesture-unlocked playback'); assert.ok(item.media.duration > 100); assert.equal(item.media.preload, 'none');
  const requests = report.network.filter(item => item.event === 'request' && !item.missing); assert.ok(new Set(requests.map(item => item.url)).size <= 1, 'Initial unlock does not fetch all6 files.');
  pass('transport', 'A real UI gesture starts one native streaming Audio element; resolved real play promise, decoded readiness and advancing currentTime observed', { id: item.track.id, mediaId: item.media.id });
  const range = await context.request.get(item.media.currentSrc || item.media.src, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(range.status(), 206); assert.match(range.headers()['content-range'], /^bytes 0-1023\//); assert.equal((await range.body()).length, 1024);
  report.observations.push({ label: 'separate read-only HTTP Range support check', status: range.status(), contentRange: range.headers()['content-range'], bytes: 1024 });
}
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mainScopes = selected.filter(scope => scope !== 'missing');
  if (mainScopes.length) { await open(); for (const scope of mainScopes) { console.log('START ' + scope); await ({ transport, toast: toastMenu, playlist, controls, legacy })[scope](); await noWrites(scope + ' exact store check'); await save(); } await context.close(); }
  if (selected.includes('missing')) {
    const fault = await open(true); assert.equal(fault.injected, true); const value = await advancing('one declared404 then real recovery'); assert.ok(value.value.probe.events.some(event => event.name === 'error'));
    assert.ok(report.network.filter(item => item.event === 'request' && item.missing).length <= 6); await noWrites('404 conservation'); pass('missing', 'One declared isolated404 creates a genuine media error; bounded recovery actually plays another track', fault); await context.close();
  }
} catch (error) { report.failures.push({ message: error.message, stack: error.stack }); console.error(error.stack); if (page && !page.isClosed()) { report.failureObservation = await read().catch(() => null); await page.screenshot({ path: resolve(out, 'failure.png'), timeout: 120000 }).catch(() => undefined); } }
finally {
  if (browser) await browser.close(); report.browserClosed = true; report.finishedAt = new Date().toISOString();
  for (const capture of report.captures) { const name = capture.file.replace(/\.png$/, '-600.jpg'); await sharp(capture.file).resize({ width: 600 }).jpeg({ quality: 75 }).toFile(name); capture.review = name; }
  await save();
}
console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, pageErrors: report.errors, browserClosed: report.browserClosed, out }, null, 2));
if (report.failures.length || report.errors.length) process.exitCode = 1;
