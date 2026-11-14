/**
 * Rank combat libraries (web/src/assets/chess/combat-ranks): one per Knight, Rook and King rig, baked by
 * scripts/chess/build_rank_combat_library.py from each figure's own strike and death and from the Meshy actions
 * bought for it.
 *
 * The GLBs are read straight from disk and pushed through the runtime's own validators (`validateCombatMetadata`,
 * `validateCombatTracks`, `installCombatMetadataEvents`, `supportsCombatSource`), so this fails the moment a library
 * stops being loadable by the engine, or stops matching the rig, the generator or the provenance it was baked from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as THREE from "three";
import {
  COMBAT_RANK_LIBRARY_VERSION, installCombatMetadataEvents, supportsCombatSource, validateCombatMetadata, validateCombatTracks,
  type CombatClipMetadata,
} from "../../web/src/scene/combatAnimationLibrary";
import { combatEventTime } from "../../web/src/scene/animationContacts";
import { RANK_ARCHETYPES, RANK_LIBRARY_CLIPS } from "../../web/src/scene/combat/rankDuel";

const file = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)));
const folder = "web/src/assets/chess/combat-ranks";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** A checkout may turn the scripts' line ends to CRLF; the generator hashes them with LF, and so does this. */
const lf = (bytes: Buffer) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");

interface Track { name: string; node: string; path: string; times: Float32Array; values: Float32Array; getValueSize(): number }
interface Clip { name: string; duration: number; tracks: Track[]; extras: unknown }

/** Minimal GLB animation reader: the same channels three's GLTFLoader binds. */
function readLibrary(bytes: Buffer): { clips: Clip[]; meshes: number; nodes: { name: string }[] } {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const jsonLength = bytes.readUInt32LE(12), doc = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const read = (index: number): Float32Array => {
    const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView];
    assert.equal(accessor.componentType, 5126);
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type as "SCALAR" | "VEC3" | "VEC4"];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), out = new Float32Array(accessor.count * width);
    for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(offset + i * 4);
    return out;
  };
  const clips = (doc.animations as { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[]; extras?: { crownfall?: unknown } }[]).map(animation => {
    const tracks: Track[] = animation.channels.map(channel => {
      const sampler = animation.samplers[channel.sampler], node = doc.nodes[channel.target.node].name as string, path = channel.target.path;
      const size = path === "rotation" ? 4 : 3;
      return { name: `${node}.${path === "translation" ? "position" : path === "rotation" ? "quaternion" : path}`, node, path,
        times: read(sampler.input), values: read(sampler.output), getValueSize: () => size };
    });
    const duration = Math.max(...tracks.map(track => track.times[track.times.length - 1]));
    return { name: animation.name, duration, tracks, extras: animation.extras?.crownfall };
  });
  return { clips, meshes: (doc.meshes ?? []).length, nodes: doc.nodes };
}
const asClip = (clip: Clip) => clip as unknown as THREE.AnimationClip;

const provenance = JSON.parse(file(`${folder}/provenance.json`).toString("utf8"));
const archetypes = Object.values(RANK_ARCHETYPES).flatMap(kinds => Object.values(kinds));

test("every rank figure the duel names has a library, and only those", () => {
  assert.deepEqual([...archetypes].sort(), Object.keys(provenance.figures).sort());
  assert.deepEqual([...archetypes].sort(), Object.keys(RANK_LIBRARY_CLIPS).sort());
});

for (const archetype of archetypes) {
  const bytes = file(`${folder}/${archetype}.glb`);
  const manifest = JSON.parse(file(`${folder}/${archetype}.json`).toString("utf8"));
  const skeleton = JSON.parse(file(`${folder}/${archetype}-skeleton.json`).toString("utf8"));
  const library = readLibrary(bytes);

  test(`combat-ranks ${archetype}: matches its manifest, generator, provenance and the pinned rig`, () => {
    assert.equal(manifest.version, COMBAT_RANK_LIBRARY_VERSION);
    assert.equal(manifest.archetype, archetype);
    assert.equal(bytes.length, manifest.bytes);
    assert.equal(sha256(bytes), manifest.sha256);
    const generator = Buffer.concat(["build_rank_combat_library.py", "combat_retarget.py"].map(name => lf(file(`scripts/chess/${name}`))));
    assert.equal(sha256(generator), manifest.generatorSha256, "rebake every rank library after changing the generator or combat_retarget.py");
    assert.equal(sha256(file(`${folder}/provenance.json`)), manifest.provenanceSha256);
    const rig = manifest.sources.find((item: { role: string }) => item.role === "rigged");
    assert.equal(supportsCombatSource(archetype, rig.url), true, "the library serves exactly the rig it was baked for");
    assert.equal(supportsCombatSource(archetype, "https://example.test/another-rig.glb"), false);
    assert.equal(rig.sha256, skeleton.sourceSha256);
    assert.equal(rig.sha256, provenance.figures[archetype].rig.sha256);
    assert.equal(library.meshes, 0, "clips only: no meshes or textures");
  });

  test(`combat-ranks ${archetype}: every clip loads through the runtime validators with its markers`, () => {
    assert.deepEqual(library.clips.map(clip => clip.name), RANK_LIBRARY_CLIPS[archetype]);
    const ids = new Set<string>();
    for (const clip of library.clips) {
      validateCombatTracks(asClip(clip));
      const metadata: CombatClipMetadata = validateCombatMetadata(clip.extras, archetype, asClip(clip), COMBAT_RANK_LIBRARY_VERSION);
      assert.ok(!ids.has(metadata.id)); ids.add(metadata.id);
      installCombatMetadataEvents({ clip: asClip(clip), metadata });
      assert.deepEqual(metadata, manifest.clips.find((item: { id: string }) => item.id === clip.name));
      const marker = (name: string) => metadata.markers.find(item => item.name === name);
      if (clip.name === "attack.strike") {
        assert.equal(combatEventTime(asClip(clip), "impact"), marker("contact")!.time);
        assert.ok(marker("ready")!.time < marker("contact")!.time, "ready comes before the blow");
        const clash = marker("clash");
        if (clash) assert.ok(clash.time < marker("contact")!.time, "the first swing comes before the second");
      }
      if (clip.name.startsWith("defend.")) assert.ok(marker("guard"), `${clip.name} has its guard frame`);
      if (clip.name.startsWith("hit.") || clip.name.startsWith("death.")) assert.ok(marker("hit"), `${clip.name} has its hit frame`);
      if (clip.name.startsWith("death.")) assert.ok(marker("land")!.time > marker("hit")!.time, `${clip.name} lands after it is hit`);
    }
    assert.equal([...ids].filter(id => id.startsWith("death.")).length >= 1, true);
  });

  test(`combat-ranks ${archetype}: binds to the rig's own bone names and keeps every limb at the rig's length`, () => {
    const rest = new Map(skeleton.nodes.map((node: { name: string; translation: number[]; scale: number[] }) => [node.name, node]));
    assert.deepEqual(library.nodes.map(node => node.name).sort(), [...rest.keys()].sort());
    for (const clip of library.clips) {
      for (const track of clip.tracks) {
        const node = rest.get(track.node) as { translation: number[]; scale: number[] } | undefined;
        assert.ok(node, `${clip.name}: ${track.node} is a joint of the rig`);
        if (track.path === "scale" || (track.path === "translation" && track.node !== "Hips")) {
          const expected = track.path === "scale" ? node.scale : node.translation;
          for (let i = 0; i < track.values.length; i += 3) {
            for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(track.values[i + axis] - expected[axis]) < 1e-3, `${clip.name}: ${track.name} moves`);
          }
        }
        assert.ok([...track.times, ...track.values].every(Number.isFinite));
      }
    }
  });
}

test("the Meshy purchase and the clips moved from it are recorded with their task, actions and licence", () => {
  for (const [archetype, entry] of Object.entries(provenance.figures) as [string, { purchase?: { task: string; actions: { actionId: number; clip: string }[]; licence: string }; moved?: { fromFigure: string; task: string } }][]) {
    if (entry.purchase) {
      assert.match(entry.purchase.task, /^[0-9a-f-]{36}$/);
      assert.ok(entry.purchase.actions.length > 0 && entry.purchase.licence.length > 0);
      for (const action of entry.purchase.actions) assert.ok(Number.isInteger(action.actionId));
    }
    if (entry.moved) assert.equal(entry.moved.task, (provenance.figures[entry.moved.fromFigure] as { purchase: { task: string } }).purchase.task, archetype);
  }
});
