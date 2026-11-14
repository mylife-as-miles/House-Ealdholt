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
import { lineNormal } from "./combat/duelCamera";
import { squareToWorld } from "./board";
import { readFileSync } from "node:fs";

// What a baked Pawn rig holds: the combat-v2 library the duel is played on, and the combat-v1 clips kept beside it.
const sidecar = (library: string) => (JSON.parse(readFileSync(new URL(`../assets/chess/${library}/wp.json`, import.meta.url), "utf8")) as {
  clips: { id: string; duration: number; markers: { name: string; time: number }[] }[];
}).clips;
const metadata = { clips: [...sidecar("combat-v1"), ...sidecar("combat-v2")] };
const HOME = { position: new THREE.Vector3(0.3, 8.6, 9.4), target: new THREE.Vector3(0.1, 0.2, -0.3), fov: 46 };
const ORBIT_MIN = 4.5;
const engine = <T>(name: string, scene: unknown, ...args: unknown[]) => Reflect.apply(Reflect.get(SceneEngine.prototype, name), scene, args) as T;

/** The real SceneEngine fight host, duel camera and board rebuild on real
 * session and tween clocks, in the manner of directedCameraLifecycle.test.ts.
 * e4 takes d5. No WebGL: nothing here is a claim about the rendered picture. */
function fixture(options: { set?: Record<string, unknown> } = {}) {
  vi.spyOn(audio, "cue").mockReturnValue(true);
  vi.spyOn(audio, "bladeWhoosh").mockImplementation(() => {});
  vi.spyOn(audio, "bodyFall").mockImplementation(() => {});
  const clips = new Map(metadata.clips.map(clip => [clip.id, {
    id: clip.id, duration: clip.duration,
    events: Object.fromEntries(clip.markers.map(marker => [marker.name, marker.time])),
  }]));
  function figure(at: THREE.Vector3, color: "w" | "b") {
    const container = new THREE.Group(); container.position.copy(at);
    return {
      container, visual: new THREE.Group(), kind: "p", color, hasAnimations: false, isMarching: false, isSlain: false,
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
      combatOpponent: null, sampleCombatPose: () => [], deathFloorTime: () => null, deathPlan: () => null,
      engageDuel: vi.fn(), onFootDown: vi.fn(), setCombatReaction: vi.fn(), beginStep: () => false, stepTo: vi.fn(), setCombatClipRate: vi.fn(),
      combatClipTime: () => null, driveThrust: vi.fn(), meetWeapon: vi.fn(), lowerGuard: vi.fn(), haltTravel: vi.fn(), weaponLine: () => false,
    };
  }
  const from = squareToWorld("e4"), to = squareToWorld("d5");
  const attacker = figure(from, "w"), defender = figure(to, "b"), director = new PairedCombatDirector(), tweens = new TweenManager();
  const camera = new THREE.PerspectiveCamera(HOME.fov, 16 / 9);
  camera.position.copy(HOME.position);
  const controls = { target: HOME.target.clone(), enabled: true, minDistance: ORBIT_MIN };
  const bystanders = ["d2", "c7", "e7", "d8", "d1"].map(square => [square, figure(squareToWorld(square), square[1] > "4" ? "b" : "w")] as const);
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    camera, controls, lensFov: HOME.fov, boardRevision: 1, conclusionCameraRevision: 0,
    combatDirector: director, tweens, disposed: false, preset: "low",
    captureCinematics: true, reducedMotion: false, tactical: false, menuPresentation: false, attract: false,
    introPlaying: false, interactive: true, cameraScripted: false, conclusionViewActive: false, duelCamera: null,
    pieces: new Map(bystanders), motion: new Set([attacker, defender]), captured: [], legalTargets: new Map(), passingVictims: new Map(),
    board: { clearHighlights: vi.fn() }, factory: { isReady: false, getSkins: () => ({ w: "ivory", b: "sun" }) },
    boardReactions: { reset: vi.fn(), setQuality: vi.fn() }, downfall: { cancel: vi.fn(), reset: vi.fn() },
    conclusion: { cancel: vi.fn(), active: false }, postfx: { setCinematic: vi.fn() }, callbacks: {},
    applyOrbitLimits: vi.fn(() => { controls.minDistance = ORBIT_MIN; }), captureFollowRig: vi.fn(),
    lensPunch: (fov: number) => fov, stereoPan: () => 0, silentBoard: () => false,
    armStride: vi.fn(() => Promise.resolve()), focusPoint: vi.fn(), wake: vi.fn(), letThemBeg: vi.fn(async () => {}),
    strikeSound: vi.fn(), meleeContact: vi.fn(),
    // With no arena claimant the duel still gives its own camera straight back.
    // Object.create bypasses the production field initializer for this owner.
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
    clearing: new Map(), rotateBoard: true, combatHurry: 1, combatKilled: false, duelHandover: false,
    controller: { getSnapshot: () => ({ mode: "ai", status: "playing", turn: "b", fen: "8/8/8/8/8/8/8/8 b - - 0 1", pgn: "", moves: [], sanList: [] }), getBoard: () => [] },
    ...options.set,
  });
  const pair = director.begin(attacker, defender, () => scene.boardRevision === 1 && !scene.disposed);
  scene.slay = vi.fn(async () => { defender.isSlain = true; await pair.wait(1.7); });
  const plan = directCombat(pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5",
    armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] }),
    [CATALOG.find(sequence => sequence.id === "pawn.thrust-block")!]);
  if (plan.kind !== "sequence") throw new Error(plan.reason);
  const result = engine<Promise<boolean>>("playDirectedCombat", scene, plan, attacker, defender, from.clone(), to.clone(), "d5", pair, 1);
  const finished = result.then(() => "completed", error => error.name as string);
  /** One engine frame per 1/60 s: tweens, the fight clock, then the duel camera, as SceneEngine.frame orders them. */
  async function advance(seconds: number) {
    for (let remaining = seconds; remaining > 1e-8; remaining -= 1 / 60) {
      const dt = Math.min(1 / 60, remaining); tweens.update(dt); director.update(dt); engine("updateDuelCamera", scene, dt);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
  }
  const view = () => ({ position: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov });
  return { scene, camera, controls, plan, from, to, attacker, defender, director, finished, advance, view };
}

const HOME_VIEW = { position: HOME.position.toArray(), target: HOME.target.toArray(), fov: HOME.fov };
const fight = (f: ReturnType<typeof fixture>) => f.from.clone().lerp(f.to, .75);

describe("duel camera lifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("closes in on the fight with the controls off, and gives the exact view back when it is over", async () => {
    const f = fixture(); await f.advance(.05);
    expect(f.controls.enabled).toBe(false);
    expect(f.scene.cameraScripted).toBe(true);
    await f.advance(f.plan.markers.clash);
    // In place by the clash: a couple of squares from the fight, on the player's side of the blow line, looking down at it.
    const middle = fight(f);
    expect(f.camera.position.distanceTo(middle)).toBeLessThan(2.6);
    expect(f.controls.target.distanceTo(middle)).toBeLessThan(.8);
    expect(f.camera.position.y).toBeGreaterThan(.6);
    const normal = lineNormal({ x: f.to.x - f.from.x, z: f.to.z - f.from.z });
    const side = (p: THREE.Vector3) => Math.sign((p.x - middle.x) * normal.x + (p.z - middle.z) * normal.z);
    expect(side(f.camera.position)).toBe(side(HOME.position));
    expect(f.controls.minDistance).toBeLessThan(1);
    const held = f.camera.position.clone();
    // Held through the exchange, then a small push-in on the killing blow with the lens punch on top.
    await f.advance(f.plan.markers.decisive - f.plan.markers.clash - .3);
    expect(f.camera.position.distanceTo(held)).toBeLessThan(1e-9);
    await f.advance(.3 + .25);
    const pushed = held.distanceTo(f.camera.position);
    expect(pushed).toBeGreaterThan(.05); expect(pushed).toBeLessThan(.3);
    expect(f.camera.position.distanceTo(f.controls.target)).toBeLessThan(held.distanceTo(f.controls.target));
    expect(f.camera.fov).toBeLessThan(HOME.fov);
    expect(f.scene.meleeContact).toHaveBeenCalledOnce();
    // Still on the fight while the body falls.
    await f.advance(1);
    expect(f.camera.position.distanceTo(middle)).toBeLessThan(2.6);
    expect(f.controls.enabled).toBe(false);
    await f.advance(4);
    expect(await f.finished).toBe("completed");
    expect(f.view()).toEqual(HOME_VIEW);
    expect(f.controls.enabled).toBe(true);
    expect(f.controls.minDistance).toBe(ORBIT_MIN);
    expect(f.scene.cameraScripted).toBe(false);
    expect(f.scene.duelCamera).toBeNull();
    expect(f.scene.captureFollowRig).toHaveBeenCalledOnce();
    // Nothing is left running that could move it again.
    await f.advance(2);
    expect(f.view()).toEqual(HOME_VIEW);
  });

  it("eases back over about 0.8 s once the body is down, not in a cut", async () => {
    const f = fixture(); await f.advance(f.plan.markers.fall + 1.6);
    const close = f.camera.position.distanceTo(HOME.position);
    await f.advance(.5);
    const leaving = f.camera.position.distanceTo(HOME.position);
    expect(leaving).toBeLessThan(close); expect(leaving).toBeGreaterThan(.2);
    await f.advance(.8);
    expect(f.view()).toEqual(HOME_VIEW);
  });

  it("snaps back on skip and stays there while the kill plays out", async () => {
    const f = fixture(); await f.advance(.9);
    expect(f.camera.position.distanceTo(HOME.position)).toBeGreaterThan(5);
    engine("skipCombat", f.scene);
    expect(f.camera.position.toArray()).toEqual(HOME_VIEW.position);
    expect(f.controls.target.toArray()).toEqual(HOME_VIEW.target);
    expect(f.controls.enabled).toBe(true);
    expect(f.scene.cameraScripted).toBe(false);
    expect(f.scene.duelCamera).toBeNull();
    for (let i = 0; i < 40; i++) {
      await f.advance(.15);
      expect(f.camera.position.toArray()).toEqual(HOME_VIEW.position);
      expect(f.controls.target.toArray()).toEqual(HOME_VIEW.target);
    }
    expect(await f.finished).toBe("completed");
    expect(f.scene.meleeContact).toHaveBeenCalledOnce();
    expect(f.view()).toEqual(HOME_VIEW);
  });

  it("gives the view back at once when the board is reset mid-shot, and never moves a newer camera", async () => {
    const f = fixture(); await f.advance(1.3);
    expect(f.camera.position.distanceTo(HOME.position)).toBeGreaterThan(5);
    engine("rebuildPieces", f.scene);
    expect(f.view().position).toEqual(HOME_VIEW.position);
    expect(f.view().target).toEqual(HOME_VIEW.target);
    expect(f.controls.enabled).toBe(true);
    expect(f.controls.minDistance).toBe(ORBIT_MIN);
    expect(f.scene.cameraScripted).toBe(false);
    expect(f.scene.duelCamera).toBeNull();
    // The player (or the new game) frames the fresh board: the old fight must leave that alone.
    f.camera.position.set(-6, 5, 2); f.controls.target.set(1, 0, 1); f.camera.fov = 70;
    await f.advance(3);
    expect(await f.finished).toBe("CombatCancelled");
    expect(f.view()).toEqual({ position: [-6, 5, 2], target: [1, 0, 1], fov: 70 });
  });

  it("gives the view back when a rewind arrives while the camera is still easing home", async () => {
    const f = fixture(); await f.advance(f.plan.markers.fall + 1.9);
    expect(f.scene.duelCamera).not.toBeNull();
    engine("rebuildPieces", f.scene);
    expect(f.view().position).toEqual(HOME_VIEW.position);
    expect(f.view().target).toEqual(HOME_VIEW.target);
    expect(f.scene.duelCamera).toBeNull();
  });

  it("hands the camera to a newer owner without restoring over it", async () => {
    const f = fixture(); await f.advance(1.3);
    // What the checkmate tableau, a camera preset or the tactical map do when they take the camera.
    f.scene.conclusionCameraRevision += 1;
    f.scene.cameraScripted = true; f.controls.enabled = false;
    f.camera.position.set(2, 3, 4); f.controls.target.set(0, .7, 0); f.camera.fov = 52;
    await f.advance(6);
    expect(await f.finished).toBe("completed");
    expect(f.view()).toEqual({ position: [2, 3, 4], target: [0, .7, 0], fov: 52 });
    // The new owner's own switches are not ours to flip; only our relaxed orbit limit is undone.
    expect(f.scene.cameraScripted).toBe(true);
    expect(f.controls.enabled).toBe(false);
    expect(f.controls.minDistance).toBe(ORBIT_MIN);
    expect(f.scene.duelCamera).toBeNull();
  });

  it("is still holding the close-in when a mating capture settles, for the tableau to take over from", async () => {
    const g = fixture(); let settled = false; void g.finished.then(() => { settled = true; });
    while (!settled) await g.advance(1 / 60);
    // The move has settled and the ease home has only just begun: the tableau starts from the fight, not from a finished pull-back.
    expect(g.scene.duelCamera).not.toBeNull();
    expect(g.camera.position.distanceTo(fight(g))).toBeLessThan(2.6);
    g.scene.conclusionCameraRevision += 1; // playEndCinematic's tableau takes the camera
    const taken = g.view();
    await g.advance(2);
    expect(g.view()).toEqual(taken);
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["the tactical map", { tactical: true }],
    ["the menu's background board", { menuPresentation: true }],
    ["the attract loop", { attract: true }],
    ["capture cinematics switched off", { captureCinematics: false }],
    ["a camera move already in flight", { cameraScripted: true }],
  ])("does not close in with %s", async (_name, set) => {
    const f = fixture({ set });
    const enabled = f.controls.enabled;
    for (let i = 0; i < 30; i++) {
      await f.advance(.2);
      expect(f.camera.position.toArray()).toEqual(HOME_VIEW.position);
      expect(f.controls.target.toArray()).toEqual(HOME_VIEW.target);
      expect(f.controls.enabled).toBe(enabled);
    }
    expect(await f.finished).toBe("completed");
    expect(f.scene.duelCamera).toBeNull();
    expect(f.view()).toEqual(HOME_VIEW);
  });

  it("drops the shot when reduced motion is switched on mid-fight", async () => {
    const f = fixture(); await f.advance(1.2);
    f.scene.reducedMotion = true; await f.advance(1 / 60);
    expect(f.camera.position.toArray()).toEqual(HOME_VIEW.position);
    expect(f.controls.target.toArray()).toEqual(HOME_VIEW.target);
    expect(f.controls.enabled).toBe(true);
  });

  it("moves nothing after dispose", async () => {
    const f = fixture(); await f.advance(1.2);
    f.scene.disposed = true; f.scene.duelCamera = null; f.director.cancelAll();
    const left = f.view();
    await f.advance(3);
    expect(f.view()).toEqual(left);
  });
});
