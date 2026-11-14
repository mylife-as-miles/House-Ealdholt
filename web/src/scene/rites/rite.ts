/**
 * What a Queen's summon is, to the match that plays it.
 *
 * A Queen who takes anything larger than a Pawn does not throw a spell: she calls on what her kingdom keeps.
 * Aethelgard's Queen calls her wyvern; Solforiz's a phoenix of fire and sun; Korvenia's an army of shadows;
 * Kwind-09's the undead. Each is a rite: a thing that comes, kills the piece in its own way, and leaves.
 *
 * As with a spell (vfx/spells/spell.ts), a rite only draws and moves what it brings. The match owns the rest:
 * it kills the victim on the frame {@link RiteState.struck} first turns true, carries the body wherever the rite
 * holds it, lets it fall when the rite lets go, throws the blood the rite asks for, sounds it, shakes the camera
 * and frames it. When the rite is done the body lies on the board, and is taken like any other (the Claiming).
 * So a rite can be built, seen and tested with no match at all.
 *
 * A rite is the same on every machine and in every capture: its dice come from {@link RiteCast.seed}.
 */
import type * as THREE from "three";
import type { PieceKind } from "../../core/types";
import type { GoreWoundKind } from "../gore/woundMaskPlan";
import type { QualityPreset } from "../quality";
import type { SpellLook } from "../spellLook";
import type { Point } from "../vfx/mystic/beamPlan";
import type { SpellGlow } from "../vfx/spells/spell";
import type { VfxArmy } from "../vfx/wiring";

/**
 * A figure of the Queen's own army, lent to a rite for as long as it lasts: a shadow soldier, a risen corpse. The
 * match makes it (her kingdom's own sculpt and clips), animates it every frame, and frees it with the rite. The
 * rite places it (`object`'s position and rotation, in the scene) and asks for its clips; it may change how it
 * looks (materials, visibility), but must free whatever it made itself, and must not dispose the figure's own.
 */
export interface RiteTroop {
  readonly object: THREE.Object3D;
  /** How tall it stands, in scene units. */
  readonly height: number;
  /**
   * Plays one of its clips: `idle`, `walk` and `run` loop (`rate` is steps a second for the strides), `attack`
   * and `death` play once. Returns the clip's length in seconds, 0 when the figure has no such clip.
   */
  play(clip: "idle" | "walk" | "run" | "attack" | "death", rate?: number): number;
  /** The figure's own fade (1 solid, 0 gone) and burn-away (0 whole, 1 gone), on all its materials at once. */
  setOpacity(value: number): void;
  setDissolve(value: number): void;
}

/**
 * How the piece dies under the rite. The match gives each the Violence setting's form of it
 * (death/deathStyle.ts riteDeathStyle):
 * - `held`: limp in the rite's grip, carried, and let fall when the rite lets go (a wyvern's talons);
 * - `held-burn`: the same, and set alight in the grip as it is taken: it burns as it is carried and lies a husk
 *   where it falls (a phoenix's talons). At Minimal it is carried unburnt;
 * - `burn`: set alight where it stands, as a fire kill;
 * - `burst`: torn apart where it stands (Full), thrown down (Cinematic);
 * - `thrown`: knocked down by the blow.
 */
export type RiteDeath = "held" | "held-burn" | "burn" | "burst" | "thrown";

/** One summon: who calls, on whom, and how it should be drawn. */
export interface RiteCast {
  /** Where the Queen stands (the stone under her) and where she holds what she casts with, asked every frame. */
  queen: Point;
  hand(out: THREE.Vector3): THREE.Vector3;
  /** The victim: its rank, how tall it stands, the stone under it, and where its chest is, asked every frame. */
  victim: PieceKind;
  victimHeight: number;
  stone: Point;
  chest(out: THREE.Vector3): THREE.Vector3;
  /** Every other figure standing on the board: nothing the rite brings should pass through one, and a body is not dropped on one. */
  standing: readonly { x: number; z: number }[];
  /** Where the player watches from when the Queen calls: what the rite does can be turned toward it. */
  viewer: Point;
  /**
   * Lends `count` figures of the Queen's own army of rank `kind`, standing hidden (`object.visible` false) at the
   * board's centre until the rite places and shows them (see {@link RiteTroop}). At most 24 are lent in all. The
   * match frees them when the rite is disposed. Asked for when the
   * rite is made, or later; under the brief form it may lend fewer, or none.
   */
  muster(kind: PieceKind, count: number): RiteTroop[];
  /**
   * The Violence setting. Blood is the match's to draw (RiteState.wounds go through its gore system, which already
   * answers to this); a rite reads it for what else it shows of a body being torn: at `minimal`, nothing is.
   */
  violence: "minimal" | "cinematic" | "full";
  /** The Queen's kingdom and its colours. */
  army: VfxArmy;
  look: SpellLook;
  quality: QualityPreset;
  /** Reduced motion or fast play: a short form in which nothing rushes, flashes or shakes, and the body is not carried. */
  brief: boolean;
  seed: number;
  /** The board: the height of the stone, the width of a square, and how far from its centre the hall's wall stands. */
  boardTop: number;
  tile: number;
  hall: number;
}

/** Where the rite holds the body: the match puts the victim's chest there, turned as given. */
export interface RiteHold {
  position: Point;
  /** The body's own up and forward while it is held (unit vectors), so it hangs as the thing that holds it would have it. */
  up: Point;
  forward: Point;
}

/**
 * A wound the rite opens this frame. The match draws it through its gore system as a killing blow (spray, a wound
 * on the body, stains, and a pool where the body comes to rest), sounds it, and shows none of it at Minimal.
 */
export interface RiteWound {
  at: Point;
  /** Which way the blood goes (unit vector), and how much of it: about 0.3 for a nick, 1 for a killing blow, more for a tearing. */
  direction: Point;
  power: number;
  /** What it opens on the body (gore/woundMaskPlan.ts): talons pierce, jaws bite, the dead tear, a blade slashes. Default: a slash. */
  kind?: GoreWoundKind;
}

/** A sound the rite asks for this frame, by the name the match's sound bank knows it by (see docs/play/SUMMONS.md). */
export interface RiteSound {
  cue: string;
  at: Point;
  /** 0..1 and up; 1 is the cue as recorded. */
  volume: number;
}

export interface RiteState {
  /** True from the frame the killing blow lands. The match kills the victim on the first frame it is true. */
  struck: boolean;
  /** Where the killing blow comes from and how hard, from the frame it lands: a thrown or torn body goes away from it. */
  blow: { from: Point; power: number } | null;
  /** Where the body is held this frame, or null when the rite does not have it (before the blow, after it lets go, or a rite that never lifts it). */
  hold: RiteHold | null;
  /** True from the frame the body is let go, if it was ever held: the match lets it fall from where it was. */
  released: boolean;
  /** True once nothing of the rite is left to draw; the match may dispose it. */
  done: boolean;
  /** Wounds opened and sounds asked for on this frame only. Usually empty. */
  wounds: readonly RiteWound[];
  sounds: readonly RiteSound[];
  /** Camera shake to add this frame, 0 for none. Always 0 in the brief form. */
  shake: number;
  /** The one light the rite asks for this frame, or null. */
  glow: SpellGlow | null;
  /**
   * The beat of the rite the camera is on, and what it should keep in frame through that beat (where things will
   * be, not only where they are: a hover it is about to climb to). The match frames these from the player's side
   * (rites/riteShot.ts), and moves on each time `shot` changes. An empty frame leaves the camera where it is.
   */
  shot: number;
  frame: readonly Point[];
  /**
   * Degrees the camera looks down at what this beat frames (up, if negative), where the beat wants it whatever the
   * height of what it frames (rites/riteShot.ts look): the phoenix's body burning in the sky is seen from under it.
   */
  look?: number;
  /** The beat is watched up close (rites/riteShot.ts `close`): the eye may come near what it frames, a body in talons. */
  close?: boolean;
  /** The side the camera watches this beat from (rites/riteShot.ts facing), where the player's side would hide it. */
  facing?: Point;
}

export interface RiteEffect {
  /** Everything the rite draws. The match adds it to the scene and removes it on dispose. */
  readonly object: THREE.Object3D;
  /** How the piece dies under it. */
  readonly death: RiteDeath;
  /** Resolves when the rite can be drawn (a model it needs has loaded). The match waits for it before the Queen calls. */
  readonly ready: Promise<void>;
  /** Seconds from the call to the killing blow, and until nothing is left. Fixed when the rite is made. */
  readonly strikeAt: number;
  readonly duration: number;
  /** Advances the rite by `seconds` (a frame's delta). `height` is the drawing buffer's height in pixels. */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): RiteState;
  /** Keeps its colours from clipping to white in a bright exposure (vfxGlow in vfx/wiring.ts). */
  setGain(gain: number): void;
  dispose(): void;
}

/** Makes one summon. Everything it allocates is released by the effect's dispose. */
export type RiteFactory = (cast: RiteCast) => RiteEffect;

/** A rite as the match lists it: one per kingdom. */
export interface RiteEntry {
  id: string;
  /** What a player would call it. */
  name: string;
  army: VfxArmy;
  make: RiteFactory;
}
