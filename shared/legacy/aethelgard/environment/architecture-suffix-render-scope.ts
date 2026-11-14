/** A render count is temporary presentation state, never a replacement for the
 * original instance storage. Only a trailing invisible suffix may be omitted. */
export interface ArchitectureCountSource {
  count: number;
  // The platform retains its own Three raycast types and synchronous contract.
  raycast(...args: any[]): unknown;
}
interface Renderer<S, C> {render(scene: S, camera: C): unknown}
interface Binding {source: ArchitectureCountSource; selectPrefix(): number | null}
const owners = new WeakMap<object, object>();
const MAXIMUM_SOURCES = 4, MAXIMUM_INSTANCES = 256;

export function createArchitectureSuffixRenderScope<S, C>(options: {
  renderer: Renderer<S, C>; scene: S; camera: C; bindings: readonly Binding[];
  /** Null means this exact main pass has complete supported view coverage. */
  heldReason(): string | null;
}) {
  const renderer = options.renderer, originalRender = renderer.render;
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'render');
  const stats = {version: 'architecture-render-suffix-v1', status: 'held', reason: '', sources: 0,
    mainCalls: 0, scopedTrimCalls: 0, lastOmittedInstances: 0, nestedFallbacks: 0,
    raycastFallbacks: 0, restoredOnThrow: 0, sourceChanges: 0, renderHookRestored: false};
  const records = options.bindings.map(binding => ({...binding, fullCount: binding.source.count,
    raycast: binding.source.raycast, descriptor: Object.getOwnPropertyDescriptor(binding.source, 'raycast'),
    wrapper: null as ArchitectureCountSource['raycast'] | null, applied: null as number | null, disabled: false}));
  let disposed = false, installed = false, depth = 0, invalidated = false;
  function restore() {
    for (const record of records) {
      if (record.applied === null) continue;
      if (record.source.count === record.applied) record.source.count = record.fullCount;
      else {if (!record.disabled) stats.sourceChanges++; record.disabled = true; stats.reason = 'source-count-changed';}
      record.applied = null;
    }
  }
  function invalidate() {invalidated = true; stats.lastOmittedInstances = 0; restore();}
  function revalidateOwner() {
    if (disposed || invalidated) return false;
    if (!installed || owners.get(renderer) !== handle || renderer.render !== render) {
      stats.reason = 'render-owner-changed'; invalidate(); return false;
    }
    for (const record of records) {
      if (record.disabled) {stats.reason = 'source-owner-held'; invalidate(); return false;}
      if (record.source.count !== (record.applied ?? record.fullCount) || record.source.raycast !== record.wrapper) {
        record.disabled = true; stats.sourceChanges++; stats.reason = 'source-owner-changed'; invalidate(); return false;
      }
    }
    return true;
  }
  function replace(target: object, property: string, prior: PropertyDescriptor | undefined, value: unknown) {
    if (prior && ('get' in prior || 'set' in prior || !prior.writable)) throw Error('Unsupported render ownership property.');
    Object.defineProperty(target, property, {configurable: prior?.configurable ?? true,
      enumerable: prior?.enumerable ?? true, writable: true, value});
  }
  function restoreProperty(target: object, property: string, prior: PropertyDescriptor | undefined) {
    if (prior) Object.defineProperty(target, property, prior); else Reflect.deleteProperty(target, property);
  }
  const render = function(this: Renderer<S, C>, scene: S, camera: C) {
    if (disposed) return originalRender.call(this, scene, camera);
    // An unexpected camera/render, including a nested mirror pass, permanently
    // invalidates trimming for the rest of the outer call. Never crop a mirror
    // using the main view and never republish a stale outer-camera selection.
    if (depth) {
      stats.nestedFallbacks++; stats.reason = 'nested-render-full-source'; invalidate(); depth++;
      try {return originalRender.call(this, scene, camera);} finally {restore(); depth--;}
    }
    depth = 1; invalidated = false; restore(); stats.lastOmittedInstances = 0;
    let threw = true;
    try {
      if (this !== renderer || scene !== options.scene || camera !== options.camera) stats.reason = 'unknown-render-full-source';
      else {
        stats.mainCalls++;
        try {
          if (revalidateOwner()) {
            const held = options.heldReason();
            // Both callbacks may synchronously dispose, raycast, render another
            // camera or change source ownership. Their return value grants no
            // permission to overwrite that newer state.
            if (revalidateOwner()) {
              stats.reason = held ?? '';
              if (!held) for (const record of records) {
                const prefix = record.selectPrefix();
                if (!revalidateOwner()) break;
                if (prefix === null) continue;
                if (!Number.isSafeInteger(prefix) || prefix < 0 || prefix > record.fullCount) throw Error('Invalid architecture prefix.');
                if (prefix < record.fullCount) {
                  record.applied = prefix; record.source.count = prefix;
                  stats.lastOmittedInstances += record.fullCount - prefix;
                }
              }
              revalidateOwner();
            }
          }
        } catch {stats.reason = 'selection-full-source-fallback'; invalidate();}
      }
      const result = originalRender.call(this, scene, camera); threw = false; return result;
    } finally {
      restore(); depth = 0;
      if (threw) {stats.restoredOnThrow++; stats.lastOmittedInstances = 0;}
      else if (!invalidated && stats.lastOmittedInstances) stats.scopedTrimCalls++;
    }
  };
  function dispose() {
    if (disposed) return; disposed = true; invalidate();
    for (const record of records) if (record.source.raycast === record.wrapper) {
      try {restoreProperty(record.source, 'raycast', record.descriptor);} catch {stats.reason = 'source-callback-restore-held';}
    }
    if (installed && renderer.render === render) {
      try {restoreProperty(renderer, 'render', descriptor); stats.renderHookRestored = renderer.render === originalRender;}
      catch {stats.reason = 'render-callback-restore-held';}
    }
    if (owners.get(renderer) === handle) owners.delete(renderer);
    stats.status = 'disposed';
  }
  const handle = {stats, dispose};
  if (!records.length) {stats.reason = 'no-qualified-source'; return handle;}
  if (records.length > MAXIMUM_SOURCES || new Set(records.map(record => record.source)).size !== records.length || records.some(record => !Number.isSafeInteger(record.fullCount)
    || record.fullCount < 1 || record.fullCount > MAXIMUM_INSTANCES) || owners.has(renderer)) {
    stats.reason = 'source-or-owner-budget-held'; return handle;
  }
  try {
    for (const record of records) {
      const wrapper = function(this: ArchitectureCountSource, ...args: any[]) {
        // Full original count and unchanged buffers preserve source ordinal IDs,
        // even if a synchronous input hook casts a ray during a scoped render.
        if (!disposed && depth && this === record.source) {stats.raycastFallbacks++; stats.reason = 'raycast-full-source'; invalidate();}
        return record.raycast.apply(this, args);
      };
      record.wrapper = wrapper; replace(record.source, 'raycast', record.descriptor, wrapper);
    }
    replace(renderer, 'render', descriptor, render); installed = true; owners.set(renderer, handle);
    stats.sources = records.length; stats.status = 'ready';
  } catch {
    dispose(); stats.status = 'held'; stats.reason = 'unsupported-render-ownership';
  }
  return handle;
}
export type ArchitectureSuffixRenderScope = ReturnType<typeof createArchitectureSuffixRenderScope>;
