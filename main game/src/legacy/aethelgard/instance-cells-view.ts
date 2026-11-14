import { Box3, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshDepthMaterial, Sphere, Vector3, type Camera, type Material, type Object3D } from 'three';
import {
  createEaldholtInstanceCellHeadroom, createEaldholtInstanceCellSelector, createEaldholtInstanceCellUniforms, defaultEaldholtInstanceCellTiers,
  ealdholtInstanceCellIndexSteps, ealdholtInstanceCellLevelFraction, ealdholtProjectionFocalPixels, patchEaldholtInstanceCellShader, readEaldholtInstanceCellTiers,
  EALDHOLT_INSTANCE_CELL_ATTRIBUTE, EALDHOLT_INSTANCE_CELL_PROFILES, EALDHOLT_INSTANCE_CELL_SHADER_KEY,
  type EaldholtFoliageQuality, type EaldholtInstanceCellBudget, type EaldholtInstanceCellDiagnostics, type EaldholtInstanceCellIndex,
  type EaldholtInstanceCellIndexOptions, type EaldholtInstanceCellKind, type EaldholtInstanceCellKindRule, type EaldholtInstanceCellLayerInput,
  type EaldholtInstanceCellLodCost, type EaldholtInstanceCellProfile, type EaldholtInstanceCellUniforms,
} from '../../../../shared/legacy/aethelgard/environment/instance-cells';
export type { EaldholtFoliageQuality, EaldholtInstanceCellBudget, EaldholtInstanceCellKind, EaldholtInstanceCellProfile } from '../../../../shared/legacy/aethelgard/environment/instance-cells';

/** One drawable part of a prototype LOD. Borrowed: never disposed here. */
export interface EaldholtInstanceCellPart { readonly geometry: BufferGeometry; readonly material: Material | Material[] }
export interface EaldholtInstanceCellLayer {
  readonly id: string;
  readonly kind: EaldholtInstanceCellKind;
  /** Nearest LOD first. Derive every LOD from the same source so a band change
   * alters cost, never the plant. Parts with the same material form one slot:
   * their geometries must share attribute names, so a LOD change never compiles
   * a new program. Geometry and materials are borrowed. */
  readonly lods: readonly (readonly EaldholtInstanceCellPart[])[];
  /** Column-major matrices in this object's local frame, 16 per instance,
   * already in density-priority order (authored prefix or createEaldholtDensityOrder).
   * Read once while building; the view keeps no reference. */
  readonly matrices: Float32Array;
  /** Optional authored tiers in the userData.crownfallFoliageDensity schema;
   * `components` must equal the nearest LOD's part count. */
  readonly density?: unknown;
  readonly rule?: EaldholtInstanceCellKindRule;
  /** Overrides the kind default (rock, understory, debris and tree may cast). */
  readonly castShadow?: boolean;
  /** Overrides the kind default for coverage-preserving alpha mips. */
  readonly alphaMips?: boolean;
}
export interface EaldholtInstanceCellsOptions {
  readonly profile: EaldholtInstanceCellProfile;
  readonly quality: EaldholtFoliageQuality;
  readonly name?: string;
  readonly index?: Omit<EaldholtInstanceCellIndexOptions, 'profile'>;
  /** 'headroom' (default): the share follows observeFrame() measurements of the
   * rest of the scene; 'fixed': the profile (or index) caps. */
  readonly shares?: 'headroom' | 'fixed';
}
export interface EaldholtInstanceCellViewDiagnostics extends EaldholtInstanceCellDiagnostics {
  /** Meshes that may cast shadows and changed geometry, count or visibility in the last update. */
  changedShadowCasters: number;
  /** Focal length used by the last update, pixels per radian (0 when unknown). */
  actualFocalPixels: number;
  /** Worst recent base (scene minus cells) seen by observeFrame(). */
  headroomBaseDraws: number;
  headroomBaseTriangles: number;
  /** The rest of the scene alone exceeded the reserved budget in a recent frame. */
  overBudget: boolean;
}
export interface EaldholtInstanceCells {
  readonly object: Group;
  readonly index: EaldholtInstanceCellIndex;
  /** Complete bounds of every cell and LOD in the object's frame, hidden cells included. */
  readonly bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  readonly cellCount: number;
  readonly meshCount: number;
  readonly instanceCount: number;
  /** Owned instance matrices and cell attributes in bytes (GPU); three keeps an equal CPU copy. */
  readonly ownedInstanceBytes: number;
  /** Owned per-layer material clones (thinning patch) and depth materials. */
  readonly ownedMaterialCount: number;
  /** Synchronous build time in milliseconds, and the longest single step between yields. */
  readonly buildMilliseconds: number;
  readonly longestBuildStepMilliseconds: number;
  /** Live counters, updated in place. */
  readonly diagnostics: Readonly<EaldholtInstanceCellViewDiagnostics>;
  readonly disposed: boolean;
  setQuality(quality: EaldholtFoliageQuality): boolean;
  /** Pins the share (null returns to the configured mode). Returns true when it changed. */
  setShare(share: EaldholtInstanceCellBudget | null): boolean;
  /** Overrides the frustum slack in layer-local units (null restores the profile value). */
  setFrustumMargin(margin: number | null): boolean;
  /** Feeds the last rendered frame's whole-scene counts (renderer.info.render).
   * `views` is the number of times each draw was submitted (2 for non-multiview
   * stereo). Returns true when the share changed, so on-demand callers redraw. */
  observeFrame(calls: number, triangles: number, views?: number): boolean;
  /** Reselects cells for the camera's current world matrices. Pass the drawing
   * buffer height so band distances follow the real focal length. Allocates
   * nothing; returns true when a mesh changed, so on-demand callers redraw. */
  update(camera: Camera, drawingBufferHeight?: number): boolean;
  dispose(): void;
}
export interface EaldholtInstanceCellsAsyncControl {
  readonly signal?: AbortSignal;
  /** Awaited between build steps; defaults to a zero-delay timer. */
  readonly yieldToMain?: () => Promise<void>;
  /** Instances per index step and cells per mesh step (default 8192 / 96). */
  readonly instancesPerStep?: number;
  readonly cellsPerStep?: number;
}

const PATCHABLE = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshBasicMaterial', 'MeshToonMaterial', 'MeshMatcapMaterial']);
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

function partCost(part: EaldholtInstanceCellPart, label: string, box: Box3, scratch: Box3): { triangles: number; draws: number; signature: string } {
  const geometry = part.geometry, position = geometry?.getAttribute('position');
  const full = geometry?.index?.count ?? position?.count ?? 0;
  if (!position || !Number.isSafeInteger(full) || full < 3 || full % 3 || geometry.drawRange.start !== 0
    || (geometry.drawRange.count !== Infinity && geometry.drawRange.count !== full)
    || (geometry as BufferGeometry & { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry || Object.keys(geometry.morphAttributes).length)
    throw Error(`${label}: instance cell parts need complete, unmorphed, non-instanced triangle geometry.`);
  if (geometry.getAttribute(EALDHOLT_INSTANCE_CELL_ATTRIBUTE)) throw Error(`${label}: the ${EALDHOLT_INSTANCE_CELL_ATTRIBUTE} attribute name is reserved.`);
  let draws = 1;
  const materials = Array.isArray(part.material) ? part.material : [part.material];
  if (Array.isArray(part.material)) {
    let covered = 0;
    for (const group of [...geometry.groups].sort((a, b) => a.start - b.start)) {
      if (group.start !== covered || group.count <= 0 || group.count % 3 || !Number.isSafeInteger(group.materialIndex) || !part.material[group.materialIndex!])
        throw Error(`${label}: material groups must cover the geometry exactly.`);
      covered += group.count;
    }
    if (!geometry.groups.length || covered !== full) throw Error(`${label}: material groups must cover the geometry exactly.`);
    draws = geometry.groups.length;
  } else if (!part.material) throw Error(`${label}: every part needs a material.`);
  for (const material of materials) if (!material || !PATCHABLE.has(material.type))
    throw Error(`${label}: instance cells patch standard mesh materials only (got ${material?.type ?? 'none'}).`);
  // Full geometry bounds without writing the borrowed geometry's cache.
  scratch.setFromBufferAttribute(position as Parameters<Box3['setFromBufferAttribute']>[0]);
  if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) scratch.union(geometry.boundingBox);
  if (scratch.isEmpty() || ![...scratch.min.toArray(), ...scratch.max.toArray()].every(Number.isFinite)) throw Error(`${label}: part bounds must be finite.`);
  box.union(scratch);
  const signature = Object.keys(geometry.attributes).sort().map(name => {
    const attribute = geometry.attributes[name];
    return `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`;
  }).join(',') + (geometry.index ? '|indexed' : '|plain');
  return { triangles: full / 3, draws, signature };
}

/** Points a wrapper at a borrowed geometry's buffers, keeping its own cell attribute. */
function retarget(wrapper: BufferGeometry, source: BufferGeometry): void {
  wrapper.index = source.index;
  for (const name in source.attributes) wrapper.attributes[name] = source.attributes[name];
  wrapper.groups = source.groups;
}

interface PreparedLayer {
  readonly input: EaldholtInstanceCellLayerInput;
  readonly lods: readonly (readonly EaldholtInstanceCellPart[])[];
  /** Slot keys: one per distinct part material (repeated when a LOD uses a material twice). */
  readonly slotKeys: (Material | Material[])[];
  /** Per LOD: part index drawn in each slot, -1 when the LOD leaves the slot empty. */
  readonly slotParts: Int16Array[];
  readonly castShadow: boolean | undefined;
  readonly alphaMips: boolean | undefined;
}

function prepareLayer(layer: EaldholtInstanceCellLayer): PreparedLayer {
  if (!layer || !(layer.matrices instanceof Float32Array)) throw Error('Instance cell layers need Float32Array matrices.');
  if (!layer.lods?.length || layer.lods.some(parts => !parts?.length)) throw Error(`${layer.id}: every LOD needs at least one part.`);
  const box = new Box3().makeEmpty(), scratch = new Box3(), slotKeys: (Material | Material[])[] = [], signatures: string[] = [];
  const costs: EaldholtInstanceCellLodCost[] = [], slotParts: Int16Array[] = [];
  const assignments = layer.lods.map((parts, k) => {
    let triangles = 0, draws = 0;
    const used = new Map<Material | Material[], number>(), map: number[] = [];
    parts.forEach((part, p) => {
      const cost = partCost(part, `${layer.id} LOD ${k} part ${p}`, box, scratch);
      triangles += cost.triangles; draws += cost.draws;
      // The n-th part with a material goes to the n-th slot of that material.
      const nth = used.get(part.material) ?? 0; used.set(part.material, nth + 1);
      let seen = 0, slot = -1;
      for (let s = 0; s < slotKeys.length; s++) if (slotKeys[s] === part.material && seen++ === nth) { slot = s; break; }
      if (slot < 0) { slot = slotKeys.length; slotKeys.push(part.material); signatures.push(cost.signature); }
      else if (signatures[slot] !== cost.signature)
        throw Error(`${layer.id} LOD ${k} part ${p}: LODs sharing a material must share attribute layouts, so a band change never compiles a new program.`);
      map[slot] = p;
    });
    costs.push({ triangles, draws });
    return map;
  });
  for (const map of assignments) {
    const parts = new Int16Array(slotKeys.length).fill(-1);
    map.forEach((part, slot) => { if (part !== undefined) parts[slot] = part; });
    slotParts.push(parts);
  }
  const count = layer.matrices.length / 16;
  const tiers = layer.density === undefined ? defaultEaldholtInstanceCellTiers(Math.floor(count))
    : readEaldholtInstanceCellTiers(layer.density, Math.floor(count), layer.lods[0].length).tiers;
  return {
    input: { id: layer.id, kind: layer.kind, matrices: layer.matrices, lods: costs, tiers, rule: layer.rule,
      localBounds: { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] } },
    lods: layer.lods, slotKeys, slotParts, castShadow: layer.castShadow, alphaMips: layer.alphaMips,
  };
}

/** Owned per-layer clone of a borrowed material with the thinning patch
 * chained after the original's own onBeforeCompile. */
function patchedClone(original: Material, uniforms: EaldholtInstanceCellUniforms, layer: string): Material {
  const clone = original.clone(), compile = original.onBeforeCompile, key = original.customProgramCacheKey;
  clone.onBeforeCompile = function (shader, renderer) { compile.call(this, shader, renderer); patchEaldholtInstanceCellShader(shader, uniforms); };
  clone.customProgramCacheKey = function () { return key.call(original) + EALDHOLT_INSTANCE_CELL_SHADER_KEY; };
  // Cloning does not copy callback properties by itself.
  clone.onBeforeRender = original.onBeforeRender;
  clone.userData = { ...clone.userData, crownfallInstanceCellMaterial: { layer, source: original.uuid } };
  return clone;
}

/**
 * Cell-based instancing for groundcover, understory, rock, debris and tree
 * layers over the shared quadtree. Each cell owns one instance buffer and one
 * per-instance rank attribute, written once, and one InstancedMesh per material
 * slot its reachable LODs use. Materials are owned, patched per-layer clones,
 * assigned once at creation and never reassigned, so later material passes
 * (neutral fill, coverage mips) keep their replacements. A LOD change swaps
 * only the borrowed buffers inside the mesh's owned wrapper geometry; per frame
 * only `visible`, `count`, those buffer references and four uniforms change.
 * Density is continuous per instance in the vertex shader. Add `object` to the
 * frame the matrices were authored in, never inside an authored foliage family.
 */
function* buildSteps(layers: readonly EaldholtInstanceCellLayer[], options: EaldholtInstanceCellsOptions, instancesPerStep: number, cellsPerStep: number,
  timing: { total: number; longest: number; stepStart: number }): Generator<void, EaldholtInstanceCells, void> {
  const prepared = layers.map(prepareLayer);
  const steps = ealdholtInstanceCellIndexSteps(prepared.map(layer => layer.input), { ...options.index, profile: options.profile }, instancesPerStep);
  let index: EaldholtInstanceCellIndex;
  for (;;) { const next = steps.next(); if (next.done) { index = next.value; break; } yield; }
  const rules = EALDHOLT_INSTANCE_CELL_PROFILES[options.profile], mode = options.shares ?? 'headroom';
  const headroom = createEaldholtInstanceCellHeadroom(rules.headroom, index.budgets, options.quality);
  const selector = createEaldholtInstanceCellSelector(index, { quality: options.quality, share: mode === 'headroom' ? headroom.share : undefined });
  const object = new Group();
  object.name = options.name ?? 'House Ealdholt Instance Cells';
  const ownedMaterials: Material[] = [], slotMaterials: (Material | Material[])[][] = [], slotDepth: MeshDepthMaterial[][] = [];
  prepared.forEach((layer, l) => {
    const uniforms = createEaldholtInstanceCellUniforms(selector, l), clones = new Map<Material, Material>();
    const own = (material: Material) => {
      let clone = clones.get(material);
      if (!clone) { clone = patchedClone(material, uniforms, layer.input.id); clones.set(material, clone); ownedMaterials.push(clone); }
      return clone;
    };
    slotMaterials.push(layer.slotKeys.map(key => Array.isArray(key) ? key.map(own) : own(key)));
    slotDepth.push(layer.slotKeys.map(() => {
      // Shadow casters thin exactly like the main pass; three copies map, alphaTest and side from the mesh material.
      const depth = new MeshDepthMaterial();
      depth.onBeforeCompile = shader => { patchEaldholtInstanceCellShader(shader, uniforms); };
      depth.customProgramCacheKey = () => EALDHOLT_INSTANCE_CELL_SHADER_KEY + ':depth';
      ownedMaterials.push(depth);
      return depth;
    }));
  });
  const meshes: InstancedMesh[] = [], wrappers: BufferGeometry[] = [], wrapperSource: BufferGeometry[] = [], meshSlot: number[] = [];
  const maxLodBias = Math.max(index.tierLodBias.low, index.tierLodBias.medium, index.tierLodBias.high);
  const cellMeshStart = new Uint32Array(index.cellCount + 1);
  let ownedInstanceBytes = 0;
  for (let c = 0; c < index.cellCount; c++) {
    cellMeshStart[c] = meshes.length;
    const l = index.cellLayer[c], layer = prepared[l], summary = index.layers[l], settings = summary.settings, level = index.cellLevel[c], n = index.cellInstances[c];
    if (n === 0) continue; // Nothing this level can draw; its children may.
    // Slots used by any LOD this level can draw on any tier (band LOD plus tier bias), with the first LOD that fills each.
    const firstLod = new Int16Array(layer.slotKeys.length).fill(-1);
    for (let b = level; b < settings.bandLods.length; b++) for (let bias = 0; bias <= maxLodBias; bias++) {
      const k = Math.min(settings.bandLods[b] + bias, layer.lods.length - 1);
      for (let s = 0; s < firstLod.length; s++) if (firstLod[s] < 0 && layer.slotParts[k][s] >= 0) firstLod[s] = k;
    }
    const matrices = new Float32Array(n * 16), cells = new Float32Array(n * 2), source = layer.input.matrices, start = index.cellStart[c];
    const fraction = ealdholtInstanceCellLevelFraction(index, l, level);
    for (let i = 0; i < n; i++) {
      const rank = index.order[start + i], from = rank * 16;
      for (let k = 0; k < 16; k++) matrices[i * 16 + k] = source[from + k];
      cells[i * 2] = rank; cells[i * 2 + 1] = fraction;
    }
    const instances = new InstancedBufferAttribute(matrices, 16), cellAttribute = new InstancedBufferAttribute(cells, 2);
    ownedInstanceBytes += matrices.byteLength + cells.byteLength;
    const o = c * 6, b = index.cellBounds;
    const cellBox = new Box3(new Vector3(b[o], b[o + 1], b[o + 2]), new Vector3(b[o + 3], b[o + 4], b[o + 5]));
    const castShadow = layer.castShadow ?? settings.castShadow, alphaMips = layer.alphaMips ?? settings.alphaMips;
    for (let s = 0; s < firstLod.length; s++) {
      if (firstLod[s] < 0) continue;
      const initial = layer.lods[firstLod[s]][layer.slotParts[firstLod[s]][s]].geometry, wrapper = new BufferGeometry();
      retarget(wrapper, initial);
      wrapper.setAttribute(EALDHOLT_INSTANCE_CELL_ATTRIBUTE, cellAttribute);
      wrapper.name = `${layer.input.id} cell wrapper`;
      const mesh = new InstancedMesh(wrapper, slotMaterials[l][s], 0);
      // Every mesh of a cell shares one matrix buffer and one rank buffer, written once.
      mesh.instanceMatrix = instances; mesh.count = 0; mesh.visible = false;
      mesh.name = `${object.name} ${layer.input.id} L${level} ${index.cellX[c]},${index.cellZ[c]}${firstLod.length > 1 ? ` slot ${s}` : ''}`;
      // Conservative over every LOD and region instance: a band change never alters culling.
      mesh.boundingBox = cellBox.clone(); mesh.boundingSphere = cellBox.getBoundingSphere(new Sphere());
      mesh.customDepthMaterial = slotDepth[l][s];
      // The caller decides casting by distance; castShadow below is the layer's permission.
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.crownfallInstanceCell = { cell: c, layer: layer.input.id, kind: layer.input.kind, level, x: index.cellX[c], z: index.cellZ[c], slot: s, castShadow, alphaMips };
      object.add(mesh); meshes.push(mesh); wrappers.push(wrapper); wrapperSource.push(initial); meshSlot.push(s);
    }
    if (c % cellsPerStep === cellsPerStep - 1) yield;
  }
  cellMeshStart[index.cellCount] = meshes.length;
  object.userData.crownfallInstanceCells = { schema: 2, profile: options.profile, borrowedGeometryAndMaterials: true, ownedMaterialClones: ownedMaterials.length,
    layers: index.layers.map((layer, l) => ({ id: layer.id, kind: layer.kind, instances: layer.instances, cells: layer.cells, levels: layer.levels, tiers: layer.tiers,
      castShadow: prepared[l].castShadow ?? layer.settings.castShadow, alphaMips: prepared[l].alphaMips ?? layer.settings.alphaMips })) };
  const view = new Matrix4(), clip = new Matrix4(), localFromWorld = new Matrix4(), eye = new Vector3();
  const layerLods = prepared.map(layer => layer.lods), layerSlotParts = prepared.map(layer => layer.slotParts);
  const diagnostics = Object.assign(selector.diagnostics, { changedShadowCasters: 0, actualFocalPixels: 0, headroomBaseDraws: 0, headroomBaseTriangles: 0, overBudget: false });
  let disposed = false, ancestryChecked = false, pinned = false, margin = index.frustumMargin;

  function apply(cell: number): void {
    const lod = selector.lod[cell], count = selector.count[cell], start = cellMeshStart[cell], end = cellMeshStart[cell + 1], l = index.cellLayer[cell];
    const parts = lod >= 0 ? layerSlotParts[l][lod] : null;
    for (let m = start; m < end; m++) {
      const mesh = meshes[m], part = parts !== null ? parts[meshSlot[m]] : -1;
      if (part < 0) {
        if (mesh.visible) { mesh.visible = false; if (mesh.castShadow) diagnostics.changedShadowCasters++; }
        continue;
      }
      const geometry = layerLods[l][lod][part].geometry;
      let changed = false;
      if (wrapperSource[m] !== geometry) { retarget(wrappers[m], geometry); wrapperSource[m] = geometry; changed = true; }
      if (mesh.count !== count) { mesh.count = count; changed = true; }
      if (!mesh.visible) { mesh.visible = true; changed = true; }
      if (changed && mesh.castShadow) diagnostics.changedShadowCasters++;
    }
  }
  function applyShare(): boolean {
    return selector.setShare(headroom.share.draws, headroom.share.triangles);
  }

  timing.total += now() - timing.stepStart;
  return {
    object, index, bounds: index.bounds ? { min: [...index.bounds.min], max: [...index.bounds.max] } : null,
    cellCount: index.cellCount, meshCount: meshes.length, instanceCount: index.instanceCount, ownedInstanceBytes, ownedMaterialCount: ownedMaterials.length,
    get buildMilliseconds() { return timing.total; }, get longestBuildStepMilliseconds() { return timing.longest; },
    diagnostics,
    get disposed() { return disposed; },
    setQuality(quality) {
      if (disposed) return false;
      const changed = selector.setTier(quality);
      if (changed) {
        headroom.setTier(quality);
        if (!pinned) { if (mode === 'headroom') applyShare(); else selector.setShare(index.budgets[quality].draws, index.budgets[quality].triangles); }
      }
      return changed;
    },
    setShare(share) {
      if (disposed) return false;
      if (share === null) {
        pinned = false;
        return mode === 'headroom' ? applyShare() : selector.setShare(index.budgets[selector.tier].draws, index.budgets[selector.tier].triangles);
      }
      pinned = true;
      return selector.setShare(share.draws, share.triangles);
    },
    setFrustumMargin(next) {
      if (disposed) return false;
      const value = next ?? index.frustumMargin;
      if (value === margin) return false;
      margin = value;
      return selector.setFrustumMargin(value);
    },
    observeFrame(calls, triangles, views = 1) {
      if (disposed || mode !== 'headroom') return false;
      const copies = Number.isFinite(views) && views >= 1 ? views : 1;
      const changed = headroom.observe(calls, triangles, diagnostics.drawCalls * copies, diagnostics.triangles * copies);
      diagnostics.headroomBaseDraws = headroom.base.draws; diagnostics.headroomBaseTriangles = headroom.base.triangles; diagnostics.overBudget = headroom.overBudget;
      return changed && !pinned ? applyShare() : false;
    },
    update(camera, drawingBufferHeight = 0) {
      if (disposed) return false;
      if (!ancestryChecked) {
        for (let node: Object3D | null = object.parent; node; node = node.parent)
          if (node.userData.crownfallFoliageDensity !== undefined) throw Error('Instance cells must not be nested inside an authored foliage family.');
        ancestryChecked = true;
      }
      object.updateWorldMatrix(true, false);
      view.copy(camera.matrixWorld).invert();
      clip.multiplyMatrices(camera.projectionMatrix, view).multiply(object.matrixWorld);
      localFromWorld.copy(object.matrixWorld).invert();
      eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(localFromWorld);
      // Band distances follow the real focal length (field of view and drawing-buffer height).
      const focal = ealdholtProjectionFocalPixels(camera.projectionMatrix.elements, drawingBufferHeight);
      diagnostics.actualFocalPixels = focal;
      const changed = selector.update(eye.x, eye.y, eye.z, clip.elements, focal > 0 ? index.focalPixels / focal : 1);
      diagnostics.changedShadowCasters = 0;
      for (let i = 0; i < changed; i++) apply(selector.changed[i]);
      return changed > 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      // Release only owned GPU buffers: strip the borrowed buffers from each
      // wrapper first, so its disposal frees the cell attribute and binding state alone.
      for (const wrapper of wrappers) {
        wrapper.index = null;
        for (const name of Object.keys(wrapper.attributes)) if (name !== EALDHOLT_INSTANCE_CELL_ATTRIBUTE) wrapper.deleteAttribute(name);
        wrapper.dispose();
      }
      for (const mesh of meshes) mesh.dispose();
      for (const material of ownedMaterials) material.dispose();
      object.clear(); meshes.length = 0; wrappers.length = 0; wrapperSource.length = 0;
    },
  };
}

export function createEaldholtInstanceCells(layers: readonly EaldholtInstanceCellLayer[], options: EaldholtInstanceCellsOptions): EaldholtInstanceCells {
  const timing = { total: 0, longest: 0, stepStart: now() };
  const steps = buildSteps(layers, options, 1 << 30, 1 << 30, timing);
  for (;;) {
    const next = steps.next();
    if (next.done) { timing.longest = timing.total; return next.value; }
  }
}

/** The same view, built in steps that yield to the main thread between layers,
 * instance chunks and mesh chunks, so setup never becomes one long task. */
export async function createEaldholtInstanceCellsAsync(layers: readonly EaldholtInstanceCellLayer[], options: EaldholtInstanceCellsOptions,
  control: EaldholtInstanceCellsAsyncControl = {}): Promise<EaldholtInstanceCells> {
  const yieldToMain = control.yieldToMain ?? (() => new Promise<void>(resolve => { setTimeout(resolve, 0); }));
  const timing = { total: 0, longest: 0, stepStart: now() };
  const steps = buildSteps(layers, options, control.instancesPerStep ?? 8192, control.cellsPerStep ?? 96, timing);
  for (;;) {
    control.signal?.throwIfAborted();
    const next = steps.next();
    if (next.done) {
      const elapsed = now() - timing.stepStart; timing.longest = Math.max(timing.longest, elapsed);
      if (control.signal?.aborted) { next.value.dispose(); control.signal.throwIfAborted(); }
      return next.value;
    }
    const elapsed = now() - timing.stepStart; timing.total += elapsed; timing.longest = Math.max(timing.longest, elapsed);
    await yieldToMain();
    timing.stepStart = now();
  }
}
