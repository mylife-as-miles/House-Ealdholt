// Real Desktop first-visit flow. Software-rendered browser evidence is not
// physical Quest or GPU performance evidence. No private house history is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { waitForBootReady } from "./boot-helpers.mjs";

const directory = resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS || "artifacts/ealdholt-preview");
const address = new URL(process.env.CROWNFALL_TEST_URL || "http://127.0.0.1:5173");
address.searchParams.set("ealdholt-preview", "1");
const saveKey = "crownfall.legacy.save";
const originalSave = "predecessor-bytes-kept-exactly-ealdholt-verification";
const quality = process.env.CROWNFALL_EALDHOLT_QUALITY || "high";
assert.ok(["low", "medium", "high"].includes(quality));
const checks = [], errors = [], layouts = [], deliberateNetworkErrors = [];
const comparisonViews = [];
let blockedModelRequests = 0;
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
await mkdir(directory, { recursive: true });
let failure;
let page;
const modelRequests = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  // Software GPU completion may lag well behind the JavaScript ready signal.
  // This bound does not establish hardware frame rate or cold-start readiness.
  const capture = path => page.screenshot({ path, timeout: 120000 });
  page.on("request", request => { const path = new URL(request.url()).pathname; if (/elderbloom.*\.glb$/.test(path)) modelRequests.push(path); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource: net::ERR_FAILED")) deliberateNetworkErrors.push(message.text());
    else errors.push(message.text());
  });
  const modelPattern = /elderbloom-village-(desktop-coastal-full-woodland-candidate-v5|quest-coastal-pond-foliage-candidate-v2-normal16|desktop-coastal-woodland-candidate-v4|desktop-coastal-surface-candidate-v3|quest-coastal-pond-surface-candidate-v3|desktop-coastal-candidate-v[12]|quest-coastal-pond-v2-candidate-v[12]|desktop-canopy-v5|desktop-detailed|quest-ground-detail(?:-atlas1k(?:-pond-v2)?))\.glb(?:\?.*)?$/;
  await page.route(modelPattern, route => { blockedModelRequests++; return route.abort("failed"); });
  await page.addInitScript(({ key, value, quality }) => {
    if (!sessionStorage.getItem("ealdholt-verification-seeded")) {
      localStorage.setItem(key, value);
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality, motion: false, volume: 65, showHints: true }));
      sessionStorage.setItem("ealdholt-verification-seeded", "1");
    }
  }, { key: saveKey, value: originalSave, quality });
  await page.goto(address.href, { waitUntil: "domcontentloaded" });
  await waitForBootReady(page);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  const root = page.locator(".ealdholt-preview");
  const world = page.locator(".ealdholt-world");
  const ready = () => page.locator('[data-ealdholt-world="ready"]').waitFor({ timeout: 240000 });
  const step = value => page.locator(`[data-ealdholt-step="${value}"]`).waitFor();
  await page.locator('[data-ealdholt-world="error"]').waitFor();
  await page.unroute(modelPattern);
  await root.getByRole("button", { name: "Try again", exact: true }).click();
  await ready();
  if (process.env.CROWNFALL_REQUIRE_POND_PROBE === "1") {
    const probe = await world.evaluate(node => ({ ...node.dataset }));
    assert.equal(probe.pondProbeStatus, "bound");
    assert.equal(probe.pondProbeMaterials, "1");
    assert.equal(probe.pondProbeSource, "desktop-hdr-loader");
    assert.equal(probe.pondProbeWidth, quality === "low" ? "512" : "1024");
    assert.equal(probe.pondProbeHeight, quality === "low" ? "256" : "512");
    if (process.env.CROWNFALL_EXPECT_POND_MODEL_SHA256) assert.equal(probe.pondProbeModelSha256, process.env.CROWNFALL_EXPECT_POND_MODEL_SHA256);
    pass("configured source-matched local pond HDR loads through the real Desktop path");
  }
  assert.ok(deliberateNetworkErrors.length >= 1 && deliberateNetworkErrors.length <= blockedModelRequests);
  pass("model failure shows recovery and Try again loads the same view");
  await step("intro");
  await page.evaluate(() => document.fonts.ready);
  await capture(resolve(directory, "desktop-intro.png"));
  pass("intro loads through actual Home entry");

  await root.getByRole("button", { name: "Shape your banner" }).click();
  await step("banner");
  assert.equal(await root.getByRole("button", { name: "Explore the village", exact: true }).isEnabled(), false);
  await root.locator("[data-ealdholt-preset]").first().click();
  assert.equal(await root.locator('[data-ealdholt-preset][aria-pressed="true"]').count(), 1);
  assert.equal(await root.getByRole("button", { name: "Explore the village", exact: true }).isEnabled(), true);
  await root.getByRole("button", { name: "Customize design" }).click();
  const field = root.locator('[data-ealdholt-part="division"]');
  await field.focus();
  const beforePart = await field.getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await field.getAttribute("aria-label"), beforePart);
  await capture(resolve(directory, "desktop-banner.png"));
  pass("preset and keyboard custom banner update live preview");

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const layout = await root.evaluate(node => {
      const visible = [...node.querySelectorAll("button")].filter(button => button.checkVisibility() && !button.disabled);
      return { viewport: [innerWidth, innerHeight], pageOverflow: document.documentElement.scrollWidth > innerWidth,
        minTargetHeight: Math.min(...visible.map(button => button.getBoundingClientRect().height)),
        minButtonFont: Math.min(...visible.map(button => parseFloat(getComputedStyle(button).fontSize))),
      };
    });
    layouts.push(layout);
    assert.equal(layout.pageOverflow, false);
    assert.ok(layout.minTargetHeight >= 43.9, JSON.stringify(layout));
    assert.ok(layout.minButtonFont >= 12, JSON.stringify(layout));
    // Navigate the real focus path, including scroll-revealed controls.
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await root.evaluate(node => node.contains(document.activeElement)), true);
    }
    await capture(resolve(directory, `desktop-banner-${viewport.width}x${viewport.height}.png`));
  }
  pass("landscape and large-screen banner controls remain readable and keyboard-contained");
  await page.setViewportSize({ width: 1280, height: 720 });
  await root.getByRole("button", { name: "Explore the village", exact: true }).click();
  await step("village");
  const beforeYaw = await world.getAttribute("data-camera-yaw");
  await root.getByRole("button", { name: "Orbit right", exact: true }).click();
  await page.waitForFunction(before => document.querySelector(".ealdholt-world")?.dataset.cameraYaw !== before, beforeYaw);
  await root.getByRole("button", { name: "Reset view", exact: true }).click();
  await root.getByRole("button", { name: "Edit banner", exact: true }).click();
  await step("banner");
  await root.getByRole("button", { name: "Back", exact: true }).click();
  await step("village");
  pass("orbit/reset and banner Back return to village");

  for (const id of ["overview", "churchyard", "well", "lakeside", "riverside"]) {
    await root.locator(`[data-ealdholt-view="${id}"]`).click();
    await page.waitForFunction(value => document.querySelector(".ealdholt-world")?.dataset.selectedView === value, id);
    const pose = await world.evaluate(node => ({ ...node.dataset }));
    // Art comparison only: conceal the DOM overlay, never replace/crop the
    // rendered scene or change its camera, lights, geometry or material state.
    const hiddenHud = await page.addStyleTag({ content: ".ealdholt-preview > :not(.ealdholt-world) { visibility: hidden !important; }" });
    try { await capture(resolve(directory, `comparison-${id}-hud-hidden.png`)); }
    finally { await hiddenHud.evaluate(element => element.remove()); }
    comparisonViews.push({ id, ...pose, diagnosticHudHidden: true });
  }
  await root.locator('[data-ealdholt-view="overview"]').click();
  pass("all five shared named views render with recorded source camera poses");

  await root.getByRole("button", { name: "Pause", exact: true }).click();
  const dialog = root.getByRole("dialog");
  await dialog.waitFor();
  const pausedFrames = await world.getAttribute("data-render-frames");
  await page.waitForTimeout(400);
  assert.equal(await world.getAttribute("data-render-frames"), pausedFrames);
  await dialog.getByRole("button", { name: "Resume", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await capture(resolve(directory, "desktop-village.png"));
  pass("pause stops drawing until explicit Resume");

  const resources = await world.evaluate(node => ({ ...node.dataset }));
  await root.getByRole("button", { name: "Return to Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  const inactiveFrames = await world.getAttribute("data-render-frames");
  await page.waitForTimeout(400);
  assert.equal(await world.getAttribute("data-render-frames"), inactiveFrames);
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await ready();
  await step("village");
  assert.equal(await world.getAttribute("data-geometry-count"), resources.geometryCount);
  assert.equal(await world.getAttribute("data-texture-count"), resources.textureCount);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), originalSave);
  pass("Home return reuses resources and preserves predecessor bytes exactly");
  await root.getByRole("button", { name: "Return to Play", exact: true }).click();
  await page.locator('[data-ealdholt-step]').waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), originalSave);
  pass("Play remains directly reachable with predecessor save unchanged");
  assert.deepEqual(errors, []);
  await writeFile(resolve(directory, "desktop-verification.json"), JSON.stringify({ passed: true, checks, layouts, comparisonViews, resources, errors,
    limits: "Software Chromium, visit-only preview. No persistent Ealdholt initialization, NPC story, physical GPU or Quest pass claimed." }, null, 2));
  await context.close();
} catch (error) {
  failure = error;
  const observed = page ? await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(-2500), state: document.querySelector(".ealdholt-preview")?.dataset })).catch(() => null) : null;
  await page?.screenshot({ path: resolve(directory, "desktop-verification-failure.png"), timeout: 20000 }).catch(() => {});
  await writeFile(resolve(directory, "desktop-verification.json"), JSON.stringify({ passed: false, checks, layouts, comparisonViews, modelRequests, observed, errors, failure: String(error.stack || error) }, null, 2));
} finally { await browser.close(); }
if (failure) throw failure;
