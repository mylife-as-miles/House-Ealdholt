/**
 * Wounds on a moving body, and the blood left on a weapon.
 *
 * Since Milestone 03 a wound is painted into the defender's own wound mask
 * (WoundMasks.ts) wherever the figure can wear one; what is here is then only
 * the fallback for the wound (no renderer, a figure without UVs), and still
 * every mark on the weapon and the killer. A fallback wound is a small decal
 * quad parented to the defender's anchor bone at the contact point, so it
 * travels with the body through the stagger, the fall and the banishing, and
 * leaves the scene with it, or a skin-bound decal (SurfaceDecals.ts). A weapon
 * stain is a small camera-facing smear parented to the weapon socket.
 *
 * Every mark shares one geometry and one material; the pool of meshes is
 * allocated once. The shapes are procedural, seeded per wound: a dark slit, a
 * soaked irregular halo, and blood that runs down from it over `bleed` seconds.
 */
import * as THREE from "three";

/** wound: on the defender. weapon: anything on the attacker's side (smear, splash decals), released together. */
export type MarkKind = "wound" | "weapon";

interface Mark {
  mesh: THREE.Mesh;
  impactId: string;
  kind: MarkKind;
  shape: number;
  birth: number;
  bleed: number;
  size: number;
  /** Clock time at which it starts to fade out; -1: stays. */
  fadeAt: number;
  serial: number;
  live: boolean;
  /** 0: wound, > 0: billboard smear size, -1: projected splash. */
  form: number;
  /** An adopted decal mesh: its geometry was built for this impact and is disposed with it. */
  owned: boolean;
}

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform vec4 uMark; // shape, age, bleed, form (0: wound, > 0: camera-facing smear of that size, < 0: projected splash)
varying vec2 vUv;
void main() {
  // A wound's box hangs below its centre: room for the blood to run.
  vUv = uMark.w < 0.0 ? uv * 2.0 - 1.0 : vec2(uv.x * 2.0 - 1.0, uv.y * 4.0 - 3.0);
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  if (uMark.w > 0.0) {
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centre.xy += position.xy * uMark.w;
    gl_Position = projectionMatrix * centre;
    vUv = position.xy;
  }
}`;

const FRAGMENT = /* glsl */ `
uniform vec4 uMark;
uniform float uFade;
uniform vec3 uLight;
varying vec2 vUv;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float seed = uMark.x * 53.0, age = uMark.y;
  vec2 p = vUv;
  float r = length(p);
  vec2 ray = r > 1e-4 ? p / r : vec2(1.0, 0.0);
  float lobes = noise(ray * 2.4 + seed) * 0.6 + noise(ray * 5.3 + seed * 1.3) * 0.4;
  vec3 blood = vec3(0.075, 0.002, 0.003), deep = vec3(0.01, 0.001, 0.001);
  vec3 color; float alpha;
  if (uMark.w != 0.0) {
    // Blood on steel or mail: a thin irregular smear with a few specks thrown off it.
    float edge = 0.4 + 0.45 * lobes;
    float specks = step(0.72, noise(p * 9.0 + seed * 2.0)) * smoothstep(1.0, 0.6, r);
    alpha = max(smoothstep(edge, edge - 0.22, r), specks * 0.8) * 0.85;
    color = blood * mix(0.7, 1.0, noise(p * 6.0 + seed));
  } else {
    // The puncture: a narrow slit, turned a little by the seed.
    float turn = (uMark.x - 0.5) * 1.2;
    vec2 q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p;
    float slit = smoothstep(0.34, 0.2, length(q * vec2(2.6, 1.0)));
    // Blood soaking outwards through cloth or mail.
    float soak = mix(0.42, 0.8, smoothstep(0.0, 1.6, age)) * (0.6 + 0.6 * lobes);
    float halo = smoothstep(soak, soak - 0.22, r);
    // And running down from the wound (the quad extends below it).
    float reach = uMark.z > 0.0 ? smoothstep(0.0, uMark.z, age) : 1.0;
    float y = -p.y;
    float wander = (noise(vec2(y * 1.7, seed)) - 0.5) * 0.34;
    float width = mix(0.2, 0.07, clamp(y / 2.8, 0.0, 1.0)) * (0.7 + 0.6 * noise(vec2(seed, y * 3.1)));
    float run = step(0.0, y) * smoothstep(width, width * 0.45, abs(p.x - wander)) * smoothstep(reach * 2.8, reach * 2.8 - 0.3, y) * step(0.01, reach);
    float bead = smoothstep(0.16, 0.06, length(vec2(p.x - wander, y - reach * 2.8 + 0.12))) * step(0.05, reach) * (1.0 - step(0.999, reach) * 0.5);
    alpha = max(max(halo * 0.88, run * 0.9), max(slit, bead));
    color = mix(blood * mix(0.75, 1.0, lobes), deep, slit);
    // A wet glint on the lip of the wound and on the running bead.
    color += vec3(0.3, 0.25, 0.24) * (smoothstep(0.1, 0.0, length(p - vec2(-0.16, 0.2))) * 0.5 + bead * smoothstep(0.07, 0.0, length(vec2(p.x - wander + 0.03, y - reach * 2.8 + 0.15))) * 0.6);
  }
  alpha *= uFade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color * uLight, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Seconds a mark takes to fade when it is released with a fade. */
const FADE = 1.2;

export class WoundRenderer {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly marks: Mark[] = [];
  private readonly world = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly x = new THREE.Vector3();
  private readonly y = new THREE.Vector3();
  private readonly z = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private clock = 0;
  private serial = 0;
  /** Decal meshes built per impact. Bounded: past the cap the oldest is released. */
  private readonly adopted: Mark[] = [];
  private readonly adoptedCap: number;

  /** `fallback` holds marks that were given no bone: they stay where the contact was. */
  constructor(capacity: number, private readonly fallback: THREE.Object3D) {
    this.adoptedCap = Math.max(4, capacity * 2);
    // The quad reaches three radii below its centre: room for the blood to run.
    this.geometry = new THREE.PlaneGeometry(2, 4).translate(0, -1, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uMark: { value: new THREE.Vector4() }, uFade: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) } },
    });
    const material = this.material;
    for (let i = 0; i < capacity; i += 1) {
      const mesh = new THREE.Mesh(this.geometry, material);
      const mark: Mark = { mesh, impactId: "", kind: "wound", shape: 0, birth: 0, bleed: 0, size: 0, fadeAt: -1, serial: 0, live: false, form: 0, owned: false };
      mesh.name = "gore-mark";
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = 5;
      this.arm(mark);
      this.marks.push(mark);
    }
  }

  setLight(color: THREE.ColorRepresentation, level = 1): void {
    (this.material.uniforms.uLight.value as THREE.Color).set(color).multiplyScalar(level);
  }

  /** Marks alive now, for diagnostics and tests. */
  get live(): number { return this.marks.reduce((n, mark) => n + (mark.live ? 1 : 0), 0) + this.adopted.length; }
  /** Decal meshes (skin-bound wounds, splashes) alive now. */
  get decals(): number { return this.adopted.length; }

  /**
   * Binds a mark to `parent` (a bone or a weapon socket) at a world point.
   * `normal` is the world direction a wound faces; a weapon smear faces the camera.
   */
  attach(
    impactId: string, kind: MarkKind, parent: THREE.Object3D | null,
    point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number },
    options: { size: number; shape: number; bleed: number },
  ): void {
    if (!this.marks.length) return;
    this.release(impactId, kind);
    let mark = this.marks.find(item => !item.live);
    if (!mark) { mark = this.marks.reduce((oldest, item) => item.serial < oldest.serial ? item : oldest); this.free(mark); }
    const host = parent ?? this.fallback;
    this.z.set(normal.x, normal.y, normal.z);
    if (this.z.lengthSq() < 1e-8) this.z.set(0, 0, 1);
    this.z.normalize();
    // "Up" on the surface is world up with the normal taken out, so blood runs downhill.
    this.y.set(0, 1, 0).addScaledVector(this.z, -this.z.y);
    if (this.y.lengthSq() < 1e-6) this.y.set(1, 0, 0);
    this.y.normalize();
    this.x.crossVectors(this.y, this.z);
    const size = kind === "weapon" ? 1 : options.size;
    this.at.set(point.x, point.y, point.z).addScaledVector(this.z, kind === "weapon" ? 0 : options.size * 0.08);
    this.world.makeBasis(this.x.multiplyScalar(size), this.y.multiplyScalar(size), this.z.multiplyScalar(size)).setPosition(this.at);
    host.updateWorldMatrix(true, false);
    mark.mesh.matrix.copy(this.inverse.copy(host.matrixWorld).invert()).multiply(this.world);
    mark.mesh.matrixWorldNeedsUpdate = true;
    mark.impactId = impactId; mark.kind = kind; mark.shape = options.shape; mark.bleed = options.bleed; mark.size = options.size;
    mark.birth = this.clock; mark.fadeAt = -1; mark.serial = this.serial; mark.live = true;
    mark.form = kind === "weapon" ? options.size : 0;
    this.serial += 1;
    host.add(mark.mesh);
  }

  /** The shared material, for decal meshes built elsewhere (SurfaceDecals.ts). */
  get sharedMaterial(): THREE.ShaderMaterial { return this.material; }

  /**
   * Stand-ins for compiling the shared material ahead of the first wound (GoreSystem.warm): a mark is a plain mesh on
   * a bone, and a skin-bound decal a SkinnedMesh (SurfaceDecals.ts), and each is its own program. `release` frees them;
   * the programs stay with the material.
   */
  warmers(): { object: THREE.Object3D; release(): void } {
    const object = new THREE.Group();
    object.add(new THREE.Mesh(this.geometry, this.material));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(12), 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(12), 4));
    const skinned = new THREE.SkinnedMesh(geometry, this.material), bone = new THREE.Bone();
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    object.add(skinned);
    return { object, release: () => { skinned.skeleton.dispose(); geometry.dispose(); } };
  }

  /**
   * Takes over a decal mesh built for this impact (already placed and parented): it is drawn with the
   * shared material and lives and dies as a mark. Its geometry is disposed when the mark is released.
   */
  adopt(impactId: string, kind: MarkKind, mesh: THREE.Mesh, options: { shape: number; bleed: number; splash: boolean }): void {
    while (this.adopted.length >= this.adoptedCap) this.free(this.adopted.reduce((oldest, item) => item.serial < oldest.serial ? item : oldest));
    const mark: Mark = {
      mesh, impactId, kind, shape: options.shape, birth: this.clock, bleed: options.bleed, size: 0, fadeAt: -1, serial: this.serial, live: true,
      form: options.splash ? -1 : 0, owned: true,
    };
    this.serial += 1;
    mesh.name = "gore-decal";
    mesh.material = this.material;
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.renderOrder = 5;
    this.arm(mark);
    this.adopted.push(mark);
  }

  /** True while this impact has a live mark of the kind. */
  has(impactId: string, kind: MarkKind): boolean {
    return this.marks.some(mark => mark.live && mark.impactId === impactId && mark.kind === kind)
      || this.adopted.some(mark => mark.impactId === impactId && mark.kind === kind);
  }

  // One material for every mark: each sets its own numbers just before it is drawn.
  private arm(mark: Mark): void {
    const material = this.material;
    mark.mesh.onBeforeRender = () => {
      (material.uniforms.uMark.value as THREE.Vector4).set(mark.shape, this.clock - mark.birth, mark.bleed, mark.form);
      material.uniforms.uFade.value = mark.fadeAt < 0 ? 1 : Math.max(0, 1 - (this.clock - mark.fadeAt) / FADE);
      material.uniformsNeedUpdate = true;
    };
  }

  /** Removes an impact's marks: at once, or over a short fade. `kind` omitted: both. */
  release(impactId: string, kind?: MarkKind, fade = false): void {
    for (const mark of [...this.marks, ...this.adopted]) {
      if (!mark.live || mark.impactId !== impactId || (kind && mark.kind !== kind)) continue;
      if (fade) { if (mark.fadeAt < 0) mark.fadeAt = this.clock; } else this.free(mark);
    }
  }

  update(delta: number): void {
    this.clock += Math.max(0, delta);
    for (const mark of this.marks) if (mark.live && mark.fadeAt >= 0 && this.clock - mark.fadeAt >= FADE) this.free(mark);
    for (let i = this.adopted.length - 1; i >= 0; i -= 1) {
      const mark = this.adopted[i];
      if (mark.fadeAt >= 0 && this.clock - mark.fadeAt >= FADE) this.free(mark);
    }
  }

  clear(): void {
    for (const mark of this.marks) if (mark.live) this.free(mark);
    while (this.adopted.length) this.free(this.adopted[this.adopted.length - 1]);
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
  }

  private free(mark: Mark): void {
    mark.mesh.removeFromParent();
    mark.live = false; mark.impactId = "";
    if (!mark.owned) return;
    mark.mesh.geometry.dispose();
    const at = this.adopted.indexOf(mark);
    if (at >= 0) this.adopted.splice(at, 1);
  }
}
