import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import {
  CROWD_LEVEL_BUDGET, EALDHOLT_VILLAGE_POPULATION, POPULATION_ARCHETYPES, crowdClipLibraryFile, getPopulationClip,
  type PopulationArchetype,
} from './village-population';

// The published crowd clip libraries (crowd-v1/clips) agree with the population data: every clip a resident's appearance
// recipe names is in its archetype's library, loop flags match the clip catalogue, the files carry only body-joint
// rotations and the hips translation (never face joints, never a mesh), the manifest's durations are the files' and the
// provenance hashes are the files'. Reads the canonical desktop assets (Quest copies are checked by npm run check:sync).

const ROOT = new URL('../../../../main game/public/assets/legacy/environment/aethelgard/characters/', import.meta.url);
const CLIPS = new URL('crowd-v1/clips/', ROOT);

interface Gltf {
  nodes: { name?: string; mesh?: number }[]; meshes?: unknown[]; skins?: { joints: number[] }[];
  accessors: { count: number; type: string; componentType: number; normalized?: boolean; max?: number[] }[];
  animations?: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
}
function readGlb(file: URL): Gltf {
  const data = fs.readFileSync(file);
  assert.equal(data.readUInt32LE(0), 0x46546c67, `${file.pathname} is not a binary glTF`);
  const len = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + len).toString('utf8')) as Gltf;
}
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', CLIPS), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(new URL('provenance.json', CLIPS), 'utf8'));
const glbs = new Map<PopulationArchetype, Gltf>();
function glb(a: PopulationArchetype): Gltf {
  let g = glbs.get(a);
  if (!g) { g = readGlb(new URL(crowdClipLibraryFile(a), ROOT)); glbs.set(a, g); }
  return g;
}

test('every archetype library is published and holds every clip its residents use', () => {
  for (const lib of EALDHOLT_VILLAGE_POPULATION.clipLibraries) {
    const names = new Set((glb(lib.archetype).animations ?? []).map(x => x.name));
    for (const clip of lib.clips) assert.ok(names.has(clip), `${lib.archetype}: ${clip} missing from ${lib.file}`);
    assert.deepEqual(manifest.libraries[lib.archetype].missingFromPopulation, []);
  }
  for (const r of EALDHOLT_VILLAGE_POPULATION.residents) {
    const m = r.appearance.motion;
    if (!m.library) continue;
    const names = new Set((glb(r.appearance.archetype).animations ?? []).map(x => x.name));
    for (const c of [m.walk, m.idle, m.talk, ...m.roleClips]) assert.ok(names.has(c), `${r.id}: ${c} not in ${m.library}`);
  }
});

test('libraries are clips only: 64 joints, no mesh, body rotations and the hips translation, no face joints', () => {
  for (const a of POPULATION_ARCHETYPES) {
    const g = glb(a);
    assert.equal((g.meshes ?? []).length, 0, `${a}: a clip library carries no mesh`);
    assert.equal(g.skins?.[0]?.joints.length, CROWD_LEVEL_BUDGET.joints, `${a}: 64-joint skeleton`);
    for (const anim of g.animations ?? []) {
      for (const ch of anim.channels) {
        const node = g.nodes[ch.target.node].name ?? '';
        assert.ok(!node.startsWith('face_'), `${a}/${anim.name}: keys face joint ${node}`);
        assert.notEqual(node, 'root', `${a}/${anim.name}: keys the root`);
        assert.ok(ch.target.path === 'rotation' || (ch.target.path === 'translation' && node === 'hips'),
          `${a}/${anim.name}: ${ch.target.path} on ${node}`);
        const out = g.accessors[anim.samplers[ch.sampler].output];
        if (ch.target.path === 'rotation') assert.ok(out.componentType === 5126 || (out.componentType === 5122 && out.normalized),
          `${a}/${anim.name}: rotations are float or normalized int16`);
      }
    }
  }
});

test('manifest durations and loop flags match the files and the clip catalogue', () => {
  for (const a of POPULATION_ARCHETYPES) {
    const g = glb(a); const lib = manifest.libraries[a];
    assert.equal(lib.clipCount, (g.animations ?? []).length);
    for (const anim of g.animations ?? []) {
      const entry = lib.clips[anim.name]; assert.ok(entry, `${a}: ${anim.name} not in the manifest`);
      const dur = Math.max(...anim.samplers.map(s => g.accessors[s.input].max?.[0] ?? 0));
      assert.ok(Math.abs(dur - entry.seconds) < 1 / 30 + 1e-4, `${a}/${anim.name}: ${dur} s in the file, ${entry.seconds} s in the manifest`);
      const spec = getPopulationClip(anim.name);
      if (spec) assert.equal(entry.loop, spec.loop, `${a}/${anim.name}: loop flag differs from POPULATION_CLIPS`);
      if (anim.name.endsWith('_enter') || anim.name.endsWith('_exit') || anim.name.endsWith('_start') || anim.name.endsWith('_stop'))
        assert.equal(entry.loop, false, `${a}/${anim.name}: transitions play once`);
    }
  }
});

test('measured quality: planted feet never below the ground, hands reach their props, loops close', () => {
  for (const a of POPULATION_ARCHETYPES) {
    for (const [name, c] of Object.entries<any>(manifest.libraries[a].clips)) {
      assert.ok(c.quality.minSoleCm >= -0.5, `${a}/${name}: sole ${c.quality.minSoleCm} cm below the ground`);
      // the last frame repeats the first; the measure sees float32 quaternion noise (at most about 0.05 degrees)
      if (c.loop) assert.ok((c.quality.seamDegrees ?? 0) < 0.1, `${a}/${name}: loop seam ${c.quality.seamDegrees} deg`);
      if (c.handErrorCm) for (const e of Object.values<number>(c.handErrorCm)) assert.ok(e < 6, `${a}/${name}: hand ${e} cm from its goal`);
    }
  }
});

test('provenance hashes the published files and attributes 100STYLE', () => {
  for (const f of provenance.files) {
    const data = fs.readFileSync(new URL(f.path, CLIPS));
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), f.sha256, `${f.path}: SHA-256`);
    assert.equal(data.length, f.bytes);
  }
  assert.equal(provenance.sources.style100.licence.spdx, 'CC-BY-4.0');
  assert.match(provenance.sources.style100.attribution, /Ian Mason, Sebastian Starke and Taku Komura/);
  assert.ok(provenance.sources.style100.files.every((f: { sha256: string }) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const total = provenance.files.reduce((s: number, f: { bytes: number }) => s + f.bytes, 0);
  assert.ok(total < 12 * 1048576, `clip libraries ${total} bytes (budget 12 MiB within the crowd's 45 MiB target)`);
});
