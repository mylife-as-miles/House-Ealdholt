// End-credits film: choosing Credits plays the film at once with sound, the
// controls pause, resume and skip it, and leaving opens the Credits page with
// the Play end credits row. Real clicks, keys and a simulated standard pad.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";
import { grid, categoryName } from "./settings-helpers.mjs";
import { waitForMenuIdle } from "./motion-helpers.mjs";

const target = new URL(process.env.CROWNFALL_TEST_URL || "http://localhost:5173");
target.searchParams.set("model", "none");
const captures = process.env.CROWNFALL_CREDITS_CAPTURES || "artifacts/credits-film";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const checks = [], errors = [], shots = [];
const record = (text) => { checks.push(text); console.log(`PASS ${text}`); };
let failure;
const preferences = { quality: "low", volume: 80, musicVolume: 50, music: true, motion: true };

async function openPage(options = {}, saved = preferences) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ...options });
  page.setDefaultTimeout(15000);
  await page.addInitScript((value) => {
    localStorage.setItem("crownfall.main-game.preferences", JSON.stringify(value));
    window.__filmPad = { connected: false, buttons: [] };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => {
      const pad = window.__filmPad; const pressed = [...pad.buttons]; pad.buttons = [];
      return pad.connected ? [{ index: 0, id: "Test standard controller", mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), touched: false, value: pressed.includes(index) ? 1 : 0 })) }] : [];
    } });
  }, saved);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(target.href);
  await waitForBootReady(page);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const film = (page) => page.getByRole("dialog", { name: "Crownfall: Aethelgard end credits film", exact: true });
const shell = (page, name) => page.locator(".menu-shell").getAttribute(name);
const video = (page) => page.evaluate(() => {
  const element = document.querySelector(".credits-film video");
  return element && { paused: element.paused, muted: element.muted, time: element.currentTime, ready: element.readyState, playsInline: element.playsInline, volume: element.volume, src: element.currentSrc, label: element.getAttribute("aria-label"), described: document.getElementById(element.getAttribute("aria-describedby"))?.textContent || "" };
});
const waitPlaying = (page, after = 0.25) => page.waitForFunction((time) => {
  const element = document.querySelector(".credits-film video");
  return element && !element.paused && element.readyState >= 2 && element.currentTime > time;
}, after, { timeout: 20000 + after * 1500 });
const focusedSetting = (page) => page.evaluate(() => document.activeElement?.closest("[data-setting]")?.getAttribute("data-setting") || document.activeElement?.getAttribute("data-setting"));
async function openSettingsGrid(page) {
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await waitForMenuIdle(page);
  await grid(page).waitFor();
}
async function expectCreditsPage(page) {
  await film(page).waitFor({ state: "detached" });
  await page.locator(".settings-detail--credits").waitFor();
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-credits-film") === "closed");
  assert.equal(await page.locator('.settings-detail [data-setting="play-credits"]').count(), 1);
  await page.waitForFunction(() => document.activeElement?.closest?.("[data-setting]")?.getAttribute("data-setting") === "play-credits" || document.activeElement?.getAttribute?.("data-setting") === "play-credits");
  for (const id of ["project", "artwork", "technology", "typeface", "licenses"]) assert.equal(await page.locator(`.settings-detail [data-setting="${id}"]`).count(), 1, `${id} notice row is kept`);
}

try {
  const page = await openPage();
  // A first gesture starts the menu soundtrack, exactly as a player would hear it.
  await openSettingsGrid(page);
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-audio-music-state") === "playing", undefined, { timeout: 20000 }).catch(() => {});
  const musicBefore = await shell(page, "data-audio-music-state");
  const trackBefore = await shell(page, "data-audio-track");
  const sequenceBefore = Number(await shell(page, "data-audio-track-sequence"));

  await grid(page).getByRole("button", { name: categoryName("Credits") }).click();
  await film(page).waitFor();
  await waitPlaying(page);
  const playing = await video(page);
  assert.equal(playing.paused, false);
  assert.equal(playing.muted, false, "the Credits click is the gesture that turns the sound on");
  assert.equal(playing.playsInline, true);
  assert.match(playing.src, /video\/crownfall-end-credits\.mp4$/);
  assert.equal(playing.label, "Crownfall: Aethelgard end credits film");
  assert.match(playing.described, /Project EON/); assert.match(playing.described, /Osita Miles/);
  assert.equal(await film(page).getAttribute("aria-modal"), "true");
  assert.equal(await page.locator(".menu-content").evaluate((element) => element.inert), true, "the menu beneath is inert");
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-credits-film") === "playing");
  record(`Clicking Credits opens a fullscreen dialog whose video plays at once, unmuted and inline (t=${playing.time.toFixed(2)} s)`);

  await page.waitForFunction(() => Math.abs(Number(document.querySelector(".menu-shell")?.getAttribute("data-audio-film-gain")) - 0.5) < 1e-6);
  assert.notEqual(await shell(page, "data-audio-music-state"), "playing", "the menu soundtrack waits under the film");
  assert.ok(Math.abs(Number(await shell(page, "data-audio-master-gain")) - 0.8) < 1e-6, "Master volume applies to the film");
  record(`The film is routed through the menu graph at Master 0.8 x Music 0.5 while the soundtrack (${musicBefore} before) waits`);

  const bounds = await page.locator(".credits-film video").boundingBox();
  assert.ok(bounds && bounds.width >= 1279 && bounds.height >= 719, JSON.stringify(bounds));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("credits-film")), true, "focus moves into the film");
  // Let it play naturally to the title card for the lead's mid-film capture.
  await waitPlaying(page, 21);
  const midFilm = join(captures, "desktop-credits-film-playing.png");
  await page.screenshot({ path: midFilm });
  shots.push(midFilm);
  record(`The film fills the 1280x720 viewport and keeps playing continuously (${(await video(page)).time.toFixed(1)} s captured)`);

  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector(".credits-film video")?.paused && document.querySelector(".menu-shell")?.getAttribute("data-credits-film") === "paused");
  assert.equal(await page.getByRole("button", { name: "Resume", exact: true }).count(), 1);
  assert.match(await page.locator(".credits-film-status").innerText(), /Paused/);
  const pausedAt = (await video(page)).time;
  await page.waitForTimeout(500);
  assert.equal((await video(page)).time, pausedAt, "a paused film holds its frame");
  await page.keyboard.press("Enter");
  await waitPlaying(page, pausedAt + 0.1);
  assert.equal(await shell(page, "data-credits-film"), "playing");
  record("Space pauses and Enter resumes from the same frame, with a Pause/Resume hint");

  await page.keyboard.press("Escape");
  await expectCreditsPage(page);
  assert.equal(await page.locator(".settings-detail .settings-description-title").innerText(), "Play end credits");
  assert.match(await page.locator("#settings-description").innerText(), /Osita Miles/);
  assert.equal(await page.locator(".menu-content").evaluate((element) => element.inert), false);
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-audio-film-gain") === "0");
  if (musicBefore === "playing") await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-audio-music-state") === "playing", undefined, { timeout: 20000 });
  if (musicBefore === "playing") {
    await page.waitForFunction(({ track, sequence }) => {
      const root = document.querySelector('.menu-shell');
      return root?.getAttribute('data-audio-track') !== track && Number(root?.getAttribute('data-audio-track-sequence')) > sequence;
    }, { track: trackBefore, sequence: sequenceBefore });
  }
  const creditsShot = join(captures, "desktop-credits-page-after-back.png");
  await page.screenshot({ path: creditsShot });
  shots.push(creditsShot);
  record("Esc (Back) skips to the Credits page: Play end credits is focused, every notice row remains and a different shuffled soundtrack song starts");

  await page.keyboard.press("Enter");
  await film(page).waitFor();
  await waitPlaying(page);
  assert.ok((await video(page)).time < 5, "a replay starts from the beginning");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectCreditsPage(page);
  record("Enter on Play end credits replays from the start; the on-screen Back button returns to the Credits page");

  await page.evaluate(() => { window.__filmPad.connected = true; window.dispatchEvent(new Event("gamepadconnected")); });
  await page.getByRole("button", { name: "Play end credits", exact: true }).click();
  await waitPlaying(page);
  await page.evaluate(() => { window.__filmPad.buttons = [0]; });
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-credits-film") === "paused");
  await page.waitForTimeout(450);
  await page.evaluate(() => { window.__filmPad.buttons = [0]; });
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-credits-film") === "playing");
  await page.waitForTimeout(450);
  await page.evaluate(() => { window.__filmPad.buttons = [1]; });
  await expectCreditsPage(page);
  record("Gamepad A pauses and resumes; gamepad B skips to the Credits page");

  // Park the pointer: grid tiles select on hover, which is not what this step checks.
  await page.mouse.move(2, 2);
  await page.keyboard.press("Escape");
  await grid(page).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Credits");
  record("Back from the Credits page returns to the Settings grid with Credits focused, as before");

  // The natural end also lands on the Credits page.
  await grid(page).getByRole("button", { name: categoryName("Credits") }).click();
  await waitPlaying(page);
  await page.evaluate(() => { const element = document.querySelector(".credits-film video"); element.currentTime = element.duration - 0.6; });
  await expectCreditsPage(page);
  record("When the film ends it opens the Credits page with the Play end credits row");
  await page.close();

  // Reduced motion: no autoplay; the notices page offers Play end credits.
  const still = await openPage({ reducedMotion: "reduce" });
  await openSettingsGrid(still);
  await grid(still).getByRole("button", { name: categoryName("Credits") }).click();
  await still.locator(".settings-detail--credits").waitFor();
  await still.waitForTimeout(400);
  assert.equal(await film(still).count(), 0, "reduced motion never autoplays the film");
  assert.equal(await shell(still, "data-credits-film"), "closed");
  assert.equal(await focusedSetting(still), "play-credits");
  assert.match(await still.locator("#settings-description").innerText(), /waits until you choose it/);
  await still.keyboard.press("Enter");
  await film(still).waitFor();
  await waitPlaying(still);
  await still.keyboard.press("Escape");
  await expectCreditsPage(still);
  record("With reduced motion the Credits page opens without autoplay and Play end credits plays the film on request");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await still.setViewportSize(viewport);
    await still.waitForTimeout(150);
    const layout = await still.locator(".settings-detail--credits").evaluate((detail) => {
      const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; };
      return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, rowOverflow: [...detail.querySelectorAll(".settings-row")].some((row) => row.scrollWidth > row.clientWidth + 1), list: rect(detail.querySelector(".settings-detail-list")), info: rect(detail.querySelector(".settings-detail-info")), footer: rect(detail.querySelector(".settings-detail-footer")) };
    });
    assert.equal(layout.horizontalOverflow, false); assert.equal(layout.rowOverflow, false);
    assert.ok(layout.list.right < layout.info.x); assert.ok(layout.footer.x >= 0 && layout.footer.right <= viewport.width && layout.footer.bottom <= viewport.height);
    assert.deepEqual(await still.locator(".settings-row button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Play end credits", "Play the opening"]);
    assert.equal(await still.locator(".settings-row input,.settings-row select").count(), 0);
    assert.equal(await still.getByRole("button", { name: /Reset Defaults/ }).count(), 0);
  }
  await still.setViewportSize({ width: 844, height: 390 });
  await still.getByRole("button", { name: "Play end credits", exact: true }).click();
  await waitPlaying(still);
  const landscape = await still.locator(".credits-film video").boundingBox();
  assert.ok(landscape.x <= 0.5 && landscape.width >= 843 && landscape.height >= 389, JSON.stringify(landscape));
  await still.keyboard.press("Escape");
  await expectCreditsPage(still);
  record("The Credits page keeps its list/description layout without overflow at 1280x720 and 844x390; its controls are Play end credits and Play the opening, and the film fills the whole landscape-phone viewport");
  await still.close();

  // The menu's own Ambient Motion switch counts as reduced motion too, and Music off silences the film.
  const quiet = await openPage({}, { ...preferences, motion: false, music: false });
  await openSettingsGrid(quiet);
  await grid(quiet).getByRole("button", { name: categoryName("Credits") }).click();
  await quiet.locator(".settings-detail--credits").waitFor();
  assert.equal(await film(quiet).count(), 0);
  await quiet.getByRole("button", { name: "Play end credits", exact: true }).click();
  await waitPlaying(quiet);
  await quiet.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-audio-film-gain") === "0");
  await quiet.keyboard.press("Escape");
  await expectCreditsPage(quiet);
  record("Ambient Motion off also waits for Play end credits, and Music off mutes the film's score");
  await quiet.close();

  assert.deepEqual(errors, []);
  record("No JavaScript or console errors");
} catch (error) { failure = error; }
finally {
  await mkdir("artifacts/credits-film", { recursive: true });
  await writeFile("artifacts/credits-film/verification.json", JSON.stringify({ passed: !failure, scope: "Desktop end-credits film through real clicks, keys and a simulated standard gamepad (model=none, SwiftShader).", checks, captures: shots, errors, ...(failure ? { failure: String(failure.stack || failure) } : {}) }, null, 2) + "\n");
  await browser.close();
}
if (failure) { console.error(failure); process.exit(1); }
