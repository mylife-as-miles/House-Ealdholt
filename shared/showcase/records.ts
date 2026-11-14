import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { EXHIBITION_PLIES, MAX_PGN_BYTES, MAX_REPLAY_PLIES } from './catalog';
import type { GenerationOptions, ReplayEntry, ReplayResult, ShowcaseFrame, ShowcaseMove, ShowcasePiece, ShowcaseRecord, RecordSource } from './types';
import { combatSequenceFromComment, type CombatSequence } from '../play/combat-sequences';

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const RESULTS: readonly string[] = ['1-0', '0-1', '1/2-1/2', '*'];
let identity = 0;
/**
 * A local identifier with a prefix. `crypto.randomUUID` exists only on secure origins (https, localhost), so a
 * page opened over plain http on a LAN address (a phone, a headset) falls back to a time-and-counter id.
 */
export const localId = (prefix: string): string => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++identity).toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const replayId = () => localId('replay');
export const cleanTitle = (value: unknown, fallback = 'Imported replay'): string => {
  const title = typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 52) : '';
  return !title || /^\?+$/.test(title) ? fallback : title;
};
const arenaIndex = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 4 ? Number(value) : 0;
const validDate = (value: unknown, fallback: string) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;

function boardResult(game: Chess): ReplayResult {
  if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0';
  return game.isDraw() ? '1/2-1/2' : '*';
}

function piecesAtStart(game: Chess): Map<string, ShowcasePiece> {
  const pieces = new Map<string, ShowcasePiece>();
  for (const row of game.board()) for (const piece of row) if (piece) {
    pieces.set(piece.square, Object.freeze({ id: `${piece.color}-${piece.type}-${piece.square}`, color: piece.color, type: piece.type, square: piece.square }));
  }
  return pieces;
}

function movePieces(pieces: Map<string, ShowcasePiece>, move: Move): void {
  const piece = pieces.get(move.from);
  if (!piece) throw new Error('The replay piece record is incomplete.');
  pieces.delete(move.from);
  pieces.delete(move.to);
  if (move.flags.includes('e')) pieces.delete(`${move.to[0]}${move.from[1]}`);
  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rank = move.from[1], kingSide = move.flags.includes('k');
    const from = `${kingSide ? 'h' : 'a'}${rank}`, to = `${kingSide ? 'f' : 'd'}${rank}`;
    const rook = pieces.get(from);
    if (!rook) throw new Error('The castling rook is missing.');
    pieces.delete(from); pieces.set(to, Object.freeze({ ...rook, square: to }));
  }
  pieces.set(move.to, Object.freeze({ ...piece, square: move.to, type: move.promotion || piece.type }));
}

const moveData = (move: Move, choreography?: CombatSequence): ShowcaseMove => Object.freeze({
  from: move.from, to: move.to, san: move.san, color: move.color, piece: move.piece,
  ...(move.captured ? { captured: move.captured } : {}), ...(move.promotion ? { promotion: move.promotion } : {}), flags: move.flags,
  ...(choreography ? { choreography } : {}),
});

function frame(game: Chess, pieces: Map<string, ShowcasePiece>, ply: number, move: Move | null, choreography?: CombatSequence): ShowcaseFrame {
  return Object.freeze({ ply, fen: game.fen(), turn: game.turn(), check: game.isCheck(), pieces: Object.freeze([...pieces.values()]), move: move ? moveData(move, choreography) : null });
}

const openingGame = new Chess();
export const INITIAL_SHOWCASE_FRAME: ShowcaseFrame = frame(openingGame, piecesAtStart(openingGame), 0, null);

interface RecordMetadata {
  id?: string; title?: string; source?: RecordSource; arena?: number; createdAt?: string;
  seed?: number; termination?: ShowcaseRecord['termination'];
}

/** Match provenance is portable in the PGN; no executable replay state is trusted. */
function headersForMatch(game: Chess) {
  const h = game.getHeaders();
  if (!h.CFMatchId) return undefined;
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(h.CFMatchId)
    || !['classic', 'local-duel', 'chapters', 'online-duel', 'ai-battle'].includes(h.CFMode)
    || !['scene-01', 'scene-02'].includes(h.CFSetting) || h.CFPieces !== 'crownfall-v1') {
    throw new Error('This match uses unsupported replay settings or pieces.');
  }
  return Object.freeze({ id: h.CFMatchId, mode: h.CFMode as NonNullable<ReplayEntry['match']>['mode'],
    setting: h.CFSetting as 'scene-01' | 'scene-02', pieces: 'crownfall-v1' as const,
    white: cleanTitle(h.White, 'Aethelgard'), black: cleanTitle(h.Black, 'Solforiz'), reason: cleanTitle(h.Termination, 'Completed') });
}

function validatedReplay(pgn: string, metadata: RecordMetadata): { entry: ReplayEntry; history: Move[]; termination: ShowcaseRecord['termination'] } {
  if (typeof pgn !== 'string' || !pgn.trim() || bytes(pgn) > MAX_PGN_BYTES) throw new Error('Choose a PGN file smaller than 64 KB.');
  const parsed = new Chess();
  try { parsed.loadPgn(pgn, { strict: true }); }
  catch { throw new Error('The PGN could not be read. Every move must be legal.'); }
  const history = parsed.history({ verbose: true });
  if ((!history.length && !headersForMatch(parsed)) || history.length > MAX_REPLAY_PLIES) throw new Error(`A replay needs 1 to ${MAX_REPLAY_PLIES} legal half-moves.`);
  if (history.some(move => move.flags.includes('-'))) throw new Error('Null moves are not legal replay moves.');
  const headers = parsed.getHeaders();
  const declared = RESULTS.includes(headers.Result) ? headers.Result as ReplayResult : '*';
  const computed = boardResult(parsed);
  const match = headersForMatch(parsed);
  if (metadata.source === 'match' && !match) throw new Error('The match replay is missing its original settings.');
  const result = match && computed === '*' ? declared : computed;
  if (result !== '*' && declared !== '*' && result !== declared) throw new Error('The PGN result contradicts the final board.');
  const date = validDate(metadata.createdAt ?? headers.CFCompletedAt, new Date().toISOString());
  const requestedId = metadata.id ?? match?.id;
  const id = requestedId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(requestedId)
    ? requestedId : replayId();
  const entry: ReplayEntry = Object.freeze({
    id, title: cleanTitle(metadata.title || headers.Event, metadata.source === 'computer' ? 'Computer exhibition' : 'Imported replay'),
    source: metadata.source || 'import', arena: arenaIndex(metadata.arena), createdAt: date,
    // chess.js 1.4's wrapped-comment exporter can join the preceding move
    // number to a SAN token ("d52."). Keep portable PGN comments unwrapped.
    pgn: parsed.pgn({ maxWidth: 0, newline: '\n' }), result,
    ...(declared !== '*' && result === '*' ? { declaredResult: declared } : {}),
    ...(typeof metadata.seed === 'number' && Number.isInteger(metadata.seed) ? { seed: metadata.seed >>> 0 } : {}),
    plies: history.length, ...(match ? { match } : {}),
  });
  return { entry, history, termination: parsed.isCheckmate() ? 'checkmate' : parsed.isDraw() ? 'draw' : metadata.termination || (match ? 'recorded' : metadata.source === 'computer' ? 'move-limit' : 'imported') };
}

/** Validate the archive without allocating a complete render timeline for every entry. */
export function replayEntryFromPGN(pgn: string, metadata: RecordMetadata = {}): ReplayEntry {
  return validatedReplay(pgn, metadata).entry;
}

/** Strictly parse moves; supplied PGN result tags never manufacture a board win. */
export function recordFromPGN(pgn: string, metadata: RecordMetadata = {}): ShowcaseRecord {
  const { entry, history, termination } = validatedReplay(pgn, metadata);
  const opening = new Chess(); opening.loadPgn(pgn, { strict: true });
  const performances = new Map(opening.getComments().map(item => [item.fen, combatSequenceFromComment(item.comment)]));
  const initialFen = history[0]?.before ?? opening.fen(), game = new Chess(initialFen), pieces = piecesAtStart(game);
  const frames: ShowcaseFrame[] = [frame(game, pieces, 0, null)];
  for (const item of history) {
    const move = game.move({ from: item.from, to: item.to, ...(item.promotion ? { promotion: item.promotion } : {}) });
    movePieces(pieces, move);
    frames.push(frame(game, pieces, frames.length, move, performances.get(game.fen())));
  }
  return Object.freeze({ ...entry, initialFen, moves: Object.freeze(history.map(move => move.san)), frames: Object.freeze(frames), termination });
}

export function compactReplay(record: ReplayEntry, arena = record.arena): ReplayEntry {
  const { id, title, source, createdAt, pgn, seed, result, declaredResult, plies, match } = record;
  return Object.freeze({ id, title, source, createdAt, pgn, ...(seed === undefined ? {} : { seed }), result,
    ...(declaredResult ? { declaredResult } : {}), ...(match ? { match } : {}), plies, arena: arenaIndex(arena) });
}

export function openReplay(entry: ReplayEntry): ShowcaseRecord {
  return recordFromPGN(entry.pgn, entry);
}

const VALUE = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 } as const;
function random(seed: number): () => number {
  let value = seed >>> 0 || 0x6d2b79f5;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}

/** A bounded one-ply tactical computer policy, rather than a claim of competitive engine strength. */
function chooseMove(game: Chess, rng: () => number, history: readonly Move[]): Move {
  const moves = game.moves({ verbose: true });
  let best = moves[0], score = -Infinity;
  const color = game.turn(), enemy = color === 'w' ? 'b' : 'w';
  for (const move of moves) {
    let value = rng() * 4;
    if (move.san.includes('#')) value += 100000;
    if (move.captured) value += VALUE[move.captured] * 1.2 - VALUE[move.piece] * .12;
    if (move.promotion) value += VALUE[move.promotion] - VALUE.p;
    if (move.san.includes('+')) value += 25;
    if (move.flags.includes('k') || move.flags.includes('q')) value += 28;
    if (game.isAttacked(move.to as Square, enemy)) value -= VALUE[move.piece] * .85;
    const file = move.to.charCodeAt(0) - 97, rank = Number(move.to[1]) - 1;
    value += (3.5 - Math.abs(file - 3.5)) + (3.5 - Math.abs(rank - 3.5));
    if (history.length < 20 && (move.piece === 'n' || move.piece === 'b') && ['1', '8'].includes(move.from[1])) value += 14;
    if (move.piece === 'p') value += color === 'w' ? rank * .35 : (7 - rank) * .35;
    const previous = history[history.length - 2];
    if (previous && previous.to === move.from && previous.from === move.to) value -= 18;
    if (value > score) { best = move; score = value; }
  }
  return best;
}

/** Legal self-play with short event-loop yields and real completed-move progress. */
export async function generateExhibition(options: GenerationOptions = {}, onProgress?: (progress: number) => void): Promise<ShowcaseRecord> {
  const seed = (options.seed ?? Date.now()) >>> 0;
  const maxPlies = Math.max(8, Math.min(EXHIBITION_PLIES, Number.isFinite(options.maxPlies) ? Math.floor(options.maxPlies!) : EXHIBITION_PLIES));
  const game = new Chess(DEFAULT_POSITION), rng = random(seed), history: Move[] = [];
  game.setHeader('Event', 'Crownfall computer exhibition'); game.setHeader('Site', 'Local');
  game.setHeader('White', 'Computer White'); game.setHeader('Black', 'Computer Black');
  if (options.signal?.aborted) throw new DOMException('Exhibition generation cancelled', 'AbortError');
  // Publish preparation/allow an immediate route cancellation before doing chess work.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  let slice = performance.now();
  while (history.length < maxPlies && !game.isGameOver()) {
    if (options.signal?.aborted) throw new DOMException('Exhibition generation cancelled', 'AbortError');
    const chosen = chooseMove(game, rng, history);
    history.push(game.move({ from: chosen.from, to: chosen.to, ...(chosen.promotion ? { promotion: chosen.promotion } : {}) }));
    if (history.length % 4 === 0) onProgress?.(history.length / maxPlies);
    if (performance.now() - slice >= 6) { await new Promise<void>(resolve => setTimeout(resolve, 0)); slice = performance.now(); }
  }
  if (options.signal?.aborted) throw new DOMException('Exhibition generation cancelled', 'AbortError');
  game.setHeader('Result', boardResult(game));
  const date = new Date().toISOString();
  const record = recordFromPGN(game.pgn(), { title: `Exhibition ${String(seed % 1000).padStart(3, '0')}`, source: 'computer', arena: options.arena, seed, createdAt: date, termination: 'move-limit' });
  onProgress?.(1);
  return record;
}
