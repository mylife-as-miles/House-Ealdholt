import assert from "node:assert/strict";
import test from "node:test";
import {
  allVoiceLines, createVoices, routineTopic, speakVillage, VOICE_COOLDOWN_MINUTES, type VoiceContext, type VoiceLine, type VoiceRoster, type VoiceState,
} from "../aethelgard/observer/village-voices";
import type { ChronicleResident } from "../aethelgard/observer/village-chronicle";
import { EALDHOLT_VILLAGE_POPULATION as POPULATION } from "../aethelgard/characters/village-population";

const people = new Map(POPULATION.residents.map(resident => [resident.id, resident]));
const places = new Map(POPULATION.places.map(place => [place.id, place.kind]));
const roster: VoiceRoster = {
  person: id => { const r = people.get(id); return r ? { label: r.label, young: r.ageBand === "child" || r.ageBand === "adolescent", elder: r.ageBand === "elder",
    guard: r.group === "guards-military", major: r.fidelityTier === "major" } : null; },
  placeKind: id => places.get(id) ?? null,
};
const villageAt = (dayMinute: number): ChronicleResident[] => POPULATION.residents.map(resident => {
  const index = Math.max(0, resident.registry.routine.findIndex(slot => dayMinute >= slot.startMinute && dayMinute < slot.endMinute));
  const slot = resident.registry.routine[index];
  return { residentId: resident.id, activity: slot.activity, scheduledPlaceId: slot.placeId, slotIndex: index };
});
const context = (minute: number, extra: Partial<VoiceContext> = {}): VoiceContext => ({
  worldKey: "w", minute, residents: villageAt(((minute % 1440) + 1440) % 1440), sky: "clear", raid: null, visitors: null, followId: null, memories: {}, maxLines: 2, ...extra,
});
/** Runs the village for a stretch and returns everything said. */
function listen(from: number, to: number, extra: Partial<VoiceContext> = {}, start: VoiceState = createVoices()): { state: VoiceState; lines: VoiceLine[] } {
  let state = start;
  const lines: VoiceLine[] = [];
  for (let minute = from; minute <= to; minute++) { const step = speakVillage(state, context(minute, extra), roster); state = step.state; lines.push(...step.lines); }
  return { state, lines };
}

test("villagers speak from what they are doing, the same way every time, and not while time stands still", () => {
  const morning = listen(10 * 60, 12 * 60);
  assert.deepEqual(morning.lines, listen(10 * 60, 12 * 60).lines);
  assert.ok(morning.lines.length > 100, `a morning's talk (${morning.lines.length} lines)`);
  const state = speakVillage(createVoices(), context(600), roster).state;
  assert.deepEqual(speakVillage(state, context(600), roster).lines, [], "held time: nobody says anything new");
  for (const line of morning.lines) {
    const resident = villageAt(line.minute % 1440).find(r => r.residentId === line.residentId)!;
    assert.equal(line.placeId, resident.scheduledPlaceId);
    if (line.replyTo) continue;
    assert.ok(routineTopic(resident.activity, line.minute).lines.includes(line.text) || routineTopic("", line.minute).lines.includes(line.text),
      `${resident.activity} -> "${line.text}"`);
  }
  const smith = morning.lines.filter(line => line.residentId === "ealdholt-village-smith" && !line.replyTo);
  assert.ok(smith.length && smith.every(line => /bellows|iron|sparks|hinge|Hot work|Quench/.test(line.text)), "the smith talks of the forge");
});

test("each kind of work has its own voice", () => {
  assert.equal(routineTopic("Heavy forging with hammer and tongs at the anvil.", 600).key, "forge");
  assert.deepEqual([routineTopic("Says the morning office.", 400).key, routineTopic("Says the morning office.", 400).tone], ["church", "pray"]);
  assert.deepEqual([routineTopic("Sells eggs and birds at the courtyard market.", 600).key, routineTopic("Sells eggs and birds at the courtyard market.", 600).tone], ["market", "call"]);
  assert.equal(routineTopic("Plays chase and pebble games in the lanes.", 600).tone, "play");
  assert.equal(routineTopic("Fetches water and hears news at the well.", 600).key, "gossip");
  assert.equal(routineTopic("Drills the watch in the guard yard.", 600).key, "watch");
  assert.equal(routineTopic("Cooks and bakes for the hall.", 600).key, "kitchen");
  assert.equal(routineTopic("Midday meal with the household.", 720).key, "meal");
  assert.equal(routineTopic("Ploughs, hoes or sows the arable strips.", 600).key, "fields");
  assert.equal(routineTopic("Something no routine names.", 400).key, "morning");
  // Every waking activity in the real roster has words.
  for (const resident of POPULATION.residents) for (const slot of resident.registry.routine) assert.ok(routineTopic(slot.activity, slot.startMinute).lines.length > 0);
  for (const line of allVoiceLines()) assert.ok(line.length <= 52, `short enough for a bubble: "${line}"`);
});

test("a villager rests their voice, lines are not repeated across the village, and neighbours answer", () => {
  const { lines } = listen(9 * 60, 13 * 60);
  const byPerson = new Map<string, number[]>();
  for (const line of lines) byPerson.set(line.residentId, [...(byPerson.get(line.residentId) ?? []), line.minute]);
  for (const [id, minutes] of byPerson) for (let i = 1; i < minutes.length; i++) assert.ok(minutes[i] - minutes[i - 1] >= VOICE_COOLDOWN_MINUTES, `${id} spoke again after ${minutes[i] - minutes[i - 1]} min`);
  const replies = lines.filter(line => line.replyTo);
  assert.ok(replies.length > 10, `neighbours answer (${replies.length})`);
  for (const reply of replies) {
    const opener = lines.find(line => line.id === reply.replyTo)!;
    assert.equal(reply.placeId, opener.placeId, "an answer comes from the same place");
    assert.notEqual(reply.residentId, opener.residentId);
    assert.equal(reply.minute, opener.minute);
  }
  // In any twenty minutes the same opening line is not heard twice.
  const openers = lines.filter(line => !line.replyTo);
  for (let i = 0; i < openers.length; i++) for (let j = i + 1; j < openers.length && openers[j].minute - openers[i].minute < 20; j++) {
    assert.notEqual(openers[j].text, openers[i].text, `"${openers[i].text}" twice within twenty minutes`);
  }
});

test("the followed villager is heard more; sleepers only breathe; nobody speaks from the road", () => {
  const plain = listen(9 * 60, 12 * 60).lines.filter(line => line.residentId === "ealdholt-village-reeve").length;
  const followed = listen(9 * 60, 12 * 60, { followId: "ealdholt-village-reeve" }).lines.filter(line => line.residentId === "ealdholt-village-reeve").length;
  assert.ok(followed > plain && followed >= 8, `followed ${followed} against ${plain}`);
  const night = listen(1 * 60, 4 * 60).lines;
  assert.ok(night.some(line => line.tone === "sleep" && line.text === "Zzz"));
  for (const line of night) {
    const resident = villageAt(line.minute).find(r => r.residentId === line.residentId)!;
    assert.equal(line.tone === "sleep", /^Asleep/.test(resident.activity), "only sleepers breathe, and only the waking talk");
  }
  assert.ok(!listen(8 * 60, 16 * 60).lines.some(line => line.residentId === "ealdholt-house-messenger" && line.placeId === "proposed-road-beyond"));
  const away = villageAt(600).map(resident => resident.residentId === "ealdholt-village-smith" ? { ...resident, away: true, scheduledPlaceId: "proposed-road-beyond" } : resident);
  let state = createVoices();
  for (let minute = 600; minute < 720; minute++) {
    const step = speakVillage(state, context(minute, { residents: away, followId: "ealdholt-village-smith" }), roster); state = step.state;
    assert.ok(!step.lines.some(line => line.residentId === "ealdholt-village-smith"), "someone away is not heard in the village");
  }
});

test("the sky turning is remarked on out of doors; rain is grumbled about", () => {
  const before = listen(10 * 60, 10 * 60 + 5).state;
  const storm = speakVillage(before, context(10 * 60 + 6, { sky: "storm" }), roster).lines;
  assert.ok(storm.length >= 1 && storm.some(line => line.tone === "alarm" && /sky|Storm|thatch|wind/.test(line.text)), JSON.stringify(storm));
  for (const line of storm.filter(l => l.tone === "alarm")) assert.notEqual(roster.placeKind(line.placeId), "home", "said out of doors");
  const cleared = speakVillage(speakVillage(before, context(10 * 60 + 6, { sky: "rain" }), roster).state, context(10 * 60 + 7, { sky: "clear" }), roster).lines;
  assert.ok(cleared.some(line => /sun again|passed|sky clear/.test(line.text)));
  assert.ok(listen(10 * 60, 14 * 60, { sky: "rain" }).lines.some(line => /Wet through|ever stop|boots are ponds/.test(line.text)));
});

test("a raid is cried through the village by the people it holds", () => {
  const night = 23 * 60;
  const quiet = listen(night - 3, night).state;
  const post = villageAt(night).filter(r => r.scheduledPlaceId === "proposed-watch-post").map(r => r.residentId);
  const sighted = speakVillage(quiet, context(night + 1, { raid: { phase: "sighted", outcome: null, allies: null } }), roster);
  assert.equal(sighted.lines.length >= 1 && post.includes(sighted.lines[0].residentId), true, "the lookout at the post cries it");
  assert.match(sighted.lines[0].text, /Torches on the road|Ring the bell/);
  // The approach: the watch musters, everyone else bars the door (as bandit-raid.ts lays over their routine).
  const held = villageAt(night).map(resident => roster.person(resident.residentId)!.guard
    ? { ...resident, activity: "Stands with the watch at the east farmstead.", scheduledPlaceId: "proposed-guard-yard", alarm: true }
    : { ...resident, activity: "Wakes to the bell and bars the door.", alarm: true });
  const approach = speakVillage(sighted.state, context(night + 21, { residents: held, raid: { phase: "approach", outcome: null, allies: null } }), roster);
  assert.ok(approach.lines.length >= 2 && approach.lines.every(line => line.tone === "alarm"));
  assert.ok(approach.lines.some(line => /guard yard|Spears|Hold the lane/.test(line.text)) && approach.lines.some(line => /Bar the door|window|Not a sound/.test(line.text)));
  const clash = speakVillage(approach.state, context(night + 51, { residents: held, raid: { phase: "clash", outcome: "repelled", allies: "House Hildmere" } }), roster);
  assert.ok(clash.lines.some(line => line.text === "House Hildmere is with us! Push!" || line.text === "Riders! We're not alone!"));
  assert.ok(clash.lines.some(line => /Hush|in the lane|Steel/.test(line.text)));
  const after = speakVillage(clash.state, context(night + 81, { raid: { phase: "aftermath", outcome: "repelled", allies: null } }), roster);
  assert.ok(after.lines.some(line => /running|Ealdholt holds|Sound off/.test(line.text)));
});

test("a neighbour's traders set the well talking, and memories are voiced later", () => {
  const market = listen(10 * 60, 13 * 60, { visitors: { kind: "traders", seat: "Holtmere Market" } }).lines;
  const atWell = market.filter(line => /Holtmere Market asking for salt|blue cloth|Too dear\. Far|take two\. No, three/.test(line.text));
  assert.ok(atWell.length >= 2);
  for (const line of atWell) assert.ok(["village-well", "village-courtyard"].includes(line.placeId));
  const memories = { "ealdholt-village-smith": [{ key: "storm:10", minute: 600, text: "Caught by the storm at the forge beside the smithy home on day 1." }] };
  const later = listen(1440 + 9 * 60, 1440 + 17 * 60, { memories, followId: "ealdholt-village-smith" }).lines;
  assert.equal(later.filter(line => line.text === "I was caught in that storm. Soaked to the bone.").length, 1, "said once that day, by the one who lived it");
  assert.equal(later.find(line => /caught in that storm/.test(line.text))?.residentId, "ealdholt-village-smith");
});
