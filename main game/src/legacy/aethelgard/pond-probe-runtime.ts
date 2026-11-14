import { EquirectangularReflectionMapping, HalfFloatType, type Texture } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { loadEaldholtPondProbeIdentity, type EaldholtPondProbeRuntimeConfig } from '../../../../shared/legacy/aethelgard/environment/pond-probe-config';
import type { EaldholtPondProbeIdentity } from '../../../../shared/legacy/aethelgard/environment/pond-probe';

export interface EaldholtOwnedPondProbe {
  readonly texture: Texture;
  readonly identity: EaldholtPondProbeIdentity;
  dispose(): void;
}

/** Desktop owns its one HDR texture. Loading is abortable; a late/cancelled
 * operation never publishes or leaks a texture. Native uses AssetManager. */
export async function loadEaldholtOwnedPondProbe(config: EaldholtPondProbeRuntimeConfig,
  signal: AbortSignal): Promise<EaldholtOwnedPondProbe> {
  const identity = await loadEaldholtPondProbeIdentity(config, signal);
  const response = await fetch(config.hdrUrl, { signal, cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw Error(`Private pond probe HDR request failed (${response.status}).`);
  const bytes = await response.arrayBuffer(); signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  let loaded: Texture;
  try { loaded = await new HDRLoader().setDataType(HalfFloatType).loadAsync(url); }
  finally { URL.revokeObjectURL(url); }
  // Keep the actual public HDR loader's format, colour space and row convention.
  // Only this owned texture receives its equirectangular reflection mapping.
  loaded.mapping = EquirectangularReflectionMapping;
  loaded.name = 'Private baked village pond radiance';
  let disposed = false;
  const release = () => { if (disposed) return; disposed = true; loaded.dispose(); };
  if (signal.aborted) { release(); signal.throwIfAborted(); }
  return { texture: loaded, identity, dispose: release };
}
