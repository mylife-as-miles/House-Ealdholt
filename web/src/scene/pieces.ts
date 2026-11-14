import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import {
  ARMY_SKINS,
  DEFAULT_ARMY_SKINS,
  PIECE_MODEL_ORIENTATION,
  type ArmySkin,
  type ArmySkinId,
  type ArsenalId,
  type PieceAnimationSet,
} from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";
import { loadGltf } from "./gltfQueue";
import { isLightSquareAt, lightColour } from "./board";
import { BADGE_LIFT, BADGE_SCALE, CREST_REST, TOKEN_SCALE, crestPresence, rankBadgeTexture, tacticalTokenTexture } from "./rankBadges";
import { contactShadowTexture, groundLightTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";
import { armSculptWarmJobs, attachWeapons, type AttachedArms } from "./weapons";
import { LivingPieceRig } from "./livingPieceRig";
import { fadeMaterial } from "./figureFade";
import { carriedPatch } from "./armSurface";
import { UpperBodyLayer, type UpperPlay } from "./animation/upperBodyLayer";
import { chargeGuard, guardHandover, witnessGuard, type HeldGuard } from "./animation/layeredPose";
import { EMOTION_PROFILES } from "./battleEmotion";
import { ContactIK } from "./contactIK";
import { COMBAT_LIBRARY_V2_VERSION, loadCombatAnimationLibrary, sampleRootTravel, supportsCombatSource, type CombatAnimationLibrary, type CombatVariant, type AnimationMarker, type RootTravel } from "./combatAnimationLibrary";
import type { CombatSequence } from "../../../shared/play/combat-sequences";
import type { BoardReactionCue } from "./boardReactionDirector";
import { combatEventTime, installCombatEvents, plantedAt, retimedCombatEvent } from "./animationContacts";
import {
  CHAR_FRAGMENT_ALBEDO, CHAR_FRAGMENT_EMISSIVE, CHAR_FRAGMENT_MASK, CHAR_FRAGMENT_METALNESS, CHAR_FRAGMENT_PARS, CHAR_FRAGMENT_ROUGHNESS,
  CHAR_RIM_FACTOR, CHAR_VERTEX, CHAR_VERTEX_PARS, applyChar, clearChar, createCharUniforms, type CharState, type CharUniforms,
} from "./death/burn/charShader";
import {
  WOUND_FRAGMENT_ALBEDO, WOUND_FRAGMENT_MASK, WOUND_FRAGMENT_METALNESS, WOUND_FRAGMENT_NORMAL, WOUND_FRAGMENT_PARS, WOUND_FRAGMENT_ROUGHNESS,
  WOUND_VERTEX, applyWounds, clearWounds, createWoundUniforms, woundUvSet, woundVertexPars, type WoundUniforms,
} from "./gore/woundMaskShader";
import type { WoundBody, WoundWear } from "./gore/WoundMasks";
import { DownfallPose, type DownfallCast, type DownfallClock } from "./downfall/downfallPose";

/**
 * Rendered height (world units, 1 unit = 1 board square) per piece kind.
 *
 * A real chess set: the king and queen tower over everything else. Staunton
 * pieces run the king at about 1.9 times a pawn and the queen at about 1.7, and
 * so do these: 1.48 and 1.32 over the pawn's 0.78. At the old 1.12 and 1.0 the
 * queen stood level with her own bishops and rooks, and the royals did not read
 * at a glance. That holds for every army, whatever its sculpts' own sizes:
 * each is scaled to these heights.
 *
 * The officers keep the real order (bishop over knight over rook) inside one
 * band. A knight, a mage and a tower guardian are champions, not footsoldiers:
 * at their old 0.84-0.88 they sat close enough to the pawn to be mistaken for one,
 * so the band starts a fifth of a square above it.
 *
 * The footsoldier sits at 0.78 rather than 0.7: sixteen of the thirty-two figures
 * on the board are pawns, so they are what the hall mostly *is*, and at 0.7 a
 * man stood barely two thirds of the tile he occupied — he read as a token on his
 * square instead of a soldier holding it.
 */
/** How far a figure has formed (setFormation) before its props begin to form: about where its hands are. */
const PROP_FORM_FROM = 0.45;

export const PIECE_HEIGHT: Record<PieceKind, number> = {
  p: 0.78,
  r: 0.98,
  n: 1.0,
  b: 1.04,
  q: 1.32,
  k: 1.48,
};

export const FACTION_ACCENT: Record<Faction, number> = {
  w: 0x6ea8ff,
  b: 0xff5a4a,
};

/**
 * The two identity signals every figure carries, whatever army it is wearing.
 *
 * Skins alone cannot answer "whose is that?": when both sides muster the same
 * army the sculpts are identical, and when they muster *different* ones both
 * keep their own painted textures (see {@link applyFactionLook}) — so at camera
 * distance, in a torchlit hall, thirty-two dark figures read as one crowd. The
 * side is therefore stated twice, in two channels that fail differently:
 *
 *  - `ring` — the light the figure stands in: a faint wash and a thin band on
 *    the stone, in the side's colour *and its own shape* (see
 *    {@link groundLightTexture}), so the distinction survives even for a
 *    colour-blind player.
 *  - `rim` — a light that rides the silhouette's edge, so a figure is separable
 *    against the piece behind it and against the floor, not just above its feet.
 */
const FACTION_RING: Record<Faction, number> = {
  w: 0x5fb0ff,
  b: 0xff5230,
};

/** Shape of the band of light — the half of the signal that is not colour. */
const FACTION_RING_SHAPE: Record<Faction, "band" | "sunburst"> = {
  w: "band",
  b: "sunburst",
};

/** Edge light along the silhouette, in the army's colour. */
const FACTION_RIM: Record<Faction, number> = {
  w: 0x74baff,
  b: 0xff6134,
};

/**
 * How much of its light a figure stands in at rest. Enough to tell the sides
 * apart at a glance from where the game is played, without lighting the square
 * like a marker: selection and the check alarm still have room above it (see
 * {@link PieceView.update}).
 */
const RING_REST = 0.5;

/**
 * How the light under a figure falls on the two kinds of square.
 *
 * On a pale tile it is laid on the stone as light: what is drawn there is
 * multiplied by (1 + the light), not covered, so the tile's grain and joints
 * show through it and it takes the arena's own shading. A band painted over the
 * tile, however faint, reads as a sticker: it is the same flat colour on lit
 * stone and in shadow. `lift` is how far the band raises the stone (at 1 it
 * doubles it, in the side's colour). A pale tile raised only whitens, so the
 * light shows there as colour: `shift` comes off the colour before it
 * multiplies the stone, which draws the other channels down as the side's own
 * are raised (see TILE_RESPONSE in board.ts).
 *
 * A dark tile is four stops or more below a pale one, and the darkest boards
 * are close to black: there is nothing there to multiply. On dark stone the
 * light is added instead, `lift` being how much. That is what dark polished
 * stone does with a light: it has no colour of its own to show, only the
 * light's. It is faint, so it stays light on stone and not a painted band.
 */
const GROUND_LIGHT = {
  pale: { lift: 2.6, shift: 0.4 },
  dark: { lift: 0.17, shift: 0 },
};

/**
 * Drawn straight to the screen (no post-processing) the picture is already
 * display-encoded, where the same light shows far more: these bring it back to
 * about what it does in a linear buffer, for the multiplied light and the
 * added one.
 */
const GROUND_LIGHT_DIRECT = { pale: 0.25, dark: 0.12 };

/**
 * How hard the rim light rides the silhouette, and how tightly it hugs the edge
 * (the fresnel exponent, see {@link installDissolve}).
 *
 * These two numbers trade off, and the tight-and-faint end is the right one: a
 * broad, strong rim does not outline a uniform, it *repaints* it — the term is
 * added to the shaded colour, so at a low exponent it reaches well inside the
 * silhouette and drowns braid, facings and musket furniture in one flat hue. A
 * high exponent confines it to the grazing few degrees at the contour, which is
 * the only part that has to separate a figure from the piece behind it, and lets
 * the strength drop to a whisper while still reading. The sculpt's own paint
 * stays the thing you look at.
 */
const RIM_STRENGTH = 0.26;
const RIM_FALLOFF = 4.6;

/** Light that burns along the dissolving edge — one hue per civilisation. */
const DISSOLVE_EMBER: Record<Faction, number> = {
  w: 0xa8ccff,
  b: 0xff7a32,
};

/**
 * Shared uniform block driving one figure's burn-away and its faction rim light
 * across all of its materials — body and weapons alike.
 */
interface DissolveUniforms extends CharUniforms, WoundUniforms {
  uDissolve: { value: number };
  uDissolveEdge: { value: number };
  uDissolveScale: { value: number };
  /** (sole line, figure height) in the sculpt's own units. */
  uDissolveSpan: { value: THREE.Vector2 };
  uDissolveEmber: { value: THREE.Color };
  /** Faction edge light, in linear space (it is added after tone mapping). */
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
}

/** Cheap trilinear value noise — two octaves are enough for a burn edge. */
const DISSOLVE_NOISE = `
float dvHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float dvNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = dvHash(i);
  float n100 = dvHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = dvHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = dvHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = dvHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = dvHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = dvHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = dvHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

/**
 * Injects two things into a lit material: a noise burn-away, and the faction rim
 * light.
 *
 * The burn erodes the surface through a drifting noise field with a hot edge, so
 * a fallen figure comes apart into the air instead of blinking out.
 *
 * The rim is a fresnel term added *after* `opaque_fragment`, which is where the
 * shaded colour has just been written and tone mapping has not yet run — so the
 * edge light is graded with the rest of the frame instead of sitting on top of it
 * as a flat decal. It is what makes an army's silhouette readable against the
 * figure behind it, at any camera height, in a hall lit by torches.
 *
 * @param heightBias how much the burn sweeps from the soles upward (0 = even)
 */
function installDissolve(
  material: THREE.MeshStandardMaterial,
  uniforms: DissolveUniforms,
  heightBias: number,
  wounds: "uv" | "uv1" | null = null,
): void {
  const bias = heightBias.toFixed(3);
  // The wound mask (gore/woundMaskShader.ts) rides in the sculpt's patch only: a prop's UVs are not the body's.
  const wound = (chunk: string) => wounds ? chunk : "";
  // A patch the material came with (a merged prop's per-part surface, armSurface.ts) is kept: made after this one,
  // so its lines sit next to three's own chunks, ahead of the char and wound lines added here.
  const carried = carriedPatch(material);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 vDissolveP;\nvarying vec3 vRimView;\n${CHAR_VERTEX_PARS}\n${wounds ? woundVertexPars(wounds) : ""}`,
      )
      .replace("#include <skinning_vertex>", `${wound(WOUND_VERTEX)}\n#include <skinning_vertex>`)
      .replace(
        "#include <project_vertex>",
        `vDissolveP = transformed;
vRimView = -(modelViewMatrix * vec4(transformed, 1.0)).xyz;
${CHAR_VERTEX}
#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uDissolve;
uniform float uDissolveEdge;
uniform float uDissolveScale;
uniform vec2 uDissolveSpan;
uniform vec3 uDissolveEmber;
uniform vec3 uRimColor;
uniform float uRimStrength;
varying vec3 vDissolveP;
varying vec3 vRimView;
${DISSOLVE_NOISE}
${CHAR_FRAGMENT_PARS}
${wound(WOUND_FRAGMENT_PARS)}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float dvGlow = 0.0;
if (uDissolve > 0.001) {
  vec3 dvP = vDissolveP * uDissolveScale;
  float dvN = dvNoise(dvP) * 0.65 + dvNoise(dvP * 2.7 + 11.3) * 0.35;
  float dvH = clamp((vDissolveP.y - uDissolveSpan.x) / max(uDissolveSpan.y, 0.0001), 0.0, 1.0);
  float dvMask = mix(dvN, dvN * 0.45 + dvH * 0.55, ${bias});
  float dvCut = mix(-uDissolveEdge, 1.0 + uDissolveEdge, uDissolve);
  if (dvMask < dvCut) discard;
  dvGlow = (1.0 - smoothstep(0.0, uDissolveEdge * 1.6, dvMask - dvCut)) *
           smoothstep(0.0, 0.06, uDissolve);
}
${CHAR_FRAGMENT_MASK}
${wound(WOUND_FRAGMENT_MASK)}`,
      )
      // The char (death/burn/charShader.ts) rides in this one patch: skipped entirely while uCharFront is 0. The
      // wounds come before it in each chunk, so a husk chars over them; they are skipped while uWoundOn is 0.
      .replace("#include <color_fragment>", `#include <color_fragment>\n${wound(WOUND_FRAGMENT_ALBEDO)}\n${CHAR_FRAGMENT_ALBEDO}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${wound(WOUND_FRAGMENT_ROUGHNESS)}\n${CHAR_FRAGMENT_ROUGHNESS}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${wound(WOUND_FRAGMENT_METALNESS)}\n${CHAR_FRAGMENT_METALNESS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${wound(WOUND_FRAGMENT_NORMAL)}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${CHAR_FRAGMENT_EMISSIVE}`)
      .replace(
        "#include <opaque_fragment>",
        `float rimFacing = 1.0 - clamp(dot(normalize(normal), normalize(vRimView)), 0.0, 1.0);
float rimAmount = pow(rimFacing, ${RIM_FALLOFF.toFixed(1)}) * uRimStrength * (1.0 - uDissolve) * ${CHAR_RIM_FACTOR};
#include <opaque_fragment>
gl_FragColor.rgb += uRimColor * rimAmount;
gl_FragColor.rgb += uDissolveEmber * dvGlow * 3.2;`,
      );
    carried?.apply(shader);
  };
  // Two materials with identical parameters but different injected source would
  // otherwise share one compiled program. Wearing a wound or not changes no source, only uniforms.
  const key = `${carried ? `${carried.key}|` : ""}dissolve-char-${bias}${wounds ? `-wound-${wounds}` : ""}`;
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
}

const AXIS_VECTORS = {
  positiveX: new THREE.Vector3(1, 0, 0),
  negativeX: new THREE.Vector3(-1, 0, 0),
  positiveY: new THREE.Vector3(0, 1, 0),
  negativeY: new THREE.Vector3(0, -1, 0),
  positiveZ: new THREE.Vector3(0, 0, 1),
  negativeZ: new THREE.Vector3(0, 0, -1),
} as const;

type AxisName = keyof typeof AXIS_VECTORS;

function basisQuaternion(front: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = front.clone().normalize();
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}

/**
 * Rotates a generated model so its classified local front axis points along
 * `desiredWorldForward` while its local up axis stays world up.
 */
function orientationCorrection(desiredWorldForward: THREE.Vector3): THREE.Quaternion {
  const local = basisQuaternion(
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localFrontAxis as AxisName],
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localUpAxis as AxisName],
  );
  const world = basisQuaternion(desiredWorldForward, new THREE.Vector3(0, 1, 0));
  return world.multiply(local.invert());
}

/** Bounds as actually rendered, skinning-aware (see three-js asset guide). */
function measureModel(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  const rootInverse = object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const childBox = new THREE.Box3();
  const toRoot = new THREE.Matrix4();
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = node as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update();
      skinned.computeBoundingBox();
      childBox.copy(skinned.boundingBox ?? new THREE.Box3());
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      childBox.copy(mesh.geometry.boundingBox ?? new THREE.Box3());
    }
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    box.union(childBox.applyMatrix4(toRoot));
  });
  return box;
}

/** Skeletal clips a figure can play, all bound to the same auto-rig. */
export interface PieceClips {
  idle?: THREE.AnimationClip;
  attack?: THREE.AnimationClip;
  death?: THREE.AnimationClip;
  /** Looping in-place stride used to cross the board on foot. */
  walk?: THREE.AnimationClip;
  /** Looping in-place run — the knight charging through its leap. */
  run?: THREE.AnimationClip;
  /**
   * One-shot drill played after a shot is fired. Only the gunpowder army
   * carries it — a swordsman has nothing to reload.
   */
  reload?: THREE.AnimationClip;
  /**
   * Looping sight picture: the barrel up and levelled on a body, held while the
   * shooter settles. Only the gunpowder army carries one — it is what makes a
   * shot read as aimed rather than as a flash appearing out of a stance.
   */
  aim?: THREE.AnimationClip;
  /**
   * One-shot stance change between one knee and both feet. Authored kneeling to
   * standing, and played in both directions: forwards to come up off the knee,
   * backwards to go down onto it (see {@link PieceView.playKneel} and
   * {@link PieceView.playRise}). Only a figure that fights from a kneel has one.
   */
  rise?: THREE.AnimationClip;
}

export type ClipName = keyof PieceClips;

/**
 * Every clip a rig can carry, in the order the game needs them. The strides
 * come straight after the stance: the first thing any game does is *move* a
 * figure, and a stride that has not landed yet costs that move its legs. The
 * strikes and deaths sit behind them because a capture asks for those by name
 * before it plays (see {@link PieceFactory.ensureClip}), so they can never be
 * missed — a stride, until now, could be.
 */
export const CLIP_ORDER: ClipName[] = ["idle", "walk", "run", "attack", "death", "reload", "aim", "rise"];

/**
 * How much of the rise clip is the man actually getting up.
 *
 * Measured on the hips of the marksman's take: it opens on the knee at 48 units
 * and is standing at full height (92) by the 70% mark, after which it holds
 * still. Playing or reversing the whole 2.6s would therefore spend a third of
 * the beat on a figure that has already finished moving — so both directions run
 * over this span of it and the dead tail is never shown.
 */
const RISE_SPAN = 0.72;

/**
 * Fetched together with the rig itself. Everything else is pulled in afterwards
 * (see {@link PieceFactory.warmClips}) so the opening does not fire seventy
 * requests at once — that burst is what used to cost figures their strike.
 */
const OPENING_CLIPS: ClipName[] = ["idle"];

/** The two locomotion loops, as opposed to the stance and the one-shots. */
export type MarchClip = "walk" | "run";

interface Template {
  scene: THREE.Object3D;
  scale: number;
  offset: THREE.Vector3;
  skinned: boolean;
  clips: PieceClips;
  /** Figure height in the sculpt's own units — the weapon size reference. */
  unit: number;
  /** Sole line in the sculpt's own units, so props can be kept off the floor. */
  baseY: number;
  /**
   * True when the sculpt was authored for this exact army. Those keep their own
   * painted textures; shared sculpts are re-tinted into faction livery instead.
   */
  ownLivery: boolean;
  /** Weapon family the figure is armed from. */
  arsenal: ArsenalId;
  /** Authored combat library baked for this exact rig, when there is one. */
  combat?: string;
}

/**
 * Which authored combat library (web/src/assets/chess/combat-v2, with the
 * combat-v1 clips it has no namesake of) fits which rig. The libraries were
 * baked from two skeletons: "wp" from the Aethelgard
 * Pawn and "bp" from the Solforiz Pawn. They follow the army a side fields,
 * whichever side of the board that is.
 */
const COMBAT_ARCHETYPES: Partial<Record<ArmySkinId, Partial<Record<PieceKind, string>>>> = {
  // Knights, Rooks and Kings fight on their own rank libraries (combat-ranks, one per figure's rig; combat/rankDuel.ts
  // `RANK_ARCHETYPES` names the same ones). Korvenia's Rook and King fight with powder and have none.
  ivory: { p: "wp", n: "wn", r: "wr", k: "wk" },
  sun: { p: "bp", n: "bn", r: "br", k: "bk" },
  empire: { p: "ep", n: "en" },
  kwind: { p: "kp", n: "kn", r: "kr", k: "kk" },
};

export interface PieceVisualOptions {
  contactShadows: boolean;
  /** Loop the combat stance. One-shots (strike / death) always play. */
  idleAnimation?: boolean;
  /** Floating rank crest above the figure's head. */
  rankBadge?: boolean;
  /** Secondary skeletal reactions; disabled for reduced motion/title art. */
  dynamicMotion?: boolean;
}

/** The crown: king and queen move slower and stand taller than the soldiery. */
const ROYAL_KINDS: PieceKind[] = ["k", "q"];

/**
 * Target playback lengths. Soldiers snap through their strike; royalty takes a
 * long, deliberate beat so the blow reads as a sentence, not a scuffle.
 */
function oneShotSeconds(kind: PieceKind, name: OneShot): number {
  const royal = ROYAL_KINDS.includes(kind);
  if (name === "attack") return royal ? 1.5 : 0.95;
  // The drill is never hurried: powder, ball, ramrod, back to the shoulder.
  if (name === "reload") return royal ? 1.25 : 1.05;
  return royal ? 1.15 : 0.85;
}

/** How far an unauthored strike clip may be drawn toward its target (0..1 of the solve). */
const STRIKE_CONTACT_WEIGHT = 0.45;
/** In a directed duel a planted foot is re-set by a step once the pose wants it this far from where it stands (world units). */
const DUEL_RESTEP = 0.15;
/** The stance a duellist returns to between clips (combat-v2's shield guard, a loop). */
const DUEL_GUARD = "ready.guard";
/** A step clip may be played this much off its own speed, and carried this much short of or past its own travel. */
const TRAVEL_RATE = { min: 0.8, max: 1.35 } as const;
const TRAVEL_STRETCH = { min: 0.35, max: 1.6 } as const;
/** Board units between two fighters within which a strike counts as hand-to-hand. */
const STRIKE_CONTACT_RANGE = 1.25;

/** Clips that play once and hand the body back to its stance afterwards. */
type OneShot = "attack" | "death" | "reload";

/** Measured stride period per clip, so a clip is only ever analysed once. */
const GAIT_PERIODS = new WeakMap<THREE.AnimationClip, number>();

/** Leg bones, in the order they answer the question "how long is one stride?". */
const LEG_BONES = [/upleg/i, /thigh/i, /(^|[^a-z])leg/i, /foot/i];

/**
 * Length of **one** stride cycle (two footfalls) inside a locomotion clip, in
 * seconds.
 *
 * The generator does not hand back one cycle per clip: `spear-walk` is a single
 * 1.13s cycle, but `casual-walk` is 4.23s of *three* cycles, `confident-strut`
 * 2.7s of two and `sneaky-walk` 2.9s of two and a half. Retiming a clip as if
 * its whole length were one cycle therefore asked the mixer for a 3-4x time
 * scale, which saturated the ceiling in {@link PieceView.startMarch}: the legs
 * whirred at a fixed blur no matter how far the figure was going, out of step
 * with the footfall clock, and the march stopped reading as walking at all.
 * The heavy ranks felt it worst — king, queen and tower all march on
 * `casual-walk`.
 *
 * The period is read out of the clip itself (autocorrelation of a leg bone's
 * swing) so a swapped-in stride is measured rather than guessed, and cached
 * per clip because the answer never changes.
 */
function gaitCycle(clip: THREE.AnimationClip): number {
  const cached = GAIT_PERIODS.get(clip);
  if (cached !== undefined) return cached;
  const period = measureGaitCycle(clip);
  GAIT_PERIODS.set(clip, period);
  return period;
}

function measureGaitCycle(clip: THREE.AnimationClip): number {
  const track = findLegTrack(clip);
  // Nothing leg-shaped to read: treat the clip as the single cycle it usually is.
  if (!track || track.times.length < 12) return clip.duration;

  // Signal: how far the leg has swung away from its first frame. One walk cycle
  // brings it back, so the signal's period is the stride's period.
  const frames = track.times.length;
  const signal = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let dot = 0;
    for (let c = 0; c < 4; c += 1) dot += track.values[i * 4 + c] * track.values[c];
    signal[i] = 2 * Math.acos(Math.min(1, Math.abs(dot)));
  }

  let mean = 0;
  for (const value of signal) mean += value;
  mean /= frames;
  let energy = 0;
  for (let i = 0; i < frames; i += 1) {
    signal[i] -= mean;
    energy += signal[i] * signal[i];
  }
  // A leg that never swings (a clip driving something other than a gait).
  if (energy < 1e-6) return clip.duration;

  // Autocorrelation, taken at the first peak *after* the curve has fallen away
  // from lag zero — the global maximum would happily answer with two strides.
  const limit = Math.floor(frames * 0.8);
  const correlation = new Float32Array(limit);
  for (let lag = 0; lag < limit; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < frames; i += 1) {
      sum += signal[i] * signal[i + lag];
      count += 1;
    }
    correlation[lag] = sum / count / (energy / frames);
  }
  let lag = 1;
  while (lag < limit && correlation[lag] > 0.1) lag += 1;
  let period = 0;
  for (; lag < limit - 1; lag += 1) {
    if (correlation[lag] > correlation[lag - 1] && correlation[lag] >= correlation[lag + 1]) {
      if (correlation[lag] > 0.55) period = lag;
      break;
    }
  }
  if (period <= 0) return clip.duration;

  const step = (track.times[frames - 1] - track.times[0]) / (frames - 1);
  const seconds = period * step;
  // A period within a hair of the whole clip is the whole clip; anything shorter
  // than a third of a second is noise, not a stride.
  if (seconds < 0.3 || seconds > clip.duration * 0.8) return clip.duration;
  return seconds;
}

/** The most swing-heavy leg track in a clip: upper leg first, toes last. */
function findLegTrack(clip: THREE.AnimationClip): THREE.QuaternionKeyframeTrack | null {
  for (const pattern of LEG_BONES) {
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      if (track.values.length / 4 !== track.times.length) continue;
      if (pattern.test(track.name)) return track as THREE.QuaternionKeyframeTrack;
    }
  }
  return null;
}

/**
 * One rendered figure. Follows the placement contract:
 * container (board placement) → runtime (idle sway, strikes) → visual
 * (one-time scale / orientation / centring of the generated sculpt).
 */
export class PieceView implements WoundBody {
  readonly container = new THREE.Group();
  readonly runtime = new THREE.Group();
  readonly visual = new THREE.Group();
  readonly kind: PieceKind;
  readonly color: Faction;
  /** Weapon family this figure was armed from — the fight reads its style off it. */
  readonly arsenal: ArsenalId;

  private materials: THREE.MeshStandardMaterial[] = [];
  private baseEmissive = 0.05;
  private glow: THREE.Mesh;
  private shadow: THREE.Mesh | null = null;
  /** The side's light, linear with its strongest channel at 1 (see {@link GROUND_LIGHT}). */
  private readonly groundTint: [number, number, number];
  /** Whether the tile underfoot is a pale one, and how far the ground light has come up on it. */
  private groundPale = true;
  private groundLift = 0;
  /**
   * The height on screen of one board square stood on end where this figure is, as a fraction of the picture's
   * height, and whether that picture is the screen itself. Both are read as the ground light is drawn: that is the
   * one moment a figure learns which camera is looking at it. Starts large, so a crest waits to be told its figure
   * is small before it shows.
   */
  private screenUnit = 1;
  private drawnDirect = false;
  private phase = Math.random() * Math.PI * 2;
  private hovered = false;
  private selected = false;
  private alarm = 0;
  /** 1 right after a blow lands, decaying — drives the red hit flash. */
  private hit = 0;
  /** 1 right after the figure sets down, decaying — flares the ground aura. */
  private aura = 0;
  /** Set once the death clip starts so nothing pulls the corpse back up. */
  private slain = false;
  /** True while the clips are stopped where they are (holdPose). */
  private poseHeld = false;
  /** Resting orientation (facing the enemy side) to return to after a fight. */
  private homeFacing = new THREE.Quaternion();
  /**
   * Invisible pick proxy. Raycasting the sculpt itself is both slow (tens of
   * thousands of skinned triangles per figure) and unreliable, so every figure
   * carries one cheap box that stands exactly on its square.
   */
  private readonly collider: THREE.Mesh;

  private arms: AttachedArms | null = null;
  private readonly majestic: boolean;

  /** Every mesh of the sculpt and its arms — shadows are pulled while burning. */
  private meshes: THREE.Mesh[] = [];
  /** 0 solid → 1 fully scattered. Drives the burn-away shader. */
  private dissolveAmount = 0;
  private readonly dissolveUniforms: DissolveUniforms;
  /** True while a burn's char is written into the uniform block (see {@link setChar}). */
  private charred = false;
  /** The sculpt's own meshes, without its props: what wears the wound mask (see {@link wearWounds}). */
  private readonly sculpt: THREE.Mesh[] = [];
  /** Told when the figure drops the mask it wears by itself (it stands again in the tray, or is freed). */
  private woundLost: (() => void) | null = null;
  /** The props' burn: the body's uniforms but their own amount, so they can form after it (setFormation). */
  private propDissolve: DissolveUniforms | null = null;

  /**
   * Flat overhead counter used by the tactical view. Built the first time the
   * board is flattened, then kept for the rest of the figure's life.
   */
  private token: THREE.Mesh | null = null;
  private tokenMaterial: THREE.MeshBasicMaterial | null = null;
  /** True while the board is read from straight above as a 2D map. */
  private flat = false;
  /** Ease between sculpt and counter, so the swap is not a hard cut. */
  private tokenFade = 0;
  /** In-plane spin that keeps the stamped rank upright on screen. */
  private tokenYaw = 0;

  /** Floating rank crest; billboards itself because it is a sprite. */
  private badge: THREE.Sprite | null = null;
  private badgeWanted = true;
  private badgeOpacity = 0;
  /** Title tableau: no team aura or floating rank label, stronger grounding. */
  private presentationLook = false;
  /** Global fade applied by the tray / death choreography. */
  private fade = 1;

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private activeOneShot: string | null = null;
  private readonly variants = new Map<string, CombatVariant>();
  private readonly combatVersions = new Map<string, ReadonlyMap<string, CombatVariant>>();
  private combatLibraryVersion: string | null = null;
  private contactIK: ContactIK | null = null;
  private combatTarget: PieceView | null = null;
  private combatSequence: CombatSequence | undefined;
  private combatDefender = false;
  private contactAim: "shield" | "weapon" | null = null;
  private travelling = false;
  private guarding = false;
  private readonly guardThreat = new THREE.Vector3();
  private readonly ikGoal = new THREE.Vector3();
  private readonly shieldGoal = new THREE.Vector3();
  private readonly shieldThreat = new THREE.Vector3();
  private readonly contactOrigin = new THREE.Vector3();
  private readonly contactForward = new THREE.Vector3();
  /**
   * Clip-local time at which the ordinary strike clip lands, or null when the
   * strike is an authored variant (which carries its own markers) or a shot.
   */
  private strikeContactTime: number | null = null;
  private idleLooping = false;
  /** Locomotion loop currently carrying the figure across the board. */
  private marchLoop: MarchClip | null = null;
  /** Footfalls a second the current march is being walked at. */
  private marchRate = 0;
  /** True while the figure is holding its aim on a body. */
  private aiming = false;
  /** Root bone + its bind translation, used to strip clip root motion. */
  private rootBone: THREE.Bone | null = null;
  private rootRest = new THREE.Vector3();
  private lockRootMotion = true;
  /** How firmly the root is held over the square right now, 0 to 1 (see {@link holdRoot}). */
  private rootHold = 1;
  /** Whether this figure is allowed to loop its stance (quality setting). */
  private idleWanted = true;
  /**
   * Body tilt held by a hand-driven strike. The mixer rewrites the runtime
   * rotation every frame, so a procedural swing has to be re-applied after it —
   * without this a figure whose attack clip is missing only slid forward.
   */
  private strikeTilt = 0;
  private readonly livingRig: LivingPieceRig;
  /**
   * Upper-body clips over whatever the legs are doing (animation/upperBodyLayer.ts): a killer's guard on the last
   * steps of its charge, a witness's guard over planted feet. Null on a rig it cannot split.
   */
  private upper: UpperBodyLayer | null = null;
  /** The id of the clip the upper layer was last asked to play. */
  private upperId: string | null = null;
  /** The guard the upper layer holds for a fight, and how it was chosen (see raiseGuard). */
  private guardHeld: HeldGuard | null = null;
  private dynamicWanted = false;
  /** Its part in the downfall (scene/downfall/downfallPose.ts), once the game has ended in one. */
  private downfall: DownfallPose | null = null;
  /** The held frame of the stance a beaten figure stops in (holdStance). */
  private stillStance: THREE.AnimationAction | null = null;
  /** The weapons this figure has let fall: they lie on the stone, kept by the figure so they go with it. */
  private fallenRoot: THREE.Group | null = null;
  /** 0..1: how far its ring, crest, rim and glow have faded in the downfall. */
  private insignia = 0;
  /** Its materials' own colour and reflection, kept while the light on it falls (setDownfallLight). */
  private unshaded: { colors: THREE.Color[]; env: number[] } | null = null;
  /** How a Combat Director fight wants this figure's hit and death played (see {@link setCombatReaction}). */
  private reaction: { fade: number; hit?: string; death?: string; deathRate: number; deathFrom: number; deathFloor?: number; rootLimit: number | null } = { fade: .08, deathRate: 1, deathFrom: 0, rootLimit: null };
  /** True while the shield is asked to meet the opponent's incoming weapon line rather than just cover the chest. */
  private meetingWeapon = false;
  /** The guard's weight on the shield arm, eased so a dropped guard does not snap the arm back. */
  private guardEase = 0;
  private frameDelta = 1 / 60;
  /**
   * Clips whose pelvis travels across the floor (combat-v2 steps, dodges and
   * blocks). The figure is moved by the newest one while it is the clip being
   * played; every one that still has weight has its travel taken back out of
   * the pelvis, so the body is carried by the figure and never twice.
   */
  private readonly rootTravels: { id: string; action: THREE.AnimationAction; travel: RootTravel; from: THREE.Vector3; to: THREE.Vector3; driving: boolean }[] = [];
  private readonly travelSample = { x: 0, z: 0, progress: 0 };

  constructor(
    kind: PieceKind,
    color: Faction,
    model: THREE.Object3D,
    options: PieceVisualOptions,
    clips: PieceClips = {},
    unit = 1,
    baseY = 0,
    ownLivery = false,
    arsenal: ArsenalId = "kingdom",
  ) {
    this.kind = kind;
    this.color = color;
    this.arsenal = arsenal;
    this.majestic = ROYAL_KINDS.includes(kind);

    this.container.name = `piece_${color}${kind}`;
    this.container.add(this.runtime);
    this.runtime.add(this.visual);
    this.visual.add(model);
    this.container.userData.piece = this;

    this.collider = new THREE.Mesh(sharedColliderGeometry(kind), sharedColliderMaterial());
    this.collider.position.y = PIECE_HEIGHT[kind] * 0.55;
    this.collider.castShadow = false;
    this.collider.receiveShadow = false;
    this.collider.userData.piece = this;
    this.container.add(this.collider);

    const span = Math.max(unit, 1e-3);
    this.dissolveUniforms = {
      uDissolve: { value: 0 },
      uDissolveEdge: { value: 0.14 },
      // Roughly ten noise cells across the body, whatever units it was authored in.
      uDissolveScale: { value: 10 / span },
      uDissolveSpan: { value: new THREE.Vector2(baseY, span) },
      uDissolveEmber: { value: new THREE.Color(DISSOLVE_EMBER[color]) },
      uRimColor: { value: new THREE.Color(FACTION_RIM[color]).convertSRGBToLinear() },
      uRimStrength: { value: RIM_STRENGTH },
      ...createCharUniforms(),
      ...createWoundUniforms(),
    };

    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) shadowAsSkinned(mesh);
      mesh.userData.piece = this;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      applyFactionLook(material, color, ownLivery);
      applyPaintRelief(material);
      // The sculpt wears the wound mask in its UV space; a mesh without UVs cannot.
      const uv = mesh.geometry.getAttribute("uv") ? woundUvSet(!!mesh.geometry.getAttribute("uv1")) : null;
      installDissolve(material, this.dissolveUniforms, 0.85, uv);
      mesh.material = material;
      this.materials.push(material);
      this.meshes.push(mesh);
      if (uv) this.sculpt.push(mesh);
    });

    // Light on the stone, not paint: on a pale tile the blend multiplies the tile by (1 + this), so the band is
    // the tile itself in the side's colour. Its colour, and on a dark tile its blend, follow the tile underfoot
    // (see update).
    this.groundTint = lightColour(FACTION_RING[color]);
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: sharedRingTexture(color),
      transparent: true,
      opacity: RING_REST,
      depthWrite: false,
      // The picture's alpha is its strength: multiplied into the colour here, since this blend ignores alpha.
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      // A factor, not a colour: it must not be run through a tone curve.
      toneMapped: false,
    });
    this.glow = new THREE.Mesh(sharedDiscGeometry(), glowMaterial);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.012;
    this.glow.renderOrder = 3;
    this.glow.onBeforeRender = (renderer, _scene, camera) => {
      const view = camera.matrixWorldInverse.elements;
      const at = this.glow.matrixWorld.elements;
      const depth = -(view[2] * at[12] + view[6] * at[13] + view[10] * at[14] + view[14]);
      const lens = 0.5 * camera.projectionMatrix.elements[5];
      this.screenUnit = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (depth > 0.01 ? lens / depth : 1) : lens;
      this.drawnDirect = renderer.getRenderTarget() === null;
    };
    this.container.add(this.glow);

    if (options.contactShadows) {
      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: sharedShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      this.shadow = new THREE.Mesh(sharedDiscGeometry(), shadowMaterial);
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.006;
      this.shadow.scale.setScalar(0.85);
      this.shadow.renderOrder = 1;
      this.container.add(this.shadow);
    }

    this.badgeWanted = options.rankBadge !== false;
    this.buildBadge();

    this.livingRig = new LivingPieceRig(this.visual, model, this.phase);
    this.dynamicWanted = options.dynamicMotion === true;
    this.livingRig.setEnabled(this.dynamicWanted);
    this.setupAnimations(model, clips, options.idleAnimation !== false);
    this.equipArms(model, unit, baseY, arsenal);
    this.contactIK = new ContactIK(this.container, model, this.arms?.contact ?? null, this.arms?.shield ?? null);
    this.contactIK.setEnabled(this.dynamicWanted);
  }

  /** Crest sprite, parked just above the figure's crown. */
  private buildBadge(): void {
    const material = new THREE.SpriteMaterial({
      map: rankBadgeTexture(this.kind, this.color),
      transparent: true,
      // The crest is a small piece of worked metal hung over its figure, so whatever stands in front of it hides
      // it like anything else in the arena. Drawn through everything it read as a label stuck on the screen. From
      // where the game is played nothing stands between the camera and a crest.
      depthTest: true,
      depthWrite: false,
      opacity: 0,
      sizeAttenuation: true,
    });
    const badge = new THREE.Sprite(material);
    badge.scale.setScalar(BADGE_SCALE[this.kind]);
    badge.position.y = PIECE_HEIGHT[this.kind] + BADGE_LIFT;
    badge.renderOrder = 40;
    badge.visible = this.badgeWanted;
    badge.frustumCulled = false;
    this.badge = badge;
    this.container.add(badge);
  }

  /** Board-wide toggle for the floating crests. */
  setBadgeEnabled(enabled: boolean): void {
    this.badgeWanted = enabled;
    if (!this.badge) return;
    this.badge.visible = enabled && !this.slain;
    if (!enabled) {
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  setPresentationLook(active: boolean): void {
    this.presentationLook = active;
    this.glow.visible = !active && !this.slain && !this.flat;
    if (this.shadow) {
      this.shadow.visible = !this.slain && !this.flat;
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = (active ? 0.38 : 0.55) * this.fade;
      this.shadow.scale.set(active ? 0.95 : 0.85, active ? 0.72 : 0.85, 1);
    }
    if (active) {
      this.setHovered(false);
      this.setSelected(false);
    }
  }

  // ------------------------------------------------------------ tactical view

  /**
   * Swaps the sculpt for a flat overhead counter. In the top-down view a
   * life-size figure hides the squares around it, so the tactical board trades
   * every statue for a painted disc lying on its tile.
   */
  setFlat(enabled: boolean): void {
    if (this.flat === enabled) return;
    this.flat = enabled;
    this.contactIK?.setEnabled(this.dynamicWanted && !enabled);
    this.livingRig.setEnabled(this.dynamicWanted && !enabled);
    if (enabled && !this.token) this.buildToken();
    this.visual.visible = !enabled;
    if (this.fallenRoot) this.fallenRoot.visible = !enabled;
    if (this.shadow) this.shadow.visible = !enabled;
    if (this.badge) this.badge.visible = !enabled && this.badgeWanted && !this.slain;
    if (this.token) this.token.visible = enabled;
    // A strike frozen mid-clip while the board was flat has to be released.
    if (!enabled && !this.slain && this.mixer) this.returnToStance(0.2);
  }

  /** Screen-up direction, in board yaw — keeps every stamped rank readable. */
  setTokenYaw(yaw: number): void {
    this.tokenYaw = yaw;
  }

  private buildToken(): void {
    const material = new THREE.MeshBasicMaterial({
      map: tacticalTokenTexture(this.kind, this.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // The counter is an instrument, not lit stone: keep it out of the grade.
      toneMapped: false,
    });
    const token = new THREE.Mesh(sharedTokenGeometry(), material);
    token.rotation.x = -Math.PI / 2;
    token.position.y = 0.055;
    token.scale.setScalar(TOKEN_SCALE[this.kind]);
    token.renderOrder = 12;
    token.frustumCulled = false;
    token.visible = false;
    this.token = token;
    this.container.add(token);
    this.tokenMaterial = material;
  }

  private updateToken(delta: number, alarmPulse: number): void {
    const token = this.token;
    const material = this.tokenMaterial;
    if (!token || !material) return;

    if (this.flat) this.tokenFade = Math.min(1, this.tokenFade + delta * 5);
    else this.tokenFade = Math.max(0, this.tokenFade - delta * 7);

    token.visible = this.tokenFade > 0.01;
    if (!token.visible) return;

    token.rotation.z = this.tokenYaw;
    const settle = this.aura * this.aura;
    const pop =
      1 + (this.selected ? 0.14 : this.hovered ? 0.07 : 0) + alarmPulse * 0.2 + settle * 0.16;
    token.scale.setScalar(TOKEN_SCALE[this.kind] * pop * this.tokenFade);
    token.position.y = 0.055 + (this.selected ? 0.05 : 0);

    // Blows and the check alarm burn straight through the plate.
    const heat = Math.min(1, this.hit * this.hit + alarmPulse * 0.7);
    material.color.setRGB(1 + heat * 1.1, 1 - heat * 0.5, 1 - heat * 0.6);
    material.opacity = this.tokenFade * this.fade * (1 - this.dissolveAmount);
  }

  private updateBadge(delta: number, elapsed: number, alarmPulse: number): void {
    const badge = this.badge;
    if (!badge) return;
    const wanted = this.badgeWanted && !this.slain && !this.flat;
    if (!wanted) {
      badge.visible = false;
      return;
    }

    // At rest a crest shows only over an officer drawn too small to be known by its shape (see crestPresence).
    // A pawn is known by its size and its place in the line, and its crest hung in front of the officer behind
    // it. The selected figure, the one under the pointer and a king in check always show theirs.
    const called = this.selected || this.hovered || this.alarm > 0;
    // A beaten army's crests fade as it falls (setDownfallLight).
    const target = (called ? 1 : this.kind === "p" ? 0 : crestPresence(this.screenUnit) * CREST_REST) * (1 - 0.86 * this.insignia);
    this.badgeOpacity += (target - this.badgeOpacity) * Math.min(1, delta * 6);
    // A crest that is out is not drawn at all.
    badge.visible = this.badgeOpacity > 0.01;
    if (!badge.visible) return;
    const material = badge.material as THREE.SpriteMaterial;
    material.opacity = this.badgeOpacity * this.fade;

    // It hangs still when motion is reduced, and barely stirs otherwise.
    const bob = this.dynamicWanted ? Math.sin(elapsed * 1.5 + this.phase) * 0.01 : 0;
    // A kneeling figure's crest comes down with its head rather than hanging where it stood.
    badge.position.y =
      PIECE_HEIGHT[this.kind] * (1 - 0.36 * (this.downfall?.sink ?? 0)) + BADGE_LIFT + bob + (this.selected ? 0.04 : 0);
    const pop = 1 + (this.selected ? 0.16 : this.hovered ? 0.1 : 0) + alarmPulse * 0.1;
    badge.scale.setScalar(BADGE_SCALE[this.kind] * pop);
  }

  /**
   * Hands the figure its weapon once the stance pose is settled, so the prop is
   * aligned against the pose the player actually sees.
   */
  private equipArms(model: THREE.Object3D, unit: number, baseY: number, arsenal: ArsenalId): void {
    try {
      this.mixer?.update(0);
      const arms = attachWeapons(model, this.kind, this.color, unit, baseY, arsenal);
      this.arms = arms;
      for (const mesh of arms.meshes) mesh.userData.piece = this;
      // Props hang off bones, so they burn on the same clock but without the
      // ground-up sweep — their local space is not the figure's. They share every
      // uniform but the amount, which setFormation may hold back.
      this.propDissolve = { ...this.dissolveUniforms, uDissolve: { value: this.dissolveUniforms.uDissolve.value } };
      for (const material of arms.materials) installDissolve(material, this.propDissolve, 0);
      this.meshes.push(...arms.meshes);
    } catch (error) {
      console.warn(`[pieces] could not arm "${this.kind}"`, error);
    }
  }

  private setupAnimations(model: THREE.Object3D, clips: PieceClips, idleEnabled: boolean): void {
    const entries = (Object.keys(clips) as ClipName[]).filter((name) => clips[name]);
    this.idleWanted = idleEnabled;

    let rigged = false;
    model.traverse((node) => {
      const bone = node as THREE.Bone;
      if (bone.isBone) {
        rigged = true;
        if (!this.rootBone) {
          this.rootBone = bone;
          this.rootRest.copy(bone.position);
        }
      }
      const skinned = node as THREE.SkinnedMesh;
      // Skinned bounds change every frame; culling them by the bind pose pops.
      if (skinned.isSkinnedMesh) {
        rigged = true;
        skinned.frustumCulled = false;
      }
    });

    // A rig with no clips yet still gets its mixer: the combat clips arrive in
    // the background and are bound onto this figure as they land.
    if (!rigged && entries.length === 0) return;

    this.mixer = new THREE.AnimationMixer(model);
    const layer = new UpperBodyLayer(model);
    this.upper = layer.usable ? layer : null;
    for (const name of entries) {
      const clip = clips[name];
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(name, action);
    }

    // A finished strike returns to the stance on its own; death stays clamped.
    this.mixer.addEventListener("finished", (event) => {
      const action = (event as unknown as { action: THREE.AnimationAction }).action;
      // The strike and the authored combat variants hand the body back; a
      // reload, a kneel and a death each hold their last frame for their caller.
      const active = this.activeOneShot;
      if (active && !this.slain && (active === "attack" || this.variants.has(active)) && action === this.actions.get(active)) {
        // A step that has just ended leaves the figure exactly where it was going.
        const step = this.rootTravels.find(entry => entry.action === action && entry.driving);
        if (step) { this.container.position.x = step.to.x; this.container.position.z = step.to.z; step.driving = false; }
        // Between the blows of a duel the body comes back to its guard, not to the parade stance.
        if (this.livingRig.inDuel && active !== DUEL_GUARD && this.variants.has(DUEL_GUARD)) this.playVariant(DUEL_GUARD, 1, .25);
        else this.returnToStance(0.2);
      }
    });

    this.returnToStance(0);
  }

  /**
   * Binds a clip that arrived after the figure was built. Combat clips download
   * in the background, so a piece created during the opening must be able to
   * take its strike, death or stride later on without being rebuilt.
   */
  installClip(name: ClipName, clip: THREE.AnimationClip): void {
    if (!this.mixer || this.actions.has(name)) return;
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    this.actions.set(name, action);
    // The stance is the only clip that matters right now — the rest are asked
    // for by name the next time the figure fights or moves.
    if (name !== "idle" || this.slain || this.activeOneShot || this.marchLoop) return;
    if (this.idleWanted) this.playIdle(0.35);
    else this.poseFromIdle();
  }

  installCombatLibrary(library: CombatAnimationLibrary): void {
    if (!this.mixer) return;
    for (const [version, variants] of library.versions ?? []) this.combatVersions.set(version, variants);
    for (const [id, variant] of library) {
      if (this.variants.has(id)) continue;
      this.variants.set(id, variant);
      this.actions.set(id, this.mixer.clipAction(variant.clip));
    }
  }

  /** Switch only source-qualified variants; no retargeting or skeletal guesses. */
  selectCombatLibrary(version: string): boolean {
    if (this.combatLibraryVersion === version) return true;
    const selected = this.combatVersions.get(version);
    if (!this.mixer || !selected) return false;
    const variants = version === "crownfall-pawn-combat-2"
      ? new Map([...(this.combatVersions.get("crownfall-pawn-combat-1") ?? []), ...selected]) : selected;
    for (const id of this.variants.keys()) { this.actions.get(id)?.fadeOut(.08); this.actions.delete(id); }
    if (this.activeOneShot && this.variants.has(this.activeOneShot)) this.activeOneShot = null;
    this.variants.clear();
    for (const [id, variant] of variants) { this.variants.set(id, variant); this.actions.set(id, this.mixer.clipAction(variant.clip)); }
    this.combatLibraryVersion = version;
    return true;
  }

  hasCombatVariant(id: string): boolean { return this.variants.has(id); }

  configureCombat(target: PieceView, sequence?: CombatSequence, defender = false): void {
    this.combatTarget = target; this.combatSequence = sequence;
    this.combatDefender = defender;
  }

  clearCombatTargets(): void {
    this.combatTarget = null; this.combatSequence = undefined; this.guarding = false;
    this.combatDefender = false; this.contactAim = null; this.travelling = false;
    this.contactIK?.releaseFeet();
    this.meetingWeapon = false; this.guardEase = 0; this.livingRig.disengage();
    if (this.contactIK) this.contactIK.restepDistance = 0;
    // A guard the fight raised and never handed to a blow (a fight cut short) is let down with it.
    this.upper?.stop(.25, { owner: "charge" }); this.guardHeld = null;
    this.reaction = { fade: .08, deathRate: 1, deathFrom: 0, rootLimit: this.slain ? this.reaction.rootLimit : null };
    // The figure stays where its last step left it; what is still fading keeps giving its travel back.
    for (const entry of this.rootTravels) entry.driving = false;
    // A guard left looping would stand over the parade stance for the rest of the game.
    if (!this.slain && this.mixer && this.activeOneShot && this.variants.get(this.activeOneShot)?.metadata.loop) this.returnToStance(.3);
  }

  /** The actual torso bone is the target, including a defender's dodge pose. */
  combatPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.contactIK) return this.contactIK.torsoPoint(out);
    this.container.getWorldPosition(out); out.y += PIECE_HEIGHT[this.kind] * .6; return out;
  }

  /** Plays an authored combat variant once. `fade` is the blend in from whatever was playing. */
  playVariant(id: string, rate = 1, fade = .08, from = 0): number {
    const variant = this.variants.get(id), action = this.actions.get(id);
    if (!variant || !action || !this.mixer) return 0;
    this.contactIK?.restore(); this.livingRig.restore(); this.upper?.restore();
    for (const [key, other] of this.actions) if (key !== id) other.fadeOut(Math.max(.1, fade));
    // A guard that is already looping is left to breathe: restarting it would jump the pose.
    const looping = variant.metadata.loop === true;
    if (looping && this.activeOneShot === id && action.isRunning()) { action.setEffectiveTimeScale(rate); return Infinity; }
    // The clip takes the whole body: an upper layer gives way to it.
    this.letUpperGo(Math.max(.1, fade));
    action.reset();
    if (looping) { action.setLoop(THREE.LoopRepeat, Infinity); action.clampWhenFinished = false; }
    else { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    action.paused = false; action.setEffectiveTimeScale(rate).setEffectiveWeight(1).fadeIn(fade).play();
    this.beginRootTravel(id, action, variant.travel, null);
    // Joined part-way in (a skipped fight lands on its killing blow; a death skips the beat the hit clip has just played).
    if (from > 0) action.time = Math.min(from, variant.clip.duration - 1e-3);
    this.activeOneShot = id; this.marchLoop = null; this.idleLooping = false; this.aiming = false;
    this.lockRootMotion = false;
    // A figure being carried across the stone cannot keep its feet nailed to it.
    if (this.travelling || id === "defend.evade" || id === "attack.feint-step") this.contactIK?.releaseFeet(); else this.contactIK?.plantFeet();
    return looping ? Infinity : (variant.clip.duration - Math.max(0, from)) / rate;
  }

  /** Registers a clip's floor travel from where the figure stands. `to`: where it must end (the travel is scaled to it); null: where the clip itself goes. */
  private beginRootTravel(id: string, action: THREE.AnimationAction, travel: RootTravel | undefined, to: THREE.Vector3 | null): void {
    for (let i = this.rootTravels.length - 1; i >= 0; i--) { if (this.rootTravels[i].action === action) this.rootTravels.splice(i, 1); else this.rootTravels[i].driving = false; }
    if (!travel || !this.rootBone?.parent) return;
    const from = this.container.position.clone();
    let target = to;
    if (!target) {
      // The clip's own net travel, as this rig faces now.
      const parent = this.rootBone.parent;
      parent.updateWorldMatrix(true, false);
      const origin = this.rootRest.clone().applyMatrix4(parent.matrixWorld);
      const end = this.rootRest.clone(); end.x += travel.net.x; end.z += travel.net.z; end.applyMatrix4(parent.matrixWorld);
      target = from.clone().add(end.sub(origin).setY(0));
    }
    this.rootTravels.push({ id, action, travel, from, to: target.clone().setY(from.y), driving: true });
  }

  /** After the mixer: the figure follows the travelling clip being played, and the pelvis gives that travel back. */
  private applyRootTravel(): void {
    if (!this.rootTravels.length || !this.rootBone) return;
    for (let i = this.rootTravels.length - 1; i >= 0; i--) {
      const entry = this.rootTravels[i], action = entry.action;
      const weight = action.enabled ? action.getEffectiveWeight() : 0;
      if (entry.driving && (this.activeOneShot !== entry.id || this.slain)) entry.driving = false;
      if (weight <= 1e-4 && !entry.driving) { this.rootTravels.splice(i, 1); continue; }
      const at = sampleRootTravel(entry.travel, action.time, this.travelSample);
      this.rootBone.position.x -= at.x * weight; this.rootBone.position.z -= at.z * weight;
      if (entry.driving) {
        this.container.position.x = entry.from.x + (entry.to.x - entry.from.x) * at.progress;
        this.container.position.z = entry.from.z + (entry.to.z - entry.from.z) * at.progress;
      }
    }
  }

  /**
   * A step or a dodge taken on its own clip: the clip is played over `seconds`
   * (within a natural range of its own speed) and the figure is carried along
   * its floor travel to `target`. False when this rig has no such clip, or the
   * clip would have to be stretched too far to get there.
   */
  playTravelClip(id: string, target: THREE.Vector3, seconds: number, fade = .16): boolean {
    const variant = this.variants.get(id), action = this.actions.get(id);
    if (!variant?.travel || !action || !this.mixer || !this.rootBone?.parent || this.slain) return false;
    const parent = this.rootBone.parent;
    const scale = parent.getWorldScale(new THREE.Vector3()).x;
    const natural = Math.hypot(variant.travel.net.x, variant.travel.net.z) * scale, wanted = Math.hypot(target.x - this.container.position.x, target.z - this.container.position.z);
    if (natural < 1e-4 || wanted / natural < TRAVEL_STRETCH.min || wanted / natural > TRAVEL_STRETCH.max) return false;
    const rate = THREE.MathUtils.clamp(variant.clip.duration / Math.max(seconds, 1e-3), TRAVEL_RATE.min, TRAVEL_RATE.max);
    this.travelling = false;
    this.playVariant(id, rate, fade);
    this.beginRootTravel(id, action, variant.travel, target);
    return true;
  }
  /** Whatever clip was carrying the figure across the floor lets go of it: something else is about to place or move it. */
  haltTravel(): void { for (const entry of this.rootTravels) entry.driving = false; }
  /** The floor travel of a clip this rig holds, in world units as the rig stands (0 for a clip that goes nowhere). */
  clipTravel(id: string): number {
    const travel = this.variants.get(id)?.travel, parent = this.rootBone?.parent;
    return travel && parent ? Math.hypot(travel.net.x, travel.net.z) * parent.getWorldScale(new THREE.Vector3()).x : 0;
  }

  /**
   * A clip this rig holds, for the Combat Director's stage: an authored variant
   * id with its Blender markers (`contact` also answers to `impact`), or the
   * generic `attack` / `death`. Seconds are at rate 1. Never plays anything.
   */
  combatClipInfo(id: string): { id: string; duration: number; events: Record<string, number> } | null {
    const variant = this.variants.get(id);
    if (variant) {
      const events: Record<string, number> = {};
      for (const marker of variant.metadata.markers) if (events[marker.name] === undefined) events[marker.name] = marker.time;
      if (events.contact !== undefined && events.impact === undefined) events.impact = events.contact;
      return { id, duration: variant.clip.duration, events };
    }
    if (id !== "attack" && id !== "death") return null;
    const clip = this.actions.get(id)?.getClip();
    if (!clip) return null;
    const impact = id === "attack" ? retimedCombatEvent(clip, "impact", clip.duration) ?? clip.duration * (this.majestic ? .56 : .42) : undefined;
    return { id, duration: clip.duration, events: impact === undefined ? {} : { impact } };
  }

  /** Plays what {@link combatClipInfo} described, at a rate, for the Combat Director's stage. */
  playCombatClip(id: string, rate = 1, fade = .08, from = 0): number {
    if (this.variants.has(id)) return this.playVariant(id, rate, fade, from);
    const clip = id === "attack" ? this.actions.get(id)?.getClip() : undefined;
    return clip ? this.playAttack({ seconds: clip.duration / Math.max(rate, 1e-3) }).duration : 0;
  }

  /** A blow that was stopped or a shove taken: the body gives, with no hit flash and no hit clip. */
  flinch(direction: THREE.Vector3, strength = 1): void { this.guarding = false; this.livingRig.impact(direction, strength); }

  // ---- Combat Director stage: the feel layer (web/src/scene/combat). None of it runs outside a directed fight.
  /** Changes the speed of the one-shot now playing, so one clip can carry two separately timed blows. */
  setCombatClipRate(rate: number): void {
    const action = this.activeOneShot ? this.actions.get(this.activeOneShot) : undefined;
    if (action && Number.isFinite(rate)) action.setEffectiveTimeScale(Math.max(0, rate));
  }
  /**
   * Clip seconds at which the body reaches the floor in a death clip: the first
   * moment the chest is as low as it will get. A clip's `land` marker may sit
   * later, after the body has rolled to rest. Null when the rig cannot be sampled.
   */
  deathFloorTime(id: string): number | null {
    const variant = this.variants.get(id), clip = variant?.clip;
    if (!clip) return null;
    // A combat-v2 death carries its landing: the marker was read from the baked motion (pelvis or chest within 3 cm of rest).
    const land = variant.metadata.version === COMBAT_LIBRARY_V2_VERSION ? variant.metadata.markers.find(marker => marker.name === "land") : undefined;
    if (land) return land.time;
    const times: number[] = [];
    for (let time = 0; time <= clip.duration; time += 1 / 15) times.push(time);
    const poses = this.sampleCombatPose(id, times);
    if (!poses.length) return null;
    const lowest = Math.min(...poses.map(pose => pose.torso.y));
    return poses.find(pose => pose.torso.y <= lowest + .04)?.time ?? null;
  }
  /** Seconds into the one-shot now playing, or null. */
  combatClipTime(): number | null {
    const action = this.activeOneShot ? this.actions.get(this.activeOneShot) : undefined;
    return action ? action.time : null;
  }
  /** A staged step: the feet are lifted and set down in turn while the body is carried `delta` (see ContactIK.beginStep). */
  beginStep(delta: THREE.Vector3): boolean { return !this.slain && !this.marchLoop && (this.contactIK?.beginStep(delta) ?? false); }
  stepTo(progress: number): void { this.contactIK?.stepTo(progress); }
  /** Where the foot nearer the floor is now (world), or null for a figure with no legs to read: a march's footfall dust goes under it. */
  lowerFoot(out: THREE.Vector3): THREE.Vector3 | null { return this.contactIK?.lowerFoot(out) ?? null; }
  /** Asks to be told where each foot comes down (a step, a dodge, a hop back) until given null. For the fight's step dust. */
  onFootDown(listener: ((x: number, z: number) => void) | null): void { if (this.contactIK) this.contactIK.onFootDown = listener; }
  /** Head, spine, breath and weight follow this opponent until the fight is cleared (null: stop now). */
  engageDuel(opponent: PieceView | null): void {
    if (opponent) this.livingRig.engage(out => opponent.isSlain ? null : opponent.combatPoint(out)); else this.livingRig.disengage();
    // In a duel a planted foot is re-set by a step when the body has moved off it, instead of being dragged or snapped.
    if (this.contactIK) this.contactIK.restepDistance = opponent ? DUEL_RESTEP : 0;
  }
  /** The shield arm is given back to the clip: a guard that is struck open, or thrown forward in a blow, is not held up by the guard IK. */
  lowerGuard(): void { this.guarding = false; this.meetingWeapon = false; }
  /** The hips lead a thrust for `seconds`, then swing back and settle. */
  driveThrust(seconds: number): void { this.livingRig.drive(seconds); }
  /** While on, the guard puts the shield on the line the opponent's weapon is travelling, not just in front of the chest. */
  meetWeapon(on: boolean): void { this.meetingWeapon = on; }
  /**
   * How the hit and the death of this fight are played: `fade` blends them in
   * from the guard instead of cutting to them, `hit` / `death` replace the
   * sequence's clips (a blow from the flank or from behind), the death may be
   * joined `deathFrom` seconds in at `deathRate`, and `rootLimit` caps how far
   * a death clip may carry the body across the floor, in world units.
   */
  setCombatReaction(options: { fade?: number; hit?: string; death?: string; deathRate?: number; deathFrom?: number; deathFloor?: number; rootLimit?: number | null }): void {
    this.reaction = { ...this.reaction, ...options };
  }
  /** The death clip this fight will play, with the seconds from its start to the body reaching the floor and to its end. */
  deathPlan(): { id: string; land: number; length: number } | null {
    const id = this.reaction.death ?? this.combatSequence?.death, variant = id ? this.variants.get(id) : undefined;
    if (!id || !variant) return null;
    // `deathFloor`: when the body really reaches the floor in this clip, where the fight has measured it.
    const land = this.reaction.deathFloor ?? variant.metadata.markers.find(marker => marker.name === "land")?.time ?? variant.clip.duration * .85;
    const from = Math.min(this.reaction.deathFrom, land), rate = Math.max(.1, this.reaction.deathRate);
    return { id, land: (land - from) / rate, length: (variant.clip.duration - from) / rate };
  }
  /**
   * The rig posed at moments of a clip (or as it stands, for `null`), read in
   * the figure's own frame: z ahead of it, x to its left, y up from its feet.
   * For the swept-contact solver, before a fight. The live pose is put back.
   */
  sampleCombatPose(id: string | null, times: readonly number[]): { time: number; grip: THREE.Vector3; tip: THREE.Vector3; torso: THREE.Vector3; shield: THREE.Vector3 | null; shieldNormal: THREE.Vector3 | null }[] {
    const ik = this.contactIK, clip = id ? this.variants.get(id)?.clip : undefined;
    if (!ik || !this.mixer || (id && !clip)) return [];
    ik.restore(); this.livingRig.restore(); this.upper?.restore();
    const root = this.mixer.getRoot() as THREE.Object3D;
    const sampler = clip ? new THREE.AnimationMixer(root) : null;
    if (sampler && clip) sampler.clipAction(clip).play();
    const local = (point: THREE.Vector3 | null) => point ? this.visual.worldToLocal(point) : null;
    const inverse = this.visual.getWorldQuaternion(new THREE.Quaternion()).invert();
    const out = times.map(time => {
      sampler?.setTime(Math.max(0, Math.min(time, (clip?.duration ?? 0) - 1e-3)));
      this.arms?.align();
      this.container.updateWorldMatrix(true, true);
      const tip = ik.weaponPoint(new THREE.Vector3()), normal = ik.shieldNormal(new THREE.Vector3());
      return {
        time, grip: local(ik.handPoint(new THREE.Vector3()) ?? this.combatPoint(new THREE.Vector3()))!, tip: local(tip ?? this.combatPoint(new THREE.Vector3()))!,
        torso: local(this.combatPoint(new THREE.Vector3()))!, shield: local(ik.shieldPoint(new THREE.Vector3())), shieldNormal: normal ? normal.applyQuaternion(inverse) : null,
      };
    });
    if (sampler) { sampler.stopAllAction(); sampler.uncacheRoot(root); }
    return out;
  }

  // ---- upper-body layers (animation/upperBodyLayer.ts) ---------------------------------------------------------

  /**
   * Plays one of this figure's clips over its upper body, whatever its legs are doing: an authored combat variant
   * (`ready.guard`, `defend.block`, `attack.strike`) or one of its own clips (`aim`, `reload`, `attack`). The torso keeps
   * the clip's facing through the Spine Proxy; the hips, legs and feet stay the walk's or the stance's. A full-body clip
   * played afterwards lets it go. False when the rig cannot be layered, has no such clip, or is dead or in its downfall.
   */
  playUpper(id: string, options: UpperPlay = {}): boolean {
    if (!this.upper || !this.mixer || this.slain || this.downfall || this.stillStance) return false;
    const clip = this.variants.get(id)?.clip ?? this.actions.get(id)?.getClip();
    if (!clip || !this.upper.play(clip, options)) return false;
    this.upperId = id;
    return true;
  }
  /** Lets the upper layer go over `fade` seconds (after `after` seconds, when given); `owner` stops only that owner's. */
  stopUpper(fade = .2, options: { owner?: string; after?: number } = {}): void { this.upper?.stop(fade, options); }
  /** What the upper layer holds now: the clip it was asked for, its weight (0..1) and who asked. */
  get upperBody(): { clip: string | null; weight: number; owner: string | null } {
    const upper = this.upper;
    return { clip: upper?.clip ? this.upperId : null, weight: upper?.weight ?? 0, owner: upper?.owner ?? null };
  }

  /**
   * The guard a killer comes into its fight holding (layeredPose.ts `chargeGuard`): its library's own guard, else the
   * blow it is about to strike with (`variant`, as {@link playAttack} would choose it) held at its wind-up. It comes in
   * after `delay` seconds over `fade`, over whatever the legs are doing, and is held until {@link lowerGuardInto}.
   */
  raiseGuard(options: { fade: number; delay?: number; variant?: string }): boolean {
    if (!this.upper || this.slain) return false;
    const guard = chargeGuard(id => this.variants.has(id), id => this.variantMarker(id, "ready"), this.strikeWindup(options.variant));
    if (!guard) return false;
    // On the preset whose figures stand still the guard is held still too.
    const rate = guard.loop && !this.idleWanted ? 0 : 1;
    if (!this.playUpper(guard.id, { owner: "charge", fade: options.fade, delay: options.delay, loop: guard.loop, hold: guard.hold, rate })) return false;
    this.guardHeld = guard;
    return true;
  }
  /**
   * The blow has begun (right after {@link playAttack}): the guard gives way to it by `windup` seconds into it, the
   * blow's own wind-up (layeredPose.ts `guardHandover`). Nothing about the blow's timing changes.
   */
  lowerGuardInto(windup: number): void {
    const guard = this.guardHeld;
    this.guardHeld = null;
    if (!guard || this.upper?.owner !== "charge") return;
    const { after, fade } = guardHandover(guard, windup);
    this.upper.stop(fade, { owner: "charge", after });
  }

  /** A full-body clip is taking over: the upper layer gives way over `fade` seconds. */
  private letUpperGo(fade: number): void {
    if (this.upper?.active) this.upper.stop(fade);
  }
  private clearUpper(): void { this.upper?.clear(); this.guardHeld = null; this.upperId = null; }

  /** A marker of an authored variant, clip seconds, or null. */
  private variantMarker(id: string, name: string): number | null {
    return this.variants.get(id)?.metadata.markers.find(marker => marker.name === name)?.time ?? null;
  }

  /**
   * The clip {@link playAttack} would strike with for `variant`, and its wind-up in clip seconds: by the same rule the
   * combat feel layer times the blow's glint by (its `ready` marker, else two fifths of the way to the impact).
   */
  private strikeWindup(variant?: string): { id: string; windup: number } | null {
    const id = variant ?? (this.variants.has("attack.thrust") ? "attack.thrust" : undefined);
    const authored = id ? this.variants.get(id) : undefined;
    if (authored) {
      const impact = combatEventTime(authored.clip, "impact") ?? authored.clip.duration * .42;
      return { id: authored.metadata.id, windup: Math.min(impact * .8, this.variantMarker(authored.metadata.id, "ready") ?? impact * .4) };
    }
    const clip = this.actions.get("attack")?.getClip();
    if (!clip) return null;
    const cue = this.kind === "b" || this.kind === "q" ? "cast_release" : "impact";
    const impact = combatEventTime(clip, cue) ?? combatEventTime(clip, "impact") ?? clip.duration * (this.majestic ? .56 : .42);
    return { id: "attack", windup: impact * .4 };
  }

  /**
   * A witness that is wary of a figure on the move, or resolved over a fall, raises its guard over its planted feet
   * for as long as the look holds (layeredPose.ts `witnessGuard`): the duel guard, else a block held at its guard
   * frame. Any other look lets such a guard go. Only an idle figure with its living motion on does this, and never
   * over a layer a fight or a gun asked for.
   */
  private guardOnReaction(cue: BoardReactionCue): void {
    const upper = this.upper;
    if (!upper) return;
    const pose = cue.pose === "wary" || cue.pose === "resolve" ? cue.pose : null;
    const free = this.dynamicWanted && !this.flat && !this.slain && !this.stillStance && !this.downfall
      && this.activeOneShot === null && this.marchLoop === null && !this.aiming && !this.livingRig.inDuel;
    const taken = upper.active && !upper.stopping && upper.owner !== "reaction";
    const guard = pose && free && !taken ? witnessGuard(id => this.variants.has(id), id => this.variantMarker(id, "guard")) : null;
    if (!pose || !guard) { upper.stop(.32, { owner: "reaction" }); return; }
    // As far as the feeling reaches it: the cue's grip is the profile's, scaled by the rank's temper and the distance.
    const weight = THREE.MathUtils.clamp(cue.grip / EMOTION_PROFILES[pose].grip, 0, 1);
    const release = cue.release ?? .35;
    this.playUpper(guard.id, {
      owner: "reaction", delay: cue.delay, fade: cue.onset ?? .18, weight, loop: guard.loop, hold: guard.hold,
      rate: guard.loop && !this.idleWanted ? 0 : 1,
      ...(cue.sustained ? {} : { until: Math.max(0, cue.duration - release) }), release,
    });
  }

  /** Which of the target's sockets this weapon is drawn onto at its contact
   * frame: a stopped thrust lands on the shield or the parrying weapon, not
   * the body behind it. Null is the authored default, the torso. */
  setContactAim(aim: "shield" | "weapon" | null): void { this.contactAim = aim; }

  /** While true the feet are grounded rather than planted, so a staged step
   * does not stretch the legs back to where the clip began. */
  setTravelling(travelling: boolean): void {
    if (this.travelling === travelling) return;
    this.travelling = travelling;
    if (travelling) { this.contactIK?.releaseFeet(); return; }
    const id = this.activeOneShot;
    if (id && this.variants.has(id) && id !== "defend.evade" && id !== "attack.feint-step") this.contactIK?.plantFeet();
  }

  playDefense(id: string, cueSeconds?: number): void {
    const variant = this.variants.get(id);
    const cue = variant?.metadata.markers.find(m => m.name === "guard" || m.name === "evade");
    const rate = cue && cueSeconds && cueSeconds > 0 ? THREE.MathUtils.clamp(cue.time / cueSeconds, .35, 2.5) : 1;
    this.playVariant(id, rate);
  }

  reactionLead(): number {
    const meta = this.combatSequence && this.variants.get(this.combatSequence.hit)?.metadata;
    return (meta?.markers.find(m => m.name === "hit")?.time ?? 0) + (meta ? .04 : 0);
  }

  playReaction(id: string): void { this.playVariant(id); }
  /** What a wound and a weapon stain are parented to: the torso bone and the weapon socket, where the rig has them. */
  goreAnchors(): { torso: THREE.Object3D | null; weapon: THREE.Object3D | null } {
    return { torso: this.contactIK?.torsoNode() ?? null, weapon: this.contactIK?.weaponNode() ?? null };
  }
  weaponContact(out: THREE.Vector3): THREE.Vector3 { return this.contactIK?.weaponPoint(out) ?? this.combatPoint(out); }
  /** Optional VFX follows a real classified socket, never the torso fallback. */
  sampleWeaponSocket(out: THREE.Vector3): THREE.Vector3 | null { return this.contactIK?.weaponPoint(out) ?? null; }
  sampleCombatSocket(name: "weaponTip" | "shieldFace" | "torso" | "head", out: THREE.Vector3): THREE.Vector3 | null {
    return !this.contactIK ? null : name === "weaponTip" ? this.contactIK.weaponPoint(out)
      : name === "shieldFace" ? this.contactIK.shieldPoint(out) : this.contactIK.bodyPoint(name, out);
  }
  /** Writes the weapon's point and the hand on it (a trail's two edges); false on a rig with no weapon socket. */
  weaponLine(tip: THREE.Vector3, grip: THREE.Vector3): boolean { return !!this.contactIK?.weaponPoint(tip) && !!this.contactIK.handPoint(grip); }
  shieldContact(out: THREE.Vector3): THREE.Vector3 { return this.contactIK?.shieldPoint(out) ?? this.combatPoint(out); }
  get contactAlignmentError(): number | null { return this.contactIK?.contactError ?? null; }
  get isCombatDefender(): boolean { return this.combatDefender; }
  /** The figure this one is fighting, while a fight is configured. */
  get combatOpponent(): PieceView | null { return this.combatTarget; }
  preferredContactReach(): number | null { return this.contactIK?.preferredReach() ?? null; }

  /** Called only after BOTH fighters' mixers and body reactions have sampled.
   * The target therefore includes this frame's defensive motion, not last
   * frame's torso position. Board anchors remain untouched. */
  resolveContacts(): void {
    const ik = this.contactIK;
    if (!ik || !this.dynamicWanted || this.flat || this.slain || this.marchLoop) return;
    const id = this.activeOneShot, variant = id ? this.variants.get(id) : undefined;
    if (!id && !this.guarding && !this.selected && !this.livingRig.inDuel) return;
    ik.delta = this.frameDelta;
    // A firearm drill (the levelled shot, the reload, the kneel and the rise) is
    // authored whole: planting its feet would fight the knee going down.
    if (this.aiming || (id && !variant && this.arms?.muzzle)) return;
    let weaponGoal: THREE.Vector3 | null = null, shieldGoal: THREE.Vector3 | null = null;
    let weaponWeight = 0, shieldWeight = .8;
    const action = id ? this.actions.get(id) : undefined;
    if (variant?.metadata.tags.includes("attack") && action && this.combatTarget) {
      const clash = variant.metadata.markers.find(marker => marker.name === "clash"), contact = variant.metadata.markers.find(marker => marker.name === "contact");
      const shieldBlow = !!clash && !!contact && variant.metadata.tags.includes("shield") && Math.abs(clash.time - contact.time) < 1e-3;
      for (const marker of variant.metadata.markers) {
        const weight = THREE.MathUtils.smoothstep(.18 - Math.abs(action.time - marker.time), 0, .18);
        // A blow struck with the shield (its contact is its clash) is not one the spear is steered into.
        if (marker.name === "contact" && weight > 0 && !shieldBlow) {
          weaponGoal = this.contactAim === "shield" ? this.combatTarget.shieldContact(this.ikGoal)
            : this.contactAim === "weapon" ? this.combatTarget.weaponContact(this.ikGoal) : this.combatTarget.combatPoint(this.ikGoal);
          weaponWeight = weight;
        }
        if (marker.name === "clash" && weight > 0 && variant.metadata.tags.includes("shield")) {
          shieldGoal = this.combatTarget.shieldContact(this.shieldGoal); shieldWeight = weight;
        }
      }
    }
    // Every other melee rank strikes on its ordinary clip: around the blow the
    // weapon tip is drawn, within the arm's bounded correction, toward the body
    // it is hitting. Only at arm's length — a caster at range is left as authored.
    if (id === "attack" && !variant && action && this.combatTarget && this.strikeContactTime !== null && !this.arms?.muzzle) {
      const weight = THREE.MathUtils.smoothstep(.18 - Math.abs(action.time - this.strikeContactTime), 0, .18) * STRIKE_CONTACT_WEIGHT;
      if (weight > 0 && this.container.position.distanceTo(this.combatTarget.container.position) <= STRIKE_CONTACT_RANGE) {
        weaponGoal = this.combatTarget.combatPoint(this.ikGoal); weaponWeight = weight;
      }
    }
    if ((this.guarding || this.guardEase > .02) && !shieldGoal) {
      this.combatPoint(this.shieldGoal);
      this.contactForward.copy(this.guardThreat).sub(this.shieldGoal).setY(0).normalize();
      this.shieldGoal.addScaledVector(this.contactForward, .15);
      this.shieldGoal.x += this.contactForward.z * .08; this.shieldGoal.z -= this.contactForward.x * .08;
      // The fight knows where the steel will arrive: the shield goes there, within what the arm can cover.
      const hand = this.meetingWeapon && this.guarding ? this.combatTarget?.contactIK?.handPoint(this.shieldThreat) : null;
      if (hand && this.combatTarget) {
        const tip = this.combatTarget.weaponContact(this.ikGoal);
        this.contactForward.copy(tip).sub(hand).normalize();
        // The nearest point of the weapon's line of travel, from its tip onwards.
        tip.addScaledVector(this.contactForward, THREE.MathUtils.clamp(this.contactForward.dot(this.shieldThreat.copy(this.shieldGoal).sub(tip)), 0, 1.2));
        const reach = tip.distanceTo(this.shieldGoal);
        this.shieldGoal.lerp(tip, reach > .32 ? .32 / reach : 1);
      }
      shieldGoal = this.shieldGoal; shieldWeight = .8 * (this.guarding ? Math.max(.35, this.guardEase) : this.guardEase);
    }
    this.container.getWorldPosition(this.contactOrigin);
    const feet = id === "defend.evade" || id === "attack.feint-step" || id === "attack.bash-thrust" ? "ground" : "plant";
    const contacts = action ? { left: plantedAt(action.getClip(), "left", action.time), right: plantedAt(action.getClip(), "right", action.time) } : undefined;
    const threat = this.guarding && this.combatTarget ? this.combatTarget.container.getWorldPosition(this.shieldThreat) : null;
    ik.apply(this.contactOrigin.y, feet, weaponGoal, weaponWeight, shieldGoal, shieldWeight, contacts, threat);
  }

  /**
   * Body tilt for a strike driven by hand rather than by a skeleton: negative
   * leans back off the target, positive drives the shoulders over the blow.
   */
  setStrikeTilt(tilt: number): void {
    this.strikeTilt = tilt;
  }

  get hasAnimations(): boolean {
    return this.mixer !== null;
  }

  /** Whether this sculpt actually carries a given clip (rigs differ per rank). */
  hasClip(name: ClipName): boolean {
    return this.actions.has(name);
  }

  get isMarching(): boolean {
    return this.marchLoop !== null;
  }

  /**
   * Puts the figure on its own legs for a board move. `stepRate` is how many
   * footfalls a second the march should take; the clip is one full gait cycle
   * (two steps), so it is retimed to that cadence and the caller's stride clock
   * and the skeleton stay locked to each other. Returns false when the sculpt
   * has no such clip, so the caller can fall back to a slide.
   */
  startMarch(name: MarchClip, stepRate: number): boolean {
    const action = this.actions.get(name);
    if (!action || !this.mixer || this.slain) return false;
    const clip = action.getClip();
    const cycles = Math.max(0.15, stepRate * 0.5);
    // Retimed against the clip's *own* stride length rather than its total
    // length: several of the generated strides hold three cycles back to back
    // (see {@link gaitCycle}), and pretending otherwise pinned the heavy ranks
    // to the ceiling below — legs blurring on the spot while the body slid.
    // Clamped so a very long or very short move never turns the stride into a
    // slideshow or a sprint of blurred legs.
    const timeScale = THREE.MathUtils.clamp(cycles * gaitCycle(clip), 0.4, 2.9);

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.16);
    }
    // A guard raised in reaction to something seen is let go as the figure sets off; one a fight asked for is kept.
    this.upper?.stop(0.2, { owner: "reaction" });
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.14).play();

    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = name;
    // The realised cadence, so a hauled gun can jolt on the same clock.
    this.marchRate = Math.max(0.2, stepRate);
    this.lockRootMotion = true;
    return true;
  }

  /** Ends the march and eases the figure back into its combat stance. */
  stopMarch(fade = 0.22): void {
    if (!this.marchLoop) return;
    this.returnToStance(fade);
  }

  /**
   * Hands the body back to its resting stance after a march, a strike or an aim.
   * Whether that stance *breathes* is the preset's call, but leaving the march
   * running is nobody's: on the lowest preset this used to fall through to
   * {@link playIdle} anyway, so a figure that was meant to stand perfectly still
   * started breathing the moment it finished its first move.
   */
  private returnToStance(fade: number): void {
    if (this.stillStance) return;
    if (this.idleWanted) {
      this.playIdle(fade);
      return;
    }
    if (this.marchLoop) {
      this.actions.get(this.marchLoop)?.fadeOut(Math.max(0.06, fade));
      this.marchLoop = null;
      this.settleTrain();
    }
    if (this.aiming) {
      this.actions.get("aim")?.fadeOut(Math.max(0.06, fade));
      this.aiming = false;
    }
    // An authored combat variant left clamped would keep blending over the stance.
    for (const id of this.variants.keys()) this.actions.get(id)?.fadeOut(Math.max(0.06, fade));
    this.activeOneShot = null;
    this.idleLooping = false;
    this.lockRootMotion = true;
    this.poseFromIdle(fade);
  }

  /**
   * Freezes the first stance frame so "low" quality still reads as a fighter.
   * Faded in rather than cut when something was moving underneath it, so the
   * walk does not snap to attention on the last frame of a move.
   */
  private poseFromIdle(fade = 0): void {
    if (this.stillStance) return;
    this.contactIK?.restore();
    this.livingRig.restore();
    this.upper?.restore();
    const idle = this.actions.get("idle");
    if (!idle || !this.mixer) return;
    idle.reset().play();
    if (fade > 0.01) idle.fadeIn(fade);
    idle.paused = true;
    this.mixer.update(0);
  }

  /**
   * Brings the weapon up and holds it on the target: a looping sight picture the
   * caller runs for as long as the shooter is settling. Returns false when this
   * rig never learned to aim, so the beat can fall back to a hand-driven lean.
   */
  playAim(fade = 0.2): boolean {
    const action = this.actions.get("aim");
    if (!action || !this.mixer || this.slain) return false;
    for (const [key, other] of this.actions) {
      if (key !== "aim") other.fadeOut(Math.max(0.06, fade));
    }
    this.letUpperGo(Math.max(0.06, fade));
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    // A shade under real time: a man levelling a barrel is deliberate.
    action.setEffectiveTimeScale(0.85);
    action.setEffectiveWeight(1);
    action.fadeIn(fade).play();

    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = true;
    this.lockRootMotion = true;
    return true;
  }

  /**
   * Retimes the held sight picture. The aim clip carries a lateral scan, which is
   * right while a shooter is hunting for his mark and wrong once he has fired —
   * so the beat slows it almost to a stop after the shot and the marksman holds
   * what he is looking at instead of going back to sweeping the board.
   *
   * @param scale 1 = as authored, below that the scan drags.
   */
  setAimDrift(scale: number): void {
    if (!this.aiming) return;
    this.actions.get("aim")?.setEffectiveTimeScale(Math.max(0.04, scale));
  }

  /**
   * Down onto one knee: the rise clip run **backwards**, so the knee that goes
   * to the stone is the same knee the figure will come up off later.
   *
   * @returns how long the drop takes, or 0 when this rig has no such clip.
   */
  playKneel(seconds: number): number {
    return this.playStanceShift(-1, seconds);
  }

  /**
   * Back up onto both feet off the knee. The clip is left clamped on its last
   * standing frame, so the caller can hand over to the stance (or straight into
   * a march) without the body dropping again in between.
   *
   * @returns how long the rise takes, or 0 when this rig has no such clip.
   */
  playRise(seconds: number): number {
    return this.playStanceShift(1, seconds);
  }

  /**
   * The one clip that changes a figure's stance, played in whichever direction
   * the beat needs. Reverse playback is a first-class mixer feature: with
   * `LoopOnce` and a negative time scale the action clamps at time 0 and fires
   * `finished` exactly as it does at the far end.
   *
   * @param direction 1 rises off the knee, -1 goes down onto it.
   * @param seconds how long the move should take, whatever the clip's own length.
   */
  private playStanceShift(direction: 1 | -1, seconds: number): number {
    const action = this.actions.get("rise");
    if (!action || !this.mixer || this.slain) return 0;
    // Only the part of the clip that is the actual stance change (see RISE_SPAN).
    const span = action.getClip().duration * RISE_SPAN;
    const target = Math.max(0.2, seconds);
    const timeScale = THREE.MathUtils.clamp(span / target, 0.35, 3.4);
    const duration = span / timeScale;

    for (const [key, other] of this.actions) {
      if (key !== "rise") other.fadeOut(0.12);
    }
    this.letUpperGo(0.12);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.time = direction > 0 ? 0 : span;
    action.setEffectiveTimeScale(direction * timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.12).play();

    this.activeOneShot = "rise";
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = false;
    this.lockRootMotion = true;
    return duration;
  }

  /** Crossfades back to the looping combat stance. */
  playIdle(fade = 0.25): void {
    // A held downfall stance stays held: nothing starts the battle stance again under it.
    if (this.stillStance) return;
    // A stride left running underneath would blend into the stance and keep the
    // legs walking on the spot.
    if (this.marchLoop) {
      this.actions.get(this.marchLoop)?.fadeOut(Math.max(0.06, fade));
      this.marchLoop = null;
      this.settleTrain();
    }
    // Likewise a held aim: left running it would blend the barrel back up.
    if (this.aiming) {
      this.actions.get("aim")?.fadeOut(Math.max(0.06, fade));
      this.aiming = false;
    }
    const idle = this.actions.get("idle");
    if (!idle) return;
    for (const [key, action] of this.actions) if (key !== "idle") action.fadeOut(fade);
    this.activeOneShot = null;
    this.lockRootMotion = true;
    if (this.idleLooping && idle.isRunning()) return;
    idle.reset();
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.clampWhenFinished = false;
    idle.paused = false;
    // Desync the army so the whole board does not breathe in lockstep.
    idle.time = Math.random() * idle.getClip().duration;
    // Royalty holds the room: a slower, heavier breath than the soldiery.
    idle.setEffectiveTimeScale(
      this.majestic ? 0.52 + Math.random() * 0.08 : 0.9 + Math.random() * 0.2,
    );
    idle.fadeIn(fade).play();
    idle.paused = !this.idleWanted;
    this.idleLooping = this.idleWanted;
  }

  /**
   * @param seconds explicit playback length, overriding the per-rank default.
   *   A firing drill has to be readable — the shot has to be seen to be aimed —
   *   so the gun beat asks for a longer, slower take than a sword swing.
   */
  private playOneShot(name: OneShot, seconds?: number): number {
    const action = this.actions.get(name);
    if (!action || !this.mixer) return 0;
    const clip = action.getClip();
    const target = seconds ?? oneShotSeconds(this.kind, name);
    // An explicitly asked-for length is allowed to slow the clip much further
    // than a default one: that is the whole point of asking.
    const floor = seconds !== undefined ? 0.3 : this.majestic ? 0.45 : 0.75;
    const timeScale = THREE.MathUtils.clamp(clip.duration / target, floor, this.majestic ? 1.6 : 2.6);
    const duration = clip.duration / timeScale;

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.1);
    }
    if (name === "death") this.clearUpper(); else this.letUpperGo(0.1);
    this.marchLoop = null;
    this.aiming = false;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.08).play();

    this.activeOneShot = name;
    this.idleLooping = false;
    this.lockRootMotion = name !== "death";
    return duration;
  }

  /**
   * Starts the strike clip. Returns the playback length and the moment the
   * blade lands, so the caller can time sparks, sound and screen shake.
   *
   * @param options `seconds` overrides the playback length and `impactAt` the
   *   fraction of it at which the blow (or the shot) leaves. Firearms need both:
   *   their clips are long drills whose report lands well past the halfway mark.
   */
  playAttack(options: { seconds?: number; impactAt?: number; variant?: string } = {}): { duration: number; impact: number; events?: readonly AnimationMarker[] } {
    // An authored combat variant carries its own length and its own contact marker.
    const id = options.variant ?? (this.variants.has("attack.thrust") ? "attack.thrust" : undefined);
    const variant = id ? this.variants.get(id) : undefined;
    if (variant) {
      const duration = this.playVariant(variant.metadata.id);
      const impact = combatEventTime(variant.clip, "impact")!;
      return { duration, impact, events: variant.metadata.markers };
    }
    const duration = this.playOneShot("attack", options.seconds);
    this.strikeContactTime = null;
    if (options.impactAt !== undefined) {
      return { duration, impact: duration * THREE.MathUtils.clamp(options.impactAt, 0.05, 0.95) };
    }
    // PR #3 sidecars migrate existing clips too. Unmarked remote clips retain
    // their old timing until their original Actions are authored/exported.
    const clip = this.actions.get("attack")?.getClip();
    const cue = this.kind === "b" || this.kind === "q" ? "cast_release" : "impact";
    const authored = clip ? retimedCombatEvent(clip, cue, duration) ?? retimedCombatEvent(clip, "impact", duration) : null;
    // The royal wind-up is longer, so the blow lands later in the clip.
    const impact = authored ?? duration * (this.majestic ? 0.56 : 0.42);
    // Remembered in the clip's own time, so the bounded weapon contact (see
    // resolveContacts) can find the blow however the clip was retimed.
    if (clip && duration > 0) this.strikeContactTime = impact / duration * clip.duration;
    return { duration, impact };
  }

  /**
   * Runs the reloading drill after a shot. Returns its length, or 0 when this
   * rig never learned one — the caller simply skips the beat.
   */
  playReload(): number {
    return this.playOneShot("reload");
  }

  /**
   * Starts the death clip and returns how long it runs. The figure is marked
   * slain so hover/selection lift, sway and the idle stance stop interfering
   * with the fall — the corpse holds the last frame until it is cleared away.
   */
  playDeath(): number {
    this.livingRig.beginDeath();
    // The blow that kills it takes the whole body, whatever its arms were holding.
    this.clearUpper();
    this.slain = true;
    this.marchLoop = null;
    this.hovered = false;
    this.selected = false;
    this.alarm = 0;
    this.collider.visible = false;
    if (this.badge) {
      this.badge.visible = false;
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
    this.guarding = false;
    const authored = this.combatSequence && this.playVariant(this.reaction.death ?? this.combatSequence.death, this.reaction.deathRate, this.reaction.fade, this.reaction.deathFrom);
    return authored || this.playOneShot("death");
  }

  /**
   * Lifts the figure off the floor plane: the contact shadow and team glow are
   * discs pinned to the ground, so they have to go while the body is in the air.
   */
  setAirborne(airborne: boolean): void {
    this.glow.visible = !airborne;
    if (this.shadow) this.shadow.visible = !airborne && !this.flat;
  }

  /** Back to a calm stance (used when a fallen figure reaches the tray). */
  resetPose(): void {
    this.contactIK?.reset();
    this.clearCombatTargets();
    this.livingRig.reset();
    this.clearUpper();
    this.slain = false;
    this.poseHeld = false;
    this.setDissolve(0);
    this.setChar(null);
    // Its wounds go with it: a figure in the tray stands whole.
    this.wearWounds(null);
    this.strikeTilt = 0;
    this.hit = 0;
    this.aura = 0;
    this.collider.visible = true;
    this.visual.scale.set(1, 1, 1);
    if (this.badge) this.badge.visible = this.badgeWanted;
    this.setAirborne(false);
    this.runtime.position.set(0, 0, 0);
    this.runtime.rotation.set(0, 0, 0);
    this.reaction.rootLimit = null; this.rootHold = 1;
    this.container.scale.setScalar(1);
    this.visual.quaternion.copy(this.homeFacing);
    if (!this.mixer) return;
    for (const action of this.actions.values()) action.stop();
    this.rootTravels.length = 0;
    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = false;
    this.lockRootMotion = true;
    this.container.rotation.set(0, 0, 0);
    this.playIdle(0);
  }

  get object(): THREE.Object3D {
    return this.container;
  }

  /** What the pointer tests against — never the sculpt itself. */
  get hitMeshes(): THREE.Mesh[] {
    return [this.collider];
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    if (this.dynamicWanted && selected && !this.activeOneShot && !this.marchLoop && !this.slain && !this.downfall) this.playVariant("ready.raise");
    else if (!selected && this.activeOneShot?.startsWith("ready.")) this.playIdle(.15);
  }

  /** 0 = calm, 1 = king in check (red pulse). */
  setAlarm(value: number): void {
    this.alarm = value;
  }

  /** White-hot red flash across the figure at the moment a blow connects. */
  takeHit(direction?: THREE.Vector3, strength = 1): void {
    this.hit = 1;
    this.guarding = false;
    const authored = this.combatSequence && this.playVariant(this.reaction.hit ?? this.combatSequence.hit, 1, this.reaction.fade);
    if (direction) this.livingRig.impact(direction, strength * (authored ? .45 : 1));
  }

  braceForImpact(point: THREE.Vector3): void {
    this.livingRig.brace(point); this.guardThreat.copy(point); this.guarding = true;
    this.contactIK?.plantFeet();
  }
  noticeImpact(point: THREE.Vector3, strength: number): void { this.livingRig.notice(point, strength); }
  applyBoardReaction(cue: BoardReactionCue): void {
    if (this.downfall) return;
    this.livingRig.observe(cue);
    this.guardOnReaction(cue);
  }
  /** Lets a held look go: it eases back, unless `immediate`. */
  clearBoardReaction(immediate = false): void {
    this.livingRig.clearObservation(immediate);
    this.upper?.stop(immediate ? 0 : .32, { owner: "reaction" });
  }
  setBattlefieldQuiet(quiet: boolean): void { this.livingRig.setQuiet(quiet); }
  /** The army's morale in this figure's carriage and breath (battleBonds.ts); see LivingPieceRig.setMood. */
  setBattleMood(slump: number, tension: number, pride: number, immediate = false): void {
    // Once a beaten figure's downfall has begun its carriage is the downfall's: the mood it had then is the one it hands over.
    if (this.downfall?.ownsBody) return;
    this.livingRig.setMood(slump, tension, pride, immediate);
  }
  holdContact(seconds: number): void { this.livingRig.hold(seconds); }
  /**
   * Holds the figure in the pose its clips have reached, or lets them run on: a body run through and held up on
   * what pierced it stays as it was struck until it is let go (vfx/spells/spell.ts `pierce`).
   */
  holdPose(held: boolean): void { this.poseHeld = held; }
  setDynamicMotionEnabled(enabled: boolean): void {
    this.dynamicWanted = enabled;
    this.contactIK?.setEnabled(enabled && !this.flat);
    this.livingRig.setEnabled(enabled && !this.flat);
    // A witness's guard is a living reaction: it goes with the rest of them.
    if (!enabled) this.upper?.stop(.2, { owner: "reaction" });
  }

  // ------------------------------------------------------- the downfall (scene/downfall/downfallStage.ts)

  /** Its height on the board, world units. */
  get standingHeight(): number { return PIECE_HEIGHT[this.kind]; }
  /** How tall it stands as posed now, to the top of its head (a crown or helm adds a little), world units. */
  measuredHeight(): number {
    let head: THREE.Object3D | null = null, top: THREE.Object3D | null = null;
    this.visual.traverse((node) => {
      const name = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!top && /^(headend|headtopend|headtop)$/.test(name)) top = node;
      if (!head && name === "head" && (node as THREE.Bone).isBone) head = node;
    });
    this.container.updateWorldMatrix(true, true);
    const ground = this.container.getWorldPosition(new THREE.Vector3()).y, at = new THREE.Vector3();
    const found = top as THREE.Object3D | null, skull = head as THREE.Object3D | null;
    if (found) return Math.max(0.3, (found.getWorldPosition(at).y - ground) * 1.04);
    if (skull) return Math.max(0.3, (skull.getWorldPosition(at).y - ground) / 0.86);
    return PIECE_HEIGHT[this.kind];
  }
  /** True when it carries a long arm in both hands: a victor raises it with both. */
  get holdsLongArm(): boolean { return this.arms?.props.some(prop => prop.longArm) ?? false; }
  /** The way it faces on the board (unit, y = 0). */
  facing(out: THREE.Vector3): THREE.Vector3 {
    this.visual.getWorldDirection(out).setY(0);
    return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 0, this.color === "w" ? -1 : 1);
  }
  /** Its part in the downfall: layered over its stance from now on, on the downfall's clock. */
  beginDownfall(cast: DownfallCast, clock: DownfallClock): void {
    this.livingRig.clearObservation();
    // The downfall owns the body from here: no guard or drill is layered over its part.
    this.letUpperGo(0.3);
    this.guarding = false;
    this.downfall = new DownfallPose(this.container, this.visual, cast, clock, PIECE_HEIGHT[this.kind]);
  }
  /**
   * Whether the downfall has touched it (posed it, held its stance, taken its weapons or its light): such a figure is
   * never kept standing across a replay's seek, it is built again.
   */
  get inDownfall(): boolean {
    return this.downfall !== null || this.stillStance !== null || this.insignia > 0 || (this.fallenRoot?.children.length ?? 0) > 0;
  }
  /** The top of the crest over its head, standing (the close shots keep the King's in frame while it fades). */
  crestTop(): number { return PIECE_HEIGHT[this.kind] + BADGE_LIFT + BADGE_SCALE[this.kind] * 0.5; }
  /** When its knee meets the stone (downfall clock): null until its kneel is solved, Infinity if it cannot kneel. */
  kneelContact(): number | null {
    // A figure that cannot kneel (no legs to kneel on) bows instead: no knee of it is ever heard.
    if (!this.downfall?.canKneel) return Infinity;
    return this.downfall.kneelContact;
  }
  /**
   * Its stance stops: whatever it was playing fades over `fade` seconds into the stance's first frame, held. A
   * beaten figure no longer breathes battle-ready; the downfall gives it its own slow breath.
   */
  holdStance(fade: number): void {
    if (!this.mixer || this.stillStance) return;
    const idle = this.actions.get("idle");
    if (!idle) return;
    const still = this.mixer.clipAction(stillClip(idle.getClip()));
    for (const action of this.actions.values()) action.fadeOut(Math.max(0, fade));
    this.letUpperGo(Math.max(0, fade));
    still.reset();
    still.setLoop(THREE.LoopOnce, 1);
    still.clampWhenFinished = true;
    still.time = 0;
    still.paused = true;
    still.setEffectiveWeight(1);
    still.fadeIn(Math.max(0, fade)).play();
    this.stillStance = still;
    this.activeOneShot = null; this.idleLooping = false; this.marchLoop = null; this.aiming = false; this.guarding = false;
    this.lockRootMotion = true;
  }
  /** What its hands still hold that can fall. */
  downfallProps(): { group: THREE.Object3D; weapon: string; shield: boolean }[] {
    return (this.arms?.props ?? []).filter(prop => prop.group.parent && prop.group.parent !== this.fallenRoot)
      .map(prop => ({ group: prop.group, weapon: prop.weapon, shield: prop.shield }));
  }
  /** A weapon it let fall now lies in its keeping: drawn while the sculpt is, freed with the figure. */
  adoptFallen(group: THREE.Object3D): void {
    if (!this.fallenRoot) {
      this.fallenRoot = new THREE.Group();
      this.fallenRoot.name = "fallen";
      this.fallenRoot.visible = !this.flat;
      this.container.add(this.fallenRoot);
    }
    this.fallenRoot.attach(group);
  }
  /** Its ring, crest, rim and glow fade (`insignia`) and the light on it falls (`shade`), both 0..1. */
  setDownfallLight(insignia: number, shade: number): void {
    this.insignia = THREE.MathUtils.clamp(insignia, 0, 1);
    this.dissolveUniforms.uRimStrength.value = RIM_STRENGTH * (1 - 0.75 * this.insignia);
    const amount = THREE.MathUtils.clamp(shade, 0, 1);
    const all = this.arms ? [...this.materials, ...this.arms.materials] : this.materials;
    if (!this.unshaded) {
      if (amount <= 0) return;
      this.unshaded = { colors: all.map(material => material.color.clone()), env: all.map(material => material.envMapIntensity) };
    }
    all.forEach((material, index) => {
      const color = this.unshaded!.colors[index], env = this.unshaded!.env[index];
      if (!color || env === undefined) return;
      material.color.copy(color).multiplyScalar(1 - 0.34 * amount);
      material.envMapIntensity = env * (1 - 0.42 * amount);
    });
  }

  /**
   * Vertical squash used by the landing settle: 0 stands the figure up, 1 is
   * fully compressed. Applied to the sculpt only, so the ground discs, crest
   * and board anchor all stay exactly where they belong.
   */
  setSquash(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, -0.6, 1) * 0.15;
    this.visual.scale.set(1 + value * 0.6, 1 - value, 1 + value * 0.6);
  }

  /** Flares the team aura disc under the figure — the moment it takes a square. */
  flareAura(strength = 1): void {
    this.aura = Math.max(this.aura, THREE.MathUtils.clamp(strength, 0, 1.5));
  }

  get isSlain(): boolean {
    return this.slain;
  }

  /** True when this figure carries a staff or sceptre it can cast fire from. */
  get canCast(): boolean {
    return this.arms?.focus != null;
  }

  /** True when this figure has a barrel to fire: pistol, musket or field gun. */
  get canShoot(): boolean {
    return this.arms?.muzzle != null;
  }

  /** True when a gun carriage is hauled along beside this figure. */
  get hasTrain(): boolean {
    return this.arms?.train != null;
  }

  /**
   * World point a shot leaves from: the mouth of the barrel, read out of the
   * live pose so the flash sits on the gun wherever the arms have swung it — or,
   * for the battery, wherever the carriage has been hauled to.
   */
  muzzleOrigin(): THREE.Vector3 {
    const muzzle = this.arms?.muzzle;
    if (muzzle) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(new THREE.Vector3());
    }
    return this.castOrigin();
  }

  /**
   * Rolls the gun carriage back on its wheels and tips its muzzle as the charge
   * lifts the trail. The gun hangs off the sculpt root in body axes, so recoil
   * is a shove along its own -Z with a pitch about the axle (its own X).
   *
   * @param back travel back along the carriage's own line of fire, in figure heights
   * @param lift 0 = level on its wheels, 1 = muzzle thrown up by a full charge
   */
  setTrainRecoil(back: number, lift = 0): void {
    const train = this.arms?.train;
    if (!train) return;
    const jump = Math.max(0, lift);
    train.position.z = -Math.max(0, back);
    // A field gun's wheels really do leave the ground under a full charge.
    train.position.y = jump * 0.045;
    train.rotation.x = -jump * 0.2;
  }

  /**
   * A hauled gun carriage crossing stone: the trail pitches on the axle once per
   * footfall and the whole piece rocks slowly from wheel to wheel. Without it the
   * battery's gun slid along beside a walking crew, which read as the whole rank
   * having lost its animation.
   */
  private rumbleTrain(elapsed: number): void {
    const train = this.arms?.train;
    if (!train) return;
    const jolt = Math.sin(elapsed * this.marchRate * Math.PI * 2 + this.phase);
    train.rotation.x = jolt * 0.022;
    train.rotation.z = Math.sin(elapsed * this.marchRate * Math.PI + this.phase) * 0.014;
    train.position.y = Math.abs(jolt) * 0.008;
  }

  /** Sets the hauled gun back down level once the march is over. */
  private settleTrain(): void {
    const train = this.arms?.train;
    if (!train) return;
    train.rotation.x = 0;
    train.rotation.z = 0;
    train.position.y = 0;
  }

  /** World point the hauled gun carriage stands at, or null if nothing is towed. */
  trainOrigin(): THREE.Vector3 | null {
    const train = this.arms?.train;
    if (!train) return null;
    train.updateWorldMatrix(true, false);
    return train.getWorldPosition(new THREE.Vector3());
  }

  /**
   * World point a spell leaves from: the crystal in the staff's claw or the gem
   * on the sceptre, read out of the pose on the frame it is asked for, so the
   * fire hangs off the prop wherever the casting arm has swung it.
   */
  castOrigin(): THREE.Vector3 {
    const focus = this.arms?.focus;
    if (focus) {
      focus.updateWorldMatrix(true, false);
      return focus.getWorldPosition(new THREE.Vector3());
    }
    // No prop (an unrigged fallback figure): cast from where the hands would be.
    const height = PIECE_HEIGHT[this.kind] * 0.78;
    return this.container.position.clone().setY(this.container.position.y + height);
  }

  /** Snaps the figure round to look at a world position (its killer, a target). */
  faceTowards(point: THREE.Vector3): void {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    this.setFacing(forward.normalize(), false);
  }

  /** Smoothly swings the figure round to face a world position. */
  async turnTowards(point: THREE.Vector3, tweens: TweenManager, duration = 0.22): Promise<void> {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    await this.turnTo(orientationCorrection(forward.normalize()), tweens, duration);
  }

  /** Swings back to the resting orientation once the fighting is over. */
  async turnHome(tweens: TweenManager, duration = 0.28): Promise<void> {
    await this.turnTo(this.homeFacing.clone(), tweens, duration);
  }

  private async turnTo(to: THREE.Quaternion, tweens: TweenManager, duration: number): Promise<void> {
    const from = this.visual.quaternion.clone();
    if (from.angleTo(to) < 0.04) return;
    await tweens.to({
      duration,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        // A figure cut down in mid-turn belongs to its fall from then on.
        if (!this.slain) this.visual.quaternion.slerpQuaternions(from, to, t);
      },
    });
    if (!this.slain) this.visual.quaternion.copy(to);
  }

  /**
   * The char of a burning body (death/burn): how far it has spread from a world point, and how hot its embers
   * are. It is uniforms on the figure's one shared block, so body and weapons char together and no material's
   * own parameters are touched; null puts the block back exactly as it was built. The burn-away's edge takes
   * the embers' colour while the figure is charred, and its side's colour again after.
   */
  setChar(state: CharState | null): void {
    if (!state) {
      if (!this.charred) return;
      this.charred = false;
      clearChar(this.dissolveUniforms);
      this.dissolveUniforms.uDissolveEmber.value.setHex(DISSOLVE_EMBER[this.color]);
      return;
    }
    this.charred = true;
    applyChar(this.dissolveUniforms, state);
    this.dissolveUniforms.uDissolveEmber.value.setRGB(state.ember[0], state.ember[1], state.ember[2]).multiplyScalar(state.crumbleGlow);
  }

  /** Whether the figure carries a char now: false for every figure Undo or a new game has put back. */
  get isCharred(): boolean {
    return this.charred;
  }

  /** What wears the figure's wound mask (gore/WoundMasks.ts): the sculpt's meshes, never its props. */
  woundMeshes(): readonly THREE.Mesh[] {
    return this.sculpt;
  }

  /**
   * The figure's wound mask (gore/WoundMasks.ts, Milestone 03): a texture in the sculpt's UV space that its own
   * materials show as torn flesh and blood (gore/woundMaskShader.ts). Like the char it is uniforms on the one
   * shared block, read only by the sculpt's patch; null puts the block back exactly as it was built. `lost` is
   * called if the figure drops the mask by itself: when it stands again in the tray, or is freed.
   */
  wearWounds(wear: WoundWear | null, lost?: () => void): void {
    if (!wear) {
      const told = this.woundLost;
      this.woundLost = null;
      clearWounds(this.dissolveUniforms);
      told?.();
      return;
    }
    if (lost) this.woundLost = lost;
    applyWounds(this.dissolveUniforms, { ...wear, sink: wear.sink * this.dissolveUniforms.uDissolveSpan.value.y });
  }

  /** Whether the figure wears a wound mask now: false for every figure that stands in the tray or was put back. */
  get isWounded(): boolean {
    return this.dissolveUniforms.uWoundOn.value > 0;
  }

  /**
   * Burn-away amount: 0 leaves the figure solid, 1 scatters it completely. The
   * body erodes from the soles up through a noise field with a glowing rim, so
   * a captured figure comes apart into the air rather than being switched off.
   */
  setDissolve(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, 0, 1);
    if (this.dissolveAmount === value) return;
    const wasSolid = this.dissolveAmount <= 0.02;
    this.dissolveAmount = value;
    this.dissolveUniforms.uDissolve.value = value;
    if (this.propDissolve) this.propDissolve.uDissolve.value = value;
    // A shadow map knows nothing about the burn, so a half-eaten body would
    // keep casting a whole one. Drop the cast the moment it starts to go.
    const solid = value <= 0.02;
    if (solid !== wasSolid) {
      for (const mesh of this.meshes) mesh.castShadow = solid;
    }
  }

  get dissolveLevel(): number {
    return this.dissolveAmount;
  }

  /**
   * Forming, 0 to 1 (the match opening): the body burns in from its soles as setDissolve(1 - amount) has it, and its
   * props wait until the body is about half formed, then form over the rest. Burning on the same clock, a prop has no
   * sweep from the ground and came in everywhere at once: a speckled blade hung in the air above a pair of legs.
   */
  setFormation(amount: number): void {
    const formed = THREE.MathUtils.clamp(amount, 0, 1);
    this.setDissolve(1 - formed);
    if (this.propDissolve) this.propDissolve.uDissolve.value = 1 - THREE.MathUtils.clamp((formed - PROP_FORM_FROM) / (1 - PROP_FORM_FROM), 0, 1);
  }

  /**
   * The light along the burning edge: a kingdom's own (sRGB, and how hard it burns against the side's) while its army
   * takes the field in the match opening, the side's again when given null.
   */
  setDissolveEmber(color: number | null, gain = 1): void {
    this.dissolveUniforms.uDissolveEmber.value.setHex(color ?? DISSOLVE_EMBER[this.color]).multiplyScalar(color === null ? 1 : gain);
  }

  setOpacity(value: number): void {
    this.fade = value;
    for (const material of this.materials) fadeMaterial(material, value);
    if (this.arms) for (const material of this.arms.materials) fadeMaterial(material, value);
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = (this.presentationLook ? 0 : RING_REST) * value;
    if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = (this.presentationLook ? 0.38 : 0.55) * value;
    if (this.badge) {
      (this.badge.material as THREE.SpriteMaterial).opacity = this.badgeOpacity * value;
    }
    if (this.tokenMaterial) this.tokenMaterial.opacity = this.tokenFade * value;
  }

  /**
   * Points the figure along `forward`. `remember` stores it as the resting
   * orientation the figure returns to after a combat turn.
   */
  setFacing(forward: THREE.Vector3, remember = true): void {
    const quaternion = orientationCorrection(forward);
    this.visual.quaternion.copy(quaternion);
    if (remember) this.homeFacing.copy(quaternion);
  }

  update(delta: number, elapsed: number): void {
    this.contactIK?.restore();
    this.downfall?.restore();
    this.livingRig.restore();
    this.upper?.restore();
    this.guardEase += ((this.guarding ? 1 : 0) - this.guardEase) * Math.min(1, delta * 11);
    this.frameDelta = delta;
    this.hit = Math.max(0, this.hit - delta * 2.4);
    this.aura = Math.max(0, this.aura - delta * 1.8);

    if (this.slain) {
      this.updateSlain(delta);
      return;
    }

    const breath = Math.sin(elapsed * (this.majestic ? 0.7 : 1.15) + this.phase);
    const sway = Math.sin(elapsed * (this.majestic ? 0.42 : 0.7) + this.phase * 1.7);
    const lift = this.dynamicWanted && this.hasAnimations ? 0 : this.selected
      ? this.majestic
        ? 0.11
        : 0.16
      : this.hovered
        ? this.majestic
          ? 0.05
          : 0.075
        : 0;

    if (this.flat) {
      // Nothing of the sculpt is on screen: skip the skeleton entirely and just
      // let the figure stand back up under its counter.
      this.runtime.position.y += (0 - this.runtime.position.y) * Math.min(1, delta * 9);
      // An upper layer keeps its clock and fades, unseen, so the sculpt comes back where it would have been.
      this.upper?.apply(delta, false);
    } else if (this.mixer) {
      const step = this.poseHeld ? 0 : this.livingRig.animationDelta(delta);
      if (!this.poseHeld) this.mixer.update(step);
      this.applyRootTravel();
      // Keep the figure planted on its square; clips carry their own steps.
      this.holdRoot(delta, this.lockRootMotion);
      // The upper-body layer goes over the hips and legs the mixer left, before anything procedural moves a bone:
      // the living rig, the contact IK and the downfall all layer over it and restore to it.
      this.upper?.apply(step);
      // The gun goes where the arms went this frame, not where the stance pose
      // left it: a levelled barrel is the whole point of an aiming clip.
      this.arms?.align();
      // A field gun does not glide: while its crew marches, the carriage jolts
      // over the stone on the same clock as the boots.
      if (this.marchLoop) this.rumbleTrain(elapsed);
      this.runtime.position.y += (lift - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = 0;
      // Re-applied after the mixer, which owns the pose for the rest of the frame.
      this.runtime.rotation.x = this.strikeTilt;
    } else {
      // Fallback figures keep the procedural breath and weight shift.
      const amplitude = this.majestic ? 0.45 : 1;
      this.runtime.position.y +=
        (lift + breath * 0.006 * amplitude - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = sway * 0.012 * amplitude;
      this.runtime.rotation.x = breath * 0.008 * amplitude + this.strikeTilt;
    }

    // A beaten figure's body is the downfall's (scene/downfall): no idle glance or breath of its own over it.
    // A beaten figure's body becomes the downfall's (scene/downfall) as its own part begins: its living layer (glance,
    // breath, the army's slumping mood) gives way over a moment rather than snapping off under it.
    const living = this.downfall?.livingWeight ?? 1;
    if (!this.flat && living > 0) {
      this.livingRig.apply(delta, elapsed, this.idleWanted && this.activeOneShot === null, this.marchLoop !== null);
      this.livingRig.fade(living);
    }
    if (!this.flat) this.downfall?.apply(elapsed);
    // The living layer has just moved the arms again: a held gun follows them.
    if (!this.flat && this.mixer && (this.dynamicWanted || this.downfall)) this.arms?.align();

    const target = this.selected ? 0.5 : this.hovered ? 0.32 : 0.06;
    const alarmPulse = this.alarm > 0 ? (Math.sin(elapsed * 7) * 0.5 + 0.5) * this.alarm : 0;
    const hitGlow = this.hit * this.hit * 2.6;
    for (const material of this.materials) {
      const value = (this.baseEmissive + target * 0.9 + alarmPulse * 1.5 + hitGlow) * (1 - 0.6 * this.insignia);
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 8);
      if (this.hit > 0.02) material.emissive.setHex(0xff3418);
      else if (this.alarm > 0) material.emissive.setHex(0xff2a1a);
      else material.emissive.setHex(this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      // Steel and gems answer the same highlight, but keep their own hues.
      const boost = target * 0.8 + alarmPulse * 1.2;
      // A plain loop: a closure here was made for every figure on every frame (A-29).
      const { materials, baseEmissive } = this.arms;
      for (let index = 0; index < materials.length; index += 1) {
        const base = baseEmissive[index] ?? 0;
        const value = base + boost * (base > 1 ? 0.6 : 1);
        materials[index].emissiveIntensity += (value - materials[index].emissiveIntensity) * Math.min(1, delta * 8);
      }
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    const settle = this.aura * this.aura;
    const glowTarget = this.presentationLook
      ? 0
      : (RING_REST + (this.selected ? 0.5 : this.hovered ? 0.3 : 0) + alarmPulse * 0.4 + settle * 0.5) * this.fade * (1 - 0.88 * this.insignia);
    glowMaterial.opacity += (glowTarget - glowMaterial.opacity) * Math.min(1, delta * 8);
    this.glow.scale.setScalar(1 + (this.selected ? 0.08 : 0) + alarmPulse * 0.12 + settle * 0.3);
    // The light is multiplied into a pale tile and added to a dark one (see GROUND_LIGHT). Which of the two is a
    // blend state, not a shader, so it is switched as the figure crosses from one tile to the next; the light
    // comes up again from nothing on the new tile, since the two are measured differently.
    const pale = isLightSquareAt(this.container.position.x, this.container.position.z);
    if (pale !== this.groundPale) {
      this.groundPale = pale;
      this.groundLift = 0;
      glowMaterial.blendSrc = pale ? THREE.DstColorFactor : THREE.OneFactor;
    }
    const underfoot = pale ? GROUND_LIGHT.pale : GROUND_LIGHT.dark;
    this.groundLift += (underfoot.lift - this.groundLift) * Math.min(1, delta * 6);
    // Straight to the screen there is nothing below black to draw a channel down to: the light only lifts.
    const gain = this.groundLift * (this.drawnDirect ? (pale ? GROUND_LIGHT_DIRECT.pale : GROUND_LIGHT_DIRECT.dark) : 1);
    const shift = this.drawnDirect ? 0 : underfoot.shift;
    // A channel is never drawn down past a fraction of itself, however strongly the light is flared.
    const floor = -0.55;
    glowMaterial.color.setRGB(
      Math.max(floor, (this.groundTint[0] - shift) * gain),
      Math.max(floor, (this.groundTint[1] - shift) * gain),
      Math.max(floor, (this.groundTint[2] - shift) * gain),
    );

    this.updateBadge(delta, elapsed, alarmPulse);
    this.updateToken(delta, alarmPulse);
  }

  /**
   * Holds the root bone over the figure's square, or lets a clip carry it. The
   * authored combat clips stand a little off that spot, so the hold is eased on
   * and off: switched, the whole body jumped sideways on the first frame of
   * every guard, blow and hit.
   */
  private holdRoot(delta: number, locked: boolean): void {
    this.rootHold += ((locked ? 1 : 0) - this.rootHold) * Math.min(1, delta * 9);
    if (locked && this.rootHold > .985) this.rootHold = 1;
    if (!this.rootBone || this.rootHold < .001) return;
    this.rootBone.position.x += (this.rootRest.x - this.rootBone.position.x) * this.rootHold;
    this.rootBone.position.z += (this.rootRest.z - this.rootBone.position.z) * this.rootHold;
  }

  /**
   * A dying figure runs only its skeleton and the fading hit flash: no breath,
   * no hover lift, no team glow — the fall has to read as a fall.
   */
  private updateSlain(delta: number): void {
    if (!this.flat) {
      // a body run through and held up on what pierced it stays as it was struck until it is let go (holdPose)
      if (!this.poseHeld) this.mixer?.update(delta);
      this.holdRoot(delta, false);
      // A death clip may throw the body further than a square allows: its travel is compressed, never cut.
      const limit = this.reaction.rootLimit;
      if (this.rootBone && limit !== null && limit > 0) {
        const scale = this.rootBone.parent ? this.rootBone.parent.getWorldScale(this.ikGoal).x : 1;
        const dx = this.rootBone.position.x - this.rootRest.x, dz = this.rootBone.position.z - this.rootRest.z, travel = Math.hypot(dx, dz) * scale;
        if (travel > 1e-5) {
          const keep = limit * Math.tanh(travel / limit) / travel;
          this.rootBone.position.x = this.rootRest.x + dx * keep; this.rootBone.position.z = this.rootRest.z + dz * keep;
        }
      }
      // Codex's living rig moves the bones after the clip; the held arms follow the hands last.
      this.livingRig.apply(delta, 0, false, false);
      this.arms?.align();
    }
    this.updateToken(delta, 0);
    const hitGlow = this.hit * this.hit * 3;
    for (const material of this.materials) {
      const value = this.baseEmissive + hitGlow;
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 10);
      material.emissive.setHex(this.hit > 0.02 ? 0xff3418 : this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      const { materials, baseEmissive } = this.arms;
      for (let index = 0; index < materials.length; index += 1) {
        const base = baseEmissive[index] ?? 0;
        materials[index].emissiveIntensity += (base - materials[index].emissiveIntensity) * Math.min(1, delta * 10);
      }
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = Math.max(0, glowMaterial.opacity - delta * 0.6);
  }

  dispose(): void {
    this.wearWounds(null);
    this.contactIK?.reset();
    this.clearCombatTargets();
    this.livingRig.reset();
    this.clearUpper();
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
      this.mixer = null;
    }
    this.actions.clear();
    for (const material of this.materials) material.dispose();
    this.materials = [];
    if (this.arms) {
      // Weapon geometry is shared across the army; only the materials are ours.
      for (const material of this.arms.materials) material.dispose();
      this.arms = null;
    }
    (this.glow.material as THREE.Material).dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
    if (this.badge) {
      (this.badge.material as THREE.Material).dispose();
      this.badge = null;
    }
    if (this.tokenMaterial) {
      this.tokenMaterial.dispose();
      this.tokenMaterial = null;
      this.token = null;
    }
    // Each figure's skeleton is its own clone (SkeletonUtils.clone), and so is its bone texture: release it with the
    // figure, or every rebuild (undo, a quality change, a new game) orphaned thirty-two of them (A-25).
    this.container.traverse((node) => {
      const skinned = node as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
    });
    this.container.removeFromParent();
    this.container.clear();
  }
}

/** Exported for its test. */
/** How deep the paint's own light and dark are taken to stand, and how smooth the figure is under a lamp. */
const PAINT_RELIEF = { depth: 1.6, roughness: 0.64, anisotropy: 8 };

/**
 * Relief from the paint. The sculpts ship one colour picture and nothing else: no normal map, no roughness, so under
 * any lamp a breastplate, a mail shirt and a cheek answered alike, as painted clay. Their paint already holds the
 * relief as light and dark (plate edges, mail rings, folds), so it is read as height as well: the key lamp then
 * catches a plate's edge and loses a fold's depth. The surface is a little smoother with it, so that what the relief
 * turns toward the lamp shows a highlight. A material that brings its own normal or bump map is left alone.
 * The picture is also filtered along the grazing angle the play camera sees every figure at.
 */
export function applyPaintRelief(material: THREE.MeshStandardMaterial): void {
  const paint = material.map;
  if (!paint || material.normalMap || material.bumpMap) return;
  material.bumpMap = paint;
  material.bumpScale = PAINT_RELIEF.depth;
  material.roughness = Math.min(material.roughness, PAINT_RELIEF.roughness);
  if (paint.anisotropy < PAINT_RELIEF.anisotropy) { paint.anisotropy = PAINT_RELIEF.anisotropy; paint.needsUpdate = true; }
  material.needsUpdate = true;
}

export function applyFactionLook(
  material: THREE.MeshStandardMaterial,
  color: Faction,
  ownLivery: boolean,
): void {
  if (ownLivery && material.map) {
    // The sculpt was painted for this army — feathers, jade and gold would be
    // destroyed by a flat tint, so only the surface response is touched.
    material.color.setHex(0xffffff);
    material.roughness = Math.min(0.85, material.roughness * 0.9 + 0.18);
    material.metalness = Math.max(0.08, Math.min(0.4, material.metalness));
    material.emissive = new THREE.Color(color === "w" ? 0x2a4d94 : 0x711a12);
    material.emissiveIntensity = 0.05;
    // The side's glow is laid through the paint, never over it. Aethelgard's sculpts ship an emissive map (their
    // own texture); the Meshy sculpts of Solforiz, Korvenia and Kwind-09 ship none, and a bare emissive colour is
    // the same on every texel: under a dark arena's exposure it washed the whole figure blue or red.
    if (!material.emissiveMap) material.emissiveMap = material.map;
    material.envMapIntensity = 1.05;
    material.needsUpdate = true;
    return;
  }
  if (color === "w") {
    material.color.setHex(0xfff2dd);
    material.roughness = 0.34;
    material.metalness = 0.1;
    material.emissive = new THREE.Color(0x2a4d94);
  } else {
    material.color.setHex(0x34363d);
    material.roughness = 0.3;
    material.metalness = 0.55;
    material.emissive = new THREE.Color(0x711a12);
  }
  material.emissiveIntensity = 0.05;
  material.envMapIntensity = 1.15;
  material.needsUpdate = true;
}

/**
 * A clip holding only its first frame: the stance a beaten figure stops in (PieceView.holdStance). Always the
 * first frame, whatever moment the loop had reached, so the same ending poses every figure the same way.
 */
const stills = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();
function stillClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  let still = stills.get(clip);
  if (!still) {
    const tracks = clip.tracks.map((track) => {
      // The first key is the first frame (PieceView.poseFromIdle holds the same one).
      const value = Array.from(track.values.slice(0, track.getValueSize()));
      const Track = track.constructor as new (name: string, times: ArrayLike<number>, values: ArrayLike<number>) => THREE.KeyframeTrack;
      return new Track(track.name, [0], value);
    });
    still = new THREE.AnimationClip(`${clip.name}.still`, 1 / 30, tracks);
    stills.set(clip, still);
  }
  return still;
}

const colliderGeometries = new Map<PieceKind, THREE.BoxGeometry>();
function sharedColliderGeometry(kind: PieceKind): THREE.BoxGeometry {
  let geometry = colliderGeometries.get(kind);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(0.86, PIECE_HEIGHT[kind] * 1.1, 0.86);
    colliderGeometries.set(kind, geometry);
  }
  return geometry;
}

let colliderMaterial: THREE.MeshBasicMaterial | null = null;
function sharedColliderMaterial(): THREE.MeshBasicMaterial {
  // `visible: false` keeps the box out of every render pass while the
  // raycaster still hits it.
  if (!colliderMaterial) colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  return colliderMaterial;
}

let skinnedShadow: { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial } | null = null;
/**
 * A skinned figure casts its shadow with its own depth materials. Left to three's shadow pass, every caster shares one
 * MeshDepthMaterial, whose program is the skinned or the static one by the object drawn: drawn by turns, the arena's
 * meshes and the 32 figures switched it some 80 times a shadow pass, and each switch rebuilt its program parameters
 * and cache key (WebGLRenderer.getProgram: strings and objects, most of the shadow pass's garbage). The same materials
 * as three's own, kept for skinned casters only, so neither ever changes program.
 */
function shadowAsSkinned(mesh: THREE.Mesh): void {
  skinnedShadow ??= { depth: new THREE.MeshDepthMaterial(), distance: new THREE.MeshDistanceMaterial() };
  mesh.customDepthMaterial = skinnedShadow.depth;
  mesh.customDistanceMaterial = skinnedShadow.distance;
}

let discGeometry: THREE.PlaneGeometry | null = null;
function sharedDiscGeometry(): THREE.PlaneGeometry {
  if (!discGeometry) discGeometry = new THREE.PlaneGeometry(0.95, 0.95);
  return discGeometry;
}

let tokenGeometry: THREE.PlaneGeometry | null = null;
function sharedTokenGeometry(): THREE.PlaneGeometry {
  if (!tokenGeometry) tokenGeometry = new THREE.PlaneGeometry(1, 1);
  return tokenGeometry;
}

const ringTextures = new Map<Faction, THREE.Texture>();
function sharedRingTexture(faction: Faction): THREE.Texture {
  let texture = ringTextures.get(faction);
  if (!texture) {
    texture = groundLightTexture(FACTION_RING_SHAPE[faction]);
    ringTextures.set(faction, texture);
  }
  return texture;
}

let shadowTexture: THREE.Texture | null = null;
function sharedShadowTexture(): THREE.Texture {
  if (!shadowTexture) shadowTexture = contactShadowTexture();
  return shadowTexture;
}

/** One army's roster key — the ivory kingdom or the Sun Empire. */
export type TemplateKey = `${Faction}${PieceKind}`;

/**
 * Told about a clip that finished downloading after the board was already
 * standing, so live figures can be handed their strike/death/stride. `keys` is
 * every roster rendering that sculpt (a faction may borrow the other's).
 */
export type ClipListener = (keys: TemplateKey[], name: ClipName, clip: THREE.AnimationClip) => void;

/**
 * How many times a single clip URL is chased before it is written off. Each
 * request is already five retries deep (see {@link loadGltf}), so two of them
 * survives any transient drop — while a clip the server simply does not have
 * (a drill that was never generated) stops costing every later fight a
 * four-attempt round trip before the beat can start.
 */
const MAX_CLIP_ATTEMPTS = 2;

/**
 * Loads every generated sculpt once, normalises each to its board height and
 * hands out cheap clones.
 *
 * Each side musters an army *skin* — a whole civilisation with its own six
 * sculpts, clips, arms and voices. A kind the chosen skin does not carry (or
 * one whose download fails) falls back to the other side's sculpt and then to a
 * procedural figure, so the board always fills whatever the network does.
 */
export class PieceFactory {
  private templates = new Map<TemplateKey, Template>();
  /**
   * Every sculpt and clip comes through this manager, so {@link dispose} can
   * call off whatever is still downloading (A-07): a match left while it loads
   * no longer goes on fetching its armies.
   */
  private manager = new THREE.LoadingManager();
  private loader = new GLTFLoader(this.manager);
  private abortion = new AbortController();
  private loaded = false;
  /** Which army each side is currently mustering. */
  private skins: Record<Faction, ArmySkinId> = { ...DEFAULT_ARMY_SKINS };
  /**
   * The armies the templates on hand were actually built from, or null while
   * nothing has been mustered yet.
   */
  private mustered: Record<Faction, ArmySkinId> | null = null;
  /** True while a muster is downloading. */
  private mustering = false;
  /**
   * Serialises musters. Two of them writing into {@link templates} at once is
   * what used to split an army in half — see {@link muster}.
   */
  private queue: Promise<void> = Promise.resolve();
  /** Clip URLs per roster, so a clip can still be fetched long after start-up. */
  private clipSources = new Map<TemplateKey, PieceAnimationSet>();
  /** In-flight clip downloads, keyed by URL, so nothing is fetched twice. */
  private clipJobs = new Map<string, Promise<THREE.AnimationClip | null>>();
  /** Failed attempts per clip URL, so a missing file is not chased forever. */
  private clipFailures = new Map<string, number>();
  private clipListener: ClipListener | null = null;
  private warming: Promise<void> | null = null;
  /** Authored combat libraries by the rig they were baked for (see {@link COMBAT_ARCHETYPES}). */
  private combatLibraries = new Map<string, CombatAnimationLibrary>();
  private combatJobs = new Map<string, Promise<CombatAnimationLibrary | null>>();
  private combatRevision = 0;
  private combatListener: ((keys: TemplateKey[], library: CombatAnimationLibrary) => void) | null = null;

  get isReady(): boolean {
    return this.loaded;
  }

  /** Registers the sink for clips that land after the board is already up. */
  onClip(listener: ClipListener | null): void {
    this.clipListener = listener;
  }

  /** The army each side is mustering. */
  getSkins(): Record<Faction, ArmySkinId> {
    return { ...this.skins };
  }

  /**
   * Records the armies to muster.
   *
   * @returns whether a {@link reload} is needed to honour them. Before the
   *   first muster the answer is no even when the armies changed: the load that
   *   is about to run reads {@link skins} itself, and a reload racing it is
   *   precisely what used to leave one side of the board without its clips.
   */
  setSkins(next: Record<Faction, ArmySkinId>): boolean {
    const changed = next.w !== this.skins.w || next.b !== this.skins.b;
    this.skins = { w: next.w, b: next.b };
    if (!changed) return false;
    return this.mustered !== null || this.mustering;
  }

  /**
   * Marks the sculpts stale without disposing anything, so the scene can take
   * its figures down *before* {@link reload} frees the geometry they clone.
   */
  markStale(): void {
    this.loaded = false;
  }

  onCombatLibrary(listener: ((keys: TemplateKey[], library: CombatAnimationLibrary) => void) | null): void { this.combatListener = listener; }

  /**
   * Loads the authored combat library for the rig this roster actually renders.
   * The libraries are baked per skeleton (the Aethelgard and the Solforiz Pawn),
   * so they follow the army skin, not the side of the board; a rig with no
   * library keeps its ordinary strike and death.
   */
  async ensureCombatLibrary(faction: Faction, kind: PieceKind): Promise<void> {
    const key: TemplateKey = `${faction}${kind}`;
    const template = this.templates.get(key);
    const archetype = template?.combat;
    if (!archetype || !template.skinned || this.combatLibraries.has(archetype) ||
        !supportsCombatSource(archetype, this.clipSources.get(key)?.rigged)) return;
    const revision = this.combatRevision;
    try {
      const running = this.combatJobs.get(archetype) ?? loadCombatAnimationLibrary(archetype, this.loader);
      this.combatJobs.set(archetype, running);
      const library = await running;
      if (revision !== this.combatRevision || !library || this.combatLibraries.has(archetype)) return;
      this.combatLibraries.set(archetype, library);
      const keys = [...this.templates].filter(([key, entry]) => entry.skinned && entry.combat === archetype &&
        supportsCombatSource(archetype, this.clipSources.get(key)?.rigged)).map(([key]) => key);
      if (keys.length > 0) this.combatListener?.(keys, library);
    } catch (error) {
      if (revision !== this.combatRevision) return;
      this.combatJobs.delete(archetype);
      console.warn(`[pieces] authored combat library unavailable for ${archetype}`, error);
    }
  }

  /** Musters the armies {@link setSkins} asked for, unless they are already up. */
  load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    return this.enqueue(() => this.muster(onProgress));
  }

  /** Drops the current armies and musters the ones {@link setSkins} asked for. */
  reload(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    return this.enqueue(async () => {
      this.dropArmies();
      await this.muster(onProgress);
    });
  }

  /** Runs a job behind every muster already queued, so none of them overlap. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Frees the mustered armies and forgets everything keyed to them. */
  private dropArmies(): void {
    this.combatRevision += 1;
    this.combatJobs.clear();
    this.disposeTemplates();
    this.clipJobs.clear();
    this.clipFailures.clear();
    this.clipSources.clear();
    this.warming = null;
    this.mustered = null;
  }

  /**
   * Downloads the two armies and normalises every roster.
   *
   * Never allowed to run twice over the same map (see {@link enqueue}). The
   * shell records the armies it remembers from last visit and *then* loads,
   * which used to start a swap and the first download at the same time. Both
   * runs wrote into `templates`, so when both sides wore the same army the
   * borrowed roster was left pointing at the *first* run's sculpt while the
   * roster it borrowed from had been replaced by the second run's. The two
   * stopped sharing one `clips` object, and since a borrowed roster carried no
   * clip URLs of its own, that side could never fetch a stride, a strike or a
   * death again: it slid across the board and killed without swinging.
   */
  private async muster(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.mustered && this.mustered.w === this.skins.w && this.mustered.b === this.skins.b) {
      // Already standing in exactly these armies.
      this.loaded = true;
      onProgress?.(1, 1);
      return;
    }
    if (this.templates.size > 0) this.dropArmies();
    this.mustering = true;
    try {
      await this.download(onProgress);
      // Disposed while it downloaded: what arrived is freed, and nobody is told the armies are up.
      if (this.abortion.signal.aborted) { this.disposeTemplates(); throw new DOMException("The armies' load was called off.", "AbortError"); }
      this.mustered = { ...this.skins };
      this.loaded = true;
      // Never throws: a rig without its library keeps the ordinary strike. The Knights', Rooks' and Kings' libraries
      // are fetched with the Pawns', so their first fight does not wait on a download.
      await Promise.all((["p", "n", "r", "k"] as const).flatMap(kind => [this.ensureCombatLibrary("w", kind), this.ensureCombatLibrary("b", kind)]));
    } finally {
      this.mustering = false;
    }
  }

  private async download(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const kinds: PieceKind[] = ["k", "q", "b", "n", "r", "p"];
    // The side whose skin is loaded first keeps its own painted textures; when
    // both sides wear the same army the other one is re-tinted into livery, so
    // the two forces never become impossible to tell apart.
    const shared = this.skins.w === this.skins.b;
    const primary = shared ? ARMY_SKINS[this.skins.w].native : "w";
    const factions: Faction[] = primary === "b" ? ["b", "w"] : ["w", "b"];
    const jobs: { faction: Faction; kind: PieceKind }[] = [];
    for (const faction of factions) {
      if (shared && faction !== primary) continue;
      const skin = ARMY_SKINS[this.skins[faction]];
      for (const kind of kinds) {
        // Only load a roster where this army really carries a sculpt.
        if (!skin.animated[kind] && !skin.still[kind]) continue;
        jobs.push({ faction, kind });
      }
    }

    // The Grande Armée's weapons are generated meshes rather than primitives, and
    // a figure is armed the instant it is built — so they are downloaded *with*
    // the rosters, not after them, or the board stands up carrying box muskets
    // for the rest of the game.
    const armJobs = armSculptWarmJobs(
      new Set(Object.values(this.skins).map((skin) => ARMY_SKINS[skin].arsenal)),
    );

    let done = 0;
    const total = jobs.length + armJobs.length;
    await Promise.all([
      ...jobs.map(async ({ faction, kind }) => {
        try {
          this.templates.set(`${faction}${kind}`, await this.loadRoster(faction, kind));
        } catch (error) {
          console.warn(`[pieces] no sculpt for "${faction}${kind}"`, error);
        } finally {
          done += 1;
          onProgress?.(done, total);
        }
      }),
      ...armJobs.map(async (job) => {
        // Never throws: a sculpt that cannot be had leaves the figure armed from
        // primitives instead.
        await job();
        done += 1;
        onProgress?.(done, total);
      }),
    ]);

    // Anything still missing borrows the other side's figure.
    for (const kind of kinds) {
      for (const faction of factions) {
        const key: TemplateKey = `${faction}${kind}`;
        if (this.templates.has(key)) continue;
        const lender: TemplateKey = `${faction === "w" ? "b" : "w"}${kind}`;
        const other = this.templates.get(lender);
        const arsenal = ARMY_SKINS[this.skins[faction]].arsenal;
        if (other) {
          this.templates.set(key, { ...other, ownLivery: false, arsenal: other.arsenal });
          // The borrower is handed the lender's clip URLs under its own key too.
          // Both rosters share one `clips` object, so nothing is fetched twice —
          // but a roster that cannot name its own clips has no way back if that
          // sharing is ever lost, and it is the whole army wearing the same skin
          // as the other side that borrows.
          const lent = this.clipSources.get(lender);
          if (lent) this.clipSources.set(key, lent);
        } else {
          this.templates.set(key, this.normalize(buildProceduralFigure(kind), kind, {}, false, arsenal));
        }
      }
    }
  }

  /** Rigged sculpt when the army has one, else its static GLB. */
  private async loadRoster(faction: Faction, kind: PieceKind): Promise<Template> {
    const skin: ArmySkin = ARMY_SKINS[this.skins[faction]];
    const animated = skin.animated[kind];
    const still = skin.still[kind];
    if (animated) {
      try {
        const template = await this.loadAnimated(kind, animated, skin.arsenal);
        template.combat = COMBAT_ARCHETYPES[skin.id]?.[kind];
        // Remembered so the clips left for later can still be found by name.
        this.clipSources.set(`${faction}${kind}`, animated);
        return template;
      } catch (error) {
        console.warn(`[pieces] rig failed for "${faction}${kind}", using the still sculpt`, error);
      }
    }
    if (!still) throw new Error(`no sculpt url for ${faction}${kind}`);
    const gltf = await loadGltf(this.loader, still, 4, this.abortion.signal);
    return this.normalize(gltf.scene, kind, {}, true, skin.arsenal);
  }

  /**
   * Rigged sculpt + the clips the opening needs. The clips share the auto-rig
   * skeleton, so they bind straight onto the rigged scene — no retargeting.
   */
  private async loadAnimated(kind: PieceKind, set: PieceAnimationSet, arsenal: ArsenalId): Promise<Template> {
    const rigged = await loadGltf(this.loader, set.rigged, 5, this.abortion.signal);
    const clips: PieceClips = {};
    await Promise.all(
      OPENING_CLIPS.map(async (name) => {
        const url = set[name];
        if (!url) return;
        const clip = await this.fetchClip(url, name, set.events?.[name]);
        if (clip) clips[name] = clip;
      }),
    );
    return this.normalize(rigged.scene, kind, clips, true, arsenal);
  }

  /** One clip GLB — queued, retried, and never allowed to throw at the caller. */
  private async fetchClip(url: string, name: ClipName, eventsUrl?: string): Promise<THREE.AnimationClip | null> {
    try {
      const gltf = await loadGltf(this.loader, url, 5, this.abortion.signal);
      const source = gltf.animations[0];
      if (!source) return null;
      const clip = source.clone();
      clip.name = name;
      if (eventsUrl) {
        try {
          const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([AbortSignal.timeout(10000), this.abortion.signal]) : AbortSignal.timeout(10000);
          const response = await fetch(eventsUrl, { signal });
          if (!response.ok || !installCombatEvents(clip, await response.json())) throw new Error("Invalid animation sidecar");
        } catch (error) { console.warn(`[pieces] events unavailable for ${name}; retaining legacy timing`, error); }
      }
      return clip;
    } catch (error) {
      console.warn(`[pieces] clip "${name}" unavailable (${url})`, error);
      return null;
    }
  }

  /**
   * Pulls in the clips the opening did not need, a wave at a time and only two
   * downloads wide, in {@link CLIP_ORDER}: strides first (the opening move is
   * made seconds after the board stands up), then the strikes and deaths, then
   * the firing drills. Every clip that lands is pushed straight onto the
   * figures already standing on the board.
   */
  warmClips(): Promise<void> {
    if (!this.warming) this.warming = this.runWarm();
    return this.warming;
  }

  private async runWarm(): Promise<void> {
    const keys = [...this.clipSources.keys()];
    for (const name of CLIP_ORDER) {
      if (OPENING_CLIPS.includes(name)) continue;
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < keys.length && !this.abortion.signal.aborted) {
          const key = keys[next];
          next += 1;
          await this.requestClip(key, name);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, keys.length) }, lane));
    }
  }

  /**
   * Guarantees a roster has a clip before the game needs it. A capture asks for
   * the strike and the death here, so a request dropped during the opening burst
   * costs the fight a moment rather than its animation.
   *
   * @returns whether the clip is now bound to that roster
   */
  async ensureClip(faction: Faction, kind: PieceKind, name: ClipName): Promise<boolean> {
    return (await this.requestClip(`${faction}${kind}`, name)) !== null;
  }

  private requestClip(key: TemplateKey, name: ClipName): Promise<THREE.AnimationClip | null> {
    const template = this.templates.get(key);
    const existing = template?.clips[name];
    if (existing) return Promise.resolve(existing);
    const url = template ? this.clipUrl(template, key, name) : undefined;
    if (!template || !url) return Promise.resolve(null);

    const running = this.clipJobs.get(url);
    // A download started for another roster still has to land on this one: two
    // rosters asking for the same file do not always share one `clips` object.
    if (running) return running.then((clip) => (clip ? this.bindClip(url, name, clip) : null));
    if ((this.clipFailures.get(url) ?? 0) >= MAX_CLIP_ATTEMPTS) return Promise.resolve(null);

    // The Blender marker sidecar belongs to whichever roster owns this clip URL.
    const source = [key, ...this.sharingKeys(template)].map(owner => this.clipSources.get(owner)).find(set => set?.[name] === url);
    const job = this.fetchClip(url, name, source?.events?.[name]).then((clip) => {
      if (!clip) {
        // Not cached as a failure: the next capture gets another attempt, up to
        // MAX_CLIP_ATTEMPTS of them.
        this.clipJobs.delete(url);
        this.clipFailures.set(url, (this.clipFailures.get(url) ?? 0) + 1);
        return null;
      }
      return this.bindClip(url, name, clip);
    });
    this.clipJobs.set(url, job);
    return job;
  }

  /**
   * Binds a downloaded clip onto **every** roster that was waiting for that URL
   * and reports all of them to the listener, so no figure is left without a
   * stride merely because another roster asked for the same file first.
   */
  private bindClip(url: string, name: ClipName, clip: THREE.AnimationClip): THREE.AnimationClip {
    const keys: TemplateKey[] = [];
    for (const [key, entry] of this.templates) {
      // Rosters sharing one `clips` object are filled by a single write.
      if (entry.clips[name] === clip) {
        keys.push(key);
        continue;
      }
      if (entry.clips[name] || this.clipUrl(entry, key, name) !== url) continue;
      entry.clips[name] = clip;
      keys.push(key);
    }
    if (keys.length > 0) this.clipListener?.(keys, name, clip);
    return clip;
  }

  /**
   * Clip URL for a roster. A faction with no sculpt of its own renders the other
   * army's template, so the URL is looked up under whichever roster owns it.
   */
  private clipUrl(template: Template, key: TemplateKey, name: ClipName): string | undefined {
    const own = this.clipSources.get(key)?.[name];
    if (own) return own;
    for (const shared of this.sharingKeys(template)) {
      const url = this.clipSources.get(shared)?.[name];
      if (url) return url;
    }
    return undefined;
  }

  /** Every roster key rendering this template. */
  private sharingKeys(template: Template): TemplateKey[] {
    const keys: TemplateKey[] = [];
    for (const [key, entry] of this.templates) {
      if (entry.clips === template.clips) keys.push(key);
    }
    return keys;
  }

  private normalize(
    scene: THREE.Object3D,
    kind: PieceKind,
    clips: PieceClips,
    ownLivery: boolean,
    arsenal: ArsenalId,
  ): Template {
    const box = measureModel(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(0.0001, size.y);
    const scale = PIECE_HEIGHT[kind] / height;

    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const offset = new THREE.Vector3(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    let skinned = false;
    scene.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });

    return { scene, scale, offset, skinned, clips, unit: height, baseY: box.min.y, ownLivery, arsenal };
  }

  create(kind: PieceKind, color: Faction, options: PieceVisualOptions): PieceView {
    const template = this.templates.get(`${color}${kind}`);
    if (!template) throw new Error(`piece template "${color}${kind}" not loaded`);

    // Skinned meshes must never share a skeleton between instances.
    const model = template.skinned ? SkeletonUtils.clone(template.scene) : template.scene.clone(true);
    model.scale.setScalar(template.scale);
    model.position.copy(template.offset);

    const view = new PieceView(
      kind,
      color,
      model,
      options,
      template.clips,
      template.unit,
      template.baseY,
      template.ownLivery,
      template.arsenal,
    );
    const library = template.skinned && template.combat && supportsCombatSource(template.combat, this.clipSources.get(`${color}${kind}`)?.rigged)
      ? this.combatLibraries.get(template.combat) : undefined;
    if (library) view.installCombatLibrary(library);
    view.setFacing(new THREE.Vector3(0, 0, color === "w" ? -1 : 1));
    return view;
  }

  dispose(): void {
    // Whatever is still downloading is called off, and nothing is tried again.
    this.abortion.abort();
    this.manager.abort();
    this.combatRevision += 1;
    this.clipListener = null;
    this.combatListener = null;
    this.combatLibraries.clear();
    this.combatJobs.clear();
    this.clipJobs.clear();
    this.clipFailures.clear();
    this.clipSources.clear();
    this.mustered = null;
    this.disposeTemplates();
  }

  /**
   * Frees the sculpts. Clones share their template's geometry, so every live
   * figure must be gone before this runs (see {@link markStale}).
   */
  private disposeTemplates(): void {
    this.loaded = false;
    const seen = new Set<THREE.Object3D>();
    for (const template of this.templates.values()) {
      // Both sides may render the same sculpt; free it once.
      if (seen.has(template.scene)) continue;
      seen.add(template.scene);
      disposeSculpt(template.scene);
    }
    this.templates.clear();
  }
}

/**
 * Frees a sculpt's geometry, materials and the textures its materials hold
 * (A-25: the textures used to be left on the card each time an army was
 * dropped). Each is freed once however many meshes share it. Only the GPU copy
 * goes: a texture still in use elsewhere is simply uploaded again.
 */
export function disposeSculpt(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

/**
 * Primitive-built humanoid used only if a generated sculpt fails to download —
 * head, torso, arms and a kind-specific silhouette so the game stays playable.
 */
export function buildProceduralFigure(kind: PieceKind): THREE.Object3D {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.5, metalness: 0.1 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.12, 20), stone);
  base.position.y = 0.06;
  group.add(base);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.44, 6, 14), stone);
  body.position.y = 0.48;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), stone);
  head.position.y = 0.88;
  group.add(head);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 8), stone);
    arm.position.set(side * 0.23, 0.55, 0);
    arm.rotation.z = side * 0.24;
    group.add(arm);
  }

  if (kind === "k" || kind === "q") {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.11, kind === "k" ? 0.16 : 0.1, 8, 1, true),
      stone,
    );
    crown.position.y = kind === "k" ? 1.03 : 0.99;
    group.add(crown);
  }
  if (kind === "b") {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 12), stone);
    hood.position.y = 0.94;
    group.add(hood);
  }
  if (kind === "r") {
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 8), stone);
    helm.position.y = 1;
    group.add(helm);
  }
  if (kind === "n") {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 8), stone);
    plume.position.set(0, 1.04, -0.02);
    group.add(plume);
  }
  return group;
}
