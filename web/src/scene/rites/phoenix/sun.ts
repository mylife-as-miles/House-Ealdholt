// Adapted from LinearAbiltyCastingExtendedThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The small sun the phoenix becomes over the board: a boiling white-hot disc with a corona of flame tongues, a
 * four-pointed star struck through it, two halos turning about it at odd tilts, a shock ring thrown out across
 * the sky as it is born, and the light it pours on the board under it. It gutters out: the star draws in, the
 * halos thin and fail, and the disc cools from white through gold and amber to red, stuttering, and is gone.
 *
 * No reference draws a sun. From its Celestial Rend (RendPillarMaterial.js): the star as three raised cosines
 * summed into a reach (long vertical points, shorter horizontal ones, short diagonals) with a fine spray of
 * needles between, a hard edge at the reach and a soft inside; and the halos as a band fenced by two rails, cut
 * into dashes, with a few bright beads, a lit limb that travels, and a write-on from one bearing. Ours: the disc,
 * its limb darkening, its granulation and corona; the colours come from one temperature (phoenix/fire.ts) so the
 * whole sun cools as one thing; and the pool of light on the board, drawn because the lowest tier lends no light.
 */
import * as THREE from "three";
import type { Point } from "../../vfx/mystic/beamPlan";
import type { PhoenixMoment } from "./phoenixPlan";
import { FIRE, FIRE_NOISE } from "./fire";

const BILLBOARD = /* glsl */ `
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

/** The disc fills a third of its quad; the corona and the light round it fill the rest. */
const core = (depth: boolean) => /* glsl */ `
${depth ? "#define DEPTH" : ""}
${FIRE_NOISE}
${FIRE}
uniform float uTime, uGain, uHeat, uSun, uFlicker, uSeed, uHalo;
varying vec2 vPlace;
void main() {
  vec2 q = vPlace * 3.0;
  float r = length(q);
#ifdef DEPTH
  // the disc writes depth, so a bright arena's grade does not take the sun for sky
  if (r > 0.98 || uSun < 0.5) discard;
  gl_FragColor = vec4(0.0);
#else
  // guttering: the light stutters, more as it dies
  float stutter = 1.0 - uFlicker * fNoise(vec2(uTime * 11.0, uSeed)) * (0.6 + 0.4 * sin(uTime * 23.0 + 3.0 * sin(uTime * 7.1)));
  float heat = uHeat * stutter;
  // the disc: white-hot, darkening toward its limb, boiling
  float boil = fNoise(q * 3.2 + vec2(uTime * 0.7, -uTime * 0.5)) * 0.6 + fNoise(q * 7.5 - vec2(uTime * 1.4, uTime * 0.9)) * 0.4;
  float disc = 1.0 - smoothstep(0.96, 1.02, r);
  float limb = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
  vec3 colour = fire(heat * (0.66 + 0.34 * limb + 0.28 * (boil - 0.5))) * disc * (0.4 + 0.36 * limb);
  // the corona: tongues of flame standing off the limb, each its own height, licking outward
  float angle = atan(q.y, q.x);
  float tongues = fNoise(vec2(angle * 3.0 + uSeed, r * 2.2 - uTime * 1.6)) * 0.65 + fNoise(vec2(angle * 7.0 - uSeed, r * 4.0 - uTime * 2.4)) * 0.35;
  float reach = 1.0 + 0.95 * tongues * tongues;
  float outward = clamp((r - 1.0) / max(reach - 1.0, 0.05), 0.0, 1.0);
  float corona = smoothstep(0.94, 1.04, r) * (1.0 - smoothstep(0.0, 1.0, outward)) * step(r, reach);
  colour += fire(heat * (0.5 + 0.38 * (1.0 - outward))) * corona * 0.6;
  // the light it pours into the air round it, drawn (the lowest tier has no bloom)
  colour += fire(heat * 0.7) * exp(-max(r - 1.0, 0.0) * 1.5) * smoothstep(0.9, 1.15, r) * 0.12 * uHalo;
  colour *= uSun * (1.0 - smoothstep(2.3, 3.0, r));
  // the disc is a body, not only light: it covers the sky behind it (premultiplied)
  float cover = disc * uSun;
  if (cover < 0.003 && max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, cover);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STAR = /* glsl */ `
${FIRE_NOISE}
${FIRE}
uniform float uTime, uGain, uHeat, uStar, uSun, uSeed;
varying vec2 vPlace;
void main() {
  vec2 p = vPlace;
  float d = length(p);
  if (d > 1.0) discard;
  float inv = 1.0 / max(d, 1e-4), c = p.x * inv, s = p.y * inv;
  // three raised cosines summed into a reach: long points up and down, shorter across, short diagonals
  float reach = pow(abs(s), 5.5) + 0.62 * pow(abs(c), 6.5) + 0.2 * pow(abs(2.0 * s * c), 7.0);
  // and a fine spray of needles between them, eaten by noise so they are not a comb
  float angle = atan(p.y, p.x) + uTime * 0.09;
  float needle = pow(abs(sin(angle * 17.0)), 9.0) * (0.35 + 0.65 * fNoise(vec2(cos(angle) * 3.0 + uSeed, sin(angle) * 3.0 + uTime * 0.25)));
  reach += needle * 0.1;
  // a hard edge at the reach and a soft inside: points, not a blur
  float span = max(reach * 0.95 * uStar, 1e-4);
  float rays = pow(clamp(1.0 - d / span, 0.0, 1.0), 2.0) * (1.0 - smoothstep(0.85, 1.0, d));
  vec3 colour = fire(uHeat * (0.55 + 0.45 * clamp(rays * 1.4, 0.0, 1.0))) * rays * 0.9 * uSun;
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const PLANE = /* glsl */ `
varying vec2 vPlace;
void main() {
  vPlace = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A halo: a band seated at 0.8 of its quad, fenced by rails, cut into dashes, with a few beads and a lit limb that travels. */
const HALO = /* glsl */ `
${FIRE}
uniform float uTime, uGain, uHeat, uOpen, uLife, uSpin, uHalo;
varying vec2 vPlace;
void main() {
  float r = length(vPlace), a = atan(vPlace.y, vPlace.x);
  float d = r - 0.8, band = 0.055;
  float across = 1.0 - smoothstep(0.0, band, abs(d));
  float rails = smoothstep(0.011, 0.0, abs(abs(d) - band * 0.86));
  if (across < 0.003 && rails < 0.003) discard;
  float turn = a / 6.2831853 + uTime * uSpin;
  float cell = fract(turn * 36.0);
  float dash = smoothstep(0.0, 0.08, cell) * (1.0 - smoothstep(0.62, 0.7, cell));
  float bead = (1.0 - smoothstep(0.0, 0.03, min(fract(turn * 5.0), 1.0 - fract(turn * 5.0)))) * (1.0 - smoothstep(0.0, band * 0.9, abs(d)));
  float sweep = pow(max(0.0, cos(a - uTime * uSpin * 12.566)), 6.0);
  // it writes itself on from one bearing, and as it fails its dashes go out one by one
  float written = uOpen >= 0.999 ? 1.0 : smoothstep(0.0, 0.1, uOpen - fract((a + 3.14159265) / 6.2831853));
  float failing = uLife >= 0.999 ? 1.0 : step(fract(sin(floor(turn * 36.0) * 12.9898) * 43758.5453), uLife * 1.15) * (0.4 + 0.6 * uLife);
  float energy = (pow(across, 1.6) * mix(1.0, dash, 0.6) * (1.0 + sweep) + rails * 0.9 + bead * 1.4) * written * failing;
  vec3 colour = fire(uHeat * (0.6 + 0.35 * clamp(rails + bead + 0.5 * sweep, 0.0, 1.0))) * energy * uHalo;
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The shock ring thrown out round the sun as it is born: a bright front that slows as it runs, with a wake inside it, seen as a sphere's edge is (facing the eye). vPlace is in quad halves. */
const SHOCK = /* glsl */ `
${FIRE}
uniform float uGain, uHeat, uFront, uWidth, uFade, uReach;
varying vec2 vPlace;
void main() {
  float r = length(vPlace) * uReach;
  if (abs(r - uFront) > uWidth * 4.0 + 1.5) discard;
  float fromFront = (r - uFront) / uWidth;
  float ring = exp(-fromFront * fromFront) + 0.07 * smoothstep(uFront - 0.9, uFront, r) * step(r, uFront);
  vec3 colour = fire(uHeat * 0.78) * ring * uFade * (1.0 - smoothstep(uReach * 0.85, uReach, r));
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The light the sun pours on the board under it. */
const POOL = /* glsl */ `
${FIRE}
uniform float uGain, uHeat, uPool;
varying vec2 vPlace;
void main() {
  float r = length(vPlace);
  float pool = exp(-r * r * 3.2) * (1.0 - smoothstep(0.75, 1.0, r));
  vec3 colour = fire(0.62 + 0.25 * uHeat) * pool * uPool;
  if (max(max(colour.r, colour.g), colour.b) < 0.002) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Its measures in board units: the disc's radius, the star's reach, the inner halo's radius, how far the shock runs, and the pool on the board. */
const SUN = { disc: 1.0, star: 6.5, halo: 2.5, shock: 9, pool: 6.5 } as const;

export interface PhoenixSunOptions {
  centre: Point;
  boardTop: number;
  unit: number;
  seed: number;
  /** Strength of the drawn glow (PHOENIX_BUDGET.halo), and of the pool on the board (stronger where no light is lent). */
  halo: number;
  pool: number;
  brief: boolean;
}

export class PhoenixSun {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly meshes: THREE.Mesh[] = [];
  private readonly core: Record<string, THREE.IUniform>;
  private readonly star: Record<string, THREE.IUniform>;
  private readonly halos: { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform>; tilt: THREE.Quaternion; spin: number }[] = [];
  private readonly shock: { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> };
  private readonly pool: { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> };
  private readonly turn = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3(0, 0, 1);

  constructor(private readonly options: PhoenixSunOptions, shared: Record<string, THREE.IUniform>) {
    const { centre, unit, seed } = options, at = new THREE.Vector3(centre.x, centre.y, centre.z);
    const make = (vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, order: number) => {
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = order; mesh.visible = false;
      this.materials.push(material); this.meshes.push(mesh); this.object.add(mesh);
      return mesh;
    };
    this.core = { ...shared, uCentre: { value: at.clone() }, uSize: { value: SUN.disc * 3 * unit }, uHeat: { value: 1 }, uSun: { value: 0 }, uFlicker: { value: 0 }, uSeed: { value: (seed % 97) * 0.41 }, uHalo: { value: options.halo } };
    const disc = make(BILLBOARD, core(false), this.core, 13);
    const material = disc.material as THREE.ShaderMaterial;
    material.blending = THREE.CustomBlending; material.blendSrc = THREE.OneFactor; material.blendDst = THREE.OneMinusSrcAlphaFactor; material.blendSrcAlpha = THREE.OneFactor; material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    // and its depth, first
    const depth = new THREE.ShaderMaterial({ uniforms: this.core, vertexShader: BILLBOARD, fragmentShader: core(true), transparent: true, depthWrite: true, colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
    this.materials.push(depth);
    const under = new THREE.Mesh(this.geometry, depth);
    under.frustumCulled = false; under.renderOrder = 10;
    disc.add(under);
    this.star = { ...shared, uCentre: { value: at.clone() }, uSize: { value: SUN.star * unit }, uHeat: { value: 1 }, uStar: { value: 0 }, uSun: { value: 0 }, uSeed: { value: (seed % 89) * 0.29 } };
    make(BILLBOARD, STAR, this.star, 14);
    // two halos at odd tilts, turning against each other
    const tilts: [number, number, number, number][] = [[1.15, 0.35, 1, 0.07], [1.95, -0.5, 1.45, -0.05]];
    for (const [pitch, yaw, size, spin] of tilts) {
      const uniforms = { ...shared, uHeat: { value: 1 }, uOpen: { value: 0 }, uLife: { value: 1 }, uSpin: { value: spin }, uHalo: { value: 1 } };
      const mesh = make(PLANE, HALO, uniforms, 12);
      mesh.position.copy(at);
      mesh.scale.setScalar((SUN.halo * size * unit) / 0.8);
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw + seed * 0.37, 0, "YXZ"));
      mesh.quaternion.copy(tilt);
      this.halos.push({ mesh, uniforms, tilt, spin });
    }
    // the shock ring: the edge of a sphere of light thrown out from the sun, so it faces the eye from anywhere
    const reach = SUN.shock * unit, shockUniforms = { ...shared, uCentre: { value: at.clone() }, uSize: { value: reach }, uHeat: { value: 1 }, uFront: { value: 0 }, uWidth: { value: 0.2 }, uFade: { value: 0 }, uReach: { value: reach } };
    const shock = make(BILLBOARD, SHOCK, shockUniforms, 12);
    this.shock = { mesh: shock, uniforms: shockUniforms };
    // the pool of light on the board under it
    const poolUniforms = { ...shared, uHeat: { value: 1 }, uPool: { value: 0 } };
    const pool = make(PLANE, POOL, poolUniforms, 4);
    pool.position.set(centre.x, options.boardTop + 0.02, centre.z); pool.rotation.x = -Math.PI / 2; pool.scale.setScalar(SUN.pool * unit);
    this.pool = { mesh: pool, uniforms: poolUniforms };
  }

  set(moment: PhoenixMoment, seconds: number): void {
    const { unit, brief } = this.options, heat = moment.sunHeat, on = moment.sun > 0.002;
    this.core.uSun.value = moment.sun; this.core.uHeat.value = heat; this.core.uFlicker.value = moment.flicker;
    this.core.uSize.value = SUN.disc * 3 * unit * moment.sunSize;
    this.meshes[0].visible = on;
    this.star.uStar.value = moment.star * (1 + 0.15 * Math.max(0, moment.sunSize - 1)); this.star.uSun.value = moment.sun; this.star.uHeat.value = heat;
    this.meshes[1].visible = on && moment.star > 0.002;
    for (const halo of this.halos) {
      halo.uniforms.uOpen.value = moment.halos; halo.uniforms.uLife.value = moment.haloLife; halo.uniforms.uHeat.value = heat * 0.95;
      halo.mesh.quaternion.copy(halo.tilt).multiply(this.turn.setFromAxisAngle(this.axis, seconds * halo.spin * 6.283));
      halo.mesh.visible = on && moment.halos > 0.002 && moment.haloLife > 0.002;
    }
    // the shock: out fast and slowing, thinning as it goes
    const shock = moment.shock, running = shock > 0 && shock < 1 && !brief;
    this.shock.mesh.visible = running;
    if (running) {
      this.shock.uniforms.uFront.value = (0.8 + (SUN.shock - 1.6) * (1 - Math.pow(1 - shock, 2.6))) * unit;
      this.shock.uniforms.uWidth.value = (0.08 + 0.3 * shock) * unit;
      this.shock.uniforms.uFade.value = Math.pow(1 - shock, 1.8) * 0.6;
    }
    // the sun's light on the board, and before it the light of the bird hovering over the square
    this.pool.uniforms.uPool.value = Math.max(moment.sun * Math.pow(heat, 1.3), 0.7 * moment.pool) * this.options.pool;
    this.pool.uniforms.uHeat.value = on ? heat : 0.85;
    this.pool.mesh.visible = on || moment.pool > 0.002;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
