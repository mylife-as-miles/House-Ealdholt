/**
 * A body bursting apart, in the scene.
 *
 *   gibs.explode(victim, blastPoint, power, { ply, seed, standing })   // true if the figure burst
 *   gibs.update(delta)                                                  // every frame
 *   gibs.undoTo(ply); gibs.clear();
 *
 * At the blast the figure's skin is baked in the pose it holds, cut along its
 * bones into pieces (gibPlan.ts), each cut closed with a flesh-coloured cap,
 * and every piece given a rigid body thrown out from the blast point. The
 * figure itself is hidden, not altered: its meshes, skeleton and materials
 * are untouched, so a figure brought back (Undo rebuilds it, the tray resets
 * it) is whole. Blood is thrown at the burst and where pieces land, through
 * the gore system's own planner and its spray, stain and pool calls.
 *
 * The pieces wear the figure's own materials, so whatever takes the body away
 * (its dissolve, its fade) takes the pieces with it, where they lie.
 */
import * as THREE from "three";
import { planGore } from "../../gore/GoreDirector";
import type { GoreEvent, GoreIntensity, GoreKind, GoreKingdom, GorePlan, PoolPlan, SprayPlan, StainPlan, WoundPlan } from "../../gore/GoreTypes";
import type { WoundBody } from "../../gore/WoundMasks";
import type { PieceView } from "../../pieces";
import type { QualityPreset } from "../../quality";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { decompose, type Q4, type V3 } from "../physics/math";
import type { RigJoint } from "../ragdoll/ragdollPlan";
import { GibSim, type GibBody } from "./GibSim";
import { GIB_BUDGET, GIB_SLABS, fitBox, gibPieces, intoFrame, slabOwners, splitSkin, type GibGeometry } from "./gibPlan";

/** The part of the gore system a burst uses. GoreSystem is one; tests pass a recorder. */
export interface GibBlood {
  spray(plan: GorePlan, spray: SprayPlan): void;
  stain(plan: GorePlan, stain: StainPlan): void;
  pool(plan: GorePlan, pool: PoolPlan, at: { x: number; z: number }): void;
  remove(impactId: string): void;
  /**
   * A severed limb's stump (death/sever): its wound painted into the figure's own mask (gore/WoundMasks.ts), riding
   * on `anchor`, the bone the stump hangs from, and filed under `impactId`, which `remove` takes back. False where the
   * figure wears no mask.
   */
  stumpWound?(impactId: string, body: WoundBody, anchor: THREE.Object3D, wound: WoundPlan): boolean;
  /** A run of blood down the body from that wound, as its plan's `runs[index]` says. */
  stumpRun?(impactId: string, index: number): void;
}

export interface ExplodeContext {
  /** Half-moves played when this death is on the board: Undo past it takes its blood away. Default 0. */
  ply?: number;
  /** The fight's seed: the same game bursts the same way. Default: from the ply and where the figure stood. */
  seed?: number;
  /** Every figure still standing: pieces bounce off them and never come to rest inside one. */
  standing?: readonly { x: number; z: number }[];
  /** The victim's kingdom, for the gore planner. */
  kingdom?: GoreKingdom;
  /** The same flags every gore event carries. A menu board or the tactical map bursts without blood in the air. */
  flags?: { menuBoard: boolean; reducedMotion: boolean; tactical: boolean };
  /** Bones folded away (death/sever: a limb that came off): their skin is left out of the pieces, and the cuts against it closed. */
  hidden?: ReadonlySet<THREE.Object3D>;
}

interface Piece { group: THREE.Group; geometries: THREE.BufferGeometry[] }
interface Entry {
  victim: PieceView;
  /** What was hidden to make the figure vanish: the sculpt's own nodes under `visual`, shown again when it stands. */
  hidden: THREE.Object3D[];
  pieces: Piece[];
  sim: GibSim | null;
  cap: THREE.MeshStandardMaterial;
  ply: number;
  landings: number;
  seed: number;
  kingdom: GoreKingdom;
  flags: NonNullable<ExplodeContext["flags"]>;
  pooled: boolean;
  impact: string;
}
export interface GibStats { bursts: number; flying: number; pieces: number; lastPieces: number; lastRest: number | null; blood: number }

const CAP_COLOUR = 0x4d0e0b;
/** What the figure held becomes a piece of its own when it is at least this big (scene units, corner to corner), and at most this many do. */
const PROP_MIN = 0.12, PROP_LIMIT = 3;
const p = new THREE.Vector3(), n = new THREE.Vector3(), m3 = new THREE.Matrix3(), m4 = new THREE.Matrix4();
const at: V3 = [0, 0, 0], turn: Q4 = [0, 0, 0, 1];

export class GibSystem {
  private readonly entries: Entry[] = [];
  private quality: QualityPreset;
  /** Blood this system laid, by ply: Undo takes back what the plies taken back left. */
  private readonly laid: { ply: number; impact: string }[] = [];
  private readonly queue: { at: number; run: () => void }[] = [];
  private clock = 0;
  private lastPieces = 0;
  private lastRest: number | null = null;

  constructor(
    private readonly world: () => PhysicsWorld | null, private readonly root: THREE.Group, quality: QualityPreset,
    private readonly blood: GibBlood | null, private readonly board: { top: number; tile: number },
    /** A piece has reached the stone (only the landings that also throw blood are told): for the sound of it. */
    private readonly onLanding: ((at: THREE.Vector3, trunk: boolean) => void) | null = null,
  ) { this.quality = quality; }

  setQuality(quality: QualityPreset): void { this.quality = quality; }
  get busy(): boolean { return this.entries.some(entry => entry.sim !== null); }
  owns(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim); }
  /** Whether this figure's pieces are still in the air or rolling. */
  flying(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim && entry.sim !== null); }
  get stats(): GibStats {
    return {
      bursts: this.entries.length, flying: this.entries.filter(entry => entry.sim).length, pieces: this.entries.reduce((sum, entry) => sum + entry.pieces.length, 0),
      lastPieces: this.lastPieces, lastRest: this.lastRest, blood: this.laid.length,
    };
  }

  /**
   * Bursts a figure apart at `blast` (a world point). `power` is the blast's
   * strength, about 0.4 to 2. False when it cannot be done (physics not
   * loaded, the figure is not on the board, nothing to cut): the caller then
   * plays the death it would have played.
   */
  explode(victim: PieceView, blast: { x: number; y: number; z: number }, power: number, context: ExplodeContext = {}): boolean {
    const world = this.world();
    if (!world || !victim.container.parent || this.owns(victim)) return false;
    const budget = GIB_BUDGET[this.quality];
    // Every matrix under the figure, the skins' bind matrices included, as of now.
    victim.container.updateMatrixWorld(true);
    let cut: CutPart[];
    // Reading and cutting changes nothing on the figure: if a mesh turns out to be one this cannot cut, the death it would have had plays instead.
    try { cut = cutFigure(victim, budget.level, budget.props, context.hidden ?? null); } catch (error) { console.warn("[death] could not cut the figure; it dies as it would have", error); return false; }
    if (!cut.length) return false;
    if (context.standing) world.setObstacles(context.standing.map(spot => ({ x: spot.x, z: spot.z, radius: 0.24 * this.board.tile })));

    const cap = new THREE.MeshStandardMaterial({ color: CAP_COLOUR, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
    const pieces: Piece[] = [], bodies: GibBody[] = [];
    for (const part of cut) {
      const group = new THREE.Group();
      group.name = `gib_${part.name}`;
      group.position.set(part.centre[0], part.centre[1], part.centre[2]);
      group.quaternion.set(part.rotation[0], part.rotation[1], part.rotation[2], part.rotation[3]);
      const geometries: THREE.BufferGeometry[] = [];
      for (const skin of part.skins) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(skin.geometry.positions, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(skin.geometry.normals, 3));
        if (skin.geometry.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(skin.geometry.uvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(skin.geometry.index, 1));
        geometry.addGroup(0, skin.geometry.skin, 0); geometry.addGroup(skin.geometry.skin, skin.geometry.cap, 1);
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, [skin.material, cap]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh); geometries.push(geometry);
      }
      for (const prop of part.props) group.add(prop);
      this.root.add(group);
      pieces.push({ group, geometries });
      bodies.push({ centre: part.centre, rotation: part.rotation, half: part.half, neighbours: part.neighbours });
    }

    const ply = context.ply ?? 0, spot = victim.container.position;
    const seed = (context.seed ?? (Math.imul(ply + 1, 0x9e3779b1) ^ Math.round(spot.x * 977) ^ Math.imul(Math.round(spot.z * 977), 0x85ebca6b))) >>> 0;
    const origin: V3 = [blast.x, blast.y, blast.z];
    // The figure is hidden, not changed. `visual.visible` itself belongs to the tactical view, so the nodes under it are hidden instead.
    const hidden = victim.visual.children.filter(child => child.visible);
    for (const child of hidden) child.visible = false;
    const entry: Entry = {
      victim, hidden, pieces, cap, ply, seed, landings: 0, pooled: false, kingdom: context.kingdom ?? "ivory", impact: `${ply}:burst.${seed.toString(36)}`,
      sim: new GibSim(world, bodies, origin, power, seed), flags: context.flags ?? { menuBoard: false, reducedMotion: false, tactical: false },
    };
    this.entries.push(entry);
    this.lastPieces = pieces.length;
    // A dead figure's own nodes stay as they are until it stands again or is freed.
    if (!victim.isSlain) victim.playDeath();
    victim.setAirborne(true);
    this.bleed(entry, origin, { x: 0, y: 1, z: 0 }, Math.max(1.2, power), 1, null);
    return true;
  }

  /** Blood through the gore system's planner and sink: a spray now, and the stains where its droplets come down. */
  private bleed(entry: Entry, point: V3, direction: { x: number; y: number; z: number }, power: number, share: number, pool: { x: number; z: number } | null): void {
    const blood = this.blood;
    if (!blood) return;
    const impact = `${entry.impact}.${this.laid.length}`;
    const event: GoreEvent = {
      impactId: impact, seed: (entry.seed ^ Math.imul(this.laid.length + 1, 0x68e31da4)) >>> 0, ply: entry.ply,
      // What bursts a body is past any armour: the planner is asked for flesh, as a musket ball at this power reaches it.
      attacker: { kind: "q", kingdom: entry.kingdom, weapon: "musket" }, defender: { kind: entry.victim.kind as GoreKind, kingdom: entry.kingdom },
      contact: { point: { x: point[0], y: point[1], z: point[2] }, normal: { x: 0, y: 1, z: 0 }, direction, anchor: "torso" },
      power, outcome: "kill", intensity: "full" as GoreIntensity, quality: this.quality, flags: entry.flags, board: this.board,
    };
    const plan = planGore(event);
    if (plan.silent) return;
    this.laid.push({ ply: entry.ply, impact });
    const live = () => this.laid.some(item => item.impact === impact);
    for (const spray of plan.sprays) {
      if (spray.id === "drip") continue;
      const thrown = share >= 1 ? spray : { ...spray, droplets: Math.max(2, Math.round(spray.droplets * share)), mist: Math.round(spray.mist * share), speed: [spray.speed[0] * 0.6, spray.speed[1] * 0.6] as const };
      this.queue.push({ at: this.clock + spray.delay, run: () => { if (live()) blood.spray(plan, thrown); } });
    }
    const stains = share >= 1 ? plan.stains : plan.stains.slice(0, 2);
    for (const stain of stains) this.queue.push({ at: this.clock + stain.at, run: () => { if (live()) blood.stain(plan, stain); } });
    if (pool && plan.pool) { const lake = plan.pool; this.queue.push({ at: this.clock + lake.delay, run: () => { if (live()) blood.pool(plan, lake, pool); } }); }
    this.queue.sort((a, b) => a.at - b.at);
  }

  update(delta: number): void {
    this.clock += Math.max(0, delta);
    while (this.queue.length && this.queue[0].at <= this.clock + 1e-9) this.queue.shift()!.run();
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i], victim = entry.victim;
      // Freed with the board, or standing again in the tray: the pieces go, and a figure that stands is shown whole.
      if (!victim.container.parent) { this.remove(entry); continue; }
      if (!victim.isSlain) { this.remove(entry, true); continue; }
      const sim = entry.sim;
      if (sim) {
        entry.pieces.forEach((piece, index) => {
          sim.position(index, at); sim.rotation(index, turn);
          piece.group.position.set(at[0], at[1], at[2]); piece.group.quaternion.set(turn[0], turn[1], turn[2], turn[3]);
        });
        for (const index of sim.landings()) {
          sim.position(index, at);
          // The biggest piece (the trunk) leaves the pool; the first few landings each throw a little blood.
          const first = index === 0 && !entry.pooled;
          if (first) entry.pooled = true;
          if (!first && entry.landings >= GIB_BUDGET[this.quality].landings) continue;
          entry.landings += 1;
          this.bleed(entry, [at[0], this.board.top + 0.04, at[2]], { x: 0, y: 1, z: 0 }, 1, first ? 0.5 : 0.3, first ? { x: at[0], z: at[2] } : null);
          this.onLanding?.(p.set(at[0], at[1], at[2]), first);
        }
        if (sim.atRest) { this.lastRest = sim.age; sim.release(); entry.sim = null; }
      }
      // The caps are not the figure's material: they follow its dissolve by hand, and go when the body has gone.
      const gone = victim.dissolveLevel;
      entry.cap.transparent = gone > 0; entry.cap.opacity = Math.max(0, 1 - gone * 1.4);
      // On the tactical map the sculpts are hidden (`visual.visible`), and so is what is left of this one.
      const shown = gone < 0.98 && victim.visual.visible;
      for (const piece of entry.pieces) piece.group.visible = shown;
    }
  }

  private remove(entry: Entry, showFigure = false): void {
    entry.sim?.release(); entry.sim = null;
    if (showFigure) for (const child of entry.hidden) child.visible = true;
    for (const piece of entry.pieces) { piece.group.removeFromParent(); for (const geometry of piece.geometries) geometry.dispose(); }
    entry.cap.dispose();
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  /** Undo: every piece goes (the engine rebuilds the figures whole), and so does the blood of the plies taken back. */
  undoTo(ply: number): void {
    for (const entry of [...this.entries]) this.remove(entry, entry.victim.container.parent !== null && !entry.victim.isSlain);
    for (let i = this.laid.length - 1; i >= 0; i -= 1) if (this.laid[i].ply > ply) { this.blood?.remove(this.laid[i].impact); this.laid.splice(i, 1); }
    this.queue.length = 0;
  }

  /** A new game: nothing of the last one remains. */
  clear(): void { this.undoTo(-1); this.lastRest = null; }
}

interface CutPart {
  name: string;
  centre: V3; rotation: Q4; half: V3;
  neighbours: number[];
  skins: { geometry: GibGeometry; material: THREE.Material }[];
  /** Things the figure held, carried whole on a piece of their own. */
  props: THREE.Mesh[];
}

/**
 * Bakes the figure's skin in the pose it holds and cuts it into pieces. Reads the figure; changes nothing on it. The
 * skin of `hidden` bones (a limb that came off) goes to no piece: splitSkin closes the cuts against it.
 */
function cutFigure(victim: PieceView, level: 0 | 1 | 2, withProps: boolean, hidden: ReadonlySet<THREE.Object3D> | null = null): CutPart[] {
  const bones: THREE.Object3D[] = [], skinned: THREE.SkinnedMesh[] = [], solid: THREE.Mesh[] = [];
  victim.visual.traverseVisible(node => {
    if ((node as THREE.Bone).isBone) bones.push(node);
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(node as THREE.SkinnedMesh);
    else if ((node as THREE.Mesh).isMesh) solid.push(node as THREE.Mesh);
  });
  const index = new Map(bones.map((bone, i) => [bone, i]));
  const joints: RigJoint[] = bones.map(bone => ({ name: bone.name, parent: index.get(bone.parent as THREE.Object3D) ?? -1 }));
  const shared = skinned.length ? gibPieces(joints, level) : null;
  const parts: CutPart[] = [];
  const material = (mesh: THREE.Mesh) => Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

  if (shared) {
    const made = shared.names.map((name): CutPart & { clouds: Float32Array[] } => ({ name, centre: [0, 0, 0], rotation: [0, 0, 0, 1], half: [0, 0, 0], neighbours: [], skins: [], props: [], clouds: [] }));
    for (const mesh of skinned) {
      const source = bakeSkin(mesh, bone => hidden?.has(bone) ? -1 : shared.owner[index.get(bone) ?? 0] ?? 0);
      if (!source) continue;
      for (const geometry of splitSkin(source, shared.names.length)) {
        const part = made[geometry.piece];
        part.skins.push({ geometry, material: material(mesh) }); part.clouds.push(geometry.positions);
        for (const other of geometry.neighbours) if (!part.neighbours.includes(other)) part.neighbours.push(other);
      }
    }
    // Pieces that own no skin are dropped, and the neighbours renumbered to match.
    const kept = made.filter(part => part.skins.length), renumber = new Map(kept.map((part, i) => [made.indexOf(part), i]));
    kept.forEach((part, i) => {
      part.rotation = decompose(bones[shared.root[made.indexOf(part)]].matrixWorld.elements).rotation;
      part.neighbours = part.neighbours.map(other => renumber.get(other)).filter((other): other is number => other !== undefined && other !== i);
      parts.push(part);
    });
    finish(parts as (CutPart & { clouds: Float32Array[] })[]);
    const held: { mesh: THREE.Mesh; size: number }[] = [];
    if (withProps) for (const mesh of solid) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      held.push({ mesh, size: mesh.geometry.boundingBox!.getSize(p).multiply(n.setFromMatrixScale(mesh.matrixWorld)).length() });
    }
    // Only real things (a spear, a shield), and the three biggest: a wound mark riding on a bone is not a piece.
    held.sort((a, b) => b.size - a.size);
    for (const { mesh } of held.filter(item => item.size > PROP_MIN).slice(0, PROP_LIMIT)) {
      // A weapon or a shield leaves the hand as it is: one piece, touching every other at the start, so it collides with none of them.
      const box = new THREE.Box3();
      box.copy(mesh.geometry.boundingBox!);
      const corners = new Float32Array(24);
      for (let c = 0; c < 8; c += 1) { p.set(c & 1 ? box.max.x : box.min.x, c & 2 ? box.max.y : box.min.y, c & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld); corners[c * 3] = p.x; corners[c * 3 + 1] = p.y; corners[c * 3 + 2] = p.z; }
      const rotation = decompose(mesh.matrixWorld.elements).rotation, fitted = fitBox([corners], rotation);
      const centre: V3 = fitted.centre, prop = new THREE.Mesh(mesh.geometry, mesh.material);
      // Its own world matrix, seen from the piece's frame: it keeps its size and the way it was turned.
      prop.matrixAutoUpdate = false;
      prop.matrix.compose(new THREE.Vector3(centre[0], centre[1], centre[2]), new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]), new THREE.Vector3(1, 1, 1)).invert().multiply(mesh.matrixWorld);
      prop.castShadow = true;
      parts.push({ name: mesh.name || "prop", centre, rotation, half: clampHalf(fitted.half), neighbours: parts.map((_, i) => i), skins: [], props: [prop] });
    }
    // The props pass through each other too.
    parts.forEach((part, i) => { if (part.props.length) parts.forEach((other, j) => { if (j !== i && !other.neighbours.includes(i)) other.neighbours.push(i); }); });
    return parts;
  }

  // No skeleton to cut along (or one with no limbs to tell apart): the figure is cut across its height into slabs.
  const whole = skinned.length ? skinned : solid;
  const made = Array.from({ length: GIB_SLABS }, (_, i): CutPart & { clouds: Float32Array[] } => ({ name: `slab${i}`, centre: [0, 0, 0], rotation: decompose(victim.visual.matrixWorld.elements).rotation, half: [0, 0, 0], neighbours: [], skins: [], props: [], clouds: [] }));
  const sources = whole.map(mesh => ({ mesh, source: (mesh as THREE.SkinnedMesh).isSkinnedMesh ? bakeSkin(mesh as THREE.SkinnedMesh, () => 0) : bakeSolid(mesh) })).filter(item => item.source);
  // One set of cuts for the whole figure: the slabs are measured over every mesh together, not mesh by mesh.
  let low = Infinity, high = -Infinity;
  for (const { source } of sources) for (let i = 1; i < source!.positions.length; i += 3) { low = Math.min(low, source!.positions[i]); high = Math.max(high, source!.positions[i]); }
  for (const { mesh, source } of sources) {
    const owner = slabOwners(source!.positions, GIB_SLABS, low, high);
    for (const geometry of splitSkin({ ...source!, owner }, GIB_SLABS)) {
      const part = made[geometry.piece];
      part.skins.push({ geometry, material: material(mesh) }); part.clouds.push(geometry.positions);
      for (const other of geometry.neighbours) if (!part.neighbours.includes(other)) part.neighbours.push(other);
    }
  }
  const kept = made.filter(part => part.skins.length), renumber = new Map(kept.map((part, i) => [made.indexOf(part), i]));
  kept.forEach((part, i) => { part.neighbours = part.neighbours.map(other => renumber.get(other)).filter((other): other is number => other !== undefined && other !== i); });
  finish(kept);
  return kept;
}

const clampHalf = (half: V3): V3 => [Math.max(0.012, half[0]), Math.max(0.012, half[1]), Math.max(0.012, half[2])];

/** Fits each piece its box and moves its skin into the box's own frame. */
function finish(parts: (CutPart & { clouds: Float32Array[] })[]): void {
  for (const part of parts) {
    const box = fitBox(part.clouds, part.rotation);
    part.centre = box.centre; part.half = clampHalf(box.half);
    for (const skin of part.skins) intoFrame(skin.geometry.positions, skin.geometry.normals, part.centre, part.rotation);
  }
}

/**
 * A skinned mesh as it is posed now, in world space, with the piece each
 * vertex goes to (by the bone that moves it most). The same blend the vertex
 * shader makes: bind matrix, the weighted bone matrices, and back out.
 */
function bakeSkin(mesh: THREE.SkinnedMesh, pieceOf: (bone: THREE.Bone) => number): { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; index: ArrayLike<number> | null; owner: Int16Array } | null {
  const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal"), uv = mesh.geometry.getAttribute("uv");
  const skinIndex = mesh.geometry.getAttribute("skinIndex"), skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!position || !skinIndex || !skinWeight) return null;
  mesh.skeleton.update();
  const B = mesh.skeleton.boneMatrices as Float32Array | null;
  if (!B) return null;
  const pre = mesh.bindMatrix.elements, post = m4.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).elements;
  const pieces = mesh.skeleton.bones.map(pieceOf);
  const count = position.count, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = uv ? new Float32Array(count * 2) : null, owner = new Int16Array(count);
  for (let v = 0; v < count; v += 1) {
    const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
    const nx = normal ? normal.getX(v) : 0, ny = normal ? normal.getY(v) : 1, nz = normal ? normal.getZ(v) : 0;
    // Into the bind frame: the point, and the normal as a direction.
    const bx = pre[0] * x + pre[4] * y + pre[8] * z + pre[12], by = pre[1] * x + pre[5] * y + pre[9] * z + pre[13], bz = pre[2] * x + pre[6] * y + pre[10] * z + pre[14];
    const dx = pre[0] * nx + pre[4] * ny + pre[8] * nz, dy = pre[1] * nx + pre[5] * ny + pre[9] * nz, dz = pre[2] * nx + pre[6] * ny + pre[10] * nz;
    let sx = 0, sy = 0, sz = 0, tx = 0, ty = 0, tz = 0, best = 0, most = -1, total = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = skinWeight.getComponent(v, k);
      if (!(w > 0)) continue;
      const bone = skinIndex.getComponent(v, k), o = bone * 16;
      sx += w * (B[o] * bx + B[o + 4] * by + B[o + 8] * bz + B[o + 12]); sy += w * (B[o + 1] * bx + B[o + 5] * by + B[o + 9] * bz + B[o + 13]); sz += w * (B[o + 2] * bx + B[o + 6] * by + B[o + 10] * bz + B[o + 14]);
      tx += w * (B[o] * dx + B[o + 4] * dy + B[o + 8] * dz); ty += w * (B[o + 1] * dx + B[o + 5] * dy + B[o + 9] * dz); tz += w * (B[o + 2] * dx + B[o + 6] * dy + B[o + 10] * dz);
      total += w;
      if (w > most) { most = w; best = bone; }
    }
    // A vertex no bone holds stays where the bind pose has it.
    if (total <= 0) { sx = bx; sy = by; sz = bz; tx = dx; ty = dy; tz = dz; }
    const wx = post[0] * sx + post[4] * sy + post[8] * sz + post[12], wy = post[1] * sx + post[5] * sy + post[9] * sz + post[13], wz = post[2] * sx + post[6] * sy + post[10] * sz + post[14];
    let ox = post[0] * tx + post[4] * ty + post[8] * tz, oy = post[1] * tx + post[5] * ty + post[9] * tz, oz = post[2] * tx + post[6] * ty + post[10] * tz;
    const l = Math.hypot(ox, oy, oz) || 1; ox /= l; oy /= l; oz /= l;
    positions[v * 3] = wx; positions[v * 3 + 1] = wy; positions[v * 3 + 2] = wz; normals[v * 3] = ox; normals[v * 3 + 1] = oy; normals[v * 3 + 2] = oz;
    if (uvs && uv) { uvs[v * 2] = uv.getX(v); uvs[v * 2 + 1] = uv.getY(v); }
    owner[v] = pieces[best] ?? 0;
  }
  return { positions, normals, uvs, index: mesh.geometry.index ? mesh.geometry.index.array : null, owner };
}

/** A mesh with no skeleton, in world space. */
function bakeSolid(mesh: THREE.Mesh): { positions: Float32Array; normals: Float32Array; uvs: Float32Array | null; index: ArrayLike<number> | null; owner: Int16Array } | null {
  const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal"), uv = mesh.geometry.getAttribute("uv");
  if (!position) return null;
  const count = position.count, positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = uv ? new Float32Array(count * 2) : null;
  m3.getNormalMatrix(mesh.matrixWorld);
  for (let v = 0; v < count; v += 1) {
    p.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
    if (normal) n.fromBufferAttribute(normal, v).applyMatrix3(m3).normalize(); else n.set(0, 1, 0);
    positions[v * 3] = p.x; positions[v * 3 + 1] = p.y; positions[v * 3 + 2] = p.z; normals[v * 3] = n.x; normals[v * 3 + 1] = n.y; normals[v * 3 + 2] = n.z;
    if (uvs && uv) { uvs[v * 2] = uv.getX(v); uvs[v * 2 + 1] = uv.getY(v); }
  }
  return { positions, normals, uvs, index: mesh.geometry.index ? mesh.geometry.index.array : null, owner: new Int16Array(count) };
}
