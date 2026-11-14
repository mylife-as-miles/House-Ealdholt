// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The frost line, drawn: Aethelgard's winter sent along the stone. frost/frostPlan.ts decides what it is doing at
 * each moment and where every spike, piece and mote is; this builds the five things that draw it (the rime on the
 * stone, the spikes, the pieces they break into, the loose light, the mist) once, and afterwards only moves one
 * clock and a handful of envelopes.
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true, sounds the blow,
 * and shakes the camera by what this reports. The piece dies run through on the great spike (vfx/spells/spell.ts
 * `pierce`), never burnt: this holds the body up on it (`pinned`) until the spike breaks through it, and tells the
 * match the wounds it opens on the frame they open, for its gore system to draw.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState, SpellWound } from "../spell";
import { ParticlePool } from "../shared/particles";
import { chunkGeometry, crystalGeometry } from "../shared/solidPlan";
import { SolidField } from "../shared/solids";
import {
  FROST_BUDGET, SPIKE_BOUNCE, frostBlood, frostChunks, frostLine as lineOf, frostParticles, frostSpikes, frostState, frostTimeline, frostWounds, kingThrust,
  type FrostLine, type FrostTimeline, type FrostWounds,
} from "./frostPlan";
import { Rime } from "./rime";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

class FrostLineEffect implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: FrostTimeline;
  private readonly line: FrostLine;
  private readonly rime: Rime;
  private readonly spikes: SolidField;
  private readonly chunks: SolidField;
  private readonly light: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null, pinned: false };
  private readonly violence: SpellCast["violence"];
  private readonly blood: number;
  /** The wounds the great spike opens, in order, and how many have been told to the match. */
  private readonly wounds: FrostWounds[];
  private told = 0;
  private seconds = 0;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, power, seed, boardTop } = cast, budget = FROST_BUDGET[cast.quality];
    cast.origin(this.hand);
    this.violence = cast.violence ?? "cinematic";
    this.line = lineOf(this.hand, cast.stone, boardTop, tile);
    this.timeline = frostTimeline(this.line.length, power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    const plan = { line: this.line, chest: cast.target, timeline: this.timeline, budget, power, seed, tile, violence: this.violence };
    const spikes = frostSpikes(plan), chunks = frostChunks(plan, spikes), loose = frostParticles(plan, spikes, this.hand);
    const thrust = kingThrust(plan), blood = frostBlood(plan, thrust);
    this.wounds = frostWounds(plan, thrust);
    this.blood = blood.amount;

    this.rime = new Rime({
      line: this.line, near: 0.16 * tile, far: (0.36 + 0.08 * (power - 1)) * tile, ring: (0.62 + 0.3 * (power - 1)) * tile, tile,
      frost: blend(look.smoke, look.core, 0.72), glow: look.flame, core: look.core, seed,
    });
    // ice: a dark cold heart, a body of the kingdom's blue, a pale edge, and its witchfire inside
    const ice = { deep: blend(look.flame, 0x061a2e, 0.72), body: blend(look.flame, look.core, 0.3), rim: look.core, glow: look.flame };
    this.spikes = new SolidField({
      solids: spikes, capacity: spikes.length, shapes: Array.from({ length: budget.cuts }, (_, i) => crystalGeometry(seed + 31 * i, { sides: 5 + ((seed + i) % 3), rough: 0.55, bend: 0.3 })),
      look: ice, matter: "ice", floor: boardTop, bounce: cast.brief ? 0 : SPIKE_BOUNCE, crumble: !cast.brief, creak: cast.brief ? 0 : 0.4,
    });
    this.chunks = new SolidField({
      solids: chunks, capacity: chunks.length, shapes: [chunkGeometry(seed + 7), chunkGeometry(seed + 8)].slice(0, Math.min(2, budget.cuts)),
      look: ice, matter: "ice", floor: boardTop, bounce: 0, crumble: false, creak: 0,
    });
    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: look.core, mid: look.ember, cool: look.flame }, blend: "add", floor: boardTop, seed });
    this.mist = new ParticlePool({
      particles: loose.mist, capacity: loose.mist.length, look: { hot: blend(look.smoke, look.core, 0.4), mid: blend(look.smoke, look.core, 0.12), cool: blend(look.smoke, 0x000000, 0.3) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.42,
    });
    this.rime.setBlood(blood.amount, blood.pools);
    this.object.add(this.rime.object, this.spikes.object, this.chunks.object, this.mist.object, this.light.object);
    this.glow = { position: { x: this.line.from.x, y: boardTop + 0.4, z: this.line.from.z }, colour: look.light, intensity: 0, reach: (3.5 + 1.5 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    this.apply(this.seconds);
    // the wounds opened since the last frame, on this frame only
    let opened: SpellWound[] | undefined;
    while (this.told < this.wounds.length && this.wounds[this.told].at <= this.seconds) (opened ??= []).push(...this.wounds[this.told++].wounds);
    this.state.wounds = opened;
    this.light.update(this.seconds, camera, height); this.mist.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void { this.rime.setGain(gain); this.spikes.setGain(gain); this.chunks.setGain(gain); this.light.setGain(gain); this.mist.setGain(gain); }

  dispose(): void {
    this.rime.dispose(); this.spikes.dispose(); this.chunks.dispose(); this.light.dispose(); this.mist.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const now = frostState(this.timeline, seconds, this.cast.power, this.violence), { line, cast } = this;
    // the hand may move while the cold gathers in it: what is anchored to it goes with it
    this.light.setAnchor(cast.origin(this.hand));
    this.rime.set(now.rime, now.frost, now.thaw); this.rime.setBlow(now.sinceStrike, now.flash); this.rime.setTime(seconds); this.rime.setBloodTime(now.sinceStrike);
    this.spikes.update(seconds); this.chunks.update(seconds); this.spikes.setBlood(this.blood, now.sinceStrike);
    // the light rides the front along the stone, and stays in the cluster once the blow has landed
    const at = now.glowAt * line.length, lift = now.struck ? 0.9 : 0.4;
    this.glow.position.x = line.from.x + line.along.x * at; this.glow.position.y = cast.boardTop + lift * cast.tile; this.glow.position.z = line.from.z + line.along.z * at;
    this.glow.intensity = now.glow;
    this.mist.setLight(this.glow.position, cast.look.light, 0.09 * Math.min(2.5, now.glow));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake; this.state.pinned = now.pinned; this.state.thawing = now.thaw > 0;
    this.state.glow = now.glow > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }
}

/** Makes one cast of the frost line. */
export const frostLine: SpellFactory = (cast) => new FrostLineEffect(cast);
