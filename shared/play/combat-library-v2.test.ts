/**
 * Pawn combat library v2 (web/src/assets/chess/combat-v2): CC0 animations
 * retargeted onto the two pinned Pawn rigs. Published beside v1 for the Combat
 * Director; nothing loads it yet.
 *
 * The GLBs are read straight from disk and pushed through the runtime's own
 * validators (`validateCombatMetadata`, `validateCombatTracks`,
 * `installCombatMetadataEvents`, `supportsCombatSource`), so this fails the
 * moment the library stops being loadable by the engine.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as THREE from "three";
import { COMBAT_LIBRARY_VERSION } from "./combat-sequences";
import {
  COMBAT_LIBRARY_V2_VERSION, installCombatMetadataEvents, supportsCombatSource, validateCombatMetadata, validateCombatTracks,
  type CombatClipMetadata,
} from "../../web/src/scene/combatAnimationLibrary";
import { combatEventTime, plantedAt } from "../../web/src/scene/animationContacts";

const file = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)));
const folder = "web/src/assets/chess/combat-v2";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface Track { name: string; node: string; path: string; times: Float32Array; values: Float32Array; getValueSize(): number }
interface Clip { name: string; duration: number; tracks: Track[]; extras: unknown }

/** Minimal GLB animation reader: the same channels three's GLTFLoader binds. */
function readLibrary(bytes: Buffer): { clips: Clip[]; meshes: number; nodes: { name: string; children?: number[]; translation?: number[]; scale?: number[] }[] } {
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
  const clips = (doc.animations as any[]).map(animation => {
    const tracks: Track[] = animation.channels.map((channel: any) => {
      const sampler = animation.samplers[channel.sampler], node = doc.nodes[channel.target.node].name as string, path = channel.target.path as string;
      const size = path === "rotation" ? 4 : 3;
      return { name: `${node}.${path === "translation" ? "position" : path === "rotation" ? "quaternion" : path}`, node, path,
        times: read(sampler.input), values: read(sampler.output), getValueSize: () => size };
    });
    const duration = Math.max(...tracks.map(track => track.times[track.times.length - 1]));
    return { name: animation.name as string, duration, tracks, extras: animation.extras?.crownfall };
  });
  return { clips, meshes: (doc.meshes ?? []).length, nodes: doc.nodes };
}
const asClip = (clip: Clip) => clip as unknown as THREE.AnimationClip;
const sample = (track: Track, time: number): number[] => {
  const size = track.getValueSize();
  let i = 0; while (i + 1 < track.times.length && track.times[i + 1] <= time + 1e-6) i++;
  return [...track.values.subarray(i * size, i * size + size)];
};

/** What the Combat Director asked for, per rig. */
const REQUIRED = [
  "attack.bash", "attack.thrust", "attack.jab", "ready.windup", "ready.feint",
  "ready.guard", "defend.block-high", "defend.block-mid", "defend.parry", "defend.dodge-left", "defend.dodge-right", "defend.dodge-back",
  "hit.recoil", "hit.stagger-light", "hit.stagger-heavy", "hit.front", "hit.back", "hit.left", "hit.right",
  "ready.step-forward", "ready.step-back",
  "death.forward", "death.backward", "death.left", "death.right", "death.collapse",
  "recovery.victory", "recovery.settle",
];

for (const archetype of ["wp", "bp", "ep", "kp"]) {
  const bytes = file(`${folder}/${archetype}.glb`);
  const manifest = JSON.parse(file(`${folder}/${archetype}.json`).toString());
  const skeleton = JSON.parse(file(`${folder}/${archetype}-skeleton.json`).toString());
  const sockets = JSON.parse(file("web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json").toString()).archetypes[archetype];
  const library = readLibrary(bytes);
  const squaresPerMetre: number = sockets.normalizationScale;
  const armatureScale: number = skeleton.nodes.find((n: { name: string }) => n.name === "Armature").scale[0];
  // A v2 library serves exactly the rig it was baked from. Should a kingdom's Pawn be regenerated and its v2 library
  // wait for a rebake, these checks are skipped with the reason, never passed. (All four are current: Solforiz's was
  // rebaked on the Ash Legionnaire, Korvenia's and Kwind-09's were first baked, on 10 November 2026.)
  const pinned = manifest.sources.find((item: { role: string }) => item.role === "rigged").url;
  const skip = supportsCombatSource(archetype, pinned) ? false : `combat-v2 ${archetype} awaits a rebake on its kingdom's regenerated Pawn rig`;

  test(skip ? `combat-v2 ${archetype}: refuses the archived bake for its actual regenerated body` : `combat-v2 ${archetype}: matches its manifest, generator, provenance and the pinned rig`, () => {
    if (skip) {
      const v1 = JSON.parse(file(`web/src/assets/chess/combat-v1/${archetype}.json`).toString());
      const currentRig = v1.sources.find((item: { role: string }) => item.role === "rigged");
      const archivedRig = manifest.sources.find((item: { role: string }) => item.role === "rigged");
      assert.equal(supportsCombatSource(archetype, archivedRig.url), false);
      assert.equal(supportsCombatSource(archetype, currentRig.url), true);
      assert.notEqual(archivedRig.sha256, currentRig.sha256);
      assert.notEqual(archivedRig.url, currentRig.url);
      assert.equal(sha256(file(`main game/public${currentRig.url}`)), currentRig.sha256, "the replacement body bytes match its own v1 source proof");
      assert.equal(sha256(bytes), manifest.sha256, "the archived artifact remains intact, not relabelled as a retarget");
      return;
    }
    assert.equal(manifest.version, COMBAT_LIBRARY_V2_VERSION);
    assert.notEqual(COMBAT_LIBRARY_V2_VERSION, COMBAT_LIBRARY_VERSION);
    assert.equal(bytes.length, manifest.bytes);
    assert.equal(sha256(bytes), manifest.sha256);
    const generator = Buffer.concat(["build_combat_library_v2.py", "combat_retarget.py", "build_combat_library.py"].map(name => file(`scripts/chess/${name}`)));
    assert.equal(sha256(generator), manifest.generatorSha256, "rebake both rigs after changing the generator");
    assert.equal(sha256(file(`${folder}/provenance.json`)), manifest.provenanceSha256);
    assert.equal(sha256(file("web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json")), manifest.socketSourceSha256);
    const rig = manifest.sources.find((item: { role: string }) => item.role === "rigged");
    assert.equal(supportsCombatSource(archetype, rig.url), true, "v2 serves the same pinned rigs as v1");
    assert.equal(supportsCombatSource(archetype, "https://example.test/a-different-pawn-rig.glb"), false);
    assert.equal(rig.sha256, skeleton.sourceSha256);
    assert.equal(rig.sha256, sockets.sourceSha256);
    const v1 = JSON.parse(file(`web/src/assets/chess/combat-v1/${archetype}.json`).toString());
    assert.deepEqual(manifest.sources, v1.sources, "same source rigs as v1");
    assert.equal(library.meshes, 0, "clips only: no meshes or textures");
  });

  test(`combat-v2 ${archetype}: stored clips pass format validators and install events`, () => {
    assert.equal(library.clips.length, manifest.clips.length);
    const ids = new Set<string>();
    for (const clip of library.clips) {
      validateCombatTracks(asClip(clip));
      const metadata = validateCombatMetadata(clip.extras, archetype, asClip(clip), COMBAT_LIBRARY_V2_VERSION);
      assert.throws(() => validateCombatMetadata(clip.extras, archetype, asClip(clip)), "v1's version must not accept a v2 clip");
      assert.throws(() => validateCombatMetadata(clip.extras, archetype === "wp" ? "bp" : "wp", asClip(clip), COMBAT_LIBRARY_V2_VERSION));
      installCombatMetadataEvents({ clip: asClip(clip), metadata });
      assert.equal(ids.has(metadata.id), false, "duplicate clip id"); ids.add(metadata.id);
      const listed = manifest.clips.find((item: { id: string }) => item.id === clip.name);
      assert.deepEqual(JSON.parse(JSON.stringify(clip.extras)), listed, "embedded extras equal the sidecar");
      const names = metadata.markers.map(marker => marker.name);
      assert.equal(names.includes("start") && names.includes("end"), true);
      assert.equal(metadata.markers.find(m => m.name === "end")!.frame, Math.round(metadata.duration * metadata.fps));
      if (clip.name.startsWith("attack.")) {
        const contact = metadata.markers.find(m => m.name === "contact")!;
        assert.equal(combatEventTime(asClip(clip), "impact"), contact.time);
        assert.ok(contact.frame > 0 && contact.time < metadata.duration, "contact lies inside the motion");
        assert.ok(names.indexOf("ready") >= 0 && metadata.markers.find(m => m.name === "ready")!.frame < contact.frame, "wind-up precedes contact");
      }
      if (clip.name.startsWith("death.")) assert.ok(names.includes("land") && names.includes("hit"), `${clip.name} needs hit and land`);
      if (clip.name.startsWith("defend.block-") || clip.name === "defend.parry") assert.ok(names.includes("guard") || names.includes("hit"));
      if (clip.name.startsWith("defend.dodge-")) assert.ok(names.includes("evade"));
    }
    for (const id of REQUIRED) assert.ok(ids.has(id), `missing ${id}`);
  });

  test(`combat-v2 ${archetype}: stored clips retain their archived original joints and pelvis-only travel`, () => {
    const rest = new Map<string, { translation?: number[]; scale?: number[] }>(skeleton.nodes.map((n: { name: string }) => [n.name, n]));
    for (const clip of library.clips) for (const track of clip.tracks) {
      assert.ok(rest.has(track.node), `${clip.name}: ${track.node} is not a Pawn joint`);
      const size = track.getValueSize(), expected = track.path === "scale" ? rest.get(track.node)!.scale ?? [1, 1, 1] : rest.get(track.node)!.translation ?? [0, 0, 0];
      for (let i = 0; i < track.values.length; i += size) {
        if (track.path === "rotation") {
          assert.ok(Math.abs(Math.hypot(...track.values.subarray(i, i + 4)) - 1) < 1e-3, "unit quaternions");
        } else if (track.path === "scale" || track.node !== "Hips") {
          for (let k = 0; k < 3; k++) assert.ok(Math.abs(track.values[i + k] - expected[k]) < 1e-3 * Math.max(1, Math.abs(expected[k])), `${clip.name}: ${track.name} moved`);
        }
      }
    }
  });

  test(`combat-v2 ${archetype}: markers and root travel describe the archived baked motion`, () => {
    const meta = (id: string) => manifest.clips.find((item: { id: string }) => item.id === id) as CombatClipMetadata & {
      rootTravel: { net: number[]; track: number[][] }; land?: { frame: number; pelvisHeight: number; torsoHeight: number }; contact?: { anchor: string; squares: number[] }; source: { pack: string; clip: string }; derived?: string; loop: boolean };
    const hips = (id: string, time: number) => sample(library.clips.find(c => c.name === id)!.tracks.find(t => t.node === "Hips" && t.path === "translation")!, time).map(v => v * armatureScale);
    for (const item of manifest.clips) {
      const m = meta(item.id), start = hips(item.id, 0), end = hips(item.id, m.duration);
      // recorded travel is the pelvis's horizontal displacement, in squares (side, along)
      assert.ok(Math.abs((end[0] - start[0]) * squaresPerMetre - m.rootTravel.net[0]) < 2e-3, `${item.id} side travel`);
      assert.ok(Math.abs((end[2] - start[2]) * squaresPerMetre - m.rootTravel.net[1]) < 2e-3, `${item.id} forward travel`);
      assert.equal(m.rootTravel.track.length, Math.round(m.duration * m.fps) + 1);
      assert.ok(["ual1", "ual2", "kaykit"].includes(m.source.pack), "every clip names its CC0 source");
    }
    // dodges clear at least a quarter of a square, in the direction they are named for
    assert.ok(meta("defend.dodge-left").rootTravel.net[0] >= .25);
    assert.ok(meta("defend.dodge-right").rootTravel.net[0] <= -.25);
    assert.ok(meta("defend.dodge-back").rootTravel.net[1] <= -.25);
    assert.ok(meta("ready.step-forward").rootTravel.net[1] > .15 && meta("ready.step-back").rootTravel.net[1] < -.15);
    // falls: standing at the start, pelvis on the board at `land` and after; direction as named
    const standing = hips("death.forward", 0)[1];
    for (const id of ["death.forward", "death.backward", "death.left", "death.right", "death.collapse"]) {
      const m = meta(id), land = m.markers.find(marker => marker.name === "land")!;
      assert.ok(land.frame > 3 && land.time < m.duration, `${id}: land inside the clip`);
      assert.ok(hips(id, 0)[1] > .8 * standing, `${id} starts standing`);
      // land = first pelvis or torso ground contact, measured on the bake
      assert.ok(Math.abs(hips(id, land.time)[1] - m.land!.pelvisHeight) < 2e-3, `${id}: recorded pelvis height is the baked one`);
      assert.ok(Math.min(m.land!.pelvisHeight, m.land!.torsoHeight) < .3, `${id}: pelvis or torso is on the board at land`);
      assert.ok(hips(id, land.time)[1] < .7 * standing, `${id}: already falling at land`);
      assert.ok(hips(id, m.duration)[1] < .3 * standing, `${id} ends on the board`);
    }
    assert.ok(meta("death.forward").rootTravel.net[1] > .1 && meta("death.backward").rootTravel.net[1] < -.1);
    assert.ok(meta("death.left").rootTravel.net[0] > .1 && meta("death.right").rootTravel.net[0] < -.1);
    // attacks say where the weapon or shield meets the opponent
    assert.equal(meta("attack.thrust").contact!.anchor, "weaponTip");
    assert.equal(meta("attack.jab").contact!.anchor, "weaponTip");
    assert.equal(meta("attack.bash").contact!.anchor, "shieldFace");
    assert.ok(meta("attack.thrust").contact!.squares[2] > meta("attack.bash").contact!.squares[2], "the spear outreaches the shield");
    // foot events come from the baked foot locks
    const guard = library.clips.find(c => c.name === "ready.guard")!;
    assert.equal(plantedAt(asClip(guard), "left", 0), true);
    assert.equal(plantedAt(asClip(guard), "right", 1), true);
    const step = library.clips.find(c => c.name === "ready.step-forward")!;
    const lifts = meta("ready.step-forward").markers.filter(marker => /^foot_(left|right)_lift$/.test(marker.name));
    assert.ok(lifts.length >= 2, "a step lifts both feet");
    assert.equal(plantedAt(asClip(step), lifts[0].name.includes("left") ? "left" : "right", lifts[0].time + 1 / 30), false);
    // loops are flagged; derived directions are declared, never passed off as authored
    assert.equal(meta("ready.guard").loop && meta("recovery.settle").loop, true);
    for (const id of ["hit.back", "hit.left", "hit.right", "death.left", "death.right"]) assert.equal(typeof meta(id).derived, "string", `${id} must declare its derivation`);
    assert.equal(manifest.clips.filter((item: { derived?: string }) => item.derived).length, 5);
  });
}

test("combat-v2 provenance: every pack is CC0, hashed and carries its licence text", () => {
  const provenance = JSON.parse(file(`${folder}/provenance.json`).toString());
  assert.equal(provenance.library, COMBAT_LIBRARY_V2_VERSION);
  assert.deepEqual(provenance.packs.map((pack: { id: string }) => pack.id), ["ual1", "ual2", "kaykit"]);
  for (const pack of provenance.packs) {
    assert.equal(pack.licence.name, "CC0 1.0 Universal");
    assert.match(pack.licence.text, /creativecommons\.org\/publicdomain\/zero\/1\.0/);
    assert.match(pack.download.sha256, /^[a-f0-9]{64}$/);
    assert.match(pack.download.endpoint, /^https:\/\/[a-z0-9-]+\.itch\.io\//);
    assert.ok(pack.licence.verified.length >= 2, "licence checked on the source page and in the archive");
    for (const item of pack.files) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  }
  const used = new Set(provenance.packs.flatMap((pack: { files: { path: string; used: boolean }[] }) => pack.files.filter(item => item.used).map(item => item.path)));
  for (const archetype of ["wp", "bp", "ep", "kp"]) for (const clip of JSON.parse(file(`${folder}/${archetype}.json`).toString()).clips) assert.ok(used.has(clip.source.file), `${clip.id}: ${clip.source.file} is not in the provenance manifest`);
  assert.equal(provenance.inspectedNotUsed.every((item: { used: boolean }) => item.used === false), true);
});
