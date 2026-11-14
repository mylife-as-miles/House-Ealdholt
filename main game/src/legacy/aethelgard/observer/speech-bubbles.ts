/**
 * The villagers' speech bubbles over the Elderbloom village (the creator's direction of 11 November 2026: what people
 * say floats up over the village like in hello-world, in place of reading a list). Plain DOM in one container, as
 * hello-world's BubbleHub does it: each frame every bubble's speaker is projected to the screen and the bubble is
 * laid out by hello-world's placeBubble (bubble-layout.ts), clear of the observer's panels and of the other bubbles.
 * A bubble pops in over its speaker, drifts upward like a small cloud while it is read, and fades.
 *
 * Text is only ever set as textContent. The hub runs its own animation frames while any bubble is alive and none
 * otherwise.
 */
import type { VoiceTone } from "../../../../../shared/legacy/aethelgard/observer/village-voices";
import { BUBBLE_GAP, placeBubble, type BubbleSlot, type Placement, type SafeArea } from "./bubble-layout";
import "./speech-bubbles.css";

export interface BubblePoint { x: number; y: number; distance: number }
export interface SpeechBubbleOptions {
  /** Projects a point in the village model's frame to pixels in the container; false when it is behind the camera. */
  project(point: readonly [number, number, number], out: BubblePoint): boolean;
  /** Elements the bubbles must keep clear of (the observer's panels, the header, the dock). */
  obstacles(): readonly Element[];
  reducedMotion(): boolean;
}
interface Bubble {
  readonly key: string;
  readonly wrap: HTMLDivElement;
  readonly el: HTMLDivElement;
  readonly anchor: readonly [number, number, number];
  readonly start: number;
  readonly duration: number;
  readonly sway: number;
  w: number; h: number; dx: number; dy: number; placed: boolean;
}

/** At most this many bubbles at once; an older one gives way to a newer. */
export const BUBBLE_LIMIT = 7;
const RISE_PIXELS = 34, FADE_MILLISECONDS = 650, SAFE_INSET = 10, MAX_RECTS = 24;

export function createSpeechBubbles(host: HTMLElement, options: SpeechBubbleOptions) {
  const root = document.createElement("div");
  root.className = "obs-bubbles"; root.setAttribute("aria-hidden", "true");
  host.appendChild(root);
  const bubbles: Bubble[] = [];
  const hard = new Float32Array(MAX_RECTS * 4), none = new Float32Array(4);
  const slot: BubbleSlot = { ax: 0, ay: 0, w: 0, h: 0, maxShift: 0, prevDx: NaN, prevDy: NaN };
  const placement: Placement = { dx: 0, dy: 0, cost: 0, softHits: 0 }, area: SafeArea = { minL: 0, maxR: 0, minT: 0, maxB: 0 }, point: BubblePoint = { x: 0, y: 0, distance: 0 };
  let frame = 0, disposed = false, obstacleRects: DOMRect[] = [], obstaclesAt = -1e9, shown = 0;

  function remove(bubble: Bubble): void {
    bubble.wrap.remove();
    const index = bubbles.indexOf(bubble);
    if (index >= 0) bubbles.splice(index, 1);
  }
  function layout(now: number): void {
    frame = 0;
    if (disposed) return;
    const bounds = root.getBoundingClientRect();
    area.minL = SAFE_INSET; area.maxR = bounds.width - SAFE_INSET; area.minT = SAFE_INSET; area.maxB = bounds.height - SAFE_INSET;
    // The panels move rarely: their rects are read a few times a second.
    if (now - obstaclesAt > 250) { obstaclesAt = now; obstacleRects = options.obstacles().map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0); }
    let count = 0;
    for (const rect of obstacleRects) {
      if (count >= MAX_RECTS - BUBBLE_LIMIT) break;
      hard.set([rect.left - bounds.left, rect.right - bounds.left, rect.top - bounds.top, rect.bottom - bounds.top], count * 4); count++;
    }
    const still = options.reducedMotion();
    shown = 0;
    // Oldest first, so a bubble keeps its place and newer ones fit around it.
    for (const bubble of [...bubbles]) {
      const age = now - bubble.start;
      if (age >= bubble.duration) { remove(bubble); continue; }
      if (!bubble.w) { bubble.w = bubble.el.offsetWidth; bubble.h = bubble.el.offsetHeight; }
      const life = age / bubble.duration, rise = still ? 0 : RISE_PIXELS * (1 - (1 - life) * (1 - life));
      const visible = options.project(bubble.anchor, point) && point.x > -40 && point.x < bounds.width + 40 && point.y > 0 && point.y < bounds.height + 40;
      // Nearer speakers read a little larger; far ones never shrink below a legible size.
      const scale = Math.max(.82, Math.min(1.12, 46 / Math.max(1, point.distance) + .62));
      slot.ax = point.x + (still ? 0 : Math.sin(age / 900 + bubble.sway) * 3); slot.ay = point.y - rise;
      slot.w = bubble.w * scale; slot.h = bubble.h * scale; slot.maxShift = Math.max(12, slot.w / 2 - 14);
      slot.prevDx = bubble.placed ? bubble.dx : NaN; slot.prevDy = bubble.placed ? bubble.dy : NaN;
      const fits = visible && placeBubble(slot, area, hard, count, none, 0, none, 0, placement);
      if (!fits) { bubble.wrap.style.opacity = "0"; continue; }
      // Ease toward the chosen spot so a bubble glides aside rather than jumping.
      bubble.dx = bubble.placed ? bubble.dx + (placement.dx - bubble.dx) * .25 : placement.dx;
      bubble.dy = bubble.placed ? bubble.dy + (placement.dy - bubble.dy) * .25 : placement.dy;
      bubble.placed = true;
      const left = slot.ax + bubble.dx - slot.w / 2, bottom = slot.ay + bubble.dy;
      if (count < MAX_RECTS) { hard.set([left - BUBBLE_GAP, left + slot.w + BUBBLE_GAP, bottom - slot.h - BUBBLE_GAP, bottom + BUBBLE_GAP], count * 4); count++; }
      bubble.wrap.style.transform = `translate3d(${slot.ax.toFixed(1)}px,${slot.ay.toFixed(1)}px,0)`;
      bubble.wrap.style.opacity = String(Math.min(1, (bubble.duration - age) / FADE_MILLISECONDS));
      bubble.el.style.setProperty("--dx", `${bubble.dx.toFixed(1)}px`); bubble.el.style.setProperty("--dy", `${bubble.dy.toFixed(1)}px`);
      bubble.el.style.setProperty("--s", scale.toFixed(3));
      shown++;
    }
    root.dataset.bubbles = String(bubbles.length); root.dataset.shown = String(shown);
    if (bubbles.length) frame = requestAnimationFrame(layout);
  }

  return {
    get count() { return bubbles.length; },
    /** Shows what someone says over the point they stand at. The same speaker's earlier bubble gives way. */
    say(line: { readonly speaker: string; readonly name: string; readonly text: string; readonly tone: VoiceTone }, anchor: readonly [number, number, number]): void {
      if (disposed) return;
      const earlier = bubbles.find(bubble => bubble.key === line.speaker);
      if (earlier) remove(earlier);
      while (bubbles.length >= BUBBLE_LIMIT) remove(bubbles[0]);
      const wrap = document.createElement("div"), el = document.createElement("div");
      wrap.className = "obs-bubble-wrap"; wrap.style.opacity = "0";
      el.className = `obs-bubble obs-bubble--${line.tone}`; el.dataset.speaker = line.speaker;
      if (line.tone !== "sleep") { const name = document.createElement("span"); name.className = "obs-bubble-name"; name.textContent = line.name; el.appendChild(name); }
      el.appendChild(document.createTextNode(line.text));
      wrap.appendChild(el); root.appendChild(wrap);
      const duration = line.tone === "sleep" ? 3600 : Math.min(7200, Math.max(4600, 3400 + line.text.length * 62));
      bubbles.push({ key: line.speaker, wrap, el, anchor, start: performance.now(), duration, sway: Math.random() * 6.28, w: 0, h: 0, dx: 0, dy: 0, placed: false });
      if (!frame) frame = requestAnimationFrame(layout);
    },
    clear(): void { for (const bubble of [...bubbles]) remove(bubble); },
    dispose(): void { disposed = true; if (frame) cancelAnimationFrame(frame); frame = 0; root.remove(); bubbles.length = 0; },
  };
}
export type SpeechBubbles = ReturnType<typeof createSpeechBubbles>;
