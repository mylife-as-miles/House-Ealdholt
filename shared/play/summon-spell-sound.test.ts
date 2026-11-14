import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SPELL_IDS } from "../../web/src/scene/vfx/spells/spellbook";
import {
  allRequestedClips, isRiteCue, isSpellCue, pickRiteCue, pickSpellCue, riteCueClips, spellCue, spellCueClips, warmRank,
  RITE_CUES, RITE_CUE_TAKES, SPELL_CUES, SPELL_CUE_TAKES, SPELL_MOMENTS, type RiteCue, type ShuffleBag, type SpellCue,
} from "./gambit-sound";

const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
interface Imported { id: string; family: string; lufs: number; source: { page: string; url: string; author: string; license: string; sha256: string; member?: string } }
interface Take { kind?: string; dur: number; lufs: number; passed?: boolean; source?: { sha256: string; license: string } }
const plan = JSON.parse(readFileSync(web("sound-design/gambit/plan.json"), "utf8")) as { imported: Imported[]; sfx: { id: string }[] };
const takes = JSON.parse(readFileSync(web("sound-design/gambit/tools/takes.json"), "utf8")) as Record<string, Take>;
const credits = readFileSync(web("src/assets/audio/gambit/IMPORTED-CREDITS.md"), "utf8");

/** What each summon asks the sound bank for: the cue names its rite emits (web/src/scene/rites/), `rite.<summon>.<what>`. */
const SUMMON_CUES: Record<string, readonly string[]> = {
  wyvern: ["screech", "wingbeat", "strike", "bite", "tear"],
  phoenix: ["cry", "wingbeat", "dive", "ignite", "sunburst"],
  undead: ["split", "arc", "rise", "groan", "shamble", "rend", "tear", "sink", "close"],
  shadow: ["seal", "fog", "rise", "march", "charge", "thrust", "colossus", "raise", "strike", "thunder", "settle", "withdraw", "burn", "close"],
};
/**
 * Cues a summon asks for that the bank leaves without a voice on purpose (docs/play/SUMMONS.md): the wyvern's tearing
 * is heard as the rip of the flesh under it.
 */
const SILENT = ["rite.wyvern.tear"];
/** Cues a summon asks for many times in one summon: two or three takes each, never the same one twice running. */
const REPEATED: RiteCue[] = ["rite.wyvern.wingbeat", "rite.wyvern.bite", "rite.phoenix.wingbeat", "rite.undead.tear", "rite.shadow.thrust"];

function seeded(seed: number) {
  let state = seed;
  return () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("every cue a summon asks for has takes of its own, or is silent on purpose", () => {
  const asked = Object.entries(SUMMON_CUES).flatMap(([summon, cues]) => cues.map((what) => `rite.${summon}.${what}`));
  for (const cue of asked) {
    if (SILENT.includes(cue)) {
      assert.equal(isRiteCue(cue), false, `${cue} stays silent`);
      continue;
    }
    assert.ok(isRiteCue(cue), `${cue} has takes`);
    assert.ok(RITE_CUE_TAKES[cue as RiteCue] >= 1);
  }
  // Nothing in the bank that no summon asks for.
  for (const cue of RITE_CUES) assert.ok(asked.includes(cue), `${cue} is a cue a rite emits`);
});

test("a cue heard many times in one summon has two or three takes, short and under the rest, from a shuffle bag", () => {
  for (const cue of REPEATED) {
    const clips = riteCueClips(cue);
    assert.ok(clips.length >= 2 && clips.length <= 3, `${cue}: ${clips.length} takes`);
    const memory: Partial<Record<RiteCue, ShuffleBag<string>>> = {};
    const random = seeded(7);
    const heard = Array.from({ length: 60 }, () => pickRiteCue(cue, memory, random));
    heard.forEach((clip, i) => assert.ok(i === 0 || clip !== heard[i - 1], `${cue} repeated ${clip}`));
    for (let i = 0; i + clips.length <= heard.length; i += clips.length) assert.deepEqual([...heard.slice(i, i + clips.length)].sort(), [...clips].sort());
  }
  // The phoenix beats its wings every 0.5 to 0.58 s and a shadow soldier thrusts within a quarter second of the next:
  // a take may not smear into the one after it, and stays well under the summon's single beats.
  const longest = (cue: RiteCue) => Math.max(...riteCueClips(cue).map((clip) => takes[clip].dur));
  const loudest = (cue: RiteCue) => Math.max(...riteCueClips(cue).map((clip) => takes[clip].lufs));
  assert.ok(longest("rite.phoenix.wingbeat") <= 0.6, `phoenix wingbeat ${longest("rite.phoenix.wingbeat")} s`);
  assert.ok(longest("rite.shadow.thrust") <= 0.7, `shadow thrust ${longest("rite.shadow.thrust")} s`);
  assert.ok(longest("rite.undead.tear") <= 0.8, `undead tear ${longest("rite.undead.tear")} s`);
  for (const cue of ["rite.phoenix.wingbeat", "rite.shadow.thrust"] as const) assert.ok(loudest(cue) <= -22.5, `${cue} at ${loudest(cue)} LUFS`);
  assert.ok(loudest("rite.undead.tear") <= -20.5, "a corpse's snarl at each wound sits under the flesh it comes with");
});

test("every library spell has its own cast and strike, and its own gathering but for Solforiz's fire", () => {
  for (const id of SPELL_IDS) {
    for (const moment of ["cast", "strike"] as const) assert.ok(isSpellCue(spellCue(id, moment)), `${id} has a ${moment}`);
  }
  // The generic charge is fire gathering in the hand, which is what a Solforiz caster's hand holds: its two spells keep it.
  const gathered = SPELL_IDS.filter((id) => isSpellCue(spellCue(id, "gather")));
  assert.deepEqual(SPELL_IDS.filter((id) => !gathered.includes(id)).sort(), ["fire-portal", "sun-pillar"]);
  // Every cue in the bank is a moment of a spell the book names.
  for (const cue of SPELL_CUES) {
    const [kind, id, moment, ...rest] = cue.split(".");
    assert.equal(kind, "spell");
    assert.equal(rest.length, 0, cue);
    assert.ok((SPELL_IDS as readonly string[]).includes(id), `${cue} names a spell in the book`);
    assert.ok((SPELL_MOMENTS as readonly string[]).includes(moment), `${cue} names a moment`);
  }
  assert.equal(isSpellCue("spell.lance.charge"), false);
  assert.equal(isSpellCue("rite.wyvern.screech"), false);
  assert.equal(isSpellCue("constructor"), false);
});

test("spell clips are named for their cue, requested, bundled early, and every take is its own", () => {
  assert.deepEqual(spellCueClips("spell.storm-bolt.cast"), ["spell_storm_bolt_cast_1"]);
  assert.deepEqual(spellCueClips("spell.glacial-crown.strike"), ["spell_glacial_crown_strike_1"]);
  const requested = allRequestedClips();
  assert.equal(new Set(requested).size, requested.length, "no clip is asked for twice");
  for (const cue of SPELL_CUES) {
    assert.equal(spellCueClips(cue).length, SPELL_CUE_TAKES[cue]);
    for (const clip of spellCueClips(cue)) {
      assert.match(clip, /^spell_[a-z0-9_]+_(gather|cast|strike)_\d$/);
      assert.ok(requested.includes(clip), `${clip} is requested`);
      assert.equal(warmRank(clip), warmRank("spell_cast"), `${clip} is decoded with everything a first capture needs`);
    }
  }
  const memory: Partial<Record<SpellCue, ShuffleBag<string>>> = {};
  for (const cue of SPELL_CUES) assert.ok(spellCueClips(cue).includes(pickSpellCue(cue, memory, Math.random)));
});

test("a spell's gathering fits the time it is gathered in, and its blow is no louder than the generic burst", () => {
  for (const cue of SPELL_CUES) {
    for (const clip of spellCueClips(cue)) {
      const take = takes[clip];
      if (cue.endsWith(".gather")) assert.ok(take.dur <= 1.7, `${clip}: ${take.dur} s (the mixer joins a longer one part-way in)`);
      if (cue.endsWith(".strike")) assert.ok(take.lufs <= takes.spell_impact.lufs + 0.5, `${clip} at ${take.lufs} LUFS`);
      assert.ok(take.lufs >= -26, `${clip} is heard (${take.lufs} LUFS)`);
    }
  }
});

test("every imported clip came through the sound tool from a CC0 source, credited with the hash it was checked against", () => {
  const ids = new Set<string>();
  for (const entry of plan.imported) {
    assert.ok(!ids.has(entry.id), `${entry.id} is cut once`);
    ids.add(entry.id);
    const { source } = entry;
    assert.equal(source.license, "CC0 1.0", `${entry.id} is CC0`);
    assert.match(source.page, /^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/, `${entry.id}: its page`);
    assert.match(source.url, /^https:\/\/opengameart\.org\/sites\/default\/files\//, `${entry.id}: its file`);
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.ok(credits.includes(source.sha256), `IMPORTED-CREDITS.md gives ${source.page}'s hash`);
    assert.ok(credits.includes(source.page), `IMPORTED-CREDITS.md links ${source.page}`);
    const take = takes[entry.id];
    assert.ok(take && take.kind === "imported" && take.passed, `${entry.id} was made`);
    assert.equal(take.source?.sha256, source.sha256, `${entry.id} was cut from the file the plan names`);
    // Under the voices: nothing imported is louder than the wyvern's roar.
    assert.ok(take.lufs <= -16.5, `${entry.id} at ${take.lufs} LUFS`);
  }
  // Every summon's and spell's take is one the plan cuts from a CC0 recording, or one the sound tool generated and
  // earshot passed (the phoenix's cry: no CC0 recording of a great bird is heard as one).
  const generated = new Set(plan.sfx.map((entry) => entry.id));
  for (const clip of [...RITE_CUES.flatMap((cue) => riteCueClips(cue)), ...SPELL_CUES.flatMap((cue) => spellCueClips(cue))]) {
    const made = takes[clip];
    assert.ok(ids.has(clip) || (generated.has(clip) && made?.kind === "sfx" && made.passed === true), `${clip} is cut by plan.json's imported list, or generated and passed`);
  }
});

test("the scene plays a library spell's own moments where the bank has them, and the generic fire where not", () => {
  const scene = readFileSync(web("src/scene/sceneEngine.ts"), "utf8");
  const cast = scene.slice(scene.indexOf("  private async castDrawnSpell("), scene.indexOf("  private async gatherSpell("));
  assert.match(cast, /if \(!audio\.spellGather\(gambitSound\.spellCue\(entry\.id, "gather"\), \{ pan, duration: release, volume: queen \? 1\.3 : 1 \}\)\)\n\s+audio\.spellCharge\(\{ pan, duration: release, volume: queen \? 1\.3 : 1 \}\);/);
  assert.match(cast, /if \(!audio\.cue\(gambitSound\.spellCue\(entry\.id, "cast"\), \{ pan, volume: queen \? 1\.2 : 1 \}\)\) audio\.spellCast\(\{ pan, volume: queen \? 1\.2 : 1 \}\);/);
  assert.equal((cast.match(/audio\.spellCharge\(|audio\.spellCast\(/g) ?? []).length, 2, "the generic charge and cast only as fallbacks");
  const burst = scene.slice(scene.indexOf("  private spellBurst("), scene.indexOf("    if (drawn) {\n      // A library spell draws its own blow"));
  assert.match(burst, /if \(!drawn \|\| !audio\.cue\(gambitSound\.spellCue\(drawn\.id, "strike"\), \{ pan: this\.stereoPan\(at\), volume: Math\.min\(layers\.flesh \? 1 : 1\.4, scale\) \}\)\)\n\s+audio\.spellImpact\(/);
  // The flesh at contact is the scene's, as before: the spell's blow never replaces it.
  assert.match(burst, /if \(layers\.flesh\) audio\.fleshBlast\(\{ pan: this\.stereoPan\(at\), volume: scale \}\);/);
});

test("the mixer plays a spell's cue from its bag, and times its gathering to crest as it leaves the hand", async () => {
  const mixer = readFileSync(web("src/audio/audioManager.ts"), "utf8");
  const cue = mixer.slice(mixer.indexOf("  cue(name: string"), mixer.indexOf("  /** The killing bolt going into a body"));
  assert.match(cue, /if \(isSpellCue\(name\)\) return this\.spellCue\(name, options\);/);
  const gather = mixer.slice(mixer.indexOf("  spellGather(name: string"), mixer.indexOf("  /** Blood and torn flesh reaching the stone"));
  assert.match(gather, /const offset = Math\.max\(0, buffer\.duration - span\);/, "a longer take joins part-way in");
  assert.match(gather, /delay: \(options\.delay \?\? 0\) \+ Math\.max\(0, span - buffer\.duration\),/, "a shorter one waits");
  const { AudioManager } = await import("../../web/src/audio/audioManager");
  const audio = new AudioManager();
  // With no sound running, a cue the bank has is still claimed (nothing else should play in its place)...
  assert.equal(audio.cue("spell.lance.cast", { volume: 1, pan: 0 }), true);
  assert.equal(audio.cue("rite.shadow.thunder", { volume: 1, pan: 0 }), true);
  assert.equal(audio.spellGather("spell.frost-line.gather", { duration: 1 }), true);
  // ...and one it has none of is not, so the scene plays the generic fire.
  assert.equal(audio.spellGather("spell.sun-pillar.gather", { duration: 1 }), false);
  assert.equal(audio.cue("spell.sun-pillar.gather", { volume: 1, pan: 0 }), false);
  assert.equal(audio.cue("rite.wyvern.tear", { volume: 1, pan: 0 }), false);
});
