/**
 * Jolt, fetched the first time something asks for it.
 *
 * This is the only place the package is imported at run time, and it is a
 * dynamic import: the bundler puts Jolt (WebAssembly embedded, about 3.2 MB
 * raw and 0.9 MB gzipped) in a chunk of its own, the main bundle does not
 * grow, and nothing waits for it. Until `joltReady()` answers, deaths play as
 * they did before physics.
 */
import type { JoltModule } from "./PhysicsWorld";

let loading: Promise<JoltModule | null> | null = null;
let loaded: JoltModule | null = null;

/** Starts the download if it has not started. Resolves to null when Jolt cannot be had (no WebAssembly, offline chunk). */
export function loadJolt(): Promise<JoltModule | null> {
  loading ??= import("jolt-physics")
    .then(module => (module.default as unknown as () => Promise<JoltModule>)())
    .then(jolt => (loaded = jolt))
    .catch(error => { console.warn("[death] physics unavailable; deaths keep their animated fall", error); return null; });
  return loading;
}

/** The module, once it has arrived. Never blocks. */
export const joltReady = (): JoltModule | null => loaded;
