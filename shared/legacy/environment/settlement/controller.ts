import type { BannerholdPresentation } from '../../types';
import type { LegacyEnvironmentLayout } from '../../content/environments';
import { SettlementEditor } from '../../settlement/editor';
import { browserSettlementStorage } from '../../settlement/storage';
import type { LegacySettlementEnvironment,SettlementPlacement,SettlementSnapshot,SettlementTool } from '../../settlement/contract';
import type { SettlementSurface } from '../../settlement/validation';
import { AUTUMN_SETTLEMENT_BUILDINGS,AUTUMN_SETTLEMENT_PATHS,AUTUMN_WATER_LEVEL,settlementHeight,settlementShore } from './layout';
import { settlementTreeSites } from './nature';
import { sourceShoreObstacles } from '../../worlds/combined/shore-layout';
// The full canonical forest is protected on every quality level, so a layout
// accepted on Quest never reopens through a desktop trunk after a reload.
export const AUTUMN_SETTLEMENT_SURFACE:SettlementSurface={bounds:{minX:-80,maxX:80,minZ:-80,maxZ:80},groundAt:settlementHeight,dryAt:(x,z)=>settlementHeight(x,z)>AUTUMN_WATER_LEVEL+.3&&x>settlementShore(z)+7,obstacles:[...AUTUMN_SETTLEMENT_BUILDINGS.map(b=>({x:b.x,z:b.z,width:b.width,depth:b.depth,yaw:b.yaw})),...sourceShoreObstacles(),...settlementTreeSites().slice(0,760).map(tree=>({x:tree.x,z:tree.z,width:1.6*tree.scale,depth:1.6*tree.scale,yaw:0}))],paths:AUTUMN_SETTLEMENT_PATHS};
export const AUTUMN_DEFAULT_PLACEMENTS:readonly SettlementPlacement[]=Object.freeze([]);
/** Keeps view subscriptions stable across house changes. Presentation-only estate
 * storage is never written for development fixtures or folded into house saves. */
export class SettlementEnvironmentController implements LegacySettlementEnvironment {
 private editor:SettlementEditor;private unsubscribe:(()=>void)|null=null;private listeners=new Set<(snapshot:SettlementSnapshot)=>void>();private identity:string;
 private previewGuard:((placement:SettlementPlacement)=>string|null)|undefined;
 constructor(private state:BannerholdPresentation,private worldId:LegacyEnvironmentLayout,private surface:SettlementSurface|null,private defaults:readonly SettlementPlacement[]=[]){this.identity=this.key(state);this.editor=this.create(state);this.bind();}
 private key(state:BannerholdPresentation){return state.bannerId??'';}
 private create(state:BannerholdPresentation){return new SettlementEditor({bannerId:state.bannerId??null,worldId:this.worldId,surface:this.surface,defaults:this.defaults,storage:browserSettlementStorage(),persist:state.estatePersistent===true&&state.mode==='production',previewGuard:this.previewGuard,initialCursor:[4,7]});}
 private bind(){this.unsubscribe=this.editor.subscribeSettlement(snapshot=>{for(const listener of this.listeners)listener(snapshot);});}
 setState(state:BannerholdPresentation){this.state=state;const identity=this.key(state);if(identity===this.identity){this.editor.setPersistencePermission(state.estatePersistent===true&&state.mode==='production');return;}this.identity=identity;this.unsubscribe?.();this.editor.dispose();this.editor=this.create(state);this.bind();}
 getSettlementSnapshot(){return this.editor.getSettlementSnapshot();}
 setPreviewGuard(guard:((placement:SettlementPlacement)=>string|null)|undefined){this.previewGuard=guard;this.editor.setPreviewGuard(guard);}
 refreshPreviewGuard(){this.editor.setPreviewGuard(this.previewGuard);}
 refreshPreview(){this.editor.refreshPreview();}
 subscribeSettlement(listener:(snapshot:SettlementSnapshot)=>void){this.listeners.add(listener);listener(this.getSettlementSnapshot());return()=>{this.listeners.delete(listener);};}
 setSettlementTool(tool:SettlementTool|null){return this.editor.setSettlementTool(tool);}
 setSettlementCursor(x:number,z:number){return this.editor.setSettlementCursor(x,z);}
 moveSettlementCursor(dx:number,dz:number){return this.editor.moveSettlementCursor(dx,dz);}
 rotateSettlementPreview(){return this.editor.rotateSettlementPreview();}
 commitSettlementPlacement(){return this.editor.commitSettlementPlacement();}
 cancelSettlementPlacement(){this.editor.cancelSettlementPlacement();}
 selectSettlementPlacement(id:string|null){return this.editor.selectSettlementPlacement(id);}
 deleteSettlementPlacement(id?:string){return this.editor.deleteSettlementPlacement(id);}
 dispose(){this.unsubscribe?.();this.listeners.clear();this.editor.dispose();}
}
