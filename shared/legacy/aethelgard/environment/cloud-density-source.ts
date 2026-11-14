/** Static, periodic billows adapted from BakedVoxelLighting (MIT).
 * R is potential density; G is an independent occurrence rank. Live weather,
 * sun and advection never enter this generator or its persistent cache key.
 * Full MIT notice/provenance: BAKED_VOXEL_LIGHTING_SOURCE.md. */
export const CLOUD_DENSITY_VERSION='bvl-billows-occurrence-rg8-v3';
export const CLOUD_DENSITY_CHANNELS=2;
export const CLOUD_FIELD_LAYOUT='density-occurrence-rg8-v3';
const fract=(v:number)=>v-Math.floor(v),wrap=(v:number,p:number)=>(v%p+p)%p;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
/** Integer hashing is shared with WGSL; unlike sin hashes it has no backend
 * dependent transcendental rounding that can relocate entire cloud groups. */
function hash(x:number,y:number,z:number,seed:number){
 let h=(Math.imul(x,0x9e3779b1)^Math.imul(y,0x85ebca77)^Math.imul(z,0xc2b2ae3d)^seed)>>>0;
 h=Math.imul(h^(h>>>16),0x7feb352d)>>>0;h=Math.imul(h^(h>>>15),0x846ca68b)>>>0;
 return(h^(h>>>16))>>>0;
}
const unit=(x:number,y:number,z:number,seed:number)=>(hash(x,y,z,seed)>>>8)/16777216;
function noise(x:number,y:number,z:number,period:number){
 const cx=Math.floor(x),cy=Math.floor(y),cz=Math.floor(z),fx=fract(x),fy=fract(y),fz=fract(z);
 const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
 const h=(dx:number,dy:number,dz:number)=>unit(wrap(cx+dx,period),cy+dy,wrap(cz+dz,period),0x6d2b79f5);
 return mix(mix(mix(h(0,0,0),h(1,0,0),u),mix(h(0,1,0),h(1,1,0),u),v),mix(mix(h(0,0,1),h(1,0,1),u),mix(h(0,1,1),h(1,1,1),u),v),w);
}
const groups=new Map<number,readonly (readonly number[])[]>();
function lobes(x:number,z:number){
 const wx=wrap(x,8),wz=wrap(z,8),key=wx+wz*8,found=groups.get(key);if(found)return found;
 const h=(n:number)=>unit(wx,n,wz,0x243f6a88),cx=.1+h(0)*.8,cz=.1+h(1)*.8;
 const result:number[][]=[[cx,cz,.37+h(2)*.14,.35+h(3)*.18,.23,.21]];
 const count=3+Math.floor(h(4)*5);
 for(let l=0;l<count;l++){
  const n=8+l*6;result.push([cx+(h(n)-.5)*.6,cz+(h(n+1)-.5)*.6,.20+h(n+2)*.20,.20+h(n+3)*.20,.24+h(n+4)*.32,.15+h(n+5)*.13]);
 }
 groups.set(key,result);return result;
}
export function cloudDensity(x:number,y:number,z:number){
 if(y<=0||y>=1)return 0;
 const qx=x*8,qz=z*8,cx=Math.floor(qx),cz=Math.floor(qz);let shape=0;
 for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const l of lobes(cx+dx,cz+dz)){
  shape=Math.max(shape,Math.max(0,1-Math.hypot((qx-cx-dx-l[0])/l[2],(qz-cz-dz-l[1])/l[3],(y-l[4])/l[5])));
 }
 let value=0,amp=.55,vx=x*32,vy=y*8,vz=z*32,period=32;
 for(let octave=0;octave<3;octave++){value+=noise(vx,vy,vz,period)*amp;amp*=.5;vx*=2;vy*=2;vz*=2;period*=2;}
 return smooth(.025,.16,shape-(1-value)*.42)*smooth(.015,.13,y)*(1-smooth(.78,.98,y));
}
/** Fixed-point bilinear weather noise gives CPU/WGSL identical occurrence
 * bytes at the power-of-two production resolutions, with no extra ray taps. */
export function cloudOccurrenceByte(x:number,z:number){
 const qx=x*4,qz=z*4,cx=Math.floor(qx),cz=Math.floor(qz);
 const ease=(f:number)=>{const n=Math.round(f*256);return Math.floor((n*n*(768-2*n)+32768)/65536);};
 const sx=ease(fract(qx)),sz=ease(fract(qz));
 const h=(dx:number,dz:number)=>hash(wrap(cx+dx,4),0,wrap(cz+dz,4),0xb7e15162)>>>24;
 const lerp=(a:number,b:number,t:number)=>Math.floor((a*(256-t)+b*t+128)/256);
 return lerp(lerp(h(0,0),h(1,0),sx),lerp(h(0,1),h(1,1),sx),sz);
}
export function cloudDensityByteLength(width:number,height:number){
 if(!Number.isInteger(width)||width<16||width>128||!Number.isInteger(height)||height<8||height>48)throw Error('Cloud volume exceeds its graphics budget.');
 return width*height*width*CLOUD_DENSITY_CHANNELS;
}
/** This source is global and procedural: dimensions and generator/layout are
 * its complete static identity. Live time/sun/coverage cannot create entries. */
export function cloudDensityCacheMetadata(width:number,height:number){
 cloudDensityByteLength(width,height);
 return JSON.stringify({version:CLOUD_DENSITY_VERSION,layout:CLOUD_FIELD_LAYOUT,channels:CLOUD_DENSITY_CHANNELS,width,height});
}
/** Rank the static occurrence distribution once, so weather coverage selects
 * spatial cloud regions instead of merely making the same puffs more opaque. */
export function finalizeCloudOccurrence(data:Uint8Array,width:number,height:number){
 if(data.length!==cloudDensityByteLength(width,height))throw Error('Invalid RG8 cloud field byte count.');
 const histogram=new Uint32Array(256),rank=new Uint8Array(256),total=width*width;
 for(let z=0;z<width;z++)for(let x=0;x<width;x++)histogram[data[(z*height*width+x)*2+1]]++;
 let below=0;for(let value=0;value<256;value++){rank[value]=Math.floor(((below*2+histogram[value])*255+total)/(total*2));below+=histogram[value];}
 for(let at=1;at<data.length;at+=2)data[at]=rank[data[at]];
 return data;
}
export function validateCloudDensityVolume(data:Uint8Array,width:number,height:number){
 if(!(data instanceof Uint8Array)||data.length!==cloudDensityByteLength(width,height))return false;
 let maximum=0,low=255,high=0;
 for(let z=0;z<width;z++)for(let x=0;x<width;x++){
  const g=data[(z*height*width+x)*2+1];low=Math.min(low,g);high=Math.max(high,g);
  for(let y=0;y<height;y++){const at=((z*height+y)*width+x)*2;if(data[at+1]!==g)return false;maximum=Math.max(maximum,data[at]);}
 }
 return maximum>0&&low<high;
}
export function createCloudDensityVolume(width:number,height:number){
 const data=new Uint8Array(cloudDensityByteLength(width,height));
 for(let z=0;z<width;z++)for(let x=0;x<width;x++){
  const px=(x+.5)/width,pz=(z+.5)/width,g=cloudOccurrenceByte(px,pz);
  for(let y=0;y<height;y++){const at=((z*height+y)*width+x)*2;data[at]=Math.round(cloudDensity(px,(y+.5)/height,pz)*255);data[at+1]=g;}
 }
 finalizeCloudOccurrence(data,width,height);if(!validateCloudDensityVolume(data,width,height))throw Error('Generated cloud field failed source validation.');return data;
}
