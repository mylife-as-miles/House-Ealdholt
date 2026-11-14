interface ObservedTrack {
  readonly sequence: number;
  readonly playing: boolean;
}

/** React can first observe a new sequence after playback has already paused.
 * Consume that start now; becoming eligible later must not announce a resume. */
export function consumeNowPlayingSequence(seenSequence: number | null, observed: ObservedTrack | null | undefined, eligible: boolean): { seenSequence: number | null; show: boolean } {
  return {
    seenSequence: observed?.sequence ?? seenSequence,
    show: !!observed && observed.sequence !== seenSequence && observed.playing && eligible,
  };
}
