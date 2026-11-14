/**
 * The figures a rite borrows from the Queen's army (rites/rite.ts RiteTroop), handled the same way by every army
 * summons: placed and turned on the board, asked for their clips (and asked again while a stride is still on its
 * way), and dressed in a look of the rite's own over their own sculpt, with everything put back as it was found.
 *
 * armies/crowdPlan.ts decides where a soldier is and what it is doing; this only carries that out on the figure.
 */
import * as THREE from "three";
import type { RiteTroop } from "../rite";
import type { Flat } from "./crowdPlan";

type Clip = "idle" | "walk" | "run" | "attack" | "death";

/**
 * Which way a lent figure faces before it is turned, along the board's z: the match stands White's army facing -z
 * and Black's +z (PieceFactory.create). The contract does not say which army a troop is of, so it is read off the
 * figure: its piece record, then its name; White's way when neither says.
 */
export function troopFront(object: THREE.Object3D): number {
  const piece = object.userData?.piece as { color?: string } | undefined;
  if (piece?.color === "b") return 1;
  if (piece?.color === "w") return -1;
  return /^piece_b/.test(object.name) ? 1 : -1;
}

/** The turn about the up axis that faces a figure whose own front is along z by `front` toward `heading`. */
export function yawToward(front: number, heading: Flat): number {
  return front < 0 ? Math.atan2(-heading.x, -heading.z) : Math.atan2(heading.x, heading.z);
}

/** The bone a figure's head hangs from, if its rig has one (the contact rig's own naming, contactIK.ts). */
export function findBone(object: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  object.traverse((node) => {
    if (found || !(node as THREE.Bone).isBone) return;
    if (node.name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^mixamorig\d*/, "") === name) found = node as THREE.Bone;
  });
  return found;
}

const shortestTurn = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * One borrowed figure under a rite's hand. It turns as a body does (fast, but not in one frame), plays the clip
 * it is asked for once and keeps it, and when a stride has not arrived yet it asks again a little later, walking
 * fast where it cannot yet run.
 */
export class TroopDriver {
  /** The figure's own front along z, and the turn it is at. */
  readonly front: number;
  yaw = 0;
  private clip: Clip | null = null;
  private rate = 0;
  private waiting: { clip: Clip; rate: number; at: number } | null = null;
  private runFailures = 0;
  private turned = false;

  constructor(readonly troop: RiteTroop) {
    this.front = troopFront(troop.object);
  }

  get object(): THREE.Object3D { return this.troop.object; }
  get playing(): Clip | null { return this.clip; }

  /** Stands it at `at` (scene units, its feet), `lift` above or below the stone, and turns it toward `heading`. */
  place(at: Flat, y: number, heading: Flat | null, seconds: number, turnRate = 9): void {
    const object = this.troop.object;
    object.position.set(at.x, y, at.z);
    if (heading && Math.hypot(heading.x, heading.z) > 1e-6) {
      const want = yawToward(this.front, heading);
      if (!this.turned) { this.yaw = want; this.turned = true; }
      else this.yaw += shortestTurn(this.yaw, want) * Math.min(1, seconds * turnRate);
    }
    object.rotation.set(0, this.yaw, 0);
  }

  /**
   * Leans it: forward (radians, toward where it faces) and to its side, and turns it `twist` off its heading for
   * this frame only (a twitch). Called after {@link place}.
   */
  lean(forward: number, side: number, twist = 0): void {
    const object = this.troop.object;
    // the figure's forward is its own z (by `front`) turned by the yaw: a turn about its own x tips its head that way,
    // and a turn about its own z tips it to its right
    object.rotation.set(0, 0, 0);
    object.rotateY(this.yaw + twist);
    object.rotateX(forward * this.front);
    object.rotateZ(side * this.front);
  }

  show(shown: boolean): void { this.troop.object.visible = shown; }

  /**
   * Asks for a looping clip (`idle`, `walk`, `run`) at `rate` steps a second. Nothing is played again while the same
   * clip runs at about the same rate. A stride that has not arrived is asked for again a fifth of a second later;
   * a run that will not come is walked fast meanwhile, and given up after a few tries.
   */
  loop(clip: "idle" | "walk" | "run", rate: number, now: number): void {
    if (clip === "run" && this.runFailures >= 4) { clip = "walk"; rate *= 1.3; }
    if (this.clip === clip && (clip === "idle" || Math.abs(rate - this.rate) <= this.rate * 0.35)) { this.waiting = null; return; }
    if (this.waiting && this.waiting.clip === clip && now < this.waiting.at) return;
    const length = this.troop.play(clip, rate);
    if (length > 0) { this.clip = clip; this.rate = rate; this.waiting = null; return; }
    this.waiting = { clip, rate, at: now + 0.2 };
    if (clip === "run") {
      this.runFailures += 1;
      if (this.clip !== "walk" && this.troop.play("walk", rate * 1.3) > 0) { this.clip = "walk"; this.rate = rate * 1.3; }
    }
  }

  /** Plays a clip once (`attack`, `death`) now. Returns its length in seconds, 0 when the figure has none. */
  once(clip: "attack" | "death"): number {
    const length = this.troop.play(clip);
    this.clip = length > 0 ? clip : this.clip;
    this.waiting = null;
    return length;
  }

  /** Forgets what it was playing, so the next {@link loop} plays afresh (after a one-shot handed it back to its stance). */
  release(): void { this.clip = null; this.rate = 0; }
}

/**
 * A look of the rite's own laid over a borrowed figure: every lit surface of its sculpt and its arms is given a
 * material made from its own (a shadow, a corpse), and given back when the rite is done. Only what this made is
 * freed; the figure's own materials are put back untouched. The ring under it and its shadow disc are not lit
 * surfaces and keep their own.
 */
export class TroopLook<M extends THREE.Material = THREE.Material> {
  readonly materials: M[] = [];
  private readonly swapped: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];

  constructor(object: THREE.Object3D, make: (original: THREE.MeshStandardMaterial, mesh: THREE.Mesh) => M) {
    const made = new Map<THREE.Material, M>();
    const dress = (material: THREE.Material, mesh: THREE.Mesh): THREE.Material => {
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
      let mine = made.get(material);
      if (!mine) { mine = make(material as THREE.MeshStandardMaterial, mesh); made.set(material, mine); this.materials.push(mine); }
      return mine;
    };
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const original = mesh.material;
      const next = Array.isArray(original) ? original.map((m) => dress(m, mesh)) : dress(original, mesh);
      if (next === original || (Array.isArray(next) && Array.isArray(original) && next.every((m, i) => m === original[i]))) return;
      this.swapped.push({ mesh, original });
      mesh.material = next;
    });
  }

  /** Puts the figure's own materials back and frees the ones made for it. */
  dispose(): void {
    for (const { mesh, original } of this.swapped) mesh.material = original;
    this.swapped.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}
