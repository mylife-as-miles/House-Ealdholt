// Motion and presentation publisher for the crowd residents (original Crownfall code; motion and runtime fixer,
// 8 November 2026). Run after scripts/characters/publish_clip_libraries.py and scripts/characters/crowd_publish.py:
//
//   main-game-vr/node_modules/.bin/tsx scripts/characters/crowd_motion_publish.ts [--check] [--only id,id]
//
// For every published crowd resident (crowd-v1/residents/<id>.json) it writes, from the population, the clip library
// manifest, the prop kits and the art registry:
// - `motion`: the population's idle, walk, talk, rate and role clips (role-loop variants included), so the JSON the
//   adapters parse never lags the population;
// - `presentation.clips`: per clip the resident may play, the props it shows: `held` (kit node under a bone with the
//   clip's kitMatrix; part nodes for two-handed props; a carry good in place of the prop it replaces), `placed` (workplace
//   props, the resident's goods on their workplace, the stool under seated clips: a root-frame matrix) and `hidesRest`
//   (worn props hidden while the clip plays: the ones it holds itself and its hidesRestProps);
// - `presentation.rest`: worn props at rest (registry `rest` attachments) and `presentation.kits` (kit files to load);
// - `envelopes`: per clip a conservative animated box in the resident's model frame (the adapter's crowdClipEnvelope,
//   computed here once instead of at set-up), each checked against the skinned mesh sampled at 60 frames a second
//   (`envelopeGate`); the adapters pass them to the actor owner, trusted only when the gate passed (patch 8).
// --check exits non-zero when a published JSON differs from what this script would write (no write).
// The resident GLBs, provenance hashes and recipes are not touched. Node + three (main game's copy), textures stripped.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// three resolves from main game's dependencies (scripts/ has none of its own): the same module the adapter imports
import { AnimationMixer, Box3, LoopRepeat, Skeleton, SkinnedMesh, type AnimationClip, type Bone, type Object3D } from '../../main game/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { bindCrowdTemplate, crowdClipEnvelope, prepareCrowdLibrary, type CrowdGltf } from '../../main game/src/legacy/aethelgard/characters/crowd-residents.ts';
import { EALDHOLT_VILLAGE_POPULATION as POP, getPopulationClip, getPopulationProp } from '../../shared/legacy/aethelgard/characters/village-population.ts';
import { getPopulationArt } from '../../shared/legacy/aethelgard/characters/village-population-art.ts';
import { CROWD_PRESENTATION_VERSION, crowdPresentationClipNames, type CrowdPresentationJson, type CrowdPropPlacement } from '../../shared/legacy/aethelgard/characters/crowd-presentation.ts';

const ROOT = join(import.meta.dirname, '../../main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1');
const args = process.argv.slice(2);
const check = args.includes('--check');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? new Set(args[onlyAt + 1].split(',')) : null;
/** Dense skinned sampling for the envelope gate (frames a second). */
const GATE_FPS = 60;

interface ClipProp { prop: string; bone?: string; part?: string; kitMatrix?: number[] }
interface ClipWorkplace { prop: string; positionGltf: number[]; yawDeg?: number }
interface ClipEntry { kind: string; loop: boolean; props?: ClipProp[]; workplace?: ClipWorkplace[]; hidesRestProps?: string[] }
interface Library { file: string; clips: Record<string, ClipEntry>; seat: { centreBlender: number[]; heightMetres: number } | null }
const manifest = JSON.parse(readFileSync(join(ROOT, 'clips/manifest.json'), 'utf8')) as { libraries: Record<string, Library> };
const kits = JSON.parse(readFileSync(join(ROOT, 'props/kits.json'), 'utf8')).kits as Record<string, { file: string; props: Record<string, { node: string; sizeMetres: number[]; parts?: Record<string, { node: string }> }> }>;

function strippedGlb(path: string): ArrayBuffer {
  const b = readFileSync(path), n = b.readUInt32LE(12), g = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
  delete g.images; delete g.textures; delete g.samplers; delete g.extensionsUsed; delete g.extensionsRequired;
  for (const m of g.materials ?? []) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  let json = Buffer.from(JSON.stringify(g)); json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = b.subarray(20 + n), out = Buffer.alloc(20 + json.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(json.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20); bin.copy(out, 20 + json.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
function placedMatrix(position: readonly number[], yawDeg: number, scale: readonly [number, number, number] = [1, 1, 1]): number[] {
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // column-major T * Ry * S (glTF root frame: +Y up)
  return [c * scale[0], 0, -s * scale[0], 0, 0, scale[1], 0, 0, s * scale[2], 0, c * scale[2], 0, position[0], position[1], position[2], 1].map(r4);
}
/** Lowest point of a kit node in its own frame (the node's transform reset), from the kit GLB: workplace props placed with
 * a root-frame matrix are lifted by it, so a prop whose origin is its handle grip (milk pail, herb basket) stands on the
 * ground instead of below it (art fixer, round 2: both were published entirely under ground, the hide beam 9 cm in). */
const nodeMinY = new Map<string, number>();
async function kitNodeMinY(kit: string, node: string): Promise<number> {
  const key = `${kit}/${node}`;
  if (nodeMinY.has(key)) return nodeMinY.get(key)!;
  let scene = kitScenes.get(kit);
  if (!scene) { scene = (await new GLTFLoader().parseAsync(strippedGlb(join(ROOT, 'props', kits[kit].file)), '')).scene as Object3D; kitScenes.set(kit, scene); }
  const src = scene.getObjectByName(node);
  let y = 0;
  if (src) {
    const c = src.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1); c.updateMatrixWorld(true);
    const box = new Box3().setFromObject(c);
    if (!box.isEmpty()) y = box.min.y;
  }
  nodeMinY.set(key, y);
  return y;
}
const kitScenes = new Map<string, Object3D>();
/** Root-frame matrix of a workplace prop resting on the ground (lifted when its frame reaches below the origin). */
async function groundedMatrix(n: { kit: string; node: string }, position: readonly number[], yawDeg: number, scale: readonly [number, number, number] = [1, 1, 1]): Promise<number[]> {
  const minY = (await kitNodeMinY(n.kit, n.node)) * scale[1];
  const lift = minY < -0.002 ? -minY : 0;
  return placedMatrix([position[0], position[1] + lift, position[2]], yawDeg, scale);
}
function kitNode(pid: string, part?: string): { kit: string; node: string } | null {
  const spec = getPopulationProp(pid); if (!spec) return null;
  const p = kits[spec.kit]?.props[pid]; if (!p) return null;
  if (part) { const n = p.parts?.[part]?.node; return n ? { kit: spec.kit, node: n } : null; }
  return { kit: spec.kit, node: p.node };
}

/** Skinned bounds of a clip on the resident, sampled densely (model frame). */
function sampledBounds(scene: Object3D, clip: AnimationClip): Box3 {
  const rig = scene.clone(true), mixer = new AnimationMixer(rig), action = mixer.clipAction(clip), out = new Box3(), box = new Box3();
  const meshes: SkinnedMesh[] = []; rig.traverse(n => { if (n instanceof SkinnedMesh) meshes.push(n); });
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones.map(b => rig.getObjectByName(b.name) as Bone);
    mesh.bind(new Skeleton(bones, mesh.skeleton.boneInverses.map(m => m.clone())), mesh.bindMatrix.clone());
  }
  action.setLoop(LoopRepeat, Infinity).play();
  const steps = Math.max(1, Math.ceil(clip.duration * GATE_FPS));
  for (let i = 0; i <= steps; i++) {
    action.time = Math.min(clip.duration, clip.duration * i / steps); mixer.update(0); rig.updateMatrixWorld(true);
    for (const mesh of meshes) { mesh.skeleton.update(); mesh.computeBoundingBox(); box.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld); out.union(box); }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig);
  return out;
}

const loader = new GLTFLoader();
const libraries = new Map<string, ReturnType<typeof prepareCrowdLibrary>>();
let changed = 0, checked = 0, worstMargin = Infinity;
const problems: string[] = [];
for (const file of readdirSync(join(ROOT, 'residents')).filter(f => f.endsWith('.json') && f !== 'index.json').sort()) {
  const id = file.slice(0, -5);
  if (only && !only.has(id)) continue;
  const r = POP.residents.find(x => x.id === id);
  if (!r || r.appearance.kind !== 'crowd') { problems.push(`${id}: not a crowd resident of the population`); continue; }
  const a = r.appearance, art = getPopulationArt(id);
  if (!art) { problems.push(`${id}: no registry entry`); continue; }
  const path = join(ROOT, 'residents', file), before = readFileSync(path, 'utf8'), json = JSON.parse(before);
  const lib = manifest.libraries[a.archetype];
  json.motion = { library: a.motion.library, walk: a.motion.walk, idle: a.motion.idle, talk: a.motion.talk, rate: a.motion.rate, roleClips: [...a.motion.roleClips] };

  // ---- presentation: props per clip
  const names = crowdPresentationClipNames(json.motion, new Set(Object.keys(lib.clips)), n => getPopulationClip(n));
  const usedKits = new Set<string>();
  const rest = art.props.filter(p => p.rest).map(p => { usedKits.add(p.kit); return { prop: p.id, kit: p.kit, node: p.node, bone: p.rest!.bone, matrix: [...p.rest!.matrix] }; });
  const restIds = new Set(rest.map(p => p.prop));
  const clips: CrowdPresentationJson['clips'] = {};
  for (const name of names) {
    const c = lib.clips[name]; if (!c) continue;
    const held: CrowdPropPlacement[] = [], placed: CrowdPropPlacement[] = [];
    const listed = new Set((c.props ?? []).map(p => p.prop));
    for (const p of c.props ?? []) {
      if (!p.bone || !p.kitMatrix) { problems.push(`${id}: ${name} holds ${p.prop} without a grip`); continue; }
      // a carry good of this resident drawn in place of the clip's prop (the fletcher's shafts instead of the bundle)
      const sub = a.props.map(q => getPopulationProp(q.id)).find(s => s?.replaces === p.prop);
      const n = sub ? kitNode(sub.id) : kitNode(p.prop, p.part);
      if (!n) { problems.push(`${id}: ${name} prop ${p.prop}${p.part ? ':' + p.part : ''} has no kit node`); continue; }
      usedKits.add(n.kit);
      held.push({ prop: sub ? sub.id : p.prop, kit: n.kit, node: n.node, bone: p.bone, matrix: p.kitMatrix.map(r4) });
    }
    for (const w of c.workplace ?? []) {
      if (!w.positionGltf) continue;  // the seat entry of `sit` (centreBlender): the stool is placed below for every seated clip
      const n = kitNode(w.prop);
      if (!n) { problems.push(`${id}: ${name} workplace ${w.prop} has no kit node`); continue; }
      usedKits.add(n.kit);
      placed.push({ prop: w.prop, kit: n.kit, node: n.node, bone: null, matrix: await groundedMatrix(n, w.positionGltf, w.yawDeg ?? 0) });
      // the resident's own goods on that workplace (the egg seller's eggs on the trestle)
      for (const own of a.props) {
        const spec = getPopulationProp(own.id);
        if (spec?.placedWith !== w.prop) continue;
        const g = kitNode(own.id); if (!g) continue;
        usedKits.add(g.kit);
        placed.push({ prop: own.id, kit: g.kit, node: g.node, bone: null, matrix: await groundedMatrix(g, w.positionGltf, w.yawDeg ?? 0) });
      }
    }
    if ((c.kind === 'seated' || name === 'sit' || name === 'sit_down' || name === 'stand_up') && lib.seat) {
      const stool = kitNode('stool')!, size = kits[getPopulationProp('stool')!.kit].props.stool.sizeMetres;
      usedKits.add(stool.kit);
      placed.push({ prop: 'stool', kit: stool.kit, node: stool.node, bone: null,
        matrix: placedMatrix([0, 0, -lib.seat.centreBlender[1]], 0, [1, lib.seat.heightMetres / size[2], 1]) });
    }
    const hidesRest = [...new Set([...(c.hidesRestProps ?? []), ...[...listed].filter(p => restIds.has(p))])].filter(p => restIds.has(p)).sort();
    if (held.length || placed.length || hidesRest.length) clips[name] = { held, placed, hidesRest };
  }
  const kitFiles: Record<string, string> = {};
  for (const k of [...usedKits].sort()) kitFiles[k] = `crowd-v1/props/${kits[k].file}`;

  // ---- envelopes, computed once here and gated against dense skinned sampling
  let library = libraries.get(lib.file);
  if (!library) { library = prepareCrowdLibrary(await loader.parseAsync(strippedGlb(join(ROOT, 'clips', lib.file)), '') as unknown as CrowdGltf); libraries.set(lib.file, library); }
  const gltf = await loader.parseAsync(strippedGlb(join(ROOT, 'residents', `${id}.glb`)), '') as unknown as CrowdGltf;
  const bound = bindCrowdTemplate(gltf, library);
  const envelopes: Record<string, { min: number[]; max: number[] }> = {};
  let minMargin = Infinity, pass = true;
  for (const name of names) {
    if (!library.names.has(name)) continue;
    const e = crowdClipEnvelope(bound, name), s = sampledBounds(gltf.scene, library.clip(name));
    const min = e.min.map(v => Math.floor(v * 1000) / 1000), max = e.max.map(v => Math.ceil(v * 1000) / 1000);
    envelopes[name] = { min, max };
    for (let k = 0; k < 3; k++) minMargin = Math.min(minMargin, s.min.getComponent(k) - min[k], max[k] - s.max.getComponent(k));
  }
  if (!(minMargin >= 0)) { pass = false; problems.push(`${id}: an envelope misses the sampled skin by ${(-minMargin * 100).toFixed(1)} cm`); }
  worstMargin = Math.min(worstMargin, minMargin);
  json.envelopes = envelopes;
  json.envelopeGate = { pass, method: 'crowdClipEnvelope (joint ranges x per-joint vertex boxes) contains the skinned mesh sampled at 60 frames a second',
    sampledFps: GATE_FPS, clips: Object.keys(envelopes).length, minMarginMetres: r4(minMargin) };
  json.presentation = { version: CROWD_PRESENTATION_VERSION, kits: kitFiles, rest, clips } satisfies CrowdPresentationJson;
  json.motionPublished = { by: 'scripts/characters/crowd_motion_publish.ts', clipLibraries: 'crowd-v1/clips/manifest.json' };
  const sorted = JSON.stringify(sortKeys(json), null, 1);
  checked++;
  if (sorted !== before.trimEnd() && sorted !== before) {
    changed++;
    if (!check) writeFileSync(path, sorted);
  }
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
console.log(JSON.stringify({ residents: checked, changed, worstEnvelopeMarginMetres: r4(worstMargin), problems }, null, 1));
if (problems.length || (check && changed)) process.exit(1);
