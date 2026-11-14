import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  allRequestedClips, captureLayers, checkClips, checkLineChance, downfallClips, drawFromBag, dropClips, emptyPleaMemory, fleshClips,
  fleshFamily, gambitEnding, goreClips, kneelClips, mateClips, pawnSlot, pickFlesh, pickPlea, pleaChance, pleaWait, soulsLevel, speakerFor,
  strikeClip, voiceId, voicesFor, warmRank, whisperDelay, DROP_KINDS, FLESH_FAMILIES, FLESH_TAKES, KINGDOMS, PLEA_GRACE_SECONDS,
  type FleshMemory, type ShuffleBag,
} from "./gambit-sound";

const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
const plan = JSON.parse(readFileSync(web("sound-design/gambit/plan.json"), "utf8")) as { lines: { id: string; role: string; text: string }[] };
const takes = JSON.parse(readFileSync(web("sound-design/gambit/tools/takes.json"), "utf8")) as Record<string, { dur: number; hold?: number; role?: string; lufs: number; tp: number }>;
const manifest = readFileSync(web("src/audio/gambit-assets.ts"), "utf8");

/** A repeatable stand-in for Math.random. */
function sequence(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("every clip the rules can ask for was made, is bundled and is in the manifest", () => {
  for (const clip of allRequestedClips()) {
    assert.ok(takes[clip], `${clip} has a take`);
    assert.ok(existsSync(web(`src/assets/audio/gambit/${clip}.mp3`)), `${clip}.mp3 is bundled`);
    assert.match(manifest, new RegExp(`\\b${clip}: \\{ url: new URL\\("\\.\\./assets/audio/gambit/${clip}\\.mp3"`), `${clip} is in gambit-assets.ts`);
  }
  for (const line of plan.lines) assert.ok(takes[line.id], `plan line ${line.id} was recorded`);
});

test("pleas know where their last word ends, inside the clip, and fit the strike's window", () => {
  for (const [id, take] of Object.entries(takes)) {
    if (take.role !== "plea" && take.role !== "check" && take.role !== "mate") continue;
    assert.ok(typeof take.hold === "number" && take.hold > 0.3 && take.hold <= take.dur + 1e-6, `${id} hold ${take.hold} within ${take.dur}`);
    if (take.role === "plea") assert.ok(take.hold <= 3.2, `${id} says its words within 3.2 s (${take.hold})`);
  }
});

test("files are levelled and never clip", () => {
  for (const [id, take] of Object.entries(takes)) assert.ok(take.tp <= -0.9, `${id} true peak ${take.tp} dBTP`);
});

test("footsoldiers alternate their two voices and no voice repeats its last plea", () => {
  const memory = emptyPleaMemory();
  const first = pickPlea("ivory", "p", memory, sequence(0.1, 0.1));
  const second = pickPlea("ivory", "p", memory, sequence(0.1, 0.1));
  assert.ok(first && second);
  assert.notEqual(first.voice, second.voice);
  assert.deepEqual(voicesFor("ivory", "p"), ["ivory_p1", "ivory_p2"]);
  const again = pickPlea("ivory", "p", memory, sequence(0.1, 0.1));
  assert.equal(again?.voice, first.voice);
  assert.notEqual(again?.clip, first.clip, "the same words are not heard twice running");
  assert.equal(pickPlea("sun", "k", memory, Math.random), null, "the king does not plead on capture");
  assert.equal(pickPlea("sun", "q", memory, sequence(0.99))?.voice, "sun_q");
});

test("a footsoldier pleads and dies in the voice it has had all game, and every kingdom speaks in its own", () => {
  const memory = emptyPleaMemory();
  for (let i = 0; i < 6; i += 1) assert.equal(pickPlea("kwind", "p", memory, Math.random, "kwind_p2")?.voice, "kwind_p2");
  assert.equal(pickPlea("kwind", "n", memory, Math.random, "kwind_p2")?.voice, "kwind_n", "a pawn's voice is not a knight's");
  assert.equal(pickPlea("empire", "p", memory, sequence(0.1), "sun_p1")?.voice.startsWith("empire_"), true, "nor another kingdom's");
  assert.deepEqual(["a", "b", "c", "d", "e", "f", "g", "h"].map((file) => pawnSlot(file)), ["p1", "p2", "p1", "p2", "p1", "p2", "p1", "p2"],
    "neighbours never share a voice");
  assert.equal(voiceId("sun", "p", "p2"), "sun_p2");
  assert.equal(voiceId("empire", "q"), "empire_q");
  for (const kingdom of KINGDOMS) {
    assert.deepEqual(checkClips(kingdom), ["a", "b", "c", "d"].map((x) => `${kingdom}_k_check_${x}`));
    assert.deepEqual(mateClips(kingdom), ["a", "b", "c"].map((x) => `${kingdom}_k_defeat_${x}`));
  }
});

test("the checkmated king yields and never speaks of dying; the downfall's lines and effects are all there", () => {
  for (const kingdom of KINGDOMS) {
    for (const clip of mateClips(kingdom)) {
      const line = plan.lines.find((entry) => entry.id === clip) as { text: string } | undefined;
      assert.ok(line, `${clip} is in plan.json`);
      assert.doesNotMatch(line.text, /\b(die|dying|death|dead|kill)\b/i, `${clip}: "${line.text}"`);
    }
    assert.ok(downfallClips(kingdom, "despair").length >= 4 && downfallClips(kingdom, "victory").length >= 4, kingdom);
  }
  for (const kind of DROP_KINDS) assert.equal(dropClips(kind).length, 3);
  assert.deepEqual(kneelClips(), ["kneel_armour_1", "kneel_armour_2", "kneel_armour_3"]);
  const requested = new Set(allRequestedClips());
  for (const clip of [...DROP_KINDS.flatMap((kind) => dropClips(kind)), ...kneelClips(), ...KINGDOMS.flatMap((kingdom) => downfallClips(kingdom, "victory"))]) {
    assert.ok(requested.has(clip), `${clip} is requested`);
  }
});

test("each weapon opens a body its own way, and the casters' fire has its own wound", () => {
  assert.deepEqual(
    (["p", "n", "b", "r", "q", "k"] as const).map((rank) => fleshFamily(rank)),
    ["stab", "slash", "slash", "crush", "cleave", "cleave"],
  );
  // Ranks that share a weapon share a wound: the flesh always belongs to the impact it is layered with.
  for (const a of ["p", "n", "b", "r", "q", "k"] as const) {
    for (const b of ["p", "n", "b", "r", "q", "k"] as const) {
      assert.equal(fleshFamily(a) === fleshFamily(b), strikeClip(a) === strikeClip(b), `${a} and ${b}`);
    }
  }
  assert.deepEqual([...FLESH_FAMILIES], ["stab", "slash", "crush", "cleave", "blast"]);
});

test("every flesh family and the gore have three takes, and the rules ask for all eighteen", () => {
  assert.equal(FLESH_TAKES, 3);
  for (const family of FLESH_FAMILIES) {
    assert.deepEqual(fleshClips(family), [`flesh_${family}_1`, `flesh_${family}_2`, `flesh_${family}_3`]);
  }
  assert.deepEqual(goreClips(), ["gore_splat_1", "gore_splat_2", "gore_splat_3"]);
  const wanted = [...FLESH_FAMILIES.flatMap((family) => fleshClips(family)), ...goreClips()];
  assert.equal(new Set(wanted).size, 18);
  const requested = new Set(allRequestedClips());
  for (const clip of wanted) assert.ok(requested.has(clip), `${clip} is requested`);
  assert.equal([...requested].filter((clip) => /^(flesh_|gore_splat_)/.test(clip)).length, 18);
});

/** A small repeatable generator, so a run covers many draws without depending on Math.random. */
function seeded(seed: number) {
  let state = seed;
  return () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("the wounds come from a shuffle bag: all three takes before any repeats, never the same twice running", () => {
  for (const seed of [1, 7, 12345, 99991]) {
    const random = seeded(seed);
    const memory: FleshMemory = {};
    for (const family of [...FLESH_FAMILIES, "gore"] as const) {
      const takes = family === "gore" ? goreClips() : fleshClips(family);
      const heard: string[] = [];
      for (let i = 0; i < 300; i += 1) heard.push(pickFlesh(family, memory, random));
      for (let i = 0; i < heard.length; i += 1) {
        assert.ok(takes.includes(heard[i]), `${heard[i]} is a take of ${family}`);
        if (i > 0) assert.notEqual(heard[i], heard[i - 1], `${family} repeated ${heard[i]} (seed ${seed}, draw ${i})`);
      }
      // Each bag of three holds every take exactly once.
      for (let i = 0; i < heard.length; i += FLESH_TAKES) {
        assert.deepEqual([...heard.slice(i, i + FLESH_TAKES)].sort(), [...takes].sort(), `${family} bag ${i / FLESH_TAKES} (seed ${seed})`);
      }
      // The order is not fixed: over a hundred bags more than one order turns up.
      const orders = new Set<string>();
      for (let i = 0; i < heard.length; i += FLESH_TAKES) orders.add(heard.slice(i, i + FLESH_TAKES).join());
      assert.ok(orders.size > 1, `${family} is shuffled`);
    }
  }
});

test("a shuffle bag never repeats across the boundary, whatever the generator does, and families keep separate bags", () => {
  for (const stuck of [0, 0.34, 0.5, 0.67, 0.999999, 1]) {
    const state: ShuffleBag<string> = { bag: [] };
    let last: string | undefined;
    for (let i = 0; i < 30; i += 1) {
      const drawn = drawFromBag(["a", "b", "c"], state, () => stuck);
      assert.notEqual(drawn, last, `stuck at ${stuck}, draw ${i}`);
      last = drawn;
    }
  }
  // One option can only repeat; two alternate.
  const one: ShuffleBag<string> = { bag: [] };
  assert.deepEqual([1, 2, 3].map(() => drawFromBag(["x"], one, Math.random)), ["x", "x", "x"]);
  const two: ShuffleBag<string> = { bag: [] };
  const pair = [1, 2, 3, 4, 5, 6].map(() => drawFromBag(["x", "y"], two, seeded(3)));
  pair.forEach((drawn, i) => assert.ok(i === 0 || drawn !== pair[i - 1]));
  // A slash in between does not disturb the stabs: the three stabs are still one of each.
  const memory: FleshMemory = {};
  const random = seeded(42);
  const stabs = [pickFlesh("stab", memory, random)];
  pickFlesh("slash", memory, random);
  stabs.push(pickFlesh("stab", memory, random));
  pickFlesh("gore", memory, random);
  stabs.push(pickFlesh("stab", memory, random));
  assert.deepEqual([...stabs].sort(), fleshClips("stab"));
  // The memory is the mixer's and outlives a game: nothing in it is reset by the rules, so a new game continues the bag.
  assert.equal(memory.stab?.bag.length, 0);
  assert.equal(memory.slash?.bag.length, 2);
});

test("the menu's background game hears steel and no flesh; a fireball's flesh replaces the sword clang", () => {
  // A blade: steel always, flesh and gore only where the board has its voices.
  assert.deepEqual(captureLayers({ silentBoard: false, spell: false }), { steel: true, flesh: true, gore: true });
  assert.deepEqual(captureLayers({ silentBoard: true, spell: false }), { steel: true, flesh: false, gore: false });
  // A spell: the clang only stands in where there is no flesh.
  assert.deepEqual(captureLayers({ silentBoard: false, spell: true }), { steel: false, flesh: true, gore: true });
  assert.deepEqual(captureLayers({ silentBoard: true, spell: true }), { steel: true, flesh: false, gore: false });
  for (const silentBoard of [true, false]) {
    const spell = captureLayers({ silentBoard, spell: true });
    assert.notEqual(spell.steel, spell.flesh, "under a fireball it is the clang or the flesh, never both and never neither");
    for (const kind of [true, false]) {
      const layers = captureLayers({ silentBoard, spell: kind });
      assert.equal(layers.flesh, !silentBoard);
      assert.equal(layers.gore, layers.flesh, "no gore without flesh");
    }
  }
});

test("the scene asks these rules before it plays flesh, gore or the spell's clang", () => {
  const scene = readFileSync(web("src/scene/sceneEngine.ts"), "utf8").replace(/\r\n/g, "\n");
  // Every strike passes its flesh through the gate; the blast and the gore are only played behind it.
  const strikes = scene.match(/audio\.strike\([\s\S]*?\}\);/g) ?? [];
  assert.ok(strikes.length >= 2, "the battle beat and the plain capture both land a blow");
  for (const call of strikes) assert.match(call, /flesh: captureLayers\(\{ silentBoard: this\.silentBoard\(\), spell: false \}\)\.flesh/);
  for (const line of scene.split("\n").filter((text) => /audio\.(fleshBlast|goreSplat|fleshWound)\(/.test(text))) {
    assert.match(line, /^\s*((else )?if \(cue\.endsWith\("\.\w+"\)\) \{ )?if \((layers\.flesh|gore|flesh)\) audio\./, line.trim());
  }
  assert.match(scene, /const layers = captureLayers\(\{ silentBoard: this\.silentBoard\(\), spell: true \}\);\n\s*if \(layers\.steel\) audio\.play\("capture"/);
  assert.match(scene, /const gore = captureLayers\(\{ silentBoard: this\.silentBoard\(\), spell: false \}\)\.gore;/);
  // The clang marks a kill in two places: under a killing fireball (only in the menu's background game, behind the
  // gate above) and as a musket ball lands, after its own whine (the Korvenian and Sun Empire guns).
  assert.equal((scene.match(/audio\.play\("capture"/g) ?? []).length, 2, "the clang is played in two places only");
  assert.match(scene, /audio\.ballImpact\([^\n]*\);\n\s*audio\.play\("capture"/, "the gun's clang follows the ball's own impact");
});

test("the wound mix stays as tuned: the cut is heard, then yields to the death cry", () => {
  // These numbers were set against an offline render of six captures (web/sound-design/gambit/README.md). Change them
  // only with a new render: they hold every death cry at least 4 dB over the effects.
  const mixer = readFileSync(web("src/audio/audioManager.ts"), "utf8");
  for (const pin of [
    /\n  flesh: 0\.7,/,
    /\n  gore: 0\.45,/,
    /const FLESH_SEND = 1;/,
    /const BLAST_SEND = 0\.9;/,
    /const GORE_SEND = 0\.6;/,
    /const FLESH_YIELD = \{ hold: 0\.15, by: 0\.4, to: 0\.4 \};/,
    /\n  wet: 0\.8,/,
    /GAIN\.flesh \* Math\.min\(1, options\.volume \?\? 1\), BLAST_SEND/,
    /const LIMITER = \{ threshold: -2, knee: 1, ratio: 20, attack: 0\.001, release: 0\.12 \};/,
  ]) assert.match(mixer, pin, `audioManager.ts: ${pin}`);
  const scene = readFileSync(web("src/scene/sceneEngine.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(scene, /audio\.spellImpact\(\{ pan: this\.stereoPan\(at\), volume: Math\.min\(layers\.flesh \? 1 : 1\.4, scale\) \}\)/,
    "under a wound the killing burst stays at the mage's size");
});

test("every flesh and gore clip in the manifest exists, and is one the rules ask for", () => {
  const ids = [...manifest.matchAll(/^  ((?:flesh|gore)_[a-z0-9_]+): \{ url: new URL\("\.\.\/assets\/audio\/gambit\/([a-z0-9_]+)\.mp3"/gm)];
  assert.equal(ids.length, 18);
  const requested = new Set(allRequestedClips());
  for (const [, id, file] of ids) {
    assert.equal(file, id, `${id} points at its own file`);
    assert.ok(existsSync(web(`src/assets/audio/gambit/${id}.mp3`)), `${id}.mp3 exists`);
    assert.ok(requested.has(id), `${id} is asked for by the rules`);
    assert.ok(takes[id], `${id} has a take`);
  }
});

test("the manifest's durations are the ones the takes were measured at", () => {
  const rows = [...manifest.matchAll(/^  ([a-z0-9_]+): \{ url: [^,]+, import\.meta\.url\)\.href, dur: ([0-9.]+)/gm)];
  assert.ok(rows.length >= 133, `the manifest lists every clip (${rows.length})`);
  for (const [, id, dur] of rows) {
    assert.ok(takes[id], `${id} has a take`);
    assert.equal(Number(dur), takes[id].dur, `${id}: manifest ${dur} s, takes.json ${takes[id].dur} s`);
  }
  assert.equal(rows.length, Object.keys(takes).length, "every take is in the manifest, and nothing else");
});

test("everything a first capture needs is decoded ahead of the lines that cannot be needed early", () => {
  const order = (id: string) => warmRank(id);
  for (const early of ["hit_p", "hit_n", "hit_r", "hit_k", "flesh_stab_1", "flesh_blast_3", "gore_splat_2", "fall_light", "fall_heavy",
    "whoosh_light", "whoosh_heavy", "spell_charge", "spell_cast", "spell_impact", "trance_pull_1"]) {
    for (const late of ["ghost_a", "ghost_j", "ivory_k_check_a", "sun_k_check_b", "ivory_k_defeat_a", "sun_k_defeat_b", "kwind_q_victory_1",
      "empire_r_despair_1", "sting_win"]) {
      assert.ok(order(early) < order(late), `${early} before ${late}`);
    }
    assert.ok(order(early) < order("ivory_p1_a") && order(early) < order("sun_q_death"), `${early} before the pleas and deaths`);
    assert.ok(order("bed_hall") < order(early), "the beds still come first");
  }
  assert.ok(order("start_a") <= order("hit_p"), "the opening whisper is not held back");
  assert.ok(order("ivory_p1_murmur_1") <= order("hit_p") && order("kwind_p2_moved_3") <= order("hit_p"),
    "a game's murmurs and a move's first reaction come down with the first capture's sounds");
  assert.ok(order("ivory_p1_a") < order("ivory_p1_threat_1"), "pleas and deaths before the other reactions");
  assert.ok(order("ivory_p1_a") < order("ghost_a") && order("ivory_k_death") < order("ivory_k_check_a"), "pleas and deaths before the fallen and the check lines");
  assert.ok(order("steps_plate_1") < order("ghost_a"), "footfalls are not pushed behind the fallen");
  // Every clip the rules can ask for has a place in the queue.
  for (const clip of allRequestedClips()) assert.ok(Number.isInteger(order(clip)) && order(clip) >= 0 && order(clip) <= 5, clip);
});

test("the first death always wakes, higher ranks wake more, fast exhibitions half as often", () => {
  assert.equal(pleaChance("p", { first: true }), 1);
  assert.equal(pleaChance("k", { first: true }), 0);
  assert.ok(pleaChance("q", { first: false }) > pleaChance("r", { first: false }));
  assert.ok(pleaChance("r", { first: false }) > pleaChance("p", { first: false }));
  assert.equal(pleaChance("n", { first: false, speed: 2 }), pleaChance("n", { first: false }) / 2);
});

test("the blow waits for the last word, but never longer than the grace", () => {
  assert.equal(pleaWait(0.5, 1.2), 0);
  assert.equal(pleaWait(1.8, 1.2), 0.6000000000000001);
  assert.equal(pleaWait(9, 0.4), PLEA_GRACE_SECONDS);
});

test("the fallen grow louder and closer as the board empties", () => {
  assert.equal(soulsLevel(0), 0);
  assert.equal(whisperDelay(0, Math.random), null);
  let previous = 0;
  for (let fallen = 1; fallen <= 20; fallen += 1) {
    const level = soulsLevel(fallen);
    assert.ok(level >= previous && level <= 1);
    previous = level;
  }
  assert.equal(soulsLevel(14), 1);
  assert.ok((whisperDelay(12, () => 0.5) ?? 0) < (whisperDelay(1, () => 0.5) ?? 0));
  assert.ok((whisperDelay(30, () => 0) ?? 0) >= 14 * 0.7);
});

test("every line with words has a speaker for its subtitle", () => {
  const spoken = [...manifest.matchAll(/^\s+(\w+): \{[^\n]*\btext: "/gm)].map((match) => match[1]);
  assert.ok(spoken.length >= 500, `${spoken.length} subtitled lines`);
  for (const clip of spoken) assert.ok(speakerFor(clip), `${clip} has a speaker`);
  assert.deepEqual(speakerFor("sun_p2_c"), { side: "b", name: "Solforiz Pawn" });
  assert.deepEqual(speakerFor("ivory_q_a"), { side: "w", name: "Aethelgard Queen" });
  assert.deepEqual(speakerFor("ivory_k_defeat_b"), { side: "w", name: "Aethelgard King" });
  assert.deepEqual(speakerFor("kwind_n_moved_1", undefined, "w"), { side: "w", name: "Kwind-09 Knight" }, "the mixer says the side");
  assert.deepEqual(speakerFor("empire_r_castle_1"), { side: null, name: "Korvenia Rook" }, "no side fields Korvenia by default");
  assert.deepEqual(speakerFor("ghost_c"), { side: null, name: "The Fallen" });
  assert.deepEqual(speakerFor("start_a"), { side: null, name: "The Fallen" });
  assert.equal(speakerFor("hit_p"), null);
  const korvenia = (side: "w" | "b") => (side === "b" ? "Korvenia" : "Aethelgard");
  assert.deepEqual(speakerFor("empire_p1_a", korvenia), { side: "b", name: "Korvenia Pawn" }, "a side speaks as the kingdom it fields");
  assert.deepEqual(speakerFor("ghost_a", korvenia), { side: null, name: "The Fallen" });
  assert.equal(speakerFor("bed_hall"), null);
  assert.equal(speakerFor("gear_plate_1"), null);
});

test("a king in check speaks at most once in a row", () => {
  assert.equal(checkLineChance(1), 0.5);
  assert.equal(checkLineChance(2), 0);
});

test("a game ends with the funeral bell and the mated king's last words, then its cue", () => {
  assert.deepEqual(gambitEnding({ winner: "w", reason: "checkmate" }, "b"), { toll: "mate_toll", lastWords: "b", sting: "sting_loss" });
  assert.deepEqual(gambitEnding({ winner: "w", reason: "checkmate" }, "w"), { toll: "mate_toll", lastWords: "b", sting: "sting_win" });
  assert.deepEqual(gambitEnding({ winner: "b", reason: "checkmate" }, null), { toll: "mate_toll", lastWords: "w", sting: "sting_win" });
  assert.deepEqual(gambitEnding({ winner: "b", reason: "resignation" }, "w"), { toll: null, lastWords: null, sting: "sting_loss" });
  assert.deepEqual(gambitEnding({ winner: null, reason: "stalemate" }, "w"), { toll: null, lastWords: null, sting: "sting_draw" });
});
