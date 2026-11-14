import {validateVoxelGrid, type StaticVoxelVolume} from './voxel-volume';

/** Fixed fresh-seed Jacobi transport, never temporal radiance feedback. */
export const VOXEL_INDIRECT_STEPS = 2;
export const VOXEL_INDIRECT_GAIN = .45;
export const VOXEL_RADIANCE_VOLUME_BUDGET = 8 * 1024 ** 2;
export const VOXEL_RADIANCE_OWNER_BUDGET = 16 * 1024 ** 2;
// Two static textures, four published-pair targets and two scratch fields.
export const VOXEL_RADIANCE_ATLAS_UNITS = 8;
export type VoxelLocalLight = {
 readonly position: readonly [number, number, number]; readonly radius: number;
 readonly radiance: readonly [number, number, number];
};
type Point = [number, number, number];
const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const directions = [...faces, [Math.SQRT1_2,Math.SQRT1_2,0], [-Math.SQRT1_2,Math.SQRT1_2,0],
 [0,Math.SQRT1_2,Math.SQRT1_2], [0,Math.SQRT1_2,-Math.SQRT1_2]] as const;
const clamp = (n:number) => Math.max(0, Math.min(1, n));
/** Decode before interpolation/transport, matching the GPU RGBA8 field. */
export function quantizeVoxelRadiance(n:number, scale=8):number {
 return (Math.round(Math.sqrt(clamp(n / scale)) * 255) / 255) ** 2 * scale;
}

/** Independent small-volume numerical execution of the bounded fire transport.
 * Intended for regression, never the runtime/frame loop or a replacement scene. */
export function traceLocalVoxelIndirect(volume:StaticVoxelVolume, lights:readonly VoxelLocalLight[], steps=VOXEL_INDIRECT_STEPS) {
 validateVoxelGrid(volume.grid);
 if (lights.length > 16 || !Number.isInteger(steps) || steps < 0 || steps > VOXEL_INDIRECT_STEPS) throw Error('Invalid bounded local voxel transport.');
 const {grid, albedoOpacity:o} = volume, [nx,ny,nz] = grid.resolution, count = nx*ny*nz;
 const cell = grid.size.map((n,i) => n/grid.resolution[i]);
 if (o.length !== count*4 || lights.some(light => light.position.length !== 3 || light.radiance.length !== 3
  || !Number.isFinite(light.radius) || light.radius <= 0 || light.radius > 1024 || light.position.some(n => !Number.isFinite(n))
  || light.radiance.some(n => !Number.isFinite(n) || n < 0 || n > 32))) throw Error('Invalid local source or occupancy channels.');
 if (count > 32768) throw Error('CPU transport oracle is limited to32768cells.');
 const inside = (x:number,y:number,z:number) => x>=0 && x<nx && y>=0 && y<ny && z>=0 && z<nz;
 const index = (x:number,y:number,z:number) => Math.floor(x)+nx*(Math.floor(y)+ny*Math.floor(z));
 const alpha = (x:number,y:number,z:number) => inside(x,y,z) ? o[index(x,y,z)*4+3]/255 : 0;
 // Reflected sources occupy the empty side of a face, never the interior of
 // an opaque wall. Fractional occupied cells keep a fractional free surface.
 function surface(x:number,y:number,z:number) {
  let weight=0, maximum=0; const colour=[0,0,0];
  for (const d of faces) {
   const xx=x+d[0], yy=y+d[1], zz=z+d[2], a=alpha(xx,yy,zz);
   maximum=Math.max(maximum,a); weight+=a;
   if (a) for (let c=0;c<3;c++) colour[c]+=o[index(xx,yy,zz)*4+c]/255*a;
  }
  return {colour:colour.map(n => weight ? n/weight : 0), weight:(1-alpha(x,y,z))*maximum};
 }
 function facing(x:number,y:number,z:number,d:readonly number[]) {
  let weight=0,result=0;
  for (const f of faces) {
   const a=alpha(x+f[0],y+f[1],z+f[2]); weight+=a;
   result+=a*Math.max(0,-f[0]*d[0]-f[1]*d[1]-f[2]*d[2]);
  }
  return weight ? result/weight : 0;
 }
 function visibility(x:number,y:number,z:number,light:VoxelLocalLight) {
  const target=light.position.map((n,i)=>(n-grid.min[i])/cell[i]);
  const delta=target.map((n,i)=>n-[x+.5,y+.5,z+.5][i]), length=Math.max(...delta.map(Math.abs));
  if (length<1) return 1;
  const stride=delta.map(n=>n/length); let t=1;
  for (let step=1;step<=128 && step<length;step++) {
   const p:Point=[x+.5+stride[0]*step,y+.5+stride[1]*step,z+.5+stride[2]*step];
   if (!inside(...p) || p.every((n,i)=>Math.floor(n)===Math.floor(target[i]))) break;
   t*=1-alpha(...p); if (t<.005) break;
  }
  return t;
 }
 function gather(source:Float32Array) {
  const result=new Float32Array(count*3);
  for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
   const at=index(x,y,z)*3;
   for (const d of directions) {
    const stride=d.map((n,i)=>n/cell[i]), maximum=Math.max(...stride.map(Math.abs));
    for (let i=0;i<3;i++) stride[i]/=maximum;
    let transmission=1;
    for (let step=1;step<=8;step++) {
     const p:Point=[x+.5+stride[0]*step,y+.5+stride[1]*step,z+.5+stride[2]*step];
     if (!inside(...p)) break;
     const sampled=index(...p)*3, emitted=source[sampled]+source[sampled+1]+source[sampled+2];
     const outgoing=emitted>0 ? facing(...p.map(Math.floor) as Point,d.map(n=>-n)) : 0;
     if (outgoing>0) {
      const distance=Math.hypot(...stride.map((n,i)=>n*cell[i]*step));
      for (let c=0;c<3;c++) result[at+c]+=source[sampled+c]*outgoing*transmission/(1+distance*distance*.04)/directions.length;
      break; // At most one oriented surface per ray, not energy at every step.
     }
     transmission*=1-alpha(...p); if (transmission<.005) break;
    }
   }
  }
  return result;
 }
 const seed=new Float32Array(count*3), directVisibility=new Float32Array(count);
 for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
  const at=index(x,y,z), s=surface(x,y,z); if (s.weight<=0) continue;
  for (const light of lights) {
   const point=[x,y,z].map((n,i)=>grid.min[i]+(n+.5)*cell[i]), delta=light.position.map((n,i)=>n-point[i]);
   const distance=Math.hypot(...delta), falloff=Math.max(0,1-distance/light.radius); if (!falloff) continue;
   const v=visibility(x,y,z,light), cosine=facing(x,y,z,delta.map(n=>n/Math.max(.0001,distance)));
   directVisibility[at]=Math.max(directVisibility[at],v);
   for (let c=0;c<3;c++) seed[at*3+c]+=s.colour[c]*s.weight*light.radiance[c]*falloff*falloff*v*cosine/(1+distance*distance*.1);
  }
 }
 for (let i=0;i<seed.length;i++) seed[i]=quantizeVoxelRadiance(seed[i]);
 let previous=seed; const orders:Float32Array[]=[];
 for (let step=0;step<steps;step++) {
  const incident=gather(previous), next=new Float32Array(seed.length);
  for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
   const at=index(x,y,z)*3, s=surface(x,y,z);
   for (let c=0;c<3;c++) next[at+c]=quantizeVoxelRadiance(seed[at+c]+s.colour[c]*s.weight*VOXEL_INDIRECT_GAIN*incident[at+c]);
  }
  orders.push(next); previous=next;
 }
 const irradiance=gather(previous);
 for (let i=0;i<irradiance.length;i++) irradiance[i]=quantizeVoxelRadiance(irradiance[i]);
 return {seed,orders,irradiance,directVisibility};
}
