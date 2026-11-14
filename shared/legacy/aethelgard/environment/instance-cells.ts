/**
 * Deterministic spatial cells for instanced groundcover, understory, rock,
 * debris and (evaluation-only) tree layers. A build step partitions
 * layer-local instance matrices into a sparse quadtree of square cells, one
 * level per distance band: level-0 cells serve the nearest band and every
 * farther band doubles the cell edge, so distant content costs a few large
 * draws instead of many small ones. Cell bounds are conservative over every
 * LOD, every instance in the cell's region and every instance origin.
 *
 * Density is continuous per instance, not per cell. Each layer has a smooth
 * distance-driven density curve (full density through the nearest band, then
 * power-law segments through the band knots, then a fade to zero at the reach).
 * A vertex-shader patch scales each instance out over a narrow window around
 * that threshold, using the instance's global priority rank, and widens the
 * survivors by 1/sqrt(density) (the LAAS GroundRing rule). The CPU only picks
 * cells, LOD geometry and a conservative instance count, so a band change or a
 * split changes geometry cost, never which instances are visible. The remaining
 * discontinuity is the LOD geometry swap itself.
 *
 * Budgets degrade by coarsening, not dropping: the selector starts from the
 * coarsest cells and refines (splits) the most important ones first while the
 * children's extra draws and triangles fit the share. Admission keeps last
 * frame's decisions within a hysteresis window, so a binding share does not
 * flicker. Shares can follow measured headroom (total budget minus the rest of
 * the scene) instead of a fixed fraction.
 *
 * Platform-free: adapters own three/IWSDK objects and pass plain numbers. The
 * selector writes into arrays allocated when it is created; update() allocates
 * nothing, and instance data is written once at build time, never per frame.
 *
 * What was adopted from LAAS and what was deferred is recorded in
 * docs/legacy/environment/LAAS_FABLE5_EVALUATION.md. Only the integer hash
 * below is adapted code; everything else re-implements design rules for a
 * CPU/WebGL2 renderer (see EALDHOLT_INSTANCE_CELLS_SOURCE and LICENSE.laas.txt).
 */
import { assertEaldholtFoliageQuality, readEaldholtFoliageDensity, type EaldholtFoliageQuality } from './foliage-density';

export type { EaldholtFoliageQuality } from './foliage-density';
export type EaldholtInstanceCellProfile = 'desktop' | 'quest';
export type EaldholtInstanceCellKind = 'groundcover' | 'understory' | 'rock' | 'debris' | 'tree';
export const EALDHOLT_INSTANCE_CELL_KINDS: readonly EaldholtInstanceCellKind[] = Object.freeze(['groundcover', 'understory', 'rock', 'debris', 'tree'] as const);
export type EaldholtInstanceCellTiers = Readonly<Record<EaldholtFoliageQuality, number>>;
const QUALITIES = ['low', 'medium', 'high'] as const;
const tierIndexOf = (tier: EaldholtFoliageQuality) => tier === 'low' ? 0 : tier === 'medium' ? 1 : 2;

/** Source attribution for the adapted hash and the adopted LAAS design rules. */
export const EALDHOLT_INSTANCE_CELLS_SOURCE = Object.freeze({
  repository: 'https://github.com/Braffolk/fable5-world-demo',
  commit: 'fd75fdb718996908aad3d22b59dfa297dc94298d',
  licence: 'MIT',
  notice: 'Copyright (c) 2026 Remi Sebastian Kits',
  licenceText: 'shared/legacy/aethelgard/environment/LICENSE.laas.txt',
  adaptedCode: Object.freeze([Object.freeze({
    source: 'src/gpu/passes/Scatter.ts', symbol: 'pcg2d',
    adaptation: 'CPU Math.imul port of the TSL integer hash: same constants, coordinate bias and salt split; two 24-bit unit values.',
  })]),
  adoptedDesign: Object.freeze([
    Object.freeze({ source: 'src/world/TerrainTiles.ts', rule: 'Quadtree selection: cells refine only near the camera; selection is skipped while the view is unchanged.' }),
    Object.freeze({ source: 'src/gpu/passes/Scatter.ts', rule: 'Size-stratified classes draw only while their nominal size still covers a few pixels.' }),
    Object.freeze({ source: 'src/vegetation/Forests.ts', rule: 'Distance bound, frustum test and LOD band classification per cull unit; slack for one-frame-stale planes.' }),
    Object.freeze({ source: 'src/vegetation/VegLibrary.ts', rule: 'Cull bounds are conservative over every LOD part, so a band change alters cost, never culling.' }),
    Object.freeze({ source: 'src/vegetation/GroundRing.ts', rule: 'Continuous distance thinning by a deterministic per-instance priority; survivors widen by 1/sqrt(thin), clamped, and grow in height by a fraction (LAAS uses 0.3) of the extra width; nothing near the camera is bald.' }),
  ]),
});

const PCG_M = 1664525, PCG_C = 1013904223, PCG_BIAS = 40000, UNIT = 1 / 16777216;

/**
 * CPU port of LAAS `pcg2d` (src/gpu/passes/Scatter.ts at the commit above,
 * MIT, Copyright (c) 2026 Remi Sebastian Kits). An integer hash stays stable at
 * any cell magnitude, unlike sin-based hashes. Integer coordinates must lie in
 * [-40000, 1000000]; the salt in [0, 2^31). Writes two values in [0, 1).
 */
export function ealdholtPcg2d(x: number, z: number, salt: number, out: { [index: number]: number }): void {
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < -PCG_BIAS || z < -PCG_BIAS || x > 1e6 || z > 1e6)
    throw new RangeError('Hash coordinates must be integers in [-40000, 1000000].');
  if (!Number.isInteger(salt) || salt < 0 || salt > 0x7fffffff) throw new RangeError('Hash salt must be a 31-bit integer.');
  const a0 = (x + PCG_BIAS + (salt & 0x3fff)) >>> 0, b0 = (z + PCG_BIAS + ((salt >> 14) & 0x3fff)) >>> 0;
  const a1 = (Math.imul(a0, PCG_M) + PCG_C) >>> 0, b1 = (Math.imul(b0, PCG_M) + PCG_C) >>> 0;
  const a2 = (a1 + Math.imul(b1, PCG_M)) >>> 0, b2 = (b1 + Math.imul(a2, PCG_M)) >>> 0;
  const a3 = (a2 ^ (a2 >>> 16)) >>> 0, b3 = (b2 ^ (b2 >>> 16)) >>> 0;
  const a4 = (a3 + Math.imul(b3, PCG_M)) >>> 0, b4 = (b3 + Math.imul(a4, PCG_M)) >>> 0;
  const a5 = (a4 ^ (a4 >>> 16)) >>> 0, b5 = (b4 ^ (b4 >>> 16)) >>> 0;
  out[0] = (a5 & 0xffffff) * UNIT; out[1] = (b5 & 0xffffff) * UNIT;
}

function checkMatrices(matrices: ArrayLike<number>, label: string): number {
  if (!matrices || typeof matrices.length !== 'number' || matrices.length % 16) throw Error(`${label}: matrices must hold 16 values per instance.`);
  const count = matrices.length / 16;
  if (count > 2_000_000) throw Error(`${label}: too many instances for one cell layer.`);
  for (let i = 0; i < count; i++) {
    const o = i * 16;
    for (let k = 0; k < 16; k++) if (!Number.isFinite(matrices[o + k])) throw Error(`${label}: instance ${i} has a non-finite matrix.`);
    if (matrices[o + 3] !== 0 || matrices[o + 7] !== 0 || matrices[o + 11] !== 0 || matrices[o + 15] !== 1)
      throw Error(`${label}: instance ${i} is not an affine transform.`);
  }
  return count;
}

/**
 * Deterministic density priority for a newly placed layer: a stable random
 * order keyed by each instance's quantised ground position, so every tier or
 * density prefix is a spatially uniform subset and the order survives
 * reordering of the input. Authored families keep their own order instead.
 */
export function createEaldholtDensityOrder(matrices: ArrayLike<number>, salt: number, quantum = 0.05): Uint32Array {
  const count = checkMatrices(matrices, 'Density order');
  if (!Number.isFinite(quantum) || quantum <= 0) throw new RangeError('Density order quantum must be positive.');
  const keys = new Float64Array(count * 2), hash = [0, 0] as [number, number];
  for (let i = 0; i < count; i++) {
    ealdholtPcg2d(Math.round(matrices[i * 16 + 12] / quantum), Math.round(matrices[i * 16 + 14] / quantum), salt, hash);
    keys[i * 2] = hash[0]; keys[i * 2 + 1] = hash[1];
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) =>
    keys[a * 2] - keys[b * 2] || keys[a * 2 + 1] - keys[b * 2 + 1] || a - b);
  return Uint32Array.from(order);
}

/** Copies matrices into the given priority order (build time only). */
export function applyEaldholtDensityOrder(matrices: ArrayLike<number>, order: ArrayLike<number>): Float32Array {
  const count = checkMatrices(matrices, 'Density order');
  if (order.length !== count) throw Error('Density order must list every instance once.');
  const seen = new Uint8Array(count), out = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    const from = order[i];
    if (!Number.isInteger(from) || from < 0 || from >= count || seen[from]) throw Error('Density order must be a permutation.');
    seen[from] = 1;
    for (let k = 0; k < 16; k++) out[i * 16 + k] = matrices[from * 16 + k];
  }
  return out;
}

/** LAAS's size-stratified rule: a class draws while its nominal size still
 * covers `pixels` at the given focal length (pixels per radian). */
export function ealdholtCoverageDistance(nominalSize: number, focalPixels: number, pixels: number): number {
  if (![nominalSize, focalPixels, pixels].every(value => Number.isFinite(value) && value > 0))
    throw new RangeError('Coverage distance needs positive finite size, focal length and pixel threshold.');
  return nominalSize * focalPixels / pixels;
}

// ---------------------------------------------------------------- rules

export interface EaldholtInstanceCellBandRule {
  /** Band holds while the nominal size covers at least this many pixels. */
  readonly pixels: number;
  /** Prototype LOD drawn in this band; clamped to the LODs a layer supplies. */
  readonly lod: number;
  /** Density knot at the band's outer edge (HIGH tier). The nearest band is
   * always 1: no ground near the camera is thinned. Nonincreasing. */
  readonly density: number;
}
export interface EaldholtInstanceCellKindRule {
  /** Metres; the projected-size reference for every band of this kind. */
  readonly nominalSize: number;
  /** Level-0 (nearest band) cell edge in layer-local metres; each farther band doubles it. */
  readonly cellSize: number;
  /** Fraction of each boundary distance; a cell changes band or wants to split only after crossing it by this margin. */
  readonly hysteresis: number;
  /** Nearest band first, so pixel thresholds descend. */
  readonly bands: readonly EaldholtInstanceCellBandRule[];
  /** Fraction of the density threshold over which an instance scales out (default 0.12). */
  readonly fade?: number;
  /** Clamp for the 1/sqrt(density) widening of survivors; 1 disables widening (default 2.5). */
  readonly widenMax?: number;
  /** Height growth as a fraction of the extra width (default 0.3, the LAAS GroundRing value). */
  readonly heightGain?: number;
  /** Fraction of the reach over which density fades to zero (default 0.15). */
  readonly reachFade?: number;
  /** Whether cells of this kind may cast sun shadows (the caller still decides by distance). */
  readonly castShadow?: boolean;
  /** Whether alpha-tested maps of this kind should get coverage-preserving mips. */
  readonly alphaMips?: boolean;
  /** Refine inside the nearest band regardless of the share, so the ground near
   * the camera is never bald or coarse (default: groundcover only). */
  readonly nearFieldGuarantee?: boolean;
}
export interface EaldholtInstanceCellBudget { readonly draws: number; readonly triangles: number }
export type EaldholtInstanceCellBudgets = Readonly<Record<EaldholtFoliageQuality, EaldholtInstanceCellBudget>>;
/** Shares that follow measured headroom: total budget minus the rest of the scene. */
export interface EaldholtInstanceCellHeadroomPolicy {
  /** Whole-scene budgets (docs/legacy/PERFORMANCE.md). */
  readonly totals: EaldholtInstanceCellBudgets;
  /** Fraction of each total kept free for everything else (0-0.5). */
  readonly reserve: number;
  /** Share granted even when the rest of the scene already exceeds the total. */
  readonly floor: EaldholtInstanceCellBudgets;
  /** Frames of base-cost history; the share follows the worst recent frame. */
  readonly window: number;
  /** A share grows only when the new value exceeds the current one by this fraction. */
  readonly growHysteresis: number;
}
export interface EaldholtInstanceCellProfileRule {
  /** Nominal pixels per radian used for every band distance. Update() rescales by the actual focal length. */
  readonly focalPixels: number;
  /** Layer-local slack for frustum planes that may be a frame stale. */
  readonly frustumMargin: number;
  /** Per-tier distance bias: every band distance is multiplied by this factor. */
  readonly tierScale: Readonly<Record<EaldholtFoliageQuality, number>>;
  /** Per-tier LOD offset added to every band's LOD (clamped to the layer's LODs):
   * a lower tier draws cheaper geometry at the same density instead of a balder near field. */
  readonly tierLodBias: Readonly<Record<EaldholtFoliageQuality, number>>;
  /** Upper bound of the share available to all cell layers together. */
  readonly budgets: EaldholtInstanceCellBudgets;
  readonly headroom: EaldholtInstanceCellHeadroomPolicy;
  /** Fraction of last frame's admission cutoff used as hysteresis for the share. */
  readonly admissionHysteresis: number;
  /** Budget-adaptive density: a slow gain on the far density knots (never the nearest band)
   * that lowers far density when triangles exceed the share and restores it, up to the
   * authored curve, when they are spare. Instances fade continuously, so the gain never
   * pops. The maximum is 1: a gain above the authored curve would exceed the coarse levels'
   * stored prefixes and make the drawn level visible. */
  readonly adaptiveDensity: EaldholtInstanceCellAdaptiveDensity | null;
  readonly kinds: Readonly<Record<EaldholtInstanceCellKind, EaldholtInstanceCellKindRule>>;
}
export interface EaldholtInstanceCellAdaptiveDensity { readonly min: number; readonly max: number }

const band = (pixels: number, lod: number, density: number): EaldholtInstanceCellBandRule => Object.freeze({ pixels, lod, density });
const kind = (nominalSize: number, cellSize: number, bands: EaldholtInstanceCellBandRule[], extra: Omit<EaldholtInstanceCellKindRule, 'nominalSize' | 'cellSize' | 'hysteresis' | 'bands'>): EaldholtInstanceCellKindRule =>
  Object.freeze({ nominalSize, cellSize, hysteresis: .1, bands: Object.freeze(bands), ...extra });
const budget = (draws: number, triangles: number): EaldholtInstanceCellBudget => Object.freeze({ draws, triangles });
const tiers3 = (low: EaldholtInstanceCellBudget, medium: EaldholtInstanceCellBudget, high: EaldholtInstanceCellBudget): EaldholtInstanceCellBudgets => Object.freeze({ low, medium, high });

/** docs/legacy/PERFORMANCE.md whole-scene budgets. */
export const EALDHOLT_PERFORMANCE_BUDGETS: Readonly<Record<EaldholtInstanceCellProfile, EaldholtInstanceCellBudgets>> = Object.freeze({
  desktop: tiers3(budget(120, 300_000), budget(200, 800_000), budget(400, 1_500_000)),
  quest: tiers3(budget(120, 250_000), budget(120, 250_000), budget(120, 250_000)),
});

/**
 * Proposed defaults, tuned on the synthetic review terrain against the five
 * village camera poses (see the evaluation). Desktop distances assume about
 * 1150 px per radian (1080 px tall, ~50 degree vertical view) and are rescaled
 * by the actual focal length each update; Quest about 950 px per radian.
 * Quest distances are source metres seen in the 0.02-scale miniature at
 * >= 3.8 m (front edge >= ~29 source metres at the 1.3 maximum zoom).
 * The last bands stop at 3-4 px where LAAS reaches ~2 px: a WebGL2/Quest draw
 * budget deviation; beyond them, the coverage raster carries the tone.
 * Desktop shares follow measured headroom with a near-field floor; Quest
 * shares follow headroom with no floor, so they stay zero while the rest of the
 * Native scene exceeds 250k triangles.
 */
export const EALDHOLT_INSTANCE_CELL_PROFILES: Readonly<Record<EaldholtInstanceCellProfile, EaldholtInstanceCellProfileRule>> = Object.freeze({
  desktop: Object.freeze({
    focalPixels: 1150,
    frustumMargin: .5,
    tierScale: Object.freeze({ low: .85, medium: 1, high: 1.4 }),
    tierLodBias: Object.freeze({ low: 1, medium: 0, high: 0 }),
    budgets: tiers3(budget(36, 120_000), budget(72, 300_000), budget(128, 560_000)),
    headroom: Object.freeze({ totals: EALDHOLT_PERFORMANCE_BUDGETS.desktop, reserve: .1, window: 90, growHysteresis: .1,
      floor: tiers3(budget(12, 40_000), budget(16, 60_000), budget(24, 90_000)) }),
    admissionHysteresis: .12,
    adaptiveDensity: Object.freeze({ min: .35, max: 1 }),
    kinds: Object.freeze({
      groundcover: kind(.5, 16, [band(40, 0, 1), band(16, 1, .7), band(7, 2, .4), band(3, 2, .16)], { widenMax: 3, castShadow: false, alphaMips: true }),
      understory: kind(1.2, 24, [band(48, 0, 1), band(18, 1, .8), band(9, 2, .55), band(3.5, 2, .3)], { widenMax: 2, castShadow: true, alphaMips: true }),
      rock: kind(1.4, 64, [band(40, 0, 1), band(8, 1, 1), band(4, 1, 1)], { widenMax: 1, castShadow: true, alphaMips: false }),
      debris: kind(.9, 64, [band(40, 0, 1), band(10, 1, .8), band(5, 1, .5)], { widenMax: 1.5, castShadow: true, alphaMips: true }),
      tree: kind(8, 64, [band(120, 0, 1), band(30, 1, 1), band(8, 2, 1)], { widenMax: 1, castShadow: true, alphaMips: true }),
    }),
  }),
  quest: Object.freeze({
    focalPixels: 950,
    frustumMargin: 20,
    tierScale: Object.freeze({ low: .85, medium: 1, high: 1.2 }),
    tierLodBias: Object.freeze({ low: 0, medium: 0, high: 0 }),
    budgets: tiers3(budget(8, 12_000), budget(10, 18_000), budget(12, 24_000)),
    headroom: Object.freeze({ totals: EALDHOLT_PERFORMANCE_BUDGETS.quest, reserve: .05, window: 90, growHysteresis: .1,
      floor: tiers3(budget(0, 0), budget(0, 0), budget(0, 0)) }),
    admissionHysteresis: .12,
    adaptiveDensity: Object.freeze({ min: .35, max: 1 }),
    kinds: Object.freeze({
      groundcover: kind(.5, 32, [band(10, 1, 1), band(5, 2, .4), band(3, 2, .15)], { widenMax: 3, castShadow: false, alphaMips: true }),
      understory: kind(1.2, 48, [band(16, 1, 1), band(8, 1, .5), band(4, 2, .25)], { widenMax: 2, castShadow: false, alphaMips: true }),
      rock: kind(1.4, 64, [band(6, 1, 1), band(3, 1, 1)], { widenMax: 1, castShadow: false, alphaMips: false }),
      debris: kind(.9, 64, [band(8, 1, 1), band(4, 1, .5)], { widenMax: 1.5, castShadow: false, alphaMips: true }),
      tree: kind(8, 64, [band(24, 1, 1), band(6, 2, 1)], { widenMax: 1, castShadow: false, alphaMips: true }),
    }),
  }),
});

/** Resolved per-layer settings, in effective metres (layer-local metres at the
 * nominal focal length and tier scale 1). */
export interface EaldholtInstanceCellLayerSettings {
  /** Metres; ranks cells by distance / nominalSize, i.e. by projected size. */
  readonly nominalSize: number;
  /** Cell edge per level; level b serves band b. */
  readonly levelSizes: readonly number[];
  readonly hysteresis: number;
  /** Outer edge of each band, ascending. Beyond the last edge a cell is hidden. */
  readonly bandDistances: readonly number[];
  readonly bandLods: readonly number[];
  /** HIGH-tier density knot at each band's outer edge; the first is 1. */
  readonly bandDensities: readonly number[];
  /** Highest density a level-L cell draws without budget coarsening:
   * the HIGH curve at its split edge less the hysteresis margin. */
  readonly levelCaps: readonly number[];
  readonly fade: number;
  readonly widenMax: number;
  readonly heightGain: number;
  /** Instances shrink to zero scale over [reachStart, reach]; reach is the last
   * band edge less its hysteresis margin, so no hidden cell holds a visible instance. */
  readonly reachStart: number;
  readonly reach: number;
  readonly castShadow: boolean;
  readonly alphaMips: boolean;
  readonly nearFieldGuarantee: boolean;
}

const DEFAULT_KIND_POLICY: Readonly<Record<EaldholtInstanceCellKind, { castShadow: boolean; alphaMips: boolean; nearFieldGuarantee: boolean }>> = Object.freeze({
  groundcover: { castShadow: false, alphaMips: true, nearFieldGuarantee: true }, understory: { castShadow: true, alphaMips: true, nearFieldGuarantee: false },
  rock: { castShadow: true, alphaMips: false, nearFieldGuarantee: false }, debris: { castShadow: true, alphaMips: true, nearFieldGuarantee: false },
  tree: { castShadow: true, alphaMips: true, nearFieldGuarantee: false },
});

function smooth01(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }

/** CPU reference of the shader's density curve: knots at band outer edges and
 * power-law segments between them. Offsets read knots out of a larger array. */
export function ealdholtInstanceCellCurve(distances: ArrayLike<number>, densities: ArrayLike<number>, count: number, distance: number, distanceOffset = 0, densityOffset = 0): number {
  let rho = densities[densityOffset];
  for (let i = 1; i < count; i++) {
    const d0 = distances[distanceOffset + i - 1];
    if (distance > d0) {
      const t = Math.min(1, Math.max(0, Math.log(distance / d0) / Math.log(distances[distanceOffset + i] / d0))), r0 = densities[densityOffset + i - 1];
      rho = r0 * Math.pow(densities[densityOffset + i] / r0, t);
    }
  }
  return rho;
}

/** Scale factor that shrinks every instance smoothly to zero over the last
 * stretch before the reach, so the last (widest) survivors never pop. */
export function ealdholtInstanceCellReachFade(reachStart: number, reach: number, distance: number): number {
  return distance <= reachStart ? 1 : distance >= reach ? 0 : 1 - smooth01((distance - reachStart) / (reach - reachStart));
}

/** Density of a layer at an effective distance for a tier factor (tier count
 * over HIGH count): the nearest band stays at 1 for every enabled tier and
 * nothing is drawn beyond the reach. The reach fade scales instances on top. */
export function ealdholtInstanceCellDensityAt(settings: EaldholtInstanceCellLayerSettings, tierFactor: number, distance: number): number {
  if (!(tierFactor > 0) || distance >= settings.reach) return 0;
  const knots = settings.bandDensities, scaled: number[] = [];
  for (let i = 0; i < knots.length; i++) scaled.push(i === 0 ? knots[0] : Math.max(1e-6, knots[i] * Math.min(1, tierFactor)));
  return ealdholtInstanceCellCurve(settings.bandDistances, scaled, knots.length, distance);
}

/** Band index for an effective distance without hysteresis (bands.length when beyond reach). */
export function ealdholtInstanceCellBandAt(settings: EaldholtInstanceCellLayerSettings, distance: number): number {
  let b = 0;
  while (b < settings.bandDistances.length && distance >= settings.bandDistances[b]) b++;
  return b;
}

export function resolveEaldholtInstanceCellLayerSettings(rule: EaldholtInstanceCellKindRule, focalPixels: number, kindName: EaldholtInstanceCellKind = 'groundcover'): EaldholtInstanceCellLayerSettings {
  if (!rule || !Number.isFinite(rule.cellSize) || rule.cellSize < 1 || rule.cellSize > 512) throw new RangeError('Instance cell size must be 1-512 metres.');
  if (!Number.isFinite(rule.hysteresis) || rule.hysteresis < 0 || rule.hysteresis > .45) throw new RangeError('Instance cell hysteresis must be 0-0.45.');
  if (!rule.bands || typeof rule.bands.length !== 'number' || rule.bands.length < 1 || rule.bands.length > 6) throw new RangeError('Instance cells need 1-6 distance bands.');
  const fade = rule.fade ?? .12, widenMax = rule.widenMax ?? 2.5, heightGain = rule.heightGain ?? .3, reachFade = rule.reachFade ?? .15;
  if (!Number.isFinite(fade) || fade < 0 || fade > .5) throw new RangeError('Instance cell fade must be 0-0.5.');
  if (!Number.isFinite(widenMax) || widenMax < 1 || widenMax > 4) throw new RangeError('Instance cell widening must be 1-4.');
  if (!Number.isFinite(heightGain) || heightGain < 0 || heightGain > 1) throw new RangeError('Instance cell height gain must be 0-1.');
  if (!Number.isFinite(reachFade) || reachFade <= 0 || reachFade >= .5) throw new RangeError('Instance cell reach fade must be in (0, 0.5).');
  const distances: number[] = [], lods: number[] = [], densities: number[] = [], sizes: number[] = [];
  for (const item of rule.bands) {
    if (!Number.isInteger(item.lod) || item.lod < 0 || item.lod > 7) throw new RangeError('Instance cell band LOD must be an integer 0-7.');
    if (!Number.isFinite(item.density) || item.density <= 0 || item.density > 1) throw new RangeError('Instance cell band density must be in (0, 1].');
    if (!densities.length && item.density !== 1) throw new RangeError('The nearest instance cell band must keep full density.');
    if (densities.length && item.density > densities[densities.length - 1]) throw new RangeError('Instance cell band density must not increase with distance.');
    distances.push(ealdholtCoverageDistance(rule.nominalSize, focalPixels, item.pixels)); lods.push(item.lod); densities.push(item.density);
    sizes.push(rule.cellSize * 2 ** sizes.length);
  }
  for (let i = 1; i < distances.length; i++) {
    // Hysteresis windows of neighbouring boundaries must not overlap.
    if (!(distances[i - 1] * (1 + rule.hysteresis) < distances[i] * (1 - rule.hysteresis)))
      throw new RangeError('Instance cell bands must be ascending and separated by more than their hysteresis.');
  }
  // Instances reach zero scale where the last boundary's hysteresis window opens:
  // a cell that hysteresis may still hide can never hold a visible instance.
  const reach = distances[distances.length - 1] * (1 - rule.hysteresis), reachStart = reach * (1 - reachFade);
  if (distances.length > 1 && !(reachStart > distances[distances.length - 2] * (1 + rule.hysteresis))) throw new RangeError('Instance cell reach fade overlaps the previous band.');
  const policy = DEFAULT_KIND_POLICY[kindName] ?? DEFAULT_KIND_POLICY.groundcover;
  // Near full density the fade lifts every instance to full size (see the shader), so a level whose
  // cap reaches that lift stores everything.
  const caps = sizes.map((_, level) => {
    const cap = level === 0 ? 1 : Math.min(1, ealdholtInstanceCellCurve(distances, densities, densities.length, distances[level - 1] * (1 - rule.hysteresis)));
    return cap > 1 - fade ? 1 : cap;
  });
  return Object.freeze({ nominalSize: rule.nominalSize, levelSizes: Object.freeze(sizes), hysteresis: rule.hysteresis, bandDistances: Object.freeze(distances),
    bandLods: Object.freeze(lods), bandDensities: Object.freeze(densities), levelCaps: Object.freeze(caps), fade, widenMax, heightGain, reachStart, reach,
    castShadow: rule.castShadow ?? policy.castShadow, alphaMips: rule.alphaMips ?? policy.alphaMips, nearFieldGuarantee: rule.nearFieldGuarantee ?? policy.nearFieldGuarantee });
}

/** Authored tiers in the userData.crownfallFoliageDensity schema. `components`
 * is the number of parts in a layer's nearest LOD, as for an authored family. */
export function readEaldholtInstanceCellTiers(metadata: unknown, instanceCount: number, components: number): { family: string; tiers: EaldholtInstanceCellTiers } {
  const tag = readEaldholtFoliageDensity(metadata);
  if (tag.components !== components) throw Error(`Instance cell density ${tag.family} names ${tag.components} components; its nearest LOD has ${components}.`);
  if (tag.counts.high > instanceCount) throw Error(`Instance cell density ${tag.family} exceeds its ${instanceCount} instances.`);
  return { family: tag.family, tiers: tag.counts };
}

/** Untagged layers mirror the exterior woodland's 50/75/100% tier split. Tiers
 * scale density beyond the nearest band only. */
export function defaultEaldholtInstanceCellTiers(instanceCount: number): EaldholtInstanceCellTiers {
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 0) throw new RangeError('Instance count must be a nonnegative integer.');
  return Object.freeze({ low: Math.ceil(instanceCount * .5), medium: Math.ceil(instanceCount * .75), high: instanceCount });
}

/** Global prefix length drawn for a tier count and density. */
export function ealdholtInstanceCellThreshold(tierCount: number, density: number): number {
  return Math.ceil(tierCount * density - 1e-9);
}

// ---------------------------------------------------------------- index

export interface EaldholtInstanceCellBox { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
export interface EaldholtInstanceCellLodCost {
  /** Triangles drawn per instance at this LOD (all parts). */
  readonly triangles: number;
  /** Draw calls per visible cell at this LOD (parts x material groups). */
  readonly draws: number;
}
export interface EaldholtInstanceCellLayerInput {
  readonly id: string;
  readonly kind: EaldholtInstanceCellKind;
  /** Column-major layer-local matrices, 16 per instance, in density-priority order. */
  readonly matrices: ArrayLike<number>;
  /** Prototype-space bounds over every part of every LOD. */
  readonly localBounds: EaldholtInstanceCellBox;
  /** Nearest LOD first. */
  readonly lods: readonly EaldholtInstanceCellLodCost[];
  /** Prefix lengths per quality; defaults to defaultEaldholtInstanceCellTiers. */
  readonly tiers?: EaldholtInstanceCellTiers;
  /** Replaces the profile's rule for this layer's kind. */
  readonly rule?: EaldholtInstanceCellKindRule;
}
export interface EaldholtInstanceCellIndexOptions {
  readonly profile: EaldholtInstanceCellProfile;
  readonly focalPixels?: number;
  readonly frustumMargin?: number;
  /** Share caps; the selector starts at these unless it follows headroom. */
  readonly budgets?: EaldholtInstanceCellBudgets;
  /** Replaces the profile's admission hysteresis (0-0.4); 0 reproduces stateless admission for comparison. */
  readonly admissionHysteresis?: number;
  /** Replaces the profile's adaptive density range; null keeps the authored curve fixed. */
  readonly adaptiveDensity?: EaldholtInstanceCellAdaptiveDensity | null;
}
export interface EaldholtInstanceCellLayerSummary {
  readonly id: string;
  readonly kind: EaldholtInstanceCellKind;
  readonly instances: number;
  /** Cells of this layer occupy [firstCell, firstCell + cells); its roots come first. */
  readonly firstCell: number;
  readonly cells: number;
  readonly roots: number;
  readonly levels: number;
  /** Grid origin (minimum instance translation x and z); cells are aligned to it. */
  readonly origin: readonly [number, number];
  readonly tiers: EaldholtInstanceCellTiers;
  readonly lods: readonly EaldholtInstanceCellLodCost[];
  readonly settings: EaldholtInstanceCellLayerSettings;
  /** Instances stored for drawing over every level (each level stores its own prefix). */
  readonly storedInstances: number;
}
/** Typed arrays are read-only by contract; they cannot be frozen. */
export interface EaldholtInstanceCellIndex {
  readonly profile: EaldholtInstanceCellProfile;
  readonly focalPixels: number;
  readonly frustumMargin: number;
  readonly tierScale: Readonly<Record<EaldholtFoliageQuality, number>>;
  readonly tierLodBias: Readonly<Record<EaldholtFoliageQuality, number>>;
  readonly budgets: EaldholtInstanceCellBudgets;
  readonly admissionHysteresis: number;
  readonly adaptiveDensity: EaldholtInstanceCellAdaptiveDensity | null;
  readonly layers: readonly EaldholtInstanceCellLayerSummary[];
  readonly cellCount: number;
  readonly instanceCount: number;
  readonly cellLayer: Uint16Array;
  readonly cellLevel: Uint8Array;
  readonly cellX: Int32Array;
  readonly cellZ: Int32Array;
  /** Six values per cell: min x, y, z then max x, y, z over every instance box and origin in the cell's region. */
  readonly cellBounds: Float64Array;
  /** Children of a cell are contiguous: [cellChildStart, cellChildStart + cellChildCount). */
  readonly cellChildStart: Uint32Array;
  readonly cellChildCount: Uint8Array;
  /** Instances stored for drawing: [cellStart, cellStart + cellInstances) in `order`. */
  readonly cellStart: Uint32Array;
  readonly cellInstances: Uint32Array;
  /** Layer instance indices (= priority ranks) per cell, ascending. A cell stores
   * only the prefix its own level can draw, so instances repeat across levels. */
  readonly order: Uint32Array;
  readonly bounds: EaldholtInstanceCellBox | null;
}

interface BuildCell { layer: number; level: number; x: number; z: number; members: number[]; box: number[]; children: BuildCell[] }

/**
 * The index build as resumable steps, so an adapter can yield to the main
 * thread between layers and every `chunk` instances instead of running one
 * long task. Each yield reports the instances processed so far. The returned
 * index is identical to buildEaldholtInstanceCellIndex.
 */
export function* ealdholtInstanceCellIndexSteps(layers: readonly EaldholtInstanceCellLayerInput[], options: EaldholtInstanceCellIndexOptions, chunk = 16384): Generator<number, EaldholtInstanceCellIndex, void> {
  const profile = options.profile;
  if (profile !== 'desktop' && profile !== 'quest') throw Error('Instance cell profile must be desktop or quest.');
  if (!Number.isSafeInteger(chunk) || chunk < 256) throw new RangeError('Instance cell build chunk must be at least 256 instances.');
  const rules = EALDHOLT_INSTANCE_CELL_PROFILES[profile];
  const focalPixels = options.focalPixels ?? rules.focalPixels, frustumMargin = options.frustumMargin ?? rules.frustumMargin;
  if (!Number.isFinite(focalPixels) || focalPixels < 100 || focalPixels > 20000) throw new RangeError('Instance cell focal length must be 100-20000 px.');
  if (!Number.isFinite(frustumMargin) || frustumMargin < 0) throw new RangeError('Instance cell frustum margin must be nonnegative.');
  const budgets = options.budgets ?? rules.budgets, admissionHysteresis = options.admissionHysteresis ?? rules.admissionHysteresis;
  if (!Number.isFinite(admissionHysteresis) || admissionHysteresis < 0 || admissionHysteresis > .4) throw new RangeError('Instance cell admission hysteresis must be 0-0.4.');
  const adaptiveDensity = options.adaptiveDensity === undefined ? rules.adaptiveDensity : options.adaptiveDensity;
  if (adaptiveDensity && (!(adaptiveDensity.min > 0) || adaptiveDensity.min > adaptiveDensity.max || adaptiveDensity.max !== 1))
    throw new RangeError('Adaptive density needs 0 < min <= max = 1 (the authored curve is the ceiling).');
  for (const tier of QUALITIES) {
    const item = budgets[tier];
    if (!item || !Number.isSafeInteger(item.draws) || item.draws < 0 || !Number.isSafeInteger(item.triangles) || item.triangles < 0)
      throw new RangeError('Instance cell budgets need nonnegative integer draws and triangles per tier.');
  }
  if (!layers || typeof layers.length !== 'number' || layers.length < 1 || layers.length > 64) throw Error('Instance cells need 1-64 layers.');
  const ids = new Set<string>(), ordered: BuildCell[] = [];
  const summaries: Omit<EaldholtInstanceCellLayerSummary, 'firstCell' | 'cells' | 'roots' | 'storedInstances'>[] = [], rootCounts: number[] = [];
  let instanceCount = 0, processed = 0;
  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l];
    if (typeof layer.id !== 'string' || !layer.id.trim() || layer.id.length > 120 || /[\u0000-\u001f\u007f]/.test(layer.id) || ids.has(layer.id))
      throw Error('Instance cell layer ids must be unique printable strings.');
    ids.add(layer.id);
    if (!EALDHOLT_INSTANCE_CELL_KINDS.includes(layer.kind)) throw Error(`${layer.id}: unknown instance cell kind.`);
    const settings = resolveEaldholtInstanceCellLayerSettings(layer.rule ?? rules.kinds[layer.kind], focalPixels, layer.kind);
    const count = checkMatrices(layer.matrices, layer.id), levels = settings.levelSizes.length;
    const tiers = layer.tiers ?? defaultEaldholtInstanceCellTiers(count);
    if (![tiers.low, tiers.medium, tiers.high].every(value => Number.isSafeInteger(value) && value >= 0) || tiers.low > tiers.medium || tiers.medium > tiers.high || tiers.high > count)
      throw Error(`${layer.id}: tiers must be nondecreasing integers within the instance count.`);
    if (!layer.lods || typeof layer.lods.length !== 'number' || layer.lods.length < 1 || layer.lods.length > 8) throw Error(`${layer.id}: instance cells need 1-8 LODs.`);
    const lods = layer.lods.map(cost => {
      if (!Number.isSafeInteger(cost.triangles) || cost.triangles < 1 || !Number.isSafeInteger(cost.draws) || cost.draws < 1 || cost.draws > 16)
        throw Error(`${layer.id}: every LOD needs positive triangles and 1-16 draws.`);
      return Object.freeze({ triangles: cost.triangles, draws: cost.draws });
    });
    const lo = layer.localBounds?.min, hi = layer.localBounds?.max;
    if (!lo || !hi || lo.length !== 3 || hi.length !== 3 || ![...lo, ...hi].every(Number.isFinite) || lo[0] > hi[0] || lo[1] > hi[1] || lo[2] > hi[2])
      throw Error(`${layer.id}: prototype bounds must be a finite, nonempty box.`);
    const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2;
    const ex = (hi[0] - lo[0]) / 2, ey = (hi[1] - lo[1]) / 2, ez = (hi[2] - lo[2]) / 2;
    const m = layer.matrices;
    // Align the grid to the layer's own extent: a small layer becomes one root.
    let originX = Infinity, originZ = Infinity;
    for (let i = 0; i < count; i++) { if (m[i * 16 + 12] < originX) originX = m[i * 16 + 12]; if (m[i * 16 + 14] < originZ) originZ = m[i * 16 + 14]; }
    if (!count) { originX = 0; originZ = 0; }
    const maps = settings.levelSizes.map(() => new Map<string, BuildCell>()), box = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      for (let r = 0; r < 3; r++) {
        // Row r of the affine transform: centre and absolute-extent projection,
        // widened to include the instance origin (the shader measures distance there).
        const centre = m[o + r] * cx + m[o + 4 + r] * cy + m[o + 8 + r] * cz + m[o + 12 + r];
        const extent = Math.abs(m[o + r]) * ex + Math.abs(m[o + 4 + r]) * ey + Math.abs(m[o + 8 + r]) * ez;
        box[r] = Math.min(centre - extent, m[o + 12 + r]); box[r + 3] = Math.max(centre + extent, m[o + 12 + r]);
      }
      for (let level = 0; level < levels; level++) {
        const size = settings.levelSizes[level], x = Math.floor((m[o + 12] - originX) / size), z = Math.floor((m[o + 14] - originZ) / size), key = x + ',' + z;
        let cell = maps[level].get(key);
        if (!cell) { cell = { layer: l, level, x, z, members: [], box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], children: [] }; maps[level].set(key, cell); }
        cell.members.push(i);
        for (let k = 0; k < 3; k++) { if (box[k] < cell.box[k]) cell.box[k] = box[k]; if (box[k + 3] > cell.box[k + 3]) cell.box[k + 3] = box[k + 3]; }
      }
      if (++processed % chunk === 0) yield processed;
    }
    for (let level = 1; level < levels; level++) for (const child of maps[level - 1].values()) {
      // floor(x / 2s) == floor(floor(x / s) / 2): each child has exactly one parent.
      const parent = maps[level].get(Math.floor(child.x / 2) + ',' + Math.floor(child.z / 2));
      if (!parent) throw Error(`${layer.id}: incomplete instance cell hierarchy.`);
      parent.children.push(child);
    }
    const bySpace = (a: BuildCell, b: BuildCell) => a.x - b.x || a.z - b.z;
    const queue = [...maps[levels - 1].values()].sort(bySpace);
    rootCounts.push(queue.length);
    for (let q = 0; q < queue.length; q++) { queue[q].children.sort(bySpace); queue.push(...queue[q].children); }
    ordered.push(...queue);
    instanceCount += count;
    summaries.push({ id: layer.id, kind: layer.kind, instances: count, levels, origin: Object.freeze([originX, originZ] as [number, number]),
      tiers: Object.freeze({ low: tiers.low, medium: tiers.medium, high: tiers.high }), lods: Object.freeze(lods), settings });
    yield processed;
  }
  const n = ordered.length;
  if (n > 32768) throw Error('Too many instance cells; use larger cells or fewer layers.');
  const position = new Map<BuildCell, number>();
  ordered.forEach((cell, i) => position.set(cell, i));
  const cellLayer = new Uint16Array(n), cellLevel = new Uint8Array(n), cellX = new Int32Array(n), cellZ = new Int32Array(n), cellBounds = new Float64Array(n * 6);
  const cellChildStart = new Uint32Array(n), cellChildCount = new Uint8Array(n), cellStart = new Uint32Array(n), cellInstances = new Uint32Array(n);
  const stored: number[] = [], first = new Int32Array(layers.length).fill(-1), counts = new Uint32Array(layers.length), storedPerLayer = new Float64Array(layers.length);
  const total = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let c = 0; c < n; c++) {
    const cell = ordered[c], summary = summaries[cell.layer], s = summary.settings;
    if (first[cell.layer] < 0) first[cell.layer] = c;
    counts[cell.layer]++;
    cellLayer[c] = cell.layer; cellLevel[c] = cell.level; cellX[c] = cell.x; cellZ[c] = cell.z;
    cellChildStart[c] = cell.children.length ? position.get(cell.children[0])! : 0; cellChildCount[c] = cell.children.length;
    // A cell stores only what its own level can draw at HIGH without coarsening.
    const cap = ealdholtInstanceCellThreshold(summary.tiers.high, s.levelCaps[cell.level]);
    cellStart[c] = stored.length;
    for (const member of cell.members) if (member < cap) stored.push(member);
    cellInstances[c] = stored.length - cellStart[c];
    storedPerLayer[cell.layer] += cellInstances[c];
    for (let k = 0; k < 6; k++) {
      cellBounds[c * 6 + k] = cell.box[k];
      if (cell.level === s.levelSizes.length - 1) total[k] = k < 3 ? Math.min(total[k], cell.box[k]) : Math.max(total[k], cell.box[k]);
    }
  }
  const layerSummaries = Object.freeze(summaries.map((summary, l) => Object.freeze({ ...summary, firstCell: Math.max(0, first[l]), cells: counts[l], roots: rootCounts[l],
    storedInstances: storedPerLayer[l] })));
  return Object.freeze({
    profile, focalPixels, frustumMargin, tierScale: rules.tierScale, tierLodBias: rules.tierLodBias, budgets: Object.freeze({ low: budgets.low, medium: budgets.medium, high: budgets.high }),
    admissionHysteresis, adaptiveDensity: adaptiveDensity ? Object.freeze({ min: adaptiveDensity.min, max: adaptiveDensity.max }) : null, layers: layerSummaries, cellCount: n, instanceCount, cellLayer, cellLevel, cellX, cellZ, cellBounds,
    cellChildStart, cellChildCount, cellStart, cellInstances, order: Uint32Array.from(stored),
    bounds: n ? Object.freeze({ min: Object.freeze([total[0], total[1], total[2]] as [number, number, number]),
      max: Object.freeze([total[3], total[4], total[5]] as [number, number, number]) }) : null,
  });
}

/** The exact fraction of a layer's HIGH prefix that a level-L cell stores
 * (ceil(HIGH x cap) / HIGH): the shader's per-instance cap. Every stored rank r
 * satisfies (r + 0.5) / HIGH < this value. */
export function ealdholtInstanceCellLevelFraction(index: EaldholtInstanceCellIndex, layer: number, level: number): number {
  const summary = index.layers[layer];
  if (!summary || !Number.isInteger(level) || level < 0 || level >= summary.levels) throw new RangeError('Instance cell layer or level is out of range.');
  return summary.tiers.high > 0 ? ealdholtInstanceCellThreshold(summary.tiers.high, summary.settings.levelCaps[level]) / summary.tiers.high : 0;
}

/** Deterministic sparse quadtree per layer, laid out roots first then breadth
 * first; siblings sorted by x, then z. Bounds use the exact AABB of each
 * transformed prototype box (Arvo) over all LODs and every region instance. */
export function buildEaldholtInstanceCellIndex(layers: readonly EaldholtInstanceCellLayerInput[], options: EaldholtInstanceCellIndexOptions): EaldholtInstanceCellIndex {
  const steps = ealdholtInstanceCellIndexSteps(layers, options, 1 << 30);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

// ---------------------------------------------------------------- frustum

/**
 * Gribb-Hartmann planes from a column-major clip-from-local matrix, in three's
 * Frustum order (right, left, bottom, top, far, near). Four values per plane,
 * normalised so plane distances are in local units. `depthZeroToOne` selects
 * WebGPU-style clip depth; both shipping renderers use WebGL's [-1, 1].
 */
export function extractEaldholtFrustumPlanes(m: ArrayLike<number>, out: Float64Array, depthZeroToOne = false): Float64Array {
  if (!m || m.length < 16 || out.length < 24) throw new RangeError('Frustum extraction needs a 16-value matrix and 24 outputs.');
  setPlane(out, 0, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  setPlane(out, 1, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  setPlane(out, 2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  setPlane(out, 3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  setPlane(out, 4, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  if (depthZeroToOne) setPlane(out, 5, m[2], m[6], m[10], m[14]);
  else setPlane(out, 5, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  return out;
}
function setPlane(out: Float64Array, plane: number, x: number, y: number, z: number, w: number): void {
  const length = Math.sqrt(x * x + y * y + z * z), o = plane * 4;
  if (!(length > 0) || !Number.isFinite(length) || !Number.isFinite(w)) throw new RangeError('Degenerate or non-finite frustum plane.');
  out[o] = x / length; out[o + 1] = y / length; out[o + 2] = z / length; out[o + 3] = w / length;
}

/** Positive-vertex AABB test. False only when the box lies entirely more than
 * `margin` outside one plane; a conservative test, as for any plane culler. */
export function ealdholtAabbInFrustum(planes: ArrayLike<number>, box: ArrayLike<number>, offset: number, margin: number): boolean {
  for (let p = 0; p < 24; p += 4) {
    const nx = planes[p], ny = planes[p + 1], nz = planes[p + 2];
    const x = nx >= 0 ? box[offset + 3] : box[offset], y = ny >= 0 ? box[offset + 4] : box[offset + 1], z = nz >= 0 ? box[offset + 5] : box[offset + 2];
    if (nx * x + ny * y + nz * z + planes[p + 3] < -margin) return false;
  }
  return true;
}

/** Euclidean distance from a point to an AABB (zero inside). */
export function ealdholtAabbDistance(box: ArrayLike<number>, offset: number, x: number, y: number, z: number): number {
  const dx = x < box[offset] ? box[offset] - x : x > box[offset + 3] ? x - box[offset + 3] : 0;
  const dy = y < box[offset + 1] ? box[offset + 1] - y : y > box[offset + 4] ? y - box[offset + 4] : 0;
  const dz = z < box[offset + 2] ? box[offset + 2] - z : z > box[offset + 5] ? z - box[offset + 5] : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Focal length in pixels per radian from a column-major projection matrix
 * (P[5] is 1/tan(vertical half-angle) for a perspective camera) and the
 * drawing-buffer height. Orthographic or degenerate inputs return 0. */
export function ealdholtProjectionFocalPixels(projection: ArrayLike<number>, drawingBufferHeight: number): number {
  if (!projection || projection.length < 16 || projection[15] !== 0 || projection[11] === 0) return 0;
  const focal = Math.abs(projection[5]) * drawingBufferHeight / 2;
  return Number.isFinite(focal) && focal > 0 ? focal : 0;
}

// ---------------------------------------------------------------- headroom

export interface EaldholtInstanceCellHeadroom {
  /** Current share for the active tier. */
  readonly share: EaldholtInstanceCellBudget;
  /** Largest measured base (scene minus cells) over the recent frames. */
  readonly base: EaldholtInstanceCellBudget;
  readonly observations: number;
  /** The base alone exceeded the reserved total in a recent frame. */
  readonly overBudget: boolean;
  setTier(tier: EaldholtFoliageQuality): boolean;
  /** Feeds one rendered frame: its whole-scene counts and the cells' own part
   * of them. Returns true when the share changed. Allocation-free. */
  observe(calls: number, triangles: number, ownDraws: number, ownTriangles: number): boolean;
}

/** Headroom-derived share: clamp(total x (1 - reserve) - worst recent base, floor, cap).
 * It shrinks at once when the scene grows and grows only past a hysteresis. */
export function createEaldholtInstanceCellHeadroom(policy: EaldholtInstanceCellHeadroomPolicy, caps: EaldholtInstanceCellBudgets, quality: EaldholtFoliageQuality): EaldholtInstanceCellHeadroom {
  assertEaldholtFoliageQuality(quality);
  if (!Number.isSafeInteger(policy.window) || policy.window < 1 || policy.window > 1024) throw new RangeError('Headroom window must be 1-1024 frames.');
  if (!Number.isFinite(policy.reserve) || policy.reserve < 0 || policy.reserve > .5) throw new RangeError('Headroom reserve must be 0-0.5.');
  if (!Number.isFinite(policy.growHysteresis) || policy.growHysteresis < 0 || policy.growHysteresis > 1) throw new RangeError('Headroom hysteresis must be 0-1.');
  for (const tier of QUALITIES) for (const item of [policy.totals[tier], policy.floor[tier], caps[tier]])
    if (!item || !(item.draws >= 0) || !(item.triangles >= 0)) throw new RangeError('Headroom budgets must be nonnegative.');
  const draws = new Float64Array(policy.window), tris = new Float64Array(policy.window);
  let tier = quality, head = 0, filled = 0, observations = 0, overBudget = false;
  const share = { draws: policy.floor[tier].draws, triangles: policy.floor[tier].triangles }, base = { draws: 0, triangles: 0 };
  /** Shrink at once (the rest of the scene grew); grow only past the hysteresis or to the cap. */
  function accept(next: number, current: number, capValue: number): boolean {
    return next < current || (next > current && (current === 0 || next >= current * (1 + policy.growHysteresis) || next === capValue));
  }
  function recompute(): boolean {
    let maxDraws = 0, maxTris = 0;
    for (let i = 0; i < filled; i++) { if (draws[i] > maxDraws) maxDraws = draws[i]; if (tris[i] > maxTris) maxTris = tris[i]; }
    base.draws = maxDraws; base.triangles = maxTris;
    const total = policy.totals[tier], floor = policy.floor[tier], cap = caps[tier];
    const freeDraws = total.draws * (1 - policy.reserve) - maxDraws, freeTris = total.triangles * (1 - policy.reserve) - maxTris;
    overBudget = freeDraws < 0 || freeTris < 0;
    let nextDraws = Math.floor(Math.min(cap.draws, Math.max(floor.draws, freeDraws))), nextTris = Math.floor(Math.min(cap.triangles, Math.max(floor.triangles, freeTris)));
    // A share with no draws or no triangles can draw nothing: report it as zero.
    if (nextDraws === 0 || nextTris === 0) { nextDraws = 0; nextTris = 0; }
    let changed = false;
    if (accept(nextDraws, share.draws, cap.draws)) { share.draws = nextDraws; changed = true; }
    if (accept(nextTris, share.triangles, cap.triangles)) { share.triangles = nextTris; changed = true; }
    return changed;
  }
  return {
    share, base, get observations() { return observations; }, get overBudget() { return overBudget; },
    setTier(next) {
      assertEaldholtFoliageQuality(next);
      if (next === tier) return false;
      tier = next; share.draws = policy.floor[tier].draws; share.triangles = policy.floor[tier].triangles;
      if (filled) recompute();
      return true;
    },
    observe(calls, triangles, ownDraws, ownTriangles) {
      if (![calls, triangles, ownDraws, ownTriangles].every(value => Number.isFinite(value) && value >= 0)) return false;
      draws[head] = Math.max(0, calls - ownDraws); tris[head] = Math.max(0, triangles - ownTriangles);
      head = (head + 1) % policy.window; if (filled < policy.window) filled++;
      observations++;
      return recompute();
    },
  };
}

// ---------------------------------------------------------------- selector

/** Per-layer shader state, `EALDHOLT_INSTANCE_CELL_STATE_STRIDE` floats per
 * layer in `selector.layerState`, laid out for direct use as uniforms. */
export const EALDHOLT_INSTANCE_CELL_STATE = Object.freeze({
  /** vec4: camera x, y, z in layer-local units; effective distance scale. */
  eye: 0,
  /** vec4: 1 / HIGH tier count, fade fraction, widening clamp, height gain. */
  shape: 4,
  /** vec2: reach-fade start and reach, effective metres. */
  reach: 8,
  /** float[8]: band outer edges, effective metres (padded geometrically). */
  knotDistances: 10,
  /** float[8]: tier-applied density knots (padded with the last value). */
  knotDensities: 18,
});
export const EALDHOLT_INSTANCE_CELL_STATE_STRIDE = 26;
export const EALDHOLT_INSTANCE_CELL_MAX_KNOTS = 8;

export interface EaldholtInstanceCellDiagnostics {
  tier: EaldholtFoliageQuality;
  updates: number;
  skipped: number;
  visibleCells: number;
  /** Cells refined into their children this update. */
  splitCells: number;
  drawCalls: number;
  triangles: number;
  instances: number;
  frustumCulled: number;
  distanceCulled: number;
  /** Cells dropped entirely by the share (only roots can be dropped). */
  budgetCulled: number;
  /** Cells drawn coarser than their distance asks because a split did not fit. */
  coarsenedCells: number;
  /** Admissions and splits refused by the share this update. */
  refusedSplits: number;
  /** Root admissions and splits inside the nearest band, made regardless of the share. */
  mandatoryCells: number;
  /** Cost of the base coverage: mandatory near-field work plus every in-view root.
   * A share below it must drop the farthest roots; above it, the share only coarsens. */
  baseDraws: number;
  baseTriangles: number;
  /** Triangles above the share, when mandatory near work or base coverage exceeds it (never a hole). */
  overShareTriangles: number;
  /** Current adaptive gain on the far density knots (1 when fixed). */
  densityGain: number;
  /** The gain is still moving toward its target: on-demand callers should render again. */
  settling: boolean;
  emptyTierCells: number;
  changedCells: number;
  /** Effective distance scale: nominal focal / (actual focal x tier scale). */
  distanceScale: number;
  shareDraws: number;
  shareTriangles: number;
  /** Last update's admission cutoff rank (Infinity when the share did not bind). */
  cutoffRank: number;
}
export interface EaldholtInstanceCellSelector {
  readonly index: EaldholtInstanceCellIndex;
  /** Per cell: LOD to draw, or -1 when hidden (refined, culled, empty or over budget). */
  readonly lod: Int16Array;
  /** Per cell: instances to submit (a conservative prefix of the cell's stored priority order). */
  readonly count: Uint32Array;
  /** Per cell hysteresis state: band, band count when beyond range, -2 before first visit. */
  readonly band: Int16Array;
  /** Per cell distance state: 1 wants to split, 0 not, -2 before first visit (level 0 never splits). */
  readonly split: Int8Array;
  /** Per cell: 1 when the cell was refined into its children this update. */
  readonly refined: Uint8Array;
  /** Cells whose LOD or count changed in the last update: entries [0, changedCount). */
  readonly changed: Uint32Array;
  readonly changedCount: number;
  /** Uniform-ready per-layer shader state (see EALDHOLT_INSTANCE_CELL_STATE). */
  readonly layerState: Float32Array;
  /** Per layer, tier count / HIGH count for the current tier. */
  readonly tierFactors: Float64Array;
  readonly diagnostics: Readonly<EaldholtInstanceCellDiagnostics>;
  readonly tier: EaldholtFoliageQuality;
  setTier(tier: EaldholtFoliageQuality): boolean;
  /** Replaces the current share (e.g. from createEaldholtInstanceCellHeadroom); the
   * selector then stops following the tier caps. */
  setShare(draws: number, triangles: number): boolean;
  setFrustumMargin(margin: number): boolean;
  /** Forces the next update to reselect even if the view is unchanged. */
  invalidate(): void;
  /** Camera position in layer-local units, the clip-from-local matrix and the
   * focal correction (nominal focal / actual focal; 1 when unknown). Returns changedCount. */
  update(cameraX: number, cameraY: number, cameraZ: number, clipFromLocal: ArrayLike<number>, focalScale?: number): number;
}

const UNSET = -2;
/** Separates the admission classes in the priority key; ranks stay far below it. */
const CLASS_STEP = 1e9;
/** Updates a cell merged or dropped by the share waits before it may return as a newcomer. */
const DWELL = 12;
/** Extra CPU instances beyond the shader-visible set: float32 headroom plus a quantum. */
const COUNT_SLACK = 1.02, COUNT_GROW = 1.1, COUNT_SHRINK = .85;
/** Adaptive density gain. It holds while the drawn triangles sit inside [GAIN_HOLD_LOW, 1] of the
 * share. Outside, it steers toward GAIN_TARGET by at most GAIN_DOWN / GAIN_UP (relative) per update
 * until the triangles are back inside [GAIN_REACH_LOW, GAIN_REACH_HIGH]. Every change moves the far
 * threshold and widening of every far instance at once, so changes stay rare and small. */
const GAIN_HOLD_LOW = .84, GAIN_REACH_LOW = .88, GAIN_TARGET = .92, GAIN_REACH_HIGH = .96, GAIN_DOWN = .01, GAIN_UP = .005;

export function createEaldholtInstanceCellSelector(index: EaldholtInstanceCellIndex, options: { quality: EaldholtFoliageQuality; share?: EaldholtInstanceCellBudget }): EaldholtInstanceCellSelector {
  assertEaldholtFoliageQuality(options.quality);
  const n = index.cellCount, layerCount = index.layers.length;
  // Flattened per-layer tables: no lookups through objects in the frame loop.
  const bandStart = new Uint16Array(layerCount + 1), hysteresis = new Float64Array(layerCount), inverseSize = new Float64Array(layerCount), nearRadius = new Float64Array(layerCount);
  const lodStart = new Uint16Array(layerCount + 1), lodCount = new Uint16Array(layerCount), highCount = new Float64Array(layerCount);
  let bands = 0, lodsTotal = 0;
  for (let l = 0; l < layerCount; l++) {
    bandStart[l] = bands; bands += index.layers[l].settings.bandDistances.length;
    lodStart[l] = lodsTotal; lodsTotal += index.layers[l].lods.length;
    if (index.layers[l].settings.bandDistances.length > EALDHOLT_INSTANCE_CELL_MAX_KNOTS) throw RangeError('Too many bands for the shader state.');
  }
  bandStart[layerCount] = bands; lodStart[layerCount] = lodsTotal;
  const bandOuter = new Float64Array(bands), bandLod = new Uint16Array(bands), levelCap = new Float64Array(bands), knotDensity = new Float64Array(bands * 3);
  const lodTriangles = new Float64Array(lodsTotal), lodDraws = new Float64Array(lodsTotal);
  const tierFactors = new Float64Array(layerCount), tierFactorsAll = new Float64Array(layerCount * 3), liftFrom = new Float64Array(layerCount);
  const layerState = new Float32Array(layerCount * EALDHOLT_INSTANCE_CELL_STATE_STRIDE), S = EALDHOLT_INSTANCE_CELL_STATE, STRIDE = EALDHOLT_INSTANCE_CELL_STATE_STRIDE;
  for (let l = 0; l < layerCount; l++) {
    const layer = index.layers[l], s = layer.settings, start = bandStart[l], k = s.bandDistances.length;
    hysteresis[l] = s.hysteresis; inverseSize[l] = 1 / s.nominalSize; lodCount[l] = layer.lods.length; highCount[l] = layer.tiers.high; liftFrom[l] = 1 - Math.max(s.fade, 1e-3);
    nearRadius[l] = s.nearFieldGuarantee ? s.bandDistances[0] : -1;
    const counts = [layer.tiers.low, layer.tiers.medium, layer.tiers.high];
    for (let t = 0; t < 3; t++) tierFactorsAll[l * 3 + t] = layer.tiers.high > 0 ? counts[t] / layer.tiers.high : 0;
    for (let b = 0; b < k; b++) {
      bandOuter[start + b] = s.bandDistances[b]; bandLod[start + b] = s.bandLods[b]; levelCap[start + b] = s.levelCaps[b];
      for (let t = 0; t < 3; t++) {
        const factor = tierFactorsAll[l * 3 + t];
        knotDensity[(start + b) * 3 + t] = !(factor > 0) ? 1e-6 : b === 0 ? 1 : Math.max(1e-6, s.bandDensities[b] * Math.min(1, factor));
      }
    }
    for (let j = 0; j < layer.lods.length; j++) { lodTriangles[lodStart[l] + j] = layer.lods[j].triangles; lodDraws[lodStart[l] + j] = layer.lods[j].draws; }
    const o = l * STRIDE;
    layerState[o + S.shape] = layer.tiers.high > 0 ? 1 / layer.tiers.high : 0; layerState[o + S.shape + 1] = s.fade;
    layerState[o + S.shape + 2] = s.widenMax; layerState[o + S.shape + 3] = s.heightGain;
    layerState[o + S.reach] = s.reachStart; layerState[o + S.reach + 1] = s.reach;
    for (let j = 0; j < EALDHOLT_INSTANCE_CELL_MAX_KNOTS; j++) layerState[o + S.knotDistances + j] = j < k ? s.bandDistances[j] : s.bandDistances[k - 1] * 2 ** (j - k + 1);
  }
  const lod = new Int16Array(n).fill(-1), count = new Uint32Array(n), state = new Int16Array(n).fill(UNSET), split = new Int8Array(n).fill(UNSET);
  const refined = new Uint8Array(n), prevRefined = new Uint8Array(n), drawn = new Uint8Array(n), prevDrawn = new Uint8Array(n), flags = new Uint8Array(n);
  const changed = new Uint32Array(n), distance = new Float64Array(n), rank = new Float64Array(n), want = new Uint32Array(n), cost = new Float64Array(n), tris = new Float64Array(n);
  // Update count before which a cell the share merged or dropped may not return as a newcomer.
  const dwell = new Float64Array(n);
  const heap = new Int32Array(n * 2), heapKey = new Float64Array(n * 2), pending = new Uint8Array(n), roots = new Uint32Array(index.layers.reduce((sum, layer) => sum + layer.roots, 0));
  const planes = new Float64Array(24), lastView = new Float64Array(20);
  { let r = 0; for (const layer of index.layers) for (let c = layer.firstCell; c < layer.firstCell + layer.roots; c++) roots[r++] = c; }
  let tier: EaldholtFoliageQuality = options.quality, tierIndex = tierIndexOf(tier), frustumMargin = index.frustumMargin, lodBias = index.tierLodBias[tier];
  const shareNow = { draws: options.share?.draws ?? index.budgets[tier].draws, triangles: options.share?.triangles ?? index.budgets[tier].triangles };
  // Without an explicit share the selector follows the active tier's cap.
  let followTier = options.share === undefined;
  if (!(shareNow.draws >= 0) || !(shareNow.triangles >= 0)) throw new RangeError('Instance cell share must be nonnegative.');
  const diagnostics: EaldholtInstanceCellDiagnostics = { tier, updates: 0, skipped: 0, visibleCells: 0, splitCells: 0, drawCalls: 0, triangles: 0, instances: 0,
    frustumCulled: 0, distanceCulled: 0, budgetCulled: 0, coarsenedCells: 0, refusedSplits: 0, mandatoryCells: 0, baseDraws: 0, baseTriangles: 0, overShareTriangles: 0, densityGain: 1, settling: false, emptyTierCells: 0, changedCells: 0, distanceScale: 1,
    shareDraws: shareNow.draws, shareTriangles: shareNow.triangles, cutoffRank: Infinity };
  // Last update's admission cutoffs, per class: roots (base coverage) and optional splits.
  let dirty = true, changedCount = 0, cutoff = Infinity, rootCutoff = Infinity, heapSize = 0;
  const hb = index.admissionHysteresis;

  // Live knots: the tier's knots with the adaptive gain on every band but the nearest.
  const knotLive = new Float64Array(bands), adaptive = index.adaptiveDensity;
  let gain = 1, pendingGain = 1, seeking = false;
  function applyTierState(): void {
    for (let l = 0; l < layerCount; l++) {
      tierFactors[l] = tierFactorsAll[l * 3 + tierIndex];
      const o = l * STRIDE, start = bandStart[l], k = bandStart[l + 1] - start;
      for (let b = 0; b < k; b++) {
        const base = knotDensity[(start + b) * 3 + tierIndex];
        knotLive[start + b] = b === 0 ? base : Math.min(1, Math.max(1e-6, base * gain));
      }
      for (let j = 0; j < EALDHOLT_INSTANCE_CELL_MAX_KNOTS; j++) layerState[o + S.knotDensities + j] = knotLive[start + Math.min(j, k - 1)];
    }
  }
  applyTierState();

  function density(l: number, d: number): number {
    const start = bandStart[l], k = bandStart[l + 1] - start;
    let rho = knotLive[start];
    for (let i = 1; i < k; i++) {
      const d0 = bandOuter[start + i - 1];
      if (d > d0) {
        const t = Math.min(1, Math.max(0, Math.log(d / d0) / Math.log(bandOuter[start + i] / d0))), r0 = knotLive[start + i - 1];
        rho = r0 * Math.pow(knotLive[start + i] / r0, t);
      }
    }
    return rho;
  }
  /** Stored instances of a cell with rank below `threshold` (binary search). */
  function countBelow(c: number, threshold: number): number {
    let lo = index.cellStart[c], hi = lo + index.cellInstances[c];
    const start = lo;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (index.order[mid] < threshold) lo = mid + 1; else hi = mid; }
    return lo - start;
  }
  /** Min-heap of (key, cell) entries; ties break by cell index. */
  function heapLess(i: number, j: number): boolean { return heapKey[i] < heapKey[j] || (heapKey[i] === heapKey[j] && heap[i] < heap[j]); }
  function heapSwap(i: number, j: number): void {
    const c = heap[i]; heap[i] = heap[j]; heap[j] = c;
    const k = heapKey[i]; heapKey[i] = heapKey[j]; heapKey[j] = k;
  }
  function heapPush(c: number, key: number): void {
    let i = heapSize++;
    heap[i] = c; heapKey[i] = key;
    while (i > 0) { const p = (i - 1) >> 1; if (!heapLess(i, p)) break; heapSwap(i, p); i = p; }
  }
  function heapPop(): number {
    const top = heap[0];
    heapSize--;
    if (heapSize > 0) {
      heap[0] = heap[heapSize]; heapKey[0] = heapKey[heapSize];
      let i = 0;
      for (;;) {
        const a = i * 2 + 1, b = a + 1;
        let m = i;
        if (a < heapSize && heapLess(a, m)) m = a;
        if (b < heapSize && heapLess(b, m)) m = b;
        if (m === i) break;
        heapSwap(i, m); i = m;
      }
    }
    return top;
  }
  function sameView(x: number, y: number, z: number, m: ArrayLike<number>, scale: number): boolean {
    if (lastView[16] !== x || lastView[17] !== y || lastView[18] !== z || lastView[19] !== scale) return false;
    for (let k = 0; k < 16; k++) if (lastView[k] !== m[k]) return false;
    return true;
  }

  return {
    index, lod, count, band: state, split, refined, changed, layerState, tierFactors, diagnostics,
    get changedCount() { return changedCount; },
    get tier() { return tier; },
    setTier(next) {
      assertEaldholtFoliageQuality(next);
      if (next === tier) return false;
      tier = next; tierIndex = tierIndexOf(next); lodBias = index.tierLodBias[tier]; diagnostics.tier = next; applyTierState(); dirty = true;
      if (followTier) {
        shareNow.draws = index.budgets[tier].draws; shareNow.triangles = index.budgets[tier].triangles;
        diagnostics.shareDraws = shareNow.draws; diagnostics.shareTriangles = shareNow.triangles;
      }
      return true;
    },
    setShare(draws, triangles) {
      if (!Number.isFinite(draws) || draws < 0 || !Number.isFinite(triangles) || triangles < 0) throw new RangeError('Instance cell share must be nonnegative and finite.');
      followTier = false;
      if (draws === shareNow.draws && triangles === shareNow.triangles) return false;
      shareNow.draws = draws; shareNow.triangles = triangles; diagnostics.shareDraws = draws; diagnostics.shareTriangles = triangles; dirty = true;
      return true;
    },
    setFrustumMargin(margin) {
      if (!Number.isFinite(margin) || margin < 0) throw new RangeError('Instance cell frustum margin must be nonnegative.');
      if (margin === frustumMargin) return false;
      frustumMargin = margin; dirty = true;
      return true;
    },
    invalidate() { dirty = true; },
    update(x, y, z, m, focalScale = 1) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !m || m.length < 16) throw new RangeError('Instance cell view must be finite.');
      const scale = (Number.isFinite(focalScale) && focalScale > 0 ? focalScale : 1) / index.tierScale[tier];
      // The gain chosen after the last selection applies now, so counts and uniforms always agree.
      if (pendingGain !== gain) { gain = pendingGain; applyTierState(); dirty = true; }
      if (!dirty && sameView(x, y, z, m, scale)) { diagnostics.skipped++; changedCount = 0; diagnostics.changedCells = 0; return 0; }
      for (let k = 0; k < 16; k++) { if (!Number.isFinite(m[k])) throw new RangeError('Instance cell clip matrix must be finite.'); lastView[k] = m[k]; }
      lastView[16] = x; lastView[17] = y; lastView[18] = z; lastView[19] = scale;
      extractEaldholtFrustumPlanes(m, planes);
      for (let l = 0; l < layerCount; l++) { const o = l * STRIDE; layerState[o] = x; layerState[o + 1] = y; layerState[o + 2] = z; layerState[o + 3] = scale; }
      // Phase A: distance state, band/split Schmitt triggers, conservative counts and costs for every cell.
      for (let c = 0; c < n; c++) {
        const l = index.cellLayer[c], level = index.cellLevel[c], start = bandStart[l], last = bandStart[l + 1] - start, h = hysteresis[l];
        const d = ealdholtAabbDistance(index.cellBounds, c * 6, x, y, z) * scale;
        distance[c] = d;
        if (level > 0) {
          const edge = bandOuter[start + level - 1];
          let s = split[c];
          if (s === UNSET) s = d < edge ? 1 : 0;
          else if (s === 1 && d > edge * (1 + h)) s = 0;
          else if (s === 0 && d < edge * (1 - h)) s = 1;
          split[c] = s;
        }
        let b = state[c];
        if (b === UNSET) { b = level; while (b < last && d >= bandOuter[start + b]) b++; }
        else {
          if (b < level) b = level;
          while (b < last && d > bandOuter[start + b] * (1 + h)) b++;
          while (b > level && d < bandOuter[start + b - 1] * (1 - h)) b--;
        }
        state[c] = b;
        let f = 0, next = 0;
        cost[c] = 0; tris[c] = 0;
        if (b < last) {
          f = 1;
          if (ealdholtAabbInFrustum(planes, index.cellBounds, c * 6, frustumMargin)) {
            f = 3;
            const rho = tierFactors[l] > 0 ? Math.min(density(l, d), levelCap[start + level]) : 0;
            // Inside the lift (density near 1) every stored instance can be visible.
            const needed = rho > 0 ? (rho > liftFrom[l] ? index.cellInstances[c] : countBelow(c, rho * COUNT_SLACK * highCount[l] + 1)) : 0;
            const current = prevDrawn[c] ? count[c] : 0;
            next = needed === 0 ? 0 : current > 0 && needed <= current && needed >= current * COUNT_SHRINK ? current
              : Math.min(index.cellInstances[c], Math.ceil(needed * COUNT_GROW));
            if (next > 0) {
              const chosen = Math.min(bandLod[start + b] + lodBias, lodCount[l] - 1), j = lodStart[l] + chosen;
              cost[c] = lodDraws[j]; tris[c] = next * lodTriangles[j];
            }
          }
        }
        flags[c] = f; want[c] = next;
        // Projected size; ground inside the nearest band refines before distant rocks.
        rank[c] = d * inverseSize[l] * (d < bandOuter[start] ? .25 : 1);
        drawn[c] = 0; refined[c] = 0;
      }
      let draws = 0, triangles = 0, frustumCulled = 0, distanceCulled = 0, budgetCulled = 0, empty = 0, coarsened = 0, refused = 0, splits = 0, mandatory = 0;
      // Cost of the base coverage (mandatory near work plus every in-view root), admitted or not.
      let baseDraws = 0, baseTriangles = 0, mandatoryTriangles = 0;
      // Phases B and C share one priority queue keyed by (class, projected size).
      // Class 0: groundcover work inside the nearest band, mandatory (nothing near
      // the camera is bald or left coarse). Class 1: every other root, the base coverage, so
      // the share coarsens instead of dropping. Class 2: optional refinement.
      // Classes 1 and 2 compete for the share; last frame's admissions are kept
      // inside the hysteresis band.
      heapSize = 0;
      // A zero share (e.g. headroom on an over-budget Native scene) draws nothing at all.
      const enabled = shareNow.draws > 0 && shareNow.triangles > 0;
      for (let i = 0; i < roots.length; i++) {
        const c = roots[i];
        if (!(flags[c] & 1)) { distanceCulled++; continue; }
        if (!(flags[c] & 2)) { frustumCulled++; continue; }
        if (!enabled) { budgetCulled++; continue; }
        pending[c] = 1; heapPush(c, rank[c] + (distance[c] < nearRadius[index.cellLayer[c]] ? 0 : CLASS_STEP));
      }
      let binding = false, stop = false, lastRank = 0, rootBinding = false, rootStop = false, lastRootRank = 0;
      while (heapSize > 0) {
        const c = heapPop(), near = distance[c] < nearRadius[index.cellLayer[c]];
        if (pending[c]) {
          pending[c] = 0;
          const incumbent = prevDrawn[c] === 1 || prevRefined[c] === 1, room = incumbent ? 1 : 1 - hb;
          baseDraws += cost[c]; baseTriangles += tris[c];
          if (near) { mandatory++; mandatoryTriangles += tris[c]; }
          else {
            // Incumbents stay while they fit the whole share; newcomers wait inside last frame's cutoff and reserve.
            const allowed = incumbent || (!rootStop && rank[c] <= rootCutoff * (1 - hb) && diagnostics.updates >= dwell[c]);
            if (!allowed) { budgetCulled++; continue; }
            // Base coverage is limited by draws only: refusing a root for triangles would
            // leave a hole, and refinement below usually lowers a coarse root's triangles.
            if (draws + cost[c] > shareNow.draws * room) {
              budgetCulled++; rootBinding = true; rootStop = true; refused++;
              if (incumbent) dwell[c] = diagnostics.updates + DWELL;
              continue;
            }
            if (rank[c] > lastRootRank) lastRootRank = rank[c];
          }
          if (cost[c] > 0) { drawn[c] = 1; draws += cost[c]; triangles += tris[c]; } else empty++;
          if (split[c] === 1) heapPush(c, rank[c] + (near ? 0 : 2 * CLASS_STEP));
          continue;
        }
        const first = index.cellChildStart[c], end = first + index.cellChildCount[c];
        let extraDraws = drawn[c] ? -cost[c] : 0, extraTris = drawn[c] ? -tris[c] : 0;
        for (let k = first; k < end; k++) if (flags[k] === 3) { extraDraws += cost[k]; extraTris += tris[k]; }
        if (near) { mandatory++; baseDraws += extraDraws; baseTriangles += extraTris; mandatoryTriangles += extraTris; }
        else {
          // Newcomers may fill only (1 - h) of the share; the rest is kept for incumbents.
          const incumbent = prevRefined[c] === 1, room = incumbent ? 1 : 1 - hb;
          const allowed = incumbent || (!stop && rank[c] <= cutoff * (1 - hb) && diagnostics.updates >= dwell[c]);
          // A split that lowers triangles (a coarse cell near the camera) only needs the draws;
          // an incumbent keeps that exemption within a small margin, so the sign test has hysteresis too.
          const fits = draws + extraDraws <= shareNow.draws * room
            && (extraTris <= (incumbent ? tris[c] * hb : 0) || triangles + extraTris <= shareNow.triangles * room);
          if (!allowed || !fits) {
            if (!fits) { binding = true; stop = true; refused++; if (incumbent) dwell[c] = diagnostics.updates + DWELL; }
            if (drawn[c]) coarsened++;
            continue;
          }
          if (rank[c] > lastRank) lastRank = rank[c];
        }
        refined[c] = 1; splits++;
        if (drawn[c]) drawn[c] = 0;
        draws += extraDraws; triangles += extraTris;
        for (let k = first; k < end; k++) {
          if (!(flags[k] & 1)) { distanceCulled++; continue; }
          if (!(flags[k] & 2)) { frustumCulled++; continue; }
          if (cost[k] > 0) drawn[k] = 1; else empty++;
          if (split[k] === 1) heapPush(k, rank[k] + (distance[k] < nearRadius[index.cellLayer[k]] ? 0 : 2 * CLASS_STEP));
        }
      }
      cutoff = binding ? lastRank : Infinity; rootCutoff = rootBinding ? lastRootRank : Infinity;
      // Phase D: outputs.
      let instances = 0, visible = 0;
      changedCount = 0;
      for (let c = 0; c < n; c++) {
        let nextLod = -1, nextCount = 0;
        if (drawn[c]) {
          const l = index.cellLayer[c];
          nextLod = Math.min(bandLod[bandStart[l] + state[c]] + lodBias, lodCount[l] - 1); nextCount = want[c];
          instances += nextCount; visible++;
        }
        if (lod[c] !== nextLod || count[c] !== nextCount) { lod[c] = nextLod; count[c] = nextCount; changed[changedCount++] = c; }
      }
      prevDrawn.set(drawn); prevRefined.set(refined);
      // Budget-adaptive density: hold the far gain while the drawn triangles sit inside the hold band;
      // once they leave it, steer toward the target in small relative steps until it is met. The
      // new gain takes effect at the next update, so counts and uniforms always agree.
      let settling = false;
      if (adaptive && enabled) {
        const share = shareNow.triangles, far = triangles - mandatoryTriangles;
        if (triangles > share || (triangles < share * GAIN_HOLD_LOW && gain < adaptive.max)) seeking = true;
        if (seeking) {
          let desired = adaptive.max;
          if (far > 0) desired = gain * Math.max(0, share * GAIN_TARGET - mandatoryTriangles) / far;
          desired = Math.min(adaptive.max, Math.max(adaptive.min, desired));
          const over = triangles > share * GAIN_REACH_HIGH, under = triangles < share * GAIN_REACH_LOW;
          // Over the share the gain only falls, under it only rises; it stops once the triangles are back
          // near the target or the gain sits on its bound.
          const next = over ? Math.max(gain * (1 - GAIN_DOWN), Math.min(desired, gain)) : under ? Math.min(gain * (1 + GAIN_UP), Math.max(desired, gain)) : gain;
          if (next === gain) seeking = false;
          else { pendingGain = next; dirty = true; }
        }
        settling = seeking;
      }
      diagnostics.densityGain = gain; diagnostics.settling = settling;
      diagnostics.updates++; diagnostics.visibleCells = visible; diagnostics.splitCells = splits; diagnostics.drawCalls = draws; diagnostics.triangles = triangles;
      diagnostics.instances = instances; diagnostics.frustumCulled = frustumCulled; diagnostics.distanceCulled = distanceCulled; diagnostics.budgetCulled = budgetCulled;
      diagnostics.coarsenedCells = coarsened; diagnostics.refusedSplits = refused; diagnostics.emptyTierCells = empty; diagnostics.changedCells = changedCount;
      diagnostics.mandatoryCells = mandatory; diagnostics.baseDraws = baseDraws; diagnostics.baseTriangles = baseTriangles;
      diagnostics.overShareTriangles = Math.max(0, triangles - shareNow.triangles);
      diagnostics.distanceScale = scale; diagnostics.cutoffRank = cutoff;
      dirty = false;
      return changedCount;
    },
  };
}

// ---------------------------------------------------------------- shader

/** Per-instance attribute: x = global priority rank, y = the stored fraction of
 * the cell's level (instances above it are absent from coarse cells). */
export const EALDHOLT_INSTANCE_CELL_ATTRIBUTE = 'ealdholtCell';
export const EALDHOLT_INSTANCE_CELL_SHADER_KEY = ':ealdholt-instance-cells:v2';
export interface EaldholtInstanceCellUniforms {
  readonly uEaldholtCellEye: { value: Float32Array };
  readonly uEaldholtCellShape: { value: Float32Array };
  readonly uEaldholtCellReach: { value: Float32Array };
  readonly uEaldholtCellKnotD: { value: Float32Array };
  readonly uEaldholtCellKnotR: { value: Float32Array };
}
export interface EaldholtInstanceCellShader { vertexShader: string; uniforms: Record<string, { value: unknown }> }

/** Uniform objects for one layer whose values are live views of the
 * selector's layer state: update() refreshes them without allocation. Share
 * one object between every material of a layer (including its clones). */
export function createEaldholtInstanceCellUniforms(selector: EaldholtInstanceCellSelector, layer: number): EaldholtInstanceCellUniforms {
  if (!Number.isInteger(layer) || layer < 0 || layer >= selector.index.layers.length) throw new RangeError('Instance cell layer index is out of range.');
  const s = selector.layerState, o = layer * EALDHOLT_INSTANCE_CELL_STATE_STRIDE, S = EALDHOLT_INSTANCE_CELL_STATE;
  return Object.freeze({
    uEaldholtCellEye: { value: s.subarray(o + S.eye, o + S.eye + 4) },
    uEaldholtCellShape: { value: s.subarray(o + S.shape, o + S.shape + 4) },
    uEaldholtCellReach: { value: s.subarray(o + S.reach, o + S.reach + 2) },
    uEaldholtCellKnotD: { value: s.subarray(o + S.knotDistances, o + S.knotDistances + EALDHOLT_INSTANCE_CELL_MAX_KNOTS) },
    uEaldholtCellKnotR: { value: s.subarray(o + S.knotDensities, o + S.knotDensities + EALDHOLT_INSTANCE_CELL_MAX_KNOTS) },
  });
}

const CELL_DECLARATIONS = `#include <common>
#ifdef USE_INSTANCING
#define CROWNFALL_INSTANCE_CELLS
attribute vec2 ${EALDHOLT_INSTANCE_CELL_ATTRIBUTE};
uniform vec4 uEaldholtCellEye;
uniform vec4 uEaldholtCellShape;
uniform vec2 uEaldholtCellReach;
uniform float uEaldholtCellKnotD[ ${EALDHOLT_INSTANCE_CELL_MAX_KNOTS} ];
uniform float uEaldholtCellKnotR[ ${EALDHOLT_INSTANCE_CELL_MAX_KNOTS} ];
float ealdholtCellDensity( float d ) {
	float rho = uEaldholtCellKnotR[ 0 ];
	for ( int i = 1; i < ${EALDHOLT_INSTANCE_CELL_MAX_KNOTS}; i ++ ) {
		float d0 = uEaldholtCellKnotD[ i - 1 ];
		if ( d > d0 ) {
			float t = clamp( log( d / d0 ) / log( uEaldholtCellKnotD[ i ] / d0 ), 0.0, 1.0 );
			rho = uEaldholtCellKnotR[ i - 1 ] * pow( uEaldholtCellKnotR[ i ] / uEaldholtCellKnotR[ i - 1 ], t );
		}
	}
	return rho;
}
// xyz: per-axis instance scale (widened survivors, zero when thinned out).
vec3 ealdholtCellScale() {
	float d = distance( instanceMatrix[ 3 ].xyz, uEaldholtCellEye.xyz ) * uEaldholtCellEye.w;
	float rho = min( ealdholtCellDensity( d ), ${EALDHOLT_INSTANCE_CELL_ATTRIBUTE}.y );
	float u = ( ${EALDHOLT_INSTANCE_CELL_ATTRIBUTE}.x + 0.5 ) * uEaldholtCellShape.x;
	float t = clamp( ( rho - u ) / max( rho * uEaldholtCellShape.y, 1e-6 ), 0.0, 1.0 );
	float fade = t * t * ( 3.0 - 2.0 * t );
	// As density reaches 1 the fade lifts to full size, so a full-density band draws every instance.
	fade = mix( fade, 1.0, smoothstep( 1.0 - max( uEaldholtCellShape.y, 1e-3 ), 1.0, rho ) );
	float widen = clamp( inversesqrt( max( rho, 1e-4 ) ), 1.0, uEaldholtCellShape.z );
	// Every survivor shrinks smoothly to nothing over the last stretch of the reach.
	float reach = 1.0 - smoothstep( uEaldholtCellReach.x, uEaldholtCellReach.y, d );
	return vec3( widen, 1.0 + ( widen - 1.0 ) * uEaldholtCellShape.w, widen ) * ( fade * reach );
}
#endif`;
const CELL_TRANSFORM = `#include <begin_vertex>
#ifdef CROWNFALL_INSTANCE_CELLS
	transformed *= ealdholtCellScale();
#endif`;
const CELL_NORMAL = `#include <beginnormal_vertex>
#ifdef CROWNFALL_INSTANCE_CELLS
	{
		// Inverse-transpose of diag(w, h, w) up to scale; renormalized downstream.
		vec3 cellScale = ealdholtCellScale();
		objectNormal *= vec3( cellScale.y, cellScale.x, cellScale.y );
	}
#endif`;

/** Injects continuous per-instance thinning and widening into a standard
 * three/IWSDK vertex shader (lit, basic or depth). Instancing only; no alpha
 * discard, so early depth testing survives. Idempotent. */
export function patchEaldholtInstanceCellShader(shader: EaldholtInstanceCellShader, uniforms: EaldholtInstanceCellUniforms): void {
  if (shader.vertexShader.includes('CROWNFALL_INSTANCE_CELLS')) return;
  if (!shader.vertexShader.includes('#include <common>') || !shader.vertexShader.includes('#include <begin_vertex>'))
    throw Error('Instance cell thinning requires the standard common and begin_vertex chunks.');
  shader.uniforms.uEaldholtCellEye = uniforms.uEaldholtCellEye;
  shader.uniforms.uEaldholtCellShape = uniforms.uEaldholtCellShape;
  shader.uniforms.uEaldholtCellReach = uniforms.uEaldholtCellReach;
  shader.uniforms.uEaldholtCellKnotD = uniforms.uEaldholtCellKnotD;
  shader.uniforms.uEaldholtCellKnotR = uniforms.uEaldholtCellKnotR;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', CELL_DECLARATIONS).replace('#include <begin_vertex>', CELL_TRANSFORM)
    .replace('#include <beginnormal_vertex>', CELL_NORMAL);
}

/** CPU reference of ealdholtCellScale() for tests and diagnostics. */
export function ealdholtInstanceCellScaleAt(state: ArrayLike<number>, layerOffset: number, rank: number, levelFraction: number, instanceX: number, instanceY: number, instanceZ: number, out: { [index: number]: number }): void {
  const o = layerOffset, S = EALDHOLT_INSTANCE_CELL_STATE;
  const d = Math.hypot(instanceX - state[o], instanceY - state[o + 1], instanceZ - state[o + 2]) * state[o + 3];
  const rho = Math.min(ealdholtInstanceCellCurve(state, state, EALDHOLT_INSTANCE_CELL_MAX_KNOTS, d, o + S.knotDistances, o + S.knotDensities), levelFraction);
  const u = (rank + .5) * state[o + S.shape];
  const t = Math.min(1, Math.max(0, (rho - u) / Math.max(rho * state[o + S.shape + 1], 1e-6))), edge = 1 - Math.max(state[o + S.shape + 1], 1e-3);
  const k = Math.min(1, Math.max(0, (rho - edge) / (1 - edge))), lift = k * k * (3 - 2 * k), fade = t * t * (3 - 2 * t) * (1 - lift) + lift;
  const widen = Math.min(state[o + S.shape + 2], Math.max(1, 1 / Math.sqrt(Math.max(rho, 1e-4)))), reach = ealdholtInstanceCellReachFade(state[o + S.reach], state[o + S.reach + 1], d);
  out[0] = widen * fade * reach; out[1] = (1 + (widen - 1) * state[o + S.shape + 3]) * fade * reach; out[2] = widen * fade * reach;
}

// ---------------------------------------------------------------- coverage raster

export interface EaldholtInstanceCellCoverageOptions {
  readonly profile: EaldholtInstanceCellProfile;
  readonly tier: EaldholtFoliageQuality;
  /** Texel edge in layer-local metres (2-8). */
  readonly cellMetres: number;
  /** Raster extent; defaults to the union of instance origins plus one texel. */
  readonly bounds?: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Footprint fill of a prototype's x/z box (default pi/4, an inscribed ellipse). */
  readonly fill?: number;
}
export interface EaldholtInstanceCellCoverage {
  readonly width: number;
  readonly height: number;
  readonly cellMetres: number;
  /** Texture coordinate = (position.xz - [frame0, frame1]) * [frame2, frame3], as woodland-ground's canopy field. */
  readonly frame: readonly [number, number, number, number];
  /** Row-major (row = z, column = x) ground fraction covered by each kind's footprints at the tier, 0..255. */
  readonly kinds: Readonly<Partial<Record<EaldholtInstanceCellKind, Uint8Array>>>;
  /** Outer band edge per kind, layer-local metres at the nominal focal length and tier scale 1. */
  readonly reach: Readonly<Partial<Record<EaldholtInstanceCellKind, number>>>;
  readonly meanCoverage: Readonly<Partial<Record<EaldholtInstanceCellKind, number>>>;
}

/**
 * Platform-free coverage raster for the ground pass: per kind, instance density
 * times projected footprint on a 2-8 m grid. A ground shader can tint or
 * darken beyond each kind's reach (where the cells stop drawing) so far
 * meadows and forest floors keep their tone; see the contract in the
 * evaluation and streaming README. Deterministic, build time only.
 */
export function createEaldholtInstanceCellCoverage(layers: readonly EaldholtInstanceCellLayerInput[], options: EaldholtInstanceCellCoverageOptions): EaldholtInstanceCellCoverage {
  if (options.profile !== 'desktop' && options.profile !== 'quest') throw Error('Coverage profile must be desktop or quest.');
  assertEaldholtFoliageQuality(options.tier);
  const metres = options.cellMetres, fill = options.fill ?? Math.PI / 4;
  if (!Number.isFinite(metres) || metres < 2 || metres > 8) throw new RangeError('Coverage texels must be 2-8 metres.');
  if (!Number.isFinite(fill) || fill <= 0 || fill > 1) throw new RangeError('Coverage fill must be in (0, 1].');
  const rules = EALDHOLT_INSTANCE_CELL_PROFILES[options.profile];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const counts = layers.map(layer => checkMatrices(layer.matrices, layer.id));
  if (options.bounds) ({ minX, maxX, minZ, maxZ } = options.bounds);
  else layers.forEach((layer, l) => { for (let i = 0; i < counts[l]; i++) {
    const x = layer.matrices[i * 16 + 12], z = layer.matrices[i * 16 + 14];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  } });
  if (!(maxX >= minX) || !(maxZ >= minZ)) { minX = 0; maxX = metres; minZ = 0; maxZ = metres; }
  minX -= metres; minZ -= metres; maxX += metres; maxZ += metres;
  const width = Math.ceil((maxX - minX) / metres), height = Math.ceil((maxZ - minZ) / metres);
  if (width * height > 1 << 22) throw new RangeError('Coverage raster is too large; use larger texels.');
  const remaining: Partial<Record<EaldholtInstanceCellKind, Float64Array>> = {}, reach: Partial<Record<EaldholtInstanceCellKind, number>> = {};
  const area = metres * metres, tierIndex = tierIndexOf(options.tier);
  layers.forEach((layer, l) => {
    const settings = resolveEaldholtInstanceCellLayerSettings(layer.rule ?? rules.kinds[layer.kind], rules.focalPixels, layer.kind);
    reach[layer.kind] = Math.max(reach[layer.kind] ?? 0, settings.reach);
    const tiers = layer.tiers ?? defaultEaldholtInstanceCellTiers(counts[l]), drawn = [tiers.low, tiers.medium, tiers.high][tierIndex];
    const lo = layer.localBounds.min, hi = layer.localBounds.max, footprint = (hi[0] - lo[0]) * (hi[2] - lo[2]) * fill;
    const field = remaining[layer.kind] ?? (remaining[layer.kind] = new Float64Array(width * height).fill(1)), m = layer.matrices;
    // Per layer, coverage adds linearly within a texel; layers of one kind combine as 1 - prod(1 - c).
    const layerCover = new Float64Array(width * height);
    for (let i = 0; i < drawn; i++) {
      const o = i * 16, column = Math.floor((m[o + 12] - minX) / metres), row = Math.floor((m[o + 14] - minZ) / metres);
      if (column < 0 || row < 0 || column >= width || row >= height) continue;
      const sx = Math.hypot(m[o], m[o + 1], m[o + 2]), sz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
      layerCover[row * width + column] += footprint * sx * sz / area;
    }
    for (let t = 0; t < field.length; t++) field[t] *= 1 - Math.min(1, layerCover[t]);
  });
  const kinds: Partial<Record<EaldholtInstanceCellKind, Uint8Array>> = {}, mean: Partial<Record<EaldholtInstanceCellKind, number>> = {};
  for (const name of EALDHOLT_INSTANCE_CELL_KINDS) {
    const field = remaining[name];
    if (!field) continue;
    const data = new Uint8Array(field.length);
    let sum = 0;
    for (let t = 0; t < field.length; t++) { const value = Math.round((1 - field[t]) * 255); data[t] = value; sum += value / 255; }
    kinds[name] = data; mean[name] = sum / field.length;
  }
  return Object.freeze({ width, height, cellMetres: metres, frame: Object.freeze([minX, minZ, 1 / (width * metres), 1 / (height * metres)] as [number, number, number, number]),
    kinds: Object.freeze(kinds), reach: Object.freeze(reach), meanCoverage: Object.freeze(mean) });
}
