/// <reference types="node" />
/**
 * The upper-body layer as PieceView drives it (the charging killer's guard, the witness's guard), on the Aethelgard
 * Pawn's real skeleton and libraries. The figure is put together as combatLibraryProfiles.test.ts does: PieceView's
 * own methods over a real mixer, with no renderer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { COMBAT_LIBRARY_VERSION } from "../../../../shared/play/combat-sequences";
import { loadCombatAnimationLibrary } from "../combatAnimationLibrary";
import { LivingPieceRig } from "../livingPieceRig";
import { PieceView } from "../pieces";
import type { BoardReactionCue } from "../boardReactionDirector";
import { EMOTION_PROFILES } from "../battleEmotion";
import { UpperBodyLayer } from "./upperBodyLayer";
import { smoothWeight } from "./layeredPose";

const chess = resolve(process.cwd(), "src/assets/chess");
const reader = (() => {
  const gltf = new GLTFLoader();
  return { async loadAsync(url: string) {
    const source = /combat-v([12])\/(wp|bp|ep|kp)\.glb/.exec(url);
    if (!source) throw Error("Unexpected animation source: " + url);
    const bytes = readFileSync(resolve(chess, `combat-v${source[1]}/${source[2]}.glb`));
    return gltf.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  } } as unknown as GLTFLoader;
})();
const library = loadCombatAnimationLibrary("wp", reader);

function skeleton(): THREE.Group {
  const nodes = JSON.parse(readFileSync(resolve(chess, "combat-v2/wp-skeleton.json"), "utf8")).nodes as { name: string; parent: string | null; translation?: number[]; rotation?: number[] }[];
  const root = new THREE.Group(), made = new Map<string, THREE.Object3D>();
  for (const node of nodes) {
    const bone = node.name === "Armature" ? new THREE.Object3D() : new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    made.set(node.name, bone);
  }
  for (const node of nodes) (node.parent ? made.get(node.parent)! : root).add(made.get(node.name)!);
  return root;
}

type Inside = { upper: UpperBodyLayer; idleWanted: boolean; activeOneShot: string | null };
async function pawn(options: { library?: boolean } = {}) {
  const model = skeleton(), frame = new THREE.Group(); frame.add(model);
  const living = new LivingPieceRig(frame, model, 0);
  const figure = Object.assign(Object.create(PieceView.prototype), {
    kind: "p", majestic: false, container: new THREE.Group(), visual: frame,
    mixer: new THREE.AnimationMixer(model), variants: new Map(), actions: new Map(), combatVersions: new Map(), combatLibraryVersion: null,
    activeOneShot: null, marchLoop: null, aiming: false, slain: false, downfall: null, stillStance: null, flat: false,
    idleWanted: true, dynamicWanted: true, livingRig: living, contactIK: null, rootBone: null, rootTravels: [], travelling: false,
    upper: new UpperBodyLayer(model), upperId: null, guardHeld: null, lockRootMotion: true, idleLooping: false,
    collider: new THREE.Object3D(), badge: null, hovered: false, selected: false, alarm: 0, guarding: false,
  }) as PieceView;
  if (options.library !== false) figure.installCombatLibrary((await library)!);
  return { figure, inside: figure as unknown as Inside, model };
}

const cue = (pose: BoardReactionCue["pose"], grip: number, extra: Partial<BoardReactionCue> = {}): BoardReactionCue => ({
  target: { x: 0, y: .5, z: 2 }, pose, gaze: .9, flinch: 0, grip, posture: 0, duration: 2, delay: .1, sustained: false, headOnly: false,
  onset: .25, release: .5, ...extra,
});

describe("PieceView's upper-body layer", () => {
  it("raises a v2 Pawn's duel guard over the last steps of a charge and hands it to the blow over the blow's wind-up", async () => {
    const { figure, inside } = await pawn();
    expect(figure.raiseGuard({ delay: .2, fade: .3 })).toBe(true);
    expect(figure.upperBody).toEqual({ clip: "ready.guard", weight: 0, owner: "charge" });
    inside.upper.apply(.35);
    expect(figure.upperBody.weight).toBeCloseTo(smoothWeight(.5), 6);
    inside.upper.apply(.15);
    expect(figure.upperBody.weight).toBeCloseTo(1, 6);
    // The strike, as playAttack starts it: the full-body clip asks the layer to go, the fight says how.
    figure.playVariant("attack.thrust");
    figure.lowerGuardInto(.3);
    inside.upper.apply(.15);
    expect(figure.upperBody.weight).toBeCloseTo(smoothWeight(.5), 6);
    inside.upper.apply(.15);
    expect(figure.upperBody.weight).toBe(0);
    inside.upper.apply(0);
    expect(figure.upperBody.clip).toBeNull();
  });

  it("holds a v1 Pawn's stance at its ready frame, and a figure with no guard holds its blow at the wind-up until it catches up", async () => {
    const { figure, inside } = await pawn();
    expect(figure.selectCombatLibrary(COMBAT_LIBRARY_VERSION)).toBe(true);
    expect(figure.raiseGuard({ fade: 0 })).toBe(true);
    expect(figure.upperBody.clip).toBe("ready.stance");
    expect((inside.upper as unknown as { incoming: { clock: { hold?: number } } }).incoming.clock.hold).toBeCloseTo(.83, 2);
    // No guard clip at all: the blow it strikes with (v1's attack.thrust, ready at 0.27 s), held there.
    const bare = await pawn({ library: false });
    const thrust = (await library)!.versions!.get(COMBAT_LIBRARY_VERSION)!.get("attack.thrust")!;
    bare.figure.installCombatLibrary(Object.assign(new Map([["attack.thrust", thrust]]), { versions: new Map() }));
    expect(bare.figure.raiseGuard({ fade: 0 })).toBe(true);
    expect(bare.figure.upperBody.clip).toBe("attack.thrust");
    bare.inside.upper.apply(1);
    bare.figure.playVariant("attack.thrust");
    bare.figure.lowerGuardInto(.27);
    // Held at full weight until 0.08 s before the wind-up frame, gone on it.
    bare.inside.upper.apply(.18);
    expect(bare.figure.upperBody.weight).toBeCloseTo(1, 6);
    bare.inside.upper.apply(.05);
    expect(bare.figure.upperBody.weight).toBeGreaterThan(0);
    bare.inside.upper.apply(.04);
    expect(bare.figure.upperBody.weight).toBe(0);
  });

  it("raises a wary witness's guard for its look, as far as the feeling reaches it, and lets it go with the look", async () => {
    const { figure, inside } = await pawn();
    const wary = EMOTION_PROFILES.wary.grip;
    figure.applyBoardReaction(cue("wary", wary * .6));
    expect(figure.upperBody.owner).toBe("reaction");
    expect(figure.upperBody.clip).toBe("ready.guard");
    inside.upper.apply(.1); expect(figure.upperBody.weight).toBe(0);
    inside.upper.apply(.25); expect(figure.upperBody.weight).toBeCloseTo(.6, 6);
    // It lets go by itself as the look ends: released over its last half second.
    inside.upper.apply(1.5); expect(figure.upperBody.weight).toBeCloseTo(.6 * smoothWeight(.5), 6);
    inside.upper.apply(.25); expect(figure.upperBody.weight).toBe(0);
    // Any other look lets a raised guard go; so does a cleared one.
    figure.applyBoardReaction(cue("resolve", EMOTION_PROFILES.resolve.grip));
    inside.upper.apply(.5); expect(figure.upperBody.weight).toBeCloseTo(1, 6);
    figure.applyBoardReaction(cue("grief", -.09));
    inside.upper.apply(.16); expect(figure.upperBody.weight).toBeCloseTo(smoothWeight(.5), 6);
    figure.applyBoardReaction(cue("wary", wary));
    figure.clearBoardReaction(true);
    inside.upper.apply(.01); expect(figure.upperBody.weight).toBe(0);
  });

  it("never lays a witness's guard over a fight's, a busy figure, or a figure with its living motion off", async () => {
    const { figure } = await pawn();
    figure.raiseGuard({ fade: 0 });
    figure.applyBoardReaction(cue("wary", 1));
    expect(figure.upperBody.owner).toBe("charge");
    const busy = await pawn();
    busy.inside.activeOneShot = "attack.thrust";
    busy.figure.applyBoardReaction(cue("wary", 1));
    expect(busy.figure.upperBody.clip).toBeNull();
    const still = await pawn();
    still.figure.setDynamicMotionEnabled(false);
    still.figure.applyBoardReaction(cue("wary", 1));
    expect(still.figure.upperBody.clip).toBeNull();
    // A witness that sets off lets its guard go; a killer's charge guard is kept while it marches.
    const walker = await pawn();
    walker.figure.installClip("walk", new THREE.AnimationClip("walk", 1, []));
    walker.figure.applyBoardReaction(cue("wary", 1));
    walker.inside.upper.apply(.5);
    walker.figure.startMarch("walk", 2);
    walker.inside.upper.apply(.21);
    expect(walker.figure.upperBody.weight).toBe(0);
    walker.figure.raiseGuard({ fade: 0 });
    walker.figure.startMarch("walk", 2);
    walker.inside.upper.apply(.21);
    expect(walker.figure.upperBody.weight).toBeCloseTo(1, 6);
  });

  it("holds a guard still where the preset holds the stance still, and drops every layer when the figure dies", async () => {
    const { figure, inside } = await pawn();
    inside.idleWanted = false;
    figure.raiseGuard({ fade: 0 });
    inside.upper.apply(1);
    expect((inside.upper as unknown as { incoming: { clock: { rate: number } } }).incoming.clock.rate).toBe(0);
    figure.playDeath();
    expect(figure.upperBody).toEqual({ clip: null, weight: 0, owner: null });
  });
});
