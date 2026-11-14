/**
 * Ragdoll deaths in the scene: the figure's own skeleton handed to the
 * physics world at the moment of death and driven by it until the body lies
 * still, then held exactly as it settled.
 *
 *   ragdolls.begin(victim, { blow, point, power })   // from knockDown(): true if physics took the fall
 *   ragdolls.update(delta)                            // every frame, after the pieces have animated
 *   ragdolls.clear()                                  // Undo, a new game, a rebuilt board
 *
 * The handover takes one frame: the pose is read when the death begins and
 * again on the next frame, and the difference is the speed each body starts
 * with, so the fall carries on from the hit reaction instead of starting from
 * rest. Bodies are made exactly on the bones, so that first frame cannot pop.
 *
 * Only this figure's own bones are written, and only while it lies dead.
 * When it stands again (Undo rebuilds it; the tray resets it) every bone is
 * given back the pose it had at the handover and the mixer takes over.
 */
import * as THREE from "three";
import type { PieceView } from "../../pieces";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { decompose, type Q4, type V3 } from "../physics/math";
import { RagdollSim } from "./RagdollSim";
import { mapRig, measureGirth, partOwners, planRagdoll, type BlowInput, type HeldBox, type PartName, type PartPlan, type RagdollPlan, type RigJoint, type RigPose } from "./ragdollPlan";

export interface RagdollRequest extends BlowInput {
  /** Standing height of the figure, scene units: sizes the single body of a figure with no skeleton. */
  height: number;
  /** Parts the figure no longer has (death/sever: a limb that came off): the ragdoll keeps no body for a hidden bone. */
  without?: readonly PartName[];
}

interface Rig {
  bones: THREE.Object3D[];
  joints: RigJoint[];
  bind: RigPose;
  /** Each bone's own position, rotation and scale as they were at the handover. */
  local: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[];
}

interface Entry {
  victim: PieceView;
  request: RagdollRequest;
  rig: Rig;
  /** One body for the whole figure: it had no skeleton, or one that could not be mapped. */
  rigid: boolean;
  options: { simpleArms: boolean; girth?: ReturnType<typeof measureGirth>; without?: readonly PartName[] };
  /** Broad things the figure holds (a shield), each with the bone it hangs from: given a body so they rest on the stone, not in it. */
  held: { mesh: THREE.Mesh; joint: number }[];
  before: RigPose;
  plan: RagdollPlan | null;
  sim: RagdollSim | null;
  /** Bone index of each part's joint, and each bone's part (or -1). */
  partOf: Int16Array;
  state: "handover" | "falling" | "lying";
  /** The pose it settled in, bone by bone, held until the figure leaves or stands again. */
  rest: { position: THREE.Vector3; quaternion: THREE.Quaternion }[];
  /** Where the figure stood when the fall began: if something else moves it, physics lets go. */
  home: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
  seconds: number;
  /** Where the trunk first came down on the stone, once it has; and who is waiting to be told (onTrunkDown). */
  down: THREE.Vector3 | null;
  waiting: ((at: THREE.Vector3) => void)[];
}

export interface RagdollStats { falling: number; lying: number; rigid: number; lastRest: number | null; lastParts: number }

const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), inverse = new THREE.Quaternion();
/** Where each bone stands in the world as the pose is written, parents first: reused by every ragdoll, every frame. */
const worldPosition: V3[] = [], worldRotation: Q4[] = [], worldScale: number[] = [];

export class RagdollSystem {
  private readonly entries: Entry[] = [];
  private simpleArms = false;
  /** Ragdolls that may be falling at once: the oldest is laid to rest where it is when another starts. */
  private limit = 2;
  private lastRest: number | null = null;
  private lastParts = 0;

  /** `world` builds the physics world on first use; null until Jolt has loaded. */
  constructor(private readonly world: () => PhysicsWorld | null) {}

  setBudget(simpleArms: boolean, limit: number): void { this.simpleArms = simpleArms; this.limit = limit; }

  /** True while any body is still being simulated. */
  get busy(): boolean { return this.entries.some(entry => entry.state !== "lying"); }
  get stats(): RagdollStats {
    return {
      falling: this.entries.filter(entry => entry.state !== "lying").length, lying: this.entries.filter(entry => entry.state === "lying").length,
      rigid: this.entries.filter(entry => entry.rigid).length, lastRest: this.lastRest, lastParts: this.lastParts,
    };
  }
  /** Whether this figure's fall is physics' (falling, or lying as it settled). */
  owns(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim); }
  /** Whether this figure is still on its way down. */
  falling(victim: PieceView): boolean { return this.entries.some(entry => entry.victim === victim && entry.state !== "lying"); }

  /**
   * Calls `then` once, on the frame this figure's trunk (its pelvis or chest) first comes down on the stone, with the
   * point on the stone under it; at once if it already has. False when no ragdoll has this figure's fall. A fall that
   * is let go or laid to rest before its trunk comes down never calls it.
   */
  onTrunkDown(victim: PieceView, then: (at: THREE.Vector3) => void): boolean {
    const entry = this.entries.find(found => found.victim === victim);
    if (!entry) return false;
    if (entry.down) then(entry.down.clone()); else entry.waiting.push(then);
    return true;
  }

  /**
   * Takes the fall of a figure that has just been killed. False when physics
   * cannot (not loaded, the figure is not on the board, or it has a skeleton
   * whose bones cannot be told apart): the caller then plays the fall it
   * always did. A figure with no skeleton at all falls as one body.
   */
  begin(victim: PieceView, request: RagdollRequest): boolean {
    if (!this.world() || !victim.container.parent || this.owns(victim)) return false;
    // Every matrix under the figure, the skins' bind matrices included, as of now.
    victim.container.updateMatrixWorld(true);
    const skeleton = readSkeleton(victim), rig = skeleton ?? figureRig(victim);
    const before = readPose(rig);
    const without = request.without?.length ? request.without : undefined;
    const mapped = skeleton ? planRagdoll(rig.joints, rig.bind, before, { simpleArms: this.simpleArms, without }) : null;
    if (skeleton && !mapped) return false;
    const options: Entry["options"] = { simpleArms: this.simpleArms, without };
    // A skin that cannot be read costs the measurement, not the ragdoll: the built-in proportions are used.
    // The skin of a limb that came off is folded into its stump and measures nothing.
    try { if (mapped) options.girth = measureGirth(mapped, partOwners(rig.joints, mapped), before, skinSamples(victim, rig, without ? cutJoints(rig.joints, mapped, without) : null)); } catch (error) { console.warn("[death] could not measure the figure's limbs", error); }
    while (this.entries.filter(entry => entry.state !== "lying").length >= this.limit) this.settle(this.entries.find(entry => entry.state !== "lying")!);
    this.entries.push({
      victim, request, rig, rigid: !mapped, options, before, held: mapped && !this.simpleArms ? heldThings(victim, rig) : [], plan: null, sim: null, partOf: new Int16Array(0), state: "handover", rest: [], seconds: 0,
      home: { position: victim.container.position.clone(), quaternion: victim.container.quaternion.clone(), scale: victim.container.scale.clone() },
      down: null, waiting: [],
    });
    return true;
  }

  /** After the world has stepped, and after the pieces have animated. */
  update(delta: number): void {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i], victim = entry.victim;
      // Gone from the board, or standing again: physics has no more say over it.
      if (!victim.container.parent || !victim.isSlain) { this.drop(entry, victim.container.parent !== null); continue; }
      const moved = !victim.container.position.equals(entry.home.position) || !victim.container.quaternion.equals(entry.home.quaternion) || !victim.container.scale.equals(entry.home.scale);
      if (entry.state === "handover") {
        if (moved || delta <= 0) { if (moved) this.drop(entry, true); continue; }
        this.start(entry, delta);
      } else if (entry.state === "falling") {
        entry.seconds += delta;
        // Something else is carrying the body off (the exit): it goes as it lies now.
        if (moved || entry.sim!.atRest) { this.pose(entry); this.settle(entry); }
        else { this.pose(entry); if (!entry.down) this.watchTrunk(entry); }
      }
      if (entry.state === "lying") this.hold(entry);
    }
  }

  /** The second half of the handover: the bodies are made on this frame's pose, moving as the animation moved them. */
  private start(entry: Entry, delta: number): void {
    const world = this.world();
    if (!world) { this.drop(entry, false); return; }
    entry.victim.container.updateMatrixWorld(true);
    const now = readPose(entry.rig);
    entry.rig.local.forEach((local, index) => { const bone = entry.rig.bones[index]; local.position.copy(bone.position); local.quaternion.copy(bone.quaternion); local.scale.copy(bone.scale); });
    const plan = entry.rigid ? rigidPlan(entry.request.height) : planRagdoll(entry.rig.joints, entry.rig.bind, now, { ...entry.options, held: entry.held.map(heldBox) });
    if (!plan) { this.drop(entry, false); return; }
    entry.plan = plan;
    entry.partOf = new Int16Array(entry.rig.bones.length).fill(-1);
    plan.parts.forEach((part, index) => { if (part.drives !== false) entry.partOf[part.joint] = index; });
    entry.sim = new RagdollSim(world, plan, now, entry.before, delta);
    entry.sim.blow(entry.request, entry.rigid);
    entry.state = "falling";
    this.lastParts = plan.parts.length;
  }

  /** Writes the bones from the bodies: the pelvis is placed, every other carried bone is turned, the rest keep the pose they had. */
  private pose(entry: Entry): void {
    const { rig, sim, partOf } = entry;
    for (let i = 0; i < rig.bones.length; i += 1) {
      const bone = rig.bones[i], parent = rig.joints[i].parent, local = rig.local[i], part = partOf[i];
      if (parent < 0) {
        // A bone with no bone above it hangs from the figure's own nodes, which physics does not move.
        const above = bone.parent!;
        above.updateWorldMatrix(true, false);
        const base = decompose(above.matrixWorld.elements);
        worldPosition[i] = base.position; worldRotation[i] = base.rotation; worldScale[i] = base.scale;
      } else {
        (worldPosition[i] ??= [0, 0, 0])[0] = worldPosition[parent][0]; worldPosition[i][1] = worldPosition[parent][1]; worldPosition[i][2] = worldPosition[parent][2];
        (worldRotation[i] ??= [0, 0, 0, 1])[0] = worldRotation[parent][0]; worldRotation[i][1] = worldRotation[parent][1]; worldRotation[i][2] = worldRotation[parent][2]; worldRotation[i][3] = worldRotation[parent][3];
        worldScale[i] = worldScale[parent];
      }
      // Slot i holds the parent's frame until this bone's own is written over it below.
      const at = worldPosition[i], turn = worldRotation[i], size = worldScale[i];
      q.set(turn[0], turn[1], turn[2], turn[3]); inverse.copy(q).invert();
      if (part >= 0) {
        const joint = sim!.joint(part);
        bone.quaternion.set(joint.rotation[0], joint.rotation[1], joint.rotation[2], joint.rotation[3]).premultiply(inverse);
        // Only the part with no parent is placed: a limb that was also placed would stretch whenever its joint gave a little.
        if (entry.plan!.parts[part].parent < 0) bone.position.set(joint.position[0] - at[0], joint.position[1] - at[1], joint.position[2] - at[2]).applyQuaternion(inverse).divideScalar(size);
        else bone.position.copy(local.position);
      } else { bone.quaternion.copy(local.quaternion); bone.position.copy(local.position); }
      p.copy(bone.position).multiplyScalar(size).applyQuaternion(q);
      q.multiply(bone.quaternion);
      at[0] += p.x; at[1] += p.y; at[2] += p.z;
      turn[0] = q.x; turn[1] = q.y; turn[2] = q.z; turn[3] = q.w;
      worldScale[i] = size * local.scale.x;
    }
  }

  /** The frame the trunk first comes down on the stone: whoever is waiting is told where. */
  private watchTrunk(entry: Entry): void {
    const at = entry.sim?.watchTrunk();
    if (!at) return;
    entry.down = new THREE.Vector3(at[0], at[1], at[2]);
    for (const then of entry.waiting.splice(0)) then(entry.down.clone());
  }

  /** The body is where it will lie: the pose is kept, and its bodies leave the world. */
  private settle(entry: Entry): void {
    if (entry.state === "lying") return;
    if (entry.state === "falling") { entry.rest = entry.rig.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() })); this.lastRest = entry.sim!.age; }
    else entry.rest = entry.rig.local.map(local => ({ position: local.position.clone(), quaternion: local.quaternion.clone() }));
    entry.sim?.release(); entry.sim = null; entry.waiting.length = 0;
    entry.state = "lying";
  }

  /** The animation still runs under a body that lies dead; what it writes is put back to the pose the body settled in. */
  private hold(entry: Entry): void {
    for (let i = 0; i < entry.rig.bones.length; i += 1) { const bone = entry.rig.bones[i], rest = entry.rest[i]; bone.position.copy(rest.position); bone.quaternion.copy(rest.quaternion); }
  }

  private drop(entry: Entry, restore: boolean): void {
    entry.sim?.release(); entry.sim = null; entry.waiting.length = 0;
    // Standing again: every bone gets back what it had before physics touched it, and the mixer animates from there.
    // (A figure that fell as one body is stood up by its own reset.)
    if (restore && !entry.rigid && entry.state !== "handover") entry.rig.bones.forEach((bone, index) => { const local = entry.rig.local[index]; bone.position.copy(local.position); bone.quaternion.copy(local.quaternion); bone.scale.copy(local.scale); });
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  /** Lets go of one figure: its bones go back to the pose they had at the handover. */
  release(victim: PieceView): void {
    const entry = this.entries.find(found => found.victim === victim);
    if (entry) this.drop(entry, true);
  }

  /** Undo, a new game, a rebuilt board: every body leaves the world. The figures themselves are rebuilt by the engine. */
  clear(): void {
    for (const entry of [...this.entries]) this.drop(entry, entry.victim.container.parent !== null && !entry.victim.isSlain);
    this.lastRest = null;
  }
}

/** The figure's bones, parents first, with the pose its mesh was skinned in. Null for a figure with no skeleton. */
function readSkeleton(victim: PieceView): Rig | null {
  const bones: THREE.Object3D[] = [];
  let skeleton: THREE.Skeleton | null = null;
  victim.visual.traverse(node => {
    if ((node as THREE.Bone).isBone) bones.push(node);
    if (!skeleton && (node as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (node as THREE.SkinnedMesh).skeleton;
  });
  if (bones.length < 2 || !skeleton) return null;
  const index = new Map(bones.map((bone, i) => [bone, i]));
  const joints = bones.map(bone => ({ name: bone.name, parent: index.get(bone.parent as THREE.Object3D) ?? -1 }));
  const rig = skeleton as THREE.Skeleton, bind: RigPose = { positions: [], rotations: [] };
  bones.forEach((bone, i) => {
    const at = rig.bones.indexOf(bone as THREE.Bone);
    // The bind pose is the inverse of the skin's own inverse; a bone the skin does not use stands where it does now.
    const pose = decompose(at >= 0 ? m.copy(rig.boneInverses[at]).invert().elements : bone.matrixWorld.elements);
    bind.positions[i] = pose.position; bind.rotations[i] = pose.rotation;
  });
  return { bones, joints, bind, local: bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() })) };
}

/** A held thing counts when it is broad (a shield, not a spear's shaft): this far across its second-longest side, scene units. At most two. */
const HELD_BROAD = 0.1, HELD_LIMIT = 2;
const box = new THREE.Box3(), size = new THREE.Vector3();

/** The broad things hanging from the figure's bones, biggest first. */
function heldThings(victim: PieceView, rig: Rig): Entry["held"] {
  const index = new Map(rig.bones.map((bone, i) => [bone, i]));
  const found: { mesh: THREE.Mesh; joint: number; broad: number }[] = [];
  victim.visual.traverseVisible(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    let above = mesh.parent;
    while (above && !index.has(above)) above = above.parent === victim.visual ? null : above.parent;
    if (!above) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const sides = mesh.geometry.boundingBox!.getSize(size).multiplyScalar(Math.abs(decompose(mesh.matrixWorld.elements).scale)).toArray().sort((a, b) => b - a);
    if (sides[1] >= HELD_BROAD) found.push({ mesh, joint: index.get(above)!, broad: sides[1] });
  });
  return found.sort((a, b) => b.broad - a.broad).slice(0, HELD_LIMIT);
}

/** Where a held thing's box is in the world now. */
function heldBox(held: Entry["held"][number]): HeldBox {
  const world = decompose(held.mesh.matrixWorld.elements), scale = Math.abs(world.scale);
  box.copy(held.mesh.geometry.boundingBox!);
  box.getCenter(p).applyMatrix4(held.mesh.matrixWorld); box.getSize(size);
  return { joint: held.joint, centre: [p.x, p.y, p.z], rotation: world.rotation, half: [Math.max(0.012, size.x * scale / 2), Math.max(0.012, size.y * scale / 2), Math.max(0.012, size.z * scale / 2)] };
}

/** A figure with no skeleton is one joint: the node the engine tips it over by. */
function figureRig(victim: PieceView): Rig {
  const node = victim.runtime;
  return { bones: [node], joints: [{ name: "figure", parent: -1 }], bind: { positions: [[0, 0, 0]], rotations: [[0, 0, 0, 1]] }, local: [{ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }] };
}

function readPose(rig: Rig): RigPose {
  const pose: RigPose = { positions: [], rotations: [] };
  rig.bones.forEach((bone, i) => { const world = decompose(bone.matrixWorld.elements); pose.positions[i] = world.position; pose.rotations[i] = world.rotation; });
  return pose;
}

/**
 * The joints of the parts a figure no longer has: each omitted part's own joint and every joint under it that no
 * kept part carries (an arm cut at the elbow keeps its upper arm's joint).
 */
function cutJoints(joints: readonly RigJoint[], plan: RagdollPlan, without: readonly PartName[]): Set<number> {
  const { key } = mapRig(joints);
  const kept = new Set(plan.parts.filter(part => part.drives !== false).map(part => part.joint));
  const roots: number[] = [];
  for (const name of without) {
    const side = name.slice(-1) as "L" | "R";
    const joint = name === "head" ? key.head : name.startsWith("arm") ? key[`arm${side}`] : name.startsWith("foreArm") ? key[`foreArm${side}`] : name.startsWith("thigh") ? key[`upLeg${side}`] : key[`leg${side}`];
    if (joint !== undefined && !kept.has(joint)) roots.push(joint);
  }
  const cut = new Set<number>();
  joints.forEach((_, index) => { for (let at = index; at >= 0; at = joints[at].parent) if (roots.includes(at)) { cut.add(index); return; } });
  return cut;
}

/** Points on the figure's skin as it stands now, each with the bone that moves it most: at most a few thousand, evenly spread. Joints in `skip` give none. */
function* skinSamples(victim: PieceView, rig: Rig, skip: ReadonlySet<number> | null = null): Generator<{ joint: number; x: number; y: number; z: number }> {
  const index = new Map(rig.bones.map((bone, i) => [bone, i]));
  const meshes: THREE.SkinnedMesh[] = [];
  victim.visual.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh); });
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position"), skinIndex = mesh.geometry.getAttribute("skinIndex"), skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) continue;
    mesh.skeleton.update();
    const stride = Math.max(1, Math.floor(position.count / 3000));
    for (let v = 0; v < position.count; v += stride) {
      let best = 0, weight = -1;
      for (let k = 0; k < 4; k += 1) { const w = skinWeight.getComponent(v, k); if (w > weight) { weight = w; best = skinIndex.getComponent(v, k); } }
      const joint = index.get(mesh.skeleton.bones[best]);
      if (joint === undefined || skip?.has(joint)) continue;
      mesh.getVertexPosition(v, p).applyMatrix4(mesh.matrixWorld);
      yield { joint, x: p.x, y: p.y, z: p.z };
    }
  }
}

/** A figure with no skeleton to speak of: one box, as tall as the figure, that topples and tumbles. */
function rigidPlan(height: number): RagdollPlan {
  const half: V3 = [height * 0.2, height * 0.5, height * 0.2];
  const part: PartPlan = { name: "pelvis", joint: 0, parent: -1, shape: { kind: "box", half }, mass: 70, centre: [0, height * 0.5, 0], frame: [0, 0, 0, 1], link: null };
  return { parts: [part], apart: [], height };
}
