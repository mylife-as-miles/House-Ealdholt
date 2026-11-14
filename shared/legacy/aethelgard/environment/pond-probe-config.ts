import { EALDHOLT_POND_PROBE, validateEaldholtPondProbeIdentity,
  type EaldholtPondProbeIdentity, type EaldholtPondProbeProfile } from './pond-probe';

/** DEV-only private inputs. The JSON string is supplied to each Vite process;
 * no captured radiance, source identity or private URL is checked into Git. */
export interface EaldholtPondProbeRuntimeConfig {
  readonly profile: EaldholtPondProbeProfile;
  readonly modelUrl: string;
  readonly modelSha256: string;
  readonly lightingVersion: string;
  readonly hdrUrl: string;
  readonly metadataUrl: string;
}
export const EALDHOLT_POND_PROBE_ASSET_ID = 'aethelgard-quest-private-pond-probe';

function localUrl(value: unknown, extension: string): string {
  if (typeof value !== 'string') throw Error('Private pond probe requires explicit local URLs.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(extension)) {
    throw Error('Private pond probe URLs must be immutable loopback assets of the expected format.');
  }
  return url.href;
}

/** Missing input/profile is opt-out. A configured profile is fail-closed. The
 * caller chooses when to surface errors; asset-manifest evaluation must never
 * make Home depend on private inspection inputs. */
export function readEaldholtPondProbeConfig(raw: unknown, profile: EaldholtPondProbeProfile,
  actualModelUrl?: string): EaldholtPondProbeRuntimeConfig | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw Error('Private pond probe configuration must be JSON text.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw Error('Private pond probe configuration is invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Private pond probe configuration must contain profile entries.');
  const entry = (parsed as Record<string, unknown>)[profile];
  if (entry === undefined) return null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('Private pond probe profile configuration is incomplete.');
  const data = entry as Record<string, unknown>;
  if (typeof data.modelSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(data.modelSha256)
    || typeof data.lightingVersion !== 'string' || !data.lightingVersion.trim()) throw Error('Private pond probe requires its source hash and lighting version.');
  const modelUrl = localUrl(data.modelUrl, '.glb');
  if (actualModelUrl !== undefined && modelUrl !== new URL(actualModelUrl).href) throw Error('Private pond probe does not match the selected village model URL.');
  return Object.freeze({ profile, modelUrl, modelSha256: data.modelSha256.toLowerCase(),
    lightingVersion: data.lightingVersion, hdrUrl: localUrl(data.hdrUrl, '.hdr'), metadataUrl: localUrl(data.metadataUrl, '.json') });
}

/** Identity metadata is fetched only after entering the preview. Failures are
 * explicit; a missing/invalid configured file never reports a bound probe. */
export async function loadEaldholtPondProbeIdentity(config: EaldholtPondProbeRuntimeConfig,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<EaldholtPondProbeIdentity> {
  signal.throwIfAborted();
  const response = await fetcher(config.metadataUrl, { signal, cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw Error(`Private pond probe metadata request failed (${response.status}).`);
  const metadata: unknown = await response.json();
  signal.throwIfAborted();
  if (!metadata || typeof metadata !== 'object') throw Error('Private pond probe metadata is invalid.');
  const data = metadata as Record<string, unknown>, size = EALDHOLT_POND_PROBE[config.profile];
  if (typeof data.modelSha256 !== 'string' || typeof data.lightingVersion !== 'string') throw Error('Private pond probe metadata has no verified source identity.');
  validateEaldholtPondProbeIdentity(data as unknown as EaldholtPondProbeIdentity, config);
  if (data.format !== 'radiance-rgbe' || data.width !== size.width || data.height !== size.height || data.cubeFaceSize !== size.cubeFaceSize) {
    throw Error('Private pond probe metadata has the wrong profile dimensions or radiance format.');
  }
  // Copy only the audited identity, not unrelated metadata/source positions. The optional valley art
  // version lets callers warn when the probe still reflects an older outer-valley ground.
  const valleyArtVersion = typeof data.valleyArtVersion === 'string' && data.valleyArtVersion.length <= 160 && !/[\u0000-\u001f\u007f]/.test(data.valleyArtVersion) ? data.valleyArtVersion : undefined;
  return Object.freeze({ version: 1, profile: config.profile, modelSha256: config.modelSha256,
    lightingVersion: config.lightingVersion, sourceAxes: true, neutralFillAlreadyBaked: true, realtime: false, ...(valleyArtVersion ? { valleyArtVersion } : {}) });
}
