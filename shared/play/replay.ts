import { Chess } from 'chess.js';
import { replayEntryFromPGN } from '../showcase/records';
import type { ReplayEntry, RecordedMatch } from '../showcase/types';
import type { GameSnapshot } from '../../web/src/core/types';
import { matchArmies, sideName, type MatchConfig } from './match';
import { encodeArmies, SHOW_ARMIES_HEADER } from './replay-show';

export function captureCompletedMatch(snapshot: GameSnapshot, config: Omit<MatchConfig, 'mode'> & { mode: RecordedMatch['mode'] }, id: string, completedAt: string): ReplayEntry {
  if (snapshot.status !== 'over' || !snapshot.result) throw new Error('Finish the match before opening its replay.');
  const game = new Chess(); game.loadPgn(snapshot.pgn, { strict: true });
  const mode = config.mode;
  const names = mode === 'ai-battle' ? [`Computer ${sideName({ ...config, mode }, 'w')}`, `Computer ${sideName({ ...config, mode }, 'b')}`] : mode === 'local-duel' ? ['Player 1', 'Player 2']
    : config.playerColor === 'w' ? ['You', `Computer (${config.difficulty})`] : [`Computer (${config.difficulty})`, 'You'];
  const result = snapshot.result.winner === 'w' ? '1-0' : snapshot.result.winner === 'b' ? '0-1' : '1/2-1/2';
  game.setHeader('Event', matchModeLabel(mode));
  game.setHeader('White', names[0]); game.setHeader('Black', names[1]); game.setHeader('Result', result);
  game.setHeader('CFMatchId', id); game.setHeader('CFMode', mode); game.setHeader('CFSetting', config.setting);
  game.setHeader('CFPieces', 'crownfall-v1'); game.setHeader('CFCompletedAt', completedAt); game.setHeader('Termination', snapshot.result.reason);
  // The kingdoms fielded, for the replay's figures, arsenals, spells and summons. The match's seed (CFSeed) is already
  // in the controller's PGN: together with the moves' combat records they let the replay show every fight again.
  game.setHeader(SHOW_ARMIES_HEADER, encodeArmies(matchArmies({ ...config, mode: mode === 'classic' || mode === 'ai-battle' ? mode : 'local-duel' })));
  return replayEntryFromPGN(game.pgn(), { id, source: 'match', createdAt: completedAt });
}

export const matchModeLabel = (mode: RecordedMatch['mode']) => ({ classic: 'Classic', 'local-duel': 'Local Duel', chapters: 'Chapters', 'online-duel': 'Online Duel', 'ai-battle': 'AI Battle' })[mode];
