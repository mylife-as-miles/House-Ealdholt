/** Authored future refuge parking must leave the source-qualified recovery
 * workplace usable. This is a spatial exclusion, never work or route authority. */
import {EALDHOLT_WOOD_WORKPLACE_CANDIDATE as work} from './ealdholt-wood-workplace-candidate';
import type {VillageSitePoint} from './village-site';
type Body={readonly radius:number;readonly height:number;readonly margin:number;readonly lift:number};
const same=(a:VillageSitePoint,b:VillageSitePoint)=>a.every((v,k)=>v===b[k]);
export function recoveryWorkParkingObstruction(point:VillageSitePoint,body:Body,residentId:string,sourceSha256:string,profile:'desktop'|'quest'):'invalid-body'|'work-volume'|'recovery-route'|'timber-route'|null{
 if(profile!=='desktop'||sourceSha256!==work.sourceSha256)return null;
 if(!point.every(Number.isFinite)||![body.radius,body.height,body.margin,body.lift].every(Number.isFinite)||body.radius<=0||body.height<=0)return'invalid-body';
 const radius=body.radius+body.margin,height=body.height+body.lift+body.margin,p=work.workPoint,r=work.workBody.radius+work.workBody.margin+radius,h=work.workBody.height+work.workBody.lift+work.workBody.margin;
 if(point[1]<p[1]+h&&point[1]+height>p[1]&&Math.abs(point[0]-p[0])<=r&&Math.abs(point[2]-p[2])<=r)return'work-volume';
 for(const [kind,points]of [['recovery-route',work.recoveryApproach.routePoints],['timber-route',work.routePoints]]as const){
  if(kind==='recovery-route'&&residentId===work.residentId&&same(point,work.recoveryApproach.sourceGroundPoint))continue;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(point[1]>=Math.max(a[1],b[1])+work.routeBody.height+work.routeBody.lift+work.routeBody.margin||point[1]+height<=Math.min(a[1],b[1]))continue;
   const dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[2]-a[2])*dz)/n)):0;
   if(Math.hypot(point[0]-a[0]-t*dx,point[2]-a[2]-t*dz)<radius+work.routeBody.radius+work.routeBody.margin-1e-7)return kind;
  }
 }
 return null;
}
