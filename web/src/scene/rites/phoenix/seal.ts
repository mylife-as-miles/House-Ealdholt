// Adapted from SamuraiThirdPersonTemplateThreeJS and LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The seal of fire the phoenix comes out of: one quad hanging in the air over the Queen, leaning toward the player,
 * drawn by its shader alone.
 *
 * Two pens leave its lowest point (where the thread from the Queen's hand meets it) and run round to meet at the
 * top: the rims and their ticks first, the sun's rays standing off them and a band of script after, and the heart
 * (a pool of light inside a ring of flame tongues) last. It flares white, a shock runs out across its plane, and
 * its heart is a molten opening while the bird comes through; then its rays draw in and it cools away, red to
 * dark, from gold.
 *
 * Its written lines are embers under the fire's light, drawn premultiplied: against a bright sky they darken it,
 * and they write depth, so a bright arena's grade does not take the seal for sky.
 *
 * From the reference's SummonSeal (Samurai): a circle that is written, not faded in, with nothing drawn ahead of
 * its pen, and bands that turn against each other. From its Fire Portal (Ext): the stroke just behind the pen is
 * hotter than the settled line. Ours: two pens from one point instead of one round the whole; no polygons or stars
 * inside it (the sigils are abstract: script from the kit's RUNE_RING, rays, and tongues of flame); and it burns
 * by temperature, so writing, flaring and cooling are one colour rule.
 */
import * as THREE from "three";
import { RUNE_RING } from "../../vfx/mystic/beam";
import type { PhoenixSeal } from "./phoenixFlight";
import type { PhoenixMoment } from "./phoenixPlan";
import { FIRE, FIRE_NOISE } from "./fire";

/** The quad reaches this many seal radii out, so the rays and the shock have room. */
const REACH = 3.2;

const VERTEX = /* glsl */ `
uniform vec3 uCentre, uAcross, uDown;
uniform float uRadius;
varying vec2 vPlace;
void main() {
  // vPlace is in seal radii: x across the seal, y toward its lowest point, where the pens start
  vPlace = position.xy * ${REACH.toFixed(1)};
  vec3 at = uCentre + (uAcross * position.x + uDown * position.y) * uRadius * ${REACH.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const fragment = (depth: boolean) => /* glsl */ `
${depth ? "#define DEPTH" : ""}
${FIRE_NOISE}
float hash(vec2 p) { return fHash(p); }
${RUNE_RING}
${FIRE}
uniform float uTime, uPen, uSeal, uHeat, uFlare, uSinceFlare, uFade, uOpening, uGain, uSeed, uBrief, uMatter;
varying vec2 vPlace;
float line(float x, float at, float width) { return smoothstep(width, 0.0, abs(x - at)); }
vec2 turned(vec2 p, float angle) { float c = cos(angle), s = sin(angle); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
void main() {
  vec2 p = vPlace;
  float r = length(p);
  if (r > ${REACH.toFixed(2)}) discard;
  float a = atan(p.x, p.y);
  // 0 where the pens start, 1 where they meet at the top
  float away = abs(a) / 3.14159265;
  float pen = uPen * 1.3;
  float brief = step(0.5, uBrief);
  float rimInk = max(brief, 1.0 - smoothstep(pen - 0.025, pen + 0.004, away));
  float midInk = max(brief, 1.0 - smoothstep(pen - 0.32, pen - 0.29, away));
  float heartInk = max(brief, smoothstep(0.62, 0.92, uPen));
  // the nib, white-hot, and the stroke just behind it hotter than the settled line
  float writing = (1.0 - brief) * step(0.001, uPen) * (1.0 - smoothstep(0.7, 0.8, uPen));
  float fromNib = (away - min(pen, 1.0)) / 0.02, offRim = (r - 1.0) / 0.08;
  float nib = writing * exp(-fromNib * fromNib) * exp(-offRim * offRim);
  float fresh = writing * exp(-max(pen - away, 0.0) / 0.12) * step(away, pen);

  // the rim: a heavy ring and a fine one inside it, with ticks between, every fourth one longer
  float rim = line(r, 1.0, 0.035) + 0.8 * line(r, 0.93, 0.012);
  float cell = (a / 6.2831853 + 0.5) * 48.0, major = step(mod(floor(cell), 4.0), 0.5);
  float tick = (1.0 - smoothstep(0.04, 0.07, abs(fract(cell) - 0.5))) * step(mix(0.945, 0.9, major), r) * step(r, 0.99);
  // the sun's rays standing off it, long and short by turns, turning slowly; they lengthen in the flare and draw in as it cools
  float beat = (a / 6.2831853 + 0.5) * 24.0 + uTime * 0.25;
  float reach = (mod(floor(beat), 2.0) < 0.5 ? 0.36 : 0.19) * (0.25 + 0.75 * uFade) * (1.0 + 0.8 * uFlare);
  float along = (r - 1.06) / reach;
  float rays = step(0.0, along) * step(along, 1.0) * smoothstep(0.0, 0.06, (1.0 - along) * 0.36 - abs(fract(beat) - 0.5));
  // a ray burns hot where it leaves the rim and cooler toward its point, like a flame
  float rayCool = clamp(along, 0.0, 1.0);
  // a band of script turning against the rays
  float script = runeRing(turned(p, -uTime * 0.3) / 0.88 * 0.5 + 0.5, 3.0 + uSeed) * step(r, 0.9);
  // the heart: a ring of flame tongues curling outward, turning the other way, round a small hot disc
  float curl = a + r * 2.4 + uTime * 0.7;
  float tcell = fract(curl / 6.2831853 * 11.0) - 0.5;
  float s = clamp((r - 0.1) / 0.32, 0.0, 1.0);
  float width = 0.34 * (1.0 - s) * smoothstep(0.0, 0.18, s);
  float tongue = (1.0 - smoothstep(width * 0.55, width, abs(tcell))) * step(0.1, r) * step(r, 0.42);
  float heart = line(r, 0.075, 0.03) + exp(-r * r * 90.0) * 0.7;

  float flicker = 0.86 + 0.14 * fNoise(vec2(uTime * 4.0, a * 8.0 + uSeed));
  float ink = (rim + 0.7 * tick) * rimInk + 0.75 * script * midInk + (0.5 * tongue + 0.6 * heart) * heartInk;
  // what of it is written in the sky, solid: its lines and its rays, as embers
  float solid = clamp((ink + 0.7 * rays * rimInk) * uSeal * 1.4, 0.0, 1.0) * (1.0 - smoothstep(${(REACH - 0.6).toFixed(2)}, ${REACH.toFixed(2)}, r));
#ifdef DEPTH
  // the written lines write depth, so a bright arena's grade does not take them for sky
  if (solid < 0.6) discard;
  gl_FragColor = vec4(0.0);
#else
  vec3 light = fire(uHeat * flicker + 0.2 * fresh) * ink * uSeal;
  light += fire((uHeat * flicker + 0.2 * fresh) * (1.0 - 0.45 * rayCool)) * rays * (1.0 - 0.5 * rayCool) * 0.8 * rimInk * uSeal;
  light += fire(1.12) * nib * 1.6;
  // light pooled inside: warming as it is written, blazing in the flare, and molten where the bird comes through
  float pool = exp(-r * r * 6.0) * (0.05 * uSeal + 0.12 * uFlare + 0.3 * uOpening * (0.75 + 0.25 * fNoise(p * 4.0 + uTime * 3.0)));
  light += fire(0.62 + 0.18 * uFlare + 0.2 * uOpening) * pool;
  // the flare's shock, out across the seal's own plane
  if (uSinceFlare >= 0.0 && uBrief < 0.5) {
    float front = 1.0 + 1.3 * (1.0 - exp(-uSinceFlare / 0.18));
    light += fire(0.8) * line(r, front, 0.06 + 0.15 * uSinceFlare) * exp(-uSinceFlare / 0.12) * 0.8;
  }
  light *= 1.0 - smoothstep(${(REACH - 0.6).toFixed(2)}, ${REACH.toFixed(2)}, r);
  float cover = uMatter * mix(0.45, 0.88, uDay) * solid;
  if (cover < 0.003 && max(max(light.r, light.g), light.b) < 0.002) discard;
  // premultiplied: its lines are embers that darken a bright sky under the fire's light
  gl_FragColor = vec4(light * uGain, cover);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class PhoenixSealMark {
  readonly object: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly material: THREE.ShaderMaterial;
  private readonly depth: THREE.ShaderMaterial;

  constructor(seal: PhoenixSeal, shared: Record<string, THREE.IUniform>, seed: number, brief: boolean) {
    this.uniforms = {
      ...shared,
      uCentre: { value: new THREE.Vector3(seal.centre.x, seal.centre.y, seal.centre.z) }, uAcross: { value: new THREE.Vector3(seal.across.x, seal.across.y, seal.across.z) },
      uDown: { value: new THREE.Vector3(seal.down.x, seal.down.y, seal.down.z) }, uRadius: { value: seal.radius }, uSeed: { value: (seed % 211) * 0.37 }, uBrief: { value: brief ? 1 : 0 },
      uPen: { value: 0 }, uSeal: { value: 0 }, uHeat: { value: 0 }, uFlare: { value: 0 }, uSinceFlare: { value: -1 }, uFade: { value: 1 }, uOpening: { value: 0 }, uMatter: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: fragment(false), transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.depth = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: fragment(true), transparent: true, depthWrite: true, colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false; this.object.renderOrder = 9; this.object.visible = false;
    // the depth of its written lines, first
    const under = new THREE.Mesh(this.geometry, this.depth);
    under.frustumCulled = false; under.renderOrder = 8.5;
    this.object.add(under);
  }

  set(moment: PhoenixMoment): void {
    const u = this.uniforms;
    u.uPen.value = moment.pen; u.uSeal.value = moment.seal; u.uHeat.value = moment.sealHeat; u.uFlare.value = moment.flare;
    u.uSinceFlare.value = moment.sinceFlare; u.uFade.value = moment.sealFade; u.uOpening.value = moment.opening;
    this.object.visible = moment.seal > 0.002 || moment.flare > 0.002 || moment.opening > 0.002;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose(); this.depth.dispose();
  }
}
