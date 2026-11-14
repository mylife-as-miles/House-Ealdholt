import {sampleEaldholtFarGeography,type EaldholtFarGeography} from './far-surround';
import {EALDHOLT_REGIONAL_WORLD as POLICY} from './regional-world-policy';
/** CPU support for the existing Native analytic far-ground shader. Background
 * placement only; no collision mesh is added to the miniature's solid bounds. */
export function createRegionalProjectedGround(g:EaldholtFarGeography){
 const s=g.sourceEnvelope,minX=s.minX-450,maxX=s.maxX+POLICY.forestExtent.east,minZ=s.minZ-POLICY.forestExtent.north,maxZ=s.maxZ+POLICY.forestExtent.south;
 const nx=Math.ceil((maxX-minX)/48),nz=Math.ceil((maxZ-minZ)/48),positions=new Float32Array((nx+1)*(nz+1)*3),indices=new Uint32Array(nx*nz*6);
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const px=minX+(maxX-minX)*x/nx,pz=minZ+(maxZ-minZ)*z/nz;positions.set([px,sampleEaldholtFarGeography(g,px,pz).level,pz],(z*(nx+1)+x)*3);}
 let at=0;for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x,b=a+1,c=a+nx+1;indices.set([a,c,b,b,c,c+1],at);at+=6;}
 return{positions,indices};
}
