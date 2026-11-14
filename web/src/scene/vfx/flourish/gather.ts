// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The ribbons a caster draws in to the hand as it gathers a spell (gatherPlan.ts), drawn, and for a Kwind-09 cast the
 * little arcs that crackle round the hand.
 *
 * Both are the spells' own ribbon (spells/shared/ribbon.ts): a strip cut once, a strand per instance, its place in the
 * world decided in the vertex shader by a curve, drawn twice (a soft halo under a hot core, so it reads with no bloom).
 * The ribbons' curve is the spiral of gatherPlan.ts, sliding in to the hand; the arcs' curve is a straight line from a
 * point near the hand to it, kinked by noise joined with straight lines (corners make lightning) and found again many
 * times a second. The hand is a uniform, asked of the caster every frame, so a moving arm carries the vortex with it.
 * Nothing is rebuilt per frame and nothing is allocated: a gather is a few uniforms. The ribbon, and the kink of noise
 * joined by straight lines pinned at both ends, are the reference's (via spells/shared/ribbon.ts and ribbonPlan.ts).
 */
import * as THREE from "three";
import { Ribbon, RIBBON_NOISE } from "../spells/shared/ribbon";
import { strandSeeds } from "../spells/shared/ribbonPlan";
import type { FlourishLook } from "./flourishPlan";
import { GATHER, gatherEnvelope, gatherPeriod } from "./gatherPlan";

const CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uHand;
uniform float uTime, uPeriod, uEnvelope, uRadius, uRun, uTurns, uWidth, uSeed;
vec3 spiral(float s, vec4 strand) {
  float k = clamp(s, 0.0, 1.0);
  float turn = (strand.y + uSeed) * TAU + uTurns * TAU * k;
  float r = uRadius * (0.75 + 0.5 * strand.w) * pow(1.0 - k, 1.25);
  float h = (-0.45 + 1.1 * strand.z) * uRadius * (1.0 - k * k);
  return uHand + vec3(cos(turn) * r, h, sin(turn) * r);
}
float headOf(vec4 strand) { return fract(uTime / uPeriod + strand.x * 0.37 + strand.y + uSeed) * (1.0 + uRun); }
vec3 ribbonPoint(float t, vec4 strand) {
  float s = headOf(strand) - (1.0 - t) * uRun;
  ribbonCarry = vec4(clamp(s, 0.0, 1.0), t, 0.0, 0.0);
  return spiral(s, strand);
}
float ribbonWidth(float t, vec4 strand) {
  float s = headOf(strand) - (1.0 - t) * uRun;
  if (s <= 0.0 || s >= 1.0) return 0.0;
  float taper = smoothstep(0.0, 0.55, t) * (1.0 - 0.75 * smoothstep(0.88, 1.0, t));
  return uWidth * taper * (0.55 + 0.45 * (1.0 - s)) * uEnvelope;
}
`;

const SHADE = /* glsl */ `
uniform vec3 uCore, uEdge, uDeep;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = clamp(1.0 - abs(side), 0.0, 1.0);
#ifdef RIBBON_HALO
  return mix(uDeep, uEdge, 0.45) * across * across * (0.2 + 0.32 * t);
#else
  float heart = across * across * across;
  float head = smoothstep(0.7, 1.0, t);
  vec3 c = mix(uEdge, uCore, heart * (0.25 + 0.75 * head));
  return c * (heart * 1.25 + across * 0.3) * (0.35 + 0.65 * t) * (0.8 + 0.4 * vCarry.x);
#endif
}
`;

const ARC_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uHand;
uniform float uTime, uEnvelope, uReach, uRate, uSeed;
vec3 ribbonPoint(float t, vec4 strand) {
  float tick = floor(uTime * uRate + strand.y * 7.0) + uSeed * 97.0;
  float a = hash1(tick * 1.73 + strand.z * 31.0) * TAU, b = hash1(tick * 2.31 + strand.w * 17.0) * 1.6 - 0.8;
  float level = sqrt(1.0 - b * b);
  vec3 dir = vec3(cos(a) * level, b, sin(a) * level);
  vec3 far = uHand + dir * uReach * (0.55 + 0.45 * hash1(tick * 0.7 + strand.x * 3.0));
  vec3 across = cross(dir, vec3(0.0, 1.0, 0.0));
  across = dot(across, across) > 1e-6 ? normalize(across) : vec3(1.0, 0.0, 0.0);
  vec3 other = cross(dir, across);
  float pinch = sin(PI * clamp(t, 0.0, 1.0));
  ribbonCarry = vec4(t, 0.0, 0.0, 0.0);
  return mix(far, uHand, t) + (across * vnoise(t * 7.0, tick * 13.0 + strand.x) + other * vnoise(t * 7.0, tick * 7.0 + 3.0 + strand.x)) * uReach * 0.22 * pinch;
}
float ribbonWidth(float t, vec4 strand) {
  float tick = floor(uTime * uRate + strand.y * 7.0) + uSeed * 97.0;
  return 0.0055 * step(0.4, hash1(tick * 3.1 + strand.x * 5.0 + strand.w)) * uEnvelope;
}
`;

const ARC_SHADE = /* glsl */ `
uniform vec3 uCore, uEdge;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = clamp(1.0 - abs(side), 0.0, 1.0);
#ifdef RIBBON_HALO
  return uEdge * across * across * 0.42;
#else
  return mix(uEdge, uCore, across * across) * (across * across * 1.8 + across * 0.4);
#endif
}
`;

export type HandSampler = (out: THREE.Vector3) => THREE.Vector3 | null;

export class GatherRibbons {
  readonly object = new THREE.Group();
  private readonly ribbons: Ribbon;
  private readonly arcs: Ribbon | null;
  private readonly hand = new THREE.Vector3();
  private id: string | null = null;
  private sample: HandSampler | null = null;
  private time = 0;
  private seconds = 0;
  private lightning = false;

  constructor(strands: number, segments: number, arcs: number) {
    this.object.name = "FlourishGather";
    this.ribbons = new Ribbon({
      segments, strands: strandSeeds(0x9a7e, Math.max(1, strands)), halo: 3.2, minPixels: 1.6, order: 14, step: 0.01,
      uniforms: {
        uHand: { value: new THREE.Vector3() }, uTime: { value: 0 }, uPeriod: { value: GATHER.period }, uEnvelope: { value: 0 },
        uRadius: { value: GATHER.radius }, uRun: { value: GATHER.run }, uTurns: { value: GATHER.turns }, uWidth: { value: GATHER.width }, uSeed: { value: 0 },
        uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() },
      },
      curve: CURVE, shade: SHADE,
    });
    this.object.add(this.ribbons.object);
    this.arcs = arcs > 0 ? new Ribbon({
      segments: 12, strands: strandSeeds(0x3a1c, arcs), halo: 4, minPixels: 1.2, order: 15, step: 0.02,
      uniforms: {
        uHand: { value: new THREE.Vector3() }, uTime: { value: 0 }, uEnvelope: { value: 0 }, uReach: { value: GATHER.arcReach }, uRate: { value: GATHER.arcRate }, uSeed: { value: 0 },
        uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
      },
      curve: ARC_CURVE, shade: ARC_SHADE,
    }) : null;
    if (this.arcs) this.object.add(this.arcs.object);
    this.object.visible = false;
  }

  get active(): number { return this.id ? 1 : 0; }

  /**
   * Ribbons begin to spiral in to the hand `sample` gives, for `seconds`, in `look`'s colours; with little arcs round
   * the hand if `lightning` (a Kwind-09 cast). A new gather replaces the one before.
   */
  begin(id: string, sample: HandSampler, seconds: number, look: FlourishLook, lightning: boolean, seed: number): void {
    this.id = id; this.sample = sample; this.time = 0; this.seconds = Math.max(0.2, seconds); this.lightning = lightning && !!this.arcs;
    const u = this.ribbons.uniforms;
    u.uPeriod.value = gatherPeriod(this.seconds); u.uSeed.value = (seed % 997) / 997;
    (u.uCore.value as THREE.Color).setHex(look.core); (u.uEdge.value as THREE.Color).setHex(look.edge); (u.uDeep.value as THREE.Color).setHex(look.deep);
    if (this.arcs) {
      const a = this.arcs.uniforms;
      a.uSeed.value = (seed % 991) / 991;
      (a.uCore.value as THREE.Color).setHex(look.core); (a.uEdge.value as THREE.Color).setHex(look.edge);
    }
    this.place(0);
  }

  /** The spell has left the hand (or the cast was cut short): the ribbons go out now. */
  end(id?: string): void { if (id === undefined || id === this.id) this.stop(); }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): void {
    if (!this.id) return;
    this.time += Math.max(0, seconds);
    if (this.time >= this.seconds) { this.stop(); return; }
    this.place(gatherEnvelope(this.time, this.seconds));
    this.ribbons.fit(camera, height);
    this.arcs?.fit(camera, height);
  }

  setGain(gain: number): void { this.ribbons.setGain(gain); this.arcs?.setGain(gain); }

  clear(): void { this.stop(); }

  dispose(): void {
    this.stop();
    this.object.removeFromParent();
    this.ribbons.dispose(); this.arcs?.dispose();
  }

  private place(envelope: number): void {
    const at = this.sample ? this.safely(this.sample) : null;
    if (!at) { this.object.visible = false; return; }
    const u = this.ribbons.uniforms;
    (u.uHand.value as THREE.Vector3).copy(at); u.uTime.value = this.time; u.uEnvelope.value = envelope;
    if (this.arcs) {
      const a = this.arcs.uniforms;
      (a.uHand.value as THREE.Vector3).copy(at); a.uTime.value = this.time; a.uEnvelope.value = this.lightning ? envelope : 0;
      this.arcs.object.visible = this.lightning;
    }
    this.object.visible = envelope > 0.001;
  }

  private safely(sample: HandSampler): THREE.Vector3 | null {
    try {
      const at = sample(this.hand);
      return at && Number.isFinite(at.x + at.y + at.z) ? at : null;
    } catch { return null; }
  }

  private stop(): void {
    this.id = null; this.sample = null; this.time = 0;
    this.ribbons.uniforms.uEnvelope.value = 0;
    if (this.arcs) this.arcs.uniforms.uEnvelope.value = 0;
    this.object.visible = false;
  }
}
