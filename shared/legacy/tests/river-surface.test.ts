import assert from 'node:assert/strict';
import test from 'node:test';
import { EALDHOLT_BANK_ART_VERSION,ealdholtRiverMaterialWeights,patchEaldholtRiverSurface } from '../aethelgard/environment/river-surface';
import { createEaldholtBankExposureSections, ealdholtValleyGroundWeights, EALDHOLT_WOODLAND_BANK_ART_VERSION } from '../aethelgard/environment/woodland-ground';
import { packEaldholtBankExposure, EALDHOLT_BANK_KNOT_PROGRAM_KEY } from '../aethelgard/environment/authored-bank-knots';
function fixture(){return{uniforms:{} as Record<string,{value:unknown}>,vertexShader:'#include <common>\n#include <begin_vertex>',
 fragmentShader:'#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>\n#include <aomap_fragment>'};}

test('photo RGB survives the material blend with aligned borrowed earth/rock PBR maps and no old cancellation',()=>{
 const shader=fixture(),normal={},orm={},rock={albedo:{},normal:{},orm:{},meanLuminance:.12};
 patchEaldholtRiverSurface(shader,.053,100,70,'attribute',{earthNormal:normal,earthOrm:orm,rock,waterHeight:2});
 assert.equal(shader.uniforms.uEaldholtValleyEarthNormal.value,normal);assert.equal(shader.uniforms.uEaldholtValleyEarthOrm.value,orm);
 assert.equal(shader.uniforms.uEaldholtValleyRockAlbedo.value,rock.albedo);assert.equal(shader.uniforms.uEaldholtValleyRockNormal.value,rock.normal);assert.equal(shader.uniforms.uEaldholtValleyRockOrm.value,rock.orm);
 assert.equal(shader.uniforms.uEaldholtValleyWaterHeight.value,2);assert.equal(shader.uniforms.uEaldholtValleyRockMean.value,.12);
 assert.match(shader.fragmentShader,/ealdholtWeights\.x\*ealdholtEarthPhoto\*ealdholtEarthReflectance/);
 assert.match(shader.fragmentShader,/ealdholtWeights\.z\*ealdholtRockPhoto\*ealdholtRockReflectance/);
 assert.doesNotMatch(shader.fragmentShader,/ValleyGain|\/ max\(ealdholtValleyPhoto|\.82, 1\.18|sRGBToLinear|discard/);
 assert.match(shader.fragmentShader,/ealdholtRockOrm\.g/);assert.match(shader.fragmentShader,/ealdholtRockNormal\.xy\*ealdholtWeights\.z/);assert.match(shader.fragmentShader,/ealdholtSurfaceAo/);
 assert.ok(shader.fragmentShader.indexOf('diffuseColor.rgb=ealdholtSurface')<shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
 const before=JSON.stringify(shader);patchEaldholtRiverSurface(shader,.053,100,70,'attribute',{rock});assert.equal(JSON.stringify(shader),before);
 assert.match(EALDHOLT_BANK_ART_VERSION,/earth-grass-rock/);
});

test('source palette classification separates earth, grass and exposed rock without interpreting dark RGB as weights',()=>{
 const soil=ealdholtRiverMaterialWeights([.071,.050,.030],1,2,0),grass=ealdholtRiverMaterialWeights([.035,.063,.025],1,2,0),rock=ealdholtRiverMaterialWeights([.085,.088,.073],.65,4,0);
 assert.ok(soil.earth>.95);assert.ok(grass.grass>.95);assert.ok(rock.rock>.9);
 const wetGrass=ealdholtRiverMaterialWeights([.035,.063,.025],1,2,1);assert.ok(wetGrass.earth>grass.earth);assert.ok(wetGrass.grass<grass.grass);
 for(let i=0;i<=100;i++){const weights=ealdholtRiverMaterialWeights([.071,.050,.030],1-i/100,4,i/100);assert.ok(Object.values(weights).every(Number.isFinite));assert.ok(Math.abs(weights.earth+weights.grass+weights.rock-1)<1e-12);assert.ok(weights.earth>=0&&weights.grass>=0&&weights.rock>=0);}
 const before=ealdholtRiverMaterialWeights([.06,.08,.04],.9,2,.4999),after=ealdholtRiverMaterialWeights([.06,.08,.04],.9,2,.5001);assert.ok(Math.abs(before.grass-after.grass)<.001);
});

test('derivative filtering and macro structure use unchanged source metres under the Native root pose',()=>{
 const shader=fixture();patchEaldholtRiverSurface(shader,.05,100,30,'attribute');
 assert.match(shader.vertexShader,/vEaldholtValleySourcePosition = position/);assert.match(shader.vertexShader,/vEaldholtValleySourceNormal = normal/);
 assert.match(shader.vertexShader,/vEaldholtShoreWetness = ealdholtShoreWetness/);assert.match(shader.fragmentShader,/dFdx\(uv\)\*size/);
 assert.match(shader.fragmentShader,/textureLod\(sourceMap,fract\(uv\),max\(minimumLod,max\(0\.,lod\)\)\)/);
 assert.match(shader.fragmentShader,/dFdx\(-vViewPosition\)/);assert.match(shader.fragmentShader,/ealdholtSurfaceNormal/);
 assert.doesNotMatch(shader.fragmentShader,/float centre|uEaldholtValleyMargin|worldPosition|random\s*\(|noise\s*\(/);
});

test('legacy river wetness remains available and invalid material/shader inputs fail before mutation',()=>{
 const shader=fixture();patchEaldholtRiverSurface(shader,.05,100,30);assert.equal(shader.uniforms.uEaldholtValleySourceMaxZ.value,100);assert.equal(shader.uniforms.uEaldholtValleyMargin.value,30);
 for(const invalid of [NaN,0,-1,2]){const next=fixture(),before=JSON.stringify(next);assert.throws(()=>patchEaldholtRiverSurface(next,invalid,100,30),/Invalid/);assert.equal(JSON.stringify(next),before);}
 assert.throws(()=>patchEaldholtRiverSurface({uniforms:{},vertexShader:'custom',fragmentShader:'custom'},.05,100,30),/standard PBR/);
 assert.throws(()=>ealdholtRiverMaterialWeights([.1,NaN,.2],1,1,0),/Invalid/);
});

test('optional actual grass maps affect only the grass contribution with aligned two-metre PBR sampling',()=>{
 const shader=fixture(),grass={albedo:{},normal:{},orm:{},meanLuminance:.244},earth={},rock={albedo:{},normal:{},orm:{},meanLuminance:.12};
 patchEaldholtRiverSurface(shader,.053,100,30,'attribute',{earthNormal:earth,earthOrm:earth,rock,grass,waterHeight:2});
 for(const[role,value]of Object.entries({Albedo:grass.albedo,Normal:grass.normal,Orm:grass.orm}))assert.equal(shader.uniforms['uEaldholtValleyGrass'+role].value,value);
 assert.equal(shader.uniforms.uEaldholtValleyGrassMean.value,.244);
 assert.equal(shader.uniforms.uEaldholtValleyGrassTileMetres.value,2);
 assert.match(shader.fragmentShader,/ealdholtGrassUv=vEaldholtValleySourcePosition\.xz\*vec2\(1\.\/uEaldholtValleyGrassTileMetres,-1\.\/uEaldholtValleyGrassTileMetres\)/);
 assert.match(shader.fragmentShader,/ealdholtGrassPhoto=ealdholtValleyPhoto\(uEaldholtValleyGrassAlbedo,ealdholtGrassUv,0\.\)\.rgb/);
 assert.match(shader.fragmentShader,/ealdholtWeights\.y\*ealdholtGrassPhoto\*ealdholtGrassReflectance/);
 assert.match(shader.fragmentShader,/ealdholtWeights\.y\*ealdholtGrassOrm\.g/);
 assert.match(shader.fragmentShader,/uEaldholtValleyGrassNormal,ealdholtGrassUv,0\./);
 assert.match(shader.fragmentShader,/ealdholtWeights\.x\*ealdholtEarthPhoto\*ealdholtEarthReflectance/);
 assert.match(shader.fragmentShader,/ealdholtWeights\.z\*ealdholtRockPhoto\*ealdholtRockReflectance/);
 assert.doesNotMatch(shader.fragmentShader,/ealdholtGrassPhoto=mix|sRGBToLinear|discard/);
 const fallback=fixture();patchEaldholtRiverSurface(fallback,.053,100,30,'attribute');assert.equal(fallback.uniforms.uEaldholtValleyGrassAlbedo,undefined);assert.match(fallback.fragmentShader,/ealdholtGrassPhoto=mix/);
 const invalid=fixture(),before=JSON.stringify(invalid);assert.throws(()=>patchEaldholtRiverSurface(invalid,.053,100,30,'attribute',{grass:{...grass,meanLuminance:NaN}}),/grass surface/);assert.equal(JSON.stringify(invalid),before);
});

test('verified grass physical scale stays independent of root presentation and invalid scale fails before shader mutation',()=>{const grass={albedo:{},meanLuminance:.09249,tileMetres:1.4},shader=fixture();patchEaldholtRiverSurface(shader,.05,100,30,'attribute',{grass});assert.equal(shader.uniforms.uEaldholtValleyGrassTileMetres.value,1.4);for(const tileMetres of [NaN,0,-1,32]){const invalid=fixture(),before=JSON.stringify(invalid);assert.throws(()=>patchEaldholtRiverSurface(invalid,.05,100,30,'attribute',{grass:{...grass,tileMetres}}),/grass surface/);assert.equal(JSON.stringify(invalid),before);}});

function woodlandFixture(){return{bank:{tileMetres:1.3,targetLuminance:.06},meadow:{albedo:{},normal:{},meanLuminance:.248,targetLuminance:.07,tileMetres:2},
 sections:createEaldholtBankExposureSections([-40,-5,5,0,-20,-6,4,0,0,-4,6,0,20,-5,5,0,40,-3,7,0],64)};}

test('explicit bank/meadow dispatch uses geometric dry meadow and waterline banks without a second canopy owner',()=>{
 const shader=fixture(),woodland=woodlandFixture();patchEaldholtRiverSurface(shader,.053,100,30,'attribute',{woodland,waterHeight:2});
 assert.match(shader.fragmentShader,/CROWNFALL_WOODLAND_VALLEY_SURFACE/);assert.ok(shader.fragmentShader.includes(EALDHOLT_WOODLAND_BANK_ART_VERSION));
 assert.match(shader.fragmentShader,/float ealdholtMeadowW=1\.-ealdholtRockW-ealdholtBankW/);
 assert.match(shader.fragmentShader,/ealdholtValleyBankSection\(ealdholtP\)/);assert.match(shader.vertexShader,/vEaldholtShoreWetness = ealdholtShoreWetness/);
 assert.doesNotMatch(shader.fragmentShader,/float neutral=|uEaldholtValleyCanopy|uEaldholtValleyForestMean/);
 assert.equal(shader.uniforms.uEaldholtValleyGrassAlbedo.value,woodland.meadow.albedo);assert.equal(shader.uniforms.uEaldholtValleyWaterHeight.value,2);
 assert.deepEqual(shader.uniforms.uEaldholtValleyBank.value,packEaldholtBankExposure(woodland.sections.data,woodland.sections.count));
 assert.deepEqual(shader.uniforms.uEaldholtValleyBankKnots.value,woodland.sections.authoredBanks.data);
 assert.deepEqual(shader.uniforms.uEaldholtValleyWaterStages.value,woodland.sections.waterStages.data);
 assert.match(shader.fragmentShader,/#define CROWNFALL_BANK_SOURCE_CONTACT\b/);assert.match(shader.fragmentShader,/#define CROWNFALL_BANK_AUTHORED_KNOTS\b/);assert.ok(shader.fragmentShader.includes(EALDHOLT_BANK_KNOT_PROGRAM_KEY));
 const dry=ealdholtValleyGroundWeights({distance:30,exposure:0,slope:0,heightAboveWater:4,wetness:0,reach:1});
 assert.deepEqual(dry,{bank:0,meadow:1,woodland:0,rock:0});
 const wet=ealdholtValleyGroundWeights({distance:30,exposure:0,slope:0,heightAboveWater:0,wetness:1,reach:0});assert.ok(wet.bank>=.7,'coastal wet fringe survives outside river reach');
 const rock=ealdholtValleyGroundWeights({distance:30,exposure:0,slope:.7,heightAboveWater:4,wetness:0});assert.equal(rock.rock,1);
 const before=JSON.stringify(shader);patchEaldholtRiverSurface(shader,.053,100,30,'attribute',{woodland});assert.equal(JSON.stringify(shader),before);
});

test('explicit woodland contracts reject invalid layers and missing shore attributes before shader mutation',()=>{
 for(const options of [{...woodlandFixture(),bank:{tileMetres:0,targetLuminance:.06}},
   {...woodlandFixture(),meadow:{...woodlandFixture().meadow,targetLuminance:NaN}}]){
  const shader=fixture(),before=JSON.stringify(shader);assert.throws(()=>patchEaldholtRiverSurface(shader,.053,100,30,'attribute',{woodland:options}),/Invalid woodland/);assert.equal(JSON.stringify(shader),before);
 }
 const shader=fixture(),before=JSON.stringify(shader);assert.throws(()=>patchEaldholtRiverSurface(shader,.053,100,30,'river',{woodland:woodlandFixture()}),/shore wetness/);assert.equal(JSON.stringify(shader),before);
});
