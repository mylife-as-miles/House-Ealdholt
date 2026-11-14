import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FLARE_SHARE, PHOENIX_BONES, PHOENIX_MODEL, PHOENIX_MODEL_URL, clipShare, modelFlames, strokeRoom } from "../../web/src/scene/rites/phoenix/modelRig";
import { PHOENIX_DOWNSTROKE } from "../../web/src/scene/rites/phoenix/phoenixFlight";
import { PHOENIX_BUDGET } from "../../web/src/scene/rites/phoenix/phoenixForm";
import { sequence } from "../../web/src/scene/vfx/spells/shared/particlePlan";

/** The shipped GLB's JSON, read as data. */
function gltfJson(): { json: any; bytes: number } {
  const file = fileURLToPath(new URL(`../../main game/public/${PHOENIX_MODEL_URL}`, import.meta.url));
  const b = readFileSync(file);
  assert.equal(b.toString("ascii", 0, 4), "glTF");
  const length = b.readUInt32LE(12);
  return { json: JSON.parse(b.toString("utf8", 20, 20 + length)), bytes: b.length };
}

type M = number[];
const mul = (a: M, b: M): M => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let row = 0; row < 4; row += 1) for (let k = 0; k < 4; k += 1) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k]; return r; };
function local(node: any): M {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
    2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
    2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
/** Where every named node is in the GLB's rest pose (the clip's first key). */
function restPositions(json: any): Map<string, [number, number, number]> {
  const parent = new Map<number, number>();
  json.nodes.forEach((node: any, i: number) => (node.children ?? []).forEach((c: number) => parent.set(c, i)));
  const world = (i: number): M => (parent.has(i) ? mul(world(parent.get(i)!), local(json.nodes[i])) : local(json.nodes[i]));
  const out = new Map<string, [number, number, number]>();
  json.nodes.forEach((node: any, i: number) => { if (node.name) { const m = world(i); out.set(node.name, [m[12], m[13], m[14]]); } });
  return out;
}

test("the shipped phoenix: credited, WebP, one skin, its clip, every bone the rite poses, under a megabyte", () => {
  const { json, bytes } = gltfJson();
  assert.ok(bytes < 1_000_000, `${bytes} bytes`);
  assert.match(json.asset.extras.author, /NORBERTO-3D/);
  assert.match(json.asset.extras.license, /CC-BY-4\.0/);
  assert.match(json.asset.extras.source, /sketchfab\.com\/3d-models\/phoenix-bird-844ba0cf144a413ea92c779f18912042/);
  assert.deepEqual(json.extensionsRequired, ["EXT_texture_webp"]);
  for (const image of json.images) assert.equal(image.mimeType, "image/webp");
  assert.equal(json.scenes[json.scene].nodes.length, 1);
  assert.equal(json.nodes[json.scenes[json.scene].nodes[0]].name, "CFCL_Phoenix_Root");
  assert.equal(json.skins.length, 1);
  assert.equal(json.skins[0].joints.length, 89);
  assert.deepEqual(json.animations.map((a: any) => a.name), ["Take 001"]);
  const names = new Set(json.nodes.map((n: any) => n.name));
  const bones = [PHOENIX_BONES.root, PHOENIX_BONES.spine, PHOENIX_BONES.head, PHOENIX_BONES.jaw, PHOENIX_BONES.pelvis, ...PHOENIX_BONES.neck, ...PHOENIX_BONES.tail,
    ...PHOENIX_BONES.wings.flatMap((w) => [...w.arm, ...w.trail]), ...PHOENIX_BONES.legs.flatMap((l) => l.bones), ...PHOENIX_BONES.crest.flat(), ...PHOENIX_BONES.breast.flat(), ...PHOENIX_BONES.plumes.flat()];
  for (const bone of bones) assert.ok(names.has(bone), `no bone ${bone}`);
  const triangles = json.meshes.reduce((sum: number, m: any) => sum + m.primitives.reduce((s: number, p: any) => s + json.accessors[p.indices].count / 3, 0), 0);
  assert.equal(triangles, 2654 + 1410);
});

test("it is turned to the wyvern's frame: its beak +Z, its back +Y, its left wing +X, its trunk at the origin", () => {
  const at = restPositions(gltfJson().json);
  const head = at.get(PHOENIX_BONES.head)!, tail = at.get(PHOENIX_BONES.tail[5])!, neck = at.get(PHOENIX_BONES.neck[0])!, root = at.get(PHOENIX_BONES.tail[0])!;
  assert.ok(head[2] > 2 && tail[2] < -6, `head z ${head[2].toFixed(2)}, tail end z ${tail[2].toFixed(2)}`);
  assert.ok(head[1] > neck[1], "the head above the base of the neck");
  const left = at.get(PHOENIX_BONES.wings[0].arm[0])!, right = at.get(PHOENIX_BONES.wings[1].arm[0])!;
  assert.ok(left[0] > 0.2 && right[0] < -0.2 && Math.abs(left[0] + right[0]) < 0.05, "left wing +X, right -X, either side of the middle");
  const trunk = [(neck[0] + root[0]) / 2, (neck[1] + root[1]) / 2, (neck[2] + root[2]) / 2];
  assert.ok(Math.hypot(trunk[0], trunk[1], trunk[2]) < 0.6, `the trunk's middle ${trunk.map((v) => v.toFixed(2))} off the origin`);
  const feet = PHOENIX_BONES.legs.map((l) => at.get(l.bones[2])!);
  assert.ok(feet.every((f) => f[1] < -1), "the feet hang under it");
});

test("the clip follows the plan's wingbeat: top at the start, lowest where the plan's downstroke ends, level between beats, held up and flared", () => {
  const none = { raise: 0, fold: 0, flare: 0 };
  const at = (phase: number, amount = 1) => clipShare({ amount, phase, power: 1, index: 0 }, none);
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(PHOENIX_DOWNSTROKE) - PHOENIX_MODEL.downstroke) < 1e-9, "lowest together");
  assert.ok(Math.abs(at(1) - 1) < 1e-9);
  let last = at(0);
  for (let p = 0.01; p <= 1; p += 0.01) { const now = at(p); assert.ok(now > last - 1e-9 && now - last < 0.03, `the clip runs on at ${p.toFixed(2)}`); last = now; }
  assert.equal(at(0, 0), PHOENIX_MODEL.level, "level between beats");
  assert.ok(Math.abs(at(0, 0.5) - PHOENIX_MODEL.level / 2) < 1e-9, "eased up into a beat");
  assert.equal(clipShare({ amount: 1, phase: 0.6, power: 1, index: 0 }, { raise: 1, fold: 0, flare: 0 }), 0, "held at the top as it seizes");
  assert.equal(clipShare({ amount: 0, phase: 0, power: 1, index: -1 }, { raise: 0, fold: 0, flare: 1 }), FLARE_SHARE, "flared wide");
});

test("near the board its stroke is drawn in, never under a third of it", () => {
  assert.equal(strokeRoom(20, 1), 1);
  assert.equal(strokeRoom(0, 1), 0.35);
  let last = 0;
  for (let h = 0; h < 12; h += 0.25) { const room = strokeRoom(h, 1); assert.ok(room >= last && room >= 0.35 && room <= 1); last = room; }
  // with the room it is given, the wingtips stay over the board
  for (let h = 2; h < 12; h += 0.25) assert.ok(h - PHOENIX_MODEL.drop * strokeRoom(h, 1) >= PHOENIX_MODEL.floor - 1e-9 || strokeRoom(h, 1) === 0.35);
});

test("its fire stands on its bones: along the wings, the tail and its plumes, the crest, the breast and the thighs", () => {
  const chains = [...PHOENIX_BONES.wings.flatMap((w) => [w.arm, w.trail]), PHOENIX_BONES.tail, ...PHOENIX_BONES.plumes, ...PHOENIX_BONES.crest, ...PHOENIX_BONES.breast, ...PHOENIX_BONES.legs.map((l) => l.bones)];
  for (const tier of ["low", "medium", "high", "ultra"] as const) {
    const count = PHOENIX_BUDGET[tier].blaze, flames = modelFlames(count, sequence(5), 1);
    assert.ok(Math.abs(flames.length - count) <= 14, `${tier}: ${flames.length} flames for ${count}`);
    for (const flame of flames) {
      assert.ok(chains.some((chain) => { const i = chain.indexOf(flame.from as never); return i >= 0 && chain[i + 1] === flame.to; }), `${flame.from} to ${flame.to} is a bone and the next`);
      assert.ok(flame.at >= 0 && flame.at <= 2 && flame.size > 0.5 && flame.size < 2.5);
    }
    const onWings = flames.filter((f) => /_Wing_/.test(f.from)).length;
    assert.ok(onWings >= flames.length * 0.45, `${tier}: ${onWings} of ${flames.length} on the wings`);
  }
});
