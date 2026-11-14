import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePolylinePosition,sourceRouteTrajectory,futureSourceRouteTrajectory,stationarySourceTrajectory,firstSourceTrajectoryContact,sourceTrajectoryPositionAt,stopSourceTrajectory}from'./source-trajectory';
import type{VillageSitePoint}from'./village-site';
const body={radius:.6,height:1.8},line=(...p:number[][])=>p as unknown as VillageSitePoint[],near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('source trajectories retain source corners, real speed and stationary arrival intervals',()=>{
 const trace=sourceRouteTrajectory(line([0,0,0],[0,0,3],[4,0,3]),0,7,0,10,1);assert.equal(trace.length,3);assert.deepEqual(sourceTrajectoryPositionAt(trace,4).position,[1,0,3]);assert.deepEqual(sourceTrajectoryPositionAt(trace,9).position,[4,0,3]);assert.equal(sourceTrajectoryPositionAt(trace,9).moving,false);
});
test('following source routes may share space at distinct times, while stationary endpoints remain occupied',()=>{
 const points=line([0,0,0],[10,0,0],[10,0,5]),ahead=futureSourceRouteTrajectory(points,3,1,0,1),behind=futureSourceRouteTrajectory(line([0,0,0],[10,0,0],[10,0,-5]),0,1,0,1);
 assert.equal(firstSourceTrajectoryContact(ahead,body,behind,body),null);
 const sameEnd=futureSourceRouteTrajectory(points,0,1,0,1);assert.notEqual(firstSourceTrajectoryContact(ahead,body,sameEnd,body),null);
});
test('crossing and head-on movement uses simultaneous swept contact rather than endpoint samples',()=>{
 const x=sourceRouteTrajectory(line([-5,0,0],[5,0,0]),0,10,0,10,1),z=sourceRouteTrajectory(line([0,0,-5],[0,0,5]),0,10,0,10,1),head=sourceRouteTrajectory(line([5,0,0],[-5,0,0]),0,10,0,10,1);
 near(firstSourceTrajectoryContact(x,body,z,body)!,5-1.200001/Math.sqrt(2));near(firstSourceTrajectoryContact(x,body,head,body)!,4.3999995);
 const late=sourceRouteTrajectory(line([0,0,-5],[0,0,5]),0,10,3,13,1);assert.equal(firstSourceTrajectoryContact(x,body,late,body),null);
});
test('vertical source bands exclude bridges but include simultaneous slope crossings',()=>{
 const x=sourceRouteTrajectory(line([-5,0,0],[5,0,0]),0,10,0,10,1),bridge=sourceRouteTrajectory(line([0,3,-5],[0,3,5]),0,10,0,10,1),slope=sourceRouteTrajectory(line([0,3,-5],[0,0,5]),0,Math.hypot(3,10),0,11,1);
 assert.equal(firstSourceTrajectoryContact(x,body,bridge,body),null);assert.notEqual(firstSourceTrajectoryContact(x,body,slope,body),null);
});
test('a frozen or reversed leader cannot be penetrated by an admitted follower, including an interval whose endpoints are clear',()=>{
 const follower=sourceRouteTrajectory(line([0,0,0],[10,0,0]),0,10,0,10,1),frozen=stationarySourceTrajectory([4,0,0],0,10),hit=firstSourceTrajectoryContact(follower,body,frozen,body)!;near(hit,2.799999);
 const stopped=stopSourceTrajectory(follower,hit,10);near(sourceTrajectoryPositionAt(stopped,10).progress,hit);assert.equal(sourceTrajectoryPositionAt(stopped,10).moving,false);
 const reversed=sourceRouteTrajectory(line([4,0,0],[-6,0,0]),0,10,0,10,1);near(firstSourceTrajectoryContact(follower,body,reversed,body)!,1.3999995);
});
test('source contact remains stable under JSON reload and temporal subdivision',()=>{
 const points=line([0,0,0],[0,0,3],[8,0,3]),full=sourceRouteTrajectory(points,0,11,0,12,1),stationary=stationarySourceTrajectory([4,0,3],0,12),contact=firstSourceTrajectoryContact(full,body,stationary,body)!;
 const split=[...sourceRouteTrajectory(points,0,4,0,4,1),...sourceRouteTrajectory(points,4,11,4,12,1)];near(firstSourceTrajectoryContact(split,body,stationary,body)!,contact);near(firstSourceTrajectoryContact(JSON.parse(JSON.stringify(full)),body,stationary,body)!,contact);
});


test('a shallow frozen outer polyline cannot cache mutable source tuple distances',()=>{
 const a:VillageSitePoint=[0,0,0],b:number[]=[2,0,0],points=Object.freeze([a,b as unknown as VillageSitePoint]);assert.deepEqual(sourcePolylinePosition(points,1),[1,0,0]);b[0]=4;assert.deepEqual(sourcePolylinePosition(points,3),[3,0,0]);
});
