import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOENIX_SIZE, planPhoenix, phoenixWingbeats, type PhoenixPlanInput } from "../../web/src/scene/rites/phoenix/phoenixFlight";
import {
  LEG, PHOENIX_BUDGET, PLUME_KIND, legShape, lockTalons, phoenixPose, plumeBuffers, plumeLayout, plumePoints, wingShape, wingTips, writePlumes, type PlumeAnchors,
} from "../../web/src/scene/rites/phoenix/phoenixForm";
import { phoenixFlames } from "../../web/src/scene/rites/phoenix/flamePlan";

const TILE = 1.02;
const square = (file: number, rank: number) => ({ x: (file - 3.5) * TILE, z: (3.5 - (rank - 1)) * TILE });
const input = (over: Partial<PhoenixPlanInput> = {}): PhoenixPlanInput => {
  const queen = { ...square(3, 0 + 1), y: 0 }, stone = { ...square(3, 7), y: 0 };
  return { queen, stone, chest: { ...stone, y: 0.62 }, viewer: { x: 0, y: 6.4, z: 8.6 }, standing: [square(2, 7), square(4, 7), square(3, 8)], boardTop: 0, tile: TILE, hall: 11, seed: 3, brief: false, ...over };
};
const planned = (over: Partial<PhoenixPlanInput> = {}) => { const plan = planPhoenix(input(over)); lockTalons(plan, phoenixWingbeats(plan.timeline)); return plan; };
const anchors = (thread = 0, glow = 0): PlumeAnchors => ({ hand: { x: -0.5, y: 1.3, z: 3.6 }, thread, threadGlow: glow, pen: { x: -0.5, y: 1.9, z: 3.9 } });
const tiers = ["low", "medium", "high", "ultra"] as const;
type V3 = readonly number[];
const gap = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("the layout has every feather, leg and toe the tier asks for, two vertices a cut, and triangles between them", () => {
  for (const tier of tiers) {
    const budget = PHOENIX_BUDGET[tier], layout = plumeLayout(budget, 5, 2.3, 1);
    const count = (kind: number, wing?: number) => layout.specs.filter((spec) => spec.kind === kind && (wing === undefined || spec.wing === wing)).length;
    for (const wing of [1, -1]) {
      assert.equal(count(PLUME_KIND.feather, wing), budget.primaries + budget.secondaries + budget.tertials, `${tier}: flight feathers`);
      assert.equal(count(PLUME_KIND.covert, wing), budget.coverts + budget.lesser, `${tier}: coverts`);
      assert.equal(count(PLUME_KIND.leg, wing), 1, "a leg on each side");
      assert.equal(count(PLUME_KIND.toe, wing), 4, "three toes forward and one behind");
    }
    assert.equal(count(PLUME_KIND.streamer), budget.streamers);
    assert.equal(count(PLUME_KIND.rectrix), budget.rectrices);
    assert.equal(count(PLUME_KIND.plume), 5, "a crown of three and two crests");
    assert.equal(count(PLUME_KIND.beak), 2);
    assert.equal(count(PLUME_KIND.eye), 2);
    assert.equal(count(PLUME_KIND.thread), 1);
    assert.equal(layout.vertices, layout.specs.reduce((sum, spec) => sum + (spec.segments + 1) * 2, 0));
    assert.equal(layout.index.length, layout.specs.reduce((sum, spec) => sum + spec.segments * 6, 0));
    for (const i of layout.index) assert.ok(i < layout.vertices);
  }
  // The lowest tier draws well under half of what the highest does.
  assert.ok(plumeLayout(PHOENIX_BUDGET.low, 1, 2.3, 1).vertices * 1.8 < plumeLayout(PHOENIX_BUDGET.ultra, 1, 2.3, 1).vertices);
});

test("spread, the wings are sixteen to twenty units from tip to tip; folded through the seal they are narrow; raised over its back as it seizes", () => {
  const plan = planned(), T = plan.timeline, beats = phoenixWingbeats(T), layout = plumeLayout(PHOENIX_BUDGET.high, plan.seed, plan.bird, plan.unit);
  let widest = 0;
  for (let t = T.open[1]; t < T.sunburst - 0.35; t += 0.02) widest = Math.max(widest, wingTips(layout, phoenixPose(plan, beats, t), plan, anchors()).span);
  assert.ok(widest >= 0.88 * PHOENIX_SIZE.wingspan && widest <= 1.12 * PHOENIX_SIZE.wingspan, `wingspan ${widest.toFixed(2)}`);
  for (const t of [T.burst[0] + 0.15, T.burst[0] + 0.3]) {
    const span = wingTips(layout, phoenixPose(plan, beats, t), plan, anchors()).span;
    assert.ok(span < 0.35 * PHOENIX_SIZE.wingspan, `folded span ${span.toFixed(2)} at ${t}`);
  }
  // As the talons close the wings are thrown up over its back: the tips high over its body, clear of the heads round about.
  for (const t of [T.strikeAt - 0.03, T.strikeAt]) {
    const pose = phoenixPose(plan, beats, t), tips = wingTips(layout, pose, plan, anchors());
    assert.ok(Math.min(tips.left[1], tips.right[1]) > pose.centre[1] + 2, `the tips ${Math.min(tips.left[1], tips.right[1]).toFixed(2)} over its back at ${t}`);
  }
  assert.ok(wingShape(plan, T.burst[0] + 0.2).fold > 0.99);
  assert.ok(wingShape(plan, T.open[1]).fold < 0.01);
  assert.ok(wingShape(plan, T.open[0] + 0.2).flare > 0.8);
  assert.ok(wingShape(plan, T.dive[0] + 0.3).fold > 0.45, "half folded in the swoop");
  assert.ok(wingShape(plan, T.strikeAt).raise > 0.95 && wingShape(plan, T.strikeAt + 0.15).flare > 0.8, "raised as the talons close, flared as it brakes");
  assert.ok(wingShape(plan, (T.hover[0] + T.hover[1]) / 2).tail > 0.95, "the tail fanned as it hovers");
  assert.ok(wingShape(plan, T.sunburst - 0.15).flare > 0.95);
});

test("the legs: tucked in flight, thrown forward with the toes open to seize, closed on the body while it is carried, opened to let it go", () => {
  const plan = planned(), T = plan.timeline, beats = phoenixWingbeats(T);
  const approach = phoenixPose(plan, beats, (T.approach[0] + T.approach[1]) / 2);
  for (let w = 0; w < 2; w += 1) {
    const ankle = approach.legs[w][2], c = approach.centre, F = approach.forward;
    assert.ok((ankle[0] - c[0]) * F[0] + (ankle[1] - c[1]) * F[1] + (ankle[2] - c[2]) * F[2] < -0.2 * plan.bird, "tucked back under the tail");
  }
  assert.ok(legShape(plan, T.strikeAt - 0.3).clutch < 0.2, "the toes open before the talons close");
  assert.ok(legShape(plan, T.strikeAt + 0.05).clutch > 0.99, "closed on the body");
  assert.ok(legShape(plan, (T.hover[0] + T.hover[1]) / 2).clutch > 0.99 && legShape(plan, (T.hover[0] + T.hover[1]) / 2).hang > 0.99, "and hanging under it, closed, as it hovers");
  assert.ok(legShape(plan, T.release + 0.1).clutch < 0.2, "opened to let it go");
  // The bones keep their lengths, whatever the pose.
  for (let t = T.burst[0]; t < T.sunburst; t += 0.05) {
    const pose = phoenixPose(plan, beats, t);
    for (let w = 0; w < 2; w += 1) {
      const [hip, heel, ankle] = pose.legs[w];
      assert.ok(Math.abs(gap(hip, heel) - LEG.thigh * plan.bird) < 1e-6 && Math.abs(gap(heel, ankle) - LEG.tarsus * plan.bird) < 1e-6, `leg ${w} at ${t.toFixed(2)}`);
    }
  }
  // The talons: closed round the socket as it carries, and the socket on the chest as they close.
  assert.ok(gap(phoenixPose(plan, beats, T.strikeAt).socket, [plan.chest.x, plan.chest.y, plan.chest.z]) < 1e-3);
  const layout = plumeLayout(PHOENIX_BUDGET.high, plan.seed, plan.bird, plan.unit), points = new Float32Array(64 * 3), profile = new Float32Array(64 * 2);
  const carrying = phoenixPose(plan, beats, (T.hover[0] + T.hover[1]) / 2);
  for (const spec of layout.specs) {
    if (spec.kind !== PLUME_KIND.toe) continue;
    plumePoints(spec, carrying, plan, anchors(), points, profile);
    const n = spec.segments, tip = [points[n * 3], points[n * 3 + 1], points[n * 3 + 2]];
    assert.ok(gap(tip, carrying.socket) < 0.5 * plan.bird, `a talon ${gap(tip, carrying.socket).toFixed(2)} from the socket`);
    assert.ok(profile[n * 2 + 1] > 1, "the talons burn white");
  }
});

test("once it is out of the seal, nothing of the bird goes under the board: what reaches the stone spreads along it", () => {
  for (const over of [{}, { seed: 11 }, { stone: { ...square(7, 8), y: 0 }, chest: { ...square(7, 8), y: 0.7 } }] as Partial<PhoenixPlanInput>[]) {
    const plan = planned(over), T = plan.timeline, beats = phoenixWingbeats(T), layout = plumeLayout(PHOENIX_BUDGET.ultra, plan.seed, plan.bird, plan.unit);
    const buffers = plumeBuffers(layout);
    for (let t = T.open[1] + 0.3; t < T.sunburst; t += 1 / 60) {
      writePlumes(layout, phoenixPose(plan, beats, t), plan, anchors(), buffers);
      for (let v = 0; v < layout.vertices; v += 1) if (buffers.ribbon[v * 4 + 2] > 0) assert.ok(buffers.position[v * 3 + 1] > plan.boardTop + 0.035, `under the board at ${t.toFixed(2)}`);
    }
  }
});

test("every feather burns hottest at its root and cools toward its tip, and is a tongue: widest along it, pointed at the end", () => {
  const plan = planned(), beats = phoenixWingbeats(plan.timeline), layout = plumeLayout(PHOENIX_BUDGET.high, plan.seed, plan.bird, plan.unit);
  const pose = phoenixPose(plan, beats, plan.timeline.approach[0] + 0.5), points = new Float32Array(64 * 3), profile = new Float32Array(64 * 2);
  for (const spec of layout.specs) {
    if (spec.kind !== PLUME_KIND.feather && spec.kind !== PLUME_KIND.covert && spec.kind !== PLUME_KIND.rectrix) continue;
    plumePoints(spec, pose, plan, anchors(), points, profile);
    const n = spec.segments;
    for (let i = 1; i <= n; i += 1) assert.ok(profile[i * 2 + 1] <= profile[(i - 1) * 2 + 1] + 1e-9, "cools outward");
    assert.ok(profile[1] > 0.8 && profile[n * 2 + 1] < 0.3, "gold-white at the root, red at the tip");
    assert.ok(profile[n * 2] < 1e-6, "pointed");
    if (spec.kind !== PLUME_KIND.rectrix) { const widest = Math.max(...Array.from({ length: n + 1 }, (_, i) => profile[i * 2])); assert.ok(widest > profile[0], "widest along it, not at the root"); }
  }
});

test("the thread climbs from the hand only while it is lit; the bird is nothing before it comes through the seal and once it is the sun", () => {
  const plan = planned(), T = plan.timeline, beats = phoenixWingbeats(T), layout = plumeLayout(PHOENIX_BUDGET.medium, plan.seed, plan.bird, plan.unit), buffers = plumeBuffers(layout);
  const width = (kind: number) => {
    let most = 0;
    layout.specs.forEach((spec, index) => {
      if ((kind === -1 ? spec.kind === PLUME_KIND.thread : spec.kind !== PLUME_KIND.thread)) {
        for (let i = 0; i <= spec.segments; i += 1) most = Math.max(most, buffers.ribbon[(layout.first[index] + i * 2) * 4 + 2]);
      }
    });
    return most;
  };
  writePlumes(layout, phoenixPose(plan, beats, 0.1), plan, anchors(0.4, 1), buffers);
  assert.ok(width(-1) > 0 && width(0) === 0, "a thread, and no bird yet");
  writePlumes(layout, phoenixPose(plan, beats, 0.1), plan, anchors(0.4, 0), buffers);
  assert.equal(width(-1), 0, "an unlit thread is not drawn");
  writePlumes(layout, phoenixPose(plan, beats, T.approach[0] + 0.2), plan, anchors(), buffers);
  assert.ok(width(0) > 0.1, "the bird in flight");
  writePlumes(layout, phoenixPose(plan, beats, T.sunburst + 0.13), plan, anchors(), buffers);
  assert.equal(width(0), 0, "gone into the sun");
});

test("a pose is the same for the same moment, written twice", () => {
  const plan = planned(), beats = phoenixWingbeats(plan.timeline), layout = plumeLayout(PHOENIX_BUDGET.low, plan.seed, plan.bird, plan.unit);
  const a = plumeBuffers(layout), b = plumeBuffers(layout);
  writePlumes(layout, phoenixPose(plan, beats, 2.2), plan, anchors(), a);
  writePlumes(layout, phoenixPose(plan, beats, 3.6), plan, anchors(), b);
  writePlumes(layout, phoenixPose(plan, beats, 2.2), plan, anchors(), b);
  assert.deepEqual(a.position, b.position);
  assert.deepEqual(a.ribbon, b.ribbon);
});

test("its real fire: flames standing on it, most along the wings; fire and soot shed in the rite, over the board, within the budget", () => {
  for (const tier of tiers) {
    const plan = planned(), budget = PHOENIX_BUDGET[tier], layout = plumeLayout(budget, plan.seed, plan.bird, plan.unit), beats = phoenixWingbeats(plan.timeline);
    const fire = phoenixFlames(plan, budget, layout, beats);
    assert.ok(Math.abs(fire.blaze.length - budget.blaze) <= 6, `${tier}: ${fire.blaze.length} flames on the bird for ${budget.blaze}`);
    let onWings = 0;
    for (const flame of fire.blaze) {
      const spec = layout.specs[flame.spec];
      assert.ok(spec && flame.cut >= 0 && flame.cut <= spec.segments, `${tier}: a flame on a cut that is there`);
      assert.ok(spec.kind !== PLUME_KIND.thread, "none on the thread from the Queen's hand");
      assert.ok(flame.size > 0.5 * plan.unit && flame.size < 3 * plan.unit && flame.heat > 0.5 && flame.heat <= 1);
      if (spec.kind === PLUME_KIND.feather || spec.kind === PLUME_KIND.covert) onWings += 1;
    }
    assert.ok(onWings >= 0.6 * fire.blaze.length, `${tier}: ${onWings} of ${fire.blaze.length} on the wings`);
    assert.ok(fire.trail.length <= budget.trail && fire.trail.length >= 0.8 * budget.trail, `${tier}: ${fire.trail.length} shed`);
    assert.ok(fire.soot.length <= budget.soot, `${tier}: ${fire.soot.length} puffs of soot`);
    for (const sprite of [...fire.trail, ...fire.soot]) {
      assert.ok(sprite.birth >= plan.timeline.burst[1] - 0.1 && sprite.birth + sprite.life <= plan.timeline.duration + 1e-9, `${tier}: born ${sprite.birth.toFixed(2)}, lives ${sprite.life.toFixed(2)}`);
      assert.ok(sprite.birth < plan.timeline.sunburst, "nothing is shed once it is the sun");
      assert.ok(sprite.origin.y > plan.boardTop, "born over the board");
      assert.ok(Math.abs(Math.hypot(sprite.stream.x, sprite.stream.y, sprite.stream.z) - 1) < 1e-6 && sprite.size > 0);
    }
    // Great gouts where the rite strikes: out of the seal, round the victim, off the stone, at the sunburst.
    const at = (t: number) => fire.gouts.filter((g) => Math.abs(g.birth - t) < 0.2).length;
    assert.ok(at(plan.timeline.burst[0]) >= 2 && at(plan.timeline.strikeAt) >= 1 && at(plan.landAt) >= 1 && at(plan.timeline.sunburst) >= 1, `${tier}: gouts at the beats`);
    // The soot is half off the body burning in its talons, while it is carried.
    if (fire.soot.length > 4) assert.ok(fire.soot.filter((sprite) => sprite.birth >= plan.timeline.strikeAt && sprite.birth <= plan.timeline.release).length >= fire.soot.length * 0.4);
  }
  const plan = planned(), layout = plumeLayout(PHOENIX_BUDGET.medium, plan.seed, plan.bird, plan.unit), beats = phoenixWingbeats(plan.timeline);
  assert.deepEqual(phoenixFlames(plan, PHOENIX_BUDGET.medium, layout, beats), phoenixFlames(plan, PHOENIX_BUDGET.medium, layout, beats), "the same for a seed");
});
