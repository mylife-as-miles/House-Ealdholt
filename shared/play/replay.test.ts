import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Chess } from 'chess.js';
import { GameController } from '../../web/src/core/gameController';
import { captureCompletedMatch } from './replay';
import { openReplay, recordFromPGN } from '../showcase/records';
import { parseReplayArchive, serializeReplayArchive } from '../showcase/storage';
import { ShowcaseSession } from '../showcase/session';
import type { MatchConfig } from './match';
const config: MatchConfig = { mode: 'local-duel', setting: 'scene-02', difficulty: 'easy', playerColor: 'w', clockMinutes: null };
const at = '2026-11-03T10:00:00.000Z';

test('completed match archive preserves actual moves, opponents, result, date, setting and pieces', async () => {
  const game = new GameController(); game.start({ mode: 'hotseat', difficulty: 'easy', playerColor: 'w', clockMinutes: null });
  for (const [from, to] of [['e2','e4'], ['e7','e5'], ['g1','f3']]) assert.equal(await game.tryMove(from, to), true);
  game.resign();
  const entry = captureCompletedMatch(game.getSnapshot(), config, 'actual-match', at);
  const [stored] = parseReplayArchive(serializeReplayArchive([entry]));
  assert.deepEqual(stored.match, entry.match); assert.equal(stored.result, '1-0'); assert.equal(stored.createdAt, at);
  const classic = captureCompletedMatch(game.getSnapshot(), { ...config, mode: 'classic' }, 'classic-match', at);
  assert.equal(classic.match?.mode, 'classic'); assert.equal(classic.match?.white, 'You'); assert.equal(classic.match?.black, 'Computer (easy)');
  assert.equal(recordFromPGN(classic.pgn).createdAt, at);
  assert.equal(stored.match?.white, 'Player 1'); assert.equal(stored.match?.black, 'Player 2');
  const replay = openReplay(stored);
  assert.deepEqual(replay.moves, game.getSnapshot().sanList);
  assert.equal(replay.frames.at(-1)?.fen, game.getSnapshot().fen);
  assert.equal(replay.match?.pieces, 'crownfall-v1'); assert.equal(replay.match?.setting, 'scene-02');
  const storage = { raw: null as string | null, getItem() { return this.raw; }, setItem(_key: string, raw: string) { this.raw = raw; } };
  const session = new ShowcaseSession({ storage }); await session.ready; await session.load(entry); session.save(); session.save();
  assert.equal(session.snapshot.library.length, 1);
  let completions = 0; game.on('gameover', () => completions++);
  for (const frame of [...replay.frames, ...replay.frames.toReversed()]) game.showReplayPosition(frame.fen);
  assert.equal(completions, 0); assert.equal(game.getSnapshot().status, 'idle'); assert.equal(game.isHumanTurn(), false);
  assert.equal(game.getSnapshot().clock.enabled, false);
  session.seek(1); session.setSpeed(4); session.play(); session.update(.25); session.update(.25);
  assert.equal(session.snapshot.ply, 2);
  session.dispose(); game.dispose();
});

test('zero-move resignation and custom Chapter positions round-trip without inventing moves', () => {
  const game = new GameController(); game.start({ mode: 'hotseat', difficulty: 'easy', playerColor: 'w', clockMinutes: null }); game.resign();
  const record = openReplay(captureCompletedMatch(game.getSnapshot(), config, 'resign-zero', at));
  assert.equal(record.plies, 0); assert.equal(record.frames.length, 1); assert.equal(record.result, '0-1');
  const fen = '7k/6P1/6K1/8/8/8/8/8 w - - 0 1';
  game.start({ mode: 'hotseat', difficulty: 'easy', playerColor: 'w', clockMinutes: null, startingFen: fen }); game.resign();
  const chapter = openReplay(captureCompletedMatch(game.getSnapshot(), { ...config, mode: 'chapters' }, 'chapter-record', at));
  assert.equal(chapter.initialFen, fen); assert.equal(chapter.match?.mode, 'chapters');
  game.dispose();
});

test('replays reject unsupported piece sets and contradictory terminal results', () => {
  const game = new GameController(); game.start({ mode: 'hotseat', difficulty: 'easy', playerColor: 'w', clockMinutes: null }); game.resign();
  const entry = captureCompletedMatch(game.getSnapshot(), config, 'invalid-match', at);
  assert.throws(() => recordFromPGN(entry.pgn.replace('crownfall-v1', 'unknown-pieces')), /unsupported/);
  const chess = new Chess(); for (const san of ['f3','e5','g4','Qh4#']) chess.move(san); chess.setHeader('Result', '1-0');
  assert.throws(() => recordFromPGN(chess.pgn()), /contradicts/);
  game.dispose();
});
