// The sky: an HDR dome (analytic, palette-driven, horizon = fog colour exactly), a sun disk with
// limb darkening, a drifting 2.5D cumulus layer + high cirrus, and a night sky with a wheeling
// star field, the Milky Way, a gibbous moon, a pale ringed second moon that never sets, and faint
// aurora curtains over the northern mountains. It also lights the world: the sky is rendered
// into a PMREM environment map (IBL + reflections), refreshed as time and clouds move.
//
// ctx.sky (for water / post / UI):
//   uniforms              the sky's live uniforms (read-only please)
//   envMap                current PMREM texture (also scene.environment), may be null briefly
//   refreshEnvironment()  force a synchronous env-map rebuild
//   cloudCoverage         get/set 0..1
//   mesh                  the dome mesh (renders last among opaques, at the far plane)

import * as THREE from 'crownfall-world-three';
import { SKY_VERT, SKY_FRAG } from './sky-shader.js';
import { createSkyNoiseTexture } from './sky-noise.js';

import { CELESTIAL_POLE } from '../core/environment.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** CPU rasterisers (the headless test harness, some VMs): use the lite shader variant. */
function isSoftwareRenderer(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software/i.test(String(name));
  } catch {
    return false;
  }
}

export async function build(ctx) {
  const { env, camera, renderer, scene } = ctx;
  const pal = env.palette;
  // ?skyq=full forces the full shader even on a software renderer (for look-dev screenshots)
  const skyq = new URLSearchParams(window.location.search).get('skyq');
  const lite = skyq === 'full' ? false : skyq === 'lite' || ctx.quality.level === 'low' || isSoftwareRenderer(renderer);

  const noise = createSkyNoiseTexture();

  const uniforms = {
    ...ctx.atmosphereUniforms,
    uNoise: { value: noise },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector4(30, THREE.MathUtils.degToRad(0.7), 0.5, 0) },
    uBelt: { value: new THREE.Color() },
    uCloudLight: { value: new THREE.Color() },
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudAmbTop: { value: new THREE.Color() },
    uCloudAmbBot: { value: new THREE.Color() },
    // coverage, base altitude (m), thickness (m), extinction (1/m)
    uCloud: { value: new THREE.Vector4(0.44, 2600, 1300, 0.016) },
    uCloudWind: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCirrus: { value: new THREE.Vector4(0.8, 8200, 1.0, 0) },
    uNight: { value: new THREE.Vector4(0, 1, 1, 1) },
    uMoonDir: { value: env.moonDir },
    uMoon2Dir: { value: env.moon2Dir },
    uMoon: { value: new THREE.Vector4(THREE.MathUtils.degToRad(0.95), 1, THREE.MathUtils.degToRad(0.55), 1) },
    uStarRot: { value: new THREE.Matrix3() },
    uPixelAngle: { value: 0.001 },
    uTime: { value: 0 },
  };

  const common = {
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  };
  const material = new THREE.ShaderMaterial({ ...common, defines: lite ? { SKY_LITE: '' } : {} });
  material.name = 'sky';
  const envMaterial = new THREE.ShaderMaterial({ ...common, defines: { SKY_ENV: '' } });
  envMaterial.name = 'sky-env';

  // Unit sphere scaled to just inside the far plane and re-centred on whichever camera renders it
  // (main view, cube probe, reflections). The vertex shader pins it to the far plane anyway; the
  // large radius only keeps depth-based passes that ignore the shader sane.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000; // after all opaques: only visible sky pixels pay for the clouds
  mesh.matrixAutoUpdate = false;
  mesh.onBeforeRender = (r, s, cam) => {
    const far = cam.far || 10000;
    mesh.matrixWorld.makeScale(far * 0.9, far * 0.9, far * 0.9).setPosition(cam.position);
  };
  scene.add(mesh);
  scene.background = null;

  // ------------------------------------------------------------------ palette -> uniforms
  const tmpC = new THREE.Color();
  const moonCol = new THREE.Color('#aebfff');
  const beltCol = new THREE.Color('#d89aa8');
  const rotM4 = new THREE.Matrix4();

  function sync() {
    const u = uniforms;
    const elev = env.sunElevation;
    u.uZenith.value.copy(pal.zenith);
    u.uHorizon.value.copy(pal.horizon);
    u.uSunColor.value.copy(pal.sun);
    // sun disk: HDR peak for bloom, dimmer when low (extinction) and gone below the horizon
    const sunUp = smooth(-1.2, 0.8, elev);
    u.uSun.value.x = 34 * sunUp * (0.35 + 0.65 * smooth(0, 14, elev));
    u.uSun.value.z = 0.25 + pal.glow * 1.1;
    u.uSun.value.w = env.twilight;
    u.uBelt.value.copy(beltCol).multiplyScalar(0.45 * smooth(-7, -1, elev) + 0.1);

    // light on clouds: the sun until well after it has set for the ground, then the moon
    const cloudSun = smooth(-7.5, -1.5, elev);
    if (cloudSun > 0.001) {
      u.uCloudLight.value.copy(pal.cloud).multiplyScalar(pal.cloudIntensity * cloudSun);
      u.uCloudLightDir.value.copy(env.sunDir);
      if (u.uCloudLightDir.value.y < -0.12) u.uCloudLightDir.value.y = -0.12;
      u.uCloudLightDir.value.normalize();
    } else {
      u.uCloudLight.value.copy(moonCol).multiplyScalar(pal.moonIntensity * 0.24);
      u.uCloudLightDir.value.copy(env.moonDir);
    }
    // sky ambient on cloud tops, ground/haze bounce under their bases
    u.uCloudAmbTop.value.copy(pal.zenith).multiplyScalar(0.75).add(tmpC.copy(pal.horizon).multiplyScalar(0.18));
    // bases see the sky around them and the land below: a cool grey-violet, never tan
    u.uCloudAmbBot.value.copy(pal.fog).lerp(pal.zenith, 0.4).multiplyScalar(0.72).add(tmpC.copy(pal.hemiGround).multiplyScalar(0.3));

    // night sky
    u.uNight.value.x = env.night;
    u.uNight.value.y = 1.0;
    u.uNight.value.z = 1.0;
    u.uNight.value.w = smooth(0.55, 1.0, env.night) * 0.85;
    // moons: pale by day, bright at night
    u.uMoon.value.y = 0.35 + 2.1 * env.night;
    u.uMoon.value.w = 0.22 + 1.1 * env.night;

    // stars wheel around the pole, one turn per day
    rotM4.makeRotationAxis(CELESTIAL_POLE, (env.hour / 24) * Math.PI * 2);
    u.uStarRot.value.setFromMatrix4(rotM4);
  }
  sync();

  // ------------------------------------------------------------------ environment map
  const lvl = ctx.quality.level;
  const probeSize = lite && isSoftwareRenderer(renderer) ? 32 : lvl === 'high' ? 256 : lvl === 'low' ? 64 : 128;
  const probe = {texture:null,refreshNow(){},request(){},update(){}};
  // Native adapter owns IBL; no PMREM/secondary scene draw inside XR frames.
  env.setIblActive(false);

  let lastHour = env.hour;
  env.onChange(() => {
    sync();
    // a jump (setHour / UI) rebuilds now; smooth time-lapse is amortised over frames
    const jump = Math.abs(env.hour - lastHour) > 0.25 && env.speed === 0;
    lastHour = env.hour;
    if (jump || ctx.params.shot) probe.refreshNow(uniforms.uTime.value);
    else probe.request();
  });

  // ------------------------------------------------------------------ per frame
  const size = new THREE.Vector2();
  const WIND = new THREE.Vector2(7.5, -3.2); // m/s, drifting east-south-east
  const WIND_HI = new THREE.Vector2(19, 5);

  ctx.sky = {
    uniforms,
    mesh,
    material,
    get envMap() {
      return probe.texture;
    },
    refreshEnvironment() {
      probe.refreshNow(uniforms.uTime.value);
    },
    get cloudCoverage() {
      return uniforms.uCloud.value.x;
    },
    set cloudCoverage(v) {
      uniforms.uCloud.value.x = Math.min(1, Math.max(0, v));
      probe.request();
    },
  };

  return {
    order: -10,
    update(dt, elapsed) {
      const u = uniforms;
      u.uTime.value = elapsed;
      u.uCloudWind.value.x += WIND.x * dt;
      u.uCloudWind.value.y += WIND.y * dt;
      u.uCloudWind.value.z += WIND_HI.x * dt;
      u.uCloudWind.value.w += WIND_HI.y * dt;
      renderer.getDrawingBufferSize(size);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      u.uPixelAngle.value = (2 * Math.tan(fov / 2)) / Math.max(1, size.y);
      probe.update(elapsed);
    },
  };
}
