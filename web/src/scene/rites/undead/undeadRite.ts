// Adapted from LinearAbilityExtThreeJS and AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Kwind-09's summons: the undead army, as a rite the match can play (rites/rite.ts).
 *
 * undead/undeadPlan.ts is its clock, its budget and its wounds; armies/crowdPlan.ts the march between the pieces;
 * armies/groundPlan.ts the plates of stone. This draws it and moves the borrowed figures:
 *
 *   the split     current runs out from the victim's square along the seams between the squares (armies/ground.ts)
 *   the rising    at the corners the stone heaves and the dead haul themselves up through it, cut where they
 *                 cross the stone, the cut burning with the arc; greyed, corroded, torn (undead/undeadLook.ts), eyes lit
 *   the shamble   in lurches and twitches, the current jumping from corpse to corpse (the shared lightning strike)
 *   the swarm     they close on the victim and tear at it: each wound a killing blow in the match's gore system
 *   the sinking   each falls where it stands and sinks back into the stone through a hole that closes after it
 *
 * The piece dies torn apart at Full, thrown down at Cinematic, by its own fall at Minimal (`burst`).
 */
import * as THREE from "three";
import type { Point } from "../../vfx/mystic/beamPlan";
import { LightningStrike } from "../../vfx/spells/shared/lightning";
import { channelCapacity, mergeChannels, solveChannel, type Channel } from "../../vfx/spells/shared/lightningPlan";
import { ParticlePool } from "../../vfx/spells/shared/particles";
import { PARTICLE_KIND, between, scatter, type Particle } from "../../vfx/spells/shared/particlePlan";
import { STEADY, assignSlots, crowdBudget, dice, findPath, marchState, planMarch, planSlots, type Flat, type March, type Obstacle, type Slot } from "../armies/crowdPlan";
import { GlowPoints } from "../armies/glow";
import { GroundScar, SlabField } from "../armies/ground";
import { clearFrame } from "../armies/shotPlan";
import { TroopDriver, TroopLook, findBone } from "../armies/troops";
import type { RiteCast, RiteEffect, RiteEntry, RiteSound, RiteState, RiteTroop, RiteWound } from "../rite";
import { SeamHands } from "./hands";
import { setUndeadSkin, undeadMaterial, undeadSkin, type UndeadSkin, type UndeadSkinLook } from "./undeadLook";
import {
  SHAMBLE, UNDEAD_TIMING, UNDEAD_TORN, cornerPlates, haulRise, seamCorners, seamHands, shambleWarp, twitch, undeadCounts, undeadEnvelope, undeadFrames, undeadShot,
  woundSchedule, type UndeadWound,
} from "./undeadPlan";

const CLEARANCE = 0.42;
/** Footfalls per square of a dead body's stride. */
const STRIDE = 2;
/** A strike lands about this far into an unauthored attack clip (pieces.ts playAttack's default for the ranks). */
const STRIKE_LANDS = 0.42;
/** How wide the hole a body climbs out of, or sinks into, opens. */
const HOLE = 0.24;

const point = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });

interface Dead {
  troop: RiteTroop;
  driver: TroopDriver;
  skin: UndeadSkin;
  look: TroopLook;
  head: THREE.Bone | null;
  spawn: Flat;
  slot: Slot | null;
  march: March;
  lurches: number;
  seed: number;
  /** When it sinks, and every moment it strikes at the victim (its wounds, and blows that open none). */
  sink: number;
  strikes: number[];
  struckIndex: number;
  sank: boolean;
}

class UndeadArmy implements RiteEffect {
  readonly object = new THREE.Group();
  readonly death = "burst" as const;
  readonly ready = Promise.resolve();
  readonly strikeAt = UNDEAD_TIMING.strike;
  readonly duration = UNDEAD_TIMING.done;

  private readonly dead: Dead[] = [];
  private readonly victim: Flat;
  private readonly wounds: UndeadWound[];
  private readonly scar: GroundScar;
  private readonly plates: SlabField;
  private readonly hands: SeamHands;
  private readonly eyes: GlowPoints;
  private readonly sparks: ParticlePool;
  private readonly grit: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly chains: LightningStrike | null;
  private readonly seamArcs: LightningStrike | null;
  private readonly frames: Point[][];
  private readonly skinLook: UndeadSkinLook;
  private readonly sounds: { at: number; cue: string; where: Point; volume: number; sent: boolean }[] = [];
  private readonly holes: { x: number; z: number; radius: number; open: number }[] = [];
  private readonly chainCount: number;
  private readonly seamCount: number;
  private readonly chest = new THREE.Vector3();
  private readonly headAt = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly glowAt = new THREE.Vector3();
  private time = 0;
  private gain = 1;
  private nextWound = 0;
  private chainTick = -1;
  private seamTick = -1;
  private killer: Flat | null = null;

  constructor(private readonly cast: RiteCast) {
    const { seed, boardTop, tile, quality, look, violence } = cast;
    const random = dice(seed ^ 0xdead);
    const half = 4 * tile;
    const T = UNDEAD_TIMING;
    this.object.name = "UndeadArmyRite";
    this.victim = { x: cast.stone.x, z: cast.stone.z };
    const viewer = { x: cast.viewer.x, z: cast.viewer.z };
    const counts = undeadCounts(quality);
    this.chainCount = counts.chains; this.seamCount = counts.seamArcs;
    this.skinLook = { arc: look.flame, hot: look.core, verdigris: 0x2f5a4c, rust: 0x5a2e18, bone: 0xcfc2a4 };
    const torn = UNDEAD_TORN[violence];

    // where they come up: the corners between the squares, round the victim
    const spawns = seamCorners({ centre: this.victim, standing: cast.standing, count: counts.troops, inner: 1.05, outer: 2.25, clearance: CLEARANCE, spacing: 0.7, tile, seed, favour: { x: viewer.x - this.victim.x, z: viewer.z - this.victim.z } });
    const slots = planSlots({ centre: this.victim, standing: cast.standing, count: spawns.length, radii: [0.6, 0.95], clearance: CLEARANCE * 0.92, spacing: 0.4, bounds: half - 0.25, seed });
    const assigned = assignSlots(spawns, slots, this.victim);
    const kinds = spawns.map((_, i) => (i % 4 === 2 ? "n" : "p") as "p" | "n");
    const pawns = cast.muster("p", kinds.filter((k) => k === "p").length), knights = cast.muster("n", kinds.filter((k) => k === "n").length);
    const obstacles: Obstacle[] = [...cast.standing, { ...this.victim, keep: 0.57 }];
    spawns.forEach((spawn, i) => {
      const troop = kinds[i] === "n" ? knights.shift() : pawns.shift();
      if (!troop) return;
      const slot = assigned[i] >= 0 ? slots[assigned[i]] : null;
      const path = slot ? findPath(spawn, slot.at, { obstacles, clearance: CLEARANCE, bounds: half - 0.25 }) : [spawn];
      const k = spawns.length > 1 ? i / (spawns.length - 1) : 0;
      const march = planMarch(path, {
        riseAt: T.rise.from + T.rise.spread * (0.6 * k + 0.4 * random()), riseFor: T.rise.length, settle: 0.08,
        arriveAt: T.arrive.first + T.arrive.spread * random(), top: SHAMBLE.top, shape: STEADY, least: SHAMBLE.least, most: SHAMBLE.most,
      });
      const skin = undeadSkin(this.skinLook, seed + i * 37, torn);
      const lookSwap = new TroopLook(troop.object, (original, mesh) => undeadMaterial(original, skin, unitOf(mesh)));
      troop.object.visible = false;
      this.dead.push({
        troop, driver: new TroopDriver(troop), skin, look: lookSwap, head: findBone(troop.object, "head"), spawn, slot, march,
        lurches: Math.max(2, Math.round(march.length / 0.45)), seed: seed + i * 37, sink: T.sink.from + T.sink.spread * random(), strikes: [], struckIndex: 0, sank: false,
      });
    });

    // every wound, and who deals it; the others strike too, at nothing that bleeds
    this.wounds = woundSchedule(violence, quality, this.dead.map((d) => d.march.arriveAt), seed);
    for (const wound of this.wounds) this.dead[wound.by]?.strikes.push(wound.at);
    this.dead.forEach((d) => {
      // a blow every so often while it stands at the victim, between its wounds
      for (let t = d.march.arriveAt + 0.15 + random() * 0.3; t < Math.min(d.sink, T.feed) - 0.3; t += 0.75 + 0.35 * random()) if (!d.strikes.some((s) => Math.abs(s - t) < 0.5)) d.strikes.push(t);
      d.strikes.sort((a, b) => a - b);
    });

    // the stone: seams split with current from the victim's square, holes the dead come through
    this.scar = new GroundScar({ look: { hot: look.core, glow: look.flame, dark: 0x030305 }, centre: { x: this.victim.x, y: boardTop, z: this.victim.z }, size: T.seamReach + 0.6, tile, board: half, seed, radial: false });
    this.object.add(this.scar.object);
    this.plates = new SlabField(this.dead.flatMap((d, i) => cornerPlates(d.spawn, tile, d.march.riseAt, d.march.riseFor, seed + i * 11, cast.standing, 0.55)), { light: 0xd8cfbe, dark: 0x2c2e35, glow: look.flame }, boardTop);
    this.object.add(this.plates.object);
    // and the dead who never get out, reaching up through the split seams
    const keepOut = [...this.dead.map((d) => d.spawn), ...this.dead.map((d) => d.slot?.at ?? d.spawn), this.victim];
    this.hands = new SeamHands(seamHands({ centre: this.victim, standing: cast.standing, keepOut, count: cast.brief ? 0 : crowdBudget(quality).extras, tile, seed }), { skin: 0x5c6258, arc: look.flame, hot: look.core }, boardTop);
    this.object.add(this.hands.object);

    // sparks spat out of the holes as they open and off the victim as it is torn; grit and smoke where they climb
    const sparks: Particle[] = [], grit: Particle[] = [], smoke: Particle[] = [];
    const perHole = Math.floor((counts.sparks * 0.6) / Math.max(1, this.dead.length));
    const gritEach = Math.floor(counts.grit / Math.max(1, this.dead.length)), smokeEach = Math.max(1, Math.floor(counts.smoke / Math.max(1, this.dead.length)));
    for (const d of this.dead) {
      for (let k = 0; k < perHole; k += 1) {
        const way = scatter(random, 0.2, 1), speed = between(random, 1.5, 4.5);
        sparks.push({ kind: PARTICLE_KIND.streak, origin: { x: d.spawn.x, y: boardTop + 0.03, z: d.spawn.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: d.march.riseAt + random() * 0.5, life: between(random, 0.25, 0.6), size: between(random, 0.01, 0.02), drag: 1.6, gravity: 5, tone: between(random, 0.6, 1) });
      }
      for (let k = 0; k < gritEach; k += 1) {
        const turn = random() * Math.PI * 2, out = between(random, 0.3, 1.2);
        grit.push({ kind: PARTICLE_KIND.puff, origin: { x: d.spawn.x + Math.cos(turn) * 0.1, y: boardTop + 0.05, z: d.spawn.z + Math.sin(turn) * 0.1 }, velocity: { x: Math.cos(turn) * out, y: between(random, 0.3, 1.0), z: Math.sin(turn) * out }, birth: d.march.riseAt + random() * 0.4, life: between(random, 0.6, 1.2), size: between(random, 0.05, 0.11), drag: 2.5, gravity: 0.8, tone: random(), grow: 2.2, fadeIn: 0.05 });
      }
      for (let k = 0; k < smokeEach; k += 1) {
        const at = k % 2 === 0 ? d.spawn : d.slot?.at ?? d.spawn, when = k % 2 === 0 ? d.march.riseAt + random() * 0.8 : d.sink + random() * 0.7;
        smoke.push({ kind: PARTICLE_KIND.puff, origin: { x: at.x + (random() - 0.5) * 0.15, y: boardTop + 0.05, z: at.z + (random() - 0.5) * 0.15 }, velocity: { x: (random() - 0.5) * 0.15, y: between(random, 0.25, 0.6), z: (random() - 0.5) * 0.15 }, birth: when, life: between(random, 1.2, 2.0), size: between(random, 0.12, 0.2), drag: 0.9, gravity: -0.08, tone: random() * 0.6, grow: 2.6, fadeIn: 0.15, wander: 0.1 });
      }
    }
    // sparks off the victim as it is torn: electric, not blood (blood is the gore system's)
    for (const wound of this.wounds) for (let k = 0; k < Math.round(counts.sparks * 0.4 / Math.max(1, this.wounds.length)); k += 1) {
      const way = scatter(random, -0.2, 1), speed = between(random, 1.5, 4);
      sparks.push({ kind: PARTICLE_KIND.streak, origin: { x: this.victim.x, y: boardTop + 0.6, z: this.victim.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed }, birth: wound.at + random() * 0.05, life: between(random, 0.2, 0.5), size: between(random, 0.009, 0.018), drag: 1.8, gravity: 4, tone: between(random, 0.7, 1) });
    }
    this.sparks = new ParticlePool({ particles: sparks, capacity: counts.sparks, look: { hot: look.core, mid: look.ember, cool: look.flame }, blend: "add", floor: boardTop, seed: seed ^ 0x5a4c, renderOrder: 15 });
    this.grit = new ParticlePool({ particles: grit, capacity: counts.grit, look: { hot: 0xbdb3a4, mid: 0x7a7268, cool: 0x3a3632 }, blend: "cover", floor: boardTop, seed: seed ^ 0x6e17, opacity: 0.7, renderOrder: 10 });
    this.smoke = new ParticlePool({ particles: smoke, capacity: counts.smoke, look: { hot: 0x6a6480, mid: 0x3a3646, cool: 0x18161e }, blend: "cover", floor: boardTop, seed: seed ^ 0x5307, opacity: 0.45, renderOrder: 9 });
    this.object.add(this.smoke.object, this.grit.object, this.sparks.object);

    this.eyes = new GlowPoints(this.dead.length * 2, { core: look.core, glow: look.flame });
    this.object.add(this.eyes.object);
    this.chains = counts.chains > 0 && !cast.brief ? new LightningStrike({ capacity: counts.chains * channelCapacity(5, 1, 2), look: { core: look.core, glow: look.flame }, width: 0.018, halo: 5, order: 14 }) : null;
    this.seamArcs = counts.seamArcs > 0 && !cast.brief ? new LightningStrike({ capacity: counts.seamArcs * channelCapacity(4, 1, 2), look: { core: look.core, glow: look.flame }, width: 0.014, halo: 5, order: 13 }) : null;
    if (this.chains) this.object.add(this.chains.object);
    if (this.seamArcs) this.object.add(this.seamArcs.object);

    this.frames = undeadFrames({ queen: cast.queen, victim: { x: this.victim.x, y: boardTop, z: this.victim.z }, spawns: this.dead.map((d) => d.spawn), boardTop })
      .map((frame) => clearFrame(frame, { standing: cast.standing, viewer: cast.viewer, boardTop, subject: [{ x: this.victim.x, y: boardTop + 0.35, z: this.victim.z }, { x: this.victim.x, y: boardTop + 0.9, z: this.victim.z }] }));

    const at = (p: Flat, y = 0.3): Point => ({ x: p.x, y: boardTop + y, z: p.z });
    const cue = (time: number, name: string, where: Point, volume = 1) => this.sounds.push({ at: time, cue: `rite.undead.${name}`, where, volume, sent: false });
    cue(0.02, "split", at(this.victim, 0)); cue(0.12, "arc", at(this.victim, 0.1), 0.8); cue(T.rise.from, "rise", at(this.victim), 1);
    cue(T.rise.from + 0.5, "groan", at(this.victim, 0.8), 0.8); cue(T.arrive.first - 0.6, "shamble", at(this.victim), 0.8);
    cue(T.strike, "rend", at(this.victim, 0.7), 1.1); cue(T.sink.from, "sink", at(this.victim, 0.2), 0.9); cue(T.dim + 0.3, "close", at(this.victim, 0), 0.7);

    this.apply(0, null, 0, 0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): RiteState {
    const step = Math.max(0, seconds);
    this.time += step;
    return this.apply(this.time, camera, height, step);
  }

  private apply(t: number, camera: THREE.PerspectiveCamera | null, height: number, step: number): RiteState {
    const { cast } = this;
    const T = UNDEAD_TIMING, top = cast.boardTop;
    const env = undeadEnvelope(t, cast.seed, cast.brief);
    const sounds: RiteSound[] = [], wounds: RiteWound[] = [];

    let eye = 0;
    this.holes.length = 0;
    for (const d of this.dead) {
      const h = d.troop.height, { march } = d;
      // the shamble: the same way and the same arrival, covered in lurches
      const span = march.arriveAt - march.departAt, u = span > 0 ? (t - march.departAt) / span : 1;
      const warped = u > 0 && u < 1 ? march.departAt + span * shambleWarp(u, d.lurches) : t;
      const state = marchState(march, warped);
      const sinking = Math.max(0, Math.min(1, (t - d.sink) / T.sink.length));
      // its hole: where it climbs out, then where it sinks
      const rising = t >= march.riseAt - 0.1 && t < march.riseAt + march.riseFor + 0.6;
      if (rising) this.holes.push({ x: d.spawn.x, z: d.spawn.z, radius: HOLE, open: smoothstep(march.riseAt - 0.1, march.riseAt + 0.12, t) * (1 - smoothstep(march.riseAt + march.riseFor + 0.15, march.riseAt + march.riseFor + 0.6, t)) });
      else if (t >= d.sink - 0.05) { const at = d.slot?.at ?? d.spawn; this.holes.push({ x: at.x, z: at.z, radius: HOLE * 1.2, open: smoothstep(d.sink - 0.05, d.sink + 0.15, t) * (1 - smoothstep(d.sink + T.sink.length, d.sink + T.sink.length + 0.5, t)) }); }
      if (state.phase === "hidden" || sinking >= 1) { d.driver.show(false); continue; }
      d.driver.show(true);
      const haul = haulRise(state.risen);
      // the fall under the stone is slow at first and then gives way
      const y = top - (1 - haul) * h * 1.05 - sinking * sinking * h * 1.15;
      const facing = state.phase === "arrived" ? d.slot?.facing ?? toward(state.at, this.victim) : state.phase === "walking" || state.phase === "running" ? state.heading : toward(state.at, this.victim);
      d.driver.place(state.at, y, facing, step, 7);
      // hunched, rolling with each lurch, twitching; pitched over the lip of the hole while it climbs
      const surge = u > 0 && u < 1 ? Math.cos(2 * Math.PI * d.lurches * u) : 0;
      const climb = state.phase === "rising" ? 0.6 * (1 - haul) : 0;
      d.driver.lean(0.2 + climb + 0.08 * surge + (sinking > 0 ? 0.3 * sinking : 0), 0.1 * Math.sin(t * 5.3 + d.seed) + 0.06 * surge, twitch(t, d.seed));
      // its clips: clawing up out of the hole, a stride retimed with every lurch, blows at the victim, and a fall
      if (sinking > 0) { if (!d.sank) { d.sank = true; d.driver.once("death"); } }
      else if (state.phase === "rising") d.driver.loop("walk", 0.9, t);
      else if (state.phase === "waiting") d.driver.loop("idle", 1, t);
      else if (state.phase === "walking" || state.phase === "running") d.driver.loop("walk", Math.max(0.8, (state.speed / cast.tile) * STRIDE) * (surge < 0 ? 1.6 : 0.6), t);
      else {
        // at the victim: each blow is begun so that it lands on its moment
        const next = d.strikes[d.struckIndex];
        if (next !== undefined && t >= next - STRIKE_LANDS * 0.95) { d.struckIndex += 1; d.driver.once("attack"); }
        else if (d.driver.playing !== "attack") d.driver.loop("idle", 1, t);
      }
      setUndeadSkin(d.skin, { time: t, cut: top - 0.002, cutGlow: state.phase === "rising" ? 1 : sinking > 0 ? 1 : 0, veins: env.flicker * (1 - sinking), fade: 1, gain: this.gain });
      eye = this.setEyes(d, eye, Math.min(1, state.risen * 2) * (1 - sinking) * env.flicker);
    }
    this.eyes.hideFrom(eye);
    this.scar.setHoles(this.holes);

    // the wounds, each from the one who deals it
    while (this.nextWound < this.wounds.length && t >= this.wounds[this.nextWound].at) {
      const wound = this.wounds[this.nextWound++], by = this.dead[wound.by];
      const chest = cast.chest(this.chest);
      const from = by ? by.troop.object.position : this.chest;
      const back = toward({ x: chest.x, z: chest.z }, { x: from.x, z: from.z });
      const random = dice(cast.seed * 31 + this.nextWound * 977);
      const at = { x: chest.x + back.x * 0.1, y: chest.y + (random() - 0.4) * 0.3, z: chest.z + back.z * 0.1 };
      const direction = { x: back.x * 0.65 + (random() - 0.5) * 0.5, y: 0.45 + 0.4 * random(), z: back.z * 0.65 + (random() - 0.5) * 0.5 };
      // They tear with their hands, and some of them with their teeth.
      wounds.push({ at, direction, power: wound.power, kind: !wound.kills && random() < 0.3 ? "bite" : "tear" });
      sounds.push({ cue: "rite.undead.tear", at, volume: Math.min(1, 0.5 + 0.3 * wound.power) });
      if (wound.kills) this.killer = { x: from.x, z: from.z };
    }
    // with no wound to deal it (Minimal), the blow is the first to have reached the victim's; with nobody lent, it
    // comes from the player's side
    const struck = t >= T.strike;
    if (struck && !this.killer) {
      const first = [...this.dead].sort((a, b) => a.march.arriveAt - b.march.arriveAt)[0];
      this.killer = first ? { x: first.troop.object.position.x, z: first.troop.object.position.z } : { x: this.victim.x + (cast.viewer.x - this.victim.x) * 0.1, z: this.victim.z + (cast.viewer.z - this.victim.z) * 0.1 };
    }

    // the current: from corpse to corpse, and along the seams
    if (camera) {
      this.sparks.update(t, camera, height); this.grit.update(t, camera, height); this.smoke.update(t, camera, height);
      this.eyes.commit(camera, height);
      this.chains?.fit(camera, height); this.seamArcs?.fit(camera, height);
    }
    this.smoke.setLight({ x: this.victim.x, y: top + 0.4, z: this.victim.z }, cast.look.flame, 0.8 * env.seams);
    if (this.chains) {
      const tick = Math.floor(t * 14);
      const live = t > T.rise.from + 0.4 && t < T.sink.from + 0.5;
      if (live && tick !== this.chainTick) { this.chainTick = tick; this.chains.setChannel(this.corpseChain(tick)); }
      const bright = live ? (0.55 + 0.45 * ((tick * 5) % 3) / 2) * env.flicker : 0;
      this.chains.set({ head: 1, bright, forks: bright * 0.6, swell: 0.5 });
    }
    if (this.seamArcs) {
      const tick = Math.floor(t * 12);
      const live = env.seams > 0.2 && t < T.dim;
      if (live && tick !== this.seamTick) { this.seamTick = tick; this.seamArcs.setChannel(this.seamChannel(tick, env.seamFront)); }
      const bright = live ? env.seams * (0.5 + 0.5 * ((tick * 7) % 4) / 3) : 0;
      this.seamArcs.set({ head: 1, bright, forks: bright, swell: 0.5 });
    }

    // the stone
    this.scar.set(t, { since: -1, front: 0, reach: 1, heat: 0, left: env.scar, flash: 0, seams: env.seams, seamFront: env.seamFront });
    this.plates.update(t, 0.6 * env.seams);
    this.hands.update(t);

    for (const sound of this.sounds) if (!sound.sent && t >= sound.at) { sound.sent = true; sounds.push({ cue: sound.cue, at: sound.where, volume: sound.volume }); }

    const glow = env.light > 0.01 ? { position: point(this.glowAt.set(this.victim.x, top + 0.6, this.victim.z)), colour: cast.look.light, intensity: env.light, reach: 5 } : null;
    const shot = undeadShot(t);
    return {
      struck, blow: struck && this.killer ? { from: { x: this.killer.x, y: top + 0.6, z: this.killer.z }, power: cast.violence === "full" ? 1.6 : 1.1 } : null,
      hold: null, released: false, done: env.done, wounds, sounds, shake: cast.brief ? 0 : env.shake, glow, shot, frame: this.frames[shot],
    };
  }

  private setEyes(d: Dead, index: number, bright: number): number {
    const object = d.troop.object;
    if (d.head) d.head.getWorldPosition(this.headAt);
    else this.headAt.copy(object.position).setY(object.position.y + d.troop.height * 0.88);
    const yaw = d.driver.yaw, front = d.driver.front;
    const fx = front * Math.sin(yaw), fz = front * Math.cos(yaw), rx = -fz, rz = fx;
    for (const side of [-1, 1]) {
      this.eye.set(this.headAt.x + fx * 0.07 + rx * side * 0.028, this.headAt.y + 0.015, this.headAt.z + fz * 0.07 + rz * side * 0.028);
      this.eyes.set(index, this.eye, 0.022, Math.max(0, bright) * 1.8, 0.25);
      index += 1;
    }
    return index;
  }

  /** Arcs between neighbouring corpses, chest to chest. */
  private corpseChain(tick: number): Channel {
    const { cast } = this, random = dice(cast.seed * 3 + tick * 71), channels: Channel[] = [];
    const shown = this.dead.filter((d) => d.troop.object.visible && d.troop.object.position.y > cast.boardTop - d.troop.height * 0.5);
    const chest = (d: Dead) => ({ x: d.troop.object.position.x, y: d.troop.object.position.y + d.troop.height * (0.45 + 0.2 * random()), z: d.troop.object.position.z });
    for (let i = 0; i < Math.min(this.chainCount, shown.length); i += 1) {
      const a = shown[Math.floor(random() * shown.length)];
      let best: Dead | null = null, bestD = Infinity;
      for (const b of shown) {
        if (b === a) continue;
        const d = Math.hypot(b.troop.object.position.x - a.troop.object.position.x, b.troop.object.position.z - a.troop.object.position.z) * (0.8 + 0.4 * random());
        if (d < bestD) { bestD = d; best = b; }
      }
      if (!best || bestD > 2.2) continue;
      channels.push(solveChannel(cast.seed + tick * 71 + i * 13, chest(a), chest(best), { levels: 5, jag: 0.24, forks: 1, forkLevels: 2 }));
    }
    // and into the victim while they tear at it
    if (this.time > UNDEAD_TIMING.arrive.first && this.time < UNDEAD_TIMING.feed && shown.length) {
      const a = shown[Math.floor(random() * shown.length)], c = cast.chest(this.chest);
      channels.push(solveChannel(cast.seed + tick * 71 + 999, chest(a), point(c), { levels: 5, jag: 0.24, forks: 1, forkLevels: 2 }));
    }
    return channels.length ? mergeChannels(channels.slice(0, this.chainCount)) : { points: new Float32Array(0), strips: [], length: 0 };
  }

  /** Short arcs crawling along the seams the current has reached. */
  private seamChannel(tick: number, front: number): Channel {
    const { cast } = this, random = dice(cast.seed * 5 + tick * 53), channels: Channel[] = [];
    const tile = cast.tile, top = cast.boardTop + 0.012;
    for (let i = 0; i < this.seamCount; i += 1) {
      const r = random() * Math.max(0.4, front * 0.9), turn = random() * Math.PI * 2;
      const cx = Math.round((this.victim.x + Math.cos(turn) * r) / tile) * tile, cz = Math.round((this.victim.z + Math.sin(turn) * r) / tile) * tile;
      const along = random() < 0.5, length = (0.35 + 0.5 * random()) * (random() < 0.5 ? -1 : 1);
      const from = { x: cx, y: top, z: cz }, to = along ? { x: cx + length, y: top, z: cz } : { x: cx, y: top, z: cz + length };
      if (Math.abs(to.x) > 4 * tile || Math.abs(to.z) > 4 * tile) continue;
      channels.push(solveChannel(cast.seed + tick * 53 + i * 7, from, to, { levels: 4, jag: 0.08, forks: 1, forkLevels: 2, floor: cast.boardTop }));
    }
    return channels.length ? mergeChannels(channels) : { points: new Float32Array(0), strips: [], length: 0 };
  }

  setGain(gain: number): void {
    this.gain = gain;
    this.scar.setGain(gain); this.plates.setGain(gain); this.hands.setGain(gain); this.eyes.setGain(gain); this.sparks.setGain(gain); this.grit.setGain(gain); this.smoke.setGain(gain);
    this.chains?.setGain(gain); this.seamArcs?.setGain(gain);
  }

  dispose(): void {
    for (const d of this.dead) { d.look.dispose(); d.troop.object.visible = false; }
    this.scar.dispose(); this.plates.dispose(); this.hands.dispose(); this.eyes.dispose(); this.sparks.dispose(); this.grit.dispose(); this.smoke.dispose();
    this.chains?.dispose(); this.seamArcs?.dispose();
    this.object.removeFromParent();
  }
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function toward(from: Flat, to: Flat): Flat {
  const x = to.x - from.x, z = to.z - from.z, length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
}

/** One over a mesh's own height in its own units: the figures are sculpted at different scales. */
function unitOf(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = box ? Math.max(box.max.y - box.min.y, box.max.x - box.min.x, box.max.z - box.min.z) : 1;
  return size > 1e-6 ? 1 / size : 1;
}

/** Makes Kwind-09's summons for one capture. */
export function makeUndeadArmy(cast: RiteCast): RiteEffect {
  return new UndeadArmy(cast);
}

/** The entry for the match's table of rites. */
export const UNDEAD_RITE: RiteEntry = { id: "kwind09.queen.undead-army", name: "The undead army", army: "kwind", make: makeUndeadArmy };
