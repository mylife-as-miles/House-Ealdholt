/**
 * The four kingdoms' Pawn rigs for the death-physics tests, read straight
 * from the shipped files: joints and bind pose from `<rig>-skeleton.json`,
 * animated poses sampled from the combat-v2 GLB, posed in the world as the
 * engine stands a figure on the board. Node only (tests).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RigJoint, RigPose } from "../../web/src/scene/death/ragdoll/ragdollPlan";
import { add, qAxisAngle, qMul, qNormalize, qRotate, scale, type Q4, type V3 } from "../../web/src/scene/death/physics/math";

export type RigId = "wp" | "bp" | "ep" | "kp";
export const RIGS: readonly RigId[] = ["wp", "bp", "ep", "kp"];
interface Track { node: number; path: "position" | "quaternion"; times: Float32Array; values: Float32Array }
export interface TestRig {
  id: RigId;
  joints: RigJoint[];
  rest: { position: V3; rotation: Q4; scale: number }[];
  clips: Map<string, { duration: number; tracks: Track[] }>;
  /** Scene units per metre of the rig: what the engine scales the model by. */
  unitsPerMetre: number;
}
const file = (path: string) => readFileSync(fileURLToPath(new URL(`../../web/src/assets/chess/${path}`, import.meta.url)));
const cache = new Map<RigId, TestRig>();

export function loadRig(id: RigId): TestRig {
  const held = cache.get(id);
  if (held) return held;
  const skeleton = JSON.parse(file(`combat-v2/${id}-skeleton.json`).toString()) as { nodes: { name: string; parent: string | null; translation?: V3; rotation?: Q4; scale?: V3 }[] };
  // Parents before children, so a pose can be composed in one pass.
  const byName = new Map(skeleton.nodes.map(node => [node.name, node]));
  const ordered: typeof skeleton.nodes = [];
  const visit = (node: (typeof skeleton.nodes)[number]) => { if (ordered.includes(node)) return; if (node.parent) visit(byName.get(node.parent)!); ordered.push(node); };
  skeleton.nodes.forEach(visit);
  const joints = ordered.map(node => ({ name: node.name, parent: node.parent ? ordered.findIndex(other => other.name === node.parent) : -1 }));
  const rest = ordered.map(node => ({ position: (node.translation ?? [0, 0, 0]) as V3, rotation: (node.rotation ?? [0, 0, 0, 1]) as Q4, scale: node.scale?.[0] ?? 1 }));

  const bytes = file(`combat-v2/${id}.glb`), jsonLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const floats = (index: number): Float32Array => {
    const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView], width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type as "SCALAR" | "VEC3" | "VEC4"];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), out = new Float32Array(accessor.count * width);
    for (let i = 0; i < out.length; i += 1) out[i] = bin.readFloatLE(start + i * 4);
    return out;
  };
  const clips = new Map<string, { duration: number; tracks: Track[] }>();
  for (const animation of doc.animations as { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[]) {
    const tracks: Track[] = [];
    for (const channel of animation.channels) {
      if (channel.target.path !== "translation" && channel.target.path !== "rotation") continue;
      const node = joints.findIndex(joint => joint.name === doc.nodes[channel.target.node].name), sampler = animation.samplers[channel.sampler];
      if (node >= 0) tracks.push({ node, path: channel.target.path === "translation" ? "position" : "quaternion", times: floats(sampler.input), values: floats(sampler.output) });
    }
    clips.set(animation.name, { duration: Math.max(...tracks.map(track => track.times[track.times.length - 1])), tracks });
  }
  const sockets = JSON.parse(file("combat-v1/prop-sockets-kingdoms.json").toString()).archetypes[id];
  const rig: TestRig = { id, joints, rest, clips, unitsPerMetre: sockets.normalizationScale };
  cache.set(id, rig);
  return rig;
}

export interface Stand { x: number; z: number; /** Radians about the vertical; 0 faces +z. */ yaw: number }

/** The rig's joints in the world: the bind pose (`clip` null) or a clip at `time`, standing at `stand`. */
export function poseRig(rig: TestRig, clip: string | null, time: number, stand: Stand = { x: 0, z: 0, yaw: 0 }): RigPose {
  const local = rig.rest.map(joint => ({ position: [...joint.position] as V3, rotation: [...joint.rotation] as Q4, scale: joint.scale }));
  const playing = clip ? rig.clips.get(clip) : null;
  if (clip && !playing) throw new Error(`${rig.id} has no clip ${clip}`);
  for (const track of playing?.tracks ?? []) {
    const width = track.path === "position" ? 3 : 4, last = track.times.length - 1;
    let i = 0; while (i < last && track.times[i + 1] <= time) i += 1;
    const j = Math.min(last, i + 1), t = j === i ? 0 : Math.min(1, Math.max(0, (time - track.times[i]) / (track.times[j] - track.times[i])));
    const a = track.values.subarray(i * width, i * width + width), b = track.values.subarray(j * width, j * width + width);
    if (width === 3) local[track.node].position = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    else {
      const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
      local[track.node].rotation = qNormalize([a[0] + (b[0] * sign - a[0]) * t, a[1] + (b[1] * sign - a[1]) * t, a[2] + (b[2] * sign - a[2]) * t, a[3] + (b[3] * sign - a[3]) * t]);
    }
  }
  const positions: V3[] = [], rotations: Q4[] = [], scales: number[] = [];
  const base = { position: [stand.x, 0, stand.z] as V3, rotation: qAxisAngle([0, 1, 0], stand.yaw), scale: rig.unitsPerMetre };
  rig.joints.forEach((joint, index) => {
    const parent = joint.parent < 0 ? base : { position: positions[joint.parent], rotation: rotations[joint.parent], scale: scales[joint.parent] };
    positions[index] = add(parent.position, qRotate(parent.rotation, scale(local[index].position, parent.scale)));
    rotations[index] = qMul(parent.rotation, local[index].rotation);
    scales[index] = parent.scale * local[index].scale;
  });
  return { positions, rotations };
}

/**
 * A shipped figure's own skeleton, read from its rigged GLB (main game/public/models/<kingdom>/<kind>-rigged.glb):
 * the skin's joints, the bind pose from its inverse bind matrices, and the rest pose standing on the board at
 * `height` scene units tall. Aethelgard's figures load from the network and are not in the repository.
 */
export function loadModelRig(kingdom: "solforiz" | "korvenia" | "kwind09", kind: string, height: number, stand: Stand = { x: 0, z: 0, yaw: 0 }): { joints: RigJoint[]; bind: RigPose; rest: RigPose } {
  const bytes = readFileSync(fileURLToPath(new URL(`../../main game/public/models/${kingdom}/${kind}-rigged.glb`, import.meta.url)));
  const jsonLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)), bin = bytes.subarray(20 + jsonLength + 8);
  const skin = doc.skins[0] as { joints: number[]; inverseBindMatrices: number };
  const parentOf = new Map<number, number>();
  (doc.nodes as { children?: number[] }[]).forEach((node, index) => (node.children ?? []).forEach(child => parentOf.set(child, index)));
  // World transform of every node in the file's own units, parents first.
  const world = new Map<number, { position: V3; rotation: Q4; scale: number }>();
  const resolve = (index: number): { position: V3; rotation: Q4; scale: number } => {
    const done = world.get(index);
    if (done) return done;
    const node = doc.nodes[index] as { translation?: V3; rotation?: Q4; scale?: V3 };
    const parent = parentOf.has(index) ? resolve(parentOf.get(index)!) : { position: [0, 0, 0] as V3, rotation: [0, 0, 0, 1] as Q4, scale: 1 };
    const made = {
      position: add(parent.position, qRotate(parent.rotation, scale(node.translation ?? [0, 0, 0], parent.scale))),
      rotation: qMul(parent.rotation, node.rotation ?? [0, 0, 0, 1]), scale: parent.scale * (node.scale?.[0] ?? 1),
    };
    world.set(index, made);
    return made;
  };
  const joints: RigJoint[] = skin.joints.map(node => ({ name: doc.nodes[node].name as string, parent: skin.joints.indexOf(parentOf.get(node) ?? -1) }));
  const poses = skin.joints.map(resolve);
  // Stood on the board: feet at the stone, `height` tall, where `stand` says.
  const low = Math.min(...poses.map(pose => pose.position[1])), high = Math.max(...poses.map(pose => pose.position[1])), size = height / (high - low), turn = qAxisAngle([0, 1, 0], stand.yaw);
  const rest: RigPose = {
    positions: poses.map(pose => add([stand.x, 0, stand.z], qRotate(turn, scale([pose.position[0], pose.position[1] - low, pose.position[2]], size)))),
    rotations: poses.map(pose => qMul(turn, pose.rotation)),
  };
  // The bind pose: each joint's inverse bind matrix, inverted. Only its directions are used, so the rotation and the offset are enough.
  const accessor = doc.accessors[skin.inverseBindMatrices], view = doc.bufferViews[accessor.bufferView], start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 64;
  const bind: RigPose = { positions: [], rotations: [] };
  skin.joints.forEach((_, index) => {
    const m = Array.from({ length: 16 }, (_unused, k) => bin.readFloatLE(start + index * stride + k * 4));
    const inverse = decomposeRigid(m);
    bind.rotations[index] = [-inverse.rotation[0], -inverse.rotation[1], -inverse.rotation[2], inverse.rotation[3]];
    bind.positions[index] = scale(qRotate(bind.rotations[index], inverse.position), -1 / inverse.scale);
  });
  return { joints, bind, rest };
}

function decomposeRigid(m: number[]): { position: V3; rotation: Q4; scale: number } {
  const s = Math.hypot(m[0], m[1], m[2]) || 1;
  const x: V3 = [m[0] / s, m[1] / s, m[2] / s], y: V3 = [m[4] / s, m[5] / s, m[6] / s], z: V3 = [m[8] / s, m[9] / s, m[10] / s];
  const trace = x[0] + y[1] + z[2];
  let q: Q4;
  if (trace > 0) { const k = 0.5 / Math.sqrt(trace + 1); q = [(y[2] - z[1]) * k, (z[0] - x[2]) * k, (x[1] - y[0]) * k, 0.25 / k]; }
  else if (x[0] > y[1] && x[0] > z[2]) { const k = 2 * Math.sqrt(1 + x[0] - y[1] - z[2]); q = [0.25 * k, (y[0] + x[1]) / k, (z[0] + x[2]) / k, (y[2] - z[1]) / k]; }
  else if (y[1] > z[2]) { const k = 2 * Math.sqrt(1 + y[1] - x[0] - z[2]); q = [(y[0] + x[1]) / k, 0.25 * k, (z[1] + y[2]) / k, (z[0] - x[2]) / k]; }
  else { const k = 2 * Math.sqrt(1 + z[2] - x[0] - y[1]); q = [(z[0] + x[2]) / k, (z[1] + y[2]) / k, 0.25 * k, (x[1] - y[0]) / k]; }
  return { position: [m[12], m[13], m[14]], rotation: qNormalize(q), scale: s };
}
