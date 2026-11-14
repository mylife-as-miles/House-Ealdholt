import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { EALDHOLT_WOODLAND_GROUND_CACHE_KEY, EALDHOLT_WOODLAND_GROUND_LAYERS, readEaldholtWoodlandGroundManifest,
  type EaldholtWoodlandGroundLayer, type EaldholtWoodlandGroundProfile } from '../../../../shared/legacy/aethelgard/environment/woodland-ground';
import { loadEaldholtValleyGrassMaps, type EaldholtValleyGrassMaps } from './grass-maps';
import type { EaldholtBorrowedSurfaceMaps } from './ground-albedo-detail';

/** Borrowed maps of one woodland ground layer. Only the roles the layer ships are present. */
export interface EaldholtWoodlandSurfaceMaps {
  readonly albedo: Texture; readonly normal?: Texture; readonly orm?: Texture; readonly meanLuminance: number;
  readonly targetLuminance: number; readonly sourceAssetId: string; readonly source: string; readonly cacheKey: string; readonly tileMetres: number;
}
export interface EaldholtWoodlandGroundMaps {
  readonly layer: EaldholtWoodlandGroundLayer; readonly surfaceMaps: EaldholtWoodlandSurfaceMaps; readonly profile: EaldholtWoodlandGroundProfile;
  readonly textureCount: number; readonly downloadBytes: number; readonly extraTextureBytesWithMipsEstimate: number;
  dispose(): void;
}
/** Explicit lazy load of one prepared CC0 woodland ground layer from its own
 * folder under the caller's BASE_URL-aware Aethelgard texture directory. The
 * caller disposes valley borrowers before this owner. Abort/failure releases
 * every completed texture; TextureLoader's in-flight requests settle first. */
export async function loadEaldholtWoodlandGroundLayer(textureDirectory: string, layer: EaldholtWoodlandGroundLayer, profile: EaldholtWoodlandGroundProfile, signal?: AbortSignal): Promise<EaldholtWoodlandGroundMaps> {
  signal?.throwIfAborted();
  const spec = EALDHOLT_WOODLAND_GROUND_LAYERS[layer];
  if (!spec || !spec.committed) throw Error('Unknown or uncommitted woodland ground layer.');
  const directory = (textureDirectory.endsWith('/') ? textureDirectory : textureDirectory + '/') + spec.folder + '/';
  const response = await fetch(directory + 'manifest.json', { signal });
  if (!response.ok) throw Error('Woodland ground manifest unavailable.');
  const manifest = readEaldholtWoodlandGroundManifest(await response.json(), layer, profile); signal?.throwIfAborted();
  const loader = new TextureLoader(), roles = manifest.roles;
  const settled = await Promise.allSettled(roles.map(role => loader.loadAsync(directory + manifest.files[role]!.file)));
  const textures = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []); let disposed = false;
  const release = () => { if (disposed) return; disposed = true; for (const texture of new Set<Texture>(textures)) texture.dispose(); };
  try {
    for (const result of settled) if (result.status === 'rejected') throw result.reason;
    signal?.throwIfAborted();
    const byRole: Partial<Record<(typeof roles)[number], Texture>> = {};
    roles.forEach((role, i) => {
      const texture = textures[i], image = texture.image as { width?: number; height?: number } | null, size = manifest.files[role]!.size;
      if (image?.width !== size || image.height !== size) throw Error('Woodland ground image dimensions differ from the selected profile.');
      texture.colorSpace = role === 'albedo' ? SRGBColorSpace : NoColorSpace; texture.flipY = false;
      texture.wrapS = texture.wrapT = RepeatWrapping; texture.channel = 0; texture.repeat.set(1, 1); texture.offset.set(0, 0); texture.rotation = 0;
      texture.generateMipmaps = true; texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.anisotropy = 4; texture.needsUpdate = true;
      byRole[role] = texture;
    });
    return { layer, profile, textureCount: roles.length, downloadBytes: manifest.downloadBytes, extraTextureBytesWithMipsEstimate: manifest.gpuBytesWithMipsEstimate, dispose: release,
      surfaceMaps: { albedo: byRole.albedo!, normal: byRole.normal, orm: byRole.orm, meanLuminance: manifest.meanLuminance, targetLuminance: manifest.targetLuminance,
        sourceAssetId: manifest.assetId, source: `Poly Haven ${manifest.assetId}`, cacheKey: `${EALDHOLT_WOODLAND_GROUND_CACHE_KEY}:${layer}`, tileMetres: manifest.tileMetres } };
  } catch (error) { release(); throw error; }
}

export type EaldholtValleyGroundFallbackDirectory = 'grass-leafy-v1' | 'grass-meadow-v1';
export type EaldholtValleyGroundLayerStatus = 'ready' | 'failed' | 'released' | 'skipped';
/** The outer valley's ground maps as one owner. Meadow and bank are one unit: with both,
 * the woodland ground set renders (plus the floor when requested and loaded); if either
 * fails, every woodland layer is released and the chosen canonical grass maps load.
 * Existing callers retain the grass-leafy-v1 default; valley integrations may retain
 * their earlier grass-meadow-v1 material explicitly, with borrowed earth unchanged. */
export interface EaldholtValleyGroundSet {
  readonly mode: 'woodland' | 'fallback';
  /** Earth slot: bank soil, or undefined to keep the village's borrowed stony_dirt_path earth. */
  readonly earth: EaldholtWoodlandSurfaceMaps | undefined;
  /** Grass slot: meadow sward, or the selected canonical fallback (undefined if that failed too). */
  readonly grass: EaldholtWoodlandSurfaceMaps | EaldholtBorrowedSurfaceMaps | undefined;
  /** Woodland floor (only with the woodland ground set). */
  readonly forest: EaldholtWoodlandSurfaceMaps | undefined;
  /** Legacy `leafy` key reports the chosen canonical fallback, including meadow. */
  readonly layers: Readonly<Record<'meadow' | 'bank' | 'woodland' | 'leafy', EaldholtValleyGroundLayerStatus>>;
  /** Failure messages of the layers that did not load, for diagnostics. */
  readonly reasons: readonly string[];
  readonly textureCount: number; readonly downloadBytes: number; readonly extraTextureBytesWithMipsEstimate: number;
  dispose(): void;
}
/** Starts every request at once (callers start it before awaiting other texture work). An
 * abort releases everything and rejects; any other failure resolves to the fallback. */
export async function loadEaldholtValleyGroundSet(textureDirectory: string, profile: EaldholtWoodlandGroundProfile, options: { readonly woodlandFloor?: boolean; readonly signal?: AbortSignal; readonly fallbackDirectory?: EaldholtValleyGroundFallbackDirectory } = {}): Promise<EaldholtValleyGroundSet> {
  const signal = options.signal; signal?.throwIfAborted();
  const fallbackDirectory = options.fallbackDirectory ?? 'grass-leafy-v1';
  if (fallbackDirectory !== 'grass-leafy-v1' && fallbackDirectory !== 'grass-meadow-v1') throw Error('Unknown canonical valley grass fallback directory.');
  const names = options.woodlandFloor ? ['meadow', 'bank', 'woodland'] as const : ['meadow', 'bank'] as const;
  const settled = await Promise.allSettled(names.map(layer => loadEaldholtWoodlandGroundLayer(textureDirectory, layer, profile, signal)));
  const loaded = settled.map(result => result.status === 'fulfilled' ? result.value : null), reasons: string[] = [];
  settled.forEach((result, i) => { if (result.status === 'rejected') reasons.push(`${names[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); });
  const layers: Record<'meadow' | 'bank' | 'woodland' | 'leafy', EaldholtValleyGroundLayerStatus> = { meadow: 'skipped', bank: 'skipped', woodland: 'skipped', leafy: 'skipped' };
  names.forEach((layer, i) => { layers[layer] = loaded[i] ? 'ready' : 'failed'; });
  if (signal?.aborted) { for (const maps of loaded) maps?.dispose(); signal.throwIfAborted(); }
  const [meadow, bank, woodland] = [loaded[0], loaded[1], loaded[2] ?? null];
  let owners: { dispose(): void; textureCount: number; downloadBytes: number; extraTextureBytesWithMipsEstimate: number }[], result: Pick<EaldholtValleyGroundSet, 'mode' | 'earth' | 'grass' | 'forest'>;
  if (meadow && bank) {
    owners = [meadow, bank, ...(woodland ? [woodland] : [])];
    result = { mode: 'woodland', earth: bank.surfaceMaps, grass: meadow.surfaceMaps, forest: woodland?.surfaceMaps };
  } else {
    for (const [i, maps] of loaded.entries()) if (maps) { maps.dispose(); layers[names[i]] = 'released'; }
    let leafy: EaldholtValleyGrassMaps | null = null;
    try { leafy = await loadEaldholtValleyGrassMaps((textureDirectory.endsWith('/') ? textureDirectory : textureDirectory + '/') + fallbackDirectory + '/', profile, signal); layers.leafy = 'ready'; }
    catch (error) { if (signal?.aborted) throw error; layers.leafy = 'failed'; reasons.push(`leafy: ${error instanceof Error ? error.message : String(error)}`); }
    owners = leafy ? [leafy] : [];
    result = { mode: 'fallback', earth: undefined, grass: leafy?.surfaceMaps, forest: undefined };
  }
  let disposed = false;
  return { ...result, layers: Object.freeze({ ...layers }), reasons: Object.freeze(reasons),
    textureCount: owners.reduce((n, owner) => n + owner.textureCount, 0), downloadBytes: owners.reduce((n, owner) => n + owner.downloadBytes, 0),
    extraTextureBytesWithMipsEstimate: owners.reduce((n, owner) => n + owner.extraTextureBytesWithMipsEstimate, 0),
    dispose() { if (disposed) return; disposed = true; for (const owner of owners) owner.dispose(); } };
}
