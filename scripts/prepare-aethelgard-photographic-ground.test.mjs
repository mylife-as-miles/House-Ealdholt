import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { decodePhotographicSource, linearFromSrgb, meanLinearLuminance, packPhotographicOrm, reducePhotographicMap, verifyPolyHavenSource } from './prepare-aethelgard-photographic-ground.mjs';

function png16() {
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(name,bytes)=>{const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(name,4);bytes.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1024);header.writeUInt32BE(1024,4);header[8]=16;header[9]=2;
  const rows=Buffer.alloc(1024*(1+1024*6));
  for(let y=0;y<1024;y++)for(let x=0;x<1024;x++){const i=y*(1+1024*6)+1+x*6;rows.writeUInt16BE(32768,i);rows.writeUInt16BE(16384,i+2);rows.writeUInt16BE(65535,i+4);}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

test('16bit photographic PNG samples retain their full range before downsampling',async()=>{
  const source=await decodePhotographicSource(png16());assert.equal(source.size,1024);
  assert.ok(Math.abs(source.values[0]-32768/65535)<1e-7);assert.ok(Math.abs(source.values[1]-16384/65535)<1e-7);assert.equal(source.values[2],1);
});

test('photographic reduction averages albedo in linear light, normalizes normals and packs actual ORM semantics',()=>{
  const source={size:2,values:Float32Array.from([0,0,0,1,1,1,0,0,0,1,1,1])};
  const image=reducePhotographicMap(source,1,'albedo');assert.ok(image[0]>=187&&image[0]<=188);assert.ok(meanLinearLuminance(image)>.49);
  const normal=reducePhotographicMap({size:2,values:Float32Array.from([.5,.5,1,.6,.5,.99,.5,.6,.99,.5,.5,1])},1,'normal');
  const length=Math.hypot(...Array.from(normal.subarray(0,3),v=>v/255*2-1));assert.ok(Math.abs(length-1)<.01);
  assert.deepEqual(packPhotographicOrm(Uint8Array.from([100,100,100,255]),Uint8Array.from([220,220,220,255])),Uint8Array.from([100,220,0,255]));
  assert.throws(()=>verifyPolyHavenSource(Buffer.from('wrong'),{url:'https://example.invalid/file.png',size:5,md5:'invalid'},'rock_surface'),/mismatch/);
});

test('canonical photographic files match their provenance hashes, dimensions, means and data ranges',async()=>{
  const root=new URL('../main game/public/assets/legacy/environment/aethelgard/textures/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  for(const set of Object.values(manifest.sets))for(const entry of Object.values(set.profiles))for(const [kind,file]of Object.entries(entry.files)){
    const bytes=await readFile(new URL(file.file,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,file.size);assert.equal(info.height,file.size);
    if(kind==='albedo'){let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*linearFromSrgb(data[i]/255)+.7152*linearFromSrgb(data[i+1]/255)+.0722*linearFromSrgb(data[i+2]/255);assert.ok(Math.abs(sum/(info.width*info.height)-entry.meanLuminance)<1e-12);assert.ok(entry.meanLuminance>.01);}
    if(kind==='orm')for(let i=2;i<data.length;i+=4)assert.equal(data[i],0);
    if(kind==='normal')for(let i=0;i<data.length;i+=4){const length=Math.hypot(data[i]/255*2-1,data[i+1]/255*2-1,data[i+2]/255*2-1);assert.ok(Math.abs(length-1)<.012);}
  }
});
