import assert from "node:assert/strict";
import test from "node:test";
import { combatSeed } from "../../web/src/scene/combat/director";
import { QUALITY_ORDER, type QualityPreset } from "../../web/src/scene/quality";
import { GORE_GRAVITY, flightPosition, landingTime } from "../../web/src/scene/gore/ballistics";
import { DECAL_FADE_SECONDS, DecalBuffer, ParticleBuffer, type DecalRecord } from "../../web/src/scene/gore/GoreBuffers";
import { DEFAULT_BOARD, expandSpray, planGore, type Droplet } from "../../web/src/scene/gore/GoreDirector";
import { GoreLedger, type GoreSink } from "../../web/src/scene/gore/GoreLedger";
import { GORE_CAPACITY, goreBudget } from "../../web/src/scene/gore/GoreQuality";
import { invert4, projectSkinDecal, raycastPosed, skinPoint, type SkinSource } from "../../web/src/scene/gore/SkinDecal";
import { GORE_INTENSITIES, goreSeed, impactIdOf, type GoreEvent, type GoreIntensity, type GoreKind, type GoreKingdom, type GorePlan, type GoreWeapon } from "../../web/src/scene/gore/GoreTypes";
import { RIG_REGIONS, resolveImpact, rigOf } from "../../web/src/scene/gore/ImpactResolver";

// ---------------------------------------------------------------- fixtures

const TILE = DEFAULT_BOARD.tile, TOP = DEFAULT_BOARD.top, HALF = TILE * 4;
const FIGHT = combatSeed(["e4", "d5", "exd5"]);
const DIAGONAL = Math.SQRT1_2;

/** An Aethelgard Pawn's spear goes into a Solforiz Pawn's chest on d5. */
const strike = (over: Partial<GoreEvent> = {}): GoreEvent => ({
  impactId: impactIdOf(3, "kill"), seed: goreSeed(FIGHT, "kill"), ply: 3,
  attacker: { kind: "p", kingdom: "ivory", weapon: "spear" },
  defender: { kind: "p", kingdom: "sun", shield: "wood" },
  contact: { point: { x: -0.5 * TILE, y: 0.5, z: -0.5 * TILE }, normal: { x: DIAGONAL, y: 0, z: DIAGONAL }, direction: { x: -DIAGONAL, y: 0, z: -DIAGONAL }, anchor: "torso" },
  power: 0.85, outcome: "kill", intensity: "cinematic", quality: "high",
  flags: { menuBoard: false, reducedMotion: false, tactical: false },
  ...over,
});
const flagged = (flags: Partial<GoreEvent["flags"]>, over: Partial<GoreEvent> = {}) =>
  strike({ ...over, flags: { menuBoard: false, reducedMotion: false, tactical: false, ...flags } });
const empty = (plan: GorePlan) => !plan.sprays.length && !plan.stains.length && !plan.wound && !plan.pool && !plan.weaponStain && !plan.splashes.length;
const flying = (plan: GorePlan) => plan.sprays.reduce((sum, spray) => sum + spray.droplets, 0);
const mist = (plan: GorePlan) => plan.sprays.reduce((sum, spray) => sum + spray.mist, 0);
const droplets = (plan: GorePlan): Droplet[] => {
  const all: Droplet[] = [];
  for (const spray of plan.sprays) expandSpray(spray, TOP, d => { all.push({ ...d, origin: { ...d.origin }, velocity: { ...d.velocity } }); });
  return all;
};

/** A sink that writes down what it is told, with the ledger's clock time. */
class Recorder implements GoreSink {
  now = 0;
  readonly log: { what: string; impact: string; at: number; x?: number; z?: number }[] = [];
  private note(what: string, impact: string, x?: number, z?: number) { this.log.push({ what, impact, at: Math.round(this.now * 1e6) / 1e6, x, z }); }
  spray: GoreSink["spray"] = (plan, spray) => this.note(spray.id, plan.impactId);
  stain: GoreSink["stain"] = (plan, stain) => this.note("stain", plan.impactId, stain.x, stain.z);
  wound: GoreSink["wound"] = plan => this.note("wound", plan.impactId);
  weaponStain: GoreSink["weaponStain"] = plan => this.note("weapon", plan.impactId);
  splash: GoreSink["splash"] = (plan, splash) => this.note(`splash.${splash.target}`, plan.impactId);
  pool: GoreSink["pool"] = (plan, _pool, at) => this.note("pool", plan.impactId, at.x, at.z);
  releaseBody(impact: string) { this.note("release-body", impact); }
  releaseWeapon(impact: string) { this.note("release-weapon", impact); }
  remove(impact: string) { this.note("remove", impact); }
  clear() { this.note("clear", ""); }
  of(what: string) { return this.log.filter(item => item.what === what); }
}
const run = (ledger: GoreLedger, sink: Recorder, seconds: number, step: number) => {
  for (let t = 0; t < seconds - 1e-9; t += step) { sink.now += step; ledger.update(step); }
};

// ---------------------------------------------------------------- determinism

test("the same event always yields the same plan", () => {
  const a = planGore(strike()), b = planGore(strike());
  assert.deepEqual(a, b);
  assert.deepEqual(droplets(a), droplets(b), "every droplet, to the bit");
  assert.equal(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))), "a plan is plain data");
  assert.ok(a.sprays.length && a.stains.length > 1 && a.wound && a.pool && a.weaponStain, "cinematic shows spray, wound, stains and pool");
});

test("the seed comes from the fight and the contact, and changes the blood", () => {
  assert.equal(goreSeed(FIGHT, "kill"), goreSeed(combatSeed(["e4", "d5", "exd5"]), "kill"), "the same game seeds the same blood");
  assert.notEqual(goreSeed(FIGHT, "kill"), goreSeed(FIGHT, "first"));
  assert.notEqual(goreSeed(FIGHT, "kill"), goreSeed(combatSeed(["e4", "d5", "c4", "e6", "cxd5"]), "kill"));
  const other = planGore(strike({ seed: goreSeed(FIGHT + 1, "kill") }));
  assert.notDeepEqual(other.stains, planGore(strike()).stains);
});

test("Undo then the same capture puts back exactly the same blood", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const first = ledger.begin(strike());
  run(ledger, sink, 2, 1 / 60); ledger.land(first.impactId); run(ledger, sink, 1, 1 / 60);
  const before = sink.log.filter(item => item.what === "stain" || item.what === "pool").map(({ what, x, z }) => ({ what, x, z }));
  ledger.undoTo(2);
  sink.log.length = 0;
  const again = ledger.begin(strike());
  run(ledger, sink, 2, 1 / 30); ledger.land(again.impactId); run(ledger, sink, 1, 1 / 30);
  assert.deepEqual(again, first);
  assert.deepEqual(sink.log.filter(item => item.what === "stain" || item.what === "pool").map(({ what, x, z }) => ({ what, x, z })), before);
});

// ---------------------------------------------------------------- budgets

test("budgets hold for every quality and intensity", () => {
  for (const quality of QUALITY_ORDER) {
    for (const intensity of GORE_INTENSITIES) {
      const budget = goreBudget(quality, intensity);
      for (const power of [0.3, 0.85, 1.35, 2]) {
        const plan = planGore(strike({ quality, intensity, power })), label = `${quality}/${intensity}/${power}`;
        assert.ok(flying(plan) - plan.sprays.filter(spray => spray.id === "drip").length <= budget.maxDroplets, `${label}: droplets`);
        assert.ok(mist(plan) <= budget.mist, `${label}: mist`);
        assert.ok(plan.stains.length >= 1 && plan.stains.length <= budget.stains, `${label}: stains`);
        assert.ok(plan.sprays.filter(spray => spray.id === "drip").length <= budget.drips, `${label}: drips`);
        for (const stain of plan.stains) assert.ok(stain.radius <= budget.stainRadius * TILE * 1.15 + 1e-9, `${label}: stain size`);
        // Two captures can overlap (one settling as the next lands): the pool never runs out.
        assert.ok(2 * (flying(plan) + mist(plan)) <= GORE_CAPACITY[quality].particles, `${label}: particle pool`);
        assert.ok(plan.stains.length + 1 <= GORE_CAPACITY[quality].decals);
      }
    }
  }
});

test("intensity chooses what is shown: minimal, cinematic, full", () => {
  for (const quality of QUALITY_ORDER) {
    const minimal = planGore(strike({ quality, intensity: "minimal" }));
    assert.equal(minimal.stains.length, 1, "minimal: one stain");
    assert.ok(minimal.stains[0].radius <= 0.07 * TILE + 1e-9, "minimal: a small one");
    assert.ok(!minimal.sprays.length && !minimal.wound && !minimal.pool && !minimal.weaponStain, "minimal: nothing else");

    const cinematic = planGore(strike({ quality, intensity: "cinematic" })), full = planGore(strike({ quality, intensity: "full" }));
    assert.ok(flying(cinematic) > 0 && cinematic.wound && cinematic.pool && cinematic.stains.length >= 2, `${quality} cinematic: spray, wound, stains, pool`);
    assert.ok(mist(full) >= mist(cinematic), "full: at least as much mist");
    assert.equal(cinematic.weaponStain?.linger, 6, "cinematic: the weapon stain fades");
    assert.ok(flying(full) > flying(cinematic), `${quality} full: more droplets`);
    assert.ok(full.pool!.maxRadius > cinematic.pool!.maxRadius, "full: a bigger pool");
    assert.equal(full.weaponStain?.linger, null, "full: the weapon stain lingers");
    if (quality !== "low") assert.ok(mist(full) > 0, `${quality} full: mist`);
  }
});

test("a better preset never shows less, and the high preset sits in the creator's range", () => {
  for (const intensity of ["cinematic", "full"] as GoreIntensity[]) {
    let last = 0;
    for (const quality of QUALITY_ORDER) {
      const count = flying(planGore(strike({ quality, intensity, power: 1 })));
      assert.ok(count >= last, `${quality}/${intensity}`);
      last = count;
    }
  }
  const major = flying(planGore(strike({ quality: "high", intensity: "full", power: 1 })));
  assert.ok(major >= 30 && major <= 80, `high/full at power 1: ${major}`);
  assert.ok(flying(planGore(strike({ quality: "low", power: 1 }))) <= 12, "low stays within a Quest-sized budget");
  for (const quality of QUALITY_ORDER) for (const intensity of GORE_INTENSITIES) assert.ok(goreBudget(quality, intensity).stains <= 5);
});

test("a harder blow throws more, never past the cap", () => {
  const soft = planGore(strike({ power: 0.4 })), hard = planGore(strike({ power: 1.35 })), absurd = planGore(strike({ power: 99 }));
  assert.ok(flying(hard) > flying(soft));
  assert.ok(hard.pool!.maxRadius > soft.pool!.maxRadius);
  assert.deepEqual(absurd, planGore(strike({ power: 99 })));
  assert.ok(flying(absurd) <= goreBudget("high", "cinematic").maxDroplets + goreBudget("high", "cinematic").drips);
});

// ---------------------------------------------------------------- impact resolver

test("a shield never bleeds: wood splinters, iron sparks", () => {
  for (const [shield, response] of [["wood", "splinters"], ["iron", "sparks"]] as const) {
    for (const outcome of ["blocked", "kill"] as const) {
      const event = strike({ outcome, defender: { kind: "p", kingdom: "sun", shield }, contact: { ...strike().contact, anchor: "shield" } });
      const plan = planGore(event);
      assert.equal(plan.surface.response, response);
      assert.equal(plan.surface.breached, false);
      assert.equal(plan.silent, "no-breach");
      assert.ok(empty(plan), `${shield} shield, ${outcome}`);
    }
  }
  // The rig's own shield when the stage does not say: Aethelgard iron, Solforiz wood.
  assert.equal(resolveImpact({ ...strike(), defender: { kind: "p", kingdom: "ivory" }, contact: { anchor: "shield" } }).material, "iron");
  assert.equal(resolveImpact({ ...strike(), defender: { kind: "p", kingdom: "sun" }, contact: { anchor: "shield" } }).material, "wood");
  const parry = planGore(strike({ outcome: "blocked", contact: { ...strike().contact, anchor: "weapon" } }));
  assert.equal(parry.surface.response, "sparks");
  assert.ok(empty(parry), "steel on steel");
});

test("armor without a breach never bleeds", () => {
  // A Pawn's spear on a Rook's plate: sparks, no blood, even as the killing contact.
  const rook = planGore(strike({ defender: { kind: "r", kingdom: "sun" } }));
  assert.deepEqual([rook.surface.material, rook.surface.breached, rook.surface.response], ["plate", false, "sparks"]);
  assert.ok(empty(rook));
  // A torso contact that is not the kill stays on the surface, whatever is under it.
  for (const outcome of ["blocked", "glance"] as const) {
    for (const kingdom of ["ivory", "sun"] as const) {
      const plan = planGore(strike({ outcome, defender: { kind: "p", kingdom } }));
      assert.equal(plan.surface.breached, false);
      assert.ok(empty(plan), `${kingdom} torso, ${outcome}`);
    }
  }
  // A fist does not go through mail.
  assert.ok(empty(planGore(strike({ attacker: { kind: "p", kingdom: "sun", weapon: "fist" }, defender: { kind: "p", kingdom: "ivory" } }))));
});

test("every figure has its own region table, and a killing thrust to a Pawn's torso bleeds", () => {
  assert.equal(rigOf("p", "ivory"), "wp"); assert.equal(rigOf("p", "sun"), "bp");
  for (const kingdom of ["ivory", "sun", "empire", "kwind"] as const) for (const kind of ["p", "n", "b", "r", "q", "k"] as const) {
    const id = rigOf(kind, kingdom);
    assert.ok(id && RIG_REGIONS[id], `${kingdom} ${kind} has a table`);
  }
  const kwind = planGore(strike({ defender: { kind: "p", kingdom: "kwind" } }));
  assert.equal(kwind.surface.rig, "kwind.p", "Kwind-09's trooper resolves through its own table");
  assert.equal(kwind.surface.material, "cloth", "its quilted greatcoat");
  assert.ok(kwind.surface.breached && kwind.wound, "and bleeds from a killing thrust");
  assert.equal(RIG_REGIONS.wp.torso.material, "mail"); assert.equal(RIG_REGIONS.bp.torso.material, "cloth");
  for (const kingdom of ["ivory", "sun"] as const) {
    const plan = planGore(strike({ defender: { kind: "p", kingdom } }));
    assert.equal(plan.surface.rig, kingdom === "ivory" ? "wp" : "bp");
    assert.deepEqual([plan.surface.flesh, plan.surface.breached, plan.surface.response], [true, true, "blood"]);
    assert.equal(plan.wound?.kind, "stab"); assert.equal(plan.wound?.anchor, "torso");
    assert.ok(flying(plan) > 0);
  }
});

test("each figure answers a blow with what it is seen to wear", () => {
  const glance = (kind: GoreKind, kingdom: GoreKingdom, anchor: "torso" | "head" = "torso") =>
    planGore(strike({ outcome: "glance", defender: { kind, kingdom }, contact: { ...strike().contact, anchor } })).surface;
  // The Aethelgard knight's plate throws sparks; the Solforiz knight has none to throw: robes and leather over him.
  assert.deepEqual([glance("n", "ivory").material, glance("n", "ivory").response], ["plate", "sparks"]);
  assert.deepEqual([glance("n", "sun").material, glance("n", "sun").response], ["cloth", "none"]);
  // Korvenia's steel is the cuirassier's alone: its gun crew and its sovereign wear wool.
  assert.equal(glance("n", "empire").response, "sparks");
  assert.equal(glance("r", "empire").material, "cloth"); assert.equal(glance("k", "empire").material, "cloth");
  // Kwind-09's foundry wears plate; its Chairman a coat.
  assert.equal(glance("r", "kwind").material, "plate"); assert.equal(glance("k", "kwind").material, "cloth");
  // A crown is not a helm: the bare-headed royals' heads are skin; the Scorched Sovereign's gilded helm is plate.
  for (const kingdom of ["ivory", "empire", "kwind"] as const) assert.equal(glance("k", kingdom, "head").material, "skin", `${kingdom} king`);
  assert.equal(glance("k", "sun", "head").material, "plate");
  // The Solforiz knight's cleaver kill goes through its lamellar; a mace does not open the Aethelgard knight's plate.
  const kill = (kind: GoreKind, kingdom: GoreKingdom, weapon: GoreWeapon, power: number) =>
    planGore(strike({ attacker: { kind: "n", kingdom: "ivory", weapon }, defender: { kind, kingdom }, power })).surface.breached;
  assert.equal(kill("n", "sun", "sword", 1.1), true);
  assert.equal(kill("n", "ivory", "sword", 1.1), true, "a killing thrust finds the gaps in plate");
  assert.equal(kill("n", "ivory", "mace", 1.15), false);
});

// ---------------------------------------------------------------- rules

test("the menu board shows nothing, and a King is never captured", () => {
  for (const quality of QUALITY_ORDER) for (const intensity of GORE_INTENSITIES) {
    const plan = planGore(flagged({ menuBoard: true }, { quality, intensity }));
    assert.equal(plan.silent, "menu");
    assert.ok(empty(plan), `${quality}/${intensity}`);
  }
  const king = planGore(strike({ defender: { kind: "k", kingdom: "sun" }, power: 2, attacker: { kind: "q", kingdom: "ivory", weapon: "lance" } }));
  assert.equal(king.silent, "king");
  assert.ok(empty(king), "no checkmate gore");
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  ledger.begin(flagged({ menuBoard: true }));
  run(ledger, sink, 3, 1 / 60);
  assert.deepEqual(sink.log, [], "nothing reaches the scene");
});

test("blood is presentation only: no plan records an injury or a death", () => {
  for (const intensity of GORE_INTENSITIES) {
    const plan = planGore(strike({ intensity }));
    assert.equal(plan.consequence, "presentation");
    assert.ok(!/injur|scar|dead|death|kill/i.test(JSON.stringify({ ...plan, impactId: "" })));
  }
});

test("reduced motion: nothing flies, stains and pool are simply there", () => {
  for (const quality of QUALITY_ORDER) for (const intensity of ["cinematic", "full"] as GoreIntensity[]) {
    const plan = planGore(flagged({ reducedMotion: true }, { quality, intensity })), moving = planGore(strike({ quality, intensity }));
    assert.equal(plan.sprays.length, 0, "no droplets, no mist, no drips");
    assert.ok(plan.stains.every(stain => stain.at === 0), "stains appear at once");
    assert.deepEqual(plan.stains.map(({ x, z, radius }) => ({ x, z, radius })).sort((a, b) => a.x - b.x),
      moving.stains.map(({ x, z, radius }) => ({ x, z, radius })).sort((a, b) => a.x - b.x), "in the same places as with motion");
    assert.equal(plan.pool?.grow, 0, "the pool does not spread");
    assert.equal(plan.wound?.bleed, 0);
  }
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  ledger.begin(flagged({ reducedMotion: true }));
  assert.equal(sink.of("stain").length, planGore(flagged({ reducedMotion: true })).stains.length, "all there on the contact frame");
  assert.equal(sink.of("spray").length + sink.of("spurt").length + sink.of("drip").length, 0);
});

test("tactical view: stains only", () => {
  const plan = planGore(flagged({ tactical: true }, { intensity: "full", quality: "ultra" }));
  assert.ok(plan.stains.length > 1);
  assert.ok(!plan.sprays.length && !plan.wound && !plan.pool && !plan.weaponStain);
});

// ---------------------------------------------------------------- droplets and stains

test("every droplet's landing is known up front and lies on the board plane", () => {
  const plan = planGore(strike({ intensity: "full", quality: "ultra", power: 1.35 })), at = { x: 0, y: 0, z: 0 };
  const all = droplets(plan);
  assert.ok(all.length > 40);
  for (const d of all.filter(item => item.kind === 0)) {
    assert.ok(d.lands && d.life > 0 && d.life < 2, "a droplet is in the air for under two seconds");
    flightPosition(d, d.life, at);
    assert.ok(Math.abs(at.y - TOP) < 1e-9, "it meets y = BOARD_TOP");
    assert.ok(Math.abs(at.x - d.landX) < 1e-12 && Math.abs(at.z - d.landZ) < 1e-12);
    assert.equal(d.life, landingTime(d, TOP));
  }
  // The spray is directional: it carries along the blow, not in a ring.
  const along = all.filter(d => d.kind === 0 && d.index < plan.sprays[0].droplets).map(d => (d.landX - d.origin.x) * -DIAGONAL + (d.landZ - d.origin.z) * -DIAGONAL);
  assert.ok(along.filter(distance => distance > 0).length >= along.length * 0.9);
});

test("stains are planned where droplets land, on the board, apart from each other", () => {
  for (const quality of QUALITY_ORDER) {
    const plan = planGore(strike({ quality, intensity: "full" })), all = droplets(plan);
    assert.equal(plan.stains[0].source, "contact");
    for (const stain of plan.stains) {
      assert.ok(Math.abs(stain.x) <= HALF && Math.abs(stain.z) <= HALF, "on the board");
      assert.ok(stain.radius > 0 && stain.stretch >= 1 && stain.shape >= 0 && stain.shape < 1);
      if (stain.source !== "spray") continue;
      const source = all.find(d => d.landX === stain.x && d.landZ === stain.z);
      assert.ok(source, "a stain lies exactly where a planned droplet comes down");
      assert.ok(Math.abs(stain.at - (source.delay + source.life)) < 1e-12, "and appears as it lands");
    }
    for (const a of plan.stains) for (const b of plan.stains) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.15 * TILE);
  }
  // A capture on the rim: what would land off the board leaves no mark hanging in the air.
  const rim = planGore(strike({ contact: { point: { x: -3.5 * TILE, y: 0.5, z: -3.5 * TILE }, normal: { x: DIAGONAL, y: 0, z: DIAGONAL }, direction: { x: -DIAGONAL, y: 0, z: -DIAGONAL }, anchor: "torso" } }));
  for (const stain of rim.stains) assert.ok(Math.abs(stain.x) + stain.radius <= HALF + 1e-9 && Math.abs(stain.z) + stain.radius <= HALF + 1e-9);
  assert.ok(Math.abs(rim.pool!.x) <= HALF && Math.abs(rim.pool!.z) <= HALF);
});

test("droplet landing points are identical for any time step", () => {
  const plan = planGore(strike({ intensity: "full", quality: "ultra" }));
  const reference = droplets(plan).filter(d => d.kind === 0);
  // What a frame loop sees: the droplet is drawn at the closed-form position for the
  // current clock, and is gone on the first frame at or past its landing time.
  const fly = (d: Droplet, step: (frame: number) => number) => {
    const at = { x: 0, y: 0, z: 0 };
    let clock = 0, frame = 0, lowest = Infinity;
    while (clock < d.life) { flightPosition(d, clock, at); lowest = Math.min(lowest, at.y); clock += step(frame); frame += 1; }
    flightPosition(d, d.life, at);
    return { x: at.x, z: at.z, lowest, overshoot: clock - d.life };
  };
  const steps: [string, (frame: number) => number][] = [
    ["24 fps", () => 1 / 24], ["60 fps", () => 1 / 60], ["144 fps", () => 1 / 144], ["7 fps", () => 1 / 7],
    ["stalling", frame => frame % 5 === 3 ? 0.21 : 1 / 90],
  ];
  for (const d of reference) {
    for (const [label, step] of steps) {
      const flown = fly(d, step);
      assert.equal(flown.x, d.landX, `${label}: x`);
      assert.equal(flown.z, d.landZ, `${label}: z`);
      assert.ok(flown.lowest >= TOP - 1e-9, `${label}: never drawn under the board`);
    }
  }
  // The closed form is the real flight: a fine-step integration of dv/dt = g - k v lands in the same place.
  for (const d of reference.slice(0, 12)) {
    const p = { ...d.origin }, v = { ...d.velocity }, h = 1e-5;
    while (p.y > TOP) {
      v.x -= d.drag * v.x * h; v.y += (-GORE_GRAVITY - d.drag * v.y) * h; v.z -= d.drag * v.z * h;
      p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
    }
    assert.ok(Math.hypot(p.x - d.landX, p.z - d.landZ) < 2e-3, "integrated landing matches the planned one");
  }
  // And the stains reach the scene at the same places whatever the frame time.
  const marks = [1 / 24, 1 / 60, 1 / 144, 1 / 7].map(step => {
    const sink = new Recorder(), ledger = new GoreLedger(sink);
    ledger.begin(strike({ intensity: "full", quality: "ultra" }));
    run(ledger, sink, 3, step);
    for (const [index, item] of sink.of("stain").entries()) assert.ok(item.at - plan.stains[index].at < step + 1e-6 && item.at >= plan.stains[index].at - 1e-6, "within one frame of the landing");
    return sink.of("stain").map(({ x, z }) => ({ x, z }));
  });
  for (const other of marks) assert.deepEqual(other, marks[0]);
  assert.deepEqual(marks[0], plan.stains.map(({ x, z }) => ({ x, z })));
});

// ---------------------------------------------------------------- lifecycle

test("the ledger plays a plan on the fight clock: spray and wound at the blow, the pool at the landing", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const plan = ledger.begin(strike({ intensity: "full" }));
  assert.deepEqual(sink.log.filter(item => item.at === 0).map(item => item.what).sort(), ["splash.weapon", "splash.weapon", "spray", "weapon", "wound"], "on the contact frame");
  assert.ok(sink.log.findIndex(item => item.what === "splash.weapon") < sink.log.findIndex(item => item.what === "weapon"), "decals first: the plain smear is the fallback");
  run(ledger, sink, 1.9, 1 / 60);
  assert.equal(sink.of("spurt").length, 1);
  assert.ok(Math.abs(sink.of("spurt")[0].at - 0.16) < 1 / 60 + 1e-6);
  assert.equal(sink.of("stain").length, plan.stains.length);
  assert.equal(sink.of("drip").length, plan.sprays.filter(spray => spray.id === "drip").length);
  assert.equal(sink.of("splash.attacker").length, 1, "what flies back reaches the killer a moment later");
  assert.equal(sink.of("pool").length, 0, "no pool before the body is down");
  // A stalled clock stalls the blood with the fight.
  ledger.update(0);
  ledger.land(plan.impactId, { x: 1.25, z: -0.5 });
  ledger.land(plan.impactId);
  run(ledger, sink, 0.5, 1 / 60);
  assert.deepEqual(sink.of("pool").map(({ x, z }) => ({ x, z })), [{ x: 1.25, z: -0.5 }], "one pool, where the body really lies");
  assert.ok(sink.of("pool")[0].at >= 1.9 + plan.pool!.delay - 1e-6);
  // Banish takes the wound with the body; the blood on the board stays.
  ledger.bodyGone(plan.impactId);
  assert.deepEqual(sink.of("release-body").map(item => item.impact), [plan.impactId]);
  assert.equal(sink.of("remove").length + sink.of("clear").length, 0);
  assert.ok(ledger.has(plan.impactId));
  // The runs of blood are the wound mask's, which stays on the body until the figure has gone: they finish.
  run(ledger, sink, 3, 1 / 60);
  assert.equal(ledger.pending, false);
});

test("a brief weapon stain is released after its time; a lingering one is not", () => {
  for (const [intensity, released] of [["cinematic", 1], ["full", 0]] as const) {
    const sink = new Recorder(), ledger = new GoreLedger(sink);
    ledger.begin(strike({ intensity }));
    run(ledger, sink, 8, 1 / 30);
    assert.equal(sink.of("release-weapon").length, released, intensity);
  }
});

test("undoTo removes the later plies and keeps the earlier ones", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const at = (ply: number) => strike({ ply, impactId: impactIdOf(ply, "kill"), seed: goreSeed(FIGHT + ply, "kill") });
  for (const ply of [3, 8, 11]) { ledger.begin(at(ply)); run(ledger, sink, 2.5, 1 / 60); ledger.land(impactIdOf(ply, "kill")); run(ledger, sink, 0.5, 1 / 60); }
  assert.deepEqual(ledger.plans.map(plan => plan.ply), [3, 8, 11]);
  assert.deepEqual(ledger.undoTo(10), ["11:kill"]);
  assert.deepEqual(sink.of("remove").map(item => item.impact), ["11:kill"]);
  assert.deepEqual(ledger.undoTo(10), [], "idempotent");
  assert.deepEqual(ledger.undoTo(7), ["8:kill"]);
  assert.deepEqual(ledger.plans.map(plan => plan.ply), [3], "the earlier capture's blood stays");
  // Undone mid-fight: what was still waiting on the clock never appears.
  ledger.begin(at(8));
  const seen = sink.log.length;
  ledger.undoTo(7);
  run(ledger, sink, 3, 1 / 60); ledger.land("8:kill"); run(ledger, sink, 1, 1 / 60);
  assert.deepEqual(sink.log.slice(seen).map(item => item.what), ["remove"]);
  // Playing a ply again (replay stepping back, a different capture after Undo) clears what was there from it on.
  ledger.begin(at(11)); ledger.begin(at(8));
  assert.deepEqual(ledger.plans.map(plan => plan.ply), [3, 8]);
  ledger.undoTo(0);
  assert.deepEqual(ledger.plans, []);
});

test("reset and dispose leave nothing", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  ledger.begin(strike());
  ledger.reset();
  assert.deepEqual(ledger.plans, []);
  assert.equal(sink.of("clear").length, 1);
  run(ledger, sink, 3, 1 / 60);
  assert.equal(sink.of("stain").length, planGore(strike()).stains.filter(stain => stain.at === 0).length, "nothing arrives after a reset");
  ledger.dispose(); ledger.dispose();
  const count = sink.log.length;
  assert.ok(ledger.begin(strike()).stains.length > 0, "still plans");
  assert.equal(sink.log.length, count, "but touches nothing once disposed");
});

// ---------------------------------------------------------------- pools

test("the droplet pool is fixed: a burst allocates nothing and a full pool reuses its oldest slot", () => {
  const pool = new ParticleBuffer(GORE_CAPACITY.low.particles), arrays = [pool.origin, pool.velocity, pool.timing, pool.look];
  const plan = planGore(strike({ quality: "ultra", intensity: "full", power: 2 }));
  for (let burst = 0; burst < 6; burst += 1) for (const spray of plan.sprays) expandSpray(spray, TOP, d => pool.emit(d, burst + d.delay));
  assert.equal(pool.used, pool.capacity, "never past its capacity");
  assert.deepEqual([pool.origin, pool.velocity, pool.timing, pool.look], arrays);
  assert.equal(pool.origin.length, pool.capacity * 3);
  assert.ok(pool.idleAt > 5);
  pool.clear();
  assert.deepEqual([pool.used, pool.idleAt], [0, 0]);
});

test("board marks are capped per match: the oldest fade, and Undo removes by impact", () => {
  const marks = new DecalBuffer(4);
  const mark = (x: number): DecalRecord => ({ x, z: 0, radius: 0.1, rotation: 0, kind: 0, shape: 0.5, stretch: 1, grow: 0, grooveBias: 0 });
  for (let i = 0; i < 4; i += 1) marks.add(`${i < 2 ? 3 : 8}:kill`, mark(i), i);
  assert.deepEqual([marks.count, marks.staying], [4, 4]);
  marks.add("11:kill", mark(4), 10);
  assert.deepEqual([marks.count, marks.staying], [5, 4], "the oldest starts to fade, the new one is drawn");
  assert.equal(marks.life[0], 10, "the first mark laid is the one that fades");
  marks.update(10 + DECAL_FADE_SECONDS / 2);
  assert.equal(marks.count, 5);
  marks.update(10 + DECAL_FADE_SECONDS);
  assert.deepEqual([marks.count, marks.staying], [4, 4], "and is freed when the fade is done");
  assert.equal(marks.removeImpact("8:kill"), 2);
  assert.deepEqual([...Array(marks.count).keys()].map(i => marks.impactOf(i)).sort(), ["11:kill", "3:kill"]);
  for (let i = 0; i < 40; i += 1) marks.add("12:kill", mark(i), 20);
  assert.ok(marks.count <= marks.slots && marks.staying === 4, "a flood never grows the buffer");
  assert.equal(marks.place.length, marks.slots * 4);
  marks.clear();
  assert.equal(marks.count, 0);
});

// ---------------------------------------------------------------- decals on surfaces

test("decals on the killer and the weapon are budgeted, planned and reproducible", () => {
  const counts = QUALITY_ORDER.map(quality => planGore(strike({ quality })).splashes.length);
  assert.deepEqual(counts, [0, 2, 3, 3], "none on low, at most three on high");
  for (const quality of QUALITY_ORDER) for (const intensity of GORE_INTENSITIES) {
    const plan = planGore(strike({ quality, intensity })), budget = goreBudget(quality, intensity);
    assert.ok(plan.splashes.length <= budget.splashes && plan.splashes.length <= 3, `${quality}/${intensity}`);
    assert.equal(plan.wound ? plan.wound.bind : "bone", budget.skinWound && plan.wound ? "skin" : "bone");
    if (intensity === "minimal") assert.equal(plan.splashes.length, 0);
    assert.deepEqual(plan.splashes, planGore(strike({ quality, intensity })).splashes, "the same blow marks the same places");
  }
  const plan = planGore(strike());
  assert.deepEqual(plan.splashes.map(splash => splash.target), ["weapon", "attacker", "weapon"], "the spearhead, the armour, the shaft");
  assert.ok(plan.splashes[0].along < plan.splashes[2].along, "the head first, then further down the shaft");
  const back = plan.splashes[1].direction, blow = strike().contact.direction;
  assert.ok(Math.abs(Math.hypot(back.x, back.y, back.z) - 1) < 1e-9);
  assert.ok(back.x * blow.x + back.y * blow.y + back.z * blow.z < -0.5, "the armour is marked by what comes back against the blow");
  assert.equal(planGore(flagged({ tactical: true })).splashes.length, 0);
  assert.equal(planGore(strike({ quality: "low" })).wound?.bind, "bone", "the low preset keeps the cheap quad");
});

/** A bent tube: two bones along y, weights blending across the joint at y = 1. Identity bind. */
function tube(rings = 9, sides = 12): SkinSource & { bind: Float32Array; pose(angle: number): void } {
  const count = rings * sides, bind = new Float32Array(count * 3), skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  for (let r = 0; r < rings; r += 1) for (let s = 0; s < sides; s += 1) {
    const i = r * sides + s, y = r / (rings - 1) * 2, angle = s / sides * Math.PI * 2;
    bind.set([Math.cos(angle) * 0.2, y, Math.sin(angle) * 0.2], i * 3);
    const upper = Math.min(1, Math.max(0, (y - 0.6) / 0.8));
    skinIndex.set([0, 1, 0, 0], i * 4); skinWeight.set([1 - upper, upper, 0, 0], i * 4);
  }
  const index: number[] = [];
  for (let r = 0; r + 1 < rings; r += 1) for (let s = 0; s < sides; s += 1) {
    const a = r * sides + s, b = r * sides + (s + 1) % sides, c = a + sides, d = b + sides;
    index.push(a, c, b, b, c, d);
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const source = {
    posed: new Float32Array(count * 3), vertices: count, index, skinIndex, skinWeight,
    boneMatrices: new Float32Array([...identity, ...identity]), bindMatrix: identity, bindMatrixInverse: identity, bind,
    /** Bends the upper bone about the x axis through the joint at (0, 1, 0), and re-skins the surface. */
    pose(angle: number) {
      const c = Math.cos(angle), s = Math.sin(angle);
      // Rotation about x through y = 1: p' = R (p - j) + j, column-major.
      (source.boneMatrices as Float32Array).set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 1 - c, -s, 1], 16);
      const out = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < count; i += 1) { skinPoint(source, skinIndex, skinWeight, i, bind[i * 3], bind[i * 3 + 1], bind[i * 3 + 2], out); source.posed.set([out.x, out.y, out.z], i * 3); }
    },
  };
  source.pose(0);
  return source;
}
/** The point of the skinned surface a decal vertex came from: its source triangle's posed corners at its barycentric weights. */
function onSurface(source: SkinSource, triangle: number, bary: ArrayLike<number>, at: number) {
  const p = { x: 0, y: 0, z: 0 };
  for (let c = 0; c < 3; c += 1) {
    const i = (source.index as number[])[triangle * 3 + c], w = bary[at * 3 + c];
    p.x += source.posed[i * 3] * w; p.y += source.posed[i * 3 + 1] * w; p.z += source.posed[i * 3 + 2] * w;
  }
  return p;
}

test("a skin-bound decal takes its triangles' weights and lies exactly on the posed surface it was made on", () => {
  for (const made of [0, 0.5, -0.9]) {
    const body = tube();
    body.pose(made);
    // A wound across the joint, on the +z side of the tube as it is bent now.
    const origin = onSurface(body, 2 * 12 * 3 + 6, [1 / 3, 1 / 3, 1 / 3], 0);
    const decal = projectSkinDecal(body, { origin, normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, half: { x: 0.15, y: 0.45, z: 0.3 } })!;
    assert.ok(decal && decal.vertices >= 12 && decal.vertices % 3 === 0, `pose ${made}: ${decal?.vertices} vertices`);
    const out = { x: 0, y: 0, z: 0 };
    let blendedWeights = 0;
    for (let v = 0; v < decal.vertices; v += 1) {
      const weights = [...decal.skinWeight.subarray(v * 4, v * 4 + 4)];
      assert.ok(Math.abs(weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-6, "weights are normalised");
      // The weights are the source triangle's, blended by the barycentric position.
      const t = decal.triangle[v], expected = [0, 0];
      for (let c = 0; c < 3; c += 1) {
        const i = (body.index as number[])[t * 3 + c];
        for (let k = 0; k < 4; k += 1) expected[body.skinIndex[i * 4 + k]] += body.skinWeight[i * 4 + k] * decal.bary[v * 3 + c];
      }
      const got = [0, 0];
      for (let k = 0; k < 4; k += 1) got[decal.skinIndex[v * 4 + k]] += decal.skinWeight[v * 4 + k];
      assert.ok(Math.abs(got[0] - expected[0]) < 1e-5 && Math.abs(got[1] - expected[1]) < 1e-5, "barycentric blend of the triangle's weights");
      if (got[0] > 0.05 && got[1] > 0.05) blendedWeights += 1;
      // Bind space is the inverse of the vertex's own blended bone matrix: skinned again, it is back on the posed surface.
      skinPoint(body, decal.skinIndex, decal.skinWeight, v, decal.position[v * 3], decal.position[v * 3 + 1], decal.position[v * 3 + 2], out);
      const surface = onSurface(body, t, decal.bary, v);
      assert.ok(Math.hypot(out.x - surface.x, out.y - surface.y, out.z - surface.z) < 1e-5, `pose ${made}: on the surface at creation`);
      assert.ok(decal.uv[v * 2] >= -1e-6 && decal.uv[v * 2] <= 1 + 1e-6 && decal.uv[v * 2 + 1] >= -1e-6 && decal.uv[v * 2 + 1] <= 1 + 1e-6, "clipped to the projector box");
    }
    assert.ok(blendedWeights > 0, "the decal spans the joint");
  }
});

test("the wound stays on the surface after a bone rotates", () => {
  const body = tube(17, 16);
  const origin = { x: 0, y: 1, z: 0.2 };
  const decal = projectSkinDecal(body, { origin, normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, half: { x: 0.12, y: 0.4, z: 0.25 } })!;
  assert.ok(decal.vertices > 30);
  const out = { x: 0, y: 0, z: 0 };
  for (const angle of [0.4, 0.9, -0.7, 1.4]) {
    body.pose(angle);
    let worst = 0, moved = 0;
    for (let v = 0; v < decal.vertices; v += 1) {
      skinPoint(body, decal.skinIndex, decal.skinWeight, v, decal.position[v * 3], decal.position[v * 3 + 1], decal.position[v * 3 + 2], out);
      const surface = onSurface(body, decal.triangle[v], decal.bary, v);
      worst = Math.max(worst, Math.hypot(out.x - surface.x, out.y - surface.y, out.z - surface.z));
      moved = Math.max(moved, Math.hypot(out.x - decal.position[v * 3], out.y - decal.position[v * 3 + 1], out.z - decal.position[v * 3 + 2]));
    }
    // Linear blend skinning is not linear across a triangle whose corners have different weights, so the
    // decal may leave the faceted surface by a hair inside such a triangle. It must stay within a small
    // fraction of the decal's own size, while the surface under it has moved many times further.
    assert.ok(worst < 0.012, `bend ${angle}: ${worst.toFixed(4)} off the surface`);
    assert.ok(moved > 0.15 && moved > worst * 12, `bend ${angle}: the wound travelled ${moved.toFixed(3)} with the body`);
  }
  // A quad parented to one bone would not: across the joint it comes off the other bone's surface entirely.
  body.pose(1.4);
  let rigidWorst = 0;
  for (let v = 0; v < decal.vertices; v += 1) {
    const surface = onSurface(body, decal.triangle[v], decal.bary, v);
    rigidWorst = Math.max(rigidWorst, Math.hypot(decal.position[v * 3] - surface.x, decal.position[v * 3 + 1] - surface.y, decal.position[v * 3 + 2] - surface.z));
  }
  assert.ok(rigidWorst > 0.2, "which is what the bone-parented quad cannot do");
});

test("a decal takes only what faces the projector, and nothing when it misses", () => {
  const body = tube();
  const front = projectSkinDecal(body, { origin: { x: 0, y: 1, z: 0.2 }, normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, half: { x: 0.3, y: 0.3, z: 0.6 } })!;
  for (let v = 0; v < front.vertices; v += 1) assert.ok(front.position[v * 3 + 2] > -1e-6, "the far side of the limb takes no mark");
  assert.equal(projectSkinDecal(body, { origin: { x: 3, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, half: { x: 0.1, y: 0.1, z: 0.1 } }), null);
  assert.ok(projectSkinDecal(body, { origin: { x: 0, y: 1, z: 0.2 }, normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 }, half: { x: 0.5, y: 1, z: 0.6 } }, 8)!.vertices <= 24, "bounded");
  // A droplet flying back at the body: it marks the first surface it meets, on the near side.
  body.pose(0.6);
  const hit = raycastPosed(body, { x: 0, y: 0.4, z: 2 }, { x: 0, y: 0, z: -1 }, 5)!;
  assert.ok(Math.abs(hit.point.z - 0.2) < 0.02 && hit.normal.z > 0.8 && Math.abs(hit.distance - (2 - hit.point.z)) < 1e-9);
  assert.equal(raycastPosed(body, { x: 0, y: 0.4, z: 2 }, { x: 0, y: 0, z: 1 }, 5), null);
  assert.equal(raycastPosed(body, { x: 0, y: 0.4, z: 2 }, { x: 0, y: 0, z: -1 }, 1), null, "out of reach");
  const m = new Float64Array(16), back = new Float64Array(16);
  assert.ok(invert4([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1], m) && invert4(m, back));
  assert.deepEqual([...back].map(value => Math.round(value * 1e9) / 1e9), [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
  assert.equal(invert4(new Array(16).fill(0), m), false);
});

test("presets share nothing mutable", () => {
  const quality: QualityPreset = "high";
  goreBudget(quality, "full").droplets = 9999;
  assert.ok(goreBudget(quality, "full").droplets < 100);
});

test("an impact that follows others in the same move keeps their blood; a fresh playing of the move clears it", () => {
  const sink = new Recorder(), ledger = new GoreLedger(sink);
  const wound = (n: number, follows?: boolean) => strike({ ply: 5, impactId: impactIdOf(5, `rite-${n}`), seed: goreSeed(FIGHT, `rite-${n}`), ...(follows === undefined ? {} : { follows }) });
  ledger.begin(strike());                                     // an earlier capture, ply 3
  ledger.begin(wound(0)); ledger.begin(wound(1, true)); ledger.begin(wound(2, true));
  assert.deepEqual(ledger.plans.map(plan => plan.impactId), ["3:kill", "5:rite-0", "5:rite-1", "5:rite-2"], "a summon's three wounds all keep their blood");
  assert.equal(sink.of("remove").length, 0, "nothing was taken off");
  // The move played again (Undo, then the same capture): its first impact clears the old playing of it.
  ledger.begin(wound(0));
  assert.deepEqual(ledger.plans.map(plan => plan.impactId), ["3:kill", "5:rite-0"]);
  assert.deepEqual(sink.of("remove").map(item => item.impact).sort(), ["5:rite-0", "5:rite-1", "5:rite-2"]);
  // Following never keeps a later ply's blood.
  ledger.begin(strike({ ply: 7, impactId: impactIdOf(7, "kill"), seed: goreSeed(FIGHT, "seven") }));
  ledger.begin(wound(1, true));
  assert.deepEqual(ledger.plans.map(plan => plan.ply), [3, 5, 5], "ply 7 went with the replay of ply 5");
});
