/**
 * Ealdholt woodland ground: selection, map contract and blend contract for the
 * prepared Poly Haven CC0 ground layers (meadow sward, woodland floor, exposed
 * bank soil; worn path earth is selected but held back). See
 * docs/legacy/environment/EALDHOLT_GROUND_SOURCES.md for the source analysis
 * and scripts/prepare-ealdholt-woodland-ground.mjs for the reproducible intake.
 *
 * Pure metadata and arithmetic: no fetch, renderer, clock or randomness. The
 * canopy field, bank exposure and weights are deterministic functions of
 * runtime-derived inputs; no private village coordinates or source arrays live
 * here. The paired loaders (src/legacy/aethelgard/woodland-ground.ts in both apps)
 * read the map contract; neither village caller requests a layer until the patches
 * in docs/legacy/claude-integration/environment/ are applied.
 */
import type { VillageSurfaceFields } from './laas-surface';
import {createEaldholtChannelStages,validEaldholtChannelStages,ealdholtBankEdge,EALDHOLT_BANK_EDGE,type EaldholtChannelStages}from'./bank-edge-surface';
import {createEaldholtAuthoredBankKnots,validEaldholtAuthoredBankKnots,sampleEaldholtAuthoredBanks,packEaldholtBankExposure,ealdholtBankLookupUniformVectors,EALDHOLT_BANK_KNOT_PROGRAM_KEY,type EaldholtAuthoredBankKnots} from './authored-bank-knots';

/** Structurally identical to terrain-bake.ts's VillageGroundPalette (linear RGB per
 * LAAS weight), declared here so this module needs no bake code to typecheck. */
export interface EaldholtWoodlandGroundPalette {
  readonly soil: readonly [number, number, number];
  readonly grass: readonly [number, number, number];
  readonly forestFloor: readonly [number, number, number];
  readonly rock: readonly [number, number, number];
}

export type EaldholtWoodlandGroundLayer = 'meadow' | 'woodland' | 'path' | 'bank';
export type EaldholtWoodlandGroundProfile = 'desktop' | 'quest';
export type EaldholtWoodlandGroundRole = 'albedo' | 'normal' | 'orm';
/** LAAS villageSurfaceBlend weight that a layer renders; 'soil-wet' is soil on a shore margin. */
export type EaldholtWoodlandLaasWeight = 'grass' | 'forestFloor' | 'soil' | 'soil-wet';

export interface EaldholtWoodlandGroundLayerSpec {
  readonly layer: EaldholtWoodlandGroundLayer;
  /** Directory under main game/public/assets/legacy/environment/aethelgard/textures/. */
  readonly folder: string;
  readonly prefix: string;
  readonly assetId: string;
  readonly sourceUrl: string;
  readonly tileMetres: number;
  readonly laasWeight: EaldholtWoodlandLaasWeight;
  /** True when the intake changed any pixel (recorded in the layer's provenance.json). */
  readonly modified: boolean;
  /** Only the maps the valley shader samples are prepared and committed. */
  readonly roles: readonly EaldholtWoodlandGroundRole[];
  /** False for a layer that is selected and reproducible but deliberately not committed. */
  readonly committed: boolean;
  /** Scene-linear albedo luminance a renderer normalizes this layer to on the reference palette. */
  readonly targetLuminance: number;
}

function spec(value: EaldholtWoodlandGroundLayerSpec): EaldholtWoodlandGroundLayerSpec { return Object.freeze({ ...value, roles: Object.freeze([...value.roles]) }); }

/** The selected set (version 2, after the round-1 critique).
 * The meadow target matches the village ground atlas olive (Y 0.069) so the valley
 * continues the village at its edge; the others keep the displayed order
 * woodland < bank < meadow < path: the woodland floor is 0.79x the meadow so canopy
 * shade never reads as a void, the bank 0.86x so shores read darker than meadow,
 * and paths 1.27x lighter so they stay readable by value as well as hue. */
export const EALDHOLT_WOODLAND_GROUND_LAYERS: Readonly<Record<EaldholtWoodlandGroundLayer, EaldholtWoodlandGroundLayerSpec>> = Object.freeze({
  meadow: spec({ layer: 'meadow', folder: 'ground-meadow-v2', prefix: 'meadow', assetId: 'forrest_ground_01', sourceUrl: 'https://polyhaven.com/a/forrest_ground_01',
    tileMetres: 2, laasWeight: 'grass', modified: true, roles: ['albedo', 'normal'], committed: true, targetLuminance: .07 }),
  woodland: spec({ layer: 'woodland', folder: 'ground-woodland-floor-v2', prefix: 'woodland', assetId: 'forest_leaves_03', sourceUrl: 'https://polyhaven.com/a/forest_leaves_03',
    tileMetres: 2.3, laasWeight: 'forestFloor', modified: true, roles: ['albedo'], committed: true, targetLuminance: .055 }),
  path: spec({ layer: 'path', folder: 'ground-path-v2', prefix: 'path', assetId: 'rock_path', sourceUrl: 'https://polyhaven.com/a/rock_path',
    tileMetres: 2, laasWeight: 'soil', modified: false, roles: ['albedo', 'normal', 'orm'], committed: false, targetLuminance: .089 }),
  bank: spec({ layer: 'bank', folder: 'ground-bank-v2', prefix: 'bank', assetId: 'brown_mud_rocks_01', sourceUrl: 'https://polyhaven.com/a/brown_mud_rocks_01',
    tileMetres: 1.3, laasWeight: 'soil-wet', modified: true, roles: ['albedo', 'normal', 'orm'], committed: true, targetLuminance: .06 }),
});
export const EALDHOLT_WOODLAND_GROUND_LAYER_NAMES: readonly EaldholtWoodlandGroundLayer[] = Object.freeze(['meadow', 'woodland', 'path', 'bank'] as const);
/** Layers whose folders are committed and may be requested by an integration. */
export const EALDHOLT_WOODLAND_GROUND_COMMITTED_LAYERS: readonly EaldholtWoodlandGroundLayer[] = Object.freeze(EALDHOLT_WOODLAND_GROUND_LAYER_NAMES.filter(name => EALDHOLT_WOODLAND_GROUND_LAYERS[name].committed));

/** Map size per profile and role. Quest data maps follow the existing earth/rock set at 256 px. */
export function ealdholtWoodlandGroundMapSize(profile: EaldholtWoodlandGroundProfile, role: EaldholtWoodlandGroundRole): 256 | 512 | 1024 {
  if (profile !== 'desktop' && profile !== 'quest') throw Error('Invalid woodland ground profile.');
  if (role !== 'albedo' && role !== 'normal' && role !== 'orm') throw Error('Invalid woodland ground role.');
  return profile === 'desktop' ? 1024 : role === 'albedo' ? 512 : 256;
}

/** Program-cache suffix for materials that sample any woodland ground layer. */
export const EALDHOLT_WOODLAND_GROUND_CACHE_KEY = ':polyhaven-woodland-ground-v2';
/** Proposed EALDHOLT_BANK_ART_VERSION once the integration patches land (v4: round-2
 * blend). It keeps the 'earth-grass-rock' substring the existing river-surface test requires. */
export const EALDHOLT_WOODLAND_BANK_ART_VERSION = 'grounded-bank-earth-grass-rock-v5-local-stage';
/** Constant roughness for layers that ship no ORM map (measured source means:
 * meadow 0.936 +/- 0.032, woodland litter 0.786 +/- 0.108; rock_surface 0.841 +/- 0.030). */
export const EALDHOLT_WOODLAND_CONSTANT_ROUGHNESS = Object.freeze({ meadow: .93, woodland: .86, rock: .84 });
/** Constant ambient occlusion for the rock layer (rock_surface ARM mean 0.855 +/- 0.053). */
export const EALDHOLT_WOODLAND_ROCK_AO = .855;
/** Exponent with which every layer follows the local vertex palette's luminance
 * relative to its class reference. One shared exponent keeps the layer order fixed. */
export const EALDHOLT_WOODLAND_PALETTE_FOLLOW = .45;
/** Class references of the valley vertex palette (shared river-valley.ts). */
export const EALDHOLT_VALLEY_PALETTE_REFERENCE = Object.freeze({ soil: Object.freeze([.105, .081, .054] as const), grass: Object.freeze([.063, .080, .034] as const) });

export interface EaldholtWoodlandGroundFile { readonly role: EaldholtWoodlandGroundRole; readonly file: string; readonly size: 256 | 512 | 1024; readonly bytes: number; readonly sha256: string }
export interface EaldholtWoodlandGroundManifest {
  readonly layer: EaldholtWoodlandGroundLayer; readonly profile: EaldholtWoodlandGroundProfile;
  readonly assetId: string; readonly sourceUrl: string; readonly tileMetres: number; readonly modified: boolean;
  readonly meanLuminance: number; readonly targetLuminance: number;
  readonly files: Readonly<Partial<Record<EaldholtWoodlandGroundRole, EaldholtWoodlandGroundFile>>>;
  readonly roles: readonly EaldholtWoodlandGroundRole[];
  readonly downloadBytes: number; readonly gpuBytesWithMipsEstimate: number;
}

/** Full RGBA8 mip-chain estimate for one square map. */
export function ealdholtWoodlandGroundMipBytes(size: number): number {
  if (size !== 256 && size !== 512 && size !== 1024) throw Error('Invalid woodland ground size.');
  let bytes = 0; for (let level = size; level >= 1; level /= 2) bytes += level * level * 4; return bytes;
}
/** Full RGBA8 mip-chain estimate for every map a layer ships for one profile. */
export function ealdholtWoodlandGroundLayerMipBytes(layer: EaldholtWoodlandGroundLayer, profile: EaldholtWoodlandGroundProfile): number {
  const layerSpec = EALDHOLT_WOODLAND_GROUND_LAYERS[layer]; if (!layerSpec) throw Error('Invalid woodland ground layer.');
  return layerSpec.roles.reduce((sum, role) => sum + ealdholtWoodlandGroundMipBytes(ealdholtWoodlandGroundMapSize(profile, role)), 0);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Invalid woodland ground manifest object.');
  return value as Record<string, unknown>;
}
/** Own data properties only: accessors and inherited fields are never invoked. */
function field(value: unknown, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record(value), key);
  if (!descriptor || !('value' in descriptor)) throw Error('Invalid woodland ground manifest field.');
  return descriptor.value;
}

/** Strict reader for one layer folder's manifest.json (version 2). Validates the
 * frozen source contract and the exact map set before any texture request. */
export function readEaldholtWoodlandGroundManifest(value: unknown, layer: EaldholtWoodlandGroundLayer, profile: EaldholtWoodlandGroundProfile): EaldholtWoodlandGroundManifest {
  if (!EALDHOLT_WOODLAND_GROUND_LAYER_NAMES.includes(layer)) throw Error('Invalid woodland ground layer.');
  if (profile !== 'desktop' && profile !== 'quest') throw Error('Invalid woodland ground profile.');
  const expected = EALDHOLT_WOODLAND_GROUND_LAYERS[layer];
  if (field(value, 'version') !== 2 || field(value, 'set') !== 'ealdholt-woodland-ground' || field(value, 'layer') !== layer
    || field(value, 'assetId') !== expected.assetId || field(value, 'sourceUrl') !== expected.sourceUrl || field(value, 'licence') !== 'CC0-1.0'
    || field(value, 'tileMetres') !== expected.tileMetres || field(value, 'laasWeight') !== expected.laasWeight || field(value, 'modified') !== expected.modified)
    throw Error('Invalid woodland ground source contract.');
  const entry = field(field(value, 'profiles'), profile), mean = field(entry, 'meanLuminance');
  if (typeof mean !== 'number' || !Number.isFinite(mean) || mean <= 0 || mean > 1) throw Error('Invalid woodland ground luminance.');
  const sourceFiles = record(field(entry, 'files')), files: Partial<Record<EaldholtWoodlandGroundRole, EaldholtWoodlandGroundFile>> = {};
  if (Object.keys(sourceFiles).sort().join() !== [...expected.roles].sort().join()) throw Error('Invalid woodland ground file contract.');
  let downloadBytes = 0, gpuBytesWithMipsEstimate = 0;
  for (const role of expected.roles) {
    const size = ealdholtWoodlandGroundMapSize(profile, role), item = field(sourceFiles, role), file = field(item, 'file'), bytes = field(item, 'bytes'), sha256 = field(item, 'sha256');
    if (file !== `${expected.prefix}-${profile}-${role}-${size}.webp` || field(item, 'size') !== size || typeof bytes !== 'number' || !Number.isSafeInteger(bytes)
      || bytes <= 0 || bytes > 32 * 1024 * 1024 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw Error('Invalid woodland ground file contract.');
    files[role] = Object.freeze({ role, file, size, bytes, sha256 }); downloadBytes += bytes; gpuBytesWithMipsEstimate += ealdholtWoodlandGroundMipBytes(size);
  }
  return Object.freeze({ layer, profile, assetId: expected.assetId, sourceUrl: expected.sourceUrl, tileMetres: expected.tileMetres, modified: expected.modified,
    meanLuminance: mean, targetLuminance: expected.targetLuminance, files: Object.freeze(files), roles: expected.roles, downloadBytes, gpuBytesWithMipsEstimate });
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smoothstep = (low: number, high: number, value: number) => { const t = clamp((value - low) / (high - low)); return t * t * (3 - 2 * t); };
const luminance = (rgb: readonly number[]) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

// ---------------------------------------------------------------------------
// LAAS mapping (offline bake and future village use)
// ---------------------------------------------------------------------------

export interface EaldholtWoodlandGroundWeights { meadow: number; woodland: number; path: number; bank: number; rock: number }
export interface EaldholtWoodlandGroundMasks {
  /** Authored or measured trodden mask; zero where no path is known. Never noise. */
  readonly pathMask: number;
  /** Shore wetness as in VillageSurfaceFields; zero away from known water. */
  readonly shoreWetness: number;
}

/** Maps the LAAS sequential weights (soil, grass, forestFloor, rock) onto the
 * prepared layers. Grass renders meadow and forestFloor renders woodland floor.
 * Bare soil renders worn path earth, or bank soil on a wet margin. A trodden
 * mask converts vegetation to path earth, and a path through a margin stays
 * path. Rock keeps the existing rock layer. Weights stay nonnegative and sum to 1. */
export function ealdholtWoodlandGroundWeights(laas: Readonly<{ soil: number; grass: number; forestFloor: number; rock: number }>, masks: EaldholtWoodlandGroundMasks): EaldholtWoodlandGroundWeights {
  const inputs = [laas.soil, laas.grass, laas.forestFloor, laas.rock, masks.pathMask, masks.shoreWetness];
  if (!inputs.every(Number.isFinite) || [laas.soil, laas.grass, laas.forestFloor, laas.rock].some(value => value < 0)) throw RangeError('LAAS weights and masks must be finite and nonnegative.');
  const total = laas.soil + laas.grass + laas.forestFloor + laas.rock;
  if (Math.abs(total - 1) > 1e-6) throw RangeError('LAAS weights must sum to one.');
  const trodden = clamp(masks.pathMask), wet = clamp(masks.shoreWetness) * (1 - trodden);
  const soil = laas.soil + (laas.grass + laas.forestFloor) * trodden;
  return { meadow: laas.grass * (1 - trodden), woodland: laas.forestFloor * (1 - trodden), path: soil * (1 - wet), bank: soil * wet, rock: laas.rock };
}

/** Canopy shade keeps litter moist and suppresses grass. Feeding the cover into
 * the LAAS fields lets villageSurfaceBlend place forest floor under crowns
 * without a separate mask: vegetation rises to 0.9 and moisture to 0.3 + 0.45. */
export function ealdholtCanopyLaasFields(fields: Readonly<VillageSurfaceFields>, canopyCover: number): VillageSurfaceFields {
  if (!Number.isFinite(canopyCover)) throw RangeError('Canopy cover must be finite.');
  const cover = clamp(canopyCover);
  return { ...fields, vegetationDensity: Math.max(fields.vegetationDensity, .9 * cover), moisture: cover > 0 ? Math.max(fields.moisture, .3 + .45 * cover) : fields.moisture };
}


// ---------------------------------------------------------------------------
// Valley blend v4: CPU twin of the proposed woodland valley shader (ground-01)
// ---------------------------------------------------------------------------

/** Grass classification of the valley vertex palette, used only to pick the class
 * reference luminance that every layer follows (ealdholtValleyLayerAlbedo). The
 * valley's own grass palette (+0.233) and the village atlas olive score 1, the soil
 * palettes (-0.29) score 0. The palette no longer decides bank versus meadow. */
export const EALDHOLT_VALLEY_GRASS_INDEX_RAMP = Object.freeze([.02, .2] as const);
/** Rock from slope and height above water only: HEAD's slope rule without its
 * neutral-palette term. That term scored any grey vertex palette as rock, so flat
 * strips that copy the steep outer rows' stone palette (the Quest southern
 * continuation) rendered as straight-edged rock blocks. */
export const EALDHOLT_VALLEY_ROCK = Object.freeze({ slope: Object.freeze([.1, .38] as const), height: Object.freeze([.25, 3] as const), wetRelief: .5 });
/** Faces steeper than about 50-65 degrees (slope = 1 - normal.y) are exposed bank soil
 * wherever the rock rule does not already make them rock, at any height above water.
 * The shader judges steepness by the larger of the vertex slope and the per-pixel face
 * slope (screen derivatives), because interpolated vertex normals smooth a sharp step
 * (support-rectangle edges, cut faces) into a gentle one; it samples steep faces side-on,
 * so they never show top-down projection streaks. */
export const EALDHOLT_VALLEY_STEEP = Object.freeze({ slope: Object.freeze([.35, .6] as const) });
/** Exposed bank band, measured in metres from the actual channel's waterline. */
export const EALDHOLT_VALLEY_BANK_BAND = Object.freeze({
  /** Width on a gentle inner bend (turf runs to the water) and on a full outer-bend cut bank. */
  innerWidth: .35, outerWidth: 1.8,
  /** The broad non-periodic field scales the width, so cut banks break into intermittent scarps. */
  breakup: Object.freeze([.15, 1.15] as const),
  /** Steep bank slopes widen the band, more on outer bends. */
  slopeWiden: 1.2, widenSlope: Object.freeze([.18, .45] as const),
  /** Occasional muddy breaks on inner bends where the broad field is high. */
  innerBreak: 1.1, innerBreakField: Object.freeze([.72, .94] as const),
  /** Soft inland edge, as a fraction of the width. */
  edge: .5,
  /** Share inside a scarp, set by the fine field: a scarp is never a solid block. */
  share: Object.freeze([.45, .88] as const),
  /** A thin muddy fringe on the wettest waterline everywhere (shore wetness ramp). */
  fringe: .7, fringeWetness: Object.freeze([.6, .92] as const),
});
/** Non-periodic fields of the valley blend: two-octave value noise over source metres
 * with a fixed integer-free hash (identical in the shader and here). The broad field
 * varies over 10-40 m (scarp break-up, meadow dry/lush patches, stand-edge break-up,
 * the second photo sample); the fine field over 2-6 m (floor herb patches, scarp
 * interiors). A 32 px mip of a ground photo is 1-2 m speckle, not a field, so the
 * photos only keep their luminance macro. Deterministic: no randomness or clock. */
export const EALDHOLT_VALLEY_NOISE = Object.freeze({
  broad: Object.freeze({ scales: Object.freeze([23, 9.7] as const), weights: Object.freeze([.62, .38] as const), ramp: Object.freeze([.3, .7] as const) }),
  fine: Object.freeze({ scales: Object.freeze([4.6, 2.3] as const), weights: Object.freeze([.6, .4] as const), ramp: Object.freeze([.3, .7] as const) }),
});
const fract = (value: number) => value - Math.floor(value);
/** Dave Hoskins' hash12 (fract-only, no sine): the shader's ealdholtValleyHash(). */
function hash12(x: number, z: number): number {
  let a = fract(x * .1031), b = fract(z * .1031), c = fract(x * .1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d;
  return fract((a + b) * c);
}
/** Smooth value noise in 0..1 at unit lattice spacing (the shader's ealdholtValleyNoise()). */
export function ealdholtValleyNoise(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw RangeError('Invalid noise coordinate.');
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash12(ix, iz), b = hash12(ix + 1, iz), c = hash12(ix, iz + 1), d = hash12(ix + 1, iz + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Broad and fine fields (normalized 0..1, 0.5 neutral) at a valley point in source metres. */
export function ealdholtValleyFields(x: number, z: number): { readonly field: number; readonly fine: number } {
  const n = EALDHOLT_VALLEY_NOISE, rx = .8 * x + .6 * z, rz = -.6 * x + .8 * z;
  const broad = n.broad.weights[0] * ealdholtValleyNoise(rx / n.broad.scales[0], rz / n.broad.scales[0]) + n.broad.weights[1] * ealdholtValleyNoise(x / n.broad.scales[1] + 17.3, z / n.broad.scales[1] + 5.1);
  const fine = n.fine.weights[0] * ealdholtValleyNoise(rz / n.fine.scales[0] + 3.7, rx / n.fine.scales[0] + 9.2) + n.fine.weights[1] * ealdholtValleyNoise(x / n.fine.scales[1] + 11.1, z / n.fine.scales[1] + 2.9);
  return { field: smoothstep(n.broad.ramp[0], n.broad.ramp[1], broad), fine: smoothstep(n.fine.ramp[0], n.fine.ramp[1], fine) };
}

export interface EaldholtValleyBankBandInput {
  /** Horizontal distance from the waterline in metres (negative under water). */
  readonly distance: number;
  /** Outer-bend exposure of the nearest bank, 0..1 (sampleEaldholtBankSection). */
  readonly exposure: number;
  /** 1 - normal.y of the geometric surface. */
  readonly slope: number;
  /** Shore wetness (vertex attribute), 0..1. */
  readonly wetness: number;
  /** Broad and fine non-periodic fields, normalized 0..1 (0.5 is neutral). */
  readonly field?: number; readonly fine?: number;
  /** Fade beyond the channel's ends, 0..1 (sampleEaldholtBankSection); default 1. */
  readonly reach?: number;
}
/** Inland width (metres) of the exposed band at one bank point. */
export function ealdholtValleyBankBandWidth(exposure: number, slope: number, field = .5): number {
  if (![exposure, slope, field].every(Number.isFinite)) throw RangeError('Invalid bank band input.');
  const b = EALDHOLT_VALLEY_BANK_BAND, e = clamp(exposure), f = clamp(field);
  return (b.innerWidth + (b.outerWidth - b.innerWidth) * e) * (b.breakup[0] + (b.breakup[1] - b.breakup[0]) * f)
    + b.slopeWiden * smoothstep(b.widenSlope[0], b.widenSlope[1], clamp(slope)) * (.4 + .6 * e)
    + b.innerBreak * smoothstep(b.innerBreakField[0], b.innerBreakField[1], f) * (1 - e);
}
/** Bank soil share of the non-rock ground from the waterline band. The field offsets the
 * band's width before its edge ramp (never a share x (1 - share) term), the fine field
 * keeps the scarp interior below a solid block, and a thin fringe marks the wettest
 * waterline. CPU twin of the shader's ealdholtValleyBankBand(). */
export function ealdholtValleyBankBandShare(input: EaldholtValleyBankBandInput): number {
  const values = [input.distance, input.exposure, input.slope, input.wetness, input.field ?? .5, input.fine ?? .5, input.reach ?? 1];
  if (!values.every(Number.isFinite)) throw RangeError('Invalid bank band input.');
  const b = EALDHOLT_VALLEY_BANK_BAND, width = ealdholtValleyBankBandWidth(input.exposure, input.slope, input.field ?? .5);
  const band = (1 - smoothstep(width * (1 - b.edge), width, input.distance)) * clamp(input.reach ?? 1);
  const share = band * (b.share[0] + (b.share[1] - b.share[0]) * clamp(input.fine ?? .5));
  return Math.max(share, b.fringe * smoothstep(b.fringeWetness[0], b.fringeWetness[1], clamp(input.wetness)));
}
export function ealdholtValleyRockWeight(slope: number, heightAboveWater: number, wetness: number): number {
  if (![slope, heightAboveWater, wetness].every(Number.isFinite)) throw RangeError('Invalid rock input.');
  const r = EALDHOLT_VALLEY_ROCK;
  return clamp(smoothstep(r.slope[0], r.slope[1], clamp(slope)) * smoothstep(r.height[0], r.height[1], heightAboveWater) * (1 - r.wetRelief * clamp(wetness)));
}
export function ealdholtValleySteepWeight(slope: number): number {
  if (!Number.isFinite(slope)) throw RangeError('Invalid slope.');
  return smoothstep(EALDHOLT_VALLEY_STEEP.slope[0], EALDHOLT_VALLEY_STEEP.slope[1], clamp(slope));
}
/** Canopy cover after the edge break-up: only partial cover shifts with the field. */
export function ealdholtValleyCanopyBreakup(canopyCover: number, field = .5): number {
  if (![canopyCover, field].every(Number.isFinite)) throw RangeError('Invalid canopy break-up input.');
  const base = clamp(canopyCover);
  return clamp(base + (clamp(field) - .5) * 1.2 * base * (1 - base) * 4);
}

export interface EaldholtValleyGroundInput extends EaldholtValleyBankBandInput {
  readonly heightAboveWater: number;
  /** 1 - |face normal.y| of the flat triangle (default: slope); steepness takes the larger. */
  readonly faceSlope?: number;
  /** Selected-tier canopy cover, 0..1 (ealdholtCanopyDecode of the canopy texel). */
  readonly canopyCover?: number;
}
export interface EaldholtValleyGroundWeights { bank: number; meadow: number; woodland: number; rock: number }
/** CPU twin of the proposed woodland valley blend. Rock follows slope and height; steep
 * faces and the waterline band are bank soil; everything else is meadow, and the selected
 * tier's canopy turns that share into woodland floor. The vertex palette only sets each
 * layer's reflectance (ealdholtValleyLayerAlbedo). Weights stay nonnegative and sum to 1. */
export function ealdholtValleyGroundWeights(input: EaldholtValleyGroundInput): EaldholtValleyGroundWeights {
  if (!Number.isFinite(input.heightAboveWater) || !Number.isFinite(input.canopyCover ?? 0) || !Number.isFinite(input.faceSlope ?? 0)) throw RangeError('Invalid valley ground input.');
  const edge=ealdholtBankEdge({distance:input.distance,heightAboveWater:input.heightAboveWater,field:input.field??.5,fine:input.fine??.5,reach:input.reach??1});
  const rock = Math.max(ealdholtValleyRockWeight(input.slope, input.heightAboveWater, input.wetness),edge.pebble), rest = 1 - rock;
  const bank = rest * Math.max(ealdholtValleyBankBandShare(input), ealdholtValleySteepWeight(Math.max(input.slope, input.faceSlope ?? input.slope)));
  const green = rest - bank, cover = ealdholtValleyCanopyBreakup(input.canopyCover ?? 0, input.field ?? .5);
  return { bank, meadow: green * (1 - cover), woodland: green * cover, rock };
}

/** Scene-linear albedo luminance each layer displays on a given vertex palette
 * (before the shared wet tint and lighting). Every layer follows the palette's
 * luminance relative to its class reference with the same exponent, so the
 * contract order woodland < bank < meadow < path holds on matched palettes. */
export function ealdholtValleyLayerAlbedo(palette: readonly number[], grassIndexRamp: readonly [number, number] = EALDHOLT_VALLEY_GRASS_INDEX_RAMP as unknown as readonly [number, number]):
  Readonly<Record<'meadow' | 'woodland' | 'bank' | 'path', number>> {
  if (palette.length !== 3 || !palette.every(value => Number.isFinite(value) && value >= 0)) throw RangeError('Invalid valley palette.');
  const y = Math.max(luminance(palette), .005), index = (palette[1] - palette[0]) / y, grassness = smoothstep(grassIndexRamp[0], grassIndexRamp[1], index);
  const reference = grassness * luminance(EALDHOLT_VALLEY_PALETTE_REFERENCE.grass) + (1 - grassness) * luminance(EALDHOLT_VALLEY_PALETTE_REFERENCE.soil);
  const follow = clamp(y / reference, .3, 1.6) ** EALDHOLT_WOODLAND_PALETTE_FOLLOW, layers = EALDHOLT_WOODLAND_GROUND_LAYERS;
  return Object.freeze({ meadow: layers.meadow.targetLuminance * follow, woodland: layers.woodland.targetLuminance * follow, bank: layers.bank.targetLuminance * follow, path: layers.path.targetLuminance * follow });
}

// ---------------------------------------------------------------------------
// Woodland floor composition and canopy shade
// ---------------------------------------------------------------------------

/** Woodland floor = broadleaf litter plus living herb/moss cover (the meadow photo,
 * tinted and darkened). Stand edges carry a green herb fringe; interiors follow a
 * 2-6 m non-periodic patch field (about half herb cover); only deep interiors fall
 * toward pure litter. Profiles without shadow maps shade the ground under crowns. */
export const EALDHOLT_WOODLAND_FLOOR = Object.freeze({
  /** Herb share in the fringe, fading out as cover rises through fringeCover. */
  fringeShare: .85, fringeCover: Object.freeze([.4, .95] as const),
  /** Interior herb share from the patch field (normalized 0..1) through the patch ramp. */
  patchShare: Object.freeze([.3, .92] as const), patch: Object.freeze([.2, .8] as const),
  /** Deep interiors (canopy depth 1) keep this fraction of litter only. */
  deepLitter: .7,
  /** Linear multiplier on the meadow photo for herb and moss (renormalized to its target). */
  tint: Object.freeze([.62, .92, .5] as const),
  /** Herb target luminance relative to the floor target. */
  herbLuminance: 1.1,
  /** Profiles without shadow maps: the ground's diffuse light (direct and indirect) and direct
   * specular x (1 - shade x cover), 0.67x at full cover whatever the lighting balance (the
   * Native menu light is mostly direct, so a direct-only shade turned stands into black pads). */
  shade: .33,
});
/** Living herb/moss share of the woodland floor at one point. */
export function ealdholtWoodlandHerbShare(canopyCover: number, patch = .5, depth = 0): number {
  if (![canopyCover, patch, depth].every(Number.isFinite)) throw RangeError('Invalid woodland floor input.');
  const f = EALDHOLT_WOODLAND_FLOOR;
  const interior = f.patchShare[0] + (f.patchShare[1] - f.patchShare[0]) * smoothstep(f.patch[0], f.patch[1], clamp(patch));
  const fringe = f.fringeShare * (1 - smoothstep(f.fringeCover[0], f.fringeCover[1], clamp(canopyCover)));
  return clamp(Math.max(interior, fringe) * (1 - f.deepLitter * clamp(depth)));
}
/** Light multiplier under the canopy on profiles without shadow maps (1 elsewhere). */
export function ealdholtCanopyShade(canopyCover: number, unshadowed: boolean): number {
  if (!Number.isFinite(canopyCover)) throw RangeError('Invalid canopy cover.');
  return unshadowed ? 1 - EALDHOLT_WOODLAND_FLOOR.shade * clamp(canopyCover) : 1;
}

// ---------------------------------------------------------------------------
// Meadow variation (hue and value around the village-anchored mean)
// ---------------------------------------------------------------------------

/** The meadow photo is graded to the village atlas olive; these fields shift it around
 * that mean so open ground reads as a living northern meadow rather than one carpet:
 * lusher, darker green near water and in hollows; drier straw-olive on sun-facing
 * slopes and in broad dry patches; sedge-olive on wet margins outside the bank band.
 * Gains are linear RGB and luminance-neutral; values scale luminance. Measured on the
 * committed meadow mean: lush +6.5 deg / +18% saturation, dry -7 deg / -18%, sedge
 * -4 deg / -22%. Convexity is not available to the shader; sun-facing slope and the
 * broad field stand in for it. */
export const EALDHOLT_MEADOW_VARIATION = Object.freeze({
  /** Full lush within lushDistance[0] m of the waterline, none beyond lushDistance[1] m. */
  lushDistance: Object.freeze([6, 25] as const),
  /** Hollows: full lush below hollow[0] m above water, none above hollow[1] m. */
  hollow: Object.freeze([.8, 2.6] as const),
  /** EALDHOLT_VILLAGE_DAYLIGHT.sunOffset on origin/codex/play-baked-arenas (a981434), source frame. */
  sunOffset: Object.freeze([65, 109, 50] as const),
  /** dot(normal, sun direction) ramp: sun-facing slopes dry out (flat ground is about 0.79). */
  sunFacing: Object.freeze([.84, .96] as const),
  /** Broad field ramps for dry and lush patches on open ground (descending for lush). */
  dryField: Object.freeze([.62, .95] as const), lushField: Object.freeze([.38, .05] as const),
  /** Shore wetness ramp of the sedge margin. */
  sedgeWetness: Object.freeze([.18, .5] as const),
  lushGain: Object.freeze([.8265, 1.0409, .7869] as const), dryGain: Object.freeze([1.1514, .9627, 1.2361] as const), sedgeGain: Object.freeze([1.1242, .9658, 1.3057] as const),
  lushValue: .9, dryValue: 1.08, sedgeValue: .93,
  /** Maximum weight of each shift. */
  strength: Object.freeze({ lush: .9, dry: .85, sedge: .8 }),
});
export interface EaldholtMeadowVariationInput {
  readonly distance: number; readonly heightAboveWater: number;
  /** Geometric unit normal in the valley's source frame. */
  readonly normal: readonly [number, number, number];
  readonly wetness: number;
  /** Broad non-periodic field, normalized 0..1. */
  readonly field: number;
}
export interface EaldholtMeadowVariation { readonly lush: number; readonly dry: number; readonly sedge: number; readonly gain: readonly [number, number, number] }
/** CPU twin of the shader's ealdholtMeadowGain(). */
export function ealdholtMeadowVariation(input: EaldholtMeadowVariationInput): EaldholtMeadowVariation {
  const values = [input.distance, input.heightAboveWater, ...input.normal, input.wetness, input.field];
  if (input.normal.length !== 3 || !values.every(Number.isFinite)) throw RangeError('Invalid meadow variation input.');
  const v = EALDHOLT_MEADOW_VARIATION, sun = v.sunOffset, sunLength = Math.hypot(...sun), f = clamp(input.field);
  const facing = (input.normal[0] * sun[0] + input.normal[1] * sun[1] + input.normal[2] * sun[2]) / sunLength;
  const near = 1 - smoothstep(v.lushDistance[0], v.lushDistance[1], input.distance), hollow = 1 - smoothstep(v.hollow[0], v.hollow[1], input.heightAboveWater);
  const lush = v.strength.lush * Math.max(near, hollow, smoothstep(v.lushField[0], v.lushField[1], f));
  const dry = v.strength.dry * Math.max(smoothstep(v.sunFacing[0], v.sunFacing[1], facing), smoothstep(v.dryField[0], v.dryField[1], f)) * (1 - lush);
  const sedge = v.strength.sedge * smoothstep(v.sedgeWetness[0], v.sedgeWetness[1], clamp(input.wetness));
  const gain = [0, 1, 2].map(c => (1 + lush * (v.lushGain[c] * v.lushValue - 1)) * (1 + dry * (v.dryGain[c] * v.dryValue - 1)) * (1 + sedge * (v.sedgeGain[c] * v.sedgeValue - 1))) as unknown as readonly [number, number, number];
  return Object.freeze({ lush, dry, sedge, gain });
}

// ---------------------------------------------------------------------------
// Canopy cover field (woodland floor), packed per foliage tier
// ---------------------------------------------------------------------------

export type EaldholtCanopyTier = 'low' | 'medium' | 'high';
export const EALDHOLT_CANOPY_TIERS: readonly EaldholtCanopyTier[] = Object.freeze(['low', 'medium', 'high'] as const);
export interface EaldholtCanopyCrown { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
export interface EaldholtCanopyBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
/** Prefix lengths of the crown list that each foliage tier draws (river-woodland's
 * crownfallFoliageDensity counts). Defaults to every crown at every tier. */
export interface EaldholtCanopyTierCounts { readonly low: number; readonly medium: number; readonly high: number }
export interface EaldholtCanopyTierStats { readonly crowns: number; readonly coveredTexels: number; readonly meanCover: number; readonly closingRadiusMetres: number }
/** Texel values store cover x COVER_SCALE, plus stand depth in the rest of the range
 * once cover is full: cover = min(1, v / 0.8), depth = clamp((v - 0.8) / 0.2). */
export const EALDHOLT_CANOPY_COVER_SCALE = .8;
/** Most crowns a canopy fill accepts (Desktop generates up to about 200). */
export const EALDHOLT_CANOPY_MAX_CROWNS = 512;
export interface EaldholtCanopyField {
  /** Texture layout: width x height texels (the texel budget of size x size, shaped to the frame). */
  readonly width: number; readonly height: number;
  /** Row-major RGBA8 (row = Z, column = X): R = low, G = medium, B = high tier, A = 0. Border texels are zero. */
  readonly data: Uint8Array;
  /** Texture coordinate = (position.xz - [frame0, frame1]) * [frame2, frame3]. */
  readonly frame: readonly [number, number, number, number];
  readonly crowns: number;
  /** Tiers whose channel this field computed; the others are zero (fill them later with `compute`). */
  readonly computed: readonly EaldholtCanopyTier[];
  readonly tiers: Readonly<Partial<Record<EaldholtCanopyTier, EaldholtCanopyTierStats>>>;
}
export interface EaldholtCanopyOptions {
  /** Fraction of the crown radius with full cover (default 0.7). */
  readonly innerFraction?: number;
  /** Litter beyond the drip line, metres (default 0.6, at most 1). */
  readonly falloffMetres?: number;
  /** Cover cap of an isolated tree; closed stands reach 1 (default 0.4). */
  readonly loneCap?: number;
  /** Belt closing radius in metres; default 0.6 x the median nearest-neighbour spacing, clamped to 3..8. */
  readonly closingRadiusMetres?: number;
  /** Crowns whose centre lies inside this rectangle (the source envelope, where the
   * valley has no surface) still count for stand density but do not extend the
   * texture frame, so texels stay on the valley ring. */
  readonly frameExclusion?: EaldholtCanopyBounds;
  /** Inward width of a closed stand's edge ramp, metres (default 2, at most 4). */
  readonly edgeRampMetres?: number;
  /** Tier channels to compute now (default all three); tiers with the same crown count share one computation. */
  readonly compute?: readonly EaldholtCanopyTier[];
}
/** Tier selector for the RGBA canopy texture (dot(texel, selector)). */
export function ealdholtCanopyTierSelector(tier: EaldholtCanopyTier): readonly [number, number, number, number] {
  if (tier === 'low') return [1, 0, 0, 0]; if (tier === 'medium') return [0, 1, 0, 0]; if (tier === 'high') return [0, 0, 1, 0];
  throw Error('Invalid canopy tier.');
}
/** Cover and stand depth of one (filtered) texel value 0..1. */
export function ealdholtCanopyDecode(value: number): { readonly cover: number; readonly depth: number } {
  if (!Number.isFinite(value)) throw RangeError('Invalid canopy texel.');
  return { cover: Math.min(1, clamp(value) / EALDHOLT_CANOPY_COVER_SCALE), depth: clamp((value - EALDHOLT_CANOPY_COVER_SCALE) / (1 - EALDHOLT_CANOPY_COVER_SCALE)) };
}
/** Power-of-two layout with size x size texels, shaped so texels are as square as the frame allows. */
export function ealdholtCanopyTextureLayout(widthMetres: number, depthMetres: number, size = 256): { readonly width: number; readonly height: number } {
  if (![64, 128, 256, 512].includes(size)) throw RangeError('Canopy field size must be 64, 128, 256 or 512.');
  if (!(widthMetres > 0) || !(depthMetres > 0) || !Number.isFinite(widthMetres) || !Number.isFinite(depthMetres)) throw RangeError('Invalid canopy frame.');
  const budget = size * size, ideal = Math.log2(Math.sqrt(budget * widthMetres / depthMetres));
  const width = 2 ** Math.max(Math.log2(size) - 3, Math.min(Math.log2(size) + 3, Math.round(ideal)));
  return { width, height: budget / width };
}

/** Local stand density: a neighbour whose drip line lies within 3 m counts once,
 * fading to nothing at 8 m, so a lone tree caps at loneCap, a pair at about 0.56,
 * a three-tree copse at about 0.84 and a closed stand (three or more) at 1. */
export function ealdholtCanopyCrownCaps(crowns: readonly { x: number; z: number; r: number }[], loneCap = .4): Float64Array {
  if (!Number.isFinite(loneCap) || loneCap < 0 || loneCap > 1) throw RangeError('Invalid lone canopy cap.');
  const caps = new Float64Array(crowns.length), cell = 16, grid = new Map<number, number[]>(), key = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);
  for (let i = 0; i < crowns.length; i++) { const k = key(Math.floor(crowns[i].x / cell), Math.floor(crowns[i].z / cell)), list = grid.get(k); if (list) list.push(i); else grid.set(k, [i]); }
  for (let i = 0; i < crowns.length; i++) {
    const a = crowns[i], gx = Math.floor(a.x / cell), gz = Math.floor(a.z / cell); let neighbours = 0;
    for (let x = gx - 2; x <= gx + 2; x++) for (let z = gz - 2; z <= gz + 2; z++) {
      const list = grid.get(key(x, z)); if (!list) continue;
      for (let n = 0; n < list.length; n++) {
        const j = list[n]; if (j === i) continue; const b = crowns[j], dx = a.x - b.x, dz = a.z - b.z, gap = Math.sqrt(dx * dx + dz * dz) - a.r - b.r;
        neighbours += 1 - smoothstep(3, 8, gap);
      }
    }
    caps[i] = loneCap + (1 - loneCap) * smoothstep(0, 3, neighbours);
  }
  return caps;
}

/** Exact 1D squared Euclidean distance transform (Felzenszwalb-Huttenlocher).
 * `f` holds 0 at features and Infinity elsewhere; `position` holds q * spacing. */
function distanceTransform1d(f: Float64Array, n: number, position: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = -1;
  for (let q = 0; q < n; q++) {
    if (f[q] === Infinity) continue;
    const fq = f[q] + position[q] * position[q];
    if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
    let s = (fq - (f[v[k]] + position[v[k]] * position[v[k]])) / (2 * (position[q] - position[v[k]]));
    while (k > 0 && s <= z[k]) { k--; s = (fq - (f[v[k]] + position[v[k]] * position[v[k]])) / (2 * (position[q] - position[v[k]])); }
    if (k === 0 && s <= z[0]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (k < 0) { d.fill(Infinity, 0, n); return; }
  let j = 0;
  for (let q = 0; q < n; q++) { while (z[j + 1] < position[q]) j++; const offset = position[q] - position[v[j]]; d[q] = offset * offset + f[v[j]]; }
}
/** Euclidean distance (metres) from every texel to the nearest texel where `inside` is set. */
function distanceToFeature(inside: Uint8Array, width: number, height: number, stepX: number, stepZ: number): Float64Array {
  const n = Math.max(width, height), grid = new Float64Array(width * height), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const positionX = new Float64Array(width), positionZ = new Float64Array(height);
  for (let q = 0; q < width; q++) positionX[q] = q * stepX; for (let q = 0; q < height; q++) positionZ[q] = q * stepZ;
  for (let row = 0; row < height; row++) {
    const base = row * width; for (let column = 0; column < width; column++) f[column] = inside[base + column] ? 0 : Infinity;
    distanceTransform1d(f, width, positionX, d, v, z); grid.set(d.subarray(0, width), base);
  }
  for (let column = 0; column < width; column++) {
    for (let row = 0; row < height; row++) f[row] = grid[row * width + column];
    distanceTransform1d(f, height, positionZ, d, v, z); for (let row = 0; row < height; row++) grid[row * width + column] = Math.sqrt(d[row]);
  }
  return grid;
}
/** Separable running-sum box blur (radius in texels per axis), O(texels). */
function boxBlur(source: Float64Array, width: number, height: number, radiusX: number, radiusZ: number): Float64Array {
  const temp = new Float64Array(width * height), out = new Float64Array(width * height);
  for (let row = 0; row < height; row++) { let sum = 0; const base = row * width;
    for (let column = -radiusX; column <= radiusX; column++) sum += source[base + clampIndex(column, width)];
    for (let column = 0; column < width; column++) { temp[base + column] = sum / (2 * radiusX + 1); sum += source[base + clampIndex(column + radiusX + 1, width)] - source[base + clampIndex(column - radiusX, width)]; } }
  for (let column = 0; column < width; column++) { let sum = 0;
    for (let row = -radiusZ; row <= radiusZ; row++) sum += temp[clampIndex(row, height) * width + column];
    for (let row = 0; row < height; row++) { out[row * width + column] = sum / (2 * radiusZ + 1); sum += temp[clampIndex(row + radiusZ + 1, height) * width + column] - temp[clampIndex(row - radiusZ, height) * width + column]; } }
  return out;
}
function clampIndex(index: number, size: number): number { return index < 0 ? 0 : index >= size ? size - 1 : index; }
/** Bilinear upsampling of a half-resolution grid to full-resolution texel centres. */
function upsample(grid: Float64Array, halfWidth: number, halfHeight: number, width: number, height: number): Float64Array {
  const rows = new Float64Array(halfHeight * width), out = new Float64Array(width * height);
  for (let column = 0; column < width; column++) {
    const x = Math.max(0, Math.min(halfWidth - 1, (column + .5) / 2 - .5)), x0 = Math.floor(x), x1 = Math.min(halfWidth - 1, x0 + 1), fx = x - x0;
    for (let row = 0; row < halfHeight; row++) rows[row * width + column] = grid[row * halfWidth + x0] * (1 - fx) + grid[row * halfWidth + x1] * fx;
  }
  for (let row = 0; row < height; row++) {
    const z = Math.max(0, Math.min(halfHeight - 1, (row + .5) / 2 - .5)), z0 = Math.floor(z), z1 = Math.min(halfHeight - 1, z0 + 1), fz = z - z0, a = z0 * width, b = z1 * width, base = row * width;
    for (let column = 0; column < width; column++) out[base + column] = rows[a + column] * (1 - fz) + rows[b + column] * fz;
  }
  return out;
}

/** Frame of the canopy texture: the framing crowns' extent plus a margin, inside the
 * valley bounds. Crowns whose centre lies inside `exclusion` do not frame. */
export function ealdholtCanopyFrameBounds(bounds: EaldholtCanopyBounds, crowns: readonly EaldholtCanopyCrown[], marginMetres = 14, exclusion?: EaldholtCanopyBounds): EaldholtCanopyBounds {
  if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, marginMetres].every(Number.isFinite) || !(bounds.maxX > bounds.minX) || !(bounds.maxZ > bounds.minZ) || marginMetres < 0) throw RangeError('Invalid canopy field bounds.');
  if (exclusion && ![exclusion.minX, exclusion.maxX, exclusion.minZ, exclusion.maxZ].every(Number.isFinite)) throw RangeError('Invalid canopy frame exclusion.');
  const inside = (c: EaldholtCanopyCrown) => { if (!exclusion) return false; const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2; return x >= exclusion.minX && x <= exclusion.maxX && z >= exclusion.minZ && z <= exclusion.maxZ; };
  const framing = crowns.filter(c => !inside(c));
  if (!framing.length) return { ...bounds };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of framing) { minX = Math.min(minX, c.minX); maxX = Math.max(maxX, c.maxX); minZ = Math.min(minZ, c.minZ); maxZ = Math.max(maxZ, c.maxZ); }
  const frame = { minX: Math.max(bounds.minX, minX - marginMetres), maxX: Math.min(bounds.maxX, maxX + marginMetres), minZ: Math.max(bounds.minZ, minZ - marginMetres), maxZ: Math.min(bounds.maxZ, maxZ + marginMetres) };
  return frame.maxX - frame.minX > 1 && frame.maxZ - frame.minZ > 1 ? frame : { ...bounds };
}

/** Woodland-floor cover at the scale of whole stands, one channel per foliage tier.
 * For each tier only the crowns that tier draws contribute (hidden trees leave no
 * litter). Each crown fills its drip line (soft edge of at most 1 m) up to a cap set
 * by local stand density; a circular morphological closing (exact distance transforms
 * at half resolution) then joins the gaps inside belts and copses into one floor,
 * valued by the surrounding caps, while lone trees and outer edges keep their shape.
 * Full-cover texels also record stand depth (EALDHOLT_CANOPY_COVER_SCALE). The texture
 * keeps size x size texels, shaped to the frame. Bounded and deterministic; the same
 * inputs always give the same frame and layout, so tiers can be computed separately. */
export function createEaldholtCanopyCoverField(bounds: EaldholtCanopyBounds, crowns: readonly EaldholtCanopyCrown[], size = 256, tiers?: EaldholtCanopyTierCounts, options: EaldholtCanopyOptions = {}): EaldholtCanopyField {
  if (![64, 128, 256, 512].includes(size)) throw RangeError('Canopy field size must be 64, 128, 256 or 512.');
  if (crowns.length > EALDHOLT_CANOPY_MAX_CROWNS) throw RangeError('Too many canopy crowns.');
  for (const crown of crowns) if (![crown.minX, crown.maxX, crown.minZ, crown.maxZ].every(Number.isFinite) || crown.maxX < crown.minX || crown.maxZ < crown.minZ
    || crown.maxX - crown.minX > 100 || crown.maxZ - crown.minZ > 100) throw RangeError('Invalid canopy crown.');
  const counts = tiers ?? { low: crowns.length, medium: crowns.length, high: crowns.length };
  if (![counts.low, counts.medium, counts.high].every(value => Number.isSafeInteger(value) && value >= 0 && value <= crowns.length) || counts.low > counts.medium || counts.medium > counts.high)
    throw RangeError('Canopy tier counts must be crown prefixes that increase from low to high.');
  const inner = options.innerFraction ?? .7, falloff = options.falloffMetres ?? .6, loneCap = options.loneCap ?? .4;
  if (!Number.isFinite(inner) || inner < 0 || inner >= 1 || !Number.isFinite(falloff) || falloff < 0 || falloff > 1 || !Number.isFinite(loneCap) || loneCap < 0 || loneCap > 1) throw RangeError('Invalid canopy falloff.');
  if (options.closingRadiusMetres !== undefined && (!Number.isFinite(options.closingRadiusMetres) || options.closingRadiusMetres < 0 || options.closingRadiusMetres > 20)) throw RangeError('Invalid canopy closing radius.');
  const edgeRamp = options.edgeRampMetres ?? 2;
  if (!Number.isFinite(edgeRamp) || edgeRamp < 0 || edgeRamp > 4) throw RangeError('Invalid canopy edge ramp.');
  const compute = options.compute ?? EALDHOLT_CANOPY_TIERS;
  if (!compute.length || compute.some(tier => !EALDHOLT_CANOPY_TIERS.includes(tier))) throw RangeError('Invalid canopy tiers to compute.');
  const frameBounds = ealdholtCanopyFrameBounds(bounds, crowns.slice(0, counts.high), 14, options.frameExclusion);
  const frameWidth = frameBounds.maxX - frameBounds.minX, frameDepth = frameBounds.maxZ - frameBounds.minZ;
  if (frameWidth > 20000 || frameDepth > 20000) throw RangeError('Invalid canopy field bounds.');
  const { width, height } = ealdholtCanopyTextureLayout(frameWidth, frameDepth, size);
  const stepX = frameWidth / width, stepZ = frameDepth / height, data = new Uint8Array(width * height * 4);
  const halfWidth = Math.ceil(width / 2), halfHeight = Math.ceil(height / 2), halfStepX = stepX * 2, halfStepZ = stepZ * 2;
  const circles = crowns.map(c => ({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, rx: Math.max(.25, (c.maxX - c.minX) / 2), rz: Math.max(.25, (c.maxZ - c.minZ) / 2), r: 0 }));
  for (const c of circles) c.r = Math.sqrt(c.rx * c.rz);
  const stats: Partial<Record<EaldholtCanopyTier, EaldholtCanopyTierStats>> = {}, done = new Map<number, number>(), computed: EaldholtCanopyTier[] = [];
  EALDHOLT_CANOPY_TIERS.forEach((tier, channel) => {
    if (!compute.includes(tier)) return;
    computed.push(tier);
    const visible = circles.slice(0, counts[tier]), copy = done.get(counts[tier]);
    if (copy !== undefined) { for (let i = 0; i < width * height; i++) data[i * 4 + channel] = data[i * 4 + copy]; stats[tier] = stats[EALDHOLT_CANOPY_TIERS[copy]]; return; }
    done.set(counts[tier], channel);
    if (!visible.length) { stats[tier] = Object.freeze({ crowns: 0, coveredTexels: 0, meanCover: 0, closingRadiusMetres: 0 }); return; }
    const caps = ealdholtCanopyCrownCaps(visible, loneCap);
    // Median nearest-neighbour centre spacing sets the belt closing radius.
    const nearest: number[] = [];
    for (let i = 0; i < visible.length; i++) {
      let best = Infinity; const a = visible[i];
      for (let j = 0; j < visible.length; j++) if (j !== i) { const dx = a.x - visible[j].x, dz = a.z - visible[j].z, d = dx * dx + dz * dz; if (d < best) best = d; }
      if (best < Infinity) nearest.push(Math.sqrt(best));
    }
    nearest.sort((a, b) => a - b);
    const median = nearest.length ? nearest[Math.floor(nearest.length / 2)] : 0;
    const radius = options.closingRadiusMetres ?? (median ? Math.max(3, Math.min(8, .6 * median)) : 0);
    const disc = new Float64Array(width * height), maskHalf = new Uint8Array(halfWidth * halfHeight), capHalf = new Float64Array(halfWidth * halfHeight);
    visible.forEach((c, i) => {
      const reachX = c.rx + falloff, reachZ = c.rz + falloff;
      const x0 = Math.max(1, Math.floor((c.x - reachX - frameBounds.minX) / stepX)), x1 = Math.min(width - 2, Math.ceil((c.x + reachX - frameBounds.minX) / stepX));
      const z0 = Math.max(1, Math.floor((c.z - reachZ - frameBounds.minZ) / stepZ)), z1 = Math.min(height - 2, Math.ceil((c.z + reachZ - frameBounds.minZ) / stepZ));
      for (let row = z0; row <= z1; row++) for (let column = x0; column <= x1; column++) {
        const dx = frameBounds.minX + (column + .5) * stepX - c.x, dz = frameBounds.minZ + (row + .5) * stepZ - c.z;
        // Distance outside the elliptical drip line, in metres (negative inside).
        const ex = dx / c.rx, ez = dz / c.rz, outside = (Math.sqrt(ex * ex + ez * ez) - 1) * Math.min(c.rx, c.rz);
        const cover = 1 - smoothstep(-(1 - inner) * Math.min(c.rx, c.rz), falloff, outside), index = row * width + column, value = caps[i] * cover;
        if (value > disc[index]) disc[index] = value;
        if (outside <= 0) { const half = (row >> 1) * halfWidth + (column >> 1); maskHalf[half] = 1; if (caps[i] > capHalf[half]) capHalf[half] = caps[i]; }
      }
    });
    // Circular closing at half resolution: dilate the drip-line mask by `radius`, erode it again.
    let closedFill: Float64Array | null = null, depth: Float64Array | null = null;
    if (radius > 0) {
      const toCrown = distanceToFeature(maskHalf, halfWidth, halfHeight, halfStepX, halfStepZ), outsideDilated = new Uint8Array(halfWidth * halfHeight);
      for (let i = 0; i < outsideDilated.length; i++) outsideDilated[i] = toCrown[i] <= radius ? 0 : 1;
      // The closed stand ramps in over `edgeRamp` metres inside its outline, so the edge
      // is a short litter-and-meadow ecotone that the shader breaks up; depth grows inward.
      const toOpen = distanceToFeature(outsideDilated, halfWidth, halfHeight, halfStepX, halfStepZ), soft = .75 * Math.min(halfStepX, halfStepZ);
      const weighted = new Float64Array(maskHalf.length); for (let i = 0; i < weighted.length; i++) weighted[i] = maskHalf[i] * capHalf[i];
      const rx = Math.max(1, Math.round(radius / halfStepX)), rz = Math.max(1, Math.round(radius / halfStepZ));
      const sum = boxBlur(weighted, halfWidth, halfHeight, rx, rz), area = boxBlur(new Float64Array(maskHalf), halfWidth, halfHeight, rx, rz);
      closedFill = new Float64Array(maskHalf.length); depth = new Float64Array(maskHalf.length);
      for (let i = 0; i < closedFill.length; i++) {
        const fill = area[i] > 1e-9 ? sum[i] / area[i] : loneCap;
        closedFill[i] = smoothstep(radius - soft, radius + Math.max(soft, edgeRamp), toOpen[i]) * fill;
        depth[i] = smoothstep(edgeRamp + 1, edgeRamp + 9, toOpen[i] - radius);
      }
    }
    const closedFull = closedFill ? upsample(closedFill, halfWidth, halfHeight, width, height) : null, depthFull = depth ? upsample(depth, halfWidth, halfHeight, width, height) : null;
    let covered = 0, total = 0;
    for (let row = 1; row < height - 1; row++) for (let column = 1; column < width - 1; column++) {
      const index = row * width + column, fill = closedFull ? closedFull[index] : 0, raw = disc[index] > fill ? disc[index] : fill, cover = raw > 1 ? 1 : raw;
      let deep = 0;
      if (depthFull && cover > .97) { const t = (cover - .97) / .03, ramp = t * t * (3 - 2 * t), value = depthFull[index]; deep = (value > 1 ? 1 : value < 0 ? 0 : value) * ramp; }
      data[index * 4 + channel] = Math.round((EALDHOLT_CANOPY_COVER_SCALE * cover + (1 - EALDHOLT_CANOPY_COVER_SCALE) * deep) * 255);
      total += cover; if (cover >= .5) covered++;
    }
    stats[tier] = Object.freeze({ crowns: visible.length, coveredTexels: covered, meanCover: total / (width * height), closingRadiusMetres: radius });
  });
  return { width, height, data, frame: [frameBounds.minX, frameBounds.minZ, 1 / frameWidth, 1 / frameDepth], crowns: crowns.length, computed: Object.freeze(computed), tiers: Object.freeze(stats) };
}

// ---------------------------------------------------------------------------
// Bank sections along the actual channel (waterline distance and cut-bank exposure)
// ---------------------------------------------------------------------------

export interface EaldholtBankExposureSections {
  readonly count: number;
  /** World X of section 0 and the uniform spacing between sections. */
  readonly x0: number; readonly step: number;
  /** count x (nearBankZ, farBankZ, nearExposure, farExposure); near = lower Z. */
  readonly data: Float32Array;
  /** Exact channel stage knots, independent of the sea plane. */
  readonly waterStages:EaldholtChannelStages;
  /** Original, nonuniform water-strip bank positions; never the curvature grid. */
  readonly authoredBanks:EaldholtAuthoredBankKnots;
}
export const EALDHOLT_BANK_EXPOSURE = Object.freeze({
  /** Gaussian smoothing of the bank lines and the curvature lag, metres. */
  lineSmoothingMetres: 9, curvatureLagMetres: 9,
  /** Outward curvature / channel 90th-percentile curvature ramp. */
  curvature: Object.freeze([.15, .6] as const),
  /** Gaussian sigma of the exposure along the channel (at least 1.5 sections), metres. */
  outputSmoothingMetres: 6.5,
  /** Channel half-width growth (metres per metre) at which exposure fades to zero: the inlet flare is not a cut bank. */
  flareGrowth: Object.freeze([.06, .16] as const),
  /** Channel width relative to its median at which exposure fades to zero (the widened mouth, whose shape curves the bank lines). */
  flareWidth: Object.freeze([1.25, 1.6] as const),
  /** Exposure and band fade to zero over this distance beyond the channel's ends, metres. */
  endFadeMetres: 12,
});
/** Outer bends of the channel are cut banks: the bank line bulges away from the water
 * there. From the coastal valley's actual channel samples ([x, lowZ, highZ, level] per
 * section) this resamples both bank lines at `count` uniform sections, smooths them,
 * scores each bank's outward curvature, zeroes it where the channel flares (the inlet
 * mouth) and smooths the result along the channel over at least three sections, so
 * exposure never jumps between neighbouring sections. Geometric and deterministic. */
export function createEaldholtBankExposureSections(channelSamples: ArrayLike<number>, count = 64): EaldholtBankExposureSections {
  if (!Number.isInteger(count) || count < 8 || count > 128) throw RangeError('Bank exposure needs 8..128 sections.');
  if (channelSamples.length < 16 || channelSamples.length % 4) throw RangeError('Bank exposure needs channel samples [x, low, high, level].');
  const xs: number[] = [], lows: number[] = [], highs: number[] = [], e = EALDHOLT_BANK_EXPOSURE;
  for (let i = 0; i < channelSamples.length; i += 4) {
    const x = channelSamples[i], low = channelSamples[i + 1], high = channelSamples[i + 2];
    if (![x, low, high].every(Number.isFinite) || high <= low || (xs.length && x <= xs[xs.length - 1])) throw RangeError('Invalid channel samples.');
    xs.push(x); lows.push(low); highs.push(high);
  }
  const x0 = xs[0], step = (xs[xs.length - 1] - x0) / (count - 1);
  const sample = (line: number[], x: number) => { let i = 1; while (i < xs.length - 1 && xs[i] < x) i++; const t = clamp((x - xs[i - 1]) / (xs[i] - xs[i - 1])); return line[i - 1] + (line[i] - line[i - 1]) * t; };
  const near = Array.from({ length: count }, (_, i) => sample(lows, x0 + i * step)), far = Array.from({ length: count }, (_, i) => sample(highs, x0 + i * step));
  const gaussian = (line: number[], sigmaMetres: number, minimumSections: number) => { const sigma = Math.max(minimumSections, sigmaMetres / step), reach = Math.ceil(sigma * 2.5);
    return line.map((_, i) => { let sum = 0, weight = 0; for (let k = -reach; k <= reach; k++) { const w = Math.exp(-.5 * (k / sigma) ** 2); sum += w * line[clampIndex(i + k, count)]; weight += w; } return sum / weight; }); };
  const nearSmooth = gaussian(near, e.lineSmoothingMetres, 1), farSmooth = gaussian(far, e.lineSmoothingMetres, 1), lag = Math.max(1, Math.round(e.curvatureLagMetres / step));
  const curvature = (line: number[]) => line.map((_, i) => (line[clampIndex(i + lag, count)] - 2 * line[i] + line[clampIndex(i - lag, count)]) / (lag * step) ** 2);
  const nearCurve = curvature(nearSmooth), farCurve = curvature(farSmooth);
  // Normalize by a robust curvature scale of the whole channel (90th percentile).
  const magnitudes = [...nearCurve, ...farCurve].map(Math.abs).sort((a, b) => a - b), scale = Math.max(magnitudes[Math.floor(magnitudes.length * .9)], 1e-6);
  const widths = near.map((value, i) => far[i] - value), median = [...widths].sort((a, b) => a - b)[Math.floor(count / 2)];
  const flare = nearSmooth.map((_, i) => { const a = clampIndex(i - lag, count), b = clampIndex(i + lag, count);
    const growth = Math.abs((farSmooth[b] - nearSmooth[b]) - (farSmooth[a] - nearSmooth[a])) / 2 / Math.max((b - a) * step, 1e-6);
    return (1 - smoothstep(e.flareGrowth[0], e.flareGrowth[1], growth)) * (1 - smoothstep(e.flareWidth[0] * median, e.flareWidth[1] * median, widths[i])); });
  const nearExposure = gaussian(nearCurve.map((value, i) => smoothstep(e.curvature[0], e.curvature[1], value / scale) * flare[i]), e.outputSmoothingMetres, 1.5); // lower-Z bank bulges to -Z
  const farExposure = gaussian(farCurve.map((value, i) => smoothstep(e.curvature[0], e.curvature[1], -value / scale) * flare[i]), e.outputSmoothingMetres, 1.5); // higher-Z bank bulges to +Z
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { data[i * 4] = near[i]; data[i * 4 + 1] = far[i]; data[i * 4 + 2] = nearExposure[i]; data[i * 4 + 3] = farExposure[i]; }
  const waterStages=createEaldholtChannelStages(channelSamples),authoredBanks=createEaldholtAuthoredBankKnots(channelSamples);
  // Reject an unsupported future shader profile before adapters allocate GPU
  // land buffers. Current Desktop/Native sources fit without a sampler change.
  ealdholtBankLookupUniformVectors(authoredBanks.count,count,waterStages.count);
  return { count, x0, step, data, waterStages,authoredBanks };
}
export interface EaldholtBankSectionSample {
  /** Horizontal distance from the nearest bank line, metres (negative inside the channel). */
  readonly distance: number;
  /** Outer-bend exposure of that bank, faded beyond the channel's ends. */
  readonly exposure: number;
  /** 1 inside the channel's X extent, fading to 0 within endFadeMetres beyond it. */
  readonly reach: number;
}
/** CPU twin of the shader's ealdholtValleyBankSection(). */
export function sampleEaldholtBankSection(sections: EaldholtBankExposureSections, x: number, z: number): EaldholtBankSectionSample {
  if (![x, z].every(Number.isFinite)) throw RangeError('Invalid bank section sample.');
  const t = (x - sections.x0) / sections.step, tc = clamp(t, 0, sections.count - 1), i = Math.min(Math.floor(tc), sections.count - 2), f = tc - i, d = sections.data;
  const lerp = (k: number) => d[i * 4 + k] + (d[(i + 1) * 4 + k] - d[i * 4 + k]) * f;
  const [near,far]=sampleEaldholtAuthoredBanks(sections.authoredBanks,x),nearSide = z < (near + far) / 2;
  const reach = 1 - smoothstep(0, EALDHOLT_BANK_EXPOSURE.endFadeMetres, Math.max(-t, t - (sections.count - 1), 0) * sections.step);
  return { distance: nearSide ? near - z : z - far, exposure: (nearSide ? lerp(2) : lerp(3)) * reach, reach };
}
/** Exposure of the bank nearest to (x, z). */
export function sampleEaldholtBankExposure(sections: EaldholtBankExposureSections, x: number, z: number): number { return sampleEaldholtBankSection(sections, x, z).exposure; }

// ---------------------------------------------------------------------------
// Understory and rock kit grade targets (shared by the rock and understory modules)
// ---------------------------------------------------------------------------

export type EaldholtWoodlandKitClass = 'rock' | 'wood' | 'foliage' | 'flower';
export interface EaldholtWoodlandKitGrade { readonly luminance: readonly [number, number]; readonly maxSaturation: number }
/** Linear albedo targets so placed kit sits on the prepared ground at matched light.
 * Measured (opaque diffuse means): namaqualand_boulders_01 Y 0.189 sat 0.40, Verdant
 * Trail boulder_01 0.126 / 0.35, rock_07 0.133 / 0.41, root_cluster_01 0.076 / 0.51,
 * dead_tree_trunk 0.035 / 0.43, shrub_03 0.160 / 0.47. Ground: bank 0.060, meadow
 * 0.070, woodland floor 0.055. Saturation is HSV saturation of the mean colour.
 * 'flower' grades only a flower kit's stems and leaves (as foliage); its petals keep
 * their colour (ealdholtFlowerPetalWeight / ealdholtFlowerPixelGrade). */
export const EALDHOLT_WOODLAND_KIT_GRADES: Readonly<Record<EaldholtWoodlandKitClass, EaldholtWoodlandKitGrade>> = Object.freeze({
  rock: Object.freeze({ luminance: Object.freeze([.09, .11] as const), maxSaturation: .25 }),
  wood: Object.freeze({ luminance: Object.freeze([.04, .06] as const), maxSaturation: .35 }),
  foliage: Object.freeze({ luminance: Object.freeze([.06, .085] as const), maxSaturation: .45 }),
  flower: Object.freeze({ luminance: Object.freeze([.06, .085] as const), maxSaturation: .45 }),
});
const encode = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
/** HSV saturation of a linear RGB colour's sRGB encoding. */
export function ealdholtSrgbSaturation(linearRgb: readonly number[]): number {
  const srgb = linearRgb.map(value => encode(clamp(value))), max = Math.max(...srgb), min = Math.min(...srgb);
  return max > 0 ? (max - min) / max : 0;
}
/** Linear material.color multiplier that moves a kit's measured mean albedo onto
 * its class target: luminance clamped into range, then mixed toward grey until the
 * saturation cap holds. Per-pixel relative variation is preserved. For 'flower',
 * pass the mean of the stem and leaf pixels only and apply it through the petal mask. */
export function ealdholtKitColourMultiplier(meanLinearRgb: readonly number[], kitClass: EaldholtWoodlandKitClass): readonly [number, number, number] {
  const grade = EALDHOLT_WOODLAND_KIT_GRADES[kitClass];
  if (!grade || meanLinearRgb.length !== 3 || !meanLinearRgb.every(value => Number.isFinite(value) && value > 0 && value <= 1)) throw RangeError('Invalid kit colour input.');
  const y = luminance(meanLinearRgb), targetY = clamp(y, grade.luminance[0], grade.luminance[1]), scaled = meanLinearRgb.map(value => value * targetY / y);
  let low = 0, high = 1;
  const at = (t: number) => scaled.map(value => value + (targetY - value) * t);
  if (ealdholtSrgbSaturation(scaled) > grade.maxSaturation) { for (let i = 0; i < 40; i++) { const middle = (low + high) / 2; if (ealdholtSrgbSaturation(at(middle)) > grade.maxSaturation) low = middle; else high = middle; } } else high = 0;
  const target = at(high);
  return target.map((value, c) => Number((value / meanLinearRgb[c]).toFixed(5))) as unknown as readonly [number, number, number];
}
/** Flower petals: bright pixels outside the leaf-green hue band (or nearly white). */
export const EALDHOLT_FLOWER_PETAL_MASK = Object.freeze({ leafHue: Object.freeze([55, 70, 160, 175] as const), leafSaturation: Object.freeze([.15, .25] as const), value: Object.freeze([.3, .45] as const) });
/** Petal weight 0..1 of one sRGB pixel (components 0..1). */
export function ealdholtFlowerPetalWeight(r: number, g: number, b: number): number {
  if (![r, g, b].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw RangeError('Invalid flower pixel.');
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, saturation = max > 0 ? delta / max : 0, m = EALDHOLT_FLOWER_PETAL_MASK;
  let hue = 0; if (delta > 0) hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4); hue = (hue + 360) % 360;
  const leaf = smoothstep(m.leafHue[0], m.leafHue[1], hue) * (1 - smoothstep(m.leafHue[2], m.leafHue[3], hue)) * smoothstep(m.leafSaturation[0], m.leafSaturation[1], saturation);
  return (1 - leaf) * smoothstep(m.value[0], m.value[1], max);
}
/** Per-pixel grade of a flower kit: stems and leaves take the foliage multiplier, petals keep their colour. */
export function ealdholtFlowerPixelGrade(linearRgb: readonly number[], foliageMultiplier: readonly number[], petalWeight: number): readonly [number, number, number] {
  if (linearRgb.length !== 3 || foliageMultiplier.length !== 3 || ![...linearRgb, ...foliageMultiplier, petalWeight].every(Number.isFinite)) throw RangeError('Invalid flower grade input.');
  const w = clamp(petalWeight);
  return linearRgb.map((value, c) => value * (foliageMultiplier[c] + (1 - foliageMultiplier[c]) * w)) as unknown as readonly [number, number, number];
}

// ---------------------------------------------------------------------------
// Pond probe staleness (the private pond HDR reflects the valley ground)
// ---------------------------------------------------------------------------

export type EaldholtPondProbeValleyArtStatus = 'current' | 'stale' | 'unrecorded';
/** Compares the valley art version a private pond probe recorded at authoring time
 * with the current one. A probe authored before the woodland ground set (or one
 * that recorded an older version) still reflects the old valley ground; callers
 * keep it bound but warn, because the probe also holds the pond's real trees. */
export function ealdholtPondProbeValleyArtStatus(recorded: unknown, current = EALDHOLT_WOODLAND_BANK_ART_VERSION): EaldholtPondProbeValleyArtStatus {
  if (typeof current !== 'string' || !current.trim()) throw RangeError('Invalid current valley art version.');
  if (typeof recorded !== 'string' || !recorded.trim()) return 'unrecorded';
  return recorded === current ? 'current' : 'stale';
}

// ---------------------------------------------------------------------------
// Offline bake palette
// ---------------------------------------------------------------------------

function paletteEntry(chromaticity: readonly number[], target: number): readonly [number, number, number] {
  const y = luminance(chromaticity);
  return chromaticity.map(value => Number((value * target / y).toFixed(5))) as unknown as readonly [number, number, number];
}
/** Measured linear chromaticity of each prepared desktop albedo (manifest
 * profiles.desktop.analysis.linearChromaticity) and of the committed rock_surface
 * albedo. The path value is measured from the held-back rock_path albedo. */
export const EALDHOLT_WOODLAND_GROUND_CHROMATICITY = Object.freeze({
  meadow: Object.freeze([.3325, .505, .1625] as const),
  woodland: Object.freeze([.4769, .3479, .1752] as const),
  path: Object.freeze([.4201, .3365, .2434] as const),
  bank: Object.freeze([.4456, .3420, .2124] as const),
  rock: Object.freeze([.4412, .3278, .2310] as const),
});
/** Herb share of the baked woodland floor colour: the valley floor's own litter and
 * herb composite at a typical stand interior, so baked village stands and valley
 * copses share one hue (about 58 degrees) instead of pure autumn litter (38 degrees). */
export const EALDHOLT_WOODLAND_FLOOR_BAKE_HERB_SHARE = .3;
/** Linear chromaticity of the woodland floor composite (litter + tinted herb at their targets). */
export const EALDHOLT_WOODLAND_FLOOR_COMPOSITE_CHROMATICITY: readonly [number, number, number] = (() => {
  const f = EALDHOLT_WOODLAND_FLOOR, litter = paletteEntry(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.woodland, 1);
  const herb = paletteEntry(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.meadow.map((value, c) => value * f.tint[c]), f.herbLuminance);
  const s = EALDHOLT_WOODLAND_FLOOR_BAKE_HERB_SHARE, mixed = litter.map((value, c) => value * (1 - s) + herb[c] * s), total = mixed[0] + mixed[1] + mixed[2];
  return Object.freeze(mixed.map(value => Number((value / total).toFixed(4)))) as unknown as readonly [number, number, number];
})();
/** Drop-in replacement for LAAS_DRY_REVIEW_PALETTE in the offline terrain bake:
 * the same LAAS weights, coloured by the selected photographs at the target
 * luminances (rock at 0.10; forest floor is the valley's litter and herb composite).
 * Linear albedo, not approved world lore. */
export const EALDHOLT_WOODLAND_GROUND_BAKE_PALETTE: EaldholtWoodlandGroundPalette = Object.freeze({
  soil: paletteEntry(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.path, EALDHOLT_WOODLAND_GROUND_LAYERS.path.targetLuminance),
  grass: paletteEntry(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.meadow, EALDHOLT_WOODLAND_GROUND_LAYERS.meadow.targetLuminance),
  forestFloor: paletteEntry(EALDHOLT_WOODLAND_FLOOR_COMPOSITE_CHROMATICITY, EALDHOLT_WOODLAND_GROUND_LAYERS.woodland.targetLuminance),
  rock: paletteEntry(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.rock, .1),
});

// ---------------------------------------------------------------------------
// Woodland valley surface (GLSL generator for the valley land material)
// ---------------------------------------------------------------------------

/** Structurally identical to river-surface.ts's EaldholtRiverSurfaceShader. */
export interface EaldholtValleySurfaceShader { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }
export interface EaldholtWoodlandValleyOptions {
  /** Bank soil in the material's `map` slot: its photographed tile and target luminance. */
  readonly bank: { readonly tileMetres: number; readonly targetLuminance: number };
  readonly meadow: { readonly albedo: unknown; readonly normal?: unknown; readonly meanLuminance: number; readonly targetLuminance: number; readonly tileMetres?: number };
  /** Waterline and cut-bank sections of the actual channel (createEaldholtBankExposureSections). */
  readonly sections: EaldholtBankExposureSections;
  /** Woodland floor albedo; requires `canopy`. Its normal reuses the meadow normal. */
  readonly forest?: { readonly albedo: unknown; readonly meanLuminance: number; readonly targetLuminance: number; readonly tileMetres?: number };
  /** Uniform objects the valley owns, so refills, tier and shadow changes need no recompile:
   * the RGBA canopy texture, its frame [minX, minZ, 1/width, 1/depth], the tier selector
   * and the canopy shade strength (EALDHOLT_WOODLAND_FLOOR.shade without shadow maps, else 0). */
  readonly canopy?: { readonly texture: { value: unknown }; readonly frame: { value: unknown }; readonly select: { value: unknown }; readonly shade: { value: unknown } };
}
export interface EaldholtWoodlandValleyPatchOptions {
  readonly earthNormal?: unknown; readonly earthOrm?: unknown;
  readonly rock?: { readonly albedo: unknown; readonly normal?: unknown; readonly meanLuminance?: number };
  readonly waterHeight?: number;
  readonly woodland?: EaldholtWoodlandValleyOptions;
}
const glsl = (value: number) => { if (!Number.isFinite(value)) throw Error('Invalid shader constant.'); const text = String(Number(value.toFixed(6))).replace(/^(-?)0\./, '$1.'); return /[.e]/.test(text) ? text : text + '.'; };
/** smoothstep for ascending or descending edges (GLSL leaves edge0 >= edge1 undefined). */
const ramp = (edges: readonly [number, number], x: string) => edges[0] < edges[1] ? `smoothstep(${glsl(edges[0])},${glsl(edges[1])},${x})` : `(1.-smoothstep(${glsl(edges[1])},${glsl(edges[0])},${x}))`;
const vec3 = (rgb: readonly number[]) => `vec3(${rgb.map(glsl).join(',')})`;
/** Texture fetches per fragment written by patchEaldholtWoodlandValleySurface (lighting maps
 * excluded): `always` runs everywhere (bank-photo macro x2, meadow albedo x2, meadow normal),
 * `canopy` wherever the floor exists, and the rest only where that layer's weight (or steep
 * face) is non-zero: bank photo x2 + ORM + normal, rock photo + normal, floor photo x2, and two
 * side-on samples per steep bank or rock face. Counted from the generated GLSL in the tests. */
export const EALDHOLT_WOODLAND_VALLEY_FETCHES = Object.freeze({ always: 5, canopy: 1, bank: 4, steepBank: 2, rock: 2, steepRock: 2, floor: 2 });

/** Woodland valley blend (EALDHOLT_WOODLAND_BANK_ART_VERSION) for the borrowed valley land
 * material. CPU twins: ealdholtValleyGroundWeights, ealdholtValleyBankBandShare,
 * ealdholtWoodlandHerbShare, ealdholtCanopyShade, ealdholtMeadowVariation and
 * ealdholtValleyLayerAlbedo. Rock follows slope and height; steep faces are bank soil or
 * rock, sampled side-on (biplanar) with normal-map detail faded; the bank band runs from
 * the waterline; bank, meadow and floor photos each blend a rotated second sample;
 * photo fetches outside the always-on set sit in branches with explicit LODs. No extra
 * samplers over the round-1 set. */
export function patchEaldholtWoodlandValleySurface(shader: EaldholtValleySurfaceShader, meanLuminance: number, wetness: 'river' | 'attribute', options: EaldholtWoodlandValleyPatchOptions): void {
  const w = options.woodland, rock = options.rock, waterHeight = options.waterHeight ?? 0, rockMean = rock?.meanLuminance ?? meanLuminance;
  if (!w || wetness !== 'attribute') throw Error('Woodland valley surface needs its layers and shore wetness attributes.');
  const meadowTile = w.meadow.tileMetres ?? 2, forestTile = w.forest?.tileMetres ?? 2, s = w.sections;
  const unit = (value: number) => Number.isFinite(value) && value > 0 && value <= 1, target = (value: number) => Number.isFinite(value) && value > 0 && value < .5, tile = (value: number) => Number.isFinite(value) && value >= .5 && value <= 8;
  if (!unit(meanLuminance) || !unit(rockMean) || !Number.isFinite(waterHeight) || !w.meadow.albedo || !unit(w.meadow.meanLuminance) || !target(w.meadow.targetLuminance) || !target(w.bank.targetLuminance)
    || !tile(w.bank.tileMetres) || !tile(meadowTile)) throw Error('Invalid woodland valley surface parameters.');
  if (!s || !Number.isInteger(s.count) || s.count < 8 || s.count > 128 || s.data.length !== s.count * 4 || !Number.isFinite(s.x0) || !(s.step > 0) || !Number.isFinite(s.step) || !Array.from(s.data).every(Number.isFinite)) throw Error('Invalid bank exposure sections.');
  if (!!w.forest !== !!w.canopy || (w.forest && (!w.forest.albedo || !unit(w.forest.meanLuminance) || !target(w.forest.targetLuminance) || !tile(forestTile)
    || !w.canopy!.texture || !w.canopy!.frame || !w.canopy!.select || !w.canopy!.shade))) throw Error('Invalid woodland floor surface parameters.');
  if (shader.fragmentShader.includes('CROWNFALL_OUTER_VALLEY_SURFACE')) return;
  for (const [source, seam] of [[shader.vertexShader, '#include <common>'], [shader.vertexShader, '#include <begin_vertex>'], [shader.fragmentShader, '#include <common>'], [shader.fragmentShader, '#include <map_fragment>'],
    [shader.fragmentShader, '#include <color_fragment>'], [shader.fragmentShader, '#include <roughnessmap_fragment>'], [shader.fragmentShader, '#include <normal_fragment_maps>']] as const)
    if (source.split(seam).length !== 2) throw Error('River surface requires the standard PBR surface path.');
  if(!validEaldholtChannelStages(s.waterStages))throw Error('Invalid authored channel stages.');
  if(!validEaldholtAuthoredBankKnots(s.authoredBanks))throw Error('Invalid original channel bank knots.');
  const stages=s.waterStages,banks=s.authoredBanks,exposure=packEaldholtBankExposure(s.data,s.count),forest = !!w.forest, hasRock = !!rock?.albedo;
  ealdholtBankLookupUniformVectors(banks.count,s.count,stages.count);
  if(Math.abs(banks.data[0]-s.x0)>1e-5||Math.abs(banks.data[(banks.count-1)*3]-(s.x0+s.step*(s.count-1)))>1e-5)throw Error('Authored banks must share the exposure extent.');
  Object.assign(shader.uniforms, { uEaldholtValleyPhotoMean: { value: meanLuminance }, uEaldholtValleyRockMean: { value: rockMean }, uEaldholtValleyWaterHeight: { value: waterHeight },
    uEaldholtValleyGrassMean: { value: w.meadow.meanLuminance }, uEaldholtValleyBank: { value: exposure },uEaldholtValleyBankKnots:{value:Float32Array.from(banks.data)}, uEaldholtValleyBankFrame: { value: [s.x0, 1 / s.step, s.count - 1, s.step] },uEaldholtValleyWaterStages:{value:Float32Array.from(stages.data)} });
  if (forest) Object.assign(shader.uniforms, { uEaldholtValleyForestMean: { value: w.forest!.meanLuminance }, uEaldholtValleyCanopy: w.canopy!.texture, uEaldholtValleyCanopyFrame: w.canopy!.frame,
    uEaldholtValleyCanopySelect: w.canopy!.select, uEaldholtValleyCanopyShade: w.canopy!.shade });
  const samplers = [['EarthNormal', options.earthNormal], ['EarthOrm', options.earthOrm], ['RockAlbedo', rock?.albedo], ['RockNormal', rock?.normal], ['GrassAlbedo', w.meadow.albedo], ['GrassNormal', w.meadow.normal], ['ForestAlbedo', w.forest?.albedo]] as const;
  for (const [name, value] of samplers) if (value) shader.uniforms['uEaldholtValley' + name] = { value };
  const R = EALDHOLT_VALLEY_ROCK, ST = EALDHOLT_VALLEY_STEEP, B = EALDHOLT_VALLEY_BANK_BAND, N = EALDHOLT_VALLEY_NOISE, M = EALDHOLT_MEADOW_VARIATION, FL = EALDHOLT_WOODLAND_FLOOR, EDGE=EALDHOLT_BANK_EDGE;
  const soilY = luminance(EALDHOLT_VALLEY_PALETTE_REFERENCE.soil), grassY = luminance(EALDHOLT_VALLEY_PALETTE_REFERENCE.grass), sun = M.sunOffset.map(value => value / Math.hypot(...M.sunOffset));
  const gain = (g: readonly number[], v: number) => vec3(g.map(value => value * v)), herbTint = vec3(FL.tint), herbTintY = luminance(FL.tint);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vEaldholtValleySourcePosition;
varying vec3 vEaldholtValleySourceNormal;
attribute float ealdholtShoreWetness;
varying float vEaldholtShoreWetness;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vEaldholtValleySourcePosition = position;
vEaldholtValleySourceNormal = normal;
vEaldholtShoreWetness = ealdholtShoreWetness;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_OUTER_VALLEY_SURFACE
#define CROWNFALL_WOODLAND_VALLEY_SURFACE
#define CROWNFALL_BANK_SOURCE_CONTACT
#define CROWNFALL_BANK_AUTHORED_KNOTS
#define CROWNFALL_BANK_AUTHORED_KNOT_COUNT ${banks.count}
// ${EALDHOLT_WOODLAND_BANK_ART_VERSION}${EALDHOLT_WOODLAND_GROUND_CACHE_KEY}
// ${EALDHOLT_BANK_KNOT_PROGRAM_KEY}
varying vec3 vEaldholtValleySourcePosition;
varying vec3 vEaldholtValleySourceNormal;
varying float vEaldholtShoreWetness;
uniform float uEaldholtValleyPhotoMean;
uniform float uEaldholtValleyRockMean;
uniform float uEaldholtValleyWaterHeight;
uniform float uEaldholtValleyGrassMean;
uniform vec4 uEaldholtValleyBank[${exposure.length/4}];
uniform vec4 uEaldholtValleyBankKnots[${banks.data.length/4}];
uniform vec4 uEaldholtValleyBankFrame;
uniform vec2 uEaldholtValleyWaterStages[${stages.count}];
${forest ? 'uniform float uEaldholtValleyForestMean;\nuniform sampler2D uEaldholtValleyCanopy;\nuniform vec4 uEaldholtValleyCanopyFrame;\nuniform vec4 uEaldholtValleyCanopySelect;\nuniform float uEaldholtValleyCanopyShade;' : ''}
${samplers.filter(([, value]) => value).map(([name]) => 'uniform sampler2D uEaldholtValley' + name + ';').join('\n')}
// LOD of a source-metre coordinate; each fetch adds its texture size and tile. Derivatives
// are taken in uniform control flow, so branch fetches below use explicit LODs only.
float ealdholtValleyLod(vec2 metres) { vec2 dx=dFdx(metres),dy=dFdy(metres); return .5*log2(max(max(dot(dx,dx),dot(dy,dy)),1e-12)); }
vec4 ealdholtValleyFetch(sampler2D sourceMap,vec2 uv,float lodMetres,float tileMetres,float minimumLod) {
  float size=float(textureSize(sourceMap,0).x);
  return textureLod(sourceMap,fract(uv),max(minimumLod,max(0.,lodMetres-log2(tileMetres)+log2(size))));
}
// Photographic macro reads a 32 px mip whatever the map size, so Desktop and Quest match.
float ealdholtValleyFieldLod(sampler2D sourceMap) { return max(0.,log2(float(textureSize(sourceMap,0).x))-5.); }
// Non-periodic value-noise fields (hash12 without sine); CPU twin: ealdholtValleyFields().
float ealdholtValleyHash(vec2 p) { vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float ealdholtValleyNoise(vec2 p) {
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(ealdholtValleyHash(i),ealdholtValleyHash(i+vec2(1.,0.)),u.x),mix(ealdholtValleyHash(i+vec2(0.,1.)),ealdholtValleyHash(i+vec2(1.,1.)),u.x),u.y);
}
vec2 ealdholtValleyFields(vec2 xz) {
  vec2 r=vec2(.8*xz.x+.6*xz.y,-.6*xz.x+.8*xz.y);
  float broad=${glsl(N.broad.weights[0])}*ealdholtValleyNoise(r/${glsl(N.broad.scales[0])})+${glsl(N.broad.weights[1])}*ealdholtValleyNoise(xz/${glsl(N.broad.scales[1])}+vec2(17.3,5.1));
  float fine=${glsl(N.fine.weights[0])}*ealdholtValleyNoise(r.yx/${glsl(N.fine.scales[0])}+vec2(3.7,9.2))+${glsl(N.fine.weights[1])}*ealdholtValleyNoise(xz/${glsl(N.fine.scales[1])}+vec2(11.1,2.9));
  return vec2(${ramp(N.broad.ramp, 'broad')},${ramp(N.fine.ramp, 'fine')});
}
// Biplanar side projection of a steep face (x-facing faces use z/y, z-facing faces x/y).
vec3 ealdholtValleySide(sampler2D sourceMap,vec3 p,vec3 n,float lodX,float lodZ,float tileMetres) {
  float wx=smoothstep(.3,.7,abs(n.x)/(abs(n.x)+abs(n.z)+1e-4));
  vec3 a=wx<.999?ealdholtValleyFetch(sourceMap,vec2(p.x,-p.y)/tileMetres,lodZ,tileMetres,0.).rgb:vec3(0.);
  vec3 b=wx>.001?ealdholtValleyFetch(sourceMap,vec2(p.z,-p.y)/tileMetres,lodX,tileMetres,0.).rgb:vec3(0.);
  return mix(a,b,wx);
}
// Original channel knots remain exact; only the curvature field is uniform.
float ealdholtValleyBankKnot(int row,int lane){int scalar=row*3+lane;return uEaldholtValleyBankKnots[scalar/4][scalar%4];}
vec2 ealdholtValleyAuthoredBanks(float x){
  if(x<=ealdholtValleyBankKnot(0,0))return vec2(ealdholtValleyBankKnot(0,1),ealdholtValleyBankKnot(0,2));
  if(x>=ealdholtValleyBankKnot(${banks.count-1},0))return vec2(ealdholtValleyBankKnot(${banks.count-1},1),ealdholtValleyBankKnot(${banks.count-1},2));
  int lo=0,hi=${banks.count-1};
  for(int stepIndex=0;stepIndex<8;stepIndex++){if(hi-lo<=1)break;int middle=(lo+hi)/2;if(ealdholtValleyBankKnot(middle,0)<=x)lo=middle;else hi=middle;}
  float t=clamp((x-ealdholtValleyBankKnot(lo,0))/(ealdholtValleyBankKnot(hi,0)-ealdholtValleyBankKnot(lo,0)),0.,1.);
  return mix(vec2(ealdholtValleyBankKnot(lo,1),ealdholtValleyBankKnot(lo,2)),vec2(ealdholtValleyBankKnot(hi,1),ealdholtValleyBankKnot(hi,2)),t);
}
vec2 ealdholtValleyBankExposureRow(int row){vec4 rowData=uEaldholtValleyBank[row/2];return row%2==0?rowData.xy:rowData.zw;}
// Waterline distance (m), unchanged cut-bank exposure and channel reach.
// CPU twin: woodland-ground sampleEaldholtBankSection().
vec3 ealdholtValleyBankSection(vec3 p) {
  float t=(p.x-uEaldholtValleyBankFrame.x)*uEaldholtValleyBankFrame.y;
  float tc=clamp(t,0.,uEaldholtValleyBankFrame.z);
  int i=min(int(floor(tc)),${s.count - 2});
  vec2 exposure=mix(ealdholtValleyBankExposureRow(i),ealdholtValleyBankExposureRow(i+1),tc-float(i));
  vec2 section=ealdholtValleyAuthoredBanks(p.x);
  bool nearSide=p.z<.5*(section.x+section.y);
  float reach=1.-smoothstep(0.,${glsl(EALDHOLT_BANK_EXPOSURE.endFadeMetres)},max(max(-t,t-uEaldholtValleyBankFrame.z),0.)*uEaldholtValleyBankFrame.w);
  return vec3(nearSide?section.x-p.z:p.z-section.y,(nearSide?exposure.x:exposure.y)*reach,reach);
}
// Authored surface stage, never a global sea plane or an invented bed depth.
float ealdholtValleyChannelStage(float x) {
  ${stages.count===2?`vec2 a=uEaldholtValleyWaterStages[0],b=uEaldholtValleyWaterStages[1];`:`int lo=0,hi=${stages.count-1};
  for(int stepIndex=0;stepIndex<8;stepIndex++){if(hi-lo<=1)break;int middle=(lo+hi)/2;if(uEaldholtValleyWaterStages[middle].x<=x)lo=middle;else hi=middle;}
  vec2 a=uEaldholtValleyWaterStages[lo],b=uEaldholtValleyWaterStages[hi];`}
  return mix(a.y,b.y,clamp((x-a.x)/(b.x-a.x),0.,1.));
}
// CPU twin: ealdholtBankEdge(). Only these narrow contact masks use height.
vec3 ealdholtValleyBankEdge(float distance,float height,float field,float fine,float reach){
  float d=max(0.,distance),h=max(0.,height);
  float width=${glsl(EDGE.widthVariation[0])}+${glsl(EDGE.widthVariation[1]-EDGE.widthVariation[0])}*clamp(field,0.,1.);
  float contact=(1.-${ramp(EDGE.contactHeight,'h')})*(1.-${ramp(EDGE.contactDistance,'d')})*reach;
  float damp=(1.-${ramp(EDGE.dampHeight,'h')})*(1.-smoothstep(${glsl(EDGE.dampDistance[0])}*width,${glsl(EDGE.dampDistance[1])}*width,d))*reach;
  return vec3(contact,damp,${glsl(EDGE.pebbleMaximum)}*damp*smoothstep(.42,.78,clamp(fine,0.,1.)));
}
// CPU twin: ealdholtValleyBankBandShare().
float ealdholtValleyBankBand(float d,float e,float slope,float f,float fine,float wet,float reach) {
  float width=${glsl(B.innerWidth)}+${glsl(B.outerWidth - B.innerWidth)}*e;
  width=width*(${glsl(B.breakup[0])}+${glsl(B.breakup[1] - B.breakup[0])}*f)+${glsl(B.slopeWiden)}*${ramp(B.widenSlope, 'slope')}*(.4+.6*e)+${glsl(B.innerBreak)}*${ramp(B.innerBreakField, 'f')}*(1.-e);
  float band=(1.-smoothstep(width*${glsl(1 - B.edge)},width,d))*reach;
  return max(band*(${glsl(B.share[0])}+${glsl(B.share[1] - B.share[0])}*fine),${glsl(B.fringe)}*${ramp(B.fringeWetness, 'wet')});
}
// Palette luminance relative to its class reference (ealdholtValleyLayerAlbedo).
float ealdholtValleyFollow(vec3 palette) {
  float luminance=max(dot(palette,vec3(.2126,.7152,.0722)),.005);
  float grassness=${ramp(EALDHOLT_VALLEY_GRASS_INDEX_RAMP, '(palette.g-palette.r)/luminance')};
  return pow(clamp(luminance/mix(${glsl(soilY)},${glsl(grassY)},grassness),.3,1.6),${glsl(EALDHOLT_WOODLAND_PALETTE_FOLLOW)});
}
// Meadow hue/value variation; CPU twin: ealdholtMeadowVariation().
vec3 ealdholtMeadowGain(float d,float h,vec3 n,float wet,float f) {
  float lush=${glsl(M.strength.lush)}*max(max(${ramp([M.lushDistance[1], M.lushDistance[0]], 'd')},${ramp([M.hollow[1], M.hollow[0]], 'h')}),${ramp(M.lushField, 'f')});
  float dry=${glsl(M.strength.dry)}*max(${ramp(M.sunFacing, `dot(n,${vec3(sun)})`)},${ramp(M.dryField, 'f')})*(1.-lush);
  float sedge=${glsl(M.strength.sedge)}*${ramp(M.sedgeWetness, 'wet')};
  return (1.+lush*(${gain(M.lushGain, M.lushValue)}-1.))*(1.+dry*(${gain(M.dryGain, M.dryValue)}-1.))*(1.+sedge*(${gain(M.sedgeGain, M.sedgeValue)}-1.));
}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '// Woodland valley photo layers are evaluated after the linear palette.');
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_MAP
  vec3 ealdholtPalette=vec3(uEaldholtValleyPhotoMean);
  #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
    ealdholtPalette=vColor.rgb;
  #endif
  vec3 ealdholtP=vEaldholtValleySourcePosition,ealdholtGeometricNormal=normalize(vEaldholtValleySourceNormal);
  vec3 ealdholtSection=ealdholtValleyBankSection(ealdholtP);
  float ealdholtContactReach=ealdholtSection.z*(1.-smoothstep(${glsl(EDGE.channelDistance[0])},${glsl(EDGE.channelDistance[1])},max(0.,ealdholtSection.x)));
  float ealdholtSlope=clamp(1.-ealdholtGeometricNormal.y,0.,1.),ealdholtHeight=ealdholtP.y-mix(uEaldholtValleyWaterHeight,ealdholtValleyChannelStage(ealdholtP.x),ealdholtContactReach),ealdholtWet=clamp(vEaldholtShoreWetness,0.,1.);
  float ealdholtLodTop=ealdholtValleyLod(ealdholtP.xz),ealdholtLodSideX=ealdholtValleyLod(ealdholtP.zy),ealdholtLodSideZ=ealdholtValleyLod(ealdholtP.xy);
  vec2 ealdholtEarthUv=ealdholtP.xz*vec2(${glsl(1 / w.bank.tileMetres)},${glsl(-1 / w.bank.tileMetres)});
  vec2 ealdholtGrassUv=ealdholtP.xz*vec2(${glsl(1 / meadowTile)},${glsl(-1 / meadowTile)});
  // Photographic luminance macro: 32 px mips of the bank photo at 18 m and, rotated 37 degrees, at 47 m.
  float ealdholtFieldLod=ealdholtValleyFieldLod(map);
  float ealdholtMacro=clamp(dot(ealdholtValleyFetch(map,ealdholtP.xz*vec2(1./18.,-1./18.),ealdholtLodTop,18.,ealdholtFieldLod).rgb,vec3(.2126,.7152,.0722))/uEaldholtValleyPhotoMean,.65,1.35);
  float ealdholtBroad=clamp(dot(ealdholtValleyFetch(map,mat2(.798636,.601815,-.601815,.798636)*ealdholtP.xz*(1./47.),ealdholtLodTop,47.,ealdholtFieldLod).rgb,vec3(.2126,.7152,.0722))/uEaldholtValleyPhotoMean,.65,1.35);
  // Non-periodic broad (10-40 m) and fine (2-6 m) fields; the broad one also picks each photo's second sample.
  vec2 ealdholtFields=ealdholtValleyFields(ealdholtP.xz);
  float ealdholtField=ealdholtFields.x,ealdholtFine=ealdholtFields.y,ealdholtSecond=smoothstep(.35,.65,ealdholtField);
  // Ground classes; CPU twin: ealdholtValleyGroundWeights().
  vec3 ealdholtEdge=ealdholtValleyBankEdge(ealdholtSection.x,ealdholtHeight,ealdholtField,ealdholtFine,ealdholtSection.z);
  // Away from the channel, retain actual coast wetness and sea isolation.
  ealdholtWet=mix(ealdholtWet,ealdholtEdge.y,ealdholtContactReach);
  float ealdholtContact=mix(smoothstep(.7,.98,ealdholtWet),ealdholtEdge.x,ealdholtContactReach);
  float ealdholtRockW=max(clamp(${ramp(R.slope, 'ealdholtSlope')}*${ramp(R.height, 'ealdholtHeight')}*(1.-${glsl(R.wetRelief)}*ealdholtWet),0.,1.),ealdholtEdge.z);
  // Steepness from the flat face as well: interpolated vertex normals soften sharp steps.
  vec3 ealdholtFaceNormal=normalize(cross(dFdx(ealdholtP),dFdy(ealdholtP)));
  float ealdholtSteep=${ramp(ST.slope, 'max(ealdholtSlope,1.-abs(ealdholtFaceNormal.y))')};
  float ealdholtBankW=(1.-ealdholtRockW)*max(ealdholtValleyBankBand(ealdholtSection.x,ealdholtSection.y,ealdholtSlope,ealdholtField,ealdholtFine,ealdholtWet,ealdholtSection.z),ealdholtSteep);
  float ealdholtMeadowW=1.-ealdholtRockW-ealdholtBankW;
  float ealdholtFollow=ealdholtValleyFollow(ealdholtPalette);
  // Meadow: two samples (2 m tile and a rotated 3.7 m tile), hue/value variation around the mean.
  vec3 ealdholtGrassPhoto=mix(ealdholtValleyFetch(uEaldholtValleyGrassAlbedo,ealdholtGrassUv,ealdholtLodTop,${glsl(meadowTile)},0.).rgb,
    ealdholtValleyFetch(uEaldholtValleyGrassAlbedo,mat2(.798636,-.601815,.601815,.798636)*ealdholtP.xz*(1./3.7)+vec2(.37,.61),ealdholtLodTop,3.7,0.).rgb,ealdholtSecond);
  float ealdholtWaterDistance=ealdholtSection.x/max(ealdholtSection.z,.001);
  vec3 ealdholtMeadow=ealdholtGrassPhoto*ealdholtMeadowGain(ealdholtWaterDistance,ealdholtHeight,ealdholtGeometricNormal,ealdholtWet,ealdholtField)
    *clamp(${glsl(w.meadow.targetLuminance)}*ealdholtFollow/uEaldholtValleyGrassMean,.05,4.);
  float ealdholtCanopyCover=0.,ealdholtCanopyDepth=0.,ealdholtForestW=0.;${forest ? `
  // Woodland floor under the selected tier's canopy (hidden trees leave none); partial cover breaks up with the field.
  float ealdholtCanopyTexel=dot(texture2D(uEaldholtValleyCanopy,(ealdholtP.xz-uEaldholtValleyCanopyFrame.xy)*uEaldholtValleyCanopyFrame.zw),uEaldholtValleyCanopySelect);
  ealdholtCanopyCover=min(1.,ealdholtCanopyTexel/${glsl(EALDHOLT_CANOPY_COVER_SCALE)});
  ealdholtCanopyDepth=clamp((ealdholtCanopyTexel-${glsl(EALDHOLT_CANOPY_COVER_SCALE)})/${glsl(1 - EALDHOLT_CANOPY_COVER_SCALE)},0.,1.);
  float ealdholtFloorCover=clamp(ealdholtCanopyCover+(ealdholtField-.5)*1.2*ealdholtCanopyCover*(1.-ealdholtCanopyCover)*4.,0.,1.);
  ealdholtForestW=ealdholtMeadowW*ealdholtFloorCover;
  ealdholtMeadowW-=ealdholtForestW;` : ''}
  vec3 ealdholtSurface=ealdholtMeadowW*ealdholtMeadow;
  if(ealdholtBankW>.001){
    vec3 ealdholtBankPhoto=mix(ealdholtValleyFetch(map,ealdholtEarthUv,ealdholtLodTop,${glsl(w.bank.tileMetres)},0.).rgb,
      ealdholtValleyFetch(map,mat2(.5,.866025,-.866025,.5)*ealdholtP.xz*${glsl(1 / (w.bank.tileMetres * 1.618))}+vec2(.29,.53),ealdholtLodTop,${glsl(w.bank.tileMetres * 1.618)},0.).rgb,ealdholtSecond);
    if(ealdholtSteep>.001)ealdholtBankPhoto=mix(ealdholtBankPhoto,ealdholtValleySide(map,ealdholtP,ealdholtFaceNormal,ealdholtLodSideX,ealdholtLodSideZ,${glsl(w.bank.tileMetres)}),ealdholtSteep);
    ealdholtSurface+=ealdholtBankW*ealdholtBankPhoto*clamp(${glsl(w.bank.targetLuminance)}*ealdholtFollow/uEaldholtValleyPhotoMean,.05,4.);
  }
  if(ealdholtRockW>.001){
    vec2 ealdholtRockUv=ealdholtP.xz*vec2(.3125,-.3125);
    ${hasRock ? `vec3 ealdholtRockPhoto=ealdholtValleyFetch(uEaldholtValleyRockAlbedo,ealdholtRockUv,ealdholtLodTop,3.2,0.).rgb;
    if(ealdholtSteep>.001)ealdholtRockPhoto=mix(ealdholtRockPhoto,ealdholtValleySide(uEaldholtValleyRockAlbedo,ealdholtP,ealdholtFaceNormal,ealdholtLodSideX,ealdholtLodSideZ,3.2),ealdholtSteep);`
    : `vec3 ealdholtRockPhoto=ealdholtValleyFetch(map,ealdholtEarthUv,ealdholtLodTop,${glsl(w.bank.tileMetres)},0.).rgb;`}
    float ealdholtPaletteMean=max(dot(ealdholtPalette,vec3(.2126,.7152,.0722)),.005);
    ealdholtSurface+=ealdholtRockW*ealdholtRockPhoto*clamp(mix(ealdholtPaletteMean,.085,.7)/uEaldholtValleyRockMean,.35,1.8);
  }${forest ? `
  if(ealdholtForestW>.001){
    // Litter (2 samples) plus living herb and moss: a green fringe at stand edges, 2-6 m
    // patches inside, litter only in deep cover. CPU twin: ealdholtWoodlandHerbShare().
    float ealdholtFloorTarget=${glsl(w.forest!.targetLuminance)}*ealdholtFollow;
    vec2 ealdholtForestUv=ealdholtP.xz*vec2(${glsl(1 / forestTile)},${glsl(-1 / forestTile)});
    vec3 ealdholtLitter=mix(ealdholtValleyFetch(uEaldholtValleyForestAlbedo,ealdholtForestUv,ealdholtLodTop,${glsl(forestTile)},0.).rgb,
      ealdholtValleyFetch(uEaldholtValleyForestAlbedo,mat2(.866025,-.5,.5,.866025)*ealdholtP.xz*${glsl(1 / (forestTile * 1.618))}+vec2(.61,.17),ealdholtLodTop,${glsl(forestTile * 1.618)},0.).rgb,ealdholtSecond)
      *clamp(ealdholtFloorTarget/uEaldholtValleyForestMean,.05,4.);
    vec3 ealdholtHerb=ealdholtGrassPhoto*${herbTint}*clamp(${glsl(FL.herbLuminance)}*ealdholtFloorTarget/(uEaldholtValleyGrassMean*${glsl(herbTintY)}),.05,4.);
    float ealdholtPatch=clamp(.55*ealdholtFine+.45*ealdholtField,0.,1.);
    float ealdholtHerbShare=max(${glsl(FL.patchShare[0])}+${glsl(FL.patchShare[1] - FL.patchShare[0])}*${ramp(FL.patch, 'ealdholtPatch')},${glsl(FL.fringeShare)}*${ramp([FL.fringeCover[1], FL.fringeCover[0]], 'ealdholtCanopyCover')});
    ealdholtHerbShare=clamp(ealdholtHerbShare*(1.-${glsl(FL.deepLitter)}*ealdholtCanopyDepth),0.,1.);
    ealdholtSurface+=ealdholtForestW*mix(ealdholtLitter,ealdholtHerb,ealdholtHerbShare);
  }` : ''}
  float ealdholtLuminanceMacro=clamp(1.+(ealdholtMacro-1.)*.55+(ealdholtBroad-1.)*.75,.65,1.35);
  diffuseColor.rgb=ealdholtSurface*mix(1.,ealdholtLuminanceMacro,.45)*mix(vec3(1.),vec3(.64,.67,.65),ealdholtWet);
#endif`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `float roughnessFactor=roughness;
#ifdef USE_MAP
  // Steep faces take constants: top-down ORM would streak down them.
  vec3 ealdholtEarthOrm=vec3(.85,.9,0.);
  ${options.earthOrm ? 'if(ealdholtBankW>.001)ealdholtEarthOrm=mix(ealdholtValleyFetch(uEaldholtValleyEarthOrm,ealdholtEarthUv,ealdholtLodTop,' + glsl(w.bank.tileMetres) + ',0.).rgb,vec3(.85,.9,0.),ealdholtSteep);' : ''}
  float ealdholtDryRoughness=ealdholtBankW*ealdholtEarthOrm.g+ealdholtMeadowW*${glsl(EALDHOLT_WOODLAND_CONSTANT_ROUGHNESS.meadow)}+ealdholtRockW*${glsl(EALDHOLT_WOODLAND_CONSTANT_ROUGHNESS.rock)}+ealdholtForestW*${glsl(EALDHOLT_WOODLAND_CONSTANT_ROUGHNESS.woodland)};
  // Wet gloss only on the wettest waterline strip; dry and damp bank soil stays matte.
  roughnessFactor=clamp(mix(ealdholtDryRoughness,min(ealdholtDryRoughness,.66),ealdholtContact),.12,1.);
#endif`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
#ifdef USE_MAP
  vec3 ealdholtEarthNormal=vec3(0.,0.,1.),ealdholtRockNormal=vec3(0.,0.,1.);
  ${options.earthNormal ? 'if(ealdholtBankW>.001)ealdholtEarthNormal=ealdholtValleyFetch(uEaldholtValleyEarthNormal,ealdholtEarthUv,ealdholtLodTop,' + glsl(w.bank.tileMetres) + ',0.).xyz*2.-1.;' : ''}
  ${rock?.normal ? 'if(ealdholtRockW>.001)ealdholtRockNormal=ealdholtValleyFetch(uEaldholtValleyRockNormal,ealdholtP.xz*vec2(.3125,-.3125),ealdholtLodTop,3.2,0.).xyz*2.-1.;' : ''}
  vec3 ealdholtGrassNormal=${w.meadow.normal ? `ealdholtValleyFetch(uEaldholtValleyGrassNormal,ealdholtGrassUv,ealdholtLodTop,${glsl(meadowTile)},0.).xyz*2.-1.` : 'vec3(0.,0.,1.)'};
  // Top-down normal detail fades on steep faces (it would stretch into streaks there).
  vec2 ealdholtDetail=(ealdholtEarthNormal.xy*ealdholtBankW*.35+ealdholtGrassNormal.xy*(ealdholtMeadowW*.10+ealdholtForestW*.22)+ealdholtRockNormal.xy*ealdholtRockW*.60)*(1.-ealdholtSteep);
  vec3 ealdholtSurfaceNormal=normalize(vec3(ealdholtDetail,max(.2,ealdholtEarthNormal.z*ealdholtBankW+ealdholtGrassNormal.z*(ealdholtMeadowW+ealdholtForestW)+ealdholtRockNormal.z*ealdholtRockW)));
  // Derivative tangent frame follows the same source-metre projection as RGB
  // and ORM. View-space derivatives retain the Native root's actual pose.
  vec3 ealdholtQ0=dFdx(-vViewPosition),ealdholtQ1=dFdy(-vViewPosition);
  vec2 ealdholtSt0=dFdx(ealdholtEarthUv),ealdholtSt1=dFdy(ealdholtEarthUv);
  vec3 ealdholtN=normalize(normal),ealdholtQ1Perp=cross(ealdholtQ1,ealdholtN),ealdholtQ0Perp=cross(ealdholtN,ealdholtQ0);
  vec3 ealdholtT=ealdholtQ1Perp*ealdholtSt0.x+ealdholtQ0Perp*ealdholtSt1.x;
  vec3 ealdholtB=ealdholtQ1Perp*ealdholtSt0.y+ealdholtQ0Perp*ealdholtSt1.y;
  float ealdholtBasisSize=max(dot(ealdholtT,ealdholtT),dot(ealdholtB,ealdholtB));
  float ealdholtBasisScale=ealdholtBasisSize>0.?inversesqrt(ealdholtBasisSize):0.;
  normal=normalize((ealdholtT*ealdholtSurfaceNormal.x+ealdholtB*ealdholtSurfaceNormal.y)*ealdholtBasisScale+ealdholtN*ealdholtSurfaceNormal.z);
#else
  #include <normal_fragment_maps>
#endif`);
  if (shader.fragmentShader.includes('#include <aomap_fragment>')) shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `
#ifdef USE_MAP
  float ealdholtSurfaceAo=ealdholtEarthOrm.r*ealdholtBankW+ealdholtMeadowW+${glsl(EALDHOLT_WOODLAND_ROCK_AO)}*ealdholtRockW+ealdholtForestW;
  reflectedLight.indirectDiffuse*=mix(1.,ealdholtSurfaceAo,.8);${forest ? `
  // Without shadow maps the crowns' shade is approximated (the uniform is 0 with shadow maps).
  float ealdholtShade=1.-uEaldholtValleyCanopyShade*ealdholtCanopyCover;
  reflectedLight.directDiffuse*=ealdholtShade;reflectedLight.directSpecular*=ealdholtShade;reflectedLight.indirectDiffuse*=ealdholtShade;` : ''}
#else
  #include <aomap_fragment>
#endif`);
}
