/**
 * The Knight's vault, drawn (knightVaultPlan.ts says when and how much): the ink wings that sweep up either side of it
 * in the air, the streaks of light across it and the X of blade-light at the top, the flakes it throws (a stagger's, a
 * strike's spray that hangs in the hit-stop, the swirl at its feet), and the thin ring of light that runs out round it
 * at the end. Everything is in the attacking kingdom's colours (VAULT_LOOK).
 *
 * Every pool is allocated for the quality preset when the scene is made, and again only when the preset changes; a
 * frame and a spawn write into what is there, and when a pool is full the oldest slot is taken. The scene's own time
 * scale (the hit-stop, a fatality's slow motion) reaches it through the delta it is given, so a spray hangs with the
 * blow. No randomness but the dice a spawn is handed (the match's show dice).
 *
 * The brush stroke the wings are drawn with is painted in code once (an array of dry bristles on a canvas).
 */
import * as THREE from "three";
import type { QualityPreset } from "../quality";
import { sequence, type Dice } from "../vfx/spells/shared/particlePlan";
import { VAULT_BUDGET, type VaultBudget, type VaultLook } from "./knightVaultPlan";

/** What is alive, for browser checks: all zero once a board is rebuilt. */
export interface VaultFxStats { wings: number; streaks: number; flakes: number; rings: number; budget: VaultBudget }

/** Writes where a wing is rooted (the Knight's chest) into `out`; null when the figure cannot be found. */
export type VaultChestSampler = (out: THREE.Vector3) => THREE.Vector3 | null;

const PREMULTIPLIED = {
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
} as const;

// ------------------------------------------------------------------------------------------------------ the brush

/** A stroke of dry brush, painted once: bristles along its length (x), ragged and broken toward its tail. */
function brushTexture(): THREE.Texture {
  const width = 512, height = 128;
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) return new THREE.CanvasTexture(canvas);
  const dice = sequence(0x1b7a5e);
  g.clearRect(0, 0, width, height);
  // The body: a soft wash under the bristles, so the stroke has no holes through its middle.
  const wash = g.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, "rgba(255,255,255,0)"); wash.addColorStop(0.2, "rgba(255,255,255,0.3)");
  wash.addColorStop(0.8, "rgba(255,255,255,0.3)"); wash.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = wash;
  g.fillRect(0, 0, width * 0.7, height);
  // The bristles: each a line across the length, starting and ending at its own point, broken more toward the tail.
  for (let i = 0; i < 90; i += 1) {
    const y = height * (0.06 + 0.88 * dice());
    const alpha = 0.35 + 0.65 * dice();
    const thick = 1 + dice() * 3.2;
    let x = width * 0.02 * dice();
    const end = width * (0.62 + 0.38 * dice());
    g.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    g.lineWidth = thick;
    while (x < end) {
      const tail = x / width;
      const run = width * (0.08 + 0.3 * dice()) * (1.2 - tail);
      const gap = width * (0.004 + 0.05 * dice() * tail * tail);
      g.beginPath();
      g.moveTo(x, y + (dice() - 0.5) * 2);
      g.lineTo(Math.min(end, x + run), y + (dice() - 0.5) * 3);
      g.stroke();
      x += run + gap;
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

// ------------------------------------------------------------------------------------------------------ the wings

const WING_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vY;
void main() { vUv = uv; vec4 world = modelMatrix * vec4(position, 1.0); vY = world.y; gl_Position = projectionMatrix * viewMatrix * world; }
`;
const WING_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uInk, uEdge, uCore;
uniform float uReveal, uOpacity, uGain, uFloor;
varying vec2 vUv;
varying float vY;
void main() {
  float bristle = texture2D(uMap, vUv).a;
  // drawn from the root outward: the stroke's front is soft and a little ragged
  float front = 1.0 - smoothstep(uReveal - 0.1, uReveal, vUv.x + (bristle - 0.5) * 0.06);
  // the bright edge along the outer side of the stroke, broken by the same bristles, and streaks of it into the ink
  float rim = smoothstep(0.42, 0.86, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
  float hot = smoothstep(0.74, 0.88, vUv.y) * (1.0 - smoothstep(0.9, 0.97, vUv.y));
  float streak = step(0.82, bristle) * smoothstep(0.15, 0.6, vUv.y);
  float cover = bristle * front * uOpacity;
  vec3 light = uInk * cover + (uEdge * (rim * 0.85 + streak * 0.35) + uCore * hot * 0.9) * bristle * front * uOpacity * uGain;
  cover *= smoothstep(uFloor, uFloor + 0.03, vY);
  light *= smoothstep(uFloor, uFloor + 0.03, vY);
  if (cover < 0.004) discard;
  gl_FragColor = vec4(light, min(1.0, cover * 0.95));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Wing {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  material: THREE.ShaderMaterial;
  side: 1 | -1;
}

// ------------------------------------------------------------------------------------------------------ streaks

const STREAK_VERTEX = /* glsl */ `
attribute vec2 aUv;
attribute float aAlpha;
attribute vec3 aColor, aCore;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor, vCore;
void main() { vUv = aUv; vAlpha = aAlpha; vColor = aColor; vCore = aCore; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }
`;
const STREAK_FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor, vCore;
void main() {
  float v = vUv.y;
  float core = exp(-v * v * 18.0), halo = exp(-v * v * 2.6) * 0.45;
  float taper = pow(max(0.0, sin(3.14159265 * clamp(vUv.x, 0.0, 1.0))), 0.45);
  vec3 light = (vCore * core + vColor * halo) * taper * vAlpha * uGain;
  if (max(max(light.r, light.g), light.b) < 0.002) discard;
  gl_FragColor = vec4(light, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Streak {
  live: boolean;
  a: THREE.Vector3; b: THREE.Vector3;
  width: number; life: number; age: number; delay: number;
  /** A travelling streak runs its light from `a` to `b`; a fixed one (the X) opens out from its middle and holds. */
  fixed: boolean;
  color: THREE.Color; core: THREE.Color;
  birth: number;
}

// ------------------------------------------------------------------------------------------------------ flakes

const FLAKE_VERTEX = /* glsl */ `
attribute vec2 aUv;
attribute float aAlpha, aSeed;
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha, vSeed;
varying vec3 vColor;
void main() { vUv = aUv; vAlpha = aAlpha; vSeed = aSeed; vColor = aColor; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }
`;
const FLAKE_FRAGMENT = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
varying float vAlpha, vSeed;
varying vec3 vColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  // a torn scrap: a quad whose edges are bitten in at a few points of its own
  vec2 p = vUv;
  float angle = atan(p.y, p.x);
  float bite = 0.0;
  for (int k = 0; k < 4; k++) { float a = hash(vSeed * 7.1 + float(k)) * 6.2832; bite += 0.18 * hash(vSeed * 3.3 + float(k)) * max(0.0, cos(angle - a) * 2.0 - 1.0); }
  float box = max(abs(p.x), abs(p.y)) + bite;
  float a = (1.0 - smoothstep(0.78, 0.9, box)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a * uGain, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Flake {
  live: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number; life: number; size: number; stretch: number;
  spin: number; spinRate: number;
  gravity: number; drag: number;
  color: THREE.Color;
  seed: number;
  birth: number;
  /** Swirling round `centre` until `throwAt`, then thrown out free. */
  swirl: { centre: THREE.Vector3; radius: number; angle: number; rate: number; rise: number; throwAt: number } | null;
}

// ------------------------------------------------------------------------------------------------------ the ring

const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uEdge, uCore;
uniform float uRadius, uWidth, uExtent, uAlpha, uGain;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0) * uExtent;
  float d = (r - uRadius) / uWidth;
  float core = exp(-d * d * 1.2), halo = exp(-d * d * 0.05) * 0.32;
  // a faint wash inside it, where it has passed
  float wash = (1.0 - smoothstep(0.0, uRadius, r)) * 0.05;
  vec3 light = (uCore * core + uEdge * (halo + wash)) * uAlpha * uGain;
  if (max(max(light.r, light.g), light.b) < 0.002) discard;
  gl_FragColor = vec4(light, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Ring {
  live: boolean;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number; seconds: number; radius: number; calm: boolean;
}

// ------------------------------------------------------------------------------------------------------ the effects

export class KnightVaultEffects {
  readonly object = new THREE.Group();
  private preset: QualityPreset;
  private budget: VaultBudget;
  private readonly floor: number;
  private gain = 1;
  private time = 0;
  private disposed = false;
  private brush: THREE.Texture | null = null;

  private wings: Wing[] = [];
  private wingSample: VaultChestSampler | null = null;
  private wingAge = 0;
  private wingHold = 0;
  private wingFade = -1;
  private wingLive = false;

  private streaks: Streak[] = [];
  private streakGeometry!: THREE.BufferGeometry;
  private streakMaterial!: THREE.ShaderMaterial;
  private streakMesh!: THREE.Mesh;

  private flakes: Flake[] = [];
  private flakeGeometry!: THREE.BufferGeometry;
  private flakeMaterial!: THREE.ShaderMaterial;
  private flakeMesh!: THREE.Mesh;

  private ring!: Ring;

  private readonly chest = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly across = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly d01 = new THREE.Vector3();
  private readonly d12 = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly tail = new THREE.Vector3();

  constructor(options: { quality: QualityPreset; boardTop: number }) {
    this.object.name = "KnightVault";
    this.preset = options.quality;
    this.budget = VAULT_BUDGET[options.quality];
    this.floor = options.boardTop;
    this.build();
  }

  get stats(): VaultFxStats {
    return {
      wings: this.wingLive ? this.wings.length : 0, streaks: this.streaks.filter(s => s.live).length,
      flakes: this.flakes.filter(f => f.live).length, rings: this.ring.live ? 1 : 0, budget: this.budget,
    };
  }

  /** The gain light takes in this exposure (vfxGlow). */
  setGain(glow: number): void { this.gain = Number.isFinite(glow) && glow > 0 ? glow : 1; }

  // ------------------------------------------------------------------ wings

  /**
   * Two brush strokes of ink sweep up either side of the figure `sample` finds, drawn out from its back over a fifth of
   * a second, held `seconds` and let go over a quarter. They spread across the frame, whichever way it is seen from.
   */
  beginWings(sample: VaultChestSampler, look: VaultLook, seconds: number): void {
    if (this.disposed) return;
    this.wingSample = sample; this.wingAge = 0; this.wingHold = Math.max(0.1, seconds); this.wingFade = -1; this.wingLive = true;
    for (const wing of this.wings) {
      const u = wing.material.uniforms;
      (u.uInk.value as THREE.Color).setHex(look.ink);
      (u.uEdge.value as THREE.Color).setHex(look.edge);
      (u.uCore.value as THREE.Color).setHex(look.core);
      u.uReveal.value = 0; u.uOpacity.value = 1;
    }
  }

  /** The wings are let go now, over `fade` seconds. */
  endWings(fade = 0.22): void {
    if (this.wingLive && this.wingFade < 0) { this.wingFade = 0; this.wingHold = Math.max(0.05, fade); }
  }

  // ------------------------------------------------------------------ light

  /** A streak of light runs from `from` to `to` over `life` seconds, `delay` from now, `width` wide. */
  streak(from: THREE.Vector3, to: THREE.Vector3, look: VaultLook, options: { width?: number; life?: number; delay?: number } = {}): void {
    const slot = this.takeStreak();
    if (!slot) return;
    slot.a.copy(from); slot.b.copy(to);
    slot.width = options.width ?? 0.035; slot.life = Math.max(0.05, options.life ?? 0.16); slot.delay = Math.max(0, options.delay ?? 0);
    slot.age = 0; slot.fixed = false; slot.live = true; slot.birth = this.time;
    slot.color.setHex(look.edge); slot.core.setHex(look.core);
  }

  /**
   * Two lines of blade-light crossed in an X through `centre`, square to the eye: they open out from the middle almost
   * at once, hold and fade.
   */
  cross(centre: THREE.Vector3, eye: THREE.Vector3, look: VaultLook, options: { size?: number; life?: number } = {}): void {
    const size = options.size ?? 1.3, life = options.life ?? 0.34;
    this.view.copy(eye).sub(centre).normalize();
    this.right.set(0, 1, 0).cross(this.view);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.camUp.copy(this.view).cross(this.right).normalize();
    for (const sign of [1, -1]) {
      const slot = this.takeStreak();
      if (!slot) return;
      // Steeper than 45 degrees, as two blades crossed overhead.
      this.scratch.copy(this.right).multiplyScalar(0.62 * sign).addScaledVector(this.camUp, 0.78).normalize().multiplyScalar(size / 2);
      slot.a.copy(centre).sub(this.scratch); slot.b.copy(centre).add(this.scratch);
      slot.width = 0.075; slot.life = life; slot.delay = sign > 0 ? 0 : 0.03; slot.age = 0; slot.fixed = true; slot.live = true; slot.birth = this.time;
      slot.color.setHex(look.edge); slot.core.setHex(look.core);
    }
  }

  // ------------------------------------------------------------------ flakes

  /**
   * `count` flakes thrown out of `at`, mostly along `direction` (and up), at about `speed`, drifting on the air as torn
   * paper does: light gravity and a lot of drag, so they hang a while where the blow threw them.
   */
  spray(at: THREE.Vector3, direction: THREE.Vector3, count: number, look: VaultLook, seed: number, options: { speed?: number; spread?: number; life?: number; size?: number; gravity?: number; drag?: number } = {}): number {
    const dice = sequence(seed >>> 0 || 1);
    const speed = options.speed ?? 2.2, spread = options.spread ?? 0.75, life = options.life ?? 1.3, size = options.size ?? 0.034;
    const flat = this.scratch.copy(direction); if (flat.lengthSq() < 1e-8) flat.set(0, 0, 1); flat.normalize();
    let made = 0;
    for (let i = 0; i < count; i += 1) {
      const slot = this.takeFlake();
      if (!slot) break;
      slot.position.copy(at);
      slot.velocity.set(flat.x + (dice() - 0.5) * 2 * spread, flat.y + 0.35 + dice() * 0.7, flat.z + (dice() - 0.5) * 2 * spread).normalize().multiplyScalar(speed * (0.45 + 0.75 * dice()));
      this.dress(slot, dice, look, life, size, options.gravity ?? 1.1, options.drag ?? 2.6);
      made += 1;
    }
    return made;
  }

  /**
   * `count` flakes swirling round the feet at `centre`, rising as they go round, for `seconds`, then thrown out flat
   * across the stone as the ring runs out.
   */
  swirl(centre: THREE.Vector3, count: number, look: VaultLook, seed: number, options: { seconds?: number; radius?: number; calm?: boolean } = {}): number {
    const dice = sequence(seed >>> 0 || 1);
    const seconds = options.seconds ?? 0.5, radius = options.radius ?? 0.5, calm = options.calm === true;
    let made = 0;
    for (let i = 0; i < count; i += 1) {
      const slot = this.takeFlake();
      if (!slot) break;
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + dice() * 0.6;
      const r = radius * (0.55 + 0.6 * dice());
      slot.position.set(centre.x + Math.cos(angle) * r, centre.y + 0.04 + dice() * 0.1, centre.z + Math.sin(angle) * r);
      slot.velocity.set(0, 0, 0);
      this.dress(slot, dice, look, seconds + (calm ? 0.6 : 0.9), calm ? 0.028 : 0.032, calm ? 0.35 : 0.9, calm ? 3 : 2.2);
      slot.swirl = calm ? null : { centre: centre.clone(), radius: r, angle, rate: 5.5 + dice() * 3, rise: 0.25 + dice() * 0.35, throwAt: seconds * (0.85 + 0.3 * dice()) };
      if (calm) slot.velocity.set(Math.cos(angle) * 0.12, 0.08 + dice() * 0.08, Math.sin(angle) * 0.12);
      made += 1;
    }
    return made;
  }

  // ------------------------------------------------------------------ the ring

  /**
   * A thin ring of light runs out over the stone round `centre` to `radius` and fades over `seconds`. Calm: slower,
   * dimmer and softer, with nothing flashing (reduced motion).
   */
  beginRing(centre: THREE.Vector3, look: VaultLook, options: { radius?: number; seconds?: number; calm?: boolean } = {}): void {
    if (this.disposed) return;
    const ring = this.ring;
    ring.live = true; ring.age = 0; ring.seconds = Math.max(0.2, options.seconds ?? 0.68); ring.radius = options.radius ?? 0.9; ring.calm = options.calm === true;
    ring.mesh.position.set(centre.x, this.floor + 0.022, centre.z);
    (ring.material.uniforms.uEdge.value as THREE.Color).setHex(look.edge);
    (ring.material.uniforms.uCore.value as THREE.Color).setHex(ring.calm ? look.edge : look.core);
    ring.mesh.visible = true;
  }

  // ------------------------------------------------------------------ frame

  /** Advances everything by `seconds` (the board's clock) and lays it out for `camera`. */
  update(seconds: number, camera: THREE.Camera): void {
    if (this.disposed || !camera) return;
    const step = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    this.time += step;
    camera.updateMatrixWorld();
    this.camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    this.updateWings(step, camera);
    this.updateStreaks(step, camera);
    this.updateFlakes(step);
    this.updateRing(step);
  }

  /** A new preset: the pools are made again at its size. What was in the air goes. */
  setQuality(preset: QualityPreset): void {
    if (this.disposed || preset === this.preset) return;
    this.preset = preset; this.budget = VAULT_BUDGET[preset];
    this.teardown();
    this.build();
  }

  /** Everything goes at once: the board has been rebuilt, or the map or reduced motion is up. */
  clear(): void {
    if (this.disposed) return;
    this.wingLive = false; this.wingSample = null;
    for (const wing of this.wings) wing.mesh.visible = false;
    for (const streak of this.streaks) streak.live = false;
    for (const flake of this.flakes) { flake.live = false; flake.swirl = null; }
    this.ring.live = false; this.ring.mesh.visible = false;
    this.streakGeometry.setDrawRange(0, 0); this.flakeGeometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.teardown();
    this.brush?.dispose(); this.brush = null;
    this.disposed = true;
    this.object.removeFromParent();
  }

  // ------------------------------------------------------------------ inside

  private dress(slot: Flake, dice: Dice, look: VaultLook, life: number, size: number, gravity: number, drag: number): void {
    slot.live = true; slot.age = 0; slot.birth = this.time;
    slot.life = life * (0.75 + 0.5 * dice());
    slot.size = size * (0.6 + 0.9 * dice());
    slot.stretch = 0.55 + 0.9 * dice();
    slot.spin = dice() * Math.PI * 2; slot.spinRate = (dice() - 0.5) * 14;
    slot.gravity = gravity; slot.drag = drag;
    slot.color.setHex(dice() < 0.22 ? look.flakeAccent : look.flake);
    slot.seed = Math.floor(dice() * 997) + 1;
    slot.swirl = null;
  }

  private takeStreak(): Streak | null {
    if (this.disposed || this.streaks.length === 0) return null;
    let oldest = this.streaks[0];
    for (const slot of this.streaks) { if (!slot.live) return slot; if (slot.birth < oldest.birth) oldest = slot; }
    return oldest;
  }

  private takeFlake(): Flake | null {
    if (this.disposed || this.flakes.length === 0) return null;
    let oldest = this.flakes[0];
    for (const slot of this.flakes) { if (!slot.live) return slot; if (slot.birth < oldest.birth) oldest = slot; }
    return oldest;
  }

  private updateWings(step: number, camera: THREE.Camera): void {
    if (!this.wingLive) return;
    this.wingAge += step;
    let opacity = 1, reveal = Math.min(1.12, this.wingAge / 0.2 * 1.12);
    if (this.wingFade >= 0) {
      this.wingFade += step;
      opacity = Math.max(0, 1 - this.wingFade / this.wingHold);
      if (opacity <= 0) { this.wingLive = false; this.wingSample = null; for (const wing of this.wings) wing.mesh.visible = false; return; }
    } else if (this.wingAge > this.wingHold) this.endWings();
    const chest = this.wingSample ? this.wingSample(this.chest) : null;
    if (!chest) { for (const wing of this.wings) wing.mesh.visible = false; return; }
    // Across the frame, whichever way it is seen from, and set a little behind the figure.
    this.view.copy(chest).sub(camera.position).normalize();
    this.right.copy(this.camRight).setY(0);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    const back = this.scratch.copy(this.view).multiplyScalar(0.16);
    const segments = this.budget.wingSegments;
    // A beat of the wings as they are drawn: they open a little wider and settle.
    const open = 1 + 0.12 * Math.sin(Math.min(1, this.wingAge / 0.5) * Math.PI);
    for (const wing of this.wings) {
      const s = wing.side;
      this.p0.copy(chest).add(back).addScaledVector(this.right, s * 0.12).y -= 0.3;
      this.p1.copy(chest).add(back).addScaledVector(this.right, s * 0.72 * open).y += 0.1;
      this.p2.copy(chest).add(back).addScaledVector(this.right, s * 1.3 * open).y += 1.25;
      const array = wing.position.array as Float32Array;
      this.d01.copy(this.p1).sub(this.p0); this.d12.copy(this.p2).sub(this.p1);
      for (let i = 0; i <= segments; i += 1) {
        const a = i / segments, b = 1 - a;
        this.point.set(0, 0, 0).addScaledVector(this.p0, b * b).addScaledVector(this.p1, 2 * a * b).addScaledVector(this.p2, a * a);
        this.tangent.set(0, 0, 0).addScaledVector(this.d01, 2 * b).addScaledVector(this.d12, 2 * a).normalize();
        this.across.crossVectors(this.tangent, this.view).normalize();
        // The outer side of the stroke carries the bright edge: it faces away from the figure.
        if (this.across.dot(this.scratch2.copy(this.point).sub(chest)) < 0) this.across.negate();
        const width = 0.4 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(a, 0.6) * 0.98 + 0.03)), 0.8) * (1 - 0.55 * a);
        const inner = i * 6, outer = inner + 3;
        array[inner] = this.point.x - this.across.x * width * 0.5; array[inner + 1] = this.point.y - this.across.y * width * 0.5; array[inner + 2] = this.point.z - this.across.z * width * 0.5;
        array[outer] = this.point.x + this.across.x * width * 0.5; array[outer + 1] = this.point.y + this.across.y * width * 0.5; array[outer + 2] = this.point.z + this.across.z * width * 0.5;
      }
      wing.position.needsUpdate = true;
      wing.geometry.computeBoundingSphere();
      wing.material.uniforms.uReveal.value = reveal;
      wing.material.uniforms.uOpacity.value = opacity;
      wing.material.uniforms.uGain.value = this.gain;
      wing.mesh.visible = true;
    }
  }

  private updateStreaks(step: number, camera: THREE.Camera): void {
    const position = this.streakGeometry.getAttribute("position") as THREE.BufferAttribute;
    const uv = this.streakGeometry.getAttribute("aUv") as THREE.BufferAttribute;
    const alpha = this.streakGeometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const color = this.streakGeometry.getAttribute("aColor") as THREE.BufferAttribute;
    const core = this.streakGeometry.getAttribute("aCore") as THREE.BufferAttribute;
    let drawn = 0;
    for (const slot of this.streaks) {
      if (!slot.live) continue;
      slot.age += step;
      const age = slot.age - slot.delay;
      if (age >= slot.life) { slot.live = false; continue; }
      if (age < 0) continue;
      const t = age / slot.life;
      let from = 0, to = 1, strength: number;
      if (slot.fixed) {
        // Opens out from its middle in the first few hundredths, holds, fades.
        const open = Math.min(1, age / 0.05);
        from = 0.5 - 0.5 * open; to = 0.5 + 0.5 * open;
        strength = t < 0.45 ? 1.6 : 1.6 * Math.pow(1 - (t - 0.45) / 0.55, 1.5);
      } else {
        to = Math.min(1, t / 0.45);
        from = Math.max(0, (t - 0.3) / 0.7);
        strength = 1.25 * (t < 0.15 ? t / 0.15 : 1);
      }
      if (to - from < 1e-3) continue;
      this.tail.lerpVectors(slot.a, slot.b, from);
      this.head.lerpVectors(slot.a, slot.b, to);
      this.tangent.copy(this.head).sub(this.tail);
      this.view.copy(camera.position).sub(this.point.copy(this.head).add(this.tail).multiplyScalar(0.5));
      this.across.crossVectors(this.tangent, this.view).normalize().multiplyScalar(slot.width * 4);
      const k = drawn * 4;
      position.setXYZ(k, this.tail.x - this.across.x, this.tail.y - this.across.y, this.tail.z - this.across.z);
      position.setXYZ(k + 1, this.tail.x + this.across.x, this.tail.y + this.across.y, this.tail.z + this.across.z);
      position.setXYZ(k + 2, this.head.x + this.across.x, this.head.y + this.across.y, this.head.z + this.across.z);
      position.setXYZ(k + 3, this.head.x - this.across.x, this.head.y - this.across.y, this.head.z - this.across.z);
      // across runs -1 to 1 over the quad, which is four widths wide: the line itself is the middle quarter.
      uv.setXY(k, 0, -4); uv.setXY(k + 1, 0, 4); uv.setXY(k + 2, 1, 4); uv.setXY(k + 3, 1, -4);
      for (let j = 0; j < 4; j += 1) {
        alpha.setX(k + j, strength);
        color.setXYZ(k + j, slot.color.r, slot.color.g, slot.color.b);
        core.setXYZ(k + j, slot.core.r, slot.core.g, slot.core.b);
      }
      drawn += 1;
    }
    for (const attribute of [position, uv, alpha, color, core]) attribute.needsUpdate = true;
    this.streakGeometry.setDrawRange(0, drawn * 6);
    this.streakMesh.visible = drawn > 0;
    this.streakMaterial.uniforms.uGain.value = this.gain;
  }

  private updateFlakes(step: number): void {
    const position = this.flakeGeometry.getAttribute("position") as THREE.BufferAttribute;
    const alpha = this.flakeGeometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const color = this.flakeGeometry.getAttribute("aColor") as THREE.BufferAttribute;
    const seed = this.flakeGeometry.getAttribute("aSeed") as THREE.BufferAttribute;
    let drawn = 0;
    for (const slot of this.flakes) {
      if (!slot.live) continue;
      slot.age += step;
      if (slot.age >= slot.life) { slot.live = false; slot.swirl = null; continue; }
      const swirl = slot.swirl;
      if (swirl && slot.age < swirl.throwAt) {
        // Round the feet, rising, tightening a little as it goes.
        const previous = this.scratch.copy(slot.position);
        swirl.angle += swirl.rate * step;
        const r = swirl.radius * (1 - 0.25 * slot.age / swirl.throwAt);
        slot.position.set(swirl.centre.x + Math.cos(swirl.angle) * r, swirl.centre.y + 0.05 + swirl.rise * (slot.age / swirl.throwAt), swirl.centre.z + Math.sin(swirl.angle) * r);
        if (step > 0) slot.velocity.copy(slot.position).sub(previous).divideScalar(step);
      } else {
        if (swirl) {
          // Thrown out with the ring: flat across the stone and away.
          const out = this.scratch.set(slot.position.x - swirl.centre.x, 0, slot.position.z - swirl.centre.z).normalize();
          slot.velocity.set(out.x * 2.4, 0.5, out.z * 2.4);
          slot.swirl = null;
        }
        slot.velocity.y -= slot.gravity * step;
        const keep = Math.exp(-slot.drag * step);
        slot.velocity.multiplyScalar(keep);
        slot.position.addScaledVector(slot.velocity, step);
        if (slot.position.y < this.floor + 0.012) { slot.position.y = this.floor + 0.012; slot.velocity.y = 0; slot.velocity.x *= 0.6; slot.velocity.z *= 0.6; slot.spinRate *= 0.5; }
      }
      slot.spin += slot.spinRate * step;
      const t = slot.age / slot.life;
      const a = Math.min(1, slot.age / 0.04) * (t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4));
      const c = Math.cos(slot.spin), s = Math.sin(slot.spin);
      const w = slot.size * slot.stretch, h = slot.size;
      const k = drawn * 4;
      for (let j = 0; j < 4; j += 1) {
        const x = j === 0 || j === 3 ? -1 : 1, y = j < 2 ? -1 : 1;
        const rx = (x * c - y * s * 0.6) * w, ry = (x * s * 0.6 + y * c) * h;
        position.setXYZ(k + j, slot.position.x + this.camRight.x * rx + this.camUp.x * ry, slot.position.y + this.camRight.y * rx + this.camUp.y * ry, slot.position.z + this.camRight.z * rx + this.camUp.z * ry);
        alpha.setX(k + j, a);
        color.setXYZ(k + j, slot.color.r, slot.color.g, slot.color.b);
        seed.setX(k + j, slot.seed);
      }
      drawn += 1;
    }
    for (const attribute of [position, alpha, color, seed]) attribute.needsUpdate = true;
    this.flakeGeometry.setDrawRange(0, drawn * 6);
    this.flakeMesh.visible = drawn > 0;
    this.flakeMaterial.uniforms.uGain.value = Math.min(1.3, this.gain);
  }

  private updateRing(step: number): void {
    const ring = this.ring;
    if (!ring.live) return;
    ring.age += step;
    const t = ring.age / ring.seconds;
    if (t >= 1) { ring.live = false; ring.mesh.visible = false; return; }
    // Runs out fast and slows as it goes; bright as it leaves the feet, gone as it reaches its edge.
    const reach = 1 - Math.pow(1 - t, ring.calm ? 2 : 3);
    const radius = 0.14 + (ring.radius - 0.14) * reach;
    const extent = radius + 0.35;
    const u = ring.material.uniforms;
    u.uRadius.value = radius; u.uExtent.value = extent;
    u.uWidth.value = ring.calm ? 0.05 : 0.018 + 0.012 * t;
    const swell = Math.min(1, t / 0.08);
    u.uAlpha.value = (ring.calm ? 0.45 : 1.5) * swell * Math.pow(1 - t, ring.calm ? 1.2 : 1.6);
    u.uGain.value = this.gain;
    ring.mesh.scale.setScalar(extent);
  }

  private build(): void {
    const b = this.budget;
    this.brush ??= brushTexture();
    // The wings.
    this.wings = ([1, -1] as const).map(side => {
      const segments = b.wingSegments;
      const geometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(new Float32Array((segments + 1) * 2 * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      const uv = new Float32Array((segments + 1) * 2 * 2);
      const index: number[] = [];
      for (let i = 0; i <= segments; i += 1) {
        uv.set([i / segments, 0, i / segments, 1], i * 4);
        if (i < segments) { const k = i * 2; index.push(k, k + 1, k + 3, k, k + 3, k + 2); }
      }
      geometry.setAttribute("position", position);
      geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geometry.setIndex(index);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.brush }, uInk: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uCore: { value: new THREE.Color() },
          uReveal: { value: 0 }, uOpacity: { value: 1 }, uGain: { value: 1 }, uFloor: { value: this.floor },
        },
        vertexShader: WING_VERTEX, fragmentShader: WING_FRAGMENT, ...PREMULTIPLIED,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `VaultWing${side > 0 ? "R" : "L"}`;
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 13;
      this.object.add(mesh);
      return { mesh, geometry, position, material, side };
    });
    // The streaks: one buffer of quads.
    this.streaks = Array.from({ length: b.streakPool }, () => ({
      live: false, a: new THREE.Vector3(), b: new THREE.Vector3(), width: 0.03, life: 0.1, age: 0, delay: 0, fixed: false,
      color: new THREE.Color(), core: new THREE.Color(), birth: 0,
    }));
    this.streakGeometry = quads(b.streakPool, { aUv: 2, aAlpha: 1, aColor: 3, aCore: 3 });
    this.streakMaterial = new THREE.ShaderMaterial({ uniforms: { uGain: { value: 1 } }, vertexShader: STREAK_VERTEX, fragmentShader: STREAK_FRAGMENT, ...PREMULTIPLIED, depthTest: true });
    this.streakMesh = new THREE.Mesh(this.streakGeometry, this.streakMaterial);
    this.streakMesh.name = "VaultStreaks"; this.streakMesh.frustumCulled = false; this.streakMesh.visible = false; this.streakMesh.renderOrder = 15;
    this.object.add(this.streakMesh);
    // The flakes: one buffer of quads.
    this.flakes = Array.from({ length: b.flakePool }, () => ({
      live: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 1, size: 0.05, stretch: 1, spin: 0, spinRate: 0,
      gravity: 1, drag: 2, color: new THREE.Color(), seed: 1, birth: 0, swirl: null,
    }));
    this.flakeGeometry = quads(b.flakePool, { aUv: 2, aAlpha: 1, aColor: 3, aSeed: 1 });
    const flakeUv = this.flakeGeometry.getAttribute("aUv") as THREE.BufferAttribute;
    for (let i = 0; i < b.flakePool; i += 1) { flakeUv.setXY(i * 4, -1, -1); flakeUv.setXY(i * 4 + 1, 1, -1); flakeUv.setXY(i * 4 + 2, 1, 1); flakeUv.setXY(i * 4 + 3, -1, 1); }
    this.flakeMaterial = new THREE.ShaderMaterial({ uniforms: { uGain: { value: 1 } }, vertexShader: FLAKE_VERTEX, fragmentShader: FLAKE_FRAGMENT, ...PREMULTIPLIED });
    this.flakeMesh = new THREE.Mesh(this.flakeGeometry, this.flakeMaterial);
    this.flakeMesh.name = "VaultFlakes"; this.flakeMesh.frustumCulled = false; this.flakeMesh.visible = false; this.flakeMesh.renderOrder = 14;
    this.object.add(this.flakeMesh);
    // The ring.
    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: { uEdge: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uRadius: { value: 0.1 }, uWidth: { value: 0.02 }, uExtent: { value: 1 }, uAlpha: { value: 0 }, uGain: { value: 1 } },
      vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT, ...PREMULTIPLIED,
    });
    const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ringMaterial);
    ringMesh.name = "VaultRing"; ringMesh.rotation.x = -Math.PI / 2; ringMesh.frustumCulled = false; ringMesh.visible = false; ringMesh.renderOrder = 9;
    this.object.add(ringMesh);
    this.ring = { live: false, mesh: ringMesh, material: ringMaterial, age: 0, seconds: 0.7, radius: 0.9, calm: false };
  }

  private teardown(): void {
    for (const wing of this.wings) { wing.mesh.removeFromParent(); wing.geometry.dispose(); wing.material.dispose(); }
    this.wings = [];
    this.wingLive = false; this.wingSample = null;
    this.streakMesh.removeFromParent(); this.streakGeometry.dispose(); this.streakMaterial.dispose();
    this.flakeMesh.removeFromParent(); this.flakeGeometry.dispose(); this.flakeMaterial.dispose();
    this.ring.mesh.removeFromParent(); this.ring.mesh.geometry.dispose(); this.ring.material.dispose();
  }
}

/** One buffer of `count` quads (two triangles each), with the extra attributes named, all dynamic. */
function quads(count: number, attributes: Record<string, number>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  for (const [name, size] of Object.entries(attributes)) {
    const attribute = new THREE.BufferAttribute(new Float32Array(count * 4 * size), size);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  const index = new (count * 4 > 65535 ? Uint32Array : Uint16Array)(count * 6);
  for (let i = 0; i < count; i += 1) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  return geometry;
}
