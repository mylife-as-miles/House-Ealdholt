// Adapted from SoldierThirdPersonThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Unmaking, drawn: Korvenia's rune under the victim and the column that comes up through it, in violet and
 * gilt. unmaking/unmakingPlan.ts decides what it is doing at each moment and where everything loose is; this
 * builds the layers once, and afterwards only moves one clock and a handful of envelopes.
 *
 * The layers, back to front:
 *
 *   rune     the rune on the stone (unmaking/rune.ts): written, held, drawn in, struck, emptied, burnt out
 *   matter   dust drawn in over the stone and thrown up the column, dark flakes climbing it, smoke off the char
 *   column   light down its middle in a sheath of dark (unmaking/column.ts)
 *   rings    the ring of script the hand writes in step with the rune, and a Queen's binding ring round the victim
 *   cords    gilt cords racing up the column, flung off as it closes
 *   grains   four-pointed grains of light climbing the column on loops of their own
 *   glyphs   the rune's own script, lifted off the stone glyph by glyph, carried up and unwritten as it climbs
 *   light    glints, sparks, embers and the drawn glow that stands in for bloom on the lowest tier
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true and burns the
 * body in the spell's colour, marks the stone, sounds the blow, and shakes the camera by what this reports.
 */
import * as THREE from "three";
import { RUNE_RING } from "../../mystic/beam";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState } from "../spell";
import { LANCE_GOLD, LANCE_GOLD_HOT } from "../lance/lancePlan";
import { ParticlePool } from "../shared/particles";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { dice, strandSeeds } from "../shared/ribbonPlan";
import { VoidColumn } from "./column";
import { GLYPH_HASH, GLYPH_MARKS, GLYPH_SEED, UnmakingRune } from "./rune";
import {
  GLYPH_CLIMB, GLYPH_RING, QUEEN_POWER, RUNE_CELLS, cordHead, glyphPeels, penStart, runeTurn, unmakingCounts, unmakingParticles, unmakingSize, unmakingState,
  unmakingTimeline, type UnmakingSize, type UnmakingTimeline,
} from "./unmakingPlan";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

/** One-segment strands that run up the camera's up vector: squares that face the eye, `side` and `t` their axes. */
const SPRITE = (centre: string, size: string, more: string) => /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCamUp;
${more}
vec3 ribbonPoint(float t, vec4 strand) { return (${centre}) + uCamUp * (t * 2.0 - 1.0) * (${size}); }
float ribbonWidth(float t, vec4 strand) { return ${size}; }
`;

// strand: x its place round the column, y which way it winds, z gilt or violet, w its own die
const CORD_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uFoot;
uniform float uHeight, uCordRadius, uTurns, uSpin, uTime, uCordHead, uFling, uCordWidth, uGirth;
vec3 ribbonPoint(float t, vec4 strand) {
  float hand = strand.y > 0.5 ? 1.0 : -1.0;
  // flung off as the column closes: they open out and unwind
  float unwind = 1.0 - 0.6 * uFling;
  float angle = strand.x * TAU + hand * (t * uTurns * unwind * TAU - uTime * uSpin);
  float r = uCordRadius * (0.82 + 0.4 * t) * mix(1.0, uGirth, 0.5) * (1.0 + 2.4 * uFling * uFling * (0.4 + t));
  vec3 off = vec3(cos(angle), 0.0, sin(angle));
  // which side of the column it is on, seen from the eye: the far side is drawn dimmer
  vec3 at = uFoot + off * r + vec3(0.0, t * uHeight * (1.0 + 0.25 * uFling), 0.0);
  ribbonCarry.x = dot(normalize(mat3(modelViewMatrix) * off), normalize(-(modelViewMatrix * vec4(at, 1.0)).xyz));
  return at;
}
float ribbonWidth(float t, vec4 strand) {
  float drawn = 1.0 - smoothstep(uCordHead - 0.02, uCordHead, t);
  return uCordWidth * (1.0 - 0.55 * t) * drawn * step(0.001, uCordHead);
}
`;

const CORD_SHADE = /* glsl */ `
uniform vec3 uGold, uGoldHot, uGlow, uCore;
uniform float uTime, uCordHead, uCords;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  float ends = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.78, 1.0, t));
  // something running up each cord, so it reads as carrying and not as a screw thread
  float pulse = 0.65 + 0.55 * pow(0.5 + 0.5 * sin(t * 24.0 - uTime * 11.0 + strand.w * 6.0), 2.0);
  float fromHead = (t - uCordHead) / 0.03;
  float head = uCordHead > 0.0 && uCordHead < 0.999 ? exp(-fromHead * fromHead) : 0.0;
  float front = 0.4 + 0.6 * smoothstep(-0.6, 0.6, vCarry.x);
  vec3 hue = strand.z < 0.5 ? uGold : mix(uGlow, uCore, 0.45);
#ifdef RIBBON_HALO
  return (hue * pow(across, 2.0) * 0.22 * ends * pulse * front + uGoldHot * head * pow(across, 2.0) * 0.5) * uCords;
#else
  return ((hue * pow(across, 1.4) * 0.85 + uGoldHot * pow(across, 6.0) * 0.55) * ends * pulse * front + uGoldHot * head * across * 2.4) * uCords;
#endif
}
`;

// strand: x its bearing, y how far out it climbs, z its pace, w its phase
const GRAIN_MORE = /* glsl */ `
uniform vec3 uFoot;
uniform float uLoop, uColumnR, uHeight, uReachH, uGirth, uGrains, uGrain, uTime;
vec3 grainAt(vec4 strand) {
  // unmakingPlan.grainLoop: each runs its own loop, so the field is continuous with nothing re-emitted
  float loop = fract(uLoop * (0.32 + 0.4 * strand.z) + strand.w);
  float climb = pow(loop, 0.78);
  float angle = strand.x * TAU + (1.5 + 1.6 * strand.y) * loop + uTime * 0.5;
  float r = uColumnR * uGirth * (0.3 + 0.8 * strand.y) + uColumnR * 0.45 * climb;
  float h = climb * uHeight * 0.92;
  ribbonCarry.x = smoothstep(0.0, 0.1, loop) * (1.0 - smoothstep(0.55, 1.0, loop)) * step(h, uReachH) * uGrains * step(0.0, uLoop);
  return uFoot + vec3(cos(angle) * r, h, sin(angle) * r);
}
`;

const GRAIN_SHADE = /* glsl */ `
uniform vec3 uGold, uGoldHot, uGlow, uCore;
uniform float uTime;
vec3 ribbonShade(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float turn = strand.w * 6.2831853 + uTime * (0.6 + strand.z), c = cos(turn), s = sin(turn);
  vec2 q = abs(vec2(p.x * c - p.y * s, p.x * s + p.y * c));
  // two needles crossed, and a heart where they meet
  float star = exp(-q.x * 15.0) * exp(-q.y * 3.0) + exp(-q.y * 15.0) * exp(-q.x * 3.0);
  float heart = exp(-dot(p, p) * 26.0);
  float twinkle = 0.55 + 0.45 * sin(strand.y * 41.0 + uTime * (5.0 + 6.0 * strand.z));
  vec3 hue = strand.z < 0.6 ? uGold : mix(uGlow, uCore, 0.5);
  return (hue * star + uGoldHot * heart * 1.3) * twinkle * vCarry.x * 1.25 * (1.0 - smoothstep(0.85, 1.0, length(p)));
}
`;

// strand: x the cell it lifted from, y the moment it lifted (after the blow), z the bearing it left at, w its own die
const GLYPH_MORE = /* glsl */ `
uniform vec3 uFoot;
uniform float uSince, uRuneR, uColumnR, uHeight, uReachH, uGlyph;
float glyphAge(vec4 strand) { return uSince - strand.y; }
vec3 glyphAt(vec4 strand) {
  // unmakingPlan.glyphFlight
  float age = glyphAge(strand), u = clamp(age / ${GLYPH_CLIMB.toFixed(3)}, 0.0, 1.0);
  float angle = strand.z + 2.6 * u * u + 0.9 * u;
  float radius = mix(uRuneR * ${GLYPH_RING.toFixed(4)}, uColumnR * 1.08, smoothstep(0.0, 0.42, u));
  float height = 0.02 + uHeight * 0.8 * pow(u, 1.5) + 0.12 * smoothstep(0.0, 0.12, u);
  ribbonCarry = vec4(step(height, uReachH + 0.05), age <= 0.0 ? 1.0 : 1.0 - smoothstep(0.35, 0.95, u), u, 0.0);
  return uFoot + vec3(cos(angle) * radius, height, sin(angle) * radius);
}
float glyphSize(vec4 strand) {
  float age = glyphAge(strand), u = clamp(age / ${GLYPH_CLIMB.toFixed(3)}, 0.0, 1.0);
  return uGlyph * (0.75 + 0.25 * smoothstep(0.0, 0.1, u)) * (1.0 - 0.5 * u) * step(0.0, age) * step(age, ${GLYPH_CLIMB.toFixed(3)});
}
`;

const GLYPH_SHADE = /* glsl */ `
${GLYPH_HASH}
${GLYPH_MARKS}
uniform vec3 uGold, uGoldHot, uGlow;
vec3 ribbonShade(float t, float side, vec4 strand) {
  // the same marks as the cell it lifted from: along the band across, and across the band upward
  vec2 grid = vec2(((0.5 - side * 0.5) - 0.1) / 0.8 * 3.0, (t - 0.08) / 0.84 * 4.0);
  float marks = glyphMarks(strand.x, grid, ${GLYPH_SEED.toFixed(1)}, vCarry.y);
  float r = length(vec2(side, t * 2.0 - 1.0));
  vec3 colour = mix(uGoldHot, uGold, 0.3 + 0.5 * vCarry.z) * marks * 1.6 + uGlow * exp(-r * r * 2.6) * 0.16 * vCarry.y;
  return colour * vCarry.x;
}
`;

// strand.x: 0 the ring under the hand, 1 a Queen's ring round the victim
const RING_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uHandRing, uBindRing;
uniform float uHandSize, uBindSize;
vec3 ribbonPoint(float t, vec4 strand) {
  bool bind = strand.x > 0.5;
  return (bind ? uBindRing : uHandRing) + vec3((t * 2.0 - 1.0) * (bind ? uBindSize : uHandSize), 0.0, 0.0);
}
float ribbonWidth(float t, vec4 strand) { return strand.x > 0.5 ? uBindSize : uHandSize; }
`;

const RING_SHADE = /* glsl */ `
${GLYPH_HASH}
${RUNE_RING}
uniform vec3 uGold, uGoldHot, uGlow;
uniform float uTime, uHandDrawn, uHand, uBind, uBindBurn;
vec3 ribbonShade(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float r = length(p);
  bool bind = strand.x > 0.5;
  float spin = uTime * (bind ? -0.8 : 1.3), c = cos(spin), s = sin(spin);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  float ink = runeRing(q * 0.5 + 0.5, bind ? 9.0 : 2.0);
  if (bind) {
    // it burns out from its rim as it is thrown up the column
    float front = 1.15 - 1.35 * uBindBurn + (hash(floor(q * 14.0)) - 0.5) * 0.18;
    float kept = uBindBurn > 0.0 ? 1.0 - smoothstep(front - 0.03, front + 0.03, r) : 1.0;
    float fromFront = (r - front) / 0.04;
    float edge = uBindBurn > 0.0 && uBindBurn < 1.0 ? exp(-fromFront * fromFront) * ink : 0.0;
    return (mix(uGold, uGoldHot, 0.2) * ink * kept * 1.35 + uGoldHot * edge * 1.5) * uBind;
  }
  float angle = fract(atan(p.y, p.x) / 6.2831853 + 0.5);
  float inked = uHandDrawn >= 1.0 ? 1.0 : 1.0 - smoothstep(uHandDrawn - 0.02, uHandDrawn + 0.004, angle);
  float fromPen = (angle - uHandDrawn) / 0.025;
  float pen = uHandDrawn > 0.0 && uHandDrawn < 1.0 ? exp(-fromPen * fromPen) * step(0.5, r) * step(r, 1.0) : 0.0;
  return (mix(uGold, uGoldHot, 0.2) * ink * inked * 1.4 + uGoldHot * pen * 2.0 + uGlow * exp(-r * r * 3.0) * 0.14) * uHand;
}
`;

class Unmaking implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: UnmakingTimeline;
  private readonly size: UnmakingSize;
  private readonly queen: boolean;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly rune: UnmakingRune;
  private readonly column: VoidColumn;
  private readonly ribbons: Ribbon[] = [];
  private readonly light: ParticlePool;
  private readonly matter: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null };
  private seconds = 0;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, seed, boardTop, stone, target } = cast, power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    this.timeline = unmakingTimeline(power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    this.queen = power >= QUEEN_POWER;
    const counts = unmakingCounts(cast.quality, power), size = this.size = unmakingSize(power, tile);
    const floor = { x: stone.x, y: boardTop, z: stone.z }, hand = { x: this.hand.x, y: this.hand.y, z: this.hand.z };
    const plan = { stone: floor, hand, timeline: this.timeline, size, counts, power, seed, tile };
    const start = penStart(plan), peels = glyphPeels(seed, counts.glyphs), loose = unmakingParticles(plan);
    const violet = look.flame, pale = look.core;

    this.rune = new UnmakingRune({ stone: floor, radius: size.rune, shock: size.shock / size.rune, start, peels, outer: this.queen, gold: LANCE_GOLD, goldHot: LANCE_GOLD_HOT, glow: violet, core: pale, seed });
    this.column = new VoidColumn({ foot: floor, radius: size.column, height: size.height, radial: counts.radial, edge: violet, inner: blend(violet, pale, 0.55), core: pale, void: blend(violet, 0x020005, 0.88), head: cast.brief ? 0.3 : 1, clear: size.clear, seed });

    const box = (value: unknown): THREE.IUniform => ({ value });
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uFoot: box(new THREE.Vector3(floor.x, floor.y, floor.z)), uHeight: box(size.height), uTime: box(0), uCamUp: box(new THREE.Vector3(0, 1, 0)),
      uCordRadius: box(size.cord), uTurns: box(2.3), uSpin: box(2.6), uCordHead: box(0), uFling: box(0), uCordWidth: box(0.016 * tile * (0.85 + 0.15 * power)), uGirth: box(1), uCords: box(0),
      uLoop: box(-1), uColumnR: box(size.column), uReachH: box(0), uGrains: box(0), uGrain: box(size.grain),
      uSince: box(-1), uRuneR: box(size.rune), uGlyph: box(size.glyph),
      uHandRing: box(new THREE.Vector3()), uBindRing: box(new THREE.Vector3(floor.x, target.y * 0.85, floor.z)), uHandSize: box(size.hand), uBindSize: box(size.bind),
      uHandDrawn: box(0), uHand: box(0), uBind: box(0), uBindBurn: box(0),
      uGold: box(new THREE.Color(LANCE_GOLD)), uGoldHot: box(new THREE.Color(LANCE_GOLD_HOT)), uGlow: box(new THREE.Color(violet)), uCore: box(new THREE.Color(pale)),
      uGain: box(1), uPixel: box(0.001),
    };
    const pick = (...names: string[]) => Object.fromEntries(names.map((name) => [name, u[name]]));
    const add = (ribbon: Ribbon) => { this.ribbons.push(ribbon); return ribbon; };
    const colours = ["uGold", "uGoldHot", "uGlow", "uCore", "uGain", "uPixel"];

    // the ring under the hand, and a Queen's ring round the victim
    const rings = add(new Ribbon({
      segments: 1, step: 0.5, strands: new Float32Array(this.queen ? [0, 0, 0, 0, 1, 0, 0, 0] : [0, 0, 0, 0]), facing: "up", order: 11,
      uniforms: pick("uHandRing", "uBindRing", "uHandSize", "uBindSize", "uTime", "uHandDrawn", "uHand", "uBind", "uBindBurn", ...colours), curve: RING_CURVE, shade: RING_SHADE,
    }));
    // the cords
    const cordStrands = new Float32Array(counts.cords * 4), random = dice(seed ^ 0xc0d5);
    for (let i = 0; i < counts.cords; i += 1) cordStrands.set([i / counts.cords + 0.08 * random(), i % 2, i % 3 === 2 ? 1 : 0, random()], i * 4);
    const cords = add(new Ribbon({
      segments: counts.segments, strands: cordStrands, halo: 3, order: 12, minPixels: 1.5,
      uniforms: pick("uFoot", "uHeight", "uCordRadius", "uTurns", "uSpin", "uTime", "uCordHead", "uFling", "uCordWidth", "uGirth", "uCords", ...colours), curve: CORD_CURVE, shade: CORD_SHADE,
    }));
    // the grains
    const grains = add(new Ribbon({
      segments: 1, step: 0.5, strands: strandSeeds(seed ^ 0x6a1, counts.grains), order: 14,
      uniforms: pick("uFoot", "uLoop", "uColumnR", "uHeight", "uReachH", "uGirth", "uGrains", "uGrain", "uTime", "uCamUp", ...colours),
      curve: SPRITE("grainAt(strand)", "uGrain * (0.55 + 0.9 * strand.y)", GRAIN_MORE), shade: GRAIN_SHADE,
    }));
    // the glyphs, each leaving its cell at the bearing that cell has turned to by then
    const lifted = peels.flatMap((peel, cell) => (peel < 0 ? [] : [[cell, peel, start + ((cell + 0.5) / RUNE_CELLS) * Math.PI * 2 + runeTurn(this.timeline, this.timeline.strikeAt + peel), random()]]));
    const glyphs = lifted.length > 0 ? add(new Ribbon({
      segments: 1, step: 0.5, strands: new Float32Array(lifted.flat()), order: 15,
      uniforms: pick("uFoot", "uSince", "uRuneR", "uColumnR", "uHeight", "uReachH", "uGlyph", "uCamUp", ...colours),
      curve: SPRITE("glyphAt(strand)", "glyphSize(strand)", GLYPH_MORE), shade: GLYPH_SHADE,
    })) : null;

    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: pale, mid: LANCE_GOLD, cool: violet }, blend: "add", floor: boardTop, seed });
    this.matter = new ParticlePool({
      particles: loose.matter, capacity: loose.matter.length, look: { hot: blend(look.smoke, violet, 0.3), mid: blend(look.smoke, 0x000000, 0.45), cool: blend(violet, 0x000000, 0.9) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.6,
    });
    this.object.add(this.rune.object, this.matter.object, this.column.object, rings.object, cords.object, grains.object, this.light.object);
    if (glyphs) this.object.add(glyphs.object);
    this.glow = { position: { x: stone.x, y: boardTop + 0.3 * tile, z: stone.z }, colour: look.light, intensity: 0, reach: (3.6 + 1.6 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    (this.uniforms.uCamUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const ribbon of this.ribbons) ribbon.fit(camera, height);
    this.apply(this.seconds);
    this.light.update(this.seconds, camera, height); this.matter.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void {
    this.uniforms.uGain.value = gain; this.rune.setGain(gain); this.column.setGain(gain); this.light.setGain(gain); this.matter.setGain(gain);
  }

  dispose(): void {
    this.rune.dispose(); this.column.dispose(); this.light.dispose(); this.matter.dispose();
    for (const ribbon of this.ribbons) ribbon.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const { cast, timeline, size, uniforms: u } = this, power = Math.max(0.5, cast.power);
    const now = unmakingState(timeline, seconds, power);
    // in the brief form the light on it flows at a third of the pace: nothing rushes
    const pace = cast.brief ? 0.35 : 1;
    u.uTime.value = seconds * pace;
    this.rune.setRune(now.drawn, now.scale, now.turn, now.ink); this.rune.setStone(now.dark, now.inhale);
    this.rune.setBlow(cast.brief ? -1 : now.sinceStrike, now.flash, cast.brief ? -1 : now.sinceSwallow); this.rune.setBurn(now.burnt, now.cold); this.rune.setTime(seconds * pace);
    this.column.set(now.reach, now.girth, now.column, now.flash, now.clear); this.column.setTime(seconds * pace);
    u.uGirth.value = now.girth; u.uReachH.value = now.reach * size.height;
    u.uCordHead.value = cast.brief ? now.reach : cordHead(now.reach, now.sinceStrike); u.uCords.value = now.cords; u.uFling.value = now.fling;
    u.uLoop.value = now.sinceStrike >= 0 ? now.sinceStrike * pace : cast.brief ? Math.max(-1, seconds - timeline.strikeAt + 0.4) * pace : -1;
    u.uGrains.value = now.grains;
    u.uSince.value = cast.brief ? -1 : now.sinceStrike;
    // the hand writes its ring under the palm; a Queen's ring round the victim tightens in the inhale and is
    // thrown up the column by the blow
    cast.origin(this.hand);
    (u.uHandRing.value as THREE.Vector3).set(this.hand.x, this.hand.y - 0.1 * cast.tile, this.hand.z);
    u.uHandDrawn.value = now.handDrawn; u.uHand.value = now.hand;
    if (this.queen) {
      const { beat, strikeAt } = timeline, since = now.sinceStrike, thrown = since < 0 ? 0 : 1 - Math.exp(-since / 0.12);
      const bind = u.uBindRing.value as THREE.Vector3, chest = cast.target.y * 0.85;
      bind.y = chest + (size.height * 0.85 - chest) * thrown;
      u.uBindSize.value = size.bind * (1 - 0.3 * now.inhale * now.inhale) * (1 + 0.8 * thrown);
      const shown = cast.brief ? 0.6 * Math.min(1, seconds / 0.4) : Math.min(1, Math.max(0, (seconds - beat[0]) / 0.25));
      u.uBind.value = since < 0 ? shown * (1 - 0.5 * now.inhale) + 0.6 * now.inhale : (1 - Math.min(1, since / 0.45)) * 1.3;
      u.uBindBurn.value = since < 0 ? 0 : Math.min(1, since / 0.4);
      if (cast.brief && seconds > strikeAt) u.uBind.value = 0.6 * Math.max(0, 1 - (seconds - strikeAt) / 0.5);
    }
    this.light.setAnchor(this.hand);
    // the light sits low in the rune until the column comes, and at the victim's chest while it stands
    this.glow.position.y = cast.boardTop + (0.3 + 0.7 * now.lightAt) * cast.tile;
    this.glow.intensity = now.light;
    this.matter.setLight(this.glow.position, cast.look.light, 0.18 * Math.min(2.5, now.light));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake;
    this.state.glow = now.light > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }
}

/** Korvenia's Unmaking, for its Bishop and Queen. */
export const makeUnmaking: SpellFactory = (cast) => new Unmaking(cast);
