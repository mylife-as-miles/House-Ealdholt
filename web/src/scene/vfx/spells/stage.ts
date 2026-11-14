/**
 * The spells now in the air in a match.
 *
 * A spell (spells/spell.ts) only draws. This keeps the ones a match has cast: it adds each to the scene, advances
 * it on the fight's clock, tells the match the frame its blow lands, lends it the one light a spell may ask for,
 * passes its shake on, and removes it when nothing of it is left. A rebuilt board (Undo, a new game) ends them all.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellEntry, SpellWound } from "./spell";

export interface SpellFlight {
  readonly entry: SpellEntry;
  readonly effect: SpellEffect;
  /** Kept on the frame the blow lands, or when the spell is cut short. True when it landed. */
  readonly struck: Promise<boolean>;
  /** Kept when nothing of the spell is left, or when it is cut short. */
  readonly done: Promise<void>;
  /**
   * Kept when a spell that pinned the body lets it go (SpellState.pinned turns false again), when it ends, or when
   * it is cut short. A spell that never pins keeps it when it ends.
   */
  readonly released: Promise<void>;
}

/** What the match hears from a spell in the air beyond its blow. */
export interface SpellEvents {
  /** A wound the spell opens this frame (a `pierce` spell). */
  wound?(wound: SpellWound): void;
  /** The spell's ice has begun to melt off the stone (SpellState.thawing): once, where a `thaw` mark is laid. */
  thaw?(): void;
}

/** A light on loan from the match's fixed set (scene/spells.ts SpellLightPool): placed and dimmed, then handed back. */
export interface LentLight {
  set(position: THREE.Vector3, intensity: number): void;
  release(): void;
}

interface Flying extends SpellFlight {
  landed: boolean;
  events: SpellEvents;
  pinned: boolean;
  letGo: boolean;
  /** True once the thaw has been told. */
  thawed: boolean;
  release(): void;
  light: LentLight | null;
  /** True once a light has been asked for, lent or not: a spell asks once. */
  asked: boolean;
  hit(landed: boolean): void;
  finish(): void;
}

export interface SpellStageOptions {
  /**
   * Lends a light for a spell that asks for one, or null when none is free or the tier draws none. The match's
   * lights are a fixed set, never added to or hidden, so that no shader is recompiled in the middle of a fight.
   */
  lend(colour: number, reach: number): LentLight | null;
  /** Camera shake to add, as a spell reports it. */
  shake(amount: number): void;
}

export class SpellStage {
  /** Everything the spells draw. The match adds it to its scene once. */
  readonly object = new THREE.Group();
  private readonly flying: Flying[] = [];
  private readonly at = new THREE.Vector3();
  private gain = 1;

  constructor(private readonly options: SpellStageOptions) { this.object.name = "Spells"; }

  get active(): number { return this.flying.length; }

  /** Casts a spell: it is in the scene from this frame. */
  cast(entry: SpellEntry, cast: SpellCast, events: SpellEvents = {}): SpellFlight {
    const effect = entry.make(cast);
    effect.setGain(this.gain);
    this.object.add(effect.object);
    let hit: (landed: boolean) => void = () => {}, finish = () => {}, release = () => {};
    const struck = new Promise<boolean>((resolve) => { hit = resolve; });
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const flight: Flying = { entry, effect, struck, done, released, landed: false, light: null, asked: false, hit, finish, events, pinned: false, letGo: false, thawed: false, release };
    this.flying.push(flight);
    return flight;
  }

  /** Advances every spell. `gain` keeps their light from clipping in a bright exposure (vfxGlow). */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number, gain: number): void {
    this.gain = gain;
    for (let index = this.flying.length - 1; index >= 0; index -= 1) {
      const flight = this.flying[index];
      flight.effect.setGain(gain);
      const state = flight.effect.update(seconds, camera, height);
      if (state.struck && !flight.landed) { flight.landed = true; flight.hit(true); }
      if (state.wounds) for (const wound of state.wounds) flight.events.wound?.(wound);
      if (state.thawing && !flight.thawed) { flight.thawed = true; flight.events.thaw?.(); }
      if (state.pinned) flight.pinned = true;
      else if (flight.pinned && !flight.letGo) { flight.letGo = true; flight.release(); }
      if (state.shake > 0) this.options.shake(state.shake);
      if (state.glow && !flight.asked) { flight.asked = true; flight.light = this.options.lend(state.glow.colour, state.glow.reach); }
      if (flight.light) {
        if (state.glow) flight.light.set(this.at.set(state.glow.position.x, state.glow.position.y, state.glow.position.z), state.glow.intensity * gain);
        else flight.light.set(this.at, 0);
      }
      if (state.done) this.end(index);
    }
  }

  /** Ends every spell at once: the board has been replaced under them. A spell that had not landed says so. */
  clear(): void {
    for (let index = this.flying.length - 1; index >= 0; index -= 1) this.end(index);
  }

  dispose(): void {
    this.clear();
    this.object.removeFromParent();
  }

  private end(index: number): void {
    const [flight] = this.flying.splice(index, 1);
    flight.light?.release();
    flight.effect.object.removeFromParent();
    flight.effect.dispose();
    if (!flight.landed) flight.hit(false);
    if (!flight.letGo) { flight.letGo = true; flight.release(); }
    flight.finish();
  }
}
