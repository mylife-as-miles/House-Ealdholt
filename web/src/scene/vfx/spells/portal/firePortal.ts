// Adapted from LinearAbilityExtThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The Fire portal, drawn: Solforiz strikes a ring of fire in the air over the victim and breathes fire through it.
 * portal/firePortalPlan.ts decides what it is doing at each moment and where everything loose is; this builds the
 * layers once, and afterwards only moves one clock and a handful of envelopes.
 *
 * The layers, back to front:
 *
 *   splash   the stone where the fire lands: flames spreading over it, and the char they leave
 *   smoke    off the burning stone, and the last puff out of the portal as it shuts
 *   portal   the struck ring and the black way through (portal/portal.ts, which a summon can hang on its own)
 *   breath   the jet's hot core: strands of flame from the way through down onto the victim and the stone
 *   light    the flicked spark, the ring's sparks skipping on the board, the billowing flame, embers, and the drawn
 *            glow that stands in for bloom on the lowest tier
 *
 * It draws light and matter and nothing else: the match kills the victim when `struck` turns true, marks the stone,
 * sounds the blow, and shakes the camera by what this reports.
 */
import * as THREE from "three";
import type { SpellCast, SpellEffect, SpellFactory, SpellGlow, SpellState } from "../spell";
import { ParticlePool } from "../shared/particles";
import { RIBBON_NOISE, Ribbon } from "../shared/ribbon";
import { strandSeeds } from "../shared/ribbonPlan";
import {
  QUEEN_POWER, firePortalCounts, firePortalGeometry, firePortalParticles, firePortalSize, firePortalState, firePortalTimeline, type FirePortalSize,
  type FirePortalTimeline, type PortalJet,
} from "./firePortalPlan";
import { FIRE_RAMP, FirePortal, type PortalLook } from "./portal";

/** `from` moved `share` of the way to `to`, as a hex colour. */
function blend(from: number, to: number, share: number): number {
  return new THREE.Color(from).lerp(new THREE.Color(to), share).getHex();
}

const BREATH_CURVE = /* glsl */ `
${RIBBON_NOISE}
uniform vec3 uSource, uControl, uSplash;
uniform float uLength, uHead, uTail, uTime, uMouth, uSpread, uFloor;
vec3 jetAt(float u) { float a = 1.0 - u; return a * a * uSource + 2.0 * a * u * uControl + u * u * uSplash; }
vec3 ribbonPoint(float t, vec4 strand) {
  // firePortalPlan.jetPoint: the stream thrown out of the portal along its face, falling as it goes
  vec3 p = jetAt(t), ahead = jetAt(min(t + 0.02, 1.0)) - jetAt(max(t - 0.02, 0.0));
  vec3 along = normalize(ahead), side = normalize(cross(along, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0)), lift = cross(side, along);
  // it billows: each strand wanders off the stream's line, more the further it has come, on noise that runs with it
  float run = t * uLength * 2.6 - uTime * 11.0;
  float wander = (0.2 + 0.9 * t) * uSpread * (0.4 + 0.6 * strand.w);
  vec2 off = vec2(noise(vec2(run, strand.y * 17.0)) - 0.5, noise(vec2(run + 5.3, strand.z * 17.0)) - 0.5) * 2.0 * wander;
  p += side * off.x + lift * off.y;
  // what reaches the stone runs along it
  p.y = max(p.y, uFloor + 0.03);
  return p;
}
float ribbonWidth(float t, vec4 strand) {
  float shown = (1.0 - smoothstep(uHead - 0.05, uHead, t)) * smoothstep(uTail, uTail + 0.05, t) * step(0.001, uHead);
  return mix(uMouth, uSpread, pow(t, 0.8)) * (0.55 + 0.5 * strand.w) * shown;
}
`;

const BREATH_SHADE = /* glsl */ `
${RIBBON_NOISE}
${FIRE_RAMP}
uniform float uTime, uJet, uLength;
vec3 ribbonShade(float t, float side, vec4 strand) {
  float across = 1.0 - abs(side);
  float churn = noise(vec2(t * uLength * 3.0 - uTime * 14.0, side * 2.0 + strand.y * 9.0)) * 0.65 + noise(vec2(t * uLength * 7.0 - uTime * 23.0, side * 4.0)) * 0.35;
  // a temperature that falls as it runs from the way through, with the churn of a flame in it
  float heat = clamp(1.0 - 0.7 * t + 0.3 * (churn - 0.5), 0.0, 1.0) * (0.78 + 0.22 * across);
#ifdef RIBBON_HALO
  return fireColour(heat * 0.85) * pow(across, 2.0) * 0.3 * uJet;
#else
  return fireColour(heat) * (pow(across, 1.6) * 0.8 + pow(across, 5.0) * 0.6) * (0.6 + 0.8 * churn) * uJet;
#endif
}
`;

const SPLASH_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uReach;
varying vec2 vPlace;
void main() {
  vPlace = position.xy * uReach;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uCentre + vec3(vPlace.x, 0.0, vPlace.y), 1.0);
}
`;

const SPLASH_FRAGMENT = /* glsl */ `
${RIBBON_NOISE}
${FIRE_RAMP}
uniform vec2 uDir;
uniform float uSince, uBurn, uScorch, uSpread, uReach, uTime, uSeed, uGain;
varying vec2 vPlace;
void main() {
  // the fire spreads from where it lands, further on the way it was going than back
  float along = dot(vPlace, uDir), across = dot(vPlace, vec2(-uDir.y, uDir.x));
  float r = length(vec2(across, along > 0.0 ? along * 0.7 : along * 1.4));
  float front = uSpread * (1.0 - exp(-max(uSince, 0.0) * 7.0));
  float ragged = (noise(vPlace * 6.0 + uSeed) - 0.5) * 0.3 * uSpread;
  float inside = uSince >= 0.0 ? smoothstep(front + ragged, front + ragged - 0.12, r) : 0.0;
  // flames licking over it
  float lick = noise(vPlace * 9.0 + vec2(uTime * 3.0, -uTime * 2.0)) * 0.6 + noise(vPlace * 19.0 - vec2(uTime * 5.0, uTime * 2.0)) * 0.4;
  float heat = clamp(uBurn * (0.5 + 0.7 * lick) * (1.0 - 0.55 * r / max(uSpread, 1e-3)), 0.0, 1.0);
  vec3 light = fireColour(heat) * inside * 1.3 + fireColour(0.5) * exp(-r * r / (uSpread * uSpread) * 1.5) * uBurn * 0.3;
  float soot = uScorch * smoothstep(uSpread * 1.05, uSpread * 0.35, r + ragged) * (0.55 + 0.35 * noise(vPlace * 5.0 + 9.0));
  float edge = 1.0 - smoothstep(uReach * 0.8, uReach, length(vPlace));
  light *= edge; soot *= edge;
  if (soot < 0.004 && max(max(light.r, light.g), light.b) < 0.003) discard;
  // premultiplied: the char darkens the stone and the fire is added on top
  gl_FragColor = vec4(light * uGain, min(soot, 0.8));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class FirePortalSpell implements SpellEffect {
  readonly object = new THREE.Group();
  readonly strikeAt: number;
  readonly duration: number;
  private readonly timeline: FirePortalTimeline;
  private readonly size: FirePortalSize;
  private readonly jet: PortalJet;
  private readonly portal: FirePortal;
  private readonly breath: Ribbon;
  private readonly splash: THREE.Mesh;
  private readonly splashMaterial: THREE.ShaderMaterial;
  private readonly splashGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly light: ParticlePool;
  private readonly matter: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly portalCentre: THREE.Vector3;
  private readonly glow: SpellGlow;
  private readonly state: SpellState = { struck: false, done: false, shake: 0, glow: null };
  private seconds = 0;

  constructor(private readonly cast: SpellCast) {
    const { look, tile, seed, boardTop, stone, target, quality } = cast, power = Math.max(0.5, cast.power);
    cast.origin(this.hand);
    const floor = { x: stone.x, y: boardTop, z: stone.z }, hand = { x: this.hand.x, y: this.hand.y, z: this.hand.z }, chest = { x: target.x, y: target.y, z: target.z };
    const counts = firePortalCounts(quality, power), size = this.size = firePortalSize(power, tile);
    const { placement, jet } = firePortalGeometry(floor, hand, chest, size);
    this.jet = jet;
    this.timeline = firePortalTimeline(Math.hypot(placement.centre.x - hand.x, placement.centre.y - hand.y, placement.centre.z - hand.z), power, cast.brief);
    this.strikeAt = this.timeline.strikeAt; this.duration = this.timeline.duration;
    const loose = firePortalParticles({ stone: floor, hand, placement, jet: this.jet, timeline: this.timeline, size, counts, power, seed, tile });
    // one fire at four temperatures: white-hot, the kingdom's gold, its orange, its red
    const fire: PortalLook = { white: blend(look.core, 0xffffff, 0.7), gold: look.core, orange: look.ember, red: look.flame, dark: 0x0a0200 };
    this.portalCentre = new THREE.Vector3(placement.centre.x, placement.centre.y, placement.centre.z);

    this.portal = new FirePortal(placement, fire, { outer: power >= QUEEN_POWER && !cast.brief, seed });

    const box = (value: unknown): THREE.IUniform => ({ value });
    const { source, control, splash } = this.jet, ahead = { x: splash.x - control.x, z: splash.z - control.z }, flat = Math.hypot(ahead.x, ahead.z) || 1;
    const u: Record<string, THREE.IUniform> = this.uniforms = {
      uSource: box(new THREE.Vector3(source.x, source.y, source.z)), uControl: box(new THREE.Vector3(control.x, control.y, control.z)), uSplash: box(new THREE.Vector3(splash.x, splash.y, splash.z)),
      uLength: box(this.jet.length), uFloor: box(boardTop), uHead: box(0), uTail: box(0), uTime: box(0), uMouth: box(size.mouth), uSpread: box(size.spread), uJet: box(0),
      uWhite: box(new THREE.Color(fire.white)), uGold: box(new THREE.Color(fire.gold)), uOrange: box(new THREE.Color(fire.orange)), uRed: box(new THREE.Color(fire.red)), uGain: box(1), uPixel: box(0.001),
    };
    this.breath = new Ribbon({ segments: counts.segments, strands: strandSeeds(seed ^ 0xb4e7, counts.strands), halo: 3, order: 12, minPixels: 1.5, uniforms: u, curve: BREATH_CURVE, shade: BREATH_SHADE });

    this.splashMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: box(new THREE.Vector3(this.jet.splash.x, boardTop + 0.013, this.jet.splash.z)), uReach: box(size.splash * 1.8), uDir: box(new THREE.Vector2(ahead.x / flat, ahead.z / flat)),
        uSince: box(-1), uBurn: box(0), uScorch: box(0), uSpread: box(size.splash), uTime: u.uTime, uSeed: box((seed % 311) * 0.23), uGain: u.uGain,
        uWhite: u.uWhite, uGold: u.uGold, uOrange: u.uOrange, uRed: u.uRed,
      },
      vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.splash = new THREE.Mesh(this.splashGeometry, this.splashMaterial);
    this.splash.frustumCulled = false; this.splash.renderOrder = 3; this.splash.visible = false;

    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: fire.white, mid: look.ember, cool: look.flame }, blend: "add", floor: boardTop, seed });
    this.matter = new ParticlePool({
      particles: loose.matter, capacity: loose.matter.length, look: { hot: blend(look.smoke, look.ember, 0.25), mid: look.smoke, cool: blend(look.smoke, 0x000000, 0.65) },
      blend: "cover", floor: boardTop, seed: seed + 1, opacity: 0.55,
    });
    this.object.add(this.splash, this.matter.object, this.portal.object, this.breath.object, this.light.object);
    this.glow = { position: { x: hand.x, y: hand.y, z: hand.z }, colour: look.light, intensity: 0, reach: (4 + 2 * power) * tile };
    this.apply(0);
  }

  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): SpellState {
    this.seconds += Math.max(0, seconds);
    this.breath.fit(camera, height);
    this.apply(this.seconds);
    this.light.update(this.seconds, camera, height); this.matter.update(this.seconds, camera, height);
    return this.state;
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; this.portal.setGain(gain); this.light.setGain(gain); this.matter.setGain(gain); }

  dispose(): void {
    this.portal.dispose(); this.breath.dispose(); this.light.dispose(); this.matter.dispose();
    this.splashGeometry.dispose(); this.splashMaterial.dispose();
    this.object.removeFromParent();
  }

  private apply(seconds: number): void {
    const { cast, timeline, jet, uniforms: u } = this, power = Math.max(0.5, cast.power);
    const now = firePortalState(timeline, jet, seconds, power);
    // in the brief form the fire churns at a third of the pace: nothing rushes
    const pace = cast.brief ? 0.35 : 1;
    u.uTime.value = seconds * pace;
    this.portal.set({ scribe: now.scribe, scribe2: now.scribe2, open: now.open, head: now.head, aperture: now.aperture, stir: now.stir, blaze: now.blaze, cool: now.cool, crumble: now.crumble });
    this.portal.setTime(seconds * pace);
    u.uHead.value = now.jetHead; u.uTail.value = now.jetTail; u.uJet.value = now.jet;
    this.breath.object.visible = now.jet > 0.002;
    const s = this.splashMaterial.uniforms;
    s.uSince.value = now.sinceSplash; s.uBurn.value = now.burn; s.uScorch.value = now.scorch;
    this.splash.visible = now.scorch > 0.003 || now.burn > 0.003;
    cast.origin(this.hand);
    this.light.setAnchor(this.hand);
    // the light sits in the hand, then in the portal, then where the fire lands
    const at = now.lightAt < 0.5 ? this.hand : now.lightAt < 1.5 ? this.portalCentre : null;
    if (at) { this.glow.position.x = at.x; this.glow.position.y = at.y; this.glow.position.z = at.z; }
    else { this.glow.position.x = (cast.stone.x + jet.splash.x) / 2; this.glow.position.y = cast.boardTop + 0.6 * cast.tile; this.glow.position.z = (cast.stone.z + jet.splash.z) / 2; }
    this.glow.intensity = now.light;
    this.matter.setLight(this.glow.position, cast.look.light, 0.2 * Math.min(2.5, now.light));
    this.state.struck = now.struck; this.state.done = now.done; this.state.shake = now.shake;
    this.state.glow = now.light > 0.01 && !now.done ? this.glow : null;
    this.object.visible = !now.done;
  }
}

/** Solforiz's Fire portal, for its Bishop and Queen. */
export const makeFirePortal: SpellFactory = (cast) => new FirePortalSpell(cast);
