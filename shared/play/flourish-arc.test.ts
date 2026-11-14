/**
 * The killing blow's crescent of light (web/src/scene/vfx/flourish/arcPlan.ts, drawn by arcs.ts): its clock, its shape,
 * the blade's history it is drawn from, every vertex of the strip that history becomes, and how the duel and the plain
 * melee capture wire it to the killing swing only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARC, ARC_ACROSS, ArcHistory, ArcStrip, arcAlphaAlong, arcEnvelope, arcStepLimit, arcWidthAlong, catmullRom, sparkAlong } from "../../web/src/scene/vfx/flourish/arcPlan";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../web/src/scene/${path}`, import.meta.url)), "utf8");
const near = (a: number, b: number, by = 1e-6) => Math.abs(a - b) <= by;
const EYE = { x: 0, y: 5, z: 0.5 };

/** A blade turning about a pivot at `pivot` in the level plane, its tip at radius `r`, its root at `r - depth`. */
function swing(history: ArcHistory, samples: number, options: { r?: number; depth?: number; rate?: number; from?: number; dt?: number; y?: number } = {}): void {
  const r = options.r ?? 1, depth = options.depth ?? 0.45, rate = options.rate ?? 4.5, from = options.from ?? 1.5, dt = options.dt ?? 1 / 60, y = options.y ?? 0.6;
  for (let i = 0; i < samples; i += 1) {
    const a = from - i * dt * rate;
    history.push(i * dt, Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a) * (r - depth), y, Math.sin(a) * (r - depth));
  }
}

test("the arc is whole on the frame of the blow and gone a quarter to a third of a second later, thinning as it fades", () => {
  assert.equal(arcEnvelope(-0.01).alpha, 0);
  assert.equal(arcEnvelope(Number.NaN).alpha, 0);
  const at = arcEnvelope(0);
  assert.equal(at.alpha, 1); assert.equal(at.width, 1); assert.equal(at.done, false);
  const life = ARC.hold + ARC.fade;
  assert.ok(life >= 0.25 && life <= 0.35, `life ${life}`);
  assert.equal(arcEnvelope(life).alpha, 0); assert.equal(arcEnvelope(life).done, true);
  let last = arcEnvelope(0);
  for (let t = 0.01; t <= life + 1e-9; t += 0.01) {
    const now = arcEnvelope(t);
    assert.ok(now.alpha <= last.alpha + 1e-12, `fades without coming back (${t.toFixed(2)})`);
    if (now.alpha > 0) assert.ok(now.width <= last.width + 1e-12 && now.width >= 0.6, `thins as it fades (${t.toFixed(2)})`);
    last = now;
  }
  // a summon's virtual blade is held whole while it sweeps
  assert.equal(arcEnvelope(0.15, 0.15).alpha, 1);
  assert.ok(arcEnvelope(0.15 + life, 0.15).done);
  // written into the record it is given: a frame allocates nothing
  const out = { alpha: 9, width: 9, done: true };
  assert.equal(arcEnvelope(0.1, 0, out), out);
});

test("its body is a crescent: full near the weapon, fullest a little behind it, drawn to a point at its tail", () => {
  assert.ok(arcWidthAlong(0) >= 0.6 && arcWidthAlong(0) < 1, "not pinched at the weapon: the blade is there");
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => arcWidthAlong(i / 100)));
  assert.ok(near(peak, 1, 0.02), `fullest at ${peak}`);
  assert.equal(arcWidthAlong(1), 0);
  for (let u = 0.3; u < 1; u += 0.05) assert.ok(arcWidthAlong(u + 0.05) <= arcWidthAlong(u) + 1e-12, "tapers to its tail");
  assert.equal(arcAlphaAlong(0), 1);
  assert.equal(arcAlphaAlong(1), 0);
  for (let i = 0; i < 40; i += 1) { const along = sparkAlong(i / 40); assert.ok(along >= 0 && along <= 0.85); }
  assert.ok(sparkAlong(0.5) < 0.425, "most sparks leave near the weapon");
});

test("the spline goes through its samples and does not overshoot a straight line", () => {
  assert.equal(catmullRom(0, 1, 2, 3, 0), 1);
  assert.equal(catmullRom(0, 1, 2, 3, 1), 2);
  for (let t = 0; t <= 1; t += 0.125) {
    assert.ok(near(catmullRom(0.6, 0.6, 0.6, 0.6, t), 0.6), `a constant stays constant (${t})`);
    assert.ok(near(catmullRom(0, 1, 2, 3, t), 1 + t), `a straight run stays straight (${t})`);
  }
});

test("the blade's history is a fixed ring: it forgets the old, never folds on a still blade, and breaks on a jump", () => {
  const h = new ArcHistory(8);
  const tip = h.tip, root = h.root;
  for (let i = 0; i < 20; i += 1) h.push(i * 0.01, i * 0.05, 0, 0, i * 0.05, 0, 0.3);
  assert.equal(h.count, 8);
  assert.equal(h.tip, tip); assert.equal(h.root, root);
  assert.ok(near(h.tip[h.index(0) * 3], 12 * 0.05, 1e-6), "the oldest kept is the twelfth");
  // a still blade is not kept twice
  assert.equal(h.push(0.3, 19 * 0.05, 0, 0, 19 * 0.05, 0, 0.3), false);
  // a jump starts a new stroke
  assert.ok(h.push(0.31, 5, 0, 0, 5, 0, 0.3));
  assert.equal(h.newestRun(), 1);
  assert.ok(h.push(0.32, 5.05, 0, 0, 5.05, 0, 0.3));
  assert.equal(h.newestRun(), 2);
  // a missing socket breaks it too, and nothing is kept
  assert.equal(h.push(0.33, Number.NaN, 0, 0, 0, 0, 0), false);
  assert.ok(h.push(0.34, 5.1, 0, 0, 5.1, 0, 0.3));
  assert.equal(h.newestRun(), 1);
  h.expire(10, 0.5);
  assert.equal(h.count, 0);
  h.clear(); assert.equal(h.count, 0); assert.equal(h.newestRun(), 0);
});

test("a swing stays one stroke however fast its frames come and however long its blade; only a figure moved breaks it", () => {
  const sixtieth = 1 / 60, thirtieth = 1 / 30;
  // a duelist's spear at sixty frames a second: the board's jump, or its blade's reach if that is longer
  assert.equal(arcStepLimit(0.2, 1, sixtieth), ARC.maxStep);
  assert.ok(Math.abs(arcStepLimit(0.5, 1, sixtieth) - 0.5 * ARC.stepBlades) < 1e-9);
  // the same swing filmed at thirty frames a second, or across a slow frame, may go twice as far between samples
  assert.ok(Math.abs(arcStepLimit(0.2, 1, thirtieth) - 2 * ARC.maxStep) < 1e-9);
  assert.equal(arcStepLimit(0.2, 1, 5), 6 * ARC.maxStep, "at most six sixtieths' worth");
  assert.equal(arcStepLimit(0.2, 1, 0), ARC.maxStep, "a held frame (a hit-stop) is no excuse for a jump");
  // the shadow colossus's sabre (4.2 times a man, its arc thickened 2.1 times): a chop sweeping three units a frame at
  // thirty frames a second is one stroke; the figure put on another square is not
  const colossus = arcStepLimit(1.8, 2.1, thirtieth);
  assert.ok(colossus > 3 && colossus < 12, `${colossus}`);
  const h = new ArcHistory(16);
  for (let i = 0; i < 6; i += 1) h.push(i * thirtieth, 3 * i, 2, 0, 3 * i, 1, 0, colossus);
  assert.equal(h.newestRun(), 6);
  h.push(6 * thirtieth, 40, 2, 0, 40, 1, 0, colossus);
  assert.equal(h.newestRun(), 1);
  for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) assert.ok(Number.isFinite(arcStepLimit(bad, bad, bad)) && arcStepLimit(bad, bad, bad) >= ARC.maxStep * 0.5);
  // the arcs ask it of every sample, from the blade's own length and the time since the last
  const arcs = source("vfx/flourish/arcs.ts");
  assert.match(arcs, /const limit = arcStepLimit\(this\.tip\.distanceTo\(this\.root\), slot\.scale, since\);/);
});

test("the strip's leading edge is the tip's own path, and its body reaches back toward the root, no further than its limit", () => {
  const h = new ArcHistory(), strip = new ArcStrip(ARC.history, 6);
  swing(h, 19);
  const sections = strip.build(h, { shapeNow: 18 / 60, eye: EYE, envelope: { alpha: 1, width: 1 }, subdivide: 4 });
  assert.ok(sections >= 2 && sections <= strip.maxSections);
  for (let s = 0; s < sections; s += 1) {
    const edge = s * 4 + 1, inner = s * 4 + 2;
    const ex = strip.positions[edge * 3], ey = strip.positions[edge * 3 + 1], ez = strip.positions[edge * 3 + 2];
    // between the samples the spline keeps to the circle the tip ran round
    assert.ok(near(Math.hypot(ex, ez), 1, 0.004), `the edge is on the tip's path (${s}: ${Math.hypot(ex, ez).toFixed(4)})`);
    assert.ok(near(ey, 0.6, 1e-6), "level, as the swing was");
    const ix = strip.positions[inner * 3], iz = strip.positions[inner * 3 + 2];
    const depth = Math.hypot(ex - ix, ez - iz);
    assert.ok(Math.hypot(ix, iz) < Math.hypot(ex, ez), "the body reaches inward, toward the root");
    assert.ok(depth <= ARC.maxWidth + 1e-6 && depth <= 0.45 + 1e-6, `no thicker than the blade's share or the limit (${depth})`);
    for (let k = 0; k < 4; k += 1) assert.ok(near(strip.across[s * 4 + k], ARC_ACROSS[k], 1e-6), "across: halo, edge, inner side, halo");
    for (let v = s * 4 * 3; v < (s * 4 + 4) * 3; v += 1) assert.ok(Number.isFinite(strip.positions[v]));
  }
  // the newest section is at the weapon, the oldest at the tail; it never runs backward
  assert.equal(strip.us[sections - 1], 0);
  for (let s = 1; s < sections; s += 1) assert.ok(strip.us[s] <= strip.us[s - 1] + 1e-9, "u falls toward the weapon");
  for (let s = 1; s < sections; s += 1) {
    const o = s * 3, p = (s - 1) * 3;
    const step = (strip.tips[o] - strip.tips[p]) * strip.tangents[o] + (strip.tips[o + 2] - strip.tips[p + 2]) * strip.tangents[o + 2];
    assert.ok(step > 0, `the strip does not fold back on itself (${s})`);
  }
});

test("a thrust, which sweeps no surface, still leaves a stroke facing the eye; a swing seen edge on leans toward it", () => {
  const h = new ArcHistory(), strip = new ArcStrip(ARC.history, 6);
  // the blade driven along its own line toward -z, seen from above and in front
  for (let i = 0; i < 16; i += 1) h.push(i / 60, 0, 0.55, -i * 0.04, 0, 0.55, -i * 0.04 + 0.45);
  const eye = { x: 0, y: 3, z: 2 };
  const sections = strip.build(h, { shapeNow: 15 / 60, eye, envelope: { alpha: 1, width: 1 }, subdivide: 3 });
  assert.ok(sections >= 2);
  for (let s = 0; s < sections; s += 1) {
    const o = s * 3, nx = strip.normals[o], ny = strip.normals[o + 1], nz = strip.normals[o + 2];
    assert.ok(near(Math.hypot(nx, ny, nz), 1, 1e-5));
    const ex = eye.x - strip.tips[o], ey = eye.y - strip.tips[o + 1], ez = eye.z - strip.tips[o + 2], el = Math.hypot(ex, ey, ez);
    assert.ok(Math.abs((nx * ex + ny * ey + nz * ez) / el) < 1e-4, "its body lies square to the eye");
    assert.ok(Math.abs(nx * strip.tangents[o] + ny * strip.tangents[o + 1] + nz * strip.tangents[o + 2]) < 1e-4, "and square to its path");
    const d = Math.hypot(strip.positions[(s * 4 + 2) * 3] - strip.positions[(s * 4 + 1) * 3], strip.positions[(s * 4 + 2) * 3 + 1] - strip.positions[(s * 4 + 1) * 3 + 1], strip.positions[(s * 4 + 2) * 3 + 2] - strip.positions[(s * 4 + 1) * 3 + 2]);
    assert.ok(d <= ARC.minWidth + 1e-6, "as thick as a thrust is given");
    if (s > 0) assert.ok(nx * strip.normals[o - 3] + ny * strip.normals[o - 2] + nz * strip.normals[o - 1] > 0.99, "it never flips side");
  }
  // a spear driven nearly, not exactly, along its own line is a thrust too: its body still faces the eye
  const near8 = new ArcHistory();
  for (let i = 0; i < 16; i += 1) near8.push(i / 60, 0, 0.55, -i * 0.04, 0.03, 0.55, -i * 0.04 + 0.45);
  strip.build(near8, { shapeNow: 15 / 60, eye, envelope: { alpha: 1, width: 1 }, subdivide: 3 });
  for (let s = 0; s < strip.sections; s += 1) {
    const o = s * 3, ex = eye.x - strip.tips[o], ey = eye.y - strip.tips[o + 1], ez = eye.z - strip.tips[o + 2], el = Math.hypot(ex, ey, ez);
    assert.ok(Math.abs((strip.normals[o] * ex + strip.normals[o + 1] * ey + strip.normals[o + 2] * ez) / el) < 0.02, `a near thrust faces the eye (${s})`);
  }
  // a level swing seen from level with it: its body is turned toward the eye, not left a hairline
  const g = new ArcHistory();
  swing(g, 19, { y: 0.6 });
  strip.build(g, { shapeNow: 18 / 60, eye: { x: 0.2, y: 0.6, z: 6 }, envelope: { alpha: 1, width: 1 }, subdivide: 2 });
  const last = (strip.sections - 1) * 3;
  assert.ok(Math.abs(strip.normals[last + 1]) > 0.5, `leant toward the eye (${strip.normals[last + 1].toFixed(2)})`);
});

test("nothing is drawn from one sample, from a broken stroke's single tail, or once the envelope is spent", () => {
  const h = new ArcHistory(), strip = new ArcStrip();
  h.push(0, 0, 0, 0, 0, 0, 0.4);
  assert.equal(strip.build(h, { shapeNow: 0, eye: EYE, envelope: { alpha: 1, width: 1 }, subdivide: 4 }), 0);
  h.push(0.02, 0.1, 0, 0, 0.1, 0, 0.4);
  assert.ok(strip.build(h, { shapeNow: 0.02, eye: EYE, envelope: { alpha: 1, width: 1 }, subdivide: 4 }) >= 2);
  assert.equal(strip.build(h, { shapeNow: 0.02, eye: EYE, envelope: { alpha: 0, width: 1 }, subdivide: 4 }), 0);
  // a jump: only the stroke after it is drawn, and it has one sample
  h.push(0.04, 4, 0, 0, 4, 0, 0.4);
  assert.equal(strip.build(h, { shapeNow: 0.04, eye: EYE, envelope: { alpha: 1, width: 1 }, subdivide: 4 }), 0);
  // a long-past swing is not drawn either
  const old = new ArcHistory();
  swing(old, 10);
  assert.equal(strip.build(old, { shapeNow: 5, eye: EYE, envelope: { alpha: 1, width: 1 }, subdivide: 4 }), 0);
  // the index buffer covers every section, three quads between each pair
  const index = ArcStrip.indices(strip.maxSections);
  assert.equal(index.length, (strip.maxSections - 1) * 18);
  assert.ok(Math.max(...index) < strip.maxSections * 4);
});

test("the duel and the plain melee capture draw the killer's light arc on its killing swing only", () => {
  const engine = source("sceneEngine.ts");
  const phase = engine.slice(engine.indexOf("      phase: (phase, marker) => {"), engine.indexOf("      contactResolved: event => {"));
  // traced unseen from the first beat, revealed as the blow lands, let go as the body falls
  assert.match(phase, /tracingWeapons = this\.traceKillingSwing\(trailIds\[0\], attacker, victim\);/);
  assert.match(phase, /if \(phase === "contact" && tracingWeapons\) this\.flourish\?\.revealArc\(trailIds\[0\]\);/);
  assert.match(phase, /phase === "fall" \|\| phase === "advance"\) stopTrails\(\);/);
  // the defender's weapon leaves none: its parries and steps would be smeared too
  // (the victim is named only for the blow's kept colour: the blade traced is the killer's, below)
  assert.doesNotMatch(phase, /traceKillingSwing\([^,]+, victim/);
  assert.match(engine, /private traceKillingSwing\(id: string, attacker: PieceView, victim: PieceView\): boolean \{[^}]*weaponEdge\(\(\) => attacker\.goreAnchors\(\)\.weapon\)/);
  // the plain capture: traced from its strike, revealed as its blow lands, where it replaces the sprite crescent
  assert.match(engine, /this\.meleeArc = this\.traceKillingSwing\(arc, attacker, victim\) \? arc : null;/);
  const contact = engine.slice(engine.indexOf("  private meleeContact("), engine.indexOf("  private async passSentence("));
  assert.match(contact, /const arc = sound \? this\.meleeArc : null;\n\s+this\.meleeArc = null;\n\s+if \(arc\) this\.flourish\?\.revealArc\(arc\);/);
  assert.match(contact, /if \(profile\.slash && !arc\) \{/);
  assert.match(contact, /if \(sound\) this\.flourishKill\(arc, attacker, victim, null, blow, power\);/);
  // the tip and a point back along the blade toward the hand, from the figure's own weapon socket
  assert.match(engine, /beginArc\(id, weaponEdge\(\(\) => attacker\.goreAnchors\(\)\.weapon\)/);
  // the pale trail it replaces is gone
  assert.doesNotMatch(engine, /WeaponTrail/);
  assert.doesNotMatch(source("effects.ts"), /WeaponTrail/);
  // the frame samples the blades after animation and contact IK, and after a rite has moved its troops
  const frame = engine.slice(engine.indexOf("  private frame(): void {"), engine.indexOf("  private guardAgainstBlackFrames(): void {"));
  assert.ok(frame.indexOf("resolveContacts()") < frame.indexOf("this.flourish?.update("), "after contact IK");
  assert.ok(frame.indexOf("this.updateRite(delta);") < frame.indexOf("this.flourish?.update("), "after the rite's troops");
  // a summoned giant's own sabre is traced, thickened with it, and drawn as its blow lands; elsewhere a virtual blade
  assert.match(engine, /const giant = lent\.find\(view => view\.container\.scale\.x > 2 && view\.goreAnchors\(\)\.weapon\) \?\? null;/);
  assert.match(engine, /if \(traced\) \{\n[^\n]*\n\s+flourish\.revealArc\(traced\);/);
});
