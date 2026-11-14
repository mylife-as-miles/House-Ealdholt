/** Conservative whole-tree spatial visibility. A cell accelerates rejection;
 * every surviving actor retains its own complete canopy bounds and source ID.
 * This selects render instances only: no terrain, light, placement or LOD edits. */
export type WoodlandBounds = readonly [number,number,number,number,number,number];
export function createWoodlandSpatialIndex(input:readonly WoodlandBounds[],cellSize=32,padding=.25){
 if(!Number.isFinite(cellSize)||cellSize<=0||!Number.isFinite(padding)||padding<0||input.length>8192)throw Error('Invalid woodland spatial index budget.');
 const bounds=input.map(b=>{if(b.length!==6||!b.every(Number.isFinite)||b[0]>b[3]||b[1]>b[4]||b[2]>b[5])throw Error('Invalid complete tree bounds.');return [b[0]-padding,b[1]-padding,b[2]-padding,b[3]+padding,b[4]+padding,b[5]+padding] as WoodlandBounds;});
 const map=new Map<string,{bounds:number[];ids:number[]}>();
 bounds.forEach((b,id)=>{const key=Math.floor((b[0]+b[3])/(2*cellSize))+','+Math.floor((b[2]+b[5])/(2*cellSize));let cell=map.get(key);if(!cell){cell={bounds:[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],ids:[]};map.set(key,cell);}cell.ids.push(id);for(let axis=0;axis<3;axis++){cell.bounds[axis]=Math.min(cell.bounds[axis],b[axis]);cell.bounds[axis+3]=Math.max(cell.bounds[axis+3],b[axis+3]);}});
 const cells=[...map.values()],mask=new Uint8Array(bounds.length),ids=new Uint32Array(bounds.length),previous=new Uint32Array(bounds.length),localPlanes=[new Float64Array(24),new Float64Array(24),new Float64Array(24)];
 const result={ids,count:0,changed:true,cells:cells.length,testedCells:0,testedActors:0};let priorCount=-1;
 function intersects(b:readonly number[],planeCount:number){
  for(let f=0;f<planeCount;f++){const p=localPlanes[f];let inside=true;for(let i=0;i<24;i+=4){const x=p[i]>=0?b[3]:b[0],y=p[i+1]>=0?b[4]:b[1],z=p[i+2]>=0?b[5]:b[2];if(p[i]*x+p[i+1]*y+p[i+2]*z+p[i+3]<-1e-7){inside=false;break;}}if(inside)return true;}return false;
 }
 return{total:bounds.length,cellCount:cells.length,
  invalidate(){priorCount=-1;},
  /** Reuses result/ID storage; consume only ids[0..count). World planes are
   * transformed by M transpose, retaining nonuniform scale and XR root offsets. */
  select(worldPlanes:readonly Float64Array[],rootMatrix:readonly number[],limit=bounds.length){
   if(worldPlanes.length<1||worldPlanes.length>3||rootMatrix.length!==16||!rootMatrix.every(Number.isFinite)||!Number.isSafeInteger(limit)||limit<0||limit>bounds.length)throw Error('Invalid woodland visibility frame.');
   for(let f=0;f<worldPlanes.length;f++){const source=worldPlanes[f],target=localPlanes[f];if(source.length!==24)throw Error('Expected six frustum planes.');for(let i=0;i<24;i+=4){const x=source[i],y=source[i+1],z=source[i+2],d=source[i+3];if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||!Number.isFinite(d))throw Error('Nonfinite woodland frustum.');for(let c=0;c<4;c++)target[i+c]=rootMatrix[c*4]*x+rootMatrix[c*4+1]*y+rootMatrix[c*4+2]*z+rootMatrix[c*4+3]*d;}}
   mask.fill(0);result.testedCells=0;result.testedActors=0;
   for(const cell of cells){result.testedCells++;if(!intersects(cell.bounds,worldPlanes.length))continue;for(const id of cell.ids){if(id>=limit)continue;result.testedActors++;if(intersects(bounds[id],worldPlanes.length))mask[id]=1;}}
   let count=0;for(let id=0;id<limit;id++)if(mask[id])ids[count++]=id;
   let changed=count!==priorCount;for(let i=0;i<count;i++)if(previous[i]!==ids[i])changed=true;
   if(changed)for(let i=0;i<count;i++)previous[i]=ids[i];priorCount=count;result.count=count;result.changed=changed;return result;
  },
 };
}
