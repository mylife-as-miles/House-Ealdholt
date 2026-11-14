// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Korvenia's summons: the shadow army, as a rite the match can play (rites/rite.ts).
 *
 * shadow/shadowPlan.ts is its clock and its budget, armies/crowdPlan.ts the march of its soldiers between the
 * pieces, armies/groundPlan.ts what the blow does to the stone. This draws it and moves the borrowed figures:
 *
 *   the seal       a clockwork seal written on the stone behind the victim (shadow/seal.ts), fog pouring out of it
 *   the army       the Queen's own fusiliers and cuirassiers, risen out of the stone as shadows (shadow/shadowLook.ts),
 *                  smoke trailing them, gold in their eyes; more of them standing back in the fog as outlines
 *   the colossus   one of her cuirassiers, four times a man's height, climbing out of the seal and
 *                  bringing its sabre down on the victim
 *   the blow       violet lightning, the stone cracking out from the blow behind a front, slabs heaved up and
 *                  dropped back, stone thrown out, dust rolling across the board (armies/ground.ts and the kit)
 *   the leaving    the colossus sinks back through the seal, the soldiers burn away upward in violet, the board heals
 *
 * The piece dies torn apart at Full, thrown down at Cinematic, by its own fall at Minimal (`burst`). The soldiers'
 * blades are shadow and draw no blood; the colossus's blow is the one wound.
 */
import * as THREE from "three";
import type { Point } from "../../vfx/mystic/beamPlan";
import { LightningStrike } from "../../vfx/spells/shared/lightning";
import { channelCapacity, mergeChannels, solveChannel, strikeState, strikeTimeline, type Channel, type StrikeTimeline } from "../../vfx/spells/shared/lightningPlan";
import { ParticlePool } from "../../vfx/spells/shared/particles";
import { PARTICLE_KIND, between, scatter, type Particle } from "../../vfx/spells/shared/particlePlan";
import { SolidField } from "../../vfx/spells/shared/solids";
import { chunkGeometry, type Solid } from "../../vfx/spells/shared/solidPlan";
import { MARCH_THEN_CHARGE, dice, marchState, planCharge, planSpawns, type Charger, type Flat, type Obstacle } from "../armies/crowdPlan";
import { GlowPoints } from "../armies/glow";
import { GroundScar, SlabField } from "../armies/ground";
import { frontRadius, planSlabs } from "../armies/groundPlan";
import { clearFrame } from "../armies/shotPlan";
import { TroopDriver, TroopLook, findBone } from "../armies/troops";
import type { RiteCast, RiteEffect, RiteEntry, RiteSound, RiteState, RiteTroop, RiteWound } from "../rite";
import { GroundFog } from "./fog";
import { ClockworkSeal } from "./seal";
import { setShadowSkin, shadowMaterial, shadowSkin, type ShadowSkin, type ShadowSkinLook } from "./shadowLook";
import { SilhouetteRanks } from "./silhouettes";
import {
  SHADOW_BLAST, SHADOW_BRASS, SHADOW_FOG, SHADOW_GASLIGHT, SHADOW_GOLD, SHADOW_GOLD_HOT, SHADOW_TIMING, burnt, colossusPose, placeColossus, recoil,
  shadowCounts, shadowEnvelope, shadowFrames, shadowShot, soldierBeats, type SoldierBeat,
} from "./shadowPlan";

/** How much taller than a man the colossus stands, and how deep in the seal it stands once it is up. */
const COLOSSUS_SCALE = 4.2;
const COLOSSUS_SUNK = 0.36;
/** Footfalls per square of a soldier's stride (the match's GAITS for a Pawn and a Knight). */
const STRIDE: Record<"p" | "n", number> = { p: 2, n: 2 };
/** How near a piece standing a soldier may come, and how wide a berth the colossus is given. */
const CLEARANCE = 0.42;
const COLOSSUS_BERTH = 1.15;

const point = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });
const ease = (u: number) => 1 - (1 - u) * (1 - u) * (1 - u);
const smoothstep = (from: number, to: number, value: number) => { const u = Math.min(1, Math.max(0, (value - from) / (to - from))); return u * u * (3 - 2 * u); };

interface Soldier {
  troop: RiteTroop;
  kind: "p" | "n";
  driver: TroopDriver;
  skin: ShadowSkin;
  look: TroopLook;
  head: THREE.Bone | null;
  charger: Charger;
  beat: SoldierBeat;
  thrusted: boolean;
}

class ShadowArmy implements RiteEffect {
  readonly object = new THREE.Group();
  readonly death = "burst" as const;
  readonly ready = Promise.resolve();
  readonly strikeAt = SHADOW_TIMING.strike;
  readonly duration = SHADOW_TIMING.done;

  private readonly soldiers: Soldier[] = [];
  private readonly colossus: (Soldier & { height: number }) | null = null;
  private readonly seal: ClockworkSeal;
  private readonly sealAt: Flat;
  private readonly sealFacing: Flat;
  private readonly victim: Flat;
  private readonly fog: ParticlePool;
  private readonly groundFog: GroundFog;
  private readonly smoke: ParticlePool | null;
  private readonly embers: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly ranks: SilhouetteRanks | null = null;
  private readonly eyes: GlowPoints;
  /** Gas lamps standing round the seal's rim, guttering. */
  private readonly lamps: GlowPoints;
  private readonly lampAt: THREE.Vector3[] = [];
  private readonly scar: GroundScar;
  private readonly slabs: SlabField;
  private readonly shrapnel: SolidField;
  private readonly bolts: { strike: LightningStrike; timeline: StrikeTimeline; from: Point; to: Point; path: number }[] = [];
  private readonly arcs: LightningStrike | null;
  private readonly frames: Point[][];
  private readonly standing: readonly Flat[];
  private readonly skinLook: ShadowSkinLook;
  private readonly sounds: { at: number; cue: string; where: Point; volume: number; sent: boolean }[] = [];
  private readonly glowAt = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly headAt = new THREE.Vector3();
  private time = 0;
  private gain = 1;
  private wounded = false;
  private arcTick = -1;

  constructor(private readonly cast: RiteCast) {
    const { seed, boardTop, tile, quality, look } = cast;
    const random = dice(seed ^ 0x5ad0a);
    const half = 4 * tile;
    this.object.name = "ShadowArmyRite";
    this.victim = { x: cast.stone.x, z: cast.stone.z };
    this.standing = cast.standing;
    const viewer = { x: cast.viewer.x, z: cast.viewer.z };
    const counts = shadowCounts(quality);
    const T = SHADOW_TIMING;
    this.skinLook = { body: 0x020104, rim: look.flame, edge: look.flame, hot: SHADOW_GOLD_HOT };

    // where the seal opens, and the colossus with it
    const spot = placeColossus({ victim: this.victim, viewer, standing: cast.standing, half, tile });
    this.sealAt = spot.at; this.sealFacing = spot.facing;
    this.seal = new ClockworkSeal({ x: spot.at.x, y: boardTop, z: spot.at.z }, spot.radius, { brass: SHADOW_BRASS, gold: SHADOW_GOLD, hot: SHADOW_GOLD_HOT, violet: look.flame }, seed);
    this.object.add(this.seal.object);

    // the army's charge, round the pieces and round the colossus's column
    const avoid: Obstacle[] = [...cast.standing, { ...spot.at, keep: COLOSSUS_BERTH }];
    const plan = planCharge({
      victim: this.victim, standing: avoid, viewer, count: counts.fusiliers + counts.cuirassiers, seed, half,
      spawn: { inner: 1.45, outer: 2.75, favourWeight: 0.45, avoid: [{ at: spot.at, radius: spot.radius * 0.95 }] },
      ring: { radii: [0.62, 0.98], spacing: 0.4 }, clearance: CLEARANCE, spacing: 0.48,
      rise: T.rise, arrive: T.arrive, gait: { top: 2.9, shape: MARCH_THEN_CHARGE, least: 0.55, most: 1.5 },
    });
    // the cuirassiers among them: every third, from the nearest
    const wantCuirassiers = Math.min(counts.cuirassiers, Math.floor((plan.length + 1) / 3));
    const kinds = plan.map((_, i) => (i % 3 === 1 && i / 3 < wantCuirassiers ? "n" : "p") as "p" | "n");
    const fusiliers = cast.muster("p", kinds.filter((k) => k === "p").length), cuirassiers = cast.muster("n", kinds.filter((k) => k === "n").length);
    const beats = soldierBeats(plan.map((c) => c.march.arriveAt), seed);
    plan.forEach((charger, i) => {
      const troop = kinds[i] === "n" ? cuirassiers.shift() : fusiliers.shift();
      if (troop) this.soldiers.push(this.enlist(troop, kinds[i], charger, beats[i], seed + i * 31, 1.1));
    });

    // the colossus: a cuirassier, scaled, standing in the seal
    const [giant] = cast.muster("n", 1);
    if (giant) {
      giant.object.scale.setScalar(COLOSSUS_SCALE);
      const charger: Charger = { spawn: spot.at, slot: null, near: 0, march: { path: [spot.at], length: 0, riseAt: T.colossus, riseFor: 0, departAt: T.colossus, arriveAt: T.colossus, top: 0, shape: MARCH_THEN_CHARGE, charge: 0 } };
      this.colossus = { ...this.enlist(giant, "n", charger, { thrust: T.windup, burn: Infinity }, seed ^ 0xc0105, 1.6), height: giant.height * COLOSSUS_SCALE };
    }

    // gaslit fog out of the seal and where the soldiers rise, smoke on their heels, embers as they burn
    const fog: Particle[] = [];
    for (let i = 0; i < counts.fog; i += 1) {
      // most of it pours out of the seal; the rest lies where the soldiers rise, and drifts across the board
      const fromSeal = i % 2 === 0 || this.soldiers.length === 0;
      const where = fromSeal ? spot.at : this.soldiers[i % this.soldiers.length].charger.spawn;
      const turn = random() * Math.PI * 2, r = (fromSeal ? spot.radius * 0.8 : 0.35) * Math.sqrt(random()), out = fromSeal ? between(random, 0.5, 1.2) : between(random, 0.15, 0.45);
      fog.push({
        kind: PARTICLE_KIND.puff, origin: { x: where.x + Math.cos(turn) * r, y: boardTop + between(random, 0.05, 0.18), z: where.z + Math.sin(turn) * r },
        velocity: { x: Math.cos(turn) * out, y: 0.015, z: Math.sin(turn) * out }, birth: T.fog + (fromSeal ? random() * 2.2 : 0.2 + random() * 1.2), life: between(random, 2.8, 4.4),
        size: between(random, 0.28, 0.5), drag: 0.6, gravity: -0.01, tone: between(random, 0.55, 1), grow: 1.9, fadeIn: 0.2, wander: 0.25,
      });
    }
    // inky (SHADOW_FOG): only the gaslight near the seal lights it
    this.fog = new ParticlePool({ particles: fog, capacity: counts.fog, look: { hot: SHADOW_FOG.hot, mid: SHADOW_FOG.mid, cool: SHADOW_FOG.cool }, blend: "cover", floor: boardTop, seed: seed ^ 0xf06, opacity: 0.5, renderOrder: 9 });
    // and the fog lying over the board, poured out of the seal toward the victim and past it
    const middle = { x: (spot.at.x + this.victim.x) / 2, y: boardTop, z: (spot.at.z + this.victim.z) / 2 };
    this.groundFog = new GroundFog({ x: spot.at.x, y: boardTop, z: spot.at.z }, middle, 4.2, { fog: SHADOW_FOG.fog, deep: SHADOW_FOG.deep, gaslight: SHADOW_GASLIGHT, cover: SHADOW_FOG.cover });
    this.object.add(this.groundFog.object);
    this.object.add(this.fog.object);

    const smoke: Particle[] = [], embers: Particle[] = [];
    const perSoldier = Math.floor(counts.smoke / Math.max(1, this.soldiers.length));
    const embersEach = Math.floor((counts.embers * 0.75) / Math.max(1, this.soldiers.length + 2));
    for (const soldier of this.soldiers) {
      const { march } = soldier.charger, h = soldier.troop.height;
      const from = march.riseAt + march.riseFor * 0.5, to = soldier.beat.burn + 0.3;
      for (let k = 0; k < perSoldier; k += 1) {
        const t = from + ((k + random()) / perSoldier) * (to - from), at = marchState(march, t).at;
        smoke.push({
          kind: PARTICLE_KIND.puff, origin: { x: at.x + (random() - 0.5) * 0.18, y: boardTop + h * between(random, 0.15, 0.8), z: at.z + (random() - 0.5) * 0.18 },
          velocity: { x: (random() - 0.5) * 0.2, y: between(random, 0.08, 0.3), z: (random() - 0.5) * 0.2 }, birth: t, life: between(random, 0.7, 1.2),
          size: between(random, 0.11, 0.2), drag: 1.2, gravity: -0.05, tone: random() * 0.5, grow: 2.6, fadeIn: 0.15, wander: 0.08,
        });
      }
      const end = marchState(march, 99).at;
      for (let k = 0; k < embersEach; k += 1) {
        const u = random(), t = soldier.beat.burn + u * SHADOW_TIMING.burn.length;
        embers.push({
          kind: random() < 0.7 ? PARTICLE_KIND.mote : PARTICLE_KIND.streak, origin: { x: end.x + (random() - 0.5) * 0.25, y: boardTop + h * (0.05 + 0.95 * u), z: end.z + (random() - 0.5) * 0.25 },
          velocity: { x: (random() - 0.5) * 0.35, y: between(random, 0.5, 1.3), z: (random() - 0.5) * 0.35 }, birth: t, life: between(random, 0.6, 1.2),
          size: between(random, 0.012, 0.026), drag: 1.1, gravity: -0.35, tone: between(random, 0.5, 1), wander: 0.12,
        });
      }
    }
    this.smoke = smoke.length ? new ParticlePool({ particles: smoke, capacity: counts.smoke, look: { hot: 0x3c3150, mid: 0x1c1726, cool: 0x0b0910 }, blend: "cover", floor: boardTop, seed: seed ^ 0x5304e, opacity: 0.7, renderOrder: 10 }) : null;
    if (this.smoke) this.object.add(this.smoke.object);

    // the blow: sparks off the stone
    const stone = { x: this.victim.x, y: boardTop, z: this.victim.z };
    for (let i = 0; i < counts.sparks; i += 1) {
      const way = scatter(random, 0.15, 1), speed = between(random, 3, 7.5);
      embers.push({
        kind: PARTICLE_KIND.streak, origin: { x: stone.x, y: boardTop + 0.25, z: stone.z }, velocity: { x: way.x * speed, y: way.y * speed, z: way.z * speed },
        birth: T.strike + random() * 0.05, life: between(random, 0.35, 0.9), size: between(random, 0.012, 0.024), drag: 1.4, gravity: 6, tone: between(random, 0.6, 1),
      });
    }
    this.embers = new ParticlePool({ particles: embers, capacity: counts.embers + counts.sparks, look: { hot: SHADOW_GOLD_HOT, mid: look.ember, cool: 0x5a1fae }, blend: "add", floor: boardTop, seed: seed ^ 0xe3be5, renderOrder: 15 });
    this.object.add(this.embers.object);

    // dust rolling out across the board from the blow, and a plume over it
    const dust: Particle[] = [];
    for (let i = 0; i < counts.dust; i += 1) {
      const plume = i % 4 === 0, turn = random() * Math.PI * 2, out = plume ? between(random, 0.1, 0.4) : between(random, 2.2, 4);
      dust.push({
        kind: PARTICLE_KIND.puff, origin: { x: stone.x + Math.cos(turn) * 0.2, y: boardTop + 0.12, z: stone.z + Math.sin(turn) * 0.2 },
        velocity: { x: Math.cos(turn) * out, y: plume ? between(random, 1.2, 2.2) : between(random, 0.15, 0.5), z: Math.sin(turn) * out },
        birth: T.strike + random() * 0.12, life: between(random, 1.4, 2.4), size: between(random, 0.22, 0.4), drag: plume ? 1.6 : 2.3, gravity: -0.04,
        tone: between(random, 0.3, 0.8), grow: 2.6, fadeIn: 0.06, wander: 0.15,
      });
    }
    this.dust = new ParticlePool({ particles: dust, capacity: counts.dust, look: { hot: 0xd8cfc2, mid: 0x8d847a, cool: 0x46403b }, blend: "cover", floor: boardTop, seed: seed ^ 0xd057, opacity: 0.6, renderOrder: 11 });
    this.object.add(this.dust.object);

    // the ranks standing back in the fog
    if (counts.silhouettes > 0) {
      const keepOut = [...cast.standing, ...this.soldiers.map((s) => s.charger.spawn), ...this.soldiers.map((s) => s.charger.slot?.at ?? s.charger.spawn)];
      const places = planSpawns({ centre: this.victim, standing: keepOut, count: counts.silhouettes, inner: 2.4, outer: 4.6, clearance: 0.36, spacing: 0.4, bounds: half - 0.15, seed: seed ^ 0x51a, favour: { x: this.victim.x - viewer.x, z: this.victim.z - viewer.z }, favourWeight: 0.6, avoid: [{ at: spot.at, radius: spot.radius * 0.9 }] });
      const ranks = places.map((at, i) => ({ x: at.x, z: at.z, height: 0.8 * (0.92 + 0.16 * random()), seed: random() * 100, rise: 0.7 + 0.9 * random(), burn: T.burn.from + T.burn.spread * random(), sabre: i % 4 === 3 ? 1 : 0 }));
      this.ranks = new SilhouetteRanks(ranks, { body: 0x050409, rim: look.flame, eyes: SHADOW_GOLD, edge: look.flame }, boardTop);
      this.object.add(this.ranks.object);
    }

    // eyes of gold: two to a soldier, two to the colossus
    this.eyes = new GlowPoints((this.soldiers.length + 1) * 2, { core: SHADOW_GOLD_HOT, glow: SHADOW_GOLD });
    // six gas lamps on the seal's rim, as on the ring of an orrery: they catch as the pen passes them
    this.lamps = new GlowPoints(6, { core: SHADOW_GOLD_HOT, glow: SHADOW_GASLIGHT }, 12);
    for (let i = 0; i < 6; i += 1) { const turn = (i / 6) * Math.PI * 2 + 0.3; this.lampAt.push(new THREE.Vector3(spot.at.x + Math.cos(turn) * spot.radius * 1.02, boardTop + 0.07, spot.at.z - Math.sin(turn) * spot.radius * 1.02)); }
    this.object.add(this.lamps.object);
    this.object.add(this.eyes.object);

    // the stone: cracks out from the blow, and slabs heaved up off free stone
    this.scar = new GroundScar({ look: { hot: SHADOW_GOLD_HOT, glow: look.flame, dark: 0x050307 }, centre: stone, size: SHADOW_BLAST.reach + 0.4, tile, board: half, seed, radial: true });
    this.object.add(this.scar.object);
    const slabs = planSlabs({
      centre: this.victim, standing: [...cast.standing, ...this.soldiers.map((s) => s.charger.slot?.at ?? s.charger.spawn)], count: counts.slabs,
      inner: SHADOW_BLAST.inner, outer: SHADOW_BLAST.outer, clearance: 0.3, bounds: half - 0.05, tile, seed, blow: T.strike, reach: SHADOW_BLAST.reach, spread: SHADOW_BLAST.spread,
      height: cast.brief ? 0.2 : 0.6, avoid: [{ at: spot.at, radius: spot.radius * 0.75 }],
    });
    this.slabs = new SlabField(slabs, { light: 0xd8cfbe, dark: 0x2c2e35, glow: look.flame }, boardTop);
    this.object.add(this.slabs.object);

    // stone thrown out of the blow, hot in its cracks
    const solids: Solid[] = [];
    for (let i = 0; i < counts.shrapnel; i += 1) {
      const turn = random() * Math.PI * 2, out = between(random, 1.6, 4.2), r = between(random, 0.035, 0.09);
      solids.push({
        loose: true, root: { x: stone.x + Math.cos(turn) * 0.15, y: boardTop + 0.15, z: stone.z + Math.sin(turn) * 0.15 }, radius: r, height: r * 1.4,
        lean: { x: between(random, 4, 11), z: 0 }, spin: between(random, 4, 11), yaw: random() * 6.28, seed: random() * 100,
        birth: T.strike, rise: 0.5, breakAt: 0, end: T.strike + between(random, 2.2, 3.2), fling: { x: Math.cos(turn) * out, y: between(random, 1.8, 4.6), z: Math.sin(turn) * out },
      });
    }
    this.shrapnel = new SolidField({ solids, capacity: counts.shrapnel, shapes: [chunkGeometry(seed), chunkGeometry(seed + 1), chunkGeometry(seed + 2)], look: { deep: 0x141218, body: 0x58525e, rim: 0xffe2b8, glow: look.flame }, matter: "cinder", floor: boardTop, bounce: 0, crumble: false, creak: 0 });
    this.object.add(this.shrapnel.object);

    // lightning down the blade, and arcs running out along the cracks
    if (!cast.brief) {
      for (let i = 0; i < counts.bolts; i += 1) {
        const lean = i === 0 ? 0.35 : 0.2 + 0.5 * random();
        const from = { x: this.victim.x + (spot.at.x - this.victim.x) * lean + (random() - 0.5) * 0.8, y: boardTop + 5.5 + random() * 1.5, z: this.victim.z + (spot.at.z - this.victim.z) * lean + (random() - 0.5) * 0.8 };
        const turn = random() * Math.PI * 2, off = i === 0 ? 0 : between(random, 0.5, 1.4);
        const to = { x: this.victim.x + Math.cos(turn) * off, y: boardTop + (i === 0 ? 0.6 : 0.02), z: this.victim.z + Math.sin(turn) * off };
        const strike = new LightningStrike({ capacity: channelCapacity(6, 4, 3), look: { core: SHADOW_GOLD_HOT, glow: look.flame }, width: i === 0 ? 0.05 : 0.03, halo: 6, fadeIn: 0.25, order: 14 });
        const timeline = strikeTimeline(seed + i * 97, { leaderStart: T.strike - 0.12 + i * 0.05, connect: T.strike + i * 0.06, steps: 5, restrikes: i === 0 ? 4 : 2, gap: 0.09, keep: 2, afterglow: 0.45 });
        this.bolts.push({ strike, timeline, from, to, path: -1 });
        this.object.add(strike.object);
      }
    }
    this.arcs = counts.arcs > 0 && !cast.brief ? new LightningStrike({ capacity: counts.arcs * channelCapacity(4, 1, 2), look: { core: SHADOW_GOLD_HOT, glow: look.flame }, width: 0.022, halo: 5, order: 13 }) : null;
    if (this.arcs) this.object.add(this.arcs.object);

    // what the camera keeps in frame, beat by beat
    this.frames = shadowFrames({
      queen: cast.queen, victim: { x: this.victim.x, y: boardTop, z: this.victim.z }, seal: spot.at, spawns: this.soldiers.map((s) => s.charger.spawn),
      colossus: this.colossus ? this.colossus.height * (1 - COLOSSUS_SUNK) : 2.4, boardTop,
    }).map((frame) => clearFrame(frame, { standing: cast.standing, viewer: cast.viewer, boardTop, subject: [{ x: this.victim.x, y: boardTop + 0.35, z: this.victim.z }, { x: this.victim.x, y: boardTop + 0.9, z: this.victim.z }] }));

    // what it asks the match to sound
    const at = (p: Flat, y = 0.4): Point => ({ x: p.x, y: boardTop + y, z: p.z });
    const cue = (time: number, name: string, where: Point, volume = 1) => this.sounds.push({ at: time, cue: `rite.shadow.${name}`, where, volume, sent: false });
    cue(0.02, "seal", at(spot.at)); cue(T.fog, "fog", at(spot.at), 0.7); cue(T.rise.from, "rise", at(this.victim), 0.9);
    const marching = this.soldiers.length ? Math.min(...this.soldiers.map((s) => s.charger.march.departAt)) : T.arrive.first - 0.8;
    cue(marching, "march", at(this.victim), 0.8); cue(T.arrive.first - 0.35, "charge", at(this.victim), 1);
    if (this.colossus) { cue(T.colossus, "colossus", at(spot.at, 1.5), 1); cue(T.windup, "raise", at(spot.at, 2), 0.9); }
    cue(T.strike, "strike", at(this.victim, 0.2), 1.2); cue(T.strike + 0.04, "thunder", at(this.victim, 3), 1);
    cue(T.strike + 0.5, "settle", at(this.victim, 0), 0.6); cue(T.withdraw, "withdraw", at(spot.at, 1), 0.8); cue(T.burn.from, "burn", at(this.victim, 0.6), 0.8);
    cue(T.sealClose, "close", at(spot.at), 0.7);

    this.apply(0, null, 0);
  }

  /** Dresses a lent figure as a shadow and puts it under the rite's hand. */
  private enlist(troop: RiteTroop, kind: "p" | "n", charger: Charger, beat: SoldierBeat, seed: number, rim: number): Soldier {
    const skin = shadowSkin(this.skinLook, seed, rim);
    const look = new TroopLook(troop.object, (original) => shadowMaterial(original, skin, this.skinLook));
    troop.object.visible = false;
    return { troop, kind, driver: new TroopDriver(troop), skin, look, head: findBone(troop.object, "head"), charger, beat, thrusted: false };
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): RiteState {
    const step = Math.max(0, seconds);
    this.time += step;
    return this.apply(this.time, camera, height, step);
  }

  private apply(t: number, camera: THREE.PerspectiveCamera | null, height: number, step = 0): RiteState {
    const { cast } = this;
    const T = SHADOW_TIMING, top = cast.boardTop;
    const env = shadowEnvelope(t, cast.seed, cast.brief);
    const sounds: RiteSound[] = [], wounds: RiteWound[] = [];

    // the seal, its escapement ticking four times a second
    this.seal.set(t, { drawn: env.sealDrawn, glow: env.sealGlow, open: env.sealOpen, pulse: env.since >= 0 ? Math.exp(-env.since / 0.4) : 0, tick: Math.floor(t * 4) + Math.min(1, (t * 4 % 1) / 0.25) });

    // the soldiers
    let eye = 0;
    for (const soldier of this.soldiers) {
      const state = marchState(soldier.charger.march, t), h = soldier.troop.height;
      const gone = burnt(t, soldier.beat);
      if (state.phase === "hidden" || gone >= 1) { soldier.driver.show(false); continue; }
      soldier.driver.show(true);
      const rise = ease(state.risen);
      const y = top - (1 - rise) * h * 1.05;
      const facing = state.phase === "arrived" ? soldier.charger.slot?.facing ?? state.heading : state.phase === "rising" || state.phase === "waiting" ? toward(state.at, this.victim) : state.heading;
      // the blow throws the ring back a little, and it stands again
      const jolt = recoil(env.since, Math.hypot(state.at.x - this.victim.x, state.at.z - this.victim.z));
      const away = toward(this.victim, state.at);
      const pushed = { x: state.at.x + away.x * jolt.push, z: state.at.z + away.z * jolt.push };
      const where = this.standing.some((p) => Math.hypot(p.x - pushed.x, p.z - pushed.z) < CLEARANCE * 0.85) ? state.at : pushed;
      soldier.driver.place(where, y, facing, step, 10);
      soldier.driver.lean((state.phase === "running" ? 0.12 : 0) + jolt.lean, 0);
      if (state.phase === "walking") soldier.driver.loop("walk", stride(state.speed, soldier.kind, cast.tile), t);
      else if (state.phase === "running") soldier.driver.loop("run", stride(state.speed, soldier.kind, cast.tile), t);
      else if (state.phase === "arrived" && !soldier.thrusted && t >= soldier.beat.thrust) {
        soldier.thrusted = true;
        if (soldier.driver.once("attack") > 0) sounds.push({ cue: "rite.shadow.thrust", at: { x: where.x, y: top + 0.5, z: where.z }, volume: 0.5 });
      } else if (state.phase !== "arrived" || !soldier.thrusted) soldier.driver.loop("idle", 1, t);
      setShadowSkin(soldier.skin, { time: t, cut: top - 0.002, cutGlow: 1 - state.risen, burn: gone, feet: y, height: h, fade: 1, gain: this.gain });
      eye = this.setEyes(soldier, eye, (1 - gone * gone) * Math.min(1, state.risen * 1.5) * env.flicker, 0.024, 1);
    }

    // the colossus
    const giant = this.colossus;
    if (giant) {
      const pose = colossusPose(t);
      if (!pose.shown) giant.driver.show(false);
      else {
        giant.driver.show(true);
        const sunk = top - giant.height * (1.02 - (1.02 - COLOSSUS_SUNK) * ease(pose.risen));
        giant.driver.place(this.sealAt, sunk, this.sealFacing, step, 3);
        giant.driver.lean(pose.lean, 0);
        if (t >= T.windup && !giant.thrusted) { giant.thrusted = true; giant.driver.once("attack"); }
        else if (t < T.windup) giant.driver.loop(pose.risen < 0.98 ? "walk" : "idle", 1.2, t);
        setShadowSkin(giant.skin, { time: t, cut: top - 0.002, cutGlow: 1.4, burn: 0, feet: sunk, height: giant.height, fade: 1, gain: this.gain });
        eye = this.setEyes(giant, eye, Math.min(1, pose.risen * 2) * (env.flicker + (env.since >= 0 ? Math.exp(-env.since / 0.3) : 0)), 0.024 * COLOSSUS_SCALE, COLOSSUS_SCALE);
      }
    }
    this.eyes.hideFrom(eye);
    // the lamps: each lit when the pen has gone past it, guttering on its own beat, out as the seal closes
    this.lampAt.forEach((at, i) => {
      const passed = ((i / 6 + 0.3 / (Math.PI * 2) + 0.5) % 1) * T.sealDrawn;
      const lit = smoothstep(passed, passed + 0.08, t) * (1 - smoothstep(T.sealClose, T.sealGone, t));
      const gutter = 0.75 + 0.15 * Math.sin(t * (9 + i * 1.7) + i) + 0.1 * Math.sin(t * (23 + i * 3.1) + i * 2) + (env.since >= 0 ? 1.2 * Math.exp(-env.since / 0.25) : 0);
      this.lamps.set(i, at, 0.05, lit * gutter * 1.2, 0.35);
    });

    // the ranks in the fog
    this.ranks?.update(t, env.fog, t < T.burn.from + T.burn.spread + 1);

    // the matter and the light
    if (camera) {
      this.fog.update(t, camera, height); this.smoke?.update(t, camera, height); this.embers.update(t, camera, height); this.dust.update(t, camera, height);
      this.eyes.commit(camera, height); this.lamps.commit(camera, height);
      for (const bolt of this.bolts) bolt.strike.fit(camera, height);
      this.arcs?.fit(camera, height);
    }
    this.fog.setLight({ x: this.sealAt.x, y: top + 0.5, z: this.sealAt.z }, SHADOW_GASLIGHT, 0.9 * env.flicker * env.fog + (env.since >= 0 ? 1.5 * env.heat : 0));
    this.groundFog.set(t, 5 * smoothstep(T.fog, T.fog + 1.5, t), env.fog, env.flicker);
    this.dust.setLight({ x: this.victim.x, y: top + 0.6, z: this.victim.z }, cast.look.flame, 1.4 * env.heat);

    // the stone
    this.scar.set(t, { since: env.since, front: frontRadius(env.since, SHADOW_BLAST.reach, SHADOW_BLAST.spread), reach: SHADOW_BLAST.reach, heat: env.heat, left: env.scar, flash: env.flash, seams: 0, seamFront: 0 });
    this.slabs.update(t, env.heat);
    this.shrapnel.update(t);

    // the lightning
    for (const bolt of this.bolts) {
      const state = strikeState(bolt.timeline, t);
      if (state.path !== bolt.path && (state.bright > 0 || state.forks > 0)) {
        bolt.path = state.path;
        bolt.strike.setChannel(solveChannel(cast.seed * 13 + state.path * 211 + this.bolts.indexOf(bolt) * 7, bolt.from, bolt.to, { levels: 6, jag: 0.2, forks: 4, forkLevels: 3, lean: { x: 0, y: -1, z: 0 }, leaning: 0.6, floor: top }));
      }
      bolt.strike.set(state);
    }
    if (this.arcs) {
      const since = env.since, tick = since >= 0 ? Math.floor(since * 16) : -1;
      const live = since >= 0 && since < 0.9;
      if (live && tick !== this.arcTick) { this.arcTick = tick; this.arcs.setChannel(this.groundArcs(tick, frontRadius(since, SHADOW_BLAST.reach, SHADOW_BLAST.spread))); }
      const bright = live ? (0.9 - since) * (0.6 + 0.4 * ((tick * 7) % 5) / 4) : 0;
      this.arcs.set({ head: 1, bright, forks: bright, swell: 0.6 });
    }

    // the blow, and its one wound
    const struck = t >= T.strike;
    const from: Point = { x: this.sealAt.x, y: top + 2, z: this.sealAt.z };
    if (struck && !this.wounded) {
      this.wounded = true;
      const chest = cast.chest(this.headAt), away = toward(this.sealAt, this.victim);
      // only the colossus draws blood, and the gore system draws it as the Violence setting allows
      if (cast.violence !== "minimal") wounds.push({ at: point(chest), direction: { x: away.x * 0.6, y: 0.75, z: away.z * 0.6 }, power: cast.violence === "full" ? 1.6 : 1.1, kind: "slash" });
    }
    for (const sound of this.sounds) if (!sound.sent && t >= sound.at) { sound.sent = true; sounds.push({ cue: sound.cue, at: sound.where, volume: sound.volume }); }

    const lightAt = env.since < 0 ? this.glowAt.set(this.sealAt.x, top + 0.8, this.sealAt.z) : this.glowAt.set(this.victim.x, top + 0.7, this.victim.z);
    const glow = env.light > 0.01 ? { position: point(lightAt), colour: cast.look.light, intensity: env.light, reach: env.since < 0 ? 4.5 : 6 } : null;
    const shot = shadowShot(t);
    return {
      struck, blow: struck ? { from, power: 1.5 } : null, hold: null, released: false, done: env.done, wounds, sounds,
      shake: cast.brief ? 0 : env.shake, glow, shot, frame: this.frames[shot],
    };
  }

  /** Two eyes for a soldier: under its brow, a little apart, looking where it faces. Returns the next free light. */
  private setEyes(soldier: Soldier, index: number, bright: number, size: number, scale: number): number {
    const object = soldier.troop.object;
    if (soldier.head) soldier.head.getWorldPosition(this.headAt);
    else this.headAt.copy(object.position).setY(object.position.y + soldier.troop.height * scale * 0.88);
    const yaw = soldier.driver.yaw, front = soldier.driver.front;
    const fx = front * Math.sin(yaw), fz = front * Math.cos(yaw);
    const rx = -fz, rz = fx;
    for (const side of [-1, 1]) {
      this.eye.set(this.headAt.x + fx * 0.075 * scale + rx * side * 0.03 * scale, this.headAt.y + 0.02 * scale, this.headAt.z + fz * 0.075 * scale + rz * side * 0.03 * scale);
      this.eyes.set(index, this.eye, size, Math.max(0, bright), 0.5);
      index += 1;
    }
    return index;
  }

  /** Short arcs from the blow out to the front, along the stone. */
  private groundArcs(tick: number, front: number): Channel {
    const { cast } = this, random = dice(cast.seed * 7 + tick * 131), channels: Channel[] = [];
    const count = Math.max(1, Math.round(((this.arcs ? 1 : 0) * shadowCounts(cast.quality).arcs)));
    for (let i = 0; i < count; i += 1) {
      const turn = random() * Math.PI * 2, from = 0.15 + random() * 0.3, to = Math.max(from + 0.3, front * (0.7 + 0.3 * random()));
      channels.push(solveChannel(cast.seed + tick * 131 + i * 17,
        { x: this.victim.x + Math.cos(turn) * from, y: cast.boardTop + 0.03, z: this.victim.z + Math.sin(turn) * from },
        { x: this.victim.x + Math.cos(turn + (random() - 0.5) * 0.4) * to, y: cast.boardTop + 0.02, z: this.victim.z + Math.sin(turn + (random() - 0.5) * 0.4) * to },
        { levels: 4, jag: 0.22, forks: 1, forkLevels: 2, floor: cast.boardTop }));
    }
    return mergeChannels(channels);
  }

  setGain(gain: number): void {
    this.gain = gain;
    this.seal.setGain(gain); this.fog.setGain(gain); this.groundFog.setGain(gain); this.smoke?.setGain(gain); this.embers.setGain(gain); this.dust.setGain(gain);
    this.eyes.setGain(gain); this.lamps.setGain(gain); this.scar.setGain(gain); this.slabs.setGain(gain); this.shrapnel.setGain(gain); this.ranks?.setGain(gain);
    for (const bolt of this.bolts) bolt.strike.setGain(gain);
    this.arcs?.setGain(gain);
  }

  dispose(): void {
    for (const soldier of [...this.soldiers, ...(this.colossus ? [this.colossus] : [])]) {
      soldier.look.dispose();
      soldier.troop.object.scale.setScalar(1);
      soldier.troop.object.visible = false;
    }
    this.seal.dispose(); this.fog.dispose(); this.groundFog.dispose(); this.smoke?.dispose(); this.embers.dispose(); this.dust.dispose(); this.eyes.dispose(); this.lamps.dispose();
    this.scar.dispose(); this.slabs.dispose(); this.shrapnel.dispose(); this.ranks?.dispose();
    for (const bolt of this.bolts) bolt.strike.dispose();
    this.arcs?.dispose();
    this.object.removeFromParent();
  }
}

/** The unit way from one point to another on the board. */
function toward(from: Flat, to: Flat): Flat {
  const x = to.x - from.x, z = to.z - from.z, length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
}

/** Footfalls a second for a soldier moving at `speed`. */
function stride(speed: number, kind: "p" | "n", tile: number): number {
  return Math.max(1.2, (speed / tile) * STRIDE[kind]);
}

/** Makes Korvenia's summons for one capture. */
export function makeShadowArmy(cast: RiteCast): RiteEffect {
  return new ShadowArmy(cast);
}

/** The entry for the match's table of rites. */
export const SHADOW_RITE: RiteEntry = { id: "korvenia.queen.shadow-army", name: "The shadow army", army: "empire", make: makeShadowArmy };
