/**
 * The sigils stamped where spells and summons strike (sigils.ts, glyphPlan.ts), drawn.
 *
 * A kingdom's sigil is one instanced draw: an instance per stroke, each a quad over the stroke's own reach in the sigil's
 * plane, shaded by its distance to the stroke's centre line (a straight stroke, or an arc of a circle or an ellipse; a dot
 * is a circle of no radius). So the strokes stay sharp at any size and nothing is rebuilt per frame: the pen, the flash,
 * the burning away, the plane facing the eye and the gain are uniforms. Every stroke has a crisp line and a soft glow of
 * its own, so the mark reads with no bloom; joined strokes overlap at their round caps, which are drawn dimmer so a
 * corner is a joint and not a bead.
 *
 * A few glyphs can be alive at once (a fixed set of slots); each kingdom's geometry is laid out once, when first stamped.
 */
import * as THREE from "three";
import type { VfxArmy } from "../wiring";
import type { FlourishLook } from "./flourishPlan";
import { GLYPH, glyphEnvelope, packSigil, type GlyphEnvelope, type GlyphPlane } from "./glyphPlan";
import { SIGILS } from "./sigils";

const VERTEX = /* glsl */ `
attribute vec4 aA, aB, aC, aD;
uniform vec3 uCentre, uRight, uUp;
uniform float uRadius, uScale, uHalo;
varying vec2 vLocal;
varying vec4 vA, vB, vC, vD;
varying float vHeight;
void main() {
  vA = aA; vB = aB; vC = aC; vD = aD;
  float wide = max(aB.y, aB.z) * uHalo;
  vec2 lo, hi;
  if (aB.x < 0.5) { lo = min(aA.xy, aA.zw) - vec2(wide); hi = max(aA.xy, aA.zw) + vec2(wide); }
  else {
    float c = cos(aB.w), s = sin(aB.w);
    vec2 reach = vec2(sqrt(aA.z * aA.z * c * c + aA.w * aA.w * s * s), sqrt(aA.z * aA.z * s * s + aA.w * aA.w * c * c)) + vec2(wide);
    lo = aA.xy - reach; hi = aA.xy + reach;
  }
  vLocal = mix(lo, hi, position.xy * 0.5 + 0.5);
  vec3 world = uCentre + (uRight * vLocal.x + uUp * vLocal.y) * uRadius * uScale;
  vHeight = world.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uCore, uEdge, uDeep;
uniform float uPen, uFlash, uGlow, uBurn, uGain, uTime, uFloor, uHalo;
varying vec2 vLocal;
varying vec4 vA, vB, vC, vD;
varying float vHeight;
float hash1(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash1(i), hash1(i + 1.0), f); }
void main() {
  vec2 p = vLocal;
  float d = 0.0, along = 0.0, capped = 1.0, haloed = 1.0;
  if (vB.x < 0.5) {
    vec2 a = vA.xy, ab = vA.zw - vA.xy;
    float len = max(length(ab), 1e-5), raw = dot(p - a, ab) / (len * len);
    along = clamp(raw, 0.0, 1.0);
    d = length(p - (a + ab * along));
    // an end joined to another straight stroke carries half the light within a stroke's width of it, its cap too: the
    // two meeting there make one stroke's light, not a bead. A free end keeps its round cap whole.
    // The halo reaches further, so its own share is taken over a longer run.
    float w0 = max(vB.y, vB.z), near = w0 * 1.6 / len, far = w0 * uHalo * 0.9 / len;
    capped = min(vD.z > 0.5 ? mix(0.5, 1.0, smoothstep(0.0, near, raw)) : 1.0, vD.w > 0.5 ? mix(0.5, 1.0, smoothstep(0.0, near, 1.0 - raw)) : 1.0);
    haloed = min(vD.z > 0.5 ? mix(0.5, 1.0, smoothstep(0.0, far, raw)) : 1.0, vD.w > 0.5 ? mix(0.5, 1.0, smoothstep(0.0, far, 1.0 - raw)) : 1.0);
  } else {
    vec2 q = p - vA.xy;
    float c = cos(vB.w), s = sin(vB.w);
    q = vec2(q.x * c + q.y * s, -q.x * s + q.y * c);
    vec2 r = vA.zw;
    if (r.x < 1e-4) { d = length(q); along = 0.0; }
    else {
      float from = vC.x, to = vC.y;
      float angle = from + mod(atan(q.y / r.y, q.x / r.x) - from, 6.2831853);
      if (angle <= to) {
        along = (angle - from) / max(to - from, 1e-5);
        vec2 n = q / r;
        float len = max(length(n), 1e-5);
        vec2 grad = (q / (r * r)) / len;
        d = abs(len - 1.0) / max(length(grad), 1e-5);
      } else {
        vec2 e0 = vec2(cos(from) * r.x, sin(from) * r.y), e1 = vec2(cos(to) * r.x, sin(to) * r.y);
        float d0 = length(q - e0), d1 = length(q - e1);
        d = min(d0, d1); along = d0 < d1 ? 0.0 : 1.0;
      }
    }
  }
  float w = max(mix(vB.y, vB.z, along), 1e-4);
  // the pen: drawn up to where its run has reached, with a hot head
  float run = clamp((uPen - vC.z) / max(vC.w - vC.z, 1e-4), 0.0, 1.0);
  if (run <= 0.0 || along > run + 0.002) discard;
  float h = (along - run) / 0.05;
  float head = run < 1.0 ? exp(-h * h) : 0.0;
  // burnt away: it breaks into dashes that go out one by one
  float dash = vnoise(along * (5.0 + 9.0 * vD.y) + vD.y * 37.0);
  float kept = 1.0 - smoothstep(dash - 0.12, dash + 0.12, uBurn * 1.18);
  // a live stroke (the spark across a gap) flickers
  float live = vD.x > 0.5 ? 0.5 + 0.5 * step(0.32, hash1(floor(uTime * 26.0) + vD.y * 91.0)) : 1.0;
  float ink = 1.0 - smoothstep(w * 0.5, w, d);
  float k = d / (w * uHalo);
  float halo = exp(-k * k * 3.0);
  float level = uGlow * kept * live;
  vec3 hot = mix(uEdge, uCore, 0.15 + 0.85 * uFlash);
  vec3 light = (hot * ink * capped * (0.8 + 1.6 * uFlash + 1.4 * head) + mix(uDeep, uEdge, 0.55) * halo * haloed * (0.34 + 0.5 * uFlash)) * level;
  float lift = smoothstep(uFloor, uFloor + 0.05, vHeight);
  light *= lift;
  float cover = ink * capped * 0.22 * level * lift;
  if (max(max(light.r, light.g), light.b) < 0.002) discard;
  gl_FragColor = vec4(light * uGain, cover);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Slot {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: Record<string, THREE.IUniform>;
  /** Seconds since it struck; negative while free. */
  age: number;
  live: boolean;
  /** Where it stands and how big it is. */
  centre: THREE.Vector3;
  radius: number;
}

export class GlyphBursts {
  readonly object = new THREE.Group();
  private readonly geometries = new Map<VfxArmy, THREE.InstancedBufferGeometry>();
  private readonly slots: Slot[] = [];
  private readonly quad = new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3);
  private readonly envelope: GlyphEnvelope = { pen: 0, flash: 0, glow: 0, burn: 0, scale: 1, done: false };
  private readonly toward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private gain = 1;

  constructor(private readonly floor: number, slots = 4) {
    this.object.name = "FlourishGlyphs";
    for (let i = 0; i < slots; i += 1) {
      const uniforms: Record<string, THREE.IUniform> = {
        uCentre: { value: new THREE.Vector3() }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
        uRadius: { value: GLYPH.radius }, uScale: { value: 1 }, uHalo: { value: 4 },
        uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() },
        uPen: { value: 0 }, uFlash: { value: 0 }, uGlow: { value: 0 }, uBurn: { value: 0 }, uGain: { value: 1 }, uTime: { value: 0 }, uFloor: { value: floor },
      };
      const material = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
      mesh.name = `FlourishGlyph${i}`;
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false; mesh.renderOrder = 13;
      this.object.add(mesh);
      this.slots.push({ mesh, material, uniforms, age: -1, live: false, centre: new THREE.Vector3(), radius: GLYPH.radius });
    }
  }

  get active(): number { return this.slots.filter(slot => slot.live).length; }

  /**
   * Stamps `army`'s sigil at `centre` (glyphPlan.glyphCentre), `radius` across. The oldest glyph gives up its slot if
   * every slot is busy. Writes the plane it stands in now into `plane`, for its starburst.
   */
  stamp(army: VfxArmy, look: FlourishLook, centre: THREE.Vector3, radius: number, eye: THREE.Vector3, plane: GlyphPlane): void {
    const slot = this.slots.find(item => !item.live) ?? this.slots.reduce((a, b) => (a.age > b.age ? a : b));
    slot.mesh.geometry = this.geometryOf(army);
    slot.centre.copy(centre); slot.radius = radius; slot.age = 0; slot.live = true;
    (slot.uniforms.uCore.value as THREE.Color).setHex(look.core);
    (slot.uniforms.uEdge.value as THREE.Color).setHex(look.edge);
    (slot.uniforms.uDeep.value as THREE.Color).setHex(look.deep);
    slot.uniforms.uRadius.value = radius;
    this.face(slot, eye);
    this.apply(slot);
    const right = slot.uniforms.uRight.value as THREE.Vector3, up = slot.uniforms.uUp.value as THREE.Vector3;
    plane.centre.x = centre.x; plane.centre.y = centre.y; plane.centre.z = centre.z;
    plane.right.x = right.x; plane.right.y = right.y; plane.right.z = right.z;
    plane.up.x = up.x; plane.up.y = up.y; plane.up.z = up.z;
    plane.out.x = this.toward.x; plane.out.y = this.toward.y; plane.out.z = this.toward.z;
  }

  update(seconds: number, camera: THREE.Camera): void {
    for (const slot of this.slots) {
      if (!slot.live) continue;
      slot.age += Math.max(0, seconds);
      this.face(slot, camera.position);
      this.apply(slot);
    }
  }

  setGain(gain: number): void { this.gain = gain; for (const slot of this.slots) slot.uniforms.uGain.value = gain; }

  clear(): void {
    for (const slot of this.slots) { slot.live = false; slot.age = -1; slot.mesh.visible = false; }
  }

  dispose(): void {
    this.clear();
    this.object.removeFromParent();
    for (const slot of this.slots) { slot.material.dispose(); slot.mesh.geometry.dispose(); }
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }

  /** Upright, facing the eye: its up is the world's, leant only as far as the eye looks down on it. */
  private face(slot: Slot, eye: THREE.Vector3): void {
    this.toward.subVectors(eye, slot.centre);
    if (this.toward.lengthSq() < 1e-8) this.toward.set(0, 0, 1);
    this.toward.normalize();
    this.right.crossVectors(this.worldUp, this.toward);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.crossVectors(this.toward, this.right).normalize();
    (slot.uniforms.uRight.value as THREE.Vector3).copy(this.right);
    (slot.uniforms.uUp.value as THREE.Vector3).copy(this.up);
    (slot.uniforms.uCentre.value as THREE.Vector3).copy(slot.centre);
  }

  private apply(slot: Slot): void {
    const e = glyphEnvelope(slot.age, this.envelope);
    if (e.done) { slot.live = false; slot.age = -1; slot.mesh.visible = false; return; }
    slot.uniforms.uPen.value = e.pen; slot.uniforms.uFlash.value = e.flash; slot.uniforms.uGlow.value = e.glow;
    slot.uniforms.uBurn.value = e.burn; slot.uniforms.uScale.value = e.scale; slot.uniforms.uTime.value = slot.age;
    slot.uniforms.uGain.value = this.gain;
    slot.mesh.visible = e.glow > 0.001;
  }

  private geometryOf(army: VfxArmy): THREE.InstancedBufferGeometry {
    const known = this.geometries.get(army);
    if (known) return known;
    const packed = packSigil(SIGILS[army]);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", this.quad);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute("aA", new THREE.InstancedBufferAttribute(packed.a, 4));
    geometry.setAttribute("aB", new THREE.InstancedBufferAttribute(packed.b, 4));
    geometry.setAttribute("aC", new THREE.InstancedBufferAttribute(packed.c, 4));
    geometry.setAttribute("aD", new THREE.InstancedBufferAttribute(packed.d, 4));
    geometry.instanceCount = packed.count;
    this.geometries.set(army, geometry);
    return geometry;
  }
}
