/**
 * Layered animation for the figures' humanoid rig: an upper-body clip (a guard, an aim, a reload) played over whatever
 * the legs are doing (a walk, the stance), with the spine set so the torso faces where the upper clip faces it.
 *
 * A plain bone mask breaks on a rig like ours because of inheritance: the lower clip owns the Hips, every spine bone
 * hangs off the Hips, so a masked upper body still swings with the walk's hips and the chest points wherever the
 * pelvis does. The fix is the idea of Kevin Iglesias's Spine Proxy (https://www.keviniglesias.com/spine-proxy.html):
 * the lowest spine bone is given the rotation it has in the figure's frame in the upper clip, whatever the hips do.
 * His version keys a proxy bone outside the hips; here no bone or asset is added: the upper clip's own Hips and spine
 * tracks are evaluated at the layer's time and the spine's local rotation is solved under the hips the lower clip
 * left (see {@link spineProxy}). No code is taken from his scripts.
 *
 * Pure maths on three.js value types: no scene, no clocks, no randomness. upperBodyLayer.ts plays it on a skeleton.
 */
import * as THREE from "three";

/** One node of a skeleton, by name, with its parent's name (null at the root). */
export interface SkeletonNode {
  readonly name: string;
  readonly parent: string | null;
}

/**
 * How a skeleton divides. `lower` is the Hips, the legs and everything above the Hips (the armature root): the lower
 * clip keeps them. `upper` is the lowest spine bone (`spine`, the Hips' child the head hangs from) and everything
 * under it, parents before children: the upper clip takes them.
 */
export interface BodyMask {
  readonly hips: string;
  readonly spine: string;
  readonly upper: readonly string[];
  readonly lower: readonly string[];
}

/** A bone name as the rigs spell it, stripped of case, punctuation and a Mixamo prefix. */
export function plainBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, "");
}

/**
 * Splits a skeleton at the spine. The Hips are found by name (`Hips` or `Pelvis`); the spine root is the Hips' child
 * on the way down from the Head. Null when the rig has no hips, no head, or a head that does not hang from the hips:
 * such a rig is never layered.
 */
export function bodyMask(nodes: readonly SkeletonNode[]): BodyMask | null {
  const byName = new Map<string, SkeletonNode>();
  for (const node of nodes) if (!byName.has(node.name)) byName.set(node.name, node);
  const hips = nodes.find(node => /^(hips|pelvis)$/.test(plainBoneName(node.name)));
  const head = nodes.find(node => plainBoneName(node.name) === "head");
  if (!hips || !head) return null;
  // Up from the head to the Hips: the last bone before them is the spine root.
  let spine: SkeletonNode | null = null;
  for (let node: SkeletonNode | undefined = head, guard = 0; node && guard < nodes.length; guard += 1) {
    if (node.parent === hips.name) { spine = node; break; }
    node = node.parent === null ? undefined : byName.get(node.parent);
  }
  if (!spine) return null;
  const children = new Map<string, string[]>();
  for (const node of nodes) if (node.parent !== null) {
    const list = children.get(node.parent);
    if (list) list.push(node.name); else children.set(node.parent, [node.name]);
  }
  const upper: string[] = [];
  const queue = [spine.name];
  for (let i = 0; i < queue.length; i += 1) {
    upper.push(queue[i]);
    for (const child of children.get(queue[i]) ?? []) queue.push(child);
  }
  const above = new Set(upper);
  const lower = nodes.map(node => node.name).filter(name => !above.has(name));
  return { hips: hips.name, spine: spine.name, upper, lower };
}

const proxyScratch = new THREE.Quaternion();

/**
 * The Spine Proxy. Every rotation here is local to its bone's parent; the Hips' parent (the figure's armature) is
 * the same for both clips, so it cancels: the spine's rotation in the figure's frame is `hips · spine`, and the upper
 * clip wants it to be `hipsUpper · spineUpper`. Under the hips the lower clip left (`hipsNow`) that needs
 * `spine = hipsNow⁻¹ · hipsUpper · spineUpper`, written into `out` (which may be any of the inputs).
 */
export function spineProxy(out: THREE.Quaternion, hipsNow: THREE.Quaternion, hipsUpper: THREE.Quaternion, spineUpper: THREE.Quaternion): THREE.Quaternion {
  proxyScratch.copy(hipsNow).invert().multiply(hipsUpper).multiply(spineUpper);
  return out.copy(proxyScratch).normalize();
}

/**
 * The spine with the upper layer at `weight`: the lower clip's own spine at 0, the upper clip's at 1. `correction`
 * is how much of the proxy is used: 1 keeps the upper clip's torso in the figure's frame whatever the hips do, 0 is
 * the plain masked layer (the torso inherits the lower clip's hips).
 */
export function layeredSpine(
  out: THREE.Quaternion, lower: THREE.Quaternion, upperLocal: THREE.Quaternion, proxied: THREE.Quaternion, weight: number, correction = 1,
): THREE.Quaternion {
  const w = unit(weight), c = unit(correction);
  proxyScratch.slerpQuaternions(upperLocal, proxied, c);
  return out.slerpQuaternions(lower, proxyScratch, w);
}

/** 0..1, a NaN as 0. */
export function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** The smoothstep a fade is read through: it starts and stops without a jolt. */
export function smoothWeight(value: number): number {
  const v = unit(value);
  return v * v * (3 - 2 * v);
}

/**
 * A layer's weight: moved at a steady pace toward its target, so a fade asked for over `seconds` arrives in exactly
 * that time from wherever it stands, and read through {@link smoothWeight}. `peak` scales what is read.
 */
export class LayerFade {
  private value = 0;
  private aim = 0;
  private pace = Infinity;
  peak = 1;

  /** Heads for `target` (0..1), arriving in `seconds` (0: at once). */
  to(target: number, seconds: number): void {
    this.aim = unit(target);
    const distance = Math.abs(this.aim - this.value);
    this.pace = seconds > 1e-6 && distance > 0 ? distance / seconds : Infinity;
    if (this.pace === Infinity) this.value = this.aim;
  }
  /** Sets it where it is, with no fade. */
  set(value: number): void { this.value = this.aim = unit(value); this.pace = Infinity; }
  advance(delta: number): void {
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (this.value === this.aim || step === 0) return;
    const move = this.pace * step;
    this.value = this.value < this.aim ? Math.min(this.aim, this.value + move) : Math.max(this.aim, this.value - move);
  }
  /** The raw 0..1 position of the fade. */
  get level(): number { return this.value; }
  get target(): number { return this.aim; }
  /** What the bones get: the fade through its smoothstep, times the peak. */
  get weight(): number { return smoothWeight(this.value) * unit(this.peak); }
  get settled(): boolean { return this.value === this.aim; }
}

/** How a layer's clip runs: from `from` at `rate`, looping, playing once, or running to `hold` and staying there. */
export interface LayerClock {
  readonly duration: number;
  readonly from: number;
  readonly rate: number;
  readonly loop: boolean;
  /** Clip seconds to run to (from `from`, at the rate's size, either way) and stay at; undefined: loop, or play once and keep the last frame. */
  readonly hold?: number;
}

/** The clip seconds a layer shows `elapsed` seconds after it started. */
export function layerTime(clock: LayerClock, elapsed: number): number {
  const duration = Math.max(0, clock.duration), run = Math.max(0, elapsed);
  const from = Math.min(duration, Math.max(0, clock.from));
  if (clock.hold !== undefined) {
    const hold = Math.min(duration, Math.max(0, clock.hold)), pace = Math.abs(clock.rate);
    return hold >= from ? Math.min(hold, from + run * pace) : Math.max(hold, from - run * pace);
  }
  const t = from + run * clock.rate;
  if (clock.loop && duration > 1e-6) return ((t % duration) + duration) % duration;
  return Math.min(duration, Math.max(0, t));
}

/** An upper-body pose a figure can hold: a clip, looped, or run to `hold` (clip seconds) and kept there. */
export interface HeldGuard {
  readonly id: string;
  readonly loop: boolean;
  readonly hold?: number;
  /** True when the pose is the opening of the blow itself, held at its wind-up. */
  readonly strike: boolean;
}

/**
 * The guard a killer comes into its fight holding. Its library's own guard where it has one: combat-v2's `ready.guard`
 * loop, else combat-v1's `ready.stance` held at its `ready` marker. Otherwise the blow it is about to throw, held at its
 * wind-up (`strike`, in clip seconds), so the blow starts from where the arms already are. Null when it has neither.
 */
export function chargeGuard(has: (id: string) => boolean, ready: (id: string) => number | null, strike: { id: string; windup: number } | null): HeldGuard | null {
  if (has("ready.guard")) return { id: "ready.guard", loop: true, strike: false };
  if (has("ready.stance")) { const at = ready("ready.stance"); if (at !== null) return { id: "ready.stance", loop: false, hold: at, strike: false }; }
  if (strike && strike.windup > 0) return { id: strike.id, loop: false, hold: strike.windup, strike: true };
  return null;
}

/**
 * The guard a witness raises over its planted feet: the duel guard loop, else a block held at its `guard` frame.
 * Null for a figure whose library has neither: it keeps the plain reaction.
 */
export function witnessGuard(has: (id: string) => boolean, guardFrame: (id: string) => number | null): HeldGuard | null {
  if (has("ready.guard")) return { id: "ready.guard", loop: true, strike: false };
  for (const id of ["defend.block", "defend.block-mid"]) {
    if (!has(id)) continue;
    const at = guardFrame(id);
    if (at !== null && at > 0) return { id, loop: false, hold: at, strike: false };
  }
  return null;
}

/**
 * How a held guard gives way to the blow that follows it, `windup` seconds into the blow (its own wind-up). A guard
 * that is the blow's opening holds until the blow has nearly caught up with it and lets go over the last `handover`
 * seconds, so the arms never drop back; any other guard blends into the wind-up over the whole of it.
 */
export function guardHandover(guard: Pick<HeldGuard, "strike">, windup: number, handover = .08): { after: number; fade: number } {
  const w = Number.isFinite(windup) ? Math.max(0, windup) : 0;
  if (guard.strike) { const fade = Math.min(handover, w); return { after: Math.max(0, w - fade), fade: Math.max(fade, 1e-3) }; }
  return { after: 0, fade: Math.max(.1, w) };
}
