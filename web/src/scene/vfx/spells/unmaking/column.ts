// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The column the Unmaking brings up through its rune: light down its middle inside a sheath of dark. Two draws of
 * one open tube.
 *
 * From the reference's RunicBeam: an open tube lit on its axis (`pow(facing, k)`, the inverse of a rim light)
 * reads as a column of light and not a pipe; drawn on both faces the far wall adds to the near one, as a volume
 * does; a noise falls down it, because something drawn up out of the ground must have texture falling through it;
 * a hot head with nothing above it while it comes, a bloom at its foot, a ragged crown. Ours: a second, wider draw
 * of the same tube that darkens only where the eye looks along its wall, so the light stands in a sheath of void
 * and has an edge against a pale square; its wall boils as the matter climbs; the head is a band that comes down
 * again when the column is drawn back into the rune.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = /* glsl */ `
${NOISE}
uniform vec3 uFoot;
uniform float uRadius, uHeight, uGirth, uTime, uClear, uClearHeight;
varying vec2 vRing;
varying float vY, vFacing;
void main() {
  float y = position.y;
  vRing = normalize(position.xz + vec2(1e-6));
  // a skirt where it leaves the rune, opening a little toward the crown, and a wall that boils as matter climbs it;
  // once it has stood a moment its foot thins and loses its skirt, so the body in it is seen
  float low = uClear * (1.0 - smoothstep(uClearHeight * 0.7, uClearHeight, y * uHeight));
  float spread = (1.0 + 0.55 * pow(1.0 - y, 4.0) * (1.0 - uClear) + 0.18 * y) * (1.0 - 0.45 * low);
  float boil = 1.0 + 0.09 * (noise(vRing * 1.7 + vec2(y * 4.0 - uTime * 2.2, 3.0)) - 0.5);
#ifdef SHADE
  float radius = uRadius * uGirth * spread * boil * 1.16;
#else
  float radius = uRadius * uGirth * spread * boil;
#endif
  vec3 at = uFoot + vec3(vRing.x * radius, y * uHeight, vRing.y * radius);
  vec4 here = modelViewMatrix * vec4(at, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * vec3(vRing.x, 0.0, vRing.y)), normalize(-here.xyz)));
  vY = y;
  gl_Position = projectionMatrix * here;
}
`;

const FRAGMENT = /* glsl */ `
${NOISE}
uniform vec3 uEdge, uInner, uCore, uVoid;
uniform float uReach, uColumn, uFlash, uHead, uTime, uSeed, uHeight, uGain, uClear, uClearHeight;
varying vec2 vRing;
varying float vY, vFacing;
void main() {
  // matter falling down through it, sampled round the ring so there is no seam
  float fall = vY * uHeight * 1.4 + uTime * 2.4;
  float n = noise(vRing * 2.3 + vec2(uSeed, fall)) * 0.6 + noise(vRing * 5.1 + vec2(3.0 + uSeed, fall * 2.2)) * 0.4;
  // nothing above the head exists at all: it is an edge, not a fade, and a torn one, not the lid of a can
  float tear = (noise(vRing * 6.1 + vec2(uTime * 3.0, uSeed)) * 0.65 + noise(vRing * 13.0 + vec2(uSeed, uTime * 5.0)) * 0.35 - 0.5) * 0.03 * step(uReach, 0.999);
  if (vY > uReach + tear + 0.012) discard;
  float rim = uReach < 0.999 ? smoothstep(uReach + tear + 0.012, uReach + tear - 0.012, vY) : 1.0;
  // the crown thins into nothing, and the noise decides where, so it is ragged and never a line
  float crown = 1.0 - smoothstep(0.55, 1.0, vY + (n - 0.5) * 0.3);
  // it meets the stone softly: there is no scene depth to soften the join, so it fades by height
  float seat = smoothstep(0.0, 0.012, vY);
  // its foot thinned round the body: the dark is drawn off it and the light dimmed
  float low = uClear * (1.0 - smoothstep(uClearHeight * 0.7, uClearHeight, vY * uHeight));
#ifdef SHADE
  // the sheath of void: dark only where the eye looks along its wall (vFacing can round a hair past 1)
  float alpha = pow(max(1.0 - vFacing, 0.0), 1.6) * 0.62 * crown * seat * rim * min(uColumn, 1.0) * (0.75 + 0.25 * n) * (1.0 - 0.85 * low);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uVoid, alpha);
#else
  // both walls are drawn, so the middle is the two added: each is kept dim, and the white is only where it piles up
  float core = pow(vFacing, 4.0), glow = pow(vFacing, 0.9);
  float streak = mix(0.35, 1.65, n * n);
  float fromHead = (vY - uReach - tear) / 0.035;
  float head = uReach < 0.999 ? exp(-fromHead * fromHead) * (1.0 - smoothstep(0.9, 1.0, uReach)) * uHead : 0.0;
  float foot = exp(-vY * uHeight / 0.25);
  // as it erupts it is still gathering itself: its body comes up a beat behind its heart
  float body = (core * streak * 0.42 + glow * 0.07) * crown * (1.0 - 0.45 * uFlash);
  float hot = core * (foot * 0.75 + head * 1.8);
  // the blow's flash runs to the white heart, not through the whole body
  vec3 colour = (uEdge * glow * 0.2 * crown + uInner * body + uCore * (hot + core * uFlash * 0.6)) * uColumn * seat * rim * (1.0 - 0.7 * low);
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface VoidColumnOptions {
  foot: Point;
  radius: number;
  height: number;
  /** Faces round the tube. */
  radial: number;
  /** Its violet edge, its body, its white heart, and the dark of its sheath. */
  edge: number;
  inner: number;
  core: number;
  void: number;
  /** How hot its head is while it comes and goes: 1, or less for the brief form, in which nothing flares. */
  head?: number;
  /** How high its foot thins once it has come (UnmakingSize.clear). */
  clear: number;
  seed: number;
}

export class VoidColumn {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry: THREE.CylinderGeometry;
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(options: VoidColumnOptions) {
    // a unit tube standing on its base, open at both ends; the height needs its rings for a clean head
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, options.radial, 28, true).translate(0, 0.5, 0);
    this.uniforms = {
      uFoot: { value: new THREE.Vector3(options.foot.x, options.foot.y, options.foot.z) }, uRadius: { value: options.radius }, uHeight: { value: options.height },
      uGirth: { value: 1 }, uReach: { value: 0 }, uColumn: { value: 0 }, uFlash: { value: 0 }, uHead: { value: options.head ?? 1 }, uTime: { value: 0 }, uSeed: { value: (options.seed % 613) * 0.21 }, uGain: { value: 1 },
      uClear: { value: 0 }, uClearHeight: { value: options.clear },
      uEdge: { value: new THREE.Color(options.edge) }, uInner: { value: new THREE.Color(options.inner) }, uCore: { value: new THREE.Color(options.core) }, uVoid: { value: new THREE.Color(options.void) },
    };
    for (const shade of [true, false]) {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: shade ? { SHADE: 1 } : {},
        transparent: true, depthWrite: false, blending: shade ? THREE.NormalBlending : THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      // depth-tested, so the figure standing in it cuts the far wall and is wrapped by the near one
      mesh.frustumCulled = false; mesh.renderOrder = shade ? 9 : 10;
      this.object.add(mesh);
    }
    this.object.visible = false;
  }

  /**
   * How far up it stands (0..1), a factor on its radius, its brightness, the flash of the blow, and how far its foot has
   * thinned round the body (0..1).
   */
  set(reach: number, girth: number, column: number, flash: number, clear: number): void {
    const u = this.uniforms;
    u.uReach.value = reach; u.uGirth.value = girth; u.uColumn.value = column; u.uFlash.value = flash; u.uClear.value = clear;
    this.object.visible = reach > 0.002 && column > 0.002 && girth > 0.002;
  }
  setTime(seconds: number): void { this.uniforms.uTime.value = seconds; }
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
