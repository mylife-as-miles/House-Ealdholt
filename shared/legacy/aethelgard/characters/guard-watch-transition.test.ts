import assert from 'node:assert/strict';
import test from 'node:test';
import {guardWatchTransitionFade as fade} from './guard-watch-transition';
test('only proven adjacent source phases fade; cold, paused-cold, skipped, late and already mixed states cut safely',()=>{
 assert.equal(fade('walk',.7,'workEnter',0,false,true,1.2,.12),.12);
 assert.equal(fade('work',5.73,'workExit',0,false,true,1.2,.12),.12);
 assert.equal(fade('workEnter',1.08,'work',0,false,true,1.2,.12),.12);
 assert.equal(fade('workExit',1.08,'walk',0,false,true,1.2,.12),.12);
 for(const args of [['idle',0,'work',1,false,false],['idle',0,'workEnter',.5,false,false],
  ['walk',.7,'work',.5,false,true],['work',2,'walk',0,false,true],['walk',.7,'workEnter',.1,false,true],
  ['walk',.7,'workEnter',0,true,true],['workEnter',1.2,'work',0,false,true]] as const)
  assert.equal(fade(...args,1.2,.12),0,JSON.stringify(args));
});
