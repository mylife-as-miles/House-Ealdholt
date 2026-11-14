import { createHouseholdStore, type HouseholdStore, type HouseholdExclusiveOperation } from './household-storage';
/** Shared thin browser adapter for both lazy hosts. Inert import; capability
 * resolution occurs only when requested. Web Locks/localStorage are origin
 * scoped, not cross-device persistence. No queue/CAS substitute is supplied. */
export function createBrowserHouseholdStore(contentRevision:string):HouseholdStore|null {
  try{
    const locks=globalThis.navigator?.locks;if(!locks||typeof locks.request!=='function')return null;
    const storage=globalThis.localStorage;if(!storage)return null;
    // Same lock as inherited entry/archive mutations: binding reads and sidecar
    // commits cannot race a cooperating writer that replaces confirmed entry.
    const exclusive:HouseholdExclusiveOperation=operation=>locks.request('crownfall.legacy.inherited-and-archives',{mode:'exclusive'},operation);
    return createHouseholdStore({storage,exclusive,contentRevision});
  }catch{return null;}
}
