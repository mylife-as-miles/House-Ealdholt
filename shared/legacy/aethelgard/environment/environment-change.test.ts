import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldEnvironmentChangeHandler} from './environment-change';
test('only nonvisual preparation uses the progress wake; visible, final and legacy changes retain rendering',()=>{
 const calls:string[]=[],notify=createWorldEnvironmentChangeHandler({prepare:()=>calls.push('preparation'),render:()=>calls.push('render')});
 notify('preparation');notify('visual');notify('ready');notify();assert.deepEqual(calls,['preparation','render','render','render']);
});
