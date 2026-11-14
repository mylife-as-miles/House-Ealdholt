import{test}from'node:test';import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{alphaCoverage,buildRiparianColourMips,decodeRiparianAlpha,preserveRiparianCoverage}from'./riparian-plant-maps.mjs';
test('cutout filtering keeps the source coverage without creating opaque final cards',()=>{
 const values=Uint8Array.from([8,30,80,140,250].flatMap(a=>[100,120,140,a]));const before=values.slice();
 const result=preserveRiparianCoverage(values,.2);assert.equal(result.coverage,.2);assert.ok(values[3]<128);assert.ok(values[19]>=128);
 for(let i=0;i<values.length;i++)if(i%4!==3)assert.equal(values[i],before[i]);
 const last=Uint8Array.of(100,120,140,40);preserveRiparianCoverage(last,.1);assert.equal(last[3],0);
 assert.throws(()=>preserveRiparianCoverage(last,1));
});
test('source-weighted linear filtering excludes transparent black, leaves sources immutable and supplies every mip',()=>{
 const rgb=new Uint8Array(1024**2*3),alpha=new Uint8Array(1024**2);
 for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(x<128){const at=y*1024+x;rgb[at*3]=80;rgb[at*3+1]=160;rgb[at*3+2]=40;alpha[at]=255;}
 const sourceBefore=rgb.slice(),alphaBefore=alpha.slice(),out=buildRiparianColourMips(rgb,alpha,128);
 assert.deepEqual(rgb,sourceBefore);assert.deepEqual(alpha,alphaBefore);assert.equal(out.mips.length,8);assert.equal(out.bytes,87380);assert.equal(out.target,.125);
 assert.deepEqual(out.mips.map(m=>m.width),[128,64,32,16,8,4,2,1]);
 for(const mip of out.mips){assert.equal(mip.rgba.length,mip.width*mip.height*4);assert.equal(mip.coverage,mip.width>=8?.125:0);for(let at=0;at<mip.rgba.length;at+=4)if(mip.rgba[at+3])assert.deepEqual(Array.from(mip.rgba.subarray(at,at+3)),[80,160,40]);}
 assert.equal(alphaCoverage(out.mips.at(-1).rgba),0);
});
if(process.env.CROWNFALL_RIPARIAN_SOURCE_DIR)test('both original UINT16 alpha masks normalize exactly and filtered base coverage remains within one percent',async()=>{
 const root=process.env.CROWNFALL_RIPARIAN_SOURCE_DIR,expected={grass_medium_02:'949610b5a0bf0f8a32c562d392e8c661ed60039a5dfd28b022a4993e83598e31',shrub_03:'1b68735db60e45b38f05dc7f4930713e300859cb3b2e626458fc37c303fe20bb'};
 for(const[id,sha]of Object.entries(expected)){const bytes=await readFile(`${root}/${id}/supplemental/${id}_alpha_1k.png`),alpha=await decodeRiparianAlpha(bytes,sha),rgb=new Uint8Array(1024**2*3).fill(100);
  assert.ok(alpha.some(a=>a>0&&a<255));assert.ok(alphaCoverage(alpha,0,1)<.3);await assert.rejects(()=>decodeRiparianAlpha(bytes,'0'.repeat(64)));
  for(const size of[256,128]){const result=buildRiparianColourMips(rgb,alpha,size);assert.ok(result.mips[0].error<.01);assert.equal(result.mips.at(-1).coverage,0);for(const mip of result.mips)assert.ok(mip.error<Math.max(.01,2/(mip.width*mip.height)));}
 }
});
