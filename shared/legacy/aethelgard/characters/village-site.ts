/** Source-frame exterior navigation binding. Coordinates remain private caller
 * inputs; a place name, household or routine never creates a physical location.
 * Certificates describe static clearance, not animation, arrival or indoor use. */
import { placeDataArray, placeDataRecord, placeId } from '../place-use';
import type {VillageSiteEmergencyTarget} from './village-emergency-targets';
import type {VillageSiteEmergencyTraversal} from './village-emergency-traversal';
import type {VillageSiteEmergencyRefuge} from './village-emergency-refuges';
import type {VillageSiteWorkplaceRoute} from './village-workplace-routes';
export type {VillageSiteEmergencyTraversal} from './village-emergency-traversal';
export type {VillageSiteEmergencyTarget} from './village-emergency-targets';
export type {VillageSiteEmergencyRefuge} from './village-emergency-refuges';

export type VillageSiteProfile = 'desktop' | 'quest';
export type VillageSitePoint = readonly [number, number, number];
export interface VillageSiteAnchor {
  readonly id: string; readonly sourceActor: string;
  readonly sourceGroundPoint: VillageSitePoint; readonly capsuleBottomPoint: VillageSitePoint;
  readonly standingOnly: true;
}
export interface VillageSiteRoute {
  readonly id: string; readonly from: string; readonly to: string; readonly reversible: true;
  readonly sourceGroundPolyline: readonly VillageSitePoint[];
  readonly capsuleBottomPolyline: readonly VillageSitePoint[]; readonly lengthMetres: number;
}
export interface VillageSitePlaceBinding {
  readonly placeId: string; readonly anchorId: string | null;
  readonly status: 'mapped-exterior' | 'unmapped';
}
export interface VillageSiteResidentPlaceBinding extends VillageSitePlaceBinding { readonly residentId: string }
export interface VillageSiteNavigationAllocation {
  readonly generation: string; readonly desktopRevision: string; readonly questRevision: string;
}
export function sameVillageSiteNavigationAllocation(a:VillageSiteNavigationAllocation|undefined,b:VillageSiteNavigationAllocation|undefined):boolean {
  return a===b||!!a&&!!b&&a.generation===b.generation&&a.desktopRevision===b.desktopRevision&&a.questRevision===b.questRevision;
}
/** Explicit local lane patrol authoring, independent of the abstract life goal.
 * These registered source waypoints are not new homes, wells or workstations. */
export interface VillageSitePatrolPlan {
  readonly id: string; readonly residentId: string; readonly activity: string;
  readonly routineTargetPlaceId: string;
  readonly waypoints: readonly { readonly placeId: string; readonly purpose: 'lane-patrol'; readonly anchorId: string }[];
  readonly dwellWorldMinutes: number;
}
export interface VillageSiteLayout {
  readonly profile: VillageSiteProfile; readonly sourceSha256: string;
  readonly frame: 'source-root-local-metres';
  readonly capsule: { readonly height: number; readonly radius: number };
  readonly anchors: readonly VillageSiteAnchor[]; readonly routes: readonly VillageSiteRoute[];
  readonly placeBindings: readonly VillageSitePlaceBinding[];
  /** Fixed person/place stands, never an offset invented around a shared anchor. */
  readonly residentPlaceBindings: readonly VillageSiteResidentPlaceBinding[];
  /** Exact source templates for temporary action aliases; never registry places. */
  readonly emergencyTargets?:readonly VillageSiteEmergencyTarget[];
  /** Resident/clip-specific source edges, invisible to the ordinary source graph. */
  readonly emergencyTraversals?:readonly VillageSiteEmergencyTraversal[];
  /** Source-qualified evacuation destinations; topology stays privately scoped. */
  readonly emergencyRefuges?:readonly VillageSiteEmergencyRefuge[];
  /** Person-bound ordinary workplace branches; never global terrain edges. */
  readonly workplaceRoutes?:readonly VillageSiteWorkplaceRoute[];
  /** New optional source allocation: old bound saves must never adopt it. */
  readonly navigationRevision?: string;
  /** Exact cross-profile pair. Unpaired candidates are offline authoring only. */
  readonly navigationAllocation?: VillageSiteNavigationAllocation;
  readonly patrols?: readonly VillageSitePatrolPlan[];
  readonly sourceProof?: { readonly coordinateRoundingMetres: number; readonly seamPairClosureToleranceMetres: number;
    readonly maximumMeasuredSeamGapMetres: number; readonly originalTriangleNarrowphase: boolean };
}
export interface VillageSitePath {
  readonly sourceGroundPolyline: readonly VillageSitePoint[];
  readonly capsuleBottomPolyline: readonly VillageSitePoint[]; readonly lengthMetres: number;
  readonly legs: readonly { readonly id: string; readonly reverse: boolean }[];
}
export interface VillageSiteWorkplaceAnchor {
  readonly residentId: string; readonly placeId: string; readonly anchorId: string;
  readonly sourceGroundPoint: VillageSitePoint; readonly yawRadians: number;
  readonly sourceRouteId: string; readonly reverse: boolean;
}
export interface VillageSiteRigidClearance {
  readonly sourceSha256: string;
  readonly proxy: { readonly radiusMetres: number; readonly bottomAboveGroundMetres: number;
    readonly topAboveGroundMetres: number; readonly rigidSourceMarginMetres: number; readonly terrainContactToleranceMetres: number };
  readonly anchors: readonly { readonly anchorId: string; readonly qualified: boolean }[];
  readonly routes: readonly { readonly routeId: string; readonly qualified: boolean }[];
}
const validatedRigidProofs = new WeakMap<VillageSiteRigidClearance, VillageSiteLayout>();
interface VillageSiteIndex {
  readonly anchors:Map<string,VillageSiteAnchor>;
  readonly places:Map<string,VillageSitePlaceBinding>;
  readonly residents:Map<string,VillageSiteResidentPlaceBinding>;
  readonly adjacency:Map<string,readonly {from:string;route:VillageSiteRoute;reverse:boolean;next:string}[]>;
}
const siteIndexes=new WeakMap<VillageSiteLayout,VillageSiteIndex>();
/** Index only immutable source layouts. Derived/filtered sites receive their
 * own index; neither source identity nor explicit unmapped overrides disappear. */
function siteIndex(site:VillageSiteLayout):VillageSiteIndex {
  let index=siteIndexes.get(site);if(index)return index;
  const anchors=new Map(site.anchors.map(a=>[a.id,a])),places=new Map<string,VillageSitePlaceBinding>(),residents=new Map<string,VillageSiteResidentPlaceBinding>(),adjacency=new Map<string,{from:string;route:VillageSiteRoute;reverse:boolean;next:string}[]>();
  for(const row of site.placeBindings)if(!places.has(row.placeId))places.set(row.placeId,row);
  for(const row of site.residentPlaceBindings){const key=`${row.residentId}\0${row.placeId}`;if(!residents.has(key))residents.set(key,row);}
  for(const route of site.routes)for(const [from,next,reverse]of [[route.from,route.to,false],[route.to,route.from,true]] as const){let legs=adjacency.get(from);if(!legs){legs=[];adjacency.set(from,legs);}legs.push({from,next,route,reverse});}
  index={anchors,places,residents,adjacency};if(Object.isFrozen(site))siteIndexes.set(site,index);return index;
}
export interface VillageSiteOptions {
  readonly profile: VillageSiteProfile; readonly modelSha256: string;
  readonly binding: unknown; readonly certificate: unknown;
  readonly placeBindings: readonly VillageSitePlaceBinding[];
  readonly residentPlaceBindings?: readonly VillageSiteResidentPlaceBinding[];
}
type Data = any;
function own(value: unknown, budget = { remaining: 1000000 }, depth = 0): Data {
  if (--budget.remaining < 0 || depth > 32) throw Error('Village site evidence exceeds its data budget.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(placeDataArray(value).map(item => own(item, budget, depth + 1)));
  if (!value || typeof value !== 'object') throw Error('Village site evidence must be finite plain data.');
  const record = placeDataRecord(value, Object.getOwnPropertyNames(value)), out = Object.create(null);
  for (const key of Object.getOwnPropertyNames(record)) out[key] = own(record[key], budget, depth + 1);
  return Object.freeze(out);
}
const sha = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Village site requires explicit SHA-256 identities.');
  return value;
};
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
const same = (a: VillageSitePoint, b: VillageSitePoint): boolean => a.every((n, i) => near(n, b[i]));
function point(value: unknown): VillageSitePoint {
  const row = placeDataArray(value);
  if (row.length !== 3 || row.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Error('Expected finite source-frame XYZ.');
  return Object.freeze([row[0], row[1], row[2]]) as VillageSitePoint;
}
function line(value: unknown): readonly VillageSitePoint[] {
  const rows = placeDataArray(value);
  if (rows.length < 2 || rows.length > 16384) throw Error('Village site path needs a bounded measured polyline.');
  return Object.freeze(rows.map(point));
}
const length = (points: readonly VillageSitePoint[]): number => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(...p.map((n, k) => n - points[i][k])), 0);

/** Validates a separately loaded model identity against both private artifacts.
 * The supplied certificate is caller-owned CPU evidence, not a signature. */
export function createEaldholtVillageSite(options: VillageSiteOptions): VillageSiteLayout {
  const b = own(options.binding), c = own(options.certificate), model = sha(options.modelSha256);
  if (!['desktop', 'quest'].includes(options.profile) || b.schema !== 1 || c.schema !== 1
    || b.profile !== options.profile || c.profile !== options.profile || sha(b.sourceSha256) !== model || sha(c.sourceSha256) !== model
    || b.frame !== 'source-root-local-metres' || c.frame !== b.frame || c.qualified !== true || c.sourceOriginalBuffersUnchanged !== true
    || !Number.isFinite(c.capsuleClearanceMargin) || c.capsuleClearanceMargin < .005
    || !Number.isFinite(c.groundBoundaryRoundingMaxMetres) || c.groundBoundaryRoundingMaxMetres < 0 || c.groundBoundaryRoundingMaxMetres > 1e-8) {
    throw Error('Village site model identity and qualified source evidence disagree.');
  }
  const capsule = own(b.capsule);
  if (!Number.isFinite(capsule.height) || capsule.height < 1.8 || capsule.height > 3.5 || !Number.isFinite(capsule.radius) || capsule.radius < .28 || capsule.radius > 1.5
    || c.capsule.height !== capsule.height || c.capsule.radius !== capsule.radius) throw Error('Invalid village site clearance envelope.');
  const seamTolerance = c.groundSeamPairClosureToleranceMetres ?? 0, topology = c.groundSeamTopology;
  if (!Number.isFinite(seamTolerance) || seamTolerance < 0 || seamTolerance > .00002 || seamTolerance > 0 && (!topology
    || topology.sourceBufferMutation !== false || topology.sourceCoordinateRoundingMetres > 1e-8
    || topology.seamPairClosureToleranceMetres !== seamTolerance || !Number.isFinite(topology.maximumMeasuredEndpointDeltaMetres)
    || topology.maximumMeasuredEndpointDeltaMetres < 0 || topology.maximumMeasuredEndpointDeltaMetres > seamTolerance
    || !Number.isSafeInteger(topology.pairedEdgeCount) || topology.pairedEdgeCount < 0 || topology.pairedEdgeCount % 2 !== 0
    || topology.originalUnmatchedEdgeCount !== topology.pairedEdgeCount + topology.trueBoundaryEdgeCount)) throw Error('Village site seam closure needs bounded measured source topology evidence.');
  if (c.sourceTriangleNarrowphase && (c.sourceTriangleNarrowphase.originalGeometryReadOnly !== true
    || !Number.isFinite(c.sourceTriangleNarrowphase.sourceFrameMatchesMaximumMetres) || c.sourceTriangleNarrowphase.sourceFrameMatchesMaximumMetres < 0
    || c.sourceTriangleNarrowphase.sourceFrameMatchesMaximumMetres > 1e-8)) throw Error('Village site original-triangle frame proof disagrees.');
  const anchors: VillageSiteAnchor[] = [], anchorIds = new Set<string>(),anchorsById=new Map<string,VillageSiteAnchor>();
  placeDataRecord(b.anchors, Object.getOwnPropertyNames(b.anchors));
  if (Object.keys(b.anchors).length > 8192) throw Error('Village site anchor budget exceeded.');
  for (const id of Object.keys(b.anchors)) {
    placeId(id); const a = b.anchors[id], ground = point(a.sourceGroundPoint), body = point(a.capsuleBottomPoint);
    if (a.standingOnly !== true || !near(ground[0], body[0]) || !near(ground[2], body[2]) || body[1] < ground[1] || body[1] - ground[1] > .2) throw Error('Village site only supports certified standing exterior anchors.');
    anchors.push(Object.freeze({ id, sourceActor: placeId(a.sourceActor), sourceGroundPoint: ground, capsuleBottomPoint: body, standingOnly: true })); anchorIds.add(id);anchorsById.set(id,anchors[anchors.length-1]);
  }
  const routes: VillageSiteRoute[] = [], proofs = placeDataArray(c.routes);
  const proofsByEndpoints=new Map<string,Data[]>();for(const proofValue of proofs){const proof:Data=proofValue;const key=`${proof.from}\0${proof.to}`,rows=proofsByEndpoints.get(key)??[];rows.push(proof);proofsByEndpoints.set(key,rows);}
  const certifiedEndpoints=new Set<string>();
  placeDataRecord(b.routes, Object.getOwnPropertyNames(b.routes));
  if (Object.keys(b.routes).length > 8192) throw Error('Village site route budget exceeded.');
  for (const id of Object.keys(b.routes)) {
    placeId(id); const r = b.routes[id], from = placeId(r.from), to = placeId(r.to), ground = line(r.sourceGroundPolyline), body = line(r.capsuleBottomPolyline);
    const matches = proofsByEndpoints.get(`${from}\0${to}`)??[];
    if (matches.length !== 1) throw Error('Every village site route needs one matching clearance certificate.');
    const p: Data = matches[0], a = anchorsById.get(from), z = anchorsById.get(to), measured = length(ground);
    if (!a || !z || r.reversible !== true || !same(ground[0], a.sourceGroundPoint) || !same(ground[ground.length - 1], z.sourceGroundPoint)
      || !same(body[0], a.capsuleBottomPoint) || !same(body[body.length - 1], z.capsuleBottomPoint) || body.length !== ground.length
      || !Number.isFinite(r.lengthMetres) || measured <= 0 || !near(measured, r.lengthMetres) || !near(measured, p.lengthMetres)
      || p.partialPathAccepted !== false || p.findPathStatus !== 1073741824 || p.allSourceSolidEnvelopesClear !== true
      || p.groundWholeFootprintSupported !== true || p.waterAndInteriorsExcluded !== true
      || !Number.isFinite(p.groundEdgeClearanceLowerBound) || p.groundEdgeClearanceLowerBound < capsule.radius + 1e-8
      || !Number.isFinite(p.slopeLipschitzUpperBound) || p.slopeLipschitzUpperBound < 0 || p.slopeLipschitzUpperBound > Math.tan(35 * Math.PI / 180)
      || !Number.isFinite(p.capsuleBottomLiftMetres) || p.capsuleBottomLiftMetres < 0 || p.capsuleBottomLiftMetres > .2
      || JSON.stringify(p.sourceGroundPolyline) !== JSON.stringify(r.sourceGroundPolyline) || JSON.stringify(p.capsuleBottomPolyline) !== JSON.stringify(r.capsuleBottomPolyline)
      || JSON.stringify(p.corridor) !== JSON.stringify(r.corridorRefs) || !Array.isArray(r.corridorRefs) || !r.corridorRefs.length
      || r.corridorRefs.some((n: unknown) => !Number.isSafeInteger(n) || (n as number) <= 0)) throw Error('Village site route geometry does not match its certificate.');
    for (let i = 0; i < ground.length; i++) if (!near(ground[i][0], body[i][0]) || !near(ground[i][2], body[i][2]) || !near(body[i][1] - ground[i][1], p.capsuleBottomLiftMetres)) throw Error('Village site capsule/ground projection disagrees.');
    certifiedEndpoints.add(from);certifiedEndpoints.add(to);
    routes.push(Object.freeze({ id, from, to, reversible: true, sourceGroundPolyline: ground, capsuleBottomPolyline: body, lengthMetres: measured }));
  }
  if (anchors.some(anchor => !certifiedEndpoints.has(anchor.id))) throw Error('Every physical village site anchor needs certified route endpoint evidence.');
  function bindings(value: unknown, resident: boolean): VillageSiteResidentPlaceBinding[] {
    const rows = placeDataArray(own(value)), seen = new Set<string>();
    return rows.map((row: Data) => {
      const place = placeId(row.placeId), who = resident ? placeId(row.residentId) : '', key = `${who}:${place}`;
      if (seen.has(key)) throw Error('Duplicate village site place binding.'); seen.add(key);
      if (row.status !== 'mapped-exterior' && row.status !== 'unmapped' || row.status === 'unmapped' && row.anchorId !== null
        || row.status === 'mapped-exterior' && (typeof row.anchorId !== 'string' || !anchorIds.has(row.anchorId))) throw Error('Village site place binding needs an actual anchor or explicit unmapped status.');
      const result = { placeId: place, anchorId: row.anchorId, status: row.status };
      return Object.freeze(resident ? { ...result, residentId: who } : result) as VillageSiteResidentPlaceBinding;
    });
  }
  const layout: VillageSiteLayout = Object.freeze({ profile: options.profile, sourceSha256: model, frame: 'source-root-local-metres', capsule: Object.freeze({ height: capsule.height, radius: capsule.radius }),
    anchors: Object.freeze(anchors), routes: Object.freeze(routes), placeBindings: Object.freeze(bindings(options.placeBindings, false)),
    residentPlaceBindings: Object.freeze(bindings(options.residentPlaceBindings ?? [], true)),
    sourceProof: Object.freeze({ coordinateRoundingMetres: c.groundBoundaryRoundingMaxMetres, seamPairClosureToleranceMetres: seamTolerance,
      maximumMeasuredSeamGapMetres: topology?.maximumMeasuredEndpointDeltaMetres ?? 0, originalTriangleNarrowphase: Boolean(c.sourceTriangleNarrowphase) }) });
  if (b.patrols === undefined && c.patrols === undefined && b.navigationRevision === undefined && c.navigationRevision === undefined
    &&b.navigationAllocation===undefined&&c.navigationAllocation===undefined) return layout;
  const revision = sha(b.navigationRevision);
  if (revision !== c.navigationRevision || JSON.stringify(b.patrols) !== JSON.stringify(c.patrols)) throw Error('Patrol source allocation and certificate disagree.');
  let allocation:VillageSiteNavigationAllocation|undefined;
  if(b.navigationAllocation!==undefined||c.navigationAllocation!==undefined){
    const pair:Data=placeDataRecord(b.navigationAllocation,['generation','desktopRevision','questRevision']);
    if(JSON.stringify(b.navigationAllocation)!==JSON.stringify(c.navigationAllocation))throw Error('Paired navigation allocation and certificate disagree.');
    allocation=Object.freeze({generation:sha(pair.generation),desktopRevision:sha(pair.desktopRevision),questRevision:sha(pair.questRevision)});
    if(revision!==(options.profile==='desktop'?allocation.desktopRevision:allocation.questRevision))throw Error('Patrol revision does not belong to its declared profile pair.');
  }
  const rows = placeDataArray(b.patrols), ids = new Set<string>(), people = new Set<string>();
  if (!rows.length || rows.length > 100) throw Error('Patrol source allocation exceeds its bounded plan budget.');
  const patrols = rows.map((value: Data): VillageSitePatrolPlan => {
    const row: Data = placeDataRecord(value, ['id','residentId','activity','routineTargetPlaceId','waypoints','dwellWorldMinutes']);
    const id = placeId(row.id), residentId = placeId(row.residentId), target = placeId(row.routineTargetPlaceId);
    if (ids.has(id) || people.has(residentId) || typeof row.activity !== 'string' || !row.activity || row.activity.length > 400
      || !Number.isSafeInteger(row.dwellWorldMinutes) || row.dwellWorldMinutes < 1 || row.dwellWorldMinutes > 10) throw Error('Patrol needs a distinct resident, authored activity and bounded world-clock dwell.');
    ids.add(id); people.add(residentId);
    const nodes = placeDataArray(row.waypoints), seen = new Set<string>(), anchorSeen = new Set<string>();
    if (nodes.length < 2 || nodes.length > 16) throw Error('Patrol requires two to sixteen distinct physical waypoints.');
    const waypoints = nodes.map((value: Data) => {
      const node: Data = placeDataRecord(value, ['placeId','purpose','anchorId']), localPlace = placeId(node.placeId);
      const binding = layout.residentPlaceBindings.find(b => b.residentId === residentId && b.placeId === localPlace);
      const anchor = resolveVillageSiteEndpoint(layout, localPlace, residentId);
      if (node.purpose !== 'lane-patrol' || seen.has(localPlace) || !binding || binding.status !== 'mapped-exterior' || !anchor
        || node.anchorId !== anchor.id || anchorSeen.has(anchor.id) || localPlace === target) throw Error('Patrol requires distinct person-bound certified lane stands.');
      seen.add(localPlace); anchorSeen.add(anchor.id);
      return Object.freeze({ placeId: localPlace, purpose: 'lane-patrol' as const, anchorId: anchor.id });
    });
    for (let i = 0; i < waypoints.length; i++) {
      const path = resolveVillageSitePath(layout, waypoints[i].placeId, waypoints[(i + 1) % waypoints.length].placeId, residentId);
      if (!path || path.lengthMetres <= 1e-7 || !path.legs.length) throw Error('Patrol circuit needs complete nonzero certified legs, including its return.');
    }
    const entry = resolveVillageSitePath(layout, target, waypoints[0].placeId, residentId);
    if (!entry || entry.lengthMetres <= 1e-7 || !entry.legs.length) throw Error('Patrol needs a certified nonzero entry from its real routine destination.');
    return Object.freeze({ id, residentId, activity: row.activity, routineTargetPlaceId: target, waypoints: Object.freeze(waypoints), dwellWorldMinutes: row.dwellWorldMinutes });
  });
  return Object.freeze({ ...layout, navigationRevision: revision, ...(allocation?{navigationAllocation:allocation}:{}),patrols: Object.freeze(patrols) });
}

/** An explicit unmapped person/place override prevents fallback to a shared stand. */
export function resolveVillageSiteEndpoint(site: VillageSiteLayout, placeId: string, residentId?: string): VillageSiteAnchor | null {
  const index=siteIndex(site),binding=(residentId?index.residents.get(`${residentId}\0${placeId}`):undefined)??index.places.get(placeId);
  return binding?.status==='mapped-exterior'?index.anchors.get(binding.anchorId!)??null:null;
}

/** Follow only complete certified graph legs. Corners and reversals retain the
 * exact measured polyline; disconnected endpoints return null. */
export function resolveVillageSitePath(site: VillageSiteLayout, fromPlaceId: string, toPlaceId: string, residentId?: string): VillageSitePath | null {
  const from = resolveVillageSiteEndpoint(site, fromPlaceId, residentId), to = resolveVillageSiteEndpoint(site, toPlaceId, residentId);
  if (!from || !to) return null;
  if (from.id === to.id) return Object.freeze({ sourceGroundPolyline: Object.freeze([from.sourceGroundPoint]), capsuleBottomPolyline: Object.freeze([from.capsuleBottomPoint]), lengthMetres: 0, legs: Object.freeze([]) });
  const queue = [from.id], seen = new Set(queue), previous = new Map<string, { from: string; route: VillageSiteRoute; reverse: boolean }>();
  const index=siteIndex(site);
  for(let i=0;i<queue.length&&!seen.has(to.id);i++)for(const leg of index.adjacency.get(queue[i])??[]){
    if(!seen.has(leg.next)){seen.add(leg.next);previous.set(leg.next,{from:queue[i],route:leg.route,reverse:leg.reverse});queue.push(leg.next);}
  }
  if (!seen.has(to.id)) return null;
  const legs: { from: string; route: VillageSiteRoute; reverse: boolean }[] = [];
  for (let cursor = to.id; cursor !== from.id;) { const leg = previous.get(cursor)!; legs.unshift(leg); cursor = leg.from; }
  const ground: VillageSitePoint[] = [], body: VillageSitePoint[] = [];
  for (const leg of legs) {
    const g = leg.reverse ? [...leg.route.sourceGroundPolyline].reverse() : leg.route.sourceGroundPolyline;
    const b = leg.reverse ? [...leg.route.capsuleBottomPolyline].reverse() : leg.route.capsuleBottomPolyline;
    ground.push(...(ground.length ? g.slice(1) : g)); body.push(...(body.length ? b.slice(1) : b));
  }
  return Object.freeze({ sourceGroundPolyline: Object.freeze(ground), capsuleBottomPolyline: Object.freeze(body), lengthMetres: legs.reduce((sum, row) => sum + row.route.lengthMetres, 0),
    legs: Object.freeze(legs.map(row => Object.freeze({ id: row.route.id, reverse: row.reverse }))) });
}

/** Validates measured arrival orientation for authored workplace placement. This
 * never certifies a work clip, placed prop or reach to existing source equipment. */
export function validateVillageSiteWorkplaceAnchors(site: VillageSiteLayout, value: unknown): readonly VillageSiteWorkplaceAnchor[] {
  const rows = placeDataArray(own(value)), seen = new Set<string>();
  if (rows.length > 8192) throw Error('Village workplace anchor budget exceeded.');
  return Object.freeze(rows.map((row: Data) => {
    const residentId = placeId(row.residentId), place = placeId(row.placeId), key = `${residentId}:${place}`;
    if (seen.has(key)) throw Error('Duplicate village workplace orientation.'); seen.add(key);
    const anchor = resolveVillageSiteEndpoint(site, place, residentId), source = point(row.sourceGroundPoint), route = site.routes.find(r => r.id === row.sourceRouteId);
    if (!anchor || row.anchorId !== anchor.id || !same(source, anchor.sourceGroundPoint) || !route || typeof row.reverse !== 'boolean'
      || (row.reverse ? route.from : route.to) !== anchor.id || !Number.isFinite(row.yawRadians)) throw Error('Workplace orientation needs a matching measured route arrival.');
    const points = row.reverse ? [...route.sourceGroundPolyline].reverse() : route.sourceGroundPolyline, end = points[points.length - 1];
    let previous = points.length - 2;
    while (previous >= 0 && Math.hypot(end[0] - points[previous][0], end[2] - points[previous][2]) <= 1e-10) previous--;
    if (previous < 0) throw Error('Measured workplace arrival has no horizontal tangent.');
    const yaw = Math.atan2(end[0] - points[previous][0], end[2] - points[previous][2]);
    if (Math.abs(Math.atan2(Math.sin(row.yawRadians - yaw), Math.cos(row.yawRadians - yaw))) > 1e-6) throw Error('Workplace yaw disagrees with the measured arrival tangent.');
    return Object.freeze({ residentId, placeId: place, anchorId: anchor.id, sourceGroundPoint: anchor.sourceGroundPoint,
      yawRadians: yaw, sourceRouteId: route.id, reverse: row.reverse });
  }));
}

/** Validates complete per-site rigid-source cylinder evidence. A matching proxy
 * budget alone does not qualify sampled clips, crossfades or agent avoidance. */
export function validateVillageSiteRigidClearance(site: VillageSiteLayout, value: unknown): VillageSiteRigidClearance {
  const data = own(value), proxy = data.proxy;
  if (data.schema !== 1 || data.profile !== site.profile || sha(data.sourceSha256) !== site.sourceSha256 || data.frame !== site.frame
    || data.sourceOriginalBuffersUnchanged !== true || !proxy || proxy.radiusMetres !== site.capsule.radius || proxy.topAboveGroundMetres !== site.capsule.height
    || !Number.isFinite(proxy.bottomAboveGroundMetres) || proxy.bottomAboveGroundMetres < 0 || proxy.bottomAboveGroundMetres > .005
    || !Number.isFinite(proxy.rigidSourceMarginMetres) || proxy.rigidSourceMarginMetres < .005
    || !Number.isFinite(proxy.terrainContactToleranceMetres) || proxy.terrainContactToleranceMetres < 0 || proxy.terrainContactToleranceMetres > .02
    || !Number.isFinite(data.originalTriangleFrameMaximumErrorMetres) || data.originalTriangleFrameMaximumErrorMetres < 0
    || data.originalTriangleFrameMaximumErrorMetres > 1e-8) throw Error('Village rigid-source proof identity or cylinder differs from the loaded site.');
  function rows(value: unknown, field: 'anchorId' | 'routeId', expected: readonly string[]): readonly any[] {
    const input = placeDataArray(value), seen = new Set<string>(),expectedIds=new Set(expected);
    if (input.length !== expected.length) throw Error('Village rigid-source proof must cover every site anchor and route.');
    return Object.freeze(input.map((row: Data) => {
      const id = placeId(row[field]);
      if (seen.has(id) || !expectedIds.has(id) || typeof row.qualified !== 'boolean') throw Error('Village rigid-source proof has duplicate or unknown site IDs.');
      seen.add(id); return Object.freeze({ [field]: id, qualified: row.qualified });
    }));
  }
  const result: VillageSiteRigidClearance = Object.freeze({ sourceSha256: site.sourceSha256, proxy: Object.freeze({ radiusMetres: proxy.radiusMetres,
    bottomAboveGroundMetres: proxy.bottomAboveGroundMetres, topAboveGroundMetres: proxy.topAboveGroundMetres,
    rigidSourceMarginMetres: proxy.rigidSourceMarginMetres, terrainContactToleranceMetres: proxy.terrainContactToleranceMetres }),
    anchors: rows(data.anchors, 'anchorId', site.anchors.map(a => a.id)), routes: rows(data.routes, 'routeId', site.routes.map(r => r.id)) });
  validatedRigidProofs.set(result, site); return result;
}

/** Keep only the original validated stands and graph legs whose full lower
 * floor-band cylinder cleared the actual rigid source. No substitute paths. */
export function applyVillageSiteRigidClearance(site: VillageSiteLayout, proof: VillageSiteRigidClearance): VillageSiteLayout {
  if (validatedRigidProofs.get(proof) !== site) throw Error('Apply a complete rigid-source proof validated against this exact site.');
  const anchors = new Set(proof.anchors.filter(row => row.qualified).map(row => row.anchorId));
  const routes = new Set(proof.routes.filter(row => row.qualified).map(row => row.routeId));
  const placeBindings = site.placeBindings.map(row => row.anchorId !== null && !anchors.has(row.anchorId)
    ? Object.freeze({ ...row, anchorId: null, status: 'unmapped' as const }) : row);
  const residentPlaceBindings = site.residentPlaceBindings.map(row => row.anchorId !== null && !anchors.has(row.anchorId)
    ? Object.freeze({ ...row, anchorId: null, status: 'unmapped' as const }) : row);
  return Object.freeze({ ...site, anchors: Object.freeze(site.anchors.filter(row => anchors.has(row.id))),
    routes: Object.freeze(site.routes.filter(row => routes.has(row.id) && anchors.has(row.from) && anchors.has(row.to))),
    placeBindings: Object.freeze(placeBindings), residentPlaceBindings: Object.freeze(residentPlaceBindings) });
}
