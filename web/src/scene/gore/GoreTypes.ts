/**
 * Gore Director data model. Plain data only: no three.js, no engine, so the
 * planner and its ledger run in node tests (shared/play/gore-director.test.ts).
 *
 * The Combat Director decides the fight; the Gore Director decides what that
 * fight leaves visible. A {@link GoreEvent} is one weapon contact, described
 * reproducibly; a {@link GorePlan} is everything that contact will show, fixed
 * up front. Nothing downstream rolls a die or reads a frame time.
 *
 * Classic chess rule: a capture is not a death. Everything here is match
 * presentation and is removed by Undo and reset; no plan carries an injury
 * that outlives the match (see docs/play/GORE_SYSTEM.md).
 */
import type { QualityPreset } from "../quality";
import type { KillMoment } from "./goreTiers";
import type { GoreWoundKind, WoundMaskPlan } from "./woundMaskPlan";

export type { GoreWoundKind } from "./woundMaskPlan";

export const GORE_VERSION = 1;

export interface Vec3 { x: number; y: number; z: number }

export type GoreKind = "p" | "n" | "b" | "r" | "q" | "k";
/** Army skin ids, as in combat/choreography.ts. */
export type GoreKingdom = "ivory" | "sun" | "empire" | "kwind";
export type GoreIntensity = "minimal" | "cinematic" | "full";
export const GORE_INTENSITIES: readonly GoreIntensity[] = ["minimal", "cinematic", "full"];
export const DEFAULT_GORE_INTENSITY: GoreIntensity = "cinematic";

/** What the weapon met. The choreography's `shieldFace` / `weaponTip` map onto `shield` / `weapon`. */
export type GoreAnchor = "torso" | "head" | "shield" | "weapon" | "ground";
export type GoreWeapon = "spear" | "sword" | "lance" | "mace" | "axe" | "staff" | "musket" | "fist";
/** kill: the decisive blow. blocked: stopped by shield or weapon. glance: touched, did not go in. */
export type GoreOutcome = "kill" | "blocked" | "glance";
export type ShieldMaterial = "wood" | "iron";

export interface GoreEvent {
  /** Unique within a match: `impactIdOf(ply, contactId)`. */
  impactId: string;
  /** `goreSeed(fightSeed, contactId)`. */
  seed: number;
  /** Half-moves played when this capture is on the board (1 for White's first move). */
  ply: number;
  /**
   * This impact follows others in the same move (a summon's second wound and on): what the move's earlier impacts
   * left stays. Without it, beginning ply N first clears whatever plies N and later left (Undo then the same
   * capture again, a replay stepping back).
   */
  follows?: boolean;
  attacker: { kind: GoreKind; kingdom: GoreKingdom; weapon: GoreWeapon };
  defender: { kind: GoreKind; kingdom: GoreKingdom; shield?: ShieldMaterial | null };
  /**
   * The wound this contact opens, where its source knows better than the weapon does (a summon's bite or tearing,
   * a spell's ice running the body through). Default: the weapon's (woundMaskPlan.ts `WEAPON_WOUND`).
   */
  wound?: GoreWoundKind;
  /**
   * What kind of kill it is, for the gore tier (goreTiers.ts): steel, powder, a spell or a Queen's summon, and
   * whether it mates or takes a side's last piece. Default: steel, neither.
   */
  moment?: Pick<KillMoment, "style" | "mate" | "last">;
  contact: {
    /** World point where the weapon meets the surface. */
    point: Vec3;
    /** Surface normal there, pointing out of the defender. */
    normal: Vec3;
    /** Unit travel direction of the weapon at contact. */
    direction: Vec3;
    anchor: GoreAnchor;
  };
  /** The Combat Director's `plan.power` (0..2). */
  power: number;
  outcome: GoreOutcome;
  intensity: GoreIntensity;
  quality: QualityPreset;
  /** `captureCinematics`: whether capture fights are staged at all (the player's setting); default true. */
  flags: { menuBoard: boolean; reducedMotion: boolean; tactical: boolean; captureCinematics?: boolean };
  /** Board plane and square pitch. Defaults: BOARD_TOP 0, TILE 1.02, eight squares. */
  board?: { top?: number; tile?: number; squares?: number };
  /** The attacker's torso at the moment of contact (world): what flies back out of the wound is aimed at it. Default: straight back along the blow. */
  killer?: Vec3;
  /** Where the body is expected to come to rest (board plane). Default: just past the contact, along the blow. */
  rest?: { x: number; z: number };
}

export type SurfaceMaterial = "skin" | "cloth" | "mail" | "plate" | "wood" | "iron" | "steel" | "stone";
export type SurfaceResponse = "blood" | "sparks" | "splinters" | "none";

export interface ImpactSurface {
  /** Table used: "wp" or "bp" for the two Pawns, `<kingdom>.<kind>` for every other figure, `generic.<kind>` for a kingdom the tables do not know. */
  rig: string;
  region: GoreAnchor;
  material: SurfaceMaterial;
  /** Flesh lies under this surface. */
  flesh: boolean;
  /** The weapon went through to flesh. Without this nothing bleeds. */
  breached: boolean;
  response: SurfaceResponse;
  /** How far outside the anchor bone the visible surface lies, in squares. */
  surfaceOffset: number;
}

/** A directional burst. Its droplets are expanded on demand by `expandSpray`, never stored. */
export interface SprayPlan {
  id: "spray" | "spurt" | "drip";
  seed: number;
  /** Seconds after the contact. */
  delay: number;
  origin: Vec3;
  /** Unit axis of the cone. */
  axis: Vec3;
  /** Half-angle of the cone, radians. */
  spread: number;
  droplets: number;
  mist: number;
  speed: readonly [number, number];
  /** Droplet radius, world units. */
  size: readonly [number, number];
}

export interface StainPlan {
  /** Seconds after the contact at which the stain appears (its droplet's landing). */
  at: number;
  x: number; z: number;
  radius: number;
  /** Radians about the board normal; the long axis follows the droplet's travel. */
  rotation: number;
  /** Length over width, 1 for a round drop. */
  stretch: number;
  /** Shape seed, 0..1. */
  shape: number;
  source: "contact" | "spray" | "drip";
}

export interface WoundPlan {
  kind: GoreWoundKind;
  anchor: GoreAnchor;
  /** World position at the moment of contact, offset applied. The renderer binds it to the anchor bone. */
  point: Vec3;
  /** Offset from the contact point in the contact frame: x right, y up, z out along the normal. World units. */
  offset: Vec3;
  /** Unit normal the wound faces (world, at the moment of contact). */
  normal: Vec3;
  /** Radius, world units. */
  size: number;
  shape: number;
  /** Seconds over which blood runs down from it. */
  bleed: number;
  /**
   * Where the figure cannot wear a wound mask (below): skin, a decal projected onto the defender's skinned mesh and
   * bound to its skeleton, so it conforms to the body and bends with it; bone, a quad riding on the anchor bone (the
   * low preset).
   */
  bind: "skin" | "bone";
  /**
   * The wound painted into the defender's own damage mask (Milestone 03, gore/WoundMasks.ts): what its strokes and
   * runs of blood are, at its gore tier. Null where nothing is painted (Minimal, the map, the menu's board). Where
   * it is painted no decal or quad is laid for the wound.
   */
  mask: WoundMaskPlan | null;
}

/** Blood thrown back onto the killer: a small decal on the weapon or on the armour facing the wound. */
export interface SplashPlan {
  target: "weapon" | "attacker";
  /** Seconds after the contact. */
  at: number;
  /** attacker: unit world direction the droplet leaves the wound in. The mark is where it first meets the body. */
  direction: Vec3;
  /** weapon: distance back from the tip along the shaft, world units. */
  along: number;
  /** Radius, world units. */
  size: number;
  shape: number;
}

export interface PoolPlan {
  /** Planned centre under the body. The stage may pass the body's real resting point at the landing. */
  x: number; z: number;
  /** The pool starts this many seconds after the body lands. */
  delay: number;
  /** Seconds to reach (about) its full size. 0: appears static at full size. */
  grow: number;
  maxRadius: number;
  /** 0..1: how much further the blood runs along the lines between squares than across the stone. */
  grooveBias: number;
  shape: number;
}

export interface WeaponStainPlan {
  anchor: "weapon";
  /** World position at the moment of contact (the weapon's tip). */
  point: Vec3;
  /** Radius, world units. */
  size: number;
  shape: number;
  /** Seconds it stays before fading; null: until Undo or reset. */
  linger: number | null;
}

export interface GorePlan {
  version: typeof GORE_VERSION;
  impactId: string;
  ply: number;
  seed: number;
  surface: ImpactSurface;
  /** Why the plan is empty, when it is. */
  silent: "menu" | "king" | "no-breach" | null;
  sprays: SprayPlan[];
  stains: StainPlan[];
  wound: WoundPlan | null;
  pool: PoolPlan | null;
  weaponStain: WeaponStainPlan | null;
  /** Decals on the attacker and the weapon. They share the weapon stain's `linger`. */
  splashes: SplashPlan[];
  /** Always "presentation": blood never records an injury or a death. */
  consequence: "presentation";
}

export const impactIdOf = (ply: number, contactId: string): string => `${ply}:${contactId}`;

/** FNV-1a mix of the fight's seed and the contact id. */
export function goreSeed(fightSeed: number, contactId: string): number {
  let hash = (0x811c9dc5 ^ (fightSeed >>> 0)) >>> 0;
  hash = Math.imul(hash, 0x01000193) >>> 0;
  for (let i = 0; i < contactId.length; i += 1) { hash ^= contactId.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

/** Same generator as the Combat Director's, kept local so gore has no import cycle with combat. */
export function goreRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
