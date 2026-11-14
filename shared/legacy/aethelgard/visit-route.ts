/** Which Ealdholt visit My Legacy opens, or null for the preserved Legacy screen.
 *
 * Development: a configured local village is the My Legacy destination. Explicit preview/house flags retain
 * their existing behavior; house=0 gives developers access to the preserved Legacy screen.
 * Release: a build that bundled the verified village (scripts/release-village-build.ts) opens the inherited
 * village; one without it keeps the Legacy screen. Development flags and preview mode never apply there. */
export function ealdholtVisitMode(development: boolean, search: string, configuredVillage = false, releaseVillage = false): "preview" | "inherited" | null {
  if (!development) return releaseVillage ? "inherited" : null;
  const params = new URLSearchParams(search);
  if (params.get("ealdholt-preview") === "1") return "preview";
  if (params.has("ealdholt-house")) return params.get("ealdholt-house") === "1" ? "inherited" : null;
  if (params.has("legacyPreview") || params.has("legacy")) return null;
  return configuredVillage ? "inherited" : null;
}
