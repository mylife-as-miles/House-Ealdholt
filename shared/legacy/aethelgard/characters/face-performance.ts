/**
 * Ealdholt resident face performance: blinking, gaze, visemes and expressions.
 *
 * Shared pure contract for the desktop and Quest face-rig adapters. Every value is
 * a deterministic function of explicit inputs (seed, caller-supplied time, targets):
 * no clocks, timers, randomness, DOM or renderer types. ES2020 compatible.
 *
 * Two tiers, matching the exported resident GLBs:
 * - Tier A (all levels): dedicated face joints rotated in their local frames.
 *   Convention baked by scripts/characters: local +X pitches (eyes look down,
 *   upper lid closes, lower lid opens, jaw opens); local +Z yaws the eyes toward
 *   the character's right. Adapters apply rest * pitch(X) * yaw(Z). A level
 *   without morphs blinks and speaks through these joints alone (the joints
 *   close the eyes completely at faceCalibration.upperLidClosed: checked by
 *   household-art-runtime.test.ts on every published level).
 * - Tier B: ARKit-style and viseme morph targets. Since round 2 every published
 *   level (desktop LOD0, LOD1 and Quest) carries the 44 channels, so blinks,
 *   visemes and expressions come from the morphs everywhere and the joints only
 *   aim the eyes and let the lids follow the gaze.
 *
 * The unseen influence: residents never know or look toward its source. The
 * sensitivity glance below is an undirected pause whose frequency depends only
 * on the registry's influence sensitivity.
 */

export const FACE_PERFORMANCE_VERSION = 2 as const;

export const FACE_JOINT_NAMES = Object.freeze({
  jaw: 'face_jaw',
  eyeLeft: 'face_eye_l',
  eyeRight: 'face_eye_r',
  lidUpperLeft: 'face_lid_upper_l',
  lidUpperRight: 'face_lid_upper_r',
  lidLowerLeft: 'face_lid_lower_l',
  lidLowerRight: 'face_lid_lower_r',
} as const);
export type FaceJointKey = keyof typeof FACE_JOINT_NAMES;
export const FACE_JOINT_KEYS: readonly FaceJointKey[] = Object.freeze(Object.keys(FACE_JOINT_NAMES) as FaceJointKey[]);

/** Morph channels exported on every published level (since round 2), in a fixed order adapters index by. */
export const FACE_MORPH_CHANNELS = Object.freeze([
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight',
  'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthPressLeft', 'mouthPressRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS',
  'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
] as const);
export type FaceMorphChannel = typeof FACE_MORPH_CHANNELS[number];
const CHANNEL_INDEX: Readonly<Record<string, number>> = Object.freeze(
  FACE_MORPH_CHANNELS.reduce<Record<string, number>>((acc, name, i) => { acc[name] = i; return acc; }, {}));
export function faceMorphIndex(channel: string): number {
  const index = CHANNEL_INDEX[channel];
  return index === undefined ? -1 : index;
}

export const VISEME_IDS = Object.freeze(['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'] as const);
export type VisemeId = typeof VISEME_IDS[number];
/** Jaw opening per viseme for joint-only levels (fraction of calibration.jawOpenRadians). */
export const VISEME_JAW_OPEN: Readonly<Record<VisemeId, number>> = Object.freeze({
  sil: 0, PP: 0, FF: 0.08, TH: 0.14, DD: 0.2, kk: 0.24, CH: 0.16, SS: 0.08, nn: 0.16, RR: 0.22,
  aa: 0.8, E: 0.42, I: 0.26, O: 0.55, U: 0.28,
});

/** Named expressions as ARKit channel weights at intensity 1 (working-placeholder presets). */
export const FACE_EXPRESSIONS = Object.freeze({
  neutral: Object.freeze({}),
  smile: Object.freeze({ mouthSmileLeft: 0.72, mouthSmileRight: 0.72, cheekSquintLeft: 0.45, cheekSquintRight: 0.45, eyeSquintLeft: 0.22, eyeSquintRight: 0.22 }),
  halfSmile: Object.freeze({ mouthSmileLeft: 0.55, cheekSquintLeft: 0.3, eyeSquintLeft: 0.12 }),
  concentration: Object.freeze({ eyeSquintLeft: 0.42, eyeSquintRight: 0.42, browDownLeft: 0.5, browDownRight: 0.5, mouthPressLeft: 0.25, mouthPressRight: 0.25 }),
  concern: Object.freeze({ browInnerUp: 0.85, mouthFrownLeft: 0.4, mouthFrownRight: 0.4, mouthPressLeft: 0.3, mouthPressRight: 0.3 }),
  displeasure: Object.freeze({ browDownLeft: 0.8, browDownRight: 0.8, noseSneerLeft: 0.35, noseSneerRight: 0.35, mouthPressLeft: 0.5, mouthPressRight: 0.5 }),
  wince: Object.freeze({ eyeSquintLeft: 0.75, eyeSquintRight: 0.75, browDownLeft: 0.6, browDownRight: 0.6, mouthStretchLeft: 0.45, mouthStretchRight: 0.45, cheekSquintLeft: 0.5, cheekSquintRight: 0.5 }),
  surprise: Object.freeze({ eyeWideLeft: 0.7, eyeWideRight: 0.7, browInnerUp: 0.6, browOuterUpLeft: 0.7, browOuterUpRight: 0.7, jawOpen: 0.2 }),
  /** Blowing shavings off the work (the elder's carving loop cues it through faceCues). */
  blow: Object.freeze({ mouthPucker: 0.65, mouthFunnel: 0.5, cheekSquintLeft: 0.2, cheekSquintRight: 0.2, jawOpen: 0.06 }),
} as const);
export type FaceExpressionName = keyof typeof FACE_EXPRESSIONS;

export interface FaceCalibration {
  /** Eye rotation limits (elliptical clamp), radians. */
  readonly eyeYawLimit: number;
  readonly eyePitchUpLimit: number;
  readonly eyePitchDownLimit: number;
  /** Upper-lid joint pitch that closes the eye (positive), lower-lid pitch at closure (negative raises). */
  readonly upperLidClosed: number;
  readonly lowerLidClosed: number;
  /** Fraction of eye pitch the lids follow so the lids track the iris. */
  readonly lidFollow: number;
  /** Jaw joint pitch at full opening. */
  readonly jawOpen: number;
}

/** Calibration measured on the village-smith-v1 export (see its manifest); other sets supply their own. */
export const DEFAULT_FACE_CALIBRATION: FaceCalibration = Object.freeze({
  eyeYawLimit: 0.52, eyePitchUpLimit: 0.38, eyePitchDownLimit: 0.45,
  upperLidClosed: 0.55, lowerLidClosed: -0.16, lidFollow: 0.55, jawOpen: 0.3,
});

export interface BlinkProfile {
  readonly minIntervalSeconds: number;
  readonly maxIntervalSeconds: number;
  readonly closeSeconds: number;
  readonly holdSeconds: number;
  readonly openSeconds: number;
  /** Chance that a blink is followed by a second one. */
  readonly doubleBlinkChance: number;
}
export const DEFAULT_BLINK_PROFILE: BlinkProfile = Object.freeze({
  minIntervalSeconds: 2.5, maxIntervalSeconds: 6, closeSeconds: 0.075, holdSeconds: 0.035, openSeconds: 0.14, doubleBlinkChance: 0.12,
});

// ------------------------------------------------------------------ deterministic hashing

/** 32-bit integer hash of (seed, index) to [0, 1). */
export function hashUnit(seed: number, index: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Stable seed from a resident ID (FNV-1a). */
export function faceSeed(residentId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < residentId.length; i++) { h ^= residentId.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

export function validateBlinkProfile(p: BlinkProfile): string | null {
  const values = [p.minIntervalSeconds, p.maxIntervalSeconds, p.closeSeconds, p.holdSeconds, p.openSeconds, p.doubleBlinkChance];
  if (!values.every(Number.isFinite)) return 'Blink profile values must be finite.';
  if (!(p.minIntervalSeconds > 0.8 && p.maxIntervalSeconds >= p.minIntervalSeconds && p.maxIntervalSeconds <= 12)) return 'Blink intervals must lie between 0.8 and 12 seconds.';
  const duration = p.closeSeconds + p.holdSeconds + p.openSeconds;
  if (!(p.closeSeconds > 0 && p.openSeconds > 0 && p.holdSeconds >= 0 && duration < 0.6)) return 'A blink must last under 0.6 seconds.';
  if (!(p.doubleBlinkChance >= 0 && p.doubleBlinkChance <= 0.5)) return 'Double blink chance must be within 0..0.5.';
  if (duration * 2 + 0.12 > p.minIntervalSeconds) return 'Blinks must not overlap the minimum interval.';
  return null;
}

function blinkShape(local: number, p: BlinkProfile): number {
  if (local < 0) return 0;
  if (local < p.closeSeconds) { const t = local / p.closeSeconds; return t * t; }
  if (local < p.closeSeconds + p.holdSeconds) return 1;
  const open = local - p.closeSeconds - p.holdSeconds;
  if (open < p.openSeconds) return 1 - smooth(open / p.openSeconds);
  return 0;
}

/** Blink onset of the k-th slot on a jittered grid: intervals stay within [min, max]. */
function blinkOnset(seed: number, k: number, p: BlinkProfile): number {
  const mean = (p.minIntervalSeconds + p.maxIntervalSeconds) / 2;
  const range = (p.maxIntervalSeconds - p.minIntervalSeconds) / 2;
  return k * mean + (hashUnit(seed, k) - 0.5) * range;
}

/** Eyelid closure 0 (open) .. 1 (closed) at caller time t (seconds). Deterministic in (seed, t). */
export function blinkWeightAt(seed: number, timeSeconds: number, profile: BlinkProfile = DEFAULT_BLINK_PROFILE): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  const mean = (profile.minIntervalSeconds + profile.maxIntervalSeconds) / 2;
  const slot = Math.floor(timeSeconds / mean);
  const duration = profile.closeSeconds + profile.holdSeconds + profile.openSeconds;
  let weight = 0;
  for (let k = slot - 1; k <= slot + 1; k++) {
    const onset = blinkOnset(seed, k, profile);
    weight = Math.max(weight, blinkShape(timeSeconds - onset, profile));
    if (hashUnit(seed ^ 0x5bd1e995, k) < profile.doubleBlinkChance) weight = Math.max(weight, blinkShape(timeSeconds - onset - duration - 0.08, profile));
  }
  return weight;
}

// ------------------------------------------------------------------ gaze

export interface Gaze { readonly yaw: number; readonly pitch: number }

/** Head-local direction (+Z forward, +Y up, +X toward the character's left) to eye yaw/pitch.
 * Positive yaw looks toward the character's right; positive pitch looks down. */
export function gazeFromHeadDirection(x: number, y: number, z: number): Gaze {
  const horizontal = Math.hypot(x, z);
  if (!(horizontal > 1e-9) && !(Math.abs(y) > 1e-9)) return { yaw: 0, pitch: 0 };
  return { yaw: Math.atan2(-x, z), pitch: Math.atan2(-y, horizontal) };
}

/** Elliptical clamp to the calibrated eye range; reports whether the head should turn. */
export function clampGaze(gaze: Gaze, c: FaceCalibration = DEFAULT_FACE_CALIBRATION): Gaze & { readonly clamped: boolean } {
  const yaw = Number.isFinite(gaze.yaw) ? gaze.yaw : 0;
  const pitch = Number.isFinite(gaze.pitch) ? gaze.pitch : 0;
  const pitchLimit = pitch < 0 ? c.eyePitchUpLimit : c.eyePitchDownLimit;
  const e = (yaw / c.eyeYawLimit) ** 2 + (pitch / pitchLimit) ** 2;
  if (e <= 1) return { yaw, pitch, clamped: false };
  const s = 1 / Math.sqrt(e);
  return { yaw: yaw * s, pitch: pitch * s, clamped: true };
}

/** Small fixational shifts (about one degree) that hold for 0.4 to 1.4 s. Deterministic in (seed, t). */
export function gazeDriftAt(seed: number, timeSeconds: number, amplitude = 0.018): Gaze {
  if (!Number.isFinite(timeSeconds)) return { yaw: 0, pitch: 0 };
  // Jittered slot boundaries: each hold lasts between 0.4 and 1.4 s.
  const boundary = (k: number) => k * 0.9 + (hashUnit(seed ^ 0x27d4eb2f, k) - 0.5) * 0.5;
  let slot = Math.floor(timeSeconds / 0.9);
  if (timeSeconds < boundary(slot)) slot -= 1;
  else if (timeSeconds >= boundary(slot + 1)) slot += 1;
  return { yaw: (hashUnit(seed, slot * 2 + 7) - 0.5) * 2 * amplitude, pitch: (hashUnit(seed, slot * 2 + 8) - 0.5) * 1.4 * amplitude };
}

export type FaceInfluenceSensitivity = 'occasional' | 'persistent';
/** Mean seconds between undirected pauses; sensitivity changes frequency only. */
export const INFLUENCE_GLANCE_INTERVAL: Readonly<Record<FaceInfluenceSensitivity, number>> = Object.freeze({ occasional: 95, persistent: 28 });

/** An undirected sensitivity pause: a glance aside or up with a slight brow raise, then back.
 * It never targets a position, so it cannot reveal any source. Returns 0..1 envelope and offsets. */
export function influenceGlanceAt(seed: number, timeSeconds: number, sensitivity: FaceInfluenceSensitivity): { readonly amount: number; readonly gaze: Gaze; readonly browRaise: number } {
  const interval = INFLUENCE_GLANCE_INTERVAL[sensitivity];
  if (!Number.isFinite(timeSeconds) || interval === undefined) return { amount: 0, gaze: { yaw: 0, pitch: 0 }, browRaise: 0 };
  const slot = Math.floor(timeSeconds / interval);
  const onset = slot * interval + hashUnit(seed ^ 0x1b873593, slot) * interval * 0.6;
  const hold = sensitivity === 'persistent' ? 2.6 : 1.1;
  const local = timeSeconds - onset;
  const amount = local < 0 || local > hold + 0.8 ? 0 : local < 0.4 ? smooth(local / 0.4) : local < hold + 0.4 ? 1 : 1 - smooth((local - hold - 0.4) / 0.4);
  const angle = hashUnit(seed, slot * 3 + 11) * Math.PI * 2;
  return { amount, gaze: { yaw: Math.cos(angle) * 0.3 * amount, pitch: -Math.abs(Math.sin(angle)) * 0.18 * amount }, browRaise: 0.35 * amount };
}

// ------------------------------------------------------------------ visemes and expressions

export interface VisemeCue { readonly viseme: VisemeId; readonly startSeconds: number; readonly endSeconds: number }

/** Crossfaded viseme weights at time t for a caller-authored cue track (coarticulation by overlap). */
export function visemeTrackAt(track: readonly VisemeCue[], timeSeconds: number, blendSeconds = 0.06): readonly { readonly viseme: VisemeId; readonly weight: number }[] {
  const out: { viseme: VisemeId; weight: number }[] = [];
  if (!Number.isFinite(timeSeconds)) return out;
  for (const cue of track) {
    if (!(cue.endSeconds > cue.startSeconds) || cue.viseme === 'sil') continue;
    const attack = clamp01((timeSeconds - cue.startSeconds + blendSeconds) / (2 * blendSeconds));
    const release = clamp01((cue.endSeconds + blendSeconds - timeSeconds) / (2 * blendSeconds));
    const w = Math.min(smooth(attack), smooth(release));
    if (w > 0) out.push({ viseme: cue.viseme, weight: w });
  }
  return out;
}

export function validateVisemeTrack(track: readonly VisemeCue[]): string | null {
  let last = -Infinity;
  for (const cue of track) {
    if (VISEME_IDS.indexOf(cue.viseme) < 0) return `Unknown viseme ${String(cue.viseme)}.`;
    if (!Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.endSeconds <= cue.startSeconds) return 'Viseme cues need finite increasing times.';
    if (cue.startSeconds < last - 1e-9) return 'Viseme cues must be ordered by start time.';
    last = cue.startSeconds;
  }
  return null;
}

// ------------------------------------------------------------------ speech without a track: babble

/** Syllable rhythm of the deterministic babble: about five syllables a second in phrases with pauses between them. */
export interface BabbleProfile {
  readonly syllablesPerSecond: number;
  /** Phrase length range in syllables, and the pause between phrases in seconds. */
  readonly minPhrase: number;
  readonly maxPhrase: number;
  readonly pauseSeconds: number;
}
export const DEFAULT_BABBLE_PROFILE: BabbleProfile = Object.freeze({ syllablesPerSecond: 4.8, minPhrase: 5, maxPhrase: 14, pauseSeconds: 0.38 });

const BABBLE_CONSONANTS: readonly VisemeId[] = Object.freeze(['PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR'] as const);
const BABBLE_VOWELS: readonly VisemeId[] = Object.freeze(['aa', 'E', 'I', 'O', 'U'] as const);

/** One phrase of syllables starting at `start`: its syllable count and length in seconds. */
function babblePhrase(seed: number, k: number, p: BabbleProfile): { count: number; seconds: number } {
  const count = p.minPhrase + Math.floor(hashUnit(seed ^ 0x2f6b9a1d, k) * (p.maxPhrase - p.minPhrase + 1));
  return { count, seconds: count / p.syllablesPerSecond };
}

/** Phrase slot containing t: every slot holds one phrase from its start, then a pause (shorter phrases leave longer
 * pauses), so the lookup is constant time for any t. */
function babblePhraseAt(seed: number, t: number, p: BabbleProfile): { k: number; start: number } {
  const slot = p.maxPhrase / p.syllablesPerSecond + p.pauseSeconds;
  const k = Math.floor(t / slot);
  return { k, start: k * slot };
}

/**
 * Deterministic speech-like visemes for a resident who is talking without an authored cue track: phrases of
 * syllables (a consonant onset, then a vowel) at about five a second, separated by short pauses, crossfaded. The
 * caller sets `talking` in the face input; the result drives the viseme morphs (every published level since round 2)
 * or, on a level without morphs, the jaw joint. Pure in (seed, t); `amount` scales the weights (0 = silent).
 */
export function babbleVisemesAt(seed: number, timeSeconds: number, amount = 1, profile: BabbleProfile = DEFAULT_BABBLE_PROFILE): readonly { readonly viseme: VisemeId; readonly weight: number }[] {
  const a = clamp01(amount);
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || a <= 0) return [];
  const { k, start } = babblePhraseAt(seed, timeSeconds, profile);
  const phrase = babblePhrase(seed, k, profile);
  const local = timeSeconds - start;
  if (local >= phrase.seconds) return [];
  const syl = 1 / profile.syllablesPerSecond;
  const i = Math.min(phrase.count - 1, Math.floor(local / syl));
  const u = (local - i * syl) / syl;
  const id = k * 64 + i;
  const consonant = BABBLE_CONSONANTS[Math.floor(hashUnit(seed, id * 2) * BABBLE_CONSONANTS.length)];
  const vowel = BABBLE_VOWELS[Math.floor(hashUnit(seed, id * 2 + 1) * BABBLE_VOWELS.length)];
  // stressed syllables open wider; the phrase starts and ends softly
  const stress = 0.6 + 0.4 * hashUnit(seed ^ 0x6b43a9b5, id);
  const edge = smooth(local / 0.12) * smooth((phrase.seconds - local) / 0.15);
  const onset = 1 - smooth(u / 0.35);
  const nucleus = smooth((u - 0.15) / 0.3) * (1 - smooth((u - 0.8) / 0.2));
  const out: { viseme: VisemeId; weight: number }[] = [];
  if (onset > 0.01) out.push({ viseme: consonant, weight: clamp01(onset * edge * a) });
  if (nucleus > 0.01) out.push({ viseme: vowel, weight: clamp01(nucleus * stress * edge * a) });
  return out;
}

/** A clip-synchronised facial cue (manifest faceCues): an expression held over part of a body clip. */
export interface FaceCue { readonly expression: FaceExpressionName; readonly startSeconds: number; readonly endSeconds: number }

/** The expression a clip's cues ask for at clip time t (eased in and out over 0.12 s), or null. */
export function faceCueAt(cues: readonly FaceCue[], clipTimeSeconds: number): { readonly name: FaceExpressionName; readonly intensity: number } | null {
  if (!Number.isFinite(clipTimeSeconds)) return null;
  let best: { name: FaceExpressionName; intensity: number } | null = null;
  for (const c of cues) {
    if (!(c.endSeconds > c.startSeconds) || FACE_EXPRESSIONS[c.expression] === undefined) continue;
    const w = Math.min(smooth((clipTimeSeconds - c.startSeconds) / 0.12), smooth((c.endSeconds - clipTimeSeconds) / 0.12));
    if (w > 0 && (!best || w > best.intensity)) best = { name: c.expression, intensity: w };
  }
  return best;
}

// ------------------------------------------------------------------ composite pose

export interface FacePerformanceInput {
  readonly timeSeconds: number;
  readonly seed: number;
  readonly blink?: BlinkProfile;
  /** Desired head-relative gaze before clamping; null keeps the eyes forward. */
  readonly gaze?: Gaze | null;
  readonly expression?: { readonly name: FaceExpressionName; readonly intensity: number } | null;
  readonly visemes?: readonly { readonly viseme: VisemeId; readonly weight: number }[];
  readonly sensitivity?: FaceInfluenceSensitivity;
  /** Reduced motion: no blinks/drift/glances are animated; explicit gaze and expression still apply. */
  readonly reducedMotion?: boolean;
  /** Extra closure, e.g. a forced blink cue, 0..1. */
  readonly blinkOverride?: number;
  /**
   * Talking without a cue track: 0..1 (true = 1). When no `visemes` are given the deterministic babble
   * (babbleVisemesAt) supplies them, so a talking resident's mouth moves at every level. Body clips never key
   * the jaw; this is the only speech source the face rig needs.
   */
  readonly talking?: boolean | number;
}

export interface FacePose {
  blink: number;
  eyeYaw: number;
  eyePitch: number;
  jawOpen: number;
  headTurnSuggested: boolean;
  /** Tier A joint pitches/yaws in radians, applied in each joint's local frame after the mixer. */
  readonly joints: { jaw: number; eyeYaw: number; eyePitch: number; lidUpper: number; lidLower: number };
  /** Tier B weights in FACE_MORPH_CHANNELS order, 0..1. */
  readonly morphs: Float32Array;
}

export function createFacePose(): FacePose {
  return { blink: 0, eyeYaw: 0, eyePitch: 0, jawOpen: 0, headTurnSuggested: false,
    joints: { jaw: 0, eyeYaw: 0, eyePitch: 0, lidUpper: 0, lidLower: 0 }, morphs: new Float32Array(FACE_MORPH_CHANNELS.length) };
}

const BLINK_L = faceMorphIndex('eyeBlinkLeft'), BLINK_R = faceMorphIndex('eyeBlinkRight'), JAW = faceMorphIndex('jawOpen');
const BROW_INNER = faceMorphIndex('browInnerUp');

/** Fills `out` (allocated once with createFacePose) for the given explicit inputs. */
export function evaluateFacePose(input: FacePerformanceInput, calibration: FaceCalibration = DEFAULT_FACE_CALIBRATION, out: FacePose = createFacePose()): FacePose {
  const t = Number.isFinite(input.timeSeconds) ? input.timeSeconds : 0;
  const animated = input.reducedMotion !== true;
  const morphs = out.morphs;
  morphs.fill(0);
  let blink = animated ? blinkWeightAt(input.seed, t, input.blink ?? DEFAULT_BLINK_PROFILE) : 0;
  if (input.blinkOverride !== undefined && Number.isFinite(input.blinkOverride)) blink = Math.max(blink, clamp01(input.blinkOverride));
  let yaw = input.gaze ? input.gaze.yaw : 0, pitch = input.gaze ? input.gaze.pitch : 0;
  let brow = 0;
  if (animated) {
    const drift = gazeDriftAt(input.seed, t);
    yaw += drift.yaw; pitch += drift.pitch;
    if (input.sensitivity) {
      const glance = influenceGlanceAt(input.seed, t, input.sensitivity);
      yaw += glance.gaze.yaw; pitch += glance.gaze.pitch; brow = glance.browRaise;
    }
  }
  const g = clampGaze({ yaw, pitch }, calibration);
  if (input.expression && FACE_EXPRESSIONS[input.expression.name]) {
    const k = clamp01(input.expression.intensity);
    const preset = FACE_EXPRESSIONS[input.expression.name] as Readonly<Record<string, number>>;
    for (const name in preset) { const i = faceMorphIndex(name); if (i >= 0) morphs[i] = clamp01(morphs[i] + preset[name] * k); }
  }
  let jaw = 0;
  const talking = input.talking === true ? 1 : typeof input.talking === 'number' && Number.isFinite(input.talking) ? clamp01(input.talking) : 0;
  const visemes = input.visemes ?? (talking > 0 ? babbleVisemesAt(input.seed, t, talking) : undefined);
  for (const v of visemes ?? []) {
    if (v.viseme === 'sil' || !(v.weight > 0)) continue;
    const w = clamp01(v.weight);
    const i = faceMorphIndex('viseme_' + v.viseme);
    if (i >= 0) morphs[i] = clamp01(morphs[i] + w);
    jaw = Math.max(jaw, VISEME_JAW_OPEN[v.viseme] * w);
  }
  if (BROW_INNER >= 0) morphs[BROW_INNER] = clamp01(morphs[BROW_INNER] + brow);
  // Blinks come last so an expression cannot hold the eyes open.
  morphs[BLINK_L] = clamp01(Math.max(morphs[BLINK_L], blink));
  morphs[BLINK_R] = clamp01(Math.max(morphs[BLINK_R], blink));
  const expressionJaw = JAW >= 0 ? morphs[JAW] : 0;
  out.blink = blink; out.eyeYaw = g.yaw; out.eyePitch = g.pitch; out.headTurnSuggested = g.clamped;
  out.jawOpen = clamp01(Math.max(jaw, expressionJaw));
  const lidFollow = g.pitch * calibration.lidFollow;
  out.joints.eyeYaw = g.yaw;
  out.joints.eyePitch = g.pitch;
  out.joints.lidUpper = lidFollow + (calibration.upperLidClosed - lidFollow) * blink;
  out.joints.lidLower = lidFollow * 0.5 + (calibration.lowerLidClosed - lidFollow * 0.5) * blink;
  out.joints.jaw = out.jawOpen * calibration.jawOpen;
  return out;
}

export function validateFaceCalibration(c: FaceCalibration): string | null {
  const values = [c.eyeYawLimit, c.eyePitchUpLimit, c.eyePitchDownLimit, c.upperLidClosed, c.lowerLidClosed, c.lidFollow, c.jawOpen];
  if (!values.every(Number.isFinite)) return 'Calibration values must be finite.';
  if (!(c.eyeYawLimit > 0 && c.eyeYawLimit < 0.8 && c.eyePitchUpLimit > 0 && c.eyePitchUpLimit < 0.7 && c.eyePitchDownLimit > 0 && c.eyePitchDownLimit < 0.8)) return 'Eye limits must stay within anatomical ranges.';
  if (!(c.upperLidClosed > 0 && c.upperLidClosed < 1.2 && c.lowerLidClosed <= 0 && c.lowerLidClosed > -0.6)) return 'Lid closure must close the upper lid and raise the lower lid.';
  if (!(c.lidFollow >= 0 && c.lidFollow <= 1 && c.jawOpen > 0 && c.jawOpen < 0.6)) return 'Lid follow and jaw opening are out of range.';
  return null;
}
