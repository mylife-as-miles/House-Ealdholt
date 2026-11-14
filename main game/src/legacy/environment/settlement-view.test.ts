import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { settlementPointVisible, unobstructedSettlementPoint } from './settlement-view';

test('placement guard rejects offscreen and UI-covered plots; Show plot selects actual exposed canvas',()=>{
 const pane={},canvas={getBoundingClientRect:()=>({left:100,top:40,width:1000,height:600}),ownerDocument:{elementFromPoint:(x:number,y:number)=>x>600||y<100?pane:canvas}} as unknown as HTMLCanvasElement;
 assert.equal(settlementPointVisible(canvas,{x:200,y:250,visible:true}),true);
 assert.equal(settlementPointVisible(canvas,{x:800,y:250,visible:true}),false);
 assert.equal(settlementPointVisible(canvas,{x:200,y:250,visible:false}),false);
 assert.equal(settlementPointVisible(canvas,{x:1001,y:250,visible:true}),false);
 const point=unobstructedSettlementPoint(canvas)!;
 assert.ok(point);
 assert.equal(settlementPointVisible(canvas,{...point,visible:true}),true);
 canvas.ownerDocument.elementFromPoint=()=>pane as Element;
 assert.equal(unobstructedSettlementPoint(canvas),null);
});
