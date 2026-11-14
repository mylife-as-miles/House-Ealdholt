import { ARENAS } from '../menu/content';

export { SHOWCASE_STORAGE_KEY } from './storage-key';
export const MAX_REPLAYS = 12;
export const MAX_PGN_BYTES = 64 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024;
export const MAX_REPLAY_PLIES = 512;
export const EXHIBITION_PLIES = 96;
export const MOVE_SECONDS = 1.2;
export const PLAYBACK_SPEEDS = [.5, 1, 2, 4] as const;
export const SHOWCASE_ARENAS = ARENAS.map((arena, index) => Object.freeze({
  id: index, label: arena.label, artwork: arena.source, alt: arena.alt,
  material: ['stone', 'bronze', 'timber', 'crystal'][index],
}));

export const SHOWCASE_COPY = Object.freeze({
  title: 'SHOWCASE', battles: 'AI BATTLES', arenas: 'ARENAS', replays: 'MATCH REPLAYS',
  exhibition: 'Computer exhibition', local: 'Generated on this device',
  newBattle: 'New exhibition', play: 'Play', pause: 'Pause', restart: 'Restart',
  previous: 'Previous move', next: 'Next move', speed: 'Playback speed',
  save: 'Save replay', saved: 'Saved on this device', session: 'This visit only',
  emptyTitle: 'Your replay archive',
  emptyBody: 'Save a completed match or exhibition to watch it here. Replays stay on this device.',
  corrupt: 'The stored archive could not be read. Its data is unchanged; new replays stay in this visit.',
  unavailable: 'Device storage is unavailable. Replays work for this visit.',
  deleteTitle: 'Delete this replay?', deleteBody: 'Remove this replay from the archive on this device?',
  moveLimit: 'Exhibition complete. The move limit was reached; no winner is declared.',
  recordedMatch: 'Recorded match', matchComplete: 'Match complete',
  imported: 'Imported replay', complete: 'Exhibition complete',
  generating: 'Preparing a legal computer exhibition',
  first: 'Start', last: 'End', moves: 'Moves', white: 'White to move', black: 'Black to move',
  check: 'Check', opening: 'Opening position', result: 'Result', archive: 'Replay archive',
  delete: 'Delete', cancel: 'Cancel', confirmDelete: 'Delete replay', backToArchive: 'Replay archive',
  retry: 'Try again', loading: 'Preparing Showcase...', arenaPreview: 'Arena preview',
  open: 'Watch replay', page: 'Page', localArchive: 'Saved on this device', emptyAction: 'Create exhibition',
  watch: 'Watch exhibition', import: 'Import replay', export: 'Export PGN', exportJSON: 'Export JSON',
  importDescription: 'Open a local PGN or Crownfall replay file. Imported moves must be legal.',
  desktopReplayOnly: 'Recorded moves are available here. The original arena, pieces and battles play on desktop.',
  rendererFallback: 'The 3D view is unavailable. The move record and playback controls remain usable.',
  view: 'View', board: 'Board', cinematic: 'Cinematic', detail: 'Detail',
  moveList: 'Move record', localOnly: 'Local archive. No online account or cloud sync.',
  recordedResult: 'Recorded result', unknownResult: 'No winner declared',
  loadingArchive: 'Opening replay archive...',
  openingReplay: 'Opening replay...',
  reloadArchive: 'Reload archive',
  matchView: 'Match', skipFight: 'Skip fight', skipEnding: 'Skip ending',
  battlesOnly: 'Battles only', battlesOnlyDetail: 'Jump the quiet moves; play every capture and the ending.',
});
