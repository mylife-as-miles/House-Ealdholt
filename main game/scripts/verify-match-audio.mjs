// The King's Gambit match sound in a real Local Duel, with capture cinematics on: which clips start, in what order,
// and the adaptive score under them (web/sound-design/score): the Theme as the game opens, Peril on check, the closing
// cue on the mated King's last word, the Theme again on a rematch.
// Every decoded clip is tagged with its file and every AudioBufferSourceNode.start is logged, so the test hears the
// mixer's decisions rather than trusting its code. Run against the desktop dev server:
//   CROWNFALL_TEST_URL=http://127.0.0.1:5199 CHROMIUM_PATH=/usr/bin/google-chrome node scripts/verify-match-audio.mjs
// Optional: CROWNFALL_AUDIO_RECORD=1 also records the page's sound output (WebM) into artifacts/match-audio.
// Automation cannot listen; what the clips sound like was checked when they were made (web/sound-design/gambit).
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const out = '../artifacts/match-audio';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(60000);
const errors = [], checks = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const record = (message, detail) => { checks.push(detail ? { message, detail } : { message }); console.log(`PASS ${message}`); };

await page.addInitScript(({ recordSound }) => {
  localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'low', motion: true, volume: 65 }));
  localStorage.setItem('crownfall.opening.seen', 'true');
  const urlOf = new WeakMap(), bufferUrl = new WeakMap();
  window.__played = [];
  // Every subtitle as it appears, with the page time, so lines can be matched to the clips that spoke them.
  window.__subtitles = [];
  // Main-thread stalls, so a subtitle held up by a frozen page is told apart from one that is late.
  window.__frozen = [];
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__frozen.push({ from: e.startTime, to: e.startTime + e.duration }); }).observe({ type: 'longtask', buffered: true });
  new MutationObserver(() => {
    for (const line of document.querySelectorAll('.match-subtitles p:not([data-logged])')) {
      line.setAttribute('data-logged', '');
      window.__subtitles.push({ speaker: line.querySelector('b')?.textContent ?? '', text: line.querySelector('span')?.textContent ?? '', size: line.parentElement?.dataset.size, t: performance.now() });
    }
  }).observe(document, { childList: true, subtree: true });
  const fetch0 = window.fetch;
  window.fetch = async (...args) => {
    const response = await fetch0(...args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (/\/(gambit|score)\/[^/]+\.mp3/.test(url)) {
      const read = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => { const data = await read(); bufferUrl.set(data, url); return data; };
    }
    return response;
  };
  const decode0 = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const url = bufferUrl.get(data);
    return decode0.call(this, data, ...rest).then((buffer) => { if (url) urlOf.set(buffer, url); return buffer; });
  };
  const clip = (url) => (url.split('/').pop().match(/^([a-z0-9_]+?)(?:-[A-Za-z0-9_-]{8})?\.mp3/) || [])[1];
  const start0 = AudioBufferSourceNode.prototype.start;
  const stop0 = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (when = 0, offset, duration) {
    const url = this.buffer && urlOf.get(this.buffer);
    if (url) {
      // When it sounds, for how long, and (see stop) when it was cut: a voice cut by another ends at its cut.
      const row = { clip: clip(url), at: Math.max(this.context.currentTime, when), loop: this.loop, t: performance.now(), delay: Math.max(0, when - this.context.currentTime),
        dur: (this.buffer.duration - (offset ?? 0)) / this.playbackRate.value };
      this.__row = row;
      window.__played.push(row);
    }
    return start0.call(this, when, offset, duration);
  };
  AudioBufferSourceNode.prototype.stop = function (when = 0) {
    if (this.__row) this.__row.stopAt = Math.max(this.context.currentTime, when);
    return stop0.call(this, when);
  };
  if (recordSound) {
    const connect0 = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const ctx = this.context;
        if (!ctx.__tap) {
          ctx.__tap = ctx.createMediaStreamDestination();
          const recorder = new MediaRecorder(ctx.__tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
          const chunks = [];
          recorder.ondataavailable = (event) => chunks.push(event.data);
          recorder.start(1000);
          window.__soundStartedAt = performance.now();
          window.__stopSound = () => new Promise((resolve) => { recorder.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
            let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            resolve(btoa(text));
          }; recorder.stop(); });
        }
        connect0.call(this, ctx.__tap);
      }
      return connect0.call(this, target, ...rest);
    };
  }
}, { recordSound: !!process.env.CROWNFALL_AUDIO_RECORD });

const played = () => page.evaluate(() => window.__played);
const since = async (mark) => (await played()).slice(mark);
const board = () => page.locator('canvas[aria-label="Crownfall chessboard"]');
const ready = async () => {
  await Promise.race([
    page.locator('.match-experience[data-match-ready="true"][data-match-mode="hotseat"]').waitFor({ timeout: 300000 }),
    page.locator('.match-experience .loading-screen[data-loading-state="degraded"]').waitFor({ timeout: 300000 }).then(async () => { throw new Error(await page.locator('.match-experience .loading-status-line').innerText()); }),
  ]);
  await page.locator('.match-experience[data-match-busy="false"]').waitFor();
};
const move = async (keys, plies) => {
  await board().focus();
  for (const key of keys) await page.keyboard.press(key);
  await page.locator(`.match-experience[data-match-plies="${plies}"][data-match-busy="false"]`).waitFor({ timeout: 120000 });
  await page.waitForTimeout(600);
};
const names = (rows) => rows.map((row) => row.clip);
const voiceOf = (clip) => clip.replace(/_(a|b|c|death)$/, '');
// The voices: a kingdom's piece (plea, cry, the king's lines, a reaction) or the fallen. The pieces' reactions (barks).
const isVoice = (clip) => /^(ivory|sun|empire|kwind)_(p[12]|[nbrqk])_/.test(clip) || /^(ghost|start)_/.test(clip);
const isBark = (clip) => /^(ivory|sun|empire|kwind)_(p[12]|[nbrqk])_[a-z]+_\d+$/.test(clip);
// The flesh under the blow: every take of a wound family the mixer started, in order, across the whole game.
const wounds = { flesh_blast: [], gore_splat: [] };
const heard = (family, row) => { wounds[family].push(row.clip); return row; };
// The words each clip says, from the generated manifest the mixer reads.
const manifest = await readFile('../web/src/audio/gambit-assets.ts', 'utf8');
const wordsOf = (clip) => manifest.match(new RegExp(`\\b${clip}: \\{[^\\n]*\\btext: "([^"]*)"`))?.[1];
const subtitles = () => page.evaluate(() => window.__subtitles);
/** The subtitle that put a clip's words on screen, within a second of the clip starting (or of the page thawing, when it was frozen then). */
const subtitleFor = async (row, speaker) => {
  const words = wordsOf(row.clip);
  assert.ok(words, `${row.clip} has words`);
  await page.waitForFunction(({ text, name }) => window.__subtitles.some((s) => s.text === text && s.speaker === name), { text: words, name: speaker }, { timeout: 15000 });
  const shown = (await subtitles()).find((s) => s.text === words && s.speaker === speaker);
  const voiceAt = row.t + row.delay * 1000;
  // On time, unless the page was frozen when the voice came: then as soon as it could draw again.
  const freeze = (await page.evaluate(() => window.__frozen)).find((f) => f.from <= voiceAt + 1000 && voiceAt < f.to);
  const dueAt = freeze ? Math.max(voiceAt, freeze.to) : voiceAt;
  if (freeze) console.log(`  (the page was frozen for ${Math.round(freeze.to - freeze.from)} ms as ${row.clip} was spoken; its subtitle came ${Math.round(shown.t - freeze.to)} ms after the page could draw again)`);
  assert.ok(Math.abs(shown.t - dueAt) < 1000, `${row.clip}'s subtitle appeared ${Math.round(shown.t - dueAt)} ms from when it was due`);
  return shown;
};

let failure;
try {
  await page.goto(`${process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173'}/?model=none`);
  await waitForBootReady(page);
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await ready();
  const fps = await page.evaluate(() => new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n += 1; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(tick); }));
  console.log(`(headless frame rate during the match: ${fps} fps)`);
  await page.waitForTimeout(1500);
  let rows = await played();
  assert.ok(rows.some((r) => r.clip === 'bed_hall' && r.loop), `the hall loops under the match: ${names(rows)}`);
  assert.ok(rows.some((r) => r.clip === 'start_toll'), `the opening bell rings: ${names(rows)}`);
  assert.ok(rows.some((r) => /^start_[ab]$/.test(r.clip)), `the board whispers that it begins again: ${names(rows)}`);
  record('A new game: the hall loops, the opening bell rings and the board whispers', names(rows));
  {
    // The Theme comes in after the bell: 1.2 s after it, or, where the match's opening plays, as the opening hands over
    // to the board (verify-match-score.mjs times it against the opening's beats).
    const toll = rows.find((r) => r.clip === 'start_toll');
    const theme = rows.find((r) => r.clip === 'score_theme');
    assert.ok(theme && !theme.loop, `the Theme begins: ${names(rows)}`);
    assert.ok(theme.at - toll.at > 1.0, `it comes in after the bell (${(theme.at - toll.at).toFixed(3)} s)`);
    assert.ok(!rows.some((r) => /^score_(rest|rising|battle|peril|laststand)$/.test(r.clip)), `nothing but the Theme yet: ${names(rows)}`);
    record('The score: the Theme (preloaded) comes in after the opening bell', { after: +(theme.at - toll.at).toFixed(3) });
  }
  const opening = await subtitleFor(rows.find((r) => /^start_[ab]$/.test(r.clip)), 'The Fallen');
  assert.equal(opening.size, 'medium', 'subtitles are on at medium size by default');
  record('Subtitles: the whisper that the game begins again is shown as "The Fallen", on time (or the moment a frozen page can draw)', opening);

  // 1. e4 d5 2. exd5: the first death of the game always wakes.
  await move(['Enter', 'ArrowUp', 'ArrowUp', 'Enter'], 1);
  rows = await played();
  assert.ok(rows.some((r) => r.clip.startsWith('steps_')), 'recorded footfalls carry the march');
  record('A move walks on recorded footfalls', [...new Set(names(rows).filter((n) => n.startsWith('steps_') || n.startsWith('settle')))]);
  await move(['ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'], 2);
  let mark = (await played()).length;
  await move(['ArrowRight', 'ArrowDown', 'Enter', 'ArrowLeft', 'ArrowUp', 'Enter'], 3);
  rows = await since(mark);
  const plea = rows.find((r) => /^sun_p[12]_[abc]$/.test(r.clip));
  const hit = rows.find((r) => r.clip === 'hit_p');
  const death = rows.find((r) => /^sun_p[12]_death$/.test(r.clip));
  assert.ok(plea, `the first pawn to die wakes and pleads: ${names(rows)}`);
  assert.ok(hit && death, `the dagger lands and the pawn dies: ${names(rows)}`);
  assert.ok(plea.at < hit.at && hit.at <= death.at + 0.05, 'the plea comes before the blow, the death after it');
  assert.equal(voiceOf(death.clip), voiceOf(plea.clip), 'the same person who begged dies');
  // A directed Pawn duel (the Combat Director) lands the body with its own exchange cue, cue_fall_light_N; an
  // undirected kill still plays fall_light.
  const bodyFall = (r) => r.clip === 'fall_light' || /^cue_fall_light_\d+$/.test(r.clip);
  assert.ok(rows.some(bodyFall), `the body falls: ${names(rows)}`);
  const stab = rows.find((r) => /^flesh_stab_[123]$/.test(r.clip));
  const fall = rows.find(bodyFall);
  const splat = rows.find((r) => /^gore_splat_[123]$/.test(r.clip));
  assert.ok(stab, `the dagger goes into flesh: ${names(rows)}`);
  assert.ok(Math.abs(stab.at - hit.at) < 0.005, `the flesh lands on the blow itself (${stab.at} against ${hit.at})`);
  assert.ok(plea.at < stab.at, 'the plea comes before the wound');
  assert.ok(splat, `blood reaches the stone: ${names(rows)}`);
  // The cry waits a beat (0.15 to 0.22 s, on the audio clock) so the wound is heard alone; the gore waits for the
  // body to land: the end of the death clip (0.85 to 1.15 s at full frame rate, longer in a slow headless run, since
  // the scene waits on its own frame clock), or 0.45 s for a figure with no death clip. So only a lower bound here.
  assert.ok(death.at - stab.at > 0.14 && death.at - stab.at < 0.24, `the wound is heard alone for a beat before the cry (${(death.at - stab.at).toFixed(3)} s)`);
  assert.ok(splat.at - fall.at > 0.4, `the spatter lands with the body, not with the blow (${(splat.at - fall.at).toFixed(3)} s after the fall starts)`);
  assert.ok(splat.at > death.at, 'the spatter answers the cry rather than sitting under its onset');
  assert.equal(rows.filter((r) => /^flesh_/.test(r.clip)).length, 1, `one wound for one blow: ${names(rows)}`);
  assert.equal(rows.filter((r) => /^gore_splat_/.test(r.clip)).length, 1, `one spatter for one body: ${names(rows)}`);
  heard('gore_splat', splat);
  assert.ok(rows.some((r) => r.clip === 'soul_release'), 'its soul leaves as it burns away');
  record('exd5: the Solforiz pawn wakes and begs, the dagger cuts it off and goes into flesh on the same instant, a beat later the same voice dies, the body falls, blood reaches the stone as it lands and its soul leaves', names(rows));
  record("Subtitles: the Solforiz pawn's plea is shown as \"Solforiz Pawn\", on time", await subtitleFor(plea, 'Solforiz Pawn'));
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('.match-subtitles p').count(), 0, 'the plea subtitle has gone once the pawn is dead');

  // 2... Qxd5: the sorceress burns from her square.
  mark = (await played()).length;
  await move(['ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter'], 4);
  rows = await since(mark);
  for (const clip of ['spell_charge', 'spell_cast', 'spell_impact']) assert.ok(rows.some((r) => r.clip === clip), `${clip}: ${names(rows)}`);
  assert.ok(rows.some((r) => /^ivory_p[12]_death$/.test(r.clip)), `the Aethelgard pawn dies in its own voice: ${names(rows)}`);
  {
    // The sorceress throws a volley: leaders splash first, and only the killing bolt goes into the body.
    const blasts = rows.filter((r) => /^flesh_blast_[123]$/.test(r.clip));
    const bursts = rows.filter((r) => r.clip === 'spell_impact');
    const splats = rows.filter((r) => /^gore_splat_[123]$/.test(r.clip));
    assert.equal(blasts.length, 1, `the fire goes into flesh once, on the killing bolt: ${names(rows)}`);
    assert.ok(Math.abs(blasts[0].at - bursts[bursts.length - 1].at) < 0.005, 'the blast lands with the killing burst, not a leader');
    assert.ok(!rows.some((r) => /^flesh_(stab|slash|crush|cleave)_/.test(r.clip)), `no blade wound under a spell: ${names(rows)}`);
    assert.ok(!rows.some((r) => /^hit_/.test(r.clip)), `the flesh blast replaces the sword clang under a fireball: ${names(rows)}`);
    assert.ok(splats[0].at - blasts[0].at > 0.4, 'the spatter waits for the body to land');
    assert.equal(splats.length, 1, `blood reaches the stone once: ${names(rows)}`);
    assert.ok(splats[0].at > blasts[0].at, 'the spatter follows the blast');
    heard('flesh_blast', blasts[0]);
    heard('gore_splat', splats[0]);
  }
  record('Qxd5: fire gathers, flies and lands in flesh with no sword clang; the Aethelgard pawn dies in its own voice and blood reaches the stone', names(rows));

  // 3. Nc3 Qe5+: check.
  await move(['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'Enter'], 5);
  mark = (await played()).length;
  await move(['ArrowRight', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowRight', 'Enter'], 6);
  rows = await since(mark);
  assert.ok(rows.some((r) => r.clip === 'check_toll'), `check rings the bell: ${names(rows)}`);
  record('Qe5+: check rings the bell (the king speaks under his breath about half the time)', names(rows));
  await page.waitForTimeout(4000);
  {
    // Check is urgent: Peril comes in on the next bar of whatever was playing (a bar is 2.5 s), pre-rolled into it.
    const bell = rows.find((r) => r.clip === 'check_toll');
    const peril = (await since(mark)).find((r) => r.clip === 'score_peril');
    assert.ok(peril && peril.loop, `Peril comes in on check: ${names(await since(mark))}`);
    assert.ok(peril.at - bell.at < 4.5, `within two bars of the bell (${(peril.at - bell.at).toFixed(2)} s, starting with its pre-roll)`);
    record('The score: check brings Peril in on the next bar', { afterBell: +(peril.at - bell.at).toFixed(3) });
  }

  // 4. Ne2 Qxe2+ 5. Bxe2: a knight dies, then the sorceress.
  await move(['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'Enter'], 7);
  mark = (await played()).length;
  await move(['ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter'], 8);
  await move(['ArrowRight', 'ArrowDown', 'Enter', 'ArrowLeft', 'ArrowUp', 'Enter'], 9);
  rows = await since(mark);
  assert.ok(rows.some((r) => r.clip === 'ivory_n_death'), `the Aethelgard knight dies in his voice: ${names(rows)}`);
  assert.ok(rows.some((r) => r.clip === 'sun_q_death'), `the Solforiz queen dies in hers: ${names(rows)}`);
  assert.ok(rows.some((r) => r.clip === 'fall_heavy'), 'a heavy body falls heavily');
  {
    // Two more spell kills (the sorceress, then the mage): a blast and a spatter each.
    const blasts = rows.filter((r) => /^flesh_blast_[123]$/.test(r.clip));
    const splats = rows.filter((r) => /^gore_splat_[123]$/.test(r.clip));
    assert.equal(blasts.length, 2, `each spell kill goes into flesh: ${names(rows)}`);
    assert.equal(splats.length, 2, `each body leaves blood on the stone: ${names(rows)}`);
    assert.ok(!rows.some((r) => /^hit_/.test(r.clip)), `no sword clang under either fireball: ${names(rows)}`);
    blasts.forEach((row) => heard('flesh_blast', row));
    splats.forEach((row) => heard('gore_splat', row));
  }
  for (const [family, takes] of Object.entries(wounds)) {
    takes.forEach((take, i) => assert.ok(i === 0 || take !== takes[i - 1], `${family} never plays the same take twice running: ${takes}`));
  }
  record('No wound is heard twice running across the four deaths', wounds);
  record('Qxe2+ and Bxe2: the rider and the sorceress each die in their own voice', names(rows));
  await page.waitForTimeout(2000);

  // A new game, and a Fool's mate: the funeral bell, the mated king's last words, then the closing cue.
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  mark = (await played()).length;
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await ready();
  await page.waitForTimeout(3000);
  rows = await since(mark);
  assert.ok(rows.some((r) => r.clip === 'start_toll'), `the rematch rings the opening bell again: ${names(rows)}`);
  assert.ok(rows.some((r) => r.clip === 'score_theme'), `and the Theme opens it again: ${names(rows)}`);
  await move(['ArrowRight', 'Enter', 'ArrowUp', 'Enter'], 1);
  await move(['ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'], 2);
  await move(['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter', 'ArrowUp', 'ArrowUp', 'Enter'], 3);
  mark = (await played()).length;
  await board().focus();
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter']) await page.keyboard.press(key);
  await page.locator('.match-result').waitFor({ timeout: 120000 });
  await page.waitForTimeout(12000);
  rows = await since(mark);
  const toll = rows.find((r) => r.clip === 'mate_toll');
  const last = rows.find((r) => /^ivory_k_defeat_[abc]$/.test(r.clip));
  const sting = rows.find((r) => r.clip === 'score_victory');
  assert.ok(toll && last && sting, `checkmate: the funeral bell, the Aethelgard king's last words, the score's closing cue: ${names(rows)}`);
  assert.ok(toll.at < last.at && last.at < sting.at, 'in that order');
  assert.ok(!rows.some((r) => r.clip === 'sting_win'), 'the old closing cue is not played over the score');
  {
    // The closing cue never comes before the beaten King's last word, where his take records it (hold, in the
    // manifest): it lands on it, or later, as a downfall's results are shown (scene/downfall).
    const hold = Number(manifest.match(new RegExp(`\\b${last.clip}: \\{[^\\n]*\\bhold: ([0-9.]+)`))?.[1]);
    assert.ok(hold > 0, `${last.clip} records its last word`);
    assert.ok(sting.at >= last.at + hold - 0.02, `the closing cue comes on or after the last word (${(sting.at - (last.at + hold)).toFixed(3)} s)`);
    record("Qh4#: the funeral bell, the beaten Aethelgard king's last words (he yields; he is never taken), then the score's victory cue, on his last word or as the downfall's results show", { afterLastWord: +(sting.at - (last.at + hold)).toFixed(4) });
  }
  record("Subtitles: the mated king's last words are shown as \"Aethelgard King\", on time", await subtitleFor(last, 'Aethelgard King'));
  {
    // The pieces' own voices across both games: only Aethelgard's and Solforiz's (the kingdoms on the board), every
    // reaction subtitled with its speaker, and never two voices at once (a cut line ends at its cut, a fade later).
    const all = (await played()).filter((r) => isVoice(r.clip));
    const strange = all.filter((r) => !/^(ivory|sun)_/.test(r.clip) && !/^(ghost|start)_/.test(r.clip));
    assert.deepEqual(names(strange), [], 'every voice belongs to a kingdom on the board');
    const barks = all.filter((r) => isBark(r.clip));
    const spans = all.map((r) => ({ clip: r.clip, from: r.at, to: Math.min(r.at + r.dur, r.stopAt !== undefined ? r.stopAt + 0.1 : Infinity) }));
    for (const bark of spans.filter((s) => isBark(s.clip))) {
      for (const other of spans) {
        if (other === bark) continue;
        const overlap = Math.min(bark.to, other.to) - Math.max(bark.from, other.from);
        assert.ok(overlap <= 0.1, `${bark.clip} (${bark.from.toFixed(2)}-${bark.to.toFixed(2)}) sounds over ${other.clip} (${other.from.toFixed(2)}-${other.to.toFixed(2)})`);
      }
    }
    const shown = await subtitles();
    for (const bark of barks) {
      const words = wordsOf(bark.clip);
      assert.ok(shown.some((s) => s.text === words && /^(Aethelgard|Solforiz) (Pawn|Knight|Bishop|Rook|Queen|King)$/.test(s.speaker)), `${bark.clip}'s subtitle names its speaker: ${words}`);
    }
    record(`The pieces' reactions: ${barks.length} lines (${[...new Set(barks.map((b) => b.clip.split('_').slice(2, -1).join('_')))].join(', ')}), none over another voice, each subtitled`, names(barks));
  }
  assert.deepEqual(errors, []);
  record('No page or console errors');
  if (process.env.CROWNFALL_AUDIO_RECORD) {
    const data = await page.evaluate(() => window.__stopSound?.());
    if (data) { await writeFile(`${out}/match-sound.webm`, Buffer.from(data, 'base64')); record('Recorded the page sound output', `${out}/match-sound.webm`); }
  }
} catch (error) { failure = error; }
finally {
  const log = await page.evaluate(() => window.__played).catch(() => []);
  await writeFile(`${out}/verification.json`, JSON.stringify({ passed: !failure, checks, errors, played: log, failure: failure?.stack }, null, 2) + '\n');
  await browser.close();
}
if (failure) throw failure;
console.log(`${checks.length} checks passed`);
