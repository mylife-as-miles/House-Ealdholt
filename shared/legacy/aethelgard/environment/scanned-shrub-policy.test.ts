import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyScannedShrubCohort,scannedShrubDerivativeBudget,scannedShrubDetailLimit,scannedShrubFootprint,validScannedShrubSource} from './scanned-shrub-policy';
import {scannedShrubCohortSource,SCANNED_SHRUB_ASSETS,SCANNED_SHRUB_SOURCE_IDENTITY,scannedShrubAssetMetadataMatches} from './scanned-shrub-assets';
import {EALDHOLT_FAR_LAND_FIELD,type EaldholtFarGeography} from './far-surround';
import {REGIONAL_ROOT_CONTACTS} from './regional-root-contact-data';
const geography:EaldholtFarGeography={version:1,axes:'source:+X-east/-Z-north',landField:EALDHOLT_FAR_LAND_FIELD,sourceEnvelope:{minX:-200,maxX:300,minZ:-200,maxZ:300},seaLevel:0,riverJoinX:-500,riverFarX:500,
 coastSamples:Float32Array.from([-1000,-500,1000,-500]),channelSamples:Float32Array.from([-500,-30,-20,0,500,-30,-20,0])};
const village={minX:0,maxX:100,minZ:0,maxZ:100};
const plane=[{vertices:[[-1000,0,-1000],[3000,0,-1000],[-1000,0,3000]] as const}];
const footprint=(x:number,z:number,r:number)=>scannedShrubFootprint(plane,x,z,r);
const y=-REGIONAL_ROOT_CONTACTS.bramble.baseY-.08;

test('canonical scan stays natural, soft and inside prior bramble envelopes with separately carved budgets',()=>{
 for(const native of [false,true]){
  const source=scannedShrubCohortSource(native);assert.ok(validScannedShrubSource(source));assert.equal(source.height,1.506312655167515);assert.equal(source.contact.baseY,REGIONAL_ROOT_CONTACTS.bramble.baseY);
  assert.ok(source.contact.radius<REGIONAL_ROOT_CONTACTS.bramble.radius);assert.equal(scannedShrubDetailLimit(native),native?2:4);
  const total=(native?32:96)*1024**2,trees=(native?8:16)*1024**2,shrubs=scannedShrubDerivativeBudget(native);
  assert.equal((total-trees-shrubs)+trees+shrubs,total,'derivative slices stay inside the existing forest total');
  assert.ok(source.windReach*(.03/source.height)**2*2<.001,'the complete collar wind at maximum accepted scale fits the contact-disk margin');
  const expected=SCANNED_SHRUB_ASSETS[native?'native':'desktop'];assert.ok(scannedShrubAssetMetadataMatches({...SCANNED_SHRUB_SOURCE_IDENTITY,texturePreset:expected.preset},native));
  assert.equal(scannedShrubAssetMetadataMatches({...SCANNED_SHRUB_SOURCE_IDENTITY,texturePreset:'wrong'},native),false);
  for(const invalid of [{...source,height:20},{...source,canopyRadius:8},{...source,windReach:0},{...source,contact:{...source.contact,radius:2}}])assert.equal(validScannedShrubSource(invalid),false);
 }
});

test('cohort reuses exact IDs/transforms inside unused Landscape margins and holds floating, buried, path and water contacts',()=>{
 const source=scannedShrubCohortSource(),placements=Float32Array.from([
  20,y,115,.3,.8,13, // valid and inside broad Landscape bounds, outside actual village
  30,y,120,.4,.8,12, // different family
  20,.1,130,.5,.8,13, // floating
  30,-2,130,.6,.8,13, // excessive burial
  50,y,101,.7,.8,13, // measured settlement envelope
  20,y,-19,.8,.8,13, // exact river bank contact/wind reaches water
 ]),before=placements.slice();
 const result=qualifyScannedShrubCohort({placements,source,geography,village,footprint});
 assert.deepEqual(Array.from(result.ids),[0]);assert.equal(result.examined,5);assert.equal(result.rejectedRoot,4);assert.deepEqual(placements,before);
 const obstructed=qualifyScannedShrubCohort({placements,source,geography,village,footprint,landmarks:[{x:20,z:115,radius:3}]});assert.equal(obstructed.ids.length,0);
 const missing=qualifyScannedShrubCohort({placements,source,geography,village,footprint:()=>null});assert.equal(missing.ids.length,0);
});

test('complete contact disk rejects holes, boundaries, steep or conflicting support instead of trusting point probes',()=>{
 assert.ok(scannedShrubFootprint(plane,0,0,.25));
 const edge=[{vertices:[[0,0,0],[2,0,0],[0,0,2]] as const}];assert.equal(scannedShrubFootprint(edge,.05,.05,.25),null,'centre is supported but disk crosses the true boundary');
 assert.equal(scannedShrubFootprint([],0,0,.25),null);
 const overlapping={vertices:[[-1,.2,-1],[2,.2,-1],[-1,.2,2]] as const};assert.equal(scannedShrubFootprint([...plane,overlapping],0,0,.25),null,'overlap is not silently assigned the higher plane');
 const source=scannedShrubCohortSource(),placements=Float32Array.from([20,y,115,0,1,13]);
 assert.equal(qualifyScannedShrubCohort({placements,source,geography,village,footprint:()=>({height:0,minimumHeight:-.3,maximumHeight:.3,slope:.7})}).ids.length,0);
 const shallow=Float32Array.from([20,-source.contact.baseY-.02,115,0,1,13]);
 assert.equal(qualifyScannedShrubCohort({placements:shallow,source,geography,village,footprint}).ids.length,0,'highest interior point of the bottom3cm band cannot float even if hull samples look plausible');
});
