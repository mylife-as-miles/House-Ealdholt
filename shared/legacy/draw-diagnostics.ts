/** Trace-only submission accounting. No renderer, scene, camera or simulation
 * is created or driven here; the actual adapter brackets its normal main pass. */
export const LEGACY_DRAW_DIAGNOSTICS_VERSION='main-pass-draws-v1';
export interface LegacyDrawCounts {calls:number;triangles:number;lines:number;points:number}
export type LegacyDrawCategory='authored-terrain'|'authored-architecture'|'authored-vegetation'|'authored-props'|'authored-water'|'residents'|'regional-near-vegetation'|'regional-far-vegetation'|'regional-grass'|'regional-rocks'|'regional-landmarks'|'regional-terrain'|'regional-water'|'local-woodland'|'local-undergrowth'|'sky-clouds'|'effects'|'unknown';
export interface LegacyDrawCategoryCounts extends LegacyDrawCounts {category:LegacyDrawCategory}
export interface LegacyDrawObjectCounts extends LegacyDrawCounts {name:string;owner:string;material:string;category:LegacyDrawCategory|'mixed'}
export interface LegacyMainPassDrawReport {
 version:typeof LEGACY_DRAW_DIAGNOSTICS_VERSION;status:'waiting'|'ready'|'unsupported'|'invalid'|'disposed';reason:string;
 scope:'exact main scene/camera and default framebuffer; submission counts only';frame:number;pass:number;
 counts:LegacyDrawCounts;excluded:LegacyDrawCounts;renderer:LegacyDrawCounts;baseline:LegacyDrawCounts;unattributed:LegacyDrawCounts;reconciled:boolean;
 categories:LegacyDrawCategoryCounts[];topObjects:LegacyDrawObjectCounts[];unknownNames:string[];unknownObjects:number;
 excludedReasons:{offscreen:number;otherScene:number;otherCamera:number;foreignReceiver:number};classificationErrors:number;hookRestored:boolean;
}

/** Structural public WebGL contract: importing this module never pulls either
 * app's Three runtime into the other app, or touches browser globals. */
export interface LegacyDrawObject {name?:string;type?:string;parent?:LegacyDrawObject|null;userData?:Record<string,unknown>}
export interface LegacyDrawRenderer {
 renderBufferDirect?:unknown;getRenderTarget():unknown;
 info:{autoReset:boolean;render:LegacyDrawCounts&{frame:number}};
}
type DirectDraw=(this:unknown,camera:unknown,scene:unknown,geometry:unknown,material:unknown,object:LegacyDrawObject,group:unknown)=>unknown;
export interface LegacyMainPassDrawDiagnostics {readonly report:LegacyMainPassDrawReport;begin():void;end(completed?:boolean):void;dispose():void}
const FIELDS=['calls','triangles','lines','points'] as const;
const CATEGORIES:readonly LegacyDrawCategory[]=['authored-terrain','authored-architecture','authored-vegetation','authored-props','authored-water','residents','regional-near-vegetation','regional-far-vegetation','regional-grass','regional-rocks','regional-landmarks','regional-terrain','regional-water','local-woodland','local-undergrowth','sky-clouds','effects','unknown'];
const empty=():LegacyDrawCounts=>({calls:0,triangles:0,lines:0,points:0});
const clear=(counts:LegacyDrawCounts)=>{for(const key of FIELDS)counts[key]=0;};
const owners=new WeakMap<LegacyDrawRenderer,DirectDraw>();
const EMPTY_DATA:Record<string,unknown>=Object.freeze({});
const TOP_LIMIT=24,UNKNOWN_LIMIT=8;

export function unsupportedLegacyMainPassDrawReport(reason:string):LegacyMainPassDrawReport {
 return{version:LEGACY_DRAW_DIAGNOSTICS_VERSION,status:'unsupported',reason,scope:'exact main scene/camera and default framebuffer; submission counts only',frame:-1,pass:0,counts:empty(),excluded:empty(),renderer:empty(),baseline:empty(),unattributed:empty(),reconciled:false,categories:CATEGORIES.map(category=>({category,...empty()})),topObjects:[],unknownNames:[],unknownObjects:0,excludedReasons:{offscreen:0,otherScene:0,otherCamera:0,foreignReceiver:0},classificationErrors:0,hookRestored:false};
}
interface Label extends LegacyDrawCounts {
 drawSequence:number;unknownSequence:number;drawCategory:LegacyDrawCategory|'mixed';drawOwner:string;drawMaterial:string;category:LegacyDrawCategory;generated:LegacyDrawCategory|null;
 fallback:LegacyDrawCategory;name:string;owner:string;material:string;
 parent:LegacyDrawObject|null|undefined;rawName:string;kind:unknown;tags:number;farSurface:unknown;parentRevision:number;revision:number;resolving:boolean;
}
const TAGS=['crownfallRegionalGroundcover','crownfallRegionalRocks','crownfallRegionalLandmarks','crownfallRegionalHorizon','crownfallAtmosphere','crownfallRiverWoodland','crownfallFarWoodland','crownfallWoodlandUnderstory','crownfallRiverMargin','crownfallWorldRain','crownfallRiverValley','crownfallOuterContinuation'] as const;
const newLabel=():Label=>({drawSequence:-1,unknownSequence:-1,drawCategory:'unknown',drawOwner:'',drawMaterial:'',category:'unknown',generated:null,fallback:'unknown',name:'',owner:'',material:'',parent:undefined,rawName:'',kind:undefined,tags:-1,farSurface:undefined,parentRevision:-1,revision:0,resolving:false,...empty()});
function objectHint(name:string,data:Record<string,unknown>):LegacyDrawCategory|null {
 if(data.crownfallRegionalGroundcover)return'regional-grass';
 if(data.crownfallRegionalRocks)return'regional-rocks';
 if(data.crownfallRegionalLandmarks)return'regional-landmarks';
 if(data.crownfallRegionalHorizon)return'regional-terrain';
 if(data.crownfallAtmosphere||/^(?:House Ealdholt Atmosphere|Ealdholt cloud coverage dome)$/.test(name))return'sky-clouds';
 if(/^Ealdholt resident actors$|^Resident placement /.test(name))return'residents';
 if(/^Ealdholt bounded authored near woodland$|^Authored regional tree |^Regional detail /.test(name))return'regional-near-vegetation';
 if(/^Regional L3 /.test(name))return'regional-far-vegetation';
 if(data.crownfallRiverWoodland)return'local-woodland';
 if(data.crownfallFarWoodland)return'regional-far-vegetation';
 if(data.crownfallWoodlandUnderstory||data.crownfallRiverMargin||/^Ealdholt.*(?:understory|river margin)/i.test(name))return'local-undergrowth';
 if(data.crownfallWorldRain||/^(?:Crownfall world rain|Ealdholt local rain|Ealdholt rain sheet|Ealdholt bandit raid|Ealdholt village fire|House Ealdholt Village Fire|House Ealdholt Procedural Hearths)/i.test(name))return'effects';
 const far=data.crownfallFarSurround as {ownedSurface?:unknown}|undefined;
 if(far?.ownedSurface==='woodland')return'regional-far-vegetation';
 if(far?.ownedSurface==='mainland')return'regional-terrain';
 if(far&&/sea|river|water/.test(String(far.ownedSurface)))return'regional-water';
 return null;
}
function sourceHint(name:string,data:Record<string,unknown>):LegacyDrawCategory|null {
 const kind=(data.crownfallElderbloom as {kind?:unknown}|undefined)?.kind;
 if(kind==='terrain'||/^LandscapeComponent_\d/.test(name))return'authored-terrain';
 if(kind==='architecture'||kind==='building'||kind==='structure')return'authored-architecture';
 if(kind==='water')return'authored-water';
 if(kind==='tree'||kind==='vegetation'||kind==='groundcover'||/^SM_BlackAlder_|^S_Grass_Clumps_/i.test(name))return'authored-vegetation';
 if(kind==='rock'||kind==='debris'||kind==='prop')return'authored-props';
 return null;
}

/** Called only by a DEV+query gated adapter. The public draw wrapper observes
 * actual renderer.info increments, not geometry estimates. Bracketing never
 * calls render, advances time, changes visibility/materials or owns callbacks. */
export function createLegacyMainPassDrawDiagnostics(options:{renderer:LegacyDrawRenderer;scene:object;camera:object;enabled:boolean;observeMainDraw?:(material:unknown,object:LegacyDrawObject)=>void}):LegacyMainPassDrawDiagnostics {
 const {renderer}=options,report=unsupportedLegacyMainPassDrawReport('trace-disabled');
 let active=false,disposed=false,sequence=0,startFrame=-1,autoReset=true,directDepth=0,original:DirectDraw|undefined,descriptor:PropertyDescriptor|undefined;
 const delta=empty(),baseline=empty(),top:Label[]=[],slots:LegacyDrawObjectCounts[]=Array.from({length:TOP_LIMIT},()=>({name:'',owner:'',material:'',category:'unknown',...empty()}));
 let labels=new WeakMap<LegacyDrawObject,Label>();
 const categories=new Map(report.categories.map(row=>[row.category,row]));
 const validCounts=()=>{const info=renderer.info.render;for(const key of FIELDS)if(!Number.isFinite(info[key])||info[key]<0)return false;return true;};
 const invalidate=(reason:string)=>{report.status='invalid';if(!report.reason)report.reason=reason;report.reconciled=false;};
 function labelFor(object:LegacyDrawObject,depth=0):Label {
  let entry=labels.get(object);if(!entry){entry=newLabel();labels.set(object,entry);}
  if(depth>=64||entry.resolving){report.classificationErrors++;entry.category='unknown';return entry;}entry.resolving=true;
  try{
   const parent=object.parent?labelFor(object.parent,depth+1):undefined,name=typeof object.name==='string'?object.name:'',data=object.userData??EMPTY_DATA;
   const kind=(data.crownfallElderbloom as {kind?:unknown}|undefined)?.kind,farSurface=(data.crownfallFarSurround as {ownedSurface?:unknown}|undefined)?.ownedSurface;
   let tags=0;for(let i=0;i<TAGS.length;i++)if(data[TAGS[i]])tags|=1<<i;
   if(entry.tags===tags&&entry.kind===kind&&entry.rawName===name&&entry.parent===object.parent&&entry.farSurface===farSurface&&entry.parentRevision===(parent?.revision??0))return entry;
   const own=objectHint(name,data),source=sourceHint(name,data);
   entry.parent=object.parent;entry.rawName=name;entry.tags=tags;entry.kind=kind;entry.farSurface=farSurface;entry.parentRevision=parent?.revision??0;entry.revision++;
   entry.generated=own??parent?.generated??null;entry.fallback=source??parent?.fallback??'unknown';
   // The valley/continuation parent owns land and water alike; the actual child
   // role distinguishes it from an authored Landscape or the source pond.
   if(!entry.generated&&(data.crownfallRiverValley||data.crownfallOuterContinuation))entry.generated='regional-terrain';
   if(parent?.generated==='regional-terrain'&&entry.fallback==='authored-water')entry.generated='regional-water';
   entry.category=entry.generated??entry.fallback;
   entry.name=(name||object.type||'unnamed').slice(0,160);entry.owner=(own?name:parent?.owner||'').slice(0,160);
   if((data.crownfallRiverValley||data.crownfallOuterContinuation||source&&!entry.generated)&&name)entry.owner=name.slice(0,160);
   return entry;
  }finally{entry.resolving=false;}
 }
 function rank(entry:Label){
  let old=top.indexOf(entry);if(old>=0){for(let i=old;i<top.length-1;i++)top[i]=top[i+1];top.pop();}
  let at=0;while(at<top.length&&(top[at].triangles>entry.triangles||top[at].triangles===entry.triangles&&top[at].calls>=entry.calls))at++;
  if(at>=TOP_LIMIT)return;const length=Math.min(TOP_LIMIT,top.length+1);for(let i=length-1;i>at;i--)top[i]=top[i-1];top[at]=entry;
 }
 function measure(receiver:unknown,camera:unknown,scene:unknown,material:unknown,object:LegacyDrawObject,offscreen:boolean,calls:number,triangles:number,lines:number,points:number){
  if(!validCounts()){invalidate('invalid-renderer-counters');return;}
  delta.calls=renderer.info.render.calls-calls;delta.triangles=renderer.info.render.triangles-triangles;delta.lines=renderer.info.render.lines-lines;delta.points=renderer.info.render.points-points;
  for(const key of FIELDS)if(delta[key]<0){invalidate('renderer-counters-reset-within-draw');return;}
  if(renderer.info.render.frame!==startFrame+1){invalidate('nested-or-unexpected-renderer-frame');return;}
  const reason=receiver!==renderer?'foreignReceiver':offscreen?'offscreen':scene!==options.scene?'otherScene':camera!==options.camera?'otherCamera':null;
  if(reason){for(const key of FIELDS)report.excluded[key]+=delta[key];report.excludedReasons[reason]+=delta.calls;return;}
  for(const key of FIELDS)report.counts[key]+=delta[key];if(!delta.calls)return;
  if(report.status!=='invalid')options.observeMainDraw?.(material,object);
  let entry:Label;
  try{entry=labelFor(object);}catch{report.classificationErrors++;entry=labels.get(object)??newLabel();entry.category='unknown';entry.name='unreadable-object';}
  const row=categories.get(entry.category)!;for(const key of FIELDS)row[key]+=delta[key];
  if(material&&typeof material==='object'&&'name' in material&&typeof material.name==='string')entry.material=material.name.slice(0,160);
  if(entry.drawSequence!==sequence){entry.drawSequence=sequence;clear(entry);entry.drawCategory=entry.category;entry.drawOwner=entry.owner;entry.drawMaterial=entry.material;}
  else{if(entry.drawCategory!==entry.category)entry.drawCategory='mixed';if(entry.drawOwner!==entry.owner)entry.drawOwner='multiple owners this pass';if(entry.drawMaterial!==entry.material)entry.drawMaterial='multiple materials this pass';}
  if(entry.category==='unknown'&&entry.unknownSequence!==sequence){entry.unknownSequence=sequence;report.unknownObjects++;if(report.unknownNames.length<UNKNOWN_LIMIT)report.unknownNames.push(entry.name);}
  for(const key of FIELDS)entry[key]+=delta[key];rank(entry);
 }
 const wrapper:DirectDraw=function(camera,scene,geometry,material,object,group){
  if(!active||disposed)return original!.call(this,camera,scene,geometry,material,object,group);
  let measurable=false,offscreen=false,calls=0,triangles=0,lines=0,points=0,threw=true;
  if(directDepth)invalidate('reentrant-public-render-hook');directDepth++;
  try{if(validCounts()){const info=renderer.info.render;calls=info.calls;triangles=info.triangles;lines=info.lines;points=info.points;offscreen=renderer.getRenderTarget()!==null;measurable=true;}else invalidate('invalid-renderer-counters');}catch{invalidate('unreadable-renderer-counters');}
  try{const result=original!.call(this,camera,scene,geometry,material,object,group);threw=false;return result;}finally{directDepth--;if(threw)invalidate('public-draw-threw');if(measurable)try{measure(this,camera,scene,material,object,offscreen,calls,triangles,lines,points);}catch{invalidate('draw-measurement-failed');}}
 };
 const handle:LegacyMainPassDrawDiagnostics={report,begin(){
  if(disposed||!original)return;
  if(active){invalidate('overlapping-main-pass-brackets');return;}active=true;sequence++;report.pass=sequence;report.status='waiting';report.reason='';report.reconciled=false;report.frame=-1;
  for(const counts of [report.counts,report.excluded,report.renderer,report.baseline,report.unattributed])clear(counts);for(const row of report.categories)clear(row);
  report.topObjects.length=report.unknownNames.length=top.length=0;report.unknownObjects=report.classificationErrors=0;for(const key of ['offscreen','otherScene','otherCamera','foreignReceiver'] as const)report.excludedReasons[key]=0;
  try{startFrame=renderer.info.render.frame;autoReset=renderer.info.autoReset;for(const key of FIELDS)baseline[key]=renderer.info.render[key];if(!validCounts()||!Number.isInteger(startFrame))invalidate('invalid-renderer-counters');}catch{invalidate('unreadable-renderer-counters');}
 },end(completed=true){
  if(disposed||!original||!active)return;active=false;
  if(!completed)invalidate('main-render-did-not-complete');
  try{
   report.frame=renderer.info.render.frame;
   if(report.frame!==startFrame+1)invalidate('nested-or-unexpected-renderer-frame');
   for(const key of FIELDS){report.renderer[key]=renderer.info.render[key];report.baseline[key]=autoReset?0:baseline[key];report.unattributed[key]=report.renderer[key]-report.baseline[key]-report.counts[key]-report.excluded[key];}
   for(const key of FIELDS){let sum=0;for(const row of report.categories)sum+=row[key];if(Math.abs(sum-report.counts[key])>1e-6)invalidate('category-accounting-gap');}
   report.reconciled=report.status!=='invalid'&&validCounts()&&FIELDS.every(key=>Math.abs(report.unattributed[key])<1e-6);
   if(!report.reconciled)invalidate('unattributed-renderer-submissions');else report.status='ready';
   for(let i=0;i<top.length;i++){const entry=top[i],slot=slots[i];slot.name=entry.name;slot.owner=entry.drawOwner;slot.material=entry.drawMaterial;slot.category=entry.drawCategory;for(const key of FIELDS)slot[key]=entry[key];report.topObjects[i]=slot;}
  }catch{invalidate('unreadable-final-renderer-counters');}
 },dispose(){
  if(disposed)return;disposed=true;active=false;
  if(original){try{if(renderer.renderBufferDirect===wrapper){if(descriptor)Object.defineProperty(renderer,'renderBufferDirect',descriptor);else Reflect.deleteProperty(renderer,'renderBufferDirect');report.hookRestored=renderer.renderBufferDirect===original;}else report.reason='another-render-hook-retained';}catch{report.reason='render-hook-restore-failed';}if(owners.get(renderer)===wrapper)owners.delete(renderer);}
  labels=new WeakMap();top.length=0;report.status='disposed';
 }};
 if(!options.enabled)return handle;
 try{
  if(typeof renderer.renderBufferDirect!=='function'||typeof renderer.getRenderTarget!=='function'||typeof renderer.info?.autoReset!=='boolean'||!validCounts()){report.reason='public-webgl-draw-counters-unavailable';return handle;}
  if(owners.has(renderer)){report.reason='public-draw-hook-already-owned';return handle;}
  descriptor=Object.getOwnPropertyDescriptor(renderer,'renderBufferDirect');let defining=descriptor,prototype=Object.getPrototypeOf(renderer);
  while(!defining&&prototype){defining=Object.getOwnPropertyDescriptor(prototype,'renderBufferDirect');prototype=Object.getPrototypeOf(prototype);}
  if(defining&&(!('value' in defining)||!defining.writable)){report.reason='public-draw-hook-not-writable';return handle;}
  const target=renderer.getRenderTarget();if(target!==null&&typeof target!=='object'){report.reason='public-render-target-contract-unavailable';return handle;}
  original=renderer.renderBufferDirect as DirectDraw;
  if(!Reflect.set(renderer,'renderBufferDirect',wrapper)||renderer.renderBufferDirect!==wrapper){original=undefined;report.reason='public-draw-hook-not-writable';return handle;}
  owners.set(renderer,wrapper);report.status='waiting';report.reason='awaiting-normal-main-render';
 }catch{original=undefined;report.reason='public-webgl-draw-counters-unavailable';}
 return handle;
}
