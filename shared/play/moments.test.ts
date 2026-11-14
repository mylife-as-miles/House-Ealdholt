import assert from "node:assert/strict";
import test from "node:test";
import type { ArmySkinId } from "../../web/src/assets/generated";
import type { PieceKind } from "../../web/src/core/types";
import {
  DEFEAT,
  DREAD,
  GENTLE_BLOW,
  KINGDOM_ACCENT,
  MONO_EDGE,
  SIDE_HUE,
  SPELL_DARK,
  SUMMON_DARK,
  blowAccent,
  hexHue,
  blowAt,
  blowStrength,
  blowTimeScale,
  gradeIsNeutral,
  hueDistance,
  neutralGrade,
  planBlow,
  sweepFront,
  type BlowKill,
  type MomentGrade,
} from "../../web/src/scene/moments/momentPlan";
import { MomentDirector, type MomentEvent, type MomentScreen } from "../../web/src/scene/moments/MomentDirector";
import { MOMENT_GLSL, MOMENT_OVERLAY, momentPassShader, momentUniforms, overlayFor, writeMomentUniforms } from "../../web/src/scene/moments/momentShader";
import { readFileSync } from "node:fs";
import { SPELL_LOOK } from "../../web/src/scene/spellLook";

const ARMIES: ArmySkinId[] = ["ivory", "sun", "empire", "kwind"];
const KINDS: PieceKind[] = ["p", "n", "b", "r", "q"];
const kill = (over: Partial<BlowKill> = {}): BlowKill => ({ attacker: "p", victim: "p", style: "melee", attackerArmy: "sun", victimArmy: "ivory", ...over });
/** The contact point dead centre of the frame, in front of the camera. */
const centre = (): MomentScreen => ({ x: 0.5, y: 0.5, behind: false });
/** Runs a director at `fps` for `seconds`, calling `each` with the real time after each frame's advance. */
function run(director: MomentDirector, seconds: number, fps: number, each?: (t: number, scale: number, grade: MomentGrade) => void): void {
  const step = 1 / fps;
  for (let t = step; t <= seconds + 1e-9; t += step) {
    const scale = director.advance(step);
    const grade = director.compose(centre, 16 / 9);
    each?.(t, scale, grade);
  }
}

test("a blow's weight follows the kill: a Pawn's death lightest, a Queen's or a summon's heaviest, a mate the most", () => {
  const pawn = blowStrength({ attacker: "p", victim: "p", style: "melee" });
  const knight = blowStrength({ attacker: "p", victim: "n", style: "melee" });
  const rook = blowStrength({ attacker: "p", victim: "r", style: "melee" });
  const queen = blowStrength({ attacker: "p", victim: "q", style: "melee" });
  const summon = blowStrength({ attacker: "q", victim: "n", style: "summon" });
  assert.ok(pawn < knight && knight < rook && rook < queen, `${pawn} < ${knight} < ${rook} < ${queen}`);
  assert.equal(summon, 1, "a summon is the heaviest blow there is");
  assert.equal(blowStrength({ attacker: "p", victim: "p", style: "melee", mate: true }), 1);
  assert.equal(blowStrength({ attacker: "p", victim: "p", style: "melee", last: true }), 1);
  // A Queen's own kill and a spell weigh a little more than the same death by steel.
  assert.ok(blowStrength({ attacker: "q", victim: "b", style: "spell" }) > blowStrength({ attacker: "b", victim: "b", style: "melee" }));
  for (const attacker of KINDS) for (const victim of KINDS) for (const style of ["melee", "gun", "spell", "summon"] as const) {
    const s = blowStrength({ attacker, victim, style });
    assert.ok(s >= 0.3 && s <= 1, `${attacker}x${victim} ${style}: ${s}`);
  }
});

test("the hit-stop: 70 to 120 ms where the fight's clock all but stops, then exactly full speed again", () => {
  const light = planBlow(kill()), heavy = planBlow(kill({ attacker: "q", victim: "r", style: "summon" }));
  assert.ok(Math.abs(light.hold - 0.07) < 1e-9, `a Pawn's death holds ${light.hold}`);
  assert.ok(Math.abs(heavy.hold - 0.12) < 1e-9, `a summon's holds ${heavy.hold}`);
  for (const plan of [light, heavy]) {
    assert.ok(plan.crawl > 0 && plan.crawl <= 0.1, "it all but stops, never quite");
    assert.equal(blowTimeScale(plan, plan.hold / 2), plan.crawl);
    assert.equal(blowTimeScale(plan, plan.hold + plan.release), 1);
    assert.equal(blowTimeScale(plan, plan.seconds + 1), 1);
    // Back to full speed without a jump: the release is eased.
    let last = plan.crawl;
    for (let t = plan.hold; t <= plan.hold + plan.release; t += 1 / 480) {
      const scale = blowTimeScale(plan, t);
      assert.ok(scale >= last - 1e-12 && scale - last < 0.08, `eased at ${t.toFixed(4)}: ${last} to ${scale}`);
      last = scale;
    }
    // The scene loses only a beat: the hold's crawl is a tenth of real time at most.
    let scene = 0;
    for (let t = 0; t < plan.hold + plan.release; t += 1 / 1000) scene += blowTimeScale(plan, t) / 1000;
    assert.ok(scene < plan.hold * 0.12 + plan.release, `${scene.toFixed(4)} scene seconds pass in it`);
  }
});

test("black and white for 0.15 to 0.3 s, swept out from the contact point and eased back, never cut on a hard frame", () => {
  for (const victim of KINDS) for (const style of ["melee", "spell", "summon"] as const) {
    const plan = planBlow(kill({ victim, style, attacker: style === "summon" ? "q" : "p" }));
    const span = plan.monoIn + plan.monoHold + plan.monoOut;
    assert.ok(span >= 0.15 - 1e-9 && span <= 0.3 + 1e-9, `${victim} by ${style}: ${span.toFixed(3)} s`);
    assert.ok(plan.mono >= 0.9 && plan.mono <= 1);
    // At 30 frames a second the sweep takes at least two drawn frames to cover the frame, and colour returns over two or more.
    const first = blowAt(plan, 1 / 30);
    assert.ok(first.sweep > 0.2 && first.sweep < 1, `one frame in, the sweep is ${first.sweep.toFixed(2)} of the way out`);
    // Sampled as a 30 fps take samples it (the frame after the hold ends falls anywhere in the first 1/30 s of the return).
    assert.ok(plan.monoOut >= 0.1 - 1e-9, `colour returns over ${plan.monoOut} s`);
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      const back = [0, 1, 2, 3, 4].map((n) => blowAt(plan, plan.monoIn + plan.monoHold + (n + phase) / 30).mono).filter((m) => m > 0.02 && m < plan.mono - 0.02);
      assert.ok(back.length >= 2, `${victim} by ${style}: ${back.length} frames between black and white and colour`);
    }
    // ...and it is gone exactly.
    assert.equal(blowAt(plan, span).mono, 0);
    assert.equal(blowAt(plan, plan.seconds).mono, 0);
  }
});

test("everything a blow changes is exactly at rest from the end of its moment on", () => {
  const plan = planBlow(kill({ victim: "q" }));
  const end = blowAt(plan, plan.seconds), after = blowAt(plan, plan.seconds + 5), before = blowAt(plan, -0.01);
  for (const frame of [end, after, before]) {
    assert.deepEqual(frame, { timeScale: 1, mono: 0, sweep: 0, waveRadius: 0, waveAmplitude: 0, waveWidth: 0, aberration: 0, punch: 0, vignette: 0 });
  }
  // The ripple runs out from the contact point and fades as it goes; the fringe and the kick are brief.
  const early = blowAt(plan, 0.05), late = blowAt(plan, plan.waveSeconds * 0.8);
  assert.ok(late.waveRadius > early.waveRadius && late.waveAmplitude < early.waveAmplitude);
  assert.ok(plan.aberrationSeconds <= 0.25 && plan.aberration <= 0.006, "a brief, subtle fringe");
  assert.ok(blowAt(plan, plan.punchIn).punch === plan.punch && plan.punch <= 4, "a small kick of the lens");
});

test("the colour kept is the attacker's kingdom's, and the victim's colours always fall outside it", () => {
  for (const attacker of ARMIES) for (const victim of ARMIES) for (const side of ["w", "b"] as const) {
    if (attacker === victim) continue;
    const accent = blowAccent(attacker, victim, side), own = KINGDOM_ACCENT[attacker];
    const name = `${attacker} over ${victim} playing ${side === "w" ? "White" : "Black"}`;
    // The victim's kingdom and the ring and rim its side wears are both outside the band.
    assert.ok(hueDistance(KINGDOM_ACCENT[victim].hue, accent.hue) > accent.width + 1e-9, `${name}: its kingdom`);
    assert.ok(hueDistance(SIDE_HUE[side], accent.hue) > accent.width + 1e-9, `${name}: its side's ring`);
    // The band stays in the attacker's own palette, and usable.
    const moved = ((accent.hue - own.hue + 1.5) % 1) - 0.5;
    assert.ok(moved >= own.shift[0] - 1e-9 && moved <= own.shift[1] + 1e-9, `${name}: moved ${(moved * 360).toFixed(1)} degrees`);
    assert.ok(accent.width >= 9 / 360, `${name} keeps a band of ${(accent.width * 360).toFixed(1)} degrees`);
    const plan = planBlow(kill({ attackerArmy: attacker, victimArmy: victim, victimSide: side }));
    assert.equal(plan.accentHue, accent.hue);
  }
  // The usual armies (Aethelgard White, Solforiz Black) keep their own colours whole, centred on their kingdoms.
  assert.deepEqual(blowAccent("sun", "ivory", "w"), { hue: KINGDOM_ACCENT.sun.hue, width: KINGDOM_ACCENT.sun.width });
  assert.deepEqual(blowAccent("ivory", "sun", "b"), { hue: KINGDOM_ACCENT.ivory.hue, width: KINGDOM_ACCENT.ivory.width });
  // Solforiz keeps its gold-to-red fire; Aethelgard its cyan witchfire and blue.
  assert.ok(hueDistance(KINGDOM_ACCENT.sun.hue, 40 / 360) < KINGDOM_ACCENT.sun.width);
  assert.ok(hueDistance(KINGDOM_ACCENT.ivory.hue, 193 / 360) < KINGDOM_ACCENT.ivory.width && hueDistance(KINGDOM_ACCENT.ivory.hue, 216 / 360) < KINGDOM_ACCENT.ivory.width);
  // Solforiz playing White over Black's red rings keeps its gold, not the red.
  const gold = blowAccent("sun", "ivory", "b");
  assert.ok(gold.hue > KINGDOM_ACCENT.sun.hue && hueDistance(gold.hue, 40 / 360) < gold.width);
  assert.equal(hueDistance(0.95, 0.05).toFixed(6), (0.1).toFixed(6));
});

test("a spell keeps its own colours through the black and white too: the sun's gold core with its red flame", () => {
  // How much of a hue the shader keeps (MOMENT_GLSL moNear): whole within a third of the half-width, none past it.
  const near = (hue: number, accent: { hue: number; width: number }) => {
    const t = Math.min(1, Math.max(0, (hueDistance(hue, accent.hue) - accent.width * 0.35) / (accent.width * 0.65)));
    return 1 - t * t * (3 - 2 * t);
  };
  const paletteOf = (army: ArmySkinId) => { const look = SPELL_LOOK[army]; return [look.core, look.flame, look.ember, look.light]; };
  const gold = hexHue(SPELL_LOOK.sun.core).hue, red = hexHue(SPELL_LOOK.sun.flame).hue;
  // Before: the kingdom's band alone lets the gold core go grey.
  assert.ok(near(gold, blowAccent("sun", "ivory", "w")) < 0.3, "the band alone loses the gold");
  const sun = blowAccent("sun", "ivory", "w", paletteOf("sun"));
  assert.ok(near(gold, sun) > 0.8 && near(red, sun) > 0.8, `gold ${near(gold, sun).toFixed(2)}, red ${near(red, sun).toFixed(2)}`);
  // Through the plan, for a spell kill with its palette.
  const plan = planBlow(kill({ style: "spell", attackerArmy: "sun", victimArmy: "ivory", victimSide: "w", palette: paletteOf("sun") }));
  assert.deepEqual([plan.accentHue, plan.accentWidth], [sun.hue, sun.width]);
  // Whatever the armies and sides, a palette never lets the victim's colours in, and never narrows the band past use.
  for (const attacker of ARMIES) for (const victim of ARMIES) for (const side of ["w", "b"] as const) {
    if (attacker === victim) continue;
    const accent = blowAccent(attacker, victim, side, paletteOf(attacker)), name = `${attacker} over ${victim} playing ${side}`;
    assert.ok(hueDistance(KINGDOM_ACCENT[victim].hue, accent.hue) > accent.width + 1e-9, `${name}: its kingdom`);
    assert.ok(hueDistance(SIDE_HUE[side], accent.hue) > accent.width + 1e-9, `${name}: its side's ring`);
    assert.ok(accent.width >= 9 / 360 && accent.width <= KINGDOM_ACCENT[attacker].width + 8 / 360 + 1e-9, `${name}: ${(accent.width * 360).toFixed(1)} degrees`);
  }
  // Pale colours have no hue to keep and leave the band where it was.
  assert.deepEqual(blowAccent("ivory", "sun", "b", [0xf2feff]), blowAccent("ivory", "sun", "b"));
});

test("Reduced Motion: no hit-stop, ripple, fringe or kick, only a gentle grade that eases in and out", () => {
  const plan = planBlow(kill({ gentle: true, victim: "q" }));
  for (let t = 0; t < plan.seconds + 0.1; t += 1 / 60) {
    const frame = blowAt(plan, t);
    assert.equal(frame.timeScale, 1);
    assert.equal(frame.waveAmplitude, 0);
    assert.equal(frame.aberration, 0);
    assert.equal(frame.punch, 0);
    assert.ok(frame.mono <= GENTLE_BLOW.mono + 1e-9);
  }
  assert.ok(plan.monoIn >= 0.25 && plan.monoOut >= 0.5, "eased, not struck");
  const director = new MomentDirector();
  director.setFlags({ reducedMotion: true });
  director.blow(kill({ victim: "q" }), { x: 0, y: 1, z: 0 });
  let peak = 0;
  run(director, 1.2, 60, (_, scale, grade) => {
    assert.equal(scale, 1);
    assert.equal(director.lensKick(), 0);
    assert.equal(grade.waveAmplitude, 0);
    assert.equal(grade.aberration, 0);
    peak = Math.max(peak, grade.mono);
  });
  assert.ok(peak > 0.3 && peak <= GENTLE_BLOW.mono + 1e-9, `the gentle grade peaks at ${peak}`);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
});

test("the director: the hit-stop on the first frames, the moment's events, and the frame neutral again after", () => {
  const director = new MomentDirector();
  const events: MomentEvent["type"][] = [];
  director.onMoment((event) => events.push(event.type));
  const plan = director.blow(kill({ victim: "r" }), { x: 1, y: 0.6, z: -1 })!;
  assert.ok(plan);
  assert.equal(events[0], "blow");
  const scales: number[] = [];
  let sawMono = false, sawWave = false, sawKick = false;
  run(director, plan.seconds + 0.2, 60, (t, scale, grade) => {
    scales.push(scale);
    if (grade.mono > 0) sawMono = true;
    if (grade.waveAmplitude > 0) sawWave = true;
    if (director.lensKick() > 0) sawKick = true;
    if (t > plan.seconds + 1e-6) { assert.ok(gradeIsNeutral(grade), `neutral at ${t.toFixed(3)}`); assert.equal(grade.on, false); }
  });
  assert.equal(scales[0], plan.crawl, "the first frame after the blow is held");
  assert.ok(scales.filter((s) => s < 1).length >= 5, "held for several frames at 60 fps");
  assert.ok(sawMono && sawWave && sawKick);
  assert.deepEqual(events, ["blow", "blow-end"]);
  assert.equal(director.timeScale, 1);
  assert.equal(director.signals.blow, null);
});

test("the ripple and the sweep centre on the contact point as the camera sees it", () => {
  const director = new MomentDirector();
  director.blow(kill(), { x: 0, y: 0, z: 0 });
  director.advance(1 / 60);
  const grade = director.compose(() => ({ x: 0.31, y: 0.62, behind: false }), 16 / 9);
  assert.equal(grade.centreX, 0.31);
  assert.equal(grade.centreY, 0.62);
  assert.ok(grade.waveAmplitude > 0 && grade.aberration > 0);
  // Behind the camera, nothing is centred on it: no ripple or fringe, the frame still struck black and white.
  const behind = director.compose(() => ({ x: 0.31, y: 0.62, behind: true }), 16 / 9);
  assert.equal(behind.centreX, 0.5);
  assert.equal(behind.waveAmplitude, 0);
  assert.equal(behind.aberration, 0);
  assert.ok(behind.mono > 0);
  // The sweep's front at the end of its run is past the frame's furthest corner, soft edge and all.
  for (const [x, y] of [[0.5, 0.5], [0, 0], [1, 1], [0.2, 0.9]]) {
    const corner = Math.hypot(Math.max(x, 1 - x) * (16 / 9), Math.max(y, 1 - y));
    assert.ok(sweepFront(1, x, y, 16 / 9) - MONO_EDGE > corner, `from ${x},${y}`);
    assert.equal(sweepFront(0, x, y, 16 / 9), 0);
  }
});

test("a skipped fight: the hit-stop and kick stop at once, colour comes straight back", () => {
  const director = new MomentDirector();
  director.blow(kill({ victim: "q" }), { x: 0, y: 1, z: 0 });
  run(director, 0.05, 60);
  assert.ok(director.holding);
  director.hurry();
  assert.equal(director.lensKick(), 0);
  assert.equal(director.advance(1 / 60), 1);
  let last = director.compose(centre, 16 / 9).mono;
  assert.ok(last > 0, "colour eases back rather than cut");
  run(director, 0.2, 60, (_, scale, grade) => {
    assert.equal(scale, 1);
    assert.ok(grade.mono <= last + 1e-12);
    assert.equal(grade.waveAmplitude, 0);
    last = grade.mono;
  });
  assert.equal(last, 0);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
});

test("a spell's darkness: down as it gathers, held past its blow, lifted to exactly the hall's own light", () => {
  const director = new MomentDirector();
  director.darken(true);
  let peak = 0;
  run(director, SPELL_DARK.in, 60, (_, __, grade) => { peak = Math.max(peak, grade.darkness); });
  assert.ok(Math.abs(peak - SPELL_DARK.press) < 1e-9, `full darkness ${peak}`);
  assert.ok(director.compose(centre, 16 / 9).desaturation > 0.4 && director.compose(centre, 16 / 9).vignette > 0.4);
  director.struck();
  run(director, SPELL_DARK.linger - 0.05, 60, (_, __, grade) => assert.ok(Math.abs(grade.darkness - SPELL_DARK.press) < 1e-9, "it lingers"));
  let last: number = SPELL_DARK.press, steps = 0;
  run(director, SPELL_DARK.out + 0.2, 60, (_, __, grade) => {
    assert.ok(grade.darkness <= last + 1e-12);
    // Lifted over most of a second: no quick brightening.
    assert.ok(last - grade.darkness < 0.05, `no jump: ${last} to ${grade.darkness}`);
    if (grade.darkness > 0 && grade.darkness < SPELL_DARK.press) steps += 1;
    last = grade.darkness;
  });
  assert.ok(steps >= 40, `lifted over ${steps} frames`);
  const grade = director.compose(centre, 16 / 9);
  assert.equal(grade.darkness, 0);
  assert.equal(grade.light, 1);
  assert.ok(gradeIsNeutral(grade) && !grade.on);
  // A spell that ends some other way lifts its darkness all the same.
  director.darken(true);
  run(director, 0.3, 60);
  director.darken(false);
  run(director, SPELL_DARK.out + 0.1, 60);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
});

test("a summon's darkness is lighter than a spell's, as it holds for the whole rite; the struck frame eases over it", () => {
  const director = new MomentDirector();
  director.darken(true, true);
  run(director, SPELL_DARK.in + 0.1, 60);
  const summon = director.compose(centre, 16 / 9);
  assert.ok(Math.abs(summon.darkness - SUMMON_DARK.press) < 1e-9 && Math.abs(summon.far - SUMMON_DARK.far) < 1e-9, `${summon.darkness} ${summon.far}`);
  assert.ok(SUMMON_DARK.press < SPELL_DARK.press - 0.15 && SUMMON_DARK.far < SPELL_DARK.far, "the board stays readable round the creature");
  director.darken(false);
  run(director, SPELL_DARK.out + 0.1, 60);
  // A spell after it is a spell's again.
  director.darken(true);
  run(director, SPELL_DARK.in + 0.1, 60);
  assert.ok(Math.abs(director.compose(centre, 16 / 9).darkness - SPELL_DARK.press) < 1e-9);
  // The blow's crush eases with the darkness under it, so the two together do not leave the frame black.
  assert.ok(MOMENT_GLSL.includes("smoothstep(0.02, 0.62 - 0.34 * uMoTone.x, y)"));
});

test("the dread of a check: faint, eased in and out, and a signal for the music", () => {
  const director = new MomentDirector();
  const heard: (string | null)[] = [];
  director.onMoment((event) => { if (event.type === "dread") heard.push(event.side); });
  director.setCheck("b");
  run(director, DREAD.in + 0.1, 60);
  const grade = director.compose(centre, 16 / 9);
  assert.ok(Math.abs(grade.desaturation - DREAD.desaturation) < 1e-9 && Math.abs(grade.vignette - DREAD.vignette) < 1e-9);
  assert.ok(DREAD.desaturation <= 0.25 && DREAD.vignette <= 0.35, "faint");
  assert.equal(grade.darkness, 0);
  assert.deepEqual(director.signals.dread, { side: "b", level: 1 });
  director.setCheck("b");
  director.setCheck(null);
  run(director, DREAD.out + 0.1, 60);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
  assert.deepEqual(heard, ["b", null]);
  // On the map the signal still follows the game; only the grade is left out. The menu's board has neither.
  director.setFlags({ tactical: true });
  director.setCheck("w");
  run(director, DREAD.in + 0.1, 60);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
  assert.equal(director.signals.dread.side, "w");
  director.setFlags({ tactical: false, menuBoard: true });
  assert.equal(director.signals.dread.side, null);
});

test("the defeat grade drains the losing kingdom's colour and the light, and goes again when asked", () => {
  const director = new MomentDirector();
  director.setDefeat({ side: "b", army: "sun" }, "ivory", 1, 1);
  run(director, 1.1, 60);
  const grade = director.compose(centre, 16 / 9);
  assert.equal(grade.drain, 1);
  assert.equal(grade.drainHue, KINGDOM_ACCENT.sun.hue);
  assert.equal(grade.spareHue, KINGDOM_ACCENT.ivory.hue);
  assert.ok(Math.abs(grade.light - (1 - DEFEAT.light)) < 1e-9);
  assert.ok(grade.vignette >= DEFEAT.vignette - 1e-9);
  assert.deepEqual(director.signals.defeat, { side: "b", amount: 1 });
  // Half way, then away.
  director.setDefeat({ side: "b", army: "sun" }, "ivory", 0.5, 0.5);
  run(director, 0.6, 60);
  assert.ok(Math.abs(director.compose(centre, 16 / 9).drain - 0.5) < 1e-9);
  director.setDefeat(null, null, 0, 0.4);
  run(director, 0.5, 60);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
  // At once, with no easing.
  director.setDefeat({ side: "w", army: "kwind" }, "empire", 0.8, 0);
  director.advance(1 / 60);
  assert.ok(Math.abs(director.compose(centre, 16 / 9).drain - 0.8 * 0.8 * (3 - 2 * 0.8)) < 1e-9);
});

test("Undo, a new game or a rebuild leaves nothing behind; Skip ending settles everything quickly", () => {
  const director = new MomentDirector();
  const busy = () => {
    director.blow(kill({ victim: "q" }), { x: 0, y: 1, z: 0 });
    director.darken(true);
    director.setCheck("w");
    director.setDefeat({ side: "w", army: "ivory" }, "sun", 1, 0.2);
    run(director, 0.06, 60);
  };
  busy();
  assert.ok(director.holding && director.compose(centre, 16 / 9).on);
  director.reset();
  assert.equal(director.timeScale, 1);
  assert.equal(director.advance(1 / 60), 1);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)), "neutral on the very next frame");
  assert.equal(director.lensKick(), 0);
  assert.deepEqual(director.signals.dread, { side: null, level: 0 });
  busy();
  director.settle();
  run(director, 0.35, 60, (_, scale) => assert.equal(scale, 1));
  const settled = director.compose(centre, 16 / 9);
  // The check is the game's: settling takes the blow, the darkness and the defeat away.
  assert.equal(settled.mono, 0);
  assert.equal(settled.darkness, 0);
  assert.equal(settled.drain, 0);
  assert.equal(settled.light, 1);
});

test("the map and the menu's board get none of it, even mid-blow", () => {
  const director = new MomentDirector();
  director.setFlags({ menuBoard: true });
  assert.equal(director.blow(kill(), { x: 0, y: 0, z: 0 }), null);
  director.darken(true);
  run(director, 1, 60, (_, scale, grade) => { assert.equal(scale, 1); assert.ok(gradeIsNeutral(grade)); });
  director.setFlags({ menuBoard: false });
  director.blow(kill(), { x: 0, y: 0, z: 0 });
  run(director, 0.03, 60);
  assert.ok(director.holding);
  director.setFlags({ tactical: true });
  assert.equal(director.advance(1 / 60), 1);
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)));
});

test("the same game plays the same moments: no chance anywhere", () => {
  const play = () => {
    const director = new MomentDirector();
    const frames: string[] = [];
    director.blow(kill({ attacker: "q", victim: "n", style: "summon", attackerArmy: "kwind", victimArmy: "empire" }), { x: 0.4, y: 0.7, z: -0.4 });
    director.darken(true);
    run(director, 1, 60, (_, scale, grade) => frames.push(JSON.stringify({ scale, kick: director.lensKick(), ...grade })));
    return frames;
  };
  assert.deepEqual(play(), play());
});

test("nothing brightens the frame quickly: only a blow's return to colour is quick, and it is once per blow", () => {
  // The quantities that darken the frame, and how fast each may fall (a fall is the frame getting lighter).
  const director = new MomentDirector();
  director.darken(true);
  run(director, 0.7, 60);
  director.blow(kill({ victim: "q", style: "spell" }), { x: 0, y: 1, z: 0 });
  director.struck();
  let previous: MomentGrade | null = null, quickRises = 0, rising = false;
  run(director, 3, 60, (_, __, grade) => {
    if (previous) {
      // The darkness, the vignette and the drained light ease back over half a second or more.
      assert.ok(previous.darkness - grade.darkness < 1 / 60 / 0.5 + 1e-9, "the darkness lifts slowly");
      const quick = previous.mono - grade.mono > 0.04;
      if (quick && !rising) quickRises += 1;
      rising = quick;
    }
    previous = { ...grade };
  });
  assert.equal(quickRises, 1, "one quick return to colour");
  // The black and white never lifts a highlight: its curve only crushes (MOMENT_GLSL `ink = y * smoothstep(0.02, 0.62, y)`).
  for (let y = 0; y <= 1; y += 0.01) assert.ok(y * smoothstepGlsl(0.02, 0.62, y) <= y + 1e-12);
});

test("the shader's uniforms: neutral is off, the fringe can be left out, the Low overlay only darkens", () => {
  const uniforms = momentUniforms();
  assert.equal(writeMomentUniforms(uniforms, neutralGrade()), false);
  assert.equal(uniforms.uMoOn.value, 0);
  const director = new MomentDirector();
  director.blow(kill({ victim: "q" }), { x: 0, y: 0, z: 0 });
  director.advance(1 / 60);
  const grade = director.compose(centre, 2);
  assert.equal(writeMomentUniforms(uniforms, grade, { aberration: false }), true);
  assert.equal(uniforms.uMoOn.value, 1);
  assert.equal(uniforms.uMoWave.value[3], 0);
  assert.equal(uniforms.uMoCentre.value[2], 2);
  writeMomentUniforms(uniforms, grade);
  assert.ok(uniforms.uMoWave.value[3] > 0);
  const overlay = overlayFor(grade);
  assert.ok(overlay.dark > 0 && overlay.dark < 0.9 && overlay.vignette > 0);
  assert.deepEqual(overlayFor(neutralGrade()), { dark: 0, vignette: 0 });
});

function smoothstepGlsl(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

test("the GLSL declares exactly the uniforms the pipelines are handed, and both pipelines carry it", () => {
  const declared = [...MOMENT_GLSL.matchAll(/uniform\s+(?:float|vec4)\s+([^;]+);/g)].flatMap((m) => m[1].split(",").map((name) => name.trim())).sort();
  assert.deepEqual(declared, Object.keys(momentUniforms()).sort());
  const pass = momentPassShader();
  assert.deepEqual(Object.keys(pass.uniforms).sort(), ["tDiffuse", ...Object.keys(momentUniforms())].sort());
  for (const stage of ["moWarp(", "moFetch(", "moDisplayLight(", "moGrade("]) assert.ok(pass.fragmentShader.includes(stage), stage);
  assert.ok(MOMENT_OVERLAY.fragmentShader.includes("uDark") && MOMENT_OVERLAY.fragmentShader.includes("uVignette"));
  // The look's grade pass reads the scene through the warp and the fringe, darkens the scene's light before its
  // exposure and grades the shown frame before its dither, all behind uMoOn.
  const look = readFileSync(new URL("../../main game/src/play/battlefield-look.ts", import.meta.url), "utf8");
  for (const use of ["${MOMENT_GLSL}", "...momentUniforms()", "uv = moWarp(uv); c = moFetch(tScene, uv);", "if (uMoOn > 0.5) c = moScene(c, z);", "if (uMoOn > 0.5) disp = moGrade(disp, vUv);", "setMoment"]) {
    assert.ok(look.includes(use), `the look: ${use}`);
  }
  assert.ok(look.indexOf("disp = moGrade(disp, vUv)") < look.indexOf("disp += (fract(sin("), "graded before the dither");
  assert.ok(look.indexOf("c = moScene(c, z)") < look.indexOf("c *= uExposure;"), "the scene's light before the exposure");
  // The arena's own shimmer bends the read first and the moment's ripple rides on it; its own last touches come before the
  // moment's darkness, which has the last say on the scene's light.
  assert.ok(look.indexOf('${hooked("warp")}') < look.indexOf("uv = moWarp(uv)"), "the ripple on the shimmer");
  assert.ok(look.indexOf('${hooked("final")}') < look.indexOf("c = moScene(c, z)"), "the darkness after the arena's final touches");
});

test("a replay: at its own speed the same moments, at twice the speed twice as fast, and held still never left struck", () => {
  const frames = (scale: number, seconds: number) => {
    const director = new MomentDirector(), out: string[] = [];
    director.blow(kill({ victim: "r" }), { x: 0, y: 1, z: 0 });
    for (let t = 0; t < seconds; t += 1 / 60) {
      const timeScale = director.advance(scale / 60, 1 / 60);
      out.push(JSON.stringify({ timeScale, kick: director.lensKick(), ...director.compose(centre, 16 / 9) }));
    }
    return out;
  };
  // A match feeds the player's delta as both: a replay at 1x is the very same frames.
  const live = new MomentDirector(), match: string[] = [];
  live.blow(kill({ victim: "r" }), { x: 0, y: 1, z: 0 });
  for (let t = 0; t < 0.8; t += 1 / 60) { const timeScale = live.advance(1 / 60); match.push(JSON.stringify({ timeScale, kick: live.lensKick(), ...live.compose(centre, 16 / 9) })); }
  assert.deepEqual(frames(1, 0.8), match);
  // At 2x the moment is over in half the frames.
  const fast = frames(2, 0.8).findIndex((f) => !JSON.parse(f).on), slow = frames(1, 0.8).findIndex((f) => !JSON.parse(f).on);
  assert.ok(Math.abs(fast - slow / 2) <= 1, `over after ${fast} frames at 2x, ${slow} at 1x`);
  // Held still mid-blow: the hit-stop lets go, and the black and white eases out on the player's clock.
  const director = new MomentDirector();
  director.blow(kill({ victim: "q" }), { x: 0, y: 1, z: 0 });
  for (let i = 0; i < 4; i += 1) director.advance(1 / 60, 1 / 60);
  assert.ok(director.holding && director.compose(centre, 16 / 9).mono > 0.5);
  let last = 1;
  for (let i = 0; i < 30; i += 1) {
    assert.equal(director.advance(0, 1 / 60), 1, "no hit-stop while held");
    assert.equal(director.lensKick(), 0);
    const grade = director.compose(centre, 16 / 9);
    assert.equal(grade.waveAmplitude, 0);
    assert.ok(grade.mono <= last + 1e-12);
    last = grade.mono;
  }
  assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)), "not left struck while held");
  // A spell's darkness holds with the scene it belongs to, and goes on when the replay does.
  const dark = new MomentDirector();
  dark.darken(true);
  for (let i = 0; i < 18; i += 1) dark.advance(1 / 60, 1 / 60);
  const held = dark.compose(centre, 16 / 9).darkness;
  for (let i = 0; i < 30; i += 1) dark.advance(0, 1 / 60);
  assert.equal(dark.compose(centre, 16 / 9).darkness, held);
});

test("a replay paused on the very frame a blow lands: nothing shows while held, and the blow plays whole after", () => {
  const director = new MomentDirector();
  director.blow(kill({ victim: "r" }), { x: 0, y: 1, z: 0 });
  for (let i = 0; i < 20; i += 1) {
    assert.equal(director.advance(0, 1 / 30), 1);
    assert.ok(gradeIsNeutral(director.compose(centre, 16 / 9)), "nothing on screen while held");
    assert.ok(director.active, "the blow waits");
  }
  // Going on: the first frame is the blow's first, hit-stop and all, as if never held.
  assert.ok(director.advance(1 / 30, 1 / 30) < 0.1);
  assert.ok(director.compose(centre, 16 / 9).mono > 0.5);
  for (let i = 0; i < 30; i += 1) director.advance(1 / 30, 1 / 30);
  assert.ok(!director.active && gradeIsNeutral(director.compose(centre, 16 / 9)));
});
