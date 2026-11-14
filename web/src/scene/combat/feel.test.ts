import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { blockHolds, placeLocal, reachCorrection, aimCorrection, sweepWeapon, type TargetSample, type WeaponSample } from "./sweptContact";
import { DEATH_WEIGHT, blowSide, deathTiming, directionalReaction, fallHeading, planKnockback } from "./deathWeight";
import { tuneContacts, type LocalPose, type PoseProbe } from "./contactTuning";
import { directCombat, type CombatPlan } from "./director";
import { pawnDuelInput } from "./pawnDuel";
import { CATALOG } from "./sequences";
import { DuelCameraTimeline, planDuelShot, projectToFrame, sweepBlend, type CameraPose } from "./duelCamera";
import { ContactIK } from "../contactIK";
import { LivingPieceRig } from "../livingPieceRig";
import { BoardReactionDirector } from "../boardReactionDirector";

const TILE = 1.02;
/** A spear thrust along +x: the tip runs from x = 0.2 to x = `reach` and back, at chest height. */
const thrust = (reach: number, y = 0.45, z = 0): WeaponSample[] => Array.from({ length: 13 }, (_, i) => {
  const time = i / 30, out = Math.sin(Math.PI * Math.min(1, time / 0.4) / 2), tip = 0.2 + (reach - 0.2) * out;
  return { time, grip: { x: tip - 0.6, y, z }, tip: { x: tip, y, z } };
});
const body = (x: number, shield: boolean): TargetSample[] => [{
  time: 0, torso: { base: { x, y: 0.25, z: 0 }, top: { x, y: 0.65, z: 0 }, radius: 0.08 },
  shield: shield ? { centre: { x: x - 0.2, y: 0.45, z: 0 }, normal: { x: -1, y: 0, z: 0 }, radius: 0.17 } : null,
}];

describe("swept weapon contact", () => {
  it("finds the first moment the steel touches, and what it touches", () => {
    const hit = sweepWeapon(thrust(1.1), body(1, false))!;
    expect(hit.hit).toBe(true); expect(hit.anchor).toBe("torso");
    // The tip enters the body before the clip's furthest reach (0.4 s).
    expect(hit.time).toBeLessThan(0.4); expect(hit.time).toBeGreaterThan(0.2);
    expect(hit.point.x).toBeCloseTo(0.92, 1); expect(hit.normal.x).toBeLessThan(-0.9);
    // With a shield up, the same thrust meets the shield first, square on.
    const blocked = sweepWeapon(thrust(1.1), body(1, true))!;
    expect(blocked.anchor).toBe("shield"); expect(blocked.time).toBeLessThan(hit.time);
    expect(blocked.point.x).toBeCloseTo(0.8, 2); expect(blocked.facing).toBeLessThan(5);
    expect(blockHolds(blocked)).toBe(true); expect(blockHolds(hit)).toBe(false);
  });

  it("reports how far short a blow stays, and the step that closes it", () => {
    const short = sweepWeapon(thrust(0.7), body(1, false))!;
    expect(short.hit).toBe(false); expect(short.distance).toBeCloseTo(0.22, 2); expect(short.time).toBeCloseTo(0.4, 1);
    const step = reachCorrection(thrust(0.7), body(1, false), { x: 1, z: 0 }, "torso", 0.05);
    expect(step).toBeCloseTo(0.27, 2);
    const closer = thrust(0.7).map(sample => ({ ...sample, grip: { ...sample.grip, x: sample.grip.x + step }, tip: { ...sample.tip, x: sample.tip.x + step } }));
    expect(sweepWeapon(closer, body(1, false))!.hit).toBe(true);
    // A thrust that passes beside the body is corrected sideways too.
    const wide = aimCorrection(thrust(1.1, 0.45, 0.15), body(1, false), { x: 1, z: 0 }, "torso", 0.05);
    expect(Math.abs(wide.across)).toBeCloseTo(0.15, 2);
    // A shield turned away from the blow is no block, even if the spear crosses it.
    const turned = body(1, true); turned[0].shield!.normal = { x: -0.3, y: 0, z: -0.95 };
    expect(blockHolds(sweepWeapon(thrust(1.1), turned))).toBe(false);
  });

  it("places a figure's own frame on the board facing its opponent", () => {
    const ahead = placeLocal({ x: 0, y: 0.4, z: 1 }, { x: 2, y: 0, z: 3 }, { x: 0, z: -1 });
    expect(ahead.x).toBeCloseTo(2); expect(ahead.z).toBeCloseTo(2); expect(ahead.y).toBeCloseTo(0.4);
    const diagonal = placeLocal({ x: 0, y: 0, z: Math.SQRT2 }, { x: 0, y: 0, z: 0 }, { x: 1, z: 1 });
    expect(diagonal.x).toBeCloseTo(1); expect(diagonal.z).toBeCloseTo(1);
  });
});

describe("fitting a plan's contacts to the rigs", () => {
  const plan = (id: string) => directCombat(pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "d5", "exd5"] }),
    [CATALOG.find(sequence => sequence.id === id)!]) as CombatPlan;
  /** A rig whose thrust reaches `reach` ahead of it at the clip's contact time, 0.8 s in. */
  const probe = (reach: number): PoseProbe => ({
    tile: TILE,
    clip: (_actor, _role, prefer) => prefer[0]?.startsWith("attack.") ? { id: prefer[0], duration: 1.4, events: { contact: 0.8, impact: 0.8, clash: 0.8, recovery: 1.2 } }
      : prefer[0] ? { id: prefer[0], duration: 1.2, events: { guard: 0.47, evade: 0.53 } } : null,
    pose: (_actor, _clip, times): LocalPose[] => times.map(time => {
      const out = Math.max(0, 1 - Math.abs(time - 0.8) / 0.3), tip = 0.15 + (reach - 0.15) * out;
      return { time, grip: { x: 0, y: 0.5, z: tip - 0.55 }, tip: { x: 0, y: 0.5, z: tip }, torso: { x: 0, y: 0.45, z: 0 }, shield: { x: 0, y: 0.45, z: 0.2 }, shieldNormal: { x: 0, y: 0, z: 1 } };
    }),
    place: point => { const at = point.ref === "origin" ? { x: 0.51, z: 0.51 } : point.ref === "defender" ? { x: -0.51, z: -0.51 } : { x: -0.1, z: -0.1 }; return { x: at.x + point.file * TILE, y: 0, z: at.z - point.rank * TILE }; },
  });

  it("moves the attacker's step so the blow arrives, and leaves the authored plan alone", () => {
    const authored = plan("pawn.thrust-block"), before = JSON.stringify(authored);
    const short = tuneContacts(authored, probe(0.35)), long = tuneContacts(authored, probe(0.75));
    expect(JSON.stringify(authored)).toBe(before);
    const kill = (fit: ReturnType<typeof tuneContacts>) => fit.forecasts.find(forecast => forecast.id === "kill")!;
    // A short arm steps closer, a long one stands off; both then expect the spear in the body.
    expect(kill(short).shift).toBeGreaterThan(0.05); expect(kill(long).shift).toBeLessThan(kill(short).shift);
    expect(kill(short).before!.hit).toBe(false);
    for (const fit of [long]) { expect(kill(fit).after!.hit).toBe(true); expect(kill(fit).after!.anchor).toBe("torso"); }
    // The first thrust is meant for the shield, and the forecast says whether that is a block.
    const first = long.forecasts.find(forecast => forecast.id === "first")!;
    expect(first.wanted).toBe("shield"); expect(first.after!.anchor).toBe("shield"); expect(first.blocked).toBe(true);
    expect(first.after!.point).toBeDefined(); expect(first.after!.normal).toBeDefined();
    // Shifts stay inside the choreography's own limits.
    for (const forecast of [...short.forecasts, ...long.forecasts]) expect(Math.abs(forecast.shift)).toBeLessThanOrEqual(0.24 + 1e-9);
  });

  it("leaves the attacker where an earlier blow of his was fitted from, and lets the pace the defender is knocked back give instead", () => {
    // Bash, then thrust from the same spot: the bash's range must not be spent on the thrust's.
    const authored = plan("pawn.bash-thrust"), fit = tuneContacts(authored, probe(0.5));
    const kill = fit.forecasts.find(forecast => forecast.id === "kill")!;
    expect(Math.abs(kill.shift)).toBeGreaterThan(0.01); expect(kill.moved).toBe("defender");
    expect(fit.plan.attacker.filter(cue => cue.do === "move")).toEqual(authored.attacker.filter(cue => cue.do === "move"));
    const pace = (p: CombatPlan) => { const cue = p.defender.find(item => item.do === "move")!; return cue.do === "move" ? Math.hypot(cue.to.file, cue.to.rank) : 0; };
    // A thrust that falls short is met by a defender who was not knocked quite so far.
    expect(kill.shift).toBeGreaterThan(0); expect(pace(fit.plan)).toBeLessThan(pace(authored));
    expect(kill.after!.hit).toBe(true);
  });

  it("reads the struck fighter in the clip he will be in, and waits for a weapon that is held out", () => {
    const authored = plan("pawn.bash-thrust");
    const seen: (string | null)[] = [];
    const base = probe(0.75);
    // This rig's thrust reaches full length on its contact frame and stays there.
    const holding: PoseProbe = { ...base, pose: (actor, clip, times) => { seen.push(clip); return base.pose(actor, clip, times.map(time => Math.min(time, 0.8))).map((pose, i) => ({ ...pose, time: times[i] })); } };
    const fit = tuneContacts(authored, holding), kill = fit.forecasts.find(forecast => forecast.id === "kill")!;
    // The defender is read mid-recoil, guard knocked open, not standing at attention.
    expect(kill.stance!.clip).toBe("hit.recoil"); expect(kill.stance!.time).toBeGreaterThan(0.3);
    expect(seen).toContain("hit.recoil");
    // The marker is put a moment after the steel touches, so the frame it fires on shows the spear in.
    expect(kill.lead).toBeLessThan(0);
    const thrust = fit.plan.attacker.find(cue => cue.do === "clip" && cue.clip.prefer?.[0] === "attack.thrust")!;
    expect(thrust.do === "clip" && thrust.sync!.to).toBeLessThan(authored.markers.decisive);
  });

  it("does nothing to a rig it cannot sample", () => {
    const authored = plan("pawn.bash-thrust");
    const fit = tuneContacts(authored, { ...probe(0.5), pose: () => [] });
    expect(fit.plan.attacker).toEqual(authored.attacker);
    expect(fit.forecasts.every(forecast => forecast.after === null && forecast.shift === 0)).toBe(true);
  });
});

describe("a death with weight", () => {
  const knock = (power = 1, offCentre = 0.05) => planKnockback({ blow: { x: 1, z: 1 }, power, hitToLand: 1, offCentre, tile: TILE });

  it("throws the body a short way and brings it to a stop before it is down", () => {
    const k = knock();
    expect(k.at(0)).toEqual({ x: 0, z: 0, y: 0, twist: 0, lean: 0, feetReleased: true });
    let last = 0;
    for (let t = 0; t <= k.rest; t += 1 / 60) { const d = Math.hypot(k.at(t).x, k.at(t).z); expect(d).toBeGreaterThanOrEqual(last - 1e-9); last = d; }
    expect(last).toBeCloseTo(k.travel, 6);
    expect(k.travel).toBeLessThan(0.2 * TILE); expect(k.stop).toBeLessThan(k.land);
    // Along the blow, to unit length.
    expect(k.direction.x).toBeCloseTo(Math.SQRT1_2); expect(k.direction.z).toBeCloseTo(Math.SQRT1_2);
    // Fast at first, dragged down by the floor: most of the way is covered in the first half of the slide.
    expect(Math.hypot(k.at(k.stop / 2).x, k.at(k.stop / 2).z)).toBeGreaterThan(k.travel * 0.7);
  });

  it("never travels more than the cap, whatever the blow and whatever the clip adds", () => {
    for (const power of [0.5, 1, 2]) for (const clipTravel of [0, 0.2, 2]) {
      const k = planKnockback({ blow: { x: 0, z: 1 }, power, hitToLand: 0.9, tile: TILE, clipTravel });
      expect(k.travel + Math.min(clipTravel, DEATH_WEIGHT.cap * TILE)).toBeLessThanOrEqual(DEATH_WEIGHT.cap * TILE + 1e-9);
      expect(k.travel).toBeGreaterThanOrEqual(0);
    }
  });

  it("loses its feet, buckles, twists with the off-centre part of the blow, and bounces once on landing", () => {
    const k = knock(1, 0.08);
    expect(k.at(0.08).y).toBeGreaterThan(0.015);              // off the stone
    expect(k.at(0.08).feetReleased).toBe(true); expect(k.at(k.land).feetReleased).toBe(false);
    expect(Math.min(...[0.2, 0.3, 0.4].map(t => k.at(t).y))).toBeLessThan(-0.01);   // knees giving
    expect(k.at(0.13).lean).toBeGreaterThan(0.1); expect(k.at(k.land).lean).toBe(0);
    expect(k.at(0.5).twist).toBeGreaterThan(0.15); expect(knock(1, -0.08).at(0.5).twist).toBeLessThan(-0.15);
    expect(Math.abs(knock(1, 0).at(0.5).twist)).toBeGreaterThan(0.05);              // never a dead-straight topple
    expect(k.at(k.land + 0.085).y).toBeGreaterThan(0.008);    // the bounce
    expect(k.at(k.rest).y).toBeCloseTo(0, 6);
  });

  it("never lands in an occupied square, and turns as little as it must", () => {
    const spot = { x: 0, z: 0 }, blow = { x: 0, z: -1 };
    expect(fallHeading(spot, blow, [], { reach: 0.7, tile: TILE })).toMatchObject({ turned: 0, blocked: false });
    const behind = [{ x: 0, z: -TILE }];
    const turned = fallHeading(spot, blow, behind, { reach: 0.7, tile: TILE });
    expect(turned.blocked).toBe(false); expect(Math.abs(turned.turned)).toBeGreaterThanOrEqual(30); expect(Math.abs(turned.turned)).toBeLessThanOrEqual(60);
    expect(Math.hypot(turned.x * 0.7 - behind[0].x, turned.z * 0.7 - behind[0].z)).toBeGreaterThanOrEqual(0.5 * TILE);
    // Same position, same answer: no randomness.
    expect(fallHeading(spot, blow, behind, { reach: 0.7, tile: TILE })).toEqual(turned);
    // Hemmed in on every side: it stays where it is.
    const ring = Array.from({ length: 16 }, (_, i) => ({ x: Math.cos(i * Math.PI / 8) * 0.6, z: Math.sin(i * Math.PI / 8) * 0.6 }));
    expect(fallHeading(spot, blow, ring, { reach: 0.7, tile: TILE }).blocked).toBe(true);
  });

  it("reads the side the blow comes in on, and picks the reaction from it", () => {
    const facing = { x: 0, z: 1 };
    expect(blowSide(facing, { x: 0, z: -1 }).side).toBe("front");
    expect(blowSide(facing, { x: 0, z: 1 }).side).toBe("back");
    expect(["left", "right"]).toContain(blowSide(facing, { x: 1, z: 0 }).side);
    expect(blowSide(facing, { x: 1, z: 0 }).side).not.toBe(blowSide(facing, { x: -1, z: 0 }).side);
    const authored = { hit: "hit.light", death: "death.backward" }, held = () => true;
    expect(directionalReaction("front", authored, held)).toEqual(authored);
    // The older library has only frontal reactions: from behind he pitches forward, from the flank he takes the heaviest stagger.
    const v1 = (id: string) => !["hit.back", "hit.left", "hit.right", "death.forward", "death.left", "death.right"].includes(id);
    expect(directionalReaction("back", authored, v1)).toEqual({ hit: "hit.heavy", death: "death.front" });
    expect(directionalReaction("left", { hit: "hit.light", death: "death.front" }, v1).death).toBe("death.backward");
    // combat-v2 has a reaction for every side: struck on the left he reels and goes over to his right, and the other way about.
    expect(directionalReaction("back", { hit: "hit.front", death: "death.backward" }, held)).toEqual({ hit: "hit.back", death: "death.forward" });
    expect(directionalReaction("left", { hit: "hit.front", death: "death.backward" }, held)).toEqual({ hit: "hit.left", death: "death.right" });
    expect(directionalReaction("right", { hit: "hit.front", death: "death.collapse" }, held)).toEqual({ hit: "hit.right", death: "death.left" });
    expect(directionalReaction("back", authored, () => false)).toEqual(authored);
  });

  it("times a death to the floor without hurrying the clip past a natural speed", () => {
    const backward = { duration: 1.9, events: { hit: 0.13, land: 1.6 } };
    const timing = deathTiming(backward, 1);
    expect(timing.rate).toBeGreaterThanOrEqual(1); expect(timing.rate).toBeLessThanOrEqual(1.25);
    expect(timing.from).toBeGreaterThanOrEqual(0.13); expect(timing.from).toBeLessThan(0.5);
    expect(timing.land).toBeCloseTo((1.6 - timing.from) / timing.rate, 6); expect(timing.land).toBeLessThan(1.25);
    // A clip that is on the floor early is played whole, at its own speed.
    expect(deathTiming({ duration: 2.2, events: { hit: 0.17, land: 0.75 } }, 1)).toMatchObject({ from: 0, rate: 1 });
  });
});

describe("duel camera polish", () => {
  const input = {
    attackerStart: { x: 0.51, y: 0, z: 0.51 }, standoff: { x: -0.1, y: 0, z: -0.1 }, victim: { x: -0.51, y: 0, z: -0.51 }, blow: { x: -1, z: -1 },
    attackerHeight: 0.78, victimHeight: 0.78, fov: 42, aspect: 16 / 9,
    camera: { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 } }, bounds: { floor: 0, radius: 30 }, obstacles: [],
  };

  it("frames the fight above the middle of the picture, with everything still in shot", () => {
    const flat = planDuelShot({ ...input, rise: 0 }), risen = planDuelShot(input);
    const chest = (shot: typeof flat) => projectToFrame(shot, input.aspect, { x: -0.3, y: 0.45, z: -0.3 }).y;
    expect(chest(risen)).toBeGreaterThan(chest(flat) + 0.1);
    for (const spot of [input.standoff, input.victim]) for (const y of [0, 0.78 * 1.06]) {
      const seen = projectToFrame({ ...risen, position: risen.push }, input.aspect, { x: spot.x, y, z: spot.z });
      expect(Math.abs(seen.y)).toBeLessThanOrEqual(0.9 + 1e-6); expect(Math.abs(seen.x)).toBeLessThanOrEqual(0.9 + 1e-6);
    }
    // The feet stay clear of the bottom strip the caption and the move list cover.
    expect(projectToFrame(risen, input.aspect, { x: -0.51, y: 0, z: -0.51 }).y).toBeGreaterThan(-0.75);
  });

  it("returns in an arc over the pieces, and ends on the home view exactly", () => {
    const close: CameraPose = { position: { x: 1.5, y: 1.4, z: 1 }, target: { x: -0.3, y: 0.4, z: -0.3 }, fov: 40 };
    const home: CameraPose = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 }, fov: 42 };
    expect(sweepBlend(close, home, 0)).toEqual(close); expect(sweepBlend(close, home, 1)).toEqual(home);
    for (const t of [0.15, 0.3, 0.5]) {
      const straight = close.position.y + (home.position.y - close.position.y) * t;
      expect(sweepBlend(close, home, t).position.y).toBeGreaterThan(straight + 0.3);
    }
    const timeline = new DuelCameraTimeline(home, planDuelShot(input));
    timeline.update(1); timeline.release();
    for (let i = 0; i < 80; i++) timeline.update(1 / 60);
    expect(timeline.done).toBe(true); expect(timeline.update(0)).toEqual(home);
  });

  it("hands the view straight to the far side of the board, round the fight and never through it", () => {
    const home: CameraPose = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 }, fov: 42 };
    const far: CameraPose = { position: { x: 0, y: 6.4, z: -8.6 }, target: { ...home.target }, fov: 42 };
    const timeline = new DuelCameraTimeline(home, planDuelShot(input));
    timeline.update(1); timeline.release(far);
    let nearest = Infinity, lowest = Infinity;
    for (let i = 0; i < 120 && !timeline.done; i++) {
      const pose = timeline.update(1 / 60);
      nearest = Math.min(nearest, Math.hypot(pose.position.x - pose.target.x, pose.position.z - pose.target.z)); lowest = Math.min(lowest, pose.position.y);
    }
    expect(timeline.done).toBe(true);
    expect(timeline.home).toEqual(far); expect(timeline.update(0)).toEqual(far);
    // It never dips below where it started or cuts across the middle of the board.
    expect(lowest).toBeGreaterThan(1); expect(nearest).toBeGreaterThan(1.2);
    // A snap (skip, undo) lands on the handed-over side too.
    const other = new DuelCameraTimeline(home, planDuelShot(input)); other.update(1); other.release(far); other.snap();
    expect(other.update(0)).toEqual(far);
  });
});

describe("stepping, not sliding", () => {
  function legs() {
    const root = new THREE.Group(), hips = new THREE.Bone(); hips.name = "Hips"; hips.position.y = 0.9; root.add(hips);
    const leg = (side: "Left" | "Right", x: number) => {
      const upper = new THREE.Bone(), lower = new THREE.Bone(), foot = new THREE.Bone();
      upper.name = `${side}UpLeg`; lower.name = `${side}Leg`; foot.name = `${side}Foot`;
      upper.position.set(x, 0, 0); lower.position.set(0, -0.42, 0.06); foot.position.set(0, -0.42, -0.06);
      hips.add(upper); upper.add(lower); lower.add(foot);
      return foot;
    };
    const left = leg("Left", 0.1), right = leg("Right", -0.1);
    root.updateMatrixWorld(true);
    return { root, left, right, ik: new ContactIK(root, root, null, null) };
  }
  const at = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3());

  it("lifts one foot and sets it down, then the other, while the body crosses", () => {
    const f = legs(), start = [at(f.left), at(f.right)], delta = new THREE.Vector3(0, 0, 0.25);
    expect(f.ik.beginStep(delta)).toBe(true);
    let moved = [0, 0], lifted = [0, 0], together = 0;
    let last = start.map(point => point.clone());
    for (let i = 1; i <= 20; i++) {
      f.ik.restore(); f.root.position.z = 0.25 * i / 20; f.root.updateMatrixWorld(true);
      f.ik.stepTo(i / 20); f.ik.apply(0, "plant", null, 0, null);
      const now = [at(f.left), at(f.right)];
      const step = now.map((point, k) => Math.hypot(point.x - last[k].x, point.z - last[k].z));
      // A foot that travels is in the air; a foot on the ground stays where it is.
      now.forEach((point, k) => { lifted[k] = Math.max(lifted[k], point.y - start[k].y); if (point.y - start[k].y < 0.01) moved[k] += step[k]; });
      if (step[0] > 0.004 && step[1] > 0.004) together += 1;
      last = now;
    }
    expect(lifted[0]).toBeGreaterThan(0.04); expect(lifted[1]).toBeGreaterThan(0.04);
    expect(moved[0]).toBeLessThan(0.045); expect(moved[1]).toBeLessThan(0.045);
    expect(together).toBeLessThanOrEqual(4);
    // Both feet end a step further on, back on the floor.
    [f.left, f.right].forEach((foot, k) => { expect(at(foot).z - start[k].z).toBeCloseTo(0.25, 2); expect(at(foot).y).toBeCloseTo(start[k].y, 2); });
    expect(f.ik.stepping).toBe(false);
  });

  it("re-sets a planted foot with a step once the body has moved off it, one foot at a time", () => {
    const f = legs(), start = [at(f.left), at(f.right)];
    f.ik.restepDistance = 0.12; f.ik.delta = 1 / 60; f.ik.plantFeet();
    // A small shift: both feet stay exactly where they were.
    f.root.position.x = 0.06; f.root.updateMatrixWorld(true); f.ik.apply(0, "plant", null, 0, null);
    expect(at(f.left).distanceTo(start[0])).toBeLessThan(0.01); expect(at(f.right).distanceTo(start[1])).toBeLessThan(0.01);
    // A larger one: the feet follow by stepping, never both in the air.
    let lift = 0, both = 0, last = [at(f.left), at(f.right)];
    for (let i = 0; i < 60; i++) {
      f.ik.restore(); f.root.position.x = 0.2; f.root.updateMatrixWorld(true); f.ik.apply(0, "plant", null, 0, null);
      const now = [at(f.left), at(f.right)];
      lift = Math.max(lift, now[0].y - start[0].y, now[1].y - start[1].y);
      if (i > 0 && Math.abs(now[0].x - last[0].x) > 0.003 && Math.abs(now[1].x - last[1].x) > 0.003) both += 1;
      last = now;
    }
    expect(lift).toBeGreaterThan(0.03); expect(both).toBe(0);
    expect(at(f.left).x - start[0].x).toBeCloseTo(0.2, 1); expect(at(f.right).x - start[1].x).toBeCloseTo(0.2, 1);
  });
});

describe("the duel life layer", () => {
  function figure() {
    const anchor = new THREE.Group(), visual = new THREE.Group(); anchor.add(visual);
    const bone = (name: string, parent: THREE.Object3D, y = 0) => { const b = new THREE.Bone(); b.name = name; b.position.y = y; parent.add(b); return b; };
    const hips = bone("Hips", visual, 0.4), spine = bone("Spine02", hips, 0.3), neck = bone("neck", spine, 0.3), head = bone("Head", neck, 0.1);
    const shield = bone("LeftArm", spine), weapon = bone("RightArm", spine);
    return { anchor, visual, hips, spine, head, shield, weapon, rig: new LivingPieceRig(visual, hips) };
  }
  const still = new THREE.Quaternion();
  const run = (f: ReturnType<typeof figure>, seconds: number, from = 0) => { for (let i = 0; i < seconds * 60; i++) { f.rig.restore(); f.rig.apply(1 / 60, from + i / 60, false, false); } };

  it("turns head and spine to the opponent and follows it when it moves", () => {
    const f = figure(), rival = new THREE.Vector3(2, 0.5, 2);
    f.rig.engage(out => out.copy(rival));
    run(f, 1);
    const headYaw = () => new THREE.Vector3(0, 0, 1).applyQuaternion(f.head.getWorldQuaternion(new THREE.Quaternion())).x;
    expect(headYaw()).toBeGreaterThan(0.15);
    rival.set(-2, 0.5, 2); run(f, 1, 1);
    expect(headYaw()).toBeLessThan(-0.15);
  });

  it("breathes and shifts its weight while it waits, where an idle one-shot was frozen", () => {
    const quiet = figure(), alive = figure();
    alive.rig.engage(out => out.set(0, 0.5, 3));
    const poses: number[] = [];
    for (let i = 0; i < 90; i++) {
      quiet.rig.restore(); quiet.rig.apply(1 / 60, i / 60, false, false);
      alive.rig.restore(); alive.rig.apply(1 / 60, i / 60, false, false);
      poses.push(alive.spine.quaternion.angleTo(still));
    }
    expect(quiet.spine.quaternion.angleTo(still)).toBeLessThan(1e-7);
    expect(Math.max(...poses.slice(30)) - Math.min(...poses.slice(30))).toBeGreaterThan(0.004);
  });

  it("lets the hips lead a thrust, then swings back past rest and settles", () => {
    const f = figure(); f.rig.engage(out => out.set(0, 0.5, 3)); run(f, 0.5);
    const hipYaw = () => { f.rig.restore(); f.rig.apply(1 / 60, 0, false, false); return 2 * Math.atan2(f.hips.quaternion.y, f.hips.quaternion.w); };
    f.rig.drive(0.2);
    let peak = 0, trough = 0; const tail: number[] = [];
    for (let i = 0; i < 90; i++) { const yaw = hipYaw(); peak = Math.max(peak, yaw); if (i > 12) trough = Math.min(trough, yaw); if (i > 70) tail.push(Math.abs(yaw)); }
    expect(peak).toBeGreaterThan(0.08); expect(trough).toBeLessThan(-0.002);
    expect(Math.max(...tail)).toBeLessThan(0.01);
  });

  it("rings and settles after a hit instead of stopping dead, and eases a dropped guard", () => {
    const f = figure(); f.rig.engage(out => out.set(0, 0.5, 3)); run(f, 0.5);
    f.rig.brace(new THREE.Vector3(3, 0.5, 3)); run(f, 0.5, 0.5);
    const braced = f.spine.quaternion.clone();
    f.rig.impact(new THREE.Vector3(0, 0, -1), 1);
    f.rig.restore(); f.rig.apply(1 / 60, 1, false, false);
    // One frame after the guard is knocked down the chest has not snapped round.
    expect(f.spine.quaternion.angleTo(braced)).toBeLessThan(0.12);
    const pitch: number[] = [];
    for (let i = 0; i < 60; i++) { f.rig.restore(); f.rig.apply(1 / 60, 1 + i / 60, false, false); pitch.push(f.spine.quaternion.x); }
    const signs = new Set(pitch.filter(value => Math.abs(value) > 0.002).map(Math.sign));
    expect(signs.size).toBe(2);
    // Death and reset leave nothing of the layer behind.
    f.rig.beginDeath(); expect(f.rig.inDuel).toBe(false);
    f.rig.reset(); expect(f.rig.hasReaction).toBe(false);
  });

  it("outside a duel the rig behaves exactly as before", () => {
    const f = figure(); f.rig.brace(new THREE.Vector3(3, 0.5, 3)); f.rig.apply(1 / 60, 0, false, false);
    const braced = f.spine.quaternion.angleTo(still); expect(braced).toBeGreaterThan(0.03);
    f.rig.restore(); f.rig.impact(new THREE.Vector3(0, 0, 1), 0.2); f.rig.apply(1e-6, 0, false, false);
    // No duel: the guard drops at once, as it always did.
    expect(f.hips.quaternion.angleTo(still)).toBeLessThan(1e-7);
  });
});

describe("bystanders react to a killing", () => {
  it("moves more of them, with their bodies, and ripples outward from the blow", () => {
    const pawn = (square: string, x: number, z: number, color: "w" | "b" = "b") => ({ id: square, square, kind: "p" as const, color, point: { x, y: 0, z } });
    const roster = [pawn("c7", -1, -2), pawn("e7", 1, -2), pawn("b6", -2, -1), pawn("f6", 2, -1), pawn("d2", 0, 2.5, "w"), pawn("c2", -1, 2.5, "w")];
    const low = new BoardReactionDirector("low", 1);
    const plan = low.plan({ id: "kill", type: "capture-impact", point: { x: 0, y: 0, z: 0 }, victimColor: "b", power: 1 }, roster);
    expect(plan.reactions.length).toBe(4);
    for (const { cue } of plan.reactions) { expect(cue.headOnly).toBe(false); expect(cue.flinch).toBeGreaterThan(0.1); }
    const allies = plan.reactions.filter(item => item.id.endsWith("7") || item.id.endsWith("6"));
    expect(Math.max(...allies.map(item => item.cue.posture))).toBeGreaterThan(0.04);
    // Further away, later.
    const near = plan.reactions.find(item => item.id === "c7")!, far = new BoardReactionDirector("high", 1)
      .plan({ id: "kill", type: "capture-impact", point: { x: 0, y: 0, z: 0 }, victimColor: "b", power: 1 }, roster).reactions.find(item => item.id === "d2")!;
    expect(far.cue.delay).toBeGreaterThan(near.cue.delay);
    expect(new BoardReactionDirector("high", 1).budget).toBe(12);
  });
});
