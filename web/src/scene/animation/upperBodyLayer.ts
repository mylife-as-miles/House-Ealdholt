/**
 * An upper-body layer on one figure's skeleton (see layeredPose.ts for the technique and its credit). The figure's
 * mixer keeps playing the whole body (a walk, the stance); after it, this writes the upper clip's rotations onto the
 * spine, arms and head at the layer's weight, with the lowest spine bone solved by the Spine Proxy so the torso
 * faces where the upper clip faces it whatever the hips are doing. The Hips, legs and every position (so the feet
 * and the board anchors) are never written.
 *
 * Like LivingPieceRig it restores the exact sampled pose before the next mixer evaluation ({@link restore}): the
 * mixer only rewrites a bone whose value has changed, so a layer left on a held pose would otherwise stack.
 *
 * Its clock is the figure's animation delta, nothing else: no wall time and no randomness.
 */
import * as THREE from "three";
import { LayerFade, bodyMask, layerTime, layeredSpine, spineProxy, unit, type BodyMask, type LayerClock, type SkeletonNode } from "./layeredPose";

export interface UpperPlay {
  /** Seconds to come in (default .2). Also how long the layer it replaces takes to go. */
  fade?: number;
  /** Clip speed (default 1). */
  rate?: number;
  /** Clip seconds to start at (default 0). */
  from?: number;
  /** Clip seconds to run to and hold there: a wind-up held until the blow. */
  hold?: number;
  /** Loop the clip (default false: it plays once and keeps its last frame). */
  loop?: boolean;
  /** Seconds before it starts to come in. */
  delay?: number;
  /** Lets go by itself this many seconds after it began to come in, over `release` seconds. */
  until?: number;
  release?: number;
  /** The most it ever weighs, 0..1 (default 1). */
  weight?: number;
  /** How much of the Spine Proxy is used, 0..1 (default 1; 0 is a plain masked layer). */
  correction?: number;
  /** Who asked for it: a stop naming another owner leaves it alone. */
  owner?: string;
}

interface Layer {
  readonly clip: THREE.AnimationClip;
  readonly clock: LayerClock;
  readonly fade: LayerFade;
  readonly fadeIn: number;
  readonly delay: number;
  readonly correction: number;
  readonly owner: string;
  /** Seconds since it was asked for, its delay included. */
  since: number;
  started: boolean;
  until: number | null;
  release: number;
  stopping: boolean;
}

/** One interpolant per bone a clip rotates, built once per clip and shared by every figure (they are read and copied at once). */
const ROTATIONS = new WeakMap<THREE.AnimationClip, Map<string, THREE.Interpolant>>();
function rotationsOf(clip: THREE.AnimationClip): Map<string, THREE.Interpolant> {
  let map = ROTATIONS.get(clip);
  if (map) return map;
  map = new Map();
  for (const track of clip.tracks) {
    if (track.getValueSize() !== 4) continue;
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== "quaternion" || map.has(parsed.nodeName)) continue;
    // The track's own interpolant, as the mixer would build it (a quaternion track slerps between its keys).
    // Read into doubles, as the mixer reads them: a float result costs the slerp its precision.
    const own = (track as unknown as { createInterpolant?: (result: Float64Array) => THREE.Interpolant }).createInterpolant;
    map.set(parsed.nodeName, own ? own.call(track, new Float64Array(4)) : new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float64Array(4)));
  }
  ROTATIONS.set(clip, map);
  return map;
}

function read(out: THREE.Quaternion, interpolant: THREE.Interpolant, time: number): THREE.Quaternion {
  const value = interpolant.evaluate(time);
  return out.set(value[0], value[1], value[2], value[3]).normalize();
}

/** The skeleton of a model, as layeredPose.ts reads it: every bone and its parent's name. */
export function skeletonOf(root: THREE.Object3D): { nodes: SkeletonNode[]; bones: Map<string, THREE.Bone> } {
  const nodes: SkeletonNode[] = [], bones = new Map<string, THREE.Bone>();
  root.traverse(node => {
    if (!(node as THREE.Bone).isBone || bones.has(node.name)) return;
    bones.set(node.name, node as THREE.Bone);
    nodes.push({ name: node.name, parent: node.parent ? node.parent.name : null });
  });
  return { nodes, bones };
}

export class UpperBodyLayer {
  readonly mask: BodyMask | null;
  private readonly hips: THREE.Bone | null = null;
  /** The upper bones, the spine root first, parents before children. */
  private readonly bones: THREE.Bone[] = [];
  private readonly base: THREE.Quaternion[] = [];
  private applied = false;
  private incoming: Layer | null = null;
  private outgoing: Layer | null = null;
  private readonly hipsNow = new THREE.Quaternion();
  private readonly hipsUpper = new THREE.Quaternion();
  private readonly sample = new THREE.Quaternion();
  private readonly proxied = new THREE.Quaternion();

  constructor(root: THREE.Object3D) {
    const { nodes, bones } = skeletonOf(root);
    this.mask = bodyMask(nodes);
    if (!this.mask) return;
    this.hips = bones.get(this.mask.hips) ?? null;
    for (const name of this.mask.upper) {
      const bone = bones.get(name);
      if (bone) { this.bones.push(bone); this.base.push(new THREE.Quaternion()); }
    }
  }

  /** Whether this rig can be layered at all. */
  get usable(): boolean { return this.hips !== null && this.bones.length > 0; }
  /** Whether anything is playing or still fading. */
  get active(): boolean { return this.incoming !== null || this.outgoing !== null; }
  /** The clip now coming in or held (not one fading out), and who asked for it. */
  get clip(): THREE.AnimationClip | null { return this.incoming?.clip ?? null; }
  get owner(): string | null { return this.incoming?.owner ?? null; }
  /** What the layer now gives the bones, 0..1. */
  get weight(): number { return Math.max(this.incoming?.fade.weight ?? 0, this.outgoing?.fade.weight ?? 0); }
  /** True while the layer held now is on its way out. */
  get stopping(): boolean { return !this.incoming || this.incoming.stopping; }

  /** Plays `clip` over the upper body. A layer already on is faded out over this one's fade. */
  play(clip: THREE.AnimationClip, options: UpperPlay = {}): boolean {
    if (!this.usable || clip.duration <= 0) return false;
    const fadeIn = Math.max(0, options.fade ?? .2), owner = options.owner ?? "";
    const current = this.incoming;
    // A loop already playing is left to breathe: restarting it would jump the pose.
    if (current && current.clip === clip && current.clock.loop && options.loop && current.owner === owner && current.started) {
      current.stopping = false; current.until = options.until ?? null; current.release = Math.max(0, options.release ?? .3);
      current.fade.peak = unit(options.weight ?? 1); current.fade.to(1, fadeIn);
      return true;
    }
    if (current && current.fade.level > 0) {
      this.outgoing = current; current.stopping = true; current.until = null; current.fade.to(0, fadeIn);
    }
    const fade = new LayerFade();
    fade.peak = unit(options.weight ?? 1);
    const rate = Number.isFinite(options.rate) ? options.rate! : 1;
    this.incoming = {
      clip, fade, fadeIn, owner,
      clock: { duration: clip.duration, from: options.from ?? (rate < 0 ? clip.duration : 0), rate, loop: options.loop === true, hold: options.hold },
      delay: Math.max(0, options.delay ?? 0), correction: unit(options.correction ?? 1),
      since: 0, started: false, until: options.until ?? null, release: Math.max(0, options.release ?? .3), stopping: false,
    };
    return true;
  }

  /**
   * Lets the layer go over `fade` seconds; with `after`, it holds that many seconds first. `owner`: only a layer that
   * owner asked for is stopped. A layer still waiting for its delay goes at once.
   */
  stop(fade = .2, options: { owner?: string; after?: number } = {}): void {
    const layer = this.incoming;
    if (!layer || (options.owner !== undefined && layer.owner !== options.owner)) return;
    if (!layer.started) { this.incoming = null; return; }
    const after = Math.max(0, options.after ?? 0);
    layer.stopping = true;
    if (after > 0) {
      layer.until = layer.since - layer.delay + after; layer.release = Math.max(0, fade);
      // A stop asked for earlier in the frame (a full-body clip starting) is overruled: it holds until then.
      if (layer.fade.target < 1) layer.fade.to(1, layer.fadeIn * (1 - layer.fade.level));
      return;
    }
    layer.until = null;
    layer.fade.to(0, Math.max(0, fade));
  }

  /** Drops every layer at once. The bones get their sampled pose back at the next {@link restore}. */
  clear(): void { this.incoming = this.outgoing = null; }

  /** Always call before the figure's mixer: puts back exactly what the mixer left. */
  restore(): void {
    if (!this.applied) return;
    for (let i = 0; i < this.bones.length; i += 1) this.bones[i].quaternion.copy(this.base[i]);
    this.applied = false;
  }

  /**
   * After the mixer (and anything else that poses the hips and legs), before any procedural layer. `delta` is the
   * figure's animation delta. With `write` false the layer's clock and fades run but no bone is touched (the flat map).
   */
  apply(delta: number, write = true): void {
    const step = Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (this.outgoing) { this.advance(this.outgoing, step); if (this.outgoing.fade.settled && this.outgoing.fade.level === 0) this.outgoing = null; }
    if (this.incoming) {
      this.advance(this.incoming, step);
      if (this.incoming.stopping && this.incoming.until === null && this.incoming.fade.settled && this.incoming.fade.level === 0) this.incoming = null;
    }
    if (!write || !this.hips) return;
    const out = this.outgoing && this.outgoing.fade.weight > 1e-5 ? this.outgoing : null;
    const into = this.incoming && this.incoming.fade.weight > 1e-5 ? this.incoming : null;
    if (!out && !into) return;
    for (let i = 0; i < this.bones.length; i += 1) this.base[i].copy(this.bones[i].quaternion);
    this.applied = true;
    this.hipsNow.copy(this.hips.quaternion);
    if (out) this.write(out);
    if (into) this.write(into);
  }

  private advance(layer: Layer, step: number): void {
    layer.since += step;
    const running = layer.since - layer.delay;
    if (!layer.started) {
      if (running < 0) return;
      layer.started = true;
      // It begins to come in on the frame its delay runs out, its fade counted from there.
      layer.fade.to(1, layer.fadeIn);
      layer.fade.advance(running);
      return;
    }
    if (layer.until !== null && running >= layer.until) {
      // It lets go on the frame its time runs out, the fade counted from that moment.
      const over = running - layer.until;
      layer.until = null; layer.stopping = true;
      layer.fade.to(0, layer.release);
      layer.fade.advance(Math.min(step, over));
      return;
    }
    layer.fade.advance(step);
  }

  private write(layer: Layer): void {
    const weight = layer.fade.weight;
    const rotations = rotationsOf(layer.clip);
    const time = layerTime(layer.clock, Math.max(0, layer.since - layer.delay));
    const hips = rotations.get(this.hips!.name);
    // A clip that does not turn the hips is taken to hold them as the lower clip does: no correction then.
    if (hips) read(this.hipsUpper, hips, time); else this.hipsUpper.copy(this.hipsNow);
    for (let i = 0; i < this.bones.length; i += 1) {
      const bone = this.bones[i], track = rotations.get(bone.name);
      if (!track) continue;
      read(this.sample, track, time);
      if (i === 0) {
        spineProxy(this.proxied, this.hipsNow, this.hipsUpper, this.sample);
        layeredSpine(bone.quaternion, bone.quaternion, this.sample, this.proxied, weight, layer.correction);
      } else bone.quaternion.slerp(this.sample, weight);
    }
  }
}
