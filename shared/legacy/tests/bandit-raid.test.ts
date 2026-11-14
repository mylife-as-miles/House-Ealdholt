import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceRaid, createPopulationRaidRoster, decideRaid, nightlyRaidMinute, parseRaid, raidDefenders, raidEndMinute, raidOdds, raidPhase,
  raidResident, startRaid, watchPostManned, RAID_SIGHTED_MINUTES, type BanditRaid, type RaidRoster,
} from "../aethelgard/observer/bandit-raid";
import { createVillageChronicle, observeVillage, recordEvents, rememberAll, type ChronicleResident, type ChronicleRoster } from "../aethelgard/observer/village-chronicle";
import { parseObserverSave, serializeObserverSave, EMPTY_OBSERVER_SAVE } from "../aethelgard/observer/observer-save";
import { EALDHOLT_VILLAGE_POPULATION } from "../aethelgard/characters/village-population";

const roster: RaidRoster = {
  person: id => ({
    captain: { label: "Guard captain", guard: true, young: false, elder: false, homePlaceId: "home-captain" },
    spear: { label: "Spearman of the night watch", guard: true, young: false, elder: false, homePlaceId: "home-spear" },
    sleeper: { label: "Spearman of the watch", guard: true, young: false, elder: false, homePlaceId: "home-sleeper" },
    smith: { label: "Village smith", guard: false, young: false, elder: false, homePlaceId: "smithy-house" },
    child: { label: "Household child", guard: false, young: true, elder: false, homePlaceId: "smithy-house" },
    priest: { label: "Parish priest", guard: false, young: false, elder: false, homePlaceId: "church-house" },
  } as Record<string, ReturnType<RaidRoster["person"]>>)[id] ?? null,
  placeKind: id => ({ "smithy-house": "home", "smithy-forge": "workplace", churchyard: "social", "proposed-watch-post": "service",
    "proposed-guard-yard": "service", "village-courtyard": "social" } as Record<string, "home" | "workplace" | "social" | "service">)[id] ?? null,
};
const row = (residentId: string, activity: string, scheduledPlaceId: string, slotIndex = 1): ChronicleResident => ({ residentId, activity, scheduledPlaceId, slotIndex });
const night = 2 * 1440 + 23 * 60; // day 3, 23:00
const village = [
  row("captain", "Asleep at home.", "home-captain"),
  row("spear", "Stands the night watch at the approach.", "proposed-watch-post"),
  row("sleeper", "Asleep at home.", "home-sleeper"),
  row("smith", "Banks the forge for the night.", "smithy-forge"),
  row("child", "Plays chase in the courtyard.", "village-courtyard"),
  row("priest", "Says the evening office.", "churchyard"),
];
const raid = (overrides: Partial<BanditRaid> = {}) => ({ ...startRaid({ worldKey: "w", minute: night, serial: 0, provoked: true, watchAtPost: true,
  sites: [{ index: 3, bearing: "east" }] }), ...overrides });

test("a raid is chosen the same way every time, against an outlying building the view offered", () => {
  const a = raid(), b = raid();
  assert.deepEqual(a, b);
  assert.ok(a.size >= 6 && a.size <= 14);
  assert.deepEqual(a.target, { siteIndex: 3, bearing: "east", label: "the east farmstead" });
  assert.equal(a.sightedMinutes, RAID_SIGHTED_MINUTES.manned);
  const unseen = startRaid({ worldKey: "w", minute: night, serial: 0, provoked: false, watchAtPost: false, sites: [] });
  assert.equal(unseen.sightedMinutes, RAID_SIGHTED_MINUTES.unmanned, "nobody at the watch post: the village barely sees them coming");
  assert.equal(unseen.target.siteIndex, null);
  assert.match(unseen.target.label, /^the (north|east|south|west) farmstead$/);
});

test("the raid runs sighted, approach, clash and aftermath on the village clock, then ends", () => {
  const r = raid();
  assert.deepEqual(raidPhase(r, night), { phase: "sighted", progress: 0 });
  assert.equal(raidPhase(r, night + 25)?.phase, "approach");
  assert.equal(raidPhase(r, night + 55)?.phase, "clash");
  assert.equal(raidPhase(r, night + 100)?.phase, "aftermath");
  assert.equal(raidPhase(r, raidEndMinute(r)), null);
  assert.equal(raidEndMinute(r) - night, 20 + 30 + 30 + 120);
});

test("the watch post is seen to be manned only by an awake guard; the watch is who answers the bell", () => {
  assert.equal(watchPostManned(village, roster), true);
  assert.equal(watchPostManned(village.filter(r => r.residentId !== "spear"), roster), false);
  const warned = raid({ warned: true });
  assert.equal(raidDefenders(warned, village, roster), 3, "warned: every guard wakes");
  const unwarned = raidDefenders(raid(), village, roster);
  assert.ok(unwarned >= 1 && unwarned <= 3);
  assert.ok(raidOdds(warned, 3, true, false) > raidOdds(raid(), 3, true, false), "the observer's warning helps the watch");
  assert.ok(raidOdds(raid(), 3, true, true) > raidOdds(raid(), 3, true, false), "a storm helps the watch");
  assert.ok(raidOdds(raid(), 3, false, false) > raidOdds(raid(), 3, true, false), "night helps the band");
});

test("no burning in a storm; outcomes are fixed by the raid", () => {
  for (let serial = 0; serial < 40; serial++) {
    const r = startRaid({ worldKey: `w${serial}`, minute: night, serial, provoked: false, watchAtPost: false, sites: [] });
    assert.notEqual(decideRaid(r, 0, true, true).outcome, "burned");
    assert.deepEqual(decideRaid(r, 2, true, false), decideRaid(r, 2, true, false));
  }
});

test("villagers shelter and the watch musters while the raid holds them, then their day comes back", () => {
  const r = raid({ warned: true, outcome: "burned", written: ["sighted", "approach", "clash"] });
  const at = (minute: number, id: string) => raidResident(r, minute, village.find(v => v.residentId === id)!, roster);
  const approach = night + 25;
  assert.equal(at(approach, "spear").activity, "Stands with the watch at the east farmstead.");
  assert.equal(at(approach, "sleeper").activity, "Wakes to the bell and runs to join the watch.");
  assert.equal(at(approach, "smith").activity, "Runs home and bars the door.");
  assert.equal(at(approach, "smith").scheduledPlaceId, "smithy-house");
  assert.equal(at(approach, "child").activity, "Is hurried indoors.");
  assert.equal(at(approach, "priest").activity, "Takes shelter in the church.");
  assert.equal(at(approach, "priest").alarm, true);
  assert.equal(at(night + 85, "smith").activity, "Carries water to the fire at the east farmstead.", "after a burning, neighbours carry water");
  assert.equal(at(night + 85, "child").activity, "Plays chase in the courtyard.", "children are not sent to the fire");
  assert.equal(at(night + 140, "smith").activity, "Banks the forge for the night.", "the routine returns");
});

test("advancing writes every phase in order even after a 16x jump, with memories and a record", () => {
  let r: BanditRaid | null = raid({ warned: true });
  let step = advanceRaid(r, { minute: night, residents: village, roster, storm: false });
  assert.equal(step.events.length, 1);
  assert.match(step.events[0].text, /^The lookout at the watch post sees torches on the road: .+, \d+ strong\.$/);
  r = step.raid!;
  step = advanceRaid(r, { minute: night + 90, residents: village, roster, storm: false }); // straight into the aftermath
  const texts = step.events.map(event => event.text);
  assert.equal(texts[0], "The village is already moving when the bell rings: your warning reached them.");
  assert.equal(texts[1], "The beacon is lit, but no neighbouring house rides for Ealdholt.");
  assert.match(texts[2], /fall on the east farmstead\.$/);
  assert.equal(texts.length, 5);
  assert.ok(step.raid?.outcome);
  assert.equal(step.raid?.defenders, 3);
  const keys = new Set(step.memories.map(([id]) => id));
  assert.ok(keys.has("spear") && keys.has("smith") && keys.has("child"), "fighters and those who hid remember");
  const done = advanceRaid(step.raid!, { minute: raidEndMinute(r), residents: village, roster, storm: false });
  assert.equal(done.raid, null);
  assert.equal(done.record?.outcome, step.raid?.outcome);
  assert.equal(done.record?.day, 3);
});

test("a storm over the approach is written down and makes the band's fire impossible", () => {
  const r = raid();
  const step = advanceRaid(r, { minute: night + 25, residents: village, roster, storm: true });
  assert.ok(step.raid?.stormed);
  assert.ok(step.events.some(event => /torches gutter/.test(event.text)));
  const clash = advanceRaid(step.raid!, { minute: night + 55, residents: village, roster, storm: false });
  assert.notEqual(clash.raid?.outcome, "burned");
});

test("raids written into the chronicle; held villagers are only narrated when followed", () => {
  const chronicleRoster: ChronicleRoster = { person: id => ({ label: roster.person(id)!.label, major: true }), place: () => ({ label: "Home", kind: "home" }) };
  let chronicle = createVillageChronicle();
  chronicle = observeVillage(chronicle, { minute: night, residents: village, weather: "clear", storm: false, followId: null }, chronicleRoster);
  const held = village.map(v => raidResident(raid({ warned: true }), night + 25, v, roster));
  chronicle = observeVillage(chronicle, { minute: night + 25, residents: held, weather: "clear", storm: false, followId: "smith" }, chronicleRoster);
  assert.deepEqual(chronicle.entries.map(entry => entry.text), ["The village smith runs home and bars the door."]);
  chronicle = recordEvents(chronicle, night + 26, "threat", [{ text: "The church bell rings." }]);
  chronicle = rememberAll(chronicle, [["smith", { key: "raid:x", minute: night, text: "Hid from the Hollow Wolves on day 3." }]]);
  assert.equal(chronicle.entries.at(-1)?.kind, "threat");
  assert.equal(chronicle.memories.smith?.[0]?.text, "Hid from the Hollow Wolves on day 3.");
});

test("some nights bandits come of their own accord, never on the first day", () => {
  assert.equal(nightlyRaidMinute("w", 0), null);
  let nights = 0;
  for (let day = 1; day <= 1000; day++) {
    const minute = nightlyRaidMinute("w", day);
    if (minute === null) continue;
    nights++;
    assert.ok(minute >= day * 1440 + 21 * 60 + 30 && minute < day * 1440 + 25 * 60 + 30, "between 21:30 and 01:30");
  }
  assert.ok(nights > 150 && nights < 300, `about one night in five (${nights}/1000)`);
});

test("the raid is saved with the observer and a damaged one is dropped", () => {
  const r = raid({ warned: true, written: ["sighted"] });
  const save = { ...EMPTY_OBSERVER_SAVE, raid: r, raidSerial: 4, lastRaidDay: 2,
    raids: [{ id: "raid-1-0", band: "the Hollow Wolves", day: 1, outcome: "repelled" as const, target: "the west farmstead", provoked: false, defenders: 5, aidHouseId: null }] };
  const back = parseObserverSave(serializeObserverSave(save));
  assert.deepEqual(back.raid, r);
  assert.deepEqual(back.raids, save.raids);
  assert.equal(back.raidSerial, 4);
  assert.equal(back.lastRaidDay, 2);
  assert.equal(parseRaid({ ...r, size: "many" }), null);
  assert.equal(parseObserverSave(JSON.stringify({ version: 1 })).raid, null, "a save from before raids reads cleanly");
});

test("Ealdholt's own watch: fifteen guards, the night watch at the post in the small hours", () => {
  const people = createPopulationRaidRoster(EALDHOLT_VILLAGE_POPULATION);
  const guards = EALDHOLT_VILLAGE_POPULATION.residents.filter(resident => people.person(resident.id)?.guard);
  assert.equal(guards.length, 15);
  const at = (dayMinute: number) => EALDHOLT_VILLAGE_POPULATION.residents.map(resident => {
    const index = resident.registry.routine.findIndex(slot => dayMinute >= slot.startMinute && dayMinute < slot.endMinute);
    const slot = resident.registry.routine[Math.max(0, index)];
    return row(resident.id, slot.activity, slot.placeId, index);
  });
  assert.equal(watchPostManned(at(3 * 60), people), true, "03:00: the night watch stands at the approach");
  assert.equal(watchPostManned(at(10 * 60), people), true, "10:00: the morning watch");
});
