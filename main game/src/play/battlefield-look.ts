/** Adapted from the supplied look viewer. SceneEngine retains camera, board, rules and animation ownership. */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { reviveSorcerer } from "./arena-sorcerer";
import { loadExrTexture } from "./exr-texture";
import { createLoadProgress } from "./load-progress";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { integratedGraphics, nextBattlefieldScale } from '../../../shared/play/battlefield-graphics';
import type { MomentGrade } from '../../../web/src/scene/moments/momentPlan';
import { MOMENT_GLSL, momentUniforms, writeMomentUniforms, type MomentUniforms } from '../../../web/src/scene/moments/momentShader';
import { patchShader, type ArenaContext, type ArenaFeature, type ArenaGradeHook } from "./arena-kit";
import { createArenaCinema } from "./arena-cinema";
import { createArenaLava } from "./arena-lava";
import { AIR_MOTION_GLSL, ARENA_METRES, arenaPhysics, type ArenaPhysics } from "./arena-physics";
import { createArenaSurface } from "./arena-surface";
import { createArenaWyverns } from "./arena-wyverns";
import { ARENA_SIMPLIFY, simplifiable, simplifyArenaMeshes } from "./arena-simplify";


export type BattlefieldGraphics = 'auto' | 'low' | 'medium' | 'high';
export async function createBattlefieldLook(options: {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; world: THREE.Group;
  host: HTMLElement; setting: 'scene-01' | 'scene-02'; quality: BattlefieldGraphics; renderScale: number; reducedMotion(): boolean;
  onStats?(stats: Record<string, unknown>): void;
  cancelled?(): boolean;
  /** Calls every download off (A-07): the match is left while the arena loads. */
  signal?: AbortSignal;
  /** How much of the arena's files is in hand, 0 to 1, by bytes (A-07). */
  onProgress?(ratio: number): void;
}) {
const ROOT = `${import.meta.env.BASE_URL}gameport-look/`;
const q = new URLSearchParams({ setting: options.setting === "scene-02" ? "2" : "1", q: options.quality });
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const vec = (k: string, d: number[]) => (q.get(k)?.split(",").map(Number) ?? d) as [number, number, number];
const P = {
  exposure: num("exp", q.get("setting") === "2" ? -0.1 : 0), fog: num("fog", q.get("setting") === "2" ? 0.5 : 1), fogH: num("fogh", 1),
  bloom: num("bloom", q.get("setting") === "2" ? 0.16 : 0.7), lmi: num("lmi", 1), sat: num("sat", q.get("setting") === "2" ? 1.35 : 1),
  fogGain: num("foggain", q.get("setting") === "2" ? 0.4 : 1), ring: num("ring", 0.32), glow: num("glow", 0.5),
  // Setting 2's accretion disk, pushed toward the target image: larger, opened up (less edge-on), more saturated,
  // with a lensed halo (the disk's far side bent round the hole) and a wider area the grade leaves undimmed
  diskScale: num("disk", 1.0), diskTilt: num("tilt", -6), diskSat: num("disksat", 2.0), halo: num("halo", 1.2),
  corona: num("corona", q.get("setting") === "2" ? 20 : 16),
  sky: num("sky", q.get("setting") === "2" ? 0.3 : 1), wisp: num("wisp", 0.6),
  lights: num("lights", 1), grade: q.get("grade") !== "off", embers: q.get("embers") !== "off",
  // per light type (Blender's huge soft lamps - a 13.8 m sphere light at board height - have no three.js twin) and the
  // ambient the extras get from the sky / fog (the panorama as an environment map; the baked meshes ignore it)
  spot: num("spot", q.get("setting") === "2" ? 0.08 : 0.05), area: num("area", 0.3), point: num("point", 0.02), sun: num("sun", 0.12),
  env: num("env", q.get("setting") === "2" ? 0.22 : 0.15),
  creatureEnv: num("cenv", 1.3), lava: num("lava", 0.35),
};
// per setting: assets and the compositor grade's colours (render_variant.py: "s2" swaps in the violet ones)
const SETTINGS = {
  1: { scene: "scene-01", look: "setting1", extras: "setting-01", cool: [0.80, 0.92, 1.12], far: [0.42, 0.48, 0.58],
       limb: [3.2, 1.3, 0.45], gate: [0.70, 0.85] },
  2: { scene: "scene-02", look: "setting2", extras: "setting-02", cool: [0.86, 0.82, 1.14], far: [0.14, 0.09, 0.28],
       limb: [2.4, 1.9, 3.4], gate: [0.95, 0.99] },
};
const SETTING = q.get("setting") === "2" ? 2 : 1;
const OFF = new Set((q.get("off") ?? "").split(","));   // profiling: off=wisp,ring,crystal,rune,embers
// quality: render scale (of the canvas), MSAA, bloom, shadow map, the area lamps (LTC per pixel on every lit extra),
// ember count and the device-pixel-ratio cap. "auto" = medium plus dynamic resolution (0.5-1 of the canvas).
const QUALITY = {
  high: { scale: 1, msaa: 4, bloom: true, shadow: 2048, area: true, pieceArea: true, embers: 2600, dpr: 1 },
  medium: { scale: 1, msaa: 2, bloom: false, shadow: 1024, area: true, pieceArea: true, embers: 1600, dpr: 1 },
  low: { scale: 0.7, msaa: 0, bloom: false, shadow: 0, area: false, pieceArea: false, embers: 800, dpr: 1 },
};
// Medium on integrated graphics (the UHD 630 class) keeps medium's scene but drops its two costliest features there.
// Measured on the UHD 630 at 1382x778: the eleven area lamps, evaluated per pixel on every lit surface, cost about
// 50 ms a frame (7.7 fps with them, 13.2 without), and MSAA doubles the bandwidth of the half-float scene target. The
// figures keep their shadows on a smaller map, and resolution adapts between 0.7 of the canvas and the chosen scale.
// Of the eleven area lamps only two light the board and the figures (CFCL_Area_PieceRim and CFCL_Area_PieceKey);
// the rest rim far sculpts and lift the lava pools, and every lit pixel pays for all of them. Those two stay.
const MEDIUM_INTEGRATED = { msaa: 0, area: false, pieceArea: true, shadow: 512 } as const;
const PIECE_AREA_LAMPS = /CFCL_Area_Piece(Rim|Key)/;
const MEDIUM_INTEGRATED_MIN_SCALE = 0.7;
let QNAME = (["low", "medium", "high"].includes(q.get("q") ?? "") ? q.get("q") : "auto") as "low" | "medium" | "high" | "auto";
const Q = { ...QUALITY[QNAME === "auto" ? "medium" : QNAME] };
if (SETTING === 2 && QNAME !== "low") Q.bloom = true;   // the accretion ring / wisps' halo is part of Setting 2's look
for (const k of ["scale", "msaa", "shadow", "embers", "dpr"] as const) if (q.has(k)) Q[k] = Number(q.get(k));
for (const k of ["bloom", "area"] as const) if (q.has(`${k}Q`)) Q[k] = q.get(`${k}Q`) === "1";
// Development only, for profiling a tier: the page address can override its features, e.g.
// `?look.msaa=0&look.area=0&look.shadow=0&look.embers=0&look.bloom=0`. Applied again whenever the tier is set.
const DEV_KNOBS = (() => { try { return import.meta.env.DEV ? new URLSearchParams(window.location.search) : null; } catch { return null; } })();
const devKnobs = () => {
  if (!DEV_KNOBS) return;
  for (const k of ["msaa", "shadow", "embers"] as const) { const v = DEV_KNOBS.get(`look.${k}`); if (v !== null) Q[k] = Number(v); }
  for (const k of ["bloom", "area"] as const) { const v = DEV_KNOBS.get(`look.${k}`); if (v !== null) Q[k] = v === "1"; }
};
devKnobs();
const CFG = SETTINGS[SETTING];
const PANO = `${ROOT}look/${CFG.look}_pano${q.get("pano") ? "_" + q.get("pano") : ""}.exr`;
const PANO_SIGN = q.get("panoflip") === "1" ? -1 : 1;
const GP = `${ROOT}optimized/${CFG.scene}/`, LM = `${import.meta.env.BASE_URL}gameport/${CFG.scene}/`;

const stats: Record<string, unknown> = { setting: SETTING, quality: QNAME };
// --- shared GLSL ---------------------------------------------------------------------------------------------------
// The Blender panorama looks along glTF -Z with +Y up; EXRLoader keeps rows bottom-up, so v runs upward.
const PANO_GLSL = /* glsl */ `
vec2 panoUv(vec3 d) {
  return vec2(0.5 + ${PANO_SIGN.toFixed(1)} * atan(d.x, -d.z) * 0.15915494, 0.5 + asin(clamp(d.y, -1.0, 1.0)) * 0.31830989);
}`;
const FOG_DENSITY = 0.014, FOG_FALLOFF = 0.004;
/** What is left of the board's baked roughness (see where the board is loaded). */
const BOARD_POLISH = 0.66;
const fogUniforms = {
  uFogMap: { value: null as THREE.Texture | null }, uFogDensity: { value: FOG_DENSITY * P.fog },
  uFogFalloff: { value: FOG_FALLOFF * P.fogH }, uFogBase: { value: 0.0 }, uFogLod: { value: 6.0 }, uFogGain: { value: P.fogGain },
  uFogStart: { value: 60.0 }, uFogRamp: { value: 340.0 }, uFogMax: { value: 3.0 },
  // near the camera the haze is the render's cool fill-lit fog, further out the eclipse-lit panorama colour
  uFogNear: { value: new THREE.Vector3(0.05, 0.06, 0.08) }, uFogNearEnd: { value: 160.0 },
};
const FOG_PARS_VERT = "varying vec3 vFogWorld;";
const FOG_VERT = "vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz * 2.3;";
const FOG_PARS_FRAG = /* glsl */ `
varying vec3 vFogWorld;
uniform sampler2D uFogMap;
uniform float uFogDensity, uFogFalloff, uFogBase, uFogLod, uFogGain, uFogStart, uFogRamp, uFogMax, uFogNearEnd;
uniform vec3 uFogNear;
${PANO_GLSL}
// density rises from 0 at uFogStart to uFogDensity over uFogRamp metres (quadratic optical depth, then linear),
// thinning with height: x exp(-uFogFalloff * (mean ray height - uFogBase))
float fogAmount(vec3 cam, vec3 p) {
  float a = max(distance(cam, p) - uFogStart, 0.0);
  float tau = uFogDensity * (a < uFogRamp ? a * a / (2.0 * uFogRamp) : uFogRamp * 0.5 + a - uFogRamp);
  return 1.0 - exp(-tau * exp(-uFogFalloff * (0.5 * (cam.y + p.y) - uFogBase)));
}`;
const FOG_FRAG = /* glsl */ `
{
  vec3 fd = vFogWorld - cameraPosition * 2.3;
  vec3 fogCol = textureLod(uFogMap, panoUv(normalize(fd)), uFogLod).rgb * uFogGain;
  fogCol *= min(1.0, uFogMax / max(max(fogCol.r, fogCol.g), max(fogCol.b, 1e-4)));
  fogCol = mix(uFogNear, fogCol, smoothstep(uFogStart, uFogNearEnd, length(fd)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogAmount(cameraPosition * 2.3, vFogWorld));
}`;

function withFog(mat: THREE.Material) {
  return patchShader(mat, "cf-look-fog", (shader) => {
    Object.assign(shader.uniforms, fogUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <fog_pars_vertex>", FOG_PARS_VERT).replace("#include <fog_vertex>", FOG_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <fog_pars_fragment>", FOG_PARS_FRAG).replace("#include <fog_fragment>", FOG_FRAG);
  });
}

// EXRLoader stores rows bottom-up, glTF UV1 measures v from the top: the lightmaps are flipped once on the CPU, in the
// worker that decodes them (exr-texture.ts; see game-port/HANDOFF.md).

// Procedural Blender materials the extras GLB could only carry as flat grey: [name, linear albedo, roughness, metal]
// (board per render_variant "tiles3": ivory x0.70, obsidian dark + glossy)
const PALETTE: [RegExp, number[], number, number][] = [
  [/IvoryMarble/, [0.25, 0.215, 0.175], 0.45, 0], [/ObsidianOnyx/, [0.018, 0.016, 0.018], 0.38, 0],
  [/Bronze|Plaque|Gold/, [0.42, 0.27, 0.11], 0.42, 1], [/Ritual|Stone|Basalt|Border|Base|Dais|Shard|Chunk/, [0.075, 0.065, 0.058], 0.8, 0],
];

// --- Setting 2 magic: rebuilt from lib/cf_setting2.py with setting2_fx.json (their Blender emission is procedural) ---
// Blender's Noise texture ~ fBm of gradient noise in [0, 1]; colour ramps as up to 5 [pos, r, g, b] stops
const NOISE_GLSL = /* glsl */ `
vec3 m289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 m289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 perm(vec4 x) { return m289(((x * 34.0) + 1.0) * x); }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  vec3 i = floor(v + dot(v, C.yyy)), x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz), l = 1.0 - g, i1 = min(g.xyz, l.zxy), i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx, x2 = x0 - i2 + C.yyy, x3 = x0 - 0.5;
  i = m289(i);
  vec4 p = perm(perm(perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec4 j = p - 49.0 * floor(p * (1.0 / 49.0));
  vec4 x_ = floor(j * (1.0 / 7.0)), y_ = floor(j - 7.0 * x_);
  vec4 x = (x_ * 2.0 + 0.5) / 7.0 - 1.0, y = (y_ * 2.0 + 0.5) / 7.0 - 1.0, h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy), b1 = vec4(x.zw, y.zw), s0 = floor(b0) * 2.0 + 1.0, s1 = floor(b1) * 2.0 + 1.0, sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy, a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x), p1 = vec3(a0.zw, h.y), p2 = vec3(a1.xy, h.z), p3 = vec3(a1.zw, h.w);
  vec4 nrm = 1.79284291400159 - 0.85373472095314 * vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
  p0 *= nrm.x; p1 *= nrm.y; p2 *= nrm.z; p3 *= nrm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm01(vec3 p, int oct, float rough) {
  float a = 1.0, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * snoise(p); n += a; p *= 2.0; a *= rough; }
  return clamp(0.5 + 0.5 * s / n, 0.0, 1.0);
}
uniform vec4 uRamp[5]; uniform int uRampN;
vec3 ramp(float t) {
  vec3 c = uRamp[0].yzw;
  for (int i = 1; i < 5; i++) {
    if (i >= uRampN) break;
    float a = uRamp[i - 1].x, b = uRamp[i].x;
    if (t >= a) c = mix(uRamp[i - 1].yzw, uRamp[i].yzw, clamp((t - a) / max(b - a, 1e-5), 0.0, 1.0));
  }
  return c;
}`;
type Stop = [number, number[]];
const rampUniforms = (stops: Stop[]) => ({
  uRamp: { value: [0, 1, 2, 3, 4].map((i) => { const st = stops[Math.min(i, stops.length - 1)]; return new THREE.Vector4(st[0], st[1][0], st[1][1], st[1][2]); }) },
  uRampN: { value: stops.length },
});
const UV_VERT = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const hash01 = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 10007) / 10007; };

// runes: glyph mask from the atlas -> emission colour x strength, alpha min(1.4 mask, 1); slowly breathing
function runeMaterial(atlas: THREE.Texture, cfg: { color: number[]; strength: number }) {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uColor: { value: new THREE.Vector3(cfg.color[0], cfg.color[1], cfg.color[2]) },
                uStrength: { value: cfg.strength }, uTime: { value: 0 } },
    vertexShader: UV_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas; uniform vec3 uColor; uniform float uStrength, uTime; varying vec2 vUv;
      void main() {
        float m = texture2D(uAtlas, vUv).r;
        gl_FragColor = vec4(uColor * m * uStrength * (0.9 + 0.1 * sin(uTime * 1.3)), min(m * 1.4, 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
// wisps: ribbons - across (v) and along (u) fades x noise streaks, hue from the palette by object + u; flowing
function wispMaterial(cfg: { palette: Stop[]; strength: number; opacity: number; edge_pow?: number }, rand: number) {
  return new THREE.ShaderMaterial({
    uniforms: { ...rampUniforms(cfg.palette), uTime: { value: 0 }, uRand: { value: rand }, uStrength: { value: cfg.strength },
                uOpacity: { value: cfg.opacity }, uEdgePow: { value: cfg.edge_pow ?? 1.2 } },
    vertexShader: UV_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRand, uStrength, uOpacity, uEdgePow; varying vec2 vUv; ${NOISE_GLSL}
      void main() {
        float u = vUv.x, v = vUv.y;
        float across = pow(1.0 - abs(v * 2.0 - 1.0), uEdgePow);
        float along = pow(max(sin(u * 3.14159265), 0.0), 0.7);
        float n = clamp(0.5 + 2.0 * (fbm01(vec3(u * 7.0 + uRand * 40.0 - uTime * 0.35, v * 2.2, uTime * 0.04) * 1.6, 6, 0.5) - 0.5), 0.0, 1.0);
        float streak = 0.15 + 0.85 * smoothstep(0.32, 0.72, n);
        float a = clamp(across * along * streak * uOpacity, 0.0, 1.0);
        gl_FragColor = vec4(ramp(clamp(uRand * 0.75 + u * 0.25, 0.0, 1.0)) * (across + 0.35) * uStrength, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
// crystals and shards: thin-film glass, facing glow from the glow palette. No transmission: three.js renders the whole
// scene a second time for it (Setting 2 fell from 44 to ~15 fps on the Quadro), so they are transparent instead
function crystalMaterial(cfg: { base: number[]; glow: number; glow_palette: Stop[]; film_nm?: number }, rand: number) {
  const st = cfg.glow_palette;
  let c = new THREE.Color(st[0][1][0], st[0][1][1], st[0][1][2]);
  for (let i = 1; i < st.length; i++) {
    if (rand >= st[i - 1][0]) {
      const a = new THREE.Color(st[i - 1][1][0], st[i - 1][1][1], st[i - 1][1][2]), b = new THREE.Color(st[i][1][0], st[i][1][1], st[i][1][2]);
      c = a.lerp(b, Math.min(1, (rand - st[i - 1][0]) / Math.max(1e-5, st[i][0] - st[i - 1][0])));
    }
  }
  const film = cfg.film_nm ?? 520;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(cfg.base[0], cfg.base[1], cfg.base[2]).multiplyScalar(0.5), roughness: 0.12, metalness: 0,
    ior: 1.55, transmission: 0, transparent: true, opacity: 0.88,
    iridescence: 0.8, iridescenceIOR: 1.45, iridescenceThicknessRange: [film - 40, film + 40], envMapIntensity: 0.25,
    side: THREE.DoubleSide,
  });
  m.userData.glow = cfg.glow;
  m.userData.glowK = { value: cfg.glow * P.glow };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = { value: c };
    sh.uniforms.uGlowK = m.userData.glowK;
    sh.uniforms.uHue = { value: rand };
    // facing glow (Blender: palette x (1 - Facing) x glow) plus a thin-film colour that shifts with the viewing angle
    sh.fragmentShader = sh.fragmentShader.replace("uniform vec3 emissive;", "uniform vec3 emissive; uniform vec3 uGlow; uniform float uGlowK, uHue;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" +
               "float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));\n" +
               "vec3 film = 0.5 + 0.5 * cos(6.2832 * (uHue + 1.1 * (1.0 - ndv) + vec3(0.0, 0.33, 0.67)));\n" +
               "totalEmissiveRadiance += uGlowK * (uGlow * pow(ndv, 0.7) * 0.4 + film * film * 0.8 * pow(1.0 - ndv, 1.5));");
  };
  return m;
}
// the lensed halo of the target image: the disk's far side bent round the hole by gravity - a thin hot photon ring
// hugging the edge, a swirling violet-blue band around it (brightest above and below the hole) and a soft glow.
// A camera-facing quad at the hole; the black sphere covers its middle. Additive.
function lensHalo(E: THREE.Vector3, R: number, gain: number) {
  const outer = 3.2;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGain: { value: gain }, uOuter: { value: outer } },
    vertexShader: "varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uTime, uGain, uOuter; varying vec2 vP; ${NOISE_GLSL.replace(/uniform vec4 uRamp[\s\S]*$/, "")}
      void main() {
        float r = length(vP), a = atan(vP.y, vP.x);
        float photon = exp(-pow((r - 1.035) / 0.03, 2.0)) + 0.5 * exp(-pow((r - 1.1) / 0.07, 2.0));
        float sw = fbm01(vec3(a * 3.0 + r * 6.0 - uTime * 0.12, r * 4.0, uTime * 0.03), 5, 0.55);
        float lens = 0.55 + 0.45 * abs(sin(a));                       // the bent far side shows most above / below
        float band = smoothstep(1.04, 1.14, r) * (1.0 - smoothstep(1.3, 1.95, r)) * lens * (0.2 + 1.4 * smoothstep(0.4, 0.85, sw));
        float glow = exp(-(r - 1.0) / 0.75) * (1.0 - smoothstep(uOuter * 0.7, uOuter, r));
        vec3 col = vec3(1.0, 0.7, 0.32) * photon * 5.0
                 + mix(vec3(0.38, 0.12, 1.0), vec3(0.15, 0.45, 1.0), sw) * band * 2.2
                 + vec3(0.4, 0.12, 0.9) * glow * 0.4;
        gl_FragColor = vec4(col * uGain * step(1.0, r), 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(outer * 2, outer * 2), mat);
  m.position.copy(E);
  m.scale.setScalar(R);
  m.renderOrder = -880;      // after the rings: their near arcs still cover it through the depth test
  m.frustumCulled = false;
  return m;
}

// accretion rings around the black hole: an annulus tilted from the hero view direction (near half below / in front
// of the hole), radial colour profile, swirled streaks, soft edges - as cf_setting2._ring_material, slowly orbiting.
// They write depth, so the disc matte leaves their near half in front of the hole (render_variant "s2").
function accretionRing(spec: { r: number[]; inclination_deg?: number; roll_deg?: number; arms?: number; twist?: number;
                               streak_freq?: number; strength?: number; opacity?: number; in_soft?: number; out_soft?: number;
                               streak_lo?: number; profile: Stop[] }, E: THREE.Vector3, R: number, eye: THREE.Vector3) {
  const D = E.clone().sub(eye).normalize();
  const up = new THREE.Vector3(0, 1, 0).sub(D.clone().multiplyScalar(D.y)).normalize();
  const inc = THREE.MathUtils.degToRad(spec.inclination_deg ?? 74);
  const n = D.clone().multiplyScalar(-Math.cos(inc)).add(up.clone().multiplyScalar(Math.sin(inc))).normalize()
    .applyAxisAngle(D, THREE.MathUtils.degToRad(spec.roll_deg ?? -7));
  const geo = new THREE.RingGeometry(spec.r[0], spec.r[1], 384, 10);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...rampUniforms(spec.profile), uTime: { value: 0 }, uR0: { value: spec.r[0] }, uR1: { value: spec.r[1] },
                uArms: { value: spec.arms ?? 3 }, uTwist: { value: spec.twist ?? 9 }, uFreq: { value: spec.streak_freq ?? 34 },
                uStrength: { value: spec.strength ?? 10 }, uOpacity: { value: spec.opacity ?? 1 }, uInSoft: { value: spec.in_soft ?? 0.08 },
                uOutSoft: { value: spec.out_soft ?? 0.55 }, uLo: { value: spec.streak_lo ?? 0.25 }, uSpin: { value: 0.05 / spec.r[0] },
                uGain: { value: 1 }, uSat: { value: 1 } },
    vertexShader: "varying vec2 vObj; void main() { vObj = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uTime, uR0, uR1, uArms, uTwist, uFreq, uStrength, uOpacity, uInSoft, uOutSoft, uLo, uSpin, uGain, uSat;
      varying vec2 vObj; ${NOISE_GLSL}
      void main() {
        float rad = length(vObj), ang = atan(vObj.y, vObj.x) + uTime * uSpin;
        float rn = clamp((rad - uR0) / (uR1 - uR0), 0.0, 1.0);
        float n = clamp(0.5 + 2.4 * (fbm01(vec3(ang * uArms + rad * uTwist, rad * uFreq * 0.22, 0.0), 4, 0.55) - 0.5), 0.0, 1.0);
        // arcs with gaps: a lower floor and a squared alpha (the target's rings let the hole and sky show between)
        float streak = 1.4 * smoothstep(0.42, 0.85, n) + 0.06 * uLo;
        float edge = smoothstep(0.0, uInSoft, rn) * (1.0 - smoothstep(1.0 - uOutSoft, 1.0, rn));
        vec3 col = ramp(rn);
        col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat), 0.0);
        gl_FragColor = vec4(col * streak * uStrength * uGain, clamp(edge * streak * streak * 0.5 * uOpacity, 0.0, 1.0));
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: true,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.copy(E);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  ring.scale.setScalar(R);
  ring.renderOrder = -900;          // right after the sky: the farthest thing drawn
  ring.frustumCulled = false;
  return ring;
}

// --- embers: rising sparks in the render's ember volume ---------------------------------------------------------------
// They lean with the arena's wind and part round what the match does on the board, as the ash does (arena-physics.ts).
function makeEmbers(center: number[], size: number[], count: number, air: ArenaPhysics) {
  const pos = new Float32Array(count * 3), phase = new Float32Array(count), speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (Math.random() - 0.5) * size[0];
    pos[i * 3 + 1] = center[1] + (Math.random() - 0.5) * size[1];
    pos[i * 3 + 2] = center[2] + (Math.random() - 0.5) * size[2];
    phase[i] = Math.random();
    speed[i] = 0.6 + Math.random() * 1.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...air.uniforms, uTime: { value: 0 }, uScale: { value: 800 }, uMinY: { value: center[1] - size[1] / 2 },
                uSizeY: { value: size[1] }, uColor: { value: new THREE.Vector3(5.0, 1.6, 0.35) } },
    vertexShader: /* glsl */ `
      ${AIR_MOTION_GLSL}
      attribute float aPhase, aSpeed; uniform float uTime, uScale, uMinY, uSizeY; varying float vA;
      void main() {
        vec3 p = position;
        float t = mod(p.y - uMinY + uTime * aSpeed, uSizeY);
        p.y = uMinY + t;
        p.x += sin(uTime * 0.37 + aPhase * 6.28) * 1.2;
        p.z += cos(uTime * 0.29 + aPhase * 6.28) * 1.2;
        // the gusts lean the column, more the higher an ember has risen, and the match's blows part it
        // (the air's lengths are metres; this cloud is drawn in the board's units)
        p.xz += uCfAirGust * ((1.0 + 4.0 * t / uSizeY) / ${ARENA_METRES.toFixed(1)});
        p += cfAirPush(p * ${ARENA_METRES.toFixed(1)}) / ${ARENA_METRES.toFixed(1)};
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(0.16 * uScale / -mv.z, 1.0, 12.0);
        float y = t / uSizeY;
        vA = (0.55 + 0.45 * sin(uTime * 3.1 + aPhase * 40.0)) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.7, 1.0, y));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0;
        if (r > 1.0) discard;
        gl_FragColor = vec4(uColor * vA * (1.0 - r) * (1.0 - r), 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// --- grade + Blender AgX (3D LUT) ----------------------------------------------------------------------------------
function gradeMaterial(lut: THREE.Data3DTexture, lutMeta: { size: number; ev_min: number; ev_max: number }, hooks: ArenaGradeHook[]) {
  // what the look's parts add to this pass (arena-kit.ts ArenaGradeHook)
  const hooked = (part: "pars" | "warp" | "scene" | "final") => hooks.map((hook) => hook[part] ?? "").join("\n");
  return new THREE.ShaderMaterial({
    uniforms: {
      ...Object.assign({}, ...hooks.map((hook) => hook.uniforms ?? {})),
      tScene: { value: null }, tDepth: { value: null }, tDepthPano: { value: null }, tLut: { value: lut },
      uLutSize: { value: lutMeta.size }, uEvMin: { value: lutMeta.ev_min }, uEvMax: { value: lutMeta.ev_max },
      uExposure: { value: Math.pow(2, P.exposure) }, uGrade: { value: P.grade ? 1 : 0 },
      uNear: { value: 0.5 }, uFar: { value: 4000 }, uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uAspect: { value: 16 / 9 },
      uPx: { value: 0.0007 }, uEclDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() }, uEclR: { value: 0.1 },
      uEclPos: { value: new THREE.Vector3() }, uEclRadiusM: { value: 50 }, uSorcPos: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uSat: { value: P.sat }, uCool: { value: new THREE.Vector3(...CFG.cool) }, uFarHaze: { value: new THREE.Vector3(...CFG.far) },
      uLimb: { value: new THREE.Vector3(...CFG.limb) }, uGate: { value: new THREE.Vector2(...CFG.gate) },
      uCorona: { value: P.corona },
      // The match's cinematic moments (web/src/scene/moments): neutral unless the engine hands a grade over.
      ...momentUniforms(),
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      precision highp float; precision highp sampler3D;
      varying vec2 vUv;
      uniform sampler2D tScene, tDepth, tDepthPano; uniform sampler3D tLut;
      uniform float uLutSize, uEvMin, uEvMax, uExposure, uGrade, uNear, uFar, uAspect, uPx, uEclR, uEclRadiusM, uTime, uSat;
      uniform mat4 uProjInv, uCamWorld; uniform vec3 uCamPos, uEclDir, uEclPos, uSorcPos, uCool, uFarHaze, uLimb;
      uniform vec2 uGate; uniform float uCorona;
      ${PANO_GLSL}
      ${MOMENT_GLSL}
      float viewZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
      float ramp(float x, float a, float b) { return clamp((x - a) / (b - a), 0.0, 1.0); }
      ${hooked("pars")}
      void main() {
        vec2 uv = vUv;
        ${hooked("warp")}
        // A moment's ripple bends where the scene is read, and its fringe splits the read (identity when none shows).
        vec3 c;
        if (uMoOn > 0.5) { uv = moWarp(uv); c = moFetch(tScene, uv); }
        else c = texture2D(tScene, uv).rgb;
        float depth = texture2D(tDepth, uv).r;
        vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
        vec3 fwd = normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
        bool sky = depth >= 0.999999;
        // Blender's Depth pass is the distance along the view axis; the sky's comes from the depth panorama
        float z = sky ? texture2D(tDepthPano, panoUv(dir)).r * max(dot(dir, fwd), 0.05) : viewZ(depth) * 2.3;
        ${hooked("scene")}
        if (uGrade > 0.5) {
          // frame: ellipse at (0.5, 0.42), size (1.25, 0.95) image widths, 260 px blur -> edges x0.55
          vec2 e = (vUv - vec2(0.5, 0.42)) / vec2(0.625, 0.475 * uAspect);
          c *= mix(0.55, 1.0, 1.0 - smoothstep(0.80, 1.22, length(e)));
          // split tone: cool shadows, warm highlights
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float sh = 1.0 - smoothstep(0.02, 0.32, lum);
          c = mix(c, c * uCool, sh);
          c = mix(c, c * vec3(1.04, 1.0, 0.94), (1.0 - sh) * 0.6);
          // aerial perspective: 120-420 m toward a cool haze (up to 22 %), the sky (> 440 m) keeps its own grade
          c = mix(c, uFarHaze, ramp(z, 120.0, 420.0) * 0.22 * (1.0 - ramp(z, 440.0, 480.0)));
          // the sky (380-470 m) away from the corona drops ~0.7 stop, cooler
          float ang = acos(clamp(dot(dir, uEclDir), -1.0, 1.0));
          float corona = 1.0 - smoothstep(radians(uCorona * 0.375), radians(uCorona), ang);
          c = mix(c, c * vec3(0.58, 0.60, 0.72), ramp(z, 380.0, 470.0) * (1.0 - corona));
          // darker backdrop behind the creature
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0))), up = cross(right, fwd);
          vec3 sd = normalize(uSorcPos - uCamPos);
          float zS = dot(uSorcPos - uCamPos, fwd);
          vec2 off = vec2(atan(dot(dir, right), dot(dir, fwd)) - atan(dot(sd, right), dot(sd, fwd)),
                          asin(clamp(dot(dir, up), -1.0, 1.0)) - asin(clamp(dot(sd, up), -1.0, 1.0)));
          float halo = 1.0 - smoothstep(0.7, 1.3, length(off / vec2(radians(7.4), radians(11.0))));
          c = mix(c, c * vec3(0.66, 0.66, 0.72), ramp(z, zS + 12.0, zS + 40.0) * halo);
          // the eclipse: a black disc (nothing nearer may be matted) and one thin hot limb just outside it
          float dz = dot(uEclPos - uCamPos, fwd) - uEclRadiusM;
          float gate = sky ? 1.0 : smoothstep(uGate.x * dz, uGate.y * dz, z);
          float R = uEclR, fe = R * 0.03;
          c = mix(c, vec3(0.004, 0.0035, 0.0035), (1.0 - smoothstep(R * 1.006 - fe, R * 1.006 + fe, ang)) * gate);
          float band = clamp(smoothstep(R * 1.004 - uPx, R * 1.004 + uPx, ang) - smoothstep(R * 1.03 - uPx, R * 1.03 + uPx, ang), 0.0, 1.0);
          c += band * uLimb * gate;
        }
        ${hooked("final")}
        // A spell's darkness and the defeat's drained light, on the scene's own light (z: metres along the view).
        if (uMoOn > 0.5) c = moScene(c, z);
        c *= uExposure;
        c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSat), 0.0);
        vec3 t = clamp((log2(max(c, vec3(1e-10))) - uEvMin) / (uEvMax - uEvMin), 0.0, 1.0);
        vec3 disp = texture(tLut, (t * (uLutSize - 1.0) + 0.5) / uLutSize).rgb;
        // The black and white, the colour taken and drained, the vignette: on the frame as shown.
        if (uMoOn > 0.5) disp = moGrade(disp, vUv);
        disp += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(disp, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
}

async function main() {
  const t0 = performance.now();
  const { renderer, scene, camera, world } = options;
  // auto on integrated graphics starts from the low feature set (measured on the UHD 630 at 1080p: medium 7 fps,
  // low 37 fps); dynamic resolution then fine-tunes either way
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const integrated = integratedGraphics(gpu);
  if (QNAME === "auto" && integrated) Object.assign(Q, QUALITY.low);
  // medium chosen on integrated graphics: see MEDIUM_INTEGRATED
  const lite = () => QNAME === "medium" && integrated;
  if (lite()) { Object.assign(Q, MEDIUM_INTEGRATED); devKnobs(); }
  stats.gpu = gpu.replace(/^ANGLE \(|\)$/g, "").slice(0, 60);
  stats.features = QNAME === "auto" ? (integrated ? "low (integrated GPU)" : "medium") : lite() ? "medium (integrated GPU)" : QNAME;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  renderer.setSize(Math.max(1, options.host.clientWidth), Math.max(1, options.host.clientHeight), false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = Q.shadow > 0;
  // PCF: three.js r185 has retired PCFSoftShadowMap and draws it as PCF from its first shadow render on, but a program
  // built before that render (a warm-up, SceneEngine.warmEffects) is keyed and compiled for basic shadows, never used,
  // and built again on first use. Asked for directly, the shadows are the same and every program is built once.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  RectAreaLightUniformsLib.init();

  // Every file through one manager and the abort signal, so leaving mid-load calls the downloads off (A-07); each
  // reports its bytes to the bar. Sizes are guesses until the server gives them.
  // A file that fails calls the rest off too: the match then stages the baked arena instead, without waiting for
  // hundreds of megabytes it will not use.
  const manager = new THREE.LoadingManager();
  const inner = new AbortController(), signal = inner.signal;
  const abortAll = () => { if (!inner.signal.aborted) { inner.abort(); manager.abort(); } };
  options.signal?.addEventListener("abort", abortAll, { once: true });
  if (options.signal?.aborted) abortAll();
  const bytes = createLoadProgress(options.onProgress);
  const track = <T,>(url: string, guess: number, load: (progress: (loaded: number, total: number) => void) => Promise<T>, optional = false): Promise<T> => {
    const progress = bytes.file(url, guess);
    return load(progress).catch((cause) => { if (!optional) abortAll(); throw cause; }).finally(() => bytes.done(url));
  };
  const gltfProgress = (progress: (loaded: number, total: number) => void) => (event: ProgressEvent) => progress(event.loaded, event.total);
  const json = (url: string, guess: number) => track(url, guess, async (progress) => { const r = await fetch(url, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); const value = await r.json(); progress(1, 1); return value; });
  // The decoders are not called off with the downloads: a model already in hand when the match is left still finishes
  // parsing (then it is released), rather than failing on a decoder cut off halfway.
  const draco = new DRACOLoader().setDecoderPath(`${ROOT}draco/`);
  const ktx2 = new KTX2Loader().setTranscoderPath(`${ROOT}basis/`).detectSupport(renderer);
  const gltf = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2);
  const model = (url: string, guess: number, optional = false) => track(url, guess, (progress) => gltf.loadAsync(url, gltfProgress(progress)), optional);
  // The EXR files are decoded in workers (A-22); the two lightmaps are turned the right way up there too.
  const exr = (url: string, guess: number, flip = false) => track(url, guess, (progress) => loadExrTexture(url, { signal, flip, onProgress: progress }));
  const loads = [
    json(`${ROOT}look/${CFG.look}_inspect.json`, 250e3),
    json(`${ROOT}look/agx_mhc.json`, 1e3),
    track(`${ROOT}look/agx_mhc.bin`, 1.1e6, async (progress) => { const r = await fetch(`${ROOT}look/agx_mhc.bin`, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status} for agx_mhc.bin`); const value = await r.arrayBuffer(); progress(1, 1); return value; }),
    exr(PANO, 20e6), exr(`${ROOT}look/${CFG.look}_pano_depth.exr`, 6e6),
    model(`${GP}arena.glb`, 17e6), model(`${GP}environment.glb`, 50e6),
    exr(`${LM}arena.exr`, 6e6, true), exr(`${LM}environment.exr`, 12e6, true),
    model(`${ROOT}look/${CFG.extras}/extras.glb`, 36e6),
    // the arena's own chessboard with its materials baked to textures (both settings share it); without it the
    // match keeps the procedural board
    model(`${ROOT}look/board/board.glb`, 6e6, true).catch((cause) => {
      if (signal?.aborted) throw cause;
      console.warn('[battlefield] baked board unavailable, keeping the procedural board', cause);
      return null;
    }),
    // the menu's sorcerer on its rig: the same sculpt as the statue behind the board, which it brings to life
    model(`${import.meta.env.BASE_URL}models/crownfall-sorcerer.glb`, 4.2e6, true).catch((cause) => {
      if (signal?.aborted) throw cause;
      console.warn('[battlefield] rigged sorcerer unavailable, keeping the statue', cause);
      return null;
    }),
    SETTING === 2 ? json(`${ROOT}look/setting2_fx.json`, 3e3) : Promise.resolve(null),
    SETTING === 2 ? track(`${ROOT}look/setting-02/rune_atlas.png`, 135e3, () => new THREE.TextureLoader(manager).loadAsync(`${ROOT}look/setting-02/rune_atlas.png`)) : Promise.resolve(null),
  ] as const;
  // Whatever did arrive is let go if any file fails or the match is left meanwhile, so nothing loaded is left behind.
  const settled = await Promise.allSettled(loads);
  options.signal?.removeEventListener("abort", abortAll);
  const release = async () => {
    const { disposeBakedGroup } = await import('./environment');
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const value = result.value as { scene?: THREE.Group; isTexture?: boolean; dispose?(): void };
      if (value.scene) disposeBakedGroup(value.scene); else if (value.isTexture) value.dispose?.();
    }
    draco.dispose(); ktx2.dispose();
  };
  const left = () => options.cancelled?.() || options.signal?.aborted;
  // The first real failure, not the downloads it called off.
  const isAbort = (cause: unknown) => (cause as { name?: string } | null)?.name === "AbortError";
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length || left()) {
    await release();
    if (!left()) throw (failures.find((result) => !isAbort(result.reason)) ?? failures[0]!).reason;
    throw new DOMException('Battlefield loading cancelled.', 'AbortError');
  }
  const value = <T,>(index: number) => (settled[index] as PromiseFulfilledResult<T>).value;
  type Gltf = Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
  const inspect = value<any>(0), lutMeta = value<any>(1), lutBuf = value<ArrayBuffer>(2);
  const pano = value<THREE.DataTexture>(3), panoDepth = value<THREE.DataTexture>(4);
  const arena = value<Gltf>(5), env = value<Gltf>(6), lmArena = value<THREE.DataTexture>(7), lmEnv = value<THREE.DataTexture>(8);
  const extras = value<Gltf>(9), board = value<Gltf | null>(10), rigged = value<Gltf | null>(11);
  const fx = value<any>(12), runeAtlas = value<THREE.Texture | null>(13);
  options.onProgress?.(1);
  if (runeAtlas) { runeAtlas.flipY = false; runeAtlas.colorSpace = THREE.NoColorSpace; }   // glTF UVs, a mask
  // The board's tiles are polished stone: their baked roughness is taken down, so a tile's bevel and its face show the
  // key lamp's highlight, and their pictures are filtered along the grazing angle the play camera sees the board at.
  board?.scene.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!material?.isMeshStandardMaterial || material.userData.cfPolished) return;
    material.userData.cfPolished = true;
    material.roughness *= BOARD_POLISH;
    for (const map of [material.map, material.normalMap, material.roughnessMap]) if (map && map.anisotropy < 8) { map.anisotropy = 8; map.needsUpdate = true; }
  });
  stats.loadMs = Math.round(performance.now() - t0);

  // sky + fog colour source: one panorama; mips give the fog its blur
  pano.generateMipmaps = true;
  pano.minFilter = THREE.LinearMipmapLinearFilter;
  pano.wrapS = THREE.RepeatWrapping;
  pano.needsUpdate = true;
  panoDepth.wrapS = THREE.RepeatWrapping;
  fogUniforms.uFogMap.value = pano;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), new THREE.ShaderMaterial({
    uniforms: { uPano: { value: pano }, uGain: { value: P.sky } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition;
                    gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uPano; uniform float uGain; varying vec3 vDir; ${PANO_GLSL}
      void main() { gl_FragColor = vec4(textureLod(uPano, panoUv(normalize(vDir)), 0.0).rgb * uGain, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  world.add(sky);
  // the extras' ambient: the panorama re-mapped to three's equirect layout (u = 0.5 at +X), then PMREM-filtered. The
  // panorama was rendered with the ground hidden, so below the horizon it shows lit fog - there the light comes from
  // dark terrain instead
  const eqRT = new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType });
  const remap = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { uPano: { value: pano } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D uPano; varying vec2 vUv; ${PANO_GLSL}
      void main() {
        float phi = (vUv.x - 0.5) * 6.28318530718, th = (vUv.y - 0.5) * 3.14159265359;
        vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
        vec3 c = textureLod(uPano, panoUv(d), 1.0).rgb;
        gl_FragColor = vec4(mix(c, vec3(0.03, 0.026, 0.024), smoothstep(0.02, -0.12, d.y)), 1.0);
      }`,
  }));
  renderer.setRenderTarget(eqRT);
  remap.render(renderer);
  renderer.setRenderTarget(null);
  eqRT.texture.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(eqRT.texture).texture;
  scene.environmentIntensity = P.env; scene.fog = null; scene.background = null;
  pmrem.dispose();

  // the look's parts (arena-kit.ts): each adds one thing to what is built below
  const context: ArenaContext = {
    renderer, scene, camera, world, setting: SETTING, quality: () => ({ name: QNAME, ...Q }),
    fog: { uniforms: fogUniforms, parsVertex: FOG_PARS_VERT, vertex: FOG_VERT, parsFragment: FOG_PARS_FRAG, fragment: FOG_FRAG },
    inspect, panorama: pano, models: { arena: arena.scene, environment: env.scene, extras: extras?.scene ?? null },
    reducedMotion: options.reducedMotion, shared: { emitters: [] },
  };
  // the cinema part goes first: its depth of field re-reads the scene, before the air is laid over it
  const features: ArenaFeature[] = [createArenaCinema(context), createArenaLava(context), createArenaSurface(context), await createArenaWyverns(context)];

  // static environment: unlit, albedo x baked light
  let meshes = 0, tris = 0;
  const bakedLm: THREE.MeshBasicMaterial[] = [], bakedV: [THREE.MeshBasicMaterial, THREE.Color][] = [];
  // Fewer triangles for the heaviest scenery below high quality, settled by the tier the arena loads on (see
  // arena-simplify.ts). A later change of tier keeps the geometry the arena was loaded with.
  const simplifyTier = QNAME === "high" || DEV_KNOBS?.get("look.simplify") === "0" ? null
    : QNAME === "low" || (QNAME === "auto" && integrated) ? ARENA_SIMPLIFY.low : ARENA_SIMPLIFY.medium;
  const heavy: [THREE.Object3D, THREE.Mesh][] = [];
  for (const [model, lm] of [[arena, lmArena], [env, lmEnv]] as [{ scene: THREE.Group }, THREE.DataTexture][]) {
    lm.channel = 1; lm.flipY = false; lm.colorSpace = THREE.LinearSRGBColorSpace; lm.needsUpdate = true;
    model.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // The dais and central moss shells (about 160k triangles, nearly black in the bake) are left out on integrated
      // graphics, as the older baked-arena path did everywhere: there they cost geometry the eye barely sees.
      if (integrated && /MossShell/.test(m.name)) { m.visible = false; return; }
      meshes++;
      const geo = m.geometry as THREE.BufferGeometry;
      tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      if (simplifyTier && simplifiable(m, simplifyTier)) heavy.push([model.scene, m]);
      const ud = (m.userData.cf_vlit ? m.userData : m.parent?.userData ?? {}) as { cf_vlit?: string; cf_vscale?: number };
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const s = src as THREE.MeshStandardMaterial;
        const base = { name: s.name, map: s.map ?? null, side: s.side, transparent: s.transparent, opacity: s.opacity,
                       alphaTest: s.alphaTest, color: s.color.clone() };
        if (ud.cf_vlit) {
          const k = Number(ud.cf_vscale ?? 8) * P.lmi;
          const vm = new THREE.MeshBasicMaterial({ ...base, vertexColors: true, color: base.color.clone().multiplyScalar(k) });
          bakedV.push([vm, base.color.clone().multiplyScalar(Number(ud.cf_vscale ?? 8))]);
          for (const feature of features) feature.patchBaked?.(vm, m, { vertexLit: true });
          return withFog(vm);
        }
        const bm = new THREE.MeshBasicMaterial({ ...base, lightMap: lm, lightMapIntensity: Math.PI * P.lmi });
        bakedLm.push(bm);
        for (const feature of features) feature.patchBaked?.(bm, m, { vertexLit: false });
        return withFog(bm);
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    world.add(model.scene);
  }

  // extras: the render's lights, molten lava, shadows from the board light; Setting 2's magic
  let lavaMeshes = 0;
  const animated: THREE.ShaderMaterial[] = [], rings: THREE.ShaderMaterial[] = [], crystals: THREE.Material[] = [];
  const rune = fx && runeAtlas ? runeMaterial(runeAtlas, fx.runes) : null;
  if (simplifyTier && heavy.length) {
    const byRoot = new Map<THREE.Object3D, THREE.Mesh[]>();
    for (const [root, mesh] of heavy) byRoot.set(root, [...(byRoot.get(root) ?? []), mesh]);
    let before = 0, after = 0, ms = 0;
    for (const [root, list] of byRoot) { const r = await simplifyArenaMeshes(root, list, simplifyTier); before += r.before; after += r.after; ms += r.ms; }
    stats.simplified = `${before}->${after} tris in ${heavy.length} meshes, ${ms} ms`;
  }
  if (rune) animated.push(rune);
  if (extras) {
    extras.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (/^Piece_|^CFCL_Board/.test(m.name) || /^Piece_|^CFCL_Board/.test(m.parent?.name ?? "")) { m.visible = false; return; }
      meshes++;
      const isPiece = /^Piece_/.test(m.name) || /^Piece_/.test(m.parent?.name ?? "");
      m.castShadow = isPiece || /Sorcerer/.test(m.name);
      m.receiveShadow = /Board/.test(m.name);
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
        const nm = `${m.name} ${m.parent?.name ?? ""} ${src.name}`;
        if (fx && rune && /CF_S2_Rune/.test(nm)) return rune;
        if (fx && /CF_S2_(Wisp|Crystal|Shard|Rune)/.test(nm) && OFF.has(/Wisp/.test(nm) ? "wisp" : /Rune/.test(nm) ? "rune" : "crystal")) {
          m.visible = false;
          return src;
        }
        if (fx && /CF_S2_Wisp/.test(nm)) {
          const w = wispMaterial({ ...fx.wisps, strength: fx.wisps.strength * P.wisp }, hash01(m.name));
          animated.push(w);
          return w;
        }
        if (fx && /CF_S2_(Crystal|Shard)/.test(nm)) {
          const c = withFog(crystalMaterial(fx.crystals, hash01(m.name)));
          crystals.push(c);
          c.customProgramCacheKey = () => "cf-look-crystal";
          return c;
        }
        if (/Lava/.test(src.name) || /Lava/.test(m.name)) {
          const g = /glow(\d+)p(\d+)_heat(\d+)p(\d+)/.exec(src.name);
          const heat = (g ? Math.min(1.6, Number(`${g[3]}.${g[4]}`) / 2.2) : 0.6) * P.lava;
          for (const feature of features) {
            const made = feature.lavaMaterial?.(m, src, heat);
            if (made) { lavaMeshes++; return made; }
          }
        }
        const pal = PALETTE.find(([rx]) => rx.test(src.name));
        if (pal && (src as THREE.MeshStandardMaterial).isMeshStandardMaterial && !(src as THREE.MeshStandardMaterial).map) {
          const ms = src as THREE.MeshStandardMaterial;
          ms.color.setRGB(pal[1][0], pal[1][1], pal[1][2]);
          ms.roughness = pal[2]; ms.metalness = pal[3];
        }
        // the creature stands in open haze far from the board lamps: the sky / fog light is most of what it gets
        if (/Sorcerer/.test(m.name)) (src as THREE.MeshStandardMaterial).envMapIntensity = P.creatureEnv;
        for (const feature of features) feature.patchLit?.(src, m);
        return withFog(src);
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    world.add(extras.scene);
  }
  const statue = extras?.scene.getObjectByName("Crownfall_Sorcerer_Deform") as THREE.Mesh | undefined;
  const sorcerer = rigged && statue?.isMesh ? reviveSorcerer(rigged, statue) : null;
  if (rigged && !statue) { const { disposeBakedGroup } = await import('./environment'); disposeBakedGroup(rigged.scene); }
  const L = P.lights;
  let nLights = 0;
  const dyn: [THREE.Light, number, "sun" | "point" | "spot" | "area"][] = [];
  const kind = (t: string) => (t === "SUN" ? "sun" : t === "POINT" ? "point" : t === "SPOT" ? "spot" : "area") as "sun" | "point" | "spot" | "area";
  for (const l of inspect.lights as { name: string; type: string; energy: number; color: number[]; loc_gl: number[];
                                         dir_gl: number[]; size: number; spot_deg: number | null }[]) {
    // CFCL_Area_LavaUnder_* / CFCL_Point_LavaGlow_* sit 1.94 m above the board centre: Cycles' 13.8 m sphere and 11.5 m
    // area lamps there glow the abyss below; as three.js lamps they would floodlight the board instead
    if (/LavaUnder|LavaGlow/.test(l.name)) continue;
    
    const col = new THREE.Color(l.color[0], l.color[1], l.color[2]);
    const pos = new THREE.Vector3(...l.loc_gl), dir = new THREE.Vector3(...l.dir_gl).normalize();
    let light: THREE.Light;
    if (l.type === "SUN") {
      const d = new THREE.DirectionalLight(col, l.energy * L);
      d.position.copy(dir.clone().multiplyScalar(-200));
      d.target.position.set(0, 0, 0);
      world.add(d.target);
      light = d;
    } else if (l.type === "POINT") {
      light = new THREE.PointLight(col, (l.energy / (4 * Math.PI)) * L, 0, 2);
      light.position.copy(pos);
    } else if (l.type === "SPOT") {
      const s = new THREE.SpotLight(col, (l.energy / (4 * Math.PI)) * L, 0, THREE.MathUtils.degToRad((l.spot_deg ?? 45) / 2), 0.25, 2);
      s.position.copy(pos);
      s.target.position.copy(pos.clone().add(dir.clone().multiplyScalar(10)));
      world.add(s.target);
      if (/BoardTop/.test(l.name)) {
        s.castShadow = true;
        s.shadow.mapSize.set(Math.max(Q.shadow, 256), Math.max(Q.shadow, 256));
        s.shadow.camera.near = 5; s.shadow.camera.far = 60;
        s.shadow.bias = -0.0004; s.shadow.radius = 4;
      }
      light = s;
    } else {
      const a = Math.max(l.size, 0.1);
      const r = new THREE.RectAreaLight(col, (l.energy / (Math.PI * a * a)) * L, a, a);
      r.position.copy(pos);
      r.lookAt(pos.clone().add(dir));
      light = r;
    }
    light.name = l.name;
    light.visible = l.type !== "AREA" || Q.area || (Q.pieceArea && PIECE_AREA_LAMPS.test(l.name));
    world.add(light);
    dyn.push([light, light.intensity / L, kind(l.type)]);
    light.intensity *= P[kind(l.type)] * ((l.type === "POINT" || l.type === "SPOT") ? 1 / (2.3 * 2.3) : 1);
    nLights++;
  }

  for (const feature of features) feature.lamps?.(dyn.map(([light]) => light));

  const sk = inspect.objects.sky_eclipse;
  const ecl = sk.CFCL_Eclipse_Body as { center_gl: number[]; size: number[] };
  const eclPos = new THREE.Vector3(...ecl.center_gl), eclRad = ecl.size[0] / 2;
  const sorc = inspect.objects.creature.Crownfall_Sorcerer_Deform as { center_gl: number[] };
  const hole = new THREE.Mesh(new THREE.SphereGeometry(eclRad, 96, 48),
                              new THREE.MeshBasicMaterial({ color: new THREE.Color(0.004, 0.0035, 0.0035) }));
  hole.position.copy(eclPos);
  hole.renderOrder = -950;
  world.add(hole);
  const halo = fx && !OFF.has("halo") && P.halo > 0 ? lensHalo(eclPos, eclRad, P.halo) : null;
  if (halo) { world.add(halo); animated.push(halo.material as THREE.ShaderMaterial); }
  if (fx && !OFF.has("ring")) for (const spec of fx.eclipse.rings) {
    const big = { ...spec, r: [spec.r[0] === Math.min(...fx.eclipse.rings.map((x: { r: number[] }) => x.r[0])) ? spec.r[0] : spec.r[0] * P.diskScale,
                               spec.r[1] * P.diskScale], inclination_deg: (spec.inclination_deg ?? 74) + P.diskTilt };
    const ring = accretionRing(big, eclPos, eclRad, new THREE.Vector3(...inspect.camera.loc_gl));
    (ring.material as THREE.ShaderMaterial).uniforms.uSat.value = P.diskSat;
    const rm = ring.material as THREE.ShaderMaterial;
    rm.uniforms.uGain.value = P.ring;
    animated.push(rm);
    rings.push(rm);
    world.add(ring);
  }
  let embers: THREE.Points | null = null;
  if (P.embers && sk.CFCL_Eclipse_Embers) {
    embers = makeEmbers(sk.CFCL_Eclipse_Embers.center_gl, sk.CFCL_Eclipse_Embers.size, QUALITY.high.embers, arenaPhysics(context));
    embers.geometry.setDrawRange(0, Q.embers);
    world.add(embers);
  }

  // post: HDR scene target (MSAA + depth) -> bloom -> grade + LUT to the screen
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  let maxScale = Math.max(0.5, Math.min(1, options.renderScale / 100));
  let scale = QNAME === 'auto' ? Math.min(Q.scale, maxScale) : maxScale;
  const rtW = () => Math.max(2, Math.round(size.x * scale)), rtH = () => Math.max(2, Math.round(size.y * scale));
  const sceneRT = new THREE.WebGLRenderTarget(rtW(), rtH(), {
    type: THREE.HalfFloatType, samples: Q.msaa, depthTexture: new THREE.DepthTexture(rtW(), rtH()),
  });
  // Glare: bloom - high quality only (five blur passes)
  // Setting 1's glare is wide and starts just under white: the lava, the torches and the figures' lit staves carry a
  // halo into the dark the cinema part leaves round the board (arena-cinema.ts). Setting 2 keeps its tighter one.
  const makeBloom = () => new UnrealBloomPass(new THREE.Vector2(rtW(), rtH()), 0.32 * P.bloom, SETTING === 2 ? 0.45 : 0.55, SETTING === 2 ? 1.3 : 0.95);
  let bloom = Q.bloom ? makeBloom() : null;
  const lut = new THREE.Data3DTexture(new Uint8Array(lutBuf), lutMeta.size, lutMeta.size, lutMeta.size);
  lut.format = THREE.RGBAFormat; lut.type = THREE.UnsignedByteType;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
  lut.unpackAlignment = 1;
  lut.needsUpdate = true;
  const grade = gradeMaterial(lut, lutMeta, features.flatMap((feature) => (feature.grade ? [feature.grade] : [])));
  const quad = new FullScreenQuad(grade);
  const gu = grade.uniforms;
  gu.tScene.value = sceneRT.texture; gu.tDepth.value = sceneRT.depthTexture; gu.tDepthPano.value = panoDepth;
  gu.uEclPos.value.copy(eclPos); gu.uEclRadiusM.value = eclRad; gu.uSorcPos.value.set(...sorc.center_gl);

  const resize = () => {
    camera.aspect = Math.max(1, options.host.clientWidth) / Math.max(1, options.host.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(1, window.devicePixelRatio));
    renderer.setSize(Math.max(1, options.host.clientWidth), Math.max(1, options.host.clientHeight), false);
    renderer.getDrawingBufferSize(size);
    sceneRT.setSize(rtW(), rtH());
    bloom?.setSize(rtW(), rtH());
  };
  
  Object.assign(stats, { meshes, tris: Math.round(tris), lights: nLights, extras: !!extras, board: !!board, lava: lavaMeshes });

  // Development only: what a capture script tunes in a running match (the lamps by kind, the bloom, the grade).
  const lookHook = import.meta.env.DEV ? (window as unknown as { __crownfallLook?: unknown }) : null;
  if (lookHook) lookHook.__crownfallLook = { P, Q, grade: gu, lights: dyn, bloom: () => bloom, fog: fogUniforms, scene, world, camera, renderer };
  const clock = new THREE.Clock();
  // The arena keeps the match's own time when it is given it (SceneEngine.frame's delta), so its sorcerer, lava and
  // embers slow with a fatality's slow motion; on its own it keeps the wall clock.
  let frames = 0, last = performance.now(), elapsed = 0, matchTime = 0, lookTime = 0;
  const frame = (delta?: number) => {
    if (typeof delta === 'number' && Number.isFinite(delta)) matchTime += Math.max(0, delta);
    const still = options.reducedMotion(), seconds = typeof delta === 'number' && Number.isFinite(delta) ? matchTime : clock.getElapsedTime();
    const t = still ? 0 : seconds;
    sorcerer?.update(Math.min(0.1, seconds - elapsed), still);
    elapsed = seconds;
    const dt = Math.min(0.1, Math.max(0, t - lookTime));
    lookTime = t;
    sky.position.copy(camera.position).multiplyScalar(2.3);
    halo?.quaternion.copy(camera.quaternion);
    for (const feature of features) feature.update?.(t, dt);
    for (const m of animated) m.uniforms.uTime.value = t;
    if (embers) (embers.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    if (embers) (embers.material as THREE.ShaderMaterial).uniforms.uScale.value =
      rtH() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.updateMatrixWorld();
    gu.uProjInv.value.copy(camera.projectionMatrixInverse);
    gu.uCamWorld.value.copy(camera.matrixWorld);
    gu.uCamPos.value.copy(camera.position).multiplyScalar(2.3);
    gu.uNear.value = camera.near; gu.uFar.value = camera.far; gu.uAspect.value = camera.aspect;
    gu.uPx.value = THREE.MathUtils.degToRad(camera.fov) / rtH();
    gu.uEclDir.value.copy(eclPos).sub(camera.position.clone().multiplyScalar(2.3)).normalize();
    gu.uEclR.value = Math.asin(Math.min(1, eclRad / eclPos.distanceTo(camera.position.clone().multiplyScalar(2.3))));
    gu.uTime.value = t % 100;
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    bloom?.render(renderer, sceneRT, sceneRT, 0, false);
    renderer.setRenderTarget(null);
    quad.render(renderer);
    frames++;
    const now = performance.now();
    if (now - last > 1000) {
      if (now - last > 3000) { frames = 0; last = now; return; }
      stats.fps = Math.round((frames * 1000) / (now - last));
      stats.drawCalls = renderer.info.render.calls;
      // dynamic resolution: below ~42 fps render fewer pixels (down to half the canvas), back up when there is headroom
      if ((QNAME === "auto" || lite()) && !document.hidden) {
        const fps = stats.fps as number;
        const next = nextBattlefieldScale(scale, fps, maxScale, lite() ? MEDIUM_INTEGRATED_MIN_SCALE : 0.5);
        if (Math.abs(next - scale) > 0.01) {
          scale = next;
          sceneRT.setSize(rtW(), rtH());
          bloom?.setSize(rtW(), rtH());
        }
      }
      stats.renderScale = scale.toFixed(2);
      stats.pixels = `${rtW()}x${rtH()}`;
      frames = 0; last = now;
      options.onStats?.(stats);
    }
  };
  resize();
  const setQuality = (value: BattlefieldGraphics) => {
    QNAME = value; Object.assign(Q, QUALITY[value === 'auto' ? (integrated ? 'low' : 'medium') : value]);
    if (SETTING === 2 && value !== 'low' && !(value === 'auto' && integrated)) Q.bloom = true;
    if (lite()) Object.assign(Q, MEDIUM_INTEGRATED);
    else if (value !== 'auto') scale = maxScale;   // a fixed tier renders at the chosen scale again
    devKnobs();
    renderer.shadowMap.enabled = Q.shadow > 0;
    for (const [light, , type] of dyn) {
      light.visible = type !== 'area' || Q.area || (Q.pieceArea && PIECE_AREA_LAMPS.test(light.name));
      if (light instanceof THREE.SpotLight) { light.shadow.mapSize.set(Math.max(256, Q.shadow), Math.max(256, Q.shadow)); light.shadow.map?.dispose(); light.shadow.map = null; }
    }
    sceneRT.samples = Q.msaa;
    sceneRT.dispose();
    embers?.geometry.setDrawRange(0, Q.embers);
    if (!Q.bloom) { bloom?.dispose(); bloom = null; }
    else if (!bloom) bloom = makeBloom();
    scale = value === 'auto' ? Math.min(maxScale, Q.scale) : maxScale; stats.quality = value; stats.features = value === 'auto' ? (integrated ? 'low (integrated GPU)' : 'medium') : value;
    for (const feature of features) feature.setQuality?.({ name: QNAME, ...Q });
    resize();
  };
  // The match's cinematic moments ride in the grade pass (web/src/scene/moments): no pass of their own, and on the low
  // feature set, or the medium one on an integrated GPU, no chromatic fringe (its two extra reads of the frame per pixel).
  // A neutral grade skips all of it.
  const setMoment = (moment: MomentGrade) => {
    const low = lite() || (QNAME === 'auto' ? (integrated ? 'low' : 'medium') : QNAME) === 'low';
    writeMomentUniforms(gu as unknown as MomentUniforms, moment, { aberration: !low });
  };
  // `compile`: builds an object's shader programs as this pipeline draws them - into its own half-float scene target (a
  // program follows the colour space of the target bound) with the arena's lights, shadow type and environment - on the
  // driver's worker threads, resolving once they are linked. The match warms what it first shows mid-game with it under
  // the loading screen (SceneEngine.warmEffects): with the arena's lights, one lit material can take seconds to build.
  const compile = (object: THREE.Object3D): Promise<unknown> => {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(sceneRT);
    try { return renderer.compileAsync(object, camera, scene); } finally { renderer.setRenderTarget(previous); }
  };
  // the caller hands the board to SceneEngine.setBakedBoard, which owns and disposes it
  // `exposure`: what the frame is shown at. The scene is drawn untoned and multiplied by it before the grade, so the
  // match draws its effects that are light themselves against this, not the renderer's own exposure (never applied here).
  // the match tells the arena's parts when its opening is over, or that there is none (the wyverns fly higher meanwhile)
  const opening = (state: "none" | "over") => { for (const feature of features) feature.opening?.(state); };
  // `disturb`: the match tells the arena's air what happens on the board (a step, a blow, a body falling, a spell)
  return { render: frame, resize, stats, setQuality, setMoment, compile, opening, disturb: arenaPhysics(context).disturb, board: board?.scene ?? null, sorcerer, exposure: () => gu.uExposure.value, setBrightness(value: number) { gu.uExposure.value = Math.pow(2, P.exposure) * value; }, setResolutionScale(value: number) { maxScale = Math.max(.5, Math.min(1, value / 100)); scale = QNAME === 'auto' || lite() ? Math.min(scale, maxScale) : maxScale; resize(); }, dispose() {
    sorcerer?.dispose();
    for (const feature of features) feature.dispose?.();
    if (lookHook) delete lookHook.__crownfallLook;
    sceneRT.dispose(); bloom?.dispose(); quad.dispose(); grade.dispose(); lut.dispose();
    eqRT.dispose(); remap.dispose(); scene.environment?.dispose(); scene.environment = null;
    pano.dispose(); panoDepth.dispose();
    draco.dispose(); ktx2.dispose();
  } };
}
return await main();
}
