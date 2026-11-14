/**
 * The stump a limb leaves (web/src/scene/death/sever/severPlan.ts): the skin the body wears once the limb is off
 * (`stumpSkin`: the limb's triangles gone, the limb's bones given to the stump in what the body still draws, so
 * nothing is pulled into the folded joint as shards), and what the cut shows in section where it went through armour
 * (`cutSections`, `wornSection`). Cut on a tube and on the figures the game ships.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CUT_SECTIONS, CUT_SECTION_CODE, CUT_METAL, cutSections, limbJoints, namedSection, severSkin, severableLimbs, stumpSkin, surfaceSection, wornSection,
  type SeverLimb,
} from "../../web/src/scene/death/sever/severPlan";
import type { RigJoint } from "../../web/src/scene/death/ragdoll/ragdollPlan";

/** A tube along y, `rings` rounds of `around` vertices (a texture seam where the round closes), capped at both ends. */
function tube(rings = 10, around = 12, squash = 1) {
  const P: number[] = [], index: number[] = [];
  for (let r = 0; r < rings; r += 1) for (let a = 0; a <= around; a += 1) {
    const angle = a / around * Math.PI * 2;
    P.push(Math.cos(angle) * 0.05, r * 0.1, Math.sin(angle) * 0.05 * squash);
  }
  const at = (r: number, a: number) => r * (around + 1) + a;
  for (let r = 0; r + 1 < rings; r += 1) for (let a = 0; a < around; a += 1) index.push(at(r, a), at(r + 1, a), at(r, a + 1), at(r, a + 1), at(r + 1, a), at(r + 1, a + 1));
  for (const [r, flip] of [[0, false], [rings - 1, true]] as const) {
    const hub = P.length / 3; P.push(0, r * 0.1, 0);
    for (let a = 0; a < around; a += 1) index.push(...(flip ? [at(r, a), hub, at(r, a + 1)] : [at(r, a), at(r, a + 1), hub]));
  }
  return { positions: Float32Array.from(P), index: Uint32Array.from(index) };
}

const keyOf = (positions: ArrayLike<number>, v: number, grid: number) => `${Math.round(positions[v * 3] / grid)},${Math.round(positions[v * 3 + 1] / grid)},${Math.round(positions[v * 3 + 2] / grid)}`;
/** Edges that belong to one triangle only, matched by position, as keys. */
function openEdges(positions: ArrayLike<number>, index: ArrayLike<number>, grid: number): Set<string> {
  const count = new Map<string, number>();
  for (let t = 0; t + 2 < index.length; t += 3) for (let k = 0; k < 3; k += 1) {
    const a = keyOf(positions, index[t + k], grid), b = keyOf(positions, index[t + (k + 1) % 3], grid);
    if (a === b) continue;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    count.set(id, (count.get(id) ?? 0) + 1);
  }
  return new Set([...count].filter(([, times]) => times % 2 === 1).map(([id]) => id));
}
const edgeKey = (positions: ArrayLike<number>, a: number, b: number, grid: number) => { const x = keyOf(positions, a, grid), y = keyOf(positions, b, grid); return x < y ? `${x}|${y}` : `${y}|${x}`; };
const poseOf = (positions: ArrayLike<number>) => (v: number, out: number[]) => { for (let k = 0; k < 3; k += 1) { out[k] = positions[v * 3 + k]; out[k + 3] = 0; } };

test("the body keeps its own side of the cut, the limb's triangles leave it, and the hole is the stump's round", () => {
  const skin = tube(), count = skin.positions.length / 3;
  const y = (v: number) => skin.positions[v * 3 + 1];
  // Bone 0 the body, bone 1 the limb; round the cut each vertex is held by both.
  const owner = Uint8Array.from({ length: count }, (_, v) => y(v) > 0.45 ? 1 : 0);
  const skinIndex = Array.from({ length: count * 4 }, (_, slot) => slot % 4 === 0 ? (y(Math.floor(slot / 4)) > 0.45 ? 1 : 0) : slot % 4 === 1 ? (y(Math.floor(slot / 4)) > 0.45 ? 0 : 1) : 0);
  const before = [...skinIndex];
  const cut = severSkin({ count, index: skin.index, owner, pose: poseOf(skin.positions), uv: null });
  const body = stumpSkin({ count, index: skin.index, owner, groups: [], skinIndex, limbBones: [false, true], hold: 0 });
  assert.ok(cut.limb && cut.stump);
  assert.equal(body.dropped, cut.limb.skin / 3, "every triangle the limb took leaves the body");
  assert.equal(body.index.length / 3 + body.dropped, skin.index.length / 3);
  assert.equal(body.groups.length, 0);
  // Nothing the body still draws is held by the limb's bone: folding it moves none of it.
  const drawn = new Set(body.index);
  for (const v of drawn) for (let k = 0; k < 4; k += 1) assert.notEqual(skinIndex[v * 4 + k], 1, `vertex ${v} still on the limb`);
  assert.ok(body.moved > 0 && body.moved <= drawn.size);
  // A vertex only the limb drew keeps its skin: the ragdoll and a burst still find it on the limb.
  for (let v = 0; v < count; v += 1) if (!drawn.has(v)) for (let k = 0; k < 4; k += 1) assert.equal(skinIndex[v * 4 + k], before[v * 4 + k]);
  // The body is open exactly along the stump's round: the cap's rim, on the body's own vertices, closes it.
  const open = openEdges(skin.positions, body.index, 1e-5);
  const stump = new Set<string>();
  for (let e = 0; e < cut.stump.edges.length; e += 2) stump.add(edgeKey(skin.positions, cut.stump.edges[e], cut.stump.edges[e + 1], 1e-5));
  assert.deepEqual([...open].sort(), [...stump].sort());
});

test("the body's draw groups keep their own triangles, in order, and a skin drawn without an index is cut the same", () => {
  const skin = tube(), count = skin.positions.length / 3, half = Math.floor(skin.index.length / 6) * 3;
  const owner = Uint8Array.from({ length: count }, (_, v) => skin.positions[v * 3 + 1] > 0.45 ? 1 : 0);
  const fresh = () => Array.from({ length: count * 4 }, (_, slot) => slot % 4 === 0 ? owner[Math.floor(slot / 4)] : 0);
  const whole = stumpSkin({ count, index: skin.index, owner, groups: [], skinIndex: fresh(), limbBones: [false, true], hold: 0 });
  const grouped = stumpSkin({ count, index: skin.index, owner, groups: [{ start: 0, count: half, materialIndex: 0 }, { start: half, count: Infinity, materialIndex: 1 }], skinIndex: fresh(), limbBones: [false, true], hold: 0 });
  assert.deepEqual([...grouped.index], [...whole.index], "the same triangles, in the same order");
  assert.equal(grouped.groups.length, 2);
  assert.deepEqual(grouped.groups.map(group => group.materialIndex), [0, 1]);
  assert.equal(grouped.groups[0].start, 0);
  assert.equal(grouped.groups[1].start, grouped.groups[0].count);
  assert.equal(grouped.groups[0].count + grouped.groups[1].count, grouped.index.length);
  // Unindexed: three vertices a triangle, as three.js draws it.
  const corners = skin.index.length, flatOwner = Uint8Array.from(skin.index, v => owner[v]);
  const unindexed = stumpSkin({ count: corners, index: null, owner: flatOwner, groups: [], skinIndex: Array.from({ length: corners * 4 }, (_, slot) => slot % 4 === 0 ? flatOwner[Math.floor(slot / 4)] : 0), limbBones: [false, true], hold: 0 });
  assert.equal(unindexed.index.length, whole.index.length);
  assert.equal(unindexed.dropped, whole.dropped);
});

test("the limb's cut end is marked 1 all round its rim, however the rim runs, as the stump's cap is", () => {
  const skin = tube(10, 16, 0.45), count = skin.positions.length / 3;
  const owner = Uint8Array.from({ length: count }, (_, v) => skin.positions[v * 3 + 1] > 0.45 ? 1 : 0);
  const { limb } = severSkin({ count, index: skin.index, owner, pose: poseOf(skin.positions), uv: null });
  assert.ok(limb);
  let rims = 0, middles = 0;
  for (let i = limb.skin; i < limb.index.length; i += 1) {
    const v = limb.index[i], r = limb.cut[v * 3];
    if (r === 0) middles += 1; else { assert.equal(r, 1, "an oval cut's rim is its rim all round"); rims += 1; }
  }
  assert.ok(rims > 0 && middles > 0);
});

// ---------------------------------------------------------------- the figures the game ships

interface ModelSkin { positions: Float32Array; joints: Uint16Array; weights: Float32Array; index: Uint32Array; rig: RigJoint[]; height: number }

type Kingdom = "solforiz" | "korvenia" | "kwind09";
interface Gltf { nodes: { name: string; children?: number[] }[]; skins: { joints: number[] }[]; meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[] }

/** A shipped figure's rigged GLB, and a reader of its accessors as plain numbers. */
function glb(kingdom: Kingdom, kind: string): { doc: Gltf; read: (accessor: number) => number[] } {
  const bytes = readFileSync(fileURLToPath(new URL(`../../main game/public/models/${kingdom}/${kind}-rigged.glb`, import.meta.url)));
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString("utf8", 20, 20 + length)), bin = bytes.subarray(20 + length + 8);
  return { doc, read: (accessorIndex: number): number[] => {
    const accessor = doc.accessors[accessorIndex], view = doc.bufferViews[accessor.bufferView];
    const width = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[accessor.type];
    const size = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[accessor.componentType];
    const stride = view.byteStride ?? width * size, start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), out: number[] = [];
    for (let i = 0; i < accessor.count; i += 1) for (let k = 0; k < width; k += 1) {
      const at = start + i * stride + k * size;
      const raw = accessor.componentType === 5126 ? bin.readFloatLE(at) : accessor.componentType === 5125 ? bin.readUInt32LE(at) : accessor.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt8(at);
      out.push(accessor.normalized ? raw / (size === 1 ? 255 : 65535) : raw);
    }
    return out;
  } };
}

/** A shipped figure's skin, read straight from its rigged GLB: positions, four joints and weights a vertex, triangles, and its skeleton. */
function modelSkin(kingdom: Kingdom, kind: string): ModelSkin {
  const { doc, read } = glb(kingdom, kind);
  const primitive = doc.meshes[0].primitives[0], skin = doc.skins[0];
  const parentOf = new Map<number, number>();
  doc.nodes.forEach((node, i) => (node.children ?? []).forEach(child => parentOf.set(child, i)));
  const positions = Float32Array.from(read(primitive.attributes.POSITION));
  let low = Infinity, high = -Infinity;
  for (let i = 1; i < positions.length; i += 3) { low = Math.min(low, positions[i]); high = Math.max(high, positions[i]); }
  return {
    positions, joints: Uint16Array.from(read(primitive.attributes.JOINTS_0)), weights: Float32Array.from(read(primitive.attributes.WEIGHTS_0)), index: Uint32Array.from(read(primitive.indices)),
    rig: skin.joints.map(node => ({ name: doc.nodes[node].name as string, parent: skin.joints.indexOf(parentOf.get(node) ?? -1) })), height: high - low,
  };
}

/** Cuts `limb` off a shipped figure as SeverSystem.ts does: what each vertex's heaviest bone says, then both sides of the cut. */
function cutModel(model: ModelSkin, limb: SeverLimb) {
  const bone = severableLimbs(model.rig).find(found => found.limb === limb)!;
  const going = new Set(limbJoints(model.rig, bone)), limbBones = model.rig.map((_, j) => going.has(j));
  const count = model.positions.length / 3, owner = new Uint8Array(count);
  for (let v = 0; v < count; v += 1) {
    let best = 0, most = -1;
    for (let k = 0; k < 4; k += 1) if (model.weights[v * 4 + k] > most) { most = model.weights[v * 4 + k]; best = model.joints[v * 4 + k]; }
    owner[v] = limbBones[best] ? 1 : 0;
  }
  const skinIndex = Uint16Array.from(model.joints);
  const cut = severSkin({ count, index: model.index, owner, pose: poseOf(model.positions), uv: null });
  const body = stumpSkin({ count, index: model.index, owner, groups: [], skinIndex, limbBones, hold: bone.parent });
  return { cut, body, skinIndex, limbBones, count };
}

for (const [kingdom, kind, limb] of [["solforiz", "n", "head"], ["korvenia", "k", "armR"], ["kwind09", "p", "shinL"], ["solforiz", "r", "foreArmL"]] as const) {
  test(`a shipped figure (${kingdom} ${kind}) loses its ${limb} with a clean edge: nothing it still draws is pulled into the folded joint`, () => {
    const model = modelSkin(kingdom, kind), { cut, body, skinIndex, limbBones, count } = cutModel(model, limb);
    assert.ok(cut.limb && cut.stump && cut.stump.count >= 1, "a limb and a stump");
    assert.equal(body.dropped, cut.limb.skin / 3, "the limb's triangles leave the body");
    // Before: the body's own triangles round the cut were held partly by the limb's bones, and folded with them (the shards).
    const drawn = new Set(body.index);
    let pulled = 0;
    for (const v of drawn) { let share = 0; for (let k = 0; k < 4; k += 1) if (limbBones[model.joints[v * 4 + k]]) share += model.weights[v * 4 + k]; pulled = Math.max(pulled, share); }
    assert.ok(pulled > 0.2, `the body's side of the cut was held by the limb (up to ${pulled.toFixed(2)})`);
    // After: none of it is.
    for (const v of drawn) for (let k = 0; k < 4; k += 1) assert.ok(!limbBones[skinIndex[v * 4 + k]], `vertex ${v} still folds with the limb`);
    for (let v = 0; v < count; v += 1) if (!drawn.has(v)) for (let k = 0; k < 4; k += 1) assert.equal(skinIndex[v * 4 + k], model.joints[v * 4 + k], "the limb's own vertices keep their skin");
    // Every hole the cut opens in the body is on the stump's rounds, which the cap closes on the body's own vertices,
    // or a single edge from the figure's own open border to its border (a garment's hem: open there already).
    const grid = model.height * 1e-5, whole = openEdges(model.positions, model.index, grid), now = openEdges(model.positions, body.index, grid);
    const rim = new Set<string>(), border = new Set([...whole].flatMap(edge => edge.split("|")));
    for (let e = 0; e < cut.stump.edges.length; e += 2) rim.add(edgeKey(model.positions, cut.stump.edges[e], cut.stump.edges[e + 1], grid));
    const opened = [...now].filter(edge => !whole.has(edge));
    assert.ok(opened.length > 0);
    for (const edge of opened) assert.ok(rim.has(edge) || edge.split("|").every(end => border.has(end)), "a hole the cap does not close");
    assert.ok(opened.filter(edge => rim.has(edge)).length >= opened.length * 0.95, "nearly all of it under the cap");
    for (const edge of rim) assert.ok(now.has(edge), "the cap's rim runs along the hole");
  });
}

// ---------------------------------------------------------------- what the cut goes through

test("what a cut shows in section: the armour tables where the figure is one painted mesh", () => {
  assert.deepEqual(CUT_SECTIONS, ["flesh", "cloth", "mail", "plate"]);
  assert.deepEqual(CUT_SECTIONS.map(section => CUT_SECTION_CODE[section]), [0, 1, 2, 3]);
  assert.equal(surfaceSection("plate"), "plate"); assert.equal(surfaceSection("steel"), "plate"); assert.equal(surfaceSection("iron"), "plate");
  assert.equal(surfaceSection("mail"), "mail"); assert.equal(surfaceSection("cloth"), "cloth");
  assert.equal(surfaceSection("skin"), "flesh"); assert.equal(surfaceSection("wood"), "flesh");
  // Each figure is cut through what it is seen to wear where the limb comes off.
  // The Aethelgard knight is plate from neck to knee; the Solforiz knight, robes and wrappings, is cloth everywhere.
  for (const limb of ["head", "armL", "foreArmR", "legL", "shinR"] as const) {
    assert.equal(wornSection("n", "ivory", limb), "plate", `ivory knight ${limb}`);
    assert.equal(wornSection("n", "sun", limb), "cloth", `sun knight ${limb}`);
  }
  // The Aethelgard pawn: mail at the shoulder (its short sleeve), a gambeson at the elbow, cloth at the hip and knee.
  assert.equal(wornSection("p", "ivory", "armL"), "mail");
  assert.equal(wornSection("p", "ivory", "foreArmL"), "cloth");
  assert.equal(wornSection("p", "ivory", "legL"), "cloth");
  assert.equal(wornSection("p", "ivory", "head"), "cloth", "its kettle hat sits above the cut; a padded collar is at it");
  // Korvenia's cuirassier wears steel only on his chest and head: his limbs are wool.
  assert.equal(wornSection("n", "empire", "armR"), "cloth");
  // The bare-headed queen loses her head through flesh, her plated arm through plate.
  assert.equal(wornSection("q", "ivory", "head"), "flesh");
  assert.equal(wornSection("q", "ivory", "foreArmR"), "plate");
  assert.equal(wornSection("q", "ivory", "legR"), "cloth", "her skirt at the hip");
  // Bronze greaves under robes: the Sulfur Oracle's knee is plate, its arm cloth.
  assert.equal(wornSection("b", "sun", "shinL"), "plate");
  assert.equal(wornSection("b", "sun", "armL"), "cloth");
  // Sealed plate: the Furnace Bastion and the Foundry Bulwark; the Charter Holder's gauntlets.
  assert.equal(wornSection("r", "sun", "legR"), "plate");
  assert.equal(wornSection("r", "kwind", "head"), "plate");
  assert.equal(wornSection("q", "kwind", "foreArmL"), "plate");
  assert.equal(wornSection("q", "kwind", "armL"), "cloth");
  // One painted mesh, whatever its material is called: the table's word.
  assert.deepEqual(cutSections([{ name: "char1 Material_1", metalness: 0.55 }], "plate"), ["plate"]);
  assert.deepEqual(cutSections([{ name: "geometry_0 Material_0", metalness: 0.1 }], "mail"), ["mail"]);
});

test("a mesh made as armour says what it is by its name, or by its metal beside the figure's others; the rest is flesh", () => {
  assert.equal(namedSection("Knight_HelmetMat"), "plate");
  assert.equal(namedSection("pauldrons_L"), "plate");
  assert.equal(namedSection("ChainmailHauberk"), "mail");
  assert.equal(namedSection("coif"), "mail");
  assert.equal(namedSection("gambeson.001"), "cloth");
  assert.equal(namedSection("Robe"), "cloth");
  assert.equal(namedSection("Body_Skin"), "flesh");
  assert.equal(namedSection("Material_0"), null);
  assert.equal(namedSection("environment"), null, "a word, not a run of letters");
  // A skin under a named helm is flesh; a gambeson under mail is its own cloth.
  assert.deepEqual(cutSections([{ name: "body Material_0", metalness: 0.1 }, { name: "helm Material_1", metalness: 0.1 }], "cloth"), ["flesh", "plate"]);
  assert.deepEqual(cutSections([{ name: "gambeson", metalness: 0.08 }, { name: "hauberk", metalness: 0.4 }, { name: "body", metalness: 0.08 }], "plate"), ["cloth", "mail", "flesh"]);
  // In its own livery the faction look keeps metal at most 0.4 and cloth at least 0.08: the metal one is plate.
  assert.deepEqual(cutSections([{ name: "a", metalness: 0.08 }, { name: "b", metalness: 0.4 }], "mail"), ["flesh", "plate"]);
  // Every material given the same look tells nothing: the table's word for each.
  assert.deepEqual(cutSections([{ name: "a", metalness: 0.55 }, { name: "b", metalness: 0.55 }], "mail"), ["mail", "mail"]);
  assert.deepEqual(cutSections([{ name: "a", metalness: 0.2 }, { name: "b", metalness: CUT_METAL.plate - 0.01 }], "cloth"), ["cloth", "cloth"]);
});
