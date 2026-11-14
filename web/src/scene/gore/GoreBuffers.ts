/**
 * The fixed-size instance pools behind BloodParticles and BloodDecals. Typed
 * arrays allocated once per quality preset; emitting a burst or laying a stain
 * writes into them and allocates nothing. Free of three.js, so the pooling
 * rules (ring reuse, per-match cap, oldest fade, removal by impact) are tested
 * in node; the renderers only upload these arrays.
 */
import type { Droplet } from "./GoreDirector";

/** Droplets in flight. A ring: when it is full the oldest slot is reused. */
export class ParticleBuffer {
  readonly origin: Float32Array;
  readonly velocity: Float32Array;
  /** birth, life, size, drag. */
  readonly timing: Float32Array;
  /** kind (0 drop, 1 mist), shape. */
  readonly look: Float32Array;
  /** Slots ever written: the instance count to draw. */
  used = 0;
  /** Bumped by every write: the renderer uploads when it changes. */
  version = 0;
  /** Clock time after which nothing is in the air. */
  idleAt = 0;
  private cursor = 0;

  constructor(readonly capacity: number) {
    this.origin = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.timing = new Float32Array(capacity * 4);
    this.look = new Float32Array(capacity * 2);
  }

  /** `birth` is on the particle clock. The droplet is copied; the caller may reuse it. */
  emit(droplet: Droplet, birth: number): void {
    if (this.capacity === 0 || !(droplet.life > 0)) return;
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (this.used < this.capacity) this.used += 1;
    this.origin[i * 3] = droplet.origin.x; this.origin[i * 3 + 1] = droplet.origin.y; this.origin[i * 3 + 2] = droplet.origin.z;
    this.velocity[i * 3] = droplet.velocity.x; this.velocity[i * 3 + 1] = droplet.velocity.y; this.velocity[i * 3 + 2] = droplet.velocity.z;
    this.timing[i * 4] = birth; this.timing[i * 4 + 1] = droplet.life; this.timing[i * 4 + 2] = droplet.size; this.timing[i * 4 + 3] = droplet.drag;
    this.look[i * 2] = droplet.kind; this.look[i * 2 + 1] = droplet.shape;
    this.idleAt = Math.max(this.idleAt, birth + droplet.life);
    this.version += 1;
  }

  clear(): void {
    this.timing.fill(0);
    this.used = 0; this.cursor = 0; this.idleAt = 0; this.version += 1;
  }
}

export interface DecalRecord {
  x: number; z: number; radius: number; rotation: number;
  /** 0: stain. 1: pool. */
  kind: 0 | 1;
  shape: number; stretch: number;
  /** Pools: seconds to spread to full size (0: static). */
  grow: number;
  grooveBias: number;
}

/** Seconds an over-cap stain takes to fade out. */
export const DECAL_FADE_SECONDS = 2.5;
/** Extra slots so marks that are fading out still draw while new ones arrive. */
const FADING_SLOTS = 8;

/** Marks on the board. Dense: removal swaps the last mark into the hole. */
export class DecalBuffer {
  readonly slots: number;
  /** x, z, radius, rotation. */
  readonly place: Float32Array;
  /** shape, birth, kind, grow. */
  readonly look: Float32Array;
  /** fadeAt (-1: staying), fadeSeconds, stretch, grooveBias. */
  readonly life: Float32Array;
  count = 0;
  version = 0;
  private readonly impact: string[];
  private readonly serial: Float64Array;
  private next = 0;

  /** `cap` marks stay per match; when one more arrives the oldest fades. */
  constructor(readonly cap: number) {
    this.slots = cap + FADING_SLOTS;
    this.place = new Float32Array(this.slots * 4);
    this.look = new Float32Array(this.slots * 4);
    this.life = new Float32Array(this.slots * 4);
    this.impact = new Array<string>(this.slots).fill("");
    this.serial = new Float64Array(this.slots);
  }

  /** Marks that are staying (not fading out). */
  get staying(): number {
    let n = 0;
    for (let i = 0; i < this.count; i += 1) if (this.life[i * 4] < 0) n += 1;
    return n;
  }

  impactOf(index: number): string { return this.impact[index]; }

  add(impactId: string, record: DecalRecord, now: number): void {
    if (this.cap <= 0) return;
    while (this.staying >= this.cap) this.fadeOldest(now);
    if (this.count >= this.slots) this.removeAt(this.oldest(false));
    const i = this.count;
    this.count += 1;
    this.place[i * 4] = record.x; this.place[i * 4 + 1] = record.z; this.place[i * 4 + 2] = record.radius; this.place[i * 4 + 3] = record.rotation;
    this.look[i * 4] = record.shape; this.look[i * 4 + 1] = now; this.look[i * 4 + 2] = record.kind; this.look[i * 4 + 3] = record.grow;
    this.life[i * 4] = -1; this.life[i * 4 + 1] = DECAL_FADE_SECONDS; this.life[i * 4 + 2] = record.stretch; this.life[i * 4 + 3] = record.grooveBias;
    this.impact[i] = impactId; this.serial[i] = this.next;
    this.next += 1; this.version += 1;
  }

  /** Undo: every mark of one impact goes at once, without a fade. */
  removeImpact(impactId: string): number {
    let removed = 0;
    for (let i = this.count - 1; i >= 0; i -= 1) if (this.impact[i] === impactId) { this.removeAt(i); removed += 1; }
    return removed;
  }

  /** Frees the marks whose fade has finished. */
  update(now: number): void {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const fadeAt = this.life[i * 4];
      if (fadeAt >= 0 && now >= fadeAt + this.life[i * 4 + 1]) this.removeAt(i);
    }
  }

  clear(): void {
    if (this.count) this.version += 1;
    this.count = 0;
  }

  private oldest(stayingOnly: boolean): number {
    let found = -1;
    for (let i = 0; i < this.count; i += 1) {
      if (stayingOnly && this.life[i * 4] >= 0) continue;
      if (found < 0 || this.serial[i] < this.serial[found]) found = i;
    }
    return found;
  }

  private fadeOldest(now: number): void {
    const i = this.oldest(true);
    if (i < 0) return;
    this.life[i * 4] = now; this.version += 1;
  }

  private removeAt(i: number): void {
    if (i < 0 || i >= this.count) return;
    const last = this.count - 1;
    if (i !== last) {
      for (let k = 0; k < 4; k += 1) {
        this.place[i * 4 + k] = this.place[last * 4 + k];
        this.look[i * 4 + k] = this.look[last * 4 + k];
        this.life[i * 4 + k] = this.life[last * 4 + k];
      }
      this.impact[i] = this.impact[last]; this.serial[i] = this.serial[last];
    }
    this.impact[last] = "";
    this.count = last; this.version += 1;
  }
}
