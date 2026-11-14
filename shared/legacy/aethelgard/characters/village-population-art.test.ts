import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  VILLAGE_POPULATION_ART, VILLAGE_POPULATION_ART_ROOT, VILLAGE_POPULATION_ART_TOTALS, getPopulationArt, populationArtByLibrary,
  populationArtLevel, validatePopulationArt, type PopulationArtEntry,
} from './village-population-art';
import {
  CROWD_LEVEL_BUDGET, EALDHOLT_VILLAGE_POPULATION, POPULATION_GROUPS, VILLAGE_PERFORMANCE_MODEL, VILLAGE_POPULATION_GROUP_COUNTS,
  getArchetypeSpec,
} from './village-population';

// The population art registry agrees with the population proposal and with the published files: every one of the 100
// residents has published level files, a clip library (or its household set's own clips) and props, and every path,
// size, hash, budget, clip name, skeleton joint and prop node the registry names is really in the files. Reads the
// canonical desktop assets (the Quest copies are checked byte-identical by npm run check:sync).

const ENV = new URL('../../../../main game/public/assets/legacy/environment/', import.meta.url);
const url = (rel: string) => new URL(rel.split('/').map(encodeURIComponent).join('/'), ENV);

interface Gltf {
  nodes: { name?: string; mesh?: number; skin?: number; children?: number[] }[];
  meshes?: { primitives: { indices?: number; attributes: Record<string, number>; targets?: unknown[] }[] }[];
  accessors: { count: number }[]; skins?: { joints: number[] }[]; materials?: unknown[]; images?: unknown[];
  animations?: { name: string; channels: { target: { node: number; path: string } }[] }[];
}
const glbCache = new Map<string, Gltf>();
function readGlb(rel: string): Gltf {
  const hit = glbCache.get(rel); if (hit) return hit;
  const data = fs.readFileSync(url(rel));
  assert.equal(data.readUInt32LE(0), 0x46546c67, `${rel} is not a binary glTF`);
  const g = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString('utf8')) as Gltf;
  glbCache.set(rel, g); return g;
}
const sha = (rel: string) => crypto.createHash('sha256').update(fs.readFileSync(url(rel))).digest('hex');
function triangles(g: Gltf): number {
  let n = 0;
  for (const m of g.meshes ?? []) for (const p of m.primitives) n += (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
  return n;
}
const pop = EALDHOLT_VILLAGE_POPULATION;
const crowd = VILLAGE_POPULATION_ART.filter(e => e.kind === 'crowd');

test('the registry covers the 100 residents exactly as the population casts them', () => {
  assert.equal(validatePopulationArt(), null);
  assert.equal(VILLAGE_POPULATION_ART.length, 100);
  for (const g of POPULATION_GROUPS) assert.equal(VILLAGE_POPULATION_ART.filter(e => e.group === g).length, VILLAGE_POPULATION_GROUP_COUNTS[g], g);
  assert.equal(crowd.length, 96);
  assert.deepEqual(VILLAGE_POPULATION_ART.filter(e => e.kind === 'existing-set').map(e => e.set).sort(),
    ['smithy-child-v1', 'smithy-elder-v1', 'smithy-spinner-v1', 'village-smith-v1']);
  const major = VILLAGE_POPULATION_ART.filter(e => e.fidelityTier === 'major').length;
  assert.ok(major >= VILLAGE_PERFORMANCE_MODEL.deeplySimulatedMajor.min && major <= VILLAGE_PERFORMANCE_MODEL.deeplySimulatedMajor.max, `${major} major`);
  assert.equal(new Set(VILLAGE_POPULATION_ART.map(e => e.householdId)).size, 25);
  for (const e of VILLAGE_POPULATION_ART) assert.equal(getPopulationArt(e.residentId), e);
  assert.equal(getPopulationArt('nobody'), null);
});

test('every file the registry names exists with its size and SHA-256', () => {
  const checked = new Set<string>();
  const file = (f: { path: string; bytes: number; sha256: string }) => {
    if (checked.has(f.path)) return; checked.add(f.path);
    assert.ok(f.path.startsWith(`${VILLAGE_POPULATION_ART_ROOT}/`), f.path);
    assert.equal(fs.statSync(url(f.path)).size, f.bytes, `${f.path} bytes`);
    assert.equal(sha(f.path), f.sha256, `${f.path} sha256`);
  };
  for (const e of VILLAGE_POPULATION_ART) {
    for (const l of e.levels) file(l);
    if (e.clipLibrary) file(e.clipLibrary);
    assert.ok(fs.existsSync(url(e.manifest)), `${e.manifest}`);
    for (const p of e.props) assert.ok(fs.existsSync(url(p.file)), p.file);
    if (e.propsFiles) { assert.ok(fs.existsSync(url(e.propsFiles.desktop))); assert.ok(fs.existsSync(url(e.propsFiles.quest))); }
  }
  // the crowd folder holds exactly the 96 registered residents (plus the index), nothing stale
  const dir = `${VILLAGE_POPULATION_ART_ROOT}/crowd-v1/residents`;
  const glbs = fs.readdirSync(url(dir)).filter(f => f.endsWith('.glb')).map(f => `${dir}/${f}`).sort();
  assert.deepEqual(glbs, crowd.map(e => e.levels[0].path).sort());
});

test('crowd files hold the budget the registry records and no clips or morphs', () => {
  for (const e of crowd) {
    const l = e.levels[0]; const g = readGlb(l.path);
    assert.equal(triangles(g), l.triangles, `${e.residentId} triangles`);
    assert.ok(l.triangles <= CROWD_LEVEL_BUDGET.triangles.max && (l.headTriangles ?? 0) >= CROWD_LEVEL_BUDGET.triangles.headMin, `${e.residentId} budget`);
    for (const m of g.meshes ?? []) for (const p of m.primitives) assert.equal((p.targets ?? []).length, 0, `${e.residentId} morphs`);
    assert.equal((g.animations ?? []).length, 0, `${e.residentId} clips`);
    assert.equal((g.materials ?? []).length, l.materials);
    assert.ok(l.materials <= CROWD_LEVEL_BUDGET.materials.max);
    assert.equal((g.images ?? []).length, 1, `${e.residentId} one atlas`);
    assert.equal(g.skins?.length, 1); assert.equal(g.skins![0].joints.length, CROWD_LEVEL_BUDGET.joints);
    assert.equal(l.atlas?.width, CROWD_LEVEL_BUDGET.textures.albedoPx);
    const m = JSON.parse(fs.readFileSync(url(e.manifest), 'utf8'));
    assert.equal(m.placementScale, e.placementScale, `${e.residentId} placement scale`);
    assert.equal(m.published.sha256, l.sha256, `${e.residentId} manifest hash`);
    assert.equal(`${VILLAGE_POPULATION_ART_ROOT}/crowd-v1/clips/${m.clipLibrary}`, e.clipLibrary!.path);
    assert.ok(m.gates.allPass, `${e.residentId} build gates`);
    const [lo, hi] = getArchetypeSpec(e.archetype).measuredScaleRange;
    assert.ok(e.placementScale >= lo - 1e-6 && e.placementScale <= hi + 1e-6, `${e.residentId} scale ${e.placementScale}`);
  }
});

test('every crowd resident plays its archetype library: same skeleton, every named clip present', () => {
  const jointOrder = new Map<string, string>();
  for (const e of crowd) {
    const g = readGlb(e.levels[0].path); const lib = readGlb(e.clipLibrary!.path);
    const joints = g.skins![0].joints.map(j => g.nodes[j].name ?? '');
    const order = joints.join(',');
    const seen = jointOrder.get(e.archetype);
    if (seen) assert.equal(order, seen, `${e.residentId}: joint order of its archetype`); else jointOrder.set(e.archetype, order);
    const names = new Set(joints);
    const clips = new Set((lib.animations ?? []).map(a => a.name));
    for (const c of [e.motions.idle, e.motions.walk, e.motions.talk, ...e.motions.roleClips]) assert.ok(clips.has(c), `${e.residentId}: ${c} in ${e.clipLibrary!.path}`);
    // every node a library clip animates is a joint of the resident (tracks bind by name)
    for (const a of lib.animations ?? []) for (const ch of a.channels) assert.ok(names.has(lib.nodes[ch.target.node].name ?? ''), `${e.residentId}: ${a.name} animates ${lib.nodes[ch.target.node].name}`);
  }
  const libs = populationArtByLibrary();
  assert.equal(libs.size, 6);
  assert.equal([...libs.values()].reduce((n, l) => n + l.length, 0), 96);
});

test('household sets keep their own clips; every prop node exists in its kit file', () => {
  for (const e of VILLAGE_POPULATION_ART.filter(x => x.kind === 'existing-set')) {
    const quest = populationArtLevel(e, 'quest'); assert.equal(quest.level, 'quest');
    assert.equal(populationArtLevel(e, 'desktop').level, 'desktop-lod1');
    const clips = new Set((readGlb(quest.path).animations ?? []).map(a => a.name));
    for (const c of [e.motions.idle, e.motions.walk, e.motions.talk, ...e.motions.roleClips]) assert.ok(clips.has(c), `${e.residentId}: ${c}`);
    assert.equal(triangles(readGlb(quest.path)), quest.triangles);
  }
  let props = 0;
  for (const e of crowd) {
    assert.equal(populationArtLevel(e, 'quest'), e.levels[0]); assert.equal(populationArtLevel(e, 'desktop'), e.levels[0]);
    for (const p of e.props) { props++; assert.ok(readGlb(p.file).nodes.some(n => n.name === p.node), `${e.residentId}: ${p.node} in ${p.file}`); }
  }
  assert.ok(props > 96);
  const residentsByProp = (id: string) => crowd.filter(e => e.props.some(p => p.id === id)).length;
  assert.ok(residentsByProp('spear') >= 10, 'spears for the guards');
});

test('measured totals are the files and stay under the committed size cap', () => {
  const walk = (rel: string): number => fs.readdirSync(url(rel)).reduce((n, f) => {
    const p = `${rel}/${f}`; const st = fs.statSync(url(p)); return n + (st.isDirectory() ? walk(p) : st.size);
  }, 0);
  const t = VILLAGE_POPULATION_ART_TOTALS;
  assert.equal(t.residents, 100); assert.equal(t.crowdResidentFiles, 96);
  assert.equal(t.crowdResidentBytes, crowd.reduce((n, e) => n + e.levels[0].bytes, 0));
  assert.equal(t.crowdTrianglesTotal, crowd.reduce((n, e) => n + e.levels[0].triangles, 0));
  assert.equal(walk(`${VILLAGE_POPULATION_ART_ROOT}/crowd-v1/clips`), t.clipLibrariesBytes);
  assert.equal(walk(`${VILLAGE_POPULATION_ART_ROOT}/crowd-v1/props`), t.propKitsBytes);
  const folder = walk(`${VILLAGE_POPULATION_ART_ROOT}/crowd-v1`);
  // the folder total includes manifests rewritten after the registry; allow the registry to trail it slightly
  assert.ok(Math.abs(folder - t.crowdFolderBytes) < 256 * 1024, `crowd-v1 ${folder} vs registry ${t.crowdFolderBytes}`);
  assert.ok(folder <= CROWD_LEVEL_BUDGET.committed.hardCapMiB * 1048576, `${(folder / 1048576).toFixed(2)} MiB`);
  assert.ok(folder <= CROWD_LEVEL_BUDGET.committed.residentsAndLibrariesTargetMiB * 1048576, 'within the 45 MiB target');
});

test('validatePopulationArt rejects a registry that drifts from the population', () => {
  const art = VILLAGE_POPULATION_ART as readonly PopulationArtEntry[];
  assert.match(validatePopulationArt(art.slice(1)) ?? '', /99 entries/);
  const first = art.find(e => e.kind === 'crowd')!;
  const swapped = art.map(e => e === first ? { ...e, archetype: first.archetype === 'child' ? 'adult-male' as const : 'child' as const } : e);
  assert.match(validatePopulationArt(swapped) ?? '', /differs from the population/);
  const badClip = art.map(e => e === first ? { ...e, motions: { ...e.motions, roleClips: ['work_unknown'] } } : e);
  assert.match(validatePopulationArt(badClip) ?? '', /not in the/);
  const heavy = art.map(e => e === first ? { ...e, levels: [{ ...e.levels[0], triangles: 9000 }] } : e);
  assert.match(validatePopulationArt(heavy) ?? '', /triangle budget/);
  assert.equal(pop.residents.length, 100);
});
