/**
 * What every spell in the library is, to the match that plays it.
 *
 * A spell is drawn light and matter between a caster and a victim. It owns nothing else: the match decides who
 * casts what, kills the victim when {@link SpellState.struck} first turns true, marks the stone, sounds the blow
 * and shakes the camera by what the spell reports. So a spell can be built, seen and tested with no match at all.
 *
 * The pattern is the mystic kit's (vfx/mystic): the arithmetic of a spell lives in a plan module with no Three.js
 * and node tests; the drawing lives beside it and is placed by uniforms, not rebuilt each frame. A spell is the
 * same on every machine and in every capture, so its dice come from {@link SpellCast.seed}, never Math.random().
 *
 * Many of the spells are adapted from the effect sandboxes of mohamedachrefelouafi (MIT); see
 * docs/play/SPELL_LIBRARY.md and public/licenses/achrefelouafi-vfx-MIT.txt.
 */
import type * as THREE from "three";
import type { PieceKind } from "../../../core/types";
import type { QualityPreset } from "../../quality";
import type { SpellLook } from "../../spellLook";
import type { VfxArmy } from "../wiring";
import type { Point } from "../mystic/beamPlan";

/** One cast: who, at whom, and how it should be drawn. */
export interface SpellCast {
  /** Where the spell leaves the caster (a hand, a staff head), asked every frame so a moving arm carries it. */
  origin(out: THREE.Vector3): THREE.Vector3;
  /** The victim's chest, and the stone under the victim. */
  target: Point;
  stone: Point;
  /** The caster's kingdom, its colours, and the rank that casts: a Queen's spell is larger than a Bishop's. */
  army: VfxArmy;
  look: SpellLook;
  caster: PieceKind;
  /** How much is behind it: 1 for a Bishop, up to about 1.75 for a Queen. Sizes and counts scale by it. */
  power: number;
  /** The quality tier. The lowest has no bloom and no lights, so a spell must read by its own drawn glow. */
  quality: QualityPreset;
  /** Reduced motion or fast play: a short form in which nothing rushes, flashes or shakes. */
  brief: boolean;
  /** Dice for this cast. */
  seed: number;
  /** The board: the height of the stone and the width of a square, in scene units. */
  boardTop: number;
  tile: number;
  /**
   * The Violence setting. The match draws the blood of any wound a spell reports (SpellState.wounds) through its
   * gore system, which already answers to it; a spell reads it for what else it shows of a body run through
   * (blood on its blades): at `minimal`, nothing.
   */
  violence: "minimal" | "cinematic" | "full";
}

/**
 * How the piece dies under a spell (SpellEntry.death). The match gives each the Violence setting's form:
 * - `burn`, the default: a fire kill. Set alight (Cinematic and Full), torn apart by a Queen's blast (Full), or a
 *   short flash and a fade (Minimal); see death/deathStyle.ts.
 * - `pierce`: run through. From the blow the spell holds the body up on what pierced it (SpellState.pinned) and
 *   reports the wounds it opens (SpellState.wounds); when it lets go the body falls, a ragdoll where the physics
 *   deaths have loaded, else its own death. Never burnt. At Minimal no blood is drawn.
 */
export type SpellDeath = "burn" | "pierce";

/** A wound a spell opens: where, which way the blood goes (unit vector), and how much (1 a killing blow, more for a deep one). */
export interface SpellWound {
  at: Point;
  direction: Point;
  power: number;
}

/** A light the spell would like to throw, if the match has one free. */
export interface SpellGlow {
  position: Point;
  colour: number;
  /** 0 and up; about 1 is the spell at rest, several is the flash of the blow. */
  intensity: number;
  /** How far it reaches, in scene units. */
  reach: number;
}

/** What the spell is doing now, for the match to act on. */
export interface SpellState {
  /** True from the frame the blow lands. The match kills the victim on the first frame it is true. */
  struck: boolean;
  /** True once nothing of the spell is left to draw; the match may dispose it. */
  done: boolean;
  /** Camera shake to add this frame, 0 for none. Always 0 in the brief form. */
  shake: number;
  /** The one light the spell asks for this frame, or null. */
  glow: SpellGlow | null;
  /** A `pierce` spell: true while it holds the body up on what pierced it, from the blow until it lets go. */
  pinned?: boolean;
  /** Wounds opened on this frame only (a `pierce` spell), drawn by the match's gore system as killing blows. */
  wounds?: readonly SpellWound[];
  /**
   * An ice spell: true from the frame its ice starts to melt off the stone. A spell whose entry's mark is `thaw` has its
   * mark laid then (stage.ts SpellEvents.thaw), where the ice lay, and not under the blow.
   */
  thawing?: boolean;
}

export interface SpellEffect {
  /** Everything the spell draws. The match adds it to the scene and removes it on dispose. */
  readonly object: THREE.Object3D;
  /** Seconds from the cast to the blow landing. Fixed when the spell is made, so the match can time the fall. */
  readonly strikeAt: number;
  /** Seconds from the cast until nothing is left. */
  readonly duration: number;
  /** Advances the spell. `height` is the drawing buffer's height in pixels, for anything sized on screen. */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState;
  /** Keeps its colours from clipping to white in a bright exposure (vfxGlow in vfx/wiring.ts). */
  setGain(gain: number): void;
  dispose(): void;
}

/** Makes one cast of a spell. Everything it allocates is released by the effect's dispose. */
export type SpellFactory = (cast: SpellCast) => SpellEffect;

/**
 * What a spell leaves on the stone, for the scorch system, in the kingdom's own look (vfx/scorchPlan.ts): `burn` is laid
 * under the blow; `thaw` as the spell's ice melts off the stone (SpellState.thawing), so the sear is what the ice leaves
 * behind it; `none` leaves nothing.
 */
export type SpellMark = "burn" | "thaw" | "none";

/** A spell as the library lists it. */
export interface SpellEntry {
  id: string;
  /** What a player would call it. */
  name: string;
  make: SpellFactory;
  mark: SpellMark;
  /** How the piece dies under it: `burn` when not given. */
  death?: SpellDeath;
  /**
   * How the match's camera frames it (rites/spellShot.ts). `air`: how much of the air over the piece's head its shot
   * keeps while it gathers, in board units, for what it brings down from above or hangs over the piece (the sun
   * pillar's column, the fire portal's ring); about half a square when not given.
   */
  air?: number;
  /**
   * Its travel from the hand to the piece is the show (a beam, a bolt) and it gathers in the hand: its shot opens over
   * the caster's shoulder and follows it to the piece as it is thrown.
   */
  travels?: boolean;
  /** It raises a row of solids along the stone from the caster to the piece (the Frost line's ice): its close shot looks past them, not through them. */
  row?: boolean;
}
