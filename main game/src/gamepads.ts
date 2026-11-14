/**
 * The pad list, or an empty one where the browser refuses the Gamepad API: a `Permissions-Policy: gamepad=()` header
 * or a frame without `allow="gamepad"` makes `getGamepads()` throw (U-02). Every reader of the pads goes through
 * here, so a refusal leaves the keyboard and pointer working instead of stopping a page or an input loop.
 */
export function connectedGamepads(): readonly (Gamepad | null)[] {
  try { return navigator.getGamepads?.() ?? []; }
  catch { return []; }
}
