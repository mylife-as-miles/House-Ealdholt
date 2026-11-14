import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {GENERATED_FOLIAGE_MAPS,buildGeneratedFoliageNormals,canonicalGeneratedFoliageRgba,generatedFoliageNormalBudget,generatedFoliageNormalBytes,generatedFoliageNormalSize,regionalBaseBudgetWithFoliageNormals,prepareGeneratedFoliageNormals} from './generated-foliage-normal';
function source(n=8){const rgba=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const at=(y*n+x)*4;rgba[at]=rgba[at+1]=rgba[at+2]=x*30;rgba[at+3]=255;}return rgba;}
test('source UV gradients retain sign, leaf-space alignment and normalized mips, without changing colour/cutout bytes',()=>{
 const rgba=source(),before=rgba.slice(),chain=buildGeneratedFoliageNormals({rgba,width:8,height:8,size:8}),at=(3*8+3)*4;
 assert.ok(chain.mips[0].rgba[at]<128);assert.equal(chain.mips[0].rgba[at+1],128);assert.deepEqual(rgba,before);
 const vertical=new Uint8Array(rgba.length);for(let y=0;y<8;y++)for(let x=0;x<8;x++)vertical.set(rgba.subarray((x*8+y)*4,(x*8+y)*4+4),(y*8+x)*4);
 const turned=buildGeneratedFoliageNormals({rgba:vertical,width:8,height:8,size:8});assert.equal(turned.mips[0].rgba[at],128);assert.equal(turned.mips[0].rgba[at+1],chain.mips[0].rgba[at]);
 assert.deepEqual(chain.mips.map(m=>[m.width,m.height]),[[8,8],[4,4],[2,2],[1,1]]);
 for(const mip of chain.mips)for(let i=0;i<mip.rgba.length;i+=4)assert.ok(Math.abs(Math.hypot(...[0,1,2].map(k=>mip.rgba[i+k]/127.5-1))-1)<.014);
 assert.equal(chain.bytes,generatedFoliageNormalBytes(8));
});
test('hidden transparent RGB never creates raised leaf edges and alpha weights mip normals rather than darkening them',()=>{
 const a=source(),b=a.slice();for(let y=0;y<8;y++)for(let x=0;x<8;x++)if((x+y)%2){const at=(y*8+x)*4;a[at+3]=b[at+3]=0;b[at]=255;b[at+1]=13;b[at+2]=99;}
 const ca=buildGeneratedFoliageNormals({rgba:a,width:8,height:8,size:4}),cb=buildGeneratedFoliageNormals({rgba:b,width:8,height:8,size:4});assert.deepEqual(ca,cb);
 assert.equal(ca.mips[0].rgba[3],128);assert.ok(ca.mips.every(m=>m.rgba[2]>128));
});
test('canonical visible source identity survives RGBA8 bitmap premultiply/unpremultiply round trips and rejects malformed input',()=>{
 const rgba=new Uint8Array(256*256*4);for(let a=0;a<256;a++)for(let r=0;r<256;r++){const at=(a*256+r)*4;rgba[at]=r;rgba[at+1]=255-r;rgba[at+2]=r;rgba[at+3]=a;}
 const canonical=canonicalGeneratedFoliageRgba(rgba),decoded=canonical.slice();for(let at=0;at<decoded.length;at+=4)for(let k=0;k<3;k++)decoded[at+k]=decoded[at+3]?Math.round(decoded[at+k]*255/decoded[at+3]):0;
 assert.deepEqual(canonicalGeneratedFoliageRgba(decoded),canonical);assert.throws(()=>canonicalGeneratedFoliageRgba(new Uint8Array(3)),/RGBA8/);
 assert.throws(()=>buildGeneratedFoliageNormals({rgba:source(),width:8,height:8,size:16}),/bounded/);
});
test('six CPU+GPU chain sets stay inside the carved4/1MiB budgets with no complete-source or grass increase',()=>{
 assert.equal(regionalBaseBudgetWithFoliageNormals(false,16*1024**2,8*1024**2),68*1024**2);assert.equal(regionalBaseBudgetWithFoliageNormals(true,0,4*1024**2),27*1024**2);assert.equal(regionalBaseBudgetWithFoliageNormals(true,8*1024**2,4*1024**2),19*1024**2);
 for(const native of [false,true]){const size=generatedFoliageNormalSize(native),bytes=generatedFoliageNormalBytes(size);assert.equal(bytes*6,native?524280:2097144);assert.ok(bytes*6*2<=generatedFoliageNormalBudget(native));}
});
test('all six actual existing PNGs pass the strict worker pixel gate; changed pixels or another map cannot promote',async()=>{
 for(const key of Object.keys(GENERATED_FOLIAGE_MAPS) as (keyof typeof GENERATED_FOLIAGE_MAPS)[]){
  const png=await readFile((process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR?resolve(process.env.CROWNFALL_GENERATED_FOLIAGE_SOURCE_DIR,key+'.png'):new URL('../../../../main%20game/public/assets/legacy/environment/aethelgard/regional-v1/textures/'+key+'.png',import.meta.url)));
  const {data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});const input={map:key,rgba:Uint8Array.from(data),width:info.width,height:info.height,size:128};const before=input.rgba.slice();
  const result=await prepareGeneratedFoliageNormals(input);assert.equal(result.canonicalSha256,GENERATED_FOLIAGE_MAPS[key].rgba);assert.equal(result.bytes,87380);assert.deepEqual(input.rgba,before);
  const changed=input.rgba.slice();changed[3]=changed[3]===255?254:255;await assert.rejects(prepareGeneratedFoliageNormals({...input,rgba:changed}),/pinned regional map/);
 }
});
