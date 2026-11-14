// The water surface material: a MeshPhysicalMaterial (ior 1.333 -> F0 = 0.02) patched with
// onBeforeCompile, so the sun/moon light, shadows (incl. the terrain's mountain shadows) and fog
// come from the engine, and the water-specific parts are ours:
//
//   * wave normals: four scrolling layers of a tileable wave-slope map at 97 / 29 / 8.3 / 2.3 m,
//     their amplitude driven by a drifting wind field (patches + long wind lanes). Most of the
//     Mirror is glass-calm; catspaws of ripples wander across it. In the canyon the ripples are
//     advected along the river flow (two-phase flow mapping) with foam streaks gathered in lanes.
//   * glitter: the key light (sun by day, moon at night) sees its own normal, tilted further by
//     fine 0.9 / 2.9 m facets that break the sun path into glints near the camera, and its own,
//     rougher lobe that widens the path toward the horizon; the mirror keeps the calm normal.
//   * body colour: depth from the baked ground height, view-dependent optical path, Beer-Lambert
//     opacity; green-teal in the shallows, blue-black in the depths, lit by our own sky ambient.
//     The output is premultiplied: rgb = reflection + (1 - F) * body, alpha = 1 - (1 - F) *
//     transmittance, so reflections stay at full strength over the shallows while the bed shows.
//   * reflections: an analytic sky (the sky module's gradient, glow and haze band, from its live
//     uniforms), replaced by the environment map where that really holds the sky, by the sky-only
//     planar pass on medium (clouds, stars) and the full planar pass on high (landmarks); shores,
//     canyon walls and the mountain ring come from a ray-march through a world height texture,
//     lit and fogged analytically.
//   * shore: soft fade into the wet sand, a thin contact line and faint foam bands drifting in;
//     foam rings around anything standing in the water (water-contact.js) and under the falls.
//
// Variant W_LOCAL (streams, plunge pools, ponds above y = 0): depth / rapids / flow come from a
// vertex attribute `aWater` = (depth m, rapids 0..1, flow x, flow z) instead of the baked map.
// Dev: ?wdbg=1..7 shows intermediate terms (see COMPOSITE).

import * as THREE from 'crownfall-world-three';

const PARS = /* glsl */ `
uniform float uWTime;
uniform sampler2D uWWaves;
uniform sampler2D uWNoise;
uniform vec4 uWWind;        // xy wind dir, z wind speed (m/s), w windiness scale
uniform vec4 uWDirA;        // wave layer directions (xy, zw)
uniform vec4 uWDirB;
uniform vec4 uWParams;      // x turbidity (1/m), y foam, z specular clamp, w ripple slope scale
uniform vec3 uWShallow;
uniform vec3 uWDeep;
uniform vec3 uWSkyZen;
uniform vec3 uWSkyHor;
uniform vec3 uWSkySun;      // the sky's sun colour (glow around the sun)
uniform vec4 uWSkyP;        // the sky's uSun: z glow strength, w twilight
uniform vec3 uWSkyBelt;     // belt of Venus colour
uniform vec4 uWSkyNight;    // the sky's uNight (x night)
uniform vec4 uWSkyMoon;     // the sky's uMoon (y moon brightness)
uniform vec3 uWSkyMoonDir;
uniform vec3 uWKeyCol;      // key light colour * intensity (sun by day, moon by night)
uniform vec3 uWKeyDir;
uniform vec3 uWAmb;         // ambient irradiance for ray-marched reflections
uniform vec3 uWAmbGround;
uniform sampler2D uWHeight; // world height (reflection ray-march)
uniform vec4 uWHeightXf;
uniform vec4 uWMarch;       // x first step, y growth, z max distance, w snow line
uniform float uWReflBoost;  // env map -> true sky radiance (IBL is dimmed for diffuse fill)
#ifndef W_LOCAL
uniform sampler2D uWData;
uniform vec4 uWDataXf;
#endif
#ifdef W_TERRMAPS
uniform sampler2D uWTerrB;
uniform sampler2D uWTerrSun;
uniform vec4 uWTerrXf;
#endif
#ifdef W_PLANAR
uniform sampler2D uWPlanar;
uniform mat4 uWPlanarMat;
uniform vec4 uWPlanarP;     // x on (0/1), y distortion, z max lod
#endif
#ifdef W_CONTACT
uniform sampler2D uWContact;
uniform vec4 uWContactXf;
#endif
uniform vec4 uWFoamPts[4];   // plunge points of the falls: x, z, radius, strength
varying vec3 vWPos;
#ifdef W_LOCAL
varying vec4 vWater;
#endif

float wBody;
vec3 wRefl;
vec3 wDbgRefl;
float wDbgHit;
float wEdge;
float wFoam;
float wRough;
float wDist;
vec3 wN;
vec3 wV;

vec2 wLayer(vec2 p, vec2 d, float scale, float speed, float t) {
  vec2 dp = vec2(-d.y, d.x);
  vec2 q = vec2(dot(p, d), dot(p, dp));
  vec2 s = (texture2D(uWWaves, (q - vec2(speed * t, 0.0)) / scale).rg * 2.0 - 1.0) * 0.5;
  return s.x * d + s.y * dp;
}

vec2 wSlopes(vec2 p, float t, float amp, float fine, float far) {
  // the long swells fade with distance (a distant lake reads as a mirror, its glitter comes from
  // the roughness instead), the short chop only exists where the wind touches the water
  vec2 s = wLayer(p, uWDirA.xy, 97.0, 1.9, t) * (0.1 + 0.32 * amp) * far;
  s += wLayer(p + vec2(31.7, -3.1), uWDirA.zw, 29.0, 1.25, t) * (0.5 * amp) * mix(1.0, far, 0.6);
  s += wLayer(p + vec2(-13.1, 7.7), uWDirB.xy, 8.3, 0.8, t) * (0.62 * amp);
  s += wLayer(p + vec2(5.3, 11.9), uWDirB.zw, 2.3, 0.45, t) * (0.58 * amp * fine);
  return s * uWParams.w;
}

float wTerrainHeight(vec2 xz) {
  vec2 uv = (xz - uWHeightXf.xy) * uWHeightXf.zw;
  return textureLod(uWHeight, uv, 0.0).r;
}

// Colour of the terrain at a ray-march hit (lit + fogged along the reflected segment).
vec3 wTerrainColor(vec3 hp, vec3 from) {
  float e = 9.0;
  float hx = wTerrainHeight(hp.xz + vec2(e, 0.0)) - wTerrainHeight(hp.xz - vec2(e, 0.0));
  float hz = wTerrainHeight(hp.xz + vec2(0.0, e)) - wTerrainHeight(hp.xz - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
  float slope = 1.0 - n.y;
  vec3 alb = vec3(0.075, 0.09, 0.05);
  float vis = 1.0;
#ifdef W_TERRMAPS
  vec2 tuv = (hp.xz - uWTerrXf.xy) * uWTerrXf.z + uWTerrXf.w;
  vec4 tb = textureLod(uWTerrB, tuv, 0.0);
  alb = mix(vec3(0.15, 0.15, 0.075), vec3(0.045, 0.07, 0.035), tb.r); // meadow -> forest
  alb = mix(alb, vec3(0.33, 0.29, 0.23), tb.b * 0.8);                     // talus
  alb = mix(alb, vec3(0.46, 0.2, 0.08), tb.a * 0.8);                      // sandstone
  vis = textureLod(uWTerrSun, tuv, 0.0).r;
#endif
  // bare limestone on steep ground (the terrain's C_LIME palette), sand at the waterline
  alb = mix(alb, vec3(0.4, 0.35, 0.27), smoothstep(0.35, 0.65, slope) * (1.0 - 0.6 * smoothstep(0.3, 0.7, alb.r - alb.b)));
  alb = mix(alb, vec3(0.5, 0.4, 0.24), 1.0 - smoothstep(1.0, 4.0, hp.y)); // beach
  float snow = smoothstep(uWMarch.w - 120.0, uWMarch.w + 180.0, hp.y) * (1.0 - smoothstep(0.55, 0.8, slope));
  alb = mix(alb, vec3(0.82, 0.84, 0.88), snow);
  float ndl = max(dot(n, uWKeyDir), 0.0);
  vec3 irr = uWKeyCol * ndl * vis + mix(uWAmbGround, uWAmb, n.y * 0.5 + 0.5) * 1.35;
  vec3 c = alb * irr * 0.3183;
#ifdef USE_FOG
  vec4 f = atmoFogTerm(from, hp);
  c = mix(c, f.rgb, f.a);
#endif
  return c;
}

float wHg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// The sky without clouds, as the sky module draws it (gradient, sun-side glow, belt of Venus, moon
// glow, and the haze band from the shared atmosphere), seen from the water. Used where the
// environment map is missing or unusable, and as the sharp base under the blurred env map.
vec3 wSky(vec3 rd, vec3 ro) {
  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
  float y = max(rd.y, 0.0);
  float mu = dot(rd, uAtmoSunDir);
  float air = exp(-y * 2.6);
  float lumH = dot(uWSkyHor, LUM);
  float lumZ = dot(uWSkyZen, LUM);
  vec3 pale = mix(uWSkyZen / max(lumZ, 1e-4), vec3(1.0), 0.74) * mix(lumZ, lumH, 0.7);
  vec3 col = mix(uWSkyZen, pale, smoothstep(0.08, 0.95, air));
  col = mix(col, uWSkyHor, pow(air, 6.0));
  float side = 0.5 + 0.5 * mu;
  col *= mix(0.8, 1.16, side * side);
  float sunUp = smoothstep(-0.2, 0.02, uAtmoSunDir.y);
  vec3 glowCol = mix(uWSkySun, vec3(dot(uWSkySun, LUM)) * vec3(1.2, 1.0, 0.72), 0.3);
  float g = uWSkyP.z * sunUp * (wHg(mu, 0.82) * 0.8 + wHg(mu, 0.45) * 0.55) * (0.45 + 0.55 * air);
  col = col * (1.0 - clamp(g * 0.55, 0.0, 0.85)) + glowCol * g;
  float mmu = dot(rd, uWSkyMoonDir);
  col += vec3(0.32, 0.42, 0.75) * uWSkyNight.x * uWSkyMoon.y * (0.0025 + 0.02 * wHg(mmu, 0.55)) * smoothstep(-0.05, 0.1, uWSkyMoonDir.y);
  float anti = max(-mu, 0.0);
  float belt = exp(-pow((y - 0.09) / 0.07, 2.0)) * (0.3 + 0.7 * anti);
  col += uWSkyBelt * belt * uWSkyP.w;
  col *= 1.0 - 0.3 * uWSkyP.w * exp(-pow(y / 0.045, 2.0)) * anti;
#ifdef USE_FOG
  vec3 hazeCol = atmoInscatter(rd);
  vec3 rdH = normalize(vec3(rd.x, rd.y * 1.8, rd.z));
  float opt = atmoOptical(ro, rdH, 60000.0) - atmoOptical(ro, vec3(0.0, 1.0, 0.0), 60000.0);
  col = mix(col, hazeCol, 1.0 - exp(-max(opt, 0.0)));
#endif
  return col;
}

// Reflected radiance: sky (env map / analytic sky), ray-marched terrain, planar texture.
vec3 wReflection(vec3 envRad, float envOk, vec3 wp, vec3 R, float rough) {
  vec3 col = wSky(R, wp);
#ifdef USE_ENVMAP
  // the env map carries the clouds, but it is a blurred probe; lean on it more as the water roughens
  col = mix(col, envRad * uWReflBoost, envOk * mix(0.75, 1.0, smoothstep(0.05, 0.25, rough)));
#endif
#if defined(W_PLANAR) && defined(W_PLANAR_SKY)
  // the real sky (clouds, stars, aurora) from the sky-only mirror pass; the sun disk is left to
  // the key light's glitter, so the sample is capped relative to the cloudless sky
  if (uWPlanarP.x > 0.5) {
    vec4 pc = uWPlanarMat * vec4(wp, 1.0);
    vec2 puv = pc.xy / pc.w + (wN.xz * uWPlanarP.y) / (1.0 + wDist * 0.0015);
    float lod = clamp(rough * 14.0 - 0.3, 0.0, uWPlanarP.z);
    vec3 ps = textureLod(uWPlanar, puv, lod).rgb;
    // one NaN/Inf texel in the mirror spreads through its mips into a block: drop such samples
    if (!(ps.r + ps.g + ps.b < 6.0e4)) ps = col;
    ps = min(ps, col * 4.0 + 0.01);
    vec2 eg = smoothstep(vec2(0.0), vec2(0.03), puv) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - puv);
    col = mix(col, ps, eg.x * eg.y);
  }
#endif
#ifdef W_MARCH
  // exponential march through the world height field; a few bisection steps on a hit
  float t0 = 0.0;
  float t = uWMarch.x;
  float hit = -1.0;
  vec3 o = wp + vec3(0.0, 0.3, 0.0);
  for (int i = 0; i < W_MARCH; i++) {
    vec3 q = o + R * t;
    if (q.y > 2600.0) break;
    if (q.y < wTerrainHeight(q.xz)) { hit = t; break; }
    t0 = t;
    t = t * uWMarch.y;
    if (t > uWMarch.z) break;
  }
  if (hit > 0.0) {
    // how far under the ground the step landed, relative to the step: grazing rays that only
    // clip a ridge get a partial (anti-aliased, roughness-blurred) contribution
    vec3 qh = o + R * hit;
    float pen = (wTerrainHeight(qh.xz) - qh.y) / max(hit - t0, 1.0);
    float a = t0;
    float b = hit;
    for (int k = 0; k < 5; k++) {
      float m = 0.5 * (a + b);
      vec3 q = o + R * m;
      if (q.y < wTerrainHeight(q.xz)) b = m; else a = m;
    }
    vec3 hp = o + R * b;
    vec3 tc = wTerrainColor(hp, o);
    col = mix(col, tc, smoothstep(0.0, 0.015 + rough * 0.35, pen));
    wDbgHit = 1.0;
  }
#endif
#if defined(W_PLANAR) && !defined(W_PLANAR_SKY)
  if (uWPlanarP.x > 0.5) {
    vec4 pc = uWPlanarMat * vec4(wp, 1.0);
    vec2 puv = pc.xy / pc.w + (wN.xz * uWPlanarP.y) / (1.0 + wDist * 0.0015);
    float lod = clamp(rough * 18.0 - 0.6, 0.0, uWPlanarP.z);
    vec3 pr = textureLod(uWPlanar, puv, lod).rgb;
    // NaN * 0 is still NaN, so a bad mirror sample must be replaced, not just weighted away
    if (!(pr.r + pr.g + pr.b < 6.0e4)) pr = col;
    pr = min(pr, vec3(2.0e3));
    vec2 eg = smoothstep(vec2(0.0), vec2(0.04), puv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - puv);
    float pw = eg.x * eg.y * (1.0 - smoothstep(0.16, 0.4, rough));
    col = mix(col, pr, pw);
  }
#endif
  return col;
}
`;

const SURFACE = /* glsl */ `
{
  wDbgHit = 0.0;
  wDbgRefl = vec3(0.0);
  wRefl = vec3(0.0);
  vec3 wp = vWPos;
  vec3 wToCam = cameraPosition - wp;
  wDist = length(wToCam);
  wV = wToCam / max(wDist, 1e-3);
  float t = uWTime;
  float depth;
  float sdf;
  vec2 flow;
  float rapids = 0.0;
#ifdef W_LOCAL
  depth = vWater.x;
  rapids = vWater.y;
  flow = vWater.zw;
  sdf = max(depth, 0.0) * 9.0;
#else
  vec4 bd = texture2D(uWData, (wp.xz - uWDataXf.xy) * uWDataXf.zw);
  depth = -bd.r;
  sdf = bd.g;
  flow = bd.ba;
#endif
  float flowLen = length(flow);
  float river = smoothstep(0.04, 0.7, flowLen);

  // ---- wind field: slow drifting patches of ripples + long lanes along the wind
  vec2 wd = uWWind.xy;
  vec2 wq = vec2(dot(wp.xz, wd), dot(wp.xz, vec2(-wd.y, wd.x)));
  float n1 = texture2D(uWNoise, wp.xz / 1900.0 - wd * t * 0.0011).r;
  float n2 = texture2D(uWNoise, wp.xz / 640.0 - wd * t * 0.0029).g;
  float lanes = texture2D(uWNoise, vec2((wq.x - t * 2.2) / 1500.0, wq.y / 110.0)).a;
  float windy = smoothstep(0.5, 0.84, n1 * 0.62 + n2 * 0.38);
  windy = clamp(windy + (lanes - 0.55) * 1.1 * (0.2 + windy), 0.0, 1.0) * uWWind.w;
  float amp = mix(0.04, 1.0, windy);
  amp = max(amp, river * 0.45 + rapids * 0.7);
  amp *= mix(0.45, 1.0, smoothstep(1.0, 30.0, sdf)); // sheltered right at the shore

  // ---- wave slopes (advected along the flow in rivers and streams)
  float fine = 1.0 - smoothstep(80.0, 520.0, wDist);
  float far = 1.0 - 0.7 * smoothstep(400.0, 2600.0, wDist);
  vec2 slope;
  float rfoam = 0.0;
  if (flowLen > 0.03) {
    const float T = 2.4;
    float ph0 = fract(t / T);
    float ph1 = fract(t / T + 0.5);
    float bw = abs(2.0 * ph0 - 1.0);
    vec2 p0 = wp.xz - flow * (ph0 * T);
    vec2 p1 = wp.xz - flow * (ph1 * T) + vec2(17.3, 5.1);
    vec2 s0 = wSlopes(p0, t, amp, fine, far);
    vec2 s1 = wSlopes(p1, t, amp, fine, far);
    slope = mix(s0, s1, bw) / sqrt(bw * bw + (1.0 - bw) * (1.0 - bw));
    // foam streaks stretched along the current, gathered into a few drifting lines where the
    // currents converge (a static lane pattern across the flow)
    vec2 fd = flow / flowLen;
    vec2 fp = vec2(-fd.y, fd.x);
    vec2 q0 = vec2(dot(p0, fd) / 170.0, dot(p0, fp) / 10.0);
    vec2 q1 = vec2(dot(p1, fd) / 170.0, dot(p1, fp) / 10.0);
    float f0 = texture2D(uWNoise, q0).a;
    float f1 = texture2D(uWNoise, q1).a;
    float lane = smoothstep(0.5, 0.78, texture2D(uWNoise, vec2(dot(wp.xz, fp) / 90.0, dot(wp.xz, fd) / 1400.0)).g);
    rfoam = smoothstep(0.62, 0.9, mix(f0, f1, bw)) * lane * river * (0.25 + 0.5 * smoothstep(0.6, 1.4, flowLen));
    rfoam = max(rfoam, rapids * smoothstep(0.35, 0.75, mix(f0, f1, bw) + 0.25 * rapids));
  } else {
    slope = wSlopes(wp.xz, t, amp, fine, far);
  }
  wN = normalize(vec3(-slope.x, 1.0, -slope.y));
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
#ifdef DOUBLE_SIDED
  normal *= faceDirection;
#endif

  // ---- roughness: sub-pixel ripples we can no longer resolve widen the glitter with distance
  float distR = smoothstep(30.0, 2800.0, wDist);
  wRough = mix(0.06, 0.2, distR) * mix(0.5, 1.0, windy) + 0.12 * river * distR + 0.05 * rapids;

  // ---- sun / moon glitter. The direct light sees a rougher sea than the mirror does: a field of
  // fine facets (0.9 m and 2.9 m ripples, strongest in the wind) tilts the normal used for the key
  // light only, so near the camera the path breaks into individual glints; where those facets
  // shrink below a pixel the mipmaps flatten them and the roughness takes over, widening the path
  // toward the horizon. The reflection keeps using the calmer wN.
  {
    vec2 gs = wLayer(wp.xz + vec2(2.9, -7.3), uWDirB.xy, 0.93, 0.31, t) + wLayer(wp.xz + vec2(-5.1, 3.3), uWDirA.zw, 2.9, 0.6, t) * 0.8;
    // facets smaller than a few pixels only alias: fade them by the pixel footprint (metres) and
    // hand their energy to the roughness instead
    float fp = length(fwidth(wp.xz));
    float gRes = 1.0 - smoothstep(0.06, 0.3, fp);
    float gAmp = (0.35 + 0.65 * windy) * (1.0 - smoothstep(60.0, 700.0, wDist)) * (1.0 - river * 0.5) * gRes;
    gAmp *= mix(0.35, 1.0, smoothstep(2.0, 40.0, sdf)); // sheltered, glassy water along the shore
    vec3 gN = normalize(vec3(-(slope.x + gs.x * gAmp), 1.0, -(slope.y + gs.y * gAmp)));
    normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);
#ifdef DOUBLE_SIDED
    normal *= faceDirection;
#endif
    roughnessFactor = mix(0.1, 0.24, windy) + 0.2 * distR + 0.06 * river + 0.1 * rapids + 0.1 * (1.0 - gRes) * (1.0 - distR);
  }

  // ---- water body: Beer-Lambert over the refracted view path down to the bed and back
  float dpos = max(depth, 0.0);
  float cosT = sqrt(max(1.0 - (1.0 - wV.y * wV.y) / 1.777, 0.04));
  float path = dpos * (1.0 / cosT + 1.0);
  float turb = uWParams.x * (1.0 + 1.6 * river + 2.0 * rapids);
  wBody = 1.0 - exp(-path * turb);
  vec3 bodyCol = mix(uWShallow, uWDeep, smoothstep(0.6, 18.0, dpos));
  bodyCol = mix(bodyCol, uWShallow * vec3(1.05, 0.95, 0.72), river * 0.35); // silty river

  // ---- foam: contact line, bands drifting in toward the shore, river streaks
  float fc = texture2D(uWNoise, wp.xz / 19.0 + slope * 0.8 + vec2(t * 0.012, -t * 0.004)).b;
  float fn = texture2D(uWNoise, wp.xz / 83.0 - vec2(0.0, t * 0.003)).a;
  float band = fract(sdf / 8.5 + t * 0.055 + fn * 0.9);
  float bands = smoothstep(0.78, 0.96, band) * (1.0 - smoothstep(1.5, 26.0, sdf)) * (0.4 + 0.6 * windy) * (1.0 - 0.8 * river);
  float contact = 1.0 - smoothstep(0.2, 1.4 + fn * 2.6, sdf);
  float cells = smoothstep(0.2, 0.7, fc + fn * 0.35);
  wFoam = max(contact * 0.85, bands * 0.5) * cells;
  wFoam = max(wFoam, rfoam * smoothstep(0.1, 0.6, fc + 0.3));
#ifdef W_CONTACT
  {
    vec2 cuv = (wp.xz - uWContactXf.xy) * uWContactXf.zw;
    if (cuv.x > 0.0 && cuv.y > 0.0 && cuv.x < 1.0 && cuv.y < 1.0) {
      float cd = texture2D(uWContact, cuv).r * 25.5;   // metres to the nearest thing standing in the water
      // a lacy collar hugging the stone, faint ripple rings drifting off it (kept thin: from
      // afar a wide ring reads as a halo)
      float ring = 1.0 - smoothstep(0.2, 1.3 + fn * 1.8, cd);
      float cband = smoothstep(0.85, 0.97, fract(cd / 5.0 + t * 0.07 + fn * 0.6)) * (1.0 - smoothstep(1.0, 9.0, cd));
      wFoam = max(wFoam, max(ring * 0.75, cband * 0.22) * cells * (1.0 - 0.6 * smoothstep(150.0, 900.0, wDist)));
    }
  }
#endif
  // churned water where the falls come down
  for (int i = 0; i < 4; i++) {
    vec4 fp = uWFoamPts[i];
    if (fp.z <= 0.0) continue;
    float dd = length(wp.xz - fp.xy);
    if (dd > fp.z * 2.0) continue;
    float core = 1.0 - smoothstep(fp.z * 0.2, fp.z, dd + (fn - 0.5) * fp.z * 0.5);
    float rings = smoothstep(0.7, 0.95, fract(dd / 6.5 - t * 0.3 + fn * 1.3)) * (1.0 - smoothstep(fp.z * 0.6, fp.z * 2.0, dd));
    wFoam = max(wFoam, (core + rings * 0.55) * smoothstep(0.1, 0.55, fc + fn * 0.4 + core * 0.3) * fp.w);
  }
  wFoam = clamp(wFoam * uWParams.y, 0.0, 1.0);

  diffuseColor.rgb = mix(bodyCol, vec3(0.78, 0.8, 0.8), wFoam);
  wBody = max(wBody, wFoam);

  // ---- soft waterline (depth -> 0) so there is never a hard seam against the terrain
  wEdge = smoothstep(0.0, 0.3, depth + (fn - 0.5) * 0.16);
}
`;

const REFLECT = /* glsl */ `
#if defined( RE_IndirectSpecular )
{
  // facets tilted so far that the reflected ray would dive into the water really see the backs
  // of neighbouring waves: keep those rays just above the horizon (haze), never below it
  vec3 wR = reflect(-wV, wN);
  wR.y = max(wR.y, 0.035 + 0.02 * wRough);
  wR = normalize(wR);
  // sample the sky ourselves along the clamped ray (the engine's lookup would see the dark lower
  // hemisphere of the environment map for every facet tilted away from the viewer)
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
    vec3 wEnv = textureCubeUV(envMap, envMapRotation * wR, max(wRough, 0.0525)).rgb * envMapIntensity;
    // trust the env map only if it really holds the sky (a probe that failed to capture the sky
    // dome comes back black): its blurred zenith against the palette's zenith
    vec3 wEnvUp = textureCubeUV(envMap, envMapRotation * vec3(0.0, 1.0, 0.0), 0.6).rgb * envMapIntensity * uWReflBoost;
    float wEnvOk = smoothstep(0.2, 0.55, dot(wEnvUp, vec3(0.33)) / max(dot(uWSkyZen, vec3(0.33)), 1e-5));
  #else
    vec3 wEnv = radiance;
    float wEnvOk = 0.0;
  #endif
  radiance = wReflection(wEnv, wEnvOk, vWPos, wR, wRough);
  wRefl = radiance;
  wDbgRefl = radiance;
#if defined(W_DEBUG) && defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  if (W_DEBUG == 5) wDbgRefl = wEnv;
  if (W_DEBUG == 6) wDbgRefl = textureCubeUV(envMap, envMapRotation * vec3(wR.x, -wR.y, wR.z), material.roughness).rgb * envMapIntensity;
  if (W_DEBUG == 7) wDbgRefl = vec3(envMapIntensity * 0.5, material.roughness, 0.0);
#endif
}
#endif
`;

const CLAMP = /* glsl */ `
{
  float m = max(max(reflectedLight.directSpecular.r, reflectedLight.directSpecular.g), reflectedLight.directSpecular.b);
  // written so NaN and Inf fail the test too (they would pass a plain m > limit untouched)
  if (!(m <= uWParams.z)) reflectedLight.directSpecular = (m == m && m < 1.0e30) ? reflectedLight.directSpecular * (uWParams.z / m) : vec3(0.0);
}
`;

const COMPOSITE = /* glsl */ `
{
  // the mirror term is weighted with the mirror's own normal and roughness (the engine's indirect
  // specular would use the glitter facets and roughness meant for the key light only)
  vec3 wSpecInd = wRefl * EnvironmentBRDF(wN, wV, vec3(0.02), 1.0, max(wRough, 0.0525));
  vec3 wSpec = (reflectedLight.directSpecular + wSpecInd) * (1.0 - wFoam * 0.75);
  // body / foam fill light: our own sky irradiance (the scene IBL may be missing or dim)
  vec3 wDiff = reflectedLight.directDiffuse + diffuseColor.rgb * uWAmb * RECIPROCAL_PI;
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);
  float fr = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  float wa = 1.0 - (1.0 - fr) * (1.0 - wBody);
  vec3 wc = wSpec + wDiff * wBody * (1.0 - fr);
  if (!gl_FrontFacing) {
    // seen from below: murky, with the bright sky window straight above
    wc = uWDeep * 3.0 + uWShallow * 0.4 * pow(clamp(-wV.y, 0.0, 1.0), 4.0) * (uWKeyCol + uWAmb);
    wa = 0.9;
  }
  wc *= wEdge;
  wa *= wEdge;
  gl_FragColor = vec4(wc, wa);
#ifdef W_DEBUG
  if (W_DEBUG == 1 || W_DEBUG >= 5) gl_FragColor = vec4(wDbgRefl, 1.0);
  if (W_DEBUG == 2) gl_FragColor = vec4(wDbgHit, fr, wBody, 1.0);
  if (W_DEBUG == 3) gl_FragColor = vec4(wSpecInd, 1.0);
  if (W_DEBUG == 4) gl_FragColor = vec4(wDiff, 1.0);
#endif
}
`;

const FOG = /* glsl */ `
#ifdef USE_FOG
{
  vec4 wf = atmoFogTerm(cameraPosition, vAtmoWorldPos);
  gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - wf.a) + wf.rgb * (wf.a * gl_FragColor.a);
}
#endif
`;

/**
 * Create the water surface material. `shared` holds the uniform objects (shared by every variant
 * so one update per frame drives all of them).
 */
export function createSurfaceMaterial(ctx, shared, { local = false, planar = false, contact = false, march = 0, terrMaps = false, name = 'water', debug = 0 } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1a20,
    roughness: 0.08,
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  mat.name = name;
  const defines = {};
  if (local) defines.W_LOCAL = '';
  if (planar) defines.W_PLANAR = '';
  if (planar === 'sky') defines.W_PLANAR_SKY = '';
  if (contact) defines.W_CONTACT = '';
  if (march > 0) defines.W_MARCH = String(march);
  if (terrMaps) defines.W_TERRMAPS = '';
  if (debug) defines.W_DEBUG = String(debug);
  mat.defines = { ...(mat.defines || {}), ...defines };
  const key = `mw-water|${Object.keys(defines).sort().join(',')}|${march}`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    let vs = shader.vertexShader;
    vs = vs.replace(
      '#include <common>',
      `#include <common>
varying vec3 vWPos;
#ifdef W_LOCAL
attribute vec4 aWater;
varying vec4 vWater;
#endif`,
    );
    vs = vs.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef W_LOCAL
vWater = aWater;
{
  // depth bias toward the camera: streams and pools sit a hair above the ground and must win the
  // depth test against the terrain's LOD mesh at any distance without visibly floating
  vec3 toC = cameraPosition - vWPos;
  float dC = length(toC);
  vec3 biased = vWPos + toC * (min(dC * 0.004, 14.0) / max(dC, 1e-3));
  mvPosition = viewMatrix * vec4(biased, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
#endif`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${PARS}`);
    fs = fs.replace('#include <normal_fragment_maps>', SURFACE);
    fs = fs.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${REFLECT}`);
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${CLAMP}`);
    fs = fs.replace('#include <opaque_fragment>', COMPOSITE);
    fs = fs.replace('#include <fog_fragment>', FOG);
    fs = fs.replace('#include <premultiplied_alpha_fragment>', '');
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Uniform objects shared by every water surface variant. */
export function createSharedUniforms() {
  return {
    uWTime: { value: 0 },
    uWWaves: { value: null },
    uWNoise: { value: null },
    uWWind: { value: new THREE.Vector4(0.92, -0.39, 3.0, 1.0) },
    uWDirA: { value: new THREE.Vector4(1, 0, 0, 1) },
    uWDirB: { value: new THREE.Vector4(1, 0, 0, 1) },
    uWParams: { value: new THREE.Vector4(0.2, 1.0, 9.0, 1.0) },
    uWShallow: { value: new THREE.Color(0.06, 0.15, 0.12) },
    uWDeep: { value: new THREE.Color(0.004, 0.012, 0.02) },
    uWSkyZen: { value: new THREE.Color(0.2, 0.35, 0.6) },
    uWSkyHor: { value: new THREE.Color(0.8, 0.7, 0.6) },
    uWSkySun: { value: new THREE.Color(1, 0.7, 0.4) },
    uWSkyP: { value: new THREE.Vector4(0, 0, 0.6, 0) },
    uWSkyBelt: { value: new THREE.Color(0, 0, 0) },
    uWSkyNight: { value: new THREE.Vector4(0, 1, 1, 1) },
    uWSkyMoon: { value: new THREE.Vector4(0, 1, 0, 1) },
    uWSkyMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uWKeyCol: { value: new THREE.Color(1, 1, 1) },
    uWKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uWAmb: { value: new THREE.Color(0.3, 0.35, 0.45) },
    uWAmbGround: { value: new THREE.Color(0.1, 0.09, 0.08) },
    uWHeight: { value: null },
    uWHeightXf: { value: new THREE.Vector4() },
    uWMarch: { value: new THREE.Vector4(3, 1.33, 7500, 1020) },
    uWReflBoost: { value: 1.3 },
    uWData: { value: null },
    uWDataXf: { value: new THREE.Vector4() },
    uWTerrB: { value: null },
    uWTerrSun: { value: null },
    uWTerrXf: { value: new THREE.Vector4() },
    uWPlanar: { value: null },
    uWPlanarMat: { value: new THREE.Matrix4() },
    uWPlanarP: { value: new THREE.Vector4(0, 0.045, 5, 0) },
    uWContact: { value: null },
    uWFoamPts: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uWContactXf: { value: new THREE.Vector4() },
  };
}
