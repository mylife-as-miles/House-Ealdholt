/**
 * The phoenix's real fire, drawn with the game's flipbook atlases (vfx/library.ts): JangaFX's CC0 EmberGen fire
 * loop for the flames standing on the bird and, drawn out long, for the fire it sheds along its flight; its flare (a
 * gout of flame that erupts and tears apart) where the rite strikes; and the game's own powder smoke, darkened,
 * for the soot. flamePlan.ts decides what burns
 * where; this draws it.
 *
 * As the match's flipbooks (vfx/flipbook.ts): one instanced quad per atlas, the frame chosen in the vertex shader
 * from the rite's clock, and the output premultiplied, so a sprite can both cover (soot) and add light (fire). Ours:
 * a sprite is turned so its atlas's up runs along the way its flame streams, seen on the screen (back along the
 * flight, up where it hovers), not along the screen's up; the fire is recoloured through the rite's own temperature
 * ramp (phoenix/fire.ts), so the atlas's flames burn in Solforiz's gold like every other layer; and the flames on the
 * bird are moved with it every frame, while everything shed is written once and left to the shader. The match's own
 * FlipbookSystem holds a few dozen sprites for the board's fires and dust, and its sprites do not follow anything:
 * the bird needs hundreds, tied to it.
 */
import * as THREE from "three";
import type { QualityPreset } from "../../quality";
import { VFX_ATLASES, type VfxEffectId } from "../../vfx/library";
import type { BlazeFlame, PhoenixFlamePlan, ShedSprite } from "./flamePlan";
import { FIRE, SEAL_BEHIND } from "./fire";
import type { PlumeBuffers, PlumeLayout } from "./phoenixForm";

/** Floats a sprite keeps: place and size, drift and growth, stream and rise, clock, look. */
const STRIDE = 20;

const VERTEX = /* glsl */ `
${SEAL_BEHIND}
attribute vec4 aPlace;   // where, and size across its cell
attribute vec4 aDrift;   // velocity, and growth a second
attribute vec4 aStream;  // the way its flame points, and the rise of the hot air under it
attribute vec4 aClock;   // birth, life (0 stands on the bird and never ages), first frame, frames a second (0: one pass over its life)
attribute vec4 aLook;    // heat, alpha, additive, seed
uniform float uTime, uNudge, uStretch;
uniform vec4 uGrid;      // columns, rows, frames, loop
uniform vec2 uPivot;
varying vec2 vUv0, vUv1;
varying float vBlend, vAlpha, vHeat, vAdditive, vAge;

vec2 cell(float index, vec2 at) {
  float col = mod(index, uGrid.x), row = floor(index / uGrid.x + 1e-4);
  return vec2((col + at.x) / uGrid.x, 1.0 - (row + 1.0 - at.y) / uGrid.y);
}

void main() {
  bool standing = aClock.y <= 0.0;
  float age = standing ? uTime + aLook.w * 7.0 : uTime - aClock.x;
  float life = standing ? 1.0 : aClock.y;
  float k = standing ? 0.0 : clamp(age / life, 0.0, 1.0);
  float alive = standing ? 1.0 : step(0.0, age) * step(age, life);
  float frames = uGrid.z;
  float cursor = aClock.w > 0.0 ? aClock.z + max(age, 0.0) * aClock.w : mix(aClock.z, frames - 1.0, k);
  float index, next;
  if (uGrid.w > 0.5) { cursor = mod(cursor, frames); index = min(floor(cursor), frames - 1.0); next = mod(index + 1.0, frames); }
  else { cursor = min(cursor, frames - 1.0); index = floor(cursor); next = min(index + 1.0, frames - 1.0); }
  vBlend = cursor - index;
  // a mirrored sprite for every other seed, so neighbours are not twins
  vec2 at = vec2(fract(aLook.w * 7.31) < 0.5 ? 1.0 - uv.x : uv.x, uv.y);
  vUv0 = cell(index, at); vUv1 = cell(next, at);
  float fade = standing ? 1.0 : smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.55, 1.0, k));
  vAlpha = aLook.y * fade * alive;
  vHeat = aLook.x * (standing ? 1.0 : 1.0 - 0.15 * k);
  vAdditive = aLook.z;
  vAge = k;

  vec3 centre = aPlace.xyz + aDrift.xyz * max(age, 0.0) * (standing ? 0.0 : 1.0) + vec3(0.0, standing ? 0.0 : 0.5 * aStream.w * age * age, 0.0);
  // nothing of the bird is there before it has come through the seal
  float size = aPlace.w * (1.0 + aDrift.w * (standing ? 0.0 : max(age, 0.0))) * alive * (behindSeal(centre) ? 0.0 : 1.0);
  vec4 view = viewMatrix * vec4(centre, 1.0);
  // a little toward the eye, so a flame standing on a feather is not cut by the feather it stands on
  view.xyz += normalize(-view.xyz) * uNudge;
  // the atlas's up along the way the flame streams, as it is seen
  vec3 run = mat3(viewMatrix) * aStream.xyz;
  vec2 upward = dot(run.xy, run.xy) > 1e-6 ? normalize(run.xy) : vec2(0.0, 1.0);
  vec2 across = vec2(upward.y, -upward.x);
  // drawn out along the way it streams
  vec2 corner = (uv - uPivot) * size * vec2(1.0, uStretch);
  view.xy += across * corner.x + upward * corner.y;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
${FIRE}
uniform sampler2D map;
uniform float uGain, uMode;
uniform vec3 uSoot;
varying vec2 vUv0, vUv1;
varying float vBlend, vAlpha, vHeat, vAdditive, vAge;
void main() {
  vec4 texel = mix(texture2D(map, vUv0), texture2D(map, vUv1), vBlend);
  float alpha = texel.a * vAlpha;
  if (alpha < 0.004) discard;
  float bright = max(texel.r, max(texel.g, texel.b));
  vec3 colour;
  float cover;
  if (uMode < 0.5) {
    // fire: its brightness is its temperature, burnt in the kingdom's colours. The atlas's red is near full all over, so
    // its brightest channel is one flat level; its green rises from the red fringe to the yellow-white heart, and is
    // the flame's own heat (as vfx/flipbook.ts reads it)
    float hot = smoothstep(0.12, 0.7, texel.g);
    colour = fire(vHeat * (0.68 + 0.55 * hot)) * (0.55 + 0.45 * hot);
    // against a bright sky a flame is a body of fire, not light added to the sky (which would wash it to the sky's colour)
    cover = 1.0 - vAdditive * (1.0 - 0.9 * uDay);
  } else if (uMode < 1.5) {
    // a fireball rolling into soot: what is orange in the atlas burns, what is grey is soot
    float flame = clamp((texel.r - texel.b) * 2.4, 0.0, 1.0);
    colour = fire(vHeat * (0.25 + 0.85 * bright) * (0.4 + 0.6 * flame)) * flame * (0.3 + 0.5 * bright) + uSoot * (0.35 + 0.65 * bright) * (1.0 - flame);
    cover = 1.0 - vAdditive * flame * (1.0 - 0.9 * uDay);
  } else {
    // soot: dark, lit warm from under by the fire while it is young
    colour = uSoot * (0.45 + 0.55 * bright) + fire(0.45) * 0.12 * (1.0 - smoothstep(0.0, 0.5, vAge)) * (1.0 - bright);
    cover = 1.0;
    alpha = min(1.0, alpha * (1.0 + 0.6 * uDay));
  }
  gl_FragColor = vec4(colour * alpha * uGain, alpha * cover);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Where the atlases are served, as the match's flipbooks load them (sceneEngine.ts). */
const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}assets/play/vfx/`;
/** Each atlas is loaded once a page and kept: a second phoenix does not decode it again. */
const atlases = new Map<string, Promise<THREE.Texture | null>>();
function atlas(id: VfxEffectId, quality: QualityPreset): Promise<THREE.Texture | null> {
  const file = VFX_ATLASES[id].files[quality === "low" ? "quest" : "desktop"], url = BASE + file;
  let pending = atlases.get(url);
  if (!pending) {
    pending = new THREE.TextureLoader().loadAsync(url).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      return texture;
    }, () => { atlases.delete(url); return null; });
    atlases.set(url, pending);
  }
  return pending;
}

/** One atlas: its instanced quad and its sprites. */
class FlameLayer {
  readonly mesh: THREE.Mesh;
  readonly data: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  readonly material: THREE.ShaderMaterial;
  readonly ready: Promise<void>;
  private disposed = false;

  constructor(id: VfxEffectId, count: number, mode: number, shared: Record<string, THREE.IUniform>, quality: QualityPreset, order: number, dynamic: boolean, soot: THREE.Color, stretch = 1) {
    const clip = VFX_ATLASES[id];
    this.data = new Float32Array(Math.max(1, count) * STRIDE);
    const geometry = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geometry.index = plane.index; geometry.setAttribute("position", plane.getAttribute("position")); geometry.setAttribute("uv", plane.getAttribute("uv"));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    if (dynamic) this.buffer.setUsage(THREE.DynamicDrawUsage);
    ["aPlace", "aDrift", "aStream", "aClock", "aLook"].forEach((name, i) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4)));
    geometry.instanceCount = Math.max(1, count);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...shared, map: { value: null }, uMode: { value: mode }, uSoot: { value: soot }, uNudge: { value: id === "fire" ? 0.35 : 0 }, uStretch: { value: stretch },
        uGrid: { value: new THREE.Vector4(clip.cols, clip.rows, clip.frames, clip.loop ? 1 : 0) }, uPivot: { value: new THREE.Vector2(clip.pivot[0], clip.pivot[1]) },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.visible = false; this.mesh.name = `phoenix:${id}`;
    this.ready = atlas(id, quality).then((texture) => { if (!this.disposed) this.material.uniforms.map.value = texture; });
  }

  /** Writes one sprite's row. */
  write(i: number, place: readonly number[], drift: readonly number[], stream: readonly number[], clock: readonly number[], look: readonly number[]): void {
    const o = i * STRIDE, d = this.data;
    d.set(place, o); d.set(drift, o + 4); d.set(stream, o + 8); d.set(clock, o + 12); d.set(look, o + 16);
  }

  get textured(): boolean { return this.material.uniforms.map.value !== null; }

  dispose(): void {
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export interface PhoenixFlamesOptions {
  quality: QualityPreset;
  /** The soot's colour (linear), dark. */
  soot: THREE.Color;
}

export class PhoenixFlames {
  readonly object = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly blaze: FlameLayer;
  private readonly trail: FlameLayer;
  private readonly soot: FlameLayer;
  private readonly gouts: FlameLayer;
  private flames: readonly BlazeFlame[];
  private standing: number;
  private readonly lastShed: number;

  constructor(plan: PhoenixFlamePlan, private readonly layout: PlumeLayout, shared: Record<string, THREE.IUniform>, options: PhoenixFlamesOptions) {
    const { quality, soot } = options;
    this.flames = plan.blaze;
    this.standing = plan.blaze.length;
    this.soot = new FlameLayer("smokePuff", plan.soot.length, 2, shared, quality, 8, false, soot);
    this.trail = new FlameLayer("fire", plan.trail.length, 0, shared, quality, 9, false, soot, 1.7);
    this.blaze = new FlameLayer("fire", plan.blaze.length, 0, shared, quality, 13, true, soot);
    this.gouts = new FlameLayer("flare", plan.gouts.length, 0, shared, quality, 13.5, false, soot);
    const shed = (layer: FlameLayer, sprites: readonly ShedSprite[], fps: number) => sprites.forEach((s, i) => layer.write(i,
      [s.origin.x, s.origin.y, s.origin.z, s.size], [s.velocity.x, s.velocity.y, s.velocity.z, s.growth], [s.stream.x, s.stream.y, s.stream.z, s.rise],
      [s.birth, s.life, s.first, fps], [s.heat, s.alpha, s.additive, s.seed]));
    shed(this.trail, plan.trail, VFX_ATLASES.fire.fps);
    shed(this.soot, plan.soot, 0);
    shed(this.gouts, plan.gouts, 0);
    const fps = VFX_ATLASES.fire.fps;
    plan.blaze.forEach((flame, i) => this.blaze.write(i, [0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 0, 0], [0, 0, flame.frame, fps], [flame.heat, 0, 0.86, flame.seed]));
    this.lastShed = Math.max(0, ...[...plan.trail, ...plan.soot, ...plan.gouts].map((s) => s.birth + s.life));
    this.object.add(this.soot.mesh, this.trail.mesh, this.blaze.mesh, this.gouts.mesh);
    // Waited for by the rite, so the flames are there from the first frame; a missing atlas only leaves its layer undrawn.
    this.ready = Promise.all([this.blaze.ready, this.trail.ready, this.soot.ready, this.gouts.ready]).then(() => undefined);
  }

  /**
   * Moves the flames standing on the bird to where its ribbons are this frame (`buffers`, just written by
   * writePlumes), streaming along `stream`; `shown` is how much of the bird there is. `t` is the rite's clock.
   */
  update(t: number, buffers: PlumeBuffers, stream: readonly number[], shown: number): void {
    const { position, ribbon } = buffers, layout = this.layout, data = this.blaze.data;
    let any = false;
    this.flames.forEach((flame, i) => {
      const vertex = layout.first[flame.spec] + flame.cut * 2, o = i * STRIDE;
      const width = ribbon[vertex * 4 + 2], heat = ribbon[vertex * 4 + 3];
      const on = width > 1e-5 ? shown : 0;
      data[o] = position[vertex * 3]; data[o + 1] = position[vertex * 3 + 1]; data[o + 2] = position[vertex * 3 + 2];
      data[o + 3] = flame.size * (0.75 + 0.35 * Math.min(1, heat)) * on;
      data[o + 8] = stream[0]; data[o + 9] = stream[1]; data[o + 10] = stream[2];
      data[o + 16] = flame.heat * Math.min(1.05, 0.55 + 0.55 * heat);
      data[o + 17] = 0.8 * on;
      if (on > 0.001) any = true;
    });
    this.blaze.buffer.needsUpdate = true;
    this.blaze.mesh.visible = any && this.blaze.textured;
    this.trail.mesh.visible = this.trail.textured && t < this.lastShed;
    this.soot.mesh.visible = this.soot.textured && t < this.lastShed;
    this.gouts.mesh.visible = this.gouts.textured && t < this.lastShed;
  }

  /** How many flames can stand on the bird. */
  get capacity(): number { return this.flames.length; }

  /**
   * Stands the flames on something else (the model's bones): their sizes, heats and loops; as many as there is
   * room for. Their places are then given each frame to {@link updateOn}.
   */
  standOn(flames: readonly { size: number; heat: number; frame: number; seed: number }[]): void {
    const fps = VFX_ATLASES.fire.fps;
    this.standing = Math.min(flames.length, this.flames.length);
    for (let i = 0; i < this.flames.length; i += 1) {
      const flame = flames[i];
      if (i < this.standing) this.blaze.write(i, [0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 0, 0], [0, 0, flame.frame, fps], [flame.heat, 0, 0.86, flame.seed]);
      else this.blaze.write(i, [0, 0, 0, 0], [0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, fps], [0, 0, 0, 0]);
    }
    this.flames = flames.slice(0, this.standing).map((flame) => ({ spec: 0, cut: 0, size: flame.size, heat: flame.heat, frame: flame.frame, seed: flame.seed }));
  }

  /**
   * As {@link update}, with each standing flame's place asked of `place` (it writes the place and returns how hot the
   * flame burns there, 0 for not at all).
   */
  updateOn(t: number, place: (index: number, out: THREE.Vector3) => number, stream: readonly number[], shown: number): void {
    const data = this.blaze.data, at = this.at;
    let any = false;
    for (let i = 0; i < this.standing; i += 1) {
      const flame = this.flames[i], o = i * STRIDE, heat = place(i, at), on = heat > 0 ? shown : 0;
      data[o] = at.x; data[o + 1] = at.y; data[o + 2] = at.z;
      data[o + 3] = flame.size * on;
      data[o + 8] = stream[0]; data[o + 9] = stream[1]; data[o + 10] = stream[2];
      data[o + 16] = flame.heat * heat;
      data[o + 17] = 0.75 * on;
      if (on > 0.001) any = true;
    }
    this.blaze.buffer.needsUpdate = true;
    this.blaze.mesh.visible = any && this.blaze.textured;
    this.trail.mesh.visible = this.trail.textured && t < this.lastShed;
    this.soot.mesh.visible = this.soot.textured && t < this.lastShed;
    this.gouts.mesh.visible = this.gouts.textured && t < this.lastShed;
  }

  private readonly at = new THREE.Vector3();

  dispose(): void {
    this.blaze.dispose(); this.trail.dispose(); this.soot.dispose(); this.gouts.dispose();
    this.object.removeFromParent();
  }
}
