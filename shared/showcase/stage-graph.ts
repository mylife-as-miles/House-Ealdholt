import { buildStageBlueprint, StageMotion, STAGE_BOARD_Y, squarePosition } from './stage-data';
import type { StageBlueprint, StageQuality } from './stage-data';
import type { ShowcaseFrame } from './types';
export interface StageNode {
  visible:boolean;
  position:{set(x:number,y:number,z:number):unknown};
  scale:{setScalar(value:number):unknown};
  rotation:{y:number};
}
export interface StageBackend {
  add(geometry:string,material:string,name:string,backdrop?:boolean):StageNode;
  remove(node:StageNode):void;
  geometry(node:StageNode,key:string):void;
}
export interface StageStats { draws:number;triangles:number;pieces:number;arena:number;quality:StageQuality;scope:'exhibition-stage'; }
/** One data/animation implementation drives both independent Three adapters. */
export class StageGraph {
  readonly blueprint:StageBlueprint;
  readonly motion=new StageMotion();
  private readonly staticNodes:{node:StageNode;arena?:number;geometry:string}[]=[];
  private readonly pieceNodes=new Map<string,{node:StageNode;geometry:string}>();
  private readonly markers:StageNode[]=[];
  private readonly check:StageNode;
  private arena=0;
  constructor(private readonly backend:StageBackend,readonly quality:StageQuality,blueprint?:StageBlueprint){
    this.blueprint=blueprint??buildStageBlueprint(quality);
    for(const object of this.blueprint.objects){const node=backend.add(object.geometry,object.material,object.name,object.backdrop);if(object.position)node.position.set(...object.position);this.staticNodes.push({node,arena:object.arena,geometry:object.geometry});}
    for(let i=0;i<2;i++){const node=backend.add('marker','highlight',`Last move ${i}`);node.visible=false;this.markers.push(node);}
    this.check=backend.add('marker','check','King in check');this.check.visible=false;
    this.setArena(0);this.setFrame(null);
  }
  setArena(index:number):void {this.arena=Math.max(0,Math.min(3,Math.floor(index)||0));for(const item of this.staticNodes)item.node.visible=item.arena===undefined||item.arena===this.arena;}
  setFrame(frame:ShowcaseFrame|null):void {
    this.motion.setFrame(frame);
    const wanted=new Set(this.motion.actors.map(a=>a.id));
    for(const [id,item] of this.pieceNodes)if(!wanted.has(id)){this.backend.remove(item.node);this.pieceNodes.delete(id);}
    for(const actor of this.motion.actors){const geometry=`${actor.color}-${actor.type}`;let item=this.pieceNodes.get(actor.id);
      if(!item){item={node:this.backend.add(geometry,'piece',`Chess ${actor.id}`),geometry};this.pieceNodes.set(actor.id,item);}
      else if(item.geometry!==geometry){this.backend.geometry(item.node,geometry);item.geometry=geometry;}
      item.node.rotation.y=actor.type==='n'&&actor.color==='b'?Math.PI:0;
    }
    for(let i=0;i<2;i++){const marker=this.markers[i],square=frame?.move?(i===0?frame.move.from:frame.move.to):null;marker.visible=!!square;if(square){const [x,z]=squarePosition(square);marker.position.set(x,STAGE_BOARD_Y+.002,z);}}
    const king=frame?.check?frame.pieces.find(p=>p.type==='k'&&p.color===frame.turn):null;this.check.visible=!!king;if(king){const [x,z]=squarePosition(king.square);this.check.position.set(x,STAGE_BOARD_Y+.003,z);}
    this.sync();
  }
  setReducedMotion(value:boolean):void {this.motion.reducedMotion=value;if(value)for(const a of this.motion.actors){a.progress=1;a.x=a.toX;a.z=a.toZ;a.y=STAGE_BOARD_Y;a.scale=a.capture?0:1;if(a.capture)a.visible=false;}this.sync();}
  setPaused(value:boolean):void {this.motion.paused=value;}
  update(delta:number):void {this.motion.update(delta);this.sync();}
  private sync():void {for(const a of this.motion.actors){const item=this.pieceNodes.get(a.id);if(!item)continue;item.node.visible=a.visible;item.node.position.set(a.x,a.y,a.z);item.node.scale.setScalar(a.scale);}}
  getStats():StageStats {
    let draws=0,triangles=0,pieces=0;for(const item of this.staticNodes)if(item.node.visible){draws++;triangles+=this.blueprint.geometries[item.geometry].indices.length/3;}
    for(const item of this.pieceNodes.values())if(item.node.visible){draws++;pieces++;triangles+=this.blueprint.geometries[item.geometry].indices.length/3;}
    for(const node of [...this.markers,this.check])if(node.visible){draws++;triangles+=12;}
    return {draws,triangles,pieces,arena:this.arena,quality:this.quality,scope:'exhibition-stage'};
  }
  dispose():void {for(const item of this.staticNodes)this.backend.remove(item.node);for(const item of this.pieceNodes.values())this.backend.remove(item.node);for(const node of this.markers)this.backend.remove(node);this.backend.remove(this.check);this.pieceNodes.clear();}
}
