/** Static local radiance, authored from the assembled private scene. These
 * settings contain no source geometry, geographic placement or captured data. */
export const EALDHOLT_POND_PROBE = Object.freeze({
  desktop: Object.freeze({ width: 1024, height: 512, cubeFaceSize: 256 }),
  quest: Object.freeze({ width: 512, height: 256, cubeFaceSize: 128 }),
});
export type EaldholtPondProbeProfile = keyof typeof EALDHOLT_POND_PROBE;
export const EALDHOLT_LOCAL_POND_PROBE_TAG = 'crownfallLocalPondProbe';
/** Last visually selected pond baseline. More reflective comparisons did not
 * improve the actual captures; the generic binding still permits diagnostics. */
export const EALDHOLT_LOCAL_POND_ROUGHNESS = .24;
/** Preserve the inherited normal amplitude in the selected baseline. Optional
 * lower-strength comparisons remain isolated from other water materials. */
export const EALDHOLT_LOCAL_POND_NORMAL_STRENGTH = 1;

export interface EaldholtPondProbeIdentity {
  readonly version: 1;
  readonly profile: EaldholtPondProbeProfile;
  readonly modelSha256: string;
  readonly lightingVersion: string;
  readonly sourceAxes: true;
  readonly neutralFillAlreadyBaked: true;
  readonly realtime: false;
  /** Valley art version recorded at authoring time (EALDHOLT_BANK_ART_VERSION); absent in older probes.
   * Not part of the identity check: a stale value is reported, never refused. */
  readonly valleyArtVersion?: string;
}

export function validateEaldholtPondProbeIdentity(identity: EaldholtPondProbeIdentity,
  expected: { profile: EaldholtPondProbeProfile; modelSha256: string; lightingVersion: string }): void {
  if (identity.version !== 1 || identity.profile !== expected.profile || !EALDHOLT_POND_PROBE[expected.profile]
    || !/^[a-f0-9]{64}$/i.test(expected.modelSha256) || identity.modelSha256.toLowerCase() !== expected.modelSha256.toLowerCase()
    || !expected.lightingVersion.trim() || identity.lightingVersion !== expected.lightingVersion
    || identity.sourceAxes !== true || identity.neutralFillAlreadyBaked !== true || identity.realtime !== false) {
    throw Error('Pond probe is stale or its private source/lighting identity is unverified.');
  }
}

export function ealdholtWaterSourceName(material: { name: string; userData: Record<string, unknown> }): string {
  const water = material.userData.crownfallWaterLook as { sourceMaterialName?: unknown } | undefined;
  return typeof water?.sourceMaterialName === 'string' ? water.sourceMaterialName : material.name;
}

export function isEaldholtPondProbeSurface(material: { name: string; userData: Record<string, unknown> }): boolean {
  return ealdholtWaterSourceName(material) === 'Crownfall_Pond_Water_Review';
}

/** The capture is already neutral-lit. Root's neutral-fill adapter must honor
 * this predicate before applying its additional material-local 70% mix. */
export function skipsEaldholtProbeNeutralFill(userData: Record<string, unknown>): boolean {
  const probe = userData[EALDHOLT_LOCAL_POND_PROBE_TAG] as { version?: unknown; neutralFillAlreadyBaked?: unknown } | undefined;
  return probe?.version === 1 && probe.neutralFillAlreadyBaked === true;
}

/** Inverse of the public equirectangular UV convention. The saved HDR has
 * standard top-down rows; its loader recovers these bottom-up texture UVs. */
export function ealdholtProbeDirection(u: number, v: number): readonly [number, number, number] {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw Error('Invalid probe UV.');
  const longitude = (u * 2 - 1) * Math.PI, latitude = (v - .5) * Math.PI;
  const radius = Math.cos(latitude);
  return [radius * Math.cos(longitude), Math.sin(latitude), radius * Math.sin(longitude)];
}
