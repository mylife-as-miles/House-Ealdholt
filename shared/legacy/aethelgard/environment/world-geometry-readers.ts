import type {WorldOwnerRetirement} from './world-owner-retirement';
interface ReaderLease {readonly ready:PromiseLike<unknown>;release():void}
const owners=new WeakMap<object,WorldOwnerRetirement>();
/** Private draw views/cards are bound before publication. Raw/shared source
 * geometry and ordinary owners retain their existing global queue barrier. */
export function bindWorldGeometryOwner(geometry:object,owner:WorldOwnerRetirement):void {
 const prior=owners.get(geometry);if(prior&&prior!==owner)throw Error('Private world geometry already has an owner.');owners.set(geometry,owner);
}
/** A prepared program is not permission to reattach a retired private view.
 * Raw/shared source geometry continues to use its existing global barrier. */
export function isWorldGeometryReaderActive(geometry:object):boolean {
 const owner=owners.get(geometry);return !owner||owner.stats.phase==='active';
}
/** Admission occurs before the factory clones or enqueues anything. A retired
 * private view remains tagged until GC, so detached late readers fail closed. */
export function acquireWorldGeometryReader<T extends ReaderLease>(geometry:object,factory:()=>T):T|null {
 const owner=owners.get(geometry);if(!owner)return factory();
 if(owner.stats.phase!=='active')return null;
 let started=false;
 try{return owner.acquire(()=>{started=true;return factory();});}
 catch(cause){if(!started)return null;throw cause;}
}
