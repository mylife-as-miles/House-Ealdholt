/**
 * The killing blow's crescent of light (arcPlan.ts), drawn: the surface the outer part of the blade swept in its last
 * fraction of a second, with a crisp, white-hot leading edge on the tip's own path, the kingdom's colour through its
 * body, a deep colour at its soft inner side, streaks along the motion, and a soft halo beyond both edges so it glows
 * with no bloom. It sheds sparks off its edge as the blow lands.
 *
 * The blade is sampled every frame after animation and contact IK, unseen, from the first beat of a fight; the arc is
 * drawn only once it is revealed, as the killing blow lands, with the swing that brought it home, and it is gone 0.3 s
 * later. Every other motion stays clean. A summon's blow, which has no blade of ours to sample, is given a virtual
 * blade swept through the strike ({@link LightArcs.slash}).
 *
 * A fixed set of arcs, each with its history, its strip and its buffers allocated once: a frame writes into them.
 */
import * as THREE from "three";
import { sequence, between, type Dice } from "../spells/shared/particlePlan";
import { ARC, ArcHistory, ArcStrip, arcEnvelope, arcStepLimit, sparkAlong, type ArcEnvelope, type ArcStripInput } from "./arcPlan";
import type { FlourishLook } from "./flourishPlan";
import { SPARK_KIND, blankShard } from "./shardPlan";
import type { SparkPool } from "./sparks";

/** Writes the blade's tip and the root point back along it into the two vectors; false when the weapon cannot be found. */
export type ArcSampler = (tip: THREE.Vector3, root: THREE.Vector3) => boolean;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
attribute float aAcross, aAlong, aAlpha, aSweep;
varying float vAcross, vAlong, vAlpha, vSweep;
varying vec3 vWorld;
void main() {
  vAcross = aAcross; vAlong = aAlong; vAlpha = aAlpha; vSweep = aSweep; vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uCore, uEdge, uDeep;
uniform float uGain, uSeed, uFloor;
uniform vec4 uClear;
varying float vAcross, vAlong, vAlpha, vSweep;
varying vec3 vWorld;
void main() {
  float v = vAcross, u = vAlong;
  float aa = max(fwidth(v), 1e-4);
  // a swing: the leading edge is the blade tip's own path, crisp, and the body thins away toward its inner side, with
  // a white-hot line just inside the edge
  float lead = smoothstep(-aa, aa, v);
  float c = (v - 0.09) / 0.085;
  float swingBody = lead * (1.0 - smoothstep(0.32, 1.0, v)), swingCore = exp(-c * c) * lead;
  // a thrust: a stroke along the line it was driven down, crisp at both sides, white-hot down its middle
  float m = abs(v - 0.5) * 2.0, mc = m / 0.2;
  float thrustBody = 1.0 - smoothstep(1.0 - 2.0 * aa, 1.0, m), thrustCore = exp(-mc * mc);
  float body = mix(thrustBody * (1.0 - 0.35 * m), swingBody, vSweep), core = mix(thrustCore, swingCore, vSweep);
  // streaks along the motion, as a brush leaves
  float streak = 0.55 + 0.45 * noise(vec2(v * 19.0 + uSeed * 13.0, u * 3.0 + uSeed * 7.0));
  // hottest at the weapon
  float heat = (1.0 - u) * (1.0 - u);
  // the halo beyond either edge: the lowest preset and the recorder have no bloom
  float dist = v < 0.0 ? -v / 0.32 : (v > 1.0 ? (v - 1.0) / 0.55 : 0.0);
  float halo = exp(-dist * dist * 3.0);
  // the kingdom's own colour through the body, its deep colour soon after: saturated, not a white haze
  vec3 tone = mix(mix(uEdge, uDeep, smoothstep(0.1, 0.8, m)), mix(uEdge, uDeep, smoothstep(0.08, 0.75, v)), vSweep);
  vec3 light = tone * body * streak * (0.32 + 0.5 * heat) + uCore * core * (0.4 + 1.0 * heat) + uDeep * halo * 0.14 * (0.35 + 0.65 * heat);
  // and a little ink under it, so the colour stands out on pale marble as on dark stone
  float cover = body * 0.8 * (0.5 + 0.5 * heat) + halo * 0.08 * heat;
  // it parts round the wound, so the cut is seen
  if (uClear.w > 0.0) { float m = smoothstep(uClear.w * 0.55, uClear.w, distance(vWorld, uClear.xyz)); light *= mix(0.2, 1.0, m); cover *= m; }
  // and never shows through the stone
  float lift = smoothstep(uFloor, uFloor + 0.03, vWorld.y);
  light *= vAlpha * lift; cover *= vAlpha * lift;
  if (max(max(light.r, light.g), light.b) < 0.002 && cover < 0.004) discard;
  gl_FragColor = vec4(light * uGain, cover);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface ArcSlot {
  id: string | null;
  sample: ArcSampler | null;
  hidden: boolean;
  /** The flourish clock when it was revealed (NaN before), and when it stops tracing the blade. */
  revealed: number;
  stopAt: number;
  /** Extra time it is held whole (a virtual blade's sweep). */
  hold: number;
  history: ArcHistory;
  strip: ArcStrip;
  geometry: THREE.BufferGeometry;
  attributes: { position: THREE.BufferAttribute; across: THREE.BufferAttribute; along: THREE.BufferAttribute; alpha: THREE.BufferAttribute; sweep: THREE.BufferAttribute };
  /** The same attributes as a list, made once: what a frame uploads. */
  uploads: readonly THREE.BufferAttribute[];
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dice: Dice;
  /** The blade's scale (a giant's sabre is traced with a thicker arc and longer steps between frames). */
  scale: number;
  /** Sparks it has shed, and may shed. */
  shed: number;
  sparks: number;
}

export class LightArcs {
  readonly object = new THREE.Group();
  private readonly slots: ArcSlot[] = [];
  private readonly tip = new THREE.Vector3();
  private readonly root = new THREE.Vector3();
  private readonly envelope: ArcEnvelope = { alpha: 0, width: 0, done: false };
  /** What a frame's strip is built with, filled in place (a frame allocates nothing). */
  private readonly shaping: ArcStripInput & { eye: THREE.Vector3 } = { shapeNow: 0, eye: new THREE.Vector3(), envelope: this.envelope, subdivide: 1, scale: 1 };
  private readonly spec = blankShard();
  private time = 0;
  private subdivide: number;
  private sparksPerArc: number;

  constructor(private readonly sparks: SparkPool, private readonly floor: number, options: { slots?: number; subdivide: number; sparks: number }) {
    this.object.name = "FlourishArcs";
    this.subdivide = Math.max(1, Math.floor(options.subdivide));
    this.sparksPerArc = Math.max(0, Math.floor(options.sparks));
    const maxSections = new ArcStrip(ARC.history, 6).maxSections;
    const index = ArcStrip.indices(maxSections);
    for (let i = 0; i < (options.slots ?? 4); i += 1) {
      const strip = new ArcStrip(ARC.history, 6);
      const geometry = new THREE.BufferGeometry();
      const attributes = {
        position: new THREE.BufferAttribute(strip.positions, 3).setUsage(THREE.DynamicDrawUsage),
        across: new THREE.BufferAttribute(strip.across, 1).setUsage(THREE.DynamicDrawUsage),
        along: new THREE.BufferAttribute(strip.along, 1).setUsage(THREE.DynamicDrawUsage),
        alpha: new THREE.BufferAttribute(strip.alpha, 1).setUsage(THREE.DynamicDrawUsage),
        sweep: new THREE.BufferAttribute(strip.sweep, 1).setUsage(THREE.DynamicDrawUsage),
      };
      geometry.setAttribute("position", attributes.position);
      geometry.setAttribute("aAcross", attributes.across);
      geometry.setAttribute("aAlong", attributes.along);
      geometry.setAttribute("aAlpha", attributes.alpha);
      geometry.setAttribute("aSweep", attributes.sweep);
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.setDrawRange(0, 0);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() },
          uGain: { value: 1 }, uSeed: { value: 0 }, uFloor: { value: floor }, uClear: { value: new THREE.Vector4(0, 0, 0, 0) },
        },
        vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `FlourishArc${i}`;
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.renderOrder = 14;
      this.object.add(mesh);
      const uploads = [attributes.position, attributes.across, attributes.along, attributes.alpha, attributes.sweep];
      this.slots.push({ id: null, sample: null, hidden: true, revealed: NaN, stopAt: Infinity, hold: 0, history: new ArcHistory(), strip, geometry, attributes, uploads, mesh, material, dice: sequence(1), scale: 1, shed: 0, sparks: 0 });
    }
  }

  /** Arcs being traced or drawn. */
  get active(): number { return this.slots.filter(slot => slot.id !== null).length; }
  /** Arcs on screen now. */
  get drawn(): number { return this.slots.filter(slot => slot.mesh.visible).length; }

  /**
   * Starts tracing a blade, unseen until {@link reveal}. Restarting an id starts a fresh stroke; when every slot is busy
   * the oldest finished or hidden one gives way, else nothing is traced (false).
   */
  begin(id: string, sample: ArcSampler, look: FlourishLook, seed: number, scale = 1): boolean {
    if (!id || typeof sample !== "function") return false;
    const slot = this.slots.find(item => item.id === id) ?? this.slots.find(item => item.id === null) ?? this.slots.find(item => item.hidden);
    if (!slot) return false;
    this.reset(slot);
    slot.id = id; slot.sample = sample; slot.hidden = true; slot.dice = sequence(seed >>> 0 || 1); slot.sparks = this.sparksPerArc;
    slot.scale = Number.isFinite(scale) ? Math.min(3, Math.max(0.5, scale)) : 1;
    const u = slot.material.uniforms;
    (u.uCore.value as THREE.Color).setHex(look.core); (u.uEdge.value as THREE.Color).setHex(look.edge); (u.uDeep.value as THREE.Color).setHex(look.deep);
    u.uSeed.value = slot.dice();
    return true;
  }

  /** The blow has landed: the arc is drawn from now, with the swing it has traced, and traces the follow-through a moment. */
  reveal(id: string): void {
    for (const slot of this.slots) if (slot.id === id && slot.hidden) {
      slot.hidden = false; slot.revealed = this.time; slot.stopAt = this.time + ARC.follow + slot.hold;
    }
  }

  /** Where the blade went in: the arc thins to its hot line within `radius` of it, so the wound is seen. */
  clearAround(id: string, at: THREE.Vector3, radius = 0.2): void {
    for (const slot of this.slots) if (slot.id === id) (slot.material.uniforms.uClear.value as THREE.Vector4).set(at.x, at.y, at.z, radius);
  }

  /** Stops tracing (the fight has moved on); what is drawn fades as it would. An arc never revealed goes at once. */
  stop(id: string): void {
    for (const slot of this.slots) if (slot.id === id) { slot.sample = null; if (slot.hidden) this.reset(slot); }
  }

  /**
   * A virtual blade swept through `centre`, for a blow with no blade of ours to sample (a summon's): its tip runs round a
   * circle of `radius` in the plane of the unit vectors `from` (where it starts) and `toward` (the way it goes), through
   * `sweep` radians in `seconds`, its body `thickness` deep. Drawn as it sweeps.
   */
  slash(id: string, centre: THREE.Vector3, from: THREE.Vector3, toward: THREE.Vector3, radius: number, thickness: number, sweep: number, seconds: number, look: FlourishLook, seed: number): boolean {
    const start = this.time, c = centre.clone(), a = from.clone().normalize(), b = toward.clone().normalize();
    const sampler: ArcSampler = (tip, root) => {
      const t = Math.min(1, (this.time - start) / Math.max(1e-3, seconds));
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      const angle = eased * sweep, x = Math.cos(angle), y = Math.sin(angle);
      tip.copy(c).addScaledVector(a, x * radius).addScaledVector(b, y * radius);
      root.copy(c).addScaledVector(a, x * (radius - thickness)).addScaledVector(b, y * (radius - thickness));
      return true;
    };
    if (!this.begin(id, sampler, look, seed)) return false;
    const slot = this.slots.find(item => item.id === id)!;
    slot.hold = seconds;
    this.reveal(id);
    // its first sample is the sweep's start, taken now
    this.capture(slot);
    return true;
  }

  /** Call once a frame, after animation and contact IK: the blades are sampled as this frame has posed them. */
  update(seconds: number, camera: THREE.Camera): void {
    this.time += Math.max(0, seconds);
    for (const slot of this.slots) {
      if (slot.id === null) continue;
      if (slot.sample && this.time <= slot.stopAt) this.capture(slot);
      else if (slot.sample && !slot.hidden) slot.sample = null;
      slot.history.expire(this.time, ARC.span + ARC.hold + ARC.fade + slot.hold + 0.2);
      if (slot.hidden) { slot.mesh.visible = false; if (!slot.sample) this.reset(slot); continue; }
      const since = this.time - slot.revealed;
      const envelope = arcEnvelope(since, slot.hold, this.envelope);
      if (envelope.done) { this.reset(slot); continue; }
      const shaping = this.shaping;
      shaping.shapeNow = slot.revealed + Math.min(since, slot.hold) + Math.max(0, since - slot.hold) * ARC.drift;
      shaping.eye.copy(camera.position); shaping.envelope = envelope; shaping.subdivide = this.subdivide; shaping.scale = slot.scale;
      const sections = slot.strip.build(slot.history, shaping);
      if (sections < 2) { slot.mesh.visible = false; slot.geometry.setDrawRange(0, 0); continue; }
      const vertices = sections * 4;
      for (let k = 0; k < slot.uploads.length; k += 1) {
        const attribute = slot.uploads[k];
        attribute.clearUpdateRanges(); attribute.addUpdateRange(0, vertices * attribute.itemSize); attribute.needsUpdate = true;
      }
      slot.geometry.setDrawRange(0, (sections - 1) * 18);
      slot.mesh.visible = true;
      this.shed(slot, since);
    }
    let drawn = false;
    for (let k = 0; k < this.slots.length; k += 1) drawn ||= this.slots[k].mesh.visible;
    this.object.visible = drawn;
  }

  setGain(gain: number): void { for (const slot of this.slots) slot.material.uniforms.uGain.value = gain; }

  setBudget(subdivide: number, sparks: number): void { this.subdivide = Math.max(1, Math.min(6, Math.floor(subdivide))); this.sparksPerArc = Math.max(0, Math.floor(sparks)); }

  clear(): void { for (const slot of this.slots) this.reset(slot); this.object.visible = false; }

  dispose(): void {
    this.clear();
    this.object.removeFromParent();
    for (const slot of this.slots) { slot.geometry.dispose(); slot.material.dispose(); }
  }

  private capture(slot: ArcSlot): void {
    this.tip.set(NaN, NaN, NaN); this.root.set(NaN, NaN, NaN);
    let ok = false;
    try { ok = slot.sample!(this.tip, this.root); } catch { ok = false; }
    if (!ok) { slot.history.breakNext(); return; }
    const h = slot.history, since = h.count > 0 ? this.time - h.birth[h.index(h.count - 1)] : 0;
    const limit = arcStepLimit(this.tip.distanceTo(this.root), slot.scale, since);
    h.push(this.time, this.tip.x, this.tip.y, this.tip.z, this.root.x, this.root.y, this.root.z, limit);
  }

  /** Sparks off the arc's leading edge: most as the blow lands, the rest through the follow-through. */
  private shed(slot: ArcSlot, since: number): void {
    const due = Math.min(slot.sparks, Math.ceil(slot.sparks * (0.65 + 0.35 * Math.min(1, since / Math.max(1e-3, ARC.follow + slot.hold)))));
    const strip = slot.strip, last = strip.sections - 1, spec = this.spec, dice = slot.dice;
    while (slot.shed < due) {
      slot.shed += 1;
      // along the stroke from the weapon back: strip sections run oldest to newest
      const j = Math.max(0, Math.min(last, Math.round(last - sparkAlong(dice()) * last)));
      const o = j * 3, speed = between(dice, 1.0, 2.8), off = between(dice, 0.25, 0.9);
      spec.kind = SPARK_KIND.streak;
      spec.x = strip.tips[o]; spec.y = strip.tips[o + 1]; spec.z = strip.tips[o + 2];
      spec.vx = strip.tangents[o] * speed - strip.normals[o] * off + between(dice, -0.5, 0.5);
      spec.vy = strip.tangents[o + 1] * speed - strip.normals[o + 1] * off + between(dice, 0.1, 0.9);
      spec.vz = strip.tangents[o + 2] * speed - strip.normals[o + 2] * off + between(dice, -0.5, 0.5);
      spec.delay = 0; spec.life = between(dice, 0.18, 0.4); spec.drag = between(dice, 3, 4.5); spec.gravity = 2.5;
      spec.size = between(dice, 0.006, 0.011); spec.wander = 0; spec.spin = 0.014; spec.seed = dice();
      const u = slot.material.uniforms;
      spec.colour = dice() < 0.3 ? (u.uCore.value as THREE.Color).getHex() : (u.uEdge.value as THREE.Color).getHex();
      spec.heat = 1; spec.edge = spec.colour;
      this.sparks.spawn(spec);
    }
  }

  private reset(slot: ArcSlot): void {
    slot.id = null; slot.sample = null; slot.hidden = true; slot.revealed = NaN; slot.stopAt = Infinity; slot.hold = 0; slot.shed = 0; slot.scale = 1;
    slot.history.clear(); slot.geometry.setDrawRange(0, 0); slot.mesh.visible = false;
    (slot.material.uniforms.uClear.value as THREE.Vector4).set(0, 0, 0, 0);
  }
}

/**
 * The sampler for a figure's weapon: the tip is its weapon socket (the contact point weapons.ts finds at the top of the
 * prop), the root a point `share` of the way back from the tip toward the hand that holds it (the prop's own frame,
 * the socket's grandparent). `socket` is asked every frame; null when the figure has no weapon.
 */
export function weaponEdge(socket: () => THREE.Object3D | null, share = ARC.share): ArcSampler {
  const grip = new THREE.Vector3();
  return (tip, root) => {
    const node = socket(), prop = node?.parent?.parent;
    if (!node || !prop) return false;
    node.getWorldPosition(tip); prop.getWorldPosition(grip);
    root.copy(grip).lerp(tip, 1 - share);
    return Number.isFinite(tip.x + tip.y + tip.z + root.x + root.y + root.z) && tip.distanceToSquared(root) > 1e-8;
  };
}
