import { createEaldholtWoodlandSupportIndex, type EaldholtWoodlandPlacement, type EaldholtWoodlandSurface, type EaldholtWoodlandVillage } from './river-woodland';

export const EALDHOLT_WOODLAND_UNDERSTORY = Object.freeze({
  desktop: Object.freeze({ maximumActors: 512, maximumTriangles: 64000, lowFraction: .25, mediumFraction: .625 }),
  quest: Object.freeze({ maximumActors: 128, maximumTriangles: 16000, lowFraction: .25, mediumFraction: .625 }),
});
export interface EaldholtUnderstoryPlacement {
  readonly x: number; readonly y: number; readonly z: number;
  readonly yaw: number; readonly scale: number; readonly footprint: number;
  readonly normal: readonly [number, number, number]; readonly anchor: number;
}
export interface EaldholtUnderstoryInput {
  readonly land: EaldholtWoodlandSurface; readonly water: readonly EaldholtWoodlandSurface[];
  readonly sourceEnvelope: EaldholtWoodlandVillage;
  readonly woodlandPlacements: readonly EaldholtWoodlandPlacement[]; readonly canopyRadius: number;
  readonly grassRadius: number; readonly maximumActors: number; readonly profile: 'desktop' | 'quest';
}
type WaterTriangle = readonly [number, number, number, number, number, number];
const cellSize = 8;
function segmentDistanceSquared(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
  return (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
}
function intersectsWater(t: WaterTriangle, x: number, z: number, radius: number): boolean {
  const [ax, az, bx, bz, cx, cz] = t, det = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (Math.abs(det) > 1e-10) {
    const u = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / det;
    const v = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / det;
    if (u >= 0 && v >= 0 && u + v <= 1) return true;
  }
  const r2 = radius * radius;
  return segmentDistanceSquared(x, z, ax, az, bx, bz) <= r2
    || segmentDistanceSquared(x, z, bx, bz, cx, cz) <= r2
    || segmentDistanceSquared(x, z, cx, cz, ax, az) <= r2;
}
/** Exact XZ circle/triangle rejection catches thin water strips between the
 * support samples. The broad phase is constructed once, never per frame. */
function waterClearance(surfaces: readonly EaldholtWoodlandSurface[]) {
  const triangles: WaterTriangle[] = [], cells = new Map<string, number[]>(), spill: number[] = [];
  let maximumLevel = -Infinity;
  for (const { positions: p, indices } of surfaces) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const t: WaterTriangle = [p[a], p[a + 2], p[b], p[b + 2], p[c], p[c + 2]], id = triangles.length;
      triangles.push(t); maximumLevel = Math.max(maximumLevel, p[a + 1], p[b + 1], p[c + 1]);
      const x0 = Math.floor(Math.min(t[0], t[2], t[4]) / cellSize), x1 = Math.floor(Math.max(t[0], t[2], t[4]) / cellSize);
      const z0 = Math.floor(Math.min(t[1], t[3], t[5]) / cellSize), z1 = Math.floor(Math.max(t[1], t[3], t[5]) / cellSize);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) { spill.push(id); continue; }
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`, list = cells.get(key); if (list) list.push(id); else cells.set(key, [id]);
      }
    }
  }
  return { maximumLevel, intersects(x: number, z: number, radius: number, test: (id: number) => boolean = () => true) {
    const seen = new Set<number>();
    for (let cx = Math.floor((x - radius) / cellSize); cx <= Math.floor((x + radius) / cellSize); cx++)
      for (let cz = Math.floor((z - radius) / cellSize); cz <= Math.floor((z + radius) / cellSize); cz++)
        for (const id of cells.get(`${cx},${cz}`) ?? []) {
          if (seen.has(id)) continue; seen.add(id); if (intersectsWater(triangles[id], x, z, radius) && test(id)) return true;
        }
    return spill.some(id => intersectsWater(triangles[id], x, z, radius) && test(id));
  } };
}
function randomStream() { let seed = 0x5e2b4a39; return () => {
  seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
  return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
}; }

/** Weld coordinate-identical seam vertices before finding actual open edges.
 * Circle/edge clearance protects the entire footprint even between samples. */
function terrainBoundary({ positions: p, indices }: EaldholtWoodlandSurface): WaterTriangle[] {
  const edges = new Map<string, { count: number; edge: WaterTriangle }>();
  const key = (id: number) => `${p[id * 3]},${p[id * 3 + 1]},${p[id * 3 + 2]}`;
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = indices[i + j], b = indices[i + (j + 1) % 3], names = [key(a), key(b)].sort(), id = names.join('|');
    const existing = edges.get(id);
    if (existing) existing.count++;
    else edges.set(id, { count: 1, edge: [p[a * 3], p[a * 3 + 2], p[b * 3], p[b * 3 + 2], p[b * 3], p[b * 3 + 2]] });
  }
  return [...edges.values()].filter(edge => edge.count !== 2).map(edge => edge.edge);
}

/** Exterior only: original Landscape and every path, bed, doorway and prop it
 * contains remain protected. Roots and the full conservative plant footprint
 * are dry; sampled terrain follows a shared tangent instead of a flat card. */
export function createEaldholtUnderstoryPlacements(input: EaldholtUnderstoryInput): EaldholtUnderstoryPlacement[] {
  const settings = EALDHOLT_WOODLAND_UNDERSTORY[input.profile], envelope = input.sourceEnvelope;
  if (!settings || !Number.isInteger(input.maximumActors) || input.maximumActors < 0 || input.maximumActors > settings.maximumActors
    || !Number.isFinite(input.grassRadius) || input.grassRadius <= 0 || input.grassRadius > 2
    || !Number.isFinite(input.canopyRadius) || input.canopyRadius <= 0 || input.canopyRadius > 40
    || !Object.values(envelope).every(Number.isFinite) || envelope.maxX <= envelope.minX || envelope.maxZ <= envelope.minZ)
    throw Error('Invalid exterior understory contract.');
  const support = createEaldholtWoodlandSupportIndex([input.land]);
  // Validate every water triangle before constructing its exact clearance index.
  createEaldholtWoodlandSupportIndex(input.water, 16);
  const water = waterClearance(input.water), random = randomStream(), result: EaldholtUnderstoryPlacement[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < input.land.positions.length; i += 3) {
    minX = Math.min(minX, input.land.positions[i]); maxX = Math.max(maxX, input.land.positions[i]);
    minZ = Math.min(minZ, input.land.positions[i + 2]); maxZ = Math.max(maxZ, input.land.positions[i + 2]);
  }
  const anchors = input.woodlandPlacements.map((placement, index) => ({ placement, index })).filter(({ placement: p }) => {
    if (![p.x, p.y, p.z, p.yaw, p.scale].every(Number.isFinite) || p.scale <= 0 || p.scale > 4) throw Error('Invalid woodland root.');
    return p.x < envelope.minX || p.x > envelope.maxX || p.z < envelope.minZ || p.z > envelope.maxZ;
  });
  const boundary = terrainBoundary(input.land), terrain = waterClearance([input.land]);
  const p = input.land.positions, ix = input.land.indices;
  function tangentConflict(id: number, x: number, y: number, z: number, radius: number, gx: number, gz: number): boolean {
    const a = ix[id * 3] * 3, b = ix[id * 3 + 1] * 3, c = ix[id * 3 + 2] * 3;
    const dx1 = p[b] - p[a], dz1 = p[b + 2] - p[a + 2], dx2 = p[c] - p[a], dz2 = p[c + 2] - p[a + 2], det = dx1 * dz2 - dx2 * dz1;
    if (Math.abs(det) < 1e-9) return true;
    const tx = ((p[b + 1] - p[a + 1]) * dz2 - (p[c + 1] - p[a + 1]) * dz1) / det;
    const tz = (dx1 * (p[c + 1] - p[a + 1]) - dx2 * (p[b + 1] - p[a + 1])) / det;
    const rootError = Math.abs(p[a + 1] + tx * (x - p[a]) + tz * (z - p[a + 2]) - y);
    // A linear height difference is bounded on the whole disk by C + r|G|.
    return Math.hypot(tx, tz) > .65 || rootError + radius * Math.hypot(tx - gx, tz - gz) > .055;
  }
  if (!anchors.length || !input.maximumActors) return result;
  // Each tree contributes two loose crescents. The open sector points toward
  // the source village, retaining route/shore breaks without inventing paths.
  for (let attempt = 0; attempt < input.maximumActors * 80 && result.length < input.maximumActors; attempt++) {
    const { placement: root, index } = anchors[attempt % anchors.length];
    const inward = Math.atan2((envelope.minZ + envelope.maxZ) / 2 - root.z, (envelope.minX + envelope.maxX) / 2 - root.x);
    const lobe = Math.floor(attempt / anchors.length) % 2 ? 1 : -1;
    const angle = inward + lobe * (1.05 + random() * 1.12), distance = input.canopyRadius * root.scale * (.48 + random() * .85);
    const x = root.x + Math.cos(angle) * distance, z = root.z + Math.sin(angle) * distance;
    const scale = .85 + random() * .5, radius = input.grassRadius * scale;
    if (x - radius < envelope.maxX + .25 && x + radius > envelope.minX - .25
      && z - radius < envelope.maxZ + .25 && z + radius > envelope.minZ - .25) continue;
    if (x - radius <= minX + 2 || x + radius >= maxX - 2 || z - radius <= minZ + 2 || z + radius >= maxZ - 2) continue;
    if (water.intersects(x, z, radius + .35) || boundary.some(edge => intersectsWater(edge, x, z, radius + .2))) continue;
    const supportRoot = support.sample(x, z), west = support.sample(x - .025, z), east = support.sample(x + .025, z);
    const north = support.sample(x, z - .025), south = support.sample(x, z + .025);
    if (!supportRoot || !west || !east || !north || !south || supportRoot.slope > .65) continue;
    const gx = (east.height - west.height) / .05, gz = (south.height - north.height) / .05;
    if (supportRoot.height - radius * Math.hypot(gx, gz) <= water.maximumLevel + .05) continue;
    if (terrain.intersects(x, z, radius, id => tangentConflict(id, x, supportRoot.height, z, radius, gx, gz))) continue;
    if (result.some(other => Math.hypot(other.x - x, other.z - z) < .76 * (other.footprint + radius))) continue;
    const length = Math.hypot(gx, 1, gz);
    result.push({ x, y: supportRoot.height, z, scale, yaw: random() * Math.PI * 2, footprint: radius,
      normal: [-gx / length, 1 / length, -gz / length], anchor: index });
  }
  return result;
}
