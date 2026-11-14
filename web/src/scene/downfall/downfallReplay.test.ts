import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GameController } from "../../core/gameController";
import type { Faction, PieceKind } from "../../core/types";
import { SceneEngine } from "../sceneEngine";
import { BoardReactionDirector } from "../boardReactionDirector";
import { BattleBonds } from "../battleBonds";
import { CheckmatePresentation } from "../checkmatePresentation";
import { TILE, squareToWorld } from "../board";
import { DownfallStage, type DownfallStageHooks } from "./downfallStage";
import { captureCompletedMatch } from "../../../../shared/play/replay";
import { replayScriptOf } from "../../../../shared/play/replay-show";
import { openReplay } from "../../../../shared/showcase/records";
import type { MatchConfig } from "../../../../shared/play/match";

/**
 * The downfall runs from playEndCinematic, which a replay's ending (playReplayEnding) runs too: a replay seeked to its
 * last ply and played stages the ending the live game staged (the same plan, the same sounds at the same instants,
 * the same voices), and the chronicle comes from the same place. Its variety comes from the match's seed.
 */

const SCHOLAR = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
const config: MatchConfig = { mode: "local-duel", setting: "scene-01", difficulty: "easy", playerColor: "w", clockMinutes: null, armies: { w: "ivory", b: "sun" } };

async function live(seed: number, moves = SCHOLAR) {
  const game = new GameController();
  game.setCombatArmies(config.armies!);
  game.setAnimator(async () => {});
  game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, seed });
  for (const move of moves) expect(await game.tryMove(move.slice(0, 2), move.slice(2, 4)), move).toBe(true);
  expect(game.getSnapshot().result?.reason).toBe("checkmate");
  return game;
}

/** The actual SceneEngine ending with stand-in figures (each with one sword) and a mixer that writes down what it is asked. */
function stage(controller: GameController) {
  const heard: string[] = [];
  const pieces = new Map(controller.getBoard().map(entry => {
    const container = new THREE.Group(); container.position.copy(squareToWorld(entry.square));
    const hand = new THREE.Group(); hand.position.set(0.18, 0.5, 0); container.add(hand);
    const sword = new THREE.Group(); hand.add(sword);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.01), new THREE.MeshBasicMaterial()); blade.position.y = 0.35; sword.add(blade);
    const fallen = new THREE.Group(); container.add(fallen);
    const view = {
      ...entry as { square: string; kind: PieceKind; color: Faction }, container, isSlain: false,
      applyBoardReaction: vi.fn(), clearBoardReaction: vi.fn(), setBattlefieldQuiet: vi.fn(), setBadgeEnabled: vi.fn(), setBattleMood: vi.fn(),
      standingHeight: 1, holdsLongArm: false, measuredHeight: () => 1, facing: (out: THREE.Vector3) => out.set(0, 0, entry.color === "w" ? -1 : 1),
      beginDownfall: vi.fn(), holdStance: vi.fn(), setDownfallLight: vi.fn(),
      downfallProps: () => sword.parent === fallen ? [] : [{ group: sword, weapon: "longsword", shield: false }],
      adoptFallen: (group: THREE.Object3D) => { fallen.attach(group); },
    };
    return [entry.square, view];
  }));
  const world = new THREE.Scene();
  let downfall!: DownfallStage;
  const hooks: DownfallStageHooks = {
    drop: (kind, o) => { heard.push(`${downfall.clock.time.toFixed(4)} drop ${kind} ${o.salt} ${o.pan.toFixed(4)}`); },
    kneel: (o) => { heard.push(`${downfall.clock.time.toFixed(4)} kneel ${o.salt} ${o.pan.toFixed(4)}`); },
    armyLine: (side, event, o) => { heard.push(`${downfall.clock.time.toFixed(4)} line ${side} ${event} ${o.voice} ${o.salt} ${o.pan.toFixed(4)}`); return 2.5; },
    pan: x => x / 10,
  };
  downfall = new DownfallStage(world, hooks);
  const chronicles: unknown[] = [];
  // The defeat grade (moments/): which side is drained, by how much, at what instant of the ending.
  const grades: string[] = [];
  const moments = { setDefeat: (defeat: { side: string } | null, _victor: unknown, amount: number) => { grades.push(`${downfall.clock.time.toFixed(2)} ${defeat?.side ?? "none"} ${amount}`); }, settle: vi.fn(), reset: vi.fn() };
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    scene: world, downfall, moments, camera: new THREE.PerspectiveCamera(46, 16 / 9), lensFov: 46, controller,
    applyOrbitLimits: vi.fn(), captureFollowRig: vi.fn(), factory: { getSkins: () => ({ w: "ivory", b: "sun" }) }, board: { clearHighlights: vi.fn() }, rankBadges: true,
    pieces, boardReactions: new BoardReactionDirector("medium", TILE), battleBonds: new BattleBonds(), reactionStateKey: "", boardRevision: 1,
    reducedMotion: false, tactical: false, menuPresentation: false, campaignBattle: false,
    conclusion: new CheckmatePresentation(), conclusionViewActive: false, conclusionCameraRevision: 0,
    controls: { enabled: false, target: new THREE.Vector3() }, interactive: true, attract: false, cameraScripted: false,
    postfx: { setCinematic: vi.fn() }, callbacks: { onConclusionState: vi.fn(), onChronicle: (chronicle: unknown) => chronicles.push(chronicle) },
  });
  scene.camera.position.set(0, 6.4, 8.6);
  return { scene, pieces, heard, chronicles, grades };
}

/** Plays the ending through to its end on the scene clock, and says what was staged, in board terms. */
async function perform(f: ReturnType<typeof stage>, start: () => Promise<void>) {
  const ending = start();
  const plan = f.scene.downfall.current;
  expect(plan, "a downfall is staged").toBeTruthy();
  for (let i = 0; i < Math.ceil(plan.timeline.end * 30) + 10; i += 1) { f.scene.downfall.update(1 / 30); f.scene.conclusion.update(1 / 30, 1); }
  await ending;
  const squareOf = new Map([...f.pieces].map(([square, view]) => [view.container.uuid, square]));
  const roles = [plan.king, ...plan.defeated].map((role: { id: string; rearSide: string; start: number; drop: number; kneel: number; gesture: string }) =>
    `${squareOf.get(role.id)} ${role.gesture} ${role.rearSide} ${role.start.toFixed(5)} ${role.drop.toFixed(5)} ${role.kneel.toFixed(5)}`);
  const victors = plan.victors.map((role: { id: string; gesture: string; start: number }) => `${squareOf.get(role.id)} ${role.gesture} ${role.start.toFixed(5)}`);
  return { key: plan.key, roles, victors, heard: f.heard, chronicle: f.chronicles.at(-1), grades: f.grades };
}

const ending = (f: ReturnType<typeof stage>) => () => Reflect.apply(Reflect.get(SceneEngine.prototype, "playEndCinematic"), f.scene, []) as Promise<void>;
const AT = "2026-11-12T10:00:00.000Z";

/** The record as the match keeps it, opened as a replay and seeked to its last ply (CinematicReplay.seek). */
function replayAtEnd(game: GameController, edit: (pgn: string) => string = pgn => pgn) {
  const entry = captureCompletedMatch(game.getSnapshot(), config, "scholar", AT);
  const script = replayScriptOf(openReplay({ ...entry, pgn: edit(entry.pgn) }))!;
  const replay = new GameController();
  replay.setCombatArmies(script.armies);
  replay.setAnimator(async () => {});
  replay.beginReplay(script, script.moves.length);
  expect(replay.getSnapshot().status).toBe("over");
  return replay;
}

describe("the downfall in a replay", () => {
  it("a replay seeked to its last ply and played stages the ending the live game staged", async () => {
    const game = await live(0x5eed1234);
    const played = stage(game);
    const lived = await perform(played, ending(played));
    const replay = replayAtEnd(game);
    const f = stage(replay);
    // Played from there, the replay's ending is playReplayEnding (CinematicReplay.conclude).
    const replayed = await perform(f, () => f.scene.playReplayEnding());
    expect(replayed).toEqual(lived);
    // Every sound of it, at its instant and from its place, and the chronicle, from the record.
    expect(lived.heard.filter(line => / drop blade drop /.test(line)).length).toBeGreaterThanOrEqual(10);
    expect(lived.heard.some(line => / kneel kneel e8 /.test(line))).toBe(true);
    expect(lived.heard.some(line => / line b despair (p1|p2|r|q) line despair /.test(line))).toBe(true);
    expect(lived.heard.some(line => / line w victory (k|q|p1|p2) line victory /.test(line))).toBe(true);
    expect((lived.chronicle as { title: string }).title).toBe("The fall of Solforiz");
    // The defeat grade: Solforiz drained as the realization spreads, eased away as the view pulls back.
    expect(lived.grades.map(line => line.split(" ").slice(1).join(" "))).toEqual(["b 0.6", "none 0"]);
    game.dispose(); replay.dispose();
  });

  it("another match's seed stages another ending on the same board; a record without one stages the position's own", async () => {
    const a = await live(0x5eed1234), b = await live(0x0badf00d);
    const sa = stage(a), sb = stage(b);
    const one = await perform(sa, ending(sa)), two = await perform(sb, ending(sb));
    expect(two.key).not.toBe(one.key);
    expect(two.roles).not.toEqual(one.roles);
    // What the board decides stays: the same King kneels on the same square, the Queen bows, every weapon falls.
    const facts = (roles: string[]) => roles.map(role => role.split(" ").slice(0, 2).join(" ")).sort();
    expect(facts(two.roles)).toEqual(facts(one.roles));
    expect(two.heard.filter(line => / drop /.test(line)).length).toBe(one.heard.filter(line => / drop /.test(line)).length);
    // An older record (no seed): its replays agree with each other, from the position alone.
    const older = (pgn: string) => pgn.replace(/\[CFSeed "[^"]*"\]\n/, "");
    const r1 = replayAtEnd(a, older), r2 = replayAtEnd(a, older);
    expect(r1.getMatchSeed()).toBeNull();
    const first = stage(r1), second = stage(r2);
    expect(await perform(first, () => first.scene.playReplayEnding())).toEqual(await perform(second, () => second.scene.playReplayEnding()));
    for (const game of [a, b, r1, r2]) game.dispose();
  });
});
