/**
 * What the villagers of Ealdholt say aloud while they are watched (the creator's direction of 11 November 2026:
 * speech bubbles floating up over the village, as in hello-world, in place of reading a list). Each villager speaks
 * from what they are actually doing in their own routine, and reacts to what happens around them: the sky turning,
 * bandits on the road, a neighbouring house's traders at the well, something they remember. Neighbours answer one
 * another. Nobody in the village knows the observer is there.
 *
 * The approach follows hello-world's simulation/dialogue.ts with the creator's leave: banks of lines chosen
 * deterministically, a village-wide rule against repeating a line too soon, call and reply between two people in
 * the same place, and remembered events voiced later. The lines themselves are written for Ealdholt.
 *
 * Pure and deterministic: every choice is a hash of the world key, the minute and the speaker.
 */
import type { ChronicleResident, ResidentMemory } from "./village-chronicle";
import type { RaidOutcome, RaidPhase } from "./bandit-raid";

export type VoiceTone = "say" | "call" | "pray" | "play" | "alarm" | "sleep";
export interface VoiceLine {
  readonly id: string;
  readonly residentId: string;
  readonly text: string;
  readonly tone: VoiceTone;
  /** Where the speaker is (their scheduled place), for a view without their figure. */
  readonly placeId: string;
  readonly minute: number;
  /** The line this one answers; the view shows it a moment later. */
  readonly replyTo?: string;
}
export interface VoiceRoster {
  person(residentId: string): { readonly label: string; readonly young: boolean; readonly elder: boolean; readonly guard: boolean; readonly major: boolean } | null;
  placeKind(placeId: string): "home" | "workplace" | "social" | "service" | "travel" | null;
}
export type VoiceSky = "clear" | "overcast" | "rain" | "storm";
export interface VoiceContext {
  readonly worldKey: string;
  /** Absolute observed world minute. */
  readonly minute: number;
  /** The villagers as they are shown (a raid's shelter and an outing's road already laid over their routine). */
  readonly residents: readonly ChronicleResident[];
  readonly sky: VoiceSky;
  readonly raid: { readonly phase: RaidPhase; readonly outcome: RaidOutcome | null; readonly allies: string | null } | null;
  /** A neighbouring house's people in the village now. */
  readonly visitors: { readonly kind: "traders" | "pilgrims" | "kin"; readonly seat: string } | null;
  readonly followId: string | null;
  readonly memories: Readonly<Record<string, readonly ResidentMemory[]>>;
  /** How many new lines this look may start (replies not counted). */
  readonly maxLines: number;
}
export interface VoiceState {
  readonly lastMinute: number;
  readonly lastSky: VoiceSky | null;
  readonly lastRaidPhase: RaidPhase | null;
  /** When each villager last spoke. */
  readonly spoke: Readonly<Record<string, number>>;
  /** When each line of each bank was last used. */
  readonly used: Readonly<Record<string, number>>;
  readonly slots: Readonly<Record<string, number>>;
  readonly serial: number;
}
export function createVoices(): VoiceState {
  return { lastMinute: -1, lastSky: null, lastRaidPhase: null, spoke: {}, used: {}, slots: {}, serial: 0 };
}

/** A villager rests their voice this long (village minutes); the followed villager far less. */
export const VOICE_COOLDOWN_MINUTES = 30;
export const VOICE_FOLLOWED_COOLDOWN_MINUTES = 8;
/** A line is not heard again anywhere in the village for this long, while fresh ones remain. */
export const VOICE_REUSE_MINUTES = 120;
/** ...and never within this long: a speaker with nothing new to say talks of the day, or keeps quiet. */
export const VOICE_REPEAT_MINUTES = 20;
/** Nobody reminisces about something that has only just happened. */
export const VOICE_MEMORY_AGE_MINUTES = 180;

type Bank = readonly string[];
interface Topic { readonly key: string; readonly tone: VoiceTone; readonly reply: keyof typeof REPLIES; readonly lines: Bank }
const topic = (key: string, tone: VoiceTone, reply: keyof typeof REPLIES, lines: Bank): Topic => ({ key, tone, reply, lines });

const REPLIES = {
  talk: ["Aye.", "So I heard.", "Is that so?", "Ha!", "Don't I know it.", "You always say that."],
  work: ["Aye, nearly there.", "Hold it steady, then.", "As you say.", "It'll do."],
  market: ["Too dear!", "I'll take two.", "Yesterday's, more like.", "Go on, then."],
  play: ["Am not!", "Wait for me!", "No fair!", "Race you!"],
  pray: ["Amen.", "Amen to that."],
  none: [],
} as const satisfies Record<string, Bank>;

/** What a villager says about their work, by the words of their own routine. The first match wins. */
const ROUTINE: readonly (readonly [RegExp, Topic])[] = [
  [/forge|anvil|quench|hammer|bellows|tongs/i, topic("forge", "say", "work", [
    "Steady on the bellows, now.", "Good iron. Listen to it ring.", "Mind the sparks, child.", "Another hinge for the hall door.",
    "Hot work for a cold morning.", "Quench it quick. There."])],
  [/pray|office|mass|psalm|candle|graves|churchyard|the (morning|evening) bell|church/i, topic("church", "pray", "pray", [
    "Lord, keep this village through the night.", "Bless the fields and those who work them.", "Peace on this house and all within.",
    "Ring it true, so the far fields hear.", "Mind the step, and God keep you."])],
  [/letters|teach|learn|copies|writes|reads/i, topic("letters", "say", "talk", [
    "A, B... what comes after B?", "Again, from the top. Slowly.", "Ink is cheap. Parchment is not. Careful!", "That's your own name you've written."])],
  [/\bsells?\b|market|trades?|pedlar/i, topic("market", "call", "market", [
    "Fresh eggs! Laid this morning!", "Flour, fine-ground! Meal for your pot!", "Needles, ribbons, salt!",
    "Cheese and butter, cool from the dairy!", "Sausages! Puddings! Hot from the pan!", "Good yarn. Feel that. No, go on."])],
  [/plays?\b|chase|games|pebble/i, topic("play", "play", "play", [
    "Can't catch me!", "You're it! No, YOU'RE it!", "I saw a frog as big as a loaf.", "Bet I can skip a stone farther.", "I'm telling the priest!"])],
  [/errands/i, topic("errand", "play", "talk", [
    "Mother says can she borrow your pot?", "A message for the smith! Where's the smith?", "I ran the whole way. Nearly."])],
  [/news|gossip|stories|neighbours|at the well/i, topic("gossip", "say", "talk", [
    "Did you hear about the miller's son?", "My knees say rain before nightfall.", "They say the ford is running high.",
    "Mark me, that goose will be the death of someone.", "The reeve was up before the cock again.", "Any word from the road?"])],
  [/plough|hoes?\b|sows?\b|weed|reap|arable|field|strips|carting/i, topic("fields", "say", "work", [
    "Straight furrows, now. Straight!", "This soil is sweet after rain.", "Crows in the barley again.", "We'll have it sown by Sunday.", "My back says it's noon."])],
  [/sheep|flock|fold|lamb|geese|cattle|cows?\b|milk|herd|pasture|goat|pigs?\b|poultry|hens?\b/i, topic("herd", "say", "work", [
    "Come by! Come by, girl!", "That ewe is limping again.", "Hush, hush. Milk's nearly done.", "Who let the geese out?", "Count them twice. Then once more."])],
  [/watch|patrol|drill|spear|\barms\b|guard|recruit|gear|lookout/i, topic("watch", "say", "work", [
    "Eyes on the road.", "Again! Spears level!", "Quiet, so far. I don't trust quiet.", "Shields tight. Tighter!",
    "Who goes? ...Only the miller.", "Oil that mail or it'll rust on you."])],
  [/cook|bake|bread|oven|brew|\bale\b|knead|churn|salts?\b|sausage|stuffs?\b|mash/i, topic("kitchen", "say", "work", [
    "Bread's nearly done. Hands off.", "More salt. No, less. There.", "Stir it, don't drown it.", "That's the last of the good flour.", "The hall eats like an army."])],
  [/meal|breakfast|\beats?\b|supper/i, topic("meal", "say", "talk", [
    "Eat up. There's work waiting.", "Pass the bread, would you?", "Bless this table.", "Who took the last of the cheese?"])],
  [/spin|weave|loom|wool|dye|cards?\b|sews?\b|stitch|yarn|warp|cloth|fleece/i, topic("cloth", "say", "work", [
    "This thread keeps snapping.", "Lovely colour, that madder.", "Card it finer. Finer than that.", "A good cloak in this, by winter."])],
  [/heal|herb|sick|midwife|poultice|elderly|remed/i, topic("heal", "say", "talk", [
    "Feverfew for the head. Rest for the rest.", "Broth, and keep him warm.", "Breathe slow. There's no hurry.", "Yarrow. I need more yarrow."])],
  [/\bmill|grind|sieve|meal\b/i, topic("mill", "say", "work", ["The stone's running sweet today.", "Fine as snow, this flour.", "Mind your fingers by the hopper."])],
  [/mend|repair|carve|whittle|saws?\b|timber|stone|mason|joins?\b|fits?\b|barrel|shoe|leather|\btan|hide|shapes?\b|dress/i, topic("craft", "say", "work", [
    "Measure twice. Cut once.", "Hand me that mallet.", "Oak for the frame. Nothing less.", "There. That'll outlast us both."])],
  [/tally|accounts|stores|concerns|plans|labour|dues|hall/i, topic("hall", "say", "talk", [
    "Count it again. Slowly.", "The stores will see us to spring.", "One at a time. I'll hear you all.", "That's the house's due, and fairly asked."])],
  [/water|fetch|carr(y|ies)|wash|sweep|scrub|chores|tid(y|ies)|clears?\b/i, topic("chores", "say", "talk", [
    "This bucket gets heavier every year.", "Sweep it out, then sweep again.", "The washing won't hang itself.", "There. Clean enough for a bishop."])],
  [/rests?\b|sits?\b|\bsun\b|doorstep|by the fire|watches/i, topic("rest", "say", "talk", [
    "Ah. That sun is a blessing.", "I've earned this sit.", "In my day the winters were colder.", "Let the young ones run. I'll watch."])],
];
const FALLBACK: Readonly<Record<"morning" | "day" | "evening" | "night", Topic>> = {
  morning: topic("morning", "say", "talk", ["Morning. Up with the sun again.", "Cold start. It'll warm.", "Another day, God willing a dull one."]),
  day: topic("day", "say", "talk", ["Fair enough day for it.", "No rest till the light goes.", "Well. On we go."]),
  evening: topic("evening", "say", "talk", ["The light's going.", "Long day. Good day.", "Home soon, and glad of it."]),
  night: topic("night", "say", "talk", ["Late to be up.", "Quiet tonight.", "Bank the fire before bed."]),
};

// The sky turning, said by people out of doors.
const SKY: Readonly<Record<VoiceSky, Topic>> = {
  rain: topic("sky-rain", "say", "talk", ["Rain! Get the washing in!", "There goes the hay.", "It'll do the beans good.", "Under the eaves, quick!"]),
  storm: topic("sky-storm", "alarm", "none", ["That sky came out of nowhere!", "Storm! Everyone under a roof!", "Hold on to the thatch!", "Saints preserve us, what a wind."]),
  clear: topic("sky-clear", "say", "talk", ["There's the sun again.", "Well. That passed.", "Look at that sky clear."]),
  overcast: topic("sky-cloud", "say", "talk", ["Clouding over.", "That's a grey lid on the day.", "Smells like rain coming."]),
};
const WET = topic("wet", "say", "talk", ["Wet through to the bone.", "Does it ever stop?", "My boots are ponds."]);

// Bandits: by what the raid has each villager doing.
const RAID = {
  sighted: topic("raid-sighted", "alarm", "none", ["Torches on the road! Wake the captain!", "Those are no pilgrims. Ring the bell!"]),
  muster: topic("raid-muster", "alarm", "none", ["To the guard yard! Move!", "Spears! Shields! With me!", "Hold the lane. They'll come by the farmstead."]),
  woken: topic("raid-woken", "alarm", "none", ["The bell! Where's my spear?", "Up! Up! They're on the road!"]),
  door: topic("raid-door", "alarm", "none", ["Bar the door. Bar it!", "Away from the window.", "Not a sound, now."]),
  hurried: topic("raid-hurried", "alarm", "none", ["Inside, little one. Now.", "I'm frightened.", "Lean on me. Quickly."]),
  church: topic("raid-church", "alarm", "none", ["Into the church, all of you!", "The door is oak. It will hold."]),
  fight: topic("raid-fight", "alarm", "none", ["Hold! Hold the line!", "Drive them back!", "For Ealdholt!"]),
  fightAllied: topic("raid-fight-allied", "alarm", "none", ["{ally} is with us! Push!", "Riders! We're not alone!"]),
  hush: topic("raid-hush", "alarm", "none", ["Hush. Stay down.", "Are they in the lane?", "Listen. Steel."]),
  repelled: topic("raid-repelled", "call", "talk", ["They're running! Look at them run!", "Ealdholt holds!", "Is anyone hurt? Sound off!"]),
  plundered: topic("raid-plundered", "say", "talk", ["They took the grain.", "No one's dead. That's something.", "We'll be hungry before spring."]),
  water: topic("raid-water", "alarm", "none", ["Water! Bring water!", "Pass the buckets! Faster!", "Wet the thatch next door!"]),
} as const;

// A neighbouring house's people in the village.
const VISITORS: Readonly<Record<"traders" | "pilgrims" | "kin", { readonly places: ReadonlySet<string>; readonly topic: Topic }>> = {
  traders: { places: new Set(["village-well", "village-courtyard"]), topic: topic("visit-traders", "say", "market", [
    "What is {seat} asking for salt?", "Look at that blue cloth!", "Too dear. Far too dear.", "I'll take two. No, three."]) },
  pilgrims: { places: new Set(["churchyard", "proposed-church", "proposed-green"]), topic: topic("visit-pilgrims", "pray", "pray", [
    "Welcome, pilgrims. Mind the step.", "You've walked far. Sit, sit.", "Pray one for us at your own altar."]) },
  kin: { places: new Set(["proposed-green", "proposed-house-hall", "village-courtyard", "proposed-guard-yard"]), topic: topic("visit-kin", "say", "talk", [
    "Look who's come down from {seat}!", "Sit! Eat! Tell us everything.", "To kin, near and far!"]) },
};

/** Something remembered, said aloud later: by the memory's key (village-chronicle.ts, bandit-raid.ts, neighbour-houses.ts). */
const MEMORY: readonly (readonly [RegExp, RegExp | null, string])[] = [
  [/^storm:/, null, "I was caught in that storm. Soaked to the bone."],
  [/^rain:/, null, "That rain caught me out. I'm still damp."],
  [/^raid:/, /^Drove off/, "We drove them off. Did you see them run?"],
  [/^raid:/, /^Fought/, "We couldn't hold them. Next time we will."],
  [/^raid:/, /^Hid/, "I hid when the outlaws came. I'm not proud of it."],
  [/^raid-water:/, null, "My arms still ache from the buckets."],
  [/^raid-aid:/, null, "Those riders came for us. I'll not forget it."],
  [/^worship:/, null, "I lit a candle this morning."],
  [/^journey:/, null, "A long road, but good to see what's beyond it."],
  [/^outing:pilgrimage/, null, "The Barrow-stones at dawn. You should see them."],
  [/^outing:market/, null, "Market prices! Daylight robbery."],
  [/^outing:kin/, null, "The hill cousins send their love."],
  [/^realm:[^:]+:traders/, null, "That trader's salt was dear, but good."],
  [/^realm:[^:]+:pilgrims/, null, "Those pilgrims sang beautifully."],
  [/^realm:[^:]+:kin/, null, "Good to share a cup with them."],
  [/^realm:[^:]+:outlaws/, null, "We rode out against outlaws. A hard ride."],
];

function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const asleep = (activity: string) => /^asleep\b/i.test(activity.trim());
const dayPart = (minute: number): keyof typeof FALLBACK => { const m = ((minute % 1440) + 1440) % 1440; return m < 300 || m >= 1260 ? "night" : m < 600 ? "morning" : m < 1020 ? "day" : "evening"; };

/** The topic a villager's own routine gives them (their work, a meal, play), or the time of day's small talk. */
export function routineTopic(activity: string, minute: number): { readonly key: string; readonly tone: VoiceTone; readonly lines: Bank } {
  for (const [words, found] of ROUTINE) if (words.test(activity)) return found;
  return FALLBACK[dayPart(minute)];
}
function raidTopic(resident: ChronicleResident, raid: NonNullable<VoiceContext["raid"]>, guard: boolean): Topic | null {
  const activity = resident.activity;
  if (/^Carries water/.test(activity)) return RAID.water;
  if (raid.phase === "aftermath") return raid.outcome === "repelled" ? RAID.repelled : raid.outcome === "plundered" ? RAID.plundered : null;
  if (!resident.alarm) return null;
  if (guard) return raid.phase === "clash" ? (raid.allies ? RAID.fightAllied : RAID.fight) : /^Wakes/.test(activity) ? RAID.woken : RAID.muster;
  if (raid.phase === "clash") return RAID.hush;
  return /church/.test(activity) ? RAID.church : /hurried/.test(activity) ? RAID.hurried : RAID.door;
}

/** One look at the village: who speaks now, and what they say. Nothing new is said while time stands still. */
export function speakVillage(state: VoiceState, context: VoiceContext, roster: VoiceRoster): { readonly state: VoiceState; readonly lines: readonly VoiceLine[] } {
  const { minute, worldKey } = context;
  if (minute === state.lastMinute) return { state, lines: [] };
  const first = state.lastMinute < 0, lines: VoiceLine[] = [];
  const spoke: Record<string, number> = { ...state.spoke }, used: Record<string, number> = { ...state.used }, slots: Record<string, number> = {};
  let serial = state.serial;
  const awake = context.residents.filter(resident => !resident.away && !asleep(resident.activity) && roster.placeKind(resident.scheduledPlaceId) !== "travel" && roster.person(resident.residentId));
  const rested = (id: string) => minute - (spoke[id] ?? -1e9) >= (id === context.followId ? VOICE_FOLLOWED_COOLDOWN_MINUTES : VOICE_COOLDOWN_MINUTES);
  const outdoors = (resident: ChronicleResident) => roster.placeKind(resident.scheduledPlaceId) !== "home" && resident.scheduledPlaceId !== "proposed-church";

  /** A line from a bank: one not heard for a while if any remain, else the one heard longest ago (null if even that is recent). */
  const choose = (bank: Topic | { key: string; lines: Bank }, salt: string): string | null => {
    if (!bank.lines.length) return null;
    const fresh: number[] = [];
    let oldest = 0, oldestAt = Infinity;
    bank.lines.forEach((_, index) => {
      const at = used[`${bank.key}#${index}`];
      if (at === undefined || minute - at >= VOICE_REUSE_MINUTES) fresh.push(index);
      else if (at < oldestAt) { oldestAt = at; oldest = index; }
    });
    if (!fresh.length && minute - oldestAt < VOICE_REPEAT_MINUTES) return null;
    const index = fresh.length ? fresh[Math.floor(hash01(`${worldKey}|line|${bank.key}|${minute}|${salt}`) * fresh.length)] : oldest;
    used[`${bank.key}#${index}`] = minute;
    return bank.lines[index];
  };
  const say = (resident: ChronicleResident, text: string, tone: VoiceTone, replyTo?: string): VoiceLine => {
    const line: VoiceLine = { id: `v${serial++}`, residentId: resident.residentId, text, tone, placeId: resident.scheduledPlaceId, minute, ...(replyTo ? { replyTo } : {}) };
    lines.push(line); spoke[resident.residentId] = minute;
    return line;
  };
  const fill = (text: string) => text.replace("{seat}", context.visitors?.seat ?? "the market").replace("{ally}", context.raid?.allies ?? "Help");
  /** The first few of a group, in an order fixed by the minute. */
  const some = (group: readonly ChronicleResident[], count: number, salt: string) =>
    group.map(resident => [hash01(`${worldKey}|who|${salt}|${minute}|${resident.residentId}`), resident] as const).sort((a, b) => a[0] - b[0]).slice(0, count).map(([, resident]) => resident);
  const speakFrom = (group: readonly ChronicleResident[], bank: Topic, count: number, salt: string) => {
    for (const resident of some(group, count, salt)) { const text = choose(bank, resident.residentId); if (text) say(resident, fill(text), bank.tone); }
  };

  // 1. The raid moving on: the people it holds cry out at once, whatever they said a moment ago.
  const phase = context.raid?.phase ?? null;
  if (!first && context.raid && phase !== state.lastRaidPhase) {
    if (phase === "sighted") speakFrom(awake.filter(r => r.scheduledPlaceId === "proposed-watch-post" && roster.person(r.residentId)?.guard), RAID.sighted, 1, "sighted");
    else {
      const groups = new Map<Topic, ChronicleResident[]>();
      for (const resident of awake) {
        const bank = raidTopic(resident, context.raid, !!roster.person(resident.residentId)?.guard);
        if (bank) groups.set(bank, [...(groups.get(bank) ?? []), resident]);
      }
      const share = Math.max(1, Math.ceil((context.maxLines + 1) / Math.max(1, groups.size)));
      for (const [bank, group] of groups) speakFrom(group, bank, share, `raid-${phase}`);
    }
  }
  // 2. The sky turning: people out of doors remark on it.
  if (!first && state.lastSky !== null && context.sky !== state.lastSky && lines.length < context.maxLines + 1) {
    speakFrom(awake.filter(resident => outdoors(resident) && !resident.alarm), SKY[context.sky], Math.max(1, context.maxLines), "sky");
  }

  // 3. The village's ordinary talk: whoever the minute favours, among those who have rested their voice.
  const room = Math.max(0, context.maxLines - lines.length);
  if (room > 0) {
    const scored = awake.filter(resident => rested(resident.residentId)).map(resident => {
      const person = roster.person(resident.residentId)!;
      const changed = !first && state.slots[resident.residentId] !== undefined && state.slots[resident.residentId] !== resident.slotIndex;
      const weight = 1 + (resident.residentId === context.followId ? 8 : 0) + (person.major ? 1 : 0) + (changed ? 3 : 0)
        + (roster.placeKind(resident.scheduledPlaceId) === "social" ? 1 : 0) + (resident.alarm ? 3 : 0);
      return [hash01(`${worldKey}|voice|${minute}|${resident.residentId}`) / weight, resident] as const;
    }).sort((a, b) => a[0] - b[0]);
    for (const [, resident] of scored.slice(0, room)) {
      if (!rested(resident.residentId)) continue; // they have just answered a neighbour
      const person = roster.person(resident.residentId)!, roll = hash01(`${worldKey}|what|${minute}|${resident.residentId}`);
      let bank: Topic | null = context.raid ? raidTopic(resident, context.raid, person.guard) : null;
      let text: string | null = null;
      if (!bank && context.visitors && VISITORS[context.visitors.kind].places.has(resident.scheduledPlaceId) && roll < .6) bank = VISITORS[context.visitors.kind].topic;
      if (!bank && roll >= .6 && roll < .72) {
        // Something remembered, said aloud (the newest memory that has words for it), once it is a few hours old.
        for (const memory of context.memories[resident.residentId] ?? []) {
          if (minute - memory.minute < VOICE_MEMORY_AGE_MINUTES) continue;
          const found = MEMORY.find(([key, words]) => key.test(memory.key) && (!words || words.test(memory.text)));
          if (found && minute - (used[`memory#${memory.key}#${resident.residentId}`] ?? -1e9) >= 1440) { text = found[2]; used[`memory#${memory.key}#${resident.residentId}`] = minute; break; }
        }
      }
      if (!bank && !text && (context.sky === "rain" || context.sky === "storm") && outdoors(resident) && roll >= .72 && roll < .86) bank = WET;
      let chosen = bank ?? (text ? null : routineTopic(resident.activity, minute) as Topic);
      let spoken = text ?? (chosen ? choose(chosen, resident.residentId) : null);
      // Nothing new to say about the work: small talk about the day instead (never during a raid).
      if (!spoken && !resident.alarm && chosen !== FALLBACK[dayPart(minute)]) { chosen = FALLBACK[dayPart(minute)]; spoken = choose(chosen, resident.residentId); }
      if (!spoken) continue;
      const line = say(resident, fill(spoken), text ? "say" : chosen!.tone);
      // A neighbour in the same place answers.
      const replies = chosen && "reply" in chosen ? REPLIES[chosen.reply] : REPLIES.talk;
      if (replies.length && hash01(`${worldKey}|reply|${minute}|${resident.residentId}`) < .55) {
        const [neighbour] = some(awake.filter(other => other.residentId !== resident.residentId && other.scheduledPlaceId === resident.scheduledPlaceId
          && !other.alarm && rested(other.residentId) && roster.placeKind(other.scheduledPlaceId) !== "home"), 1, `reply-${resident.residentId}`);
        const answer = neighbour ? choose({ key: `reply-${chosen && "reply" in chosen ? chosen.reply : "talk"}`, lines: replies }, neighbour.residentId) : null;
        if (neighbour && answer) say(neighbour, answer, chosen?.tone === "play" ? "play" : chosen?.tone === "pray" ? "pray" : "say", line.id);
      }
    }
  }
  // 4. A sleeper's breath, now and then, when the village is otherwise quiet.
  if (!lines.length && dayPart(minute) === "night" && hash01(`${worldKey}|zzz|${minute}`) < .35) {
    const [sleeper] = some(context.residents.filter(resident => asleep(resident.activity) && !resident.away && minute - (spoke[resident.residentId] ?? -1e9) >= 120), 1, "zzz");
    if (sleeper) say(sleeper, "Zzz", "sleep");
  }

  for (const resident of context.residents) slots[resident.residentId] = resident.slotIndex;
  // Keep the books small.
  for (const key of Object.keys(used)) if (minute - used[key] > 2 * 1440) delete used[key];
  return { state: { lastMinute: minute, lastSky: context.sky, lastRaidPhase: phase, spoke, used, slots, serial }, lines };
}

/** Every line a villager can say, for checks on length and wording. */
export function allVoiceLines(): readonly string[] {
  return [...ROUTINE.flatMap(([, t]) => t.lines), ...Object.values(FALLBACK).flatMap(t => t.lines), ...Object.values(SKY).flatMap(t => t.lines), ...WET.lines,
    ...Object.values(RAID).flatMap(t => t.lines), ...Object.values(VISITORS).flatMap(v => v.topic.lines), ...MEMORY.map(([, , text]) => text), ...Object.values(REPLIES).flat()];
}
