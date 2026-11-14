/**
 * The phoenix's real fire: which flames stand on the burning bird, and what fire and soot it sheds along its
 * flight, drawn with the game's flipbook atlases (vfx/library.ts: JangaFX's CC0 EmberGen fire and explosion, and the
 * game's own smoke). Pure maths, no Three.js, so the node tests reach it (shared/play/rite-phoenix-form.test.ts);
 * phoenix/flames.ts draws it.
 *
 * Three kinds:
 *
 * - The blaze: flames standing on the bird itself, each tied to a cut of one of its ribbons (along the trailing
 *   edges of the wings, the coverts, the tail and its streamers, the neck and the thighs), so wherever the bird is
 *   and however it beats, its wings and tail are ablaze. Each flame is the fire atlas's loop, its tongue streaming
 *   back from the bird along the air it flies through, and up where it hovers.
 * - The trail: tongues of fire torn off the wings and the tail along the whole flight, left in the air as it flies
 *   on, drawn out long along the way they stream, so the bird draws a long wake of fire behind it, and wraps itself
 *   in fire where it hovers.
 * - The soot: dark smoke rolling off it and off the body burning in its talons, which the fire is seen against in
 *   a bright sky.
 * - The gouts: great one-shot eruptions of the flare atlas where the rite strikes: out of the seal as the bird bursts
 *   through it, round the victim as the talons close, off the stone as the body comes down, and as it becomes the sun.
 *
 * Every shed sprite is written once, with its birth time, as the kit's particles are (vfx/spells/shared/
 * particlePlan.ts): the flight is known when the rite is made, so the bird is posed at each birth to find where
 * the sprite leaves it.
 */
import type { Point } from "../../vfx/mystic/beamPlan";
import { scatter, sequence } from "../../vfx/spells/shared/particlePlan";
import { phoenixVelocity, type PhoenixPlan, type PhoenixWingbeat } from "./phoenixFlight";
import { PLUME_KIND, emptyPose, phoenixPose, plumePoints, type PhoenixBudget, type PlumeAnchors, type PlumeLayout } from "./phoenixForm";

/** A flame standing on the bird: the ribbon and the cut it stands on, its size (scene units across its cell), how hot, and where its loop starts. */
export interface BlazeFlame {
  spec: number;
  cut: number;
  size: number;
  heat: number;
  frame: number;
  seed: number;
}

/** A sprite shed into the air: where and when it is born, how it drifts, which way its tongue streams, and how it is drawn. */
export interface ShedSprite {
  origin: Point;
  velocity: Point;
  /** Upward pull of the hot air, in units a second squared. */
  rise: number;
  /** Unit: the way its flame or its column points (the atlas's up). */
  stream: Point;
  birth: number;
  life: number;
  /** Scene units across its cell, and how much larger it grows each second, as a share of that. */
  size: number;
  growth: number;
  heat: number;
  alpha: number;
  /** 1 only adds light; 0 covers like smoke. */
  additive: number;
  /** The atlas frame it starts on; it plays on to the last frame over its life. */
  first: number;
  seed: number;
}

export interface PhoenixFlamePlan {
  blaze: BlazeFlame[];
  trail: ShedSprite[];
  soot: ShedSprite[];
  gouts: ShedSprite[];
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Everything of the bird's real fire for one rite. */
export function phoenixFlames(plan: PhoenixPlan, budget: PhoenixBudget, layout: PlumeLayout, beats: readonly PhoenixWingbeat[]): PhoenixFlamePlan {
  const T = plan.timeline, unit = plan.unit, brief = T.brief, dice = sequence((plan.seed ^ 0xb1a2e) >>> 0);
  const specs = layout.specs.map((spec, index) => ({ spec, index }));
  const of = (test: (kind: number, wing: number) => boolean) => specs.filter(({ spec }) => test(spec.kind, spec.wing));

  // The blaze, shared out over the bird: most of it along the wings' trailing edges.
  const blaze: BlazeFlame[] = [];
  const stand = (pool: { spec: { segments: number }; index: number }[], count: number, from: number, to: number, size: [number, number]) => {
    if (pool.length === 0) return;
    for (let i = 0; i < count; i += 1) {
      const pick = pool[Math.floor(((i + dice() * 0.999) / count) * pool.length) % pool.length];
      const cut = clamp(Math.round(pick.spec.segments * (from + (to - from) * dice())), 0, pick.spec.segments);
      blaze.push({ spec: pick.index, cut, size: (size[0] + (size[1] - size[0]) * dice()) * unit, heat: 0.72 + 0.14 * dice(), frame: Math.floor(dice() * 64), seed: dice() });
    }
  };
  const n = budget.blaze;
  for (const wing of [1, -1]) {
    stand(of((kind, w) => kind === PLUME_KIND.feather && w === wing), Math.round(n * 0.32), 0.4, 0.85, [1.0, 1.7]);
    stand(of((kind, w) => kind === PLUME_KIND.covert && w === wing), Math.round(n * 0.06), 0.4, 0.7, [0.9, 1.4]);
  }
  stand(of((kind) => kind === PLUME_KIND.rectrix), Math.round(n * 0.08), 0.5, 0.85, [1.0, 1.6]);
  stand(of((kind) => kind === PLUME_KIND.streamer), Math.round(n * 0.1), 0.06, 0.45, [1.0, 1.6]);
  stand(of((kind) => kind === PLUME_KIND.neck), Math.max(1, Math.round(n * 0.02)), 0.1, 0.6, [0.9, 1.3]);
  stand(of((kind) => kind === PLUME_KIND.leg), Math.max(2, Math.round(n * 0.04)), 0.05, 0.35, [0.8, 1.2]);

  // Shed along the flight: posed at each birth to find where on the bird it leaves.
  const most = layout.specs.reduce((m, spec) => Math.max(m, spec.segments + 1), 0);
  const points = new Float32Array(most * 3), profile = new Float32Array(most * 2), pose = emptyPose();
  const anchors: PlumeAnchors = { hand: { x: 0, y: 0, z: 0 }, thread: 0, threadGlow: 0, pen: { x: 0, y: 0, z: 0 } };
  const wings = of((kind) => kind === PLUME_KIND.feather), tail = of((kind) => kind === PLUME_KIND.rectrix || kind === PLUME_KIND.streamer);
  const velocity = { x: 0, y: 0, z: 0 };
  const leave = (birth: number, where: "wing" | "tail" | "body" | "prey"): { at: Point; v: Point; stream: Point } => {
    phoenixPose(plan, beats, birth, pose);
    phoenixVelocity(plan, birth, velocity);
    let at: Point;
    if (where === "prey") at = { x: pose.socket[0], y: pose.socket[1] - 0.35 * unit, z: pose.socket[2] };
    else if (where === "body") at = { x: pose.centre[0], y: pose.centre[1], z: pose.centre[2] };
    else {
      const pool = where === "wing" ? wings : tail, pick = pool[Math.floor(dice() * pool.length)];
      plumePoints(pick.spec, pose, plan, anchors, points, profile);
      const cut = Math.round(pick.spec.segments * (where === "wing" ? 0.55 + 0.45 * dice() : 0.2 + 0.6 * dice()));
      at = { x: points[cut * 3], y: points[cut * 3 + 1], z: points[cut * 3 + 2] };
    }
    at.y = Math.max(plan.boardTop + 0.3 * unit, at.y);
    // the air it flies through streams it back, and the heat lifts it
    const sx = -velocity.x, sy = -velocity.y + 2.2 * unit, sz = -velocity.z, sl = Math.hypot(sx, sy, sz) || 1;
    return { at, v: { ...velocity }, stream: { x: sx / sl, y: sy / sl, z: sz / sl } };
  };
  const shown = (t: number) => t > T.burst[1] - 0.1 && t < T.sunburst - 0.1;
  const within = (sprite: ShedSprite) => ({ ...sprite, life: Math.min(sprite.life, Math.max(0.05, T.duration - sprite.birth)) });

  const trail: ShedSprite[] = [];
  const shed = Math.round(budget.trail * (brief ? 0.4 : 1)), from = T.burst[1] - 0.05, until = T.sunburst - 0.15;
  for (let i = 0; i < shed; i += 1) {
    const birth = from + (until - from) * ((i + dice()) / shed);
    if (!shown(birth)) continue;
    const where = dice() < 0.62 ? "wing" : "tail";
    const { at, v, stream } = leave(birth, where);
    const drift = scatter(dice, -0.2, 0.8);
    // a tongue torn off a bird that is hardly moving (in its hover) is gone at once, or it hangs where a beating wing left it
    const going = clamp(Math.hypot(v.x, v.y, v.z) / (5 * unit), 0.35, 1);
    trail.push(within({
      origin: at, velocity: { x: v.x * 0.14 + drift.x * 0.4 * unit, y: v.y * 0.14 + drift.y * 0.4 * unit, z: v.z * 0.14 + drift.z * 0.4 * unit }, rise: 0.7 * unit, stream,
      birth, life: (0.26 + 0.16 * dice()) * going, size: (1.1 + 0.8 * dice()) * unit * (0.7 + 0.3 * going), growth: 0.5, heat: 0.8 + 0.1 * dice(), alpha: 0.8, additive: 0.88, first: Math.floor(64 * dice()), seed: dice(),
    }));
  }

  const soot: ShedSprite[] = [];
  const puffs = Math.round(budget.soot * (brief ? 0.4 : 1));
  for (let i = 0; i < puffs; i += 1) {
    // half off the bird along the flight, half off the body burning in its talons while it is carried
    const prey = !brief && i % 2 === 1;
    const birth = prey ? T.strikeAt + 0.15 + (T.release - T.strikeAt - 0.15) * dice() : from + (until - from - 0.3) * dice();
    if (!shown(birth)) continue;
    const { at, v } = leave(birth, prey ? "prey" : dice() < 0.6 ? "tail" : "wing");
    const drift = scatter(dice, 0.2, 1);
    soot.push(within({
      origin: at, velocity: { x: v.x * 0.08 + drift.x * 0.35 * unit, y: v.y * 0.08 + (0.5 + 0.5 * drift.y) * unit, z: v.z * 0.08 + drift.z * 0.35 * unit }, rise: 0.25 * unit, stream: { x: 0, y: 1, z: 0 },
      birth, life: 1.4 + 0.8 * dice(), size: (2.6 + 1.4 * dice()) * unit, growth: 0.5, heat: 0.6, alpha: 0.32 + 0.16 * dice(), additive: 0, first: 8 + Math.floor(6 * dice()), seed: dice(),
    }));
  }
  // The gouts, a handful at the rite's great moments: each erupts and tears apart over its life.
  const gouts: ShedSprite[] = [];
  const erupt = (at: Point, stream: Point, birth: number, size: number, count: number, spread: number) => {
    for (let i = 0; i < count; i += 1) {
      const off = scatter(dice, -0.3, 1);
      gouts.push(within({
        origin: { x: at.x + off.x * spread, y: Math.max(plan.boardTop + 0.02, at.y + off.y * spread * 0.5), z: at.z + off.z * spread }, velocity: { x: stream.x * 0.6 * unit, y: stream.y * 0.6 * unit, z: stream.z * 0.6 * unit }, rise: 0.4 * unit, stream,
        birth: birth + 0.05 * i, life: 0.65 + 0.2 * dice(), size: size * (0.8 + 0.4 * dice()) * unit, growth: 0.35, heat: 0.86 + 0.1 * dice(), alpha: 0.9, additive: 0.9, first: 0, seed: dice(),
      }));
    }
  };
  if (!brief) {
    const n = plan.seal.normal, up = { x: 0, y: 1, z: 0 };
    erupt(plan.seal.centre, n, T.burst[0] + 0.02, 4.5, 3, 0.6 * unit);
    erupt(plan.chest, up, T.strikeAt, 2.6, 2, 0.25 * unit);
    erupt({ ...plan.stone, y: plan.boardTop }, up, plan.landAt, 2.2, 2, 0.3 * unit);
    erupt(plan.sun, up, T.sunburst - 0.02, 4, 2, 0.3 * unit);
  }
  return { blaze, trail, soot, gouts };
}
