/**
 * Ealdholt household art sets: the published resident files and the stable names Codex's actor owner
 * needs to bind them (see docs/legacy/claude-integration/characters/characters-README.md).
 *
 * WORKING PLACEHOLDER: role labels only, no names, lore or private canon. Nothing here spawns,
 * saves or simulates anything; it only says which file, clip and prop node belongs to which resident
 * of the proposed smithy household (household-casting.ts). Measured budgets, clip durations, strides,
 * contacts and provenance live in each set's manifest.json and provenance.json beside the files.
 *
 * Invariants checked by the validator:
 * - exactly one art set per household member, keyed by the registry resident ID (the smith keeps its
 *   compatibility ID, so its inherited decision memory still reads);
 * - every set has a walk, an idle and a role work clip at a registered workplace; talking or idle clips
 *   never stand in for work or walking;
 * - face calibrations pass the shared face contract; props attach to hand joints or the resident root.
 *
 * Pure data plus a validator: no three, DOM, timers, clock reads, randomness, storage or network.
 * ES2020 compatible.
 */
import { FACE_EXPRESSIONS, validateFaceCalibration, type FaceCalibration, type FaceCue } from './face-performance';
import { EALDHOLT_HOUSEHOLD_CASTING, HOUSEHOLD_LOD_BUDGETS, type CastingLodBudget, type HouseholdCasting } from './household-casting';

export const HOUSEHOLD_ART_SETS_STATUS = 'working-placeholder' as const;
/** Folder of every set, relative to the shared legacy environment asset root (desktop canonical, Quest mirrored). */
export const HOUSEHOLD_ART_ROOT = 'aethelgard/characters' as const;

export type HouseholdArtLevel = 'desktop-lod0' | 'desktop-lod1' | 'quest';
export const HOUSEHOLD_ART_LEVELS: readonly HouseholdArtLevel[] = Object.freeze(['desktop-lod0', 'desktop-lod1', 'quest'] as const);

export interface HouseholdPropAttachment {
  /** Node name in the set's props GLB (a prop_ node, or 'workplace'). */
  readonly node: string;
  /**
   * Joint to parent under, keeping the node's local transform (hand joints for held props, 'hips' for tools tucked in a
   * girdle or apron band); null = place in the resident root frame (the work anchor).
   */
  readonly bone: 'hand_l' | 'hand_r' | 'hips' | null;
}

/** A held prop changing over between a hand and its resting copy inside a work transition (round 2). */
export interface HouseholdPropSwap {
  /** Seconds into the transition clip: at this frame the held prop and its resting copy coincide exactly. */
  readonly seconds: number;
  /** The held prop (a propsByClip node of the work clip). */
  readonly node: string;
  /** 'hand': from here the held prop shows and its rests hide; 'rest': from here the rests show and the prop hides. */
  readonly to: 'hand' | 'rest';
}

/** How a routine slot's activity is presented by the art (round 2: idle or talk never stand in for work). */
export type HouseholdActivityPresentation =
  | { readonly kind: 'work' }
  | { readonly kind: 'clip'; readonly motion: 'idle' | 'talk' | 'sit' | 'walk'; readonly reason: 'conversation' | 'waiting' | 'rest' | 'travel' }
  | { readonly kind: 'indoors' }
  | { readonly kind: 'unpresentable'; readonly planned: string };

export interface HouseholdArtSet {
  readonly residentId: string;
  readonly set: string;
  /** Measured standing height of the shaped body in metres (rest pose, shoes included). */
  readonly heightMetres: number;
  /** Clip names for the actor owner's motions; extra clips are optional transitions or poses. */
  readonly actorMotions: {
    readonly idle: string;
    readonly walk: string;
    readonly talk: string;
    readonly sit: string | null;
    readonly work: string;
    readonly extra: Readonly<Record<string, string>>;
  };
  /** Registered place where the work clip happens (household-casting registry place ID). */
  readonly workPlaceId: string;
  /** Props to attach while a clip plays; clips not listed carry no props. */
  readonly propsByClip: Readonly<Record<string, readonly HouseholdPropAttachment[]>>;
  /** Face calibration for this set's joints (blink closure, eye limits, jaw opening). */
  readonly faceCalibration: FaceCalibration;
  /**
   * Props GLB clips that animate mechanisms during a body clip (same name, same duration): play them on the props
   * attached to the resident at the body clip's time (the bellows lever, lid, pleats and chain; the spindle's spin).
   */
  readonly propClips: Readonly<Record<string, string>>;
  /** Clip-synchronised facial cues (face-performance.ts faceCueAt): for example the carving loop's blow. */
  readonly faceCues: Readonly<Record<string, readonly FaceCue[]>>;
  /** Clip timing the integration needs: the hammer's impacts, the carving strokes (seconds into the clip). */
  readonly events: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>;
  /**
   * The workstation (round 2): the props file's `workplace` node, placed once at the work place's anchor (the resident
   * root transform its work clips play at) and left in the world; never shown or hidden with clips. Its mechanism clips
   * (propClips) play on it only while the work clip plays, at the work clip's time; otherwise it holds time 0.
   */
  readonly workstation: { readonly node: 'workplace' };
  /**
   * Resting copies of held props (round 2): where a prop is when no hand holds it (on the workstation, in the resident
   * root frame, or tucked in a girdle under 'hips'). A resting copy shows exactly when its held prop does not.
   */
  readonly restingProps: Readonly<Record<string, readonly HouseholdPropAttachment[]>>;
  /**
   * Entry into and exit from the work loop (round 2): one-shot clips from `from` (the idle, or the elder's seated rest)
   * to the work clip's first frame and back, with the frames at which held props change over (propSwaps).
   */
  readonly workTransitions: {
    readonly enter: string;
    readonly exit: string;
    readonly from: 'idle' | 'sit';
    readonly swaps: Readonly<Record<string, readonly HouseholdPropSwap[]>>;
  };
  /** Every routine slot of the resident (household-casting.ts activity text) and how it is presented. */
  readonly activityPresentation: Readonly<Record<string, HouseholdActivityPresentation>>;
}

const hand = (node: string, bone: 'hand_l' | 'hand_r'): HouseholdPropAttachment => ({ node, bone });
const station = (node: string): HouseholdPropAttachment => ({ node, bone: null });
const girdle = (node: string): HouseholdPropAttachment => ({ node, bone: 'hips' });
const WORKSTATION = { node: 'workplace' } as const;
const swap = (seconds: number, node: string, to: 'hand' | 'rest'): HouseholdPropSwap => ({ seconds, node, to });
const INDOORS: HouseholdActivityPresentation = { kind: 'indoors' };
const WORK: HouseholdActivityPresentation = { kind: 'work' };
const later = (planned: string): HouseholdActivityPresentation => ({ kind: 'unpresentable', planned });
const shown = (motion: 'idle' | 'talk' | 'sit' | 'walk', reason: 'conversation' | 'waiting' | 'rest' | 'travel'): HouseholdActivityPresentation =>
  ({ kind: 'clip', motion, reason });
const MEALS = { 'Breakfast with the household.': INDOORS, 'Midday meal with the household.': INDOORS,
  'Evening meal with the household.': INDOORS, 'Asleep at home.': INDOORS } as const;

/**
 * Calibration measured on each export's LOD1/Quest head (scripts/characters/lib/face_rig.py, `lodFaceRig` in the
 * manifest): the upper-lid angle that closes the head's eyes with the lower lid raised 0.15 rad (0.6 mm overlap at
 * every point of the opening) and the jaw angle whose full opening parts the lips 18 mm (15 mm on the child). Since
 * round 2 the LOD1/Quest head is the resident's own LOD0 head, decimated with its lid and lip loops kept, and every
 * level carries the face morphs, so the adapters blink and speak by morph at every level; these angles drive the
 * set's face clips and joints-only consumers.
 */
const SMITH_FACE: FaceCalibration = { eyeYawLimit: 0.52, eyePitchUpLimit: 0.38, eyePitchDownLimit: 0.45, upperLidClosed: 0.464, lowerLidClosed: -0.15, lidFollow: 0.55, jawOpen: 0.208 };
const SPINNER_FACE: FaceCalibration = { eyeYawLimit: 0.52, eyePitchUpLimit: 0.38, eyePitchDownLimit: 0.45, upperLidClosed: 0.575, lowerLidClosed: -0.15, lidFollow: 0.55, jawOpen: 0.213 };
const CHILD_FACE: FaceCalibration = { eyeYawLimit: 0.55, eyePitchUpLimit: 0.4, eyePitchDownLimit: 0.45, upperLidClosed: 0.636, lowerLidClosed: -0.15, lidFollow: 0.55, jawOpen: 0.201 };
const ELDER_FACE: FaceCalibration = { eyeYawLimit: 0.48, eyePitchUpLimit: 0.34, eyePitchDownLimit: 0.42, upperLidClosed: 0.559, lowerLidClosed: -0.15, lidFollow: 0.5, jawOpen: 0.211 };

export const HOUSEHOLD_ART_SETS: readonly HouseholdArtSet[] = deepFreeze([
  {
    residentId: 'ealdholt-village-smith',
    set: 'village-smith-v1',
    heightMetres: 1.75,
    actorMotions: { idle: 'idle', walk: 'walk', talk: 'talk', sit: null, work: 'work_hammer',
      extra: { start: 'walk_start', stop: 'walk_stop', workEnter: 'work_enter', workExit: 'work_exit' } },
    workPlaceId: 'smithy-forge',
    propsByClip: {
      work_hammer: [hand('prop_hammer', 'hand_r'), hand('prop_tongs', 'hand_l')],
      work_enter: [hand('prop_hammer', 'hand_r'), hand('prop_tongs', 'hand_l')],
      work_exit: [hand('prop_hammer', 'hand_r'), hand('prop_tongs', 'hand_l')],
    },
    faceCalibration: SMITH_FACE,
    propClips: {},
    faceCues: {},
    events: { work_hammer: { impactSeconds: [19 / 30, 49 / 30] } },
    workstation: WORKSTATION,
    // the workpiece rides in the tongs' jaws (a child of the tongs node): its resting copy changes over with them
    restingProps: { prop_hammer: [station('prop_hammer_rest')], prop_tongs: [station('prop_tongs_rest'), station('prop_workpiece_rest')] },
    workTransitions: { enter: 'work_enter', exit: 'work_exit', from: 'idle', swaps: {
      work_enter: [swap(0.62, 'prop_tongs', 'hand'), swap(0.78, 'prop_hammer', 'hand')],
      work_exit: [swap(0.45, 'prop_hammer', 'rest'), swap(0.6, 'prop_tongs', 'rest')],
    } },
    activityPresentation: { ...MEALS,
      'Lights the forge before breakfast.': later('fire-lighting loop'),
      'Forges and repairs village ironwork.': WORK,
      'Shows the child how to keep the bellows steady.': shown('talk', 'conversation'),
      'Quenches and racks finished pieces.': later('quench and rack loop'),
      'Heavy forging with hammer and tongs at the anvil.': WORK,
      'Fetches water and trades news at the well.': later('water-carry loop'),
      'Banks the fire and sharpens tools.': later('banking and sharpening loop'),
      'Mends a tool handle by the hearth beside the elder.': INDOORS,
    },
  },
  {
    residentId: 'ealdholt-smithy-spinner',
    set: 'smithy-spinner-v1',
    heightMetres: 1.72,
    actorMotions: { idle: 'idle', walk: 'walk', talk: 'talk', sit: null, work: 'work_spindle',
      extra: { start: 'walk_start', stop: 'walk_stop', workEnter: 'work_enter', workExit: 'work_exit' } },
    workPlaceId: 'smithy-house',
    // the fibre roll and the yarn are their own nodes in the spindle's grip (round 2): the spin clip never turns the roll,
    // and the yarn pays out when she drops the spindle and winds in when she takes it up
    propsByClip: {
      work_spindle: [hand('prop_spindle', 'hand_l'), hand('prop_spindle_yarn', 'hand_l'), hand('prop_fibre_roll', 'hand_l')],
      work_enter: [hand('prop_spindle', 'hand_l'), hand('prop_spindle_yarn', 'hand_l'), hand('prop_fibre_roll', 'hand_l')],
      work_exit: [hand('prop_spindle', 'hand_l'), hand('prop_spindle_yarn', 'hand_l'), hand('prop_fibre_roll', 'hand_l')],
    },
    faceCalibration: SPINNER_FACE,
    propClips: { work_spindle: 'work_spindle', work_enter: 'work_enter', work_exit: 'work_exit' },
    faceCues: {},
    events: { work_spindle: { draftSeconds: [0, 0.55, 1.2, 1.95], twirlSeconds: [3.35] } },
    workstation: WORKSTATION,
    restingProps: { prop_fibre_roll: [girdle('prop_fibre_roll_rest')], prop_spindle: [girdle('prop_spindle_rest')], prop_spindle_yarn: [] },
    workTransitions: { enter: 'work_enter', exit: 'work_exit', from: 'idle', swaps: {
      work_enter: [swap(0.55, 'prop_fibre_roll', 'hand'), swap(0.55, 'prop_spindle', 'hand'), swap(0.55, 'prop_spindle_yarn', 'hand')],
      work_exit: [swap(1.35, 'prop_fibre_roll', 'rest'), swap(1.35, 'prop_spindle', 'rest'), swap(1.35, 'prop_spindle_yarn', 'rest')],
    } },
    activityPresentation: { ...MEALS,
      'Sets wool to soak before breakfast.': later('soaking and lifting wool loop'),
      'Spins yarn at the doorway.': WORK,
      'Rinses dyed wool at the riverbank.': later('rinsing loop at the bank'),
      'Trades yarn and news in the courtyard.': shown('talk', 'conversation'),
      'Tends the dye vat beside the house.': later('dye vat stirring loop'),
      'Washes fleece at the pond edge with the child.': later('fleece washing loop'),
      'Winds skeins and spins.': WORK,
      'Weaves narrow bands by the firelight.': INDOORS,
    },
  },
  {
    residentId: 'ealdholt-smithy-child',
    set: 'smithy-child-v1',
    heightMetres: 1.385,
    actorMotions: { idle: 'idle', walk: 'walk', talk: 'talk', sit: null, work: 'work_bellows',
      extra: { start: 'walk_start', stop: 'walk_stop', workEnter: 'work_enter', workExit: 'work_exit' } },
    workPlaceId: 'smithy-forge',
    propsByClip: {},
    faceCalibration: CHILD_FACE,
    propClips: { work_bellows: 'work_bellows' },
    faceCues: {},
    events: { work_bellows: { pullSeconds: [0, 1.4] } },
    workstation: WORKSTATION,
    restingProps: {},
    workTransitions: { enter: 'work_enter', exit: 'work_exit', from: 'idle', swaps: { work_enter: [], work_exit: [] } },
    activityPresentation: { ...MEALS,
      'Wakes and dresses.': INDOORS,
      'Fetches water for the household.': later('water-carry loop'),
      'Gathers kindling at the woodland edge.': later('kindling gathering loop'),
      'Works the bellows beside the smith.': WORK,
      'Plays in the courtyard.': later('play loop'),
      'Runs errands between neighbouring houses.': shown('walk', 'travel'),
      'Helps wash fleece at the pond edge.': later('fleece washing loop'),
      'Walks the elder to the churchyard and back.': shown('walk', 'travel'),
      'Washes before supper.': INDOORS,
      'Listens to the elder by the hearth.': INDOORS,
    },
  },
  {
    residentId: 'ealdholt-smithy-elder',
    set: 'smithy-elder-v1',
    heightMetres: 1.54,
    actorMotions: { idle: 'idle', walk: 'walk', talk: 'talk', sit: 'sit', work: 'work_carving',
      extra: { start: 'walk_start', stop: 'walk_stop', sitDown: 'sit_down', standUp: 'stand_up', workEnter: 'work_enter', workExit: 'work_exit' } },
    workPlaceId: 'smithy-house',
    propsByClip: {
      idle: [hand('prop_stick', 'hand_l')], walk: [hand('prop_stick', 'hand_l')], walk_start: [hand('prop_stick', 'hand_l')],
      walk_stop: [hand('prop_stick', 'hand_l')], talk: [hand('prop_stick', 'hand_l')], sit_down: [hand('prop_stick', 'hand_l')],
      stand_up: [hand('prop_stick', 'hand_l')], sit: [hand('prop_stick', 'hand_l')],
      work_carving: [hand('prop_knife', 'hand_r'), hand('prop_spoon', 'hand_l')],
      work_enter: [hand('prop_stick', 'hand_l'), hand('prop_knife', 'hand_r'), hand('prop_spoon', 'hand_l')],
      work_exit: [hand('prop_stick', 'hand_l'), hand('prop_knife', 'hand_r'), hand('prop_spoon', 'hand_l')],
    },
    faceCalibration: ELDER_FACE,
    propClips: {},
    faceCues: { work_carving: [{ expression: 'blow', startSeconds: 2.85, endSeconds: 3.35 }] },
    events: { work_carving: { strokeSeconds: [0.35, 0.95, 1.55, 2.15] } },
    workstation: WORKSTATION,
    restingProps: { prop_stick: [station('prop_stick_rest')], prop_knife: [girdle('prop_knife_rest')], prop_spoon: [girdle('prop_spoon_rest')] },
    workTransitions: { enter: 'work_enter', exit: 'work_exit', from: 'sit', swaps: {
      work_enter: [swap(0.85, 'prop_stick', 'rest'), swap(1.25, 'prop_knife', 'hand'), swap(1.55, 'prop_spoon', 'hand')],
      work_exit: [swap(0.55, 'prop_spoon', 'rest'), swap(0.8, 'prop_knife', 'rest'), swap(1.35, 'prop_stick', 'hand')],
    } },
    activityPresentation: { ...MEALS,
      'Warms by the hearth.': INDOORS,
      'Carves wooden spoons at the doorstep.': WORK,
      'Sits at the well and trades news.': shown('sit', 'conversation'),
      'Watches the forge work and offers advice.': shown('talk', 'conversation'),
      'Rests, then mends tool handles.': later('handle mending loop'),
      'Visits the churchyard with the child.': shown('walk', 'travel'),
      'Tends the hearth.': INDOORS,
      'Carves by the hearth and talks with the smith and the child.': INDOORS,
    },
  },
] as const satisfies readonly HouseholdArtSet[]);

/** Props file of a platform: one atlas material per set (1k on desktop, 512 px on Quest); same node names. */
export type HouseholdPropsFile = 'props' | 'props-quest';
/** The props file that goes with a resident level: Quest levels load the lighter Quest props. */
export function householdPropsFileFor(level: HouseholdArtLevel): HouseholdPropsFile {
  return level === 'quest' ? 'props-quest' : 'props';
}

/** File name of one level of a set: `<set without -vN>-<level>.glb`. */
export function householdArtFile(set: HouseholdArtSet, level: HouseholdArtLevel | HouseholdPropsFile): string {
  return `${set.set.replace(/-v\d+$/, '')}-${level}.glb`;
}

/** Folder of a set relative to the shared legacy environment asset root. */
export function householdArtFolder(set: HouseholdArtSet): string {
  return `${HOUSEHOLD_ART_ROOT}/${set.set}`;
}

// ------------------------------------------------------------------ level selection

/** One resident's request for a level this frame (or this cadence tick). */
export interface HouseholdLevelRequest {
  readonly residentId: string;
  /** Distance from the viewer (desktop camera or Quest head) to the resident's root, metres. */
  readonly distanceMetres: number;
  /** In conversation with, or framed by, the viewer: takes priority for the close level. */
  readonly inConversation: boolean;
  /** The level the resident shows now (null = none of the built levels), for hysteresis. */
  readonly current: HouseholdArtLevel | null;
}

/** Switch distances with hysteresis: a level is entered inside `enter` and kept until beyond `exit`. */
export const HOUSEHOLD_LEVEL_DISTANCES = Object.freeze({
  'desktop-lod0': Object.freeze({ enter: 4.0, exit: 4.6 }),
  'desktop-lod1': Object.freeze({ enter: 25.0, exit: 28.0 }),
  quest: Object.freeze({ enter: 12.0, exit: 13.5 }),
} as const);

const BUDGET_OF: Readonly<Record<HouseholdArtLevel, CastingLodBudget['id']>> = Object.freeze({
  'desktop-lod0': 'desktop-lod0', 'desktop-lod1': 'desktop-lod1', quest: 'quest-near',
});

/**
 * Picks a built level for every resident, deterministically: residents in conversation first, then the nearest,
 * fill each level up to its `maxSimultaneous` (HOUSEHOLD_LOD_BUDGETS); a resident keeps its current level until it
 * passes that level's exit distance. Desktop: desktop-lod0, then desktop-lod1. Quest: the quest level only.
 *
 * Round 2: a resident inside the last built level's distance is never dropped. When every level it may use is full,
 * it is demoted to the cheapest built level anyway and listed in `overCapacity` (the earlier version returned null,
 * so a fifth resident at 3 m vanished on Quest). The caller decides what an over-capacity frame costs (the cheaper
 * Quest mid level and the far impostor that would absorb it are planned, not built). null now means only "beyond
 * the last built level's distance". Ties break on resident ID. Pure: no clock, randomness or scene access.
 */
export interface HouseholdLevelSelection {
  readonly levels: Readonly<Record<string, HouseholdArtLevel | null>>;
  /** Residents shown at a level that was already full (sorted by resident ID). */
  readonly overCapacity: readonly string[];
}

export function selectHouseholdArtLevelsDetailed(requests: readonly HouseholdLevelRequest[], platform: 'desktop' | 'quest',
  budgets: readonly CastingLodBudget[] = HOUSEHOLD_LOD_BUDGETS): HouseholdLevelSelection {
  const capacity = (level: HouseholdArtLevel) => budgets.find(b => b.id === BUDGET_OF[level])?.maxSimultaneous ?? 0;
  const order = [...requests].sort((a, b) =>
    (Number(b.inConversation) - Number(a.inConversation)) || (a.distanceMetres - b.distanceMetres) ||
    (a.residentId < b.residentId ? -1 : a.residentId > b.residentId ? 1 : 0));
  const levels: readonly HouseholdArtLevel[] = platform === 'quest' ? ['quest'] : ['desktop-lod0', 'desktop-lod1'];
  const cheapest = levels[levels.length - 1];
  const used: Record<string, number> = {};
  const out: Record<string, HouseholdArtLevel | null> = {};
  const over: string[] = [];
  for (const r of order) {
    let chosen: HouseholdArtLevel | null = null;
    let eligible: HouseholdArtLevel | null = null;
    for (const level of levels) {
      const d = HOUSEHOLD_LEVEL_DISTANCES[level];
      const keeps = r.current === level || (level !== 'desktop-lod0' && r.current === 'desktop-lod0');
      const inside = r.distanceMetres < (keeps ? d.exit : d.enter) || (level === 'desktop-lod0' && r.inConversation) ||
        (level === 'quest' && r.inConversation);
      if (!inside) continue;
      eligible = eligible ?? level;
      if ((used[level] ?? 0) < capacity(level)) {
        chosen = level;
        break;
      }
    }
    if (!chosen && eligible) {  // every level it may use is full: demote to the cheapest built level, never drop it
      chosen = cheapest;
      over.push(r.residentId);
    }
    if (chosen) used[chosen] = (used[chosen] ?? 0) + 1;
    out[r.residentId] = chosen;
  }
  over.sort();
  return Object.freeze({ levels: Object.freeze(out), overCapacity: Object.freeze(over) });
}

/** The level map of selectHouseholdArtLevelsDetailed (kept for callers that only need the levels). */
export function selectHouseholdArtLevels(requests: readonly HouseholdLevelRequest[], platform: 'desktop' | 'quest',
  budgets: readonly CastingLodBudget[] = HOUSEHOLD_LOD_BUDGETS): Readonly<Record<string, HouseholdArtLevel | null>> {
  return selectHouseholdArtLevelsDetailed(requests, platform, budgets).levels;
}

export function getHouseholdArtSet(residentId: string, sets: readonly HouseholdArtSet[] = HOUSEHOLD_ART_SETS): HouseholdArtSet | null {
  for (const set of sets) if (set.residentId === residentId) return set;
  return null;
}

const CLIP = /^[a-z][a-z0-9_]*$/;

/** Validates the published sets against the household casting. Returns null or the first problem. */
export function validateHouseholdArtSets(sets: readonly HouseholdArtSet[] = HOUSEHOLD_ART_SETS,
  casting: HouseholdCasting = EALDHOLT_HOUSEHOLD_CASTING): string | null {
  const members = casting.registry.households[0]?.memberIds ?? [];
  if (sets.length !== members.length) return 'Every household member needs exactly one art set.';
  const seen = new Set<string>();
  for (const set of sets) {
    if (members.indexOf(set.residentId) < 0) return `Art set ${set.set} is not for a household member.`;
    if (seen.has(set.residentId)) return `Resident ${set.residentId} has more than one art set.`;
    seen.add(set.residentId);
    if (!/^[a-z0-9-]+-v\d+$/.test(set.set)) return `Set ${set.set} must be a versioned folder name.`;
    if (!(set.heightMetres > 0.9 && set.heightMetres < 2.1)) return `Set ${set.set} height is implausible.`;
    const m = set.actorMotions;
    const clips = [m.idle, m.walk, m.talk, m.work, ...(m.sit ? [m.sit] : []), ...Object.values(m.extra)];
    if (clips.some(c => !CLIP.test(c))) return `Set ${set.set} has an invalid clip name.`;
    if (!/^work_/.test(m.work) || m.work === m.idle || m.work === m.talk) return 'Talking or idle clips cannot stand in for work.';
    if (m.walk === m.idle || m.walk === m.talk) return 'An idle or talking clip cannot stand in for walking.';
    const resident = casting.registry.residents.find(r => r.id === set.residentId);
    if (!resident || !resident.routine.some(s => s.placeId === set.workPlaceId)) return `Work place of ${set.set} is not in the resident's routine.`;
    for (const [clip, props] of Object.entries(set.propsByClip)) {
      if (clips.indexOf(clip) < 0) return `Props of ${set.set} name an unknown clip ${clip}.`;
      for (const p of props) {
        if (p.bone === null ? p.node !== 'workplace' && !/^prop_/.test(p.node) : !/^prop_/.test(p.node)) return `Prop node ${p.node} of ${set.set} is not a prop.`;
      }
    }
    if (!set.propsByClip[m.work] && set.workstation?.node !== 'workplace') return `Set ${set.set} work clip needs its props or a workstation.`;
    if (set.workstation?.node !== 'workplace') return `Set ${set.set} needs its persistent workstation (the workplace node).`;
    const t = set.workTransitions;
    if (!t || clips.indexOf(t.enter) < 0 || clips.indexOf(t.exit) < 0) return `Set ${set.set} work transitions must be clips of the set.`;
    if (t.from === 'sit' && !m.sit) return `Set ${set.set} enters work from a seat it does not have.`;
    const held = (clip: string) => (set.propsByClip[clip] ?? []).filter(p => p.bone === 'hand_l' || p.bone === 'hand_r').map(p => p.node);
    const fromClip = t.from === 'sit' ? m.sit! : m.idle;
    for (const [clip, list] of Object.entries(t.swaps)) {
      if (clip !== t.enter && clip !== t.exit) return `Prop swaps of ${set.set} name a clip that is not a work transition.`;
      for (const sw of list) {
        if (!(sw.seconds >= 0) || held(clip).indexOf(sw.node) < 0) return `Prop swap of ${sw.node} in ${set.set} ${clip} is not a held prop of that clip.`;
        if (!set.restingProps[sw.node]) return `Prop ${sw.node} of ${set.set} changes over without a resting copy.`;
      }
    }
    // every held prop that changes between the starting clip and the work loop is handed over once each way
    for (const node of new Set([...held(fromClip), ...held(m.work)])) {
      const inWork = held(m.work).indexOf(node) >= 0, inFrom = held(fromClip).indexOf(node) >= 0;
      if (inWork === inFrom) continue;
      const e = (t.swaps[t.enter] ?? []).filter(x => x.node === node), x = (t.swaps[t.exit] ?? []).filter(x => x.node === node);
      if (e.length !== 1 || x.length !== 1 || e[0].to !== (inWork ? 'hand' : 'rest') || x[0].to !== (inWork ? 'rest' : 'hand')) {
        return `Prop ${node} of ${set.set} must change over once on the way into work and once on the way out.`;
      }
    }
    for (const [node, rests] of Object.entries(set.restingProps)) {
      if (!/^prop_/.test(node)) return `Resting props of ${set.set} must belong to a prop.`;
      for (const r of rests) if (!/^prop_.*_rest$/.test(r.node) || (r.bone !== null && r.bone !== 'hips')) return `Resting copy ${r.node} of ${set.set} must sit on the workstation or a girdle.`;
    }
    const slots = resident.routine.map(r => r.activity);
    for (const activity of slots) {
      const pres = set.activityPresentation[activity];
      if (!pres) return `Routine slot "${activity}" of ${set.set} has no presentation.`;
      const slot = resident.routine.find(r => r.activity === activity)!;
      if (pres.kind === 'work' && slot.placeId !== set.workPlaceId) return `Work presentation of ${set.set} must happen at its work place.`;
      if (pres.kind === 'clip') {
        const ok = pres.motion === 'walk' ? pres.reason === 'travel'
          : pres.motion === 'sit' ? m.sit !== null && pres.reason !== 'travel'
          : pres.reason === 'conversation' || pres.reason === 'waiting';
        if (!ok) return `Routine slot "${activity}" of ${set.set} cannot be shown with ${pres.motion}.`;
      }
      if (pres.kind === 'unpresentable' && !pres.planned) return `Unpresentable slot "${activity}" of ${set.set} needs its planned motion.`;
    }
    for (const activity of Object.keys(set.activityPresentation)) {
      if (slots.indexOf(activity) < 0) return `Presentation of ${set.set} names a slot "${activity}" that is not in the routine.`;
    }
    for (const [clip, propClip] of Object.entries(set.propClips)) {
      if (clips.indexOf(clip) < 0 || !CLIP.test(propClip)) return `Prop clip ${propClip} of ${set.set} is not for a known clip.`;
    }
    for (const [clip, cues] of Object.entries(set.faceCues)) {
      if (clips.indexOf(clip) < 0) return `Face cues of ${set.set} name an unknown clip ${clip}.`;
      for (const c of cues) {
        if (FACE_EXPRESSIONS[c.expression] === undefined || !(c.endSeconds > c.startSeconds) || c.startSeconds < 0) return `Face cue of ${set.set} is invalid.`;
      }
    }
    for (const [clip, ev] of Object.entries(set.events)) {
      if (clips.indexOf(clip) < 0) return `Events of ${set.set} name an unknown clip ${clip}.`;
      for (const times of Object.values(ev)) if (!times.every(t => Number.isFinite(t) && t >= 0)) return `Events of ${set.set} need finite times.`;
    }
    const calibration = validateFaceCalibration(set.faceCalibration);
    if (calibration) return `Set ${set.set}: ${calibration}`;
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
