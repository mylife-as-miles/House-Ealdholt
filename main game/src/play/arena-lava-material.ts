/** The lava's surface: the one material every lava mesh shares, and the crust texture it reads (arena-lava-crust.ts).
 * The meshes differ only in what arena-lava-geometry.ts wrote into their vertices. */
import * as THREE from "three";
import type { ArenaFog } from "./arena-kit";
import { CRUST_REACH, growCrust } from "./arena-lava-crust";
import type { LavaSurface } from "./arena-lava-geometry";

/** The colour lava glows at a temperature from 0 (cold) to 1 (yellow hot): linear, before the look's gain. Like a
 * black body it climbs steeply, red first, then green, then blue: dull red at 0.3, orange at 0.75. */
export const LAVA_GLOW_GLSL = /* glsl */ `
vec3 lavaGlow(float t) {
  t = clamp(t, 1e-4, 1.25);
  return vec3(3.4 * pow(t, 2.2), 1.5 * pow(t, 4.2), 0.5 * pow(t, 8.0));
}`;
export function lavaGlow(t: number, target = new THREE.Color()): THREE.Color {
  const x = Math.min(1.25, Math.max(1e-4, t));
  return target.setRGB(3.4 * Math.pow(x, 2.2), 1.5 * Math.pow(x, 4.2), 0.5 * Math.pow(x, 8));
}

/** One tile of the crust texture covers this many metres of pattern. */
export const CRUST_TILE = 5.5;

export function createCrustTexture(renderer: THREE.WebGLRenderer): THREE.DataTexture {
  const { size, data } = growCrust();
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // the lava is mostly seen at a low angle; without this its cracks blur away a few metres out
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The light a level surface gets from the sky: the panorama's upper half averaged by how squarely each part of it
 * shines down. Worked out once from the panorama's own pixels; the eclipse's corona is capped so that a few pixels do
 * not decide it.
 */
export function skyLight(panorama: THREE.Texture, target = new THREE.Color()): THREE.Color {
  const image = panorama.image as { data?: ArrayLike<number>; width: number; height: number } | undefined;
  if (!image?.data) return target.setRGB(0.12, 0.08, 0.06);
  const { data, width, height } = image, channels = data.length / (width * height);
  const half = data instanceof Uint16Array;
  const sum = [0, 0, 0];
  let total = 0;
  // rows run from straight down to straight up (see PANO_GLSL in battlefield-look.ts); the upper half is the sky
  for (let j = 0; j < 24; j++) {
    const elevation = ((j + 0.5) / 24) * (Math.PI / 2), row = Math.min(height - 1, Math.floor((0.5 + elevation / Math.PI) * height));
    const weight = Math.sin(elevation) * Math.cos(elevation);
    for (let i = 0; i < 48; i++) {
      const at = (row * width + Math.floor(((i + 0.5) / 48) * width)) * channels;
      for (let c = 0; c < 3; c++) sum[c] += weight * Math.min(4, half ? THREE.DataUtils.fromHalfFloat(data[at + c]) : data[at + c]);
      total += weight;
    }
  }
  return target.setRGB(sum[0] / total, sum[1] / total, sum[2] / total);
}

export interface LavaUniforms {
  uTime: THREE.IUniform<number>;
  /** The look's brightness for lava, 1 at its default. */
  uGain: THREE.IUniform<number>;
  /** 0 at low quality: no sheen of the sky on the crust. */
  uDetail: THREE.IUniform<number>;
  /** How much of the sky's light the crust gets. */
  uSky: THREE.IUniform<number>;
  /** The sky's light on a level surface (skyLight). */
  uSkyLight: THREE.IUniform<THREE.Color>;
  /** 1 for the abyss: lava seen from far above (see the shader). */
  uDeep: THREE.IUniform<number>;
  [name: string]: THREE.IUniform;
}

export function createLavaMaterial(fog: ArenaFog, crust: THREE.Texture, setting: 1 | 2): THREE.ShaderMaterial & { uniforms: LavaUniforms } {
  const uniforms = {
    ...fog.uniforms,
    uTime: { value: 0 }, uGain: { value: 1 }, uDetail: { value: 1 }, uSky: { value: setting === 2 ? 6 : 5 },
    uSkyLight: { value: new THREE.Color(0.12, 0.08, 0.06) }, uDeep: { value: 0 },
    uCrust: { value: crust }, uTile: { value: 1 / CRUST_TILE },
    // the shore's cooled margin, metres
    uShore: { value: 0.7 },
  };
  const material = new THREE.ShaderMaterial({
    name: "CF_Lava",
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aPattern; attribute vec3 aFlow; attribute vec4 aState;
      uniform float uTime;
      varying vec2 vPattern; varying vec3 vFlow; varying vec4 vState; varying vec3 vNormal; varying vec3 vView;
      ${fog.parsVertex}
      void main() {
        vec3 transformed = position;
        // a fall's surface is lumpy, and the lumps go down with the lava
        float along = (aPattern.y - uTime * aFlow.y) * aFlow.z;
        transformed += normal * aState.z * (0.05 * sin(along * 31.0 + aPattern.x * 2.3) + 0.035 * sin(along * 53.0 - aPattern.x * 4.1));
        vec4 world = modelMatrix * vec4(transformed, 1.0);
        ${fog.vertex}
        vPattern = aPattern; vFlow = aFlow; vState = aState;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCrust;
      uniform float uTime, uTile, uGain, uDetail, uSky, uShore, uDeep;
      uniform vec3 uSkyLight;
      varying vec2 vPattern; varying vec3 vFlow; varying vec4 vState; varying vec3 vNormal; varying vec3 vView;
      ${fog.parsFragment}
      ${LAVA_GLOW_GLSL}
      // seconds a pool's crust is carried before it is put back
      const float PERIOD = 14.0;
      vec2 jump(float n) { return fract(sin(vec2(n, n + 7.31) * vec2(12.9898, 78.233)) * 43758.5453); }
      void main() {
        float heat = vState.x, shore = vState.y, fall = vState.z, fresh = vState.w, scroll = vFlow.z;
        // a pool's disc reaches past what holds its lava (arena-lava-ground.ts); nothing is drawn there
        if (shore < 0.0) discard;
        // a river's crust scrolls with it for ever
        vec2 moved = vPattern - vFlow.xy * uTime * scroll;
        // a wide, slow variation: where the crust is thick and where thin
        float wide = texture2D(uCrust, moved * uTile * 0.19 + 0.37).a;
        // A pool's crust (and the abyss's) drifts every which way, so it cannot scroll. It is carried along for PERIOD
        // seconds in two copies half a period apart; each fades out before it is put back where it started, somewhere
        // else on the texture. The two are blended as distances to a crack, so a crack closes as its copy fades and
        // others open: the crust re-melts and cracks anew. The phase varies from place to place (by "wide") so
        // that the whole pool does not do this at once.
        float phase = uTime / PERIOD + wide * 0.6;
        float f0 = fract(phase), f1 = fract(phase + 0.5), still = 1.0 - scroll;
        vec2 at0 = (moved - vFlow.xy * (f0 - 0.5) * PERIOD * still) * uTile + jump(floor(phase)) * still;
        vec2 at1 = (moved - vFlow.xy * (f1 - 0.5) * PERIOD * still) * uTile + jump(floor(phase + 0.5) + 17.0) * still;
        vec4 crust = mix(texture2D(uCrust, at0), texture2D(uCrust, at1), abs(2.0 * f0 - 1.0) * still);
        // texels to the nearest crack: any crack, and the wide early ones
        float dAll = crust.r * crust.r * ${CRUST_REACH[0].toFixed(1)}, dMajor = crust.g * crust.g * ${CRUST_REACH[1].toFixed(1)};

        // heat here: the mesh's, less toward the shore (along an uneven line, so the mesh's outline does not show),
        // more where fresh lava wells up or lands
        float margin = uShore * (1.0 - 0.6 * fall);
        float bank = smoothstep(0.0, margin, shore + ((wide - 0.5) * 1.1 + (crust.a - 0.5) * 0.4) * margin);
        float h = heat * mix(0.1, 1.0, bank) * mix(0.45, 1.1, smoothstep(0.3, 0.65, wide));
        h = mix(h, max(h, 1.15), fresh);

        // hot crust is thin: its fine cracks open too, and every crack is wider; hotter still and only rafts are left
        float d = mix(dMajor, dAll, smoothstep(0.4, 0.95, h));
        float width = 0.5 + 2.0 * h * h + 7.0 * smoothstep(0.85, 1.3, h);
        float soft = 0.5 + fwidth(d);
        float molten = 1.0 - smoothstep(width - soft, width + soft, d);
        // where lava wells up or lands it is stirred open in patches of its own, whatever the crust's cracks
        molten = max(molten, smoothstep(0.45, 0.8, fresh + (crust.a - 0.5) * 0.6));

        // temperature: open lava by the heat; the crust glows dull red where it is thin, next to a crack. A fall
        // has no crust to speak of: what is not open lava there is lava a little cooler
        float open = 0.45 + 0.34 * min(h, 1.2);
        float thin = exp(-max(d - width, 0.0) / (2.0 + 5.0 * h)) * (0.5 + 0.5 * crust.b);
        float t = max(open * molten * (0.62 + 0.52 * crust.a) * (0.86 + 0.14 * crust.b) * (0.85 + 0.25 * fresh),
                      open * 0.62 * thin * min(h * 1.6, 1.0));
        t = min(max(t, fall * open * (0.42 + 0.3 * crust.b + 0.35 * crust.a)), 0.93);
        // The abyss is seen from ten metres and more above, where its cracks are finer than a pixel and filtering
        // leaves only the crust between them. Its crust glows dull red all over instead, more near a crack and
        // where it is hotter, as a lava lake does at night.
        t = max(t, uDeep * mix(0.2, 0.3, min(h, 1.0)) * (0.75 + 0.5 * crust.a) * (0.75 + 0.25 * thin));
        t *= 0.94 + 0.06 * sin(uTime * 0.9 + crust.b * 43.0);

        // the crust is rough dark rock, each plate its own shade and darker where it sags to its cracks. It takes a
        // little of the sky's light and of the lava's beside it; and at a low angle its glassy skin shows a little
        // of the sky low down behind it (never the sky overhead: the panorama's pole is no place to read a colour)
        vec3 n = normalize(vNormal), v = normalize(vView);
        float solid = (1.0 - molten) * (1.0 - fall);
        vec3 rock = mix(vec3(0.034, 0.028, 0.024), vec3(0.095, 0.078, 0.064), crust.b * 0.6 + crust.a * 0.4)
          * mix(0.55, 1.0, smoothstep(0.0, 3.0, d - width));
        vec3 lit = rock * uSkyLight * uSky * (0.4 + 0.6 * max(n.y, 0.0));
        if (uDetail > 0.5) {
          vec3 r = reflect(-v, n);
          r.y = clamp(abs(r.y), 0.03, 0.35);
          lit += textureLod(uFogMap, panoUv(normalize(r)), 6.5).rgb * (0.001 + 0.012 * pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 3.0)) * (0.5 + crust.b);
        }
        lit += rock * lavaGlow(open) * 0.6 * thin;
        gl_FragColor = vec4(lavaGlow(t) * uGain + solid * lit, 1.0);
        ${fog.fragment}
      }`,
  });
  return material as THREE.ShaderMaterial & { uniforms: LavaUniforms };
}

/** A surface as a BufferGeometry. `toLocal` takes the surface's metres into the mesh's own space. */
export function surfaceGeometry(surface: LavaSurface, toLocal: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(surface.positions, 3), normal = new THREE.BufferAttribute(surface.normals, 3);
  position.applyMatrix4(toLocal);
  normal.transformDirection(toLocal);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setAttribute("aPattern", new THREE.BufferAttribute(surface.pattern, 2));
  geometry.setAttribute("aFlow", new THREE.BufferAttribute(surface.flow, 3));
  geometry.setAttribute("aState", new THREE.BufferAttribute(surface.state, 4));
  geometry.setIndex(new THREE.BufferAttribute(surface.index, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
