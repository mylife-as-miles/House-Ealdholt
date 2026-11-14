// The match opening's and the kingdoms' reveal's clips (web/src/assets/audio/opening). Each was cut from the creator's
// Stable Audio bank in cines-engine; PROVENANCE.md beside the files says from what, and how. opening-cues.ts says
// when each plays.
import type { OpeningClipId } from "./opening-cues";

export interface OpeningClip {
  /** Bundled file. */
  url: string;
  /** Seconds. */
  dur: number;
}

export const OPENING_CLIPS = {
  open_arena: { url: new URL("../assets/audio/opening/open_arena.mp3", import.meta.url).href, dur: 2.45 },
  open_muster: { url: new URL("../assets/audio/opening/open_muster.mp3", import.meta.url).href, dur: 2.62 },
  open_crown: { url: new URL("../assets/audio/opening/open_crown.mp3", import.meta.url).href, dur: 0.95 },
  open_versus: { url: new URL("../assets/audio/opening/open_versus.mp3", import.meta.url).href, dur: 2.59 },
  open_draw: { url: new URL("../assets/audio/opening/open_draw.mp3", import.meta.url).href, dur: 0.75 },
  open_begin: { url: new URL("../assets/audio/opening/open_begin.mp3", import.meta.url).href, dur: 1.212 },
  reveal_crown: { url: new URL("../assets/audio/opening/reveal_crown.mp3", import.meta.url).href, dur: 1.45 },
  reveal_burst: { url: new URL("../assets/audio/opening/reveal_burst.mp3", import.meta.url).href, dur: 2.5 },
  reveal_flight: { url: new URL("../assets/audio/opening/reveal_flight.mp3", import.meta.url).href, dur: 1.3 },
  reveal_land: { url: new URL("../assets/audio/opening/reveal_land.mp3", import.meta.url).href, dur: 0.45 },
  reveal_flag: { url: new URL("../assets/audio/opening/reveal_flag.mp3", import.meta.url).href, dur: 0.344 },
  reveal_settle: { url: new URL("../assets/audio/opening/reveal_settle.mp3", import.meta.url).href, dur: 1 },
} as const satisfies Record<OpeningClipId, OpeningClip>;
