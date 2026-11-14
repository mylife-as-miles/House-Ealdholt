/**
 * The ribbons a caster draws in to the hand as it gathers (web/src/scene/vfx/flourish/gatherPlan.ts, drawn by
 * gather.ts on the spells' own ribbon), and where the match starts and ends them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GATHER, gatherEnvelope, gatherPeriod, spiralPoint, strandHead, strandWidth } from "../../web/src/scene/vfx/flourish/gatherPlan";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../web/src/scene/${path}`, import.meta.url)), "utf8");
const near = (a: number, b: number, by = 1e-9) => Math.abs(a - b) <= by;
const strand = (place: number, a: number, b: number, c: number) => ({ place, a, b, c });

test("a gather is a whole number of passes, ending as the spell leaves the hand", () => {
  for (const seconds of [0.45, 0.8, 1.25, 1.6, 2.4]) {
    const period = gatherPeriod(seconds), passes = seconds / period;
    assert.ok(period >= GATHER.quickest - 1e-9 && period <= 1.2, `${seconds}: ${period}`);
    if (seconds >= GATHER.quickest) assert.ok(near(passes, Math.round(passes), 1e-6), `${seconds}: whole passes (${passes})`);
  }
  assert.equal(gatherPeriod(0), GATHER.period);
});

test("the ribbons come up, hold and go out with the gather, and are never drawn outside it", () => {
  assert.equal(gatherEnvelope(-0.1, 1), 0);
  assert.equal(gatherEnvelope(0, 1), 0);
  assert.equal(gatherEnvelope(1, 1), 0);
  assert.equal(gatherEnvelope(2, 1), 0);
  assert.equal(gatherEnvelope(0.5, 1), 1);
  let last = 0;
  for (let t = 0; t <= GATHER.fadeIn; t += 0.01) { const e = gatherEnvelope(t, 1); assert.ok(e >= last); last = e; }
  for (let t = 1 - GATHER.fadeOut; t < 1; t += 0.01) { const e = gatherEnvelope(t, 1); assert.ok(e <= last + 1e-12); last = e; }
});

test("every ribbon spirals in to the hand, tightening, all of a cast turning the same way round it", () => {
  const strands = [strand(0, 0.1, 0.2, 0.3), strand(0.5, 0.6, 0.9, 0.1), strand(1, 0.85, 0.4, 0.95)];
  for (const s of strands) {
    const start = spiralPoint(0, s), end = spiralPoint(1, s);
    assert.ok(Math.hypot(start.x, start.z) >= GATHER.radius * 0.74, "begins well out");
    assert.ok(Math.hypot(end.x, end.y, end.z) < 1e-9, "ends in the hand");
    let radius = Infinity, turn = Math.atan2(start.z, start.x), turned = 0;
    for (let k = 0; k <= 1.0001; k += 0.02) {
      const p = spiralPoint(k, s), r = Math.hypot(p.x, p.z);
      assert.ok(r <= radius + 1e-9, "never widens");
      radius = r;
      if (r > 1e-4) { const a = Math.atan2(p.z, p.x); let d = a - turn; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; turned += d; turn = a; }
    }
    assert.ok(turned > Math.PI * 1.5, `turns the same way round (${(turned / Math.PI).toFixed(2)} pi)`);
  }
});

test("a ribbon's window slides in along its path: tapered, finer near the hand, and nothing where it is off its path", () => {
  for (let head = 0; head <= 1 + GATHER.run; head += 0.05) for (let t = 0; t <= 1; t += 0.05) {
    const w = strandWidth(t, head);
    assert.ok(w >= 0 && w <= GATHER.width + 1e-12);
    const s = head - (1 - t) * GATHER.run;
    if (s <= 0 || s >= 1) assert.equal(w, 0);
  }
  assert.equal(strandWidth(0, 0.6), 0, "its tail comes to nothing");
  assert.ok(strandWidth(0.8, 0.5) > strandWidth(0.8, 1.2), "finer as it nears the hand");
  for (let time = 0; time < 3; time += 0.07) {
    const head = strandHead(time, 0.6, strand(0.5, 0.3, 0.5, 0.5));
    assert.ok(head >= 0 && head < 1 + GATHER.run);
  }
  // the vertex shader is the same spiral
  const shader = source("vfx/flourish/gather.ts");
  assert.match(shader, /pow\(1\.0 - k, 1\.25\)/);
  assert.match(shader, /float h = \(-0\.45 \+ 1\.1 \* strand\.z\) \* uRadius \* \(1\.0 - k \* k\);/);
});

test("the match gathers ribbons while a spell or a summon is gathered, and lets them go as it leaves the hand", () => {
  const engine = source("sceneEngine.ts");
  assert.match(engine, /beginGather\(gathering, this\.castHand\(attacker\), release, army,/);
  assert.match(engine, /await pair\.stage\("strike", \(\) => pair\.wait\(release\)\);\n\s+this\.flourish\?\.endGather\(gathering\);/);
  assert.match(engine, /beginGather\(gathering, this\.castHand\(attacker\), gather, army,/);
  assert.match(engine, /beginGather\(`\$\{revision\}:summon`, this\.castHand\(attacker\), calling\.duration, entry\.army,/);
  // only Kwind-09's casts crackle
  assert.match(source("vfx/flourish/flourish.ts"), /army === "kwind"/);
});
