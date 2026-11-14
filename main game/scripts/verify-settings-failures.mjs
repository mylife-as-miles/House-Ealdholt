import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { openCategory } from "./settings-helpers.mjs";
import { waitForBootReady } from "./boot-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const evidence = { passed: false, scope: "Desktop settings recovery through actual pointer and keyboard input after storage/fullscreen/audio fault preparation", checks: [], errors: [] };
const seed = async (page) => {
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality: "low", volume: 65, motion: false, showHints: true })));
};
let failure;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await seed(page);
  await page.addInitScript(() => {
    window.__settingsStorageBlocked = true;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "crownfall.main-game.preferences" && window.__settingsStorageBlocked) throw new DOMException("Storage unavailable", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.goto(target.href); await waitForBootReady(page);
  await openCategory(page, "General");
  await page.waitForFunction(() => document.querySelector('main').dataset.settingsSaved === "false");
  assert.match(await page.locator('.settings-save-status').innerText(), /This visit only/);
  await page.getByRole("switch", { name: "Control Hints", exact: true }).click();
  assert.equal(await page.getByRole("switch", { name: "Control Hints", exact: true }).getAttribute("aria-checked"), "false");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("crownfall.main-game.preferences")).showHints), true, "failed storage writes preserve the last record");
  await page.getByRole("button", { name: "Reset Defaults", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Cancel");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("switch", { name: "Control Hints", exact: true }).getAttribute("aria-checked"), "false", "the safe default keeps live unsaved values");
  await page.evaluate(() => { window.__settingsStorageBlocked = false; });
  await page.getByRole("button", { name: "Save Preferences", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('main').dataset.settingsSaved === "true");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("crownfall.main-game.preferences")).showHints), false);
  evidence.checks.push("Storage refusal preserves the saved record, applies live changes, reports this-visit-only, cancels reset safely and persists pending values on a real retry selection");
  await page.close();

  const fullscreen = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await seed(fullscreen);
  await fullscreen.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException("Request refused", "NotAllowedError"));
  });
  await fullscreen.goto(target.href); await waitForBootReady(fullscreen);
  await openCategory(fullscreen, "Video");
  await fullscreen.getByRole("button", { name: "Change window mode", exact: true }).click();
  await fullscreen.waitForFunction(() => /browser did not allow fullscreen/i.test(document.querySelector('#settings-description')?.textContent || ''));
  assert.equal(await fullscreen.evaluate(() => !!document.fullscreenElement), false);
  await fullscreen.keyboard.press("Escape");
  assert.equal(await fullscreen.getByRole("region", { name: "Settings categories", exact: true }).isVisible(), true);
  evidence.checks.push("A browser fullscreen rejection is explained without pretending the display changed or trapping Back");
  await fullscreen.close();

  const audio = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await seed(audio);
  await audio.addInitScript(() => {
    window.__settingsContexts = [];
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); window.__settingsContexts.push(this); }
    };
  });
  await audio.goto(target.href); await waitForBootReady(audio);
  await openCategory(audio, "Audio");
  await audio.getByRole("button", { name: "Test Sound", exact: true }).click();
  await audio.waitForFunction(() => document.querySelector('main').dataset.audioState === "running");
  await audio.evaluate(async () => {
    const context = window.__settingsContexts[0];
    await context.suspend();
    window.__settingsResume = context.resume.bind(context);
    context.resume = () => Promise.reject(new DOMException("Audio refused", "NotAllowedError"));
  });
  await audio.getByRole("button", { name: "Test Sound", exact: true }).click();
  await audio.waitForFunction(() => /Audio is blocked/.test(document.querySelector('.settings-audio-error')?.textContent || ''));
  // A suspended native AudioParam may retain its last exposed value until the
  // next processing quantum; the suspended context itself produces no audio.
  assert.equal(await audio.evaluate(() => window.__settingsContexts[0].state), "suspended");
  assert.equal(await audio.locator('main').getAttribute('data-audio-state'), "suspended");
  await audio.evaluate(() => { window.__settingsContexts[0].resume = window.__settingsResume; });
  await audio.getByRole("button", { name: "Test Sound", exact: true }).click();
  await audio.waitForFunction(() => document.querySelector('main').dataset.audioState === "running" && !document.querySelector('.settings-audio-error'));
  assert.equal(await audio.evaluate(() => window.__settingsContexts.length), 1);
  evidence.checks.push("A real suspended AudioContext with a refused resume remains silent, shows Test Sound recovery guidance and resumes on an actual retry without creating another graph");
  await audio.close();
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
} catch (error) { failure = error; evidence.failure = String(error.stack || error); }
finally {
  await mkdir("artifacts/settings", { recursive: true });
  await writeFile("artifacts/settings/failure-verification.json", JSON.stringify(evidence, null, 2) + "\n");
  await browser.close();
}
console.log(`${evidence.passed ? "PASS" : "FAIL"} desktop settings recovery: ${evidence.checks.length} groups`);
if (failure) throw failure;
