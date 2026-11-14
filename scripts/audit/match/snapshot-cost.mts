import { Chess } from "../../../node_modules/chess.js/dist/esm/chess.js";
(globalThis as any).Worker = class { postMessage() {} terminate() {} };
const { GameController } = await import("../../../web/src/core/gameController.ts");
function seeded(seed: number) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }
for (const plies of [20, 60, 120, 200]) {
  const rnd = seeded(7);
  const g = new GameController();
  g.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
  const c = new Chess();
  let n = 0;
  while (n < plies && !c.isGameOver()) {
    const ms = c.moves({ verbose: true });
    const m = ms[Math.floor(rnd() * ms.length)];
    c.move(m); await g.tryMove(m.from, m.to, m.promotion as any); n++;
  }
  const build = (g as any).buildSnapshot.bind(g);
  for (let i = 0; i < 5; i++) build();
  const t0 = performance.now(); const N = 30;
  for (let i = 0; i < N; i++) build();
  const per = (performance.now() - t0) / N;
  // split
  const chess = (g as any).chess as Chess;
  let t = performance.now(); for (let i = 0; i < N; i++) chess.history({ verbose: true }); const h = (performance.now() - t) / N;
  t = performance.now(); for (let i = 0; i < N; i++) chess.pgn(); const p = (performance.now() - t) / N;
  console.log(`plies=${n} buildSnapshot=${per.toFixed(2)}ms (history verbose ${h.toFixed(2)}ms, pgn ${p.toFixed(2)}ms) -> at 10Hz clock: ${(per * 10).toFixed(0)}ms/s main thread`);
  g.dispose();
}
console.log("empty pgn:", JSON.stringify(new Chess().pgn()));
