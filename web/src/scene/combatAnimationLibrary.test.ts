/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { installCombatMetadataEvents, supportsCombatSource, validateCombatMetadata } from "./combatAnimationLibrary";
import { combatEventTime, plantedAt } from "./animationContacts";
import { PieceFactory } from "./pieces";
import { ARMY_SKINS } from "../assets/generated";

const folder = resolve(process.cwd(), "src/assets/chess/combat-v1");
function originalSkeleton(data: { nodes: { name: string; parent: string | null; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[] }) {
  const root = new THREE.Group(), bones = new Map<string, THREE.Bone>();
  for (const node of data.nodes) {
    const bone = new THREE.Bone(); bone.name = node.name;
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(bone.position, bone.quaternion, bone.scale);
    else {
      if (node.translation) bone.position.fromArray(node.translation);
      if (node.rotation) bone.quaternion.fromArray(node.rotation);
      if (node.scale) bone.scale.fromArray(node.scale);
    }
    bones.set(node.name, bone);
  }
  for (const node of data.nodes) (node.parent ? bones.get(node.parent)! : root).add(bones.get(node.name)!);
  root.updateMatrixWorld(true); return { root, bones };
}

for (const archetype of ["wp", "bp", "ep", "kp"]) describe(`Blender Pawn library ${archetype}`, () => {
  const bytes = readFileSync(resolve(folder, archetype + ".glb"));
  const manifest = JSON.parse(readFileSync(resolve(folder, archetype + ".json"), "utf8"));
  const skeleton = JSON.parse(readFileSync(resolve(folder, archetype + "-skeleton.json"), "utf8"));
  const library = new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");

  it("matches its manifest and contains the requested real clips with exported contact events", async () => {
    expect(bytes.length).toBe(manifest.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
    const source = manifest.sources.find((item: { role: string }) => item.role === "rigged").url;
    expect(supportsCombatSource(archetype, source)).toBe(true);
    expect(supportsCombatSource(archetype, "https://example.test/a-different-pawn-rig.glb")).toBe(false);
    expect(supportsCombatSource("__proto__", source)).toBe(false);
    expect(createHash("sha256").update(readFileSync(resolve(folder, "../../../../../scripts/chess/build_combat_library.py"))).digest("hex")).toBe(manifest.generatorSha256);
    const gltf = await library;
    expect(gltf.animations).toHaveLength(16);
    for (const prefix of ["attack.", "defend.", "hit.", "death."]) expect(gltf.animations.filter(c => c.name.startsWith(prefix))).toHaveLength(3);
    for (let i = 0; i < gltf.animations.length; i++) {
      const clip = gltf.animations[i];
      const metadata = validateCombatMetadata(gltf.parser.json.animations[i].extras.crownfall, archetype, clip);
      installCombatMetadataEvents({ clip, metadata });
      if (clip.name.startsWith("attack.")) expect(combatEventTime(clip, "impact")).toBe(metadata.markers.find(m => m.name === "contact")!.time);
      if (clip.name === "attack.bash-thrust") {
        expect(plantedAt(clip, "left", 0)).toBe(true);
        expect(plantedAt(clip, "left", 10/30)).toBe(false);
        expect(plantedAt(clip, "left", 45/30)).toBe(true);
      }
      expect(metadata).toEqual(manifest.clips.find((item: { id: string }) => item.id === clip.name));
      expect(clip.tracks.every(track => [...track.times, ...track.values].every(Number.isFinite))).toBe(true);
      expect(gltf.parser.json.meshes ?? []).toHaveLength(0);
    }
    const thrust = manifest.clips.find((c: { id: string }) => c.id === "attack.thrust");
    expect(thrust.markers.find((m: { name: string }) => m.name === "contact")).toEqual({ name: "contact", frame: 24, time: .8 });
  });

  it("binds to original bone names and preserves limb translations and scales across every clip", async () => {
    const gltf = await library, model = originalSkeleton(skeleton);
    const mixer = new THREE.AnimationMixer(model.root);
    const position = new Map([...model.bones].map(([name, bone]) => [name, bone.position.clone()]));
    const scale = new Map([...model.bones].map(([name, bone]) => [name, bone.scale.clone()]));
    for (const clip of gltf.animations) {
      for (const track of clip.tracks) expect(model.bones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)).toBe(true);
      const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
      for (const time of [0, clip.duration * .5, clip.duration]) {
        mixer.stopAllAction(); action.reset().play(); mixer.setTime(time);
        for (const [name, bone] of model.bones) {
          if (name !== "Hips") expect(bone.position.distanceTo(position.get(name)!)).toBeLessThan(.0001);
          expect(bone.scale.distanceTo(scale.get(name)!)).toBeLessThan(.0001);
          expect(bone.quaternion.toArray().every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it("contains a shield bash, a lateral feint and genuinely different forward/backward falls", async () => {
    const gltf = await library, model = originalSkeleton(skeleton), mixer = new THREE.AnimationMixer(model.root);
    const sample = (name: string, time: number, bone: string) => {
      mixer.stopAllAction(); const action = mixer.clipAction(gltf.animations.find(c => c.name === name)!);
      action.reset().setLoop(THREE.LoopOnce, 1).play(); action.clampWhenFinished = true; mixer.setTime(time);
      model.root.updateMatrixWorld(true); return model.bones.get(bone)!.getWorldPosition(new THREE.Vector3());
    };
    const restHip = sample("attack.thrust", 0, "Hips"), head = sample("attack.thrust", 0, "Head");
    const height = head.distanceTo(sample("attack.thrust", 0, "LeftFoot"));
    const feintHip = sample("attack.feint-step", 1, "Hips");
    expect(feintHip.distanceTo(restHip)).toBeGreaterThan(height * .05);
    const shieldReady = sample("attack.bash-thrust", 0, "LeftHand"), shieldBash = sample("attack.bash-thrust", 20 / 30, "LeftHand");
    expect(shieldBash.distanceTo(shieldReady)).toBeGreaterThan(height * .1);
    const frontHead = sample("death.front", 51 / 30, "Head"), frontHip = sample("death.front", 51 / 30, "Hips");
    const backHead = sample("death.backward", 57 / 30, "Head"), backHip = sample("death.backward", 57 / 30, "Hips");
    expect(frontHead.z - frontHip.z).toBeGreaterThan(height * .15);
    expect(backHead.z - backHip.z).toBeLessThan(-height * .15);
  });
});


/** Serves every library the loader asks for from its own folder (combat-v1, combat-v2, combat-ranks), by its URL. */
function serveLibraries(downloaded: string[]) {
  return vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async source => {
    const [library, name] = source.split("/").slice(-2);
    downloaded.push(`${library}/${name}`);
    const bytes = readFileSync(resolve(folder, "..", library, name));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  });
}

it("keeps authored Pawn clips on their kingdom's skeleton when the two sides swap armies", async () => {
  const downloaded: string[] = [];
  // Both of a kingdom's Pawn libraries are fetched, the v2 duel library first; each from its own folder.
  const load = serveLibraries(downloaded);
  const factory = new PieceFactory();
  const installed: string[] = [];
  factory.setSkins({ w: "sun", b: "ivory" });
  const templates = Reflect.get(factory, "templates") as Map<string, unknown>;
  const sources = Reflect.get(factory, "clipSources") as Map<string, unknown>;
  templates.set("wp", { combat: "bp", skinned: true, scene: new THREE.Group() });
  templates.set("bp", { combat: "wp", skinned: true, scene: new THREE.Group() });
  sources.set("wp", ARMY_SKINS.sun.animated.p);
  sources.set("bp", ARMY_SKINS.ivory.animated.p);
  // Each side's Pawn gets its own kingdom's rig's library, with the v2 duel profile and the v1 clips kept beside it.
  factory.onCombatLibrary((keys, library) => installed.push(`${keys[0]}:${library.get("attack.thrust")!.metadata.archetype}:${[...library.versions!.keys()].join("+")}`));
  try {
    await factory.ensureCombatLibrary("w", "p");
    await factory.ensureCombatLibrary("b", "p");
    expect(downloaded).toEqual(["combat-v2/bp.glb", "combat-v1/bp.glb", "combat-v2/wp.glb", "combat-v1/wp.glb"]);
    expect(installed).toEqual(["wp:bp:crownfall-pawn-combat-2+crownfall-pawn-combat-1", "bp:wp:crownfall-pawn-combat-2+crownfall-pawn-combat-1"]);
  } finally { factory.dispose(); load.mockRestore(); }
});

it("keeps a Knight's rank library on its own figure's rig when the two sides swap armies", async () => {
  const downloaded: string[] = [];
  const load = serveLibraries(downloaded);
  const factory = new PieceFactory();
  const installed: string[] = [];
  factory.setSkins({ w: "sun", b: "ivory" });
  const templates = Reflect.get(factory, "templates") as Map<string, unknown>;
  const sources = Reflect.get(factory, "clipSources") as Map<string, unknown>;
  templates.set("wn", { combat: "bn", skinned: true, scene: new THREE.Group() });
  templates.set("bn", { combat: "wn", skinned: true, scene: new THREE.Group() });
  sources.set("wn", ARMY_SKINS.sun.animated.n);
  sources.set("bn", ARMY_SKINS.ivory.animated.n);
  factory.onCombatLibrary((keys, library) => installed.push(`${keys[0]}:${library.get("attack.strike")!.metadata.archetype}:${library.get("defend.block") ? "guard" : "none"}`));
  try {
    await factory.ensureCombatLibrary("w", "n");
    await factory.ensureCombatLibrary("b", "n");
    expect(downloaded).toEqual(["combat-ranks/bn.glb", "combat-ranks/wn.glb"]);
    expect(installed).toEqual(["wn:bn:guard", "bn:wn:guard"]);
  } finally { factory.dispose(); load.mockRestore(); }
});

it("does not bind a sword Pawn library to the gunpowder army's distinct rig", async () => {
  const load = vi.spyOn(GLTFLoader.prototype, "loadAsync");
  const factory = new PieceFactory();
  factory.setSkins({ w: "empire", b: "ivory" });
  (Reflect.get(factory, "templates") as Map<string, unknown>).set("wp", { combat: "wp", skinned: true, scene: new THREE.Group() });
  (Reflect.get(factory, "clipSources") as Map<string, unknown>).set("wp", ARMY_SKINS.empire.animated.p);
  try {
    await factory.ensureCombatLibrary("w", "p");
    expect(load).not.toHaveBeenCalled();
  } finally { factory.dispose(); load.mockRestore(); }
});
