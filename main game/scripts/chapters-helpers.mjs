import { waitForMenuIdle } from "./motion-helpers.mjs";

export const chapterName = (number) => `Chapter ${String(number).padStart(2, "0")}`;
/** Grid positions: 1 is the Prologue (shared/menu/content.ts PROLOGUE_CHAPTER), 2 to 15 are Chapters 01 to 14. */
export const tileName = (position) => (position === 1 ? "Prologue" : chapterName(position - 1));
export const chaptersRegion = (page) => page.getByRole("region", { name: "Chapters", exact: true });
export const chapterGrid = (page) => chaptersRegion(page).locator(".chapters-grid");
export async function openChapters(page) {
  if (!await chapterGrid(page).count()) {
    await page.getByRole("tab", { name: "Play", exact: true }).click();
    await waitForMenuIdle(page);
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
  }
  await waitForMenuIdle(page);
  await chapterGrid(page).waitFor();
}
