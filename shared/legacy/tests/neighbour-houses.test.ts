import assert from "node:assert/strict";
import test from "node:test";
import {
  actOnHouse, advanceRealm, afterRaid, chooseHappening, createPopulationRealmRoster, createRealm, fortuneBand, messengerDestination,
  NEIGHBOUR_HOUSES, neighbourHouse, outingForDay, outingResident, parseRealm, raidAid, realmCandidates, regardBand,
  type HouseState, type RealmState,
} from "../aethelgard/observer/neighbour-houses";
import { advanceRaid, createPopulationRaidRoster, raidEndMinute, raidOdds, startRaid } from "../aethelgard/observer/bandit-raid";
import { createVillageChronicle, observeVillage, type ChronicleResident, type ChronicleRoster } from "../aethelgard/observer/village-chronicle";
import { EMPTY_OBSERVER_SAVE, parseObserverSave, serializeObserverSave } from "../aethelgard/observer/observer-save";
import { EALDHOLT_VILLAGE_POPULATION as POPULATION } from "../aethelgard/characters/village-population";
import { getExternalHouse } from "../content/houses";

const roster = createPopulationRealmRoster(POPULATION), raidRoster = createPopulationRaidRoster(POPULATION);
/** Everyone's routine slot at a minute of the day. */
const villageAt = (dayMinute: number): ChronicleResident[] => POPULATION.residents.map(resident => {
  const index = Math.max(0, resident.registry.routine.findIndex(slot => dayMinute >= slot.startMinute && dayMinute < slot.endMinute));
  const slot = resident.registry.routine[index];
  return { residentId: resident.id, activity: slot.activity, scheduledPlaceId: slot.placeId, slotIndex: index };
});
const withHouse = (realm: RealmState, id: string, change: Partial<HouseState>): RealmState => ({ ...realm, houses: { ...realm.houses, [id]: { ...realm.houses[id], ...change } } });
const look = (realm: RealmState, minute: number, worldKey = "w") => advanceRealm(realm, { worldKey, minute, residents: villageAt(((minute % 1440) + 1440) % 1440), roster });

test("four houses of Aethelgard share the marches with Ealdholt, two of them from the game's own lore", () => {
  assert.deepEqual(NEIGHBOUR_HOUSES.map(house => [house.name, house.seat, house.bearing]), [
    ["House Stanhyrst", "Stanhyrst Barrow", "north"], ["House Hildmere", "Hildmere Ford", "east"],
    ["House Holtmere", "Holtmere Market", "south"], ["House Thornhallow", "Thornhallow", "west"],
  ]);
  assert.deepEqual(neighbourHouse("house-stanhyrst")?.heraldry, getExternalHouse("house-stanhyrst")?.heraldry);
  assert.equal(neighbourHouse("house-hildmere")?.seatLine, getExternalHouse("house-hildmere")?.seat);
  const realm = createRealm();
  assert.deepEqual(NEIGHBOUR_HOUSES.map(house => regardBand(realm.houses[house.id].regard)), ["wary", "cold", "warm", "warm"]);
  assert.deepEqual(NEIGHBOUR_HOUSES.map(house => fortuneBand(realm.houses[house.id].fortune)), ["thriving", "steady", "thriving", "lean"]);
  assert.deepEqual([-50, -49, -16, -15, 15, 16, 49, 50].map(regardBand), ["feud", "cold", "cold", "wary", "wary", "warm", "warm", "sworn"]);
});

test("each day each house has an even chance of sending something, between 07:00 and 18:00, the same every time", () => {
  assert.deepEqual(realmCandidates("w", 12), realmCandidates("w", 12));
  const seen = new Map<string, number>();
  for (let day = 0; day < 400; day++) for (const candidate of realmCandidates("w", day)) {
    seen.set(candidate.houseId, (seen.get(candidate.houseId) ?? 0) + 1);
    const inDay = candidate.minute - day * 1440;
    assert.ok(inDay >= 420 && inDay < 1080 && candidate.roll >= 0 && candidate.roll < 1);
  }
  for (const house of NEIGHBOUR_HOUSES) assert.ok(Math.abs((seen.get(house.id) ?? 0) - 200) < 45, `${house.id}: ${seen.get(house.id)} of 400`);
});

test("what a house sends follows how it regards Ealdholt and how it fares", () => {
  const state = (regard: number, fortune: number): HouseState => ({ regard, fortune, actedDay: -1, due: null, news: null });
  assert.equal(chooseHappening(state(-80, 60), .5), "quarrel");
  assert.equal(chooseHappening(state(-30, 60), .9), "traders", "a cold house's traders still come");
  assert.equal(chooseHappening(state(0, 60), .3), "traders");
  assert.equal(chooseHappening(state(0, 60), .6), "pilgrims");
  assert.equal(chooseHappening(state(30, 60), .7), "kin");
  assert.equal(chooseHappening(state(30, 60), .8), "gift");
  assert.equal(chooseHappening(state(30, 20), .3), "need", "a lean friend asks for help");
  assert.equal(chooseHappening(state(-30, 20), .3), "quarrel", "a lean rival takes instead");
  assert.equal(chooseHappening(state(80, 80), .9), "gift");
  for (const regard of [-80, -30, 0, 30, 80]) assert.equal(chooseHappening(state(regard, 60), .03), "outlaws", "outlaws strike any house");
});

test("the realm resolves what came down the road since the last look, in order, and not on the first look", () => {
  let found: { day: number; houseId: string; minute: number; roll: number } | null = null;
  for (let day = 7; day < 40 && !found; day++) { const [first] = realmCandidates("w", day); if (first && first.roll >= .07) found = { day, ...first }; }
  assert.ok(found);
  const fresh = createRealm();
  const arrival = look(fresh, found.day * 1440);
  assert.equal(arrival.events.filter(event => event.kind === "realm").length, 0, "arriving writes nothing");
  const step = look(arrival.realm, found.minute);
  const house = neighbourHouse(found.houseId)!, kind = chooseHappening(fresh.houses[house.id], found.roll);
  assert.equal(step.events.find(event => event.kind === "realm")?.text, house.happenings[kind]);
  assert.equal(step.realm.houses[house.id].news?.text, house.happenings[kind]);
  assert.notDeepEqual(step.realm.houses[house.id], fresh.houses[house.id]);
  assert.equal(look(step.realm, found.minute + 5).events.filter(event => event.kind === "realm").length, 0, "nothing is written twice");
});

test("the observer reaches into a neighbour's life once a village day, and what follows arrives the next morning", () => {
  const day3 = 3 * 1440 + 600;
  let realm = look(createRealm(), day3).realm;
  const blessed = actOnHouse(realm, "house-holtmere", "bless", day3);
  assert.equal(blessed?.text, "You hang Holtmere's orchards heavy with fruit.");
  assert.equal(blessed!.realm.houses["house-holtmere"].fortune, 96);
  assert.equal(actOnHouse(blessed!.realm, "house-holtmere", "befriend", day3 + 60), null, "once a day for each house");
  const slighted = actOnHouse(blessed!.realm, "house-hildmere", "estrange", day3 + 60);
  assert.equal(slighted?.text, "You whisper an old slight against Ealdholt into the hall at Hildmere Ford.");
  assert.equal(slighted!.realm.houses["house-hildmere"].regard, -37);
  realm = slighted!.realm;
  const morning = look(realm, 4 * 1440 + 10 * 60 + 1);
  const texts = morning.events.filter(event => event.kind === "realm").map(event => event.text);
  assert.ok(texts.includes("House Holtmere sends a cask of market ale for Ealdholt's hall."), "the blessed house sends thanks");
  assert.ok(texts.includes("Hildmere's herdsmen drive cattle across Ealdholt's east boundary."), "the slighted house answers");
  assert.equal(morning.realm.houses["house-holtmere"].due, null);
  assert.ok(actOnHouse(morning.realm, "house-holtmere", "befriend", 4 * 1440 + 700), "a new day, a new act");
  // A blight on a friend brings a plea for help; on a rival, a raid on the boundary.
  const friend = actOnHouse(realm, "house-thornhallow", "blight", day3 + 90)!.realm.houses["house-thornhallow"];
  assert.equal(friend.due?.kind, "need");
  assert.equal(actOnHouse(withHouse(realm, "house-stanhyrst", { regard: -40 }), "house-stanhyrst", "blight", day3 + 90)!.realm.houses["house-stanhyrst"].due?.kind, "quarrel");
});

test("villagers walk out to market, to kin and on pilgrimage on their days, and come home remembering it", () => {
  assert.equal(outingForDay("w", 0, roster), null);
  assert.equal(outingForDay("w", 2, roster), null);
  const market = outingForDay("w", 1, roster)!, pilgrimage = outingForDay("w", 5, roster)!;
  assert.deepEqual([market.kind, market.houseId, market.residentIds.length], ["market", "house-holtmere", 6]);
  assert.deepEqual([pilgrimage.kind, pilgrimage.houseId, pilgrimage.residentIds.length], ["pilgrimage", "house-stanhyrst", 8]);
  assert.equal(outingForDay("w", 3, roster)?.kind, "kin");
  for (const id of [...market.residentIds, ...pilgrimage.residentIds]) {
    const person = roster.person(id)!;
    assert.ok(!person.guard && !person.young && !person.leader, `${id} is free to go`);
  }
  const pilgrim = villageAt(600).find(resident => resident.residentId === pilgrimage.residentIds[0])!;
  const at = (minute: number) => outingResident(pilgrimage, 5 * 1440 + minute, pilgrim);
  assert.equal(at(7 * 60).activity, "Walks the north road with the pilgrims.");
  assert.equal(at(12 * 60).activity, "Prays at the Barrow-stones of Stanhyrst.");
  assert.equal(at(17 * 60).activity, "Walks home from the Barrow-stones of Stanhyrst.");
  assert.equal(at(12 * 60).away, true);
  assert.equal(at(18 * 60), pilgrim, "home again");

  let step = look(look(createRealm(), 5 * 1440).realm, 5 * 1440 + 6 * 60 + 31);
  assert.deepEqual(step.events.map(event => [event.kind, event.text]), [["journey", "Eight of Ealdholt set out for the Barrow-stones of Stanhyrst."]]);
  assert.equal(step.residents.filter(resident => resident.away).length, 8);
  const before = step.realm.houses["house-stanhyrst"].regard;
  step = advanceRealm(step.realm, { worldKey: "w", minute: 5 * 1440 + 17 * 60 + 31, residents: villageAt(17 * 60 + 31), roster });
  assert.ok(step.events.some(event => event.text === "The pilgrims come home from the Barrow-stones at dusk."));
  assert.equal(step.memories.filter(([, memory]) => memory.text === "Walked to the Barrow-stones of Stanhyrst on day 6.").length, 8);
  assert.ok(step.realm.houses["house-stanhyrst"].regard >= before + 2);
  assert.equal(step.realm.outing, null);

  const feud = withHouse(look(createRealm(), 1440).realm, "house-holtmere", { regard: -70 });
  assert.deepEqual(look(feud, 1440 + 7 * 60 + 1).events.filter(event => event.kind === "journey").map(event => event.text),
    ["No one walks to Holtmere Market today: Ealdholt is at feud with House Holtmere."]);
});

test("the messenger's road leads to each house in turn, never one at feud; the chronicle names it", () => {
  const realm = createRealm();
  assert.deepEqual([0, 1, 2, 3, 4].map(day => messengerDestination(realm, day)?.seat), ["Stanhyrst Barrow", "Hildmere Ford", "Holtmere Market", "Thornhallow", "Stanhyrst Barrow"]);
  assert.equal(messengerDestination(withHouse(realm, "house-hildmere", { regard: -60 }), 1)?.seat, "Holtmere Market");
  const names: ChronicleRoster = { person: () => ({ label: "House messenger", major: true }), place: () => ({ label: "Road", kind: "travel" }),
    roadTo: (_id, day) => messengerDestination(realm, day)?.seat ?? null };
  let chronicle = observeVillage(createVillageChronicle(), { minute: 1440 + 400, weather: "clear", storm: false, followId: null,
    residents: [{ residentId: "m", activity: "Breakfast.", scheduledPlaceId: "home", slotIndex: 0 }] }, names);
  chronicle = observeVillage(chronicle, { minute: 1440 + 480, weather: "clear", storm: false, followId: null,
    residents: [{ residentId: "m", activity: "Travels the road with messages and news.", scheduledPlaceId: "proposed-road-beyond", slotIndex: 1 }] }, names);
  assert.equal(chronicle.entries.at(-1)?.text, "The house messenger takes the road to Hildmere Ford.");
  assert.equal(chronicle.memories.m?.[0]?.text, "Took the road to Hildmere Ford on day 2.");
  // Someone away on an outing is written down only when followed.
  const away = { residentId: "m", activity: "Prays at the Barrow-stones of Stanhyrst.", scheduledPlaceId: "proposed-road-beyond", slotIndex: 2001, away: true };
  const count = chronicle.entries.length;
  assert.equal(observeVillage(chronicle, { minute: 1440 + 700, weather: "clear", storm: false, followId: null, residents: [away] }, names).entries.length, count);
  assert.equal(observeVillage(chronicle, { minute: 1440 + 700, weather: "clear", storm: false, followId: "m", residents: [away] }, names).entries.at(-1)?.text,
    "The house messenger prays at the Barrow-stones of Stanhyrst.");
});

test("a friendly house rides to Ealdholt's beacon when bandits come, and is bound closer for it", () => {
  const night = 2 * 1440 + 23 * 60, village = villageAt(23 * 60);
  assert.equal(raidAid(createRealm()), null, "no house is close enough at the start");
  const realm = withHouse(createRealm(), "house-hildmere", { regard: 55 });
  const aid = raidAid(realm);
  assert.deepEqual(aid, { houseId: "house-hildmere", house: "House Hildmere", seat: "Hildmere Ford", riders: 6, bearing: "east" });
  const raid = startRaid({ worldKey: "w", minute: night, serial: 0, provoked: true, watchAtPost: true, sites: [] });
  const sighted = advanceRaid(raid, { minute: night, residents: village, roster: raidRoster, storm: false, aid });
  assert.equal(sighted.raid?.allies, null, "the beacon is lit with the bell, not before");
  const approach = advanceRaid(sighted.raid!, { minute: night + 25, residents: village, roster: raidRoster, storm: false, aid });
  assert.ok(approach.events.some(event => event.text === "The beacon is lit. Riders of House Hildmere set out from Hildmere Ford."));
  assert.equal(approach.raid?.allies?.riders, 6);
  assert.ok(raidOdds(approach.raid!, 5, true, false) > raidOdds(sighted.raid!, 5, true, false));
  const clash = advanceRaid(approach.raid!, { minute: night + 55, residents: village, roster: raidRoster, storm: false, aid });
  assert.ok(clash.events.some(event => /of the watch and 6 riders of House Hildmere/.test(event.text)) || clash.raid?.outcome !== "repelled");
  assert.ok(clash.memories.some(([, memory]) => memory.text === "Stood beside the riders of House Hildmere on day 3."));
  const done = advanceRaid(clash.raid!, { minute: raidEndMinute(raid), residents: village, roster: raidRoster, storm: false, aid });
  assert.equal(done.record?.aidHouseId, "house-hildmere");
  const after = afterRaid(realm, { outcome: done.record!.outcome, aidHouseId: done.record!.aidHouseId }, raidEndMinute(raid));
  assert.ok(after.realm.houses["house-hildmere"].regard >= 61);
  assert.equal(after.events[0].text, "Ealdholt and House Hildmere stood together against the outlaws. It will be remembered at Hildmere Ford.");

  // No friend close enough: the beacon burns for no one. No early sighting and no warning: there is no time to light it.
  const alone = advanceRaid(advanceRaid(raid, { minute: night, residents: village, roster: raidRoster, storm: false, aid: null }).raid!,
    { minute: night + 25, residents: village, roster: raidRoster, storm: false, aid: null });
  assert.ok(alone.events.some(event => event.text === "The beacon is lit, but no neighbouring house rides for Ealdholt."));
  const unseen = startRaid({ worldKey: "w", minute: night, serial: 1, provoked: false, watchAtPost: false, sites: [] });
  const late = advanceRaid(unseen, { minute: night + 10, residents: village, roster: raidRoster, storm: false, aid });
  assert.equal(late.raid?.allies, null);
  assert.ok(!late.events.some(event => /beacon/.test(event.text)));
  // A burning brings help from the warmest house.
  const burned = afterRaid(createRealm(), { outcome: "burned", aidHouseId: null }, night);
  assert.deepEqual(burned.events.map(event => event.text), ["House Thornhallow sends hands and timber to raise what the outlaws burned."]);
});

test("when outlaws strike a neighbour, Ealdholt's watch rides for a friend and stays home for a rival", () => {
  // Find a day on which a house's roll means outlaws, at an hour when the watch is awake.
  let found: { day: number; houseId: string; minute: number } | null = null;
  for (let day = 7; day < 2000 && !found; day++) for (const candidate of realmCandidates("w", day)) if (candidate.roll < .07) { found = { day, ...candidate }; break; }
  assert.ok(found);
  const house = neighbourHouse(found.houseId)!;
  const start = look(createRealm(), found.day * 1440).realm;
  const friend = look(withHouse(start, house.id, { regard: 40 }), found.minute);
  const friendTexts = friend.events.filter(event => event.houseId === house.id).map(event => event.text);
  assert.equal(friendTexts[0], house.happenings.outlaws);
  assert.match(friendTexts[1], new RegExp(`^\\w+ of Ealdholt's watch ride to ${house.seat} and help run them off\\.$`));
  assert.ok(friend.memories.some(([id, memory]) => raidRoster.person(id)?.guard && memory.text === `Rode to ${house.seat} against outlaws on day ${found!.day + 1}.`));
  assert.equal(friend.realm.houses[house.id].regard, 50);
  const rival = look(withHouse(start, house.id, { regard: -30 }), found.minute);
  assert.ok(rival.events.some(event => event.text === "Ealdholt bars its own doors and does not ride."));
  assert.equal(rival.realm.houses[house.id].regard, -33);
});

test("the realm is saved with the observer; a damaged or older save begins the realm again", () => {
  let realm = look(createRealm(), 5 * 1440 + 400).realm;
  realm = actOnHouse(realm, "house-thornhallow", "befriend", 5 * 1440 + 420)!.realm;
  assert.ok(realm.outing, "the pilgrims are on the road");
  const back = parseObserverSave(serializeObserverSave({ ...EMPTY_OBSERVER_SAVE, realm }));
  assert.deepEqual(back.realm, realm);
  assert.deepEqual(parseObserverSave(JSON.stringify({ version: 1 })).realm, createRealm(), "a save from before the houses");
  const damaged = parseRealm({ houses: { "house-hildmere": { regard: "low" }, "house-holtmere": { regard: 500, fortune: -3 } }, outing: { kind: "war" } });
  assert.deepEqual(damaged.houses["house-hildmere"], createRealm().houses["house-hildmere"]);
  assert.deepEqual([damaged.houses["house-holtmere"].regard, damaged.houses["house-holtmere"].fortune], [100, 0]);
  assert.equal(damaged.outing, null);
});
