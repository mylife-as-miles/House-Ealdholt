import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStageBlueprint, squarePosition, StageMotion, STAGE_BOARD_Y, STAGE_BOUNDS } from './stage-data';
import { StageGraph } from './stage-graph';
import type { StageNode } from './stage-graph';
import { recordFromPGN } from './records';
function settle(motion:StageMotion){for(let i=0;i<6;i++)motion.update(.1);}
const node=():StageNode=>({visible:true,position:{set(){}},scale:{setScalar(){}},rotation:{y:0}});

test('stage geometry is finite, indexed, coloured and bounded for both render adapters',()=>{
  for(const quality of ['low','medium','high'] as const){const blueprint=buildStageBlueprint(quality),backgrounds=new Set(blueprint.objects.filter(o=>o.backdrop).map(o=>o.geometry));
    for(const [name,g] of Object.entries(blueprint.geometries)){
      assert.ok(g.positions.length>0,name);assert.equal(g.normals.length,g.positions.length,name);assert.equal(g.colors.length,g.positions.length,name);
      assert.ok(g.positions.every(Number.isFinite),name);assert.ok(g.normals.every(Number.isFinite),name);
      assert.ok(g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.positions.length/3),name);
      assert.ok(g.positions.filter((_,i)=>i%3===0).every(x=>Math.abs(x)<=(backgrounds.has(name)?1.401:.525)),`${name} width`);
      assert.ok(g.positions.filter((_,i)=>i%3===1).every(y=>y>=(backgrounds.has(name)?-.05:STAGE_BOUNDS.floor-.000001)&&y<=(backgrounds.has(name)?.73:.445)),`${name} height`);
    }
    const graph=new StageGraph({add:()=>node(),remove(){},geometry(){}},quality,blueprint);
    for(let arena=0;arena<4;arena++){graph.setArena(arena);const stats=graph.getStats();assert.equal(stats.pieces,32);assert.ok(stats.draws<=44);assert.ok(stats.triangles<65000);}
    graph.dispose();
  }
});

test('legal move poses reach exact squares, freeze on pause and seek without traveling backwards',()=>{
  const record=recordFromPGN('1. e4 d5 2. exd5 Qxd5 *'),motion=new StageMotion();motion.setFrame(record.frames[0]);motion.setFrame(record.frames[1]);
  const pawn=motion.actors.find(a=>a.id===record.frames[1].pieces.find(p=>p.square==='e4')!.id)!;
  motion.update(.1);const y=pawn.y,z=pawn.z;assert.ok(y>STAGE_BOARD_Y);motion.paused=true;motion.update(.1);assert.equal(pawn.y,y);assert.equal(pawn.z,z);
  motion.paused=false;settle(motion);assert.deepEqual([pawn.x,pawn.z],squarePosition('e4'));assert.equal(pawn.y,STAGE_BOARD_Y);
  motion.setFrame(record.frames[0]);assert.deepEqual([pawn.x,pawn.z],squarePosition('e2'));
  for(const frame of record.frames){motion.setFrame(frame);settle(motion);}
  assert.equal(motion.actors.filter(a=>a.visible).length,record.frames[4].pieces.length);
});

test('castling and promotion preserve IDs and roles; reset and record changes remain bounded',()=>{
  const castle=recordFromPGN('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O O-O-O *');
  const promotion=recordFromPGN('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ *');
  const motion=new StageMotion();for(const record of [castle,promotion])for(const frame of record.frames){motion.setFrame(frame);settle(motion);for(const p of frame.pieces){const a=motion.actors.find(a=>a.id===p.id)!;assert.equal(a.type,p.type);assert.deepEqual([a.x,a.z],squarePosition(p.square));}}
  for(let i=0;i<30;i++){motion.setFrame(null);motion.setFrame(castle.frames[0]);}
  assert.ok(motion.actors.length<=64);motion.setFrame(null);assert.equal(motion.actors.filter(a=>a.visible).length,32);
});


test('unrelated imported frames never animate through the old record or retain its actors',()=>{
  const a=recordFromPGN('1. e4 *');
  const b=recordFromPGN('[SetUp "1"]\n[FEN "7k/8/8/8/8/8/P7/7K w - - 0 1"]\n\n1. a4 *');
  const motion=new StageMotion();for(let i=0;i<50;i++){motion.setFrame(a.frames[0]);motion.setFrame(b.frames[1]);assert.equal(motion.actors.length,3);assert.ok(motion.actors.every(actor=>actor.progress===1));}
});
