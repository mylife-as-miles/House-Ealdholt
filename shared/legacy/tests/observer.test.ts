import assert from "node:assert/strict";
import test from "node:test";
import {
  activeWeather, commandWeather, observedMilliseconds, observerOffset, OBSERVER_WEATHER_MINUTES, setObserverSpeed, startObserverClock,
  weatherOverride,
} from "../aethelgard/observer/observer-time";
import {
  CHRONICLE_ENTRY_LIMIT, createVillageChronicle, formatChronicleTime, lifeLine, observeVillage, placePhrase, predicate, recordPower, subject,
  type ChronicleObservation, type ChronicleRoster,
} from "../aethelgard/observer/village-chronicle";
import { EMPTY_OBSERVER_SAVE, observerSaveKey, parseObserverSave, serializeObserverSave } from "../aethelgard/observer/observer-save";
import { EALDHOLT_VILLAGE_POPULATION } from "../aethelgard/characters/village-population";

test("observer time: pause holds the village still, fast runs it ahead, and the offset carries across visits", () => {
  let clock = startObserverClock(60_000, 0, 1_000);
  assert.equal(observedMilliseconds(clock, 3_000), 62_000, "as lived: one for one");
  clock = setObserverSpeed(clock, 0, 3_000);
  assert.equal(observedMilliseconds(clock, 9_000), 62_000, "paused: nothing moves");
  clock = setObserverSpeed(clock, 4, 9_000);
  assert.equal(observedMilliseconds(clock, 10_000), 66_000, "fast: four village seconds a second");
  // The village's own clock went on for nine real seconds; the observer is now 2 s ahead of it.
  const offset = observerOffset(clock, 69_000, 10_000);
  assert.equal(offset, -3_000);
  const later = startObserverClock(80_000, offset, 50_000);
  assert.equal(observedMilliseconds(later, 50_000), 77_000, "the next visit resumes where the observer left time");
  assert.equal(observedMilliseconds(startObserverClock(1_000, -5_000, 0), 0), 0, "never before the village began");
});

test("observer sky: a command holds for four village hours; a storm is the heaviest rain with the wind up", () => {
  const storm = commandWeather("storm", 600);
  assert.equal(storm.untilMinute, 600 + OBSERVER_WEATHER_MINUTES);
  assert.deepEqual(weatherOverride(storm, 700), { weather: "rain", rain: 1, cloudCoverage: 0.98, windStrength: 1 });
  assert.equal(weatherOverride(storm, 600 + OBSERVER_WEATHER_MINUTES), undefined, "the sky is given back");
  assert.equal(activeWeather(storm, 841), null);
  assert.deepEqual(weatherOverride(commandWeather("clear", 0), 10), { weather: "clear" });
  assert.equal(weatherOverride(null, 10), undefined);
});

const roster: ChronicleRoster = {
  person: id => ({ smith: { label: "Village smith", major: true }, priest: { label: "Parish priest", major: true }, child: { label: "Household child", major: false } } as Record<string, { label: string; major: boolean }>)[id] ?? null,
  place: id => ({
    forge: { label: "Forge beside the smithy home", kind: "workplace" as const },
    home: { label: "Smithy household home", kind: "home" as const },
    "proposed-church": { label: "Parish church interior (proposed placeholder)", kind: "service" as const },
    "proposed-road-beyond": { label: "The road beyond the approach (proposed placeholder)", kind: "travel" as const },
    courtyard: { label: "Village courtyard", kind: "social" as const },
  } as Record<string, { label: string; kind: "home" | "workplace" | "social" | "service" | "travel" }>)[id] ?? null,
};
const look = (minute: number, rows: [string, string, string, number][], extra: Partial<ChronicleObservation> = {}): ChronicleObservation => ({
  minute, weather: "clear", storm: false, followId: null,
  residents: rows.map(([residentId, activity, scheduledPlaceId, slotIndex]) => ({ residentId, activity, scheduledPlaceId, slotIndex })), ...extra,
});

test("the chronicle notices worship, journeys, gatherings and the followed villager, but not the first look", () => {
  let chronicle = createVillageChronicle();
  chronicle = observeVillage(chronicle, look(300, [["smith", "Asleep at home.", "home", 0], ["priest", "Asleep at home.", "home", 0], ["child", "Wakes.", "home", 0]]), roster);
  assert.equal(chronicle.entries.length, 0, "arriving writes nothing: the village was already living");
  chronicle = observeVillage(chronicle, look(400, [
    ["smith", "Lights the forge before breakfast.", "forge", 1],
    ["priest", "Says the morning office.", "proposed-church", 1],
    ["child", "Plays chase and pebble games in the lanes.", "courtyard", 1],
  ], { followId: "smith" }), roster);
  assert.deepEqual(chronicle.entries.map(entry => [entry.kind, entry.text]), [
    ["life", "The village smith lights the forge before breakfast."],
    ["worship", "The parish priest says the morning office."],
    ["gathering", "The household child plays chase and pebble games in the lanes."],
  ]);
  assert.equal(chronicle.memories.priest?.[0]?.text, "Went to the parish church interior on day 1.");
  chronicle = observeVillage(chronicle, look(500, [["smith", "Walks to the market town.", "proposed-road-beyond", 2]]), roster);
  assert.equal(chronicle.entries.at(-1)?.text, "The village smith sets out on the road beyond the village.");
  assert.equal(chronicle.memories.smith?.[0]?.text, "Took the road beyond the village on day 1.");
});

test("a storm the observer calls is written down and remembered by whoever it caught out of doors", () => {
  let chronicle = createVillageChronicle();
  const rows: [string, string, string, number][] = [["smith", "Forges.", "forge", 3], ["child", "Rests indoors.", "home", 3]];
  chronicle = observeVillage(chronicle, look(600, rows), roster);
  chronicle = observeVillage(chronicle, look(601, rows), roster);
  chronicle = recordPower(chronicle, 602, "You call a storm down on Ealdholt.");
  chronicle = observeVillage(chronicle, look(603, rows, { weather: "rain", storm: true }), roster);
  assert.deepEqual(chronicle.entries.map(entry => entry.kind), ["power", "sky"]);
  assert.equal(chronicle.entries[1].text, "A storm breaks over Ealdholt.");
  assert.equal(chronicle.memories.smith?.[0]?.text, "Caught by the storm at the forge beside the smithy home on day 1.");
  assert.equal(chronicle.memories.child, undefined, "indoors, nothing to remember");
  // The same storm is remembered once.
  chronicle = observeVillage(chronicle, look(604, rows, { weather: "clear" }), roster);
  chronicle = observeVillage(chronicle, look(605, rows, { weather: "rain", storm: true }), roster);
  assert.equal(chronicle.memories.smith?.length, 1);
});

test("the chronicle stays bounded and its words read naturally", () => {
  let chronicle = createVillageChronicle();
  for (let i = 0; i < CHRONICLE_ENTRY_LIMIT + 20; i++) chronicle = recordPower(chronicle, i, `Power ${i}.`);
  assert.equal(chronicle.entries.length, CHRONICLE_ENTRY_LIMIT);
  assert.equal(chronicle.entries.at(-1)?.text, `Power ${CHRONICLE_ENTRY_LIMIT + 19}.`);
  assert.equal(subject("Village smith"), "The village smith");
  assert.equal(subject("The house steward"), "The house steward");
  assert.equal(predicate("Lights the forge."), "lights the forge");
  assert.equal(placePhrase("Village green beside the churchyard (proposed placeholder)"), "the village green beside the churchyard");
  assert.equal(formatChronicleTime(1440 + 5 * 60 + 7), "Day 2 · 05:07");
  assert.equal(lifeLine("The village smith", "Rests, then mends tool handles."), "The village smith rests, then mends tool handles.");
  assert.equal(lifeLine("The village smith", "Midday meal with the household."), "The village smith: midday meal with the household.");
  assert.equal(lifeLine("The household child", "Asleep at home."), "The household child is asleep at home.");
});

test("the observer's save round-trips and a damaged one falls back to a clean record", () => {
  const save = { ...EMPTY_OBSERVER_SAVE, version: 1 as const, offsetMilliseconds: -1234.4, speed: 4 as const, weather: commandWeather("rain", 100),
    entries: [{ id: "c0", minute: 5, kind: "power" as const, text: "You call rain." }], memories: { smith: [{ key: "rain:1", minute: 70, text: "Caught by the rain." }] } };
  const back = parseObserverSave(serializeObserverSave(save));
  assert.equal(back.offsetMilliseconds, -1234);
  assert.equal(back.speed, 4);
  assert.deepEqual(back.weather, save.weather);
  assert.deepEqual(back.entries, save.entries);
  assert.deepEqual(back.memories, save.memories);
  assert.deepEqual(parseObserverSave("{not json"), EMPTY_OBSERVER_SAVE);
  assert.deepEqual(parseObserverSave(JSON.stringify({ version: 2 })), EMPTY_OBSERVER_SAVE);
  assert.equal(parseObserverSave(JSON.stringify({ version: 1, speed: 7, entries: [{ id: 1 }] })).speed, 1);
  assert.equal(observerSaveKey("w"), "crownfall.ealdholt.observer.v1:w");
});

test("the real Ealdholt roster reads well in the chronicle", () => {
  const people = new Map(EALDHOLT_VILLAGE_POPULATION.residents.map(resident => [resident.id, resident]));
  const places = new Map(EALDHOLT_VILLAGE_POPULATION.places.map(place => [place.id, place]));
  for (const resident of EALDHOLT_VILLAGE_POPULATION.residents) {
    assert.match(subject(resident.label), /^(The|A|An) \S/);
    for (const slot of resident.registry.routine) {
      assert.ok(predicate(slot.activity).length > 0, `${resident.id} has a readable activity`);
      assert.ok(places.has(slot.placeId), `${slot.placeId} is a known place`);
    }
  }
  assert.ok(people.size === 100 && [...places.values()].some(place => place.id === "proposed-church"));
});

test("work at the church is not worship; prayer and the office are", () => {
  let chronicle = createVillageChronicle();
  const at = (minute: number, rows: [string, string, string, number][]) => look(minute, rows);
  chronicle = observeVillage(chronicle, at(600, [["smith", "Forges.", "forge", 0], ["priest", "Sleeps.", "home", 0]]), roster);
  chronicle = observeVillage(chronicle, at(700, [["smith", "Sweeps and tidies the workplace.", "proposed-church", 1], ["priest", "Says the evening office.", "proposed-church", 1]]), roster);
  assert.deepEqual(chronicle.entries.map(entry => [entry.kind, entry.residentId]), [["worship", "priest"]]);
  assert.equal(chronicle.memories.smith, undefined);
});
