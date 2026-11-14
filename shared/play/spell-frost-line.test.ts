import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROWN_POWER, FROST_BUDGET, SPIKE_BOUNCE, frontArrives, frostChunks, frostLine, frostParticles, frostSpikes, frostState, frostTimeline, kingHeight, rimeArrives, spikeAxis,
  type FrostCast,
} from "../../web/src/scene/vfx/spells/frost/frostPlan";
import { PARTICLE_KIND } from "../../web/src/scene/vfx/spells/shared/particlePlan";
import { chunkFlight } from "../../web/src/scene/vfx/spells/shared/solidPlan";

const TILE = 1.02;
const tiers = ["low", "medium", "high", "ultra"] as const;
const hand = { x: -1.5 * TILE, y: 1.2, z: 1.5 * TILE }, stone = { x: 1.5 * TILE, y: 0, z: -1.5 * TILE };
const make = (options: { quality?: (typeof tiers)[number]; power?: number; brief?: boolean; seed?: number; squares?: number; violence?: "minimal" | "cinematic" | "full" } = {}): FrostCast & { hand: typeof hand } => {
  const squares = options.squares ?? 3, from = { x: stone.x - squares * TILE, y: 1.2, z: stone.z + squares * TILE };
  const line = frostLine(from, stone, 0, TILE), power = options.power ?? 1;
  return {
    line, chest: { x: stone.x, y: 0.62, z: stone.z }, timeline: frostTimeline(line.length, power, options.brief ?? false), budget: FROST_BUDGET[options.quality ?? "high"], power, seed: options.seed ?? 9,
    tile: TILE, hand: from, violence: options.violence ?? "cinematic",
  };
};

test("the line starts on the stone in front of the caster and ends under the victim", () => {
  const line = frostLine(hand, stone, 0, TILE);
  assert.equal(line.from.y, 0); assert.deepEqual(line.to, stone);
  const out = Math.hypot(line.from.x - hand.x, line.from.z - hand.z);
  assert.ok(Math.abs(out - 0.5 * TILE) < 1e-9, "half a square out from under the hand");
  assert.ok(Math.abs(line.length + out - Math.hypot(stone.x - hand.x, stone.z - hand.z)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(line.along.x, line.along.z) - 1) < 1e-9);
  assert.ok(Math.abs(line.along.x * line.across.x + line.along.z * line.across.z) < 1e-12);
  const close = frostLine({ x: 0, y: 1.2, z: TILE }, { x: 0, y: 0, z: 0 }, 0, TILE);
  assert.ok(close.length > 0.6 && close.length < TILE, "a cast at the next square still has a line to run");
});

test("the spell runs in order: gather, travel, the blow, a hold, the shatter, the thaw", () => {
  for (const length of [0.7, 2, 4.3, 9.7]) for (const power of [1, 1.75]) {
    const t = frostTimeline(length, power, false);
    assert.equal(t.gather[0], 0); assert.equal(t.gather[1], t.travel[0]); assert.equal(t.travel[1], t.strikeAt);
    assert.ok(t.travel[1] - t.travel[0] >= 0.5, "the line is seen to run");
    assert.ok(t.release - t.strikeAt >= 1.6 && t.release - t.strikeAt <= 2.2, "the body hangs on the great spike nearly two seconds, to be watched up close");
    assert.ok(t.shatter[0] - t.strikeAt >= 0.4 && t.release > t.shatter[0], "the row stands a moment, and breaks before the great spike lets go");
    assert.ok(t.crack > t.strikeAt + 0.3 && t.crack < t.release - 0.2, "at Full it cracks in the body during the hold");
    assert.ok(t.shatter[1] > t.shatter[0] && t.thaw[0] > t.shatter[0] && t.thaw[1] <= t.duration && t.duration > t.shatter[1] + 1);
    assert.ok(t.strikeAt <= 1.75 && t.duration < 6, `no cast is long (${t.duration})`);
  }
  assert.ok(frostTimeline(9.7, 1, false).strikeAt > frostTimeline(2, 1, false).strikeAt, "a longer line takes longer to run");
  assert.ok(frostTimeline(4, 1.75, false).duration > frostTimeline(4, 1, false).duration, "a Queen's stands longer");
  const brief = frostTimeline(9.7, 1.75, true);
  assert.ok(brief.brief && brief.strikeAt <= 0.7 && brief.duration <= 2.5);
  assert.deepEqual(brief, frostTimeline(1, 1, true), "the brief form is the same for every cast");
});

test("the blow lands at strikeAt and not a frame before; the spell starts from nothing and ends done", () => {
  for (const brief of [false, true]) {
    const t = frostTimeline(4.3, 1, brief);
    const first = frostState(t, 0);
    assert.equal(first.struck, false); assert.equal(first.hand, 0); assert.equal(first.front, 0); assert.equal(first.shake, 0); assert.equal(first.done, false); assert.equal(first.sinceStrike, -1);
    assert.equal(frostState(t, t.strikeAt - 1e-6).struck, false);
    assert.equal(frostState(t, t.strikeAt).struck, true);
    assert.equal(frostState(t, t.duration - 1e-6).done, false);
    const last = frostState(t, t.duration);
    assert.equal(last.done, true); assert.equal(last.thaw, 1); assert.ok(last.glow < 1e-6 && last.shake === 0 && last.flash < 1e-6);
  }
});

test("the rime runs ahead of the spikes, both only forward, and every envelope stays in range", () => {
  const t = frostTimeline(4.3, 1.75, false);
  let last = frostState(t, 0), led = false;
  for (let s = 0; s <= t.duration + 0.2; s += 1 / 120) {
    const now = frostState(t, s, 1.75);
    assert.ok(now.rime >= now.front - 1e-9, `the rime is never behind the spikes (${s.toFixed(2)})`);
    assert.ok(now.rime >= last.rime && now.front >= last.front && now.thaw >= last.thaw);
    for (const key of ["hand", "rime", "front", "frost", "flash", "thaw"] as const) assert.ok(now[key] >= 0 && now[key] <= 1, key);
    assert.ok(now.shake >= 0 && now.shake <= 1 && now.glow >= 0 && now.glow < 6);
    if (now.rime - now.front > 0.15) led = true;
    last = now;
  }
  assert.ok(led, "and by a clear margin in the middle of the run");
  const mid = (t.travel[0] + t.travel[1]) / 2;
  assert.ok(frostState(t, mid).front < 0.4, "the front starts slowly and hurries into the victim");
  assert.ok(Math.abs(frostState(t, rimeArrives(t, 0.6)).rime - 0.6) < 1e-6);
  assert.ok(Math.abs(frostState(t, frontArrives(t, 0.6)).front - 0.6) < 1e-6);
});

test("the blow shakes and flashes; the brief form does neither", () => {
  const t = frostTimeline(4.3, 1, false), b = frostTimeline(4.3, 1, true);
  assert.ok(frostState(t, t.strikeAt + 0.01).shake > 0.3 && frostState(t, t.strikeAt + 0.01, 1.75).shake > frostState(t, t.strikeAt + 0.01, 1).shake);
  assert.ok(frostState(t, t.strikeAt + 0.01).glow > 3, "the blow lights the room");
  assert.equal(frostState(t, t.strikeAt + 1).shake, 0);
  let brightest = 0, jump = 0, before = 0;
  for (let s = 0; s <= b.duration; s += 1 / 120) {
    const now = frostState(b, s);
    assert.equal(now.shake, 0); assert.equal(now.flash, 0);
    brightest = Math.max(brightest, now.glow); jump = Math.max(jump, Math.abs(now.glow - before)); before = now.glow;
  }
  assert.ok(brightest <= 1 && jump < 0.05, "its light only swells and ebbs");
});

test("the field: one great spike under the victim, a cluster round it, a row that grows toward it", () => {
  const cast = make(), spikes = frostSpikes(cast), { line, timeline } = cast;
  const king = spikes[0];
  assert.equal(king.role, "king"); assert.ok(king.birth < timeline.strikeAt && king.birth > timeline.strikeAt - 0.15, "its point is out of the victim at the blow");
  const ahead = (king.root.x - line.to.x) * -line.along.x + (king.root.z - line.to.z) * -line.along.z;
  assert.ok(ahead > 0.2 && Math.hypot(king.root.x - line.to.x, king.root.z - line.to.z) < 0.5 * TILE, "it comes up on the victim's square, in front of it, at the end of the line");
  assert.ok(king.lean.x * line.along.x + king.lean.z * line.along.z > 0.3, "and leans back through it");
  for (const spike of spikes.slice(1)) assert.ok(spike.height < king.height * 0.8, "nothing rivals it");
  assert.ok(king.height > 1.8 && king.height < 2.2, "it stands over a figure");
  const cluster = spikes.filter((spike) => spike.role === "cluster"), row = spikes.filter((spike) => spike.role === "line");
  assert.equal(cluster.length, FROST_BUDGET.high.cluster); assert.ok(row.length >= 8);
  assert.equal(spikes.filter((spike) => spike.role === "crown").length, 0, "a Bishop raises no crown");
  for (const spike of cluster) {
    const out = Math.hypot(spike.root.x - line.to.x, spike.root.z - line.to.z);
    assert.ok(out > 0.2 * TILE && out < 0.55 * TILE, "the cluster stays on the victim's square");
    assert.ok(spike.lean.x * (spike.root.x - line.to.x) + spike.lean.z * (spike.root.z - line.to.z) > 0, "and leans away from the great spike");
    assert.ok(spike.birth >= timeline.strikeAt && spike.birth < timeline.strikeAt + 0.12);
  }
  let lastBirth = 0;
  row.forEach((spike, i) => {
    const dx = spike.root.x - line.from.x, dz = spike.root.z - line.from.z;
    const along = dx * line.along.x + dz * line.along.z, off = Math.abs(dx * line.across.x + dz * line.across.z);
    assert.ok(Math.abs(along - spike.along * line.length) < 1e-9);
    assert.ok(along > 0.05 && along < line.length - 0.45 * TILE, "the row stops short of the victim's square");
    assert.ok(off < 0.3 * TILE, "and keeps to its line: the squares beside it have neighbours");
    assert.ok(spike.radius * 2 < 0.5 * TILE && spike.height < 1.3);
    if (i > 0) assert.ok(spike.along > row[i - 1].along, "listed from the caster's end");
    assert.ok(spike.birth >= lastBirth - 0.035, "and erupting in that order, give or take a stagger");
    lastBirth = spike.birth;
    assert.ok(spike.birth >= timeline.travel[0] && spike.birth < timeline.strikeAt + 0.03);
    assert.ok(Math.abs(spike.birth - frontArrives(timeline, spike.along)) <= 0.03 + 1e-9, "each as the front reaches it");
    assert.ok(spike.lean.x * line.along.x + spike.lean.z * line.along.z > 0, "leaning the way the line runs");
  });
  const near = row.filter((spike) => spike.along < 0.35), far = row.filter((spike) => spike.along > 0.6);
  const mean = (list: typeof row) => list.reduce((sum, spike) => sum + spike.height, 0) / list.length;
  assert.ok(mean(far) > mean(near) * 1.5 && mean(near) < 0.4, "ankle-high near the caster, tall near the victim");
  assert.ok(far.length > near.length, "and crowding toward the victim");
});

test("the great spike's point comes out of the victim's back at the blow, overshoots, and settles", () => {
  const cast = make(), spikes = frostSpikes(cast), strike = cast.timeline.strikeAt, king = spikes[0], exit = king.blood!.exit * king.height;
  assert.equal(kingHeight(spikes, king.birth, false), 0);
  assert.ok(kingHeight(spikes, strike - 0.004, false) < exit && kingHeight(spikes, strike + 0.004, false) > exit, "through the body on the frame of the blow");
  assert.ok(strike - king.birth < 0.1, "a punch: out of the stone and through in under a tenth of a second");
  assert.ok(kingHeight(spikes, king.birth + 0.175, false) > king.height * (1 + SPIKE_BOUNCE * 0.95));
  assert.ok(Math.abs(kingHeight(spikes, strike + 1, false) - king.height) < 0.01);
  const brief = make({ brief: true }), gentle = frostSpikes(brief), slow = gentle[0];
  assert.ok(Math.abs(kingHeight(gentle, brief.timeline.strikeAt, true) - slow.blood!.exit * slow.height) < 1e-3, "in the brief form too, slowly");
  for (let s = 0; s < 1.2; s += 0.01) assert.ok(kingHeight(gentle, s, true) <= slow.height + 1e-9, "and never springs past its height");
});

test("every spike stands through the hold, breaks in a wave from the caster's end, and the great spike goes last", () => {
  const cast = make({ power: 1.75 }), spikes = frostSpikes(cast), { shatter, duration } = cast.timeline;
  for (const spike of spikes) {
    assert.ok(spike.breakAt >= shatter[0] && spike.breakAt + spike.end <= shatter[1] + 1e-9);
    assert.ok(spike.breakAt + spike.end < duration);
    if (spike.role !== "king") assert.ok(spike.breakAt <= spikes[0].breakAt);
  }
  const row = spikes.filter((spike) => spike.role === "line");
  assert.ok(row.at(-1)!.breakAt - row[0].breakAt > 0.2, "the break runs the line");
  assert.ok(Math.abs(spikes[0].breakAt + spikes[0].end - shatter[1]) < 1e-9);
});

test("a Queen's is larger and has more to it; a higher tier has more of everything", () => {
  const bishop = frostSpikes(make()), queen = frostSpikes(make({ power: 1.75 }));
  assert.ok(queen[0].height > bishop[0].height * 1.2);
  assert.ok(queen.length > bishop.length + 7);
  const crown = queen.filter((spike) => spike.role === "crown");
  assert.equal(crown.length, 7); assert.ok(1.75 >= CROWN_POWER && 1 < CROWN_POWER);
  const stoneAt = make().line.to;
  crown.forEach((spike, i) => {
    assert.ok(Math.abs(Math.hypot(spike.root.x - stoneAt.x, spike.root.z - stoneAt.z) - 0.74 * TILE) < 1e-9);
    if (i > 0) assert.ok(spike.birth > crown[i - 1].birth, "the crown closes round the victim one spike after another");
  });
  let before = { spikes: 0, chunks: 0, light: 0, mist: 0 };
  for (const quality of tiers) {
    const cast = make({ quality }), spikes = frostSpikes(cast), chunks = frostChunks(cast, spikes), loose = frostParticles(cast, spikes, cast.hand);
    const now = { spikes: spikes.length, chunks: chunks.length, light: loose.light.length, mist: loose.mist.length };
    for (const key of ["spikes", "chunks", "light", "mist"] as const) assert.ok(now[key] > before[key], `${quality} ${key}`);
    assert.ok(chunks.length <= FROST_BUDGET[quality].chunks && loose.mist.length <= FROST_BUDGET[quality].mist);
    assert.ok(loose.light.length <= FROST_BUDGET[quality].sparks * 1.2 + 16, `${quality} keeps to its budget (${loose.light.length})`);
    before = now;
  }
  assert.ok(frostSpikes(make({ quality: "low" })).length <= 1 + 3 + 8, "the lowest tier is a dozen spikes");
});

test("the dice are the cast's: the same seed raises the same field, another seed a different one", () => {
  const a = make({ seed: 41 }), b = make({ seed: 41 }), c = make({ seed: 42 });
  const field = (cast: ReturnType<typeof make>) => { const spikes = frostSpikes(cast); return { spikes, chunks: frostChunks(cast, spikes), loose: frostParticles(cast, spikes, cast.hand) }; };
  assert.deepEqual(field(a), field(b));
  assert.notDeepEqual(field(a).spikes.map((spike) => spike.height), field(c).spikes.map((spike) => spike.height));
});

test("the pieces are thrown as their spike breaks, land near it, and have melted by the end", () => {
  const cast = make({ power: 1.75 }), spikes = frostSpikes(cast), chunks = frostChunks(cast, spikes);
  assert.ok(chunks.length > 30);
  const king = spikes[0], along = spikeAxis(king);
  const offAxis = (p: { x: number; y: number; z: number }) => {
    const d = { x: p.x - king.root.x, y: p.y - king.root.y, z: p.z - king.root.z }, t = d.x * along.x + d.y * along.y + d.z * along.z;
    return { t, off: Math.hypot(d.x - along.x * t, d.y - along.y * t, d.z - along.z * t) };
  };
  const pieces = chunks.filter((chunk) => offAxis(chunk.root).off < 1e-6);
  assert.ok(pieces.length >= 8, "the great spike falls in many pieces, from along it");
  for (const piece of pieces) {
    const share = offAxis(piece.root).t / king.height;
    assert.ok(share < king.blood!.entry || share > king.blood!.exit, "never from inside the body");
    assert.ok(piece.radius >= 0.035 - 1e-9, "and big enough to see");
  }
  for (const chunk of chunks) {
    assert.ok(chunk.loose && chunk.birth >= cast.timeline.shatter[0] && chunk.birth <= cast.timeline.shatter[1] + 1e-9);
    assert.ok(chunk.end <= cast.timeline.duration + 1e-9 && chunk.end - chunk.birth > 0.9);
    assert.ok(chunk.root.y >= 0 && chunk.radius < 0.2);
    const rest = chunkFlight(chunk.root, chunk.fling!, chunk.radius * 0.6, chunk.end - chunk.birth);
    assert.ok(Math.hypot(rest.x - chunk.root.x, rest.z - chunk.root.z) < 2.2 * TILE, "none is thrown across the board");
  }
  const owner = spikes[3], axis = spikeAxis(owner);
  assert.ok(Math.abs(Math.hypot(axis.x, axis.y, axis.z) - 1) < 1e-9 && axis.y > 0.7);
  assert.deepEqual(frostChunks(make({ brief: true }), frostSpikes(make({ brief: true }))), [], "in the brief form the spikes sink and nothing flies");
});

test("nothing loose outlives the spell, and the brief form has nothing that rushes", () => {
  for (const brief of [false, true]) for (const squares of [1, 3, 7]) {
    const cast = make({ brief, squares, power: 1.75 }), spikes = frostSpikes(cast), loose = frostParticles(cast, spikes, cast.hand);
    for (const particle of [...loose.light, ...loose.mist]) {
      assert.ok(particle.birth >= 0 && particle.life > 0 && particle.birth + particle.life <= cast.timeline.duration + 1e-9);
      assert.ok(Number.isFinite(particle.origin.x + particle.velocity.x + particle.size));
      if (brief) {
        assert.notEqual(particle.kind, PARTICLE_KIND.streak, "no splinters");
        assert.ok(Math.hypot(particle.velocity.x, particle.velocity.y, particle.velocity.z) < 0.6, "everything drifts");
      }
    }
    assert.ok(loose.mist.every((particle) => particle.kind === PARTICLE_KIND.puff));
    assert.ok(loose.light.every((particle) => particle.kind !== PARTICLE_KIND.puff));
    assert.ok(loose.light.some((particle) => particle.anchored), "the hand has its glow");
    for (const spike of spikes) assert.ok(spike.birth >= 0 && spike.rise > 0 && spike.breakAt + spike.end <= cast.timeline.duration);
    if (brief) for (const spike of spikes) assert.ok(spike.rise >= 0.45 && spike.end >= 0.45, "spikes ease up and sink back");
  }
});
