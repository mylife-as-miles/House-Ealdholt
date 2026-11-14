export interface CrownfallTrack {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  /** Relative to the application's public deployment directory. */
  readonly src: string;
  readonly durationSeconds: number;
}

export const STARTUP_TRACK_ID = 'la-felure-demure';

// Display titles follow the supplied playlist. Original MP3 bytes and ID3 tags
// remain unchanged; recorded sizes and hashes live beside the public audio.
export const CROWNFALL_SOUNDTRACK: readonly CrownfallTrack[] = Object.freeze([
  { id: 'sanguis-et-terra', title: 'Sanguis et Terra', src: 'audio/soundtrack/sanguis-et-terra.mp3', durationSeconds: 182.282375 },
  { id: 'le-roi-muet', title: 'Le Roi Muet', src: 'audio/soundtrack/le-roi-muet.mp3', durationSeconds: 163.448125 },
  { id: 'la-felure-demure', title: 'La Felure Demure', artist: 'myles4miles', src: 'audio/soundtrack/la-felure-demure.mp3', durationSeconds: 168.84 },
  { id: 'krom-shahid', title: 'Krom Shahid', src: 'audio/soundtrack/krom-shahid.mp3', durationSeconds: 127.738708 },
  { id: 'cyning-slieht', title: 'Cyning Slieht', src: 'audio/soundtrack/cyning-slieht.mp3', durationSeconds: 176.1175 },
  { id: 'slay-the-iron-slave', title: 'Slay the Iron Slave', src: 'audio/soundtrack/slay-the-iron-slave.mp3', durationSeconds: 155.872583 },
].map(track => Object.freeze(track)));

/** The adapter supplies an absolute public base, including its deployment path.
 * Each result is a fresh descriptor; resolving never changes the shared list. */
export function resolveCrownfallSoundtrack(baseUrl: string | URL): CrownfallTrack[] {
  const base = new URL(baseUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return CROWNFALL_SOUNDTRACK.map(track => ({ ...track, src: new URL(track.src, base).href }));
}

export const NOW_PLAYING_COPY = Object.freeze({
  nowPlaying: 'Now playing',
  collection: 'Crownfall soundtrack',
  nextTrack: 'Next track',
  paused: 'Paused',
  unavailable: 'Music unavailable',
});
