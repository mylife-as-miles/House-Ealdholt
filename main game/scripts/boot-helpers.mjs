// A completed first model frame is only one part of boot. Wait for the full
// asset/font gate and its exit before looking up or activating menu controls.
// The opening then covers the menu as the game starts (the whole film on a first
// start, the title sequence after). Tests of the menu skip it with Escape, as a
// player can; pass { opening: "keep" } to test the opening itself.
export async function waitForBootReady(page, { continueOnFailure = false, timeout = 120000, opening = "skip" } = {}) {
  await page.locator(".menu-shell").waitFor({ state: "attached", timeout });
  if (continueOnFailure) {
    await page.waitForFunction(() => {
      const loading = document.querySelector(".loading-screen");
      return !loading || [...loading.querySelectorAll("button")].some((button) => button.textContent.trim().startsWith("Continue to menu"));
    }, undefined, { timeout });
    const button = page.getByRole("button", { name: "Continue to menu", exact: true });
    if (await button.count()) await button.click();
  }
  await page.locator(".loading-screen").waitFor({ state: "detached", timeout });
  if (opening === "skip") {
    await skipOpening(page, timeout);
    await page.waitForFunction(() => document.querySelector('.menu-shell')?.getAttribute('data-boot-state') === 'ready', undefined, { timeout });
  }
}

export async function skipOpening(page, timeout = 30000) {
  const phase = await page.locator(".menu-shell").getAttribute("data-opening-film");
  if (!phase || phase === "closed") return;
  // Escape is not a user activation, so skipping leaves the menu's first-gesture behaviour untouched.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector(".menu-shell")?.getAttribute("data-opening-film") === "closed", undefined, { timeout });
}
