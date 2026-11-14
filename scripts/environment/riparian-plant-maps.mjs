// Offline source filtering. Original row/UV orientation is preserved together.
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {linearFromSrgb} from '../prepare-aethelgard-photographic-ground.mjs';
export const mapSha=data=>createHash('sha256').update(data).digest('hex');
const byte=x=>Math.max(0,Math.min(255,Math.round(x)));
const srgbFromLinear=x=>x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055;
const linear=Float64Array.from({length:256},(_,n)=>linearFromSrgb(n/255));
export async function decodeRiparianAlpha(bytes,expectedSha){
 const meta=await sharp(bytes).metadata();
 if(meta.width!==1024||meta.height!==1024||meta.space!=='grey16'||meta.depth!=='ushort'||meta.channels!==1)throw Error('Expected original single-channel16-bit plant alpha.');
 const{data,info}=await sharp(bytes).toColourspace('grey16').raw({depth:'ushort'}).toBuffer({resolveWithObject:true});
 if(info.channels!==1||info.depth!=='ushort')throw Error('Plant alpha precision was changed.');
 const alpha=Uint8Array.from({length:1024**2},(_,i)=>Math.round(data.readUInt16LE(i*2)/257));
 if(mapSha(alpha)!==expectedSha)throw Error('Original UINT16 alpha normalization mismatch.');
 return alpha;
}
export const alphaCoverage=(data,channel=3,width=4)=>{let n=0;for(let i=channel;i<data.length;i+=width)if(data[i]>=128)n++;return n/(data.length/width);};
/** Quantized threshold closest to the original cutout coverage. At subpixel
 * mip sizes fractional coverage is impossible; choose the closer transparent
 * outcome, never turn a low-coverage source into an opaque1x1 card. */
export function preserveRiparianCoverage(rgba,target){
 if(rgba.length%4||!Number.isFinite(target)||target<=0||target>=.9)throw Error('Invalid cutout coverage.');
 const histogram=new Uint32Array(256);for(let i=3;i<rgba.length;i+=4)histogram[rgba[i]]++;
 let count=0,best=256,error=target;for(let threshold=255;threshold>=1;threshold--){count+=histogram[threshold];const next=Math.abs(count/(rgba.length/4)-target);if(next<error){best=threshold;error=next;}}
 for(let i=3;i<rgba.length;i+=4)rgba[i]=best===256?0:byte(rgba[i]*128/best);
 return{coverage:alphaCoverage(rgba),threshold:best,error:Math.abs(alphaCoverage(rgba)-target)};
}
/** Each level filters the ORIGINAL source, avoiding cumulative dilation and
 * gamma errors. Colour is averaged in linear light with original alpha weights. */
export function buildRiparianColourMips(rgb,alpha,size){
 if(rgb.length!==1024**2*3||alpha.length!==1024**2||![128,256].includes(size))throw Error('Invalid canonical plant map source.');
 const target=alphaCoverage(alpha,0,1),mips=[];
 for(let n=size;n>=1;n>>=1){const data=new Uint8Array(n*n*4),step=1024/n;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){let a=0,r=0,g=0,b=0;
   for(let j=0;j<step;j++)for(let i=0;i<step;i++){const at=(y*step+j)*1024+x*step+i,w=alpha[at]/255;a+=w;r+=linear[rgb[at*3]]*w;g+=linear[rgb[at*3+1]]*w;b+=linear[rgb[at*3+2]]*w;}
   const at=(y*n+x)*4;data[at]=a?byte(srgbFromLinear(r/a)*255):0;data[at+1]=a?byte(srgbFromLinear(g/a)*255):0;data[at+2]=a?byte(srgbFromLinear(b/a)*255):0;data[at+3]=byte(a/(step*step)*255);
  }
  const coverage=preserveRiparianCoverage(data,target);mips.push({width:n,height:n,rgba:data,...coverage,sha256:mapSha(data)});
 }
 return{target,mips,bytes:mips.reduce((n,m)=>n+m.rgba.byteLength,0)};
}
