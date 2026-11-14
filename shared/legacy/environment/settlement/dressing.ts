/** Original, bounded yard details. These are spatial scenery, never inventory,
 * production, resources or progression. Every external cluster has a collider. */
import { MeshBuilder } from '../kernel/builder';
import type { Collider, MeshBuffer } from '../kernel/mesh';
import { box, lathe } from '../kernel/primitives';
import { AUTUMN_LANDMARK_FOOTPRINTS, AUTUMN_SETTLEMENT_BUILDINGS, AUTUMN_SETTLEMENT_EXTENT, AUTUMN_SETTLEMENT_PATHS, AUTUMN_WATER_LEVEL, settlementHeight } from './layout';

type Point = readonly [number, number];
type DressingKind = 'woodpile' | 'cart' | 'fence';
export interface SettlementDressingSite {
  readonly id: string; readonly kind: DressingKind;
  readonly x: number; readonly z: number; readonly yaw: number;
  readonly width: number; readonly depth: number; readonly height: number;
}
interface Footprint { x: number; z: number; width: number; depth: number; yaw: number }

function corners(p: Footprint): Point[] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => [p.x + c * x * p.width / 2 + s * z * p.depth / 2, p.z - s * x * p.width / 2 + c * z * p.depth / 2] as Point);
}
function separated(a: readonly Point[], b: readonly Point[], margin = .45): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < 4; i++) {
    const p = polygon[i], q = polygon[(i + 1) % 4], dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
    const x = -dz / length, z = dx / length;
    const pa = a.map(v => v[0] * x + v[1] * z), pb = b.map(v => v[0] * x + v[1] * z);
    if (Math.max(...pa) + margin <= Math.min(...pb) || Math.max(...pb) + margin <= Math.min(...pa)) return true;
  }
  return false;
}
function distanceToSegment(x: number, z: number, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], square = dx * dx + dz * dz;
  const t = square ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / square)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Reproducible small clusters use existing lots' edges, never random open land. */
export function settlementDressingSites(): readonly SettlementDressingSite[] {
  const occupied: Footprint[] = [
    ...AUTUMN_SETTLEMENT_BUILDINGS,
    ...AUTUMN_LANDMARK_FOOTPRINTS.map(p => ({ x: p.center[0], z: p.center[2], width: p.width, depth: p.depth, yaw: p.yaw })),
  ];
  const sites: SettlementDressingSite[] = [];
  const types: readonly DressingKind[] = ['woodpile', 'cart', 'fence'];
  for (const building of AUTUMN_SETTLEMENT_BUILDINGS.filter(b => b.landmark === null)) {
    const kind = types[sites.length % types.length];
    const width = kind === 'cart' ? 2.6 : 3.8, depth = kind === 'cart' ? 3.2 : 2.8;
    const offsets = [[-building.width / 2 - width / 2 - .65, -building.depth * .12], [building.width / 2 + width / 2 + .65, -building.depth * .12], [0, -building.depth / 2 - depth / 2 - .65], [0, building.depth / 2 + depth / 2 + .9]];
    for (const [lx, lz] of offsets) {
      const c = Math.cos(building.yaw), s = Math.sin(building.yaw);
      const candidate: SettlementDressingSite = { id: `yard-${building.id}`, kind, x: building.x + c * lx + s * lz, z: building.z - s * lx + c * lz, yaw: building.yaw, width, depth, height: kind === 'cart' ? 1.4 : 1.1 };
      const outline = corners(candidate);
      if (outline.some(([x, z]) => x < AUTUMN_SETTLEMENT_EXTENT.minX + 2 || x > AUTUMN_SETTLEMENT_EXTENT.maxX - 2 || z < AUTUMN_SETTLEMENT_EXTENT.minZ + 2 || z > AUTUMN_SETTLEMENT_EXTENT.maxZ - 2 || settlementHeight(x, z) < AUTUMN_WATER_LEVEL + .8)) continue;
      if (occupied.some(p => !separated(outline, corners(p)))) continue;
      let roadClear = true;
      // A dense footprint sample plus 0.8m clearance exceeds the sample spacing;
      // road segments cannot slip between samples through a protected yard.
      for (let ix = 0; ix <= 6 && roadClear; ix++) for (let iz = 0; iz <= 6 && roadClear; iz++) {
        const x = candidate.x + c * (-width / 2 + width * ix / 6) + s * (-depth / 2 + depth * iz / 6);
        const z = candidate.z - s * (-width / 2 + width * ix / 6) + c * (-depth / 2 + depth * iz / 6);
        for (const path of AUTUMN_SETTLEMENT_PATHS) for (let i = 1; i < path.points.length; i++) if (distanceToSegment(x, z, path.points[i - 1], path.points[i]) < path.width / 2 + .8) roadClear = false;
      }
      if (!roadClear) continue;
      sites.push(Object.freeze(candidate)); occupied.push(candidate); break;
    }
    if (sites.length === 8) break;
  }
  return Object.freeze(sites);
}

function fence(b: MeshBuilder, width: number, depth: number): void {
  b.material('settlement-timber').color(.88, .88, .82);
  for (const x of [-width / 2 + .15, 0, width / 2 - .15]) box(b, x, -.1, -depth / 2 + .15, .13, 1.02, .13);
  for (const x of [-width / 2 + .15, width / 2 - .15]) box(b, x, -.1, depth / 2 - .15, .13, 1.02, .13);
  for (const y of [.3, .68]) {
    box(b, 0, y, -depth / 2 + .15, width - .2, .1, .1);
    for (const x of [-width / 2 + .15, width / 2 - .15]) box(b, x, y, 0, .1, .1, depth - .2);
  }
}
function woodpile(b: MeshBuilder): void {
  b.material('settlement-timber');
  for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) {
    b.color(.88 + i * .07, .8 + i * .06, .67 + i * .05).push().transform(0, .19 + row * .29, (i - (2 - row) / 2) * .35, 0, 0, -Math.PI / 2);
    lathe(b, [[.16, -1.37], [.19, -1.25], [.17, 1.3]], 6, { smooth: false, capBottom: true, capTop: true });
    b.pop();
  }
  b.color(.65, .65, .6);
  for (const x of [-1.5, 1.5]) box(b, x, -.08, 0, .14, 1, 1.3);
}
function cart(b: MeshBuilder): void {
  b.material('settlement-timber').color(.94, .89, .78);
  box(b, 0, .56, -.3, 1.65, .15, 1.7);
  for (const x of [-.78, .78]) for (const y of [.77, 1.04]) box(b, x, y, -.3, .1, .19, 1.7);
  for (const z of [-1.1, .5]) for (const y of [.77, 1.04]) box(b, 0, y, z, 1.62, .19, .1);
  for (const x of [-.51, .51]) box(b, x, .42, .75, .1, .1, 1.4);
  b.color(.58, .56, .48);
  for (const x of [-.97, .97]) for (const z of [-.8, .25]) {
    b.push().transform(x, .39, z, 0, 0, -Math.PI / 2);
    lathe(b, [[.34, -.08], [.38, 0], [.34, .08]], 8, { smooth: false, capBottom: true, capTop: true });
    b.pop();
  }
}
export function buildSettlementDressing(): { meshes: MeshBuffer[]; colliders: Collider[] } {
  const b = new MeshBuilder();
  b.part('settlement').uvMode = 'world';
  const colliders: Collider[] = [];
  for (const site of settlementDressingSites()) {
    const y = settlementHeight(site.x, site.z);
    b.push().transform(site.x, y, site.z, site.yaw);
    if (site.kind === 'woodpile') woodpile(b);
    else if (site.kind === 'cart') cart(b);
    else {
      fence(b, 3.65, 2.65);
      b.material('settlement-timber').color(.97, .88, .72);
      box(b, 0, .55, -.35, 2.4, .14, .55);
      for (const x of [-.9, .9]) box(b, x, -.05, -.35, .16, .6, .4);
    }
    b.pop();
    colliders.push({ center: [site.x, y + site.height / 2, site.z], halfExtents: [site.width / 2, site.height / 2, site.depth / 2], yaw: site.yaw, landmark: null, blocksCamera: true });
  }
  b.color(1, 1, 1);
  return { meshes: b.finish(), colliders };
}
