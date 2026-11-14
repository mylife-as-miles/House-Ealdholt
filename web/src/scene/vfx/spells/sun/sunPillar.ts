// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The sun pillar, drawn: Solforiz calls its sun down on a square. sun/sunPlan.ts decides what it is doing at each
 * moment and where everything loose is; this builds the five things that draw it (the seal on the stone, the
 * column, the loose light, the dust, the grit) once, and afterwards only moves one clock and a few envelopes.
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true, marks the
 * stone, sounds the blow, and shakes the camera by what this reports.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState } from "../spell";
import { ParticlePool } from "../shared/particles";
import { chunkGeometry } from "../shared/solidPlan";
import { SolidField } from "../shared/solids";
import { SunColumn } from "./column";
import { SunSeal } from "./seal";
import { SUN_BUDGET, penStart, sunGrit, sunParticles, sunShafts, sunSizes, sunState, sunTimeline, type SunTimeline } from "./sunPlan";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

class SunPillarEffect implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: SunTimeline;
  private readonly seal: SunSeal;
  private readonly column: SunColumn;
  private readonly grit: SolidField;
  private readonly light: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null };
  private seconds = 0;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, power, seed, boardTop, stone } = cast, budget = SUN_BUDGET[cast.quality];
    cast.origin(this.hand);
    this.timeline = sunTimeline(power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    const sizes = sunSizes(power, tile), floor = { x: stone.x, y: boardTop, z: stone.z };
    const plan = { stone: floor, hand: { x: this.hand.x, y: this.hand.y, z: this.hand.z }, timeline: this.timeline, sizes, budget, power, seed, tile };
    const loose = sunParticles(plan), grit = sunGrit(plan);
    // one sun at four temperatures: white-hot, the kingdom's gold, amber where it thins, red where it dies
    const white = blend(look.core, 0xffffff, 0.7), gold = look.core, amber = look.ember, red = look.flame;

    this.seal = new SunSeal({ stone: floor, ring: sizes.ring, reach: sizes.reach, start: penStart(plan), cracks: budget.cracks, white, gold, amber, red, seed });
    this.column = new SunColumn({
      shafts: sunShafts(sizes, this.timeline), centre: floor, height: sizes.height, fall: this.timeline.fall[1] - this.timeline.fall[0], brief: cast.brief,
      radial: budget.radial, clear: sizes.clear, white, gold, amber, seed,
    });
    this.grit = new SolidField({
      solids: grit, capacity: grit.length, shapes: [chunkGeometry(seed + 3), chunkGeometry(seed + 4)], look: { deep: 0x100c0a, body: 0x40342c, rim: gold, glow: red },
      matter: "cinder", floor: boardTop, bounce: 0, crumble: false, creak: 0,
    });
    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: white, mid: gold, cool: red }, blend: "add", floor: boardTop, seed });
    this.dust = new ParticlePool({
      particles: loose.dust, capacity: loose.dust.length, look: { hot: blend(look.smoke, look.core, 0.3), mid: look.smoke, cool: blend(look.smoke, 0x000000, 0.6) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.5,
    });
    this.object.add(this.seal.object, this.grit.object, this.dust.object, this.column.object, this.light.object);
    this.glow = { position: { x: stone.x, y: boardTop + 0.4 * tile, z: stone.z }, colour: look.light, intensity: 0, reach: (4 + 2 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    this.apply(this.seconds);
    this.light.update(this.seconds, camera, height); this.dust.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void { this.seal.setGain(gain); this.column.setGain(gain); this.grit.setGain(gain); this.light.setGain(gain); this.dust.setGain(gain); }

  dispose(): void {
    this.seal.dispose(); this.column.dispose(); this.grit.dispose(); this.light.dispose(); this.dust.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const now = sunState(this.timeline, seconds, this.cast.power), { cast } = this;
    // the hand may move while it holds the light: what is anchored to it goes with it
    this.light.setAnchor(cast.origin(this.hand));
    this.seal.setRing(now.drawn, now.ring, now.warn); this.seal.setBlow(now.sinceStrike, now.flash, now.column * (now.struck ? 1 : 0));
    this.seal.setStone(now.heat, now.scorch); this.seal.setTime(seconds);
    this.column.set(now.column, now.thread, now.width, now.erode, now.clear); this.column.setFall(now.sinceFall, now.flash); this.column.setTime(seconds);
    this.grit.update(seconds);
    // the light sits low in the ring while it warns and at chest height in the column once it burns
    this.glow.position.y = cast.boardTop + (now.struck ? 1.1 : 0.4) * cast.tile;
    this.glow.intensity = now.glow;
    this.dust.setLight(this.glow.position, cast.look.light, 0.22 * Math.min(2.5, now.struck ? now.column * 2 + now.flash : 0));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake;
    this.state.glow = now.glow > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }
}

/** Makes one cast of the sun pillar. */
export const sunPillar: SpellFactory = (cast) => new SunPillarEffect(cast);
