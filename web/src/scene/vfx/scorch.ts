/**
 * Burn marks on the board: what a spell's burst or the field gun's round leaves on the stone.
 * One InstancedMesh of quads lying just above the board and under the blood, one shared material.
 * scorchPlan.ts decides what is laid, how big, and when it goes; this file only draws it.
 *
 * The shapes are procedural: seeded noise in the fragment shader, no texture.
 *  - fire: a ragged charred heart inside a soot gradient, pale ash round the char, radial soot streaks
 *    thrown downrange, and cracks that glow orange and cool to dark;
 *  - frost: a pale sear with a crystalline edge, a grey burn at its centre and cyan residue at its rim;
 *    a cold grey-blue stain on the pale squares, the white of frost on the dark ones;
 *  - arc: Lichtenberg scars that fork as they run out from the strike, in a faint soot halo, with a
 *    blue-violet afterglow that runs out along them and fades;
 *  - crater: a hard-edged black pit with a raised lip, crushed stone round it, cracks, and soot sprayed
 *    the way the shot was going;
 *  - hex: Korvenia's brand, a glyph of its own burnt into the stone: a cog's rim with a few teeth lost round a
 *    lozenge set downrange, in a scorched disc, with violet embers in its strokes that cool to dark.
 *
 * Every mark is burnt into the board's own stone and ends at its edge: none runs over the rail.
 * The material is a MeshStandardMaterial with the mask patched in (as gore/BloodDecals.ts), so a mark
 * takes the board's lighting, shadows, fog, exposure and tone mapping like the stone it is burnt into.
 * Only what glows (embers, afterglow) is light of its own, held to the arena's exposure as the bursts are.
 */
import * as THREE from "three";
import type { QualityPreset } from "../quality";
import { SCORCH_BUDGET, SCORCH_KINDS, SCORCH_LOOK, SCORCH_MARGIN, SCORCH_SLOTS, ScorchBuffer, planScorch, type ScorchEvent, type ScorchMark } from "./scorchPlan";

/** Height over the board plane: clear of z-fighting, under the blood (gore/BloodDecals.ts lies at 0.004 and above). */
const LIFT = 0.0018;
const KINDS = SCORCH_KINDS.length;

const VERTEX_HEAD = /* glsl */ `
attribute vec4 aScorchLook;
attribute vec4 aScorchLife;
varying vec2 vScorchUv;
varying vec2 vScorchWorld;
varying vec4 vScorchLook;
varying vec4 vScorchLife;
`;
const VERTEX_BODY = /* glsl */ `
vScorchUv = uv * 2.0 - 1.0;
vScorchLook = aScorchLook;
vScorchLife = aScorchLife;
vScorchWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz;
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform float uScorchTime;
uniform float uScorchGlow;
uniform float uScorchDetail;
uniform float uScorchTile;
uniform vec3 uScorchChar[${KINDS}];
uniform vec3 uScorchSoot[${KINDS}];
uniform vec3 uScorchRim[${KINDS}];
uniform vec3 uScorchEmber[${KINDS}];
// x: shape, y: seconds to cool, z: residue, w: throw.
uniform vec4 uScorchForm[${KINDS}];
// x: cover, y: roughness, z: how much of the stone's shine is left.
uniform vec3 uScorchSurface[${KINDS}];
varying vec2 vScorchUv;
varying vec2 vScorchWorld;
varying vec4 vScorchLook;
varying vec4 vScorchLife;
float scorchRoughness = 1.0;
float scorchShine = 1.0;
float scorchHeight = 0.0;
vec3 scorchEmission = vec3(0.0);
float scorchHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float scorchNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(scorchHash(i), scorchHash(i + vec2(1.0, 0.0)), u.x), mix(scorchHash(i + vec2(0.0, 1.0)), scorchHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float scorchFbm(vec2 p) {
  float n = scorchNoise(p);
  if (uScorchDetail < 0.5) return n;
  return n * 0.55 + scorchNoise(p * 2.03 + 7.1) * 0.3 + scorchNoise(p * 4.11 + 3.7) * 0.15;
}
// Thin dark veins: where a noise field crosses its middle.
float scorchVeins(vec2 p, float width) {
  return 1.0 - smoothstep(0.0, width, abs(scorchNoise(p) - 0.5));
}
// Soot thrown outward in fingers: 0 to 1 along each ray, reaching further downrange.
float scorchStreaks(vec2 ray, float r, float seed, float from, float reach) {
  float coarse = scorchNoise(ray * 3.3 + seed * 2.3), fine = scorchNoise(ray * 8.5 + seed * 3.1);
  float finger = smoothstep(0.38, 0.8, coarse * 0.55 + fine * 0.45);
  float end = from + reach * (0.25 + 0.75 * finger);
  return finger * smoothstep(end, mix(from, end, 0.35), r);
}
// Scars that fork as they run outward. x: the scar itself, y: the scorched halo beside it.
vec2 scorchTree(vec2 p, float seed, float reach) {
  float r = length(p);
  float a = atan(p.y, p.x);
  // The path is never straight: it jags more the further it has run.
  a += (scorchNoise(vec2(r * 6.0, seed * 3.0)) - 0.5) * 0.3 + (scorchNoise(p * 8.5 + seed) - 0.5) * 0.2 * smoothstep(0.08, 0.5, r);
  float trunks = 5.0 + floor(scorchHash(vec2(seed, 4.2)) * 2.0);
  float span = 6.2831853 / trunks, count = trunks, start = 0.0;
  vec2 tree = vec2(0.0);
  for (int k = 0; k < 3; k++) {
    if (k > 1 && uScorchDetail < 0.5) break;
    float u = a / span, m = floor(u + 0.5), f = u - m;
    float side = f < 0.0 ? 0.0 : 1.0;
    // A fork leaves its parent's line and splays out to the middle of the gap.
    float splay = k == 0 ? 0.0 : 0.5 * smoothstep(start, start + 0.5, r);
    float d = abs(abs(f) - splay) * span * r;
    float id = scorchHash(vec2(mod(m, count) * 2.0 + (k == 0 ? 0.0 : side), float(k) * 7.31 + seed * 13.0));
    // Every trunk forks once; only some of those forks fork again.
    float on = k < 2 ? 1.0 : step(0.5, id);
    float end = reach * (k == 0 ? 0.62 + 0.38 * id : k == 1 ? 0.55 + 0.45 * id : 0.6 + 0.3 * id);
    float taper = clamp(1.0 - r / end, 0.0, 1.0);
    float width = 0.062 / (1.0 + float(k) * 0.5) * (0.3 + 0.7 * taper);
    float live = on * step(start, r) * step(r, end);
    tree.x = max(tree.x, live * smoothstep(width, width * 0.45, d));
    tree.y = max(tree.y, live * taper * smoothstep(width * 3.0 + 0.05, 0.0, d));
    start += k == 0 ? 0.26 : 0.34;
    span *= 0.5; count *= 2.0;
  }
  return tree;
}
// 1 at the instant it is laid, 0 once it has cooled. A cold mark (reduced motion, the tactical map) is 0 throughout.
float scorchHeat(float age, float cool) {
  float t = clamp(age / cool, 0.0, 1.0);
  return vScorchLife.z > 0.5 ? (1.0 - t) * (1.0 - t) : 0.0;
}
// rgb: albedo, a: coverage. Sets the roughness, the relief and what glows.
vec4 scorchMark() {
  int kind = int(vScorchLook.z + 0.5);
  vec4 form = uScorchForm[kind];
  int shape = int(form.x + 0.5);
  vec3 charred = uScorchChar[kind], soot = uScorchSoot[kind], rim = uScorchRim[kind], ember = uScorchEmber[kind];
  float cover = uScorchSurface[kind].x;
  scorchRoughness = uScorchSurface[kind].y;
  scorchShine = uScorchSurface[kind].z;
  float seed = vScorchLook.x * 61.0;
  float age = max(0.0, uScorchTime - vScorchLook.y);
  float heat = scorchHeat(age, form.y);
  // A live mark flickers while it is hot; a cold one never moves.
  float flicker = vScorchLife.z > 0.5 ? 0.72 + 0.28 * scorchNoise(vScorchUv * 9.0 + vec2(uScorchTime * 2.6, seed)) : 1.0;
  vec2 p = vScorchUv * ${SCORCH_MARGIN.toFixed(2)};
  float r = length(p);
  vec2 ray = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  // +x is the way the blast was going.
  float down = max(ray.x, 0.0);
  float lobes = scorchNoise(ray * 2.1 + seed) * 0.6 + scorchNoise(ray * 4.7 + seed * 1.7) * 0.4;
  float grain = scorchFbm(p * 3.1 + seed);
  float fine = scorchNoise(p * 12.0 + seed * 1.3);
  float push = form.w * down;
  // The board's dark squares (a1 is one): black char does not show on black stone, pale ash does.
  vec2 square = floor(vScorchWorld / uScorchTile + 4.0);
  float dark = mod(square.x + square.y, 2.0);
  vec3 color; float alpha;

  if (shape == 0) {
    // Fire: char inside soot, ash round the char, soot fingers downrange.
    // The piece that made the capture will stand in the middle of this, on its own disc: the soot is solid out past the disc.
    float edge = 1.14 + 0.34 * (lobes - 0.5) + 0.24 * (grain - 0.5) + 0.3 * push;
    float body = smoothstep(edge, edge - 0.4, r);
    float core = 0.7 + 0.26 * (lobes - 0.5) + 0.2 * (grain - 0.5);
    float burnt = smoothstep(core, core - 0.3, r);
    float streak = scorchStreaks(ray, r, seed, edge * 0.7, 0.55 + 1.1 * push);
    float ash = uScorchDetail > 0.5 ? smoothstep(0.66, 0.9, fine) * smoothstep(core - 0.14, core + 0.02, r) * smoothstep(core + 0.4, core + 0.06, r) : 0.0;
    // Char is not one flat black: it is mottled, and a little of the stone's grain shows through the thin places.
    color = mix(mix(soot, rim * 0.62, dark * 0.8), charred * (1.0 + 1.6 * fine * grain), burnt);
    color = mix(color, rim, ash * mix(0.6, 0.95, dark));
    alpha = max(max(body * 0.9, streak * 0.7) * (0.84 + 0.16 * fine), burnt * (0.95 + 0.05 * grain)) * cover;
    // Embers: the cracks in the char, hottest at the heart, the rim going dark first.
    float cracks = scorchVeins(p * 7.5 + seed, 0.06) + smoothstep(0.82, 0.95, scorchNoise(p * 19.0 + seed)) * 0.7;
    float hot = clamp(heat * 1.5 - r * 0.7, 0.0, 1.0);
    scorchEmission = mix(vec3(0.32, 0.02, 0.0), ember, hot) * (cracks * hot * 0.55 + hot * hot * 0.05) * burnt * flicker;
    scorchHeight = -0.5 * burnt + 0.25 * cracks * burnt;
  } else if (shape == 1) {
    // Witchfire: a pale sear with a crystalline edge. Frost-burn, not soot.
    float spikes = pow(scorchNoise(ray * 9.0 + seed * 2.1), 1.6);
    float edge = 0.84 + 0.42 * spikes + 0.2 * (lobes - 0.5) + 0.3 * push;
    float body = smoothstep(edge, edge - 0.3, r);
    float crystal = scorchVeins(p * 6.0 + seed, 0.16);
    float core = 0.44 + 0.16 * (lobes - 0.5);
    float seared = smoothstep(core + 0.16, core - 0.14, r);
    float band = body * smoothstep(edge - 0.44, edge - 0.1, r);
    // On pale stone the bloom is a cold grey-blue stain; on dark stone it is the white of frost.
    vec3 bloom = mix(soot * vec3(0.36, 0.56, 0.72), soot, dark);
    color = mix(bloom * (0.72 + 0.28 * crystal), charred * mix(0.55, 1.0, dark), seared * 0.9);
    color = mix(color, rim * mix(0.6, 1.0, dark), band * 0.75);
    alpha = max(body * (0.5 + 0.28 * grain + 0.22 * crystal), seared * 0.92) * cover;
    alpha = max(alpha, band * 0.85 * cover);
    // The residue: bright for a breath, then a faint cold line that stays.
    scorchEmission = ember * band * (heat * 0.45 * flicker + form.z) + ember * crystal * body * heat * 0.16;
    scorchRoughness = mix(scorchRoughness, 0.9, seared);
    scorchHeight = 0.3 * crystal * body;
  } else if (shape == 2) {
    // Arc: scars that fork outward from where it struck.
    vec2 tree = scorchTree(p, seed, 1.3 + 0.6 * push);
    float strike = smoothstep(0.26 + 0.1 * (lobes - 0.5), 0.1, r);
    float halo = max(tree.y * 0.55, smoothstep(0.95, 0.2, r) * (0.4 + 0.25 * grain));
    float scar = max(tree.x, strike);
    // Burnt black into pale stone; on dark stone the scar is the pale line where the polish was taken off.
    color = mix(mix(soot, rim * 0.5, dark), mix(charred, rim, dark * 0.9 * (1.0 - strike * 0.6)), scar);
    alpha = max(scar, halo * 0.7) * cover;
    // Afterglow: it runs out along the scars, then the whole figure dims.
    float front = smoothstep(0.0, 0.5, age * 2.2 - r);
    scorchEmission = ember * (tree.x * 0.7 + tree.y * 0.12 + strike * 0.2) * heat * front * flicker;
    scorchHeight = -0.6 * scar;
  } else if (shape == 3) {
    // Field gun: a pit with a raised lip, crushed stone round it, soot sprayed the way the shot went.
    float pitEdge = 0.6 + 0.2 * (lobes - 0.5) + 0.12 * (grain - 0.5);
    float pit = smoothstep(pitEdge, pitEdge - 0.1, r);
    float lip = smoothstep(pitEdge - 0.04, pitEdge + 0.04, r) * smoothstep(pitEdge + 0.3, pitEdge + 0.07, r);
    float edge = 1.1 + 0.3 * (lobes - 0.5) + 0.2 * (grain - 0.5) + 0.25 * push;
    float body = smoothstep(edge, edge - 0.4, r);
    float spray = scorchStreaks(ray, r, seed, edge * 0.6, 0.3 + 1.25 * push) * smoothstep(-0.25, 0.5, ray.x);
    float crack = scorchVeins(ray * 5.0 + seed * 1.9, 0.07) * smoothstep(pitEdge - 0.05, pitEdge, r) * smoothstep(pitEdge + 0.2 + 0.5 * scorchNoise(ray * 3.0 + seed), pitEdge + 0.05, r);
    // Broken stone lies in the pit: not one flat black.
    color = mix(mix(soot, rim * 0.45, dark * 0.8), charred + rim * 0.05 * smoothstep(0.55, 0.9, fine) * pit, max(pit, crack));
    color = mix(color, rim, lip * (0.35 + 0.4 * fine) * (1.0 - crack));
    alpha = max(max(max(body * 0.88, spray * 0.8) * (0.86 + 0.14 * fine), crack * 0.9), pit) * cover;
    // The round is still hot in the stone for a moment.
    float hot = clamp(heat * 1.4 - r * 0.9, 0.0, 1.0);
    scorchEmission = mix(vec3(0.3, 0.02, 0.0), ember, hot) * pit * hot * (0.06 + 0.5 * scorchVeins(p * 7.0 + seed, 0.08)) * flicker;
    scorchHeight = -1.0 * pit + 0.7 * lip + 0.3 * grain * pit;
  } else {
    // Korvenia's hex: the empire's brand burnt into the stone, a clockwork glyph of its own and not a scar. A cog's rim,
    // a few of its teeth lost and the rim broken where they were, round a lozenge set downrange with a charred heart,
    // in a scorched disc. Burnt black into pale stone, the pale line of polish taken off on dark; violet embers in its
    // strokes, hottest at the heart, cool to dark. No figure in it is any faith's or any script's.
    // burnt, not stamped: every stroke wanders, runs thick and thin, and is seared deeper in some places than others
    float wob = (scorchNoise(p * 6.0 + seed) - 0.5) * 0.05;
    float seared = 0.7 + 0.3 * smoothstep(0.25, 0.7, scorchNoise(p * 9.0 + seed * 2.0));
    float ringAt = 0.58 + wob;
    float cogs = atan(p.y, p.x) / 6.2831853 * 9.0 + seed * 0.37;
    float cog = floor(cogs + 0.5), along = cogs - cog;
    float lost = step(scorchHash(vec2(cog + 3.0, seed * 1.7)), 0.22);
    float stroke = (0.036 + 0.03 * scorchNoise(p * 4.3 + seed * 3.0)) * (0.85 + 0.3 * fine);
    float ring = smoothstep(stroke, stroke * 0.45, abs(r - ringAt)) * (1.0 - lost * smoothstep(0.32, 0.2, abs(along)));
    float tooth = (1.0 - lost) * smoothstep(0.23, 0.15, abs(along + wob)) * smoothstep(ringAt, ringAt + 0.02, r) * smoothstep(ringAt + 0.2 + wob, ringAt + 0.15, r);
    vec2 lozenge = abs(p) / vec2(0.34, 0.2);
    float diamond = lozenge.x + lozenge.y;
    float outline = smoothstep(0.17, 0.08, abs(diamond - 1.0 + wob * 2.0));
    float heart = smoothstep(1.0, 0.7, diamond) * (0.75 + 0.25 * grain);
    float glyph = max(max(ring, tooth), outline) * seared;
    // the scorched disc it is branded in, darkest where the strokes run, mottled, and thrown a little downrange
    float edge = 0.98 + 0.22 * (lobes - 0.5) + 0.16 * (grain - 0.5) + 0.25 * push;
    float body = smoothstep(edge, edge - 0.45, r);
    float singe = max(smoothstep(0.17, 0.0, abs(r - ringAt)), smoothstep(0.5, 0.0, abs(diamond - 1.0)) * 0.6);
    vec3 burnt = charred * (1.0 + 1.2 * fine * grain);
    color = mix(mix(soot, rim * 0.5, dark), mix(burnt, rim * 0.6, dark * 0.5), max(heart * 0.9, singe * 0.45));
    color = mix(color, mix(burnt, rim, dark * 0.9), glyph);
    alpha = max(body * (0.32 + 0.4 * grain * (0.6 + 0.4 * fine)), max(max(glyph, heart * 0.9), singe * 0.6) * (0.92 + 0.08 * grain)) * cover;
    float hot = clamp(heat * 1.4 - r * 0.5, 0.0, 1.0);
    scorchEmission = mix(ember * 0.35, ember, hot) * (glyph * 0.7 + heart * 0.25) * hot * flicker + glyph * hot * hot * 0.12;
    scorchHeight = -0.6 * glyph - 0.3 * heart;
  }

  // A live mark comes up under the flash of its own burst, not before it.
  float appear = vScorchLife.z > 0.5 ? smoothstep(0.0, 0.12, age) : 1.0;
  float fade = vScorchLife.x < 0.0 ? 1.0 : 1.0 - smoothstep(vScorchLife.x, vScorchLife.x + vScorchLife.y, uScorchTime);
  // The quad's own edge never shows.
  float inside = smoothstep(1.0, 0.86, max(abs(vScorchUv.x), abs(vScorchUv.y)));
  // Burnt into the board's own stone (eight squares round the middle, as the dark squares are found above): it ends at
  // the board's edge and never runs over the rail.
  vec2 board = 4.0 * uScorchTile - abs(vScorchWorld);
  float onBoard = smoothstep(0.0, 0.025, min(board.x, board.y));
  float show = appear * fade * inside * onBoard * vScorchLook.w;
  scorchEmission *= show * uScorchGlow;
  scorchHeight *= show;
  return vec4(color, clamp(alpha, 0.0, 1.0) * show);
}
`;
const FRAGMENT_COLOR = /* glsl */ `
{
  vec4 scorch = scorchMark();
  if (scorch.a < 0.004) discard;
  diffuseColor = scorch;
}
`;
// The burn has depth: the pit, its lip and the cracks take the arena's light as relief, not as flat paint.
const FRAGMENT_RELIEF = /* glsl */ `
if (uScorchDetail > 0.5) {
  vec3 scorchDx = dFdx(-vViewPosition), scorchDy = dFdy(-vViewPosition);
  vec3 scorchR1 = cross(scorchDy, normal), scorchR2 = cross(normal, scorchDx);
  float scorchDet = dot(scorchDx, scorchR1);
  // Height in world units over a mark a few tenths of a unit wide: shallow, but enough to catch a low light.
  vec2 scorchSlope = vec2(dFdx(scorchHeight), dFdy(scorchHeight)) * 0.035;
  vec3 scorchGrad = sign(scorchDet) * (scorchSlope.x * scorchR1 + scorchSlope.y * scorchR2);
  normal = normalize(abs(scorchDet) * normal - scorchGrad);
}
`;

export interface ScorchStats {
  /** Marks on the board, fading ones included. */
  marks: number;
  /** Marks that are staying. */
  staying: number;
  /** The preset's cap. */
  cap: number;
  /** Ply and look of each mark, oldest slot first. */
  list: { ply: number; kind: string; fading: boolean }[];
}

export class ScorchMarks {
  readonly object: THREE.InstancedMesh;
  readonly buffer = new ScorchBuffer(SCORCH_SLOTS);
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly time = { value: 0 };
  private readonly glow = { value: 1 };
  private readonly detail = { value: 2 };
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private quality: QualityPreset;
  private uploaded = -1;
  private disposed = false;

  constructor(quality: QualityPreset, private readonly board: { top: number; tile: number }) {
    this.quality = quality;
    this.detail.value = SCORCH_BUDGET[quality].detail;
    this.geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.look = new THREE.InstancedBufferAttribute(this.buffer.look, 4).setUsage(THREE.DynamicDrawUsage);
    this.life = new THREE.InstancedBufferAttribute(this.buffer.life, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aScorchLook", this.look);
    this.geometry.setAttribute("aScorchLife", this.life);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const looks = SCORCH_KINDS.map(kind => SCORCH_LOOK[kind]);
    const colours = (pick: (look: (typeof looks)[number]) => readonly [number, number, number]) => looks.map(look => new THREE.Vector3(...pick(look)));
    this.material.onBeforeCompile = shader => {
      shader.uniforms.uScorchTime = this.time;
      shader.uniforms.uScorchGlow = this.glow;
      shader.uniforms.uScorchDetail = this.detail;
      shader.uniforms.uScorchTile = { value: board.tile };
      shader.uniforms.uScorchChar = { value: colours(look => look.char) };
      shader.uniforms.uScorchSoot = { value: colours(look => look.soot) };
      shader.uniforms.uScorchRim = { value: colours(look => look.rim) };
      shader.uniforms.uScorchEmber = { value: colours(look => look.glow) };
      shader.uniforms.uScorchForm = { value: looks.map(look => new THREE.Vector4(look.shape, look.cool, look.residue, look.throw)) };
      shader.uniforms.uScorchSurface = { value: looks.map(look => new THREE.Vector3(look.cover, look.roughness, look.shine)) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_COLOR}`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = scorchRoughness;")
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${FRAGMENT_RELIEF}`)
        // Soot has no shine: without this the stone's own reflection of the sky greys the char in a bright arena.
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directSpecular *= scorchShine; reflectedLight.indirectSpecular *= scorchShine;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += scorchEmission;");
    };
    this.material.customProgramCacheKey = () => "crownfall-scorch-3";
    this.object = new THREE.InstancedMesh(this.geometry, this.material, this.buffer.slots);
    this.object.name = "scorch-marks";
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.castShadow = false; this.object.receiveShadow = true;
    // Under the blood (gore-decals draw at 2): a pool lies over the burn it runs across.
    this.object.renderOrder = 1;
    this.object.visible = false;
  }

  /** Seconds on the mark clock: what a mark's age is measured against. */
  get now(): number { return this.time.value; }

  /** Lays the mark this explosion leaves and returns it. Allocates nothing on the GPU: the pool is fixed. */
  burn(event: ScorchEvent): ScorchMark | null {
    if (this.disposed) return null;
    const mark = planScorch(event);
    this.buffer.lay(mark, this.time.value);
    return mark;
  }

  /** Undo: the burns of the plies taken back go with them. */
  undoTo(ply: number): void { this.buffer.undoTo(ply); }
  /** A new game: nothing remains. */
  reset(): void { this.buffer.clear(); }

  /** A new preset: its cap and its shader detail. Marks stay; past a lower cap the oldest fade. */
  setQuality(quality: QualityPreset): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.detail.value = SCORCH_BUDGET[quality].detail;
    this.buffer.trim(SCORCH_BUDGET[quality].marks, this.time.value);
  }

  /** How bright embers and afterglow are drawn in this arena's exposure (wiring.ts `vfxGlow`). */
  setGlow(glow: number): void { this.glow.value = glow; }

  update(delta: number): void {
    if (this.disposed) return;
    this.time.value += Math.max(0, delta);
    const buffer = this.buffer;
    buffer.update(this.time.value);
    if (this.uploaded === buffer.version) return;
    this.uploaded = buffer.version;
    const y = this.board.top + LIFT;
    for (let i = 0; i < buffer.count; i += 1) {
      const reach = buffer.place[i * 4 + 2] * SCORCH_MARGIN;
      // Burns overlap: each has its own height so none flickers through another.
      this.position.set(buffer.place[i * 4], y + i * 1e-5, buffer.place[i * 4 + 1]);
      this.rotation.setFromAxisAngle(this.up, buffer.place[i * 4 + 3]);
      this.scale.set(reach, 1, reach);
      this.object.setMatrixAt(i, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    this.object.count = buffer.count;
    this.object.visible = buffer.count > 0;
    this.object.instanceMatrix.needsUpdate = true;
    this.look.needsUpdate = true; this.life.needsUpdate = true;
  }

  /** What is on the board now, for diagnostics and browser checks. */
  get stats(): ScorchStats {
    const list: ScorchStats["list"] = [];
    for (let i = 0; i < this.buffer.count; i += 1) list.push({ ply: this.buffer.plyOf(i), kind: this.buffer.kindOf(i), fading: this.buffer.fading(i) });
    return { marks: this.buffer.count, staying: this.buffer.staying, cap: SCORCH_BUDGET[this.quality].marks, list };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.buffer.clear();
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.object.dispose();
  }
}
