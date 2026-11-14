/**
 * Blood on surfaces that are not the flat board: the wound on the defender's
 * skinned body, splashes on the attacker's armour, and marks on the weapon.
 * (The board keeps its instanced quads: cheaper, and one draw call.)
 *
 *  - Skinned surfaces go through SkinDecal.ts: the decal is projected onto the
 *    body as it is posed on the contact frame, its vertices take the skin
 *    weights of the triangles they came from, and it is returned as a
 *    SkinnedMesh bound to the same skeleton. It conforms to the surface and
 *    bends with the body through the stagger and the fall.
 *  - Rigid props (the spear) use three's DecalGeometry and are parented to the
 *    prop, so they ride with it.
 *
 * Geometry is built once per impact and never per frame. Every decal is handed
 * to WoundRenderer.adopt, which draws it with the one shared material and
 * disposes its geometry when the impact is undone, reset, or the body leaves.
 */
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { projectSkinDecal, raycastPosed, type DecalFrame, type SkinSource } from "./SkinDecal";

/** Most triangles one decal may hold. */
const WOUND_TRIANGLES = 4000, SPLASH_TRIANGLES = 1200;
/** A decal's depth either side of the surface point, as a multiple of its radius. */
const DEPTH = 1.6;

const vertex = new THREE.Vector3(), local = new THREE.Vector3(), direction = new THREE.Vector3(), up = new THREE.Vector3();
const inverse = new THREE.Matrix4(), orientation = new THREE.Euler(), look = new THREE.Matrix4(), size = new THREE.Vector3();
const tip = new THREE.Vector3(), shaft = new THREE.Vector3(), from = new THREE.Vector3();
/** Posed positions, reused: grown when a bigger mesh comes along, never per frame. */
let posedScratch = new Float32Array(0);
/**
 * A geometry's skin attributes as plain arrays, read once. glTF stores them quantised, normalised
 * or interleaved, so the attribute's own `array` is not safe to index: these go through the accessors.
 */
const skins = new WeakMap<THREE.BufferGeometry, { index: Uint32Array | null; skinIndex: Uint16Array; skinWeight: Float32Array }>();
function skinOf(geometry: THREE.BufferGeometry) {
  let skin = skins.get(geometry);
  if (skin) return skin;
  const indices = geometry.getAttribute("skinIndex"), weights = geometry.getAttribute("skinWeight"), count = indices.count;
  skin = { index: null, skinIndex: new Uint16Array(count * 4), skinWeight: new Float32Array(count * 4) };
  for (let i = 0; i < count; i += 1) for (let k = 0; k < 4; k += 1) {
    skin.skinIndex[i * 4 + k] = indices.getComponent(i, k);
    skin.skinWeight[i * 4 + k] = weights.getComponent(i, k);
  }
  if (geometry.index) {
    skin.index = new Uint32Array(geometry.index.count);
    for (let i = 0; i < skin.index.length; i += 1) skin.index[i] = geometry.index.getX(i);
  }
  skins.set(geometry, skin);
  return skin;
}

const plain = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/** Every visible skinned mesh under a figure. */
export function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const found: THREE.SkinnedMesh[] = [];
  root.traverse(node => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.visible && mesh.name !== "gore-decal" && mesh.geometry.getAttribute("skinIndex")) found.push(mesh);
  });
  return found;
}

/** The mesh as it is posed right now, in the form SkinDecal.ts reads. The `posed` buffer is shared: use it before the next call. */
export function capturePose(mesh: THREE.SkinnedMesh): SkinSource {
  mesh.updateWorldMatrix(true, false);
  for (const bone of mesh.skeleton.bones) bone.updateWorldMatrix(true, false);
  // boneMatrices are refreshed by the renderer; make them match the bones as they stand on this frame.
  mesh.skeleton.update();
  const geometry = mesh.geometry, count = geometry.getAttribute("position").count;
  if (posedScratch.length < count * 3) posedScratch = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    mesh.getVertexPosition(i, vertex);
    posedScratch[i * 3] = vertex.x; posedScratch[i * 3 + 1] = vertex.y; posedScratch[i * 3 + 2] = vertex.z;
  }
  const skin = skinOf(geometry);
  return {
    posed: posedScratch, vertices: count, index: skin.index, skinIndex: skin.skinIndex, skinWeight: skin.skinWeight,
    boneMatrices: mesh.skeleton.boneMatrices as Float32Array, bindMatrix: mesh.bindMatrix.elements, bindMatrixInverse: mesh.bindMatrixInverse.elements,
  };
}

/** World scale of a mesh (uniform rigs: one number is enough for a decal's size). */
const scaleOf = (mesh: THREE.Object3D): number => vertex.setFromMatrixColumn(mesh.matrixWorld, 0).length() || 1;

export interface DecalRequest {
  /** World point on (or near) the surface and the world direction the decal faces. */
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  /** Radius, world units. */
  size: number;
  /** A wound's box is twice as tall and hangs below its centre, for the blood that runs down. */
  wound: boolean;
}

/** Builds the skin-bound decal for a posed mesh, or null if the projector catches nothing. */
export function buildSkinDecal(mesh: THREE.SkinnedMesh, source: SkinSource, request: DecalRequest): THREE.SkinnedMesh | null {
  inverse.copy(mesh.matrixWorld).invert();
  const scale = scaleOf(mesh), radius = request.size / scale;
  local.set(request.point.x, request.point.y, request.point.z).applyMatrix4(inverse);
  direction.set(request.normal.x, request.normal.y, request.normal.z).transformDirection(inverse);
  up.set(0, 1, 0).transformDirection(inverse);
  const frame: DecalFrame = {
    origin: plain(local), normal: plain(direction), up: plain(up),
    half: { x: radius, y: request.wound ? radius * 2 : radius, z: radius * DEPTH },
    shift: request.wound ? { x: 0, y: -radius } : undefined,
    lift: radius * 0.04,
  };
  // A sculpted figure is dense (hundreds of triangles under a wound): the bound is on cost, not on looks.
  const decal = projectSkinDecal(source, frame, request.wound ? WOUND_TRIANGLES : SPLASH_TRIANGLES);
  if (!decal) return null;
  // A bone the skeleton does not hold would break the frame it is drawn on: such a decal is not made.
  const bones = mesh.skeleton.bones.length;
  for (let i = 0; i < decal.skinIndex.length; i += 1) if (decal.skinIndex[i] >= bones) return null;
  const geometry = new THREE.BufferGeometry();
  // Copies: the decal's arrays are views into larger buffers.
  geometry.setAttribute("position", new THREE.BufferAttribute(decal.position.slice(), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(decal.uv.slice(), 2));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(decal.skinIndex.slice(), 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(decal.skinWeight.slice(), 4));
  // Three sorts transparent meshes by their bounding sphere and would re-skin every vertex to find it: give it one.
  geometry.boundingSphere = new THREE.Sphere(local.clone(), radius * 3);
  const skinned = new THREE.SkinnedMesh(geometry);
  skinned.boundingSphere = geometry.boundingSphere.clone();
  skinned.bindMode = mesh.bindMode;
  // The same skeleton and the same bind matrix: three recomputes nothing, and the decal moves as its source does.
  skinned.bind(mesh.skeleton, mesh.bindMatrix);
  skinned.position.copy(mesh.position); skinned.quaternion.copy(mesh.quaternion); skinned.scale.copy(mesh.scale);
  skinned.userData.goreDepth = decal.depth * scale;
  (mesh.parent ?? mesh).add(skinned);
  if (!mesh.parent) { skinned.position.set(0, 0, 0); skinned.quaternion.identity(); skinned.scale.set(1, 1, 1); }
  return skinned;
}

/**
 * The wound: projected onto whichever of the defender's skinned meshes the
 * contact point lies on (the body, or the cloth over it). Null if none takes it.
 */
export function woundDecal(defender: THREE.Object3D, request: DecalRequest): THREE.SkinnedMesh | null {
  // A figure may be layered (a coat over a body): the mark belongs on the outermost layer that takes it,
  // which is the one whose decal stands highest over the contact point.
  let best: THREE.SkinnedMesh | null = null, outer = -Infinity;
  for (const mesh of skinnedMeshes(defender)) {
    const decal = buildSkinDecal(mesh, capturePose(mesh), request);
    if (!decal) continue;
    const depth = decal.geometry.getAttribute("position").count >= 6 ? decal.userData.goreDepth as number : -1e6;
    if (depth > outer) { if (best) discard(best); best = decal; outer = depth; }
    else discard(decal);
  }
  return best;
}

/**
 * A droplet thrown back from the wound: where it first meets the attacker's
 * skinned body, a small skin-bound decal. Null if it misses.
 */
export function splashDecal(attacker: THREE.Object3D, origin: { x: number; y: number; z: number }, heading: { x: number; y: number; z: number }, radius: number, reach: number): THREE.SkinnedMesh | null {
  let nearest = reach, hitMesh: THREE.SkinnedMesh | null = null;
  const meshes = skinnedMeshes(attacker);
  let last: THREE.SkinnedMesh | null = null, lastSource: SkinSource | null = null;
  for (const mesh of meshes) {
    const source = capturePose(mesh), scale = scaleOf(mesh);
    last = mesh; lastSource = source;
    inverse.copy(mesh.matrixWorld).invert();
    local.set(origin.x, origin.y, origin.z).applyMatrix4(inverse);
    direction.set(heading.x, heading.y, heading.z).transformDirection(inverse);
    const hit = raycastPosed(source, plain(local), plain(direction), nearest / scale);
    if (!hit) continue;
    nearest = hit.distance * scale; hitMesh = mesh;
  }
  if (!hitMesh) return null;
  const point = { x: origin.x + heading.x * nearest, y: origin.y + heading.y * nearest, z: origin.z + heading.z * nearest };
  // The shared pose buffer still holds the hit mesh if it was the last one posed: do not skin it twice.
  return buildSkinDecal(hitMesh, hitMesh === last && lastSource ? lastSource : capturePose(hitMesh), { point, normal: { x: -heading.x, y: -heading.y, z: -heading.z }, size: radius, wound: false });
}

/**
 * A mark on a rigid prop (the spear): DecalGeometry on the prop's own meshes,
 * `along` world units back from the socket at its tip, seen from `facing`
 * (a world direction, usually towards the camera side). Returned parented to
 * the mesh it lies on, or null if the projector catches nothing.
 */
export function weaponDecal(socket: THREE.Object3D, along: number, radius: number, facing: { x: number; y: number; z: number }): THREE.Mesh | null {
  const prop = socket.parent;
  if (!prop) return null;
  prop.updateWorldMatrix(true, true);
  tip.setFromMatrixPosition(socket.matrixWorld);
  // The shaft runs from the prop's own origin (the grip) out to the socket at its tip.
  shaft.copy(tip).sub(from.setFromMatrixPosition(prop.matrixWorld));
  if (shaft.lengthSq() < 1e-8) return null;
  shaft.normalize();
  tip.addScaledVector(shaft, -along);
  // Look at the shaft from the side that faces `facing`, square to the shaft.
  direction.set(facing.x, facing.y, facing.z).addScaledVector(shaft, -shaft.dot(direction.set(facing.x, facing.y, facing.z)));
  if (direction.lengthSq() < 1e-6) direction.set(0, 1, 0).addScaledVector(shaft, -shaft.y);
  direction.normalize();
  look.lookAt(from.copy(tip).add(direction), tip, shaft);
  orientation.setFromRotationMatrix(look);
  size.set(radius * 2, radius * 2, radius * 2.5);
  let found: THREE.Mesh | null = null, most = 0;
  prop.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh || mesh.name === "gore-decal" || mesh.name === "gore-mark") return;
    const geometry = new DecalGeometry(mesh, tip, orientation, size);
    const count = geometry.getAttribute("position")?.count ?? 0;
    if (count <= most) { geometry.dispose(); return; }
    if (found) discard(found);
    // DecalGeometry answers in world space: take it into the mesh's own frame so it rides with the prop.
    geometry.applyMatrix4(inverse.copy(mesh.matrixWorld).invert());
    found = new THREE.Mesh(geometry);
    most = count;
    mesh.add(found);
  });
  return found;
}

function discard(mesh: THREE.Mesh): void {
  mesh.removeFromParent();
  mesh.geometry.dispose();
}

