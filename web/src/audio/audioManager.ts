import type { Faction, PieceKind } from "../core/types";
import { GAMBIT_CLIPS, type GambitClip, type GambitClipId } from "./gambit-assets";
import {
  checkClips, checkLineChance, chooseFresh, clipKingdom, combatCueFamily, deathClip, deathVoice, drawFromBag, dropClips, emptyPleaMemory,
  fleshFamily, gambitEnding, gearClips, isBarkClip, kneelClips, isCombatCue, isRiteCue, isSpellCue, mateClips, pickCombatCue, pickFlesh, pickPlea, pickRiteCue,
  pickSpellCue, pleaChance, soulsLevel, START_WHISPERS, stepClips, strikeClip, tranceClips, whisperDelay, WHISPERS, warmRank, DEFAULT_KINGDOMS,
  type CombatCueFamily, type CombatCueMemory, type DropKind, type FleshFamily, type FleshMemory, type GambitKingdom, type GearKind, type PleaMemory,
  type RiteCue, type ShuffleBag, type SpellCue,
} from "../../../shared/play/gambit-sound";
import { barkMaySound, BARK_GAP } from "../../../shared/play/gambit-barks";
import { GUN_AUDIO_URLS, type GunVoice } from "../assets/generated";
import { ScorePlayer } from "./scorePlayer";
import type { ScoreBoard, ScoreSting } from "../../../shared/play/match-score";
import { OPENING_CLIPS } from "./opening-assets";
import {
  OPENING_MATCH_CLIPS, OPENING_REVEAL_CLIPS, openingSoundSheet, revealSound,
  type OpeningBeatSound, type OpeningClipId, type OpeningCue, type RevealCueName,
} from "./opening-cues";

type SfxName = "place" | "capture" | "check" | "fanfare";
type BedName = "ambience" | "score" | "tension";
export type AudioScene =
  | "menu"
  | "prologue"
  | "hub"
  | "briefing"
  | "formation"
  | "gambit"
  | "battle"
  | "consequence-win"
  | "consequence-loss"
  | "promotion"
  | "finale";

/** How a figure's dying voice is placed in the mix. */
export interface DeathCryOptions {
  /** -1 hard left … 1 hard right — where the body is on screen. */
  pan?: number;
  /** Relative loudness (heavier figures die louder). */
  volume?: number;
  /** Playback-rate jitter so the same figure never dies twice identically. */
  rate?: number;
  /** Seconds to wait before the voice starts, so the blow lands first. */
  delay?: number;
  /** The voice that woke and pleaded, so the same person dies. */
  voice?: string;
}

/**
 * The material voice of one footfall. Drives the noise band, the body mode and
 * the ring, so the ear can tell a barefoot footsoldier from a plated guardian.
 */
export type FootstepTimbre = "scuff" | "leather" | "plate" | "regal";

/** One foot meeting the stone. */
export interface FootstepOptions {
  /** -1 hard left … 1 hard right — where the figure is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** How the boot is built — see {@link FootstepTimbre}. */
  timbre?: FootstepTimbre;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** Slight per-step detune so a march never turns into a metronome. */
  jitter?: number;
}

/** Placement of one spell sound in the mix. */
export interface SpellOptions {
  /** -1 hard left … 1 hard right — where the caster or the blast is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** How long the charge takes to reach full power (charge only). */
  duration?: number;
}

/** Placement of one melee-strike sound in the mix. */
export interface StrikeSoundOptions {
  /** -1 hard left … 1 hard right — where the blow is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** 0 = a light blade cutting air, 1 = a siege hammer being hauled round. */
  weight?: number;
  /** strike() only: false keeps the blow to steel alone, with no flesh under it (the menu's background game). */
  flesh?: boolean;
}

/** A wooden piece being lifted from or set down on the board. */
/** Placement of one gunshot in the mix, on top of the melee placement. */
export interface GunSoundOptions extends StrikeSoundOptions {
  /**
   * Which recorded barrel to fire. Omitted, the shot is the synthesised voice
   * alone — which is what every non-gunpowder army has always used.
   */
  voice?: GunVoice;
}

/** How the square-taken signature is placed in the mix. */
export interface ConquestOptions {
  /** -1 hard left … 1 hard right — where the taken square is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /**
   * What was taken: 0 a footsoldier, 1 the crown. Drops the motif's root,
   * lengthens its tail and adds a third note, so the ear knows how big the
   * capture was without looking at the tray.
   */
  weight?: number;
}

export interface WoodTapOptions {
  /** -1 hard left … 1 hard right — where the square is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** 0 = light footsoldier tick, 1 = heavy king set-down (lower, longer ring). */
  weight?: number;
  /** Softer, brighter tick used when a figure is picked up rather than placed. */
  lift?: boolean;
  /** Seconds to wait before it sounds. */
  delay?: number;
}

/** The player's sound settings, as the menus hold them (0–100). */
export interface MixPreferences {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
  music: boolean;
  soundEffects: boolean;
}

/** A piece that has woken under its killer and is begging. */
export interface PleaHandle {
  /** The voice speaking, so its death is the same person. */
  readonly voice: string;
  readonly clip: string;
  /** Seconds from now until its last word has been said (0 once said). */
  secondsToLastWord(): number;
  /** The blow lands: the words stop at once. */
  cut(): void;
}

/** What wakes a piece: the first death of a game always does. */
export interface PleaContext {
  pan?: number;
  first?: boolean;
  /** Exhibition playback speed; fast exhibitions wake half as often. */
  speed?: number;
  /** The voice the piece has had all game ("ivory_p2"), so a footsoldier pleads in the voice it barked in. */
  voice?: string;
}

/**
 * One decoded gunfire take, with the two things about it that cannot be trusted
 * to be authored correctly: where the shot actually begins, and how loud the
 * recording happens to be.
 */
interface ShotTake {
  buffer: AudioBuffer;
  /**
   * Seconds of lead-in before the report itself. Playback starts here, so the
   * transient lands on the frame the caller asked for rather than however long
   * after it the recording happened to open.
   */
  onset: number;
  /** Peak sample of the take, used to level every barrel to the same headroom. */
  peak: number;
}

/**
 * Peak every recorded take is normalised to. Generated clips come back anywhere
 * between 0.18 and 1.55 full-scale — a 9x spread. Left alone, the authored
 * per-barrel mix means nothing, because the recording level swamps it.
 */
const TAKE_PEAK = 0.92;
/** Bounds on that correction, so a hissy take is never boosted into noise. */
const TAKE_GAIN_RANGE: readonly [number, number] = [0.3, 3.4];

/**
 * How each recorded barrel sits against the synthesised voice underneath it.
 *
 * The two are not interchangeable. A take with a hard, close transient (the
 * Charleville) carries the whole report on its own and only wants the synth for
 * the sub-bass; a diffuse take (the flintlock, whose recording is mostly hall)
 * needs the synthesised crack left much further up or the shot has no edge on
 * the frame it happens. Authored per barrel, because “how good is this
 * recording” is not something `calibre` can express.
 */
const SHOT_VOICES: Record<GunVoice, { take: number; synth: number }> = {
  /** Quietest kill on the board by design — the recording is mostly room. */
  pistol: { take: 0.74, synth: 0.6 },
  /** The hardest transient of the four: it needs almost nothing under it. */
  musket: { take: 1, synth: 0.34 },
  /** A thin whip-crack; the synth supplies the body it does not have. */
  rifle: { take: 0.88, synth: 0.5 },
  /** Carries its own hall, but none of the sub-bass a field gun owes the room. */
  cannon: { take: 0.96, synth: 0.52 },
};

/**
 * Root of the claim motif, in Hz — G3, the same fundamental the judgement bell
 * is struck on. Sharing one root is what makes the two read as the same hall
 * speaking rather than as two unrelated sound effects.
 */
const CLAIM_ROOT = 196;

interface FootstepVoice {
  /** Overall loudness of this boot. */
  level: number;
  /** Low body mode — the weight going into the floor, in Hz. */
  body: number;
  /** Peak of the body thump. */
  weight: number;
  /** How long the thump takes to die away. */
  decay: number;
  /** Centre of the noise band — grit, cloth or steel. */
  noise: number;
  /** Sharpness of that band. */
  q: number;
  /** Level of the noise transient. */
  hiss: number;
  /** Length of the scuff in seconds. */
  scuff: number;
  /** Envelope exponent — higher is a shorter, snappier scrape. */
  grit: number;
  /** Level of the metallic afterring (0 for unarmoured feet). */
  ring: number;
  /** Pitch of that ring, in Hz. */
  ringHz: number;
}

/**
 * The four boots that walk this board, as a synthesised fallback for the first
 * moments before the recorded footfalls have arrived.
 */
const FOOTSTEP_VOICES: Record<FootstepTimbre, FootstepVoice> = {
  scuff: { level: 0.82, body: 108, weight: 0.2, decay: 0.09, noise: 1650, q: 0.8, hiss: 0.5, scuff: 0.055, grit: 3.2, ring: 0, ringHz: 0 },
  leather: { level: 0.9, body: 96, weight: 0.24, decay: 0.11, noise: 1180, q: 0.7, hiss: 0.42, scuff: 0.075, grit: 2.4, ring: 0.03, ringHz: 2350 },
  plate: { level: 1.12, body: 72, weight: 0.34, decay: 0.17, noise: 820, q: 0.55, hiss: 0.34, scuff: 0.09, grit: 2, ring: 0.09, ringHz: 3120 },
  regal: { level: 1.05, body: 62, weight: 0.32, decay: 0.2, noise: 940, q: 0.6, hiss: 0.3, scuff: 0.1, grit: 2.2, ring: 0.055, ringHz: 2680 },
};

/**
 * The beds under each scene, as gains on the music bus. Balanced for the menus'
 * default settings (Master 65, Music 35, Effects 70): the dirge sits about ten
 * decibels under a pleading voice, the hall a few more under that.
 */
const SCENE_BEDS: Record<AudioScene, Record<BedName, number>> = {
  menu: { ambience: 0.9, score: 0.8, tension: 0 },
  prologue: { ambience: 0.5, score: 0.9, tension: 0.1 },
  hub: { ambience: 0.8, score: 0.6, tension: 0 },
  briefing: { ambience: 0.8, score: 0.6, tension: 0 },
  formation: { ambience: 0.6, score: 0.5, tension: 0 },
  gambit: { ambience: 0.4, score: 0.5, tension: 0.5 },
  // A match's music is the adaptive score (scorePlayer.ts); the dirge stays the bed of the web app's other scenes.
  battle: { ambience: 1.2, score: 0, tension: 0.25 },
  "consequence-win": { ambience: 0.4, score: 1.1, tension: 0 },
  "consequence-loss": { ambience: 0.4, score: 0.4, tension: 0.4 },
  promotion: { ambience: 0.3, score: 0.6, tension: 0.3 },
  finale: { ambience: 0.3, score: 0.8, tension: 0.5 },
};
const BED_CLIPS: Record<BedName, GambitClipId> = { ambience: "bed_hall", score: "bed_dirge", tension: "bed_heart" };
/** The fallen, at full strength (fourteen dead or more). */
const SOULS_GAIN = 1.7;
/** The closing cues ride the music bus, which the default Music setting keeps low. */
const STING_GAIN = 2;
/** Seconds from an end other than checkmate (resignation, time, a draw) to the score's closing cue. */
const SCORE_END_LEAD = 0.25;

/**
 * Gains on the effects bus, by family, balanced so every effect sits under the
 * voices: the creator's rule for this game's sound is few effects, never loud.
 */
const GAIN = {
  plea: 1,
  death: 0.85,
  check: 0.95,
  mate: 1.05,
  whisper: 0.5,
  start: 0.6,
  strike: 0.6,
  /**
   * The wound under the weapon. The flesh clips are levelled 2 dB under the impacts (-19 against -17 LUFS), so this
   * puts the wound about level with the steel it is layered with and still under the voices.
   */
  flesh: 0.7,
  /** A summon's own sounds: a great beast over the board, under the voices as every effect is. */
  rite: 0.75,
  /** What reaches the stone when the body lands (levelled at -22 LUFS): an aftermath, heard after the cry, never over it. */
  gore: 0.45,
  whoosh: 0.7,
  slam: 0.6,
  toll: 0.8,
  spell: 0.7,
  fall: 0.7,
  soul: 1,
  settle: 0.6,
  step: 0.55,
  breath: 0.7,
  promote: 0.8,
  deny: 0.8,
  /**
   * A piece's reaction to what happens to it (levelled at -19 LUFS, the murmurs and the long silence at -21): 4 dB
   * under a plea, as close and in the same hall, over every effect.
   */
  bark: 0.9,
  /** The unseen hand taking hold of a piece and letting it go (levelled at -28 LUFS): felt more than heard. */
  trance: 0.55,
  /** A figure's armour or cloth as it sets off (levelled at -28 LUFS): under its own footfalls. */
  gear: 0.5,
  /** A weapon or an armoured knee meeting the stone at the end of a game (levelled at -24 LUFS), under the king's words. */
  drop: 0.6,
};

/**
 * The duel's cues, by family, on top of each cue's own level (CUE_SPECS in scene/combat/audio.ts, already in the volume
 * the director passes). The exchange sits under the killing strike: on an offline render against the dagger, the
 * lightest strike, a shield clash is 5 dB under the blow, an exhale 7 and a boot scrape 10. The whoosh and the fall
 * keep the levels of the stand-ins they replace.
 */
const CUE_GAIN: Record<CombatCueFamily, number> = { clash: 0.5, effort: 0.9, foley: 0.8, whoosh: GAIN.whoosh, fall: GAIN.fall };

/**
 * The wounds ring in a hall of their own: longer, darker and later than the voices' hall, and fed by nothing else,
 * so the cut hangs in the cold after the weapon has gone quiet without washing a single word. The weapon impact
 * itself stays dry.
 */
/** How far a summon's sounds go into the voices' hall: a beast's cry fills the room, its wings stay near. */
const RITE_SEND = 0.35;
/** A library spell's blow goes as far into the voices' hall as the generic burst does; its gathering and its cast stay dry. */
const SPELL_SEND = 0.15;
const FLESH_SEND = 1;
const BLAST_SEND = 0.9;
const GORE_SEND = 0.6;
/**
 * The wound yields to the death cry: full level for the cut itself, easing to `to` of it by `by` seconds, as the cry
 * (0.15 to 0.22 s after the blow) rises. On an offline render of six captures this keeps every death cry at least
 * 4 dB over the effects, the sorceress's included, without making the cut any quieter. The gore lands after the cry
 * and keeps its level.
 */
const FLESH_YIELD = { hold: 0.15, by: 0.4, to: 0.4 };
const WOUND_HALL = {
  /** Length of the tail, in seconds (the voices' hall is 3.2). */
  seconds: 3.8,
  /** The ring arrives this long after the cut, so the cut itself stays dry and close. */
  predelay: 0.045,
  /** The one-pole low-pass on the tail: it opens this far at the start and closes to this by the end. */
  open: 0.2,
  close: 0.04,
  /** How much unfiltered air is left in the tail (the voices' hall keeps 0.4). */
  air: 0.04,
  /**
   * Return level (the voices' hall returns at 0.55). Measured on an offline render of six captures: with the sends
   * above, the flesh's ring sits 10 to 16 dB (median 12) under everything else in the 0.3 to 1.0 s after the blow.
   */
  wet: 0.8,
};

/**
 * The safety limiter at the end of the mix: nothing clips, even at Master 100 and Effects 100 with a sorceress's
 * kill on screen. A DynamicsCompressorNode adds make-up gain of its own (the gain that would bring a full-scale
 * signal back to full scale, to the power 0.6); LIMITER_TRIM takes exactly that off again, so the mix below the
 * threshold is untouched.
 */
const LIMITER = { threshold: -2, knee: 1, ratio: 20, attack: 0.001, release: 0.12 };
/** Measured in Chrome with the settings above: 0.975 dB of make-up gain, so the trim is 10^(-0.975 / 20). */
const LIMITER_TRIM = 0.8938;

/** One plea at a time; at most two dying voices over it. */
const MAX_DYING = 2;
/** Ramp-out when a plea is cut by the blow — fast enough to read as cut off, slow enough not to click. */
const CUT_SECONDS = 0.06;
/** Ramp-out when a bark gives way to another voice, or Undo or a new game silences it: a short fade, never a click. */
const BARK_FADE = 0.08;
/**
 * A soul leaving a body while a piece speaks is drawn back this far (-4.4 dB): on an offline render of the scripted game
 * its airy shimmer otherwise sat within 2 dB (K-weighted) of a witness's words.
 */
const SOUL_UNDER_WORDS = 0.6;
/** The selection gasp is rare: at most one in this many seconds, and only some of the time. */
const BREATH_GAP_SECONDS = 4;
const BREATH_CHANCE = 0.4;
/**
 * How long a prepared opening holds the bell that opens the game. The game asks for it at once (game.start, then a
 * microtask), so a hold older than this belongs to an opening that never asked, and the bell rings as it always has.
 */
const OPENING_BELL_WAIT_MS = 2000;
/** How late an opening or reveal cue may still start from its beginning: a few frames. */
const OPENING_LATE_SECONDS = 0.06;

interface Bed {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  target: number;
}

interface ShotOptions {
  bus?: "sfx" | "voice" | "music";
  gain?: number;
  pan?: number;
  delay?: number;
  rate?: number;
  /** Level sent to the stone-hall reverb. */
  send?: number;
  /** Which hall the send goes to: the voices' (default) or the wounds' own long, dark one. */
  hall?: "wound";
  /** Seconds into the clip to start. */
  offset?: number;
  /** Duck the music under this sound. */
  duck?: number;
  /** The side a piece's voice speaks for, so its subtitle names the right army. */
  side?: Faction;
}

interface Shot {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  rate: number;
  /** Token of the subtitled line this clip speaks, if it has words. */
  line?: number;
}

/** One clip of the match's opening or of the kingdoms' reveal, started or waiting to start at `startsAt`. */
interface OpeningVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startsAt: number;
}

/**
 * For subtitles: a spoken line has started (or will, after `delay`), a blow has cut one off, or every voice has
 * been silenced. Death cries, breaths and effects have no words and send nothing.
 */
export type VoiceLineEvent =
  | { type: "line"; token: number; clip: string; text: string; delay: number; duration: number; side?: Faction }
  | { type: "cut"; token: number }
  | { type: "clear" };

/**
 * The match mixer. Three looping beds — the hall, the dirge, the heartbeat that
 * rises in check — and a fourth for the fallen, which grows as pieces die. Over
 * them the board's voices: pieces that wake and plead as their killers come,
 * die in the same voice, and whisper in the hall afterwards. Every clip is
 * bundled (web/src/assets/audio/gambit, made from web/sound-design/gambit); the
 * old synthesised sounds remain as fallbacks for the first moments before the
 * clips have arrived. Master, Music and Effects follow the menus' settings.
 */
/** How long the mixer may sit muted (no match on screen) before it lets its decoded clips go (M-11). */
export const IDLE_RELEASE_MS = 3 * 60_000;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Ducked under voices; feeds the music bus. */
  private bedBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  /** The wounds' own hall: fed only by the flesh, the blast and the gore. */
  private woundHall: ConvolverNode | null = null;
  private souls: Bed | null = null;
  private buffers = new Map<GambitClipId, AudioBuffer>();
  private loads = new Map<GambitClipId, Promise<AudioBuffer | null>>();
  private loopPoints = new WeakMap<AudioBuffer, [number, number]>();
  private beds = new Map<BedName, Bed>();
  private muted = false;
  /** Pending suspension of the context once the match's sound has faded out (M-11). */
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending release of the decoded clips, a while after the last match closed (M-11). */
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resumes of the context under way that this mixer asked for (see `silent`). */
  private resuming = 0;
  private started = false;
  private loading: Promise<void> | null = null;
  private scene: AudioScene = "menu";
  private preferences: MixPreferences = { volume: 100, musicVolume: 100, sfxVolume: 100, music: true, soundEffects: true };
  private memory: PleaMemory = emptyPleaMemory();
  /** The wounds' shuffle bags, kept across games: every take is heard before any repeats. */
  private fleshMemory: FleshMemory = {};
  /** The duels' shuffle bags, one per cue, kept across fights. */
  private cueMemory: CombatCueMemory = {};
  /** The summons' shuffle bags, one per cue. */
  private riteMemory: Partial<Record<RiteCue, ShuffleBag<string>>> = {};
  /** The library spells' shuffle bags, one per cue. */
  private spellMemory: Partial<Record<SpellCue, ShuffleBag<string>>> = {};
  private plea: (Shot & { lastWordAt: number }) | null = null;
  private dying = 0;
  private fallen = 0;
  private whisperTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWhisper: string | undefined;
  private lastStep: Partial<Record<FootstepTimbre, string>> = {};
  private lastCheckLine: Partial<Record<Faction, string>> = {};
  private lastBreath = -Infinity;
  private ended = false;
  private lineListeners = new Set<(event: VoiceLineEvent) => void>();
  private lineToken = 0;
  /** The kingdom each side fields: its pieces speak in that kingdom's voices. */
  private kingdoms: Record<Faction, GambitKingdom> = { ...DEFAULT_KINGDOMS };
  /** Every voice line but the barks, scheduled or sounding (audio clock): a bark keeps clear of them all. */
  private floor: { from: number; to: number }[] = [];
  /** The bark sounding now, if any, and when the last one ends. */
  private liveBark: (Shot & { endsAt: number }) | null = null;
  private barkUntil = -Infinity;
  /** The soul leaving a body, while it sounds: a piece's words lower it (SOUL_UNDER_WORDS). */
  private liveSoul: { gain: GainNode; endsAt: number } | null = null;
  /** The hand's and the figures' gear's shuffle bags. */
  private handMemory: Partial<Record<string, ShuffleBag<string>>> = {};
  /** Decoded gunfire takes by URL, with their measured onset and peak (Korvenia's powder army). */
  private shots = new Map<string, ShotTake>();
  private shotLoads = new Map<string, Promise<void>>();
  /** The end of the chain, which the reveal's own bus feeds as well. */
  private limiter: DynamicsCompressorNode | null = null;
  /** The match's opening and the kingdoms' reveal: see that section below. */
  private openingBuffers = new Map<OpeningClipId, AudioBuffer>();
  private openingLoads = new Map<OpeningClipId, Promise<AudioBuffer | null>>();
  private openingSheet: OpeningBeatSound[] | null = null;
  private openingVoices = new Set<OpeningVoice>();
  /** Counts openings and reveals begun and ended, so a clip that arrives after its moment has passed stays silent. */
  private openingEra = 0;
  private presentBus: GainNode | null = null;
  /** The bell that opens a game, held for the opening's first picture: "waiting" for the game to ask for it, then the
   * ringing itself, or null when nothing is held. */
  private heldBell: "waiting" | (() => void) | null = null;
  private heldSince = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Calls `listener` for every spoken line as the mixer plays it (see VoiceLineEvent); returns the unsubscribe. */
  onVoiceLine(listener: (event: VoiceLineEvent) => void): () => void {
    this.lineListeners.add(listener);
    return () => { this.lineListeners.delete(listener); };
  }

  private emitLine(event: VoiceLineEvent): void {
    for (const listener of this.lineListeners) listener(event);
  }

  /** How many pieces have died this game, as the mixer counts them. */
  get fallenCount(): number {
    return this.fallen;
  }

  /** Must be called from a user gesture (browser autoplay policy), or after the page has had one. */
  async unlock(): Promise<void> {
    const ctx = this.graph();
    if (!ctx) return;
    if (ctx.state === "suspended") await this.resume(ctx);
    // The score's opening cue is asked for first, so its decode never queues behind the match's own clips.
    this.score.preload();
    // A bed that failed to load once is asked for again on the next press (M-18); load() keeps only successes.
    if (!this.loading || !this.buffers.has("bed_hall") || !this.buffers.has("bed_dirge")) {
      this.loading = Promise.all([this.load("bed_hall"), this.load("bed_dirge")]).then(() => undefined);
    }
    await this.loading;
    this.startBeds();
    // The heartbeat, the fallen and every voice and effect come down behind the two audible beds.
    void this.warmAll();
  }

  /**
   * The mixer's graph, made the first time anything needs it: the buses, the two halls and the limiter. Only
   * unlock() starts the beds on it; the kingdoms' reveal wakes the graph without them.
   */
  private graph(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.bedBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.bedBus.connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.voiceBus.connect(this.sfxBus);
    this.sfxBus.connect(this.master);
    // The end of the chain: a brickwall, then the trim that undoes the compressor's own make-up gain.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    const trim = ctx.createGain();
    trim.gain.value = LIMITER_TRIM;
    this.master.connect(limiter);
    limiter.connect(trim);
    trim.connect(ctx.destination);
    this.limiter = limiter;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.hallImpulse(3.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);
    wet.connect(this.sfxBus);
    this.woundHall = ctx.createConvolver();
    this.woundHall.buffer = this.hallImpulse(WOUND_HALL.seconds, WOUND_HALL);
    const woundWet = ctx.createGain();
    woundWet.gain.value = WOUND_HALL.wet;
    this.woundHall.connect(woundWet);
    woundWet.connect(this.sfxBus);
    this.applyPreferences(0);
    return ctx;
  }

  /** Follow the menus' Master, Music and Effects settings. */
  configure(preferences: Partial<MixPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    this.applyPreferences(0.15);
  }

  private applyPreferences(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const p = this.preferences;
    const clamp = (value: number) => Math.max(0, Math.min(1, value / 100));
    const ramp = (param: AudioParam, value: number) => {
      const now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      if (seconds > 0) param.linearRampToValueAtTime(value, now + seconds);
      else param.setValueAtTime(value, now);
    };
    ramp(this.master.gain, this.muted ? 0 : clamp(p.volume));
    ramp(this.musicBus.gain, p.music ? clamp(p.musicVolume) : 0);
    // A replay held by its transport gates the board's sound (effects and voices); the score draws back on its own.
    ramp(this.sfxBus.gain, p.soundEffects && !this.boardHeld ? clamp(p.sfxVolume) : 0);
    // The reveal's bus is an effect under Master, past the match's own mute (see presentation()).
    if (this.presentBus) ramp(this.presentBus.gain, this.presentLevel());
  }

  // ------------------------------------------------------------- loading

  private load(id: GambitClipId): Promise<AudioBuffer | null> {
    const cached = this.loads.get(id);
    if (cached) return cached;
    const job = (async () => {
      try {
        const response = await fetch(GAMBIT_CLIPS[id].url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          this.loads.delete(id);
          return null;
        }
        const buffer = await ctx.decodeAudioData(raw);
        this.buffers.set(id, buffer);
        // A bed that arrives after the beds started (a retry after a failed load) joins its loop now (M-18).
        for (const name of Object.keys(BED_CLIPS) as BedName[]) if (BED_CLIPS[name] === id) this.attachLateBed(name);
        return buffer;
      } catch (error) {
        console.warn(`[audio] could not load "${id}"`, error);
        this.loads.delete(id);
        return null;
      }
    })();
    this.loads.set(id, job);
    return job;
  }

  /** Everything else, a few at a time: the beds first, then the voices, then the effects. */
  private async warmAll(): Promise<void> {
    const ids = Object.keys(GAMBIT_CLIPS) as GambitClipId[];
    // A kingdom's voices only come down when one side fields it.
    const wanted = (id: string) => { const kingdom = clipKingdom(id); return !kingdom || kingdom === this.kingdoms.w || kingdom === this.kingdoms.b; };
    const queue = ids.filter((id) => !this.loads.has(id) && wanted(id)).sort((a, b) => warmRank(a) - warmRank(b));
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (!this.ctx) return;
        await this.load(id);
        if (id === "bed_souls") this.attachSouls();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  /** Where a looped clip really starts and ends, past any silence the decoder put round it. */
  private loopOf(buffer: AudioBuffer): [number, number] {
    const known = this.loopPoints.get(buffer);
    if (known) return known;
    let first = buffer.length;
    let last = 0;
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      let i = 0;
      while (i < data.length && Math.abs(data[i]) < 1e-5) i += 1;
      let j = data.length - 1;
      while (j > i && Math.abs(data[j]) < 1e-5) j -= 1;
      first = Math.min(first, i);
      last = Math.max(last, j);
    }
    const points: [number, number] = last > first ? [first / buffer.sampleRate, (last + 1) / buffer.sampleRate] : [0, buffer.duration];
    this.loopPoints.set(buffer, points);
    return points;
  }

  private loopSource(buffer: AudioBuffer, into: AudioNode): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const [start, end] = this.loopOf(buffer);
    source.loopStart = start;
    source.loopEnd = end;
    source.connect(into);
    source.start(0, start);
    return source;
  }

  // ------------------------------------------------------------- beds

  private startBeds(): void {
    if (this.started || !this.ctx || !this.bedBus) return;
    this.started = true;
    for (const name of ["ambience", "score", "tension"] as const) {
      const gain = this.ctx.createGain();
      const target = SCENE_BEDS[this.scene][name];
      gain.gain.value = target;
      gain.connect(this.bedBus);
      const buffer = this.buffers.get(BED_CLIPS[name]);
      const source = buffer ? this.loopSource(buffer, gain) : null;
      this.beds.set(name, { gain, source, target });
    }
    this.attachSouls();
  }

  private attachLateBed(name: BedName): void {
    const bed = this.beds.get(name);
    const buffer = this.buffers.get(BED_CLIPS[name]);
    if (!bed || bed.source || !buffer) return;
    bed.source = this.loopSource(buffer, bed.gain);
  }

  private attachSouls(): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get("bed_souls");
    if (!ctx || !this.bedBus || !buffer || this.souls?.source) return;
    if (!this.souls) {
      const gain = ctx.createGain();
      gain.gain.value = soulsLevel(this.fallen) * SOULS_GAIN;
      gain.connect(this.bedBus);
      this.souls = { gain, source: null, target: gain.gain.value };
    }
    this.souls.source = this.loopSource(buffer, this.souls.gain);
  }

  setScene(scene: AudioScene): void {
    this.scene = scene;
    const seconds = scene === "battle" || scene.startsWith("consequence") ? 1.25 : 0.72;
    const targets = SCENE_BEDS[scene];
    this.fadeBed("ambience", targets.ambience, seconds);
    this.fadeBed("score", targets.score, seconds);
    this.fadeBed("tension", targets.tension, seconds);
  }

  campaignCue(cue: "choice" | "formation" | "gambit-accept" | "gambit-refuse" | "battle-intro" | "objective-win" | "objective-loss" | "promotion-open" | "promotion-commit" | "finale"): void {
    if (cue === "objective-win" || cue === "finale") this.play("fanfare", cue === "finale" ? 0.9 : 0.8);
    else if (cue === "objective-loss" || cue === "gambit-refuse") this.blip("deny");
    else if (cue === "battle-intro") this.shot("start_toll", { gain: GAIN.toll * 0.8, send: 0.3 });
    else this.blip("press");
  }

  /** 0 = calm, 1 = check / endgame: the heartbeat rises and the dirge draws back. */
  setIntensity(intensity: number): void {
    if (!this.ctx || this.ended) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    const base = SCENE_BEDS[this.scene];
    this.fadeBed("tension", Math.max(base.tension, clamped * 1.6), 1.8);
    this.fadeBed("score", base.score > 0 ? Math.max(0.35, base.score - clamped * 0.4) : 0, 1.8);
  }

  private fadeBed(name: BedName, value: number, seconds: number): void {
    const bed = this.beds.get(name);
    if (!bed || !this.ctx) return;
    bed.target = value;
    this.ramp(bed.gain.gain, value, seconds);
  }

  private ramp(param: AudioParam, value: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
  }

  /** Pulls the beds down for a beat so a voice cuts through. */
  private duckBeds(amount: number, seconds: number, delay = 0): void {
    if (!this.bedBus || !this.ctx) return;
    const at = this.ctx.currentTime + delay;
    const gain = this.bedBus.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(gain.value, at);
    gain.linearRampToValueAtTime(amount, at + 0.08);
    gain.setValueAtTime(amount, at + 0.08 + Math.max(0.1, seconds));
    gain.linearRampToValueAtTime(1, at + 0.5 + Math.max(0.1, seconds));
  }

  // ------------------------------------------------------------- one-shots

  /** Plays a bundled clip if it has arrived; returns null (and fetches it) if not. */
  private shot(id: GambitClipId, options: ShotOptions = {}): Shot | null {
    const ctx = this.ctx;
    // A replay held by its transport starts nothing (its seek puts the game's memory back silently: no bell, no whisper).
    if (!ctx || !this.master || this.silent || this.boardHeld) return null;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.load(id);
      return null;
    }
    const bus = options.bus === "voice" ? this.voiceBus : options.bus === "music" ? this.bedBus : this.sfxBus;
    if (!bus) return null;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const rate = options.rate ?? 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = options.gain ?? 1;
    source.connect(gain);
    let out: AudioNode = gain;
    if (typeof ctx.createStereoPanner === "function" && options.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(panner);
      out = panner;
    }
    out.connect(options.bus === "music" && this.musicBus ? this.musicBus : bus);
    const hall = options.hall === "wound" ? this.woundHall : this.reverb;
    if (options.send && hall) {
      const send = ctx.createGain();
      send.gain.value = options.send;
      out.connect(send);
      send.connect(hall);
    }
    const offset = Math.max(0, Math.min(buffer.duration - 0.01, options.offset ?? 0));
    source.start(when, offset);
    // A gasp holds the floor against a new line but cuts none; every other voice outranks a piece's reaction.
    if (options.bus === "voice" && !isBarkClip(id)) this.takeFloor(when, when + (buffer.duration - offset) / rate, id !== "breath");
    if (options.duck !== undefined) this.duckBeds(options.duck, (buffer.duration - offset) / rate, Math.max(0, options.delay ?? 0));
    // A voice with words: tell the subtitles, timed to the last word where the take records it.
    const clip: GambitClip = GAMBIT_CLIPS[id];
    let line: number | undefined;
    if (options.bus === "voice" && clip.text) {
      line = ++this.lineToken;
      const spoken = Math.max(0.1, ((clip.hold ?? buffer.duration) - offset) / rate);
      this.emitLine({ type: "line", token: line, clip: id, text: clip.text, delay: when - ctx.currentTime, duration: spoken, ...(options.side ? { side: options.side } : {}) });
    }
    return { source, gain, startedAt: when - offset / rate, rate, line };
  }

  play(name: SfxName, volume = 1): void {
    if (name === "place") this.settle(volume);
    else if (name === "capture") this.shot("hit_n", { gain: GAIN.strike * volume });
    else if (name === "check") this.shot("check_toll", { gain: GAIN.toll * volume, send: 0.3 });
    else this.shot("sting_win", { bus: "music", gain: STING_GAIN * volume });
  }

  /** A figure planting its weight on the square it has taken. */
  settle(volume = 1, pan = 0): void {
    this.shot(Math.random() < 0.5 ? "settle_a" : "settle_b", { gain: GAIN.settle * volume, pan: pan * 0.55, rate: 0.95 + Math.random() * 0.1 });
  }

  // ------------------------------------------------------------- the board's voices

  /** The bell that opens a game, and the board remembering that it has done this before. */
  beginGambit(): void {
    this.silenceBarks();
    this.ended = false;
    this.score.begin();
    this.fallen = 0;
    this.memory = emptyPleaMemory();
    this.lastCheckLine = {};
    this.clearWhisper();
    if (this.souls) this.ramp(this.souls.gain.gain, 0, 2);
    const ring = () => {
      this.shot("start_toll", { gain: GAIN.toll, send: 0.3 });
      this.shot(chooseFresh(START_WHISPERS, undefined, Math.random), { bus: "voice", gain: GAIN.start, send: 0.9, delay: 2.2, pan: Math.random() * 0.8 - 0.4 });
    };
    const sound = () => {
      // The score's Theme comes in under the bell, unless an opening is playing: then on its last beat (openingCue).
      if (this.themeBeat === null) this.score.bell();
      if (this.buffers.has("start_toll")) ring();
      else if (this.ctx) {
        const askedAt = this.ctx.currentTime;
        void Promise.all([this.load("start_toll"), this.load("start_a"), this.load("start_b")]).then(() => {
          // Only if it is still the start of the game: a late toll would ring over the first moves.
          if (!this.ended && this.fallen === 0 && this.ctx && this.ctx.currentTime - askedAt < 3) ring();
        });
      }
    };
    // An opening is about to play (prepareOpening, a moment ago): the bell waits for its first picture. A hold left
    // over from an opening that never asked for its bell is let go, and the bell rings as it always has.
    if (this.heldBell === "waiting" && performance.now() - this.heldSince > OPENING_BELL_WAIT_MS) { this.heldBell = null; this.themeBeat = null; }
    if (this.heldBell) {
      this.heldBell = sound;
      return;
    }
    sound();
  }

  /**
   * A piece wakes as its killer comes for it: a gasp, and it begs. Not every
   * piece wakes in time (see shared/play/gambit-sound.ts); returns null when
   * this one does not, when another is already begging, or before the voices
   * have arrived.
   */
  pleaFor(faction: Faction, kind: PieceKind, context: PleaContext = {}): PleaHandle | null {
    const ctx = this.ctx;
    if (!ctx || this.silent || this.ended) return null;
    if (this.plea && ctx.currentTime < this.plea.startedAt + (this.plea.source.buffer?.duration ?? 0) / this.plea.rate) return null;
    if (Math.random() >= pleaChance(kind, { first: !!context.first, speed: context.speed })) return null;
    const pick = pickPlea(this.kingdoms[faction], kind, this.memory, Math.random, context.voice);
    if (!pick) return null;
    const id = pick.clip as GambitClipId;
    const clip = GAMBIT_CLIPS[id];
    const shot = this.shot(id, { bus: "voice", gain: GAIN.plea, pan: (context.pan ?? 0) * 0.7, send: 0.14, duck: 0.5, side: faction });
    if (!shot) return null;
    const lastWordAt = shot.startedAt + ("hold" in clip ? clip.hold : clip.dur);
    const live = { ...shot, lastWordAt };
    this.plea = live;
    let cut = false;
    return {
      voice: pick.voice,
      clip: pick.clip,
      secondsToLastWord: () => (this.ctx ? Math.max(0, lastWordAt - this.ctx.currentTime) : 0),
      cut: () => {
        if (cut || !this.ctx) return;
        cut = true;
        const now = this.ctx.currentTime;
        const param = live.gain.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(0.0001, now + CUT_SECONDS);
        try { live.source.stop(now + CUT_SECONDS + 0.02); } catch { /* Already stopped. */ }
        if (live.line !== undefined) this.emitLine({ type: "cut", token: live.line });
        if (this.plea === live) this.plea = null;
      },
    };
  }

  /**
   * The dying voice of one figure: the same person who pleaded, when one did,
   * panned to the body, with the stone hall behind it and the music ducked.
   */
  deathCry(faction: Faction, kind: PieceKind, options: DeathCryOptions = {}): void {
    if (!this.ctx || this.silent || this.dying >= MAX_DYING) return;
    const voice = options.voice && clipKingdom(deathClip(options.voice)) === this.kingdoms[faction] ? options.voice : deathVoice(this.kingdoms[faction], kind, Math.random);
    const shot = this.shot(deathClip(voice) as GambitClipId, {
      bus: "voice",
      gain: GAIN.death * (options.volume ?? 1),
      pan: (options.pan ?? 0) * 0.7,
      rate: Math.max(0.9, Math.min(1.08, options.rate ?? 1)),
      delay: options.delay,
      send: 0.2,
      duck: 0.55,
    });
    if (!shot) return;
    this.dying += 1;
    shot.source.onended = () => { this.dying = Math.max(0, this.dying - 1); };
  }

  /** The body burns away and something leaves it; the fallen grow louder in the hall. */
  soulRelease(pan = 0): void {
    // Under a piece's words the soul leaves more quietly (see bark): every effect sits under the voices.
    const gain = GAIN.soul * (this.ctx && this.ctx.currentTime < this.barkUntil ? SOUL_UNDER_WORDS : 1);
    const soul = this.shot("soul_release", { gain, pan: pan * 0.6, send: 0.45, rate: 0.94 + Math.random() * 0.12 });
    if (soul) this.liveSoul = { gain: soul.gain, endsAt: soul.startedAt + (soul.source.buffer?.duration ?? 0) / soul.rate };
    this.fallen += 1;
    if (!this.souls) this.attachSouls();
    if (this.souls && !this.ended) this.ramp(this.souls.gain.gain, soulsLevel(this.fallen) * SOULS_GAIN, 3);
    this.scheduleWhisper();
  }

  private scheduleWhisper(): void {
    if (this.whisperTimer || this.ended) return;
    const delay = whisperDelay(this.fallen, Math.random);
    if (delay === null) return;
    this.whisperTimer = setTimeout(() => {
      this.whisperTimer = null;
      if (this.ended || !this.ctx || this.ctx.state !== "running") return;
      const begging = this.plea && this.ctx.currentTime < this.plea.lastWordAt + 0.5;
      const barking = this.ctx.currentTime < this.barkUntil + 0.5;
      if (!begging && !barking) {
        const id = chooseFresh(WHISPERS, this.lastWhisper as (typeof WHISPERS)[number] | undefined, Math.random);
        this.lastWhisper = id;
        this.shot(id, { bus: "voice", gain: GAIN.whisper, send: 1, pan: Math.random() * 1.6 - 0.8, rate: 0.95 + Math.random() * 0.05 });
      }
      this.scheduleWhisper();
    }, delay * 1000);
  }

  private clearWhisper(): void {
    if (this.whisperTimer) clearTimeout(this.whisperTimer);
    this.whisperTimer = null;
  }

  /** Check: the bell, and sometimes the king, under his breath. `checksInARow` counts this one. */
  check(king: Faction, pan = 0, checksInARow = 1): void {
    this.shot("check_toll", { gain: GAIN.toll, pan: pan * 0.4, send: 0.3 });
    if (Math.random() >= checkLineChance(checksInARow)) return;
    const id = chooseFresh(checkClips(this.kingdoms[king]), this.lastCheckLine[king], Math.random) as GambitClipId;
    this.lastCheckLine[king] = id;
    this.shot(id, { bus: "voice", gain: GAIN.check, pan: pan * 0.6, send: 0.25, delay: 0.9, duck: 0.6, side: king });
  }

  /**
   * The one path for how a game ends in sound: a checkmate tolls the funeral bell, the beaten King says his defeat
   * (he is never slain, so never speaks of dying) 1.5 s after it, then the closing cue; the fallen fall silent.
   * `listener` is the side the player plays against the computer; null in a duel or an exhibition. A downfall
   * (scene/downfall) passes `sting`, when the closing cue begins: as its results are shown.
   */
  endGame(result: { winner: Faction | null; reason: string }, listener: Faction | null, beats: { sting?: number } = {}): void {
    if (this.ended) return;
    this.ended = true;
    this.clearWhisper();
    const ending = gambitEnding(result, listener);
    if (this.souls) this.ramp(this.souls.gain.gain, 0, 5);
    this.fadeBed("tension", 0, 3);
    this.fadeBed("score", SCENE_BEDS[this.scene].score > 0 ? 0.45 : 0, 2);
    if (ending.toll) this.shot(ending.toll, { gain: GAIN.toll * 1.1, send: 0.3, duck: 0.5 });
    let lastWord: { at: number; end: number } | null = null;
    if (ending.lastWords) {
      const id = chooseFresh(mateClips(this.kingdoms[ending.lastWords]), undefined, Math.random) as GambitClipId;
      const words = this.shot(id, { bus: "voice", gain: GAIN.mate, send: 0.3, delay: 1.5, duck: 0.4, side: ending.lastWords });
      const take: GambitClip = GAMBIT_CLIPS[id];
      if (words) lastWord = { at: words.startedAt + (take.hold ?? take.dur) / words.rate, end: words.startedAt + take.dur / words.rate };
    }
    this.closingCue(ending.sting, ending.toll !== null, lastWord, beats.sting);
  }

  /** A figure chosen to move draws breath — some of the time, never twice in a few seconds. */
  breath(pan = 0): void {
    const ctx = this.ctx;
    // Never over a piece that is speaking: the chosen figure's breath waits its turn and is simply not drawn.
    if (!ctx || ctx.currentTime - this.lastBreath < BREATH_GAP_SECONDS || ctx.currentTime < this.barkUntil || Math.random() >= BREATH_CHANCE) return;
    if (this.shot("breath", { bus: "voice", gain: GAIN.breath, pan: pan * 0.6, rate: 0.92 + Math.random() * 0.16 })) this.lastBreath = ctx.currentTime;
  }

  /** A footsoldier made something more. */
  promote(pan = 0): void {
    this.shot("promote", { gain: GAIN.promote, pan: pan * 0.5, send: 0.35 });
  }

  /** The blow lands. Each rank has its own weapon. */
  strike(attacker: PieceKind, options: StrikeSoundOptions = {}): void {
    this.shot(strikeClip(attacker) as GambitClipId, {
      gain: GAIN.strike * (options.volume ?? 1),
      pan: (options.pan ?? 0) * 0.55,
      delay: options.delay,
      rate: 0.96 + Math.random() * 0.08,
    });
    if (options.flesh !== false) this.flesh(fleshFamily(attacker), GAIN.flesh * (options.volume ?? 1), FLESH_SEND, options);
  }

  /**
   * What the blow does to the body: one take of the wound from its shuffle bag
   * (all three before any repeats), placed where the blow is and sent into the
   * wounds' own hall so the cut rings out after the weapon has gone quiet.
   */
  private flesh(family: FleshFamily | "gore", gain: number, send: number, options: { pan?: number; delay?: number }): void {
    if (!this.ctx || this.silent) return;
    const shot = this.shot(pickFlesh(family, this.fleshMemory, Math.random) as GambitClipId, {
      gain,
      pan: (options.pan ?? 0) * 0.55,
      delay: options.delay,
      rate: 0.94 + Math.random() * 0.12,
      send,
      hall: "wound",
    });
    if (shot && family !== "gore") this.score.kill(shot.startedAt);
    if (shot && family !== "gore") {
      // The send is taken after this gain, so the ring eases back with the wound.
      shot.gain.gain.setValueAtTime(gain, shot.startedAt + FLESH_YIELD.hold);
      shot.gain.gain.linearRampToValueAtTime(gain * FLESH_YIELD.to, shot.startedAt + FLESH_YIELD.by);
    }
  }

  /**
   * One sound of a duel's exchange (CombatSoundBank.cue): a take of the named cue from its own shuffle bag, on the
   * effects bus with the flesh and through the same limiter, dry. `volume` is the cue's level as the combat layer
   * gives it; `pan` is where the fighters are. False for a name that is not a duel cue, and for a take that has not
   * arrived yet, so the layer can fall back on its stand-in. Whether the menu's board may make the sound at all is
   * combatCueAllowed's to say (shared/play/gambit-sound.ts): the caller asks it first. A summon's cue and a library
   * spell's (RITE_CUE_TAKES, SPELL_CUE_TAKES) are played by their own players, riteCue and spellCue.
   */
  cue(name: string, options: { volume?: number; pan?: number } = {}): boolean {
    if (isRiteCue(name)) return this.riteCue(name, options);
    if (isSpellCue(name)) return this.spellCue(name, options);
    if (!isCombatCue(name)) return false;
    if (!this.ctx || this.silent) return true;
    const shot = this.shot(pickCombatCue(name, this.cueMemory, Math.random) as GambitClipId, {
      gain: CUE_GAIN[combatCueFamily(name)] * (options.volume ?? 1),
      pan: (options.pan ?? 0) * 0.55,
      rate: 0.96 + Math.random() * 0.08,
    });
    return shot !== null;
  }

  /** The killing bolt going into a body: the flesh under the fire, as strike() has it under steel. */
  fleshBlast(options: SpellOptions = {}): void {
    this.flesh("blast", GAIN.flesh * Math.min(1, options.volume ?? 1), BLAST_SEND, options);
  }

  /**
   * A blow with no weapon of its own, as a summon deals it (talons, teeth, a tearing apart, fire): only what it does
   * to the body, one take of the family from its bag, sent into the wounds' hall as strike()'s flesh is.
   */
  fleshWound(family: FleshFamily, options: StrikeSoundOptions = {}): void {
    this.flesh(family, GAIN.flesh * (options.volume ?? 1), family === "blast" ? BLAST_SEND : FLESH_SEND, options);
  }

  /**
   * One of a Queen's summon's own sounds (gambit-sound.ts RITE_CUE_TAKES): a take from the cue's own shuffle bag,
   * a little into the voices' hall, as a great beast would be heard in it. True when the cue has takes, so the scene
   * plays its stand-in only for a cue that has none.
   */
  private riteCue(name: RiteCue, options: { volume?: number; pan?: number }): boolean {
    if (!this.ctx || this.silent) return true;
    this.shot(pickRiteCue(name, this.riteMemory, Math.random) as GambitClipId, {
      gain: GAIN.rite * (options.volume ?? 1),
      pan: (options.pan ?? 0) * 0.55,
      rate: 0.97 + Math.random() * 0.06,
      send: RITE_SEND,
    });
    return true;
  }

  /**
   * One of a library spell's own sounds (gambit-sound.ts SPELL_CUE_TAKES): a take from the cue's own shuffle bag at the
   * spells' gain, placed as the generic cast and burst are, the blow a little into the voices' hall. False when the
   * take has not arrived yet, so the scene plays the generic fire in its place.
   */
  private spellCue(name: SpellCue, options: { volume?: number; pan?: number }): boolean {
    if (!this.ctx || this.silent) return true;
    const blow = name.endsWith(".strike");
    const shot = this.shot(pickSpellCue(name, this.spellMemory, Math.random) as GambitClipId, {
      gain: GAIN.spell * (blow ? Math.min(1.4, options.volume ?? 1) : options.volume ?? 1),
      pan: (options.pan ?? 0) * (blow ? 0.45 : 0.7),
      rate: 0.97 + Math.random() * 0.06,
      send: blow ? SPELL_SEND : 0,
    });
    return shot !== null;
  }

  /**
   * A library spell's own gathering (`spell.<id>.gather`), timed as the generic charge is so that it crests as the
   * spell leaves the hand: it ends `duration` seconds from now. A take longer than that joins part-way in, faded up; a
   * shorter one waits. False when the spell has no gathering of its own or its take has not arrived: the scene then
   * plays the generic charge.
   */
  spellGather(name: string, options: SpellOptions = {}): boolean {
    if (!isSpellCue(name)) return false;
    if (!this.ctx || this.silent) return true;
    const id = pickSpellCue(name, this.spellMemory, Math.random) as GambitClipId;
    const buffer = this.buffers.get(id);
    if (!buffer) {
      void this.load(id);
      return false;
    }
    const span = Math.max(0.18, options.duration ?? 0.5);
    const offset = Math.max(0, buffer.duration - span);
    const gain = GAIN.spell * Math.min(1.3, 0.6 + (options.volume ?? 1) * 0.4);
    const shot = this.shot(id, {
      gain,
      pan: (options.pan ?? 0) * 0.6,
      delay: (options.delay ?? 0) + Math.max(0, span - buffer.duration),
      offset,
    });
    if (shot && offset > 0) {
      const from = shot.startedAt + offset;
      shot.gain.gain.setValueAtTime(0, from);
      shot.gain.gain.linearRampToValueAtTime(gain, from + Math.min(0.12, span / 3));
    }
    return shot !== null;
  }

  /** Blood and torn flesh reaching the stone as the body lands: the scene calls this at the landing, after the cry. */
  goreSplat(options: StrikeSoundOptions = {}): void {
    this.flesh("gore", GAIN.gore * (options.volume ?? 1), GORE_SEND, options);
  }

  /**
   * A body hitting the stone. With `kind`, the recorded fall for that build;
   * without (a corpse thrown or swallowed), a short synthesised thump.
   */
  bodyFall(volume = 1, kind?: PieceKind): void {
    if (!this.ctx || !this.master || this.silent) return;
    if (kind) {
      const heavy = kind === "r" || kind === "k" || kind === "q";
      if (this.shot(heavy ? "fall_heavy" : "fall_light", { gain: GAIN.fall * volume, rate: 0.95 + Math.random() * 0.1 })) return;
    }
    const ctx = this.ctx;
    const out = this.sfxBus ?? this.master;
    const now = ctx.currentTime;
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    thumpGain.gain.setValueAtTime(0.3 * volume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    thump.connect(thumpGain);
    thumpGain.connect(out);
    thump.start(now);
    thump.stop(now + 0.4);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.25, 2.5);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.14 * volume;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(out);
    noise.start(now);
  }

  /**
   * A figure meeting the board: the dry click of the base and three damped body
   * modes. Kept quiet now that each arrival also plants a recorded footfall.
   */
  woodTap(options: WoodTapOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const ctx = this.ctx;
    const lift = options.lift === true;
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    const level = 0.5 * (options.volume ?? 1) * (lift ? 0.5 : 0.45);
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const bus = ctx.createGain();
    bus.gain.value = level;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = lift ? 5200 : 4200;
    bus.connect(tone);
    this.connectPanned(tone, (options.pan ?? 0) * 0.55);
    const jitter = 0.94 + Math.random() * 0.12;
    const root = (lift ? 620 : 430 - weight * 165) * jitter;
    const ring = lift ? 0.085 : 0.13 + weight * 0.075;
    for (const mode of [{ ratio: 1, gain: 1, decay: 1 }, { ratio: 2.06, gain: 0.42, decay: 0.62 }, { ratio: 3.41, gain: 0.19, decay: 0.38 }]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const frequency = root * mode.ratio;
      osc.frequency.setValueAtTime(frequency, when);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.94, when + ring * mode.decay);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(mode.gain, when + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + ring * mode.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + ring + 0.05);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.02, 6);
    const click = ctx.createBiquadFilter();
    click.type = "bandpass";
    click.frequency.value = lift ? 2600 : 1750 - weight * 350;
    click.Q.value = 0.9;
    const clickGain = ctx.createGain();
    clickGain.gain.value = lift ? 0.5 : 0.72;
    noise.connect(click);
    click.connect(clickGain);
    clickGain.connect(bus);
    noise.start(when);
  }

  /**
   * The board is a player's to move on: two quiet knocks on the wood, a knuckle on the table, a moment after the
   * last piece has been set down. They rise for White and fall for Black, so in a duel the ear knows whose turn
   * it is. Made of the board's own taps ({@link woodTap}): no new sound enters the hall.
   */
  turnCue(side: Faction): void {
    const [first, second] = side === "w" ? [0.85, 0.25] : [0.25, 0.85];
    this.woodTap({ volume: 0.8, weight: first, delay: 0.26 });
    this.woodTap({ volume: 0.9, weight: second, delay: 0.37 });
  }

  /**
   * One footfall on stone: a recorded step for the boot (four takes each, never
   * the same twice running), pitch-jittered; synthesised until they arrive.
   */
  footstep(options: FootstepOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const timbre = options.timbre ?? "scuff";
    const jitter = options.jitter ?? (Math.random() - 0.5) * 0.16;
    const id = chooseFresh(stepClips(timbre), this.lastStep[timbre], Math.random) as GambitClipId;
    if (this.buffers.has(id)) {
      this.lastStep[timbre] = id;
      this.shot(id, {
        gain: GAIN.step * FOOTSTEP_VOICES[timbre].level * (options.volume ?? 1),
        pan: (options.pan ?? 0) * 0.6,
        delay: options.delay,
        rate: 1 + jitter * 0.5,
      });
      return;
    }
    void this.load(id);
    this.synthFootstep(timbre, options, jitter);
  }

  private synthFootstep(timbre: FootstepTimbre, options: FootstepOptions, jitterAmount: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const voice = FOOTSTEP_VOICES[timbre];
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const jitter = 1 + jitterAmount;
    const bus = ctx.createGain();
    bus.gain.value = 0.3 * voice.level * (options.volume ?? 1);
    this.connectPanned(bus, (options.pan ?? 0) * 0.6);
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(voice.body * jitter, when);
    thump.frequency.exponentialRampToValueAtTime(voice.body * 0.55 * jitter, when + voice.decay);
    thumpGain.gain.setValueAtTime(0.0001, when);
    thumpGain.gain.exponentialRampToValueAtTime(voice.weight, when + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + voice.decay);
    thump.connect(thumpGain);
    thumpGain.connect(bus);
    thump.start(when);
    thump.stop(when + voice.decay + 0.05);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(voice.scuff, voice.grit);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = voice.noise * jitter;
    band.Q.value = voice.q;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = voice.hiss;
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);
  }

  /** Fire gathering at the head of a staff, timed so it peaks as the bolt leaves. */
  spellCharge(options: SpellOptions = {}): void {
    const span = Math.max(0.18, options.duration ?? 0.5);
    const buffer = this.buffers.get("spell_charge");
    if (buffer) {
      // Start far enough in that the recorded swell crests on the release.
      this.shot("spell_charge", {
        gain: GAIN.spell * Math.min(1.3, 0.6 + (options.volume ?? 1) * 0.4),
        pan: (options.pan ?? 0) * 0.6,
        delay: options.delay,
        offset: Math.max(0, buffer.duration - span - 0.15),
      });
      return;
    }
    void this.load("spell_charge");
  }

  /** The bolt leaving the staff. */
  spellCast(options: SpellOptions = {}): void {
    this.shot("spell_cast", { gain: GAIN.spell * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.7, delay: options.delay, rate: 0.95 + Math.random() * 0.1 });
  }

  /** The bolt landing on a body. */
  spellImpact(options: SpellOptions = {}): void {
    this.shot("spell_impact", { gain: GAIN.spell * Math.min(1.4, options.volume ?? 1), pan: (options.pan ?? 0) * 0.45, delay: options.delay, send: 0.15 });
  }

  /** Steel moving through air: a blade, or a hammer hauled round. */
  bladeWhoosh(options: StrikeSoundOptions = {}): void {
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    this.shot(weight >= 0.5 ? "whoosh_heavy" : "whoosh_light", {
      gain: GAIN.whoosh * (options.volume ?? 1),
      pan: (options.pan ?? 0) * 0.55,
      delay: options.delay,
      rate: 1.08 - weight * 0.2,
    });
  }

  /** A blow that goes through the body and into the floor. */
  groundSlam(options: StrikeSoundOptions = {}): void {
    this.shot("slam", { gain: GAIN.slam * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.4, delay: options.delay, duck: 0.7 });
  }

  /** The sentence passed: the crown's bell over the condemned. */
  judgementToll(options: StrikeSoundOptions = {}): void {
    this.shot("sentence_bell", { gain: GAIN.toll * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.35, delay: options.delay, send: 0.35, duck: 0.6 });
  }

  /** UI feedback. A refused move knocks stone; hover and press stay synthesised and quiet. */
  // ------------------------------------------------------------- gunfire

  /** Warms the recorded barrels in the background; called when a powder army takes the field. */
  primeGunfire(): void {
    if (!this.ctx) return;
    for (const url of Object.values(GUN_AUDIO_URLS)) void this.loadShot(url);
  }

  private loadShot(url: string): Promise<void> {
    const pending = this.shotLoads.get(url);
    if (pending) return pending;
    const job = (async () => {
      try {
        const response = await fetch(url);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          this.shotLoads.delete(url);
          return;
        }
        this.shots.set(url, this.analyseTake(await ctx.decodeAudioData(raw)));
      } catch (error) {
        console.warn("[audio] gunfire take failed to load", error);
      }
    })();
    this.shotLoads.set(url, job);
    return job;
  }

  /**
   * Finds where a recorded shot actually starts, and how hot it was recorded.
   *
   * A generated sound effect is a *clip*, not an event: it opens with whatever
   * room tone the model felt like, and the report can sit anywhere inside it.
   * Played from sample zero the ear hears the flash first and the bang after,
   * which is exactly the desync this exists to kill.
   *
   * The onset is taken from the loudest moment rather than from the first sample
   * over a threshold: threshold-crossing latches onto room tone (or onto a flint
   * scrape) and reports 0ms for a take whose crack is really 170ms in. So find
   * the loudest 4ms window, walk *backwards* to where the energy was still a
   * small fraction of it — the foot of the attack — and refine to the sample
   * inside that window where the waveform first moves.
   */
  private analyseTake(buffer: AudioBuffer): ShotTake {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    if (peak <= 0) return { buffer, onset: 0, peak: 1 };

    // Energy envelope in 4ms windows: short enough to resolve a transient, long
    // enough that one stray sample cannot pass for one.
    const window = Math.max(1, Math.round(rate * 0.004));
    const windows = Math.ceil(data.length / window);
    const energy = new Float32Array(windows);
    let loudest = 0;
    for (let w = 0; w < windows; w += 1) {
      const start = w * window;
      const end = Math.min(data.length, start + window);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += data[i] * data[i];
      energy[w] = Math.sqrt(sum / Math.max(1, end - start));
      if (energy[w] > energy[loudest]) loudest = w;
    }

    // Foot of the attack: the last quiet window before the loudest one.
    const floor = energy[loudest] * 0.14;
    let start = loudest;
    while (start > 0 && energy[start - 1] > floor) start -= 1;

    // Refine inside that window so the crack is not clipped by up to 4ms.
    let onset = start * window;
    const limit = Math.min(data.length, onset + window);
    for (let i = onset; i < limit; i += 1) {
      if (Math.abs(data[i]) >= peak * 0.05) {
        onset = i;
        break;
      }
    }
    // Never trim into the shot itself: the attack keeps two milliseconds of
    // run-up so it still reads as a hard edge rather than a truncated click.
    onset = Math.max(0, onset - Math.round(rate * 0.002));
    return { buffer, onset: onset / rate, peak };
  }

  /**
   * Plays one recorded take, panned to where it happens on screen. Returns false
   * when the clip has not streamed in yet (and warms it for next time), so the
   * caller can fall back to its synthesised voice.
   *
   * Two corrections are applied to every take, both measured off the audio
   * rather than authored: playback starts at the shot's own onset, so the report
   * lands on the instant the caller asked for, and the level is normalised, so
   * `volume` means the same thing whichever barrel is talking.
   */
  private playTake(
    url: string,
    options: { pan?: number; volume?: number; delay?: number; rate?: number } = {},
  ): boolean {
    const ctx = this.ctx;
    const master = this.sfxBus ?? this.master;
    if (!ctx || !master || this.silent) return false;
    const take = this.shots.get(url);
    if (!take) {
      void this.loadShot(url);
      return false;
    }
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = take.buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = ctx.createGain();
    const match = Math.max(TAKE_GAIN_RANGE[0], Math.min(TAKE_GAIN_RANGE[1], TAKE_PEAK / take.peak));
    gain.gain.value = (options.volume ?? 1) * match;
    source.connect(gain);
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.6;
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }
    // The offset is the whole point: the transient starts here, not the file.
    source.start(when, take.onset);
    return true;
  }

  /**
   * Black powder going off. One voice covers the whole army by `calibre`:
   *
   * - `0` — an officer's flintlock pistol: a dry, bright crack, gone at once.
   * - `0.5` — a Charleville musket: a harder crack over a short chest thump.
   * - `1` — a field gun: the crack is buried under a sub-bass slam that rolls
   *   away down the hall, with the report coming back off the far wall.
   *
   * The synthesised half never waits on a download, so a volley always fires on
   * time even if a take is still streaming in.
   */
  gunshot(options: GunSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const calibre = Math.max(0, Math.min(1, options.weight ?? 0.5));
    // A recorded barrel carries the report; the synthesised voice then only has
    // to supply the weight underneath it, so the two never fight each other.
    const mix = options.voice !== undefined ? SHOT_VOICES[options.voice] : null;
    const recorded =
      options.voice !== undefined &&
      mix !== null &&
      this.playTake(GUN_AUDIO_URLS[options.voice], {
        pan: options.pan,
        volume: mix.take * (0.9 + calibre * 0.25) * (options.volume ?? 1),
        delay: options.delay,
        // A shade of detune so a volley never repeats the same take verbatim.
        // Kept tight: a big rate change would drag the transient off the frame
        // the trigger broke on, which is the one thing this must not do.
        rate: 0.98 + Math.random() * 0.045,
      });
    const level = (0.34 + calibre * 0.3) * (options.volume ?? 1) * (recorded && mix ? mix.synth : 1);
    const bus = this.fxBus(options.pan ?? 0, 0.5);

    // The report itself: a very short, very loud burst of noise, filtered lower
    // as the bore gets bigger.
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.09 + calibre * 0.14, 5.5 - calibre * 2.6);
    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.Q.value = 0.55;
    shape.frequency.setValueAtTime(3400 - calibre * 2200, when);
    shape.frequency.exponentialRampToValueAtTime(520 - calibre * 340, when + 0.09 + calibre * 0.1);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(level * 1.15, when);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12 + calibre * 0.16);
    crack.connect(shape);
    shape.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // The charge under it. A pistol barely has one; a gun is almost all thump.
    const punch = ctx.createOscillator();
    const punchGain = ctx.createGain();
    const span = 0.16 + calibre * 0.6;
    punch.type = "sine";
    punch.frequency.setValueAtTime(220 - calibre * 130, when);
    punch.frequency.exponentialRampToValueAtTime(52 - calibre * 26, when + span);
    punchGain.gain.setValueAtTime(0.0001, when);
    punchGain.gain.exponentialRampToValueAtTime(level * (0.5 + calibre * 0.9), when + 0.012);
    punchGain.gain.exponentialRampToValueAtTime(0.0001, when + span);
    punch.connect(punchGain);
    punchGain.connect(bus);
    punch.start(when);
    punch.stop(when + span + 0.1);

    // Powder smoke and wadding: a soft hiss trailing the shot.
    const smoke = ctx.createBufferSource();
    smoke.buffer = this.noiseBuffer(0.4 + calibre * 0.5, 1.8);
    const air = ctx.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = 2400 - calibre * 900;
    const smokeGain = ctx.createGain();
    smokeGain.gain.setValueAtTime(0.0001, when + 0.02);
    smokeGain.gain.exponentialRampToValueAtTime(level * 0.22, when + 0.07);
    smokeGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.45 + calibre * 0.4);
    smoke.connect(air);
    air.connect(smokeGain);
    smokeGain.connect(bus);
    smoke.start(when + 0.02);

    // Only a gun is big enough for the hall to answer it. A recorded cannon
    // brings its own echo, so the synthesised one would only smear it.
    if (calibre > 0.6 && !recorded) {
      const echo = ctx.createBufferSource();
      echo.buffer = this.noiseBuffer(0.7, 1.2);
      const walls = ctx.createBiquadFilter();
      walls.type = "bandpass";
      walls.Q.value = 0.4;
      walls.frequency.value = 420;
      const echoGain = ctx.createGain();
      echoGain.gain.setValueAtTime(0.0001, when + 0.14);
      echoGain.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.22);
      echoGain.gain.exponentialRampToValueAtTime(0.0001, when + 1.05);
      echo.connect(walls);
      walls.connect(echoGain);
      echoGain.connect(bus);
      echo.start(when + 0.13);
    }

    this.duckBeds(0.78 - calibre * 0.2, 0.5 + calibre * 0.7);
  }

  /**
   * The drill around a shot: the hammer being drawn back, a ramrod going down a
   * barrel, the ring of a linstock on a gun. Small, dry mechanical ticks that
   * make the wind-up read as a firearm rather than a spell.
   *
   * @param options `weight` 0 is a pistol lock, 1 is iron on a field gun
   */
  gunLock(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.2 * (options.volume ?? 1);
    const bus = this.fxBus(options.pan ?? 0, 0.45);

    for (const step of [0, 0.07 + weight * 0.05]) {
      const tick = ctx.createBufferSource();
      tick.buffer = this.noiseBuffer(0.05, 7);
      const metal = ctx.createBiquadFilter();
      metal.type = "bandpass";
      metal.Q.value = 5 + weight * 4;
      metal.frequency.value = 2600 - weight * 1200 + (step > 0 ? 380 : 0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level * (step > 0 ? 0.75 : 1), when + step);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + step + 0.07);
      tick.connect(metal);
      metal.connect(gain);
      gain.connect(bus);
      tick.start(when + step);
    }
  }

  /**
   * The trigger breaking, and the priming charge catching behind it.
   *
   * A muzzle-loader does not go off the instant the finger moves. The sear
   * releases, the flint rakes the frizzen, the pan flashes, and only then does
   * the main charge in the barrel light — forty to seventy milliseconds later on
   * a flintlock, longer on a gun being touched off with a portfire. That gap is
   * lock time, and it is the reason a real shot sounds like *two* events rather
   * than one: a small dry mechanical noise, then the report.
   *
   * This is the first of the two. It is played on the frame the trigger is
   * pulled; {@link gunshot} follows one lock time behind it, on the frame the
   * muzzle flash is drawn. Without it, the report is the only thing the ear gets,
   * and the moment the finger moved is inaudible.
   *
   * @param options `weight` 0 is a pistol lock, 1 is a field gun's vent
   */
  triggerPull(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.16 * (options.volume ?? 1);
    const bus = this.fxBus(options.pan ?? 0, 0.5);
    // A gun is not held: it is touched off at the vent, so there is iron and a
    // fuse rather than a sear and a spring.
    const gun = weight > 0.75;

    // The sear letting go: the shortest, driest sound in the whole beat.
    const sear = ctx.createBufferSource();
    sear.buffer = this.noiseBuffer(0.018, 9);
    const snap = ctx.createBiquadFilter();
    snap.type = "bandpass";
    snap.Q.value = 6.5;
    snap.frequency.value = gun ? 1500 : 4300 - weight * 1100;
    const searGain = ctx.createGain();
    searGain.gain.setValueAtTime(level * (gun ? 1.2 : 0.9), when);
    searGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    sear.connect(snap);
    snap.connect(searGain);
    searGain.connect(bus);
    sear.start(when);

    // Flint raking down the frizzen — small arms only. A very short bright
    // scrape, falling as the cock swings through.
    if (!gun) {
      const scrape = ctx.createBufferSource();
      scrape.buffer = this.noiseBuffer(0.026, 2.2);
      const steel = ctx.createBiquadFilter();
      steel.type = "bandpass";
      steel.Q.value = 1.6;
      steel.frequency.setValueAtTime(6200, when + 0.004);
      steel.frequency.exponentialRampToValueAtTime(2800, when + 0.03);
      const scrapeGain = ctx.createGain();
      scrapeGain.gain.setValueAtTime(0.0001, when + 0.004);
      scrapeGain.gain.exponentialRampToValueAtTime(level * 0.55, when + 0.009);
      scrapeGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);
      scrape.connect(steel);
      steel.connect(scrapeGain);
      scrapeGain.connect(bus);
      scrape.start(when + 0.004);
    }

    // The priming charge catching: a thin hiss that runs right up to the report,
    // so the two read as one chain of events rather than two separate sounds. A
    // gun's fuse burns lower and longer than powder flashing in a pan.
    const flash = ctx.createBufferSource();
    const span = gun ? 0.075 : 0.03;
    flash.buffer = this.noiseBuffer(span + 0.01, 0.7);
    const air = ctx.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = gun ? 1700 : 3100;
    const flashGain = ctx.createGain();
    flashGain.gain.setValueAtTime(0.0001, when + 0.008);
    flashGain.gain.exponentialRampToValueAtTime(level * (gun ? 0.7 : 0.5), when + 0.008 + span * 0.7);
    flashGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.012 + span);
    flash.connect(air);
    air.connect(flashGain);
    flashGain.connect(bus);
    flash.start(when + 0.008);
  }

  /**
   * The ball arriving: a recorded ricochet whine cut short by a thud into the
   * body. Silent (and warming) until the take has streamed in, because the
   * capture hit already has its own synthesised weight behind it.
   */
  ballImpact(options: StrikeSoundOptions = {}): void {
    this.playTake(GUN_AUDIO_URLS.impact, {
      pan: options.pan,
      volume: 0.85 * (options.volume ?? 1),
      delay: options.delay,
      rate: 0.95 + Math.random() * 0.1,
    });
  }

  /**
   * The square being taken off the enemy — the one sound in the game that means
   * *conquest* rather than violence, played on the frame the victor's boot comes
   * down on the tile it has just cleared.
   *
   * Three layers, in the order the ear should receive them:
   *
   * 1. **The boot claiming the stone.** A dry grit transient over a low stamp —
   *    weight being put down deliberately, not a body falling.
   * 2. **The claim itself.** A short brass motif rising a perfect fifth (with an
   *    octave on top when something big has gone down), each note scooped into
   *    from slightly under pitch through a filter that opens on the attack. This
   *    is the signature: two notes, up, and it can only ever mean one thing.
   * 3. **The standard planted.** Two high inharmonic partials ringing over the
   *    top for a beat, so the whole thing decays into metal rather than stopping.
   *
   * Nothing here is downloaded, so a capture is punctuated on the exact frame it
   * completes even on a cold cache.
   */
  conquest(options: ConquestOptions = {}): void {
    if (!this.ctx || !this.master || this.silent) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.28 * (options.volume ?? 1);
    const bus = this.fxBus(options.pan ?? 0, 0.5);

    // ---- the boot coming down on the taken tile --------------------------
    const heel = ctx.createBufferSource();
    heel.buffer = this.noiseBuffer(0.05, 6);
    const grit = ctx.createBiquadFilter();
    grit.type = "bandpass";
    grit.Q.value = 0.85;
    grit.frequency.value = 1550 - weight * 420;
    const heelGain = ctx.createGain();
    heelGain.gain.value = level * 0.55;
    heel.connect(grit);
    grit.connect(heelGain);
    heelGain.connect(bus);
    heel.start(when);

    const stamp = ctx.createOscillator();
    const stampGain = ctx.createGain();
    stamp.type = "sine";
    stamp.frequency.setValueAtTime(134 - weight * 42, when);
    stamp.frequency.exponentialRampToValueAtTime(48 - weight * 13, when + 0.2);
    stampGain.gain.setValueAtTime(0.0001, when);
    stampGain.gain.exponentialRampToValueAtTime(level * (0.68 + weight * 0.5), when + 0.008);
    stampGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.26 + weight * 0.12);
    stamp.connect(stampGain);
    stampGain.connect(bus);
    stamp.start(when);
    stamp.stop(when + 0.42);

    // ---- the claim: root, fifth, and an octave for a heavy kill -----------
    // A bigger capture speaks lower and slower. Half an octave of drop across
    // the whole range keeps every rank inside the same motif rather than giving
    // the queen a different tune.
    const root = CLAIM_ROOT * Math.pow(2, -weight * 0.5);
    const gap = 0.08 + weight * 0.042;
    const notes: number[] = weight > 0.62 ? [1, 1.5, 2] : [1, 1.5];
    notes.forEach((ratio, index) => {
      const last = index === notes.length - 1;
      const at = when + index * gap;
      const span = last ? 0.42 + weight * 0.36 : gap * 1.6;
      const peak = level * (last ? 0.6 : 0.4);

      // Brass is a filter opening, not a waveform: the bite arrives a moment
      // after the note does.
      const bell = ctx.createBiquadFilter();
      bell.type = "lowpass";
      bell.Q.value = 0.9;
      bell.frequency.setValueAtTime(760, at);
      bell.frequency.exponentialRampToValueAtTime(2900, at + 0.05);
      bell.frequency.exponentialRampToValueAtTime(880, at + span);
      const voice = ctx.createGain();
      voice.gain.setValueAtTime(0.0001, at);
      voice.gain.exponentialRampToValueAtTime(peak, at + 0.022);
      voice.gain.exponentialRampToValueAtTime(0.0001, at + span);
      bell.connect(voice);
      voice.connect(bus);

      for (const detune of [0.996, 1.004]) {
        const brass = ctx.createOscillator();
        brass.type = "sawtooth";
        const pitch = root * ratio * detune;
        // Scooped into from under: what a horn does when it is blown hard.
        brass.frequency.setValueAtTime(pitch * 0.985, at);
        brass.frequency.exponentialRampToValueAtTime(pitch, at + 0.03);
        brass.connect(bell);
        brass.start(at);
        brass.stop(at + span + 0.06);
      }
    });

    // ---- the standard planted: metal left ringing over the square ---------
    for (const partial of [
      { ratio: 4.03, gain: 0.14, decay: 0.85 },
      { ratio: 6.11, gain: 0.07, decay: 0.6 },
    ]) {
      const ring = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ring.type = "sine";
      ring.frequency.value = root * partial.ratio;
      ringGain.gain.setValueAtTime(0.0001, when + 0.012);
      ringGain.gain.exponentialRampToValueAtTime(level * partial.gain, when + 0.03);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      ring.connect(ringGain);
      ringGain.connect(bus);
      ring.start(when + 0.012);
      ring.stop(when + partial.decay + 0.08);
    }

    this.duckBeds(0.76, 0.5 + weight * 0.45);
  }

  /** Panned input on the effects bus (Effects volume and switch apply), for the synthesised gunfire and claim voices. */
  private fxBus(pan: number, width: number): GainNode {
    const ctx = this.ctx;
    const master = this.sfxBus ?? this.master;
    if (!ctx || !master) throw new Error("mixer not started");
    const bus = ctx.createGain();
    bus.gain.value = 1;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan)) * width;
      bus.connect(panner);
      panner.connect(master);
    } else {
      bus.connect(master);
    }
    return bus;
  }

  blip(kind: "hover" | "press" | "deny" = "press"): void {
    if (!this.ctx || !this.master || this.silent) return;
    if (kind === "deny" && this.shot("deny", { gain: GAIN.deny })) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "deny" ? 700 : 2400;
    if (kind === "hover") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.03, now);
    } else if (kind === "press") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.09);
      gain.gain.setValueAtTime(0.08, now);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.16);
      gain.gain.setValueAtTime(0.09, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "hover" ? 0.09 : 0.22));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus ?? this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // ------------------------------------------------------------- the match's opening and the kingdoms' reveal
  //
  // What plays when is worked out in opening-cues.ts; the clips are web/src/assets/audio/opening (OPENING_CLIPS),
  // fetched only when an opening or the reveal is about to play. The opening's cues ride the effects bus with the
  // match's other sounds, so Master, Effects and the match's mute all apply. The reveal plays in the menu, where no
  // match is open and this mixer is muted, so it has a bus of its own into the limiter at Master times Effects, and it
  // never starts the match's beds.

  /**
   * An opening is about to play (MatchExperience, as it starts the game held): its clips are fetched, its cues worked
   * out from its beats, and the bell that game.start has just asked for waits for the first beat. The engine rings that
   * bell from a microtask game.start queues, so this must be called before the caller next awaits.
   */
  prepareOpening(beats: Parameters<typeof openingSoundSheet>[0]): void {
    this.endOpening(0, false);
    this.openingSheet = openingSoundSheet(beats);
    // The score's Theme waits for the opening's last beat (begin: the camera swinging round to the board).
    const begin = beats.findIndex((beat) => beat.id === "begin");
    this.themeBeat = beats.length === 0 ? null : begin >= 0 ? begin : beats.length - 1;
    this.heldBell = "waiting";
    this.heldSince = performance.now();
    if (this.graph()) for (const clip of OPENING_MATCH_CLIPS) void this.loadOpening(clip);
  }

  /** Beat `index` of the prepared opening is on screen: its cues start (each beat's only once), and the bell rings if
   * it was waiting for this beat. */
  openingCue(index: number): void {
    // The opening hands over to the board: the score's Theme comes in under it (scorePlayer.ts bell).
    if (index === this.themeBeat) { this.themeBeat = null; this.score.bell(); }
    const beat = this.openingSheet?.[index];
    const ctx = this.ctx;
    if (!beat || !ctx) return;
    this.openingSheet![index] = { bell: false, cues: [] };
    if (beat.bell) this.releaseBell();
    if (!this.sfxBus || this.silent) return;
    const at = ctx.currentTime;
    for (const cue of beat.cues) this.playOpeningCue(cue, at, this.sfxBus);
  }

  /**
   * The opening is over, played out or skipped: what is still sounding fades over `fadeSeconds` and what had not begun
   * never does. A bell still held rings now, as the match begins; once rung it is the match's, and rings on as at any
   * match's start.
   */
  stopOpening(fadeSeconds = 0.4): void {
    this.endOpening(fadeSeconds, true);
  }

  /**
   * A match that will open with an opening has begun to load (MatchExperience): the opening's clips are fetched and
   * decoded now, in the seconds the battlefield takes, so its first cue is not late. Fetched when the opening was
   * about to play, on a cold load, the arena's swell arrived a few tenths of a second after its picture.
   */
  preloadOpening(): void {
    if (this.graph()) for (const clip of OPENING_MATCH_CLIPS) void this.loadOpening(clip);
  }

  /** The reveal is on screen (NationsReveal): its clips are fetched now, while its pictures load. Shown still (reduced
   * motion), it has only its one soft cue to fetch. Resolves when they are in (or have failed), so the reveal can wait
   * for its sound as it waits for its pictures. */
  prepareReveal(options: { still?: boolean } = {}): Promise<void> {
    const ctx = this.graph();
    if (!ctx) return Promise.resolve();
    if (ctx.state === "suspended") void this.resume(ctx);
    this.presentation();
    const clips = options.still ? [revealSound("settle").clip] : OPENING_REVEAL_CLIPS;
    return Promise.allSettled(clips.map((clip) => this.loadOpening(clip))).then(() => undefined);
  }

  /** One of the reveal's cues (revealSound in opening-cues.ts), `delay` seconds from now; `index` is the kingdom. */
  revealCue(name: RevealCueName, options: { delay?: number; index?: number } = {}): void {
    const ctx = this.ctx, bus = this.presentation();
    if (!ctx || !bus) return;
    this.playOpeningCue(revealSound(name, options.index ?? 0, options.delay ?? 0), ctx.currentTime, bus);
  }

  /** The reveal is skipped or left: its sounds fade over `fadeSeconds`, and those still to come never start. */
  stopReveal(fadeSeconds = 0.3): void {
    this.endOpening(fadeSeconds, false);
  }

  private endOpening(fadeSeconds: number, ringHeld: boolean): void {
    // An opening ended (played out, skipped or left) before its last beat: the score's Theme comes in now.
    if (this.themeBeat !== null) { this.themeBeat = null; this.score.bell(); }
    this.openingEra += 1;
    this.openingSheet = null;
    if (ringHeld) this.releaseBell();
    else this.heldBell = null;
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime, fade = Math.max(0.01, fadeSeconds);
      for (const voice of this.openingVoices) {
        try {
          // One that had not begun is simply never started.
          if (voice.startsAt > now + 0.005) { voice.source.stop(); continue; }
          const param = voice.gain.gain;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(0.0001, now + fade);
          voice.source.stop(now + fade + 0.02);
        } catch { /* Already stopped. */ }
      }
    }
    this.openingVoices.clear();
  }

  private releaseBell(): void {
    const held = this.heldBell;
    this.heldBell = null;
    if (typeof held === "function") held();
  }

  /**
   * Starts one cue on `bus`, `cue.delay` seconds after `at` (on the audio clock), `now` being the clock as the caller
   * read it. A clip still on its way plays when it arrives if its moment has not gone: a swell or a rumble joins part
   * way in, anything else only if it is at most a few frames late, since a blow heard after its picture is worse than
   * none. (The clock is read once per beat, not per cue: it can move on in steps between two reads in one call, and
   * a beat's cues must keep their places against each other.)
   */
  private playOpeningCue(cue: OpeningCue, at: number, bus: AudioNode, now = at): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = this.openingBuffers.get(cue.clip);
    if (!buffer) {
      const era = this.openingEra;
      void this.loadOpening(cue.clip).then((loaded) => {
        if (loaded && era === this.openingEra && this.ctx) this.playOpeningCue(cue, at, bus, this.ctx.currentTime);
      });
      return;
    }
    const due = at + cue.delay, late = Math.max(0, now - due);
    let offset = cue.offset;
    if (late > OPENING_LATE_SECONDS) {
      if (!cue.join) return;
      offset += late * cue.rate;
    }
    if (offset >= buffer.duration - 0.05) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = cue.rate;
    const gain = ctx.createGain();
    gain.gain.value = cue.gain;
    source.connect(gain);
    let out: AudioNode = gain;
    if (cue.pan && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, cue.pan));
      gain.connect(panner);
      out = panner;
    }
    out.connect(bus);
    // The stone hall is the match's: only its cues are sent there (the reveal stays dry).
    if (cue.send && this.reverb && bus === this.sfxBus) {
      const send = ctx.createGain();
      send.gain.value = cue.send;
      out.connect(send);
      send.connect(this.reverb);
    }
    const startsAt = Math.max(now, due);
    source.start(startsAt, offset);
    const voice: OpeningVoice = { source, gain, startsAt };
    this.openingVoices.add(voice);
    source.onended = () => { this.openingVoices.delete(voice); };
  }

  private loadOpening(id: OpeningClipId): Promise<AudioBuffer | null> {
    const cached = this.openingLoads.get(id);
    if (cached) return cached;
    const job = (async () => {
      try {
        const response = await fetch(OPENING_CLIPS[id].url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          this.openingLoads.delete(id);
          return null;
        }
        const buffer = await ctx.decodeAudioData(raw);
        this.openingBuffers.set(id, buffer);
        return buffer;
      } catch (error) {
        console.warn(`[audio] could not load "${id}"`, error);
        this.openingLoads.delete(id);
        return null;
      }
    })();
    this.openingLoads.set(id, job);
    return job;
  }

  /**
   * The reveal's bus, straight into the limiter. The match mutes this mixer whenever no match is open, and the reveal
   * plays in the menu, so this bus does not take that mute: the menu's Master and Effects settings (and its Sound
   * Effects switch) are the player's say over it.
   */
  private presentation(): GainNode | null {
    if (this.presentBus) return this.presentBus;
    const ctx = this.ctx;
    if (!ctx || !this.limiter) return null;
    this.presentBus = ctx.createGain();
    this.presentBus.gain.value = this.presentLevel();
    this.presentBus.connect(this.limiter);
    return this.presentBus;
  }

  private presentLevel(): number {
    const p = this.preferences;
    const clamp = (value: number) => Math.max(0, Math.min(1, value / 100));
    return p.soundEffects ? clamp(p.volume) * clamp(p.sfxVolume) : 0;
  }

  // ------------------------------------------------------------- the pieces' barks, the hand, the gear

  /** The kingdom each side fields (the army ids): its pieces speak in its voices, and only its voices are fetched. */
  setKingdoms(kingdoms: Record<Faction, GambitKingdom>): void {
    if (kingdoms.w === this.kingdoms.w && kingdoms.b === this.kingdoms.b) return;
    this.kingdoms = { w: kingdoms.w, b: kingdoms.b };
    if (this.ctx) void this.warmAll();
  }

  kingdomOf(side: Faction): GambitKingdom {
    return this.kingdoms[side];
  }

  /** The mixer's clock in seconds (it runs on while the page is busy); null before the mixer starts. */
  now(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  /** A clip's length in seconds as the manifest has it (0 for a name it does not have), loaded or not. */
  clipLength(id: string): number {
    return (GAMBIT_CLIPS as Record<string, GambitClip | undefined>)[id]?.dur ?? 0;
  }

  /** Whether a clip has arrived and can sound now; asks for it if not. */
  clipReady(id: string): boolean {
    if (!(id in GAMBIT_CLIPS)) return false;
    if (this.buffers.has(id as GambitClipId)) return true;
    if (this.ctx) void this.load(id as GambitClipId);
    return false;
  }

  /**
   * A voice line other than a bark is scheduled from `from` to `to` (audio clock): it holds the floor, and a bark that
   * would sound over it is cut, its fade ending as the line begins (gambit-barks.ts barkYieldsTo).
   */
  private takeFloor(from: number, to: number, outranks = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.floor = this.floor.filter((voice) => voice.to > ctx.currentTime - 1).concat({ from, to });
    const bark = this.liveBark;
    if (outranks && bark && bark.endsAt > from) this.cutBark(Math.max(ctx.currentTime, from - BARK_FADE));
  }

  /** Whether a bark of `length` seconds may start `delay` seconds from now (gambit-barks.ts barkMaySound). */
  canBark(delay: number, length: number, gap = BARK_GAP): boolean {
    const ctx = this.ctx;
    if (!ctx || this.silent || ctx.state !== "running") return false;
    if (this.plea && ctx.currentTime < this.plea.startedAt + (this.plea.source.buffer?.duration ?? 0) / this.plea.rate) return false;
    return barkMaySound({ voices: this.floor, barkUntil: this.barkUntil }, ctx.currentTime + Math.max(0, delay), length, gap);
  }

  /**
   * A piece says one of its lines (shared/play/gambit-barks.ts chose it): from where it stands on screen, close and in
   * the voices' hall as a plea is, 4 dB under one. Returns how long it lasts, or null when the floor is not free or the
   * clip has not arrived, so nothing was said. Its subtitle names the side it speaks for.
   */
  bark(request: { clip: string; side: Faction; pan?: number; delay?: number; gap?: number }): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.clipReady(request.clip)) return null;
    const id = request.clip as GambitClipId;
    const length = this.clipLength(id);
    if (!this.canBark(request.delay ?? 0, length, request.gap)) return null;
    const shot = this.shot(id, {
      bus: "voice", gain: GAIN.bark, pan: (request.pan ?? 0) * 0.7, send: 0.14, delay: request.delay, duck: 0.75, side: request.side,
    });
    if (!shot) return null;
    const endsAt = shot.startedAt + length;
    this.liveBark = { ...shot, endsAt };
    this.barkUntil = endsAt;
    // A soul still leaving the board draws back under the words, and comes up again after them.
    const soul = this.liveSoul;
    if (soul && soul.endsAt > shot.startedAt) {
      const param = soul.gain.gain, base = param.value;
      param.cancelScheduledValues(ctx.currentTime);
      param.setValueAtTime(base, Math.max(ctx.currentTime, shot.startedAt - 0.05));
      param.linearRampToValueAtTime(base * SOUL_UNDER_WORDS, shot.startedAt + 0.1);
      param.setValueAtTime(base * SOUL_UNDER_WORDS, Math.max(shot.startedAt + 0.1, endsAt - 0.1));
      param.linearRampToValueAtTime(base, endsAt + 0.2);
    }
    shot.source.onended = () => { if (this.liveBark?.source === shot.source) this.liveBark = null; };
    return length;
  }

  /** Fades the sounding bark out at `at` (audio clock), as a voice that outranks it begins; its subtitle goes with it. */
  private cutBark(at: number): void {
    const ctx = this.ctx;
    const bark = this.liveBark;
    if (!ctx || !bark) return;
    this.liveBark = null;
    this.barkUntil = Math.min(this.barkUntil, at + BARK_FADE);
    const param = bark.gain.gain;
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(0.0001, at + BARK_FADE);
    try { bark.source.stop(at + BARK_FADE + 0.02); } catch { /* Already stopped. */ }
    const line = bark.line;
    if (line === undefined) return;
    const wait = Math.max(0, at - ctx.currentTime) * 1000;
    if (wait < 5) this.emitLine({ type: "cut", token: line });
    else setTimeout(() => this.emitLine({ type: "cut", token: line }), wait);
  }

  /** Undo, a new game or leaving: any bark stops now with a short fade (never a click), and its subtitle goes. */
  silenceBarks(): void {
    if (this.ctx) this.cutBark(this.ctx.currentTime);
  }

  /** One take of a family from its own shuffle bag (the hand, the gear, the drops): never the same twice running. */
  private handTake(key: string, clips: readonly string[]): GambitClipId {
    const state = (this.handMemory[key] ??= { bag: [] });
    return drawFromBag(clips, state, Math.random) as GambitClipId;
  }

  /**
   * The unseen hand: a soft pull as it takes hold of a piece, a release as it sets it down, where the piece is. The
   * scene asks only on a board with voices, and for a figure the camera can see.
   */
  trance(kind: "pull" | "release", options: { pan?: number; volume?: number; delay?: number } = {}): boolean {
    if (!this.ctx || this.silent) return false;
    return this.shot(this.handTake(`trance.${kind}`, tranceClips(kind)), {
      gain: GAIN.trance * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.6, delay: options.delay, send: 0.2, rate: 0.96 + Math.random() * 0.08,
    }) !== null;
  }

  /** What a figure wears, heard once as it sets off (gambit-sound.ts gearOf): under its own footfalls. */
  gear(kind: GearKind, options: { pan?: number; volume?: number; delay?: number } = {}): boolean {
    if (!this.ctx || this.silent) return false;
    return this.shot(this.handTake(`gear.${kind}`, gearClips(kind)), {
      gain: GAIN.gear * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.6, delay: options.delay, rate: 0.96 + Math.random() * 0.08,
    }) !== null;
  }

  /**
   * At the end of a game, a line from an army: `despair` from the beaten side, `victory` from the victors
   * (gambit-sound.ts downfallClips), one from each kingdom's bag. Through the same floor as a bark, so it never speaks
   * over the king's last words or another voice. `voice` asks for one voice ("sun_q"); returns the line's length, or
   * null when nothing was said.
   */
  armyLine(side: Faction, event: "despair" | "victory", options: { voice?: string; pan?: number; delay?: number } = {}): number | null {
    const kingdom = this.kingdoms[side];
    const clips = Object.keys(GAMBIT_CLIPS).filter((id) => id.startsWith(`${options.voice ?? kingdom}_`) && id.includes(`_${event}_`));
    if (clips.length === 0) return null;
    const state = (this.handMemory[`${kingdom}.${event}.${options.voice ?? "any"}`] ??= { bag: [] });
    const clip = drawFromBag(clips.sort(), state, Math.random);
    return this.bark({ clip, side, pan: options.pan, delay: options.delay, gap: 0.3 });
  }

  /** A weapon falling on stone as a beaten army lets go (gambit-sound.ts dropClips): `kind` is what falls. */
  weaponDrop(kind: DropKind, options: { pan?: number; volume?: number; delay?: number } = {}): boolean {
    if (!this.ctx || this.silent) return false;
    return this.shot(this.handTake(`drop.${kind}`, dropClips(kind)), {
      gain: GAIN.drop * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.55, delay: options.delay, send: 0.25, rate: 0.96 + Math.random() * 0.08,
    }) !== null;
  }

  /** An armoured knee coming down on stone. */
  kneel(options: { pan?: number; volume?: number; delay?: number } = {}): boolean {
    if (!this.ctx || this.silent) return false;
    return this.shot(this.handTake("kneel", kneelClips()), {
      gain: GAIN.drop * (options.volume ?? 1), pan: (options.pan ?? 0) * 0.55, delay: options.delay, send: 0.25, rate: 0.97 + Math.random() * 0.06,
    }) !== null;
  }

  // ------------------------------------------------------------- the match score (web/src/audio/scorePlayer.ts)

  /**
   * The adaptive score: the board's published state (a GameSnapshot fits ScoreBoard) goes to its director
   * (shared/play/match-score.ts), which picks the cue; the player crossfades it in on its bars, on the beds' bus, so it
   * ducks under every voice line (duckBeds) and follows the Music setting with everything else there. Its closing cue
   * plays on the music bus, as the old closing cues did (scorePlayer.ts says why).
   */
  private readonly score = new ScorePlayer({ context: () => this.ctx, output: () => this.bedBus, voices: () => this.voiceBus, music: () => this.musicBus });

  /** A replay holds the board's sound silent (its scene's time stopped), or not. */
  private boardHeld = false;
  /** The replay on stage has been played: until then it opens silent. */
  private replayPlayed = false;

  /**
   * A replay's transport (main game/src/showcase/ReplayStage.tsx): heard while it plays. Until it is first played the
   * mixer stays muted, as a replay opens silent. Held after that (paused, or seeked while paused), the board's sound is
   * gated as muting did (a move held in flight keeps its scene still, so its sounds must not run on), and the score
   * draws back as for a paused exhibition instead of stopping; played again, both come back.
   */
  setReplayHeard(heard: boolean): void {
    if (heard) {
      this.replayPlayed = true;
      if (this.muted) this.setMuted(false);
      this.holdBoard(false);
      this.score.setHeld(false, "replay");
      return;
    }
    if (!this.replayPlayed) {
      if (!this.muted) this.setMuted(true);
      return;
    }
    this.holdBoard(true);
    this.score.setHeld(true, "replay");
  }

  private holdBoard(held: boolean): void {
    if (this.boardHeld === held) return;
    this.boardHeld = held;
    if (held) {
      this.clearWhisper();
      this.silenceBarks();
      this.emitLine({ type: "clear" });
    }
    this.applyPreferences(0.35);
  }

  /** The beat of the prepared opening on which the score's Theme comes in; null when no opening is playing. */
  private themeBeat: number | null = null;

  /** The match is held by its pause menu (SceneEngine.setHeld): the score draws back and waits, as for a paused exhibition. */
  holdMatch(held: boolean): void {
    this.score.setHeld(held, "match");
  }

  /** The match's state, as published: the score answers it (sceneEngine calls this with every snapshot). */
  matchState(board: ScoreBoard): void {
    if (this.ctx) this.score.update(board);
  }

  /** What the score is playing and why (for the verification scripts and films). */
  get scoreState(): ScorePlayer["state"] {
    return this.score.state;
  }

  /**
   * The closing cue: the score's own. Where a downfall is staged (scene/downfall: a checkmate, a resignation or a time
   * loss), it begins as the downfall's results are shown (`downfall`, seconds from now); otherwise on the beaten King's
   * last word (`lastWord.at`, context time; his clip ends at `lastWord.end`, and the cue does not step aside for him) or,
   * for any other end, at once. The old closing cue only if the score's cannot play.
   */
  private closingCue(sting: "sting_win" | "sting_loss" | "sting_draw", tolled: boolean, lastWord: { at: number; end: number } | null, downfall?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = downfall !== undefined ? ctx.currentTime + Math.max(0, downfall) : lastWord?.at ?? ctx.currentTime + (tolled ? 6.2 : SCORE_END_LEAD);
    const cue: ScoreSting = sting === "sting_win" ? "victory" : sting === "sting_loss" ? "defeat" : "draw";
    if (this.score.close(cue, at, lastWord?.end ?? 0)) return;
    this.shot(sting, { bus: "music", gain: STING_GAIN, delay: Math.max(0, at - ctx.currentTime) });
  }

  // ------------------------------------------------------------- plumbing

  private connectPanned(node: AudioNode, pan: number): void {
    const ctx = this.ctx;
    const out = this.sfxBus ?? this.master;
    if (!ctx || !out) return;
    if (typeof ctx.createStereoPanner === "function" && pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(panner);
      panner.connect(out);
    } else {
      node.connect(out);
    }
  }

  /** A stone hall: decorrelated stereo noise decaying over `seconds`, darkening as it dies. */
  private hallImpulse(seconds: number, shape: { predelay: number; open: number; close: number; air: number } = { predelay: 0.014, open: 0.75, close: 0.15, air: 0.4 }): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("mixer not started");
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    const predelay = Math.floor(ctx.sampleRate * shape.predelay);
    for (let c = 0; c < 2; c += 1) {
      const data = impulse.getChannelData(c);
      let low = 0;
      for (let i = predelay; i < length; i += 1) {
        const t = i / length;
        const white = (Math.random() * 2 - 1) * Math.exp(-6.9 * t);
        // A one-pole low-pass that closes as the tail goes on: stone eats the highs first.
        const k = shape.open - (shape.open - shape.close) * t;
        low += k * (white - low);
        data[i] = low * 0.6 + white * shape.air * (1 - t);
      }
    }
    return impulse;
  }

  /**
   * Decaying white noise of a given length.
   *
   * @param falloff envelope exponent — 1 fades evenly, higher is a sharper burst
   */
  private noiseBuffer(seconds: number, falloff: number): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("mixer not started");
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, falloff);
    }
    return buffer;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.score.setMuted(muted);
    // Leaving a replay mutes the mixer: its hold on the board's sound goes with it, so no match after it is held.
    if (muted) { this.boardHeld = false; this.replayPlayed = false; }
    if (muted) {
      this.clearWhisper();
      this.silenceBarks();
      this.emitLine({ type: "clear" });
      // The match is closing (or its sound is off): an opening still playing ends with it, and a bell it holds is
      // never rung.
      this.endOpening(0.1, false);
    }
    this.applyPreferences(0.35);
    // Back on the menu the mixer's loops, reverbs and limiter would keep the audio thread busy for nothing: once the
    // fade has run, the context is suspended, and it resumes when a match (or a replay) unmutes it (M-11). Nothing is
    // scheduled meanwhile, since every sound checks `muted` first.
    if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    const ctx = this.ctx;
    if (!ctx) return;
    if (muted) {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this.muted && this.ctx === ctx && ctx.state === "running") void ctx.suspend().catch(() => undefined);
      }, 700);
    } else if (ctx.state === "suspended") {
      void this.resume(ctx);
    }
    // Long out of a match, the clips decoded for it are let go (M-11); the next match fetches them again.
    if (this.releaseTimer !== null) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    if (muted) this.releaseTimer = setTimeout(() => { this.releaseTimer = null; if (this.muted) this.releaseIdleClips(); }, IDLE_RELEASE_MS);
    // Heard again: whatever was let go meanwhile comes back down (nothing, if nothing was).
    else if (this.started) void this.warmAll();
  }

  /**
   * Lets go of the decoded clips while no match is being played (M-11): the voices, the effects, the gunfire and the
   * opening's sounds, some hundred megabytes of decoded sound in all. The beds stay (they are looping on the graph,
   * and the next match opens on them); everything else is fetched and decoded again as the next match warms up
   * (unlock -> warmAll), or on first use.
   */
  releaseIdleClips(): void {
    const kept = new Set<GambitClipId>([...Object.values(BED_CLIPS), "bed_souls"]);
    for (const id of [...this.buffers.keys()]) if (!kept.has(id)) { this.buffers.delete(id); this.loads.delete(id); }
    this.shots.clear(); this.shotLoads.clear();
    if (!this.openingSheet && this.openingVoices.size === 0) { this.openingBuffers.clear(); this.openingLoads.clear(); }
  }

  /** How many clips are decoded and held, for a check of the idle release. */
  get heldClipCount(): number { return this.buffers.size + this.shots.size + this.openingBuffers.size; }

  /** Resumes the context, noting that a resume of ours is under way (see `silent`). */
  private resume(ctx: AudioContext): Promise<void> {
    this.resuming += 1;
    return ctx.resume().catch(() => undefined).finally(() => { this.resuming -= 1; });
  }

  /**
   * Nothing is scheduled while the mixer is muted, or while its context is suspended with no resume of ours under way
   * (before it is first unlocked, or stopped by the browser): a suspended context's clock stands still, so every sound
   * scheduled meanwhile played at once when it woke (M-22). A sound asked for while our own resume is under way is
   * kept: it starts as the context does (the opening bell as a match is unmuted).
   */
  private get silent(): boolean {
    return this.muted || !this.ctx || (this.ctx.state !== "running" && this.resuming === 0);
  }

  dispose(): void {
    if (this.suspendTimer !== null) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    if (this.releaseTimer !== null) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    this.score.dispose();
    this.endOpening(0, false);
    this.presentBus = null;
    this.limiter = null;
    this.openingBuffers.clear();
    this.openingLoads.clear();
    this.clearWhisper();
    this.emitLine({ type: "clear" });
    for (const bed of this.beds.values()) bed.source?.stop();
    this.souls?.source?.stop();
    this.souls = null;
    this.beds.clear();
    this.buffers.clear();
    this.loads.clear();
    this.shots.clear();
    this.shotLoads.clear();
    this.dying = 0;
    this.plea = null;
    this.liveBark = null;
    this.floor = [];
    this.barkUntil = -Infinity;
    this.started = false;
    this.loading = null;
    this.bedBus = null;
    this.reverb = null;
    this.woundHall = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioManager();
