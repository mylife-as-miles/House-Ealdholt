/**
 * The rest of the shadow army: ranks of soldiers standing back in the fog, drawn for next to nothing. Each is one
 * square turned about the up axis toward the eye, cut by arithmetic into a soldier's outline (a tall shako, a
 * greatcoat, a shouldered musket with its bayonet, or a cuirassier's sabre at the slope), near black, rimmed in
 * violet where the fog lights it, with two points of gold for eyes. They come up out of the fog with the army and
 * burn away with it. They are only ever far off and half hidden, which is all an outline has to survive.
 */
import * as THREE from "three";

export interface SilhouetteLook { body: number; rim: number; eyes: number; edge: number }

export interface Silhouette {
  x: number;
  z: number;
  /** How tall it stands, and which way its musket leans. */
  height: number;
  seed: number;
  /** When it has come up out of the fog, and when it begins to burn away. */
  rise: number;
  burn: number;
  /** 1 for a cuirassier's sabre, 0 for a musket. */
  sabre: number;
}

const VERTEX = /* glsl */ `
attribute vec4 aSpot;
attribute vec4 aLife;
uniform float uFloor, uTime;
varying vec2 vLocal;
varying float vSeed, vRise, vBurn, vSabre;
void main() {
  // aSpot: x, z, height, seed; aLife: rise, burn, sabre, unused
  float height = aSpot.z;
  vec3 base = vec3(aSpot.x, uFloor, aSpot.y);
  // turned about the up axis toward the eye only, so it stands on the stone however the camera looks
  vec3 eye = cameraPosition - base; eye.y = 0.0;
  vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), length(eye) > 1e-4 ? normalize(eye) : vec3(0.0, 0.0, 1.0)));
  // the outline is drawn in a frame a little wider than half its height, and a little taller than it
  vec2 local = vec2(position.x * 0.36, (position.y * 0.5 + 0.5) * 1.22);
  vLocal = local; vSeed = aSpot.w; vRise = aLife.x; vBurn = aLife.y; vSabre = aLife.z;
  vec3 at = base + across * local.x * height + vec3(0.0, local.y * height, 0.0);
  gl_Position = uTime >= aLife.x - 0.6 ? projectionMatrix * viewMatrix * vec4(at, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uBody, uRim, uEyes, uEdge;
uniform float uTime, uFog, uGain;
varying vec2 vLocal;
varying float vSeed, vRise, vBurn, vSabre;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float box(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float capsule(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
void main() {
  vec2 p = vLocal;
  float lean = (hash(vec2(vSeed, 3.0)) - 0.5) * 0.06;
  // the outline: legs, a greatcoat flaring a little at the skirt, shoulders, a head under a tall shako, the arms,
  // and a musket with its bayonet at the shoulder (or a sabre at the slope)
  float d = capsule(p, vec2(-0.06, 0.02), vec2(-0.05, 0.4), 0.035);
  d = min(d, capsule(p, vec2(0.06, 0.02), vec2(0.05, 0.4), 0.035));
  d = min(d, box(p, vec2(0.0, 0.52), vec2(0.115 - (p.y - 0.4) * 0.12, 0.17)));
  d = min(d, box(p, vec2(0.0, 0.72), vec2(0.14, 0.05)));
  d = min(d, length(p - vec2(0.0, 0.83)) - 0.062);
  d = min(d, box(p, vec2(0.0, 0.95), vec2(0.052 + (p.y - 0.9) * 0.12, 0.065)));
  d = min(d, capsule(p, vec2(-0.13, 0.73), vec2(-0.15, 0.46), 0.03));
  d = min(d, capsule(p, vec2(0.13, 0.73), vec2(0.15, 0.5), 0.03));
  vec2 butt = vec2(0.17, 0.42), tip = vec2(0.22 + lean, 1.06);
  float arm = vSabre > 0.5 ? capsule(p, vec2(0.15, 0.5), vec2(0.34, 0.95), 0.011) : min(capsule(p, butt, tip, 0.018), capsule(p, tip, tip + vec2(0.012, 0.14), 0.006));
  d = min(d, arm);
  // its edge is smoke, not a cut line
  float smoke = (noise(p * 24.0 + vec2(vSeed * 7.0, -uTime * 1.6)) - 0.5) * 0.03;
  float shape = 1.0 - smoothstep(-0.004, 0.012, d + smoke);
  // it comes up out of the fog from the feet, and burns away from the feet up
  float risen = clamp((uTime - (vRise - 0.6)) / 0.6, 0.0, 1.0);
  float up = p.y / 1.1;
  shape *= smoothstep(1.0 - risen, 1.0 - risen + 0.08, 1.0 - up);
  float burnt = clamp((uTime - vBurn) / 0.8, 0.0, 1.0);
  float field = mix(noise(p * 18.0 + vSeed * 13.0), up, 0.5);
  float edge = 0.0;
  if (burnt > 0.0) { if (field < burnt * 1.06) discard; edge = 1.0 - smoothstep(burnt * 1.06, burnt * 1.06 + 0.1, field); }
  // its feet are lost in the fog
  shape *= smoothstep(0.0, 0.22, p.y + 0.02 * noise(p * 9.0 + uTime));
  if (shape < 0.02) discard;
  // a faint rim only at its outer edge where the fog's light catches it, and two points of gold under the shako's peak
  float rim = smoothstep(-0.012, 0.004, d) * (1.0 - smoothstep(0.004, 0.012, d)) * 0.35;
  vec2 eyeL = vec2(-0.024, 0.845), eyeR = vec2(0.024, 0.845);
  float eyes = (exp(-dot(p - eyeL, p - eyeL) * 9000.0) + exp(-dot(p - eyeR, p - eyeR) * 9000.0)) * (0.7 + 0.3 * sin(uTime * 9.0 + vSeed * 40.0)) * risen;
  vec3 colour = uBody + uRim * rim * (0.2 + 0.5 * uFog) * uGain + uEyes * eyes * 3.0 * uGain + uEdge * edge * 3.0 * uGain;
  // half lost in the fog it stands in: denser toward its feet
  float veil = mix(0.45, 0.85, smoothstep(0.1, 0.7, p.y)) * (0.75 + 0.25 * (1.0 - uFog));
  gl_FragColor = vec4(colour, min(1.0, shape * veil + eyes));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SilhouetteRanks {
  readonly object: THREE.Mesh;
  readonly count: number;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(ranks: readonly Silhouette[], look: SilhouetteLook, floor: number) {
    this.count = ranks.length;
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const spots = new Float32Array(Math.max(1, ranks.length) * 4), lives = new Float32Array(Math.max(1, ranks.length) * 4);
    ranks.forEach((s, i) => { spots.set([s.x, s.z, s.height, s.seed], i * 4); lives.set([s.rise, s.burn, s.sabre, 0], i * 4); });
    this.geometry.setAttribute("aSpot", new THREE.InstancedBufferAttribute(spots, 4));
    this.geometry.setAttribute("aLife", new THREE.InstancedBufferAttribute(lives, 4));
    this.geometry.instanceCount = ranks.length;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFloor: { value: floor }, uTime: { value: 0 }, uFog: { value: 0 }, uGain: { value: 1 },
        uBody: { value: new THREE.Color(look.body) }, uRim: { value: new THREE.Color(look.rim) }, uEyes: { value: new THREE.Color(look.eyes) }, uEdge: { value: new THREE.Color(look.edge) },
      },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 7;
    this.object.visible = ranks.length > 0;
  }

  update(time: number, fog: number, shown: boolean): void {
    this.material.uniforms.uTime.value = time; this.material.uniforms.uFog.value = fog;
    this.object.visible = shown && this.count > 0;
  }

  setGain(gain: number): void { this.material.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose(); this.material.dispose();
  }
}
