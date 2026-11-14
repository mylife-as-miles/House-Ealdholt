// Night light for the Stair: soft additive star sprites for the lamps (a spiral of warm points
// visible from across the basin) and the cold light leaking through the door at the top
// (a sliver in the gap, a glow on the jamb reveal and a blade of light laid on the platform).
// Invisible by day. All animation in the shaders.

import * as THREE from 'crownfall-world-three';

const SPRITE_VERT = /* glsl */ `
attribute vec4 aInfo; // world size (m), brightness, seed, kind (0 lamp, 1 door)
uniform float uPxScale;
uniform vec4 uAtmoTime;
varying float vB;
varying float vKind;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float d = max(1.0, -mvPosition.z);
  float px = aInfo.x * uPxScale / d;
  gl_PointSize = clamp(px, 2.4, 90.0);
  float t = uAtmoTime.x;
  float night = uAtmoTime.y;
  float fl = aInfo.w > 0.5
    ? 0.9 + 0.1 * sin(t * 0.21 + aInfo.z * 6.0)
    : 0.8 + 0.2 * sin(t * (1.1 + aInfo.z * 1.3) + aInfo.z * 40.0) * sin(t * 2.7 + aInfo.z * 13.0);
  vB = aInfo.y * fl * night * night * (0.5 + 0.5 * clamp(px / 2.4, 0.0, 1.0));
  // up close the lamp body itself carries the light: fade the sprite out
  vB *= smoothstep(12.0, 60.0, d);
  vKind = aInfo.w;
  #include <fog_vertex>
}
`;

const SPRITE_FRAG = /* glsl */ `
varying float vB;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float core = exp(-r * r * 8.0);
  float halo = (1.0 - r) * (1.0 - r) * 0.3;
  vec3 warm = mix(vec3(1.0, 0.58, 0.26), vec3(1.0, 0.8, 0.5), core);
  vec3 cold = mix(vec3(0.62, 0.86, 1.0), vec3(0.92, 0.98, 1.0), core);
  vec3 col = mix(warm, cold, vKind) * (core * 2.4 + halo) * vB;
  #ifdef USE_FOG
    vec4 f = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    col *= 1.0 - f.a * 0.9;
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

/** points: [{ p: [x,y,z], size, b, kind }] */
export function buildSprites(ctx, points, rng) {
  const n = points.length;
  const pos = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  points.forEach((l, i) => {
    pos.set(l.p, i * 3);
    info.set([l.size, l.b, rng(), l.kind || 0], i * 4);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.computeBoundingSphere();
  const uniforms = { ...ctx.fogUniforms(), uPxScale: { value: 500 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const setScale = () => {
    const h = ctx.renderer.domElement.height || window.innerHeight;
    uniforms.uPxScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2));
  };
  setScale();
  ctx.onResize?.(setScale);
  const pts = new THREE.Points(g, mat);
  pts.name = 'stair:lamps';
  pts.renderOrder = 2;
  pts.matrixAutoUpdate = false;
  let lastFov = ctx.camera.fov;
  return {
    object: pts,
    update() {
      if (ctx.camera.fov !== lastFov) {
        lastFov = ctx.camera.fov;
        setScale();
      }
    },
  };
}

// Door light: additive quads; vertex colour = tint * intensity, uv.x across (0..1 soft edges),
// uv.y along the fall-off (0 at the source).
const DOOR_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vCol = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DOOR_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_fragment>
void main() {
  float night = 0.0;
  float t = 0.0;
  #ifdef USE_FOG
    night = uAtmoTime.y;
    t = uAtmoTime.x;
  #endif
  float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float fall = exp(-vUv.y * 2.6);
  float breathe = 0.86 + 0.14 * sin(t * 0.17) * sin(t * 0.061 + 1.3);
  // a whisper of it at dusk, full after dark
  float k = smoothstep(0.05, 0.8, night) * breathe;
  vec3 col = uLight * vCol * edge * fall * k;
  #ifdef USE_FOG
    vec4 f = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    col *= 1.0 - f.a * 0.92;
  #endif
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createDoorLightMaterial(ctx, color = '#cfeeff') {
  const c = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms(), uLight: { value: new THREE.Vector3(c.r, c.g, c.b) } },
    vertexShader: DOOR_VERT,
    fragmentShader: DOOR_FRAG,
    vertexColors: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/**
 * Additive quad for the door light: corners a,b (source edge) → c,d (far edge), uv.x across,
 * uv.y along. Intensity baked into the colour attribute.
 */
export class LightQuads {
  constructor() {
    this.p = [];
    this.uv = [];
    this.c = [];
    this.i = [];
    this.v = 0;
  }

  quad(a, b, c, d, intensity, uvAlong = [0, 1], face = null) {
    const i0 = this.v;
    if (face) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * face[0] + ny * face[1] + nz * face[2] < 0) {
        // mirror the winding, keep the uv layout (a,b along the source edge)
        this.p.push(...b, ...a, ...d, ...c);
        this.uv.push(1, uvAlong[0], 0, uvAlong[0], 0, uvAlong[1], 1, uvAlong[1]);
        for (let k = 0; k < 4; k++) this.c.push(intensity, intensity, intensity);
        this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
        this.v += 4;
        return;
      }
    }
    this.p.push(...a, ...b, ...c, ...d);
    this.uv.push(0, uvAlong[0], 1, uvAlong[0], 1, uvAlong[1], 0, uvAlong[1]);
    for (let k = 0; k < 4; k++) this.c.push(intensity, intensity, intensity);
    this.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    this.v += 4;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
