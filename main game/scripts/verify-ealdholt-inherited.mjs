// Real pointer/keyboard QA in isolated, synthetic browser stores. This uses the
// normal app renderer and assets; Low on SwiftShader is interaction evidence,
// never a Desktop High art reference or a hardware performance measurement.
// Run from main game/: CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-ealdholt-inherited.mjs
// Optional: CROWNFALL_TEST_URL, CROWNFALL_EALDHOLT_QUALITY,
// CROWNFALL_EALDHOLT_ARTIFACTS; --prepare-only validates fixtures without a
// browser, and --only=main,future,... repeats only named failed/pending scopes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { tsImport } from "../../main-game-vr/node_modules/tsx/dist/esm/api/index.mjs";
import { waitForBootReady } from "./boot-helpers.mjs";

// Import shared fixture factories/copy, rather than maintaining a second schema
// or copying dialogue/private configuration into this harness.
const shared = path => tsImport(`../../shared/legacy/${path}.ts`, import.meta.url);
const [state, reducer, heraldry, persistence, storage, inheritedStorage, inheritedSession, settlement, people, copy, previewCopy, entryDraft, house] = await Promise.all([
  shared("domain/state"), shared("domain/reducer"), shared("content/heraldry"), shared("domain/persistence"),
  shared("aethelgard/storage"), shared("aethelgard/inherited-storage"), shared("aethelgard/inherited-session"),
  shared("settlement/storage"), shared("aethelgard/people-draft"), shared("aethelgard/inherited-copy"), shared("aethelgard/copy"),
  shared("aethelgard/entry-draft"), shared("aethelgard/house"),
]);
const C = copy.EALDHOLT_INHERITED_COPY, P = previewCopy.EALDHOLT_PREVIEW_COPY;
const originalKey = persistence.LEGACY_STORAGE_KEY;
const inheritedKey = inheritedStorage.INHERITED_SESSION_STORAGE_KEY;
const archiveKey = storage.PRE_AETHELGARD_ARCHIVE_KEY;
const at = "2026-11-06T10:00:00.000Z";
const founded = reducer.reduceLegacy(state.createLegacyState({ at }), {
  type: "found-banner", name: "QA predecessor", nationId: "aethelgard", heraldry: heraldry.defaultHeraldry("aethelgard"), motto: null, seed: 711, at,
});
assert.ok(founded.state.banner, "synthetic original has a real valid banner");
const originalRaw = `\n${JSON.stringify(founded.state, null, 2)}\n`;
assert.ok(persistence.parseLegacySave(originalRaw).ok);
const estateKey = settlement.settlementStorageKey(founded.state.banner.id, "bannerhold");
const estateRaw = `\n${JSON.stringify({ version: 1, bannerId: founded.state.banner.id, worldId: "bannerhold", placements: [
  { id: "qa-cottage", kind: "cottage", x: 20, z: 20, width: 8, depth: 7, rotation: 0, crop: null },
] }, null, 2)}\n`;
assert.ok(settlement.parseSettlementLayout(estateRaw, founded.state.banner.id, "bannerhold"));
const fixtures = {
  [originalKey]: originalRaw, [estateKey]: estateRaw,
  [storage.AETHELGARD_STORAGE_KEY]: "synthetic earlier Legacy experiment retained verbatim\n",
  "crownfall.estate.save": "synthetic independent estate bytes retained verbatim\n",
};
const quality = process.env.CROWNFALL_EALDHOLT_QUALITY || "low";
assert.ok(["low", "medium", "high"].includes(quality));
const base = new URL(process.env.CROWNFALL_TEST_URL || "http://127.0.0.1:5173");
const directory = resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS || "artifacts/ealdholt-inherited");
const selected = process.argv.find(arg => arg.startsWith("--only="))?.slice(7)?.split(",");
const report = { startedAt: new Date().toISOString(), quality, renderer: "SwiftShader software host; normal app assets and camera", viewport: { width: 1280, height: 720 }, fixtures, checks: [], failures: [], console: [], pageErrors: [], layouts: [], snapshots: [], world: null, browserClosed: false };
const pass = (scope, name, detail) => { report.checks.push({ scope, name, ...(detail ? { detail } : {}) }); console.log(`PASS [${scope}] ${name}`); };
const scopes = ["main", "future", "corrupt", "locks", "lock-rejected", "preview", "conversation"];
if (selected) for (const scope of selected) assert.ok(scopes.includes(scope), `unknown scope: ${scope}`);
await mkdir(directory, { recursive: true });
if (process.argv.includes("--prepare-only")) {
  console.log(JSON.stringify({ prepared: true, scopes, quality, validOriginal: true, validEstate: true, browserStarted: false }));
  process.exit(0);
}
let browser, currentPage, completedRaw;
function address(mode) {
  const url = new URL(base);
  url.searchParams.delete("ealdholt-preview"); url.searchParams.delete("ealdholt-house");
  url.searchParams.set(mode === "preview" ? "ealdholt-preview" : "ealdholt-house", "1");
  return url.href;
}
async function open(scope, additions = {}, locks = "normal", mode = "inherited") {
  const context = await browser.newContext({ viewport: report.viewport, reducedMotion: "reduce" });
  const page = await context.newPage(); currentPage = page;
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.pageErrors.push({ scope, message: error.message }));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) report.console.push({ scope, type: message.type(), message: message.text() });
  });
  await page.addInitScript(({ fixtures, quality, locks }) => {
    if (!sessionStorage.getItem("ealdholt-inherited-qa-seeded")) {
      for (const [key, raw] of Object.entries(fixtures)) localStorage.setItem(key, raw);
      localStorage.setItem("crownfall.main-game.preferences", JSON.stringify({ quality, motion: false, volume: 65, showHints: true }));
      sessionStorage.setItem("ealdholt-inherited-qa-seeded", "1");
    }
    // Record mutations only after synthetic fixture installation. This cannot
    // intercept another profile or invoke any application command.
    window.__inheritedQaWrites = [];
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem, clear = Storage.prototype.clear;
    Storage.prototype.setItem = function (key, raw) {
      if (this === localStorage) window.__inheritedQaWrites.push({ operation: "set", key, raw: String(raw) });
      return set.call(this, key, raw);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage) window.__inheritedQaWrites.push({ operation: "remove", key });
      return remove.call(this, key);
    };
    Storage.prototype.clear = function () {
      if (this === localStorage) window.__inheritedQaWrites.push({ operation: "clear" });
      return clear.call(this);
    };
    if (locks === "missing") Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    if (locks === "rejected") Object.defineProperty(navigator, "locks", { configurable: true, value: {
      request: () => Promise.reject(new DOMException("QA denied lock acquisition", "NotAllowedError")),
    } });
  }, { fixtures: { ...fixtures, ...additions }, quality, locks });
  await page.goto(address(mode), { waitUntil: "domcontentloaded" });
  await waitForBootReady(page, { timeout: 120000 });
  return { page, context, root: page.locator(".ealdholt-preview"), expected: { ...fixtures, ...additions } };
}
async function snapshot(page, scope, label) {
  const data = await page.evaluate(() => ({ bytes: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])), writes: [...window.__inheritedQaWrites] }));
  report.snapshots.push({ scope, label, ...data }); return data;
}
function retained(snapshot, expected) {
  for (const [key, raw] of Object.entries(expected)) assert.equal(snapshot.bytes[key], raw, `exact fixture bytes retained: ${key}`);
}
function legacyWrites(snapshot) { return snapshot.writes.filter(write => write.operation === "clear" || /^crownfall\.(legacy|estate)/.test(write.key)); }
async function enter(page) {
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-grid").waitFor();
  await page.getByRole("button", { name: "My Legacy", exact: true }).click();
  await page.locator('.ealdholt-preview[aria-hidden="false"]').waitFor();
}
async function step(page, value) { await page.locator(`.ealdholt-preview[data-ealdholt-step="${value}"][aria-hidden="false"]`).waitFor(); }
async function openRole(root, person) {
  if (!await root.locator(`[data-ealdholt-person-id="${person.id}"]`).count()) {
    const entry = root.locator("[data-ealdholt-household]");
    if (await entry.count()) await entry.click();
    else await root.getByRole("button", { name: C.otherPeople, exact: true }).click();
  }
  await root.locator(`[data-ealdholt-person-id="${person.id}"]`).click();
}
async function menuPlay(page) {
  await page.locator(".game-cards").waitFor();
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await page.locator(".match-setup").waitFor();
  assert.ok(await page.getByRole("button", { name: "Start match", exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await page.locator(".game-cards").waitFor();
}
async function preserveFailure(page, scope, error) {
  await writeFile(resolve(directory, `failure-${scope}.json`), JSON.stringify({ message: error.message, stack: error.stack,
    url: page.url(), body: await page.locator("body").innerText().catch(() => "unavailable"), snapshot: await snapshot(page, scope, "failure").catch(() => null) }, null, 2));
  await page.screenshot({ path: resolve(directory, `failure-${scope}.png`), timeout: 120000 }).catch(() => undefined);
}
async function layout(page, root, scope, label) {
  const value = await root.evaluate(node => ({ label: "", viewport: [innerWidth, innerHeight], horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    activeFocusInside: node.contains(document.activeElement), buttons: [...node.querySelectorAll("button")].filter(button => button.checkVisibility()).map(button => ({ label: button.textContent.trim() || button.getAttribute("aria-label"), height: button.getBoundingClientRect().height, disabled: button.disabled })) }));
  value.label = label; report.layouts.push({ scope, ...value });
  assert.equal(value.horizontalOverflow, false, `${label}: no horizontal document overflow`);
  assert.ok(value.buttons.length > 0);
  assert.ok(value.buttons.every(button => button.height >= 43.9), `${label}: all visible buttons are at least44px`);
  for (let i = 0; i < 16; i++) { await page.keyboard.press("Tab"); assert.ok(await root.evaluate(node => node.contains(document.activeElement)), `${label}: keyboard remains in inherited screen`); }
}
async function main() {
  const scope = "main", { page, context, root, expected } = await open(scope);
  try {
    await page.getByRole("tab", { name: "Play", exact: true }).click(); await menuPlay(page);
    pass(scope, "existing Classic menu remains reachable before inherited entry");
    const initial = await snapshot(page, scope, "before entry"); retained(initial, expected);
    await enter(page); await step(page, "intro");
    await page.locator('[data-ealdholt-world="ready"]').waitFor({ timeout: 240000 });
    report.world = await root.locator(".ealdholt-world").evaluate(node => ({ ...node.dataset }));
    assert.ok(Number(report.world.renderFrames) > 0); assert.equal(report.world.modelReady, "true");
    pass(scope, "normal configured village rendered", { quality, modelProfile: report.world.modelProfile });
    await root.getByRole("button", { name: P.intro.continue, exact: false }).click(); await step(page, "banner");
    assert.equal(await root.getByRole("button", { name: C.confirm, exact: false }).isEnabled(), false);
    await root.locator("[data-ealdholt-preset]").first().click();
    await root.getByRole("button", { name: P.banner.customize, exact: false }).click();
    const part = root.locator('[data-ealdholt-part="division"]'); await part.focus();
    const before = await part.getAttribute("aria-label"); await page.keyboard.press("ArrowRight");
    assert.notEqual(await part.getAttribute("aria-label"), before);
    await page.keyboard.press("Escape"); await step(page, "intro");
    let observed = await snapshot(page, scope, "cancelled banner"); retained(observed, expected); assert.deepEqual(legacyWrites(observed), []);
    await root.getByRole("button", { name: P.intro.continue, exact: false }).click();
    await root.getByRole("button", { name: P.actions.back, exact: true }).click(); await step(page, "intro");
    observed = await snapshot(page, scope, "back from banner"); retained(observed, expected); assert.deepEqual(legacyWrites(observed), []);
    pass(scope, "steward, pointer preset, keyboard edit, Escape and Back perform zero save writes");
    await root.getByRole("button", { name: P.intro.continue, exact: false }).click(); await step(page, "banner");
    assert.match(await root.locator(".ealdholt-confirmation").innerText(), /separate.*save/);
    await root.getByRole("button", { name: C.confirm, exact: false }).click(); await step(page, "village");
    observed = await snapshot(page, scope, "explicit entry"); retained(observed, expected);
    assert.equal(observed.bytes[archiveKey], originalRaw); assert.ok(inheritedSession.parseInheritedSession(observed.bytes[inheritedKey]).ok);
    assert.deepEqual(legacyWrites(observed).map(write => write.key), [archiveKey, inheritedKey]);
    const fixedBanner = JSON.stringify(JSON.parse(observed.bytes[inheritedKey]).banner);
    assert.equal(await root.getByRole("button", { name: P.banner.edit, exact: false }).count(), 0);
    assert.equal(await root.getByRole("button", { name: P.banner.customize, exact: false }).count(), 0);
    assert.ok(await root.getByText(C.saved, { exact: true }).isVisible());
    pass(scope, "explicit confirmation archives exact predecessor and creates separate fixed-banner session");
    for (const [index, person] of people.EALDHOLT_PEOPLE_DRAFT.entries()) {
      await openRole(root, person);
      assert.ok(await root.getByText(person.greeting, { exact: true }).isVisible());
      const option = person.decision.options[0];
      const button = root.locator(`[data-ealdholt-option="${option.id}"]`);
      // Actual two pointer clicks stress duplicate input; no app/system API call.
      if (index === 0) await button.dblclick({ delay: 35 }); else await button.click();
      await root.getByText(C.recorded, { exact: true }).waitFor();
      await root.locator('[data-ealdholt-acknowledgement="immediate"]').waitFor();
      assert.equal(await root.locator('[data-ealdholt-acknowledgement="immediate"]').innerText(), option.response);
      assert.equal(await root.locator("[data-ealdholt-option]").count(), 0);
      observed = await snapshot(page, scope, `recorded ${person.id}`); retained(observed, expected);
      const session = JSON.parse(observed.bytes[inheritedKey]);
      assert.equal(session.choices.length, index + 1); assert.equal(session.choices.filter(choice => choice.choiceId === person.decision.id).length, 1);
      assert.equal(session.choices[index].optionId, option.id); assert.equal(JSON.stringify(session.banner), fixedBanner);
      await root.getByRole("button", { name: C.close, exact: true }).click();
    }
    pass(scope, "all three registered roles save and acknowledge exactly one choice; duplicate pointer input is consumed once");
    await openRole(root, people.EALDHOLT_PEOPLE_DRAFT[0]);
    await layout(page, root, scope, "desktop acknowledged conversation");
    await page.screenshot({ path: resolve(directory, "desktop-inherited-ui.png"), timeout: 120000 });
    await page.setViewportSize({ width: 844, height: 390 });
    await layout(page, root, scope, "landscape acknowledged conversation");
    await page.screenshot({ path: resolve(directory, "landscape-inherited-ui.png"), timeout: 120000 });
    // CPU-only presentation artifacts retain the actual viewport/profile truth.
    const desktop = await sharp(resolve(directory, "desktop-inherited-ui.png")).resize({ width: 600 }).png().toBuffer();
    const landscape = await sharp(resolve(directory, "landscape-inherited-ui.png")).resize({ width: 600 }).png().toBuffer();
    await writeFile(resolve(directory, "inherited-ui-600.png"), desktop);
    const dm = await sharp(desktop).metadata(), lm = await sharp(landscape).metadata();
    const labels = Buffer.from(`<svg width="1200" height="42"><rect width="1200" height="42" fill="#172018"/><text x="10" y="26" fill="white" font-family="sans-serif" font-size="16">Desktop 1280×720 · ${quality} · SwiftShader</text><text x="610" y="26" fill="white" font-family="sans-serif" font-size="16">Landscape 844×390 · ${quality} · SwiftShader</text></svg>`);
    await sharp({ create: { width: 1200, height: Math.max(dm.height, lm.height) + 42, channels: 4, background: "#172018" } }).composite([
      { input: labels, top: 0, left: 0 }, { input: desktop, top: 42, left: 0 }, { input: landscape, top: 42, left: 600 },
    ]).png().toFile(resolve(directory, "inherited-ui-contact.png"));
    report.captures = { desktop: [1280, 720], landscape: [844, 390], supplied: [dm.width, dm.height], contact: [1200, Math.max(dm.height, lm.height) + 42] };
    await page.setViewportSize(report.viewport);
    await root.getByRole("button", { name: P.actions.pause, exact: true }).click();
    const pause = root.getByRole("dialog"); await pause.waitFor();
    await pause.getByRole("button", { name: P.actions.resume, exact: true }).click();
    assert.equal(await root.getAttribute("data-ealdholt-paused"), "false");
    await root.getByRole("button", { name: P.actions.home, exact: true }).click(); await page.locator(".home-grid").waitFor();
    await enter(page); await step(page, "village");
    observed = await snapshot(page, scope, "Home round trip"); retained(observed, expected); assert.equal(observed.bytes[archiveKey], originalRaw);
    completedRaw = observed.bytes[inheritedKey];
    await page.reload({ waitUntil: "domcontentloaded" }); await waitForBootReady(page); await enter(page); await step(page, "village");
    observed = await snapshot(page, scope, "page reload continuity"); retained(observed, expected);
    assert.equal(observed.bytes[inheritedKey], completedRaw); assert.equal(observed.bytes[archiveKey], originalRaw); assert.deepEqual(legacyWrites(observed), []);
    await openRole(root, people.EALDHOLT_PEOPLE_DRAFT[0]); await root.getByText(C.recorded, { exact: true }).waitFor();
    assert.equal(await root.locator("[data-ealdholt-option]").count(), 0);
    await root.getByRole("button", { name: P.actions.pause, exact: true }).click();
    await root.getByRole("dialog").getByRole("button", { name: P.actions.play, exact: true }).click(); await menuPlay(page);
    pass(scope, "pause/resume, Home/re-entry, reload continuity and existing Classic Play menu preserve exact saves");
  } catch (error) { await preserveFailure(page, scope, error); throw error; }
  finally { await context.close(); }
}
async function recovery(scope) {
  const raw = scope === "future" ? JSON.stringify({ kind: inheritedSession.INHERITED_SESSION_KIND, schemaVersion: inheritedSession.INHERITED_SESSION_SCHEMA_VERSION + 1 }) : "{synthetic-corrupt-inherited-slot\n";
  const { page, context, root, expected } = await open(scope, scope === "locks" ? {} : { [inheritedKey]: raw }, scope === "locks" ? "missing" : "normal");
  try {
    await enter(page); await root.getByRole("alert").waitFor();
    const text = await root.getByRole("alert").innerText();
    assert.match(text, scope === "future" ? /newer version/ : scope === "corrupt" ? /not valid JSON/ : /Saving is unavailable/);
    assert.equal(await root.getAttribute("data-ealdholt-saved"), "false");
    assert.equal(await root.getByRole("button", { name: P.intro.continue, exact: false }).count(), 0);
    await root.getByRole("button", { name: C.retry, exact: true }).click(); await root.getByRole("alert").waitFor();
    await root.getByRole("button", { name: P.actions.home, exact: true }).click(); await page.locator(".home-grid").waitFor();
    await enter(page); await root.getByRole("alert").waitFor();
    await root.getByRole("button", { name: C.board, exact: true }).click(); await menuPlay(page);
    const observed = await snapshot(page, scope, "read-only recovery after Home and Play"); retained(observed, expected);
    assert.deepEqual(legacyWrites(observed), []); assert.equal(observed.bytes[archiveKey], undefined);
    if (scope === "locks") assert.equal(observed.bytes[inheritedKey], undefined);
    pass(scope, "read-only recovery, retry, Home and Classic Play stay available without claiming a memory save", { alert: text });
  } catch (error) { await preserveFailure(page, scope, error); throw error; }
  finally { await context.close(); }
}
async function preview() {
  const scope = "preview", additions = completedRaw ? { [inheritedKey]: completedRaw } : {};
  const { page, context, root, expected } = await open(scope, additions, "normal", "preview");
  try {
    await enter(page); await step(page, "intro"); assert.equal(await root.getAttribute("data-ealdholt-mode"), "preview");
    await root.getByRole("button", { name: P.intro.continue, exact: false }).click(); await step(page, "banner");
    await root.locator("[data-ealdholt-preset]").first().click();
    await root.getByRole("button", { name: P.banner.continue, exact: false }).click(); await step(page, "village");
    assert.equal(await root.locator(".ealdholt-household").count(), 0);
    assert.equal(await root.getByRole("button", { name: P.banner.edit, exact: false }).count(), 1);
    await root.getByRole("button", { name: P.actions.home, exact: true }).click(); await page.locator(".home-grid").waitFor();
    const observed = await snapshot(page, scope, "preview banner flow and Home"); retained(observed, expected); assert.deepEqual(legacyWrites(observed), []);
    assert.equal(observed.bytes[archiveKey], undefined);
    pass(scope, "visit-only preview banner flow retains all original, estate and existing inherited bytes with zero inherited writes");
  } catch (error) { await preserveFailure(page, scope, error); throw error; }
  finally { await context.close(); }
}
async function rejectedLock() {
  const scope = "lock-rejected", { page, context, root, expected } = await open(scope, {}, "rejected");
  try {
    await enter(page); await step(page, "intro");
    await root.getByRole("button", { name: P.intro.continue, exact: false }).click();
    await root.locator("[data-ealdholt-preset]").first().click();
    await root.getByRole("button", { name: C.confirm, exact: false }).click();
    await root.getByRole("alert").waitFor();
    assert.match(await root.getByRole("alert").innerText(), /unavailable/);
    assert.equal(await root.getAttribute("data-ealdholt-step"), "banner");
    assert.equal(await root.getAttribute("data-ealdholt-saved"), "false");
    assert.equal(await root.getByText(C.saved, { exact: true }).count(), 0);
    await root.getByRole("button", { name: C.retry, exact: true }).click(); await root.getByRole("alert").waitFor();
    await root.getByRole("button", { name: P.actions.home, exact: true }).click(); await page.locator(".home-grid").waitFor();
    await enter(page); await root.getByRole("button", { name: C.board, exact: true }).click(); await menuPlay(page);
    const observed = await snapshot(page, scope, "explicit confirmation and retry refused by Web Locks"); retained(observed, expected);
    assert.deepEqual(legacyWrites(observed), []); assert.equal(observed.bytes[inheritedKey], undefined); assert.equal(observed.bytes[archiveKey], undefined);
    pass(scope, "rejected Web Locks confirmation and retry create no archive or memory-only saved claim; Home and Classic Play work");
  } catch (error) { await preserveFailure(page, scope, error); throw error; }
  finally { await context.close(); }
}
async function conversation() {
  const scope = "conversation";
  const design = entryDraft.chooseInheritedBannerDesign(entryDraft.createInheritedBannerDraft(), heraldry.defaultHeraldry("aethelgard"));
  assert.ok(design.ok);
  const created = inheritedSession.createInheritedSession({
    type: "enter-inherited-house", origin: "inherited", houseId: house.EALDHOLT_HOUSE.id,
    nationId: house.EALDHOLT_HOUSE.nationId, bannerDraft: design.draft, bannerConfirmed: true,
    at: "2020-01-01T00:00:00.000Z", cast: people.EALDHOLT_DRAFT_CAST, storyFacts: people.EALDHOLT_DRAFT_STORY_FACTS,
  });
  assert.ok(created.ok);
  const fixtureRaw = JSON.stringify(created.session);
  report.fixturePrecondition = { label: "Synthetic inherited session and exact predecessor archive installed before app initialization; this scope does not prove entry", inheritedRaw: fixtureRaw, archiveRaw: originalRaw };
  const { page, context, root, expected } = await open(scope, { [inheritedKey]: fixtureRaw, [archiveKey]: originalRaw });
  const protectedExpected = { ...expected }; delete protectedExpected[inheritedKey];
  const person = people.EALDHOLT_PEOPLE_DRAFT[0], option = person.decision.options[0];
  const focus = async value => {
    await page.locator(`.ealdholt-preview[data-ealdholt-focus="${value}"][aria-hidden="false"]`).waitFor();
    assert.ok(await root.evaluate(node => node.contains(document.activeElement) && document.activeElement?.checkVisibility()), `${value}: valid visible focus`);
  };
  const typography = async label => {
    const values = await root.locator(".ealdholt-speech, .ealdholt-dialogue-prompt, .ealdholt-player-response > p:last-child").evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, fontSize: Number.parseFloat(getComputedStyle(node).fontSize) })));
    report.typography ??= []; report.typography.push({ label, viewport: await page.viewportSize(), values });
    assert.ok(values.length > 0 && values.every(value => value.fontSize >= 16 && value.fontSize <= 18));
  };
  const assertReply = async kind => {
    await root.locator(`[data-ealdholt-acknowledgement="${kind}"]`).waitFor();
    assert.equal(await root.locator(`[data-ealdholt-recorded-response="${option.id}"] > p:last-child`).innerText(), option.label);
    assert.equal(await root.locator(`[data-ealdholt-acknowledgement="${kind}"]`).innerText(), kind === "immediate" ? option.response : option.returnGreeting);
    assert.equal(await root.locator("[data-ealdholt-option]").count(), 0);
    assert.ok(await root.getByText(C.recorded, { exact: true }).isVisible());
  };
  try {
    await enter(page); await step(page, "village"); await focus("exploration");
    await page.locator('[data-ealdholt-world="ready"]').waitFor({ timeout: 240000 });
    report.world = await root.locator(".ealdholt-world").evaluate(node => ({ ...node.dataset }));
    assert.equal(report.world.modelReady, "true"); assert.ok(Number(report.world.renderFrames) > 0);
    assert.equal(await root.locator(".ealdholt-household").count(), 0);
    assert.equal(await root.locator("[data-ealdholt-household]").count(), 1);
    const initial = await snapshot(page, scope, "seeded session default exploration"); retained(initial, expected); assert.deepEqual(legacyWrites(initial), []);
    pass(scope, "valid synthetic session opens normal default exploration with household closed", { fixturePrecondition: true, quality, modelProfile: report.world.modelProfile });
    await root.locator("[data-ealdholt-household]").click(); await focus("household");
    assert.equal(await root.locator(".ealdholt-village-tools").count(), 0);
    assert.equal(await root.getByRole("button", { name: P.controls.resetView, exact: true }).count(), 0);
    const world = root.locator(".ealdholt-world");
    assert.equal(await world.evaluate(node => getComputedStyle(node).pointerEvents), "none");
    const pose = () => world.evaluate(node => Object.fromEntries(Object.entries(node.dataset).filter(([key]) => key.startsWith("camera"))));
    const beforePose = await pose();
    await page.mouse.move(1130, 330); await page.mouse.down(); await page.mouse.move(1000, 280, { steps: 6 }); await page.mouse.up(); await page.mouse.wheel(0, 350);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.deepEqual(await pose(), beforePose);
    report.blockedOrbit = { before: beforePose, after: await pose(), pointerEvents: "none", input: "real pointer drag and wheel over world while chooser open; view/reset controls absent" };
    await openRole(root, person); await focus("conversation");
    assert.ok(await root.getByText(person.greeting, { exact: true }).isVisible());
    assert.equal(await root.locator("[data-ealdholt-option]").count(), 2);
    await layout(page, root, scope, "desktop unsaved conversation"); await typography("desktop unsaved conversation");
    await page.setViewportSize({ width: 844, height: 390 });
    await layout(page, root, scope, "landscape unsaved conversation"); await typography("landscape unsaved conversation");
    await page.setViewportSize(report.viewport);
    const beforeChoice = await snapshot(page, scope, "chooser, blocked world input and both unsaved layouts"); retained(beforeChoice, expected); assert.deepEqual(legacyWrites(beforeChoice), []);
    pass(scope, "chooser/dialogue hide exploration controls and block actual pointer orbit; both layouts retain44px targets,16–18px speech and keyboard focus");
    await root.locator(`[data-ealdholt-option="${option.id}"]`).click(); await assertReply("immediate");
    let observed = await snapshot(page, scope, "one verified choice with immediate reply"); retained(observed, protectedExpected);
    assert.deepEqual(legacyWrites(observed).map(write => [write.operation, write.key]), [["set", inheritedKey]]);
    const parsed = inheritedSession.parseInheritedSession(observed.bytes[inheritedKey]); assert.ok(parsed.ok);
    assert.equal(parsed.session.choices.length, 1); assert.equal(parsed.session.choices[0].choiceId, person.decision.id); assert.equal(parsed.session.choices[0].optionId, option.id);
    assert.deepEqual(parsed.session.banner, created.session.banner);
    const savedRaw = observed.bytes[inheritedKey];
    pass(scope, "one real response writes exactly once and shows the stored player label plus verified immediate acknowledgement");
    for (const viewport of [report.viewport, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await layout(page, root, scope, `${viewport.width}px verified acknowledgement`); await typography(`${viewport.width}px verified acknowledgement`);
      // Ordinary pointer scrolling restores the top of the speech panel for
      // the review frame; no camera, renderer or application state is changed.
      const box = await root.locator(".ealdholt-household").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -1800);
      await page.screenshot({ path: resolve(directory, viewport.width === report.viewport.width ? "desktop-conversation.png" : "landscape-conversation.png"), timeout: 120000 });
    }
    const desktop = await sharp(resolve(directory, "desktop-conversation.png")).resize({ width: 600 }).png().toBuffer();
    const landscape = await sharp(resolve(directory, "landscape-conversation.png")).resize({ width: 600 }).png().toBuffer();
    await writeFile(resolve(directory, "conversation-ui-600.png"), desktop);
    const dm = await sharp(desktop).metadata(), lm = await sharp(landscape).metadata(), height = Math.max(dm.height, lm.height) + 42;
    const labels = Buffer.from(`<svg width="1200" height="42"><rect width="1200" height="42" fill="#172018"/><text x="10" y="26" fill="white" font-family="sans-serif" font-size="16">Desktop1280×720 · ${quality} · synthetic session</text><text x="610" y="26" fill="white" font-family="sans-serif" font-size="16">Landscape844×390 · ${quality} · SwiftShader</text></svg>`);
    await sharp({ create: { width: 1200, height, channels: 4, background: "#172018" } }).composite([{ input: labels, top: 0, left: 0 }, { input: desktop, top: 42, left: 0 }, { input: landscape, top: 42, left: 600 }]).png().toFile(resolve(directory, "conversation-ui-contact.png"));
    report.captures = { desktop: [1280, 720], landscape: [844, 390], supplied: [dm.width, dm.height], contact: [1200, height] };
    await page.setViewportSize(report.viewport);
    await root.getByRole("button", { name: C.otherPeople, exact: true }).click(); await focus("household");
    await openRole(root, person); await assertReply("return");
    await page.keyboard.press("Escape"); await focus("household");
    await page.keyboard.press("Escape"); await focus("exploration");
    await openRole(root, person); await root.getByRole("button", { name: C.close, exact: true }).click(); await focus("exploration");
    assert.equal(await root.locator(".ealdholt-household").count(), 0);
    await root.getByRole("button", { name: P.actions.pause, exact: true }).click();
    await root.getByRole("dialog").getByRole("button", { name: P.actions.resume, exact: true }).click();
    await openRole(root, person); await root.getByRole("button", { name: P.actions.home, exact: true }).click(); await page.locator(".home-grid").waitFor();
    await enter(page); await step(page, "village");
    observed = await snapshot(page, scope, "close, Escape unwind, pause and Home round trip"); retained(observed, protectedExpected); assert.equal(observed.bytes[inheritedKey], savedRaw);
    assert.deepEqual(legacyWrites(observed).map(write => [write.operation, write.key]), [["set", inheritedKey]]);
    pass(scope, "Other people opens chooser, Escape unwinds dialogue→chooser→exploration, Back to village dismisses, and pause/Home stay reachable");
    await page.reload({ waitUntil: "domcontentloaded" }); await waitForBootReady(page); await enter(page); await step(page, "village"); await focus("exploration");
    await openRole(root, person); await assertReply("return");
    await page.setViewportSize({ width: 844, height: 390 }); await layout(page, root, scope, "landscape saved return after reload"); await typography("landscape saved return after reload");
    await root.getByRole("button", { name: C.board, exact: true }).click(); await page.locator(".game-cards").waitFor(); assert.ok(await page.getByRole("button", { name: "Classic", exact: true }).isVisible());
    observed = await snapshot(page, scope, "reload return greeting and Play"); retained(observed, protectedExpected); assert.equal(observed.bytes[inheritedKey], savedRaw); assert.deepEqual(legacyWrites(observed), []);
    pass(scope, "reload starts exploration and restores stored response/return greeting with zero new writes; Play remains reachable");
  } catch (error) { await preserveFailure(page, scope, error); throw error; }
  finally { await context.close(); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const scope of selected || scopes) {
    console.log(`START [${scope}] ${new Date().toISOString()}`);
    try { if (scope === "main") await main(); else if (scope === "preview") await preview(); else if (scope === "lock-rejected") await rejectedLock(); else if (scope === "conversation") await conversation(); else await recovery(scope); }
    catch (error) { report.failures.push({ scope, message: error.message, stack: error.stack }); console.error(`FAIL [${scope}] ${error.stack}`); if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: resolve(directory, `failure-${scope}.png`), timeout: 120000 }).catch(() => undefined); }
    await writeFile(resolve(directory, "verification.json"), JSON.stringify(report, null, 2));
  }
} catch (error) { report.failures.push({ scope: "browser", message: error.message, stack: error.stack }); }
finally { if (browser) await browser.close(); report.browserClosed = true; report.finishedAt = new Date().toISOString(); await writeFile(resolve(directory, "verification.json"), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ checks: report.checks.length, failures: report.failures, pageErrors: report.pageErrors, consoleEntries: report.console.length, browserClosed: report.browserClosed, directory }, null, 2));
if (report.failures.length || report.pageErrors.length || report.console.some(entry => entry.type === "error")) process.exitCode = 1;
