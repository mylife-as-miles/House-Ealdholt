import {acceptVegetationBranchL2,VEGETATION_BRANCH_L2} from '../../../../shared/legacy/aethelgard/environment/vegetation-branch-l2';
import {createVegetationGeometryView} from './vegetation-geometry-view';
import {Box3, BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Vector2, Vector3, type Camera, type Material, type Object3D,
  type Scene, type WebGLRenderer} from 'three';
import {createVegetationHandoff, TREE_HLOD, vegetationLodDistance} from '../../../../shared/legacy/aethelgard/environment/vegetation-hlod';
import {patchEaldholtNeutralFill} from '../../../../shared/legacy/aethelgard/environment/neutral-fill';
import {patchVegetationFade, patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import {createVegetationPrototypeResources, vegetationPrototypeKey, type PreparedVegetationAtlas, type VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';
import {readAuthoredWoodlandMatrix, type EaldholtWoodlandVisibility} from './woodland-visibility';

type Draw = {mesh: InstancedMesh; sourcePart: number};
type Level = {draws: Draw[]; range: InstancedBufferAttribute; prior: Uint32Array; count: number};
export function createEaldholtTreeHlod(root: Object3D, visibility: EaldholtWoodlandVisibility, options: {
  renderer: WebGLRenderer; scene: Scene; camera: Camera; queue: WorldPreparationQueue;
  worker: VegetationPreparationWorker; signal: AbortSignal; changed: () => void; native?: boolean; atlasTileSize?: 64 | 128; resources?: VegetationPrototypeResources;
}) {
  const sources = root.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh);
  const total = visibility.stats.total;
  if (sources.length !== 3 || total < 1 || total > 8192 || sources.some(s => !(s.material instanceof MeshStandardMaterial) ||
      Object.keys(s.geometry.morphAttributes).length)) throw Error('Tree HLOD requires a complete static source family.');
  const materials = new Set<Material>(), geometries = new Set<BufferGeometry>();
  const resources = options.resources ?? createVegetationPrototypeResources(options.renderer, options.queue, options.worker, options.native ? 32 * 1024 * 1024 : 128 * 1024 * 1024);
  const leases: {release(): void}[] = [], views: ReturnType<typeof createVegetationGeometryView>[] = [];
  const original = sources.map(mesh => ({before: mesh.onBeforeRender, after: mesh.onAfterRender}));
  let sourceColour = false;
  const group = new Group(); group.name = 'Source-derived tree HLOD';
  const matrix = new Matrix4();
  const sourceMatrices = sources.map(mesh => {
    const values = new Float32Array(total * 16);
    mesh.updateMatrix();
    for (let id = 0; id < total; id++) { readAuthoredWoodlandMatrix(mesh, id, matrix); matrix.premultiply(mesh.matrix).toArray(values, id * 16); }
    return values;
  });
  const inverseReference = new Matrix4().fromArray(sourceMatrices[0]).invert();
  const parts: VegetationCapturePart[] = sources.map((mesh, part) => ({geometry: mesh.geometry,
    material: mesh.material as MeshStandardMaterial,
    frame: inverseReference.clone().multiply(new Matrix4().fromArray(sourceMatrices[part], 0)),
    foliage: /TwoSided|foliage|canopy|leaves/i.test((mesh.material as Material).name) || (mesh.material as Material).side === DoubleSide}));
  if (!parts.some(p => p.foliage) || parts.every(p => p.foliage)) throw Error('Tree source needs identified bark and canopy surfaces.');
  const originalWind = sources.map(source => source.userData.crownfallVegetationWind);
  const windBounds = new Box3();
  for (const part of parts) { if (!part.geometry.boundingBox) part.geometry.computeBoundingBox(); windBounds.union(part.geometry.boundingBox!.clone().applyMatrix4(part.frame)); }
  function bindWind(mesh: InstancedMesh, part: number | null) {
    if (part !== null && !parts[part].foliage) return;
    const frame = part === null ? new Matrix4() : parts[part].frame.clone().invert();
    mesh.userData.crownfallVegetationWind = {root: new Vector3(0, windBounds.min.y, 0).applyMatrix4(frame).toArray(), tip: new Vector3(0, windBounds.max.y, 0).applyMatrix4(frame).toArray(), grass: false};
  }
  sources.forEach((source, part) => bindWind(source, part));

  for (let id = 0; id < total; id++) for (let part = 1; part < sources.length; part++) {
    const expected = new Matrix4().fromArray(sourceMatrices[0], id * 16).multiply(parts[part].frame), actual = new Matrix4().fromArray(sourceMatrices[part], id * 16);
    if (expected.elements.some((value, i) => Math.abs(value - actual.elements[i]) > .0001)) throw Error('Tree actor components do not share stable source frames.');
  }
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(); options.signal.addEventListener('abort', abort, {once: true});
  if (options.signal.aborted) controller.abort();
  const centres = Array.from({length: total}, (_, id) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(sourceMatrices[0], id * 16)));
  const handoffs = centres.map(() => createVegetationHandoff(TREE_HLOD)), levels: (Level | null)[] = [null, null, null, null];
  const states: ReturnType<ReturnType<typeof createVegetationHandoff>['update']>[] = new Array(total);
  const selected = new Uint32Array(total), localEye = new Vector3(), worldEye = new Vector3();
  const sourceEye = {value: new Vector3()};
  let ready = 1, disposed = false;
  const stats = {status: 'preparing' as 'preparing' | 'ready' | 'error', error: '', readyMask: ready,
    atlasCoverage: [] as number[], levels: [0, 0, 0, 0], transitioning: 0, geometryBytes: 0, atlasBytes: 0, sourceTriangles: 0, simplifiedTriangles: 0, l2BranchProfile: VEGETATION_BRANCH_L2.version, l1BranchTriangles: 0, l2BranchTriangles: 0, l2BranchFallbacks: 0, l2BranchError: 0, l2BranchSelectedBytes: 0};
  const ownGeometry = (g: BufferGeometry) => {geometries.add(g); stats.geometryBytes += Object.values(g.attributes).reduce((n, a) => n + a.array.byteLength, g.index?.array.byteLength ?? 0); return g;};
  function fade(source: Material): Material {
    const clone = source.clone(), compile = source.onBeforeCompile, key = source.customProgramCacheKey;
    clone.onBeforeCompile = function(shader, renderer) {compile.call(this, shader, renderer); patchVegetationFade(shader);};
    clone.customProgramCacheKey = () => key.call(source) + ':crownfall-hlod-fade-v1'; materials.add(clone); return clone;
  }
  function newLevel(): Level {return {draws: [], range: new InstancedBufferAttribute(new Float32Array(total * 2), 2), prior: new Uint32Array(total).fill(0xffffffff), count: -1};}
  function addDraw(level: Level, geometry: BufferGeometry, material: Material, sourcePart: number, borrowedDerivative = false) {
    const view = borrowedDerivative ? createVegetationGeometryView(geometry, level.range) : null; if (view) views.push(view);
    const g = view?.geometry ?? ownGeometry(geometry.clone()); if (!view) g.setAttribute('crownfallLodRange', level.range);
    const mesh = new InstancedMesh(g, fade(material), total); mesh.count = 0; mesh.castShadow = false;
    bindWind(mesh, material.name === 'Crownfall vegetation captured canopy' ? null : sourcePart);
    mesh.raycast = () => {}; // Original source/collision data owns picking.
    mesh.receiveShadow = sources[sourcePart].receiveShadow; mesh.frustumCulled = false; level.draws.push({mesh, sourcePart});
    return mesh;
  }
  const l0 = newLevel(); levels[0] = l0;
  for (let slot = 0; slot < total; slot++) l0.range.setXY(slot, 0, 1);
  try {
    for (let part = 0; part < sources.length; part++) {
      group.add(addDraw(l0, sources[part].geometry, sources[part].material as Material, part));
      // Preserve the source family's independent shadow/reflection path. Its
      // ordinary colour draw submits zero instances; owned L0 draws compact
      // just the trees whose near-detail fade still has nonzero coverage.
      const source=sources[part], prior=original[part];let colourCount:number|null=null;
      source.onBeforeRender=function(...args){prior.before.apply(this,args);if(!sourceColour){colourCount=this.count;this.count=0;}};
      source.onAfterRender=function(...args){if(colourCount!==null){this.count=colourCount;colourCount=null;}prior.after.apply(this,args);};
    }
    root.add(group);
  } catch (cause) { release(); throw cause; }
  function release() {
    controller.abort(); for (const lease of leases) lease.release(); if (!options.resources) resources.dispose(); options.signal.removeEventListener('abort', abort); group.removeFromParent();
    for (let part = 0; part < sources.length; part++) {sources[part].onBeforeRender=original[part].before;sources[part].onAfterRender=original[part].after; if (originalWind[part] === undefined) delete sources[part].userData.crownfallVegetationWind; else sources[part].userData.crownfallVegetationWind = originalWind[part];}
    group.clear();
    const retire = () => {
      for (const level of levels) for (const draw of level?.draws ?? []) draw.mesh.dispose();
      for (const material of materials) material.dispose(); for (const view of views) view.dispose(); for (const geometry of geometries) geometry.dispose();
      materials.clear(); geometries.clear();
    };
    // Three's asynchronous compiler has no abort API. Restore source bindings
    // now, but keep its owned programs alive until submitted work completes.
    if (options.queue.pending) void options.queue.whenIdle().then(retire); else retire();
  }
  async function compile(level: Level) {
    signal.throwIfAborted();
    // Compile against the live lights, but never insert a half-prepared level.
    for (const draw of level.draws) {
      const preview = new Group(); preview.add(draw.mesh);
      try { await options.queue.enqueue({bytes: 0, signal, priority: () => 30, work: () => options.renderer.compileAsync(preview, options.camera, options.scene)}); }
      finally { preview.clear(); }
    }
    signal.throwIfAborted();
    for (const draw of level.draws) group.add(draw.mesh);
  }
  function atlasMaterial(atlas: PreparedVegetationAtlas): MeshStandardMaterial {
    const {record, maps} = atlas;
    if (!record.coverage || record.coverage.length !== record.views || record.coverage.some(value => !Number.isFinite(value) || value <= 0 || value > 1)) throw Error('Incomplete source vegetation capture coverage.');
    stats.atlasCoverage.push(...record.coverage); stats.atlasBytes += atlas.bytes;
    const inherited = parts.find(part => part.foliage)!.material;
    const material = new MeshStandardMaterial({name: 'Crownfall vegetation captured canopy', map: maps[0], alphaTest: 82 / 255, side: DoubleSide, roughness: inherited.roughness, envMap: inherited.envMap, envMapIntensity: inherited.envMapIntensity});
    const uniforms = {crownfallSourceEye: sourceEye, crownfallAtlasCentre: {value: new Vector3(...record.centre)},
      crownfallAtlasExtent: {value: new Vector2(...record.extent)}, crownfallAtlasViews: {value: record.views},
      crownfallAtlasGrid: {value: new Vector2(record.columns, record.rows)}, crownfallAtlasPixels: {value: new Vector2(record.mips[0].width, record.mips[0].height)},
      crownfallAtlasMaximumMip: {value: Math.max(0, Math.log2(record.tileSize) - 2)}, crownfallAtlasNormalMap: {value: maps[1]}};
    material.onBeforeCompile = shader => {Object.assign(shader.uniforms, uniforms); patchVegetationImpostor(shader); if (inherited.userData.crownfallNeutralIbl) patchEaldholtNeutralFill(shader);};
    material.customProgramCacheKey = () => 'crownfall-source-normal-impostor-v2:' + Boolean(inherited.userData.crownfallNeutralIbl); materials.add(material); return material;
  }
  const preparation = (async () => {
    const simplified: BufferGeometry[] = [];
    for (const part of parts) {
      signal.throwIfAborted();
      const geometry = part.geometry, position = geometry.getAttribute('position');
      const entries = Object.entries(geometry.attributes).filter(([name]) => /^(normal|tangent|uv[0-9]*|color)$/.test(name));
      const preserved = entries.map(([, attribute]) => attribute);
      const attributeWeights = entries.flatMap(([name, attribute]) => Array<number>(attribute.itemSize).fill(name === 'tangent' ? .01 : name === 'normal' ? .1 : .2));
      const stride = preserved.reduce((n, attribute) => n + attribute.itemSize, 0);
      if (stride < 3 || stride > 32) throw Error('Source vegetation attributes exceed the simplifier contract.');
      const positions = new Float32Array(position.count * 3), attributes = new Float32Array(position.count * stride), p = new Vector3();
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i).toArray(positions, i * 3); let offset = i * stride;
        for (const attribute of preserved) for (let channel = 0; channel < attribute.itemSize; channel++) attributes[offset++] = attribute.getComponent(i, channel);
      }
      const indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({length: position.count}, (_, i) => i);
      stats.sourceTriangles += indices.length / 3;
      const lease = resources.indices(vegetationPrototypeKey([part]), {positions, attributes, indices, stride, foliage: part.foliage, attributeWeights, ratio: part.foliage ? .6 : .35, error: part.foliage ? .008 : .015});
      leases.push(lease); const derived = await lease.ready;
      signal.throwIfAborted(); const g = ownGeometry(geometry.clone()); g.setIndex(new BufferAttribute(derived.indices, 1)); simplified.push(g);
      stats.simplifiedTriangles += derived.indices.length / 3;
    }
    const l1 = newLevel(); levels[1] = l1;
    parts.forEach((part, i) => addDraw(l1, simplified[i], part.material, i)); await compile(l1); ready |= 2; stats.readyMask = ready; options.changed();
    const tileSize = options.atlasTileSize ?? (options.native ? 64 : 128);
    const canopyLease = resources.atlas(parts, tileSize, 16, true, false, 35); leases.push(canopyLease);
    const canopy = await canopyLease.ready; signal.throwIfAborted();
    const l2 = newLevel(); levels[2] = l2;
    for (let i = 0; i < parts.length; i++) if (!parts[i].foliage) {
      const part = parts[i], prior = simplified[i], l1Triangles = prior.index!.count / 3;
      let geometry = prior, triangles = l1Triangles, borrowedDerivative = false; stats.l1BranchTriangles += l1Triangles;
      try {
        if ((part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3 < VEGETATION_BRANCH_L2.minimumSourceTriangles) {stats.l2BranchFallbacks++;}
        else {const lease = resources.geometry(part, 'l2-branches'); leases.push(lease); const branch = await lease.ready;
        signal.throwIfAborted(); if (disposed) return;
        if (acceptVegetationBranchL2(branch.sourceTriangles, l1Triangles, branch.triangles, branch.error)) {
          geometry = branch.geometry; triangles = branch.triangles; borrowedDerivative = true; stats.l2BranchError = Math.max(stats.l2BranchError, branch.error); stats.l2BranchSelectedBytes += branch.bytes;
        } else {stats.l2BranchFallbacks++; lease.release();}}
      } catch (cause) { if (disposed || signal.aborted) return; stats.l2BranchFallbacks++; }
      stats.l2BranchTriangles += triangles; addDraw(l2, geometry, part.material, i, borrowedDerivative);
    }
    const card = ownGeometry(new PlaneGeometry(1, 1));
    addDraw(l2, card, atlasMaterial(canopy), 0); await compile(l2); ready |= 4; stats.readyMask = ready; options.changed();
    const fullLease = resources.atlas(parts, tileSize, 8, false, false, 35); leases.push(fullLease);
    const full = await fullLease.ready; signal.throwIfAborted();
    const l3 = newLevel(); levels[3] = l3;
    addDraw(l3, card, atlasMaterial(full), 0); await compile(l3); ready |= 8;
    stats.readyMask = ready; stats.status = 'ready'; options.changed();
  })().catch(cause => {if (!disposed && !signal.aborted) {stats.status = 'error'; stats.error = cause instanceof Error ? cause.message : String(cause); options.changed();}});
  return {stats, preparation,
    update(now: number, camera: Camera, quality: 'low' | 'medium' | 'high', reducedMotion = false) {
      if (disposed) return;
      sourceColour=false;
      root.updateWorldMatrix(true, false); worldEye.setFromMatrixPosition(camera.matrixWorld); localEye.copy(worldEye); root.worldToLocal(localEye); sourceEye.value.copy(localEye);
      let selectedCount = 0;
      for (let slot = 0; slot < visibility.stats.visibleActors; slot++) {const id = visibility.sourceOrdinalForDrawSlot(slot); if (id !== null) selected[selectedCount++] = id;}
      // XR eye projections may not update the convenience .fov property.
      const perspective = camera instanceof PerspectiveCamera;
      const projection = Math.max(1e-6, Math.abs(camera.projectionMatrix.elements[5]));
      const fovScale = perspective ? 1 / projection / Math.tan(Math.PI / 6) : 1;
      const orthographicDistance = 1 / projection / Math.max(1e-6, root.matrixWorld.getMaxScaleOnAxis()) / Math.tan(Math.PI / 6);
      const qualityScale = (quality === 'low' ? .7 : quality === 'medium' ? 1 : 1.25) * (options.native ? .65 : 1);
      stats.levels.fill(0); stats.transitioning = 0;
      for (let slot = 0; slot < selectedCount; slot++) {
        const id = selected[slot];
        const state = handoffs[id].update(now, vegetationLodDistance({distanceMetres: perspective ? localEye.distanceTo(centres[id]) : orthographicDistance, projectionScale: fovScale, qualityScale}), ready, reducedMotion);
        states[id] = state; if (state.transitioning) stats.transitioning++;
      }
      for (let levelId = 0; levelId < 4; levelId++) {
        const level = levels[levelId]; if (!level) continue;
        let count = 0, changed = false, rangeChanged = false;
        for (let slot = 0; slot < selectedCount; slot++) {
          const id = selected[slot], state = states[id];
          if (state.weights[levelId] <= .000001) continue;
          if (level.prior[count] !== id) {level.prior[count] = id; changed = true;}
          const low = state.ranges[levelId * 2], high = state.ranges[levelId * 2 + 1];
          if (level.range.getX(count) !== low || level.range.getY(count) !== high) {level.range.setXY(count, low, high); rangeChanged = true;}
          if (state.weights[levelId] > .000001) stats.levels[levelId]++;
          count++;
        }
        changed ||= count !== level.count; level.count = count;
        if (rangeChanged) level.range.needsUpdate = true;
        for (const {mesh, sourcePart} of level.draws) {
          if (changed) {const dst = mesh.instanceMatrix.array as Float32Array, src = sourceMatrices[sourcePart]; for (let slot = 0; slot < count; slot++) for (let i = 0; i < 16; i++) dst[slot * 16 + i] = src[level.prior[slot] * 16 + i]; mesh.instanceMatrix.needsUpdate = true;}
          mesh.count = count;
        }
      }
      return stats.transitioning > 0;
    },
    restore() {
      if (disposed) return;
      sourceColour=true;
      let changed = false;
      for (let slot = 0; slot < total; slot++) if (l0.range.getX(slot) !== 0 || l0.range.getY(slot) !== 1) {l0.range.setXY(slot, 0, 1); changed = true;}
      if (changed) l0.range.needsUpdate = true;
      for (const level of levels) if (level) {for (const draw of level.draws) draw.mesh.count = 0; level.count = -1;}
    },
    dispose() {if (disposed) return; disposed = true; release();},
  };
}
export type EaldholtTreeHlod = ReturnType<typeof createEaldholtTreeHlod>;
