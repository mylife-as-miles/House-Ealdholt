import test from'node:test';import assert from'node:assert/strict';
import{createNaturalRiparianCoverage}from'./natural-riparian-coverage';
const select=(rows:number[][],limit=6)=>{const selection=createNaturalRiparianCoverage(limit);selection.reset();for(const[id,family,distance,x,z]of rows)selection.consider(id,family,distance,x,z);const count=selection.finish();return selection.rows.slice(0,count).map(r=>({...r}));};
test('half the existing slots cover distinct nearby cells while nearest qualified detail remains, with no moved IDs',()=>{
 const dense=Array.from({length:20},(_,i)=>[i,i%2,i*.1+.1,.1+i*.01,.2]),other=Array.from({length:8},(_,i)=>[30+i,i%2,i+5,7+i*7,2]),input=[...dense,...other],copy=structuredClone(input),chosen=select(input);
 assert.equal(chosen.length,6);assert.equal(new Set(chosen.map(r=>r.id)).size,6);assert.ok(new Set(chosen.map(r=>r.cellX+','+r.cellZ)).size>=3);assert.ok(chosen.some(r=>r.id===0));assert.deepEqual(input,copy);
 for(const value of chosen)assert.ok(input.some(row=>row[0]===value.id&&row[1]===value.family&&row[2]===value.distance));
});
test('candidate ordering and tie distances yield deterministic unique Desktop/Native bounded selection',()=>{
 const rows=Array.from({length:100},(_,i)=>[i,i%2,i%9,Math.floor(i/4)*6.1,(i%4)*1.1]);
 for(const limit of[6,24]){const first=select(rows,limit);assert.deepEqual(select([...rows].reverse(),limit),first);assert.equal(first.length,limit);assert.equal(new Set(first.map(row=>row.id)).size,limit);assert.equal(select([...rows,...rows],limit).length,limit);}
});
test('reset selects only submitted eligible candidates and retains bounded storage',()=>{
 const selection=createNaturalRiparianCoverage(6),owned=selection.rows;
 selection.consider(4,0,12,1,1);assert.equal(selection.finish(),1);assert.equal(selection.rows[0].id,4);
 selection.reset();selection.consider(7,1,10,7,7);assert.equal(selection.finish(),1);assert.equal(selection.rows,owned);assert.equal(selection.rows[0].id,7);assert.ok(selection.rows.slice(0,selection.finish()).every(r=>r.id!==4));
 assert.throws(()=>selection.consider(9000,0,1,1,1));assert.throws(()=>selection.consider(1,0,Infinity,1,1));assert.throws(()=>selection.consider(1,0,-1,1,1));assert.throws(()=>createNaturalRiparianCoverage(25));
});
