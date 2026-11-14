import { useEffect, useRef, type RefObject } from "react";
import { DEFAULT_BINDINGS, type MenuBindings } from "../settings-types";
import { controllerDevice, type InputDevice } from "../input-prompts";
import { connectedGamepads } from "../gamepads";

type Direction = "left" | "right" | "up" | "down";

const DEADZONE = 0.55;
const REPEAT_DELAY = 350;
const REPEAT_INTERVAL = 160;

/** Setup owns controller input while the main menu is inert. Native controls
 * remain the source of truth for selection, focus and activation. */
export function useSetupGamepad(rootRef: RefObject<HTMLElement | null>, onBack: () => void, bindings: MenuBindings = DEFAULT_BINDINGS, onDevice?: (device: InputDevice) => void) {
  const back = useRef(onBack);
  const inputChanged = useRef(onDevice);
  back.current = onBack;
  inputChanged.current = onDevice;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let alive = true;
    let frame = 0;
    let rearm = true;
    let previousA = false;
    let previousB = false;
    let pendingBack = false;
    let pendingActivation: HTMLElement | null = null;
    let previousDirection: Direction | null = null;
    let repeatAt = 0;
    let padIndex: number | null = null;

    const cancelActivation = () => {
      if (pendingActivation) delete pendingActivation.dataset.setupPressed;
      pendingActivation = null;
      pendingBack = false;
    };
    const reset = () => {
      cancelActivation();
      rearm = true;
      previousA = previousB = false;
      previousDirection = null;
      repeatAt = 0;
    };
    const otherInput = (event: Event) => {
      root.dataset.setupInput = event.type === "keydown" ? "keyboard" : "pointer";
      inputChanged.current?.("keyboard");
      reset();
      if (!(event instanceof KeyboardEvent)) return;
      // Keep native Enter/Space/radio arrows. Remapped menu keys activate the
      // same native controls instead of displaying shortcuts that do nothing.
      const target = document.activeElement;
      if (event.code === bindings.select && !["Enter", "Space"].includes(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && target instanceof HTMLElement && root.contains(target) && target.matches("button:not(:disabled), input[type=radio]:not(:disabled)")) target.click();
      }
      for (const direction of ["left", "right", "up", "down"] as const) {
        if (event.code !== bindings[direction] || event.code === DEFAULT_BINDINGS[direction]) continue;
        event.preventDefault();
        event.stopPropagation();
        navigate(direction);
        break;
      }
    };
    const markGamepad = (pad: Gamepad) => { root.dataset.setupInput = "gamepad"; inputChanged.current?.(controllerDevice(pad.id)); };
    const refreshGamepads = () => {
      reset();
      if (alive && !frame) frame = requestAnimationFrame(tick);
      if (!Array.from(connectedGamepads()).some(pad => pad?.connected)) {
        root.dataset.setupInput = "keyboard";
        inputChanged.current?.("keyboard");
      }
    };
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input[type=radio]:not(:disabled)"
    )).filter((element) => {
      // Radio hitboxes are deliberately transparent; their visible label face
      // supplies focus/selection styling. Opacity is not visibility here.
      if (element.closest("[inert], [hidden], [aria-hidden=true]")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    });
    const focus = (element: HTMLElement) => {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    };
    const navigate = (direction: Direction) => {
      // Geometry is read only on a navigation edge/repeat, never each frame.
      const candidates = controls();
      const current = candidates.find((element) => element === document.activeElement);
      if (!current) {
        if (candidates[0]) focus(candidates[0]);
        return;
      }
      const origin = current.getBoundingClientRect();
      const originX = origin.x + origin.width / 2;
      const originY = origin.y + origin.height / 2;
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      let next: HTMLElement | null = null;
      let best = Infinity;
      for (const candidate of candidates) {
        if (candidate === current) continue;
        const rect = candidate.getBoundingClientRect();
        const dx = rect.x + rect.width / 2 - originX;
        const dy = rect.y + rect.height / 2 - originY;
        const primary = (horizontal ? dx : dy) * sign;
        if (primary <= 1) continue;
        const cross = Math.abs(horizontal ? dy : dx);
        const score = primary + cross * 2.75 + cross * cross / (primary + 1);
        if (score < best) { best = score; next = candidate; }
      }
      if (next) focus(next);
    };
    const directionOf = (pad: Gamepad): Direction | null => {
      if (pad.buttons[14]?.pressed) return "left";
      if (pad.buttons[15]?.pressed) return "right";
      if (pad.buttons[12]?.pressed) return "up";
      if (pad.buttons[13]?.pressed) return "down";
      const x = pad.axes[0] || 0;
      const y = pad.axes[1] || 0;
      if (Math.max(Math.abs(x), Math.abs(y)) < DEADZONE) return null;
      return Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
    };
    const tick = (now: number) => {
      if (!alive) return;
      const pad = Array.from(connectedGamepads()).find((item) => item?.connected) || null;
      if (!pad) {
        // No pad, no per-frame polling: the loop starts again on gamepadconnected (M-22).
        reset();
        padIndex = null;
        frame = 0;
        return;
      }
      if (document.hidden || !document.hasFocus()) {
        reset();
        padIndex = null;
      } else {
        if (pad.index !== padIndex) { reset(); padIndex = pad.index; }
        const a = Boolean(pad.buttons[0]?.pressed);
        const b = Boolean(pad.buttons[1]?.pressed);
        const direction = directionOf(pad);
        // Require neutral input after mounting, reconnecting or changing input
        // device, so a held menu button cannot select or launch a match.
        if (rearm) {
          if (!a && !b && !direction) rearm = false;
        } else {
          if (b && !previousB) {
            markGamepad(pad);
            cancelActivation();
            pendingBack = true;
          }
          if (!b && previousB && pendingBack) {
            cancelActivation();
            alive = false;
            // Returning on release prevents a held B from immediately being
            // consumed by the main menu's separate controller poll.
            back.current();
            return;
          }
          if (!b && !pendingBack) {
            if (a && !previousA) {
              markGamepad(pad);
              const candidates = controls();
              const target = candidates.find((element) => element === document.activeElement) || candidates[0];
              if (target) {
                focus(target);
                pendingActivation = target;
                target.dataset.setupPressed = "true";
              }
            }
            if (!a && previousA && pendingActivation) {
              const target = pendingActivation;
              cancelActivation();
              if (root.contains(target) && !target.matches(":disabled")) target.click();
            }
            if (direction && !a && (direction !== previousDirection || now >= repeatAt)) {
              markGamepad(pad);
              navigate(direction);
              repeatAt = now + (direction !== previousDirection ? REPEAT_DELAY : REPEAT_INTERVAL);
            }
          }
          previousA = a;
          previousB = b;
          previousDirection = direction;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    root.addEventListener("keydown", otherInput, true);
    root.addEventListener("pointerdown", otherInput, true);
    window.addEventListener("blur", reset);
    window.addEventListener("gamepadconnected", refreshGamepads);
    window.addEventListener("gamepaddisconnected", refreshGamepads);
    document.addEventListener("visibilitychange", reset);
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      cancelActivation();
      root.removeEventListener("keydown", otherInput, true);
      root.removeEventListener("pointerdown", otherInput, true);
      window.removeEventListener("blur", reset);
      window.removeEventListener("gamepadconnected", refreshGamepads);
      window.removeEventListener("gamepaddisconnected", refreshGamepads);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [rootRef, bindings]);
}
