import { Rng } from '../../environment/kernel/prng';
import { AUTUMN_SETTLEMENT_BUILDINGS, SETTLEMENT_MEADOW_CLEARINGS, AUTUMN_SETTLEMENT_EXTENT, AUTUMN_SETTLEMENT_PATHS, AUTUMN_WATER_LEVEL, SETTLEMENT_OPEN_GROUND, distanceToSettlementPath, settlementHeight, settlementShore } from '../../environment/settlement/layout';
import { settlementTreeSites } from '../../environment/settlement/nature';
import { sourceShoreSites } from './shore-layout';

export interface GroundCoverSite { readonly x: number; readonly z: number; readonly scale: number; readonly yaw: number; readonly seed: number }
export type GroundCoverKind = 'grass' | 'reedsHero' | 'reedsFar' | 'shrubs';
export interface GroundCoverPlan { readonly grass: readonly GroundCoverSite[]; readonly reedsHero: readonly GroundCoverSite[]; readonly reedsFar: readonly GroundCoverSite[]; readonly shrubs: readonly GroundCoverSite[] }
export const GROUND_COVER_LIMITS = Object.freeze({ grass: 96, reedsHero: 12, reedsFar: 60, shrubs: 16 });
export const GROUND_COVER_SEEDS = Object.freeze({ grass: 'combined-ground-grass', reeds: 'combined-ground-reeds', shrub: 'combined-ground-shrub' });
/** Conservative source-metre radii for those exact generator seeds. Includes
 * full yaw rotation, source sway/flutter at wind=.55 and shape=[0,0,.035,.012],
 * with taper=0, no thinning growth and no source form pruning. */
export const GROUND_COVER_RADIUS = Object.freeze({ grass: .45, reedsHero: 1.23, reedsFar: .56, shrubs: 1.39 });
export const GROUND_COVER_SCALE = Object.freeze({ grass: [.35, .46] as const, reedsHero: [.48, .68] as const, reedsFar: [.35, .55] as const, shrubs: [.22, .32] as const });
/** Preserve these existing clear rectangles. They are not planting areas,
 * gameplay state, new obstacles or a reason to restrict estate placement. */
export const GROUND_COVER_CLEAR_ZONES = SETTLEMENT_MEADOW_CLEARINGS;
interface Rect { x: number; z: number; width: number; depth: number; yaw?: number }
const TAU = Math.PI * 2;
const SHORE_LIPSCHITZ = 5 * .035 + 2 * .113;
function rectangleDistance(x: number, z: number, rect: Rect): number {
  const c = Math.cos(rect.yaw ?? 0), s = Math.sin(rect.yaw ?? 0), dx = x - rect.x, dz = z - rect.z;
  return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - rect.width / 2), Math.max(0, Math.abs(s * dx + c * dz) - rect.depth / 2));
}
function shoreEligible(x: number, z: number, radius: number): boolean {
  // The derivative bound proves the entire circular footprint remains on land
  // which the editor already rejects at its shore+7m dry-ground cutoff.
  return x - settlementShore(z) + radius * (1 + SHORE_LIPSCHITZ) < 6.95
    && settlementHeight(x, z) >= AUTUMN_WATER_LEVEL - .25
    && settlementHeight(x, z) <= AUTUMN_WATER_LEVEL + 1.25;
}

/** Natural, passable dressing only. No caller/world state is mutated and no
 * colliders are added. Every full source footprint occupies shore exclusion,
 * an existing protected trunk square or the editor's reserved road verge. */
export function planGroundCover(): GroundCoverPlan {
  const rng = Rng.fromKey('crownfall-source-ground-cover-layout-v1');
  const trees = settlementTreeSites().slice(0, 760), rocks = sourceShoreSites();
  const protectedLots: readonly Rect[] = [...AUTUMN_SETTLEMENT_BUILDINGS, ...SETTLEMENT_OPEN_GROUND, ...GROUND_COVER_CLEAR_ZONES];
  const result: Record<GroundCoverKind, GroundCoverSite[]> = { grass: [], reedsHero: [], reedsFar: [], shrubs: [] };
  const accepted: { site: GroundCoverSite; radius: number }[] = [];
  const trunkEligible = (x: number, z: number, radius: number) => trees.some(tree => Math.abs(x - tree.x) + radius < .8 * tree.scale - .025 && Math.abs(z - tree.z) + radius < .8 * tree.scale - .025);
  const vergeEligible = (x: number, z: number, radius: number) => {
    const edge = distanceToSettlementPath(x, z);
    return edge - radius >= .08 && edge + radius <= .625;
  };
  function add(kind: GroundCoverKind, x: number, z: number, scale: number): boolean {
    if (result[kind].length >= GROUND_COVER_LIMITS[kind]) return false;
    const radius = GROUND_COVER_RADIUS[kind] * scale;
    if (x - radius <= AUTUMN_SETTLEMENT_EXTENT.minX + .1 || x + radius >= AUTUMN_SETTLEMENT_EXTENT.maxX - .1 || z - radius <= AUTUMN_SETTLEMENT_EXTENT.minZ + .1 || z + radius >= AUTUMN_SETTLEMENT_EXTENT.maxZ - .1) return false;
    if (protectedLots.some(lot => rectangleDistance(x, z, lot) <= radius + .35)) return false;
    if (distanceToSettlementPath(x, z) - radius < .08) return false;
    if (rocks.some(rock => Math.hypot(x - rock.x, z - rock.z) < radius + rock.radius + .08)) return false;
    if (accepted.some(other => Math.hypot(x - other.site.x, z - other.site.z) < radius + other.radius + .04)) return false;
    const shore = shoreEligible(x, z, radius), trunk = trunkEligible(x, z, radius), verge = vergeEligible(x, z, radius);
    if (!shore && !trunk && !verge) return false;
    if ((kind === 'reedsHero' || kind === 'reedsFar') && !shore) return false;
    if (kind !== 'reedsHero' && kind !== 'reedsFar' && settlementHeight(x, z) < AUTUMN_WATER_LEVEL + .12) return false;
    const site = Object.freeze({ x, z, scale, yaw: rng.next() * TAU, seed: rng.next() });
    result[kind].push(site); accepted.push({ site, radius }); return true;
  }
  // Sparse full-detail reeds occupy the nearer shoreline gaps; coarse source
  // reed clumps fill the remaining shoreline without overlapping the boulders.
  for (let z = 84; z >= -84 && result.reedsHero.length < GROUND_COVER_LIMITS.reedsHero; z -= 2.7) {
    for (const coast of [3.4, 4.1, 2.8, 4.7]) {
      const pz = z + rng.jitter(.45), x = settlementShore(pz) + coast + rng.jitter(.2);
      add('reedsHero', x, pz, rng.range(...GROUND_COVER_SCALE.reedsHero));
    }
  }
  for (let z = -85; z <= 85 && result.reedsFar.length < GROUND_COVER_LIMITS.reedsFar; z += 1.25) {
    for (const coast of [3.0, 4.0, 4.9, 2.3]) {
      const pz = z + rng.jitter(.35), x = settlementShore(pz) + coast + rng.jitter(.22);
      add('reedsFar', x, pz, rng.range(...GROUND_COVER_SCALE.reedsFar));
    }
  }
  for (const tree of trees) {
    if (result.shrubs.length >= GROUND_COVER_LIMITS.shrubs) break;
    const angle = rng.next() * TAU, radius = tree.scale * .12;
    add('shrubs', tree.x + Math.cos(angle) * radius, tree.z + Math.sin(angle) * radius, rng.range(...GROUND_COVER_SCALE.shrubs));
  }
  const verges = AUTUMN_SETTLEMENT_PATHS.map(path => {
    const candidates: { x: number; z: number }[] = [];
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      for (let d = .8; d < length - .4; d += 1.5) for (const side of [-1, 1]) {
        const t = d / length, offset = (path.width / 2 + .35) * side;
        candidates.push({ x: a[0] + dx * t - dz / length * offset, z: a[1] + dz * t + dx / length * offset });
      }
    }
    return candidates;
  });
  const longest = Math.max(0, ...verges.map(path => path.length));
  for (let i = 0; i < longest && result.grass.length < GROUND_COVER_LIMITS.grass; i++) for (const path of verges) {
    const point = path[i]; if (point) add('grass', point.x, point.z, rng.range(...GROUND_COVER_SCALE.grass));
  }
  // Any remaining tufts live inside the existing trunk exclusion, rather than
  // consuming previously buildable ground or creating an invisible obstacle.
  for (const tree of trees) {
    if (result.grass.length >= GROUND_COVER_LIMITS.grass) break;
    const angle = rng.next() * TAU, radius = tree.scale * .35;
    add('grass', tree.x + Math.cos(angle) * radius, tree.z + Math.sin(angle) * radius, rng.range(...GROUND_COVER_SCALE.grass));
  }
  return Object.freeze({ grass: Object.freeze(result.grass), reedsHero: Object.freeze(result.reedsHero), reedsFar: Object.freeze(result.reedsFar), shrubs: Object.freeze(result.shrubs) });
}
