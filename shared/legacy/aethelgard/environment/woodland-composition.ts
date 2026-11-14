import { createEaldholtWoodlandPlacements, createEaldholtWoodlandSupportIndex, type EaldholtWoodlandPlacement } from './river-woodland';

type Input = Parameters<typeof createEaldholtWoodlandPlacements>[0];
type Group = { region: 'far-deep' | 'mainland'; sector: 'deep' | 'north' | 'east'; slots: number[]; seeds: number[]; frontiers: number[][]; radius: number };
export interface EaldholtWoodlandComposition {
  readonly placements: readonly EaldholtWoodlandPlacement[];
  readonly metrics: { pool: 'complete-high'; baselineActors: number; candidateActors: number; moved: number;
    anchorsPreserved: boolean; mainlandPreservedFromClusteredPool: boolean; ordinalsScaleYawPreserved: boolean; spacingUnchanged: true;
    clusterStage: { moved: number; fallback: number; seedActors: number; movedByRegion: { farDeep: number; mainland: number }; groveSeedCounts: { deep: number; north: number; east: number } };
    satelliteStage: { moved: number; fallback: number; anchorCount: number };
    baselineConnectivity: ReturnType<typeof connectivity>; clusteredConnectivity: ReturnType<typeof connectivity>; candidateConnectivity: ReturnType<typeof connectivity>;
    riparianConnectivityBefore: ReturnType<typeof connectivity>; riparianConnectivityAfter: ReturnType<typeof connectivity> };
}
function stream(seed: number) { return () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; }; }
function connectivity(placements: readonly EaldholtWoodlandPlacement[], radius: number, regions: readonly string[] = ['far-deep', 'mainland']) {
  const slots = placements.map((p, i) => regions.includes(p.region ?? '') ? i : -1).filter(i => i >= 0);
  const neighbours = new Map(slots.map(i => [i, [] as number[]]));
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
    const i = slots[a], j = slots[b], p = placements[i], q = placements[j];
    if (Math.hypot(p.x - q.x, p.z - q.z) <= radius * (p.scale + q.scale)) { neighbours.get(i)!.push(j); neighbours.get(j)!.push(i); }
  }
  const seen = new Set<number>(), sizes: number[] = [];
  for (const seed of slots) { if (seen.has(seed)) continue; let size = 0; const todo = [seed];
    while (todo.length) { const i = todo.pop()!; if (seen.has(i)) continue; seen.add(i); size++; todo.push(...neighbours.get(i)!); } sizes.push(size);
  }
  return { actors: slots.length, isolated: sizes.filter(n => n === 1).length, components: sizes.length, largestComponent: Math.max(0, ...sizes),
    scope: `Conservative crown circles for ${regions.join('/')}; not alpha-tested leaf-pixel coverage.` };
}
/** Cluster Deep/Mainland, then grow landward FarDeep satellites from fixed
 * FarFringe anchors. The ordinary pool determines slots,
 * immutable foreground/source anchors and fallback locations at runtime. No
 * source-model root arrays, camera data, extra actors or new spacing rule. */
export function createEaldholtClusteredWoodlandPlacements(input: Input): EaldholtWoodlandComposition {
  const baseline = createEaldholtWoodlandPlacements(input), placements = [...baseline], radius = input.canopyRadius;
  const source = input.sourceEnvelope ?? input.village, quest = input.profile === 'quest';
  const support = createEaldholtWoodlandSupportIndex([input.land, ...input.sourceLand ?? []]);
  const wet = createEaldholtWoodlandSupportIndex([input.water, ...input.extraWater ?? []], 16);
  const sections: { x: number; low: number; high: number }[] = [];
  for (let i = 0; i < input.water.positions.length; i += 6) { const p = input.water.positions;
    sections.push({ x: (p[i] + p[i + 3]) / 2, low: Math.min(p[i + 2], p[i + 5]), high: Math.max(p[i + 2], p[i + 5]) }); }
  sections.sort((a, b) => a.x - b.x);
  function bankAt(x: number) { for (let i = 1; i < sections.length; i++) if (x >= sections[i - 1].x && x <= sections[i].x) {
    const a = sections[i - 1], b = sections[i], t = (x - a.x) / (b.x - a.x); return { low: a.low + (b.low - a.low) * t, high: a.high + (b.high - a.high) * t, slope: (b.high - a.high) / (b.x - a.x) }; } return null; }
  const groups: Group[] = [];
  function addGroup(region: Group['region'], sector: Group['sector'], slots: number[], maximum: number, target: number) {
    if (!slots.length) return;
    const count = Math.min(maximum, Math.max(1, Math.floor(slots.length / target))), seeds = [slots[0]];
    while (seeds.length < count) { let best = -1, distance = -1;
      for (const slot of slots) { if (seeds.includes(slot)) continue; const p = baseline[slot];
        const nearest = Math.min(...seeds.map(seed => Math.hypot(p.x - baseline[seed].x, p.z - baseline[seed].z)));
        if (nearest > distance) { distance = nearest; best = slot; } }
      if (best < 0) break; seeds.push(best);
    }
    const averageScale = slots.reduce((sum, i) => sum + baseline[i].scale, 0) / slots.length;
    groups.push({ region, sector, slots, seeds, frontiers: seeds.map(seed => [seed]), radius: radius * averageScale * (1.8 + .75 * Math.sqrt(slots.length / seeds.length)) });
  }
  const deep: number[] = [], north: number[] = [], east: number[] = [];
  baseline.forEach((p, i) => { if (p.region === 'far-deep') deep.push(i); else if (p.region === 'mainland') (p.z < source.minZ ? north : east).push(i); });
  addGroup('far-deep', 'deep', deep, 3, 6); addGroup('mainland', 'north', north, quest ? 1 : 2, 10); addGroup('mainland', 'east', east, quest ? 1 : 2, 10);
  const assigned = new Map<number, { group: Group; grove: number }>(), seedSet = new Set<number>();
  for (const group of groups) { group.seeds.forEach(i => seedSet.add(i)); let ordinal = 0;
    for (const i of group.slots) if (!group.seeds.includes(i)) assigned.set(i, { group, grove: Math.floor(ordinal++ / 3) % group.seeds.length }); }
  const crownCells = new Map<string, number[]>(), crowns = input.existingCrowns ?? [];
  crowns.forEach((c, i) => { for (let x = Math.floor((c.x - c.radius) / 8); x <= Math.floor((c.x + c.radius) / 8); x++) for (let z = Math.floor((c.z - c.radius) / 8); z <= Math.floor((c.z + c.radius) / 8); z++) {
    const key = `${x},${z}`, list = crownCells.get(key); if (list) list.push(i); else crownCells.set(key, [i]); } });
  function originalCrownConflict(x: number, z: number, footprint: number) { const seen = new Set<number>();
    for (let cx = Math.floor((x - footprint) / 8); cx <= Math.floor((x + footprint) / 8); cx++) for (let cz = Math.floor((z - footprint) / 8); cz <= Math.floor((z + footprint) / 8); cz++) for (const i of crownCells.get(`${cx},${cz}`) ?? []) {
      if (seen.has(i)) continue; seen.add(i); const c = crowns[i]; if (Math.hypot(c.x - x, c.z - z) < c.radius + footprint) return true; } return false;
  }
  function valid(x: number, z: number, slot: number, group: Group) {
    const original = baseline[slot], footprint = radius * original.scale, inset = footprint + .8;
    if (x >= source.minX && x <= source.maxX && z >= source.minZ && z <= source.maxZ) return null;
    if (group.sector === 'north' && (z >= source.minZ - inset || x < source.minX + inset)) return null;
    if (group.sector === 'east' && (x <= source.maxX + inset || z > source.maxZ - inset)) return null;
    if (group.sector === 'deep') { const bank = bankAt(x); if (!bank || z <= bank.high + inset) return null; }
    const touches = (r: Input['village']) => x - footprint < r.maxX && x + footprint > r.minX && z - footprint < r.maxZ && z + footprint > r.minZ;
    if (touches(input.village) || (input.obstacles ?? []).some(touches) || originalCrownConflict(x, z, footprint)) return null;
    const root = support.sample(x, z), water = wet.sample(x, z);
    if (!root || root.slope > .58 || water && root.height < water.height + .18) return null;
    for (let edge = 0; edge < 8; edge++) {
      const angle = edge * Math.PI / 4, sx = x + Math.cos(angle) * footprint, sz = z + Math.sin(angle) * footprint;
      const floor = support.sample(sx, sz), covering = wet.sample(sx, sz);
      if (!floor || floor.slope > .72 || Math.abs(floor.height - root.height) > 2.8 || covering && floor.height < covering.height + .18) return null;
    }
    // Keep every unprocessed original position reserved. A successful early
    // move cannot block a later slot's exact safe baseline fallback.
    if (placements.some((p, i) => i !== slot && Math.hypot(p.x - x, p.z - z) < Math.max(3, radius * (original.scale + p.scale) * .68))) return null;
    return root;
  }
  let moved = 0, fallback = 0; const movedByRegion = { farDeep: 0, mainland: 0 };
  for (let slot = 0; slot < baseline.length; slot++) {
    const assignment = assigned.get(slot); if (!assignment || seedSet.has(slot)) continue;
    const { group, grove } = assignment, seed = baseline[group.seeds[grove]], original = baseline[slot], frontier = group.frontiers[grove];
    const random = stream(0x3ba91d7e ^ Math.imul(slot + 1, 0x9e3779b1)); let found = false;
    for (let attempt = 0; attempt < 256; attempt++) {
      const parent = placements[frontier[Math.floor(random() * frontier.length)]];
      const distance = Math.max(3, radius * (original.scale + parent.scale) * .68) * (1.02 + random() * .15), angle = random() * Math.PI * 2;
      const x = parent.x + Math.cos(angle) * distance, z = parent.z + Math.sin(angle) * distance;
      if (Math.hypot(x - seed.x, z - seed.z) > group.radius) continue;
      const root = valid(x, z, slot, group); if (!root) continue;
      placements[slot] = { ...original, x, y: root.height, z }; frontier.push(slot); moved++;
      movedByRegion[group.region === 'far-deep' ? 'farDeep' : 'mainland']++; found = true; break;
    }
    if (!found) fallback++;
  }
  const clustered = [...placements];
  const clusterStage = { moved, fallback, seedActors: seedSet.size, movedByRegion,
    groveSeedCounts: { deep: groups.find(g => g.sector === 'deep')?.seeds.length ?? 0,
      north: groups.find(g => g.sector === 'north')?.seeds.length ?? 0, east: groups.find(g => g.sector === 'east')?.seeds.length ?? 0 } };
  function riparianPass() {
    const deep = clustered.flatMap((p, i) => p.region === 'far-deep' ? [i] : []);
    const fringe = clustered.flatMap((p, i) => p.region === 'far-fringe' ? [i] : []);
    if (!deep.length || !fringe.length) return { moved: 0, fallback: deep.length, anchorCount: 0 };
    const count = Math.min(fringe.length, 3, Math.max(1, Math.floor(deep.length / 6)));
    const fractions = count === 1 ? [.5] : count === 2 ? [.32, .7] : [.24, .55, .78], anchors: number[] = [];
    const west = sections[0].x, east = sections[sections.length - 1].x;
    for (const fraction of fractions) {
      const target = west + (east - west) * fraction;
      const anchor = [...fringe].filter(i => !anchors.includes(i)).sort((a, b) => Math.abs(clustered[a].x - target) - Math.abs(clustered[b].x - target) || a - b)[0];
      if (anchor !== undefined) anchors.push(anchor);
    }
    const averageScale = deep.reduce((sum, i) => sum + clustered[i].scale, 0) / deep.length;
    const group: Group = { region: 'far-deep', sector: 'deep', slots: deep, seeds: anchors, frontiers: anchors.map(i => [i]),
      radius: radius * averageScale * (1.8 + .75 * Math.sqrt(deep.length / anchors.length)) };
    let moved = 0, fallback = 0;
    for (let ordinal = 0; ordinal < deep.length; ordinal++) {
      const slot = deep[ordinal], grove = Math.floor(ordinal / 3) % anchors.length, anchor = clustered[anchors[grove]];
      const original = clustered[slot], frontier = group.frontiers[grove], frame = bankAt(anchor.x)!;
      const length = Math.hypot(frame.slope, 1), nx = -frame.slope / length, nz = 1 / length;
      const random = stream(0x3ba91d7e ^ Math.imul(slot + 1, 0x9e3779b1)); let found = false;
      for (let attempt = 0; attempt < 256; attempt++) {
        const parent = placements[frontier[Math.floor(random() * frontier.length)]];
        const distance = Math.max(3, radius * (original.scale + parent.scale) * .68) * (1.02 + random() * .15);
        const angle = Math.atan2(nz, nx) + (random() - .5) * 1.9;
        const x = parent.x + Math.cos(angle) * distance, z = parent.z + Math.sin(angle) * distance;
        if (Math.hypot(x - anchor.x, z - anchor.z) > group.radius || (x - anchor.x) * nx + (z - anchor.z) * nz < radius * original.scale * .5) continue;
        // Reuse the same terrain/crown/water/spacing guard and live reservations.
        // Unprocessed clustered positions remain safe fallbacks for this pass.
        const root = valid(x, z, slot, group); if (!root) continue;
        placements[slot] = { ...original, x, y: root.height, z }; frontier.push(slot); moved++; found = true; break;
      }
      if (!found) fallback++;
    }
    return { moved, fallback, anchorCount: anchors.length };
  }
  const satelliteStage = riparianPass();
  const anchorsPreserved = baseline.every((p, i) => p.region === 'far-deep' || p.region === 'mainland' || placements[i] === p);
  const mainlandPreservedFromClusteredPool = clustered.every((p, i) => p.region !== 'mainland' || placements[i] === p);
  const ordinalsScaleYawPreserved = placements.length === baseline.length && baseline.every((p, i) => placements[i].region === p.region && placements[i].scale === p.scale && placements[i].yaw === p.yaw);
  const finalMoved = baseline.filter((p, i) => p.x !== placements[i].x || p.y !== placements[i].y || p.z !== placements[i].z).length;
  return { placements, metrics: { pool: 'complete-high', baselineActors: baseline.length, candidateActors: placements.length, moved: finalMoved,
    anchorsPreserved, mainlandPreservedFromClusteredPool, ordinalsScaleYawPreserved, spacingUnchanged: true, clusterStage, satelliteStage,
    baselineConnectivity: connectivity(baseline, radius), clusteredConnectivity: connectivity(clustered, radius), candidateConnectivity: connectivity(placements, radius),
    riparianConnectivityBefore: connectivity(clustered, radius, ['far-fringe', 'far-deep']),
    riparianConnectivityAfter: connectivity(placements, radius, ['far-fringe', 'far-deep']) } };
}
