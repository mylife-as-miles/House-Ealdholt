import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  allRequestedClips, combatCueAllowed, combatCueClips, combatCueFamily, isCombatCue, pickCombatCue, warmRank,
  COMBAT_CUES, COMBAT_CUE_TAKES, type CombatCue, type CombatCueFamily, type CombatCueMemory,
} from "./gambit-sound";

const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
interface PlanEffect { id: string; family: string; cue?: string; lufs: number; relevel?: boolean; not: string[] }
const plan = JSON.parse(readFileSync(web("sound-design/gambit/plan.json"), "utf8")) as { sfx: PlanEffect[] };
const takes = JSON.parse(readFileSync(web("sound-design/gambit/tools/takes.json"), "utf8")) as Record<string, { dur: number; lufs: number; tp: number; passed: boolean; family: string }>;
const manifest = readFileSync(web("src/audio/gambit-assets.ts"), "utf8");
const layer = readFileSync(web("src/scene/combat/audio.ts"), "utf8");
const mixer = readFileSync(web("src/audio/audioManager.ts"), "utf8");

/** Loudness targets (LUFS, EBU R128): the impacts with the flesh, the rest with the sounds they sit beside. */
const TARGET: Record<CombatCueFamily, number> = { clash: -19, effort: -22, foley: -24, whoosh: -22, fall: -21 };

/** A small repeatable generator, so a run covers many draws without depending on Math.random. */
function seeded(seed: number) {
  let state = seed;
  return () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("the duel cues are the combat layer's exchange cues, with the takes it asks for", () => {
  const specs = [...layer.matchAll(/^\s*"?([a-z.]+)"?: \{ gain: [\d.]+, gap: (?:[\d.]+|Infinity), phase: "\w+", takes: (\d+),/gm)]
    .map((match) => [match[1], Number(match[2])] as const);
  assert.equal(specs.length, 14, "CUE_SPECS lists thirteen exchange cues and the decisive strike");
  const wanted = Object.fromEntries(specs.filter(([name]) => name !== "decisive"));
  assert.deepEqual({ ...COMBAT_CUE_TAKES }, wanted);
  assert.equal(COMBAT_CUES.length, 13);
  assert.equal(COMBAT_CUES.reduce((sum, cue) => sum + COMBAT_CUE_TAKES[cue], 0), 46);
});

test("every cue has its takes: made, passed by ear, bundled, in the manifest and asked for by the rules", () => {
  const requested = new Set(allRequestedClips());
  const planned = new Map(plan.sfx.map((effect) => [effect.id, effect]));
  const clips = COMBAT_CUES.flatMap((cue) => combatCueClips(cue));
  assert.equal(new Set(clips).size, 46, "no two cues share a clip");
  for (const cue of COMBAT_CUES) {
    const mine = combatCueClips(cue);
    assert.equal(mine.length, COMBAT_CUE_TAKES[cue], `${cue} has ${COMBAT_CUE_TAKES[cue]} takes`);
    for (const clip of mine) {
      assert.match(clip, /^cue_[a-z_]+_\d$/);
      assert.equal(planned.get(clip)?.cue, cue, `${clip} is planned as a take of ${cue}`);
      assert.ok(takes[clip], `${clip} has a take`);
      assert.equal(takes[clip].passed, true, `${clip} passed its earshot check`);
      assert.ok(existsSync(web(`src/assets/audio/gambit/${clip}.mp3`)), `${clip}.mp3 is bundled`);
      assert.match(manifest, new RegExp(`\\b${clip}: \\{ url: new URL\\("\\.\\./assets/audio/gambit/${clip}\\.mp3"`), `${clip} is in gambit-assets.ts`);
      assert.ok(requested.has(clip), `${clip} is in allRequestedClips`);
      assert.equal(warmRank(clip), 1, `${clip} is warmed with what a first capture needs`);
    }
  }
  // Nothing recorded as a duel cue that the rules never play, and the killing strike is not re-recorded.
  for (const id of Object.keys(takes)) if (id.startsWith("cue_")) assert.ok(clips.includes(id), `${id} belongs to a cue`);
  assert.ok(!Object.keys(takes).some((id) => id.includes("decisive")), "decisive is never a recording");
});

test("every take is levelled to its family's target and stays under the true-peak ceiling", () => {
  const planned = new Map(plan.sfx.map((effect) => [effect.id, effect]));
  for (const cue of COMBAT_CUES) {
    const target = TARGET[combatCueFamily(cue)];
    for (const clip of combatCueClips(cue)) {
      const effect = planned.get(clip)!;
      assert.equal(effect.lufs, target, `${clip} is planned at ${target} LUFS`);
      assert.equal(effect.relevel, true, `${clip} is levelled until the encoded file is on target`);
      assert.ok(Math.abs(takes[clip].lufs - target) <= 1, `${clip} measures ${takes[clip].lufs} LUFS against ${target}`);
      assert.ok(takes[clip].tp <= -1, `${clip} true peak ${takes[clip].tp} dBTP`);
      assert.ok(takes[clip].dur >= 0.3 && takes[clip].dur <= 1.5, `${clip} runs ${takes[clip].dur} s`);
      for (const not of ["a person talking", "music"]) assert.ok(effect.not.includes(not), `${clip} is checked against ${not}`);
    }
  }
  // The impacts match the flesh they are heard with; nothing in the exchange is levelled above the weapon impacts.
  const flesh = plan.sfx.find((effect) => effect.id === "flesh_stab_1")!.lufs;
  const steel = plan.sfx.find((effect) => effect.id === "hit_p")!.lufs;
  assert.equal(TARGET.clash, flesh);
  for (const family of Object.keys(TARGET) as CombatCueFamily[]) assert.ok(TARGET[family] < steel, `${family} sits under the strike`);
});

test("cue families: steel and wood, breath, boots and gear, air, a body on stone", () => {
  const families: Record<CombatCue, CombatCueFamily> = {
    "clash.shield.wood": "clash", "clash.shield.iron": "clash", "clash.parry.steel": "clash", "bash.shield": "clash",
    "effort.light": "effort", "effort.heavy": "effort", brace: "foley", recoil: "foley", stagger: "foley",
    "whoosh.light": "whoosh", "whoosh.heavy": "whoosh", "fall.light": "fall", "fall.heavy": "fall",
  };
  for (const cue of COMBAT_CUES) assert.equal(combatCueFamily(cue), families[cue], cue);
});

test("the menu's board keeps steel and bodies and loses the voices; a match hears every cue", () => {
  for (const cue of COMBAT_CUES) {
    assert.equal(combatCueAllowed(cue, { silentBoard: false }), true, `${cue} sounds in a match`);
    const voice = cue === "effort.light" || cue === "effort.heavy";
    assert.equal(combatCueAllowed(cue, { silentBoard: true }), !voice, `${cue} on the menu's board`);
  }
  for (const silentBoard of [true, false]) {
    for (const name of ["decisive", "clash", "clash.shield", "effort", "whoosh.medium", "cue_brace_1", "toString", "__proto__", ""]) {
      assert.equal(combatCueAllowed(name, { silentBoard }), false, `${JSON.stringify(name)} is not a duel cue`);
    }
  }
});

test("unknown cues return false, from the rules and from the mixer", async () => {
  // Loaded here, not at the top: the mixer is a browser module and nothing else in this file needs it running.
  const { AudioManager } = await import("../../web/src/audio/audioManager");
  const mixerInstance = new AudioManager();
  for (const name of ["decisive", "clash", "effort.medium", "cue_brace_1", "hit_p", "constructor", "toString", "__proto__", ""]) {
    assert.equal(isCombatCue(name), false, `${JSON.stringify(name)} is not a duel cue`);
    assert.equal(mixerInstance.cue(name, { volume: 1, pan: 0 }), false, `the mixer refuses ${JSON.stringify(name)}`);
  }
  for (const cue of COMBAT_CUES) assert.equal(isCombatCue(cue), true);
});

test("each cue has a shuffle bag of its own: every take before any repeats, never the same twice running", () => {
  for (const seed of [1, 7, 12345, 99991]) {
    const random = seeded(seed);
    const memory: CombatCueMemory = {};
    const heard = Object.fromEntries(COMBAT_CUES.map((cue) => [cue, [] as string[]])) as Record<CombatCue, string[]>;
    // Interleaved, as a fight plays them: one cue's draws never disturb another's bag.
    for (let i = 0; i < 240; i += 1) for (const cue of COMBAT_CUES) heard[cue].push(pickCombatCue(cue, memory, random));
    for (const cue of COMBAT_CUES) {
      const mine = combatCueClips(cue);
      const size = mine.length;
      for (let i = 0; i < heard[cue].length; i += 1) {
        assert.ok(mine.includes(heard[cue][i]), `${heard[cue][i]} is a take of ${cue}`);
        if (i > 0) assert.notEqual(heard[cue][i], heard[cue][i - 1], `${cue} repeated ${heard[cue][i]} (seed ${seed}, draw ${i})`);
      }
      for (let start = 0; start + size <= heard[cue].length; start += size) {
        assert.equal(new Set(heard[cue].slice(start, start + size)).size, size, `${cue}: all ${size} takes in bag ${start / size} (seed ${seed})`);
      }
    }
    assert.deepEqual(Object.keys(memory).sort(), [...COMBAT_CUES].sort(), "one bag per cue");
  }
});

test("the mixer plays a cue from its bag on the effects bus, dry, at its family's gain", () => {
  const body = mixer.slice(mixer.indexOf("  cue(name: string"), mixer.indexOf("  /** The killing bolt going into a body"));
  for (const pin of [
    /cue\(name: string, options: \{ volume\?: number; pan\?: number \} = \{\}\): boolean \{/,
    /if \(!isCombatCue\(name\)\) return false;/,
    /this\.shot\(pickCombatCue\(name, this\.cueMemory, Math\.random\) as GambitClipId, \{/,
    /gain: CUE_GAIN\[combatCueFamily\(name\)\] \* \(options\.volume \?\? 1\),/,
    /return shot !== null;/,
  ]) assert.match(body, pin, `audioManager.cue: ${pin}`);
  // The effects bus is shot()'s default, and it runs into the master and its limiter; a cue names no other bus and no hall.
  assert.doesNotMatch(body, /bus:|send:|hall:/);
  const gains = /const CUE_GAIN: Record<CombatCueFamily, number> = \{ clash: ([\d.]+), effort: ([\d.]+), foley: ([\d.]+), whoosh: GAIN\.whoosh, fall: GAIN\.fall \};/.exec(mixer);
  assert.ok(gains, "CUE_GAIN is declared");
  // A clash at its loudest (CUE_SPECS gain 0.9, levelled with the flesh) stays under the flesh layer of the strike.
  const fleshGain = Number(/\n {2}flesh: ([\d.]+),/.exec(mixer)![1]);
  assert.ok(Number(gains[1]) * 0.9 < fleshGain, "the loudest clash sits under the wound");
});
