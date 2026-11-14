/**
 * Blood on the board: stains where droplets land and the pool under a body.
 * One InstancedMesh of quads lying just above the stone, one shared material.
 *
 * The shapes are procedural: seeded noise in the fragment shader, no texture.
 *  - a stain is an irregular blot with a few satellite specks, drawn out along
 *    the droplet's travel;
 *  - a pool spreads from its centre over its `grow` seconds, unevenly, and
 *    runs further along the lines between squares than across the stone.
 * Both start wet (dark red, low roughness, so the scene's own lights and
 * environment give the sheen) and dry to a darker, duller mark.
 *
 * The material is a MeshStandardMaterial with the mask patched in, so stains
 * take the board's lighting, shadows, fog and tone mapping like the stone
 * they lie on. Removal is by impact id (Undo); past the per-match cap the
 * oldest marks fade out (see DecalBuffer).
 */
import * as THREE from "three";
import { DecalBuffer, type DecalRecord } from "./GoreBuffers";

/** The quad is this many radii wide, so specks and groove runs have room. */
const MARGIN = [1.6, 2.5] as const;
/** Height over the board plane: clear of z-fighting, under every foot. */
const LIFT = 0.004;

const VERTEX_HEAD = /* glsl */ `
attribute vec4 aGoreLook;
attribute vec4 aGoreLife;
varying vec2 vGoreUv;
varying vec2 vGoreWorld;
varying vec4 vGoreLook;
varying vec4 vGoreLife;
`;
const VERTEX_BODY = /* glsl */ `
vGoreUv = uv * 2.0 - 1.0;
vGoreLook = aGoreLook;
vGoreLife = aGoreLife;
vGoreWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uGoreTime;
uniform float uGoreTile;
uniform float uGoreSheen;
uniform vec3 uGoreKey;
uniform vec3 uGoreFresh;
uniform vec3 uGoreDry;
varying vec2 vGoreUv;
varying vec2 vGoreWorld;
varying vec4 vGoreLook;
varying vec4 vGoreLife;
float goreRoughness = 1.0;
float goreSheen = 0.0;
float goreRim = 0.0;
float goreHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float goreNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(goreHash(i), goreHash(i + vec2(1.0, 0.0)), u.x), mix(goreHash(i + vec2(0.0, 1.0)), goreHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float goreFbm(vec2 p) {
  return goreNoise(p) * 0.55 + goreNoise(p * 2.03 + 7.1) * 0.3 + goreNoise(p * 4.11 + 3.7) * 0.15;
}
// Round specks thrown off a splash: one per noise cell, most cells empty.
float goreSpecks(vec2 p) {
  vec2 cell = floor(p), local = fract(p) - 0.5;
  float pick = goreHash(cell + 11.0);
  vec2 jitter = vec2(goreHash(cell + 3.0), goreHash(cell + 5.0)) - 0.5;
  float size = 0.08 + 0.2 * goreHash(cell + 9.0);
  return step(0.62, pick) * smoothstep(size, size * 0.6, length(local - jitter * 0.5));
}
// 1 on the engraved line between two squares, 0 on the open stone.
float goreGroove(vec2 world) {
  vec2 cell = abs(fract(world / uGoreTile + 0.5) - 0.5) * uGoreTile;
  return 1.0 - smoothstep(0.008, 0.036, min(cell.x, cell.y));
}
// x: coverage, y: thickness (0 at the edge, 1 in the body).
vec2 goreMask(float age) {
  float seed = vGoreLook.x * 61.0;
  bool pool = vGoreLook.z > 0.5;
  float margin = pool ? ${MARGIN[1].toFixed(1)} : ${MARGIN[0].toFixed(1)};
  vec2 p = vGoreUv * margin;
  float r = length(p);
  vec2 ray = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  float lobes = goreNoise(ray * 2.3 + seed) * 0.65 + goreNoise(ray * 5.1 + seed * 1.7) * 0.35;
  float grain = goreFbm(p * 3.2 + seed);
  if (pool) {
    float grow = vGoreLook.w;
    float front = grow > 0.0 ? 1.0 - exp(-3.2 * age / grow) : 1.0;
    // The front is uneven, and the lines between squares draw the blood along them.
    float d = r * (0.72 + 0.56 * lobes) - 0.16 * (grain - 0.5);
    // Not every line fills alike: how far each one carries the blood is seeded too.
    // The lines fill behind the front: the blood reaches a line, then creeps along it for seconds after the
    // open stone has stopped taking it.
    float along = grow > 0.0 ? smoothstep(0.25, 1.6, age / grow) : 1.0;
    float groove = goreGroove(vGoreWorld);
    d *= 1.0 - vGoreLife.w * groove * along * smoothstep(0.15, 0.5, r) * (0.3 + 0.7 * goreNoise(vGoreWorld * 1.7 + seed));
    float cover = smoothstep(front, front - 0.07, d) * step(1e-3, front);
    // It stands deepest in the middle and in the lines it has gathered in.
    return vec2(cover, clamp((front - d) * 2.4 + groove * 0.5, 0.0, 1.0));
  }
  // A stain lands a little wider than it settles.
  float settle = mix(1.18, 1.0, smoothstep(0.0, 0.22, age));
  float edge = 0.5 + 0.5 * lobes + 0.22 * (grain - 0.5);
  float body = smoothstep(edge, edge - 0.1, r * settle);
  float specks = goreSpecks(p * 3.6 + seed) * smoothstep(1.5, 1.0, r) * smoothstep(0.55, 0.9, r);
  return vec2(max(body, specks) * smoothstep(0.0, 0.06, age), clamp((edge - r) * 2.2, 0.0, 1.0));
}
`;
const FRAGMENT_COLOR = /* glsl */ `
{
  float goreAge = max(0.0, uGoreTime - vGoreLook.y);
  vec2 gore = goreMask(goreAge);
  bool gorePool = vGoreLook.z > 0.5;
  // A pool stays wet while it spreads and long after; a stain skins over in seconds.
  float goreWet = 1.0 - smoothstep(gorePool ? vGoreLook.w + 12.0 : 3.0, gorePool ? vGoreLook.w + 50.0 : 18.0, goreAge);
  float goreFade = vGoreLife.x < 0.0 ? 1.0 : 1.0 - smoothstep(vGoreLife.x, vGoreLife.x + vGoreLife.y, uGoreTime);
  float goreAlpha = gore.x * goreFade * mix(0.84, 0.985, gore.y);
  if (goreAlpha < 0.004) discard;
  // Thin at the rim, where the stone shows through as a brighter red; a dark, saturated core where it stands deep.
  vec3 goreColor = mix(uGoreDry, uGoreFresh, goreWet) * mix(1.25, 0.4, smoothstep(0.0, 0.85, gore.y));
  goreRim = smoothstep(0.02, 0.14, gore.y) * (1.0 - smoothstep(0.14, 0.45, gore.y));
  diffuseColor = vec4(goreColor, goreAlpha);
  goreRoughness = mix(0.9, mix(0.34, 0.08, gore.y), goreWet);
  goreSheen = goreWet * goreAlpha * mix(0.6, 1.0, gore.y);
}
`;

// Wet blood catches the sky even where the renderer has no reflection probe (safe mode, low presets):
// a faint deep-red grazing sheen, so a fresh pool still reads on a black square. It dries away with the blood.
const FRAGMENT_SHEEN = /* glsl */ `
{
  vec3 goreN = normalize(normal), goreV = normalize(vViewPosition);
  float goreGraze = pow(1.0 - clamp(dot(goreN, goreV), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += vec3(0.3, 0.014, 0.016) * goreSheen * (0.02 + 0.14 * goreGraze) * uGoreSheen;
  // The arena's key light on the wet surface: a soft glint where the view mirrors it, and the raised lip
  // of the liquid catching it all the way round. Both go as the blood dries.
  vec3 goreKey = normalize((viewMatrix * vec4(uGoreKey, 0.0)).xyz);
  float goreGlint = pow(max(dot(goreN, normalize(goreKey + goreV)), 0.0), 160.0);
  totalEmissiveRadiance += vec3(0.62, 0.5, 0.46) * goreSheen * (goreGlint * 0.2 + goreRim * (0.008 + 0.035 * goreGraze)) * uGoreSheen;
}
`;

export class BloodDecals {
  readonly object: THREE.InstancedMesh;
  readonly buffer: DecalBuffer;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly time = { value: 0 };
  private readonly sheen = { value: 1 };
  /** World direction towards the arena's key light. */
  private readonly key = { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() };
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private uploaded = -1;

  constructor(cap: number, private readonly board: { top: number; tile: number }) {
    this.buffer = new DecalBuffer(cap);
    this.geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.look = new THREE.InstancedBufferAttribute(this.buffer.look, 4).setUsage(THREE.DynamicDrawUsage);
    this.life = new THREE.InstancedBufferAttribute(this.buffer.life, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aGoreLook", this.look);
    this.geometry.setAttribute("aGoreLife", this.life);
    const time = this.time, tile = board.tile;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.material.onBeforeCompile = shader => {
      shader.uniforms.uGoreTime = time;
      shader.uniforms.uGoreTile = { value: tile };
      shader.uniforms.uGoreSheen = this.sheen;
      shader.uniforms.uGoreKey = this.key;
      shader.uniforms.uGoreFresh = { value: new THREE.Color(0.12, 0.004, 0.005) };
      shader.uniforms.uGoreDry = { value: new THREE.Color(0.05, 0.007, 0.005) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = goreRoughness;")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${FRAGMENT_SHEEN}`);
    };
    this.material.customProgramCacheKey = () => "crownfall-gore-decal-5";
    this.object = new THREE.InstancedMesh(this.geometry, this.material, this.buffer.slots);
    this.object.name = "gore-decals";
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.castShadow = false; this.object.receiveShadow = true;
    this.object.renderOrder = 2;
    this.object.visible = false;
  }

  /** Where the arena's key light stands (a world direction towards it) and how strongly wet blood answers it. */
  setKeyLight(direction: { x: number; y: number; z: number }, strength = 1): void {
    this.key.value.set(direction.x, direction.y, direction.z).normalize();
    this.sheen.value = strength;
  }

  /** Seconds on the decal clock: what a mark's age is measured against. */
  get now(): number { return this.time.value; }

  add(impactId: string, record: DecalRecord): void { this.buffer.add(impactId, record, this.time.value); }
  removeImpact(impactId: string): void { this.buffer.removeImpact(impactId); }
  clear(): void { this.buffer.clear(); }

  update(delta: number): void {
    this.time.value += Math.max(0, delta);
    const buffer = this.buffer;
    buffer.update(this.time.value);
    if (this.uploaded === buffer.version) return;
    this.uploaded = buffer.version;
    const y = this.board.top + LIFT;
    for (let i = 0; i < buffer.count; i += 1) {
      const radius = buffer.place[i * 4 + 2], pool = buffer.look[i * 4 + 2] > 0.5;
      const reach = radius * MARGIN[pool ? 1 : 0];
      // Pools overlap stains: give each mark its own height so none flickers through another.
      this.position.set(buffer.place[i * 4], y + (pool ? 0 : LIFT * 0.5) + i * 1e-5, buffer.place[i * 4 + 1]);
      this.rotation.setFromAxisAngle(this.up, buffer.place[i * 4 + 3]);
      this.scale.set(reach * buffer.life[i * 4 + 2], 1, reach);
      this.object.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.object.count = buffer.count;
    this.object.visible = buffer.count > 0;
    this.object.instanceMatrix.needsUpdate = true;
    this.look.needsUpdate = true; this.life.needsUpdate = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
