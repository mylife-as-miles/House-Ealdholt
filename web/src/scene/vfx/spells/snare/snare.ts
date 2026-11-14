// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Snare, drawn: a cage of current thrown over the victim and closed on it, in the caster's kingdom's colours.
 * snare/snarePlan.ts decides what it is doing at each moment and where everything loose is; this builds the layers
 * once, and afterwards only moves one clock and a handful of envelopes.
 *
 * The layers, back to front:
 *
 *   field    the disc burnt into the stone and the ring round it (snare/field.ts)
 *   matter   dust thrown by the snap, smoke off the scorched disc
 *   cage     one instanced strip of filaments: the leash, the cage round the victim, the tendrils that bind its
 *            limbs, the arcs running round the ring. A strand's role is the first of its four numbers, and its path
 *            is chosen in the vertex shader, so the whole cage is two draws however many filaments are in the air
 *   crackle  arcs round the caster's hand while it gathers (the shared strike)
 *   light    sparks, embers and the drawn glow that stands in for bloom on the lowest tier
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true, marks the stone,
 * sounds the blow, and shakes the camera by what this reports.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState } from "../spell";
import { LightningStrike } from "../shared/lightning";
import { channelCapacity, mergeChannels, solveChannel, type Channel } from "../shared/lightningPlan";
import { ParticlePool } from "../shared/particles";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { dice } from "../shared/ribbonPlan";
import { SnareField } from "./field";
import {
  LIMBS, leashLine, snareCounts, snareLimbs, snareParticles, snareSize, snareState, snareTimeline, tendrilRoot, type SnareSize, type SnareTimeline,
} from "./snarePlan";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

/** Limbs the uniform array has room for. */
const MAX_LIMBS = LIMBS.length;

// strand: x its role (0 leash, 1 cage, 2 tendril, 3 rim arc), y its place (the leash's fan; round the cage or the
// ring; a tendril's limb), z its own die, which is also who it is, w a second die (a tendril's root bearing)
const CAGE_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uHand, uFrom, uTo, uCentre;
uniform vec3 uLimbs[${MAX_LIMBS}];
uniform float uFront, uLeashK, uRingR, uThroat, uCrown, uHeight, uClimb, uSqueeze, uTaut, uReach, uCount, uCoil, uHop;
uniform float uTime, uSeed, uRestrike, uKink, uWidth, uLeash, uCage, uTendrils, uRim;
float tendrilHead(float index) {
  // snarePlan.tendrilHead: one after another, the ankles first
  float stagger = uCount > 1.0 ? index / (uCount - 1.0) * 0.3 : 0.0;
  return clamp((uReach - stagger) / 0.7, 0.0, 1.0);
}
vec3 tendrilEntry(vec4 s) {
  vec3 limb = uLimbs[int(s.y + 0.5)];
  float coil = uCoil * (1.0 - 0.45 * uSqueeze), at = s.z * TAU;
  return limb + vec3(cos(at) * coil, -0.03, sin(at) * coil);
}
vec3 basePath(float t, vec4 s) {
  if (s.x < 0.5) {
    // the leash: thrown down from the hand onto the stone, and along it to its running tip
    vec3 tip = mix(uFrom, uTo, uFront);
    if (t < uLeashK) {
      float u = t / max(uLeashK, 1e-3);
      vec3 p = mix(uHand, uFrom, u);
      p.y = mix(uHand.y, uFrom.y + 0.04, u * u * (3.0 - 2.0 * u) * 0.35 + u * 0.65);
      return p;
    }
    vec3 p = mix(uFrom, tip, (t - uLeashK) / max(1.0 - uLeashK, 1e-3));
    p.y = uFrom.y + 0.04;
    return p;
  }
  if (s.x < 1.5) {
    // the cage: a twisting climb round the victim, close round the body and opening above its head; as it
    // tightens its crown closes down over the head, a step at each ratchet, and is shut at the crush
    float turn = s.y * TAU + (t * 0.32 + uTime * 0.8 * (s.w > 0.5 ? 1.0 : -0.65)) * TAU;
    float r = mix(uThroat * (1.0 - 0.25 * uSqueeze), uCrown * (1.0 - 0.86 * uSqueeze), pow(t, 2.4));
    r = mix(uRingR * 0.7, r, smoothstep(0.0, 0.12, t));
    return uCentre + vec3(cos(turn) * r, t * uHeight * uClimb * (1.0 - 0.18 * uSqueeze) + 0.015, sin(turn) * r);
  }
  if (s.x < 2.5) {
    // a tendril: up off the ring to its limb in an arch that is pulled out as it goes taut, then a coil round it
    float bearing = s.w * TAU;
    vec3 root = uCentre + vec3(cos(bearing), 0.0, sin(bearing)) * uRingR + vec3(0.0, 0.02, 0.0);
    if (t < 0.8) {
      float u = t / 0.8;
      vec3 entry = tendrilEntry(s), p = mix(root, entry, u);
      vec3 outward = normalize(vec3(root.x - uCentre.x, 0.0, root.z - uCentre.z) + vec3(1e-5));
      float arch = (0.16 + 0.12 * s.z) * (1.0 - 0.8 * uTaut) * sin(PI * u);
      return p + vec3(0.0, arch, 0.0) + outward * arch * 0.5;
    }
    float u = (t - 0.8) / 0.2, coil = uCoil * (1.0 - 0.45 * uSqueeze), at = s.z * TAU + u * 1.75 * TAU;
    return uLimbs[int(s.y + 0.5)] + vec3(cos(at) * coil, -0.03 + u * 0.07, sin(at) * coil);
  }
  // a rim arc: current hopping round the ring
  float turn = (s.y - uTime * 0.42) * TAU + s.z * 0.4 + t * 0.3 * TAU;
  float r = uRingR * (1.0 + 0.05 * sin(t * 6.0 + s.z * 9.0));
  return uCentre + vec3(cos(turn) * r, 0.02 + uHop * sin(PI * t) * (0.6 + 0.6 * s.w), sin(turn) * r);
}
vec2 kinked(float t, float seed, float corners) {
  vec2 o = vec2(0.0);
  float amp = 1.0, freq = corners, scroll = uTime * 2.4;
  for (int i = 0; i < 3; i++) {
    o.x += amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
    o.y += amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
    amp *= 0.55; freq *= 2.0; scroll *= 1.63;
  }
  return o;
}
vec3 ribbonPoint(float t, vec4 s) {
  vec3 here = basePath(t, s), ahead = basePath(min(t + 0.02, 1.0), s), behind = basePath(max(t - 0.02, 0.0), s);
  vec3 tangent = ahead - behind;
  tangent = dot(tangent, tangent) > 1e-10 ? normalize(tangent) : vec3(0.0, 1.0, 0.0);
  vec3 ref = abs(tangent.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 n1 = normalize(cross(tangent, ref)), n2 = cross(tangent, n1);
  // re-strikes: every filament snaps onto a new shape on a quantised clock, but the cage's heaviest keep their
  // channel for three strikes, as lightning re-strikes down the channel it has burnt
  float strike = floor(uTime * uRestrike);
  float kept = s.x > 0.5 && s.x < 1.5 && s.z < 0.4 ? floor(strike / 3.0) : strike;
  float seed = hash1(s.z * 71.3 + uSeed + kept * 3.77) * 97.0;
  float ends = smoothstep(0.0, 0.12, t) * smoothstep(0.0, 0.12, 1.0 - t);
  float amp = uKink, corners = 7.0;
  if (s.x < 0.5) { amp *= 0.8; corners = 9.0; }
  else if (s.x > 1.5 && s.x < 2.5) { amp *= 0.9 * (1.0 - 0.75 * uTaut); ends = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.6, 0.8, t)); corners = 5.0; }
  else if (s.x > 2.5) { amp *= 0.5; corners = 5.0; }
  vec2 k = kinked(t, seed, corners) * amp * ends;
  // the leash's filaments fan apart, and a filament that runs on the stone keeps its kinks on the stone
  if (s.x < 0.5) k += vec2(cos(seed), sin(seed)) * s.y * 0.05 * ends;
  vec3 off = n1 * k.x + n2 * k.y;
  if (s.x > 2.5 || (s.x < 0.5 && t > uLeashK)) off.y *= 0.3;
  vec3 p = here + off;
  p.y = max(p.y, uCentre.y + 0.012);
  // how bright it is: its role's level, and a stuttering blink of its own on the cage's one clock
  float level = s.x < 0.5 ? uLeash : s.x < 1.5 ? uCage : s.x < 2.5 ? uTendrils : uRim;
  float blink = uRestrike > 0.0 ? mix(1.0, hash1(floor(uTime * 30.0) + s.z * 37.0 + uSeed), 0.4) : 1.0;
  ribbonCarry = vec4(level * blink, s.x, 0.0, 0.0);
  return p;
}
float ribbonWidth(float t, vec4 s) {
  float shown = 1.0, width = uWidth;
  if (s.x < 0.5) { shown = step(0.001, uLeash); width *= 1.0; }
  else if (s.x < 1.5) { shown = step(0.001, uCage) * step(0.001, uClimb); width *= 1.25 * (1.0 - 0.4 * t); }
  else if (s.x < 2.5) { float head = tendrilHead(s.y); shown = 1.0 - smoothstep(head - 0.02, head, t); shown *= step(0.001, head) * step(0.001, uTendrils); width *= 1.35; }
  else { shown = step(0.001, uRim); width *= 0.75; }
  // a filament is an arc with two loose ends, and tapers at both; a tendril's bound end does not. (sin of PI in float
  // is a hair below zero at the very end, and pow of a negative base is undefined: some drivers give NaN)
  float taper = s.x > 1.5 && s.x < 2.5 ? pow(max(0.0, sin(clamp(t * 0.5 + 0.02, 0.0, 1.0) * PI)), 0.35) : pow(max(0.0, sin(clamp(t, 0.0, 1.0) * PI)), 0.35);
  return width * mix(1.0, taper, 0.85) * shown;
}
`;

const CAGE_SHADE = /* glsl */ `
uniform vec3 uCoreColour, uGlowColour, uHaloColour;
uniform float uSurge;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float v = abs(side);
#ifdef RIBBON_HALO
  float profile = pow(1.0 - v, 2.3);
  vec3 colour = mix(uHaloColour, uGlowColour, profile) * profile * 0.4;
#else
  float profile = pow(1.0 - v, 4.4);
  vec3 colour = mix(uGlowColour, uCoreColour, smoothstep(0.4, 1.0, profile)) * (profile * 1.3 + pow(1.0 - v, 1.5) * 0.3);
#endif
  // the loose ends fade as well as thin; a tendril's bound end stays lit
  bool tendril = strand.x > 1.5 && strand.x < 2.5;
  colour *= tendril ? pow(sin(clamp(t * 0.5 + 0.02, 0.0, 1.0) * 3.14159), 0.35) : pow(sin(clamp(t, 0.0, 1.0) * 3.14159), 0.35);
#ifndef RIBBON_HALO
  // the crush: a surge running up each tendril and up the cage, from the stone to what it holds
  float fromSurge = (t - uSurge / 0.09) / 0.06;
  float surge = uSurge >= 0.0 && uSurge < 0.12 ? exp(-fromSurge * fromSurge) * step(0.5, strand.x) * step(strand.x, 2.5) : 0.0;
  colour += uCoreColour * surge * pow(1.0 - v, 2.0) * 1.8;
#endif
  // a tendril's coil is the brightest thing on it: it is what holds
  if (tendril) colour *= 1.0 + 0.8 * smoothstep(0.75, 0.85, t);
  return colour * vCarry.x;
}
`;

class Snare implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: SnareTimeline;
  private readonly size: SnareSize;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly cage: Ribbon;
  private readonly field: SnareField;
  private readonly crackle: LightningStrike | null;
  private readonly crackles: number;
  private readonly light: ParticlePool;
  private readonly matter: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly line: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; length: number };
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null };
  private seconds = 0;
  private crackleTick = -1;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, seed, boardTop, stone, target, quality } = cast, power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    const floor = { x: stone.x, y: boardTop, z: stone.z }, hand = { x: this.hand.x, y: this.hand.y, z: this.hand.z };
    const counts = snareCounts(quality, power), size = this.size = snareSize(power, tile);
    this.line = leashLine({ stone: floor, hand, size, tile });
    this.timeline = snareTimeline(this.line.length, power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    const limbs = snareLimbs(floor, hand, target.y - boardTop, counts.tendrils);
    const loose = snareParticles({ stone: floor, hand, limbs, timeline: this.timeline, size, counts, power, seed, tile });
    const core = look.core, glow = look.flame;

    this.field = new SnareField({ stone: floor, ring: size.ring, width: 0.03 * tile, glow, core, seed });

    // the strands: the leash, the cage, the tendrils, the rim arcs
    const random = dice(seed ^ 0x54a2e), strands: number[] = [];
    if (!cast.brief) for (let i = 0; i < counts.leash; i += 1) strands.push(0, counts.leash > 1 ? (i / (counts.leash - 1)) * 2 - 1 : 0, random(), random());
    for (let i = 0; i < counts.column; i += 1) strands.push(1, i / counts.column + 0.05 * random(), random(), random());
    limbs.forEach((limb, i) => { const die = random(); strands.push(2, i, die, (tendrilRoot(floor, limb, random()) / (Math.PI * 2) + 1) % 1); });
    for (let i = 0; i < counts.rim; i += 1) strands.push(3, i / counts.rim + 0.1 * random(), random(), random());
    const limbArray = Array.from({ length: MAX_LIMBS }, (_, i) => new THREE.Vector3(limbs[i]?.x ?? floor.x, limbs[i]?.y ?? floor.y, limbs[i]?.z ?? floor.z));

    const box = (value: unknown): THREE.IUniform => ({ value });
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uHand: box(this.hand.clone()), uFrom: box(new THREE.Vector3(this.line.from.x, boardTop, this.line.from.z)), uTo: box(new THREE.Vector3(this.line.to.x, boardTop, this.line.to.z)),
      uCentre: box(new THREE.Vector3(floor.x, floor.y, floor.z)), uLimbs: box(limbArray),
      uFront: box(0), uLeashK: box(0.5), uRingR: box(0), uThroat: box(size.throat), uCrown: box(size.crown), uHeight: box(size.height), uClimb: box(0), uSqueeze: box(0), uTaut: box(0),
      uReach: box(0), uCount: box(limbs.length), uCoil: box(size.coil), uHop: box(size.hop),
      uTime: box(0), uSeed: box((seed % 977) * 0.137), uRestrike: box(21), uKink: box(size.kink), uWidth: box(size.filament), uLeash: box(0), uCage: box(0), uTendrils: box(0), uRim: box(0), uSurge: box(-1),
      uCoreColour: box(new THREE.Color(core)), uGlowColour: box(new THREE.Color(glow)), uHaloColour: box(new THREE.Color(blend(glow, 0x000000, 0.55))), uGain: box(1), uPixel: box(0.001),
    };
    this.cage = new Ribbon({ segments: counts.segments, strands: new Float32Array(strands), halo: 5.5, order: 12, minPixels: 1.4, uniforms: u, curve: CAGE_CURVE, shade: CAGE_SHADE });

    // arcs crackling round the hand while it gathers
    this.crackles = cast.brief ? 0 : counts.crackle;
    this.crackle = this.crackles > 0 ? new LightningStrike({ capacity: this.crackles * channelCapacity(3), look: { core, glow }, width: size.filament * 0.8, halo: 4, order: 13 }) : null;

    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: core, mid: blend(glow, core, 0.4), cool: glow }, blend: "add", floor: boardTop, seed });
    this.matter = new ParticlePool({
      particles: loose.matter, capacity: loose.matter.length, look: { hot: blend(look.smoke, glow, 0.25), mid: look.smoke, cool: blend(look.smoke, 0x000000, 0.6) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.5,
    });
    this.object.add(this.field.object, this.matter.object, this.cage.object, this.light.object);
    if (this.crackle) this.object.add(this.crackle.object);
    this.glow = { position: { x: hand.x, y: hand.y, z: hand.z }, colour: look.light, intensity: 0, reach: (3.4 + 1.4 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    this.cage.fit(camera, height); this.crackle?.fit(camera, height);
    this.apply(this.seconds);
    this.light.update(this.seconds, camera, height); this.matter.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; this.field.setGain(gain); this.crackle?.setGain(gain); this.light.setGain(gain); this.matter.setGain(gain); }

  dispose(): void {
    this.field.dispose(); this.cage.dispose(); this.crackle?.dispose(); this.light.dispose(); this.matter.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const { cast, timeline, size, uniforms: u, line } = this, power = Math.max(0.5, cast.power);
    const now = snareState(timeline, seconds, power);
    // in the brief form the current crawls at a third of the pace and does not re-strike: nothing strobes
    const pace = cast.brief ? 0.35 : 1;
    u.uTime.value = seconds * pace; u.uRestrike.value = now.restrike;
    cast.origin(this.hand);
    (u.uHand.value as THREE.Vector3).copy(this.hand);
    // the leash: how much of it is the drop from the hand, so its cuts are spread evenly along it
    const drop = Math.hypot(this.hand.x - line.from.x, this.hand.y - cast.boardTop, this.hand.z - line.from.z), run = line.length * now.front;
    u.uLeashK.value = drop / Math.max(1e-3, drop + run); u.uFront.value = now.front; u.uLeash.value = now.leash;
    u.uRingR.value = size.ring * Math.max(0.05, now.open);
    u.uClimb.value = now.climb; u.uCage.value = now.cage; u.uSqueeze.value = now.squeeze; u.uTaut.value = now.taut;
    u.uReach.value = now.reach; u.uTendrils.value = now.tendrils; u.uRim.value = now.rim;
    u.uSurge.value = cast.brief ? -1 : now.sinceStrike;
    this.field.setRing(now.open, now.ring, cast.brief ? -1 : now.sinceSnap); this.field.setStone(now.scorch, now.heat, now.squeeze); this.field.setTime(seconds * pace);
    if (this.crackle) {
      const tick = Math.floor(seconds * 18), lit = now.hand > 0.05 && now.leash === 0;
      if (lit && tick !== this.crackleTick) { this.crackleTick = tick; this.crackle.setChannel(this.crackleChannel(tick)); }
      const level = lit ? now.hand * (0.55 + 0.45 * ((tick * 7) % 5) / 4) : 0;
      this.crackle.set({ head: 1, bright: level, forks: level, swell: 0.6 });
    }
    this.light.setAnchor(this.hand);
    // the light sits in the hand, rides the leash's tip, and stands in the cage
    if (now.lightAt < 0.5) { this.glow.position.x = this.hand.x; this.glow.position.y = this.hand.y; this.glow.position.z = this.hand.z; }
    else if (now.lightAt < 1.5) { this.glow.position.x = line.from.x + (line.to.x - line.from.x) * now.front; this.glow.position.y = cast.boardTop + 0.25 * cast.tile; this.glow.position.z = line.from.z + (line.to.z - line.from.z) * now.front; }
    else { this.glow.position.x = cast.stone.x; this.glow.position.y = cast.boardTop + 0.85 * cast.tile; this.glow.position.z = cast.stone.z; }
    this.glow.intensity = now.light;
    this.matter.setLight(this.glow.position, cast.look.light, 0.16 * Math.min(2.5, now.light));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake;
    this.state.glow = now.light > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }

  /** Short arcs from one place round the hand to another. */
  private crackleChannel(tick: number): Channel {
    const { cast } = this, random = dice(cast.seed * 13 + tick * 197), channels: Channel[] = [];
    const round = (r: number) => { const a = random() * Math.PI * 2, y = (random() - 0.5) * 1.2; return { x: this.hand.x + Math.cos(a) * r, y: this.hand.y + y * r, z: this.hand.z + Math.sin(a) * r }; };
    for (let i = 0; i < this.crackles; i += 1) channels.push(solveChannel(cast.seed + tick * 197 + i * 31, round(0.05 + 0.04 * random()), round(0.12 + 0.08 * random()), { levels: 3, jag: 0.35 }));
    return mergeChannels(channels);
  }
}

/** The Snare, for Kwind-09's and Korvenia's casters, in the caster's kingdom's colours. */
export const makeSnare: SpellFactory = (cast) => new Snare(cast);
