import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudDensity, createCloudDensityVolume, cloudCoverageDensity, CLOUD_DENSITY_VERSION, CLOUD_DENSITY_CHANNELS,
 CLOUD_FIELD_LAYOUT, cloudDensityCacheMetadata, validateCloudDensityVolume, finalizeCloudOccurrence} from '../aethelgard/environment/cloud-volume';

const width=64,height=24,data=createCloudDensityVolume(width,height);
function columns(coverage:number){
 let occupied=0,opaque=0,mean=0,maximum=0;
 for(let column=0;column<width*width;column++){
  const x=column%width,z=Math.floor(column/width);let opticalDepth=0;
  for(let y=0;y<height;y++){const at=((z*height+y)*width+x)*2;opticalDepth+=cloudCoverageDensity(data[at]/255,data[at+1]/255,coverage)*(620/height)*.009;}
  const alpha=1-Math.exp(-opticalDepth);occupied+=Number(alpha>.1);opaque+=Number(alpha>.5);mean+=alpha;maximum=Math.max(maximum,alpha);
 }
 return{coverage,occupied:occupied/(width*width),opaque:opaque/(width*width),mean:mean/(width*width),maximum};
}

test('RG8 cloud source is periodic, validated, independent of live state and bounded',()=>{
 assert.equal(data.length,width*height*width*2);assert.equal(CLOUD_DENSITY_CHANNELS,2);
 assert.deepEqual(JSON.parse(cloudDensityCacheMetadata(width,height)),{version:CLOUD_DENSITY_VERSION,layout:CLOUD_FIELD_LAYOUT,channels:2,width,height});
 assert.notEqual(cloudDensityCacheMetadata(64,24),cloudDensityCacheMetadata(32,12),'Different backend resolutions have separate compatible sources.');
 assert.match(CLOUD_DENSITY_VERSION,/rg8-v3/);assert.match(CLOUD_FIELD_LAYOUT,/density-occurrence-rg8-v3/);
 assert.equal(validateCloudDensityVolume(data,width,height),true);
 for(const x of [.1,.3,.7])for(const z of [.1,.6,.9])assert.ok(Math.abs(cloudDensity(x,.4,z)-cloudDensity(x+1,.4,z+1))<1e-6);
 assert.equal(cloudDensity(.3,0,.4),0);assert.equal(cloudDensity(.3,1,.4),0);assert.throws(()=>createCloudDensityVolume(1024,128));
 const small=createCloudDensityVolume(16,8);assert.deepEqual(createCloudDensityVolume(16,8),small,'No time, sunlight or weather inputs can relocate the source.');
 assert.equal(validateCloudDensityVolume(new Uint8Array(16*8*16),16,8),false,'Old R8 cache entries are incompatible.');
 assert.equal(validateCloudDensityVolume(new Uint8Array(small.length),16,8),false,'An empty or incomplete worker volume never replaces the valid field.');
 const corrupt=small.slice();corrupt[(16+3)*2+1]^=1;assert.equal(validateCloudDensityVolume(corrupt,16,8),false,'A weather rank changing along one vertical column is malformed.');
 assert.throws(()=>finalizeCloudOccurrence(new Uint8Array(4),16,8));
});

test('live transfer has exact coverage endpoints, preserves empty air and is monotonic at every source value',()=>{
 for(let density=0;density<=255;density++)for(let rank=0;rank<=255;rank++){
  const d=density/255,g=rank/255;assert.equal(cloudCoverageDensity(d,g,0),0,'Zero coverage removes even the densest billow.');
  let previous=0;
  for(const c of [.1,.22,.5,.78,.91,1]){const value=cloudCoverageDensity(d,g,c);assert.ok(value>=previous);previous=value;if(!density)assert.equal(value,0);}
  assert.equal(cloudCoverageDensity(d,g,1),Math.max(0,d+.24)*(density>=21?1:(()=>{const t=d/.08;return t*t*(3-2*t);})()),'Full coverage admits every occurrence rank; source-density edge smoothing remains.');
  assert.equal(cloudCoverageDensity(d,g,-1),0);assert.equal(cloudCoverageDensity(d,g,2),cloudCoverageDensity(d,g,1));
 }
});

test('actual producer columns respond to clear, partial and storm coverage through spatial occurrence',()=>{
 const audit=[0,.22,.5,.78,.91,1].map(columns);
 assert.deepEqual(audit[0],{coverage:0,occupied:0,opaque:0,mean:0,maximum:0});
 for(let i=1;i<audit.length;i++)for(const key of ['occupied','opaque','mean','maximum'] as const)assert.ok(audit[i][key]>=audit[i-1][key],`${key} is monotonic.`);
 assert.ok(audit[2].occupied-audit[1].occupied>.08,'Partial skies must occupy substantially more columns than clear skies.');
 assert.ok(audit[4].occupied-audit[2].occupied>.08,'Storm skies must occupy substantially more columns than partial skies.');
 assert.ok(audit[1].occupied>.03&&audit[4].occupied>.25,'Clear has a few clouds and storm retains a significant field.');
 // Stable evidence from the actual static producer; no scene/image or hardware claim.
 console.log('cloud-column-audit',JSON.stringify({width,height,bytes:data.byteLength,audit}));
});
