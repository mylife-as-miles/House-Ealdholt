import test from 'node:test';
import assert from 'node:assert/strict';
import {createEaldholtFarGeography,sampleEaldholtFarGeography} from '../aethelgard/environment/far-surround';
import {createRegionalWorldLayout,regionalVillageEdgeDistance} from '../aethelgard/environment/regional-world-layout';
import {createRegionalProjectedGround} from '../aethelgard/environment/regional-projected-ground';
import {REGIONAL_VEGETATION_PROTOTYPES as prototypes} from '../aethelgard/environment/regional-assets';
import {EALDHOLT_REGIONAL_WORLD as policy} from '../aethelgard/environment/regional-world-policy';
import {regionalForestFloorField} from '../aethelgard/environment/regional-forest-floor';
const geography=createEaldholtFarGeography({sourceEnvelope:{minX:0,maxX:100,minZ:0,maxZ:100},seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,120,-50,0,150,200,0,120,200,0,150],riverFarX:30000});
const land=[createRegionalProjectedGround(geography)];
test('all 56,287 additional trees have deterministic dry support outside authored village and landmark clearings',()=>{
 const layout=createRegionalWorldLayout({geography,land,prototypes});
 assert.equal(layout.treeCount,policy.additionalTrees);assert.equal(layout.shrubCount,policy.additionalShrubs);assert.equal(layout.placements.length/6,layout.treeCount+layout.shrubCount);assert.equal(layout.species.reduce((a,b)=>a+b),layout.treeCount+layout.shrubCount);
 assert.equal(layout.landmarks.length,2);assert.ok(layout.cells.length>100);assert.equal(layout.cells.reduce((n,c)=>n+c.ids.length,0),layout.treeCount+layout.shrubCount);
 assert.equal(layout.rocks.length/6,policy.additionalRocks);
 assert.equal(layout.groundcover!.length/6,policy.additionalGroundcover);
 for(let at=0;at<layout.groundcover!.length;at+=6){const[x,y,z,,scale,variant]=layout.groundcover!.subarray(at,at+6);assert.ok(Number.isFinite(y)&&scale>0&&variant<3);assert.equal(sampleEaldholtFarGeography(geography,x,z).kind,'mainland');assert.ok(regionalVillageEdgeDistance(geography.sourceEnvelope,x,z)>4+scale*.7-.001);assert.ok(layout.landmarks.every(p=>Math.hypot(x-p.x,z-p.z)>p.radius+11.99));}
 let edgeRocks=0,edgeShrubs=0;for(let at=0;at<layout.rocks.length;at+=6)if(regionalVillageEdgeDistance(geography.sourceEnvelope,layout.rocks[at],layout.rocks[at+2])<60)edgeRocks++;
 for(let at=layout.treeCount*6;at<layout.placements.length;at+=6)if(regionalVillageEdgeDistance(geography.sourceEnvelope,layout.placements[at],layout.placements[at+2])<60)edgeShrubs++;
 assert.ok(edgeRocks>250,'Scanned rock dressing must reach the village woodland, rather than only distant terrain.');assert.ok(edgeShrubs>1000,'The clearing edge needs visible understory density.');
 assert.ok(layout.cells.every(c=>c.ids.length<=policy.maximumTreesPerCell));
 for(let i=0;i<layout.placements.length;i+=6){const [x,y,z,yaw,scale,variant]=layout.placements.subarray(i,i+6);
  assert.equal(sampleEaldholtFarGeography(geography,x,z).kind,'mainland');assert.ok(Number.isFinite(y)&&yaw>=0&&yaw<Math.PI*2&&scale>0&&variant<15);
  assert.ok(regionalVillageEdgeDistance(geography.sourceEnvelope,x,z)>=prototypes[variant].canopyRadius*scale+policy.villageEdge.minimumSetback-.001);
  assert.ok(layout.landmarks.every(p=>Math.hypot(x-p.x,z-p.z)>p.radius+11.99));
 }
 for(let at=0;at<layout.rocks.length;at+=6){const[x,y,z,,scale,variant]=layout.rocks.subarray(at,at+6);assert.equal(sampleEaldholtFarGeography(geography,x,z).kind,'mainland');assert.ok(Number.isFinite(y)&&scale>0&&variant<3);assert.ok(regionalVillageEdgeDistance(geography.sourceEnvelope,x,z)>=policy.villageEdge.minimumSetback+2-.001);assert.ok(layout.landmarks.every(p=>Math.hypot(x-p.x,z-p.z)>p.radius+11.99));}
 let edgeTrees=0,closest=Infinity;const sides=new Set<string>();
 for(let at=0;at<layout.treeCount*6;at+=6){const[x,,z]=layout.placements.subarray(at,at+3),d=regionalVillageEdgeDistance(geography.sourceEnvelope,x,z);closest=Math.min(closest,d);if(d<60){edgeTrees++;if(x<0)sides.add('west');if(x>100)sides.add('east');if(z<0)sides.add('north');if(z>100)sides.add('south');}}
 assert.ok(closest<12,'Real woodland must reach the village edge, not stop beyond a 24 m cleared ring.');assert.ok(edgeTrees>400,'Dense, connected near-village woodland must not be replaced by a distant-only count.');assert.ok(sides.has('north')&&sides.has('east'),'Forests enclose the inland village on its wooded north and east.');
 let nearby=0;for(let at=0;at<layout.treeCount*6;at+=6)if(Math.hypot(layout.placements[at]-50,layout.placements[at+2]-50)<1000)nearby++;
 assert.ok(nearby>layout.treeCount*.25,'The nearby woodland must receive a substantial part of the forest, not only distant placements.');
 const floor=regionalForestFloorField(geography,layout,prototypes);assert.ok(floor.data.some(v=>v>0));
 const ix=Math.floor((50-floor.bounds[0])/floor.bounds[2]*floor.size),iz=Math.floor((50-floor.bounds[1])/floor.bounds[3]*floor.size);assert.equal(floor.data[iz*floor.size+ix],0,'The authored settlement stays outside the litter field.');
 const prefix=createRegionalWorldLayout({geography,land,prototypes,maximumTrees:200});assert.deepEqual(layout.placements.subarray(0,1200),prefix.placements.subarray(0,1200));
});
test('missing terrain cannot silently invent supported placements',()=>{
 assert.throws(()=>createRegionalWorldLayout({geography,land:[],prototypes,maximumTrees:20}),/shortfall/);
 assert.throws(()=>createRegionalWorldLayout({geography,land,prototypes,maximumTrees:policy.additionalTrees+1}),/Invalid/);
});

test('unused Landscape margins can receive trees while the measured village stays clear and roots use actual source ground',()=>{
 const village={minX:30,maxX:70,minZ:30,maxZ:70},villageLand=[{positions:Float64Array.from([0,5,0,100,5,0,0,5,100,100,5,100]),indices:Uint32Array.from([0,2,1,1,2,3])}];
 const layout=createRegionalWorldLayout({geography,land,prototypes,village,villageLand,maximumTrees:500});let onSource=0;
 for(let at=0;at<layout.treeCount*6;at+=6){const[x,y,z,,scale,variant]=layout.placements.subarray(at,at+6);assert.ok(regionalVillageEdgeDistance(village,x,z)>=prototypes[variant].canopyRadius*scale+policy.villageEdge.minimumSetback-.001);
  if(x>=0&&x<=100&&z>=0&&z<=100){onSource++;assert.ok(Math.abs(y-4.92)<.0001,'The real terrain wins over the distant analytic fallback.');}}
 assert.ok(onSource>0,'Protecting the entire Landscape must not force every added tree out of the village surroundings.');
});
