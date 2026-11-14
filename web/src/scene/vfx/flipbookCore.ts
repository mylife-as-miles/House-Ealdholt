/**
 * The arithmetic behind the flipbook effects: which atlas cell a sprite shows at
 * a given age, and a fixed pool of sprite slots. No Three.js in here, so node
 * tests reach it (`npm run test:play`); flipbook.ts draws what this decides.
 *
 * Nothing is animated on the CPU. A spawn writes one slot of {@link FlipbookPool.data}
 * once, and the vertex shader in flipbook.ts evaluates the same formulas as
 * {@link flipbookFrame} and {@link flipbookEnvelope} at the effect clock. A sprite
 * therefore shows the same frame at the same clock time on any frame rate.
 */
import type { QualityPreset } from "../quality";

// ---------------------------------------------------------------- frame selection

export interface FlipbookClip {
  /** Frames in the atlas, row-major from the top-left cell. */
  frames: number;
  /** Authored playback rate. A spawn may override it. */
  fps: number;
  /** A loop wraps; a one-shot holds its last frame until its life ends. */
  loop: boolean;
}

export interface FlipbookFrame {
  /** Cell shown now. */
  index: number;
  /** Cell it is blending towards (equal to `index` on the last frame of a one-shot). */
  next: number;
  /** 0..1 weight of `next`. */
  blend: number;
  /** A one-shot that has run past its last frame. Always false for a loop. */
  done: boolean;
}

/** Seconds one pass through the clip takes. */
export function flipbookDuration(clip: FlipbookClip, fps = clip.fps): number {
  return fps > 0 ? clip.frames / fps : Infinity;
}

/**
 * The frame a sprite shows `age` seconds after its start. `offset` shifts the
 * start by whole or fractional frames (loops use it so neighbours do not pulse
 * together). Writes into `out` when given, so callers on a hot path allocate nothing.
 */
export function flipbookFrame(
  clip: FlipbookClip,
  age: number,
  fps = clip.fps,
  offset = 0,
  out: FlipbookFrame = { index: 0, next: 0, blend: 0, done: false },
): FlipbookFrame {
  const frames = Math.max(1, Math.floor(clip.frames));
  const last = frames - 1;
  const cursor = Math.max(0, age) * Math.max(0, fps) + offset;
  if (clip.loop) {
    const wrapped = ((cursor % frames) + frames) % frames;
    const index = Math.min(last, Math.floor(wrapped));
    out.index = index;
    out.next = (index + 1) % frames;
    out.blend = wrapped - index;
    out.done = false;
    return out;
  }
  const clamped = Math.min(Math.max(cursor, 0), last);
  const index = Math.floor(clamped);
  out.index = index;
  out.next = Math.min(index + 1, last);
  out.blend = index === last ? 0 : clamped - index;
  out.done = cursor >= frames;
  return out;
}

/** Top-left corner of a cell in UV space with v measured downwards from the top of the image. */
export function flipbookCell(index: number, cols: number, rows: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = (index % cols) / cols;
  out[1] = Math.floor(index / cols) / rows;
  return out;
}

/** Fade in over `fadeIn`, hold, fade out over the last `fadeOut` seconds of `life`. 0 outside the life. */
export function flipbookEnvelope(age: number, life: number, fadeIn: number, fadeOut: number): number {
  if (!(age >= 0) || age >= life) return 0;
  const rise = fadeIn > 0 ? smooth(age / fadeIn) : 1;
  const fall = fadeOut > 0 ? smooth((life - age) / fadeOut) : 1;
  return rise * fall;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- the pool

/** Floats per sprite in {@link FlipbookPool.data}: six vec4 instance attributes. */
export const FLIPBOOK_STRIDE = 24;

/** Offsets of the fields inside one slot. The vertex shader reads them in this order. */
export const FLIPBOOK_FIELD = {
  /** x, y, z, size (metres across the whole cell). */
  transform: 0,
  /** Velocity x, y, z (m/s) and growth (size multiplies by `1 + growth * age`). */
  motion: 4,
  /** Start time, frames per second, life in seconds, frame offset. */
  timing: 8,
  /** Rotation (radians), spin (rad/s), flip (+1 or -1), alpha. */
  look: 12,
  /** Tint r, g, b (linear, may exceed 1 to feed bloom) and additive 0..1. */
  tint: 16,
  /** Fade in seconds, fade out seconds, soft-edge distance in metres, mono 0..2. */
  fade: 20,
} as const;

/** A life this long is "until released": loops keep running, and the clock never reaches it. */
export const FLIPBOOK_FOREVER = 1e9;

export interface FlipbookSpawn {
  x: number;
  y: number;
  z: number;
  /** Metres across the whole cell. */
  size: number;
  /** Seconds from now until the sprite appears. */
  delay?: number;
  fps?: number;
  /** Seconds the sprite lives. One-shots default to the rest of the clip; loops to forever (until released). */
  life?: number;
  /** Start this many frames into the clip. */
  frameOffset?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  growth?: number;
  rotation?: number;
  spin?: number;
  /** Mirror the frame left to right, so repeats of one clip do not read as copies. */
  flip?: boolean;
  alpha?: number;
  r?: number;
  g?: number;
  b?: number;
  /** 0 composites as smoke, 1 adds as light. */
  additive?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Distance over which the sprite fades into the board (and scene depth, if supplied). */
  soft?: number;
  /**
   * 0 keeps the frame's own colours; 1 reduces it to brightness before tinting.
   * Baked fire is orange with no blue in it, so an arcane violet needs this.
   * Past 1, up to 2, a recoloured fire keeps its heat as well, by the amount past 1: its heart goes white and its
   * fringe deepens, with the tint's hue between them (flipbook.ts `hotTint`). A spell's burning body uses it.
   */
  mono?: number;
}

const GENERATIONS = 4096;

/**
 * A fixed number of sprite slots for one atlas. Spawning writes into a
 * preallocated Float32Array and never allocates; when every slot is busy the
 * oldest one-shot is replaced (a loop only if there is nothing else), because a
 * new impact matters more than the tail of an old one.
 */
export class FlipbookPool {
  readonly capacity: number;
  /** `capacity * FLIPBOOK_STRIDE` floats, laid out as {@link FLIPBOOK_FIELD}. */
  readonly data: Float32Array;
  /** Slots written since the last {@link flushed}: [dirtyFrom, dirtyTo). Empty when from >= to. */
  dirtyFrom = 0;
  dirtyTo = 0;
  /** Spawns that had to replace a live sprite. A budget that is too small shows up here. */
  stolen = 0;

  private readonly ends: Float64Array;
  private readonly starts: Float64Array;
  private readonly generation: Uint16Array;
  private readonly live: Uint8Array;
  private readonly free: Int32Array;
  private freeCount: number;
  private disposed = false;

  constructor(readonly clip: FlipbookClip, capacity: number) {
    this.capacity = Math.max(0, Math.floor(capacity));
    this.data = new Float32Array(this.capacity * FLIPBOOK_STRIDE);
    this.ends = new Float64Array(this.capacity);
    this.starts = new Float64Array(this.capacity);
    this.generation = new Uint16Array(this.capacity);
    this.live = new Uint8Array(this.capacity);
    this.free = new Int32Array(this.capacity);
    this.freeCount = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
  }

  /** Sprites that have been spawned and not yet expired or released. */
  get active(): number {
    return this.capacity - this.freeCount;
  }

  /**
   * Starts a sprite at clock time `now`. Returns a handle for {@link release},
   * or -1 if the pool has no capacity (or was disposed).
   */
  spawn(now: number, spec: FlipbookSpawn): number {
    if (this.disposed || this.capacity === 0) return -1;
    let slot: number;
    if (this.freeCount > 0) {
      slot = this.free[--this.freeCount];
    } else {
      slot = this.oldest();
      this.stolen++;
    }
    const clip = this.clip;
    const fps = spec.fps ?? clip.fps;
    const start = now + (spec.delay ?? 0);
    const offset = spec.frameOffset ?? 0;
    // A one-shot started part-way in ends when its last frame does, not a whole clip later.
    const life = spec.life ?? (clip.loop ? FLIPBOOK_FOREVER : fps > 0 ? Math.max(0, clip.frames - offset) / fps : FLIPBOOK_FOREVER);
    const d = this.data;
    const o = slot * FLIPBOOK_STRIDE;
    d[o] = spec.x; d[o + 1] = spec.y; d[o + 2] = spec.z; d[o + 3] = spec.size;
    d[o + 4] = spec.vx ?? 0; d[o + 5] = spec.vy ?? 0; d[o + 6] = spec.vz ?? 0; d[o + 7] = spec.growth ?? 0;
    d[o + 8] = start; d[o + 9] = fps; d[o + 10] = life; d[o + 11] = offset;
    d[o + 12] = spec.rotation ?? 0; d[o + 13] = spec.spin ?? 0; d[o + 14] = spec.flip ? -1 : 1; d[o + 15] = spec.alpha ?? 1;
    d[o + 16] = spec.r ?? 1; d[o + 17] = spec.g ?? 1; d[o + 18] = spec.b ?? 1; d[o + 19] = spec.additive ?? 0;
    d[o + 20] = spec.fadeIn ?? 0; d[o + 21] = spec.fadeOut ?? 0; d[o + 22] = spec.soft ?? 0; d[o + 23] = spec.mono ?? 0;
    this.starts[slot] = start;
    this.ends[slot] = start + life;
    this.live[slot] = 1;
    this.generation[slot] = (this.generation[slot] + 1) % GENERATIONS;
    this.touch(slot);
    return this.generation[slot] * this.capacity + slot;
  }

  /**
   * Ends a sprite early, fading over `fade` seconds from `now`. This is how a
   * loop stops. A handle whose slot has since been reused is ignored.
   */
  release(handle: number, now: number, fade = 0): boolean {
    const slot = this.slotOf(handle);
    if (slot < 0) return false;
    const o = slot * FLIPBOOK_STRIDE;
    const end = Math.min(this.ends[slot], now + Math.max(0, fade));
    this.ends[slot] = end;
    this.data[o + 10] = end - this.starts[slot];
    if (fade > 0) this.data[o + 21] = Math.max(this.data[o + 21], fade);
    this.touch(slot);
    return true;
  }

  /** Whether the handle still names a sprite that has not ended. */
  alive(handle: number, now: number): boolean {
    const slot = this.slotOf(handle);
    return slot >= 0 && now < this.ends[slot];
  }

  /** Returns finished sprites' slots to the pool. Call once per frame; returns the live count. */
  expire(now: number): number {
    for (let slot = 0; slot < this.capacity; slot++) {
      if (this.live[slot] && now >= this.ends[slot]) this.retire(slot);
    }
    return this.active;
  }

  /** Everything gone at once (Undo, reset). Slots are zeroed so the GPU copy draws nothing. */
  clear(): void {
    for (let slot = 0; slot < this.capacity; slot++) {
      if (!this.live[slot]) continue;
      this.data[slot * FLIPBOOK_STRIDE + 10] = 0;
      this.touch(slot);
      this.retire(slot);
    }
  }

  /** The renderer has uploaded the dirty range. */
  flushed(): void {
    this.dirtyFrom = 0;
    this.dirtyTo = 0;
  }

  /** After this, spawns return -1. The typed arrays are left for the garbage collector. */
  dispose(): void {
    this.clear();
    this.disposed = true;
  }

  private slotOf(handle: number): number {
    if (this.disposed || !(handle >= 0) || this.capacity === 0) return -1;
    const slot = handle % this.capacity;
    const generation = Math.floor(handle / this.capacity);
    return this.live[slot] && this.generation[slot] === generation ? slot : -1;
  }

  private retire(slot: number): void {
    this.live[slot] = 0;
    this.free[this.freeCount++] = slot;
  }

  private touch(slot: number): void {
    if (this.dirtyFrom >= this.dirtyTo) {
      this.dirtyFrom = slot;
      this.dirtyTo = slot + 1;
    } else {
      if (slot < this.dirtyFrom) this.dirtyFrom = slot;
      if (slot + 1 > this.dirtyTo) this.dirtyTo = slot + 1;
    }
  }

  /** The slot to replace when the pool is full: the earliest-started one-shot, else the earliest loop. */
  private oldest(): number {
    let best = 0, bestStart = Infinity, bestHeld = true;
    for (let slot = 0; slot < this.capacity; slot++) {
      const held = this.data[slot * FLIPBOOK_STRIDE + 10] >= FLIPBOOK_FOREVER;
      const start = this.starts[slot];
      if ((bestHeld && !held) || (bestHeld === held && start < bestStart)) {
        best = slot; bestStart = start; bestHeld = held;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------- budgets

/** Which atlas set a preset loads: 256 px cells, or the 128 px cells made for Quest and phones. */
export type FlipbookTier = "desktop" | "quest";

export interface FlipbookBudget {
  tier: FlipbookTier;
  /** Sprite slots per atlas. Fixed for the preset: nothing grows during a match. */
  instances: number;
  /** Blend neighbouring frames (two texture reads) instead of stepping. */
  frameBlend: boolean;
  /** Fade sprites into the board plane. */
  softGround: boolean;
  /** Also fade against scene depth when the host supplies a depth texture. */
  softDepth: boolean;
}

/** Starting numbers, to be reset by profiling on the device. */
export const FLIPBOOK_BUDGET: Readonly<Record<QualityPreset, FlipbookBudget>> = {
  low: { tier: "quest", instances: 12, frameBlend: false, softGround: true, softDepth: false },
  medium: { tier: "desktop", instances: 16, frameBlend: true, softGround: true, softDepth: false },
  high: { tier: "desktop", instances: 32, frameBlend: true, softGround: true, softDepth: true },
  ultra: { tier: "desktop", instances: 48, frameBlend: true, softGround: true, softDepth: true },
};

/** The Quest build runs one fixed budget whatever the desktop preset says. */
export const FLIPBOOK_QUEST_BUDGET: FlipbookBudget = { tier: "quest", instances: 12, frameBlend: false, softGround: true, softDepth: false };
