import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Claimant } from "../../../web/src/scene/vfx/mystic/claiming";

/**
 * The giant four-armed sorcerer behind the board, alive.
 *
 * The look package ships it as a frozen mesh (`Crownfall_Sorcerer_Deform` in extras.glb). The menu's model
 * (`models/crownfall-sorcerer.glb`) is the same sculpt on its rig, with its clips, so the rigged figure is stood
 * exactly where the frozen one stands, wears the frozen one's material (which already carries the arena's fog and
 * sky light), and the frozen one is hidden. If the rigged model is missing or is not the same sculpt, the statue stays.
 */
export interface ArenaSorcerer {
  /** Advances the figure by `seconds`. When `still` (reduced motion) it holds its pose and does not turn its head. */
  update(seconds: number, still: boolean): void;
  /** Turns its head toward a point in scene space; null lets it look ahead again. */
  watch(point: THREE.Vector3 | null): void;
  /** Plays the cast once toward `point`, then returns to idling. Returns the cast's length in seconds (0 if it has none). */
  cast(point: THREE.Vector3, hold?: number): number;
  /** The scene-space position of one of its four palms. */
  hand(which: SorcererHand, out: THREE.Vector3): THREE.Vector3;
  /** Where its face is. */
  head(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export type SorcererHand = "upperLeft" | "upperRight" | "lowerLeft" | "lowerRight";

const HAND_BONES: Record<SorcererHand, string> = {
  upperLeft: "UpperHand.L", upperRight: "UpperHand.R", lowerLeft: "mixamorig:LeftHand", lowerRight: "mixamorig:RightHand",
};
/** How far the neck and the head may each turn off the animated pose, and how quickly the gaze moves. */
const GAZE = { neck: THREE.MathUtils.degToRad(18), head: THREE.MathUtils.degToRad(32), follow: 3.2, settle: 2.4, hold: 6 };
const BLEND = 0.4;
/**
 * Slow motion laid over the clips. The model's own idle moves each arm by two or three degrees, which is nothing
 * from across the arena; this is the breath in its chest and the drift of its four arms, each on its own period so
 * the figure never repeats. Parents come before children. Axes are the figure's own: pitch nods forward, roll
 * lifts sideways, yaw turns.
 */
const LIFE: { bone: string; axis: "pitch" | "roll" | "yaw"; degrees: number; hertz: number; phase: number }[] = [
  { bone: "mixamorig:Spine", axis: "pitch", degrees: 1.1, hertz: 0.17, phase: 0 },
  { bone: "mixamorig:Spine", axis: "yaw", degrees: 1.8, hertz: 0.043, phase: 0.3 },
  { bone: "mixamorig:Spine1", axis: "pitch", degrees: 1.1, hertz: 0.17, phase: 0.04 },
  { bone: "mixamorig:Spine2", axis: "pitch", degrees: 1.3, hertz: 0.17, phase: 0.08 },
  { bone: "UpperArm.L", axis: "roll", degrees: 6, hertz: 0.083, phase: 0 },
  { bone: "UpperArm.L", axis: "pitch", degrees: 4, hertz: 0.061, phase: 0.4 },
  { bone: "UpperArm.R", axis: "roll", degrees: 6, hertz: 0.071, phase: 0.55 },
  { bone: "UpperArm.R", axis: "pitch", degrees: 4, hertz: 0.053, phase: 0.2 },
  { bone: "UpperForearm.L", axis: "pitch", degrees: 7, hertz: 0.097, phase: 0.7 },
  { bone: "UpperForearm.R", axis: "pitch", degrees: 7, hertz: 0.089, phase: 0.15 },
  { bone: "UpperHand.L", axis: "pitch", degrees: 8, hertz: 0.131, phase: 0.25 },
  { bone: "UpperHand.R", axis: "pitch", degrees: 8, hertz: 0.117, phase: 0.65 },
  { bone: "mixamorig:LeftArm", axis: "roll", degrees: 5, hertz: 0.067, phase: 0.8 },
  { bone: "mixamorig:RightArm", axis: "roll", degrees: 5, hertz: 0.079, phase: 0.35 },
  { bone: "mixamorig:LeftForeArm", axis: "pitch", degrees: 6, hertz: 0.101, phase: 0.6 },
  { bone: "mixamorig:RightForeArm", axis: "pitch", degrees: 6, hertz: 0.093, phase: 0.9 },
  { bone: "mixamorig:LeftHand", axis: "pitch", degrees: 7, hertz: 0.123, phase: 0.45 },
  { bone: "mixamorig:RightHand", axis: "pitch", degrees: 7, hertz: 0.109, phase: 0.05 },
];
/**
 * Where its eyes go when nothing on the board holds them. From its dais the whole board spans only a few degrees,
 * so following a move alone is invisible from the player's seat: the head wanders over the arena, and steadies on
 * the board when something happens there.
 */
const WANDER: typeof LIFE = [
  { bone: "mixamorig:Neck", axis: "yaw", degrees: 9, hertz: 0.037, phase: 0 },
  { bone: "mixamorig:Head", axis: "yaw", degrees: 10, hertz: 0.037, phase: 0.03 },
  { bone: "mixamorig:Head", axis: "pitch", degrees: 5, hertz: 0.061, phase: 0.4 },
];
/**
 * What the cast adds to the clip, which lifts the arms by under twenty degrees: the figure leans in over the board
 * and its arms go up and out. `side` entries turn away from the body on whichever side the arm hangs.
 */
const REACH: { bone: string; hand?: SorcererHand; axis: "pitch" | "roll"; degrees: number }[] = [
  { bone: "mixamorig:Spine1", axis: "pitch", degrees: 3 },
  { bone: "mixamorig:Spine2", axis: "pitch", degrees: 4 },
  { bone: "UpperArm.L", hand: "upperLeft", axis: "roll", degrees: 24 },
  { bone: "UpperArm.R", hand: "upperRight", axis: "roll", degrees: 24 },
  { bone: "mixamorig:LeftArm", hand: "lowerLeft", axis: "roll", degrees: 15 },
  { bone: "mixamorig:RightArm", hand: "lowerRight", axis: "roll", degrees: 15 },
];
/** The cast's envelope, in seconds from its start: the arms are up between `up` and `down`, unless the caller asks for a longer hold. */
const CAST = { rise: 0.25, up: 1.0, down: 2.1, rest: 2.9 };
const ramp = (from: number, to: number, value: number) => THREE.MathUtils.smoothstep(value, from, to);

const bone = (root: THREE.Object3D, name: string) => root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) ?? null;

/** The same sculpt: the two bind-pose boxes agree to within a few percent on every axis. */
function sameSculpt(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  a.computeBoundingBox(); b.computeBoundingBox();
  const sa = a.boundingBox!.getSize(new THREE.Vector3()), sb = b.boundingBox!.getSize(new THREE.Vector3());
  return [0, 1, 2].every((i) => Math.abs(sa.getComponent(i) - sb.getComponent(i)) <= 0.04 * Math.max(sa.getComponent(i), sb.getComponent(i)));
}

function discard(model: GLTF): void {
  model.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) discardMaterial(material);
  });
}

/** Frees a material the figure will never draw with, and the decoded images behind its textures. */
function discardMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    const texture = value as THREE.Texture | null;
    if (!texture?.isTexture) continue;
    (texture.image as { close?: () => void } | null)?.close?.();
    texture.dispose();
  }
  material.dispose();
}

export function reviveSorcerer(model: GLTF, frozen: THREE.Mesh): ArenaSorcerer | null {
  const rig = model.scene;
  const bodies: THREE.SkinnedMesh[] = [];
  rig.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) bodies.push(node as THREE.SkinnedMesh); });
  const idle = THREE.AnimationClip.findByName(model.animations, "Idle");
  if (bodies.length !== 1 || !idle || !frozen.parent || !sameSculpt(bodies[0].geometry, frozen.geometry)) {
    console.warn("[battlefield] the rigged sorcerer does not match the arena's statue; the statue stays");
    discard(model);
    return null;
  }
  const body = bodies[0];
  for (const material of Array.isArray(body.material) ? body.material : [body.material]) discardMaterial(material);
  body.material = frozen.material;
  body.castShadow = frozen.castShadow; body.receiveShadow = frozen.receiveShadow;
  body.renderOrder = frozen.renderOrder;
  // The bind-pose bounds say nothing about where four moving arms reach.
  body.frustumCulled = false;
  rig.position.copy(frozen.position); rig.quaternion.copy(frozen.quaternion); rig.scale.copy(frozen.scale);
  frozen.parent.add(rig);
  frozen.visible = false;

  const mixer = new THREE.AnimationMixer(rig);
  const idling = mixer.clipAction(idle);
  idling.play();
  const castClip = THREE.AnimationClip.findByName(model.animations, "Threat_Cast");
  const casting = castClip ? mixer.clipAction(castClip) : null;
  if (casting) { casting.setLoop(THREE.LoopOnce, 1); casting.clampWhenFinished = true; }
  const onFinished = (event: { action: THREE.AnimationAction }) => {
    if (event.action !== casting) return;
    idling.reset().play();
    casting.crossFadeTo(idling, BLEND, false);
  };
  mixer.addEventListener("finished", onFinished);

  // The head and neck, and which way each faces in its own frame while the figure stands at rest facing +Z.
  rig.updateWorldMatrix(true, true);
  const stance = rig.getWorldQuaternion(new THREE.Quaternion());
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(stance).normalize();
  const axes = { pitch: new THREE.Vector3(1, 0, 0).applyQuaternion(stance).normalize(), roll: ahead, yaw: new THREE.Vector3(0, 1, 0).applyQuaternion(stance).normalize() };
  const layer = (entries: typeof LIFE) => entries.flatMap((entry) => { const node = bone(rig, entry.bone); return node ? [{ ...entry, node, radians: THREE.MathUtils.degToRad(entry.degrees) }] : []; });
  const life = layer(LIFE), wander = layer(WANDER);
  const joints = [{ name: "mixamorig:Neck", limit: GAZE.neck }, { name: "mixamorig:Head", limit: GAZE.head }].flatMap(({ name, limit }) => {
    const node = bone(rig, name);
    if (!node) return [];
    const forward = ahead.clone().applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()).invert());
    return [{ node, limit, forward }];
  });
  const hands = Object.fromEntries(Object.entries(HAND_BONES).map(([key, name]) => [key, bone(rig, name)])) as Record<SorcererHand, THREE.Object3D | null>;
  // An arm lifts away from the body: which way that turns it depends on the side its hand hangs on.
  const centre = (bone(rig, "mixamorig:Hips") ?? rig).getWorldPosition(new THREE.Vector3());
  const reach = REACH.flatMap((entry) => {
    const node = bone(rig, entry.bone), palm = entry.hand ? hands[entry.hand] : null;
    if (!node || (entry.hand && !palm)) return [];
    const side = palm ? Math.sign(palm.getWorldPosition(new THREE.Vector3()).sub(centre).dot(axes.pitch)) || 1 : 1;
    return [{ node, axis: entry.axis, radians: THREE.MathUtils.degToRad(entry.degrees) * side }];
  });

  // Every bone this module turns by hand, with the pose the clips last gave it: what `still` holds it at.
  const posed = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const { node } of [...life, ...reach, ...joints]) posed.set(node, new THREE.Quaternion());
  const keep = () => { for (const [node, pose] of posed) pose.copy(node.quaternion); };
  const restore = () => { for (const [node, pose] of posed) node.quaternion.copy(pose); };
  mixer.update(0);
  keep();

  let target: THREE.Vector3 | null = null;
  const focus = new THREE.Vector3();
  let attention = 0, focused = false;
  const at = new THREE.Vector3(), facing = new THREE.Vector3(), want = new THREE.Vector3(), axis = new THREE.Vector3();
  const world = new THREE.Quaternion(), parent = new THREE.Quaternion(), turn = new THREE.Quaternion();
  let alive = 0, held = false, watched = 0, casted = -1, lower = CAST.down;
  const crown = bone(rig, "mixamorig:Head");

  /** Turns a bone about one of the figure's own axes, on top of whatever pose it has. */
  const lean = (node: THREE.Object3D, about: THREE.Vector3, radians: number) => {
    node.getWorldQuaternion(world).premultiply(turn.setFromAxisAngle(about, radians));
    node.parent!.getWorldQuaternion(parent);
    node.quaternion.copy(parent.invert().multiply(world));
  };

  const aim = (weight: number) => {
    for (const joint of joints) {
      joint.node.updateWorldMatrix(true, false);
      joint.node.getWorldPosition(at); joint.node.getWorldQuaternion(world);
      facing.copy(joint.forward).applyQuaternion(world).normalize();
      want.copy(focus).sub(at);
      if (want.lengthSq() < 1e-8) continue;
      want.normalize();
      const angle = Math.min(facing.angleTo(want), joint.limit) * weight;
      axis.crossVectors(facing, want);
      if (angle < 1e-4 || axis.lengthSq() < 1e-10) continue;
      world.premultiply(turn.setFromAxisAngle(axis.normalize(), angle));
      joint.node.parent!.getWorldQuaternion(parent);
      joint.node.quaternion.copy(parent.invert().multiply(world));
    }
  };

  return {
    update(seconds, still) {
      if (still) {
        // Reduced motion: the figure stands as it does at the start of its idle, whatever it was doing.
        restore();
        if (!held) { casting?.stop(); idling.reset().play(); mixer.update(0); keep(); held = true; casted = -1; }
        return;
      }
      held = false;
      // The mixer writes a bone only when its track's value changes, and several of this rig's tracks never do
      // (the neck, the hips): each frame starts from the pose the clips last gave, or the turns below would pile up.
      restore();
      mixer.update(seconds);
      keep();
      alive += seconds;
      const wave = (part: (typeof life)[number]) => part.radians * Math.sin(2 * Math.PI * (part.hertz * alive + part.phase));
      for (const part of life) lean(part.node, axes[part.axis], wave(part));
      if (casted >= 0) {
        casted += seconds;
        const rest = lower + CAST.rest - CAST.down;
        const power = ramp(CAST.rise, CAST.up, casted) * (1 - ramp(lower, rest, casted));
        if (casted > rest) casted = -1;
        else if (power > 1e-3) for (const part of reach) lean(part.node, axes[part.axis], part.radians * power);
      }
      if (target) {
        if (focused) focus.lerp(target, 1 - Math.exp(-seconds * GAZE.follow)); else { focus.copy(target); focused = true; }
        watched += seconds;
      }
      // What happened on the board holds its eyes for a few seconds; then they drift off over the arena again.
      const drawn = target && (watched < GAZE.hold || casted >= 0) ? 1 : 0;
      attention += (drawn - attention) * (1 - Math.exp(-seconds * GAZE.settle));
      if (attention < 0.999) for (const part of wander) lean(part.node, axes[part.axis], wave(part) * (1 - attention));
      if (focused && attention > 1e-3) aim(attention);
    },
    watch(point) {
      if (!point) { target = null; return; }
      if (!target || target.distanceToSquared(point) > 1e-6) watched = 0;
      target = (target ?? new THREE.Vector3()).copy(point);
    },
    cast(point, hold = CAST.down - CAST.up) {
      this.watch(point);
      watched = 0;
      if (held) return 0;
      const keep = Math.max(0, hold), fall = CAST.rest - CAST.down;
      if (casted >= CAST.rise && casted < lower) {
        // Hands already up, or on their way, for another piece: the gesture is not begun again, only held for longer.
        lower = Math.max(lower, Math.max(casted, CAST.up) + keep);
      } else if (casted >= lower && casted < lower + fall) {
        // Caught as they come down: they go back up from where they are.
        const power = 1 - ramp(lower, lower + fall, casted);
        casted = CAST.rise + (CAST.up - CAST.rise) * (0.5 - Math.sin(Math.asin(1 - 2 * power) / 3));
        lower = CAST.up + keep;
      } else {
        casted = 0; lower = CAST.up + keep;
        if (casting && castClip) { casting.reset().play(); idling.crossFadeTo(casting, BLEND, false); }
      }
      return lower + fall - casted;
    },
    hand(which, out) {
      const node = hands[which];
      return node ? node.getWorldPosition(out) : rig.getWorldPosition(out);
    },
    head(out) { return (crown ?? rig).getWorldPosition(out); },
    dispose() {
      mixer.removeEventListener("finished", onFinished);
      mixer.stopAllAction(); mixer.uncacheRoot(rig);
      rig.removeFromParent();
      body.geometry.dispose(); body.skeleton.dispose();
      frozen.visible = true;
    },
  };
}

/** How long the figure's hands take to come up after a cast. */
export const SORCERER_RISE = CAST.up;

/**
 * The sorcerer as the one who takes the fallen (web/src/scene/vfx/mystic/claiming.ts): it holds each thread in
 * an upper hand, the one on the body's side of it for choice, and raises its hands for as long as the ritual
 * needs them.
 */
export function claimantOf(sorcerer: ArenaSorcerer): Claimant {
  const left = new THREE.Vector3(), right = new THREE.Vector3();
  return {
    rise: SORCERER_RISE,
    cast(point, hold) { sorcerer.cast(point, hold); },
    grips(body) {
      sorcerer.hand("upperLeft", left); sorcerer.hand("upperRight", right);
      const order: SorcererHand[] = Math.abs(body.x - left.x) <= Math.abs(body.x - right.x) ? ["upperLeft", "upperRight"] : ["upperRight", "upperLeft"];
      return order.map((hand) => (out: THREE.Vector3) => sorcerer.hand(hand, out));
    },
    face(out) { return sorcerer.head(out); },
  };
}
