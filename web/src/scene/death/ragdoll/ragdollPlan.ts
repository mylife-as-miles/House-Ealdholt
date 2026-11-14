/**
 * What a ragdoll is made of, worked out from a figure's own skeleton.
 *
 * Pure: bone names, the bind pose and the pose at the moment of death go in;
 * a list of bodies (capsules on the limbs, boxes on the pelvis and chest, a
 * sphere on the head) and the joints between them comes out. No three.js and
 * no Jolt, so the same plan is made in the browser and in the Node tests.
 *
 * The four kingdoms' Pawns (and the other figures from the same rigger) name
 * their bones alike: Hips, Spine02 / Spine01 / Spine, neck, Head, and Left or
 * Right Shoulder, Arm, ForeArm, Hand, UpLeg, Leg, Foot. Mixamo and the usual
 * "upperarm / thigh / calf" names are accepted too. A skeleton without a
 * pelvis, a spine, a head and two whole legs gets no plan (null), and its
 * figure falls as it did before physics.
 */
import type { JointSpec, ShapeSpec } from "../physics/PhysicsWorld";
import { add, clamp, cross, length, lerp, orthogonal, perpendicular, qAxisAngle, qConj, qFromAxis, qFromBasis, qMul, qRotate, scale, sub, unit, type Q4, type V3 } from "../physics/math";

export interface RigJoint { name: string; /** Index of the parent joint, -1 for a root. */ parent: number }

/** World position and rotation of every joint, in the order of the rig's joints. */
export interface RigPose { positions: V3[]; rotations: Q4[] }

export type PartName =
  | "pelvis" | "chest" | "head"
  | "armL" | "foreArmL" | "armR" | "foreArmR"
  | "thighL" | "shinL" | "thighR" | "shinR";

/** A broad thing the figure holds (a shield): a box that rides on the limb holding it, so it cannot sink into the stone. */
export interface HeldBox {
  /** The joint it hangs from (a hand). */
  joint: number;
  /** The box in the world now. */
  centre: V3; rotation: Q4; half: V3;
}

export interface PartPlan {
  name: PartName | "held";
  /** False for a held thing: its body is simulated, but no bone is written from it (the hand carries it as before). */
  drives?: boolean;
  /** The joint this body carries. */
  joint: number;
  /** Index of the part it hangs from, -1 for the pelvis. */
  parent: number;
  shape: ShapeSpec;
  mass: number;
  /** The body's centre in the joint's own (unscaled) frame, scene units: bodyPosition = jointPosition + jointRotation * centre. */
  centre: V3;
  /** The body's rotation in the joint's frame: bodyRotation = jointRotation * frame. */
  frame: Q4;
  /** The joint to the parent part, in each body's own space. Null for the pelvis. */
  link: JointSpec | null;
}

export interface RagdollPlan {
  parts: PartPlan[];
  /** Pairs of parts that pass through each other: neighbours, and the arms against the trunk. */
  apart: [number, number][];
  /** Standing height the sizes were scaled from, scene units. */
  height: number;
}

export interface RagdollOptions {
  /** One body per arm instead of two: the lowest quality preset. */
  simpleArms?: boolean;
  /** Radius of each part measured off the figure's own mesh, scene units. Parts not named use the built-in proportions. */
  girth?: Partial<Record<PartName, number>>;
  /** Broad things the figure holds, as they are now: each gets a body fixed to the part that holds it. */
  held?: readonly HeldBox[];
  /**
   * Parts the figure no longer has (death/sever: a limb that came off, its bones hidden). No body is made for them or
   * for anything that hangs from them (an upper arm takes its forearm), and they are not measured.
   */
  without?: readonly PartName[];
}

type Limb = "arm" | "foreArm" | "hand" | "upLeg" | "leg" | "foot";
type Key = "hips" | "neck" | "head" | "headEnd" | `${Limb}${"L" | "R"}`;
const TRUNK: Record<string, "hips" | "neck" | "head" | "headEnd"> = { hips: "hips", pelvis: "hips", neck: "neck", head: "head", headend: "headEnd", headtopend: "headEnd" };
const LIMBS: Record<string, Limb> = {
  arm: "arm", upperarm: "arm", forearm: "foreArm", lowerarm: "foreArm", hand: "hand",
  upleg: "upLeg", upperleg: "upLeg", thigh: "upLeg", leg: "leg", lowerleg: "leg", calf: "leg", shin: "leg", foot: "foot",
};

/** Which joint is which: by name, whatever the prefix or the case. The first joint of a name wins. */
export function mapRig(joints: readonly RigJoint[]): { key: Partial<Record<Key, number>>; spine: number[] } {
  const key: Partial<Record<Key, number>> = {}, spine: number[] = [];
  joints.forEach((joint, index) => {
    const plain = joint.name.toLowerCase().replace(/^mixamorig:?/, "").replace(/[^a-z0-9]/g, "");
    if (/^spine\d*$/.test(plain) || plain === "chest" || plain === "upperchest") { spine.push(index); return; }
    if (TRUNK[plain]) { key[TRUNK[plain]] ??= index; return; }
    // "LeftForeArm", "l_forearm" and "forearm_l" all name the same joint.
    const sided = /^(left|right)(.+)$/.exec(plain) ?? /^([lr])(.+)$/.exec(plain);
    const tailed = /^(.+?)(left|right|l|r)$/.exec(plain);
    const limb = sided && LIMBS[sided[2]] ? { limb: LIMBS[sided[2]], side: sided[1][0] } : tailed && LIMBS[tailed[1]] ? { limb: LIMBS[tailed[1]], side: tailed[2][0] } : null;
    if (limb) key[`${limb.limb}${limb.side === "l" ? "L" : "R"}`] ??= index;
  });
  // The spine from the pelvis upwards, whatever order the file lists it in.
  const depth = (index: number): number => { let d = 0; for (let at = index; joints[at].parent >= 0; at = joints[at].parent) d += 1; return d; };
  spine.sort((a, b) => depth(a) - depth(b));
  return { key, spine };
}

/** Share of the standing height each part's radius takes when the mesh was not measured. */
const GIRTH: Record<PartName, number> = {
  pelvis: 0.085, chest: 0.09, head: 0.075, armL: 0.04, armR: 0.04, foreArmL: 0.034, foreArmR: 0.034,
  thighL: 0.055, thighR: 0.055, shinL: 0.042, shinR: 0.042,
};
/** Kilograms, of a man of 75. */
const MASS: Record<PartName, number> = {
  pelvis: 12, chest: 24, head: 5.5, armL: 2.2, armR: 2.2, foreArmL: 1.8, foreArmR: 1.8, thighL: 8, thighR: 8, shinL: 4.6, shinR: 4.6,
};
/**
 * How each joint may move, radians. `towards` is the way the joint bends; the
 * limit cone is centred `mid` that way, `plane` wide in that plane and
 * `normal` wide across it. A ball joint's cone sits on the bind pose. A hinge
 * (knee, elbow) is measured from the straight limb instead, and turns about
 * the bone's own x axis, which is the axis the kingdoms' clips bend it about:
 * a knee is 66 degrees either side of a leg bent 66 degrees back, so it runs
 * from straight to 132 degrees and cannot bend forward.
 */
const LIMITS: Record<Exclude<PartName, "pelvis">, { towards: "front" | "back" | "down"; mid: number; plane: number; normal: number; twist: number; hinge?: boolean }> = {
  chest: { towards: "front", mid: 0.1, plane: 0.5, normal: 0.3, twist: 0.3 },
  head: { towards: "front", mid: 0, plane: 0.6, normal: 0.45, twist: 0.6 },
  armL: { towards: "down", mid: 0.5, plane: 1.3, normal: 1.15, twist: 0.8 },
  armR: { towards: "down", mid: 0.5, plane: 1.3, normal: 1.15, twist: 0.8 },
  foreArmL: { towards: "front", mid: 1.2, plane: 1.2, normal: 0.3, twist: 0.6, hinge: true },
  foreArmR: { towards: "front", mid: 1.2, plane: 1.2, normal: 0.3, twist: 0.6, hinge: true },
  thighL: { towards: "front", mid: 0.45, plane: 1.0, normal: 0.45, twist: 0.35 },
  thighR: { towards: "front", mid: 0.45, plane: 1.0, normal: 0.45, twist: 0.35 },
  shinL: { towards: "back", mid: 1.15, plane: 1.15, normal: 0.2, twist: 0.25, hinge: true },
  shinR: { towards: "back", mid: 1.15, plane: 1.15, normal: 0.2, twist: 0.25, hinge: true },
};
/** A joint that is already past a limit in the pose it died in has that limit moved out to it, and this much more: nothing is snapped back. */
const LIMIT_MARGIN = 0.06;

/**
 * The bodies and joints for this skeleton. `bind` is the pose the mesh was
 * skinned in (any frame, any scale: only its directions are used, for where
 * each joint's limits sit); `now` is the pose in the world at this moment,
 * which is where the bodies are made.
 */
export function planRagdoll(joints: readonly RigJoint[], bind: RigPose, now: RigPose, options: RagdollOptions = {}): RagdollPlan | null {
  const { key, spine } = mapRig(joints);
  const need: Key[] = ["hips", "head", "upLegL", "upLegR", "legL", "legR", "footL", "footR", "armL", "armR", "foreArmL", "foreArmR"];
  if (!spine.length || need.some(name => key[name] === undefined)) return null;
  const k = key as Record<Key, number>;
  // The chest is carried by the second spine joint where there is one: the first belongs to the pelvis.
  const chest = spine[Math.min(1, spine.length - 1)];
  const P = now.positions, R = now.rotations;
  // A limb that came off takes what hangs from it.
  const omit = new Set<PartName>(options.without ?? []);
  for (const side of ["L", "R"] as const) { if (omit.has(`arm${side}`)) omit.add(`foreArm${side}`); if (omit.has(`thigh${side}`)) omit.add(`shin${side}`); }
  const between = (a: number, b: number) => length(sub(P[b], P[a]));
  // Hip to ankle, from the legs it still has: a leg that came off has its bones folded into the hip or the knee.
  const legs = (["L", "R"] as const).filter(side => !omit.has(`shin${side}`)).map(side => between(k[`upLeg${side}`], k[`leg${side}`]) + between(k[`leg${side}`], k[`foot${side}`]));
  // With no leg left, the trunk measures the figure instead: the pelvis to the skull is about three tenths of a standing man.
  const leg = legs.length ? legs.reduce((sum, value) => sum + value, 0) / legs.length : between(k.hips, k.head) / 0.3 * 0.47;
  if (!(leg > 1e-4) || !Number.isFinite(leg)) return null;
  // Hip to ankle is a little under half a standing man.
  const height = leg / 0.47;
  const girth = (name: PartName) => clamp(options.girth?.[name] ?? GIRTH[name] * height, GIRTH[name] * height * 0.6, GIRTH[name] * height * 1.9);

  // The figure's own directions in the bind pose: its left, up and front.
  const B = bind.positions;
  const up = unit(sub(B[k.head], B[k.hips]));
  const left = orthogonal(sub(B[k.upLegL], B[k.upLegR]), up);
  const front = cross(left, up);
  const way = { front, back: scale(front, -1), down: scale(up, -1) };

  const parts: PartPlan[] = [];
  const index = new Map<PartName, number>();
  /** A body lying from `from` to `to` (world points now), carried by `joint`, its x axis turned towards `across`. */
  const part = (name: PartName, joint: number, parent: PartName | null, from: V3, to: V3, across: V3 | null, box: boolean): void => {
    if (omit.has(name)) return;
    const axis = unit(sub(to, from), qRotate(R[joint], [0, 1, 0])), span = length(sub(to, from)), radius = girth(name);
    const world = qFromAxis(axis, across ?? undefined), local = qConj(R[joint]);
    const shape: ShapeSpec = name === "head" ? { kind: "sphere", radius: Math.max(radius, span * 0.5) }
      : box ? { kind: "box", half: [radius * 1.25, Math.max(span * 0.5, radius * 0.4), radius * 0.85] }
      : { kind: "capsule", halfHeight: Math.max(1e-3, span * 0.5 - radius), radius };
    const made: PartPlan = {
      name, joint, parent: parent ? index.get(parent)! : -1, shape, mass: MASS[name],
      centre: qRotate(local, sub(lerp(from, to, 0.5), P[joint])), frame: qMul(local, world), link: null,
    };
    index.set(name, parts.length);
    parts.push(made);
  };

  const shoulders = sub(P[k.armL], P[k.armR]), hips = sub(P[k.upLegL], P[k.upLegR]);
  const trunk = unit(sub(P[chest], P[k.hips]), qRotate(R[k.hips], [0, 1, 0]));
  part("pelvis", k.hips, null, sub(P[k.hips], scale(trunk, 0.05 * height)), P[chest], hips, true);
  part("chest", chest, "pelvis", P[chest], P[key.neck ?? k.head], shoulders, true);
  const crown = key.headEnd !== undefined ? P[key.headEnd] : add(P[k.head], scale(unit(sub(P[k.head], P[chest])), 0.15 * height));
  part("head", k.head, "chest", P[k.head], crown, shoulders, false);
  for (const side of ["L", "R"] as const) {
    const arm = k[`arm${side}`], fore = k[`foreArm${side}`], hand = key[`hand${side}`];
    // The forearm's body runs on a little past the wrist, so the hand is inside it.
    const tip = hand !== undefined ? add(P[hand], scale(sub(P[hand], P[fore]), 0.3)) : add(P[fore], sub(P[fore], P[arm]));
    // One body for the arm stops at the elbow when the forearm came off.
    if (options.simpleArms) part(`arm${side}`, arm, "chest", P[arm], omit.has(`foreArm${side}`) ? P[fore] : tip, null, false);
    else { part(`arm${side}`, arm, "chest", P[arm], P[fore], null, false); part(`foreArm${side}`, fore, `arm${side}`, P[fore], tip, null, false); }
    part(`thigh${side}`, k[`upLeg${side}`], "pelvis", P[k[`upLeg${side}`]], P[k[`leg${side}`]], hips, false);
    part(`shin${side}`, k[`leg${side}`], `thigh${side}`, P[k[`leg${side}`]], P[k[`foot${side}`]], hips, false);
  }

  // Joints: each one's limits are laid out in the bind pose, then written in the two bodies' own frames.
  const bodyNow = (p: PartPlan) => ({ at: add(P[p.joint], qRotate(R[p.joint], p.centre)), turn: qMul(R[p.joint], p.frame) });
  const bodyBind = (p: PartPlan) => qMul(bind.rotations[p.joint], p.frame);
  for (const child of parts) {
    if (child.parent < 0) continue;
    const parent = parts[child.parent], limits = LIMITS[child.name as Exclude<PartName, "pelvis" | "held">];
    const qa = bodyBind(parent), qb = bodyBind(child);
    // A hinge is measured from the straight limb (the parent's own line); a ball joint from where the bind pose holds the child.
    const twist = limits.hinge ? qRotate(qa, [0, 1, 0]) : qRotate(qb, [0, 1, 0]);
    const bend = cross(twist, way[limits.towards]);
    // A limb that already points the way it bends has no plane of its own: any will do, and the cone stays where the bind pose is.
    const free = length(bend) < 0.3;
    let normal = free ? perpendicular(twist) : unit(bend);
    if (limits.hinge) {
      // The bone's own x axis, where it agrees with the anatomy: that is the axis the clips turn it about.
      const own = orthogonal(qRotate(bind.rotations[child.joint], [1, 0, 0]), twist), agree = own[0] * normal[0] + own[1] * normal[1] + own[2] * normal[2];
      if (Math.abs(agree) > 0.5) normal = agree > 0 ? own : scale(own, -1);
    }
    const rest = free ? twist : qRotate(qAxisAngle(normal, limits.mid), twist);
    const inA = qConj(qa), inB = qConj(qb);
    const twistA = qRotate(inA, rest), normalA = orthogonal(qRotate(inA, normal), twistA), planeA = cross(twistA, normalA);
    const twistB: V3 = [0, 1, 0], normalB = orthogonal(qRotate(inB, normal), twistB), planeB = cross(twistB, normalB);
    const a = bodyNow(parent), b = bodyNow(child), hinge = P[child.joint];
    // Where the joint stands now, in the joint's own terms (Jolt's: swing times twist about the twist axis).
    const frameA = qMul(a.turn, qFromBasis(twistA, normalA, planeA)), frameB = qMul(b.turn, qFromBasis(twistB, normalB, planeB));
    let q = qMul(qConj(frameA), frameB);
    if (q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
    const turned = Math.hypot(q[0], q[3]) || 1, twisting: Q4 = [q[0] / turned, 0, 0, q[3] / turned], swing = qMul(q, qConj(twisting));
    const twistNow = 2 * Math.atan2(twisting[0], twisting[3]), planeNow = 2 * Math.atan2(swing[1], swing[3]), normalNow = 2 * Math.atan2(swing[2], swing[3]);
    child.link = {
      anchorA: qRotate(qConj(a.turn), sub(hinge, a.at)), twistA, planeA,
      anchorB: qRotate(qConj(b.turn), sub(hinge, b.at)), twistB, planeB,
      planeHalfCone: Math.max(limits.plane, Math.abs(planeNow) + LIMIT_MARGIN), normalHalfCone: Math.max(limits.normal, Math.abs(normalNow) + LIMIT_MARGIN),
      twistMin: Math.min(-limits.twist, twistNow - LIMIT_MARGIN), twistMax: Math.max(limits.twist, twistNow + LIMIT_MARGIN), hinge: limits.hinge === true,
    };
  }

  // What the figure holds: a box welded to the part that carries its joint (every limit shut), touching nothing of the figure itself.
  const limbs = parts.length;
  if (options.held?.length) {
    const owners = partOwners(joints, { parts, apart: [], height });
    for (const held of options.held) {
      const holder = parts[owners[held.joint]], local = qConj(R[held.joint]), a = bodyNow(holder), inA = qConj(a.turn), inB = qConj(held.rotation);
      const anchor = P[held.joint], twist = qRotate(a.turn, [0, 1, 0]), plane = qRotate(a.turn, [1, 0, 0]);
      parts.push({
        name: "held", drives: false, joint: held.joint, parent: owners[held.joint], shape: { kind: "box", half: held.half }, mass: 2.5,
        centre: qRotate(local, sub(held.centre, P[held.joint])), frame: qMul(local, held.rotation),
        link: {
          anchorA: qRotate(inA, sub(anchor, a.at)), twistA: [0, 1, 0], planeA: [1, 0, 0],
          anchorB: qRotate(inB, sub(anchor, held.centre)), twistB: qRotate(inB, twist), planeB: qRotate(inB, plane),
          planeHalfCone: 0, normalHalfCone: 0, twistMin: 0, twistMax: 0,
        },
      });
    }
  }

  const apart: [number, number][] = [];
  for (let held = limbs; held < parts.length; held += 1) for (let other = 0; other < parts.length; other += 1) if (other < held) apart.push([other, held]);
  const trunkParts = new Set(["pelvis", "chest", "head"]), isArm = (name: string) => name.startsWith("arm") || name.startsWith("foreArm");
  parts.forEach((a, i) => parts.forEach((b, j) => {
    if (j <= i || j >= limbs) return;
    const linked = a.parent === j || b.parent === i, siblings = a.parent === b.parent && a.parent >= 0 && a.name.slice(0, -1) === b.name.slice(0, -1);
    // Arms pass through the trunk: a guard held against the chest at the moment of death must not be flung off it.
    const armOnTrunk = (isArm(a.name) && (trunkParts.has(b.name) || isArm(b.name))) || (isArm(b.name) && trunkParts.has(a.name));
    if (linked || siblings || armOnTrunk || (a.name === "pelvis" && b.name === "head")) apart.push([i, j]);
  }));
  return { parts, apart, height };
}

/** Where a part's body is for a pose of its joint. */
export function partBody(part: PartPlan, position: V3, rotation: Q4): { position: V3; rotation: Q4 } {
  return { position: add(position, qRotate(rotation, part.centre)), rotation: qMul(rotation, part.frame) };
}
/** The joint's pose for where its part's body is: the inverse of {@link partBody}. */
export function partJoint(part: PartPlan, bodyPosition: V3, bodyRotation: Q4): { position: V3; rotation: Q4 } {
  const rotation = qMul(bodyRotation, qConj(part.frame));
  return { position: sub(bodyPosition, qRotate(rotation, part.centre)), rotation };
}

export interface BlowInput {
  /** Ground direction the blow travels in. */
  direction: { x: number; z: number };
  /** Where the weapon met the body, world. */
  point: V3;
  /** The fight's `power`, about 0.3 to 2. */
  power: number;
}
/** How hard a killing blow of power 1 throws a body. Scene units a second, kilogram-units a second. */
export const BLOW = {
  /** Speed given to the whole body at the head, and the share of it the feet get: the body pivots over its feet. */
  carry: 1.15, feet: 0.25,
  /** Up, so the feet come unstuck. */
  lift: 0.35,
  /** The part the weapon met takes this on top, at the point it was met: off the body's axis, it turns it. */
  strike: 12,
  /** A figure that is one body is tipped over at this rate, radians a second. */
  topple: 3.2,
} as const;

/** The velocity each part is given by the blow, lowest part least. Pure, so the same blow is the same throw. */
export function blowVelocity(blow: BlowInput, heightShare: number): V3 {
  const l = Math.hypot(blow.direction.x, blow.direction.z), power = clamp(blow.power, 0.3, 2);
  const x = l > 1e-9 ? blow.direction.x / l : 0, z = l > 1e-9 ? blow.direction.z / l : 1;
  const speed = BLOW.carry * power * (BLOW.feet + (1 - BLOW.feet) * clamp(heightShare, 0, 1));
  return [x * speed, BLOW.lift * power * clamp(heightShare, 0.2, 1), z * speed];
}

/** For every joint, the index of the part that carries it: its own, or its nearest ancestor's (the pelvis for anything above it). */
export function partOwners(joints: readonly RigJoint[], plan: RagdollPlan): Int16Array {
  const own = new Int16Array(joints.length).fill(-1);
  plan.parts.forEach((part, index) => { if (part.drives !== false) own[part.joint] = index; });
  // Parents come before children in every rig this is given, but a file is not trusted to: walk up instead.
  const find = (index: number): number => { for (let at = index; at >= 0; at = joints[at].parent) if (own[at] >= 0) return own[at]; return 0; };
  return Int16Array.from(joints.map((_, index) => find(index)));
}

/**
 * How thick each part really is, from points on the figure's own skin: each
 * `sample` is a world point and the joint that moves it most. The radius is
 * the 70th centile of the points' distance from the part's line, so armour
 * ridges and cloth do not count and the body rests on its flesh.
 */
export function measureGirth(plan: RagdollPlan, owners: Int16Array, now: RigPose, samples: Iterable<{ joint: number; x: number; y: number; z: number }>): Partial<Record<PartName, number>> {
  const reach: number[][] = plan.parts.map(() => []);
  const bodies = plan.parts.map(part => partBody(part, now.positions[part.joint], now.rotations[part.joint]));
  for (const sample of samples) {
    const index = owners[sample.joint];
    if (index === undefined || index < 0) continue;
    const local = qRotate(qConj(bodies[index].rotation), [sample.x - bodies[index].position[0], sample.y - bodies[index].position[1], sample.z - bodies[index].position[2]]);
    const shape = plan.parts[index].shape;
    // Only points beside the body count, not the ones past its ends (a hand, a foot, a helmet's crest).
    const half = shape.kind === "capsule" ? shape.halfHeight + shape.radius : shape.kind === "box" ? shape.half[1] : shape.radius;
    if (Math.abs(local[1]) > half) continue;
    // A box is 1.25 radii wide and 0.85 deep: a point on the ellipse it encloses measures exactly one radius.
    reach[index].push(shape.kind === "box" ? Math.hypot(local[0] / 1.25, local[2] / 0.85) : Math.hypot(local[0], local[2]));
  }
  const girth: Partial<Record<PartName, number>> = {};
  reach.forEach((list, index) => {
    const name = plan.parts[index].name;
    if (list.length < 8 || name === "held") return;
    list.sort((a, b) => a - b);
    girth[name] = list[Math.floor(list.length * 0.7)];
  });
  return girth;
}
