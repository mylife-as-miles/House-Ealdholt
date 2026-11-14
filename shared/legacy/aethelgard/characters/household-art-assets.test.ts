import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { HOUSEHOLD_ART_LEVELS, HOUSEHOLD_ART_SETS, householdArtFile, householdArtFolder, householdPropsFileFor,
  type HouseholdArtLevel, type HouseholdArtSet } from './household-art-sets';
import { HOUSEHOLD_LOD_BUDGETS } from './household-casting';

// The published resident files agree with the typed lookup: every clip, prop node, mechanism clip, joint count,
// morph tier, budget, face calibration and clip event the lookup names is really in the GLBs and manifests.
// Reads the canonical desktop assets (the Quest copies are checked byte-identical by npm run check:sync).

const ROOT = new URL('../../../../main game/public/assets/legacy/environment/', import.meta.url);
const BUDGET_ID: Readonly<Record<HouseholdArtLevel, string>> = { 'desktop-lod0': 'desktop-lod0', 'desktop-lod1': 'desktop-lod1', quest: 'quest-near' };

interface GltfNode { name?: string; mesh?: number; children?: number[] }
interface Gltf {
  nodes: GltfNode[]; meshes?: { primitives: { indices?: number; attributes: Record<string, number>; targets?: unknown[] }[] }[];
  accessors: { count: number; bufferView?: number }[]; bufferViews: { byteOffset?: number; byteLength: number }[];
  materials?: unknown[]; skins?: { joints: number[] }[]; images?: { bufferView?: number; mimeType?: string }[];
  animations?: { name: string; channels: { target: { node: number; path: string } }[]; samplers: { input: number }[] }[];
}

const cache = new Map<string, { json: Gltf; bin: Buffer }>();
function readGlb(set: HouseholdArtSet, file: string): { json: Gltf; bin: Buffer } {
  const url = new URL(`${householdArtFolder(set)}/${file}`, ROOT);
  const hit = cache.get(url.href); if (hit) return hit;
  const data = fs.readFileSync(url);
  assert.equal(data.readUInt32LE(0), 0x46546c67, `${file} is not a binary glTF`);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLength;
  const bin = data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart));
  const out = { json, bin }; cache.set(url.href, out); return out;
}
function manifest(set: HouseholdArtSet): any {
  return JSON.parse(fs.readFileSync(new URL(`${householdArtFolder(set)}/manifest.json`, ROOT), 'utf8'));
}
const clipNames = (g: Gltf) => new Set((g.animations ?? []).map(a => a.name));
const nodeNames = (g: Gltf) => new Set(g.nodes.map(n => n.name ?? ''));
function triangles(g: Gltf): number {
  let total = 0;
  for (const n of g.nodes) if (n.mesh !== undefined) for (const p of g.meshes![n.mesh].primitives)
    total += (p.indices !== undefined ? g.accessors[p.indices].count : g.accessors[p.attributes.POSITION].count) / 3;
  return total;
}
/** Width and height of an embedded PNG (IHDR) or WebP (VP8X canvas, VP8L or VP8 frame header). */
function imageSize(data: Buffer): [number, number] {
  if (data.readUInt32BE(0) === 0x89504e47) return [data.readUInt32BE(16), data.readUInt32BE(20)];
  assert.equal(data.toString('latin1', 0, 4) + data.toString('latin1', 8, 12), 'RIFFWEBP', 'resident maps are PNG or WebP');
  const chunk = data.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)];
  if (chunk === 'VP8L') { const bits = data.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)]; }
  assert.equal(chunk, 'VP8 ', 'unknown WebP chunk');
  return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
}
function maxTextureSize(g: Gltf, bin: Buffer): number {
  let size = 0;
  for (const image of g.images ?? []) {
    assert.ok(image.bufferView !== undefined, 'resident maps are embedded');
    const view = g.bufferViews[image.bufferView], offset = view.byteOffset ?? 0;
    size = Math.max(size, ...imageSize(bin.subarray(offset, offset + view.byteLength)));
  }
  return size;
}
function lookupClips(set: HouseholdArtSet): string[] {
  const m = set.actorMotions;
  return [m.idle, m.walk, m.talk, m.work, ...(m.sit ? [m.sit] : []), ...Object.values(m.extra)];
}

test('every level of every set carries the lookup clips, 64 joints, its morph tier and fits its budget', () => {
  for (const set of HOUSEHOLD_ART_SETS) for (const level of HOUSEHOLD_ART_LEVELS) {
    const { json, bin } = readGlb(set, householdArtFile(set, level)), label = `${set.set} ${level}`;
    const clips = clipNames(json);
    for (const clip of [...lookupClips(set), 'face_blink', 'face_gaze', 'face_jaw']) assert.ok(clips.has(clip), `${label} lacks clip ${clip}`);
    assert.equal(json.skins?.length, 1, `${label} has one skin`); assert.equal(json.skins![0].joints.length, 64, `${label} joints`);
    const morphs = Math.max(0, ...(json.meshes ?? []).flatMap(mesh => mesh.primitives.map(p => p.targets?.length ?? 0)));
    const budget = HOUSEHOLD_LOD_BUDGETS.find(b => b.id === BUDGET_ID[level])!;
    // round 2: every level carries the 44 face morphs (LOD1 and Quest on the head derived from the LOD0 head)
    assert.equal(morphs, 44, `${label} morph targets`);
    assert.ok(morphs <= budget.maxMorphTargets, `${label} morph targets over budget`);
    assert.ok(triangles(json) <= budget.maxTriangles, `${label} triangles ${triangles(json)} > ${budget.maxTriangles}`);
    assert.ok((json.materials?.length ?? 0) <= budget.maxMaterials, `${label} materials`);
    assert.ok(maxTextureSize(json, bin) <= budget.maxTextureSize, `${label} texture size`);
  }
});

test('body clips never key face joints and face clips key only face joints', () => {
  for (const set of HOUSEHOLD_ART_SETS) for (const level of HOUSEHOLD_ART_LEVELS) {
    const { json } = readGlb(set, householdArtFile(set, level));
    for (const clip of json.animations ?? []) {
      const faceClip = clip.name.startsWith('face_');
      assert.ok(clip.channels.length > 0, `${set.set} ${level} ${clip.name} is empty`);
      for (const ch of clip.channels) {
        const faceJoint = (json.nodes[ch.target.node].name ?? '').startsWith('face_');
        assert.equal(faceJoint, faceClip, `${set.set} ${level} ${clip.name} keys ${json.nodes[ch.target.node].name}`);
      }
    }
  }
});

test('props files hold every attached node and every mechanism clip on both platforms', () => {
  for (const set of HOUSEHOLD_ART_SETS) for (const file of ['props', 'props-quest'] as const) {
    const { json } = readGlb(set, householdArtFile(set, file)), nodes = nodeNames(json), clips = clipNames(json);
    for (const [clip, attachments] of Object.entries(set.propsByClip)) for (const a of attachments)
      assert.ok(nodes.has(a.node), `${set.set} ${file} lacks ${a.node} for ${clip}`);
    for (const [bodyClip, propClip] of Object.entries(set.propClips)) {
      assert.ok(clips.has(propClip), `${set.set} ${file} lacks mechanism clip ${propClip}`);
      const body = readGlb(set, householdArtFile(set, 'desktop-lod0')).json;
      const seconds = (g: Gltf, name: string) => Math.max(...g.animations!.find(a => a.name === name)!.samplers.map(s => {
        const acc = g.accessors[s.input] as { max?: number[] }; return acc.max ? acc.max[0] : 0;
      }));
      assert.ok(Math.abs(seconds(json, propClip) - seconds(body, bodyClip)) < 1e-3, `${set.set} ${propClip} matches ${bodyClip} in length`);
    }
  }
  for (const level of HOUSEHOLD_ART_LEVELS) assert.equal(householdPropsFileFor(level), level === 'quest' ? 'props-quest' : 'props');
});

test('manifests agree with the lookup on motions, props, calibration, events and face cues', () => {
  for (const set of HOUSEHOLD_ART_SETS) {
    const m = manifest(set);
    assert.equal(m.residentId, set.residentId);
    assert.deepEqual(m.actorMotions, set.actorMotions);
    assert.deepEqual(m.propsByClip, set.propsByClip);
    assert.deepEqual(m.propClips, set.propClips);
    assert.deepEqual(m.faceCues, set.faceCues);
    const cal = m.faceRig.lodCalibration;
    for (const key of ['upperLidClosed', 'lowerLidClosed', 'jawOpen'] as const)
      assert.ok(Math.abs(cal[key] - set.faceCalibration[key]) < 5e-4, `${set.set} ${key}: manifest ${cal[key]} vs lookup ${set.faceCalibration[key]}`);
    assert.deepEqual(Object.keys(m.events).sort(), Object.keys(set.events).sort());
    for (const [clip, table] of Object.entries(set.events)) for (const [name, times] of Object.entries(table)) {
      assert.equal(m.events[clip][name].length, times.length, `${set.set} ${clip} ${name}`);
      times.forEach((t, i) => assert.ok(Math.abs(m.events[clip][name][i] - t) < 1e-3, `${set.set} ${clip} ${name}[${i}]`));
      for (const t of times) assert.ok(t >= 0 && t <= m.clips[clip].seconds, `${set.set} ${clip} ${name} inside the clip`);
    }
    for (const clip of lookupClips(set)) assert.ok(m.clips[clip]?.seconds > 0, `${set.set} manifest lacks ${clip}`);
  }
});
