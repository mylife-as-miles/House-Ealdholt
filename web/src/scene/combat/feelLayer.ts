/**
 * The combat feel layer as the scene runs it (the rules and numbers are in
 * feel.ts). One per engine. It owns:
 *
 *  - the hit-stop clock the engine scales its frame time by;
 *  - the struck body's shudder, written to the figure's `visual` group (no one
 *    else moves that group) and always put back to rest;
 *  - the camera kick, handed to the engine's ShakeSystem;
 *  - two weapon trails: ribbons between the weapon's point and a point part
 *    way down to the hand, kept for a few tenths of a second and faded by age
 *    and by how fast the point was moving, so a slow wind-up leaves nothing
 *    and the thrust leaves a streak;
 *  - the glint that marks the start of a killing blow, and sparks thrown along
 *    a blow's line.
 *
 * Cost: two meshes of at most 14 quads with one shared basic material. The
 * material is drawn once while the arena loads (with nothing in it) so its
 * shader is ready before the first fight, and the meshes are hidden whenever
 * no trail is showing. No light, texture or material flag is touched.
 */
import * as THREE from "three";
import type { ArsenalId } from "../../assets/generated";
import type { EffectsSystem, ShakeSystem } from "../effects";
import type { PieceView } from "../pieces";
import type { Kind, Kingdom } from "./choreography";
import { FEEL, ImpactClock, TRAIL_COLOR, combatFeelEnabled, impactShape, shudderOffset, type BlowKind, type ImpactShape } from "./feel";

export interface FeelHost {
  readonly effects: EffectsSystem;
  readonly shake: ShakeSystem;
  /** Where the trails are drawn. */
  readonly group: THREE.Object3D;
  /** The lowest graphics preset: shorter trails. */
  lowDetail(): boolean;
  reducedMotion(): boolean;
  /** False where something else draws the weapons' trails (the engine's own, in effects.ts): the glint, hit-stops,
   * shudder, camera kick and sparks stay. Defaults to true. */
  readonly trails?: boolean;
}

const KINGDOM_OF: Readonly<Record<ArsenalId, Kingdom>> = { kingdom: "ivory", sun: "sun", empire: "empire", kwind: "kwind" };
/** The trail runs from the point back this share of the way to the hand: the blade end of a spear, most of a sword. */
const TRAIL_REACH = 0.58;

/** Which army's steel a figure carries. */
export function kingdomOf(piece: Pick<PieceView, "arsenal">): Kingdom { return KINGDOM_OF[piece.arsenal] ?? "ivory"; }

class WeaponTrail {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private readonly base: Float32Array;
  private readonly tip: Float32Array;
  private readonly age: Float32Array;
  private readonly glow: Float32Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private count = 0;
  private piece: PieceView | null = null;
  private readonly color = new THREE.Color();
  private strength = 1;
  private life: number = FEEL.trail.life;
  private emitLeft = 0;
  private delayLeft = 0;
  private hasLast = false;
  private warmed = false;
  private readonly point = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly lastRelative = new THREE.Vector3();
  private readonly relative = new THREE.Vector3();

  constructor(material: THREE.Material, capacity: number) {
    this.capacity = capacity;
    this.base = new Float32Array(capacity * 3); this.tip = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity); this.glow = new Float32Array(capacity);
    this.positions = new Float32Array(capacity * 6); this.colors = new Float32Array(capacity * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < capacity - 1; i += 1) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "weapon-trail";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    // Drawn empty once so the shader is compiled while the arena loads, then hidden until a blow needs it.
    this.mesh.onBeforeRender = () => { this.warmed = true; };
  }

  get owner(): PieceView | null { return this.piece; }
  get busy(): boolean { return this.emitLeft > 0 || this.delayLeft > 0 || this.count > 0; }

  start(piece: PieceView, color: number, seconds: number, delay: number, strength: number, life: number): void {
    if (this.piece !== piece) { this.count = 0; this.hasLast = false; }
    this.piece = piece; this.color.setHex(color); this.strength = strength; this.life = life;
    this.delayLeft = Math.max(0, delay); this.emitLeft = Math.max(this.emitLeft, seconds);
    this.mesh.visible = true;
  }

  /** Stops adding to the trail; what is there fades out on its own. */
  stop(after = 0): void { this.emitLeft = Math.min(this.emitLeft, Math.max(0, after)); this.delayLeft = Math.min(this.delayLeft, Math.max(0, after)); }

  clear(): void {
    this.count = 0; this.emitLeft = 0; this.delayLeft = 0; this.piece = null; this.hasLast = false;
    this.mesh.geometry.setDrawRange(0, 0);
    if (this.warmed) this.mesh.visible = false;
  }

  /** `delta` is the board's time: a hit-stop holds the trail in the air with everything else. */
  update(delta: number): void {
    if (!this.busy) { if (this.warmed) this.mesh.visible = false; return; }
    for (let i = 0; i < this.count; i += 1) this.age[i] += delta;
    while (this.count > 0 && this.age[this.count - 1] >= this.life) this.count -= 1;
    if (this.delayLeft > 0) this.delayLeft -= delta;
    else if (this.emitLeft > 0) { this.emitLeft -= delta; this.sample(delta); }
    if (this.emitLeft <= 0 && this.delayLeft <= 0 && this.count === 0) { this.piece = null; this.hasLast = false; }
    this.write();
  }

  private sample(delta: number): void {
    const piece = this.piece;
    if (!piece || piece.isSlain || !piece.weaponLine(this.point, this.hand)) return;
    // A held board barely moves: no new sample, or the speed below would be noise.
    if (delta < 1e-3) return;
    piece.container.getWorldPosition(this.anchor);
    this.relative.copy(this.point).sub(this.anchor);
    // How fast the point moves against the body, so walking in does not draw a trail and the thrust does.
    const speed = this.hasLast ? this.relative.distanceTo(this.lastRelative) / delta : 0;
    this.lastRelative.copy(this.relative); this.hasLast = true;
    const glow = THREE.MathUtils.smoothstep(speed, FEEL.trail.slow, FEEL.trail.fast);
    // Shift the samples back by one, newest first.
    const keep = Math.min(this.count, this.capacity - 1);
    this.base.copyWithin(3, 0, keep * 3); this.tip.copyWithin(3, 0, keep * 3);
    this.age.copyWithin(1, 0, keep); this.glow.copyWithin(1, 0, keep);
    this.hand.lerp(this.point, 1 - TRAIL_REACH);
    this.base[0] = this.hand.x; this.base[1] = this.hand.y; this.base[2] = this.hand.z;
    this.tip[0] = this.point.x; this.tip[1] = this.point.y; this.tip[2] = this.point.z;
    this.age[0] = 0; this.glow[0] = glow;
    this.count = keep + 1;
  }

  private write(): void {
    const geometry = this.mesh.geometry;
    if (this.count < 2) { geometry.setDrawRange(0, 0); return; }
    const { r, g, b } = this.color;
    for (let i = 0; i < this.count; i += 1) {
      const fade = Math.pow(Math.max(0, 1 - this.age[i] / this.life), 1.6) * this.glow[i] * this.strength;
      const o = i * 6;
      this.positions[o] = this.base[i * 3]; this.positions[o + 1] = this.base[i * 3 + 1]; this.positions[o + 2] = this.base[i * 3 + 2];
      this.positions[o + 3] = this.tip[i * 3]; this.positions[o + 4] = this.tip[i * 3 + 1]; this.positions[o + 5] = this.tip[i * 3 + 2];
      // Brightest along the edge the point drew, fading towards the hand: an arc of light, not a flat sheet.
      this.colors[o] = r * fade * 0.18; this.colors[o + 1] = g * fade * 0.18; this.colors[o + 2] = b * fade * 0.18;
      this.colors[o + 3] = r * fade; this.colors[o + 4] = g * fade; this.colors[o + 5] = b * fade;
    }
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    geometry.setDrawRange(0, (this.count - 1) * 6);
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); }
}

interface Shudder { piece: PieceView; along: THREE.Vector3; across: THREE.Vector3; amount: number; seconds: number; t: number }

export class CombatFeel {
  private readonly clock = new ImpactClock();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly trails: WeaponTrail[];
  private shudders: Shudder[] = [];
  /** Glints waiting for their moment, on the board's clock. */
  private glints: { piece: PieceView; scale: number; left: number }[] = [];
  private on = combatFeelEnabled();
  private skipped = false;
  private readonly scratch = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();

  constructor(private readonly host: FeelHost) {
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.trails = [new WeaponTrail(this.material, FEEL.trail.samples), new WeaponTrail(this.material, FEEL.trail.samples)];
    for (const trail of this.trails) host.group.add(trail.mesh);
  }

  /**
   * A fight starts: the before/after switch is read here, once, so it never
   * changes in the middle of a fight. False when the layer stands down.
   */
  begin(): boolean {
    this.on = combatFeelEnabled() && !this.host.reducedMotion();
    this.skipped = false;
    return this.on;
  }

  get enabled(): boolean { return this.on; }

  /** The share of this frame's real time the board's clock is given (see ImpactClock). */
  timeScale(real: number, bypass: boolean): number {
    return this.clock.timeScale(real, bypass || !this.on || this.host.reducedMotion());
  }

  /** A contact lands: the board holds, the body that took it shudders along the blow, the camera is kicked. */
  impact(blow: BlowKind, target: PieceView | null, direction: THREE.Vector3, power: number, attacker: Kind, heavy = false): ImpactShape | null {
    if (!this.on || this.host.reducedMotion()) return null;
    const shape = impactShape(blow, power, attacker, heavy);
    // After a skip the blow still lands, but time is not slowed: the player asked to get on with it.
    this.clock.hit(this.skipped ? { ...shape, slow: 0 } : shape);
    if (target) this.shudder(target, direction, shape.shudder, shape.shudderSeconds);
    const push = this.scratch.set(direction.x, 0, direction.z);
    if (push.lengthSq() > 1e-8) { push.normalize(); push.y = -FEEL.kickDip; this.host.shake.kick(push, shape.kick); }
    return shape;
  }

  /** The hold alone, for a sequence's own `hitstop` cue. */
  freeze(seconds: number): void {
    if (this.on && !this.host.reducedMotion()) this.clock.hit({ freeze: seconds, slow: 0, slowScale: 1 });
  }

  /** The figure's weapon leaves a trail for `seconds` of board time, after `delay`. */
  swing(piece: PieceView, seconds: number, delay = 0, strength = 1): void {
    if (!this.on || this.host.reducedMotion() || piece.isSlain || this.host.trails === false) return;
    const trail = this.trails.find(item => item.owner === piece) ?? this.trails.find(item => !item.busy) ?? this.trails[0];
    const low = this.host.lowDetail();
    trail.start(piece, TRAIL_COLOR[kingdomOf(piece)], seconds, delay, strength, low ? FEEL.trail.lifeLow : FEEL.trail.life);
  }

  /**
   * An attack clip starts at `rate`, joined `from` seconds in: its trail runs from the clip's `ready` frame (the
   * end of the wind-up) through its contact, and the killing blow is marked with a glint as its drive begins.
   */
  swingClip(piece: PieceView, clip: { events: Readonly<Record<string, number>> }, rate: number, from: number, killing: boolean): void {
    if (!this.on || !(rate > 0)) return;
    const contact = clip.events.contact ?? clip.events.impact;
    if (contact === undefined || contact <= from) return;
    const ready = Math.max(from, Math.min(clip.events.ready ?? from, contact));
    const delay = Math.max(0, (ready - from) / rate - 0.04);
    this.swing(piece, (contact - ready) / rate + 0.12, delay, killing ? 1 : 0.7);
    if (killing) this.glint(piece, 0.55, delay);
  }

  /** The blow has landed: the trail stops growing `after` seconds later and fades. */
  endSwing(piece: PieceView, after = 0.05): void { for (const trail of this.trails) if (trail.owner === piece) trail.stop(after); }

  /** A point of light on the weapon as the killing blow starts, `delay` board seconds from now: this is the one that matters. */
  glint(piece: PieceView, scale = 0.5, delay = 0): void {
    if (!this.on || this.host.reducedMotion()) return;
    if (delay > 0) { this.glints.push({ piece, scale, left: delay }); return; }
    if (piece.isSlain || !piece.weaponLine(this.scratch, this.hand)) return;
    this.host.effects.spawnFlash(this.scratch.clone(), scale, 0.17, TRAIL_COLOR[kingdomOf(piece)]);
  }

  /** Sparks thrown along a blow's line from where it landed. */
  sparks(at: THREE.Vector3, direction: THREE.Vector3, count: number, color: number, speed = 2.6, spread = 0.5): void {
    if (!this.on || count <= 0) return;
    this.host.effects.spawnBurst(at, color, count, { direction, spread, speed, life: 0.42, gravity: 4.2, size: 0.1, drag: 1.2 });
  }

  /** The player skipped: whatever hold is running ends now, and no slow motion follows. */
  skip(): void { this.skipped = true; this.clock.clear(); }

  /** `real` is the frame's real time (the shudder runs on it), `delta` the board's (the trails do). */
  update(real: number, delta: number): void {
    if (this.shudders.length) {
      const alive: Shudder[] = [];
      for (const item of this.shudders) {
        item.t += real;
        const offset = shudderOffset(item.t, item.seconds);
        if (item.t >= item.seconds || item.piece.isSlain && item.t > item.seconds * 0.5) { item.piece.visual.position.set(0, 0, 0); continue; }
        item.piece.visual.position.set(0, 0, 0).addScaledVector(item.along, offset.along * item.amount).addScaledVector(item.across, offset.across * item.amount);
        alive.push(item);
      }
      this.shudders = alive;
    }
    if (this.glints.length) {
      const due = this.glints.filter(item => (item.left -= delta) <= 0);
      this.glints = this.glints.filter(item => item.left > 0);
      for (const item of due) this.glint(item.piece, item.scale);
    }
    for (const trail of this.trails) trail.update(delta);
  }

  private shudder(piece: PieceView, direction: THREE.Vector3, amount: number, seconds: number): void {
    const along = new THREE.Vector3(direction.x, 0, direction.z);
    if (along.lengthSq() < 1e-8) along.set(0, 0, 1);
    along.normalize();
    // `visual` sits under the figure's runtime group, which a struck figure does not turn: board axes are its axes.
    const existing = this.shudders.find(item => item.piece === piece);
    if (existing) { existing.along.copy(along); existing.across.set(-along.z, 0, along.x); existing.amount = Math.max(existing.amount * 0.5, amount); existing.seconds = seconds; existing.t = 0; return; }
    this.shudders.push({ piece, along, across: new THREE.Vector3(-along.z, 0, along.x), amount, seconds, t: 0 });
  }

  /** Board rebuilt, match left, or motion turned down: everything back to rest at once. */
  clear(): void {
    this.clock.clear();
    for (const item of this.shudders) item.piece.visual.position.set(0, 0, 0);
    this.shudders = [];
    this.glints = [];
    for (const trail of this.trails) trail.clear();
    this.host.shake.clearKicks();
    this.skipped = false;
  }

  dispose(): void {
    this.clear();
    for (const trail of this.trails) trail.dispose();
    this.material.dispose();
  }
}
