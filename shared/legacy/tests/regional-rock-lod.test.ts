import assert from 'node:assert/strict';
import test from 'node:test';
import {REGIONAL_ROCK_LOD,regionalRockPixelDiameter,regionalRockUsesNear,regionalRockWorldScale,type RegionalRockProjection} from '../aethelgard/environment/regional-rock-lod';
const projection:RegionalRockProjection={kind:'perspective',projectionScaleX:1,projectionScaleY:1.6,drawBufferWidth:480,drawBufferHeight:300,nearPlane:.1,viewDepth:50,viewOffset:0,radius:1};
test('display-frame radius bounds include nonuniform scale/shear without touching source transforms',()=>{
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],scale=identity.slice();scale[0]=2;scale[5]=3;
 assert.equal(regionalRockWorldScale(identity),1);assert.equal(regionalRockWorldScale(scale),3);
 const shear=identity.slice();shear[4]=3;const before=shear.slice(),bound=regionalRockWorldScale(shear)!;assert.ok(bound>Math.hypot(3,1));
 for(let at=0;at<100;at++){const x=Math.cos(at),y=Math.sin(at),length=Math.hypot(x+3*y,y);assert.ok(length<=bound+1e-12);}assert.deepEqual(shear,before);
 assert.equal(regionalRockWorldScale(identity.map(()=>0)),null);assert.equal(regionalRockWorldScale([...identity.slice(0,15),NaN]),null);
});
test('actual projection, render resolution, zoom and physical scale control the existing rock detail gate',()=>{
 const pixels=regionalRockPixelDiameter(projection)!;assert.ok(Math.abs(pixels-480/49)<1e-12);
 assert.equal(regionalRockPixelDiameter({...projection,drawBufferHeight:600}),pixels*2);
 assert.equal(regionalRockPixelDiameter({...projection,projectionScaleY:3.2}),pixels*2);
 assert.ok(regionalRockPixelDiameter({...projection,radius:2})!>pixels*2);
 assert.equal(regionalRockPixelDiameter({...projection,viewOffset:50}),pixels*2,'Off-axis bounds cannot silently underestimate a peripheral silhouette.');
 assert.equal(regionalRockPixelDiameter({...projection,projectionScaleX:2}),pixels*2,'The horizontal viewport/projection also owns its true pixel extent.');
 assert.equal(regionalRockPixelDiameter({...projection,viewDepth:.5,radius:.01,nearPlane:.001}),pixels,'A uniformly scaled miniature retains its actual projected size.');
 assert.equal(regionalRockUsesNear(50,pixels,false,'low'),false);assert.equal(regionalRockUsesNear(50,pixels*3,false,'low'),true);
});
test('orthographic zoom stays depth-independent and invalid projection retains the original distance policy',()=>{
 const ortho={...projection,kind:'orthographic' as const,projectionScaleX:.01875,projectionScaleY:.03};
 assert.equal(regionalRockPixelDiameter(ortho),9);assert.equal(regionalRockPixelDiameter({...ortho,viewDepth:100}),9);
 assert.equal(regionalRockPixelDiameter({...ortho,projectionScaleY:.06}),18);
 for(const change of [{kind:'unknown' as const},{drawBufferHeight:0},{projectionScaleY:0},{nearPlane:0},{viewDepth:NaN},{radius:-1}]){
  const pixels=regionalRockPixelDiameter({...projection,...change});assert.equal(pixels,null);assert.equal(regionalRockUsesNear(50,pixels,false,'low'),true);
 }
});
test('near-plane intersections stay detailed without turning wholly behind-camera rocks into infinite priority',()=>{
 assert.equal(regionalRockPixelDiameter({...projection,viewDepth:0}),Infinity);
 assert.equal(regionalRockPixelDiameter({...projection,viewDepth:1.05}),Infinity);
 assert.equal(regionalRockPixelDiameter({...projection,viewDepth:-3}),0);
 assert.equal(regionalRockPixelDiameter({...projection,viewDepth:-.95}),0);
 assert.equal(regionalRockUsesNear(1,Infinity,false,'low'),true);
});
test('quality hysteresis and the unchanged distance caps select exactly one resident geometry',()=>{
 assert.deepEqual(Object.values(REGIONAL_ROCK_LOD.desktop).map(p=>[p.range,p.near]),[[650,100],[1000,160],[1500,240]]);
 assert.ok(Object.values(REGIONAL_ROCK_LOD.native).every(p=>p.range===280&&p.near===60));
 for(const native of [false,true])for(const quality of ['low','medium','high']as const){const p=REGIONAL_ROCK_LOD[native?'native':'desktop'][quality],middle=(p.enterPixels+p.exitPixels)/2;
  assert.equal(regionalRockUsesNear(10,p.enterPixels,false,quality,native),true);assert.equal(regionalRockUsesNear(10,middle,false,quality,native),false);
  assert.equal(regionalRockUsesNear(10,middle,true,quality,native),true);assert.equal(regionalRockUsesNear(10,p.exitPixels-.01,true,quality,native),false);
  assert.equal(regionalRockUsesNear(p.near,Infinity,true,quality,native),false);assert.equal(regionalRockUsesNear(p.near-1,null,false,quality,native),true);
 }
 assert.equal(regionalRockUsesNear(50,15,false,'low'),false);assert.equal(regionalRockUsesNear(50,15,false,'medium'),true);assert.equal(regionalRockUsesNear(50,11,false,'high'),true);
});
