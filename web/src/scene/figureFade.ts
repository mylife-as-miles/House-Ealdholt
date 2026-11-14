import type * as THREE from "three";

/**
 * Below this opacity a fading figure stops writing depth. Above it the figure keeps hiding its own far side (the arm
 * behind the torso, the back of the cloak), so a fade reads as the figure thinning, not as its insides showing. The
 * switch is made where the figure is already faint: made at 0.6, it was a visible step in every fade, the whole
 * inside of the figure appearing at once.
 */
export const FADE_DEPTH_WRITE = 0.3;

/**
 * Fades one figure material to `value` (0 to 1).
 *
 * three.js builds a material's program with `#define OPAQUE` while `transparent` is false, which forces the alpha to 1,
 * and does not look at the flag again until the material's version changes. So the flag is flipped together with
 * `needsUpdate`: without it a figure already drawn kept drawing at full opacity under a fade (into the tray, at its
 * death, a promotion forming) and then vanished in one frame, or faded only from whenever something else (a spell
 * light coming on) happened to rebuild its program. Both programs stay with the material once built, so later flips
 * only switch between them.
 */
export function fadeMaterial(material: THREE.Material, value: number): void {
  const transparent = value < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = value;
  material.depthWrite = value > FADE_DEPTH_WRITE;
}
