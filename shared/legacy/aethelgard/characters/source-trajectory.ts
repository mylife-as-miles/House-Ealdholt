/** Exact, piecewise linear source-frame traffic. This is a scheduling layer;
 * it never changes source geometry, body radii or physical arrival evidence. */
import type {VillageSitePoint} from './village-site';
export interface SourceTrajectorySegment {
 readonly start:number;readonly end:number;readonly from:VillageSitePoint;readonly to:VillageSitePoint;
 readonly fromDistance:number;readonly toDistance:number;
}
export type SourceTrajectory=readonly SourceTrajectorySegment[];
export interface SourceTrafficBody {readonly radius:number;readonly height:number}
/** Positive headroom at a scheduling contact, never a smaller collision body. */
export const SOURCE_TRAFFIC_CONTACT_MARGIN_METRES=1e-6;
const EPS=1e-10,MAX_SEGMENTS=16384;
const span=(a:VillageSitePoint,b:VillageSitePoint)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const samples=new WeakMap<object,readonly number[]>();
function sourceDistances(points:readonly VillageSitePoint[]):readonly number[]{const cached=samples.get(points);if(cached)return cached;const out=[0];for(let i=1;i<points.length;i++)out.push(out[i-1]+span(points[i-1],points[i]));if(Object.isFrozen(points)&&points.every(Object.isFrozen))samples.set(points,out);return out;}
function positionAt(points:readonly VillageSitePoint[],distances:readonly number[],progress:number):VillageSitePoint{
 let low=1,high=points.length-1;while(low<high){const middle=(low+high)>>>1;if(distances[middle]<progress)low=middle+1;else high=middle;}const a=points[low-1],b=points[low],length=distances[low]-distances[low-1],t=length?Math.max(0,Math.min(1,(progress-distances[low-1])/length)):0;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
}
export function sourcePolylinePosition(points:readonly VillageSitePoint[],progress:number):VillageSitePoint{
 return points.length>1?positionAt(points,sourceDistances(points),progress):points[0];
}
export function stationarySourceTrajectory(point:VillageSitePoint,start:number,end:number,progress=0):SourceTrajectory{
 return[{start,end,from:point,to:point,fromDistance:progress,toDistance:progress}];
}
/** Exact source knots are retained. Reaching an endpoint early adds a real
 * stationary interval rather than stretching movement to the requested time. */
export function sourceRouteTrajectory(points:readonly VillageSitePoint[],from:number,to:number,start:number,end:number,speed:number):SourceTrajectory{
 if(points.length<2||points.length>MAX_SEGMENTS||!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(start)||!(end>=start)||!(speed>0&&Number.isFinite(speed)))throw Error('Invalid bounded source trajectory.');
 if(from===to)return stationarySourceTrajectory(sourcePolylinePosition(points,from),start,end,from);
 const cumulative=sourceDistances(points);
 const lo=Math.min(from,to),hi=Math.max(from,to),knots=cumulative.filter(p=>p>lo&&p<hi);if(to<from)knots.reverse();const stops=[from,...knots,to],out:SourceTrajectorySegment[]=[];let at=start;
 for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i],until=at+Math.abs(b-a)/speed;if(until>end+1e-7)throw Error('Source motion exceeds its authoritative interval.');out.push({start:at,end:Math.min(until,end),from:positionAt(points,cumulative,a),to:positionAt(points,cumulative,b),fromDistance:a,toDistance:b});at=until;}
 if(at<end)out.push(...stationarySourceTrajectory(sourcePolylinePosition(points,to),at,end,to));return out;
}
export function futureSourceRouteTrajectory(points:readonly VillageSitePoint[],progress:number,direction:1|-1,start:number,speed:number):SourceTrajectory{
 const distances=sourceDistances(points),length=distances[distances.length-1],to=direction===1?length:0,end=start+Math.abs(to-progress)/speed;
 return[...sourceRouteTrajectory(points,progress,to,start,end,speed),...stationarySourceTrajectory(sourcePolylinePosition(points,to),end,Infinity,to)];
}
export function sourceTrajectoryPositionAt(trace:SourceTrajectory,at:number):{position:VillageSitePoint;progress:number;moving:boolean}{
 const s=trace.find(s=>at>=s.start-EPS&&at<s.end-EPS)??trace[trace.length-1],t=s.end>s.start&&Number.isFinite(s.end)?Math.max(0,Math.min(1,(at-s.start)/(s.end-s.start))):0;
 return{position:[s.from[0]+(s.to[0]-s.from[0])*t,s.from[1]+(s.to[1]-s.from[1])*t,s.from[2]+(s.to[2]-s.from[2])*t],progress:s.fromDistance+(s.toDistance-s.fromDistance)*t,moving:s.fromDistance!==s.toDistance};
}
export function stopSourceTrajectory(trace:SourceTrajectory,at:number,end:number):SourceTrajectory{
 const p=sourceTrajectoryPositionAt(trace,at),out:SourceTrajectorySegment[]=[];
 for(const s of trace){if(s.start>=at)break;if(s.end<=at)out.push(s);else{out.push({...s,end:at,to:p.position,toDistance:p.progress});break;}}
 return[...out,...stationarySourceTrajectory(p.position,at,end,p.progress)];
}
function velocity(s:SourceTrajectorySegment):VillageSitePoint{const d=s.end-s.start;return d>0&&Number.isFinite(d)?[(s.to[0]-s.from[0])/d,(s.to[1]-s.from[1])/d,(s.to[2]-s.from[2])/d]:[0,0,0];}
/** First simultaneous horizontal-cylinder contact in the exact overlapping
 * vertical body bands. Linear relative motion yields one bounded quadratic;
 * stationary endpoints also participate. Exhaustion fails closed at onset. */
export function firstSourceTrajectoryContact(a:SourceTrajectory,body:SourceTrafficBody,b:SourceTrajectory,peer:SourceTrafficBody):number|null{
 let i=0,j=0,steps=0;const radius=body.radius+peer.radius+SOURCE_TRAFFIC_CONTACT_MARGIN_METRES;
 while(i<a.length&&j<b.length){const x=a[i],y=b[j];let lo=Math.max(x.start,y.start),hi=Math.min(x.end,y.end);
  if(++steps>MAX_SEGMENTS*2)return lo;
  if(lo<=hi){const u=velocity(x),v=velocity(y),dx=x.from[0]+u[0]*(lo-x.start)-y.from[0]-v[0]*(lo-y.start),dy=x.from[1]+u[1]*(lo-x.start)-y.from[1]-v[1]*(lo-y.start),dz=x.from[2]+u[2]*(lo-x.start)-y.from[2]-v[2]*(lo-y.start),vx=u[0]-v[0],vy=u[1]-v[1],vz=u[2]-v[2];
   let from=0,to=hi-lo;
   if(![dx,dy,dz,vx,vy,vz,radius,body.height,peer.height].every(Number.isFinite))return lo;
   if(Math.abs(vy)<1e-14){if(dy>peer.height||dy< -body.height)from=Infinity;}
   else{const p=(-body.height-dy)/vy,q=(peer.height-dy)/vy;from=Math.max(0,Math.min(p,q));to=Math.min(to,Math.max(p,q));}
   if(from<=to){const quadratic=vx*vx+vz*vz,linear=2*(dx*vx+dz*vz),constant=dx*dx+dz*dz-radius*radius;
    if(quadratic<1e-24){if(constant<=0)return lo+from;}
    else{const disc=linear*linear-4*quadratic*constant;if(disc>=0){const root=Math.sqrt(disc),enter=(-linear-root)/(2*quadratic),leave=(-linear+root)/(2*quadratic),at=Math.max(from,enter);if(at<=Math.min(to,leave))return lo+at;}}
   }
  }
  if(x.end<=y.end)i++;if(y.end<=x.end)j++;
 }
 return null;
}
