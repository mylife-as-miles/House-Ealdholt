import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildMatchOpening } from "../../../shared/play/match-opening";
import { OPENING_CLIPS } from "./opening-assets";
import {
  CLIP_MARKS, OPENING_MATCH_CLIPS, OPENING_REVEAL_CLIPS, openingSoundSheet, REVEAL_TIMELINE, revealSound, revealSoundSheet,
  type OpeningClipId, type RevealCueName,
} from "./opening-cues";

const duel = { mode: "local-duel", setting: "scene-01", playerColor: "w", armies: { w: "ivory", b: "sun" } } as const;
/** Each beat's clips, by name (their order within a beat follows the beat's own timing, which the camera may change). */
const clips = (sheet: ReturnType<typeof openingSoundSheet>) => sheet.map((beat) => beat.cues.map((cue) => cue.clip).sort());
/** When the moment `mark` seconds into a clip falls, in seconds from its beat's start. */
const landsAt = (cue: { delay: number; offset: number; rate: number }, mark: number) => cue.delay + (mark - cue.offset) / cue.rate;

describe("the match opening's sound", () => {
  it("gives each beat its own cues, and the bell to the first picture only", () => {
    const plan = buildMatchOpening(duel, "full");
    const sheet = openingSoundSheet(plan.beats);
    expect(sheet.map((beat) => beat.bell)).toEqual([true, false, false, false, false]);
    expect(clips(sheet)).toEqual([
      ["open_arena"],
      ["open_crown", "open_muster"],
      // The blade is drawn at the end of Black's beat, so that it rings on the cut to the versus.
      ["open_crown", "open_draw", "open_muster"],
      ["open_versus"],
      ["open_begin"],
    ]);
  });

  it("strikes each army's blow as its King and Queen stand whole, its rumble cresting into it", () => {
    const plan = buildMatchOpening(duel, "full");
    const sheet = openingSoundSheet(plan.beats);
    for (const index of [1, 2]) {
      const beat = plan.beats[index]!, stand = beat.shot.muster!.end! * beat.shot.seconds;
      const blow = sheet[index]!.cues.find((cue) => cue.clip === "open_crown")!;
      const rumble = sheet[index]!.cues.find((cue) => cue.clip === "open_muster")!;
      expect(blow.delay).toBeCloseTo(stand, 6);
      expect(landsAt(rumble, CLIP_MARKS.musterCrest)).toBeCloseTo(stand, 6);
    }
    // Black's army is heard a little lower than White's.
    expect(sheet[2]!.cues.find((cue) => cue.clip === "open_crown")!.rate).toBeLessThan(sheet[1]!.cues.find((cue) => cue.clip === "open_crown")!.rate);
  });

  it("rings the drawn blade on the versus cut and puts the whoosh's rush half way through the swing", () => {
    const plan = buildMatchOpening(duel, "full");
    const sheet = openingSoundSheet(plan.beats);
    const draw = sheet[2]!.cues.find((cue) => cue.clip === "open_draw")!;
    expect(plan.beats[2]!.at + landsAt(draw, CLIP_MARKS.drawPeak)).toBeCloseTo(plan.beats[3]!.at, 6);
    const whoosh = sheet[4]!.cues[0]!;
    expect(landsAt(whoosh, CLIP_MARKS.beginPeak)).toBeCloseTo(plan.beats[4]!.shot.seconds / 2, 6);
  });

  it("follows the beats when they are retimed", () => {
    const plan = buildMatchOpening(duel, "full");
    const slower = plan.beats.map((beat) => beat.id === "white" ? { ...beat, shot: { ...beat.shot, seconds: 3.4, muster: { ...beat.shot.muster!, end: 0.8 } } }
      : beat.id === "begin" ? { ...beat, shot: { ...beat.shot, seconds: 2.4 } } : beat);
    const sheet = openingSoundSheet(slower);
    const blow = sheet[1]!.cues.find((cue) => cue.clip === "open_crown")!, rumble = sheet[1]!.cues.find((cue) => cue.clip === "open_muster")!;
    expect(blow.delay).toBeCloseTo(3.4 * 0.8, 6);
    expect(landsAt(rumble, CLIP_MARKS.musterCrest)).toBeCloseTo(3.4 * 0.8, 6);
    expect(landsAt(sheet[4]!.cues[0]!, CLIP_MARKS.beginPeak)).toBeCloseTo(1.2, 6);
    // A beat too short for a cue's lead-in starts it at once, part way in, and still lands its moment on time.
    const brisk = plan.beats.map((beat) => beat.id === "black" ? { ...beat, shot: { ...beat.shot, seconds: 1.6 } } : beat);
    const quick = openingSoundSheet(brisk)[2]!.cues.find((cue) => cue.clip === "open_muster")!;
    expect(quick.delay).toBe(0);
    expect(quick.offset).toBeGreaterThan(0);
    expect(landsAt(quick, CLIP_MARKS.musterCrest)).toBeCloseTo(1.6 * brisk[2]!.shot.muster!.end!, 6);
  });

  it("keeps every cue inside its own beat, in order, at a sane level", () => {
    for (const cut of ["full", "short"] as const) {
      const plan = buildMatchOpening(duel, cut);
      openingSoundSheet(plan.beats).forEach((beat, index) => {
        let last = 0;
        for (const cue of beat.cues) {
          expect(cue.delay).toBeGreaterThanOrEqual(last);
          expect(cue.delay).toBeLessThan(plan.beats[index]!.shot.seconds);
          expect(cue.offset).toBeGreaterThanOrEqual(0);
          expect(cue.offset).toBeLessThan(OPENING_CLIPS[cue.clip].dur);
          expect(cue.gain).toBeGreaterThan(0);
          expect(cue.gain).toBeLessThanOrEqual(1);
          expect(OPENING_MATCH_CLIPS).toContain(cue.clip);
          last = cue.delay;
        }
      });
    }
  });

  it("plays a rematch's short opening on the bell, softening the whoosh under the board's whisper", () => {
    const plan = buildMatchOpening(duel, "short");
    const sheet = openingSoundSheet(plan.beats);
    expect(sheet.map((beat) => beat.bell)).toEqual([true, false]);
    // The bell takes the boom's place; with no beat before it, the blade is drawn on the cut itself.
    expect(clips(sheet)).toEqual([["open_draw"], ["open_begin"]]);
    expect(sheet[0]!.cues[0]!.delay).toBe(0);
    const full = openingSoundSheet(buildMatchOpening(duel, "full").beats);
    expect(sheet[1]!.cues[0]!.gain).toBeLessThan(full[4]!.cues[0]!.gain);
    expect(full[2]!.cues.find((cue) => cue.clip === "open_draw")!.gain).toBe(sheet[0]!.cues[0]!.gain);
  });

  it("has nothing to play for no beats", () => {
    expect(openingSoundSheet([])).toEqual([]);
  });
});

describe("the kingdoms' reveal's sound", () => {
  it("follows NationsReveal.css: the crack, the burst on its flash, the flight, each landing and flag in turn, the title", () => {
    const moments = revealSoundSheet();
    const at = (name: RevealCueName, index?: number) => moments.find((moment) => moment.name === name && moment.index === index)!.at;
    expect(at("crown")).toBe(0);
    expect(at("burst")).toBeCloseTo(REVEAL_TIMELINE.burst - 0.06, 6);
    expect(at("flight")).toBe(REVEAL_TIMELINE.burst);
    for (let index = 0; index < 4; index++) {
      expect(at("land", index)).toBeCloseTo(2.5 + index * 0.11, 6);
      expect(at("flag", index)).toBeGreaterThan(at("land", index));
    }
    expect(at("title")).toBe(3.2);
    // Everything has begun before Continue is offered (REVEALED_AT, 4.2 s), and nothing is the skip's own cue.
    expect(Math.max(...moments.map((moment) => moment.at))).toBeLessThan(4.2);
    expect(moments.some((moment) => moment.name === "settle")).toBe(false);
    expect(moments.map((moment) => moment.at)).toEqual([...moments.map((moment) => moment.at)].sort((a, b) => a - b));
  });

  it("places each kingdom's landing and flag where it stands, left to right", () => {
    for (const name of ["land", "flag"] as const) {
      const pans = [0, 1, 2, 3].map((index) => revealSound(name, index).pan);
      expect(pans).toEqual([...pans].sort((a, b) => a - b));
      expect(pans[0]).toBeLessThan(0);
      expect(pans[3]).toBeGreaterThan(0);
    }
    expect(revealSound("burst").pan).toBe(0);
    // The landings rise a step each.
    const rates = [0, 1, 2, 3].map((index) => revealSound("land", index).rate);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
  });

  it("lets a swell join late and leaves a late blow to the mixer to drop", () => {
    expect(revealSound("crown", 0, -0.3)).toMatchObject({ delay: -0.3, join: true });
    expect(revealSound("land", 2, -0.3)).toMatchObject({ delay: -0.3, join: false });
    expect(revealSound("settle")).toMatchObject({ clip: "reveal_settle", delay: 0, offset: 0 });
  });
});

describe("the opening's clips", () => {
  it("are bundled, compact, and each one the reveal or the opening plays", () => {
    const used = new Set<OpeningClipId>([...OPENING_MATCH_CLIPS, ...OPENING_REVEAL_CLIPS]);
    let bytes = 0;
    for (const [id, clip] of Object.entries(OPENING_CLIPS) as [OpeningClipId, { url: string; dur: number }][]) {
      expect(used.has(id)).toBe(true);
      const file = fileURLToPath(new URL(`../assets/audio/opening/${id}.mp3`, import.meta.url));
      expect(existsSync(file)).toBe(true);
      bytes += statSync(file).size;
      expect(clip.dur).toBeGreaterThan(0.3);
      expect(clip.dur).toBeLessThan(3);
    }
    expect(bytes).toBeLessThan(300_000);
  });
});
