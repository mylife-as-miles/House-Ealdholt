/**
 * Decals that stay on a moving body: projection onto a posed, skinned surface,
 * with the skin weights carried over so the decal bends with it afterwards.
 *
 * Three's DecalGeometry clips a mesh's triangles to a projector box, but it
 * does not say which triangle each output vertex came from, so its result
 * cannot be re-bound to a skeleton. This does the same clipping and keeps, for
 * every output vertex, its barycentric position in its source triangle. From
 * that:
 *  - skin indices and weights are the source triangle's, blended by the
 *    barycentric weights (the four strongest bones, renormalised);
 *  - the vertex is taken back to bind space through the inverse of its own
 *    blended bone matrix as the skeleton stands at creation;
 * so a SkinnedMesh built from the result and bound to the same skeleton lies
 * exactly on the posed surface now, and follows it through any later pose.
 *
 * Pure: typed arrays in, typed arrays out, column-major 4x4 matrices as three
 * stores them. SurfaceDecals.ts feeds it from real meshes; the node tests feed
 * it a synthetic one. (Rigid props, a spear, use DecalGeometry itself.)
 */
import type { Vec3 } from "./GoreTypes";

export interface SkinSource {
  /** Posed vertex positions in the mesh's local space (SkinnedMesh.getVertexPosition), 3 per vertex. */
  posed: ArrayLike<number>;
  /** Triangle list; null for a non-indexed mesh. */
  index: ArrayLike<number> | null;
  vertices: number;
  /** 4 bone indices and 4 weights per vertex. */
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  /** 16 per bone: bone world matrix times its inverse bind matrix (Skeleton.boneMatrices). */
  boneMatrices: ArrayLike<number>;
  bindMatrix: ArrayLike<number>;
  bindMatrixInverse: ArrayLike<number>;
}

/** The projector, in the mesh's local space. */
export interface DecalFrame {
  origin: Vec3;
  /** Unit, pointing out of the surface (towards the projector). */
  normal: Vec3;
  /** Roughly "up" on the surface; made perpendicular to the normal here. */
  up: Vec3;
  /** Half extents: x across, y along `up`, z in depth either side of the origin. */
  half: Vec3;
  /** Shifts the box along its own x and y (a wound's box hangs below its centre). */
  shift?: { x: number; y: number };
  /** Lifts the decal off the surface along the normal, against z-fighting. */
  lift?: number;
}

export interface SkinDecal {
  vertices: number;
  /** Bind space, 3 per vertex: what a SkinnedMesh's geometry holds. */
  position: Float32Array;
  /** 0..1 across the projector box. */
  uv: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Where each vertex came from: source triangle and barycentric weights (3 per vertex). */
  triangle: Uint32Array;
  bary: Float32Array;
  /** Mean height of the decal over the projector's origin, along its normal: the outermost layer has the most. */
  depth: number;
}

const EPS = 1e-9;

/** out = a * b, column-major. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float64Array): Float64Array {
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

/** General 4x4 inverse. False (and `out` untouched) for a singular matrix. */
export function invert4(m: ArrayLike<number>, out: Float64Array): boolean {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!(Math.abs(det) > 1e-18)) return false;
  const d = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return true;
}

const transform = (m: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array | Float64Array | number[], at: number): void => {
  out[at] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[at + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[at + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
};

const blended = new Float64Array(16), work = new Float64Array(16), work2 = new Float64Array(16), point = new Float64Array(3);

/** Sum of w_i * boneMatrix_i for one vertex's four influences. */
function blend(boneMatrices: ArrayLike<number>, indices: ArrayLike<number>, weights: ArrayLike<number>, at: number, out: Float64Array): Float64Array {
  out.fill(0);
  for (let k = 0; k < 4; k += 1) {
    const weight = weights[at + k];
    if (!weight) continue;
    const base = indices[at + k] * 16;
    for (let i = 0; i < 16; i += 1) out[i] += boneMatrices[base + i] * weight;
  }
  return out;
}

/**
 * Linear blend skinning of one bind-space point, exactly as three's
 * SkinnedMesh does it: bindMatrixInverse * sum(w_i * B_i) * bindMatrix * p.
 * `at` indexes the vertex in `skinIndex` / `skinWeight` (4 per vertex).
 */
export function skinPoint(
  source: Pick<SkinSource, "boneMatrices" | "bindMatrix" | "bindMatrixInverse">, skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>,
  vertex: number, x: number, y: number, z: number, out: Vec3,
): Vec3 {
  blend(source.boneMatrices, skinIndex, skinWeight, vertex * 4, blended);
  transform(source.bindMatrix, x, y, z, point, 0);
  transform(blended, point[0], point[1], point[2], point, 0);
  transform(source.bindMatrixInverse, point[0], point[1], point[2], point, 0);
  out.x = point[0]; out.y = point[1]; out.z = point[2];
  return out;
}

interface Frame { ox: number; oy: number; oz: number; x: Vec3; y: Vec3; z: Vec3 }
function frameOf(frame: Pick<DecalFrame, "origin" | "normal" | "up">): Frame {
  const n = frame.normal, length = Math.hypot(n.x, n.y, n.z) || 1;
  const z = { x: n.x / length, y: n.y / length, z: n.z / length };
  const d = frame.up.x * z.x + frame.up.y * z.y + frame.up.z * z.z;
  let y = { x: frame.up.x - z.x * d, y: frame.up.y - z.y * d, z: frame.up.z - z.z * d };
  let size = Math.hypot(y.x, y.y, y.z);
  if (size < 1e-6) { y = Math.abs(z.y) < 0.9 ? { x: -z.x * z.y, y: 1 - z.y * z.y, z: -z.z * z.y } : { x: 1 - z.x * z.x, y: -z.y * z.x, z: -z.z * z.x }; size = Math.hypot(y.x, y.y, y.z); }
  y = { x: y.x / size, y: y.y / size, z: y.z / size };
  const x = { x: y.y * z.z - y.z * z.y, y: y.z * z.x - y.x * z.z, z: y.x * z.y - y.y * z.x };
  return { ox: frame.origin.x, oy: frame.origin.y, oz: frame.origin.z, x, y, z };
}

// Polygon scratch for clipping one triangle against six planes: decal-space xyz plus barycentrics, 6 per vertex.
const MAX_POLY = 12;
let polyA = new Float64Array(MAX_POLY * 6), polyB = new Float64Array(MAX_POLY * 6);

function clip(count: number, axis: number, sign: number, limit: number): number {
  // Keeps the part where sign * coordinate <= limit.
  let kept = 0;
  for (let i = 0; i < count; i += 1) {
    const a = i * 6, b = ((i + 1) % count) * 6;
    const da = sign * polyA[a + axis] - limit, db = sign * polyA[b + axis] - limit;
    if (da <= 0) { for (let k = 0; k < 6; k += 1) polyB[kept * 6 + k] = polyA[a + k]; kept += 1; }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      for (let k = 0; k < 6; k += 1) polyB[kept * 6 + k] = polyA[a + k] + (polyA[b + k] - polyA[a + k]) * t;
      kept += 1;
    }
    if (kept >= MAX_POLY - 1) break;
  }
  const swap = polyA; polyA = polyB; polyB = swap;
  return kept;
}

/**
 * Projects a decal onto the posed surface. Null when the box catches nothing
 * that faces the projector. `maxTriangles` bounds the result.
 */
export function projectSkinDecal(source: SkinSource, decal: DecalFrame, maxTriangles = 192): SkinDecal | null {
  const f = frameOf(decal), posed = source.posed, index = source.index;
  const hx = decal.half.x, hy = decal.half.y, hz = decal.half.z, sx = decal.shift?.x ?? 0, sy = decal.shift?.y ?? 0, lift = decal.lift ?? 0;
  const triangles = index ? Math.floor(index.length / 3) : Math.floor(source.vertices / 3);
  const capacity = maxTriangles * 3;
  const position = new Float32Array(capacity * 3), uv = new Float32Array(capacity * 2);
  const skinIndex = new Uint16Array(capacity * 4), skinWeight = new Float32Array(capacity * 4);
  const from = new Uint32Array(capacity), bary = new Float32Array(capacity * 3);
  const bones = new Int32Array(12), weights = new Float64Array(12), corner = [0, 0, 0];
  if (!invert4(source.bindMatrix, work2)) return null;
  let made = 0, depth = 0;

  const emit = (triangle: number, at: number): void => {
    const b0 = polyA[at + 3], b1 = polyA[at + 4], b2 = polyA[at + 5], v = made;
    // The source triangle's twelve influences, merged by bone, strongest four kept.
    let used = 0;
    for (let c = 0; c < 3; c += 1) {
      const share = c === 0 ? b0 : c === 1 ? b1 : b2, vertex = corner[c] * 4;
      for (let k = 0; k < 4; k += 1) {
        const weight = source.skinWeight[vertex + k] * share;
        if (!(weight > 0)) continue;
        const bone = source.skinIndex[vertex + k];
        let slot = 0;
        while (slot < used && bones[slot] !== bone) slot += 1;
        if (slot === used) { bones[used] = bone; weights[used] = 0; used += 1; }
        weights[slot] += weight;
      }
    }
    let total = 0;
    for (let k = 0; k < 4; k += 1) {
      let best = -1;
      for (let slot = 0; slot < used; slot += 1) if (weights[slot] > 0 && (best < 0 || weights[slot] > weights[best])) best = slot;
      if (best < 0) { skinIndex[v * 4 + k] = 0; skinWeight[v * 4 + k] = 0; continue; }
      skinIndex[v * 4 + k] = bones[best]; skinWeight[v * 4 + k] = weights[best]; total += weights[best];
      weights[best] = 0;
    }
    if (total > 0) for (let k = 0; k < 4; k += 1) skinWeight[v * 4 + k] /= total;
    else skinWeight[v * 4] = 1;
    // The posed point (mesh-local), lifted off the surface, taken back through this vertex's own blended bone matrix.
    depth += polyA[at + 2];
    const dx = polyA[at], dy = polyA[at + 1], dz = polyA[at + 2] + lift;
    const px = f.ox + f.x.x * dx + f.y.x * dy + f.z.x * dz, py = f.oy + f.x.y * dx + f.y.y * dy + f.z.y * dz, pz = f.oz + f.x.z * dx + f.y.z * dy + f.z.z * dz;
    blend(source.boneMatrices, skinIndex, skinWeight, v * 4, blended);
    // posed = bindInverse * S * bind * p   =>   p = bind^-1 * S^-1 * bindInverse^-1 * posed
    multiply(source.bindMatrixInverse, blended, work);
    if (invert4(work, blended)) { transform(blended, px, py, pz, point, 0); transform(work2, point[0], point[1], point[2], position, v * 3); }
    else { position[v * 3] = px; position[v * 3 + 1] = py; position[v * 3 + 2] = pz; }
    uv[v * 2] = (polyA[at] - sx) / (2 * hx) + 0.5; uv[v * 2 + 1] = (polyA[at + 1] - sy) / (2 * hy) + 0.5;
    from[v] = triangle; bary[v * 3] = b0; bary[v * 3 + 1] = b1; bary[v * 3 + 2] = b2;
    made += 1;
  };

  for (let t = 0; t < triangles && made + 3 <= capacity; t += 1) {
    let outside = 0b111111, inside = true;
    for (let c = 0; c < 3; c += 1) {
      const i = index ? index[t * 3 + c] : t * 3 + c;
      corner[c] = i;
      const rx = posed[i * 3] - f.ox, ry = posed[i * 3 + 1] - f.oy, rz = posed[i * 3 + 2] - f.oz;
      const dx = rx * f.x.x + ry * f.x.y + rz * f.x.z, dy = rx * f.y.x + ry * f.y.y + rz * f.y.z, dz = rx * f.z.x + ry * f.z.y + rz * f.z.z;
      const at = c * 6;
      polyA[at] = dx; polyA[at + 1] = dy; polyA[at + 2] = dz;
      polyA[at + 3] = c === 0 ? 1 : 0; polyA[at + 4] = c === 1 ? 1 : 0; polyA[at + 5] = c === 2 ? 1 : 0;
      const code = (dx > sx + hx ? 1 : 0) | (dx < sx - hx ? 2 : 0) | (dy > sy + hy ? 4 : 0) | (dy < sy - hy ? 8 : 0) | (dz > hz ? 16 : 0) | (dz < -hz ? 32 : 0);
      outside &= code; if (code) inside = false;
    }
    if (outside) continue;
    // Only what faces the projector: the far side of a limb or a torso takes no mark.
    const ux = polyA[6] - polyA[0], uy = polyA[7] - polyA[1], vx = polyA[12] - polyA[0], vy = polyA[13] - polyA[1];
    const uz = polyA[8] - polyA[2], vz = polyA[14] - polyA[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area = Math.hypot(nx, ny, nz);
    if (area < EPS || nz / area < 0.2) continue;
    let count = 3;
    if (!inside) {
      count = clip(count, 0, 1, sx + hx); if (count >= 3) count = clip(count, 0, -1, hx - sx);
      if (count >= 3) count = clip(count, 1, 1, sy + hy); if (count >= 3) count = clip(count, 1, -1, hy - sy);
      if (count >= 3) count = clip(count, 2, 1, hz); if (count >= 3) count = clip(count, 2, -1, hz);
      if (count < 3) continue;
    }
    for (let k = 1; k + 1 < count && made + 3 <= capacity; k += 1) { emit(t, 0); emit(t, k * 6); emit(t, (k + 1) * 6); }
  }
  if (!made) return null;
  return {
    vertices: made, position: position.subarray(0, made * 3), uv: uv.subarray(0, made * 2),
    skinIndex: skinIndex.subarray(0, made * 4), skinWeight: skinWeight.subarray(0, made * 4),
    triangle: from.subarray(0, made), bary: bary.subarray(0, made * 3), depth: depth / made,
  };
}

export interface PosedHit { distance: number; point: Vec3; normal: Vec3; triangle: number }

/** The first front-facing triangle of the posed surface a ray meets (mesh-local space), or null. */
export function raycastPosed(source: Pick<SkinSource, "posed" | "index" | "vertices">, origin: Vec3, direction: Vec3, maxDistance: number): PosedHit | null {
  const posed = source.posed, index = source.index;
  const triangles = index ? Math.floor(index.length / 3) : Math.floor(source.vertices / 3);
  let best = maxDistance, found = -1, fnx = 0, fny = 0, fnz = 0;
  for (let t = 0; t < triangles; t += 1) {
    const a = (index ? index[t * 3] : t * 3) * 3, b = (index ? index[t * 3 + 1] : t * 3 + 1) * 3, c = (index ? index[t * 3 + 2] : t * 3 + 2) * 3;
    const e1x = posed[b] - posed[a], e1y = posed[b + 1] - posed[a + 1], e1z = posed[b + 2] - posed[a + 2];
    const e2x = posed[c] - posed[a], e2y = posed[c + 1] - posed[a + 1], e2z = posed[c + 2] - posed[a + 2];
    // Moller-Trumbore, front faces only.
    const px = direction.y * e2z - direction.z * e2y, py = direction.z * e2x - direction.x * e2z, pz = direction.x * e2y - direction.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det < EPS) continue;
    const tx = origin.x - posed[a], ty = origin.y - posed[a + 1], tz = origin.z - posed[a + 2];
    const u = tx * px + ty * py + tz * pz;
    if (u < 0 || u > det) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = direction.x * qx + direction.y * qy + direction.z * qz;
    if (v < 0 || u + v > det) continue;
    const distance = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (distance <= 1e-6 || distance >= best) continue;
    best = distance; found = t;
    fnx = e1y * e2z - e1z * e2y; fny = e1z * e2x - e1x * e2z; fnz = e1x * e2y - e1y * e2x;
  }
  if (found < 0) return null;
  const length = Math.hypot(fnx, fny, fnz) || 1;
  return {
    distance: best, triangle: found,
    point: { x: origin.x + direction.x * best, y: origin.y + direction.y * best, z: origin.z + direction.z * best },
    normal: { x: fnx / length, y: fny / length, z: fnz / length },
  };
}
