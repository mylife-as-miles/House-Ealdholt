import{test}from'node:test';import assert from'node:assert/strict';
import{createEaldholtFarGeography}from'./far-surround';
import{naturalRiparianAsset,naturalRiparianContract,naturalRiparianReservation,naturalRiparianSource,qualifyNaturalRiparianCohort}from'./natural-riparian-policy';
import{regionalBaseBudgetWithFoliageNormals}from'./generated-foliage-normal';
import{vegetationWindBend}from'./vegetation-wind';
import{appendRegionalVoxelSource}from'./regional-voxel-source';
import{createVoxelSourceIndex,type VoxelRegionSource,type VoxelTerrainSource}from'./voxel-source-index';
import type{RegionalWorldLayout}from'./regional-world-layout';
import{REGIONAL_VEGETATION_PROTOTYPES}from'./regional-assets';
function fixture(native=false){
 const geography=createEaldholtFarGeography({sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,120,-50,0,150,200,0,120,200,0,150],riverFarX:30000});
 const grass=new Float32Array(80*6);for(let i=0;i<80;i++)grass.set([-800,1.996,-800,i/10,.5,i%3],i*6);grass.set([20,1.996,112,.2,.5,1],79*6);
 return{source:naturalRiparianSource(native),grass,riparian:1,geography,village:geography.sourceEnvelope,fixtures:[] as{x:number;z:number;radius:number}[],footprint:(_x:number,_z:number,_r:number)=>({height:2,minimumHeight:2,maximumHeight:2,slope:0})};
}
for(const native of[false,true])test((native?'Native':'Desktop')+' source-specific deterministic visual cohort retains every original grass lane and natural proportions',()=>{
 const input=fixture(native),before=input.grass.slice(),a=qualifyNaturalRiparianCohort(input),b=qualifyNaturalRiparianCohort(input);assert.deepEqual(a,b);assert.deepEqual(a.ids,Uint32Array.of(79));assert.deepEqual(a.families,Uint8Array.of(1));assert.deepEqual(input.grass,before);assert.equal(a.sourceContract,naturalRiparianContract(input.source));
 assert.ok(input.source.plants.every(p=>p.height>.3&&p.height<.41));assert.equal(naturalRiparianAsset(native).identity.dataSize,native?64:128);assert.ok(naturalRiparianAsset(native).accountedBytes<naturalRiparianReservation(native));
 const wrong=structuredClone(input.source);wrong.plants[0].height*=2;assert.throws(()=>qualifyNaturalRiparianCohort({...input,source:wrong}));
});
test('new source accounting carves the existing caps before the base pool, including absent Native complete-source availability',()=>{
 const MiB=1024**2;assert.equal(regionalBaseBudgetWithFoliageNormals(false,16*MiB,8*MiB,6*MiB),62*MiB);
 assert.equal(regionalBaseBudgetWithFoliageNormals(true,0,4*MiB,2*MiB),25*MiB);assert.equal(regionalBaseBudgetWithFoliageNormals(true,8*MiB,4*MiB,2*MiB),17*MiB);
 assert.equal(regionalBaseBudgetWithFoliageNormals(false,16*MiB,8*MiB),68*MiB);assert.throws(()=>regionalBaseBudgetWithFoliageNormals(true,0,4*MiB,6*MiB));
});
test('actual support holes, overlapping planes, steep land, floating roots, excess burial and wet soil keep the original grass',()=>{
 const input=fixture();for(const[reason,footprint]of[
  ['unsupported-or-overlapping-footprint',()=>null],['terrain-slope',()=>({height:2,minimumHeight:2,maximumHeight:2,slope:.53})],
  ['floating-contact',()=>({height:2,minimumHeight:1.99,maximumHeight:2,slope:0})],['excess-soil-burial',()=>({height:2.1,minimumHeight:2,maximumHeight:2.1,slope:0})],
 ]as const){const result=qualifyNaturalRiparianCohort({...input,footprint});assert.equal(result.ids.length,0);assert.equal(result.rejected[reason],1);}
 input.grass[79*6+1]=.096;const wet=qualifyNaturalRiparianCohort({...input,footprint:()=>({height:.1,minimumHeight:.1,maximumHeight:.1,slope:0})});assert.equal(wet.rejected['low-wet-bank'],1);
});
test('the whole source wind footprint stays out of water, fixtures and authored settlement/path envelopes',()=>{
 const input=fixture(),plant=input.source.plants[1],radius=plant.radius+plant.height*.11;
 const fixtureAt=20+plant.radius+.1+plant.height*.11*.5;assert.ok(fixtureAt-20<radius+.1&&fixtureAt-20>plant.radius+.1);
 assert.equal(qualifyNaturalRiparianCohort({...input,fixtures:[{x:fixtureAt,z:112,radius:0}]}).rejected['root-rock-landmark-or-path-envelope'],1);
 const water=fixture();water.grass[79*6+2]=119.64;assert.equal(qualifyNaturalRiparianCohort(water).rejected['water-wind-envelope'],1);
 assert.equal(qualifyNaturalRiparianCohort({...input,village:{minX:0,maxX:100,minZ:0,maxZ:130}}).rejected['authored-source-or-village-envelope'],1);
 let requested=0;qualifyNaturalRiparianCohort({...input,footprint:(x,z,r)=>{requested=r;return input.footprint(x,z,r);}});assert.equal(requested,plant.radius+.001);
});
test('qualified natural source wind bounds contain the current shared grass deformation without moving roots',()=>{
 for(const plant of naturalRiparianSource().plants)for(const root of[[0,0],[123,-321]]as const)for(let second=0;second<60;second+=.25){assert.equal(vegetationWindBend(0,plant.height,second,root,1,true),0);assert.ok(Math.abs(vegetationWindBend(plant.height,plant.height,second,root,1,true))<=plant.height*.11+1e-12);}
});
test('optional plant identities do not alter static forest/terrain transport or occupancy cache keys',()=>{
 const input=fixture(),cohort=qualifyNaturalRiparianCohort(input),old:RegionalWorldLayout={version:'unchanged-forest-version',treeCount:1,shrubCount:0,placements:Float32Array.of(10,0,10,0,1,0),rocks:Float32Array.of(25,0,25,0,1,0),groundcover:input.grass,cells:[],landmarks:[],attempts:0,rejected:{},species:[]};
 const source:VoxelRegionSource={worldRegion:'existing-region',sourceSha256:'a'.repeat(64),generatorVersion:'existing-transport',backend:'webgl2',terrain:[],proxies:[]},horizon:VoxelTerrainSource={positions:Float32Array.from([-10,0,-10,10,0,-10,-10,0,10]),indices:Uint32Array.of(0,1,2),bounds:{min:[-10,0,-10],max:[10,0,10]}};
 const before=appendRegionalVoxelSource(source,old,REGIONAL_VEGETATION_PROTOTYPES,horizon),after=appendRegionalVoxelSource(source,{...old,naturalRiparian:cohort},REGIONAL_VEGETATION_PROTOTYPES,horizon);assert.deepEqual(after,before);
 const grid={min:[0,0,0]as const,size:[64,32,64]as const,resolution:[4,4,4]as const};assert.equal(createVoxelSourceIndex(after).key(grid),createVoxelSourceIndex(before).key(grid));
});
