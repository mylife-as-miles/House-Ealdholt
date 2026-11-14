// Adapted from AbilityCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * A lightning strike, drawn: a channel and its forks as one ribbon that faces the eye. shared/lightningPlan.ts
 * solves the channel and says what the strike is doing; this draws it.
 *
 * The reference's bolt rebuilt its ribbon on the CPU every frame, to turn it to the camera. Here a vertex carries
 * its point and its two neighbours, and the vertex shader turns it, so the buffers are written only when a new
 * path is solved; the leader's head, the stroke's brightness, the forks and the swell of the return stroke are
 * uniforms. It is drawn twice, a wide soft halo under a hot core, because the lowest tier has no bloom.
 */
import * as THREE from "three";
import type { Channel } from "./lightningPlan";

export interface StrikeLook { core: number; glow: number }

export interface StrikeOptions {
  /** Points it has room for (lightningPlan.channelCapacity, or the sum for merged channels). */
  capacity: number;
  look: StrikeLook;
  /** Half the main channel's width on the return stroke, in scene units. */
  width: number;
  /** How many times wider the halo is than the core. */
  halo?: number;
  /** How much of the main channel's start fades in out of the air, 0..1: a strike out of nowhere has no hard end. */
  fadeIn?: number;
  order?: number;
}

const VERTEX = (halo: number) => /* glsl */ `
attribute vec3 aPrev, aNext;
attribute vec4 aInfo;
attribute vec2 aKind;
uniform float uWidth, uSwell, uPixel, uMinPixels;
varying float vSide, vAlong, vPlace, vBright, vFork;
void main() {
  vSide = aInfo.x; vAlong = aInfo.y; vPlace = aInfo.z; vBright = aKind.x; vFork = aKind.y;
  vec4 here = modelViewMatrix * vec4(position, 1.0);
  vec3 run = (modelViewMatrix * vec4(aNext, 1.0)).xyz - (modelViewMatrix * vec4(aPrev, 1.0)).xyz;
  vec3 square = dot(run, run) > 1e-12 ? cross(normalize(run), normalize(here.xyz)) : vec3(0.0);
  vec3 across = dot(square, square) > 1e-8 ? normalize(square) : vec3(1.0, 0.0, 0.0);
  // the channel narrows a little toward the mark; a fork tapers to nothing. The leader is a thread, the return
  // stroke a cord.
  float taper = aKind.y > 0.5 ? 1.0 - 0.9 * aInfo.z : 1.0 - 0.3 * aInfo.z;
  float width = uWidth * aInfo.w * taper * mix(0.45, 1.0, uSwell);
  width = max(width, uPixel * uMinPixels * 0.5 * -here.z);
  ${halo > 0 ? `width *= ${halo.toFixed(3)};` : ""}
  here.xyz += across * aInfo.x * width;
  gl_Position = projectionMatrix * here;
}
`;

const FRAGMENT = (halo: boolean) => /* glsl */ `
uniform vec3 uCoreColour, uGlowColour;
uniform float uHead, uBright, uForks, uFadeIn, uGain;
varying float vSide, vAlong, vPlace, vBright, vFork;
void main() {
  float across = 1.0 - abs(vSide);
  // lit behind the leader's head and dark ahead of it; the head itself burns hotter than what it has drawn
  float lit = 1.0 - smoothstep(uHead - 0.004, uHead + 0.004, vAlong);
  float fromHead = (vAlong - uHead) / 0.03;
  float head = uHead < 1.0 ? exp(-fromHead * fromHead) : 0.0;
  float level = mix(uBright, uForks * vBright, vFork);
  // a strike out of the air has no hard end: its start comes in out of nothing
  float fade = uFadeIn > 0.0 ? smoothstep(0.0, uFadeIn, vAlong) : 1.0;
${halo ? /* glsl */ `
  vec3 colour = uGlowColour * pow(across, 2.2) * 0.42 * (level + 2.0 * head * uBright);
` : /* glsl */ `
  float hot = pow(across, 3.0), soft = pow(across, 1.2);
  vec3 colour = mix(uGlowColour, uCoreColour, hot) * (soft * 0.55 + hot * 1.7) * level + uCoreColour * head * soft * 4.0 * uBright;
`}
  colour *= max(lit, head) * fade;
  if (max(max(colour.r, colour.g), colour.b) < 0.003) discard;
  gl_FragColor = vec4(colour * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class LightningStrike {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly capacity: number;
  private readonly buffers: { position: THREE.BufferAttribute; prev: THREE.BufferAttribute; next: THREE.BufferAttribute; info: THREE.BufferAttribute; kind: THREE.BufferAttribute; index: THREE.BufferAttribute };

  constructor(options: StrikeOptions) {
    this.capacity = options.capacity;
    const vertices = options.capacity * 2;
    this.uniforms = {
      uWidth: { value: options.width }, uSwell: { value: 0 }, uPixel: { value: 0.001 }, uMinPixels: { value: 1.3 },
      uHead: { value: 0 }, uBright: { value: 0 }, uForks: { value: 0 }, uFadeIn: { value: options.fadeIn ?? 0 }, uGain: { value: 1 },
      uCoreColour: { value: new THREE.Color(options.look.core) }, uGlowColour: { value: new THREE.Color(options.look.glow) },
    };
    this.buffers = {
      position: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3), prev: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3),
      next: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3), info: new THREE.BufferAttribute(new Float32Array(vertices * 4), 4),
      kind: new THREE.BufferAttribute(new Float32Array(vertices * 2), 2), index: new THREE.BufferAttribute(new Uint16Array(Math.max(1, options.capacity - 1) * 6), 1),
    };
    this.geometry.setAttribute("position", this.buffers.position); this.geometry.setAttribute("aPrev", this.buffers.prev); this.geometry.setAttribute("aNext", this.buffers.next);
    this.geometry.setAttribute("aInfo", this.buffers.info); this.geometry.setAttribute("aKind", this.buffers.kind);
    this.geometry.setIndex(this.buffers.index);
    this.geometry.setDrawRange(0, 0);
    const order = options.order ?? 14, halo = options.halo ?? 5;
    for (const pass of halo > 0 ? [true, false] : [false]) {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERTEX(pass ? halo : 0), fragmentShader: FRAGMENT(pass),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = pass ? order - 1 : order;
      this.object.add(mesh);
    }
    this.object.visible = false;
  }

  /** Lays a solved channel into the buffers. Called when a new path is found, not every frame. */
  setChannel(channel: Channel): void {
    const { position, prev, next, info, kind, index } = this.buffers;
    const points = channel.points;
    let at = 0;
    for (const strip of channel.strips) {
      if (strip.start + strip.count > this.capacity) break;
      for (let i = 0; i < strip.count; i += 1) {
        const here = (strip.start + i) * 3, before = (strip.start + Math.max(0, i - 1)) * 3, after = (strip.start + Math.min(strip.count - 1, i + 1)) * 3;
        const place = i / (strip.count - 1);
        // a fork is lit only once the leader has passed the point it leaves at
        const along = strip.fork ? strip.along + place * strip.span : place;
        for (const side of [-1, 1]) {
          const vertex = (strip.start + i) * 2 + (side < 0 ? 0 : 1);
          position.setXYZ(vertex, points[here], points[here + 1], points[here + 2]);
          prev.setXYZ(vertex, points[before], points[before + 1], points[before + 2]);
          next.setXYZ(vertex, points[after], points[after + 1], points[after + 2]);
          info.setXYZW(vertex, side, along, place, strip.width);
          kind.setXY(vertex, strip.bright, strip.fork ? 1 : 0);
        }
        if (i < strip.count - 1) {
          const a = (strip.start + i) * 2;
          (index.array as Uint16Array).set([a, a + 1, a + 2, a + 1, a + 3, a + 2], at);
          at += 6;
        }
      }
    }
    for (const buffer of [position, prev, next, info, kind, index]) buffer.needsUpdate = true;
    this.geometry.setDrawRange(0, at);
  }

  /** How far the leader has come, how bright the channel and its forks are, and how far the return stroke swells it. */
  set(state: { head: number; bright: number; forks: number; swell: number }, scale = 1): void {
    this.uniforms.uHead.value = state.head; this.uniforms.uBright.value = state.bright * scale;
    this.uniforms.uForks.value = state.forks * scale; this.uniforms.uSwell.value = state.swell;
    this.object.visible = state.bright * scale > 0.002 || state.forks * scale > 0.002;
  }
  setWidth(width: number): void { this.uniforms.uWidth.value = width; }
  setLook(look: StrikeLook): void { (this.uniforms.uCoreColour.value as THREE.Color).setHex(look.core); (this.uniforms.uGlowColour.value as THREE.Color).setHex(look.glow); }
  /** `gain` keeps its colour from clipping to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.uniforms.uGain.value = gain; }
  /** Fits it to the camera drawing it: `height` is the drawing buffer's height in pixels. */
  fit(camera: THREE.PerspectiveCamera, height: number): void {
    this.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, height);
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
