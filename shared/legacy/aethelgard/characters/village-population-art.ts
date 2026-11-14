/**
 * Ealdholt village population art registry: what every one of the 100 residents is drawn and moved with.
 *
 * WORKING PLACEHOLDER (7 November 2026). The data (`village-population-art-data.ts`) is GENERATED from the published
 * files by `scripts/characters/population_art_registry.ts`; this module adds the types, lookups and a pure validator
 * against the population proposal (`village-population.ts`). Role labels only, no names or canon.
 *
 * Per resident:
 * - `levels`: the published files with their measured budgets. The 96 crowd residents have one `crowd` level that
 *   serves desktop and Quest (about 3,500 triangles, one material, one 512 atlas, the 64-joint rig, no morphs, no clips);
 *   the four built smithy residents keep their household levels (`desktop-lod0`, `desktop-lod1`, `quest`), clips and morphs.
 * - `clipLibrary`: the archetype's clips-only GLB that a crowd resident plays (`{ scene: resident.scene, animations:
 *   library.animations }`, `placement.scale = placementScale`); null for the smithy sets, whose clips are in their files.
 * - `motions`: the actor owner's idle, walk and talk clip names, the playback-rate variation and the role loops. Every
 *   name is a clip of the resident's library (checked by the generator and the asset test).
 * - `props`: each prop's socket from the population data and the shared kit file and node that draws it. Per-clip grips
 *   (`kitMatrix`) and workplace positions are in the clip library manifest (`crowd-v1/clips/manifest.json`).
 * - `face`: the face tier and calibration (crowd: joints only; smithy sets: morphs and joints).
 *
 * Paths are relative to the shared legacy environment asset root (as `householdArtFolder`), so the same entry works for
 * the desktop public folder and its generated Quest mirror. Nothing here selects presence or simulation depth: that is
 * `village-presence.ts` (art-side proposal) and Codex's simulation. Pure data and functions: no three, DOM, timers,
 * clock reads or randomness. ES2020.
 */
import { VILLAGE_POPULATION_ART_DATA, VILLAGE_POPULATION_ART_DATA_TOTALS } from './village-population-art-data';
import {
  CROWD_LEVEL_BUDGET, EALDHOLT_VILLAGE_POPULATION, POPULATION_PROPS, crowdClipLibraryFile, crowdResidentFile, getPopulationProp,
  type PopulationArchetype, type PopulationFidelityTier, type PopulationGroup, type PopulationPropKit,
  type PopulationPropSocket, type VillagePopulation,
} from './village-population';

export const VILLAGE_POPULATION_ART_STATUS = 'working-placeholder' as const;
/** Root of every path in the registry inside the shared legacy environment assets. */
export const VILLAGE_POPULATION_ART_ROOT = 'aethelgard/characters' as const;

export type PopulationArtLevelId = 'crowd' | 'desktop-lod0' | 'desktop-lod1' | 'quest';
export type PopulationArtPlatform = 'desktop' | 'quest';

export interface PopulationArtFile {
  /** Relative to the shared legacy environment asset root. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PopulationArtLevel extends PopulationArtFile {
  readonly level: PopulationArtLevelId;
  readonly platforms: readonly PopulationArtPlatform[];
  readonly triangles: number;
  /** Crowd level only: triangles on the head (eyes and lips keep their loops); null for household levels. */
  readonly headTriangles: number | null;
  readonly materials: number;
  readonly joints: number;
  readonly morphTargets: number;
  /** False for crowd files: their clips come from the archetype library. */
  readonly clipsInFile: boolean;
  readonly atlas?: { readonly width: number; readonly height: number; readonly bytes: number; readonly mime: string };
}

export interface PopulationArtProp {
  readonly id: string;
  readonly socket: PopulationPropSocket;
  readonly kit: PopulationPropKit;
  /** The shared prop-kit GLB and the node (`prop_<id>`) that draws this prop. */
  readonly file: string;
  readonly node: string;
  /**
   * Worn props (sockets `hips` and `back`): where the prop rides while no playing clip lists it (idle, talk, walk),
   * measured from the resident's own belt and back surfaces in the bind pose. Attach a clone of the kit node to the bone
   * with this bone-local matrix (column-major, glTF axes), like a clip's `kitMatrix`; hide it while a clip that lists
   * the same prop plays (the clip's grip wins). Null for hand, both-hands, shoulder and workplace props, which appear
   * only in the clips that hold them or as scene props.
   */
  readonly rest: { readonly bone: 'hips' | 'spine_03'; readonly matrix: readonly number[] } | null;
  /**
   * Two-handed props held as separate parts (art fixer, 8 November): the node per part (`prop_<id>_<part>`, mortar and
   * pestle, the two carding combs, the washing beetle). A clip grip with `part` attaches that part's node with its
   * kitMatrix; null for props without parts.
   */
  readonly parts: Readonly<Record<string, string>> | null;
  /** Workplace goods: drawn at the position and yaw of this workplace prop when a clip places it (the market trestle). */
  readonly placedWith: string | null;
  /** Carry goods: drawn in place of this clip prop, with its kitMatrix, while a clip that lists it plays. */
  readonly replaces: string | null;
}

export interface PopulationArtEntry {
  readonly residentId: string;
  readonly kind: 'crowd' | 'existing-set';
  readonly archetype: PopulationArchetype;
  readonly group: PopulationGroup;
  readonly fidelityTier: PopulationFidelityTier;
  readonly householdId: string;
  /** `crowd-v1` or the household set (`village-smith-v1`, ...). */
  readonly set: string;
  /** Resident manifest (crowd) or set manifest (household). */
  readonly manifest: string;
  readonly levels: readonly PopulationArtLevel[];
  /** Pass as the actor placement scale (crowd: the stature inside the shared archetype skeleton; household sets: 1). */
  readonly placementScale: number;
  /** Measured standing height at placement scale 1 is `statureMetres / placementScale` for crowd files. */
  readonly statureMetres: number;
  readonly clipLibrary: PopulationArtFile | null;
  readonly motions: {
    readonly idle: string; readonly walk: string; readonly talk: string;
    /** Playback-rate variation (0.94 to 1.06) so residents of one archetype never step in unison. */
    readonly rate: number;
    /** Role loops and carries (household sets: their work clip). */
    readonly roleClips: readonly string[];
  };
  readonly props: readonly PopulationArtProp[];
  /** Household sets only: their props files per platform (sockets and workplace in the set manifest). */
  readonly propsFiles: { readonly desktop: string; readonly quest: string } | null;
  readonly face: {
    readonly tier: 'joints-only' | 'morph-and-joints';
    readonly upperLidClosed: number; readonly lowerLidClosed: number; readonly jawOpen: number;
  };
  /** Crowd: an estimate from the rest-pose radius to add to the library's per-clip envelopes; null for household sets. */
  readonly envelopeMarginMetres: number | null;
  /** Crowd: largest body-joint distance from the shared archetype skeleton after the uniform scale (cm). */
  readonly jointResidualCm: number | null;
}

export interface PopulationArtTotals {
  readonly residents: number;
  readonly crowdResidentFiles: number;
  readonly crowdResidentBytes: number;
  readonly crowdTrianglesTotal: number;
  readonly crowdFolderBytes: number;
  readonly crowdResidentsFolderBytes: number;
  readonly clipLibrariesBytes: number;
  readonly propKitsBytes: number;
}

export const VILLAGE_POPULATION_ART: readonly PopulationArtEntry[] = deepFreeze(VILLAGE_POPULATION_ART_DATA);
export const VILLAGE_POPULATION_ART_TOTALS: PopulationArtTotals = deepFreeze(VILLAGE_POPULATION_ART_DATA_TOTALS);

export function getPopulationArt(residentId: string, art: readonly PopulationArtEntry[] = VILLAGE_POPULATION_ART): PopulationArtEntry | null {
  for (const e of art) if (e.residentId === residentId) return e;
  return null;
}

/**
 * The level to load on a platform: crowd residents use their one crowd file everywhere; household sets use `quest` on
 * Quest and the requested desktop level (default `desktop-lod1`) on desktop. Presence decides whether and how often
 * a resident animates; the smithy sets' distance-based choice stays `selectHouseholdArtLevels`.
 */
export function populationArtLevel(entry: PopulationArtEntry, platform: PopulationArtPlatform,
  desktopLevel: 'desktop-lod0' | 'desktop-lod1' = 'desktop-lod1'): PopulationArtLevel {
  if (entry.kind === 'crowd') return entry.levels[0];
  const want: PopulationArtLevelId = platform === 'quest' ? 'quest' : desktopLevel;
  for (const l of entry.levels) if (l.level === want) return l;
  return entry.levels[0];
}

/** Residents grouped by the clip library they share (loaded once per archetype). */
export function populationArtByLibrary(art: readonly PopulationArtEntry[] = VILLAGE_POPULATION_ART): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const e of art) if (e.clipLibrary) {
    const list = out.get(e.clipLibrary.path) ?? [];
    list.push(e.residentId); out.set(e.clipLibrary.path, list);
  }
  return out;
}

/**
 * Checks the registry against the population: one entry per resident with the same group, tier, household and
 * archetype; crowd entries name the population's crowd file and archetype library, carry one crowd level within the
 * crowd budget, no morphs, no clips and 64 joints; every motion is in the population's library clip list; every prop
 * is the population's prop with its kit. Returns null or the first problem.
 */
export function validatePopulationArt(art: readonly PopulationArtEntry[] = VILLAGE_POPULATION_ART,
  population: VillagePopulation = EALDHOLT_VILLAGE_POPULATION): string | null {
  if (art.length !== population.residents.length) return `registry has ${art.length} entries for ${population.residents.length} residents`;
  const seen = new Set<string>();
  const libraries = new Map(population.clipLibraries.map(l => [l.archetype, new Set(l.clips)]));
  const kitOf = new Map(POPULATION_PROPS.map(p => [p.id, p.kit]));
  for (const r of population.residents) {
    const e = getPopulationArt(r.id, art);
    if (!e) return `${r.id}: no art entry`;
    if (seen.has(r.id)) return `${r.id}: duplicate art entry`;
    seen.add(r.id);
    const a = r.appearance;
    if (e.kind !== a.kind || e.archetype !== a.archetype || e.group !== r.group || e.fidelityTier !== r.fidelityTier || e.householdId !== r.householdId) {
      return `${r.id}: art entry differs from the population (kind, archetype, group, tier or household)`;
    }
    if (!(e.placementScale > 0) || !(e.statureMetres > 0.8 && e.statureMetres < 2.1)) return `${r.id}: placement scale or stature out of range`;
    if (e.kind === 'crowd') {
      if (e.set !== 'crowd-v1' || e.levels.length !== 1 || e.levels[0].level !== 'crowd') return `${r.id}: crowd entries have one crowd level`;
      const l = e.levels[0];
      if (l.path !== `${VILLAGE_POPULATION_ART_ROOT}/${crowdResidentFile(r)}`) return `${r.id}: crowd file ${l.path}`;
      if (l.triangles > CROWD_LEVEL_BUDGET.triangles.max || (l.headTriangles ?? 0) < CROWD_LEVEL_BUDGET.triangles.headMin) return `${r.id}: triangle budget`;
      if (l.materials > CROWD_LEVEL_BUDGET.materials.max || l.morphTargets !== 0 || l.clipsInFile || l.joints !== CROWD_LEVEL_BUDGET.joints) return `${r.id}: crowd level structure`;
      if (l.bytes > CROWD_LEVEL_BUDGET.file.maxMiB * 1048576) return `${r.id}: file size`;
      if (!e.clipLibrary || e.clipLibrary.path !== `${VILLAGE_POPULATION_ART_ROOT}/${crowdClipLibraryFile(a.archetype)}`) return `${r.id}: clip library`;
      const clips = libraries.get(a.archetype);
      if (!clips) return `${r.id}: no library for ${a.archetype}`;
      for (const c of [e.motions.idle, e.motions.walk, e.motions.talk, ...e.motions.roleClips]) if (!clips.has(c)) return `${r.id}: clip ${c} not in the ${a.archetype} library`;
      if (e.motions.idle !== a.motion.idle || e.motions.walk !== a.motion.walk || e.motions.talk !== a.motion.talk || e.motions.rate !== a.motion.rate
        || e.motions.roleClips.join() !== a.motion.roleClips.join()) return `${r.id}: motions differ from the population`;
      if (e.props.length !== a.props.length) return `${r.id}: props differ from the population`;
      for (let i = 0; i < a.props.length; i++) {
        const p = e.props[i];
        if (p.id !== a.props[i].id || p.socket !== a.props[i].socket || p.kit !== kitOf.get(p.id) || p.node === '' || !p.file.endsWith('.glb')) return `${r.id}: prop ${p.id}`;
        const spec = getPopulationProp(p.id)!;
        if ((p.placedWith ?? undefined) !== spec.placedWith || (p.replaces ?? undefined) !== spec.replaces) return `${r.id}: prop ${p.id} placement`;
        if ((spec.parts ?? []).join() !== Object.keys(p.parts ?? {}).join()) return `${r.id}: prop ${p.id} parts`;
        const worn = p.socket === 'hips' || p.socket === 'back';
        if (worn !== (p.rest !== null) || (p.rest && (p.rest.matrix.length !== 16 || !p.rest.matrix.every(Number.isFinite)))) return `${r.id}: prop ${p.id} rest attachment`;
      }
      if (e.face.tier !== 'joints-only' || !(e.face.upperLidClosed > 0)) return `${r.id}: joints-only face calibration`;
    } else {
      if (e.set !== a.existingSet || e.clipLibrary !== null || e.levels.length !== 3) return `${r.id}: household set entry`;
    }
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
