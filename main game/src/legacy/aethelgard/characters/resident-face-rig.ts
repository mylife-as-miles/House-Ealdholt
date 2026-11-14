import { Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import {
  FACE_JOINT_NAMES, FACE_MORPH_CHANNELS, type FaceJointKey, type FacePose,
} from '../../../../../shared/legacy/aethelgard/characters/face-performance';

/**
 * Applies a shared FacePose to one loaded resident (desktop, three).
 *
 * Bind once per actor clone (for example each EaldholtResidentActor.model), then call apply()
 * after the actor's mixer update every frame. Joint rotations are absolute (rest * pitch * yaw
 * in each face joint's local frame), so applying twice is idempotent. The published body clips
 * never key the face joints (the export drops those channels), so the rig is the only writer of
 * the jaw, eyes and lids: speech comes from the face input (visemes, or `talking` for the shared
 * babble), never from a clip. A level with the ARKit/viseme morphs (every published level since
 * round 2: desktop LOD0, LOD1 and Quest) drives blink, jaw, visemes and expressions through
 * morphTargetInfluences and uses the joints for gaze; a level without them (joints-only) drives
 * everything through the joints. No allocation per frame. The renderer
 * owner keeps the borrowed meshes; reset() restores the bind state and dispose() also releases
 * the rig's references to them.
 */
export type ResidentFaceTier = 'joints-and-morphs' | 'joints-only' | 'none';

export interface ResidentFaceRig {
  readonly tier: ResidentFaceTier;
  readonly joints: readonly FaceJointKey[];
  readonly morphMeshes: number;
  readonly disposed: boolean;
  apply(pose: FacePose): void;
  reset(): void;
  dispose(): void;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);

interface JointSlot { readonly key: FaceJointKey; readonly node: Object3D; readonly rest: Quaternion }
interface MorphSlot { readonly mesh: Mesh; readonly map: Int16Array }

export function bindResidentFaceRig(root: Object3D): ResidentFaceRig {
  const byName = new Map<string, Object3D[]>();
  const meshes: Mesh[] = [];
  root.traverse(node => {
    const list = byName.get(node.name);
    if (list) list.push(node); else byName.set(node.name, [node]);
    if ((node as Mesh).isMesh && (node as Mesh).morphTargetDictionary && (node as Mesh).morphTargetInfluences) meshes.push(node as Mesh);
  });
  const joints: JointSlot[] = [];
  for (const key of Object.keys(FACE_JOINT_NAMES) as FaceJointKey[]) {
    const found = byName.get(FACE_JOINT_NAMES[key]);
    if (!found) continue;
    if (found.length > 1) throw Error(`Face joint ${FACE_JOINT_NAMES[key]} is ambiguous in the resident.`);
    joints.push({ key, node: found[0], rest: found[0].quaternion.clone() });
  }
  const morphs: MorphSlot[] = [];
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary!;
    const map = new Int16Array(FACE_MORPH_CHANNELS.length).fill(-1);
    let any = false;
    FACE_MORPH_CHANNELS.forEach((channel, i) => {
      const index = dict[channel];
      if (index !== undefined) { map[i] = index; any = true; }
    });
    if (any) morphs.push({ mesh, map });
  }
  const blinkMorph = morphs.some(m => m.map[FACE_MORPH_CHANNELS.indexOf('eyeBlinkLeft')] >= 0);
  const tier: ResidentFaceTier = blinkMorph ? 'joints-and-morphs' : joints.length ? 'joints-only' : 'none';
  const pitch = new Quaternion(), yaw = new Quaternion();
  let disposed = false;

  function setJoint(slot: JointSlot, pitchRadians: number, yawRadians: number): void {
    pitch.setFromAxisAngle(AXIS_X, pitchRadians);
    yaw.setFromAxisAngle(AXIS_Z, yawRadians);
    slot.node.quaternion.copy(slot.rest).multiply(pitch).multiply(yaw);
  }

  function reset(): void {
    for (const slot of joints) slot.node.quaternion.copy(slot.rest);
    for (const { mesh, map } of morphs) for (let i = 0; i < map.length; i++) if (map[i] >= 0) mesh.morphTargetInfluences![map[i]] = 0;
  }

  return {
    tier,
    joints: Object.freeze(joints.map(j => j.key)),
    morphMeshes: morphs.length,
    get disposed() { return disposed; },
    apply(pose) {
      if (disposed) return;
      const j = pose.joints;
      for (const slot of joints) {
        switch (slot.key) {
          case 'eyeLeft': case 'eyeRight': setJoint(slot, j.eyePitch, j.eyeYaw); break;
          // with morphs, lids only follow gaze; blink closure comes from the eyeBlink morphs
          case 'lidUpperLeft': case 'lidUpperRight':
            setJoint(slot, tier === 'joints-and-morphs' ? j.eyePitch * 0.55 * (1 - pose.blink) : j.lidUpper, 0); break;
          case 'lidLowerLeft': case 'lidLowerRight':
            setJoint(slot, tier === 'joints-and-morphs' ? j.eyePitch * 0.25 * (1 - pose.blink) : j.lidLower, 0); break;
          case 'jaw': setJoint(slot, tier === 'joints-and-morphs' ? 0 : j.jaw, 0); break;
        }
      }
      for (const { mesh, map } of morphs) {
        const influences = mesh.morphTargetInfluences!;
        for (let i = 0; i < map.length; i++) if (map[i] >= 0) influences[map[i]] = pose.morphs[i];
      }
    },
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      // release the borrowed nodes and meshes so a disposed rig keeps no scene graph alive
      joints.length = 0;
      morphs.length = 0;
    },
  };
}
