/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DownfallPose, type DownfallClock } from "./downfallPose";
import { KNEEL_FRONT, KNEEL_SINK, KNEEL_STEP, KNEEL_TOTAL, type DefeatRole, type VictorRole } from "./downfallPlan";
import { PropFall, REST_GAP, lowestPoint, measureProp, withHull } from "./fallenProp";
import { DownfallStage, dropKindOf, type DownfallFigureView, type DownfallStageHooks } from "./downfallStage";

/**
 * The downfall's three.js half on the shipped rigs: a beaten figure kneels with its front foot where it stood,
 * its rear foot stepped (never slid) and its knee on the stone; a weapon falls to rest on the stone, never in
 * it; the stage releases, dims, skips and cancels cleanly. Textures are stripped so the rigs load in Node.
 */

const MODELS = resolve(process.cwd(), "../main game/public/models");
const HEIGHT = { p: 0.78, r: 0.98, n: 1.0, b: 1.04, q: 1.32, k: 1.48 } as const;

function glb(path: string): ArrayBuffer {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + length));
  delete json.images; delete json.textures; delete json.samplers;
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((name: string) => name !== "EXT_texture_webp");
  json.extensionsRequired = (json.extensionsRequired ?? []).filter((name: string) => name !== "EXT_texture_webp");
  for (const material of json.materials ?? []) {
    if (material.pbrMetallicRoughness) { delete material.pbrMetallicRoughness.baseColorTexture; delete material.pbrMetallicRoughness.metallicRoughnessTexture; }
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const head = Buffer.alloc(12), chunk = Buffer.alloc(8), bin = bytes.subarray(20 + length);
  chunk.writeUInt32LE(text.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + bin.length, 8);
  const out = Buffer.concat([head, chunk, Buffer.from(text), bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

/** A figure built as PieceView builds one: container on the square, the sculpt scaled to its height and facing the enemy. */
async function figure(army: string, kind: keyof typeof HEIGHT, color: "w" | "b", square = { x: 0.51, z: -3.57 }) {
  const loader = new GLTFLoader();
  const rig = await loader.parseAsync(glb(`${MODELS}/${army}/${kind}-rigged.glb`), "");
  const idle = (await loader.parseAsync(glb(`${MODELS}/${army}/${kind}-idle.glb`), "")).animations[0];
  const model = rig.scene;
  const container = new THREE.Group(), runtime = new THREE.Group(), visual = new THREE.Group();
  container.add(runtime); runtime.add(visual); visual.add(model);
  container.position.set(square.x, 0, square.z);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(idle).play(); mixer.update(0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse(node => { const mesh = node as THREE.SkinnedMesh; if (mesh.isSkinnedMesh) { mesh.computeBoundingBox(); box.union(mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)); } });
  const scale = HEIGHT[kind] / (box.max.y - box.min.y);
  model.scale.multiplyScalar(scale);
  model.position.y -= box.min.y * scale;
  // White faces -z, Black +z (PieceView.setFacing): the sculpt's own front is +z.
  if (color === "w") visual.rotation.y = Math.PI;
  container.updateMatrixWorld(true);
  const bones = new Map<string, THREE.Bone>();
  model.traverse(node => { if ((node as THREE.Bone).isBone) bones.set(node.name.toLowerCase().replace(/[^a-z0-9]/g, ""), node as THREE.Bone); });
  return { container, visual, model, mixer, bones, height: HEIGHT[kind] };
}

const role = (over: Partial<DefeatRole> = {}): DefeatRole => ({
  id: "x", square: "e8", kind: "k", royal: true, gesture: "kneel", rearSide: "left", start: 0, drop: 0.6, kneel: 1, breaks: 0.4,
  glance: { x: 0.51, z: 3.57 }, phase: 0.3, dim: { from: 0.4, to: 2 }, ...over,
});

const RIGS: [string, keyof typeof HEIGHT, "w" | "b"][] = [
  ["korvenia", "k", "b"], ["korvenia", "p", "w"], ["kwind09", "k", "w"], ["kwind09", "p", "b"], ["solforiz", "k", "b"], ["solforiz", "n", "w"],
];

describe.skipIf(!existsSync(`${MODELS}/korvenia/k-rigged.glb`))("a beaten figure kneels on the shipped rigs", () => {
  for (const [army, kind, color] of RIGS) it(`${army} ${kind} (${color}): front foot planted, rear foot stepped and then on its toes, knee on the stone`, async () => {
    const f = await figure(army, kind, color);
    const clock: DownfallClock = { time: 0 };
    const cast = { side: "defeat" as const, role: role({ kind, royal: kind === "k", rearSide: color === "w" ? "right" : "left" }) };
    const pose = new DownfallPose(f.container, f.visual, cast, clock, f.height);
    expect(pose.canKneel).toBe(true);
    const at = (name: string) => f.bones.get(name)!.getWorldPosition(new THREE.Vector3());
    const forward = f.visual.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const hips = at("hips");
    const sideOf = (name: string) => Math.sign(at(name).sub(hips).dot(right));
    // The foot already behind goes back (the plan's side only decides when the feet stand level).
    const ahead = (name: string) => at(name).sub(hips).dot(forward);
    const gap = ahead("leftfoot") - ahead("rightfoot");
    const rear = Math.abs(gap) > 0.05 * f.height ? (gap < 0 ? "left" : "right")
      : sideOf("leftupleg") === (cast.role.rearSide === "right" ? 1 : -1) ? "left" : "right";
    const front = rear === "left" ? "right" : "left";
    const frontStart = at(`${front}foot`), rearStart = at(`${rear}foot`), hipStart = hips.clone();
    const sample: { t: number; front: THREE.Vector3; rearBall: THREE.Vector3; rearAnkle: THREE.Vector3; knee: THREE.Vector3; hips: THREE.Vector3; low: number }[] = [];
    const before = f.bones.get("spine02")!.quaternion.clone();
    const end = cast.role.kneel + KNEEL_TOTAL + 0.3;
    for (let t = 0; t <= end + 1e-9; t += 1 / 60) {
      clock.time = t;
      // The stance is held on its first frame (PieceView.holdStance): the mixer samples the same pose every frame.
      pose.restore(); f.mixer.update(0); pose.apply();
      f.container.updateMatrixWorld(true);
      const low = Math.min(...["leftfoot", "rightfoot", "lefttoebase", "righttoebase", "leftleg", "rightleg"].map(name => at(name).y));
      sample.push({ t, front: at(`${front}foot`), rearBall: at(`${rear}toebase`), rearAnkle: at(`${rear}foot`), knee: at(`${rear}leg`), hips: at("hips"), low });
    }
    const frontEnd = sample[sample.length - 1].front;
    const forward0 = cast.role.kneel, rearStep = forward0 + KNEEL_FRONT, sinkFrom = rearStep + KNEEL_STEP;
    for (const s of sample) {
      // The front foot holds where it stood, or (when the kneel must move forward to fit the square) is lifted in its
      // own window and set down ahead, where it then holds: it never slides.
      if (s.t < forward0) expect(s.front.distanceTo(frontStart), `front foot at ${s.t.toFixed(2)}`).toBeLessThan(0.004 * f.height);
      if (s.t > rearStep + 0.02) expect(s.front.distanceTo(frontEnd), `front foot at ${s.t.toFixed(2)}`).toBeLessThan(0.004 * f.height);
      // The rear foot holds while the front one steps.
      if (s.t < rearStep) expect(s.rearAnkle.distanceTo(rearStart), `rear foot at ${s.t.toFixed(2)}`).toBeLessThan(0.004 * f.height);
      expect(Number.isFinite(s.hips.x + s.hips.y + s.hips.z)).toBe(true);
      expect(s.low, `nothing below the stone at ${s.t.toFixed(2)}`).toBeGreaterThan(-0.002);
    }
    if (frontEnd.distanceTo(frontStart) > 0.01 * f.height) {
      const lifted = sample.filter(s => s.t > forward0 + 0.08 && s.t < rearStep - 0.08);
      expect(Math.max(...lifted.map(s => s.front.y)) - frontStart.y, "the front foot is lifted to step, not dragged").toBeGreaterThan(0.01 * f.height);
      expect(frontEnd.clone().sub(frontStart).dot(forward), "and set down ahead").toBeGreaterThan(0);
    }
    // The step: the rear foot leaves the stone (it is lifted, not dragged) and lands behind.
    const stepping = sample.filter(s => s.t > rearStep + 0.1 && s.t < sinkFrom - 0.1);
    expect(Math.max(...stepping.map(s => s.rearAnkle.y)) - rearStart.y).toBeGreaterThan(0.01 * f.height);
    // The sink: the ball of the rear foot stays where it was set down while the heel rises.
    const sinking = sample.filter(s => s.t >= sinkFrom + 0.02);
    const ball = sinking[0].rearBall;
    for (const s of sinking) expect(s.rearBall.distanceTo(ball), `rear ball at ${s.t.toFixed(2)}`).toBeLessThan(0.002 * f.height);
    // On its toes at the end: the heel up off the stone and the foot standing steeply on its ball.
    const down = sinking[sinking.length - 1];
    expect(down.rearAnkle.y - rearStart.y).toBeGreaterThan(0.008 * f.height);
    expect(down.rearBall.clone().sub(down.rearAnkle).normalize().y).toBeLessThan(-0.8);
    // On its own square (half a square is 0.51): the rear foot rests no more than 0.46 behind its middle, the front
    // foot no more than 0.46 ahead of it, and neither passes the square's edge even in the air.
    for (const s of sample) {
      expect(-s.rearBall.clone().sub(f.container.position).dot(forward), `rear foot on the square at ${s.t.toFixed(2)}`).toBeLessThan(0.51);
      expect(s.front.clone().sub(f.container.position).dot(forward), `front foot on the square at ${s.t.toFixed(2)}`).toBeLessThan(0.51);
    }
    expect(-sample[sample.length - 1].rearBall.clone().sub(f.container.position).dot(forward)).toBeLessThan(0.465);
    // Down: the knee on the stone, the hips well down.
    const last = sample[sample.length - 1];
    expect(last.knee.y).toBeLessThan(0.06 * f.height);
    expect(last.knee.y).toBeGreaterThan(0.005 * f.height);
    expect(hipStart.y - last.hips.y).toBeGreaterThan(0.25 * hipStart.y);
    // The knee is heard when it comes down onto the stone: the figure says when, and that is when it arrives.
    const contact = pose.kneelContact!;
    const arrive = sample.find(s => s.t > sinkFrom && s.knee.y <= last.knee.y + 0.002 * f.height)!.t;
    expect(Math.abs(arrive - contact), `knee down at ${arrive.toFixed(3)}, heard at ${contact.toFixed(3)}`).toBeLessThan(1.5 / 60);
    // Restored exactly before the next sample.
    pose.restore();
    expect(f.bones.get("spine02")!.quaternion.angleTo(before)).toBeLessThan(1e-6);
  }, 20000);

  it("takes the body over from the living layer (glance, breath, the army's mood) as its own part begins, without a snap", async () => {
    const f = await figure("solforiz", "p", "b");
    const clock: DownfallClock = { time: 0 };
    const pose = new DownfallPose(f.container, f.visual, { side: "defeat", role: role({ kind: "p", royal: false, start: 2, breaks: 2.45, drop: 2.3, kneel: 2.6 }) }, clock, f.height);
    const weights: number[] = [];
    for (let t = 0; t <= 3.2; t += 1 / 60) { clock.time = t; weights.push(pose.livingWeight); expect(pose.ownsBody).toBe(t >= 2); }
    expect(weights[0]).toBe(1); expect(weights[Math.round(1.99 * 60)]).toBe(1); expect(weights[weights.length - 1]).toBe(0);
    for (let i = 1; i < weights.length; i += 1) expect(Math.abs(weights[i] - weights[i - 1]), `no snap at ${(i / 60).toFixed(2)} s`).toBeLessThan(0.06);
    const victor = new DownfallPose(f.container, f.visual, { side: "victor", role: { id: "v", square: "e1", kind: "p", gesture: "raise", start: 1, look: null, nod: null, phase: 0 }, longArm: false }, clock, f.height);
    expect(victor.ownsBody).toBe(false); expect(victor.livingWeight).toBe(1);
  }, 20000);

  it("a figure at rest keeps its pose for the frames that follow, breathing on the scene's clock", async () => {
    const f = await figure("solforiz", "p", "b");
    const clock: DownfallClock = { time: 0 };
    const cast = { side: "defeat" as const, role: role({ kind: "p", royal: false, start: 0, breaks: 0.45, drop: 0.3, kneel: 0.6 }) };
    const solved = new DownfallPose(f.container, f.visual, cast, clock, f.height);
    const frame = (pose: DownfallPose, t: number, elapsed: number) => { clock.time = t; pose.restore(); f.mixer.update(0); pose.apply(elapsed); f.container.updateMatrixWorld(true); };
    for (let t = 0; t <= 5; t += 1 / 30) frame(solved, t, t);
    const bones = [...f.bones.values()];
    const capture = () => bones.map(bone => bone.quaternion.clone());
    frame(solved, 5, 7.3); frame(solved, 5, 7.3); // the second frame is served from the kept pose
    const kept = capture();
    // A fresh figure solved straight to the same instant, with the same breath.
    solved.restore();
    const fresh = new DownfallPose(f.container, f.visual, cast, clock, f.height);
    for (let t = 0; t <= 5; t += 1 / 30) frame(fresh, t, t);
    frame(fresh, 5, 7.3);
    capture().forEach((q, i) => expect(q.angleTo(kept[i]), bones[i].name).toBeLessThan(1e-5));
    // It still breathes: another moment of the scene's clock moves the chest.
    frame(fresh, 5, 7.3); const a = f.bones.get("spine")!.quaternion.clone();
    frame(fresh, 5, 9.6); expect(f.bones.get("spine")!.quaternion.angleTo(a)).toBeGreaterThan(1e-3);
  }, 20000);

  it("a victor raises his weapon arm above his head, and lowers it partway afterwards", async () => {
    const f = await figure("kwind09", "p", "w");
    const clock: DownfallClock = { time: 0 };
    const victor: VictorRole = { id: "v", square: "e2", kind: "p", gesture: "raise", start: 0.2, look: null, nod: null, phase: 0 };
    const pose = new DownfallPose(f.container, f.visual, { side: "victor", role: victor, longArm: false }, clock, f.height);
    const hand = () => {
      const left = f.bones.get("lefthand")!.getWorldPosition(new THREE.Vector3()), right = f.bones.get("righthand")!.getWorldPosition(new THREE.Vector3());
      const forward = f.visual.getWorldDirection(new THREE.Vector3()), side = new THREE.Vector3(-forward.z, 0, forward.x);
      return left.clone().sub(f.container.position).dot(side) > right.clone().sub(f.container.position).dot(side) ? left : right;
    };
    const run = (t: number) => { clock.time = t; pose.restore(); f.mixer.update(0); pose.apply(); f.container.updateMatrixWorld(true); };
    run(0); const resting = hand().y;
    run(1.5); const raised = hand().y, head = f.bones.get("head")!.getWorldPosition(new THREE.Vector3()).y;
    run(6); const after = hand().y;
    expect(raised).toBeGreaterThan(head);
    expect(after).toBeLessThan(raised);
    expect(after).toBeGreaterThan(resting);
  }, 20000);
});

describe("a weapon let fall", () => {
  function prop() {
    const hand = new THREE.Group(); hand.position.set(0.3, 0.55, 0.1); hand.rotation.set(0.3, 0.2, -0.4);
    const group = new THREE.Group(); hand.add(group);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.012), new THREE.MeshStandardMaterial()); blade.position.y = 0.45; group.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.03), new THREE.MeshStandardMaterial()); group.add(guard);
    hand.updateMatrixWorld(true);
    return { hand, group };
  }
  it("falls under gravity, never goes into the stone, and rests flat on it exactly", () => {
    const { group } = prop();
    const shape = measureProp(group)!;
    expect(shape.longAxis).toBe(1); expect(shape.thinAxis).toBe(2);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    group.matrixWorld.decompose(position, quaternion, scale);
    const fall = new PropFall(shape, { position, quaternion, scale: scale.x }, { x: 0.6, z: 0.2, yaw: 0.4 }, 0);
    // It strikes the stone once, at the first instant it touches: just before, it is still in the air.
    expect(fall.contacts).toHaveLength(1);
    expect(fall.contacts[0].at).toBeGreaterThan(0.15); expect(fall.contacts[0].at).toBeLessThan(fall.duration);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    fall.pose(fall.contacts[0].at - 0.004, p, q); expect(lowestPoint(shape, p, q, scale.x)).toBeGreaterThan(REST_GAP + 1e-4);
    fall.pose(fall.contacts[0].at, p, q); expect(lowestPoint(shape, p, q, scale.x)).toBeCloseTo(REST_GAP, 5);
    let previous = Infinity;
    for (let t = 0; t <= fall.duration + 0.2; t += 1 / 120) {
      fall.pose(t, p, q);
      const low = lowestPoint(shape, p, q, scale.x);
      expect(low, `above the stone at ${t.toFixed(3)}`).toBeGreaterThanOrEqual(REST_GAP - 1e-9);
      if (t < fall.contacts[0].at - 0.02) { const height = p.y; expect(height).toBeLessThanOrEqual(previous + 1e-9); previous = height; }
    }
    fall.pose(fall.duration + 1, p, q);
    expect(lowestPoint(shape, p, q, scale.x)).toBeCloseTo(REST_GAP, 6);
    // Flat: its thinnest axis stands straight up, its length lies along the yaw it was given.
    const thin = new THREE.Vector3(0, 0, 1).applyQuaternion(q), along = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(Math.abs(thin.y)).toBeGreaterThan(0.9999);
    expect(Math.abs(along.y)).toBeLessThan(1e-6);
    expect(Math.abs(Math.sin(Math.atan2(along.x, along.z) - 0.4))).toBeLessThan(1e-6);
    // Its middle where the plan put it.
    const middle = shape.centre.clone().multiplyScalar(scale.x).applyQuaternion(q).add(p);
    expect(middle.x).toBeCloseTo(0.6, 6); expect(middle.z).toBeCloseTo(0.2, 6);
  });
  it("no vertex of it goes below the stone at any instant: a round shield falling tilted, rim and all", () => {
    const hand = new THREE.Group(); hand.position.set(-0.25, 0.62, 0.05); hand.rotation.set(1.1, 0.5, 0.35);
    const group = new THREE.Group(); hand.add(group);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.025, 40), new THREE.MeshStandardMaterial()); face.rotation.x = Math.PI / 2; group.add(face);
    // Its boss: a dome on the front face only, so it can lie on its rim (boss up) but would balance on the boss face down.
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial());
    boss.rotation.x = Math.PI / 2; boss.position.z = 0.0125; group.add(boss);
    hand.updateMatrixWorld(true);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    group.matrixWorld.decompose(position, quaternion, scale);
    const measured = measureProp(group)!;
    const shape = withHull(measured, group, "test-shield");
    expect(shape.points.length).toBeGreaterThan(measured.points.length);
    expect(withHull(measured, group, "test-shield").points).toBe(shape.points); // found once per kind of prop
    const vertices: THREE.Vector3[] = [];
    group.traverse(node => { const mesh = node as THREE.Mesh; if (!mesh.isMesh) return; const p = mesh.geometry.getAttribute("position"); const m = new THREE.Matrix4().copy(group.matrixWorld).invert().multiply(mesh.matrixWorld);
      for (let i = 0; i < p.count; i += 1) vertices.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m)); });
    const lowestVertex = (p: THREE.Vector3, q: THREE.Quaternion) => Math.min(...vertices.map(v => v.clone().multiplyScalar(scale.x).applyQuaternion(q).y + p.y));
    for (const yaw of [0, 0.7, 1.9, -2.4]) {
      const fall = new PropFall(shape, { position, quaternion, scale: scale.x }, { x: -0.5, z: 0.3, yaw }, 0);
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      for (let t = 0; t <= fall.duration + 0.1; t += 1 / 240) {
        fall.pose(t, p, q);
        expect(lowestVertex(p, q), `yaw ${yaw}, at ${t.toFixed(3)} s`).toBeGreaterThanOrEqual(REST_GAP - 1e-6);
      }
      fall.pose(fall.duration + 1, p, q);
      expect(lowestVertex(p, q)).toBeCloseTo(REST_GAP, 6);
      // On its rim, the boss up: the face that bulges never lies on the stone.
      expect(new THREE.Vector3(0, 0, 1).applyQuaternion(q).y).toBeGreaterThan(0.999);
      // It strikes at the first instant any vertex reaches the stone.
      fall.pose(fall.contacts[0].at, p, q); expect(lowestVertex(p, q)).toBeCloseTo(REST_GAP, 4);
      fall.pose(fall.contacts[0].at - 0.004, p, q); expect(lowestVertex(p, q)).toBeGreaterThan(REST_GAP + 1e-4);
    }
  });
  it("lands the same way every time from the same hand", () => {
    const run = () => {
      const { group } = prop(); const shape = measureProp(group)!;
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
      group.matrixWorld.decompose(position, quaternion, scale);
      const fall = new PropFall(shape, { position, quaternion, scale: scale.x }, { x: 0.6, z: 0.2, yaw: 0.4 }, 0);
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      return [0.1, 0.3, 0.5, 2].map(t => { fall.pose(t, p, q); return [...p.toArray(), ...q.toArray()].map(n => n.toFixed(9)); });
    };
    expect(run()).toEqual(run());
  });
});

describe("the stage", () => {
  function view(kind: DownfallFigureView["kind"], color: "w" | "b", square: { x: number; z: number }, armed = false) {
    const container = new THREE.Group(); container.position.set(square.x, 0, square.z);
    const hand = new THREE.Group(); hand.position.set(0.18, 0.5, 0); container.add(hand);
    const props: { group: THREE.Object3D; weapon: string; shield: boolean }[] = [];
    if (armed) {
      const group = new THREE.Group(); hand.add(group);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.01), new THREE.MeshStandardMaterial()); blade.position.y = 0.35; group.add(blade);
      props.push({ group, weapon: "longsword", shield: false });
    }
    const fallen = new THREE.Group(); container.add(fallen);
    const light: [number, number][] = [];
    const v = {
      container, kind, color, isSlain: false, standingHeight: HEIGHT[kind], holdsLongArm: false, measuredHeight: () => HEIGHT[kind] * 1.1,
      facing: (out: THREE.Vector3) => out.set(0, 0, color === "w" ? -1 : 1),
      beginDownfall: vi.fn(), holdStance: vi.fn(),
      downfallProps: () => props.filter(entry => entry.group.parent !== fallen),
      adoptFallen: (group: THREE.Object3D) => { fallen.attach(group); },
      setDownfallLight: vi.fn((insignia: number, shade: number) => { light.push([insignia, shade]); }),
      light, fallen,
    };
    return v;
  }
  const at = (square: string) => ({ x: ("abcdefgh".indexOf(square[0]) - 3.5) * 1.02, z: (3.5 - (Number(square[1]) - 1)) * 1.02 });
  function board() {
    const figures = [
      { square: "e8", view: view("k", "b", at("e8"), true) }, { square: "d8", view: view("q", "b", at("d8"), true) }, { square: "a7", view: view("p", "b", at("a7"), true) },
      { square: "e1", view: view("k", "w", at("e1"), true) }, { square: "f7", view: view("q", "w", at("f7"), true) },
    ];
    return figures;
  }
  /**
   * The mixer, faked: every sound with the stage's clock at the frame it was asked for. The floor is busy (the King
   * speaking) until `floorFreeAt`; a line said then lasts 2 s.
   */
  function ears(stage: () => DownfallStage, floorFreeAt = 0) {
    const heard: { what: string; t: number; pan: number; volume?: number; voice?: string; side?: string; event?: string }[] = [];
    const offered: { event: string; t: number }[] = [];
    let busyUntil = floorFreeAt;
    const hooks: DownfallStageHooks = {
      drop: (kind, o) => { heard.push({ what: `drop:${kind}`, t: stage().clock.time, pan: o.pan, volume: o.volume }); },
      kneel: (o) => { heard.push({ what: "kneel", t: stage().clock.time, pan: o.pan, volume: o.volume }); },
      armyLine: (side, event, o) => {
        const t = stage().clock.time;
        offered.push({ event, t });
        if (t < busyUntil) return null;
        busyUntil = t + 2;
        heard.push({ what: `line:${event}`, t, pan: o.pan, voice: o.voice, side, event });
        return 2;
      },
      pan: (x) => x / 10,
    };
    return { hooks, heard, offered };
  }
  const input = (figures: ReturnType<typeof board>, instant = false) => ({
    reason: "checkmate" as const, winner: "w" as const, threat: "f7", figures, squareSize: 1.02, ground: 0, instant, key: "checkmate:fen",
    camera: { origin: { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0, z: 0 }, fov: 46 }, lens: 46, aspect: 16 / 9, reach: 10.5 },
  });

  it("runs the beaten army's part in order: the stance stops, the hands open, the weapons come to rest, the light falls", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    const { hooks, heard } = ears(() => stage);
    stage = new DownfallStage(scene, hooks);
    const figures = board();
    const plan = stage.begin(input(figures))!;
    expect(plan.king.square).toBe("e8");
    for (const { view } of figures) expect(view.beginDownfall).toHaveBeenCalledOnce();
    expect(scene.getObjectByName("downfall_shade")).toBeTruthy();
    const king = figures[0].view, pawn = figures[2].view, victor = figures[3].view;
    expect(king.holdStance).toHaveBeenCalledOnce(); // the King's realization is at 0
    expect(pawn.holdStance).not.toHaveBeenCalled();
    for (let t = 0; t < plan.timeline.end + 0.5; t += 1 / 30) stage.update(1 / 30);
    expect(stage.finished).toBe(true);
    expect(pawn.holdStance).toHaveBeenCalledOnce();
    expect(victor.holdStance).not.toHaveBeenCalled();
    expect(victor.fallen.children).toHaveLength(0);
    for (const { view } of figures.filter(entry => entry.view.color === "b")) expect(view.fallen.children).toHaveLength(1);
    expect(stage.fallen.every(entry => entry.resting)).toBe(true);
    // Each beaten figure's insignia only ever fade, to nothing.
    for (const { view } of figures.filter(entry => entry.view.color === "b")) {
      const values = view.light.map(([insignia]) => insignia);
      for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] - 1e-12);
      expect(values[values.length - 1]).toBe(1);
    }
    expect(victor.setDownfallLight).not.toHaveBeenCalled();
    expect(stage.shadeStrength).toBeGreaterThan(0.3);
    const sounds = heard.map(entry => entry.what);
    expect(sounds.filter(name => name === "drop:blade").length).toBe(3); // three swords, each striking the stone once
    expect(sounds.filter(name => name === "kneel")).toHaveLength(2); // the King and the Pawn kneel; the Queen bows
    expect(sounds).toContain("line:despair"); expect(sounds).toContain("line:victory");
  });

  it("makes each sound at the frame it happens, panned from where it happens", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    const { hooks, heard } = ears(() => stage);
    stage = new DownfallStage(scene, hooks);
    const figures = board();
    const plan = stage.begin(input(figures))!;
    const frame = 1 / 60, ground = 0;
    const box = new THREE.Box3();
    const landed = new Map<THREE.Object3D, number>();
    for (let t = 0; t < plan.timeline.end + 0.5; t += frame) {
      stage.update(frame);
      // The first frame a weapon is on the stone is the frame its sound is asked for: not before, not after.
      for (const entry of stage.fallen) {
        if (landed.has(entry.group)) continue;
        box.setFromObject(entry.group, true);
        if (box.min.y <= ground + REST_GAP + 1e-3) landed.set(entry.group, stage.clock.time);
      }
    }
    const drops = heard.filter(entry => entry.what.startsWith("drop:"));
    expect(landed.size).toBe(3);
    expect(drops.map(entry => entry.t).sort((a, b) => a - b)).toEqual([...landed.values()].sort((a, b) => a - b));
    // Each panned from where that weapon lies, beside its owner.
    for (const drop of drops) {
      const owner = figures.filter(entry => entry.view.color === "b").map(entry => entry.view.container.position.x / 10);
      expect(Math.min(...owner.map(pan => Math.abs(pan - drop.pan)))).toBeLessThan(0.06);
    }
    // The knee meets the stone most of the way through the sink: heard in that frame, from that figure's square.
    const kneels = heard.filter(entry => entry.what === "kneel");
    expect(kneels).toHaveLength(2);
    for (const [role, figure] of [[plan.king, figures[0]], [plan.defeated.find(entry => entry.square === "a7")!, figures[2]]] as const) {
      const at = role.kneel + KNEEL_FRONT + KNEEL_STEP + KNEEL_SINK * 0.85;
      const sound = kneels.find(entry => entry.pan === figure.view.container.position.x / 10)!;
      expect(sound.t - at).toBeGreaterThanOrEqual(-1e-9); expect(sound.t - at).toBeLessThan(frame + 1e-9);
      expect(sound.volume).toBe(role.royal ? 1 : 0.7);
    }
  });

  it("lets the King speak first: the armies' lines wait for the floor, the victors' for the despair", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    // The King's words: endGame says them 1.5 s after the bell; say they last until 4.6 s.
    const { hooks, heard, offered } = ears(() => stage, 4.6);
    stage = new DownfallStage(scene, hooks);
    const figures = board();
    const plan = stage.begin(input(figures))!;
    for (let t = 0; t < plan.timeline.end + 0.5; t += 1 / 30) stage.update(1 / 30);
    const lines = heard.filter(entry => entry.what.startsWith("line:"));
    expect(lines.map(entry => entry.event)).toEqual(["despair", "victory"]);
    const [despair, victory] = lines;
    expect(offered[0].event).toBe("despair");
    expect(offered[0].t).toBeGreaterThanOrEqual(plan.timeline.spread + 0.3);
    expect(despair.t).toBeGreaterThanOrEqual(4.6); expect(despair.t).toBeLessThan(4.6 + 1 / 30 + 1e-9);
    expect(despair.side).toBe("b"); expect(["p1", "p2"]).toContain(despair.voice); // the beaten Pawn nearest the King
    expect(despair.pan).toBeCloseTo(figures[2].view.container.position.x / 10, 9);
    // The victors answer in the hold, in their sovereign's voice or their Queen's (no Pawn of theirs stands), from
    // where that figure stands.
    expect(victory.side).toBe("w"); expect(["k", "q"]).toContain(victory.voice);
    expect(victory.pan).toBeCloseTo(figures[victory.voice === "k" ? 3 : 4].view.container.position.x / 10, 9);
    expect(victory.t).toBeGreaterThanOrEqual(Math.max(despair.t + 2 + 0.35, plan.timeline.hold + 0.4) - 1e-9);
    expect(offered.every(entry => entry.event !== "victory" || entry.t >= Math.max(despair.t + 2.35, plan.timeline.hold + 0.4) - 1e-9)).toBe(true);
    expect(victory.t).toBeLessThan(plan.timeline.final);
    // Never offered twice once said; the same voices every time for the same board.
    expect(offered.filter(entry => entry.event === "despair" && entry.t > despair.t)).toHaveLength(0);
    const again = ears(() => stage2, 4.6);
    const stage2 = new DownfallStage(new THREE.Scene(), again.hooks);
    stage2.begin(input(board()));
    for (let t = 0; t < plan.timeline.end + 0.5; t += 1 / 30) stage2.update(1 / 30);
    expect(again.heard.filter(entry => entry.what.startsWith("line:")).map(entry => entry.voice)).toEqual(lines.map(entry => entry.voice));
  });

  it("says no army line its window never makes room for", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    const { hooks, heard, offered } = ears(() => stage, 1e9);
    stage = new DownfallStage(scene, hooks);
    const plan = stage.begin(input(board()))!;
    for (let t = 0; t < plan.timeline.end + 0.5; t += 1 / 30) stage.update(1 / 30);
    expect(heard.filter(entry => entry.what.startsWith("line:"))).toHaveLength(0);
    const despairs = offered.filter(entry => entry.event === "despair"), victories = offered.filter(entry => entry.event === "victory");
    expect(Math.max(...despairs.map(entry => entry.t))).toBeLessThan((plan.timeline.alone ?? plan.timeline.hold) + 2);
    expect(Math.min(...victories.map(entry => entry.t))).toBeGreaterThanOrEqual(Math.max((plan.timeline.alone ?? plan.timeline.hold) + 2, plan.timeline.hold + 0.4) - 1e-9);
    expect(Math.max(...victories.map(entry => entry.t))).toBeLessThan(plan.timeline.final);
  });

  it("hears each fallen weapon as what it is", () => {
    expect(dropKindOf("longsword", false)).toBe("blade");
    expect(dropKindOf("sabre", false)).toBe("blade");
    expect(dropKindOf("roundShield", true)).toBe("shield");
    expect(dropKindOf("musketBayonet", false)).toBe("musket");
    expect(dropKindOf("officerPistol", false)).toBe("musket");
    expect(dropKindOf("spear", false)).toBe("pole");
    expect(dropKindOf("crystalStaff", false)).toBe("pole");
  });

  it("skips to the final tableau at once and without a sound; cancel takes the shade off and keeps the ending's key", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    const { hooks, heard } = ears(() => stage);
    stage = new DownfallStage(scene, hooks);
    const figures = board();
    stage.begin(input(figures));
    stage.update(0.5);
    heard.length = 0;
    stage.skip();
    expect(stage.finished).toBe(true);
    expect(heard).toHaveLength(0);
    stage.update(1);
    expect(heard).toHaveLength(0);
    for (const { view } of figures.filter(entry => entry.view.color === "b")) { expect(view.holdStance).toHaveBeenCalled(); expect(view.fallen.children).toHaveLength(1); }
    expect(stage.fallen.every(entry => entry.resting)).toBe(true);
    stage.cancel();
    expect(scene.getObjectByName("downfall_shade")).toBeUndefined();
    expect(stage.active).toBe(false);
    expect(stage.stagedKey).toBe("checkmate:fen");
    stage.reset();
    expect(stage.stagedKey).toBeNull();
  });

  it("puts a rebuilt board straight into the same final tableau", () => {
    const scene = new THREE.Scene();
    let stage!: DownfallStage;
    const { hooks, heard } = ears(() => stage);
    stage = new DownfallStage(scene, hooks);
    const first = stage.begin(input(board()))!;
    stage.cancel();
    const figures = board();
    const again = stage.begin(input(figures, true))!;
    expect(again.key).toBe(first.key);
    expect(stage.finished).toBe(true);
    expect(heard).toHaveLength(0);
    for (const { view } of figures.filter(entry => entry.view.color === "b")) expect(view.holdStance).toHaveBeenCalledWith(0);
  });
});
