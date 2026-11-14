/**
 * The X-ray of a cinematic fatality (gore tier 3): a skeleton inside the figure, driven by its own bones every frame,
 * shown bright through a ghost of its skin while the bone at the wound cracks and shatters and the wound channel
 * opens along the blow. Ours and procedural: every bone is a shape made here, no asset is loaded.
 *
 * What it is made of (the plan is fatality/anatomyPlan.ts):
 * - the long bones of the limbs, the clavicles, hands and feet: one instanced lathe (knobbed ends, a thin shaft)
 *   between their joints, posed from the joints every frame, and a knob at each elbow and knee turned half way
 *   between its bones so a bent joint keeps its volume (anatomyPlan.ts halfBend);
 * - the spine: instanced vertebrae along the spine joints, at the back of the body;
 * - the skull, the rib cage (ribs falling forward to a breastbone, the lowest two floating) and the pelvis: one mesh
 *   each, made once, fixed to the head, chest and hip bones as they stood at the blow;
 * - the fracture: crack lines running out over the bone from where it breaks, blood in them, then a hole where the
 *   bone came away and its fragments (splinters and chips) drifting apart in the slow motion;
 * - the wound channel: a dark red tunnel along the blow's path, opening as the weapon goes in;
 * - the ghost: the figure's own meshes drawn again as a cold glass shell, while the originals are kept out of the
 *   camera's layers (their materials and their place in the figure untouched: nothing of the figure's material
 *   patches is changed, so the wound masks and the char that ride in them are there again when the skin comes back).
 *
 * The X-ray stops at once if something else takes the body (a burst hides the figure's sculpt; the map hides it all).
 *
 * Seams for the other gore systems (merged by the lead):
 * - wound masks: the ghost is drawn from the figure's own geometry with its own material; a mask texture the wound
 *   system keeps per figure could be sampled by {@link GHOST_FRAGMENT} to show the cut through the glass;
 * - severs: a limb whose bones are hidden (scaled to nothing) collapses its X-ray bones with it, as they are posed
 *   from the same joints; a severed piece thrown free is not X-rayed.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RigJoint } from "../death/ragdoll/ragdollPlan";
import { PIECE_HEIGHT, type PieceView } from "../pieces";
import {
  anatomyLayout, boneEnds, CAGE, channelLength, chestFrame, chooseFracture, fragmentAt, fragmentsOf, fragmentTurn, FRAGMENTS, GIRTH, halfBend, pelvisFrame, ribPoint, ribReach, RIBS,
  skullFrame, xrayAt, XRAY, type AnatomyLayout, type BodyFrame, type Fracture, type Fragment, type Point,
} from "./anatomyPlan";
import type { Fatality, FatalityLayer } from "./FatalityDirector";

/** How bright the bones are drawn at full strength, before the arena's exposure is taken off (vfxGlow). */
const BONE_GLOW = 2.4;
/** The skeleton's draw order: after the channel (5) and the ghost of the skin (6), and after the scene's own effects. */
const BONE_ORDER = 20;
/** Vertebrae drawn from the pelvis to the skull. */
const VERTEBRAE = 17;
/** The wound channel's radius, a share of the figure's height. */
const CHANNEL_GIRTH = 0.032;
/** How far round the break the cracks run, a share of the figure's height, and the hole the fragments leave. */
const CRACK_REACH = 0.07, GAP = 0.022;
/** Layers no camera draws: where the figure's own meshes wait while their ghost is shown. */
const HIDDEN = 0;

const COLOURS = {
  bone: new THREE.Color(0.86, 0.9, 1.0),
  blood: new THREE.Color(0.7, 0.04, 0.02),
  ghost: new THREE.Color(0.32, 0.55, 1.0),
  channel: new THREE.Color(0.42, 0.015, 0.01),
};

// ---------------------------------------------------------------- shaders

const BONE_VERTEX = /* glsl */ `
#include <common>
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  mat4 model = modelMatrix;
#ifdef USE_INSTANCING
  model = modelMatrix * instanceMatrix;
#endif
  vec4 world = model * vec4(position, 1.0);
  vWorld = world.xyz;
  // Normals through the inverse transpose (the bones are scaled unevenly); a matrix with nothing to invert draws no NaN.
  mat3 m = mat3(model);
  vec3 n = abs(determinant(m)) > 1e-12 ? transpose(inverse(m)) * normal : normal;
  vNormalW = dot(n, n) > 1e-20 ? normalize(n) : vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

/** Bone, lit from the eye, brighter where it is seen edge-on (as an X-ray shows a bone's walls), with the fracture in it. */
const BONE_FRAGMENT = /* glsl */ `
#include <common>
uniform vec3 uBone;
uniform vec3 uBlood;
uniform float uGlow;
uniform float uShow;
uniform vec3 uCrackAt;
uniform float uCrackReach;
uniform float uCrack;
uniform float uGap;
uniform float uSeed;
varying vec3 vWorld;
varying vec3 vNormalW;
vec3 xrHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// How near a point is to the edge between two cells: the lines a fracture runs along.
float xrCells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + xrHash(i + g) - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
void main() {
  vec3 n = dot(vNormalW, vNormalW) > 1e-20 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0);
  vec3 v = normalize(cameraPosition - vWorld);
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, 2.0);
  // Bright through its body, dark at its edges: it reads against the dark of the hall and against white ice alike.
  vec3 colour = uBone * (0.85 + 0.45 * facing) * (1.0 - 0.7 * rim);
  if (uCrack > 0.0) {
    float d = distance(vWorld, uCrackAt);
    float reach = max(uCrackReach * uCrack, 1e-4);
    vec3 q = vWorld * (5.0 / uCrackReach) + uSeed;
    float edge = min(xrCells(q), xrCells(q * 2.3 + 7.1) * 1.4);
    // Where the fragments came away: a hole with a broken edge.
    if (uGap > 0.0 && d < uGap * (0.7 + 0.6 * edge)) discard;
    float within = 1.0 - smoothstep(reach * 0.65, reach, d);
    float line = (1.0 - smoothstep(0.0, 0.07, edge)) * within;
    float near = 1.0 - smoothstep(0.0, reach, d);
    colour = mix(colour, uBlood * 1.6, near * near * 0.75 * uCrack);
    colour = mix(colour, vec3(0.06, 0.0, 0.0), line);
    // The raw edge of the break catches the light as it opens.
    if (uGap > 0.0) colour += vec3(1.0, 0.55, 0.45) * (1.0 - smoothstep(uGap, uGap * 1.7, d)) * 0.8;
  }
  gl_FragColor = vec4(colour * uGlow, uShow);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The ghost of the skin, skinned or rigid: a cold glass shell, its edges bright, its face nearly clear. */
const GHOST_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = dot(transformedNormal, transformedNormal) > 1e-20 ? normalize(transformedNormal) : vec3(0.0, 0.0, 1.0);
  vV = -mvPosition.xyz;
}`;

export const GHOST_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uGhost;
uniform float uMilk;
uniform float uGain;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - facing, 2.4);
  float alpha = clamp(uGhost * (0.1 + 0.62 * rim) + uMilk * 0.8, 0.0, 1.0);
  vec3 colour = uTint * (0.18 + 1.5 * rim) + vec3(0.75, 0.85, 1.0) * uMilk;
  gl_FragColor = vec4(colour * uGain, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const CHANNEL_VERTEX = /* glsl */ `
#include <common>
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
void main() {
  vAlong = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

/** The wound channel: a dark red tunnel, its far wall wet, its open end where the weapon is now. */
const CHANNEL_FRAGMENT = /* glsl */ `
uniform vec3 uRed;
uniform float uGrow;
uniform float uFade;
uniform float uGain;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
void main() {
  if (vAlong > uGrow) discard;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  vec3 colour = gl_FrontFacing ? uRed * (0.5 + 0.9 * (1.0 - facing)) : uRed * (1.0 + 1.6 * facing);
  float head = smoothstep(uGrow - 0.08, uGrow, vAlong);
  colour += uRed * 2.5 * head;
  float alpha = (gl_FrontFacing ? 0.5 : 0.92) * uFade;
  gl_FragColor = vec4(colour * uGain, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- shapes

/** A long bone, one unit long up y, radius 1 at its knobbed ends and under half that along its shaft. */
function longBoneGeometry(): THREE.BufferGeometry {
  const profile = [[0, -0.02], [0.55, 0], [0.95, 0.035], [1, 0.075], [0.8, 0.13], [0.52, 0.2], [0.42, 0.3], [0.39, 0.5], [0.42, 0.7], [0.52, 0.8], [0.8, 0.87], [1, 0.925], [0.95, 0.965], [0.55, 1], [0, 1.02]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(profile, 12);
}

/** A vertebra: a short drum, one unit across and one tall, with its spine pointing back (-z). */
function vertebraGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  const spine = new THREE.BoxGeometry(0.4, 0.55, 1.3).translate(0, -0.1, -1.35);
  const wings = new THREE.BoxGeometry(2.8, 0.3, 0.4).translate(0, 0, -0.55);
  return mergeGeometries([body, spine, wings], false) ?? body;
}

/**
 * The skull, its height (base to crown) one unit, standing on the head joint: the cranium a long egg with its face
 * drawn down and forward, eye sockets and the nose pressed in, and the jaw hung under the face. Forward is +z.
 */
function skullGeometry(): THREE.BufferGeometry {
  const cranium = new THREE.SphereGeometry(1, 30, 22);
  const position = cranium.getAttribute("position") as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    let press = 0;
    // The eye sockets and the nose go deep: in an X-ray a hole shows by its bright rim.
    for (const side of [-1, 1]) {
      const dx = v.x - side * 0.36, dy = v.y + 0.02, dz = v.z - 0.88;
      press = Math.max(press, 0.5 * Math.exp(-(dx * dx + dy * dy * 1.2 + dz * dz) / 0.028));
    }
    { const dx = v.x, dy = v.y + 0.34, dz = v.z - 0.9; press = Math.max(press, 0.42 * Math.exp(-(dx * dx * 3 + dy * dy + dz * dz) / 0.018)); }
    const r = 1 - press;
    let x = v.x * 0.36 * r, y = v.y * 0.4 * r, z = v.z * 0.46 * r;
    // The face comes down and forward from the brow; the back of the skull is full and round.
    if (v.z > 0 && v.y < 0.25) { const k = v.z * (0.25 - v.y); y -= k * 0.2; z += k * 0.04; x *= 1 - k * 0.3; }
    position.setXYZ(i, x, y + 0.56, z - 0.02);
  }
  cranium.computeVertexNormals();
  const jaw = new THREE.TorusGeometry(0.24, 0.05, 6, 18, Math.PI);
  jaw.rotateX(Math.PI / 2);
  jaw.scale(1, 1, 1.25);
  jaw.translate(0, 0.16, 0.06);
  return mergeGeometries([cranium, jaw], false) ?? cranium;
}

/** The rib cage in its unit frame (anatomyPlan.ts CAGE): each rib a tube round its curve, and the breastbone in front. */
function ribCageGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < RIBS; index += 1) for (const side of [1, -1] as const) {
    const points: THREE.Vector3[] = [];
    const reach = ribReach(index);
    for (let k = 0; k <= 12; k += 1) {
      const p = ribPoint(index, side, CAGE.start + (reach - CAGE.start) * k / 12);
      points.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const thick = CAGE.rib * (index < 2 ? 1.15 : 1);
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 18, thick, 5, false));
  }
  const s = CAGE.sternum;
  const sternum = new THREE.BoxGeometry(s.half * 2, s.top - s.bottom, 0.07, 1, 4, 1);
  const position = sternum.getAttribute("position") as THREE.BufferAttribute;
  // Narrower at its foot, as a breastbone is.
  for (let i = 0; i < position.count; i += 1) { const y = position.getY(i), t = (y + (s.top - s.bottom) / 2) / (s.top - s.bottom); position.setX(i, position.getX(i) * (0.55 + 0.45 * t)); }
  sternum.computeVertexNormals();
  sternum.translate(0, (s.top + s.bottom) / 2, s.z);
  parts.push(sternum);
  return mergeGeometries(parts, false) ?? parts[0];
}

/** The pelvis on the hips joint, its half width (the hip joints at ±1) one unit: two wings flaring up and out, the ring between them, and the sacrum behind. */
function pelvisGeometry(): THREE.BufferGeometry {
  const wing = (side: number) => {
    const g = new THREE.SphereGeometry(1, 14, 10);
    g.scale(0.42, 0.52, 0.14);
    g.rotateY(-side * 0.45);
    g.rotateZ(-side * 0.35);
    g.translate(side * 0.72, 0.38, -0.08);
    return g;
  };
  const ring = new THREE.TorusGeometry(0.58, 0.1, 8, 26);
  ring.rotateX(Math.PI / 2 + 0.45);
  ring.scale(1, 1, 0.82);
  ring.translate(0, 0.05, 0.05);
  const sacrum = new THREE.ConeGeometry(0.28, 0.75, 8, 1);
  sacrum.rotateX(Math.PI);
  sacrum.scale(1, 1, 0.45);
  sacrum.translate(0, 0.18, -0.42);
  return mergeGeometries([wing(1), wing(-1), ring, sacrum], false) ?? ring;
}

/** The wound channel, one unit long up y from its open end, radius 1, open at both ends. */
function channelGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(1, 1, 1, 18, 10, true).translate(0, 0.5, 0);
}

/** Every shape and material the X-ray uses, made once and shared by every fatality. */
class BoneKit {
  readonly longBone = longBoneGeometry();
  readonly vertebra = vertebraGeometry();
  readonly skull = skullGeometry();
  readonly cage = ribCageGeometry();
  readonly pelvis = pelvisGeometry();
  readonly shard = new THREE.OctahedronGeometry(1, 0);
  readonly knob = new THREE.SphereGeometry(1, 12, 9);
  readonly channel = channelGeometry();
  // The skeleton is X-ray sight: drawn over whatever stands between it and the eye (the ghost of the skin, a crown of
  // ice, another figure), last of all (BONE_ORDER), so it is seen whatever the shot. It is blended, not opaque, so it
  // fades in and out with the X-ray (uShow) instead of standing dark over the skin at either end.
  readonly bone = new THREE.ShaderMaterial({
    name: "XrayBone", vertexShader: BONE_VERTEX, fragmentShader: BONE_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      uBone: { value: COLOURS.bone.clone() }, uBlood: { value: COLOURS.blood.clone() }, uGlow: { value: 0 }, uShow: { value: 0 },
      uCrackAt: { value: new THREE.Vector3() }, uCrackReach: { value: 0.05 }, uCrack: { value: 0 }, uGap: { value: 0 }, uSeed: { value: 0 },
    },
  });
  readonly ghost = new THREE.ShaderMaterial({
    name: "XrayGhost", vertexShader: GHOST_VERTEX, fragmentShader: GHOST_FRAGMENT, transparent: true, depthWrite: false,
    uniforms: { uTint: { value: COLOURS.ghost.clone() }, uGhost: { value: 0 }, uMilk: { value: 0 }, uGain: { value: 1 } },
  });
  readonly tunnel = new THREE.ShaderMaterial({
    name: "XrayChannel", vertexShader: CHANNEL_VERTEX, fragmentShader: CHANNEL_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uRed: { value: COLOURS.channel.clone() }, uGrow: { value: 0 }, uFade: { value: 1 }, uGain: { value: 1 } },
  });

  dispose(): void {
    for (const geometry of [this.longBone, this.vertebra, this.skull, this.cage, this.pelvis, this.shard, this.knob, this.channel]) geometry.dispose();
    this.bone.dispose(); this.ghost.dispose(); this.tunnel.dispose();
  }
}

// ---------------------------------------------------------------- one body

const m4 = new THREE.Matrix4(), m4b = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vd = new THREE.Vector3(), ve = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const toPoint = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });
const toVector = (p: Point, out = new THREE.Vector3()) => out.set(p.x, p.y, p.z);
/** A frame's world matrix: its axes as the basis, each scaled, at its origin. */
const frameMatrix = (frame: BodyFrame, sx: number, sy: number, sz: number, out: THREE.Matrix4) =>
  out.makeBasis(toVector(frame.side, va).multiplyScalar(sx), toVector(frame.up, vb).multiplyScalar(sy), toVector(frame.forward, vc).multiplyScalar(sz)).setPosition(frame.origin.x, frame.origin.y, frame.origin.z);

/** A matrix that stands a unit-long shape along a to b, `girth` wide. */
function alongMatrix(a: THREE.Vector3, b: THREE.Vector3, girth: number, out: THREE.Matrix4): THREE.Matrix4 {
  const d = vd.subVectors(b, a), length = d.length();
  q.setFromUnitVectors(Y, length > 1e-8 ? d.divideScalar(length) : Y);
  return out.compose(a, q, ve.set(girth, Math.max(1e-5, length), girth));
}

interface Ghost { source: THREE.Mesh; copy: THREE.Mesh; mask: number }

/** The X-ray of one figure, from the blow until the skin comes back. */
class XrayBody {
  readonly group = new THREE.Group();
  private readonly bones: THREE.Object3D[];
  private readonly layout: AnatomyLayout;
  private readonly height: number;
  private readonly at: Point[] = [];
  private readonly longBones: THREE.InstancedMesh;
  private readonly knobs: THREE.InstancedMesh;
  private readonly vertebrae: THREE.InstancedMesh;
  private readonly skull: THREE.Mesh;
  private readonly cage: THREE.Mesh;
  private readonly pelvis: THREE.Mesh;
  private readonly shards: THREE.InstancedMesh;
  private readonly channel: THREE.Mesh;
  private readonly ghosts: Ghost[] = [];
  /**
   * What else the figure carries while its skin is a ghost (the gore system's skin-bound wounds and runs, made on
   * the blow or after it): kept from the camera with the skin, or they would hang in the air over the glass.
   */
  private readonly withSkin = new Map<THREE.Object3D, number>();
  /** Each fixed part in the frame of the bone that carries it: the cage on the chest, the pelvis on the hips, the skull on the head. */
  private readonly carried: { mesh: THREE.Mesh; bone: THREE.Object3D; local: THREE.Matrix4 }[] = [];
  /** The cage's half depth at the blow: how far behind the spine joints the vertebrae are drawn. */
  private readonly spineBack: number;
  private fracture!: Fracture;
  /** Where it breaks, and where the blow went in and the way it went, in the frame of the bone that carries them. */
  private readonly breakOn: { bone: THREE.Object3D; local: THREE.Vector3 } = { bone: new THREE.Object3D(), local: new THREE.Vector3() };
  private readonly wound = { bone: new THREE.Object3D(), entry: new THREE.Vector3(), direction: new THREE.Vector3(), length: 0 };
  private fragments: Fragment[] = [];
  private shatteredAt: THREE.Vector3 | null = null;
  private sinceShatter = 0;
  private hidden = false;
  private ended = false;

  static make(fatality: Fatality, kit: BoneKit): XrayBody | null {
    const victim = fatality.victim;
    if (!victim.container.parent) return null;
    victim.container.updateMatrixWorld(true);
    const bones: THREE.Object3D[] = [];
    victim.visual.traverse(node => { if ((node as THREE.Bone).isBone) bones.push(node); });
    if (bones.length < 6) return null;
    const index = new Map(bones.map((bone, i) => [bone, i]));
    const joints: RigJoint[] = bones.map(bone => ({ name: bone.name, parent: index.get(bone.parent as THREE.Object3D) ?? -1 }));
    const layout = anatomyLayout(joints);
    return layout ? new XrayBody(fatality, kit, bones, layout) : null;
  }

  private constructor(fatality: Fatality, private readonly kit: BoneKit, bones: THREE.Object3D[], layout: AnatomyLayout) {
    const victim = fatality.victim;
    this.bones = bones;
    this.layout = layout;
    this.height = PIECE_HEIGHT[victim.kind] * Math.max(0.2, victim.container.scale.y);
    this.group.name = "xray";
    this.longBones = new THREE.InstancedMesh(kit.longBone, kit.bone, layout.long.length);
    this.knobs = new THREE.InstancedMesh(kit.knob, kit.bone, Math.max(1, layout.knobs.length));
    this.knobs.count = layout.knobs.length;
    this.vertebrae = new THREE.InstancedMesh(kit.vertebra, kit.bone, VERTEBRAE);
    this.shards = new THREE.InstancedMesh(kit.shard, kit.bone, FRAGMENTS);
    this.shards.count = 0;
    this.skull = new THREE.Mesh(kit.skull, kit.bone);
    this.cage = new THREE.Mesh(kit.cage, kit.bone);
    this.pelvis = new THREE.Mesh(kit.pelvis, kit.bone);
    this.channel = new THREE.Mesh(kit.channel, kit.tunnel);
    this.channel.renderOrder = 5;
    // With no depth test, the order draws the skeleton front to back as it would stand: the trunk's bones, the spine
    // over them, the limbs and the fragments over all.
    this.cage.renderOrder = this.pelvis.renderOrder = this.skull.renderOrder = BONE_ORDER;
    this.vertebrae.renderOrder = BONE_ORDER + 1;
    this.longBones.renderOrder = this.knobs.renderOrder = BONE_ORDER + 2;
    this.shards.renderOrder = BONE_ORDER + 3;
    for (const mesh of [this.longBones, this.knobs, this.vertebrae, this.shards, this.skull, this.cage, this.pelvis, this.channel]) {
      mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      this.group.add(mesh);
    }
    this.readJoints();
    const chest = chestFrame(layout, this.at, this.height);
    this.spineBack = -CAGE.spineZ * chest.half.z * 0.75;
    // The fixed parts are placed once from the joints and then ride on their bones.
    this.carry(this.cage, layout.chest.high, frameMatrix(chest, chest.half.x, chest.half.y, chest.half.z, m4b));
    const pelvis = pelvisFrame(layout, this.at, this.height);
    this.carry(this.pelvis, layout.pelvis.hips, frameMatrix(pelvis, pelvis.width, pelvis.width, pelvis.width, m4b));
    const skull = skullFrame(layout, this.at, chest, this.height);
    this.carry(this.skull, layout.skull.head, frameMatrix(skull, skull.size, skull.size, skull.size, m4b));
    this.aim(fatality);
    this.makeGhosts(victim);
  }

  /** Reads the blow again: what it breaks, where, and the channel it opens (a spell's or a rite's own wound came). */
  aim(fatality: Fatality): void {
    const entry = toPoint(fatality.point), direction = toPoint(fatality.direction);
    if (!this.shatteredAt) {
      this.fracture = chooseFracture(this.layout, this.at, entry, direction, this.height);
      const carrier = this.bones[this.carrierOf(this.fracture)];
      this.breakOn.bone = carrier;
      this.breakOn.local.set(this.fracture.at.x, this.fracture.at.y, this.fracture.at.z).applyMatrix4(m4.copy(carrier.matrixWorld).invert());
      this.fragments = fragmentsOf(direction, this.height, fatality.seed);
      this.kit.bone.uniforms.uSeed.value = (fatality.seed % 997) / 7.3;
    }
    // The channel rides on the chest for a wound in the body, on the bone itself for a limb or the head.
    const carrier = this.bones[this.fracture.bone.kind === "long" || this.fracture.bone.kind === "skull" ? this.carrierOf(this.fracture) : this.layout.chest.high];
    const into = m4.copy(carrier.matrixWorld).invert();
    this.wound.bone = carrier;
    this.wound.entry.copy(fatality.point).applyMatrix4(into);
    this.wound.direction.copy(fatality.direction).transformDirection(into);
    const chest = chestFrame(this.layout, this.at, this.height);
    this.wound.length = channelLength(entry, direction, chest.origin, this.height);
  }

  get stats(): { bones: number; fracture: string; fragments: number; ghosts: number } {
    const bone = this.fracture.bone;
    const named = bone.kind === "long" ? this.layout.long[bone.index].name : bone.kind === "rib" ? `rib ${bone.index + 1} ${bone.side > 0 ? "left" : "right"}` : bone.kind;
    return { bones: this.layout.long.length + this.layout.knobs.length + VERTEBRAE + 3, fracture: named, fragments: this.shards.count, ghosts: this.ghosts.length };
  }

  /** Follows the body, and draws the X-ray as it stands `fatality.seconds` after the blow. Returns false once there is nothing left to show. */
  update(fatality: Fatality, scene: number, gain: number): boolean {
    if (this.ended) return false;
    const victim = fatality.victim;
    const state = xrayAt(fatality.seconds);
    if (!state.shown && fatality.seconds >= XRAY.in[0]) { this.end(); return false; }
    // Something else has taken the body (a burst, the map): the X-ray goes at once.
    if (!victim.container.parent || !this.bodyShown(victim)) { this.end(); return false; }
    victim.container.updateMatrixWorld(true);
    this.readJoints();
    for (const part of this.carried) { part.mesh.matrix.multiplyMatrices(part.bone.matrixWorld, part.local); part.mesh.matrixWorldNeedsUpdate = true; }
    this.poseBones();

    // The break follows its bone; at the shatter its fragments are let go, and drift in the slow motion.
    const crackAt = vc.copy(this.breakOn.local).applyMatrix4(this.breakOn.bone.matrixWorld);
    const uniforms = this.kit.bone.uniforms;
    uniforms.uGlow.value = gain * BONE_GLOW;
    uniforms.uShow.value = Math.min(1, Math.max(0, state.bones));
    uniforms.uCrackAt.value.copy(crackAt);
    uniforms.uCrackReach.value = this.height * CRACK_REACH;
    uniforms.uCrack.value = state.crack;
    if (state.shattered && !this.shatteredAt) { this.shatteredAt = crackAt.clone(); this.sinceShatter = 0; this.shards.count = this.fragments.length; }
    uniforms.uGap.value = this.shatteredAt ? this.height * GAP * Math.min(1, 0.4 + this.sinceShatter * 12) : 0;
    if (this.shatteredAt) { this.sinceShatter += Math.max(0, scene); this.poseShards(); }

    // The channel: from just outside where the blow went in, on along it, as far as the weapon has gone.
    const entry = new THREE.Vector3().copy(this.wound.entry).applyMatrix4(this.wound.bone.matrixWorld);
    const direction = new THREE.Vector3().copy(this.wound.direction).transformDirection(this.wound.bone.matrixWorld);
    const start = entry.clone().addScaledVector(direction, -this.height * 0.03);
    const end = start.clone().addScaledVector(direction, this.wound.length + this.height * 0.03);
    alongMatrix(start, end, this.height * CHANNEL_GIRTH, this.channel.matrix);
    this.channel.matrixWorldNeedsUpdate = true;
    const tunnel = this.kit.tunnel.uniforms;
    tunnel.uGrow.value = state.channel;
    tunnel.uFade.value = state.ghost;
    tunnel.uGain.value = gain;

    // The skin: kept from the camera while its ghost is shown, given back the moment it is not.
    const ghost = this.kit.ghost.uniforms;
    ghost.uGhost.value = state.ghost;
    ghost.uMilk.value = state.milk;
    ghost.uGain.value = gain;
    this.hideSkin(state.shown);
    if (this.hidden) this.hideCarried(victim);
    for (const item of this.ghosts) { item.copy.matrix.copy(item.source.matrixWorld); item.copy.matrixWorldNeedsUpdate = true; }
    this.group.visible = state.shown;
    return true;
  }

  /** The skin comes back and everything of the X-ray goes. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.hideSkin(false);
    this.group.visible = false;
  }

  dispose(): void {
    this.end();
    this.group.removeFromParent();
    this.longBones.dispose(); this.knobs.dispose(); this.vertebrae.dispose(); this.shards.dispose();
    for (const item of this.ghosts) item.copy.removeFromParent();
    this.ghosts.length = 0;
  }

  // ---- inside

  private readJoints(): void {
    this.bones.forEach((bone, i) => {
      const p = va.setFromMatrixPosition(bone.matrixWorld);
      const point = this.at[i];
      if (point) { point.x = p.x; point.y = p.y; point.z = p.z; } else this.at[i] = { x: p.x, y: p.y, z: p.z };
    });
  }

  /** The bone (by index) that carries a fracture: the chest for a rib or the breastbone, the joint below a long bone's break, the head. */
  private carrierOf(fracture: Fracture): number {
    const bone = fracture.bone;
    if (bone.kind === "long") return this.layout.long[bone.index].from;
    if (bone.kind === "skull") return this.layout.skull.head;
    if (bone.kind === "vertebra") return this.layout.spine[bone.index];
    return this.layout.chest.high;
  }

  private carry(mesh: THREE.Mesh, joint: number, world: THREE.Matrix4): void {
    const bone = this.bones[joint];
    this.carried.push({ mesh, bone, local: new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world) });
  }

  private poseBones(): void {
    const h = this.height;
    this.layout.long.forEach((bone, i) => {
      const [a, b] = boneEnds(bone, this.at);
      this.longBones.setMatrixAt(i, alongMatrix(toVector(a, va), toVector(b, vb), bone.girth * h, m4));
    });
    this.longBones.instanceMatrix.needsUpdate = true;
    // Each hinge's knob, half way between its bones (an idea from the creator's reference: a joint keeps its volume).
    this.layout.knobs.forEach((knob, i) => {
      const joint = this.at[knob.joint], axis = halfBend(this.at[knob.before], joint, this.at[knob.after]);
      q.setFromUnitVectors(Y, toVector(axis, vd));
      const g = knob.girth * h;
      this.knobs.setMatrixAt(i, m4.compose(toVector(joint, va), q, vb.set(g * 1.15, g * 1.45, g * 1.15)));
    });
    this.knobs.instanceMatrix.needsUpdate = true;
    // The spine: vertebrae evenly along its joints, at the back of the body, smaller up the neck.
    const chain = this.layout.spine.map(joint => this.at[joint]);
    const lengths: number[] = [0];
    for (let i = 1; i < chain.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y, chain[i].z - chain[i - 1].z));
    const total = Math.max(1e-6, lengths[lengths.length - 1]);
    const cage = this.carried[0];
    const forward = vc.setFromMatrixColumn(cage ? cage.mesh.matrix : m4.identity(), 2).normalize();
    const pointAt = (s: number, out: THREE.Vector3) => {
      const along = Math.min(total, Math.max(0, s * total));
      let k = 1;
      while (k < lengths.length - 1 && lengths[k] < along) k += 1;
      const t = (along - lengths[k - 1]) / Math.max(1e-6, lengths[k] - lengths[k - 1]);
      return out.set(chain[k - 1].x + (chain[k].x - chain[k - 1].x) * t, chain[k - 1].y + (chain[k].y - chain[k - 1].y) * t, chain[k - 1].z + (chain[k].z - chain[k - 1].z) * t);
    };
    const step = total / VERTEBRAE;
    for (let i = 0; i < VERTEBRAE; i += 1) {
      const s = (i + 0.6) / (VERTEBRAE + 0.4), up = s > 0.82 ? (s - 0.82) / 0.18 : 0;
      const at = pointAt(s, va), next = pointAt(s + 0.02, vb), before = pointAt(s - 0.02, vd);
      const tangent = next.sub(before).normalize();
      at.addScaledVector(forward, -this.spineBack * (1 - 0.6 * up));
      const back = ve.copy(forward).addScaledVector(tangent, -forward.dot(tangent)).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, back);
      const r = GIRTH.vertebra * h * (1 - 0.4 * s);
      m4.makeBasis(side.multiplyScalar(r), tangent.multiplyScalar(step * 0.6), back.multiplyScalar(r)).setPosition(at);
      this.vertebrae.setMatrixAt(i, m4);
    }
    this.vertebrae.instanceMatrix.needsUpdate = true;
  }

  private poseShards(): void {
    const start = toPoint(this.shatteredAt!), t = this.sinceShatter;
    this.fragments.forEach((fragment, i) => {
      const p = fragmentAt(fragment, start, t, this.height);
      const turn = fragmentTurn(fragment, t);
      e.set(turn.x + i, turn.y + i * 0.7, turn.z);
      q.setFromEuler(e);
      const s = fragment.size;
      m4.compose(va.set(p.x, p.y, p.z), q, fragment.splinter ? vb.set(s * 0.18, s, s * 0.18) : vb.set(s, s * 0.8, s * 0.9));
      this.shards.setMatrixAt(i, m4);
    });
    this.shards.instanceMatrix.needsUpdate = true;
  }

  /** The figure's own meshes, drawn again as the ghost. Nothing is added to the figure: the copies live in the X-ray's group. */
  private makeGhosts(victim: PieceView): void {
    victim.visual.traverseVisible(node => {
      const mesh = node as THREE.Mesh;
      // Only the figure and what it holds: a mark laid on it (the gore system's skin-bound wounds, which have no
      // normals to shade a ghost by) goes from the camera with the skin instead.
      if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.getAttribute("normal") || mesh.name === "gore-decal") return;
      const skinned = node as THREE.SkinnedMesh;
      let copy: THREE.Mesh;
      if (skinned.isSkinnedMesh) {
        const ghost = new THREE.SkinnedMesh(skinned.geometry, this.kit.ghost);
        ghost.bind(skinned.skeleton, skinned.bindMatrix);
        ghost.bindMode = skinned.bindMode;
        copy = ghost;
      } else copy = new THREE.Mesh(mesh.geometry, this.kit.ghost);
      copy.matrixAutoUpdate = false; copy.frustumCulled = false; copy.castShadow = false; copy.receiveShadow = false;
      copy.renderOrder = 6;
      copy.matrix.copy(mesh.matrixWorld);
      this.group.add(copy);
      this.ghosts.push({ source: mesh, copy, mask: mesh.layers.mask });
    });
  }

  private hideSkin(hide: boolean): void {
    if (this.hidden === hide) return;
    this.hidden = hide;
    for (const item of this.ghosts) {
      if (hide) { item.mask = item.source.layers.mask; item.source.layers.mask = HIDDEN; }
      else item.source.layers.mask = item.mask;
    }
    if (!hide) { for (const [node, mask] of this.withSkin) node.layers.mask = mask; this.withSkin.clear(); }
  }

  /** Every other mesh on the figure (a wound, a run of blood, made after the X-ray began) goes from the camera with the skin. */
  private hideCarried(victim: PieceView): void {
    victim.visual.traverseVisible(node => {
      if (!(node as THREE.Mesh).isMesh || this.withSkin.has(node) || node.layers.mask === HIDDEN || this.ghosts.some(item => item.source === node)) return;
      this.withSkin.set(node, node.layers.mask);
      node.layers.mask = HIDDEN;
    });
  }

  /** Whether the figure's sculpt is still drawn whole: a burst hides the nodes under `visual`, the map hides `visual`. */
  private bodyShown(victim: PieceView): boolean {
    if (!victim.visual.visible) return false;
    for (const item of this.ghosts) {
      for (let node: THREE.Object3D | null = item.source; node && node !== victim.visual; node = node.parent) if (!node.visible) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------- the layer

export interface XrayStats { shown: boolean; bones: number; fracture: string | null; fragments: number; ghosts: number }

/** The X-ray as one of the fatality director's layers. */
export class XrayLayer implements FatalityLayer {
  readonly object = new THREE.Group();
  private kit: BoneKit | null = null;
  private body: XrayBody | null = null;
  private last: XrayStats = { shown: false, bones: 0, fracture: null, fragments: 0, ghosts: 0 };

  /** `gain` keeps what is light itself from clipping in a bright exposure (vfx/wiring.ts vfxGlow). */
  constructor(private readonly gain: () => number = () => 1) { this.object.name = "xray"; }

  get stats(): XrayStats { return this.body ? { shown: this.body.group.visible, ...this.body.stats } : { ...this.last, shown: false }; }

  begin(fatality: Fatality): void {
    this.end();
    this.kit ??= new BoneKit();
    try { this.body = XrayBody.make(fatality, this.kit); } catch (error) { console.warn("[fatality] no X-ray for this figure", error); this.body = null; }
    if (this.body) { this.body.group.visible = false; this.object.add(this.body.group); }
  }

  update(fatality: Fatality, scene: number): void {
    if (this.body && !this.body.update(fatality, scene, this.gain())) this.drop();
  }

  refine(fatality: Fatality): void { this.body?.aim(fatality); }

  end(): void { this.drop(); }

  dispose(): void {
    this.drop();
    this.kit?.dispose(); this.kit = null;
    this.object.removeFromParent();
  }

  private drop(): void {
    if (!this.body) return;
    this.last = { shown: false, ...this.body.stats };
    this.body.dispose();
    this.body = null;
  }
}
