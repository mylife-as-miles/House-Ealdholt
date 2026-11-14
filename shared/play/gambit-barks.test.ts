import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Chess, type Move } from "chess.js";
import {
  ANSWER_GAP, AFTERMATH_WAIT, BARK_CHANCE, BARK_GAP, barkMaySound, barkSeed, emptyBarkMemory, lastMoveFacts, moveFacts, newGameBarkMemory,
  nextAmbientVoice, nextBark, planBarks, planEvents, seededRandom, stepEvents, takeAmbientVoice, takeBark, LINE_REST_PLIES, STEP_REST_PLIES, VOICE_CLEARANCE,
  VOICE_REST_PLIES, type BarkContext, type BarkMemory, type MoveFacts, type PieceAt,
} from "./gambit-barks";
import { allRequestedClips, barkClips, BARK_EVENTS, BARK_TAKES, isBarkClip, KINGDOMS, VOICE_SLOTS, pawnSlot, voiceId, type BarkEvent } from "./gambit-sound";

const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
const takes = JSON.parse(readFileSync(web("sound-design/gambit/tools/takes.json"), "utf8")) as Record<string, { dur: number; hold?: number; lufs: number; event?: string }>;
const plan = JSON.parse(readFileSync(web("sound-design/gambit/plan.json"), "utf8")) as { lines: { id: string; role: string; event?: string; text: string }[] };

/** The facts of the last of `moves` (SAN), played from the start. */
function factsOf(...moves: string[]): MoveFacts {
  const game = new Chess();
  for (const san of moves) game.move(san);
  const facts = lastMoveFacts(game.pgn());
  assert.ok(facts, moves.join(" "));
  return facts;
}

const always = () => 0;
const never = () => 0.999999;
const voiceOf = (piece: PieceAt) => voiceId(piece.side === "w" ? "ivory" : "sun", piece.rank, pawnSlot(piece.square));
const context = (memory: BarkMemory = emptyBarkMemory(), ply = 10, extra: Partial<BarkContext> = {}): BarkContext => ({ ply, memory, voiceOf, ...extra });

test("a move's facts: how the piece went, and what it did to the pieces round it", () => {
  const pawn = factsOf("e4");
  assert.deepEqual([pawn.side, pawn.rank, pawn.from, pawn.to, pawn.direction, pawn.leap], ["w", "p", "e2", "e4", "advance", false]);
  const knight = factsOf("Nf3");
  assert.equal(knight.leap, true, "a knight leaps; a pawn steps");
  assert.equal(factsOf("Nf3", "e5", "Ng1").direction, "retreat", "a retreat is not an advance");
  assert.equal(factsOf("e4", "e5", "Ke2", "d6", "Kf3", "c6", "Ke2").direction, "retreat");
  assert.equal(factsOf("e4", "e5", "Ke2", "d6", "Kf3", "c6", "Kg3").direction, "level");
  assert.equal(factsOf("h4", "a6", "Rh3", "b6", "Rg3").direction, "level", "along its rank");
  assert.equal(factsOf("e4", "e5", "Ke2").direction, "advance", "black's advance is down the board, white's up it");
  assert.equal(factsOf("e4", "e5").direction, "advance");
});

test("danger, escape and threat: taken for less than it is worth, or for nothing", () => {
  // 1. e4 d5: the pawn on d5 attacks e4, defended by nothing: e4 is threatened, and d5 stands where it can be taken.
  const d5 = factsOf("e4", "d5");
  assert.deepEqual(d5.threatened.map((p) => p.square), ["e4"]);
  assert.equal(d5.intoDanger, false, "d5 is attacked by a pawn, worth no less, and defended by the queen: an even trade is no danger");
  // A queen that walks onto a square a pawn guards is in danger, though defended.
  assert.equal(factsOf("e4", "e5", "Qh5", "g6", "Qg4", "h5").threatened.some((p) => p.square === "g4" && p.rank === "q"), true);
  // Out of reach again.
  const escape = factsOf("e4", "d5", "e5");
  assert.equal(escape.escaped, true, "the e-pawn steps out of the d-pawn's reach");
  assert.equal(escape.intoDanger, false);
  // The king walking out of check escapes; the most valuable piece threatened is named first.
  assert.equal(moveFacts("4r2k/8/8/8/8/8/8/4K3 w - - 0 1", { from: "e1", to: "d2" })?.escaped, true, "the king steps out of check");
  const fork = factsOf("e4", "e5", "Nf3", "Nc6", "Ng5", "Nf6", "Nxf7");
  assert.equal(fork.threatened[0].rank, "q", "the queen before the rook");
});

test("who saw a comrade fall, and who the fallen was to them; and an avenger", () => {
  // 1. e4 d5 2. exd5: d5 fell; its comrades beside it saw.
  const take = factsOf("e4", "d5", "exd5");
  assert.deepEqual(take.capture, { square: "d5", rank: "p", side: "b" });
  assert.ok(take.witnesses.length === 0 || take.witnesses.every((w) => w.side === "b" && w.rank !== "k"));
  const near = factsOf("e4", "e5", "d4", "d6", "dxe5");
  assert.ok(near.witnesses.some((w) => w.square === "d6"), "d6 stood beside e5");
  assert.equal(near.witnesses.find((w) => w.square === "d6")?.kind, "stranger");
  // Two pawns that stood side by side from the start were companions.
  const old = factsOf("a3", "e5", "a4", "d6", "a5", "c6", "h3", "a6", "h4", "h6", "d4", "h5", "dxe5");
  assert.equal(old.witnesses.find((w) => w.square === "d6")?.kind, "companion");
  assert.equal(factsOf("a3", "e5", "a4", "d6", "a5", "c6", "d4", "a6", "dxe5").witnesses.find((w) => w.square === "d6")?.kind, "stranger",
    "d6 came only lately");
  // The queen's fall is royal to whoever saw it.
  const queen = moveFacts("4k3/3p1p2/4q3/8/2B5/8/8/4K3 w - - 0 1", { from: "c4", to: "e6" });
  assert.deepEqual(queen?.witnesses.map((w) => [w.square, w.kind]), [["d7", "royal"], ["f7", "royal"]]);
  // So is the fall of the king's last guard.
  const guard = moveFacts("4k3/3p4/8/8/8/8/8/3RK3 w - - 0 1", { from: "d1", to: "d7" });
  assert.deepEqual(guard?.witnesses.map((w) => w.kind), []);
  const last = moveFacts("3k4/2pr4/8/8/8/8/8/3RK3 w - - 0 1", { from: "d1", to: "d7" });
  assert.deepEqual(last?.witnesses.map((w) => [w.square, w.kind]), [["c7", "stranger"]], "the c-pawn still guards the king");
  // A piece that had killed this game is a veteran to the comrades who see it fall.
  const veteran = factsOf("e4", "d5", "exd5", "Nf6", "Nc3", "c6", "a3", "Nxd5", "Nxd5");
  assert.equal(veteran.capture?.rank, "n");
  assert.deepEqual(veteran.witnesses.map((w) => [w.square, w.kind]), [["c6", "veteran"]], "that knight had killed: the army knew it");
  assert.equal(veteran.avenged, true, "and the one who took it avenged the pawn it killed");
  // Taking the piece that has just killed a comrade avenges it, and its square was the comrade's grave.
  const avenge = factsOf("e4", "d5", "exd5", "Qxd5");
  assert.equal(avenge.avenged, true);
  assert.equal(avenge.grave, true);
  assert.equal(factsOf("e4", "d5", "exd5", "c6", "Nc3", "cxd5").avenged, true, "the c-pawn takes the pawn that killed its neighbour");
  assert.equal(factsOf("e4", "d5", "exd5", "Nf6", "d6", "cxd6").avenged, true, "followed to where it went");
  assert.equal(factsOf("e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6").avenged, false, "that knight had killed no one");
  assert.equal(factsOf("e4", "d5", "exd5").avenged, false);
  // En passant: the fallen stood beside the square the mover took.
  const passant = factsOf("e4", "a6", "e5", "d5", "exd6");
  assert.deepEqual(passant.capture, { square: "d5", rank: "p", side: "b" });
});

test("beside the enemy king, a castling, a promotion", () => {
  assert.equal(factsOf("e4", "f5", "exf5", "Kf7", "f6").besideKing, true, "the pawn on f6 stands beside the king on f7");
  assert.equal(factsOf("e4").besideKing, false);
  const castle = factsOf("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O");
  assert.deepEqual(castle.castle, { rookFrom: "h1", rookTo: "f1" });
  const queenside = factsOf("d4", "d5", "Nc3", "Nc6", "Bf4", "Bf5", "Qd2", "Qd7", "O-O-O");
  assert.deepEqual(queenside.castle, { rookFrom: "a1", rookTo: "d1" });
  const promote = moveFacts("1r5k/P7/8/8/8/8/8/4K3 w - - 0 1", { from: "a7", to: "b8", promotion: "q" });
  assert.equal(promote?.promotion, "q");
  assert.equal(promote?.capture?.rank, "r");
});

test("who speaks about a move, and when: the lift, the landing, the rook, the remade piece", () => {
  // A plain step, said as the hand lifts the piece.
  assert.deepEqual(planBarks(factsOf("e4"), always, context()).map((p) => [p.event, p.moment, p.speaker.square]), [["moved", "lift", "e2"]]);
  // A check is the king's moment: nothing else is said, but for a castling or a promotion.
  assert.deepEqual(planBarks(factsOf("e4", "f5", "Qh5+"), always, context()), []);
  // A castling: the king as he lands, the rook answering when it lands, allowed to wait for him.
  const castle = planBarks(factsOf("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"), always, context());
  assert.deepEqual(castle.map((p) => [p.event, p.moment, p.speaker.rank, p.speaker.square]), [["castle", "land", "k", "g1"], ["castle", "rook", "r", "f1"]]);
  assert.equal(castle[1].wait, AFTERMATH_WAIT);
  // A quiet promotion: the footsoldier on its last step, then the same piece in the voice of what it became.
  const quiet = planBarks(moveFacts("8/P6k/8/8/8/8/8/4K3 w - - 0 1", { from: "a7", to: "a8", promotion: "q" }) as MoveFacts, always, context());
  assert.deepEqual(quiet.map((p) => [p.event, p.moment, p.speaker.rank]), [["promote", "lift", "p"], ["promoted", "promoted", "q"]]);
  // A promotion that gives check: the footsoldier's last step, and then the king's line, not the remade piece's.
  const checking = planBarks(moveFacts("8/P7/8/8/8/8/8/k3K3 w - - 0 1", { from: "a7", to: "a8", promotion: "q" }) as MoveFacts, always, context());
  assert.deepEqual(checking.map((p) => p.event), ["promote"]);
  // A promotion that fights for its square: the plea and the cry have it; only the remade piece speaks.
  const fought = planBarks(moveFacts("1r6/P7/7k/8/8/8/8/4K3 w - - 0 1", { from: "a7", to: "b8", promotion: "q" }) as MoveFacts, always, context());
  assert.deepEqual(fought.map((p) => p.event), ["promoted"]);
  // An avenger speaks before the plain killer, after the death cry (it may wait for it).
  const avenge = planBarks(factsOf("e4", "d5", "exd5", "Qxd5"), always, context());
  assert.deepEqual(avenge.map((p) => [p.event, p.moment]), [["avenged", "land"]]);
  assert.equal(avenge[0].wait, AFTERMATH_WAIT);
  // With every roll failing, nobody speaks.
  assert.deepEqual(planBarks(factsOf("e4", "e5", "Nf3"), never, context()), []);
});

test("a witness says who the fallen was to them; a fuller memory of the battle can say otherwise", () => {
  const facts = factsOf("a3", "e5", "a4", "d6", "a5", "c6", "h3", "a6", "h4", "h6", "d4", "h5", "dxe5");
  // Make the killer's own line fail and the witness's pass.
  let draws = 0;
  const random = () => (draws++ === 0 ? 0.99 : 0);
  const plans = planBarks(facts, random, context());
  assert.equal(plans[0].speaker.square, "d6");
  assert.equal(plans[0].event, "companion");
  draws = 0;
  const veteran = planBarks(facts, random, context(emptyBarkMemory(), 10, { witnessKind: () => "veteran" }));
  assert.equal(veteran[0].event, "veteran");
});

test("a vengeance the board's few plies forgot is still one when the battle's memory says so, and the memory can say no", () => {
  // The queen takes the pawn that killed its own five plies on: past AVENGE_PLIES, the board alone has forgotten.
  const late = factsOf("e4", "d5", "exd5", "a6", "h3", "h6", "h4", "Qxd5");
  assert.equal(late.avenged, false);
  assert.notEqual(planBarks(late, always, context())[0]?.event, "avenged");
  assert.deepEqual(planBarks(late, always, context(emptyBarkMemory(), 10, { avenged: () => true })).map((p) => [p.event, p.moment]), [["avenged", "land"]]);
  // A memory that cannot place the move (null) leaves the board's answer; one that knows better overrules it.
  const prompt = factsOf("e4", "d5", "exd5", "Qxd5");
  assert.equal(planBarks(prompt, always, context(emptyBarkMemory(), 10, { avenged: () => null }))[0].event, "avenged");
  assert.notEqual(planBarks(prompt, always, context(emptyBarkMemory(), 10, { avenged: () => false }))[0]?.event, "avenged");
});

test("a voice rests after it speaks, a plain step is remarked at most every few plies, fast exhibitions say less", () => {
  const memory = emptyBarkMemory();
  memory.spokeAt.ivory_p1 = 9;
  assert.deepEqual(planBarks(factsOf("e4"), always, context(memory, 10)), [], "the e-pawn's voice spoke a ply ago");
  const threatened = emptyBarkMemory();
  threatened.spokeAt.ivory_p1 = 2;
  assert.deepEqual(planBarks(factsOf("e4", "d5", "e5"), always, context(threatened, 3)).map((p) => p.event), ["escape"],
    "out of reach a move after the threat: said, though the voice spoke of the threat");
  assert.equal(planBarks(factsOf("e4"), always, context(memory, 9 + VOICE_REST_PLIES)).length, 1);
  const stepped = emptyBarkMemory();
  stepped.steppedAt = 10;
  assert.deepEqual(planBarks(factsOf("d4"), always, context(stepped, 10 + STEP_REST_PLIES - 1)), []);
  assert.equal(planBarks(factsOf("d4"), always, context(stepped, 10 + STEP_REST_PLIES)).length, 1);
  // At a fast exhibition's speed a plain step's chance is halved: a roll that passes at 1x fails at 3x.
  const roll = () => BARK_CHANCE.moved * 0.75;
  assert.equal(planBarks(factsOf("e4"), roll, context(emptyBarkMemory(), 10, { speed: 1 })).length, 1);
  assert.equal(planBarks(factsOf("e4"), roll, context(emptyBarkMemory(), 10, { speed: 3 })).length, 0);
  // The same game says the same things: the chances come from the move list.
  const a = planBarks(factsOf("e4", "e5", "Nf3"), seededRandom(barkSeed(["e4", "e5", "Nf3"], "plan")), context());
  const b = planBarks(factsOf("e4", "e5", "Nf3"), seededRandom(barkSeed(["e4", "e5", "Nf3"], "plan")), context());
  assert.deepEqual(a, b);
});

test("the lines: a bag per voice and event, never the same line twice running; a step says what fits its way", () => {
  assert.deepEqual(stepEvents("advance"), ["moved", "advance"]);
  assert.deepEqual(stepEvents("retreat"), ["moved", "retreat"]);
  assert.deepEqual(stepEvents("level"), ["moved"]);
  assert.deepEqual(planEvents({ event: "moved", speaker: { square: "g1", rank: "n", side: "w" }, moment: "lift" }, { direction: "retreat", leap: true }), ["moved"],
    "a knight's leap has its own lines, whichever way it goes");
  // A king stepping back can say his plain line or his retreat line, never his advance line.
  const retreat = barkClips("ivory_k", "moved").concat(barkClips("ivory_k", "retreat"));
  const memory = emptyBarkMemory();
  const random = seededRandom(7);
  const heard: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const clip = nextBark("ivory_k", stepEvents("retreat"), memory, random);
    if (!clip) { memory.last = undefined; continue; }
    assert.ok(retreat.includes(clip), clip);
    heard.push(takeBark("ivory_k", stepEvents("retreat"), memory, i * 10));
  }
  heard.forEach((clip, i) => assert.ok(i === 0 || clip !== heard[i - 1], `${clip} twice running`));
  // Peeking takes nothing: a line that could not sound is still the next one.
  const peeked = emptyBarkMemory();
  const first = nextBark("sun_p1", ["moved"], peeked, seededRandom(3));
  assert.equal(nextBark("sun_p1", ["moved"], peeked, seededRandom(99)), first);
  // A voice with one line for an event does not say it twice running.
  const one = emptyBarkMemory();
  const only = nextBark("kwind_n", ["danger"], one, Math.random) as string;
  takeBark("kwind_n", ["danger"], one, 1);
  assert.equal(nextBark("kwind_n", ["danger"], one, Math.random), null);
  assert.equal(only, "kwind_n_danger_1");
  // A new game forgets who rested when, not what was said.
  const kept = newGameBarkMemory(one);
  assert.deepEqual(kept.spokeAt, {});
  assert.equal(kept.last, "kwind_n_danger_1");
  assert.equal(kept.bags, one.bags);
});

test("the murmurs and the long silence rotate through the voices on the board", () => {
  const memory = emptyBarkMemory();
  const present = ["empire_p1", "empire_p2", "empire_q", "empire_k", "empire_n"];
  const voices: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const voice = nextAmbientVoice("empire", "murmur", present, memory, seededRandom(i)) as string;
    voices.push(voice);
    takeAmbientVoice("empire", "murmur", memory);
  }
  assert.ok(voices.every((voice) => ["empire_p1", "empire_p2", "empire_q", "empire_k"].includes(voice)));
  assert.deepEqual([...new Set(voices.slice(0, 4))].sort(), ["empire_k", "empire_p1", "empire_p2", "empire_q"], "all four before any repeats");
  assert.equal(nextAmbientVoice("empire", "idle", ["empire_n"], memory, Math.random), null, "a knight has no line for a long silence");
  assert.equal(nextAmbientVoice("sun", "idle", ["sun_k"], memory, Math.random), "sun_k", "a lone king speaks for his side");
});

test("the floor: a bark never sounds over another voice, nor hard on the heels of another bark", () => {
  const floor = { voices: [{ from: 10, to: 12.5 }], barkUntil: 0 };
  assert.equal(barkMaySound(floor, 11, 1), false, "over a plea");
  assert.equal(barkMaySound(floor, 9, 1.2), false, "running into a plea that is due");
  assert.equal(barkMaySound(floor, 12.5 + VOICE_CLEARANCE, 1), true, "after it, clear of it");
  assert.equal(barkMaySound(floor, 8, 1), true, "well before it");
  const after = { voices: [], barkUntil: 20 };
  assert.equal(barkMaySound(after, 20 + BARK_GAP - 0.1, 1), false);
  assert.equal(barkMaySound(after, 20 + BARK_GAP, 1), true);
  assert.equal(barkMaySound(after, 20 + ANSWER_GAP, 1, ANSWER_GAP), true, "the rook answers its king sooner");
});

test("every voice of every kingdom has all its lines, made and passed, at one level, short enough to be a reaction", () => {
  const lines = new Map(plan.lines.map((line) => [line.id, line]));
  for (const kingdom of KINGDOMS) {
    for (const slot of VOICE_SLOTS) {
      for (const event of BARK_EVENTS) {
        for (const clip of barkClips(`${kingdom}_${slot}`, event)) {
          assert.ok(lines.get(clip)?.event === event, `${clip} is a ${event} line in plan.json`);
          assert.ok(takes[clip], `${clip} was made`);
          assert.ok(isBarkClip(clip));
          const limit = event === "murmur" || event === "idle" ? 3.8 : 3.6;
          assert.ok(takes[clip].dur <= limit + 0.05, `${clip} runs ${takes[clip].dur} s`);
          const target = event === "promote" ? -17 : event === "murmur" || event === "idle" ? -21 : -19;
          assert.ok(Math.abs(takes[clip].lufs - target) <= 1.2, `${clip} at ${takes[clip].lufs} LUFS (aim ${target})`);
        }
      }
    }
  }
  // Every voice has the same lines in every kingdom, so no kingdom is quieter in a long game.
  for (const slot of VOICE_SLOTS) assert.ok(Object.keys(BARK_TAKES[slot]).length >= 8, slot);
  const requested = new Set(allRequestedClips());
  for (const line of plan.lines) if (line.role === "bark") assert.ok(requested.has(line.id), `${line.id} is asked for by the rules`);
});

test("a long game: who speaks, how often, and never the same line twice running", () => {
  // Plays 120 plies of a seeded game (captures and checks preferred), with each ply four seconds long and every bark as
  // long as its take, through the rules and the floor as the scene and the mixer use them.
  for (const seed of [1, 2, 3]) {
    const pick = seededRandom(seed);
    const game = new Chess();
    const memory = emptyBarkMemory();
    const heard: { clip: string; voice: string; ply: number }[] = [];
    let barkUntil = -Infinity;
    for (let ply = 1; ply <= 120 && !game.isGameOver(); ply += 1) {
      const moves = game.moves({ verbose: true }) as Move[];
      const loud = moves.filter((m) => m.captured || m.san.includes("+"));
      const pool = loud.length && pick() < 0.5 ? loud : moves;
      game.move(pool[Math.floor(pick() * pool.length)].san);
      const facts = lastMoveFacts(game.pgn()) as MoveFacts;
      const san = game.history();
      const plans = planBarks(facts, seededRandom(barkSeed(san, "plan")), { ply, memory, voiceOf });
      const now = ply * 4;
      for (const p of plans) {
        const voice = voiceOf(p.speaker);
        const events = planEvents(p, facts);
        const clip = nextBark(voice, events, memory, seededRandom(barkSeed(san, `${p.event}:${p.speaker.square}`)), ply);
        if (!clip) continue;
        const gap = p.moment === "rook" || p.moment === "promoted" ? ANSWER_GAP : BARK_GAP;
        const at = p.moment === "rook" || p.moment === "promoted" ? Math.max(now, barkUntil + gap) : now;
        if (!barkMaySound({ voices: [], barkUntil }, at, takes[clip].dur, gap)) continue;
        takeBark(voice, events, memory, ply);
        heard.push({ clip, voice, ply });
        barkUntil = at + takes[clip].dur;
      }
    }
    const plies = game.history().length;
    assert.ok(heard.length >= plies / 12 && heard.length <= plies / 2.5, `seed ${seed}: ${heard.length} lines over ${plies} plies`);
    heard.forEach((h, i) => assert.ok(i === 0 || h.clip !== heard[i - 1].clip, `seed ${seed}: ${h.clip} twice running`));
    const counts = new Map<string, number>();
    for (const h of heard) counts.set(h.clip, (counts.get(h.clip) ?? 0) + 1);
    assert.ok(Math.max(...counts.values()) <= 2, `seed ${seed}: a line heard ${Math.max(...counts.values())} times: ${[...counts].filter(([, n]) => n > 2)}`);
    // No line comes round within thirty moves.
    for (let i = 0; i < heard.length; i += 1) {
      const again = heard.slice(i + 1).find((h) => h.clip === heard[i].clip);
      if (again) assert.ok(again.ply - heard[i].ply >= LINE_REST_PLIES, `seed ${seed}: ${heard[i].clip} again after ${again.ply - heard[i].ply} plies`);
    }
    // A voice that spoke rests (a castling, a promotion and an escape excepted).
    for (let i = 1; i < heard.length; i += 1) {
      const earlier = heard.slice(0, i).reverse().find((h) => h.voice === heard[i].voice);
      if (earlier && !/_(castle|promote|promoted|escape)_/.test(heard[i].clip)) assert.ok(heard[i].ply - earlier.ply >= VOICE_REST_PLIES, `seed ${seed}: ${heard[i].voice} spoke again after ${heard[i].ply - earlier.ply} plies`);
    }
  }
});

test("the barks' events are all ruled: each has a chance, and each voice's lines are in BARK_TAKES", () => {
  for (const event of BARK_EVENTS) assert.ok(typeof BARK_CHANCE[event as BarkEvent] === "number", event);
  assert.equal(moveFacts("8/8/8/8/8/8/8/K6k w - - 0 1", { from: "a1", to: "a8" }), null, "an illegal move has no facts");
});
