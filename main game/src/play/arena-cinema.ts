/** The play view as a picture: where the eye goes, and what is left in the dark.
 *
 * The arena's bake lights everything about evenly, so from the play camera the board, the dais round it and the ruins
 * beyond all sat at the same brightness and the same sharpness, and nothing led the eye to the figures. This part
 * composes the frame in the look's final pass (arena-kit.ts ArenaGradeHook), without touching the bake:
 *
 *   a pool of light   the board and its figures keep their light (a little lifted and warmed); the dais round them
 *                     falls into a cool half-shadow with distance from the board's centre, and whatever glows (lava,
 *                     flames, runes) keeps glowing in it. Half, not black: the play view must stay readable;
 *   depth of field    what lies beyond the board softens with distance (high tier only: it re-reads the scene);
 *   distance          the far ruins sink into a haze that glows with the lava's colour (Setting 1) or the night's
 *                     (Setting 2), so they read as shapes against light and the dais as a stage in front of them.
 *
 *   light shafts      a few broad beams of the key's light stand in the air over the dais, along the key's own
 *                     direction (so they lie with the figures' shadows), where the arena's dust catches them. They
 *                     are sparse on purpose: a view ray that crosses many thin beams adds up to plain haze.
 *   contact           where two surfaces meet (a figure's feet on a tile, the seams between tiles, the carving of the
 *                     frame) the light is held back a little, from the depth alone (high tier: it reads the depth
 *                     again for every tap). This is what seats each small thing on the thing it stands on.
 *
 * Everything is measured in the look's metres from the board's centre (the arena's root is scaled 1/2.3). */
import * as THREE from "three";
import type { ArenaContext, ArenaFeature, ArenaGradeHook, ArenaQuality } from "./arena-kit";

const CINEMA_PARS = /* glsl */ `
uniform vec4 uCfPool;       // x: radius kept fully lit (m), y: radius where the dark is complete (m), z: what is left there, w: strength
uniform vec3 uCfPoolTint;   // the colour of what is left of the light out there
uniform vec4 uCfPoolKeep;   // x, y: luminance over which a glow is spared; z: height (m) over which the dark thins; w: its span (m)
uniform vec4 uCfFocus;      // x: where the blur starts (m from the focus plane), y: where it is full (m), z: radius at full (share of the height), w: taps
uniform vec4 uCfFar;        // x: start (m from the board's centre), y: full (m), z: most it may cover, w: unused
uniform vec3 uCfFarCol;     // the colour the far ruins sink toward
uniform vec3 uCfBoard;      // the board's centre, in metres
uniform vec4 uCfKey;        // x: the board's own lift (multiple at the centre), y: radius of the lift (m), z: warmth, w: unused
uniform vec4 uCfTone;       // x: contrast about middle grey (1 = none)
uniform vec4 uCfContact;    // x: reach (board units), y: strength, z: taps, w: the depth's own slope allowed (bias)
// a pixel's place in view space, from its depth
vec3 cfView(vec2 at) {
  float d = texture2D(tDepth, at).r;
  vec4 ray = uProjInv * vec4(at * 2.0 - 1.0, 1.0, 1.0);
  vec3 v = ray.xyz / ray.w;
  return v * (viewZ(d) / max(-v.z, 1e-4));
}
uniform vec4 uCfRays;       // x: strength per metre, y: steps, z: beams per metre across the light, w: radius they stand within (m)
uniform vec4 uCfRayShape;   // x, y: the share of the dust that is beam (noise thresholds), z: drift (m/s), w: how much brighter toward the light
uniform vec3 uCfRayCol, uCfRayDir, uCfRayU, uCfRayV;
uniform float uCfRayTime;
float cfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cfHash(i), cfHash(i + vec2(1.0, 0.0)), f.x), mix(cfHash(i + vec2(0.0, 1.0)), cfHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 cfWorld(vec3 d, float zz) { return uCamPos + d * (zz / max(dot(d, normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz)), 0.05)); }
float cfBlur(float zz, float focus) { return smoothstep(uCfFocus.x, uCfFocus.y, zz - focus); }
`;

// Depth of field: before anything else is laid over the scene. Each tap counts by its own blur, so a sharp figure in
// front never smears into the soft ground behind it.
const CINEMA_SCENE = /* glsl */ `
if (uCfFocus.w > 0.5 && !sky) {
  float cfFocusZ = dot(uCfBoard - uCamPos, fwd);
  float cfCoc = cfBlur(z, cfFocusZ);
  if (cfCoc > 0.01) {
    vec3 cfSum = c; float cfW = 1.0;
    int cfTaps = int(uCfFocus.w);
    float cfR = uCfFocus.z * cfCoc;
    for (int i = 0; i < cfTaps; i++) {
      float cfA = float(i) * 2.39996323, cfD = sqrt((float(i) + 0.5) / float(cfTaps));
      vec2 cfUv = uv + vec2(cos(cfA) / uAspect, sin(cfA)) * (cfD * cfR);
      float cfSd = texture2D(tDepth, cfUv).r;
      float cfSz = cfSd >= 0.999999 ? 1.0e4 : viewZ(cfSd) * 2.3;
      float cfSw = max(cfBlur(cfSz, cfFocusZ), 0.02);
      cfSum += texture2D(tScene, cfUv).rgb * cfSw; cfW += cfSw;
    }
    c = cfSum / cfW;
  }
}
// Contact: how much of the half-sphere over this pixel is taken by what stands near it. Near the board only (the far
// ground is haze and blur), and thinning where the depth of field has already softened the picture.
if (uCfContact.z > 0.5 && !sky && z < 90.0) {
  vec3 cfP = cfView(uv);
  // the surface's facing, from the nearer neighbour on each axis (so an edge does not bend it)
  vec2 cfTx = vec2(dFdx(uv.x), 0.0), cfTy = vec2(0.0, dFdy(uv.y));
  vec3 cfL = cfP - cfView(uv - cfTx), cfR = cfView(uv + cfTx) - cfP, cfD = cfP - cfView(uv - cfTy), cfU = cfView(uv + cfTy) - cfP;
  vec3 cfN = normalize(cross(abs(cfL.z) < abs(cfR.z) ? cfL : cfR, abs(cfD.z) < abs(cfU.z) ? cfD : cfU));
  if (cfN.z < 0.0) cfN = -cfN;
  // the reach on screen, as a share of its height: board units over the distance, by the lens (tan of half its angle)
  float cfScale = uCfContact.x / (2.0 * uProjInv[1][1] * max(-cfP.z, 0.1));
  float cfSpin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  int cfN8 = int(uCfContact.z);
  float cfTaken = 0.0;
  for (int i = 0; i < cfN8; i++) {
    float cfA = cfSpin + float(i) * 2.39996323, cfRad = sqrt((float(i) + 0.5) / float(cfN8));
    vec2 cfAt = uv + vec2(cos(cfA) / uAspect, sin(cfA)) * (cfRad * cfScale);
    vec3 cfV = cfView(cfAt) - cfP;
    float cfLen = length(cfV);
    cfTaken += max(dot(cfN, cfV) / max(cfLen, 1e-4) - uCfContact.w, 0.0) * (1.0 - smoothstep(0.5 * uCfContact.x, 1.6 * uCfContact.x, cfLen));
  }
  float cfShade = clamp(1.0 - uCfContact.y * cfTaken / float(cfN8), 0.0, 1.0);
  // what glows is not held back
  float cfGlow = smoothstep(uCfPoolKeep.x, uCfPoolKeep.y, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  c *= mix(cfShade, 1.0, cfGlow);
}
// Light shafts: the view ray is walked through the ball of air round the board, and at each step the dust is lit
// where a beam passes. A beam is a column along the key's direction, so the field is read in the plane across it.
if (uCfRays.x > 0.0) {
  float cfEnd = sky ? 1.0e4 : z / max(dot(dir, fwd), 0.05);
  // where the ray enters and leaves the ball (centre: 5 m over the board)
  vec3 cfO = uCamPos - (uCfBoard + vec3(0.0, 5.0, 0.0));
  float cfB = dot(cfO, dir), cfC = dot(cfO, cfO) - uCfRays.w * uCfRays.w, cfDisc = cfB * cfB - cfC;
  if (cfDisc > 0.0) {
    float cfRoot = sqrt(cfDisc), cfT0 = max(-cfB - cfRoot, 0.0), cfT1 = min(-cfB + cfRoot, cfEnd);
    if (cfT1 > cfT0) {
      int cfSteps = int(uCfRays.y);
      float cfStep = (cfT1 - cfT0) / float(cfSteps);
      // each pixel starts its walk at its own place within a step, so the steps do not show as bands
      float cfJit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float cfLit = 0.0;
      for (int i = 0; i < cfSteps; i++) {
        vec3 p = uCamPos + dir * (cfT0 + (float(i) + cfJit) * cfStep) - uCfBoard;
        vec2 q = vec2(dot(p, uCfRayU), dot(p, uCfRayV)) * uCfRays.z + vec2(uCfRayTime * uCfRayShape.z * uCfRays.z, 0.0);
        float beam = smoothstep(uCfRayShape.x, uCfRayShape.y, 0.65 * cfNoise(q) + 0.35 * cfNoise(q * 2.7 + 11.3));
        // thinning toward the ball's edge, and under the dais floor
        cfLit += beam * (1.0 - smoothstep(0.55, 1.0, length(p - vec3(0.0, 5.0, 0.0)) / uCfRays.w)) * smoothstep(-3.0, 0.0, p.y);
      }
      float cfToward = max(dot(dir, uCfRayDir), 0.0);
      c += uCfRayCol * (cfLit * cfStep * uCfRays.x * (1.0 + uCfRayShape.w * cfToward * cfToward));
    }
  }
}`;

// The pool of light and the distance: after the grade, so the dark is not lifted again by its split tone.
const CINEMA_FINAL = /* glsl */ `
if (!sky) {
  vec3 cfP = cfWorld(dir, z) - uCfBoard;
  float cfR = length(cfP.xz);
  float cfLum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // far ruins toward the haze
  c = mix(c, uCfFarCol, smoothstep(uCfFar.x, uCfFar.y, cfR) * uCfFar.z * (1.0 - smoothstep(uCfPoolKeep.x, uCfPoolKeep.y, cfLum)));
  // the pool: full light inside, the rest of it out there; a glow is spared, and so is what stands tall near the board
  float cfOut = smoothstep(uCfPool.x, uCfPool.y, cfR) * uCfPool.w;
  cfOut *= 1.0 - smoothstep(uCfPoolKeep.x, uCfPoolKeep.y, cfLum);
  c *= mix(vec3(1.0), uCfPoolTint * uCfPool.z, cfOut);
  // the board's own lift: a warm key that is strongest at its centre
  float cfIn = 1.0 - smoothstep(0.0, uCfKey.y, cfR);
  c *= 1.0 + (uCfKey.x - 1.0) * cfIn * vec3(1.0 + uCfKey.z, 1.0, 1.0 - uCfKey.z);
}
// a little more contrast than the tone curve's own, about middle grey
c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(uCfTone.x));`;

export interface ArenaCinema extends ArenaFeature {
  uniforms: Record<string, THREE.IUniform>;
  /** The lamp that lights the board and its figures, once the look's lamps are known. */
  key(): THREE.DirectionalLight | null;
  kicker: THREE.DirectionalLight;
}

/**
 * The board's light. The Blender scene lit the board with wide area lamps and suns from every side: in the game those
 * cast no shadows, and with the sky's ambient on top a figure showed no lit side and no dark one. One lamp is the key
 * now: the eclipse's sun, raised and turned to the back-left of White's view, where a figure's shadow falls across
 * the tiles toward the player and its far edge catches the light. The others keep a share of their strength.
 */
const KEY_LAMP = "CFCL_Sun_EclipseRim", TOP_LAMP = "CF_Spot_BoardTop";
const KEY = { from: new THREE.Vector3(-0.62, 0.5, -0.6).normalize(), strength: 6.1, white: 0.3, reach: 7.5 };
const LAMP_SHARE: Record<string, number> = {
  CFCL_Sun_EclipseKey: 0, CFCL_Sun_CamFill: 0.3, CFCL_Sun_CoolFill: 0.8,
  CFCL_Area_PieceRim: 0.6, CF_Area_Rim_CFCL_Hero_Skull: 0.3, CF_Area_Rim_CFCL_Hero_Hand: 0.3,
};
/**
 * The kicker: a cool lamp low on the far right, opposite the key across the board. It lights nothing broad: it puts an
 * edge on the side of a figure the key leaves dark, so a cloak or a pauldron stands off the tiles behind it. It casts
 * no shadow, and the low tier goes without it.
 */
const KICKER = { from: new THREE.Vector3(0.78, 0.3, -0.55).normalize(), strength: 1.6 };
/** What is left of the sky's ambient on the lit props and figures. */
const AMBIENT_SHARE = 0.55;
/** The shafts' light per metre of beam the view ray passes through. */
const RAYS = 0.02;

/** The feature set by tier: the depth of field is the high tier's alone (it reads the scene again for every tap). */
export function createArenaCinema(context: ArenaContext): ArenaCinema {
  const violet = context.setting === 2;
  const rayAcross = new THREE.Vector3().crossVectors(KEY.from, new THREE.Vector3(0, 1, 0)).normalize();
  const uniforms = {
    // (Setting 2 is a night already: its surround keeps more of its light)
    uCfPool: { value: new THREE.Vector4(10.6, 24, violet ? 0.78 : 0.58, 1) },
    uCfPoolTint: { value: violet ? new THREE.Vector3(0.74, 0.7, 1.12) : new THREE.Vector3(0.5, 0.86, 1.2) },
    uCfPoolKeep: { value: new THREE.Vector4(0.55, 1.6, 0, 0) },
    uCfFocus: { value: new THREE.Vector4(10, 60, 0.012, 0) },
    // the ruins beyond the dais stand in a haze the lava (Setting 1) or the night (Setting 2) lights
    uCfFar: { value: new THREE.Vector4(22, 85, 0.85, 0) },
    uCfFarCol: { value: violet ? new THREE.Vector3(0.09, 0.06, 0.2) : new THREE.Vector3(0.42, 0.2, 0.07) },
    uCfBoard: { value: new THREE.Vector3(0, 0, 0) },
    uCfKey: { value: new THREE.Vector4(1.16, 17, violet ? 0 : 0.8, 0) },
    uCfTone: { value: new THREE.Vector4(1.1, 0, 0, 0) },
    // strength per metre, steps, beams per metre across the light, the radius of the ball of air they stand in
    uCfRays: { value: new THREE.Vector4(0, 0, 1 / 5.5, 30) },
    uCfRayShape: { value: new THREE.Vector4(0.58, 0.74, 0.25, 1.2) },
    uCfRayCol: { value: violet ? new THREE.Vector3(0.62, 0.5, 1) : new THREE.Vector3(1, 0.62, 0.28) },
    uCfRayDir: { value: KEY.from.clone() }, uCfRayU: { value: rayAcross }, // (the field is stretched 1 / 0.3 along V: the beams are tall curtains side by side, which a view ray crosses few of)
    uCfRayV: { value: new THREE.Vector3().crossVectors(rayAcross, KEY.from).normalize().multiplyScalar(0.3) },
    uCfRayTime: { value: 0 },
    uCfContact: { value: new THREE.Vector4(0.45, 2.4, 0, 0.08) },
  };
  const grade: ArenaGradeHook = { uniforms, pars: CINEMA_PARS, scene: CINEMA_SCENE, final: CINEMA_FINAL };
  const taps = 12, contactTaps = 10;
  let key: THREE.DirectionalLight | null = null;
  const kicker = new THREE.DirectionalLight(violet ? new THREE.Color(0.62, 0.55, 1) : new THREE.Color(0.5, 0.72, 1), KICKER.strength);
  kicker.name = "arena-cinema-kicker";
  kicker.position.copy(KICKER.from).multiplyScalar(200);
  context.world.add(kicker, kicker.target);
  context.scene.environmentIntensity *= AMBIENT_SHARE;
  function shadows(quality: ArenaQuality) {
    if (!key) return;
    const size = Math.max(256, quality.shadow);
    key.castShadow = quality.shadow > 0;
    if (key.shadow.mapSize.x !== size) { key.shadow.mapSize.set(size, size); key.shadow.map?.dispose(); key.shadow.map = null; }
    // a small map is spread wider, so its texels do not show as steps along a shadow's edge
    key.shadow.radius = size >= 2048 ? 2 : size >= 1024 ? 2.5 : 3;
  }
  function setQuality(quality: ArenaQuality) {
    uniforms.uCfFocus.value.w = quality.name === "high" ? taps : 0;
    kicker.visible = quality.shadow > 0;
    // the shafts walk the view ray: more steps on the high tier, none on the low one (and none on integrated graphics'
    // medium, which has no shadow map of 1024 either)
    uniforms.uCfRays.value.y = quality.name === "high" ? 16 : 8;
    uniforms.uCfRays.value.x = quality.shadow >= 1024 ? RAYS : 0;
    uniforms.uCfContact.value.z = quality.name === "high" ? contactTaps : 0;
    shadows(quality);
  }
  setQuality(context.quality());
  const hook = typeof window !== "undefined" && import.meta.env?.DEV ? (window as unknown as { __crownfallArenaCinema?: unknown }) : null;
  if (hook) hook.__crownfallArenaCinema = { uniforms, key: () => key, kicker };
  return {
    uniforms, grade, setQuality, key: () => key, kicker,
    update(time) { uniforms.uCfRayTime.value = time; },
    lamps(lamps) {
      for (const lamp of lamps) {
        const share = LAMP_SHARE[lamp.name];
        if (share !== undefined) lamp.intensity *= share;
        if (lamp.name === TOP_LAMP) { lamp.intensity = 0; lamp.castShadow = false; }
        if (lamp.name !== KEY_LAMP || !(lamp instanceof THREE.DirectionalLight)) continue;
        key = lamp;
        // the arena's root is scaled 1/2.3: 200 of its metres are 87 of the board's units away
        key.position.copy(KEY.from).multiplyScalar(200);
        key.color.lerp(new THREE.Color(1, 1, 1), KEY.white);
        key.intensity *= KEY.strength;
        const camera = key.shadow.camera;
        camera.left = camera.bottom = -KEY.reach; camera.right = camera.top = KEY.reach;
        camera.near = 40; camera.far = 140;
        camera.updateProjectionMatrix();
        key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
      }
      shadows(context.quality());
    },
    dispose() {
      kicker.removeFromParent(); kicker.target.removeFromParent(); kicker.dispose();
      if (hook) delete hook.__crownfallArenaCinema;
    },
  };
}
