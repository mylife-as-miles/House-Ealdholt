// Story mode: the Prologue entry in Chapters plays the prologue film with sound and returns there.
// (The startup opening itself is covered by verify-launch.mjs.) Real keys and clicks, with the
// browser's autoplay policy emulated: no sound until a trusted press.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { grid, categoryName } from "./settings-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], errors = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;
const preferences = { quality: "low", volume: 80, musicVolume: 50, music: true, motion: true };

async function newContext(saved = preferences) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem("prefs-written")) { localStorage.setItem("crownfall.main-game.preferences", JSON.stringify(value)); sessionStorage.setItem("prefs-written", "1"); }
    // Automation grants the page activation and lets media play with sound from the start. A visitor's
    // browser does neither until they press something, so emulate that policy: no activation until a
    // trusted key or click, and unmuted play() refused (NotAllowedError) until then.
    window.__activated = false;
    const activate = (event) => { if (event.isTrusted && event.key !== "Escape") window.__activated = true; };
    window.addEventListener("keydown", activate, true);
    window.addEventListener("pointerdown", activate, true);
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: { get hasBeenActive() { return window.__activated; }, get isActive() { return window.__activated; } } });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.muted && !window.__activated) return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", "NotAllowedError"));
      return play.call(this);
    };
    window.__filmPad = { connected: false, buttons: [] };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      const pad = window.__filmPad; const pressed = [...pad.buttons]; pad.buttons = [];
      return pad.connected ? [{ index: 0, id: "Test standard controller", mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), touched: false, value: pressed.includes(index) ? 1 : 0 })) }] : [];
    } });
  }, saved);
  return context;
}
async function boot(page) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(target.href);
  await waitForBootReady(page, { opening: "keep" });
  await page.evaluate(() => document.fonts.ready);
}
const shell = (page, name) => page.locator(".menu-shell").getAttribute(name);
const opening = (page, name) => page.getByRole("dialog", { name, exact: true });
const FULL = "Crownfall: Aethelgard opening film", SHORT = "Crownfall: Aethelgard title sequence";
const video = (page) => page.evaluate(() => {
  const element = document.querySelector(".opening-film video");
  return element && { paused: element.paused, muted: element.muted, time: element.currentTime, src: element.currentSrc, playsInline: element.playsInline, described: document.getElementById(element.getAttribute("aria-describedby"))?.textContent || "" };
});
const waitPlaying = (page, after = 0.25) => page.waitForFunction((time) => {
  const element = document.querySelector(".opening-film video");
  return element && !element.paused && element.readyState >= 2 && element.currentTime > time;
}, after, { timeout: 30000 });
const waitPhase = (page, phase) => page.waitForFunction((value) => document.querySelector(".menu-shell")?.getAttribute("data-opening-film") === value, phase, { timeout: 20000 });
const seen = (page) => page.evaluate(() => localStorage.getItem("crownfall.opening.seen"));

try {
  // Story mode: the Prologue entry in Chapters plays the prologue film with sound and returns there.
  const story = await newContext();
  const chapters = await story.newPage();
  await boot(chapters);
  const opening0 = await shell(chapters, "data-opening-film");
  if (opening0 !== "closed") { await chapters.keyboard.press("Escape"); await waitPhase(chapters, "closed"); }
  const seenBefore = await seen(chapters);
  await chapters.getByRole("tab", { name: "Play", exact: true }).click();
  await waitForMenuIdle(chapters);
  await chapters.getByRole("button", { name: "Chapters", exact: true }).click();
  await waitForMenuIdle(chapters);
  const tile = chapters.locator('.chapter-tile[data-chapter-id="prologue"]');
  assert.equal(await tile.getAttribute("aria-label"), "Prologue");
  assert.equal(await tile.getAttribute("data-locked"), "false");
  await tile.click();
  await opening(chapters, "Crownfall: Aethelgard prologue film, The Name They Buried").waitFor();
  assert.equal(await shell(chapters, "data-opening-cut"), "prologue");
  assert.notEqual(await shell(chapters, "data-opening-film"), "waiting", "the tile press is the gesture: no prompt");
  await waitPlaying(chapters);
  const prologue = await video(chapters);
  assert.match(prologue.src, /video\/crownfall-prologue\.mp4$/);
  assert.equal(prologue.muted, false);
  assert.match(prologue.described, /Story mode prologue/); assert.match(prologue.described, /Krom Shahid/);
  assert.notEqual(await shell(chapters, "data-audio-music-state"), "playing", "the soundtrack waits under the prologue");
  record("the Prologue entry in Chapters plays the prologue film at once with sound; the soundtrack waits");
  await chapters.keyboard.press("Escape");
  await waitPhase(chapters, "closed");
  await chapters.locator(".chapters-grid").waitFor();
  await chapters.waitForFunction(() => document.activeElement?.getAttribute("data-chapter-id") === "prologue");
  assert.equal(await seen(chapters), seenBefore, "playing the prologue does not touch the opening's record");
  record("Back returns to Chapters with the Prologue focused; the opening's first-start record is untouched");
  await story.close();

  assert.deepEqual(errors.filter(message => !/favicon|net::ERR_ABORTED/.test(message)), [], "no page errors");
  record("no page or console errors");
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}
console.log(`${checks.length} checks passed`);
if (failure) { console.error(failure); process.exit(1); }
