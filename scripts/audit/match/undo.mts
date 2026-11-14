// Fake Worker: replies with first legal move after a short delay.
import { Chess } from "../../../node_modules/chess.js/dist/esm/chess.js";
let workers = 0;
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  terminated = false;
  constructor() { workers += 1; }
  postMessage(msg: { id: number; fen: string }) {
    setTimeout(() => {
      if (this.terminated) return;
      const c = new Chess(msg.fen);
      const m = c.moves({ verbose: true })[0];
      this.onmessage?.({ data: m ? { id: msg.id, from: m.from, to: m.to, promotion: m.promotion ?? null, score: 0, depth: 1 } : null });
    }, 5);
  }
  terminate() { this.terminated = true; }
}
(globalThis as any).Worker = FakeWorker;
const { GameController } = await import("../../../web/src/core/gameController.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Scenario 1: player is black, AI plays first move, then Undo.
{
  const g = new GameController();
  g.start({ mode: "ai", difficulty: "easy", playerColor: "b", clockMinutes: null });
  await sleep(700);
  let s = g.getSnapshot();
  console.log("S1 after AI first move:", s.sanList, "turn", s.turn, "canUndo", s.canUndo, "thinking", s.thinking);
  console.log("S1 undo() ->", g.undo());
  await sleep(1500);
  s = g.getSnapshot();
  console.log("S1 1.5s after undo:", s.sanList, "turn", s.turn, "thinking", s.thinking, "status", s.status, "isHumanTurn", g.isHumanTurn());
  g.dispose();
}
// --- Scenario 2: resign with zero moves, then undo (status resurrect).
{
  const g = new GameController();
  g.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 5 });
  g.resign();
  console.log("S2 after resign:", g.getSnapshot().status, g.getSnapshot().result);
  console.log("S2 undo() ->", g.undo(), "snapshot.status", g.getSnapshot().status, "isHumanTurn()", g.isHumanTurn());
  console.log("S2 tryMove e2e4 ->", await g.tryMove("e2", "e4"), "status", g.getSnapshot().status, "result", g.getSnapshot().result);
  const before = g.getSnapshot().clock.blackMs; await sleep(400);
  console.log("S2 clock ticking after resurrect?", before, "->", g.getSnapshot().clock.blackMs);
  g.dispose();
}
// --- Scenario 3: undo after checkmate in a timed hotseat game: clock restarts?
{
  const g = new GameController();
  g.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 5 });
  for (const [f, t] of [["f2","f3"],["e7","e5"],["g2","g4"],["d8","h4"]]) await g.tryMove(f, t);
  console.log("S3 status", g.getSnapshot().status, g.getSnapshot().result);
  console.log("S3 undo ->", g.undo(), "status", g.getSnapshot().status, "turn", g.getSnapshot().turn);
  const b0 = g.getSnapshot().clock.blackMs; await sleep(450);
  console.log("S3 black clock before/after 450ms:", b0, g.getSnapshot().clock.blackMs);
  g.dispose();
}
console.log("workers created:", workers);
