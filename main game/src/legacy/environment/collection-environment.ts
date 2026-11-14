import type { DesktopLegacyEnvironment,DesktopLegacyEnvironmentOptions,DesktopEnvironmentQuality } from '../environment-contract';
import type { LegacyEnvironmentLayout } from '../../../../shared/legacy/content/environments';
import type { LandmarkId } from '../../../../shared/legacy/types';
import type { LegacySceneState } from '../../../../shared/legacy/environment-contract';
import { BannerholdEnvironment } from './environment';
import { SourceDesktopEnvironment, sourceGeometryProfile } from '../worlds/source-environment';
import type { LegacyExplorationSnapshot, ExplorationPoint } from '../../../../shared/legacy/exploration/contract';
import { SceneExplorationController } from '../../../../shared/legacy/exploration/controller';
import { SettlementEnvironmentController } from '../../../../shared/legacy/environment/settlement/controller';
import type { SettlementSnapshot,SettlementTool } from '../../../../shared/legacy/settlement/contract';
/** Atomic environment swaps retain the previous view if a source world fails. */
export class CollectionDesktopEnvironment implements DesktopLegacyEnvironment {
  private current:DesktopLegacyEnvironment|null=null;private host:HTMLDivElement|null=null;
  private view:LandmarkId|'overview'|'representative'='overview';private highlighted:LandmarkId|null;
  private layout:LegacyEnvironmentLayout;private paused=false;private disposed=false;private token=0;
  private pending=new Set<{environment:DesktopLegacyEnvironment;host:HTMLDivElement}>();
  private explorationEnabled=false;private explorationUnsubscribe:(()=>void)|null=null;
  private explorationListeners=new Set<(snapshot:LegacyExplorationSnapshot)=>void>();
  private settlementListeners=new Set<(snapshot:SettlementSnapshot)=>void>();private settlementUnsubscribe:(()=>void)|null=null;private settlementFallback:SettlementEnvironmentController;
  private fallback:SceneExplorationController;
  constructor(private options:DesktopLegacyEnvironmentOptions){this.layout=options.layout??'bannerhold';this.highlighted=options.highlight??null;this.fallback=new SceneExplorationController(options.state);this.settlementFallback=new SettlementEnvironmentController(options.state,this.layout,null);}
  async init(){await this.load(this.layout);this.matchGeometry();}
  private async load(layout:LegacyEnvironmentLayout){
    if(this.disposed)return;
    const token=++this.token;const host=document.createElement('div');host.style.cssText='position:absolute;inset:0;opacity:0;pointer-events:none';this.options.container.append(host);
    this.current?.setPaused(true);
    // A failure while this attempt is still loading fails the attempt (the current view stays); once it is
    // the current view, the failure goes to the screen, which offers Retry.
    let next:BannerholdEnvironment|SourceDesktopEnvironment|null=null,failure:Error|null=null;
    const onError=(error:Error)=>{if(this.disposed)return;if(next!==null&&next===this.current)this.options.onError?.(error);else failure??=error;};
    const options={...this.options,layout,highlight:this.highlighted,container:host,onReady:()=>{},onError};
    let attempt:{environment:DesktopLegacyEnvironment;host:HTMLDivElement}|null=null;
    try{
      next=layout==='bannerhold'?new BannerholdEnvironment(options):new SourceDesktopEnvironment(options);
      attempt={environment:next,host};this.pending.add(attempt);
      await next.init();if(this.disposed||token!==this.token){next.dispose();host.remove();return;}
      if(failure)throw failure;
      next.setState(this.options.state);next.setQuality(this.options.quality);next.setReducedMotion(this.options.reducedMotion);next.setPaused(this.paused);
      if(this.view==='representative')next.inspectRepresentative();else if(this.view!=='overview')next.focusLandmark(this.view);next.highlightLandmark(this.highlighted);
      const member=this.current?.getExplorationSnapshot?.().selectedMemberId;next.setExplorationEnabled?.(this.explorationEnabled);if(member)next.setExplorationMember?.(member);
      this.explorationUnsubscribe?.();this.current?.dispose();this.host?.remove();this.current=next;this.host=host;this.layout=layout;
      this.explorationUnsubscribe=next.subscribeExploration?.(snapshot=>{for(const listener of this.explorationListeners)listener(snapshot);})??null;
      this.settlementUnsubscribe?.();this.settlementUnsubscribe=next.subscribeSettlement?.(snapshot=>{for(const listener of this.settlementListeners)listener(snapshot);})??null;
      host.style.opacity='1';host.style.pointerEvents='auto';this.options.onReady?.();
    }catch(e){try{next?.dispose();}finally{host.remove();if(!this.disposed&&token===this.token)this.current?.setPaused(this.paused);}throw e;}
    finally{if(attempt)this.pending.delete(attempt);}
  }
  async setLayout(layout:LegacyEnvironmentLayout){if(layout===this.layout)return;await this.load(layout);this.matchGeometry();}
  /**
   * A source world's geometry is built for one profile (Low uses the Quest one), so a preset change across
   * Low builds the world again; the current view stays until the new one is ready, and stays if it fails.
   * A load in progress checks again when it finishes.
   */
  private matchGeometry(){
    const current=this.current;
    if(this.disposed||this.pending.size>0||!(current instanceof SourceDesktopEnvironment)||current.geometry===sourceGeometryProfile(this.options.quality.preset))return;
    this.load(this.layout).then(()=>this.matchGeometry(),(error:unknown)=>console.warn(`My Legacy: the ${this.layout} world could not be rebuilt for the new quality (${error instanceof Error?error.message:String(error)}).`));
  }
  getSettlementSnapshot(){return this.current?.getSettlementSnapshot?.()??this.settlementFallback.getSettlementSnapshot();}
  getSettlementRenderInfo(){return this.current?.getSettlementRenderInfo?.()??{placements:[],preview:null};}
  getSettlementSourceInfo(){return this.current?.getSettlementSourceInfo?.()??null;}
  projectSettlementPoint(x:number,z:number,worldY?:number){return this.current?.projectSettlementPoint?.(x,z,worldY)??null;}
  focusSettlementPreview(){this.current?.focusSettlementPreview?.();}
  subscribeSettlement(listener:(snapshot:SettlementSnapshot)=>void){this.settlementListeners.add(listener);listener(this.getSettlementSnapshot());return()=>{this.settlementListeners.delete(listener);};}
  setSettlementTool(tool:SettlementTool|null){return this.current?.setSettlementTool?.(tool)??false;}
  setSettlementCursor(x:number,z:number){return this.current?.setSettlementCursor?.(x,z)??false;}
  moveSettlementCursor(dx:number,dz:number){return this.current?.moveSettlementCursor?.(dx,dz)??false;}
  rotateSettlementPreview(){return this.current?.rotateSettlementPreview?.()??false;}
  commitSettlementPlacement(){return this.current?.commitSettlementPlacement?.()??false;}
  cancelSettlementPlacement(){this.current?.cancelSettlementPlacement?.();}
  selectSettlementPlacement(id:string|null){return this.current?.selectSettlementPlacement?.(id)??false;}
  deleteSettlementPlacement(id?:string){return this.current?.deleteSettlementPlacement?.(id)??false;}
  getExplorationSnapshot(){return this.current?.getExplorationSnapshot?.()??this.fallback.getSnapshot();}
  setExplorationMember(id:string){return this.current?.setExplorationMember?.(id)??false;}
  travelToLandmark(id:LandmarkId){return this.current?.travelToLandmark?.(id)??false;}
  moveToPoint(point:ExplorationPoint){return this.current?.moveToPoint?.(point)??false;}
  fastTravelToLandmark(id:LandmarkId){return this.current?.fastTravelToLandmark?.(id)??false;}
  cancelTravel(){this.current?.cancelTravel?.();}
  setExplorationEnabled(enabled:boolean){this.explorationEnabled=enabled;this.current?.setExplorationEnabled?.(enabled);}
  subscribeExploration(listener:(snapshot:LegacyExplorationSnapshot)=>void){this.explorationListeners.add(listener);listener(this.getExplorationSnapshot());return()=>{this.explorationListeners.delete(listener);};}
  setState(v:LegacySceneState){this.options.state=v;this.current?.setState(v);}
  setPaused(v:boolean){this.paused=v;this.current?.setPaused(v);}
  setQuality(v:DesktopEnvironmentQuality){this.options.quality={...v};this.current?.setQuality(v);this.matchGeometry();}
  setReducedMotion(v:boolean){this.options.reducedMotion=v;this.current?.setReducedMotion(v);}
  focusLandmark(v:LandmarkId|null){this.view=v??'overview';this.current?.focusLandmark(v);}
  highlightLandmark(v:LandmarkId|null){this.highlighted=v;this.current?.highlightLandmark(v);}
  getLandmarks(){return this.current?.getLandmarks()??[];}
  projectLandmark(v:LandmarkId){return this.current?.projectLandmark(v)??null;}
  nudgeOrbit(yaw:number,pitch:number,zoom=0){this.current?.nudgeOrbit(yaw,pitch,zoom);}
  resetView(){this.view='overview';this.current?.resetView();}
  inspectRepresentative(){this.view='representative';this.current?.inspectRepresentative();}
  resize(){this.current?.resize();}
  getStats(){return this.current?.getStats()??{triangles:0,drawCalls:0,geometries:0,textures:0,frameTimesMs:[]};}
  dispose(){if(this.disposed)return;this.disposed=true;this.token++;this.explorationUnsubscribe?.();this.explorationListeners.clear();this.fallback.dispose();this.settlementUnsubscribe?.();this.settlementListeners.clear();this.settlementFallback.dispose();for(const attempt of this.pending){attempt.environment.dispose();attempt.host.remove();}this.pending.clear();this.current?.dispose();this.current=null;this.host?.remove();}
}
