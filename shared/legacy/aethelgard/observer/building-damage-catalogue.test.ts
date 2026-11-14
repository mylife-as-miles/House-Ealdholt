import test from'node:test';
import assert from'node:assert/strict';
import{buildSourceBuildingCatalogue,buildingPartKind,type BuildingSourcePart}from'./building-damage-catalogue';
const sha='3'.repeat(64);
const part=(id:string,kind:BuildingSourcePart['kind'],min:number[],max:number[],supported=true):BuildingSourcePart=>({id,kind,bounds:{min:min as [number,number,number],max:max as [number,number,number]},supported});
function house(x=0){return[part('door-'+x,'door',[x,0,0],[x+4,2,.2]),part('back-'+x,'wall',[x,0,3],[x+4,2,3.2]),part('roof-'+x,'roof',[x-.2,2,-.2],[x+4.2,2.4,3.4])];}

test('catalogue uses actual connected source modules, stable source/profile identity and outer-site order',()=>{
 const parts=[...house(),...house(20)],a=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts}),b=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[...parts].reverse()});
 assert.equal(a.buildings.length,2);assert.deepEqual(a,b);assert.equal(a.sites.length,2);assert.equal(new Set(a.buildings.map(b=>b.binding.buildingId)).size,2);
 assert.match(a.catalogueId,/raid-building-parts-v1:desktop:/);assert.notEqual(a.catalogueId,buildSourceBuildingCatalogue({sourceSha256:sha,profile:'quest',parts}).catalogueId);
 for(const building of a.buildings){assert.equal(building.parts.length,3);assert.ok(building.binding.buildingId.startsWith('door:door-'));assert.ok(Object.isFrozen(building.bounds.min));assert.ok(Object.isFrozen(building.binding));}
});

test('unproven, oversized and doorway-only components remain whole rather than receiving a nearby-house alias',()=>{
 for(const parts of[[house()[0]],[...house().map((p,i)=>i===1?{...p,supported:false}:p)],[...house(),part('too-big','roof',[0,2,0],[50,3,3])]]){
  const c=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts});assert.equal(c.buildings.length,0);assert.equal(c.held,1);
 }
 assert.equal(buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[...house(),part('loose','roof',[100,2,0],[101,3,3])]}).buildings.length,1);
});

test('scenery, doors from another kind, fences and water cannot become modular building damage parts',()=>{
 for(const name of['Landscape','S_Modular_Fence_fixture','S_Mossy_Stone_Wall_fixture','S_Japanese_Wooden_Well_Roof_fixture','Pond','S_Modular_Building_Door_fixture'])assert.equal(buildingPartKind(name),null);
 for(const name of['çatı_cell_0_2','duvar_cell_0_2_NegativeScale_0','Wall_400x200_cell_0_1','S_Medieval_Modular_Gable_fixture'])assert.ok(buildingPartKind(name));
 assert.throws(()=>buildSourceBuildingCatalogue({sourceSha256:'unverified',profile:'desktop',parts:house()}),/verified/);
 assert.throws(()=>buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[...house(),house()[0]]}),/duplicate/);
});
