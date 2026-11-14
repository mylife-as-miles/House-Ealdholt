// Adapted from LinearAbilityExtThreeJS and LinearAbiltyCastingExtendedThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The phoenix rite, moment by moment: how far the seal is written and how hot it burns, when the talons close, how
 * the sun comes and gutters, how the stone burns where the body comes down, and where the one light the match
 * lends it should be. And everything loose the rite throws, with its birth time, written once. Pure maths, no
 * Three.js, so the node tests reach it (shared/play/rite-phoenix.test.ts); phoenix/phoenixRite.ts hands it to the
 * drawing.
 *
 * One clock for every layer (the rule of docs/play/SPELL_LIBRARY.md): every envelope below is a function of the
 * rite's seconds and nothing else, so a capture is the same frame by frame however it is stepped.
 *
 * From the reference's Fire Portal (Ext `FirePortalAbility.js`): a ring is not switched on but struck, and throws
 * sparks off itself on a tangent that drag bends into curves. From its Celestial Rend (Extended
 * `RendPillarMaterial.js`): the star's points and the halos' write-on are driven by one charge. Ours: the seal is
 * written by two pens and flares rather than opening a hole; the sun is what the bird becomes, so its light,
 * its embers and its guttering all follow the bird's own clock.
 */
import type { Point } from "../../vfx/mystic/beamPlan";
import { PARTICLE_KIND, between, scatter, sequence, type Particle } from "../../vfx/spells/shared/particlePlan";
import { phoenixPosition, phoenixVelocity, type PhoenixPlan, type PhoenixWingbeat } from "./phoenixFlight";
import { PLUME_KIND, emptyPose, hovering, phoenixPose, plumePoints, type PhoenixBudget, type PlumeAnchors, type PlumeLayout } from "./phoenixForm";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };

export interface PhoenixMoment {
  /** The light in the Queen's hand (0..1); how far the thread has climbed to the seal (0..1) and how bright it is. */
  hand: number;
  thread: number;
  threadGlow: number;
  /** How much of the seal the pens have written (0..1), how brightly it burns, and how hot (1 is white). */
  pen: number;
  seal: number;
  sealHeat: number;
  /** The seal's flare (0..1, gone in a fifth of a second) and seconds since it (-1 before). */
  flare: number;
  sinceFlare: number;
  /** 1 while the seal stands, 0 once it has cooled away. */
  sealFade: number;
  /** The hot opening at the seal's heart while the bird comes through it (0..1). */
  opening: number;
  /** True while the seal's plane still hides what has not come through it. */
  cut: boolean;
  /** True from the frame the talons close on the victim. */
  struck: boolean;
  sinceStrike: number;
  /** The flash as the talons close (0..1). */
  flash: number;
  /** How hard the bird is hovering over the board, its light pooled on the stone under it (0..1). */
  pool: number;
  /** True from the moment the body it let go of comes down on its stone, and seconds since. */
  landed: boolean;
  sinceLand: number;
  /** How far the fire has run out round the fallen body (0..1), how hot the stone burns (0..1), and how charred it is (0..1). */
  wash: number;
  washHeat: number;
  scorch: number;
  /** The sun: how much of it there is (0..1), how hot (1 white), how large (1 at rest), how far its star reaches, how much of its halos is written, and how much of them is still alight as they fail. */
  sun: number;
  sunHeat: number;
  sunSize: number;
  star: number;
  halos: number;
  haloLife: number;
  /** Seconds since the sunburst (-1 before), and how far the shock ring it throws has run (0..1). */
  sinceBurst: number;
  shock: number;
  /** How far it has guttered (0..1), and how hard it stutters (0..1). */
  gutter: number;
  flicker: number;
  /** The light the rite asks for: how bright, and what it follows. */
  glow: number;
  glowAt: "hand" | "seal" | "bird" | "victim" | "sun";
  done: boolean;
}

/** What the rite is doing `t` seconds after the Queen calls. */
export function phoenixMoment(plan: PhoenixPlan, t: number): PhoenixMoment {
  const T = plan.timeline, brief = T.brief;
  const pen = clamp((t - T.pen[0]) / (T.pen[1] - T.pen[0]), 0, 1);
  const flare = brief ? 0 : t < T.flare ? smooth(T.flare - 0.06, T.flare, t) : Math.exp(-(t - T.flare) / 0.13);
  const sealFade = 1 - smooth(T.burst[1] - 0.05, T.open[1] + 0.25, t);
  // The seal comes up whole in the brief form: nothing is seen to be written.
  const shown = brief ? smooth(T.pen[0], T.pen[1], t) : pen > 0 ? 1 : 0;
  const opening = smooth(T.burst[0] + 0.04, T.burst[0] + 0.18, t) * (1 - smooth(T.burst[1] - 0.1, T.burst[1] + 0.2, t));
  const struck = t >= T.strikeAt, sinceStrike = struck ? t - T.strikeAt : -1;
  const flash = brief || !struck ? 0 : Math.exp(-sinceStrike / 0.1);
  const landed = t >= plan.landAt, sinceLand = landed ? t - plan.landAt : -1;
  const burst = t >= T.sunburst, sinceBurst = burst ? t - T.sunburst : -1;
  const gutter = smooth(T.gutter[0], T.gutter[1], t);
  const sun = smooth(T.sunburst - 0.06, T.sunburst + 0.12, t) * (1 - smooth(T.gutter[1] - 0.18, T.gutter[1], t));
  const swell = brief || !burst ? 0 : Math.exp(-sinceBurst / 0.16);
  const sunHeat = 0.93 * (1 - 0.82 * gutter) * (brief ? 0.85 : 1);
  const star = brief ? 0 : smooth(T.sunburst, T.sunburst + 0.22, t) * (1 - smooth(T.gutter[0], T.gutter[0] + 0.4, t));
  const halos = smooth(T.sunburst + 0.05, T.sunburst + (brief ? 0.8 : 0.5), t);
  const haloLife = 1 - smooth(T.gutter[0] + 0.05, T.gutter[1] - 0.15, t);
  const shock = brief || !burst ? 0 : clamp(sinceBurst / 1.0, 0, 1);
  const hover = hovering(plan, t);
  // The flare is a flash of heat, not of size: the seal stays a written thing, never a white plate.
  const seal = shown * (0.7 + 0.3 * pen + (brief ? 0 : 0.3 * flare)) * sealFade;
  const sealHeat = clamp(0.56 + 0.18 * pen + 0.16 * flare + 0.06 * opening, 0, 0.94) * (0.35 + 0.65 * sealFade);
  // The light: in the hand, on the seal as it is written, with the bird in flight, on the victim as the talons
  // close, with the bird again as it carries and hovers, then the sun.
  let glow: number, glowAt: PhoenixMoment["glowAt"];
  const hand = smooth(T.gather[0], T.gather[1], t) * (1 - smooth(T.flare, T.flare + 0.35, t));
  if (t < T.pen[0] + 0.1) { glow = 0.25 + 0.5 * hand; glowAt = "hand"; }
  else if (t < T.burst[0] + 0.15) { glow = 0.45 * shown + 0.3 * hand + 1.6 * flare; glowAt = "seal"; }
  else if (t < T.strikeAt - 0.02) { glow = 1.2 + 0.4 * smooth(T.dive[0], T.strikeAt, t) + 0.6 * opening; glowAt = "bird"; }
  else if (t < T.strikeAt + 0.32) { glow = 1.3 + 4 * flash; glowAt = "victim"; }
  else if (t < T.sunburst - 0.05) { glow = 1.25 + 0.3 * hover; glowAt = "bird"; }
  else { glow = sun * Math.pow(sunHeat, 1.4) * (brief ? 1.6 : 2.8) + 5 * swell; glowAt = "sun"; }
  const end = 1 - smooth(T.duration - 0.6, T.duration - 0.05, t);
  return {
    hand,
    thread: smooth(T.gather[0] + 0.08, T.pen[0] + 0.04, t),
    threadGlow: (brief ? 0.6 : 1) * smooth(T.gather[0] + 0.02, T.gather[0] + 0.15, t) * (1 - smooth(T.flare - 0.08, T.flare + 0.12, t)),
    pen: brief ? (t >= T.pen[0] ? 1 : 0) : pen, seal, sealHeat, flare, sinceFlare: t >= T.flare ? t - T.flare : -1, sealFade, opening,
    cut: t < T.open[1] + 0.3,
    struck, sinceStrike, flash,
    pool: hover,
    landed, sinceLand,
    wash: landed ? smooth(0, 0.3, sinceLand) : 0,
    washHeat: landed ? Math.exp(-Math.max(0, sinceLand - 0.12) / 0.45) * end : 0,
    scorch: landed ? smooth(0.05, 0.4, sinceLand) * end : 0,
    sun, sunHeat, sunSize: (1 + 0.2 * swell) * (1 - 0.5 * gutter), star, halos, haloLife, sinceBurst, shock,
    gutter, flicker: brief ? 0 : 0.04 + 0.6 * gutter,
    glow, glowAt,
    done: t >= T.duration,
  };
}

export interface PhoenixLoose {
  /** Motes, sparks, embers and drawn flashes: added light. */
  light: Particle[];
  /** Smoke off the burnt square: it covers what is behind it. */
  smoke: Particle[];
}

/** A point on the seal's ring at `angle` from where the pens start, `share` of its radius out. */
export function sealPoint(plan: PhoenixPlan, angle: number, share = 1): Point {
  const { centre, down, across, radius } = plan.seal, c = Math.cos(angle) * radius * share, s = Math.sin(angle) * radius * share;
  return { x: centre.x + down.x * c + across.x * s, y: centre.y + down.y * c + across.y * s, z: centre.z + down.z * c + across.z * s };
}

/**
 * Everything loose in one rite, with its birth times, written once. `hand` is where the Queen's hand is when she
 * calls: the motes that gather in it are anchored to it and follow it.
 */
export function phoenixParticles(plan: PhoenixPlan, budget: PhoenixBudget, layout: PlumeLayout, beats: readonly PhoenixWingbeat[], hand: Point): PhoenixLoose {
  const T = plan.timeline, unit = plan.unit, brief = T.brief, dice = sequence((plan.seed ^ 0xf1e2) >>> 0);
  const light: Particle[] = [], smoke: Particle[] = [], zero = { x: 0, y: 0, z: 0 };
  const top = plan.boardTop, chest = plan.chest, stone = plan.stone, h = plan.heading, sun = plan.sun;

  // The hand: a glow, and motes that climb off it after the thread.
  light.push({ kind: PARTICLE_KIND.halo, origin: zero, velocity: zero, birth: 0, life: T.flare + 0.4, size: 0.42 * unit, tone: 0.6, anchored: true, fadeIn: 0.25 });
  light.push({ kind: PARTICLE_KIND.mote, origin: zero, velocity: zero, birth: 0.05, life: T.flare + 0.3, size: 0.11 * unit, tone: 0.95, anchored: true, fadeIn: 0.3 });
  for (let i = 0; i < Math.round(budget.sparks * 0.12); i += 1) {
    const way = scatter(dice, 0.55, 1);
    light.push({ kind: PARTICLE_KIND.mote, origin: { x: way.x * 0.05, y: 0, z: way.z * 0.05 }, velocity: { x: way.x * 0.3, y: (0.7 + 0.9 * dice()) * unit, z: way.z * 0.3 }, birth: dice() * T.flare * 0.9, life: 0.45 + 0.35 * dice(), size: 0.02 * unit, drag: 1, gravity: -1.4, tone: 0.8, anchored: true });
  }
  void hand;

  // The pens: sparks where they write, falling off the ring.
  if (!brief) for (let i = 0; i < Math.round(budget.sparks * 0.25); i += 1) {
    const share = dice(), angle = (i % 2 === 0 ? 1 : -1) * Math.PI * Math.min(1, share * 1.35), at = sealPoint(plan, angle);
    const way = scatter(dice, -0.6, 0.6), speed = (0.4 + 0.8 * dice()) * unit;
    light.push({ kind: PARTICLE_KIND.streak, origin: at, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: T.pen[0] + share * (T.pen[1] - T.pen[0]) + 0.02 * dice(), life: 0.25 + 0.3 * dice(), size: 0.02 * unit, drag: 1.2, gravity: 2.5, tone: 0.8 + 0.2 * dice() });
  }
  // The flare: the ring throws stretched sparks off itself on a tangent, all the way round.
  const thrown = brief ? 0 : Math.round(budget.sparks * 0.4);
  for (let i = 0; i < thrown; i += 1) {
    const angle = (i / thrown) * Math.PI * 2 + dice() * 0.2, at = sealPoint(plan, angle), turn = dice() < 0.5 ? 1 : -1;
    const { down, across, normal } = plan.seal, c = Math.cos(angle), s = Math.sin(angle);
    const out = { x: down.x * c + across.x * s, y: down.y * c + across.y * s, z: down.z * c + across.z * s };
    const tangent = { x: (-down.x * s + across.x * c) * turn, y: (-down.y * s + across.y * c) * turn, z: (-down.z * s + across.z * c) * turn };
    const speed = (2.6 + 3 * dice()) * unit, lift = (dice() - 0.3) * 0.8;
    light.push({
      kind: PARTICLE_KIND.streak, origin: at,
      velocity: { x: (tangent.x * 0.8 + out.x * 0.5 + normal.x * lift) * speed, y: (tangent.y * 0.8 + out.y * 0.5 + normal.y * lift) * speed, z: (tangent.z * 0.8 + out.z * 0.5 + normal.z * lift) * speed },
      birth: T.flare + 0.04 * dice(), life: 0.4 + 0.45 * dice(), size: (0.02 + 0.014 * dice()) * unit, drag: 2.2, gravity: 2, tone: 0.75 + 0.25 * dice(),
    });
  }
  if (!brief) light.push({ kind: PARTICLE_KIND.halo, origin: plan.seal.centre, velocity: zero, birth: T.flare - 0.04, life: 0.28, size: plan.seal.radius * 1.2, tone: 0.4, fadeIn: 0.12 });

  // Embers shed from the trailing edges of the wings and from the tail, more of them the faster it flies and the harder it beats.
  const trailing = layout.specs.map((spec, index) => ({ spec, index })).filter(({ spec }) => spec.kind === PLUME_KIND.feather || spec.kind === PLUME_KIND.streamer || spec.kind === PLUME_KIND.rectrix);
  const most = layout.specs.reduce((m, spec) => Math.max(m, spec.segments + 1), 0);
  const points = new Float32Array(most * 3), profile = new Float32Array(most * 2), pose = emptyPose();
  const anchors: PlumeAnchors = { hand, thread: 0, threadGlow: 0, pen: hand };
  const from = T.burst[0] + 0.3, until = T.sunburst - 0.1, velocity = { x: 0, y: 0, z: 0 };
  const embers = Math.round(budget.embers * (brief ? 0.4 : 1));
  for (let i = 0; i < embers; i += 1) {
    // Weighted toward the swoop, the carry and the hover, where it is fastest and beats hardest.
    let birth = from + (until - from) * dice();
    if (dice() < 0.5) birth = T.dive[0] + (T.hover[1] - T.dive[0]) * dice();
    phoenixPose(plan, beats, birth, pose);
    const pick = trailing[Math.floor(dice() * trailing.length)];
    plumePoints(pick.spec, pose, plan, anchors, points, profile);
    const n = pick.spec.segments, at = Math.round(n * (0.55 + 0.45 * dice()));
    phoenixVelocity(plan, birth, velocity);
    const way = scatter(dice, -0.4, 0.9), fast = Math.hypot(velocity.x, velocity.y, velocity.z) > 6 * unit;
    light.push({
      kind: fast && dice() < 0.6 ? PARTICLE_KIND.streak : PARTICLE_KIND.mote,
      origin: { x: points[at * 3], y: Math.max(top + 0.05, points[at * 3 + 1]), z: points[at * 3 + 2] },
      velocity: { x: velocity.x * 0.18 + way.x * 0.7 * unit, y: velocity.y * 0.18 + way.y * 0.7 * unit, z: velocity.z * 0.18 + way.z * 0.7 * unit },
      birth, life: 0.6 + 0.8 * dice(), size: (0.03 + 0.045 * dice() * dice()) * unit, drag: 1.6, gravity: -0.5, tone: 0.55 + 0.4 * dice(), wander: 0.2 * unit, fadeIn: 0.05,
    });
  }

  // The talons close: a flash drawn round the victim, and sparks thrown on along the swoop and up off the body.
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: chest, velocity: zero, birth: T.strikeAt, life: 0.4, size: 2.2 * unit, tone: 0.7, fadeIn: 0.06 });
    light.push({ kind: PARTICLE_KIND.mote, origin: chest, velocity: zero, birth: T.strikeAt, life: 0.2, size: 0.4 * unit, tone: 0.9, fadeIn: 0.05 });
    for (let i = 0; i < Math.round(budget.sparks * 0.5); i += 1) {
      const way = scatter(dice, -0.2, 0.8), speed = (2.5 + 5 * dice()) * unit, on = 0.5 + 0.4 * dice();
      light.push({
        kind: PARTICLE_KIND.streak, origin: { x: chest.x + (dice() - 0.5) * 0.3 * unit, y: chest.y + (dice() - 0.5) * 0.4 * unit, z: chest.z + (dice() - 0.5) * 0.3 * unit },
        velocity: { x: (way.x * (1 - on) + h.x * on) * speed, y: way.y * speed, z: (way.z * (1 - on) + h.z * on) * speed },
        birth: T.strikeAt + 0.05 * dice(), life: 0.3 + 0.45 * dice(), size: (0.02 + 0.014 * dice()) * unit, drag: 1.3, gravity: 7, tone: 0.75 + 0.25 * dice(),
      });
    }
  }

  // The body burning in its grip: embers off it and soot rolling up from it while it is carried and held.
  const held = brief ? 0 : 1;
  for (let i = 0; i < Math.round(budget.sparks * 0.4 * held); i += 1) {
    const birth = T.strikeAt + 0.1 + (T.release - T.strikeAt - 0.1) * dice();
    phoenixPose(plan, beats, birth, pose);
    const way = scatter(dice, -0.3, 0.9);
    light.push({
      kind: PARTICLE_KIND.mote, origin: { x: pose.socket[0] + way.x * 0.15 * unit, y: pose.socket[1] - (0.1 + 0.5 * dice()) * unit, z: pose.socket[2] + way.z * 0.15 * unit },
      velocity: { x: way.x * 0.6 * unit, y: (0.6 + 1.2 * dice()) * unit, z: way.z * 0.6 * unit },
      birth, life: 0.5 + 0.7 * dice(), size: (0.02 + 0.025 * dice()) * unit, drag: 1.2, gravity: -1, tone: 0.55 + 0.4 * dice(), wander: 0.12 * unit, fadeIn: 0.04,
    });
  }
  for (let i = 0; i < Math.round(budget.smoke * held); i += 1) {
    const birth = T.strikeAt + 0.25 + (T.release - T.strikeAt - 0.1) * dice();
    phoenixPose(plan, beats, birth, pose);
    smoke.push({
      kind: PARTICLE_KIND.puff, origin: { x: pose.socket[0] + (dice() - 0.5) * 0.3 * unit, y: pose.socket[1] - 0.2 * unit, z: pose.socket[2] + (dice() - 0.5) * 0.3 * unit },
      velocity: { x: (dice() - 0.5) * 0.4 * unit, y: (0.5 + 0.5 * dice()) * unit, z: (dice() - 0.5) * 0.4 * unit },
      birth, life: 1.1 + 0.8 * dice(), size: (0.28 + 0.2 * dice()) * unit, drag: 0.6, gravity: -0.35, tone: 0.1 + 0.25 * dice(), grow: 2.4, fadeIn: 0.2, wander: 0.25 * unit,
    });
  }

  // It comes down: embers burst off the stone round it as it lands, and a little smoke.
  for (let i = 0; i < Math.round(budget.sparks * 0.35); i += 1) {
    const way = scatter(dice, 0.2, 1), out = (0.15 + 0.45 * dice()) * unit;
    light.push({
      kind: dice() < 0.4 ? PARTICLE_KIND.streak : PARTICLE_KIND.mote, origin: { x: stone.x + way.x * out, y: top + 0.08, z: stone.z + way.z * out },
      velocity: { x: way.x * (0.6 + 1.6 * dice()) * unit, y: (0.8 + 1.8 * dice()) * unit, z: way.z * (0.6 + 1.6 * dice()) * unit },
      birth: plan.landAt + 0.06 * dice(), life: 0.45 + 0.5 * dice(), size: (0.018 + 0.02 * dice()) * unit, drag: 1.1, gravity: 3, tone: 0.55 + 0.4 * dice(),
    });
  }
  for (let i = 0; i < Math.round(budget.smoke * 0.5); i += 1) {
    const along = (dice() - 0.5) * 0.8 * unit, across = (dice() - 0.5) * 0.8 * unit;
    smoke.push({
      kind: PARTICLE_KIND.puff, origin: { x: stone.x + h.x * along - h.z * across, y: top + 0.15 * unit, z: stone.z + h.z * along + h.x * across },
      velocity: { x: (dice() - 0.5) * 0.25, y: (0.4 + 0.4 * dice()) * unit, z: (dice() - 0.5) * 0.25 },
      birth: plan.landAt + 0.05 + 0.3 * dice(), life: 1.4 + 1 * dice(), size: (0.22 + 0.14 * dice()) * unit, drag: 0.6, gravity: -0.35, tone: 0.15 + 0.35 * dice(), grow: 2.6, fadeIn: 0.15, wander: 0.2 * unit,
    });
  }

  // The sunburst: a flash, and the sun's embers raining down over the board until it gutters out.
  if (!brief) {
    light.push({ kind: PARTICLE_KIND.halo, origin: sun, velocity: zero, birth: T.sunburst - 0.03, life: 0.45, size: 2.6 * unit, tone: 0.5, fadeIn: 0.08 });
    light.push({ kind: PARTICLE_KIND.mote, origin: sun, velocity: zero, birth: T.sunburst - 0.02, life: 0.22, size: 0.45 * unit, tone: 0.8, fadeIn: 0.05 });
  }
  const rain = Math.round(budget.rain * (brief ? 0.35 : 1)), span = Math.max(0.2, T.gutter[1] - 0.3 - T.sunburst);
  for (let i = 0; i < rain; i += 1) {
    const way = scatter(dice, -0.95, 0.35), birth = T.sunburst + span * Math.pow(dice(), 0.8), out = (0.35 + 0.4 * dice()) * unit;
    const speed = (brief ? 0.4 : 1.0 + 2.2 * dice()) * unit;
    light.push({
      kind: dice() < 0.25 ? PARTICLE_KIND.streak : PARTICLE_KIND.mote,
      origin: { x: sun.x + way.x * out, y: sun.y + way.y * out, z: sun.z + way.z * out },
      velocity: { x: way.x * speed, y: way.y * speed - 0.4 * unit, z: way.z * speed },
      birth, life: between(dice, 1.2, 2.2), size: (0.025 + 0.035 * dice() * dice()) * unit, drag: 0.85, gravity: (brief ? 1 : 2.4) * unit, tone: 0.6 + 0.4 * dice(), wander: 0.25 * unit, fadeIn: 0.06,
    });
  }
  const within = (list: Particle[]) => list.map((particle) => ({ ...particle, life: Math.min(particle.life, Math.max(0.05, T.duration - particle.birth)) }));
  return { light: within(light), smoke: within(smoke) };
}

/** Where the bird is at `t`, for the light and the sounds that follow it. */
export function birdAt(plan: PhoenixPlan, t: number, out?: Point): Point {
  return phoenixPosition(plan, t, out);
}
