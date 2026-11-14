// Population art registry generator (original Crownfall code). Reads the published resident files and writes
// shared/legacy/aethelgard/characters/village-population-art-data.ts, the generated data behind
// village-population-art.ts: for every one of the 100 residents its published level files (path, bytes, SHA-256 and
// measured budgets), placement scale, clip library (or the household set's own clips), actor motions, props with their
// kit file and node, face tier and calibration. Deterministic: the same published files give the same output.
//
//   main-game-vr/node_modules/.bin/tsx scripts/characters/population_art_registry.ts [--check]
//
// --check exits non-zero when the committed data file differs from what the published files give (no write).
// Run after scripts/characters/crowd_publish.py. Working placeholder: role labels only.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  EALDHOLT_VILLAGE_POPULATION as POP, getPopulationProp, crowdClipLibraryFile, crowdResidentFile,
} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import { HOUSEHOLD_ART_LEVELS, HOUSEHOLD_ART_SETS, householdArtFile, householdArtFolder } from '../../shared/legacy/aethelgard/characters/household-art-sets.ts';

const REPO = join(import.meta.dirname, '../..');
const ENV = join(REPO, 'main game/public/assets/legacy/environment');
const CHAR = 'aethelgard/characters';
const OUT = join(REPO, 'shared/legacy/aethelgard/characters/village-population-art-data.ts');
const check = process.argv.includes('--check');

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const json = (rel: string) => JSON.parse(readFileSync(join(ENV, rel), 'utf8'));
function glbJson(rel: string): { animations?: { name: string }[]; nodes?: { name?: string }[] } {
  const b = readFileSync(join(ENV, rel));
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${rel} is not a GLB`);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
const fileFacts = (rel: string) => ({ path: rel, bytes: readFileSync(join(ENV, rel)).length, sha256: sha(join(ENV, rel)) });

const clipsManifest = json(`${CHAR}/crowd-v1/clips/manifest.json`) as { libraries: Record<string, { file: string; sha256: string; bytes: number; clipCount: number }> };
const kits = json(`${CHAR}/crowd-v1/props/kits.json`).kits as Record<string, { file: string; props: Record<string, { node: string }> }>;
const libClips = new Map<string, Set<string>>();
for (const [arch, lib] of Object.entries(clipsManifest.libraries)) {
  const rel = `${CHAR}/crowd-v1/clips/${lib.file}`;
  const facts = fileFacts(rel);
  if (facts.sha256 !== lib.sha256) throw new Error(`${lib.file}: sha256 differs from clips/manifest.json`);
  libClips.set(arch, new Set((glbJson(rel).animations ?? []).map(a => a.name)));
}

// ------------------------------------------------------------------ worn props at rest
// Props worn at the belt (socket `hips`) or on the back (socket `back`) have no clip that places them while a resident
// idles, talks or walks; their rest attachment is measured here from the resident's own mesh (belt and back surfaces
// in the bind pose, garments included) against the shared archetype skeleton, and given bone-local like a clip grip.
// Shown whenever no playing clip lists the same prop (the clip's grip wins). Hand and shoulder props appear only in
// the clips that hold them; workplace props are scene props.
type M4 = number[];
const ident = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; }
  return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], sc = [1, 1, 1]): M4 {
  const [x, y, z, w] = q;
  return [(1 - 2 * (y * y + z * z)) * sc[0], 2 * (x * y + z * w) * sc[0], 2 * (x * z - y * w) * sc[0], 0,
    2 * (x * y - z * w) * sc[1], (1 - 2 * (x * x + z * z)) * sc[1], 2 * (y * z + x * w) * sc[1], 0,
    2 * (x * z + y * w) * sc[2], 2 * (y * z - x * w) * sc[2], (1 - 2 * (x * x + y * y)) * sc[2], 0, t[0], t[1], t[2], 1];
}
function invert(m: M4): M4 {  // general 4x4 inverse (cofactors)
  const inv = new Array(16); const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15] = m;
  inv[0] = a5 * a10 * a15 - a5 * a11 * a14 - a9 * a6 * a15 + a9 * a7 * a14 + a13 * a6 * a11 - a13 * a7 * a10;
  inv[4] = -a4 * a10 * a15 + a4 * a11 * a14 + a8 * a6 * a15 - a8 * a7 * a14 - a12 * a6 * a11 + a12 * a7 * a10;
  inv[8] = a4 * a9 * a15 - a4 * a11 * a13 - a8 * a5 * a15 + a8 * a7 * a13 + a12 * a5 * a11 - a12 * a7 * a9;
  inv[12] = -a4 * a9 * a14 + a4 * a10 * a13 + a8 * a5 * a14 - a8 * a6 * a13 - a12 * a5 * a10 + a12 * a6 * a9;
  inv[1] = -a1 * a10 * a15 + a1 * a11 * a14 + a9 * a2 * a15 - a9 * a3 * a14 - a13 * a2 * a11 + a13 * a3 * a10;
  inv[5] = a0 * a10 * a15 - a0 * a11 * a14 - a8 * a2 * a15 + a8 * a3 * a14 + a12 * a2 * a11 - a12 * a3 * a10;
  inv[9] = -a0 * a9 * a15 + a0 * a11 * a13 + a8 * a1 * a15 - a8 * a3 * a13 - a12 * a1 * a11 + a12 * a3 * a9;
  inv[13] = a0 * a9 * a14 - a0 * a10 * a13 - a8 * a1 * a14 + a8 * a2 * a13 + a12 * a1 * a10 - a12 * a2 * a9;
  inv[2] = a1 * a6 * a15 - a1 * a7 * a14 - a5 * a2 * a15 + a5 * a3 * a14 + a13 * a2 * a7 - a13 * a3 * a6;
  inv[6] = -a0 * a6 * a15 + a0 * a7 * a14 + a4 * a2 * a15 - a4 * a3 * a14 - a12 * a2 * a7 + a12 * a3 * a6;
  inv[10] = a0 * a5 * a15 - a0 * a7 * a13 - a4 * a1 * a15 + a4 * a3 * a13 + a12 * a1 * a7 - a12 * a3 * a5;
  inv[14] = -a0 * a5 * a14 + a0 * a6 * a13 + a4 * a1 * a14 - a4 * a2 * a13 - a12 * a1 * a6 + a12 * a2 * a5;
  inv[3] = -a1 * a6 * a11 + a1 * a7 * a10 + a5 * a2 * a11 - a5 * a3 * a10 - a9 * a2 * a7 + a9 * a3 * a6;
  inv[7] = a0 * a6 * a11 - a0 * a7 * a10 - a4 * a2 * a11 + a4 * a3 * a10 + a8 * a2 * a7 - a8 * a3 * a6;
  inv[11] = -a0 * a5 * a11 + a0 * a7 * a9 + a4 * a1 * a11 - a4 * a3 * a9 - a8 * a1 * a7 + a8 * a3 * a5;
  inv[15] = a0 * a5 * a10 - a0 * a6 * a9 - a4 * a1 * a10 + a4 * a2 * a9 + a8 * a1 * a6 - a8 * a2 * a5;
  const det = a0 * inv[0] + a1 * inv[4] + a2 * inv[8] + a3 * inv[12];
  return inv.map(v => v / det);
}
const rotX = (r: number): M4 => [1, 0, 0, 0, 0, Math.cos(r), Math.sin(r), 0, 0, -Math.sin(r), Math.cos(r), 0, 0, 0, 0, 1];
const rotY = (r: number): M4 => [Math.cos(r), 0, -Math.sin(r), 0, 0, 1, 0, 0, Math.sin(r), 0, Math.cos(r), 0, 0, 0, 0, 1];
const rotZ = (r: number): M4 => [Math.cos(r), Math.sin(r), 0, 0, -Math.sin(r), Math.cos(r), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (p: number[]): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
const D = Math.PI / 180;
const REF_STATURE: Record<string, number> = { 'adult-male': 1.735, 'adult-female': 1.597, adolescent: 1.507, child: 1.195, 'elder-male': 1.682, 'elder-female': 1.516 };

interface RestBody { world: Map<string, M4>; positions: number[][] }
function restBody(rel: string): RestBody {
  const b = readFileSync(join(ENV, rel)); const jl = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const binStart = 20 + jl + 8;
  const world = new Map<string, M4>(); const nodeWorld: M4[] = [];
  const visit = (i: number, parent: M4) => {
    const n = g.nodes[i]; const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale));
    nodeWorld[i] = m; if (n.name) world.set(n.name, m);
    for (const c of n.children ?? []) visit(c, m);
  };
  for (const r of g.scenes[g.scene ?? 0].nodes) visit(r, ident());
  const meshNode = g.nodes.findIndex((n: { mesh?: number }) => n.mesh !== undefined);
  const acc = g.accessors[g.meshes[g.nodes[meshNode].mesh].primitives[0].attributes.POSITION];
  const bv = g.bufferViews[acc.bufferView]; const stride = bv.byteStride ?? 12;
  const base = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0); const mw = nodeWorld[meshNode];
  // arm vertices (skin weight on the arm and hand joints) are left out: the arms hang beside the hips in the rest pose
  const prim = g.meshes[g.nodes[meshNode].mesh].primitives[0]; const jointNames: string[] = g.skins[0].joints.map((j: number) => g.nodes[j].name);
  const reader = (index: number) => {
    const a = g.accessors[index]; const v = g.bufferViews[a.bufferView]; const size = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType as 5121] ?? 4;
    const st = v.byteStride ?? size * 4; const o0 = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return (i: number, c: number) => {
      const o = o0 + i * st + c * size;
      const raw = a.componentType === 5126 ? b.readFloatLE(o) : a.componentType === 5123 ? b.readUInt16LE(o) : b.readUInt8(o);
      return a.normalized ? raw / (a.componentType === 5123 ? 65535 : 255) : raw;
    };
  };
  const J = reader(prim.attributes.JOINTS_0), W = reader(prim.attributes.WEIGHTS_0);
  const arm = new Set(jointNames.map((n, i) => /^(upperarm|forearm|hand|thumb|index|middle|ring|pinky)_/.test(n) ? i : -1).filter(i => i >= 0));
  const positions: number[][] = [];
  for (let i = 0; i < acc.count; i++) {
    let armWeight = 0; for (let c = 0; c < 4; c++) if (arm.has(J(i, c))) armWeight += W(i, c);
    if (armWeight >= 0.5) continue;
    const o = base + i * stride; const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8);
    positions.push([mw[0] * x + mw[4] * y + mw[8] * z + mw[12], mw[1] * x + mw[5] * y + mw[9] * z + mw[13], mw[2] * x + mw[6] * y + mw[10] * z + mw[14]]);
  }
  return { world, positions };
}
/** Bind-pose slice of the figure without its arms at height y (+-band): extent in x and z. */
function slice(body: RestBody, y: number, band: number) {
  const pts = body.positions.filter(p => Math.abs(p[1] - y) < band);
  return { minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])), minZ: Math.min(...pts.map(p => p[2])), maxZ: Math.max(...pts.map(p => p[2])) };
}
const r6 = (m: M4) => m.map(v => Math.round(v * 1e6) / 1e6);
function restAttachment(pid: string, socket: string, arch: string, body: RestBody, sowGrip: number[] | null): { bone: string; matrix: number[] } | null {
  if (socket !== 'hips' && socket !== 'back') return null;
  const k = REF_STATURE[arch] / 1.735;
  const hips = body.world.get('hips')!, spine = body.world.get('spine_03')!;
  if (socket === 'hips') {
    if (pid === 'seed-bag' && sowGrip) return { bone: 'hips', matrix: sowGrip };  // the sowing loop's own hang, reused at rest
    const beltY = hips[13] + 0.07 * k; const sl = slice(body, beltY, 0.025); const zc = (sl.minZ + sl.maxZ) / 2;
    // glTF: +x is the resident's left, +z forward
    const place: Record<string, { side: 1 | -1; z: number; y?: number; rot: M4 }> = {
      keys: { side: 1, z: 0.04, y: -0.01, rot: rotY(90 * D) },
      'wax-tablet': { side: 1, z: 0.05, rot: rotY(90 * D) },
      'sheathed-sword': { side: 1, z: -0.03, rot: mul(rotX(0.45), rotY(90 * D)) },
      quiver: { side: -1, z: -0.05, rot: rotX(0.35) },
      satchel: { side: -1, z: 0.02, rot: rotY(-90 * D) },
      sickle: { side: -1, z: 0.06, rot: mul(rotY(-90 * D), rotZ(180 * D)) },
      'seed-bag': { side: 1, z: 0.06, rot: rotY(90 * D) },
    };
    const pl = place[pid]; if (!pl) return null;
    const x = pl.side > 0 ? sl.maxX + 0.012 : sl.minX - 0.012;
    const world = mul(translate([x, beltY + (pl.y ?? 0), zc + pl.z * k]), pl.rot);
    return { bone: 'hips', matrix: r6(mul(invert(hips), world)) };
  }
  const chestY = spine[13] - 0.05 * k; const sl = slice(body, chestY, 0.06);
  const place: Record<string, { y: number; back: number; rot: M4 }> = {
    'round-shield': { y: 0, back: 0.03, rot: mul(rotY(180 * D), rotZ(0.12)) },
    // resting on the back (it floated 5 to 10 cm off the thatcher's back at 0.06; art fixer, 8 November)
    'osier-bundle': { y: -0.08, back: 0.04, rot: rotZ(0.55) },
  };
  const pl = place[pid]; if (!pl) return null;
  const world = mul(translate([0, chestY + pl.y * k, sl.minZ - pl.back]), pl.rot);
  return { bone: 'spine_03', matrix: r6(mul(invert(spine), world)) };
}
const libManifest = json(`${CHAR}/crowd-v1/clips/manifest.json`) as { libraries: Record<string, { clips: Record<string, { props?: { prop: string; bone: string; kitMatrix?: number[] }[] }> }> };
const sowGripOf = (arch: string) => libManifest.libraries[arch]?.clips.work_sow?.props?.find(p => p.prop === 'seed-bag' && p.bone === 'hips')?.kitMatrix ?? null;

const problems: string[] = [];
const entries: unknown[] = [];
let crowdBytes = 0, crowdTriangles = 0;
for (const r of POP.residents) {
  const a = r.appearance;
  const base = { residentId: r.id, kind: a.kind, archetype: a.archetype, group: r.group, fidelityTier: r.fidelityTier, householdId: r.householdId };
  if (a.kind === 'existing-set') {
    const set = HOUSEHOLD_ART_SETS.find(s => s.residentId === r.id);
    if (!set) { problems.push(`${r.id}: no household art set`); continue; }
    const folder = householdArtFolder(set); const man = json(`${folder}/manifest.json`);
    const levels = HOUSEHOLD_ART_LEVELS.map(level => {
      const rel = `${folder}/${householdArtFile(set, level)}`; const m = man.levels[level];
      return { level, platforms: level === 'quest' ? ['quest'] : ['desktop'], ...fileFacts(rel), triangles: m.triangles, headTriangles: null,
        materials: m.materialCount, joints: m.joints, morphTargets: m.maxMorphTargets, clipsInFile: true };
    });
    const work = set.actorMotions.work;
    entries.push({ ...base, set: set.set, manifest: `${folder}/manifest.json`, levels, placementScale: 1, statureMetres: set.heightMetres,
      clipLibrary: null, motions: { idle: set.actorMotions.idle, walk: set.actorMotions.walk, talk: set.actorMotions.talk, rate: 1, roleClips: [work] },
      props: [], propsFiles: { desktop: `${folder}/${householdArtFile(set, 'props')}`, quest: `${folder}/${householdArtFile(set, 'props-quest')}` },
      face: { tier: 'morph-and-joints', upperLidClosed: set.faceCalibration.upperLidClosed, lowerLidClosed: set.faceCalibration.lowerLidClosed, jawOpen: set.faceCalibration.jawOpen },
      envelopeMarginMetres: null, jointResidualCm: null });
    continue;
  }
  const rel = `${CHAR}/${crowdResidentFile(r)}`; const mrel = rel.replace(/\.glb$/, '.json');
  if (!existsSync(join(ENV, rel)) || !existsSync(join(ENV, mrel))) { problems.push(`${r.id}: not published (${rel})`); continue; }
  const m = json(mrel); const facts = fileFacts(rel);
  if (m.published?.sha256 !== facts.sha256) problems.push(`${r.id}: resident JSON sha256 differs from the GLB`);
  const lib = a.motion.library!; const arch = a.archetype; const names = libClips.get(arch)!;
  const libRel = `${CHAR}/${crowdClipLibraryFile(arch)}`;
  if (`${lib}.glb` !== clipsManifest.libraries[arch].file) problems.push(`${r.id}: library ${lib} is not the ${arch} library`);
  for (const c of [a.motion.idle, a.motion.walk, a.motion.talk, ...a.motion.roleClips]) if (!names.has(c)) problems.push(`${r.id}: clip ${c} missing from ${lib}`);
  const needsRest = a.props.some(p => p.socket === 'hips' || p.socket === 'back');
  const body = needsRest ? restBody(rel) : null;
  const props = a.props.map(p => {
    const spec = getPopulationProp(p.id)!; const k = kits[spec.kit]; const node = k?.props[p.id]?.node;
    if (!node) problems.push(`${r.id}: prop ${p.id} missing from kit ${spec.kit}`);
    const rest = body ? restAttachment(p.id, p.socket, a.archetype, body, sowGripOf(a.archetype)) : null;
    if ((p.socket === 'hips' || p.socket === 'back') && !rest) problems.push(`${r.id}: worn prop ${p.id} has no rest attachment`);
    const kp = k?.props[p.id] as { parts?: Record<string, { node: string }> } | undefined;
    const parts = spec.parts ? Object.fromEntries(spec.parts.map(part => [part, kp?.parts?.[part]?.node ?? ''])) : null;
    if (parts && Object.values(parts).some(n => !n)) problems.push(`${r.id}: prop ${p.id} parts missing from kit ${spec.kit}`);
    return { id: p.id, socket: p.socket, kit: spec.kit, file: `${CHAR}/crowd-v1/props/${k.file}`, node: node ?? '', rest,
      parts, placedWith: spec.placedWith ?? null, replaces: spec.replaces ?? null };
  });
  const img = m.measured.images[0];
  crowdBytes += facts.bytes; crowdTriangles += m.measured.triangles;
  entries.push({ ...base, set: 'crowd-v1', manifest: mrel,
    levels: [{ level: 'crowd', platforms: ['desktop', 'quest'], ...facts, triangles: m.measured.triangles, headTriangles: m.measured.headTriangles,
      materials: m.measured.materials, joints: m.measured.joints, morphTargets: m.measured.morphTargets, clipsInFile: false,
      atlas: { width: img.width, height: img.height, bytes: img.bytes, mime: img.mime } }],
    placementScale: m.placementScale, statureMetres: Math.round(m.statureCm) / 100,
    clipLibrary: { path: libRel, bytes: clipsManifest.libraries[arch].bytes, sha256: clipsManifest.libraries[arch].sha256 },
    motions: { idle: a.motion.idle, walk: a.motion.walk, talk: a.motion.talk, rate: a.motion.rate, roleClips: [...a.motion.roleClips] },
    props, propsFiles: null,
    face: { tier: 'joints-only', upperLidClosed: m.faceCalibration.upperLidClosed, lowerLidClosed: m.faceCalibration.lowerLidClosed, jawOpen: m.faceCalibration.jawOpen },
    envelopeMarginMetres: m.envelopeMarginMetres, jointResidualCm: m.jointResidualCm.coreMaxCm });
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

// committed size of the crowd folder (residents, clip libraries, prop kits, manifests)
function walk(dir: string): number {
  let n = 0;
  for (const f of readdirSync(dir)) { const p = join(dir, f); const st = statSync(p); n += st.isDirectory() ? walk(p) : st.size; }
  return n;
}
const folderBytes: Record<string, number> = {};
for (const f of ['crowd-v1/residents', 'crowd-v1/clips', 'crowd-v1/props', 'crowd-v1']) folderBytes[f] = walk(join(ENV, CHAR, f));

const totals = { residents: entries.length, crowdResidentFiles: entries.length - 4, crowdResidentBytes: crowdBytes,
  crowdTrianglesTotal: crowdTriangles, crowdFolderBytes: folderBytes['crowd-v1'], crowdResidentsFolderBytes: folderBytes['crowd-v1/residents'],
  clipLibrariesBytes: folderBytes['crowd-v1/clips'], propKitsBytes: folderBytes['crowd-v1/props'] };

/** One line per value, keys sorted: compact in the bundle and stable in diffs. */
const compact = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x);
const text = `// GENERATED by scripts/characters/population_art_registry.ts from the published resident files. Do not edit by hand:
// re-run the generator after scripts/characters/crowd_publish.py. Working placeholder: role labels only.
import type { PopulationArtEntry, PopulationArtTotals } from './village-population-art';

export const VILLAGE_POPULATION_ART_DATA: readonly PopulationArtEntry[] = [
${entries.map(e => '  ' + compact(e)).join(',\n')},
];

export const VILLAGE_POPULATION_ART_DATA_TOTALS: PopulationArtTotals = ${compact(totals)};
`;
if (check) {
  const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (now !== text) { console.error('village-population-art-data.ts is stale: re-run scripts/characters/population_art_registry.ts'); process.exit(1); }
  console.log('village-population-art-data.ts is current');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${entries.length} entries (${(totals.crowdFolderBytes / 1048576).toFixed(2)} MiB crowd-v1) to ${OUT}`);
}
