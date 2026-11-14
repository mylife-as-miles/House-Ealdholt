import { createEaldholtLandformBankSampler, ealdholtRiparianDisplacementWeight, validateEaldholtRiparianCorridor, type EaldholtRiparianCorridor, type EaldholtLandformLand, type EaldholtLandformRect, type EaldholtLandformSurface } from './bank-landform';

export interface EaldholtContinuityBounds {
  readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number];
}
export interface EaldholtCoastalContinuityInput {
  readonly land: EaldholtLandformLand;
  readonly water: readonly [EaldholtLandformSurface, EaldholtLandformSurface];
  readonly sourceEnvelope: EaldholtLandformRect;
  readonly protectedFootprints: readonly EaldholtLandformRect[];
  /** Complete, pre-pass model bounds in the same valley-local frame. */
  readonly fullBounds: EaldholtContinuityBounds;
  readonly profile: 'desktop' | 'quest';
  readonly riparianCorridor?: EaldholtRiparianCorridor;
}
export interface EaldholtCoastalContinuityPatch {
  readonly vertices: Uint16Array; readonly xz: Float32Array;
  readonly beforeY: Float32Array; readonly afterY: Float32Array;
  readonly beforeNormals: Float32Array; readonly afterNormals: Float32Array;
  readonly eligibleVertices: number; readonly protectedVertices: number;
  readonly outerBoundaryVerticesChanged: number; readonly maximumRaise: number;
  readonly bounds: EaldholtContinuityBounds; readonly cpuPatchBytes: number;
}
type Point = readonly [number, number, number];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const distance = (r: EaldholtLandformRect, x: number, z: number) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const overlaps = (a: EaldholtLandformRect, b: EaldholtLandformRect) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
const expanded = (r: EaldholtLandformRect): EaldholtLandformRect => ({ minX: r.minX - .8, maxX: r.maxX + .8, minZ: r.minZ - .8, maxZ: r.maxZ + .8 });
const validRect = (r: EaldholtLandformRect) => [r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite) && r.minX < r.maxX && r.minZ < r.maxZ;
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

function waterRows(surface: EaldholtLandformSurface, axis: 0 | 2): Point[][] {
  const p = surface.positions;
  if (p.length < 12 || p.length % 6) throw Error('Continuity requires complete paired water strips.');
  const result: Point[][] = [];
  for (let i = 0; i < p.length; i += 6) {
    const a: Point = [p[i], p[i + 1], p[i + 2]], b: Point = [p[i + 3], p[i + 4], p[i + 5]];
    if (![...a, ...b].every(Number.isFinite) || Math.abs(a[axis] - b[axis]) > .001) throw Error('Invalid continuity water frame.');
    result.push([a, b].sort((l, r) => l[axis === 0 ? 2 : 0] - r[axis === 0 ? 2 : 0]));
  }
  result.sort((a, b) => a[0][axis] - b[0][axis]);
  if (result.some((row, i) => i && row[0][axis] <= result[i - 1][0][axis])) throw Error('Duplicate continuity water rows.');
  return result;
}
function nearBank(rows: Point[][], x: number): number {
  if (x <= rows[0][0][0]) return rows[0][0][2];
  for (let i = 1; i < rows.length; i++) if (x <= rows[i][0][0]) {
    const a = rows[i - 1][0], b = rows[i][0], t = (x - a[0]) / (b[0] - a[0]);
    return a[2] + (b[2] - a[2]) * t;
  }
  return rows[rows.length - 1][0][2];
}

/** A bounded form correction on the bank owner's existing land. Working map
 * orientation is +X east/-Z north; it is not an Earth/geographic survey. All
 * southern inlet/far-bank faces and complete source/crown support faces stay
 * exact. The finite footprint is retained; this does not create a horizon. */
export function createEaldholtCoastalContinuityPatch(input: EaldholtCoastalContinuityInput): EaldholtCoastalContinuityPatch {
  const { land, sourceEnvelope: source, fullBounds: full, protectedFootprints: trees, riparianCorridor } = input;
  validateEaldholtRiparianCorridor(riparianCorridor);
  const count = land.positions.length / 3;
  if (!['desktop', 'quest'].includes(input.profile) || !validRect(source) || !trees.every(validRect)
    || !Number.isInteger(count) || count < 3 || count > 65535 || land.normals.length !== count * 3
    || land.colours.length !== count * 3 || land.uv.length !== count * 2 || land.wetness.length !== count
    || !land.indices.length || land.indices.length % 3 || ![...full.min, ...full.max].every(Number.isFinite)
    || full.min.some((v, i) => v >= full.max[i])) throw Error('Invalid continuity intake.');
  const points: Point[] = Array.from({ length: count }, (_, i) => [land.positions[i * 3], land.positions[i * 3 + 1], land.positions[i * 3 + 2]]);
  for (let i = 0; i < count; i++) if (![...points[i], land.normals[i * 3], land.normals[i * 3 + 1], land.normals[i * 3 + 2], land.wetness[i], land.uv[i * 2], land.uv[i * 2 + 1], land.colours[i * 3], land.colours[i * 3 + 1], land.colours[i * 3 + 2]].every(Number.isFinite)
    || land.normals[i * 3 + 1] <= 0 || land.wetness[i] < 0 || land.wetness[i] > 1
    || points[i].some((v, axis) => v < full.min[axis] - .00002 || v > full.max[axis] + .00002)) throw Error('Nonfinite or out-of-envelope continuity land.');
  const river = waterRows(input.water[0], 0), sea = waterRows(input.water[1], 2), bank = riparianCorridor ? createEaldholtLandformBankSampler(input.water) : null;
  // Validate the requested working frame against actual geometry, not labels.
  if (Math.max(...sea.map(row => row[1][0])) >= source.minX || river[0][0][0] >= source.minX
    || river[river.length - 1][0][0] <= source.maxX || river.some(row => row[0][0] >= source.minX && row[0][0] <= source.maxX && row[0][2] <= source.maxZ)) throw Error('Continuity requires west sea, south inlet and east river.');
  const faces: number[][] = [], edges = new Map<string, { a: number; b: number; count: number }>();
  const eligible = new Uint8Array(count); eligible.fill(1);
  const guards = [expanded(source), ...trees.map(expanded)];
  for (let i = 0; i < land.indices.length; i += 3) {
    const face = [land.indices[i], land.indices[i + 1], land.indices[i + 2]];
    if (face.some(id => !Number.isInteger(id) || id < 0 || id >= count)) throw Error('Invalid continuity index.');
    const [a, b, c] = face.map(id => points[id]);
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) <= 1e-10) throw Error('Continuity needs finite upward land faces.');
    faces.push(face);
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], key = edgeKey(a, b), edge = edges.get(key);
      if (edge) { if (++edge.count > 2) throw Error('Nonmanifold continuity land.'); } else edges.set(key, { a, b, count: 1 });
    }
    const box = { minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minZ: Math.min(a[2], b[2], c[2]), maxZ: Math.max(a[2], b[2], c[2]) };
    if (guards.some(r => overlaps(box, r)) || face.some(id => land.wetness[id] > .015 || points[id][2] >= nearBank(river, points[id][0]) - .65
      || bank && bank(points[id][0], points[id][2]).distance <= riparianCorridor!.width)) for (const id of face) eligible[id] = 0;
  }
  const boundary = new Set([...edges.values()].filter(edge => edge.count === 1).flatMap(edge => [edge.a, edge.b]));
  const spanX = source.maxX - source.minX, spanZ = source.maxZ - source.minZ;
  const northWidth = source.minZ - full.min[2], eastWidth = full.max[0] - source.maxX;
  const coastX = Math.max(...sea.map(row => row[1][0])), westWidth = source.minX - coastX;
  if (northWidth <= 0 || eastWidth <= 0 || westWidth <= 0) throw Error('Continuity has no existing mainland shoulder envelope.');
  const lobe = (x: number, z: number, cx: number, cz: number, rx: number, rz: number) => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
  const after = points.map(p => [...p] as [number, number, number]), changed: number[] = [];
  let maximumRaise = 0, eligibleVertices = 0, outerBoundaryVerticesChanged = 0;
  for (let i = 0; i < count; i++) {
    if (!eligible[i]) continue; eligibleVertices++;
    const [x, y, z] = points[i];
    if (Math.abs(y - full.min[1]) < .00002 || Math.abs(y - full.max[1]) < .00002) continue;
    let treeDistance = Infinity; for (const tree of trees) treeDistance = Math.min(treeDistance, distance(tree, x, z));
    const influence = smooth((distance(source, x, z) - .8) / 4) * smooth((treeDistance - .8) / 5);
    // Broad unequal mainland masses replace the old outer-edge fade. Their
    // shoulders continue to the same perimeter; there is no added backdrop.
    const north = lobe(x, z, source.minX + spanX * .12, source.minZ - northWidth * .55, spanX * .44, Math.max(8, northWidth * .65));
    const east = lobe(x, z, source.maxX + eastWidth * .42, source.minZ + spanZ * .18, Math.max(8, eastWidth * .9), spanZ * .55);
    const west = lobe(x, z, source.minX - westWidth * .5, source.minZ + spanZ * .25, Math.max(5, westWidth * .65), spanZ * .38);
    const height = (9 * north + 6.5 * east + 4.5 * west) * influence * (bank ? ealdholtRiparianDisplacementWeight(bank(x, z).distance, riparianCorridor) : 1);
    const next = Math.fround(Math.min(y + height, full.max[1] - .0001));
    if (next <= y + .00001) continue;
    after[i][1] = next; changed.push(i); maximumRaise = Math.max(maximumRaise, next - y);
    if (boundary.has(i)) outerBoundaryVerticesChanged++;
  }
  const sums = new Float64Array(count * 3);
  for (const face of faces) {
    const [a, b, c] = face.map(id => after[id]), ab = b.map((v, k) => v - a[k]), ac = c.map((v, k) => v - a[k]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (normal[1] <= 0 || !normal.every(Number.isFinite)) throw Error('Continuity created invalid land.');
    for (const id of face) for (let k = 0; k < 3; k++) sums[id * 3 + k] += normal[k];
  }
  const vertices = Uint16Array.from(changed), xz = new Float32Array(changed.length * 2);
  const beforeY = new Float32Array(changed.length), afterY = new Float32Array(changed.length);
  const beforeNormals = new Float32Array(changed.length * 3), afterNormals = new Float32Array(changed.length * 3);
  for (let at = 0; at < changed.length; at++) {
    const id = changed[at], length = Math.hypot(sums[id * 3], sums[id * 3 + 1], sums[id * 3 + 2]);
    if (!(length > 0)) throw Error('Unsupported continuity vertex.');
    xz[at * 2] = points[id][0]; xz[at * 2 + 1] = points[id][2]; beforeY[at] = points[id][1]; afterY[at] = after[id][1];
    for (let k = 0; k < 3; k++) { beforeNormals[at * 3 + k] = land.normals[id * 3 + k]; afterNormals[at * 3 + k] = sums[id * 3 + k] / length; }
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of after) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { vertices, xz, beforeY, afterY, beforeNormals, afterNormals, eligibleVertices, protectedVertices: count - eligibleVertices,
    outerBoundaryVerticesChanged, maximumRaise, bounds: { min, max }, cpuPatchBytes: [vertices, xz, beforeY, afterY, beforeNormals, afterNormals].reduce((n, array) => n + array.byteLength, 0) };
}
