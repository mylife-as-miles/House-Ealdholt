// Time of day: sun + moon paths, colour palette, lights, cascaded sun shadows, and the live
// atmosphere uniforms.
//
// ctx.env API (used by sky, water, post, UI…):
//   env.hour                   current hour 0..24
//   env.speed                  hours advanced per real second (0 = frozen; UI may enable time-lapse)
//   env.setHour(h)             jump to an hour (fires onChange)
//   env.onChange(fn)           called with env whenever the hour changes noticeably (sky/env-map rebuild)
//   env.sunDir                 THREE.Vector3 toward the sun (normalised)
//   env.moonDir                THREE.Vector3 toward the moon (rises NE ~15:24, sets W ~04:36)
//   env.moon2Dir               THREE.Vector3 toward the pale second moon (circumpolar, never sets)
//   env.keyDir                 direction of the shadow-casting key light (sun by day, moon by night)
//   env.sunElevation           degrees above horizon (negative at night)
//   env.night                  0 (day) .. 1 (full night)
//   env.twilight               0..1, peaks around sunset/sunrise (afterglow, belt of Venus)
//   env.morning                0..1, dawn/morning palette weight (misty, cooler)
//   env.palette                current interpolated palette (THREE.Color values, linear):
//                                sun, fog, fogAway, zenith, horizon, cloud, hemiSky, hemiGround
//                                + sunIntensity, hemiIntensity, exposure, fogDensity, fogFalloff,
//                                haze, envIntensity, cloudIntensity, glow, scatter, moonIntensity
//   env.sun                    the key light (DirectionalLight, casts the shadow map); it follows
//                              the moon at night so moonlight casts shadows
//   env.moon                   secondary (shadowless) moon fill light — kept for API compatibility
//   env.hemi                   hemisphere fill (reduced automatically once the sky installs IBL)
//   env.setIblActive(b)        called by the sky module when scene.environment is live

import * as THREE from 'crownfall-world-three';
import { atmo } from './atmosphere.js';
import { smoothstep, clamp } from './noise.js';

// ---------------------------------------------------------------------------
// Palette keyframes by sun elevation (degrees). Colours are sRGB hex; converted to linear.
//   sun/si        sun colour / intensity            fog / fogAway   in-scatter colour side-on / away from sun
//   zenith        sky overhead                      horizon         sky just above the haze band
//   cloud/ci      light on clouds (stays lit after the ground sunset)
//   hemiSky/hemiGround/hi   hemisphere fill          ei              scene.environmentIntensity (IBL)
//   fd/ff/haze    fog density/falloff, haze          glow/scat       broad / tight sun in-scatter
// ---------------------------------------------------------------------------
const KEYS = [
  { e: -30, sun: '#6f86c8', si: 0.0, fog: '#0e1526', fogAway: '#0a1020', zenith: '#02050f', horizon: '#101a30', cloud: '#20283c', ci: 0.0,
    hemiSky: '#2c3d62', hemiGround: '#0a0b10', hi: 1.9, ei: 1.0, exposure: 1.7, fd: 0.00034, ff: 0.0034, haze: 0.00004, glow: 0.0, scat: 0.0 },
  { e: -12, sun: '#7084c4', si: 0.0, fog: '#161f38', fogAway: '#0f172c', zenith: '#040a1c', horizon: '#1d2748', cloud: '#2a3350', ci: 0.0,
    hemiSky: '#31426a', hemiGround: '#0c0d14', hi: 1.6, ei: 1.0, exposure: 1.65, fd: 0.00036, ff: 0.0034, haze: 0.000045, glow: 0.0, scat: 0.0 },
  { e: -6, sun: '#8a6aa8', si: 0.0, fog: '#2c3558', fogAway: '#1f2a4a', zenith: '#0a1638', horizon: '#433f6a', cloud: '#6a4a78', ci: 0.25,
    hemiSky: '#3d4a78', hemiGround: '#14131a', hi: 1.1, ei: 1.0, exposure: 1.35, fd: 0.0004, ff: 0.0034, haze: 0.00005, glow: 0.15, scat: 0.25 },
  { e: -2.5, sun: '#ff5a2e', si: 0.2, fog: '#565c82', fogAway: '#3a4670', zenith: '#18295e', horizon: '#aa7088', cloud: '#ff6a4a', ci: 1.1,
    hemiSky: '#5a68a4', hemiGround: '#1a1a26', hi: 1.35, ei: 1.0, exposure: 1.3, fd: 0.00046, ff: 0.0034, haze: 0.000055, glow: 0.45, scat: 0.5 },
  { e: 2, sun: '#ff7436', si: 1.8, fog: '#bb8064', fogAway: '#6e6c8e', zenith: '#2c4a8c', horizon: '#f0a272', cloud: '#ff9058', ci: 1.6,
    hemiSky: '#8583a6', hemiGround: '#46302a', hi: 0.9, ei: 0.85, exposure: 1.0, fd: 0.00046, ff: 0.0034, haze: 0.000058, glow: 0.6, scat: 0.7 },
  { e: 7, sun: '#ff9650', si: 3.0, fog: '#cc9e7c', fogAway: '#8a8aa8', zenith: '#3862a8', horizon: '#f6c994', cloud: '#ffb47a', ci: 1.7,
    hemiSky: '#9098b8', hemiGround: '#5a4232', hi: 0.95, ei: 0.75, exposure: 0.96, fd: 0.00042, ff: 0.0035, haze: 0.000055, glow: 0.5, scat: 0.65 },
  { e: 15, sun: '#ffb56e', si: 3.5, fog: '#c2b2a6', fogAway: '#92a2c0', zenith: '#396ebf', horizon: '#f3dcb4', cloud: '#ffc890', ci: 1.55,
    hemiSky: '#9aaccc', hemiGround: '#5e4c3a', hi: 1.0, ei: 0.7, exposure: 0.93, fd: 0.00036, ff: 0.0035, haze: 0.00005, glow: 0.28, scat: 0.6 },
  { e: 30, sun: '#ffe2c0', si: 3.8, fog: '#b3bfcc', fogAway: '#9fb4cf', zenith: '#3a6fbe', horizon: '#dde6ee', cloud: '#fff4e8', ci: 1.9,
    hemiSky: '#a2b9d9', hemiGround: '#5c5446', hi: 1.1, ei: 0.7, exposure: 0.9, fd: 0.00032, ff: 0.0036, haze: 0.000046, glow: 0.3, scat: 0.5 },
  { e: 60, sun: '#fff3e4', si: 4.0, fog: '#aabdd0', fogAway: '#98b0cc', zenith: '#2c63b6', horizon: '#d2e0ec', cloud: '#ffffff', ci: 2.1,
    hemiSky: '#a8c0e0', hemiGround: '#5c5850', hi: 1.15, ei: 0.7, exposure: 0.88, fd: 0.0003, ff: 0.0036, haze: 0.000044, glow: 0.25, scat: 0.45 },
];

// Dawn / morning variant: cooler pastel light, pink-lavender haze, and a thick valley mist that
// hugs the lake (denser base fog with a steep falloff). Only the listed fields differ.
const MORNING = {
  '-6': { fog: '#2e3658', fogAway: '#262f52', horizon: '#4a4670', cloud: '#7a5a8a', fd: 0.0007, ff: 0.0048 },
  '-2.5': { sun: '#ff6a4a', fog: '#74607e', fogAway: '#4a5274', horizon: '#c08a8a', cloud: '#ff8a7a', fd: 0.00095, ff: 0.0052 },
  2: { sun: '#ff8a5a', fog: '#b98a86', fogAway: '#7c7c9a', horizon: '#f0b098', cloud: '#ffa088', fd: 0.0011, ff: 0.0055 },
  7: { sun: '#ffaa70', fog: '#c8a296', fogAway: '#9296ae', horizon: '#f4c6a8', cloud: '#ffc0a0', fd: 0.00085, ff: 0.0052, haze: 0.000064 },
  15: { sun: '#ffc88e', fog: '#c4b0a4', fogAway: '#a0aabc', horizon: '#ecd4ba', cloud: '#ffdcc0', fd: 0.0007, ff: 0.0046 },
  30: { fog: '#b4bfcc', fd: 0.00042, ff: 0.0040 },
};

const COLOR_KEYS = ['sun', 'fog', 'fogAway', 'zenith', 'horizon', 'cloud', 'hemiSky', 'hemiGround'];
const NUM_KEYS = {
  si: 'sunIntensity', hi: 'hemiIntensity', ei: 'envIntensity', ci: 'cloudIntensity', exposure: 'exposure',
  fd: 'fogDensity', ff: 'fogFalloff', haze: 'haze', glow: 'glow', scat: 'scatter',
};
const NUM_ENTRIES = Object.entries(NUM_KEYS);
const NUM_NAMES = Object.values(NUM_KEYS);
/** Haze scale height: aerial perspective thins out with altitude (1/m). */
const HAZE_FALLOFF = 1 / 1900;

function linearKeys(keys) {
  return keys.map((k) => {
    const o = { e: k.e };
    for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
    for (const n of Object.keys(NUM_KEYS)) o[n] = k[n];
    return o;
  });
}
const EVENING_KEYS = linearKeys(KEYS);
const MORNING_KEYS = linearKeys(KEYS.map((k) => ({ ...k, ...(MORNING[String(k.e)] || {}) })));

function samplePalette(keys, elev, out) {
  let i = 0;
  while (i < keys.length - 2 && elev > keys[i + 1].e) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = clamp((elev - a.e) / (b.e - a.e), 0, 1);
  const s = t * t * (3 - 2 * t);
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], s);
  for (let j = 0; j < NUM_ENTRIES.length; j++) {
    const k = NUM_ENTRIES[j][0];
    out[NUM_ENTRIES[j][1]] = a[k] + (b[k] - a[k]) * s;
  }
  return out;
}

function makePalette() {
  const p = {};
  for (const c of COLOR_KEYS) p[c] = new THREE.Color();
  for (const name of Object.values(NUM_KEYS)) p[name] = 0;
  p.moonIntensity = 0;
  return p;
}

function lerpPalette(a, b, t, out) {
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], t);
  for (const name of NUM_NAMES) out[name] = a[name] + (b[name] - a[name]) * t;
  return out;
}

// ---------------------------------------------------------------------------
// Celestial paths
// ---------------------------------------------------------------------------

/** Sun direction for an hour of day. Rises in the east (+x), noon high in the south (+z), sets west-northwest. */
export function sunDirectionForHour(hour, out = new THREE.Vector3()) {
  const t = (hour - 6.0) / 12.8; // 0 sunrise .. 1 sunset
  const phi = t * Math.PI;
  const maxElev = THREE.MathUtils.degToRad(52);
  const elev = Math.sin(phi) * maxElev;
  const ce = Math.cos(elev);
  out.set(Math.cos(phi) * ce, Math.sin(elev), (0.62 * Math.sin(phi) - 0.2) * ce).normalize();
  return out;
}

/**
 * The main moon (near full): rises in the NE ~15:24 and stands over the eastern ridges at golden
 * hour, crosses the south around 22:00, and hangs low in the WSW in the small hours; sets ~04:36.
 * Azimuth from north, clockwise (east = 90°).
 */
export function moonDirectionForHour(hour, out = new THREE.Vector3()) {
  let h = hour - 15.4;
  if (h < -6) h += 24;
  const t = h / 13.2;
  const el = THREE.MathUtils.degToRad(42) * Math.sin(Math.PI * t);
  const az = THREE.MathUtils.degToRad(40 + 235 * t);
  const ce = Math.cos(el);
  return out.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce);
}

/** North celestial pole (stars and the second moon wheel around it). */
export const CELESTIAL_POLE = new THREE.Vector3(0, Math.sin(THREE.MathUtils.degToRad(38)), -Math.cos(THREE.MathUtils.degToRad(38)));

const _q = new THREE.Quaternion();
// start point of the second moon: 21° from the pole, on the zenith side
const _base2 = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-31));
/** The pale second moon: circles the pole 21° away, once per day — it never sets. */
export function moon2DirectionForHour(hour, out = new THREE.Vector3()) {
  const ang = ((hour - 22.0) / 24) * Math.PI * 2 - 0.75;
  _q.setFromAxisAngle(CELESTIAL_POLE, ang);
  return out.copy(_base2).applyQuaternion(_q).normalize();
}

// ---------------------------------------------------------------------------

const SHADOW_REACH = 3400; // how far toward the light the shadow camera sits (tall casters)
const UP = new THREE.Vector3(0, 1, 0);

export function createEnvironment(ctx) {
  const { scene, quality } = ctx;

  // Key light: one camera-following shadow map, snapped to its texel grid in light space so
  // shadow edges never crawl. (The terrain adds basin-wide mountain shadows from its own
  // heightfield sun-visibility map by patching the directional-light loop, so this must stay a
  // DirectionalLight whose direction equals env.sunDir by day.)
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const cam = sun.shadow.camera;
    const ext = quality.shadowExtent;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 10;
    cam.far = SHADOW_REACH + 2600;
    cam.updateProjectionMatrix();
    // depth range ~6 km: bias ≈ 0.25 m; normal offset ≈ 1.3 texels
    sun.shadow.bias = -0.00004;
    sun.shadow.normalBias = 1.3 * ((2 * ext) / quality.shadowSize);
    sun.shadow.radius = 1.5;
  }
  sun.name = 'sun';
  sun.castShadow = quality.shadows;
  scene.add(sun);
  scene.add(sun.target);

  const moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  moon.name = 'moon';
  scene.add(moon);
  scene.add(moon.target);

  const hemi = new THREE.HemisphereLight(0xa0b8d8, 0x5a5448, 1);
  hemi.name = 'hemi';
  scene.add(hemi);

  const palette = makePalette();
  const eveningPal = makePalette();
  const morningPal = makePalette();
  const moonColor = new THREE.Color('#9db4ff');
  const keyColor = new THREE.Color();

  const listeners = [];
  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const lx = new THREE.Vector3();
  const ly = new THREE.Vector3();
  const lz = new THREE.Vector3();
  let lastCam = null;

  const env = {
    hour: ctx.params.hour ?? ctx.layout.WORLD.defaultHour,
    speed: 0,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    moon2Dir: new THREE.Vector3(),
    keyDir: new THREE.Vector3(),
    sunElevation: 0,
    moonElevation: 0,
    night: 0,
    twilight: 0,
    morning: 0,
    /** 0..1 illuminated fraction of the main moon (from the real sun/moon angle) */
    moonPhase: 0.8,
    palette,
    sun,
    moon,
    hemi,
    iblActive: false,
    _lastNotifiedHour: -999,

    setHour(h) {
      env.hour = ((h % 24) + 24) % 24;
      env.apply(true);
    },

    onChange(fn) {
      listeners.push(fn);
    },

    setIblActive(on) {
      env.iblActive = !!on;
      env.apply(false);
    },

    /** Recompute everything from env.hour. */
    apply(force = false) {
      const h = env.hour;
      sunDirectionForHour(h, env.sunDir);
      moonDirectionForHour(h, env.moonDir);
      moon2DirectionForHour(h, env.moon2Dir);
      env.sunElevation = THREE.MathUtils.radToDeg(Math.asin(clamp(env.sunDir.y, -1, 1)));
      env.moonElevation = THREE.MathUtils.radToDeg(Math.asin(clamp(env.moonDir.y, -1, 1)));
      env.moonPhase = 0.5 - 0.5 * env.sunDir.dot(env.moonDir);

      env.morning = smoothstep(1.5, 4, h) * (1 - smoothstep(10, 12.5, h));
      samplePalette(EVENING_KEYS, env.sunElevation, eveningPal);
      samplePalette(MORNING_KEYS, env.sunElevation, morningPal);
      lerpPalette(eveningPal, morningPal, env.morning, palette);

      env.night = smoothstep(1, -9, env.sunElevation);
      env.twilight = smoothstep(-9, -2, env.sunElevation) * (1 - smoothstep(4, 12, env.sunElevation));

      // moonlight: needs night, the moon above the ridges, and scales with its phase
      const moonUp = smoothstep(2, 14, env.moonElevation);
      const moonNight = smoothstep(-4, -12, env.sunElevation);
      palette.moonIntensity = 0.62 * moonNight * moonUp * (0.35 + 0.65 * env.moonPhase);

      // key light: the sun, handed over to the moon once the sun is gone (both are ~0 at the swap)
      const sunVisible = smoothstep(-3, 2, env.sunElevation);
      const sunI = palette.sunIntensity * sunVisible;
      if (env.sunElevation > -3.5 || palette.moonIntensity <= 0) {
        env.keyDir.copy(env.sunDir);
        keyColor.copy(palette.sun);
        sun.intensity = sunI;
      } else {
        env.keyDir.copy(env.moonDir);
        keyColor.copy(moonColor);
        sun.intensity = palette.moonIntensity;
      }
      sun.color.copy(keyColor);
      if (env.keyDir.y < 0.02) env.keyDir.y = 0.02; // never light from below the horizon
      env.keyDir.normalize();
      placeShadow();
      moon.intensity = 0; // the key light carries the moonlight (with shadows)
      moon.color.copy(moonColor);

      hemi.color.copy(palette.hemiSky);
      hemi.groundColor.copy(palette.hemiGround);
      // With image-based lighting from the sky the hemisphere light would double the ambient;
      // keep a little of it for the warm ground bounce the sky map lacks.
      // (at night the sky map is nearly black, so the hemisphere stays as the moonlit fill)
      hemi.intensity = palette.hemiIntensity * (env.iblActive ? 0.45 + 0.55 * env.night : 1);
      // IBL fills shadows strongly; keep it restrained by day so light and shade stay contrasty
      scene.environmentIntensity = palette.envIntensity * (0.72 + 0.28 * env.night);

      // shared shader uniforms (mutate in place!)
      atmo.sunDir.x = env.sunDir.x;
      atmo.sunDir.y = env.sunDir.y;
      atmo.sunDir.z = env.sunDir.z;
      atmo.moonDir.x = env.moonDir.x;
      atmo.moonDir.y = env.moonDir.y;
      atmo.moonDir.z = env.moonDir.z;
      const glow = smoothstep(-6, 1, env.sunElevation);
      atmo.sunColor.x = palette.sun.r * glow;
      atmo.sunColor.y = palette.sun.g * glow;
      atmo.sunColor.z = palette.sun.b * glow;
      atmo.fogColor.x = palette.fog.r;
      atmo.fogColor.y = palette.fog.g;
      atmo.fogColor.z = palette.fog.b;
      atmo.fogAway.x = palette.fogAway.r - palette.fog.r;
      atmo.fogAway.y = palette.fogAway.g - palette.fog.g;
      atmo.fogAway.z = palette.fogAway.b - palette.fog.b;
      atmo.fogAway.w = HAZE_FALLOFF;
      atmo.fog.x = palette.fogDensity;
      atmo.fog.y = palette.fogFalloff;
      atmo.fog.w = palette.haze;
      atmo.scatter.x = palette.scatter;
      atmo.scatter.y = 9.0;
      atmo.scatter.z = palette.moonIntensity * 0.18;
      atmo.scatter.w = palette.glow;
      atmo.time.y = env.night;
      atmo.time.w = env.hour;

      ctx.renderer.toneMappingExposure = palette.exposure;

      if (force || Math.abs(env.hour - env._lastNotifiedHour) > 0.05) {
        env._lastNotifiedHour = env.hour;
        for (const fn of listeners) fn(env);
      }
    },

    /** Per-frame: advance time, keep the shadow frustum centred ahead of the camera. */
    update(dt, camera) {
      if (env.speed !== 0) {
        env.hour = (env.hour + env.speed * dt + 24) % 24;
        env.apply(false);
      }
      lastCam = camera;
      placeShadow();
      moon.target.position.copy(camera.position);
      moon.position.copy(camera.position).addScaledVector(env.moonDir, 3000);
    },
  };

  // Single shadow map: centre it on a point ahead of the camera, then snap that centre to the
  // shadow-map texel grid *in light space* (the ortho camera's own x/y axes), so moving or turning
  // the camera never makes shadow edges crawl. Depth along the light isn't snapped (not needed).
  // Coverage grows with altitude in a few discrete steps (with hysteresis), so the texel grid only
  // changes when a level is crossed: crisp near the ground, wide when flying over the basin.
  const EXT_LEVELS = [1, 1.7, 2.6];
  let extLevel = 0;
  function updateExtent(camera) {
    if (!quality.shadows) return quality.shadowExtent;
    const hag = camera.position.y - ctx.heightAt(camera.position.x, camera.position.z);
    const up = [380, 1100];
    if (extLevel < 2 && hag > up[extLevel] * 1.12) extLevel++;
    else if (extLevel > 0 && hag < up[extLevel - 1] * 0.88) extLevel--;
    const ext = quality.shadowExtent * EXT_LEVELS[extLevel];
    const cam = sun.shadow.camera;
    if (cam.right !== ext) {
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.updateProjectionMatrix();
      sun.shadow.normalBias = 1.3 * ((2 * ext) / quality.shadowSize);
    }
    return ext;
  }

  function placeShadow() {
    const camera = lastCam || ctx.camera;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const ext = updateExtent(camera);
    tmp.copy(camera.position).addScaledVector(fwd, ext * 0.5);
    tmp.y = ctx.heightAt(tmp.x, tmp.z);
    if (quality.shadows) {
      const texel = (2 * ext) / quality.shadowSize;
      // light basis as Object3D.lookAt builds it for a light looking along -keyDir (up = +y)
      lz.copy(env.keyDir);
      lx.crossVectors(UP, lz);
      if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0);
      lx.normalize();
      ly.crossVectors(lz, lx);
      const px = Math.round(tmp.dot(lx) / texel) * texel;
      const py = Math.round(tmp.dot(ly) / texel) * texel;
      const pz = tmp.dot(lz);
      tmp.copy(lx).multiplyScalar(px).addScaledVector(ly, py).addScaledVector(lz, pz);
    }
    sun.target.position.copy(tmp);
    sun.position.copy(tmp).addScaledVector(env.keyDir, SHADOW_REACH);
    sun.target.updateMatrixWorld();
  }

  env.apply(true);
  return env;
}
