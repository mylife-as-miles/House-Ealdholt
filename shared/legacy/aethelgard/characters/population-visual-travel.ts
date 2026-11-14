/** Source-arc presentation only. This never advances life/nav, declares arrival,
 * selects a new path, changes reservations or emits physical work receipts. */
import type {VillagePopulationResidentState} from './village-population-runtime';
import {qualifiedVillageLifeVisualRoute} from './village-life-navigation';
import {sameVillageSiteNavigationAllocation,type VillageSiteLayout,type VillageSitePoint} from './village-site';
export interface PopulationVisualTravel {
 readonly points:readonly VillageSitePoint[];readonly length:number;readonly progress:number;readonly direction:1|-1;
 readonly metresPerSecond:number;readonly maximumSeconds:number;
}
const EPS=1e-6;
/** Full source requalification occurs on publication, never per render frame. */
export function preparePopulationVisualTravel(state:VillagePopulationResidentState,site:VillageSiteLayout):PopulationVisualTravel|null {
 const t=state.visualTravel,r=t?.journey;if(!t||!r||!state.moving||state.status!=='travelling'||state.navigationStatus!=='travelling'||state.navigationReason!==null
  ||!state.presentable||!state.position||r.residentId!==state.residentId||t.profile!==site.profile||t.sourceSha256!==site.sourceSha256
  ||r.sourceSiteIdentity!==t.siteIdentity||t.navigationRevision!==site.navigationRevision||!sameVillageSiteNavigationAllocation(t.navigationAllocation,site.navigationAllocation)
  ||!Number.isFinite(t.metresPerSecond)||t.metresPerSecond<.1||t.metresPerSecond>4||!Number.isFinite(t.maximumAdvanceSeconds)||t.maximumAdvanceSeconds<0
  ||!qualifiedVillageLifeVisualRoute(r,site)||r.targetPlaceId!==state.lifeIntent?.targetPlaceId)return null;
 if(r.emergencyTraversal&&(state.emergency?.requiredLocomotionClip!==r.emergencyTraversal.requiredClip||state.emergency.traversalId!==r.emergencyTraversal.id||!state.emergency.qualified))return null;
 const route=r.route!;if(!Number.isFinite(route.lengthMetres)||route.lengthMetres<=0||!Number.isFinite(r.progressMetres)||r.progressMetres<0||r.progressMetres>route.lengthMetres||r.direction!==1&&r.direction!==-1)return null;
 const prepared=Object.freeze({points:route.sourceGroundPolyline,length:route.lengthMetres,progress:r.progressMetres,direction:r.direction,metresPerSecond:t.metresPerSecond,maximumSeconds:t.maximumAdvanceSeconds});
 const initial:[number,number,number]=[0,0,0];samplePopulationVisualTravel(prepared,0,initial);
 if(state.position.some((v,i)=>Math.abs(v-initial[i])>EPS))return null;
 return prepared;
}
/** Write only an existing actor's presentation buffer; preserve curved source
 * polylines and stop short of unconfirmed arrival and the next causal minute. */
export function samplePopulationVisualTravel(travel:PopulationVisualTravel,seconds:number,out:[number,number,number]):number {
 const elapsed=Math.max(0,Math.min(travel.maximumSeconds,Number.isFinite(seconds)?seconds:0));
 const predicted=travel.progress+travel.direction*elapsed*travel.metresPerSecond;
 const progress=travel.direction===1?Math.max(travel.progress,Math.min(Math.max(0,travel.length-.001),predicted)):Math.min(travel.progress,Math.max(Math.min(travel.length,.001),predicted));
 let traversed=0;const points=travel.points;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],span=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  if(progress<=traversed+span+EPS||i===points.length-1){const t=span>EPS?Math.max(0,Math.min(1,(progress-traversed)/span)):0;
   for(let k=0;k<3;k++)out[k]=a[k]+(b[k]-a[k])*t;
   return Math.atan2((b[0]-a[0])*travel.direction,(b[2]-a[2])*travel.direction);}
  traversed+=span;
 }
 return 0;
}
