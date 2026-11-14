import { DataTexture, Mesh, MeshStandardMaterial, RGBAFormat, SRGBColorSpace, UnsignedByteType, UVMapping,
  type Material, type Object3D, type Texture } from 'three';
import { buildFoliageCoverageMipmaps } from '../../../../shared/legacy/aethelgard/environment/foliage-coverage-mips';

export interface FoliageRgbaPixels {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly identityScope: 'source-rgba8' | 'canvas-srgb-readback' | 'injected-rgba8';
}
export interface FoliageCoverageMipDiagnostic { readonly code: string; readonly material: string; readonly map: string; readonly detail: string }
export interface FoliageCoverageMipOptions {
  readonly signal?: AbortSignal;
  readonly selectMaterial?: (mesh: Mesh, material: Material, slot: number) => boolean;
  /** Optional CPU reader for tests/offline intake; returned bytes are borrowed. */
  readonly readPixels?: (map: Texture, signal?: AbortSignal) => Promise<FoliageRgbaPixels>;
}
export interface FoliageCoverageMipMapInfo {
  readonly sourceName: string; readonly cutoff: number; readonly width: number; readonly height: number;
  readonly mipLevels: number; readonly bytes: number; readonly baseCoverage: number;
  readonly identityScope: FoliageRgbaPixels['identityScope']; readonly buildMilliseconds: number;
}
export interface EaldholtFoliageCoverageMips {
  readonly materialCount: number; readonly textureCount: number; readonly sourceMapCount: number;
  readonly mipLevelCount: number; readonly extraTextureBytes: number; readonly buildMilliseconds: number;
  readonly maps: readonly FoliageCoverageMipMapInfo[]; readonly diagnostics: readonly FoliageCoverageMipDiagnostic[];
  readonly disposed: boolean;
  dispose(): void;
}

const owners = new WeakMap<Mesh, object>();
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();
function foliage(mesh: Mesh, material: Material): boolean {
  for (let node: Object3D | null = mesh; node; node = node.parent) {
    if (['tree', 'groundcover'].includes(node.userData.crownfallElderbloom?.kind)
      || node.userData.crownfallFoliageDensity || node.userData.crownfallTreeLodPrototype) return true;
  }
  return /BlackAlder|(?:^|[_ -])(?:tree|leaf|leaves|foliage|grass|groundcover|flower)(?:[_ -]|$)/i.test(mesh.name + ' ' + material.name);
}

/** Direct RGBA8 data is copied exactly. Canvas readback preserves the captured
 * straight sRGB RGBA8 bytes, not encoded PNG bytes or decoder/premultiplication
 * round trips. Draw the existing bitmap as-is: do not close or flip it. The
 * owned texture retains UV settings and the effective source orientation.
 * Three ignores flipY for ImageBitmap uploads, so raw replacements use false
 * for that image type; HTML images and raw DataTextures retain source flipY. */
export async function readFoliageRgbaPixels(map: Texture, signal?: AbortSignal): Promise<FoliageRgbaPixels> {
  signal?.throwIfAborted();
  const image = map.source?.data as unknown;
  if (map instanceof DataTexture) {
    const data = image as { data?: unknown; width?: number; height?: number };
    if (!(data.data instanceof Uint8Array) || !Number.isSafeInteger(data.width) || !Number.isSafeInteger(data.height)) throw new TypeError('Source DataTexture must contain RGBA8 bytes and dimensions.');
    return { rgba: new Uint8Array(data.data), width: data.width!, height: data.height!, identityScope: 'source-rgba8' };
  }
  const bitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap;
  const element = typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement;
  if ((!bitmap && !element) || typeof OffscreenCanvas === 'undefined') throw new TypeError('A ready ImageBitmap/image and OffscreenCanvas are required for sRGB RGBA8 readback.');
  const source = image as ImageBitmap | HTMLImageElement;
  const width = element ? (source as HTMLImageElement).naturalWidth : source.width;
  const height = element ? (source as HTMLImageElement).naturalHeight : source.height;
  if (!width || !height || element && !(source as HTMLImageElement).complete) throw new TypeError('Foliage source image is not ready.');
  const canvas = new OffscreenCanvas(width, height);
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('OffscreenCanvas 2D readback is unavailable.');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, width, height); signal?.throwIfAborted();
    return { rgba: new Uint8Array(pixels.data), width, height, identityScope: 'canvas-srgb-readback' };
  } finally { canvas.width = 0; canvas.height = 0; }
}

type OwnedMap = { texture: DataTexture; info: FoliageCoverageMipMapInfo };
type Assignment = { mesh: Mesh; original: Material | Material[]; originalSlots: Material[]; slots: number[]; assigned?: Material | Material[]; assignedSlots?: Material[] };
type Candidate = { material: MeshStandardMaterial; map: Texture; cutoff: number; version: number };

function mapUnsupported(map: Texture): string | null {
  const flags = map as Texture & Record<string, unknown>;
  if (['isCompressedTexture', 'isCompressedArrayTexture', 'isCubeTexture', 'isData3DTexture', 'isDataArrayTexture', 'isVideoTexture', 'isDepthTexture', 'isRenderTargetTexture'].some(key => flags[key])) return 'compressed, dynamic or non-2D texture';
  if (map.format !== RGBAFormat || map.type !== UnsignedByteType) return 'source is not RGBA8';
  if (map.colorSpace !== SRGBColorSpace) return 'base-color source is not marked sRGB';
  if (map.mapping !== UVMapping) return 'source does not use ordinary UV mapping';
  if (map.premultiplyAlpha) return 'premultiplied source requires a separate decode contract';
  if (map.onUpdate) return 'custom texture upload callback requires a separate ownership contract';
  if (map.internalFormat !== null && map.internalFormat !== 'SRGB8_ALPHA8') return 'source requests a nonstandard internal format';
  return null;
}

function hasNonunitVertexAlpha(mesh: Mesh, material: MeshStandardMaterial): boolean {
  const color = mesh.geometry.getAttribute('color');
  if (!material.vertexColors || color?.itemSize !== 4) return false;
  // getW also handles normalized integer and interleaved attributes.
  for (let i = 0; i < color.count; i++) if (color.getW(i) !== 1) return true;
  return false;
}

function configure(owned: DataTexture, source: Texture, levels: ReturnType<typeof buildFoliageCoverageMipmaps>['levels']): void {
  owned.name = source.name + '_OwnedCoverageMips';
  owned.mapping = source.mapping; owned.channel = source.channel;
  owned.wrapS = source.wrapS; owned.wrapT = source.wrapT;
  owned.magFilter = source.magFilter; owned.minFilter = source.minFilter; owned.anisotropy = source.anisotropy;
  owned.offset.copy(source.offset); owned.repeat.copy(source.repeat); owned.center.copy(source.center); owned.rotation = source.rotation;
  owned.matrix.copy(source.matrix); owned.matrixAutoUpdate = source.matrixAutoUpdate;
  const bitmap = typeof ImageBitmap !== 'undefined' && source.source.data instanceof ImageBitmap;
  owned.flipY = bitmap ? false : source.flipY;
  owned.premultiplyAlpha = false; owned.colorSpace = SRGBColorSpace;
  owned.internalFormat = source.internalFormat; owned.unpackAlignment = 1; // owned RGBA8 rows are tightly packed
  owned.userData = { ...source.userData };
  owned.generateMipmaps = false;
  owned.mipmaps = levels.map(level => ({ data: level.rgba, width: level.width, height: level.height }));
  owned.needsUpdate = true;
}

/** Instance-owned hierarchy only. Resources are staged before committing any
 * material assignments; unsupported readbacks remain borrowed with diagnostics.
 * Dispose after any later material layer that borrows these owned maps. */
export async function applyEaldholtFoliageCoverageMips(root: Object3D, options: FoliageCoverageMipOptions = {}): Promise<EaldholtFoliageCoverageMips> {
  const started = now(), token = {}, assignments: Assignment[] = [], reserved = new Set<Mesh>();
  const candidates = new Map<Material, Candidate>(), replacements = new Map<Material, MeshStandardMaterial>();
  const ownedMaterials = new Set<MeshStandardMaterial>(), ownedTextures = new Set<DataTexture>(), mapInfo = new Map<DataTexture, FoliageCoverageMipMapInfo>();
  const diagnostics: FoliageCoverageMipDiagnostic[] = [];
  const textureCache = new Map<Texture, Map<number, Promise<OwnedMap | null>>>(), decodeCache = new Map<Texture, Promise<FoliageRgbaPixels>>();
  const diagnostic = (code: string, material: Material, map: Texture | null, detail: string) => diagnostics.push(Object.freeze({ code, material: material.name, map: map?.name ?? '', detail }));
  const releaseMaterial = (material: MeshStandardMaterial) => { if (ownedMaterials.delete(material)) material.dispose(); };
  const releaseTexture = (texture: DataTexture) => { if (ownedTextures.delete(texture)) texture.dispose(); };
  const unreserve = () => { for (const mesh of reserved) if (owners.get(mesh) === token) owners.delete(mesh); reserved.clear(); };
  function release(): void {
    const inverse = new Map([...replacements].map(([source, clone]) => [clone as Material, source])); let failure: unknown;
    for (const assignment of assignments) try {
      if (assignment.assigned === undefined) continue;
      const current = assignment.mesh.material;
      const pristine = current === assignment.assigned && (!Array.isArray(current) || current.length === assignment.assignedSlots!.length && current.every((m, i) => m === assignment.assignedSlots![i]));
      if (pristine) assignment.mesh.material = assignment.original;
      else if (Array.isArray(current)) { const restored = current.map(material => inverse.get(material) ?? material); if (restored.some((material, i) => material !== current[i])) assignment.mesh.material = restored; }
      else if (inverse.has(current)) assignment.mesh.material = inverse.get(current)!;
    } catch (error) { failure ??= error; }
    for (const material of [...ownedMaterials]) try { releaseMaterial(material); } catch (error) { failure ??= error; }
    for (const texture of [...ownedTextures]) try { releaseTexture(texture); } catch (error) { failure ??= error; }
    unreserve(); replacements.clear(); mapInfo.clear(); textureCache.clear(); decodeCache.clear(); assignments.length = 0;
    if (failure) throw failure;
  }
  try {
    options.signal?.throwIfAborted();
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const original = object.material, originalSlots = Array.isArray(original) ? [...original] : [original], slots: number[] = [];
      originalSlots.forEach((material, slot) => {
        if (!(options.selectMaterial ? options.selectMaterial(object, material, slot) : foliage(object, material)) || material.alphaTest <= 0) return;
        if (!(material instanceof MeshStandardMaterial)) { diagnostic('nonstandard-material', material, null, 'Only standard/physical masked materials are supported.'); return; }
        const map = material.map;
        const reason = !Number.isFinite(material.alphaTest) || material.alphaTest > 1 ? 'invalid alpha cutoff'
          : material.opacity !== 1 ? 'non-unit material opacity changes the effective cutoff'
          : material.alphaMap ? 'separate alphaMap changes the effective alpha'
          : material.transparent || material.alphaHash ? 'blended or stochastic alpha is not an ordinary mask'
          : hasNonunitVertexAlpha(object, material) ? 'non-unit RGBA vertex alpha requires a per-vertex cutoff contract'
          : !map ? 'missing base-color map' : mapUnsupported(map);
        if (reason || !map) { diagnostic('unsupported-mask', material, map, reason ?? 'missing base-color map'); return; }
        candidates.set(material, { material, map, cutoff: material.alphaTest, version: material.version }); slots.push(slot);
      });
      if (slots.length) { if (owners.has(object)) throw Error('Foliage coverage mip ownership is already active.'); owners.set(object, token); reserved.add(object); assignments.push({ mesh: object, original, originalSlots, slots }); }
    });
    const textureOrigins = new Map<DataTexture, Texture>();
    function ownedMap(candidate: Candidate): Promise<OwnedMap | null> {
      let byCutoff = textureCache.get(candidate.map); if (!byCutoff) { byCutoff = new Map(); textureCache.set(candidate.map, byCutoff); }
      const existing = byCutoff.get(candidate.cutoff); if (existing) return existing;
      const job = (async () => {
        const source = candidate.map, sourceObject = source.source, image = sourceObject.data, version = source.version, sourceVersion = sourceObject.version;
        let pixelsJob = decodeCache.get(source);
        if (!pixelsJob) { pixelsJob = (options.readPixels ?? readFoliageRgbaPixels)(source, options.signal); decodeCache.set(source, pixelsJob); }
        const pixels = await pixelsJob; options.signal?.throwIfAborted();
        if (source.source !== sourceObject || source.source.data !== image || source.version !== version || sourceObject.version !== sourceVersion) throw new Error('Source texture changed during readback.');
        if (!(pixels.rgba instanceof Uint8Array) || !Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height)
          || pixels.width <= 0 || pixels.height <= 0 || !Number.isSafeInteger(pixels.width * pixels.height * 4) || pixels.rgba.length !== pixels.width * pixels.height * 4) throw new RangeError('Reader returned invalid RGBA8 dimensions.');
        let coverage = 0; for (let i = 3; i < pixels.rgba.length; i += 4) if (pixels.rgba[i] / 255 >= candidate.cutoff) coverage++;
        if (coverage === 0 || coverage === pixels.width * pixels.height) { diagnostic('trivial-coverage', candidate.material, source, 'Fully passing/failing map needs no owned coverage texture.'); return null; }
        const buildStarted = now(), chain = buildFoliageCoverageMipmaps(pixels.rgba, pixels.width, pixels.height, candidate.cutoff);
        const texture = new DataTexture(chain.levels[0].rgba, pixels.width, pixels.height, RGBAFormat, UnsignedByteType); ownedTextures.add(texture);
        configure(texture, source, chain.levels);
        if (texture.source === source.source || texture.source.data === source.source.data) throw Error('Owned DataTexture must have an independent Source.');
        const info = Object.freeze({ sourceName: source.name, cutoff: candidate.cutoff, width: pixels.width, height: pixels.height,
          mipLevels: chain.levels.length, bytes: chain.totalByteLength, baseCoverage: chain.baseCoverage,
          identityScope: pixels.identityScope, buildMilliseconds: now() - buildStarted });
        mapInfo.set(texture, info); textureOrigins.set(texture, source); return { texture, info };
      })().catch(error => {
        if (options.signal?.aborted) throw error;
        diagnostic('readback-or-build-failed', candidate.material, candidate.map, error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown readback failure.'); return null;
      });
      byCutoff.set(candidate.cutoff, job); return job;
    }
    const outcomes = await Promise.allSettled([...candidates.values()].map(async candidate => {
      const mapped = await ownedMap(candidate); if (!mapped) return; options.signal?.throwIfAborted();
      const original = candidate.material;
      if (original.map !== candidate.map || original.alphaTest !== candidate.cutoff || original.version !== candidate.version
        || original.opacity !== 1 || original.alphaMap || original.transparent || original.alphaHash) { diagnostic('source-material-changed', original, candidate.map, 'Source material changed during preparation.'); return; }
      const material = original.clone();
      if (material === original || !(material instanceof MeshStandardMaterial)) throw Error('Material cloning did not return an independent standard material.');
      ownedMaterials.add(material); material.map = mapped.texture;
      material.onBeforeCompile = original.onBeforeCompile; material.customProgramCacheKey = original.customProgramCacheKey;
      material.onBeforeRender = original.onBeforeRender; material.needsUpdate = true; replacements.set(original, material);
    }));
    for (const result of outcomes) if (result.status === 'rejected') throw result.reason;
    options.signal?.throwIfAborted();
    const usedMaterials = new Set<MeshStandardMaterial>();
    for (const assignment of assignments) {
      if (assignment.mesh.material !== assignment.original) { diagnostic('assignment-changed', assignment.originalSlots[0], null, 'A newer mesh material assignment was preserved.'); continue; }
      const current = Array.isArray(assignment.original) ? assignment.original : [assignment.original];
      const next = current.map((material, slot) => assignment.slots.includes(slot) && material === assignment.originalSlots[slot] ? replacements.get(material) ?? material : material);
      if (!next.some((material, i) => material !== current[i])) continue;
      assignment.assigned = Array.isArray(assignment.original) ? next : next[0]; assignment.assignedSlots = next.slice(); assignment.mesh.material = assignment.assigned;
      for (const material of next) if (ownedMaterials.has(material as MeshStandardMaterial)) usedMaterials.add(material as MeshStandardMaterial);
    }
    for (const material of [...ownedMaterials]) if (!usedMaterials.has(material)) releaseMaterial(material);
    for (const [original, material] of replacements) if (!usedMaterials.has(material)) replacements.delete(original);
    const usedTextures = new Set([...usedMaterials].map(material => material.map as DataTexture));
    for (const texture of [...ownedTextures]) if (!usedTextures.has(texture)) releaseTexture(texture);
    for (const texture of mapInfo.keys()) if (!usedTextures.has(texture)) mapInfo.delete(texture);
    for (const mesh of [...reserved]) if (!assignments.some(a => a.mesh === mesh && a.assigned !== undefined)) { if (owners.get(mesh) === token) owners.delete(mesh); reserved.delete(mesh); }
    const maps = Object.freeze([...usedTextures].map(texture => mapInfo.get(texture)!));
    const stats = { materialCount: usedMaterials.size, textureCount: usedTextures.size,
      sourceMapCount: new Set([...usedTextures].map(texture => textureOrigins.get(texture))).size,
      mipLevelCount: maps.reduce((sum, map) => sum + map.mipLevels, 0), extraTextureBytes: maps.reduce((sum, map) => sum + map.bytes, 0),
      buildMilliseconds: now() - started, maps, diagnostics: Object.freeze(diagnostics.slice()) };
    textureCache.clear(); decodeCache.clear(); candidates.clear(); textureOrigins.clear();
    let disposed = false;
    return { ...stats, get disposed() { return disposed; }, dispose() { if (disposed) return; disposed = true; release(); } };
  } catch (error) {
    try { release(); } catch (cleanupFailure) { throw Object.assign(new Error('Foliage mip preparation and cleanup both failed.'), { cause: error, cleanupFailure }); }
    throw error;
  }
}
