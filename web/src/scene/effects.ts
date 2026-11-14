import * as THREE from "three";

import { KICK_SECONDS, kickOffset } from "./combat/feel";
import { radialTexture, smokeTexture, sparkTexture } from "./textures";
import { ContactEffects } from "./vfx/contactEffects";
import type { ContactFxInput } from "../../../shared/play/contact-vfx";

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  /** Specks in use: the pooled buffers may hold more. */
  count: number;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
  growth: number;
  drag: number;
}

export interface BurstOptions {
  speed?: number;
  life?: number;
  /** Downward pull. Negative floats the specks upward like ash. */
  gravity?: number;
  /** Scatter radius around the spawn point. */
  radius?: number;
  /** Starting point size. */
  size?: number;
  /** Size multiplier reached at the end of life. */
  growth?: number;
  /** Constant upward push added to every speck. */
  rise?: number;
  /** Air resistance; 0 keeps the initial kick for the whole life. */
  drag?: number;
  /** Throw the specks this way instead of all round: sparks leave a blow along its line. */
  direction?: THREE.Vector3;
  /** How far from `direction` a speck may stray, 0 (a jet) to 1 (a wide fan). */
  spread?: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  scale: number;
}

/** One billboarded smoke lobe. Plumes are just a handful of these. */
interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  spin: number;
  delay: number;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
  buoyancy: number;
}

export interface SmokeOptions {
  /** Number of lobes in the plume. */
  count?: number;
  /** Radius the lobes are scattered over. */
  radius?: number;
  /** Starting sprite size. */
  scale?: number;
  /** How much each lobe swells over its life. */
  growth?: number;
  life?: number;
  /** Outward push. */
  speed?: number;
  /** Upward acceleration — how hard the plume boils up. */
  rise?: number;
  color?: number;
  opacity?: number;
  /** Constant drift added to every lobe (wind, knock-back direction). */
  drift?: THREE.Vector3;
}

/** Hard ceiling so a rapid streak of captures can never flood the scene. */
const MAX_PUFFS = 220;
/** Spare flashes kept for the next blow; a burst of them beyond this is freed. */
const SPARE_FLASHES = 24;
/** Spare bursts kept per buffer size. */
const SPARE_BURSTS = 12;

/** The buffer size a burst of `count` specks is drawn from: powers of two from 16, so a few sizes serve every burst. */
export function burstCapacity(count: number): number {
  let capacity = 16;
  while (capacity < count) capacity *= 2;
  return capacity;
}

/**
 * Transient combat FX: dust puffs, sparks and impact flashes.
 * Everything is pooled back into the scene graph and disposed on teardown.
 */
export class EffectsSystem {
  readonly group = new THREE.Group();

  private bursts: Burst[] = [];
  private flashes: Flash[] = [];
  private puffs: Puff[] = [];
  /**
   * Retired sprites and points, kept in the group (hidden) for the next effect (A-26): a match lays thousands of
   * puffs, flashes and bursts (every footstep's dust, every blow's sparks), and making and freeing a sprite, a
   * material and a geometry for each churned the heap and the renderer's caches all game.
   */
  private readonly sparePuffs: THREE.Sprite[] = [];
  private readonly spareFlashes: THREE.Sprite[] = [];
  private readonly spareBursts = new Map<number, Burst[]>();
  /** The pooled sprites and points, alight or spare: what clear() keeps in the group. */
  private readonly owned = new Set<THREE.Object3D>();
  private sparkMap = sparkTexture();
  private flashMap = radialTexture("rgba(255,240,200,0.95)", "rgba(255,150,60,0)");
  private smokeMap = smokeTexture();
  private readonly contacts = new ContactEffects();

  constructor() {
    this.group.name = "effects";
    this.group.add(this.contacts.object);
  }

  /** Only material/surface evidence from a resolved contact enters this path. */
  spawnContact(input: ContactFxInput): number { return this.contacts.emit(input); }
  setContactProjectionScale(pixels: number): void { this.contacts.setProjectionScale(pixels); }
  setReducedMotion(value: boolean): void { if (value) this.contacts.clear(); }

  /** Dust/ember puff — used when a figure crumbles or a strike lands. */
  spawnBurst(position: THREE.Vector3, color: number, count: number, options?: BurstOptions): void {
    if (count <= 0) return;
    const speed = options?.speed ?? 2.2;
    const life = options?.life ?? 0.9;
    const radius = options?.radius ?? 0;
    const rise = options?.rise ?? 0;
    const size = options?.size ?? 0.13;

    const burst = this.takeBurst(count);
    const positions = (burst.points.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const velocities = burst.velocities;
    const aim = options?.direction && options.direction.lengthSq() > 1e-8 ? options.direction.clone().normalize() : null;
    const spread = Math.max(0, Math.min(1, options?.spread ?? 0.45));
    for (let i = 0; i < count; i += 1) {
      const scatterTheta = Math.random() * Math.PI * 2;
      const scatter = radius * Math.pow(Math.random(), 0.55);
      positions[i * 3] = position.x + Math.cos(scatterTheta) * scatter;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * radius * 1.4;
      positions[i * 3 + 2] = position.z + Math.sin(scatterTheta) * scatter;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9);
      const magnitude = speed * (0.35 + Math.random() * 0.85);
      if (aim) {
        // Along the blow, fanned out by `spread` and lifted a little, so the shower leaves the far side of the contact.
        const x = aim.x + Math.sin(phi) * Math.cos(theta) * spread, y = aim.y + Math.abs(Math.cos(phi)) * spread * 0.8 + 0.18, z = aim.z + Math.sin(phi) * Math.sin(theta) * spread;
        const length = Math.hypot(x, y, z) || 1;
        velocities[i * 3] = x / length * magnitude;
        velocities[i * 3 + 1] = y / length * magnitude + rise * (0.5 + Math.random());
        velocities[i * 3 + 2] = z / length * magnitude;
        continue;
      }
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * magnitude;
      velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * magnitude * 1.15 + rise * (0.5 + Math.random());
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * magnitude;
    }

    (burst.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    const material = burst.points.material as THREE.PointsMaterial;
    material.size = size;
    material.color.set(color);
    material.opacity = 1;
    burst.points.visible = true;
    Object.assign(burst, { life: 0, maxLife: life, gravity: options?.gravity ?? 3.4, size, growth: options?.growth ?? 1.9, drag: options?.drag ?? 0 });
    this.bursts.push(burst);
  }

  /** A burst's points and buffers for `count` specks: a spare of the right size, or a new one. */
  private takeBurst(count: number): Burst {
    const capacity = burstCapacity(count);
    const spare = this.spareBursts.get(capacity)?.pop();
    if (spare) {
      spare.count = count;
      spare.points.geometry.setDrawRange(0, count);
      return spare;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, count);
    const material = new THREE.PointsMaterial({
      map: this.sparkMap,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.owned.add(points);
    return { points, velocities: new Float32Array(capacity * 3), count, life: 0, maxLife: 1, gravity: 0, size: 0, growth: 1, drag: 0 };
  }

  private retireBurst(burst: Burst): void {
    burst.points.visible = false;
    const capacity = burst.velocities.length / 3;
    const spares = this.spareBursts.get(capacity) ?? [];
    this.spareBursts.set(capacity, spares);
    if (spares.length < SPARE_BURSTS) { spares.push(burst); return; }
    this.group.remove(burst.points);
    this.owned.delete(burst.points);
    burst.points.geometry.dispose();
    (burst.points.material as THREE.Material).dispose();
  }

  /** A hidden sprite from `spares`, or a new one in the group: its material is set up by the caller. */
  private takeSprite(spares: THREE.Sprite[], map: THREE.Texture, blending: THREE.Blending): THREE.Sprite {
    const spare = spares.pop();
    if (spare) { spare.visible = true; return spare; }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending, opacity: 0 }));
    this.group.add(sprite);
    this.owned.add(sprite);
    return sprite;
  }

  private retireSprite(sprite: THREE.Sprite, spares: THREE.Sprite[], keep: number): void {
    sprite.visible = false;
    if (spares.length < keep) { spares.push(sprite); return; }
    this.group.remove(sprite);
    this.owned.delete(sprite);
    sprite.material.dispose();
  }

  /** Bright additive pop at the point of impact. `color` tints it (a weapon's glint takes its kingdom's colour). */
  spawnFlash(position: THREE.Vector3, scale = 1.6, life = 0.28, color = 0xfff0c8): void {
    const sprite = this.takeSprite(this.spareFlashes, this.flashMap, THREE.AdditiveBlending);
    sprite.material.color.set(color);
    sprite.material.opacity = 1;
    sprite.position.copy(position);
    sprite.scale.setScalar(scale * 0.4);
    this.flashes.push({ sprite, life: 0, maxLife: life, scale });
  }

  /**
   * Boiling smoke plume: soft lobes that swell, drift and rise while fading.
   * Used for the body being swallowed / hurled away on a capture.
   */
  spawnSmoke(position: THREE.Vector3, options?: SmokeOptions): void {
    const count = Math.max(0, Math.round(options?.count ?? 8));
    if (count <= 0) return;
    const radius = options?.radius ?? 0.3;
    const scale = options?.scale ?? 0.7;
    const growth = options?.growth ?? 2.4;
    const maxLife = options?.life ?? 1.1;
    const speed = options?.speed ?? 0.9;
    const rise = options?.rise ?? 0.7;
    const color = options?.color ?? 0x8b8175;
    const peak = options?.opacity ?? 0.85;
    const drift = options?.drift;

    for (let i = 0; i < count; i += 1) {
      if (this.puffs.length >= MAX_PUFFS) return;
      const theta = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.6);
      const offsetX = Math.cos(theta) * radius * spread;
      const offsetY = (Math.random() - 0.25) * radius * 0.8;
      const offsetZ = Math.sin(theta) * radius * spread;

      const sprite = this.takeSprite(this.sparePuffs, this.smokeMap, THREE.NormalBlending);
      const material = sprite.material;
      material.color.set(color);
      material.opacity = 0;
      material.rotation = Math.random() * Math.PI * 2;
      sprite.position.copy(position);
      sprite.position.x += offsetX; sprite.position.y += offsetY; sprite.position.z += offsetZ;
      const size = scale * (0.7 + Math.random() * 0.6);
      sprite.scale.setScalar(size);
      sprite.renderOrder = 2;

      const velocity = new THREE.Vector3(offsetX, 0, offsetZ)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      velocity.y = speed * (0.2 + Math.random() * 0.4);
      if (drift) velocity.add(drift);

      this.puffs.push({
        sprite,
        velocity,
        spin: (Math.random() - 0.5) * 1.5,
        delay: Math.random() * maxLife * 0.18,
        life: 0,
        maxLife: maxLife * (0.75 + Math.random() * 0.5),
        from: size,
        to: size * growth,
        peak: peak * (0.6 + Math.random() * 0.55),
        buoyancy: rise * (0.7 + Math.random() * 0.6),
      });
    }
  }

  update(delta: number): void {
    this.contacts.update(delta);
    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const puff = this.puffs[i];
      if (puff.delay > 0) {
        puff.delay -= delta;
        continue;
      }
      puff.life += delta;
      const t = Math.min(1, puff.life / puff.maxLife);
      // Air drag bleeds the initial kick off while buoyancy keeps it climbing.
      const drag = Math.max(0, 1 - delta * 1.6);
      puff.velocity.multiplyScalar(drag);
      puff.velocity.y += puff.buoyancy * delta;
      puff.sprite.position.addScaledVector(puff.velocity, delta);

      const eased = 1 - Math.pow(1 - t, 2.2);
      puff.sprite.scale.setScalar(puff.from + (puff.to - puff.from) * eased);
      const material = puff.sprite.material as THREE.SpriteMaterial;
      // Quick swell in, long thinning out.
      const fade = t < 0.16 ? t / 0.16 : Math.pow(1 - (t - 0.16) / 0.84, 1.5);
      material.opacity = Math.max(0, puff.peak * fade);
      material.rotation += puff.spin * delta;

      if (t >= 1) {
        this.retireSprite(puff.sprite, this.sparePuffs, MAX_PUFFS);
        this.puffs.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.life += delta;
      const t = burst.life / burst.maxLife;
      const attribute = burst.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const drag = burst.drag > 0 ? Math.max(0, 1 - burst.drag * delta) : 1;
      for (let p = 0; p < burst.count * 3; p += 3) {
        burst.velocities[p + 1] -= burst.gravity * delta;
        if (drag < 1) {
          burst.velocities[p] *= drag;
          burst.velocities[p + 1] *= drag;
          burst.velocities[p + 2] *= drag;
        }
        array[p] += burst.velocities[p] * delta;
        array[p + 1] += burst.velocities[p + 1] * delta;
        array[p + 2] += burst.velocities[p + 2] * delta;
      }
      attribute.needsUpdate = true;
      const material = burst.points.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - t);
      material.size = burst.size * (1 + (burst.growth - 1) * t);
      if (t >= 1) {
        this.retireBurst(burst);
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const flash = this.flashes[i];
      flash.life += delta;
      const t = flash.life / flash.maxLife;
      const material = flash.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, 1 - t);
      flash.sprite.scale.setScalar(flash.scale * (0.4 + t * 1.3));
      if (t >= 1) {
        this.retireSprite(flash.sprite, this.spareFlashes, SPARE_FLASHES);
        this.flashes.splice(i, 1);
      }
    }
  }

  /** Rewind/Undo retires effects from the old board but keeps reusable maps, and the spares for the next board. */
  clear(): void {
    for (const burst of this.bursts) this.retireBurst(burst);
    for (const flash of this.flashes) this.retireSprite(flash.sprite, this.spareFlashes, SPARE_FLASHES);
    for (const puff of this.puffs) this.retireSprite(puff.sprite, this.sparePuffs, MAX_PUFFS);
    this.bursts = [];
    this.flashes = [];
    this.puffs = [];
    // What other systems hung in this group (the feel layer's trails) leaves with the old board, as it always did.
    for (const node of [...this.group.children]) if (node !== this.contacts.object && !this.owned.has(node)) this.group.remove(node);
    this.contacts.clear();
  }

  /** How many effects are alight and how many spares wait: for the diagnostics and the pooling test. */
  stats(): { live: number; spare: number; objects: number } {
    let spareBursts = 0;
    for (const list of this.spareBursts.values()) spareBursts += list.length;
    return { live: this.bursts.length + this.flashes.length + this.puffs.length, spare: spareBursts + this.spareFlashes.length + this.sparePuffs.length, objects: this.group.children.length };
  }

  dispose(): void {
    this.clear();
    for (const node of this.owned) {
      // A sprite's geometry is three's own, shared by every sprite: only its material is ours.
      if ((node as THREE.Points).isPoints) (node as THREE.Points).geometry.dispose();
      ((node as THREE.Points | THREE.Sprite).material as THREE.Material).dispose();
    }
    this.owned.clear();
    this.group.clear();
    this.spareBursts.clear();
    this.sparePuffs.length = 0;
    this.spareFlashes.length = 0;
    this.contacts.dispose();
    this.sparkMap.dispose();
    this.flashMap.dispose();
    this.smokeMap.dispose();
  }
}

/**
 * Camera shake, on two channels that decay independently.
 *
 * They are kept apart because the two things they describe do not feel alike.
 * `add` is an **impact**: a cannon, a blade landing, a body hitting stone — high
 * frequency, gone in a blink. `tremor` is a **rumble**: the hall itself reacting
 * to something, so it swells in rather than starting at full amplitude, runs an
 * order of magnitude slower, and lasts long enough to be felt rather than
 * flinched at. Driving an alarm off `add` reads as the camera being punched.
 */
export class ShakeSystem {
  private trauma = 0;
  private elapsed = 0;
  /** Rumble amplitude, 0-1. */
  private rumble = 0;
  /** How fast the rumble bleeds away, in units of amplitude per second. */
  private rumbleDecay = 1;
  /** Eased-in envelope on the rumble, so it never starts on a hard edge. */
  private swell = 0;
  /** Directional kicks still swinging: a blow's push along its line (see combat/feel.ts). */
  private kicks: { direction: THREE.Vector3; amount: number; age: number }[] = [];
  readonly offset = new THREE.Vector3();

  /** A hit: sharp, high frequency, over in a fraction of a second. */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * A blow pushing the view along its own line: the camera swings out that way
   * and springs back. Unlike `add` it has a direction, so the hit reads as
   * coming from somewhere, and it runs on real time (see `update`), so it
   * moves while a hit-stop holds the board.
   */
  kick(direction: THREE.Vector3, amount: number): void {
    if (!(amount > 0) || direction.lengthSq() < 1e-8) return;
    if (this.kicks.length >= 3) this.kicks.shift();
    this.kicks.push({ direction: direction.clone().normalize(), amount, age: 0 });
  }

  /**
   * A rumble: low frequency, swells in and rolls out over `seconds`.
   * @param amount Peak amplitude, 0-1.
   * @param seconds Roughly how long it takes to fade back to still.
   */
  tremor(amount: number, seconds = 1): void {
    this.rumble = Math.min(1, Math.max(this.rumble, amount));
    this.rumbleDecay = 1 / Math.max(0.15, seconds);
  }

  /** `real` is the frame's real time, for the kicks; `delta` the board's own (held during a hit-stop). */
  update(delta: number, real = delta): void {
    this.elapsed += delta;
    this.offset.set(0, 0, 0);

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - delta * 1.9);
      const magnitude = this.trauma * this.trauma * 0.32;
      this.offset.set(
        Math.sin(this.elapsed * 47) * magnitude,
        Math.sin(this.elapsed * 61 + 1.3) * magnitude * 0.7,
        Math.sin(this.elapsed * 53 + 2.1) * magnitude,
      );
    }

    if (this.rumble > 0) {
      // Two beats up, then out with the rumble itself: the swell is what keeps
      // the first frame from jumping.
      this.swell = Math.min(1, this.swell + delta * 7);
      this.rumble = Math.max(0, this.rumble - delta * this.rumbleDecay);
      const magnitude = this.rumble * this.swell * 0.075;
      // Slow, drifting frequencies, and mostly lateral — a floor moving under
      // the rig, not a blow to the lens.
      this.offset.x += Math.sin(this.elapsed * 11.3) * magnitude;
      this.offset.y += Math.sin(this.elapsed * 8.1 + 0.7) * magnitude * 0.55;
      this.offset.z += Math.sin(this.elapsed * 9.7 + 2.4) * magnitude;
      if (this.rumble <= 0) this.swell = 0;
    }

    // The kicks go on top of the shake, on real time.
    for (let i = this.kicks.length - 1; i >= 0; i -= 1) {
      const kick = this.kicks[i];
      kick.age += Math.max(0, real);
      if (kick.age >= KICK_SECONDS) { this.kicks.splice(i, 1); continue; }
      this.offset.addScaledVector(kick.direction, kick.amount * kickOffset(kick.age));
    }
  }

  /** Drops any kick still swinging (the board was rebuilt, or motion was turned down). */
  clearKicks(): void { this.kicks = []; }
}
