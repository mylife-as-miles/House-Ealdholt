import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEAM_BUDGET, beamControl, beamLength, beamPoint, beamReach, beamTangent, farScale, ringFade, ringPosition, ringScale, ringTravel,
  strandAngle, strandRadius,
} from "../../web/src/scene/vfx/mystic/beamPlan";

const hand = { x: 8, y: 5.4, z: -36.6 }, body = { x: 0.5, y: 0.2, z: -0.5 };
const distance = Math.hypot(body.x - hand.x, body.y - hand.y, body.z - hand.z);
const close = (actual: number, expected: number, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`);

test("the thread runs from the hand to the body and bows under its own length", () => {
  const straight = beamControl(hand, body, 0), bowed = beamControl(hand, body, 0.04);
  close(straight.y, (hand.y + body.y) / 2);
  close(bowed.y, straight.y - 0.04 * distance);
  assert.deepEqual(beamPoint(hand, bowed, body, 0), hand);
  assert.deepEqual(beamPoint(hand, bowed, body, 1), body);
  for (const u of [0.2, 0.5, 0.8]) {
    const chord = hand.y + (body.y - hand.y) * u;
    assert.ok(beamPoint(hand, bowed, body, u).y < chord, `the bowed thread hangs below the straight line at ${u}`);
    close(beamPoint(hand, straight, body, u).y, chord);
  }
  const swayed = beamControl(hand, body, 0, { x: 0.5, y: -0.2, z: 0.1 });
  close(swayed.x, straight.x + 0.5); close(swayed.y, straight.y - 0.2); close(swayed.z, straight.z + 0.1);
});

test("its direction of travel agrees with the curve, and its length with its chords", () => {
  const control = beamControl(hand, body, 0.05);
  for (const u of [0, 0.3, 0.7, 1]) {
    const tangent = beamTangent(hand, control, body, u), step = 1e-5;
    const a = beamPoint(hand, control, body, Math.max(0, u - step)), b = beamPoint(hand, control, body, Math.min(1, u + step));
    const span = Math.min(1, u + step) - Math.max(0, u - step);
    close(tangent.x, (b.x - a.x) / span, 1e-3); close(tangent.y, (b.y - a.y) / span, 1e-3); close(tangent.z, (b.z - a.z) / span, 1e-3);
  }
  close(beamLength(hand, beamControl(hand, body, 0), body), distance, 1e-9);
  const bowed = beamLength(hand, control, body);
  assert.ok(bowed > distance && bowed < distance * 1.02, `a gentle bow adds under two percent (${(bowed / distance).toFixed(4)})`);
});

test("the strands are gathered into the hand and the target, and wound evenly round the core", () => {
  close(strandRadius(0, 0.1), 0); close(strandRadius(1, 0.1), 0, 1e-6);
  close(strandRadius(0.5, 0.1), 0.1);
  assert.ok(strandRadius(0.1, 0.1) < strandRadius(0.3, 0.1) && strandRadius(0.3, 0.1) < strandRadius(0.5, 0.1));
  close(strandRadius(0.5, 0.1, 1), 0.122); close(strandRadius(0.5, 0.1, -1), 0.078);
  const thirds = [0, 1, 2].map((i) => strandAngle(i, 3, 0.4, 3, 2, 1.4));
  close(thirds[1] - thirds[0], (Math.PI * 2) / 3); close(thirds[2] - thirds[1], (Math.PI * 2) / 3);
  close(strandAngle(0, 3, 1, 3, 0, 1.4) - strandAngle(0, 3, 0, 3, 0, 1.4), 3 * Math.PI * 2);
  close(strandAngle(0, 3, 0.4, 3, 2, 1.4) - strandAngle(0, 3, 0.4, 3, 0, 1.4), 2.8);
});

test("it is lit behind its tip and dark ahead of it, with a hot head that goes out when it lands", () => {
  const coming = (u: number) => beamReach(u, 0.5);
  close(coming(0.2).body, 1); close(coming(0.8).body, 0);
  // the lit edge runs just ahead of the tip
  close(coming(0.515).body, 0.5); close(coming(0.5).body, 1);
  close(coming(0.5).head, 1);
  assert.ok(coming(0.44).head < coming(0.5).head && coming(0.3).head < 0.01);
  for (const u of [0, 0.5, 1]) { close(beamReach(u, 1).head, 0); close(beamReach(u, 1).body, 1); }
});

test("rings travel the beam, slow as they come down on the target, and never pop at either end", () => {
  for (const seconds of [0, 0.7, 3.1, 40]) for (let i = 0; i < 5; i += 1) {
    const toward = ringPosition(i, 5, seconds, 0.16), back = ringPosition(i, 5, seconds, -0.16);
    assert.ok(toward >= 0 && toward < 1 && back >= 0 && back < 1);
  }
  close(ringPosition(0, 5, 1, 0.16), 0.16); close(ringPosition(1, 5, 0, 0.16), 0.2);
  close(ringPosition(0, 5, 1, -0.16), 0.84);
  close(ringTravel(0), 0); close(ringTravel(1), 1); close(ringTravel(0.5), 0.75);
  // the last tenth of its journey covers a hundredth of the beam: it has all but stopped
  close(ringTravel(1) - ringTravel(0.9), 0.01);
  assert.ok(ringTravel(0.1) - ringTravel(0) > 0.18);
  close(ringFade(0), 0); close(ringFade(1), 0); close(ringFade(0.5), 1);
  assert.ok(ringScale(0.5) > ringScale(0.05) && ringScale(0.5) > ringScale(0.95) && ringScale(0) > 0.5);
});

test("what stands round the core is drawn larger toward a far hand", () => {
  close(farScale(0, 4), 4); close(farScale(1, 4), 1);
  assert.ok(farScale(0.25, 4) > farScale(0.5, 4) && farScale(0.5, 4) > farScale(0.75, 4));
  for (const u of [0, 0.4, 1]) close(farScale(u, 1), 1);
});

test("every quality tier keeps the core, a strand and some motes, and a higher tier is never drawn with less", () => {
  const tiers = ["low", "medium", "high", "ultra"] as const;
  for (const tier of tiers) {
    const budget = BEAM_BUDGET[tier];
    assert.ok(budget.strands >= 1 && budget.motes >= 16 && budget.segments >= 24 && budget.rings >= 1 && budget.sparks >= 8, tier);
  }
  for (let i = 1; i < tiers.length; i += 1) for (const key of ["strands", "rings", "motes", "sparks", "segments"] as const) {
    assert.ok(BEAM_BUDGET[tiers[i]][key] >= BEAM_BUDGET[tiers[i - 1]][key], `${tiers[i]} ${key}`);
  }
});
