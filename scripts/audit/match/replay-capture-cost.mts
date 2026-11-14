import { Chess } from "../../../node_modules/chess.js/dist/esm/chess.js";
(globalThis as any).Worker = class { postMessage() {} terminate() {} };
const { GameController } = await import("../../../web/src/core/gameController.ts");
const { captureCompletedMatch } = await import("../../../shared/play/replay.ts");
function seeded(seed: number) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; }
for (const plies of [0, 80, 200, 400, 520]) {
  const rnd = seeded(11);
  const g = new GameController();
  g.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
  const c = new Chess(); let n = 0;
  while (n < plies && !c.isGameOver()) {
    const ms = c.moves({ verbose: true }); const m = ms[Math.floor(rnd() * ms.length)];
    c.move(m); await g.tryMove(m.from, m.to, m.promotion as any); n++;
  }
  if (g.getSnapshot().status === "playing") g.resign();
  const snap = g.getSnapshot();
  const cfg = { mode: "local-duel" as const, setting: "scene-01" as const, difficulty: "easy" as const, playerColor: "w" as const, clockMinutes: null };
  const t = performance.now();
  try {
    const e = captureCompletedMatch(snap, cfg, "match-test", new Date().toISOString());
    console.log(`plies=${n} reason=${snap.result?.reason} capture=${(performance.now() - t).toFixed(1)}ms result=${e.result} declared=${e.declaredResult ?? "-"} entryPlies=${e.plies}`);
  } catch (err) { console.log(`plies=${n} reason=${snap.result?.reason} capture THREW after ${(performance.now() - t).toFixed(1)}ms: ${(err as Error).message}`); }
  g.dispose();
}
