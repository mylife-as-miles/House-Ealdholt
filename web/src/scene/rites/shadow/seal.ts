// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Korvenia's seal: a ring of brass written on the stone, with clockwork turning inside it. Something vast comes up
 * through it (shadow/shadowRite.ts), so it is drawn as an opening: the stone inside it goes dark first, and the
 * metal lies over that dark.
 *
 * From the reference's SummonSeal: one quad and no texture, everything arithmetic on the fragment's polar place;
 * bands turning at their own rates against each other, which is what makes it read as machinery rather than a
 * spinning decal; written round by a pen with a bright head, so nothing of it arrives switched on. Ours is
 * clockwork, not a magic circle: the outer band is our mystic kit's abstract script (RUNE_RING) on a ring that
 * ticks round like an escapement, inside it a ring gear with its teeth inward, four planet wheels meshing with it
 * and with a sun wheel, and over the sun an armillary of three turning hoops, the device on the Queen's wand.
 * Every mark is abstract: wheels, hoops, ticks and strokes.
 */
import * as THREE from "three";
import { RUNE_RING } from "../../vfx/mystic/beam";

export interface SealLook { brass: number; gold: number; hot: number; violet: number }

/** The quad reaches this far past the seal's rim, for the haze and the pulse. */
const REACH = 1.2;

const VERTEX = (lift: number) => /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius, uOpen;
varying vec2 vP;
void main() {
  vP = position.xy * ${REACH.toFixed(2)};
  vec3 at = uCentre + vec3(position.x, 0.0, -position.y) * uRadius * ${REACH.toFixed(2)} + vec3(0.0, ${lift.toFixed(4)}, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const COMMON = /* glsl */ `
#define TAU 6.2831853
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
uniform float uTime, uDrawn, uGlow, uOpen, uSeed, uGain, uPulse, uTick;
uniform vec3 uBrass, uGold, uHot, uViolet;
varying vec2 vP;
`;

const DARK_FRAGMENT = /* glsl */ `
${COMMON}
void main() {
  // the stone inside the seal gives way to a dark that is not quite black, uneven, deepest at the middle
  float open = max(uOpen, 1e-3), r = length(vP) / open;
  float swirl = vnoise(vec2(atan(vP.y, vP.x) * 2.0 + uTime * 0.6, r * 3.0 - uTime * 0.9)) * 0.25;
  float alpha = (1.0 - smoothstep(0.78 + swirl * 0.3, 1.0, r)) * (0.5 + 0.35 * (1.0 - r)) * smoothstep(0.0, 0.3, uOpen) * uGlow / max(uGlow, 0.35);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(vec3(0.010, 0.006, 0.020), uViolet * 0.05, 1.0 - r), min(alpha, 0.9));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LIGHT_FRAGMENT = /* glsl */ `
${COMMON}
${RUNE_RING}
float band(float x, float c, float w) { return 1.0 - smoothstep(w, w * 1.8 + 0.0025, abs(x - c)); }
vec2 turned(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
// a wheel: an outline whose radius steps out at every tooth (inward teeth when 'inner'), spokes and a hub
float wheel(vec2 p, float radius, float teeth, float turn, float w, bool inner) {
  float r = length(p), a = atan(p.y, p.x) - turn;
  float f = fract(a / TAU * teeth);
  float tooth = smoothstep(0.18, 0.3, f) - smoothstep(0.68, 0.8, f);
  float edge = radius * (inner ? 1.0 - 0.1 * tooth : 1.0 + 0.13 * tooth);
  float ink = band(r, edge, w) + band(r, radius * (inner ? 1.14 : 0.8), w * 0.8);
  if (!inner) {
    float spokes = band(fract(a / TAU * 5.0 + 0.5), 0.5, w / max(r, 0.01) / TAU * 5.0) * step(radius * 0.22, r) * step(r, radius * 0.8);
    ink += spokes + band(r, radius * 0.2, w);
  }
  return clamp(ink, 0.0, 1.0);
}
// an armillary hoop: a circle seen at a slant, turning
float hoop(vec2 p, float radius, float slant, float spin, float w) {
  vec2 q = turned(p, spin);
  q.y /= max(abs(slant), 0.06);
  float d = (length(q) - radius) * mix(abs(slant), 1.0, 0.5);
  return band(d, 0.0, w);
}
void main() {
  float open = max(uOpen, 1e-3);
  vec2 p = vP / open;
  float r = length(p);
  float angle = atan(p.y, p.x) / TAU + 0.5;
  // written round from one point by a pen: what the pen has passed is inked, its tip burns
  float inked = uDrawn >= 1.0 ? 1.0 : 1.0 - smoothstep(uDrawn - 0.015, uDrawn + 0.004, angle);
  float fromPen = (angle - uDrawn) / 0.012;
  float pen = uDrawn < 1.0 && uDrawn > 0.0 ? exp(-fromPen * fromPen) * step(0.55, r) * step(r, 1.0) : 0.0;
  // the clockwork inside comes once the ring is closing round
  float inner = smoothstep(0.55, 1.0, uDrawn);
  float w = 0.006;
  // the outer ring of script ticks round like an escapement
  float script = runeRing(turned(p / 1.025, uTick * TAU / 60.0) * 0.5 + 0.5, uSeed) * step(0.56, r);
  // the ring gear, teeth inward, turning the other way
  float ringTurn = -uTick * TAU / 96.0;
  float ringGear = wheel(p, 0.47, 42.0, ringTurn, w, true) * step(r, 0.56);
  // four planets meshing between it and the sun: they ride round slowly and spin against the sun
  float planets = 0.0;
  float carrier = uTime * 0.12, sunTurn = uTime * 0.55;
  for (int k = 0; k < 4; k += 1) {
    float a = carrier + float(k) * TAU / 4.0;
    vec2 c = vec2(cos(a), sin(a)) * 0.29;
    planets = max(planets, wheel(p - c, 0.115, 11.0, -sunTurn * 1.5 + a, w, false));
  }
  float sun = wheel(p, 0.155, 15.0, sunTurn, w, false);
  // the armillary over the sun: three hoops at their own slants
  float armillary = 0.0;
  for (int k = 0; k < 3; k += 1) armillary = max(armillary, hoop(p, 0.2, cos(uTime * (0.7 + 0.25 * float(k)) + float(k) * 2.1), uTime * 0.2 + float(k) * 1.05, w * 0.9));
  float metal = (script * inked + (ringGear + max(planets, sun)) * inner) * step(r, 1.0);
  float lit = armillary * smoothstep(0.85, 1.0, uDrawn);
  // a haze of violet light under the metal, gathered at the rim and the middle
  float offRim = (r - 0.92) / 0.08;
  float haze = (exp(-r * r * 3.0) * 0.22 + exp(-offRim * offRim) * 0.18) * smoothstep(0.0, 0.4, uDrawn);
  float flicker = 0.85 + 0.15 * vnoise(vec2(uTime * 3.1, angle * 30.0));
  // the pulse when the blow lands runs out from the middle
  float fromPulse = (r - (1.0 - uPulse) * 1.15) / 0.07;
  float pulse = uPulse > 0.0 ? exp(-fromPulse * fromPulse) * uPulse : 0.0;
  vec3 colour = mix(uBrass, uGold, 0.45 + 0.35 * flicker) * metal * (0.45 + 0.75 * uGlow) * 1.25
    + mix(uGold, uHot, 0.5) * lit * (0.6 + 0.6 * uGlow) * 1.3
    + uHot * pen * 2.2
    + uViolet * haze * (0.4 + uGlow)
    + (uViolet * 1.3 + uHot * 0.6) * pulse;
  colour *= 1.0 - smoothstep(${(REACH - 0.08).toFixed(2)}, ${REACH.toFixed(2)}, length(vP));
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ClockworkSeal {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(centre: { x: number; y: number; z: number }, radius: number, look: SealLook, seed: number) {
    this.uniforms = {
      uCentre: { value: new THREE.Vector3(centre.x, centre.y, centre.z) }, uRadius: { value: radius },
      uTime: { value: 0 }, uDrawn: { value: 0 }, uGlow: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: (seed % 89) + 3 }, uGain: { value: 1 }, uPulse: { value: 0 }, uTick: { value: 0 },
      uBrass: { value: new THREE.Color(look.brass) }, uGold: { value: new THREE.Color(look.gold) }, uHot: { value: new THREE.Color(look.hot) }, uViolet: { value: new THREE.Color(look.violet) },
    };
    const pass = (lift: number, fragment: string, additive: boolean, order: number) => {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERTEX(lift), fragmentShader: fragment, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = order;
      this.object.add(mesh);
    };
    pass(0.005, DARK_FRAGMENT, false, 6);
    pass(0.008, LIGHT_FRAGMENT, true, 8);
  }

  /**
   * How much the pen has written (0..1), how brightly it burns, how far it has opened (radius, 0..1), the pulse of
   * the blow (1 at the blow, falling to 0), and the escapement's count of ticks.
   */
  set(time: number, state: { drawn: number; glow: number; open: number; pulse: number; tick: number }): void {
    const u = this.uniforms;
    u.uTime.value = time; u.uDrawn.value = state.drawn; u.uGlow.value = state.glow; u.uOpen.value = state.open; u.uPulse.value = state.pulse; u.uTick.value = state.tick;
    this.object.visible = state.glow > 0.003 && state.open > 0.003;
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
