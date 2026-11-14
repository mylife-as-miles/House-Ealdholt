// Adapted from SamuraiThirdPersonTemplateThreeJS and LinearAbiltyCastingExtendedThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * What an army's summons does to the stone, drawn: the scar (a front racing out from the blow, cracks that open
 * only behind it and cool, soot, the seams between the squares splitting with current in them, holes the dead
 * come up through), the slabs heaved out of the board and dropped back, and the dark of the places they left.
 * armies/groundPlan.ts decides when and where; this places it by uniforms and a few matrices a frame.
 *
 * From the reference's ShockRing: one quad on the ground, the wave and its cracks in one shader because a crack
 * only exists behind the front, cracks held to a width in board units rather than in angle, cooling slower than
 * the wave. From its rift fissures: a crack is seen because it is darker than the stone, with a pale lip, so the
 * dark half is drawn with ordinary blending and the light half added on top. Ours: the board's own seams as a
 * second kind of crack, holes, healing (everything closes by the time the rite is done), and our gain and
 * tone-mapping at the end, because the lowest tier draws straight to the canvas.
 */
import * as THREE from "three";
import { slabPose, type Slab } from "./groundPlan";

/** Holes the scar can draw at once. */
export const MAX_HOLES = 16;

export interface ScarLook {
  /** The white heat at the heart of a fresh crack and of the front. */
  hot: number;
  /** The kingdom's light in the cracks, the front and the seams. */
  glow: number;
  /** What a crack is inside: near black. */
  dark: number;
}

const NOISE = /* glsl */ `
#define TAU 6.2831853
float scarHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float scarHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float scarNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(scarHash2(i), scarHash2(i + vec2(1.0, 0.0)), f.x), mix(scarHash2(i + vec2(0.0, 1.0)), scarHash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const VERTEX = (lift: number) => /* glsl */ `
uniform vec3 uCentre;
uniform float uSize;
varying vec2 vPlace;
void main() {
  vec3 at = uCentre + vec3(position.x * uSize, ${lift.toFixed(4)}, position.y * uSize);
  vPlace = at.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
}
`;

const FIELD = /* glsl */ `
${NOISE}
uniform vec3 uCentre;
uniform float uTime, uSince, uFront, uReach, uHeat, uScar, uRadial, uSeams, uSeamFront, uTile, uBoard, uSeed, uFlash, uGain;
uniform vec4 uHoles[${MAX_HOLES}];
uniform int uHoleCount;
uniform vec3 uHot, uGlow, uDark;
varying vec2 vPlace;
// one family of cracks: count of them round the blow, each a different length, wandering off its bearing, held
// to a width in board units and tapering to a point. x is the crack's floor, y its broken lip.
vec2 crackFamily(vec2 q, float d, float count, float seed, float reach, float width) {
  float turn = atan(q.y, q.x) / TAU + 0.5;
  float cell = turn * count + seed;
  float index = floor(cell);
  float h = scarHash(index * 1.7 + seed * 7.0);
  float len = mix(0.35, 1.0, h) * reach;
  float wobble = (scarNoise(vec2(d * 2.6, index * 3.7 + seed)) - 0.5) * 0.55 + (scarNoise(vec2(d * 8.0, index * 5.1 + seed)) - 0.5) * 0.16;
  float off = fract(cell) - 0.5 + wobble * min(1.0, d * 1.5);
  float taper = 1.0 - smoothstep(0.0, len, d);
  float halfW = width * taper / max(d, 0.06) / TAU * count;
  float floorOf = 1.0 - smoothstep(halfW, halfW * 2.0 + 0.002, abs(off));
  float lip = 1.0 - smoothstep(halfW * 2.0, halfW * 5.0 + 0.004, abs(off));
  float inside = smoothstep(0.03, 0.08, d) * step(d, len);
  return vec2(floorOf, lip) * inside;
}
vec2 crackField(vec2 q, float d) {
  if (uRadial < 0.5 || uSince < 0.0) return vec2(0.0);
  // opened by the front on its way past, never ahead of it
  float behind = 1.0 - smoothstep(uFront - 0.28, uFront, d);
  vec2 a = crackFamily(q, d, 13.0, uSeed, uReach * 0.85, 0.05);
  vec2 b = crackFamily(q, d, 29.0, uSeed + 3.7, uReach * 0.5, 0.026);
  return vec2(max(a.x, b.x * 0.8), max(a.y, b.y * 0.7)) * behind;
}
// how near a seam between two squares this point is (board units), and the run along it
vec2 seamOf(vec2 p) {
  float sx = fract(p.x / uTile), sz = fract(p.y / uTile);
  float dx = min(sx, 1.0 - sx) * uTile, dz = min(sz, 1.0 - sz) * uTile;
  return dx < dz ? vec2(dx, p.y) : vec2(dz, p.x);
}
float onBoard(vec2 p) { return step(abs(p.x), uBoard) * step(abs(p.y), uBoard); }
float seamReached(float d) { return 1.0 - smoothstep(uSeamFront - 0.25, uSeamFront, d); }
`;

const DARK_FRAGMENT = /* glsl */ `
${FIELD}
void main() {
  vec2 p = vPlace, q = p - uCentre.xz;
  float d = length(q), alpha = 0.0;
  vec2 crack = crackField(q, d);
  if (uSince >= 0.0 && uRadial > 0.5) {
    // soot round the blow, uneven
    float soot = exp(-d * d / 0.42) * smoothstep(0.0, 0.2, uSince) * (0.4 + 0.3 * scarNoise(p * 5.0 + uSeed));
    alpha = max(crack.x * 0.94, max(crack.y * 0.38, soot));
  }
  if (uSeams > 0.0) {
    vec2 seam = seamOf(p);
    float split = (1.0 - smoothstep(0.012, 0.034, seam.x)) * seamReached(d) * onBoard(p);
    alpha = max(alpha, split * 0.8 * uSeams);
  }
  for (int i = 0; i < ${MAX_HOLES}; i += 1) {
    if (i >= uHoleCount) break;
    vec4 hole = uHoles[i];
    if (hole.w <= 0.0) continue;
    vec2 r = p - hole.xy;
    float edge = hole.z * (0.82 + 0.36 * scarNoise(vec2(atan(r.y, r.x) * 2.2, float(i) * 3.1)));
    alpha = max(alpha, (1.0 - smoothstep(edge * 0.7, edge, length(r))) * hole.w * 0.96);
  }
  alpha *= uScar;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uDark, min(alpha, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LIGHT_FRAGMENT = /* glsl */ `
${FIELD}
void main() {
  vec2 p = vPlace, q = p - uCentre.xz;
  float d = length(q);
  vec3 light = vec3(0.0);
  if (uSince >= 0.0) {
    // the front: thinning and dimming as it spreads, with a wake behind it so it is a wave and not a hoop
    float spread = clamp(uFront / max(uReach, 1e-3), 0.0, 1.0);
    float w = mix(0.14, 0.05, spread);
    float fromFront = (d - uFront) / w;
    float ring = exp(-fromFront * fromFront) + smoothstep(uFront - 0.45, uFront, d) * step(d, uFront) * 0.18;
    ring *= (1.0 - spread) * (1.0 - spread * 0.4);
    light += uGlow * ring * 1.15 + uHot * ring * ring * 0.45;
    vec2 crack = crackField(q, d);
    // the floor of a fresh crack is white hot and cools through the kingdom's colour to dark
    float flicker = 0.75 + 0.25 * scarNoise(vec2(d * 9.0 - uTime * 6.0, uSeed));
    light += mix(uGlow, uHot, uHeat * uHeat) * crack.x * uHeat * 1.7 * flicker + uGlow * crack.y * uHeat * 0.2;
    light += uHot * exp(-d * d * 5.0) * uFlash + uGlow * exp(-d * d * 1.2) * uFlash * 0.35;
  }
  if (uSeams > 0.0) {
    vec2 seam = seamOf(p);
    float line = 1.0 - smoothstep(0.004, 0.022, seam.x);
    // current running along the seam in surges, never still
    float surge = scarNoise(vec2(seam.y * 5.0 - uTime * 13.0, floor(p.x / uTile) * 3.0 + floor(p.y / uTile) * 7.0));
    float crawl = pow(surge, 3.0) * 2.4 + 0.25;
    float fromSeam = (d - uSeamFront) / 0.18;
    float head = exp(-fromSeam * fromSeam) * 1.6;
    light += (uGlow * (crawl + head) + uHot * pow(surge, 8.0) * 2.0) * line * seamReached(d) * onBoard(p) * uSeams;
  }
  for (int i = 0; i < ${MAX_HOLES}; i += 1) {
    if (i >= uHoleCount) break;
    vec4 hole = uHoles[i];
    if (hole.w <= 0.0) continue;
    vec2 r = p - hole.xy;
    float edge = hole.z * (0.82 + 0.36 * scarNoise(vec2(atan(r.y, r.x) * 2.2, float(i) * 3.1)));
    float fromEdge = (length(r) - edge * 0.78) / 0.035;
    float rim = exp(-fromEdge * fromEdge);
    float spit = 0.6 + 0.4 * scarNoise(vec2(atan(r.y, r.x) * 4.0, uTime * 9.0 + float(i)));
    light += (uGlow * 1.3 + uHot * 0.4) * rim * spit * hole.w;
  }
  light *= uScar;
  if (max(max(light.r, light.g), light.b) < 0.003) discard;
  gl_FragColor = vec4(light * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface ScarOptions {
  look: ScarLook;
  /** Where the blow lands, and how far from it the quad reaches. */
  centre: { x: number; y: number; z: number };
  size: number;
  /** The width of a square and half the board's, for the seams. */
  tile: number;
  board: number;
  seed: number;
  /** Radial cracks from the blow (a summons that strikes), or none (one that splits the seams). */
  radial: boolean;
}

/** What the scar is doing this frame. */
export interface ScarState {
  /** Seconds since the blow; negative before it. */
  since: number;
  /** How far the front has run, and how far it will. */
  front: number;
  reach: number;
  /** How hot the cracks still are, 0..1; and how much of the scar is left, 0..1 (it heals to nothing). */
  heat: number;
  left: number;
  /** The white flash at the blow, 0 and up. */
  flash: number;
  /** The current in the seams, 0..1, and how far it has spread. */
  seams: number;
  seamFront: number;
}

export class GroundScar {
  readonly object = new THREE.Group();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly holes: THREE.Vector4[];

  constructor(options: ScarOptions) {
    this.holes = Array.from({ length: MAX_HOLES }, () => new THREE.Vector4());
    this.uniforms = {
      uCentre: { value: new THREE.Vector3(options.centre.x, options.centre.y, options.centre.z) }, uSize: { value: options.size },
      uTime: { value: 0 }, uSince: { value: -1 }, uFront: { value: 0 }, uReach: { value: 1 }, uHeat: { value: 0 }, uScar: { value: 0 },
      uRadial: { value: options.radial ? 1 : 0 }, uSeams: { value: 0 }, uSeamFront: { value: 0 }, uTile: { value: options.tile }, uBoard: { value: options.board },
      uSeed: { value: (options.seed % 997) * 0.173 }, uFlash: { value: 0 }, uGain: { value: 1 },
      uHoles: { value: this.holes }, uHoleCount: { value: 0 },
      uHot: { value: new THREE.Color(options.look.hot) }, uGlow: { value: new THREE.Color(options.look.glow) }, uDark: { value: new THREE.Color(options.look.dark) },
    };
    const pass = (lift: number, fragment: string, additive: boolean, order: number) => {
      const material = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VERTEX(lift), fragmentShader: fragment, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false; mesh.renderOrder = order;
      this.object.add(mesh);
    };
    // the plane geometry is in xy; the vertex shader lays it flat
    pass(0.004, DARK_FRAGMENT, false, 6);
    pass(0.007, LIGHT_FRAGMENT, true, 7);
  }

  set(time: number, state: ScarState): void {
    const u = this.uniforms;
    u.uTime.value = time; u.uSince.value = state.since; u.uFront.value = state.front; u.uReach.value = Math.max(1e-3, state.reach);
    u.uHeat.value = state.heat; u.uScar.value = state.left; u.uFlash.value = state.flash; u.uSeams.value = state.seams; u.uSeamFront.value = state.seamFront;
    this.object.visible = state.left > 0.002;
  }

  /** The holes the dead come up through: x, z, radius, how open (0 closed). */
  setHoles(holes: readonly { x: number; z: number; radius: number; open: number }[]): void {
    const count = Math.min(MAX_HOLES, holes.length);
    for (let i = 0; i < count; i += 1) this.holes[i].set(holes[i].x, holes[i].z, holes[i].radius, holes[i].open);
    this.uniforms.uHoleCount.value = count;
  }

  setGain(gain: number): void { this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

// ------------------------------------------------------------------ slabs

export interface SlabLook {
  /** The stone of a light square and of a dark one, as the board has them. */
  light: number;
  dark: number;
  /** The light in the broken faces while they are hot. */
  glow: number;
}

const PIT_VERTEX = /* glsl */ `
attribute vec4 aPit;
attribute float aTurn, aHole;
uniform float uFloor;
varying vec2 vLocal;
varying float vHole;
void main() {
  vLocal = position.xy; vHole = aHole;
  float c = cos(aTurn), s = sin(aTurn);
  vec2 local = vec2(position.x * aPit.z, position.y * aPit.w) * 0.5 * 1.06;
  vec3 at = vec3(aPit.x + local.x * c + local.y * s, uFloor, aPit.y - local.x * s + local.y * c);
  gl_Position = aHole > 0.002 ? projectionMatrix * modelViewMatrix * vec4(at, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const PIT_FRAGMENT = /* glsl */ `
uniform vec3 uGlowColour;
uniform float uHeat, uGain;
varying vec2 vLocal;
varying float vHole;
void main() {
  // the dark of the place a slab came out of: deepest in its middle, ragged at its edges, warm at its bottom while hot
  vec2 a = abs(vLocal);
  float edge = max(a.x, a.y);
  float body = 1.0 - smoothstep(0.82, 1.0, edge);
  float depth = 1.0 - smoothstep(0.0, 0.95, edge);
  vec3 colour = vec3(0.012, 0.010, 0.012) + uGlowColour * depth * depth * uHeat * 0.6 * uGain;
  float alpha = body * vHole * 0.93;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The slabs heaved out of the board: lit stone, cast in the square's own colour, with broken sides darker than
 * the polished top and hot while the blow is fresh; and under each the dark of the place it left, closing as it
 * settles back. When every slab lies flush both are put away: the board itself is all that is left.
 */
export class SlabField {
  readonly object = new THREE.Group();
  readonly count: number;
  private readonly slabs: readonly Slab[];
  private readonly mesh: THREE.InstancedMesh;
  private readonly boxGeometry: THREE.BoxGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly pitGeometry = new THREE.InstancedBufferGeometry();
  private readonly pitMaterial: THREE.ShaderMaterial;
  private readonly pitHole: THREE.InstancedBufferAttribute;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly floor: number;
  private readonly matrix = new THREE.Matrix4();
  private readonly turn = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(slabs: readonly Slab[], look: SlabLook, floor: number) {
    this.slabs = slabs; this.count = slabs.length; this.floor = floor;
    this.uniforms = { uSlabGlow: { value: new THREE.Color(look.glow) }, uSlabHeat: { value: 0 }, uSlabGain: { value: 1 }, uGlowColour: { value: new THREE.Color(look.glow) }, uHeat: { value: 0 }, uGain: { value: 1 }, uFloor: { value: floor + 0.0025 } };
    // a unit block with its top face at y = 0, so a slab at rest lies in the board's own top
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
    const normals = this.boxGeometry.getAttribute("normal"), faces = new Float32Array(normals.count), tones = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i += 1) {
      const top = normals.getY(i) > 0.5, bottom = normals.getY(i) < -0.5;
      faces[i] = top ? 1 : 0;
      const tone = top ? 1 : bottom ? 0.3 : 0.5;
      tones.set([tone, tone, tone], i * 3);
    }
    this.boxGeometry.setAttribute("aFace", new THREE.BufferAttribute(faces, 1));
    this.boxGeometry.setAttribute("color", new THREE.BufferAttribute(tones, 3));
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.48, metalness: 0.04 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aFace;\nvarying float vSlabFace;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSlabFace = aFace;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uSlabGlow;\nuniform float uSlabHeat, uSlabGain;\nvarying float vSlabFace;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n// the broken faces are hot while the blow is fresh; the polished top is not\ntotalEmissiveRadiance += uSlabGlow * uSlabHeat * (1.0 - vSlabFace) * 1.4 * uSlabGain;\nroughnessFactor = mix(0.95, roughnessFactor, vSlabFace);");
    };
    this.material.customProgramCacheKey = () => "rite-army-slab";
    this.mesh = new THREE.InstancedMesh(this.boxGeometry, this.material, Math.max(1, slabs.length));
    this.mesh.count = slabs.length;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    const colour = new THREE.Color();
    slabs.forEach((slab, i) => this.mesh.setColorAt(i, colour.setHex(slab.light ? look.light : look.dark)));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.object.add(this.mesh);

    // the places they leave
    this.pitGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.pitGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const pits = new Float32Array(Math.max(1, slabs.length) * 4), turns = new Float32Array(Math.max(1, slabs.length));
    slabs.forEach((slab, i) => { pits.set([slab.at.x, slab.at.z, slab.width, slab.depth], i * 4); turns[i] = 0; });
    this.pitHole = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, slabs.length)), 1).setUsage(THREE.DynamicDrawUsage);
    this.pitGeometry.setAttribute("aPit", new THREE.InstancedBufferAttribute(pits, 4));
    this.pitGeometry.setAttribute("aTurn", new THREE.InstancedBufferAttribute(turns, 1));
    this.pitGeometry.setAttribute("aHole", this.pitHole);
    this.pitGeometry.instanceCount = slabs.length;
    this.pitMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PIT_VERTEX, fragmentShader: PIT_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pit = new THREE.Mesh(this.pitGeometry, this.pitMaterial);
    pit.frustumCulled = false; pit.renderOrder = 5;
    this.object.add(pit);
    this.update(0, 0);
  }

  /** Places every slab for the rite's clock. `heat` is how hot the broken faces still are, 0..1. */
  update(time: number, heat: number): void {
    this.uniforms.uSlabHeat.value = heat; this.uniforms.uHeat.value = heat;
    let shown = false;
    this.slabs.forEach((slab, i) => {
      const pose = slabPose(slab, time);
      this.pitHole.setX(i, pose.hole);
      if (!pose.shown) { this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0)); return; }
      shown = true;
      // heaved on the side nearer the blow: a turn about the line square to the way from the blow, then its own spin
      this.axis.set(slab.away.x, 0, slab.away.z).cross(SlabField.UP).negate().normalize();
      this.turn.setFromAxisAngle(this.axis, pose.tilt);
      this.spin.setFromAxisAngle(SlabField.UP, pose.spin);
      this.turn.multiply(this.spin);
      this.at.set(slab.at.x, this.floor + 0.003 + pose.lift, slab.at.z);
      this.scale.set(slab.width, slab.thickness, slab.depth);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.at, this.turn, this.scale));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pitHole.needsUpdate = true;
    this.mesh.visible = shown;
    this.object.visible = shown;
  }

  setGain(gain: number): void { this.uniforms.uSlabGain.value = gain; this.uniforms.uGain.value = gain; }

  dispose(): void {
    this.object.removeFromParent();
    this.boxGeometry.dispose(); this.material.dispose(); this.mesh.dispose();
    this.pitGeometry.dispose(); this.pitMaterial.dispose();
  }
}
