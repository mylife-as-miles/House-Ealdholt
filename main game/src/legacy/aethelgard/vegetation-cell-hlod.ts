import {bindWorldGeometryOwner} from '../../../../shared/legacy/aethelgard/environment/world-geometry-readers';
import type {WorldOwnerRetirement} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';
import {VegetationResidencyError} from '../../../../shared/legacy/aethelgard/environment/vegetation-resource-pool';
import {FOREST01_DENSITY_LOD} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import {acceptVegetationBranchL2,VEGETATION_BRANCH_L2} from '../../../../shared/legacy/aethelgard/environment/vegetation-branch-l2';
/** Four-level detail on an existing authored spatial cell. L0 borrows the
 * original mesh and all collision/nav data remain outside this visual owner.
 * Default cells share one fade. Owned regional batches can select each actor
 * independently; immutable original transforms remain the placement authority. */
import {Box3, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Sphere,
  Vector2, Vector3, type BufferGeometry, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer} from 'three';
import {TREE_HLOD, GRASS_HLOD, createVegetationHandoff, vegetationLodDistance} from '../../../../shared/legacy/aethelgard/environment/vegetation-hlod';
import {patchVegetationFade, patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import {patchEaldholtNeutralFill} from '../../../../shared/legacy/aethelgard/environment/neutral-fill';
import type {GrassGroundPatch} from '../../../../shared/legacy/aethelgard/environment/grass-ground-field';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import {createVegetationGeometryView} from './vegetation-geometry-view';
import {staticSourceBounds} from './static-source-bounds';
import {vegetationPrototypeKey, type PreparedVegetationAtlas, type VegetationPrototypeResources} from './vegetation-prototype';

const sourceGeometry = new WeakMap<Mesh, BufferGeometry>();
const sourceMaterials = new WeakMap<Mesh, MeshStandardMaterial>();
const sourceCounts = new WeakMap<Mesh, number>();
/** Borrow the original PBR source rather than the visual HLOD fade material. */
export function readAuthoredVegetationMaterial(mesh:Mesh):MeshStandardMaterial|null{return sourceMaterials.get(mesh)??(mesh.material instanceof MeshStandardMaterial?mesh.material:null);}
/** Borrowed authored CPU data for collision/navigation readers. Never dispose
 * or infer collision from the visual geometry view's current draw range. */
export function readAuthoredVegetationGeometry(mesh: Mesh): BufferGeometry {return sourceGeometry.get(mesh) ?? mesh.geometry;}
/** Full authored cost for shadow/quality policy; visual drawRange is independent. */
export function readVegetationSourceTriangles(mesh: Mesh): number | null {
  const geometry = sourceGeometry.get(mesh); if (!geometry) return null;
  return Math.min(geometry.index?.count ?? geometry.getAttribute('position').count, geometry.drawRange.count) / 3 * (mesh instanceof InstancedMesh ? sourceCounts.get(mesh) ?? mesh.count : 1);
}

export function createVegetationCellHlod(root: Object3D, options: {
  renderer: WebGLRenderer; scene: Scene; camera: Camera; resources: VegetationPrototypeResources;
  signal: AbortSignal; changed(): void; native?: boolean; detailScale?:number; solidOverhead?:boolean; tileSize: 64 | 128; kind?: 'tree' | 'grass'; sourceRoot?: Object3D; retirementFence?: () => Promise<void>; captureInCellFrame?: boolean;
  /** Renderer-owned regional batches only; authored/shadow geometry stays on the default path. */
  actorBatch?: {readonly ids: readonly number[]; cameras?(camera: Camera): readonly Camera[]};
  /** One qualified complete-source derivative: physical L1/L2/L3, never L0. */
  representation?: 'forest01-density';
  preparationOwner?:WorldOwnerRetirement;
  /** External owner keeps this reservation until whenRetired and wrapper cleanup. */
  ownedBufferReservation?:ReturnType<VegetationPrototypeResources['ownerBuffers']>;
}) {
  const grass = options.kind === 'grass';
  if(options.representation!==undefined&&options.representation!=='forest01-density')throw Error('Unknown vegetation representation.');
  const density=options.representation==='forest01-density',allowedMask=density?14:15,requiredMask=density?14:1;
  if(density&&(options.native||grass||options.actorBatch))throw Error('Forest01 density requires a Desktop static complete-source actor.');
  if(density&&!options.ownedBufferReservation)throw Error('Density LOD requires an owned private-buffer reservation.');
  if (grass && !options.sourceRoot) throw Error('Grass HLOD requires its source terrain frame.');
  const controller = new AbortController(), signal = controller.signal, abort = () => controller.abort();
  const sources: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  root.traverse(object => {if (object instanceof Mesh) {
    if (!(object.material instanceof MeshStandardMaterial) || object.geometry.groups.length > 1 || object.geometry.hasAttribute('crownfallLodRange') ||
        Object.keys(object.geometry.morphAttributes).length || 'isSkinnedMesh' in object) throw Error('Source cell requires static single-material parts.');
    sources.push(object as Mesh<BufferGeometry, MeshStandardMaterial>);
  }});
  if (sources.some(source => sourceGeometry.has(source))) throw Error('Source cell already has an HLOD owner.');
  if (!sources.length || sources.length > 8) throw Error('Incomplete authored vegetation cell.');
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), matrix = new Matrix4();
  const frames = sources.map(source => inverse.clone().multiply(source.matrixWorld));
  const counts = sources.map(source => source instanceof InstancedMesh ? source.count : 1), count = counts[0];
  if (!Number.isSafeInteger(count) || count < 1 || count > 2048 || counts.some(n => n !== count)) throw Error('Mismatched authored vegetation actors.');
  if(density&&count!==1)throw Error('Density LOD requires exactly one canonical actor.');
  const batch = options.actorBatch;
  if (batch && (grass || !options.sourceRoot || sources.some(source => !(source instanceof InstancedMesh)
      || source.castShadow || source.instanceColor !== null || source.morphTexture !== null
      || Object.values(source.geometry.attributes).some(attribute => attribute instanceof InstancedBufferAttribute)
      || source.userData.crownfallOwnedRegionalBatch !== true)
      || batch.ids.length !== count || new Set(batch.ids).size !== count
      || batch.ids.some(id => !Number.isSafeInteger(id) || id < 0 || id > 0xffffffff)))
    throw Error('Per-actor HLOD requires owned non-shadow regional instances and distinct stable IDs.');
  const stableIds = batch ? Uint32Array.from(batch.ids) : null;
  const actorOriginals = batch ? sources.map(source => {
    if (!(source instanceof InstancedMesh)) throw Error('Regional actor buffers require instances.');
    return {array: Float32Array.from(source.instanceMatrix.array), count: source.count, visible: source.visible,
      ids: source.userData.crownfallHlodActorIds, level: source.userData.crownfallHlodLevel};
  }) : [];
  const matrices = sources.map((source, part) => {
    const values = new Float32Array(count * 16);
    for (let id = 0; id < count; id++) {
      if (source instanceof InstancedMesh) source.getMatrixAt(id, matrix); else matrix.identity();
      matrix.premultiply(frames[part]).toArray(values, id * 16);
    }
    return values;
  });
  // A rotated one-part imported scan needs captures in the cell's source-up
  // frame. Keep original L0/L1 instance TRS, but capture/rebuild cards in that
  // common frame so near and global fallback atlases describe the same shrub.
  if (options.captureInCellFrame && (grass || count !== 1 || sources.length !== 1)) throw Error('Cell-frame captures require one static foliage actor.');
  const reference = options.captureInCellFrame ? new Matrix4() : new Matrix4().fromArray(matrices[0]).invert();
  const cardMatrices = options.captureInCellFrame ? Float32Array.from(new Matrix4().elements) : matrices[0];
  const parts: VegetationCapturePart[] = sources.map((source, i) => ({geometry: source.geometry, material: source.material,
    frame: reference.clone().multiply(new Matrix4().fromArray(matrices[i])), foliage: grass || source.material.side === 2 || /TwoSided|foliage|canopy|leaves/i.test(source.material.name)}));
  if (!parts.some(part => part.foliage)) throw Error('Source tree has no identified foliage.');
  if(density&&(parts.length!==3||parts.filter(part=>part.foliage).length!==1||sources.some(source=>source.castShadow)))throw Error('Density LOD requires the complete non-shadow Forest01 family.');
  for (let part = 1; part < sources.length; part++) for (let id = 0; id < count; id++) {
    matrix.fromArray(matrices[0], id * 16).multiply(parts[part].frame);
    if (matrix.elements.some((value, i) => Math.abs(value - matrices[part][id * 16 + i]) > .0001)) throw Error('Source cell parts do not share actor frames.');
  }
  const box = new Box3(), prototypeBounds = new Box3(), point = new Vector3(), sourceFrame = new Matrix4(), sourceInverse = new Matrix4(), metricBox = new Box3();
  for (let p = 0; p < sources.length; p++) {
    const b = staticSourceBounds(sources[p].geometry);
    prototypeBounds.union(b.clone().applyMatrix4(parts[p].frame));
    for (let id = 0; id < count; id++) box.union(b.clone().applyMatrix4(matrix.fromArray(matrices[p], id * 16)));
  }
  // Immutable full actor boxes include every original part. All derivative
  // cards depict this same source; the sphere allows atlas padding and maximum
  // tree wind (min(height,20m)*.018, strength/gust <=1). No placement is changed.
  const actorBounds = batch ? new Float64Array(count * 6) : null;
  if (actorBounds) for (let id = 0; id < count; id++) {
    const b = prototypeBounds.clone().applyMatrix4(matrix.fromArray(matrices[0], id * 16));
    b.min.toArray(actorBounds, id * 6); b.max.toArray(actorBounds, id * 6 + 3);
  }
  const actorStates = batch ? Array.from({length: count}, () => createVegetationHandoff(TREE_HLOD)) : [];
  const packedIds = batch ? Array.from({length: 4}, () => new Uint32Array(count)) : [];
  const matrixDirty = batch ? Array.from({length: 4}, () => new Uint8Array(8)) : [];
  const rangeDirty = batch ? new Uint8Array(4) : null;
  const packedCounts = new Uint32Array(4), actorFrusta = batch ? [new Frustum(), new Frustum()] : [];
  const actorEyes = batch ? [new Vector3(), new Vector3()] : [], actorProjection = new Float64Array(2);
  const actorParts = new WeakMap<InstancedMesh, number | null>();
  const cameraList = [options.camera], clip = new Matrix4(), cameraInverse = new Matrix4(), sphere = new Sphere();
  const actorBox = new Box3();
  function restoreActors() {
    if (!batch) return;
    sources.forEach((mesh, i) => {
      if (!(mesh instanceof InstancedMesh)) throw Error('Regional actor buffers require instances.');
      const original = actorOriginals[i];
      mesh.instanceMatrix.array.set(original.array); mesh.instanceMatrix.needsUpdate = true;
      mesh.count = original.count; mesh.visible = original.visible;
      if (original.ids === undefined) delete mesh.userData.crownfallHlodActorIds;
      else mesh.userData.crownfallHlodActorIds = original.ids;
      if (original.level === undefined) delete mesh.userData.crownfallHlodLevel; else mesh.userData.crownfallHlodLevel = original.level;
    });
  }
  const originalWind = sources.map(source => source.userData.crownfallVegetationWind);
  // The verified actor reference frame, shared by all parts and all LODs.
  const windRoot = new Vector3(0, prototypeBounds.min.y, 0), windTip = new Vector3(0, prototypeBounds.max.y, 0);
  function bindWind(mesh: Mesh, part: number | null) {
    if (part !== null && !parts[part].foliage) return;
    const frame = part === null ? new Matrix4() : parts[part].frame.clone().invert();
    const supplied = sources[0].userData.crownfallVegetationActorWind;
    mesh.userData.crownfallVegetationWind = supplied ? {root: new Vector3(...supplied.root).applyMatrix4(frame).toArray(), tip: new Vector3(...supplied.tip).applyMatrix4(frame).toArray(), grass} : {root: windRoot.clone().applyMatrix4(frame).toArray(), tip: windTip.clone().applyMatrix4(frame).toArray(), grass};
  }
  sources.forEach((source, part) => bindWind(source, part));
  options.signal.addEventListener('abort', abort, {once: true}); if (options.signal.aborted) abort();
  const group = new Group(); group.name = 'Authored cell source HLOD';
  const original = sources.map(source => source.material), originalGeometry = sources.map(source => source.geometry), cards = new Set<PlaneGeometry>();
  const views: ReturnType<typeof createVegetationGeometryView>[] = [];
  const leases: {release(): void}[] = [], levels: Object3D[][] = [density?[]:sources, [], [], []];
  const originalVisibility=sources.map(source=>source.visible);
  const ranges = [0, 1, 2, 3].map(level => {const range = new InstancedBufferAttribute(new Float32Array(count * 2), 2);
    if (level === 0) for (let i = 0; i < count; i++) range.setXY(i, 0, 1); return range;});
  const handoff = createVegetationHandoff(grass ? GRASS_HLOD : TREE_HLOD,density?1:0);
  let disposed = false, ready = density?0:1, coverage = 1;
  let finishRetirement!:()=>void,failRetirement!:(reason:unknown)=>void;
  const whenRetired=new Promise<void>((resolve,reject)=>{finishRetirement=resolve;failRetirement=reject;});void whenRetired.catch(()=>{});
  let finishGround!: (patches: GrassGroundPatch[]) => void;
  const groundPatches = new Promise<GrassGroundPatch[]>(resolve => {finishGround = resolve;});
  if (!grass) finishGround([]);
  const stats = {kind: grass ? 'grass' : 'tree', status: 'preparing' as 'preparing' | 'ready' | 'error', error: '', retryableError:false, readyMask: ready, allowedReadyMask:allowedMask, requiredReadyMask:requiredMask, actors: count,
    levels: [density?0:count, 0, 0, 0], transitioning: false, sourceTriangles: 0, simplifiedTriangles: 0, l2BranchProfile: VEGETATION_BRANCH_L2.version, l1BranchTriangles: 0, l2BranchTriangles: 0, l2BranchFallbacks: 0, l2BranchError: 0, l2BranchSelectedBytes: 0, actorSelection: batch ? 'per-actor-camera-v1' : 'cell-v1', visibleActors: count, culledActors: 0};
  function updateActors(now: number, camera: Camera, quality: 'low' | 'medium' | 'high', reducedMotion: boolean) {
    cameraList[0] = camera;
    const cameras = batch!.cameras?.(camera) ?? cameraList;
    if (cameras.length < 1 || cameras.length > 2) throw Error('Actor HLOD needs one real camera or two actual eyes.');
    options.sourceRoot!.updateWorldMatrix(true, false); sourceInverse.copy(options.sourceRoot!.matrixWorld).invert();
    root.updateWorldMatrix(true, false); sourceFrame.multiplyMatrices(sourceInverse, root.matrixWorld);
    const sourceScale = Math.max(1e-6, options.sourceRoot!.matrixWorld.getMaxScaleOnAxis());
    for (let eye = 0; eye < cameras.length; eye++) {
      const view = cameras[eye];
      // XR eye world matrices are already authoritative; rebuilding local TRS
      // here could erase their real head origin. The caller owns freshness.
      clip.multiplyMatrices(view.projectionMatrix, cameraInverse.copy(view.matrixWorld).invert()).multiply(options.sourceRoot!.matrixWorld);
      actorFrusta[eye].setFromProjectionMatrix(clip);
      actorEyes[eye].setFromMatrixPosition(view.matrixWorld).applyMatrix4(sourceInverse);
      actorProjection[eye] = Math.max(1e-6, Math.abs(view.projectionMatrix.elements[5]));
    }
    packedCounts.fill(0); rangeDirty!.fill(0); for (const dirty of matrixDirty) dirty.fill(0);
    stats.levels.fill(0); stats.visibleActors = stats.culledActors = 0;
    let transitioning = false;
    const qualityScale = (quality === 'low' ? .7 : quality === 'high' ? 1.25 : 1) * (options.native ? .65 : 1) * (options.detailScale ?? 1);
    for (let id = 0; id < count; id++) {
      actorBox.min.fromArray(actorBounds!, id * 6); actorBox.max.fromArray(actorBounds!, id * 6 + 3); actorBox.applyMatrix4(sourceFrame);
      actorBox.getBoundingSphere(sphere); sphere.radius = sphere.radius * 1.1 + .36;
      let visible = false, distance = Infinity;
      for (let eye = 0; eye < cameras.length; eye++) {
        visible = actorFrusta[eye].intersectsSphere(sphere) || visible;
        const point = actorEyes[eye], projection = actorProjection[eye];
        let lod = vegetationLodDistance({distanceMetres: cameras[eye] instanceof PerspectiveCamera ? actorBox.distanceToPoint(point) : 1 / projection / sourceScale,
          projectionScale: cameras[eye] instanceof PerspectiveCamera ? 1 / projection / Math.tan(Math.PI / 6) : 1, qualityScale});
        const horizontal = Math.hypot(Math.max(actorBox.min.x-point.x,0,point.x-actorBox.max.x),Math.max(actorBox.min.z-point.z,0,point.z-actorBox.max.z));
        if (options.solidOverhead && point.y-actorBox.max.y > Math.max(1,horizontal*.35))
          lod = Math.min(lod,TREE_HLOD.distances[1]-TREE_HLOD.blendWidths[1]/2-.01);
        distance = Math.min(distance,lod);
      }
      const state = actorStates[id].update(now,distance,ready,reducedMotion);
      if (!visible) {stats.culledActors++; continue;}
      stats.visibleActors++; transitioning = state.transitioning || transitioning;
      for (let level = 0; level < 4; level++) {
        if (state.weights[level] * coverage <= .000001) continue;
        const slot = packedCounts[level]++, range = ranges[level];
        if (packedIds[level][slot] !== stableIds![id]) packedIds[level][slot] = stableIds![id];
        // Compare stored Float32 values, not their unrounded products: a fixed
        // fractional coverage must not dirty the same attribute every frame.
        const low = Math.fround(state.ranges[level*2]*coverage), high = Math.fround(state.ranges[level*2+1]*coverage);
        if (range.getX(slot) !== low || range.getY(slot) !== high) {
          range.setXY(slot,low,high);
          if (!rangeDirty![level]) {rangeDirty![level] = 1; range.needsUpdate = true;}
        }
        for (let part = 0; part < levels[level].length; part++) {
          const mesh = levels[level][part] as InstancedMesh;
          const sourcePart = actorParts.get(mesh);
          const base = level === 0 ? actorOriginals[part].array : sourcePart == null ? cardMatrices : matrices[sourcePart];
          // Copy bytes without a subarray allocation or transform round-trip.
          const target = mesh.instanceMatrix.array;
          for (let k = 0; k < 16; k++) if (!Object.is(target[slot*16+k],base[id*16+k])) {
            target[slot*16+k] = base[id*16+k];
            if (!matrixDirty[level][part]) {matrixDirty[level][part] = 1; mesh.instanceMatrix.needsUpdate = true;}
          }
        }
      }
    }
    for (let level = 0; level < 4; level++) {
      const active = packedCounts[level]; stats.levels[level] = active;
      for (let part = 0; part < levels[level].length; part++) {
        const mesh = levels[level][part] as InstancedMesh;
        if (mesh.count !== active) mesh.count = active;
        const visible = active > 0 && (level !== 0 || actorOriginals[part].visible);
        if (mesh.visible !== visible) mesh.visible = visible;
        if (mesh.userData.crownfallHlodActorIds !== packedIds[level]) mesh.userData.crownfallHlodActorIds = packedIds[level];
        if (mesh.userData.crownfallHlodLevel !== level) mesh.userData.crownfallHlodLevel = level;
      }
    }
    for (let part = 0; part < sources.length; part++) {
      const start = originalGeometry[part].drawRange.start, count = packedCounts[0] ? originalGeometry[part].drawRange.count : 0;
      if (sources[part].geometry.drawRange.start !== start || sources[part].geometry.drawRange.count !== count)
        sources[part].geometry.setDrawRange(start,count);
    }
    stats.transitioning = transitioning; return transitioning;
  }
  async function faded(source: MeshStandardMaterial, _level: number, impostor?: PreparedVegetationAtlas) {
    const materialKey = source.uuid + ':' + source.version + ':' + (impostor ? impostor.maps[0].uuid : 'source-3d');
    const lease = options.resources.material(materialKey, () => {
    const material = impostor ? new MeshStandardMaterial({map: impostor.maps[0], roughness: source.roughness,
      metalness: source.metalness, envMap: source.envMap, envMapIntensity: source.envMapIntensity, alphaTest: 82 / 255, side: 2}) : source.clone();
    material.onBeforeRender = source.onBeforeRender;
    if (impostor) material.name = 'Crownfall vegetation captured canopy';
    const compile = source.onBeforeCompile, key = source.customProgramCacheKey;
    material.onBeforeCompile = function(shader, renderer) {
      if (!impostor) compile.call(this, shader, renderer);
      else {
        const record = impostor.record;
        Object.assign(shader.uniforms, {crownfallAtlasNormalMap: {value: impostor.maps[1]}, crownfallAtlasCentre: {value: new Vector3(...record.centre)},
          crownfallAtlasExtent: {value: new Vector2(...record.extent)}, crownfallAtlasViews: {value: record.views},
          crownfallAtlasGrid: {value: new Vector2(record.columns, record.rows)}, crownfallAtlasPixels: {value: new Vector2(record.mips[0].width, record.mips[0].height)},
          crownfallAtlasMaximumMip: {value: Math.max(0, Math.log2(record.tileSize) - 2)}});
        patchVegetationImpostor(shader); if (source.userData.crownfallNeutralIbl) patchEaldholtNeutralFill(shader);
      }
      patchVegetationFade(shader);
    };
    material.customProgramCacheKey = () => (impostor ? 'cell-source-impostor-v1:' + Boolean(source.userData.crownfallNeutralIbl) : key.call(source)) + ':cell-attribute-fade-v1';
    return material;
    }); leases.push(lease); return (await lease.ready).material;
  }
  async function draw(level: number, geometry: BufferGeometry, material: MeshStandardMaterial, sourcePart: number) {
    const prepared = await faded(material, level); signal.throwIfAborted();
    const view = createVegetationGeometryView(geometry, ranges[level]); views.push(view);if(options.preparationOwner)bindWorldGeometryOwner(view.geometry,options.preparationOwner);
    const mesh = new InstancedMesh(view.geometry, prepared, count);
    actorParts.set(mesh, sourcePart); bindWind(mesh, sourcePart);
    if (grass && level === 1) mesh.count = Math.max(1, Math.ceil(count * .6));
    (mesh.instanceMatrix.array as Float32Array).set(matrices[sourcePart]); mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = sources[sourcePart].receiveShadow; mesh.castShadow = false;
    mesh.frustumCulled = false; mesh.visible = false; levels[level].push(mesh); return mesh;
  }
  const key = vegetationPrototypeKey(parts)+(density?':'+FOREST01_DENSITY_LOD.version+':'+FOREST01_DENSITY_LOD.selectionSha256:'');
  async function publish(level: number) {
    signal.throwIfAborted(); if (disposed) return;
    const lease = options.resources.compile(key + ':level:' + level, levels[level] as Mesh[], options.camera, options.scene);
    leases.push(lease);
    await lease.ready;
    signal.throwIfAborted(); if (disposed) return;
    group.add(...levels[level]); ready |= 1 << level; stats.readyMask = ready; options.changed();
  }
  async function card(level: number, atlas: PreparedVegetationAtlas) {
    if (atlas.record.coverage?.some(n => !Number.isFinite(n) || n <= 0) || atlas.record.coverage?.length !== atlas.record.views) throw Error('Empty source cell atlas; retain original.');
    const material = await faded(parts.find(p => p.foliage)!.material, level, atlas); signal.throwIfAborted();
    const geometry = new PlaneGeometry(1, 1);if(options.preparationOwner)bindWorldGeometryOwner(geometry,options.preparationOwner); cards.add(geometry); geometry.setAttribute('crownfallLodRange', ranges[level]);
    const mesh = new InstancedMesh(geometry, material, count);
    actorParts.set(mesh, null); bindWind(mesh, null);
    (mesh.instanceMatrix.array as Float32Array).set(cardMatrices); mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = sources[0].receiveShadow; mesh.frustumCulled = false; mesh.visible = false; levels[level].push(mesh);
  }
  sources.forEach((source,i)=>{sourceGeometry.set(source,originalGeometry[i]);sourceMaterials.set(source,original[i]);if(batch)sourceCounts.set(source,count);
    if(density){source.visible=false;return;}const view=createVegetationGeometryView(originalGeometry[i],ranges[0]);if(options.preparationOwner)bindWorldGeometryOwner(view.geometry,options.preparationOwner);views.push(view);source.geometry=view.geometry;});root.add(group);
  const preparation = (async () => {
    if(density){const reservation=await options.ownedBufferReservation!.ready;signal.throwIfAborted();if(reservation.bytes!==FOREST01_DENSITY_LOD.ownerBufferBytes)throw Error('Wrong private-buffer reservation.');}
    const derived: Awaited<ReturnType<VegetationPrototypeResources['geometry']>['ready']>[] = [];
    const derivativeLeases:ReturnType<VegetationPrototypeResources['geometry']>[]=[];
    for (const part of parts) {
      const lease = options.resources.geometry(part,density&&part.foliage?'forest01-density':'l1'); leases.push(lease);derivativeLeases.push(lease); const value = await lease.ready;
      signal.throwIfAborted(); if (disposed) return; derived.push(value);
      stats.sourceTriangles += value.sourceTriangles; stats.simplifiedTriangles += value.triangles;
    }
    if(density&&(derived.reduce((sum,value)=>sum+value.triangles,0)!==FOREST01_DENSITY_LOD.triangles||derived.some((value,i)=>value.densityProof!==i))){for(const lease of derivativeLeases)if(lease.releaseUnsubmitted)lease.releaseUnsubmitted();else lease.release();throw Error('Density derivative lacks exact source/wood proof.');}
    for (let i = 0; i < parts.length; i++) await draw(1, derived[i].geometry, parts[i].material, i);
    if(!density){const l0Materials = await Promise.all(original.map(material => faded(material, 0)));
    const templates = sources.map((source, i) => source instanceof InstancedMesh ? new InstancedMesh(source.geometry, l0Materials[i], 1) : new Mesh(source.geometry, l0Materials[i]));
    const l0Lease = options.resources.compile(key + ':level0:' + sources.map(source => source instanceof InstancedMesh).join(','), templates, options.camera, options.scene); leases.push(l0Lease);
    try {await l0Lease.ready;} finally {for (const mesh of templates) if (mesh instanceof InstancedMesh) mesh.dispose();}
    signal.throwIfAborted(); if (disposed) return;
    sources.forEach((source, i) => {source.material = l0Materials[i];});} await publish(1);
    if (disposed) return;
    const canopy = options.resources.atlas(parts, options.tileSize, grass ? 8 : 16, !grass); leases.push(canopy);
    const canopyValue = await canopy.ready; signal.throwIfAborted(); if (disposed) return;
    if (!grass) for (let i = 0; i < parts.length; i++) if (!parts[i].foliage) {
      let geometry = derived[i].geometry, triangles = derived[i].triangles;
      stats.l1BranchTriangles += triangles;
      // The extra role reuses its exactly terrain-certified L1 wood at L2;
      // a differently simplified triangle edge needs its own terrain proof.
      if(density){stats.l2BranchFallbacks++;}else try {
        if (derived[i].sourceTriangles < VEGETATION_BRANCH_L2.minimumSourceTriangles) {stats.l2BranchFallbacks++;}
        else {const lease = options.resources.geometry(parts[i], 'l2-branches'); leases.push(lease);
        const branch = await lease.ready; signal.throwIfAborted(); if (disposed) return;
        if (acceptVegetationBranchL2(branch.sourceTriangles, triangles, branch.triangles, branch.error)) {
          geometry = branch.geometry; triangles = branch.triangles; stats.l2BranchError = Math.max(stats.l2BranchError, branch.error); stats.l2BranchSelectedBytes += branch.bytes;
        } else {stats.l2BranchFallbacks++; if(lease.releaseUnsubmitted)lease.releaseUnsubmitted();else lease.release();}}
      } catch (cause) { if (disposed || signal.aborted) return; stats.l2BranchFallbacks++; }
      stats.l2BranchTriangles += triangles; await draw(2, geometry, parts[i].material, i);
    }
    await card(2, canopyValue); await publish(2);
    if (disposed) return;
    if (grass) {
      const ground = options.resources.atlas(parts, 64, 8, false, true); leases.push(ground);
      const atlas = await ground.ready; signal.throwIfAborted(); if (disposed) return;
      const {record} = atlas, size = record.tileSize;
      const image = grassFootprintPixels(record);
      options.sourceRoot!.updateWorldMatrix(true, false); root.updateWorldMatrix(true, false);
      const toSource = options.sourceRoot!.matrixWorld.clone().invert().multiply(root.matrixWorld);
      const patches: GrassGroundPatch[] = [];
      if (!root.name) throw Error('Ground footprints require stable authored cell names.');
      for (let id = 0; id < count; id++) patches.push({id: root.name + ':' + id,
        matrix: toSource.clone().multiply(new Matrix4().fromArray(matrices[0], id * 16)).toArray(),
        bounds: [record.centre[0] - record.extent[0] / 2, record.centre[2] - record.extent[1] / 2,
          record.centre[0] + record.extent[0] / 2, record.centre[2] + record.extent[1] / 2],
        size, pixels: image.colour, normals: image.normal, groundY: prototypeBounds.min.y});
      finishGround(patches); return;
    }
    const full = options.resources.atlas(parts, options.tileSize, 8); leases.push(full);
    const fullValue = await full.ready; signal.throwIfAborted(); if (disposed) return;
    await card(3, fullValue); await publish(3); stats.status = 'ready';
  })().catch(cause => {if (!disposed && !signal.aborted) {stats.status = 'error';stats.retryableError=cause instanceof VegetationResidencyError; stats.error = cause instanceof Error ? cause.message : String(cause); options.changed();} finishGround([]);});
  return {stats, preparation, sources, groundPatches,whenRetired,
    /** Complementary owner handoff: this whole cell occupies [0, coverage].
     * Its same-source outer fallback occupies [coverage, 1]. */
    setCoverage(value: number) {if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('Invalid vegetation coverage.'); coverage = value;},
    get visible() {return root.visible;},
    groundReady() {if (!disposed && grass && ready === 7 && stats.status !== 'error') {ready |= 8; stats.readyMask = ready; stats.status = 'ready'; options.changed();}},
    update(now: number, camera: Camera, quality: 'low' | 'medium' | 'high', reducedMotion: boolean) {
      if (disposed || (ready&requiredMask)!==requiredMask) return false;
      if (batch) return updateActors(now,camera,quality,reducedMotion);
      root.updateWorldMatrix(true, false); point.setFromMatrixPosition(camera.matrixWorld);
      const projection = Math.max(1e-6, Math.abs(camera.projectionMatrix.elements[5]));
      options.sourceRoot?.updateWorldMatrix(true, false);
      const sourceScale = Math.max(1e-6, options.sourceRoot?.matrixWorld.getMaxScaleOnAxis() ?? 1);
      // Single GLB nodes can carry centimetre-to-metre scale while instanced
      // cells carry it inside actor matrices. LOD thresholds use source metres
      // in both layouts, independent of tabletop/world presentation scale.
      if (options.sourceRoot) sourceInverse.copy(options.sourceRoot.matrixWorld).invert(); else sourceInverse.identity();
      sourceFrame.multiplyMatrices(sourceInverse, root.matrixWorld); metricBox.copy(box).applyMatrix4(sourceFrame); point.applyMatrix4(sourceInverse);
      const distance = camera instanceof PerspectiveCamera ? metricBox.distanceToPoint(point) : 1 / projection / sourceScale;
      let lodDistance=vegetationLodDistance({distanceMetres: distance, projectionScale: camera instanceof PerspectiveCamera ? 1 / projection / Math.tan(Math.PI / 6) : 1,
        qualityScale: (quality === 'low' ? .7 : quality === 'high' ? 1.25 : 1) * (options.native ? .65 : 1)*(options.detailScale??1)});
      // Upright atlas captures cannot cover an overhead crown. Bounded regional
      // near cells retain their simplified 3D geometry from above, including
      // after every derived level is ready; this is not a preparation-only fix.
      const horizontal=Math.hypot(Math.max(metricBox.min.x-point.x,0,point.x-metricBox.max.x),Math.max(metricBox.min.z-point.z,0,point.z-metricBox.max.z));
      if(!grass&&options.solidOverhead&&point.y-metricBox.max.y>Math.max(1,horizontal*.35))lodDistance=Math.min(lodDistance,TREE_HLOD.distances[1]-TREE_HLOD.blendWidths[1]/2-.01);
      const state=handoff.update(now,lodDistance,ready&allowedMask,reducedMotion);
      stats.transitioning = state.transitioning;
      for (let level = 0; level < 4; level++) {
        const low = state.ranges[level * 2] * coverage, high = state.ranges[level * 2 + 1] * coverage, range = ranges[level];
        if (range.getX(0) !== low || range.getY(0) !== high) {for (let i = 0; i < count; i++) range.setXY(i, low, high); range.needsUpdate = true;}
        stats.levels[level] = state.weights[level] * coverage > .000001 ? count : 0;
        for (const mesh of levels[level]) if (level > 0) mesh.visible = state.weights[level] * coverage > .000001;
      }
      if(!density)for (let i = 0; i < sources.length; i++) {const range = originalGeometry[i].drawRange;
        sources[i].geometry.setDrawRange(range.start, state.weights[0] * coverage > .000001 || sources[i].castShadow ? range.count : 0);}
      return state.transitioning;
    },
    get triangleCost() {
      let total = 0;
      // The caller is deciding this root's visibility using this cost. Counting
      // an already-culled Mesh root as free creates an alternating zero-cost
      // admission loop and can defeat the whole groundcover triangle budget.
      for (const level of levels) for (const mesh of level) if (mesh instanceof Mesh && (mesh === root || mesh.visible) && !Array.isArray(mesh.material) && mesh.material.visible)
        total += Math.min(mesh.geometry.drawRange.count, mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * (mesh instanceof InstancedMesh ? mesh.count : 1);
      return total;
    },
    restore() {restoreActors(); coverage = 1; for (let i = 0; i < count; i++) ranges[0].setXY(i, 0, 1); ranges[0].needsUpdate = true;
      if(!density)sources.forEach((source, i) => source.geometry.setDrawRange(originalGeometry[i].drawRange.start, originalGeometry[i].drawRange.count));
      for (const level of levels.slice(1)) for (const mesh of level) mesh.visible = false;},
    dispose() {
      if (disposed) return; disposed = true; controller.abort(); options.signal.removeEventListener('abort', abort);
      finishGround([]); restoreActors(); group.removeFromParent(); sources.forEach((source, i) => {source.material = original[i]; source.geometry = originalGeometry[i]; if(density)source.visible=originalVisibility[i]; sourceGeometry.delete(source);sourceMaterials.delete(source); sourceCounts.delete(source); if (originalWind[i] === undefined) delete source.userData.crownfallVegetationWind; else source.userData.crownfallVegetationWind = originalWind[i];});
      for (const lease of leases) lease.release();
      // Leases own derived buffers/maps. Source materials and instance matrices
      // restore immediately; asynchronous compiler retirement owns the rest.
      void preparation.then(() => options.retirementFence?.()).then(() => {
        for (const view of views) view.dispose();
        for (const geometry of cards) geometry.dispose();
        for (const level of levels.slice(1)) for (const mesh of level) if (mesh instanceof InstancedMesh) mesh.dispose(); group.clear();
      }).then(finishRetirement,failRetirement);
    },
  };
}
const groundPixels = new WeakMap<object, {colour: Uint8Array; normal: Uint8Array}>();
function grassFootprintPixels(record: PreparedVegetationAtlas['record']) {
  let cached = groundPixels.get(record); if (cached) return cached;
  const size = record.tileSize, base = record.mips[0], colour = new Uint8Array(size * size * 4), normal = new Uint8Array(colour.length);
  for (let y = 0; y < size; y++) {
    colour.set(base.colour.subarray(y * base.width * 4, (y * base.width + size) * 4), y * size * 4);
    normal.set(base.normal.subarray(y * base.width * 4, (y * base.width + size) * 4), y * size * 4);
  }
  cached = {colour, normal}; groundPixels.set(record, cached); return cached;
}
export type VegetationCellHlod = ReturnType<typeof createVegetationCellHlod>;
