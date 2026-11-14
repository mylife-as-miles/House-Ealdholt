// Adapted from HandCastAbilityThreeJS and LinearAbiltyCastingExtendedThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The phoenix's body and head: volumes of white-hot light, and the glow they throw round themselves.
 *
 * Each is a turned solid (a teardrop for the trunk, an egg for the head) shaded as a volume of light, not as a
 * surface: how bright it is is how much of it the eye looks through, so it is densest through its middle and
 * fades to nothing at its outline, and it never shows a rim. Flames stream back over it from the chest as it
 * flies. The glow is drawn, because the lowest tier has no bloom to make it.
 *
 * Under the light is a body of embers, drawn premultiplied, which covers part of what is behind it; its solid
 * middle writes depth, so a bright arena's grade does not take it for sky (as phoenix/plumes.ts).
 *
 * From the reference: the body is a radiator whose temperature is read off how squarely it faces the eye, with
 * flames climbing it in noise (PhoenixMaterials.js, the bird's body), and a volume of light is a power of N·V,
 * not a fresnel (Celestial Rend's column, RendPillarMaterial.js). Ours: the solid is turned in code, there is no
 * painted plumage to read, and the flames stream along the body's own length rather than up the world.
 */
import * as THREE from "three";
import { FIRE, FIRE_NOISE, SEAL_CUT } from "./fire";
import { TRUNK, type PhoenixPose } from "./phoenixForm";

const VERTEX = /* glsl */ `
varying vec3 vNormalW, vWorld, vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (depth: boolean) => /* glsl */ `
${depth ? "#define DEPTH" : ""}
${FIRE_NOISE}
${FIRE}
${SEAL_CUT}
uniform float uTime, uGain, uHeat, uShown, uScale, uMatter;
varying vec3 vNormalW, vWorld, vLocal;
void main() {
  float molten = sealCut(vWorld);
  vec3 N = normalize(vNormalW), V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(N, V));
#ifdef DEPTH
  // its solid middle writes depth, so the arena's grade does not take it for sky
  if (facing < 0.35 || uShown < 0.5) discard;
  gl_FragColor = vec4(0.0);
#else
  // the chord the eye looks through: densest down the middle, nothing at the outline
  float chord = pow(facing, 1.25);
  // flames streaming back along the body from the chest as it flies
  float around = atan(vLocal.y, vLocal.x), along = vLocal.z / uScale;
  float n = fNoise(vec2(along * 3.2 + uTime * 5.0, around * 1.6)) * 0.6 + fNoise(vec2(along * 7.0 + uTime * 8.0, around * 3.1 + 4.0)) * 0.4;
  float heat = uHeat * (0.58 + 0.42 * chord + 0.22 * (n - 0.5)) + molten * 0.4;
  vec3 colour = fire(heat) * (0.1 + 0.75 * chord) * smoothstep(0.02, 0.32, facing) * uShown;
  // a body of embers under the light, covering what is behind it (premultiplied)
  float cover = uMatter * mix(0.55, 1.0, uDay) * smoothstep(0.1, 0.45, facing) * uShown;
  if (cover < 0.003 && max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, cover);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uSize;
varying vec2 vPlace;
void main() {
  vPlace = position.xy;
  vec4 here = viewMatrix * vec4(uCentre, 1.0);
  here.xy += position.xy * uSize;
  gl_Position = projectionMatrix * here;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
${FIRE}
uniform float uGain, uGlow;
varying vec2 vPlace;
void main() {
  float r = length(vPlace);
  float glow = exp(-r * r * 4.5) * (1.0 - smoothstep(0.7, 1.0, r));
  vec3 colour = fire(0.78) * glow * uGlow * (1.0 - 0.6 * uDay);
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A solid turned about its length (z), from a profile of (radius, along) pairs in board units. */
function turned(profile: readonly (readonly [number, number])[], unit: number, sides: number): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-3, r * unit), y * unit)), sides);
  // turned about y; laid along z, the beak's way
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** The trunk, from the root of the tail to the front of the chest: deep in the chest, tapering to the tail. */
const TRUNK_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, -TRUNK.tail], [0.06, -TRUNK.tail + 0.02], [0.12, -0.4], [0.2, -0.12], [TRUNK.radius, 0.14], [0.23, 0.36], [0.16, 0.52], [0.06, TRUNK.chest - 0.02], [0.0, TRUNK.chest],
];
/** The head: an egg, its point toward the beak. */
const HEAD_PROFILE: readonly (readonly [number, number])[] = [[0.0, -0.13], [0.09, -0.11], [0.14, -0.04], [0.135, 0.05], [0.09, 0.13], [0.0, 0.18]];

export class PhoenixBody {
  readonly object = new THREE.Group();
  private readonly trunk: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly trunkUniforms: Record<string, THREE.IUniform>;
  private readonly headUniforms: Record<string, THREE.IUniform>;
  private readonly glowUniforms: Record<string, THREE.IUniform>;
  private readonly basis = new THREE.Matrix4();
  private readonly axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(shared: Record<string, THREE.IUniform>, private readonly unit: number, private readonly halo: number, sides = 18, matter = 1) {
    const solid = (profile: readonly (readonly [number, number])[], heat: number) => {
      const geometry = turned(profile, unit, sides), uniforms = { ...shared, uHeat: { value: heat }, uShown: { value: 0 }, uScale: { value: unit }, uMatter: { value: matter } };
      const material = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX, fragmentShader: fragment(false), transparent: true, depthWrite: false, side: THREE.FrontSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      const depth = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: fragment(true), transparent: true, depthWrite: true, colorWrite: false, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
      this.geometries.push(geometry); this.materials.push(material, depth);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = 12; mesh.matrixAutoUpdate = true;
      // its depth, drawn with the plumes' (after everything opaque), from the same place
      const under = new THREE.Mesh(geometry, depth);
      under.frustumCulled = false; under.renderOrder = 10;
      mesh.add(under);
      return { mesh, uniforms };
    };
    const trunk = solid(TRUNK_PROFILE, 0.95), head = solid(HEAD_PROFILE, 1.02);
    this.trunk = trunk.mesh; this.trunkUniforms = trunk.uniforms;
    this.head = head.mesh; this.headUniforms = head.uniforms;
    const plane = new THREE.PlaneGeometry(2, 2);
    this.glowUniforms = { ...shared, uCentre: { value: new THREE.Vector3() }, uSize: { value: 1.7 * unit }, uGlow: { value: 0.32 * halo } };
    const glowMaterial = new THREE.ShaderMaterial({ uniforms: this.glowUniforms, vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.geometries.push(plane); this.materials.push(glowMaterial);
    this.glow = new THREE.Mesh(plane, glowMaterial);
    this.glow.frustumCulled = false; this.glow.renderOrder = 10;
    this.object.add(this.glow, this.trunk, this.head);
  }

  /**
   * Places the body and the head where the pose has them; as the bird goes into the sun they are drawn into it.
   * `through` is how far the body has come out of the seal (0 still behind it, 1 clear): its glow is a quad that
   * faces the eye, which the seal's cut cannot reach, so it is held back until the body is through.
   */
  pose(pose: PhoenixPose, sun: { x: number; y: number; z: number }, through = 1, glowOnly = false): void {
    const shown = pose.shown, c = pose.collapse, pull = Math.pow(1 - c, 1.5), size = 1 - 0.6 * c;
    this.object.visible = shown > 0.001;
    if (!this.object.visible) return;
    // with the model drawn, only the glow the body throws round itself
    this.trunk.visible = !glowOnly; this.head.visible = !glowOnly;
    const toward = (p: readonly number[], out: THREE.Vector3) => out.set(sun.x + (p[0] - sun.x) * pull, sun.y + (p[1] - sun.y) * pull, sun.z + (p[2] - sun.z) * pull);
    const [x, y, z] = this.axes;
    // the trunk: its length along the beak, its back up
    x.fromArray(pose.left); y.fromArray(pose.up); z.fromArray(pose.forward);
    this.trunk.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    toward(pose.centre, this.trunk.position);
    this.trunk.scale.setScalar(size);
    // the head: its point along the beak, its crown up
    z.fromArray(pose.beak); y.fromArray(pose.crown); x.crossVectors(y, z).normalize(); y.crossVectors(z, x).normalize();
    this.head.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    toward(pose.head, this.head.position);
    this.head.scale.setScalar(size);
    toward(pose.centre, this.glowUniforms.uCentre.value as THREE.Vector3);
    this.glowUniforms.uSize.value = 1.7 * this.unit * (1 + 0.6 * c);
    this.glowUniforms.uGlow.value = 0.22 * this.halo * shown * (1 + c) * through;
    const heat = pose.heat;
    this.trunkUniforms.uShown.value = shown; this.headUniforms.uShown.value = shown;
    this.trunkUniforms.uHeat.value = 0.95 * heat; this.headUniforms.uHeat.value = 1.02 * heat;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
