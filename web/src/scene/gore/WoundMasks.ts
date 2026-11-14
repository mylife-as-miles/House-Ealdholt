// Adapted from zulubo/SkinGore (MIT). Copyright (c) 2020 zulubo. See public/licenses/SkinGore-MIT.txt.
/**
 * Wound masks on the figures (Milestone 03, "Wounded Warriors"): SkinGore's technique on three.js.
 *
 * Each wounded figure keeps a small render target in its sculpt's UV space, its size the gore tier's
 * (goreTiers.ts). A wound is painted into it on the GPU, one paint per stroke and per run of blood:
 *
 *   1. bake    the figure's skinned mesh is drawn unwrapped (gl_Position from its UV) into a shared hit buffer.
 *              Its vertices are skinned by three's own chunks, so each texel knows where on the posed body it is,
 *              in world space, and is lit by the stroke there (woundMaskPlan.ts): a blob, a capsule along a cut,
 *              or something broad. Every texel the bake reaches is marked covered in alpha.
 *   2. dilate  one pass reads the hit buffer, fills the texels just outside each UV island from the nearest
 *              covered ones (so seams do not show), and adds the result into the figure's mask.
 *
 * The figure's own materials show the mask (gore/woundMaskShader.ts, through PieceView.wearWounds): no decal,
 * no extra mesh and no draw call a frame. It follows the body through every pose, ragdoll, fall and carry because
 * it is on the body.
 *
 * Every paint keeps the pose it was made on (the bone matrices and the mesh's frames, a kilobyte or two), so a
 * mask can be painted again exactly: when one of its impacts is taken back while others stay (the ledger's undo
 * rules, GoreLedger.ts), or when a wound of a higher tier needs a larger mask. Same events, same masks.
 *
 * Lifetime: a mask lives as long as its figure wears it. It goes when the figure stands again in the tray
 * (PieceView.resetPose) or is freed (an Undo's rebuild, a new game), when every impact that painted it has been
 * taken back, on reset, and past the preset's count of masks alive at once (the oldest first). Everything it
 * allocates is freed by dispose.
 */
import * as THREE from "three";
import type { QualityPreset } from "../quality";
import { goreBudget } from "./goreTiers";
import type { WoundPlan } from "./GoreTypes";
import { WOUND_GATES, WOUND_GATE_FLOATS, WOUND_MASK_BUDGET, paintDraws, wetness, type WoundMaskPlan, type WoundRun, type WoundStroke } from "./woundMaskPlan";
import { woundUvSet } from "./woundMaskShader";
import { finishPrograms, materialsOf } from "../programWarm";

/** What a figure wears (PieceView.wearWounds): its mask, how wet it is, the tier's look, and the gates. */
export interface WoundWear {
  map: THREE.Texture;
  wet: number;
  interiors: boolean;
  /** How deep the deepest part sinks, as a share of the figure's height. */
  sink: number;
  fabric: boolean;
  /** Prisms round the strokes in the sculpt's rest space: (a, radius), (b, back), (normal, front), `gateCount` of them. */
  gates: Float32Array;
  gateCount: number;
}

/** A figure that can wear a mask. PieceView is one. */
export interface WoundBody {
  /** The meshes that wear it: the sculpt (skinned, or the still model), never its props. */
  woundMeshes(): readonly THREE.Mesh[];
  /** Shows a mask on the figure's own materials, or takes it off (null). `lost` is called if the figure drops it by itself. */
  wearWounds(wear: WoundWear | null, lost?: () => void): void;
}

/** The figure an object stands for, if it can wear a mask: what PieceView puts in its container's `userData.piece`. */
export function asWoundBody(candidate: unknown): WoundBody | null {
  const body = candidate as Partial<WoundBody> | null | undefined;
  return body && typeof body.woundMeshes === "function" && typeof body.wearWounds === "function" ? body as WoundBody : null;
}

const BAKE_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vWorld;
varying vec3 vRest;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vRest = position;
  // Unwrapped: the texel this vertex owns in the mask.
  gl_Position = vec4(WOUND_UV * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAKE_FRAGMENT = /* glsl */ `
uniform vec3 uOrigin;
uniform vec3 uNormal;
uniform vec3 uAxis;
uniform vec4 uShape;   // half-length of a capsule, radius of the opening, of the blood, of the deep core
uniform vec4 uAmount;  // open, blood, deep, ragged
uniform vec4 uReach;   // how far behind the wound's point the anchor bone is, how far in front it reaches, broad (0/1), seed
uniform float uRestCells;
varying vec3 vWorld;
varying vec3 vRest;
float bkHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float bkNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bkHash(i), bkHash(i + vec3(1, 0, 0)), f.x), mix(bkHash(i + vec3(0, 1, 0)), bkHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bkHash(i + vec3(0, 0, 1)), bkHash(i + vec3(1, 0, 1)), f.x), mix(bkHash(i + vec3(0, 1, 1)), bkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  vec3 d = vWorld - uOrigin;
  // Depth along the wound's outward normal: from the plane through the anchor bone (behind) to a little in front,
  // so the surface is reached wherever along the normal it lies, and the far side of the body never is.
  float t = dot(d, uNormal);
  float reach = smoothstep(-uReach.x - 0.002, -uReach.x * 0.5, t) * (1.0 - smoothstep(uReach.y * 0.6, uReach.y, t));
  vec3 across = d - t * uNormal;
  float along = dot(across, uAxis);
  float lateral = length(across - clamp(along, -uShape.x, uShape.x) * uAxis);
  // A torn edge: lobes from the sculpt's own surface, so a stroke painted again lands exactly where it did.
  vec3 cell = vRest * uRestCells + uReach.w;
  float lobes = bkNoise(cell) * 0.65 + bkNoise(cell * 2.3 + 7.1) * 0.35;
  float edge = lateral * (1.0 + (lobes - 0.5) * 2.0 * uAmount.w);
  // A cone to each radius, linear in distance, so the filtered mask keeps its contours where the display cuts it (a
  // broad stroke's opening flat-topped further out).
  vec3 radius = max(uShape.yzw, vec3(1e-5));
  float top = radius.x * (0.25 + 0.45 * uReach.z);
  float open = clamp((radius.x - edge) / max(radius.x - top, 1e-5), 0.0, 1.0);
  float blood = clamp(1.0 - edge / radius.y, 0.0, 1.0);
  float deep = clamp(1.0 - edge / radius.z, 0.0, 1.0);
  gl_FragColor = vec4(vec3(open * uAmount.x, blood * uAmount.y, deep * uAmount.z) * reach, 1.0);
}`;

const DILATE_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DILATE_FRAGMENT = /* glsl */ `
uniform sampler2D uHit;
uniform int uRings;
const ivec2 AROUND[8] = ivec2[8](ivec2(1, 0), ivec2(1, 1), ivec2(0, 1), ivec2(-1, 1), ivec2(-1, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1));
void main() {
  ivec2 size = textureSize(uHit, 0), at = ivec2(gl_FragCoord.xy);
  vec4 here = texelFetch(uHit, at, 0);
  if (here.a > 0.5) { gl_FragColor = here; return; }
  // Past an island's edge: the most of what its covered neighbours hold, nearest ring first.
  vec3 most = vec3(0.0);
  float found = 0.0;
  for (int ring = 1; ring <= 3; ring++) {
    if (ring > uRings || found > 0.5) break;
    for (int k = 0; k < 8; k++) {
      vec4 there = texelFetch(uHit, clamp(at + AROUND[k] * ring, ivec2(0), size - 1), 0);
      if (there.a > 0.5) { most = max(most, there.rgb); found = 1.0; }
    }
  }
  gl_FragColor = vec4(most, found);
}`;

interface MeshPose {
  world: THREE.Matrix4;
  /** Skinned meshes only. */
  bones: Float32Array | null;
  bind: THREE.Matrix4 | null;
  bindInverse: THREE.Matrix4 | null;
}

/** One paint: a stroke or a run, in world space at its moment, and the pose it was painted on. */
interface Paint {
  impactId: string;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  axis: THREE.Vector3;
  shape: THREE.Vector4;
  amount: THREE.Vector4;
  reach: THREE.Vector4;
  poses: MeshPose[];
  /** The prism round it in the sculpt's rest space, as the bake reached: a capsule across the surface, `back` behind and `front` before. */
  gate: Gate;
}

/** A wound whose runs are still to come: where it is on its anchor bone, so each run starts where the wound is then. */
interface Bleeding {
  impactId: string;
  anchor: THREE.Object3D | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  mask: WoundMaskPlan;
}

interface BakeMesh { source: THREE.Mesh; bake: THREE.Mesh; frozen: THREE.Skeleton | null; uv: "uv" | "uv1" }

/** A gate in the sculpt's rest space. A zero normal: a plain capsule (two gates merged that pointed different ways). */
interface Gate { a: THREE.Vector3; b: THREE.Vector3; radius: number; normal: THREE.Vector3; back: number; front: number }

interface Entry {
  body: WoundBody;
  meshes: BakeMesh[];
  size: number;
  target: THREE.WebGLRenderTarget;
  paints: Paint[];
  /** Paints made but not drawn yet (drawn at the next update). */
  pending: Paint[];
  /** Everything must be drawn again (an impact was taken back, or the mask grew). */
  rebuild: boolean;
  bleeding: Bleeding[];
  impacts: Set<string>;
  wear: WoundWear;
  fresh: number;
  since: number;
  serial: number;
  live: boolean;
  /** Shown on the figure only once something has been drawn into it (a pooled target holds an old mask until then). */
  drawn: boolean;
  /** The smaller target a grown mask leaves, kept until the larger one has been drawn. */
  retired: { target: THREE.WebGLRenderTarget; size: number } | null;
}

export interface WoundMaskStats {
  /** Figures wearing a mask. */
  masks: number;
  /** Paints kept (strokes and runs). */
  paints: number;
  /** Draw calls spent painting since the masks were made. */
  draws: number;
  /** Bytes held in render targets now (masks, pooled masks and hit buffers). */
  bytes: number;
  /** Sides of the masks alive. */
  sizes: number[];
}

const DOWN = new THREE.Vector3(0, -1, 0);

export class WoundMasks {
  private readonly entries = new Map<WoundBody, Entry>();
  private readonly pool = new Map<number, THREE.WebGLRenderTarget[]>();
  private readonly hits = new Map<number, THREE.WebGLRenderTarget>();
  private readonly materials = new Map<"uv" | "uv1", THREE.ShaderMaterial>();
  private readonly dilate: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly bakeScene = new THREE.Scene();
  private readonly quadScene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private serial = 0;
  private draws = 0;
  private disposed = false;
  // scratch
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly n = new THREE.Matrix4();
  private readonly colour = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, private quality: QualityPreset) {
    this.bakeScene.matrixWorldAutoUpdate = false;
    this.quadScene.matrixWorldAutoUpdate = false;
    this.dilate = new THREE.ShaderMaterial({
      vertexShader: DILATE_VERTEX, fragmentShader: DILATE_FRAGMENT,
      uniforms: { uHit: { value: null }, uRings: { value: WOUND_MASK_BUDGET[quality].rings } },
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    // One triangle over the whole target.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geometry, this.dilate);
    this.quad.frustumCulled = false;
    this.quad.matrixAutoUpdate = false;
    this.quadScene.add(this.quad);
    void this.warm();
  }

  /**
   * The bake and the dilation compiled with the scene, not on the frame of the first wound. Called again once the
   * match's arena has set the renderer up (GoreSystem.warm): a program also follows the renderer's shadow type, which
   * the arena changes after this was first made, so the first build no longer matches what a wound draws with.
   * Resolves once the driver has finished them.
   */
  warm(): Promise<unknown> {
    const geometry = new THREE.BufferGeometry();
    try {
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
      geometry.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(12), 4));
      geometry.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(12), 4));
      const bone = new THREE.Bone(), mesh = new THREE.SkinnedMesh(geometry, this.material("uv"));
      mesh.add(bone);
      mesh.bind(new THREE.Skeleton([bone]));
      mesh.frustumCulled = false;
      this.bakeScene.add(mesh);
      // Compiled as they are drawn: into a render target (a program's colour space follows the target bound), and an
      // ordinary fight's hit buffer and one mask allocated on the GPU on the way, kept for the first figure wounded.
      const size = goreBudget(1, this.quality).mask, target = this.target(size), previous = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, false, false);
      this.renderer.setRenderTarget(this.hit(size));
      this.renderer.clear(true, false, false);
      // Asynchronously, then finished (finishPrograms): a program only built, and never asked after, was still being
      // finished on the frame of the first wound (a stall of a tenth of a second or more).
      const materials = new Set([...materialsOf(this.bakeScene), ...materialsOf(this.quadScene)]), renderer = this.renderer;
      const built = Promise.all([renderer.compileAsync(this.bakeScene, this.camera), renderer.compileAsync(this.quadScene, this.camera)])
        .then(() => finishPrograms(renderer, materials));
      this.renderer.setRenderTarget(previous);
      this.recycle(target, size);
      this.bakeScene.remove(mesh);
      mesh.skeleton.dispose();
      return built;
    } catch {
      // The first wound compiles them instead.
      return Promise.resolve();
    } finally { geometry.dispose(); }
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality;
    this.dilate.uniforms.uRings.value = WOUND_MASK_BUDGET[quality].rings;
  }

  /** Whether this figure wears a mask now. */
  wears(body: WoundBody): boolean { return this.entries.has(body); }

  /** Where a figure's first wound that bleeds is now (world), and the way out of it: false where it has none. */
  woundOf(body: WoundBody, point: THREE.Vector3, normal: THREE.Vector3): boolean {
    const bleeding = this.entries.get(body)?.bleeding[0];
    if (!bleeding) return false;
    point.copy(bleeding.point); normal.copy(bleeding.normal);
    if (bleeding.anchor) {
      bleeding.anchor.updateWorldMatrix(true, false);
      point.applyMatrix4(bleeding.anchor.matrixWorld);
      normal.transformDirection(bleeding.anchor.matrixWorld);
    }
    return true;
  }

  get stats(): WoundMaskStats {
    let bytes = 0;
    const sizes: number[] = [];
    for (const entry of this.entries.values()) { bytes += entry.size * entry.size * 4; sizes.push(entry.size); }
    for (const [size, list] of this.pool) bytes += list.length * size * size * 4;
    for (const size of this.hits.keys()) bytes += size * size * 4;
    return { masks: this.entries.size, paints: [...this.entries.values()].reduce((sum, entry) => sum + entry.paints.length, 0), draws: this.draws, bytes, sizes };
  }

  /**
   * Opens a wound on a figure: its strokes are painted (at the next update, on the pose it has now) into the
   * figure's mask, made if it has none. False if the figure cannot wear one: the caller draws the wound another
   * way. `anchor` is the bone the wound rides on (the torso): the strokes reach from it outward, and the runs
   * start where the wound is when each is painted.
   */
  open(impactId: string, body: WoundBody, anchor: THREE.Object3D | null, wound: WoundPlan): boolean {
    const plan = wound.mask;
    if (this.disposed || !plan || plan.size <= 0) return false;
    const sources = body.woundMeshes().filter(mesh => mesh.geometry.getAttribute("uv"));
    if (!sources.length) return false;
    let entry = this.entries.get(body);
    if (entry && entry.meshes.length !== sources.length) { this.free(entry); entry = undefined; }
    if (!entry) entry = this.create(body, sources, plan.size);
    else if (plan.size > entry.size) this.grow(entry, plan.size);

    // The wound's own frame: out of the body from the anchor bone through the wound, x across it, y up it.
    const origin = new THREE.Vector3(wound.point.x, wound.point.y, wound.point.z);
    const normal = this.outward(origin, anchor, wound.normal);
    // Through the body to the anchor bone, or as far as the plan says (a stump's, whose bone runs the limb's length).
    const back = plan.back !== undefined ? Math.max(0.01, plan.back)
      : anchor ? Math.max(0.01, this.v.copy(origin).sub(anchor.getWorldPosition(this.w)).dot(normal)) : Math.max(0.01, wound.size);
    const right = new THREE.Vector3(normal.z, 0, -normal.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const rise = new THREE.Vector3().crossVectors(normal, right);
    const poses = entry.meshes.map(item => this.pose(item.source));
    for (const stroke of plan.strokes) {
      const axis = right.clone().multiplyScalar(stroke.axis.x).addScaledVector(rise, stroke.axis.y).normalize();
      this.add(entry, this.strokePaint(impactId, entry, origin, normal, axis, stroke, back, poses));
    }
    // Where the wound sits on its bone, for the runs to come.
    if (plan.runs.length) {
      const bleeding: Bleeding = { impactId, anchor, point: origin.clone(), normal: normal.clone(), mask: plan };
      if (anchor) {
        anchor.updateWorldMatrix(true, false);
        this.m.copy(anchor.matrixWorld).invert();
        bleeding.point.applyMatrix4(this.m);
        bleeding.normal.transformDirection(this.m);
      }
      entry.bleeding.push(bleeding);
    }
    entry.impacts.add(impactId);
    // Fresh blood wets the whole mask again; the tier's look is the most any of its wounds has had.
    entry.fresh = Math.max(entry.fresh, plan.wet);
    entry.since = 0;
    entry.wear.interiors = entry.wear.interiors || plan.interiors;
    entry.wear.fabric = entry.wear.fabric || plan.fabric;
    entry.wear.sink = Math.max(entry.wear.sink, plan.sink);
    entry.wear.wet = wetness(entry.fresh, 0);
    this.gates(entry);
    this.show(entry);
    return true;
  }

  /** A run of blood from an impact's wound, as the plan's `runs[index]` says, down the body as it hangs now. */
  run(impactId: string, index: number): void {
    for (const entry of this.entries.values()) {
      for (const bleeding of entry.bleeding) {
        if (bleeding.impactId !== impactId) continue;
        const run = bleeding.mask.runs[index];
        if (!run) continue;
        const paint = this.runPaint(entry, bleeding, run);
        if (paint) { this.add(entry, paint); entry.since = 0; this.gates(entry); this.show(entry); }
      }
    }
  }

  /** Takes back everything an impact painted: the figure's mask is painted again without it, or goes if nothing is left. */
  release(impactId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (!entry.impacts.has(impactId)) continue;
      entry.impacts.delete(impactId);
      entry.bleeding = entry.bleeding.filter(item => item.impactId !== impactId);
      entry.paints = entry.paints.filter(paint => paint.impactId !== impactId);
      entry.pending = entry.pending.filter(paint => paint.impactId !== impactId);
      if (!entry.paints.length) { this.free(entry); continue; }
      entry.rebuild = true;
      this.gates(entry);
      this.show(entry);
    }
  }

  /** Every mask goes. */
  clear(): void {
    for (const entry of [...this.entries.values()]) this.free(entry);
  }

  /** Draws what is waiting, and lets the blood dry. */
  update(delta: number): void {
    if (this.disposed) return;
    let waiting = false;
    for (const entry of this.entries.values()) if (entry.rebuild || entry.pending.length) { waiting = true; break; }
    if (waiting) this.draw();
    for (const entry of this.entries.values()) {
      entry.since += Math.max(0, delta);
      const wet = wetness(entry.fresh, entry.since);
      if (Math.abs(wet - entry.wear.wet) > 0.01) { entry.wear.wet = wet; this.show(entry); }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    for (const list of this.pool.values()) for (const target of list) target.dispose();
    this.pool.clear();
    for (const target of this.hits.values()) target.dispose();
    this.hits.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.dilate.dispose();
    this.quad.geometry.dispose();
    this.disposed = true;
  }

  // ---------------------------------------------------------------- making and freeing

  private create(body: WoundBody, sources: readonly THREE.Mesh[], size: number): Entry {
    // Past the preset's count, the oldest mask goes first.
    const live = WOUND_MASK_BUDGET[this.quality].live;
    while (this.entries.size >= live) {
      let oldest: Entry | null = null;
      for (const entry of this.entries.values()) if (!oldest || entry.serial < oldest.serial) oldest = entry;
      if (!oldest) break;
      this.free(oldest);
    }
    const target = this.target(size);
    const meshes = sources.map(source => this.bakeMesh(source));
    const entry: Entry = {
      body, meshes, size, target, paints: [], pending: [], rebuild: true, bleeding: [], impacts: new Set(),
      wear: { map: target.texture, wet: 0, interiors: false, sink: 0, fabric: false, gates: new Float32Array(WOUND_GATES * WOUND_GATE_FLOATS), gateCount: 0 },
      fresh: 0, since: 0, serial: this.serial++, live: true, drawn: false, retired: null,
    };
    this.entries.set(body, entry);
    return entry;
  }

  /** A wound of a higher tier needs a larger mask: every paint is drawn again into it at the next update. */
  private grow(entry: Entry, size: number): void {
    if (entry.retired) this.recycle(entry.retired.target, entry.retired.size);
    entry.retired = { target: entry.target, size: entry.size };
    entry.target = this.target(size);
    entry.size = size;
    entry.rebuild = true;
  }

  /** Tells the figure what it wears now, once its mask holds something. */
  private show(entry: Entry): void {
    if (!entry.live || !entry.drawn) return;
    entry.body.wearWounds(entry.wear, () => this.lost(entry));
  }

  /** The figure dropped its mask itself (it stands in the tray, or was freed). */
  private lost(entry: Entry): void {
    if (!entry.live || this.entries.get(entry.body) !== entry) return;
    this.free(entry, false);
  }

  private free(entry: Entry, tell = true): void {
    if (!entry.live) return;
    entry.live = false;
    this.entries.delete(entry.body);
    if (tell) entry.body.wearWounds(null);
    this.recycle(entry.target, entry.size);
    if (entry.retired) this.recycle(entry.retired.target, entry.retired.size);
    entry.retired = null;
    for (const item of entry.meshes) item.frozen?.boneTexture?.dispose();
    entry.meshes = []; entry.paints = []; entry.pending = []; entry.bleeding = [];
  }

  private target(size: number): THREE.WebGLRenderTarget {
    const pooled = this.pool.get(size)?.pop();
    const target = pooled ?? new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    target.texture.name = "wound-mask";
    return target;
  }

  /** A freed mask is kept for the next figure, a couple of each size at most. */
  private recycle(target: THREE.WebGLRenderTarget, size: number): void {
    const list = this.pool.get(size) ?? [];
    if (list.length >= 2) { target.dispose(); return; }
    list.push(target);
    this.pool.set(size, list);
  }

  private hit(size: number): THREE.WebGLRenderTarget {
    let hit = this.hits.get(size);
    if (!hit) {
      hit = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
        magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false,
      });
      this.hits.set(size, hit);
    }
    return hit;
  }

  private material(uv: "uv" | "uv1"): THREE.ShaderMaterial {
    let material = this.materials.get(uv);
    if (!material) {
      material = new THREE.ShaderMaterial({
        vertexShader: `${uv === "uv1" ? "#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\n" : ""}#define WOUND_UV ${uv}\n${BAKE_VERTEX}`,
        fragmentShader: BAKE_FRAGMENT,
        uniforms: {
          uOrigin: { value: new THREE.Vector3() }, uNormal: { value: new THREE.Vector3(0, 0, 1) }, uAxis: { value: new THREE.Vector3(1, 0, 0) },
          uShape: { value: new THREE.Vector4() }, uAmount: { value: new THREE.Vector4() }, uReach: { value: new THREE.Vector4() },
          uRestCells: { value: 1 },
        },
        side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      });
      this.materials.set(uv, material);
    }
    return material;
  }

  /**
   * What draws a figure's mesh into the mask: its own geometry with the bake material, skinned by a frozen copy of
   * its skeleton that holds whatever pose a paint was made on (three updates a skeleton once a frame; this one's
   * update does nothing, so its bone texture keeps the pose it is given).
   */
  private bakeMesh(source: THREE.Mesh): BakeMesh {
    const uv = woundUvSet(!!source.geometry.getAttribute("uv1"));
    const skinned = source as THREE.SkinnedMesh;
    let bake: THREE.Mesh, frozen: THREE.Skeleton | null = null;
    if (skinned.isSkinnedMesh) {
      frozen = new THREE.Skeleton(skinned.skeleton.bones, skinned.skeleton.boneInverses);
      frozen.update = () => undefined;
      frozen.computeBoneTexture();
      const mesh = new THREE.SkinnedMesh(source.geometry, this.material(uv));
      mesh.skeleton = frozen;
      mesh.bindMode = THREE.DetachedBindMode;
      bake = mesh;
    } else bake = new THREE.Mesh(source.geometry, this.material(uv));
    bake.matrixAutoUpdate = false;
    bake.matrixWorldAutoUpdate = false;
    bake.frustumCulled = false;
    return { source, bake, frozen, uv };
  }

  // ---------------------------------------------------------------- paints

  /** The direction out of the body at a wound: from the anchor bone through it (wherever on the surface the wound's point lies). */
  private outward(point: THREE.Vector3, anchor: THREE.Object3D | null, fallback: { x: number; y: number; z: number }): THREE.Vector3 {
    const out = new THREE.Vector3();
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      out.copy(point).sub(anchor.getWorldPosition(this.v));
      if (out.lengthSq() > 1e-6) return out.normalize();
    }
    out.set(fallback.x, fallback.y, fallback.z);
    return out.lengthSq() > 1e-8 ? out.normalize() : out.set(0, 0, 1);
  }

  /** The mesh as it is posed now. */
  private pose(mesh: THREE.Mesh): MeshPose {
    mesh.updateWorldMatrix(true, false);
    const skinned = mesh as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return { world: mesh.matrixWorld.clone(), bones: null, bind: null, bindInverse: null };
    const skeleton = skinned.skeleton;
    for (const bone of skeleton.bones) bone.updateWorldMatrix(true, false);
    // The renderer refreshes a skeleton once a frame: make it match the bones as they stand on this one.
    skeleton.update();
    return {
      world: mesh.matrixWorld.clone(), bones: skeleton.boneMatrices ? skeleton.boneMatrices.slice(0, skeleton.bones.length * 16) : null,
      bind: skinned.bindMatrix.clone(), bindInverse: skinned.bindMatrixInverse.clone(),
    };
  }

  private strokePaint(impactId: string, entry: Entry, origin: THREE.Vector3, normal: THREE.Vector3, axis: THREE.Vector3, stroke: WoundStroke, back: number, poses: MeshPose[]): Paint {
    const a = origin.clone().addScaledVector(axis, -stroke.half), b = origin.clone().addScaledVector(axis, stroke.half);
    return {
      impactId, origin: origin.clone(), normal: normal.clone(), axis: axis.clone(),
      shape: new THREE.Vector4(stroke.half, stroke.open, stroke.blood, stroke.deep),
      amount: new THREE.Vector4(stroke.amount.open, stroke.amount.blood, stroke.amount.deep, stroke.ragged),
      reach: new THREE.Vector4(back, stroke.front, stroke.shape === "broad" ? 1 : 0, stroke.seed % 997),
      poses, gate: this.gate(entry, a, b, Math.max(stroke.blood, stroke.open) * 1.08, normal, back, stroke.front, poses),
    };
  }

  private runPaint(entry: Entry, bleeding: Bleeding, run: WoundRun): Paint | null {
    // Where the wound is now, and which way is down across the body there.
    const point = bleeding.point.clone(), normal = bleeding.normal.clone();
    if (bleeding.anchor) {
      bleeding.anchor.updateWorldMatrix(true, false);
      point.applyMatrix4(bleeding.anchor.matrixWorld);
      normal.transformDirection(bleeding.anchor.matrixWorld);
    }
    const down = DOWN.clone().addScaledVector(normal, -DOWN.dot(normal));
    const tilt = down.length();
    // Lying face up, blood pools in the wound rather than running.
    if (tilt < 0.15) return null;
    down.divideScalar(tilt);
    const scale = Math.min(1, tilt / 0.5);
    const side = new THREE.Vector3().crossVectors(normal, down).normalize();
    const start = point.clone().addScaledVector(side, run.side).addScaledVector(down, run.from * scale);
    const end = point.clone().addScaledVector(side, run.side).addScaledVector(down, run.to * scale);
    const half = start.distanceTo(end) / 2;
    if (half < 1e-4) return null;
    const reach = bleeding.mask.back;
    const back = reach !== undefined ? Math.max(0.01, reach)
      : bleeding.anchor ? Math.max(0.01, this.v.copy(point).sub(bleeding.anchor.getWorldPosition(this.w)).dot(normal)) : run.to;
    const poses = entry.meshes.map(item => this.pose(item.source));
    return {
      impactId: bleeding.impactId, origin: start.clone().lerp(end, 0.5), normal, axis: down,
      shape: new THREE.Vector4(half, 0, run.width, 0), amount: new THREE.Vector4(0, run.blood, 0, 0.35),
      reach: new THREE.Vector4(back, run.width * 4, 0, (bleeding.mask.strokes[0]?.seed ?? 0) % 997),
      poses, gate: this.gate(entry, start, end, run.width * 1.8, normal, back, run.width * 4, poses),
    };
  }

  private add(entry: Entry, paint: Paint): void {
    entry.paints.push(paint);
    if (!entry.rebuild) entry.pending.push(paint);
  }

  /**
   * The capsule round a paint in the sculpt's rest space, through the bone nearest it (the rigid part of the
   * skinning there): good to a few centimetres, which the radius covers.
   */
  private gate(entry: Entry, a: THREE.Vector3, b: THREE.Vector3, radius: number, normal: THREE.Vector3, back: number, front: number, poses: MeshPose[]): Gate {
    const toRest = this.restFrom(entry.meshes[0], poses[0], a.clone().add(b).multiplyScalar(0.5));
    // World units to rest units: the skinning's scale there.
    const e = toRest.elements, unit = Math.hypot(e[0], e[1], e[2]) || 1;
    return {
      a: a.clone().applyMatrix4(toRest), b: b.clone().applyMatrix4(toRest), radius: radius * unit,
      normal: normal.clone().transformDirection(toRest), back: back * unit, front: front * unit,
    };
  }

  /** The inverse of the skinning transform of the bone nearest `near` (world), as posed: world to the sculpt's rest space. Left in `this.m`. */
  private restFrom(item: BakeMesh | undefined, pose: MeshPose | undefined, near: THREE.Vector3): THREE.Matrix4 {
    const m = this.m;
    if (!item || !pose) return m.identity();
    const skinned = item.source as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh || !pose.bones || !pose.bind || !pose.bindInverse) return m.copy(pose.world).invert();
    const bones = skinned.skeleton.bones;
    // A bone folded to nothing (a severed limb's at its joint, death/sever, and everything under it) has no rest space
    // to map into: its inverse would blow the gate up over the whole figure. Only bones near the figure's own scale.
    let widest = 0;
    for (let i = 0; i < bones.length; i += 1) widest = Math.max(widest, Math.hypot(pose.bones[i * 16], pose.bones[i * 16 + 1], pose.bones[i * 16 + 2]));
    let best = 0, nearest = Infinity;
    for (let i = 0; i < bones.length; i += 1) {
      if (Math.hypot(pose.bones[i * 16], pose.bones[i * 16 + 1], pose.bones[i * 16 + 2]) < widest * 1e-2) continue;
      const bone = bones[i];
      const from = this.v.setFromMatrixPosition(bone.matrixWorld);
      // The bone runs from its joint to its first child's.
      const child = bone.children.find(node => (node as THREE.Bone).isBone);
      let distance: number;
      if (child) {
        const to = this.w.setFromMatrixPosition(child.matrixWorld).sub(from);
        const t = THREE.MathUtils.clamp(near.clone().sub(from).dot(to) / Math.max(1e-10, to.lengthSq()), 0, 1);
        distance = from.addScaledVector(to, t).distanceTo(near);
      } else distance = from.distanceTo(near);
      if (distance < nearest) { nearest = distance; best = i; }
    }
    // world = M · bindInverse · B · bind · rest
    this.n.fromArray(pose.bones, best * 16);
    m.copy(pose.world).multiply(pose.bindInverse).multiply(this.n).multiply(pose.bind).invert();
    return m;
  }

  /**
   * The figure's gates: one prism per paint, merged two by two until they fit, nearest and most alike first. Each
   * merge covers both: two that point the same way stay a prism, others become a plain capsule that takes in
   * their depth too.
   */
  private gates(entry: Entry): void {
    const list: Gate[] = entry.paints.map(paint => ({ ...paint.gate, a: paint.gate.a.clone(), b: paint.gate.b.clone(), normal: paint.gate.normal.clone() }));
    const centre = (gate: Gate) => gate.a.clone().add(gate.b).multiplyScalar(0.5);
    const across = (gate: Gate) => gate.radius + gate.a.distanceTo(gate.b) / 2;
    const alike = (one: Gate, two: Gate) => one.normal.lengthSq() > 0.25 && two.normal.lengthSq() > 0.25 && one.normal.dot(two.normal) > 0.7;
    const merge = (one: Gate, two: Gate): Gate => {
      const a = centre(one), b = centre(two);
      if (alike(one, two)) return { a, b, radius: Math.max(across(one), across(two)), normal: one.normal.clone().add(two.normal).normalize(), back: Math.max(one.back, two.back), front: Math.max(one.front, two.front) };
      const depth = (gate: Gate) => gate.normal.lengthSq() > 0.25 ? Math.max(gate.back, gate.front) : 0;
      return { a, b, radius: Math.max(across(one) + depth(one), across(two) + depth(two)), normal: new THREE.Vector3(), back: 0, front: 0 };
    };
    while (list.length > WOUND_GATES) {
      let bi = 0, bj = 1, cost = Infinity;
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
        const merged = merge(list[i], list[j]), size = merged.radius + merged.a.distanceTo(merged.b) / 2 + Math.max(merged.back, merged.front);
        if (size < cost) { cost = size; bi = i; bj = j; }
      }
      list[bi] = merge(list[bi], list[bj]);
      list.splice(bj, 1);
    }
    const gates = entry.wear.gates;
    gates.fill(0);
    list.forEach((gate, i) => {
      gates.set([gate.a.x, gate.a.y, gate.a.z, gate.radius, gate.b.x, gate.b.y, gate.b.z, gate.back, gate.normal.x, gate.normal.y, gate.normal.z, gate.front], i * WOUND_GATE_FLOATS);
    });
    entry.wear.gateCount = list.length;
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const renderer = this.renderer;
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear, alpha = renderer.getClearAlpha(), reset = renderer.info.autoReset;
    renderer.getClearColor(this.colour);
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 0);
    try {
      for (const entry of this.entries.values()) {
        if (!entry.rebuild && !entry.pending.length) continue;
        if (entry.rebuild) {
          renderer.setRenderTarget(entry.target);
          renderer.clear(true, false, false);
          for (const paint of entry.paints) this.drawPaint(entry, paint);
          entry.rebuild = false;
          if (entry.retired) { this.recycle(entry.retired.target, entry.retired.size); entry.retired = null; }
        } else for (const paint of entry.pending) this.drawPaint(entry, paint);
        entry.pending.length = 0;
        entry.wear.map = entry.target.texture;
        entry.drawn = true;
        this.show(entry);
      }
    } finally {
      for (const child of [...this.bakeScene.children]) this.bakeScene.remove(child);
      renderer.setRenderTarget(target);
      renderer.setClearColor(this.colour, alpha);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = reset;
    }
  }

  private drawPaint(entry: Entry, paint: Paint): void {
    const renderer = this.renderer, hit = this.hit(entry.size);
    renderer.setRenderTarget(hit);
    renderer.clear(true, false, false);
    entry.meshes.forEach((item, index) => {
      const pose = paint.poses[index];
      if (!pose) return;
      const material = this.material(item.uv), u = material.uniforms;
      (u.uOrigin.value as THREE.Vector3).copy(paint.origin);
      (u.uNormal.value as THREE.Vector3).copy(paint.normal);
      (u.uAxis.value as THREE.Vector3).copy(paint.axis);
      (u.uShape.value as THREE.Vector4).copy(paint.shape);
      (u.uAmount.value as THREE.Vector4).copy(paint.amount);
      (u.uReach.value as THREE.Vector4).copy(paint.reach);
      // About six noise cells across a stroke's opening, whatever units the sculpt is in.
      const world = Math.hypot(pose.world.elements[0], pose.world.elements[1], pose.world.elements[2]) || 1;
      u.uRestCells.value = world / Math.max(1e-4, (paint.shape.y || paint.shape.z) * 0.6);
      const bake = item.bake;
      bake.matrixWorld.copy(pose.world);
      if (item.frozen && pose.bones && pose.bind && pose.bindInverse) {
        const skinned = bake as THREE.SkinnedMesh;
        item.frozen.boneMatrices?.set(pose.bones);
        if (item.frozen.boneTexture) item.frozen.boneTexture.needsUpdate = true;
        skinned.bindMatrix.copy(pose.bind);
        skinned.bindMatrixInverse.copy(pose.bindInverse);
      }
      material.uniformsNeedUpdate = true;
      this.bakeScene.add(bake);
      renderer.render(this.bakeScene, this.camera);
      this.bakeScene.remove(bake);
    });
    renderer.setRenderTarget(entry.target);
    this.dilate.uniforms.uHit.value = hit.texture;
    renderer.render(this.quadScene, this.camera);
    this.draws += paintDraws(entry.meshes.length);
  }
}
