/**
 * The gaslit fog that pours out of Korvenia's seal and lies over the board: two thin sheets of moving noise laid
 * on the stone, one a hand's breadth above the other so they slide against each other as the eye moves, spreading
 * out from the seal as it opens and thinning away when it closes. Warm where the gaslight near the seal falls on
 * it, an inky violet beyond, so the shadows stand on darkness. Seen low along the board it thickens, as fog does when the eye looks through more
 * of it. Ground fog, not cloud: the soldiers stand in it to the shin, and nothing above the knee is lost in it.
 */
import * as THREE from "three";

/** Its two tones and the gaslight's colour, as hex; `cover`, the most of the stone one sheet of it hides (0..1). */
export interface FogLook { fog: number; deep: number; gaslight: number; cover: number }

const VERTEX = /* glsl */ `
uniform vec3 uMiddle;
uniform float uSize, uLift;
varying vec3 vWorld;
void main() {
  vec3 at = uMiddle + vec3(position.x * uSize, uLift, -position.y * uSize);
  vWorld = at;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSeal, uMiddle, uFog, uDeep, uGaslight;
uniform float uTime, uSpread, uDensity, uFlicker, uSize, uLayer, uGain, uCover;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.03 + 17.0) * 0.3 + noise(p * 4.1 - 9.0) * 0.2; }
void main() {
  vec2 p = vWorld.xz, fromSeal = p - uSeal.xz;
  float d = length(fromSeal);
  // it pours outward from the seal: the edge of what has poured is ragged
  float edge = uSpread * (0.82 + 0.3 * noise(vec2(atan(fromSeal.y, fromSeal.x) * 2.5 + uLayer * 3.0, uTime * 0.2)));
  float reach = 1.0 - smoothstep(edge * 0.7, edge, d);
  // rolling out from the seal and drifting, each layer its own way
  vec2 flow = fromSeal / max(d, 1e-3) * uTime * (0.28 + 0.1 * uLayer);
  float n = fbm((p - flow) * (1.1 + 0.4 * uLayer) + vec2(uTime * 0.06, -uTime * 0.04) + uLayer * 7.3);
  float density = smoothstep(0.32, 0.78, n) * reach * uDensity;
  // seen low along the board the eye looks through more of it
  vec3 eye = normalize(cameraPosition - vWorld);
  density *= clamp(0.45 / max(abs(eye.y), 0.05), 1.0, 2.6);
  // and it thins toward the edge of the sheet it is drawn on
  density *= 1.0 - smoothstep(0.75, 1.0, length(p - uMiddle.xz) / uSize);
  float alpha = min(uCover, density * (uLayer > 0.5 ? 0.38 : 0.6));
  if (alpha < 0.004) discard;
  // warm where the gaslight near the seal falls on it, cold beyond. It is drawn unlit, so an arena shown at a high
  // exposure would lift its own tones pale: they are held to the rite's gain, as the gaslight is
  float lamp = exp(-d * d * 0.45) * uFlicker;
  vec3 colour = (mix(uDeep, uFog, 0.35 + 0.65 * n) + uGaslight * lamp * 0.55) * uGain;
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class GroundFog {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly uniforms: Record<string, THREE.IUniform>[] = [];

  /** `seal` is where it pours from; it is drawn on a sheet `size` across each way round `middle`. */
  constructor(seal: { x: number; y: number; z: number }, middle: { x: number; y: number; z: number }, size: number, look: FogLook) {
    for (const layer of [0, 1]) {
      const uniforms: Record<string, THREE.IUniform> = {
        uSeal: { value: new THREE.Vector3(seal.x, seal.y, seal.z) }, uMiddle: { value: new THREE.Vector3(middle.x, middle.y, middle.z) }, uSize: { value: size },
        uLift: { value: layer === 0 ? 0.05 : 0.2 }, uLayer: { value: layer }, uTime: { value: 0 }, uSpread: { value: 0 }, uDensity: { value: 0 }, uFlicker: { value: 1 }, uGain: { value: 1 }, uCover: { value: look.cover },
        uFog: { value: new THREE.Color(look.fog) }, uDeep: { value: new THREE.Color(look.deep) }, uGaslight: { value: new THREE.Color(look.gaslight) },
      };
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      this.uniforms.push(uniforms); this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = 8 + layer;
      this.object.add(mesh);
    }
  }

  /** How far it has poured from the seal, how thick it lies (0..1), and the gaslight's flicker. */
  set(time: number, spread: number, density: number, flicker: number): void {
    for (const u of this.uniforms) { u.uTime.value = time; u.uSpread.value = spread; u.uDensity.value = density; u.uFlicker.value = flicker; }
    this.object.visible = density > 0.003 && spread > 0.01;
  }

  setGain(gain: number): void { for (const u of this.uniforms) u.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
