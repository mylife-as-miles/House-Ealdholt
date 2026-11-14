import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { combatComment, combatSequenceFromComment } from "./combat-sequences";
import { ARMY_KINGDOMS } from "./match";
import { AUDIO_CUES, KINGDOMS, KINGDOM_NAMES, LIMITS, MARKERS, createCatalog, seconds, validateSequence, type Sequence } from "../../web/src/scene/combat/choreography";
import {
  boardPoint, combatSeed, directCombat, planFromRecord, rememberCombat, resolveGeometry,
  type CombatInput, type CombatMemory, type CombatPlan, type Combatant,
} from "../../web/src/scene/combat/director";
import { CombatControl, KILL_VOLUME, RATE_EASE, SKIP_LEAD, retime, retimeTwoBlows, runCombat, type ClipInfo, type CombatActor, type CombatStage } from "../../web/src/scene/combat/runner";
import { combatRecordFromComment, encodeCombatRecord, packCombatTrack, unpackCombatTrack, withCombatRecord } from "../../web/src/scene/combat/record";
import { CombatAudioLayer } from "../../web/src/scene/combat/audio";
import { CATALOG, PAWN_SEQUENCES } from "../../web/src/scene/combat/sequences/index";

// ---------------------------------------------------------------- fixtures

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
const PAWN_CLIP_NAMES = [...Object.keys(PAWN_CLIPS), "attack", "death", "idle", "walk", "run"];

const pawn = (side: "w" | "b", over: Partial<Combatant> = {}): Combatant =>
  ({ kind: "p", side, kingdom: side === "w" ? "ivory" : "sun", shield: side === "w" ? "iron" : "wood", armed: true, style: "melee", clips: PAWN_CLIP_NAMES, ...over });
const capture = (over: Partial<CombatInput> = {}): CombatInput =>
  ({ attacker: pawn("w"), defender: pawn("b"), geometry: { from: "e4", to: "d5" }, seed: 7, ...over });
const planned = (input: CombatInput, catalog?: readonly Sequence[]): CombatPlan => {
  const plan = directCombat(input, catalog);
  assert.equal(plan.kind, "sequence", plan.kind === "fallback" ? plan.reason : "");
  return plan as CombatPlan;
};
const only = (id: string) => [CATALOG.find(sequence => sequence.id === id)!];

class FakeClock {
  t = 0;
  private waits: { at: number; resolve(): void; reject(error: Error): void }[] = [];
  now = () => this.t;
  wait = (duration: number) => new Promise<void>((resolve, reject) => { this.waits.push({ at: this.t + duration, resolve, reject }); });
  /** A 50 fps scene: time only moves in frames, and promises settle between them. */
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
  /** What pairedCombat's CombatSession does when the board is rebuilt. */
  close(): void { const waits = this.waits; this.waits = []; for (const wait of waits) wait.reject(new Error("CombatCancelled")); }
}

interface Logged { t: number; what: string; detail?: unknown }
function fakeStage(clock: FakeClock, options: { clips?: Record<string, ClipInfo>; generic?: boolean; fall?: () => Promise<void> | void } = {}) {
  const log: Logged[] = [];
  const note = (what: string, detail?: unknown) => { log.push({ t: clock.t, what, detail }); };
  const clips = options.clips ?? PAWN_CLIPS;
  const actor = (name: string): CombatActor => ({
    clip: (role, prefer) => {
      for (const id of prefer) if (clips[id]) return clips[id];
      return options.generic !== false && role === "attack" ? { id: "attack", duration: 1.2, events: { impact: 0.5 } } : null;
    },
    play: (clip, playback) => note(`${name}.play`, { id: clip.id, ...playback }),
    rate: (rate, ease) => note(`${name}.rate`, { rate, ease }),
    pose: (pose, detail) => note(`${name}.pose`, { pose, ...detail }),
    move: (to, detail) => note(`${name}.move`, { to, ...detail }),
    face: (toward, duration) => note(`${name}.face`, { toward, duration }),
    anchor: () => ({ x: name === "attacker" ? 0 : 0.03, y: 1, z: 0 }),
  });
  const stage: CombatStage = {
    clock, attacker: actor("attacker"), defender: actor("defender"),
    begin: () => note("begin"),
    phase: (phase, marker) => note("phase", marker),
    camera: cue => note("camera", cue),
    effect: cue => note("effect", cue.fx),
    audio: cue => note("audio", cue),
    contact: (cue, state) => note(`contact.${state}`, cue.id),
    decisive: (_resolution, plan) => note("decisive", plan.power),
    fall: (_resolution, time) => { note("fall", time); return options.fall?.(); },
    settle: (_resolution, time) => { note("settle", time); },
    finish: status => note("finish", status),
  };
  const names = () => log.map(entry => entry.what);
  const count = (what: string, detail?: unknown) => log.filter(entry => entry.what === what && (detail === undefined || entry.detail === detail)).length;
  const first = (what: string, detail?: unknown) => log.find(entry => entry.what === what && (detail === undefined || entry.detail === detail));
  return { stage, log, names, count, first };
}

// ---------------------------------------------------------------- catalog

test("the shipped catalog is valid, versioned plain data", () => {
  assert.deepEqual(CATALOG.flatMap(validateSequence), []);
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), CATALOG);
  assert.deepEqual([...KINGDOMS].sort(), Object.keys(ARMY_KINGDOMS).sort());
  assert.deepEqual(KINGDOM_NAMES, ARMY_KINGDOMS);
  assert.deepEqual([...AUDIO_CUES], ["clash.shield.wood", "clash.shield.iron", "clash.parry.steel", "bash.shield", "effort.light", "effort.heavy",
    "brace", "recoil", "stagger", "whoosh.light", "whoosh.heavy", "decisive", "fall.light", "fall.heavy"]);
  for (const sequence of CATALOG) {
    assert.ok(sequence.budget.max <= LIMITS.hardCapSeconds);
    const kills = sequence.tracks.audio.filter(cue => cue.cue === "decisive");
    assert.equal(kills.length, 1, sequence.id);
    assert.ok(!sequence.fits.defender.includes("k"), "a king is never captured");
    assert.ok(sequence.resolution, "every sequence is a capture: checkmate belongs to the engine's CheckmatePresentation");
  }
  // Three Pawn variations, each with an underdog form of the same family.
  const standard = PAWN_SEQUENCES.filter(sequence => sequence.tier === "standard"), underdog = PAWN_SEQUENCES.filter(sequence => sequence.tier === "underdog");
  assert.deepEqual(standard.map(sequence => sequence.id), ["pawn.thrust-block", "pawn.feint-sidestep", "pawn.bash-thrust"]);
  assert.deepEqual(underdog.map(sequence => sequence.family), standard.map(sequence => sequence.id));
  // Long enough for two separate blows with a beat between them, short enough that the board is free about 4 s after the click.
  for (const sequence of standard) assert.ok(sequence.budget.seconds >= 2.7 && sequence.budget.seconds <= 3.05 && sequence.markers.decisive <= 2.3, sequence.id);
  // The first blow and the killing blow are more than a second apart, and every clip is asked for near its own speed.
  for (const sequence of standard) assert.ok(sequence.markers.decisive - sequence.markers.clash >= 1.1, sequence.id);
  for (const sequence of underdog) assert.ok(sequence.budget.seconds > 3.8 && sequence.tracks.attacker.length > standard[0].tracks.attacker.length - 1);
});

test("a catalog refuses entries that break the rules of a capture", () => {
  const good = PAWN_SEQUENCES[0];
  const broken = (change: (sequence: Sequence) => void) => { const copy = structuredClone(good) as Sequence; change(copy); return validateSequence(copy); };
  assert.match(broken(s => { (s.tracks.audio as unknown[]).push({ at: { marker: "counter" }, cue: "decisive" }); }).join(), /killing strike/);
  assert.match(broken(s => { (s.tracks.audio as unknown[]).push({ at: { marker: "clash" }, cue: "scream" }); }).join(), /unknown audio cue/);
  assert.match(broken(s => { (s.fits as unknown as { defender: string[] }).defender = ["k"]; }).join(), /never captured/);
  assert.match(broken(s => { (s.markers as Record<string, number>).counter = 0.1; }).join(), /out of order/);
  assert.match(broken(s => { (s.budget as { max: number }).max = 9; }).join(), /budget/);
  assert.match(broken(s => { (s.tracks.defender as unknown[]).push({ at: { marker: "fall" }, do: "pose", pose: "brace" }); }).join(), /dead after/);
  assert.match(broken(s => { (s.tracks.defender as unknown[]).push({ at: { marker: "clash" }, do: "move", to: { ref: "defender", along: 2 }, duration: 0.2, gait: "step" }); }).join(), /strays/);
  assert.throws(() => createCatalog([good, good]), /duplicate id/);
});

// ---------------------------------------------------------------- selection

test("the same seed and circumstances always choose the same fight", () => {
  const input = capture({ seed: combatSeed(["e4", "d5", "exd5"]) });
  assert.deepEqual(directCombat(input), directCombat(structuredClone(input)));
  assert.equal(combatSeed(["e4", "d5", "exd5"]), combatSeed(["e4", "d5", "exd5"]));
  assert.notEqual(combatSeed(["e4", "d5", "exd5"]), combatSeed(["e4", "e5", "Nf3"]));
  const chosen = new Set(Array.from({ length: 60 }, (_, seed) => planned(capture({ seed })).sequenceId));
  assert.deepEqual([...chosen].sort(), ["pawn.bash-thrust", "pawn.feint-sidestep", "pawn.thrust-block"]);
  // The plan itself is plain data too.
  const plan = planned(input);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test("a matchup never repeats a variation back to back, and neither does one piece", () => {
  let history: CombatMemory[] = [];
  const families: string[] = [];
  for (let ply = 0; ply < 60; ply += 1) {
    const input = capture({ seed: combatSeed([`move-${ply}`]), context: { history } });
    const plan = planned(input);
    families.push(plan.family);
    history = rememberCombat(history, input, plan);
  }
  for (let i = 1; i < families.length; i += 1) assert.notEqual(families[i], families[i - 1], `fight ${i} repeated ${families[i]}`);
  assert.equal(new Set(families).size, 3);
  assert.ok(history.length <= 8);
  // The same piece is remembered across matchups: its underdog kill avoids the family it used last.
  for (let seed = 0; seed < 40; seed += 1) {
    const first = capture({ attacker: pawn("w", { id: "w-e2" }), seed });
    const before = planned(first);
    const queen: Combatant = { kind: "q", side: "b", kingdom: "sun", armed: true, shield: null };
    const next = planned(capture({ attacker: pawn("w", { id: "w-e2" }), defender: queen, seed, context: { history: rememberCombat([], first, before) } }));
    assert.notEqual(next.family, before.family);
  }
});

test("nothing fits, or the clips are missing: the engine is told to fall back", () => {
  const reason = (input: CombatInput) => { const plan = directCombat(input); assert.equal(plan.kind, "fallback"); assert.equal(plan.record, ""); return plan.kind === "fallback" ? plan.reason : ""; };
  const knight: Combatant = { kind: "n", side: "w", kingdom: "ivory", armed: true, style: "melee", clips: ["attack", "death", "walk", "run", "idle"] };
  assert.match(reason(capture({ defender: { kind: "k", side: "b", kingdom: "sun" } })), /never captured/);
  assert.match(reason(capture({ attacker: pawn("w", { style: "gun" }) })), /no sequence fits/);
  assert.match(reason(capture({ defender: { kind: "n", side: "b", kingdom: "sun" } })), /no sequence fits/);
  assert.match(reason(capture({ attacker: pawn("w", { clips: ["idle", "walk"] }) })), /clips missing: attacker lacks attack/);
  // The other classes are catalog data that waits for its clips and stage abilities.
  assert.match(reason(capture({ attacker: knight, geometry: { from: "g1", to: "f3" } })), /clips missing: attacker lacks attack\./);
  assert.match(reason(capture({ attacker: { ...knight, clips: undefined }, geometry: { from: "g1", to: "f3" } })), /clips missing/);
  assert.match(reason(capture({ attacker: { kind: "b", side: "w", kingdom: "ivory", style: "spell", clips: ["cast.bolt-double"] }, geometry: { from: "c1", to: "g5" } })), /stage lacks projectile/);
  assert.match(reason(capture({ geometry: { from: "e4", to: "e4" } })), /bad squares/);
  assert.match(reason(capture({ defender: pawn("w") })), /one army/);
  const ready = planned(capture({ attacker: { ...knight, clips: [...knight.clips!, "attack.leap-strike", "attack.charge-break", "attack.riposte"] }, geometry: { from: "g1", to: "f3" } }));
  assert.ok(ready.sequenceId.startsWith("knight."));
  assert.equal(ready.geometry.knightJump, true);
  assert.ok(combatRecordFromComment(ready.record), "other classes use the version-2 record");
  // A pawn with no shield cannot bash; a rig with only a generic attack still fights.
  for (let seed = 0; seed < 30; seed += 1) {
    assert.notEqual(planned(capture({ attacker: pawn("w", { shield: null }), seed })).sequenceId, "pawn.bash-thrust");
    assert.equal(planned(capture({ attacker: pawn("w", { clips: ["attack", "death"] }), seed })).kind, "sequence");
  }
});

test("kingdom rites and named styles are catalog entries, chosen only for whom they fit", () => {
  const queen = (kingdom: "ivory" | "sun"): Combatant => ({ kind: "q", side: "w", kingdom, style: "spell", clips: ["attack", "death"] });
  const far = { from: "d1", to: "d7" };
  const rite = planned(capture({ attacker: queen("ivory"), geometry: far, context: { stage: ["rite"] } }));
  assert.equal(rite.sequenceId, "queen.wyvern-run");
  assert.equal(rite.effects.find(cue => cue.fx === "rite")?.id, "aethelgard.queen.wyvern-run");
  assert.equal(directCombat(capture({ attacker: queen("sun"), geometry: far, context: { stage: ["rite"] } })).kind, "fallback");
  assert.equal(directCombat(capture({ attacker: queen("ivory"), geometry: far })).kind, "fallback");
  // Cael fights his own way when his clip exists; anyone else of his class does not.
  const cael = pawn("w", { identity: "cael", clips: [...PAWN_CLIP_NAMES, "attack.cael-riposte"] });
  for (let seed = 0; seed < 20; seed += 1) {
    assert.equal(planned(capture({ attacker: cael, seed })).sequenceId, "cael.lowland-riposte");
    assert.ok(planned(capture({ attacker: { ...cael, identity: undefined }, seed })).sequenceId.startsWith("pawn."));
    assert.ok(planned(capture({ attacker: pawn("w", { identity: "cael" }), seed })).sequenceId.startsWith("pawn."), "no clip: his class catalog");
  }
});

test("a Pawn that fells a Rook or a Queen gets the underdog variant: longer, more beats", () => {
  const queen: Combatant = { kind: "q", side: "b", kingdom: "sun", armed: true, shield: null };
  const standard = planned(capture());
  for (let seed = 0; seed < 40; seed += 1) {
    const plan = planned(capture({ defender: queen, seed }));
    assert.equal(plan.tier, "underdog");
    assert.ok(plan.sequenceId.endsWith(".underdog") && plan.family.startsWith("pawn."));
    assert.ok(plan.seconds > standard.seconds + 0.9 && plan.seconds <= plan.cap && plan.cap <= LIMITS.hardCapSeconds);
    assert.ok(plan.attacker.length > standard.attacker.length);
    assert.equal(plan.resolution?.weight, "heavy");
    assert.ok(combatRecordFromComment(plan.record));
  }
  assert.equal(planned(capture({ defender: { kind: "r", side: "b", kingdom: "sun", shield: "wood" } })).tier, "underdog");
  // The gap can be supplied (a promoted piece, a house rule) without changing the kinds.
  assert.equal(directCombat(capture({ defender: queen, context: { valueGap: 0 } })).kind, "fallback");
});

// ---------------------------------------------------------------- geometry

test("every sequence mirrors correctly from all eight directions, both armies, with identical timing", () => {
  const directions: [string, string, number, number][] = [
    ["N", "d5", 0, 1], ["NE", "e5", 1, 1], ["E", "e4", 1, 0], ["SE", "e3", 1, -1],
    ["S", "d3", 0, -1], ["SW", "c3", -1, -1], ["W", "c4", -1, 0], ["NW", "c5", -1, 1],
  ];
  for (const sequence of PAWN_SEQUENCES) {
    const defender: Combatant = sequence.tier === "underdog" ? { kind: "q", side: "b", kingdom: "sun", shield: "wood" } : pawn("b");
    const authored = [...sequence.tracks.attacker, ...sequence.tracks.defender].filter(cue => cue.do === "move");
    const times = authored.map(cue => seconds(sequence, cue.at)).sort((a, b) => a - b);
    let reference: CombatPlan | null = null;
    for (const [compass, victim, df, dr] of directions) for (const side of ["w", "b"] as const) for (const seed of [2, 3]) {
      const plan = planned({ attacker: pawn(side), defender: { ...defender, side: side === "w" ? "b" : "w" }, geometry: { from: "d4", to: victim }, seed }, [sequence]);
      const g = plan.geometry, length = Math.hypot(df, dr);
      assert.equal(g.compass, compass);
      assert.ok(Math.abs(g.heading.file - df / length) < 1e-12 && Math.abs(g.heading.rank - dr / length) < 1e-12);
      // The flank is a unit vector square to the attack line: the attacker's right, or mirrored to its left.
      assert.ok(Math.abs(g.lateral.file - g.side * g.heading.rank) < 1e-12 && Math.abs(g.lateral.rank + g.side * g.heading.file) < 1e-12);
      // ...and it faces the middle of the board, so no sidestep leaves it; a fight staged round the shield arm names
      // its own flank instead, the same one from every direction, and keeps its sidesteps inside half a square.
      const file = victim.charCodeAt(0) - 97, rank = Number(victim[1]) - 1;
      if (sequence.openSide) {
        assert.equal(g.side, sequence.openSide === "attackerRight" ? 1 : -1, `${sequence.id} ${compass}`);
        for (const cue of authored) assert.ok(cue.do !== "move" || Math.abs(cue.to.side ?? 0) <= 0.5);
      } else assert.ok(g.lateral.file * (3.5 - file) + g.lateral.rank * (3.5 - rank) >= -1e-9);
      // Every authored place lands where the duel frame says, for this direction.
      const moves = [...plan.attacker, ...plan.defender].filter(cue => cue.do === "move");
      assert.equal(moves.length, authored.length);
      for (const cue of authored) {
        if (cue.do !== "move") continue;
        const expected = { file: (cue.to.along ?? 0) * g.heading.file + (cue.to.side ?? 0) * g.lateral.file, rank: (cue.to.along ?? 0) * g.heading.rank + (cue.to.side ?? 0) * g.lateral.rank };
        assert.ok(moves.some(move => move.do === "move" && move.to.ref === cue.to.ref && Math.abs(move.to.file - expected.file) < 1e-12 && Math.abs(move.to.rank - expected.rank) < 1e-12
          && Math.abs(move.at - seconds(sequence, cue.at)) < 1e-12), `${sequence.id} ${compass}`);
        assert.ok(Math.abs(Math.hypot(expected.file, expected.rank) - Math.hypot(cue.to.along ?? 0, cue.to.side ?? 0)) < 1e-12, "a rotation, never a stretch");
      }
      assert.deepEqual(moves.map(move => move.at).sort((a, b) => a - b), times);
      // Timing does not depend on direction, army, seed or mirroring.
      const timing = (p: CombatPlan) => ({ markers: p.markers, seconds: p.seconds, cap: p.cap, audio: p.audio.map(cue => [cue.cue, cue.at]), camera: p.camera.map(cue => cue.at),
        attacker: p.attacker.map(cue => [cue.do, cue.at]), defender: p.defender.map(cue => [cue.do, cue.at]), contacts: p.contacts.map(cue => [cue.id, cue.at]) });
      reference ??= plan;
      const shielded = (p: CombatPlan) => timing(p);
      if (side === "w") assert.deepEqual(shielded(plan), shielded(reference));
      else assert.deepEqual({ ...timing(plan), audio: 0 }, { ...timing(reference), audio: 0 });
    }
  }
});

test("the two flanks are mirror images, and en passant aims at the pawn, not the empty square", () => {
  const squares = { from: "d4", to: "e5" };
  const right = resolveGeometry(squares, 0, 1)!, left = resolveGeometry(squares, 0, -1)!;
  const place = { ref: "standoff" as const, along: -0.3, side: 0.24 };
  const a = boardPoint(place, right), b = boardPoint(place, left);
  const along = (p: { file: number; rank: number }) => p.file * right.heading.file + p.rank * right.heading.rank;
  const across = (p: { file: number; rank: number }) => p.file * right.heading.rank - p.rank * right.heading.file;
  assert.ok(Math.abs(along(a) - along(b)) < 1e-12 && Math.abs(across(a) + across(b)) < 1e-12 && Math.abs(across(a) - 0.24) < 1e-12);
  // On the long diagonal neither flank is nearer the middle: the seed decides, and is recorded.
  assert.deepEqual([resolveGeometry({ from: "c3", to: "d4" }, 0)!.side, resolveGeometry({ from: "c3", to: "d4" }, 1)!.side], [-1, 1]);
  // At the edge the open flank is always inward.
  assert.ok(resolveGeometry({ from: "b4", to: "a5" }, 0)!.lateral.file > 0 && resolveGeometry({ from: "b4", to: "a5" }, 1)!.lateral.file > 0);
  const passing = planned(capture({ geometry: { from: "e5", to: "d6", victim: "d5" } }));
  assert.equal(passing.geometry.enPassant, true);
  assert.equal(passing.geometry.compass, "W");
  assert.deepEqual(passing.geometry.heading, { file: -1, rank: 0 });
  assert.equal(passing.geometry.to, "d6");
});

test("exhibition speed scales every time and nothing else, within limits", () => {
  const normal = planned(capture(), only("pawn.thrust-block")), fast = planned(capture({ context: { speed: 2 } }), only("pawn.thrust-block"));
  assert.ok(Math.abs(fast.seconds - normal.seconds / 2) < 1e-12 && fast.timeScale === 0.5);
  for (const marker of MARKERS) assert.ok(Math.abs(fast.markers[marker] - normal.markers[marker] / 2) < 1e-12);
  assert.deepEqual(fast.attacker.map(cue => cue.at * 2), normal.attacker.map(cue => cue.at));
  assert.deepEqual(fast.attacker.map(cue => cue.do === "move" ? cue.to : null), normal.attacker.map(cue => cue.do === "move" ? cue.to : null));
  const absurd = planned(capture({ context: { speed: 1000 } }), only("pawn.thrust-block"));
  assert.ok(absurd.seconds >= LIMITS.minSeconds - 1e-9);
  const slow = planned(capture({ defender: { kind: "q", side: "b", kingdom: "sun" }, context: { speed: 0.01 } }));
  assert.ok(slow.cap <= LIMITS.hardCapSeconds && slow.cap >= slow.seconds - 1e-9 || slow.seconds > LIMITS.hardCapSeconds);
  // Decoration is dropped on the low preset and at high speed; the fight is not.
  const plain = planned(capture({ context: { detail: false } }), only("pawn.thrust-block"));
  assert.equal(plain.effects.length, normal.effects.length - 1);
  assert.deepEqual(plain.audio, normal.audio);
  // Sound follows what the defender holds.
  const clash = (shield: "wood" | "iron" | null) => planned(capture({ defender: pawn("b", { shield }) }), only("pawn.thrust-block")).audio.filter(cue => cue.cue.startsWith("clash.")).map(cue => cue.cue);
  assert.deepEqual([clash("wood"), clash("iron"), clash(null)], [["clash.shield.wood"], ["clash.shield.iron"], ["clash.parry.steel"]]);
});

// ---------------------------------------------------------------- runner

test("the runner plays a Pawn fight on the stage clock, with both rigs on the same contact frame", async () => {
  const clock = new FakeClock(), { stage, log, names, count, first } = fakeStage(clock);
  const plan = planned(capture(), only("pawn.thrust-block"));
  const running = runCombat(plan, stage);
  await clock.advance(3);
  const outcome = await running;
  assert.equal(outcome.status, "completed");
  assert.ok(outcome.killed && Math.abs(outcome.elapsed - plan.seconds) <= 0.021, `elapsed ${outcome.elapsed}`);
  // The jab, the thrust and the guards are played near each clip's own speed, not hurried onto their markers.
  assert.ok((outcome.rates ?? []).length >= 3 && outcome.rates!.every(item => item.rate >= 0.8 && item.rate <= 1.25), JSON.stringify(outcome.rates));
  // Two blows, two clips: a quick jab for the shield, then the committed thrust that kills.
  assert.deepEqual(log.filter(entry => entry.what === "attacker.play").map(entry => (entry.detail as { id: string }).id), ["attack.jab", "attack.thrust"]);
  // The ending is structural: kill sound, blow, fall, claim, finish. Once each, in order.
  const order = ["begin", "decisive", "fall", "settle", "finish"].map(what => names().indexOf(what));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const what of ["begin", "decisive", "fall", "settle", "finish"]) assert.equal(count(what), 1, what);
  assert.equal(count("audio", "decisive"), 1);
  assert.deepEqual([log[names().indexOf("decisive") - 1].what, log[names().indexOf("decisive") - 1].detail], ["audio", "decisive"], "the strike sounds with the blow");
  assert.equal(names().at(-1), "finish");
  assert.equal(first("finish")!.detail, "completed");
  // Markers arrive on time (one 20 ms frame of slack), in order.
  const phases = log.filter(entry => entry.what === "phase");
  assert.deepEqual(phases.map(entry => entry.detail), [...MARKERS]);
  for (const entry of phases) assert.ok(Math.abs(entry.t - plan.markers[entry.detail as keyof typeof plan.markers]) <= 0.021);
  // Spear and shield: the thrust's contact frame and the block's guard frame both land on `clash`.
  const plays = log.filter(entry => entry.what.endsWith(".play")).map(entry => ({ who: entry.what, t: entry.t, ...(entry.detail as { id: string; rate: number }) }));
  const jab = plays.find(play => play.who === "attacker.play")!, block = plays.find(play => play.who === "defender.play")!;
  assert.equal(jab.id, "attack.jab"); assert.equal(block.id, "defend.block-mid");
  assert.ok(Math.abs(jab.t + PAWN_CLIPS["attack.jab"].events.contact / jab.rate - plan.markers.clash) <= 0.021);
  assert.ok(Math.abs(block.t + PAWN_CLIPS["defend.block-mid"].events.guard / block.rate - plan.markers.clash) <= 0.021);
  const second = plays.filter(play => play.who === "attacker.play")[1];
  assert.equal(second.id, "attack.thrust");
  assert.ok(Math.abs(second.t + PAWN_CLIPS["attack.thrust"].events.contact / second.rate - plan.markers.decisive) <= 0.021);
  for (const play of plays) assert.ok(play.rate >= 0.5 && play.rate <= 2.5, `${play.id} at ${play.rate}`);
  // Contacts were aimed, measured and released.
  assert.deepEqual(outcome.contacts.map(contact => contact.id), ["first", "kill"]);
  assert.ok(outcome.contacts.every(contact => contact.error !== null && contact.error < 0.05));
  assert.equal(count("contact.aim"), 2); assert.equal(count("contact.release"), 2);
  // Nothing happens to the defender after it is dead.
  const dead = log.findIndex(entry => entry.what === "decisive");
  assert.ok(log.slice(dead + 1).every(entry => !entry.what.startsWith("defender.")));
});

test("clip retiming lands the authored event on the marker and stays in range", () => {
  // The retiming arithmetic, on a clip whose contact is 0.8 s in.
  const thrust: ClipInfo = { id: "attack.thrust", duration: 1.4, events: { contact: 0.8, impact: 0.8 } };
  const fitted = retime(thrust, ["impact"], 0.2, 0.8, 1);
  assert.ok(Math.abs(fitted.start - 0.2) < 1e-12 && Math.abs(fitted.rate - 0.8 / 0.6) < 1e-12);
  const late = retime(thrust, ["impact"], 0, 4, 1);   // far too early: start later instead of crawling
  assert.equal(late.rate, 0.5); assert.ok(Math.abs(late.start + 0.8 / late.rate - 4) < 1e-12);
  const tight = retime(thrust, ["impact"], 0.9, 1, 1); // too late: start earlier at the fastest sane rate
  assert.equal(tight.rate, 2.5); assert.ok(Math.abs(tight.start + 0.8 / tight.rate - 1) < 1e-12);
  assert.deepEqual(retime(thrust, ["nothing"], 0.3, 1, 0.5), { start: 0.3, rate: 2 });
  const doubled = retime(thrust, ["impact"], 0.1, 0.4, 0.5);
  assert.ok(Math.abs(doubled.start + 0.8 / doubled.rate - 0.4) < 1e-12 && doubled.rate <= 5);
});

test("undo or reset cancels between beats: nothing more fires and the stage snaps to its final state", async () => {
  for (const how of ["control", "session"] as const) {
    const clock = new FakeClock(), { stage, log, count } = fakeStage(clock), control = new CombatControl();
    const running = runCombat(planned(capture(), only("pawn.thrust-block")), stage, control);
    await clock.advance(1);
    const before = log.length;
    if (how === "control") control.cancel(); else clock.close();
    const outcome = await running;
    assert.equal(outcome.status, "cancelled");
    assert.equal(outcome.killed, false);
    assert.deepEqual(log.slice(before).map(entry => [entry.what, entry.detail]), [["finish", "cancelled"]]);
    assert.equal(count("finish"), 1);
    assert.equal(count("decisive") + count("fall") + count("settle") + count("audio", "decisive"), 0);
    await clock.advance(3);
    assert.equal(log.at(-1)!.what, "finish", "a cancelled fight stays cancelled");
    assert.equal(count("finish"), 1, "finish(\"cancelled\") exactly once, however the wait ended");
  }
  // Cancelled before it began: still exactly one finish.
  const clock = new FakeClock(), { stage, names } = fakeStage(clock), control = new CombatControl();
  control.cancel();
  assert.equal((await runCombat(planned(capture()), stage, control)).status, "cancelled");
  assert.deepEqual(names(), ["begin", "finish"]);
});

test("skip fast-forwards to the killing blow and still plays the resolution", async () => {
  const clock = new FakeClock(), { stage, log, count, first } = fakeStage(clock), control = new CombatControl();
  const plan = planned(capture(), only("pawn.thrust-block"));
  const running = runCombat(plan, stage, control);
  await clock.advance(0.3);
  const before = log.length;
  control.skip();
  await new Promise(resolve => setImmediate(resolve)); // the runner reacts before the next frame
  await clock.advance(2);
  const outcome = await running;
  assert.equal(outcome.status, "skipped");
  assert.ok(outcome.killed);
  // Jumped from 0.3 s to just short of the killing blow, then ran in real time.
  const windUp = plan.markers.decisive - SKIP_LEAD, expected = 0.3 + (plan.seconds - windUp);
  assert.ok(Math.abs(outcome.elapsed - expected) <= 0.045, `elapsed ${outcome.elapsed} expected ${expected}`);
  const instant = log.slice(before).filter(entry => entry.t <= 0.3 + 1e-9);
  // What is started at once is the killing thrust itself, and the defender in the clip the exchange had left him in
  // (here his own counter with the shield, most of the way through it).
  const started = instant.filter(entry => entry.what.endsWith(".play")).map(entry => [entry.what, (entry.detail as { id: string }).id]);
  assert.deepEqual(started, [["attacker.play", "attack.thrust"], ["defender.play", "attack.bash"]]);
  const counter = instant.find(entry => entry.what === "defender.play")!.detail as { from: number };
  assert.ok(counter.from > 0.5 && counter.from < PAWN_CLIPS["attack.bash"].duration);
  const skippedOver = instant.filter(entry => !entry.what.endsWith(".play"));
  assert.ok(skippedOver.length > 0);
  // Figures are placed, not animated; the exchange's sounds, sparks and poses are dropped.
  for (const entry of skippedOver) {
    assert.ok(["attacker.move", "defender.move", "attacker.face", "defender.face", "camera", "phase"].includes(entry.what), entry.what);
    // (The camera's push-in on the blow starts exactly where the skip lands, so it plays as authored.)
    if (entry.what.endsWith(".move")) assert.equal((entry.detail as { duration: number }).duration, 0);
  }
  assert.equal(count("audio", "clash.shield.wood"), 0); assert.equal(count("effect"), 0);
  // The killing thrust, the kill and the claim all play, once.
  const kill = log.filter(entry => entry.what === "attacker.play").at(-1)!;
  const joined = kill.detail as { rate: number; from?: number };
  assert.ok(Math.abs(kill.t - 0.3) < 1e-9 && Math.abs(kill.t + (PAWN_CLIPS["attack.thrust"].events.contact - (joined.from ?? 0)) / joined.rate - first("decisive")!.t) <= 0.021);
  for (const what of ["decisive", "fall", "settle", "finish"]) assert.equal(count(what), 1, what);
  assert.equal(count("audio", "decisive"), 1);
  assert.equal(first("finish")!.detail, "skipped");
  // Skipping once the blow has landed cuts nothing out: the fight completes (the stage is asked to hurry the rest).
  const late = new FakeClock(), other = fakeStage(late), again = new CombatControl();
  const second = runCombat(plan, other.stage, again);
  await late.advance(plan.markers.decisive + 0.05); again.skip(); await late.advance(2);
  assert.equal((await second).status, "completed");
});

test("the hard duration cap ends a fight that will not end, with the capture still made", async () => {
  // A death that never finishes (a stuck clip, a lost promise).
  const clock = new FakeClock(), { stage, count, first } = fakeStage(clock, { fall: () => new Promise<void>(() => {}) });
  const plan = planned(capture(), only("pawn.thrust-block"));
  const running = runCombat(plan, stage);
  await clock.advance(8);
  const outcome = await running;
  assert.equal(outcome.status, "capped");
  assert.ok(outcome.elapsed <= plan.cap + 0.021 && outcome.elapsed >= plan.seconds, `elapsed ${outcome.elapsed}`);
  for (const what of ["decisive", "fall", "settle", "finish"]) assert.equal(count(what), 1, what);
  assert.equal(first("finish")!.detail, "capped");
  // A cap shorter than the fight: the kill is delivered at once, exactly once, then it ends.
  const short = new FakeClock(), cut = fakeStage(short);
  const hurried = runCombat({ ...plan, cap: 1 }, cut.stage);
  await short.advance(3);
  const capped = await hurried;
  assert.equal(capped.status, "capped");
  assert.ok(capped.killed && capped.elapsed <= 1.021);
  for (const what of ["decisive", "fall", "settle", "finish"]) assert.equal(cut.count(what), 1, what);
  assert.equal(cut.count("audio", "decisive"), 1);
  assert.equal(cut.first("fall")!.detail, 0);
  assert.equal(cut.names().at(-1), "finish");
  // No catalog entry can ask for more than the hard cap, at any speed.
  for (const sequence of CATALOG) assert.ok(sequence.budget.max <= LIMITS.hardCapSeconds);
});

test("a rig without the clips: the runner refuses before touching the stage, or degrades to poses", async () => {
  const clock = new FakeClock(), bare = fakeStage(clock, { clips: {}, generic: false });
  const outcome = await runCombat(planned(capture()), bare.stage);
  assert.equal(outcome.status, "fallback");
  assert.match(outcome.reason!, /attacker has no attack clip/);
  assert.deepEqual(bare.names(), []);
  // Only a generic attack clip: the fight still runs, blocks become procedural poses.
  const generic = fakeStage(clock, { clips: {} });
  const running = runCombat(planned(capture(), only("pawn.thrust-block")), generic.stage);
  await clock.advance(3);
  assert.equal((await running).status, "completed");
  assert.ok(generic.log.some(entry => entry.what === "defender.pose" && (entry.detail as { pose: string }).pose === "block"));
  assert.ok(generic.log.filter(entry => entry.what === "attacker.play").every(entry => (entry.detail as { id: string }).id === "attack"));
  // A stage error is not swallowed: finish("failed"), then the engine's own catch takes over.
  const broken = fakeStage(new FakeClock());
  broken.stage.decisive = () => { throw new Error("effect exploded"); };
  const failing = runCombat({ ...planned(capture()), cap: 0 }, broken.stage);
  await assert.rejects(failing, /effect exploded/);
  assert.equal(broken.first("finish")!.detail, "failed");
});

// ---------------------------------------------------------------- witnesses

test("witnesses belong to the engine: a plan schedules none, and decisive fires once with the plan's power", async () => {
  const queen: Combatant = { kind: "q", side: "b", kingdom: "sun" }, rook: Combatant = { kind: "r", side: "b", kingdom: "sun", shield: "wood" };
  const plain = planned(capture(), only("pawn.thrust-block")), upset = planned(capture({ defender: queen })), hard = planned(capture({ defender: rook }));
  for (const plan of [plain, upset, hard]) {
    // Nothing in the plan addresses a third piece: only the two fighters, the camera, effects, audio and contacts.
    assert.deepEqual(Object.keys(plan).sort(), ["animationLibrary", "attacker", "audio", "camera", "cap", "choreography", "contacts", "defender", "effects", "family", "geometry", "kind",
      "markers", "power", "record", "resolution", "seconds", "seed", "sequenceId", "tier", "timeScale", "version"].filter(key => key !== "choreography" || plan.choreography));
    assert.ok(!/bystander|witness|nearby/i.test(JSON.stringify(plan)));
    for (const cue of [...plan.effects, ...plan.contacts]) assert.ok(!("square" in cue));
  }
  // An upset is expressed only as power: x1.15 from a gap of 4, x1.35 from a gap of 8, never above 2.
  const base = (plan: CombatPlan) => CATALOG.find(sequence => sequence.id === plan.sequenceId)!.resolution.power;
  assert.equal(plain.power, base(plain));
  assert.ok(Math.abs(hard.power - base(hard) * 1.15) < 1e-12);
  assert.ok(Math.abs(upset.power - base(upset) * 1.35) < 1e-12 && upset.power > 1.5 && upset.power <= 2);
  // Every way a fight can complete calls decisive exactly once, with that power.
  for (const [plan, ending] of [[plain, "completed"], [upset, "completed"], [plain, "skipped"], [{ ...plain, cap: 1 }, "capped"]] as const) {
    const clock = new FakeClock(), { stage, count, first, names } = fakeStage(clock), control = new CombatControl();
    const running = runCombat(plan, stage, control);
    await clock.advance(0.2);
    if (ending === "skipped") { control.skip(); await new Promise(resolve => setImmediate(resolve)); }
    await clock.advance(6);
    assert.equal((await running).status, ending);
    assert.equal(count("decisive"), 1, ending);
    assert.equal(first("decisive")!.detail, plan.power);
    assert.equal(count("finish"), 1);
    assert.ok(!names().some(what => what.includes("bystander")));
  }
});

// ---------------------------------------------------------------- replay

test("the record travels with the move and reproduces the same fight", () => {
  // A new v2 Pawn sequence is explicitly versioned rather than reusing a v1 clip tuple.
  for (let seed = 0; seed < 12; seed += 1) {
    const input = capture({ seed }), plan = planned(input);
    assert.ok(plan.choreography);
    assert.equal(plan.animationLibrary, "crownfall-pawn-combat-2");
    assert.deepEqual(combatRecordFromComment(plan.record), { version: 2, sequence: plan.sequenceId, side: plan.geometry.side, seed });
    assert.equal(combatSequenceFromComment(`exd5 ${plan.record}`), undefined);
    assert.deepEqual(planFromRecord(`a note ${plan.record}`, { ...input, context: { history: [{ family: plan.family, matchup: "pxp" }] } }), plan,
      "a replay ignores the live memory: the record decides");
  }
  // Everything else is version 2 of the same token, and carries flank and seed.
  const queen: Combatant = { kind: "q", side: "b", kingdom: "sun" };
  const input = capture({ defender: queen, geometry: { from: "c3", to: "d4" }, seed: 0xfeedf00d });
  const plan = planned(input);
  assert.match(plan.record, /^\[%cfcombat 2 pawn\.[a-z.-]+\.underdog [lr] feedf00d\]$/);
  assert.deepEqual(combatRecordFromComment(plan.record), { version: 2, sequence: plan.sequenceId, side: plan.geometry.side, seed: 0xfeedf00d });
  assert.equal(combatSequenceFromComment(plan.record), undefined, "the version-1 parser ignores it");
  assert.deepEqual(planFromRecord(plan.record, { ...input, seed: 1 }), plan, "flank and seed come from the record, not the replaying client");
  assert.deepEqual(planFromRecord(plan.record, { ...input, seed: 1, context: { speed: 2 } }), planned({ ...input, context: { speed: 2 } }, only(plan.sequenceId)),
    "playback speed is the viewer's choice");
  // Encode / decode.
  for (const record of [{ sequence: "knight.aerial-strike", side: 1 as const, seed: 0 }, { sequence: "queen.wyvern-run", side: -1 as const, seed: 0xffffffff }])
    assert.deepEqual(combatRecordFromComment(encodeCombatRecord(record)), { version: 2, ...record });
  assert.throws(() => encodeCombatRecord({ sequence: "Bad Id]", side: 1, seed: 1 }));
  assert.throws(() => encodeCombatRecord({ sequence: "pawn.x", side: 1, seed: -1 }));
  for (const junk of ["", null, undefined, "[%cfcombat 3 pawn.x r 1]", "[%cfcombat 2 pawn.x x 1]", "[%cfcombat 2 pawn.x r zz]", "[%cfcombat 2 ../etc r 1]"])
    assert.equal(combatRecordFromComment(junk), null);
  // Unknown, absent or mismatched records fall back; they never throw.
  for (const comment of ["", null, "[%cfcombat 2 pawn.retired-move r 1f]", "[%cfcombat 2 king.checkmate.kneel r 1]"])
    assert.equal(planFromRecord(comment, input).kind, "fallback");
  assert.equal(planFromRecord(plan.record, { ...input, defender: { kind: "k", side: "b", kingdom: "sun" } }).kind, "fallback", "no record can capture a king");
  // The comment keeps its other content and exactly one combat token.
  assert.equal(withCombatRecord("good move [%cfcombat 1 crownfall-pawn-combat-1 attack.thrust defend.parry hit.light death.front]", plan.record), `good move ${plan.record}`);
  assert.equal(withCombatRecord(null, plan.record), plan.record);
  // The parallel-array alternative.
  const track = packCombatTrack([null, "", plan.record, undefined, null]);
  assert.deepEqual(track, ["", "", plan.record]);
  assert.deepEqual(unpackCombatTrack(track, 5), [null, null, plan.record, null, null]);
  assert.deepEqual(unpackCombatTrack(JSON.parse(JSON.stringify(track)), 3), [null, null, plan.record]);
  for (const bad of [null, "x", [1], ["{evil}"], [plan.record, plan.record, plan.record, ""]]) assert.equal(unpackCombatTrack(bad, 3), null);
});

// ---------------------------------------------------------------- audio

test("the audio layer plays the killing strike once and lets nothing talk over the death", () => {
  const heard: string[] = [];
  const layer = new CombatAudioLayer({
    kill: () => { heard.push("kill"); },
    cue: name => { if (name.startsWith("clash.") || name === "effort.heavy") { heard.push(name); return true; } return false; },
    whoosh: options => { heard.push(`whoosh:${options.weight}`); },
    bodyFall: options => { heard.push(`fall:${options.weight}`); },
  });
  assert.equal(layer.play("whoosh.light", 0.6), true);
  assert.equal(layer.play("clash.shield.iron", 0.8), true);
  assert.equal(layer.play("clash.shield.iron", 0.82), false, "no machine-gunning");
  assert.equal(layer.play("brace", 0.9), false, "no recording and no stand-in yet: silent");
  assert.equal(layer.play("decisive", 1.8), true);
  assert.equal(layer.play("decisive", 1.9), false);
  assert.equal(layer.play("decisive", 9), false);
  assert.equal(layer.play("clash.shield.iron", 2), false, "the exchange is over");
  assert.equal(layer.play("fall.heavy", 2.3), true);
  assert.equal(layer.play("effort.heavy", 2.5), true, "the victor may still be heard");
  assert.deepEqual(heard, ["whoosh:0.3", "clash.shield.iron", "kill", "fall:1", "effort.heavy"]);
  assert.deepEqual(layer.played.map(item => item.cue), ["whoosh.light", "clash.shield.iron", "decisive", "fall.heavy", "effort.heavy"]);
  assert.ok(layer.hasKilled);
});

// ---------------------------------------------------------------- the feel pass

test("a skip lands on the blow itself, wherever in the fight it is asked for", async () => {
  for (const at of [0.3, 1.2, 1.9]) {
    const clock = new FakeClock(), { stage, log } = fakeStage(clock), control = new CombatControl();
    const plan = planned(capture(), only("pawn.thrust-block"));
    const running = runCombat(plan, stage, control);
    await clock.advance(at);
    control.skip();
    await new Promise(resolve => setImmediate(resolve));
    const joined = log.filter(entry => entry.what === "attacker.play").at(-1)!;
    const detail = joined.detail as { id: string; rate: number; from?: number };
    // The thrust is joined SKIP_LEAD short of its contact frame, so it is seen to arrive.
    assert.equal(detail.id, "attack.thrust");
    assert.ok(Math.abs((PAWN_CLIPS["attack.thrust"].events.contact - (detail.from ?? 0)) / detail.rate - SKIP_LEAD) < 0.02, `joined at ${detail.from}`);
    await clock.advance(1.5);
    const outcome = await running;
    assert.equal(outcome.status, "skipped");
    const kill = log.find(entry => entry.what === "decisive")!;
    assert.ok(kill.t - at <= SKIP_LEAD + 0.05, `kill ${kill.t - at} s after a skip at ${at}`);
  }
});

test("a skip after the killing blow, or a second one, asks the stage to hurry what is left", async () => {
  const clock = new FakeClock(), { stage } = fakeStage(clock), control = new CombatControl();
  let hurried = 0;
  stage.hurry = () => { hurried += 1; };
  const plan = planned(capture(), only("pawn.thrust-block"));
  const running = runCombat(plan, stage, control);
  await clock.advance(plan.markers.decisive + 0.1);
  assert.equal(hurried, 0);
  control.skip();
  await clock.advance(1);
  assert.equal((await running).killed, true);
  assert.equal(hurried, 1);
});

test("one clip, two blows: the bash lands on the clash, the clip is held, and the thrust lands on the kill", () => {
  const clip: ClipInfo = { id: "attack.bash-thrust", duration: 2.2, events: { clash: 0.67, contact: 1.5 } };
  const timing = retimeTwoBlows(clip, ["impact", "contact"], { event: "clash", to: 0.9, follow: 0.14, resume: 1.42 }, 0.2, 2.05, 1)!;
  // Integrate the clip's own time through the rate changes, each eased over RATE_EASE.
  const rateAt = (t: number): number => {
    const ease = (from: number, to: number, start: number) => from + (to - from) * Math.min(1, Math.max(0, (t - start) / RATE_EASE));
    if (t < timing.start) return 0;
    if (t < timing.holdAt) return timing.rate;
    if (t < timing.resume) return ease(timing.rate, timing.crawl, timing.holdAt);
    return ease(timing.crawl, timing.resumeRate, timing.resume);
  };
  let time = 0, clash = NaN, contact = NaN, crawled = 0;
  for (let t = 0; t < 2.3; t += 0.0005) {
    const before = time; time += rateAt(t) * 0.0005;
    if (before < 0.67 && time >= 0.67) clash = t;
    if (before < 1.5 && time >= 1.5) contact = t;
    if (rateAt(t) < 0.2 && t > timing.start) crawled += 0.0005;
  }
  assert.ok(Math.abs(clash - 0.9) < 0.005, `bash at ${clash}`);
  assert.ok(Math.abs(contact - 2.05) < 0.01, `thrust at ${contact}`);
  assert.ok(crawled > 0.2, `held for ${crawled} s`);
  // Both halves run near the clip's own speed.
  for (const rate of [timing.rate, timing.resumeRate]) assert.ok(rate > 0.85 && rate < 1.2, `rate ${rate}`);
  // A hitstop on the first blow freezes the rig, not the clock: the thrust is paced to make up for it.
  const held = retimeTwoBlows(clip, ["contact"], { event: "clash", to: 0.9, follow: 0.14, resume: 1.42 }, 0.2, 2.05, 1, (from, to) => from < 0.9 && to > 0.9 ? 0.07 : 0)!;
  assert.ok(held.holdAt > timing.holdAt + 0.06);
  assert.equal(retimeTwoBlows({ ...clip, events: { contact: 1.5 } }, ["contact"], { event: "clash", to: 0.9, resume: 1.4 }, 0.2, 2.05, 1), null);
});

test("a hitstop on the way to a contact is not time the clip can use", () => {
  const thrust: ClipInfo = { id: "attack.thrust", duration: 1.4, events: { contact: 0.8 } };
  const plain = retime(thrust, ["contact"], 0.2, 1, 1), stopped = retime(thrust, ["contact"], 0.2, 1, 1, () => 0.06);
  // Without the allowance the blow would arrive 0.06 s late; with it the rig is given that much less clock.
  assert.ok(Math.abs((1 - plain.start) - 0.8 / plain.rate) < 1e-9);
  assert.ok(Math.abs((1 - stopped.start - 0.06) - 0.8 / stopped.rate) < 1e-9);
});

test("the killing strike is asked for louder than any other cue", () => {
  const sounds: { cue: string; volume: number }[] = [];
  const layer = new CombatAudioLayer({ kill: sound => { sounds.push({ cue: "decisive", volume: sound.volume }); }, cue: (name, sound) => { sounds.push({ cue: name, volume: sound.volume }); return true; } });
  for (const cue of AUDIO_CUES) if (cue !== "decisive") layer.play(cue, 0, { volume: 1 });
  layer.play("decisive", 1, { volume: Math.min(KILL_VOLUME.max, KILL_VOLUME.gain * 0.85) });
  const kill = sounds.find(sound => sound.cue === "decisive")!.volume;
  assert.ok(kill > 1 && sounds.every(sound => sound.cue === "decisive" || sound.volume < kill), JSON.stringify(sounds));
});
