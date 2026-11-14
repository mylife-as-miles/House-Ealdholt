/**
 * The bonded wyvern of the Aethelgard queen, and its run.
 *
 * The beast is the rigged model "main game/public/models/crownfall-wyvern.glb"
 * ("Zagmatorah - An Ancient Dragon" by Seth Santos, CC BY 4.0; see the
 * CREDITS file beside it). Its one clip, Fly_Cycle, is a single wingbeat. The
 * run scrubs that clip to the wingbeats in wyvern-path.ts and then layers its
 * own poses on the bones: wings folded back for the dive, the flare, legs
 * thrown down and forward, talons opening and clutching, the jaw, the head
 * holding the prey in its eye, the tail trailing the turn.
 *
 * It is driven only by update(dt). It never reads a clock, so the match can
 * step it and a preview can render it frame by frame.
 *
 * The group's frame: +Z is the nose, +Y is the back, +X is the left wing. The
 * group's origin is the middle of the trunk.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import { loadGltf } from "../gltfQueue";
import {
  WYVERN_DOWNSTROKE,
  WYVERN_FLOOR,
  WYVERN_GRIP,
  WYVERN_TIMING,
  createWyvernPath,
  wyvernBeats,
  wyvernFlap,
  type WyvernBeats,
  type WyvernCarry,
  type WyvernFlap,
  type WyvernPath,
} from "./wyvern-path";

export { wyvernBeats, WYVERN_TIMING };
export type { WyvernBeats, WyvernCarry };

/** What createWyvern needs from a loaded glTF. A GLTFLoader result fits. */
export interface WyvernModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** Where the match serves the model from (Vite's public folder). */
export const WYVERN_MODEL_URL = "models/crownfall-wyvern.glb";

/** Wingspan in world units. The model's own is about 26; a chess figure is under 2. */
export const WYVERN_WINGSPAN = 14;

export interface WyvernOptions {
  /** A URL to the GLB, or an already loaded glTF (so the match can preload it). Defaults to WYVERN_MODEL_URL. */
  model?: string | WyvernModel;
  /** Wingspan in world units. Defaults to WYVERN_WINGSPAN. */
  wingspan?: number;
  /** Top of the board; nothing of the wyvern goes below it. Defaults to BOARD_TOP (0). */
  floor?: number;
  /** Render layer for the meshes. Defaults to 0, the gameplay layer. */
  layer?: number;
  /** Strength of the built-in rim light, 1 by default. */
  rim?: number;
  /** Set false to keep the model's own sandy colours instead of Aethelgard's charcoal and oxblood. */
  tint?: boolean;
}

export interface WyvernRunEvents {
  /** The jaw opens for a screech. `index` is 0 for the hunting screech before the dive and 1 for the triumph after an "eat". */
  screech?(t: number, index: number): void;
  /** A downstroke starts. `index` counts from 0 through the run. */
  wingbeat?(t: number, index: number): void;
  /** The talons close on the target. `talons` is exactly on the target when this fires. */
  strike?(t: number): void;
  /** "eat" only: the jaws clamp on the victim. `jaws` is on the victim's attach point (`talons`) when this fires: move the victim across. */
  bite?(t: number): void;
  /** "eat" only: a violent shake of the head. `index` counts from 0. */
  tear?(t: number, index: number): void;
  /** The victim is let go: from the jaws for "eat", from the talons for "drop". Never for "away". */
  release?(t: number): void;
  /** The wyvern has left; the run promise resolves right after. */
  gone?(t: number): void;
}

export interface WyvernRunPlan {
  /** High in the sky behind the queen. */
  from: THREE.Vector3;
  /** The victim's chest. */
  target: THREE.Vector3;
  /** Where it leaves the arena. */
  away: THREE.Vector3;
  /** Defaults to "eat", the queen's rite. */
  carry?: WyvernCarry;
  seed?: number;
  /** "eat" only: where the body hovers while it feeds, to suit the camera. Defaults to a few metres up, just past the victim's square. */
  hover?: THREE.Vector3;
  /** "eat" only: a point the wyvern turns to face while it feeds, so the camera sees the bite. Defaults to `from`. */
  face?: THREE.Vector3;
  events?: WyvernRunEvents;
}

/** Weights of the layered poses, each 0..1. For looking at a pose while idle. */
export interface WyvernPoseWeights {
  /** Position in the wingbeat, 0..1 from the top of the stroke. */
  flapPhase: number;
  /** Wings folded back for the dive. */
  dive: number;
  /** Wings forward and cupped, body reared. */
  flare: number;
  /** Legs thrown down and forward. */
  reach: number;
  /** Legs hanging with a load. */
  hang: number;
  /** Talons open (1) or clenched (0). */
  open: number;
  jaw: number;
  /** Reared in a hover. */
  hover: number;
  /** Legs drawn up and neck curled down until the jaws meet the talons. */
  feed: number;
  /** Head thrown to one side (-1..1). */
  shake: number;
}

export interface Wyvern {
  group: THREE.Group;
  /** Socket between the feet. Attach the victim here from `strike` to `release` (or to `bite` for "eat"). */
  talons: THREE.Object3D;
  /** Socket inside the mouth; it turns with the head. For "eat", attach the victim here from `bite` to `release`. */
  jaws: THREE.Object3D;
  /** Distance between `jaws` and `talons` when the last bite fired, in world units (NaN before any bite). */
  readonly biteError: number;
  /** Advances the creature by dt seconds. The only thing that moves it. */
  update(dt: number): void;
  /** Flies one run. Resolves when the wyvern has left the arena. Waits for the model if it is still loading. */
  run(plan: WyvernRunPlan): Promise<void>;
  dispose(): void;
  /** Resolves when the model is loaded and the creature can be drawn. Rejects if the GLB cannot be loaded. */
  ready: Promise<void>;
  /** Beat times of a run, for scheduling sound. Same numbers as wyvernBeats(). */
  beats(carry?: WyvernCarry): WyvernBeats;
  /** Holds a pose while idle (null goes back to the idle flight). Not used during a run. */
  pose(weights: Partial<WyvernPoseWeights> | null): void;
  /** Run time of the current run in seconds, or -1 when idle. */
  readonly time: number;
  readonly stats: { triangles: number; drawCalls: number; bones: number };
}

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);

function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** Smoothstep from a to b. */
function ramp(x: number, a: number, b: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------- the model's own numbers

/** The model's wingspan at its widest point in Fly_Cycle, in its own units. */
const MODEL_WINGSPAN = 25.9;
/** Middle of the trunk in the model's root space (it faces -Z there, +Y up). */
const MODEL_CENTRE = v3(0, 3.8, 0.6);
/** Fly_Cycle, as a fraction of its length: the wings are highest here and lowest half a cycle later. */
const CLIP_TOP = 0.3;
/** How far either side of the top the wings are level with the back. */
const CLIP_LEVEL = 0.27;
/** Seconds per wingbeat when idling at the default wingspan. */
const IDLE_BEAT = 1.05;

// Root-space axes of the model.
const ROOT_FORWARD = v3(0, 0, -1);
const ROOT_UP = v3(0, 1, 0);
const ROOT_X = v3(1, 0, 0);
const ROOT_Z = v3(0, 0, 1);

/** Layered pose angles, radians. Tuned by eye against the preview. */
const TUNE = {
  /** Dive: how far the wing bones go back to the model's folded rest pose, and the sweep at the shoulder. */
  diveFold: 0.5,
  diveSweep: 0.55,
  diveRaise: 0.25,
  /** Flare: wings swung forward, lifted and cupped against the air. */
  flareSweep: -0.4,
  flareRaise: 0.5,
  flareTwist: 0.6,
  flarePitch: 0.6,
  /** Legs: how far they come down out of the tuck, then the swing at the hip. */
  reachDown: 0.85,
  reachSwing: 0.7,
  hangDown: 0.9,
  hangSwing: 0.1,
  /** Feet brought together under the body so both grip one figure. */
  legsIn: 0.3,
  clawOpen: 0.5,
  clawClench: -0.55,
  jaw: 0.55,
  /** Extra stroke per unit of wingbeat power above 1. */
  powerStroke: 0.6,
  /** Hover: the trunk reared, and how far it bobs with each beat. */
  hoverPitch: 1.0,
  hoverBob: 0.16,
  /** Feed: where the search for "jaws on the talons" starts (neck curl, hip swing), and the head's throw to the side. */
  feedCurl: -2.8,
  feedSwing: 0.4,
  shake: 1.3,
  /** The whole beast is wrenched with each tear: a roll, and a lurch to that side. */
  shakeRoll: 0.28,
  shakeLurch: 0.4,
  /** Share of the curl taken by the trunk, and the stretch of the shin and foot toward the mouth. */
  feedTrunk: 0.25,
  feedKnee: 0.6,
  feedFoot: 0.3,
  /** How far the jaw can close on a body. */
  jawFull: 0.3,
  triumphLift: 0.35,
};

// ---------------------------------------------------------------- material

interface WyvernUniforms {
  uRim: { value: THREE.Color };
  uFill: { value: THREE.Color };
  uFade: { value: number };
}

/**
 * Keeps the beast readable against a black sky with almost no light on it:
 * a sky-weighted fresnel rim and a faint self fill from above. `uFade` is a
 * screen-door fade, so the meshes stay opaque and sort like everything else.
 */
function patchMaterial(material: THREE.MeshStandardMaterial, uniforms: WyvernUniforms, key: string): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;\nuniform vec3 uFill;\nuniform float uFade;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
	{
		if ( uFade < 0.999 ) {
			float wyDither = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
			if ( wyDither > uFade ) discard;
		}
		vec3 wyN = normalize( normal );
		vec3 wyV = normalize( vViewPosition );
		vec3 wySky = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		float wyUp = 0.5 + 0.5 * dot( wyN, wySky );
		float wyRim = pow( 1.0 - clamp( abs( dot( wyN, wyV ) ), 0.0, 1.0 ), 3.0 );
		totalEmissiveRadiance += diffuseColor.rgb * uFill * wyUp + uRim * wyRim * ( 0.3 + 0.7 * wyUp );
	}`,
      );
  };
  material.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------- the creature

interface WingRig {
  /** +1 for the left wing, -1 for the right. */
  sign: number;
  shoulder: THREE.Object3D;
  /** Everything from the upper arm out, blended toward the folded rest pose in the dive. */
  chain: THREE.Object3D[];
  /** Joints checked against the board: [bone, the bone before it or null]. The tip is extrapolated past the last bone. */
  probes: [THREE.Object3D, THREE.Object3D | null][];
}

interface LegRig {
  sign: number;
  upper: THREE.Object3D;
  /** Hip to foot, blended toward the standing rest pose to bring the leg down. */
  chain: THREE.Object3D[];
  toes: THREE.Object3D[];
  hallux: THREE.Object3D;
  /** Base of the middle toe: the palm. */
  palm: THREE.Object3D;
}

export function createWyvern(options: WyvernOptions = {}): Wyvern {
  const floor = options.floor ?? WYVERN_FLOOR;
  const rimStrength = options.rim ?? 1;
  const wingspan = options.wingspan ?? WYVERN_WINGSPAN;
  const scale = wingspan / MODEL_WINGSPAN;
  /** The grip offset in wyvern-path.ts was measured at the default wingspan. */
  const grip = { up: (WYVERN_GRIP.up * wingspan) / WYVERN_WINGSPAN, back: (WYVERN_GRIP.back * wingspan) / WYVERN_WINGSPAN };

  const group = new THREE.Group();
  group.name = "aethelgard-wyvern";
  const talons = new THREE.Object3D();
  talons.name = "wyvern-talons";
  group.add(talons);
  const jaws = new THREE.Object3D();
  jaws.name = "wyvern-jaws";
  group.add(jaws);
  /** Turns the model to face +Z, scales it and centres its trunk on the group. */
  const holder = new THREE.Group();
  holder.name = "wyvern-holder";
  holder.rotation.y = Math.PI;
  holder.scale.setScalar(scale);
  holder.position.set(MODEL_CENTRE.x * scale, -MODEL_CENTRE.y * scale, MODEL_CENTRE.z * scale);
  group.add(holder);

  const fade = { value: 1 };
  const stats = { triangles: 0, drawCalls: 0, bones: 0 };

  // Filled when the model arrives.
  let model: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  let clipLength = 1;
  let bones: THREE.Object3D[] = [];
  let restQuat: THREE.Quaternion[] = [];
  /** What the mixer last wrote, so our overrides never pile up on a frame it skips. */
  let clipQuat: THREE.Quaternion[] = [];
  const boneIndex = new Map<THREE.Object3D, number>();
  let wings: WingRig[] = [];
  let legs: LegRig[] = [];
  let tail: THREE.Object3D[] = [];
  let neck: THREE.Object3D[] = [];
  let spine: THREE.Object3D[] = [];
  let head: THREE.Object3D | null = null;
  let jaw: THREE.Object3D | null = null;
  let mouth: THREE.Object3D | null = null;
  const ownMaterials: THREE.Material[] = [];
  const ownSkeletons: THREE.Skeleton[] = [];
  /** Set when this wyvern loaded the GLB itself and so also owns its geometries and textures. */
  let ownedSource: THREE.Object3D | null = null;

  // ---------------------------------------------------------------- state

  const pose = {
    flapPhase: 0,
    power: 1,
    dive: 0,
    flare: 0,
    reach: 0,
    hang: 0,
    open: 0,
    jaw: 0,
    track: 0,
    rear: 0, // radians the trunk is reared above its flight line
    hover: 0,
    feed: 0,
    shake: 0,
    lift: 0, // head thrown up for the triumph
    lock: 0, // talons pulled onto the target
    fade: 1,
  };
  /** The feed's two unknowns, kept between frames: total neck curl and hip swing that put the jaws on the talons. */
  let feedCurl = TUNE.feedCurl;
  let feedSwing = TUNE.feedSwing;
  let biteError = Number.NaN;
  /** Through the current wingbeat, 0..1 with the downstroke as the first half. */
  let through = 0;
  let held: Partial<WyvernPoseWeights> | null = null;
  const flapOut: WyvernFlap = { amount: 0, phase: 0, power: 1, index: -1, rising: false };

  const forward = v3(0, 0, 1);
  let bank = 0;
  let tailYaw = 0;
  let tailPitch = 0;
  let climb = 0;
  let fresh = true;
  const look = new THREE.Quaternion();

  interface RunEvent {
    t: number;
    fire(): void;
    /** Pose the creature at exactly t before firing. */
    exact?: boolean;
  }
  interface Run {
    path: WyvernPath;
    beats: WyvernBeats;
    target: V3;
    events: RunEvent[];
    cursor: number;
    resolve(): void;
  }
  let run: Run | null = null;
  let time = -1;
  let lastPosed = 0;
  let idleTime = 0;
  let disposed = false;

  // Scratch.
  const tmpA = v3();
  const tmpB = v3();
  const tmpC = v3();
  const tmpD = v3();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const qD = new THREE.Quaternion();
  const IDENTITY = new THREE.Quaternion();
  const tmpM = new THREE.Matrix4();
  const pathPos = v3();
  const pathVel = v3();
  const pathAcc = v3();
  const WORLD_UP = v3(0, 1, 0);
  const X_AXIS = v3(1, 0, 0);
  const Z_AXIS = v3(0, 0, 1);

  // ---------------------------------------------------------------- building

  function adopt(source: WyvernModel, owned: boolean): void {
    if (disposed) {
      if (owned) disposeSource(source.scene);
      return;
    }
    if (owned) ownedSource = source.scene;
    const cloned = cloneSkinned(source.scene);
    model = cloned;
    holder.add(cloned);

    const byName = new Map<string, THREE.Object3D>();
    cloned.traverse((object) => {
      // "Shoulder_l_030" -> "Shoulder_l". The "_end" leaves are not part of the skin.
      const match = /^(.*?)_0?\d+$/.exec(object.name);
      if (match && !/_end$/.test(match[1]) && !byName.has(match[1])) byName.set(match[1], object);
    });
    const find = (name: string): THREE.Object3D => {
      const bone = byName.get(name);
      if (!bone) throw new Error(`wyvern: the model has no bone "${name}"`);
      return bone;
    };

    const materials = new Map<THREE.Material, THREE.Material>();
    const rim = new THREE.Color(0.66, 0.38, 0.3).multiplyScalar(0.42 * rimStrength);
    cloned.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false; // the bounds are those of the bind pose
      if (options.layer !== undefined) mesh.layers.set(options.layer);
      if (mesh.isSkinnedMesh && !ownSkeletons.includes(mesh.skeleton)) ownSkeletons.push(mesh.skeleton);
      const index = mesh.geometry.getIndex();
      stats.triangles += (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
      stats.drawCalls += 1;
      const original = mesh.material as THREE.MeshStandardMaterial;
      let mine = materials.get(original) as THREE.MeshStandardMaterial | undefined;
      if (!mine) {
        mine = original.clone();
        materials.set(original, mine);
        ownMaterials.push(mine);
        const name = original.name;
        const tint = options.tint !== false;
        if (name === "DragonEye") {
          // Embers.
          mine.emissive = new THREE.Color(1.0, 0.36, 0.08);
          mine.emissiveIntensity = 1.6;
          mine.transparent = false;
          mine.depthWrite = true;
        } else if (name === "DragonWing") {
          if (tint) mine.color.setRGB(0.34, 0.12, 0.115);
          // Cut-out rather than blended: the membranes sort correctly against everything in the match.
          mine.transparent = false;
          mine.alphaTest = 0.35;
          mine.depthWrite = true;
          mine.side = THREE.DoubleSide;
          mine.roughness = Math.max(mine.roughness, 0.7);
        } else if (tint) {
          mine.color.setRGB(0.2, 0.155, 0.165);
        }
        const uniforms: WyvernUniforms = {
          uRim: { value: name === "DragonWing" ? rim.clone().multiplyScalar(1.15) : rim },
          uFill: { value: new THREE.Color(0.5, 0.42, 0.46).multiplyScalar(name === "DragonWing" ? 0.36 : 0.3) },
          uFade: fade,
        };
        if (name !== "DragonEye") patchMaterial(mine, uniforms, `wyvern-${name}`);
      }
      mesh.material = mine;
    });

    cloned.traverse((object) => {
      if ((object as THREE.Bone).isBone) {
        boneIndex.set(object, bones.length);
        bones.push(object);
      }
    });
    stats.bones = bones.length;
    restQuat = bones.map((bone) => bone.quaternion.clone());
    clipQuat = bones.map((bone) => bone.quaternion.clone());

    for (const [sign, s] of [[1, "l"], [-1, "r"]] as const) {
      const shoulder = find(`Shoulder_${s}`);
      const arm = ["UpperArm", "ArmConnection", "ForeArm", "Arm", "Finger"].map((n) => find(`${n}_${s}`));
      const fingers = ["Wing0101", "Wing0102", "Wing0103", "Wing0201", "Wing0202", "Wing0203", "Wing0301", "Wing0302", "Wing0303", "Wing0401", "Wing0402"].map((n) => find(`${n}_${s}`));
      const probes: [THREE.Object3D, THREE.Object3D | null][] = [];
      for (let f = 0; f < 3; f += 1) {
        probes.push([fingers[f * 3 + 1], null], [fingers[f * 3 + 2], fingers[f * 3 + 1]]);
      }
      probes.push([fingers[10], fingers[9]], [arm[3], null]);
      wings.push({ sign, shoulder, chain: [...arm, ...fingers], probes });

      const chain = ["UpperLeg", "LegConnection", "ForeLeg", "ForeLegConnection", "FeetConnection", "Feet"].map((n) => find(`${n}_${s}`));
      legs.push({
        sign,
        upper: chain[0],
        chain,
        toes: [find(`Claw01_${s}`), find(`Claw02_${s}`), find(`Claw03_${s}`)],
        hallux: find(`Claw04_${s}`),
        palm: find(`Claw02_${s}`),
      });
    }
    tail = ["Tail01", "Tail02", "Tail03", "Tail04", "Tail05", "Tail06", "Tail07", "Tail08", "Tail09", "Tail10"].map(find);
    neck = ["Neck03", "Neck02", "Neck01"].map(find);
    spine = ["Spine02", "Spine01"].map(find);
    head = find("Head");
    jaw = byName.get("LowerHead") ?? null;
    mouth = byName.get("Tongue02") ?? byName.get("Tongue01") ?? head;

    const clip = THREE.AnimationClip.findByName(source.animations, "Fly_Cycle") ?? source.animations[0];
    if (!clip) throw new Error("wyvern: the model has no flight clip");
    clipLength = clip.duration;
    mixer = new THREE.AnimationMixer(cloned);
    action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    fresh = true;
    poseNow();
  }

  function disposeSource(root: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.dispose();
    });
    for (const texture of textures) texture.dispose();
  }

  const source = options.model ?? WYVERN_MODEL_URL;
  const ready: Promise<void> =
    typeof source === "string"
      ? loadGltf(new GLTFLoader(), source).then((gltf) => adopt(gltf, true))
      : Promise.resolve().then(() => adopt(source, false));
  // A failed load is reported to whoever awaits `ready` or `run`; it must not also be an unhandled rejection.
  ready.catch(() => undefined);

  // ---------------------------------------------------------------- bone helpers

  /** Orientation of a bone's parent in the model's root space. */
  function parentQuat(bone: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    let parent = bone.parent;
    while (parent && parent !== holder) {
      out.premultiply(parent.quaternion);
      parent = parent.parent;
    }
    return out;
  }

  /** Turns a bone about an axis given in the model's root space (it faces -Z, +Y up, its left is -X). */
  function turn(bone: THREE.Object3D, axis: V3, angle: number): void {
    if (Math.abs(angle) < 1e-5) return;
    parentQuat(bone, qA);
    qB.setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(qA).premultiply(qB).premultiply(qA.invert());
  }

  function turnBy(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
    parentQuat(bone, qA);
    bone.quaternion.premultiply(qA).premultiply(rotation).premultiply(qA.invert());
  }

  function toRest(bone: THREE.Object3D, weight: number): void {
    if (weight <= 0) return;
    bone.quaternion.slerp(restQuat[boneIndex.get(bone)!], weight);
  }

  // ---------------------------------------------------------------- posing

  function runPose(t: number, r: Run): void {
    const B = r.beats;
    const release = B.release;
    wyvernFlap(B, t, flapOut);
    // Between beats the wings rest level: on the way up into a beat, or on the way down out of one.
    if (flapOut.amount >= 1) pose.flapPhase = flapOut.phase;
    else if (flapOut.rising) pose.flapPhase = 1 - (1 - flapOut.amount) * CLIP_LEVEL * 2 * (1 - WYVERN_DOWNSTROKE);
    else pose.flapPhase = (1 - flapOut.amount) * CLIP_LEVEL * 2 * WYVERN_DOWNSTROKE;
    pose.power = lerp(1, flapOut.power, flapOut.amount);

    pose.dive = ramp(t, B.dive - 0.3, B.dive + 0.12) * (1 - ramp(t, B.flare - 0.08, B.flare + 0.12));
    pose.flare = ramp(t, B.flare - 0.05, B.flare + 0.18) * (1 - ramp(t, B.strike + 0.02, B.strike + 0.3));
    const bite = B.bite;
    const afterStrike = ramp(t, B.strike, B.strike + 0.35);
    const afterRelease = release === null ? 0 : ramp(t, release + 0.1, release + 0.7);
    pose.hover = B.hover === null || release === null ? 0 : ramp(t, B.hover - 0.5, B.hover + 0.1) * (1 - ramp(t, release + 0.15, release + 0.75));
    pose.feed = bite === null || release === null || B.hover === null ? 0 : ramp(t, B.hover - 0.4, bite - 0.08) * (1 - ramp(t, release + 0.04, release + 0.5));
    pose.reach = ramp(t, B.flare - 0.06, B.flare + 0.2) * (1 - afterStrike);
    pose.hang = afterStrike * (1 - afterRelease);
    let open = ramp(t, B.flare, B.flare + 0.16) * (1 - ramp(t, B.strike - 0.01, B.strike + 0.08));
    if (bite !== null && release !== null) {
      // The feet give the body up to the jaws at the bite.
      open = Math.max(open, ramp(t, bite, bite + 0.14) * (1 - ramp(t, release + 0.3, release + 0.8)));
    } else if (release !== null) {
      open = Math.max(open, ramp(t, release - 0.05, release + 0.06) * (1 - ramp(t, release + 0.25, release + 0.7)));
    }
    pose.open = open;
    pose.lock = ramp(t, B.strike - 0.3, B.strike) * (1 - ramp(t, B.strike, B.strike + 0.45));

    const hold = WYVERN_TIMING.screechHold;
    pose.jaw = Math.max(
      ramp(t, B.screech, B.screech + 0.12) * (1 - ramp(t, B.screech + hold - 0.25, B.screech + hold)),
      0.5 * ramp(t, B.strike - 0.14, B.strike - 0.02) * (1 - ramp(t, B.strike + 0.03, B.strike + 0.2)),
    );
    pose.shake = 0;
    pose.lift = 0;
    if (bite !== null && release !== null && B.triumph !== null) {
      // Gape, clamp on the torso, hold through the tears, let go, then the screech of triumph.
      const gape = ramp(t, bite - 0.34, bite - 0.1) * (1 - (1 - TUNE.jawFull) * ramp(t, bite - 0.04, bite + 0.03));
      const letGo = ramp(t, release - 0.05, release + 0.05);
      const triumph = ramp(t, B.triumph, B.triumph + 0.12) * (1 - ramp(t, B.triumph + 0.55, B.triumph + 0.85));
      pose.jaw = Math.max(pose.jaw, lerp(gape, 0.85, letGo) * (1 - ramp(t, release + 0.12, release + 0.3)), triumph);
      pose.lift = triumph;
      // Each tear: the head is thrown hard to one side and dragged back, alternating.
      B.tears.forEach((at, index) => {
        const side = (index % 2 === 0 ? 1 : -1) * r.path.side;
        pose.shake += side * ramp(t, at - 0.07, at + 0.03) * (1 - ramp(t, at + 0.06, at + 0.27));
      });
    }
    pose.track = ramp(t, 0.2, 0.7) * (1 - ramp(t, B.strike - 0.03, B.strike + 0.3));
    pose.rear = pose.flare * TUNE.flarePitch + pose.hover * TUNE.hoverPitch;
    pose.fade = ramp(t, 0, 0.35) * (1 - ramp(t, B.gone - 0.45, B.gone));
  }

  function idlePose(t: number): void {
    const beat = IDLE_BEAT * Math.sqrt(wingspan / WYVERN_WINGSPAN);
    pose.flapPhase = held?.flapPhase ?? (t / beat) % 1;
    pose.power = 1;
    pose.dive = held?.dive ?? 0;
    pose.flare = held?.flare ?? 0;
    pose.reach = held?.reach ?? 0;
    pose.hang = held?.hang ?? 0;
    pose.open = held?.open ?? 0;
    pose.jaw = held?.jaw ?? 0;
    pose.track = 0;
    pose.hover = held?.hover ?? 0;
    pose.feed = held?.feed ?? 0;
    pose.shake = held?.shake ?? 0;
    pose.lift = 0;
    pose.rear = pose.flare * TUNE.flarePitch + pose.hover * TUNE.hoverPitch;
    pose.lock = 0;
    pose.fade = 1;
  }

  /** Scrubs Fly_Cycle to the wingbeat and lays the run's poses over it. */
  function poseBones(): void {
    if (!mixer || !action) return;
    // Put back what the mixer last wrote, then let it write this frame's.
    for (let i = 0; i < bones.length; i += 1) bones[i].quaternion.copy(clipQuat[i]);
    const p = pose.flapPhase;
    // Our beat spends less than half its time on the downstroke; the clip's is even.
    through = p < WYVERN_DOWNSTROKE ? (0.5 * p) / WYVERN_DOWNSTROKE : 0.5 + (0.5 * (p - WYVERN_DOWNSTROKE)) / (1 - WYVERN_DOWNSTROKE);
    const cycle = (((CLIP_TOP + through) % 1) + 1) % 1;
    action.time = cycle * clipLength;
    mixer.update(0);
    for (let i = 0; i < bones.length; i += 1) clipQuat[i].copy(bones[i].quaternion);

    // How high the stroke is right now, +1 at the top and -1 at the bottom.
    const stroke = Math.cos(through * Math.PI * 2);
    const spread = 1 - pose.dive;
    for (const wing of wings) {
      const s = wing.sign;
      for (const bone of wing.chain) toRest(bone, pose.dive * TUNE.diveFold);
      const raise = (pose.power - 1) * TUNE.powerStroke * stroke * spread + pose.dive * TUNE.diveRaise + pose.flare * TUNE.flareRaise;
      turn(wing.shoulder, ROOT_FORWARD, raise * s);
      turn(wing.shoulder, ROOT_UP, (pose.dive * TUNE.diveSweep + pose.flare * TUNE.flareSweep) * s);
      turn(wing.shoulder, ROOT_X, pose.flare * TUNE.flareTwist);
    }

    poseLegs(lerp(pose.reach * TUNE.reachSwing + pose.hang * TUNE.hangSwing, feedSwing, pose.feed));
    poseNeck(feedCurl * pose.feed + pose.lift * TUNE.triumphLift, pose.shake * TUNE.shake);

    if (jaw) turn(jaw, ROOT_X, -pose.jaw * TUNE.jaw);

    // The tail keeps level while the trunk rears, and trails outward and behind a turn or a pull-up.
    if (tail.length) {
      // `climb` is how far the nose is above level, whether from the flare or from the path.
      const level = -(pose.rear + Math.max(0, climb)) * lerp(0.9, 0.78, pose.hover);
      for (let i = 0; i < 6; i += 1) turn(tail[i], ROOT_X, level / 6);
      for (let i = 1; i < tail.length; i += 1) {
        turn(tail[i], ROOT_UP, tailYaw / (tail.length - 1));
        turn(tail[i], ROOT_X, tailPitch / (tail.length - 1));
      }
    }
  }

  /** Legs from the clip's tuck: brought down, swung at the hip, feet together, toes curled or spread. */
  function poseLegs(swing: number): void {
    const down = Math.max(pose.reach * TUNE.reachDown, pose.hang * TUNE.hangDown, pose.feed);
    const inward = Math.max(pose.reach, pose.hang) * TUNE.legsIn;
    const curl = lerp(TUNE.clawClench * Math.max(pose.hang, pose.reach), TUNE.clawOpen, pose.open);
    for (const leg of legs) {
      for (const bone of leg.chain) bone.quaternion.copy(clipQuat[boneIndex.get(bone)!]);
      for (const toe of leg.toes) toe.quaternion.copy(clipQuat[boneIndex.get(toe)!]);
      leg.hallux.quaternion.copy(clipQuat[boneIndex.get(leg.hallux)!]);
      for (const bone of leg.chain) toRest(bone, down);
      turn(leg.upper, ROOT_X, swing);
      turn(leg.upper, ROOT_Z, inward * leg.sign);
      // Feeding, the shin and foot stretch forward to offer the body up.
      turn(leg.chain[2], ROOT_X, pose.feed * TUNE.feedKnee);
      turn(leg.chain[5], ROOT_X, pose.feed * TUNE.feedFoot);
      if (Math.abs(curl) > 1e-4) {
        // The toes curl about the foot's own side-to-side axis.
        parentQuat(leg.toes[1], qD);
        tmpD.set(0, 0, 1).applyQuaternion(qD.multiply(leg.toes[1].quaternion));
        if (tmpD.x < 0) tmpD.negate();
        for (const toe of leg.toes) turn(toe, tmpD, curl);
        turn(leg.hallux, tmpD, -curl);
      }
    }
  }

  /** Neck and head from the clip: curled down (negative) or lifted, and thrown to one side. */
  function poseNeck(curl: number, yaw: number): void {
    if (!head) return;
    // A deep curl starts in the chest: the trunk crunches a little and the neck does the rest.
    const trunk = curl < 0 ? TUNE.feedTrunk : 0;
    for (const bone of spine) {
      bone.quaternion.copy(clipQuat[boneIndex.get(bone)!]);
      turn(bone, ROOT_X, (curl * trunk) / spine.length);
    }
    const chain = neck.length + 1;
    for (let i = 0; i < chain; i += 1) {
      const bone = i < neck.length ? neck[i] : head;
      bone.quaternion.copy(clipQuat[boneIndex.get(bone)!]);
      turn(bone, ROOT_X, (curl * (1 - trunk)) / chain);
    }
    // The throw runs the length of the neck, so the head and what it holds whip well clear of the chest.
    if (Math.abs(yaw) > 1e-5) {
      for (const bone of neck) turn(bone, ROOT_UP, yaw / chain);
      turn(head, ROOT_UP, yaw / chain);
    }
  }

  const mouthDir = v3();
  /** The biting part of the mouth: a little ahead of the tongue, toward the snout. World space. */
  function mouthPoint(out: V3): V3 {
    mouth!.getWorldPosition(out);
    mouthDir.set(0, 1, 0).transformDirection(head!.matrixWorld);
    return out.addScaledVector(mouthDir, (0.3 * wingspan) / WYVERN_WINGSPAN);
  }

  const feedGap = new THREE.Vector2();
  /** How far the mouth is from the palms, up and forward in the group's frame, for a given neck curl and hip swing. */
  function measureFeed(curl: number, swing: number, out: THREE.Vector2): THREE.Vector2 {
    poseLegs(swing);
    poseNeck(curl, 0);
    for (const leg of legs) leg.upper.updateWorldMatrix(false, true);
    (spine[0] ?? neck[0]).updateWorldMatrix(false, true);
    legs[0].palm.getWorldPosition(tmpA);
    legs[1].palm.getWorldPosition(tmpB);
    tmpA.add(tmpB).multiplyScalar(0.5);
    mouthPoint(tmpB).sub(tmpA);
    tmpC.set(0, 1, 0).transformDirection(group.matrixWorld);
    tmpD.set(0, 0, 1).transformDirection(group.matrixWorld);
    return out.set(tmpB.dot(tmpC), tmpB.dot(tmpD));
  }

  /**
   * Finds the neck curl and hip swing that bring the jaws onto the talons, so
   * the victim can pass from one to the other without moving. Two unknowns,
   * two distances: a few Newton steps from last frame's answer.
   */
  function solveFeed(): void {
    if (!head || !mouth || !legs.length) return;
    const step = 0.03;
    for (let pass = 0; pass < 6; pass += 1) {
      measureFeed(feedCurl, feedSwing, feedGap);
      const gapU = feedGap.x;
      const gapF = feedGap.y;
      if (Math.hypot(gapU, gapF) < 0.0005) break;
      measureFeed(feedCurl + step, feedSwing, feedGap);
      const a = (feedGap.x - gapU) / step;
      const c = (feedGap.y - gapF) / step;
      measureFeed(feedCurl, feedSwing + step, feedGap);
      const b = (feedGap.x - gapU) / step;
      const d = (feedGap.y - gapF) / step;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-6) break;
      const dCurl = THREE.MathUtils.clamp(-(d * gapU - b * gapF) / det, -0.35, 0.35);
      const dSwing = THREE.MathUtils.clamp(-(-c * gapU + a * gapF) / det, -0.35, 0.35);
      feedCurl = THREE.MathUtils.clamp(feedCurl + dCurl, -3.4, -0.4);
      feedSwing = THREE.MathUtils.clamp(feedSwing + dSwing, 0, 2.2);
    }
    // Leave the bones as the frame wants them: blended in by the feed weight, with the shake on top.
    poseLegs(lerp(pose.reach * TUNE.reachSwing + pose.hang * TUNE.hangSwing, feedSwing, pose.feed));
    poseNeck(feedCurl * pose.feed + pose.lift * TUNE.triumphLift, pose.shake * TUNE.shake);
  }

  /** Turns the neck and head to hold the target in view. Needs world matrices. */
  function poseHead(dt: number): void {
    if (!head) return;
    let want = IDENTITY;
    if (run && pose.track > 0) {
      head.getWorldPosition(tmpA);
      // The head bone runs along the skull, toward the snout.
      tmpB.set(0, 1, 0).transformDirection(head.matrixWorld);
      tmpC.subVectors(run.target, tmpA);
      if (tmpC.lengthSq() > 1e-6) {
        tmpC.normalize();
        // Into the model's root space.
        tmpM.copy(holder.matrixWorld).invert();
        tmpB.transformDirection(tmpM);
        tmpC.transformDirection(tmpM);
        qC.setFromUnitVectors(tmpB, tmpC);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(qC.w)));
        const limit = 0.95;
        qD.identity().slerp(qC, pose.track * (angle > limit ? limit / angle : 1));
        want = qD;
      }
    }
    if (fresh) look.copy(want);
    else look.slerp(want, 1 - Math.exp(-9 * dt));
    if (Math.abs(look.w) > 0.99999) return;
    qC.identity().slerp(look, 1 / (neck.length + 1));
    for (const bone of neck) turnBy(bone, qC);
    turnBy(head, qC);
  }

  /** Lifts the wings and the tail until none of their joints is under the board. */
  function clearFloor(): void {
    const margin = floor + 0.3;
    for (let pass = 0; pass < 3; pass += 1) {
      let moved = false;
      holder.updateMatrixWorld(true);
      for (const wing of wings) {
        let lowest = Infinity;
        let reach = 1;
        wing.shoulder.getWorldPosition(tmpA);
        for (const [bone, before] of wing.probes) {
          bone.getWorldPosition(tmpB);
          if (before) {
            // Extrapolate past the last bone to the fingertip.
            before.getWorldPosition(tmpC);
            tmpB.multiplyScalar(2).sub(tmpC);
          }
          if (tmpB.y < lowest) {
            lowest = tmpB.y;
            reach = Math.max(0.5, tmpB.distanceTo(tmpA));
          }
        }
        const need = margin - lowest;
        if (need > 0) {
          turn(wing.shoulder, ROOT_FORWARD, (Math.asin(Math.min(1, need / reach)) + 0.03) * wing.sign);
          moved = true;
        }
      }
      if (tail.length) {
        let lowest = Infinity;
        let reach = 1;
        tail[0].getWorldPosition(tmpA);
        for (let i = 2; i < tail.length; i += 1) {
          tail[i].getWorldPosition(tmpB);
          if (i === tail.length - 1) {
            tail[i - 1].getWorldPosition(tmpC);
            tmpB.multiplyScalar(2.6).addScaledVector(tmpC, -1.6); // out to the end of the fan
          }
          if (tmpB.y < lowest) {
            lowest = tmpB.y;
            reach = Math.max(0.5, tmpB.distanceTo(tmpA));
          }
        }
        const need = margin + 0.5 - lowest;
        if (need > 0) {
          const lift = (Math.asin(Math.min(1, need / reach)) + 0.03) / 3;
          for (let i = 0; i < 3; i += 1) turn(tail[i], ROOT_X, -lift);
          moved = true;
        }
      }
      if (!moved) break;
    }
    holder.updateMatrixWorld(true);
  }

  /** Places the body on the path and poses every bone. */
  function applyPose(dt: number): void {
    if (run) {
      const t = time;
      run.path.position(t, pathPos);
      run.path.velocity(t, pathVel);
      run.path.acceleration(t, pathAcc);
      const speed = pathVel.length();
      if (speed > 1e-4) {
        tmpA.copy(pathVel).multiplyScalar(1 / speed);
        // The trunk follows the climb only partly: a long tail must not swing through the board.
        if (tmpA.y > 0) tmpA.y = Math.min(tmpA.y * 0.6, 0.5);
        tmpA.y = Math.max(tmpA.y, -0.9);
        tmpA.normalize();
        const facing = run.path.hoverFacing;
        if (pose.hover > 0 && facing) {
          // Hovering, the path barely moves: wheel round to face where it was told, level, and let the rear do the rest.
          const from = Math.atan2(tmpA.x, tmpA.z);
          let turnBy2 = Math.atan2(facing.x, facing.z) - from;
          turnBy2 -= Math.round(turnBy2 / (Math.PI * 2)) * Math.PI * 2;
          const yaw = from + turnBy2 * pose.hover;
          const rise = tmpA.y * (1 - pose.hover);
          const flat = Math.sqrt(Math.max(0, 1 - rise * rise));
          tmpA.set(Math.sin(yaw) * flat, rise, Math.cos(yaw) * flat);
        }
        if (fresh) forward.copy(tmpA);
        else forward.lerp(tmpA, 1 - Math.exp(-12 * dt)).normalize();
      }
      const left = tmpB.crossVectors(WORLD_UP, forward).normalize();
      const upBody = tmpC.crossVectors(forward, left).normalize();
      // Bank into the turn: the wing on the inside of the curve drops.
      const lateral = pathAcc.dot(left);
      const wantBank = THREE.MathUtils.clamp(-Math.atan2(lateral, 9.81) * 0.8, -0.8, 0.8) * (1 - pose.flare) * (1 - 0.6 * pose.hang);
      const wantYaw = THREE.MathUtils.clamp(lateral * 0.03, -0.5, 0.5);
      const wantPitch = THREE.MathUtils.clamp(pathAcc.y * 0.012, -0.3, 0.3);
      if (fresh) {
        bank = wantBank;
        tailYaw = wantYaw;
        tailPitch = wantPitch;
      } else {
        bank += (wantBank - bank) * (1 - Math.exp(-5 * dt));
        tailYaw += (wantYaw - tailYaw) * (1 - Math.exp(-3 * dt));
        tailPitch += (wantPitch - tailPitch) * (1 - Math.exp(-3 * dt));
      }
      climb = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
      tmpM.makeBasis(left, upBody, forward);
      group.quaternion.setFromRotationMatrix(tmpM);
      group.quaternion.multiply(qA.setFromAxisAngle(Z_AXIS, bank + pose.shake * pose.hover * TUNE.shakeRoll));
      group.quaternion.multiply(qA.setFromAxisAngle(X_AXIS, -pose.rear));
      group.position.copy(pathPos);
    }
    poseBones();
    if (run && pose.hover > 0) {
      group.position.y -= TUNE.hoverBob * pose.hover * Math.cos(through * Math.PI * 2);
      tmpA.set(1, 0, 0).applyQuaternion(group.quaternion);
      group.position.addScaledVector(tmpA, pose.shake * pose.hover * TUNE.shakeLurch);
    }
    group.updateMatrixWorld(true);
    if (pose.feed > 0) {
      solveFeed();
      group.updateMatrixWorld(true);
    }
    poseHead(dt);
    fresh = false;

    if (legs.length) {
      if (run && pose.lock > 0) {
        // Pull the whole beast the last little way so the talons are exactly on the chest at the strike.
        group.updateMatrixWorld(true);
        legs[0].palm.getWorldPosition(tmpA);
        legs[1].palm.getWorldPosition(tmpB);
        tmpA.add(tmpB).multiplyScalar(0.5);
        tmpB.subVectors(run.target, tmpA).multiplyScalar(pose.lock);
        group.position.add(tmpB);
      }
      group.updateMatrixWorld(true);
      clearFloor();
      legs[0].palm.getWorldPosition(tmpA);
      legs[1].palm.getWorldPosition(tmpB);
      tmpA.add(tmpB).multiplyScalar(0.5);
      talons.position.copy(group.worldToLocal(tmpA));
      talons.updateMatrixWorld(true);
    }
    if (mouth && head) {
      jaws.position.copy(group.worldToLocal(mouthPoint(tmpA)));
      // The socket turns with the skull, so what is in the jaws is shaken with them.
      head.getWorldQuaternion(qA);
      group.getWorldQuaternion(qB);
      jaws.quaternion.copy(qB.invert().multiply(qA));
      jaws.updateMatrixWorld(true);
    }
    fade.value = pose.fade;
  }

  function poseNow(): void {
    const now = run ? time : idleTime;
    const dt = Math.max(0, now - lastPosed);
    lastPosed = now;
    if (run) runPose(time, run);
    else idlePose(idleTime);
    applyPose(dt);
  }

  function update(dt: number): void {
    if (disposed || !model) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (!run) {
      idleTime += step;
      if (group.visible) poseNow();
      return;
    }
    let remaining = step;
    while (run && run.cursor < run.events.length) {
      const event = run.events[run.cursor];
      if (event.t > time + remaining + 1e-9) break;
      remaining -= Math.max(0, event.t - time);
      time = Math.max(time, event.t);
      run.cursor += 1;
      if (event.exact) poseNow();
      event.fire();
    }
    if (!run) return;
    time += Math.max(0, remaining);
    poseNow();
  }

  function finish(): void {
    if (!run) return;
    const done = run;
    run = null;
    time = -1;
    idleTime = 0;
    lastPosed = 0;
    group.visible = false;
    done.resolve();
  }

  async function start(plan: WyvernRunPlan): Promise<void> {
    await ready;
    if (disposed) return;
    if (run) finish();
    const path = createWyvernPath({ from: plan.from, target: plan.target, away: plan.away, carry: plan.carry ?? "eat", seed: plan.seed, hover: plan.hover, face: plan.face, floor, grip });
    const beats = path.beats;
    const events: RunEvent[] = [];
    const hooks = plan.events ?? {};
    events.push({ t: beats.screech, fire: () => hooks.screech?.(beats.screech, 0) });
    if (beats.bite !== null) {
      const at = beats.bite;
      events.push({
        t: at,
        exact: true,
        fire: () => {
          biteError = jaws.getWorldPosition(tmpA).distanceTo(talons.getWorldPosition(tmpB));
          hooks.bite?.(at);
        },
      });
    }
    beats.tears.forEach((at, index) => events.push({ t: at, fire: () => hooks.tear?.(at, index) }));
    if (beats.triumph !== null) {
      const at = beats.triumph;
      events.push({ t: at, fire: () => hooks.screech?.(at, 1) });
    }
    beats.wingbeats.forEach((beat, index) => events.push({ t: beat.time, fire: () => hooks.wingbeat?.(beat.time, index) }));
    events.push({ t: beats.strike, exact: true, fire: () => hooks.strike?.(beats.strike) });
    if (beats.release !== null) {
      const at = beats.release;
      events.push({ t: at, exact: true, fire: () => hooks.release?.(at) });
    }
    events.push({
      t: beats.gone,
      fire: () => {
        hooks.gone?.(beats.gone);
        finish();
      },
    });
    events.sort((a, b) => a.t - b.t);
    return new Promise<void>((resolve) => {
      run = { path, beats, target: plan.target.clone(), events, cursor: 0, resolve };
      time = 0;
      lastPosed = 0;
      fresh = true;
      held = null;
      group.visible = true;
      poseNow();
    });
  }

  function dispose(): void {
    if (disposed) return;
    if (run) finish();
    disposed = true;
    group.removeFromParent();
    if (mixer && model) {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    }
    // Only what this clone owns: its materials and its skeletons' bone textures.
    for (const material of ownMaterials) material.dispose();
    for (const skeleton of ownSkeletons) skeleton.dispose();
    // Geometries and textures belong to the loaded glTF; they are ours only if we loaded it.
    if (ownedSource) disposeSource(ownedSource);
    ownedSource = null;
    model = null;
    mixer = null;
    action = null;
    bones = [];
    wings = [];
    legs = [];
    tail = [];
    neck = [];
    spine = [];
    head = null;
    jaw = null;
    mouth = null;
  }

  return {
    group,
    talons,
    jaws,
    get biteError() {
      return biteError;
    },
    update,
    run: start,
    dispose,
    ready,
    beats: wyvernBeats,
    pose(weights) {
      held = weights;
      if (!run && model) {
        fresh = true;
        poseNow();
      }
    },
    get time() {
      return run ? time : -1;
    },
    stats,
  };
}
