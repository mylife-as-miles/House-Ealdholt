// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * A ribbon in parameter space, drawn: the thread of light of mystic/beam.ts with its curve taken out and handed to
 * the caller, and its strands made instances. shared/ribbonPlan.ts holds the layout and its tests.
 *
 * The caller writes two pieces of GLSL. `curve` goes in the vertex shader and says where a strand is at `t` and how
 * wide; `shade` goes in the fragment shader and says how bright it is there. This file does what is the same for
 * every ribbon: it cuts the strip once, turns it to face the eye (or lays it flat, for light washed over the
 * stone), keeps it from thinning below a pixel, draws it twice (a wide soft halo under a hot core, because the
 * lowest tier has no bloom), applies the gain, and ends the fragment shader with three's tone-mapping and
 * colour-space chunks, because that tier draws straight to the canvas. Nothing is rebuilt per frame.
 *
 * What the curve must define:
 *
 *   vec3 ribbonPoint(float t, vec4 strand)   where the strand is at t, in the ribbon's own space
 *   float ribbonWidth(float t, vec4 strand)  half its width there, in scene units; 0 hides it
 *
 * and it may write `ribbonCarry` (a vec4) for the fragment shader to read as `vCarry`. What the shade must define:
 *
 *   vec3 ribbonShade(float t, float side, vec4 strand)   the light it adds; `side` is -1..1 across it
 *
 * `RIBBON_HALO` is defined in the halo pass, in both shaders. A ribbon of matter (smoke, dust) is drawn once with
 * normal blending, and its shade defines `vec4 ribbonMatter(float t, float side, vec4 strand)` instead: a colour
 * and how much of what is behind it it hides.
 *
 * A strand of one segment whose curve runs up the camera's up vector is a square that faces the eye, with `side`
 * and `t` as its two axes: that is how the stars, knots and puffs of the spells are drawn, many to a draw.
 */
import * as THREE from "three";
import { ribbonIndex, ribbonVertices } from "./ribbonPlan";

/** Hashes and two noises for a curve or a shade: `vnoise` is joined by straight lines (corners), `noise` is smooth. */
export const RIBBON_NOISE = /* glsl */ `
#define PI 3.14159265
#define TAU 6.2831853
float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(float x, float seed) { float i = floor(x); return mix(hash1(i + seed), hash1(i + 1.0 + seed), x - i) * 2.0 - 1.0; }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export interface RibbonOptions {
  /** Cuts along each strand. */
  segments: number;
  /** Four numbers per strand (ribbonPlan.strandSeeds, or the caller's own); its length sets how many strands. */
  strands: Float32Array;
  /** Anything else a strand owns, by attribute name, declared by the curve. */
  attributes?: Readonly<Record<string, { array: Float32Array; size: number }>>;
  /** The uniforms the curve and the shade read. `uPixel`, `uMinPixels` and `uGain` are added to them. */
  uniforms: Record<string, THREE.IUniform>;
  curve: string;
  shade: string;
  /** How many times wider the halo pass is than the core; 0 for no halo pass. */
  halo?: number;
  /**
   * `eye` turns the strip to face the camera; `up` lays it flat on the board; `own` widens it the way the curve
   * says, by `vec3 ribbonAcross(float t, vec4 strand)` (a ring standing square to a lance, say).
   */
  facing?: "eye" | "up" | "own";
  /** How far either side of a cut the curve is asked, to find which way the strand runs there. */
  step?: number;
  /** The least width in pixels a strand with any width is drawn at. */
  minPixels?: number;
  /** Matter, not light: drawn once with normal blending, shaded by `ribbonMatter`, and not scaled by the gain. */
  matter?: boolean;
  /** The core's render order; the halo is drawn one before it. */
  order?: number;
}

const vertex = (options: RibbonOptions, halo: boolean) => /* glsl */ `
${halo ? "#define RIBBON_HALO" : ""}
attribute vec4 aStrand;
uniform float uPixel, uMinPixels;
varying float vT, vSide;
varying vec4 vStrand, vCarry;
vec4 ribbonCarry = vec4(0.0);
${options.curve}
void main() {
  float t = position.x, side = position.y;
  vec3 before = ribbonPoint(max(t - ${(options.step ?? 0.012).toFixed(4)}, 0.0), aStrand), after = ribbonPoint(min(t + ${(options.step ?? 0.012).toFixed(4)}, 1.0), aStrand);
  vec3 at = ribbonPoint(t, aStrand);
  vT = t; vSide = side; vStrand = aStrand; vCarry = ribbonCarry;
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  float width = ribbonWidth(t, aStrand);
${options.facing === "own" ? /* glsl */ `
  vec3 across = normalize(mat3(modelViewMatrix) * ribbonAcross(t, aStrand));
` : options.facing === "up" ? /* glsl */ `
  // laid flat: widened square to the strand and to the board's up
  vec3 flatways = cross(normalize(mat3(modelMatrix) * (after - before)), vec3(0.0, 1.0, 0.0));
  vec3 across = dot(flatways, flatways) > 1e-8 ? normalize(mat3(viewMatrix) * flatways) : vec3(1.0, 0.0, 0.0);
` : /* glsl */ `
  // widened square to both the strand and the line of sight, so it always faces the eye
  vec3 run = (modelViewMatrix * vec4(after, 1.0)).xyz - (modelViewMatrix * vec4(before, 1.0)).xyz;
  vec3 square = dot(run, run) > 1e-12 ? cross(normalize(run), normalize(here.xyz)) : vec3(0.0);
  vec3 across = dot(square, square) > 1e-8 ? normalize(square) : vec3(1.0, 0.0, 0.0);
  // never thinner than a pixel or so, or it is lost from the player's high camera
  if (width > 0.0) width = max(width, uPixel * uMinPixels * 0.5 * -here.z);
`}
${halo ? `  width *= ${(options.halo ?? 0).toFixed(3)};` : ""}
  here.xyz += across * side * width;
  gl_Position = projectionMatrix * here;
}
`;

const fragment = (options: RibbonOptions, halo: boolean) => /* glsl */ `
${halo ? "#define RIBBON_HALO" : ""}
uniform float uGain;
varying float vT, vSide;
varying vec4 vStrand, vCarry;
${options.shade}
void main() {
${options.matter ? /* glsl */ `
  gl_FragColor = ribbonMatter(vT, vSide, vStrand);
  if (gl_FragColor.a < 0.004) discard;
` : /* glsl */ `
  vec3 colour = ribbonShade(vT, vSide, vStrand);
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
`}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Ribbon {
  readonly object = new THREE.Group();
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(options: RibbonOptions) {
    this.uniforms = options.uniforms;
    this.uniforms.uPixel ??= { value: 0.001 };
    this.uniforms.uMinPixels ??= { value: options.minPixels ?? 1.4 };
    this.uniforms.uGain ??= { value: 1 };
    // three.js counts vertices by `position`; here it carries (t, side) and the shader places them
    this.geometry.setAttribute("position", new THREE.BufferAttribute(ribbonVertices(options.segments), 3));
    this.geometry.setIndex(ribbonIndex(options.segments));
    this.geometry.setAttribute("aStrand", new THREE.InstancedBufferAttribute(options.strands, 4));
    for (const [name, attribute] of Object.entries(options.attributes ?? {})) this.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(attribute.array, attribute.size));
    this.geometry.instanceCount = options.strands.length / 4;
    const order = options.order ?? 12;
    const passes = (options.halo ?? 0) > 0 && !options.matter ? [true, false] : [false];
    for (const halo of passes) {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: vertex(options, halo), fragmentShader: fragment(options, halo),
        transparent: true, depthWrite: false, blending: options.matter ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = halo ? order - 1 : order;
      this.object.add(mesh);
    }
  }

  /** Fits it to the camera drawing it: `height` is the drawing buffer's height in pixels. */
  fit(camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
  }
  /** `gain` keeps its colour from clipping to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
