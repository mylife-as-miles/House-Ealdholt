// Vegetation material: MeshStandardMaterial (keeps IBL, shadows, the height fog and the terrain's
// mountain shadows) patched with onBeforeCompile for
//   * custom instancing — two per-instance vec4s, 32 bytes per plant (see vegetation-lod.js):
//       aInstA = (x, y, z, scale)      aInstB = (yaw, seed, tier + rank, colour param)
//   * stochastic distance thinning: far away only instances with rank < keep(distance) stay, and
//     they grow wider to keep the canopy closed; everything shrinks away smoothly at its cull
//     distance (no popping at the edges of the forest's draw range)
//   * wind: whole-plant sway (height weighted, one world wind direction, rolling gusts that travel
//     across the land) + leaf/strand flutter
//   * backlit translucency: when the sun is behind a crown, light bleeds through the foliage. The
//     shadow map is sampled at a point pushed toward the sun by roughly the crown's depth, so a
//     crown glows only if its sunward side is lit (and not when a ridge or another tree hides it)
//   * baked AO + per-instance tint (3-colour ramp per species) for the foliage
//   * per-instance form: parts (branch sprays, pads, strands) drop out at random, below a lifted
//     crown base (self-pruned forest interiors) or above a wind-broken top; code 15 = dead snag
//   * camera squeeze: a crown that would engulf the camera folds toward its trunk
//   * canopy fill: a little green light scattered through the leaves, so forest interiors read
// One program serves every species (per-species values are uniforms), one more for shadow depth.

import * as THREE from 'crownfall-world-three';

const VERT_PARS = /* glsl */ `
attribute vec4 aVeg;
attribute vec2 aVeg2;     // x part anchor height (m), y part kind (integer) + part random (fraction)
attribute vec4 aInstA;
attribute vec4 aInstB;
uniform vec4 uVegShape;   // x width/height variation, y lean (shear), z sway (m at the top), w flutter (m)
uniform vec4 uVegShape2;  // x taper variation (columnar <-> conical), y 1 / reference height
uniform vec4 uVegNear;    // x crown radius around the crown centre (m, scale 1; 0 = off), y height (m), zw crown centre offset (model xz)
uniform vec4 uVegForm;    // x part gap rate, y broken-top rate, z crown-base lift per instance code (m), w reference height (m)
uniform vec4 uVegDist;    // tier 0: x thin start, y thin end, z min keep, w cull distance
uniform vec4 uVegDist2;   // tier 1 (same layout)
uniform vec4 uVegLight;   // x translucency, y translucency probe distance (m), z ao strength, w thinning growth (0..1)
uniform vec3 uVegTint0;
uniform vec3 uVegTint1;
uniform vec3 uVegTint2;
uniform vec4 uVegWind;    // xy wind direction (world xz), z sway frequency, w -
uniform vec3 uVegKeyDir;  // toward the shadow-casting key light (world)
uniform vec4 uVegTime;    // the atmosphere time uniform: x seconds, z wind 0..1
uniform vec3 uVegCam;     // the view camera (cameraPosition is the light's in the shadow pass)
#ifdef VEG_MTN
uniform sampler2D uTerrSun;
uniform vec4 uTerrWorld;
#endif
varying vec4 vVeg;        // x leaf, y ao, z key-light visibility (mountains), w seed
varying vec3 vVegTint;
varying vec3 vVegLocal;   // object-space position in metres (surface detail that doesn't swim)
varying float vVegDead;
#if defined( VEG_LIT ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
varying vec4 vVegShadowCoord;
#endif
`;

const VERT_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
{
  float cyN = cos( aInstB.x ), syN = sin( aInstB.x );
  objectNormal.xz = vec2( cyN * objectNormal.x - syN * objectNormal.z, syN * objectNormal.x + cyN * objectNormal.z );
}
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

const VERT_MAIN = /* glsl */ `
vec3 transformed;
{
  vec3 ip = aInstA.xyz;
  float seed = aInstB.y;
  float tier = floor( aInstB.z );
  float rank = aInstB.z - tier;
  vec4 dd = tier > 0.5 ? uVegDist2 : uVegDist;
  float dist = distance( uVegCam, ip );
  float keep = mix( 1.0, dd.z, smoothstep( dd.x, dd.y, dist ) );
  float vis = 1.0 - smoothstep( keep - 0.1, keep, rank );
  vis *= 1.0 - smoothstep( dd.w * 0.8, dd.w, dist );
  float grow = pow( inversesqrt( max( keep, 0.15 ) ), uVegLight.w );
  float s = aInstA.w * vis;
  vec3 sc = vec3( s * grow, s * mix( 1.0, grow, 0.3 ), s * grow );
  sc.xz *= 1.0 + uVegShape.x * ( fract( seed * 13.37 ) * 2.0 - 1.0 );
  sc.y *= 1.0 + uVegShape.x * 0.5 * ( fract( seed * 29.13 ) * 2.0 - 1.0 );
  // never leave the camera inside a crown: a plant whose crown holds the camera squeezes toward
  // its trunk (flying through a forest shows trunks slipping past, not a screen of needles)
  if ( uVegNear.x > 0.0 ) {
    vec3 dcv = uVegCam - ip;
    // measured from the crown centre (leaning trees carry their crown well off the trunk)
    float cyC = cos( aInstB.x ), syC = sin( aInstB.x );
    vec2 cc = vec2( cyC * uVegNear.z - syC * uVegNear.w, syC * uVegNear.z + cyC * uVegNear.w ) * s * grow;
    float cr = uVegNear.x * s * grow + 1.5;
    float inside = smoothstep( -3.0, 0.0, dcv.y ) * ( 1.0 - smoothstep( uVegNear.y * s, uVegNear.y * s + 4.0, dcv.y ) );
    sc.xz *= mix( 1.0, smoothstep( 0.6, 1.15, length( dcv.xz - cc ) / cr ), inside );
  }

  float t = uVegTime.x;
  float wind = 0.3 + uVegTime.z;
  float ph = seed * 6.2831;
  vec2 wd = uVegWind.xy;
  // gust fronts rolling across the land along the wind
  float gust = 0.55 + 0.45 * sin( dot( ip.xz, wd ) * 0.011 - t * 0.55 ) * ( 0.75 + 0.25 * sin( dot( ip.xz, vec2( -wd.y, wd.x ) ) * 0.004 + t * 0.19 ) );
  float sway = ( sin( t * uVegWind.z + ph ) * 0.55 + sin( t * uVegWind.z * 2.31 + ph * 1.7 ) * 0.2 + 0.4 ) * wind * gust;

  vec3 p = position;
  // per-instance form: random missing parts, self-pruned lower crown, wind-broken top. Removed
  // parts collapse to one point at the plant's foot (zero-area triangles: no fill cost)
  float cutF = 0.0;
  {
    float kind = floor( aVeg2.y );
    float pr = aVeg2.y - kind;
    float code = floor( aInstB.w );
    // form code 15+: a dead snag — every branch gone, silver bark, often snapped
    vVegDead = step( 14.5, code ) * step( 0.001, uVegForm.z );
    float liftY = vVegDead > 0.5 ? 1e6 : code * uVegForm.z;
    float topY = fract( seed * 71.37 ) < uVegForm.y ? uVegForm.w * ( 0.58 + 0.24 * fract( seed * 3.93 ) ) : 1e6;
    float gap = uVegForm.x * ( 0.25 + 1.5 * fract( seed * 7.77 ) );
    if ( kind > 0.5 && kind < 2.5 ) {
      if ( aVeg2.x < liftY || aVeg2.x > topY || ( kind < 1.5 && fract( pr + seed * 17.31 ) < gap ) ) cutF = 1.0;
    } else if ( kind > 2.5 && kind < 3.5 ) {
      if ( p.y < liftY - 0.6 || p.y > topY + 0.4 ) p.xz = vec2( 0.0 );
    } else if ( kind > 3.5 ) {
      p.y = min( p.y, topY );
      cutF = vVegDead;
    } else {
      p.y = min( p.y, topY + 1.4 );
    }
  }
  // per-instance silhouette: some columnar, some broad-based
  float tv = uVegShape2.x * ( fract( seed * 5.31 ) * 2.0 - 1.0 );
  p.xz *= 1.0 + tv * ( 0.5 - clamp( position.y * uVegShape2.y, 0.0, 1.0 ) );
  float cy = cos( aInstB.x ), sy = sin( aInstB.x );
  p.xz = vec2( cy * p.x - sy * p.z, sy * p.x + cy * p.z );
  vec2 lean = uVegShape.y * vec2( fract( seed * 7.13 ) * 2.0 - 1.0, fract( seed * 3.71 ) * 2.0 - 1.0 );
  p.xz += lean * max( p.y, 0.0 );
  p.xz += wd * ( sway * aVeg.y * uVegShape.z );
  p.y -= abs( sway ) * aVeg.y * aVeg.y * uVegShape.z * 0.12;
  float fl = aVeg.z * uVegShape.w * wind * ( 0.55 + 0.45 * gust );
  p += fl * vec3(
    sin( t * 2.1 + ph + position.y * 0.8 + position.x * 0.6 ),
    0.45 * sin( t * 2.9 + ph * 2.0 + position.z * 0.9 ),
    cos( t * 1.8 + ph + position.z * 0.7 + position.y * 0.4 ) );
  transformed = cutF > 0.5 ? ip - vec3( 0.0, 0.5, 0.0 ) : p * sc + ip;

  vVeg = vec4( aVeg.x, aVeg.w, 1.0, seed );
  vVegLocal = position * aInstA.w + seed * 37.0;
  float cp = fract( aInstB.w );
  vVegTint = ( cp < 0.5 ? mix( uVegTint0, uVegTint1, cp * 2.0 ) : mix( uVegTint1, uVegTint2, cp * 2.0 - 1.0 ) ) * ( 0.9 + 0.2 * fract( seed * 31.7 ) );
  #ifdef VEG_MTN
  {
    vec2 wuv = ( ip.xz - uTerrWorld.xy ) * uTerrWorld.z + uTerrWorld.w;
    vVeg.z = texture2D( uTerrSun, wuv ).r;
  }
  #endif
  #if defined( VEG_LIT ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vVegShadowCoord = directionalShadowMatrix[ 0 ] * vec4( transformed + uVegKeyDir * ( uVegLight.y * s ), 1.0 );
  #endif
}
`;

const FRAG_PARS = /* glsl */ `
uniform vec4 uVegLight;
uniform vec3 uVegFill;    // key light scattered / transmitted through the canopy (keeps forest interiors readable)
uniform vec3 uVegSky;     // skylight fill: shaded foliage (under a ridge, in a wood) stays blue-green, never black
uniform vec4 uVegDetail;  // x foliage detail frequency (1/m), y amount, z bark frequency, w amount
varying vec4 vVeg;
varying vec3 vVegTint;
varying vec3 vVegLocal;
varying float vVegDead;
float vegHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float vegNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( vegHash( i ), vegHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( vegHash( i + vec3( 0, 1, 0 ) ), vegHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( vegHash( i + vec3( 0, 0, 1 ) ), vegHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( vegHash( i + vec3( 0, 1, 1 ) ), vegHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
varying vec4 vVegShadowCoord;
#endif
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
diffuseColor.rgb *= mix( vec3( 1.0 ), vVegTint, vVeg.x );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.27, 0.255, 0.235 ), vVegDead * ( 1.0 - vVeg.x ) );
diffuseColor.rgb *= mix( 1.0, vVeg.y, uVegLight.z );
{
  // close-up surface detail: needle / leaf clumps on foliage, vertical furrows on bark
  float fade = 1.0 - smoothstep( 18.0, 80.0, length( vViewPosition ) );
  if ( fade > 0.0 ) {
    float leaf = step( 0.5, vVeg.x );
    vec3 q = leaf > 0.5 ? vVegLocal * uVegDetail.x : vVegLocal * vec3( uVegDetail.z, uVegDetail.z * 0.12, uVegDetail.z );
    float n = vegNoise( q ) * 0.6 + vegNoise( q * 2.73 + 11.0 ) * 0.4;
    // foliage: a finer octave of dark gaps between needle clumps (breaks the flat sheets up close)
    float fine = leaf * ( 1.0 - smoothstep( 8.0, 30.0, length( vViewPosition ) ) );
    if ( fine > 0.0 ) n = mix( n, smoothstep( 0.2, 0.75, vegNoise( q * 4.3 - 5.0 ) ) * 0.8 + n * 0.3, 0.55 * fine );
    float amt = mix( uVegDetail.w, uVegDetail.y, leaf ) * fade * ( 1.0 + 0.4 * fine );
    diffuseColor.rgb *= 1.0 + amt * ( n * 2.0 - 1.0 );
  }
}
`;

// Foliage normals describe the crown volume: keep them on back faces (no double-sided flip).
const FRAG_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
normal = normalize( vNormal );
nonPerturbedNormal = normal;
`;

const FRAG_TRANS = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  vec3 Lv = directionalLights[ 0 ].direction;
  float back = max( dot( -geometryViewDir, Lv ), 0.0 );
  float b2 = back * back;
  float tr = b2 * b2 * b2 * 1.5 + b2 * 0.3 + 0.1;
  float shT = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  shT = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vVegShadowCoord );
  #endif
  // even deep in the canopy some light filters through the leaves above
  shT = 0.14 + 0.86 * shT;
  reflectedLight.directDiffuse += directionalLights[ 0 ].color * diffuseColor.rgb * ( vVeg.x * uVegLight.x * tr * shT * vVeg.z );
}
#endif
reflectedLight.indirectDiffuse += diffuseColor.rgb * ( uVegFill * ( 0.35 + 0.65 * vVeg.z ) + uVegSky );
`;

const FILL = 0.07;
const SKY_FILL = 0.35;

/**
 * Shared state for all vegetation materials (wind direction, key light, terrain maps).
 * Call createVegShared once, then vegMaterial(shared, species options) per species.
 */
export function createVegShared(ctx) {
  const T = ctx.terrain;
  const mtn = !!(T && T.uniforms && T.uniforms.uTerrSun && T.uniforms.uTerrWorld);
  const windAngle = 0.35; // wind from the west-south-west, blowing toward east-north-east
  return {
    ctx,
    mtn,
    uniforms: {
      uVegWind: { value: new THREE.Vector4(Math.cos(windAngle), -Math.sin(windAngle), 0.55, 0) },
      uVegKeyDir: { value: new THREE.Vector3(0, 1, 0) },
      uVegTime: ctx.atmosphereUniforms.uAtmoTime,
      uVegCam: { value: new THREE.Vector3() },
      uVegFill: { value: new THREE.Vector3() },
      uVegSky: { value: new THREE.Vector3() },
      ...(mtn ? { uTerrSun: T.uniforms.uTerrSun, uTerrWorld: T.uniforms.uTerrWorld } : {}),
    },
    update() {
      const k = ctx.env.keyDir || ctx.env.sunDir;
      this.uniforms.uVegKeyDir.value.copy(k);
      this.uniforms.uVegCam.value.copy(ctx.camera.position);
      // canopy fill: a green-shifted fraction of the key light's luminance (sun, or moon at night)
      const sun = ctx.env.sun;
      const c = sun.color, I = sun.intensity;
      const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) * I * FILL;
      this.uniforms.uVegFill.value.set(lum * 0.78, lum, lum * 0.62);
      const hemi = ctx.env.hemi;
      const hi = (ctx.env.palette && ctx.env.palette.hemiIntensity) || 1;
      // (weaker at night: moonlit canopies turned frosty grey with the full amount)
      if (hemi) this.uniforms.uVegSky.value.set(hemi.color.r, hemi.color.g, hemi.color.b).multiplyScalar(hi * SKY_FILL * (1 - 0.7 * (ctx.env.night || 0)));
    },
  };
}

// tints: '#hex' (sRGB, converted to linear) or [r, g, b] linear multipliers (may exceed 1)
const col = (c) => {
  if (Array.isArray(c)) return new THREE.Vector3(c[0], c[1], c[2]);
  const k = new THREE.Color(c);
  return new THREE.Vector3(k.r, k.g, k.b);
};

/**
 * Material pair for one species.
 *   tints: [c0, c1, c2] colour ramp multiplied into the foliage (instance colour param picks along it)
 *   shape: [widthVar, lean, sway, flutter]   light: [translucency, probe distance, ao strength, grow]
 *   form: [part gap rate, broken-top rate, crown lift per instance code (m), reference height (m)]
 *   near: [crown radius, height] (m, scale 1) for the camera squeeze; 0 = off
 *   detail: [foliage freq, amount, bark freq, amount]   close-up albedo noise
 *   dist / dist2: [thinStart, thinEnd, minKeep, cull]
 */
export function vegMaterial(shared, { name, tints = ['#ffffff', '#ffffff', '#ffffff'], shape = [0.1, 0.02, 0.3, 0.1], taper = [0, 10], form = [0, 0, 0, 10], near = [0, 0], light = [0.6, 4, 1, 1], detail = [3, 0.35, 2, 0.35], dist = [1e5, 2e5, 1, 1e5], dist2 = null, roughness = 0.88 }) {
  const u = {
    uVegShape: { value: new THREE.Vector4(...shape) },
    uVegShape2: { value: new THREE.Vector4(taper[0], 1 / taper[1], 0, 0) },
    uVegForm: { value: new THREE.Vector4(...form) },
    uVegNear: { value: new THREE.Vector4(near[0], near[1], near[2] || 0, near[3] || 0) },
    uVegDist: { value: new THREE.Vector4(...dist) },
    uVegDist2: { value: new THREE.Vector4(...(dist2 || dist)) },
    uVegLight: { value: new THREE.Vector4(light[0], light[1], light[2], light[3] ?? 1) },
    uVegDetail: { value: new THREE.Vector4(...detail) },
    uVegTint0: { value: col(tints[0]) },
    uVegTint1: { value: col(tints[1]) },
    uVegTint2: { value: col(tints[2]) },
    ...shared.uniforms,
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  material.name = `veg:${name}`;
  material.defines = { ...(material.defines || {}), VEG_LIT: '' };
  if (shared.mtn) material.defines.VEG_MTN = '';
  material.customProgramCacheKey = () => `veg-lit-5-${shared.mtn ? 1 : 0}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
      .replace('#include <lights_fragment_end>', FRAG_TRANS);
  };
  // basin-wide mountain shadows on the direct light (terrain module), when available
  if (shared.ctx.terrain?.applyMountainShadows) {
    try {
      shared.ctx.terrain.applyMountainShadows(material);
    } catch (e) {
      console.warn('[veg] mountain shadows unavailable', e);
    }
  }

  const depth = new THREE.MeshDepthMaterial();
  depth.name = `veg-depth:${name}`;
  depth.customProgramCacheKey = () => 'veg-depth-5';
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', VERT_MAIN);
  };
  return { material, depth, uniforms: u };
}

/**
 * Look parameters per species (shared by the module and look-dev tools). Tints are linear
 * multipliers on the foliage (the instance colour parameter picks along tint0 -> tint1 -> tint2).
 */
export const LOOK = {
  spire: { form: [0.1, 0.05, 2.0, 34], tints: [[0.74, 0.96, 1.22], [1.2, 1.12, 0.9], [2.3, 1.2, 0.62]], shape: [0.26, 0.018, 0.45, 0.12], taper: [0.5, 34], light: [0.95, 5, 1, 1], detail: [3.2, 0.45, 2.2, 0.4] },
  parasol: { form: [0.22, 0, 0, 22], tints: [[0.92, 1.04, 0.95], [1.12, 1.05, 0.84], [2.3, 1.35, 0.55]], shape: [0.14, 0.03, 0.4, 0.1], taper: [0.25, 22], light: [0.85, 5, 1, 1], detail: [2.2, 0.4, 1.6, 0.4] },
  aspen: { form: [0.2, 0, 0, 19], tints: [[0.78, 0.88, 0.84], [1.0, 0.97, 0.68], [1.38, 0.95, 0.44]], shape: [0.16, 0.025, 0.4, 0.16], taper: [0.3, 19], light: [1.25, 3, 1, 1], detail: [2.8, 0.35, 3.0, 0.3] },
  ghost: { form: [0.22, 0, 0, 16], tints: [[0.9, 0.98, 1.06], [1.0, 1.0, 1.0], [1.28, 1.12, 0.75]], shape: [0.12, 0.0, 0.35, 0.35], taper: [0.3, 16], light: [1.15, 4, 0.9, 1], detail: [1.4, 0.25, 1.2, 0.35] },
  giant: { tints: [[1, 1, 1], [1.12, 1.02, 0.8], [1.9, 1.05, 0.55]], shape: [0.04, 0.0, 0.6, 0.15], light: [0.8, 16, 1, 0], detail: [1.4, 0.45, 0.9, 0.6] },
  log: { tints: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], shape: [0.12, 0, 0, 0], light: [0, 1, 1, 0], detail: [2, 0.3, 1.6, 0.45] },
  shrub: { form: [0.25, 0, 0, 2], tints: [[1, 1, 1], [1.3, 1.1, 0.72], [1.75, 0.85, 1.05]], shape: [0.25, 0.05, 0.1, 0.04], light: [0.7, 1.2, 1, 0.8], detail: [3.5, 0.4, 3, 0.3] },
  reed: { tints: [[1, 1, 1], [1.1, 1.05, 0.9], [1.3, 1.12, 0.78]], shape: [0.2, 0.08, 0.25, 0.08], light: [1.0, 0.8, 0.9, 0.5], detail: [6, 0.2, 6, 0.2] },
  grass: { form: [0.3, 0, 0, 1], tints: ['#4c7c2b', '#6e8238', '#b39a58'], shape: [0.25, 0.1, 0.12, 0.05], light: [0.9, 0.5, 1, 0.35], detail: [4, 0.25, 4, 0.2] },
  flower: { form: [0.35, 0, 0, 1], tints: ['#9c7cd8', '#f4f0e2', '#f6c443'], shape: [0.2, 0.08, 0.1, 0.04], light: [0.8, 0.3, 1, 0], detail: [8, 0.1, 8, 0.1] },
  fern: { form: [0.3, 0, 0, 1], tints: [[1, 1, 1], [1.15, 1.08, 0.8], [2.4, 1.5, 0.6]], shape: [0.2, 0.05, 0.08, 0.06], light: [0.9, 0.6, 1, 0.35], detail: [5, 0.3, 5, 0.2] },
};
