import {sampleEaldholtFarGeography,type EaldholtFarGeography} from './far-surround';
import type {EaldholtWoodlandSurface} from './river-woodland';
/** Match Native's existing analytic far projection, without adding distant
 * collision surfaces or changing the measured miniature support envelope. */
export function createEaldholtProjectedWoodlandSupport(g:EaldholtFarGeography){
  const b=g.sourceEnvelope,minX=b.minX-200,maxX=b.maxX+850,minZ=b.minZ-550,maxZ=b.maxZ+600;
  const nx=Math.ceil((maxX-minX)/12),nz=Math.ceil((maxZ-minZ)/12);
  if(nx*nz>65536)throw Error('Projected woodland support exceeds its local scenery budget.');
  const positions=new Float32Array((nx+1)*(nz+1)*3),indices:number[]=[];
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
    const px=minX+(maxX-minX)*x/nx,pz=minZ+(maxZ-minZ)*z/nz,id=z*(nx+1)+x;
    positions.set([px,sampleEaldholtFarGeography(g,px,pz).level,pz],id*3);
    if(x&&z){const a=id-nx-2,b=id-nx-1,c=id-1;indices.push(a,c,b,b,c,id);}
  }
  // Exact piecewise-linear coast/channel strips catch narrow water wedges
  // between the eight crown probes. These are CPU exclusion data only.
  const water:EaldholtWoodlandSurface[]=[];
  const strip=(ax:number,az:number,bx:number,bz:number,cx:number,cz:number,dx:number,dz:number)=>water.push({positions:[ax,0,az,bx,0,bz,cx,0,cz,dx,0,dz],indices:[0,1,2,2,1,3]});
  const interpolate=(samples:Float32Array,stride:number,key:number,component:number)=>{
    if(key<=samples[0])return samples[component];
    for(let at=stride;at<samples.length;at+=stride)if(key<=samples[at]){
      const t=(key-samples[at-stride])/(samples[at]-samples[at-stride]);return samples[at-stride+component]+t*(samples[at+component]-samples[at-stride+component]);}
    return samples[samples.length-stride+component];
  };
  const coast=g.coastSamples,zs=[minZ,...Array.from(coast).filter((_,i)=>i%2===0).filter(z=>z>minZ&&z<maxZ),maxZ].sort((a,b)=>a-b);
  for(let i=1;i<zs.length;i++){const a=zs[i-1],b=zs[i];strip(minX-100,a,interpolate(coast,2,a,1),a,minX-100,b,interpolate(coast,2,b,1),b);}
  const c=g.channelSamples,xs=[Math.max(minX,c[0]),...Array.from(c).filter((_,i)=>i%4===0).filter(x=>x>minX&&x<maxX),maxX].sort((a,b)=>a-b);
  for(let i=1;i<xs.length;i++){const a=xs[i-1],b=xs[i];if(b<=a)continue;strip(a,interpolate(c,4,a,1),a,interpolate(c,4,a,2),b,interpolate(c,4,b,1),b,interpolate(c,4,b,2));}
  return {land:[{positions,indices:Uint32Array.from(indices)}],water};
}
