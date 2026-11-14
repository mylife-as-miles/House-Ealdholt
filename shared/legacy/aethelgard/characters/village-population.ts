/**
 * Ealdholt village population: the creator's established banner village of 100 residents in 25 households
 * (creator decision, 7 November 2026; see docs/legacy/characters/EALDHOLT_POPULATION_ART.md).
 *
 * WORKING PLACEHOLDER. Every role label, household, family tie, social tie, routine, place and appearance below is
 * a replaceable proposal for creator review: role labels only, no proper names, no lore and no private canon. Places
 * that are not in the household casting are marked `proposed-placeholder` (their IDs start with `proposed-`); no
 * coordinates or geography are implied. Nothing here is integrated, spawned, saved or simulated: Codex owns household
 * simulation, persistence, navigation, route presentation and resident animation integration. The registry built
 * here uses Codex's people-life shapes and passes `validatePeopleLifeRegistry` unchanged, so Codex may adopt, extend
 * or replace it.
 *
 * What it fixes:
 * - exactly the creator's group counts (45 farmers, artisans and merchants; 20 children and apprentices; 15 guards
 *   and military; 12 elders and dependents; 8 leaders, clergy and specialists), 100 residents in 25 households;
 * - the four built smithy residents keep their IDs, routines and art sets in one household; the steward and the
 *   messenger keep their compatibility IDs; leaders, clergy, guards, the steward, smith and messenger are ordinary
 *   villagers with roles and families, with the same capabilities as everyone else;
 * - a fidelity tier for every resident (`major`: deeply simulated, 15 to 25; `persistent`: schedule-driven, 75 to 85)
 *   following the creator's performance model; how runtime presents them is `village-presence.ts`;
 * - an art recipe for every resident that the crowd builder reads: body archetype (one shared skeleton and clip
 *   library per archetype), MakeHuman macro and face values, skin, eyes, hair, headwear, outfit kit with a natural-dye
 *   palette, props and motion set. Variation is deterministic (seeded from IDs), inherited inside families, and
 *   resolved so no two crowd residents share a visible signature.
 *
 * Invariants: the player is an unseen influence with no avatar; sensitivity only changes how often a resident pauses;
 * nothing here reads or writes house standing (only explicitly started My Legacy chess matches change it); banner
 * colours are presentation only and stay undyed until the banner is confirmed; no currencies, loot, XP or health.
 *
 * Pure data plus a strict validator: no three, DOM, timers, clock reads, Math.random, storage or network. ES2020.
 */
import {
  validatePeopleLifeRegistry,
  type PeopleLifeFamily,
  type PeopleLifeHousehold,
  type PeopleLifeInfluenceSensitivity,
  type PeopleLifeKin,
  type PeopleLifeKinKind,
  type PeopleLifePlace,
  type PeopleLifeRegistry,
  type PeopleLifeResident,
  type PeopleLifeSocialTie,
} from '../people-life';
import { EALDHOLT_HOUSEHOLD_CASTING } from './household-casting';

export const VILLAGE_POPULATION_STATUS = 'working-placeholder' as const;
export const VILLAGE_POPULATION_DECIDED_ON = '2026-11-07' as const;

export type PopulationGroup =
  | 'farmers-artisans-merchants'
  | 'children-apprentices'
  | 'guards-military'
  | 'elders-dependents'
  | 'leaders-clergy-specialists';
export const POPULATION_GROUPS: readonly PopulationGroup[] = Object.freeze([
  'farmers-artisans-merchants', 'children-apprentices', 'guards-military', 'elders-dependents', 'leaders-clergy-specialists',
] as const);

/** The creator's starting population (7 November 2026). */
export const VILLAGE_POPULATION_GROUP_COUNTS: Readonly<Record<PopulationGroup, number>> = Object.freeze({
  'farmers-artisans-merchants': 45,
  'children-apprentices': 20,
  'guards-military': 15,
  'elders-dependents': 12,
  'leaders-clergy-specialists': 8,
});
export const VILLAGE_POPULATION_SIZE = 100 as const;
/** "Approximately 25 households": this proposal uses exactly 25. */
export const VILLAGE_POPULATION_HOUSEHOLDS = 25 as const;

/** The creator's performance model for Crownfall VR (7 November 2026). */
export const VILLAGE_PERFORMANCE_MODEL = Object.freeze({
  deeplySimulatedMajor: Object.freeze({ min: 15, max: 25 }),
  scheduleDrivenPersistent: Object.freeze({ min: 75, max: 85 }),
  questVisibleSimultaneously: Object.freeze({ min: 8, max: 15 }),
} as const);

export type PopulationSex = 'female' | 'male';
export type PopulationAgeBand = 'child' | 'adolescent' | 'adult' | 'middle-aged' | 'elder';
export type PopulationFidelityTier = 'major' | 'persistent';

// ------------------------------------------------------------------ body archetypes (one skeleton, one clip library)

export type PopulationArchetype = 'adult-male' | 'adult-female' | 'adolescent' | 'child' | 'elder-male' | 'elder-female';
export const POPULATION_ARCHETYPES: readonly PopulationArchetype[] = Object.freeze([
  'adult-male', 'adult-female', 'adolescent', 'child', 'elder-male', 'elder-female',
] as const);

export interface PopulationArchetypeSpec {
  readonly id: PopulationArchetype;
  readonly label: string;
  readonly sexes: readonly PopulationSex[];
  /** Inclusive age range in years a resident of this archetype may have. */
  readonly ageYears: readonly [number, number];
  /** MakeHuman macro values of the shared reference skeleton (tool parameters, not identity). */
  readonly reference: {
    readonly gender: number; readonly ageYears: number; readonly muscle: number; readonly weight: number;
    readonly height: number; readonly proportions: number;
  };
  /** Stature of the reference body, measured from the shaped CC0 base mesh. */
  readonly referenceStatureCm: number;
  /**
   * Macro height may differ from the reference by at most this much; the difference becomes a placement scale. The
   * child and adolescent references use height 0.6 because MakeHuman's growth model is short for the age (an 8-year-old
   * measures 110 cm at 0.5).
   */
  readonly heightMacroSpread: number;
  /**
   * Measured (scratchpad joint-variation runs, 7 November, numpy over the CC0 base mesh and the 64-joint rig): largest
   * body-joint residual after the best uniform scale about the ground point, i.e. how far the shared archetype skeleton
   * sits from a resident's own anatomical joints once its stature is carried by the placement scale. `span*` covers the
   * archetype's whole declared range at its corners (ages, sex, height macro reference +-0.1, weight and muscle 0.3 to 0.8,
   * three family mixes); `residents*` are the 96 actual crowd residents. `core` excludes finger joints. Weight, muscle and
   * face detail targets alone move body joints by at most 0.5 cm. Feet stay exactly planted (the skeleton is shared); the
   * residual shows as a slightly misplaced bend (knee, hip, neck) on the skinned mesh.
   */
  readonly measuredResidualCm: { readonly spanAll: number; readonly spanCore: number; readonly residentsCoreMax: number; readonly residentsCoreMean: number };
  /** Placement scales measured over the declared span and over the actual residents. */
  readonly measuredScaleRange: readonly [number, number];
  readonly residentScaleRange: readonly [number, number];
}

export const POPULATION_ARCHETYPE_SPECS: readonly PopulationArchetypeSpec[] = deepFreeze([
  { id: 'adult-male', label: 'Adult man', sexes: ['male'], ageYears: [18, 56],
    reference: { gender: 1, ageYears: 34, muscle: 0.55, weight: 0.5, height: 0.5, proportions: 0.5 }, referenceStatureCm: 173.5,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.85, spanCore: 2.58, residentsCoreMax: 1.61, residentsCoreMean: 0.9 },
    measuredScaleRange: [0.82, 1.098], residentScaleRange: [0.921, 1.078] },
  { id: 'adult-female', label: 'Adult woman', sexes: ['female'], ageYears: [17, 51],
    reference: { gender: 0, ageYears: 30, muscle: 0.45, weight: 0.5, height: 0.5, proportions: 0.5 }, referenceStatureCm: 159.7,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.96, spanCore: 2.87, residentsCoreMax: 2.55, residentsCoreMean: 1.26 },
    measuredScaleRange: [0.811, 1.113], residentScaleRange: [0.914, 1.086] },
  { id: 'adolescent', label: 'Adolescent (both sexes)', sexes: ['female', 'male'], ageYears: [12, 17],
    reference: { gender: 0.5, ageYears: 14, muscle: 0.45, weight: 0.45, height: 0.6, proportions: 0.5 }, referenceStatureCm: 150.7,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.34, spanCore: 2.34, residentsCoreMax: 1.61, residentsCoreMean: 1.31 },
    measuredScaleRange: [0.84, 1.196], residentScaleRange: [0.952, 1.153] },
  { id: 'child', label: 'Child (both sexes)', sexes: ['female', 'male'], ageYears: [5, 11],
    reference: { gender: 0.5, ageYears: 8, muscle: 0.45, weight: 0.45, height: 0.6, proportions: 0.5 }, referenceStatureCm: 119.5,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.72, spanCore: 2.72, residentsCoreMax: 1.4, residentsCoreMean: 0.94 },
    measuredScaleRange: [0.701, 1.356], residentScaleRange: [0.734, 1.226] },
  { id: 'elder-male', label: 'Elder man', sexes: ['male'], ageYears: [58, 90],
    reference: { gender: 1, ageYears: 70, muscle: 0.4, weight: 0.5, height: 0.45, proportions: 0.5 }, referenceStatureCm: 168.2,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.45, spanCore: 2.34, residentsCoreMax: 1.55, residentsCoreMean: 1.24 },
    measuredScaleRange: [0.93, 1.079], residentScaleRange: [0.966, 1.033] },
  { id: 'elder-female', label: 'Elder woman', sexes: ['female'], ageYears: [58, 90],
    reference: { gender: 0, ageYears: 70, muscle: 0.35, weight: 0.5, height: 0.4, proportions: 0.5 }, referenceStatureCm: 151.6,
    heightMacroSpread: 0.1, measuredResidualCm: { spanAll: 2.42, spanCore: 2.27, residentsCoreMax: 1.25, residentsCoreMean: 0.71 },
    measuredScaleRange: [0.926, 1.069], residentScaleRange: [0.966, 1.043] },
] as const satisfies readonly PopulationArchetypeSpec[]);

export function getArchetypeSpec(id: PopulationArchetype): PopulationArchetypeSpec {
  for (const spec of POPULATION_ARCHETYPE_SPECS) if (spec.id === id) return spec;
  throw new Error(`Unknown archetype ${id}.`);
}

function archetypeFor(sex: PopulationSex, age: number): PopulationArchetype | null {
  for (const spec of POPULATION_ARCHETYPE_SPECS) {
    if (spec.sexes.indexOf(sex) >= 0 && age >= spec.ageYears[0] && age <= spec.ageYears[1]) return spec.id;
  }
  return null;
}

export function ageBandFor(age: number): PopulationAgeBand {
  if (age <= 11) return 'child';
  if (age <= 17) return 'adolescent';
  if (age <= 39) return 'adult';
  if (age <= 57) return 'middle-aged';
  return 'elder';
}

// ------------------------------------------------------------------ crowd level budget (one level per crowd resident)

/**
 * Budget of the single crowd level built for the 96 new residents, used by the desktop isometric view and by Quest.
 * Measured basis (scratchpad crowd-probe, 7 November): the published Quest smith and spinner decimated to 4.5k, 3.5k
 * and 2.5k triangles with the head protected read the same as the 5.4k to 5.8k originals at isometric 12 m and 25 m,
 * 3.5k to 4.5k held up at Quest standing distance (2.5 m), 2.5k lost the lips and arm silhouette; a 512 albedo was
 * indistinguishable from 1024 at 2.5 m (27 to 28 KB WebP against about 100 KB). Uncompressed skinned geometry measured
 * 0.18 MiB at 3.5k and 0.23 MiB at 4.5k triangles. Every figure here is a target for the builder, not a runtime result.
 */
export const CROWD_LEVEL_BUDGET = deepFreeze({
  triangles: { nominal: 3500, max: 4500, headMin: 900 },
  /** Opaque body and garments, plus at most one alpha-tested material for hair edges, fringes and beards. */
  materials: { max: 2 },
  /** Draws per drawn resident: body (1-2) plus at most one held prop; workstations are shared scene props. */
  draws: { bodyMax: 2, heldPropsMax: 1 },
  /** The household 64-joint rig (jaw, eye and lid joints, four skirt bones); body joints shared per archetype. */
  joints: 64,
  /** No morph targets at the crowd level: blink, gaze and jaw by the face joints (face-performance joints-only tier). */
  morphTargets: 0,
  faceTier: 'face-joints-only' as const,
  textures: { albedoPx: 512, normalPx: 256, hairStrandPx: 256, decodedMiBMax: 2.1 },
  /** Body clips live in the archetype clip libraries, never in resident files. */
  clipsInResidentFile: 0,
  file: { targetMiB: 0.3, maxMiB: 0.45 },
  committed: { residentsAndLibrariesTargetMiB: 45, hardCapMiB: 60 },
  questVisible: { residents: 12, maxResidents: 15, trianglesMax: 15 * 4500, drawsMax: 15 * 3 },
} as const);

// ------------------------------------------------------------------ dyes, kits, headwear, hair, props

/** Natural-dye wool and linen colours (approximate sRGB), the palette every outfit kit draws from. */
export const POPULATION_DYES = deepFreeze({
  'undyed-cream': '#d8cdb5', 'undyed-grey': '#8b867c', 'undyed-brown': '#6a5a48', 'walnut-brown': '#56402f',
  russet: '#86563a', ochre: '#a7803e', 'weld-yellow': '#c4a24a', 'weld-green': '#5d6b3b', 'woad-blue': '#3e5876',
  'woad-pale': '#7c94a9', 'madder-red': '#963a2e', 'madder-rose': '#b47668', 'lichen-violet': '#6b5a6b',
  'oak-gall-black': '#2f2c29',
} as const);
export type PopulationDye = keyof typeof POPULATION_DYES;

export type PopulationHeadwear =
  | 'none' | 'coif' | 'straw-hat' | 'felt-cap' | 'hood' | 'head-cloth' | 'veil-wimple' | 'kerchief'
  | 'kettle-helmet' | 'nasal-helmet' | 'padded-coif' | 'ribbon';
export type PopulationHairStyle =
  | 'cropped' | 'short-tousled' | 'balding-crop' | 'tied-back' | 'curly-short' | 'tonsure' | 'thinning-white'
  | 'long-braid' | 'bun' | 'loose-long' | 'twin-braids' | 'tousled-child' | 'cropped-child';
export type PopulationFacialHair = 'none' | 'stubble' | 'short-beard' | 'full-beard' | 'moustache';
export type PopulationWear = 'clean' | 'worn' | 'muddy-hems' | 'flour-dusted' | 'stained' | 'travel-worn' | 'sooty';

/**
 * Headwear shapes that read from above (art fixer, 8 November): from the isometric camera the crown is what shows, and
 * about thirty residents wore the same smooth dome. Each headwear has shape variants built by
 * scripts/characters/lib/crowd_hair.py; the resolver spreads residents of one kit over them.
 */
export const POPULATION_HEADWEAR_SHAPES: Readonly<Record<PopulationHeadwear, readonly string[]>> = deepFreeze({
  none: ['plain'], ribbon: ['plain'],
  'head-cloth': ['knotted-tails', 'lappets', 'rolled-band', 'plain-knot'],
  'veil-wimple': ['folded-crown', 'plain'],
  coif: ['chin-tied', 'plain'],
  'padded-coif': ['plain', 'chin-tied'],
  hood: ['liripipe', 'plain'],
  'felt-cap': ['rolled-brim', 'peaked', 'plain'],
  kerchief: ['knot-back', 'nape-tails'],
  'straw-hat': ['wide', 'narrow'],
  'kettle-helmet': ['plain'], 'nasal-helmet': ['plain'],
});
/** Linen tones (approximate sRGB): undyed linen was never one white. */
export const POPULATION_LINEN_TONES = deepFreeze({
  bleached: '#ddd8cc', unbleached: '#c4b89c', greyed: '#a19e96', yellowed: '#d6ccab',
} as const);
export type PopulationLinenTone = keyof typeof POPULATION_LINEN_TONES;
/** What colours a headwear piece: a linen tone, a palette slot, or a fixed material. */
export type PopulationHeadwearTone = PopulationLinenTone | 'main' | 'secondary' | 'accent' | 'straw' | 'metal' | 'none';
/** Tones each headwear may take: linen covers in four linen tones (head-cloths and coifs also in the kit's accent dye),
 * felt caps in the main or secondary dye (an accent ochre cap read as blond hair), kerchiefs in the accent dye. */
export const POPULATION_HEADWEAR_TONES: Readonly<Record<PopulationHeadwear, readonly PopulationHeadwearTone[]>> = deepFreeze({
  none: ['none'], ribbon: ['accent'],
  'head-cloth': ['bleached', 'unbleached', 'greyed', 'yellowed', 'accent'],
  'veil-wimple': ['bleached', 'unbleached', 'greyed', 'yellowed'],
  coif: ['bleached', 'unbleached', 'greyed', 'yellowed', 'accent'],
  'padded-coif': ['main'],
  hood: ['secondary'],
  'felt-cap': ['main', 'secondary'],
  kerchief: ['accent'],
  'straw-hat': ['straw'],
  'kettle-helmet': ['metal'], 'nasal-helmet': ['metal'],
} as { [K in PopulationHeadwear]: readonly PopulationHeadwearTone[] });
/** Approximate sRGB of the hair colours, so a felt cap is never drawn in the wearer's hair colour. */
const HAIR_SRGB: Readonly<Record<string, string>> = {
  black: '#211f1c', 'dark-brown': '#382b21', 'mid-brown': '#514030', 'light-brown': '#6f5841', fair: '#a18e6c',
  sandy: '#958053', auburn: '#6f4126', 'red-brown': '#613f27', white: '#cbc7c0',
};

export type PopulationOutfitKit =
  | 'field-tunic' | 'field-kirtle' | 'herder-cloak' | 'workshop-apron-m' | 'workshop-apron-f' | 'miller-smock'
  | 'market-m' | 'market-f' | 'hall-livery' | 'guard-gambeson' | 'guard-captain' | 'guard-archer' | 'clergy-cassock'
  | 'clerk-robe' | 'steward-gown' | 'healer-kirtle' | 'messenger-travel' | 'mason-apron' | 'child-tunic'
  | 'child-dress' | 'apprentice-m' | 'apprentice-f' | 'elder-m' | 'elder-f' | 'existing-household-set';

export interface PopulationOutfitKitSpec {
  readonly id: PopulationOutfitKit;
  readonly label: string;
  readonly archetypes: readonly PopulationArchetype[];
  /** Garment layers the kit generates per resident body (outer layers fitted to each shaped body). */
  readonly layers: readonly string[];
  /** Allowed dyes per palette slot: main (largest garment), secondary (legs, apron or underlayer), accent (belt, hood, trim). */
  readonly dyes: { readonly main: readonly PopulationDye[]; readonly secondary: readonly PopulationDye[]; readonly accent: readonly PopulationDye[] };
  /** How the silhouette reads from the isometric camera. */
  readonly silhouette: string;
  /** Where banner colours appear once the player's banner is confirmed (presentation only); null if nowhere. */
  readonly bannerPresentation: string | null;
  /**
   * Cut variants that change the silhouette, not only the dye (art fixer, 8 November): residents of one kit shared one
   * cut and read as recolours from the isometric view. Every kit of five or more residents has three to five cuts; the
   * resolver spreads a kit's residents over them (household members and residents of one role apart where it can), and
   * the cut is part of the visible signature. Ids match `CUTS` in scripts/characters/lib/crowd_outfits.py.
   */
  readonly cuts: readonly PopulationOutfitCut[];
}

/** One cut of an outfit kit (garment lengths, layers and capes the builder generates). */
export interface PopulationOutfitCut { readonly id: string; readonly silhouette: string }
const cut = (id: string, silhouette: string): PopulationOutfitCut => ({ id, silhouette });
const STANDARD_CUT: readonly PopulationOutfitCut[] = [cut('standard', 'As the kit describes.')];

const EARTH:readonly PopulationDye[] = ['undyed-grey', 'undyed-brown', 'walnut-brown', 'russet', 'ochre', 'weld-green'];
const BRIGHT: readonly PopulationDye[] = ['madder-red', 'madder-rose', 'woad-blue', 'woad-pale', 'weld-yellow', 'lichen-violet'];
const PLAIN: readonly PopulationDye[] = ['undyed-cream', 'undyed-grey', 'undyed-brown'];
const ADULTS_M: readonly PopulationArchetype[] = ['adult-male', 'elder-male'];
const ADULTS_F: readonly PopulationArchetype[] = ['adult-female', 'elder-female'];

export const POPULATION_OUTFIT_KITS: readonly PopulationOutfitKitSpec[] = deepFreeze([
  { id: 'field-tunic', label: 'Field tunic', archetypes: ['adult-male', 'adolescent', 'elder-male'],
    layers: ['linen shirt', 'knee-length wool tunic hitched into the belt', 'hose with leg wraps', 'turnshoes', 'belt and pouch'],
    dyes: { main: EARTH, secondary: ['undyed-brown', 'walnut-brown', 'undyed-grey'], accent: ['russet', 'madder-rose', 'woad-pale', 'ochre'] },
    silhouette: 'Short tunic, bare forearms, a tool over the shoulder.', bannerPresentation: null,
    cuts: [cut('short-tunic', 'Short-sleeved tunic above the knee, hose and leg wraps.'), cut('long-tunic', 'Long-sleeved tunic to the knee, no leg wraps.'), cut('shoulder-cape', 'Short tunic under a closed shoulder cape.'), cut('sleeveless-jerkin', 'Sleeveless jerkin over a long-sleeved tunic.')] },
  { id: 'field-kirtle', label: 'Field kirtle', archetypes: ['adult-female', 'adolescent', 'elder-female'],
    layers: ['linen shift', 'wool kirtle kilted up at the hip', 'linen apron', 'turnshoes'],
    dyes: { main: ['russet', 'undyed-grey', 'woad-pale', 'weld-yellow', 'madder-rose', 'weld-green'], secondary: ['undyed-cream'], accent: ['woad-blue', 'madder-red', 'ochre', 'walnut-brown'] },
    silhouette: 'Kilted skirt showing the shift, apron and head-cloth.', bannerPresentation: null,
    cuts: [cut('long-apron', 'Ankle-length kirtle with a long waist apron.'), cut('kilted-half-apron', 'Kirtle kilted up in front over the shift, a short half apron.'), cut('shawl', 'Calf-length kirtle under a shoulder shawl, no apron.'), cut('overgown', 'Sleeveless overgown over the kirtle, no apron.')] },
  { id: 'herder-cloak', label: 'Herder cloak', archetypes: ['adult-male', 'adult-female', 'adolescent', 'elder-male', 'elder-female'],
    layers: ['linen shirt or shift', 'wool tunic or kirtle', 'hooded shoulder cape', 'leg wraps', 'thick shoes'],
    dyes: { main: ['undyed-grey', 'undyed-brown', 'walnut-brown', 'undyed-cream'], secondary: EARTH, accent: ['russet', 'ochre', 'woad-pale'] },
    silhouette: 'Hooded cape over the shoulders and a long crook.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'workshop-apron-m', label: 'Workshop apron (men)', archetypes: ADULTS_M,
    layers: ['linen shirt', 'tunic with rolled sleeves', 'trousers or hose', 'leather or linen work apron', 'turnshoes'],
    dyes: { main: EARTH.concat(['woad-pale']), secondary: ['undyed-brown', 'walnut-brown', 'undyed-grey'], accent: ['russet', 'ochre', 'madder-rose', 'woad-blue'] },
    silhouette: 'Broad apron front, rolled sleeves, a tool in hand.', bannerPresentation: null,
    cuts: [cut('bib-leather', 'Short tunic and a leather bib apron to the knee.'), cut('long-waist-apron', 'Long-sleeved tunic to the knee and a linen waist apron.'), cut('sleeveless-jerkin', 'Sleeveless jerkin over a long-sleeved tunic, a small leather apron.'), cut('long-bib', 'Short tunic and a long leather bib apron to the shin.')] },
  { id: 'workshop-apron-f', label: 'Workshop apron (women)', archetypes: ADULTS_F,
    layers: ['linen shift', 'kirtle with pinned sleeves', 'linen apron', 'head-cloth', 'turnshoes'],
    dyes: { main: BRIGHT.concat(['russet', 'ochre']), secondary: ['undyed-cream', 'undyed-grey'], accent: ['walnut-brown', 'woad-blue', 'madder-red', 'weld-green'] },
    silhouette: 'Full skirt with a long apron and pinned-up sleeves.', bannerPresentation: null,
    cuts: [cut('bib-apron', 'Ankle-length kirtle with a bib apron.'), cut('half-apron', 'Kirtle with sleeves pinned short and a half apron.'), cut('overgown', 'Sleeveless overgown over the kirtle and a waist apron.'), cut('shawl-apron', 'Calf-length kirtle over the shift, a shoulder shawl and a waist apron.')] },
  { id: 'miller-smock', label: 'Miller smock', archetypes: ['adult-male'],
    layers: ['long linen smock', 'hose', 'coif', 'turnshoes'],
    dyes: { main: ['undyed-cream'], secondary: ['undyed-grey', 'undyed-brown'], accent: ['ochre', 'russet'] },
    silhouette: 'Pale knee-length smock dusted with flour, sacks on the shoulder.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'market-m', label: 'Market tunic and mantle', archetypes: ADULTS_M,
    layers: ['linen shirt', 'calf-length tunic', 'short mantle pinned at the shoulder', 'belt purse', 'shoes'],
    dyes: { main: ['woad-blue', 'madder-red', 'russet', 'lichen-violet', 'weld-green'], secondary: ['undyed-brown', 'walnut-brown'], accent: ['weld-yellow', 'ochre', 'undyed-cream'] },
    silhouette: 'Longer coloured tunic with a mantle and a purse.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'market-f', label: 'Market gown', archetypes: ADULTS_F,
    layers: ['linen shift', 'gown', 'sleeveless overgown', 'belt purse', 'head-cloth or veil', 'shoes'],
    dyes: { main: ['madder-red', 'woad-blue', 'weld-yellow', 'lichen-violet', 'weld-green'], secondary: ['undyed-cream', 'woad-pale', 'madder-rose'], accent: ['walnut-brown', 'ochre', 'oak-gall-black'] },
    silhouette: 'Layered coloured gown and a basket on the hip.', bannerPresentation: null,
    cuts: [cut('plain-gown', 'Coloured gown with cuffs and a purse.'), cut('overgown', 'Sleeveless overgown over the gown.'), cut('mantle', 'Gown under a short mantle.'), cut('apron-gown', 'Gown with a waist apron.')] },
  { id: 'hall-livery', label: 'Hall household clothes', archetypes: ['adult-male', 'adult-female', 'adolescent', 'elder-male'],
    layers: ['linen shirt or shift', 'tunic or kirtle', 'apron for kitchen work', 'sleeve band', 'shoes'],
    dyes: { main: ['woad-blue', 'russet', 'undyed-grey', 'walnut-brown'], secondary: ['undyed-cream', 'undyed-brown'], accent: ['undyed-cream', 'ochre'] },
    silhouette: 'Neat tunic or kirtle with a sleeve band.', bannerPresentation: 'Sleeve band in the banner colours once confirmed; undyed before.',
    cuts: STANDARD_CUT },
  { id: 'guard-gambeson', label: 'Guard gambeson', archetypes: ['adult-male', 'adult-female'],
    layers: ['padded quilted gambeson to mid-thigh', 'hose', 'boots', 'belt with knife', 'shoulder band'],
    dyes: { main: ['undyed-cream', 'undyed-grey', 'undyed-brown', 'ochre'], secondary: ['undyed-brown', 'walnut-brown', 'undyed-grey'], accent: ['russet', 'walnut-brown', 'oak-gall-black'] },
    silhouette: 'Bulky quilted torso, helmet and an upright spear.', bannerPresentation: 'Shoulder band and shield face in the banner colours once confirmed; undyed before.',
    cuts: [cut('thigh-gambeson', 'Quilted gambeson to mid-thigh.'), cut('knee-gambeson', 'Long quilted gambeson to the knee.'), cut('gambeson-cape', 'Hip-length gambeson under a short shoulder cape.'), cut('mail-shirt', 'Gambeson under a mail shirt to the hip.'), cut('jack-over-tunic', 'Sleeveless leather jack over a long-sleeved tunic.')] },
  { id: 'guard-captain', label: 'Captain mail and surcoat', archetypes: ['adult-male'],
    layers: ['gambeson', 'mail shirt to the hip', 'sleeveless surcoat', 'belt with sheathed sword', 'boots'],
    dyes: { main: ['undyed-cream', 'undyed-grey'], secondary: ['walnut-brown', 'undyed-brown'], accent: ['oak-gall-black', 'russet'] },
    silhouette: 'Surcoat over mail, a sword at the hip, no spear.', bannerPresentation: 'Surcoat in the banner colours once confirmed; undyed before.',
    cuts: STANDARD_CUT },
  { id: 'guard-archer', label: 'Archer gambeson', archetypes: ['adult-male', 'adult-female'],
    layers: ['short padded jack', 'hood', 'hose', 'bracer', 'quiver belt', 'boots'],
    dyes: { main: ['undyed-grey', 'undyed-brown', 'weld-green', 'walnut-brown'], secondary: ['undyed-brown', 'walnut-brown'], accent: ['russet', 'ochre', 'oak-gall-black'] },
    silhouette: 'Hooded, lighter jack, a bow held long and a quiver at the hip.', bannerPresentation: 'Hood lining in the banner colours once confirmed; undyed before.',
    cuts: [cut('jack', 'Short padded jack.'), cut('jack-cape', 'Short padded jack under a shoulder cape.')] },
  { id: 'clergy-cassock', label: 'Clergy cassock', archetypes: ['adult-male', 'elder-male'],
    layers: ['ankle-length cassock', 'hooded shoulder cape', 'cord belt', 'shoes'],
    dyes: { main: ['oak-gall-black', 'walnut-brown'], secondary: ['undyed-cream'], accent: ['undyed-cream', 'undyed-grey'] },
    silhouette: 'Dark ankle-length column with a hooded cape.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'clerk-robe', label: 'Clerk robe', archetypes: ['adult-male'],
    layers: ['ankle-length robe', 'coif', 'belt with a pen case and wax tablet', 'shoes'],
    dyes: { main: ['woad-blue', 'walnut-brown', 'lichen-violet'], secondary: ['undyed-cream'], accent: ['oak-gall-black', 'ochre'] },
    silhouette: 'Long plain robe, coif and a book under the arm.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'steward-gown', label: 'Steward gown', archetypes: ['adult-male'],
    layers: ['linen shirt', 'ankle-length gown', 'mantle', 'belt with keys', 'shoes'],
    dyes: { main: ['madder-red', 'woad-blue'], secondary: ['walnut-brown', 'undyed-brown'], accent: ['ochre', 'oak-gall-black'] },
    silhouette: 'Long gown and mantle, keys swinging at the belt.', bannerPresentation: 'Mantle edging in the banner colours once confirmed; undyed before.',
    cuts: STANDARD_CUT },
  { id: 'healer-kirtle', label: 'Healer kirtle', archetypes: ADULTS_F.concat(['adolescent']),
    layers: ['linen shift', 'kirtle', 'apron with pouches', 'shawl', 'head-cloth'],
    dyes: { main: ['weld-green', 'woad-pale', 'lichen-violet', 'russet'], secondary: ['undyed-cream', 'undyed-grey'], accent: ['walnut-brown', 'ochre'] },
    silhouette: 'Shawl and apron with hanging pouches, a basket of herbs.', bannerPresentation: null,
    cuts: [cut('dark-overgown', 'Dark sleeveless overgown over the kirtle, shawl and apron.'), cut('hooded-mantle', 'Hooded mantle to the knee over the kirtle, no apron.'), cut('apron-shawl', 'Kirtle with an apron and a shoulder shawl.')] },
  { id: 'messenger-travel', label: 'Messenger travelling clothes', archetypes: ['adult-male'],
    layers: ['short riding tunic', 'hooded travelling cloak', 'boots', 'satchel on a cross strap'],
    dyes: { main: ['woad-blue', 'russet', 'weld-green'], secondary: ['undyed-brown', 'walnut-brown'], accent: ['ochre', 'undyed-cream'] },
    silhouette: 'Cloak flaring behind a quick walk, satchel and staff.', bannerPresentation: 'Satchel badge in the banner colours once confirmed; undyed before.',
    cuts: STANDARD_CUT },
  { id: 'mason-apron', label: 'Mason apron', archetypes: ['adult-male', 'adolescent'],
    layers: ['linen shirt', 'tunic', 'hose', 'heavy leather apron', 'coif', 'boots'],
    dyes: { main: ['undyed-grey', 'undyed-brown', 'ochre'], secondary: ['walnut-brown'], accent: ['russet', 'undyed-cream'] },
    silhouette: 'Stone-dusted apron and coif, mallet and chisel.', bannerPresentation: null,
    cuts: [cut('standard', 'Short tunic and a heavy leather apron.'), cut('long-tunic', 'Long-sleeved tunic to the knee and a heavy leather apron.')] },
  { id: 'child-tunic', label: 'Child tunic', archetypes: ['child', 'adolescent'],
    layers: ['linen shirt', 'cut-down tunic', 'hose', 'soft shoes or bare feet', 'cord belt'],
    dyes: { main: EARTH.concat(['woad-pale', 'madder-rose']), secondary: ['undyed-brown', 'undyed-grey'], accent: ['ochre', 'russet', 'undyed-cream'] },
    silhouette: 'Small figure in an oversized tunic, often running.', bannerPresentation: null,
    cuts: [cut('knee-tunic', 'Cut-down tunic to the knee.'), cut('short-tunic', 'Short-sleeved tunic above the knee.'), cut('long-smock', 'Loose smock to the calf.'), cut('shoulder-cape', 'Tunic under a closed shoulder cape.')] },
  { id: 'child-dress', label: 'Child dress', archetypes: ['child', 'adolescent'],
    layers: ['linen shift', 'small kirtle', 'apron', 'soft shoes'],
    dyes: { main: ['madder-rose', 'woad-pale', 'weld-yellow', 'russet', 'weld-green', 'undyed-grey'], secondary: ['undyed-cream'], accent: ['madder-red', 'woad-blue', 'ochre'] },
    silhouette: 'Small figure with a full skirt and apron, braids or a ribbon.', bannerPresentation: null,
    cuts: [cut('apron-dress', 'Calf-length dress with a waist apron.'), cut('pinafore', 'Dress with a bib apron.'), cut('short-dress', 'Knee-length dress over the shift, no apron.'), cut('shawl', 'Dress under a small shoulder shawl.')] },
  { id: 'apprentice-m', label: 'Apprentice tunic', archetypes: ['adolescent'],
    layers: ['linen shirt', 'tunic', 'hose', 'small trade apron', 'shoes'],
    dyes: { main: EARTH.concat(['woad-pale']), secondary: ['undyed-brown', 'walnut-brown'], accent: ['ochre', 'russet', 'undyed-cream'] },
    silhouette: 'Lanky figure with a short trade apron carrying for the master.', bannerPresentation: null,
    cuts: [cut('small-apron', 'Short tunic and a small trade apron.'), cut('long-tunic', 'Long-sleeved tunic to the knee and a small apron.'), cut('sleeveless-jerkin', 'Sleeveless jerkin over a long-sleeved tunic.')] },
  { id: 'apprentice-f', label: 'Apprentice kirtle', archetypes: ['adolescent'],
    layers: ['linen shift', 'kirtle', 'apron', 'head-cloth or braids', 'shoes'],
    dyes: { main: ['woad-pale', 'madder-rose', 'weld-green', 'russet', 'weld-yellow'], secondary: ['undyed-cream'], accent: ['walnut-brown', 'woad-blue', 'madder-red'] },
    silhouette: 'Slim figure with apron and a basket or a bundle of work.', bannerPresentation: null,
    cuts: STANDARD_CUT },
  { id: 'elder-m', label: 'Elder tunic and cloak', archetypes: ['elder-male'],
    layers: ['linen shirt', 'long tunic', 'heavy cloak or hood', 'thick hose', 'shoes'],
    dyes: { main: ['undyed-brown', 'walnut-brown', 'undyed-grey', 'russet', 'woad-blue'], secondary: ['undyed-grey', 'undyed-brown'], accent: ['ochre', 'undyed-cream'] },
    silhouette: 'Stooped cloaked figure with a stick.', bannerPresentation: null,
    cuts: [cut('cloak', 'Long tunic under a cloak to the knee.'), cut('shoulder-cape', 'Long tunic to the calf under a short shoulder cape.'), cut('short-cloak', 'Long tunic under a hip-length cloak.')] },
  { id: 'elder-f', label: 'Elder kirtle and shawl', archetypes: ['elder-female'],
    layers: ['linen shift', 'long kirtle', 'heavy shawl', 'head-cloth or wimple', 'shoes'],
    dyes: { main: ['woad-blue', 'undyed-grey', 'walnut-brown', 'lichen-violet', 'russet'], secondary: ['undyed-cream', 'undyed-grey'], accent: ['undyed-brown', 'ochre'] },
    silhouette: 'Small rounded shawled figure, often seated.', bannerPresentation: null,
    cuts: [cut('shawl', 'Long kirtle and a heavy shawl.'), cut('cloak', 'Long kirtle under a cloak to the knee.'), cut('shoulder-cape', 'Long kirtle under a closed shoulder cape.'), cut('apron', 'Long kirtle and a waist apron, no shawl.')] },
  { id: 'existing-household-set', label: 'Built smithy household set (see household-casting.ts)', archetypes: POPULATION_ARCHETYPES,
    layers: ['as built and published'], dyes: { main: ['undyed-cream'], secondary: ['undyed-cream'], accent: ['undyed-cream'] },
    silhouette: 'As built: broad apron; tall column with shawl; small figure in an oversized tunic; hooded figure with a stick.',
    bannerPresentation: 'As in the household casting.',
    cuts: STANDARD_CUT },
] as const satisfies readonly PopulationOutfitKitSpec[]);

export function getOutfitKit(id: PopulationOutfitKit): PopulationOutfitKitSpec {
  for (const kit of POPULATION_OUTFIT_KITS) if (kit.id === id) return kit;
  throw new Error(`Unknown outfit kit ${id}.`);
}

/** `carry`: drawn in place of the clip prop named by the prop's `replaces` while a carry clip plays (same grip). */
export type PopulationPropSocket = 'hand_r' | 'hand_l' | 'both-hands' | 'back' | 'hips' | 'shoulder_r' | 'workplace' | 'carry';
export type PopulationPropKit = 'farm' | 'craft' | 'textile' | 'guard' | 'letters-and-care' | 'everyday' | 'workplace';
export interface PopulationPropSpec {
  readonly id: string; readonly label: string; readonly kit: PopulationPropKit;
  /** Verified Poly Haven CC0 asset already in the household casting, or an original model made by the pipeline. */
  readonly source: `polyhaven:${string}` | 'project-original' | 'household-set';
  readonly trianglesBudget: number;
  /** Two-handed props held as separate parts: the kit node per part (`prop_<id>_<part>`), matching the clip
   * manifest's `part` (art fixer, 8 November: mortar and pestle, the two carding combs, the washing beetle). */
  readonly parts?: readonly string[];
  /** Workplace goods placed at the position and yaw of this workplace prop (the trestle stays shared, the goods
   * follow the seller's trade). Modelled in that prop's base frame. */
  readonly placedWith?: string;
  /** Carry goods drawn in place of this clip prop, with its grip (carry_bundle_walk's linen bundle). */
  readonly replaces?: string;
}

export const POPULATION_PROPS: readonly PopulationPropSpec[] = deepFreeze([
  { id: 'hoe', label: 'Wooden hoe with an iron blade', kit: 'farm', source: 'project-original', trianglesBudget: 160 },
  { id: 'sickle', label: 'Sickle', kit: 'farm', source: 'project-original', trianglesBudget: 120 },
  { id: 'seed-bag', label: 'Seed bag on a strap', kit: 'farm', source: 'project-original', trianglesBudget: 220 },
  { id: 'sack', label: 'Grain or flour sack', kit: 'farm', source: 'project-original', trianglesBudget: 260 },
  { id: 'pitchfork', label: 'Wooden pitchfork', kit: 'farm', source: 'project-original', trianglesBudget: 160 },
  { id: 'crook', label: 'Shepherd crook', kit: 'farm', source: 'project-original', trianglesBudget: 140 },
  { id: 'milk-pail', label: 'Milk pail', kit: 'farm', source: 'polyhaven:wooden_bucket_01', trianglesBudget: 300 },
  { id: 'water-yoke', label: 'Shoulder yoke with two buckets', kit: 'farm', source: 'project-original', trianglesBudget: 520 },
  { id: 'feed-basket', label: 'Feed basket', kit: 'farm', source: 'polyhaven:wicker_basket_01', trianglesBudget: 400 },
  { id: 'saw', label: 'Hand saw', kit: 'craft', source: 'project-original', trianglesBudget: 120 },
  { id: 'plane', label: 'Wooden plane', kit: 'craft', source: 'project-original', trianglesBudget: 140 },
  { id: 'mallet', label: 'Round wooden mallet', kit: 'craft', source: 'household-set', trianglesBudget: 200 },
  { id: 'chisel', label: 'Mason chisel', kit: 'craft', source: 'project-original', trianglesBudget: 60 },
  { id: 'axe', label: 'Felling axe', kit: 'craft', source: 'project-original', trianglesBudget: 160 },
  { id: 'cleaver', label: 'Butcher cleaver', kit: 'craft', source: 'project-original', trianglesBudget: 80 },
  { id: 'awl', label: 'Leather awl and thread', kit: 'craft', source: 'project-original', trianglesBudget: 60 },
  { id: 'hide-scraper', label: 'Two-handled hide scraper', kit: 'craft', source: 'project-original', trianglesBudget: 100 },
  { id: 'ladle', label: 'Long ladle or stirring paddle', kit: 'craft', source: 'project-original', trianglesBudget: 90 },
  { id: 'oven-peel', label: 'Oven peel', kit: 'craft', source: 'project-original', trianglesBudget: 80 },
  { id: 'broom', label: 'Besom broom', kit: 'everyday', source: 'project-original', trianglesBudget: 200 },
  { id: 'hammer-small', label: 'Cooper or cobbler hammer', kit: 'craft', source: 'polyhaven:cross_pein_hammer', trianglesBudget: 160 },
  { id: 'candle-rod', label: 'Candle-dipping rod with wicks', kit: 'craft', source: 'project-original', trianglesBudget: 140 },
  { id: 'distaff', label: 'Distaff with wool', kit: 'textile', source: 'project-original', trianglesBudget: 160 },
  { id: 'carding-combs', label: 'Wool carding combs', kit: 'textile', source: 'project-original', trianglesBudget: 120, parts: ['left', 'right'] },
  { id: 'net-shuttle', label: 'Netting shuttle and cord', kit: 'textile', source: 'project-original', trianglesBudget: 120 },
  { id: 'osier-bundle', label: 'Bundle of willow osiers', kit: 'textile', source: 'project-original', trianglesBudget: 160 },
  { id: 'linen-bundle', label: 'Tied linen bundle', kit: 'textile', source: 'project-original', trianglesBudget: 180 },
  { id: 'spear', label: 'Ash spear', kit: 'guard', source: 'project-original', trianglesBudget: 140 },
  { id: 'round-shield', label: 'Round shield carried on the back', kit: 'guard', source: 'project-original', trianglesBudget: 160 },
  { id: 'bow', label: 'Self bow', kit: 'guard', source: 'project-original', trianglesBudget: 140 },
  { id: 'quiver', label: 'Quiver with arrows', kit: 'guard', source: 'project-original', trianglesBudget: 220 },
  { id: 'sheathed-sword', label: 'Sword in its scabbard', kit: 'guard', source: 'project-original', trianglesBudget: 120 },
  { id: 'arrow-bundle', label: 'Bundle of arrow shafts', kit: 'guard', source: 'project-original', trianglesBudget: 160 },
  { id: 'book', label: 'Bound book', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 80 },
  { id: 'wax-tablet', label: 'Wax tablet and stylus', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 60 },
  { id: 'tally-sticks', label: 'Bundle of tally sticks', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 80 },
  { id: 'keys', label: 'Ring of keys at the belt', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 60 },
  { id: 'satchel', label: 'Leather satchel', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 180 },
  { id: 'herb-basket', label: 'Herb basket', kit: 'letters-and-care', source: 'polyhaven:wicker_basket_01', trianglesBudget: 400 },
  { id: 'mortar-pestle', label: 'Stone mortar and pestle', kit: 'letters-and-care', source: 'project-original', trianglesBudget: 160, parts: ['mortar', 'pestle'] },
  { id: 'walking-staff', label: 'Walking staff', kit: 'everyday', source: 'project-original', trianglesBudget: 60 },
  { id: 'walking-stick', label: 'Walking stick', kit: 'everyday', source: 'household-set', trianglesBudget: 60 },
  { id: 'crutch', label: 'Wooden crutch', kit: 'everyday', source: 'project-original', trianglesBudget: 90 },
  { id: 'bucket', label: 'Wooden bucket', kit: 'everyday', source: 'polyhaven:wooden_bucket_01', trianglesBudget: 300 },
  { id: 'small-bucket', label: 'Small bucket', kit: 'everyday', source: 'polyhaven:wooden_bucket_01', trianglesBudget: 300 },
  { id: 'basket', label: 'Market basket', kit: 'everyday', source: 'polyhaven:wicker_basket_01', trianglesBudget: 400 },
  { id: 'bowl', label: 'Wooden bowl', kit: 'everyday', source: 'polyhaven:wooden_bowl_01', trianglesBudget: 200 },
  { id: 'whittling-knife', label: 'Whittling knife and a stick', kit: 'everyday', source: 'household-set', trianglesBudget: 60 },
  { id: 'kindling-bundle', label: 'Kindling bundle', kit: 'everyday', source: 'household-set', trianglesBudget: 200 },
  { id: 'pebbles', label: 'Handful of pebbles', kit: 'everyday', source: 'project-original', trianglesBudget: 40 },
  { id: 'stool', label: 'Stool', kit: 'workplace', source: 'polyhaven:wooden_stool_01', trianglesBudget: 300 },
  { id: 'loom', label: 'Upright warp-weighted loom', kit: 'workplace', source: 'project-original', trianglesBudget: 900 },
  { id: 'potter-wheel', label: 'Kick wheel', kit: 'workplace', source: 'project-original', trianglesBudget: 500 },
  { id: 'market-trestle', label: 'Market trestle with a cloth', kit: 'workplace', source: 'project-original', trianglesBudget: 300 },
  { id: 'chopping-block', label: 'Chopping block', kit: 'workplace', source: 'project-original', trianglesBudget: 160 },
  { id: 'sawhorse', label: 'Sawhorse with a plank', kit: 'workplace', source: 'project-original', trianglesBudget: 260 },
  { id: 'workbench', label: 'Workbench', kit: 'workplace', source: 'project-original', trianglesBudget: 300 },
  { id: 'hide-beam', label: 'Tanner beam with a hide', kit: 'workplace', source: 'project-original', trianglesBudget: 400 },
  { id: 'butter-churn', label: 'Butter churn', kit: 'workplace', source: 'project-original', trianglesBudget: 220 },
  { id: 'brew-tub', label: 'Brewing or dye tub', kit: 'workplace', source: 'project-original', trianglesBudget: 260 },
  { id: 'fulling-trough', label: 'Fulling trough', kit: 'workplace', source: 'project-original', trianglesBudget: 220 },
  { id: 'stone-block', label: 'Dressed stone on a banker', kit: 'workplace', source: 'project-original', trianglesBudget: 220 },
  { id: 'bread-trough', label: 'Dough trough', kit: 'workplace', source: 'project-original', trianglesBudget: 220 },
  { id: 'washing-board', label: 'Washing stone and beetle', kit: 'workplace', source: 'project-original', trianglesBudget: 220, parts: ['beetle'] },
  { id: 'lectern', label: 'Reading desk', kit: 'workplace', source: 'project-original', trianglesBudget: 240 },
  // art fixer, 8 November: workplaces the role loops name, per-trade goods for the trestle, tools for the straw and rope
  // loops, and carry goods that replace the linen bundle for trades that carry something else
  { id: 'mill-hopper', label: 'Mill hopper on its frame', kit: 'workplace', source: 'project-original', trianglesBudget: 300 },
  { id: 'bakehouse-oven', label: 'Bread oven mouth', kit: 'workplace', source: 'project-original', trianglesBudget: 320 },
  { id: 'stitching-clam', label: 'Saddler stitching clam', kit: 'workplace', source: 'project-original', trianglesBudget: 160 },
  { id: 'tallow-pot', label: 'Tallow pot on a trivet', kit: 'workplace', source: 'project-original', trianglesBudget: 200 },
  { id: 'goods-eggs', label: 'Egg baskets and a hen crate', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'goods-flour', label: 'Flour sacks and a scoop', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'goods-sausages', label: 'Hanging sausages and a board', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'goods-wares', label: 'Pedlar tray of small wares', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'goods-dairy', label: 'Cheeses and butter crocks', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'goods-ale', label: 'Ale jugs and cups', kit: 'workplace', source: 'project-original', trianglesBudget: 450, placedWith: 'market-trestle' },
  { id: 'straw-bundle', label: 'Straw bundle with a twisted band', kit: 'farm', source: 'project-original', trianglesBudget: 160 },
  { id: 'rope-coil', label: 'Rope coil', kit: 'textile', source: 'project-original', trianglesBudget: 200 },
  { id: 'twisting-stick', label: 'Rope twisting stick', kit: 'textile', source: 'project-original', trianglesBudget: 60 },
  { id: 'hide-bundle', label: 'Rolled hides on a strap', kit: 'craft', source: 'project-original', trianglesBudget: 200, replaces: 'linen-bundle' },
  { id: 'shaft-bundle', label: 'Bundle of arrow shafts', kit: 'guard', source: 'project-original', trianglesBudget: 140, replaces: 'linen-bundle' },
  { id: 'osier-armful', label: 'Armful of willow osiers', kit: 'textile', source: 'project-original', trianglesBudget: 140, replaces: 'linen-bundle' },
] as const satisfies readonly PopulationPropSpec[]);

export function getPopulationProp(id: string): PopulationPropSpec | null {
  for (const prop of POPULATION_PROPS) if (prop.id === id) return prop;
  return null;
}

// ------------------------------------------------------------------ motion: clip catalogue and libraries

export type PopulationClipKind = 'idle' | 'locomotion' | 'transition' | 'talk' | 'seated' | 'carry' | 'work' | 'guard' | 'play' | 'care';
export interface PopulationClipSpec {
  readonly id: string; readonly kind: PopulationClipKind; readonly loop: boolean;
  /** Planned source: a 100STYLE take (CC BY 4.0) for captured locomotion, or original keyframes solved by IK. */
  readonly source: `100style:${string}` | 'project-original:keyframe' | 'project-original:synthesised';
  /** Build priority: 1 is needed before any resident of the role is shown working; 2 follows. */
  readonly priority: 1 | 2;
  readonly description: string;
  /**
   * The clip travels over the ground like a walk (in place in the file, with stride and speed in the clip manifest):
   * the caller moves the resident at speedMetresPerSecond x placementScale x rate and it replaces walk while it plays.
   */
  readonly travels?: true;
}

export const POPULATION_CLIPS: readonly PopulationClipSpec[] = deepFreeze([
  { id: 'idle', kind: 'idle', loop: true, source: '100style:Neutral_ID', priority: 1, description: 'Weight-shifting standing idle.' },
  { id: 'idle_b', kind: 'idle', loop: true, source: '100style:Proud_ID', priority: 1, description: 'Upright idle with a different sway rhythm.' },
  { id: 'walk', kind: 'locomotion', loop: true, source: '100style:Neutral_FW', priority: 1, description: 'Neutral walk, foot-locked, in place.' },
  { id: 'walk_b', kind: 'locomotion', loop: true, source: '100style:Proud_FW', priority: 1, description: 'Brisk upright walk.' },
  { id: 'walk_c', kind: 'locomotion', loop: true, source: '100style:Heavyset_FW', priority: 1, description: 'Heavy, tired walk.' },
  { id: 'walk_start', kind: 'transition', loop: false, source: '100style:Neutral_TR1', priority: 1, description: 'Idle to walk, exact at both joins.' },
  { id: 'walk_stop', kind: 'transition', loop: false, source: 'project-original:synthesised', priority: 1, description: 'Walk eased into idle (the household method).' },
  { id: 'talk', kind: 'talk', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Talk built on the idle with small gestures.' },
  { id: 'talk_b', kind: 'talk', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Second talk style with larger gestures.' },
  { id: 'look_around', kind: 'idle', loop: false, source: 'project-original:keyframe', priority: 1, description: 'Pause and glance aside (influence sensitivity), back to the previous pose.' },
  { id: 'sit_down', kind: 'transition', loop: false, source: 'project-original:keyframe', priority: 1, description: 'Lower onto a bench or stool over planted feet.' },
  { id: 'sit', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Seated rest with breathing and small hand moves.' },
  { id: 'stand_up', kind: 'transition', loop: false, source: 'project-original:keyframe', priority: 1, description: 'Rise from the seat over planted feet.' },
  { id: 'walk_stick', kind: 'locomotion', loop: true, source: '100style:WalkingStickLeft_FW', priority: 1, description: 'Walk with a planted stick (the household elder method).' },
  { id: 'idle_stick', kind: 'idle', loop: true, source: '100style:WalkingStickLeft_ID', priority: 1, description: 'Standing idle leaning on a stick.' },
  { id: 'walk_crutch', kind: 'locomotion', loop: true, source: '100style:LimpLeft_FW', priority: 1, description: 'Limping walk with a crutch planted with the weak leg.' },
  { id: 'run', kind: 'locomotion', loop: true, source: '100style:Elated_FR', priority: 1, description: 'Child run.' },
  { id: 'play_chase', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Dodging, tagging and turning in a small circle.' },
  { id: 'play_toss', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Crouch and toss pebbles at a mark.' },
  // role-loop variants (motion fixer, 8 November): residents sharing a role get different loops (ROLE_LOOP_VARIANTS)
  { id: 'play_chase_b', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 2, travels: true, description: 'Running about with arms out, looking back over the shoulder (over the run; travels).' },
  { id: 'play_tag', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Lunging to tag a playmate, springing back and turning.' },
  { id: 'play_hop', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Hopscotch: hopping on one foot and landing on two.' },
  { id: 'play_skip', kind: 'play', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Two-footed skipping with the arms swinging.' },
  { id: 'fetch_carry', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Small bucket carried two-handed with a sideways lean (walk overlay).' },
  { id: 'crouch_gather', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Crouch, pick up sticks, stand, add to the bundle.' },
  { id: 'carry_sack_walk', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Walk with a sack on the shoulder.' },
  { id: 'carry_yoke_walk', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Walk with a shoulder yoke and two buckets.' },
  { id: 'carry_basket_walk', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Walk with a basket on the hip.' },
  { id: 'carry_bundle_walk', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Walk with a bundle held to the chest or on the back.' },
  { id: 'carry_bucket_walk', kind: 'carry', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Walk with one full bucket and a counter-lean.' },
  { id: 'work_hoe', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Hoeing with the blade meeting the ground on each stroke.' },
  { id: 'work_sow', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Broadcast sowing from a seed bag while stepping slowly.' },
  { id: 'work_reap', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Stooped sickle reaping, gathering a handful.' },
  { id: 'work_scatter_feed', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Scattering feed from a basket.' },
  { id: 'work_milk', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated milking into a pail.' },
  { id: 'work_churn', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Butter churning with the dasher.' },
  { id: 'work_herd', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Leaning on a crook, watching, a step and a gesture to the flock.' },
  { id: 'work_saw', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Sawing a plank on the sawhorse, knee on the board.' },
  { id: 'work_plane', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Planing along the workbench.' },
  { id: 'work_chisel', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Mallet and chisel on a dressed stone.' },
  { id: 'work_hammer_bench', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Driving hoops or nails at a bench with a small hammer.' },
  { id: 'work_cobble', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated stitching and tapping a shoe on the lap.' },
  { id: 'work_weave', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Passing the weft and beating up at the upright loom.' },
  { id: 'work_spin_distaff', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Drop spinning from a distaff.' },
  { id: 'work_card_wool', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated carding with two combs.' },
  { id: 'work_weave_basket', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated basket weaving with osiers.' },
  { id: 'work_twist_rope', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Walking back while twisting rope, then netting.' },
  { id: 'work_fletch', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated binding of fletchings to shafts.' },
  { id: 'work_scrape_hide', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Scraping a hide over the beam with both hands.' },
  { id: 'work_stitch_leather', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated saddle stitching with an awl.' },
  { id: 'work_tread_cloth', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Treading cloth in the fulling trough.' },
  { id: 'work_wash_linen', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Kneeling at the washing stone, beating and wringing linen.' },
  { id: 'work_knead', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Kneading dough in the trough.' },
  { id: 'work_oven_peel', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Sliding loaves in and out with the peel.' },
  { id: 'work_stir', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Stirring a pot, brew tub or dye vat with a paddle.' },
  { id: 'work_sell', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'At the trestle: offering goods, haggling, handing over.' },
  { id: 'work_chop_block', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Cleaver strokes at the chopping block.' },
  { id: 'work_chop_wood', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Splitting logs on the block with an axe.' },
  { id: 'work_dip_candles', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Dipping wicks in the tallow pot and hanging the rod.' },
  { id: 'work_throw_pot', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated at the kick wheel, kicking and shaping.' },
  { id: 'work_sweep', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Sweeping with a besom.' },
  { id: 'work_prune', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Reaching up to prune and pick.' },
  { id: 'work_dig', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Digging and turning soil with a spade-like hoe.' },
  { id: 'work_grind_herbs', kind: 'care', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Grinding herbs in a mortar held at the hip.' },
  { id: 'work_gather_herbs', kind: 'care', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Crouching to cut herbs into a basket.' },
  { id: 'work_pray', kind: 'care', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Standing prayer with bowed head, folded hands.' },
  { id: 'work_read', kind: 'care', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Reading from a held book, turning a page.' },
  { id: 'work_write', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated writing on a wax tablet.' },
  { id: 'work_tally', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Counting and notching tally sticks.' },
  { id: 'work_address', kind: 'talk', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Addressing a small group: open gestures, turning to each side.' },
  { id: 'work_address_b', kind: 'talk', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Addressing people with one raised, pointing hand and a firmer stance.' },
  { id: 'work_shell_peas', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated shelling into a bowl on the lap.' },
  { id: 'work_whittle', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated whittling (the household elder method).' },
  { id: 'work_mend_seated', kind: 'seated', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Seated mending of handles and baskets.' },
  { id: 'work_tend_mill', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Hoisting a sack and checking the meal at the spout.' },
  { id: 'work_bundle_straw', kind: 'work', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Kneeling to tie straw and reed bundles.' },
  { id: 'guard_stand_watch', kind: 'guard', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Standing watch with the spear grounded, looking along the approach.' },
  { id: 'guard_stand_watch_b', kind: 'guard', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Watch with the spear grounded in front, both hands on the shaft, shifting weight.' },
  { id: 'guard_stand_watch_c', kind: 'guard', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Watch with the spear sloped on the right shoulder, scanning.' },
  { id: 'guard_stand_watch_d', kind: 'guard', loop: true, source: 'project-original:keyframe', priority: 2, description: 'Watch with the spear grounded in the left hand, the right hand on the belt.' },
  { id: 'guard_patrol_walk', kind: 'guard', loop: true, source: '100style:Neutral_FW', priority: 1, description: 'Measured walk with the spear on the shoulder (upper body keyed over the walk).' },
  { id: 'guard_lookout', kind: 'guard', loop: true, source: 'project-original:keyframe', priority: 1, description: 'Scanning the distance with a hand shading the eyes, bow held long.' },
  { id: 'guard_challenge', kind: 'guard', loop: false, source: 'project-original:keyframe', priority: 2, description: 'Raised hand and a step forward to question a stranger, back to watch.' },
] as const satisfies readonly PopulationClipSpec[]);

export function getPopulationClip(id: string): PopulationClipSpec | null {
  for (const clip of POPULATION_CLIPS) if (clip.id === id) return clip;
  return null;
}

/** Clips every archetype library carries. */
const BASE_CLIPS: readonly string[] = ['idle', 'idle_b', 'walk', 'walk_b', 'walk_c', 'walk_start', 'walk_stop', 'talk', 'talk_b',
  'look_around', 'sit_down', 'sit', 'stand_up'];
const ARCHETYPE_EXTRA_CLIPS: Readonly<Record<PopulationArchetype, readonly string[]>> = {
  'adult-male': [], 'adult-female': [], adolescent: [], child: ['run', 'play_chase', 'play_toss', 'fetch_carry', 'crouch_gather'],
  'elder-male': ['walk_stick', 'idle_stick'], 'elder-female': ['walk_stick', 'idle_stick'],
};

/**
 * Role-loop variants (motion fixer, 8 November): a role's loop is replaced per resident by one of these, the least used
 * so far in the population (ties broken by the resident's own seed), so residents sharing a role do not play one loop in
 * unison. guard_challenge starts on guard_stand_watch's first frame, so a role with the challenge keeps the base watch.
 * `groups` limits a variant set to some groups (elders vary their errand carries).
 */
export const ROLE_LOOP_VARIANTS: Readonly<Record<string, { readonly variants: readonly string[]; readonly groups?: readonly PopulationGroup[] }>> = deepFreeze({
  guard_stand_watch: { variants: ['guard_stand_watch', 'guard_stand_watch_b', 'guard_stand_watch_c', 'guard_stand_watch_d'] },
  play_chase: { variants: ['play_chase', 'play_chase_b', 'play_tag'] },
  play_toss: { variants: ['play_toss', 'play_hop', 'play_skip'] },
  carry_basket_walk: { variants: ['carry_basket_walk', 'carry_bundle_walk'], groups: ['elders-dependents'] },
  work_address: { variants: ['work_address', 'work_address_b'] },
});

// ------------------------------------------------------------------ places

export type PopulationPlaceStatus = 'household-casting-place' | 'proposed-placeholder';
export interface PopulationPlace extends PeopleLifePlace {
  readonly status: PopulationPlaceStatus;
  readonly kind: 'home' | 'workplace' | 'social' | 'service' | 'travel';
}

const PROPOSED_PLACES: readonly (readonly [string, string, PopulationPlace['kind']])[] = [
  ['proposed-house-hall', 'The house hall and its stores (proposed placeholder; also the hall household home)', 'home'],
  ['proposed-church', 'Parish church interior (proposed placeholder)', 'service'],
  ['proposed-fields', 'Arable strips beyond the houses (proposed placeholder)', 'workplace'],
  ['proposed-pasture', 'Common pasture and sheepfold (proposed placeholder)', 'workplace'],
  ['proposed-mill', 'Watermill on the river (proposed placeholder)', 'workplace'],
  ['proposed-tannery', 'Tannery pits downstream (proposed placeholder)', 'workplace'],
  ['proposed-bakehouse', 'Shared bakehouse oven (proposed placeholder)', 'workplace'],
  ['proposed-herb-garden', 'Healer herb garden (proposed placeholder)', 'workplace'],
  ['proposed-watch-post', 'Watch post at the village approach (proposed placeholder)', 'service'],
  ['proposed-guard-yard', 'Guard yard beside the hall (proposed placeholder)', 'service'],
  ['proposed-road-beyond', 'The road beyond the approach, off-screen travel (proposed placeholder)', 'travel'],
  // motion and runtime fixer, 8 November: where crowded slots spill over (spreadCrowdedPlaces)
  ['proposed-lanes', 'Lanes between the houses (proposed placeholder)', 'social'],
  ['proposed-green', 'Village green beside the churchyard (proposed placeholder)', 'social'],
  ['proposed-hedgerows', 'Hedgerows and copse beside the fields (proposed placeholder)', 'workplace'],
];

// ------------------------------------------------------------------ roles

type RoutineKind = 'field' | 'herding' | 'dairy' | 'artisan-home' | 'artisan-away' | 'market' | 'keeper' | 'guard-day'
  | 'guard-night' | 'guard-lead' | 'child' | 'apprentice' | 'elder' | 'dependent' | 'steward' | 'reeve' | 'priest' | 'clerk'
  | 'healer' | 'midwife' | 'mason' | 'messenger' | 'existing';

interface RoleDef {
  readonly id: string; readonly label: string; readonly purpose: string; readonly group: PopulationGroup;
  readonly routine: RoutineKind;
  /** Work place ID; 'home' means the household home. */
  readonly work: string;
  /** Morning and afternoon activities for the routine template. */
  readonly tasks: readonly [string, string];
  /** Secondary place for the afternoon block of some templates (child chores, guard leaders). */
  readonly place2?: string;
  readonly clips: readonly string[];
  readonly kit: { readonly male: PopulationOutfitKit; readonly female: PopulationOutfitKit };
  readonly props: readonly (readonly [string, PopulationPropSocket])[];
  readonly headwear: { readonly male: readonly PopulationHeadwear[]; readonly female: readonly PopulationHeadwear[] };
  readonly wear: PopulationWear;
  readonly walk: 'walk' | 'walk_b' | 'walk_c' | 'walk_stick' | 'walk_crutch' | 'any';
  readonly muscle: number;
  /** Preferred cut of the kit (used when the resident's kit has it), e.g. to keep the healer and the midwife apart. */
  readonly cut?: string;
  /** Worn props given to every second resident of the role (a shield slung on the back), so residents of one role do
   * not share one silhouette. */
  readonly variantProps?: readonly (readonly [string, PopulationPropSocket])[];
  readonly silhouette: string;
}

const K = (male: PopulationOutfitKit, female: PopulationOutfitKit = male) => ({ male, female });
const H = (male: readonly PopulationHeadwear[], female: readonly PopulationHeadwear[] = male) => ({ male, female });
const WOMEN_HEAD: readonly PopulationHeadwear[] = ['head-cloth', 'veil-wimple', 'kerchief', 'head-cloth'];
const MEN_HEAD: readonly PopulationHeadwear[] = ['none', 'coif', 'felt-cap', 'none', 'hood'];
// helmets, a padded or linen coif, or a hood (art fixer, 8 November: the watch was a row of kettle helmets)
const GUARD_HEAD: readonly PopulationHeadwear[] = ['kettle-helmet', 'nasal-helmet', 'padded-coif', 'hood', 'kettle-helmet', 'nasal-helmet', 'coif'];

const ROLES: readonly RoleDef[] = [
  // ---------------- existing smithy household (art and routines as built)
  { id: 'village-smith', label: 'Village smith', purpose: 'Forges and repairs tools, fittings and hardware for the village.', group: 'farmers-artisans-merchants',
    routine: 'existing', work: 'smithy-forge', tasks: ['As built.', 'As built.'], clips: [], kit: K('existing-household-set'), props: [], headwear: H(['none']),
    wear: 'sooty', walk: 'walk', muscle: 0.84, silhouette: 'Broad trapezoid with a long leather apron.' },
  { id: 'spinner-dyer', label: 'Spinner and dyer', purpose: 'Spins yarn and dyes wool and narrow bands for village households.', group: 'farmers-artisans-merchants',
    routine: 'existing', work: 'smithy-house', tasks: ['As built.', 'As built.'], clips: [], kit: K('existing-household-set'), props: [], headwear: H(['head-cloth']),
    wear: 'stained', walk: 'walk', muscle: 0.45, silhouette: 'Tall column with shawl, head-cloth and apron.' },
  { id: 'household-child', label: 'Household child', purpose: 'Runs the household\'s errands while learning the forge and the dye work.', group: 'children-apprentices',
    routine: 'existing', work: 'smithy-forge', tasks: ['As built.', 'As built.'], clips: [], kit: K('existing-household-set'), props: [], headwear: H(['ribbon']),
    wear: 'muddy-hems', walk: 'walk', muscle: 0.45, silhouette: 'Small figure in an oversized tunic and fleece vest.' },
  { id: 'household-elder', label: 'Household elder', purpose: 'Carves wooden ware, mends tool handles and keeps the household\'s practical knowledge.', group: 'elders-dependents',
    routine: 'existing', work: 'smithy-house', tasks: ['As built.', 'As built.'], clips: [], kit: K('existing-household-set'), props: [], headwear: H(['hood']),
    wear: 'worn', walk: 'walk_stick', muscle: 0.35, silhouette: 'Small hooded A-line cloak with a stick.' },

  // ---------------- leaders, clergy and specialists (8)
  { id: 'house-steward', label: 'House steward', purpose: 'Keeps the hall\'s stores, accounts and hearings for the house.', group: 'leaders-clergy-specialists',
    routine: 'steward', work: 'home', tasks: ['Keeps the hall accounts and tallies.', 'Walks the village and checks repairs.'],
    clips: ['work_tally', 'work_address', 'work_read'], kit: K('steward-gown'), props: [['keys', 'hips'], ['tally-sticks', 'hand_l']],
    headwear: H(['none', 'felt-cap']), wear: 'clean', walk: 'walk_b', muscle: 0.45, silhouette: 'Long gown and mantle, keys at the belt.' },
  { id: 'house-messenger', label: 'House messenger', purpose: 'Carries messages and news between the hall and other settlements.', group: 'leaders-clergy-specialists',
    routine: 'messenger', work: 'proposed-road-beyond', tasks: ['Takes the steward\'s messages.', 'Travels the road with messages and news.'],
    clips: ['work_address'], kit: K('messenger-travel'), props: [['satchel', 'hips'], ['walking-staff', 'hand_r']],
    headwear: H(['hood', 'felt-cap', 'none']), wear: 'travel-worn', walk: 'walk_b', muscle: 0.6, silhouette: 'Cloak flaring behind a quick walk, satchel and staff.' },
  { id: 'village-reeve', label: 'Village reeve', purpose: 'Oversees the fields, the labour days and the common pasture for the villagers.', group: 'leaders-clergy-specialists',
    routine: 'reeve', work: 'proposed-fields', tasks: ['Walks the arable strips and sets the day\'s labour.', 'Checks the common pasture and the fences.'],
    clips: ['work_address', 'work_tally', 'work_hoe'], kit: K('field-tunic'), props: [['tally-sticks', 'hand_l'], ['walking-staff', 'hand_r']],
    headwear: H(['felt-cap', 'straw-hat', 'hood']), wear: 'muddy-hems', walk: 'walk', muscle: 0.6, silhouette: 'Field tunic, staff in hand, pointing out the strips.' },
  { id: 'parish-priest', label: 'Parish priest', purpose: 'Keeps the church, its services, burials and visits to the sick.', group: 'leaders-clergy-specialists',
    routine: 'priest', work: 'proposed-church', tasks: ['Keeps the morning office and tends the altar.', 'Reads and prepares the coming services.'],
    clips: ['work_pray', 'work_read', 'work_address'], kit: K('clergy-cassock'), props: [['book', 'hand_l']],
    headwear: H(['none']), wear: 'clean', walk: 'walk', muscle: 0.4, silhouette: 'Dark ankle-length column with a hooded cape and a book.' },
  { id: 'parish-clerk', label: 'Parish clerk', purpose: 'Keeps the church records, rings the bell and teaches letters.', group: 'leaders-clergy-specialists',
    routine: 'clerk', work: 'proposed-church', tasks: ['Copies the church records.', 'Teaches letters to the children who come.'],
    clips: ['work_read', 'work_write', 'work_pray'], kit: K('clerk-robe'), props: [['book', 'hand_l'], ['wax-tablet', 'hips']],
    headwear: H(['coif']), wear: 'clean', walk: 'walk', muscle: 0.4, silhouette: 'Long plain robe and coif, a book under the arm.' },
  { id: 'healer-herbalist', label: 'Healer and herbalist', purpose: 'Grows and prepares herbs and tends the sick and injured.', group: 'leaders-clergy-specialists',
    routine: 'healer', work: 'proposed-herb-garden', tasks: ['Grinds and steeps herbs at home.', 'Gathers herbs at the woodland edge.'],
    clips: ['work_grind_herbs', 'work_gather_herbs', 'carry_basket_walk'], kit: K('healer-kirtle'), props: [['herb-basket', 'hand_l'], ['mortar-pestle', 'hand_r'], ['satchel', 'hips']],
    headwear: H(['head-cloth', 'kerchief']), wear: 'worn', walk: 'walk', muscle: 0.45, cut: 'dark-overgown', silhouette: 'Dark overgown, shawl and herb satchel, a basket of herbs on the arm.' },
  { id: 'midwife', label: 'Midwife', purpose: 'Attends births and advises mothers on the care of newborns.', group: 'leaders-clergy-specialists',
    routine: 'midwife', work: 'village-courtyard', tasks: ['Visits mothers and newborns.', 'Sits with an expectant mother.'],
    clips: ['work_grind_herbs', 'carry_bundle_walk', 'carry_basket_walk'], kit: K('healer-kirtle'), props: [['satchel', 'hips'], ['linen-bundle', 'hand_l']],
    headwear: H(['hood']), wear: 'clean', walk: 'walk_b', muscle: 0.45, cut: 'hooded-mantle', silhouette: 'Hooded mantle to the knee, a satchel and folded linen.' },
  { id: 'master-mason', label: 'Master mason', purpose: 'Keeps the church, the walls and the well head in repair.', group: 'leaders-clergy-specialists',
    routine: 'mason', work: 'churchyard', tasks: ['Dresses stone for the church repairs.', 'Repairs the stone walls and the well head.'],
    clips: ['work_chisel', 'carry_bundle_walk', 'work_address'], kit: K('mason-apron'), props: [['mallet', 'hand_r'], ['chisel', 'hand_l'], ['stone-block', 'workplace']],
    headwear: H(['coif', 'felt-cap']), wear: 'flour-dusted', walk: 'walk_c', muscle: 0.75, silhouette: 'Stone-dusted apron and coif, mallet and chisel.' },

  // ---------------- guards and military (15)
  { id: 'guard-captain', label: 'Guard captain', purpose: 'Leads the village guard and sets the watches.', group: 'guards-military',
    routine: 'guard-lead', work: 'proposed-guard-yard', tasks: ['Drills the watch in the guard yard.', 'Confers at the hall about the watch.'], place2: 'proposed-house-hall',
    clips: ['guard_stand_watch', 'guard_patrol_walk', 'work_address'], kit: K('guard-captain'), props: [['sheathed-sword', 'hips']],
    headwear: H(['none', 'nasal-helmet']), wear: 'worn', walk: 'walk_b', muscle: 0.75, silhouette: 'Surcoat over mail, sword at the hip, upright stride.' },
  { id: 'guard-serjeant', label: 'Guard serjeant', purpose: 'Drills the watch and keeps the guard\'s gear in order.', group: 'guards-military',
    routine: 'guard-lead', work: 'proposed-guard-yard', tasks: ['Drills recruits and spearmen.', 'Inspects and mends the guard\'s gear.'], place2: 'proposed-guard-yard',
    clips: ['guard_stand_watch', 'guard_patrol_walk', 'work_address'], kit: K('guard-gambeson'), props: [['spear', 'hand_r']],
    headwear: H(GUARD_HEAD), wear: 'worn', walk: 'walk_b', muscle: 0.8, silhouette: 'Bulky quilted torso, helmet and an upright spear.' },
  { id: 'gate-ward', label: 'Gate-ward', purpose: 'Keeps the approach and questions strangers.', group: 'guards-military',
    routine: 'guard-day', work: 'proposed-watch-post', tasks: ['Keeps the approach and questions travellers.', 'Patrols the lanes, the well and the courtyard.'],
    clips: ['guard_stand_watch', 'guard_patrol_walk', 'guard_challenge'], kit: K('guard-gambeson'), props: [['spear', 'hand_r'], ['round-shield', 'back']],
    headwear: H(GUARD_HEAD), wear: 'worn', walk: 'walk', muscle: 0.7, silhouette: 'Older guard, shield on the back, spear grounded.' },
  { id: 'spearman', label: 'Spearman of the watch', purpose: 'Stands the watch and patrols the village.', group: 'guards-military',
    routine: 'guard-day', work: 'proposed-watch-post', tasks: ['Stands the morning watch at the approach.', 'Patrols the lanes, the well and the courtyard.'],
    clips: ['guard_stand_watch', 'guard_patrol_walk'], kit: K('guard-gambeson'), props: [['spear', 'hand_r']], variantProps: [['round-shield', 'back']],
    headwear: H(GUARD_HEAD), wear: 'worn', walk: 'any', muscle: 0.72, silhouette: 'Quilted torso, helmet and an upright spear, some with a shield on the back.' },
  { id: 'night-spearman', label: 'Spearman of the night watch', purpose: 'Stands the night watch and sleeps by day.', group: 'guards-military',
    routine: 'guard-night', work: 'proposed-watch-post', tasks: ['Stands the night watch at the approach.', 'Helps at home after waking.'],
    clips: ['guard_stand_watch', 'guard_patrol_walk'], kit: K('guard-gambeson'), props: [['spear', 'hand_r'], ['round-shield', 'back']],
    headwear: H(GUARD_HEAD), wear: 'worn', walk: 'any', muscle: 0.72, silhouette: 'Quilted torso, shield on the back and a spear.' },
  { id: 'lookout-archer', label: 'Lookout and archer', purpose: 'Watches the approaches from the watch post.', group: 'guards-military',
    routine: 'guard-day', work: 'proposed-watch-post', tasks: ['Keeps the lookout over the approaches.', 'Walks the edge of the village and the woodland path.'],
    clips: ['guard_lookout', 'guard_patrol_walk'], kit: K('guard-archer'), props: [['bow', 'hand_l'], ['quiver', 'hips']],
    headwear: H(['hood', 'padded-coif']), wear: 'worn', walk: 'walk_b', muscle: 0.65, silhouette: 'Hooded jack, a bow held long and a quiver at the hip.' },
  { id: 'guard-recruit', label: 'Guard recruit', purpose: 'Learns the watch under the serjeant.', group: 'guards-military',
    routine: 'guard-day', work: 'proposed-watch-post', tasks: ['Stands the watch beside an older guard.', 'Drills and runs errands for the serjeant.'],
    clips: ['guard_stand_watch', 'guard_patrol_walk', 'carry_bundle_walk'], kit: K('guard-gambeson'), props: [['spear', 'hand_r']],
    headwear: H(['padded-coif', 'kettle-helmet']), wear: 'clean', walk: 'walk', muscle: 0.6, silhouette: 'Young guard in a gambeson too big for him.' },

  // ---------------- farmers, artisans and merchants
  { id: 'hall-cook', label: 'Hall cook', purpose: 'Cooks for the hall household and its guests.', group: 'farmers-artisans-merchants',
    routine: 'keeper', work: 'home', tasks: ['Cooks and bakes for the hall.', 'Keeps the hall kitchen and stores.'],
    clips: ['work_stir', 'work_knead', 'carry_basket_walk'], kit: K('hall-livery'), props: [['ladle', 'hand_r'], ['brew-tub', 'workplace']],
    headwear: H(['coif'], ['kerchief', 'head-cloth']), wear: 'stained', walk: 'walk', muscle: 0.55, silhouette: 'Neat kirtle with a kitchen apron and a ladle.' },
  { id: 'hall-groom', label: 'Hall groom and servant', purpose: 'Keeps the hall\'s horses, firewood and errands.', group: 'farmers-artisans-merchants',
    routine: 'keeper', work: 'home', tasks: ['Mucks out and feeds the hall horses.', 'Carries firewood and water for the hall.'],
    clips: ['work_sweep', 'carry_bundle_walk', 'carry_bucket_walk'], kit: K('hall-livery'), props: [['pitchfork', 'hand_r'], ['broom', 'hand_r']],
    headwear: H(['none', 'felt-cap']), wear: 'muddy-hems', walk: 'any', muscle: 0.65, silhouette: 'Neat tunic with a sleeve band and a pitchfork.' },
  { id: 'dairy-keeper', label: 'Dairy keeper', purpose: 'Milks, churns and makes cheese for the household and the market.', group: 'farmers-artisans-merchants',
    routine: 'dairy', work: 'home', tasks: ['Churns butter and presses cheese.', 'Scalds the pails and turns the cheeses.'],
    clips: ['work_milk', 'work_churn', 'carry_yoke_walk', 'work_sell'], kit: K('field-tunic', 'field-kirtle'), props: [['milk-pail', 'hand_r'], ['butter-churn', 'workplace'], ['market-trestle', 'workplace'], ['goods-dairy', 'workplace']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'worn', walk: 'any', muscle: 0.55, silhouette: 'Apron and kilted skirt, a yoke of pails.' },
  { id: 'field-farmer', label: 'Field farmer', purpose: 'Ploughs, sows, hoes and harvests the household\'s arable strips.', group: 'farmers-artisans-merchants',
    routine: 'field', work: 'proposed-fields', tasks: ['Ploughs, hoes or sows the arable strips.', 'Field work by season: weeding, reaping or carting.'],
    clips: ['work_hoe', 'work_sow', 'work_reap', 'carry_sack_walk'], kit: K('field-tunic', 'field-kirtle'), props: [['hoe', 'hand_r'], ['seed-bag', 'hips'], ['sickle', 'hips']],
    headwear: H(['straw-hat', 'none', 'hood', 'felt-cap'], ['head-cloth', 'straw-hat', 'kerchief']), wear: 'muddy-hems', walk: 'any', muscle: 0.68,
    silhouette: 'Short tunic or kilted skirt, a hoe on the shoulder.' },
  { id: 'church-keeper', label: 'Church-house keeper', purpose: 'Keeps the church house and garden and rings the bell.', group: 'farmers-artisans-merchants',
    routine: 'keeper', work: 'proposed-church', tasks: ['Sweeps the church and trims the lamps.', 'Tends the church-house garden.'],
    clips: ['work_sweep', 'work_dig', 'carry_basket_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['broom', 'hand_r'], ['basket', 'hand_l']],
    headwear: H(['coif'], ['veil-wimple']), wear: 'clean', walk: 'walk', muscle: 0.45, silhouette: 'Wimpled figure with a broom.' },
  { id: 'weaver', label: 'Weaver', purpose: 'Weaves cloth on the household loom.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Weaves at the upright loom.', 'Warps the loom and winds bobbins.'],
    clips: ['work_weave', 'work_card_wool', 'carry_basket_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['loom', 'workplace'], ['basket', 'hand_l']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'clean', walk: 'any', muscle: 0.45, silhouette: 'Apron and pinned sleeves, often at the loom.' },
  { id: 'thatcher', label: 'Thatcher', purpose: 'Cuts reed and straw and keeps the roofs sound.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'village-courtyard', tasks: ['Ties straw and reed bundles.', 'Patches a roof with fresh thatch.'],
    clips: ['work_bundle_straw', 'carry_bundle_walk'], kit: K('field-tunic'), props: [['osier-bundle', 'back'], ['straw-bundle', 'both-hands']],
    headwear: H(['straw-hat', 'hood']), wear: 'worn', walk: 'walk_c', muscle: 0.7, silhouette: 'Short tunic and a bundle of straw on the back.' },
  { id: 'cobbler', label: 'Cobbler', purpose: 'Makes and mends shoes.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Stitches uppers and soles at the bench.', 'Mends shoes brought in by neighbours.'],
    clips: ['work_cobble', 'work_hammer_bench'], kit: K('workshop-apron-m'), props: [['awl', 'hand_r'], ['hammer-small', 'hand_r'], ['stool', 'workplace']],
    headwear: H(['coif', 'none']), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Seated aproned figure bent over a shoe.' },
  { id: 'baker', label: 'Baker', purpose: 'Bakes bread at the shared oven.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'proposed-bakehouse', tasks: ['Kneads and bakes the morning batch.', 'Bakes for households who bring dough.'],
    clips: ['work_knead', 'work_oven_peel', 'carry_basket_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['oven-peel', 'both-hands'], ['bread-trough', 'workplace'], ['bakehouse-oven', 'workplace']],
    headwear: H(['coif'], ['kerchief']), wear: 'flour-dusted', walk: 'any', muscle: 0.6, silhouette: 'Floury apron and a long peel.' },
  { id: 'brewster', label: 'Brewster and alewife', purpose: 'Brews ale and sells it from the house.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Sells ale from the stall in the courtyard.', 'Mashes and brews the next batch.'],
    clips: ['work_stir', 'work_sell', 'carry_bucket_walk'], kit: K('market-m', 'market-f'), props: [['ladle', 'hand_r'], ['brew-tub', 'workplace'], ['market-trestle', 'workplace'], ['goods-ale', 'workplace']],
    headwear: H(MEN_HEAD, ['head-cloth', 'veil-wimple']), wear: 'stained', walk: 'walk_b', muscle: 0.55, silhouette: 'Coloured gown, a jug and a stall.' },
  { id: 'potter', label: 'Potter', purpose: 'Throws and fires pots, jugs and lamps.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Throws pots at the kick wheel.', 'Stacks and fires the kiln.'],
    clips: ['work_throw_pot', 'carry_basket_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['potter-wheel', 'workplace']],
    headwear: H(MEN_HEAD, ['kerchief', 'head-cloth']), wear: 'stained', walk: 'any', muscle: 0.5, silhouette: 'Clay-spattered apron at the wheel.' },
  { id: 'poultry-seller', label: 'Poultry and egg seller', purpose: 'Keeps hens and geese and sells eggs and birds at the market.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Sells eggs and birds at the courtyard market.', 'Feeds the birds and gathers eggs.'],
    clips: ['work_sell', 'work_scatter_feed', 'carry_basket_walk'], kit: K('market-m', 'market-f'), props: [['basket', 'hand_l'], ['market-trestle', 'workplace'], ['goods-eggs', 'workplace']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Gown and a basket of eggs on the hip.' },
  { id: 'netmaker', label: 'Rope and net maker', purpose: 'Twists rope and knots nets for the village.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Twists rope along the lane.', 'Knots and mends nets.'],
    clips: ['work_twist_rope', 'work_mend_seated'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['net-shuttle', 'hand_r'], ['rope-coil', 'hand_l'], ['twisting-stick', 'hand_r']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Walking backwards paying out rope.' },
  { id: 'fletcher', label: 'Fletcher', purpose: 'Makes arrows for the watch.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Straightens and fletches arrow shafts.', 'Fits heads and bundles arrows for the watch.'],
    clips: ['work_fletch', 'carry_bundle_walk'], kit: K('workshop-apron-m'), props: [['arrow-bundle', 'hand_l'], ['stool', 'workplace'], ['shaft-bundle', 'carry']],
    headwear: H(['none', 'felt-cap', 'hood']), wear: 'clean', walk: 'any', muscle: 0.5, silhouette: 'Seated with a bundle of shafts across the knees.' },
  { id: 'miller', label: 'Miller', purpose: 'Grinds the village\'s grain at the watermill.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'proposed-mill', tasks: ['Grinds grain and dresses the stones.', 'Weighs and bags meal for each household.'],
    clips: ['work_tend_mill', 'carry_sack_walk'], kit: K('miller-smock'), props: [['sack', 'shoulder_r'], ['mill-hopper', 'workplace']],
    headwear: H(['coif', 'felt-cap']), wear: 'flour-dusted', walk: 'walk_c', muscle: 0.72, silhouette: 'Pale floury smock and a sack on the shoulder.' },
  { id: 'flour-seller', label: 'Flour and meal seller', purpose: 'Sells flour and meal from the mill at the market.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Sells flour and meal at the courtyard market.', 'Sieves and bags meal at the mill house.'],
    clips: ['work_sell', 'carry_sack_walk'], kit: K('market-m', 'market-f'), props: [['sack', 'shoulder_r'], ['market-trestle', 'workplace'], ['goods-flour', 'workplace']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'flour-dusted', walk: 'any', muscle: 0.55, silhouette: 'Floury gown and a small sack.' },
  { id: 'carpenter', label: 'Carpenter', purpose: 'Builds and repairs frames, doors, carts and furniture.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Saws and planes timber in the yard.', 'Joins frames and fits doors around the village.'],
    clips: ['work_saw', 'work_plane', 'carry_bundle_walk'], kit: K('workshop-apron-m'), props: [['saw', 'hand_r'], ['plane', 'hand_r'], ['sawhorse', 'workplace']],
    headwear: H(['none', 'coif', 'felt-cap']), wear: 'worn', walk: 'any', muscle: 0.72, silhouette: 'Aproned figure with a saw, a plank on the sawhorse.' },
  { id: 'basket-weaver', label: 'Basket weaver', purpose: 'Weaves baskets, creels and hurdles from willow.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Weaves baskets at the doorstep.', 'Cuts and soaks willow by the pond.'],
    clips: ['work_weave_basket', 'carry_bundle_walk'], kit: K('workshop-apron-f'), props: [['osier-bundle', 'back'], ['stool', 'workplace'], ['osier-armful', 'carry']],
    headwear: H(WOMEN_HEAD), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Seated with a half-woven basket between the knees.' },
  { id: 'master-weaver', label: 'Master weaver', purpose: 'Weaves the village\'s finer cloth and trains the weaving apprentice.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Weaves fine cloth at the loom.', 'Shows the apprentice the warp and the pattern.'],
    clips: ['work_weave', 'work_card_wool', 'work_address'], kit: K('workshop-apron-f'), props: [['loom', 'workplace']],
    headwear: H(['veil-wimple', 'head-cloth']), wear: 'clean', walk: 'walk_b', muscle: 0.45, silhouette: 'Upright figure at a tall loom, wimple and apron.' },
  { id: 'fuller', label: 'Fuller', purpose: 'Washes and thickens woven cloth.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'riverside-bank', tasks: ['Treads cloth in the fulling trough.', 'Stretches cloth to dry on the frames.'],
    clips: ['work_tread_cloth', 'carry_bundle_walk'], kit: K('workshop-apron-m'), props: [['fulling-trough', 'workplace']],
    headwear: H(['none', 'coif']), wear: 'stained', walk: 'any', muscle: 0.65, silhouette: 'Bare-legged in a trough, tunic tucked up.' },
  { id: 'tanner', label: 'Tanner', purpose: 'Tans hides at the pits downstream.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'proposed-tannery', tasks: ['Scrapes hides over the beam.', 'Turns hides in the pits.'],
    clips: ['work_scrape_hide', 'carry_bundle_walk'], kit: K('workshop-apron-m'), props: [['hide-scraper', 'both-hands'], ['hide-beam', 'workplace'], ['hide-bundle', 'carry']],
    headwear: H(['none', 'coif']), wear: 'stained', walk: 'walk_c', muscle: 0.75, silhouette: 'Stained leather apron, bent over the beam.' },
  { id: 'saddler', label: 'Saddler and leatherworker', purpose: 'Makes harness, belts, bags and sheaths.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Stitches harness and belts at the bench.', 'Cuts and dyes leather.'],
    clips: ['work_stitch_leather', 'carry_bundle_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['awl', 'hand_r'], ['stool', 'workplace'], ['stitching-clam', 'workplace'], ['hide-bundle', 'carry']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Seated with leather across the knees.' },
  { id: 'cooper', label: 'Cooper', purpose: 'Makes casks, tubs and buckets.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Raises staves and drives hoops.', 'Shapes staves with the drawknife.'],
    clips: ['work_hammer_bench', 'work_plane', 'carry_bundle_walk'], kit: K('workshop-apron-m'), props: [['hammer-small', 'hand_r'], ['workbench', 'workplace']],
    headwear: H(['none', 'felt-cap']), wear: 'worn', walk: 'walk_c', muscle: 0.7, silhouette: 'Aproned figure circling a cask with a hammer.' },
  { id: 'pedlar', label: 'Pedlar and market trader', purpose: 'Trades small goods at the market and along the road.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Trades needles, ribbons and salt at the market.', 'Sorts and packs goods at home.'],
    clips: ['work_sell', 'carry_bundle_walk', 'carry_basket_walk'], kit: K('market-m', 'market-f'), props: [['basket', 'hand_l'], ['market-trestle', 'workplace'], ['goods-wares', 'workplace']],
    headwear: H(MEN_HEAD, ['head-cloth', 'kerchief']), wear: 'travel-worn', walk: 'walk_b', muscle: 0.5, silhouette: 'Bright gown and a laden basket.' },
  { id: 'candle-maker', label: 'Candle maker', purpose: 'Dips tallow and beeswax candles for the church and the houses.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Dips candles over the tallow pot.', 'Trims and bundles candles for the church.'],
    clips: ['work_dip_candles', 'carry_basket_walk'], kit: K('workshop-apron-m', 'workshop-apron-f'), props: [['candle-rod', 'both-hands'], ['tallow-pot', 'workplace']],
    headwear: H(MEN_HEAD, ['kerchief', 'head-cloth']), wear: 'stained', walk: 'any', muscle: 0.45, silhouette: 'Apron and a rod of hanging candles.' },
  { id: 'shepherd', label: 'Shepherd', purpose: 'Keeps the village flock on the common pasture.', group: 'farmers-artisans-merchants',
    routine: 'herding', work: 'proposed-pasture', tasks: ['Moves the flock to fresh grazing.', 'Watches the flock and checks the lambs.'],
    clips: ['work_herd', 'carry_bundle_walk'], kit: K('herder-cloak'), props: [['crook', 'hand_r']],
    headwear: H(['hood', 'felt-cap', 'straw-hat']), wear: 'muddy-hems', walk: 'walk', muscle: 0.62, silhouette: 'Hooded cape and a long crook.' },
  { id: 'swineherd', label: 'Swineherd', purpose: 'Drives the pigs to the woodland edge and back.', group: 'farmers-artisans-merchants',
    routine: 'herding', work: 'woodland-edge', tasks: ['Drives the pigs to the woodland edge.', 'Watches the pigs under the trees.'],
    clips: ['work_herd', 'carry_bucket_walk'], kit: K('herder-cloak'), props: [['walking-staff', 'hand_r']],
    headwear: H(['hood', 'felt-cap']), wear: 'muddy-hems', walk: 'any', muscle: 0.6, silhouette: 'Hooded figure with a staff among the pigs.' },
  { id: 'orchard-keeper', label: 'Orchard keeper and beekeeper', purpose: 'Keeps the orchard, the hives and the wax.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Prunes and picks in the orchard.', 'Tends the hives and takes the wax.'],
    clips: ['work_prune', 'carry_basket_walk'], kit: K('field-tunic'), props: [['basket', 'hand_l']],
    headwear: H(['straw-hat', 'hood']), wear: 'worn', walk: 'walk_c', muscle: 0.55, silhouette: 'Straw hat, reaching up into a tree.' },
  { id: 'gardener', label: 'Vegetable gardener', purpose: 'Grows vegetables and beans for the household and the market.', group: 'farmers-artisans-merchants',
    routine: 'field', work: 'home', tasks: ['Digs and plants the vegetable plots.', 'Weeds and waters the beans and cabbages.'],
    clips: ['work_dig', 'work_hoe', 'carry_basket_walk'], kit: K('field-tunic', 'field-kirtle'), props: [['hoe', 'hand_r'], ['basket', 'hand_l']],
    headwear: H(['straw-hat', 'none'], ['head-cloth', 'straw-hat']), wear: 'muddy-hems', walk: 'any', muscle: 0.55, silhouette: 'Kilted skirt and a hoe among the beds.' },
  { id: 'butcher', label: 'Butcher', purpose: 'Slaughters and cuts meat for the households.', group: 'farmers-artisans-merchants',
    routine: 'artisan-home', work: 'home', tasks: ['Cuts and hangs meat at the block.', 'Salts and smokes meat for winter.'],
    clips: ['work_chop_block', 'carry_sack_walk'], kit: K('workshop-apron-m'), props: [['cleaver', 'hand_r'], ['chopping-block', 'workplace']],
    headwear: H(['none', 'coif']), wear: 'stained', walk: 'walk_c', muscle: 0.75, silhouette: 'Heavy apron and a cleaver at the block.' },
  { id: 'sausage-seller', label: 'Sausage maker and market seller', purpose: 'Makes sausages and puddings and sells them at the market.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Sells sausages and puddings at the market.', 'Stuffs and smokes sausages at home.'],
    clips: ['work_sell', 'work_stir'], kit: K('market-m', 'market-f'), props: [['basket', 'hand_l'], ['market-trestle', 'workplace'], ['goods-sausages', 'workplace']],
    headwear: H(MEN_HEAD, WOMEN_HEAD), wear: 'stained', walk: 'any', muscle: 0.55, silhouette: 'Gown with a stained apron and a laden basket.' },
  { id: 'milkmaid', label: 'Milkmaid', purpose: 'Milks the village cows and carries the pails.', group: 'farmers-artisans-merchants',
    routine: 'dairy', work: 'home', tasks: ['Carries milk to the households.', 'Scrubs the pails and the dairy.'],
    clips: ['work_milk', 'carry_yoke_walk'], kit: K('field-kirtle'), props: [['water-yoke', 'shoulder_r'], ['milk-pail', 'hand_r']],
    headwear: H(['kerchief', 'head-cloth']), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Yoke of pails across the shoulders.' },
  { id: 'goose-keeper', label: 'Goose keeper and market helper', purpose: 'Herds the geese and helps at the market stall.', group: 'farmers-artisans-merchants',
    routine: 'market', work: 'village-courtyard', tasks: ['Helps at the poultry stall.', 'Drives the geese to the pond and back.'],
    clips: ['work_scatter_feed', 'work_sell', 'work_herd'], kit: K('field-kirtle'), props: [['walking-staff', 'hand_r'], ['feed-basket', 'hand_l'], ['market-trestle', 'workplace'], ['goods-eggs', 'workplace']],
    headwear: H(['kerchief', 'none']), wear: 'muddy-hems', walk: 'walk_b', muscle: 0.5, silhouette: 'Slim figure with a switch driving geese.' },
  { id: 'woodcutter', label: 'Woodcutter', purpose: 'Fells and splits firewood at the woodland edge.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'woodland-edge', tasks: ['Fells and splits wood at the woodland edge.', 'Carts and stacks firewood for the households.'],
    clips: ['work_chop_wood', 'carry_bundle_walk'], kit: K('field-tunic'), props: [['axe', 'hand_r'], ['chopping-block', 'workplace']],
    headwear: H(['hood', 'none', 'felt-cap']), wear: 'worn', walk: 'walk_c', muscle: 0.8, silhouette: 'Broad figure with an axe on the shoulder.' },
  { id: 'laundress', label: 'Laundress', purpose: 'Washes linen for the hall and the households at the river.', group: 'farmers-artisans-merchants',
    routine: 'artisan-away', work: 'riverside-bank', tasks: ['Washes and beats linen at the river.', 'Spreads linen to dry and folds it.'],
    clips: ['work_wash_linen', 'carry_basket_walk'], kit: K('field-kirtle'), props: [['basket', 'hand_l'], ['washing-board', 'workplace']],
    headwear: H(['kerchief', 'head-cloth']), wear: 'worn', walk: 'any', muscle: 0.55, silhouette: 'Kilted skirt and a basket of linen on the hip.' },

  // ---------------- children and apprentices
  { id: 'village-child', label: 'Village child', purpose: 'Plays, runs errands and helps with small chores.', group: 'children-apprentices',
    routine: 'child', work: 'village-well', tasks: ['Fetches water for the household.', 'Helps at home with small chores.'], place2: 'home',
    clips: ['play_chase', 'play_toss', 'fetch_carry'], kit: K('child-tunic', 'child-dress'), props: [['small-bucket', 'both-hands'], ['pebbles', 'hand_r']],
    headwear: H(['none', 'hood'], ['none', 'ribbon', 'kerchief']), wear: 'muddy-hems', walk: 'any', muscle: 0.45, silhouette: 'Small running figure, often carrying something.' },
  { id: 'goose-child', label: 'Child who minds the geese', purpose: 'Minds the household\'s geese and runs errands.', group: 'children-apprentices',
    routine: 'child', work: 'village-pond', tasks: ['Drives the geese to the pond edge.', 'Helps at home with small chores.'], place2: 'home',
    clips: ['play_chase', 'fetch_carry', 'crouch_gather'], kit: K('child-tunic', 'child-dress'), props: [['walking-staff', 'hand_r']],
    headwear: H(['none'], ['ribbon', 'kerchief']), wear: 'muddy-hems', walk: 'any', muscle: 0.45, silhouette: 'Small figure with a long switch among geese.' },
  { id: 'church-ward', label: 'Church ward', purpose: 'Helps the priest and the keeper, rings the small bell and learns letters.', group: 'children-apprentices',
    routine: 'child', work: 'proposed-church', tasks: ['Sweeps the church porch.', 'Learns letters with the parish clerk.'], place2: 'proposed-church',
    clips: ['play_chase', 'fetch_carry', 'crouch_gather'], kit: K('child-tunic'), props: [['broom', 'hand_r']],
    headwear: H(['none', 'hood']), wear: 'clean', walk: 'any', muscle: 0.42, silhouette: 'Small figure in a plain tunic with a broom.' },
  { id: 'shepherd-child', label: 'Shepherd\'s child', purpose: 'Helps with the flock and runs errands.', group: 'children-apprentices',
    routine: 'child', work: 'proposed-pasture', tasks: ['Helps bring the flock out to pasture.', 'Watches the lambs with the shepherd.'], place2: 'proposed-pasture',
    clips: ['play_chase', 'fetch_carry', 'crouch_gather'], kit: K('child-tunic'), props: [['crook', 'hand_r']],
    headwear: H(['hood', 'none']), wear: 'muddy-hems', walk: 'any', muscle: 0.47, silhouette: 'Small hooded figure with a crook taller than itself.' },
  { id: 'hall-page', label: 'Hall page and letters apprentice', purpose: 'Runs errands for the hall and learns letters and accounts.', group: 'children-apprentices',
    routine: 'apprentice', work: 'proposed-house-hall', tasks: ['Learns letters and the hall accounts.', 'Carries messages around the village for the hall.'],
    clips: ['work_write', 'work_read', 'carry_bundle_walk'], kit: K('hall-livery'), props: [['wax-tablet', 'hand_l']],
    headwear: H(['none', 'felt-cap']), wear: 'clean', walk: 'walk_b', muscle: 0.42, silhouette: 'Neat lanky figure with a sleeve band and a tablet.' },
  { id: 'healer-apprentice', label: 'Healer\'s apprentice', purpose: 'Learns herbs and simple care from the healer.', group: 'children-apprentices',
    routine: 'apprentice', work: 'proposed-herb-garden', tasks: ['Weeds and picks in the herb garden.', 'Grinds and bundles herbs beside the healer.'],
    clips: ['work_grind_herbs', 'work_gather_herbs', 'carry_basket_walk'], kit: K('apprentice-m', 'healer-kirtle'), props: [['herb-basket', 'hand_l']],
    headwear: H(['none'], ['head-cloth', 'none']), wear: 'clean', walk: 'any', muscle: 0.42, cut: 'apron-shawl', silhouette: 'Slim apprentice with a basket of herbs.' },
  { id: 'cobbler-apprentice', label: 'Cobbler\'s apprentice', purpose: 'Learns shoemaking at the family bench.', group: 'children-apprentices',
    routine: 'apprentice', work: 'home', tasks: ['Cuts soles and waxes thread.', 'Stitches simple shoes at the bench.'],
    clips: ['work_cobble', 'carry_bundle_walk'], kit: K('apprentice-m'), props: [['awl', 'hand_r'], ['stool', 'workplace']],
    headwear: H(['none', 'coif']), wear: 'worn', walk: 'any', muscle: 0.45, silhouette: 'Lanky seated figure with a shoe on the knee.' },
  { id: 'mason-apprentice', label: 'Mason\'s apprentice', purpose: 'Carries stone and learns to dress it.', group: 'children-apprentices',
    routine: 'apprentice', work: 'churchyard', tasks: ['Carries and roughs out stone.', 'Learns to square a block with mallet and chisel.'],
    clips: ['work_chisel', 'carry_bundle_walk'], kit: K('mason-apron'), props: [['mallet', 'hand_r'], ['chisel', 'hand_l']],
    headwear: H(['coif', 'none']), wear: 'flour-dusted', walk: 'any', muscle: 0.55, silhouette: 'Young figure in a too-big leather apron.' },
  { id: 'miller-apprentice', label: 'Miller\'s apprentice', purpose: 'Carries sacks and learns the mill.', group: 'children-apprentices',
    routine: 'apprentice', work: 'proposed-mill', tasks: ['Carries grain sacks into the mill.', 'Sweeps the meal floor and watches the stones.'],
    clips: ['carry_sack_walk', 'work_sweep'], kit: K('apprentice-m'), props: [['sack', 'shoulder_r'], ['broom', 'hand_r']],
    headwear: H(['coif', 'none']), wear: 'flour-dusted', walk: 'any', muscle: 0.5, silhouette: 'Floury youth bent under a sack.' },
  { id: 'carpenter-apprentice', label: 'Carpenter\'s apprentice', purpose: 'Learns carpentry, placed with the carpenter.', group: 'children-apprentices',
    routine: 'apprentice', work: 'home', tasks: ['Holds and saws timber in the yard.', 'Sweeps shavings and sharpens tools.'],
    clips: ['work_saw', 'work_sweep', 'carry_bundle_walk'], kit: K('apprentice-m'), props: [['saw', 'hand_r'], ['broom', 'hand_r']],
    headwear: H(['none', 'felt-cap']), wear: 'worn', walk: 'any', muscle: 0.5, silhouette: 'Lanky youth with a plank on the shoulder.' },
  { id: 'weaver-apprentice', label: 'Weaver\'s apprentice', purpose: 'Learns weaving, placed with the master weaver.', group: 'children-apprentices',
    routine: 'apprentice', work: 'home', tasks: ['Cards wool and winds bobbins.', 'Weaves plain cloth at the second loom.'],
    clips: ['work_card_wool', 'work_weave', 'carry_basket_walk'], kit: K('apprentice-m', 'apprentice-f'), props: [['carding-combs', 'both-hands']],
    headwear: H(['none'], ['head-cloth', 'none']), wear: 'clean', walk: 'any', muscle: 0.42, silhouette: 'Slim apprentice with combs and a basket of wool.' },

  // ---------------- elders and dependents
  { id: 'village-elder', label: 'Village elder', purpose: 'Shares a lifetime\'s knowledge and does light work at home.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Shells peas and sorts beans at the doorstep.', 'Minds the hearth and the youngest children.'],
    clips: ['work_shell_peas', 'carry_basket_walk'], kit: K('elder-m', 'elder-f'), props: [['walking-stick', 'hand_l'], ['bowl', 'hand_r'], ['stool', 'workplace']],
    headwear: H(['hood', 'felt-cap', 'none'], ['head-cloth', 'veil-wimple']), wear: 'worn', walk: 'walk_stick', muscle: 0.35, silhouette: 'Small seated figure with a stick beside the stool.' },
  { id: 'elder-spinner', label: 'Elder who spins at the door', purpose: 'Spins yarn from a distaff and keeps an eye on the lane.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Spins from a distaff at the door.', 'Winds yarn and minds the children.'],
    clips: ['work_spin_distaff', 'work_card_wool'], kit: K('elder-f'), props: [['distaff', 'hand_l'], ['stool', 'workplace']],
    headwear: H(['head-cloth'], ['head-cloth', 'veil-wimple']), wear: 'worn', walk: 'walk_c', muscle: 0.35, silhouette: 'Shawled figure with a distaff under the arm.' },
  { id: 'elder-carder', label: 'Elder who cards wool', purpose: 'Cards wool for the household weaving.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Cards wool on the bench by the door.', 'Sorts fleece and picks out burrs.'],
    clips: ['work_card_wool'], kit: K('elder-f'), props: [['carding-combs', 'both-hands'], ['walking-stick', 'hand_l']],
    headwear: H(['veil-wimple'], ['veil-wimple', 'head-cloth']), wear: 'worn', walk: 'walk_stick', muscle: 0.3, silhouette: 'Wimpled seated figure with combs in the lap.' },
  { id: 'retired-guard', label: 'Retired guard', purpose: 'An old guard who watches the lane and advises the watch.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Whittles pegs and watches the lane.', 'Sits at the guard yard and gives advice.'],
    clips: ['work_whittle', 'carry_basket_walk'], kit: K('elder-m'), props: [['walking-stick', 'hand_l'], ['whittling-knife', 'hand_r']],
    headwear: H(['felt-cap', 'hood']), wear: 'worn', walk: 'walk_stick', muscle: 0.45, silhouette: 'Stiff-backed old man with a stick and a short beard.' },
  { id: 'elder-herdsman', label: 'Old herdsman', purpose: 'A retired shepherd who whittles and watches the flock come home.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Whittles at the cottage door.', 'Watches the flock come home along the lane.'],
    clips: ['work_whittle', 'work_herd'], kit: K('elder-m'), props: [['crook', 'hand_r'], ['whittling-knife', 'hand_r']],
    headwear: H(['hood', 'felt-cap']), wear: 'worn', walk: 'walk_stick', muscle: 0.4, silhouette: 'Bent old figure leaning on a crook.' },
  { id: 'hall-elder', label: 'Elder of the hall', purpose: 'A former hall porter who sits by the hall door and greets visitors.', group: 'elders-dependents',
    routine: 'elder', work: 'home', tasks: ['Sits by the hall door and greets visitors.', 'Mends sacks and harness in the hall.'],
    clips: ['work_mend_seated', 'carry_basket_walk'], kit: K('elder-m'), props: [['walking-stick', 'hand_l'], ['stool', 'workplace']],
    headwear: H(['felt-cap', 'none']), wear: 'clean', walk: 'walk_stick', muscle: 0.35, silhouette: 'Seated old man by a doorway with a stick.' },
  { id: 'lame-craftsman', label: 'Craftsman with a lame leg', purpose: 'Mends tool handles and baskets seated since a fall from a roof beam.', group: 'elders-dependents',
    routine: 'dependent', work: 'home', tasks: ['Mends tool handles and baskets on the bench.', 'Sits in the courtyard sun with neighbours.'],
    clips: ['work_mend_seated', 'walk_crutch'], kit: K('workshop-apron-m'), props: [['crutch', 'hand_l'], ['stool', 'workplace']],
    headwear: H(['none', 'felt-cap']), wear: 'worn', walk: 'walk_crutch', muscle: 0.55, silhouette: 'Figure on a crutch, one leg held stiff.' },
  { id: 'failing-sight', label: 'Elder with failing sight', purpose: 'Cards wool by touch and is guided on walks.', group: 'elders-dependents',
    routine: 'dependent', work: 'home', tasks: ['Cards wool by touch at the hearth.', 'Sits in the courtyard sun with neighbours.'],
    clips: ['work_card_wool'], kit: K('elder-f'), props: [['walking-stick', 'hand_l'], ['carding-combs', 'both-hands']],
    headwear: H(['head-cloth']), wear: 'worn', walk: 'walk_stick', muscle: 0.3, silhouette: 'Small figure feeling ahead with a stick.' },
  { id: 'convalescent', label: 'Convalescent recovering from a long fever', purpose: 'Recovers her strength with light seated work.', group: 'elders-dependents',
    routine: 'dependent', work: 'home', tasks: ['Shells peas and minds the geese from a seat.', 'Sits in the courtyard sun with neighbours.'],
    clips: ['work_shell_peas'], kit: K('field-kirtle'), props: [['bowl', 'hand_r'], ['stool', 'workplace']],
    headwear: H(['head-cloth']), wear: 'clean', walk: 'walk_c', muscle: 0.3, silhouette: 'Thin shawled figure, slow walk, often seated.' },
];

function role(id: string): RoleDef {
  for (const r of ROLES) if (r.id === id) return r;
  throw new Error(`Unknown role ${id}.`);
}

// ------------------------------------------------------------------ households and members (authoring rows)

type HeightClass = 'short' | 'average' | 'tall';
/** `stout`: a heavy body (MakeHuman weight about 0.8) for a few labourers and elders who read as stout from above. */
type Frame = 'slight' | 'lean' | 'medium' | 'broad' | 'stout';
interface MemberRow {
  readonly key: string; readonly label: string; readonly role: string; readonly sex: PopulationSex; readonly age: number;
  readonly note: string;
  readonly id?: string; readonly major?: true; readonly persistent?: true;
  readonly height?: HeightClass; readonly frame?: Frame;
  /** Authored family circumstance when no kin live in the village. */
  readonly noLocalKin?: string;
}
interface HouseholdRow {
  readonly key: string; readonly label: string; readonly home: string; readonly kind: PopulationHouseholdKind;
  readonly members: readonly MemberRow[];
}
export type PopulationHouseholdKind = 'smithy' | 'hall' | 'farm' | 'clergy' | 'workshop' | 'guard' | 'mill' | 'market' | 'herding' | 'lodging' | 'cottage';

const M = (key: string, label: string, roleId: string, sex: PopulationSex, age: number, note: string, extra: Partial<MemberRow> = {}): MemberRow =>
  ({ key, label, role: roleId, sex, age, note, ...extra });

const SMITH = 'ealdholt-village-smith';
const SPINNER = 'ealdholt-smithy-spinner';
const SMITHY_CHILD = 'ealdholt-smithy-child';
const SMITHY_ELDER = 'ealdholt-smithy-elder';
const SMITHY_HOUSEHOLD = 'ealdholt-smithy-household';
const STEWARD = 'ealdholt-house-steward';
const MESSENGER = 'ealdholt-house-messenger';

const HOUSEHOLD_ROWS: readonly HouseholdRow[] = [
  { key: 'smithy', label: 'Smithy household', home: 'smithy-house', kind: 'smithy', members: [
    M('smith', 'Village smith', 'village-smith', 'male', 44, 'As built.', { id: SMITH, major: true }),
    M('smithy-spinner', 'Spinner and dyer', 'spinner-dyer', 'female', 38, 'As built.', { id: SPINNER, major: true }),
    M('smithy-child', 'Household child', 'household-child', 'female', 10, 'As built.', { id: SMITHY_CHILD, major: true, persistent: true }),
    M('smithy-elder', 'Household elder', 'household-elder', 'female', 71, 'As built.', { id: SMITHY_ELDER, major: true }),
  ] },
  { key: 'hall', label: 'Hall household', home: 'proposed-house-hall', kind: 'hall', members: [
    M('steward', 'House steward', 'house-steward', 'male', 51, 'keeps the hall, its stores and the hearings; an ordinary villager with a family, not a privileged class.', { id: STEWARD, major: true, height: 'tall', frame: 'lean' }),
    M('hall-cook', 'Hall cook', 'hall-cook', 'female', 47, 'the steward\'s partner, who runs the hall kitchen.', { major: true, frame: 'stout' }),
    M('hall-page', 'Hall page', 'hall-page', 'male', 13, 'the steward\'s son, learning letters and running the hall\'s errands.'),
    M('hall-elder', 'Elder of the hall', 'hall-elder', 'male', 76, 'the steward\'s father, once the hall porter.', { height: 'short', frame: 'lean' }),
    M('hall-groom', 'Hall groom', 'hall-groom', 'male', 33, 'the cook\'s younger brother, who keeps the hall horses and firewood.', { frame: 'broad' }),
    M('messenger', 'House messenger', 'house-messenger', 'male', 24, 'carries the hall\'s messages and lodges at the hall between journeys; an ordinary villager.', { id: MESSENGER, major: true, frame: 'lean',
      noLocalKin: 'Grew up on a farmstead two valleys away; the family is still there and the hall is home between journeys.' }),
  ] },
  { key: 'reeve-farm', label: 'Reeve\'s farm household', home: 'proposed-home-reeve-farm', kind: 'farm', members: [
    M('village-reeve', 'Village reeve', 'village-reeve', 'male', 47, 'chosen by the villagers to oversee the fields and labour days; farms like everyone else.', { major: true, frame: 'medium' }),
    M('dairy-keeper', 'Dairy keeper', 'dairy-keeper', 'female', 44, 'the reeve\'s partner, who keeps the dairy.'),
    M('reeve-elder-son', 'Reeve\'s elder son', 'field-farmer', 'male', 21, 'the reeve\'s elder son, who drives the plough team.', { height: 'tall', frame: 'broad' }),
    M('reeve-daughter', 'Reeve\'s daughter', 'goose-child', 'female', 9, 'the reeve\'s daughter, who minds the geese.'),
    M('reeve-younger-son', 'Reeve\'s younger son', 'village-child', 'male', 6, 'the reeve\'s youngest, always underfoot.', { height: 'short' }),
  ] },
  { key: 'church-house', label: 'Church-house household', home: 'proposed-home-church-house', kind: 'clergy', members: [
    M('parish-priest', 'Parish priest', 'parish-priest', 'male', 56, 'keeps the church and its services; an ordinary villager with a sister in the house.', { major: true, frame: 'lean' }),
    M('church-keeper', 'Church-house keeper', 'church-keeper', 'female', 51, 'the priest\'s widowed sister, who keeps the church house and rings the bell.'),
    M('church-ward', 'Church ward', 'church-ward', 'male', 11, 'an orphan taken in by the church house, who sweeps the porch and learns letters.', { persistent: true, frame: 'slight',
      noLocalKin: 'Orphaned when a winter fever took both parents; the priest and the keeper raise him but are not kin.' }),
  ] },
  { key: 'clerk', label: 'Clerk\'s household', home: 'proposed-home-clerk', kind: 'clergy', members: [
    M('parish-clerk', 'Parish clerk', 'parish-clerk', 'male', 36, 'keeps the church records and teaches letters to children who come.', { major: true, frame: 'slight' }),
    M('clerk-weaver', 'Weaver of the clerk\'s house', 'weaver', 'female', 33, 'the clerk\'s partner, who weaves cloth at home.'),
    M('clerk-daughter', 'Clerk\'s daughter', 'village-child', 'female', 7, 'the clerk\'s daughter, who already knows some letters.'),
  ] },
  { key: 'healer', label: 'Healer\'s household', home: 'proposed-home-healer', kind: 'workshop', members: [
    M('healer', 'Healer and herbalist', 'healer-herbalist', 'female', 50, 'grows and prepares herbs and tends the sick and injured.', { major: true, persistent: true, frame: 'lean' }),
    M('thatcher', 'Thatcher', 'thatcher', 'male', 53, 'the healer\'s partner, who keeps the village roofs.', { frame: 'medium' }),
    M('healer-apprentice', 'Healer\'s apprentice', 'healer-apprentice', 'female', 15, 'the healer\'s niece, placed with her aunt to learn herbs.', { major: true }),
  ] },
  { key: 'midwife', label: 'Midwife\'s household', home: 'proposed-home-midwife', kind: 'workshop', members: [
    M('midwife', 'Midwife', 'midwife', 'female', 41, 'attends births and advises mothers.', { major: true }),
    M('cobbler', 'Cobbler', 'cobbler', 'male', 44, 'the midwife\'s partner, who makes and mends shoes.', { height: 'short' }),
    M('cobbler-apprentice', 'Cobbler\'s apprentice', 'cobbler-apprentice', 'male', 14, 'their son, learning the trade at the family bench.'),
    M('midwife-mother', 'Midwife\'s mother', 'village-elder', 'female', 73, 'the midwife\'s mother, who once delivered half the village.'),
  ] },
  { key: 'mason', label: 'Mason\'s household', home: 'proposed-home-mason', kind: 'workshop', members: [
    M('master-mason', 'Master mason', 'master-mason', 'male', 46, 'keeps the church, walls and well head in repair.', { major: true, frame: 'broad' }),
    M('baker', 'Baker', 'baker', 'female', 41, 'the mason\'s partner, who bakes at the shared oven.', { frame: 'broad' }),
    M('mason-apprentice', 'Mason\'s apprentice', 'mason-apprentice', 'male', 16, 'their son, carrying stone and learning to dress it.', { height: 'tall' }),
  ] },
  { key: 'captain', label: 'Guard captain\'s household', home: 'proposed-home-captain', kind: 'guard', members: [
    M('guard-captain', 'Guard captain', 'guard-captain', 'male', 44, 'leads the village guard; an ordinary villager with a family and a brewing partner.', { major: true, height: 'tall', frame: 'broad' }),
    M('brewster', 'Brewster and alewife', 'brewster', 'female', 40, 'the captain\'s partner, who brews and sells ale.', { major: true }),
    M('captain-daughter', 'Captain\'s daughter', 'village-child', 'female', 10, 'the captain\'s daughter, quick and loud.'),
    M('retired-guard', 'Retired guard', 'retired-guard', 'male', 70, 'the captain\'s father, an old guard who still advises the watch.', { persistent: true }),
  ] },
  { key: 'serjeant', label: 'Serjeant\'s household', home: 'proposed-home-serjeant', kind: 'guard', members: [
    M('guard-serjeant', 'Guard serjeant', 'guard-serjeant', 'male', 38, 'drills the watch and keeps its gear.', { frame: 'broad' }),
    M('potter', 'Potter', 'potter', 'female', 36, 'the serjeant\'s partner, who throws pots at home.'),
    M('serjeant-son', 'Serjeant\'s son', 'village-child', 'male', 8, 'the serjeant\'s son, who drills with a stick.'),
  ] },
  { key: 'gate-ward', label: 'Gate-ward\'s household', home: 'proposed-home-gate-ward', kind: 'guard', members: [
    M('gate-ward', 'Gate-ward', 'gate-ward', 'male', 51, 'keeps the approach and questions strangers.', { major: true, frame: 'medium' }),
    M('poultry-seller', 'Poultry and egg seller', 'poultry-seller', 'female', 49, 'the gate-ward\'s partner, who keeps hens and geese.'),
    M('gate-ward-son', 'Gate-ward\'s son', 'spearman', 'male', 24, 'the gate-ward\'s son, a spearman of the watch.', { height: 'tall' }),
    M('gate-ward-daughter', 'Gate-ward\'s daughter', 'goose-keeper', 'female', 19, 'the gate-ward\'s daughter, who herds the geese and helps at the stall.'),
  ] },
  { key: 'spearman', label: 'Spearman\'s household', home: 'proposed-home-spearman', kind: 'guard', members: [
    M('spearman-husband', 'Spearman of the watch', 'spearman', 'male', 29, 'a spearman of the watch with a young family.'),
    M('field-worker', 'Field worker', 'field-farmer', 'female', 27, 'the spearman\'s partner, who works the household strips.'),
    M('spearman-son', 'Spearman\'s son', 'village-child', 'male', 5, 'their small son.', { height: 'short' }),
    M('spearman-mother', 'Spearman\'s mother', 'elder-spinner', 'female', 66, 'the spearman\'s widowed mother, who spins at the door.'),
  ] },
  { key: 'archer', label: 'Archer\'s household', home: 'proposed-home-archer', kind: 'guard', members: [
    M('archer', 'Lookout and archer', 'lookout-archer', 'male', 31, 'keeps the lookout from the watch post.', { persistent: true, frame: 'lean' }),
    M('netmaker', 'Rope and net maker', 'netmaker', 'female', 30, 'the archer\'s partner, who twists rope and knots nets.'),
    M('archer-daughter', 'Archer\'s daughter', 'village-child', 'female', 6, 'their daughter.'),
    M('fletcher', 'Fletcher', 'fletcher', 'male', 27, 'the archer\'s younger brother, who makes arrows for the watch.', { frame: 'slight' }),
  ] },
  { key: 'watch-house', label: 'Watch-house lodgers', home: 'proposed-home-watch-house', kind: 'lodging', members: [
    M('reeve-guard-son', 'Reeve\'s guard son', 'night-spearman', 'male', 22, 'the reeve\'s middle son, a spearman of the night watch who lodges at the watch house.'),
    M('garrison-spearman', 'Spearman from the garrison town', 'spearman', 'male', 26, 'a spearman who came to serve the watch.', { frame: 'broad',
      noLocalKin: 'Came from a garrison town to serve the watch; parents and sisters remain there and send word by the messenger.' }),
    M('widower-spearman', 'Widowed spearman', 'night-spearman', 'male', 34, 'the tanner\'s brother, widowed young, who took to the night watch.'),
    M('lookout', 'Lookout of the watch', 'lookout-archer', 'female', 28, 'the netmaker\'s sister, the sharpest eyes on the watch.', { frame: 'lean' }),
  ] },
  { key: 'mill', label: 'Mill household', home: 'proposed-home-mill', kind: 'mill', members: [
    M('miller', 'Miller', 'miller', 'male', 48, 'grinds the village\'s grain at the watermill.', { major: true, frame: 'stout' }),
    M('flour-seller', 'Flour and meal seller', 'flour-seller', 'female', 45, 'the miller\'s partner, who sells meal at the market.'),
    M('miller-apprentice', 'Miller\'s apprentice', 'miller-apprentice', 'male', 15, 'the miller\'s nephew, placed at the mill to learn it.'),
    M('miller-son', 'Miller\'s son', 'spearman', 'male', 23, 'the miller\'s son, who chose the watch over the mill.'),
    M('miller-mother', 'Miller\'s mother', 'village-elder', 'female', 77, 'the miller\'s mother, sharp about the weight of every sack.', { height: 'short' }),
  ] },
  { key: 'carpenter', label: 'Carpenter\'s household', home: 'proposed-home-carpenter', kind: 'workshop', members: [
    M('carpenter', 'Carpenter', 'carpenter', 'male', 39, 'builds and repairs frames, doors and carts.', { major: true, frame: 'broad' }),
    M('basket-weaver', 'Basket weaver', 'basket-weaver', 'female', 37, 'the carpenter\'s partner, who weaves baskets from willow.'),
    M('carpenter-apprentice', 'Carpenter\'s apprentice', 'carpenter-apprentice', 'male', 13, 'a farm family\'s son placed with the carpenter.'),
    M('lame-craftsman', 'Carpenter\'s lame brother', 'lame-craftsman', 'male', 42, 'the carpenter\'s brother, lame since a fall from a roof beam, who mends handles and baskets.'),
  ] },
  { key: 'weaver', label: 'Master weaver\'s household', home: 'proposed-home-weaver', kind: 'workshop', members: [
    M('master-weaver', 'Master weaver', 'master-weaver', 'female', 45, 'weaves the village\'s finer cloth.', { major: true, height: 'tall' }),
    M('fuller', 'Fuller', 'fuller', 'male', 47, 'the master weaver\'s partner, who fulls cloth at the river.'),
    M('weaver-apprentice', 'Weaver\'s apprentice', 'weaver-apprentice', 'female', 14, 'a farm family\'s daughter placed with the master weaver.'),
    M('weaver-mother', 'Master weaver\'s mother', 'elder-carder', 'female', 80, 'the master weaver\'s mother, who cards wool and remembers every pattern.', { persistent: true, height: 'short' }),
  ] },
  { key: 'tanner', label: 'Tanner\'s household', home: 'proposed-home-tanner', kind: 'workshop', members: [
    M('tanner', 'Tanner', 'tanner', 'male', 40, 'tans hides at the pits downstream.', { frame: 'broad' }),
    M('saddler', 'Saddler and leatherworker', 'saddler', 'female', 38, 'the tanner\'s partner, who makes harness and belts.'),
    M('tanner-son', 'Tanner\'s son', 'village-child', 'male', 9, 'the tanner\'s younger son.'),
    M('guard-recruit', 'Guard recruit', 'guard-recruit', 'male', 19, 'the tanner\'s elder son, newly taken on by the watch.', { height: 'tall', frame: 'lean' }),
  ] },
  { key: 'cooper', label: 'Cooper\'s household', home: 'proposed-home-cooper', kind: 'market', members: [
    M('cooper', 'Cooper', 'cooper', 'male', 50, 'makes casks, tubs and buckets.', { frame: 'stout' }),
    M('pedlar', 'Pedlar and market trader', 'pedlar', 'female', 48, 'the cooper\'s partner, the miller\'s sister, who trades at the market and on the road.'),
    M('candle-maker', 'Candle maker', 'candle-maker', 'female', 22, 'their daughter, who dips candles for the church and the houses.'),
    M('cooper-son', 'Cooper\'s son', 'spearman', 'male', 25, 'their son, a spearman of the watch.', { frame: 'broad' }),
  ] },
  { key: 'farm-east', label: 'East farm household', home: 'proposed-home-farm-east', kind: 'farm', members: [
    M('east-farmer', 'East farm farmer', 'field-farmer', 'male', 41, 'farms the east strips.', { frame: 'broad' }),
    M('east-farmer-partner', 'East farm farmer\'s partner', 'gardener', 'female', 39, 'farms with the east farmer and keeps the vegetable plots.'),
    M('east-farmhand', 'East farm farmhand', 'field-farmer', 'male', 17, 'their eldest son, a field hand.', { height: 'tall' }),
    M('east-daughter', 'East farm daughter', 'village-child', 'female', 6, 'their youngest daughter.'),
    M('east-grandmother', 'East farm grandmother', 'village-elder', 'female', 68, 'the east farmer\'s mother.', { frame: 'stout' }),
  ] },
  { key: 'shepherd', label: 'Shepherd\'s household', home: 'proposed-home-shepherd', kind: 'herding', members: [
    M('shepherd', 'Shepherd', 'shepherd', 'male', 36, 'keeps the village flock.', { frame: 'lean' }),
    M('shepherd-partner', 'Shepherd\'s partner, a dairy keeper', 'dairy-keeper', 'female', 34, 'the shepherd\'s partner and the healer\'s sister, who makes ewe\'s cheese.'),
    M('shepherd-son', 'Shepherd\'s son', 'shepherd-child', 'male', 10, 'their son, who helps with the flock.', { persistent: true }),
    M('shepherd-aunt', 'Shepherd\'s aunt', 'failing-sight', 'female', 58, 'the shepherd\'s aunt, whose sight is failing; she cards wool by touch.'),
    M('shepherd-brother', 'Shepherd\'s brother', 'spearman', 'male', 30, 'the shepherd\'s brother, a spearman of the watch.'),
  ] },
  { key: 'farm-west', label: 'West farm household', home: 'proposed-home-farm-west', kind: 'farm', members: [
    M('west-farmer', 'West farm farmer', 'field-farmer', 'male', 45, 'farms the west strips.', { frame: 'medium' }),
    M('west-farmer-partner', 'West farm farmer\'s partner', 'field-farmer', 'female', 43, 'farms with the west farmer.'),
    M('west-ox-driver', 'West farm ox driver', 'field-farmer', 'male', 19, 'their son, who drives the ox team.', { frame: 'broad' }),
    M('west-son', 'West farm son', 'village-child', 'male', 8, 'their youngest son.'),
  ] },
  { key: 'orchard', label: 'Orchard household', home: 'proposed-home-orchard', kind: 'farm', members: [
    M('orchard-keeper', 'Orchard keeper and beekeeper', 'orchard-keeper', 'male', 52, 'keeps the orchard and the hives.', { frame: 'lean' }),
    M('gardener', 'Vegetable gardener', 'gardener', 'female', 50, 'the orchard keeper\'s partner, who grows vegetables for the market.'),
    M('convalescent', 'Convalescent daughter', 'convalescent', 'female', 26, 'their daughter, recovering from a long fever.', { frame: 'slight' }),
    M('orchard-son', 'Orchard son', 'spearman', 'male', 28, 'their son, a spearman of the watch.'),
  ] },
  { key: 'butcher', label: 'Butcher\'s household', home: 'proposed-home-butcher', kind: 'market', members: [
    M('butcher', 'Butcher', 'butcher', 'male', 43, 'slaughters and cuts meat for the households.', { frame: 'stout' }),
    M('sausage-seller', 'Sausage maker and market seller', 'sausage-seller', 'female', 40, 'the butcher\'s partner, who sells at the market.'),
    M('swineherd', 'Swineherd', 'swineherd', 'male', 20, 'their son, who drives the pigs to the woodland edge.'),
    M('milkmaid', 'Milkmaid', 'milkmaid', 'female', 18, 'their daughter, who milks the village cows.'),
  ] },
  { key: 'cottage', label: 'Herdsman\'s cottage household', home: 'proposed-home-cottage', kind: 'cottage', members: [
    M('elder-herdsman', 'Old herdsman', 'elder-herdsman', 'male', 81, 'a retired shepherd who taught the present shepherd.', { persistent: true, height: 'short' }),
    M('woodcutter', 'Woodcutter', 'woodcutter', 'male', 49, 'the old herdsman\'s son, who cuts the village firewood.', { frame: 'broad' }),
    M('laundress', 'Laundress', 'laundress', 'female', 46, 'the woodcutter\'s partner, who washes linen for the hall and the houses.'),
  ] },
];

// Kin edges by member key. partner: both partners; parent: a is the parent of b; sibling; other relations read as 'other'.
type KinRelation = 'partner' | 'parent' | 'sibling' | 'grandparent' | 'in-law' | 'aunt-uncle' | 'cousin';
const KIN: readonly (readonly [string, string, KinRelation])[] = [
  ['steward', 'hall-cook', 'partner'], ['steward', 'hall-page', 'parent'], ['hall-cook', 'hall-page', 'parent'], ['hall-elder', 'steward', 'parent'],
  ['hall-elder', 'hall-page', 'grandparent'], ['hall-elder', 'hall-cook', 'in-law'], ['hall-cook', 'hall-groom', 'sibling'], ['hall-groom', 'steward', 'in-law'],
  ['hall-groom', 'hall-page', 'aunt-uncle'],
  ['village-reeve', 'dairy-keeper', 'partner'],
  ['village-reeve', 'reeve-elder-son', 'parent'], ['dairy-keeper', 'reeve-elder-son', 'parent'], ['village-reeve', 'reeve-daughter', 'parent'],
  ['dairy-keeper', 'reeve-daughter', 'parent'], ['village-reeve', 'reeve-younger-son', 'parent'], ['dairy-keeper', 'reeve-younger-son', 'parent'],
  ['village-reeve', 'reeve-guard-son', 'parent'], ['dairy-keeper', 'reeve-guard-son', 'parent'],
  ['reeve-elder-son', 'reeve-daughter', 'sibling'], ['reeve-elder-son', 'reeve-younger-son', 'sibling'], ['reeve-elder-son', 'reeve-guard-son', 'sibling'],
  ['reeve-daughter', 'reeve-younger-son', 'sibling'], ['reeve-daughter', 'reeve-guard-son', 'sibling'], ['reeve-younger-son', 'reeve-guard-son', 'sibling'],
  ['parish-priest', 'church-keeper', 'sibling'],
  ['parish-clerk', 'clerk-weaver', 'partner'], ['parish-clerk', 'clerk-daughter', 'parent'], ['clerk-weaver', 'clerk-daughter', 'parent'],
  ['healer', 'thatcher', 'partner'], ['healer', 'shepherd-partner', 'sibling'], ['healer', 'healer-apprentice', 'aunt-uncle'], ['thatcher', 'healer-apprentice', 'aunt-uncle'],
  ['midwife', 'cobbler', 'partner'], ['midwife', 'cobbler-apprentice', 'parent'], ['cobbler', 'cobbler-apprentice', 'parent'], ['midwife-mother', 'midwife', 'parent'],
  ['midwife-mother', 'cobbler-apprentice', 'grandparent'], ['midwife-mother', 'cobbler', 'in-law'],
  ['master-mason', 'baker', 'partner'], ['master-mason', 'mason-apprentice', 'parent'], ['baker', 'mason-apprentice', 'parent'],
  ['guard-captain', 'brewster', 'partner'], ['guard-captain', 'captain-daughter', 'parent'], ['brewster', 'captain-daughter', 'parent'],
  ['retired-guard', 'guard-captain', 'parent'], ['retired-guard', 'captain-daughter', 'grandparent'], ['retired-guard', 'brewster', 'in-law'],
  ['guard-serjeant', 'potter', 'partner'], ['guard-serjeant', 'serjeant-son', 'parent'], ['potter', 'serjeant-son', 'parent'],
  ['gate-ward', 'poultry-seller', 'partner'], ['gate-ward', 'gate-ward-son', 'parent'], ['poultry-seller', 'gate-ward-son', 'parent'],
  ['gate-ward', 'gate-ward-daughter', 'parent'], ['poultry-seller', 'gate-ward-daughter', 'parent'], ['gate-ward-son', 'gate-ward-daughter', 'sibling'],
  ['spearman-husband', 'field-worker', 'partner'], ['spearman-husband', 'spearman-son', 'parent'], ['field-worker', 'spearman-son', 'parent'],
  ['spearman-mother', 'spearman-husband', 'parent'], ['spearman-mother', 'spearman-son', 'grandparent'], ['spearman-mother', 'field-worker', 'in-law'],
  ['archer', 'netmaker', 'partner'], ['archer', 'archer-daughter', 'parent'], ['netmaker', 'archer-daughter', 'parent'], ['archer', 'fletcher', 'sibling'],
  ['fletcher', 'archer-daughter', 'aunt-uncle'], ['fletcher', 'netmaker', 'in-law'], ['netmaker', 'lookout', 'sibling'], ['lookout', 'archer-daughter', 'aunt-uncle'],
  ['widower-spearman', 'tanner', 'sibling'], ['widower-spearman', 'tanner-son', 'aunt-uncle'], ['widower-spearman', 'guard-recruit', 'aunt-uncle'], ['widower-spearman', 'saddler', 'in-law'],
  ['miller', 'flour-seller', 'partner'], ['miller', 'miller-son', 'parent'], ['flour-seller', 'miller-son', 'parent'], ['miller-mother', 'miller', 'parent'],
  ['miller-mother', 'pedlar', 'parent'], ['miller', 'pedlar', 'sibling'], ['miller-mother', 'miller-son', 'grandparent'], ['miller-mother', 'flour-seller', 'in-law'],
  ['miller-mother', 'miller-apprentice', 'grandparent'], ['miller-mother', 'candle-maker', 'grandparent'], ['miller-mother', 'cooper-son', 'grandparent'],
  ['miller', 'miller-apprentice', 'aunt-uncle'], ['flour-seller', 'miller-apprentice', 'aunt-uncle'], ['miller-son', 'miller-apprentice', 'cousin'],
  ['carpenter', 'basket-weaver', 'partner'], ['carpenter', 'lame-craftsman', 'sibling'], ['lame-craftsman', 'basket-weaver', 'in-law'],
  ['east-farmer', 'carpenter-apprentice', 'parent'], ['east-farmer-partner', 'carpenter-apprentice', 'parent'],
  ['master-weaver', 'fuller', 'partner'], ['weaver-mother', 'master-weaver', 'parent'], ['weaver-mother', 'fuller', 'in-law'],
  ['west-farmer', 'weaver-apprentice', 'parent'], ['west-farmer-partner', 'weaver-apprentice', 'parent'],
  ['tanner', 'saddler', 'partner'], ['tanner', 'tanner-son', 'parent'], ['saddler', 'tanner-son', 'parent'], ['tanner', 'guard-recruit', 'parent'],
  ['saddler', 'guard-recruit', 'parent'], ['tanner-son', 'guard-recruit', 'sibling'],
  ['cooper', 'pedlar', 'partner'], ['cooper', 'candle-maker', 'parent'], ['pedlar', 'candle-maker', 'parent'], ['cooper', 'cooper-son', 'parent'],
  ['pedlar', 'cooper-son', 'parent'], ['cooper', 'miller-apprentice', 'parent'], ['pedlar', 'miller-apprentice', 'parent'], ['candle-maker', 'cooper-son', 'sibling'],
  ['candle-maker', 'miller-apprentice', 'sibling'], ['cooper-son', 'miller-apprentice', 'sibling'],
  ['east-farmer', 'east-farmer-partner', 'partner'], ['east-farmer', 'east-farmhand', 'parent'], ['east-farmer-partner', 'east-farmhand', 'parent'],
  ['east-farmer', 'east-daughter', 'parent'], ['east-farmer-partner', 'east-daughter', 'parent'], ['east-grandmother', 'east-farmer', 'parent'],
  ['east-grandmother', 'east-farmer-partner', 'in-law'], ['east-grandmother', 'east-farmhand', 'grandparent'], ['east-grandmother', 'east-daughter', 'grandparent'],
  ['east-grandmother', 'carpenter-apprentice', 'grandparent'], ['east-farmhand', 'east-daughter', 'sibling'], ['east-farmhand', 'carpenter-apprentice', 'sibling'],
  ['east-daughter', 'carpenter-apprentice', 'sibling'],
  ['shepherd', 'shepherd-partner', 'partner'], ['shepherd', 'shepherd-son', 'parent'], ['shepherd-partner', 'shepherd-son', 'parent'],
  ['shepherd', 'healer-apprentice', 'parent'], ['shepherd-partner', 'healer-apprentice', 'parent'], ['shepherd-son', 'healer-apprentice', 'sibling'],
  ['shepherd', 'shepherd-brother', 'sibling'], ['shepherd-aunt', 'shepherd', 'aunt-uncle'], ['shepherd-aunt', 'shepherd-brother', 'aunt-uncle'],
  ['shepherd-aunt', 'shepherd-partner', 'in-law'], ['shepherd-brother', 'shepherd-son', 'aunt-uncle'], ['shepherd-brother', 'healer-apprentice', 'aunt-uncle'],
  ['shepherd-brother', 'shepherd-partner', 'in-law'], ['healer', 'shepherd-son', 'aunt-uncle'],
  ['west-farmer', 'west-farmer-partner', 'partner'], ['west-farmer', 'west-ox-driver', 'parent'], ['west-farmer-partner', 'west-ox-driver', 'parent'],
  ['west-farmer', 'west-son', 'parent'], ['west-farmer-partner', 'west-son', 'parent'], ['west-ox-driver', 'west-son', 'sibling'],
  ['west-ox-driver', 'weaver-apprentice', 'sibling'], ['west-son', 'weaver-apprentice', 'sibling'],
  ['orchard-keeper', 'gardener', 'partner'], ['orchard-keeper', 'convalescent', 'parent'], ['gardener', 'convalescent', 'parent'],
  ['orchard-keeper', 'orchard-son', 'parent'], ['gardener', 'orchard-son', 'parent'], ['convalescent', 'orchard-son', 'sibling'],
  ['butcher', 'sausage-seller', 'partner'], ['butcher', 'swineherd', 'parent'], ['sausage-seller', 'swineherd', 'parent'], ['butcher', 'milkmaid', 'parent'],
  ['sausage-seller', 'milkmaid', 'parent'], ['swineherd', 'milkmaid', 'sibling'],
  ['elder-herdsman', 'woodcutter', 'parent'], ['woodcutter', 'laundress', 'partner'], ['elder-herdsman', 'laundress', 'in-law'],
];

// Authored social ties across households (both perspectives). Household members also get ties to each other.
const SOCIAL: readonly (readonly [string, string, string, string])[] = [
  ['smith', 'steward', 'Repairs the hall\'s ironwork and argues over the price.', 'Haggles with the smith over the hall\'s ironwork and trusts the work.'],
  ['smithy-spinner', 'messenger', 'Sends dyed bands and news out with the messenger.', 'Carries the spinner\'s dyed bands out and brings back orders.'],
  ['smithy-child', 'messenger', 'Follows the messenger to the edge of the village and asks about the road.', 'Lets the smithy child walk along to the edge of the village and answers questions about the road.'],
  ['smithy-elder', 'hall-elder', 'An old friend from the hall; they trade news at the well.', 'An old friend from the smithy; they trade news at the well.'],
  ['smithy-child', 'church-ward', 'Plays chase with the church ward and shares stolen apples.', 'Plays chase with the smithy child, who always wins.'],
  ['smithy-spinner', 'master-weaver', 'Sells yarn to the master weaver and argues about the twist.', 'Buys the spinner\'s yarn and argues about the twist.'],
  ['smith', 'guard-captain', 'Mends the watch\'s spearheads and grumbles that the captain always wants them yesterday.', 'Relies on the smith for every spearhead and always wants them yesterday.'],
  ['smith', 'carpenter', 'Fits iron to the carpenter\'s carts and doors.', 'Builds the wood around the smith\'s iron.'],
  ['steward', 'guard-captain', 'Plans the watch rota with the captain.', 'Plans the watch rota with the steward.'],
  ['steward', 'village-reeve', 'Agrees the labour days with the reeve, not always easily.', 'Argues the villagers\' side of the labour days with the steward.'],
  ['steward', 'parish-priest', 'Seeks the priest\'s counsel before difficult hearings.', 'Counsels the steward before difficult hearings.'],
  ['village-reeve', 'east-farmer', 'Settles the east farmer\'s boundary quarrels.', 'Trusts the reeve but watches the boundary stones.'],
  ['village-reeve', 'west-farmer', 'Leans on the west farmer to share the ox team.', 'Shares the ox team when the reeve asks, and grumbles.'],
  ['village-reeve', 'shepherd', 'Sets the pasture days with the shepherd.', 'Keeps the flock to the pasture days the reeve sets.'],
  ['parish-priest', 'parish-clerk', 'Relies on the clerk for the records and the bell.', 'Keeps the records and the bell for the priest.'],
  ['parish-priest', 'healer', 'Visits the sick together with the healer.', 'Visits the sick together with the priest.'],
  ['healer', 'midwife', 'Shares herbs with the midwife and disagrees about fevers.', 'Shares herbs with the healer and disagrees about fevers.'],
  ['parish-clerk', 'hall-page', 'Teaches the hall page letters and accounts.', 'Learns letters from the clerk and fidgets.'],
  ['parish-clerk', 'church-ward', 'Teaches the church ward to read.', 'Learns to read with the clerk.'],
  ['master-mason', 'parish-priest', 'Keeps the church stones sound for the priest.', 'Asks the mason about every crack in the church.'],
  ['mason-apprentice', 'cobbler-apprentice', 'Friends since they were small; they race to the pond.', 'Friends since they were small; they race to the pond.'],
  ['carpenter-apprentice', 'miller-apprentice', 'Competes with the miller\'s apprentice at every task.', 'Competes with the carpenter\'s apprentice at every task.'],
  ['weaver-apprentice', 'healer-apprentice', 'Shares secrets with the healer\'s apprentice.', 'Shares secrets with the weaver\'s apprentice.'],
  ['guard-captain', 'guard-serjeant', 'Leaves the drill to the serjeant.', 'Runs the drill the captain wants.'],
  ['guard-serjeant', 'guard-recruit', 'Drills the recruit hard.', 'Tries to please the serjeant.'],
  ['gate-ward', 'lookout', 'Trusts the lookout\'s eyes over his own.', 'Calls down to the gate-ward at the first sign of anyone on the road.'],
  ['spearman-husband', 'garrison-spearman', 'Shares the morning watch with the spearman from the garrison town.', 'Shares the morning watch and learns the village from him.'],
  ['reeve-guard-son', 'miller-son', 'Friends from boyhood, now on the watch together.', 'Friends from boyhood, now on the watch together.'],
  ['widower-spearman', 'shepherd-brother', 'Keeps company with the shepherd\'s brother on quiet watches.', 'Keeps company with the widowed spearman on quiet watches.'],
  ['orchard-son', 'cooper-son', 'Wagers with the cooper\'s son on everything.', 'Wagers with the orchard son on everything.'],
  ['brewster', 'poultry-seller', 'Trades stall gossip with the poultry seller.', 'Trades stall gossip with the brewster.'],
  ['pedlar', 'sausage-seller', 'Haggles with the sausage seller over stall space.', 'Haggles with the pedlar over stall space.'],
  ['baker', 'miller', 'Buys flour from the miller and checks the weight.', 'Weighs the baker\'s flour twice.'],
  ['tanner', 'butcher', 'Takes the butcher\'s hides.', 'Sells hides to the tanner.'],
  ['saddler', 'cobbler', 'Shares leather and offcuts with the cobbler.', 'Shares leather and offcuts with the saddler.'],
  ['fletcher', 'lookout', 'Makes arrows to the lookout\'s liking.', 'Is particular about the fletcher\'s arrows.'],
  ['potter', 'brewster', 'Throws the brewster\'s jugs.', 'Orders jugs from the potter and complains of leaks.'],
  ['thatcher', 'carpenter', 'Works the roofs on the carpenter\'s frames.', 'Builds the frames the thatcher covers.'],
  ['woodcutter', 'baker', 'Brings firewood for the oven.', 'Sends a loaf home with the woodcutter for every load.'],
  ['laundress', 'hall-cook', 'Washes the hall\'s linen.', 'Sends the hall\'s linen to the laundress.'],
  ['hall-groom', 'messenger', 'Keeps a horse ready for the messenger.', 'Asks the groom for the steadier horse.'],
  ['elder-herdsman', 'shepherd', 'Taught the shepherd the flock and still checks on it.', 'Learned the flock from the old herdsman.'],
  ['retired-guard', 'gate-ward', 'Stood the watch with the gate-ward in younger days.', 'Stood the watch with the retired guard in younger days.'],
  ['weaver-mother', 'midwife-mother', 'Old friends who remember the same winters.', 'Old friends who remember the same winters.'],
  ['miller-mother', 'east-grandmother', 'Sits with the east grandmother at the well.', 'Sits with the miller\'s mother at the well.'],
  ['spearman-mother', 'shepherd-aunt', 'Spins beside the shepherd\'s aunt and describes the lane to her.', 'Cards wool beside the spearman\'s mother and listens.'],
  ['lame-craftsman', 'cooper', 'Mends the cooper\'s tool handles.', 'Brings tool handles for the lame craftsman to mend.'],
  ['convalescent', 'healer', 'Takes the healer\'s draughts and asks when she will be well.', 'Watches the convalescent\'s recovery closely.'],
  ['dairy-keeper', 'shepherd-partner', 'Compares cheeses with the shepherd\'s partner.', 'Compares cheeses with the dairy keeper.'],
  ['reeve-elder-son', 'west-ox-driver', 'Shares the plough team with the west ox driver.', 'Shares the plough team with the reeve\'s elder son.'],
  ['east-farmhand', 'swineherd', 'Friends who meet at the woodland edge.', 'Friends who meet at the woodland edge.'],
  ['candle-maker', 'church-keeper', 'Brings candles for the church.', 'Orders the church candles from the candle maker.'],
  ['gate-ward-daughter', 'milkmaid', 'Friends who walk to the pond together.', 'Friends who walk to the pond together.'],
  ['orchard-keeper', 'candle-maker', 'Sells beeswax to the candle maker.', 'Buys beeswax from the orchard keeper.'],
  ['fuller', 'laundress', 'Shares the riverbank with the laundress.', 'Shares the riverbank with the fuller.'],
  ['reeve-daughter', 'captain-daughter', 'Best friends who quarrel weekly.', 'Best friends who quarrel weekly.'],
  ['reeve-younger-son', 'spearman-son', 'Plays at soldiers with the spearman\'s son.', 'Plays at soldiers with the reeve\'s younger son.'],
  ['clerk-daughter', 'archer-daughter', 'Teaches the archer\'s daughter her letters in the dirt.', 'Learns letters in the dirt from the clerk\'s daughter.'],
  ['serjeant-son', 'tanner-son', 'Drills with sticks alongside the tanner\'s son.', 'Drills with sticks alongside the serjeant\'s son.'],
  ['shepherd-son', 'west-son', 'Shows the west farm son the lambs.', 'Follows the shepherd\'s son to the pasture.'],
  ['east-daughter', 'smithy-child', 'Watches the smithy child at the bellows.', 'Shows off at the bellows for the east farm daughter.'],
  ['basket-weaver', 'poultry-seller', 'Makes egg baskets for the poultry seller.', 'Buys egg baskets from the basket weaver.'],
  ['potter', 'hall-cook', 'Makes pots for the hall kitchen.', 'Orders pots for the hall kitchen.'],
  ['netmaker', 'fuller', 'Sells cord to the fuller for the tenter frames.', 'Buys cord from the netmaker.'],
];

// ------------------------------------------------------------------ deterministic variation helpers (pure)

function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hash32(seed) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ------------------------------------------------------------------ appearance types

export interface PopulationFaceTarget { readonly target: string; readonly weight: number }
export interface PopulationAppearance {
  readonly kind: 'crowd' | 'existing-set';
  /** Published art set for the built smithy residents; null for crowd residents. */
  readonly existingSet: string | null;
  readonly archetype: PopulationArchetype;
  readonly macro: {
    readonly gender: number; readonly ageYears: number; readonly muscle: number; readonly weight: number;
    readonly height: number; readonly proportions: number;
    readonly macroShapeFamilies: { readonly african: number; readonly asian: number; readonly caucasian: number };
  };
  /** CC0 MakeHuman head-region detail targets only (measured: they move no body joint). */
  readonly faceTargets: readonly PopulationFaceTarget[];
  readonly skin: { readonly base: string; readonly toneShift: number; readonly weathering: readonly string[] };
  readonly eyes: string;
  readonly hair: { readonly style: PopulationHairStyle; readonly colour: string; readonly facialHair: PopulationFacialHair };
  readonly headwear: PopulationHeadwear;
  /** Shape variant (POPULATION_HEADWEAR_SHAPES), what colours it and the colour as built (sRGB; null without headwear). */
  readonly headwearStyle: { readonly shape: string; readonly tone: PopulationHeadwearTone; readonly colour: string | null };
  readonly outfit: {
    readonly kit: PopulationOutfitKit;
    /** Cut variant of the kit (POPULATION_OUTFIT_KITS[].cuts): garment lengths, layers and capes. */
    readonly cut: string;
    readonly palette: { readonly main: PopulationDye; readonly secondary: PopulationDye; readonly accent: PopulationDye };
    readonly wear: PopulationWear;
  };
  readonly props: readonly { readonly id: string; readonly socket: PopulationPropSocket }[];
  readonly motion: {
    /** Clip library file stem: crowd-clips-<archetype>-v1 (null for built residents, which keep their own clips). */
    readonly library: string | null;
    readonly walk: string; readonly idle: string; readonly talk: string;
    /** Playback-rate variation so no two residents of an archetype step in unison. */
    readonly rate: number;
    /** Role loops and carries from the archetype library that this resident uses. */
    readonly roleClips: readonly string[];
  };
  readonly silhouette: string;
  readonly bannerPresentation: string | null;
}

export interface PopulationResident {
  readonly id: string;
  readonly label: string;
  readonly roleId: string;
  readonly roleLabel: string;
  readonly purpose: string;
  readonly group: PopulationGroup;
  readonly ageYears: number;
  readonly ageBand: PopulationAgeBand;
  readonly sex: PopulationSex;
  readonly build: { readonly heightClass: HeightClass; readonly frame: Frame };
  readonly householdId: string;
  readonly homePlaceId: string;
  readonly workPlaceId: string;
  readonly fidelityTier: PopulationFidelityTier;
  readonly influenceSensitivity: PeopleLifeInfluenceSensitivity;
  /** Registry entry in Codex's people-life shape (family, social ties, full-day routine). */
  readonly registry: PeopleLifeResident;
  readonly appearance: PopulationAppearance;
}

export interface PopulationHousehold extends PeopleLifeHousehold {
  readonly kind: PopulationHouseholdKind;
}

export interface PopulationClipLibrary {
  readonly archetype: PopulationArchetype;
  readonly file: string;
  readonly clips: readonly string[];
  readonly residents: number;
}

export interface VillagePopulation {
  readonly status: typeof VILLAGE_POPULATION_STATUS;
  readonly decidedOn: typeof VILLAGE_POPULATION_DECIDED_ON;
  /** Nothing here reads or writes house standing; only My Legacy chess does. */
  readonly houseStandingEffect: 'none';
  readonly places: readonly PopulationPlace[];
  readonly households: readonly PopulationHousehold[];
  readonly residents: readonly PopulationResident[];
  readonly clipLibraries: readonly PopulationClipLibrary[];
  /** The people-life registry for Codex (places, households, residents). */
  readonly registry: PeopleLifeRegistry;
}

// ------------------------------------------------------------------ build

const BREAKFAST = 'Breakfast with the household.';
const MIDDAY = 'Midday meal at home.';
const EVENING = 'Evening meal with the household.';
const SLEEP = 'Asleep at home.';
const MEALS = [BREAKFAST, MIDDAY, EVENING];

type Slot = readonly [number, number, string, string];
type MutableSlot = { startMinute: number; endMinute: number; activity: string; placeId: string; companionIds: string[] };

/**
 * Outdoor gathering places the Quest view can take in at once: no more than OUTDOOR_PLACE_CAP residents are presented at
 * any one of them at any time (motion and runtime fixer, 8 November). The role templates sent everybody to the same
 * courtyard, well, pond or woodland edge at the same hour (up to 31 at the well at 18:00), more than the Quest presence cap
 * of 12 can draw. Indoor places, homes and the road beyond are not capped.
 */
export const OUTDOOR_PLACE_CAP = 12;
const CAPPED_PLACES: Readonly<Record<string, { readonly noun: string; readonly spill: readonly string[] }>> = {
  'village-courtyard': { noun: 'the courtyard', spill: ['proposed-lanes', 'proposed-green'] },
  'village-well': { noun: 'the well', spill: ['riverside-bank', 'proposed-lanes'] },
  'village-pond': { noun: 'the pond', spill: ['proposed-green', 'riverside-bank'] },
  'woodland-edge': { noun: 'the woodland edge', spill: ['proposed-hedgerows', 'proposed-green'] },
  'proposed-guard-yard': { noun: 'the guard yard', spill: ['proposed-watch-post', 'proposed-lanes'] },
  'proposed-watch-post': { noun: 'the watch post', spill: ['proposed-lanes'] },
  'churchyard': { noun: 'the churchyard', spill: ['proposed-green'] },
  'riverside-bank': { noun: 'the river bank', spill: ['proposed-lanes'] },
  'proposed-lanes': { noun: 'the lanes', spill: ['proposed-green'] },
  'proposed-green': { noun: 'the green', spill: ['proposed-lanes'] },
  'proposed-hedgerows': { noun: 'the hedgerows', spill: ['proposed-green'] },
  'proposed-fields': { noun: 'the fields', spill: ['proposed-hedgerows'] },
  'proposed-pasture': { noun: 'the pasture', spill: ['proposed-hedgerows'] },
};
/** Places a capped slot can be sent to, with the phrase that names them in the activity text. */
const SPILL_PHRASE: Readonly<Record<string, string>> = { 'proposed-lanes': 'in the lanes', 'proposed-green': 'on the green', 'riverside-bank': 'at the river bank',
  'proposed-hedgerows': 'along the hedgerows', 'proposed-watch-post': 'at the watch post' };
const PLACE_PHRASE = /\b(at|in|by|to|round) the (courtyard market|courtyard|well|pond edge|pond|woodland edge|guard yard|watch post|churchyard|fields|pasture|lanes|green|river bank|hedgerows)\b/;

/** The activity text of a slot moved to `to` (working placeholder wording). */
function spilledActivity(activity: string, to: string): string {
  const phrase = SPILL_PHRASE[to] ?? 'nearby';
  if (/water/i.test(activity) && to !== 'riverside-bank') return `Carries water home ${phrase}.`;
  if (/^Sells /.test(activity)) return activity.replace(/ at the (courtyard )?market| from the stall in the courtyard/, '').replace(/\.$/, '') + ` from door to door ${phrase}.`;
  if (PLACE_PHRASE.test(activity)) return activity.replace(PLACE_PHRASE, phrase);
  return `${activity.replace(/\.$/, '')} ${phrase}.`;
}

/**
 * Moves whole slots out of over-full outdoor places, in time order, to the place's spill places (the first that stays
 * within the cap for the whole slot). A resident whose own workplace is the crowded place keeps it (a seller at the
 * market, a keeper), then residents are kept in a stable hashed order. Only place and activity text change: times,
 * meals and companions stay as they were, so households still eat together.
 */
function spreadCrowdedPlaces(residents: Map<string, PeopleLifeResident>, workOf: ReadonlyMap<string, string>, homeOf: ReadonlyMap<string, string>): void {
  const STEP = 15;
  const occupancy = (place: string, minute: number) => {
    const out: { id: string; slot: MutableSlot }[] = [];
    for (const [id, r] of residents) for (const sl of r.routine as unknown as MutableSlot[]) if (sl.placeId === place && sl.startMinute <= minute && minute < sl.endMinute) out.push({ id, slot: sl });
    return out;
  };
  const fits = (place: string, slot: MutableSlot) => {
    for (let m = slot.startMinute - (slot.startMinute % STEP); m < slot.endMinute; m += STEP) if (occupancy(place, Math.max(m, slot.startMinute)).length >= OUTDOOR_PLACE_CAP) return false;
    return true;
  };
  const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  for (let minute = 0; minute < 1440; minute += STEP) {
    for (const place of Object.keys(CAPPED_PLACES)) {
      const here = occupancy(place, minute);
      if (here.length <= OUTDOOR_PLACE_CAP) continue;
      // kept first: residents who cannot move (the smithy four), then those whose own workplace this is, then a stable hash
      const movable = (id: string) => workOf.has(id);
      here.sort((a, b) => (Number(!movable(a.id)) - Number(!movable(b.id))) * -1 || (Number(workOf.get(b.id) === place) - Number(workOf.get(a.id) === place))
        || (hash(`${a.id}|${place}`) - hash(`${b.id}|${place}`)));
      for (const { id, slot } of here.slice(OUTDOOR_PLACE_CAP)) {
        if (!movable(id)) continue;
        const spec = CAPPED_PLACES[place];
        const to = spec.spill.find(p => fits(p, slot));
        if (to) {
          slot.activity = spilledActivity(slot.activity, to);
          slot.placeId = to;
        } else {
          // every spill place is full too: the resident stays home for this slot (indoors, not presented)
          slot.activity = `${slot.activity.replace(/\.$/, '')}; stays home instead, the place being crowded.`;
          slot.placeId = homeOf.get(residents.get(id)!.homeHouseholdId)!;
        }
      }
    }
  }
}

function templateSlots(def: RoleDef, home: string, work: string): readonly Slot[] {
  const [a, b] = def.tasks;
  const p2 = def.place2 === 'home' ? home : (def.place2 ?? work);
  switch (def.routine) {
    case 'field': return [[0, 300, SLEEP, home], [300, 360, 'Feeds the animals and readies the tools.', home], [360, 390, BREAKFAST, home],
      [390, 720, a, work], [720, 780, 'Eats at the work and rests.', work], [780, 1020, b, work], [1020, 1080, 'Carries tools and produce home.', home],
      [1080, 1110, 'Fetches water at the well.', 'village-well'], [1110, 1170, EVENING, home], [1170, 1260, 'Mends tools and harness by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'herding': return [[0, 300, SLEEP, home], [300, 360, 'Checks the animals and the fold.', work], [360, 390, BREAKFAST, home],
      [390, 720, a, work], [720, 780, 'Eats out with the animals.', work], [780, 1050, b, work], [1050, 1110, 'Brings the animals home to the fold.', work],
      [1110, 1170, EVENING, home], [1170, 1260, 'Cards wool or mends by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'dairy': return [[0, 300, SLEEP, home], [300, 360, 'Milks before dawn.', home], [360, 390, BREAKFAST, home], [390, 600, a, home],
      [600, 720, 'Sells cheese, butter and milk at the market.', 'village-courtyard'], [720, 780, MIDDAY, home], [780, 960, b, home],
      [960, 1020, 'Fetches water at the well.', 'village-well'], [1020, 1110, 'Evening milking.', home], [1110, 1170, EVENING, home],
      [1170, 1260, 'Sets the curds and scalds the pails.', home], [1260, 1440, SLEEP, home]];
    case 'artisan-home': return [[0, 330, SLEEP, home], [330, 360, 'Opens the workshop and lays out the tools.', work], [360, 390, BREAKFAST, home],
      [390, 720, a, work], [720, 780, MIDDAY, home], [780, 960, b, work], [960, 1020, 'Trades work and news in the courtyard.', 'village-courtyard'],
      [1020, 1050, 'Fetches water at the well.', 'village-well'], [1050, 1110, 'Clears and sweeps the workshop.', work], [1110, 1170, EVENING, home],
      [1170, 1260, 'Small repairs by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'artisan-away': return [[0, 330, SLEEP, home], [330, 360, 'Walks out to the day\'s work.', work], [360, 390, BREAKFAST, home],
      [390, 720, a, work], [720, 780, 'Eats at the work.', work], [780, 990, b, work], [990, 1050, 'Trades work and news in the courtyard.', 'village-courtyard'],
      [1050, 1110, 'Fetches water and washes at the well.', 'village-well'], [1110, 1170, EVENING, home], [1170, 1260, 'Small repairs by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'market': return [[0, 330, SLEEP, home], [330, 360, 'Loads the day\'s goods.', home], [360, 390, BREAKFAST, home], [390, 720, a, work],
      [720, 780, MIDDAY, home], [780, 990, b, p2 === work ? home : p2], [990, 1050, 'Fetches water and trades news at the well.', 'village-well'],
      [1050, 1110, 'Counts and stores the day\'s goods.', home], [1110, 1170, EVENING, home], [1170, 1260, 'Mends baskets and sacks by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'keeper': return [[0, 300, SLEEP, home], [300, 360, 'Lights the fire and draws water.', work], [360, 390, BREAKFAST, home], [390, 720, a, work],
      [720, 780, MIDDAY, home], [780, 1050, b, work], [1050, 1110, 'Prepares for the evening.', work], [1110, 1170, EVENING, home],
      [1170, 1260, 'Banks the fire and sets the morning\'s work.', home], [1260, 1440, SLEEP, home]];
    case 'guard-day': return [[0, 330, SLEEP, home], [330, 360, 'Arms and dresses for the watch.', home], [360, 390, BREAKFAST, home],
      [390, 720, a, 'proposed-watch-post'], [720, 780, 'Eats at the watch post.', 'proposed-watch-post'], [780, 960, b, 'village-courtyard'],
      [960, 1050, 'Drills and mends gear in the guard yard.', 'proposed-guard-yard'], [1050, 1110, 'Fetches water for the household.', 'village-well'],
      [1110, 1170, EVENING, home], [1170, 1260, 'Rests at home.', home], [1260, 1440, SLEEP, home]];
    case 'guard-night': return [[0, 360, a, 'proposed-watch-post'], [360, 390, BREAKFAST, home], [390, 900, 'Sleeps after the night watch.', home],
      [900, 1020, b, home], [1020, 1110, 'Drills in the guard yard.', 'proposed-guard-yard'], [1110, 1170, EVENING, home],
      [1170, 1260, 'Readies for the night watch.', home], [1260, 1440, a, 'proposed-watch-post']];
    case 'guard-lead': return [[0, 330, SLEEP, home], [330, 360, 'Hears the night watch\'s report.', 'proposed-watch-post'], [360, 390, BREAKFAST, home],
      [390, 600, a, work], [600, 720, 'Walks the rounds of the watch.', 'village-courtyard'], [720, 780, MIDDAY, home], [780, 960, b, p2],
      [960, 1050, 'Inspects the approach and the watch post.', 'proposed-watch-post'], [1050, 1110, 'Fetches water and hears news at the well.', 'village-well'],
      [1110, 1170, EVENING, home], [1170, 1260, 'Sets the night watch.', 'proposed-watch-post'], [1260, 1440, SLEEP, home]];
    case 'child': return [[0, 360, SLEEP, home], [360, 390, BREAKFAST, home], [390, 480, a, work],
      [480, 600, 'Plays chase and pebble games with the other children.', 'village-courtyard'], [600, 720, b, p2], [720, 780, MIDDAY, home],
      [780, 900, 'Runs errands between neighbouring houses.', 'village-courtyard'], [900, 990, 'Plays by the pond edge.', 'village-pond'],
      [990, 1080, 'Gathers kindling at the woodland edge.', 'woodland-edge'], [1080, 1110, 'Washes before supper.', home], [1110, 1170, EVENING, home],
      [1170, 1230, 'Listens to stories by the fire.', home], [1230, 1440, SLEEP, home]];
    case 'apprentice': return [[0, 330, SLEEP, home], [330, 360, 'Fetches water and kindling for the work.', 'village-well'], [360, 390, BREAKFAST, home],
      [390, 720, a, work], [720, 780, MIDDAY, home], [780, 990, b, work], [990, 1050, 'Runs errands for the master.', 'village-courtyard'],
      [1050, 1110, 'Sweeps and tidies the workplace.', work], [1110, 1170, EVENING, home], [1170, 1260, 'Practises the trade by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'elder': return [[0, 360, SLEEP, home], [360, 390, BREAKFAST, home], [390, 540, a, home], [540, 630, 'Sits at the well and trades news.', 'village-well'],
      [630, 720, b, home], [720, 780, MIDDAY, home], [780, 900, 'Rests indoors.', home], [900, 990, 'Sits in the sun at the doorstep.', home],
      [990, 1050, 'Walks slowly to the churchyard and back.', 'churchyard'], [1050, 1110, 'Tends the hearth.', home], [1110, 1170, EVENING, home],
      [1170, 1260, 'Tells stories by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'dependent': return [[0, 360, SLEEP, home], [360, 390, BREAKFAST, home], [390, 600, a, home], [600, 690, b, 'village-courtyard'],
      [690, 720, 'Is helped home along the lane.', home], [720, 780, MIDDAY, home], [780, 960, 'Rests indoors.', home],
      [960, 1110, 'Seated work at the doorstep.', home], [1110, 1170, EVENING, home], [1170, 1260, 'Sits by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'steward': return [[0, 330, SLEEP, home], [330, 360, 'Walks the hall stores with the keys.', home], [360, 390, BREAKFAST, home],
      [390, 600, a, home], [600, 720, 'Hears villagers\' concerns at the hall.', home], [720, 780, MIDDAY, home], [780, 900, b, 'village-courtyard'],
      [900, 990, 'Inspects the mill and the stored grain.', 'proposed-mill'], [990, 1050, 'Checks the guard yard and its stores.', 'proposed-guard-yard'],
      [1050, 1110, 'Writes up the day\'s tallies.', home], [1110, 1170, EVENING, home], [1170, 1260, 'Plans the coming days by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'reeve': return [[0, 330, SLEEP, home], [330, 360, 'Checks the plough team and the weather.', home], [360, 390, BREAKFAST, home],
      [390, 720, a, 'proposed-fields'], [720, 780, 'Eats in the field.', 'proposed-fields'], [780, 900, b, 'proposed-pasture'],
      [900, 1020, 'Settles disputes over strips and boundaries in the courtyard.', 'village-courtyard'], [1020, 1110, 'Reports on the fields at the hall.', 'proposed-house-hall'],
      [1110, 1170, EVENING, home], [1170, 1260, 'Mends harness by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'priest': return [[0, 330, SLEEP, home], [330, 360, 'Morning prayers in the church.', 'proposed-church'], [360, 390, BREAKFAST, home],
      [390, 540, a, 'proposed-church'], [540, 660, 'Visits the sick and the elderly.', 'village-courtyard'], [660, 720, 'Tends the graves and the churchyard path.', 'churchyard'],
      [720, 780, MIDDAY, home], [780, 960, b, 'proposed-church'], [960, 1050, 'Walks the village and speaks with the households.', 'village-courtyard'],
      [1050, 1110, 'Evening prayers in the church.', 'proposed-church'], [1110, 1170, EVENING, home], [1170, 1260, 'Reads by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'clerk': return [[0, 330, SLEEP, home], [330, 360, 'Rings the morning bell.', 'proposed-church'], [360, 390, BREAKFAST, home],
      [390, 540, a, 'proposed-church'], [540, 660, b, 'proposed-church'], [660, 720, 'Writes letters for villagers who ask.', 'village-courtyard'],
      [720, 780, MIDDAY, home], [780, 960, 'Keeps the hall accounts with the steward\'s tallies.', 'proposed-house-hall'],
      [960, 1050, 'Reads in the churchyard.', 'churchyard'], [1050, 1110, 'Rings the evening bell.', 'proposed-church'], [1110, 1170, EVENING, home],
      [1170, 1260, 'Copies by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'healer': return [[0, 330, SLEEP, home], [330, 360, 'Waters the herb garden.', 'proposed-herb-garden'], [360, 390, BREAKFAST, home],
      [390, 600, a, home], [600, 720, 'Visits the sick and injured.', 'village-courtyard'], [720, 780, MIDDAY, home], [780, 960, b, 'woodland-edge'],
      [960, 1080, 'Tends the herb garden.', 'proposed-herb-garden'], [1080, 1110, 'Prepares remedies for the night.', home], [1110, 1170, EVENING, home],
      [1170, 1260, 'Dries and bundles herbs by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'midwife': return [[0, 330, SLEEP, home], [330, 360, 'Readies the satchel and linen.', home], [360, 390, BREAKFAST, home],
      [390, 540, a, work], [540, 720, 'Prepares salves and linen at home.', home], [720, 780, MIDDAY, home],
      [780, 900, 'Gathers herbs in the healer\'s garden.', 'proposed-herb-garden'], [900, 1050, b, work],
      [1050, 1110, 'Fetches water at the well.', 'village-well'], [1110, 1170, EVENING, home], [1170, 1260, 'Sews swaddling by the fire.', home], [1260, 1440, SLEEP, home]];
    case 'mason': return [[0, 330, SLEEP, home], [330, 360, 'Sharpens chisels.', home], [360, 390, BREAKFAST, home], [390, 720, a, work],
      [720, 780, MIDDAY, home], [780, 960, b, 'village-well'], [960, 1050, 'Checks the mill race stones.', 'proposed-mill'],
      [1050, 1110, 'Stacks and covers the dressed stone.', work], [1110, 1170, EVENING, home], [1170, 1260, 'Draws out the next repairs by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'messenger': return [[0, 330, SLEEP, home], [330, 360, 'Readies the satchel and boots.', home], [360, 390, BREAKFAST, home],
      [390, 480, a, home], [480, 960, b, 'proposed-road-beyond'], [960, 1050, 'Returns and reports at the hall.', home],
      [1050, 1110, 'Shares news at the well.', 'village-well'], [1110, 1170, EVENING, home], [1170, 1260, 'Rests and mends boots by the fire.', home],
      [1260, 1440, SLEEP, home]];
    case 'existing': throw new Error('Built residents keep their casting routines.');
  }
}

const FACE_SLOTS: readonly (readonly string[])[] = [
  ['head/head-oval', 'head/head-round', 'head/head-square', 'head/head-diamond', 'head/head-invertedtriangular', 'head/head-fat-decr'],
  ['nose/nose-hump-incr', 'nose/nose-hump-decr', 'nose/nose-point-up', 'nose/nose-point-down', 'nose/nose-scale-horiz-decr', 'nose/nose-scale-vert-incr'],
  ['nose/nose-point-width-incr', 'nose/nose-point-width-decr', 'nose/nose-flaring-incr', 'nose/nose-flaring-decr', 'nose/nose-base-up'],
  ['mouth/mouth-scale-horiz-incr', 'mouth/mouth-scale-horiz-decr', 'mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-lowerlip-volume-decr', 'mouth/mouth-upperlip-volume-decr', 'mouth/mouth-cupidsbow-incr'],
  ['chin/chin-width-incr', 'chin/chin-width-decr', 'chin/chin-prominent-incr', 'chin/chin-height-incr', 'chin/chin-jaw-drop-incr', 'chin/chin-bones-decr'],
  ['cheek/l-cheek-bones-incr', 'cheek/l-cheek-volume-incr', 'cheek/l-cheek-volume-decr'],
  ['eyebrows/eyebrows-trans-down', 'eyebrows/eyebrows-trans-up', 'eyebrows/eyebrows-angle-up'],
  ['eyes/l-eye-bag-incr', 'eyes/l-eye-eyefold-down', 'eyes/l-eye-height2-decr'],
  ['ears/l-ear-wing-incr', 'ears/l-ear-scale-incr', 'ears/l-ear-lobe-incr'],
  ['asym/asym-nose-1-l', 'asym/asym-nose-2-r', 'asym/asym-mouth-1-l', 'asym/asym-mouth-2-r', 'asym/asym-jaw-1-l', 'asym/asym-eye-2-r', 'asym/asym-brown-1-l'],
];
const mirrored = (t: string) => t.replace('/l-', '/r-');

const HAIR_BASES: readonly string[] = ['black', 'dark-brown', 'mid-brown', 'light-brown', 'fair', 'sandy', 'auburn', 'red-brown'];
const EYE_POOL: readonly string[] = ['brown', 'brownlight', 'blue', 'bluegreen', 'grey', 'green', 'lightblue'];
const FAMILY_MIXES: readonly { readonly african: number; readonly asian: number; readonly caucasian: number }[] = [
  { african: 0.05, asian: 0.1, caucasian: 0.85 }, { african: 0.1, asian: 0.05, caucasian: 0.85 }, { african: 0.04, asian: 0.16, caucasian: 0.8 },
  { african: 0.15, asian: 0.08, caucasian: 0.77 }, { african: 0.03, asian: 0.07, caucasian: 0.9 }, { african: 0.08, asian: 0.12, caucasian: 0.8 },
];

interface Lineage { readonly mix: { readonly african: number; readonly asian: number; readonly caucasian: number }; readonly hair: string; readonly eyes: string; readonly tone: number }

/** Headwear that hides the whole scalp (no hair is built under it). */
const FULL_COVER: readonly PopulationHeadwear[] = ['coif', 'padded-coif', 'hood', 'head-cloth', 'veil-wimple'];
const FIXED_TONES: Readonly<Record<string, string>> = { straw: '#b49a5a', metal: '#8f9194' };
function toneColour(tone: PopulationHeadwearTone, palette: { main: PopulationDye; secondary: PopulationDye; accent: PopulationDye }): string | null {
  if (tone === 'none') return null;
  if (tone === 'main' || tone === 'secondary' || tone === 'accent') return POPULATION_DYES[palette[tone]];
  if (tone in POPULATION_LINEN_TONES) return POPULATION_LINEN_TONES[tone as PopulationLinenTone];
  return FIXED_TONES[tone];
}
function rgbOf(hex: string): readonly [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function colourDistance(a: string, b: string): number {
  const x = rgbOf(a), y = rgbOf(b);
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}
/** Approximate sRGB of a hair colour name, greying and grey variants mixed toward grey. */
function hairSrgb(name: string): string {
  const mix = (base: string, k: number) => { const a = rgbOf(base), g = rgbOf('#9b9890');
    return '#' + [0, 1, 2].map(i => Math.round(a[i] * (1 - k) + g[i] * k).toString(16).padStart(2, '0')).join(''); };
  if (name.indexOf('greying-') === 0) return mix(HAIR_SRGB[name.slice(8)] ?? HAIR_SRGB['mid-brown'], 0.4);
  if (name.indexOf('grey-') === 0) return mix(HAIR_SRGB[name.slice(5)] ?? HAIR_SRGB['mid-brown'], 0.7);
  return HAIR_SRGB[name] ?? HAIR_SRGB['mid-brown'];
}

function buildPopulation(): VillagePopulation {
  const casting = EALDHOLT_HOUSEHOLD_CASTING;
  // ---- places
  const places: PopulationPlace[] = casting.registry.places.map(p => ({ id: p.id, label: p.label, status: 'household-casting-place' as const,
    kind: p.id === 'smithy-house' ? 'home' as const : (p.id === 'smithy-forge' || p.id === 'riverside-bank' || p.id === 'woodland-edge') ? 'workplace' as const : 'social' as const }));
  for (const [id, label, kind] of PROPOSED_PLACES) places.push({ id, label, status: 'proposed-placeholder', kind });
  for (const h of HOUSEHOLD_ROWS) {
    if (places.some(p => p.id === h.home)) continue;
    places.push({ id: h.home, label: `${h.label} home (proposed placeholder)`, status: 'proposed-placeholder', kind: 'home' });
  }

  // ---- identities
  const idOf = new Map<string, string>(), rowOf = new Map<string, MemberRow>(), householdOf = new Map<string, HouseholdRow>();
  for (const h of HOUSEHOLD_ROWS) for (const m of h.members) {
    if (idOf.has(m.key)) throw new Error(`Duplicate member key ${m.key}.`);
    idOf.set(m.key, m.id ?? `ealdholt-${m.key}`); rowOf.set(m.key, m); householdOf.set(m.key, h);
  }
  const householdId = (h: HouseholdRow) => h.key === 'smithy' ? SMITHY_HOUSEHOLD : `ealdholt-${h.key}-household`;
  const labelOf = (key: string) => { const l = rowOf.get(key)!.label; return l.charAt(0).toLowerCase() + l.slice(1); };

  // ---- kin
  const kin = new Map<string, PeopleLifeKin[]>();
  const addKin = (from: string, to: string, kind: PeopleLifeKinKind, description: string) => {
    const list = kin.get(from) ?? []; list.push({ residentId: idOf.get(to)!, kind, description }); kin.set(from, list);
  };
  for (const [a, b, rel] of KIN) {
    if (!rowOf.has(a) || !rowOf.has(b)) throw new Error(`Kin edge ${a}-${b} names an unknown member.`);
    const A = labelOf(a), B = labelOf(b), sa = rowOf.get(a)!.sex, sb = rowOf.get(b)!.sex;
    switch (rel) {
      case 'partner': addKin(a, b, 'partner', `Partner, the ${B}; they share the household and its decisions.`); addKin(b, a, 'partner', `Partner, the ${A}; they share the household and its decisions.`); break;
      case 'parent': addKin(a, b, 'child', `Their child, the ${B}.`); addKin(b, a, 'parent', `Parent, the ${A}.`); break;
      case 'sibling': addKin(a, b, 'sibling', `Sibling, the ${B}.`); addKin(b, a, 'sibling', `Sibling, the ${A}.`); break;
      case 'grandparent': addKin(a, b, 'other', `Grandchild, the ${B}.`); addKin(b, a, 'other', `Grandparent, the ${A}.`); break;
      case 'in-law': addKin(a, b, 'other', `In-law, the ${B}.`); addKin(b, a, 'other', `In-law, the ${A}.`); break;
      case 'aunt-uncle': addKin(a, b, 'other', `${sb === 'female' ? 'Niece' : 'Nephew'}, the ${B}.`); addKin(b, a, 'other', `${sa === 'female' ? 'Aunt' : 'Uncle'}, the ${A}.`); break;
      case 'cousin': addKin(a, b, 'other', `Cousin, the ${B}.`); addKin(b, a, 'other', `Cousin, the ${A}.`); break;
    }
  }

  // ---- social ties: household members to each other, then authored cross-household pairs
  const social = new Map<string, PeopleLifeSocialTie[]>();
  const addTie = (from: string, to: string, description: string, replaceHousehold = false) => {
    const list = social.get(from) ?? [];
    const at = list.findIndex(t => t.residentId === idOf.get(to));
    if (at >= 0 && !(replaceHousehold && householdOf.get(from) === householdOf.get(to))) throw new Error(`Duplicate social tie ${from}-${to}.`);
    // an authored tie between members of one household replaces the generic household tie
    if (at >= 0) list[at] = { residentId: idOf.get(to)!, description }; else list.push({ residentId: idOf.get(to)!, description });
    social.set(from, list);
  };
  for (const h of HOUSEHOLD_ROWS) {
    if (h.key === 'smithy') continue;  // the built household keeps its authored ties
    for (const m of h.members) for (const o of h.members) {
      if (m.key === o.key) continue;
      const related = KIN.some(([a, b]) => (a === m.key && b === o.key) || (a === o.key && b === m.key));
      addTie(m.key, o.key, related ? `Shares the hearth and the daily work with the ${labelOf(o.key)}.` : `Shares the house with the ${labelOf(o.key)} without being kin.`);
    }
  }
  for (const [a, b, ta, tb] of SOCIAL) {
    if (!rowOf.has(a) || !rowOf.has(b)) throw new Error(`Social tie ${a}-${b} names an unknown member.`);
    addTie(a, b, ta, true); addTie(b, a, tb, true);
  }

  // ---- registry residents (smithy entries reused from the casting, plus their village ties)
  const castingById = new Map(casting.registry.residents.map(r => [r.id, r] as const));
  const registryResidents = new Map<string, PeopleLifeResident>();
  const workOf = new Map<string, string>();
  for (const h of HOUSEHOLD_ROWS) {
    const hid = householdId(h);
    const slotsByMember = new Map<string, MutableSlot[]>();
    if (h.key !== 'smithy') for (const m of h.members) {
      const def = role(m.role);
      const work = def.work === 'home' ? h.home : def.work;
      slotsByMember.set(m.key, templateSlots(def, h.home, work).map(([startMinute, endMinute, activity, placeId]) => ({ startMinute, endMinute, activity, placeId, companionIds: [] })));
    }
    // household meals: companions are the other members with the identical meal slot at home
    for (const [key, slots] of slotsByMember) for (const s of slots) {
      if (MEALS.indexOf(s.activity) < 0 || s.placeId !== h.home) continue;
      const companions: string[] = [];
      for (const [other, otherSlots] of slotsByMember) {
        if (other === key) continue;
        if (otherSlots.some(o => o.startMinute === s.startMinute && o.endMinute === s.endMinute && o.activity === s.activity && o.placeId === s.placeId)) companions.push(idOf.get(other)!);
      }
      s.companionIds = companions;
    }
    for (const m of h.members) {
      const id = idOf.get(m.key)!;
      const extraTies = social.get(m.key) ?? [];
      if (h.key === 'smithy') {
        const base = castingById.get(id);
        if (!base) throw new Error(`Built resident ${id} is missing from the household casting.`);
        registryResidents.set(id, { ...base, socialTies: base.socialTies.concat(extraTies) });
        continue;
      }
      const def = role(m.role);
      workOf.set(id, def.work === 'home' ? h.home : def.work);
      const kinTies = kin.get(m.key) ?? [];
      let family: PeopleLifeFamily;
      if (kinTies.length) family = { kind: 'local-kin', ties: kinTies };
      else if (m.noLocalKin) family = { kind: 'no-local-kin', explanation: m.noLocalKin };
      else throw new Error(`Resident ${m.key} needs kin or an authored family circumstance.`);
      registryResidents.set(id, {
        id, label: m.label,
        identityNote: `Working placeholder: ${m.note}`,
        influenceSensitivity: m.persistent ? 'persistent' : 'occasional',
        role: { id: def.id, label: def.label, purpose: def.purpose },
        homeHouseholdId: hid, family, socialTies: extraTies,
        routine: slotsByMember.get(m.key)!,
        decisionMemory: { source: 'inherited-story-choices' },
      });
    }
  }

  // the smithy four keep the household casting's routines exactly (shared data): they count, but never move
  spreadCrowdedPlaces(registryResidents, workOf, new Map(HOUSEHOLD_ROWS.map(h => [householdId(h), h.home] as const)));

  // ---- lineages (founders seeded by their sibling group; children inherit from in-village parents)
  const keys = [...rowOf.keys()];
  const parentsOf = new Map<string, string[]>(keys.map(k => [k, [] as string[]]));
  const siblingRoot = new Map<string, string>(keys.map(k => [k, k]));
  const findRoot = (k: string): string => { let r = k; while (siblingRoot.get(r) !== r) r = siblingRoot.get(r)!; return r; };
  for (const [a, b, rel] of KIN) {
    if (rel === 'parent') parentsOf.get(b)!.push(a);
    if (rel === 'sibling') { const ra = findRoot(a), rb = findRoot(b); if (ra !== rb) siblingRoot.set(ra < rb ? rb : ra, ra < rb ? ra : rb); }
  }
  const lineage = new Map<string, Lineage>();
  const lineageOf = (k: string): Lineage => {
    const known = lineage.get(k); if (known) return known;
    const parents = parentsOf.get(k)!;
    let out: Lineage;
    if (parents.length) {
      const ps = parents.map(lineageOf), r = rng(`lineage-child:${k}`);
      const avg = (f: 'african' | 'asian' | 'caucasian') => round3(ps.reduce((s, p) => s + p.mix[f], 0) / ps.length);
      const african = avg('african'), asian = avg('asian');
      out = { mix: { african, asian, caucasian: round3(1 - african - asian) }, hair: pick(r, ps).hair, eyes: pick(r, ps).eyes,
        tone: round3(ps.reduce((s, p) => s + p.tone, 0) / ps.length) };
    } else {
      const r = rng(`lineage-founder:${findRoot(k)}`);
      out = { mix: pick(r, FAMILY_MIXES), hair: pick(r, HAIR_BASES), eyes: pick(r, EYE_POOL), tone: round3((r() - 0.5) * 0.16) };
    }
    lineage.set(k, out); return out;
  };

  // ---- appearance
  const usedSignatures = new Set<string>();
  // balancing (art fixer, 8 November): cuts, headwear, shapes and tones are spread over a kit's residents instead of
  // drawn independently, so one kit never collapses into a single cut or a row of identical domes
  const use = new Map<string, number>();
  const used = (k: string) => use.get(k) ?? 0;
  const bump = (k: string) => use.set(k, used(k) + 1);
  const roleLooks = new Set<string>();
  const residents: PopulationResident[] = [];
  const households: PopulationHousehold[] = [];
  for (const h of HOUSEHOLD_ROWS) {
    const hid = householdId(h);
    households.push({ id: hid, label: h.label, homePlaceId: h.home, memberIds: h.members.map(m => idOf.get(m.key)!), kind: h.kind });
    const householdMains = new Set<string>();
    const householdLooks = new Set<string>();
    /** The resident's cut (pure in the usage so far, so the height step and the look step agree). */
    const cutFor = (def: RoleDef, kitId: PopulationOutfitKit, id: string): string => {
      const kit = getOutfitKit(kitId);
      if (def.cut && kit.cuts.some(c => c.id === def.cut)) return def.cut;
      const cr = rng(`cut:${id}`);
      return kit.cuts.map(c => ({ c: c.id, score: used(`cut|${kitId}|${c.id}`) * 10 + (householdLooks.has(`cut|${kitId}|${c.id}`) ? 6 : 0)
        + used(`rolecut|${def.id}|${c.id}`) * 12, tie: cr() })).sort((a, b) => a.score - b.score || a.tie - b.tie)[0].c;
    };
    for (const m of h.members) {
      const id = idOf.get(m.key)!;
      const def = role(m.role);
      const archetype = archetypeFor(m.sex, m.age);
      if (!archetype) throw new Error(`No archetype covers ${m.key} (${m.sex}, ${m.age}).`);
      const spec = getArchetypeSpec(archetype);
      const r = rng(`appearance:${id}`);
      const lin = lineageOf(m.key);
      // stature is spread over the residents of one outfit kit (art fixer, 8 November: residents of a kit stood at one
      // height and their silhouettes overlapped almost exactly); the drawn class only breaks ties
      const drawnHeight = pick(r, ['average', 'average', 'short', 'tall'] as const);
      const heightKit = def.kit[m.sex];
      // residents who share the kit's cut, the role or the household are kept at different heights first
      const heightCut = h.key === 'smithy' ? 'standard' : cutFor(def, heightKit, id);
      const heightClass: HeightClass = m.height ?? (h.key === 'smithy' ? drawnHeight : (['short', 'average', 'tall'] as const)
        .map(x => ({ x, score: used(`height|${heightKit}|${x}`) * 10 + used(`heightcut|${heightKit}|${heightCut}|${x}`) * 25
          + used(`heightrole|${def.id}|${x}`) * 6 + (householdLooks.has(`height|${x}`) ? 8 : 0) + (x === drawnHeight ? 0 : 1) }))
        .sort((a, b) => a.score - b.score)[0].x);
      if (h.key !== 'smithy') {
        for (const k of [`height|${heightKit}|${heightClass}`, `heightcut|${heightKit}|${heightCut}|${heightClass}`, `heightrole|${def.id}|${heightClass}`]) bump(k);
        householdLooks.add(`height|${heightClass}`);
      }
      const frame: Frame = m.frame ?? pick(r, ['medium', 'lean', 'medium', 'broad', 'slight'] as const);
      const work = def.work === 'home' ? h.home : def.work;
      const sensitivity: PeopleLifeInfluenceSensitivity = m.persistent ? 'persistent' : 'occasional';
      const tier: PopulationFidelityTier = m.major ? 'major' : 'persistent';
      let appearance: PopulationAppearance;
      if (h.key === 'smithy') {
        const profile = casting.profiles.find(p => p.residentId === id)!;
        const mh = profile.makehuman;
        const setName = { [SMITH]: 'village-smith-v1', [SPINNER]: 'smithy-spinner-v1', [SMITHY_CHILD]: 'smithy-child-v1', [SMITHY_ELDER]: 'smithy-elder-v1' }[id]!;
        appearance = {
          kind: 'existing-set', existingSet: setName, archetype,
          macro: { gender: mh.gender, ageYears: mh.ageYears, muscle: mh.muscle, weight: mh.weight, height: mh.height, proportions: mh.proportions,
            macroShapeFamilies: mh.macroShapeFamilies },
          faceTargets: mh.faceTargets.map(t => ({ target: t.target, weight: t.weight })),
          skin: { base: mh.baseSkin, toneShift: 0, weathering: profile.face.weathering.slice() },
          eyes: mh.eyeTexture.replace(/_eye\.png$/, ''),
          hair: { style: id === SMITH ? 'balding-crop' : id === SMITHY_CHILD ? 'tousled-child' : id === SMITHY_ELDER ? 'bun' : 'long-braid',
            colour: profile.hair.colour, facialHair: id === SMITH ? 'short-beard' : 'none' },
          headwear: def.headwear[m.sex][0], headwearStyle: { shape: 'plain', tone: 'none', colour: null },
          outfit: { kit: 'existing-household-set', cut: 'standard', palette: { main: 'undyed-cream', secondary: 'undyed-cream', accent: 'undyed-cream' }, wear: def.wear },
          props: [], motion: { library: null, walk: 'walk', idle: 'idle', talk: 'talk', rate: 1, roleClips: [] },
          silhouette: profile.silhouette, bannerPresentation: profile.bannerPresentation.item,
        };
      } else {
        const gender = archetype === 'child' ? (m.sex === 'male' ? 0.7 : 0.3) : archetype === 'adolescent' ? (m.sex === 'male' ? 0.85 : 0.15) : (m.sex === 'male' ? 1 : 0);
        const heightOffset = heightClass === 'short' ? -0.085 : heightClass === 'tall' ? 0.085 : 0;
        const frameWeight = { slight: 0.34, lean: 0.42, medium: 0.5, broad: 0.64, stout: 0.8 }[frame];
        const ageMuscle = archetype === 'child' ? 0.45 : archetype.indexOf('elder') === 0 ? Math.min(def.muscle, 0.45) : def.muscle;
        // MakeHuman's adult growth runs to 25 (a 17-year-old woman measures 141 cm against 160 cm at 30): young adults
        // take a macro age of at least 22 so they stand at adult height; the face keeps its youth through the targets.
        const macroAge = archetype === 'adult-male' || archetype === 'adult-female' ? Math.max(m.age, 22) : m.age;
        const macro = {
          gender, ageYears: macroAge,
          muscle: round3(clamp01(ageMuscle + (r() - 0.5) * 0.1)),
          weight: round3(clamp01(frameWeight + (r() - 0.5) * 0.08)),
          height: round3(clamp01(Math.max(spec.reference.height - spec.heightMacroSpread + 0.001,
            Math.min(spec.reference.height + spec.heightMacroSpread - 0.001, spec.reference.height + heightOffset + (r() - 0.5) * 0.04)))),
          proportions: round3(0.45 + r() * 0.1),
          macroShapeFamilies: { african: lin.mix.african, asian: lin.mix.asian, caucasian: lin.mix.caucasian },
        };
        const faceTargets: PopulationFaceTarget[] = [];
        for (const slot of FACE_SLOTS) {
          if (r() < 0.32) continue;
          const t = pick(r, slot), w = round3(0.15 + r() * 0.35);
          faceTargets.push({ target: t, weight: w });
          if (t.indexOf('/l-') >= 0) faceTargets.push({ target: mirrored(t), weight: round3(w * (0.8 + r() * 0.3)) });
        }
        if (m.age >= 38) faceTargets.push({ target: 'head/head-age-incr', weight: round3(Math.min(0.7, (m.age - 30) / 70)) });
        const band = ageBandFor(m.age);
        const skinAge = band === 'elder' ? 'old' : band === 'middle-aged' ? 'middleage' : 'young';
        const skinBase = `${skinAge}_caucasian_${m.sex}`;
        const weathering: string[] = [];
        if (def.routine === 'field' || def.routine === 'herding' || def.routine.indexOf('guard') === 0) weathering.push('wind-burn');
        if (def.wear === 'flour-dusted') weathering.push('flour dust');
        if (def.wear === 'stained') weathering.push('stained hands');
        if (band === 'elder') weathering.push('age spots');
        if (band === 'child' && r() < 0.5) weathering.push('freckles');
        if (def.group === 'guards-military' && r() < 0.4) weathering.push('old scar');
        const hairColour = m.age >= 72 ? 'white' : m.age >= 58 ? `grey-${lin.hair}` : m.age >= 46 ? `greying-${lin.hair}` : lin.hair;
        // styles, headwear and palette are re-drawn until the visible signature is unique in the village
        let signature = '';
        let hairStyle: PopulationHairStyle = 'cropped', facialHair: PopulationFacialHair = 'none', headwear: PopulationHeadwear = 'none';
        let main: PopulationDye = 'undyed-grey', secondary: PopulationDye = 'undyed-grey', accent: PopulationDye = 'undyed-grey';
        let shape = 'plain', tone: PopulationHeadwearTone = 'none', hwColour: string | null = null;
        const kitId = def.kit[m.sex];
        const kit = getOutfitKit(kitId);
        if (kit.archetypes.indexOf(archetype) < 0) throw new Error(`Kit ${kitId} does not fit ${m.key} (${archetype}).`);
        // the cut: the role's preferred cut when the kit has it, else the kit's least used cut, kept apart from the
        // household's and the role's cuts where possible
        const cutId = cutFor(def, kitId, id);
        // headwear ranked by use inside the kit (weighted by how often the role lists it), the role and the household
        const hwList = def.headwear[m.sex];
        const hr = rng(`headwear:${id}`);
        const hwRank = hwList.filter((x, i) => hwList.indexOf(x) === i).map(x => ({ x,
          score: used(`hw|${kitId}|${x}`) * 10 / hwList.filter(y => y === x).length + used(`rolehw|${def.id}|${x}`) * 12 + (householdLooks.has(`hw|${x}`) ? 2 : 0),
          tie: hr() })).sort((a, b) => a.score - b.score || a.tie - b.tie).map(e => e.x);
        for (let attempt = 0; attempt < 400 && !signature; attempt++) {
          const v = rng(`look:${id}:${attempt}`);
          if (m.sex === 'male') {
            hairStyle = archetype === 'child' ? pick(v, ['tousled-child', 'cropped-child'] as const)
              : def.id === 'parish-priest' ? 'tonsure'
              : m.age >= 72 ? 'thinning-white'
              : m.age >= 45 ? pick(v, ['balding-crop', 'cropped', 'short-tousled', 'curly-short'] as const)
              : pick(v, ['cropped', 'short-tousled', 'tied-back', 'curly-short'] as const);
            facialHair = m.age < 18 ? 'none' : m.age < 22 ? pick(v, ['none', 'stubble'] as const)
              : pick(v, ['none', 'stubble', 'short-beard', 'full-beard', 'moustache', 'short-beard'] as const);
          } else {
            hairStyle = archetype === 'child' ? pick(v, ['twin-braids', 'loose-long', 'tousled-child'] as const)
              : archetype === 'adolescent' ? pick(v, ['long-braid', 'loose-long', 'twin-braids'] as const)
              : m.age >= 72 ? 'thinning-white'
              : pick(v, ['bun', 'long-braid', 'bun', 'tied-back'] as const);
            facialHair = 'none';
          }
          headwear = hwRank[Math.floor(attempt / 40) % hwRank.length];
          main = pick(v, kit.dyes.main); secondary = pick(v, kit.dyes.secondary); accent = pick(v, kit.dyes.accent);
          // household members wear different main colours where the kit allows it, so a family reads as several people
          if (kit.dyes.main.length > 1 && householdMains.has(main) && attempt < 60) continue;
          const shapes = POPULATION_HEADWEAR_SHAPES[headwear];
          shape = shapes.map(x => ({ x, score: used(`shape|${kitId}|${headwear}|${x}`) * 10 + (householdLooks.has(`shape|${headwear}|${x}`) ? 4 : 0), tie: v() }))
            .sort((a, b) => a.score - b.score || a.tie - b.tie)[0].x;
          // a felt cap is never drawn close to the wearer's hair colour (the farthest of main and secondary when both are near)
          const capDistance = (t: PopulationHeadwearTone) => colourDistance(toneColour(t, { main, secondary, accent })!, hairSrgb(hairColour));
          const far = POPULATION_HEADWEAR_TONES[headwear].filter(t => headwear !== 'felt-cap' || capDistance(t) > 70);
          const tones = far.length ? far : POPULATION_HEADWEAR_TONES[headwear].slice().sort((x, y) => capDistance(y) - capDistance(x)).slice(0, 1);
          tone = tones.map(x => ({ x, score: used(`tone|${headwear}|${x}`) * 10 + (householdLooks.has(`tone|${x}`) ? 4 : 0), tie: v() }))
            .sort((a, b) => a.score - b.score || a.tie - b.tie)[0].x;
          hwColour = toneColour(tone, { main, secondary, accent });
          // residents of one role in one kit never share both the cut and the headwear shape
          if (roleLooks.has([def.id, kitId, cutId, headwear, shape].join('|')) && attempt < 380) continue;
          // the signature is what renders: hair hidden under a full cover does not count, the headwear counts by shape
          // and built colour, and the cut counts
          const hairShows = FULL_COVER.indexOf(headwear) < 0;
          const candidate = [kitId, cutId, main, secondary, accent, headwear, shape, hwColour ?? '-', hairShows ? hairStyle : '-',
            hairShows || facialHair !== 'none' ? hairColour : '-', facialHair].join('|');
          if (!usedSignatures.has(candidate)) signature = candidate;
        }
        if (!signature) throw new Error(`Could not give ${m.key} a unique look.`);
        usedSignatures.add(signature); householdMains.add(main); roleLooks.add([def.id, kitId, cutId, headwear, shape].join('|'));
        for (const k of [`cut|${kitId}|${cutId}`, `rolecut|${def.id}|${cutId}`, `hw|${kitId}|${headwear}`, `rolehw|${def.id}|${headwear}`,
          `shape|${kitId}|${headwear}|${shape}`, `tone|${headwear}|${tone}`]) bump(k);
        for (const k of [`cut|${kitId}|${cutId}`, `hw|${headwear}`, `shape|${headwear}|${shape}`, `tone|${tone}`]) householdLooks.add(k);
        const mv = rng(`motion:${id}`);
        const walk = def.walk === 'any' ? pick(mv, ['walk', 'walk', 'walk_b', 'walk_c'] as const) : def.walk;
        const roleClips = def.clips.slice();
        if (walk === 'walk_crutch' && roleClips.indexOf('walk_crutch') < 0) roleClips.push('walk_crutch');
        // role-loop variants: the least used variant so far (ties: this resident's own seed); the motion seed above is
        // left untouched, so idle, talk and rate keep their values
        const lv = rng(`loopvariant:${id}`);
        for (let i = 0; i < roleClips.length; i++) {
          const spec = ROLE_LOOP_VARIANTS[roleClips[i]];
          if (!spec || (spec.groups && spec.groups.indexOf(def.group) < 0)) continue;
          if (roleClips[i] === 'guard_stand_watch' && roleClips.indexOf('guard_challenge') >= 0) continue;
          const base = roleClips[i];
          const choice = spec.variants.filter(v => v === base || roleClips.indexOf(v) < 0)
            .map(v => ({ v, score: used(`loopvar|${base}|${v}`), tie: lv() })).sort((a, b) => a.score - b.score || a.tie - b.tie)[0].v;
          bump(`loopvar|${base}|${choice}`);
          roleClips[i] = choice;
        }
        appearance = {
          kind: 'crowd', existingSet: null, archetype, macro,
          faceTargets, skin: { base: skinBase, toneShift: lin.tone, weathering },
          eyes: lin.eyes,
          hair: { style: hairStyle, colour: hairColour, facialHair },
          headwear, headwearStyle: { shape, tone, colour: hwColour },
          outfit: { kit: kitId, cut: cutId, palette: { main, secondary, accent }, wear: def.wear },
          props: def.props.concat(def.variantProps && used(`rolemember|${def.id}`) % 2 === 1 ? def.variantProps : []).map(([pid, socket]) => ({ id: pid, socket })),
          motion: { library: `crowd-clips-${archetype}-v1`, walk, idle: walk === 'walk_stick' ? 'idle_stick' : pick(mv, ['idle', 'idle_b'] as const),
            talk: pick(mv, ['talk', 'talk_b'] as const), rate: round3(0.94 + mv() * 0.12), roleClips },
          silhouette: def.silhouette, bannerPresentation: kit.bannerPresentation,
        };
        bump(`rolemember|${def.id}`);
      }
      residents.push({
        id, label: m.label, roleId: def.id, roleLabel: def.label, purpose: def.purpose, group: def.group, ageYears: m.age, ageBand: ageBandFor(m.age),
        sex: m.sex, build: { heightClass, frame }, householdId: hid, homePlaceId: h.home, workPlaceId: work,
        fidelityTier: tier, influenceSensitivity: sensitivity, registry: registryResidents.get(id)!, appearance,
      });
    }
  }

  // ---- clip libraries (derived from who uses which clip)
  const clipLibraries: PopulationClipLibrary[] = POPULATION_ARCHETYPES.map(archetype => {
    const users = residents.filter(r => r.appearance.kind === 'crowd' && r.appearance.archetype === archetype);
    const set: string[] = BASE_CLIPS.concat(ARCHETYPE_EXTRA_CLIPS[archetype]);
    for (const u of users) for (const c of u.appearance.motion.roleClips.concat([u.appearance.motion.walk])) if (set.indexOf(c) < 0) set.push(c);
    return { archetype, file: `crowd-clips-${archetype}-v1.glb`, clips: set, residents: users.length };
  });

  const registry: PeopleLifeRegistry = {
    places: places.map(p => ({ id: p.id, label: p.label })),
    households: households.map(h => ({ id: h.id, label: h.label, homePlaceId: h.homePlaceId, memberIds: h.memberIds })),
    residents: residents.map(r => r.registry),
  };
  return { status: VILLAGE_POPULATION_STATUS, decidedOn: VILLAGE_POPULATION_DECIDED_ON, houseStandingEffect: 'none',
    places, households, residents, clipLibraries, registry };
}

/** Builds a fresh frozen copy (deterministic: every call returns deep-equal data). */
export function createVillagePopulation(): VillagePopulation {
  return deepFreeze(buildPopulation());
}

export const EALDHOLT_VILLAGE_POPULATION: VillagePopulation = createVillagePopulation();

export function getPopulationResident(residentId: string, population: VillagePopulation = EALDHOLT_VILLAGE_POPULATION): PopulationResident | null {
  for (const r of population.residents) if (r.id === residentId) return r;
  return null;
}

/** Published crowd file for a resident (crowd residents) or null for the built smithy sets, which keep their own levels. */
export function crowdResidentFile(resident: PopulationResident): string | null {
  return resident.appearance.kind === 'crowd' ? `crowd-v1/residents/${resident.id}.glb` : null;
}
export function crowdClipLibraryFile(archetype: PopulationArchetype): string {
  return `crowd-v1/clips/crowd-clips-${archetype}-v1.glb`;
}

// ------------------------------------------------------------------ validation

/** Words that start with a capital letter anywhere except a sentence start are treated as proper names. */
function properNameIn(text: string): string | null {
  for (const sentence of text.split(/[.!?;:]\s+|\(/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const word = words[i].replace(/^[("']+/, '');
      if (/^[A-Z]/.test(word)) return word;
    }
  }
  return null;
}

/** Validates the population proposal. Returns null or the first problem. */
export function validateVillagePopulation(value: VillagePopulation): string | null {
  if (value.status !== VILLAGE_POPULATION_STATUS) return 'Population must stay marked working-placeholder.';
  if (value.houseStandingEffect !== 'none') return 'Population cannot affect house standing; only My Legacy chess matches do.';
  if (value.residents.length !== VILLAGE_POPULATION_SIZE) return `Population must have exactly ${VILLAGE_POPULATION_SIZE} residents.`;
  if (value.households.length !== VILLAGE_POPULATION_HOUSEHOLDS) return `Population must have ${VILLAGE_POPULATION_HOUSEHOLDS} households.`;
  for (const g of POPULATION_GROUPS) {
    const n = value.residents.filter(r => r.group === g).length;
    if (n !== VILLAGE_POPULATION_GROUP_COUNTS[g]) return `Group ${g} has ${n} residents; the creator set ${VILLAGE_POPULATION_GROUP_COUNTS[g]}.`;
  }
  const ids = new Set<string>();
  for (const r of value.residents) { if (ids.has(r.id)) return `Duplicate resident ${r.id}.`; ids.add(r.id); }
  const labels = new Set<string>();
  for (const r of value.residents) { if (labels.has(r.label)) return `Duplicate resident label ${r.label}.`; labels.add(r.label); }
  const major = value.residents.filter(r => r.fidelityTier === 'major').length;
  const m = VILLAGE_PERFORMANCE_MODEL;
  if (major < m.deeplySimulatedMajor.min || major > m.deeplySimulatedMajor.max) return `Major residents must number 15 to 25 (found ${major}).`;
  const persistent = value.residents.length - major;
  if (persistent < m.scheduleDrivenPersistent.min || persistent > m.scheduleDrivenPersistent.max) return `Persistent residents must number 75 to 85 (found ${persistent}).`;
  for (const id of [SMITH, SPINNER, SMITHY_CHILD, SMITHY_ELDER]) {
    const r = value.residents.find(x => x.id === id);
    if (!r || r.householdId !== SMITHY_HOUSEHOLD || r.fidelityTier !== 'major' || r.appearance.kind !== 'existing-set') return `Built smithy resident ${id} must stay in the smithy household as a major character.`;
  }
  for (const r of value.residents) if (r.group === 'leaders-clergy-specialists' && r.fidelityTier !== 'major') return `${r.id}: leaders, clergy and specialists are major characters.`;
  for (const id of [STEWARD, MESSENGER, SMITH]) if (!ids.has(id)) return `Compatibility resident ${id} must keep its saved-content ID.`;
  const registryError = validatePeopleLifeRegistry(value.registry);
  if (registryError) return `People-life registry: ${registryError}`;
  const placeIds = new Set(value.places.map(p => p.id));
  for (const p of value.places) {
    if (p.status === 'proposed-placeholder' && p.id.indexOf('proposed-') !== 0) return `Proposed place ${p.id} must be marked by its ID.`;
    if (p.status === 'household-casting-place' && !EALDHOLT_HOUSEHOLD_CASTING.registry.places.some(c => c.id === p.id)) return `Place ${p.id} is not a household-casting place.`;
  }
  for (const h of value.households) {
    if (h.memberIds.length < 2 || h.memberIds.length > 7) return `Household ${h.id} must have 2 to 7 members.`;
    if (!placeIds.has(h.homePlaceId)) return `Household ${h.id} needs a registered home.`;
  }
  const texts: string[] = [];
  for (const r of value.residents) {
    if (!placeIds.has(r.homePlaceId) || !placeIds.has(r.workPlaceId)) return `${r.id}: home and work places must be registered.`;
    const a = r.appearance, spec = getArchetypeSpec(a.archetype);
    if (spec.sexes.indexOf(r.sex) < 0 || r.ageYears < spec.ageYears[0] || r.ageYears > spec.ageYears[1]) return `${r.id}: archetype ${a.archetype} does not cover ${r.sex} ${r.ageYears}.`;
    if (a.kind === 'crowd') {
      if (Math.abs(a.macro.height - spec.reference.height) > spec.heightMacroSpread + 1e-9) return `${r.id}: height macro outside the archetype spread.`;
      for (const k of ['muscle', 'weight', 'height', 'proportions'] as const) if (!(a.macro[k] >= 0 && a.macro[k] <= 1)) return `${r.id}: macro ${k} must be 0..1.`;
      const fam = a.macro.macroShapeFamilies;
      if (Math.abs(fam.african + fam.asian + fam.caucasian - 1) > 0.01) return `${r.id}: family mix must sum to 1.`;
      for (const t of a.faceTargets) if (!/^(head|nose|mouth|chin|cheek|eyebrows|eyes|ears|asym)\//.test(t.target) || !(t.weight > 0 && t.weight <= 1)) return `${r.id}: face targets are head-region CC0 targets with weights 0..1.`;
      const kit = getOutfitKit(a.outfit.kit);
      if (kit.archetypes.indexOf(a.archetype) < 0) return `${r.id}: kit ${kit.id} does not fit ${a.archetype}.`;
      if (kit.dyes.main.indexOf(a.outfit.palette.main) < 0 || kit.dyes.secondary.indexOf(a.outfit.palette.secondary) < 0 || kit.dyes.accent.indexOf(a.outfit.palette.accent) < 0) return `${r.id}: palette outside the kit.`;
      if (!kit.cuts.some(c => c.id === a.outfit.cut)) return `${r.id}: cut ${a.outfit.cut} is not a cut of kit ${kit.id}.`;
      if (POPULATION_HEADWEAR_SHAPES[a.headwear].indexOf(a.headwearStyle.shape) < 0) return `${r.id}: headwear shape ${a.headwearStyle.shape} does not fit ${a.headwear}.`;
      if (POPULATION_HEADWEAR_TONES[a.headwear].indexOf(a.headwearStyle.tone) < 0) return `${r.id}: headwear tone ${a.headwearStyle.tone} does not fit ${a.headwear}.`;
      if (a.headwearStyle.colour !== toneColour(a.headwearStyle.tone, a.outfit.palette)) return `${r.id}: headwear colour must be the built tone.`;
      const lib = value.clipLibraries.find(l => l.archetype === a.archetype)!;
      for (const c of [a.motion.walk, a.motion.idle, a.motion.talk].concat(a.motion.roleClips)) {
        if (!getPopulationClip(c)) return `${r.id}: unknown clip ${c}.`;
        if (lib.clips.indexOf(c) < 0) return `${r.id}: clip ${c} missing from the ${a.archetype} library.`;
      }
      if (!(a.motion.rate >= 0.9 && a.motion.rate <= 1.1)) return `${r.id}: playback rate must stay within 10 percent.`;
      for (const p of a.props) if (!getPopulationProp(p.id)) return `${r.id}: unknown prop ${p.id}.`;
    }
    texts.push(r.label, r.roleLabel, r.purpose, a.silhouette);
  }
  for (const p of value.places) texts.push(p.label);
  for (const h of value.households) texts.push(h.label);
  for (const r of value.registry.residents) {
    texts.push(r.identityNote);
    if (r.family.kind === 'local-kin') for (const t of r.family.ties) texts.push(t.description); else texts.push(r.family.explanation);
    for (const t of r.socialTies) texts.push(t.description);
    for (const s of r.routine) texts.push(s.activity);
  }
  for (const t of texts) { const n = properNameIn(t); if (n) return `Use role labels only; "${n}" reads as a proper name in: ${t}`; }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
