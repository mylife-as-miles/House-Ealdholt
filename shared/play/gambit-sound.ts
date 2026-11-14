/**
 * The King's Gambit match sound, as rules: which voice each piece has, which line it says when it wakes under its
 * killer, how often the doomed wake at all, how the fallen grow louder in the hall, and what plays when a game ends.
 * No audio here: the desktop mixer (web/src/audio/audioManager.ts) asks these rules and plays the named clips from
 * web/src/audio/gambit-assets.ts. Clip names follow web/sound-design/gambit/plan.json. The pieces' reactions to what
 * happens to them (the barks) are ruled in ./gambit-barks.ts; their clips are listed here with the rest.
 */

export type GambitSide = "w" | "b";
export type GambitRank = "p" | "n" | "b" | "r" | "q" | "k";
export type GambitTimbre = "scuff" | "leather" | "plate" | "regal";

/**
 * The four kingdoms, by the army ids the match uses (ArmySkinId): each has a cast of seven voices of its own, and a
 * side speaks in the voices of the kingdom it fields.
 */
export type GambitKingdom = "ivory" | "sun" | "empire" | "kwind";
export const KINGDOMS = ["ivory", "sun", "empire", "kwind"] as const satisfies readonly GambitKingdom[];
export const KINGDOM_NAMES: Readonly<Record<GambitKingdom, string>> = { ivory: "Aethelgard", sun: "Solforiz", empire: "Korvenia", kwind: "Kwind-09" };
/** The kingdoms the two sides field when nobody says otherwise. */
export const DEFAULT_KINGDOMS: Readonly<Record<GambitSide, GambitKingdom>> = { w: "ivory", b: "sun" };

export function isKingdom(value: string): value is GambitKingdom {
  return (KINGDOMS as readonly string[]).includes(value);
}

/** One of a kingdom's seven voices: two for its footsoldiers, then one for each other rank. */
export type VoiceSlot = "p1" | "p2" | "n" | "b" | "r" | "q" | "k";
export const VOICE_SLOTS = ["p1", "p2", "n", "b", "r", "q", "k"] as const satisfies readonly VoiceSlot[];

/**
 * A footsoldier keeps one of its kingdom's two voices all game, by the file it started on: the a, c, e and g files
 * speak in the first, the b, d, f and h files in the second, so neighbours never sound alike.
 */
export function pawnSlot(file: string): "p1" | "p2" {
  return (file.charCodeAt(0) - 97) % 2 === 0 ? "p1" : "p2";
}

/** The voice of a piece, `<kingdom>_<slot>`: "sun_p2", "kwind_q". A pawn names its slot; it is p1 when it does not. */
export function voiceId(kingdom: GambitKingdom, rank: GambitRank, slot?: "p1" | "p2"): string {
  return `${kingdom}_${rank === "p" ? slot ?? "p1" : rank}`;
}

/** Footsoldiers share two voices per kingdom so a long game does not hear one man die eight times. */
export function voicesFor(kingdom: GambitKingdom, rank: GambitRank): string[] {
  return rank === "p" ? [`${kingdom}_p1`, `${kingdom}_p2`] : [`${kingdom}_${rank}`];
}

/** A voice's three waking pleas. The king never wakes this way: he speaks in check and at the end. */
export function pleaClips(voice: string): string[] {
  return [`${voice}_a`, `${voice}_b`, `${voice}_c`];
}

export function deathClip(voice: string): string {
  return `${voice}_death`;
}

/** The king in check, under his breath: four lines a kingdom. */
export const CHECK_LINES = 4;
export function checkClips(kingdom: GambitKingdom): string[] {
  return Array.from({ length: CHECK_LINES }, (_, i) => `${kingdom}_k_check_${String.fromCharCode(97 + i)}`);
}

/**
 * The checkmated king's words: he sees it is over and yields (three lines a kingdom). He is never taken, so he never
 * speaks of dying. The mixer's endGame says one; the downfall's staging asks for them by name too (defeatClips).
 */
export function mateClips(kingdom: GambitKingdom): string[] {
  return [`${kingdom}_k_defeat_a`, `${kingdom}_k_defeat_b`, `${kingdom}_k_defeat_c`];
}
export const defeatClips = mateClips;

/** Who says a spoken clip, for subtitles: an army's piece, or the fallen (side null). */
export interface GambitSpeaker {
  side: GambitSide | null;
  name: string;
}

const RANK_NAMES: Record<GambitRank, string> = {
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

/** What each side is called when nobody says otherwise: the kingdoms that field the two armies by default. */
export const DEFAULT_SIDE_NAMES: Readonly<Record<GambitSide, string>> = { w: KINGDOM_NAMES[DEFAULT_KINGDOMS.w], b: KINGDOM_NAMES[DEFAULT_KINGDOMS.b] };

/**
 * The speaker of a voice clip ("Korvenia Knight", "The Fallen"); null for clips nobody says. A piece's clip names its
 * kingdom, and so its speaker. `side` is the side it spoke for, as the mixer knows it; without one the side is the one
 * whose kingdom `sideName` gives that name.
 */
export function speakerFor(clip: string, sideName: (side: GambitSide) => string = (side) => DEFAULT_SIDE_NAMES[side], side?: GambitSide): GambitSpeaker | null {
  const piece = /^(ivory|sun|empire|kwind)_(p[12]|[nbrqk])_/.exec(clip);
  if (piece) {
    const name = KINGDOM_NAMES[piece[1] as GambitKingdom];
    const owner = side ?? (["w", "b"] as const).find((candidate) => sideName(candidate) === name) ?? null;
    return { side: owner, name: `${name} ${RANK_NAMES[piece[2][0] as GambitRank]}` };
  }
  return /^(ghost|start)_/.test(clip) ? { side: null, name: "The Fallen" } : null;
}

/** The kingdom whose voice a clip is, or null for a clip that belongs to no kingdom (effects, the fallen, the score). */
export function clipKingdom(clip: string): GambitKingdom | null {
  const head = clip.split("_")[0];
  return isKingdom(head) && /^[a-z]+_(p[12]|[nbrqk])_/.test(clip) ? head : null;
}

/** The fallen, heard far off between moves. */
export const WHISPERS = ["ghost_a", "ghost_b", "ghost_c", "ghost_d", "ghost_e", "ghost_f", "ghost_g", "ghost_h", "ghost_i", "ghost_j"] as const;
export const START_WHISPERS = ["start_a", "start_b"] as const;

/** The blow each rank lands. Casters fight at range, so their melee entries are only safety nets. */
export function strikeClip(attacker: GambitRank): string {
  return ({ p: "hit_p", n: "hit_n", b: "hit_n", r: "hit_r", q: "hit_k", k: "hit_k" } as const)[attacker];
}

/**
 * The flesh under the weapon: what the blow does to the body it lands on. Each weapon opens a body its own way, and
 * the casters' fire has its own family for a spell kill.
 */
export type FleshFamily = "stab" | "slash" | "crush" | "cleave" | "blast";
export const FLESH_FAMILIES = ["stab", "slash", "crush", "cleave", "blast"] as const satisfies readonly FleshFamily[];
export const FLESH_TAKES = 3;

/** The wound each rank's weapon makes in melee: dagger, sword, war hammer, great sword. The mage falls back to the sword, as strikeClip does. */
export function fleshFamily(attacker: GambitRank): Exclude<FleshFamily, "blast"> {
  return ({ p: "stab", n: "slash", b: "slash", r: "crush", q: "cleave", k: "cleave" } as const)[attacker];
}

export function fleshClips(family: FleshFamily): string[] {
  return Array.from({ length: FLESH_TAKES }, (_, i) => `flesh_${family}_${i + 1}`);
}

/** Blood and torn flesh spattering onto the stone as the body falls. */
export function goreClips(): string[] {
  return Array.from({ length: FLESH_TAKES }, (_, i) => `gore_splat_${i + 1}`);
}

/**
 * A shuffle bag: every option is heard once, in a random order, before any is heard again, and the first draw of a new
 * bag is never the last draw of the old one. `bag` holds what is left to draw; `last` is what was drawn last.
 */
export interface ShuffleBag<T> {
  bag: T[];
  last?: T;
}

export function drawFromBag<T>(options: readonly T[], state: ShuffleBag<T>, random: Random): T {
  peekBag(options, state, random);
  return takeFromBag(state);
}

/**
 * What the bag would give next, without taking it: a fresh shuffle is made when the bag is empty, exactly as
 * drawFromBag makes it, so peeking and then taking is the same as drawing. A line that might not get to sound is
 * peeked, and taken only once it does.
 */
export function peekBag<T>(options: readonly T[], state: ShuffleBag<T>, random: Random): T {
  if (state.bag.length === 0) {
    const fresh = [...options];
    // Fisher-Yates, from the top down.
    for (let i = fresh.length - 1; i > 0; i -= 1) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
    }
    // The bag is drawn from its end: if that would repeat the last draw, send that take to the back of the queue.
    if (fresh.length > 1 && fresh[fresh.length - 1] === state.last) fresh.unshift(fresh.pop() as T);
    state.bag = fresh;
  }
  return state.bag[state.bag.length - 1];
}

/** Takes what peekBag showed. */
export function takeFromBag<T>(state: ShuffleBag<T>): T {
  const drawn = state.bag.pop() as T;
  state.last = drawn;
  return drawn;
}

/** What the mixer remembers about the wounds: one shuffle bag per family, kept across games. */
export type FleshMemory = Partial<Record<FleshFamily | "gore", ShuffleBag<string>>>;

/** A take of `family` (or of the gore): all three are heard before any repeats, and never the same one twice running. */
export function pickFlesh(family: FleshFamily | "gore", memory: FleshMemory, random: Random): string {
  const state = (memory[family] ??= { bag: [] });
  return drawFromBag(family === "gore" ? goreClips() : fleshClips(family), state, random);
}

/**
 * Which layers a kill plays. The menu's background game keeps its board silent apart from steel and stone, so it
 * hears no flesh and no gore. Under a blade the steel always sounds. Under a fireball the sword clang only stands in
 * for the wound where there is none (the menu's game): where the flesh blast plays, it replaces the clang.
 */
export function captureLayers(context: { silentBoard: boolean; spell: boolean }): { steel: boolean; flesh: boolean; gore: boolean } {
  const flesh = !context.silentBoard;
  return { steel: context.spell ? !flesh : true, flesh, gore: flesh };
}

/**
 * The duel's cues: what two soldiers sound like as they meet, before the killing strike. The names and the number of
 * takes follow CUE_SPECS in web/src/scene/combat/audio.ts; the recordings are `cue_*` in plan.json. `decisive` is not
 * here: it is the existing strike with its flesh.
 */
export const COMBAT_CUE_TAKES = {
  "clash.shield.wood": 4,
  "clash.shield.iron": 4,
  "clash.parry.steel": 4,
  "bash.shield": 3,
  "effort.light": 5,
  "effort.heavy": 4,
  brace: 3,
  recoil: 3,
  stagger: 3,
  "whoosh.light": 4,
  "whoosh.heavy": 3,
  "fall.light": 3,
  "fall.heavy": 3,
} as const;
export type CombatCue = keyof typeof COMBAT_CUE_TAKES;
export const COMBAT_CUES = Object.keys(COMBAT_CUE_TAKES) as CombatCue[];

export function isCombatCue(name: string): name is CombatCue {
  return Object.prototype.hasOwnProperty.call(COMBAT_CUE_TAKES, name);
}

/** How a cue is mixed: steel and wood meeting, a soldier's breath, boots and gear, air, a body on stone. */
export type CombatCueFamily = "clash" | "effort" | "foley" | "whoosh" | "fall";
export function combatCueFamily(cue: CombatCue): CombatCueFamily {
  if (cue.startsWith("clash.") || cue === "bash.shield") return "clash";
  if (cue.startsWith("effort.")) return "effort";
  if (cue.startsWith("whoosh.")) return "whoosh";
  if (cue.startsWith("fall.")) return "fall";
  return "foley";
}

export function combatCueClips(cue: CombatCue): string[] {
  return Array.from({ length: COMBAT_CUE_TAKES[cue] }, (_, i) => `cue_${cue.replace(/\./g, "_")}_${i + 1}`);
}

/** What the mixer remembers about the duels: one shuffle bag per cue, kept across fights and games. */
export type CombatCueMemory = Partial<Record<CombatCue, ShuffleBag<string>>>;

/** A take of `cue`: every take is heard before any repeats, and never the same one twice running. */
export function pickCombatCue(cue: CombatCue, memory: CombatCueMemory, random: Random): string {
  const state = (memory[cue] ??= { bag: [] });
  return drawFromBag(combatCueClips(cue), state, random);
}

/**
 * Whether a duel cue may sound. The menu's background game keeps its board silent apart from steel and stone, so its
 * soldiers clash, scrape and fall but do not breathe or grunt (as they do not gasp, plead or cry out there). A name
 * that is not a duel cue never sounds.
 */
export function combatCueAllowed(cue: string, context: { silentBoard: boolean }): boolean {
  if (!isCombatCue(cue)) return false;
  return !(context.silentBoard && combatCueFamily(cue) === "effort");
}

/**
 * A Queen's summon's own sounds (web/src/scene/rites/rite.ts RiteSound): the names a summon asks for, and how many
 * takes the bank has of each, `rite_<summon>_<what>_<n>`. They are recordings given to the public domain (CC0), cut
 * and levelled by the sound tool ("imported" in web/sound-design/gambit/plan.json). A summon's cue with no takes here
 * falls back on the scene's stand-in for it. A cue the rite asks for many times in one summon (wings, blows, blades)
 * has two or three takes, short enough not to smear at the rate it comes.
 */
export const RITE_CUE_TAKES = {
  // Aethelgard's wyvern. Its tearing ("rite.wyvern.tear") has no voice: the rip of the flesh under it is the sound.
  "rite.wyvern.screech": 3,
  "rite.wyvern.wingbeat": 3,
  "rite.wyvern.strike": 1,
  "rite.wyvern.bite": 3,
  // Solforiz's phoenix, a god of fire and sun: it cries, beats its wings, stoops, sets the piece alight, and becomes a
  // small sun over the board. Its cry is one generated hawk's screech with its canyon echo (docs/play/SUMMONS.md): the
  // only take of thirty that earshot heard as a bird of prey rather than a person screaming, a balloon or a gull.
  "rite.phoenix.cry": 1,
  "rite.phoenix.wingbeat": 3,
  "rite.phoenix.dive": 1,
  "rite.phoenix.ignite": 1,
  "rite.phoenix.sunburst": 1,
  // Kwind-09's undead army: current splits the seams, the dead climb out, groan, shamble in, tear the piece apart
  // (each wound a snarl over the flesh), and sink back as the stone closes.
  "rite.undead.split": 1,
  "rite.undead.arc": 1,
  "rite.undead.rise": 1,
  "rite.undead.groan": 3,
  "rite.undead.shamble": 1,
  "rite.undead.rend": 2,
  "rite.undead.tear": 3,
  "rite.undead.sink": 1,
  "rite.undead.close": 1,
  // Korvenia's shadow army: a clockwork seal, fog, soldiers rising as shadows, their march, charge and thrusts, a
  // colossus that climbs out, raises its sabre and breaks the stone under violet lightning, and the leaving.
  "rite.shadow.seal": 1,
  "rite.shadow.fog": 1,
  "rite.shadow.rise": 1,
  "rite.shadow.march": 1,
  "rite.shadow.charge": 1,
  "rite.shadow.thrust": 3,
  "rite.shadow.colossus": 1,
  "rite.shadow.raise": 1,
  "rite.shadow.strike": 1,
  "rite.shadow.thunder": 1,
  "rite.shadow.settle": 1,
  "rite.shadow.withdraw": 1,
  "rite.shadow.burn": 1,
  "rite.shadow.close": 1,
} as const;
export type RiteCue = keyof typeof RITE_CUE_TAKES;
export const RITE_CUES = Object.keys(RITE_CUE_TAKES) as RiteCue[];

export function isRiteCue(name: string): name is RiteCue {
  return Object.prototype.hasOwnProperty.call(RITE_CUE_TAKES, name);
}

export function riteCueClips(cue: RiteCue): string[] {
  return Array.from({ length: RITE_CUE_TAKES[cue] }, (_, i) => `${cue.replace(/\./g, "_")}_${i + 1}`);
}

/** A take of a summon's cue: every take heard before any repeats, never the same one twice running. */
export function pickRiteCue(cue: RiteCue, memory: Partial<Record<RiteCue, ShuffleBag<string>>>, random: Random): string {
  const state = (memory[cue] ??= { bag: [] });
  return drawFromBag(riteCueClips(cue), state, random);
}

/**
 * The moments of a library spell (web/src/scene/vfx/spells/library.ts) the bank can give a sound of its own: `gather`
 * while it is drawn together (timed to crest as it leaves the hand), `cast` as it leaves the hand, `strike` as its
 * blow lands.
 */
export type SpellMoment = "gather" | "cast" | "strike";
export const SPELL_MOMENTS = ["gather", "cast", "strike"] as const satisfies readonly SpellMoment[];

/**
 * A library spell's own sounds, `spell.<id>.<moment>`, and how many takes the bank has of each. Clips are named
 * `spell_<id>_<moment>_<n>`, the id's hyphens made underscores. Like the summons' they are cut from public-domain
 * (CC0) recordings ("imported" in web/sound-design/gambit/plan.json). Every spell has its cast and its strike. A moment
 * with no takes plays the generic fire for it (spell_charge, spell_cast, spell_impact): Solforiz's two spells gather
 * as fire, which is what their casters' hands hold.
 */
export const SPELL_CUE_TAKES = {
  // Korvenia's Lance: script ticking round like an escapement, a lance of light drawn bright, a star where it lands.
  "spell.lance.gather": 1,
  "spell.lance.cast": 1,
  "spell.lance.strike": 1,
  // Korvenia's Unmaking: the rune written and the long inhale, drawn in, and the void column coming up.
  "spell.unmaking.gather": 1,
  "spell.unmaking.cast": 1,
  "spell.unmaking.strike": 1,
  // Kwind-09's Storm bolt: arcs crackling in the hand, a spark's snap as the front leaves, a thunderclap on the piece.
  "spell.storm-bolt.gather": 1,
  "spell.storm-bolt.cast": 1,
  "spell.storm-bolt.strike": 1,
  // The Snare (Kwind-09 and Korvenia): current in the hand, the cage closing in, the crush.
  "spell.snare.gather": 1,
  "spell.snare.cast": 1,
  "spell.snare.strike": 1,
  // Solforiz's Fire portal: the fire breathed through, and splashing over the piece.
  "spell.fire-portal.cast": 1,
  "spell.fire-portal.strike": 1,
  // Solforiz's Sun pillar: the column falling down its thread of light, and landing.
  "spell.sun-pillar.cast": 1,
  "spell.sun-pillar.strike": 1,
  // Aethelgard's Frost line: cold gathered, rime running along the stone, the great spike breaking through.
  "spell.frost-line.gather": 1,
  "spell.frost-line.cast": 1,
  "spell.frost-line.strike": 1,
  // Aethelgard's Glacial crown: cold gathered, the blades crystallising in jumps, the air inside freezing at once.
  "spell.glacial-crown.gather": 1,
  "spell.glacial-crown.cast": 1,
  "spell.glacial-crown.strike": 1,
} as const;
export type SpellCue = keyof typeof SPELL_CUE_TAKES;
export const SPELL_CUES = Object.keys(SPELL_CUE_TAKES) as SpellCue[];

/** The name a spell's moment is asked for by. */
export function spellCue(spell: string, moment: SpellMoment): string {
  return `spell.${spell}.${moment}`;
}

export function isSpellCue(name: string): name is SpellCue {
  return Object.prototype.hasOwnProperty.call(SPELL_CUE_TAKES, name);
}

export function spellCueClips(cue: SpellCue): string[] {
  return Array.from({ length: SPELL_CUE_TAKES[cue] }, (_, i) => `${cue.replace(/[.-]/g, "_")}_${i + 1}`);
}

/** A take of a spell's cue: every take heard before any repeats, never the same one twice running. */
export function pickSpellCue(cue: SpellCue, memory: Partial<Record<SpellCue, ShuffleBag<string>>>, random: Random): string {
  const state = (memory[cue] ??= { bag: [] });
  return drawFromBag(spellCueClips(cue), state, random);
}

/**
 * The order clips are fetched and decoded in once a match is up: the beds, then the opening whisper and everything a
 * first capture needs (weapon, flesh, gore, fall, whoosh, spell, the duel's cues), then the pleas and deaths, then the other effects,
 * then the lines that cannot be needed early (the fallen, the kings in check and mate), then the closing cues.
 */
export function warmRank(id: string): number {
  if (id.startsWith("bed_")) return 0;
  if (/^(start|hit|flesh|gore|fall|whoosh|spell|cue|rite|trance)_/.test(id)) return 1;
  // A game's opening murmurs come seconds after its bell, and a move's first reaction with the first move.
  if (/_(murmur|moved)_\d+$/.test(id)) return 1;
  // The fallen, the king's lines and the end of a game cannot be needed early.
  if (id.startsWith("ghost_") || /^[a-z]+_k_(check|defeat)_/.test(id) || /_(despair|victory)_\d+$/.test(id)) return 4;
  if (isBarkClip(id)) return 3;
  if (clipKingdom(id)) return 2;
  if (id.startsWith("sting_")) return 5;
  return 3;
}

export const STEP_TAKES = 4;
export function stepClips(timbre: GambitTimbre): string[] {
  return Array.from({ length: STEP_TAKES }, (_, i) => `steps_${timbre}_${i + 1}`);
}

/**
 * What each figure has on its feet, by kingdom: the step that fits what the camera shows. Aethelgard's footsoldier
 * walks in leather shoes under his mail, its knight, rook, queen and king in plate, its bishop in boots under a robe.
 * Solforiz walks on wrapped feet and sandals but for the Furnace Bastion's iron and the sovereign's weight; Korvenia
 * marches in riding and parade boots; Kwind-09 in work boots, its courier and its bulwark armoured.
 */
export const STEP_TIMBRE: Readonly<Record<GambitKingdom, Readonly<Record<GambitRank, GambitTimbre>>>> = {
  ivory: { p: "scuff", n: "plate", b: "leather", r: "plate", q: "regal", k: "regal" },
  sun: { p: "scuff", n: "scuff", b: "scuff", r: "plate", q: "scuff", k: "regal" },
  empire: { p: "leather", n: "leather", b: "leather", r: "leather", q: "leather", k: "regal" },
  kwind: { p: "leather", n: "plate", b: "leather", r: "plate", q: "leather", k: "regal" },
};

/**
 * The pieces' barks: what each voice can say about what happens to it (./gambit-barks.ts decides when), and how many
 * lines it has for each. `moved` is a step it did not choose, `advance` and `retreat` a step that can only be one of
 * those, `danger` a square it can be taken on, `threat` an enemy move that has it in reach, `escape` out of reach again,
 * `killer` what its own hands just did, `avenged` it has just taken the one who killed its comrade, `grave` the square
 * where a comrade just died, `king` a square beside the enemy king, `promote` a footsoldier's last step, `promoted` the
 * same piece in its new voice, `castle` the king's walk behind his rook and the rook's answer, `murmur` a game
 * beginning, `idle` a long silence. A comrade taken beside it is said by who they were to it (WITNESS_KINDS). At the
 * end of a game the beaten army's `despair` and the victors' `victory`.
 */
export type WitnessKind = "companion" | "stranger" | "veteran" | "royal";
/**
 * Who a fallen comrade was to the piece that saw it: `companion` one who fought beside it, `stranger` one it barely
 * knew, `veteran` one the whole army knew, `royal` the Queen, or the King's last guard.
 */
export const WITNESS_KINDS = ["companion", "stranger", "veteran", "royal"] as const satisfies readonly WitnessKind[];
export type BarkEvent = "moved" | "advance" | "retreat" | "danger" | "threat" | "escape" | WitnessKind | "killer" | "avenged" | "grave"
  | "king" | "promote" | "promoted" | "castle" | "murmur" | "idle" | "despair" | "victory";
export const BARK_EVENTS = ["moved", "advance", "retreat", "danger", "threat", "escape", ...WITNESS_KINDS, "killer", "avenged", "grave",
  "king", "promote", "promoted", "castle", "murmur", "idle", "despair", "victory"] as const satisfies readonly BarkEvent[];
const WITNESS_BARKS = { companion: 1, stranger: 1, veteran: 1, royal: 1, avenged: 1 } as const;
const PAWN_BARKS = { moved: 3, danger: 1, threat: 2, escape: 1, ...WITNESS_BARKS, companion: 2, stranger: 2, killer: 2, grave: 1, king: 1,
  promote: 1, murmur: 1, idle: 1, despair: 1, victory: 1 } as const;
const PIECE_BARKS = { moved: 2, danger: 1, threat: 1, escape: 1, ...WITNESS_BARKS, killer: 1, grave: 1, king: 1 } as const;
export const BARK_TAKES: Readonly<Record<VoiceSlot, Readonly<Partial<Record<BarkEvent, number>>>>> = {
  p1: PAWN_BARKS,
  p2: PAWN_BARKS,
  n: PIECE_BARKS,
  b: { ...PIECE_BARKS, retreat: 1 },
  r: { ...PIECE_BARKS, retreat: 1, castle: 2, despair: 1 },
  q: { ...PIECE_BARKS, retreat: 1, promoted: 2, murmur: 1, idle: 1, despair: 1, victory: 1 },
  k: { moved: 1, advance: 1, retreat: 1, escape: 1, killer: 1, avenged: 1, castle: 2, murmur: 1, idle: 1, victory: 1 },
};

/** A voice's lines for one event, `<voice>_<event>_<n>` ("kwind_p1_moved_2"); none when it has nothing to say. */
export function barkClips(voice: string, event: BarkEvent): string[] {
  const slot = voice.slice(voice.indexOf("_") + 1) as VoiceSlot;
  return Array.from({ length: BARK_TAKES[slot]?.[event] ?? 0 }, (_, i) => `${voice}_${event}_${i + 1}`);
}

export function isBarkClip(clip: string): boolean {
  return clipKingdom(clip) !== null && new RegExp(`_(${BARK_EVENTS.join("|")})_\\d+$`).test(clip);
}

/**
 * The unseen hand: a soft pull as it takes hold of a piece, a release as it sets it down (three takes each). Not on
 * the menu's board, and only for a figure the camera can see.
 */
export const TRANCE_TAKES = 3;
export function tranceClips(kind: "pull" | "release"): string[] {
  return Array.from({ length: TRANCE_TAKES }, (_, i) => `trance_${kind}_${i + 1}`);
}

/**
 * What a figure wears, heard once as it sets off: plate, mail, robes, a coat and its fittings, or an industrial rig.
 * Each figure's own (gearOf), three takes each, only for a figure the camera can see.
 */
export type GearKind = "plate" | "mail" | "robes" | "coat" | "rig";
export const GEAR_KINDS = ["plate", "mail", "robes", "coat", "rig"] as const satisfies readonly GearKind[];
export const GEAR_TAKES = 3;
export function gearClips(gear: GearKind): string[] {
  return Array.from({ length: GEAR_TAKES }, (_, i) => `gear_${gear}_${i + 1}`);
}
/**
 * Aethelgard's footsoldier wears mail; its knight, rook, queen and king plate; its bishop a robe. Solforiz wraps every
 * figure in layered cloth but for the Furnace Bastion's armour. Korvenia wears uniform coats, its cuirassier a
 * cuirass and its queen a gown. Kwind-09's troopers and bulwark carry industrial rigs, its courier armour, its
 * officers long coats.
 */
export const GEAR: Readonly<Record<GambitKingdom, Readonly<Record<GambitRank, GearKind>>>> = {
  ivory: { p: "mail", n: "plate", b: "robes", r: "plate", q: "plate", k: "plate" },
  sun: { p: "robes", n: "robes", b: "robes", r: "plate", q: "robes", k: "robes" },
  empire: { p: "coat", n: "plate", b: "coat", r: "coat", q: "robes", k: "coat" },
  kwind: { p: "rig", n: "plate", b: "coat", r: "rig", q: "coat", k: "coat" },
};
export function gearOf(kingdom: GambitKingdom, rank: GambitRank): GearKind {
  return GEAR[kingdom][rank];
}

/**
 * For the end of a game: every line a kingdom's army has for its `despair` (beaten) or its `victory`, voice by voice.
 * The downfall's staging picks from these (or asks the mixer, armyLine).
 */
export function downfallClips(kingdom: GambitKingdom, event: "despair" | "victory"): string[] {
  return VOICE_SLOTS.flatMap((slot) => barkClips(`${kingdom}_${slot}`, event));
}

/** Weapons falling on stone as a beaten army lets go: a sword or sabre, a spear or staff, a musket, a shield. */
export type DropKind = "blade" | "pole" | "musket" | "shield";
export const DROP_KINDS = ["blade", "pole", "musket", "shield"] as const satisfies readonly DropKind[];
export const DROP_TAKES = 3;
export function dropClips(kind: DropKind): string[] {
  return Array.from({ length: DROP_TAKES }, (_, i) => `drop_${kind}_${i + 1}`);
}
/** An armoured knee coming down on stone. */
export function kneelClips(): string[] {
  return Array.from({ length: 3 }, (_, i) => `kneel_armour_${i + 1}`);
}
/**
 * What each figure would let fall, by what it carries (web/src/scene/weapons.ts LOADOUT): a suggestion for the
 * downfall's staging, which knows what is in each hand. Kwind-09's courier fights empty-handed: nothing falls.
 */
export const DROP_OF: Readonly<Record<GambitKingdom, Readonly<Record<GambitRank, DropKind | null>>>> = {
  ivory: { p: "pole", n: "blade", b: "pole", r: "pole", q: "pole", k: "blade" },
  sun: { p: "pole", n: "blade", b: "pole", r: "shield", q: "pole", k: "blade" },
  empire: { p: "musket", n: "blade", b: "musket", r: "pole", q: "musket", k: "musket" },
  kwind: { p: "pole", n: null, b: "pole", r: "pole", q: "pole", k: "pole" },
};

/** Every clip these rules can ask for, so a test can hold the asset set to them. */
export function allRequestedClips(): string[] {
  const out = new Set<string>([...WHISPERS, ...START_WHISPERS]);
  for (const kingdom of KINGDOMS) {
    for (const rank of ["p", "n", "b", "r", "q", "k"] as const) {
      for (const voice of voicesFor(kingdom, rank)) {
        out.add(deathClip(voice));
        if (rank !== "k") pleaClips(voice).forEach((clip) => out.add(clip));
        for (const event of BARK_EVENTS) barkClips(voice, event).forEach((clip) => out.add(clip));
      }
    }
    checkClips(kingdom).forEach((clip) => out.add(clip));
    mateClips(kingdom).forEach((clip) => out.add(clip));
  }
  for (const rank of ["p", "n", "b", "r", "q", "k"] as const) out.add(strikeClip(rank));
  for (const timbre of ["scuff", "leather", "plate", "regal"] as const) stepClips(timbre).forEach((clip) => out.add(clip));
  for (const family of FLESH_FAMILIES) fleshClips(family).forEach((clip) => out.add(clip));
  goreClips().forEach((clip) => out.add(clip));
  for (const cue of COMBAT_CUES) combatCueClips(cue).forEach((clip) => out.add(clip));
  for (const cue of RITE_CUES) riteCueClips(cue).forEach((clip) => out.add(clip));
  for (const cue of SPELL_CUES) spellCueClips(cue).forEach((clip) => out.add(clip));
  for (const kind of ["pull", "release"] as const) tranceClips(kind).forEach((clip) => out.add(clip));
  for (const gear of GEAR_KINDS) gearClips(gear).forEach((clip) => out.add(clip));
  for (const kind of DROP_KINDS) dropClips(kind).forEach((clip) => out.add(clip));
  kneelClips().forEach((clip) => out.add(clip));
  for (const clip of ["bed_hall", "bed_dirge", "bed_heart", "bed_souls", "start_toll", "check_toll", "mate_toll", "sentence_bell",
    "whoosh_light", "whoosh_heavy", "slam", "spell_charge", "spell_cast", "spell_impact", "fall_light", "fall_heavy",
    "soul_release", "settle_a", "settle_b", "breath", "promote", "deny", "sting_win", "sting_loss", "sting_draw"]) out.add(clip);
  return [...out].sort();
}

export type Random = () => number;

/** One of `options`, never the one heard last time if there is another. */
export function chooseFresh<T>(options: readonly T[], last: T | undefined, random: Random): T {
  const pool = options.length > 1 ? options.filter((option) => option !== last) : options;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * Not every piece wakes: the first to die in a game always does, and after that the higher the rank the likelier it
 * is to come to itself in time. A fast exhibition wakes them half as often so the beats do not pile up.
 */
export function pleaChance(rank: GambitRank, context: { first: boolean; speed?: number }): number {
  if (rank === "k") return 0;
  if (context.first) return 1;
  const base = ({ p: 0.55, n: 0.8, b: 0.8, r: 0.85, q: 1, k: 0 } as const)[rank];
  return (context.speed ?? 1) > 1.5 ? base * 0.5 : base;
}

/** What the mixer remembers between pleas so the same words are not heard twice running. */
export interface PleaMemory {
  lastClip: Partial<Record<string, string>>;
  lastPawnVoice: Partial<Record<GambitKingdom, string>>;
}

export function emptyPleaMemory(): PleaMemory {
  return { lastClip: {}, lastPawnVoice: {} };
}

/**
 * The voice and the words for a piece that wakes. A pawn speaks in its own voice when the scene names it (the one it
 * keeps all game, pawnSlot); otherwise the two pawn voices alternate.
 */
export function pickPlea(kingdom: GambitKingdom, rank: GambitRank, memory: PleaMemory, random: Random, voice?: string): { voice: string; clip: string } | null {
  if (rank === "k") return null;
  const voices = voicesFor(kingdom, rank);
  const chosen = voice && voices.includes(voice) ? voice : rank === "p" ? chooseFresh(voices, memory.lastPawnVoice[kingdom], random) : voices[0];
  const clip = chooseFresh(pleaClips(chosen), memory.lastClip[chosen], random);
  memory.lastClip[chosen] = clip;
  if (rank === "p") memory.lastPawnVoice[kingdom] = chosen;
  return { voice: chosen, clip };
}

/** A piece with no plea still dies in its own voice. */
export function deathVoice(kingdom: GambitKingdom, rank: GambitRank, random: Random): string {
  return chooseFresh(voicesFor(kingdom, rank), undefined, random);
}

/** The longest the blow will wait for a plea's last word beyond the moment it would have landed anyway. */
export const PLEA_GRACE_SECONDS = 1.1;

/**
 * How much longer the killer stands over the victim so its words land: the time left until the plea's last word,
 * less what the strike's own wind-up already gives, never more than the grace.
 */
export function pleaWait(secondsToLastWord: number, windupSeconds: number, grace = PLEA_GRACE_SECONDS): number {
  return Math.max(0, Math.min(grace, secondsToLastWord - windupSeconds));
}

/** The fallen grow louder as the board empties: silent before the first death, full at fourteen. */
export function soulsLevel(fallen: number): number {
  if (fallen <= 0) return 0;
  return Math.min(1, Math.pow(fallen / 14, 0.8));
}

/** Seconds until the next far-off whisper. None before the first death; closer together as more have died. */
export function whisperDelay(fallen: number, random: Random): number | null {
  if (fallen <= 0) return null;
  const base = Math.max(14, 40 - fallen * 2);
  return base * (0.7 + random() * 0.6);
}

/** The king in check speaks under his breath about half the time, and never on two checks running. */
export function checkLineChance(checksInARow: number): number {
  return checksInARow > 1 ? 0 : 0.5;
}

export interface GambitEnding {
  /** The funeral bell for a checkmate. */
  toll: "mate_toll" | null;
  /** The army whose king says his defeat (checkmate only): he yields, he is never slain. */
  lastWords: GambitSide | null;
  /** The cue that closes the game. */
  sting: "sting_win" | "sting_loss" | "sting_draw";
}

/**
 * How a game ends in sound. `listener` is the side the player plays in a game against the computer; in a duel or an
 * exhibition nobody at the screen lost, so a decisive result plays the victory cue.
 */
export function gambitEnding(result: { winner: GambitSide | null; reason: string }, listener: GambitSide | null): GambitEnding {
  if (!result.winner) return { toll: null, lastWords: null, sting: "sting_draw" };
  const loser: GambitSide = result.winner === "w" ? "b" : "w";
  const mate = result.reason === "checkmate";
  return {
    toll: mate ? "mate_toll" : null,
    lastWords: mate ? loser : null,
    sting: listener && listener !== result.winner ? "sting_loss" : "sting_win",
  };
}
