// Cinematic replays, live against replayed: a scripted Local Duel (Aethelgard against Solforiz, Violence at Full) is
// played in the real match, then watched as its replay in Showcase, and the two shows are compared decision by decision
// from the engine's own trace (globalThis.__crownfallCombatTrace): each capture's staging (duel, spell, summon), the
// Combat Director's recorded fight and its reaction, the spell drawn, the rite and its death, the fatality's seed, the
// severed limb, the death's physics, the blood, the plea and every spoken line, and the Claiming (watched, and the hand
// it is seen in), and every line spoken: the pleas and the kings' lines, and the pieces' own (barks, a line into a long
// silence, the opening murmurs), which the record keeps as said. Timings and float detail are reported, not compared.
//
// The game: d4 d6 Nd2 g5 Ne4 e5 dxe5 Bf5 Bxg5 dxe5 Qxd8#: two Pawn duels, a Bishop's spell, and a Queen taking the
// Queen with mate (her kingdom's summon, a fatality at Full) ending in checkmate.
//
// The page runs on a virtual clock in fixed 50 ms steps (timers, animation frames, performance.now and the audio
// clock), and draws only the first frames of each engine (so the black-frame watchdog stands down): a software
// renderer then gets through two full cinematic games in a few minutes. Run against a desktop dev server:
//   CROWNFALL_TEST_URL=http://127.0.0.1:5405 CHROMIUM_PATH=/usr/bin/google-chrome node scripts/verify-cinematic-replay.mjs
// Then the same record without its seed and kingdoms (an older record) is imported: it must say so, play its two
// recorded duels and show its other captures plainly, inventing no spell, summon or fatality.
// CROWNFALL_REPLAY_OUT sets where the traces and the verdict are written (default ../artifacts/cinematic-replay).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const BASE = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const OUT = process.env.CROWNFALL_REPLAY_OUT || '../artifacts/cinematic-replay';
const GAME = ['d2d4', 'd7d6', 'b1d2', 'g7g5', 'd2e4', 'e7e5', 'd4e5', 'c8f5', 'c1g5', 'd6e5', 'd1d8'];
const STEP = 50, DRAWN_STEPS = 60, SETTLE_STEPS = 200;
/** After this move the live player thinks for 30 seconds: someone speaks into the silence, and the replay says it too. */
const LONG_PAUSE_AFTER = 'e7e5', LONG_PAUSE_STEPS = 600;
await mkdir(OUT, { recursive: true });

function initScript() {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: true, volume: 65, violence: 'full', renderScale: 50 }));
  localStorage.setItem('crownfall.opening.seen', 'true');
  window.__crownfallCombatTrace = [];
  // ---- virtual clock: timers, animation frames, performance.now and the audio clock advance only when stepped
  const R = { now: performance.now.bind(performance), raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window),
    st: window.setTimeout.bind(window), ct: window.clearTimeout.bind(window), si: window.setInterval.bind(window), ci: window.clearInterval.bind(window) };
  const C = window.__clock = { virtual: false, vt: 0, vt0: 0, rafs: [], timers: [], id: 1e7, R };
  performance.now = () => (C.virtual ? C.vt : R.now());
  window.requestAnimationFrame = (cb) => { if (!C.virtual) return R.raf(cb); const id = ++C.id; C.rafs.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { C.rafs = C.rafs.filter((entry) => entry.id !== id); R.caf(id); };
  window.setTimeout = (cb, ms = 0, ...a) => { if (!C.virtual || typeof cb !== 'function') return R.st(cb, ms, ...a); const id = ++C.id; C.timers.push({ id, cb, a, due: C.vt + Math.max(0, +ms || 0) }); return id; };
  window.setInterval = (cb, ms = 0, ...a) => { if (!C.virtual || typeof cb !== 'function') return R.si(cb, ms, ...a); const id = ++C.id; C.timers.push({ id, cb, a, due: C.vt + Math.max(1, +ms || 0), every: Math.max(1, +ms || 0) }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { C.timers = C.timers.filter((entry) => entry.id !== id); R.ct(id); R.ci(id); };
  C.go = () => { C.vt = C.vt0 = R.now(); C.virtual = true; };
  C.step = (ms) => {
    C.vt += ms;
    for (let guard = 0; guard < 5000; guard += 1) {
      const due = C.timers.filter((entry) => entry.due <= C.vt).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      if (due.every) due.due += due.every; else C.timers = C.timers.filter((entry) => entry !== due);
      try { due.cb(...due.a); } catch (error) { console.error('timer', error); }
    }
    const frames = C.rafs; C.rafs = [];
    for (const entry of frames) { try { entry.cb(C.vt); } catch (error) { console.error('raf', error); } }
  };
  const realTime = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime').get;
  const bases = new WeakMap();
  Object.defineProperty(BaseAudioContext.prototype, 'currentTime', { configurable: true, get() {
    if (!C.virtual) return realTime.call(this);
    const run = (C.vt - C.vt0) / 1000;
    if (!bases.has(this)) bases.set(this, realTime.call(this) - run);
    return bases.get(this) + run;
  } });
  // ---- drawing: skipped while stepping, once each engine has drawn its first frames
  window.__skipDraws = false;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
    const original = WebGL2RenderingContext.prototype[name];
    if (original) WebGL2RenderingContext.prototype[name] = function (...args) { if (!window.__skipDraws) return original.apply(this, args); };
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
await page.addInitScript(initScript);
const t0 = Date.now(), lap = (message) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${message}`);

const flush = () => new Promise((resolve) => { const st = window.__clock.R.st; st(() => st(resolve, 0), 0); });
/** Steps the virtual clock `count` times; with `draw`, every frame is drawn. Returns what `read` reads after. */
async function steps(count, { draw = false, read } = {}) {
  return page.evaluate(async ({ count, draw, flush, step, read }) => {
    const settle = new Function(`return (${flush})()`);
    window.__skipDraws = !draw;
    for (let i = 0; i < count; i += 1) { window.__clock.step(step); await settle(); }
    return read ? new Function(`return (${read})()`)() : null;
  }, { count, draw, flush: flush.toString(), step: STEP, read: read?.toString() });
}
/** Steps until `test` (run in the page) holds, `limit` steps at most. */
async function until(test, { limit = 6000, draw = false, chunk = 10, what = 'condition' } = {}) {
  for (let done = 0; done < limit; done += chunk) if (await steps(chunk, { draw, read: test })) return done;
  throw new Error(`timed out waiting for ${what}`);
}
const match = () => { const node = document.querySelector('.match-experience'); return node ? { plies: +node.getAttribute('data-match-plies'), busy: node.getAttribute('data-match-busy'), conclusion: node.getAttribute('data-match-conclusion') } : null; };
const takeTrace = () => page.evaluate(() => { const trace = JSON.parse(JSON.stringify(window.__crownfallCombatTrace)); window.__crownfallCombatTrace = []; return trace; });

/** The decisions a show made, by capture ply, and every spoken line but the ambient whispers of the fallen. */
function decisions(trace) {
  const plies = {}, voices = [], floats = {};
  let ply = 0;
  const add = (line) => (plies[ply] ??= []).push(line);
  for (const entry of trace) {
    const d = entry.detail ?? {};
    switch (entry.what) {
      case 'capture': ply = entry.ply; add(`capture ${d.attacker}x${d.victim} ${d.style} directed=${d.directed ?? '-'} staged=${d.staged}`); break;
      case 'kill': add(`kill ${d.style} ${d.weapon ?? '-'} mate=${d.mate} last=${d.last} tier=${d.tier} fatality=${d.fatality} sever=${d.sever}`); break;
      case 'spell': add(`spell ${entry.detail ?? 'plain bolt'}`); break;
      case 'rite': add(`rite ${d.id} ${d.death} ${d.style} seed=${d.seed}`); break;
      case 'fatality': add(`fatality ${d.kind} seed=${d.seed} tier=${d.tier}`); break;
      case 'plea': add(`plea ${entry.detail ? `${d.clip} ${d.voice}` : 'none'}`); break;
      case 'claimed': add(`claimed ${d.victim} watched=${d.watched} hand=${d.hand} brief=${d.brief}`); break;
      case 'severed': add(`severed ${d.limb} #${d.index}`); break;
      case 'ragdoll': case 'knockdown': add(`${entry.what} blocked=${d.blocked} turned=${d.turned}`); break;
      case 'burst': add('burst'); break;
      case 'begin': add(`duel ${entry.detail}`); break;
      case 'reaction': add(`reaction ${d.side} ${d.hit ?? '-'} ${d.death ?? '-'}`); (floats[ply] ??= []).push({ degrees: d.degrees, deathRate: d.deathRate }); break;
      case 'gore': add(`gore ${d.impact} silent=${d.silent} ${d.surface} stains=${d.stains}`); break;
      case 'marker': add(`marker ${entry.detail}`); break;
      case 'done': add(`done ${d.sequence} ${d.status}`); (floats[ply] ??= []).push({ seconds: d.seconds }); break;
      case 'voice': if (!/^ghost_/.test(d.clip)) voices.push(d.clip); break;  // the fallen's ambient whispers are not recorded
      default: break;
    }
  }
  return { plies, voices, floats };
}

let failure, live, replay, verdict, older;
try {
  lap('boot');
  await page.goto(`${BASE}/?model=none`);
  await waitForBootReady(page, { continueOnFailure: true });
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  for (const [side, kingdom] of [['w', 'Aethelgard'], ['b', 'Solforiz']]) assert.equal(await page.locator(`input[name="match-army-${side}"][aria-label="${kingdom}"]`).isChecked(), true, `${kingdom} fields ${side}`);
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience[data-match-ready="true"][data-match-mode="hotseat"]').waitFor({ timeout: 900000 });
  await page.evaluate(() => document.querySelector('.match-experience')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await page.waitForTimeout(4000); // the mixer unlocks and warms its voices in real time
  lap('match ready');
  await page.evaluate(() => window.__clock.go());
  await steps(DRAWN_STEPS, { draw: true });
  // The live game, by the keyboard as a player may play it; each move is given time to settle as a player would.
  const canvas = page.locator('canvas[aria-label="Crownfall chessboard"]');
  await canvas.focus();
  let cursor = 'e2';
  const goTo = async (square) => {
    const dx = square.charCodeAt(0) - cursor.charCodeAt(0), dy = +square[1] - +cursor[1];
    for (let i = 0; i < Math.abs(dx); i += 1) await page.keyboard.press(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    for (let i = 0; i < Math.abs(dy); i += 1) await page.keyboard.press(dy > 0 ? 'ArrowUp' : 'ArrowDown');
    cursor = square; await page.keyboard.press('Enter');
  };
  for (const [index, move] of GAME.entries()) {
    await goTo(move.slice(0, 2)); await goTo(move.slice(2, 4));
    await until(`() => { const m = (${match})(); return m && m.plies === ${index + 1} && m.busy === 'false'; }`, { what: `live move ${move}` });
    await steps(move === LONG_PAUSE_AFTER ? LONG_PAUSE_STEPS : SETTLE_STEPS);
    lap(`live ${move}`);
  }
  await until(`() => { const m = (${match})(); return m && m.conclusion === 'false' && !!document.querySelector('.match-result'); }`, { what: 'the live ending' });
  await steps(SETTLE_STEPS);
  live = await takeTrace();
  lap(`live trace ${live.length} entries`);

  await page.getByRole('button', { name: 'Save Replay', exact: true }).click();
  await until(`() => /Saved on this device/.test(document.querySelector('.match-result')?.textContent ?? '')`, { what: 'the saved replay' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('crownfall.showcase.replays.v1')).entries[0]);
  assert.match(stored.pgn, /\[CFSeed "[0-9a-f]{8}"\]/); assert.match(stored.pgn, /\[CFArmies "ivory sun"\]/);
  await page.getByRole('button', { name: 'Watch Replay', exact: true }).click();
  await until(`() => document.querySelector('.replay-stage')?.getAttribute('data-replay-ready') === 'true'`, { draw: true, chunk: 5, limit: 20000, what: 'the replay stage' });
  assert.equal(await page.locator('.replay-stage').getAttribute('data-replay-fidelity'), 'exact');
  assert.equal(await page.locator('.replay-stage').getAttribute('data-replay-camera'), 'white', 'the live game\'s own seat');
  await steps(DRAWN_STEPS, { draw: true });
  await takeTrace();
  lap('replay ready');
  await page.locator('[data-control="transport-play"]').click();
  await until(`() => document.querySelector('.showcase-screen')?.getAttribute('data-showcase-playing') === 'false' && document.querySelector('.replay-stage')?.getAttribute('data-replay-performing') === 'none' && document.querySelector('.replay-stage')?.getAttribute('data-replay-ply') === '${GAME.length}'`, { limit: 30000, what: 'the replay to end' });
  await steps(SETTLE_STEPS);
  replay = await takeTrace();
  lap(`replay trace ${replay.length} entries`);

  const a = decisions(live), b = decisions(replay);
  const plies = [...new Set([...Object.keys(a.plies), ...Object.keys(b.plies)])].sort((x, y) => x - y);
  const differences = plies.flatMap((ply) => JSON.stringify(a.plies[ply]) === JSON.stringify(b.plies[ply]) ? [] : [{ ply, live: a.plies[ply], replay: b.plies[ply] }]);
  if (JSON.stringify(a.voices) !== JSON.stringify(b.voices)) differences.push({ voices: { live: a.voices, replay: b.voices } });
  const all = Object.values(a.plies).flat();
  const coverage = {
    duels: all.filter((line) => line.startsWith('duel ')).length, spells: all.filter((line) => line.startsWith('spell ')).length,
    rites: all.filter((line) => line.startsWith('rite ')).length, fatalities: all.filter((line) => line.startsWith('fatality fatality')).length,
    claims: all.filter((line) => line.startsWith('claimed ')).length, pleas: all.filter((line) => /^plea (?!none)/.test(line)).length,
    // The mated King's last words (gambit-sound.ts mateClips).
    mate: a.voices.some((clip) => /_k_(mate|defeat)_/.test(clip)),
    // A piece's own line is named <kingdom>_<voice>_<event>_<take> (gambit-sound.ts barkClips); a plea ends in a letter.
    lines: a.voices.length, barks: a.voices.filter((clip) => /^(ivory|sun|empire|kwind)_[a-z0-9]+_[a-z]+_\d+$/.test(clip)).length,
  };
  verdict = { equal: differences.length === 0, coverage, differences, decisions: { live: a, replay: b } };
  console.log(JSON.stringify({ equal: verdict.equal, coverage }, null, 1));
  for (const difference of differences) console.log('DIFF', JSON.stringify(difference));
  assert.ok(coverage.duels >= 2 && coverage.spells >= 1 && coverage.rites >= 1 && coverage.fatalities >= 1 && coverage.claims >= 4, `the scripted game covers every kind of show: ${JSON.stringify(coverage)}`);
  assert.deepEqual(differences, [], 'the replay made every decision the live game made');
  console.log('PASS live and replayed shows are decision for decision the same');

  // ---- an older record: no seed, no kingdoms. Imported as a file would be, then played, battles only.
  const pgn = stored.pgn.replace(/\[CFSeed "[^"]*"\]\n/, '').replace(/\[CFArmies "[^"]*"\]\n/, '').replace(/\[CFMatchId "[^"]*"\]/, '[CFMatchId "scripted-older"]');
  await page.locator('[data-control="import"]').click();
  await page.locator('[data-control="import-text"]').fill(pgn);
  await page.locator('[data-control="dialog-confirm"]').click();
  await until(`() => document.querySelector('.replay-stage[data-replay-ready="true"][data-replay-fidelity="plain"]') !== null`, { draw: true, chunk: 5, limit: 20000, what: 'the older record on stage' });
  const note = await page.locator('.replay-stage-note').innerText();
  assert.match(note, /Recorded before battles were kept: captures are shown plainly, and only the duels it recorded play their original choreography\./);
  assert.match(note, /Kingdoms were not recorded: shown as Aethelgard and Solforiz\./);
  await steps(DRAWN_STEPS, { draw: true });
  await takeTrace();
  await page.locator('[data-control="battles-only"]').click();
  await page.locator('[data-control="transport-play"]').click();
  await until(`() => document.querySelector('.showcase-screen')?.getAttribute('data-showcase-playing') === 'false' && document.querySelector('.replay-stage')?.getAttribute('data-replay-performing') === 'none' && document.querySelector('.replay-stage')?.getAttribute('data-replay-ply') === '${GAME.length}'`, { limit: 30000, what: 'the older replay to end' });
  older = decisions(await takeTrace());
  const staged = Object.fromEntries(Object.entries(older.plies).map(([ply, lines]) => [ply, lines[0]?.match(/staged=(\w+)/)?.[1]]));
  assert.deepEqual(staged, { 7: 'true', 9: 'false', 10: 'true', 11: 'false' }, 'the recorded duels staged, the rest plain');
  assert.deepEqual(older.plies[7].filter((line) => line.startsWith('duel ')), a.plies[7].filter((line) => line.startsWith('duel ')), 'the recorded duel is the original');
  assert.ok(!Object.values(older.plies).flat().some((line) => /^(spell|rite|fatality) /.test(line)), 'no spell, summon or fatality is invented for an older record');
  console.log('PASS an older record says what it lacks, plays its recorded duels and shows the rest plainly');
  const fatal = errors.filter((error) => !/THREE\.Clock|GL Driver|WebGL|Failed to load resource/.test(error));
  assert.deepEqual(fatal, [], 'no page errors');
} catch (error) { failure = error; console.log(error); await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {}); }
finally {
  await writeFile(`${OUT}/verification.json`, JSON.stringify({ passed: !failure, verdict, older, errors, failure: failure?.stack, live, replay }, null, 1));
  await browser.close();
}
if (failure) throw failure;
