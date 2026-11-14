/**
 * What is heard over the match's opening and over the four kingdoms' reveal, as plain data: which clip starts when,
 * how loud, how fast and where. The mixer plays it (audioManager.ts, "the match's opening and the kingdoms' reveal");
 * the clips are in web/src/assets/audio/opening, each cut from the creator's own Stable Audio bank (PROVENANCE.md
 * there says from what, and how).
 *
 * The opening's cues are keyed to each beat's own start and length (shared/play/match-opening.ts) and never to fixed
 * times, so a beat made longer or shorter keeps its sound on its picture. The reveal's follow NationsReveal.css.
 */
import type { MatchOpeningBeat } from "../../../shared/play/match-opening";
import { OPENING_CLIPS } from "./opening-assets";

export type OpeningClipId =
  | "open_arena" | "open_muster" | "open_crown" | "open_versus" | "open_draw" | "open_begin"
  | "reveal_crown" | "reveal_burst" | "reveal_flight" | "reveal_land" | "reveal_flag" | "reveal_settle";

/** One clip to start. */
export interface OpeningCue {
  clip: OpeningClipId;
  /**
   * Seconds after its beat begins (the reveal: after the call). Below zero only for the reveal, when the mixer arrives
   * after the timeline has begun: its moment has passed by that much.
   */
  delay: number;
  /** Seconds into the clip to start from, in the clip's own time. */
  offset: number;
  gain: number;
  /** Playback rate: speed and pitch together. */
  rate: number;
  /** -1 hard left … 1 hard right. */
  pan: number;
  /** Level sent to the stone hall (the match's cues only; the reveal is dry). */
  send: number;
  /** A swell or a rumble may join late, part way in; a blow that has missed its moment is better not heard. */
  join: boolean;
}

/** What one beat of the opening does as it begins. */
export interface OpeningBeatSound {
  /** The bell that opens the game rings here: it waits for the opening's first picture. */
  bell: boolean;
  cues: OpeningCue[];
}

/**
 * Where in each finished clip the moment it is timed by falls, as measured on the encoded files (the build prints
 * them; see PROVENANCE.md).
 */
export const CLIP_MARKS = {
  /** open_muster: the rumble's crest, the moment it is let go. */
  musterCrest: 2.15,
  /** open_draw: the blade ringing out. */
  drawPeak: 0.41,
  /** open_begin: the whoosh at full rush. */
  beginPeak: 0.55,
} as const;

/**
 * Levels on the effects bus, against the match's own families (start_toll 0.8, whoosh 0.7, slam 0.6). The files are
 * levelled to R128 targets (swells -21 LUFS, whooshes -22, the boom -17; the King and Queen's blow is all spike and
 * stops at -22.7, under its -1.3 dBTP ceiling), so these put the arena's swell and each army's rumble 7 to 8 dB under
 * the bell, the blows and the boom 2 to 3 dB under it, and the whooshes level with the game's own.
 */
const GAIN = { arena: 0.5, muster: 0.5, crown: 0.95, versus: 0.6, draw: 0.7, begin: 0.7 } as const;
/** Black's army is heard a little lower and slower than White's, so the two musters are not the same sound twice. */
const BLACK_RATE = 0.94;
/** Where the muster's blow is timed when a shot does not say when its army stands (MatchOpeningTimeline's default). */
const DEFAULT_MUSTER_END = 0.9;
/**
 * The board's whisper after the bell ("It begins again", beginGambit: 2.2 s after the bell, about 1.5 s long), in
 * seconds from the bell. The blade and the whoosh share its band (2 to 8 kHz), so either one that sounds while it is
 * spoken is turned down to UNDER_WORDS of its level; the rumbles sit far under it and keep theirs. Only a rematch's
 * short opening meets it, with its whoosh.
 */
const WHISPER = { from: 2.2, to: 3.7 } as const;
const UNDER_WORDS = 0.55;
const BRIGHT: ReadonlySet<OpeningClipId> = new Set<OpeningClipId>(["open_draw", "open_begin"]);

type BeatLike = Pick<MatchOpeningBeat, "id"> & { shot: { seconds: number; muster?: { end?: number } } };

const cue = (clip: OpeningClipId, delay: number, gain: number, more: Partial<OpeningCue> = {}): OpeningCue =>
  ({ clip, delay, offset: 0, gain, rate: 1, pan: 0, send: 0, join: false, ...more });

/** Starts a clip so that the moment `mark` seconds into it falls `at` seconds into its beat: as late as that needs, or
 * at once and part way in when the beat is too short to wait for its lead-in. */
const timedTo = (at: number, mark: number, rate: number) => {
  const lead = mark / rate;
  return at >= lead ? { delay: at - lead, offset: 0 } : { delay: 0, offset: (lead - at) * rate };
};

/**
 * The opening's sound, beat by beat:
 *
 *   arena    the bell that opens the game, held until now, over a soft low swell
 *   white    the army's rumble rising as it forms, cresting into one heavy blow as its King and Queen stand whole
 *   black    the same, a little lower
 *   versus   a deep boom on the cut, a blade drawn into it (started in the beat before, so that it rings on the cut)
 *   begin    a whoosh as the camera swings round, at full rush half way through the swing
 *
 * A rematch's short opening is versus and begin; the bell rings on its versus, in place of the boom.
 */
export function openingSoundSheet(beats: readonly BeatLike[]): OpeningBeatSound[] {
  const sheet = beats.map((): OpeningBeatSound => ({ bell: false, cues: [] }));
  if (sheet.length > 0) sheet[0]!.bell = true;
  beats.forEach((beat, index) => {
    const here = sheet[index]!, seconds = beat.shot.seconds;
    if (beat.id === "arena") here.cues.push(cue("open_arena", 0, GAIN.arena, { join: true }));
    else if (beat.id === "white" || beat.id === "black") {
      const rate = beat.id === "black" ? BLACK_RATE : 1;
      // The King and Queen stand whole when the army's wave ends (musterReveal: they are the last to form).
      const stand = Math.min(seconds, Math.max(0, (beat.shot.muster?.end ?? DEFAULT_MUSTER_END) * seconds));
      here.cues.push(cue("open_muster", 0, GAIN.muster, { ...timedTo(stand, CLIP_MARKS.musterCrest, rate), rate, join: true }));
      here.cues.push(cue("open_crown", stand, GAIN.crown, { rate, send: 0.25 }));
    } else if (beat.id === "versus") {
      if (!here.bell) here.cues.push(cue("open_versus", 0, GAIN.versus, { send: 0.3 }));
      const before = index > 0 ? beats[index - 1]! : null;
      if (before && before.shot.seconds > CLIP_MARKS.drawPeak) {
        sheet[index - 1]!.cues.push(cue("open_draw", before.shot.seconds - CLIP_MARKS.drawPeak, GAIN.draw, { send: 0.15 }));
      } else here.cues.push(cue("open_draw", 0, GAIN.draw, { send: 0.15 }));
    } else if (beat.id === "begin") {
      here.cues.push(cue("open_begin", 0, GAIN.begin, { ...timedTo(seconds / 2, CLIP_MARKS.beginPeak, 1), join: true }));
    }
  });
  // The whisper is timed from the bell, which rings as the first beat begins.
  let start = 0;
  sheet.forEach((beat, index) => {
    for (const one of beat.cues) {
      if (!BRIGHT.has(one.clip)) continue;
      const from = start + one.delay, to = from + (OPENING_CLIPS[one.clip].dur - one.offset) / one.rate;
      if (from < WHISPER.to && to > WHISPER.from) one.gain *= UNDER_WORDS;
    }
    beat.cues.sort((a, b) => a.delay - b.delay);
    start += beats[index]!.shot.seconds;
  });
  return sheet;
}

/** NationsReveal.css's timeline (its --nr-burst, --nr-flight, the 0.11 s between pieces, the title's delay). */
export const REVEAL_TIMELINE = { burst: 1.45, flight: 1.05, stagger: 0.11, title: 3.2, kingdoms: 4 } as const;
export type RevealTimeline = { readonly [K in keyof typeof REVEAL_TIMELINE]: number };

export type RevealCueName = "crown" | "burst" | "flight" | "land" | "flag" | "title" | "settle";
export interface RevealMoment {
  name: RevealCueName;
  /** Seconds from the timeline's start. */
  at: number;
  /** The kingdom, left to right, for a landing or a flag. */
  index?: number;
}

/**
 * The reveal's sound on its own timeline:
 *
 *   0.00     the crown: a swell rising under gold cracking (its sharpest crack as the crown breaks open, 0.93 s)
 *   1.39     the burst: the crown shattering, its first transient on the flash
 *   1.45     the pieces in flight: a whoosh over their arc and gold dust glittering
 *   2.50 …   each piece landing on its pedestal, in turn, 0.11 s apart, where it is on screen
 *   2.76 …   each flag catching the air as it unfurls (0.26 s after its piece lands)
 *   3.20     the title: the boom, far softer than the versus has it
 *
 * A skip, and a reveal shown still (reduced motion), have one soft cue instead: "settle".
 */
export function revealSoundSheet(t: RevealTimeline = REVEAL_TIMELINE): RevealMoment[] {
  const moments: RevealMoment[] = [
    { name: "crown", at: 0 },
    // The flash starts 0.06 s before the burst; the shatter's transient is 0.02 s into its clip.
    { name: "burst", at: Math.max(0, t.burst - 0.06) },
    { name: "flight", at: t.burst },
    { name: "title", at: t.title },
  ];
  for (let index = 0; index < t.kingdoms; index++) {
    const land = t.burst + t.flight + index * t.stagger;
    moments.push({ name: "land", at: land, index }, { name: "flag", at: land + 0.26, index });
  }
  return moments.sort((a, b) => a.at - b.at);
}

/** Where each kingdom stands on screen, left to right (the reveal's four columns). */
const REVEAL_PAN = [-0.55, -0.18, 0.18, 0.55] as const;
/** The four landings rise a step each, so the row is heard to complete; the flags vary a little, without a tune. */
const LAND_RATE = [0.92, 0.98, 1.04, 1.1] as const;
const FLAG_RATE = [1, 1.06, 0.95, 1.1] as const;
/** The reveal's levels on its own bus (Master and Effects apply; nothing else plays under it). */
const REVEAL_GAIN = { crown: 0.55, burst: 0.6, flight: 0.55, land: 0.42, flag: 0.45, title: 0.35, settle: 0.42 } as const;
const REVEAL_CLIP: Record<RevealCueName, OpeningClipId> = {
  crown: "reveal_crown", burst: "reveal_burst", flight: "reveal_flight", land: "reveal_land", flag: "reveal_flag",
  title: "open_versus", settle: "reveal_settle",
};

/**
 * One cue of the reveal, `delay` seconds from now. A negative delay means its moment has already come (the mixer
 * arrived after the timeline began): the mixer lets a swell join part way in and leaves out a blow that late.
 */
export function revealSound(name: RevealCueName, index = 0, delay = 0): OpeningCue {
  const slot = Math.max(0, Math.min(REVEAL_PAN.length - 1, Math.round(index)));
  const placed = name === "land" || name === "flag";
  const rate = name === "land" ? LAND_RATE[slot]! : name === "flag" ? FLAG_RATE[slot]! : 1;
  return cue(REVEAL_CLIP[name], delay, REVEAL_GAIN[name], { rate, pan: placed ? REVEAL_PAN[slot]! : 0, join: name === "crown" || name === "flight" });
}

/** Every clip the opening can play, and every clip the reveal can: each side fetches only its own. */
export const OPENING_MATCH_CLIPS: readonly OpeningClipId[] = ["open_arena", "open_muster", "open_crown", "open_versus", "open_draw", "open_begin"];
export const OPENING_REVEAL_CLIPS: readonly OpeningClipId[] = ["reveal_crown", "reveal_burst", "reveal_flight", "reveal_land", "reveal_flag", "reveal_settle", "open_versus"];
