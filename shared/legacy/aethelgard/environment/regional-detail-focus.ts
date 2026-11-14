import {TREE_HLOD} from './vegetation-hlod';

/** Prioritize actual tree roots near the viewed ground, rather than the empty
 * centre of a coarse cell or the point below an overhead camera. This changes
 * visual residency only; actor transforms, collision and navigation stay put. */
export function regionalDetailFocus(target:{x:number;y:number;z:number},eye:{x:number;y:number;z:number},forward:{x:number;y:number;z:number},groundY:number){
 const t=forward.y<-.1?Math.max(0,Math.min(800,(groundY-eye.y)/forward.y)):0;
 target.x=eye.x+forward.x*t;target.y=eye.y+forward.y*t;target.z=eye.z+forward.z*t;
}
export function regionalTreePriority(placements:Float32Array,ids:Uint32Array,focus:{x:number;z:number}){
 let distance=Infinity;for(const id of ids){const at=id*6;if(placements[at+5]>=12)continue;const dx=placements[at]-focus.x,dz=placements[at+2]-focus.z;distance=Math.min(distance,dx*dx+dz*dz);}return distance;
}

/** Keep the viewer's immediate woodland detailed before spending the bounded
 * cell budget at the distant look target. Beyond the near band, preserve the
 * existing viewed-ground priority. All distances are already in source metres. */
export function compareRegionalDetailCells(cameraA:number,focusA:number,cameraB:number,focusB:number){
 const nearA=cameraA<TREE_HLOD.distances[0],nearB=cameraB<TREE_HLOD.distances[0];
 if(nearA!==nearB)return nearA?-1:1;
 return (nearA?cameraA-cameraB:focusA-focusB)||(nearA?focusA-focusB:cameraA-cameraB)||0;
}
