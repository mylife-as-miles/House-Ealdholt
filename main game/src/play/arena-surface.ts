/** The arena's surfaces, light and air: how the baked environment and the lit props answer the light, and what hangs
 * in the air between them. One part of the battlefield's look; see arena-kit.ts for how a part joins it.
 *
 * The baked environment is drawn unlit: albedo times the light Cycles baked. That bake is right, but most of the
 * Blender picture's brightness away from the sky came from lit fog, which the game does not have near the board, so
 * the arena stood crushed and flat. Here each baked surface is also given, from its own normal:
 *   - the sky's and the fog's light by direction (an ambient cube averaged from the sky panorama), less where the
 *     bake is dark, because there the bake says the place is shut in;
 *   - the lava's light from the stretches of lava near it (ArenaContext.shared.emitters);
 *   - highlights: the eclipse's key where the bake shows it lands, the lava, and the sky at a glancing angle;
 *   - fine detail (colour break-up, cracks, bump) from one small texture generated here, laid on from three sides.
 * On the low tier only the first two are given, and not per frame: they are added to the bake itself when the arena
 * starts (arena-surface-bake.ts), because an integrated GPU has no instructions to spare per pixel here.
 * The pieces, the board and the lit props belong to shaders this part must not grow, so they are set in the same
 * light with two lamps: sky above and lava below, and the lava's side glow. The air is arena-air.ts.
 */
import * as THREE from "three";
import { ARENA_MAX_EMITTERS, patchShader, type ArenaContext, type ArenaEmitter, type ArenaFeature, type ArenaQuality } from "./arena-kit";
import { createArenaAir } from "./arena-air";
import { integratedGraphics } from "../../../shared/play/battlefield-graphics";
import { addLightToVertexColours, bakeLightIntoLightmap, type BakeMesh } from "./arena-surface-bake";
import { ambientCubeFromPanorama, arenaLightAt, arenaOpenness, arenaTier, detailTexels, emittersFromInspect, emittersReaching, evenedCube, surfaceKind, tintedCube, type Rgb, type SurfaceKind } from "./arena-surface-data";

/** An emitter's light is counted out to this many of its radii, where the shader has faded it to nothing. */
const EMITTER_REACH = 4;
const DETAIL_SIZE = 256;
/** The upper ring's pale stone (see bakeOnce). */
const RING_STONE = /SeatRock|MasonryBlocks|Ashlar/;
/** Half the width of the board with its frame, in the game's units (the look's Blender board is 21.86 m across). */
const BOARD_HALF = 10.93 / 2.3;

// Shared by the vertex and the fragment shaders. The six faces of the ambient cube are six uniforms and the lava is
// a small texture, not arrays: three.js sends an array uniform again for every material of every frame, and there
// are some four hundred baked materials.
const LIGHT_PARS = /* glsl */ `
uniform vec3 uCfAmbPX, uCfAmbNX, uCfAmbPY, uCfAmbNY, uCfAmbPZ, uCfAmbNZ;
uniform highp sampler2D uCfEmitters;
uniform vec4 uCfLight, uCfShape, uCfNear, uCfBoard, uCfBake;
uniform vec2 uCfOpen;
// How open a place is by its baked light, on a log scale between 2^uCfOpen.x and 2^uCfOpen.y, from low where the
// bake is black (see arenaOpenness in arena-surface-data.ts)
float cfOpenness(float lum, float low) {
  return mix(low, 1.0, clamp((log2(max(lum, 1e-7)) - uCfOpen.x) / (uCfOpen.y - uCfOpen.x), 0.0, 1.0));
}
// light from the six axis directions, blended by the normal
vec3 cfAmbient(vec3 n) {
  vec3 w = n * n;
  return w.x * (n.x > 0.0 ? uCfAmbPX : uCfAmbNX) + w.y * (n.y > 0.0 ? uCfAmbPY : uCfAmbNY) + w.z * (n.z > 0.0 ? uCfAmbPZ : uCfAmbNZ);
}
// The sky's and the fog's fill at a place. It is for the arena: the ruins far out keep their dark shapes against the
// sky (the look's fog lightens them). The board stands in its way: the floor round the board's foot gets less.
vec3 cfFill(vec3 p, vec3 n) {
  float far = smoothstep(uCfNear.z, uCfNear.w, length(p.xz - uCfNear.xy));
  float foot = smoothstep(0.0, uCfBoard.z, length(max(abs(p.xz) - uCfBoard.x, 0.0))) + smoothstep(uCfBoard.y - 0.4, uCfBoard.y, p.y);
  return cfAmbient(n) * (uCfLight.x * mix(1.0, uCfShape.y, far) * mix(uCfBoard.w, 1.0, min(foot, 1.0)));
}
// One stretch of lava's light on a surface at p: lava is a wide, low source. Its light falls off with the solid
// angle it fills, reaches what stands above or beside it rather than what lies below, and wraps a little way round
// a surface by its width. xyz: the direction to it, w: its strength on the surface (0 beyond its reach).
vec4 cfLava(vec4 lava, vec3 p, vec3 n) {
  vec3 d = lava.xyz - p;
  float r2 = lava.w * lava.w, d2 = dot(d, d), range2 = r2 * ${(EMITTER_REACH * EMITTER_REACH).toFixed(2)};
  if (d2 >= range2) return vec4(0.0);
  float inv = inversesqrt(d2 + 1e-4), fade = 1.0 - d2 / range2;
  float wide = min(lava.w * inv, 0.35);
  return vec4(d * inv, r2 / (d2 + r2) * fade * fade * clamp(0.4 - 1.3 * d.y * inv, 0.0, 1.0) * clamp((dot(n, d) * inv + wide) / (1.0 + wide), 0.0, 1.0));
}`;

// What both variants need from the bake, at the line where the basic material multiplies its baked light by the albedo.
const BAKED_READ = /* glsl */ `
#ifdef USE_LIGHTMAP
  vec3 cfAlbedo = diffuseColor.rgb;
  vec3 cfBaked = reflectedLight.indirectDiffuse;
#elif defined( USE_COLOR )
  // vertex-lit meshes: the vertex colours hold light, or (uCfTint.a = 1: plain white materials) colour times light,
  // divided by uCfBake.x. For the latter the kind's albedo gives the brightness and the colour half its hue: the
  // colour's hue is the surface's (moss green) but also the baked light's (orange beside the lava), which the fill
  // would otherwise carry all over the mesh.
  float cfVLum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float cfTintLum = dot(uCfTint.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 cfAlbedo = uCfTint.a > 0.5
    ? (cfVLum > 1e-6 ? cfTintLum * mix(vec3(1.0), min(max(vColor.rgb, 0.0) / cfVLum, vec3(3.0)), 0.5) : uCfTint.rgb)
    : cfMapColor / uCfBake.x;
  vec3 cfBaked = uCfTint.a > 0.5 ? diffuseColor.rgb / cfTintLum : vColor.rgb * uCfBake.x;
#else
  vec3 cfAlbedo = diffuseColor.rgb;
  vec3 cfBaked = vec3(1.0);
#endif
// With multisampling a pixel's centre can lie just outside its triangle, where the vertex colours run on past their
// last value, even below zero: no light here is ever negative.
float cfLum = max(dot(cfBaked, vec3(0.2126, 0.7152, 0.0722)), 0.0);
// how open the bake says this place is: dark in the bake means little of the sky reaches it; and the kind's share
float cfOpen = cfOpenness(cfLum, uCfBake.y) * uCfBake.w;
reflectedLight.indirectDiffuse *= diffuseColor.rgb;`;

// The low tier's light, for the bake at the arena's start (arena-surface-bake.ts): the fill and the lava, diffuse only.
const BAKED_ONCE = /* glsl */ `
${LIGHT_PARS}
vec3 cfBakedLight(vec3 p, vec3 n, int mask) {
  vec3 light = cfFill(p, n);
  for (int i = 0; i < ${ARENA_MAX_EMITTERS} && mask != 0; i++, mask >>= 1) {
    if ((mask & 1) == 0) continue;
    vec4 l = cfLava(texelFetch(uCfEmitters, ivec2(i, 0), 0), p, n);
    if (l.w > 0.0) light += texelFetch(uCfEmitters, ivec2(i, 1), 0).rgb * (l.w * uCfLight.y);
  }
  return light;
}`;

// The medium and high tiers' shader: everything per pixel. uCfTier chooses how much of it runs (0: light only,
// 1: one layer of detail and the highlights, 2: two layers), so changing tier never rebuilds a shader. Texture reads inside the
// branches name their mip level, from the distance: screen derivatives may not sit inside a branch.
const BAKED_FULL = {
  vertexPars: /* glsl */ `
varying vec3 vCfNormal;
varying vec3 vCfWorld;`,
  vertex: /* glsl */ `
vCfWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vCfNormal = mat3(modelMatrix) * normal;`,
  fragmentPars: /* glsl */ `
varying vec3 vCfNormal;
varying vec3 vCfWorld;
${LIGHT_PARS}
uniform vec4 uCfMat, uCfTint, uCfDetailScale, uCfDetailMix, uCfEase;
uniform vec3 uCfKeyDir, uCfKeyCol, uCfReliefDir;
uniform float uCfTier, uCfPixel;
uniform sampler2D uCfDetail;`,
  fragment: /* glsl */ `
${BAKED_READ}
{
  vec3 cfN0 = normalize(vCfNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 cfN = cfN0;
  vec3 cfToEye = cameraPosition - vCfWorld;
  float cfFar = length(cfToEye);
  vec3 cfV = cfToEye / cfFar;
  float cfRough = uCfMat.x, cfBreak = 1.0, cfCavity = 1.0;
  if (uCfTier > 0.5) {
    // the detail texture laid on along each axis and blended by how squarely the surface faces it
    vec3 w = abs(cfN0); w *= w; w *= w; w /= w.x + w.y + w.z;
    // a pixel's width on the surface: wider the further off and the more glancing the view
    float pix = cfFar * uCfPixel / max(dot(cfN0, cfV), 0.3);
    vec3 q = vCfWorld * uCfDetailScale.x;
    float lod = log2(max(pix * uCfDetailScale.x * uCfDetailScale.z, 1.0));
    vec4 sx = textureLod(uCfDetail, q.zy, lod), sy = textureLod(uCfDetail, q.xz, lod), sz = textureLod(uCfDetail, q.xy, lod);
    float grain = sx.r * w.x + sy.r * w.y + sz.r * w.z - 0.5;
    cfCavity = sx.a * w.x + sy.a * w.y + sz.a * w.z;
    vec3 slope = w.x * vec3(0.0, sx.b - 0.5, sx.g - 0.5) + w.y * vec3(sy.g - 0.5, 0.0, sy.b - 0.5) + w.z * vec3(sz.g - 0.5, sz.b - 0.5, 0.0);
    if (uCfTier > 1.5) {
      // a second, broader layer: slabs and worn patches metres across, so the fine layer's repeat does not show
      vec3 q2 = vCfWorld * uCfDetailScale.y + 0.37;
      float lod2 = log2(max(pix * uCfDetailScale.y * uCfDetailScale.z, 1.0));
      vec4 bx = textureLod(uCfDetail, q2.zy, lod2), by = textureLod(uCfDetail, q2.xz, lod2), bz = textureLod(uCfDetail, q2.xy, lod2);
      grain = 0.75 * grain + 0.6 * (bx.r * w.x + by.r * w.y + bz.r * w.z - 0.5);
      cfCavity *= mix(1.0, bx.a * w.x + by.a * w.y + bz.a * w.z, 0.7);
      slope += 0.7 * (w.x * vec3(0.0, bx.b - 0.5, bx.g - 0.5) + w.y * vec3(by.g - 0.5, 0.0, by.b - 0.5) + w.z * vec3(bz.g - 0.5, bz.b - 0.5, 0.0));
    }
    float amount = uCfMat.z;
    cfN = normalize(cfN0 - (uCfDetailScale.w * amount) * (slope - cfN0 * dot(slope, cfN0)));
    cfBreak = (1.0 + amount * uCfDetailMix.x * grain) * mix(1.0 - uCfDetailMix.y * amount, 1.0, cfCavity);
    // no rougher than the detail can be drawn without single bright pixels where a bump catches the key exactly
    cfRough = clamp(cfRough + amount * uCfDetailMix.z * (grain + 0.6 * (1.0 - cfCavity)), 0.22, 1.0);
  }
  // Where the bake is already bright, or the surface itself is pale, the fill would only flatten it: pale stone by the
  // lava went chalky. There it eases off, so the bake's own shading, and the lava's warm light in it, carry the surface.
  // The dark places it was made for keep all of it.
  float cfEaseLit = 1.0 / (1.0 + cfLum * uCfEase.x);
  float cfEase = cfEaseLit / (1.0 + max(dot(cfAlbedo, vec3(0.2126, 0.7152, 0.0722)) - 0.12, 0.0) * uCfEase.y);
  // and where the bake is bright, what is left of it takes the bake's own colour: the sky's cool fill over stone the
  // bake lit warm read lavender (at four tenths of the bake's saturation: beside the lava its colour is nearly pure
  // orange, and pale tiles there turned pink)
  vec3 cfFillLight = cfFill(vCfWorld, cfN);
  vec3 cfBakedHue = mix(vec3(1.0), min(max(cfBaked, 0.0) / max(cfLum, 1e-5), vec3(4.0)), 0.4);
  cfFillLight = mix(cfFillLight, dot(cfFillLight, vec3(0.2126, 0.7152, 0.0722)) * cfBakedHue, 1.0 - cfEaseLit);
  vec3 cfDiffuse = cfFillLight * (cfOpen * cfEase);
  vec3 cfSpecular = vec3(0.0);
  float cfNv = max(dot(cfN, cfV), 0.0);
  // the highlights see the bump at half strength: at full strength the rim of every little pit caught the key, and
  // rough stone threw gold glints
  vec3 cfNs = normalize(cfN0 + cfN);
  float cfA2 = cfRough * cfRough; cfA2 *= cfA2;
  int mask = int(uCfBake.z);
  for (int i = 0; i < ${ARENA_MAX_EMITTERS} && mask != 0; i++, mask >>= 1) {
    if ((mask & 1) == 0) continue;
    vec4 lava = texelFetch(uCfEmitters, ivec2(i, 0), 0);
    vec4 l = cfLava(lava, vCfWorld, cfN);
    if (l.w > 0.0) {
      vec3 e = texelFetch(uCfEmitters, ivec2(i, 1), 0).rgb * l.w;
      cfDiffuse += e * uCfLight.y;
      // a wide source blurs its own highlight
      float nh = max(dot(cfNs, normalize(l.xyz + cfV)), 0.0);
      float a2 = min(1.0, cfA2 + 0.25 * lava.w * lava.w / dot(lava.xyz - vCfWorld, lava.xyz - vCfWorld));
      float dn = nh * nh * (a2 - 1.0) + 1.0;
      cfSpecular += e * (a2 / (3.14159265 * dn * dn));
    }
  }
  vec3 cfShine = vec3(0.0);
  if (uCfTier > 0.5) {
    // the eclipse's key: a highlight where the bake shows its light lands
    float nh = max(dot(cfNs, normalize(uCfKeyDir + cfV)), 0.0);
    float dn = nh * nh * (cfA2 - 1.0) + 1.0;
    cfSpecular += uCfKeyCol * (cfA2 / (3.14159265 * dn * dn) * max(dot(cfNs, uCfKeyDir), 0.0) * smoothstep(uCfShape.z, uCfShape.w, cfLum));
    vec3 f0 = mix(vec3(0.04), cfAlbedo, uCfMat.y);
    float fresnel = pow(1.0 - cfNv, 5.0);
    // and the sky and the lava mirrored at a glancing angle
    vec3 sheen = cfAmbient(reflect(-cfV, cfN)) * (cfOpen * cfEase) * (f0 + (max(vec3(1.0 - cfRough), f0) - f0) * fresnel);
    // A rough surface seen at a glancing angle does not glint: its Fresnel rise is held to its smoothness, as in the
    // sheen, and the visibility term is bounded (unbounded, the bumps of rough basalt flashed like metal in the key).
    // And the highlight is held to the surface's own brightness: on dark basalt a highlight many times its albedo read as
    // polished metal on the high tier.
    float cfShineCap = min(1.5, 0.35 + 6.0 * dot(cfAlbedo, vec3(0.2126, 0.7152, 0.0722)));
    cfShine = min((cfSpecular * (0.25 / max(cfNv, 0.4)) * (f0 + (max(vec3(1.0 - cfRough), f0) - f0) * fresnel) + sheen) * (uCfLight.z * uCfMat.w * cfCavity), vec3(cfShineCap));
  }
  // the bump shades the baked light too, within bounds: boosted further, the flecks of a brightly baked face read as
  // metal glints (dark basalt in the eclipse's golden light)
  reflectedLight.indirectDiffuse = max(reflectedLight.indirectDiffuse * (cfBreak * clamp(1.0 + uCfLight.w * dot(cfN - cfN0, uCfReliefDir), 0.6, 1.35))
    + cfAlbedo * ((1.0 - uCfMat.y) * cfBreak) * cfDiffuse + cfShine, 0.0);
}`,
};

export function createArenaSurface(context: ArenaContext): ArenaFeature {
  // Development only: `localStorage["crownfall.arena.surface"] = "off"` leaves this part out, for stills of the
  // arena without it.
  if (import.meta.env?.DEV && typeof localStorage !== "undefined" && localStorage.getItem("crownfall.arena.surface") === "off") return {};
  const violet = context.setting === 2;
  const tint = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const scaled = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];

  // --- what lights the arena -------------------------------------------------------------------------------------
  // The sky by direction, from the panorama the look draws as its sky (at the gain it draws it: Setting 2's is 0.3).
  const image = context.panorama.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = image.data instanceof Uint16Array;
  const skyGain = violet ? 0.3 : 1;
  // The fog scatters it on the way down: more evenly, and in the fog's own colour (the Blender scene's CFCL_Fog) except
  // on the side that looks straight at the eclipse.
  const fogColor: Rgb = violet ? [0.34, 0.24, 0.62] : [0.46, 0.54, 0.7];
  const sky = tintedCube(evenedCube(ambientCubeFromPanorama(image.width, image.height,
    (index) => (half ? THREE.DataUtils.fromHalfFloat(image.data[index]) : image.data[index]) * skyGain,
    { ceiling: 2.5, step: Math.max(1, Math.ceil(image.width / 384)) }), 0.5, 2), fogColor, [0.4, 0.4, 0.7, 0, 0.7, 0.1]);
  // The eclipse's key lamp, as the Blender scene has it.
  const lamps = (context.inspect.lights ?? []) as { name: string; color: number[]; dir_gl: number[] }[];
  const keyLamp = lamps.find((lamp) => /EclipseKey/.test(lamp.name)) ?? lamps.find((lamp) => /Eclipse/.test(lamp.name));
  const keyDir = keyLamp ? new THREE.Vector3(...keyLamp.dir_gl).normalize().negate() : new THREE.Vector3(0, 0.26, -0.96).normalize();
  const keyColor: Rgb = keyLamp ? [keyLamp.color[0], keyLamp.color[1], keyLamp.color[2]] : [1, 0.69, 0.29];
  // The lava. The lava part lists its stretches; if it lists none, the pools of the look's own scene stand in.
  const lavaColor: Rgb = [1, 0.24, 0.05];
  const emitters: ArenaEmitter[] = (context.shared.emitters.length
    ? context.shared.emitters
    : emittersFromInspect(context.inspect, 1 / 2.3).map((pool) => ({
      position: new THREE.Vector3(...pool.at), radius: pool.radius, color: new THREE.Color(...lavaColor), level: 1,
    }))).slice(0, ARENA_MAX_EMITTERS);
  // Their colours are taken relative to the brightest, so this part's own strength decides how far the lava lights.
  const peak = Math.max(1e-4, ...emitters.map((emitter) => Math.max(emitter.color.r, emitter.color.g, emitter.color.b)));
  // From below comes the abyss: lava under the whole dais. It is the ambient cube's underside.
  sky.faces[3] = scaled(lavaColor, violet ? 0.03 : 0.04);
  // Row 0: where each stretch of lava is and how wide; row 1: its light now.
  const lavaTexels = new Float32Array(ARENA_MAX_EMITTERS * 2 * 4);
  const lava = new THREE.DataTexture(lavaTexels, ARENA_MAX_EMITTERS, 2, THREE.RGBAFormat, THREE.FloatType);
  lava.minFilter = lava.magFilter = THREE.NearestFilter;
  lava.generateMipmaps = false;
  function writeLava() {
    let changed = false;
    emitters.forEach((emitter, index) => {
      const k = emitter.level / peak;
      const values = [emitter.position.x, emitter.position.y, emitter.position.z, emitter.radius, emitter.color.r * k, emitter.color.g * k, emitter.color.b * k, 1];
      for (let i = 0; i < 8; i++) {
        const at = (i < 4 ? index : ARENA_MAX_EMITTERS + index) * 4 + (i & 3);
        if (lavaTexels[at] !== Math.fround(values[i])) { lavaTexels[at] = values[i]; changed = true; }
      }
    });
    if (changed) lava.needsUpdate = true;
  }
  writeLava();
  lava.needsUpdate = true;

  // --- the fine detail ---------------------------------------------------------------------------------------------
  const detail = new THREE.DataTexture(detailTexels(DETAIL_SIZE), DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.minFilter = THREE.LinearMipmapLinearFilter; detail.magFilter = THREE.LinearFilter;
  detail.generateMipmaps = true;
  detail.needsUpdate = true;

  // --- uniforms every baked material shares ------------------------------------------------------------------------
  const face = (index: number) => ({ value: new THREE.Vector3(...sky.faces[index]) });
  const shared = {
    uCfAmbPX: face(0), uCfAmbNX: face(1), uCfAmbPY: face(2), uCfAmbNY: face(3), uCfAmbPZ: face(4), uCfAmbNZ: face(5),
    uCfEmitters: { value: lava },
    // strengths: sky and fog fill, lava, highlights, how much the bump shades the baked light. Setting 2's sky is
    // drawn at 0.3 of its panorama, so its fill is stronger for the same lift; its night stays darker. Setting 1's fill
    // is strong for the dark basalt and paving round the board; pale stone takes far less of it (uCfEase.y).
    uCfLight: { value: new THREE.Vector4(violet ? 22 : 14, violet ? 1.2 : 1.3, 1.6, 0.6) },
    // the baked light, as powers of two, below which a place counts as shut in and above which as open (the
    // lightmaps' quartiles are 0.0006, 0.012 and 0.13)
    uCfOpen: { value: new THREE.Vector2(Math.log2(0.0004), Math.log2(0.05)) },
    // x: unused; y: the share of the fill the far ruins get; z, w: the range of baked light over which the key's
    // highlight comes in
    uCfShape: { value: new THREE.Vector4(0, 0.45, 0.12, 0.6) },
    // how fast the fill eases off where the bake is bright (x, per unit of baked light) and where the surface is pale
    // (y, per unit of albedo above 0.12). The pale ashlar of the dais's upper ring stands in the bake's shade, so only
    // its paleness spares it: at 3 the sky's cool fill turned it chalky. Setting 2's night has no pale stone to spare.
    uCfEase: { value: new THREE.Vector4(violet ? 0 : 3, violet ? 0 : 12, 0, 0) },
    // where the arena is (x, z) and the distances over which the fill falls to the far ruins' share
    uCfNear: { value: new THREE.Vector4(0, -6, 26, 64) },
    // the board (the engine's, centred on the origin, its top at 0): half its width, its top's height, how far
    // from its foot the floor is shaded, and the share of the fill left at the foot
    uCfBoard: { value: new THREE.Vector4(BOARD_HALF, 0, 1.6, 0.55) },
    uCfKeyDir: { value: keyDir }, uCfKeyCol: { value: new THREE.Vector3(...scaled(keyColor, violet ? 0.9 : 1.4)) },
    uCfReliefDir: { value: keyDir.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.8, 0)).normalize() },
    // the full variant's tier (see BAKED_FULL)
    uCfTier: { value: 0 },
    // the width of a pixel at distance 1, for choosing the detail's mip level
    uCfPixel: { value: 0.001 },
    uCfDetail: { value: detail },
    // repeats per unit of the fine and the broad layer, texels per repeat, bump strength
    uCfDetailScale: { value: new THREE.Vector4(1 / 1.1, 1 / 5.3, DETAIL_SIZE, 1.2) },
    // colour break-up, darkening in cracks, roughness variation
    uCfDetailMix: { value: new THREE.Vector4(0.9, 0.45, 0.5, 0) },
  };

  // --- the baked environment ---------------------------------------------------------------------------------------
  // How the baked surfaces are lit is settled here, by the tier the arena starts on, and not changed after: on the
  // low tier the light is added to the bake once, on the others each material's shader is patched. A later change of
  // tier only moves uniforms (an arena begun on the low tier keeps its baked-in light until the next match).
  // An integrated GPU takes the low tier's way at every tier: the per-pixel light cost a UHD 630 17 to 24 ms a frame.
  // Nothing here depends on the look's area lamps, which such GPUs may run without.
  const gl = context.renderer.getContext();
  const gpuInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const integrated = integratedGraphics(String(gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
  const tierOf = (quality: ArenaQuality) => (integrated ? 0 : arenaTier(quality));
  const once = tierOf(context.quality()) === 0;
  const hook = typeof window !== "undefined" && import.meta.env?.DEV ? (window as unknown as { __crownfallArenaSurface?: unknown }) : null;
  const key = "cf-surface";
  let enabled = true;
  // The share of the fill left where the bake is black: a little of the sky reaches even a crevice, and the bake's
  // own black is partly its noise.
  const floors = { lightmap: 0.25, vertex: 0.25 };
  const patched: { material: THREE.MeshBasicMaterial; mesh: THREE.Mesh; bake: THREE.Vector4; mat: THREE.Vector4; kind: SurfaceKind; vertexLit: boolean; litAlbedo: boolean }[] = [];
  function patchBaked(material: THREE.MeshBasicMaterial, mesh: THREE.Mesh, info: { vertexLit: boolean }) {
    const kind = surfaceKind(`${material.name} ${mesh.name} ${mesh.parent?.name ?? ""}`);
    // as battlefield-look.ts reads them: the mesh's own bake notes, else its parent's
    const notes = (mesh.userData.cf_vlit ? mesh.userData : mesh.parent?.userData ?? {}) as { cf_vlit?: string; cf_vscale?: number };
    const litAlbedo = info.vertexLit && notes.cf_vlit !== "light";
    const own = {
      uCfMat: { value: new THREE.Vector4(kind.roughness, kind.metal, kind.detail, kind.sheen) },
      uCfTint: { value: new THREE.Vector4(kind.albedo[0], kind.albedo[1], kind.albedo[2], litAlbedo ? 1 : 0) },
      // x: what the vertex colours were divided by, y: the fill left where the bake is black, z: which stretches of
      // lava reach this mesh, one bit each (set on the first frame), w: the kind's share of the fill
      uCfBake: { value: new THREE.Vector4(info.vertexLit ? Number(notes.cf_vscale ?? 8) : 1, info.vertexLit ? floors.vertex : floors.lightmap, 0, kind.fill) },
    };
    patched.push({ material, mesh, bake: own.uCfBake.value, mat: own.uCfMat.value, kind, vertexLit: info.vertexLit, litAlbedo });
    if (once) return;
    patchShader(material, key, (shader) => {
      // The uniforms go in even when the change to the shader does not: three.js keeps the uniforms of a material's
      // last-built program, and a program built before (with the change) may be taken up again without a rebuild.
      Object.assign(shader.uniforms, shared, own);
      if (!enabled) return;
      const fragment = shader.fragmentShader, vertex = shader.vertexShader;
      const anchor = "reflectedLight.indirectDiffuse *= diffuseColor.rgb;";
      if (!fragment.includes(anchor) || !fragment.includes("#include <color_fragment>") || !vertex.includes("#include <project_vertex>")) {
        console.warn("[arena] a baked material's shader is not the one the surface light was written for; left as it was", material.name);
        return;
      }
      shader.vertexShader = vertex
        .replace("#include <common>", `#include <common>\n${BAKED_FULL.vertexPars}`)
        .replace("#include <project_vertex>", `#include <project_vertex>\n${BAKED_FULL.vertex}`);
      shader.fragmentShader = fragment
        .replace("#include <common>", `#include <common>\n${BAKED_FULL.fragmentPars}`)
        .replace("#include <color_fragment>", "vec3 cfMapColor = diffuseColor.rgb;\n#include <color_fragment>")
        .replace(anchor, BAKED_FULL.fragment);
    });
  }
  // Which lava reaches which mesh is settled on the first frame, when every mesh stands where it will stay.
  let placed = false;
  const baked: THREE.WebGLRenderTarget[] = [];
  function placeMeshes() {
    placed = true;
    const sphere = new THREE.Sphere();
    for (const entry of patched) {
      const geometry = entry.mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      entry.mesh.updateWorldMatrix(true, false);
      sphere.copy(geometry.boundingSphere!).applyMatrix4(entry.mesh.matrixWorld);
      entry.bake.z = emittersReaching(emitters, sphere.center, sphere.radius, EMITTER_REACH, ARENA_MAX_EMITTERS)
        .reduce((mask, index) => mask | (1 << index), 0);
    }
    if (once) bakeOnce();
  }
  // The low tier (and every tier on integrated graphics): the same fill and lava light as the shader's, added to the
  // lightmaps and the vertex colours. Without the shader's highlights, sheen and detail (and, on integrated graphics,
  // without the area lamps) Setting 1 came out crushed: in the play view at medium on integrated graphics 8% of the
  // picture was near black (the obsidian and basalt floor beyond the board), so the lightmaps take three times the fill
  // and the vertex-lit dais 1.6 times. The upper ring's seat rocks and masonry, vertex-lit pale stone in the open, take
  // less than they did: added in full their colours went chalky white.
  const onceFill = violet ? { lightmap: 1, vertex: 1, ringStone: 1 } : { lightmap: 3, vertex: 1.6, ringStone: 0.4 };
  function bakeOnce() {
    const started = performance.now();
    const [lo, hi] = shared.uCfOpen.value.toArray();
    const lightmaps = new Map<THREE.Texture, BakeMesh[]>();
    let lightmapMs = 0;
    for (const entry of patched) {
      const lightmap = entry.material.lightMap;
      if (entry.vertexLit || !lightmap) continue;
      const list = lightmaps.get(lightmap) ?? [];
      if (!list.some((other) => other.mesh === entry.mesh)) {
        list.push({ mesh: entry.mesh, mask: entry.bake.z, share: (1 - entry.kind.metal) * entry.kind.fill * onceFill.lightmap, color: entry.material.color, map: entry.material.map });
      }
      lightmaps.set(lightmap, list);
    }
    for (const [lightmap, meshes] of lightmaps) {
      const result = bakeLightIntoLightmap(context.renderer, lightmap, meshes, { pars: BAKED_ONCE, uniforms: shared, floor: floors.lightmap, lo, hi, ease: shared.uCfEase.value.x, paleEase: shared.uCfEase.value.y });
      baked.push(result);
      for (const entry of patched) if (entry.material.lightMap === lightmap) entry.material.lightMap = result.texture;
      // nothing draws the first lightmap any more: free its copy on the GPU (its texels stay with the look)
      lightmap.dispose();
    }
    lightmapMs = performance.now() - started;
    const model = {
      faces: sky.faces, fill: shared.uCfLight.value.x, farShare: shared.uCfShape.value.y, near: shared.uCfNear.value.toArray() as [number, number, number, number],
      board: shared.uCfBoard.value.toArray() as [number, number, number, number],
      lava: shared.uCfLight.value.y, reach: EMITTER_REACH,
      emitters: emitters.map((emitter) => ({ x: emitter.position.x, y: emitter.position.y, z: emitter.position.z, radius: emitter.radius,
        color: [emitter.color.r, emitter.color.g, emitter.color.b].map((value) => value * emitter.level / peak) as Rgb })),
    };
    // A geometry that several meshes share (the scattered moss cushions) is lit once, where the first of them stands:
    // its colours belong to all of them.
    const done = new Set<THREE.BufferGeometry>();
    for (const entry of patched) {
      if (!entry.vertexLit || done.has(entry.mesh.geometry)) continue;
      done.add(entry.mesh.geometry);
      // The material's colour is the scale the bake was divided by, times its base colour: what is added to the
      // vertex colours is divided by both, so that it shows at the albedo asked for.
      const scale = entry.bake.x, base = entry.material.color.toArray().map((value) => value / scale);
      const share = (1 - entry.kind.metal) * entry.kind.fill * (RING_STONE.test(entry.material.name) ? onceFill.ringStone : onceFill.vertex);
      addLightToVertexColours(entry.mesh.geometry, entry.mesh.matrixWorld, {
        scale, open: (luma) => arenaOpenness(luma, floors.vertex, lo, hi) * share, ease: shared.uCfEase.value.x, paleEase: shared.uCfEase.value.y,
        albedo: entry.litAlbedo ? entry.kind.albedo.map((value, channel) => value / Math.max(1e-4, base[channel])) : null,
        light: (position, normal, out) => arenaLightAt(model, entry.bake.z, position, normal, out),
      });
    }
    if (hook) console.info(`[arena] light baked into ${lightmaps.size} lightmaps (${Math.round(lightmapMs)} ms) and ${done.size} vertex-lit meshes (${Math.round(performance.now() - started - lightmapMs)} ms)`);
  }

  // --- the pieces, the board and the lit props ---------------------------------------------------------------------
  // Their shaders stay as they are; two lamps set them in the arena's light. Sky above and the abyss's lava below
  // (three's hemisphere lamp takes irradiance, the cube holds radiance: hence pi), and the glow of the lava pools
  // that lie beyond Black's side, low across the board. Both are made here, once: a lamp added or hidden later would
  // rebuild every lit shader. An arena begun on the low tier gets the hemisphere lamp alone: the directional one adds a
  // whole light (diffuse and highlight) to every pixel of every piece, which an integrated GPU has no time for.
  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(...scaled(sky.faces[2], Math.PI)), new THREE.Color(...scaled(sky.faces[3], Math.PI)), violet ? 2.6 : 1.5);
  hemisphere.name = "arena-sky-and-abyss";
  const centre = emitters.reduce((sum, emitter) => sum.addScaledVector(emitter.position, 1 / emitters.length), new THREE.Vector3());
  const lavaSide = once || !emitters.length ? null : new THREE.DirectionalLight(new THREE.Color(...lavaColor), violet ? 0.35 : 0.5);
  // under the arena's root, with the look's own lamps
  context.world.add(hemisphere);
  if (lavaSide) {
    lavaSide.name = "arena-lava-side";
    lavaSide.position.copy(centre.lengthSq() > 1 ? centre.clone().setY(-0.18 * centre.length()).normalize().multiplyScalar(60) : new THREE.Vector3(0, -12, -58));
    context.world.add(lavaSide, lavaSide.target);
  }

  // --- the air -------------------------------------------------------------------------------------------------------
  const air = createArenaAir(context, {
    up: sky.faces[2], horizon: sky.horizon, lava: lavaColor, sun: keyDir, sunColor: tint(keyColor, violet ? [0.75, 0.62, 1.6] : [1, 1, 1]),
  }, tierOf);

  function setQuality(quality: ArenaQuality) {
    shared.uCfTier.value = tierOf(quality);
    air.setQuality(quality);
  }
  setQuality(context.quality());

  // Development only: lets a capture script tune the strengths, and switch this part off and on within one page to
  // measure what it costs (off restores each material's shader as it was, which rebuilds them: never done in play).
  if (hook) hook.__crownfallArenaSurface = {
    shared, air, sky, emitters, lamps: { hemisphere, lavaSide }, patched, lean: once,
    owned: () => [detail, lava, ...baked, ...air.owned],
    // The programs built without the surface light are told apart by a define, which is part of a program's key (the
    // key patchShader gives is fixed once made). `tag` adds another, so that the programs are built afresh (to time
    // building them).
    setEnabled(on: boolean, parts: { surfaces?: boolean; lamps?: boolean; air?: boolean } = { surfaces: true, lamps: true, air: true }, tag = "") {
      if (parts.surfaces && !once) {
        enabled = on;
        const mark = tag.replace(/\W/g, "");
        for (const { material } of patched) {
          const defines = (material.defines ??= {}) as Record<string, string>;
          for (const name of Object.keys(defines)) if (name.startsWith("CF_SURFACE_")) delete defines[name];
          if (!on) defines.CF_SURFACE_OFF = "1";
          if (mark) defines[`CF_SURFACE_TAG_${mark}`] = "1";
          material.needsUpdate = true;
        }
      }
      if (parts.lamps) { hemisphere.visible = on; if (lavaSide) lavaSide.visible = on; }
      if (parts.air) {
        air.uniforms.uCfAirFade.value.y = on ? 1 : 0;
        air.ashUniforms.uAmount.value = on ? 1 : 0;
        air.ash.visible = on;
      }
    },
  };

  const buffer = new THREE.Vector2();
  return {
    patchBaked,
    grade: air.grade,
    update(time) {
      if (!placed) placeMeshes();
      writeLava();
      context.renderer.getDrawingBufferSize(buffer);
      shared.uCfPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(context.camera.fov / 2)) / Math.max(1, buffer.y);
      air.update(time);
    },
    setQuality,
    dispose() {
      hemisphere.removeFromParent(); hemisphere.dispose();
      if (lavaSide) { lavaSide.removeFromParent(); lavaSide.target.removeFromParent(); lavaSide.dispose(); }
      detail.dispose(); lava.dispose();
      for (const target of baked) target.dispose();
      baked.length = 0;
      air.dispose();
      patched.length = 0;
      if (hook) delete hook.__crownfallArenaSurface;
    },
  };
}
