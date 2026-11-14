import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BURN_BUDGET,
  CHAR_FULL,
  COLLAPSE_CLIPS,
  EMBER_FLOOR,
  FLAIL_CLIPS,
  HELD_FLAME,
  HELD_WRITHE,
  IGNITE_RADIUS,
  LURCH_REACH,
  SPELL_FLAME_HEAT,
  charFront,
  charHeat,
  collapseClip,
  emberColour,
  flailClips,
  flameColour,
  flameLevel,
  flameSeats,
  flameSprites,
  flinchTimes,
  frontTime,
  heldJolts,
  lurchAt,
  planBurn,
  planFade,
  type BurnInputs,
} from "../../web/src/scene/death/burn/burnPlan";
import {
  CHAR_FRAGMENT_ALBEDO,
  CHAR_FRAGMENT_EMISSIVE,
  CHAR_FRAGMENT_MASK,
  CHAR_FRAGMENT_METALNESS,
  CHAR_FRAGMENT_ROUGHNESS,
  applyChar,
  clearChar,
  createCharUniforms,
} from "../../web/src/scene/death/burn/charShader";
import { QUALITY_ORDER } from "../../web/src/scene/quality";
import { FLIPBOOK_BUDGET } from "../../web/src/scene/vfx/flipbookCore";
import { SCORCH_LOOK, scorchKind } from "../../web/src/scene/vfx/scorchPlan";
import { SPELL_BURST_COLOUR, type VfxArmy } from "../../web/src/scene/vfx/wiring";

const ARMIES: VfxArmy[] = ["ivory", "sun", "empire", "kwind"];
const burn = (over: Partial<BurnInputs> = {}): BurnInputs => ({ quality: "high", reducedMotion: false, source: "spell", army: "sun", height: 0.78, seed: 0x1234abcd, ...over });
/** A standing figure's bones, roughly: feet, knees, hips, chest, hands, head. */
const BODY = [
  { x: -0.1, y: 0.02, z: 0 }, { x: 0.1, y: 0.02, z: 0 }, { x: -0.1, y: 0.22, z: 0 }, { x: 0.1, y: 0.22, z: 0 },
  { x: 0, y: 0.4, z: 0 }, { x: 0, y: 0.52, z: 0 }, { x: -0.26, y: 0.44, z: 0.05 }, { x: 0.26, y: 0.44, z: 0.05 }, { x: 0, y: 0.72, z: 0 },
];
const CHEST = { x: 0, y: 0.5, z: 0.1 };

test("a burning body never asks the flipbook for more flame sprites than the preset's fire atlas holds", () => {
  for (const quality of QUALITY_ORDER) {
    const budget = BURN_BUDGET[quality];
    assert.ok(flameSprites(budget) <= FLIPBOOK_BUDGET[quality].instances, `${quality}: ${flameSprites(budget)} > ${FLIPBOOK_BUDGET[quality].instances}`);
    assert.ok(budget.flames >= 3, "even Low shows fire on the body");
  }
});

test("Low is the cheaper burn: fewer flames, no light, no embers shed in the flail, less smoke, a shorter smoulder", () => {
  const low = planBurn(burn({ quality: "low" })), high = planBurn(burn({ quality: "high" }));
  assert.equal(low.variant, "full");
  assert.ok(low.flames < high.flames);
  assert.equal(low.budget.light, false); assert.equal(high.budget.light, true);
  assert.equal(low.budget.embers, 0); assert.ok(high.budget.embers > 0);
  assert.ok(low.budget.smoke < high.budget.smoke);
  assert.ok(low.smoulder < high.smoulder);
  // What Low keeps: the char, its spread, the stagger and the collapse are the same.
  assert.equal(low.spread, high.spread); assert.equal(low.flail, high.flail); assert.equal(low.flicker, true);
});

test("reduced motion is the calm burn: no flail, no flames, no flicker, and the char is over the body at once", () => {
  for (const quality of QUALITY_ORDER) {
    const calm = planBurn(burn({ quality, reducedMotion: true })), full = planBurn(burn({ quality }));
    assert.equal(calm.variant, "calm");
    assert.equal(calm.flail, 0); assert.equal(calm.flames, 0); assert.equal(calm.flicker, false);
    assert.ok(calm.spread <= 0.5 && calm.spread < full.spread);
    assert.ok(calm.crumble < full.crumble);
    assert.deepEqual(lurchAt(calm, 0.3), { x: 0, z: 0, yaw: 0, tilt: 0 });
    assert.deepEqual(flinchTimes(calm), []);
    assert.deepEqual(flameSeats(calm, BODY, CHEST), []);
    assert.deepEqual(flailClips(calm, () => 0.8), []);
    // It is still a burn: the body chars and the embers show.
    assert.equal(charFront(calm, calm.spread), CHAR_FULL);
    assert.deepEqual(calm.ember, full.ember);
  }
});

test("the char catches at the point of impact, only ever spreads, and covers the whole figure by the end of the spread", () => {
  const plan = planBurn(burn());
  assert.equal(charFront(plan, 0), 0, "nothing is burnt before ignition");
  assert.ok(Math.abs(charFront(plan, 1e-6) - IGNITE_RADIUS) < 1e-3);
  let last = 0;
  for (let t = 0; t <= plan.spread + 0.5; t += 0.01) { const front = charFront(plan, t); assert.ok(front >= last, `t=${t}`); last = front; }
  assert.equal(charFront(plan, plan.spread), CHAR_FULL);
  // Slow to catch, then it runs: under a third of the way at half time.
  assert.ok(charFront(plan, plan.spread / 2) < IGNITE_RADIUS + (plan.reach - IGNITE_RADIUS) * 0.4);
  assert.ok(plan.spread >= 1 && plan.spread <= 2, "over a second or two");
  // The front reaches the crown and the soles of every rank before the spread is up.
  for (const height of [0.78, 0.98, 1.0, 1.04, 1.32]) assert.ok(planBurn(burn({ height })).reach >= height * 0.75);
});

test("frontTime is charFront read the other way", () => {
  const plan = planBurn(burn());
  assert.equal(frontTime(plan, 0), 0);
  for (const d of [0.1, 0.3, 0.6, plan.reach]) assert.ok(Math.abs(charFront(plan, frontTime(plan, d)) - d) < 1e-6 || frontTime(plan, d) === plan.spread);
  assert.equal(frontTime(plan, 99), plan.spread);
});

test("the embers are lit by the fire and cool to a dull glow while the husk smoulders, never to nothing", () => {
  const plan = planBurn(burn());
  assert.equal(charHeat(plan, 0, -1), 0);
  assert.equal(charHeat(plan, 1, -1), 1);
  let last = 1;
  for (let s = 0.05; s < 6; s += 0.05) { const heat = charHeat(plan, 3, s); assert.ok(heat <= last + 1e-9 && heat >= EMBER_FLOOR - 1e-9); last = heat; }
  assert.ok(charHeat(plan, 3, 6) < EMBER_FLOOR + 0.02);
});

test("flames grow as they catch and sink to a lick once the body is down", () => {
  const plan = planBurn(burn());
  assert.equal(flameLevel(plan, 0, -1), 0);
  assert.ok(flameLevel(plan, 0.05, -1) < flameLevel(plan, 0.6, -1));
  assert.equal(flameLevel(plan, 0.6, -1), 1);
  assert.ok(flameLevel(plan, 2, 0.01) < 0.6);
  assert.ok(flameLevel(plan, 2, plan.smoulder) <= 0.06);
});

test("flame seats: the first is at the wound, the rest spread over the body, and they light as the front reaches them", () => {
  const plan = planBurn(burn());
  const seats = flameSeats(plan, BODY, CHEST);
  assert.equal(seats.length, plan.flames);
  assert.equal(new Set(seats.map(seat => seat.index)).size, seats.length, "no bone carries two flames");
  assert.equal(seats[0].index, 5, "the chest, nearest the hit");
  assert.equal(seats[0].at, frontTime(plan, Math.hypot(0, 0.02, 0.1)));
  for (let i = 1; i < seats.length; i++) assert.ok(seats[i].at >= seats[i - 1].at);
  assert.ok(seats.every(seat => seat.at <= plan.spread));
  const chosen = seats.map(seat => BODY[seat.index]);
  assert.ok(chosen.some(point => point.y > 0.7), "the head burns");
  assert.ok(chosen.some(point => point.y < 0.05), "the feet burn");
  assert.deepEqual(flameSeats(plan, BODY, CHEST), seats, "the same body lights the same way");
  // Fewer bones than flames: every bone, once.
  assert.equal(flameSeats(plan, BODY.slice(0, 2), CHEST).length, 2);
  assert.deepEqual(flameSeats(plan, [], CHEST), []);
  // Low picks fewer seats from the same body, still head to foot.
  const low = flameSeats(planBurn(burn({ quality: "low" })), BODY, CHEST);
  assert.equal(low.length, 3);
});

test("the lurch starts and ends on the middle of the square and never leaves it: the husk lies on its burn mark", () => {
  for (const seed of [1, 2, 0xdeadbeef, 77]) {
    const plan = planBurn(burn({ seed }));
    assert.deepEqual(lurchAt(plan, 0), { x: 0, z: 0, yaw: 0, tilt: 0 });
    assert.deepEqual(lurchAt(plan, plan.flail), { x: 0, z: 0, yaw: 0, tilt: 0 });
    assert.deepEqual(lurchAt(plan, plan.flail + 1), { x: 0, z: 0, yaw: 0, tilt: 0 });
    let moved = 0;
    for (let t = 0; t <= plan.flail; t += 0.01) {
      const at = lurchAt(plan, t);
      assert.ok(Math.hypot(at.x, at.z) <= LURCH_REACH + 1e-9, `seed ${seed} t=${t}`);
      assert.ok(Math.abs(at.yaw) <= 0.56 && Math.abs(at.tilt) <= 0.25);
      moved = Math.max(moved, Math.hypot(at.x, at.z));
    }
    assert.ok(moved > 0.04, "it does reel");
    const late = lurchAt(plan, plan.flail - 0.02);
    assert.ok(Math.hypot(late.x, late.z) < 0.03, "it has come back before it falls");
  }
  assert.notDeepEqual(lurchAt(planBurn(burn({ seed: 1 })), 0.7), lurchAt(planBurn(burn({ seed: 2 })), 0.7));
  assert.deepEqual(lurchAt(planBurn(burn({ seed: 9 })), 0.7), lurchAt(planBurn(burn({ seed: 9 })), 0.7));
});

test("a body set alight in a grip neither reels nor falls, jerks a few times early, and burns in larger flames", () => {
  for (const quality of ["low", "medium", "high", "ultra"] as const) {
    const held = planBurn(burn({ quality, held: true })), standing = planBurn(burn({ quality }));
    assert.equal(held.flail, 0);
    assert.deepEqual(lurchAt(held, 0.7), { x: 0, z: 0, yaw: 0, tilt: 0 });
    assert.ok(Math.abs(held.flameSize - standing.flameSize * HELD_FLAME) < 1e-9);
    // Everything else burns as it would on its feet: the same spread, flames, smoke and smoulder.
    assert.equal(held.spread, standing.spread); assert.equal(held.flames, standing.flames);
    assert.equal(held.smoulder, standing.smoulder); assert.deepEqual(held.budget, standing.budget);
    const jolts = heldJolts(held);
    assert.ok(jolts.length >= 3, `${quality}: it jerks in the grip`);
    for (let i = 0; i < jolts.length; i++) { assert.ok(jolts[i] > 0 && jolts[i] < HELD_WRITHE); if (i) assert.ok(jolts[i] > jolts[i - 1]); }
    // Calm (reduced motion): no flames, no jerking, the same size of nothing.
    const calm = planBurn(burn({ quality, held: true, reducedMotion: true }));
    assert.deepEqual(heldJolts(calm), []);
    assert.equal(calm.flameSize, planBurn(burn({ quality, reducedMotion: true })).flameSize);
  }
});

test("the body is jolted several times while it burns on its feet, never in the last instant", () => {
  const plan = planBurn(burn());
  const times = flinchTimes(plan);
  assert.ok(times.length >= 3 && times.length <= 8);
  for (let i = 0; i < times.length; i++) { assert.ok(times[i] > 0 && times[i] < plan.flail - 0.1); if (i) assert.ok(times[i] > times[i - 1]); }
  assert.deepEqual(flinchTimes(plan), times);
});

test("a rig with the Pawn clip library reels through its staggers and falls on its knees; any other rig gets the simple stagger", () => {
  const plan = planBurn(burn());
  // Lengths from docs/play/COMBAT_LIBRARY_V2.md.
  const library: Record<string, number> = { "hit.stagger-heavy": 0.87, "hit.head": 0.43, "hit.stagger-light": 0.67, "hit.recoil": 1.07, "death.collapse": 2.4, "death.forward": 2.63 };
  const chain = flailClips(plan, id => library[id] ?? 0);
  assert.ok(chain.length >= 2);
  assert.equal(chain[0].id, "hit.stagger-heavy"); assert.equal(chain[0].at, 0);
  for (const step of chain) { assert.ok((FLAIL_CLIPS as readonly string[]).includes(step.id)); assert.ok(step.at < plan.flail - 0.2); }
  for (let i = 1; i < chain.length; i++) assert.ok(chain[i].at > chain[i - 1].at && chain[i].at < chain[i - 1].at + library[chain[i - 1].id], "each cuts in before the last has recovered");
  assert.deepEqual(flailClips(plan, () => 0), [], "a Bishop, a Rook, a Knight, a Queen: no clips, the procedural stagger only");
  assert.equal(collapseClip(id => id in library), "death.collapse");
  assert.equal(collapseClip(id => id === "death.forward"), "death.forward");
  assert.equal(collapseClip(() => false), null);
  assert.deepEqual([...COLLAPSE_CLIPS], ["death.collapse", "death.forward"]);
});

test("the field gun burns naturally; a spell burns in its army's colour, with embers the colour of its mark on the stone", () => {
  for (const army of ARMIES) {
    assert.equal(flameColour("gun", army), null);
    assert.deepEqual(emberColour("gun", army), SCORCH_LOOK.crater.glow);
    assert.equal(flameColour("spell", army), SPELL_BURST_COLOUR[army]);
    assert.deepEqual(emberColour("spell", army), SCORCH_LOOK[scorchKind("spell", army)].glow);
    const plan = planBurn(burn({ army }));
    assert.equal(plan.flame, SPELL_BURST_COLOUR[army]); assert.deepEqual(plan.ember, emberColour("spell", army));
  }
  assert.equal(flameColour("spell", "sun"), null, "Solforiz's magic is fire");
  assert.ok(flameColour("spell", "ivory")![2] > flameColour("spell", "ivory")![0], "Aethelgard's is cold");
});

test("a spell's recoloured flames keep the baked fire's heat (a white heart); natural fire is drawn as baked", () => {
  assert.ok(SPELL_FLAME_HEAT > 0 && SPELL_FLAME_HEAT <= 1, "the flipbook reads mono past 1 up to 2");
  for (const army of ARMIES) {
    assert.equal(planBurn(burn({ source: "gun", army })).flameHeat, 0, "the field gun's fire is natural");
    const spell = planBurn(burn({ army }));
    assert.equal(spell.flameHeat, spell.flame ? SPELL_FLAME_HEAT : 0, `${army}: only a recoloured flame needs its heat back`);
  }
  assert.ok(planBurn(burn({ army: "empire" })).flameHeat > 0, "Korvenia's violet fire has a hot core");
});

test("Minimal: a short flash and a fade; under reduced motion no flash at all", () => {
  const fade = planFade(false), calm = planFade(true);
  assert.ok(fade.flash > 0 && fade.flashSeconds > 0 && fade.flashSeconds <= 0.2);
  assert.ok(fade.fade > 0.2 && fade.fade <= 0.8);
  assert.equal(calm.flash, 0); assert.ok(calm.fade > 0 && calm.fade <= fade.fade);
});

test("Undo: clearing the char leaves a figure's uniform block exactly as it was built", () => {
  const uniforms = createCharUniforms(), fresh = createCharUniforms();
  const origin = uniforms.uCharOrigin.value, ember = uniforms.uCharEmber.value;
  applyChar(uniforms, { origin: { x: 1.5, y: 0.6, z: -2 }, front: 0.8, heat: 0.7, edgeGlow: 1.2, ember: [0.3, 0.82, 1], time: 12.5, crumbleGlow: 0.5 });
  assert.equal(uniforms.uCharFront.value, 0.8);
  assert.deepEqual(uniforms.uCharOrigin.value, [1.5, 0.6, -2]);
  assert.deepEqual(uniforms.uCharEmber.value, [0.3, 0.82, 1]);
  assert.notDeepEqual(uniforms, fresh);
  clearChar(uniforms);
  assert.deepEqual(uniforms, fresh);
  // The same arrays, written in place: the compiled programs hold these very objects.
  assert.equal(uniforms.uCharOrigin.value, origin); assert.equal(uniforms.uCharEmber.value, ember);
  assert.equal(fresh.uCharFront.value, 0, "a figure is built unburnt");
});

test("an unburnt figure's surface is untouched: every char line is a no-op while the front is at 0", () => {
  assert.match(CHAR_FRAGMENT_MASK, /float chAmount = 0\.0;/);
  assert.match(CHAR_FRAGMENT_MASK, /if \(uCharFront > 0\.0005\) \{/);
  // Outside that branch the amounts stay 0, and each line below is the identity at 0.
  assert.match(CHAR_FRAGMENT_ALBEDO, /mix\(diffuseColor\.rgb, .*, chAmount\);$/);
  assert.match(CHAR_FRAGMENT_ROUGHNESS, /mix\(roughnessFactor, [\d.]+, chAmount\);$/);
  assert.match(CHAR_FRAGMENT_METALNESS, /\*= 1\.0 - chAmount;$/);
  assert.match(CHAR_FRAGMENT_EMISSIVE, /totalEmissiveRadiance \*= 1\.0 - chAmount;/);
  assert.match(CHAR_FRAGMENT_EMISSIVE, /\(chCrack \* uCharHeat \+ chEdge \* uCharEdgeGlow\)/);
});

test("the char goes through the figures' one material patch, and a figure sent to the tray or reset is cleared of it", () => {
  const pieces = readFileSync(fileURLToPath(new URL("../../web/src/scene/pieces.ts", import.meta.url)), "utf8");
  assert.equal(pieces.match(/material\.onBeforeCompile = /g)?.length, 1, "one patch per material, not a second effect over it");
  for (const chunk of ["CHAR_VERTEX_PARS", "CHAR_VERTEX", "CHAR_FRAGMENT_PARS", "CHAR_FRAGMENT_MASK", "CHAR_FRAGMENT_ALBEDO", "CHAR_FRAGMENT_ROUGHNESS", "CHAR_FRAGMENT_METALNESS", "CHAR_FRAGMENT_EMISSIVE", "CHAR_RIM_FACTOR"])
    assert.ok(pieces.includes("${" + chunk + "}"), `${chunk} is in the patch`);
  assert.match(pieces, /\.\.\.createCharUniforms\(\),/);
  const reset = pieces.slice(pieces.indexOf("  resetPose(): void {"), pieces.indexOf("  get object(): THREE.Object3D {"));
  assert.match(reset, /this\.setChar\(null\);/);
});
