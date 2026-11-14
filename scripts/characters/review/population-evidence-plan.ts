// Evidence plan for the village population (original Crownfall code): writes a PLAN.json for
// scripts/characters/review/render-population.mjs from the population data and the published files.
//
//   main-game-vr/node_modules/.bin/tsx scripts/characters/review/population-evidence-plan.ts CHARACTERS_DIR PLAN.json [--set a,b]
//
// CHARACTERS_DIR is main game/public/assets/legacy/environment/aethelgard/characters (or a staging copy with the same
// layout). Sets: overview (all 100 by household from the isometric overview angle, plus 12 m crops of each row),
// lineups (every group side by side, front and back, and at 25 m), quest (a Quest-like eye-height scene of 13
// residents), strips (six frames of every role loop of every archetype library on a resident who uses it). Poses come
// from the archetype clip libraries; held props use the clip manifest's kitMatrix, workplace props its positionGltf,
// seated loops a kit stool at the library's seat. Props whose kit node is not reconciled (kitMismatch) are left out and
// listed in the plan's `omitted`. Plain ground plane only. Working placeholder; role labels only.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import {
  EALDHOLT_VILLAGE_POPULATION as POP, POPULATION_GROUPS, getPopulationProp, type PopulationResident, type PopulationArchetype,
} from '../../../shared/legacy/aethelgard/characters/village-population.ts';
import { HOUSEHOLD_ART_SETS, householdArtFile, householdArtFolder } from '../../../shared/legacy/aethelgard/characters/household-art-sets.ts';
import { getPopulationArt } from '../../../shared/legacy/aethelgard/characters/village-population-art.ts';

const [rootArg, planPath, ...rest] = process.argv.slice(2);
if (!rootArg || !planPath) { console.error('usage: population-evidence-plan.ts CHARACTERS_DIR PLAN.json [--set a,b]'); process.exit(2); }
const setAt = rest.indexOf('--set');
const sets = new Set(setAt >= 0 ? rest[setAt + 1].split(',') : ['overview', 'lineups', 'closeups', 'quest', 'walks', 'strips']);
const ROOT = rootArg;
const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

interface ClipProp { prop: string; bone: string | null; kitMatrix?: number[]; kitMismatch?: string; part?: string }
interface ClipWorkplace { prop: string; positionGltf: number[]; yawDeg?: number }
interface ClipEntry { kind: string; loop: boolean; seconds: number; props?: ClipProp[]; workplace?: ClipWorkplace[] }
interface Library { file: string; clips: Record<string, ClipEntry>; seat: { centreBlender: number[]; heightMetres: number } }
const clipsManifest = readJson('crowd-v1/clips/manifest.json') as { libraries: Record<string, Library> };
const kits = readJson('crowd-v1/props/kits.json').kits as Record<string, { file: string; props: Record<string, { node: string; sizeMetres: number[]; parts?: Record<string, { node: string }> }> }>;

const assets: Record<string, string> = {};
for (const [arch, lib] of Object.entries(clipsManifest.libraries)) assets[`lib:${arch}`] = `crowd-v1/clips/${lib.file}`;
for (const [kit, k] of Object.entries(kits)) assets[`kit:${kit}`] = `crowd-v1/props/${k.file}`;
const omitted = new Map<string, Set<string>>();

/** Stable 0..1 hash of a string (FNV-1a). */
function unit(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return (h % 100000) / 100000; }

interface Body { body: string; anim: string; scale: number; height: number; archetype: PopulationArchetype; existing: boolean }
function bodyOf(r: PopulationResident): Body | null {
  if (r.appearance.kind === 'existing-set') {
    const set = HOUSEHOLD_ART_SETS.find(s => s.residentId === r.id)!;
    const id = `set:${r.id}`; assets[id] = `${householdArtFolder(set).replace(/^aethelgard\/characters\//, '')}/${householdArtFile(set, 'quest')}`;
    return { body: id, anim: id, scale: 1, height: set.heightMetres, archetype: r.appearance.archetype, existing: true };
  }
  const rel = `crowd-v1/residents/${r.id}.json`;
  if (!existsSync(join(ROOT, rel))) return null;
  const m = readJson(rel);
  const id = `res:${r.id}`; assets[id] = `crowd-v1/residents/${r.id}.glb`;
  return { body: id, anim: `lib:${r.appearance.archetype}`, scale: m.placementScale, height: m.statureCm / 100, archetype: r.appearance.archetype, existing: false };
}

function propNode(pid: string, part?: string): { asset: string; node: string; size: number[] } | null {
  const spec = getPopulationProp(pid); if (!spec) return null;
  const k = kits[spec.kit]; const p = k?.props[pid]; if (!p) return null;
  // two-handed props: each grip's `part` has its own node (prop_<id>_<part>), modelled in that grip's frame
  if (part) { const pp = p.parts?.[part]; return pp ? { asset: `kit:${spec.kit}`, node: pp.node, size: p.sizeMetres } : null; }
  return { asset: `kit:${spec.kit}`, node: p.node, size: p.sizeMetres };
}

/** Props of a library clip (held by kitMatrix, workplace by position, seated loops on a kit stool). */
function clipProps(arch: string, clip: string) {
  const lib = clipsManifest.libraries[arch]; const c = lib.clips[clip]; const out: unknown[] = [];
  if (!c) return out;
  for (const p of c.props ?? []) {
    const n = propNode(p.prop, p.part);
    if (!n || !p.kitMatrix || !p.bone) { if (!omitted.has(clip)) omitted.set(clip, new Set()); omitted.get(clip)!.add(`${p.prop}${p.part ? ':' + p.part : ''}`); continue; }
    out.push({ asset: n.asset, node: n.node, bone: p.bone, matrix: p.kitMatrix });
  }
  for (const w of c.workplace ?? []) {
    // a workplace prop the kit does not have is listed in `omitted` (art fixer, 8 November: the mill hopper, oven,
    // stitching clam and tallow pot were dropped silently)
    const n = propNode(w.prop); if (!n) { if (!omitted.has(clip)) omitted.set(clip, new Set()); omitted.get(clip)!.add(`workplace:${w.prop}`); continue; }
    out.push({ asset: n.asset, node: n.node, position: w.positionGltf, yawDeg: w.yawDeg ?? 0 });
  }
  if (c.kind === 'seated' || clip === 'sit') {
    const stool = propNode('stool')!; const k = lib.seat.heightMetres / stool.size[2];
    out.push({ asset: stool.asset, node: stool.node, matrix: [1, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, -lib.seat.centreBlender[1], 1] });
  }
  return out;
}

/** Worn props at rest (registry `rest` attachments) for every worn prop the clip does not place itself, plus the
 * resident's own goods on the clip's workplace (props `placedWith` it) and carry goods in place of the clip's prop
 * they replace (props with `replaces`). */
function withRest(residentId: string, arch: string, clip: string, props: unknown[]): unknown[] {
  const art = getPopulationArt(residentId); if (!art) return props;
  const c = clipsManifest.libraries[arch]?.clips[clip];
  const listed = new Set((c?.props ?? []).map(p => p.prop));
  // worn props the clip hides while it plays (motion fixer, 8 November: the thatcher's back bundle while he ties straw)
  for (const h of (c as { hidesRestProps?: string[] } | undefined)?.hidesRestProps ?? []) listed.add(h);
  const rest = art.props.filter(p => p.rest && !listed.has(p.id)).map(p => ({ asset: `kit:${p.kit}`, node: p.node, bone: p.rest!.bone, matrix: [...p.rest!.matrix] }));
  const resident = byId.get(residentId);
  const extra: unknown[] = [];
  let out = props;
  for (const own of resident?.appearance.props ?? []) {
    const spec = getPopulationProp(own.id); const n = propNode(own.id); if (!spec || !n) continue;
    const at = spec.placedWith ? (c?.workplace ?? []).find(w => w.prop === spec.placedWith) : undefined;
    if (at) extra.push({ asset: n.asset, node: n.node, position: at.positionGltf, yawDeg: at.yawDeg ?? 0 });
    if (spec.replaces && listed.has(spec.replaces)) {
      const was = propNode(spec.replaces);
      out = out.map(p => (was && (p as { node?: string }).node === was.node) ? { ...(p as object), asset: n.asset, node: n.node } : p);
    }
  }
  return [...out, ...rest, ...extra];
}

const ROLE_KINDS = new Set(['work', 'guard', 'carry', 'play', 'care', 'seated']);
/** The pose that reads the resident's role best: first standing role loop, else first seated loop, else the idle. */
function rolePose(r: PopulationResident, b: Body): { clip: string; props: unknown[] } {
  if (b.existing) { const set = HOUSEHOLD_ART_SETS.find(s => s.residentId === r.id)!; return { clip: set.actorMotions.idle, props: [] }; }
  const lib = clipsManifest.libraries[b.archetype];
  const loops = r.appearance.motion.roleClips.filter(c => lib.clips[c]?.loop && ROLE_KINDS.has(lib.clips[c].kind));
  const standing = loops.find(c => lib.clips[c].kind !== 'seated');
  const pick = standing ?? loops[0];
  if (pick) return { clip: pick, props: withRest(r.id, b.archetype, pick, clipProps(b.archetype, pick)) };
  if (r.appearance.motion.walk === 'walk_stick') return { clip: 'idle_stick', props: withRest(r.id, b.archetype, 'idle_stick', clipProps(b.archetype, 'idle_stick')) };
  return { clip: r.appearance.motion.idle, props: withRest(r.id, b.archetype, r.appearance.motion.idle, []) };
}
function timeIn(arch: string, clip: string, key: string, body: Body): number {
  if (body.existing) return 0.8;
  const c = clipsManifest.libraries[arch].clips[clip]; return c ? unit(key) * c.seconds : 0;
}

const residents = POP.residents;
const byId = new Map(residents.map(r => [r.id, r]));
const bodies = new Map<string, Body>();
for (const r of residents) { const b = bodyOf(r); if (b) bodies.set(r.id, b); }
const missing = residents.filter(r => !bodies.has(r.id)).map(r => r.id);
const short = (r: PopulationResident) => r.label.replace(/^(The )/, '');
const shots: unknown[] = []; const sheets: unknown[] = [];
const ortho = (pos: number[], target: number[], height: number) => ({ type: 'ortho', position: pos, target, height });
const persp = (pos: number[], target: number[], fov: number) => ({ type: 'persp', position: pos, target, fov });
const fromAngles = (target: number[], azDeg: number, elDeg: number, dist: number) => {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
  return [target[0] + Math.sin(az) * Math.cos(el) * dist, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * Math.cos(el) * dist];
};

// ------------------------------------------------------------------ overview: all 100 by household
if (sets.has('overview')) {
  const actors: unknown[] = []; const notes: unknown[] = []; const cols = 5, dx = 7.6, dz = 7.0;
    POP.households.forEach((h, i) => {
    const cx = (i % cols - (cols - 1) / 2) * dx, cz = (Math.floor(i / cols) - 2) * dz;
    const n = h.memberIds.length; const radius = 1.0 + 0.32 * n;
    h.memberIds.forEach((id, k) => {
      const r = byId.get(id)!; const b = bodies.get(id); if (!b) return;
      const a = Math.PI * (0.15 + 0.7 * (n === 1 ? 0.5 : k / (n - 1)));
      const x = cx - Math.cos(a) * radius, z = cz - Math.sin(a) * radius * 0.55 + 0.6;
      const pose = rolePose(r, b);
      const actor = { id, body: b.body, anim: b.anim, clip: pose.clip, time: timeIn(b.archetype, pose.clip, id, b), position: [x, z],
        yaw: (unit(id + 'yaw') - 0.5) * 0.9, scale: b.scale, height: b.height, label: short(r), props: pose.props };
      actors.push(actor);
    });
    const note = { position: [cx, cz + 1.9], text: h.label, sub: `${h.memberIds.length} residents` };
    notes.push(note);
  });
  const target = [0, 0.5, 2.2];
  shots.push({ file: 'overview-100.png', size: [2800, 1900], camera: persp(fromAngles(target, 0, 54, 40), target, 45),
    shadow: { centre: [0, 0], radius: 24 }, actors, notes, title: 'Ealdholt population: 100 residents in 25 households (isometric overview angle, plain ground)' });
  // every household at the isometric angle from 12 m (the architect's near isometric distance), labelled
  const tiles = POP.households.map((h, i) => {
    const own = new Set(h.memberIds);
    const cx = (i % cols - (cols - 1) / 2) * dx, cz = (Math.floor(i / cols) - 2) * dz;
    const t = [cx, 0.55, cz - 0.4];
    return { size: [900, 640], camera: persp(fromAngles(t, 0, 54, 12), t, 26), shadow: { centre: [cx, cz], radius: 4 }, labels: 'over',
      actors: actors.filter(a => own.has((a as { id: string }).id)), caption: `${h.label} (${h.memberIds.length})` };
  });
  for (let i = 0; i < tiles.length; i += 6) {
    sheets.push({ file: `households-iso12-${i / 6 + 1}.png`, cols: 3, title: `Households ${i + 1}-${Math.min(i + 6, tiles.length)}: isometric angle (54 degrees) at 12 m, role pose with held and workplace props`, tiles: tiles.slice(i, i + 6) });
  }
  // the game's own overview camera distance (village-views.ts overview: about 110 m, fov 45)
  shots.push({ file: 'overview-game-distance.png', size: [1920, 1080], camera: persp(fromAngles(target, 0, 54, 110), target, 45),
    shadow: { centre: [0, 0], radius: 24 }, actors, title: 'Same 100 residents at the village overview camera distance (110 m, fov 45)' });
}

// ------------------------------------------------------------------ group line-ups
if (sets.has('lineups')) {
  const groupLabel: Record<string, string> = {
    'farmers-artisans-merchants': 'Farmers, artisans and merchants', 'children-apprentices': 'Children and apprentices',
    'guards-military': 'Guards and military', 'elders-dependents': 'Elders and dependents', 'leaders-clergy-specialists': 'Leaders, clergy and specialists',
  };
  for (const g of POPULATION_GROUPS) {
    const members = residents.filter(r => r.group === g && bodies.has(r.id));
    const perRow = 12, spacing = 0.86; const rowsFront: unknown[] = [], rowsBack: unknown[] = [], rowsIso: unknown[] = [];
    for (let i = 0; i < members.length; i += perRow) {
      const chunk = members.slice(i, i + perRow);
      const mk = (yaw: number) => chunk.map((r, k) => {
        const b = bodies.get(r.id)!;
        return { body: b.body, anim: b.anim, clip: b.existing ? HOUSEHOLD_ART_SETS.find(s => s.residentId === r.id)!.actorMotions.idle : 'idle', time: 0,
          position: [(k - (perRow - 1) / 2) * spacing, 0], yaw, scale: b.scale, height: b.height, label: short(r), sub: `${r.ageYears} ${r.appearance.archetype}`,
          props: b.existing ? [] : withRest(r.id, b.archetype, 'idle', []) };
      });
      const t = [0, 0.95, 0];
      rowsFront.push({ size: [2600, 640], camera: ortho(fromAngles(t, 12, 6, 30), t, 2.75), shadow: { centre: [0, 0], radius: 7 }, labels: 'under', actors: mk(0) });
      rowsBack.push({ size: [2600, 640], camera: ortho(fromAngles(t, 180 + 12, 6, 30), t, 2.75), shadow: { centre: [0, 0], radius: 7 }, actors: mk(0) });
      const ti = [0, 0.6, 0];
      rowsIso.push({ size: [2600, 1000], camera: persp(fromAngles(ti, 0, 54, 25), ti, 45), shadow: { centre: [0, 0], radius: 7 }, actors: mk(0) });
    }
    const slug = g;
    sheets.push({ file: `lineup-${slug}-front.png`, cols: 1, title: `${groupLabel[g]} (${members.length}): front three-quarter, rest pose, orthographic`, tiles: rowsFront });
    sheets.push({ file: `lineup-${slug}-back.png`, cols: 1, title: `${groupLabel[g]}: back`, tiles: rowsBack });
    sheets.push({ file: `lineup-${slug}-iso25.png`, cols: 1, title: `${groupLabel[g]}: isometric angle (54 degrees) at 25 m, fov 45, 1000 px tall (about the desktop view)`, tiles: rowsIso });
  }
}

// ------------------------------------------------------------------ close-ups at Quest standing distance (2.5 m), rest pose
if (sets.has('closeups')) {
  const list = residents.filter(r => bodies.has(r.id));
  const tiles = list.flatMap(r => {
    const b = bodies.get(r.id)!; const clip = b.existing ? HOUSEHOLD_ART_SETS.find(s => s.residentId === r.id)!.actorMotions.idle : 'idle';
    const t = [0, b.height * 0.62, 0];
    const actor = { body: b.body, anim: b.anim, clip, time: 0, position: [0, 0], yaw: 0, scale: b.scale, height: b.height, props: b.existing ? [] : withRest(r.id, b.archetype, 'idle', []) };
    return [
      { size: [300, 420], camera: persp(fromAngles(t, 28, 6, 2.5 * b.height / 1.7 + 0.6), t, 34), shadow: { centre: [0, 0], radius: 2 }, actors: [actor], caption: short(r) },
      { size: [300, 420], camera: persp(fromAngles(t, 160, 6, 2.5 * b.height / 1.7 + 0.6), t, 34), shadow: { centre: [0, 0], radius: 2 }, actors: [actor], caption: 'back' },
    ];
  });
  for (let i = 0; i < tiles.length; i += 32) sheets.push({ file: `closeups-${i / 32 + 1}.png`, cols: 8, title: 'Quest standing distance (about 2.5 m), rest pose: front three-quarter and back', tiles: tiles.slice(i, i + 32) });
}

// ------------------------------------------------------------------ Quest-like scene (eye height, 13 residents)
if (sets.has('quest')) {
  const pick = (id: string, clip: string, x: number, z: number, yawDeg: number, t?: number) => {
    const r = byId.get(id)!; const b = bodies.get(id)!; const arch = b.archetype;
    return { body: b.body, anim: b.anim, clip, time: t ?? timeIn(arch, clip, id + clip, b), position: [x, z], yaw: yawDeg * Math.PI / 180, scale: b.scale,
      height: b.height, label: short(r), props: b.existing ? [] : withRest(id, arch, clip, clipProps(arch, clip)) };
  };
  const want: [string, string, number, number, number][] = [
    ['ealdholt-brewster', 'talk', -0.75, -2.4, 70], ['ealdholt-pedlar', 'talk_b', 0.35, -2.5, -95],
    ['ealdholt-gate-ward', 'guard_stand_watch', -3.4, -5.2, 35], ['ealdholt-poultry-seller', 'work_sell', 2.6, -6.0, 200],
    ['ealdholt-east-farmer', 'work_hoe', -1.2, -9.5, 20], ['ealdholt-captain-daughter', 'play_chase', 1.0, -5.0, 120],
    ['ealdholt-serjeant-son', 'play_chase', 1.9, -5.6, 150], ['ealdholt-weaver-mother', 'walk_stick', 3.2, -3.6, -60],
    ['ealdholt-miller-apprentice', 'carry_sack_walk', -2.6, -7.8, 80], ['ealdholt-garrison-spearman', 'guard_patrol_walk', 4.5, -12.5, -90],
    ['ealdholt-hall-elder', 'work_shell_peas', -5.0, -8.6, 35], ['ealdholt-shepherd', 'work_herd', -5.5, -13.0, 30],
    ['ealdholt-master-weaver', 'work_weave', 5.6, -8.5, 230],
  ];
  const actors = want.filter(([id]) => bodies.has(id)).map(([id, clip, x, z, y]) => {
    const r = byId.get(id)!; const lib = clipsManifest.libraries[r.appearance.archetype];
    const c = lib.clips[clip] ? clip : rolePose(r, bodies.get(id)!).clip;
    return pick(id, c, x, z, y);
  });
  shots.push({ file: 'quest-scene-13.png', size: [1800, 1500], camera: persp([0, 1.6, 0.4], [0.3, 0.75, -8], 78), shadow: { centre: [0, -7], radius: 10 },
    actors, title: 'Quest-like view: eye height 1.6 m, 13 residents drawn (presence cap 12, top of range 15); software render' });
  shots.push({ file: 'quest-scene-13-labelled.png', size: [1800, 1500], camera: persp([0, 1.6, 0.4], [0.3, 0.75, -8], 78), shadow: { centre: [0, -7], radius: 10 },
    actors, labels: 'over', title: 'Quest-like view, labelled' });
  const t = [0, 0.5, -7.5];
  shots.push({ file: 'quest-scene-13-plan.png', size: [1600, 1200], camera: persp(fromAngles(t, 0, 62, 20), t, 45), shadow: { centre: [0, -7], radius: 10 },
    actors, labels: 'over', title: 'Quest-like scene from above (viewer at the origin)' });
}

// ------------------------------------------------------------------ silhouettes: clone-risk masks (one tile per crowd resident)
const silhouetteIndex: string[] = [];
if (sets.has('silhouettes')) {
  const tiles: unknown[] = [];
  for (const r of residents) {
    const b = bodies.get(r.id); if (!b || b.existing) continue;
    silhouetteIndex.push(r.id);
    const actor = { body: b.body, anim: b.anim, clip: 'idle', time: 0, position: [0, 0], yaw: 0, scale: b.scale, height: b.height, props: withRest(r.id, b.archetype, 'idle', []) };
    const t = [0, 0.95, 0];
    tiles.push({ size: [160, 240], silhouette: true, camera: ortho(fromAngles(t, 0, 0, 20), t, 2.1), actors: [actor] });
    const ti = [0, 0.8, 0];
    tiles.push({ size: [160, 240], silhouette: true, camera: ortho(fromAngles(ti, 30, 54, 20), ti, 2.1), actors: [actor] });
  }
  sheets.push({ file: 'silhouettes.png', cols: 16, tiles });
}

// ------------------------------------------------------------------ poses: chosen residents in their role pose (POSE_IDS=id,id)
if (sets.has('poses')) {
  const ids = (process.env.POSE_IDS ?? '').split(',').filter(Boolean);
  const tiles: unknown[] = [];
  for (const id of ids) {
    const r = byId.get(id); const b = r && bodies.get(id); if (!r || !b || b.existing) continue;
    const pose = rolePose(r, b); const c = clipsManifest.libraries[b.archetype].clips[pose.clip]; const s = b.scale; const t = [0, 0.8 * s, 0.2 * s];
    for (const [k, az] of [[0, 30], [1, 30], [2, 30], [1, 150]] as const) {
      const time = c ? c.seconds * k / 3 : 0;
      tiles.push({ size: [300, 380], camera: persp(fromAngles(t, az, 10, 4.2 * s), t, 30), shadow: { centre: [0, 0], radius: 2.5 },
        actors: [{ body: b.body, anim: b.anim, clip: pose.clip, time, position: [0, 0], yaw: 0, scale: s, height: b.height, props: pose.props }],
        caption: k === 0 && az === 30 ? `${short(r)}: ${pose.clip}` : `${time.toFixed(2)} s` });
    }
  }
  for (let i = 0; i < tiles.length; i += 32) sheets.push({ file: `poses-${i / 32 + 1}.png`, cols: 8, title: 'Role poses (three frames front, one back)', tiles: tiles.slice(i, i + 32) });
}

// ------------------------------------------------------------------ walks: long garments in the walk variants
if (sets.has('walks')) {
  const longKits = new Set(['steward-gown', 'messenger-travel', 'elder-m', 'elder-f', 'market-m', 'market-f', 'clergy-cassock', 'herder-cloak',
    'hall-livery', 'field-kirtle', 'child-dress', 'guard-captain', 'healer-kirtle', 'clerk-robe', 'apprentice-f', 'workshop-apron-f']);
  const rowsOut: unknown[] = [];
  const seenKit = new Set<string>();
  for (const r of residents) {
    const b = bodies.get(r.id); if (!b || b.existing || !longKits.has(r.appearance.outfit.kit) || seenKit.has(r.appearance.outfit.kit)) continue;
    seenKit.add(r.appearance.outfit.kit);
    const lib = clipsManifest.libraries[b.archetype]; const clip = r.appearance.motion.walk; const c = lib.clips[clip]; const s = b.scale;
    const props = withRest(r.id, b.archetype, clip, clipProps(b.archetype, clip)); const t = [0, 0.8 * s, 0];
    for (let k = 0; k < 6; k++) {
      const time = c.seconds * k / 6;
      rowsOut.push({ size: [300, 380], camera: persp(fromAngles(t, 75, 8, 3.9 * s), t, 30), shadow: { centre: [0, 0], radius: 2.5 },
        actors: [{ body: b.body, anim: b.anim, clip, time, position: [0, 0], yaw: 0, scale: s, height: b.height, props }],
        caption: k === 0 ? `${short(r)}: ${clip}` : `${time.toFixed(2)} s` });
    }
  }
  for (let i = 0; i < rowsOut.length; i += 48) sheets.push({ file: `walks-long-garments-${i / 48 + 1}.png`, cols: 6, title: 'Walk cycles of the long-garment kits (one resident per kit), side three-quarter', tiles: rowsOut.slice(i, i + 48) });
}

// ------------------------------------------------------------------ motion strips: every role loop of every library
const stripIndex: unknown[] = [];
if (sets.has('strips')) {
  for (const [arch, lib] of Object.entries(clipsManifest.libraries)) {
    const users = residents.filter(r => r.appearance.archetype === arch && r.appearance.kind === 'crowd' && bodies.has(r.id));
    const loops = Object.entries(lib.clips).filter(([n, c]) => c.loop && (ROLE_KINDS.has(c.kind) || ['run', 'walk_stick', 'walk_crutch', 'idle_stick'].includes(n)))
      .map(([n]) => n).sort();
    const rowsOut: unknown[] = [];
    for (const clip of loops) {
      const r = users.find(u => u.appearance.motion.roleClips.includes(clip) || u.appearance.motion.walk === clip) ?? users[0];
      if (!r) continue;
      const b = bodies.get(r.id)!; const c = lib.clips[clip]; const props = withRest(r.id, arch, clip, clipProps(arch, clip));
      const hasWork = (c.workplace ?? []).length > 0; const s = b.scale;
      const tall = (c.workplace ?? []).some(w => w.prop === 'loom' || w.prop === 'hide-beam');  // seen from behind, or it hides the worker
      const t = [0, 0.82 * s, hasWork ? 0.25 * s : 0.05];
      for (let k = 0; k < 6; k++) {
        const time = c.seconds * k / 6;
        rowsOut.push({ size: [300, 360], camera: persp(fromAngles(t, tall ? 150 : 38, 12, (hasWork ? 4.3 : 3.7) * s), t, 30), shadow: { centre: [0, 0], radius: 2.5 },
          actors: [{ body: b.body, anim: b.anim, clip, time, position: [0, 0], yaw: 0, scale: s, height: b.height, props }],
          caption: k === 0 ? `${clip}` : `${time.toFixed(2)} s` });
      }
      stripIndex.push({ archetype: arch, clip, resident: r.id, seconds: c.seconds, omittedProps: [...(omitted.get(clip) ?? [])] });
    }
    const perSheet = 8 * 6;
    for (let i = 0; i < rowsOut.length; i += perSheet) {
      sheets.push({ file: `strips-${arch}-${i / perSheet + 1}.png`, cols: 6, title: `${arch} library: role loops, six frames each (clip on a resident who uses it)`, tiles: rowsOut.slice(i, i + perSheet) });
    }
  }
}

const plan = { root: relative(dirname(planPath), ROOT) || '.', assets, shots, sheets, missing,
  omitted: Object.fromEntries([...omitted].map(([k, v]) => [k, [...v]])), strips: stripIndex, silhouettes: silhouetteIndex };
writeFileSync(planPath, JSON.stringify(plan, null, 1));
console.log(`plan: ${shots.length} shots, ${sheets.length} sheets, ${Object.keys(assets).length} assets, missing ${missing.length}`);
