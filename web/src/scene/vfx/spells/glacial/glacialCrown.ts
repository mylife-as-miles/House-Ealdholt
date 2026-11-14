// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Glacial crown, drawn: Aethelgard's second spell, a crown of ice blades raised round the victim and shattered.
 * glacial/glacialPlan.ts decides what it is doing at each moment and where every blade, plate and mote is; this
 * builds the layers once, and afterwards only moves one clock and a handful of envelopes.
 *
 * The layers, back to front:
 *
 *   front    the cold front's frost lying on the stone from the caster's feet to the crown, and its running light
 *   sheet    the ice the crown stands on (glacial/sheet.ts)
 *   blades   the crown and the skirt at its feet: glass seen by its edges, growing in jumps; and the impalers that
 *            thrust up through the victim, bloodied (glacial/blades.ts)
 *   plates   the pieces the shatter throws down, which skid and melt (the shared solids, as ice)
 *   mist     vapour off the front and the rim, the air inside the crown frozen white
 *   light    glints, chips, snow, and the drawn glow that stands in for bloom on the lowest tier
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true, sounds the blow,
 * and shakes the camera by what this reports. The piece dies run through (vfx/spells/spell.ts `pierce`), never burnt:
 * this holds the body up on the impalers (`pinned`) from the blow until the shatter starts, and tells the match the
 * wounds they open on the frame each tip comes out of the body, for its gore system to draw.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState, SpellWound } from "../spell";
import { ParticlePool } from "../shared/particles";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { chunkGeometry } from "../shared/solidPlan";
import { SolidField } from "../shared/solids";
import { BladeField } from "./blades";
import {
  GROWTH_STEPS, bladeGeometry, glacialBlades, glacialBlood, glacialCounts, glacialLine, glacialParticles, glacialPlates, glacialSize, glacialState, glacialThrusts, glacialTimeline,
  glacialWounds, type GlacialLine, type GlacialTimeline, type GlacialWounds,
} from "./glacialPlan";
import { FrostSheet } from "./sheet";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

const FRONT_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uFrom, uTo;
uniform float uNear, uFar, uSeed;
vec3 ribbonPoint(float t, vec4 strand) { return mix(uFrom, uTo, t) + vec3(0.0, 0.011 + 0.002 * strand.x, 0.0); }
float ribbonWidth(float t, vec4 strand) { return mix(uNear, uFar, t) * (0.75 + 0.5 * noise(vec2(t * 9.0 + uSeed, strand.x * 3.0))); }
`;

// the frost on the stone: white behind the running edge, ragged across, thawing where it is thinnest
const FRONT_FROST = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uFrostColour;
uniform float uFront, uFrost, uThaw, uSeed;
vec4 ribbonMatter(float t, float side, vec4 strand) {
  float edge = uFront + (noise(vec2(t * 30.0, side * 3.0 + uSeed)) - 0.5) * 0.05;
  float behind = 1.0 - smoothstep(edge - 0.015, edge + 0.005, t);
  float across = 1.0 - smoothstep(0.35, 1.0, abs(side) + (noise(vec2(t * 18.0 + uSeed, side * 4.0)) - 0.5) * 0.5);
  float thick = 0.45 + 0.4 * noise(vec2(t * 40.0, side * 7.0)) + 0.15 * noise(vec2(t * 120.0, side * 20.0));
  float kept = 1.0 - smoothstep(thick * across - 0.08, thick * across + 0.04, uThaw * 1.1);
  return vec4(uFrostColour * (0.82 + 0.18 * thick), behind * across * thick * kept * uFrost * 0.8);
}
`;

// the front's running light: hot at its head, a faint trace behind
const FRONT_LIGHT = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uGlowColour, uCoreColour;
uniform float uFront, uFrost, uSeed;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  float fromFront = (t - uFront) / 0.035;
  float head = uFront > 0.0 && uFront < 1.0 ? exp(-fromFront * fromFront) : 0.0;
  float behind = 1.0 - smoothstep(uFront - 0.01, uFront + 0.01, t);
  float trace = behind * pow(across, 2.0) * 0.05 * (0.5 + noise(vec2(t * 25.0, side * 5.0 + uSeed)));
  return (uGlowColour * (head * pow(across, 1.5) * 0.9 + trace) + uCoreColour * head * head * pow(across, 3.0) * 0.6) * uFrost;
}
`;

class GlacialCrown implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: GlacialTimeline;
  private readonly line: GlacialLine;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly frost: Ribbon;
  private readonly run: Ribbon;
  private readonly sheet: FrostSheet;
  private readonly blades: BladeField;
  private readonly plates: SolidField;
  private readonly light: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null, pinned: false };
  private readonly violence: SpellCast["violence"];
  /** The wounds the impalers open, in order, and how many have been told to the match. */
  private readonly wounds: GlacialWounds[];
  private told = 0;
  private seconds = 0;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, seed, boardTop, stone, quality } = cast, power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    const floor = { x: stone.x, y: boardTop, z: stone.z }, hand = { x: this.hand.x, y: this.hand.y, z: this.hand.z };
    const counts = glacialCounts(quality, power), size = glacialSize(power, tile);
    this.violence = cast.violence ?? "cinematic";
    this.line = glacialLine(hand, floor, size.seat, tile);
    this.timeline = glacialTimeline(this.line.length, power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    const plan = { stone: floor, chest: cast.target, line: this.line, timeline: this.timeline, size, counts, power, seed, tile, violence: this.violence };
    const blades = glacialBlades(plan), plates = glacialPlates(plan, blades), loose = glacialParticles(plan, blades, hand);
    const thrusts = glacialThrusts(plan), blood = glacialBlood(plan, thrusts);
    this.wounds = glacialWounds(plan, thrusts);
    const frostColour = blend(look.smoke, look.core, 0.72);

    const box = (value: unknown): THREE.IUniform => ({ value });
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uFrom: box(new THREE.Vector3(this.line.from.x, boardTop, this.line.from.z)), uTo: box(new THREE.Vector3(this.line.to.x, boardTop, this.line.to.z)),
      uNear: box(size.near), uFar: box(size.far), uSeed: box((seed % 977) * 0.137), uFront: box(0), uFrost: box(0), uThaw: box(0),
      uFrostColour: box(new THREE.Color(frostColour)), uGlowColour: box(new THREE.Color(look.flame)), uCoreColour: box(new THREE.Color(look.core)), uGain: box(1), uPixel: box(0.001),
    };
    const pick = (...names: string[]) => Object.fromEntries(names.map((name) => [name, u[name]]));
    this.frost = new Ribbon({ segments: 48, strands: new Float32Array(4), facing: "up", matter: true, order: 3, uniforms: pick("uFrom", "uTo", "uNear", "uFar", "uSeed", "uFront", "uFrost", "uThaw", "uFrostColour", "uGain", "uPixel"), curve: FRONT_CURVE, shade: FRONT_FROST });
    this.run = new Ribbon({ segments: 48, strands: new Float32Array([1, 0, 0, 0]), facing: "up", order: 4, uniforms: pick("uFrom", "uTo", "uNear", "uFar", "uSeed", "uFront", "uFrost", "uGlowColour", "uCoreColour", "uGain", "uPixel"), curve: FRONT_CURVE, shade: FRONT_LIGHT });

    this.sheet = new FrostSheet({ stone: floor, sheet: size.sheet, frost: frostColour, glow: look.flame, core: look.core, seed });
    // glass: a dark cold heart, a body of the kingdom's blue, a pale edge, and its witchfire piped up inside
    this.blades = new BladeField({
      blades, shapes: Array.from({ length: counts.cuts }, (_, i) => bladeGeometry(seed + 41 * i, 6 + (i % 2))), floor: boardTop, steps: cast.brief ? 0 : GROWTH_STEPS, creak: cast.brief ? 0 : 0.45,
      look: { deep: blend(look.flame, 0x041420, 0.78), body: blend(look.flame, 0x0a2a40, 0.55), rim: look.core, glow: look.flame },
    });
    this.blades.setBlood(blood.amount);
    // at Full the impalers twist in the body during the hold; never in the brief form, where nothing jolts
    this.blades.setTwist(this.timeline.twist, this.violence === "full" && !cast.brief ? 0.55 : 0);
    this.sheet.setBlood(blood.amount, blood.pools);
    const ice = { deep: blend(look.flame, 0x061a2e, 0.72), body: blend(look.flame, look.core, 0.3), rim: look.core, glow: look.flame };
    this.plates = new SolidField({ solids: plates, capacity: plates.length, shapes: [chunkGeometry(seed + 11), chunkGeometry(seed + 12)].slice(0, Math.max(1, Math.min(2, counts.cuts))), look: ice, matter: "ice", floor: boardTop, bounce: 0, crumble: false, creak: 0 });
    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: look.core, mid: look.ember, cool: look.flame }, blend: "add", floor: boardTop, seed });
    this.mist = new ParticlePool({
      particles: loose.mist, capacity: loose.mist.length, look: { hot: blend(look.smoke, look.core, 0.45), mid: blend(look.smoke, look.core, 0.15), cool: blend(look.smoke, 0x000000, 0.3) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.45,
    });
    this.object.add(this.frost.object, this.run.object, this.sheet.object, this.blades.object, this.plates.object, this.mist.object, this.light.object);
    this.glow = { position: { x: hand.x, y: hand.y, z: hand.z }, colour: look.light, intensity: 0, reach: (3.6 + 1.6 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    this.frost.fit(camera, height); this.run.fit(camera, height);
    this.apply(this.seconds);
    // the wounds opened since the last frame, on this frame only
    let opened: SpellWound[] | undefined;
    while (this.told < this.wounds.length && this.wounds[this.told].at <= this.seconds) (opened ??= []).push(...this.wounds[this.told++].wounds);
    this.state.wounds = opened;
    this.light.update(this.seconds, camera, height); this.mist.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void {
    this.uniforms.uGain.value = gain; this.sheet.setGain(gain); this.blades.setGain(gain); this.plates.setGain(gain); this.light.setGain(gain); this.mist.setGain(gain);
  }

  dispose(): void {
    this.frost.dispose(); this.run.dispose(); this.sheet.dispose(); this.blades.dispose(); this.plates.dispose(); this.light.dispose(); this.mist.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const { cast, timeline, line, uniforms: u } = this, power = Math.max(0.5, cast.power);
    const now = glacialState(timeline, seconds, power, this.violence);
    // in the brief form the light in the ice moves at a third of the pace: nothing rushes
    const pace = cast.brief ? 0.35 : 1;
    u.uFront.value = now.front; u.uFrost.value = now.frost; u.uThaw.value = now.thaw;
    this.frost.object.visible = this.run.object.visible = !cast.brief && now.frost > 0.002;
    this.sheet.set(now.freeze, now.rime, now.flash); this.sheet.setThaw(now.thaw, now.wet); this.sheet.setTime(seconds * pace); this.sheet.setBloodTime(now.sinceStrike);
    this.blades.update(seconds, seconds * pace); this.plates.update(seconds);
    cast.origin(this.hand);
    this.light.setAnchor(this.hand);
    // the light sits in the hand, rides the front's head, and stands in the crown
    if (now.lightAt < 0.5) { this.glow.position.x = this.hand.x; this.glow.position.y = this.hand.y; this.glow.position.z = this.hand.z; }
    else if (now.lightAt < 1.5) { this.glow.position.x = line.from.x + (line.to.x - line.from.x) * now.front; this.glow.position.y = cast.boardTop + 0.3 * cast.tile; this.glow.position.z = line.from.z + (line.to.z - line.from.z) * now.front; }
    else { this.glow.position.x = cast.stone.x; this.glow.position.y = cast.boardTop + 0.8 * cast.tile; this.glow.position.z = cast.stone.z; }
    this.glow.intensity = now.light;
    this.mist.setLight(this.glow.position, cast.look.light, 0.1 * Math.min(2.5, now.light));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake; this.state.pinned = now.pinned; this.state.thawing = now.thaw > 0;
    this.state.glow = now.light > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }
}

/** Aethelgard's Glacial crown, for its Bishop and Queen. */
export const makeGlacialCrown: SpellFactory = (cast) => new GlacialCrown(cast);
