import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { MAX_ARCHIVE_BYTES, MAX_REPLAYS, MOVE_SECONDS, SHOWCASE_STORAGE_KEY } from './catalog';
import { compactReplay, generateExhibition, INITIAL_SHOWCASE_FRAME, openReplay, recordFromPGN } from './records';
import { ShowcaseSession } from './session';
import { parseReplayArchive, serializeReplayArchive } from './storage';
import type { ShowcaseRecord, ShowcaseStorage } from './types';

const OPENING = '[Event "Test exhibition"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *';
class MemoryStorage implements ShowcaseStorage {
  values = new Map<string, string>(); writes: string[] = []; refused = false; readRefused = false;
  getItem(key: string): string | null { if (this.readRefused) throw new Error('refused'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes.push(key); if (this.refused) throw new Error('quota'); this.values.set(key, value); }
}
const replay = (id = 'test-replay') => recordFromPGN(OPENING, { id, createdAt: '2026-01-01T00:00:00Z' });
function verifyFrames(record: ShowcaseRecord): void {
  const game = new Chess(record.initialFen);
  assert.equal(record.frames[0].fen, game.fen());
  for (let ply = 1; ply <= record.plies; ply++) {
    game.move(record.moves[ply - 1], { strict: true });
    const frame = record.frames[ply];
    assert.equal(frame.fen, game.fen());
    assert.equal(frame.turn, game.turn());
    assert.equal(frame.check, game.isCheck());
    assert.equal(new Set(frame.pieces.map(piece => piece.id)).size, frame.pieces.length);
    assert.deepEqual(frame.pieces.map(piece => `${piece.square}:${piece.color}${piece.type}`).sort(),
      game.board().flatMap(row => row.filter(Boolean).map(piece => `${piece!.square}:${piece!.color}${piece!.type}`)).sort());
  }
}

test('seeded computer exhibitions produce reproducible legal moves and report move limits honestly', async () => {
  const progress: number[] = [];
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  const first = await generateExhibition({ seed: 2057, arena: 2, maxPlies: 32 }, value => progress.push(value));
  clearTimeout(timer);
  const second = await generateExhibition({ seed: 2057, maxPlies: 32 });
  assert.deepEqual(first.moves, second.moves);
  assert.equal(first.arena, 2);
  assert.equal(first.source, 'computer');
  assert.ok(first.plies <= 32 && first.plies >= 8);
  assert.equal(first.result, '*');
  assert.equal(first.termination, 'move-limit');
  assert.equal(openReplay(compactReplay(first)).termination, 'move-limit');
  assert.ok(timerRan, 'generation must yield to a pending UI task');
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => value >= (progress[index - 1] || 0) && value <= 1));
  verifyFrames(first);
});

test('castling, en passant and promotion preserve piece identity and bidirectional seek equivalence', async () => {
  const castle = recordFromPGN('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O O-O-O *');
  const ep = recordFromPGN('1. e4 a6 2. e5 d5 3. exd6 *');
  const promotion = recordFromPGN('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ Kh7 *');
  assert.equal(castle.frames[1].pieces.find(piece => piece.square === 'f1')?.id, 'w-r-h1');
  assert.equal(castle.frames[2].pieces.find(piece => piece.square === 'd8')?.id, 'b-r-a8');
  assert.ok(!ep.frames[5].pieces.some(piece => piece.square === 'd5'));
  assert.equal(ep.frames[5].pieces.find(piece => piece.square === 'd6')?.id, 'w-p-e2');
  assert.equal(promotion.frames[1].pieces.find(piece => piece.square === 'a8')?.id, 'w-p-a7');
  assert.equal(promotion.frames[1].pieces.find(piece => piece.square === 'a8')?.type, 'q');
  const session = new ShowcaseSession({ storage: null });
  for (const record of [castle, ep, promotion]) {
    verifyFrames(record); assert.equal((await session.load(record)).ok, true);
    for (let ply = record.plies; ply >= 0; ply--) { session.seek(ply); assert.equal(session.snapshot.frame?.fen, record.frames[ply].fen); }
    for (let ply = 0; ply <= record.plies; ply++) { session.seek(ply); assert.equal(session.snapshot.frame?.fen, record.frames[ply].fen); }
  }
  assert.equal(INITIAL_SHOWCASE_FRAME.pieces.length, 32);
  session.dispose();
});

test('imported result tags remain distinct from board results and terminal contradictions are rejected', () => {
  const resigned = recordFromPGN('[Result "1-0"]\n\n1. e4 e5 1-0');
  assert.equal(resigned.result, '*'); assert.equal(resigned.declaredResult, '1-0');
  const mate = recordFromPGN('1. f3 e5 2. g4 Qh4# 0-1');
  assert.equal(mate.result, '0-1'); assert.equal(mate.termination, 'checkmate');
  assert.throws(() => recordFromPGN('[Result "1-0"]\n\n1. f3 e5 2. g4 Qh4# 1-0'), /contradicts/);
  assert.throws(() => recordFromPGN('1. e4 e5 2. Qxe8 *'), /legal/);
  assert.throws(() => recordFromPGN('[SetUp "1"]\n\n1. e4 *'), /legal/);
  assert.throws(() => recordFromPGN('1. -- e5 *'));
});

test('timeline controls clamp safely, pause on seek, honor speed, and do not catch up after suspension', async () => {
  const session = new ShowcaseSession({ storage: null }); await session.load(replay());
  let notices = 0; session.subscribe(() => { notices++; });
  session.play(); const initialNotices = notices;
  session.update(.001); session.update(0); session.update(NaN);
  assert.equal(notices, initialNotices, 'no allocation/notification for animation-only frames');
  for (let frame = 0; frame < 72; frame++) session.update(1 / 60);
  assert.equal(session.snapshot.ply, 1);
  session.seek(99); assert.equal(session.snapshot.ply, 6); assert.equal(session.snapshot.playing, false);
  session.play(); assert.equal(session.snapshot.ply, 0, 'play at end restarts');
  session.setSpeed(4); session.update(.15); session.update(.15);
  assert.equal(session.snapshot.ply, 1);
  session.update(10); assert.equal(session.snapshot.ply, 1, 'delayed frame is capped');
  session.setSuspended(true); session.update(999); session.setSuspended(false);
  assert.equal(session.snapshot.playing, false); assert.equal(session.snapshot.ply, 1);
  session.step(-1); assert.equal(session.snapshot.ply, 0); session.step(-1); assert.equal(session.snapshot.ply, 0);
  session.seek(NaN); assert.equal(session.snapshot.ply, 0);
  session.play(); session.update(MOVE_SECONDS); assert.equal(session.snapshot.ply, 0);
  session.dispose();
});

test('generation cancellation and disposal prevent late publication while retaining the current replay', async () => {
  const session = new ShowcaseSession({ storage: null }); const old = replay(); await session.load(old);
  const pending = session.generate({ seed: 9 }); session.setSuspended(true);
  assert.equal(await pending, null); assert.equal(session.snapshot.record?.id, old.id);
  assert.equal(session.snapshot.phase, 'ready'); assert.equal(session.snapshot.playing, false);
  session.setSuspended(false);
  const external = new AbortController(); external.abort();
  assert.equal(await session.generate({ seed: 10, signal: external.signal }), null);
  let notices = 0; session.subscribe(() => notices++);
  const disposed = session.generate({ seed: 11 }); session.dispose(); const before = notices;
  assert.equal(await disposed, null); assert.equal(notices, before);
});

test('playback keeps the chosen speed across different render frame rates without accumulating drift', async () => {
  const record = recordFromPGN('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O *');
  for (const rate of [30, 60, 90, 144]) for (const speed of [.5, 1, 2, 4] as const) {
    const session = new ShowcaseSession({ storage: null }); await session.load(record); session.setSpeed(speed); session.play();
    const frames = Math.ceil(rate * 2.43), seconds = frames / rate;
    for (let frame = 0; frame < frames; frame++) session.update(1 / rate);
    assert.equal(session.snapshot.ply, Math.floor(seconds * speed / MOVE_SECONDS), `${rate} FPS at ${speed}x`);
    session.dispose();
  }
});

test('archive save, reopen and delete only write the Showcase namespace', async () => {
  const storage = new MemoryStorage(); storage.values.set('crownfall.legacy', 'private'); storage.values.set('crownfall.preferences', 'prefs');
  const session = new ShowcaseSession({ storage }); await session.load(replay()); session.setArena(3);
  assert.equal(session.save().ok, true); assert.equal(session.snapshot.saved, true);
  const restored = new ShowcaseSession({ storage }); await restored.ready; assert.equal(restored.snapshot.library.length, 1);
  assert.equal((await restored.load(restored.snapshot.library[0])).ok, true); assert.equal(restored.snapshot.arena, 3);
  assert.equal(restored.snapshot.frame?.fen, replay().frames[0].fen);
  assert.equal(restored.removeReplay(restored.snapshot.library[0].id).ok, true);
  const deleted = new ShowcaseSession({ storage }); await deleted.ready; assert.equal(deleted.snapshot.library.length, 0);
  assert.deepEqual(new Set(storage.writes), new Set([SHOWCASE_STORAGE_KEY]));
  assert.equal(storage.values.get('crownfall.legacy'), 'private'); assert.equal(storage.values.get('crownfall.preferences'), 'prefs');
});

test('a match saved to the archive is not opened over the replay the Showcase has open (M-22)', async () => {
  const storage = new MemoryStorage();
  const session = new ShowcaseSession({ storage }); await session.load(replay('watching')); session.seek(3);
  const saved = await session.archive(compactReplay(replay('from-match')));
  assert.equal(saved.ok, true); assert.equal(saved.entry?.id, 'from-match');
  // The viewer still shows what it showed, where it was.
  assert.equal(session.snapshot.record?.id, 'watching'); assert.equal(session.snapshot.ply, 3);
  assert.deepEqual(session.snapshot.library.map(entry => entry.id), ['from-match']);
  const restored = new ShowcaseSession({ storage }); await restored.ready;
  assert.deepEqual(restored.snapshot.library.map(entry => entry.id), ['from-match']);
});

test('corrupt/future archives and refused reads preserve original bytes and allow visit-only playback', async () => {
  for (const raw of ['{broken', '{"version":99,"entries":[]}', '{"version":1,"entries":[{}]}']) {
    const storage = new MemoryStorage(); storage.values.set(SHOWCASE_STORAGE_KEY, raw);
    const session = new ShowcaseSession({ storage }); await session.ready; assert.equal(session.snapshot.storage, 'corrupt');
    await session.load(replay()); assert.equal(session.save().ok, false);
    assert.equal(session.snapshot.saved, false); assert.equal(session.snapshot.library.length, 1);
    session.play(); assert.equal(session.snapshot.playing, true);
    assert.equal(storage.values.get(SHOWCASE_STORAGE_KEY), raw); assert.equal(storage.writes.length, 0);
    assert.equal(session.removeReplay(replay().id).ok, true); assert.equal(storage.values.get(SHOWCASE_STORAGE_KEY), raw);
  }
  const storage = new MemoryStorage(); storage.readRefused = true;
  const denied = new ShowcaseSession({ storage }); assert.equal(denied.snapshot.storage, 'session');
  await denied.load(replay()); assert.equal(denied.save().ok, false); assert.equal(denied.snapshot.saved, false);
});

test('failed writes and deletes keep prior durable bytes, and retry/reload do not silently overwrite another page', async () => {
  const storage = new MemoryStorage(); const session = new ShowcaseSession({ storage });
  await session.load(replay('first')); assert.equal(session.save().ok, true); const raw = storage.getItem(SHOWCASE_STORAGE_KEY);
  storage.refused = true; await session.load(replay('second')); assert.equal(session.save().ok, false);
  assert.equal(session.snapshot.saved, false); assert.equal(session.snapshot.storage, 'session');
  assert.equal(storage.getItem(SHOWCASE_STORAGE_KEY), raw); assert.equal(session.snapshot.library.length, 2);
  assert.equal(session.removeReplay('first').ok, false); assert.equal(session.snapshot.library.length, 2);
  assert.equal(storage.getItem(SHOWCASE_STORAGE_KEY), raw);
  storage.refused = false; storage.values.set(SHOWCASE_STORAGE_KEY, serializeReplayArchive([compactReplay(replay('other-page'))]));
  assert.equal(session.save().ok, false); assert.equal(parseReplayArchive(storage.getItem(SHOWCASE_STORAGE_KEY))[0].id, 'other-page');
  assert.equal((await session.reloadArchive()).ok, true);
  assert.deepEqual(session.snapshot.library.map(entry => entry.id), ['second', 'other-page']);
  assert.equal(session.save().ok, true); assert.equal(session.snapshot.saved, true);
});

test('portable PGN/JSON round trips rebuild trusted frames and reject invalid/oversized input without partial mutation', async () => {
  const session = new ShowcaseSession({ storage: new MemoryStorage() }); await session.load(replay()); session.save();
  const json = session.exportJSON(), pgn = session.exportPGN();
  const imported = new ShowcaseSession({ storage: new MemoryStorage() });
  assert.equal((await imported.import(json)).ok, true); assert.deepEqual(imported.snapshot.record?.frames, session.snapshot.record?.frames);
  assert.equal((await imported.import(pgn)).ok, true); assert.equal(imported.snapshot.library.length, 1, 'duplicate import does not duplicate entries');
  const before = imported.snapshot.record;
  for (const input of ['not chess', '{"format":"unknown"}', 'x'.repeat(MAX_ARCHIVE_BYTES + 1), '1. e4 e5 2. Ke8 *']) {
    assert.equal((await imported.import(input)).ok, false); assert.equal(imported.snapshot.record, before);
  }
  const spoof = JSON.parse(json); spoof.entry.frames = [{ fen: 'fake' }]; spoof.entry.result = '1-0'; spoof.entry.plies = 999999;
  const clean = new ShowcaseSession({ storage: null }); await clean.import(JSON.stringify(spoof));
  assert.equal(clean.snapshot.record?.result, '*'); assert.equal(clean.snapshot.record?.plies, 6);
  assert.equal(clean.snapshot.frame?.fen, INITIAL_SHOWCASE_FRAME.fen);
});

test('archive limits and duplicate identifiers reject invalid stored data', async () => {
  const entry = compactReplay(replay());
  assert.throws(() => parseReplayArchive(JSON.stringify({ version: 1, entries: [entry, entry] })), /invalid/);
  assert.throws(() => serializeReplayArchive(Array.from({ length: MAX_REPLAYS + 1 }, () => entry)), /at most/);
  const session = new ShowcaseSession({ storage: new MemoryStorage() });
  for (let index = 0; index < MAX_REPLAYS; index++) { await session.load(replay(`replay-${index}`)); assert.equal(session.save().ok, true); }
  const raw = session.snapshot.library; await session.load(replay('too-many'));
  assert.equal(session.save().ok, false); assert.equal(session.snapshot.library, raw);
});

test('brace-comment PGN imports remain legal while unknown/malformed JSON is rejected and unknown event titles fall back', async () => {
  const session = new ShowcaseSession({ storage: new MemoryStorage() });
  assert.equal((await session.import('{An opening comment.} 1. e4 e5 *')).ok, true);
  assert.equal(session.snapshot.record?.plies, 2); assert.equal(session.snapshot.record?.title, 'Imported replay');
  assert.equal(recordFromPGN('[Event "?"]\n\n1. d4 d5 *').title, 'Imported replay');
  const before = session.snapshot.record;
  for (const input of ['{"format":"unknown","moves":[]}', '{"format":"crownfall-showcase-replay","version":1,"entry":', '{"anything": 1} malformed', '{not a replay}']) {
    assert.equal((await session.import(input)).ok, false); assert.equal(session.snapshot.record, before);
  }
});

test('archive hydration yields between records, blocks writes, and cancels cleanly on suspension/disposal', async () => {
  const storage = new MemoryStorage();
  const raw = serializeReplayArchive(Array.from({ length: MAX_REPLAYS }, (_, index) => compactReplay(replay(`archive-${index}`))));
  storage.values.set(SHOWCASE_STORAGE_KEY, raw);
  const session = new ShowcaseSession({ storage });
  assert.equal(session.snapshot.storage, 'loading');
  await session.load(replay('watch-during-hydration')); session.play();
  assert.equal(session.save().ok, false); assert.equal((await session.import(OPENING)).ok, false); assert.equal(session.removeReplay('archive-0').ok, false);
  assert.equal(session.snapshot.playing, true, 'storage hydration must not block a loaded timeline');
  assert.equal(storage.writes.length, 0);
  let tasks = 0; const timer = setInterval(() => tasks++, 0);
  assert.equal((await session.ready).ok, true); clearInterval(timer);
  assert.ok(tasks >= MAX_REPLAYS - 1, 'archive entries must run in separate tasks');
  assert.equal(session.snapshot.library.length, MAX_REPLAYS); assert.equal(session.snapshot.storage, 'saved');
  assert.equal(storage.getItem(SHOWCASE_STORAGE_KEY), raw); assert.equal(storage.writes.length, 0);

  const suspended = new ShowcaseSession({ storage }); suspended.setSuspended(true);
  assert.equal((await suspended.ready).ok, false); assert.equal(suspended.snapshot.library.length, 0);
  suspended.setSuspended(false); assert.equal((await suspended.ready).ok, true); assert.equal(suspended.snapshot.library.length, MAX_REPLAYS);
  const disposed = new ShowcaseSession({ storage }); let notices = 0; disposed.subscribe(() => notices++);
  disposed.dispose(); const before = notices; assert.equal((await disposed.ready).ok, false);
  assert.equal(notices, before); assert.equal(disposed.snapshot.library.length, 0);
});
