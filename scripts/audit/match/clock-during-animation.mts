(globalThis as any).Worker = class { postMessage() {} terminate() {} };
const { GameController } = await import("../../../web/src/core/gameController.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// White stalemates Black with Kg6; Black has 1.2 s left; the move animation lasts 2 s (a capture cinematic is longer).
const g = new GameController();
g.setAnimator(() => sleep(2000));
g.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: 0.02, startingFen: "7k/5Q2/8/6K1/8/8/8/8 w - - 0 1" });
const moved = g.tryMove("g5", "g6");
await sleep(300);
const s1 = g.getSnapshot();
console.log("during animation: busy", s1.busy, "turn", s1.turn, "blackMs", Math.round(s1.clock.blackMs), "whiteMs", Math.round(s1.clock.whiteMs));
await moved; await sleep(100);
console.log("result:", JSON.stringify(g.getSnapshot().result), "(position is stalemate => should be a draw)");
g.dispose();
