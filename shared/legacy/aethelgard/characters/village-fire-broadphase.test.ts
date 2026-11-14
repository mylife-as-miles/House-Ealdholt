import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EALDHOLT_SWINE_CARRY_ROUTE_CANDIDATE as source} from './ealdholt-emergency-route-candidate';
import {villageLifeFireSegmentInterval,type VillageLifeNavigationObstacle} from './village-life-navigation';
import type {VillageSiteLayout,VillageSitePoint} from './village-site';
// Frozen pre-optimization kernel used only for differential regression. The
// production exact branch below the broadphase remains byte-for-byte identical.
function originalExactFireInterval(a:VillageSitePoint,b:VillageSitePoint,site:VillageSiteLayout,o:VillageLifeNavigationObstacle):readonly[number,number]|null {
 const delta=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],radius=site.capsule.radius;let verticalLo=0,verticalHi=1;
 const slab=(origin:number,d:number,low:number,high:number,lo:number,hi:number):readonly[number,number]|null=>{
  if(Math.abs(d)<1e-12)return origin>=low&&origin<=high?[lo,hi]:null;
  const x=(low-origin)/d,y=(high-origin)/d;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));return lo<=hi?[lo,hi]:null;
 };
 const y=slab(a[1],delta[1],o.bounds.min[1]-site.capsule.height,o.bounds.max[1],0,1);if(!y)return null;[verticalLo,verticalHi]=y;
 let earliest=Infinity,latest=-Infinity;
 const accept=(range:readonly[number,number]|null)=>{if(range){earliest=Math.min(earliest,range[0]);latest=Math.max(latest,range[1]);}};
 const rectangle=(minX:number,maxX:number,minZ:number,maxZ:number)=>{const x=slab(a[0],delta[0],minX,maxX,verticalLo,verticalHi);return x?slab(a[2],delta[2],minZ,maxZ,x[0],x[1]):null;};
 accept(rectangle(o.bounds.min[0]-radius,o.bounds.max[0]+radius,o.bounds.min[2],o.bounds.max[2]));
 accept(rectangle(o.bounds.min[0],o.bounds.max[0],o.bounds.min[2]-radius,o.bounds.max[2]+radius));
 const quadratic=delta[0]*delta[0]+delta[2]*delta[2];
 for(const x of[o.bounds.min[0],o.bounds.max[0]])for(const z of[o.bounds.min[2],o.bounds.max[2]]){
  const dx=a[0]-x,dz=a[2]-z,c=dx*dx+dz*dz-radius*radius;
  if(quadratic<1e-20){if(c<=1e-12)accept([verticalLo,verticalHi]);continue;}
  const linear=2*(dx*delta[0]+dz*delta[2]),disc=linear*linear-4*quadratic*c;if(disc< -1e-12*Math.max(1,linear*linear,Math.abs(4*quadratic*c)))continue;
  const root=Math.sqrt(Math.max(0,disc)),lo=Math.max(verticalLo,(-linear-root)/(2*quadratic)),hi=Math.min(verticalHi,(-linear+root)/(2*quadratic));if(lo<=hi)accept([lo,hi]);
 }
 return earliest<=latest?[earliest,latest]:null;
}
const point=(x:number,y:number,z:number):VillageSitePoint=>[x,y,z];
const site=(radius=.85,height=3.5)=>({capsule:{radius,height}})as VillageSiteLayout;
const box=(min:VillageSitePoint,max:VillageSitePoint):VillageLifeNavigationObstacle=>({id:'differential-fire',sourceSha256:'a'.repeat(64),profile:'desktop',kind:'fire',activeFromAbsoluteMinute:0,bounds:{min,max}});
function check(a:VillageSitePoint,b:VillageSitePoint,map:VillageSiteLayout,obstacle:VillageLifeNavigationObstacle){assert.deepEqual(villageLifeFireSegmentInterval(a,b,map,obstacle),originalExactFireInterval(a,b,map,obstacle),JSON.stringify({a,b,capsule:map.capsule,obstacle}));}

test('allocation-free fire broadphase preserves all exact corner, vertical, degenerate and large-frame intervals',()=>{
 const obstacle=box(point(0,0,0),point(1,4,1));
 for(const offset of [0,1e-16,-1e-16,1e-12,-1e-12,1e-8,-1e-8,.001,-.001])for(const radius of [.85,.6281633375592951]){
  const map=site(radius),corner=1+radius/Math.sqrt(2)+offset;
  for(const a of [point(corner,1,corner),point(1+radius+offset,1,.5),point(.5,4+offset,.5),point(.5,-map.capsule.height+offset,.5),point(100,1,0)])
   for(const delta of [0,1e-12,1e-10,1e-5,.1,10])check(a,point(a[0]+delta,a[1],a[2]+delta),map,obstacle);
 }
 for(const frame of [1e5,1e6,1e7,1e12]){const o=box(point(frame,0,frame),point(frame+1,4,frame+1));
  for(const delta of [1e-12,1e-5,1,10,100])check(point(frame-10,1,frame+.5),point(frame-10+delta,1,frame+.5),site(),o);
 }
 // The old tiny-span discriminant tolerance is retained, including this
 // conservative false positive; the optimization must not narrow it silently.
 check(point(100,1,0),point(100,1,1e-10),site(),box(point(0,0,0),point(0,4,0)));
});

test('random source-sized fire segments are exactly equivalent to the unmodified kernel',()=>{
 let seed=0x5a17cafe;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
 for(let i=0;i<30000;i++){
  const x=(random()-.5)*1000,z=(random()-.5)*1000,y=random()*20-5,span=i%11===0?1e-10:i%7===0?.0001:random()*100;
  const a=point(x,y,z),b=point(x+(random()-.5)*span,y+(random()-.5)*span*.2,z+(random()-.5)*span);
  const bx=x+(random()-.5)*200,bz=z+(random()-.5)*200,by=random()*20-5,width=i%13===0?0:random()*10;
  check(a,b,site(i%2===0?.85:.6281633375592951,i%2===0?3.5:1.9270472484796264),box(point(bx,by,bz),point(bx+width,by+random()*10,bz+random()*10)));
 }
});

// Optional read-only benchmark on the same generated bounds/arc data for both
// paths; no FPS or GPU claim. Accept a real exported source frame if supplied.
test('128-volume source-style differential workload records bounded CPU timings',()=>{
 const volumes=Array.from({length:128},(_,i)=>box(point(i*2-64,0,(i%8)*3),point(i*2-63.9,4,(i%8)*3+.2))),map=site();
 const segments=Array.from({length:20},(_,i)=>[point(58-i*2,1,11+i*1.1),point(56-i*2,1,12.1+i*1.1)]as const);
 const run=(kernel:typeof villageLifeFireSegmentInterval)=>{let hits=0;const start=performance.now();for(let pass=0;pass<30;pass++)for(const [a,b]of segments)for(const o of volumes)if(kernel(a,b,map,o))hits++;return{hits,milliseconds:performance.now()-start};};
 run(originalExactFireInterval);run(villageLifeFireSegmentInterval);const original=run(originalExactFireInterval),optimized=run(villageLifeFireSegmentInterval);assert.equal(optimized.hits,original.hits);console.log(JSON.stringify({scope:'Node differential128-volume source-style CPU microbenchmark; not actual village/GPU timing',original,optimized}));
});


test('actual source128 fire volumes and measured carry arc preserve exact CPU hit intervals',{skip:!process.env.CROWNFALL_FIRE_BROADPHASE_BENCHMARK_INPUT},()=>{
 const input=JSON.parse(fs.readFileSync(process.env.CROWNFALL_FIRE_BROADPHASE_BENCHMARK_INPUT!,'utf8'))as {sourceSha256:string;obstacles:VillageLifeNavigationObstacle[]};assert.equal(input.sourceSha256,source.sourceSha256);assert.equal(input.obstacles.length,128);
 for(const map of [site(),site(source.body.radius+source.body.margin,source.body.height+source.body.lift+source.body.margin)]){
  const segments=source.sourceGroundPolyline.slice(1).map((b,i)=>[source.sourceGroundPolyline[i],b]as const);
  for(const [a,b]of segments)for(const o of input.obstacles)check(a,b,map,o);
  const run=(kernel:typeof villageLifeFireSegmentInterval)=>{let hits=0;const start=performance.now();for(let pass=0;pass<30;pass++)for(const [a,b]of segments)for(const o of input.obstacles)if(kernel(a,b,map,o))hits++;return{hits,milliseconds:performance.now()-start};};
  run(originalExactFireInterval);run(villageLifeFireSegmentInterval);const original=run(originalExactFireInterval),optimized=run(villageLifeFireSegmentInterval);assert.equal(optimized.hits,original.hits);console.log(JSON.stringify({scope:'Actual immutable source128-fire-volume/measured20pointarc CPU microbenchmark only; not full simulation or GPU timing',sourceSha256:source.sourceSha256,certificateSha256:source.certificateSha256,capsule:map.capsule,original,optimized}));
 }
});
