// Published crowd level (crowd-v1): every resident and prop-kit file matches its provenance and the crowd budget,
// and belongs to the village population. Run: main-game-vr/node_modules/.bin/tsx --test scripts/characters/crowd-assets.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROWD_LEVEL_BUDGET, EALDHOLT_VILLAGE_POPULATION, POPULATION_PROPS, crowdResidentFile, getArchetypeSpec, getPopulationResident,
} from '../../shared/legacy/aethelgard/characters/village-population.ts';

const root = join(import.meta.dirname, '../../main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1');
const published = existsSync(join(root, 'residents'));

interface Gltf {
  meshes?: { primitives: { indices?: number; attributes: Record<string, number>; targets?: unknown[]; material?: number }[] }[];
  accessors: { count: number }[]; skins?: { joints: number[] }[]; animations?: unknown[]; materials?: { doubleSided?: boolean }[];
  images?: { mimeType?: string; bufferView?: number }[]; nodes?: { name?: string }[];
}

function readGlb(path: string): Gltf {
  const b = readFileSync(path);
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${path} is not a GLB`);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as Gltf;
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('published crowd residents match provenance, budget and the population', { skip: !published && 'crowd-v1 not published' }, () => {
  const prov = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8')) as { files: Record<string, { sha256: string; bytes: number }> };
  const files = readdirSync(join(root, 'residents')).filter(f => f.endsWith('.glb'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const id = f.slice(0, -4);
    const path = join(root, 'residents', f);
    const entry = prov.files[`residents/${f}`];
    assert.ok(entry, `${f} has provenance`);
    assert.equal(entry.sha256, sha(path), `${f} sha256`);
    assert.equal(entry.bytes, statSync(path).size, `${f} bytes`);
    const resident = getPopulationResident(id);
    assert.ok(resident && resident.appearance.kind === 'crowd', `${id} is a crowd resident of the population`);
    assert.equal(crowdResidentFile(resident!), `crowd-v1/residents/${f}`);
    const m = JSON.parse(readFileSync(join(root, 'residents', `${id}.json`), 'utf8'));
    assert.equal(m.archetype, resident!.appearance.archetype);
    const [lo, hi] = getArchetypeSpec(resident!.appearance.archetype).measuredScaleRange;
    assert.ok(m.placementScale >= lo - 1e-6 && m.placementScale <= hi + 1e-6, `${id} placement scale ${m.placementScale} in [${lo}, ${hi}]`);
    assert.equal(m.clipLibrary, `${resident!.appearance.motion.library}.glb`);
    const g = readGlb(path);
    let tris = 0;
    for (const mesh of g.meshes ?? []) for (const p of mesh.primitives) {
      tris += (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
      assert.equal((p.targets ?? []).length, 0, `${id}: no morph targets`);
    }
    assert.ok(tris <= CROWD_LEVEL_BUDGET.triangles.max, `${id}: ${tris} triangles`);
    assert.equal(m.measured.triangles, tris);
    assert.ok(m.measured.headTriangles >= CROWD_LEVEL_BUDGET.triangles.headMin, `${id}: head triangles`);
    assert.equal((g.animations ?? []).length, CROWD_LEVEL_BUDGET.clipsInResidentFile, `${id}: no clips in the resident file`);
    assert.ok((g.materials ?? []).length <= CROWD_LEVEL_BUDGET.materials.max, `${id}: materials`);
    assert.equal(g.skins?.length, 1);
    assert.equal(g.skins![0].joints.length, CROWD_LEVEL_BUDGET.joints, `${id}: 64 joints`);
    assert.equal((g.images ?? []).length, 1, `${id}: one atlas`);
    assert.ok(statSync(path).size <= CROWD_LEVEL_BUDGET.file.maxMiB * 1048576, `${id}: file size`);
    assert.ok(m.gates.allPass, `${id}: build gates`);
    // art fixer, 8 November: the scalp is covered under every full cover and no headwear shell leaves shards
    assert.equal(m.gates.headwearCovers, true, `${id}: headwear coverage gate`);
    assert.equal(m.outfit.cut, resident!.appearance.outfit.cut, `${id}: built with its cut`);
    assert.ok(m.faceCalibration && m.faceCalibration.upperLidClosed > 0, `${id}: joints-only face calibrated`);
  }
});

test('residents of one archetype share the body skeleton joint order', { skip: !published && 'crowd-v1 not published' }, () => {
  const byArchetype = new Map<string, string>();
  for (const f of readdirSync(join(root, 'residents')).filter(x => x.endsWith('.glb'))) {
    const g = readGlb(join(root, 'residents', f));
    const names = g.skins![0].joints.map(j => g.nodes![j].name).join(',');
    const arch = getPopulationResident(f.slice(0, -4))!.appearance.archetype;
    const seen = byArchetype.get(arch);
    if (seen) assert.equal(names, seen, `${f}: joint order matches its archetype`);
    else byArchetype.set(arch, names);
  }
});

test('prop kits hold every population prop once and match provenance', { skip: !existsSync(join(root, 'props/kits.json')) && 'props not published' }, () => {
  const kits = JSON.parse(readFileSync(join(root, 'props/kits.json'), 'utf8')).kits as Record<string, { file: string; props: Record<string, { node: string }> }>;
  const prov = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8')).files as Record<string, { sha256: string }>;
  const ids: string[] = [];
  for (const [kit, k] of Object.entries(kits)) {
    const path = join(root, 'props', k.file);
    assert.equal(prov[`props/${k.file}`].sha256, sha(path), `${k.file} sha256`);
    const g = readGlb(path);
    const nodes = new Set((g.nodes ?? []).map(n => n.name));
    assert.equal((g.images ?? []).length, 1, `${kit}: one atlas`);
    assert.ok((g.materials ?? []).length === 1, `${kit}: one material`);
    for (const [pid, p] of Object.entries(k.props)) { ids.push(pid); assert.ok(nodes.has(p.node), `${kit}: node ${p.node}`); }
  }
  assert.deepEqual(ids.sort(), POPULATION_PROPS.map(p => p.id).sort());
});

// Held grips the clip libraries do not carry yet. Empty since the motion fixer's library republish (8 November): every
// role-loop prop has its kitMatrix (the art fixer modelled the kit side in the contract frames). It may only stay empty
// or shrink; a role-loop prop without a kitMatrix fails the test.
const PENDING_GRIPS = new Set<string>([]);

interface ClipEntry { kind: string; props?: { prop: string; bone?: string; part?: string; kitMatrix?: number[] }[]; workplace?: { prop: string }[] }

test('every prop a resident\'s role loop names has a kit node, parts and workplaces included', { skip: !existsSync(join(root, 'props/kits.json')) && 'props not published' }, () => {
  const kits = JSON.parse(readFileSync(join(root, 'props/kits.json'), 'utf8')).kits as Record<string, { props: Record<string, { node: string; parts?: Record<string, { node: string }> }> }>;
  const kitProps = new Map<string, { node: string; parts?: Record<string, { node: string }> }>();
  for (const k of Object.values(kits)) for (const [pid, p] of Object.entries(k.props)) kitProps.set(pid, p);
  const libs = JSON.parse(readFileSync(join(root, 'clips/manifest.json'), 'utf8')).libraries as Record<string, { clips: Record<string, ClipEntry> }>;
  const missingGrips: string[] = [];
  for (const r of EALDHOLT_VILLAGE_POPULATION.residents) {
    const a = r.appearance;
    if (a.kind !== 'crowd') continue;
    for (const p of a.props) assert.ok(kitProps.has(p.id), `${r.id}: own prop ${p.id} has a kit node`);
    for (const clip of a.motion.roleClips) {
      const c = libs[a.archetype].clips[clip];
      assert.ok(c, `${r.id}: ${clip} in the ${a.archetype} library`);
      for (const p of c.props ?? []) {
        const k = kitProps.get(p.prop);
        assert.ok(k, `${clip} (${a.archetype}): prop ${p.prop} has a kit node`);
        if (p.part) assert.ok(k!.parts?.[p.part], `${clip}: part ${p.part} of ${p.prop} has its own kit node`);
        if (p.bone && !p.kitMatrix && !PENDING_GRIPS.has(`${clip}:${p.prop}`)) missingGrips.push(`${a.archetype}/${clip}:${p.prop}`);
      }
      for (const w of c.workplace ?? []) assert.ok(kitProps.has(w.prop), `${clip} (${a.archetype}): workplace ${w.prop} has a kit node`);
    }
  }
  assert.deepEqual([...new Set(missingGrips)], [], 'role-loop props without a grip and not listed as pending');
});

test('crowd-v1 stays under the committed size hard cap', { skip: !published && 'crowd-v1 not published' }, () => {
  let bytes = 0;
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else bytes += statSync(p).size; } };
  walk(root);
  assert.ok(bytes <= CROWD_LEVEL_BUDGET.committed.hardCapMiB * 1048576, `${(bytes / 1048576).toFixed(2)} MiB`);
  assert.ok(EALDHOLT_VILLAGE_POPULATION.residents.length === 100);
});

// motion and runtime fixer, 8 November: the motion publisher's blocks in every resident JSON (crowd_motion_publish.ts)
test('every published resident JSON carries the population\'s motion, its prop presentation and gated envelopes', { skip: !published && 'crowd-v1 not published' }, () => {
  const libs = JSON.parse(readFileSync(join(root, 'clips/manifest.json'), 'utf8')).libraries as Record<string, { clips: Record<string, ClipEntry> }>;
  const kits = JSON.parse(readFileSync(join(root, 'props/kits.json'), 'utf8')).kits as Record<string, { file: string; props: Record<string, { node: string; parts?: Record<string, { node: string }> }> }>;
  const nodes = new Set<string>();
  for (const k of Object.values(kits)) for (const p of Object.values(k.props)) { nodes.add(p.node); for (const part of Object.values(p.parts ?? {})) nodes.add(part.node); }
  for (const f of readdirSync(join(root, 'residents')).filter(x => x.endsWith('.json') && x !== 'index.json')) {
    const m = JSON.parse(readFileSync(join(root, 'residents', f), 'utf8'));
    const r = getPopulationResident(m.residentId)!;
    const a = r.appearance;
    if (a.kind !== 'crowd') continue;
    assert.deepEqual(m.motion.roleClips, a.motion.roleClips, `${m.residentId}: role clips as the population`);
    assert.equal(m.motion.walk, a.motion.walk); assert.equal(m.motion.idle, a.motion.idle); assert.equal(m.motion.talk, a.motion.talk);
    assert.equal(m.envelopeGate?.pass, true, `${m.residentId}: envelopes gated against the sampled skin`);
    const lib = libs[a.archetype].clips;
    for (const c of [a.motion.idle, a.motion.walk, a.motion.talk, ...a.motion.roleClips]) assert.ok(m.envelopes[c], `${m.residentId}: envelope for ${c}`);
    assert.equal(m.presentation?.version, 1, `${m.residentId}: presentation block`);
    for (const [kit, path] of Object.entries(m.presentation.kits as Record<string, string>)) assert.equal(path, `crowd-v1/props/${kits[kit].file}`);
    const all = [...m.presentation.rest, ...Object.values(m.presentation.clips as Record<string, { held: { node: string; bone: string | null }[]; placed: { node: string }[] }>).flatMap(c => [...c.held, ...c.placed])];
    for (const p of all) assert.ok(nodes.has(p.node), `${m.residentId}: ${p.node} is a kit node`);
    // every role clip that holds a prop in the library shows it in the presentation
    for (const c of a.motion.roleClips) if ((lib[c]?.props ?? []).length) assert.ok(m.presentation.clips[c]?.held.length, `${m.residentId}: ${c} shows its held props`);
  }
});
