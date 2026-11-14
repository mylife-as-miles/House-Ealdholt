/** Renderer-independent, clock-driven action permissions and authored contacts.
 * Independently implemented in TypeScript; MIT reference mechanisms and their
 * exclusions are documented in COMBAT_REFERENCE_ADAPTATIONS.md. A denied action
 * never cancels a previous action or spends stamina. No damage/death is decided here. */
export interface CharacterContactWindow {
  readonly id:string; readonly opensAt:number; readonly closesAt:number;
}
export interface CharacterActionSpec {
  readonly id:string; readonly staminaCost:number; readonly windupSeconds:number;
  readonly activeSeconds:number; readonly recoverySeconds:number; readonly cooldownSeconds:number;
  readonly windows:readonly CharacterContactWindow[];
}
export interface CharacterActionState {
  readonly ownerId:string; readonly atSeconds:number; readonly capacity:number;
  readonly staminaAnchor:number; readonly staminaAnchorSeconds:number;
  readonly regenPerSecond:number; readonly regenDelaySeconds:number;
  readonly active:{readonly spec:CharacterActionSpec;readonly beganAt:number;
    readonly claims:readonly {readonly windowId:string;readonly targetId:string}[]}|null;
  readonly cooldowns:readonly {readonly actionId:string;readonly until:number}[];
  readonly interruption:{readonly actionId:string;readonly atSeconds:number;readonly reason:'stagger'|'safety'|'cancelled'}|null;
}
export type CharacterActionPhase='idle'|'windup'|'active'|'recovery';
const validTime=(n:number)=>Number.isFinite(n)&&n>=0;
const identifier=(s:string)=>typeof s==='string'&&s.length>0&&s.length<=256&&s.trim()===s&&!/[\u0000-\u001f\u007f]/u.test(s);
function requireTime(state:CharacterActionState,atSeconds:number):void {
  if(!validTime(atSeconds)||atSeconds<state.atSeconds)throw Error('Action time must be finite, nonnegative and monotonic.');
}
function validSpec(spec:CharacterActionSpec):boolean {
  const total=spec.windupSeconds+spec.activeSeconds+spec.recoverySeconds;
  return identifier(spec.id)&&[spec.staminaCost,spec.windupSeconds,spec.activeSeconds,spec.recoverySeconds,spec.cooldownSeconds,total].every(validTime)
    &&total>0&&spec.windows.length<=64&&new Set(spec.windows.map(w=>w.id)).size===spec.windows.length
    &&spec.windows.every(w=>identifier(w.id)&&validTime(w.opensAt)&&validTime(w.closesAt)&&w.closesAt>=w.opensAt&&w.closesAt<=total);
}
export function createCharacterActionState(ownerId:string,atSeconds=0,options:{capacity?:number;regenPerSecond?:number;regenDelaySeconds?:number}={}):CharacterActionState {
  const capacity=options.capacity??100,regenPerSecond=options.regenPerSecond??25,regenDelaySeconds=options.regenDelaySeconds??0.75;
  if(!identifier(ownerId)||![atSeconds,capacity,regenPerSecond,regenDelaySeconds].every(validTime))throw Error('Invalid action owner, time or stamina configuration.');
  return {ownerId,atSeconds,capacity,staminaAnchor:capacity,staminaAnchorSeconds:atSeconds,regenPerSecond,regenDelaySeconds,active:null,cooldowns:[],interruption:null};
}
/** Computed from a fixed spending anchor, so frame subdivision never changes regeneration. */
export function characterStaminaAt(state:CharacterActionState,atSeconds:number):number {
  requireTime(state,atSeconds);
  return Math.min(state.capacity,state.staminaAnchor+Math.max(0,atSeconds-state.staminaAnchorSeconds-state.regenDelaySeconds)*state.regenPerSecond);
}
export function characterActionPhase(state:CharacterActionState,atSeconds:number):CharacterActionPhase {
  requireTime(state,atSeconds);if(!state.active)return 'idle';
  const elapsed=atSeconds-state.active.beganAt,spec=state.active.spec;
  return elapsed<spec.windupSeconds?'windup':elapsed<spec.windupSeconds+spec.activeSeconds?'active'
    :elapsed<spec.windupSeconds+spec.activeSeconds+spec.recoverySeconds?'recovery':'idle';
}
export function advanceCharacterAction(state:CharacterActionState,atSeconds:number):CharacterActionState {
  requireTime(state,atSeconds);
  return {...state,atSeconds,active:characterActionPhase(state,atSeconds)==='idle'?null:state.active,
    cooldowns:state.cooldowns.filter(c=>c.until>atSeconds)};
}
export function beginCharacterAction(state:CharacterActionState,spec:CharacterActionSpec,atSeconds:number):
  {accepted:boolean;reason:'started'|'busy'|'stamina'|'cooldown'|'invalid';state:CharacterActionState} {
  requireTime(state,atSeconds);
  // Preflight everything against the old state: an unaffordable dodge/guard
  // cannot clear an attack, mutate a timer or consume stamina for free.
  if(!validSpec(spec)||!Number.isFinite(atSeconds+spec.cooldownSeconds+spec.windupSeconds+spec.activeSeconds+spec.recoverySeconds))return {accepted:false,reason:'invalid',state};
  if(characterActionPhase(state,atSeconds)!=='idle')return {accepted:false,reason:'busy',state};
  if(state.cooldowns.some(c=>c.actionId===spec.id&&c.until>atSeconds))return {accepted:false,reason:'cooldown',state};
  const stamina=characterStaminaAt(state,atSeconds);
  if(stamina<spec.staminaCost)return {accepted:false,reason:'stamina',state};
  const cooldowns=state.cooldowns.filter(c=>c.until>atSeconds&&c.actionId!==spec.id);
  if(spec.cooldownSeconds>0&&cooldowns.length>=32)return {accepted:false,reason:'invalid',state};
  if(spec.cooldownSeconds>0)cooldowns.push({actionId:spec.id,until:atSeconds+spec.cooldownSeconds});
  return {accepted:true,reason:'started',state:{...state,atSeconds,
    // A zero-cost presentation must not reset a real stamina regeneration delay.
    staminaAnchor:spec.staminaCost>0?stamina-spec.staminaCost:state.staminaAnchor,
    staminaAnchorSeconds:spec.staminaCost>0?atSeconds:state.staminaAnchorSeconds,
    active:{spec:{...spec,windows:spec.windows.map(w=>({...w}))},beganAt:atSeconds,claims:[]},cooldowns,interruption:null}};
}
/** Explicit interruption cancels all outstanding contact windows, never resurrects them. */
export function interruptCharacterAction(state:CharacterActionState,atSeconds:number,reason:'stagger'|'safety'|'cancelled'):CharacterActionState {
  requireTime(state,atSeconds);
  return {...advanceCharacterAction(state,atSeconds),active:null,
    interruption:state.active?{actionId:state.active.spec.id,atSeconds,reason}:state.interruption};
}
/** One target per authored swing interval. Distinct parry and thrust windows may
 * hit the same opponent, but repeated traces during either window cannot. */
export function claimCharacterContact(state:CharacterActionState,input:{windowId:string;targetId:string;atSeconds:number}):
  {accepted:boolean;reason:'claimed'|'inactive'|'outside-window'|'duplicate'|'invalid';state:CharacterActionState} {
  requireTime(state,input.atSeconds);
  if(!identifier(input.windowId)||!identifier(input.targetId)||input.targetId===state.ownerId)return {accepted:false,reason:'invalid',state};
  const active=state.active;if(!active)return {accepted:false,reason:'inactive',state};
  const interval=active.spec.windows.find(w=>w.id===input.windowId),offset=input.atSeconds-active.beganAt;
  if(!interval||offset<interval.opensAt-1e-6||offset>interval.closesAt+1e-6)return {accepted:false,reason:'outside-window',state};
  if(active.claims.some(c=>c.windowId===input.windowId&&c.targetId===input.targetId))return {accepted:false,reason:'duplicate',state};
  if(active.claims.length>=256)return {accepted:false,reason:'invalid',state};
  return {accepted:true,reason:'claimed',state:{...state,atSeconds:input.atSeconds,active:{...active,claims:[...active.claims,{windowId:input.windowId,targetId:input.targetId}]}}};
}
/** Horizontal facing eligibility. Zero-length/unknown vectors cannot fabricate a block. */
export function characterGuardFaces(input:{position:{x:number;z:number};forward:{x:number;z:number};incomingFrom:{x:number;z:number};halfAngleRadians?:number}):boolean {
  const {position:p,forward:f,incomingFrom:a}=input,angle=input.halfAngleRadians??Math.PI/3;
  if(![p.x,p.z,f.x,f.z,a.x,a.z,angle].every(Number.isFinite)||angle<0||angle>Math.PI)return false;
  const dx=a.x-p.x,dz=a.z-p.z,denominator=Math.hypot(dx,dz)*Math.hypot(f.x,f.z);
  return denominator>1e-9&&(dx*f.x+dz*f.z)/denominator>=Math.cos(angle)-1e-12;
}
