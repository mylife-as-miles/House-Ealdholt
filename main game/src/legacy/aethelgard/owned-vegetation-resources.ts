import type {WorldOwnerRetirement} from '../../../../shared/legacy/aethelgard/environment/world-owner-retirement';
import type {VegetationPrototypeResources} from './vegetation-prototype';
/** A single cell's paid references to the RAW shared pool. Family/global
 * capture facades deliberately do not participate in this local lifetime. */
export function scopeOwnedVegetationResources(base:VegetationPrototypeResources,owner:WorldOwnerRetirement):VegetationPrototypeResources {
 return{...base,
  ownerBuffers:(...args)=>owner.acquire(()=>base.ownerBuffers(...args)),
  material:(...args)=>owner.acquire(()=>base.material(...args)),
  geometry:(...args)=>owner.acquire(()=>base.geometry(...args)),
  indices:(...args)=>owner.acquire(()=>base.indices(...args)),
  atlas:(...args)=>owner.acquire(()=>base.atlas(...args)),
  compile:(...args)=>owner.acquire(()=>base.compile(...args)),
  dispose(){/* The world owns the pool; ordered retirement releases these leases. */},
 };
}
