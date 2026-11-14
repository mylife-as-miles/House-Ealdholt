import {sampleEaldholtFarGeography, type EaldholtFarGeography} from './far-surround';

/** Regional scenery in source metres, east of the authored settlement. The
 * source map supplies directions, not surveyed distances; these are explicit
 * visual-scale defaults. Never use this background owner for NPC placement. */
export interface EaldholtRegionalHorizon {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colours: Float32Array;
  readonly uv: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: {readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number]};
  readonly byteLength: number;
  readonly axes: 'source:+X-east/-Z-north';
  readonly placementEligible: false;
}
const smooth = (a: number, b: number, v: number) => {const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const gauss = (x: number,z: number,cx: number,cz: number,rx: number,rz: number) => Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));

/** A connected ridge and northeastern snowy massif, rather than a wall/ring
 * around the village. Coast, inlet, source buildings and local terrain remain
 * outside its footprint. The existing river cuts a broad low valley through it. */
export function createEaldholtRegionalHorizon(g: EaldholtFarGeography, profile: 'desktop'|'quest'='desktop'): EaldholtRegionalHorizon {
  const s=g.sourceEnvelope;
  if(g.axes!=='source:+X-east/-Z-north'||!Object.values(s).every(Number.isFinite)||s.minX>=s.maxX||s.minZ>=s.maxZ||!['desktop','quest'].includes(profile))throw Error('Regional horizon requires the validated source geography.');
  const cx=s.maxX+3200,cz=(s.minZ+s.maxZ)/2;
  const boundsXZ={minX:s.maxX+900,maxX:s.maxX+6200,minZ:cz-6500,maxZ:cz+5500};
  const nx=profile==='quest'?64:96,rows=profile==='quest'?128:192;
  const channel=g.channelSamples,low=channel[channel.length-3],high=channel[channel.length-2];
  // Exact bank/valley rows prevent a coarse far triangle from bridging over
  // the narrow continued river even when it falls between regular grid rows.
  const zRows=[...new Set([...Array.from({length:rows+1},(_,i)=>boundsXZ.minZ+(boundsXZ.maxZ-boundsXZ.minZ)*i/rows),
    low-430,low-70,low,high,high+70,high+430].filter(z=>z>=boundsXZ.minZ&&z<=boundsXZ.maxZ))].sort((a,b)=>a-b),nz=zRows.length-1;
  function height(x:number,z:number){
    const field=sampleEaldholtFarGeography(g,x,z);
    if(field.kind!=='mainland')return field.level-1;
    const axial=x-cx-(Math.sin(z*.00051)*230+Math.sin(z*.00113)*110);
    const north=gauss(x,z,cx-180,cz-3350,930,1850);
    const peaks=gauss(x,z,cx+80,cz-900,720,900)*660+gauss(x,z,cx+130,cz+1150,680,1000)*790+gauss(x,z,cx+330,cz+3300,790,1050)*580;
    const ridge=Math.exp(-((axial/820)**2))*(230+85*Math.sin(z*.0021)+45*Math.sin(z*.0047));
    const rock=1+.13*Math.sin(x*.0061+z*.0049)+.07*Math.sin(x*.0133-z*.0107);
    const c=g.channelSamples,low=c[c.length-3],high=c[c.length-2];
    const riverDistance=x<g.riverJoinX?Infinity:Math.max(low-z,z-high);
    const edge=smooth(boundsXZ.minX,boundsXZ.minX+450,x)*(1-smooth(boundsXZ.maxX-650,boundsXZ.maxX,x))
      *smooth(boundsXZ.minZ,boundsXZ.minZ+600,z)*(1-smooth(boundsXZ.maxZ-600,boundsXZ.maxZ,z));
    const foothills=gauss(x,z,cx-1250,cz-800,1200,3600)*(100+30*Math.sin(z*.0017));
    return field.level+Math.max(0,(ridge+peaks+north*1120+foothills)*rock)*edge*smooth(90,880,riverDistance);
  }
  const positions=new Float32Array((nx+1)*(nz+1)*3),normals=new Float32Array(positions.length),colours=new Float32Array(positions.length);
  const uv=new Float32Array((nx+1)*(nz+1)*2);
  const indices=new Uint32Array(nx*nz*6),min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const x=boundsXZ.minX+(boundsXZ.maxX-boundsXZ.minX)*ix/nx,z=zRows[iz],y=height(x,z),at=(iz*(nx+1)+ix)*3;
    positions.set([x,y,z],at);
    uv.set([x/4,z/4],at/3*2);
    const dx=(height(x+2,z)-height(x-2,z))/4,dz=(height(x,z+2)-height(x,z-2))/4,length=Math.hypot(dx,1,dz);
    normals.set([-dx/length,1/length,-dz/length],at);
    const stone=smooth(170,540,y-g.seaLevel),north=1-smooth(cz-1500,cz-500,z),snow=smooth(680,1050,y-g.seaLevel)*north;
    const vegetation=[.105,.142,.085],rock=[.27,.25,.23],ice=[.72,.77,.79];
    for(let k=0;k<3;k++){colours[at+k]=(vegetation[k]*(1-stone)+rock[k]*stone)*(1-snow)+ice[k]*snow;min[k]=Math.min(min[k],positions[at+k]);max[k]=Math.max(max[k],positions[at+k]);}
  }
  let at=0;for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;
    indices.set([a,c,b,b,c,d],at);at+=6;
  }
  return {positions,normals,colours,uv,indices,bounds:{min,max},byteLength:positions.byteLength+normals.byteLength+colours.byteLength+uv.byteLength+indices.byteLength,axes:g.axes,placementEligible:false};
}
