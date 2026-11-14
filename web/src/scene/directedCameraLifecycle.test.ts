import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEngine } from "./sceneEngine";
import { MomentDirector } from "./moments/MomentDirector";
import { PairedCombatDirector } from "./pairedCombat";
import { TweenManager } from "./tween";
import { audio } from "../audio/audioManager";
import { directCombat } from "./combat/director";
import { pawnDuelInput } from "./combat/pawnDuel";
import { CATALOG } from "./combat/sequences";
import { CombatFeel } from "./combat/feelLayer";
import type { EffectsSystem, ShakeSystem } from "./effects";
import { readFileSync } from "node:fs";

// What a baked Pawn rig holds: the combat-v2 library the duel is played on, and the combat-v1 clips kept beside it.
const sidecar = (library: string) => (JSON.parse(readFileSync(new URL(`../assets/chess/${library}/wp.json`, import.meta.url), "utf8")) as {
  clips: { id: string; duration: number; markers: { name: string; time: number }[] }[];
}).clips;
const metadata = { clips: [...sidecar("combat-v1"), ...sidecar("combat-v2")] };

/** Actual SceneEngine camera/timeline adapters, observed figures and real
 * session/tween clocks. No WebGL, rendered-scene or animation-art claim. */
function fixture(options: { preparation?: Promise<void> } = {}) {
  vi.spyOn(audio, "cue").mockReturnValue(true);
  vi.spyOn(audio, "bladeWhoosh").mockImplementation(() => {});
  vi.spyOn(audio, "bodyFall").mockImplementation(() => {});
  const clips = new Map(metadata.clips.map(clip => [clip.id, {
    id: clip.id, duration: clip.duration,
    events: Object.fromEntries(clip.markers.map(marker => [marker.name, marker.time])),
  }]));
  function figure(x: number) {
    const container = new THREE.Group(); container.position.set(x, 0, 0);
    return {
      container, kind: "p", color: x < 0 ? "w" : "b", hasAnimations: false, isMarching: false, isSlain: false,
      selectCombatLibrary: () => true, hasCombatVariant: (id: string) => clips.has(id), combatClipInfo: (id: string) => clips.get(id) ?? null,
      preferredContactReach: () => .5, hasClip: () => false, startMarch: () => false,
      playCombatClip: vi.fn(), clearCombatTargets: vi.fn(), setStrikeTilt: vi.fn(), setTravelling: vi.fn(),
      braceForImpact: vi.fn(), faceTowards: vi.fn(), turnTowards: vi.fn(async () => {}),
      stopMarch: vi.fn(), setContactAim: vi.fn(), flinch: vi.fn(), holdContact: vi.fn(), dispose: vi.fn(),
      weaponContact: (out: THREE.Vector3) => out.copy(container.position).add(new THREE.Vector3(0, .4, 0)),
      shieldContact: (out: THREE.Vector3) => out.copy(container.position).add(new THREE.Vector3(0, .4, 0)),
      sampleCombatSocket: (_name: string, out: THREE.Vector3) => out.copy(container.position).add(new THREE.Vector3(0, .4, 0)),
      sampleWeaponSocket: (out: THREE.Vector3) => out.copy(container.position).add(new THREE.Vector3(0, .4, 0)),
      combatPoint: (out: THREE.Vector3) => out.copy(container.position).add(new THREE.Vector3(0, .4, 0)),
      // The feel layer: a figure with no skeleton cannot be sampled, stepped or given a life layer.
      visual: new THREE.Group(), combatOpponent: null, sampleCombatPose: () => [], deathFloorTime: () => null, deathPlan: () => null,
      engageDuel: vi.fn(), onFootDown: vi.fn(), setCombatReaction: vi.fn(), beginStep: () => false, stepTo: vi.fn(), setCombatClipRate: vi.fn(),
      combatClipTime: () => null, driveThrust: vi.fn(), meetWeapon: vi.fn(), lowerGuard: vi.fn(), haltTravel: vi.fn(), weaponLine: () => false,
    };
  }
  const attacker = figure(-1), defender = figure(0), director = new PairedCombatDirector(), tweens = new TweenManager();
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    camera: new THREE.PerspectiveCamera(50), lensFov: 50, boardRevision: 1, conclusionCameraRevision: 0,
    combatDirector: director, tweens, disposed: false, preset: "low", menuPresentation: false,
    pieces: new Map(), motion: new Set([attacker, defender]), captured: [], legalTargets: new Map(), passingVictims: new Map(),
    board: { clearHighlights: vi.fn() }, factory: { isReady: false, getSkins: () => ({ w: "ivory", b: "sun" }) },
    boardReactions: { reset: vi.fn(), setQuality: vi.fn() }, downfall: { cancel: vi.fn(), reset: vi.fn() },
    cancelEndFraming: vi.fn(), lensPunch: (fov: number) => fov, stereoPan: () => 0, silentBoard: () => false,
    armStride: vi.fn(() => options.preparation ?? Promise.resolve()), focusPoint: vi.fn(), wake: vi.fn(), letThemBeg: vi.fn(async () => {}),
    strikeSound: vi.fn(), meleeContact: vi.fn(),
    // This fixture has no arena claimant. Production constructs this owner as a
    // field initializer; Object.create deliberately observes it without WebGL.
    claiming: { held: false, begun: 0, clear: vi.fn() }, returning: new Map(), claimShotOwed: null, rite: null,
    // The gore and death owners the engine makes as fields (Object.create skips them): what killed whom, how much of it shows.
    killedBy: new WeakMap(), kills: new WeakMap(), goreShows: new WeakMap(), forcedDeath: new WeakMap(), lastSpell: new Map(), pierced: new Map(), cried: new WeakSet(),
    // The rest Object.create skips: the moments (hit-stop, grade), the voices, the plies bodies were taken on.
    moments: new MomentDirector(), voices: { interrupt: vi.fn(), moved: vi.fn(), settled: vi.fn(), landed: vi.fn(), restoreSlots: vi.fn() }, takenOn: new WeakMap(),
    effects: { spawnFlash: vi.fn(), spawnBurst: vi.fn(), spawnSmoke: vi.fn(), spawnContact: vi.fn(), clear: vi.fn() }, shake: { add: vi.fn(), kick: vi.fn(), clearKicks: vi.fn() },
    // The combat feel layer as the engine builds it (a fight with board-wide hitstops and a wound-up killing blow).
    combatFeel: new CombatFeel({ effects: { spawnFlash: vi.fn(), spawnBurst: vi.fn() } as unknown as EffectsSystem,
      shake: { kick: vi.fn(), clearKicks: vi.fn() } as unknown as ShakeSystem, group: new THREE.Group(), lowDetail: () => true, reducedMotion: () => false }),
    banish: vi.fn(async () => {}), glide: vi.fn(async () => {}), crumble: vi.fn(async () => {}),
    callbacks: {}, clearing: new Map(), rotateBoard: true, combatHurry: 1, combatKilled: false, duelHandover: false,
    controller: { getSnapshot: () => ({ mode: "ai", status: "playing", turn: "b", fen: "8/8/8/8/8/8/8/8 b - - 0 1", pgn: "", moves: [], sanList: [] }), getBoard: () => [] },
  });
  const pair = director.begin(attacker, defender, () => scene.boardRevision === 1 && !scene.disposed);
  scene.slay = vi.fn(async () => { defender.isSlain = true; await pair.wait(1.7); });
  const plan = directCombat(pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5",
    armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] }),
    [CATALOG.find(sequence => sequence.id === "pawn.thrust-block")!]);
  if (plan.kind !== "sequence") throw new Error(plan.reason);
  const result = Reflect.apply(Reflect.get(SceneEngine.prototype, "playDirectedCombat"), scene,
    [plan, attacker, defender, attacker.container.position.clone(), defender.container.position.clone(), "d5", pair, 1]) as Promise<boolean>;
  const finished = result.then(() => "completed", error => error.name);
  async function advance(seconds: number) {
    for (let remaining = seconds; remaining > 1e-8; remaining -= 1 / 60) {
      const dt = Math.min(1 / 60, remaining); tweens.update(dt); director.update(dt);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
  }
  return { scene, attacker, defender, director, finished, advance };
}

describe("directed combat camera ownership", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cancels the real stage through board rebuild without an old lens reset changing the new board", async () => {
    // Past the end of the timeline (thrust-block runs 3 s), while the body is still falling.
    const f = fixture(); await f.advance(3.1);
    expect(f.attacker.clearCombatTargets).toHaveBeenCalledOnce();
    Reflect.apply(Reflect.get(SceneEngine.prototype, "rebuildPieces"), f.scene, []);
    expect(f.scene.claiming.clear).toHaveBeenCalledOnce();
    f.scene.camera.fov = 70; await f.advance(.6);
    expect(await f.finished).toBe("CombatCancelled");
    expect(f.scene.camera.fov).toBe(70);
  });

  it("retains a user-selected camera while the remaining fight cues run", async () => {
    const f = fixture(); await f.advance(.15);
    f.scene.conclusionCameraRevision += 1; f.scene.camera.fov = 70;
    const shots = f.scene.focusPoint.mock.calls.length;
    await f.advance(1.0);
    expect(f.scene.camera.fov).toBe(70);
    expect(f.scene.focusPoint).toHaveBeenCalledTimes(shots);
    f.scene.boardRevision += 1; f.director.cancelAll(); await f.finished;
  });

  it("never starts old camera or voice cues when stride preparation finishes after a reset", async () => {
    let release!: () => void;
    const preparation = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ preparation });
    Reflect.apply(Reflect.get(SceneEngine.prototype, "rebuildPieces"), f.scene, []);
    f.scene.camera.fov = 70; release(); await f.advance(.1);
    expect(await f.finished).toBe("CombatCancelled");
    expect(f.scene.focusPoint).not.toHaveBeenCalled();
    expect(f.scene.wake).not.toHaveBeenCalled();
    expect(f.scene.letThemBeg).not.toHaveBeenCalled();
  });
});
