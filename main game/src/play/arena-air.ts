/** The air of the arena: low mist on the dais floor, the lava's glow hanging in the pit, a thin haze between the camera
 * and what it looks at, shafts of the eclipse's light, and drifting ash. The Blender scene had these as volumes
 * (CFCL_LavaMist, CFCL_Fog, CFCL_MistBank_*); the game's fog only starts 60 m out, so near the board there was no air
 * at all. Mist, haze and shafts are added in the look's final pass (arena-kit.ts ArenaGradeHook); the ash is points.
 * None of it keeps its own clock: the ash and the mist's wisps go with the arena's wind, and the ash, with what lies
 * settled on the stone, answers what the match does on the board (arena-physics.ts). */
import * as THREE from "three";
import type { ArenaContext, ArenaGradeHook, ArenaQuality } from "./arena-kit";
import { AIR_MOTION_GLSL, arenaPhysics, createRaisedAsh } from "./arena-physics";
import { airTexels, arenaTier, type Rgb } from "./arena-surface-data";

/** What lights the air, in the bake's units: the sky by direction, the lava's colour, and where the eclipse stands. */
export interface ArenaAirLight {
  up: Rgb;
  horizon: Rgb;
  lava: Rgb;
  /** Unit vector from the arena toward the eclipse. */
  sun: THREE.Vector3;
  sunColor: Rgb;
}

// Heights in metres above the board's top (the look's files are in Blender metres). The board's base stands on the
// dais floor 1.5 m down; the pit's glow starts below the dais's rim (the abyss's lava lies 6 to 17 m down).
const DAIS_FLOOR = -1.5, PIT_TOP = -3.5;

const AIR_PARS = /* glsl */ `
uniform sampler2D uCfAirNoise;
uniform vec4 uCfMist, uCfPit, uCfHaze, uCfShaft;
uniform vec3 uCfMistCol, uCfPitCol, uCfHazeCol, uCfHazeGlow, uCfShaftCol, uCfSunDir, uCfShaftU, uCfShaftV;
uniform vec2 uCfAirFade;
uniform float uCfAirTime;
// the arena's wind (xy: metres it has carried the air), and where the match has thinned the low mist (x, z, radius, amount)
uniform vec4 uCfAirWind, uCfMistPart;
// How much of a layer a ray passes through, in metres of its full density: full below layer.x, thinning above it
// with the scale height layer.y. The ray starts at height oy and climbs dy per metre for t metres.
float cfLayer(float oy, float dy, float t, vec2 layer) {
  float h = oy - layer.x, end = h + dy * t;
  float slope = abs(dy) < 1e-4 ? 1e-4 : dy;
  // the stretch below the layer's top, at full density
  float tCross = clamp(-h / slope, 0.0, t);
  float below = h < 0.0 ? (end < 0.0 ? t : tCross) : (end < 0.0 ? t - tCross : 0.0);
  // the stretch above it: the integral of exp(-height / scale)
  float a = max(h, 0.0), b = max(end, 0.0);
  float above = t - below;
  float thin = abs(b - a) < 1e-3 ? exp(-a / layer.y) : layer.y * (exp(-a / layer.y) - exp(-b / layer.y)) / (b - a);
  return below + above * thin;
}`;

const AIR_SCENE = /* glsl */ `
if (!sky && uCfAirFade.y > 0.0) {
  // the air is laid over what stands near; far ground already wears the look's fog, and the sky is never touched
  float cfT = z / max(dot(dir, fwd), 0.05);
  float cfNear = 1.0 - smoothstep(uCfAirFade.x * 0.4, uCfAirFade.x, cfT);
  if (cfNear > 0.0) {
    vec3 cfEnd = uCamPos + dir * cfT;
    float cfForward = max(dot(dir, uCfSunDir), 0.0);
    // light shafts: beams lying along the eclipse's light, cut where the view ray meets something
    if (uCfShaft.x > 0.0) {
      int cfSteps = int(uCfShaft.y);
      float cfReach = min(cfT, uCfShaft.z);
      float cfStep = cfReach / float(cfSteps);
      float cfBeams = 0.0;
      // the samples sit at fixed shares of the ray: the beams are broad, so no jitter (and none of its grain) is needed
      for (int i = 0; i < cfSteps; i++) {
        vec3 p = uCamPos + dir * ((float(i) + 0.5) * cfStep);
        vec2 q = vec2(dot(p, uCfShaftU), dot(p, uCfShaftV)) * uCfShaft.w + vec2(uCfAirTime * 0.004, 0.0);
        float beam = smoothstep(0.45, 0.8, textureLod(uCfAirNoise, q, 0.0).r);
        cfBeams += beam * smoothstep(-4.0, 2.0, p.y);
      }
      float cfPhase = 0.25 + 0.75 * cfForward * cfForward;
      c += uCfShaftCol * (cfBeams * cfStep * uCfShaft.x * cfPhase * cfNear);
    }
    // thin haze from a few metres out, glowing warmer toward the eclipse
    float cfHaze = uCfHaze.z * (1.0 - exp(-uCfHaze.y * max(cfT - uCfHaze.x, 0.0)));
    c = mix(c, uCfHazeCol + uCfHazeGlow * pow(cfForward, 6.0), cfHaze * cfNear);
    // the lava's glow hanging in the pit, and the low mist on the dais floor (wisps drift through it)
    // (the low tier leaves out the wisps, the pit and the mist: an integrated GPU has no time for them)
    // (the wisps are carried by the wind that carries the ash: they used to slide the other way on a clock of their own)
    vec2 cfWisp = uCfMist.w > 0.0 ? textureLod(uCfAirNoise, (cfEnd.xz - uCfAirWind.xy) * 0.021, 0.0).gb : vec2(0.5);
    if (uCfPit.z > 0.0) {
      float cfPit = 1.0 - exp(-uCfPit.z * cfLayer(uCamPos.y, dir.y, cfT, uCfPit.xy) * (0.75 + 0.5 * cfWisp.y));
      c = mix(c, uCfPitCol, cfPit * cfNear);
    }
    if (uCfMist.z > 0.0) {
      // a heavy blow on the board rolls the mist back from its foot: thinner in a patch that widens as it fills
      float cfThin = 1.0;
      if (uCfMistPart.w > 0.0) {
        vec2 cfFrom = cfEnd.xz - uCfMistPart.xy;
        cfThin -= uCfMistPart.w * exp(-dot(cfFrom, cfFrom) / (uCfMistPart.z * uCfMistPart.z));
      }
      float cfMist = 1.0 - exp(-uCfMist.z * cfThin * cfLayer(uCamPos.y, dir.y, cfT, uCfMist.xy) * mix(1.0, 2.0 * cfWisp.x, uCfMist.w));
      c = mix(c, uCfMistCol, cfMist * cfNear);
    }
  }
}`;

/** `tierOf` picks the feature set for a quality setting (the surface part's own rule: see arena-surface.ts). */
export function createArenaAir(context: ArenaContext, light: ArenaAirLight, tierOf: (quality: ArenaQuality) => 0 | 1 | 2 = arenaTier) {
  const violet = context.setting === 2;
  const mul = (color: Rgb, k: number): Rgb => [color[0] * k, color[1] * k, color[2] * k];
  const add = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const tint = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const vec3 = (color: Rgb) => new THREE.Vector3(color[0], color[1], color[2]);

  // one small repeating noise texture for the beams and the wisps, made here (no texture file)
  const size = 128;
  const noise = new THREE.DataTexture(airTexels(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.minFilter = noise.magFilter = THREE.LinearFilter;
  noise.needsUpdate = true;

  // The colours a volume shows are its own (the Blender volumes' colours) times the light that reaches it.
  const fog: Rgb = violet ? [0.16, 0.1, 0.3] : [0.46, 0.54, 0.7], bank: Rgb = violet ? [0.36, 0.26, 0.6] : [0.5, 0.52, 0.58];
  const lavaMist: Rgb = [0.75, 0.55, 0.45];
  const across = new THREE.Vector3().crossVectors(light.sun, new THREE.Vector3(0, 1, 0)).normalize();
  // how the air moves: the wind, and what the match does to it
  const physics = arenaPhysics(context, tierOf);
  const uniforms = {
    uCfAirNoise: { value: noise }, uCfAirTime: { value: 0 },
    uCfAirWind: physics.uniforms.uCfAirWind, uCfMistPart: physics.mist,
    // x: metres at which the near air has faded out, y: master switch
    uCfAirFade: { value: new THREE.Vector2(260, 1) },
    // layer top (m), scale height (m), density per metre, share of the wisps
    uCfMist: { value: new THREE.Vector4(DAIS_FLOOR, 0.4, 0.012, 0.7) },
    uCfMistCol: { value: vec3(tint(bank, add(mul(light.up, 0.9), mul(light.horizon, 0.5)))) },
    uCfPit: { value: new THREE.Vector4(PIT_TOP, 2.0, 0.006, 0) },
    uCfPitCol: { value: vec3(add(tint(lavaMist, mul(light.lava, 0.5)), tint(fog, mul(light.horizon, 0.12)))) },
    // start (m), density per metre, most it may cover
    // (Setting 1's is thinner: laid over the pale stone of the dais's far ring it bleached it)
    uCfHaze: { value: new THREE.Vector4(6, 0.012, violet ? 0.07 : 0.045, 0) },
    uCfHazeCol: { value: vec3(tint(fog, add(mul(light.up, 0.7), mul(light.horizon, 0.5)))) },
    uCfHazeGlow: { value: vec3(tint(bank, mul(light.sunColor, 0.5))) },
    // strength per metre, steps, reach (m), pattern repeats per metre
    uCfShaft: { value: new THREE.Vector4(0, 0, 70, 1 / 46) },
    uCfShaftCol: { value: vec3(tint(bank, light.sunColor)) },
    uCfSunDir: { value: light.sun.clone() },
    uCfShaftU: { value: across }, uCfShaftV: { value: new THREE.Vector3().crossVectors(across, light.sun).normalize() },
  };
  const grade: ArenaGradeHook = { uniforms, pars: AIR_PARS, scene: AIR_SCENE };

  // Ash: flakes that sink and drift through a box round the board, lit by the sky, with a bright edge when one hangs
  // between the camera and the eclipse. Positions are metres, like everything under the arena's root.
  const BOX = { min: new THREE.Vector3(-36, -6, -44), size: new THREE.Vector3(72, 26, 76) }, MOST = 1200;
  const position = new Float32Array(MOST * 3), seed = new Float32Array(MOST * 3);
  // a fixed sequence, so the frozen picture (reduced motion) is the same picture every time
  let state = 9781;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let i = 0; i < MOST; i++) {
    position[i * 3] = BOX.min.x + random() * BOX.size.x;
    position[i * 3 + 1] = BOX.min.y + random() * BOX.size.y;
    position[i * 3 + 2] = BOX.min.z + random() * BOX.size.z;
    seed[i * 3] = random(); seed[i * 3 + 1] = random(); seed[i * 3 + 2] = 0.035 + 0.06 * random() * random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
  const ashUniforms = {
    ...physics.uniforms,
    uTime: { value: 0 }, uScale: { value: 800 }, uBoxMin: { value: BOX.min }, uBoxSize: { value: BOX.size },
    uSunDir: { value: light.sun.clone() }, uAmount: { value: 1 },
    uAsh: { value: vec3(tint(violet ? [0.5, 0.42, 0.7] : [0.42, 0.38, 0.34], add(light.up, mul(light.horizon, 0.6)))) },
    uGlow: { value: vec3(mul(light.sunColor, violet ? 0.5 : 0.35)) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: ashUniforms,
    vertexShader: /* glsl */ `
      ${AIR_MOTION_GLSL}
      attribute vec3 aSeed; uniform float uTime, uScale, uAmount; uniform vec3 uBoxMin, uBoxSize, uSunDir, uAsh, uGlow;
      varying vec4 vColor;
      void main() {
        vec3 p = position;
        p.y -= uTime * (0.12 + 0.3 * aSeed.y);
        // carried by the arena's wind (its gusts, and the wind across it), each flake fluttering on its own way down
        p.x += uCfAirWind.x + sin(uTime * 0.21 + aSeed.x * 6.283) * 1.4;
        p.z += uCfAirWind.y + cos(uTime * 0.17 + aSeed.x * 9.1) * 1.4;
        p = uBoxMin + mod(p - uBoxMin, uBoxSize);
        // and parted round what the match has just done on the board
        p += cfAirPush(p);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        float size = aSeed.z * uScale / max(-mv.z, 0.01);
        gl_PointSize = clamp(size, 1.0, 5.0);
        // no flake pops: it thins out near the camera, far away, and where it would be smaller than a pixel
        float alpha = smoothstep(0.4, 1.6, -mv.z) * (1.0 - smoothstep(16.0, 30.0, -mv.z)) * min(1.0, size) * uAmount;
        float forward = pow(max(dot(normalize(world.xyz - cameraPosition), uSunDir), 0.0), 8.0);
        vColor = vec4(uAsh + uGlow * forward, alpha * (0.35 + 0.3 * aSeed.y));
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = vColor.a * (1.0 - smoothstep(0.1, 0.25, dot(c, c)));
        gl_FragColor = vec4(vColor.rgb * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const ash = new THREE.Points(geometry, material);
  ash.name = "arena-ash";
  ash.frustumCulled = false;
  ash.renderOrder = 5;
  context.world.add(ash);
  // the ash lying on the board, which a blow throws up: the same ash, lit by the board's key light as well as the sky
  // (in the sky's light alone it did not show against the tiles); what leaves hot is the lava's orange
  const settled = vec3(tint(violet ? [0.5, 0.42, 0.7] : [0.42, 0.38, 0.34], add(add(light.up, mul(light.horizon, 0.6)), mul(light.sunColor, 0.9))));
  const raised = createRaisedAsh(physics, { ash: settled, glow: ashUniforms.uGlow.value, sun: ashUniforms.uSunDir.value, ember: [2.4, 0.8, 0.2] });
  context.world.add(raised.points);

  // (Setting 1's shafts were raised with the cinema part's key lamp: 0.02 washed the whole frame gold, 0.003 did not show)
  const strength = { shafts: violet ? 0.004 : 0.007, wisps: uniforms.uCfMist.value.w, pit: uniforms.uCfPit.value.z, mist: uniforms.uCfMist.value.z };
  const height = new THREE.Vector2();
  function setQuality(quality: ArenaQuality) {
    // the shafts march the view ray: none on the low tier, more steps on the high one. Switched by uniforms alone.
    const tier = tierOf(quality);
    uniforms.uCfShaft.value.y = tier === 2 ? 8 : 4;
    uniforms.uCfShaft.value.x = tier === 0 ? 0 : strength.shafts;
    uniforms.uCfMist.value.w = tier === 0 ? 0 : strength.wisps;
    uniforms.uCfPit.value.z = tier === 0 ? 0 : strength.pit;
    uniforms.uCfMist.value.z = tier === 0 ? 0 : strength.mist;
    geometry.setDrawRange(0, tier === 2 ? MOST : tier === 1 ? 700 : 320);
    physics.setQuality(quality);
    raised.setTier(tier);
  }
  setQuality(context.quality());

  return {
    grade, uniforms, ashUniforms, ash, strength, setQuality, physics, raised,
    /** What it made that holds GPU memory, for a check that dispose() frees it all. */
    owned: [noise, geometry, material, raised.geometry, raised.material] as { addEventListener(type: "dispose", listener: () => void): void }[],
    update(time: number) {
      // the wind and the match's impulses first: the ash, the raised ash and the mist below all read them this frame
      physics.update(time);
      uniforms.uCfAirTime.value = time;
      ashUniforms.uTime.value = time;
      context.renderer.getDrawingBufferSize(height);
      ashUniforms.uScale.value = height.y / (2 * Math.tan(THREE.MathUtils.degToRad(context.camera.fov / 2)));
      raised.update(ashUniforms.uScale.value, ash.visible);
      raised.uniforms.uAmount.value = ashUniforms.uAmount.value;
    },
    dispose() {
      ash.removeFromParent();
      raised.dispose(); physics.dispose();
      geometry.dispose(); material.dispose(); noise.dispose();
    },
  };
}
