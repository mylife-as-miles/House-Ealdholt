/** GPU spectrum/evolution/Stockham shaders adapted from Leonxlnx/open-water,
 * src/ocean/ocean.js at 3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8.
 * Copyright (c) 2026 Leonxlnx. MIT; retain the Open Water licence notices.
 * Crownfall packs slope X/Z, height and persistent foam into one surface texture.
 * No upstream audio, polar ocean mesh or world/atmosphere renderer is included. */
export const OPEN_WATER_FULLSCREEN_VERTEX = `precision highp float;
precision highp int;
in vec3 position;
void main() { gl_Position = vec4(position, 1.); }`;
export const OPEN_WATER_SPECTRUM_FRAGMENT = `precision highp float;
precision highp int;

const float PI = 3.14159265359;
const float G = 9.81;
const float SIGMA_RHO = 7.4e-5;
float omegaOf(float k) { return sqrt(G * k + SIGMA_RHO * k * k * k); }
float domegadk(float k) { return (G + 3.0 * SIGMA_RHO * k * k) / (2.0 * omegaOf(k)); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

uniform sampler2D uNoise;
uniform float uL;
uniform vec2 uBand;        // kmin, kmax for this cascade
uniform vec4 uWind;        // U10 (m/s), fetch (m), direction (rad), amplitude scale
uniform vec4 uSwell;       // Hs (m), peak period (s), direction (rad), spread exponent s
uniform float uShortCut;   // damping length for very short waves
uniform float uSpreadBlend; // a confused storm sea: broad cos^2s spreading blended in
out vec4 o;

// Elfouhaily, Chapron, Katsaros & Vandemark (1997) unified spectrum: JONSWAP-like long waves
// plus a Phillips/Kitaigorodskii short-wave regime calibrated to Cox-Munk slope statistics.
// Returns the omnidirectional wavenumber spectrum S(k) (m^3); kp is the spectral peak.
float elfouhaily(float k, float U, float fetch, out float kp, out float delta) {
  float ko = G / (U * U);
  float X = ko * fetch;
  float Om = clamp(0.84 * pow(tanh(pow(X / 2.2e4, 0.4)), -0.75), 0.84, 5.0);
  kp = ko * Om * Om;
  float cp = sqrt(G / kp);
  const float km = 370.0, cm = 0.23;
  float c = sqrt(G / k * (1.0 + (k / km) * (k / km)));
  float Lpm = exp(-1.25 * (kp / k) * (kp / k));
  float gamma = Om <= 1.0 ? 1.7 : 1.7 + 6.0 * log(Om) / log(10.0);
  float sigma = 0.08 * (1.0 + 4.0 / (Om * Om * Om));
  float r = sqrt(k / kp) - 1.0;
  float Jp = pow(gamma, exp(-r * r / (2.0 * sigma * sigma)));
  float Fp = Lpm * Jp * exp(-Om / sqrt(10.0) * r);
  float Bl = 0.5 * 0.006 * pow(Om, 0.55) * (cp / c) * Fp;
  float ustar = 0.03795 * U; // sqrt(Cd10N = 0.00144) * U10
  // clamped: no capillary-gravity energy below ~2.2 m/s (the fit goes negative there)
  float alpham = max(ustar <= cm ? 0.01 * (1.0 + log(ustar / cm)) : 0.01 * (1.0 + 3.0 * log(ustar / cm)), 0.0);
  float Fm = Lpm * Jp * exp(-0.25 * (k / km - 1.0) * (k / km - 1.0));
  float Bh = 0.5 * alpham * (cm / c) * Fm;
  delta = tanh(0.1733 + 4.0 * pow(c / cp, 2.5) + 0.13 * ustar / cm * pow(cm / c, 2.5));
  return (Bl + Bh) / (k * k * k);
}

float donelanBanner(float theta, float r) {
  r = clamp(r, 0.56, 10.0);
  float beta;
  if (r < 0.95) beta = 2.61 * pow(r, 1.3);
  else if (r < 1.6) beta = 2.28 * pow(r, -1.3);
  else beta = pow(10.0, -0.4 + 0.8393 * exp(-0.567 * log(r * r)));
  float c = cosh(clamp(beta * theta, -15.0, 15.0));
  return beta / (2.0 * tanh(beta * PI)) / (c * c);
}

// Bretschneider/JONSWAP-shaped swell with prescribed Hs, gamma = 5 (narrow).
float swellSpectrum(float w, float Hs, float Tp) {
  float wp = 2.0 * PI / Tp;
  float gamma = 5.0;
  float sigma = w <= wp ? 0.07 : 0.09;
  float d = (w - wp) / (sigma * wp);
  float r = exp(-0.5 * d * d);
  return (5.0 / 16.0) * Hs * Hs * pow(wp, 4.0) / pow(w, 5.0) * exp(-1.25 * pow(wp / w, 4.0))
       * (1.0 - 0.287 * log(gamma)) * pow(gamma, r);
}
float cos2s(float theta, float s) {
  // normalized cos^{2s}(theta/2): Gamma(s+1)/(2 sqrt(pi) Gamma(s+1/2)) ~ sqrt(s + 0.25 + 1/(32 s)) / (2 sqrt(pi))
  float norm = sqrt(s + 0.25 + 1.0 / (32.0 * s)) / (2.0 * sqrt(PI));
  return norm * pow(abs(cos(0.5 * theta)), 2.0 * s);
}

float wrapAngle(float a) { return mod(a + PI, 2.0 * PI) - PI; }

// 2D wavenumber spectrum Psi(kx, kz) (m^4): integral over the k-plane = elevation variance
float spectrum(vec2 k) {
  float kl = length(k);
  if (kl < uBand.x || kl >= uBand.y || kl < 1e-5) return 0.0;
  float th = atan(k.y, k.x);
  float U = max(uWind.x, 0.5);
  float kp, delta;
  float S = elfouhaily(kl, U, uWind.y, kp, delta) * uWind.w;
  float tw = wrapAngle(th - uWind.z);
  // ECKV spreading (1 + delta cos 2phi)/2pi made downwind-dominant; narrow Donelan-Banner near the peak
  const float eps = 0.06;
  float eckv = (1.0 + delta * cos(2.0 * tw)) / (2.0 * PI) * (abs(tw) < 0.5 * PI ? 1.0 : eps) * 2.0 / (1.0 + eps);
  float db = donelanBanner(tw, sqrt(kl / kp));
  float D = mix(db, eckv, smoothstep(1.4, 3.5, kl / kp));
  D = mix(D, cos2s(tw, 4.0), uSpreadBlend * smoothstep(1.5, 4.0, kl / kp));
  float Psi = S / kl * D;
  if (uSwell.x > 0.0) {
    float w = omegaOf(kl);
    float ts = wrapAngle(th - uSwell.z);
    Psi += swellSpectrum(w, uSwell.x, uSwell.y) * cos2s(ts, uSwell.w) * domegadk(kl) / kl;
  }
  return Psi * exp(-kl * kl * uShortCut * uShortCut);
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  float n = float(textureSize(uNoise, 0).x);
  float dk = 2.0 * PI / uL;
  vec2 k = (vec2(id) - n * 0.5) * dk;
  ivec2 mid = (ivec2(n) - id) % ivec2(n);
  if (id.x == 0 || id.y == 0) { o = vec4(0.0); return; } // unpaired Nyquist modes
  vec2 xi = texelFetch(uNoise, id, 0).xy;
  vec2 xm = texelFetch(uNoise, mid, 0).xy;
  // E|h0|^2 = S(k) dk^2 / 2 so that the real field variance equals the spectrum integral.
  float a0 = sqrt(max(spectrum(k), 0.0) * dk * dk * 0.25);
  float am = sqrt(max(spectrum(-k), 0.0) * dk * dk * 0.25);
  vec2 h0 = xi * a0;
  vec2 hm = xm * am;
  o = vec4(h0, hm.x, -hm.y); // h0(k), conj(h0(-k))
}`;
export const OPEN_WATER_EVOLVE_FRAGMENT = `precision highp float;
precision highp int;

const float PI = 3.14159265359;
const float G = 9.81;
const float SIGMA_RHO = 7.4e-5;
float omegaOf(float k) { return sqrt(G * k + SIGMA_RHO * k * k * k); }
float domegadk(float k) { return (G + 3.0 * SIGMA_RHO * k * k) / (2.0 * omegaOf(k)); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

uniform sampler2D uH0;
uniform float uL;
uniform float uTime;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  float n = float(textureSize(uH0, 0).x);
  vec2 k = (vec2(id) - n * 0.5) * (2.0 * PI / uL);
  float kl = max(length(k), 1e-6);
  vec4 h0 = texelFetch(uH0, id, 0);
  // dispersion quantised to a 1000 s repeat period (Tessendorf) keeps the fp32 phase small
  const float W0 = 2.0 * PI / 1000.0;
  float ph = floor(omegaOf(kl) / W0) * W0 * uTime;
  // exp(-i w t) with field exp(+i k.x): energy at k travels towards +k (downwind)
  vec2 e = vec2(cos(ph), -sin(ph));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 ih = vec2(-h.y, h.x);
  vec2 Dx = ih * (k.x / kl);
  vec2 Dz = ih * (k.y / kl);
  vec2 Dy = h;
  vec2 Dyx = ih * k.x;
  vec2 Dyz = ih * k.y;
  vec2 Dxx = -h * (k.x * k.x / kl);
  vec2 Dzz = -h * (k.y * k.y / kl);
  vec2 Dxz = -h * (k.x * k.y / kl);
  // pack two real fields into one complex signal: A + iB
  o0 = vec4(Dx.x - Dz.y, Dx.y + Dz.x, Dy.x - Dxz.y, Dy.y + Dxz.x);
  o1 = vec4(Dyx.x - Dyz.y, Dyx.y + Dyz.x, Dxx.x - Dzz.y, Dxx.y + Dzz.x);
}`;
export const OPEN_WATER_FFT_FRAGMENT = `precision highp float;
precision highp int;

const float PI = 3.14159265359;
const float G = 9.81;
const float SIGMA_RHO = 7.4e-5;
float omegaOf(float k) { return sqrt(G * k + SIGMA_RHO * k * k * k); }
float domegadk(float k) { return (G + 3.0 * SIGMA_RHO * k * k) / (2.0 * omegaOf(k)); }
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

uniform sampler2D uIn0;
uniform sampler2D uIn1;
uniform int uStage;
uniform int uDir;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int n = textureSize(uIn0, 0).x;
  int i = uDir == 0 ? id.x : id.y;
  int ns = 1 << uStage;
  int r = i & (2 * ns - 1);
  int k = r & (ns - 1);
  int j = (i >> (uStage + 1)) * ns + k;
  ivec2 a = id, b = id;
  if (uDir == 0) { a.x = j; b.x = j + n / 2; } else { a.y = j; b.y = j + n / 2; }
  float ang = PI * float(k) / float(ns);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 x0 = texelFetch(uIn0, a, 0), x1 = texelFetch(uIn0, b, 0);
  vec4 y0 = texelFetch(uIn1, a, 0), y1 = texelFetch(uIn1, b, 0);
  vec4 t0 = vec4(cmul(x1.xy, w), cmul(x1.zw, w));
  vec4 t1 = vec4(cmul(y1.xy, w), cmul(y1.zw, w));
  bool top = r < ns;
  o0 = top ? x0 + t0 : x0 - t0;
  o1 = top ? y0 + t1 : y0 - t1;
}`;
export const OPEN_WATER_ASSEMBLE_FRAGMENT = `precision highp float;
precision highp int;

uniform sampler2D uF0;
uniform sampler2D uF1;
uniform sampler2D uPrev;

// bicubic Catmull-Rom of the foam channel at a texel-space position (periodic)
float foamCR(sampler2D tex, vec2 pos) {
  ivec2 n = textureSize(tex, 0);
  vec2 p = pos - 0.5;
  vec2 i = floor(p), f = p - i;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  float r = 0.0;
  for (int y = -1; y <= 2; y++) {
    float wy = y == -1 ? w0.y : y == 0 ? w1.y : y == 1 ? w2.y : w3.y;
    for (int x = -1; x <= 2; x++) {
      float wx = x == -1 ? w0.x : x == 0 ? w1.x : x == 1 ? w2.x : w3.x;
      ivec2 c = (ivec2(i) + ivec2(x, y) + n) % n;
      r += texelFetch(tex, c, 0).w * wx * wy;
    }
  }
  return r;
}
uniform float uLambda;
uniform float uDt;
uniform vec3 uFoam;  // x: jacobian threshold bias, y: generation gain, z: decay rate (1/s)
uniform vec2 uDrift; // foam advection by the wind drift (texture uv per second)
out vec4 oSurface;
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  float sgn = ((id.x + id.y) & 1) == 1 ? -1.0 : 1.0;
  vec4 a = texelFetch(uF0, id, 0) * sgn;
  vec4 b = texelFetch(uF1, id, 0) * sgn;
  float Dx = a.x, Dz = a.y, Dy = a.z, Dxz = a.w;
  float Dyx = b.x, Dyz = b.y, Dxx = b.z, Dzz = b.w;
  float jx = 1.0 + uLambda * Dxx;
  float jz = 1.0 + uLambda * Dzz;
  float J = jx * jz - uLambda * uLambda * Dxz * Dxz;
  vec2 s = vec2(Dyx / max(jx, 0.25), Dyz / max(jz, 0.25));
  // residual foam drifts downwind with the surface (semi-Lagrangian, bilinear: smears into streaks)
  // Catmull-Rom resampling keeps streaks crisp (bilinear would diffuse them by metres per second)
  float prev = max(foamCR(uPrev, vec2(id) + 0.5 - uDrift * uDt * vec2(textureSize(uPrev, 0))), 0.0);
  float foam = prev * exp(-uFoam.z * uDt);
  foam += max(uFoam.x - J, 0.0) * uFoam.y * uDt;
  foam = min(foam, 3.0);
  // One packed surface is shared by every existing PBR water material.
  oSurface = vec4(s, Dy, foam);
}`;
