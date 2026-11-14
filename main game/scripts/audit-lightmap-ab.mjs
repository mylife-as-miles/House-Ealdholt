// Visual check for finding R-02 in docs/GAME_AUDIT_FIX_PLAN.md: are the arena lightmaps sampled upside down?
// Loads Eclipse twice in the dev server, once as shipped and once with the lightmap flipped, and saves a screenshot
// of each. The flipped run rewrites the served module in the browser only; no file in the repository is changed.
//
//   npx vite --port 5197 --host 127.0.0.1 --strictPort       # in "main game" (the arenas must be in public/gameport)
//   CHROMIUM_PATH=/usr/bin/google-chrome node scripts/audit-lightmap-ab.mjs http://127.0.0.1:5197 <output folder>
import { chromium } from 'playwright';
import { waitForBootReady } from './boot-helpers.mjs';

const base = process.argv[2], out = process.argv[3];
if (!base || !out) { console.error('usage: node scripts/audit-lightmap-ab.mjs <dev server url> <output folder>'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true });
for (const variant of ['as-loaded', 'flipped']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  let patched = 0;
  if (variant === 'flipped') {
    await page.route(/\/src\/play\/environment\.ts/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const next = body.replace('lightmap.flipY = false', 'lightmap.flipY = true');
      if (next !== body) patched += 1;
      await route.fulfill({ response, body: next });
    });
  }
  await page.addInitScript(() => {
    localStorage.setItem('crownfall.main-game.preferences', JSON.stringify({ quality: 'medium', motion: false, volume: 0 }));
    localStorage.setItem('crownfall.opening.seen', 'true');
  });
  page.on('pageerror', (e) => console.log(variant, 'pageerror', e.message.slice(0, 200)));
  const t0 = Date.now();
  await page.goto(base + '/');
  await waitForBootReady(page);
  await page.locator('.main-nav [role="tab"][aria-label="Play"]').click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Local Duel', exact: true }).click();
  await page.getByRole('button', { name: /Setting 1 Eclipse/ }).click();
  await page.getByRole('button', { name: 'Start match', exact: true }).click();
  await page.locator('.match-experience[data-match-ready="true"]').waitFor({ timeout: 900000 });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${out}/eclipse-${variant}.png` });
  console.log(variant, 'done', Math.round((Date.now() - t0) / 1000) + 's', 'patched modules:', patched);
  if (variant === 'flipped' && patched === 0) console.log('WARNING: the flip was not applied; the source line has changed.');
  await context.close();
}
await browser.close();
