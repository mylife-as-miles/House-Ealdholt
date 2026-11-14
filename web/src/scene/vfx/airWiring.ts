/**
 * What the match tells the arena's air, and when it keeps quiet.
 *
 * The desktop arena's air answers the play (main game/src/play/arena-physics.ts): the drifting ash and embers part
 * round a blow, and the ash lying on the stone is thrown up from under it. sceneEngine.ts reports each real event
 * through {@link stirAir}: a foot going down, a figure taking its square, steel stopped, the killing blow, a body
 * reaching the stone, a shot, a spell, a rite. Where a flipbook moment already marks the event (vfx/wiring.ts) the
 * report rides on it ({@link AIR_OF_MOMENT}), so the dust on the stone and the ash in the air start on the same frame.
 *
 * Plain data and arithmetic with no Three.js, so the node tests reach it. The rules:
 *  - reduced motion and the tactical map stir nothing (the air stands still there, and the map shows no arena);
 *  - the menu's background board stirs nothing (it has no arena);
 *  - a place or a power that is not a finite number is dropped, never passed on.
 * The air itself decides how much each kind moves it (shared/play/air-disturbance.ts AIR_IMPULSES).
 */
import type { AirImpulseKind } from "../../../../shared/play/air-disturbance";
import type { VfxFlags, VfxMoment } from "./wiring";

/** The arena's `disturb` (arena-physics.ts): a kind, a place in the board's units, how hard, and seconds from now. */
export type AirSink = (kind: AirImpulseKind, x: number, y: number, z: number, power: number, delay: number) => void;

/**
 * What each flipbook moment does to the air. A spell stirs it where it breaks, whichever spell draws the burst
 * (SceneEngine.spellBurst), and the mist round a caster's feet is the air itself: neither is told twice.
 */
export const AIR_OF_MOMENT: Readonly<Record<VfxMoment, AirImpulseKind | null>> = {
  fall: "fall",
  step: "step",
  bash: "clash",
  musket: "shot",
  slam: "slam",
  spell: null,
  mist: null,
};

/** Whether the air is told anything under these settings. */
export function airStirs(flags: Pick<VfxFlags, "reducedMotion" | "tactical" | "menuBoard">): boolean {
  return !flags.reducedMotion && !flags.tactical && !flags.menuBoard;
}

/** Reports one event to the arena's air. Returns whether it was passed on. */
export function stirAir(sink: AirSink | null | undefined, flags: Pick<VfxFlags, "reducedMotion" | "tactical" | "menuBoard">,
  kind: AirImpulseKind, x: number, y: number, z: number, power = 1, delay = 0): boolean {
  if (!sink || !airStirs(flags)) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(power) || power <= 0 || !Number.isFinite(delay)) return false;
  sink(kind, x, y, z, power, Math.max(0, delay));
  return true;
}
