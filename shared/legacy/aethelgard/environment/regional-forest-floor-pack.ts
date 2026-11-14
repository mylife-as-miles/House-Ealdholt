/** Independent from canopy placement/coverage: only the derived GPU texture
 * layout and its sampling program change with this revision. */
export const REGIONAL_FOREST_FLOOR_TEXTURE_VERSION='litter-rgb-cover-alpha-v1';
export interface RegionalForestLitterPixels {
 readonly size:number;
 readonly data:Uint8Array|Uint8ClampedArray;
 /** Effective upload flip. ImageBitmap orientation is already in its pixels;
  * WebGL ignores UNPACK_FLIP_Y for those sources. */
 readonly flipY:boolean;
}

/** Preserve encoded sRGB RGB bytes and linear cover bytes independently.
 * Opaque source RGB is required: canvas premultiplication must not erase hidden
 * source colours. Inputs remain borrowed; the returned RGBA buffer is owned. */
export function packRegionalForestFloor(litter:RegionalForestLitterPixels,cover:Uint8Array,size:number):Uint8Array{
 if(!Number.isInteger(size)||size<2||size>1024||(size&(size-1))!==0||litter.size!==size
   ||!(litter.data instanceof Uint8Array||litter.data instanceof Uint8ClampedArray)||litter.data.length!==size*size*4
   ||!(cover instanceof Uint8Array)||cover.length!==size*size||typeof litter.flipY!=='boolean')throw Error('Incompatible forest-floor texture sources.');
 const result=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const from=((litter.flipY?size-1-y:y)*size+x)*4,to=(y*size+x)*4;
  if(litter.data[from+3]!==255)throw Error('Forest litter requires opaque source RGB for lossless packing.');
  result[to]=litter.data[from];result[to+1]=litter.data[from+1];result[to+2]=litter.data[from+2];result[to+3]=cover[y*size+x];
 }
 return result;
}
