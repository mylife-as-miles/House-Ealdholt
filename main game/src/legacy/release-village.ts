import { bundledReleaseVillageMarker, readReleaseVillage, releaseEaldholtPondProbeConfig, releaseVillageUrls } from "../../../shared/legacy/aethelgard/release-village";

/** The village a release build bundled for desktop (scripts/release-village-build.ts), served by the game's
 * own host under its base. Null in development, which keeps its local asset server, and in builds without it. */
export const desktopReleaseVillage = (() => {
  if (import.meta.env.DEV) return null;
  const village = readReleaseVillage(bundledReleaseVillageMarker(), "desktop");
  if (!village) return null;
  const urls = releaseVillageUrls(village, new URL(import.meta.env.BASE_URL, document.baseURI).href);
  return Object.freeze({ village, urls, pondProbe: releaseEaldholtPondProbeConfig(village, "desktop", urls) });
})();
