import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { HOUSEHOLD_ART_LEVELS, HOUSEHOLD_ART_SETS, householdArtFile, householdArtFolder, type HouseholdArtSet } from './household-art-sets';

// Runtime behaviour of the published resident files, checked without a renderer (round 2 critics: the blink blocker
// shipped because only metadata was tested). The GLBs are parsed here, skinned on the CPU exactly as glTF defines
// (morph deltas, then four joint influences), and:
// 1. eye closure: from three views 0.3 m in front of the eyes, no eyeball vertex may be visible at full blink, on the
//    delivered path (eyeBlink morphs at 1, lid joints at rest, as the joints-and-morphs adapter tier applies them) and
//    on the joints-only path (no morphs, lid joints at the set's faceCalibration angles, as the face clips and a
//    morph-less consumer apply them), at every level;
// 2. clip joins: every join the integration README documents (idle, start, walk, stop, sit, work entry and exit) meets
//    within a degree at every joint.
// Plain TypeScript: no three, so the numbers are independent of the adapters under test.

const ROOT = new URL('../../../../main game/public/assets/legacy/environment/', import.meta.url);

type Vec3 = [number, number, number];
type Mat4 = Float64Array;  // column-major, as glTF
interface Accessor {
  bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string;
  sparse?: { count: number; indices: { bufferView: number; byteOffset?: number; componentType: number }; values: { bufferView: number; byteOffset?: number } };
}
interface Gltf {
  nodes: { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; targets?: Record<string, number>[] }[]; extras?: { targetNames?: string[] } }[];
  accessors: Accessor[]; bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  skins: { joints: number[]; inverseBindMatrices: number }[];
  scenes: { nodes: number[] }[];
  animations?: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
}
interface Glb { json: Gltf; bin: Buffer }

const glbCache = new Map<string, Glb>();
function readGlb(set: HouseholdArtSet, file: string): Glb {
  const url = new URL(`${householdArtFolder(set)}/${file}`, ROOT);
  const hit = glbCache.get(url.href); if (hit) return hit;
  const data = fs.readFileSync(url);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLength;
  const out = { json, bin: data.subarray(binStart + 8, binStart + 8 + data.readUInt32LE(binStart)) };
  glbCache.set(url.href, out); return out;
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
function component(bin: Buffer, at: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5126: return bin.readFloatLE(at);
    case 5121: return normalized ? bin.readUInt8(at) / 255 : bin.readUInt8(at);
    case 5123: return normalized ? bin.readUInt16LE(at) / 65535 : bin.readUInt16LE(at);
    case 5125: return bin.readUInt32LE(at);
    case 5120: return normalized ? Math.max(-1, bin.readInt8(at) / 127) : bin.readInt8(at);
    case 5122: return normalized ? Math.max(-1, bin.readInt16LE(at) / 32767) : bin.readInt16LE(at);
    default: throw Error(`component type ${type}`);
  }
}
/** Every element of an accessor as a flat Float64Array (sparse accessors applied). */
function read(g: Glb, index: number): Float64Array {
  const a = g.json.accessors[index], w = WIDTH[a.type], size = BYTES[a.componentType];
  const out = new Float64Array(a.count * w);
  if (a.bufferView !== undefined) {
    const view = g.json.bufferViews[a.bufferView], stride = view.byteStride ?? w * size, base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < w; k++) out[i * w + k] = component(g.bin, base + i * stride + k * size, a.componentType, !!a.normalized);
  }
  if (a.sparse) {
    const iv = g.json.bufferViews[a.sparse.indices.bufferView], vv = g.json.bufferViews[a.sparse.values.bufferView];
    const ib = (iv.byteOffset ?? 0) + (a.sparse.indices.byteOffset ?? 0), vb = (vv.byteOffset ?? 0) + (a.sparse.values.byteOffset ?? 0);
    const isz = BYTES[a.sparse.indices.componentType];
    for (let j = 0; j < a.sparse.count; j++) {
      const i = component(g.bin, ib + j * isz, a.sparse.indices.componentType, false);
      for (let k = 0; k < w; k++) out[i * w + k] = component(g.bin, vb + (j * w + k) * size, a.componentType, !!a.normalized);
    }
  }
  return out;
}

// ------------------------------------------------------------------ small matrix and quaternion helpers
type Quat = [number, number, number, number];  // x, y, z, w
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const axisAngle = (axis: Vec3, angle: number): Quat => { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };
function compose(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q, m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = 2 * (x * y + z * w) * s[0]; m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2]; m[9] = 2 * (y * z - x * w) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = v;
  }
  return out;
}
const apply = (m: Mat4, p: Vec3): Vec3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** World matrices of every node with optional local rotation overrides (node index -> extra local rotation, applied
 * after the node's own rotation, as the face-rig adapters do: rest * pitch). */
function worldMatrices(g: Gltf, extra: Map<number, Quat> = new Map(), pose: Map<number, Quat> = new Map()): Mat4[] {
  const out: Mat4[] = new Array(g.nodes.length);
  const visit = (i: number, parent: Mat4 | null) => {
    const n = g.nodes[i];
    let local: Mat4;
    if (n.matrix) local = Float64Array.from(n.matrix);
    else {
      let q = (pose.get(i) ?? (n.rotation as Quat | undefined) ?? [0, 0, 0, 1]) as Quat;
      const e = extra.get(i); if (e) q = qmul(q, e);
      local = compose(n.translation ?? [0, 0, 0], q, n.scale ?? [1, 1, 1]);
    }
    out[i] = parent ? mul(parent, local) : local;
    for (const c of n.children ?? []) visit(c, out[i]);
  };
  for (const r of g.scenes[0].nodes) visit(r, null);
  return out;
}

interface SkinnedPrim { positions: Float64Array; triangles: Uint32Array; eye: Uint8Array }
/** CPU-skinned positions of every skinned primitive; eye marks vertices whose eye-joint weight is at least 0.5. */
function skin(g: Glb, extra: Map<number, Quat>, morphWeights: Record<string, number>): SkinnedPrim[] {
  const json = g.json, worlds = worldMatrices(json, extra);
  const out: SkinnedPrim[] = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const sk = json.skins[node.skin], ibm = read(g, sk.inverseBindMatrices);
    const jointMats = sk.joints.map((j, k) => mul(worlds[j], Float64Array.from(ibm.subarray(k * 16, k * 16 + 16))));
    const eyeJoints = new Set(sk.joints.map((j, k) => [json.nodes[j].name, k] as const).filter(([n]) => n === 'face_eye_l' || n === 'face_eye_r').map(([, k]) => k));
    const mesh = json.meshes[node.mesh], names = mesh.extras?.targetNames ?? [];
    for (const prim of mesh.primitives) {
      const pos = read(g, prim.attributes.POSITION), J = read(g, prim.attributes.JOINTS_0), W = read(g, prim.attributes.WEIGHTS_0);
      const count = pos.length / 3;
      (prim.targets ?? []).forEach((target, t) => {
        const w = morphWeights[names[t]] ?? 0;
        if (!w || target.POSITION === undefined) return;
        const d = read(g, target.POSITION);
        for (let i = 0; i < pos.length; i++) pos[i] += w * d[i];
      });
      const skinned = new Float64Array(pos.length), eye = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        const p: Vec3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        let x = 0, y = 0, z = 0, eyeW = 0;
        for (let k = 0; k < 4; k++) {
          const w = W[i * 4 + k]; if (!w) continue;
          const q = apply(jointMats[J[i * 4 + k]], p);
          x += w * q[0]; y += w * q[1]; z += w * q[2];
          if (eyeJoints.has(J[i * 4 + k])) eyeW += w;
        }
        skinned[i * 3] = x; skinned[i * 3 + 1] = y; skinned[i * 3 + 2] = z;
        eye[i] = eyeW >= 0.5 ? 1 : 0;
      }
      const idx = prim.indices !== undefined ? read(g, prim.indices) : Float64Array.from({ length: count }, (_, i) => i);
      out.push({ positions: skinned, triangles: Uint32Array.from(idx), eye });
    }
  }
  return out;
}

/** Segment-triangle test (Moller-Trumbore): does the segment from o to p cross the triangle before p? */
function blocks(o: Vec3, p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const d = sub(p, o), e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det, s = sub(o, a), u = f * dot(s, h);
  if (u < 0 || u > 1) return false;
  const q = cross(s, e1), v = f * dot(d, q);
  if (v < 0 || u + v > 1) return false;
  const t = f * dot(e2, q);
  return t > 1e-6 && t < 1 - 2e-4;  // strictly between the camera and the vertex (0.06 mm short of the vertex)
}

/** Eyeball vertices visible from three cameras 0.3 m in front of the eyes (straight, 15 degrees above, 10 below). */
function visibleEyeball(g: Glb, extra: Map<number, Quat>, morphs: Record<string, number>): { visible: number; front: number } {
  const prims = skin(g, extra, morphs);
  const worlds = worldMatrices(g.json, extra);
  const eyeNodes = g.json.nodes.map((n, i) => [n.name, i] as const).filter(([n]) => n === 'face_eye_l' || n === 'face_eye_r').map(([, i]) => i);
  const centres = eyeNodes.map(i => [worlds[i][12], worlds[i][13], worlds[i][14]] as Vec3);
  const mid: Vec3 = [(centres[0][0] + centres[1][0]) / 2, (centres[0][1] + centres[1][1]) / 2, (centres[0][2] + centres[1][2]) / 2];
  // glTF residents face +Z
  const cams: Vec3[] = [[mid[0], mid[1], mid[2] + 0.3], [mid[0], mid[1] + 0.078, mid[2] + 0.29], [mid[0], mid[1] - 0.052, mid[2] + 0.295]];
  // occluders: every non-eye triangle within 6 cm of the eyes (lids, skin, lashes, hair, head-cloths)
  const occ: [Vec3, Vec3, Vec3][] = [];
  const near = (v: Vec3) => Math.abs(v[0] - mid[0]) < 0.08 && Math.abs(v[1] - mid[1]) < 0.06 && Math.abs(v[2] - mid[2]) < 0.08;
  const pts: Vec3[] = [];
  for (const pr of prims) {
    const P = pr.positions, at = (i: number): Vec3 => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    for (let t = 0; t < pr.triangles.length; t += 3) {
      const [i, j, k] = [pr.triangles[t], pr.triangles[t + 1], pr.triangles[t + 2]];
      if (pr.eye[i] && pr.eye[j] && pr.eye[k]) continue;
      const a = at(i), b = at(j), c = at(k);
      if (near(a) || near(b) || near(c)) occ.push([a, b, c]);
    }
    for (let i = 0; i < pr.eye.length; i++) if (pr.eye[i]) pts.push(at(i));
  }
  let visible = 0, front = 0;
  for (const cam of cams) for (const p of pts) {
    const centre = Math.abs(p[0] - centres[0][0]) < Math.abs(p[0] - centres[1][0]) ? centres[0] : centres[1];
    if (dot(sub(p, centre), sub(cam, centre)) <= 0) continue;  // the back of the eyeball faces away
    front++;
    let hidden = false;
    for (const [a, b, c] of occ) if (blocks(cam, p, a, b, c)) { hidden = true; break; }
    if (!hidden) visible++;
  }
  return { visible, front };
}

function lidPose(json: Gltf, upper: number, lower: number): Map<number, Quat> {
  const m = new Map<number, Quat>();
  json.nodes.forEach((n, i) => {
    if (n.name === 'face_lid_upper_l' || n.name === 'face_lid_upper_r') m.set(i, axisAngle([1, 0, 0], upper));
    if (n.name === 'face_lid_lower_l' || n.name === 'face_lid_lower_r') m.set(i, axisAngle([1, 0, 0], lower));
  });
  return m;
}

test('every level closes its eyes completely on the morph path and on the joints-only path', () => {
  const rows: string[] = [];
  for (const set of HOUSEHOLD_ART_SETS) for (const level of HOUSEHOLD_ART_LEVELS) {
    const g = readGlb(set, householdArtFile(set, level)), label = `${set.set} ${level}`;
    const rest = visibleEyeball(g, new Map(), {});
    assert.ok(rest.visible > 0.2 * rest.front && rest.visible > 100, `${label}: the open eyes should be visible (${rest.visible}/${rest.front})`);
    const morph = visibleEyeball(g, new Map(), { eyeBlinkLeft: 1, eyeBlinkRight: 1 });
    const c = set.faceCalibration;
    const joints = visibleEyeball(g, lidPose(g.json, c.upperLidClosed, c.lowerLidClosed), {});
    rows.push(`${label}: rest ${rest.visible}, morph blink ${morph.visible}, joint blink ${joints.visible}`);
    // at most one percent of the views that see the open eyeball may still see a vertex of it (a vertex lying exactly
    // on a closed lid seam); the three.js eye-closure gate measures the visible area itself
    const allowed = Math.floor(0.01 * rest.visible);
    assert.ok(morph.visible <= allowed, `${label}: ${morph.visible} of ${rest.visible} eyeball vertex views stay visible at full morph blink`);
    assert.ok(joints.visible <= allowed, `${label}: ${joints.visible} of ${rest.visible} eyeball vertex views stay visible at the calibrated joint blink`);
  }
  assert.equal(rows.length, HOUSEHOLD_ART_SETS.length * HOUSEHOLD_ART_LEVELS.length);
  if (process.env.CROWNFALL_FACE_ROWS) console.log(rows.join('\n'));
});

// ------------------------------------------------------------------ clip joins

/** Local rotation of every animated node at clip time t (LINEAR or STEP samplers; quaternion slerp as nlerp). */
function poseAt(g: Glb, clip: string, t: number): Map<number, Quat> {
  const anim = g.json.animations!.find(a => a.name === clip);
  assert.ok(anim, `missing clip ${clip}`);
  const out = new Map<number, Quat>();
  for (const ch of anim!.channels) {
    if (ch.target.path !== 'rotation') continue;
    const s = anim!.samplers[ch.sampler], times = read(g, s.input), values = read(g, s.output);
    let k = 0; while (k < times.length - 2 && times[k + 1] < t) k++;
    const u = times.length > 1 ? Math.min(1, Math.max(0, (t - times[k]) / Math.max(1e-9, times[k + 1] - times[k]))) : 0;
    const a = Array.from(values.subarray(k * 4, k * 4 + 4)), b = Array.from(values.subarray((k + 1) * 4, (k + 1) * 4 + 4));
    const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    const q = a.map((v, i) => v + ((s.interpolation === 'STEP' ? 0 : u) * (sign * b[i] - v)));
    const len = Math.hypot(...q);
    out.set(ch.target.node, q.map(v => v / len) as Quat);
  }
  return out;
}
const duration = (g: Glb, clip: string) => Math.max(...g.json.animations!.find(a => a.name === clip)!.samplers.map(s => {
  const times = read(g, s.input); return times[times.length - 1];
}));
function worstJoinDegrees(g: Glb, a: string, ta: number, b: string, tb: number): { degrees: number; joint: string } {
  const pa = poseAt(g, a, ta), pb = poseAt(g, b, tb);
  let worst = 0, joint = '';
  g.json.skins[0].joints.forEach(j => {
    const name = g.json.nodes[j].name ?? '';
    if (name.startsWith('face_')) return;
    const rest = (g.json.nodes[j].rotation ?? [0, 0, 0, 1]) as Quat;
    const qa = pa.get(j) ?? rest, qb = pb.get(j) ?? rest;
    const d = Math.min(1, Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]));
    const deg = 2 * Math.acos(d) * 180 / Math.PI;
    if (deg > worst) { worst = deg; joint = name; }
  });
  return { degrees: worst, joint };
}

test('every documented clip join meets within a degree at every body joint (desktop LOD0 and Quest)', () => {
  for (const set of HOUSEHOLD_ART_SETS) for (const level of ['desktop-lod0', 'quest'] as const) {
    const g = readGlb(set, householdArtFile(set, level));
    const m = set.actorMotions, x = m.extra, t = set.workTransitions;
    const from = t.from === 'sit' ? m.sit! : m.idle;
    const joins: [string, number | 'end', string, number | 'end'][] = [
      [m.idle, 0, x.start, 0], [x.start, 'end', m.walk, 0], [m.walk, 'end', x.stop, 0], [x.stop, 'end', m.idle, 0],
      [from, 0, t.enter, 0], [t.enter, 'end', m.work, 0], [m.work, 'end', t.exit, 0], [t.exit, 'end', from, 0],
    ];
    if (x.sitDown && x.standUp && m.sit) joins.push([m.idle, 0, x.sitDown, 0], [x.sitDown, 'end', m.sit, 0], [m.sit, 'end', x.standUp, 0], [x.standUp, 'end', m.idle, 0]);
    for (const [a, ta, b, tb] of joins) {
      // one-shot clips end on their last key; a loop's last key repeats its first
      const r = worstJoinDegrees(g, a, ta === 'end' ? duration(g, a) : ta, b, tb === 'end' ? duration(g, b) : tb);
      assert.ok(r.degrees < 1.0, `${set.set} ${level}: ${a}@${ta} -> ${b}@${tb} differs ${r.degrees.toFixed(2)} deg at ${r.joint}`);
    }
  }
});

// ------------------------------------------------------------------ spinning mechanisms

test('every spinning props-clip node turns about its own geometry\'s axis (round 2: the fibre roll whirled in a cone)', () => {
  let spinning = 0;
  for (const set of HOUSEHOLD_ART_SETS) for (const file of ['props', 'props-quest'] as const) {
    const g = readGlb(set, householdArtFile(set, file));
    for (const anim of g.json.animations ?? []) for (const ch of anim.channels) {
      if (ch.target.path !== 'rotation') continue;
      const s = anim.samplers[ch.sampler], q = read(g, s.output), n = q.length / 4;
      // turning in the node's own frame between keys: q_i^-1 q_(i+1)
      let total = 0; const axis: Vec3 = [0, 0, 0];
      for (let i = 0; i + 1 < n; i++) {
        const a: Quat = [-q[i * 4], -q[i * 4 + 1], -q[i * 4 + 2], q[i * 4 + 3]];
        const d = qmul(a, [q[(i + 1) * 4], q[(i + 1) * 4 + 1], q[(i + 1) * 4 + 2], q[(i + 1) * 4 + 3]]);
        const w = Math.min(1, Math.abs(d[3])), angle = 2 * Math.acos(w), sgn = d[3] < 0 ? -1 : 1;
        const len = Math.hypot(d[0], d[1], d[2]); if (len < 1e-9) continue;
        total += angle; for (let k = 0; k < 3; k++) axis[k] += sgn * d[k] / len * angle;
      }
      // hinges and levers swing, and a paying-out yarn turns to follow its spindle: only nodes that turn more than a full
      // turn, coherently about one axis, spin
      if (total < 2 * Math.PI || Math.hypot(...axis) < 0.8 * total) continue;
      spinning++;
      const node = g.json.nodes[ch.target.node], label = `${set.set} ${file} ${anim.name} ${node.name}`;
      const al = Math.hypot(...axis), unit = axis.map(v => v / al) as Vec3;
      // the node turns about its own Z axis (the clips keep the spindle plumb and spin it about its shaft) ...
      const tilt = Math.acos(Math.min(1, Math.abs(unit[2]))) * 180 / Math.PI;
      assert.ok(tilt < 5, `${label}: spins about an axis ${tilt.toFixed(1)} deg off the node's Z`);
      // ... and its geometry is a slim body centred on that axis (a roll held off-axis would whirl in a cone)
      const mesh = g.json.meshes[node.mesh!];
      let cx = 0, cy = 0, count = 0, radial = 0;
      for (const prim of mesh.primitives) {
        const p = read(g, prim.attributes.POSITION);
        for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; count++; radial = Math.max(radial, Math.hypot(p[i], p[i + 1])); }
      }
      const off = Math.hypot(cx / count, cy / count);
      assert.ok(off < 0.003, `${label}: geometry centre ${(off * 100).toFixed(2)} cm off the spin axis`);
      assert.ok(radial < 0.03, `${label}: geometry reaches ${(radial * 100).toFixed(1)} cm from the spin axis (a held roll would whirl)`);
    }
  }
  assert.ok(spinning >= 2, 'the spinner\'s spindle spins in both props files');
});
