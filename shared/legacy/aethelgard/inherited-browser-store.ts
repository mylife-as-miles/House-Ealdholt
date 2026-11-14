import { createInheritedSessionStore, type InheritedSessionStore, type SerializeInheritedOperation } from "./inherited-storage";

/** Resolve browser capabilities only when the inherited route explicitly asks.
 * Preview imports do not touch storage or acquire a lock. All current inherited
 * and archive mutations share this origin-scoped lock across tabs/platforms. */
export function createBrowserInheritedSessionStore(): InheritedSessionStore | null {
  try {
    const locks = globalThis.navigator?.locks;
    if (!locks || typeof locks.request !== "function") return null;
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const serialize: SerializeInheritedOperation = operation => locks.request(
      "crownfall.legacy.inherited-and-archives", { mode: "exclusive" }, operation,
    );
    return createInheritedSessionStore(storage, serialize);
  } catch { return null; }
}
