/**
 * Ealdholt household casting: one connected household for the first resident
 * art proof (see docs/legacy/characters/EALDHOLT_HOUSEHOLD_ART.md).
 *
 * WORKING PLACEHOLDER. Every role, relationship, routine, preference, garment
 * and consequence below is a replaceable proposal for creator review: role
 * labels only, no proper names, no lore and no private canon. Nothing here is
 * integrated, spawned, saved or simulated. The registry uses Codex's
 * people-life shapes so it can be validated by the existing kernel; the event
 * model is a proposal Codex may adopt, extend or replace. The art profiles
 * describe the four residents that are built and published under
 * main game/public/assets/legacy/environment/aethelgard/characters/ (see the
 * art doc); each profile's makehuman block mirrors its build recipe in
 * scripts/characters/recipes, and a test keeps the two equal.
 *
 * Invariants kept here and enforced by the validator:
 * - the player is an unseen influence: no avatar, no player-resident and no
 *   source knowledge; sensitivity only changes how often a resident pauses;
 * - only explicitly started My Legacy chess matches change house standing:
 *   nothing here reads or writes standing; banner colours are presentation;
 * - the smith keeps its existing compatibility ID and is an ordinary
 *   villager with the same capabilities as everyone else;
 * - one household of three to five people is proven before any expansion.
 *
 * Pure data plus a strict validator: no three, DOM, timers, clock reads,
 * randomness, storage or network. ES2020 compatible.
 */
import {
  PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS,
  validatePeopleLifeRegistry,
  type PeopleLifeRegistry,
  type PeopleLifeResident,
} from '../people-life';
import { createPeopleLifeEventsSnapshot, type PeopleLifeEventModel } from '../people-life-events';
import { EALDHOLT_PEOPLE_DRAFT } from '../people-draft';

export const HOUSEHOLD_CASTING_STATUS = 'working-placeholder' as const;
/** The day every licence and source fact below was read from its publisher. */
export const HOUSEHOLD_CASTING_VERIFIED_ON = '2026-11-06' as const;
/** Prove one household first; 16 to 20 residents is a later, separate step. */
export const HOUSEHOLD_CASTING_MEMBER_RANGE = Object.freeze({ min: 3, max: 5 } as const);

// ------------------------------------------------------------------ sources

export type CastingLicence =
  | 'CC0-1.0'
  | 'CC-BY-4.0'
  | 'MIT'
  | 'LicenseRef-CMU-Mocap-Terms'
  | 'LicenseRef-Project-Original';
export type CastingRedistribution =
  | 'allowed'
  | 'allowed-with-attribution'
  | 'allowed-with-notice'
  | 'conditional-creator-approval';
export type CastingSourceKind =
  | 'body-base'
  | 'rig'
  | 'face-morphs'
  | 'system-assets'
  | 'motion'
  | 'props-and-fabrics'
  | 'original';

export interface CastingSource {
  readonly id: string;
  readonly kind: CastingSourceKind;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly licence: CastingLicence;
  readonly redistribution: CastingRedistribution;
  /** Required text for attribution licences and custom terms; null for CC0/original. */
  readonly attribution: string | null;
  /** What was checked at asset level, not a site-wide claim. */
  readonly assetLevelEvidence: string;
  /** SHA-256 of the exact archive inspected, when a single archive exists. */
  readonly archiveSha256: string | null;
}

const CC0 = 'CC0-1.0' as const;

export const HOUSEHOLD_CASTING_SOURCES: readonly CastingSource[] = deepFreeze([
  {
    id: 'makehuman-base',
    kind: 'body-base',
    title: 'MakeHuman hm08 base mesh with macro and detail shape targets (MPFB2 data folder)',
    url: 'https://github.com/makehumancommunity/mpfb2/tree/6ff1eb358f6c1959ced77e79e6dd2406d9a71f49/src/mpfb/data',
    author: 'MakeHuman team (Data Collection AB, Joel Palmius, Jonas Hauquier)',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'LICENSE.ASSETS.md is CC0 1.0 for mesh, targets, rigs and textures; base.obj carries the explicit 2020 CC0 release header. MPFB2 program code is GPL-3.0 and is neither used nor redistributed.',
    archiveSha256: null,
  },
  {
    id: 'makehuman-face-joint-rig',
    kind: 'rig',
    title: 'MakeHuman 64-bone rig and weights with jaw, eye and upper/lower eyelid joints (rig.mixamo_unity.json)',
    url: 'https://github.com/makehumancommunity/mpfb2/tree/6ff1eb358f6c1959ced77e79e6dd2406d9a71f49/src/mpfb/data/rigs/standard',
    author: 'MakeHuman team',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'weights.mixamo_unity.json declares license CC0; the bone names are a naming convention only and no Mixamo asset is involved. Rename bones to neutral names in the pipeline.',
    archiveSha256: null,
  },
  {
    id: 'makehuman-system-assets',
    kind: 'system-assets',
    title: 'makehuman_system_assets pack: skins, eyes, eyebrows, eyelashes, teeth, tongue, proxies, hair',
    url: 'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip',
    author: 'makehuman_system',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'Pack manifest lists 94/94 assets as CC0; 209/209 mhclo, mhmat, obj and proxy files carry the CC0 release header.',
    archiveSha256: 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107',
  },
  {
    id: 'makehuman-faceunits01',
    kind: 'face-morphs',
    title: 'faceunits01: 52 ARKit-style face unit targets for hm08',
    url: 'https://files.makehumancommunity.org/functional/faceunits01.zip',
    author: 'Mika Suominen',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'packs/faceunits01.json lists license CC0 and the author for each of the 52 targets.',
    archiveSha256: 'd113107bd7eb59f3af4df6fc0ec29bfcc593f496d0b336aec14f086a80ce7146',
  },
  {
    id: 'makehuman-visemes02',
    kind: 'face-morphs',
    title: 'visemes02: 15 Meta-style viseme targets for hm08',
    url: 'https://files.makehumancommunity.org/functional/visemes02.zip',
    author: 'Mika Suominen',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'packs/visemes02.json lists license CC0 for each of the 15 targets.',
    archiveSha256: 'a69ab6fb95ddd5f56f70acc7e859f5f9c6ae613c527d577ea1571eff2183d29e',
  },
  {
    id: '100style',
    kind: 'motion',
    title: '100STYLE locomotion dataset (BVH, 60 fps, 23 joints)',
    url: 'https://zenodo.org/records/8127870',
    author: 'Ian Mason, Sebastian Starke, Taku Komura',
    licence: 'CC-BY-4.0',
    redistribution: 'allowed-with-attribution',
    attribution: '100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, doi:10.1145/3522618. Retargeted and trimmed.',
    assetLevelEvidence: 'The Zenodo record licence cc-by-4.0 covers 100STYLE.zip (1,468,515,354 bytes, md5 3cf627852fd8192024c04a8d0ef49583); sampled members were read by range requests.',
    archiveSha256: null,
  },
  {
    id: 'cmu-mocap',
    kind: 'motion',
    title: 'CMU Graphics Lab Motion Capture Database (ASF/AMC)',
    url: 'http://mocap.cs.cmu.edu/',
    author: 'Carnegie Mellon University Graphics Lab',
    licence: 'LicenseRef-CMU-Mocap-Terms',
    redistribution: 'conditional-creator-approval',
    attribution: 'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.',
    assetLevelEvidence: 'Home page terms: free for all uses and may be included in commercially sold products, but may not be resold directly, even in converted form. Not a Creative Commons licence; derived files would need to be excluded from the repository MIT grant.',
    archiveSha256: null,
  },
  {
    id: 'polyhaven',
    kind: 'props-and-fabrics',
    title: 'Poly Haven models and fabric textures (individual assets listed in HOUSEHOLD_CASTING_POLYHAVEN)',
    url: 'https://polyhaven.com/license',
    author: 'Individual Poly Haven authors (per asset)',
    licence: CC0,
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'Per-asset api.polyhaven.com/info and /files responses were read for every listed asset; Poly Haven publishes every asset as CC0.',
    archiveSha256: null,
  },
  {
    id: 'project-original',
    kind: 'original',
    title: 'Original Crownfall work authored for this project (garments, hair cards, keyframed loops, small props)',
    url: 'https://github.com/mylife-as-miles/Crownfall',
    author: 'Crownfall contributors',
    licence: 'LicenseRef-Project-Original',
    redistribution: 'allowed',
    attribution: null,
    assetLevelEvidence: 'Authored from scratch in headless Blender from CC0 inputs; licensed with the repository unless the creator chooses CC0.',
    archiveSha256: null,
  },
] as const satisfies readonly CastingSource[]);

/** Sources the creator's brief rules out; any reference fails validation. */
export const HOUSEHOLD_CASTING_FORBIDDEN_SOURCES: readonly string[] = Object.freeze([
  'mixamo', 'metahuman', 'smpl', 'fab', 'bandai-namco-motion', 'lafan1', 'amass',
]);

export interface CastingPolyHavenAsset {
  readonly id: string;
  readonly type: 'model' | 'texture';
  readonly authors: readonly string[];
  /** Poly Haven's stated polycount for models; null for textures. */
  readonly polycount: number | null;
  readonly use: string;
}

/** Facts read from api.polyhaven.com/info on 2026-11-06. */
export const HOUSEHOLD_CASTING_POLYHAVEN: readonly CastingPolyHavenAsset[] = deepFreeze([
  { id: 'cross_pein_hammer', type: 'model', authors: ['Tics'], polycount: 2124, use: 'Smith forging hammer.' },
  { id: 'wooden_hammer_01', type: 'model', authors: ['James Ray Cock'], polycount: 3617, use: 'Mallet for the elder mending tool handles.' },
  { id: 'wicker_basket_01', type: 'model', authors: ['Kuutti Siitonen'], polycount: 22276, use: 'Spinner wool basket; decimate for runtime.' },
  { id: 'wooden_bucket_01', type: 'model', authors: ['James Ray Cock'], polycount: 5116, use: 'Rinsing bucket at the riverbank.' },
  { id: 'wooden_spoon', type: 'model', authors: ['Ronnie Barter'], polycount: 6576, use: 'Spoon the elder is carving; decimate.' },
  { id: 'wooden_bowl_01', type: 'model', authors: ['Oliver Harries'], polycount: 14122, use: 'Finished wooden ware; decimate.' },
  { id: 'wooden_stool_01', type: 'model', authors: ['Kuutti Siitonen'], polycount: 10946, use: 'Elder carving seat at the doorstep.' },
  { id: 'rough_linen', type: 'texture', authors: ['colormass', 'Rico Cilliers'], polycount: null, use: 'Linen shirts, shifts, head-cloths and aprons.' },
  { id: 'caban', type: 'texture', authors: ['colormass', 'Rico Cilliers'], polycount: null, use: 'Heavy fulled wool tunics, overdresses and cloaks.' },
  { id: 'poly_wool_herringbone', type: 'texture', authors: ['colormass', 'Rico Cilliers'], polycount: null, use: 'Woven wool trousers, kirtles and shawls.' },
  { id: 'brown_leather', type: 'texture', authors: ['Rob Tuytel'], polycount: null, use: 'Smith apron, belts and pouches.' },
  { id: 'fabric_leather_02', type: 'texture', authors: ['Rob Tuytel'], polycount: null, use: 'Shoes and leg-wrap ties.' },
  { id: 'curly_teddy_natural', type: 'texture', authors: ['colormass', 'Rico Cilliers'], polycount: null, use: 'Sheepskin lining for the child vest.' },
  { id: 'hessian_230', type: 'texture', authors: ['colormass', 'Rico Cilliers'], polycount: null, use: 'Coarse cord and sacking.' },
] as const satisfies readonly CastingPolyHavenAsset[]);

// ------------------------------------------------------------------ registry (people-life shapes)

const SMITH = 'ealdholt-village-smith';
const SPINNER = 'ealdholt-smithy-spinner';
const CHILD = 'ealdholt-smithy-child';
const ELDER = 'ealdholt-smithy-elder';
const HOUSEHOLD = 'ealdholt-smithy-household';

type Slot = readonly [start: number, end: number, activity: string, placeId: string, companions: readonly string[]];
function routine(slots: readonly Slot[]): PeopleLifeResident['routine'] {
  return slots.map(([startMinute, endMinute, activity, placeId, companionIds]) => ({ startMinute, endMinute, activity, placeId, companionIds }));
}
const everyoneBut = (id: string) => [SMITH, SPINNER, CHILD, ELDER].filter(other => other !== id);

const REGISTRY: PeopleLifeRegistry = {
  places: [
    { id: 'smithy-house', label: 'Smithy household home' },
    { id: 'smithy-forge', label: 'Forge beside the smithy home' },
    { id: 'village-well', label: 'Village well' },
    { id: 'village-courtyard', label: 'Village courtyard' },
    { id: 'riverside-bank', label: 'Riverside bank below the village' },
    { id: 'village-pond', label: 'Village pond edge' },
    { id: 'churchyard', label: 'Churchyard' },
    { id: 'woodland-edge', label: 'Woodland edge beyond the village' },
  ],
  households: [
    { id: HOUSEHOLD, label: 'Smithy household', homePlaceId: 'smithy-house', memberIds: [SMITH, SPINNER, CHILD, ELDER] },
  ],
  residents: [
    {
      id: SMITH,
      label: 'Village smith',
      identityNote: 'Working placeholder: keeps the forge beside the family home, repairs the village ironwork and is teaching the household child the bellows.',
      influenceSensitivity: 'occasional',
      role: { id: 'village-smith', label: 'Village smith', purpose: 'Forges and repairs tools, fittings and hardware for the village.' },
      homeHouseholdId: HOUSEHOLD,
      family: { kind: 'local-kin', ties: [
        { residentId: SPINNER, kind: 'partner', description: 'Partner; together they run the house and the trade between forge and dye vat.' },
        { residentId: CHILD, kind: 'child', description: 'Their child, who is learning to keep the bellows steady.' },
        { residentId: ELDER, kind: 'parent', description: 'The smith\'s mother, who still judges every weld.' },
      ] },
      socialTies: [
        { residentId: SPINNER, description: 'Leans on the spinner\'s judgement about money and neighbours.' },
        { residentId: CHILD, description: 'Teaches the child patience at the forge, sometimes too sternly.' },
        { residentId: ELDER, description: 'Asks the elder\'s advice on old forge practice and does not always take it.' },
      ],
      routine: routine([
        [0, 330, 'Asleep at home.', 'smithy-house', []],
        [330, 360, 'Lights the forge before breakfast.', 'smithy-forge', []],
        [360, 390, 'Breakfast with the household.', 'smithy-house', everyoneBut(SMITH)],
        [390, 600, 'Forges and repairs village ironwork.', 'smithy-forge', []],
        [600, 690, 'Shows the child how to keep the bellows steady.', 'smithy-forge', [CHILD]],
        [690, 720, 'Quenches and racks finished pieces.', 'smithy-forge', []],
        [720, 780, 'Midday meal with the household.', 'smithy-house', everyoneBut(SMITH)],
        [780, 960, 'Heavy forging with hammer and tongs at the anvil.', 'smithy-forge', []],
        [960, 1020, 'Fetches water and trades news at the well.', 'village-well', []],
        [1020, 1110, 'Banks the fire and sharpens tools.', 'smithy-forge', []],
        [1110, 1170, 'Evening meal with the household.', 'smithy-house', everyoneBut(SMITH)],
        [1170, 1260, 'Mends a tool handle by the hearth beside the elder.', 'smithy-house', [ELDER]],
        [1260, 1440, 'Asleep at home.', 'smithy-house', []],
      ]),
      decisionMemory: { source: 'inherited-story-choices' },
    },
    {
      id: SPINNER,
      label: 'Spinner and dyer',
      identityNote: 'Working placeholder: spins and dyes yarn at the smithy home and rinses dyed wool at the riverbank.',
      influenceSensitivity: 'occasional',
      role: { id: 'spinner-dyer', label: 'Spinner and dyer', purpose: 'Spins yarn and dyes wool and narrow bands for village households.' },
      homeHouseholdId: HOUSEHOLD,
      family: { kind: 'local-kin', ties: [
        { residentId: SMITH, kind: 'partner', description: 'Partner; they share the household and its decisions.' },
        { residentId: CHILD, kind: 'child', description: 'Their child, who is learning to read colours in the dye vat.' },
        { residentId: ELDER, kind: 'other', description: 'Partner\'s mother; they share the hearth and disagree about raising the child.' },
      ] },
      socialTies: [
        { residentId: SMITH, description: 'Trusts the smith\'s steadiness and worries about forge burns.' },
        { residentId: CHILD, description: 'Takes the child to wash fleece and lets small mistakes pass.' },
        { residentId: ELDER, description: 'Respects the elder\'s experience while guarding their own way of running the house.' },
      ],
      routine: routine([
        [0, 330, 'Asleep at home.', 'smithy-house', []],
        [330, 360, 'Sets wool to soak before breakfast.', 'smithy-house', []],
        [360, 390, 'Breakfast with the household.', 'smithy-house', everyoneBut(SPINNER)],
        [390, 540, 'Spins yarn at the doorway.', 'smithy-house', []],
        [540, 660, 'Rinses dyed wool at the riverbank.', 'riverside-bank', []],
        [660, 720, 'Trades yarn and news in the courtyard.', 'village-courtyard', []],
        [720, 780, 'Midday meal with the household.', 'smithy-house', everyoneBut(SPINNER)],
        [780, 900, 'Tends the dye vat beside the house.', 'smithy-house', []],
        [900, 990, 'Washes fleece at the pond edge with the child.', 'village-pond', [CHILD]],
        [990, 1110, 'Winds skeins and spins.', 'smithy-house', []],
        [1110, 1170, 'Evening meal with the household.', 'smithy-house', everyoneBut(SPINNER)],
        [1170, 1260, 'Weaves narrow bands by the firelight.', 'smithy-house', []],
        [1260, 1440, 'Asleep at home.', 'smithy-house', []],
      ]),
      decisionMemory: { source: 'inherited-story-choices' },
    },
    {
      id: CHILD,
      label: 'Household child',
      identityNote: 'Working placeholder: the household\'s child, about ten, who fetches water and kindling and works the forge bellows.',
      influenceSensitivity: 'persistent',
      role: { id: 'household-child', label: 'Household child', purpose: 'Runs the household\'s errands while learning the forge and the dye work.' },
      homeHouseholdId: HOUSEHOLD,
      family: { kind: 'local-kin', ties: [
        { residentId: SMITH, kind: 'parent', description: 'Parent; the smith at whose bellows the child works.' },
        { residentId: SPINNER, kind: 'parent', description: 'Parent; the spinner who takes the child to wash fleece.' },
        { residentId: ELDER, kind: 'other', description: 'Grandparent on the smith\'s side.' },
      ] },
      socialTies: [
        { residentId: SMITH, description: 'Wants the smith\'s approval and hates being sent away from the anvil.' },
        { residentId: SPINNER, description: 'Prefers pond trips with the spinner to sitting at the spindle.' },
        { residentId: ELDER, description: 'Walks the elder to the churchyard and asks for the same stories again.' },
      ],
      routine: routine([
        [0, 330, 'Asleep at home.', 'smithy-house', []],
        [330, 360, 'Wakes and dresses.', 'smithy-house', []],
        [360, 390, 'Breakfast with the household.', 'smithy-house', everyoneBut(CHILD)],
        [390, 480, 'Fetches water for the household.', 'village-well', []],
        [480, 600, 'Gathers kindling at the woodland edge.', 'woodland-edge', []],
        [600, 690, 'Works the bellows beside the smith.', 'smithy-forge', [SMITH]],
        [690, 720, 'Plays in the courtyard.', 'village-courtyard', []],
        [720, 780, 'Midday meal with the household.', 'smithy-house', everyoneBut(CHILD)],
        [780, 900, 'Runs errands between neighbouring houses.', 'village-courtyard', []],
        [900, 990, 'Helps wash fleece at the pond edge.', 'village-pond', [SPINNER]],
        [990, 1080, 'Walks the elder to the churchyard and back.', 'churchyard', [ELDER]],
        [1080, 1110, 'Washes before supper.', 'smithy-house', []],
        [1110, 1170, 'Evening meal with the household.', 'smithy-house', everyoneBut(CHILD)],
        [1170, 1260, 'Listens to the elder by the hearth.', 'smithy-house', [ELDER]],
        [1260, 1440, 'Asleep at home.', 'smithy-house', []],
      ]),
      decisionMemory: { source: 'inherited-story-choices' },
    },
    {
      id: ELDER,
      label: 'Household elder',
      identityNote: 'Working placeholder: the smith\'s mother, no longer strong enough for the anvil, who carves wooden ware and mends tool handles.',
      influenceSensitivity: 'occasional',
      role: { id: 'household-elder', label: 'Household elder', purpose: 'Carves wooden ware, mends tool handles and keeps the household\'s practical knowledge.' },
      homeHouseholdId: HOUSEHOLD,
      family: { kind: 'local-kin', ties: [
        { residentId: SMITH, kind: 'child', description: 'The elder\'s child, now the village smith.' },
        { residentId: SPINNER, kind: 'other', description: 'The smith\'s partner, who runs the house the elder once ran.' },
        { residentId: CHILD, kind: 'other', description: 'Grandchild and companion on slow walks.' },
      ] },
      socialTies: [
        { residentId: SMITH, description: 'Proud of the smith and quick to point out a hurried weld.' },
        { residentId: SPINNER, description: 'Admires the spinner\'s eye for colour, less so their patience with the child.' },
        { residentId: CHILD, description: 'Leans on the child\'s arm more than the elder admits.' },
      ],
      routine: routine([
        [0, 330, 'Asleep at home.', 'smithy-house', []],
        [330, 360, 'Warms by the hearth.', 'smithy-house', []],
        [360, 390, 'Breakfast with the household.', 'smithy-house', everyoneBut(ELDER)],
        [390, 540, 'Carves wooden spoons at the doorstep.', 'smithy-house', []],
        [540, 630, 'Sits at the well and trades news.', 'village-well', []],
        [630, 720, 'Watches the forge work and offers advice.', 'smithy-forge', []],
        [720, 780, 'Midday meal with the household.', 'smithy-house', everyoneBut(ELDER)],
        [780, 990, 'Rests, then mends tool handles.', 'smithy-house', []],
        [990, 1080, 'Visits the churchyard with the child.', 'churchyard', [CHILD]],
        [1080, 1110, 'Tends the hearth.', 'smithy-house', []],
        [1110, 1170, 'Evening meal with the household.', 'smithy-house', everyoneBut(ELDER)],
        [1170, 1260, 'Carves by the hearth and talks with the smith and the child.', 'smithy-house', [SMITH, CHILD]],
        [1260, 1440, 'Asleep at home.', 'smithy-house', []],
      ]),
      decisionMemory: { source: 'inherited-story-choices' },
    },
  ],
};

/** Proposed structured facts for lasting consequences. Codex owns whether and
 * how events set them; nothing here records an occurrence. */
const EVENT_MODEL: PeopleLifeEventModel = {
  facts: [
    { id: 'smithy-smith-forearm-burned', subjectIds: [SMITH], initialValue: false, initiallyKnownTo: [] },
    { id: 'smithy-smith-forearm-scarred', subjectIds: [SMITH], initialValue: false, initiallyKnownTo: [] },
    { id: 'smithy-elder-hand-injured', subjectIds: [ELDER], initialValue: false, initiallyKnownTo: [] },
    { id: 'smithy-child-trusted-at-bellows', subjectIds: [CHILD, SMITH], initialValue: false, initiallyKnownTo: [] },
    { id: 'smithy-house-colours-dyed', subjectIds: [SPINNER], initialValue: false, initiallyKnownTo: [] },
    { id: 'smithy-smith-elder-quarrel', subjectIds: [SMITH, ELDER], initialValue: false, initiallyKnownTo: [] },
  ],
  eventTypes: [
    { id: 'smithy-forge-burn', factIds: ['smithy-smith-forearm-burned'], allowsFamilyRevision: false },
    { id: 'smithy-burn-healed', factIds: ['smithy-smith-forearm-burned', 'smithy-smith-forearm-scarred'], allowsFamilyRevision: false },
    { id: 'smithy-elder-fall', factIds: ['smithy-elder-hand-injured'], allowsFamilyRevision: false },
    { id: 'smithy-elder-recovered', factIds: ['smithy-elder-hand-injured'], allowsFamilyRevision: false },
    { id: 'smithy-bellows-trust', factIds: ['smithy-child-trusted-at-bellows'], allowsFamilyRevision: false },
    { id: 'smithy-house-colours-batch', factIds: ['smithy-house-colours-dyed'], allowsFamilyRevision: false },
    { id: 'smithy-quarrel', factIds: ['smithy-smith-elder-quarrel'], allowsFamilyRevision: false },
    { id: 'smithy-reconciliation', factIds: ['smithy-smith-elder-quarrel'], allowsFamilyRevision: false },
  ],
  familyRules: [
    { id: 'smithy-child-helps-injured-elder', residentId: CHILD, relativeId: ELDER, relation: 'kin', purpose: 'care', placeId: 'smithy-house',
      startMinute: 990, endMinute: 1080, conditions: [{ factId: 'smithy-elder-hand-injured', value: true, certainty: 'witness-or-report' }] },
    { id: 'smithy-spinner-dresses-smith-burn', residentId: SPINNER, relativeId: SMITH, relation: 'kin', purpose: 'care', placeId: 'smithy-house',
      startMinute: 1170, endMinute: 1260, conditions: [{ factId: 'smithy-smith-forearm-burned', value: true, certainty: 'witness-or-report' }] },
    { id: 'smithy-smith-checks-on-elder', residentId: SMITH, relativeId: ELDER, relation: 'kin', purpose: 'visit', placeId: 'smithy-house',
      startMinute: 960, endMinute: 1020, conditions: [{ factId: 'smithy-elder-hand-injured', value: true, certainty: 'including-rumor' }] },
  ],
};

// ------------------------------------------------------------------ art profiles

export type CastingAgeBand = 'child' | 'adult' | 'middle-aged' | 'elder';
export type CastingClothingSlot = 'base' | 'legs' | 'mid' | 'outer' | 'apron' | 'head' | 'belt' | 'hands' | 'feet';
export type CastingMotionKind = 'walk' | 'idle' | 'work' | 'transition' | 'sit';
export type CastingFacialTier = 'face-joints-and-morphs' | 'face-joints-only' | 'none';
export type CastingLodId = 'desktop-lod0' | 'desktop-lod1' | 'quest-near' | 'quest-miniature' | 'far-impostor';
export type CastingMotionSourceRef = `100style:${string}` | `cmu:${string}` | 'project-original:keyframe';
export type CastingAssetSourceRef = `polyhaven:${string}` | 'project-original' | `makehuman-system-assets:${string}`;

export interface CastingMakeHumanRecipe {
  /** MakeHuman macro sliders (0..1) and an age in years; tool parameters only. */
  readonly gender: number; readonly ageYears: number; readonly muscle: number; readonly weight: number;
  readonly height: number; readonly proportions: number;
  /** MakeHuman's own three shape-target families; tool parameters for variety, not identity or lore. */
  readonly macroShapeFamilies: { readonly african: number; readonly asian: number; readonly caucasian: number };
  /** Signature CC0 detail targets (path below targets/, weight 0..1) that make the face individual: a subset of
   *  the build recipe's full detailTargets (scripts/characters/recipes), kept equal to it by a test. */
  readonly faceTargets: readonly { readonly target: string; readonly weight: number }[];
  /** Base skin from makehuman_system_assets before authored weathering layers. */
  readonly baseSkin: string;
  readonly eyeTexture: string;
}

export interface CastingClothingLayer {
  readonly slot: CastingClothingSlot; readonly garment: string; readonly material: CastingAssetSourceRef;
  readonly colour: string; readonly wear: string;
}
export interface CastingItem {
  readonly item: string; readonly source: CastingAssetSourceRef;
  readonly carried: 'right-hand' | 'left-hand' | 'both-hands' | 'belt' | 'back' | 'neck' | 'workplace';
}
export interface CastingMotion {
  readonly id: string; readonly kind: CastingMotionKind; readonly description: string;
  readonly source: CastingMotionSourceRef;
  /** Required whenever the source needs creator approval. */
  readonly fallback: CastingMotionSourceRef | null;
  /** Registered place where a work loop happens; null for locomotion and idles. */
  readonly placeId: string | null;
  readonly footContact: 'planted' | 'cyclic-contacts' | 'seated';
  readonly blend: { readonly source: CastingMotionSourceRef; readonly weight: number } | null;
}
export interface CastingConsequenceVisual {
  readonly factId: string; readonly whenValue: boolean;
  /** own: the resident is a fact subject. known: shown only once the resident believes it. */
  readonly basis: 'own-fact' | 'known-fact';
  readonly persistence: 'while-fact-holds' | 'permanent-after-fact';
  readonly visuals: readonly string[];
  readonly motionChange: string | null;
  readonly expressionBias: string | null;
}
export interface CastingDecisionPresentation {
  readonly decisionId: string; readonly optionId: string; readonly presentation: string;
}
export interface CastingLodPlan {
  readonly id: CastingLodId; readonly triangles: number; readonly materials: number; readonly bones: number;
  readonly morphTargets: number; readonly maxTextureSize: number;
}
export interface HouseholdCastingProfile {
  readonly residentId: string;
  readonly ageBand: CastingAgeBand;
  readonly build: { readonly heightClass: 'short' | 'average' | 'tall'; readonly frame: 'slight' | 'lean' | 'medium' | 'broad'; readonly posture: string };
  readonly makehuman: CastingMakeHumanRecipe;
  readonly face: { readonly shape: string; readonly distinguishingFeatures: readonly string[]; readonly weathering: readonly string[]; readonly restingExpression: string };
  readonly hair: { readonly style: string; readonly colour: string; readonly facialHair: string | null; readonly brows: string; readonly construction: 'authored-hair-cards' };
  readonly silhouette: string;
  readonly clothing: readonly CastingClothingLayer[];
  readonly equipment: readonly CastingItem[];
  readonly possessions: readonly CastingItem[];
  readonly bannerPresentation: { readonly item: string; readonly beforeBannerConfirmed: string };
  readonly motion: readonly CastingMotion[];
  readonly facial: {
    readonly blinkIntervalSeconds: readonly [number, number];
    readonly gaze: string;
    readonly signatureExpressions: readonly { readonly name: string; readonly channels: readonly string[] }[];
  };
  readonly preferences: { readonly likes: readonly string[]; readonly dislikes: readonly string[] };
  readonly consequences: readonly CastingConsequenceVisual[];
  readonly decisionPresentations: readonly CastingDecisionPresentation[];
  readonly lods: readonly CastingLodPlan[];
}

export interface CastingLodBudget {
  readonly id: CastingLodId; readonly use: string; readonly facialTier: CastingFacialTier;
  readonly maxTriangles: number; readonly maxMaterials: number; readonly maxBones: number; readonly maxMorphTargets: number;
  readonly maxTextureSize: number;
  /** Uncompressed RGBA8 with mips for the planned map set; KTX2 cuts this roughly 4 to 8 times. */
  readonly textureMiBEstimate: number;
  /** Planned simultaneous residents at this level when 16 to 20 residents exist. */
  readonly maxSimultaneous: number;
}

/** Targets to refine with measured evidence. Probe measurement for reference:
 * an unclothed MakeHuman probe with system hair and teeth was 40,268 triangles,
 * 64 bones, 67 morph targets, 7 materials and about 99 MiB of uncompressed maps. */
export const HOUSEHOLD_LOD_BUDGETS: readonly CastingLodBudget[] = deepFreeze([
  { id: 'desktop-lod0', use: 'Conversation and close-up, within about 4 m.', facialTier: 'face-joints-and-morphs',
    maxTriangles: 25000, maxMaterials: 4, maxBones: 64, maxMorphTargets: 45, maxTextureSize: 2048, textureMiBEstimate: 70, maxSimultaneous: 2 },
  // Round 2: LOD1 and the Quest level carry the LOD0 face morphs on a head derived from the resident's own LOD0 head,
  // so blink, visemes and expressions read at these levels too (Quest parity with the desktop close-up).
  { id: 'desktop-lod1', use: 'Normal viewing distance, about 4 to 25 m.', facialTier: 'face-joints-and-morphs',
    maxTriangles: 8000, maxMaterials: 2, maxBones: 64, maxMorphTargets: 45, maxTextureSize: 1024, textureMiBEstimate: 11, maxSimultaneous: 8 },
  { id: 'quest-near', use: 'Quest residents within about 12 m, conversation distance included (the only built Quest level).', facialTier: 'face-joints-and-morphs',
    maxTriangles: 6000, maxMaterials: 2, maxBones: 64, maxMorphTargets: 45, maxTextureSize: 1024, textureMiBEstimate: 11, maxSimultaneous: 4 },
  { id: 'quest-miniature', use: 'Quest tabletop miniature view of the village.', facialTier: 'none',
    maxTriangles: 1500, maxMaterials: 1, maxBones: 64, maxMorphTargets: 0, maxTextureSize: 512, textureMiBEstimate: 1.4, maxSimultaneous: 20 },
  { id: 'far-impostor', use: 'Desktop far view and overview, beyond about 25 m.', facialTier: 'none',
    maxTriangles: 1500, maxMaterials: 1, maxBones: 64, maxMorphTargets: 0, maxTextureSize: 512, textureMiBEstimate: 1.4, maxSimultaneous: 20 },
] as const satisfies readonly CastingLodBudget[]);

const STANDARD_LODS: readonly CastingLodPlan[] = [
  { id: 'desktop-lod0', triangles: 24000, materials: 4, bones: 64, morphTargets: 45, maxTextureSize: 2048 },
  { id: 'desktop-lod1', triangles: 8000, materials: 2, bones: 64, morphTargets: 44, maxTextureSize: 1024 },
  { id: 'quest-near', triangles: 6000, materials: 2, bones: 64, morphTargets: 44, maxTextureSize: 1024 },
  { id: 'quest-miniature', triangles: 1500, materials: 1, bones: 64, morphTargets: 0, maxTextureSize: 512 },
  { id: 'far-impostor', triangles: 1500, materials: 1, bones: 64, morphTargets: 0, maxTextureSize: 512 },
];

/** How the registry's sensitivity reads on screen. Nobody knows the source. */
export const INFLUENCE_SENSITIVITY_PRESENTATION = deepFreeze({
  occasional: 'Rare brief pause: a glance up or aside with a slight brow raise, then back to the task. No gesture toward any source.',
  persistent: 'More frequent pauses: head turns, a held gaze into the middle distance, rubbing a forearm. Still no knowledge of any source.',
} as const);

const PROFILES: readonly HouseholdCastingProfile[] = [
  {
    residentId: SMITH,
    ageBand: 'middle-aged',
    build: { heightClass: 'average', frame: 'broad', posture: 'Upright, weight forward on the balls of the feet; heavy forearms held slightly away from the body.' },
    makehuman: {
      gender: 1, ageYears: 44, muscle: 0.84, weight: 0.66, height: 0.5, proportions: 0.55,
      macroShapeFamilies: { african: 0.05, asian: 0.1, caucasian: 0.85 },
      faceTargets: [
        { target: 'nose/nose-hump-incr', weight: 0.5 }, { target: 'chin/chin-width-incr', weight: 0.4 },
        { target: 'head/head-square', weight: 0.4 }, { target: 'eyebrows/eyebrows-trans-down', weight: 0.35 },
        { target: 'mouth/mouth-laugh-lines-in', weight: 0.3 },
      ],
      baseSkin: 'middleage_caucasian_male', eyeTexture: 'grey_eye.png',
    },
    face: {
      shape: 'Square jaw, heavy brow ridge and a nose broken once and set slightly crooked.',
      distinguishingFeatures: ['crooked nose bridge', 'forge squint lines at the outer eyes', 'small burn spots on the cheekbones'],
      weathering: ['heat-reddened cheeks and nose', 'soot in the pores and nail beds', 'dry cracked knuckles'],
      restingExpression: 'Concentrated, slightly narrowed eyes.',
    },
    hair: { style: 'Close-cropped dark hair receding at the temples.', colour: 'Dark brown with grey at the temples', facialHair: 'Short full beard, grey at the chin, singed shorter on one side.', brows: 'Thick straight brows.', construction: 'authored-hair-cards' },
    silhouette: 'Broad trapezoid with a long leather apron to the shins and rolled sleeves; reads as the smith from the overview.',
    clothing: [
      { slot: 'base', garment: 'Linen undershirt with a frayed open collar.', material: 'polyhaven:rough_linen', colour: 'Undyed, sweat-greyed', wear: 'Scorch pinholes on the sleeves.' },
      { slot: 'legs', garment: 'Wool trousers bound below the knee with wool leg wraps.', material: 'polyhaven:poly_wool_herringbone', colour: 'Brown', wear: 'Knees worn shiny.' },
      { slot: 'mid', garment: 'Short wool tunic with sleeves rolled above the elbow.', material: 'polyhaven:caban', colour: 'Dark green-brown', wear: 'Darned elbow.' },
      { slot: 'apron', garment: 'Heavy leather apron from chest to shin.', material: 'polyhaven:brown_leather', colour: 'Dark tan', wear: 'Cracked and scorched across the chest.' },
      { slot: 'belt', garment: 'Leather belt with a tool pouch.', material: 'polyhaven:brown_leather', colour: 'Dark brown', wear: 'Stretched holes.' },
      { slot: 'hands', garment: 'One leather glove on the tong hand.', material: 'polyhaven:fabric_leather_02', colour: 'Blackened', wear: 'Palm burned through and patched.' },
      { slot: 'feet', garment: 'Thick-soled leather turnshoes.', material: 'polyhaven:fabric_leather_02', colour: 'Brown', wear: 'Toe caps blackened.' },
    ],
    equipment: [
      { item: 'Cross-pein forging hammer.', source: 'polyhaven:cross_pein_hammer', carried: 'right-hand' },
      { item: 'Forge tongs.', source: 'project-original', carried: 'left-hand' },
      { item: 'Whetstone in the belt pouch.', source: 'project-original', carried: 'belt' },
    ],
    possessions: [
      { item: 'Iron ring on a cord, an early forge piece.', source: 'project-original', carried: 'neck' },
      { item: 'Water bucket for the well trip.', source: 'polyhaven:wooden_bucket_01', carried: 'right-hand' },
    ],
    bannerPresentation: { item: 'Leather tag dyed in the house colours on the apron strap.', beforeBannerConfirmed: 'Undyed leather tag.' },
    motion: [
      { id: 'smith-walk', kind: 'walk', description: 'Neutral walk with a slightly wider stance.', source: '100style:Neutral_FW', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: null },
      { id: 'smith-idle', kind: 'idle', description: 'Weight-shifting idle with forearms away from the body.', source: '100style:Neutral_ID', fallback: null, placeId: null, footContact: 'planted', blend: null },
      { id: 'smith-start-stop', kind: 'transition', description: 'Start and stop steps around the forge.', source: '100style:Neutral_TR1', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: null },
      { id: 'smith-hammering', kind: 'work', description: 'Hammer strikes on the anvil with tongs holding the work; strike contacts aligned to the anvil face.', source: 'cmu:62_07', fallback: 'project-original:keyframe', placeId: 'smithy-forge', footContact: 'planted', blend: null },
      { id: 'smith-carry-water', kind: 'work', description: 'Carries a full bucket from the well with a counterbalancing lean.', source: 'cmu:70_03', fallback: 'project-original:keyframe', placeId: 'village-well', footContact: 'cyclic-contacts', blend: null },
    ],
    facial: {
      blinkIntervalSeconds: [2.5, 6],
      gaze: 'Holds the work with a steady gaze; looks up to people only when addressed.',
      signatureExpressions: [
        { name: 'anvil squint', channels: ['eyeSquintLeft', 'eyeSquintRight', 'browDownLeft', 'browDownRight'] },
        { name: 'rare broad smile with the child', channels: ['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight'] },
      ],
    },
    preferences: { likes: ['a clean ringing strike', 'the evening hearth', 'well-kept tools'], dislikes: ['hurried work', 'being watched while welding', 'wet charcoal'] },
    consequences: [
      { factId: 'smithy-smith-forearm-burned', whenValue: true, basis: 'own-fact', persistence: 'while-fact-holds',
        visuals: ['linen bandage on the left forearm', 'glove left off'], motionChange: 'Guarded hammering variant: lighter strikes, left arm held closer.', expressionBias: 'Brief wince on heavy strikes.' },
      { factId: 'smithy-smith-forearm-scarred', whenValue: true, basis: 'own-fact', persistence: 'permanent-after-fact',
        visuals: ['pale burn scar on the left forearm', 'left sleeve no longer rolled'], motionChange: null, expressionBias: null },
      { factId: 'smithy-smith-elder-quarrel', whenValue: true, basis: 'own-fact', persistence: 'while-fact-holds',
        visuals: ['works with back turned to the doorway'], motionChange: 'Arms-folded idle at the forge door when the elder is present.', expressionBias: 'Pressed mouth and lowered brows at low intensity.' },
    ],
    decisionPresentations: [
      { decisionId: 'ealdholt-smith-admitted-error', optionId: 'shared-correction', presentation: 'After a flawed piece, works the correction side by side with the child at the anvil.' },
      { decisionId: 'ealdholt-smith-admitted-error', optionId: 'explanation-first', presentation: 'After a flawed piece, sets the hammer down and listens before working again.' },
    ],
    lods: STANDARD_LODS,
  },
  {
    residentId: SPINNER,
    ageBand: 'adult',
    build: { heightClass: 'tall', frame: 'lean', posture: 'Long-backed and upright; hands rarely still.' },
    makehuman: {
      gender: 0, ageYears: 38, muscle: 0.52, weight: 0.4, height: 0.55, proportions: 0.6,
      macroShapeFamilies: { african: 0.1, asian: 0.05, caucasian: 0.85 },
      faceTargets: [
        { target: 'cheek/l-cheek-bones-incr', weight: 0.4 }, { target: 'cheek/r-cheek-bones-incr', weight: 0.4 },
        { target: 'nose/nose-scale-vert-incr', weight: 0.35 }, { target: 'head/head-oval', weight: 0.4 },
        { target: 'eyebrows/eyebrows-angle-up', weight: 0.2 },
      ],
      baseSkin: 'middleage_caucasian_female', eyeTexture: 'brownlight_eye.png',
    },
    face: {
      shape: 'Long oval face with high cheekbones and a long straight nose.',
      distinguishingFeatures: ['dense freckles across nose and cheeks', 'one front tooth slightly overlapping', 'appraising raised brow'],
      weathering: ['wind-chapped lips', 'dye-stained fingertips', 'faint squint lines'],
      restingExpression: 'Alert, faintly amused.',
    },
    hair: { style: 'Long braid wrapped and pinned under a linen head-cloth, loose strands at the temples.', colour: 'Auburn brown', facialHair: null, brows: 'Straight, strong, slightly lighter than the hair.', construction: 'authored-hair-cards' },
    silhouette: 'Tall narrow column in a long overdress with a shawl and a head-cloth; basket on the hip.',
    clothing: [
      { slot: 'base', garment: 'Linen underdress to the ankle.', material: 'polyhaven:rough_linen', colour: 'Off-white', wear: 'Hem stained at the riverbank.' },
      { slot: 'mid', garment: 'Wool overdress with elbow-length sleeves.', material: 'polyhaven:caban', colour: 'Faded madder red', wear: 'Patched elbows; colour faded along the seams.' },
      { slot: 'outer', garment: 'Wool shawl knotted at the chest.', material: 'polyhaven:poly_wool_herringbone', colour: 'Undyed grey', wear: 'Snagged fringe.' },
      { slot: 'apron', garment: 'Linen work apron.', material: 'polyhaven:rough_linen', colour: 'Natural', wear: 'Blotched blue and red dye stains.' },
      { slot: 'head', garment: 'Linen head-cloth tied at the nape.', material: 'polyhaven:rough_linen', colour: 'Natural', wear: 'Softened and slightly yellowed.' },
      { slot: 'belt', garment: 'Narrow woven band belt with knife and keys.', material: 'project-original', colour: 'Woad blue and natural', wear: 'Frayed tail.' },
      { slot: 'feet', garment: 'Leather turnshoes.', material: 'polyhaven:fabric_leather_02', colour: 'Brown', wear: 'Damp-darkened soles.' },
    ],
    equipment: [
      { item: 'Drop spindle with a stone whorl.', source: 'project-original', carried: 'right-hand' },
      { item: 'Wool basket.', source: 'polyhaven:wicker_basket_01', carried: 'left-hand' },
      { item: 'Rinsing bucket at the riverbank.', source: 'polyhaven:wooden_bucket_01', carried: 'workplace' },
    ],
    possessions: [
      { item: 'Small knife and household keys on the belt.', source: 'project-original', carried: 'belt' },
      { item: 'Skeins of dyed yarn tucked in the apron.', source: 'project-original', carried: 'belt' },
    ],
    bannerPresentation: { item: 'Narrow woven band in the house colours at the belt.', beforeBannerConfirmed: 'Band in undyed natural wool.' },
    motion: [
      { id: 'spinner-walk', kind: 'walk', description: 'Upright long-backed walk with a narrower step.', source: '100style:Proud_FW', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: { source: '100style:Neutral_FW', weight: 0.5 } },
      { id: 'spinner-idle', kind: 'idle', description: 'Upright standing idle with weight shifts.', source: '100style:Proud_ID', fallback: null, placeId: null, footContact: 'planted', blend: null },
      { id: 'spinner-start-stop', kind: 'transition', description: 'Start and stop steps at the doorway.', source: '100style:Proud_ID', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: null },
      { id: 'spinner-drop-spindle', kind: 'work', description: 'Standing drop-spindle loop: twist, draft and wind with the spindle swinging free.', source: 'project-original:keyframe', fallback: null, placeId: 'smithy-house', footContact: 'planted', blend: null },
      { id: 'spinner-rinse-wool', kind: 'work', description: 'Kneeling at the bank, lifting and wringing wool over the bucket.', source: 'project-original:keyframe', fallback: null, placeId: 'riverside-bank', footContact: 'planted', blend: null },
    ],
    facial: {
      blinkIntervalSeconds: [2.5, 6],
      gaze: 'Checks colours and faces alike with quick appraising glances.',
      signatureExpressions: [
        { name: 'appraising look', channels: ['browInnerUp', 'eyeSquintLeft', 'eyeSquintRight'] },
        { name: 'amused half smile', channels: ['mouthSmileLeft', 'cheekSquintLeft'] },
      ],
    },
    preferences: { likes: ['a clean bright dye batch', 'the river at midday', 'news from the courtyard'], dislikes: ['muddy fleece', 'wasted thread', 'forge smoke in drying wool'] },
    consequences: [
      { factId: 'smithy-house-colours-dyed', whenValue: true, basis: 'own-fact', persistence: 'permanent-after-fact',
        visuals: ['fingertips and nail beds stained in the house colours', 'a band in the house colours stitched to the apron'], motionChange: null, expressionBias: 'More frequent satisfied half smile while spinning.' },
      { factId: 'smithy-smith-forearm-burned', whenValue: true, basis: 'known-fact', persistence: 'while-fact-holds',
        visuals: ['carries clean linen strips in the apron'], motionChange: 'Glances toward the forge between spindle loops.', expressionBias: 'Worried brow at low intensity.' },
    ],
    decisionPresentations: [],
    lods: STANDARD_LODS,
  },
  {
    residentId: CHILD,
    ageBand: 'child',
    build: { heightClass: 'short', frame: 'slight', posture: 'Restless; never stands square, always half turned toward the next thing.' },
    makehuman: {
      gender: 0, ageYears: 10, muscle: 0.45, weight: 0.45, height: 0.66, proportions: 0.5,
      macroShapeFamilies: { african: 0.08, asian: 0.07, caucasian: 0.85 },
      faceTargets: [
        { target: 'head/head-round', weight: 0.4 }, { target: 'nose/nose-point-up', weight: 0.35 },
        { target: 'mouth/mouth-scale-horiz-incr', weight: 0.2 }, { target: 'chin/chin-width-decr', weight: 0.2 },
      ],
      baseSkin: 'young_caucasian_female', eyeTexture: 'bluegreen_eye.png',
    },
    face: {
      shape: 'Round face with an upturned nose and a wide mouth.',
      distinguishingFeatures: ['missing milk tooth at the side', 'sun freckles', 'scraped chin healing'],
      weathering: ['grubby cheeks', 'soot smudge on the forehead after forge work', 'chapped hands'],
      restingExpression: 'Curious, mouth slightly open.',
    },
    hair: { style: 'Tousled jaw-length hair tied back with a ribbon, strands escaping.', colour: 'Sandy blond', facialHair: null, brows: 'Fine pale brows.', construction: 'authored-hair-cards' },
    silhouette: 'Small figure in an oversized tunic and sheepskin vest with a bucket or kindling bundle; child proportions, not a scaled adult.',
    clothing: [
      { slot: 'base', garment: 'Linen shirt.', material: 'polyhaven:rough_linen', colour: 'Natural', wear: 'Grass stains.' },
      { slot: 'legs', garment: 'Wool leggings.', material: 'polyhaven:poly_wool_herringbone', colour: 'Brown', wear: 'Mud at the knees.' },
      { slot: 'mid', garment: 'Oversized wool tunic cut down from an adult one, re-hemmed.', material: 'polyhaven:caban', colour: 'Faded green', wear: 'Uneven hem; patched hole at the side.' },
      { slot: 'outer', garment: 'Sheepskin vest worn fleece in.', material: 'polyhaven:curly_teddy_natural', colour: 'Natural fleece, tan leather side', wear: 'Matted edges.' },
      { slot: 'belt', garment: 'Cord belt with a small pouch.', material: 'polyhaven:hessian_230', colour: 'Natural', wear: 'Knotted where it broke.' },
      { slot: 'feet', garment: 'Soft leather shoes.', material: 'polyhaven:fabric_leather_02', colour: 'Brown', wear: 'Scuffed toes.' },
    ],
    equipment: [
      { item: 'Small water bucket.', source: 'polyhaven:wooden_bucket_01', carried: 'right-hand' },
      { item: 'Kindling bundle tied with cord.', source: 'project-original', carried: 'back' },
    ],
    possessions: [
      { item: 'Wooden whistle the elder carved.', source: 'project-original', carried: 'neck' },
      { item: 'Pocket stones from the pond.', source: 'project-original', carried: 'belt' },
    ],
    bannerPresentation: { item: 'Hair ribbon in the house colours.', beforeBannerConfirmed: 'Undyed linen ribbon.' },
    motion: [
      { id: 'child-walk', kind: 'walk', description: 'Neutral walk retargeted to child proportions, springier and with a quicker cadence.', source: '100style:Neutral_FW', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: { source: '100style:Elated_FW', weight: 0.4 } },
      { id: 'child-idle', kind: 'idle', description: 'Fidgeting idle, weight swapping foot to foot.', source: '100style:Neutral_ID', fallback: null, placeId: null, footContact: 'planted', blend: null },
      { id: 'child-start-stop', kind: 'transition', description: 'Quick starts and stops.', source: '100style:Neutral_ID', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: null },
      { id: 'child-bellows', kind: 'work', description: 'Two-handed bellows pumping with the whole body leaning in.', source: 'project-original:keyframe', fallback: null, placeId: 'smithy-forge', footContact: 'planted', blend: null },
      { id: 'child-gather-kindling', kind: 'work', description: 'Crouch, pick up sticks, stand, add to the bundle.', source: 'project-original:keyframe', fallback: null, placeId: 'woodland-edge', footContact: 'planted', blend: null },
      { id: 'child-carry-water', kind: 'work', description: 'Carries a small bucket two-handed with a sideways lean.', source: 'cmu:70_01', fallback: 'project-original:keyframe', placeId: 'village-well', footContact: 'cyclic-contacts', blend: null },
    ],
    facial: {
      blinkIntervalSeconds: [3, 7],
      gaze: 'Darting gaze; tracks movement, animals and adults\' hands.',
      signatureExpressions: [
        { name: 'wide-eyed curiosity', channels: ['eyeWideLeft', 'eyeWideRight', 'browOuterUpLeft', 'browOuterUpRight'] },
        { name: 'pout when sent away', channels: ['mouthPucker', 'browDownLeft', 'browDownRight'] },
      ],
    },
    preferences: { likes: ['the pond', 'sparks from the forge', 'the elder\'s stories'], dislikes: ['sitting at the spindle', 'being sent away from the anvil', 'cold well water'] },
    consequences: [
      { factId: 'smithy-child-trusted-at-bellows', whenValue: true, basis: 'own-fact', persistence: 'permanent-after-fact',
        visuals: ['cut-down leather apron from an old apron of the smith', 'soot on the forearms'], motionChange: 'Bellows loop gains a steady two-handed rhythm instead of uneven pumping.', expressionBias: 'Proud upright posture at the forge.' },
      { factId: 'smithy-elder-hand-injured', whenValue: true, basis: 'known-fact', persistence: 'while-fact-holds',
        visuals: ['carries the elder\'s basket'], motionChange: 'Matches the elder\'s walking pace on shared walks.', expressionBias: 'Subdued, fewer wide-eyed looks.' },
    ],
    decisionPresentations: [],
    lods: STANDARD_LODS,
  },
  {
    residentId: ELDER,
    ageBand: 'elder',
    build: { heightClass: 'short', frame: 'lean', posture: 'Stooped from the upper back; leans on a stick in the left hand.' },
    makehuman: {
      gender: 0, ageYears: 71, muscle: 0.3, weight: 0.42, height: 0.42, proportions: 0.4,
      macroShapeFamilies: { african: 0.05, asian: 0.1, caucasian: 0.85 },
      faceTargets: [
        { target: 'nose/nose-hump-incr', weight: 0.65 }, { target: 'nose/nose-point-down', weight: 0.55 },
        { target: 'mouth/mouth-upperlip-volume-decr', weight: 0.75 }, { target: 'head/head-invertedtriangular', weight: 0.35 },
        { target: 'head/head-fat-decr', weight: 0.5 }, { target: 'chin/chin-bones-decr', weight: 0.4 },
        { target: 'eyes/l-eye-eyefold-down', weight: 0.5 }, { target: 'eyes/r-eye-eyefold-down', weight: 0.5 },
      ],
      baseSkin: 'old_caucasian_female', eyeTexture: 'brownlight_eye.png',
    },
    face: {
      shape: 'Narrow triangular face with hooded eyes, thin lips and a hooked nose.',
      distinguishingFeatures: ['deep vertical frown lines', 'small scar through the left brow', 'knuckles swollen at the joints'],
      weathering: ['deep wrinkles and age spots', 'wind-reddened nose tip', 'wood shavings caught in the shawl'],
      restingExpression: 'Skeptical, mouth pressed.',
    },
    hair: { style: 'White hair in a low bun under a linen head-cloth and hood.', colour: 'White with yellowed ends', facialHair: null, brows: 'Sparse white brows.', construction: 'authored-hair-cards' },
    silhouette: 'Small stooped figure in a long hooded cloak with a walking stick; reads at distance by the stick and the hood.',
    clothing: [
      { slot: 'base', garment: 'Linen shift.', material: 'polyhaven:rough_linen', colour: 'Natural', wear: 'Soft and thin with age.' },
      { slot: 'mid', garment: 'Long wool kirtle.', material: 'polyhaven:poly_wool_herringbone', colour: 'Faded dark blue', wear: 'Mended hem.' },
      { slot: 'outer', garment: 'Heavy hooded wool cloak with a bone toggle.', material: 'polyhaven:caban', colour: 'Dark brown', wear: 'Shiny where the stick rubs; hem resewn.' },
      { slot: 'head', garment: 'Linen head-cloth under the hood.', material: 'polyhaven:rough_linen', colour: 'Natural', wear: 'Yellowed.' },
      { slot: 'hands', garment: 'Fingerless wool mitts.', material: 'project-original', colour: 'Grey', wear: 'Darned thumbs.' },
      { slot: 'feet', garment: 'Leather shoes with wool wraps.', material: 'polyhaven:fabric_leather_02', colour: 'Brown', wear: 'Cracked uppers.' },
    ],
    equipment: [
      { item: 'Walking stick.', source: 'project-original', carried: 'left-hand' },
      { item: 'Whittling knife.', source: 'project-original', carried: 'right-hand' },
      { item: 'Mallet for mending tool handles.', source: 'polyhaven:wooden_hammer_01', carried: 'workplace' },
      { item: 'Carving stool at the doorstep.', source: 'polyhaven:wooden_stool_01', carried: 'workplace' },
    ],
    possessions: [
      { item: 'Half-carved wooden spoon.', source: 'polyhaven:wooden_spoon', carried: 'right-hand' },
      { item: 'Finished wooden bowl kept for trade.', source: 'polyhaven:wooden_bowl_01', carried: 'workplace' },
    ],
    bannerPresentation: { item: 'Edging in the house colours on the cloak hood.', beforeBannerConfirmed: 'Undyed hood edging.' },
    motion: [
      { id: 'elder-walk', kind: 'walk', description: 'Stick walk, moderated toward neutral; the stick plants with the right foot.', source: '100style:WalkingStickLeft_FW', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: { source: '100style:Neutral_FW', weight: 0.35 } },
      { id: 'elder-idle', kind: 'idle', description: 'Stooped standing idle, leaning on the stick in the left hand, the cloak swept back on that side.', source: '100style:WalkingStickLeft_ID', fallback: null, placeId: null, footContact: 'planted', blend: null },
      { id: 'elder-start-stop', kind: 'transition', description: 'Careful start and stop with the stick.', source: '100style:WalkingStickLeft_ID', fallback: null, placeId: null, footContact: 'cyclic-contacts', blend: null },
      { id: 'elder-carving', kind: 'work', description: 'Seated whittling loop: brace, cut away from the body, turn the spoon, blow off shavings.', source: 'project-original:keyframe', fallback: null, placeId: 'smithy-house', footContact: 'seated', blend: null },
      { id: 'elder-sit-down', kind: 'sit', description: 'Lowers onto the stool using the stick.', source: 'project-original:keyframe', fallback: null, placeId: null, footContact: 'seated', blend: null },
    ],
    facial: {
      blinkIntervalSeconds: [2, 5],
      gaze: 'Long looks from under the hood; side glances at whoever is talking.',
      signatureExpressions: [
        { name: 'skeptical side glance', channels: ['eyeLookOutLeft', 'eyeLookInRight', 'mouthPressLeft', 'mouthPressRight'] },
        { name: 'warm crinkled smile', channels: ['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight', 'eyeSquintLeft', 'eyeSquintRight'] },
      ],
    },
    preferences: { likes: ['dry birch for carving', 'the churchyard walk', 'a quiet doorstep'], dislikes: ['damp mornings', 'being helped unasked', 'hurried welds'] },
    consequences: [
      { factId: 'smithy-elder-hand-injured', whenValue: true, basis: 'own-fact', persistence: 'while-fact-holds',
        visuals: ['left hand bound in a linen sling', 'carving put aside', 'stick moved to the right hand'], motionChange: 'Mirrored stick walk; carving loop replaced by a seated rest.', expressionBias: 'Tight mouth when moving.' },
      { factId: 'smithy-smith-elder-quarrel', whenValue: true, basis: 'own-fact', persistence: 'while-fact-holds',
        visuals: ['sits with the shoulder turned from the forge'], motionChange: 'Skips the forge visit; stays at the well longer.', expressionBias: 'Pressed mouth and averted gaze toward the smith.' },
    ],
    decisionPresentations: [],
    lods: STANDARD_LODS,
  },
];

export interface ExternalRelationshipProposal {
  readonly residentId: string; readonly compatibilityPersonId: string; readonly description: string;
  readonly status: 'proposal-not-registered';
}

/** Ties to the existing role-labelled cast. Not part of the validated registry
 * until those residents are authored with homes, families and routines. */
const EXTERNAL_RELATIONSHIPS: readonly ExternalRelationshipProposal[] = [
  { residentId: SMITH, compatibilityPersonId: 'ealdholt-house-steward', description: 'Repairs the hall\'s ironwork and argues over the price.', status: 'proposal-not-registered' },
  { residentId: SPINNER, compatibilityPersonId: 'ealdholt-house-messenger', description: 'Sends dyed bands and news out with the messenger.', status: 'proposal-not-registered' },
  { residentId: CHILD, compatibilityPersonId: 'ealdholt-house-messenger', description: 'Follows the messenger to the edge of the village and asks about the road.', status: 'proposal-not-registered' },
];

export interface HouseholdCasting {
  readonly status: typeof HOUSEHOLD_CASTING_STATUS;
  readonly verifiedOn: typeof HOUSEHOLD_CASTING_VERIFIED_ON;
  /** Nothing here reads or writes house standing; only My Legacy chess does. */
  readonly houseStandingEffect: 'none';
  readonly registry: PeopleLifeRegistry;
  readonly eventModel: PeopleLifeEventModel;
  readonly profiles: readonly HouseholdCastingProfile[];
  readonly externalRelationships: readonly ExternalRelationshipProposal[];
}

export const EALDHOLT_HOUSEHOLD_CASTING: HouseholdCasting = deepFreeze({
  status: HOUSEHOLD_CASTING_STATUS,
  verifiedOn: HOUSEHOLD_CASTING_VERIFIED_ON,
  houseStandingEffect: 'none',
  registry: REGISTRY,
  eventModel: EVENT_MODEL,
  profiles: PROFILES,
  externalRelationships: EXTERNAL_RELATIONSHIPS,
});

export function getHouseholdCastingProfile(casting: HouseholdCasting, residentId: string): HouseholdCastingProfile | null {
  for (const profile of casting.profiles) if (profile.residentId === residentId) return profile;
  return null;
}

// ------------------------------------------------------------------ validation

const AGE_BANDS: Readonly<Record<CastingAgeBand, readonly [number, number]>> = { child: [4, 15], adult: [16, 39], 'middle-aged': [40, 59], elder: [60, 100] };
const REQUIRED_MOTION_KINDS: readonly CastingMotionKind[] = ['walk', 'idle', 'work'];
/** The creator-confirmed continuing cast are ordinary villagers; if one joins a
 * household they keep the saved-content ID so inherited decisions still read. */
const CONTINUING_ROLE_IDS: Readonly<Record<string, string>> = {
  'village-smith': 'ealdholt-village-smith', 'house-steward': 'ealdholt-house-steward', 'house-messenger': 'ealdholt-house-messenger',
};
const ARKIT_CHANNELS: readonly string[] = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft',
  'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower',
  'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.trim() === v && v.length <= 400;
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Words that start with a capital letter anywhere except a sentence start are
 * treated as proper names; resident-facing text must use role labels only. */
function properNameIn(text: string): string | null {
  for (const sentence of text.split(/[.!?]\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (let i = 1; i < words.length; i++) {
      const word = words[i].replace(/^[("']+/, '');
      if (/^[A-Z]/.test(word)) return word;
    }
  }
  return null;
}

function residentTexts(registry: PeopleLifeRegistry): string[] {
  const out: string[] = [];
  for (const p of registry.places) out.push(p.label);
  for (const h of registry.households) out.push(h.label);
  for (const r of registry.residents) {
    out.push(r.label, r.identityNote, r.role.label, r.role.purpose);
    if (r.family.kind === 'local-kin') for (const t of r.family.ties) out.push(t.description); else out.push(r.family.explanation);
    for (const t of r.socialTies) out.push(t.description);
    for (const s of r.routine) out.push(s.activity);
  }
  return out;
}

function profileTexts(p: HouseholdCastingProfile): string[] {
  const out = [p.build.posture, p.face.shape, p.face.restingExpression, ...p.face.distinguishingFeatures, ...p.face.weathering,
    p.hair.style, p.hair.colour, p.hair.brows, p.silhouette, p.bannerPresentation.item, p.bannerPresentation.beforeBannerConfirmed,
    p.facial.gaze, ...p.preferences.likes, ...p.preferences.dislikes];
  if (p.hair.facialHair) out.push(p.hair.facialHair);
  for (const c of p.clothing) out.push(c.garment, c.colour, c.wear);
  for (const i of [...p.equipment, ...p.possessions]) out.push(i.item);
  for (const m of p.motion) out.push(m.description);
  for (const c of p.consequences) { out.push(...c.visuals); if (c.motionChange) out.push(c.motionChange); if (c.expressionBias) out.push(c.expressionBias); }
  for (const d of p.decisionPresentations) out.push(d.presentation);
  return out;
}

function sourceRefProblem(ref: string): string | null {
  const tokens = ref.toLowerCase().split(/[:/._]+/);
  for (const banned of HOUSEHOLD_CASTING_FORBIDDEN_SOURCES) if (tokens.indexOf(banned) >= 0) return `Forbidden source reference ${ref}.`;
  if (ref === 'project-original' || ref === 'project-original:keyframe') return null;
  const colon = ref.indexOf(':');
  const prefix = colon < 0 ? ref : ref.slice(0, colon), rest = colon < 0 ? '' : ref.slice(colon + 1);
  if (prefix === 'polyhaven') return HOUSEHOLD_CASTING_POLYHAVEN.some(a => a.id === rest) ? null : `Unlisted Poly Haven asset ${rest}.`;
  if (prefix === '100style') return /^[A-Za-z]+_(FW|BW|SW|FR|BR|SR|ID|TR1|TR2|TR3)$/.test(rest) ? null : `Unknown 100STYLE clip ${rest}.`;
  if (prefix === 'cmu') return /^\d{2,3}_\d{2}$/.test(rest) ? null : `Unknown CMU trial ${rest}.`;
  if (prefix === 'makehuman-system-assets') return rest ? null : 'Name the system asset.';
  return `Unregistered source ${ref}.`;
}

function sourceFor(ref: string): CastingSource | null {
  const prefix = ref.indexOf(':') < 0 ? ref : ref.slice(0, ref.indexOf(':'));
  const id = prefix === 'cmu' ? 'cmu-mocap' : prefix;
  for (const s of HOUSEHOLD_CASTING_SOURCES) if (s.id === id) return s;
  return null;
}

/** Validates the complete casting proposal. Returns null or the first problem. */
export function validateHouseholdCasting(value: HouseholdCasting): string | null {
  if (value.status !== HOUSEHOLD_CASTING_STATUS) return 'Casting must stay marked working-placeholder.';
  if (value.houseStandingEffect !== 'none') return 'Casting cannot affect house standing; only My Legacy chess matches do.';
  const registryProblem = validatePeopleLifeRegistry(value.registry);
  if (registryProblem) return `Registry: ${registryProblem}`;
  const { registry } = value;
  if (registry.households.length !== 1) return 'Prove exactly one connected household before expanding.';
  const members = registry.households[0].memberIds;
  if (members.length < HOUSEHOLD_CASTING_MEMBER_RANGE.min || members.length > HOUSEHOLD_CASTING_MEMBER_RANGE.max) return 'The first household needs three to five members.';
  for (const r of registry.residents) if (r.family.kind !== 'local-kin') return 'Every member of the proof household needs explicit local family ties.';
  const events = createPeopleLifeEventsSnapshot(registry, value.eventModel, { startedAt: 0, stepMilliseconds: 60000, seed: 1 });
  if (events.ok === false) return `Event model: ${events.error}`;
  for (const fact of value.eventModel.facts) if (/standing|chess|wager/i.test(fact.id)) return 'Consequence facts cannot carry house standing or chess outcomes.';

  for (const text of residentTexts(registry)) {
    const name = properNameIn(text);
    if (name) return `Resident text must use role labels only (found ${name}).`;
    if (/\b(player|avatar)\b/i.test(text)) return 'Residents have no knowledge of the unseen player and there is no avatar.';
  }
  const compat = new Set(PEOPLE_LIFE_COMPATIBILITY_PERSON_IDS);
  const draftIds = new Set<string>(EALDHOLT_PEOPLE_DRAFT.map(p => p.id));
  for (const r of registry.residents) {
    const expected = CONTINUING_ROLE_IDS[r.role.id];
    if (expected !== undefined && r.id !== expected) return 'Continuing cast roles keep their existing compatibility IDs.';
  }

  const profiles = value.profiles;
  if (profiles.length !== registry.residents.length) return 'Every resident needs exactly one art profile.';
  const seenProfiles = new Set<string>();
  const faceKeys = new Set<string>(), hairKeys = new Set<string>(), silhouettes = new Set<string>();
  for (const p of profiles) {
    const resident = registry.residents.find(r => r.id === p.residentId);
    if (!resident || seenProfiles.has(p.residentId)) return 'Art profiles must match registered residents one to one.';
    seenProfiles.add(p.residentId);
    for (const text of profileTexts(p)) {
      if (!isText(text)) return `Profile ${p.residentId} has empty or untrimmed text.`;
      const name = properNameIn(text);
      if (name) return `Profile ${p.residentId} must not use proper names (found ${name}).`;
      if (/\b(player|avatar)\b/i.test(text)) return 'Profiles cannot reference the unseen player or an avatar.';
    }
    const band = AGE_BANDS[p.ageBand];
    const mh = p.makehuman;
    if (!band || !(mh.ageYears >= band[0] && mh.ageYears <= band[1])) return `Profile ${p.residentId} age does not match its age band.`;
    if (![mh.gender, mh.muscle, mh.weight, mh.height, mh.proportions].every(unit)) return `Profile ${p.residentId} MakeHuman sliders must be within 0..1.`;
    const fam = mh.macroShapeFamilies;
    if (![fam.african, fam.asian, fam.caucasian].every(unit) || Math.abs(fam.african + fam.asian + fam.caucasian - 1) > 1e-6) return `Profile ${p.residentId} shape families must sum to 1.`;
    if (mh.faceTargets.length < 3 || mh.faceTargets.some(t => !/^[a-z]+\/[a-z0-9-]+$/.test(t.target) || !unit(t.weight) || t.weight === 0)) return `Profile ${p.residentId} needs at least three weighted CC0 face targets.`;
    const faceKey = mh.faceTargets.map(t => t.target).sort().join('|');
    if (faceKeys.has(faceKey)) return 'Faces must be individual, not repeated target sets.';
    faceKeys.add(faceKey);
    const hairKey = p.hair.style + '|' + p.hair.colour;
    if (hairKeys.has(hairKey) || silhouettes.has(p.silhouette)) return 'Hair and silhouettes must differ between residents.';
    hairKeys.add(hairKey); silhouettes.add(p.silhouette);
    if (p.face.distinguishingFeatures.length < 2 || p.face.weathering.length < 2) return `Profile ${p.residentId} needs distinguishing features and wear.`;

    const slots = new Set(p.clothing.map(c => c.slot));
    if (p.clothing.length < 4 || !slots.has('base') || !slots.has('feet') || !(slots.has('mid') || slots.has('outer'))) return `Profile ${p.residentId} needs layered clothing with base, mid or outer, and footwear.`;
    if (!p.equipment.length || !p.possessions.length) return `Profile ${p.residentId} needs role equipment and personal possessions.`;
    for (const ref of [...p.clothing.map(c => c.material), ...p.equipment.map(i => i.source), ...p.possessions.map(i => i.source)]) {
      const problem = sourceRefProblem(ref);
      if (problem) return problem;
    }

    const kinds = new Set(p.motion.map(m => m.kind));
    for (const kind of REQUIRED_MOTION_KINDS) if (!kinds.has(kind)) return `Profile ${p.residentId} needs ${kind} motion.`;
    const motionIds = new Set<string>();
    for (const m of p.motion) {
      if (motionIds.has(m.id)) return 'Motion IDs must be unique per resident.';
      motionIds.add(m.id);
      for (const ref of [m.source, m.fallback, m.blend ? m.blend.source : null]) {
        if (ref === null) continue;
        const problem = sourceRefProblem(ref);
        if (problem) return problem;
      }
      const source = sourceFor(m.source);
      if (!source) return `Motion ${m.id} has no registered source.`;
      if (source.redistribution === 'conditional-creator-approval' && (m.fallback === null || sourceFor(m.fallback)?.redistribution === 'conditional-creator-approval')) return `Motion ${m.id} needs an unconditional fallback until the creator approves its source.`;
      if (m.blend && !(m.blend.weight > 0 && m.blend.weight < 1)) return `Motion ${m.id} blend weight must be between 0 and 1.`;
      if (m.kind === 'work') {
        if (/\b(talk|idle)\b/i.test(m.id + ' ' + m.source) || /_(ID)$/.test(m.source)) return 'Talking or idle clips cannot stand in for work loops.';
        if (!m.placeId || !resident.routine.some(s => s.placeId === m.placeId)) return `Work loop ${m.id} must happen at a place in the resident's routine.`;
      } else if (m.kind === 'walk' && /_(ID)$/.test(m.source)) return 'An idle clip cannot stand in for walking.';
    }

    const [blinkMin, blinkMax] = p.facial.blinkIntervalSeconds;
    if (!(blinkMin > 0.5 && blinkMax > blinkMin && blinkMax <= 12)) return `Profile ${p.residentId} needs a plausible blink interval.`;
    if (p.facial.signatureExpressions.length < 2 || p.facial.signatureExpressions.some(e => !e.channels.length || e.channels.some(c => ARKIT_CHANNELS.indexOf(c) < 0))) return `Profile ${p.residentId} expressions must use known ARKit channels.`;
    if (p.preferences.likes.length < 2 || p.preferences.dislikes.length < 2) return `Profile ${p.residentId} needs preferences.`;

    for (const c of p.consequences) {
      const fact = value.eventModel.facts.find(f => f.id === c.factId);
      if (!fact) return `Consequence ${c.factId} is not a proposed fact.`;
      if (c.basis === 'own-fact' && fact.subjectIds.indexOf(p.residentId) < 0) return `Own-fact consequence ${c.factId} must name ${p.residentId} as a subject.`;
      if (!c.visuals.length) return 'Every lasting consequence needs a visible change.';
    }
    if (!value.eventModel.facts.some(f => f.subjectIds.indexOf(p.residentId) >= 0)) return `Profile ${p.residentId} needs at least one lasting consequence of their own.`;
    for (const d of p.decisionPresentations) {
      const person = EALDHOLT_PEOPLE_DRAFT.find(x => x.id === p.residentId);
      if (!person || !draftIds.has(p.residentId) || person.decision.id !== d.decisionId || !person.decision.options.some(o => o.id === d.optionId)) return 'Decision presentations must read an existing inherited decision of that resident.';
    }

    for (const lod of p.lods) {
      const budget = HOUSEHOLD_LOD_BUDGETS.find(b => b.id === lod.id);
      if (!budget) return `Unknown LOD ${lod.id}.`;
      if (lod.triangles > budget.maxTriangles || lod.materials > budget.maxMaterials || lod.bones > budget.maxBones
        || lod.morphTargets > budget.maxMorphTargets || lod.maxTextureSize > budget.maxTextureSize) return `Profile ${p.residentId} exceeds the ${lod.id} budget.`;
    }
    if (!p.lods.some(l => l.id === 'desktop-lod0') || !p.lods.some(l => l.id === 'quest-near')) return `Profile ${p.residentId} needs desktop close-up and Quest levels.`;
  }

  for (const rel of value.externalRelationships) {
    if (!registry.residents.some(r => r.id === rel.residentId)) return 'External relationship proposals must start from a household member.';
    if (!compat.has(rel.compatibilityPersonId) || registry.residents.some(r => r.id === rel.compatibilityPersonId)) return 'External proposals may only name unregistered existing cast IDs.';
    if (rel.status !== 'proposal-not-registered' || !isText(rel.description)) return 'External relationships stay explicit unregistered proposals.';
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
