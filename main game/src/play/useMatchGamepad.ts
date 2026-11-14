import { useEffect, useRef, type RefObject } from "react";
import { controllerDevice, type InputDevice } from "../input-prompts";
import type { MatchPauseHandle } from "./MatchPause";
import { connectedGamepads } from "../gamepads";

type Direction = "left" | "right" | "up" | "down";

// The setup screen's feel (useSetupGamepad.ts): the same dead zone and the same repeat.
const DEADZONE = 0.55;
const REPEAT_DELAY = 350;
const REPEAT_INTERVAL = 160;
const ARROW: Record<Direction, string> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
// The right stick on the view: its own, smaller dead zone (it is read as an amount, not as a direction), a full
// push turning the board about a third of the way round in a second, and the triggers closing a second's worth of
// distance in about one and a half.
const LOOK_DEADZONE = 0.2;
const LOOK_TURN = 2.1;
const LOOK_TILT = 1.1;
const LOOK_PULL = 0.7;
/** A stick's push past its dead zone, rescaled so it starts from nothing at the zone's edge. */
export const stickAmount = (value: number, deadzone = LOOK_DEADZONE) => (Math.abs(value) <= deadzone ? 0 : Math.sign(value) * (Math.abs(value) - deadzone) / (1 - deadzone));

export interface MatchGamepadActions {
  undo(): void;
  flip(): void;
  /** Close whatever the HUD has open (a menu, the brightness slider) as the pad goes back to the board. */
  dismiss(): void;
  /** Open the pause menu, or close it. */
  togglePause(): void;
  /** The pause menu while it is open, else null. */
  pauseMenu(): MatchPauseHandle | null;
  /** Turn (radians, to the right), tilt (radians, upward) and pull (share of the distance, closer) the view. */
  look(yaw: number, pitch: number, zoom: number): void;
  /** Put the view back where the game frames the board. */
  resetView(): void;
}

/**
 * A controller over a match. The main menu stops reading the pad while a match is on screen, so the match reads it.
 *
 * On the board the pad presses the keys the board already answers (MatchExperience's keyboard handler): the d-pad or
 * left stick moves its cursor, the select button is Enter, the back button is Escape (lets a piece go, calls off a
 * queued move, backs out of the promotion picker, skips a fight or the ending). The left face button takes a move back and the top one flips the board. The right stick turns and
 * tilts the view, the triggers pull it in and out, and a press on the stick puts it back. Start (Menu, Options, +)
 * opens the pause menu and closes it again. View (Create, −) moves the pad onto the HUD's controls and back: there the
 * d-pad goes from control to control by where they sit on screen (as on the setup screen), select presses the one in
 * focus on release, and back returns to the board.
 *
 * Whatever needs an answer takes the pad first: a confirm dialog (the HUD's, or the pause menu's Reset Defaults), then
 * the pause menu (the d-pad walks it, select chooses, back steps back, the top button resets a Settings page), then
 * the promotion picker; the result panel is where the first press lands once the game is over.
 */
export function useMatchGamepad(hudRef: RefObject<HTMLElement | null>, actions: MatchGamepadActions, onDevice: (device: InputDevice) => void) {
  const latest = useRef(actions);
  const report = useRef(onDevice);
  latest.current = actions;
  report.current = onDevice;

  useEffect(() => {
    const hud = hudRef.current;
    const host = hud?.closest<HTMLElement>(".match-experience");
    if (!hud || !host) return;
    let frame = 0;
    // Neutral input is required first, so a button still held from the setup screen does nothing here.
    let rearm = true;
    const none = { a: false, b: false, x: false, y: false, menu: false, view: false, stick: false };
    let lastTick = 0;
    let held = none;
    let heldDirection: Direction | null = null;
    let repeatAt = 0;
    let pressing: HTMLElement | null = null;

    const board = () => host.querySelector<HTMLCanvasElement>("canvas");
    const release = () => { if (pressing) delete pressing.dataset.hudPressed; pressing = null; };
    const reset = () => { release(); rearm = true; held = none; heldDirection = null; repeatAt = 0; };
    const toBoard = () => { latest.current.dismiss(); board()?.focus({ preventScroll: true }); };
    const key = (name: string) => {
      const canvas = board();
      if (!canvas) return;
      if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: name, code: name, bubbles: true, cancelable: true }));
    };
    const controls = (within: HTMLElement) => Array.from(within.querySelectorAll<HTMLElement>("button:not(:disabled), input[type=range]:not(:disabled)")).filter((element) => {
      if (element.closest("[inert], [hidden], [aria-hidden=true]")) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    });
    const focus = (element: HTMLElement) => { element.focus({ preventScroll: true }); element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); };
    const enter = (within: HTMLElement) => {
      const all = controls(within);
      const first = all.find((element) => element.matches("[data-hud-primary]")) ?? all[0];
      if (first) focus(first);
    };
    // The nearest control in that direction, favouring one straight ahead (the setup screen's rule).
    const navigate = (direction: Direction, within: HTMLElement, current: HTMLElement) => {
      const origin = current.getBoundingClientRect();
      const originX = origin.x + origin.width / 2, originY = origin.y + origin.height / 2;
      const horizontal = direction === "left" || direction === "right";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      let next: HTMLElement | null = null, best = Infinity;
      for (const candidate of controls(within)) {
        if (candidate === current) continue;
        const rect = candidate.getBoundingClientRect();
        const dx = rect.x + rect.width / 2 - originX, dy = rect.y + rect.height / 2 - originY;
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
      const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
      if (Math.max(Math.abs(x), Math.abs(y)) < DEADZONE) return null;
      return Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const pad = Array.from(connectedGamepads()).find((item) => item?.connected) ?? null;
      // Nothing is read before the match's controls are up (the HUD is mounted only once the match has begun).
      if (!pad || document.hidden || !document.hasFocus() || host.dataset.matchReady !== "true") { reset(); return; }
      const down = { a: !!pad.buttons[0]?.pressed, b: !!pad.buttons[1]?.pressed, x: !!pad.buttons[2]?.pressed, y: !!pad.buttons[3]?.pressed, menu: !!pad.buttons[9]?.pressed, view: !!pad.buttons[8]?.pressed, stick: !!pad.buttons[11]?.pressed };
      const direction = directionOf(pad);
      const lookX = stickAmount(pad.axes[2] || 0), lookY = stickAmount(pad.axes[3] || 0);
      const pull = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      const seconds = Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      const any = down.a || down.b || down.x || down.y || down.menu || down.view || down.stick || !!direction || !!lookX || !!lookY || Math.abs(pull) > LOOK_DEADZONE;
      if (rearm) { if (!any) rearm = false; return; }
      if (any) { hud.dataset.hudInput = "gamepad"; report.current(controllerDevice(pad.id)); }
      const stepped = !!direction && (direction !== heldDirection || now >= repeatAt);
      if (stepped) repeatAt = now + (direction !== heldDirection ? REPEAT_DELAY : REPEAT_INTERVAL);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const finish = () => { held = down; heldDirection = direction; };

      // A question, wherever it was asked from: the d-pad between its answers, select presses on release, back says no.
      const dialog = document.querySelector<HTMLElement>("dialog.match-confirm[open]");
      if (dialog) {
        const current = active && dialog.contains(active) && active.matches("button") ? active : null;
        if (stepped && direction) { if (current) navigate(direction, dialog, current); else enter(dialog); }
        if (down.a && !held.a) { if (current) { pressing = current; current.dataset.hudPressed = "true"; } else enter(dialog); }
        if (!down.a && held.a && pressing) { const target = pressing; release(); if (dialog.contains(target) && !target.matches(":disabled")) target.click(); }
        if (down.b && !held.b) { release(); dialog.querySelector<HTMLElement>("[data-hud-back]")?.click(); }
        finish();
        return;
      }

      // The pause menu: it is walked as the main menu is, a step for each press.
      const pauseMenu = latest.current.pauseMenu();
      if (pauseMenu) {
        if (down.menu && !held.menu) latest.current.togglePause();
        else if (down.a && !held.a) pauseMenu.activate();
        else if (down.b && !held.b) pauseMenu.back();
        else if (down.y && !held.y) pauseMenu.reset();
        else if (stepped && direction) pauseMenu.move(direction);
        finish();
        return;
      }

      // The match: the promotion picker if it is up, else the HUD control in focus, else the board.
      const modal = hud.querySelector<HTMLElement>(".match-promotion");
      const current = active && hud.contains(active) && active.matches("button, input") ? active : null;
      const landing = modal ?? hud.querySelector<HTMLElement>(".match-result");

      if (down.menu && !held.menu) { release(); latest.current.togglePause(); finish(); return; }
      if (down.view && !held.view && !modal) { if (current) toBoard(); else enter(hud.querySelector<HTMLElement>(".hud-bar") ?? hud); }
      if (stepped && direction) {
        if (current instanceof HTMLInputElement && current.type === "range" && (direction === "left" || direction === "right")) {
          // A slider in focus is moved a step; React hears of it as it would a drag.
          if (direction === "left") current.stepDown(); else current.stepUp();
          current.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (current) navigate(direction, modal ?? hud, current);
        // Over the promotion picker the d-pad moves its focus round the four, as the arrows do on the board.
        else if (modal) key(ARROW[direction]);
        else if (landing) enter(landing);
        else key(ARROW[direction]);
      }
      if (down.a && !held.a) {
        if (current) { pressing = current; current.dataset.hudPressed = "true"; }
        // ...and select chooses the one in focus.
        else if (modal) key("Enter");
        else if (landing) enter(landing);
        else key("Enter");
      }
      // A control is pressed on release, so a held button cannot press the next screen's control too.
      if (!down.a && held.a && pressing) {
        const target = pressing;
        release();
        if (hud.contains(target) && !target.matches(":disabled")) target.click();
      }
      if (down.b && !held.b) {
        release();
        // Over the promotion picker the back button backs out of it (the board answers Escape there).
        if (modal) key("Escape");
        else if (current) toBoard();
        else key("Escape");
      }
      if (!modal && !current) {
        if (down.x && !held.x) latest.current.undo();
        if (down.y && !held.y) latest.current.flip();
        // The view: the stick pushed right carries the camera round to the right, pushed up lifts it over the board.
        if (lookX || lookY || Math.abs(pull) > LOOK_DEADZONE) latest.current.look(lookX * LOOK_TURN * seconds, -lookY * LOOK_TILT * seconds, stickAmount(pull) * LOOK_PULL * seconds);
        if (down.stick && !held.stick) latest.current.resetView();
      }
      finish();
    };

    // A real key or pointer, anywhere (the pause menu is drawn outside the match), puts the prompts back to the
    // keyboard's. The pad's own key presses above are not real.
    const otherInput = (event: Event) => {
      if (!event.isTrusted) return;
      hud.dataset.hudInput = event.type === "keydown" ? "keyboard" : "pointer";
      report.current("keyboard");
      reset();
    };
    window.addEventListener("keydown", otherInput, true);
    window.addEventListener("pointerdown", otherInput, true);
    window.addEventListener("blur", reset);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      release();
      window.removeEventListener("keydown", otherInput, true);
      window.removeEventListener("pointerdown", otherInput, true);
      window.removeEventListener("blur", reset);
    };
  }, [hudRef]);
}
