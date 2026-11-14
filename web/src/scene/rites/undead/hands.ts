// Adapted from LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The dead who never get out: forearms and hands reaching up through the seams the current has split, clawing at
 * the air and dragged back under. They are the undead army's crowd beyond the figures the match lends, drawn for
 * next to nothing: one small lit mesh, one draw for all of them, placed by a matrix each and closed by a number
 * each. undead/undeadPlan.ts seamHands and handPose decide where and when.
 *
 * From the reference's Kraken Crown: limbs hauling up out of a hole in the floor, cut where they cross it. Ours are
 * a corpse's arms in the dead's own grey and corrosion, the fingers curled in the vertex shader, the cut burning
 * with the arc, and veins of current under the skin.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { handPose, type SeamHand } from "./undeadPlan";

/** Where the fingers bend: the top of the palm. */
const KNUCKLE = 0.075;

function curled(geometry: THREE.BufferGeometry, curl: (y: number) => number, thumb: number): THREE.BufferGeometry {
  const position = geometry.getAttribute("position"), values = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) { values[i * 2] = curl(position.getY(i)); values[i * 2 + 1] = thumb; }
  geometry.setAttribute("aCurl", new THREE.BufferAttribute(values, 2));
  return geometry;
}

/** A forearm, its wrist at the origin, and a hand above it: palm toward +z, fingers up. */
function handGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(curled(new THREE.CylinderGeometry(0.026, 0.035, 0.5, 8, 4).translate(0, -0.25, 0), () => 0, 0));
  parts.push(curled(new THREE.BoxGeometry(0.064, KNUCKLE, 0.026, 2, 2, 1).translate(0, KNUCKLE / 2, 0), () => 0, 0));
  [[-0.023, 0.05], [-0.008, 0.062], [0.008, 0.066], [0.023, 0.058]].forEach(([x, length]) => {
    parts.push(curled(new THREE.CylinderGeometry(0.0072, 0.0092, length, 5, 3).translate(x, KNUCKLE + length / 2, 0), (y) => Math.min(1, Math.max(0, (y - KNUCKLE) / length)), 0));
  });
  const thumb = new THREE.CylinderGeometry(0.0082, 0.01, 0.046, 5, 2).translate(0, 0.023, 0).rotateZ(-0.9).translate(0.03, 0.018, 0.008);
  parts.push(curled(thumb, (y) => Math.min(1, Math.max(0, (y - 0.018) / 0.03)), 1));
  const flat = parts.map((part) => part.toNonIndexed());
  const merged = mergeGeometries(flat, false)!;
  for (const part of [...parts, ...flat]) part.dispose();
  return merged;
}

export interface HandLook { skin: number; arc: number; hot: number }

export class SeamHands {
  readonly object: THREE.InstancedMesh;
  private readonly hands: readonly SeamHand[];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly grasp: THREE.InstancedBufferAttribute;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly floor: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly turn = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(hands: readonly SeamHand[], look: HandLook, floor: number) {
    this.hands = hands; this.floor = floor;
    this.geometry = handGeometry();
    this.grasp = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, hands.length)), 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aGrasp", this.grasp);
    this.uniforms = { uHandFloor: { value: floor }, uHandTime: { value: 0 }, uHandGain: { value: 1 }, uHandArc: { value: new THREE.Color(look.arc) }, uHandHot: { value: new THREE.Color(look.hot) } };
    this.material = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.85, metalness: 0.05 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aCurl;\nattribute float aGrasp;\nvarying vec3 vHandWorld;\nvarying float vHandCurl;")
        .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
vHandCurl = aCurl.x;
if (aCurl.x > 0.0) {
  // the fingers close toward the palm about the knuckles; the thumb across it
  float angle = aGrasp * aCurl.x * (aCurl.y > 0.5 ? 1.2 : 1.9);
  float c = cos(angle), s = sin(angle);
  if (aCurl.y > 0.5) { vec3 q = transformed - vec3(0.03, 0.018, 0.0); transformed = vec3(0.03, 0.018, 0.0) + vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c); }
  else { vec3 q = transformed - vec3(transformed.x, ${KNUCKLE.toFixed(3)}, 0.0); transformed = vec3(transformed.x, ${KNUCKLE.toFixed(3)}, 0.0) + vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c); }
}`)
        .replace("#include <project_vertex>", "#include <project_vertex>\nvHandWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uHandFloor, uHandTime, uHandGain;\nuniform vec3 uHandArc, uHandHot;\nvarying vec3 vHandWorld;\nvarying float vHandCurl;\nfloat handHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }")
        // under the stone it is coming up through, nothing of it is drawn
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vHandWorld.y < uHandFloor) discard;")
        .replace("#include <emissivemap_fragment>", /* glsl */ `#include <emissivemap_fragment>
{
  // blotched with rot, the arc burning where it comes through the seam, and a stutter of current in it
  diffuseColor.rgb *= 0.75 + 0.35 * handHash(floor(vHandWorld * 60.0));
  float fromFloor = (vHandWorld.y - uHandFloor) / 0.03;
  float crossing = exp(-fromFloor * fromFloor);
  float stutter = step(0.55, fract(sin(floor(uHandTime * 19.0) + vHandWorld.x * 13.0) * 437.5));
  totalEmissiveRadiance += (uHandArc * 2.2 + uHandHot * crossing) * crossing * uHandGain + uHandArc * stutter * 0.25 * uHandGain;
}`);
    };
    this.material.customProgramCacheKey = () => "rite-undead-hands";
    this.object = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, hands.length));
    this.object.count = hands.length;
    this.object.castShadow = true;
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
    this.update(0);
  }

  update(time: number): void {
    this.uniforms.uHandTime.value = time;
    let shown = false;
    this.hands.forEach((hand, i) => {
      const pose = handPose(hand, time);
      this.grasp.setX(i, pose.grasp);
      if (!pose.shown) { this.object.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)); return; }
      shown = true;
      // the wrist comes up out of the seam to its reach, leaning out and swaying
      this.turn.setFromAxisAngle(SeamHands.UP, hand.yaw);
      this.axis.set(hand.lean.z, 0, -hand.lean.x).normalize();
      this.tilt.setFromAxisAngle(this.axis, hand.tilt + pose.sway);
      this.tilt.multiply(this.turn);
      this.at.set(hand.at.x, this.floor - 0.14 + (hand.reach + 0.14) * pose.up, hand.at.z);
      this.object.setMatrixAt(i, this.matrix.compose(this.at, this.tilt, this.one));
    });
    this.object.instanceMatrix.needsUpdate = true;
    this.grasp.needsUpdate = true;
    this.object.visible = shown;
  }

  setGain(gain: number): void { this.uniforms.uHandGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose(); this.object.dispose();
  }
}
