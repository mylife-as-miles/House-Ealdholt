import {FOREST01_DENSITY_LOD} from './forest01-density-lod';
/** One canonical source-family/actor key. Counts and credits include pending,
 * live and retiring wrappers; no new role may spend a GPU-fenced old slot. */
export const REALISTIC_TREE_SOURCE_TRIANGLES={pp3:9883,forest01:58411}as const;
export type RealisticTreeBudgetFamily=keyof typeof REALISTIC_TREE_SOURCE_TRIANGLES;
export type RealisticTreeDetailRole='full'|'density';
export interface RealisticTreeBudgetLease {retire():void;release():void}
const nativePlan={pp3:3,forest01:0}as const,pp3Plan={pp3:8,forest01:0}as const,mixedPlan={pp3:2,forest01:1}as const;
export function realisticTreeDetailPlan(native:boolean,forestNear:boolean){return native?nativePlan:forestNear?mixedPlan:pp3Plan;}
/** Includes all allowed levels, including after rapid retargeting, plus both
 * global cards for every one of128 actors. Fades do not reduce draw cost. */
export const REALISTIC_DENSITY_ALL_LEVEL_BOUND=124766+2*21308+37337+512;
export function createRealisticTreeBudget(native=false,densityEnabled=false){
 densityEnabled=densityEnabled&&!native;
 const maximumSourceTriangles=densityEnabled?112766:(native?3:8)*REALISTIC_TREE_SOURCE_TRIANGLES.pp3;
 const entries=new Map<string,{family:RealisticTreeBudgetFamily;role:RealisticTreeDetailRole;triangles:number;retiring:boolean}>();
 const stats={maximumSourceTriangles,maximumTransitionTriangles:densityEnabled?225532:maximumSourceTriangles*2,chargedSourceTriangles:0,leases:0,retiring:0,forest01:0,pp3:0,forest01Density:0};
 return{stats,acquire(family:RealisticTreeBudgetFamily,id:number,role:RealisticTreeDetailRole='full'):RealisticTreeBudgetLease|null{
  if(!Number.isSafeInteger(id)||id<0||!Object.prototype.hasOwnProperty.call(REALISTIC_TREE_SOURCE_TRIANGLES,family)||!['full','density'].includes(role)||role==='density'&&family!=='forest01')throw Error('Unqualified complete-tree detail lease.');
  if(role==='full'&&stats.forest01Density>0)return null; // Retire optional preparation before any new primary allocation.
  const key=family+':'+id,triangles=role==='density'?FOREST01_DENSITY_LOD.triangles:REALISTIC_TREE_SOURCE_TRIANGLES[family];
  // The role maxima are independent of the weighted credit. In particular,
  // full+5PP3 cannot slip through the enlarged mixed source budget.
  if(entries.has(key)||native&&family==='forest01'||role==='density'&&(!densityEnabled||stats.forest01Density>=1||stats.forest01!==1||stats.pp3>2||stats.retiring>0)||family==='forest01'&&role==='full'&&(stats.forest01>=1||stats.pp3>2)||family==='pp3'&&stats.pp3>=(native?3:stats.forest01+stats.forest01Density>0?2:8)||stats.chargedSourceTriangles+triangles>maximumSourceTriangles)return null;
  const entry={family,role,triangles,retiring:false};entries.set(key,entry);stats.chargedSourceTriangles+=triangles;stats.leases++;
  const counter=role==='density'?'forest01Density':family;stats[counter]++;let released=false;
  return{retire(){if(released||entry.retiring)return;entry.retiring=true;stats.retiring++;},release(){if(released)return;released=true;entries.delete(key);stats.chargedSourceTriangles-=triangles;stats.leases--;stats[counter]--;if(entry.retiring)stats.retiring--;}};
 }};
}
