import type { LegacyEnvironmentLayout } from '../content/environments';
import { SETTLEMENT_TOOLS, type LegacySettlementEnvironment, type SettlementPlacement, type SettlementSnapshot, type SettlementTool } from './contract';
import { MAX_SETTLEMENT_PLACEMENTS, readSettlementLayout, writeSettlementLayout, type SettlementStorage } from './storage';
import { validatePlacement, validPlacementShape, type SettlementSurface } from './validation';
import { settlementBudgetReason } from './budget';
export interface SettlementEditorOptions {
  bannerId: string | null;
  worldId: LegacyEnvironmentLayout;
  surface: SettlementSurface | null;
  defaults?: readonly SettlementPlacement[];
  storage?: SettlementStorage | null;
  /** Development previews deliberately never write device storage. */
  persist?: boolean;
  initialCursor?: readonly [number,number];
  /** The platform may prevent confirmation when the actual preview is out of view. */
  previewGuard?: (placement:SettlementPlacement)=>string|null;
  onChange?: (snapshot:SettlementSnapshot)=>void;
}
/** Device-local spatial presentation only. It has no reference to LegacyState,
 * a progression reducer, a match recorder, currency, timers or piece availability. */
export class SettlementEditor implements LegacySettlementEnvironment {
  private placements:SettlementPlacement[]=[];
  private tool:SettlementTool|null=null;
  private cursor={x:4,z:7};
  private width=8;private depth=6;private rotation:0|1|2|3=0;
  private selectedId:string|null=null;private message:string|null=null;private storageError:string|null=null;
  private listeners=new Set<(s:SettlementSnapshot)=>void>();private serial=0;
  constructor(private options:SettlementEditorOptions){
    if(options.initialCursor)this.cursor={x:options.initialCursor[0],z:options.initialCursor[1]};
    const read=options.bannerId&&options.persist!==false?readSettlementLayout(options.storage??null,options.bannerId,options.worldId):{layout:null,error:null};
    this.storageError=read.error;
    for(const p of read.layout?.placements??options.defaults??[])if(validPlacementShape(p)&&!this.placements.some(o=>o.id===p.id)&&(!options.surface||!validatePlacement(p,options.surface,this.placements)))this.placements.push({...p});
  }
  getSettlementSnapshot():SettlementSnapshot {
    const available=!!this.options.bannerId&&!!this.options.surface,reason=!this.options.bannerId?'Found your banner to arrange its estate.':!this.options.surface?'Estate placement is unavailable in this environment.':null;
    let preview:SettlementSnapshot['preview']=null;
    if(this.tool){const p:SettlementPlacement={id:'preview',kind:this.tool,x:this.cursor.x,z:this.cursor.z,width:this.width,depth:this.depth,rotation:this.rotation,crop:null};let invalid=!available?reason:validatePlacement(p,this.options.surface!,this.placements);if(!invalid)invalid=settlementBudgetReason([...this.placements,p]);if(!invalid&&this.options.previewGuard){try{invalid=this.options.previewGuard(p);}catch{invalid='The placement view is not ready.';}}preview={...p,valid:!invalid&&this.placements.length<MAX_SETTLEMENT_PLACEMENTS,reason:invalid??(this.placements.length>=MAX_SETTLEMENT_PLACEMENTS?'This estate has reached its placement limit.':null)};}
    return {available,reason,tool:this.tool,preview,placements:this.placements.map(p=>({...p})),selectedId:this.selectedId,message:this.message,storageError:this.storageError,maxPlacements:MAX_SETTLEMENT_PLACEMENTS};
  }
  setPersistencePermission(allowed:boolean){if((this.options.persist!==false)===allowed)return;this.options.persist=allowed;if(!allowed)this.storageError=null;this.publish();}
  /** Refreshes camera/panel eligibility without changing layout or storage. */
  refreshPreview(){if(this.tool)this.publish();}
  setPreviewGuard(guard:((placement:SettlementPlacement)=>string|null)|undefined){this.options.previewGuard=guard;this.publish();}
  subscribeSettlement(listener:(s:SettlementSnapshot)=>void){this.listeners.add(listener);listener(this.getSettlementSnapshot());return()=>{this.listeners.delete(listener);};}
  private publish(){const snapshot=this.getSettlementSnapshot();this.options.onChange?.(snapshot);for(const listener of this.listeners)listener(snapshot);}
  private save(){if(this.options.bannerId&&this.options.persist!==false)this.storageError=writeSettlementLayout(this.options.storage??null,{version:1,bannerId:this.options.bannerId,worldId:this.options.worldId,placements:this.placements});}
  setSettlementTool(tool:SettlementTool|null):boolean {
    if(tool===null){this.cancelSettlementPlacement();return true;}
    const item=SETTLEMENT_TOOLS.find(t=>t.id===tool);if(!item||!this.getSettlementSnapshot().available)return false;
    this.tool=tool;this.width=item.width;this.depth=item.depth;this.rotation=0;this.selectedId=null;this.message=null;
    this.publish();return true;
  }
  setSettlementCursor(x:number,z:number){if(!this.tool||!Number.isFinite(x)||!Number.isFinite(z))return false;const bounds=this.options.surface?.bounds;const next={x:Math.round(bounds?Math.max(bounds.minX-24,Math.min(bounds.maxX+24,x)):x),z:Math.round(bounds?Math.max(bounds.minZ-24,Math.min(bounds.maxZ+24,z)):z)};if(next.x===this.cursor.x&&next.z===this.cursor.z)return true;this.cursor=next;this.message=null;this.publish();return true;}
  moveSettlementCursor(dx:number,dz:number){return this.setSettlementCursor(this.cursor.x+Math.sign(dx),this.cursor.z+Math.sign(dz));}
  rotateSettlementPreview(){if(!this.tool)return false;this.rotation=((this.rotation+1)%4) as 0|1|2|3;this.publish();return true;}
  commitSettlementPlacement(){
    const preview=this.getSettlementSnapshot().preview;if(!preview?.valid){this.message=preview?.reason??'Choose a placement first.';this.publish();return false;}
    let id:string;do{id=`estate-${++this.serial}`;}while(this.placements.some(p=>p.id===id));
    const {valid,reason,...placement}=preview;this.placements.push({...placement,id});this.selectedId=id;this.tool=null;
    this.message=`${SETTLEMENT_TOOLS.find(t=>t.id===placement.kind)!.label} placed.`;this.save();this.publish();return true;
  }
  cancelSettlementPlacement(){this.tool=null;this.message=null;this.publish();}
  selectSettlementPlacement(id:string|null){if(id!==null&&!this.placements.some(p=>p.id===id))return false;this.tool=null;this.selectedId=id;this.message=null;this.publish();return true;}
  deleteSettlementPlacement(id?:string){const target=id??this.selectedId;if(!target||['banner-hall','muster-grounds','war-record','heralds-station'].includes(target))return false;const index=this.placements.findIndex(p=>p.id===target);if(index<0)return false;this.placements.splice(index,1);if(this.selectedId===target)this.selectedId=null;this.message='Placement removed.';this.save();this.publish();return true;}
  dispose(){this.listeners.clear();}
}
