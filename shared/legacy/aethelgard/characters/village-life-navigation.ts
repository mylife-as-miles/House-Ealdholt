/** Persistent source-bound journeys. This module owns physical route progress,
 * never resident memories, work completion or rendered meshes. A route-arrival
 * label is analytic navigation evidence, not a witnessed event or an indoor pose. */
import type { VillageLifeIntent } from './village-life';
import {EALDHOLT_VILLAGE_POPULATION} from './village-population';
import {baseVillageWorkplaceRouteSite,scopedVillageWorkplaceRouteSite,findVillageWorkplaceRoute,validateVillageSiteWorkplaceRoutes,parseVillageWorkplaceRouteRef,type VillageWorkplaceRouteRef,type VillageWorkplaceRoutePermit} from './village-workplace-routes';
import {parseVillageEmergencyNeutralReturnRef,baseVillageEmergencyNeutralReturnSite,scopedVillageEmergencyNeutralReturnSite,findVillageEmergencyNeutralReturn,type VillageEmergencyNeutralReturnRef} from './village-emergency-neutral-return';
import {scopedVillageEmergencyTraversalSite,baseVillageEmergencyTraversalSite,findVillageEmergencyTraversal,type VillageEmergencyTraversalRef,type VillageEmergencyLocomotionPermit,type VillageSiteEmergencyTraversal} from './village-emergency-traversal';
import {scopedVillageEmergencyRefugeSite,baseVillageEmergencyRefugeSite,parseVillageEmergencyRefugeRef,pinVillageEmergencyRefugeRef,validateVillageSiteEmergencyRefuges,type VillageEmergencyRefugeRef,type VillageEmergencyRefugePermit} from './village-emergency-refuges';
import { resolveVillageSiteEndpoint, sameVillageSiteNavigationAllocation,type VillageSiteRoute, type VillageSiteLayout, type VillageSitePath,
  type VillageSitePoint, type VillageSitePatrolPlan,type VillageSiteNavigationAllocation } from './village-site';
import {sourcePolylinePosition,sourceRouteTrajectory,stationarySourceTrajectory,futureSourceRouteTrajectory,firstSourceTrajectoryContact,sourceTrajectoryPositionAt,stopSourceTrajectory,type SourceTrajectory} from './source-trajectory';

export type VillageLifeJourneyStatus = 'unmapped' | 'waiting' | 'travelling' | 'at-threshold' | 'indoors';
export type VillageLifeArrivalEvidence = 'none' | 'initial-placement' | 'certified-route-arrival';
export interface VillageLifePatrolCursor {
  readonly planId: string; readonly issuedAbsoluteMinute: number;
  readonly waypointIndex: number; readonly completedLegs: number;
  readonly dwellUntilAbsoluteMinute: number | null;
}
/** A blocked duty may choose another already-authored lane entrance. This is
 * not a patrol/circuit cursor; real certified arrival must happen first. */
export interface VillageLifePatrolEntry {
  readonly planId:string;readonly issuedAbsoluteMinute:number;
  readonly blockedSinceAbsoluteMinute:number;
  /** Null while waiting; set only when the certified entry route really starts. */
  readonly waypointIndex:number|null;
}
export interface VillageLifeJourney {
  readonly residentId: string;
  readonly targetPlaceId: string;
  readonly activityKey: string;
  readonly priority: number;
  readonly indoor: boolean;
  readonly issuedAbsoluteMinute: number;
  readonly status: VillageLifeJourneyStatus;
  readonly reason: string | null;
  /** Last reached measured exterior threshold. Never a fabricated interior coordinate. */
  readonly anchorPlaceId: string | null;
  readonly anchorPosition: VillageSitePoint | null;
  readonly originPlaceId: string | null;
  readonly destinationPlaceId: string | null;
  readonly pendingTargetPlaceId: string | null;
  readonly startedAbsoluteMinute: number | null;
  readonly lastAbsoluteMinute: number;
  /** Distance on the original origin-to-destination path, even while reversing. */
  readonly progressMetres: number;
  readonly direction: 1 | -1;
  /** Absolute segment anchor avoids incremental frame-dependent roundoff. */
  readonly directionStartedAbsoluteMinute:number|null;
  readonly progressAtDirectionStart:number;
  readonly route: VillageSitePath | null;
  readonly sourceSha256: string | null;
  readonly sourceSiteIdentity: string | null;
  readonly arrivalEvidence: VillageLifeArrivalEvidence;
  readonly arrivedAtAbsoluteMinute: number | null;
  /** Waiting to leave an interior never exposes a body on its doorstep. */
  readonly inside: boolean;
  /** Present only for an explicitly source-authored, actually reached patrol. */
  readonly patrol?: VillageLifePatrolCursor;
  readonly patrolEntry?:VillageLifePatrolEntry;
  /** Exact carry-only source route capability, never an ordinary graph edge. */
  readonly emergencyTraversal?:VillageEmergencyTraversalRef;
  /** Exact evacuation topology, retained until real return to the original graph. */
  readonly emergencyRefuge?:VillageEmergencyRefugeRef;
  /** Ordinary source-qualified private branch, retained through real return. */
  readonly workplaceRoute?:VillageWorkplaceRouteRef;
  /** Measured neutral pose at an actually reached original stand after carrying. */
  readonly neutralReturn?:VillageEmergencyNeutralReturnRef;
}
export interface VillageLifeNavigationState {
  readonly schemaVersion: 1;
  readonly absoluteMinute: number;
  readonly siteIdentity: string | null;
  readonly sourceSha256: string | null;
  readonly profile: VillageSiteLayout['profile'] | null;
  /** Optional new source-allocation identity; absent in unchanged legacy saves. */
  readonly navigationRevision?: string;
  readonly navigationAllocation?: VillageSiteNavigationAllocation;
  readonly residents: readonly VillageLifeJourney[];
}
export interface VillageLifeInitialPlace {readonly residentId:string;readonly placeId:string;readonly indoor:boolean}
/** Source-frame moving/fallen architecture or an authored fire exclusion.
 * A dated onset makes off-screen catch-up use the same interruption instant. */
export interface VillageLifeNavigationObstacle {
  readonly id:string;readonly sourceSha256:string;readonly profile:VillageSiteLayout['profile'];
  readonly activeFromAbsoluteMinute:number;
  /** Fire permits only a certified monotonically outward escape; fallen solids never do. */
  readonly kind?:'fire'|'solid';
  /** A source-qualified operating tool zone excludes its actual operator only. */
  readonly exceptResidentId?:string;
  readonly bounds:{readonly min:VillageSitePoint;readonly max:VillageSitePoint};
}
export interface VillageLifeNavigationInput {
  readonly absoluteMinute: number;
  readonly site: VillageSiteLayout | null;
  /** Prefer the verified site-artifact SHA; never a URL or a renderer identity. */
  readonly siteIdentity?: string;
  readonly intents: readonly VillageLifeIntent[];
  readonly metresPerWorldMinute: number;
  readonly allowInitialPlacement?: boolean;
  /** Physical source bootstrap, not a historical journey or life mutation. If
   * supplied, every unlocated resident requires their measured home threshold. */
  readonly initialPlaces?:readonly VillageLifeInitialPlace[];
  /** A world-level incompatible/mixed allocation may advance time and intent,
   * never bind another source, change profile or move a physical cursor. */
  readonly sourceAllocationHold?:true;
  readonly dynamicObstacles?:readonly VillageLifeNavigationObstacle[];
  readonly locomotionPermits?:readonly VillageEmergencyLocomotionPermit[];
  readonly refugePermits?:readonly VillageEmergencyRefugePermit[];
  readonly workplacePermits?:readonly VillageWorkplaceRoutePermit[];
}
export interface VillageLifeNavigationSample {
  readonly residentId: string;
  readonly status: VillageLifeJourneyStatus;
  readonly position: VillageSitePoint | null;
  readonly yawRadians: number;
  readonly moving: boolean;
  readonly placeId: string | null;
  readonly targetPlaceId: string;
  readonly reason: string | null;
  readonly arrivalEvidence: VillageLifeArrivalEvidence;
  readonly arrivedAtAbsoluteMinute: number | null;
}
const EPS = 1e-7;
const PATROL_ENTRY_WAIT_MINUTES=3;
// Shared by all queued departures in one authoritative update. Exhaustion keeps
// the existing reservation hold; observation frequency cannot buy extra work.
const ALTERNATE_EDGE_BUDGET=512,ALTERNATE_SEGMENT_BUDGET=20000;
type GraphLeg={from:string;next:string;route:VillageSiteRoute;reverse:boolean};
interface AlternateBudget {edges:number;segments:number}
const STATE_KEYS = ['schemaVersion','absoluteMinute','siteIdentity','sourceSha256','profile','residents'];
const JOURNEY_KEYS = ['residentId','targetPlaceId','activityKey','priority','indoor','issuedAbsoluteMinute','status','reason','anchorPlaceId','anchorPosition','originPlaceId','destinationPlaceId','pendingTargetPlaceId','startedAbsoluteMinute','lastAbsoluteMinute','progressMetres','direction','directionStartedAbsoluteMinute','progressAtDirectionStart','route','sourceSha256','sourceSiteIdentity','arrivalEvidence','arrivedAtAbsoluteMinute','inside'];
function exact(value: any, keys: readonly string[]): boolean { return !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.prototype.hasOwnProperty.call(value,key)); }
const trusted = new WeakSet<object>();
const stateSites = new WeakMap<object, VillageSiteLayout | null>();
const routeChecks = new WeakMap<VillageSiteLayout, WeakMap<object, Map<string,boolean>>>();
const paths = new WeakMap<VillageSiteLayout, Map<string, VillageSitePath | null>>();
const graphs = new WeakMap<VillageSiteLayout, Map<string, readonly GraphLeg[]>>();
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,191}$/u.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);
const minute = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const point = (v: unknown): v is VillageSitePoint => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const samePoint = (a: VillageSitePoint, b: VillageSitePoint): boolean => a.every((n, i) => Math.abs(n - b[i]) <= EPS);
const distance = (a: VillageSitePoint, b: VillageSitePoint) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const length = (points: readonly VillageSitePoint[]) => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function own(value: unknown, budget = { left: 100000 }, depth = 0): any {
  if (--budget.left < 0 || depth > 24) throw Error('Navigation save exceeds its data budget.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) throw Error('Navigation save needs finite plain data.');
  if (Array.isArray(value)) {
    if (Object.getOwnPropertyNames(value).some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/u.test(k))) throw Error('Navigation arrays may not carry properties.');
    const rows: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !('value' in descriptor)) throw Error('Navigation save cannot contain sparse arrays or accessors.');
      rows.push(own(descriptor.value, budget, depth+1));
    }
    return rows;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Navigation save needs plain records.');
  const out: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor) || ['__proto__','constructor','prototype'].includes(key)) throw Error('Navigation save cannot contain accessors or prototype fields.');
    out[key] = own(descriptor.value, budget, depth+1);
  }
  return out;
}
function finish(state: VillageLifeNavigationState): VillageLifeNavigationState { freeze(state); trusted.add(state); return state; }
export function createVillageLifeNavigation(absoluteMinute: number): VillageLifeNavigationState {
  if (!minute(absoluteMinute)) throw Error('Navigation needs a finite authoritative world minute.');
  return finish({ schemaVersion: 1, absoluteMinute, siteIdentity: null, sourceSha256: null, profile: null, residents: [] });
}
export function parseVillageLifeNavigation(value: unknown): VillageLifeNavigationState {
  if (value && typeof value === 'object' && trusted.has(value)) return value as VillageLifeNavigationState;
  if (typeof value === 'string') {
    if (value.length > 2*1024*1024) throw Error('Navigation save exceeds 2 MiB.');
    value = JSON.parse(value);
  }
  const s = own(value);
  if (!(exact(s,STATE_KEYS)||exact(s,[...STATE_KEYS,'navigationRevision'])||exact(s,[...STATE_KEYS,'navigationRevision','navigationAllocation'])) || s.schemaVersion !== 1 || !minute(s.absoluteMinute) || !Array.isArray(s.residents) || s.residents.length > 1000
    || ![null,'desktop','quest'].includes(s.profile) || s.sourceSha256 !== null && !hash(s.sourceSha256)
    || s.siteIdentity !== null && (typeof s.siteIdentity !== 'string' || !s.siteIdentity || s.siteIdentity.length > 512)) throw Error('Invalid navigation snapshot.');
  if(s.navigationRevision!==undefined&&(!hash(s.navigationRevision)||s.sourceSha256===null))throw Error('Navigation allocation revision needs a bound source identity.');
  if(s.navigationAllocation!==undefined){const p=s.navigationAllocation;
    if(!exact(p,['generation','desktopRevision','questRevision'])||!hash(p.generation)||!hash(p.desktopRevision)||!hash(p.questRevision)
      ||s.navigationRevision!==(s.profile==='desktop'?p.desktopRevision:p.questRevision))throw Error('Invalid saved navigation profile pair.');
  }
  if ((s.sourceSha256 === null) !== (s.profile === null) || (s.sourceSha256 === null) !== (s.siteIdentity === null)) throw Error('Navigation source identity is incomplete.');
  const seen = new Set<string>();
  for (const r of s.residents) {
    if (!(exact(r,JOURNEY_KEYS)||exact(r,[...JOURNEY_KEYS,'patrol'])||exact(r,[...JOURNEY_KEYS,'patrolEntry'])||exact(r,[...JOURNEY_KEYS,'emergencyTraversal'])||exact(r,[...JOURNEY_KEYS,'emergencyRefuge'])||exact(r,[...JOURNEY_KEYS,'workplaceRoute'])||exact(r,[...JOURNEY_KEYS,'neutralReturn'])) || !id(r.residentId) || seen.has(r.residentId) || !id(r.targetPlaceId) || !id(r.activityKey)
      || !Number.isFinite(r.priority) || r.priority < 0 || r.priority > 100000 || typeof r.indoor !== 'boolean' || typeof r.inside !== 'boolean'
      || !minute(r.issuedAbsoluteMinute) || r.issuedAbsoluteMinute > s.absoluteMinute + EPS || !minute(r.lastAbsoluteMinute)
      || Math.abs(r.lastAbsoluteMinute-s.absoluteMinute)>EPS || !['unmapped','waiting','travelling','at-threshold','indoors'].includes(r.status)
      || r.reason !== null && (typeof r.reason !== 'string' || r.reason.length > 192)
      || !Number.isFinite(r.progressMetres) || r.progressMetres < 0 || ![1,-1].includes(r.direction)
      || !Number.isFinite(r.progressAtDirectionStart)||r.progressAtDirectionStart<0
      ||r.directionStartedAbsoluteMinute!==null&&(!minute(r.directionStartedAbsoluteMinute)||r.directionStartedAbsoluteMinute>s.absoluteMinute+EPS)
      || !['none','initial-placement','certified-route-arrival'].includes(r.arrivalEvidence)
      || r.startedAbsoluteMinute !== null && (!minute(r.startedAbsoluteMinute) || r.startedAbsoluteMinute>s.absoluteMinute+EPS)
      || r.arrivedAtAbsoluteMinute !== null && (!minute(r.arrivedAtAbsoluteMinute) || r.arrivedAtAbsoluteMinute>s.absoluteMinute+EPS)) throw Error('Invalid saved resident journey.');
    if(r.workplaceRoute!==undefined){parseVillageWorkplaceRouteRef(r.workplaceRoute);if(r.emergencyRefuge||r.emergencyTraversal||r.patrol||r.patrolEntry||r.sourceSha256===null)throw Error('Invalid saved ordinary source workplace route.');}
    if(r.neutralReturn!==undefined){parseVillageEmergencyNeutralReturnRef(r.neutralReturn);if(r.route||r.emergencyRefuge||r.emergencyTraversal||r.workplaceRoute||r.patrol||r.patrolEntry||r.sourceSha256===null||r.arrivalEvidence!=='certified-route-arrival'||r.anchorPlaceId!==r.neutralReturn.placeId||r.inside||r.progressMetres!==0||r.progressAtDirectionStart!==0||r.directionStartedAbsoluteMinute!==null)throw Error('Invalid saved source neutral return stand.');}
    if(r.emergencyRefuge!==undefined){parseVillageEmergencyRefugeRef(r.emergencyRefuge);if(!r.emergencyRefuge.certificates||r.patrol||r.patrolEntry||r.emergencyTraversal||r.sourceSha256===null)throw Error('Invalid saved source refuge journey.');}
    if(r.emergencyTraversal!==undefined){const t=r.emergencyTraversal;
      if(!exact(t,['id','certificateSha256','requiredClip'])||!id(t.id)||!hash(t.certificateSha256)||t.requiredClip!=='carry_bucket_walk'||r.patrol||r.patrolEntry||r.sourceSha256===null)throw Error('Invalid saved clip-constrained source traversal.');
    }
    if (r.patrol !== undefined) {
      const p=r.patrol;
      if(!exact(p,['planId','issuedAbsoluteMinute','waypointIndex','completedLegs','dwellUntilAbsoluteMinute'])||!id(p.planId)
        ||r.activityKey!=='patrol'||r.inside||r.indoor||!minute(p.issuedAbsoluteMinute)||p.issuedAbsoluteMinute!==r.issuedAbsoluteMinute
        ||!Number.isSafeInteger(p.waypointIndex)||p.waypointIndex<0||p.waypointIndex>15
        ||!Number.isSafeInteger(p.completedLegs)||p.completedLegs<0
        ||p.dwellUntilAbsoluteMinute!==null&&(!minute(p.dwellUntilAbsoluteMinute)||r.route!==null||r.arrivedAtAbsoluteMinute===null
          ||p.dwellUntilAbsoluteMinute<r.arrivedAtAbsoluteMinute||p.dwellUntilAbsoluteMinute-r.arrivedAtAbsoluteMinute>10+EPS))throw Error('Invalid saved physical patrol cursor.');
    }
    if(r.patrolEntry!==undefined){
      const e=r.patrolEntry;
      if(!exact(e,['planId','issuedAbsoluteMinute','blockedSinceAbsoluteMinute','waypointIndex'])||!id(e.planId)||r.activityKey!=='patrol'||r.indoor
        ||!r.anchorPlaceId||!r.anchorPosition||r.sourceSha256===null
        ||!minute(e.issuedAbsoluteMinute)||e.issuedAbsoluteMinute!==r.issuedAbsoluteMinute
        ||!minute(e.blockedSinceAbsoluteMinute)||e.blockedSinceAbsoluteMinute<e.issuedAbsoluteMinute||e.blockedSinceAbsoluteMinute>s.absoluteMinute
        ||e.waypointIndex!==null&&(!Number.isSafeInteger(e.waypointIndex)||e.waypointIndex<0||e.waypointIndex>15)
        ||e.waypointIndex===null&&(r.route!==null||r.status!=='waiting')
        ||e.waypointIndex!==null&&(r.inside||r.direction!==1||!r.route&&r.arrivalEvidence!=='certified-route-arrival'))throw Error('Invalid saved patrol entry choice.');
    }
    seen.add(r.residentId);
    for (const key of ['anchorPlaceId','originPlaceId','destinationPlaceId','pendingTargetPlaceId']) if (r[key] !== null && !id(r[key])) throw Error('Invalid journey place identity.');
    if (r.anchorPosition !== null && !point(r.anchorPosition) || r.sourceSha256 !== null && !hash(r.sourceSha256)
      || r.sourceSiteIdentity !== null && (typeof r.sourceSiteIdentity !== 'string' || r.sourceSiteIdentity.length>512)) throw Error('Invalid journey source or position.');
    if ((r.sourceSha256===null)!==(r.sourceSiteIdentity===null) || (r.anchorPlaceId===null)!==(r.anchorPosition===null) || (r.anchorPlaceId!==null && r.sourceSha256===null)) throw Error('Journey anchor/source identity is incomplete.');
    if (r.sourceSha256 !== null && (r.sourceSha256!==s.sourceSha256 || r.sourceSiteIdentity!==s.siteIdentity)) throw Error('Journey belongs to another navigation source.');
    if (r.route !== null) {
      const route = r.route;
      if (!exact(route,['sourceGroundPolyline','capsuleBottomPolyline','lengthMetres','legs']) || !r.originPlaceId || !r.destinationPlaceId || r.sourceSha256===null || !Array.isArray(route.sourceGroundPolyline)
        || route.sourceGroundPolyline.length<2 || route.sourceGroundPolyline.length>4096 || !route.sourceGroundPolyline.every(point)
        || !Array.isArray(route.capsuleBottomPolyline) || route.capsuleBottomPolyline.length!==route.sourceGroundPolyline.length
        || !route.capsuleBottomPolyline.every(point) || !Array.isArray(route.legs) || route.legs.length>4096
        || route.legs.length===0 || route.legs.some((leg: any)=>!exact(leg,['id','reverse']) || !id(leg.id) || typeof leg.reverse!=='boolean')
        || !Number.isFinite(route.lengthMetres) || Math.abs(length(route.sourceGroundPolyline)-route.lengthMetres)>1e-5
        || r.progressMetres>route.lengthMetres+EPS) throw Error('Saved journey path is invalid.');
        if (r.directionStartedAbsoluteMinute===null||r.progressAtDirectionStart>r.route.lengthMetres+EPS||r.route.lengthMetres<=EPS || r.anchorPosition && !samePoint(r.anchorPosition,r.route.sourceGroundPolyline[0])) throw Error('Journey route must begin at its last reached threshold.');
    } else if (r.status==='travelling' || r.progressMetres!==0||r.progressAtDirectionStart!==0||r.directionStartedAbsoluteMinute!==null) throw Error('Travelling needs its saved certified path.');
    if (r.arrivalEvidence==='none' && r.arrivedAtAbsoluteMinute!==null || r.arrivalEvidence==='certified-route-arrival' && r.arrivedAtAbsoluteMinute===null || r.arrivalEvidence==='initial-placement' && r.arrivedAtAbsoluteMinute!==null) throw Error('Invalid navigation arrival provenance.');
    if (r.status==='indoors' && (!r.inside || !r.anchorPlaceId) || r.inside && !r.anchorPlaceId) throw Error('Indoor state needs a reached exterior threshold.');
  }
  return finish(s as VillageLifeNavigationState);
}
/** An index over the existing certified graph. Insertion order matches the
 * authority resolver, preserving identical route/leg order while avoiding an
 * O(visited nodes × all edges) scan on every resident's first journey. */
function routeFor(site: VillageSiteLayout, who: string, from: string, to: string): VillageSitePath | null {
  const origin=resolveVillageSiteEndpoint(site,from,who),destination=resolveVillageSiteEndpoint(site,to,who);
  if(!origin||!destination)return null;
  let cache=paths.get(site);if(!cache){cache=new Map();paths.set(site,cache);}
  const key=`${origin.id}\0${destination.id}`;if(cache.has(key))return cache.get(key)!;
  if(origin.id===destination.id){const path=freeze({sourceGroundPolyline:[origin.sourceGroundPoint],capsuleBottomPolyline:[origin.capsuleBottomPoint],lengthMetres:0,legs:[]});cache.set(key,path);return path;}
  let graph=graphs.get(site);if(!graph){graph=new Map();for(const route of site.routes){for(const [from,next,reverse]of [[route.from,route.to,false],[route.to,route.from,true]] as const){const legs=graph.get(from)??[];graph.set(from,[...legs,{from,next,route,reverse}]);}}graphs.set(site,graph);}
  const queue=[origin.id],seen=new Set(queue),previous=new Map<string,{from:string;next:string;route:VillageSiteRoute;reverse:boolean}>();
  for(let i=0;i<queue.length&&!seen.has(destination.id);i++)for(const leg of graph.get(queue[i])??[])if(!seen.has(leg.next)){seen.add(leg.next);previous.set(leg.next,leg);queue.push(leg.next);}
  if(!seen.has(destination.id)){cache.set(key,null);return null;}
  const legs: {from:string;next:string;route:VillageSiteRoute;reverse:boolean}[]=[];for(let at=destination.id;at!==origin.id;){const leg=previous.get(at)!;legs.unshift(leg);at=leg.from;}
  const path=joinGraphLegs(legs);cache.set(key,path);return path;
}
function joinGraphLegs(legs:readonly GraphLeg[]):VillageSitePath {
  const ground:VillageSitePoint[]=[],body:VillageSitePoint[]=[];
  for(const leg of legs){const g=leg.reverse?[...leg.route.sourceGroundPolyline].reverse():leg.route.sourceGroundPolyline,b=leg.reverse?[...leg.route.capsuleBottomPolyline].reverse():leg.route.capsuleBottomPolyline;ground.push(...(ground.length?g.slice(1):g));body.push(...(body.length?b.slice(1):b));}
  return freeze({sourceGroundPolyline:ground,capsuleBottomPolyline:body,lengthMetres:legs.reduce((n,l)=>n+l.route.lengthMetres,0),legs:legs.map(l=>({id:l.route.id,reverse:l.reverse}))});
}
function validSite(site: VillageSiteLayout): void {
  if (!Object.isFrozen(site) || !hash(site.sourceSha256) || !['desktop','quest'].includes(site.profile)
    || site.frame!=='source-root-local-metres' || !Number.isFinite(site.capsule.radius) || site.capsule.radius<=0) throw Error('Navigation needs the validated immutable source site.');
}
function currentPosition(r: VillageLifeJourney, site?: VillageSiteLayout): { position: VillageSitePoint | null; yawRadians: number } {
  if (!r.route) {
    // The reached route identities remain saved after arrival. Reconstruct its
    // tangent from the current certified source, never a free saved rotation.
    const arrived = site && r.arrivalEvidence==='certified-route-arrival' && r.originPlaceId && r.destinationPlaceId
      ? routeFor(site,r.residentId,r.originPlaceId,r.destinationPlaceId) : null;
    if(arrived && arrived.sourceGroundPolyline.length>1 && r.anchorPosition){
      const line=arrived.sourceGroundPolyline,last=line.length-1,a=r.direction===1?line[last-1]:line[1],b=r.direction===1?line[last]:line[0];
      if(samePoint(b,r.anchorPosition))return{position:r.anchorPosition,yawRadians:Math.atan2(b[0]-a[0],b[2]-a[2])};
    }
    return { position:r.anchorPosition, yawRadians:0 };
  }
  const points=r.route.sourceGroundPolyline, at=Math.min(r.progressMetres,r.route.lengthMetres);
  let traversed=0;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],span=distance(a,b);
    if (at<=traversed+span+EPS || i===points.length-1) {
      const t=span>EPS?Math.max(0,Math.min(1,(at-traversed)/span)):0;
      return { position:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],
        yawRadians:Math.atan2((b[0]-a[0])*r.direction,(b[2]-a[2])*r.direction) };
    }
    traversed+=span;
  }
  return {position:points[points.length-1],yawRadians:0};
}
function routeStillMatches(r: VillageLifeJourney, site: VillageSiteLayout): boolean {
  if(r.neutralReturn){const base=ordinaryJourneySite(site),proof=findVillageEmergencyNeutralReturn(base,r.neutralReturn,r.residentId),stand=resolveVillageSiteEndpoint(base,r.neutralReturn.placeId,r.residentId);
    return !!proof&&!!stand&&!r.route&&!r.inside&&r.status==='at-threshold'&&r.anchorPlaceId===r.neutralReturn.placeId&&!!r.anchorPosition&&stand.sourceGroundPoint.every((n,k)=>n===r.anchorPosition![k])
      &&r.arrivalEvidence==='certified-route-arrival'&&r.startedAbsoluteMinute!==null&&r.arrivedAtAbsoluteMinute!==null&&r.arrivedAtAbsoluteMinute>=r.startedAbsoluteMinute&&r.arrivedAtAbsoluteMinute<=r.lastAbsoluteMinute+EPS
      &&r.progressMetres===0&&r.progressAtDirectionStart===0&&r.directionStartedAbsoluteMinute===null;
  }
  if(r.workplaceRoute){const scoped=scopedVillageWorkplaceRouteSite(ordinaryJourneySite(site),r.workplaceRoute,r.residentId);if(!scoped)return false;if(scoped!==site)return routeStillMatches(r,scoped);}
  if(r.emergencyRefuge){const scoped=scopedVillageEmergencyRefugeSite(ordinaryJourneySite(site),r.emergencyRefuge,r.residentId);if(!scoped)return false;if(scoped!==site)return routeStillMatches(r,scoped);}
  if(r.emergencyTraversal){const scoped=scopedVillageEmergencyTraversalSite(ordinaryJourneySite(site),r.emergencyTraversal,r.residentId);if(!scoped)return false;if(scoped!==site)return routeStillMatches(r,scoped);}
  if(r.patrolEntry){
    const e=r.patrolEntry,plan=site.patrols?.find(plan=>plan.id===e.planId&&plan.residentId===r.residentId&&plan.routineTargetPlaceId===r.targetPlaceId);
    if(!site.navigationRevision||!site.navigationAllocation||!plan||r.activityKey!=='patrol'||r.indoor
      ||e.waypointIndex!==null&&(e.waypointIndex>=plan.waypoints.length||r.destinationPlaceId!==plan.waypoints[e.waypointIndex].placeId
        ||!r.route&&(r.anchorPlaceId!==plan.waypoints[e.waypointIndex].placeId||r.arrivedAtAbsoluteMinute===null
          ||r.arrivedAtAbsoluteMinute<e.blockedSinceAbsoluteMinute)))return false;
  }
  if(r.patrol){
    const p=r.patrol,plan=site.patrols?.find(plan=>plan.id===p.planId&&plan.residentId===r.residentId&&plan.routineTargetPlaceId===r.targetPlaceId);
    if(!site.navigationRevision||!site.navigationAllocation||!plan||p.waypointIndex>=plan.waypoints.length||r.inside||r.activityKey!=='patrol'
      ||r.route&&(r.direction!==1||r.destinationPlaceId!==plan.waypoints[p.waypointIndex].placeId)
      ||p.dwellUntilAbsoluteMinute!==null&&(r.anchorPlaceId!==plan.waypoints[p.waypointIndex].placeId
        ||r.arrivedAtAbsoluteMinute===null||Math.abs(p.dwellUntilAbsoluteMinute-r.arrivedAtAbsoluteMinute-plan.dwellWorldMinutes)>EPS))return false;
  }
  if (!r.route || !r.originPlaceId || !r.destinationPlaceId) return true;
  const path=routeFor(site,r.residentId,r.originPlaceId,r.destinationPlaceId);
  if(path===r.route)return true;
  if(!path)return false;
  let checks=routeChecks.get(site);if(!checks){checks=new WeakMap();routeChecks.set(site,checks);}
  const endpointKey=`${resolveVillageSiteEndpoint(site,r.originPlaceId,r.residentId)!.id}\0${resolveVillageSiteEndpoint(site,r.destinationPlaceId,r.residentId)!.id}`;
  let checked=checks.get(r.route);if(!checked){checked=new Map();checks.set(r.route,checked);}
  const existing=checked.get(endpointKey);if(existing!==undefined)return existing;
  // An alternate is still the exact concatenation of current certified graph
  // legs. Its unchanged first/last legs preserve both arrival tangents, including
  // a later reversal. Never reconstruct a different shortest path after reload.
  let matches=!!path&&JSON.stringify(path)===JSON.stringify(r.route);
  if(!matches&&path&&path.legs.length>=3&&r.route.legs.length<=128
    &&JSON.stringify(path.legs[0])===JSON.stringify(r.route.legs[0])
    &&JSON.stringify(path.legs[path.legs.length-1])===JSON.stringify(r.route.legs[r.route.legs.length-1])){
    const origin=resolveVillageSiteEndpoint(site,r.originPlaceId,r.residentId)!,destination=resolveVillageSiteEndpoint(site,r.destinationPlaceId,r.residentId)!;
    const graph=graphs.get(site)!,legs:GraphLeg[]=[],seen=new Set([origin.id]);let at=origin.id;
    for(const saved of r.route.legs){const leg=graph.get(at)?.find(l=>l.route.id===saved.id&&l.reverse===saved.reverse);
      if(!leg||seen.has(leg.next)){legs.length=0;break;}legs.push(leg);at=leg.next;seen.add(at);}
    matches=legs.length===r.route.legs.length&&at===destination.id&&JSON.stringify(joinGraphLegs(legs))===JSON.stringify(r.route);
  }
  checked.set(endpointKey,matches);return matches;
}
/** Presentation may only sample the current real saved source arc. This
 * grants neither arrival nor a world mutation; all original graph legs and
 * endpoint bindings are still checked before a renderer prepares a sampler. */
export function qualifiedVillageLifeVisualRoute(journey:VillageLifeJourney,site:VillageSiteLayout):boolean {
 return !!journey.route&&journey.status==='travelling'&&journey.reason===null&&!journey.inside
  &&journey.sourceSha256===site.sourceSha256&&!!journey.originPlaceId&&!!journey.destinationPlaceId
  &&routeStillMatches(journey,site);
}
export function matchesVillageLifeSourceJourney(journey:VillageLifeJourney,site:VillageSiteLayout):boolean {
 const scoped=villageLifeJourneyCollisionSite(journey,site);return !!scoped&&journey.sourceSha256===scoped.sourceSha256&&routeStillMatches(journey,scoped)
  &&(!journey.anchorPlaceId||!journey.anchorPosition||samePoint(resolveVillageSiteEndpoint(scoped,journey.anchorPlaceId,journey.residentId)?.sourceGroundPoint??[NaN,NaN,NaN],journey.anchorPosition));
}
function ordinaryJourneySite(site:VillageSiteLayout):VillageSiteLayout{return baseVillageWorkplaceRouteSite(baseVillageEmergencyTraversalSite(baseVillageEmergencyRefugeSite(baseVillageEmergencyNeutralReturnSite(site))));}
export function villageLifeJourneyCollisionSite(journey:VillageLifeJourney,site:VillageSiteLayout):VillageSiteLayout|null {
 const base=ordinaryJourneySite(site);if(Number(!!journey.emergencyRefuge)+Number(!!journey.emergencyTraversal)+Number(!!journey.workplaceRoute)+Number(!!journey.neutralReturn)>1)return null;
 return journey.neutralReturn?scopedVillageEmergencyNeutralReturnSite(base,journey.neutralReturn,journey.residentId):journey.workplaceRoute?scopedVillageWorkplaceRouteSite(base,journey.workplaceRoute,journey.residentId):journey.emergencyRefuge?scopedVillageEmergencyRefugeSite(base,journey.emergencyRefuge,journey.residentId):journey.emergencyTraversal?scopedVillageEmergencyTraversalSite(base,journey.emergencyTraversal,journey.residentId):base;
}
/** Presentation must play only this exact neutral clip/file set with zero fade;
 * this query grants neither work animation, travel, a lease nor work credit. */
export function qualifiedVillageNeutralReturnMotion(journey:VillageLifeJourney,site:VillageSiteLayout){return journey.neutralReturn&&matchesVillageLifeSourceJourney(journey,site)?findVillageEmergencyNeutralReturn(ordinaryJourneySite(site),journey.neutralReturn,journey.residentId):null;}
export function resolveVillageEmergencyRefugePath(site:VillageSiteLayout,residentId:string,from:string,to:string,ref:VillageEmergencyRefugeRef):VillageSitePath|null{const scoped=scopedVillageEmergencyRefugeSite(ordinaryJourneySite(site),ref,residentId);return scoped?routeFor(scoped,residentId,from,to):null;}
/** A peer gets its smaller body only while its exact active refuge source
 * capability is available. Every ordinary, foreign or unqualified peer keeps
 * the unchanged global collision proxy. */
export function villageLifeNavigationPeerBody(journey:VillageLifeJourney,site:VillageSiteLayout,identity:string|null):VillageSiteLayout['capsule']{
 if(journey.neutralReturn&&journey.sourceSiteIdentity===identity&&matchesVillageLifeSourceJourney(journey,site)){const scoped=scopedVillageEmergencyNeutralReturnSite(ordinaryJourneySite(site),journey.neutralReturn,journey.residentId);if(scoped)return scoped.capsule;}
 if(journey.emergencyTraversal&&journey.sourceSiteIdentity===identity&&matchesVillageLifeSourceJourney(journey,site)){const scoped=scopedVillageEmergencyTraversalSite(ordinaryJourneySite(site),journey.emergencyTraversal,journey.residentId);if(scoped)return scoped.capsule;}
 const base=ordinaryJourneySite(site);if(journey.workplaceRoute&&journey.sourceSha256===base.sourceSha256&&journey.sourceSiteIdentity===identity&&matchesVillageLifeSourceJourney(journey,base)){const scoped=scopedVillageWorkplaceRouteSite(base,journey.workplaceRoute,journey.residentId);if(scoped)return scoped.capsule;}if(journey.emergencyRefuge&&journey.sourceSha256===base.sourceSha256&&journey.sourceSiteIdentity===identity&&matchesVillageLifeSourceJourney(journey,base)){const scoped=scopedVillageEmergencyRefugeSite(base,journey.emergencyRefuge,journey.residentId);if(scoped)return scoped.capsule;}return base.capsule;
}
function recoveryWorkplaceStandClear(r:VillageLifeJourney,ref:VillageWorkplaceRouteRef,site:VillageSiteLayout,state:VillageLifeNavigationState,obstacles:readonly VillageLifeNavigationObstacle[]):boolean{
 const scoped=scopedVillageWorkplaceRouteSite(site,ref,r.residentId),p=r.anchorPosition;if(!scoped||!p||blockedStand(p,scoped,obstacles))return false;
 const own=stationarySourceTrajectory(p,state.absoluteMinute,Infinity);
 for(const peer of state.residents){if(peer.residentId===r.residentId||peer.inside)continue;const point=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!point)continue;
  if(peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,site))return false;
  const trajectory=peer.route?futureSourceRouteTrajectory(peer.route.sourceGroundPolyline,peer.progressMetres,peer.direction,state.absoluteMinute,1):stationarySourceTrajectory(point,state.absoluteMinute,Infinity);
  if(firstSourceTrajectoryContact(own,scoped.capsule,trajectory,villageLifeNavigationPeerBody(peer,site,state.siteIdentity))!==null)return false;
 }return true;
}
/** An unused carry permit may outlive a canceled duty while this person is
 * still logically inside the exact original home. This proves no journey,
 * exterior pose, return arrival, action or credit, and grants no locomotion. */
export function isUnusedVillageLifeEmergencyCarry(r:VillageLifeJourney,cap:VillageSiteEmergencyTraversal,homePlaceId:string):boolean{
 const ref=r.emergencyTraversal,person=EALDHOLT_VILLAGE_POPULATION.residents.find(p=>p.id===r.residentId),origin=cap.sourceGroundPolyline[0];
 return !!ref&&person?.homePlaceId===homePlaceId&&cap.residentId===r.residentId&&ref.id===cap.id&&ref.certificateSha256===cap.certificateSha256&&ref.requiredClip===cap.requiredClip
  &&r.sourceSha256===cap.sourceSha256&&!!r.sourceSiteIdentity?.startsWith(`${cap.profile}:${cap.sourceSha256}:`)
  &&r.inside&&['waiting','indoors'].includes(r.status)&&[null,'clip-locomotion-required','destination-unmapped','route-unmapped','destination-reserved','corridor-reserved','doorway-reserved','awaiting-decision-boundary'].includes(r.reason)
  &&r.anchorPlaceId===homePlaceId&&!!r.anchorPosition&&!!origin&&origin.every((n,k)=>n===r.anchorPosition![k])
  &&r.arrivalEvidence==='initial-placement'&&r.arrivedAtAbsoluteMinute===null&&r.startedAbsoluteMinute===null&&r.originPlaceId===null&&r.destinationPlaceId===null&&r.pendingTargetPlaceId===null
  &&!r.route&&r.progressMetres===0&&r.progressAtDirectionStart===0&&r.directionStartedAbsoluteMinute===null&&r.direction===1&&!r.patrol&&!r.patrolEntry&&!r.emergencyRefuge&&!r.workplaceRoute&&!r.neutralReturn;
}
export function ownsUnusedVillageLifeEmergencyCarry(value:VillageLifeNavigationState,site:VillageSiteLayout,residentId:string):boolean{
 const state=parseVillageLifeNavigation(value),base=ordinaryJourneySite(site);validSite(base);
 const r=state.residents.find(r=>r.residentId===residentId),person=EALDHOLT_VILLAGE_POPULATION.residents.find(p=>p.id===residentId),cap=r?.emergencyTraversal&&findVillageEmergencyTraversal(base,r.emergencyTraversal,residentId),home=person&&resolveVillageSiteEndpoint(base,person.homePlaceId,residentId);
 return !!r&&!!cap&&!!home&&state.profile===base.profile&&state.sourceSha256===base.sourceSha256&&state.navigationRevision===base.navigationRevision&&sameVillageSiteNavigationAllocation(state.navigationAllocation,base.navigationAllocation)
  &&r.sourceSha256===base.sourceSha256&&r.sourceSiteIdentity===state.siteIdentity&&Math.abs(r.lastAbsoluteMinute-state.absoluteMinute)<=EPS
  &&home.id===cap.fromAnchorId&&base.anchors.some(a=>a.id===home.id)&&!!r.anchorPosition&&home.sourceGroundPoint.every((n,k)=>n===r.anchorPosition![k])
  &&isUnusedVillageLifeEmergencyCarry(r,cap,person!.homePlaceId)&&matchesVillageLifeSourceJourney(r,base);
}
/** Return from a constrained carry only at a real original stand. Private
 * action anchors may be safe for this carry body yet unsafe for ordinary motion. */
function canReleaseEmergencyCarry(r:VillageLifeJourney,site:VillageSiteLayout,state:VillageLifeNavigationState,obstacles:readonly VillageLifeNavigationObstacle[],body:VillageSiteLayout['capsule']=ordinaryJourneySite(site).capsule):boolean{
 const base=ordinaryJourneySite(site),ref=r.emergencyTraversal,cap=ref&&findVillageEmergencyTraversal(base,ref,r.residentId),stand=r.anchorPlaceId?resolveVillageSiteEndpoint(base,r.anchorPlaceId,r.residentId):null;
 if(!cap||!stand||!base.anchors.some(a=>a.id===stand.id)||r.route||r.progressMetres!==0||r.progressAtDirectionStart!==0||r.directionStartedAbsoluteMinute!==null||!r.anchorPosition
  ||!stand.sourceGroundPoint.every((n,k)=>n===r.anchorPosition![k])||r.sourceSha256!==base.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity||state.profile!==base.profile||state.sourceSha256!==base.sourceSha256
  ||state.navigationRevision!==base.navigationRevision||!sameVillageSiteNavigationAllocation(state.navigationAllocation,base.navigationAllocation)||Math.abs(r.lastAbsoluteMinute-state.absoluteMinute)>EPS
  ||!['at-threshold','indoors'].includes(r.status)||r.reason!==null&&r.reason!=='clip-locomotion-required'||!matchesVillageLifeSourceJourney(r,base))return false;
 const initial=stand.id===cap.fromAnchorId&&r.arrivalEvidence==='initial-placement'&&r.startedAbsoluteMinute===null;
 if(!initial){
  const scope=scopedVillageEmergencyTraversalSite(base,ref!,r.residentId),path=scope&&r.originPlaceId&&r.destinationPlaceId?routeFor(scope,r.residentId,r.originPlaceId,r.destinationPlaceId):null;
  if(r.arrivalEvidence!=='certified-route-arrival'||r.arrivedAtAbsoluteMinute===null||r.startedAbsoluteMinute===null||r.arrivedAtAbsoluteMinute<r.startedAbsoluteMinute||r.arrivedAtAbsoluteMinute>state.absoluteMinute+EPS
   ||(r.direction===1?r.destinationPlaceId:r.originPlaceId)!==r.anchorPlaceId||!path||path.lengthMetres<=EPS
   ||!path.sourceGroundPolyline[r.direction===1?path.sourceGroundPolyline.length-1:0].every((n,k)=>n===r.anchorPosition![k]))return false;
 }
 if(blockedStand(stand.sourceGroundPoint,{...base,capsule:body},obstacles))return false;
 if(initial&&r.inside)return true;
 const own=stationarySourceTrajectory(stand.sourceGroundPoint,state.absoluteMinute,Infinity);
 for(const peer of state.residents){if(peer.residentId===r.residentId||peer.inside)continue;const point=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!point)continue;
  if(peer.sourceSha256!==base.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,base))return false;
  const trajectory=peer.route?futureSourceRouteTrajectory(peer.route.sourceGroundPolyline,peer.progressMetres,peer.direction,state.absoluteMinute,1):stationarySourceTrajectory(point,state.absoluteMinute,Infinity);
  if(firstSourceTrajectoryContact(own,body,trajectory,villageLifeNavigationPeerBody(peer,base,state.siteIdentity))!==null)return false;
 }return true;
}
function neutralReturnCanUseGlobalBody(r:VillageLifeJourney,site:VillageSiteLayout,state:VillageLifeNavigationState,obstacles:readonly VillageLifeNavigationObstacle[]):boolean{
 const base=ordinaryJourneySite(site);if(!qualifiedVillageNeutralReturnMotion(r,base)||!r.anchorPosition||blockedStand(r.anchorPosition,base,obstacles))return false;
 const own=stationarySourceTrajectory(r.anchorPosition,state.absoluteMinute,Infinity);
 for(const peer of state.residents){if(peer.residentId===r.residentId||peer.inside)continue;const p=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!p)continue;
  if(peer.sourceSha256!==base.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,base))return false;
  const trajectory=peer.route?futureSourceRouteTrajectory(peer.route.sourceGroundPolyline,peer.progressMetres,peer.direction,state.absoluteMinute,1):stationarySourceTrajectory(p,state.absoluteMinute,Infinity);
  if(firstSourceTrajectoryContact(own,base.capsule,trajectory,villageLifeNavigationPeerBody(peer,base,state.siteIdentity))!==null)return false;
 }return true;
}
interface PeerBodies {readonly stands:ReadonlyMap<string,VillageSiteLayout['capsule']>;readonly routes:Map<VillageSitePath,VillageSiteLayout['capsule']>;
 readonly temporalResidents:ReadonlySet<string>;readonly futures:Map<VillageSitePath,SourceTrajectory[]>;readonly now:number;readonly speed:number}
function temporalSourceJourney(r:VillageLifeJourney,site:VillageSiteLayout,identity:string|null):boolean{
 return (r.reason===null||!r.route&&['corridor-reserved','destination-reserved','doorway-reserved','awaiting-decision-boundary'].includes(r.reason??''))&&!!(r.emergencyRefuge||r.emergencyTraversal||r.workplaceRoute)&&r.sourceSha256===site.sourceSha256&&r.sourceSiteIdentity===identity&&matchesVillageLifeSourceJourney(r,site);
}
export function resolveVillageEmergencyTraversalPath(site:VillageSiteLayout,residentId:string,from:string,to:string,permit?:VillageEmergencyTraversalRef):VillageSitePath|null {
 const scoped=permit?scopedVillageEmergencyTraversalSite(site,permit,residentId):site;return scoped?routeFor(scoped,residentId,from,to):null;
}
function pointSegment(p: VillageSitePoint,a: VillageSitePoint,b: VillageSitePoint):number {
  const dx=b[0]-a[0],dz=b[2]-a[2],n=dx*dx+dz*dz,t=n>EPS?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[2]-a[2])*dz)/n)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[2]-a[2]-t*dz);
}
function segmentDistance(a:VillageSitePoint,b:VillageSitePoint,c:VillageSitePoint,d:VillageSitePoint):number {
  const cross=(p:VillageSitePoint,q:VillageSitePoint,r:VillageSitePoint)=>(q[0]-p[0])*(r[2]-p[2])-(q[2]-p[2])*(r[0]-p[0]);
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
}
function pathsConflict(a:Pick<VillageSitePath,'sourceGroundPolyline'>,b:Pick<VillageSitePath,'sourceGroundPolyline'>,radius:number,height:number,otherRadius=radius,otherHeight=height):boolean {
  for(let i=1;i<a.sourceGroundPolyline.length;i++)for(let j=1;j<b.sourceGroundPolyline.length;j++){
    const p=a.sourceGroundPolyline[i-1],q=a.sourceGroundPolyline[i],r=b.sourceGroundPolyline[j-1],s=b.sourceGroundPolyline[j];
    if(Math.min(p[1],q[1])<Math.max(r[1],s[1])+otherHeight&&Math.min(r[1],s[1])<Math.max(p[1],q[1])+height
      &&segmentDistance(p,q,r,s)<radius+otherRadius-EPS)return true;
  }
  return false;
}
/** Exact vertical cylinder vs a fire volume. Solid rubble deliberately keeps
 * its conservative square proxy; only fire uses the source-certified round XZ
 * capsule, with the same complete vertical body band. */
export function villageLifeObstacleContainsPoint(p:VillageSitePoint,site:VillageSiteLayout,o:VillageLifeNavigationObstacle):boolean {
 if(p[1]+site.capsule.height<o.bounds.min[1]||p[1]>o.bounds.max[1])return false;
 if(o.kind!=='fire')return p[0]+site.capsule.radius>=o.bounds.min[0]&&p[0]-site.capsule.radius<=o.bounds.max[0]&&p[2]+site.capsule.radius>=o.bounds.min[2]&&p[2]-site.capsule.radius<=o.bounds.max[2];
 const dx=Math.max(o.bounds.min[0]-p[0],0,p[0]-o.bounds.max[0]),dz=Math.max(o.bounds.min[2]-p[2],0,p[2]-o.bounds.max[2]);
 return dx*dx+dz*dz<=site.capsule.radius*site.capsule.radius+1e-12;
}
/** A rounded rectangle is the union of two axis strips and four corner discs.
 * Intersect each exact primitive with the vertical slab, then union the convex
 * result. No source triangles or collision radius are shrunk. */
export function villageLifeFireSegmentInterval(a:VillageSitePoint,b:VillageSitePoint,site:VillageSiteLayout,o:VillageLifeNavigationObstacle):readonly[number,number]|null {
 // Reject only disjoint swept bounds before allocating the exact kernel's
 // interval arrays/closures. The extra broadphase slack preserves its existing
 // discriminant tolerance; tiny spans/extreme frames retain the exact path.
 if(Math.max(a[1],b[1])<o.bounds.min[1]-site.capsule.height||Math.min(a[1],b[1])>o.bounds.max[1])return null;
 const broadDx=b[0]-a[0],broadDz=b[2]-a[2],spanSquared=broadDx*broadDx+broadDz*broadDz;
 const scale=Math.max(1,Math.abs(a[0]),Math.abs(a[2]),Math.abs(b[0]),Math.abs(b[2]),Math.abs(o.bounds.min[0]),Math.abs(o.bounds.min[2]),Math.abs(o.bounds.max[0]),Math.abs(o.bounds.max[2]),site.capsule.radius);
 if(spanSquared>=1e-8&&scale<=1e6){const padding=site.capsule.radius+.01+4e-6*scale;
  if(Math.max(a[0],b[0])<o.bounds.min[0]-padding||Math.min(a[0],b[0])>o.bounds.max[0]+padding
   ||Math.max(a[2],b[2])<o.bounds.min[2]-padding||Math.min(a[2],b[2])>o.bounds.max[2]+padding)return null;
 }
 const delta=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],radius=site.capsule.radius;let verticalLo=0,verticalHi=1;
 const slab=(origin:number,d:number,low:number,high:number,lo:number,hi:number):readonly[number,number]|null=>{
  if(Math.abs(d)<1e-12)return origin>=low&&origin<=high?[lo,hi]:null;
  const x=(low-origin)/d,y=(high-origin)/d;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));return lo<=hi?[lo,hi]:null;
 };
 const y=slab(a[1],delta[1],o.bounds.min[1]-site.capsule.height,o.bounds.max[1],0,1);if(!y)return null;[verticalLo,verticalHi]=y;
 let earliest=Infinity,latest=-Infinity;
 const accept=(range:readonly[number,number]|null)=>{if(range){earliest=Math.min(earliest,range[0]);latest=Math.max(latest,range[1]);}};
 const rectangle=(minX:number,maxX:number,minZ:number,maxZ:number)=>{const x=slab(a[0],delta[0],minX,maxX,verticalLo,verticalHi);return x?slab(a[2],delta[2],minZ,maxZ,x[0],x[1]):null;};
 accept(rectangle(o.bounds.min[0]-radius,o.bounds.max[0]+radius,o.bounds.min[2],o.bounds.max[2]));
 accept(rectangle(o.bounds.min[0],o.bounds.max[0],o.bounds.min[2]-radius,o.bounds.max[2]+radius));
 const quadratic=delta[0]*delta[0]+delta[2]*delta[2];
 for(const x of[o.bounds.min[0],o.bounds.max[0]])for(const z of[o.bounds.min[2],o.bounds.max[2]]){
  const dx=a[0]-x,dz=a[2]-z,c=dx*dx+dz*dz-radius*radius;
  if(quadratic<1e-20){if(c<=1e-12)accept([verticalLo,verticalHi]);continue;}
  const linear=2*(dx*delta[0]+dz*delta[2]),disc=linear*linear-4*quadratic*c;if(disc< -1e-12*Math.max(1,linear*linear,Math.abs(4*quadratic*c)))continue;
  const root=Math.sqrt(Math.max(0,disc)),lo=Math.max(verticalLo,(-linear-root)/(2*quadratic)),hi=Math.min(verticalHi,(-linear+root)/(2*quadratic));if(lo<=hi)accept([lo,hi]);
 }
 return earliest<=latest?[earliest,latest]:null;
}
/** Capsule/AABB slab intersection in the unmodified source frame. */
function obstacleRanges(path:Pick<VillageSitePath,'sourceGroundPolyline'>,site:VillageSiteLayout,obstacles:readonly VillageLifeNavigationObstacle[]):readonly {start:number;end:number;onset:number;obstacle:VillageLifeNavigationObstacle}[]{
  const ranges:{start:number;end:number;onset:number;obstacle:VillageLifeNavigationObstacle}[]=[];let traversed=0;
  for(let i=1;i<path.sourceGroundPolyline.length;i++){
    const a=path.sourceGroundPolyline[i-1],b=path.sourceGroundPolyline[i],span=distance(a,b);
    for(const obstacle of obstacles){if(obstacle.kind==='fire'){const interval=villageLifeFireSegmentInterval(a,b,site,obstacle);if(interval)ranges.push({start:traversed+interval[0]*span,end:traversed+interval[1]*span,onset:obstacle.activeFromAbsoluteMinute,obstacle});continue;}let lo=0,hi=1;
      for(let k=0;k<3;k++){
        const lower=obstacle.bounds.min[k]-(k===1?site.capsule.height:site.capsule.radius),upper=obstacle.bounds.max[k]+(k===1?0:site.capsule.radius),d=b[k]-a[k];
        if(Math.abs(d)<EPS){if(a[k]<lower||a[k]>upper){lo=2;break;}}
        else{const first=(lower-a[k])/d,last=(upper-a[k])/d;lo=Math.max(lo,Math.min(first,last));hi=Math.min(hi,Math.max(first,last));}
      }
      if(lo<=hi&&lo<=1&&hi>=0)ranges.push({start:traversed+Math.max(0,lo)*span,end:traversed+Math.min(1,hi)*span,onset:obstacle.activeFromAbsoluteMinute,obstacle});
    }
    traversed+=span;
  }
  return ranges;
}
/** Read-only admission for an entire source path, using the same swept body
 * kernels as navigation. A future known persistent obstacle is conservative;
 * foreign source/profile records cannot block or authorize this source. */
export function villageLifePathClearOfObstacles(path:Pick<VillageSitePath,'sourceGroundPolyline'>,site:VillageSiteLayout,obstacles:readonly VillageLifeNavigationObstacle[]):boolean{
 const points=path.sourceGroundPolyline,active=obstacles.filter(o=>o.sourceSha256===site.sourceSha256&&o.profile===site.profile);return points.length>0&&!blockedStand(points[0],site,active)&&obstacleRanges(path,site,active).length===0;
}
/** A fire exclusion is not a new collision connector. Only an already
 * certified route may increase its exact rounded fire clearance, with no
 * inward progress or later return. This never exempts physical rubble. */
function canEscapeFire(path:Pick<VillageSitePath,'sourceGroundPolyline'>,site:VillageSiteLayout,obstacle:VillageLifeNavigationObstacle,progress=0,direction:1|-1=1):boolean{
 if(obstacle.kind!=='fire')return false;
 const source=path.sourceGroundPolyline,points:VillageSitePoint[]=[];let traversed=0;
 for(let i=1;i<source.length;i++){const a=source[i-1],b=source[i],span=distance(a,b);
  if(progress<=traversed+span+EPS){const t=span>EPS?Math.max(0,Math.min(1,(progress-traversed)/span)):0;
   const at:VillageSitePoint=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
   points.push(at,...(direction===1?source.slice(i):source.slice(0,i).reverse()));break;}
  traversed+=span;
 }
 const start=points[0];if(!start||!blockedStand(start,site,[obstacle]))return false;
 const signed=(p:VillageSitePoint)=>{const dx=Math.max(obstacle.bounds.min[0]-p[0],0,p[0]-obstacle.bounds.max[0]),dz=Math.max(obstacle.bounds.min[2]-p[2],0,p[2]-obstacle.bounds.max[2]);
  return dx||dz?Math.hypot(dx,dz)-site.capsule.radius:-Math.min(p[0]-obstacle.bounds.min[0],obstacle.bounds.max[0]-p[0],p[2]-obstacle.bounds.min[2],obstacle.bounds.max[2]-p[2])-site.capsule.radius;};
 let exited=false;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(exited){if(villageLifeFireSegmentInterval(a,b,site,obstacle))return false;continue;}
  const x=a[0]<obstacle.bounds.min[0]?a[0]-obstacle.bounds.min[0]:a[0]>obstacle.bounds.max[0]?a[0]-obstacle.bounds.max[0]:0,
   z=a[2]<obstacle.bounds.min[2]?a[2]-obstacle.bounds.min[2]:a[2]>obstacle.bounds.max[2]?a[2]-obstacle.bounds.max[2]:0;
  let derivative:number;
  if(x||z)derivative=x*(b[0]-a[0])+z*(b[2]-a[2]);
  else{const faces=[{depth:a[0]-obstacle.bounds.min[0],d:a[0]-b[0]},{depth:obstacle.bounds.max[0]-a[0],d:b[0]-a[0]},{depth:a[2]-obstacle.bounds.min[2],d:a[2]-b[2]},{depth:obstacle.bounds.max[2]-a[2],d:b[2]-a[2]}],nearest=Math.min(...faces.map(f=>f.depth));derivative=Math.max(...faces.filter(f=>f.depth<=nearest+EPS).map(f=>f.d));}
  if(derivative<-EPS||signed(b)<signed(a)-EPS)return false;
  if(signed(b)>EPS)exited=true;
 }
 return exited;
}
function blockedStand(p:VillageSitePoint,site:VillageSiteLayout,obstacles:readonly VillageLifeNavigationObstacle[]):boolean{
  return obstacles.some(o=>villageLifeObstacleContainsPoint(p,site,o));
}
function reservedPathConflict(path:Pick<VillageSitePath,'sourceGroundPolyline'>,who:string,site:VillageSiteLayout,routes:readonly VillageSitePath[],
  stands:ReadonlyMap<string,VillageSitePoint>,budget?:AlternateBudget,obstacles:readonly VillageLifeNavigationObstacle[]=[],bodies?:PeerBodies):boolean {
  if(obstacleRanges(path,site,obstacles).some(range=>!canEscapeFire(path,site,range.obstacle)))return true;
  const segments=path.sourceGroundPolyline.length-1,fallback=ordinaryJourneySite(site).capsule,own=site.capsule;
  for(const other of routes){
    if(budget&&(budget.segments-=segments*(other.sourceGroundPolyline.length-1))<0)return true;
    const peerBody=bodies?.routes.get(other)??fallback,futures=bodies?.futures.get(other);
    if(bodies?.temporalResidents.has(who)&&futures?.length){const candidate=futureSourceRouteTrajectory(path.sourceGroundPolyline,0,1,bodies.now,bodies.speed);
      if(futures.some(peer=>firstSourceTrajectoryContact(candidate,own,peer,peerBody)!==null))return true;
    }else if(pathsConflict(path,other,own.radius,own.height,peerBody.radius,peerBody.height))return true;
  }
  for(const [peer,p]of stands){if(peer===who)continue;const peerBody=bodies?.stands.get(peer)??fallback;
    if(budget&&(budget.segments-=segments)<0)return true;
    if(path.sourceGroundPolyline.slice(1).some((b,i)=>{const a=path.sourceGroundPolyline[i];return p[1]<Math.max(a[1],b[1])+own.height&&p[1]+peerBody.height>Math.min(a[1],b[1])&&pointSegment(p,a,b)<own.radius+peerBody.radius-EPS;}))return true;
  }
  return false;
}
/** Try only different certified intermediate legs. The source departure and
 * arrival legs stay unchanged, so this cannot bypass a blocked door/target,
 * alter a workstation yaw, or create a source-to-graph connector. */
function clearAlternatePath(site:VillageSiteLayout,path:VillageSitePath,who:string,routes:readonly VillageSitePath[],
  stands:ReadonlyMap<string,VillageSitePoint>,budget:AlternateBudget,obstacles:readonly VillageLifeNavigationObstacle[]=[],bodies?:PeerBodies):VillageSitePath|null {
  if(path.legs.length<3||path.legs.length>128||budget.edges<=0||budget.segments<=0)return null;
  const graph=graphs.get(site)!,firstSaved=path.legs[0],lastSaved=path.legs[path.legs.length-1];
  const firstRoute=site.routes.find(r=>r.id===firstSaved.id)!,lastRoute=site.routes.find(r=>r.id===lastSaved.id)!;
  const first:GraphLeg={route:firstRoute,reverse:firstSaved.reverse,from:firstSaved.reverse?firstRoute.to:firstRoute.from,next:firstSaved.reverse?firstRoute.from:firstRoute.to},
    last:GraphLeg={route:lastRoute,reverse:lastSaved.reverse,from:lastSaved.reverse?lastRoute.to:lastRoute.from,next:lastSaved.reverse?lastRoute.from:lastRoute.to};
  const clear=new Map<string,boolean>();
  const allowed=(leg:GraphLeg)=>{let result=clear.get(leg.route.id);if(result!==undefined)return result;
    if(--budget.edges<0)return false;result=!reservedPathConflict(leg.route,who,site,routes,stands,budget,obstacles,bodies);clear.set(leg.route.id,result);return result;};
  if(!allowed(first)||!allowed(last))return null;
  const queue=[first.next],seen=new Set([first.from,first.next,last.next]),previous=new Map<string,GraphLeg>();
  for(let i=0;i<queue.length&&!previous.has(last.from);i++){
    if(i>=126||budget.edges<=0||budget.segments<=0)return null;
    for(const leg of graph.get(queue[i])??[])if(!seen.has(leg.next)&&allowed(leg)){
      seen.add(leg.next);previous.set(leg.next,leg);queue.push(leg.next);if(leg.next===last.from)break;
    }
  }
  if(!previous.has(last.from))return null;
  const middle:GraphLeg[]=[];for(let at=last.from;at!==first.next;){const leg=previous.get(at)!;middle.unshift(leg);at=leg.from;}
  if(middle.length+2>128)return null;
  const alternate=joinGraphLegs([first,...middle,last]);
  // Retain the strict save budgets as well as all original source points.
  return alternate.sourceGroundPolyline.length<=4096&&!reservedPathConflict(alternate,who,site,routes,stands,budget,obstacles,bodies)?alternate:null;
}
function empty(intent:VillageLifeIntent,now:number):VillageLifeJourney {
  return {residentId:intent.residentId,targetPlaceId:intent.targetPlaceId,activityKey:intent.activityKey,priority:intent.priority,indoor:intent.indoor,
    issuedAbsoluteMinute:intent.issuedAbsoluteMinute,status:'unmapped',reason:'site-unavailable',anchorPlaceId:null,anchorPosition:null,
    originPlaceId:null,destinationPlaceId:null,pendingTargetPlaceId:null,startedAbsoluteMinute:null,lastAbsoluteMinute:now,progressMetres:0,direction:1,
    directionStartedAbsoluteMinute:null,progressAtDirectionStart:0,route:null,sourceSha256:null,sourceSiteIdentity:null,arrivalEvidence:'none',arrivedAtAbsoluteMinute:null,inside:false};
}
function matchingPatrol(site:VillageSiteLayout|null,intent:VillageLifeIntent):VillageSitePatrolPlan|undefined {
  return site?.navigationRevision&&site.navigationAllocation&&intent.activityKey==='patrol'&&intent.reason==='routine'&&!intent.indoor
    ?site.patrols?.find(p=>p.residentId===intent.residentId&&p.activity===intent.activity&&p.routineTargetPlaceId===intent.targetPlaceId):undefined;
}
function withoutUnstartedPatrolEntry(r:VillageLifeJourney):VillageLifeJourney {
  if(r.patrolEntry?.waypointIndex!==null)return r;
  const{patrolEntry:_discarded,...ordinary}=r;return ordinary;
}
function clearPatrolEntryPath(site:VillageSiteLayout,identity:string|null,r:VillageLifeJourney,plan:VillageSitePatrolPlan,
  peers:readonly VillageLifeJourney[],replacements:ReadonlyMap<string,VillageLifeJourney>,occupied:ReadonlyMap<string,string>,reserved:readonly VillageSitePath[]){
  const binding=site.residentPlaceBindings.find(b=>b.residentId===r.residentId&&b.placeId===r.anchorPlaceId);
  const origin=r.anchorPlaceId&&resolveVillageSiteEndpoint(site,r.anchorPlaceId,r.residentId);
  // A changed/unmapped routine source is not repaired by this target choice.
  const declaredEntry=routeFor(site,r.residentId,plan.routineTargetPlaceId,plan.waypoints[0].placeId);
  if(!origin||!r.anchorPosition||binding?.status!=='mapped-exterior'||binding.anchorId!==origin.id
    ||!samePoint(origin.sourceGroundPoint,r.anchorPosition)||r.sourceSha256!==site.sourceSha256||r.sourceSiteIdentity!==identity
    ||!declaredEntry||declaredEntry.lengthMetres<=EPS)return null;
  for(let index=0;index<plan.waypoints.length;index++){
    const waypoint=plan.waypoints[index],target=resolveVillageSiteEndpoint(site,waypoint.placeId,r.residentId);
    const path=target&&target.id===waypoint.anchorId?routeFor(site,r.residentId,r.anchorPlaceId!,waypoint.placeId):null;
    if(!target||!path||path.lengthMetres<=EPS||occupied.has(target.id)&&occupied.get(target.id)!==r.residentId
      ||reserved.some(other=>pathsConflict(path,other,site.capsule.radius,site.capsule.height)))continue;
    let clear=true;
    for(const original of peers){
      const peer=replacements.get(original.residentId)??original;if(peer.residentId===r.residentId||peer.inside)continue;
      if(peer.route){
        if(peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==identity||!routeStillMatches(peer,site)
          ||pathsConflict(path,peer.route,site.capsule.radius,site.capsule.height)){clear=false;break;}
      }else if(peer.anchorPlaceId&&peer.anchorPosition){
        const stand=resolveVillageSiteEndpoint(site,peer.anchorPlaceId,peer.residentId);
        if(!stand||peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==identity||!samePoint(stand.sourceGroundPoint,peer.anchorPosition)
          ||path.sourceGroundPolyline.slice(1).some((b,i)=>{const a=path.sourceGroundPolyline[i],p=peer.anchorPosition!;
            return p[1]<Math.max(a[1],b[1])+site.capsule.height&&p[1]+site.capsule.height>Math.min(a[1],b[1])&&pointSegment(p,a,b)<2*site.capsule.radius-EPS;})){clear=false;break;}
      }
    }
    if(clear)return{index,target,path,placeId:waypoint.placeId};
  }
  return null;
}
function withIntent(r:VillageLifeJourney,intent:VillageLifeIntent,now:number):VillageLifeJourney {
  const updated={...r,targetPlaceId:intent.targetPlaceId,activityKey:intent.activityKey,priority:intent.priority,indoor:intent.indoor,
    issuedAbsoluteMinute:intent.issuedAbsoluteMinute,lastAbsoluteMinute:now};
  if(r.patrol&&(intent.activityKey!=='patrol'||intent.reason!=='routine'||intent.indoor||r.patrol.issuedAbsoluteMinute!==intent.issuedAbsoluteMinute)){
    const {patrol:_discarded,...ordinary}=updated;return ordinary;
  }
  if(r.patrolEntry&&(intent.activityKey!=='patrol'||intent.reason!=='routine'||intent.indoor
    ||r.targetPlaceId!==intent.targetPlaceId||r.priority!==intent.priority||r.patrolEntry.issuedAbsoluteMinute!==intent.issuedAbsoluteMinute)){
    const{patrolEntry:_discarded,...ordinary}=updated;return ordinary;
  }
  return updated;
}

export function advanceVillageLifeNavigation(value:VillageLifeNavigationState,input:VillageLifeNavigationInput):VillageLifeNavigationState {
 const state=parseVillageLifeNavigation(value),now=input.absoluteMinute;
 // Existing shared traffic must be reconsidered at authoritative decisions
 // and dated obstacle onsets. Observation frequency cannot skip an emergency
 // stop or buy a longer movement interval. Ordinary legacy paths are unchanged.
 if(state.residents.some(r=>r.emergencyRefuge||r.emergencyTraversal)&&Number.isFinite(now)&&now>state.absoluteMinute){
  if(now-state.absoluteMinute>10080)throw Error('Source traffic catch-up exceeds its one-week decision budget.');
  const cuts=new Set<number>();for(let at=Math.floor(state.absoluteMinute)+1;at<now;at++)cuts.add(at);
  for(const o of input.dynamicObstacles??[])if(o.activeFromAbsoluteMinute>state.absoluteMinute&&o.activeFromAbsoluteMinute<now)cuts.add(o.activeFromAbsoluteMinute);
  for(const i of input.intents)if(i.issuedAbsoluteMinute>state.absoluteMinute&&i.issuedAbsoluteMinute<now)cuts.add(i.issuedAbsoluteMinute);
  cuts.add(now);let current=state;
  for(const at of [...cuts].sort((a,b)=>a-b)){const previous=new Map(current.residents.map(r=>[r.residentId,r])),intents=input.intents.map(i=>{const old=previous.get(i.residentId);return i.issuedAbsoluteMinute>at&&old?{...i,targetPlaceId:old.targetPlaceId,activityKey:old.activityKey as VillageLifeIntent['activityKey'],priority:old.priority,indoor:old.indoor,issuedAbsoluteMinute:old.issuedAbsoluteMinute}:i;}),available=new Set(input.intents.filter(i=>i.issuedAbsoluteMinute<=at).map(i=>i.residentId));
   current=advanceVillageLifeNavigationStep(current,{...input,absoluteMinute:at,intents,refugePermits:input.refugePermits?.filter(p=>available.has(p.residentId)),locomotionPermits:input.locomotionPermits?.filter(p=>available.has(p.residentId))});
  }return current;
 }
 return advanceVillageLifeNavigationStep(state,input);
}
function advanceVillageLifeNavigationStep(value:VillageLifeNavigationState,input:VillageLifeNavigationInput):VillageLifeNavigationState {
  const state=parseVillageLifeNavigation(value),now=input.absoluteMinute,site=input.site;
  if(!minute(now)||now+EPS<state.absoluteMinute||!Number.isFinite(input.metresPerWorldMinute)||input.metresPerWorldMinute<=0||input.metresPerWorldMinute>1000
    ||!Array.isArray(input.intents)||input.intents.length>1000)throw Error('Navigation requires monotonic authoritative time, bounded speed and intents.');
  if(site)validSite(site);
  if(input.dynamicObstacles&&(!Array.isArray(input.dynamicObstacles)||input.dynamicObstacles.length>4096))throw Error('Dynamic obstacles exceed their bounded source budget.');
  const obstacleIds=new Set<string>();
  for(const o of input.dynamicObstacles??[]){if(!id(o.id)||obstacleIds.has(o.id)||!hash(o.sourceSha256)||!['desktop','quest'].includes(o.profile)
    ||o.kind!==undefined&&!['fire','solid'].includes(o.kind)||o.exceptResidentId!==undefined&&(o.kind!=='solid'||!id(o.exceptResidentId)||!input.intents.some(intent=>intent.residentId===o.exceptResidentId))||!minute(o.activeFromAbsoluteMinute)||!o.bounds||!point(o.bounds.min)||!point(o.bounds.max)||o.bounds.min.some((n:number,k:number)=>n>o.bounds.max[k]))throw Error('Invalid source-bound dynamic obstacle.');obstacleIds.add(o.id);}
  const sourceObstacles=(input.dynamicObstacles??[]).filter(o=>site&&o.sourceSha256===site.sourceSha256&&o.profile===site.profile&&o.activeFromAbsoluteMinute<=now);
  if(input.sourceAllocationHold!==undefined&&input.sourceAllocationHold!==true)throw Error('Source allocation holds are explicit, never a bootstrap permission.');
  const allocationHold=!!input.sourceAllocationHold||!!site?.navigationRevision&&!site.navigationAllocation;
  const bindSite=allocationHold?null:site;
  const siteIdentity=bindSite?`${bindSite.profile}:${bindSite.sourceSha256}:${input.siteIdentity??bindSite.navigationRevision??'source-site'}`:state.siteIdentity;
  if(siteIdentity&&siteIdentity.length>512)throw Error('Navigation site identity exceeds its budget.');
  const decisionBoundary=Math.abs(now-Math.round(now))<=EPS;
  const sourceChanged=allocationHold||!!site&&state.sourceSha256!==null&&(state.sourceSha256!==site.sourceSha256||state.profile!==site.profile||state.siteIdentity!==siteIdentity||state.navigationRevision!==site.navigationRevision
    ||!sameVillageSiteNavigationAllocation(state.navigationAllocation,site.navigationAllocation));
  const initialPlaces=new Map<string,VillageLifeInitialPlace>();
  if(input.initialPlaces){if(!Array.isArray(input.initialPlaces)||input.initialPlaces.length!==input.intents.length)throw Error('Initial place bindings must cover every life intent.');for(const initial of input.initialPlaces){if(!id(initial.residentId)||!id(initial.placeId)||typeof initial.indoor!=='boolean'||initialPlaces.has(initial.residentId))throw Error('Invalid initial place binding.');initialPlaces.set(initial.residentId,initial);}}
  const baseSite=site,permits=new Map<string,VillageEmergencyLocomotionPermit>();
  for(const p of input.locomotionPermits??[]){if(!exact(p,['residentId','id','certificateSha256','requiredClip'])||!id(p.residentId)||permits.has(p.residentId)||!id(p.id)||!hash(p.certificateSha256)||p.requiredClip!=='carry_bucket_walk'||!baseSite||!findVillageEmergencyTraversal(baseSite,p,p.residentId))throw Error('Invalid explicit source locomotion permit.');permits.set(p.residentId,p);}
  const refugePermits=new Map<string,VillageEmergencyRefugePermit>();
  for(const p of input.refugePermits??[]){if(!exact(p,['residentId','ids'])||!id(p.residentId)||refugePermits.has(p.residentId)||!baseSite||!scopedVillageEmergencyRefugeSite(baseSite,p,p.residentId))throw Error('Invalid explicit source refuge permit.');refugePermits.set(p.residentId,p);}
  const workplacePermits=new Map<string,VillageWorkplaceRoutePermit>();
  for(const permit of input.workplacePermits??[]){if(!exact(permit,['residentId','id','certificateSha256'])||!id(permit.residentId)||workplacePermits.has(permit.residentId)||!id(permit.id)||!hash(permit.certificateSha256)||!baseSite||findVillageWorkplaceRoute(baseSite,permit,permit.residentId)?.purpose!=='community-timber')throw Error('Invalid explicit community workplace permit.');workplacePermits.set(permit.residentId,permit);}
  const effectiveIntents=new Map(input.intents.map(intent=>[intent.residentId,intent]));
  const prior=new Map(state.residents.map(r=>[r.residentId,r])),seen=new Set<string>(),traces=new Map<string,SourceTrajectory>();
  for(const r of state.residents)if(!r.inside){const position=r.route?sourcePolylinePosition(r.route.sourceGroundPolyline,r.progressMetres):r.anchorPosition;if(position)traces.set(r.residentId,stationarySourceTrajectory(position,state.absoluteMinute,now,r.progressMetres));}
  if(!input.refugePermits?.length&&!input.locomotionPermits?.length&&!input.workplacePermits?.length&&!state.residents.some(r=>r.emergencyTraversal||r.emergencyRefuge||r.workplaceRoute||r.neutralReturn)&&!site?.workplaceRoutes?.some(row=>input.intents.some(intent=>intent.residentId===row.residentId&&intent.targetPlaceId===row.placeId))&&!input.dynamicObstacles?.length&&!allocationHold&&now===state.absoluteMinute&&stateSites.has(state)&&stateSites.get(state)===site&&state.siteIdentity===siteIdentity&&!state.residents.some(r=>r.reason==='initial-placement-required'||r.reason==='dynamic-obstacle'||r.anchorPlaceId===null)&&input.intents.length===state.residents.length){
    const unchanged=new Set<string>();
    if(input.intents.every(intent=>{const r=prior.get(intent.residentId);if(!r||unchanged.has(intent.residentId))return false;unchanged.add(intent.residentId);return r.targetPlaceId===intent.targetPlaceId&&r.activityKey===intent.activityKey&&r.priority===intent.priority&&r.indoor===intent.indoor&&r.issuedAbsoluteMinute===intent.issuedAbsoluteMinute;}))return state;
  }
  const rows:VillageLifeJourney[]=input.intents.map(intent=>{
    if(!id(intent.residentId)||seen.has(intent.residentId)||!id(intent.targetPlaceId)||!id(intent.activityKey)||typeof intent.indoor!=='boolean'
      ||!minute(intent.issuedAbsoluteMinute)||intent.issuedAbsoluteMinute>now+EPS||!Number.isFinite(intent.priority)||intent.priority<0||intent.priority>100000)throw Error('Invalid or duplicate life navigation intent.');
    seen.add(intent.residentId);
    let r:VillageLifeJourney=prior.get(intent.residentId)??empty(intent,state.absoluteMinute);
    const obstacles=sourceObstacles.filter(obstacle=>obstacle.exceptResidentId!==r.residentId);
    let refugePermit=refugePermits.get(intent.residentId),permit=permits.get(intent.residentId);
    if(r.neutralReturn){
      if(sourceChanged)return{...withIntent(r,intent,now),reason:'source-site-changed'};
      if(baseSite&&neutralReturnCanUseGlobalBody(r,baseSite,state,obstacles)){const{neutralReturn:_,...ordinary}=r;r=ordinary;}
      else return{...withIntent(r,intent,now),reason:baseSite&&qualifiedVillageNeutralReturnMotion(r,baseSite)?'neutral-return-clearance-required':'neutral-return-source-changed'};
    }
    if(r.workplaceRoute){
      const cap=baseSite&&findVillageWorkplaceRoute(baseSite,r.workplaceRoute,r.residentId);
      if(!cap)return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'workplace-source-permit-changed'};
      if(r.workplaceRoute.recoveryRefuge&&refugePermit&&baseSite&&!r.route&&r.arrivalEvidence==='certified-route-arrival'&&r.anchorPlaceId===r.workplaceRoute.returnPlaceId&&r.anchorPosition&&matchesVillageLifeSourceJourney(r,baseSite)){
        const pin=r.workplaceRoute.recoveryRefuge,ref=pinVillageEmergencyRefugeRef(baseSite,[pin.id],r.residentId),scope=ref&&scopedVillageEmergencyRefugeSite(baseSite,ref,r.residentId),endpoint=scope&&resolveVillageSiteEndpoint(scope,r.anchorPlaceId,r.residentId);
        if(refugePermit.ids.includes(pin.id)&&ref?.certificates?.[pin.id]===pin.certificateSha256&&endpoint&&samePoint(endpoint.sourceGroundPoint,r.anchorPosition)){const{workplaceRoute:_,...ordinary}=r;r={...ordinary,emergencyRefuge:ref};}
      }
      if(r.workplaceRoute){
      const original=baseSite&&r.anchorPlaceId?resolveVillageSiteEndpoint(baseSite,r.anchorPlaceId,r.residentId):null;
      const originalReached=!r.route&&!!original&&!!r.anchorPosition&&samePoint(original.sourceGroundPoint,r.anchorPosition);
      if(originalReached&&(intent.targetPlaceId!==cap.placeId||cap.purpose==='community-timber'&&!workplacePermits.has(r.residentId))){const{workplaceRoute:_,...plain}=r;r=plain;}
      else if(refugePermit||permit||cap.purpose==='community-timber'&&!workplacePermits.has(r.residentId)){
        // Leave the private branch on its real original departure before a
        // different constrained body/graph may be authorized.
        refugePermit=undefined;permit=undefined;intent={...intent,targetPlaceId:r.workplaceRoute.returnPlaceId,indoor:false};effectiveIntents.set(intent.residentId,intent);
      }
      }
    }
    // A recovery job may begin only from the exact temporary refuge this
    // resident already reached. It never manufactures initial work placement.
    if(!r.workplaceRoute&&r.emergencyRefuge&&!r.emergencyTraversal&&!permit&&!sourceChanged&&baseSite&&intent.reason==='routine'&&!r.route&&r.arrivalEvidence==='certified-route-arrival'&&r.anchorPlaceId&&r.anchorPosition&&r.sourceSha256===baseSite.sourceSha256&&r.sourceSiteIdentity===state.siteIdentity&&matchesVillageLifeSourceJourney(r,baseSite)){
      const p=workplacePermits.get(r.residentId),cap=p&&findVillageWorkplaceRoute(baseSite,p,r.residentId),approach=cap?.recoveryApproach,refuge=approach&&validateVillageSiteEmergencyRefuges(baseSite).find(row=>row.id===approach.refugeId&&row.certificateSha256===approach.certificateSha256&&row.residentId===r.residentId);
      if(cap?.placeId===intent.targetPlaceId&&refuge&&r.emergencyRefuge.certificates?.[refuge.id]===refuge.certificateSha256&&r.emergencyRefuge.ids.includes(refuge.id)&&r.anchorPlaceId===refuge.placeId&&samePoint(r.anchorPosition,refuge.proof.sourceGroundPoint)){
        const ref=Object.freeze({id:cap.id,certificateSha256:cap.certificateSha256,returnPlaceId:refuge.placeId,recoveryRefuge:Object.freeze({id:refuge.id,certificateSha256:refuge.certificateSha256})});
        if(recoveryWorkplaceStandClear(r,ref,baseSite,state,obstacles)){const{emergencyRefuge:_,...ordinary}=r;r={...ordinary,workplaceRoute:ref};refugePermit=undefined;}
      }
    }
    if(!r.workplaceRoute&&!r.emergencyRefuge&&!r.emergencyTraversal&&!refugePermit&&!permit&&!sourceChanged&&baseSite&&intent.reason==='routine'){
      const cap=validateVillageSiteWorkplaceRoutes(baseSite).find(row=>row.residentId===r.residentId&&row.placeId===intent.targetPlaceId&&(row.purpose!=='community-timber'||workplacePermits.get(r.residentId)?.id===row.id&&workplacePermits.get(r.residentId)?.certificateSha256===row.certificateSha256));
      if(cap&&!r.route&&r.anchorPlaceId&&r.anchorPosition&&r.sourceSha256===baseSite.sourceSha256&&r.sourceSiteIdentity===state.siteIdentity){
        const original=resolveVillageSiteEndpoint(baseSite,r.anchorPlaceId,r.residentId);
        if(original&&samePoint(original.sourceGroundPoint,r.anchorPosition))r={...r,workplaceRoute:Object.freeze({id:cap.id,certificateSha256:cap.certificateSha256,returnPlaceId:r.anchorPlaceId})};
      }
    }
    if(refugePermit&&r.emergencyTraversal){const original=baseSite&&r.anchorPlaceId?resolveVillageSiteEndpoint(baseSite,r.anchorPlaceId,r.residentId):null,carry=baseSite&&findVillageEmergencyTraversal(baseSite,r.emergencyTraversal,r.residentId);
      if(!r.route&&(r.arrivalEvidence==='certified-route-arrival'||original?.id===carry?.fromAnchorId)&&original&&r.anchorPosition&&samePoint(original.sourceGroundPoint,r.anchorPosition)){const{emergencyTraversal:_,...neutral}=r;r=neutral;permit=undefined;}
      else refugePermit=undefined;
    }
    if(refugePermit){
      if(!baseSite||!r.anchorPlaceId||!r.anchorPosition||r.sourceSha256!==baseSite.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity)return{...withIntent(r,intent,now),reason:'refuge-source-anchor-required'};
      if(r.emergencyRefuge&&!scopedVillageEmergencyRefugeSite(baseSite,r.emergencyRefuge,r.residentId))return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'refuge-source-permit-changed'};
      const ref=pinVillageEmergencyRefugeRef(baseSite,[...new Set([...(r.emergencyRefuge?.ids??[]),...refugePermit.ids])],r.residentId);if(!ref)throw Error('Refuge permit lost its exact source certificate.');r={...r,emergencyRefuge:ref};
    }else if(r.emergencyRefuge&&baseSite){const original=r.anchorPlaceId?resolveVillageSiteEndpoint(baseSite,r.anchorPlaceId,r.residentId):null;
      if(!r.route&&original&&r.anchorPosition&&samePoint(original.sourceGroundPoint,r.anchorPosition)){const{emergencyRefuge:_,...ordinary}=r;r=ordinary;}
      else if(!r.route&&!resolveVillageSiteEndpoint(baseSite,intent.targetPlaceId,r.residentId))return{...withIntent(r,intent,now),reason:'refuge-permit-required'};
    }
    if(permit){if(r.emergencyRefuge)return{...withIntent(r,intent,now),reason:'refuge-carry-conflict'};if(!baseSite||!r.anchorPlaceId||!r.anchorPosition||r.sourceSha256!==baseSite.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity)return{...withIntent(r,intent,now),reason:'clip-source-anchor-required'};const ref={id:permit.id,certificateSha256:permit.certificateSha256,requiredClip:permit.requiredClip};
      if(r.emergencyTraversal&&(r.emergencyTraversal.id!==ref.id||r.emergencyTraversal.certificateSha256!==ref.certificateSha256))return{...r,lastAbsoluteMinute:now,reason:'clip-source-permit-changed'};
      r={...r,emergencyTraversal:ref};
    }else if(r.emergencyTraversal){
      if(baseSite&&!sourceChanged&&(ownsUnusedVillageLifeEmergencyCarry(state,baseSite,r.residentId)||canReleaseEmergencyCarry(r,baseSite,state,obstacles))){const{emergencyTraversal:_,...ordinary}=r;r=ordinary;}
      else {
        const cap=baseSite&&findVillageEmergencyTraversal(baseSite,r.emergencyTraversal,r.residentId),proof=cap?.neutralReturn;
        if(baseSite&&proof&&!r.inside&&r.arrivalEvidence==='certified-route-arrival'&&r.anchorPlaceId&&canReleaseEmergencyCarry(r,baseSite,state,obstacles,{radius:proof.body.radius+proof.body.margin,height:proof.body.height+proof.body.lift+proof.body.margin})){
          const stand=resolveVillageSiteEndpoint(baseSite,r.anchorPlaceId,r.residentId)!;const{emergencyTraversal:_,...ordinary}=r;
          return{...withIntent(ordinary,intent,now),neutralReturn:Object.freeze({id:cap!.id,certificateSha256:cap!.certificateSha256,anchorId:stand.id,placeId:r.anchorPlaceId}),reason:'neutral-return-clearance-required'};
        }
        return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'clip-locomotion-required'};
      }
    }
    const site=baseSite?villageLifeJourneyCollisionSite(r,baseSite):null;
    if(r.workplaceRoute&&!site)return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'workplace-source-permit-unavailable'};
    if(r.emergencyRefuge&&!site)return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'refuge-source-permit-unavailable'};
    if(r.emergencyTraversal&&!site)return{...withIntent(r,intent,now),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'clip-source-permit-unavailable'};

    const changed=intent.targetPlaceId!==r.targetPlaceId;
    if(sourceChanged)return{...withoutUnstartedPatrolEntry(withIntent(r,intent,now)),directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,reason:'source-site-changed'};
    if(site&&r.sourceSha256!==null&&(!routeStillMatches(r,site)||r.anchorPlaceId&&r.anchorPosition&&
      !samePoint(resolveVillageSiteEndpoint(site,r.anchorPlaceId,r.residentId)?.sourceGroundPoint??[NaN,NaN,NaN],r.anchorPosition)))
      return{...withoutUnstartedPatrolEntry(r),lastAbsoluteMinute:now,directionStartedAbsoluteMinute:r.route?now:null,progressAtDirectionStart:r.route?r.progressMetres:0,status:'unmapped',reason:'certified-binding-changed'};
    if(['source-site-changed','certified-binding-changed','clip-locomotion-required','clip-source-permit-unavailable','refuge-source-permit-unavailable','refuge-permit-required','refuge-carry-conflict','refuge-source-anchor-required','refuge-source-permit-changed','traffic-peer-held','workplace-source-permit-unavailable','workplace-source-permit-changed'].includes(r.reason??''))r={...r,status:r.route?'travelling':r.inside?'indoors':r.anchorPlaceId?'at-threshold':'unmapped',reason:null};
    if(r.route&&r.status==='travelling') {
      const activeRoute=r.route,ranges=site?obstacleRanges(activeRoute,site,obstacles):[];
      // At each dated appearance, first reach its factual onset under the old
      // cursor, then retreat on the existing route only if the return is clear.
      // The saved origin/points/allocation are retained throughout interruption.
      let base=r.progressAtDirectionStart,segmentStart=r.directionStartedAbsoluteMinute!,direction=r.direction,held=false,traceAt=state.absoluteMinute,traceProgress=r.progressMetres;
      const traceParts:SourceTrajectory[number][]=[];
      const record=(at:number,progress:number)=>{if(at>traceAt){traceParts.push(...sourceRouteTrajectory(activeRoute.sourceGroundPolyline,traceProgress,progress,traceAt,at,input.metresPerWorldMinute));traceAt=at;traceProgress=progress;}};
      for(const onset of [...new Set(ranges.map(o=>Math.max(state.absoluteMinute,o.onset)))].sort((a,b)=>a-b)){
        if(onset<segmentStart-EPS||onset>now)continue;
        const at=Math.max(0,Math.min(activeRoute.lengthMetres,base+direction*Math.max(0,onset-segmentStart)*input.metresPerWorldMinute));
        const active=ranges.filter(o=>o.onset<=onset&&(!site||!canEscapeFire(activeRoute,site,o.obstacle,at,direction))),ahead=active.some(o=>direction===1?o.end>=at-EPS:o.start<=at+EPS);
        if(!ahead)continue;
        record(onset,at);
        const canReturn=direction===1&&at>EPS&&!ranges.some(o=>o.onset<=onset&&o.start<=at+EPS&&o.end>=-EPS&&(!site||!canEscapeFire(activeRoute,site,o.obstacle,at,-1)));
        base=at;segmentStart=onset;
        if(canReturn){direction=-1;r={...r,pendingTargetPlaceId:intent.targetPlaceId,reason:null};}
        else{held=true;r={...r,reason:'dynamic-obstacle'};break;}
      }
      // A saved stopped cursor can resume only when its actual remaining arc
      // is clear; elapsed time during the hold never becomes future movement.
      if(r.reason==='dynamic-obstacle'&&!held){base=r.progressMetres;segmentStart=state.absoluteMinute;
        held=ranges.some(o=>(!site||!canEscapeFire(activeRoute,site,o.obstacle,base,direction))&&(direction===1?o.end>=base-EPS:o.start<=base+EPS));r={...r,reason:held?'dynamic-obstacle':null};}
      const remainingFromBase=direction===1?activeRoute.lengthMetres-base:base;
      const travelled=held?0:Math.min(remainingFromBase,Math.max(0,now-segmentStart)*input.metresPerWorldMinute);
      const progress=Math.max(0,Math.min(activeRoute.lengthMetres,base+direction*travelled));
      record(now,progress);if(traceParts.length)traces.set(r.residentId,traceParts);
      r={...r,direction,progressMetres:progress,progressAtDirectionStart:held?progress:base,directionStartedAbsoluteMinute:held?now:segmentStart};
      if(held&&direction===1&&progress<=EPS&&site&&!blockedStand(activeRoute.sourceGroundPolyline[0],site,obstacles)){
        r={...r,route:null,progressMetres:0,progressAtDirectionStart:0,directionStartedAbsoluteMinute:null,status:'at-threshold',reason:null};
      }else if(!held&&remainingFromBase-travelled<=EPS){const place=direction===1?r.destinationPlaceId!:r.originPlaceId!,position=direction===1?activeRoute.sourceGroundPolyline[activeRoute.sourceGroundPolyline.length-1]:activeRoute.sourceGroundPolyline[0];
        r={...r,anchorPlaceId:place,anchorPosition:position,route:null,progressMetres:0,progressAtDirectionStart:0,directionStartedAbsoluteMinute:null,status:'at-threshold',inside:false,
          arrivalEvidence:'certified-route-arrival',arrivedAtAbsoluteMinute:segmentStart+remainingFromBase/input.metresPerWorldMinute};}
    }
    // A changed responsibility cancels the circuit, retaining the exact active
    // certified leg for the ordinary interruption/reversal logic below.
    r=withIntent(r,intent,now);
    if(r.route&&changed&&r.reason!=='dynamic-obstacle'){const direction:1|-1=intent.targetPlaceId===r.originPlaceId?-1:intent.targetPlaceId===r.destinationPlaceId?1
      :r.progressMetres<=r.route.lengthMetres-r.progressMetres?-1:1;
      const blocked=(d:1|-1)=>!!site&&obstacleRanges(r.route!,site,obstacles).some(o=>!canEscapeFire(r.route!,site,o.obstacle,r.progressMetres,d)&&(d===1?o.end>=r.progressMetres-EPS:o.start<=r.progressMetres+EPS));
      const selected=blocked(direction)?(direction===1?-1:1):direction,held=blocked(selected);
      r={...r,direction:selected,progressAtDirectionStart:r.progressMetres,directionStartedAbsoluteMinute:now,pendingTargetPlaceId:intent.targetPlaceId,status:'travelling',reason:held?'dynamic-obstacle':null};}
    return r;
  });
  // Reconcile every proposed trajectory against one previous snapshot before
  // publishing progress or arrivals. A newly stopped/reversing peer therefore
  // cannot be walked through by a previously admitted follower. Earliest
  // physical contacts stop only actors moving at that instant; propagation is
  // deterministic and retains the exact source route/cursor without elapsed
  // travel credit. No scheduler/work receipt is produced here.
  if(baseSite&&now>state.absoluteMinute&&rows.some(r=>r.emergencyRefuge||r.emergencyTraversal||r.workplaceRoute||r.neutralReturn)){
   const bodies=new Map(rows.map(r=>[r.residentId,villageLifeNavigationPeerBody(r,baseSite,siteIdentity)])),affected=new Set(rows.filter(r=>r.emergencyRefuge||r.emergencyTraversal||r.workplaceRoute||r.neutralReturn).map(r=>r.residentId)),stopped=new Set<string>();
   for(let pass=0;pass<rows.length;pass++){let earliest=Infinity,pairs:readonly[string,string][]=[];const entries=[...traces];
    for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){const[a,x]=entries[i],[b,y]=entries[j];if(!affected.has(a)&&!affected.has(b))continue;const contact=firstSourceTrajectoryContact(x,bodies.get(a)??baseSite.capsule,y,bodies.get(b)??baseSite.capsule);if(contact===null||contact>now)continue;
     if(!sourceTrajectoryPositionAt(x,contact).moving&&!sourceTrajectoryPositionAt(y,contact).moving)continue;
     if(contact<earliest-1e-9){earliest=contact;pairs=[[a,b]];}else if(Math.abs(contact-earliest)<=1e-9)pairs=[...pairs,[a,b]];
    }
    if(!Number.isFinite(earliest))break;let changed=false;
    for(const who of new Set(pairs.flat())){const trace=traces.get(who)!,at=sourceTrajectoryPositionAt(trace,earliest);if(!at.moving||stopped.has(who))continue;const old=prior.get(who),index=rows.findIndex(r=>r.residentId===who);if(!old?.route||index<0)continue;const proposed=rows[index],intent=effectiveIntents.get(who)!;
     rows[index]={...withIntent(old,intent,now),direction:proposed.direction,progressMetres:at.progress,progressAtDirectionStart:at.progress,directionStartedAbsoluteMinute:now,inside:false,status:'travelling',reason:'traffic-peer-held',pendingTargetPlaceId:proposed.pendingTargetPlaceId,arrivalEvidence:'none',arrivedAtAbsoluteMinute:null};
     traces.set(who,stopSourceTrajectory(trace,earliest,now));stopped.add(who);changed=true;
    }if(!changed)break;
   }
  }
  type Mutable= {-readonly[K in keyof VillageLifeJourney]:VillageLifeJourney[K]};
  const occupied=new Map<string,string>(),routes:VillageSitePath[]=[],stands=new Map<string,VillageSitePoint>();
  const bodyByResident=new Map(rows.map(r=>[r.residentId,baseSite?villageLifeNavigationPeerBody(r,baseSite,siteIdentity):{radius:.85,height:3.5}])),temporalResidents=new Set(rows.filter(r=>baseSite&&temporalSourceJourney(r,baseSite,siteIdentity)).map(r=>r.residentId)),bodies:PeerBodies={stands:bodyByResident,routes:new Map(),temporalResidents,futures:new Map(),now,speed:input.metresPerWorldMinute},exclusivePaths=new Set<VillageSitePath>();
  const reserveBody=(path:VillageSitePath,r:VillageLifeJourney)=>{const body=bodyByResident.get(r.residentId)!,old=bodies.routes.get(path);bodies.routes.set(path,old?{radius:Math.max(old.radius,body.radius),height:Math.max(old.height,body.height)}:body);
   if(!temporalResidents.has(r.residentId)||r.reason!==null){exclusivePaths.add(path);bodies.futures.delete(path);}else if(!exclusivePaths.has(path)){const entries=bodies.futures.get(path)??[];entries.push(futureSourceRouteTrajectory(path.sourceGroundPolyline,r.progressMetres,r.direction,now,input.metresPerWorldMinute));bodies.futures.set(path,entries);}
  };
  if(site)for(const r of rows){const ownSite=villageLifeJourneyCollisionSite(r,site);
    if(r.route&&r.status==='travelling'){routes.push(r.route);reserveBody(r.route,r);const endpoint=ownSite&&resolveVillageSiteEndpoint(ownSite,r.direction===1?r.destinationPlaceId!:r.originPlaceId!,r.residentId);if(endpoint)occupied.set(endpoint.id,r.residentId);}
    else if(r.anchorPlaceId&&!r.inside&&r.anchorPosition){const a=ownSite&&resolveVillageSiteEndpoint(ownSite,r.anchorPlaceId,r.residentId);occupied.set(a?.id??('held:'+r.anchorPlaceId),r.residentId);stands.set(r.residentId,r.anchorPosition);}
  }
  const sorted=[...rows].sort((a,b)=>b.priority-a.priority||a.residentId.localeCompare(b.residentId));
  const replacements=new Map<string,VillageLifeJourney>(),alternateBudget={edges:ALTERNATE_EDGE_BUDGET,segments:ALTERNATE_SEGMENT_BUDGET};
  for(const source of sorted){const r:Mutable={...source};const site=baseSite?villageLifeJourneyCollisionSite(r,baseSite):null;
    const obstacles=sourceObstacles.filter(obstacle=>obstacle.exceptResidentId!==r.residentId);
    if(r.neutralReturn){replacements.set(r.residentId,r);continue;}
    if(sourceChanged||r.reason==='certified-binding-changed'||r.reason?.startsWith('clip-')||r.reason?.startsWith('refuge-')||r.reason?.startsWith('workplace-')){replacements.set(r.residentId,r);continue;}
    if(!site){if(r.patrolEntry?.waypointIndex===null)delete r.patrolEntry;if(!r.route)r.reason='site-unavailable';replacements.set(r.residentId,r);continue;}
    if(r.route){replacements.set(r.residentId,r);continue;}
    const intent=effectiveIntents.get(r.residentId)!,plan=matchingPatrol(site,intent);
    if(r.patrol&&(!plan||r.patrol.planId!==plan.id||r.patrol.waypointIndex>=plan.waypoints.length)){
      r.status='unmapped';r.reason='patrol-metadata-unavailable';replacements.set(r.residentId,r);continue;
    }
    if(r.patrolEntry&&(!plan||r.patrolEntry.planId!==plan.id||r.patrolEntry.waypointIndex!==null&&r.patrolEntry.waypointIndex>=plan.waypoints.length)){
      r.status='unmapped';r.reason='patrol-metadata-unavailable';replacements.set(r.residentId,r);continue;
    }
    if(r.patrolEntry?.waypointIndex!==undefined&&r.patrolEntry.waypointIndex!==null){
      const entry=r.patrolEntry,waypoint=plan!.waypoints[entry.waypointIndex!];
      if(r.inside||r.arrivalEvidence!=='certified-route-arrival'||r.arrivedAtAbsoluteMinute===null
        ||r.destinationPlaceId!==waypoint.placeId||r.anchorPlaceId!==waypoint.placeId){
        r.status='unmapped';r.reason='patrol-entry-arrival-unqualified';replacements.set(r.residentId,r);continue;
      }
      // The real entry journey earns no circuit leg. Dwell at the actually
      // reached point before starting the first recurring patrol leg.
      r.patrol={planId:plan!.id,issuedAbsoluteMinute:r.issuedAbsoluteMinute,waypointIndex:entry.waypointIndex!,completedLegs:0,
        dwellUntilAbsoluteMinute:r.arrivedAtAbsoluteMinute+plan!.dwellWorldMinutes};
      delete r.patrolEntry;
    }
    if(r.patrolEntry?.waypointIndex===null&&r.anchorPlaceId===r.targetPlaceId)delete r.patrolEntry;
    // No one starts a patrol by a registry label or an initial placement. Its
    // first phase begins only after reaching the ordinary goal on a real leg.
    if(plan&&!r.patrol&&!r.patrolEntry&&decisionBoundary&&!r.route&&!r.inside&&r.status==='at-threshold'&&r.reason===null
      &&r.anchorPlaceId===r.targetPlaceId&&r.arrivalEvidence==='certified-route-arrival'&&r.arrivedAtAbsoluteMinute!==null){
      r.patrol={planId:plan.id,issuedAbsoluteMinute:r.issuedAbsoluteMinute,waypointIndex:0,completedLegs:0,dwellUntilAbsoluteMinute:null};
    }
    let goal=r.patrol?plan!.waypoints[r.patrol.waypointIndex].placeId:r.targetPlaceId;
    if(r.patrol&&r.anchorPlaceId===goal&&!r.route&&!r.inside){
      if(r.arrivalEvidence!=='certified-route-arrival'||r.destinationPlaceId!==goal||r.arrivedAtAbsoluteMinute===null){
        r.status='unmapped';r.reason='patrol-arrival-unqualified';replacements.set(r.residentId,r);continue;
      }
      const p=r.patrol;
      if(p.dwellUntilAbsoluteMinute===null){
        const count=p.completedLegs+1,until=r.arrivedAtAbsoluteMinute+plan!.dwellWorldMinutes;
        if(!Number.isSafeInteger(count)||!minute(until)){r.status='unmapped';r.reason='patrol-progress-exhausted';replacements.set(r.residentId,r);continue;}
        r.patrol={...p,completedLegs:count,dwellUntilAbsoluteMinute:until};
      }
      if(!decisionBoundary||now+EPS<r.patrol.dwellUntilAbsoluteMinute!){r.status='at-threshold';r.reason=null;replacements.set(r.residentId,r);continue;}
      r.patrol={...r.patrol,waypointIndex:(r.patrol.waypointIndex+1)%plan!.waypoints.length,dwellUntilAbsoluteMinute:null};
      goal=plan!.waypoints[r.patrol.waypointIndex].placeId;
    }
    let target=resolveVillageSiteEndpoint(site,goal,r.residentId);
    if(!r.anchorPlaceId){
      const initial=input.initialPlaces?initialPlaces.get(r.residentId):undefined;
      if(input.initialPlaces&&!initial)throw Error('Initial place binding misses a resident.');
      const initialPlaceId=initial?.placeId??r.targetPlaceId,initialTarget=initial?resolveVillageSiteEndpoint(site,initialPlaceId,r.residentId):target,initialIndoor=initial?.indoor??r.indoor;
      if(!initialTarget){r.status='unmapped';r.reason='destination-unmapped';}
      else if(input.allowInitialPlacement===false){r.status='unmapped';r.reason='initial-placement-required';}
      else if(!initialIndoor&&(occupied.has(initialTarget.id)||[...stands.values()].some(p=>Math.abs(p[1]-initialTarget.sourceGroundPoint[1])<site.capsule.height&&Math.hypot(p[0]-initialTarget.sourceGroundPoint[0],p[2]-initialTarget.sourceGroundPoint[2])<2*site.capsule.radius-EPS))){r.status='waiting';r.reason='destination-reserved';}
      else{r.anchorPlaceId=initialPlaceId;r.anchorPosition=initialTarget.sourceGroundPoint;r.status=initialIndoor?'indoors':'at-threshold';r.inside=initialIndoor;
        r.sourceSha256=site.sourceSha256;r.sourceSiteIdentity=siteIdentity;r.arrivalEvidence='initial-placement';r.reason=null;
        if(!initialIndoor){occupied.set(initialTarget.id,r.residentId);stands.set(r.residentId,initialTarget.sourceGroundPoint);}}
      if(!r.anchorPlaceId||r.anchorPlaceId===r.targetPlaceId){replacements.set(r.residentId,r);continue;}
    }
    if(r.anchorPlaceId===goal){
      if(r.inside&&!r.indoor){
        // A held escape goal is not permission to materialize outside into a
        // burning/blocked doorway. A real nonzero escape leg uses its normal
        // directional fire-clearance rule farther below.
        if(blockedStand(r.anchorPosition!,site,obstacles)){r.status='waiting';r.reason='dynamic-obstacle';replacements.set(r.residentId,r);continue;}
        if(!decisionBoundary){r.status='waiting';r.reason='awaiting-decision-boundary';replacements.set(r.residentId,r);continue;}
        const p=r.anchorPosition!,own=site.capsule,fallback=ordinaryJourneySite(site).capsule,blocked=[...stands].some(([who,q])=>{const peerBody=bodies.stands.get(who)??fallback;return who!==r.residentId&&p[1]<q[1]+peerBody.height&&p[1]+own.height>q[1]&&Math.hypot(q[0]-p[0],q[2]-p[2])<own.radius+peerBody.radius-EPS;})
          ||routes.some(path=>{const peerBody=bodies.routes.get(path)??fallback;return path.sourceGroundPolyline.slice(1).some((b,i)=>{const a=path.sourceGroundPolyline[i];return p[1]<Math.max(a[1],b[1])+peerBody.height&&p[1]+own.height>Math.min(a[1],b[1])&&pointSegment(p,a,b)<own.radius+peerBody.radius-EPS;});});
        if(blocked){r.status='waiting';r.reason='doorway-reserved';replacements.set(r.residentId,r);continue;}
        if(target){occupied.set(target.id,r.residentId);stands.set(r.residentId,target.sourceGroundPoint);}
      }
      r.inside=r.indoor;r.status=r.indoor?'indoors':'at-threshold';r.reason=null;r.pendingTargetPlaceId=null;
      if(r.indoor&&target&&occupied.get(target.id)===r.residentId)occupied.delete(target.id);if(r.indoor)stands.delete(r.residentId);
      replacements.set(r.residentId,r);continue;}
    if(!decisionBoundary){r.status='waiting';if(!r.reason)r.reason='awaiting-decision-boundary';replacements.set(r.residentId,r);continue;}
    let path:VillageSitePath|null=null,entryIndex:number|undefined;
    const primaryBlocked=!target||!!target&&blockedStand(target.sourceGroundPoint,site,obstacles)||occupied.has(target.id)&&occupied.get(target.id)!==r.residentId;
    if(plan&&!r.patrol&&primaryBlocked){
      // Only consecutive ordinary world decisions in the same duty/source
      // context age this wait. Missing-site/foreign-source holds clear it.
      const gap=now-state.absoluteMinute;
      if(!r.patrolEntry||gap>1+EPS)r.patrolEntry={planId:plan.id,issuedAbsoluteMinute:r.issuedAbsoluteMinute,blockedSinceAbsoluteMinute:now,waypointIndex:null};
      if(now+EPS>=r.patrolEntry.blockedSinceAbsoluteMinute+PATROL_ENTRY_WAIT_MINUTES){
        const alternate=clearPatrolEntryPath(site,siteIdentity,r,plan,rows,replacements,occupied,routes);
        if(alternate){target=alternate.target;goal=alternate.placeId;path=alternate.path;entryIndex=alternate.index;}
      }
    }else if(r.patrolEntry?.waypointIndex===null)delete r.patrolEntry;
    if(!target){r.status='waiting';r.reason='destination-unmapped';replacements.set(r.residentId,r);continue;}
    path??=routeFor(site,r.residentId,r.anchorPlaceId,goal);
    if(!path){r.status='waiting';r.reason='route-unmapped';replacements.set(r.residentId,r);continue;}
    if(blockedStand(target.sourceGroundPoint,site,obstacles)){r.status='waiting';r.reason='dynamic-obstacle';replacements.set(r.residentId,r);continue;}
    if(occupied.has(target.id)&&occupied.get(target.id)!==r.residentId){r.status='waiting';r.reason='destination-reserved';replacements.set(r.residentId,r);continue;}
    if(reservedPathConflict(path,r.residentId,site,routes,stands,undefined,obstacles,bodies)){
      const alternate=clearAlternatePath(site,path,r.residentId,routes,stands,alternateBudget,obstacles,bodies);
      if(!alternate){r.status='waiting';r.reason=obstacleRanges(path,site,obstacles).length?'dynamic-obstacle':'corridor-reserved';replacements.set(r.residentId,r);continue;}path=alternate;
    }
    stands.delete(r.residentId);
    const old=resolveVillageSiteEndpoint(site,r.anchorPlaceId,r.residentId);if(old&&occupied.get(old.id)===r.residentId)occupied.delete(old.id);
    if(path.lengthMetres<=EPS){r.anchorPlaceId=goal;r.anchorPosition=target.sourceGroundPoint;r.inside=r.indoor;r.status=r.indoor?'indoors':'at-threshold';r.reason=null;}
    else{r.originPlaceId=r.anchorPlaceId;r.destinationPlaceId=goal;r.startedAbsoluteMinute=now;r.progressMetres=0;r.direction=1;r.directionStartedAbsoluteMinute=now;r.progressAtDirectionStart=0;
      if(entryIndex!==undefined)r.patrolEntry={...r.patrolEntry!,waypointIndex:entryIndex};
      r.route=path;r.pendingTargetPlaceId=null;r.status='travelling';r.inside=false;r.reason=null;r.sourceSha256=site.sourceSha256;r.sourceSiteIdentity=siteIdentity;
      r.arrivalEvidence='none';r.arrivedAtAbsoluteMinute=null;routes.push(path);reserveBody(path,r);occupied.set(target.id,r.residentId);}
    replacements.set(r.residentId,r);
  }
  const revision=state.sourceSha256===null?bindSite?.navigationRevision:state.navigationRevision,allocation=state.sourceSha256===null?bindSite?.navigationAllocation:state.navigationAllocation;
  const next=finish({schemaVersion:1 as const,absoluteMinute:now,siteIdentity:state.siteIdentity??siteIdentity,sourceSha256:state.sourceSha256??bindSite?.sourceSha256??null,
    profile:state.profile??bindSite?.profile??null,...(revision?{navigationRevision:revision}:{}),...(allocation?{navigationAllocation:allocation}:{}),residents:rows.map(r=>replacements.get(r.residentId)!)});stateSites.set(next,site);return next;
}

export function sampleVillageLifeNavigation(value:VillageLifeNavigationState,site:VillageSiteLayout|null):readonly VillageLifeNavigationSample[]{
  const state=parseVillageLifeNavigation(value);if(site)validSite(site);
  const matches=!!site&&site.sourceSha256===state.sourceSha256&&site.profile===state.profile&&state.navigationRevision===site.navigationRevision
    &&(!site.navigationRevision||!!site.navigationAllocation)&&sameVillageSiteNavigationAllocation(state.navigationAllocation,site.navigationAllocation);
  return Object.freeze(state.residents.map(r=>{
    const scoped=site?villageLifeJourneyCollisionSite(r,site):null;
    let reason=r.reason;const sourceOK=matches&&!!scoped&&r.sourceSha256===scoped.sourceSha256&&routeStillMatches(r,scoped)
      &&(!r.anchorPlaceId||!r.anchorPosition||samePoint(resolveVillageSiteEndpoint(scoped,r.anchorPlaceId,r.residentId)?.sourceGroundPoint??[NaN,NaN,NaN],r.anchorPosition));
    if(!sourceOK && !(matches && r.sourceSha256===null && r.anchorPosition===null))reason=site?'source-site-changed':'site-unavailable';
    const located=sourceOK&&r.status!=='unmapped'&&r.status!=='indoors'&&!r.inside?currentPosition(r,scoped!):{position:null,yawRadians:0};
    return Object.freeze({residentId:r.residentId,status:sourceOK?r.status:'unmapped',position:located.position?Object.freeze([...located.position]) as VillageSitePoint:null,
      yawRadians:located.yawRadians,moving:sourceOK&&r.status==='travelling'&&r.reason===null,placeId:r.route?null:r.anchorPlaceId,targetPlaceId:r.targetPlaceId,
      reason,arrivalEvidence:r.arrivalEvidence,arrivedAtAbsoluteMinute:r.arrivedAtAbsoluteMinute});
  }));
}

/** A real mid-route traffic stop may expose only the resident's certified
 * neutral refuge body. This proves current physical ownership, not arrival,
 * work/contact credit, arbitrary route waiting, or future movement. */
export function ownsQualifiedVillageLifeTrafficHold(value:VillageLifeNavigationState,site:VillageSiteLayout,residentId:string):boolean{
 const state=parseVillageLifeNavigation(value);validSite(site);const r=state.residents.find(r=>r.residentId===residentId);
 if(!r?.emergencyRefuge||r.emergencyTraversal||!r.route||r.inside||r.status!=='travelling'||r.reason!=='traffic-peer-held'||r.arrivalEvidence!=='none'||r.arrivedAtAbsoluteMinute!==null
  ||r.progressMetres<=EPS||r.progressMetres>=r.route.lengthMetres-EPS||r.directionStartedAbsoluteMinute!==state.absoluteMinute||r.lastAbsoluteMinute!==state.absoluteMinute||r.progressAtDirectionStart!==r.progressMetres
  ||r.sourceSha256!==site.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(r,site))return false;
 const scope=villageLifeJourneyCollisionSite(r,site);if(!scope)return false;const p=sourcePolylinePosition(r.route.sourceGroundPolyline,r.progressMetres),own=scope.capsule;
 for(const peer of state.residents){if(peer.residentId===residentId||peer.inside)continue;const q=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!q)continue;
  if(peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,site))return false;const body=villageLifeNavigationPeerBody(peer,site,state.siteIdentity);
  if(p[1]<q[1]+body.height&&q[1]<p[1]+own.height&&Math.hypot(p[0]-q[0],p[2]-q[2])<own.radius+body.radius-EPS)return false;
 }return true;
}

/** Same neutral-only ownership gate for an ordinary private work branch. */
export function ownsQualifiedVillageWorkplaceTrafficHold(value:VillageLifeNavigationState,site:VillageSiteLayout,residentId:string):boolean{
 const state=parseVillageLifeNavigation(value);validSite(site);
 if(state.profile!==site.profile||state.sourceSha256!==site.sourceSha256||state.navigationRevision!==site.navigationRevision||!sameVillageSiteNavigationAllocation(state.navigationAllocation,site.navigationAllocation))return false;const r=state.residents.find(r=>r.residentId===residentId);
 if(!r?.workplaceRoute||r.emergencyRefuge||r.emergencyTraversal||!r.route||r.inside||r.status!=='travelling'||r.reason!=='traffic-peer-held'||r.arrivalEvidence!=='none'||r.arrivedAtAbsoluteMinute!==null
  ||r.progressMetres<=EPS||r.progressMetres>=r.route.lengthMetres-EPS||r.directionStartedAbsoluteMinute!==state.absoluteMinute||r.lastAbsoluteMinute!==state.absoluteMinute||r.progressAtDirectionStart!==r.progressMetres
  ||r.sourceSha256!==site.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(r,site))return false;
 const scope=villageLifeJourneyCollisionSite(r,site);if(!scope)return false;const p=sourcePolylinePosition(r.route.sourceGroundPolyline,r.progressMetres),own=scope.capsule;
 for(const peer of state.residents){if(peer.residentId===residentId||peer.inside)continue;const q=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!q)continue;
  if(peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,site))return false;const body=villageLifeNavigationPeerBody(peer,site,state.siteIdentity);
  if(p[1]<q[1]+body.height&&q[1]<p[1]+own.height&&Math.hypot(p[0]-q[0],p[2]-q[2])<own.radius+body.radius-EPS)return false;
 }return true;
}

/** Before a source-qualified tool may occupy a larger stationary envelope,
 * check actual peers and their complete remaining arcs. This grants neither
 * equipment, source geometry qualification nor operational/work credit. */
export function ownsExclusiveVillageWorkplaceOperation(value:VillageLifeNavigationState,site:VillageSiteLayout,residentId:string,body:VillageSiteLayout['capsule']):boolean{
 const state=parseVillageLifeNavigation(value);validSite(site);
 if(state.profile!==site.profile||state.sourceSha256!==site.sourceSha256||state.navigationRevision!==site.navigationRevision||!sameVillageSiteNavigationAllocation(state.navigationAllocation,site.navigationAllocation))return false;
 if(!Number.isFinite(body.radius)||body.radius<=0||body.radius>4||!Number.isFinite(body.height)||body.height<=0||body.height>10)return false;
 const r=state.residents.find(r=>r.residentId===residentId),cap=r?.workplaceRoute&&findVillageWorkplaceRoute(site,r.workplaceRoute,residentId);
 if(!r||!cap||r.inside||r.route||r.status!=='at-threshold'||r.reason!==null||r.targetPlaceId!==cap.placeId||r.anchorPlaceId!==cap.placeId
  ||r.arrivalEvidence!=='certified-route-arrival'||r.arrivedAtAbsoluteMinute===null||r.startedAbsoluteMinute===null||r.arrivedAtAbsoluteMinute<r.startedAbsoluteMinute
  ||r.sourceSha256!==site.sourceSha256||r.sourceSiteIdentity!==state.siteIdentity||!r.anchorPosition||!samePoint(r.anchorPosition,cap.proof.sourceGroundPoint)||!matchesVillageLifeSourceJourney(r,site))return false;
 const p=r.anchorPosition,zone:VillageLifeNavigationObstacle={id:'workplace-operation-probe',kind:'solid',sourceSha256:site.sourceSha256,profile:site.profile,activeFromAbsoluteMinute:state.absoluteMinute,bounds:{min:[p[0]-body.radius,p[1],p[2]-body.radius],max:[p[0]+body.radius,p[1]+body.height,p[2]+body.radius]}};
 for(const peer of state.residents){if(peer.residentId===residentId||peer.inside)continue;const q=peer.route?sourcePolylinePosition(peer.route.sourceGroundPolyline,peer.progressMetres):peer.anchorPosition;if(!q)continue;
  if(peer.sourceSha256!==site.sourceSha256||peer.sourceSiteIdentity!==state.siteIdentity||!matchesVillageLifeSourceJourney(peer,site))return false;
  const otherSite={...site,capsule:villageLifeNavigationPeerBody(peer,site,state.siteIdentity)};
  if(villageLifeObstacleContainsPoint(q,otherSite,zone))return false;
  if(peer.route){const trace=futureSourceRouteTrajectory(peer.route.sourceGroundPolyline,peer.progressMetres,peer.direction,state.absoluteMinute,1),points=[...trace.map(segment=>segment.from),trace[trace.length-1].to];
   if(obstacleRanges({sourceGroundPolyline:points},otherSite,[zone]).length)return false;
  }
 }return true;
}

/** A neutral exterior wait needs its own reached, person-bound stand. This is
 * a read-only reservation check, not an arrival or workstation certificate.
 * Recheck saved peers as well as the current point: a duplicate anchor, nearby
 * exterior body or already-reserved swept corridor cannot become free merely
 * because that other resident is not rendered. Indoor queues remain abstract. */
export function ownsExclusiveVillageLifeExteriorAnchor(value:VillageLifeNavigationState,site:VillageSiteLayout|null,residentId:string):boolean{
  const state=parseVillageLifeNavigation(value);if(!site)return false;validSite(site);
  const resident=state.residents.find(r=>r.residentId===residentId);
  // A measured neutral return owns the actual original public stand while a
  // larger future body cannot depart. Its current target/indoor wish is not a
  // relocation, and this narrow ownership grants no work or travel animation.
  if(resident?.neutralReturn&&resident.status==='at-threshold'&&!resident.inside&&!resident.route
    &&(resident.reason===null||resident.reason==='neutral-return-clearance-required')
    &&qualifiedVillageNeutralReturnMotion(resident,site))return ownsCertifiedExteriorAnchor(state,site,resident,true);
  if(!resident||resident.status!=='at-threshold'||resident.reason!==null||resident.inside||resident.indoor||resident.route
    ||resident.arrivalEvidence==='none'||!resident.anchorPlaceId||resident.anchorPlaceId!==resident.targetPlaceId||!resident.anchorPosition)return false;
  return ownsCertifiedExteriorAnchor(state,site,resident);
}

/** An actually reached patrol turn is independent of the routine's public
 * destination. This qualifies only ownership of the existing exterior stand,
 * never a watch post, a clip, equipment, work or a new physical arrival. */
export function ownsExclusiveVillageLifePatrolDwellAnchor(value:VillageLifeNavigationState,site:VillageSiteLayout|null,intent:VillageLifeIntent):boolean{
  const state=parseVillageLifeNavigation(value);if(!site)return false;validSite(site);
  const r=state.residents.find(row=>row.residentId===intent.residentId),p=r?.patrol;
  const plan=p&&site.patrols?.find(plan=>plan.id===p.planId&&plan.residentId===intent.residentId);
  if(!r||!p||!plan||r.status!=='at-threshold'||r.reason!==null||r.route||r.inside||r.indoor
    ||intent.activityKey!=='patrol'||intent.reason!=='routine'||intent.indoor
    ||r.activityKey!==intent.activityKey||r.priority!==intent.priority||r.issuedAbsoluteMinute!==intent.issuedAbsoluteMinute
    ||p.issuedAbsoluteMinute!==intent.issuedAbsoluteMinute||plan.activity!==intent.activity
    ||plan.routineTargetPlaceId!==intent.targetPlaceId||r.targetPlaceId!==intent.targetPlaceId
    ||p.dwellUntilAbsoluteMinute===null||state.absoluteMinute>=p.dwellUntilAbsoluteMinute
    ||r.arrivalEvidence!=='certified-route-arrival'||r.arrivedAtAbsoluteMinute===null||r.arrivedAtAbsoluteMinute>state.absoluteMinute
    ||r.anchorPlaceId!==plan.waypoints[p.waypointIndex]?.placeId||!r.anchorPosition
    ||state.siteIdentity!==`${site.profile}:${site.sourceSha256}:${site.navigationRevision??'source-site'}`
    ||!routeStillMatches(r,site))return false;
  return ownsCertifiedExteriorAnchor(state,site,r);
}

/** A route queue is physically different from its intended destination action.
 * Only a real reached exterior point may retain a neutral body. The same whole
 * peer/corridor checks apply even when those other people have no drawn art. */
export function ownsExclusiveVillageLifeRouteWaitAnchor(value:VillageLifeNavigationState,site:VillageSiteLayout|null,residentId:string):boolean{
  const state=parseVillageLifeNavigation(value);if(!site)return false;validSite(site);
  const resident=state.residents.find(r=>r.residentId===residentId);
  const scoped=resident&&villageLifeJourneyCollisionSite(resident,site);if(!scoped)return false;site=scoped;
  if(!resident||resident.status!=='waiting'||resident.inside||resident.route||resident.patrol
    ||!['destination-reserved','corridor-reserved','route-unmapped','destination-unmapped','awaiting-decision-boundary'].includes(resident.reason??'')
    ||resident.arrivalEvidence!=='certified-route-arrival'||resident.arrivedAtAbsoluteMinute===null||resident.arrivedAtAbsoluteMinute>state.absoluteMinute
    ||!resident.anchorPlaceId||resident.anchorPlaceId===resident.targetPlaceId||!resident.anchorPosition
    ||state.siteIdentity!==`${site.profile}:${site.sourceSha256}:${site.navigationRevision??'source-site'}`)return false;
  const reachedPlace=resident.direction===1?resident.destinationPlaceId:resident.originPlaceId;
  const arrival=resident.originPlaceId&&resident.destinationPlaceId?routeFor(site,resident.residentId,resident.originPlaceId,resident.destinationPlaceId):null;
  if(reachedPlace!==resident.anchorPlaceId||!arrival||arrival.lengthMetres<=EPS
    ||!samePoint(arrival.sourceGroundPolyline[resident.direction===1?arrival.sourceGroundPolyline.length-1:0],resident.anchorPosition))return false;
  return ownsCertifiedExteriorAnchor(state,site,resident);
}

function ownsCertifiedExteriorAnchor(state:VillageLifeNavigationState,site:VillageSiteLayout,resident:VillageLifeJourney,publicNeutralStand=false):boolean{
  const ownSite=villageLifeJourneyCollisionSite(resident,site);if(!ownSite)return false;site=ownSite;const ownBody=site.capsule;
  if(state.profile!==site.profile||state.sourceSha256!==site.sourceSha256
    ||state.navigationRevision!==site.navigationRevision
    ||site.navigationRevision&&!site.navigationAllocation||!sameVillageSiteNavigationAllocation(state.navigationAllocation,site.navigationAllocation)
    ||resident.sourceSha256!==site.sourceSha256||resident.sourceSiteIdentity!==state.siteIdentity
    ||!resident.anchorPlaceId||!resident.anchorPosition)return false;
  const binding=site.residentPlaceBindings.find(b=>b.residentId===resident.residentId&&b.placeId===resident.anchorPlaceId)
    ??(publicNeutralStand&&resident.neutralReturn&&qualifiedVillageNeutralReturnMotion(resident,site)?site.placeBindings.find(b=>b.placeId===resident.anchorPlaceId):undefined);
  const anchor=resolveVillageSiteEndpoint(site,resident.anchorPlaceId,resident.residentId);
  if(binding?.status!=='mapped-exterior'||!anchor||binding.anchorId!==anchor.id
    ||!samePoint(anchor.sourceGroundPoint,resident.anchorPosition))return false;
  const p=anchor.sourceGroundPoint;
  for(const peer of state.residents){
    if(peer.residentId===resident.residentId||peer.inside)continue;const peerBody=villageLifeNavigationPeerBody(peer,site,state.siteIdentity);
    if(peer.route){
      if(peer.sourceSha256!==site.sourceSha256||!routeStillMatches(peer,site))return false;
      // Navigation owns a whole swept corridor until its journey completes.
      if(peer.route.sourceGroundPolyline.slice(1).some((b,i)=>{const a=peer.route!.sourceGroundPolyline[i];
        return p[1]<Math.max(a[1],b[1])+peerBody.height&&p[1]+ownBody.height>Math.min(a[1],b[1])
          &&pointSegment(p,a,b)<ownBody.radius+peerBody.radius-EPS;}))return false;
    }else if(peer.anchorPlaceId&&peer.anchorPosition){
      const peerSite=villageLifeJourneyCollisionSite(peer,ordinaryJourneySite(site)),other=peerSite&&resolveVillageSiteEndpoint(peerSite,peer.anchorPlaceId,peer.residentId);
      if(!other||peer.sourceSha256!==site.sourceSha256||!samePoint(other.sourceGroundPoint,peer.anchorPosition))return false;
      const q=other.sourceGroundPoint;
      if(other.id===anchor.id||p[1]<q[1]+peerBody.height&&p[1]+ownBody.height>q[1]&&Math.hypot(p[0]-q[0],p[2]-q[2])<ownBody.radius+peerBody.radius-EPS)return false;
    }
  }
  return true;
}
