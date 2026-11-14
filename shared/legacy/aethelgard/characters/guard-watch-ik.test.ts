import assert from 'node:assert/strict';
import test from 'node:test';
import {solveGuardTwoBone,type GuardPoint} from './guard-watch-ik';
const length=(a:GuardPoint,b:GuardPoint)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('the foot solve keeps both real segment lengths and the original knee side while lifting a planted foot',()=>{
 const hip:GuardPoint=[0,1,0],knee:GuardPoint=[0,.52,.18],foot:GuardPoint=[0,-.04,0],target:GuardPoint=[0,.003,0];
 const before=JSON.stringify([hip,knee,foot,target]),result=solveGuardTwoBone(hip,knee,foot,target)!;
 assert.ok(result);assert.deepEqual(result.tip,target);assert.ok(result.elbow[2]>0);
 assert.ok(Math.abs(length(hip,result.elbow)-length(hip,knee))<1e-12);
 assert.ok(Math.abs(length(result.elbow,result.tip)-length(knee,foot))<1e-12);
 assert.equal(JSON.stringify([hip,knee,foot,target]),before);
});
test('missing bend evidence, unreachable target and malformed geometry stay held rather than extending a leg',()=>{
 assert.equal(solveGuardTwoBone([0,1,0],[0,.5,0],[0,0,0],[0,.003,0]),null);
 assert.equal(solveGuardTwoBone([0,1,0],[0,.5,.1],[0,0,0],[0,-1,0]),null);
 assert.equal(solveGuardTwoBone([0,1,0],[0,.5,.1],[0,0,0],[NaN,0,0]),null);
});
