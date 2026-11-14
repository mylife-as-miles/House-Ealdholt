/**
 * What leaves the lava's surface: a glow in the air above it, spatter and sparks, bubbles that swell and burst in the
 * pools, smoke where a fall lands, and the shimmer of hot air (a warp in the look's final pass). arena-lava.ts says
 * where; this draws it, in four draw calls and a few hundred triangles.
 *
 * Nothing here keeps state from frame to frame: every particle's place is worked out in its vertex shader from the
 * look's clock, so a clock stopped at 0 (reduced motion) shows one still moment of it all.
 */
import * as THREE from "three";
import type { ArenaContext, ArenaGradeHook } from "./arena-kit";
import { seeded, type Vec3 } from "./arena-lava-geometry";
import { LAVA_GLOW_GLSL } from "./arena-lava-material";

export interface LavaEffectPlaces {
  /** Glow in the air: where (metres), how far across and how tall, and how strong (about 1). */
  halos: { position: Vec3; radius: number; height: number; strength: number }[];
  /** Where bubbles rise in open lava, and how big they get. */
  bubbles: { position: Vec3; radius: number }[];
  /** The feet of falls: lava spatters and smokes there. */
  splashes: { position: Vec3; halfWidth: number; strength: number }[];
  /** Places on fast lava that throw the odd spark, with the way the surface faces. */
  sparks: { position: Vec3; normal: Vec3 }[];
  /** Hot air: where, and how far across. */
  heat: { position: Vec3; radius: number; strength: number }[];
}

export interface LavaEffects {
  grade: ArenaGradeHook;
  update(time: number): void;
  setTier(tier: "low" | "medium" | "high"): void;
  setGain(gain: number): void;
  dispose(): void;
}

/** How many heat sources the final pass shimmers over at once: the strongest on screen. */
const HEAT_SLOTS = 6;
/** The glow's colour in the air, linear, at strength 1 and the look's default gain. */
const HALO = new THREE.Color(0.2, 0.052, 0.006);

/** One quad per item, its corners at (+-1, +-1) in `corner`; the other attributes are the same at all four. */
function quads(count: number, attributes: Record<string, { size: number; at(i: number): number[] }>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corner = new Float32Array(count * 8), index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  geometry.setAttribute("corner", new THREE.BufferAttribute(corner, 2));
  // the shaders place every vertex themselves; three.js only needs a position attribute to count vertices by
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 12), 3));
  for (const [name, { size, at }] of Object.entries(attributes)) {
    const data = new Float32Array(count * 4 * size);
    for (let i = 0; i < count; i++) { const value = at(i); for (let c = 0; c < 4; c++) data.set(value, (i * 4 + c) * size); }
    geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export function createLavaEffects(context: ArenaContext, places: LavaEffectPlaces, crust: THREE.Texture): LavaEffects {
  const { world, camera, renderer, fog } = context;
  const random = seeded(context.setting * 131 + 17);
  const between = (a: number, b: number) => a + (b - a) * random();
  const group = new THREE.Group();
  group.name = "arena-lava-effects";
  world.add(group);
  const shared = {
    uTime: { value: 0 }, uGain: { value: 1 },
    /** Board units in a metre: the effects are laid out in metres under the arena's scaled root. */
    uUnit: { value: world.scale.x },
    /** How far across one pixel of the picture is, at distance 1. */
    uPixel: { value: 0.001 },
  };
  const disposables: { dispose(): void }[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    // every vertex is placed by its shader, far from where three.js would think the mesh is
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.onBeforeRender = (active) => {
      const target = active.getRenderTarget();
      const height = target ? target.height : active.domElement.height;
      shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, height);
    };
    group.add(mesh);
    disposables.push(geometry, material);
    return mesh;
  };

  // --- glow in the air -----------------------------------------------------------------------------------------
  // A soft disc facing the camera at each stretch of lava, added to the picture. It stands in for the glare bloom
  // gives at high quality (and feeds that bloom). It is drawn a radius nearer the camera than the lava, so the rock
  // round the lava does not cut a hard line through it, while whatever stands in front of the lava still hides it.
  const halos = places.halos;
  // their size: smaller at the low tier, where blending a few large discs over each other is a real cost
  const haloSize = { value: 1 };
  if (halos.length) add(quads(halos.length, {
    aCentre: { size: 3, at: (i) => halos[i].position },
    aShape: { size: 4, at: (i) => [halos[i].radius, halos[i].height, halos[i].strength, i * 2.399] },
  }), new THREE.ShaderMaterial({
    uniforms: { ...shared, uColor: { value: HALO }, uSize: haloSize },
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 aCentre; attribute vec4 aShape;
      uniform float uTime, uUnit, uGain, uSize;
      varying vec2 vCorner; varying float vLevel;
      void main() {
        vec4 centre = modelViewMatrix * vec4(aCentre, 1.0);
        float away = length(centre.xyz), radius = aShape.x * uUnit * uSize;
        centre.xyz *= 1.0 - min(radius, 0.6 * away) / away;
        centre.xy += corner * vec2(radius, aShape.y * uUnit * uSize);
        gl_Position = projectionMatrix * centre;
        vCorner = corner;
        // the same slow swell as the lava's light on the rock (arena-lava.ts flickerAt)
        vLevel = aShape.z * uGain * (1.0 + 0.07 * sin(uTime * 0.63 + aShape.w) + 0.04 * sin(uTime * 1.9 + aShape.w * 2.7));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec2 vCorner; varying float vLevel;
      void main() {
        float fade = max(1.0 - dot(vCorner, vCorner), 0.0);
        gl_FragColor = vec4(uColor * vLevel * fade * fade * fade, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }), 20);

  // --- bubbles -------------------------------------------------------------------------------------------------
  // A dome that swells out of the lava and is gone: its skin is hottest on top, where it is stretched thinnest.
  // When it goes, the spatter below is thrown from the same place at the same moment.
  const bubbles = places.bubbles.map((bubble) => ({ ...bubble, phase: random(), period: between(5, 11), grow: between(1.3, 2.2) }));
  const dome = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const domePosition = dome.getAttribute("position"), domeIndex = dome.index!;
  const bubbleGeometry = new THREE.BufferGeometry();
  {
    const n = domePosition.count, position = new Float32Array(bubbles.length * n * 3), centre = new Float32Array(bubbles.length * n * 3);
    const seed = new Float32Array(bubbles.length * n * 4), index = new Uint16Array(bubbles.length * domeIndex.count);
    bubbles.forEach((bubble, b) => {
      for (let i = 0; i < n; i++) {
        position.set([domePosition.getX(i), domePosition.getY(i), domePosition.getZ(i)], (b * n + i) * 3);
        centre.set(bubble.position, (b * n + i) * 3);
        seed.set([bubble.phase, bubble.period, bubble.grow, bubble.radius], (b * n + i) * 4);
      }
      for (let i = 0; i < domeIndex.count; i++) index[b * domeIndex.count + i] = domeIndex.getX(i) + b * n;
    });
    bubbleGeometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    bubbleGeometry.setAttribute("aCentre", new THREE.BufferAttribute(centre, 3));
    bubbleGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    bubbleGeometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  dome.dispose();
  if (bubbles.length) add(bubbleGeometry, new THREE.ShaderMaterial({
    uniforms: { ...shared, ...fog.uniforms },
    vertexShader: /* glsl */ `
      attribute vec3 aCentre; attribute vec4 aSeed;
      uniform float uTime;
      varying float vUp, vGrown;
      ${fog.parsVertex}
      void main() {
        float age = fract(uTime / aSeed.y + aSeed.x) * aSeed.y, grown = clamp(age / aSeed.z, 0.0, 1.0);
        // it swells quickly at first, stands a moment, and is gone when it bursts
        float size = age < aSeed.z ? aSeed.w * sqrt(grown) : 0.0;
        vec3 transformed = aCentre + position * vec3(size, size * (0.25 + 0.45 * grown), size);
        ${fog.vertex}
        vUp = position.y; vGrown = grown;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain; varying float vUp, vGrown;
      ${fog.parsFragment}
      ${LAVA_GLOW_GLSL}
      void main() {
        gl_FragColor = vec4(lavaGlow(mix(0.5, 0.82, pow(vUp, 1.5) * vGrown)) * uGain, 1.0);
        ${fog.fragment}
      }`,
  }), 0);
  else bubbleGeometry.dispose();

  // --- spatter and sparks --------------------------------------------------------------------------------------
  // kind 0: a blob of lava thrown up, which falls back; 1: a spark, which drifts up and goes out; 2: the flash of a
  // bubble bursting. Each repeats on its own period.
  type Particle = { origin: Vec3; velocity: Vec3; seed: number[]; kind: number };
  const particles: Particle[] = [];
  const outward = (speed: number): Vec3 => { const a = random() * Math.PI * 2; return [Math.cos(a) * speed, 0, Math.sin(a) * speed]; };
  for (const splash of places.splashes) {
    for (let i = 0; i < Math.round(22 * splash.strength); i++) {
      const out = outward(between(0.4, 2.2)), at = outward(random() * splash.halfWidth);
      particles.push({ origin: [splash.position[0] + at[0], splash.position[1] + 0.05, splash.position[2] + at[2]],
                       velocity: [out[0], between(2.2, 5.2) * (0.6 + 0.4 * splash.strength), out[2]],
                       seed: [random(), between(1.5, 3.6), between(0.7, 1.2), between(0.05, 0.11)], kind: 0 });
    }
  }
  for (const bubble of bubbles) {
    // thrown as the bubble bursts: the same period, launched `grow` seconds into the bubble's cycle
    const phase = bubble.phase - bubble.grow / bubble.period;
    for (let i = 0; i < 5; i++) {
      const out = outward(between(0.3, 1.3));
      particles.push({ origin: [bubble.position[0], bubble.position[1] + 0.05, bubble.position[2]], velocity: [out[0], between(1.6, 3.6), out[2]],
                       seed: [phase, bubble.period, between(0.5, 0.95), between(0.035, 0.075)], kind: 0 });
    }
    particles.push({ origin: [bubble.position[0], bubble.position[1] + 0.08, bubble.position[2]], velocity: [0, 0, 0],
                     seed: [phase, bubble.period, 0.28, bubble.radius * 2.2], kind: 2 });
  }
  for (const spark of places.sparks) {
    const out = outward(between(0.1, 0.5));
    particles.push({ origin: spark.position, velocity: [out[0] + spark.normal[0] * 0.8, between(0.4, 1.1) + spark.normal[1] * 0.5, out[2] + spark.normal[2] * 0.8],
                     seed: [random(), between(3, 8), between(1.4, 2.8), between(0.025, 0.045)], kind: 1 });
  }
  // shuffled, so that drawing only the first of them (lower quality) thins every kind and place alike
  for (let i = particles.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [particles[i], particles[j]] = [particles[j], particles[i]]; }
  const sparkMesh = particles.length ? add(quads(particles.length, {
    aOrigin: { size: 3, at: (i) => particles[i].origin }, aVelocity: { size: 3, at: (i) => particles[i].velocity },
    aSeed: { size: 4, at: (i) => particles[i].seed }, aKind: { size: 1, at: (i) => [particles[i].kind] },
  }), new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 aOrigin, aVelocity; attribute vec4 aSeed; attribute float aKind;
      uniform float uTime, uUnit, uPixel;
      varying vec2 vCorner; varying float vHeat, vSoft;
      void main() {
        float age = fract(uTime / aSeed.y + aSeed.x) * aSeed.y, spent = age / aSeed.z;
        float blob = 1.0 - step(0.5, aKind), spark = step(0.5, aKind) * (1.0 - step(1.5, aKind)), flash = step(1.5, aKind);
        // metres a second squared: a blob falls, a spark is carried up by the hot air
        float pull = 9.8 * blob - 0.4 * spark;
        vec3 velocity = aVelocity - vec3(0.0, pull * age, 0.0);
        vec3 p = aOrigin + aVelocity * age - vec3(0.0, 0.5 * pull * age * age, 0.0);
        p.xz += spark * 0.22 * vec2(sin(age * 2.1 + aSeed.x * 40.0), cos(age * 1.7 + aSeed.x * 23.0));
        vec4 at = modelViewMatrix * vec4(p, 1.0);
        float size = aSeed.w * uUnit * mix(1.0 - 0.5 * spent, 0.4 + 0.6 * spent, flash);
        // never thinner than a pixel and a bit, or it twinkles in and out as it moves
        size = max(size, 1.3 * uPixel * -at.z);
        // a blob is drawn out along its path
        vec3 along = mat3(modelViewMatrix) * velocity;
        float pace = length(along.xy);
        vec2 dir = pace > 1e-5 ? along.xy / pace : vec2(0.0, 1.0);
        float drawn = 1.0 + blob * min(pace / uUnit * 0.07, 2.2);
        at.xy += (dir * corner.y * drawn + vec2(-dir.y, dir.x) * corner.x) * size * step(spent, 1.0);
        gl_Position = projectionMatrix * at;
        vCorner = corner;
        // it cools as it goes: yellow, orange, red, out
        vHeat = (1.0 - spent) * mix(1.0, 0.8, spark);
        vSoft = flash;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain; varying vec2 vCorner; varying float vHeat, vSoft;
      ${LAVA_GLOW_GLSL}
      void main() {
        float fade = max(1.0 - dot(vCorner, vCorner), 0.0);
        vec3 colour = lavaGlow(0.5 + 0.5 * vHeat) * mix(fade * fade * 1.4, fade * fade * fade * 0.5 * vHeat, vSoft);
        gl_FragColor = vec4(colour * uGain * smoothstep(0.0, 0.15, vHeat), 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }), 21) : null;

  // --- smoke where a fall lands --------------------------------------------------------------------------------
  // A few slow puffs over each foot, lit orange from below and dark above. Thin: the foot must show through.
  type Puff = { origin: Vec3; seed: number[] };
  const puffs: Puff[] = [];
  for (const splash of places.splashes) {
    if (splash.strength < 0.5) continue;
    for (let i = 0; i < 9; i++) {
      const at = outward(random() * (0.4 + splash.halfWidth));
      puffs.push({ origin: [splash.position[0] + at[0], splash.position[1] + 0.2, splash.position[2] + at[2]],
                   seed: [random(), between(5, 9), between(0.7, 1.2), random() * Math.PI * 2] });
    }
  }
  for (let i = puffs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [puffs[i], puffs[j]] = [puffs[j], puffs[i]]; }
  const smokeMesh = puffs.length ? add(quads(puffs.length, {
    aOrigin: { size: 3, at: (i) => puffs[i].origin }, aSeed: { size: 4, at: (i) => puffs[i].seed },
  }), new THREE.ShaderMaterial({
    uniforms: { ...shared, ...fog.uniforms, uCrust: { value: crust } },
    vertexShader: /* glsl */ `
      attribute vec2 corner; attribute vec3 aOrigin; attribute vec4 aSeed;
      uniform float uTime, uUnit;
      varying vec2 vCorner; varying float vSpent, vSeed;
      ${fog.parsVertex}
      void main() {
        float spent = fract(uTime / aSeed.y + aSeed.x);
        // up fast at first, slowing as it cools, and leaning a little its own way
        vec3 transformed = aOrigin + vec3(cos(aSeed.w), 0.0, sin(aSeed.w)) * (0.2 + 0.9 * spent * spent)
          + vec3(0.0, 5.0 * spent - 1.6 * spent * spent, 0.0);
        ${fog.vertex}
        vec4 at = modelViewMatrix * vec4(transformed, 1.0);
        at.xy += corner * aSeed.z * (0.45 + 1.7 * spent) * uUnit;
        gl_Position = projectionMatrix * at;
        vCorner = corner; vSpent = spent; vSeed = aSeed.x;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCrust; uniform float uTime, uGain;
      varying vec2 vCorner; varying float vSpent, vSeed;
      ${fog.parsFragment}
      ${LAVA_GLOW_GLSL}
      void main() {
        float wisp = texture2D(uCrust, vCorner * 0.13 + vec2(vSeed * 7.0, vSeed * 3.0 - uTime * 0.015)).a;
        float body = smoothstep(1.0, 0.2, length(vCorner) + (wisp - 0.5) * 0.9);
        float alpha = body * smoothstep(0.0, 0.1, vSpent) * (1.0 - vSpent) * (1.0 - vSpent) * 0.4;
        vec3 colour = mix(lavaGlow(0.6) * 0.3 * uGain, vec3(0.05, 0.043, 0.04), smoothstep(0.0, 0.4, vSpent));
        gl_FragColor = vec4(colour, alpha);
        ${fog.fragment}
      }`,
    transparent: true, depthWrite: false,
  }), 19) : null;

  // --- heat shimmer --------------------------------------------------------------------------------------------
  // In the look's final pass: the picture behind each of the hottest stretches on screen is nudged by a moving
  // ripple, most in a column above the lava. What stands nearer than the lava is left alone.
  const slots = Array.from({ length: HEAT_SLOTS }, () => new THREE.Vector4());
  const depths = Array.from({ length: HEAT_SLOTS }, () => new THREE.Vector2());
  const shimmer = { value: 0 };
  const grade: ArenaGradeHook = {
    uniforms: { uLavaHeat: { value: slots }, uLavaHeatDepth: { value: depths }, uLavaShimmer: shimmer, uLavaClock: shared.uTime },
    pars: /* glsl */ `
      uniform vec4 uLavaHeat[${HEAT_SLOTS}]; uniform vec2 uLavaHeatDepth[${HEAT_SLOTS}]; uniform float uLavaShimmer, uLavaClock;`,
    warp: /* glsl */ `
      if (uLavaShimmer > 0.0) {
        float lavaAir = 0.0, lavaNear = 1e6;
        for (int i = 0; i < ${HEAT_SLOTS}; i++) {
          // xy: the place on screen, z: its radius as a share of the screen's height, w: strength
          vec4 hot = uLavaHeat[i];
          if (hot.w <= 0.0) continue;
          vec2 from = (vUv - hot.xy) * vec2(uAspect, 1.0) / hot.z;
          from.y = from.y > 0.0 ? from.y * 0.4 : from.y * 1.6;
          float amount = max(1.0 - dot(from, from), 0.0);
          if (amount > 0.0) { lavaAir += amount * amount * hot.w; lavaNear = min(lavaNear, uLavaHeatDepth[i].x); }
        }
        if (lavaAir > 0.0 && viewZ(texture2D(tDepth, vUv).r) > lavaNear) {
          float rise = uLavaClock * 2.6;
          vec2 ripple = vec2(sin(vUv.y * 210.0 - rise * 2.1 + sin(vUv.x * 83.0 + rise) * 1.7),
                             sin(vUv.y * 137.0 - rise * 1.6 + vUv.x * 61.0));
          uv += ripple * vec2(1.0 / uAspect, 0.5) * min(lavaAir, 1.0) * 0.0019 * uLavaShimmer;
        }
      }`,
  };
  const heat = places.heat.map((source) => ({ ...source, world: new THREE.Vector3(), score: 0, uv: new THREE.Vector4(), depth: 0 }));
  const seen = new THREE.Vector3();
  const placeHeat = () => {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const source of heat) {
      source.world.set(...source.position).applyMatrix4(world.matrixWorld);
      seen.copy(source.world).applyMatrix4(camera.matrixWorldInverse);
      const depth = -seen.z, radius = (source.radius * world.scale.x) / Math.max(depth * 2 * tan, 1e-6);
      seen.applyMatrix4(camera.projectionMatrix);
      const onScreen = depth > camera.near && Math.abs(seen.x) < 1 + radius * 2 && Math.abs(seen.y) < 1 + radius * 4;
      // weaker far away, where the ripple would be finer than a pixel
      const strength = onScreen ? source.strength * Math.min(1, radius * 9) : 0;
      source.score = strength * radius;
      source.uv.set(seen.x * 0.5 + 0.5, seen.y * 0.5 + 0.5 + radius * 0.5, radius * 1.6, strength);
      source.depth = depth - source.radius * world.scale.x;
    }
    heat.sort((a, b) => b.score - a.score);
    for (let i = 0; i < HEAT_SLOTS; i++) {
      if (i < heat.length && heat[i].score > 0) { slots[i].copy(heat[i].uv); depths[i].set(heat[i].depth, 0); } else slots[i].set(0, 0, 1, 0);
    }
  };

  let tier: "low" | "medium" | "high" = "medium";
  return {
    grade,
    update(time) {
      shared.uTime.value = time;
      // no shimmer at low quality, nor with the clock stopped: a ripple that does not move is only a smear
      shimmer.value = tier === "low" || context.reducedMotion() ? 0 : 1;
      if (shimmer.value > 0) placeHeat();
    },
    setTier(next) {
      tier = next;
      const share = next === "high" ? 1 : next === "medium" ? 0.7 : 0.45;
      sparkMesh?.geometry.setDrawRange(0, Math.ceil(particles.length * share) * 6);
      // no smoke at the low tier: it is the faintest of the effects and the most pixels blended for it
      if (smokeMesh) smokeMesh.visible = next !== "low";
      haloSize.value = next === "low" ? 0.75 : 1;
    },
    setGain(gain) { shared.uGain.value = gain; },
    dispose() {
      world.remove(group);
      for (const item of disposables) item.dispose();
    },
  };
}
