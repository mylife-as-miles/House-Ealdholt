import {FOREST01_DENSITY_WALKING} from '../../../../shared/legacy/aethelgard/environment/forest01-density-walking-data';
import {decode} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import {FOREST01_DENSITY_LOD} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import {createRegionalProjectedGround} from '../../../../shared/legacy/aethelgard/environment/regional-projected-ground';
import {REGIONAL_VEGETATION_PROTOTYPES} from '../../../../shared/legacy/aethelgard/environment/regional-assets';
import type {createRegionalWorldLayout,RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {RealisticTreeCohortSource} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-cohort';
import {REALISTIC_TREE_WALKING_VERSION} from '../../../../shared/legacy/aethelgard/environment/realistic-tree-walking';
import {scannedShrubCohortSource} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
import {createEaldholtRegionalHorizon} from '../../../../shared/legacy/aethelgard/environment/regional-horizon';
import {naturalRiparianSource}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';

type Packet=Parameters<typeof createRegionalWorldLayout>[0]&{profile:'desktop'|'quest';projected?:boolean};
type Reply={layout?:RegionalWorldLayout;horizon?:Pick<ReturnType<typeof createEaldholtRegionalHorizon>,'positions'|'indices'|'bounds'>;error?:string};

test('actual worker handler transports both new source descriptors through structured clone without changing placement or terrain output',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'self');let reply:Reply|undefined,transfers=0;
 const scope={onmessage:null as ((event:MessageEvent<Packet>)=>void)|null,postMessage(message:Reply,transfer:Transferable[]=[]){assert.ok(transfer.every(value=>value instanceof ArrayBuffer));transfers=transfer.length;reply=structuredClone(message,{transfer});}};
 Object.defineProperty(globalThis,'self',{configurable:true,writable:true,value:scope});
 const received=():Reply|undefined=>reply;
 try{await import('./regional-world.worker');assert.equal(typeof scope.onmessage,'function','the production entrypoint must register its real handler');
  const village={minX:0,maxX:100,minZ:0,maxZ:100},geography=createEaldholtFarGeography({sourceEnvelope:village,seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,120,-50,0,150,200,0,120,200,0,150],riverFarX:30000});
  const source:RealisticTreeCohortSource={walkingTriangles:new Float64Array(),variant:2,height:17.2,canopyRadius:7.4,sourceSha256:'a'.repeat(64),contact:{baseY:0,radius:.47,points:[[-.4,0,-.2],[.4,.03,-.2],[0,.02,.47]]}};
  for(const profile of ['desktop','quest']as const){const packet:Packet={geography,land:[createRegionalProjectedGround(geography)],prototypes:REGIONAL_VEGETATION_PROTOTYPES,maximumTrees:600,profile,projected:profile==='quest',groundcoverSource:{radius:.5,minimumHeight:.2,maximumHeight:.25,families:['S_Grass_Clumps_unit']}};
   const send=(value:Packet)=>{reply=undefined;const transported=structuredClone(value);scope.onmessage!({data:transported}as MessageEvent<Packet>);const result=received();assert.ok(result);assert.equal(result.error,undefined);assert.ok(result.layout&&result.horizon);assert.ok(transfers>=4);return result as Required<Pick<Reply,'layout'|'horizon'>>;};
   const baseline=send(packet),qualified=send({...packet,naturalRiparianSource:naturalRiparianSource(profile==='quest'),realisticTreeSource:source,realisticForest01Source:{...source,variant:1,height:14.7,canopyRadius:4.4,sourceSha256:FOREST01_DENSITY_LOD.sourceSha256,...(profile==='desktop'?{densityWalking:{version:FOREST01_DENSITY_LOD.version,producer:FOREST01_DENSITY_WALKING.producer,normalization:FOREST01_DENSITY_WALKING.normalization,triangles:new Float64Array(decode(FOREST01_DENSITY_WALKING.bytes).buffer)}}:{})},scannedShrubSource:scannedShrubCohortSource(profile==='quest')});
   assert.ok(qualified.layout.naturalRiparian,'The new source contract must reach the actual worker qualifier.');assert.equal(qualified.layout.naturalRiparian.sourceSha256,naturalRiparianSource(profile==='quest').sourceSha256);assert.ok(qualified.layout.naturalRiparian.ids instanceof Uint32Array);assert.ok(qualified.layout.naturalRiparian.families instanceof Uint8Array);assert.equal(baseline.layout.naturalRiparian,undefined);
   assert.ok(qualified.layout.realisticTrees?.ids.length);assert.ok(qualified.layout.realisticForest01Trees?.ids.length,'a real handler that drops the new descriptor must fail this transport test');assert.equal(qualified.layout.realisticForest01Trees.walkingGuardVersion,REALISTIC_TREE_WALKING_VERSION);
   if(profile==='desktop'){assert.ok(qualified.layout.realisticForest01Trees.density,'actual worker must forward the density walking descriptor');assert.ok(qualified.layout.realisticForest01Trees.density.ids.every(id=>qualified.layout.realisticForest01Trees!.ids.includes(id)));}else assert.equal(qualified.layout.realisticForest01Trees.density,undefined);
   assert.ok(qualified.layout.scannedShrubs,'the scanned source descriptor must reach the layout qualifier even where no actor qualifies');assert.equal(qualified.layout.scannedShrubs.sourceSha256,scannedShrubCohortSource(profile==='quest').sourceSha256);assert.ok(qualified.layout.scannedShrubs.ids instanceof Uint32Array);
   assert.equal(baseline.layout.realisticForest01Trees,undefined);assert.equal(baseline.layout.scannedShrubs,undefined);assert.equal(qualified.layout.version,baseline.layout.version);
   for(const key of ['placements','rocks','groundcover','cells','landmarks','species','rejected']as const)assert.deepEqual(qualified.layout[key],baseline.layout[key],key+' must remain unchanged through the real worker boundary');
   assert.deepEqual(qualified.horizon,baseline.horizon);const expected=createEaldholtRegionalHorizon(geography,profile);assert.deepEqual(qualified.horizon.positions,expected.positions);assert.deepEqual(qualified.horizon.indices,expected.indices);assert.deepEqual(qualified.horizon.bounds,expected.bounds);
  }
 }finally{if(prior)Object.defineProperty(globalThis,'self',prior);else Reflect.deleteProperty(globalThis,'self');}
});
