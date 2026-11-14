/**
 * Pawn duels on the combat-v2 library (docs/play/COMBAT_LIBRARY_V2.md).
 *
 * Three things are pinned here:
 *  - a game recorded before the switch, whose moves carry
 *    `[%cfcombat 1 crownfall-pawn-combat-1 ...]` tokens naming combat-v1 clip
 *    ids, still selects its genuine v1 profile and original catalog, with the
 *    same contacts, one kill, and a record written back unchanged;
 *  - the three standard Pawn fights ask only for clips the v2 library holds,
 *    one clip per blow, near each clip's own speed, with a still beat between
 *    the two blows;
 *  - a step or a dodge is carried by its clip's own floor travel, read from
 *    the pelvis channel of the shipped GLBs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { COMBAT_LIBRARY_VERSION, PAWN_ATTACKS, PAWN_DEATHS, PAWN_DEFENSES, PAWN_HITS, combatComment, combatSequenceFromComment, type CombatSequence } from "./combat-sequences";
import { MARKERS, seconds, type Sequence } from "../../web/src/scene/combat/choreography";
import { planFromRecord, type CombatPlan } from "../../web/src/scene/combat/director";
import { PAWN_LIBRARY_CLIPS, PAWN_LIBRARY_V2_CLIPS, directPawnDuel, missingClips, pawnDuelInput } from "../../web/src/scene/combat/pawnDuel";
import { CombatControl, runCombat, type ClipInfo, type CombatActor, type CombatStage } from "../../web/src/scene/combat/runner";
import { CATALOG, PAWN_SEQUENCES } from "../../web/src/scene/combat/sequences/index";
import { PAWN_V1_SEQUENCES } from "../../web/src/scene/combat/sequences/pawnV1";
import { encodeCombatRecord } from "../../web/src/scene/combat/record";
import { TRAVEL_CLIPS, travelHeading } from "../../web/src/scene/combat/travelClips";
import { COMBAT_LIBRARY_V2_VERSION, rootTravelOf, sampleRootTravel } from "../../web/src/scene/combatAnimationLibrary";

// ---------------------------------------------------------------- fixtures

interface Sidecar { id: string; duration: number; markers: { name: string; time: number }[]; rootTravel?: { net: [number, number] } }
const sidecar = (library: string, rig = "wp"): { version: string; clips: Sidecar[] } =>
  JSON.parse(readFileSync(new URL(`../../web/src/assets/chess/${library}/${rig}.json`, import.meta.url), "utf8"));
const clipInfo = (clip: Sidecar): ClipInfo => {
  const events: Record<string, number> = {};
  for (const marker of clip.markers) if (events[marker.name] === undefined && !marker.name.startsWith("foot_")) events[marker.name] = marker.time;
  if (events.contact !== undefined && events.impact === undefined) events.impact = events.contact;
  return { id: clip.id, duration: clip.duration, events };
};
/** What a baked rig holds at run time: v2, and the v1 clips v2 has no namesake of. */
const HELD: Record<string, ClipInfo> = Object.fromEntries([...sidecar("combat-v1").clips, ...sidecar("combat-v2").clips].map(clip => [clip.id, clipInfo(clip)]));
const V2 = new Set(sidecar("combat-v2").clips.map(clip => clip.id));
const HELD_V1: Record<string, ClipInfo> = Object.fromEntries(sidecar("combat-v1").clips.map(clip => [clip.id, clipInfo(clip)]));

const STANDARD = PAWN_SEQUENCES.filter(sequence => sequence.tier === "standard");
/** The three tuples the Pawn foundation could ever record, as an old game's PGN comments carry them. */
const OLD_RECORDS: [string, string][] = PAWN_ATTACKS.map((attack, i) => [
  `[%cfcombat 1 crownfall-pawn-combat-1 ${attack} ${PAWN_DEFENSES[i]} ${PAWN_HITS[i]} ${PAWN_DEATHS[i]}]`,
  ["pawn.thrust-block", "pawn.bash-thrust", "pawn.feint-sidestep"][i],
]);
const MOVE = { color: "w" as const, from: "e4", to: "d5", victim: "d5", armies: { w: "ivory" as const, b: "ivory" as const }, sanMoves: ["e4", "d5", "exd5"] };

const v2Record = (sequence: string) => encodeCombatRecord({ sequence, side: 1, seed: pawnDuelInput(MOVE).seed });

class Clock {
  t = 0;
  private waits: { at: number; resolve(): void }[] = [];
  now = () => this.t;
  wait = (duration: number) => new Promise<void>(resolve => { this.waits.push({ at: this.t + duration, resolve }); });
  async advance(duration: number, frame = 1 / 60): Promise<void> {
    const end = this.t + duration;
    while (this.t < end - 1e-9) {
      this.t = Math.min(end, this.t + frame);
      const due = this.waits.filter(wait => wait.at <= this.t + 1e-9);
      this.waits = this.waits.filter(wait => !due.includes(wait));
      for (const wait of due) wait.resolve();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}

/** Runs a plan on a stage that holds the real clip tables and writes down what it was asked to do. */
async function perform(plan: CombatPlan): Promise<{ log: { t: number; what: string; id?: string; rate?: number; gait?: string }[]; outcome: Awaited<ReturnType<typeof runCombat>> }> {
  const held = plan.animationLibrary === COMBAT_LIBRARY_VERSION ? HELD_V1 : HELD;
  const clock = new Clock(), log: { t: number; what: string; id?: string; rate?: number; gait?: string }[] = [];
  const actor = (name: string): CombatActor => ({
    clip: (_role, prefer) => { for (const id of prefer) if (held[id]) return held[id]; return null; },
    play: (clip, options) => { log.push({ t: clock.t, what: `${name}.play`, id: clip.id, rate: options.rate }); },
    rate: rate => { log.push({ t: clock.t, what: `${name}.rate`, rate }); },
    pose: () => undefined,
    move: (_to, options) => { log.push({ t: clock.t, what: `${name}.move`, gait: options.gait }); },
    face: () => undefined,
    anchor: () => ({ x: 0, y: 0.5, z: 0 }),
  });
  const stage: CombatStage = {
    clock, attacker: actor("attacker"), defender: actor("defender"),
    phase: (_phase, marker) => { log.push({ t: clock.t, what: `marker.${marker}` }); },
    camera: () => undefined, effect: cue => { log.push({ t: clock.t, what: `effect.${cue.fx}` }); },
    audio: cue => { log.push({ t: clock.t, what: `audio.${cue}` }); },
    contact: (cue, state) => { log.push({ t: clock.t, what: `contact.${state}.${cue.id}` }); },
    decisive: () => { log.push({ t: clock.t, what: "decisive" }); },
    fall: () => { log.push({ t: clock.t, what: "fall" }); },
    settle: () => { log.push({ t: clock.t, what: "settle" }); },
    finish: status => { log.push({ t: clock.t, what: `finish.${status}` }); },
  };
  const running = runCombat(plan, stage, new CombatControl());
  await clock.advance(plan.seconds + 0.2);
  return { log, outcome: await running };
}

/** The shape of a fight, without its timings or its clips: what an old record has to reproduce. */
const structure = (plan: CombatPlan) => ({
  sequence: plan.sequenceId, family: plan.family, tier: plan.tier, record: plan.record,
  markers: MARKERS.filter(marker => Number.isFinite(plan.markers[marker])),
  contacts: plan.contacts.map(contact => `${contact.id}:${contact.from.actor}.${contact.from.anchor}>${contact.to.actor}.${contact.to.anchor}`),
  kills: plan.audio.filter(cue => cue.cue === "decisive").length,
  heading: plan.geometry.heading, side: plan.geometry.side,
});

// ---------------------------------------------------------------- old records

test("a game recorded on combat-v1 retains its original catalog and original clip profile", async () => {
  for (const [token, sequenceId] of OLD_RECORDS) {
    // The token is what combat-sequences.ts has always written and still accepts.
    const tuple = combatSequenceFromComment(token) as CombatSequence;
    assert.ok(tuple, token);
    assert.equal(tuple.library, COMBAT_LIBRARY_VERSION);
    assert.equal(combatComment(tuple), token);

    const input = pawnDuelInput({ ...MOVE, comment: `a note ${token}` });
    const replay = planFromRecord(`a note ${token}`, input);
    assert.equal(replay.kind, "sequence", replay.kind === "fallback" ? replay.reason : "");
    const plan = replay as CombatPlan;
    // The record names the fight: the same sequence, and it is written back exactly as it was read.
    assert.equal(plan.sequenceId, sequenceId);
    assert.equal(plan.record, token);
    assert.deepEqual(plan.choreography, tuple);

    // The controller's own path (what a live replay or an import goes through) agrees, whatever the director would have chosen.
    const duel = directPawnDuel({ ...MOVE, comment: `a note ${token}` });
    assert.equal(duel.direction.kind, "sequence");
    assert.deepEqual(structure(duel.direction as CombatPlan), structure(plan));
    // ...and twice over gives the same plan, cue for cue.
    assert.deepEqual(planFromRecord(token, input), plan);

    // Its structure is the catalog's: every beat in order, the same contacts, exactly one kill.
    const sequence = PAWN_V1_SEQUENCES.find(item => item.id === sequenceId) as Sequence;
    const shape = structure(plan);
    assert.deepEqual(shape.markers, [...MARKERS]);
    assert.deepEqual(shape.contacts.map(item => item.split(":")[0]), (sequence.contacts ?? []).filter(cue => !cue.when || cue.when.defenderShield !== "none").map(cue => cue.id));
    assert.equal(shape.kills, 1);
    assert.equal(shape.contacts.at(-1), "kill:attacker.weaponTip>defender.torso");

    // Both rigs can perform it: nothing the record's fight needs is missing from what a baked Pawn holds.
    assert.equal(missingClips(plan, { attacker: id => !!HELD[id], defender: id => !!HELD[id] }), null);
    // Performed: every beat in order, one kill, one fall, one claim, and it ends on its own.
    const { log, outcome } = await perform(plan);
    assert.equal(outcome.status, "completed"); assert.equal(outcome.killed, true);
    assert.deepEqual(log.filter(entry => entry.what.startsWith("marker.")).map(entry => entry.what.slice(7)), [...MARKERS]);
    for (const what of ["decisive", "fall", "settle", "finish.completed", "audio.decisive"]) assert.equal(log.filter(entry => entry.what === what).length, 1, `${sequenceId} ${what}`);
    const order = ["marker.clash", "decisive", "fall", "settle", "finish.completed"].map(what => log.findIndex(entry => entry.what === what));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.deepEqual(outcome.contacts.map(contact => contact.id), plan.contacts.map(contact => contact.id));
    assert.equal(plan.animationLibrary, COMBAT_LIBRARY_VERSION);
    // A legacy record never silently switches to the duplicate v2 motions.
    const played = log.filter(entry => entry.what.endsWith(".play")).map(entry => entry.id as string);
    assert.ok(played.length >= 2 && played.some(id => id.startsWith("attack.")) && played.every(id => !!HELD_V1[id]), `${sequenceId} played ${played.join(", ")}`);
  }
});

test("new v2 records roundtrip explicitly while old tuples retain v1 across all kingdoms", () => {
  // New v2 captures use the existing version-2 token so they cannot be confused with old v1 motion.
  const live = directPawnDuel(MOVE);
  assert.equal(live.direction.kind, "sequence");
  const record = (live.direction as CombatPlan).record;
  assert.match(record, /^\[%cfcombat 2 pawn\.[a-z-]+ [lr] [0-9a-f]+\]$/);
  assert.equal((live.direction as CombatPlan).animationLibrary, COMBAT_LIBRARY_V2_VERSION);
  assert.deepEqual(planFromRecord(record, pawnDuelInput(MOVE)), live.direction);
  // Undo and the same capture again: the same fight.
  assert.deepEqual(directPawnDuel(MOVE).direction, live.direction);
  // A token for a library that never existed, or a mangled tuple, is not a record: the director chooses as if there were none.
  for (const comment of ["[%cfcombat 1 crownfall-pawn-combat-9 attack.thrust defend.parry hit.light death.front]", "[%cfcombat 1 crownfall-pawn-combat-1 attack.thrust defend.evade hit.heavy death.backward]"]) {
    assert.equal(planFromRecord(comment, pawnDuelInput(MOVE)).kind, "fallback");
    assert.deepEqual(directPawnDuel({ ...MOVE, comment }).direction, live.direction);
  }
  // Kwind-09 and Korvenia Pawns hold both libraries too: their captures, given or taken, are the same directed fights,
  // and an old record replays as the sequence it named.
  for (const w of ["ivory", "sun", "empire", "kwind"] as const) for (const b of ["ivory", "sun", "empire", "kwind"] as const) {
    const armies = { w, b }, fresh = directPawnDuel({ ...MOVE, armies }).direction as CombatPlan;
    assert.equal(fresh.kind, "sequence", JSON.stringify(armies));
    assert.equal(fresh.animationLibrary, COMBAT_LIBRARY_V2_VERSION);
    assert.match(fresh.record, /^\[%cfcombat 2 /);
    assert.deepEqual(planFromRecord(fresh.record, pawnDuelInput({ ...MOVE, armies })), fresh);
    for (const [token] of OLD_RECORDS) {
      const replayed = directPawnDuel({ ...MOVE, armies, comment: token }).direction;
      assert.equal(replayed.kind, "sequence");
      assert.equal((replayed as CombatPlan).record, token);
      assert.equal((replayed as CombatPlan).animationLibrary, COMBAT_LIBRARY_VERSION);
    }
  }
});

// ---------------------------------------------------------------- the three fights

test("the standard Pawn fights are built on combat-v2: one clip per blow, at its own speed, with a still beat between the blows", async () => {
  assert.equal(sidecar("combat-v2").version, COMBAT_LIBRARY_V2_VERSION);
  assert.deepEqual([...PAWN_LIBRARY_V2_CLIPS].sort(), [...V2].sort());
  for (const id of PAWN_LIBRARY_CLIPS) assert.ok(HELD[id], `${id} is a baked clip`);
  const blows: Record<string, string[]> = {
    "pawn.bash-thrust": ["attack.bash", "attack.thrust"],
    "pawn.thrust-block": ["attack.jab", "attack.thrust"],
    "pawn.feint-sidestep": ["ready.feint", "attack.thrust"],
  };
  for (const sequence of STANDARD) {
    // Every clip a cue or the ending prefers first is a v2 clip.
    const asked = [...sequence.tracks.attacker, ...sequence.tracks.defender].flatMap(cue => cue.do === "clip" ? [cue.clip.prefer?.[0]] : []);
    for (const id of [...asked, sequence.resolution.hit.prefer?.[0], sequence.resolution.death.prefer?.[0]]) assert.ok(id && V2.has(id), `${sequence.id} asks for ${id}`);
    // The death carries its own landing.
    assert.ok(HELD[sequence.resolution.death.prefer![0]].events.land > 0);

    const plan = directPawnDuel({ ...MOVE, comment: v2Record(sequence.id) }).direction as CombatPlan;
    const { log, outcome } = await perform(plan);
    const strikes = log.filter(entry => entry.what === "attacker.play" && (entry.id!.startsWith("attack.") || entry.id === "ready.feint"));
    assert.deepEqual(strikes.map(entry => entry.id), blows[sequence.id], sequence.id);
    // The first blow is on `clash` and the killing blow on `decisive`, each on its clip's own marker.
    const [first, last] = strikes;
    const firstEvent = HELD[first.id!].events[first.id === "ready.feint" ? "feint" : first.id === "attack.bash" ? "clash" : "contact"];
    assert.ok(Math.abs(first.t + firstEvent / first.rate! - plan.markers.clash) < 0.03, `${sequence.id} first blow`);
    assert.ok(Math.abs(last.t + HELD["attack.thrust"].events.contact / last.rate! - plan.markers.decisive) < 0.03, `${sequence.id} kill`);
    // Authored timing: nothing is hurried or dragged.
    for (const item of outcome.rates ?? []) assert.ok(item.rate >= 0.8 && item.rate <= 1.25, `${sequence.id} ${item.clip} x${item.rate}`);

    // The still beat: at least 0.3 s between the blows in which the attacker starts nothing, goes nowhere, and his
    // weapon is not on its way out or back (a held clip counts as still: that is what the hold is).
    const busy: [number, number][] = [];
    for (const cue of sequence.tracks.attacker) {
      const at = seconds(sequence, cue.at);
      if (cue.do === "move") busy.push([at, at + cue.duration]);
      else if (cue.do === "face") busy.push([at, at + (cue.duration ?? 0.2)]);
      else if (cue.do === "clip") {
        const id = cue.clip.prefer![0], info = HELD[id];
        if (id === "ready.guard") busy.push([at, at + (cue.fade ?? 0.2)]);
        else if (cue.via) { busy.push([at, seconds(sequence, cue.via.to) + 0.06], [seconds(sequence, cue.via.resume), seconds(sequence, cue.sync!.to)]); }
        else busy.push([at, at + (info.events.recovery ?? info.duration)]);
      }
    }
    let still = 0;
    for (let from = sequence.markers.clash; from < sequence.markers.decisive; from += 0.01) {
      let to = from;
      while (to < sequence.markers.decisive && !busy.some(([a, b]) => to >= a - 1e-9 && to < b - 1e-9)) to += 0.01;
      still = Math.max(still, to - from);
    }
    assert.ok(still >= 0.3, `${sequence.id}: the longest still beat is ${still.toFixed(2)} s`);

    // Nobody slides: every pace after the run in is a step or a dodge, which the stage takes on a step clip.
    const paces = [...sequence.tracks.attacker, ...sequence.tracks.defender].filter(cue => cue.do === "move" && seconds(sequence, cue.at) > 0);
    for (const cue of paces) assert.ok(cue.do === "move" && (cue.gait === "step" || cue.gait === "dodge"), sequence.id);
  }
});

test("a fight staged round the shield arm opens the same flank from every direction, both ways up the board", () => {
  const fixed = STANDARD.filter(sequence => sequence.openSide);
  assert.deepEqual(fixed.map(sequence => [sequence.id, sequence.openSide]), [["pawn.thrust-block", "attackerLeft"], ["pawn.feint-sidestep", "attackerRight"]]);
  for (const sequence of fixed) for (const [color, from, to] of [["w", "e4", "d5"], ["w", "e4", "f5"], ["b", "d5", "e4"], ["b", "d5", "c4"], ["w", "b5", "a6"], ["w", "g5", "h6"]] as const) {
    const token = v2Record(sequence.id);
    const plan = directPawnDuel({ color, from, to, victim: to, armies: MOVE.armies, sanMoves: ["x"], comment: token }).direction as CombatPlan;
    assert.equal(plan.sequenceId, sequence.id);
    assert.equal(plan.geometry.side, sequence.openSide === "attackerRight" ? 1 : -1, `${sequence.id} ${from}${to}`);
    // The flank really is that hand of the attacker: his right is (rank, -file) of the way he is heading.
    const right = { file: plan.geometry.heading.rank, rank: -plan.geometry.heading.file };
    assert.ok(Math.abs(plan.geometry.lateral.file - right.file * plan.geometry.side) < 1e-12 && Math.abs(plan.geometry.lateral.rank - right.rank * plan.geometry.side) < 1e-12);
  }
});

// ---------------------------------------------------------------- floor travel

test("a pace is taken on the clip that goes that way", () => {
  const north = { x: 0, z: -1 };
  // The left of a figure facing along (x, z) is (z, -x).
  assert.equal(travelHeading(north, { x: 0, z: -0.3 }), "forward");
  assert.equal(travelHeading(north, { x: 0, z: 0.3 }), "back");
  assert.equal(travelHeading(north, { x: -0.3, z: 0 }), "left");
  assert.equal(travelHeading(north, { x: 0.3, z: 0.05 }), "right");
  assert.equal(travelHeading({ x: 1, z: 0 }, { x: 0, z: -0.3 }), "left");
  for (const gait of ["step", "dodge"] as const) for (const id of Object.values(TRAVEL_CLIPS[gait])) assert.ok(V2.has(id), id);
  assert.equal(TRAVEL_CLIPS.step.back, "ready.step-back"); assert.equal(TRAVEL_CLIPS.dodge.back, "defend.dodge-back");
  assert.equal(TRAVEL_CLIPS.step.forward, "ready.step-forward");
});

/** The animations of a shipped GLB as the keyframe tracks three.js would hand the loader. */
function glbClips(library: string, rig: string): { name: string; duration: number; tracks: { name: string; times: Float32Array; values: Float32Array; getValueSize(): number }[] }[] {
  const bytes = readFileSync(new URL(`../../web/src/assets/chess/${library}/${rig}.glb`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const bin = bytes.subarray(20 + jsonLength + 8);
  const floats = (index: number): Float32Array => {
    const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type as "SCALAR" | "VEC3" | "VEC4"];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return new Float32Array(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + accessor.count * size * 4));
  };
  return json.animations.map((animation: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }) => {
    const tracks = animation.channels.map(channel => {
      const sampler = animation.samplers[channel.sampler], path = channel.target.path === "translation" ? "position" : channel.target.path === "rotation" ? "quaternion" : channel.target.path;
      return { name: `${json.nodes[channel.target.node].name}.${path}`, times: floats(sampler.input), values: floats(sampler.output), getValueSize: () => (path === "quaternion" ? 4 : 3) };
    });
    return { name: animation.name, duration: Math.max(...tracks.map(track => track.times[track.times.length - 1])), tracks };
  });
}

test("floor travel is read from the pelvis of the shipped clips: steps and dodges go somewhere, blows and deaths do not", () => {
  for (const rig of ["wp", "bp", "ep", "kp"]) {
    const clips = glbClips("combat-v2", rig), meta = new Map(sidecar("combat-v2", rig).clips.map(clip => [clip.id, clip]));
    assert.equal(clips.length, 30);
    const travel = (id: string) => rootTravelOf(clips.find(clip => clip.name === id) as never);
    // In place: the blows, the guard, the hits. Deaths keep their travel in the pelvis: the body lies where it falls.
    for (const id of ["attack.thrust", "attack.jab", "attack.bash", "ready.feint", "ready.guard", "hit.recoil", "hit.front", "defend.block-impact", "death.backward", "death.collapse", "death.left"]) assert.equal(travel(id), undefined, `${rig} ${id}`);
    const pelvis = clips[0].tracks.find(track => track.name === "Hips.position")!;
    for (const id of ["ready.step-forward", "ready.step-back", "defend.dodge-left", "defend.dodge-right", "defend.dodge-back"]) {
      const found = travel(id), net = meta.get(id)!.rootTravel!.net;
      assert.ok(found, `${rig} ${id}`);
      // The same direction and the same length as the sidecar records (it is in squares, the track in the rig's own units).
      const length = Math.hypot(found.net.x, found.net.z), recorded = Math.hypot(net[0], net[1]);
      const unit = length / recorded;
      assert.ok(Math.abs(found.net.x / unit - net[0]) < 0.01 && Math.abs(found.net.z / unit - net[1]) < 0.01, `${rig} ${id}: ${found.net.x / unit}, ${found.net.z / unit} against ${net}`);
      // Rig units per square are the same for every clip of a rig, and a pace is a fraction of the pelvis's height.
      assert.ok(Math.abs(unit / Math.abs(pelvis.values[1]) - 2.9) < 0.6, `${rig} ${id}: ${unit} rig units a square`);
      // Progress starts at nothing, ends exactly at the whole pace, and a sample in between lies between.
      const sample = { x: 0, z: 0, progress: 0 };
      assert.equal(sampleRootTravel(found, 0, sample).progress, 0);
      assert.equal(sampleRootTravel(found, 99, sample).progress, 1);
      assert.ok(Math.abs(sample.x - found.net.x) < 1e-4 && Math.abs(sample.z - found.net.z) < 1e-4);
      const half = sampleRootTravel(found, found.times[found.times.length - 1] / 2, { x: 0, z: 0, progress: 0 }).progress;
      assert.ok(half > 0.05 && half < 0.98, `${rig} ${id} halfway is ${half}`);
    }
    // The older library's clips are left as they were: none of them is carried.
    assert.ok(travel("ready.step-forward")!.times.length > 10);
  }
});
