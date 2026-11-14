// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Every flame of the phoenix in one draw: the feathers of both wings, the streamers of its tail, the crown, the
 * beak, the neck, the hot leading edges, and the thread of fire from the Queen's hand. phoenixForm.ts lays each
 * out as a ribbon (a centreline, a width and a temperature at each cut) every frame; this uploads that and burns
 * it.
 *
 * As the kit's ribbon (vfx/spells/shared/ribbon.ts) does, a cut is two vertices on the same centreline, turned to
 * face the eye in the vertex shader and never thinner than a pixel or so; and it is drawn twice, a wide soft halo
 * under the hot core, because the lowest tier has no bloom. Ours: the centreline comes from the CPU, not from a
 * curve in the shader, because a feather hangs from a posed skeleton; and each ribbon burns as a tongue of flame,
 * torn ragged toward its tip by noise that runs out along it, at the temperature the form gives it.
 *
 * The flame is not only light. Under it is a body of embers and soot, drawn premultiplied, which covers part of
 * what is behind it: against a bright sky (the 360 arenas) the bird is a dark-cored blaze, not a pale wash added to
 * the sky, and against a dark hall the cover is lost in the dark. Its solid part also writes depth, so the arena's
 * grade, which treats every pixel without depth as sky (darkened, hazed, and matted black over the eclipse), treats
 * the bird as what it is.
 */
import * as THREE from "three";
import { FIRE, FIRE_NOISE, SEAL_CUT } from "./fire";
import type { PlumeBuffers, PlumeLayout } from "./phoenixForm";

const vertex = (halo: boolean) => /* glsl */ `
${halo ? "#define HALO" : ""}
attribute vec3 aTangent;
attribute vec4 aRibbon;
attribute vec2 aSeed;
uniform float uPixel, uMinPixels, uHaloWidth;
varying vec2 vRib;
varying float vHeat, vSeed, vKind;
varying vec3 vWorld;
void main() {
  vec4 here = modelViewMatrix * vec4(position, 1.0);
  // widened square to the ribbon and to the line of sight, so it always faces the eye
  vec3 run = mat3(modelViewMatrix) * aTangent;
  vec3 square = cross(run, normalize(here.xyz));
  vec3 across = dot(square, square) > 1e-10 ? normalize(square) : vec3(1.0, 0.0, 0.0);
  float width = aRibbon.z;
  // never thinner than a pixel or so, or a feather seen from the player's high seat is lost
  if (width > 0.0) width = max(width, uPixel * uMinPixels * 0.5 * -here.z);
#ifdef HALO
  width *= uHaloWidth;
#endif
  here.xyz += across * aRibbon.y * width;
  gl_Position = projectionMatrix * here;
  vRib = aRibbon.xy; vHeat = aRibbon.w; vSeed = aSeed.x; vKind = aSeed.y;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
}
`;

/** `pass`: the soft halo (added), the flame itself (its glow over a dark ember body), or the depth of its solid part. */
const fragment = (pass: "halo" | "core" | "depth") => /* glsl */ `
#define ${pass.toUpperCase()}
${FIRE_NOISE}
${FIRE}
${SEAL_CUT}
uniform float uTime, uGain, uHalo, uMatter;
varying vec2 vRib;
varying float vHeat, vSeed, vKind;
varying vec3 vWorld;
void main() {
  float molten = sealCut(vWorld);
  float t = vRib.x, side = vRib.y, across = abs(side);
  // the beak (4), the legs and toes (9, 10) and the eyes (12) are hard and bright, not torn; kind 8 is the soft
  // band of the wing's own surface
  bool beak = (vKind > 3.5 && vKind < 4.5) || (vKind > 8.5 && vKind < 10.5) || vKind > 11.5, vane = vKind > 7.5 && vKind < 8.5;
  float n1 = fNoise(vec2(t * 5.0 - uTime * 3.4 + vSeed * 17.0, side * 1.1 + vSeed * 7.0));
  float n2 = fNoise(vec2(t * 13.0 - uTime * 6.0 + vSeed * 5.0, side * 2.3 - vSeed * 3.0));
  float n = n1 * 0.65 + n2 * 0.35;
#ifdef HALO
  // the air the flame lights: no edge anywhere
  float glow = pow(1.0 - across, 2.2) * (1.0 - 0.6 * t);
  // in a bright arena a wide added glow only washes the sky out: the body carries it there
  vec3 colour = fire(vHeat * 0.8 + molten * 0.3) * glow * 0.15 * uHalo * (1.0 - 0.6 * uDay);
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
#else
  // a tongue of flame: full across most of its width so neighbours merge into one sheet, with a hotter spine,
  // torn ragged toward its tip by noise running out along it
  float full = 1.0 - smoothstep(0.45, 1.0, across), spine = pow(1.0 - across, 2.0);
  float sheet = beak ? pow(1.0 - across, 0.8) : vane ? pow(1.0 - across, 1.6) * 0.55 : 0.55 * full + 0.45 * spine;
  float tear = beak || vane ? 1.0 : smoothstep(0.0, 0.28, (1.0 - t) * 1.3 + (n - 0.5) * 0.85 - across * 0.4);
  // what of it is solid: a body of embers and soot the fire burns on, darker than any bright sky behind it
  float solid = clamp(sheet * tear * (vane ? 1.0 : 1.35), 0.0, 1.0);
  // against a bright sky the light gathers toward the spine and the flanks are dark embers: a burning feather, not a pale one
  float body = beak || vane ? sheet : mix(sheet, 0.3 * full + 0.7 * pow(spine, 1.3), 0.6 * uDay);
#ifdef DEPTH
  // only its solid part writes depth: the arena's grade then treats it as a thing in front of the sky, not as sky
  if (solid < 0.7 || vKind > 6.5 && vKind < 8.5) discard;
  gl_FragColor = vec4(0.0);
#else
  float heat = vHeat * (0.66 + 0.34 * spine) * (beak ? 1.0 : 0.84 + 0.32 * n) + molten * 0.45;
  vec3 colour = fire(heat) * body * tear * 0.72;
  // in a dark hall it covers a little (the dark behind it is dark anyway); against a bright sky it is nearly solid
  float cover = uMatter * mix(0.5, 1.0, uDay) * solid * (vane ? 0.5 : 1.0);
  if (cover < 0.003 && max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  // premultiplied: the dark body covers what is behind it, and the fire's light is added over it
  gl_FragColor = vec4(colour * uGain, cover);
#endif
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface PhoenixPlumesOptions {
  /** Strength of the soft halo pass (PHOENIX_BUDGET.halo), and how many times wider than the core it is. */
  halo: number;
  /** A share of how much of what is behind its solid part the bird's dark body covers (the arena's brightness, `uDay`, sets the rest). */
  matter?: number;
  haloWidth?: number;
  /** The least width in pixels a flame is drawn at. */
  minPixels?: number;
}

export class PhoenixPlumes {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly dynamic: THREE.BufferAttribute[];
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(layout: PlumeLayout, buffers: PlumeBuffers, shared: Record<string, THREE.IUniform>, options: PhoenixPlumesOptions) {
    const position = new THREE.BufferAttribute(buffers.position, 3).setUsage(THREE.DynamicDrawUsage);
    const tangent = new THREE.BufferAttribute(buffers.tangent, 3).setUsage(THREE.DynamicDrawUsage);
    const ribbon = new THREE.BufferAttribute(buffers.ribbon, 4).setUsage(THREE.DynamicDrawUsage);
    this.dynamic = [position, tangent, ribbon];
    // what each vertex keeps: its ribbon's dice and its kind
    const seeds = new Float32Array(layout.vertices * 2);
    layout.specs.forEach((spec, index) => {
      for (let v = 0; v < (spec.segments + 1) * 2; v += 1) { seeds[(layout.first[index] + v) * 2] = spec.seed; seeds[(layout.first[index] + v) * 2 + 1] = spec.kind; }
    });
    this.geometry.setAttribute("position", position);
    this.geometry.setAttribute("aTangent", tangent);
    this.geometry.setAttribute("aRibbon", ribbon);
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(layout.index, 1));
    this.uniforms = { ...shared, uPixel: { value: 0.001 }, uMinPixels: { value: options.minPixels ?? 1.3 }, uHalo: { value: options.halo }, uHaloWidth: { value: options.haloWidth ?? 2.8 }, uMatter: { value: options.matter ?? 1 } };
    // The depth of its solid part first (after everything opaque, so nothing behind it is lost), then the halo,
    // then the flame over its dark body. The depth is pushed a hair back, so the flame drawn at the same depth
    // passes.
    const passes: { pass: "halo" | "core" | "depth"; order: number }[] = [{ pass: "depth", order: 10 }, { pass: "halo", order: 11 }, { pass: "core", order: 12 }];
    for (const { pass, order } of passes) {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: vertex(pass === "halo"), fragmentShader: fragment(pass),
        transparent: true, depthWrite: pass === "depth", side: THREE.DoubleSide,
        ...(pass === "depth" ? { colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 }
          : pass === "halo" ? { blending: THREE.AdditiveBlending }
            : { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }),
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = order;
      this.object.add(mesh);
    }
  }

  /** The buffers were rewritten for this frame: they go up to the GPU. */
  refresh(): void { for (const attribute of this.dynamic) attribute.needsUpdate = true; }

  /** Fits it to the camera drawing it: `height` is the drawing buffer's height in pixels. */
  fit(camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
