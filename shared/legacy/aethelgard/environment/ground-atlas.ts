import { noise3 } from '../../environment/kernel/noise';
import { linearToSrgb, smoothstep } from '../../environment/kernel/math';
import type { SourceGrassSite } from './source-vegetation';

export interface GroundBounds { minX:number; maxX:number; minZ:number; maxZ:number }
export interface GroundMesh { positions:Float32Array; normals:Float32Array; indices:ArrayLike<number> }
export interface GroundSamples { size:number; heights:Float32Array; normals:Float32Array; coveredPixels:number }

export function groundUv(x:number,z:number,b:GroundBounds):[number,number] {
  if(![x,z,b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite)||b.maxX<=b.minX||b.maxZ<=b.minZ) throw new RangeError('Invalid ground atlas coordinates.');
  return [Math.max(0,Math.min(1,(x-b.minX)/(b.maxX-b.minX))),Math.max(0,Math.min(1,(z-b.minZ)/(b.maxZ-b.minZ)))];
}

/** Actual world triangles, not an invented flat floor. X/Z projection is valid
 * for the source heightfield. The highest real triangle wins any overlap. */
export function rasterGround(meshes:readonly GroundMesh[],b:GroundBounds,size:number):GroundSamples {
  groundUv(b.minX,b.minZ,b);
  if(!Number.isInteger(size)||size<2||size>2048) throw new RangeError('Ground raster size must be 2..2048.');
  const heights=new Float32Array(size*size).fill(NaN),normals=new Float32Array(size*size*3);
  const sx=size/(b.maxX-b.minX),sz=size/(b.maxZ-b.minZ);
  let coveredPixels=0;
  for(const mesh of meshes) for(let i=0;i<mesh.indices.length;i+=3) {
    const a=mesh.indices[i]*3,c=mesh.indices[i+1]*3,d=mesh.indices[i+2]*3,p=mesh.positions;
    const ax=(p[a]-b.minX)*sx,az=(p[a+2]-b.minZ)*sz,cx=(p[c]-b.minX)*sx,cz=(p[c+2]-b.minZ)*sz,dx=(p[d]-b.minX)*sx,dz=(p[d+2]-b.minZ)*sz;
    const denominator=(cz-dz)*(ax-dx)+(dx-cx)*(az-dz);
    if(Math.abs(denominator)<1e-10) continue;
    const x0=Math.max(0,Math.ceil(Math.min(ax,cx,dx)-.5)),x1=Math.min(size-1,Math.floor(Math.max(ax,cx,dx)-.5));
    const z0=Math.max(0,Math.ceil(Math.min(az,cz,dz)-.5)),z1=Math.min(size-1,Math.floor(Math.max(az,cz,dz)-.5));
    for(let z=z0;z<=z1;z++) for(let x=x0;x<=x1;x++) {
      const wa=((cz-dz)*(x+.5-dx)+(dx-cx)*(z+.5-dz))/denominator;
      const wc=((dz-az)*(x+.5-dx)+(ax-dx)*(z+.5-dz))/denominator,wd=1-wa-wc;
      if(wa< -1e-7||wc< -1e-7||wd< -1e-7) continue;
      const index=z*size+x,y=p[a+1]*wa+p[c+1]*wc+p[d+1]*wd;
      if(Number.isFinite(heights[index])&&heights[index]>y) continue;
      if(!Number.isFinite(heights[index])) coveredPixels++;
      heights[index]=y;
      for(let k=0;k<3;k++) normals[index*3+k]=mesh.normals[a+k]*wa+mesh.normals[c+k]*wc+mesh.normals[d+k]*wd;
    }
  }
  return {size,heights,normals,coveredPixels};
}

/** World-space grain varies only albedo. Grass coverage comes exclusively from
 * actual source placements; no noise is used as a path, water or plant mask.
 * LAAS's macro/meso/micro surface approach uses Crownfall's owned lattice noise. */
export function groundAlbedo(x:number,y:number,z:number,slope:number,density:number):[number,number,number] {
  const rock=smoothstep(.62,1.15,slope),grass=smoothstep(.5,.22,slope)*Math.max(0,Math.min(1,density))*(1-rock);
  const soilW=(1-grass)*(1-rock),grassW=grass*(1-rock);
  const macro=(noise3(x*.075,y*.075,z*.075,4311)-.5)*.14;
  const meso=(noise3(x*.95,y*.95,z*.95,4313)-.5)*.18;
  const micro=(noise3(x*6.7,y*6.7,z*6.7,4319)-.5)*.13;
  const detail=1+macro+meso+micro;
  const soil=[.105,.081,.054],olive=[.052,.079,.026],slate=[.055,.063,.071];
  return soil.map((v,c)=>Math.round(Math.max(0,Math.min(1,linearToSrgb((v*soilW+olive[c]*grassW+slate[c]*rock)*detail)))*255)) as [number,number,number];
}

/** Bounded splats use real clump footprints and reject grass above/below the
 * sampled source ground. This estimates presence, not the missing paint mask. */
export function rasterSourceGrass(sites:readonly SourceGrassSite[],surface:GroundSamples,b:GroundBounds):Float32Array {
  if(sites.length>100_000) throw new RangeError('Too many source plants for the bounded ground bake.');
  const {size,heights}=surface,result=new Float32Array(size*size),seen=new Set<string>();
  const stepX=(b.maxX-b.minX)/size,stepZ=(b.maxZ-b.minZ)/size;
  for(const site of sites) {
    if(!site.origin.every(Number.isFinite)||!Number.isFinite(site.footprintRadius)||site.footprintRadius<=0) throw new RangeError('Invalid source plant footprint.');
    const [x,y,z]=site.origin,id=site.origin.map(v=>Math.round(v*100)).join(',');
    if(seen.has(id)) continue;seen.add(id);
    const r=Math.max(.3,Math.min(2.5,site.footprintRadius));
    const x0=Math.max(0,Math.ceil((x-r-b.minX)/stepX-.5)),x1=Math.min(size-1,Math.floor((x+r-b.minX)/stepX-.5));
    const z0=Math.max(0,Math.ceil((z-r-b.minZ)/stepZ-.5)),z1=Math.min(size-1,Math.floor((z+r-b.minZ)/stepZ-.5));
    for(let iz=z0;iz<=z1;iz++) for(let ix=x0;ix<=x1;ix++) {
      const index=iz*size+ix,h=heights[index],dy=Math.abs(h-y);
      if(!Number.isFinite(h)||dy>=.65) continue;
      const dx=b.minX+(ix+.5)*stepX-x,dz=b.minZ+(iz+.5)*stepZ-z,q=(dx*dx+dz*dz)/(r*r);
      if(q>=1) continue;
      const vertical=1-(dy/.65)**2;
      result[index]+=(1-q)**2*vertical**2;
    }
  }
  for(let i=0;i<result.length;i++) result[i]=1-Math.exp(-result[i]);
  return result;
}
