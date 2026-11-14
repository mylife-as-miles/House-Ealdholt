import type { EaldholtPondProbeRuntimeConfig } from './environment/pond-probe-config';
import type { EaldholtPondProbeProfile } from './environment/pond-probe';

/** The licensed Elderbloom village as a release build ships it.
 *
 * scripts/release-village-build.ts copies the verified installation into each app's output under
 * RELEASE_VILLAGE_PATH and injects this non-secret description as __CROWNFALL_RELEASE_VILLAGE__: a path
 * relative to the app's own base, plus each profile's file names and pond-probe identity. It never holds a
 * URL, a path on the build machine or anything from a .env file. The game's own host serves the files;
 * the private GitHub release is not a runtime CDN. */
export const RELEASE_VILLAGE_PATH = 'legacy/elderbloom/';

/** The only files a profile loads: its village model and the pond reflection baked for it. */
export const RELEASE_VILLAGE_FILES = Object.freeze({
  desktop: Object.freeze({
    model: 'elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb',
    hdr: 'ealdholt-pond-desktop-balanced-r1.hdr',
    metadata: 'ealdholt-pond-desktop-balanced-r1.metadata.json',
  }),
  quest: Object.freeze({
    model: 'elderbloom-village-quest-coastal-pond-foliage-candidate-v2-normal16.glb',
    hdr: 'ealdholt-pond-quest-balanced-r1.hdr',
    metadata: 'ealdholt-pond-quest-balanced-r1.metadata.json',
  }),
}) satisfies Record<EaldholtPondProbeProfile, { model: string; hdr: string; metadata: string }>;

export interface ReleaseVillageProfile {
  readonly model: string;
  readonly hdr: string;
  readonly metadata: string;
  /** Lower-case hex SHA-256 of the model, as the pond metadata records it. */
  readonly modelSha256: string;
  readonly lightingVersion: string;
}
export interface ReleaseVillageMarker {
  readonly version: 1;
  readonly path: typeof RELEASE_VILLAGE_PATH;
  readonly profiles: Partial<Record<EaldholtPondProbeProfile, ReleaseVillageProfile>>;
}

/** A label from the pond metadata, kept short and printable before it is baked into a bundle. */
export function isReleaseVillageLightingVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && /^[\x20-\x7e]+$/.test(value);
}

declare const __CROWNFALL_RELEASE_VILLAGE__: unknown;
/** What the build injected: null in development, in tests and in builds made without the village. */
export function bundledReleaseVillageMarker(): unknown {
  return typeof __CROWNFALL_RELEASE_VILLAGE__ === 'undefined' ? null : __CROWNFALL_RELEASE_VILLAGE__;
}

/** The profile a release build carries, or null. Anything malformed also reads as absent, so My Legacy
 * falls back to its own screen instead of Home ever depending on the village. */
export function readReleaseVillage(raw: unknown, profile: EaldholtPondProbeProfile): ReleaseVillageProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const marker = raw as Partial<ReleaseVillageMarker>;
  if (marker.version !== 1 || marker.path !== RELEASE_VILLAGE_PATH || !marker.profiles || typeof marker.profiles !== 'object') return null;
  const entry = (marker.profiles as Record<string, unknown>)[profile];
  if (!entry || typeof entry !== 'object') return null;
  const data = entry as Record<string, unknown>, files = RELEASE_VILLAGE_FILES[profile];
  if (data.model !== files.model || data.hdr !== files.hdr || data.metadata !== files.metadata) return null;
  if (typeof data.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.modelSha256) || !isReleaseVillageLightingVersion(data.lightingVersion)) return null;
  return Object.freeze({ model: files.model, hdr: files.hdr, metadata: files.metadata, modelSha256: data.modelSha256, lightingVersion: data.lightingVersion });
}

export interface ReleaseVillageUrls {
  /** The folder holding the profile's files, ending in a slash. */
  readonly base: string;
  readonly model: string;
  readonly hdr: string;
  readonly metadata: string;
}
/** URLs under the app's own base: absolute when given an absolute base (desktop resolves BASE_URL against the
 * page), relative when given BASE_URL itself (Quest's asset manifest may not read the DOM). */
export function releaseVillageUrls(village: ReleaseVillageProfile, appBase: string): ReleaseVillageUrls {
  const base = (appBase.endsWith('/') ? appBase : appBase + '/') + RELEASE_VILLAGE_PATH;
  return Object.freeze({ base, model: base + village.model, hdr: base + village.hdr, metadata: base + village.metadata });
}

/** The pond reflection for a bundled village. Unlike the development configuration (loopback URLs from a
 * local .env), these files come from the game's own host; the metadata is still fetched and checked against
 * this identity on entry. */
export function releaseEaldholtPondProbeConfig(village: ReleaseVillageProfile, profile: EaldholtPondProbeProfile,
  urls: ReleaseVillageUrls): EaldholtPondProbeRuntimeConfig {
  return Object.freeze({ profile, modelUrl: urls.model, modelSha256: village.modelSha256, lightingVersion: village.lightingVersion,
    hdrUrl: urls.hdr, metadataUrl: urls.metadata });
}
