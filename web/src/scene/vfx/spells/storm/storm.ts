// Adapted from LinearAbiltyCastingThreeJS and AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Storm bolt, drawn: Kwind-09's arc from a caster's hand to a victim. storm/stormPlan.ts decides what it is
 * doing at each moment; this places the layers by it. Everything is a function of the seconds since the cast, so a
 * capture of any moment is the same however it was reached.
 *
 * The layers, back to front:
 *
 *   wash      light laid flat on the stone under the bolt and pooled under the victim (a ribbon lying down)
 *   smoke     where it earthed: the one layer that is matter, drawn with normal blending and lit by the strokes
 *   earth     the charge running out across the stone in arcs (a strike, kept low)
 *   bundle    the filaments from the hand, in parameter space: the path is all in the vertex shader
 *   leader    the strike that comes down on the victim: stepped leader, return stroke, re-strikes, cooling
 *   crackle   small arcs round the hand
 *   sparks    streaks thrown along the bolt and where it lands: each a ribbon along its own fall
 *   knots     the knot of light at the hand and the shell of lit air where it lands
 *
 * The bundle is the reference's Storm Lance (a strip of (t, side), kinks of value noise joined by straight lines,
 * a fan, a re-strike clock), changed as the plan says: its heaviest filament is the channel and keeps its path for
 * a few strikes, the thin ones blink, the ends are pinned on what was aimed at until the blow-out lets them go,
 * and it ends by breaking up and leaving a trail. The leader is the reference's `LightningBolt`.
 */
import * as THREE from "three";
import type { Point } from "../../mystic/beamPlan";
import type { SpellCast, SpellEffect, SpellFactory, SpellState } from "../spell";
import { LightningStrike } from "../shared/lightning";
import { channelCapacity, mergeChannels, solveChannel, strikeState, type Channel, type StrikeTimeline } from "../shared/lightningPlan";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { dice, strandSeeds } from "../shared/ribbonPlan";
import { STORM_KEEP, stormCounts, stormEarth, stormSize, stormSky, stormSparks, stormState, stormStrike, stormTimeline, type StormBudget, type StormSize, type StormTimeline } from "./stormPlan";

/** How far the bolt bows upward, as a fraction of its length, and how many kinks its coarsest layer has per board unit. */
const SAG = 0.035;
const CORNERS_PER_UNIT = 1.1;

const AXIS = /* glsl */ `
uniform vec3 uFrom, uTo;
uniform float uSag;
vec3 boltAxis(float t) { vec3 p = mix(uFrom, uTo, t); p.y += uSag * distance(uFrom, uTo) * sin(PI * t); return p; }
`;

const BUNDLE_CURVE = /* glsl */ `
${RIBBON_NOISE}
${AXIS}
uniform float uCrawl, uSeed, uTick, uKeep, uFan, uKink, uCorners, uSpread, uWidth, uBreak, uDrift, uPower;
vec3 ribbonPoint(float t, vec4 strand) {
  vec3 dir = normalize(uTo - uFrom);
  vec3 ref = abs(dir.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 n1 = normalize(cross(dir, ref)), n2 = cross(dir, n1);
  bool channel = strand.x < 0.001;
  // the channel keeps the path it burnt for a few strikes; the filaments round it are new on every one
  float shape = channel ? floor(uTick / uKeep) : uTick;
  float seed = hash1(strand.y * 91.7 + uSeed + shape * 3.77) * 97.0;
  // pinned at the hand, and on the victim until the blow-out lets it go; the fine kinks are free almost at once,
  // so it is jagged from the hand on and never a smooth tube
  float far = mix(smoothstep(0.0, 0.14, 1.0 - t), 1.0, uBreak);
  float ends = smoothstep(0.0, 0.1, t) * far, fine = smoothstep(0.0, 0.025, t) * mix(smoothstep(0.0, 0.03, 1.0 - t), 1.0, uBreak);
  vec2 off = vec2(0.0);
  float amp = 1.0, freq = uCorners;
  for (int i = 0; i < 4; i++) {
    float open = i == 0 ? ends : fine;
    off.x += open * amp * vnoise(t * freq + uCrawl, seed + 13.0 * float(i));
    off.y += open * amp * vnoise(t * freq + uCrawl * 1.17, seed + 71.3 + 13.0 * float(i));
    amp *= 0.55; freq *= 2.0;
  }
  off *= uKink * (channel ? 0.8 : 0.7 + 0.9 * strand.x);
  // the fan: gathered into the hand and the victim, widest between; flung open from the far end in the blow-out
  float angle = strand.z * TAU + t * (strand.w - 0.5) * 7.0 + uCrawl * 0.8;
  float fan = mix(pow(max(0.0, sin(PI * t)), 0.7), smoothstep(0.0, 0.25, t) * (0.6 + 0.8 * t), uBreak);
  off += vec2(cos(angle), sin(angle)) * uFan * uSpread * strand.x * fan;
  vec3 at = boltAxis(t) + n1 * off.x + n2 * off.y;
  // what is left hanging lifts and wanders as hot air does
  at.y += uDrift * (0.5 + noise(vec2(t * 4.0, uSeed)));
  at += n1 * uDrift * 0.7 * (noise(vec2(t * 3.0 + 5.0, uSeed)) - 0.5);
  return at;
}
float ribbonWidth(float t, vec4 strand) {
  bool channel = strand.x < 0.001;
  // each thin filament is there or not on the re-strike clock; the channel always is
  float there = channel ? 1.0 : step(0.3, hash1(uTick * 1.31 + strand.y * 57.0));
  float size = channel ? (uPower > 0.001 ? 1.8 : 0.7) : mix(1.0, 0.55, strand.x);
  return uWidth * size * (1.0 - 0.35 * t) * there;
}
`;

const BUNDLE_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCoreColour, uGlowColour, uTrailColour;
uniform float uTime, uReach, uTail, uPower, uTick, uBreak, uFeeler, uFeelerGlow, uTrail;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  bool channel = strand.x < 0.001;
  // drawn out behind the strike front, and let go from the hand
  float lit = (1.0 - smoothstep(uReach - 0.03, uReach + 0.004, t)) * smoothstep(uTail - 0.004, uTail + 0.06, t);
  // the front is where the air is breaking down
  float fromTip = (t - uReach) / 0.05;
  float tip = uReach > 0.0 && uReach < 1.0 ? exp(-fromTip * fromTip) : 0.0;
  // it breaks into dashes as it blows out
  float dash = uBreak > 0.0 ? smoothstep(uBreak * 1.1 - 0.15, uBreak * 1.1, noise(vec2(t * 16.0 + strand.y * 31.0, strand.z * 7.0 + uTick))) : 1.0;
  float level = uPower * (channel ? 1.0 : 0.62 - 0.25 * strand.x) * lit * dash;
#ifdef RIBBON_HALO
  vec3 colour = uGlowColour * pow(across, 2.0) * 0.4 * (level + tip * uPower * 1.5);
#else
  float hot = pow(across, 2.6), soft = pow(across, 1.1);
  vec3 colour = mix(uGlowColour, uCoreColour, hot) * (soft * 0.5 + hot * 1.6) * level + uCoreColour * tip * soft * 2.5 * uPower;
#endif
  if (channel) {
    // before the front: one faint feeler, lit as far as it has stabbed, with a bead at its head.
    // after the bundle: the burnt channel, dull, thinning in patches
    float fromFeeler = (t - uFeeler) / 0.025;
    float feeler = uFeelerGlow * (0.35 * (1.0 - smoothstep(uFeeler - 0.012, uFeeler + 0.002, t)) + 1.6 * exp(-fromFeeler * fromFeeler));
    float wisp = uTrail * smoothstep(0.0, 0.08, t) * smoothstep(0.15, 0.6, noise(vec2(t * 9.0 - uTime * 0.6, 3.0)) + uTrail * 0.6);
#ifdef RIBBON_HALO
    colour += uGlowColour * pow(across, 2.0) * (0.25 * feeler + 0.2 * wisp);
#else
    colour += mix(uGlowColour, uCoreColour, pow(across, 3.0)) * pow(across, 1.4) * feeler + uTrailColour * pow(across, 1.2) * wisp * 0.9;
#endif
  }
  return colour;
}
`;

const SPARK_CURVE = /* glsl */ `
${RIBBON_NOISE}
${AXIS}
attribute vec4 aBirth;
attribute vec3 aAway;
uniform float uClock, uFloor, uSparkWidth, uStreak;
vec3 sparkAt(float age) {
  // thrown against the air, falling, and skipping once off the stone with most of its fall lost
  float drag = 2.2, travel = (1.0 - exp(-drag * age)) / drag;
  vec3 p = boltAxis(aBirth.x) + aAway * aBirth.w * travel + vec3(0.0, -6.5, 0.0) * 0.5 * age * age;
  float under = uFloor - p.y;
  if (under > 0.0) p.y = uFloor + under * 0.3;
  return p;
}
vec3 ribbonPoint(float t, vec4 strand) {
  float age = uClock - aBirth.y;
  ribbonCarry.x = age / aBirth.z;
  // t runs back in time: the streak is where the spark has just been
  return sparkAt(max(0.0, age - t * uStreak * (0.5 + strand.z)));
}
float ribbonWidth(float t, vec4 strand) {
  float age = uClock - aBirth.y;
  return aBirth.y >= 0.0 && age > 0.0 && age < aBirth.z ? uSparkWidth * (0.6 + 0.8 * strand.w) * (1.0 - 0.7 * t) : 0.0;
}
`;

const SPARK_SHADE = /* glsl */ `
uniform vec3 uCoreColour, uGlowColour;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side), left = clamp(1.0 - vCarry.x, 0.0, 1.0);
  // white as it leaves, the kingdom's colour as it cools
  return mix(uGlowColour, uCoreColour, left * left) * pow(across, 1.5) * (1.0 - t) * pow(left, 0.7) * 2.2;
}
`;

/** One-segment strands that run up the camera's up vector: squares that face the eye, `side` and `t` their axes. */
const SPRITE_CURVE = (centre: string, size: string, more = "") => /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCamUp;
${more}
vec3 ribbonPoint(float t, vec4 strand) { return (${centre}) + uCamUp * (t * 2.0 - 1.0) * (${size}); }
float ribbonWidth(float t, vec4 strand) { return ${size}; }
`;

const KNOT_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uCoreColour, uGlowColour;
uniform float uTime, uTick, uSeed, uKnot, uShell;
vec3 ribbonShade(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float r = length(p), a = atan(p.y, p.x);
  float edge = 1.0 - smoothstep(0.8, 1.0, r);
  if (strand.x < 0.5) {
    // the knot at the hand: a hard heart, a soft body, and tongues of arc that are new on every tick
    float heart = exp(-r * r * 46.0), body = exp(-r * 5.0) * 0.5;
    float tongues = pow(max(0.0, vnoise(a * 2.6 + uTick * 7.1, uSeed)), 3.0) * exp(-r * 3.0) * 1.6;
    return (uCoreColour * heart * 2.0 + uGlowColour * (body + tongues)) * edge * uKnot;
  }
  // the shell of lit air where it lands: a ball seen from outside is brightest at its limb, and it boils
  // and its edge is ragged and new on every tick: lit air, not a bubble
  float q = r / (0.56 + 0.26 * noise(vec2(a * 1.9 + uTick * 3.0, uTime * 3.0)));
  float limb = min(1.2, 0.22 / sqrt(max(1e-3, 1.0 - q * q))) * (1.0 - smoothstep(0.82, 1.0, q));
  float boil = pow(noise(vec2(a * 3.1 + uTime * 2.0, r * 6.0 - uTime * 5.0 + uTick)), 1.6);
  float heart = exp(-r * r * 9.0);
  return (uGlowColour * limb * boil * 1.1 + mix(uGlowColour, uCoreColour, 0.6) * heart * 1.1) * edge * uShell;
}
`;

const SMOKE_SHADE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uSmokeColour, uGlowColour;
uniform float uFlash;
vec4 ribbonMatter(float t, float side, vec4 strand) {
  vec2 p = vec2(side, t * 2.0 - 1.0);
  float r = length(p);
  float body = exp(-r * r * 3.2) * (0.55 + 0.45 * noise(p * 2.6 + strand.yz * 17.0)) * (1.0 - smoothstep(0.8, 1.0, r));
  // lit from inside by the strokes, a dull grey between them
  vec3 colour = uSmokeColour * 0.3 + uGlowColour * uFlash * 0.55 * exp(-r * 1.5);
  return vec4(colour, body * vCarry.x * 0.6);
}
`;

const WASH_SHADE = /* glsl */ `
uniform vec3 uGlowColour;
uniform float uReach, uTail, uPower, uShell, uKnot, uFeelerGlow;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  float lit = (1.0 - smoothstep(uReach - 0.05, uReach + 0.02, t)) * smoothstep(uTail - 0.02, uTail + 0.1, t);
  // the stone under the bolt takes its light; under the hand and under the victim it pools
  float fromShell = (t - 0.93) / 0.07, fromKnot = (t - 0.07) / 0.06;
  float pool = uShell * exp(-fromShell * fromShell) * 1.3 + uKnot * exp(-fromKnot * fromKnot) * 0.5;
  return uGlowColour * pow(across, 2.0) * (0.16 * uPower * lit + 0.3 * pool) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
}
`;

class StormBolt implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: StormTimeline;
  private readonly counts: StormBudget;
  private readonly size: StormSize;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly ribbons: Ribbon[] = [];
  private readonly leaders: { strike: LightningStrike; timeline: StrikeTimeline; from: Point; path: number }[] = [];
  private readonly earth: LightningStrike | null;
  private readonly crackle: LightningStrike | null;
  private readonly hand = new THREE.Vector3();
  private readonly glowAt = new THREE.Vector3();
  private seconds = 0;
  private earthPath = -1;
  private crackleTick = -1;

  constructor(private readonly cast: SpellCast) {
    const { look, target, stone, seed, quality, tile, boardTop } = cast;
    const power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    const distance = this.hand.distanceTo(new THREE.Vector3(target.x, target.y, target.z));
    this.timeline = stormTimeline(distance, power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.total;
    this.counts = stormCounts(quality, power); this.size = stormSize(power, tile);
    const { counts, size } = this;
    const floor = boardTop + 0.02;

    const box = (value: unknown): THREE.IUniform => ({ value });
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uFrom: box(this.hand.clone()), uTo: box(new THREE.Vector3(target.x, target.y, target.z)), uStone: box(new THREE.Vector3(stone.x, floor, stone.z)),
      uSag: box(SAG), uTime: box(0), uClock: box(0), uCrawl: box(0), uSeed: box((seed % 977) * 0.137), uTick: box(0), uKeep: box(STORM_KEEP),
      uFan: box(size.fan), uKink: box(size.kink), uCorners: box(Math.max(3, distance * CORNERS_PER_UNIT)), uSpread: box(1), uWidth: box(size.filament),
      uBreak: box(0), uDrift: box(0), uPower: box(0), uReach: box(0), uTail: box(0), uFeeler: box(0), uFeelerGlow: box(0), uTrail: box(0),
      uKnot: box(0), uShell: box(0), uKnotSize: box(size.knot), uShellSize: box(size.shell), uFlash: box(0), uSmoke: box(0), uSince: box(-1),
      uFloor: box(floor), uSparkWidth: box(size.filament * 0.3), uStreak: box(0.07), uWashWidth: box(tile * 0.55), uCamUp: box(new THREE.Vector3(0, 1, 0)),
      uCoreColour: box(new THREE.Color(look.core)), uGlowColour: box(new THREE.Color(look.flame)), uTrailColour: box(new THREE.Color(look.ember).multiplyScalar(0.55)),
      uSmokeColour: box(new THREE.Color(look.smoke)), uGain: box(1), uPixel: box(0.001),
    };
    const pick = (...names: string[]) => Object.fromEntries(names.map((name) => [name, u[name]]));
    const add = (ribbon: Ribbon) => { this.ribbons.push(ribbon); this.object.add(ribbon.object); return ribbon; };

    // light on the stone under the bolt
    add(new Ribbon({
      segments: 12, strands: new Float32Array(4), halo: 0, facing: "up", order: 8,
      uniforms: pick("uFrom", "uTo", "uSag", "uFloor", "uWashWidth", "uGlowColour", "uReach", "uTail", "uPower", "uShell", "uKnot", "uFeelerGlow", "uGain", "uPixel"),
      curve: /* glsl */ `
#define PI 3.14159265
${AXIS}
uniform float uFloor, uWashWidth;
vec3 ribbonPoint(float t, vec4 strand) { vec3 p = boltAxis(t); p.y = uFloor; return p; }
float ribbonWidth(float t, vec4 strand) { return uWashWidth * (1.0 + 0.9 * smoothstep(0.8, 1.0, t)); }
`, shade: WASH_SHADE,
    }));

    // smoke where it earthed: squares that face the eye, rising and spreading
    add(new Ribbon({
      segments: 1, step: 0.5, strands: strandSeeds(seed ^ 0x5a17, counts.smoke), matter: true, order: 9,
      uniforms: pick("uStone", "uSince", "uSmoke", "uShellSize", "uCamUp", "uSmokeColour", "uGlowColour", "uFlash", "uGain", "uPixel"),
      curve: SPRITE_CURVE("puffAt(strand)", "puffSize(strand)", /* glsl */ `
uniform vec3 uStone;
uniform float uSince, uSmoke, uShellSize;
float puffAge(vec4 strand) { return clamp((uSince - strand.y * 0.5) / (0.9 + 0.6 * strand.w), 0.0, 1.0); }
vec3 puffAt(vec4 strand) {
  float a = puffAge(strand), turn = strand.z * TAU;
  float r = uShellSize * (0.15 + 0.55 * strand.w) * (1.0 + 0.9 * a);
  ribbonCarry.x = uSince > strand.y * 0.5 ? sin(PI * pow(a, 0.55)) * uSmoke : 0.0;
  return uStone + vec3(cos(turn) * r + 0.1 * sin(a * 3.0 + strand.y * 9.0), 0.1 + (0.5 + 0.9 * strand.y) * pow(a, 0.8), sin(turn) * r);
}
float puffSize(vec4 strand) { return uShellSize * (0.35 + 0.75 * puffAge(strand)) * (0.7 + 0.6 * strand.z); }
`), shade: SMOKE_SHADE,
    }));

    // the charge running out across the stone
    this.earth = counts.earth > 0 && !cast.brief ? new LightningStrike({ capacity: counts.earth * channelCapacity(3, 1, 2), look: { core: look.core, glow: look.flame }, width: size.leader * 0.7, halo: 5, order: 10 }) : null;
    if (this.earth) this.object.add(this.earth.object);

    // the bundle
    add(new Ribbon({
      segments: counts.segments, strands: strandSeeds(seed, counts.filaments), halo: 5.5, order: 12, minPixels: 1.6,
      uniforms: pick("uFrom", "uTo", "uSag", "uTime", "uCrawl", "uSeed", "uTick", "uKeep", "uFan", "uKink", "uCorners", "uSpread", "uWidth", "uBreak", "uDrift", "uPower",
        "uReach", "uTail", "uFeeler", "uFeelerGlow", "uTrail", "uCoreColour", "uGlowColour", "uTrailColour", "uGain", "uPixel"),
      curve: BUNDLE_CURVE, shade: BUNDLE_SHADE,
    }));

    // the leaders that come down on the victim
    if (!cast.brief) for (let which = 0; which < counts.strikes; which += 1) {
      const strike = new LightningStrike({ capacity: channelCapacity(counts.levels, counts.forks, 3), look: { core: look.core, glow: look.flame }, width: size.leader * (which === 0 ? 1 : 0.75), halo: 6, fadeIn: 0.3, order: 14 });
      this.object.add(strike.object);
      this.leaders.push({ strike, timeline: stormStrike(this.timeline, seed, power, which), from: stormSky(stone, seed, power, tile, which), path: -1 });
    }

    // arcs round the hand
    this.crackle = counts.crackle > 0 && !cast.brief ? new LightningStrike({ capacity: counts.crackle * channelCapacity(3), look: { core: look.core, glow: look.flame }, width: size.filament * 0.8, halo: 4.5, order: 14 }) : null;
    if (this.crackle) this.object.add(this.crackle.object);

    // sparks
    const sparks = stormSparks(seed, counts.sparks, this.timeline, this.leaders[0]?.timeline.strokes ?? [this.timeline.strikeAt]);
    add(new Ribbon({
      segments: 2, step: 0.5, strands: strandSeeds(seed ^ 0x9e37, counts.sparks), halo: 0, order: 15, minPixels: 1.2,
      attributes: { aBirth: { array: sparks.birth, size: 4 }, aAway: { array: sparks.away, size: 3 } },
      uniforms: pick("uFrom", "uTo", "uSag", "uClock", "uFloor", "uSparkWidth", "uStreak", "uCoreColour", "uGlowColour", "uGain", "uPixel"),
      curve: SPARK_CURVE, shade: SPARK_SHADE,
    }));

    // the knot at the hand and the shell where it lands
    add(new Ribbon({
      segments: 1, step: 0.5, strands: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]), halo: 0, order: 16,
      uniforms: pick("uFrom", "uTo", "uCamUp", "uKnotSize", "uShellSize", "uCoreColour", "uGlowColour", "uTime", "uTick", "uSeed", "uKnot", "uShell", "uGain", "uPixel"),
      curve: SPRITE_CURVE("strand.x < 0.5 ? uFrom : uTo", "(strand.x < 0.5 ? uKnotSize : uShellSize)", "uniform vec3 uFrom, uTo;\nuniform float uKnotSize, uShellSize;"), shade: KNOT_SHADE,
    }));

    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    (this.uniforms.uCamUp.value as THREE.Vector3).set(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const ribbon of this.ribbons) ribbon.fit(camera, height);
    for (const leader of this.leaders) leader.strike.fit(camera, height);
    this.earth?.fit(camera, height); this.crackle?.fit(camera, height);
    return this.apply(this.seconds);
  }

  setGain(gain: number): void {
    this.uniforms.uGain.value = gain;
    for (const leader of this.leaders) leader.strike.setGain(gain);
    this.earth?.setGain(gain); this.crackle?.setGain(gain);
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const ribbon of this.ribbons) ribbon.dispose();
    for (const leader of this.leaders) leader.strike.dispose();
    this.earth?.dispose(); this.crackle?.dispose();
  }

  private apply(seconds: number): SpellState {
    const { cast, timeline, uniforms: u, size } = this;
    const power = Math.max(0.5, cast.power);
    const state = stormState(timeline, seconds, power, cast.seed % 1000);
    cast.origin(this.hand);
    (u.uFrom.value as THREE.Vector3).copy(this.hand);
    // in the brief form the lit air boils at a third of the pace: nothing rushes
    u.uTime.value = seconds * (cast.brief ? 0.3 : 1); u.uClock.value = seconds;
    // the kinks crawl while it stands and all but stop once it is only a trail
    u.uCrawl.value = (cast.brief ? 0.25 : 0.9) * Math.min(seconds, timeline.out) + 0.12 * Math.max(0, seconds - timeline.out);
    u.uTick.value = state.tick; u.uSpread.value = state.spread; u.uBreak.value = state.breakup; u.uDrift.value = state.drift;
    u.uPower.value = state.power; u.uReach.value = state.reach; u.uTail.value = state.tail; u.uFeeler.value = state.feeler; u.uFeelerGlow.value = state.feelerGlow;
    u.uTrail.value = state.trail; u.uKnot.value = state.knot; u.uShell.value = state.shell; u.uSmoke.value = state.smoke; u.uSince.value = state.sinceStrike;

    // the leaders: a new path only when the plan says the old one is spent
    let flash = 0;
    for (const [which, leader] of this.leaders.entries()) {
      const strike = strikeState(leader.timeline, seconds);
      if (strike.path !== leader.path) {
        leader.path = strike.path;
        leader.strike.setChannel(solveChannel(cast.seed + which * 7919 + strike.path * 131, leader.from, cast.target, {
          levels: this.counts.levels, jag: 0.13, forks: this.counts.forks, forkLevels: 3, lean: { x: 0, y: -1, z: 0 }, leaning: 0.55, floor: cast.boardTop + 0.05,
        }));
      }
      leader.strike.set(strike, 1.5);
      flash = Math.max(flash, strike.connected ? strike.bright : 0);
    }
    u.uFlash.value = this.leaders.length > 0 ? flash : state.shell;

    // the charge across the stone: each stroke finds its own way out, and the last one cools where it lies
    const first = this.leaders[0];
    if (this.earth && first) {
      const strike = strikeState(first.timeline, seconds);
      if (strike.connected && strike.stroke !== this.earthPath) { this.earthPath = strike.stroke; this.earth.setChannel(this.earthChannel(strike.stroke)); }
      const since = seconds - first.timeline.strokes[Math.max(0, strike.stroke)];
      this.earth.set({ head: strike.connected ? Math.min(1, since / 0.045) : 0, bright: strike.connected ? strike.bright : 0, forks: strike.connected ? strike.bright / 0.55 : 0, swell: strike.swell }, 1.2);
    }

    // arcs round the hand, new on every tick of the re-strike clock
    if (this.crackle) {
      const tick = Math.floor(seconds * 24);
      if (state.crackle > 0 && tick !== this.crackleTick) { this.crackleTick = tick; this.crackle.setChannel(this.crackleChannel(tick)); }
      this.crackle.object.position.copy(this.hand);
      const level = state.crackle * (0.55 + 0.45 * ((tick * 7) % 5) / 4);
      this.crackle.set({ head: 1, bright: level, forks: level, swell: 0.6 });
    }

    const glow = state.light > 0.01
      ? { position: this.glowAt.copy(this.hand).lerp(u.uTo.value as THREE.Vector3, state.lightAt), colour: cast.look.light, intensity: state.light, reach: 4.5 * (size.fan / 0.17) }
      : null;
    this.object.visible = !state.done;
    return { struck: state.struck, done: state.done, shake: state.shake, glow };
  }

  /** Arcs from under the victim out across the stone, kept low. */
  private earthChannel(stroke: number): Channel {
    const { cast, counts, size } = this;
    const floor = cast.boardTop + 0.02, stone = { x: cast.stone.x, y: floor, z: cast.stone.z };
    const ends = stormEarth(stone, cast.seed + stroke * 53, counts.earth, size.earth);
    const channels = ends.map((end, i) => {
      // each leaves from under the feet, a little way toward where it is going
      const from = { x: stone.x + (end.x - stone.x) * 0.12, y: floor, z: stone.z + (end.z - stone.z) * 0.12 };
      const channel = solveChannel(cast.seed + stroke * 53 + i * 17, from, { x: end.x, y: floor, z: end.z }, { levels: 3, jag: 0.2, forks: 1, forkLevels: 2, floor });
      // flattened: it creeps over the stone and only just lifts off it
      for (let p = 0; p < channel.points.length / 3; p += 1) channel.points[p * 3 + 1] = floor + 0.25 * Math.max(0, channel.points[p * 3 + 1] - floor);
      return channel;
    });
    return mergeChannels(channels);
  }

  /** Short arcs leaping from the hand to points on a small ball round it, in the hand's own space. */
  private crackleChannel(tick: number): Channel {
    const { cast, counts, size } = this;
    const random = dice(cast.seed * 31 + tick * 101), channels: Channel[] = [];
    const onBall = (radius: number): Point => {
      const turn = random() * Math.PI * 2, lift = random() * 2 - 1, flat = Math.sqrt(1 - lift * lift), r = size.knot * radius;
      return { x: Math.cos(turn) * flat * r, y: lift * r, z: Math.sin(turn) * flat * r };
    };
    for (let i = 0; i < counts.crackle; i += 1) channels.push(solveChannel(cast.seed + tick * 101 + i * 13, onBall(0.12), onBall(0.8 + 0.9 * random()), { levels: 3, jag: 0.3 }));
    return mergeChannels(channels);
  }
}

/** Kwind-09's Storm bolt, for its Bishop and Queen. */
export const makeStormBolt: SpellFactory = (cast) => new StormBolt(cast);
