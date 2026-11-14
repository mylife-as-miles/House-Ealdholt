import { Chess } from "../../../node_modules/chess.js/dist/esm/chess.js";
let workers = 0, live = 0, posts = 0;
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  terminated = false;
  constructor() { workers += 1; live += 1; }
  postMessage(msg: { id: number; fen: string }) {
    posts += 1;
    setTimeout(() => {
      if (this.terminated) return;
      const c = new Chess(msg.fen);
      const ms = c.moves({ verbose: true });
      const m = ms[Math.floor(Math.random() * ms.length)];
      this.onmessage?.({ data: m ? { id: msg.id, from: m.from, to: m.to, promotion: m.promotion ?? null, score: 0, depth: 1 } : null });
    }, 5);
  }
  terminate() { if (!this.terminated) { this.terminated = true; live -= 1; } }
}
(globalThis as any).Worker = FakeWorker;
const { GameController } = await import("../../../web/src/core/gameController.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Zombie: AI battle (demo), dispose during the think-time floor.
{
  const g = new GameController();
  let illegal = 0; g.on("illegal", () => illegal++);
  g.start({ mode: "demo", difficulty: "easy", playerColor: "w", clockMinutes: null, demo: { white: "easy", black: "easy", speed: 4, autoRematch: false } });
  await sleep(100); // worker replied; controller now waiting out the floor (1150/4 ms)
  console.log("Z before dispose: plies", g.getSnapshot().sanList.length, "workers", workers, "live", live);
  g.dispose();
  console.log("Z right after dispose: live workers", live);
  await sleep(3000);
  // snapshot is still rebuilt by publish() even without listeners
  console.log("Z 3s after dispose: plies", g.getSnapshot().sanList.length, "workers created", workers, "live", live, "posts", posts, "status", g.getSnapshot().status);
  g.stop();
}
// --- Pause/resume with a held move.
{
  workers = 0; live = 0; posts = 0;
  const g = new GameController();
  const log: string[] = [];
  g.on("illegal", (e) => log.push(`illegal ${e.from}${e.to}`));
  g.on("move", (e) => log.push(`move ${e.san}`));
  // animator of 300 ms, like a plain glide
  g.setAnimator(() => sleep(300));
  g.start({ mode: "demo", difficulty: "easy", playerColor: "w", clockMinutes: null, demo: { white: "easy", black: "easy", speed: 1, autoRematch: false } });
  await sleep(200);            // search done, in floor wait
  g.setPaused(true);
  await sleep(1500);           // floor elapsed -> move is held
  const p0 = posts;
  console.log("P paused: plies", g.getSnapshot().sanList.length, "thinking", g.getSnapshot().thinking, "posts", posts);
  g.setPaused(false);
  await sleep(50);
  console.log("P 50ms after resume: posts since resume", posts - p0, "thinking(snapshot)", g.getSnapshot().thinking);
  await sleep(2500);
  console.log("P log:", log.join(" | "));
  g.stop(); g.dispose();
}
