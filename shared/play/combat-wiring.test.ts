/**
 * The Combat Director in the live match, for Pawn takes Pawn:
 *  - the stage adapter (web/src/scene/combat/engineStage.ts) against a stub host;
 *  - the controller: what it records with the move, and that a replay rebuilds it;
 *  - everything that is not Pawn takes Pawn is left exactly as it was.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GameController } from "../../web/src/core/gameController";
import type { MoveEvent } from "../../web/src/core/types";
import { recordFromPGN } from "../showcase/records";
import { selectCombatSequence, combatSequenceFromComment } from "./combat-sequences";
import { ARMY_KINGDOMS, matchArmies } from "./match";
import type { Anchor, BoardPoint, Gait } from "../../web/src/scene/combat/choreography";
import { directCombat, planFromRecord, type CombatPlan } from "../../web/src/scene/combat/director";
import { EngineCombatStage, type StageFigure, type StageHost } from "../../web/src/scene/combat/engineStage";
import { PAWN_LIBRARY_CLIPS, directPawnDuel, missingClips, pawnCombatant, pawnDuelInput } from "../../web/src/scene/combat/pawnDuel";
import { CombatControl, runCombat, type ClipInfo, type Vec3 } from "../../web/src/scene/combat/runner";
import { CATALOG } from "../../web/src/scene/combat/sequences/index";
import { combatRecordFromComment } from "../../web/src/scene/combat/record";

// ---------------------------------------------------------------- the stub host

/**
 * What the two baked Pawn rigs hold, as the stage adapter exposes it: the combat-v2 library the duels are played on
 * and the combat-v1 clips kept beside it, read from the sidecars that ship with the GLBs (where both name a clip,
 * the v2 motion is the one installed). `contact` also answers to `impact`.
 */
const sidecarClips = (library: string): [string, ClipInfo][] =>
  (JSON.parse(readFileSync(new URL(`../../web/src/assets/chess/${library}/wp.json`, import.meta.url), "utf8")).clips as { id: string; duration: number; markers: { name: string; time: number }[] }[]).map(clip => {
    const events: Record<string, number> = {};
    for (const marker of clip.markers) if (events[marker.name] === undefined && !marker.name.startsWith("foot_") && marker.name !== "start" && marker.name !== "end") events[marker.name] = Math.round(marker.time * 100) / 100;
    if (events.contact !== undefined && events.impact === undefined) events.impact = events.contact;
    return [clip.id, { id: clip.id, duration: Math.round(clip.duration * 100) / 100, events }];
  });
const PAWN_CLIPS: Record<string, ClipInfo> = Object.fromEntries([...sidecarClips("combat-v1"), ...sidecarClips("combat-v2")]);

/** pairedCombat's CombatSession, reduced to what a stage needs: frames of delta, and a close. */
class SessionClock {
  t = 0;
  private waits: { at: number; resolve(): void; reject(error: Error): void }[] = [];
  now = () => this.t;
  wait = (duration: number) => new Promise<void>((resolve, reject) => { this.waits.push({ at: this.t + duration, resolve, reject }); });
  async advance(duration: number, frame = 0.02): Promise<void> {
    const end = this.t + duration;
    while (this.t < end - 1e-9) {
      this.t = Math.min(end, this.t + frame);
      const due = this.waits.filter(wait => wait.at <= this.t + 1e-9);
      this.waits = this.waits.filter(wait => !due.includes(wait));
      for (const wait of due) wait.resolve();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  close(): void { const waits = this.waits; this.waits = []; for (const wait of waits) wait.reject(new Error("CombatCancelled")); }
}

interface Logged { t: number; what: string; detail?: unknown }

class StubHost implements StageHost {
  readonly clock = new SessionClock();
  readonly log: Logged[] = [];
  readonly spots: Record<"attacker" | "defender", Vec3> = { attacker: { x: 0.5, y: 0, z: 0.5 }, defender: { x: -0.5, y: 0, z: -0.5 } };
  /** Travels still allowed to move their figure. */
  readonly travels: { who: string; live(): boolean }[] = [];
  readonly attacker: StageFigure;
  readonly defender: StageFigure;
  /** Seconds the stub's death and exit take, on the session clock. */
  death = 1.7; exit = 0.8;
  /** Seconds into the stub's death at which the body reaches the stone (death.front's `land` marker). */
  land = 1.43;
  /** How far short of its target the weapon tip stops. */
  short = 0;
  /** Seconds from the fall to the body on the floor, when the host knows (the engine does). */
  landing?: () => number;
  hurried = 0;
  hurry(): void { this.hurried += 1; }
  constructor(private readonly clips: Record<"attacker" | "defender", Record<string, ClipInfo>> = { attacker: PAWN_CLIPS, defender: PAWN_CLIPS }) {
    this.attacker = this.figure("attacker");
    this.defender = this.figure("defender");
  }
  private note(what: string, detail?: unknown): void { this.log.push({ t: this.clock.t, what, detail }); }
  private figure(who: "attacker" | "defender"): StageFigure {
    return {
      position: () => ({ ...this.spots[who] }),
      forward: () => {
        const here = this.spots[who], toward = this.spots[who === "attacker" ? "defender" : "attacker"];
        const length = Math.hypot(toward.x - here.x, toward.z - here.z) || 1;
        return { x: (toward.x - here.x) / length, y: 0, z: (toward.z - here.z) / length };
      },
      clip: id => this.clips[who][id] ?? null,
      play: (id, rate, fade) => this.note(`${who}.play`, { id, rate, fade }),
      rate: (rate, ease) => this.note(`${who}.rate`, { rate, ease }),
      meet: on => this.note(`${who}.meet`, on),
      brace: toward => this.note(`${who}.brace`, toward),
      flinch: (direction, strength) => this.note(`${who}.flinch`, { direction, strength }),
      place: at => { this.spots[who] = { ...at }; this.note(`${who}.place`, at); },
      travel: (to, options: { duration: number; gait: Gait; arc: number }, live) => {
        this.travels.push({ who, live });
        this.note(`${who}.travel`, { to, ...options });
      },
      face: (toward, duration) => this.note(`${who}.face`, { toward, duration }),
      // The weapon reaches whatever it is thrust at, unless the test pulls it short (`reach`).
      anchor: (name: Anchor) => name === "weaponTip"
        ? { x: this.spots[who === "attacker" ? "defender" : "attacker"].x + this.short, y: 0.6, z: this.spots[who === "attacker" ? "defender" : "attacker"].z }
        : { ...this.spots[who], y: name === "ground" ? 0 : 0.6 },
      aimWeapon: at => this.note(`${who}.aim`, at),
    };
  }
  reference(ref: BoardPoint["ref"]): Vec3 {
    return ref === "origin" ? { x: 0.5, y: 0, z: 0.5 } : ref === "standoff" ? { x: 0, y: 0, z: 0 } : { x: -0.5, y: 0, z: -0.5 };
  }
  offset = (file: number, rank: number): Vec3 => ({ x: file, y: 0, z: -rank });
  pan = (at: Vec3): number => Math.max(-1, Math.min(1, at.x));
  readonly sounds = {
    kill: (options: { volume: number; pan: number }) => this.note("sound.strike", options),
    whoosh: (options: { volume: number }) => this.note("sound.whoosh", options),
    bodyFall: (options: { volume: number }) => this.note("sound.bodyFall", options),
    // The sound agent's recordings: only the clash exists in this stub's mixer.
    cue: (name: string) => { if (!/^(clash|bash)\./.test(name)) return false; this.note("sound.clash", name); return true; },
  };
  phase(phase: string): void { this.note("phase", phase); }
  camera(focus: Vec3, tightness: number, fov: number, duration: number): void { this.note("camera", { focus, tightness, fov, duration }); }
  effect(fx: string): void { this.note("effect", fx); }
  impact(power: number): void { this.note("impact", { power }); this.note("reactToImpact", { power }); }
  async fall(silent: boolean, _resolution?: unknown, landed?: () => void): Promise<void> {
    this.note("fall", { silent });
    if (!silent) this.note("sound.bodyFall", { volume: 0.8 });
    await this.clock.wait(this.land);
    this.note("landed"); landed?.();
    await this.clock.wait(this.death - this.land);
    this.note("body down");
  }
  async clear(): Promise<void> { this.note("clear"); await this.clock.wait(this.exit); }
  async claim(gait: Gait): Promise<void> { this.note("claim", gait); await this.clock.wait(0.5); this.spots.attacker = this.reference("destination"); }
  finish(status: string): void { this.note("finish", status); }

  times(what: string): number[] { return this.log.filter(entry => entry.what === what).map(entry => entry.t); }
  count(what: string): number { return this.times(what).length; }
  first(what: string): number { const [time] = this.times(what); assert.notEqual(time, undefined, `${what} never happened`); return time; }
}

const duel = (from = "e4", to = "d5", sanMoves: readonly string[] = ["e4", "d5", "exd5"]) => {
  const result = directPawnDuel({ color: "w", from, to, victim: to, armies: { w: "ivory", b: "sun" }, sanMoves });
  assert.equal(result.direction.kind, "sequence");
  return result.direction as CombatPlan;
};

// ---------------------------------------------------------------- the adapter

test("the adapter plays a Pawn duel in order: whoosh, clash, the kill, the fall, and one of each that must be one", async () => {
  const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] });
  const plan = directCombat(input, CATALOG.filter(sequence => sequence.id === "pawn.thrust-block")) as CombatPlan;
  assert.equal(plan.kind, "sequence");
  const host = new StubHost(), stage = new EngineCombatStage(host);
  const running = runCombat(plan, stage, new CombatControl());
  await host.clock.advance(plan.seconds + 0.1);
  const outcome = await running;
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.killed, true);

  // The plan's fall cue is held until the body really lands, which is after the plan's own length.
  assert.equal(host.count("sound.bodyFall"), 0, "no thud while the body is still falling");
  await host.clock.advance(host.land);
  const whoosh = host.first("sound.whoosh"), clash = host.first("sound.clash"), strike = host.first("sound.strike"), bodyFall = host.first("sound.bodyFall");
  assert.ok(whoosh < clash && clash < strike && strike < bodyFall, `whoosh ${whoosh} < clash ${clash} < decisive ${strike} < fall ${bodyFall}`);
  assert.equal(bodyFall, host.first("landed"), "the body fall sounds on the frame the body reaches the stone");
  assert.ok(Math.abs(bodyFall - (plan.markers.fall + host.land)) < 0.05, "at the death clip's land marker");
  assert.ok(Math.abs(strike - plan.markers.decisive) < 0.03, "the strike sounds on the decisive marker");
  assert.equal(host.count("sound.strike"), 1, "exactly one strike");
  assert.equal(host.count("sound.bodyFall"), 1, "exactly one body fall");
  assert.deepEqual(host.log.filter(entry => entry.what === "fall").map(entry => entry.detail), [{ silent: true }], "the engine's own body-fall sound is silenced: the plan's cue is the one");
  assert.deepEqual(host.log.filter(entry => entry.what === "reactToImpact").map(entry => entry.detail), [{ power: plan.power }], "one witness call, with the plan's power");
  assert.equal(host.count("impact"), 1);
  assert.equal(host.first("impact"), strike, "the blow is heard and seen on the same frame");
  assert.deepEqual(stage.status.sounded.filter(item => item.cue === "decisive").length, 1);
  assert.equal(host.count("finish"), 1);

  // The attacker's authored clips are retimed so their contact frames land on the plan's markers.
  const plays = host.log.filter(entry => entry.what === "attacker.play").map(entry => ({ t: entry.t, ...(entry.detail as { id: string; rate: number }) }));
  const killing = plays.filter(play => play.id.startsWith("attack.")).at(-1)!;
  const contact = PAWN_CLIPS[killing.id].events.contact;
  assert.ok(Math.abs(killing.t + contact / killing.rate - plan.markers.decisive) < 0.05, `${killing.id} lands on decisive`);

  // The body is given its whole fall before it is cleared and the square is claimed.
  await host.clock.advance(host.death - host.land + host.exit + 0.2);
  await stage.aftermath();
  const down = host.first("body down");
  assert.ok(Math.abs(down - (plan.markers.fall + host.death)) < 0.05, "the death clip is not hurried");
  assert.ok(host.first("clear") >= down && host.first("claim") >= down, "nobody walks onto a square with a body still falling on it");
  assert.equal(host.count("clear"), 1); assert.equal(host.count("claim"), 1);
  assert.deepEqual(host.spots.attacker, host.reference("destination"), "the attacker ends on the square it took");
  // A combat-v2 fight ends with the killer walking onto the square: no clip is played over that walk.
  assert.equal(host.log.filter(entry => entry.what === "attacker.play").at(-1)!.t <= host.first("claim"), true, "nothing is played on the attacker after it sets off for the square");
  assert.equal(host.travels.some(travel => travel.live()), false, "no staged step can still move a figure after finish");
});

test("each of the three Pawn sequences runs through the adapter with one strike, one fall and one witness call", async () => {
  const seen = new Set<string>();
  for (let seed = 0; seen.size < 3 && seed < 200; seed += 1) {
    const plan = duel("e4", "d5", [`seed${seed}`]);
    if (seen.has(plan.sequenceId)) continue;
    seen.add(plan.sequenceId);
    const host = new StubHost(), stage = new EngineCombatStage(host);
    const running = runCombat(plan, stage);
    await host.clock.advance(plan.seconds + 3.5);
    assert.equal((await running).status, "completed", plan.sequenceId);
    await stage.aftermath();
    for (const once of ["sound.strike", "sound.bodyFall", "impact", "reactToImpact", "fall", "clear", "claim", "finish"]) assert.equal(host.count(once), 1, `${plan.sequenceId}: ${once}`);
    assert.ok(host.first("sound.strike") < host.first("sound.bodyFall"), plan.sequenceId);
  }
  assert.deepEqual([...seen].sort(), ["pawn.bash-thrust", "pawn.feint-sidestep", "pawn.thrust-block"]);
});

test("a stopped thrust is aimed at the shield, the killing thrust at the body", async () => {
  const plan = directCombat(pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: ["x"] }),
    CATALOG.filter(sequence => sequence.id === "pawn.thrust-block")) as CombatPlan;
  const host = new StubHost(), stage = new EngineCombatStage(host);
  const running = runCombat(plan, stage);
  await host.clock.advance(plan.seconds + 0.1); await running;
  const aims = host.log.filter(entry => entry.what === "attacker.aim").map(entry => entry.detail);
  assert.equal(aims[0], "shieldFace", "the first thrust is launched at the Solforiz Pawn's shield, from its first frame");
  assert.equal(aims.at(-1), null, "by the kill the weapon is back on the torso");
});

test("cancelling mid-fight fires nothing more, finishes once and leaves the rebuilt board alone", async () => {
  const plan = duel(), host = new StubHost(), stage = new EngineCombatStage(host), control = new CombatControl();
  const running = runCombat(plan, stage, control);
  await host.clock.advance(plan.markers.clash + 0.05);
  const before = host.log.length;
  // What rebuildPieces does: control.cancel(), then the session rejects its beats.
  control.cancel(); host.clock.close();
  const outcome = await running;
  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.killed, false);
  assert.equal(stage.status.finished, true);
  assert.equal(host.log.length, before, "nothing touches the stage after the cancel: not even the host's finish");
  assert.equal(host.count("sound.strike"), 0); assert.equal(host.count("fall"), 0);
  assert.equal(host.travels.some(travel => travel.live()), false, "staged steps stop moving their figures");
  // A late call from anything still in flight is ignored.
  stage.attacker.move({ ref: "standoff", file: 0, rank: 0 }, { duration: 0.2, gait: "step", arc: 0 });
  stage.decisive(plan.resolution, plan); stage.finish("completed");
  assert.equal(host.log.length, before);
  await stage.aftermath();
});

test("a board replaced during the fall rejects the aftermath instead of clearing a body that is gone", async () => {
  const plan = duel(), host = new StubHost(), stage = new EngineCombatStage(host);
  const running = runCombat(plan, stage);
  await host.clock.advance(plan.seconds + 0.05);
  assert.equal((await running).status, "completed");
  host.clock.close();
  await assert.rejects(stage.aftermath());
  assert.equal(host.count("clear"), 0); assert.equal(host.count("claim"), 0);
});

test("skip cuts to the killing blow and still resolves the capture in full, once", async () => {
  const plan = duel(), host = new StubHost(), stage = new EngineCombatStage(host), control = new CombatControl();
  const running = runCombat(plan, stage, control);
  await host.clock.advance(0.1);
  control.skip();
  await host.clock.advance(plan.seconds);
  const outcome = await running;
  assert.equal(outcome.status, "skipped");
  await host.clock.advance(host.death + host.exit + 0.2); await stage.aftermath();
  for (const once of ["sound.strike", "impact", "reactToImpact", "fall", "clear", "claim", "finish"]) assert.equal(host.count(once), 1, once);
  assert.ok(host.first("sound.strike") < plan.markers.decisive, "the kill comes early");
  assert.deepEqual(host.spots.attacker, host.reference("destination"));
});

test("a rig without the baked Pawn library is refused before the stage is touched", () => {
  const plan = duel();
  assert.equal(missingClips(plan, { attacker: id => id in PAWN_CLIPS, defender: id => id in PAWN_CLIPS }), null);
  assert.match(missingClips(plan, { attacker: () => false, defender: id => id in PAWN_CLIPS }) ?? "", /^attacker lacks attack\./);
  assert.match(missingClips(plan, { attacker: id => id in PAWN_CLIPS, defender: () => false }) ?? "", /^defender lacks (hit|death)\./);
  for (const id of PAWN_LIBRARY_CLIPS) assert.ok(PAWN_CLIPS[id], `${id} is a baked clip`);
});

// ---------------------------------------------------------------- kingdoms

test("every kingdom's Pawn is directed, Korvenia's line with fixed bayonets and Kwind-09's levy with the shock pike", () => {
  assert.deepEqual(Object.keys(ARMY_KINGDOMS).sort(), ["empire", "ivory", "kwind", "sun"]);
  const san = ["e4", "d5", "exd5"];
  const direct = (w: keyof typeof ARMY_KINGDOMS, b: keyof typeof ARMY_KINGDOMS) =>
    directPawnDuel({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w, b }, sanMoves: san }).direction;
  assert.equal(direct("ivory", "sun").kind, "sequence");
  assert.equal(direct("sun", "ivory").kind, "sequence");
  // Korvenia's and Kwind-09's rigs carry their own combat-v1 libraries (ep, kp): they attack, defend and die in a duel,
  // as killer and as victim, against every army.
  for (const other of ["ivory", "sun", "empire", "kwind"] as const)
    for (const [w, b] of [["empire", other], [other, "empire"], ["kwind", other], [other, "kwind"]] as const)
      assert.equal(direct(w, b).kind, "sequence", `${w} takes ${b}`);
  assert.equal(pawnCombatant("b", "empire").style, "melee", "bayonets fixed when Pawn meets Pawn");
  // Kwind-09's levy still carries no shield; its library is claimed for the rig it was baked from.
  const pikeman = pawnCombatant("w", "kwind");
  assert.deepEqual([pikeman.style, pikeman.armed, pikeman.shield], ["melee", true, null]);
  assert.ok(pikeman.clips?.some(id => id.includes(".")), "the Kwind-09 rig's combat-v1 clips are claimed");
  // A Classic match fields Aethelgard against the chosen rival: the same table.
  const armies = matchArmies({ mode: "classic", playerColor: "w", armies: { w: "ivory", b: "empire" } });
  assert.equal(directPawnDuel({ color: "w", from: "e4", to: "d5", victim: "d5", armies, sanMoves: san }).direction.kind, "sequence");
});

// ---------------------------------------------------------------- the controller

async function play(game: GameController, moves: readonly (readonly [string, string])[]): Promise<void> {
  for (const [from, to] of moves) assert.equal(await game.tryMove(from, to), true, `${from}${to}`);
}
const hotseat = { mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null } as const;

test("the controller records the director's plan with the move, and planFromRecord rebuilds the same fight", async () => {
  const game = new GameController(), events: MoveEvent[] = [];
  game.on("move", event => events.push(event));
  game.start(hotseat);
  await play(game, [["e2", "e4"], ["d7", "d5"], ["e4", "d5"]]);
  const capture = events[2], plan = capture.combat;
  assert.ok(plan && plan.kind === "sequence", "Pawn takes Pawn carries a plan");
  assert.equal(plan.sequenceId.startsWith("pawn."), true);
  assert.deepEqual(capture.choreography, plan.choreography, "the Pawn foundation's tuple still rides on the move");
  const snapshot = game.getSnapshot();
  assert.ok(snapshot.pgn.includes(plan.record), "the plan's record is the move's PGN comment");
  assert.match(plan.record, /^\[%cfcombat 2 pawn\./, "new v2 fights cannot be mistaken for historical v1 tuples");
  assert.equal(combatSequenceFromComment(snapshot.pgn), undefined, "a v1-only reader uses its plain presentation fallback");
  assert.equal(combatRecordFromComment(snapshot.pgn)?.sequence, plan.sequenceId);
  assert.deepEqual(snapshot.moves[2].choreography, plan.choreography);
  const stored = recordFromPGN(snapshot.pgn);
  assert.equal(stored.frames[3].move?.choreography, undefined, "the frame-only showcase never invents v1 choreography for a v2 fight");
  assert.ok(stored.pgn.includes(plan.record), "the full record is retained for a director-capable replay");

  // A replay knows the move list and the comment, nothing else.
  const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: snapshot.sanList });
  assert.deepEqual(planFromRecord(`{${plan.record}}`, input), plan, "the record rebuilds the very same plan");
  assert.deepEqual(directPawnDuel({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: snapshot.sanList, comment: plan.record }).direction, plan);

  // Undo, then the same capture: the same fight, and no stale comment in between.
  assert.equal(game.undo(), true);
  assert.equal(game.getSnapshot().pgn.includes("[%cfcombat"), false);
  await play(game, [["e4", "d5"]]);
  assert.deepEqual(events[3].combat, plan, "Undo and the capture again is the same fight");
  game.dispose();
});

test("consecutive Pawn duels never repeat a variation, and undo forgets the fights it took back", async () => {
  const game = new GameController(), captures: MoveEvent[] = [];
  game.on("move", event => { if (event.capture) captures.push(event); });
  game.start({ ...hotseat, startingFen: "7k/8/8/2p1p1p1/1P1P1P2/8/8/K7 w - - 0 1" });
  await play(game, [["b4", "c5"], ["h8", "g8"], ["d4", "e5"], ["g8", "h8"], ["f4", "g5"]]);
  const families = captures.map(event => event.combat?.family);
  assert.equal(families.length, 3);
  assert.ok(families.every(Boolean));
  assert.notEqual(families[0], families[1]); assert.notEqual(families[1], families[2]);
  for (const square of ["c5", "e5", "g5"]) assert.deepEqual(game.pieceAt(square), { color: "w", kind: "p" });
  const replay = recordFromPGN(game.getSnapshot().pgn);
  assert.deepEqual([...replay.pgn.matchAll(/\[%cfcombat [^\]]+\]/g)].map(match => match[0]), captures.map(event => event.combat!.record));
  assert.equal(replay.frames.some(frame => frame.move?.choreography), false, "v1-only frame playback falls back without reinterpreting the v2 records");
  // Take the last capture back and play it again: its memory is the two fights before it, as it was.
  assert.equal(game.undo(), true);
  await play(game, [["f4", "g5"]]);
  assert.deepEqual(captures[3].combat, captures[2].combat);
  game.dispose();
});

test("en passant is directed with the victim's own square, and the attacker ends on its destination", async () => {
  const game = new GameController(), events: MoveEvent[] = [];
  game.on("move", event => events.push(event));
  game.start(hotseat);
  await play(game, [["e2", "e4"], ["a7", "a6"], ["e4", "e5"], ["d7", "d5"], ["e5", "d6"]]);
  const plan = events[4].combat;
  assert.ok(plan);
  assert.equal(plan.geometry.enPassant, true);
  assert.equal(plan.geometry.victim, "d5"); assert.equal(plan.geometry.to, "d6");
  assert.equal(game.pieceAt("d5"), null);
  game.dispose();
});

test("every capture that is not Pawn takes Pawn is untouched: no plan, and the foundation's own record", async () => {
  const game = new GameController(), events: MoveEvent[] = [];
  game.on("move", event => events.push(event));
  game.start(hotseat);
  // 1.e4 d5 2.Nc3 dxe4 (Pawn takes Pawn) 3.Nxe4 (Knight takes Pawn) Qd5 4.Nc3 Qxa2 (Queen takes Pawn) 5.Rxa2 (Rook takes Queen)
  await play(game, [["e2", "e4"], ["d7", "d5"], ["b1", "c3"], ["d5", "e4"], ["c3", "e4"], ["d8", "d5"], ["e4", "c3"], ["d5", "a2"], ["a1", "a2"]]);
  const captures = events.filter(event => event.capture);
  assert.deepEqual(captures.map(event => `${event.kind}x${event.capture!.kind}`), ["pxp", "nxp", "qxp", "rxq"]);
  assert.ok(captures[0].combat, "the Pawn duel is directed");
  for (const event of captures.slice(1)) {
    assert.equal(event.combat, undefined, `${event.san} carries no director plan`);
    assert.deepEqual(event.choreography, selectCombatSequence({ attacker: event.kind, defender: event.capture!.kind, from: event.from, to: event.to, enPassant: false }),
      `${event.san} keeps the selector's answer (none)`);
    assert.equal(event.choreography, undefined);
  }
  assert.equal((game.getSnapshot().pgn.match(/\[%cfcombat/g) ?? []).length, 1, "only the Pawn duel wrote a record");
  // Quiet moves carry nothing either.
  assert.ok(events.filter(event => !event.capture).every(event => !event.combat && !event.choreography));
  game.dispose();
});

test("a match that fields Korvenia directs its Pawn captures too, and records them the same way", async () => {
  const game = new GameController(), events: MoveEvent[] = [];
  game.on("move", event => events.push(event));
  game.setCombatArmies({ w: "ivory", b: "empire" });
  game.start(hotseat);
  await play(game, [["e2", "e4"], ["d7", "d5"], ["e4", "d5"]]);
  const plan = events[2].combat;
  assert.ok(plan && plan.kind === "sequence", "the Korvenian Pawn now has a library to defend and die with");
  assert.deepEqual(events[2].choreography, plan.choreography);
  assert.match(game.getSnapshot().pgn, /\[%cfcombat 2 /);
  game.dispose();
});

// ---------------------------------------------------------------- the engine's single paths

test("the engine keeps one strike, one body fall and one witness path, and non-director captures are as before", () => {
  const scene = readFileSync(fileURLToPath(new URL("../../web/src/scene/sceneEngine.ts", import.meta.url)), "utf8");
  // The plain cinematic still calls the contact and the fall with their sounds on (the defaults).
  assert.match(scene, /contact: \(\) => this\.meleeContact\(attacker, victim, victimSpot, standoff, blow, strikeSquare, profile\),/);
  assert.match(scene, /fall: \(\) => this\.slay\(victim, blow, true, pair\),/);
  assert.match(scene, /sound = true, bled = false,\n\s*\): void \{/);
  assert.match(scene, /silentFall = false, onLanded\?: \(\) => void\): Promise<void>/);
  // The director's host silences exactly those two and sounds the strike through the audio layer's bank.
  assert.match(scene, /this\.meleeContact\(attacker, victim, victim\.container\.position\.clone\(\), standoff, blow, strikeSquare, \{ \.\.\.profile, power \}, false, blood\?\.silent === null\);/);
  assert.match(scene, /fall: \(silent, _resolution, down\) => \{\n\s*trace\("fall", silent\);[\s\S]*?return this\.slay\(victim, blow, true, pair, silent, landed\);\n\s*\},/);
  // The thud, the gore sound and the pool share the death clip's landing frame.
  assert.match(scene, /const landing = Math\.min\(death, victim\.deathPlan\(\)\?\.land \?\? death\);[\s\S]*?audio\.goreSplat\(\{ pan: gorePan \}\);\n\s*onLanded\?\.\(\);/);
  assert.match(scene, /kill: sound => \{ trace\("strike", sound\.volume\); this\.strikeSound\(attacker\.kind, sound\.pan, sound\.volume\); \},/);
  // Witnesses: the contact's own reactToImpact is the only capture-impact call a melee fight makes.
  const contact = scene.slice(scene.indexOf("  private meleeContact("), scene.indexOf("  private async passSentence("));
  assert.equal((contact.match(/this\.reactToImpact\(/g) ?? []).length, 1);
  const directed = scene.slice(scene.indexOf("  private async playDirectedCombat("), scene.indexOf("  getCombatDiagnostics()"));
  assert.equal(directed.includes("reactToImpact"), false, "the director adds no witness path of its own");
  assert.equal(directed.includes("audio.strike("), false);
  // The exchange recordings and the menu-board rule are the sound agent's: both feature-detected, the rule first.
  assert.match(directed, /\["combatCueAllowed"\];\n[^\n]*silentBoard: this\.silentBoard\(\) \}\) === false\) return true;\n[\s\S]*?mixer\.cue\(name, sound\) === true;/);
  // The fight runs on the pair's session clock and is reachable by cancel and skip.
  assert.match(directed, /clock: \{ now: \(\) => pair\.elapsedSeconds, wait: seconds => pair\.wait\(seconds\) \}/);
  assert.match(scene, /this\.boardRevision \+= 1;\n\s*this\.combatControl\?\.cancel\(\);\n\s*this\.combatDirector\.cancelAll\(\);/);
  const disposal = scene.slice(scene.indexOf("  dispose(): void {"));
  assert.match(disposal, /this\.disposed = true;[\s\S]*?this\.combatControl\?\.cancel\(\);/,
    "dispose cancels the directed fight even with subscription cleanup between the calls");
  assert.match(scene, /skipCombat\(\): void \{\n\s*const control = this\.combatControl;[\s\S]{0,400}?control\.skip\(\);/);
});

// ---------------------------------------------------------------- the feel pass

test("a block that does not stop the spear shows no sparks and sounds no clash", async () => {
  const run = async (short: number) => {
    const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] });
    const plan = directCombat(input, CATALOG.filter(sequence => sequence.id === "pawn.thrust-block")) as CombatPlan;
    const host = new StubHost(), stage = new EngineCombatStage(host);
    host.short = short;
    const running = runCombat(plan, stage, new CombatControl());
    await host.clock.advance(plan.seconds + 0.1);
    await running;
    return { host, stage };
  };
  const held = await run(0), missed = await run(0.5);
  assert.equal(held.host.count("sound.clash"), 1);
  assert.ok(held.host.log.some(entry => entry.what === "effect" && entry.detail === "sparks"));
  assert.deepEqual(held.stage.status.blocks.map(block => block.held), [true]);
  assert.equal(missed.host.count("sound.clash"), 0, "no clash is heard when the steel is half a unit from the shield");
  assert.equal(missed.host.log.some(entry => entry.what === "effect" && entry.detail === "sparks"), false);
  assert.deepEqual(missed.stage.status.blocks.map(block => block.held), [false]);
  // The kill is not gated: it is the capture.
  assert.equal(missed.host.count("sound.strike"), 1);
  // The defender's shield is sent to meet the spear while it comes in, and let go after.
  assert.deepEqual(held.host.log.filter(entry => entry.what === "defender.meet").map(entry => entry.detail), [true, false]);
});

test("with a known landing the killer sets off as the body reaches the floor, and the body is cleared a moment later", async () => {
  const plan = duel();
  const host = new StubHost(), stage = new EngineCombatStage(host);
  host.landing = () => 1;
  const running = runCombat(plan, stage, new CombatControl());
  await host.clock.advance(plan.seconds + 2.5);
  await running; await stage.aftermath(); await stage.cleared();
  const fall = host.first("fall"), claim = host.first("claim"), clear = host.first("clear");
  assert.ok(Math.abs(claim - (fall + 1)) < 0.05, `claim ${claim - fall} s after the fall began`);
  assert.ok(clear > claim && Math.abs(clear - (fall + 1.3)) < 0.05, `clear ${clear - fall} s after the fall began`);
  assert.ok(claim < host.first("body down"), "he does not wait for the clip to play out");
  assert.equal(host.count("claim"), 1); assert.equal(host.count("clear"), 1);
});

test("the bash and the thrust are two clips with a still beat between them, each at its own speed", async () => {
  const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] });
  const plan = directCombat(input, CATALOG.filter(sequence => sequence.id === "pawn.bash-thrust")) as CombatPlan;
  const host = new StubHost(), stage = new EngineCombatStage(host);
  const running = runCombat(plan, stage, new CombatControl());
  await host.clock.advance(plan.seconds + 0.1);
  const outcome = await running;
  const plays = host.log.filter(entry => entry.what === "attacker.play").map(entry => ({ t: entry.t, ...(entry.detail as { id: string; rate: number }) }));
  assert.deepEqual(plays.map(play => play.id), ["attack.bash", "ready.guard", "attack.thrust"]);
  const [bash, guard, thrust] = plays;
  // The bash's clash frame is on `clash`, the thrust's contact frame on `decisive`.
  assert.ok(Math.abs(bash.t + PAWN_CLIPS["attack.bash"].events.clash / bash.rate - plan.markers.clash) < 0.03);
  assert.ok(Math.abs(thrust.t + PAWN_CLIPS["attack.thrust"].events.contact / thrust.rate - plan.markers.decisive) < 0.03);
  // Between them he stands in his guard, feet and spear still, for longer than the 0.3 s the beat needs to read.
  assert.ok(guard.t > plan.markers.clash && thrust.t - guard.t >= 0.45, `guard from ${guard.t} to ${thrust.t}`);
  assert.equal(host.log.some(entry => entry.what === "attacker.travel" && entry.t > plan.markers.ready), false, "the attacker's feet do not move between the blows");
  assert.ok(plan.markers.decisive - plan.markers.clash >= 1.1);
  assert.ok(outcome.rates!.filter(item => item.clip.startsWith("attack.")).every(item => item.rate > 0.85 && item.rate < 1.2), JSON.stringify(outcome.rates));
  // The defender is knocked back one pace by the bash, on a dodge clip, and nowhere else.
  const paces = host.log.filter(entry => entry.what === "defender.travel");
  assert.equal(paces.length, 1);
  assert.equal((paces[0].detail as { gait: string }).gait, "dodge");
});

test("a jab stopped on the shield is held there for a breath: one clip, held and released on the stage", async () => {
  const input = pawnDuelInput({ color: "w", from: "e4", to: "f5", victim: "f5", armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "f5", "exf5"] });
  const plan = directCombat(input, CATALOG.filter(sequence => sequence.id === "pawn.thrust-block")) as CombatPlan;
  const host = new StubHost(), stage = new EngineCombatStage(host);
  const running = runCombat(plan, stage, new CombatControl());
  await host.clock.advance(plan.seconds + 0.1);
  await running;
  const rates = host.log.filter(entry => entry.what === "attacker.rate").map(entry => ({ t: entry.t, ...(entry.detail as { rate: number }) }));
  // Held after the jab lands, released to draw the spear back.
  assert.ok(rates.length >= 2);
  assert.ok(rates[0].rate < 0.2 && rates[0].t >= plan.markers.clash - 0.03 && rates[0].t < plan.markers.clash + 0.2, JSON.stringify(rates));
  assert.ok(rates[1].rate > 0.8 && rates[1].t >= plan.markers.recoil - 0.03, JSON.stringify(rates));
  assert.ok(rates[1].t - rates[0].t >= 0.3, "a held beat of at least 0.3 s");
});

// ---------------------------------------------------------------- one effect per contact type

test("each contact type has one owner: the block gate, the resolved contact, the Gore Director or the flipbooks", () => {
  // Korvenia's line and Kwind-09's levy carry no shield, so a blow at them is parried, weapon on weapon.
  assert.equal(pawnCombatant("b", "empire").shield, null);
  assert.equal(pawnCombatant("b", "kwind").shield, null);
  assert.equal(pawnCombatant("b", "ivory").shield, "iron");
  assert.equal(pawnCombatant("b", "sun").shield, "wood");
  const plan = (b: "sun" | "empire" | "kwind") =>
    directCombat(pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b }, sanMoves: ["e4", "d5", "exd5"] }), CATALOG.filter(sequence => sequence.id === "pawn.thrust-block")) as CombatPlan;
  assert.deepEqual(plan("sun").contacts.map(cue => cue.to.anchor), ["shieldFace", "torso"]);
  for (const army of ["empire", "kwind"] as const) assert.deepEqual(plan(army).contacts.map(cue => cue.to.anchor), ["weaponTip", "torso"], army);

  const scene = readFileSync(fileURLToPath(new URL("../../web/src/scene/sceneEngine.ts", import.meta.url)), "utf8");
  const directed = scene.slice(scene.indexOf("  private async playDirectedCombat("), scene.indexOf("  getCombatDiagnostics()"));
  const resolved = directed.slice(directed.indexOf("      contactResolved: event => {"), directed.indexOf("      camera: (point, tightness, fov, duration, live) => {"));
  const effect = directed.slice(directed.indexOf("      effect: (fx, at, strength, cue) => {"), directed.indexOf("      impact: power => {"));
  // The resolved contact draws only for a weapon tip on a body (a glance off armour), never at a shield, a weapon
  // or the stone, and never where the surface table says flesh.
  assert.match(resolved, /event\.fromAnchor !== "weaponTip" \|\| \(event\.toAnchor !== "torso" && event\.toAnchor !== "head"\)/);
  assert.match(resolved, /if \(!material \|\| material === "flesh"\) return;/);
  assert.equal((resolved.match(/this\.effects\.spawnContact\(/g) ?? []).length, 1);
  // A block or a parry is drawn once, by the cue the stage's block gate lets through; the old sprite burst is gone.
  const sparks = effect.slice(effect.indexOf('if (fx === "sparks") {'), effect.indexOf('if (fx === "flash"'));
  assert.equal((sparks.match(/this\.effects\.spawnContact\(/g) ?? []).length, 1);
  assert.equal(sparks.includes("spawnBurst"), false);
  // A dust cue uses the flipbook when available, or exactly one bounded seeded stone response.
  const dust = effect.slice(effect.indexOf('else if (fx === "dust") {'), effect.indexOf('} else if (fx === "shake"'));
  assert.match(dust, /this\.duelDustIsFlipbook\(\)/);
  assert.equal((dust.match(/this\.effects\.spawnContact\(/g) ?? []).length, 1);
  assert.equal(dust.includes("spawnSmoke"), false);
});
