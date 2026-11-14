// Crowd recipe generator (original Crownfall code). Turns the appearance recipes of the village population
// (shared/legacy/aethelgard/characters/village-population.ts) into one build recipe per crowd resident for
// scripts/characters/crowd_build.py. Deterministic: the same population gives byte-identical recipes.
//
//   main-game-vr/node_modules/.bin/tsx scripts/characters/crowd_recipes.ts OUT_DIR [--only id,id,...]
//
// Writes OUT_DIR/<resident-id>.json for every crowd resident (the four built smithy residents keep their own
// household recipes) and OUT_DIR/population.json (archetypes, kits, dyes, props, the resident index and a hash of
// every recipe). Working placeholder: role labels only, no names or lore.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROWD_LEVEL_BUDGET, EALDHOLT_VILLAGE_POPULATION, POPULATION_ARCHETYPE_SPECS, POPULATION_DYES, POPULATION_OUTFIT_KITS,
  POPULATION_PROPS, getArchetypeSpec, getOutfitKit, getPopulationProp, crowdResidentFile,
} from '../../shared/legacy/aethelgard/characters/village-population.ts';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) { console.error('usage: crowd_recipes.ts OUT_DIR [--only id,id]'); process.exit(2); }
const onlyAt = rest.indexOf('--only');
const only = onlyAt >= 0 ? new Set(rest[onlyAt + 1].split(',')) : null;
mkdirSync(outDir, { recursive: true });

/** Stable 31-bit seed from a resident ID (FNV-1a), used by the Python builder for every random draw. */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h & 0x7fffffff;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x, 1);

const pop = EALDHOLT_VILLAGE_POPULATION;
const index: unknown[] = [];
let written = 0;
for (const r of pop.residents) {
  const a = r.appearance;
  if (a.kind !== 'crowd') continue;
  const spec = getArchetypeSpec(a.archetype);
  const kit = getOutfitKit(a.outfit.kit);
  const detailTargets: Record<string, number> = {};
  for (const t of a.faceTargets) detailTargets[t.target] = (detailTargets[t.target] ?? 0) + t.weight;
  const recipe = {
    status: 'working-placeholder',
    kind: 'crowd',
    generator: 'scripts/characters/crowd_recipes.ts',
    residentId: r.id,
    label: r.label,
    roleId: r.roleId,
    roleLabel: r.roleLabel,
    group: r.group,
    sex: r.sex,
    ageYears: r.ageYears,
    ageBand: r.ageBand,
    build: r.build,
    householdId: r.householdId,
    fidelityTier: r.fidelityTier,
    file: crowdResidentFile(r),
    seed: seedOf(r.id),
    archetype: a.archetype,
    archetypeReference: spec.reference,
    archetypeScaleRange: spec.measuredScaleRange,
    macro: a.macro,
    detailTargets,
    skin: a.skin,
    eyes: a.eyes,
    hair: a.hair,
    headwear: a.headwear,
    headwearStyle: a.headwearStyle,
    outfit: {
      kit: a.outfit.kit, cut: a.outfit.cut, cutSilhouette: kit.cuts.find(c => c.id === a.outfit.cut)!.silhouette,
      layers: kit.layers, wear: a.outfit.wear,
      palette: a.outfit.palette,
      colours: { main: POPULATION_DYES[a.outfit.palette.main], secondary: POPULATION_DYES[a.outfit.palette.secondary], accent: POPULATION_DYES[a.outfit.palette.accent],
        ...(a.headwearStyle.colour ? { headwear: a.headwearStyle.colour } : {}) },
      bannerPresentation: kit.bannerPresentation,
    },
    props: a.props.map(p => ({ id: p.id, socket: p.socket, kit: getPopulationProp(p.id)!.kit, source: getPopulationProp(p.id)!.source })),
    motion: a.motion,
    silhouette: a.silhouette,
    budget: CROWD_LEVEL_BUDGET,
  };
  const text = stable(recipe) + '\n';
  if (!only || only.has(r.id)) { writeFileSync(join(outDir, `${r.id}.json`), text); written++; }
  index.push({ id: r.id, archetype: a.archetype, group: r.group, kit: a.outfit.kit, tier: r.fidelityTier, householdId: r.householdId,
    sha256: createHash('sha256').update(text).digest('hex') });
}
const population = {
  status: 'working-placeholder', generator: 'scripts/characters/crowd_recipes.ts', decidedOn: pop.decidedOn,
  archetypes: POPULATION_ARCHETYPE_SPECS, kits: POPULATION_OUTFIT_KITS, dyes: POPULATION_DYES, props: POPULATION_PROPS,
  clipLibraries: pop.clipLibraries, budget: CROWD_LEVEL_BUDGET, residents: index,
};
writeFileSync(join(outDir, 'population.json'), stable(population) + '\n');
console.log(`wrote ${written} recipes (${index.length} crowd residents) to ${outDir}`);
