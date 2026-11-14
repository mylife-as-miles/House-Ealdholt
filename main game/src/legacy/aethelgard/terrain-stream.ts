/** Presentation-only pages of Crownfall's existing ground. Source meshes and
 * their CPU attributes remain unchanged for navigation and collision queries. */
import {Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, Sphere, Vector3,
  type Camera, type Object3D, type Scene, type WebGLRenderer} from 'three';
import {demandTerrainTiles, type TerrainObserver, type TerrainLevel, type TerrainBounds} from '../../../../shared/legacy/aethelgard/environment/terrain-tiles';
import {createTerrainResidency} from '../../../../shared/legacy/aethelgard/environment/terrain-residency';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createTerrainPreparationWorker, type TerrainLayoutMetadata, type TerrainTileMetadata} from './terrain-worker';
import {uploadWorldGeometry} from './world-buffer-upload';
import {staticSourceBounds} from './static-source-bounds';
import {isVerifiedEaldholtWater} from '../../../../shared/legacy/aethelgard/environment/water-look';

interface Page {bytes: number; mesh: Mesh; dispose(): void}
// Compact-source Well/Riverside continuity and WebGL error checks passed on
// 8 November. Full-source and physical-headset acceptance remain separate.
const TERRAIN_PAGE_PUBLICATION_ENABLED = true;
interface Source {id: number; original: Mesh; shown: boolean; group: Group; layout: TerrainLayoutMetadata | null; published: boolean; failed: boolean; signature: string;}
export function createAuthoredTerrainStream(options: {sourceRoot: Object3D; renderer: WebGLRenderer; scene: Scene; camera: Camera;
  queue: WorldPreparationQueue; maximumBytes: number; wake(): void; service?(): void; active?(): boolean; prepareEnabled(): boolean; cellMetres?: number}) {
  const service = options.service ?? options.wake;
  const abort = new AbortController(), worker = createTerrainPreparationWorker(abort.signal, service), residency = createTerrainResidency<Page>(options.maximumBytes, 1024);
  const sources: Source[] = [], inverse = new Matrix4(), frame = new Matrix4(), point = new Vector3(), bounds = new Box3();
  const protectedAreas: TerrainBounds[] = [], previous = new Vector3();
  let disposed = false, initialized = false, preparing = false, inFlight = 0, previousTime = 0, updateAt = -Infinity, observerHistory = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  // Reused per 250 ms tick: up to four observers (two XR eyes plus spares) and the request lists (Q-22).
  type MutableObserver = {position: [number, number, number]; velocity: [number, number, number]};
  const observerPool: MutableObserver[] = [0, 1, 2, 3].map(() => ({position: [0, 0, 0], velocity: [0, 0, 0]})), observers: TerrainObserver[] = [], main = new Vector3();
  const requests: {s: Source; tile: TerrainTileMetadata; level: TerrainLevel; priority: number}[] = [];
  const demands: (ReturnType<typeof demandTerrainTiles>[number] & {id: string})[] = [];
  const stats = {status: 'waiting-entry', sources: 0, tiles: 0, protectedTiles: 0, protectedAreas: 0, publishedSources: 0, levels: [0, 0, 0], workerBytes: 0,
    activeTriangles: 0, errors: [] as string[], ...residency.stats};
  const fail = (cause: unknown) => {if (!disposed && stats.errors.length < 8) stats.errors.push(cause instanceof Error ? cause.message : String(cause));};
  options.sourceRoot.updateWorldMatrix(true, true); inverse.copy(options.sourceRoot.matrixWorld).invert();
  const meshes: Mesh[] = [];
  function sourceKind(node: Object3D): string {
    for (let o: Object3D | null = node; o && o !== options.sourceRoot; o = o.parent) {
      const kind = o.userData.crownfallElderbloom?.kind;
      if (kind) return kind;
      if (/LandscapeComponent/.test(o.name)) return 'terrain';
      if (/Grass|flower|vmcob/i.test(o.name)) return 'groundcover';
      if (/BlackAlder|tree|canopy/i.test(o.name) || o.userData.crownfallRiverWoodland || o.userData.crownfallFarWoodland || o.userData.crownfallWoodlandPrototype) return 'vegetation';
    }
    return 'architecture';
  }
  options.sourceRoot.traverse(o => {
    if (!(o instanceof Mesh) || !o.geometry.getAttribute('position') || o.userData.crownfallTerrainVisualOnly || 'isSkinnedMesh' in o) return;
    const kind = sourceKind(o), materials = Array.isArray(o.material) ? o.material : [o.material];
    const water = kind === 'water' || materials.some(m => isVerifiedEaldholtWater(m.name) || m.userData.crownfallWaterLook || m.userData.crownfallRiver);
    if (water || kind === 'architecture') {
      const b = staticSourceBounds(o.geometry), actor = new Matrix4(), base = new Matrix4().multiplyMatrices(inverse, o.matrixWorld);
      const copies = o instanceof InstancedMesh ? o.instanceMatrix.count : 1;
      for (let i = 0; i < copies; i++) {
        frame.copy(base); if (o instanceof InstancedMesh) {o.getMatrixAt(i, actor); frame.multiply(actor);}
        bounds.copy(b).applyMatrix4(frame); const margin = water ? 2 : .8;
        // Keep existing shores, building/prop foundations and entrances exact.
        // This is conservative source geometry, not an invented nav corridor.
        protectedAreas.push({min: [bounds.min.x - margin, -1e6, bounds.min.z - margin], max: [bounds.max.x + margin, 1e6, bounds.max.z + margin]});
      }
    }
    if (!(o instanceof InstancedMesh) && !Array.isArray(o.material) && kind === 'terrain') meshes.push(o);
  });
  for (const mesh of meshes) {
    if (!mesh.visible || !mesh.parent || mesh.geometry.morphAttributes.position?.length || mesh.geometry.groups.some(g => (g.materialIndex ?? 0) !== 0)) continue;
    const group = new Group(); group.name = 'Crownfall terrain pages: ' + mesh.name; group.matrixAutoUpdate = false; group.matrix.copy(mesh.matrix);
    // Not tagged as source Landscape or authored collision geometry.
    group.userData.crownfallTerrainStreaming = {sourceGeometryUntouched: true};
    sources.push({id: sources.length, original: mesh, shown: mesh.visible, group, layout: null, published: false, failed: false, signature: ''});
  }
  stats.sources = sources.length;
  stats.protectedAreas = protectedAreas.length;
  const identity = (s: Source, tile: string) => s.id + ':' + tile;
  function retireSource(s: Source) {
    const wasVisible = s.published && s.group.visible;
    s.failed = true;
    if (s.layout) for (const tile of s.layout.tiles) residency.retireTile(identity(s, tile.id));
    s.group.visible = false; s.original.visible = s.shown; s.published = false;
    void worker.retire(s.id).catch(() => {});
    if (wasVisible) options.wake();
  }
  function wakeLater(delay: number) {if (wakeTimer === null && !disposed) wakeTimer = setTimeout(() => {wakeTimer = null; if (!disposed) service();}, Math.max(1, delay));}
  async function initialize() {
    if (initialized || preparing || disposed || !options.prepareEnabled()) return;
    preparing = true; stats.status = 'indexing';
    try {
      for (const s of sources) {
        if (disposed) return;
        try {
          const geometry = s.original.geometry, p = geometry.getAttribute('position');
          const entries = Object.entries(geometry.attributes).filter(([name]) => name !== 'position');
          const stride = entries.reduce((n, [, a]) => n + a.itemSize, 0);
          if (p.count > 2_000_000 || stride > 64 || !stride) throw Error('Authored terrain source exceeds packing budget: ' + s.original.name);
          const positions = new Float32Array(p.count * 3), attributes = new Float32Array(p.count * stride);
          for (let start = 0; start < p.count; start += 8192) {
            abort.signal.throwIfAborted();
            for (let i = start; i < Math.min(p.count, start + 8192); i++) {
              for (let c = 0; c < 3; c++) positions[i * 3 + c] = p.getComponent(i, c);
              let offset = i * stride; for (const [, a] of entries) for (let c = 0; c < a.itemSize; c++) attributes[offset++] = a.getComponent(i, c);
            }
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          s.original.updateWorldMatrix(true, false); inverse.copy(options.sourceRoot.matrixWorld).invert(); frame.multiplyMatrices(inverse, s.original.matrixWorld);
          const result = await worker.source(s.id, {positions, attributes, indices: geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({length: p.count}, (_, i) => i),
            channels: entries.map(([name, a]) => ({name, size: a.itemSize})), frame: frame.toArray(), cellMetres: options.cellMetres ?? 64, protectedBounds: protectedAreas});
          if (disposed) return;
          s.layout = result.layout; stats.workerBytes = result.sourceBytes; stats.tiles += result.layout.tiles.length;
          stats.protectedTiles += result.layout.tiles.filter(t => t.preserveDetail).length;
        } catch (cause) {s.failed = true; fail(cause);}
      }
      initialized = true; stats.status = stats.errors.length ? 'partial-source-fallback' : 'preparing';
    } finally {preparing = false; service();}
  }
  function publish() {
    if (!TERRAIN_PAGE_PUBLICATION_ENABLED) return false;
    if (options.active && !options.active()) return false;
    let changed = false;
    stats.levels.fill(0); stats.activeTriangles = 0; stats.publishedSources = 0;
    for (const s of sources) {
      const layout = s.layout; if (!layout || s.failed) continue;
      if (!s.published && layout.tiles.every(t => residency.selected(identity(s, t.id)))) {
        s.original.parent?.add(s.group); s.original.visible = false; s.published = true; changed = true;
      }
      if (!s.published) continue;
      if (!s.group.visible || s.original.visible) {s.group.visible = true; s.original.visible = false; changed = true;}
      stats.publishedSources++;
      let signature = '';
      for (const child of s.group.children) child.visible = false;
      for (const tile of layout.tiles) {
        const active = residency.selected(identity(s, tile.id)); if (!active) continue;
        signature += tile.id + '/' + active.level + ';';
        if (active.value.mesh.parent !== s.group) s.group.add(active.value.mesh);
        active.value.mesh.visible = true;
        // Later source material layers (grass/GI/weather) apply to every page.
        active.value.mesh.material = s.original.material;
        stats.levels[active.level]++; stats.activeTriangles += (active.value.mesh.geometry.index?.count ?? 0) / 3;
      }
      if (signature !== s.signature) {s.signature = signature; changed = true;}
    }
    Object.assign(stats, residency.stats);
    if (initialized && stats.publishedSources === sources.filter(s => !s.failed).length) stats.status = stats.errors.length ? 'partial-source-fallback' : 'ready';
    return changed;
  }
  async function prepare(s: Source, tile: TerrainTileMetadata, level: TerrainLevel, priority: number) {
    const job = residency.begin(identity(s, tile.id), level, Math.max(1, tile.maximumBytes));
    if (!job) {
      if (!s.published && residency.stats.pending === 0) {retireSource(s); fail(Error('Terrain baseline exceeds residency budget; retained source: ' + s.original.name));}
      return;
    }
    inFlight++;
    let page: Page | null = null;
    try {
      const result = await worker.tile(s.id, tile.id, level, job.signal); job.signal.throwIfAborted();
      const geometry = new BufferGeometry();
      try {
        geometry.setAttribute('position', new BufferAttribute(result.positions, 3));
        for (const a of result.attributes) geometry.setAttribute(a.name, new BufferAttribute(a.values, a.size));
        geometry.setIndex(new BufferAttribute(result.indices, 1));
        geometry.boundingBox = new Box3(new Vector3().fromArray(result.bounds), new Vector3().fromArray(result.bounds, 3));
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
        const gpu = await uploadWorldGeometry(geometry, options.renderer, options.queue, job.signal, () => job.signal.aborted ? Infinity : priority);
        const mesh = new Mesh(gpu.geometry, s.original.material); mesh.name = 'Crownfall terrain page ' + identity(s, tile.id) + '/' + level;
        mesh.userData.crownfallTerrainVisualOnly = true;
        mesh.userData.crownfallElderbloom = {kind: 'terrain', visualOnly: true};
        mesh.raycast = () => {}; // CPU source terrain owns picking/collision.
        mesh.receiveShadow = s.original.receiveShadow; mesh.castShadow = s.original.castShadow; mesh.renderOrder = s.original.renderOrder;
        mesh.layers.mask = s.original.layers.mask;
        page = {bytes: gpu.bytes, mesh, dispose() {mesh.removeFromParent(); gpu.dispose();}};
        const preview = new Group(); preview.add(mesh);
        try {await options.queue.enqueue({bytes: 0, signal: job.signal, priority: () => priority, work: () => options.renderer.compileAsync(preview, options.camera, options.scene)});}
        finally {preview.remove(mesh);}
        job.commit(page); page = null;
      } finally {geometry.dispose();}
    } catch (cause) {
      if (!job.signal.aborted && !disposed) {
        fail(cause); retireSource(s);
      }
      page?.dispose(); job.cancel();
    }
    finally {inFlight--; if (!disposed) {if (publish()) options.wake(); else service();}}
  }
  return {
    stats,
    update(cameras: readonly Camera[], now: number, preset: 'low' | 'medium' | 'high') {
      if (disposed) return;
      if (options.active && !options.active()) {
        let changed = false;
        for (const s of sources) if (s.published && s.group.visible) {s.group.visible = false; s.original.visible = s.shown; changed = true;}
        if (changed) options.wake(); return;
      }
      if (!initialized) {if (options.prepareEnabled()) void initialize(); return;}
      if (!cameras.length) return;
      if (now - updateAt < 250) {wakeLater(250 - (now - updateAt)); return;}
      updateAt = now; options.sourceRoot.updateWorldMatrix(true, false); inverse.copy(options.sourceRoot.matrixWorld).invert();
      observers.length = 0;
      for (let index = 0; index < Math.min(4, cameras.length); index++) {
        cameras[index].getWorldPosition(point).applyMatrix4(inverse);
        const observer = observerPool[index], velocity = observer.velocity; velocity[0] = velocity[1] = velocity[2] = 0;
        if (!observers.length) {
          main.copy(point); const delta = (now - previousTime) / 1000;
          if (observerHistory && delta > 0 && delta < 2 && previous.distanceTo(point) < 128) for (let c = 0; c < 3; c++) velocity[c] = (point.getComponent(c) - previous.getComponent(c)) / delta;
        }
        observer.position[0] = point.x; observer.position[1] = point.y; observer.position[2] = point.z; observers.push(observer);
      }
      previous.copy(main); previousTime = now; observerHistory = true;
      requests.length = 0; demands.length = 0;
      for (const s of sources) if (s.layout && !s.failed) {
        const demand = demandTerrainTiles(s.layout, observers, {nearMetres: preset === 'low' ? 100 : 260, middleMetres: preset === 'low' ? 280 : 850, preloadSeconds: 1.5, retainMultiplier: 1.25});
        for (const d of demand) {
          const tile = s.layout.tiles.find(t => t.id === d.id)!;
          demands.push({...d, level: tile.preserveDetail ? 2 as const : d.level, id: identity(s, d.id)});
          // Prepare a complete source fallback before refining any page.
          const level = s.published && !tile.preserveDetail ? d.level : 2;
          if (!residency.has(identity(s, d.id), level)) requests.push({s, tile, level, priority: d.priority + (s.published ? 100 : 0)});
        }
      }
      residency.demand(demands); requests.sort((a, b) => a.priority - b.priority);
      if (options.prepareEnabled()) for (const request of requests) {if (inFlight >= 2 || worker.pending >= 2) break; void prepare(request.s, request.tile, request.level, request.priority);}
      if (publish()) options.wake();
    },
    dispose() {
      if (disposed) return; disposed = true; if (wakeTimer !== null) clearTimeout(wakeTimer); abort.abort(); worker.dispose(); residency.dispose();
      for (const s of sources) {s.group.removeFromParent(); s.group.clear(); if (s.published) s.original.visible = s.shown;}
      stats.status = 'disposed'; Object.assign(stats, residency.stats);
    },
  };
}
export type AuthoredTerrainStream = ReturnType<typeof createAuthoredTerrainStream>;
