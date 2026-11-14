/** RGB normal restoration for Crownfall's existing BakedVoxelLighting sprays.
 * Adapts normal-map.js/native-kernels.js at22f3dc4 (SamG-Coder, MIT). This is
 * approximate surface detail, never a measured height/AO/thickness texture. */
import {worldBakeDigest} from './world-bake-cache';

export const GENERATED_FOLIAGE_NORMAL_VERSION = 'bvl-regional-normal-rgb-linear-alpha-v1';
export const GENERATED_FOLIAGE_NORMAL_STRENGTH = 3;
export const GENERATED_FOLIAGE_NORMAL_SCALE = .25;
/** Encoded PNG and canonical premultiplied-sRGB RGBA8 hashes. Canonicalizing
 * premultiplication permits the existing bitmap->canvas straight-byte reader
 * without accepting a different visible source image or changing cutout alpha. */
export const GENERATED_FOLIAGE_MAPS = {
  oak: {png:'e5bc028617c40ed9f59230c2c532e58e34eba22267177889e95738e0e471bb51',rgba:'4f82183474f6c28103303389ef572931f917c0cb8eb42d27d88fdceb3eefbdeb'},
  birch: {png:'cf8a946858b62aa353ee45e2a23c65a4d56c6a54729e7f5e652e3015d7da2a57',rgba:'d9fed9451773f097f3ba2deaec6eca4deb7ecd5bca8eab2dfc171204fb3f9288'},
  ash: {png:'27a09e9ffca0b21c849d1898f8d2d48f3a939749f383d3aa8e255d6fdca80fb6',rgba:'2891adff4cd973c40bc02e70dc514636cb1278b7adfab598c56c67de3776b246'},
  pine: {png:'90979c7be101e9d9e8cad83899fd03e10758622dd926c83636cbc81733d91180',rgba:'7ac605406e194e705ec9e3ecc98f1a2c8e43ec1d325b0cd795e1cc297cddddc2'},
  hazel: {png:'5130e2e0ac83e1615edb53a21918ff12521cc65c8e04adcd87cc5dff3137372a',rgba:'833fb68e23e0b88b9825b5a003f791c901d1f471733c2a9ad0c07292c9b53cc3'},
  bramble: {png:'ded37a1e216af75de22fde0f97563cfc267900146cf3edc9733203bd6c206719',rgba:'38357f2e0f0f7eee6ffa27763fd3bf84b66cd8c59129145d8abc484633821797'},
} as const;
export type GeneratedFoliageMap = keyof typeof GENERATED_FOLIAGE_MAPS;
export interface GeneratedFoliageNormalMip {width:number;height:number;rgba:Uint8Array}
export interface GeneratedFoliageNormalChain {mips:GeneratedFoliageNormalMip[];bytes:number}
export interface GeneratedFoliageNormalInput {rgba:Uint8Array;width:number;height:number;size:number}
export function generatedFoliageNormalSize(native=false):128|256 {return native?128:256;}
/** Charge both retained typed arrays and estimated GPU copies, not just GPU.
 * Borrowed source image residency remains separately owned by its asset loader. */
export function generatedFoliageNormalBudget(native=false):number {return (native?1:4)*1024**2;}
/** Actual complete-source availability controls its carve. Native's absent
 * complete source must not be represented as an allocated8MiB tree pool. */
export function regionalBaseBudgetWithFoliageNormals(native:boolean,completeSourceBytes:number,scannedBytes:number,naturalRiparianBytes=0):number {
  if(![0,(native?8:16)*1024**2].includes(completeSourceBytes)||![0,(native?4:8)*1024**2].includes(scannedBytes)||![0,(native?2:6)*1024**2].includes(naturalRiparianBytes))throw Error('Invalid regional source memory carve.');
  return (native?32:96)*1024**2-completeSourceBytes-scannedBytes-generatedFoliageNormalBudget(native)-naturalRiparianBytes;
}
export function generatedFoliageNormalBytes(size:number):number {
  if(!Number.isInteger(size)||size<1||size>512||(size&(size-1)))throw Error('Invalid foliage normal mip size.');
  let bytes=0;for(let n=size;;n>>=1){bytes+=n*n*4;if(n===1)return bytes;}
}
export function generatedFoliageMapForPrototype(id:string):GeneratedFoliageMap|null {
  const match=/^tree-(oak|birch|ash|pine)-[012]$/.exec(id);
  return match?match[1] as GeneratedFoliageMap:id==='hazel'?'hazel':id==='bramble'?'bramble':id==='elder'?'ash':null;
}
export function canonicalGeneratedFoliageRgba(rgba:Uint8Array):Uint8Array {
  if(!(rgba instanceof Uint8Array)||rgba.length%4)throw Error('Invalid foliage RGBA8 source.');
  const result=Uint8Array.from(rgba);
  for(let at=0;at<result.length;at+=4)for(let k=0;k<3;k++)result[at+k]=Math.round(result[at+k]*result[at+3]/255);
  return result;
}
const linear=Float64Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
function setNormal(out:Uint8Array,at:number,x:number,y:number,z:number,alpha:number){
  const inverse=1/(Math.hypot(x,y,z)||1);
  out[at]=Math.round((x*inverse*.5+.5)*255);out[at+1]=Math.round((y*inverse*.5+.5)*255);out[at+2]=Math.round((z*inverse*.5+.5)*255);out[at+3]=Math.round(alpha);
}
/** Derive at the original texel spacing, then filter represented normals into
 * the bounded output. Source sampling is periodic, matching the current maps.
 * Positive image-row direction is positive source UV.y (actual glTF flipY=false).
 * Alpha only weights height/filtering; colour/cutout bytes are never changed. */
export function buildGeneratedFoliageNormals(input:GeneratedFoliageNormalInput):GeneratedFoliageNormalChain {
  const {rgba,width,height,size}=input;
  if(!(rgba instanceof Uint8Array)||!Number.isInteger(width)||width!==height||width<2||width>512||(width&(width-1))||rgba.length!==width*height*4||!Number.isInteger(size)||size<1||size>width||(size&(size-1)))throw Error('Invalid bounded foliage normal source.');
  const out=new Uint8Array(size*size*4),step=width/size;
  const alpha=(x:number,y:number)=>rgba[((y+height)%height*width+(x+width)%width)*4+3]/255;
  const h=(x:number,y:number)=>{const at=((y+height)%height*width+(x+width)%width)*4;return (linear[rgba[at]]*.299+linear[rgba[at+1]]*.587+linear[rgba[at+2]]*.114)*rgba[at+3]/255;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let nx=0,ny=0,nz=0,a=0;
    for(let j=0;j<step;j++)for(let i=0;i<step;i++){
      const sx=x*step+i,sy=y*step+j,weight=alpha(sx,sy);if(!weight)continue;
      const dx=-(h(sx+1,sy)-h(sx-1,sy))*GENERATED_FOLIAGE_NORMAL_STRENGTH,dy=-(h(sx,sy+1)-h(sx,sy-1))*GENERATED_FOLIAGE_NORMAL_STRENGTH,inverse=1/Math.hypot(dx,dy,1);
      nx+=dx*inverse*weight;ny+=dy*inverse*weight;nz+=inverse*weight;a+=weight;
    }
    setNormal(out,(y*size+x)*4,nx,ny,a?nz:1,a/(step*step)*255);
  }
  const mips:GeneratedFoliageNormalMip[]=[{width:size,height:size,rgba:out}];
  for(let n=size;n>1;n>>=1){
    const prior=mips[mips.length-1].rgba,next=n>>1,data=new Uint8Array(next*next*4);
    for(let y=0;y<next;y++)for(let x=0;x<next;x++){
      let nx=0,ny=0,nz=0,alpha=0;
      for(let j=0;j<2;j++)for(let i=0;i<2;i++){
        const at=((y*2+j)*n+x*2+i)*4,a=prior[at+3]/255;
        nx+=(prior[at]/127.5-1)*a;ny+=(prior[at+1]/127.5-1)*a;nz+=(prior[at+2]/127.5-1)*a;alpha+=a;
      }
      setNormal(data,(y*next+x)*4,nx,ny,alpha?nz:1,alpha*255/4);
    }
    mips.push({width:next,height:next,rgba:data});
  }
  return{mips,bytes:mips.reduce((sum,mip)=>sum+mip.rgba.byteLength,0)};
}
export type QualifiedGeneratedFoliageNormalInput=GeneratedFoliageNormalInput&{map:GeneratedFoliageMap};
/** Worker boundary validates actual canonical visible pixels, not a filename.
 * An unsupported decode/premultiplication result deliberately keeps fallback. */
export async function prepareGeneratedFoliageNormals(input:QualifiedGeneratedFoliageNormalInput){
  if(!Object.prototype.hasOwnProperty.call(GENERATED_FOLIAGE_MAPS,input.map)||input.width!==512||input.height!==512||![128,256].includes(input.size)||input.rgba.length!==512*512*4)throw Error('Unqualified generated foliage normal map.');
  const canonicalSha256=await worldBakeDigest(canonicalGeneratedFoliageRgba(input.rgba));
  if(canonicalSha256!==GENERATED_FOLIAGE_MAPS[input.map].rgba)throw Error('Generated foliage source pixels do not match the pinned regional map.');
  const sourcePixelSha256=await worldBakeDigest(input.rgba),chain=buildGeneratedFoliageNormals(input);
  return{...chain,canonicalSha256,sourcePixelSha256};
}
