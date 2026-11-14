// Adapted from AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Lance, drawn: Korvenia's lance of light from a caster's hand to a victim, in violet with gilt.
 * lance/lancePlan.ts decides what it is doing at each moment; this places the layers by it. Everything is a
 * function of the seconds since the cast, so a capture of any moment is the same however it was reached.
 *
 * The layers, back to front:
 *
 *   wash      violet light laid flat on the stone under the lance, pooled under the hand and the victim
 *   dust      what the blow lifts off the stone: the one layer that is matter, drawn with normal blending
 *   landing   the mystic kit's: a gilt sigil a pen writes on the stone, a shaft, motes rising, sparks, a thrown ring
 *   gears     rings of script standing square to the lance, ticking round like clockwork; one before the hand
 *   lance     a hot core in a sheath, and streamers wound round them: one instanced ribbon on a curve
 *   arcs      gilt arcs crawling on a Queen's lance (the shared strike)
 *   motes     drawn into the hand as it gathers, flung from the star when it goes in
 *   stars     the star at the hand and the star where it lands
 *
 * The reference's beam is three nested cylinders on a straight line, shaded by how squarely the wall faces the
 * eye. Ours is a ribbon on a curve that wavers: the sheath is shaded as a hollow shell seen from outside (bright
 * at its limbs), which gives the same reading of a tube with something hotter inside it, from one strip. The
 * streamers' helix, the star and the sweep of the pen are the reference's ideas; the front that is a spearhead,
 * the clockwork, the tail that runs into the star and the cooling sigil are ours.
 */
import * as THREE from "three";
import { RUNE_RING } from "../../mystic/beam";
import { beamControl, beamPoint, type Point } from "../../mystic/beamPlan";
import { MysticLanding } from "../../mystic/landing";
import type { SpellCast, SpellEffect, SpellFactory, SpellState } from "../spell";
import { LightningStrike } from "../shared/lightning";
import { channelCapacity, mergeChannels, solveChannel, type Channel } from "../shared/lightningPlan";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { dice, strandSeeds } from "../shared/ribbonPlan";
import { LANCE_GOLD, LANCE_GOLD_HOT, gearStation, gearTurn, lanceCounts, lanceSize, lanceState, lanceTimeline, type LanceBudget, type LanceSize, type LanceTimeline } from "./lancePlan";

/** How far the lance bows under its own length, and how far it may stray from its line, in units of its core's width. */
const BOW = 0.012;
const WAVER = 2.2;
/** Gears a lance can carry: the uniform array of their turns is this long. */
const MAX_GEARS = 8;

const AXIS = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uFrom, uControl, uTo;
uniform float uTime, uWaver, uSeed;
vec3 bez(float u) { float a = 1.0 - u; return a * a * uFrom + 2.0 * a * u * uControl + u * u * uTo; }
vec3 bezTangent(float u) { return normalize(2.0 * (1.0 - u) * (uControl - uFrom) + 2.0 * u * (uTo - uControl)); }
// two directions square to the lance at u
void lanceFrame(float u, out vec3 n, out vec3 b) {
  vec3 t = bezTangent(u);
  vec3 ref = abs(t.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  n = normalize(cross(t, ref)); b = cross(t, n);
}
// it wavers under its own power, but not at the hand and not at the victim (lancePlan.lanceWaver)
vec3 lanceAxis(float u) {
  vec3 n, b; lanceFrame(u, n, b);
  float sway = uWaver * pow(max(0.0, sin(PI * u)), 1.5) * (0.7 + 0.3 * u);
  return bez(u) + (n * (noise(vec2(u * 3.0 - uTime * 2.2, uSeed)) - 0.5) + b * (noise(vec2(u * 3.0 - uTime * 2.6, uSeed + 9.0)) - 0.5)) * 2.0 * sway;
}
`;

// strand.x says what a strand is: 0 the sheath, 1 the core, 2 and up a streamer
const LANCE_CURVE = /* glsl */ `
${AXIS}
uniform float uHead, uTail, uGirth, uWind, uCore, uSheath, uRadius, uTurns, uSpin;
vec3 ribbonPoint(float t, vec4 strand) {
  vec3 at = lanceAxis(t);
  if (strand.x < 1.5) return at;
  vec3 n, b; lanceFrame(t, n, b);
  float angle = strand.y * TAU + t * uTurns * (0.7 + 0.6 * strand.z) * TAU - uTime * uSpin * (0.6 + 0.8 * strand.w);
  // wound close along the lance, standing off round the hand and opening where it lands; gathered in at both ends
  float stand = smoothstep(0.0, 0.1, t) * (1.0 + 1.3 * (1.0 - smoothstep(0.0, 0.3, t)) + 0.9 * smoothstep(0.78, 0.95, t)) * (1.0 - 0.8 * smoothstep(0.94, 1.0, t));
  vec3 off = n * cos(angle) + b * sin(angle);
  // which side of the lance it is on, seen from the eye: the far side is drawn dimmer
  ribbonCarry.x = dot(normalize(mat3(modelViewMatrix) * off), normalize(-(modelViewMatrix * vec4(at, 1.0)).xyz));
  return at + off * uRadius * uWind * (0.6 + 0.8 * strand.z) * stand;
}
float ribbonWidth(float t, vec4 strand) {
  // while it flies it is a spearhead: a point at the front and a swell just behind it
  float flying = step(uHead, 0.999);
  float behindTip = (uHead - t - 0.07) / 0.04;
  float tip = mix(1.0, smoothstep(0.0, 0.07, uHead - t) * (1.0 + 0.8 * exp(-behindTip * behindTip)), flying);
  // narrow out of the hand, flaring into the star once it has landed, and drawn to nothing where the tail is
  float shape = (0.4 + 0.6 * smoothstep(0.0, 0.2, t)) * tip * smoothstep(-0.01, 0.06, t - uTail) * (1.0 + 0.7 * (1.0 - flying) * smoothstep(0.86, 1.0, t));
  if (strand.x < 0.5) return uSheath * uGirth * shape;
  if (strand.x < 1.5) return uCore * uGirth * shape;
  return uCore * (0.75 + 0.7 * strand.w) * (0.5 + 0.5 * smoothstep(0.0, 0.2, t));
}
`;

const LANCE_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCoreColour, uGlowColour, uGoldColour;
uniform float uTime, uHead, uTail, uPower, uLength, uStreamers;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float d = abs(side), across = 1.0 - d;
  // drawn out behind the front, and let go behind the tail
  float lit = (1.0 - smoothstep(uHead - 0.012, uHead + 0.003, t)) * smoothstep(uTail - 0.003, uTail + 0.03, t) * smoothstep(0.0, 0.02, t);
  float fromHead = (t - uHead) / 0.06;
  float head = uHead > 0.0 && uHead < 1.0 ? exp(-fromHead * fromHead) : 0.0;
  float fromTail = (t - uTail) / 0.05;
  float tail = uTail > 0.0 && uTail < 1.0 ? exp(-fromTail * fromTail) : 0.0;
  float run = t * uLength;
  vec3 colour;
  if (strand.x < 0.5) {
#ifdef RIBBON_HALO
    // the air the lance lights: no edge anywhere
    colour = uGlowColour * pow(across, 2.4) * 0.3 * (lit + 1.4 * head + tail);
#else
    // a hollow shell of light seen from outside is brightest at its limbs (ribbonPlan.acrossProfile)
    float shell = min(1.0, 0.32 / sqrt(max(1e-4, 1.0 - d * d))) * (1.0 - smoothstep(0.86, 1.0, d));
    // striations racing downrange, drawn out along the lance
    float streak = noise(vec2(run * 2.2 - uTime * 9.0, side * 2.5 + 3.0)) * 0.6 + noise(vec2(run * 5.0 - uTime * 14.0, side * 5.0)) * 0.4;
    streak = 0.35 + 1.3 * streak * streak;
    colour = mix(uGlowColour, uCoreColour, 0.3 * shell) * shell * streak * 0.9 * lit;
    // gilt flecks carried along its rim
    colour += uGoldColour * pow(d, 5.0) * (1.0 - smoothstep(0.88, 1.0, d)) * smoothstep(0.55, 0.8, noise(vec2(run * 6.0 - uTime * 11.0, 5.0 + sign(side)))) * 1.1 * lit;
    colour += uCoreColour * (head * 1.2 + tail * 0.8) * pow(across, 0.8);
#endif
  } else if (strand.x < 1.5) {
#ifdef RIBBON_HALO
    colour = uGlowColour * pow(across, 2.0) * 0.5 * (lit + head);
#else
    float hot = pow(across, 2.2);
    colour = mix(uGlowColour, uCoreColour, hot) * (0.5 * across + 1.7 * hot) * (0.85 + 0.3 * noise(vec2(run * 3.0 - uTime * 12.0, 1.0))) * lit + uCoreColour * (head + tail) * across * 2.0;
#endif
  } else {
    // a streamer: gilt or violet turn about, broken into dashes that run so it reads as moving, dimmer behind the lance
    float flow = smoothstep(0.2, 0.8, noise(vec2(run * 0.9 - uTime * 5.0, strand.y * 31.0)));
    vec3 hue = fract(strand.x * 0.5) < 0.25 ? uGoldColour : mix(uGlowColour, uCoreColour, 0.25);
    float front = 0.4 + 0.6 * smoothstep(-0.6, 0.6, vCarry.x);
#ifdef RIBBON_HALO
    colour = hue * pow(across, 2.0) * 0.12 * (0.3 + 0.7 * flow) * front * lit * uStreamers;
#else
    colour = (hue * pow(across, 1.5) * 0.75 + uCoreColour * pow(across, 6.0) * 0.25) * (0.25 + 0.75 * flow) * front * lit * (1.0 - smoothstep(0.9, 1.0, t)) * uStreamers;
#endif
  }
  return colour * uPower;
}
`;

// strand: x the station on the lance, y its size against the others, z its number, w 1 for the ring before the hand
const GEAR_CURVE = /* glsl */ `
${AXIS}
uniform float uHead, uTail, uGearSize, uMuzzleSize, uMuzzle;
float gearSize(vec4 strand) {
  if (strand.w > 0.5) return uMuzzleSize * (0.7 + 0.3 * uMuzzle);
  // it opens as the front passes it and closes as the tail does
  return uGearSize * strand.y * smoothstep(0.0, 0.07, uHead - strand.x) * (1.0 - smoothstep(-0.03, 0.04, uTail - strand.x));
}
// The ring before the hand stands square to the lance. The wheels threaded on it are canted and precess, as a
// coin does when it is spun, so they are never seen edge-on for long from the side or from above.
void gearPlane(vec4 strand, out vec3 along, out vec3 across) {
  vec3 n, b; lanceFrame(strand.x, n, b);
  if (strand.w > 0.5) { along = n; across = b; return; }
  float turn = uTime * (0.9 + 0.3 * strand.z) * (mod(strand.z, 2.0) < 0.5 ? 1.0 : -1.0) + strand.z * 2.4;
  along = n * cos(turn) + b * sin(turn);
  across = normalize((b * cos(turn) - n * sin(turn)) * 0.72 + bezTangent(strand.x) * 0.69);
}
vec3 ribbonAcross(float t, vec4 strand) { vec3 along, across; gearPlane(strand, along, across); return across; }
vec3 ribbonPoint(float t, vec4 strand) { vec3 along, across; gearPlane(strand, along, across); return lanceAxis(strand.x) + along * (t * 2.0 - 1.0) * gearSize(strand); }
float ribbonWidth(float t, vec4 strand) { return gearSize(strand); }
`;

const GEAR_SHADE = /* glsl */ `
${RIBBON_NOISE}
float hash(vec2 p) { return hash2(p); }
${RUNE_RING}
uniform vec3 uGoldColour, uGoldHot;
uniform float uTurn[${MAX_GEARS}];
uniform float uPower, uMuzzle, uMuzzleDrawn;
vec3 ribbonShade(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float turn = uTurn[int(strand.z + 0.5)], c = cos(turn), s = sin(turn);
  float ink = runeRing(vec2(p.x * c - p.y * s, p.x * s + p.y * c) * 0.5 + 0.5, strand.z * 3.0 + 1.0);
  if (strand.w > 0.5) {
    // the ring before the hand is written once round by a pen, whose tip is bright
    float angle = atan(p.y, p.x) / TAU + 0.5, r = length(p);
    float inked = uMuzzleDrawn >= 1.0 ? 1.0 : 1.0 - smoothstep(uMuzzleDrawn - 0.02, uMuzzleDrawn + 0.005, angle);
    float fromPen = (angle - uMuzzleDrawn) / 0.02;
    float pen = uMuzzleDrawn < 1.0 && uMuzzleDrawn > 0.0 ? exp(-fromPen * fromPen) * step(r, 1.0) * step(0.5, r) : 0.0;
    return (uGoldColour * ink * inked * 1.45 + uGoldHot * pen * 1.6) * uMuzzle * step(0.001, uMuzzleDrawn);
  }
  return uGoldColour * ink * (0.3 + 0.8 * uPower) * step(0.001, uPower);
}
`;

/** One-segment strands that run up the camera's up vector: squares that face the eye, `side` and `t` their axes. */
const SPRITE_CURVE = (centre: string, size: string, more: string) => /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCamUp;
${more}
vec3 ribbonPoint(float t, vec4 strand) { return (${centre}) + uCamUp * (t * 2.0 - 1.0) * (${size}); }
float ribbonWidth(float t, vec4 strand) { return ${size}; }
`;

const STAR_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCoreColour, uGlowColour, uGoldColour;
uniform float uTime, uStar, uImpact, uClock, uRing;
vec3 ribbonShade(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float r = length(p), a = atan(p.y, p.x);
  bool hand = strand.x < 0.5;
  float level = hand ? uStar : uImpact;
  float heart = exp(-r * r * 60.0), body = exp(-r * 5.5) * 0.5;
  // four long rays and four short between them, stepping round like the hands of a clock, and ragged ones that gutter
  // (thin as needles: measured by distance from the ray, not by angle, so they do not open into wedges)
  float turn = uClock * (hand ? 1.0 : -0.6), c = cos(turn), s = sin(turn);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c), k = vec2(q.x + q.y, q.x - q.y) * 0.7071;
  float rays = exp(-pow(min(abs(q.x), abs(q.y)) / 0.014, 2.0)) * exp(-r * 2.4) + 0.6 * exp(-pow(min(abs(k.x), abs(k.y)) / 0.012, 2.0)) * exp(-r * 5.5);
  float ragged = pow(max(0.0, noise(vec2(a * 3.0 + strand.x * 5.0, uTime * 3.0)) - 0.35), 2.0) * 6.0 * exp(-r * 4.0);
  // the ring a Queen's star throws on the blow
  float fromRing = (r - uRing * 0.85) / 0.045;
  float ring = !hand && uRing >= 0.0 && uRing < 1.0 ? exp(-fromRing * fromRing) * (1.0 - uRing) * 1.3 : 0.0;
  float edge = 1.0 - smoothstep(0.78, 1.0, r);
  return (uCoreColour * heart * 2.2 * level + uGlowColour * (body + ragged * 0.6) * level + uGoldColour * (rays * 1.3 * level + ring)) * edge;
}
`;

const MOTE_SHADE = /* glsl */ `
uniform vec3 uCoreColour, uGlowColour, uGoldColour;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float r = length(vec2(side, t * 2.0 - 1.0));
  float body = exp(-r * r * 6.0) * (1.0 - smoothstep(0.8, 1.0, r));
  return mix(strand.z < 0.5 ? uGlowColour : uGoldColour, uCoreColour, pow(body, 3.0)) * body * vCarry.x * 1.4;
}
`;

const DUST_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uSmokeColour, uGlowColour;
uniform float uImpact;
vec4 ribbonMatter(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float r = length(p);
  float body = exp(-r * r * 3.0) * (0.5 + 0.5 * noise(p * 2.4 + strand.yz * 19.0)) * (1.0 - smoothstep(0.8, 1.0, r));
  // lit by the star while it stands, grey once it has gone in
  return vec4(uSmokeColour * 0.4 + uGlowColour * min(uImpact, 1.5) * 0.3 * exp(-r * 1.5), body * vCarry.x * 0.75);
}
`;

const WASH_SHADE = /* glsl */ `
uniform vec3 uGlowColour;
uniform float uHead, uTail, uPower, uStar, uImpact;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  float lit = (1.0 - smoothstep(uHead - 0.05, uHead + 0.02, t)) * smoothstep(uTail - 0.02, uTail + 0.1, t);
  // the stone under the lance takes its light; it pools under the star at the hand and under the star where it lands
  float fromStar = (t - 0.93) / 0.07, fromHand = (t - 0.07) / 0.06;
  float pool = min(uImpact, 1.6) * exp(-fromStar * fromStar) * 0.9 + uStar * exp(-fromHand * fromHand) * 0.45;
  return uGlowColour * pow(across, 2.0) * (0.17 * uPower * lit + 0.3 * pool) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
}
`;

class Lance implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: LanceTimeline;
  private readonly counts: LanceBudget;
  private readonly size: LanceSize;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly ribbons: Ribbon[] = [];
  private readonly landing: MysticLanding;
  private readonly arcs: LightningStrike | null;
  private readonly hand = new THREE.Vector3();
  private readonly glowAt = new THREE.Vector3();
  private readonly turns = new Float32Array(MAX_GEARS);
  private seconds = 0;
  private arcTick = -1;

  constructor(private readonly cast: SpellCast) {
    const { look, target, stone, seed, quality, tile, boardTop } = cast;
    const power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    const distance = this.hand.distanceTo(new THREE.Vector3(target.x, target.y, target.z));
    this.timeline = lanceTimeline(distance, power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.total;
    this.counts = lanceCounts(quality, power); this.size = lanceSize(power, tile);
    const { counts, size } = this;
    const floor = boardTop + 0.02;

    const box = (value: unknown): THREE.IUniform => ({ value });
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uFrom: box(this.hand.clone()), uControl: box(new THREE.Vector3()), uTo: box(new THREE.Vector3(target.x, target.y, target.z)), uStone: box(new THREE.Vector3(stone.x, floor, stone.z)),
      uTime: box(0), uSeed: box((seed % 977) * 0.137), uWaver: box(size.core * WAVER), uLength: box(distance),
      uHead: box(0), uTail: box(0), uGirth: box(1), uWind: box(1), uPower: box(0), uStreamers: box(1), uCore: box(size.core), uSheath: box(size.sheath), uRadius: box(size.wind),
      uTurns: box(Math.max(1.5, distance * 0.55)), uSpin: box(7), uGearSize: box(size.sheath * 2.9), uMuzzleSize: box(size.muzzle), uMuzzle: box(0), uMuzzleDrawn: box(0),
      uTurn: box(this.turns), uStar: box(0), uImpact: box(0), uClock: box(0), uRing: box(-1), uStarSize: box(size.star), uImpactSize: box(size.impact), uImpactBehind: box(size.behind),
      uInflow: box(0), uInflowGlow: box(0), uFlung: box(-1), uMoteSize: box(0.022 * tile), uInflowRadius: box(size.star * 2.6),
      uSince: box(-1), uDustSize: box(size.sigil * 0.75), uFloor: box(floor), uWashWidth: box(tile * 0.5), uCamUp: box(new THREE.Vector3(0, 1, 0)),
      uCoreColour: box(new THREE.Color(look.core)), uGlowColour: box(new THREE.Color(look.flame)), uGoldColour: box(new THREE.Color(LANCE_GOLD)), uGoldHot: box(new THREE.Color(LANCE_GOLD_HOT)),
      uSmokeColour: box(new THREE.Color(look.smoke)), uGain: box(1), uPixel: box(0.001),
    };
    const pick = (...names: string[]) => Object.fromEntries(names.map((name) => [name, u[name]]));
    const axis = ["uFrom", "uControl", "uTo", "uTime", "uWaver", "uSeed"];
    const add = (ribbon: Ribbon) => { this.ribbons.push(ribbon); this.object.add(ribbon.object); return ribbon; };

    // light on the stone under the lance
    add(new Ribbon({
      segments: 12, strands: new Float32Array(4), halo: 0, facing: "up", order: 8,
      uniforms: pick(...axis, "uFloor", "uWashWidth", "uGlowColour", "uHead", "uTail", "uPower", "uStar", "uImpact", "uGain", "uPixel"),
      curve: /* glsl */ `
${AXIS}
uniform float uFloor, uWashWidth;
vec3 ribbonPoint(float t, vec4 strand) { vec3 p = bez(t); p.y = uFloor; return p; }
float ribbonWidth(float t, vec4 strand) { return uWashWidth * (1.0 + 0.9 * smoothstep(0.8, 1.0, t)); }
`, shade: WASH_SHADE,
    }));

    // dust the blow lifts: thrown out low across the stone, rising a little, settling
    add(new Ribbon({
      segments: 1, step: 0.5, strands: strandSeeds(seed ^ 0x5a17, counts.dust), matter: true, order: 9,
      uniforms: pick("uStone", "uSince", "uDustSize", "uCamUp", "uSmokeColour", "uGlowColour", "uImpact", "uGain", "uPixel"),
      curve: SPRITE_CURVE("dustAt(strand)", "dustSize(strand)", /* glsl */ `
uniform vec3 uStone;
uniform float uSince, uDustSize;
float dustAge(vec4 strand) { return clamp(uSince / (0.9 + 0.7 * strand.w), 0.0, 1.0); }
vec3 dustAt(vec4 strand) {
  float a = dustAge(strand), turn = strand.z * TAU, travel = (1.0 - exp(-3.0 * max(uSince, 0.0))) / 3.0;
  float r = uDustSize * 0.35 + (1.3 + 1.7 * strand.y) * travel;
  ribbonCarry.x = uSince >= 0.0 ? sin(PI * pow(a, 0.5)) : 0.0;
  return uStone + vec3(cos(turn) * r, 0.07 + 0.4 * strand.y * pow(a, 0.7), sin(turn) * r);
}
float dustSize(vec4 strand) { return uDustSize * (0.4 + 0.9 * dustAge(strand)) * (0.7 + 0.6 * strand.y); }
`), shade: DUST_SHADE,
    }));

    // the sigil on the stone, in gilt: the mystic kit's landing
    this.landing = new MysticLanding({
      budget: { strands: 0, rings: 0, motes: Math.round(counts.motes * 0.5), sparks: counts.sparks, segments: counts.segments },
      look: { core: LANCE_GOLD_HOT, glow: LANCE_GOLD, ember: look.ember }, radius: size.sigil, height: 1.9 * tile, seed: seed ^ 0x1a2d1,
    });
    this.landing.setCentre({ x: stone.x, y: boardTop, z: stone.z });
    this.object.add(this.landing.object);

    // rings of script threaded on the lance, and the one before the hand
    const gears = Math.min(MAX_GEARS - 1, counts.gears), gearStrands = new Float32Array((gears + 1) * 4);
    gearStrands.set([0.035, 1, 0, 1], 0);
    for (let i = 0; i < gears; i += 1) gearStrands.set([gearStation(i, gears), 0.8 + 0.4 * ((i * 5) % 3) / 2, i + 1, 0], (i + 1) * 4);
    add(new Ribbon({
      segments: 1, step: 0.5, strands: gearStrands, halo: 0, facing: "own", order: 11,
      uniforms: pick(...axis, "uHead", "uTail", "uGearSize", "uMuzzleSize", "uMuzzle", "uMuzzleDrawn", "uTurn", "uPower", "uGoldColour", "uGoldHot", "uGain", "uPixel"),
      curve: GEAR_CURVE, shade: GEAR_SHADE,
    }));

    // the lance: a sheath, a core, and the streamers
    const strands = new Float32Array((2 + counts.streamers) * 4), random = dice(seed ^ 0x51f15e);
    strands.set([0, 0, 0, 0, 1, 0, 0, 0]);
    for (let i = 0; i < counts.streamers; i += 1) strands.set([2 + i, i / counts.streamers + 0.1 * random(), random(), random()], (2 + i) * 4);
    add(new Ribbon({
      segments: counts.segments, strands, halo: 3.2, order: 12, minPixels: 1.5,
      uniforms: pick(...axis, "uHead", "uTail", "uGirth", "uWind", "uCore", "uSheath", "uRadius", "uTurns", "uSpin", "uPower", "uLength", "uStreamers", "uCoreColour", "uGlowColour", "uGoldColour", "uGain", "uPixel"),
      curve: LANCE_CURVE, shade: LANCE_SHADE,
    }));

    // arcs crawling on a Queen's lance
    this.arcs = counts.arcs > 0 && !cast.brief ? new LightningStrike({ capacity: counts.arcs * channelCapacity(3), look: { core: LANCE_GOLD_HOT, glow: LANCE_GOLD }, width: size.core * 0.6, halo: 4, order: 13 }) : null;
    if (this.arcs) this.object.add(this.arcs.object);

    // motes: drawn into the hand, and flung from the star
    const dirs = new Float32Array(counts.motes * 3);
    for (let i = 0; i < counts.motes; i += 1) {
      const turn = random() * Math.PI * 2, lift = random() * 2 - 1, flat = Math.sqrt(1 - lift * lift);
      dirs.set([Math.cos(turn) * flat, lift, Math.sin(turn) * flat], i * 3);
    }
    add(new Ribbon({
      segments: 1, step: 0.5, strands: strandSeeds(seed ^ 0x3c6e, counts.motes), halo: 0, order: 15, attributes: { aDir: { array: dirs, size: 3 } },
      uniforms: pick("uFrom", "uTo", "uCamUp", "uInflow", "uInflowGlow", "uFlung", "uMoteSize", "uInflowRadius", "uCoreColour", "uGlowColour", "uGoldColour", "uGain", "uPixel"),
      curve: SPRITE_CURVE("moteAt(strand)", "uMoteSize * (0.6 + 0.9 * strand.w)", /* glsl */ `
attribute vec3 aDir;
uniform vec3 uFrom, uTo;
uniform float uInflow, uInflowGlow, uFlung, uMoteSize, uInflowRadius;
vec3 moteAt(vec4 strand) {
  if (uFlung >= 0.0) {
    // flung from the star as it goes in: thrown against the air, then drifting up
    float life = 0.6 + 0.6 * strand.y, travel = (1.0 - exp(-2.6 * uFlung)) / 2.6;
    ribbonCarry.x = uFlung < life ? pow(1.0 - uFlung / life, 1.3) : 0.0;
    return uTo + aDir * (1.0 + 2.4 * strand.w) * travel + vec3(0.0, 0.35 * uFlung, 0.0);
  }
  // drawn into the hand: each starts out on a shell round it and winds in, one after another
  float p = clamp((uInflow - strand.y * 0.6) / 0.4, 0.0, 1.0), turn = p * 4.0 * (strand.w - 0.3);
  vec3 d = aDir; d.xz = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * d.xz;
  ribbonCarry.x = sin(PI * p) * uInflowGlow;
  return uFrom + d * uInflowRadius * (0.5 + 0.8 * strand.z) * pow(1.0 - p, 1.6);
}
`), shade: MOTE_SHADE,
    }));

    // the star at the hand, and the star where it lands: that one stands behind the victim, level along the floor away
    // from the eye (lancePlan LanceSize.behind), so the body is seen whole against its light and hides what is behind it
    add(new Ribbon({
      segments: 1, step: 0.5, strands: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]), halo: 0, order: 16,
      uniforms: pick("uFrom", "uTo", "uCamUp", "uStarSize", "uImpactSize", "uImpactBehind", "uStar", "uImpact", "uClock", "uRing", "uTime", "uCoreColour", "uGlowColour", "uGoldColour", "uGain", "uPixel"),
      curve: SPRITE_CURVE("strand.x < 0.5 ? uFrom : uTo + normalize(vec3(uTo.x - cameraPosition.x, 0.0, uTo.z - cameraPosition.z)) * uImpactBehind", "(strand.x < 0.5 ? uStarSize * (0.45 + 0.55 * min(uStar, 1.3)) : uImpactSize * (0.5 + 0.5 * min(uImpact, 1.8)))",
        "uniform vec3 uFrom, uTo;\nuniform float uStarSize, uImpactSize, uImpactBehind, uStar, uImpact;"), shade: STAR_SHADE,
    }));

    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    (this.uniforms.uCamUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const ribbon of this.ribbons) ribbon.fit(camera, height);
    this.arcs?.fit(camera, height);
    // the landing keeps its own clock; it is only ever advanced by what this was
    this.landing.update(Math.max(0, seconds), camera, height);
    return this.apply(this.seconds);
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; this.landing.setGain(gain); this.arcs?.setGain(gain); }

  dispose(): void {
    this.object.removeFromParent();
    for (const ribbon of this.ribbons) ribbon.dispose();
    this.landing.dispose(); this.arcs?.dispose();
  }

  private apply(seconds: number): SpellState {
    const { cast, timeline, uniforms: u, size } = this;
    const power = Math.max(0.5, cast.power);
    const state = lanceState(timeline, seconds, power);
    cast.origin(this.hand);
    const from = u.uFrom.value as THREE.Vector3, to = u.uTo.value as THREE.Vector3;
    from.copy(this.hand);
    const control = beamControl(from, to, BOW);
    (u.uControl.value as THREE.Vector3).set(control.x, control.y, control.z);
    // in the brief form the light on it flows and the wheels turn at a third of the pace: nothing rushes
    const pace = cast.brief ? 0.3 : 1;
    u.uTime.value = seconds * pace;
    u.uHead.value = state.head; u.uTail.value = state.tail; u.uGirth.value = state.girth; u.uWind.value = state.wind; u.uPower.value = state.power;
    // the more streamers there are, the dimmer each is: a Queen's lance is richer, not whiter
    u.uStreamers.value = state.streamers * Math.min(1, Math.sqrt(4 / Math.max(1, this.counts.streamers)));
    u.uMuzzle.value = state.muzzleGlow; u.uMuzzleDrawn.value = state.muzzleDrawn; u.uStar.value = state.star; u.uImpact.value = state.impact;
    u.uInflow.value = state.inflow; u.uInflowGlow.value = state.inflowGlow; u.uFlung.value = state.sinceGone; u.uSince.value = cast.brief ? -1 : state.sinceStrike;
    // the star's rays step round like the hands of a clock. Every lance throws a ring across the stone on the blow
    // (the landing's); a Queen's star throws a second, in the air
    u.uClock.value = gearTurn(seconds * pace, 5) * (Math.PI / 24);
    u.uRing.value = this.counts.rings > 1 && !cast.brief && state.sinceStrike >= 0 ? state.sinceStrike / 0.4 : -1;
    // the clockwork: each wheel ticks at its own rate, neighbours against each other; the wheel before the hand is the slowest
    for (let i = 0; i < MAX_GEARS; i += 1) this.turns[i] = gearTurn(seconds * pace + i * 0.37, i === 0 ? 4 : 5 + (i % 3)) * (Math.PI / 30) * (i % 2 === 0 ? 1 : -1);

    this.landing.setSigil(state.sigilDrawn, state.sigilGlow);
    this.landing.setShaft(state.shaft * 0.55); this.landing.setRise(state.rise);
    this.landing.setBurst(cast.brief ? -1 : state.sinceGone >= 0 ? state.sinceGone : state.sinceStrike);

    if (this.arcs) {
      const tick = Math.floor(seconds * 14), lit = state.power > 0 && state.head - state.tail > 0.25;
      if (lit && tick !== this.arcTick) { this.arcTick = tick; this.arcs.setChannel(this.arcChannel(tick, state.tail, state.head, control)); }
      const level = lit ? state.power * (0.6 + 0.4 * ((tick * 7) % 5) / 4) : 0;
      this.arcs.set({ head: 1, bright: level, forks: level, swell: 0.7 });
    }

    const at = beamPoint(from, control, to, state.lightAt);
    const glow = state.light > 0.01 ? { position: this.glowAt.set(at.x, at.y, at.z), colour: cast.look.light, intensity: state.light, reach: 4.2 * (size.sheath / 0.075) } : null;
    this.object.visible = !state.done;
    return { struck: state.struck, done: state.done, shake: state.shake, glow };
  }

  /** Short arcs from one place on the sheath to another a little further down it. */
  private arcChannel(tick: number, tail: number, head: number, control: Point): Channel {
    const { cast, counts, size, uniforms: u } = this;
    const random = dice(cast.seed * 17 + tick * 211), from = u.uFrom.value as THREE.Vector3, to = u.uTo.value as THREE.Vector3;
    const onSheath = (at: number): Point => {
      const p = beamPoint(from, control, to, at), turn = random() * Math.PI * 2, r = size.sheath * (1.2 + 0.8 * random());
      // near enough square to a lance that runs mostly level: a ring in the plane of up and across
      const along = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize(), side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(side, along);
      return { x: p.x + (side.x * Math.cos(turn) + up.x * Math.sin(turn)) * r, y: p.y + (side.y * Math.cos(turn) + up.y * Math.sin(turn)) * r, z: p.z + (side.z * Math.cos(turn) + up.z * Math.sin(turn)) * r };
    };
    const channels: Channel[] = [];
    for (let i = 0; i < counts.arcs; i += 1) {
      const span = 0.07 + 0.09 * random(), start = tail + 0.06 + random() * Math.max(0.01, head - tail - 0.14 - span);
      channels.push(solveChannel(cast.seed + tick * 211 + i * 19, onSheath(start), onSheath(start + span), { levels: 3, jag: 0.3 }));
    }
    return mergeChannels(channels);
  }
}

/** Korvenia's Lance, for its Bishop and Queen. */
export const makeLance: SpellFactory = (cast) => new Lance(cast);
