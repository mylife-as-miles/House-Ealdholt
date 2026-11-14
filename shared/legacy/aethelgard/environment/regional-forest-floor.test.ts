import assert from 'node:assert/strict';
import test from 'node:test';
import {EALDHOLT_FAR_LAND_FIELD,type EaldholtFarGeography} from './far-surround';
import {regionalForestFloorField} from './regional-forest-floor';
import type {RegionalPrototype,RegionalWorldLayout} from './regional-world-layout';

const geography:EaldholtFarGeography={version:1,axes:'source:+X-east/-Z-north',landField:EALDHOLT_FAR_LAND_FIELD,
 coastSamples:new Float32Array(),channelSamples:new Float32Array(),seaLevel:0,
 sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},riverJoinX:100,riverFarX:200};
const tree:RegionalPrototype={id:'test-tree',height:12,canopyRadius:3,shrub:false};
const layout=(placements:number[]):RegionalWorldLayout=>({version:'test',treeCount:placements.length/6,shrubCount:0,
 placements:Float32Array.from(placements),rocks:new Float32Array(),cells:[],landmarks:[],attempts:0,rejected:{},species:[placements.length/6]});
const empty=regionalForestFloorField(geography,layout([]),[tree]);
// Put the source crown on a known raster centre so this probes area rather
// than changing sub-pixel alignment between otherwise identical actors.
const x=empty.bounds[0]+(160.5/empty.size)*empty.bounds[2];
const z=empty.bounds[1]+(160.5/empty.size)*empty.bounds[3];
const actor=[x,0,z,0,1,0];
const total=(data:Uint8Array)=>data.reduce((sum,value)=>sum+value,0);
const peak=(data:Uint8Array)=>data.reduce((highest,value)=>Math.max(highest,value),0);

test('small crowns do not become full-strength litter patches on a kilometre-scale grid',()=>{
 const field=regionalForestFloorField(geography,layout(actor),[tree]);
 assert.ok(peak(field.data)<60,'a 3m crown covers only a fraction of a coarse raster cell');
 assert.ok(total(field.data)>0,'sub-pixel crowns must remain represented');
 const larger=regionalForestFloorField(geography,layout(actor),[{...tree,canopyRadius:6}]);
 assert.ok(total(larger.data)/total(field.data)>3.7&&total(larger.data)/total(field.data)<4.3,
  'doubling a sub-pixel radius should contribute approximately four times the covered area');
});

test('source scale contributes canopy area and leaves actor transforms unchanged',()=>{
 const source=layout(actor),before=source.placements.slice();
 const normal=regionalForestFloorField(geography,source,[tree]);
 const scaled=regionalForestFloorField(geography,layout([x,0,z,0,2,0]),[tree]);
 const radius=regionalForestFloorField(geography,source,[{...tree,canopyRadius:6}]);
 assert.deepEqual(scaled.data,radius.data);
 assert.ok(total(scaled.data)>total(normal.data));assert.deepEqual(source.placements,before);
 assert.deepEqual(regionalForestFloorField(geography,layout([x,40,z,1.8,1,0]),[tree]).data,normal.data);
});

test('authored settlement and empty clearings receive no regional litter override',()=>{
 const field=regionalForestFloorField(geography,layout([50,0,50,0,1,0]),[{...tree,canopyRadius:200}]);
 let settlementSamples=0;
 for(let iz=0;iz<field.size;iz++)for(let ix=0;ix<field.size;ix++){
  const px=field.bounds[0]+(ix+.5)/field.size*field.bounds[2],pz=field.bounds[1]+(iz+.5)/field.size*field.bounds[3];
  if(px>-.5&&px<100.5&&pz>-.5&&pz<100.5){settlementSamples++;assert.equal(field.data[iz*field.size+ix],0);}
 }
 assert.ok(settlementSamples>0);assert.equal(field.data[0],0);assert.equal(total(empty.data),0);
});

test('shrubs never create tree litter and overlapping crowns stay bounded and deterministic',()=>{
 assert.equal(total(regionalForestFloorField(geography,layout(actor),[{...tree,shrub:true}]).data),0);
 const placements=Array.from({length:40},()=>actor).flat(),source=layout(placements);
 const a=regionalForestFloorField(geography,source,[tree]),b=regionalForestFloorField(geography,source,[tree]);
 assert.deepEqual(a.data,b.data);assert.equal(peak(a.data),255);
 assert.equal(a.data.filter(v=>v>0).length,regionalForestFloorField(geography,layout(actor),[tree]).data.filter(v=>v>0).length,
  'overlap must strengthen existing coverage without spreading the canopy footprint');
});

test('sub-pixel coverage stays comparable across raster resolutions and fractional crown positions',()=>{
 const areas:number[]=[];
 for(const size of [256,512,1024])for(const offset of [.1,.35,.5,.8]){
  const px=empty.bounds[0]+(20+offset)/size*empty.bounds[2],pz=empty.bounds[1]+(20+offset)/size*empty.bounds[3];
  const field=regionalForestFloorField(geography,layout([px,0,pz,0,1,0]),[tree],size);
  areas.push(total(field.data)/255*field.bounds[2]*field.bounds[3]/(size*size));
 }
 assert.ok(Math.min(...areas)>0);
 assert.ok(Math.max(...areas)/Math.min(...areas)<1.45,
  'coarse resolution or fractional alignment must not multiply the physical litter area; allow byte-mask quantization');
});
