import { Material, Mesh, Texture, type BufferGeometry, type WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

interface DecoderOwner { dispose(): unknown }
interface EnvironmentModelDriver { loadAsync(url: string): Promise<GLTF> }

/** Only an unreturned, cancelled import is ours to destroy. Successful imports
 * retain the existing regional template owner's geometry/material lifetime. */
function releaseCancelledModel(gltf: GLTF): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  const images = new Set<ImageBitmap>();
  for (const root of new Set([gltf.scene, ...gltf.scenes])) {
    root.removeFromParent();
    root.traverse(node => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    root.clear();
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) images.add(texture.source.data);
    texture.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const image of images) image.close();
}

/** The decoder pool retires after its last import settles. Aborting the view
 * must not terminate a worker while GLTFLoader is still awaiting its result. */
export function ownEaldholtEnvironmentAssetLoader(driver: EnvironmentModelDriver, decoders: readonly DecoderOwner[], signal: AbortSignal) {
  let retired = false, released = false, pending = 0;
  const idle: (() => void)[] = [];
  const stats = { pending: 0, loaded: 0, lateReleased: 0, retired: false, decodersReleased: false };
  function finish() {
    if (pending) return;
    if (retired && !released) {
      released = true;
      for (const decoder of new Set(decoders)) decoder.dispose();
      stats.decodersReleased = true;
    }
    while (idle.length) idle.shift()!();
  }
  function dispose() {
    if (retired) return;
    retired = true; stats.retired = true;
    signal.removeEventListener('abort', dispose);
    finish();
  }
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    stats,
    async loadAsync(url: string): Promise<GLTF> {
      signal.throwIfAborted();
      if (retired) throw Error('Environment asset decoder pool is retired.');
      pending++; stats.pending = pending;
      try {
        const gltf = await driver.loadAsync(url);
        if (retired || signal.aborted) {
          releaseCancelledModel(gltf); stats.lateReleased++;
          signal.throwIfAborted();
          throw Error('Environment asset decoder pool retired during import.');
        }
        stats.loaded++; return gltf;
      } finally { pending--; stats.pending = pending; finish(); }
    },
    whenIdle(): Promise<void> { return pending ? new Promise(resolve => idle.push(resolve)) : Promise.resolve(); },
    dispose,
  };
}

/** Existing plain GLBs remain valid. Draco uses Crownfall's already shipped
 * decoder; KTX2 uses the matching local, licensed Basis static files. Neither
 * decoder downloads until a model actually requests its extension. This owns
 * no scene placement, material edits, asset entitlement or source-bound GLB. */
export function createEaldholtEnvironmentAssetLoader(options: { baseUrl: string; signal: AbortSignal; renderer?: WebGLRenderer }) {
  options.signal.throwIfAborted();
  const directory = options.baseUrl.endsWith('/') ? options.baseUrl : options.baseUrl + '/';
  const draco = new DRACOLoader().setDecoderPath(directory + 'decoders/draco/').setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const decoders: DecoderOwner[] = [draco];
  try {
    if (options.renderer) {
      const ktx2 = new KTX2Loader().setTranscoderPath(directory + 'decoders/basis/').setWorkerLimit(2); decoders.push(ktx2);
      ktx2.detectSupport(options.renderer); loader.setKTX2Loader(ktx2);
    }
  } catch (error) { for (const decoder of decoders) decoder.dispose(); throw error; }
  return ownEaldholtEnvironmentAssetLoader(loader, decoders, options.signal);
}
export type EaldholtEnvironmentAssetLoader = ReturnType<typeof createEaldholtEnvironmentAssetLoader>;
