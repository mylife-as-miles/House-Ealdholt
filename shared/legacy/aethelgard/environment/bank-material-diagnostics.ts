/** Developer-only observation of a program already used by an accepted main
 * draw. No render, GL state write, material mutation or shader compilation. */
export const BANK_MATERIAL_DIAGNOSTICS_VERSION='submitted-bank-program-v1';
export interface BankMaterialEvidence{
 material:string;name:string;drawCalls:number;frame:number;linked:boolean;version:string;versionMatches:boolean;
 bankMarker:boolean;stageKnots:number;expectedStageKnots:number;stageCountMatches:boolean;
 mapEnabled:boolean;stageUniformOwned:boolean;floorOwned:boolean;floorGuard:boolean;weather:boolean;
 bankAuthoredMarker:boolean;bankLookupVersion:string;bankLookupVersionMatches:boolean;bankSourceKnots:number;expectedBankSourceKnots:number;
 bankPackedVectors:number;expectedBankPackedVectors:number;bankPackedCountMatches:boolean;bankUniformOwned:boolean;bankUniformSignature:string;expectedBankUniformSignature:string;
}
export interface BankMaterialReport{version:typeof BANK_MATERIAL_DIAGNOSTICS_VERSION;status:'waiting'|'ready'|'unsupported'|'disposed';reason:string;frame:number;drawCalls:number;truncated:number;materials:BankMaterialEvidence[]}
type Renderer={getContext():unknown;info:{render:{frame:number}}};
type Material={uuid?:string;name?:string;version?:number;userData?:Record<string,unknown>};
type ProgramEvidence={linked:boolean;artVersion:string;bankMarker:boolean;stageKnots:number;mapEnabled:boolean;floorGuard:boolean;weather:boolean;lastOwner:number;stageLocations:(WebGLUniformLocation|null)[];stageValues:Float32Array;
 bankAuthoredMarker:boolean;bankLookupVersion:string;bankSourceKnots:number;bankPackedVectors:number;bankLocations:(WebGLUniformLocation|null)[];bankValues:Float32Array};
/** Small diagnostic identity only, not a persistent/security cache key. */
export function bankStageDiagnosticSignature(data:Float32Array):string{let hash=2166136261;for(const byte of new Uint8Array(data.buffer,data.byteOffset,data.byteLength))hash=Math.imul(hash^byte,16777619);return(hash>>>0).toString(16).padStart(8,'0');}
const define=(source:string,name:string)=>new RegExp('^\\s*#define\\s+'+name+'(?:\\s|$)','m').test(source);
export function unsupportedBankMaterialReport(reason:string):BankMaterialReport{return{version:BANK_MATERIAL_DIAGNOSTICS_VERSION,status:'unsupported',reason,frame:-1,drawCalls:0,truncated:0,materials:[]};}
export function createBankMaterialDrawDiagnostics(renderer:Renderer){
 const report=unsupportedBankMaterialReport('awaiting-actual-main-draw');report.status='waiting';
 const row=():BankMaterialEvidence=>({material:'',name:'',drawCalls:0,frame:-1,linked:false,version:'',versionMatches:false,bankMarker:false,stageKnots:0,expectedStageKnots:0,stageCountMatches:false,mapEnabled:false,stageUniformOwned:false,floorOwned:false,floorGuard:false,weather:false,
  bankAuthoredMarker:false,bankLookupVersion:'',bankLookupVersionMatches:false,bankSourceKnots:0,expectedBankSourceKnots:0,bankPackedVectors:0,expectedBankPackedVectors:0,bankPackedCountMatches:false,bankUniformOwned:false,bankUniformSignature:'',expectedBankUniformSignature:''});
 const slots=Array.from({length:8},row);let pass=0,disposed=false,nextOwner=0;
 let programs=new WeakMap<WebGLProgram,ProgramEvidence>(),materials=new WeakMap<object,{pass:number;slot:number;program:WebGLProgram}>();
 let uniformOwners=new WeakMap<object,{token:number;program:WebGLProgram;version:number|undefined;signature:unknown;matched:boolean;bankSignature:unknown;actualBankSignature:string;bankMatched:boolean}>();
 function evidence(gl:WebGL2RenderingContext,program:WebGLProgram):ProgramEvidence{
  const previous=programs.get(program);if(previous)return previous;
  let source='';for(const shader of gl.getAttachedShaders(program)??[])if(gl.getShaderParameter(shader,gl.SHADER_TYPE)===gl.FRAGMENT_SHADER)source=gl.getShaderSource(shader)??'';
  let stageKnots=0,bankPackedVectors=0;const active=gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS)as number;
  for(let i=0;i<active;i++){const uniform=gl.getActiveUniform(program,i);if(uniform?.name==='uEaldholtValleyWaterStages[0]')stageKnots=uniform.size;if(uniform?.name==='uEaldholtValleyBankKnots[0]')bankPackedVectors=uniform.size;}
  const bankMarker=define(source,'CROWNFALL_BANK_SOURCE_CONTACT'),mapEnabled=define(source,'USE_MAP');
  const bounded=stageKnots>=2&&stageKnots<=129;
  const bankAuthoredMarker=define(source,'CROWNFALL_BANK_AUTHORED_KNOTS'),bankSourceKnots=Number(source.match(/^\s*#define CROWNFALL_BANK_AUTHORED_KNOT_COUNT\s+(\d+)\b/m)?.[1]??0),bankLookupVersion=(source.match(/^\s*\/\/ (:authored-bank-knots-v\d+)\s*$/m)?.[1]??'').slice(0,48);
  const bankBounded=bankAuthoredMarker&&bankSourceKnots>=2&&bankSourceKnots<=129&&bankPackedVectors===Math.ceil(bankSourceKnots*3/4);
  const found={linked:gl.getProgramParameter(program,gl.LINK_STATUS)===true,artVersion:source.match(/\/\/ (grounded-bank-earth-grass-rock-[a-z0-9-]+)/)?.[1]??'',bankMarker,stageKnots,mapEnabled,
   floorGuard:bankMarker&&mapEnabled&&source.includes('forestCover*=1.-ealdholtContactReach*max(ealdholtEdge.y,.65*smoothstep(.3,.7,ealdholtFine)*ealdholtMeadowW);'),weather:define(source,'CROWNFALL_WORLD_ENVIRONMENT'),lastOwner:-1};
  const cached={...found,bankAuthoredMarker,bankSourceKnots,bankPackedVectors,bankLookupVersion,
   stageLocations:bounded?Array.from({length:stageKnots},(_,i)=>gl.getUniformLocation(program,`uEaldholtValleyWaterStages[${i}]`)):[],stageValues:new Float32Array(bounded?stageKnots*2:0),
   bankLocations:bankBounded?Array.from({length:bankPackedVectors},(_,i)=>gl.getUniformLocation(program,`uEaldholtValleyBankKnots[${i}]`)):[],bankValues:new Float32Array(bankBounded?bankPackedVectors*4:0)};
  programs.set(program,cached);return cached;
 }
 return{report,begin(){if(disposed)return;pass++;report.status='waiting';report.reason='no-bank-material-submitted';report.frame=-1;report.drawCalls=report.truncated=0;report.materials.length=0;},observe(material:unknown){
  if(disposed||!material||typeof material!=='object')return;
  const m=material as Material,meta=m.userData?.crownfallRiverSurface as{version?:unknown;channelStageKnots?:unknown;channelStageSignature?:unknown;channelBankKnots?:unknown;channelBankSignature?:unknown;channelBankLookupVersion?:unknown}|undefined;if(!meta)return;
  report.drawCalls++;report.frame=renderer.info.render.frame;
  try{const gl=renderer.getContext()as WebGL2RenderingContext;
   if(!gl||typeof gl.getParameter!=='function'||typeof gl.getAttachedShaders!=='function'||typeof gl.getActiveUniform!=='function')throw Error('missing-public-program-contract');
   const program=gl.getParameter(gl.CURRENT_PROGRAM)as WebGLProgram|null;if(!program)throw Error('no-bound-main-draw-program');
   const previous=materials.get(material);let slot:number;
   if(previous?.pass===pass&&previous.program===program)slot=previous.slot;else{slot=report.materials.length;if(slot>=slots.length){report.truncated++;return;}materials.set(material,{pass,slot,program});report.materials.push(slots[slot]);slots[slot].drawCalls=0;}
   const current=slots[slot],compiled=evidence(gl,program),version=typeof meta.version==='string'?meta.version.slice(0,96):'';
   let owner=uniformOwners.get(material);if(!owner){owner={token:++nextOwner,program,version:m.version,signature:meta.channelStageSignature,matched:false,bankSignature:meta.channelBankSignature,actualBankSignature:'',bankMatched:false};uniformOwners.set(material,owner);}
   if(compiled.lastOwner!==owner.token||owner.program!==program||owner.version!==m.version||owner.signature!==meta.channelStageSignature||owner.bankSignature!==meta.channelBankSignature){
    // WebGL getUniform reads one vec2 array element, not the entire array.
    let complete=compiled.stageValues.length>0;for(let i=0;i<compiled.stageLocations.length;i++){const location=compiled.stageLocations[i],pair=location?gl.getUniform(program,location):null;if(!(pair instanceof Float32Array)||pair.length!==2){complete=false;break;}compiled.stageValues.set(pair,i*2);}
    let bankComplete=compiled.bankValues.length>0;for(let i=0;i<compiled.bankLocations.length;i++){const location=compiled.bankLocations[i],tuple=location?gl.getUniform(program,location):null;if(!(tuple instanceof Float32Array)||tuple.length!==4){bankComplete=false;break;}compiled.bankValues.set(tuple,i*4);}
    owner.program=program;owner.version=m.version;owner.signature=meta.channelStageSignature;owner.matched=complete&&typeof meta.channelStageSignature==='string'&&bankStageDiagnosticSignature(compiled.stageValues)===meta.channelStageSignature;
    owner.bankSignature=meta.channelBankSignature;owner.actualBankSignature=bankComplete?bankStageDiagnosticSignature(compiled.bankValues):'';owner.bankMatched=bankComplete&&owner.actualBankSignature===meta.channelBankSignature;compiled.lastOwner=owner.token;
   }
   const expectedBankSourceKnots=typeof meta.channelBankKnots==='number'&&Number.isSafeInteger(meta.channelBankKnots)&&meta.channelBankKnots>=2&&meta.channelBankKnots<=129?meta.channelBankKnots:0,expectedBankPackedVectors=expectedBankSourceKnots?Math.ceil(expectedBankSourceKnots*3/4):0;
   const bankPackedCountMatches=compiled.bankSourceKnots===expectedBankSourceKnots&&expectedBankSourceKnots>=2&&compiled.bankPackedVectors===expectedBankPackedVectors;
   const bankLookupVersionMatches=typeof meta.channelBankLookupVersion==='string'&&!!compiled.bankLookupVersion&&compiled.bankLookupVersion===meta.channelBankLookupVersion;
   Object.assign(current,{material:(m.uuid??'unknown').slice(0,64),name:(m.name??'').slice(0,160),frame:report.frame,linked:compiled.linked,version,versionMatches:!!version&&compiled.artVersion===version,bankMarker:compiled.bankMarker,
    stageKnots:compiled.stageKnots,expectedStageKnots:Number.isSafeInteger(meta.channelStageKnots)?meta.channelStageKnots:0,stageCountMatches:compiled.stageKnots>=2&&compiled.stageKnots===meta.channelStageKnots,
    mapEnabled:compiled.mapEnabled,stageUniformOwned:owner.matched,floorOwned:typeof m.userData?.crownfallFloorOwner==='string',floorGuard:compiled.floorGuard,weather:compiled.weather,
    bankAuthoredMarker:compiled.bankAuthoredMarker,bankLookupVersion:compiled.bankLookupVersion,bankLookupVersionMatches,bankSourceKnots:compiled.bankSourceKnots,expectedBankSourceKnots,bankPackedVectors:compiled.bankPackedVectors,expectedBankPackedVectors,bankPackedCountMatches,
    bankUniformOwned:compiled.bankAuthoredMarker&&bankLookupVersionMatches&&bankPackedCountMatches&&owner.bankMatched,bankUniformSignature:owner.actualBankSignature,expectedBankUniformSignature:typeof meta.channelBankSignature==='string'&&/^[a-f0-9]{8}$/.test(meta.channelBankSignature)?meta.channelBankSignature:''});current.drawCalls++;
   report.status='ready';report.reason='actual-default-framebuffer-main-pass-program';
  }catch{report.status='unsupported';report.reason='public-program-evidence-unavailable';}
 },dispose(){if(disposed)return;disposed=true;programs=new WeakMap();materials=new WeakMap();uniformOwners=new WeakMap();report.materials.length=0;report.status='disposed';}};
}
