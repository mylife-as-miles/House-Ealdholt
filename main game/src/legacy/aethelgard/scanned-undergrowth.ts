import {Group,type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import {borrowScannedShrubSource} from './scanned-shrub-source';
import {createScannedRegionalShrubs,type ScannedRegionalShrubs} from './scanned-regional-shrubs';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import type {WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {scannedShrubDerivativeBudget} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-policy';

/** Optional, nonblocking source import. Failure or an uncertain source leaves
 * ordinary bramble ownership intact; source templates stay with their loader. */
export function createScannedUndergrowth(options:{
 sourceRoot:Object3D;renderer:WebGLRenderer;scene:Scene;camera:Camera;queue:WorldPreparationQueue;
 worker:VegetationPreparationWorker;signal:AbortSignal;native?:boolean;conditions?:()=>WorldEnvironmentState|null;
 load():Promise<Object3D>;active?():boolean;changed():void;
},factory=createScannedRegionalShrubs,borrow=borrowScannedShrubSource){
 const object=new Group();object.name='Ealdholt scanned undergrowth owner';object.userData.iwsdkPreviewBounds='exclude';
 const stats={status:'loading-source',error:'',ownershipEpoch:0,sourceTextureBytes:0,sourceGeometryBytes:0,derivativeBudgetBytes:scannedShrubDerivativeBudget(options.native),detail:null as ScannedRegionalShrubs['stats']|null};
 let disposed=false,layout:RegionalWorldLayout|null=null,owner:ScannedRegionalShrubs|null=null,ready=false,preparationRequested=false;
 function changed(){if(disposed)return;if(owner){stats.status=!layout?'awaiting-layout':!preparationRequested?'awaiting-preparation':owner.stats.status;const next=stats.status==='ready';if(next!==ready){ready=next;stats.ownershipEpoch++;}}options.changed();}
 function prepare(){if(!owner||!layout||disposed||preparationRequested)return;if(options.active&&!options.active()){stats.status='awaiting-preparation';return;}preparationRequested=true;void Promise.resolve(owner.prepare(layout)).then(changed).catch(cause=>{if(disposed)return;stats.status='fallback';stats.error=String(cause);options.changed();});}
 function dispose(){if(disposed)return;disposed=true;options.signal.removeEventListener('abort',dispose);owner?.dispose();object.removeFromParent();object.clear();stats.status='disposed';}
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 if(!disposed)void Promise.resolve().then(()=>{
  if(disposed)throw Error('Scanned source owner retired before import.');
  options.signal.throwIfAborted();return options.load();
 }).then(root=>{
  if(disposed)return;const source=borrow(root,options.native);if(!source)throw Error('Scanned shrub source/PBR/contact metrics do not match the pinned derivative.');
  owner=factory({...options,source,changed});object.add(owner.object);stats.detail=owner.stats;stats.sourceTextureBytes=source.textureBytes;stats.sourceGeometryBytes=source.geometryBytes;
  stats.status='awaiting-layout';prepare();changed();
 }).catch(cause=>{if(!disposed){stats.status='fallback';stats.error=String(cause);options.changed();}});
 return{object,stats,service:prepare,setLayout(next:RegionalWorldLayout){if(disposed||layout)return;layout=next;prepare();},owns(id:number){return !disposed&&!!owner?.owns(id);},
  update(camera:Camera,now:number,quality:'low'|'medium'|'high',reducedMotion:boolean,visible:ReadonlySet<number>){return !disposed&&(owner?.update(camera,now,quality,reducedMotion,visible)??false);},dispose};
}
