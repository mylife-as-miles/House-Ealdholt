import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtPondShoreField,EALDHOLT_POND_SHORE,qualifyEaldholtPondShore,type PondShoreField,type PondShorePoint} from '../aethelgard/environment/pond-shore';

const polygon:readonly PondShorePoint[]=[[-3,-2],[-3,1],[-1,2],[2,1],[3,-1],[1,-3]];
function drawn(boundary:readonly PondShorePoint[],height=1):number[]{
  const values:number[]=[];for(let i=1;i<boundary.length-1;i++)for(const [x,z] of [boundary[0],boundary[i],boundary[i+1]])values.push(x,height,z);return values;
}
function volume():number[]{
  const vertices:number[][]=[],indices=[0,1,2,0,2,3];
  for(const [radius,y] of [[1,.1],[1.1,.08],[1.1,0]])for(const [x,z] of [[-1,-1],[-1,1],[1,1],[1,-1]])vertices.push([x*radius,y,z*radius]);
  for(let layer=0;layer<2;layer++)for(let i=0;i<4;i++){const a=layer*4+i,b=layer*4+(i+1)%4;indices.push(a,a+4,b+4,a,b+4,b);}
  indices.push(8,10,9,8,11,10);return indices.flatMap(index=>vertices[index]);
}

test('qualification conserves the actual irregular cap boundary, source triangles and polygon area',()=>{
  const input=drawn(polygon),before=[...input],outline=qualifyEaldholtPondShore(input);
  assert.deepEqual(outline.boundary,polygon);assert.deepEqual(input,before);assert.equal(outline.height,1);
  assert.equal(outline.metrics.boundaryEdges,polygon.length);assert.equal(outline.metrics.vertices,polygon.length);
  assert.equal(outline.metrics.triangles,polygon.length-2);assert.equal(outline.metrics.area,21.5);
  assert.equal(outline.metrics.projectedArea,21.5);assert.equal(outline.metrics.projectedFraction,1);assert.equal(outline.metrics.maximumDeviation,0);
  assert.deepEqual(outline.bounds,{min:[-3,-3],max:[3,2]});assert.ok(Object.isFrozen(outline.boundary));assert.ok(outline.boundary.every(Object.isFrozen));
  const reversedFaces:number[]=[];for(let offset=input.length-9;offset>=0;offset-=9)reversedFaces.push(...input.slice(offset,offset+9));
  assert.deepEqual(qualifyEaldholtPondShore(reversedFaces),outline,'draw order does not change the source outline');
});

test('a closed beveled water volume qualifies its dominant highest cap rather than its bottom or sides',()=>{
  const outline=qualifyEaldholtPondShore(new Float32Array(volume()));
  assert.equal(outline.metrics.triangles,2);assert.equal(outline.metrics.vertices,4);assert.equal(outline.metrics.area,4);
  assert.ok(outline.metrics.projectedFraction>.82&&outline.metrics.projectedFraction<.83);assert.ok(Math.abs(outline.height-.1)<1e-8);
  const scaled=qualifyEaldholtPondShore(new Float64Array(volume().map(number=>number*3)));
  assert.equal(scaled.metrics.area,36);assert.ok(Math.abs(scaled.height-.3)<1e-12);assert.ok(Math.abs(scaled.metrics.projectedFraction-outline.metrics.projectedFraction)<1e-7);
});

test('holes, competing levels, disconnected caps, warped tops and small flat patches fail closed',()=>{
  const square:readonly PondShorePoint[]=[[-2,-2],[-2,2],[2,2],[2,-2]],inner:readonly PondShorePoint[]=[[-.5,-.5],[-.5,.5],[.5,.5],[.5,-.5]],ring:number[]=[];
  for(let i=0;i<4;i++){const next=(i+1)%4;for(const [x,z] of [square[i],square[next],inner[next],square[i],inner[next],inner[i]])ring.push(x,1,z);}
  assert.throws(()=>qualifyEaldholtPondShore(ring),/hole/);
  const other=drawn(polygon.map(([x,z])=>[x+20,z] as const),2);assert.throws(()=>qualifyEaldholtPondShore([...drawn(polygon),...other]),/multiple water levels/);
  assert.throws(()=>qualifyEaldholtPondShore([...drawn(polygon),...drawn(polygon.map(([x,z])=>[x+20,z] as const))]),/disconnected/);
  const warped=drawn(square);warped[1]+=.01;assert.throws(()=>qualifyEaldholtPondShore(warped),/horizontal|nonplanar|water levels/);
  const small=volume();for(let offset=0;offset<small.length;offset+=3)if(small[offset+1]===.1){small[offset]*=.5;small[offset+2]*=.5;}
  assert.throws(()=>qualifyEaldholtPondShore(small),/not dominant/);
});

test('truncated, nonfinite, degenerate and nonmanifold input is rejected without mutating caller data',()=>{
  const input=drawn(polygon);assert.throws(()=>qualifyEaldholtPondShore(input.slice(1)),/complete/);
  for(const value of [NaN,Infinity,-Infinity]){const corrupt=[...input];corrupt[3]=value;const before=[...corrupt];assert.throws(()=>qualifyEaldholtPondShore(corrupt),/finite/);assert.deepEqual(corrupt,before);}
  assert.throws(()=>qualifyEaldholtPondShore([0,0,0,1,0,0,2,0,0]),/degenerate/);
  assert.throws(()=>qualifyEaldholtPondShore([...input,...input.slice(0,9)]),/nonmanifold|boundary/);
});

test('the deterministic RGBA8 field has explicit linear channels and a complete bounded mip chain',()=>{
  const outline=qualifyEaldholtPondShore(drawn(polygon)),field=createEaldholtPondShoreField(outline),again=createEaldholtPondShoreField(outline);
  assert.deepEqual(field.data,again.data);assert.equal(field.width,128);assert.equal(field.height,128);assert.equal(field.waterHeight,1);
  assert.equal(field.baseByteLength,65536);assert.equal(field.byteLength,87380);assert.ok(field.byteLength<=96*1024);
  assert.equal(field.byteLength,field.mipmaps.reduce((sum,mip)=>sum+mip.data.byteLength,0));assert.equal(field.data,field.mipmaps[0].data);
  assert.deepEqual(field.mipmaps.map(mip=>[mip.width,mip.height]),[128,64,32,16,8,4,2,1].map(size=>[size,size]));
  assert.equal(field.normalization,255);assert.deepEqual(field.channels,{r:'outside-damp',g:'inside-shallow',b:'outside-groundcover-break',a:'treatment-support'});
  assert.equal(field.bounds.min[0],outline.bounds.min[0]-.65);assert.equal(field.bounds.max[1],outline.bounds.max[1]+.65);
  const first=field.mipmaps[1].data;
  for(let channel=0;channel<4;channel++)assert.equal(first[channel],Math.round((field.data[channel]+field.data[channel+4]+field.data[channel+128*4]+field.data[channel+128*4+4])/4));
});

test('masks respect polygon distance, break the damp band and keep cover breaks narrow and selective',()=>{
  const square:readonly PondShorePoint[]=[[-4,-4],[-4,4],[4,4],[4,-4]],field=createEaldholtPondShoreField(qualifyEaldholtPondShore(drawn(square)));
  let damp=0,shallow=0,cover=0,brokenNearEdge=0,strongCover=0;
  for(let row=0;row<128;row++)for(let column=0;column<128;column++){
    const x=field.bounds.min[0]+(column+.5)/128*(field.bounds.max[0]-field.bounds.min[0]);
    const z=field.bounds.min[1]+(row+.5)/128*(field.bounds.max[1]-field.bounds.min[1]);
    const outside=Math.hypot(Math.max(0,Math.abs(x)-4),Math.max(0,Math.abs(z)-4)),inside=Math.min(4-Math.abs(x),4-Math.abs(z));
    const offset=(row*128+column)*4,[r,g,b,a]=field.data.slice(offset,offset+4);
    assert.equal(a,Math.max(r,g,b));if(r)damp++;if(g)shallow++;if(b)cover++;if(b>160)strongCover++;
    if(inside>0){assert.equal(r,0);assert.equal(b,0);if(inside>=1.2)assert.equal(a,0);}
    if(outside>0){assert.equal(g,0);if(outside>=.65)assert.equal(a,0);if(outside>=.2)assert.equal(b,0);if(outside<.1&&r===0)brokenNearEdge++;}
  }
  assert.ok(damp>0&&shallow>0&&cover>0);assert.ok(cover<damp/2);assert.ok(strongCover>0);assert.ok(brokenNearEdge>0,'the outside band contains actual untreated gaps');
  assert.equal(EALDHOLT_POND_SHORE.outsideMetres,.65);assert.equal(EALDHOLT_POND_SHORE.insideMetres,1.2);
});

test('translation preserves the field and source scale changes conserve outline area with metre-sized bands',()=>{
  const source=drawn(polygon),base=qualifyEaldholtPondShore(source),field=createEaldholtPondShoreField(base);
  const translated=source.map((value,index)=>value+[1000000,5,-2000000][index%3]);
  const moved=qualifyEaldholtPondShore(translated),movedField=createEaldholtPondShoreField(moved);
  assert.equal(moved.metrics.area,base.metrics.area);assert.equal(moved.height,base.height+5);
  assert.deepEqual(moved.boundary.map(([x,z])=>[x-1000000,z+2000000]),base.boundary);
  assert.ok(field.data.every((value,index)=>Math.abs(value-movedField.data[index])<=1),'only byte rounding may differ after large-coordinate translation');
  const scaled=qualifyEaldholtPondShore(source.map(value=>value*2)),scaledField=createEaldholtPondShoreField(scaled);
  assert.equal(scaled.metrics.area,base.metrics.area*4);assert.equal(scaled.height,2);assert.equal(scaledField.byteLength,field.byteLength);
  assert.deepEqual(scaled.boundary,base.boundary.map(([x,z])=>[x*2,z*2]));
  assert.equal(scaledField.bounds.min[0],scaled.bounds.min[0]-.65,'authored widths remain metres rather than growing with pond scale');
});

test('field creation rejects changed bounds or nonfinite levels and leaves a qualified outline unchanged',()=>{
  const outline=qualifyEaldholtPondShore(drawn(polygon)),before=JSON.stringify(outline);
  assert.throws(()=>createEaldholtPondShoreField({...outline,height:NaN}),/height.*finite/);
  assert.throws(()=>createEaldholtPondShoreField({...outline,bounds:{min:[-99,-99],max:[99,99]}}),/bounds/);
  createEaldholtPondShoreField(outline);assert.equal(JSON.stringify(outline),before);
});

function terrainPlane(height:(x:number,z:number)=>number):number[]{
  return drawn([[-6,-6],[-6,6],[6,6],[6,-6]]).map((value,index,array)=>index%3===1?height(array[index-1],array[index+1]):value);
}
function maskAt(field:PondShoreField,x:number,z:number,channel:number):number{
  const column=Math.floor((x-field.bounds.min[0])/(field.bounds.max[0]-field.bounds.min[0])*field.width);
  const row=Math.floor((z-field.bounds.min[1])/(field.bounds.max[1]-field.bounds.min[1])*field.height);
  if(column<0||column>=field.width||row<0||row>=field.height)return 0;return field.data[(row*field.width+column)*4+channel];
}

test('actual sloping bank contact inside the cap receives damp ground and shallow water without moving the cap',()=>{
  const outline=qualifyEaldholtPondShore(drawn([[-4,-4],[-4,4],[4,4],[4,-4]])),before=JSON.stringify(outline);
  const terrain=terrainPlane(x=>1+x*.1),original=[...terrain],old=createEaldholtPondShoreField(outline),field=createEaldholtPondShoreField(outline,terrain);
  assert.equal(old.contact.mode,'cap-outline');assert.equal(field.contact.mode,'terrain-contact');assert.equal(field.contact.terrainTriangles,2);
  assert.ok(Math.abs(field.contact.terrainContactLength-8)<1e-7);assert.ok(Math.abs(field.contact.length-24)<1e-7);
  assert.ok(field.contact.capEdgeSegments>0,'cap edges are retained only where terrain lies below water');
  assert.equal(maskAt(old,.15,0,0),0);assert.ok(maskAt(field,.15,0,0)>0,'actual dry bank15cm from contact is treated even far inside the geometric cap');
  assert.equal(maskAt(field,.15,0,1),0);assert.ok(maskAt(field,-.15,0,1)>0,'only the visible water side receives shallow colour');
  assert.equal(maskAt(field,4,0,0),0,'buried cap edges do not create a second shoreline');assert.equal(maskAt(field,-2,0,0),0);
  assert.equal(field.byteLength,87380);assert.equal(field.mipmaps.length,8);assert.deepEqual(terrain,original);assert.equal(JSON.stringify(outline),before);
});

test('higher and coplanar terrain hide lower contacts, while entirely submerged ground creates no cover breaks',()=>{
  const outline=qualifyEaldholtPondShore(drawn([[-4,-4],[-4,4],[4,4],[4,-4]])),slope=terrainPlane(x=>1+x*.1);
  for(const upper of [terrainPlane(()=>3),terrainPlane(()=>1)]){
    const field=createEaldholtPondShoreField(outline,[...slope,...upper]);assert.equal(field.contact.segments,0);
    assert.ok(field.data.every(value=>value===0),'hidden or coplanar drawn terrain does not invent visible water');
  }
  const submerged=createEaldholtPondShoreField(outline,terrainPlane(()=>.9));
  assert.equal(submerged.contact.terrainContactSegments,0);assert.ok(Math.abs(submerged.contact.length-32)<1e-7);
  assert.ok(submerged.data.some((value,index)=>index%4===0&&value>0));assert.ok(submerged.data.every((value,index)=>index%4!==2||value===0));
});

test('actual-contact masks retain finite support, deterministic mips and translation invariance',()=>{
  const cap=drawn([[-4,-4],[-4,4],[4,4],[4,-4]]),terrain=terrainPlane(x=>1+x*.1),field=createEaldholtPondShoreField(qualifyEaldholtPondShore(cap),terrain);
  const translated=(values:number[])=>values.map((value,index)=>value+[1000000,5,-2000000][index%3]);
  const moved=createEaldholtPondShoreField(qualifyEaldholtPondShore(translated(cap)),translated(terrain));
  assert.ok(field.data.every((value,index)=>Math.abs(value-moved.data[index])<=1));
  assert.deepEqual(field.mipmaps.map(mip=>mip.data),createEaldholtPondShoreField(qualifyEaldholtPondShore(cap),terrain).mipmaps.map(mip=>mip.data));
  for(let z=-3;z<=3;z+=.2){assert.equal(maskAt(field,.75,z,0),0);assert.equal(maskAt(field,.3,z,2),0);assert.equal(maskAt(field,-1.5,z,1),0);}
  assert.ok(field.data.some((value,index)=>index%4===2&&value>0),'narrow selective cover breaks use actual bank contact');
});

test('terrain draw failures preserve both source inputs and the strict inherited cap rules',()=>{
  const cap=drawn(polygon),outline=qualifyEaldholtPondShore(cap),before=[...cap],terrain=terrainPlane(x=>1+x*.1);
  assert.throws(()=>createEaldholtPondShoreField(outline,terrain.slice(1)),/complete terrain/);
  const invalid=[...terrain];invalid[4]=Infinity;const original=[...invalid];assert.throws(()=>createEaldholtPondShoreField(outline,invalid),/finite/);assert.deepEqual(invalid,original);
  assert.throws(()=>createEaldholtPondShoreField(outline,[0,1,0,1,1,0,2,1,0]),/degenerate/);
  const warped=[...cap];warped[1]+=.004;assert.throws(()=>qualifyEaldholtPondShore(warped),/horizontal|nonplanar|water levels/);assert.deepEqual(cap,before);
});
