/**
 * Aethelgard's summon: the Queen's bonded wyvern, as a rite the match can play (rites/rite.ts).
 *
 * rites/wyvern.ts is the beast and rites/wyvern-path.ts its flight; this hands them to the match in the shape
 * every summon has. The wyvern comes out of the sky behind its Queen, takes the piece in its talons, carries it
 * to a hover, bites, tears, and drops what is left; then it climbs away.
 */
import * as THREE from "three";
import type { Point } from "../vfx/mystic/beamPlan";
import type { RiteCast, RiteEffect, RiteEntry, RiteHold, RiteSound, RiteState, RiteWound } from "./rite";
import { WYVERN_MODEL_URL, createWyvern, type WyvernModel } from "./wyvern";

/** How far behind and above its Queen the wyvern appears, and how far past the victim and how high it leaves. */
const ENTRY = { back: 11, up: 11 };
const EXIT = { on: 17, up: 13 };
/**
 * Where it feeds: over the victim's own square, turned to face the player. It holds its prey in its jaws about
 * 1.7 units ahead of its trunk (measured in a match), so the hover stands that far beyond the square from the
 * player, and low enough that what it lets go drops about three units, not five, and comes to rest on the square.
 */
const HOVER = { up: 4.0, beyond: 1.7 };
/** What the camera keeps in frame while it feeds: the body hanging under it, its back, and most of its wings. */
const FEEDING = { below: 2.6, above: 2.2, wings: 4.5 };

const point = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });

export interface WyvernRiteOptions {
  /** The GLB's address, or the loaded glTF. Defaults to rites/wyvern.ts WYVERN_MODEL_URL under the page's base. */
  model?: string | WyvernModel;
}

/** Makes the wyvern's run for one capture. */
export function makeWyvernRite(cast: RiteCast, options: WyvernRiteOptions = {}): RiteEffect {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const wyvern = createWyvern({ model: options.model ?? `${base}${WYVERN_MODEL_URL}`, floor: cast.boardTop });
  const beats = wyvern.beats("eat");
  const object = new THREE.Group();
  object.name = "WyvernRite";
  object.add(wyvern.group);
  wyvern.group.visible = false;

  // It comes from behind its Queen, along the line from her to the piece, and leaves past it.
  const queen = new THREE.Vector3(cast.queen.x, cast.queen.y, cast.queen.z);
  const chest = cast.chest(new THREE.Vector3());
  const line = chest.clone().sub(queen).setY(0);
  if (line.lengthSq() < 1e-6) line.set(0, 0, -1);
  line.normalize();
  const from = queen.clone().addScaledVector(line, -ENTRY.back).setY(cast.boardTop + ENTRY.up);
  const away = chest.clone().addScaledVector(line, EXIT.on).setY(cast.boardTop + EXIT.up);
  const viewer = new THREE.Vector3(cast.viewer.x, cast.viewer.y, cast.viewer.z);
  const beyond = chest.clone().sub(viewer).setY(0);
  if (beyond.lengthSq() < 1e-6) beyond.copy(line);
  beyond.normalize();
  const hover = new THREE.Vector3(cast.stone.x, cast.boardTop + HOVER.up, cast.stone.z).addScaledVector(beyond, HOVER.beyond);
  const side = new THREE.Vector3(-beyond.z, 0, beyond.x);

  // The three beats the camera watches: the call and the dive, the feeding in the sky, and the fall.
  const queenChest: Point = { x: queen.x, y: cast.boardTop + 1.3, z: queen.z };
  const calling: Point[] = [queenChest, point(chest), { x: chest.x, y: chest.y + 5, z: chest.z }];
  const feeding: Point[] = [
    point(hover.clone().setY(hover.y - FEEDING.below)), point(hover.clone().setY(hover.y + FEEDING.above)),
    point(hover.clone().addScaledVector(side, FEEDING.wings)), point(hover.clone().addScaledVector(side, -FEEDING.wings)),
  ];
  const falling: Point[] = [cast.stone, { x: cast.stone.x, y: cast.boardTop + 1.6, z: cast.stone.z }, point(hover.clone().setY(hover.y - 1.6))];

  let started = false, loaded = false, struck = false, released = false, gone = false;
  let blow: RiteState["blow"] = null;
  let hold: "talons" | "jaws" | null = null;
  let wounds: RiteWound[] = [], sounds: RiteSound[] = [];
  let shake = 0;
  const at = new THREE.Vector3(), turn = new THREE.Quaternion(), up = new THREE.Vector3(), ahead = new THREE.Vector3();
  const here = (): Point => point(wyvern.group.getWorldPosition(at));
  const mouth = (): Point => point(wyvern.jaws.getWorldPosition(at));
  void wyvern.ready.then(() => { loaded = true; }, () => { gone = true; });

  const begin = (): void => {
    started = true;
    wyvern.group.visible = true;
    void wyvern.run({
      from, target: chest, away, carry: "eat", seed: cast.seed, hover, face: viewer,
      events: {
        screech: () => { sounds.push({ cue: "rite.wyvern.screech", at: here(), volume: 1 }); },
        wingbeat: () => { sounds.push({ cue: "rite.wyvern.wingbeat", at: here(), volume: 0.7 }); },
        strike: () => {
          struck = true; hold = "talons";
          blow = { from: here(), power: 1 };
          if (!cast.brief) shake = 0.3;
          wounds.push({ at: point(chest), direction: { x: -line.x * 0.5, y: 0.8, z: -line.z * 0.5 }, power: 1, kind: "pierce" });
          sounds.push({ cue: "rite.wyvern.strike", at: point(chest), volume: 1 });
        },
        bite: () => {
          hold = "jaws";
          wounds.push({ at: mouth(), direction: { x: 0, y: -1, z: 0 }, power: 0.9, kind: "bite" });
          sounds.push({ cue: "rite.wyvern.bite", at: mouth(), volume: 1 });
        },
        tear: (_t, index) => {
          // Thrown to one side and then the other, as the head is.
          const side = index % 2 === 0 ? 1 : -1;
          wounds.push({ at: mouth(), direction: { x: line.z * side, y: -0.35, z: -line.x * side }, power: 1.3, kind: "tear" });
          sounds.push({ cue: "rite.wyvern.tear", at: mouth(), volume: 0.9 });
          if (!cast.brief) shake = Math.max(shake, 0.12);
        },
        release: () => { hold = null; released = true; },
        gone: () => { gone = true; },
      },
    }).catch(() => { gone = true; });
  };

  const held = (): RiteHold | null => {
    if (!hold) return null;
    const socket = hold === "talons" ? wyvern.talons : wyvern.jaws;
    socket.getWorldPosition(at); socket.getWorldQuaternion(turn);
    // The body hangs head-up from the talons, and lies across the jaws as the head turns it.
    up.set(0, 1, 0); ahead.set(0, 0, 1);
    if (hold === "jaws") { up.applyQuaternion(turn); ahead.applyQuaternion(turn); }
    else ahead.set(line.x, 0, line.z);
    return { position: point(at), up: point(up), forward: point(ahead) };
  };

  return {
    object,
    death: "held",
    ready: wyvern.ready,
    strikeAt: beats.strike,
    duration: beats.gone,
    update(seconds) {
      wounds = []; sounds = []; shake = 0;
      if (!started && loaded) begin();
      if (started) wyvern.update(seconds);
      const shot = released ? 2 : struck ? 1 : 0;
      const frame = shot === 2 ? falling : shot === 1 ? feeding : calling;
      return { struck, blow, hold: held(), released, done: gone, wounds, sounds, shake, glow: null, shot, frame };
    },
    setGain() { /* a lit model: the arena's own light and exposure draw it */ },
    dispose() {
      wyvern.dispose();
      object.removeFromParent();
    },
  };
}

/** The entry for the match's table of rites. */
export const WYVERN_RITE: RiteEntry = { id: "aethelgard.queen.wyvern-run", name: "The wyvern", army: "ivory", make: (cast) => makeWyvernRite(cast) };
