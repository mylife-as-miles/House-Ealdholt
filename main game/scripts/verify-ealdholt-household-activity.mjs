// Actual-input, actual-origin household panel acceptance. Every browser store
// belongs to a new isolated context. No inherited save, sidecar, clock, activity,
// document visibility or application action is installed or invoked by this QA.
// Supply CROWNFALL_EALDHOLT_ARTIFACTS outside the checkout. --prepare-only does
// not launch a browser. The coordinator owns the sole browser/GPU lease.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { tsImport } from "../../main-game-vr/node_modules/tsx/dist/esm/api/index.mjs";

const shared = path => tsImport(`../../shared/legacy/${path}.ts`, import.meta.url);
const [state, reducer, heraldry, persistence, archive, entryStorage, entry, householdStorage, simulation, runtimeCopy, copy, previewCopy] = await Promise.all([
  shared("domain/state"), shared("domain/reducer"), shared("content/heraldry"), shared("domain/persistence"),
  shared("aethelgard/storage"), shared("aethelgard/inherited-storage"), shared("aethelgard/inherited-session"),
  shared("aethelgard/household-storage"), shared("aethelgard/household-simulation"), shared("aethelgard/household-runtime-copy"),
  shared("aethelgard/inherited-copy"), shared("aethelgard/copy"),
]);
const C = copy.EALDHOLT_INHERITED_COPY, P = previewCopy.EALDHOLT_PREVIEW_COPY;
const ENTRY = entryStorage.INHERITED_SESSION_STORAGE_KEY, SIDECAR = householdStorage.HOUSEHOLD_SIDECAR_STORAGE_KEY;
const at = "2026-11-06T10:00:00.000Z";
const founded = reducer.reduceLegacy(state.createLegacyState({ at }), {
  type: "found-banner", name: "QA predecessor", nationId: "aethelgard", heraldry: heraldry.defaultHeraldry("aethelgard"), motto: null, seed: 711, at,
});
const originalRaw = `\n${JSON.stringify(founded.state, null, 2)}\n`;
assert.ok(persistence.parseLegacySave(originalRaw).ok);
const fixtures = {
  [persistence.LEGACY_STORAGE_KEY]: originalRaw,
  [archive.AETHELGARD_STORAGE_KEY]: "synthetic earlier Legacy experiment retained verbatim\n",
  "crownfall.estate.save": "synthetic independent estate bytes retained verbatim\n",
};
const quality = process.env.CROWNFALL_EALDHOLT_QUALITY || "low";
assert.ok(["low", "medium", "high"].includes(quality));
const base = new URL(process.env.CROWNFALL_TEST_URL || "http://127.0.0.1:5173");
base.searchParams.delete("ealdholt-preview"); base.searchParams.set("ealdholt-house", "1");
const hash = value => createHash("sha256").update(value).digest("hex");
const digest = raw => raw === null ? null : { utf8Bytes: Buffer.byteLength(raw), sha256: hash(raw) };
const returnOnly = process.argv.includes("--return-only");
const report = { passed: false, startedAt: new Date().toISOString(), origin: base.origin, quality,
  selectedScope: returnOnly ? "return-only" : "household-activity",
  scope: "Saved inherited app, isolated context, real input and real wall clock; no physical Quest or art/performance claim.",
  clockOverrides: 0, visibilityOverrides: 0, applicationActionBypasses: 0, preparedInheritedSaves: 0,
  checks: [], samples: [], errors: [], browserClosed: false, documentHidden: "not-exercised" };
const pass = id => { report.checks.push(id); console.log("PASS " + id); };
if (process.argv.includes("--prepare-only")) {
  assert.equal(typeof runtimeCopy.getHouseholdActivityPanel, "function");
  console.log(JSON.stringify({ prepared: true, browserStarted: false, validSyntheticPredecessor: true, isolatedContext: true, quality }));
  process.exit(0);
}
assert.ok(process.env.CROWNFALL_EALDHOLT_ARTIFACTS, "Choose a private QA output directory.");
const directory = resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS);
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRelative = relative(checkout, directory);
assert.ok(outputRelative.startsWith("../") || outputRelative === "..", "QA evidence must stay outside the checkout.");
await mkdir(directory, { recursive: true, mode: 0o700 });
let browser, context, page, savedEntryRaw, epoch, firstEventCount = 0;
const until = async (read, label, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw Error(label + " timed out.");
};
async function observed(label) {
  const value = await page.evaluate(({ entryKey, sidecarKey }) => ({
    bytes: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    writes: [...window.__householdQaWrites], visibility: document.visibilityState,
    entryRaw: localStorage.getItem(entryKey), sidecarRaw: localStorage.getItem(sidecarKey),
  }), { entryKey: ENTRY, sidecarKey: SIDECAR });
  for (const [key, raw] of Object.entries(fixtures)) assert.equal(value.bytes[key], raw, "A synthetic predecessor changed.");
  if (savedEntryRaw) assert.equal(value.entryRaw, savedEntryRaw, "Read-only activity must preserve the confirmed entry.");
  const sidecar = value.sidecarRaw ? JSON.parse(value.sidecarRaw) : null;
  if (sidecar) {
    assert.equal(sidecar.kind, "household-sidecar"); assert.equal(sidecar.schemaVersion, 1);
    assert.equal(simulation.validateHouseholdSimulation(sidecar.aggregate), null, "Stored simulation must remain valid.");
    if (epoch !== undefined) assert.equal(sidecar.aggregate.events.world.startedAt, epoch, "The world epoch must survive return and reload.");
    assert.equal(new Set(sidecar.aggregate.events.events.map(event => event.id)).size, sidecar.aggregate.events.events.length, "Occurred event IDs must be unique.");
    assert.equal(sidecar.aggregate.commands.length, 0, "The read-only panel cannot issue simulation commands.");
    const world = sidecar.aggregate.events.world;
    report.samples.push({ label, entry: digest(value.entryRaw), sidecar: digest(value.sidecarRaw), generation: sidecar.aggregate.generation,
      elapsedSteps: world.elapsedSteps, startedAt: world.startedAt, recordedEvents: sidecar.aggregate.events.events.length,
      completeTasks: sidecar.aggregate.actions.filter(action => action.status === "completed").length, visibility: value.visibility });
  }
  return { ...value, sidecar };
}
async function enter() {
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor({ timeout: 45000 });
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await page.locator('.ealdholt-preview[aria-hidden="false"]').waitFor({ timeout: 45000 });
  await until(async () => {
    const values = await page.locator('.ealdholt-world').evaluate(node => ({ ...node.dataset })).catch(() => null);
    return values?.modelReady === "true" && Number(values.renderFrames) > 0;
  }, "normal configured village first frame", 150000);
}
async function boot() {
  // The source GLB is large. Poll bounded observations rather than one long
  // blocking browser wait; the owner can continue reporting progress meanwhile.
  await until(async () => await page.locator(".menu-shell").count() > 0 && await page.locator(".loading-screen").count() === 0,
    "normal menu asset and font boot", 150000);
}
const root = () => page.locator('.ealdholt-preview[aria-hidden="false"]');
const activity = () => root().locator("[data-ealdholt-household-activity]");
async function openActivity() {
  // The host intentionally retains the open reading pane on Home return.
  // Re-entering that pane is already the desired state, not missing navigation.
  if (await activity().isVisible().catch(() => false)) return;
  if (!await root().locator("button[data-ealdholt-activity-open]").isVisible().catch(() => false)) {
    const people = root().locator("[data-ealdholt-household]");
    if (await people.isVisible().catch(() => false)) await people.click();
    else await root().getByRole("button", { name: C.otherPeople, exact: true }).click();
  }
  await root().locator("button[data-ealdholt-activity-open]").waitFor({ timeout: 45000 });
  await root().locator("button[data-ealdholt-activity-open]").click();
  await activity().waitFor({ timeout: 45000 });
}
async function matchPanel(label) {
  await until(async () => {
    const read = await page.evaluate(({ key }) => {
      const panel = document.querySelector("[data-ealdholt-household-activity]");
      if (!panel) return null;
      const raw = localStorage.getItem(key); if (!raw) return null;
      return { raw, resident: panel.getAttribute("data-ealdholt-activity-resident"), count: Number(panel.getAttribute("data-ealdholt-activity-count")),
        text: panel.textContent,
        recorded: panel.querySelector("[data-ealdholt-activity-recorded]")?.textContent,
        planned: panel.querySelector("[data-ealdholt-activity-planned]")?.textContent,
        event: panel.querySelector("[data-ealdholt-activity-event]")?.textContent ?? null };
    }, { key: SIDECAR });
    if (!read) return false;
    const sim = JSON.parse(read.raw).aggregate;
    const panel = runtimeCopy.getHouseholdActivityPanel({ phase: "ready", simulation: sim, busy: false, finite: true, error: null, reason: null,
      deferredSteps: Math.floor(sim.events.world.pendingMilliseconds / sim.events.world.stepMilliseconds),
      completedTasks: sim.actions.filter(action => action.status === "completed").length, totalTasks: sim.actions.length });
    const row = panel?.residents.find(resident => resident.id === read.resident);
    return !!row && read.count === panel.residents.length && read.recorded === row.recordedActivity && read.planned === row.plannedRoutine
      && (!row.latestEvent || read.event === row.latestEvent)
      && [row.label, row.role, row.household, ...row.family, ...row.socialTies].every(value => read.text.includes(value));
  }, label);
}
async function capture() {
  await page.screenshot({ path: resolve(directory, "desktop-household-activity.png"), timeout: 45000 });
  await sharp(resolve(directory, "desktop-household-activity.png")).resize({ width: 600 }).jpeg({ quality: 70 }).toFile(resolve(directory, "desktop-household-activity-600.jpg"));
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--disable-dev-shm-usage"] });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  page = await context.newPage(); page.setDefaultTimeout(45000);
  page.on("pageerror", error => report.errors.push({ kind: "page", message: error.message }));
  page.on("console", message => { if (message.type() === "error") report.errors.push({ kind: "console", message: message.text() }); });
  await page.addInitScript(({ fixtures, quality }) => {
    if (!sessionStorage.getItem("household-activity-qa-seeded")) {
      for (const [key, raw] of Object.entries(fixtures)) localStorage.setItem(key, raw);
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality, motion: false, volume: 65, showHints: true }));
      sessionStorage.setItem("household-activity-qa-seeded", "1");
    }
    window.__householdQaWrites = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, raw) {
      if (this === localStorage) window.__householdQaWrites.push({ key, at: Date.now() });
      return set.call(this, key, raw);
    };
  }, { fixtures, quality });
  await page.goto(base.href, { waitUntil: "domcontentloaded" }); await boot();
  const before = await observed("before confirmation");
  assert.equal(before.entryRaw, null); assert.equal(before.sidecarRaw, null);
  await enter();
  await root().getByRole("button", { name: P.intro.continue, exact: false }).click();
  await root().locator("[data-ealdholt-preset]").first().click();
  const confirmationStarted = Date.now();
  await root().getByRole("button", { name: C.confirm, exact: false }).click();
  await root().locator("[data-ealdholt-household]").waitFor({ timeout: 45000 });
  await until(async () => !!await page.evaluate(key => localStorage.getItem(key), SIDECAR), "actual entry household initialization");
  const initialized = await observed("confirmed entry");
  assert.ok(entry.parseInheritedSession(initialized.entryRaw).ok); savedEntryRaw = initialized.entryRaw;
  assert.equal(initialized.bytes[archive.PRE_AETHELGARD_ARCHIVE_KEY], originalRaw);
  epoch = initialized.sidecar.aggregate.events.world.startedAt;
  assert.ok(epoch >= confirmationStarted - 1000 && epoch <= Date.now() + 1000, "Runtime creation must sample the actual confirmation era.");
  assert.equal(initialized.sidecar.aggregate.events.world.stepMilliseconds, 1000, "This bounded QA expects the unchanged authored one-second pilot cadence.");
  pass("actual-confirmed-entry-initializes-household-without-seeded-save");
  await openActivity(); await matchPanel("current snapshot presentation");
  assert.equal(await activity().getAttribute("data-ealdholt-activity-count"), "3");
  if (!returnOnly) {
  const first = await activity().getAttribute("data-ealdholt-activity-resident");
  await root().locator("button[data-ealdholt-activity-next]").click();
  assert.notEqual(await activity().getAttribute("data-ealdholt-activity-resident"), first);
  await root().locator("button[data-ealdholt-activity-previous]").click();
  assert.equal(await activity().getAttribute("data-ealdholt-activity-resident"), first);
  await root().locator("button[data-ealdholt-activity-previous]").click();
  assert.equal(await activity().getAttribute("data-ealdholt-activity-index"), "2");
  await root().locator("button[data-ealdholt-activity-next]").click();
  assert.equal(await activity().getAttribute("data-ealdholt-activity-index"), "0");
  await matchPanel("paged snapshot presentation"); pass("pager-wraps-and-preserves-separate-resident-identity");
  const foreground = await observed("before foreground tick");
  await until(async () => {
    const raw = await page.evaluate(key => localStorage.getItem(key), SIDECAR);
    return raw && JSON.parse(raw).aggregate.events.world.elapsedSteps > foreground.sidecar.aggregate.events.world.elapsedSteps;
  }, "actual foreground tick", 10000);
  assert.equal(await root().locator("button[data-ealdholt-activity-next]").evaluate(node => node === document.activeElement), true, "Runtime ticks must not steal pager focus.");
  await matchPanel("foreground panel matches saved simulation"); await observed("after foreground tick");
  pass("real-wallclock-foreground-tick-updates-panel-without-focus-theft");
  await page.keyboard.press("Escape");
  assert.equal(await activity().count(), 0); assert.equal(await root().locator("button[data-ealdholt-activity-open]").isVisible(), true);
  assert.equal(await root().locator("[data-ealdholt-person-id]").count(), 3, "The separate story conversation roster stays available.");
  await root().locator("[data-ealdholt-person-id]").first().click();
  await root().locator("[data-ealdholt-option]").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await root().locator("[data-ealdholt-person-id]").count(), 3);
  pass("separate-story-conversations-remain-reachable-without-recording-choice");
  await openActivity();
  await root().getByRole("button", { name: P.actions.pause, exact: true }).click();
  await root().getByRole("dialog").waitFor();
  await page.waitForTimeout(200);
  const paused = await observed("paused"); await page.waitForTimeout(2200);
  assert.equal((await observed("paused after real interval")).sidecarRaw, paused.sidecarRaw);
  await root().getByRole("dialog").getByRole("button", { name: P.actions.resume, exact: true }).click();
  await matchPanel("explicit Resume catches up"); pass("pause-stops-host-writes-and-explicit-resume-retains-world-epoch");
  const other = await context.newPage(); await other.goto("about:blank"); await other.bringToFront();
  const actuallyHidden = await until(async () => await page.evaluate(() => document.hidden), "genuine browser tab hiding", 3000).catch(() => false);
  if (actuallyHidden) {
    report.documentHidden = "observed"; await page.waitForTimeout(200);
    const hidden = await observed("document hidden"); await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal((await observed("document hidden after real interval")).sidecarRaw, hidden.sidecarRaw);
    await page.bringToFront(); await other.close();
    await root().getByRole("dialog").getByRole("button", { name: P.actions.resume, exact: true }).click();
    await matchPanel("return from actual hidden tab"); pass("actual-document-hidden-stops-writes-return-requires-resume");
  } else {
    report.documentHidden = "unavailable: this browser keeps background pages visible";
    await other.close(); await page.bringToFront();
  }
  // Real focus loss can pause the product even where headless Chromium keeps
  // document.visibilityState visible. Resume through the actual control.
  if (await root().getByRole("dialog").isVisible().catch(() => false))
    await root().getByRole("dialog").getByRole("button", { name: P.actions.resume, exact: true }).click();
  }
  await root().getByRole("button", { name: P.actions.home, exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await page.waitForTimeout(200);
  const away = await observed("Home host inactive"); await page.waitForTimeout(2200);
  assert.equal((await observed("Home after real interval")).sidecarRaw, away.sidecarRaw);
  await enter(); await openActivity(); await matchPanel("Home return");
  await page.reload({ waitUntil: "domcontentloaded" }); await boot();
  await enter(); await openActivity(); await matchPanel("reloaded saved household");
  await observed("reload retains original epoch and predecessor");
  pass("Home-return-and-page-reload-restore-same-household-epoch");
  const deadline = Date.now() + 110000;
  while (Date.now() < deadline) {
    const value = await observed("finite pilot observation");
    if (value.sidecar.aggregate.actions.every(action => action.status === "completed")) break;
    await page.waitForTimeout(1000);
  }
  const done = await observed("finite pilot completion");
  assert.ok(done.sidecar.aggregate.actions.every(action => action.status === "completed"), "The finite authored pilot must finish.");
  firstEventCount = done.sidecar.aggregate.events.events.length;
  assert.equal(firstEventCount, done.sidecar.aggregate.actions.length);
  await matchPanel("completed pilot presentation"); await capture();
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Landscape presentation must not overflow the document horizontally.");
  assert.equal(await root().locator("button[data-ealdholt-activity-close]").isVisible(), true);
  await root().locator("button[data-ealdholt-activity-close]").click();
  assert.equal(await root().locator("button[data-ealdholt-activity-open]").isVisible(), true);
  pass("landscape-activity-can-close-back-to-separate-People-roster");
  await page.waitForTimeout(2200);
  const retired = await observed("finite scheduler retired");
  assert.equal(retired.sidecarRaw, done.sidecarRaw, "Finite completion must retire the host scheduler.");
  assert.equal(retired.sidecar.aggregate.events.events.length, firstEventCount);
  pass("finite-pilot-completes-with-unique-events-and-no-invented-recurring-day");
  assert.deepEqual(report.errors, [], "Browser errors must be reviewed.");
  report.passed = true;
} catch (error) {
  report.failure = String(error.stack || error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(directory, "failure.png"), timeout: 45000 }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  report.browserClosed = true; report.finishedAt = new Date().toISOString();
  await writeFile(resolve(directory, "verification.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, browserErrors: report.errors.length,
  documentHidden: report.documentHidden, browserClosed: report.browserClosed, evidence: resolve(directory, "verification.json"),
  failure: report.failure ? "See private verification report; resident labels and seed data are not printed." : null }));
