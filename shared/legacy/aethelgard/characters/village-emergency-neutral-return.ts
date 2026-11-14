/** A measured neutral pose retained after a real carry return. This capability
 * grants one original stand, no private carry branch and no new journey. */
import {placeDataRecord} from '../place-use';
import {findVillageEmergencyTraversal,type VillageEmergencyNeutralReturn} from './village-emergency-traversal';
import {resolveVillageSiteEndpoint,type VillageSiteLayout} from './village-site';
export interface VillageEmergencyNeutralReturnRef {readonly id:string;readonly certificateSha256:string;readonly anchorId:string;readonly placeId:string}
const scopes=new WeakMap<VillageSiteLayout,Map<string,VillageSiteLayout>>(),bases=new WeakMap<VillageSiteLayout,VillageSiteLayout>();
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/u.test(v)&&!['__proto__','constructor','prototype'].includes(v);
export function parseVillageEmergencyNeutralReturnRef(value:unknown):VillageEmergencyNeutralReturnRef{
 const r=placeDataRecord(value,['id','certificateSha256','anchorId','placeId']);
 if(!id(r.id)||typeof r.certificateSha256!=='string'||!/^[a-f0-9]{64}$/u.test(r.certificateSha256)||!id(r.anchorId)||!id(r.placeId))throw Error('Invalid exact neutral return reference.');return value as VillageEmergencyNeutralReturnRef;
}
export function baseVillageEmergencyNeutralReturnSite(site:VillageSiteLayout):VillageSiteLayout{return bases.get(site)??site;}
export function findVillageEmergencyNeutralReturn(site:VillageSiteLayout,ref:VillageEmergencyNeutralReturnRef,residentId:string):VillageEmergencyNeutralReturn|null{
 parseVillageEmergencyNeutralReturnRef(ref);const base=baseVillageEmergencyNeutralReturnSite(site),cap=findVillageEmergencyTraversal(base,{id:ref.id,certificateSha256:ref.certificateSha256,requiredClip:'carry_bucket_walk'},residentId),stand=resolveVillageSiteEndpoint(base,ref.placeId,residentId);
 return cap?.neutralReturn&&stand?.id===ref.anchorId&&base.anchors.some(a=>a.id===ref.anchorId)?cap.neutralReturn:null;
}
export function scopedVillageEmergencyNeutralReturnSite(site:VillageSiteLayout,ref:VillageEmergencyNeutralReturnRef,residentId:string):VillageSiteLayout|null{
 const base=baseVillageEmergencyNeutralReturnSite(site),proof=findVillageEmergencyNeutralReturn(base,ref,residentId);if(!proof)return null;
 let byRef=scopes.get(base);if(!byRef){byRef=new Map();scopes.set(base,byRef);}const key=residentId+'\0'+ref.id+'\0'+ref.anchorId+'\0'+ref.placeId,old=byRef.get(key);if(old)return old;
 const scoped=Object.freeze({...base,capsule:Object.freeze({radius:proof.body.radius+proof.body.margin,height:proof.body.height+proof.body.lift+proof.body.margin})});bases.set(scoped,base);byRef.set(key,scoped);return scoped;
}
