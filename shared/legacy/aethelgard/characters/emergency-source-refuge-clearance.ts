/** Exact source refuge qualification. A canopy may cover public woodland;
 * original architectural overhead still forbids treating an interior as a
 * refuge or as an exterior escape corridor. No mesh is created or changed. */
import {qualifySourceEmergencyRoute,sourceRouteBoxesOverlap,sourceRouteCylinderIntersectsTriangle,sourceRouteSegmentBox,sourceRouteTriangleBox,
 type SourceRouteBody,type SourceRouteBox,type SourceRoutePoint,type SourceRouteTriangle} from './emergency-source-route-clearance';

export interface SourceRefugeGeometry {
 readonly ground:readonly SourceRouteTriangle[];readonly rigid:readonly SourceRouteTriangle[];
 readonly architecture:readonly SourceRouteTriangle[];readonly water:readonly SourceRouteBox[];
 readonly points:readonly SourceRoutePoint[];readonly body:SourceRouteBody;
}
/** Points and original triangles remain unrounded. Larger permitted source
 * polylines are checked in overlapping bounded chunks, including every joint. */
export function* qualifySourceEmergencyRefuge(input:SourceRefugeGeometry):Generator<void,void,unknown>{
 const{points,body,architecture}=input;
 if(points.length<2||points.length>256||points.some(p=>p.length!==3||p.some(n=>!Number.isFinite(n)))||architecture.length>250000)throw Error('Refuge source geometry exceeds its finite proof budget.');
 for(let first=0;first<points.length-1;first+=63){
  const proof=qualifySourceEmergencyRoute({...input,points:points.slice(first,first+64)});
  let step=proof.next();while(!step.done){yield;step=proof.next();}
 }
 const boxes:SourceRouteBox[]=[];for(let i=0;i<architecture.length;i++){if(i%256===0)yield;boxes.push(sourceRouteTriangleBox(architecture[i]));}
 let visited=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],radius=body.radius+body.margin,low=Math.min(a[1],b[1])+.005,box=sourceRouteSegmentBox(a,b,radius,low,Infinity);
  for(let k=0;k<architecture.length;k++){if(++visited%512===0)yield;
   if(sourceRouteBoxesOverlap(boxes[k],box)&&sourceRouteCylinderIntersectsTriangle(a,b,architecture[k],radius,low,Infinity))throw Error('Refuge route enters original architectural overhead.');
  }
 }
}
