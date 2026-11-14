/**
 * Flipbook effects: smoke, fire, bursts and dust baked from volumetric
 * simulations into atlases (see docs/play/VFX_LIBRARY.md), drawn as
 * camera-facing quads.
 *
 * One InstancedMesh, one quad and one material per atlas. Capacity is fixed by
 * the quality preset; a spawn writes one slot of a preallocated buffer and
 * allocates nothing. The vertex shader evaluates frame, motion and fades from
 * the effect clock (the formulas of flipbookCore.ts), so there is no per-sprite
 * work on the CPU each frame: `update` advances one uniform per atlas and
 * returns finished slots to their pool.
 *
 * sceneEngine.ts owns the one instance in a match; wiring.ts decides what plays where.
 */
import * as THREE from "three";
import type { QualityPreset } from "../quality";
import {
  FLIPBOOK_BUDGET,
  FLIPBOOK_FIELD,
  FLIPBOOK_STRIDE,
  FlipbookPool,
  type FlipbookBudget,
  type FlipbookSpawn,
} from "./flipbookCore";
import { VFX_ATLASES, VFX_RECIPES, type VfxAtlas, type VfxEffectId, type VfxRecipeId } from "./library";

const VERTEX = /* glsl */ `
attribute vec4 aTransform; // x, y, z, size
attribute vec4 aMotion;    // velocity, growth
attribute vec4 aTiming;    // start, fps, life, frame offset
attribute vec4 aLook;      // rotation, spin, flip, alpha
attribute vec4 aTint;      // rgb, additive
attribute vec4 aFade;      // fade in, fade out, soft distance, mono (past 1: a recoloured fire's heat)
uniform float uTime;
uniform vec4 uGrid;        // cols, rows, frames, loop
uniform vec2 uPivot;       // where the spawn point sits in the cell, v up from the bottom
varying vec2 vUv0;
varying vec2 vUv1;
varying float vBlend;
varying vec4 vTint;
varying float vAlpha;
varying float vSoft;
varying float vMono;
varying float vWorldY;
varying float vViewZ;

vec2 cell(float index, vec2 at) {
  float col = mod(index, uGrid.x);
  float row = floor(index / uGrid.x + 1e-4);
  // v runs up in the texture, the atlas is laid out top-down.
  return vec2((col + at.x) / uGrid.x, 1.0 - (row + 1.0 - at.y) / uGrid.y);
}

void main() {
  float age = uTime - aTiming.x;
  float life = aTiming.z;
  float alive = step(0.0, age) * step(age, life - 1e-5);
  float frames = uGrid.z;
  float cursor = max(age, 0.0) * aTiming.y + aTiming.w;
  float index;
  float next;
  if (uGrid.w > 0.5) {
    cursor = mod(cursor, frames);
    index = min(floor(cursor), frames - 1.0);
    next = mod(index + 1.0, frames);
    vBlend = cursor - index;
  } else {
    cursor = min(cursor, frames - 1.0);
    index = floor(cursor);
    next = min(index + 1.0, frames - 1.0);
    vBlend = cursor - index;
  }
  vec2 at = vec2(aLook.z < 0.0 ? 1.0 - uv.x : uv.x, uv.y);
  vUv0 = cell(index, at);
  vUv1 = cell(next, at);

  float rise = aFade.x > 0.0 ? smoothstep(0.0, 1.0, age / aFade.x) : 1.0;
  float fall = aFade.y > 0.0 ? smoothstep(0.0, 1.0, (life - age) / aFade.y) : 1.0;
  vAlpha = aLook.w * rise * fall * alive;
  vTint = aTint;
  vSoft = aFade.z;
  vMono = aFade.w;

  float size = aTransform.w * max(0.0, 1.0 + aMotion.w * age) * alive;
  float angle = aLook.x + aLook.y * age;
  vec2 corner = (uv - uPivot) * size;
  float c = cos(angle);
  float s = sin(angle);
  corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);

  vec3 centre = (modelMatrix * vec4(aTransform.xyz + aMotion.xyz * age, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = centre + right * corner.x + up * corner.y;
  vWorldY = world.y;
  vec4 view = viewMatrix * vec4(world, 1.0);
  vViewZ = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uGroundY;
#ifdef SOFT_DEPTH
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec2 uNearFar;
#endif
varying vec2 vUv0;
varying vec2 vUv1;
varying float vBlend;
varying vec4 vTint;
varying float vAlpha;
varying float vSoft;
varying float vMono;
varying float vWorldY;
varying float vViewZ;

// Fire recoloured keeps its heat. Reduced to brightness, a baked flame is one flat level from fringe to heart (its red
// is near full everywhere), and a spell's flames read as a coloured haze. Its heat is in its green, which rises from
// the red fringe to the yellow-white heart; past mono 1 that is burnt through three stops of the tint, by the amount
// past 1: a deeper, more saturated fringe, the tint itself, and a white heart brighter than either. White is a level,
// not a hue, so it reads as the hottest part of any army's fire.
vec3 hotTint(vec3 tint, float green, float amount) {
  float peak = max(tint.r, max(tint.g, tint.b));
  float heat = smoothstep(0.15, 0.8, green);
  vec3 hue = mix(tint * tint / max(peak, 1e-4) * 0.55, tint, smoothstep(0.0, 0.5, heat));
  return mix(tint, mix(hue, vec3(peak * 1.4), smoothstep(0.45, 1.0, heat)), clamp(amount, 0.0, 1.0));
}

void main() {
  vec4 texel = texture2D(map, vUv0);
  #ifdef FRAME_BLEND
  texel = mix(texel, texture2D(map, vUv1), vBlend);
  #endif
  // Held at 1: a recipe may ask for more than 1 to thicken a thin frame's body and rim (step dust), and past 1 the
  // premultiplied blend would take away more of what lies behind than it covers.
  float alpha = min(texel.a * vAlpha, 1.0);
  #ifdef SOFT_GROUND
  if (vSoft > 0.0) alpha *= smoothstep(0.0, vSoft, vWorldY - uGroundY);
  #endif
  #ifdef SOFT_DEPTH
  if (vSoft > 0.0) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
    float ndc = d * 2.0 - 1.0;
    float scene = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - ndc * (uNearFar.y - uNearFar.x));
    alpha *= clamp((scene - vViewZ) / vSoft, 0.0, 1.0);
  }
  #endif
  if (alpha <= 0.001) discard;
  // The brightest channel, not luminance: a flame's red core must stay bright when recoloured.
  vec3 colour = mix(texel.rgb, vec3(max(texel.r, max(texel.g, texel.b))), min(vMono, 1.0));
  vec3 tint = vMono > 1.0 ? hotTint(vTint.rgb, texel.g, vMono - 1.0) : vTint.rgb;
  // Premultiplied output: additive 0 composites like smoke, additive 1 only adds light.
  gl_FragColor = vec4(colour * tint * alpha, alpha * (1.0 - vTint.a));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A scene depth buffer to fade sprites against (soft particles). Optional. */
export interface FlipbookDepth {
  texture: THREE.Texture;
  /** Size of the depth texture's render target in pixels. */
  width: number;
  height: number;
  near: number;
  far: number;
}

/** One atlas: its instanced quad, its material and its pool. */
export class FlipbookLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly pool: FlipbookPool;
  private readonly material: THREE.ShaderMaterial;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private disposed = false;

  constructor(readonly atlas: VfxAtlas, readonly budget: FlipbookBudget, texture: THREE.Texture | null, groundY: number) {
    this.pool = new FlipbookPool(atlas, budget.instances);
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.pool.data, FLIPBOOK_STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const field = (name: string, offset: number) =>
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, 4, offset));
    field("aTransform", FLIPBOOK_FIELD.transform);
    field("aMotion", FLIPBOOK_FIELD.motion);
    field("aTiming", FLIPBOOK_FIELD.timing);
    field("aLook", FLIPBOOK_FIELD.look);
    field("aTint", FLIPBOOK_FIELD.tint);
    field("aFade", FLIPBOOK_FIELD.fade);

    const defines: Record<string, string> = {};
    if (budget.frameBlend) defines.FRAME_BLEND = "";
    if (budget.softGround) defines.SOFT_GROUND = "";
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines,
      uniforms: {
        map: { value: texture },
        uTime: { value: 0 },
        uGrid: { value: new THREE.Vector4(atlas.cols, atlas.rows, atlas.frames, atlas.loop ? 1 : 0) },
        uPivot: { value: new THREE.Vector2(atlas.pivot[0], atlas.pivot[1]) },
        uGroundY: { value: groundY },
        uDepth: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.1, 100) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    // The pool can be empty on a preset with no budget; an InstancedMesh needs at least one slot.
    this.mesh = new THREE.InstancedMesh(geometry, this.material, Math.max(1, this.pool.capacity));
    this.mesh.count = this.pool.capacity;
    this.mesh.name = `flipbook:${atlas.id}`;
    // Sprites are placed by the shader, so the mesh's own bounds mean nothing.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = atlas.renderOrder;
    this.mesh.visible = false;
  }

  setTexture(texture: THREE.Texture | null): void {
    this.material.uniforms.map.value = texture;
  }

  setGround(y: number): void {
    this.material.uniforms.uGroundY.value = y;
  }

  /** Fade against a scene depth texture as well as the board. Ignored where the budget has no `softDepth`. */
  setDepth(depth: FlipbookDepth | null): void {
    const on = !!depth && this.budget.softDepth;
    const u = this.material.uniforms;
    u.uDepth.value = on ? depth!.texture : null;
    if (on) {
      (u.uResolution.value as THREE.Vector2).set(depth!.width, depth!.height);
      (u.uNearFar.value as THREE.Vector2).set(depth!.near, depth!.far);
    }
    const had = "SOFT_DEPTH" in this.material.defines;
    if (on !== had) {
      if (on) this.material.defines.SOFT_DEPTH = "";
      else delete this.material.defines.SOFT_DEPTH;
      this.material.needsUpdate = true;
    }
  }

  spawn(now: number, spec: FlipbookSpawn): number {
    return this.disposed ? -1 : this.pool.spawn(now, spec);
  }

  /** Uploads what changed, advances the clock and frees finished slots. */
  update(now: number): void {
    if (this.disposed) return;
    const pool = this.pool;
    if (pool.dirtyTo > pool.dirtyFrom) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(pool.dirtyFrom * FLIPBOOK_STRIDE, (pool.dirtyTo - pool.dirtyFrom) * FLIPBOOK_STRIDE);
      this.buffer.needsUpdate = true;
      pool.flushed();
    }
    this.material.uniforms.uTime.value = now;
    // Nothing alive and no texture yet: skip the draw call altogether.
    this.mesh.visible = pool.expire(now) > 0 && this.material.uniforms.map.value !== null;
  }

  /** Frees the geometry and material. The texture belongs to whoever loaded it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pool.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

export interface FlipbookSystemOptions {
  /** Folder holding the atlases, with a trailing slash (the game serves them at `assets/play/vfx/`). */
  baseUrl: string;
  quality: QualityPreset;
  /** Overrides the preset's budget (the Quest build passes FLIPBOOK_QUEST_BUDGET). */
  budget?: FlipbookBudget;
  /** World height of the board's top face: sprites with a soft distance fade into it. */
  groundY?: number;
  /** Anisotropy and the like are left alone; supply a loader to share a LoadingManager. */
  loader?: THREE.TextureLoader;
}

export interface VfxPlayOptions {
  /** Multiplies the recipe's size. */
  scale?: number;
  /** Multiplies the recipe's tint, e.g. by the scene's key light colour. */
  tint?: THREE.Color;
  /**
   * Replaces each sprite's tint with this colour, at the sprite's own brightness (its tint's strongest
   * channel). For a recipe reduced to brightness (`mono`), whose colour is its tint alone: every layer takes
   * the one hue, where multiplying would leave each layer its own (a spell burst in its army's colour).
   */
  colour?: THREE.Color;
  alpha?: number;
  delay?: number;
  /** Direction the effect leaves in (a musket's muzzle direction). Recipes with a `push` drift along it. */
  direction?: THREE.Vector3;
  /** Play only the first `parts` sprites of the recipe (the low preset, the menu's board). */
  parts?: number;
  /**
   * Reduced motion: each sprite holds one frame part-way through its clip, with no drift, growth or spin,
   * and fades in and out over about half a second. Nothing moves; a puff is simply there and gone.
   */
  still?: boolean;
  /** Seconds each sprite lives. Gives a loop (mist) an end of its own, so nothing has to be released. */
  life?: number;
  /**
   * How bright the scene's light makes a white surface, 0 to 1 (1: as baked). Smoke and dust were lit white
   * and stored grey, so their tint is multiplied by this.
   */
  light?: number;
  /**
   * The same for sprites that add their own light (fire, a flare), 0 to 1: a scene drawn at a high exposure
   * multiplies a flame as it does everything else, and the flame clips to white unless it is brought down.
   * A sprite between the two (the explosion: soot and fireball) takes a blend by its `additive`.
   */
  glow?: number;
}

/** A still puff's life and fades, in seconds, and how far into its clip the held frame is. */
const STILL = { life: 0.5, fadeIn: 0.1, fadeOut: 0.32, frame: 0.3 } as const;

const HANDLE_SPAN = 1 << 22;

/**
 * Every flipbook effect in the scene. Add {@link group} to the scene, call
 * {@link update} once per frame, and {@link dispose} with the scene.
 */
export class FlipbookSystem {
  readonly group = new THREE.Group();
  private readonly ids: VfxEffectId[] = [];
  private readonly layers = new Map<VfxEffectId, FlipbookLayer>();
  private readonly textures = new Map<VfxEffectId, THREE.Texture>();
  private readonly loading = new Map<VfxEffectId, Promise<void>>();
  private readonly loader: THREE.TextureLoader;
  private readonly baseUrl: string;
  private readonly spec: FlipbookSpawn = { x: 0, y: 0, z: 0, size: 1 };
  private budget: FlipbookBudget;
  private groundY: number;
  private depth: FlipbookDepth | null = null;
  private clock = 0;
  private epoch = 0;
  private disposed = false;

  constructor(options: FlipbookSystemOptions) {
    this.baseUrl = options.baseUrl;
    this.budget = options.budget ?? FLIPBOOK_BUDGET[options.quality];
    this.groundY = options.groundY ?? 0;
    this.loader = options.loader ?? new THREE.TextureLoader();
    this.group.name = "flipbook-vfx";
  }

  /** The effect clock in seconds. Spawns and releases are timed against it. */
  get time(): number {
    return this.clock;
  }

  /** Loads atlases ahead of the first spawn (all of them when no ids are given). */
  preload(ids: readonly VfxEffectId[] = Object.keys(VFX_ATLASES) as VfxEffectId[]): Promise<void> {
    return Promise.all(ids.map((id) => this.load(id))).then(() => undefined);
  }

  /**
   * Builds these atlases' layers now (made on their first spawn otherwise) and loads them, so the caller can compile
   * the group and upload the atlases before they are needed (SceneEngine.warmEffects). Resolves with the atlases that
   * arrived.
   */
  prepare(ids: readonly VfxEffectId[]): Promise<THREE.Texture[]> {
    if (this.disposed) return Promise.resolve([]);
    for (const id of ids) this.layer(id);
    return this.preload(ids).then(() => ids.flatMap((id) => this.textures.get(id) ?? []));
  }

  /**
   * Starts one sprite of an atlas. Returns a handle for {@link release}, or -1
   * when the system is disposed or the preset has no budget. The atlas loads on
   * first use; a sprite spawned before it arrives simply appears late.
   */
  spawn(effect: VfxEffectId, spec: FlipbookSpawn): number {
    if (this.disposed) return -1;
    const layer = this.layer(effect);
    const handle = layer.spawn(this.clock, spec);
    return handle < 0 ? -1 : this.ids.indexOf(effect) * HANDLE_SPAN + handle;
  }

  /** Plays a named recipe (musket smoke, fall dust, ...) at a world position. Returns the last sprite's handle. */
  play(recipe: VfxRecipeId, position: THREE.Vector3, options: VfxPlayOptions = {}): number {
    const parts = VFX_RECIPES[recipe];
    const scale = options.scale ?? 1;
    const spec = this.spec;
    const count = Math.min(parts.length, Math.max(0, options.parts ?? parts.length));
    const still = options.still === true;
    let handle = -1;
    for (let i = 0; i < count; i++) {
      const part = parts[i];
      const push = still ? 0 : part.push ?? 0;
      const additive = part.additive ?? VFX_ATLASES[part.effect].additive;
      const light = (options.light ?? 1) * (1 - additive) + (options.glow ?? 1) * additive;
      spec.x = position.x; spec.y = position.y + (part.lift ?? 0) * scale; spec.z = position.z;
      spec.size = part.size * scale;
      spec.delay = (options.delay ?? 0) + (part.delay ?? 0);
      spec.fps = still ? 0 : part.fps;
      spec.life = still ? STILL.life : options.life ?? part.life;
      spec.frameOffset = still ? Math.floor(VFX_ATLASES[part.effect].frames * STILL.frame) : part.frameOffset;
      spec.vx = (options.direction?.x ?? 0) * push;
      spec.vy = (still ? 0 : part.rise ?? 0) + (options.direction?.y ?? 0) * push;
      spec.vz = (options.direction?.z ?? 0) * push;
      spec.growth = still ? 0 : part.growth;
      spec.rotation = part.rotation;
      spec.spin = still ? 0 : part.spin;
      spec.flip = part.flip;
      spec.alpha = (part.alpha ?? 1) * (options.alpha ?? 1);
      const colour = options.colour;
      const bright = colour ? Math.max(part.tint[0], part.tint[1], part.tint[2]) : 1;
      spec.r = (colour ? colour.r * bright : part.tint[0]) * (options.tint?.r ?? 1) * light;
      spec.g = (colour ? colour.g * bright : part.tint[1]) * (options.tint?.g ?? 1) * light;
      spec.b = (colour ? colour.b * bright : part.tint[2]) * (options.tint?.b ?? 1) * light;
      spec.additive = additive;
      spec.fadeIn = still ? STILL.fadeIn : part.fadeIn;
      spec.fadeOut = still ? STILL.fadeOut : part.fadeOut;
      spec.soft = part.soft;
      spec.mono = part.mono;
      handle = this.spawn(part.effect, spec);
    }
    return handle;
  }

  /** Stops a sprite (how a looping fire or mist ends), fading over `fade` seconds. */
  release(handle: number, fade = 0.4): boolean {
    if (this.disposed || handle < 0) return false;
    const layer = this.layers.get(this.ids[Math.floor(handle / HANDLE_SPAN)]);
    return layer ? layer.pool.release(handle % HANDLE_SPAN, this.clock, fade) : false;
  }

  /** Advance by `delta` seconds. Call once per rendered frame. */
  update(delta: number): void {
    if (this.disposed) return;
    this.clock += Math.max(0, delta);
    for (const layer of this.layers.values()) layer.update(this.clock);
  }

  /** Sprite slots the current budget gives each atlas. */
  get capacity(): number {
    return this.budget.instances;
  }

  /** Sprites alive across every atlas. */
  get active(): number {
    let n = 0;
    for (const layer of this.layers.values()) n += layer.pool.active;
    return n;
  }

  setGround(y: number): void {
    this.groundY = y;
    for (const layer of this.layers.values()) layer.setGround(y);
  }

  /** Supply (or withdraw, with null) a scene depth texture for soft particles. */
  setDepth(depth: FlipbookDepth | null): void {
    this.depth = depth;
    for (const layer of this.layers.values()) layer.setDepth(depth);
  }

  /**
   * Switches budget. Live sprites are dropped and their handles are void: pools
   * are rebuilt at the new capacity and atlases reloaded if the preset uses the
   * other size. Restart any loops (fires, mist) afterwards.
   */
  setQuality(quality: QualityPreset, budget: FlipbookBudget = FLIPBOOK_BUDGET[quality]): void {
    if (this.disposed || budget === this.budget) return;
    const reload = budget.tier !== this.budget.tier;
    this.budget = budget;
    this.dropLayers();
    if (reload) this.dropTextures();
  }

  /** Everything in the air is gone at once (Undo, reset). Atlases stay loaded. */
  clear(): void {
    for (const layer of this.layers.values()) {
      layer.pool.clear();
      layer.update(this.clock);
    }
  }

  /** Frees every mesh, material and texture. The system does nothing afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dropLayers();
    this.dropTextures();
    this.group.removeFromParent();
  }

  private layer(effect: VfxEffectId): FlipbookLayer {
    let layer = this.layers.get(effect);
    if (!layer) {
      if (!this.ids.includes(effect)) this.ids.push(effect);
      layer = new FlipbookLayer(VFX_ATLASES[effect], this.budget, this.textures.get(effect) ?? null, this.groundY);
      layer.setDepth(this.depth);
      this.layers.set(effect, layer);
      this.group.add(layer.mesh);
      void this.load(effect);
    }
    return layer;
  }

  private load(effect: VfxEffectId): Promise<void> {
    if (this.disposed || this.textures.has(effect)) return Promise.resolve();
    let pending = this.loading.get(effect);
    if (!pending) {
      const epoch = this.epoch;
      const url = this.baseUrl + VFX_ATLASES[effect].files[this.budget.tier];
      pending = this.loader.loadAsync(url).then(
        (texture) => {
          // Disposed, or the tier changed, while the image was on its way.
          if (this.disposed || epoch !== this.epoch) { texture.dispose(); return; }
          this.loading.delete(effect);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = true;
          texture.needsUpdate = true;
          this.textures.set(effect, texture);
          this.layers.get(effect)?.setTexture(texture);
        },
        (error) => {
          if (epoch === this.epoch) this.loading.delete(effect);
          console.warn(`[vfx] could not load ${url}`, error);
        },
      );
      this.loading.set(effect, pending);
    }
    return pending;
  }

  private dropLayers(): void {
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
  }

  private dropTextures(): void {
    this.epoch++;
    this.loading.clear();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
