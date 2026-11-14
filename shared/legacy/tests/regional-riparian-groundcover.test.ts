import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEaldholtFarGeography,sampleEaldholtFarGeography} from '../aethelgard/environment/far-surround';
import {createEaldholtWoodlandSupportIndex} from '../aethelgard/environment/far-woodland';
import {redistributeRiparianGroundcover,regionalRiverBank,regionalShoreClearance,type RegionalRiparianDiagnostics} from '../aethelgard/environment/regional-riparian-groundcover';
import {createRegionalWorldLayout,regionalVillageEdgeDistance} from '../aethelgard/environment/regional-world-layout';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from '../aethelgard/environment/regional-assets';
import {REGIONAL_GROUNDCOVER_PLACEMENT_VERSION,REGIONAL_RIPARIAN_GROUNDCOVER as policy,regionalRiparianSourceScaleRange} from '../aethelgard/environment/regional-groundcover-policy';

const geography=createEaldholtFarGeography({sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,120,-50,0,150,200,0,120,200,0,150],riverFarX:30000});
const source={radius:.6,minimumHeight:.24,maximumHeight:.3,families:['S_Grass_Clumps_original']};
const original=()=>Array.from({length:512*6},(_,i)=>i%6===0?-800:i%6===2?-800:i%6===4?1:0);
const triangle={positions:Float64Array.from([-2000,2,-2000,4000,2,-2000,-2000,2,4000]),indices:Uint32Array.from([0,1,2])};
const index=createEaldholtWoodlandSupportIndex([triangle],{minX:-2000,maxX:4000,minZ:-2000,maxZ:4000});
const run=(grass:number[],extra:Partial<Parameters<typeof redistributeRiparianGroundcover>[0]>={})=>redistributeRiparianGroundcover({geography,village:geography.sourceEnvelope,grass,source,footprint:index.groundcoverFootprint,fixtures:[],...extra});

test('small grass footprints require a complete real supporting triangle, not sparse ray hits',()=>{
 const domain={minX:-20,maxX:20,minZ:-20,maxZ:20},p={positions:Float64Array.from([0,1,0,10,1,0,0,1,10]),indices:Uint32Array.from([0,1,2])},s=createEaldholtWoodlandSupportIndex([p],domain);
 assert.deepEqual(s.groundcoverFootprint(2,2,.5),{height:1,minimumHeight:1,maximumHeight:1,slope:0});
 assert.equal(s.groundcoverFootprint(.1,2,.5),null,'A root disk crossing a triangle boundary is held.');
 assert.equal(s.groundcoverFootprint(5,5,.1),null,'Support on a shared edge is not assumed continuous.');
 assert.equal(s.groundcoverFootprint(2,2,NaN),null);assert.equal(s.groundcoverFootprint(2,2,-1),null);
 const overlap={positions:Float64Array.from([1,3,1,3,3,1,1,3,3]),indices:Uint32Array.from([0,1,2])};
 assert.equal(createEaldholtWoodlandSupportIndex([p,overlap],domain).groundcoverFootprint(2,2,.5),null,'Intersecting raised terrain cannot be ignored.');
 const slope={positions:Float64Array.from([0,0,0,10,1,0,0,0,10]),indices:Uint32Array.from([0,1,2])},sample=createEaldholtWoodlandSupportIndex([slope],domain).groundcoverFootprint(2,2,.5)!;
 assert.ok(Math.abs(sample.slope-.1)<1e-10);assert.ok(Math.abs(sample.minimumHeight-.15)<1e-10);assert.ok(Math.abs(sample.maximumHeight-.25)<1e-10);
});

test('riparian patches are deterministic, bounded, rooted, wind-safe and exclude the complete source/path envelope',()=>{
 const before=original(),a=[...before],b=[...before],count=run(a);assert.ok(count>20);assert.equal(count,run(b));assert.deepEqual(a,b);assert.equal(a.length,before.length);assert.ok(count<=Math.floor(512*policy.maximumFraction));assert.deepEqual(a.slice(0,-count*6),before.slice(0,-count*6));
 const cells=new Map<string,number>();const sides=new Set<number>();let minOffset=Infinity,maxOffset=0;
 for(let i=a.length-count*6;i<a.length;i+=6){const[x,y,z,,scale]=a.slice(i,i+6),radius=source.radius*scale,wind=.11*source.maximumHeight*scale;assert.equal(sampleEaldholtFarGeography(geography,x,z).kind,'mainland');assert.ok(regionalVillageEdgeDistance(geography.sourceEnvelope,x,z)>=5+radius+wind);assert.ok(regionalShoreClearance(geography,x,z)>=radius+wind+.25);assert.ok(Math.abs(y+.004-2)<1e-10);if(scale>1){assert.ok(source.minimumHeight*scale*(1-policy.maximumBurialFraction)>=policy.minimumExposedHeightMetres);assert.ok(source.maximumHeight*scale<=policy.maximumExposedHeightMetres);}else assert.ok(scale>=.4&&scale<=.8);assert.ok(index.groundcoverFootprint(x,z,radius+.001));
  sides.add(z<120?0:1);const offset=z<120?120-z:z-150;minOffset=Math.min(minOffset,offset);maxOffset=Math.max(maxOffset,offset);const key=Math.floor(x/16)+','+Math.floor(z/16);cells.set(key,(cells.get(key)??0)+1);
  for(let j=a.length-count*6;j<i;j+=6)assert.ok(Math.hypot(x-a[j],z-a[j+2])>=.8);
 }
 assert.equal(sides.size,2);assert.ok(maxOffset-minOffset>2,'Natural patches occupy several dry offsets, not a uniform planted stripe.');assert.ok(Math.max(...cells.values())<=512);
 const stable:number[]=[];for(let at=0;at<a.length;at+=6)for(const lane of [0,2,3,5])stable.push(a[at+lane]);
 // Independently read from the frozen 60fa v2 generator using this fixture.
 assert.equal(count,96);assert.equal(createHash('sha256').update(Float32Array.from(stable)).digest('hex'),'52f5095a92b2bc0d3307bb677f37fec654c8cd005ea32f03560d67ac0365da65');
});

test('physical height uses every measured family and remains 25–45 cm after the full allowed burial',()=>{
 const variants=[source,{radius:.5,minimumHeight:.2120665,maximumHeight:.2429282,families:['S_Grass_Clumps_desktop']},{radius:.7,minimumHeight:.16,maximumHeight:.18,families:['S_Grass_Clumps_native']}];
 for(const measured of variants){
  const range=regionalRiparianSourceScaleRange(measured)!;assert.ok(range.minimum>1&&range.maximum>=range.minimum);
  const diagnostics:RegionalRiparianDiagnostics={attempted:0,accepted:0,rejected:{}},grass=original();
  const count=run(grass,{source:measured,diagnostics,footprint(_x,_z,radius){const span=radius>.65?.079:.01;return{height:2,minimumHeight:2-span/2,maximumHeight:2+span/2,slope:.01};}});assert.ok(count>20);assert.ok(diagnostics.heightQualification!.enlarged>20);
  for(let at=grass.length-count*6;at<grass.length;at+=6){const size=grass[at+4];if(size<=1){assert.ok(size>=.4&&size<=.8);continue;}
   assert.ok(measured.minimumHeight*size-.08>=.25-1e-12);assert.ok(measured.maximumHeight*size<=.45+1e-12);
   assert.ok(Math.abs(grass[at+1]+.004-1.9605)<1e-12,'The larger source remains buried at the lowest actual support, never floated.');
  }
 }
 assert.equal(regionalRiparianSourceScaleRange({...source,minimumHeight:.1,maximumHeight:.7}),null,'Incompatible family proportions cannot share a guessed scale.');
 const held=original(),diagnostics:RegionalRiparianDiagnostics={attempted:0,accepted:0,rejected:{}};
 const count=run(held,{source:{...source,minimumHeight:.1,maximumHeight:.7},diagnostics});assert.ok(count>20);
 assert.equal(diagnostics.heightQualification!.enlarged,0);assert.equal(diagnostics.heightQualification!.held['source-height-envelope'],count);
 for(let at=held.length-count*6;at<held.length;at+=6)assert.ok(held[at+4]>=.4&&held[at+4]<=.8,'Incompatible tall envelopes retain their qualified original small plants.');
});

test('readable-height grass must requalify its larger full footprint rather than reuse the old small support',()=>{
 let largeProbes=0;const grass=original(),diagnostics:RegionalRiparianDiagnostics={attempted:0,accepted:0,rejected:{}};
 const count=run(grass,{diagnostics,footprint(_x,_z,radius){if(radius>.8)largeProbes++;return radius<.5?{height:2,minimumHeight:2,maximumHeight:2,slope:0}:null;}});
 assert.ok(largeProbes>0);assert.ok(count>20);assert.equal(diagnostics.heightQualification!.enlarged,0);
 for(let at=grass.length-count*6;at<grass.length;at+=6)assert.ok(grass[at+4]>=.4&&grass[at+4]<=.8,'Small-only ledges retain original safe grass without a larger unsupported plant.');
 assert.equal(createHash('sha256').update(Float32Array.from(grass)).digest('hex'),'a4a9619c85b616761ed392021805ee648867584114a99ae5d5977e9294eb3a83','Every original lane remains unchanged when all larger footprints are held.');
});

test('missing sources, unsupported/steep/submerged ground, excessive burial and protected fixtures hold planting',()=>{
 for(const extra of [{source:undefined},{source:{...source,radius:NaN}},{footprint:()=>null},{footprint:()=>({height:2,minimumHeight:2,maximumHeight:2,slope:.53})},{footprint:()=>({height:0,minimumHeight:0,maximumHeight:0,slope:0})},{footprint:()=>({height:2,minimumHeight:1,maximumHeight:3,slope:.1})},{village:{minX:-2000,maxX:4000,minZ:-2000,maxZ:4000}},{fixtures:[{x:300,z:135,radius:2000}]}]){const grass=original(),before=[...grass];assert.equal(run(grass,extra),0);assert.deepEqual(grass,before);}
 const fixtures=[{x:300,z:116,radius:20},{x:400,z:155,radius:20}],grass=original(),count=run(grass,{fixtures});assert.ok(count>0);for(let i=grass.length-count*6;i<grass.length;i+=6)for(const p of fixtures)assert.ok(Math.hypot(grass[i]-p.x,grass[i+2]-p.z)>=p.radius+source.radius*grass[i+4]+.11*source.maximumHeight*grass[i+4]+.1);
});

test('redistribution cannot exceed the original maximum grass density per streaming cell',()=>{
 const grass=Array.from({length:512*6},(_,i)=>i%6===0?-8000-Math.floor(i/6)*20:i%6===2?-8000:i%6===4?1:0),count=run(grass),cells=new Set<string>();assert.ok(count>0);
 for(let i=grass.length-count*6;i<grass.length;i+=6){const key=Math.floor(grass[i]/16)+','+Math.floor(grass[i+2]/16);assert.ok(!cells.has(key));cells.add(key);}
});

test('existing flat bank shoulders can qualify when the inner cut bank has no full support',()=>{
 const rect=(low:number,high:number)=>({positions:Float64Array.from([-100,2,low,800,2,low,-100,2,high,800,2,high]),indices:Uint32Array.from([0,2,1,1,2,3])});
 const shoulder=createEaldholtWoodlandSupportIndex([rect(95,112),rect(158,177)],{minX:-100,maxX:800,minZ:95,maxZ:177}),grass=original(),diagnostics={attempted:0,accepted:0,rejected:{} as Record<string,number>};
 const count=run(grass,{footprint:shoulder.groundcoverFootprint,diagnostics});assert.ok(count>20,'Qualified dry shoulders should not depend on unsupported inner-bank probes.');
 for(let i=grass.length-count*6;i<grass.length;i+=6){const[x,y,z,,scale]=grass.slice(i,i+6);assert.ok(z<112||z>158);assert.ok(shoulder.groundcoverFootprint(x,z,source.radius*scale+.001));assert.ok(regionalShoreClearance(geography,x,z)>8);assert.ok(Math.abs(y+.004-2)<1e-10);}
 assert.equal(diagnostics.accepted,count);assert.equal(Object.values(diagnostics.rejected).reduce((n,v)=>n+v,0)+count,diagnostics.attempted);assert.ok(diagnostics.rejected['unsupported-or-overlapping-footprint']>0);
 const second=original(),again={attempted:0,accepted:0,rejected:{} as Record<string,number>};assert.equal(run(second,{footprint:shoulder.groundcoverFootprint,diagnostics:again}),count);assert.deepEqual(second,grass);assert.deepEqual(again,diagnostics);
});

test('hydro clearance follows sloping bank segments and terminal continuation',()=>{
 const g={...geography,channelSamples:Float32Array.from([0,120,150,0,100,220,250,1])};
 assert.deepEqual(regionalRiverBank(g,50,0),{z:170,water:.5,slope:1});assert.deepEqual(regionalRiverBank(g,200,1),{z:250,water:1,slope:0});
 assert.ok(Math.abs(regionalShoreClearance(g,50,168)-Math.SQRT2)<1e-10);assert.equal(regionalShoreClearance(g,50,180),0);assert.equal(regionalShoreClearance(g,200,219),1);
});

test('grass identity changes independently; tree/shrub/rock and source/nav data remain identical',()=>{
 const land=[triangle],before=land.map(p=>({positions:p.positions.slice(),indices:p.indices.slice()})),input={geography,land,prototypes,maximumTrees:2000},a=createRegionalWorldLayout(input),b=createRegionalWorldLayout({...input,groundcoverSource:source});
 assert.ok(b.groundcoverRiparian!>0);assert.equal(b.version,a.version);assert.equal(b.groundcoverVersion,REGIONAL_GROUNDCOVER_PLACEMENT_VERSION);assert.deepEqual(b.placements,a.placements);assert.deepEqual(b.rocks,a.rocks);assert.deepEqual(b.cells,a.cells);assert.deepEqual(b.landmarks,a.landmarks);assert.deepEqual(b.species,a.species);assert.equal(b.attempts,a.attempts);assert.deepEqual(b.rejected,a.rejected);assert.equal(b.groundcover!.length,a.groundcover!.length);assert.deepEqual(b.groundcover!.slice(0,-b.groundcoverRiparian!*6),a.groundcover!.slice(0,-b.groundcoverRiparian!*6));assert.deepEqual(land,before);
 const hash=(p:Float32Array)=>createHash('sha256').update(p).digest('hex');
 // Independent generator read from base 6ecf9ea, using this exact terrain.
 assert.equal(hash(a.placements),'8197a60eca321b7bb2f7581f07f12000125c0a1839d310ee5215b7581f7af4ad');
 assert.equal(hash(a.rocks),'3bf9336e4760e528d8046da962559802360269ec0c23e5a39aa46aba1efb497e');
 assert.equal(hash(a.groundcover!),'c67e9659facd23b0d896c34692816c3ed87744b7e43cbdfb07b4c0b656ac3aaf');
});
