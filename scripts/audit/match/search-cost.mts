import { Chess } from "../../../node_modules/chess.js/dist/esm/chess.js";
const replies: any[] = [];
(globalThis as any).self = globalThis;
(globalThis as any).postMessage = (m: any) => replies.push(m);
await import("../../../web/src/ai/engine.worker.ts");
const run = (fen: string, difficulty: string) => {
  const t = performance.now();
  (globalThis as any).onmessage({ data: { id: 1, fen, difficulty } });
  return { ms: Math.round(performance.now() - t), reply: replies.pop() };
};
const positions: Record<string, string> = {
  start: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  middlegame: "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 9",
  tactical: "r2q1rk1/ppp2ppp/2n1bn2/2bpp3/4P3/2NP1NP1/PPP2PBP/R1BQ1RK1 w - - 0 8",
};
for (const [name, fen] of Object.entries(positions)) {
  for (const d of ["medium", "hard"]) {
    const r = run(fen, d);
    console.log(name, d, `${r.ms}ms`, "depth", r.reply?.depth, "move", r.reply?.from + r.reply?.to, "score", r.reply?.score);
  }
}
// raw cost of verbose vs non-verbose move generation
const c = new Chess(positions.middlegame);
let t = performance.now(); for (let i = 0; i < 2000; i++) c.moves({ verbose: true }); const v = (performance.now() - t) / 2000;
t = performance.now(); for (let i = 0; i < 2000; i++) c.moves(); const s = (performance.now() - t) / 2000;
t = performance.now(); for (let i = 0; i < 2000; i++) (c as any)._moves({ legal: true }); const raw = (performance.now() - t) / 2000;
console.log(`moves verbose ${v.toFixed(3)}ms, SAN ${s.toFixed(3)}ms, internal _moves ${raw.toFixed(3)}ms per call`);
// null (no id) reply for a terminal position
console.log("terminal reply:", JSON.stringify(run("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "medium").reply));
