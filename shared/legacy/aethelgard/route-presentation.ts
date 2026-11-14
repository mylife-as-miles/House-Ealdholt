/** Presentation only. Offline certificates remain caller-owned evidence, not a
 * signature or a new navigation/arrival test. No clock, save, claims or events
 * are advanced here. In particular, a displayed pose never grants knowledge. */
import { ownHouseholdSimulation, type HouseholdSimulation } from './household-simulation';
import { placeDataArray, placeDataRecord, placeId } from './place-use';

export type ResidentRoutePoint = readonly [number, number, number];
export interface ResidentRouteFrame {
  readonly clockSeconds: number; readonly paused: boolean; readonly reducedMotion: boolean;
  readonly residents: readonly { readonly residentId: string; readonly motion: 'idle' | 'walk';
    readonly position: ResidentRoutePoint; readonly yawRadians: number }[];
}
export interface ResidentRoutePhase {
  readonly generation: number; readonly worldMinute: number; readonly fractionalMinute: number;
  readonly clockSeconds: number; readonly paused: boolean; readonly reducedMotion: boolean;
}
export type ResidentWalkCapability = { readonly status: 'unavailable' } | {
  readonly status: 'visually-qualified'; readonly actorModelSha256: string; readonly clipId: string;
  /** Host evidence must cover the actual body/clip, props, foot offset and proxy.
   * Matching numbers alone neither qualifies an animation nor measures clearance. */
  readonly capsuleCompatibility: { readonly height: number; readonly radius: number; readonly qualified: true };
};
export interface ResidentRoutePresentationOptions {
  readonly simulation: HouseholdSimulation;
  /** Independently identify the model actually loaded, never default from JSON. */
  readonly profile: 'desktop' | 'quest'; readonly modelSha256: string;
  /** Independently identify the loaded resident template and selected real clip. */
  readonly actorModelSha256: string; readonly walkClipId: string | null;
  readonly binding: unknown; readonly certificate: unknown;
  readonly routeBindings: readonly { readonly routeId: string;
    readonly legs: readonly { readonly certifiedRouteId: string; readonly reverse: boolean }[] }[];
  /** Already qualified, source-metre local animation envelopes, including every
   * actor's complete supplied geometry. No per-frame skin/vertex scans. */
  readonly renderedResidentIds: readonly string[];
  readonly actorEnvelopes: readonly { readonly residentId: string; readonly min: ResidentRoutePoint; readonly max: ResidentRoutePoint;
    readonly footAnchor: ResidentRoutePoint }[];
  readonly walkCapability: ResidentWalkCapability;
}
export type ResidentRouteUnavailable = 'walk-unavailable' | 'actor-envelope-unqualified' | 'crowd-unqualified' | 'catchup-pending' | 'restore-required' | 'reduced-motion-transit' | 'disposed';
export interface ResidentRoutePresentation {
  readonly frame: ResidentRouteFrame;
  /** Conservative full swept bounds for ALL supplied actors and their routes. */
  readonly bounds: { readonly min: ResidentRoutePoint; readonly max: ResidentRoutePoint };
  readonly available: boolean; readonly reason: ResidentRouteUnavailable | null; readonly error: string | null;
  readonly interpolation: 'previous-to-current-committed-minute';
  /** Off-frame, e.g. controller subscription. Same-generation rewrites fail.
   * A hidden/new presenter restores saved progress; it does not animate a jump. */
  handoff(simulation: HouseholdSimulation): boolean;
  /** Reuse the input DTO. This function creates no arrays, objects or clocks. */
  update(phase: ResidentRoutePhase): boolean;
  dispose(): void;
}
type Point = [number, number, number];
type Path = { from: string; to: string; points: readonly Point[]; lengths: Float64Array; length: number };
type FrameRow = { residentId: string; motion: 'idle' | 'walk'; position: Point; yawRadians: number };
type Row = { frame: FrameRow; path: Path | null; taskId: string | null; progress: number; duration: number;
  from: number; to: number; travelling: boolean; anchor: Point; foot: Point; facingA: Point; facingB: Point };
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
const samePoint = (a: ResidentRoutePoint, b: ResidentRoutePoint) => near(a[0], b[0]) && near(a[1], b[1]) && near(a[2], b[2]);
const sha = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw Error('Expected an explicit SHA-256 model identity.'); return v; };
function point(v: unknown): Point {
  const a = placeDataArray(v); if (a.length !== 3 || a.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Error('Expected finite source-metre XYZ.');
  return [a[0] as number, a[1] as number, a[2] as number];
}
/** Copy plain data before inspecting it. Never invoke getters/JSON hooks. */
function data(v: unknown, budget = { left: 100000 }, depth = 0): any {
  if (--budget.left < 0 || depth > 32) throw Error('Route evidence exceeds its bounded data budget.');
  if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return Object.freeze(placeDataArray(v).map(n => data(n, budget, depth + 1)));
  if (!v || typeof v !== 'object') throw Error('Route evidence must be plain finite data.');
  const r = placeDataRecord(v, Object.getOwnPropertyNames(v)), out = Object.create(null);
  for (const key of Object.getOwnPropertyNames(r)) out[key] = data(r[key], budget, depth + 1);
  return Object.freeze(out);
}
function polyline(v: unknown): Point[] {
  const a = placeDataArray(v); if (a.length < 2 || a.length > 8192) throw Error('A certified route needs a bounded polyline.'); return a.map(point);
}
function path(from: string, to: string, points: readonly Point[]): Path {
  const lengths = new Float64Array(points.length); let length = 0;
  for (let i = 1; i < points.length; i++) lengths[i] = length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  return { from, to, points, lengths, length };
}
function sample(p: Path, distance: number, out: Point): number {
  let i = 1; while (i < p.points.length - 1 && (p.lengths[i] < distance || p.lengths[i] - p.lengths[i - 1] < 1e-10)) i++;
  const a = p.points[i - 1], b = p.points[i], span = p.lengths[i] - p.lengths[i - 1];
  const f = span > 1e-10 ? Math.max(0, Math.min(1, (distance - p.lengths[i - 1]) / span)) : 0;
  out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}
function pose(row: Row, distance: number): void {
  const state = row.frame;
  if (row.path) {
    sample(row.path, distance, state.position);
    // Smooth the heading over the same certified polyline, never round its
    // corners geometrically or invent a shorter path through an obstacle.
    sample(row.path, Math.max(0, distance - .1), row.facingA);
    sample(row.path, Math.min(row.path.length, distance + .1), row.facingB);
    const dx = row.facingB[0] - row.facingA[0], dz = row.facingB[2] - row.facingA[2];
    if (Math.abs(dx) + Math.abs(dz) > 1e-10) state.yawRadians = Math.atan2(dx, dz);
  } else { state.position[0] = row.anchor[0]; state.position[1] = row.anchor[1]; state.position[2] = row.anchor[2]; }
  const c = Math.cos(state.yawRadians), s = Math.sin(state.yawRadians);
  state.position[0] -= c * row.foot[0] + s * row.foot[2]; state.position[1] -= row.foot[1]; state.position[2] -= -s * row.foot[0] + c * row.foot[2];
}

/** Consumes the private pilot JSON through caller input. No private coordinates,
 * roster or asset hashes are embedded in this reusable module. */
export function createResidentRoutePresentation(options: ResidentRoutePresentationOptions): ResidentRoutePresentation {
  const checked = ownHouseholdSimulation(options.simulation); if (!checked.ok) throw Error(checked.error);
  let snapshot = checked.snapshot;
  const b = data(options.binding), c = data(options.certificate), modelSha = sha(options.modelSha256);
  placeDataRecord(b, ['schema', 'profile', 'sourceSha256', 'frame', 'capsule', 'anchors', 'routes', 'scope']);
  placeDataRecord(c, ['schema', 'profile', 'qualified', 'sourceSha256', 'frame', 'capsule', 'routes', 'sourceOriginalBuffersUnchanged', 'sameHomeAnchorForEveryRoute', 'capsuleClearanceMargin', 'groundBoundaryRoundingMaxMetres'],
    ['fixedHomeAnchor', 'rejected', 'cpuCertificateMs', 'proofScope', 'authoringToolHashes', 'navMeshSha256', 'sourceGeometryInputHashes']);
  if (!['desktop', 'quest'].includes(options.profile) || b.schema !== 1 || c.schema !== 1 || b.profile !== options.profile || c.profile !== options.profile
    || sha(b.sourceSha256) !== modelSha || sha(c.sourceSha256) !== modelSha || b.frame !== 'source-root-local-metres' || c.frame !== b.frame
    || c.qualified !== true || c.sourceOriginalBuffersUnchanged !== true || c.sameHomeAnchorForEveryRoute !== true
    || typeof c.capsuleClearanceMargin !== 'number' || c.capsuleClearanceMargin < .005 || typeof c.groundBoundaryRoundingMaxMetres !== 'number' || c.groundBoundaryRoundingMaxMetres < 0 || c.groundBoundaryRoundingMaxMetres > 1e-8) throw Error('Loaded model and qualified route evidence disagree.');
  placeDataRecord(b.capsule, ['height', 'radius']); placeDataRecord(c.capsule, ['height', 'radius']);
  if (b.capsule.height !== 1.8 || b.capsule.radius !== .28 || c.capsule.height !== b.capsule.height || c.capsule.radius !== b.capsule.radius) throw Error('Unsupported certified resident capsule.');
  const anchors = new Map<string, Point>(); placeDataRecord(b.anchors, Object.getOwnPropertyNames(b.anchors));
  for (const id of Object.keys(b.anchors)) {
    placeId(id); const a = placeDataRecord(b.anchors[id], ['sourceGroundPoint', 'capsuleBottomPoint', 'sourceActor', 'standingOnly']);
    const p = point(a.sourceGroundPoint), body = point(a.capsuleBottomPoint); placeId(a.sourceActor);
    if (a.standingOnly !== true || !near(p[0], body[0]) || !near(p[2], body[2]) || body[1] < p[1] || body[1] - p[1] > .2) throw Error('Only certified standing exterior anchors are supported.');
    anchors.set(id, p);
  }
  const certified = new Map<string, Path>(), certificates = placeDataArray(c.routes); placeDataRecord(b.routes, Object.getOwnPropertyNames(b.routes));
  for (const id of Object.keys(b.routes)) {
    placeId(id); const r = placeDataRecord(b.routes[id], ['from', 'to', 'reversible', 'sourceGroundPolyline', 'capsuleBottomPolyline', 'lengthMetres', 'corridorRefs']);
    const from = placeId(r.from), to = placeId(r.to), points = polyline(r.sourceGroundPolyline), bodies = polyline(r.capsuleBottomPolyline), p = path(from, to, points);
    const matches = certificates.filter((e: any) => e.from === from && e.to === to);
    if (matches.length !== 1) throw Error('Each route needs exactly one matching certificate.'); const proof = matches[0] as any;
    placeDataRecord(proof, ['from', 'to', 'sourceGroundPolyline', 'capsuleBottomPolyline', 'capsuleBottomLiftMetres', 'lengthMetres', 'corridor',
      'groundEdgeClearanceLowerBound', 'slopeLipschitzUpperBound', 'allSourceSolidEnvelopesClear', 'groundWholeFootprintSupported', 'waterAndInteriorsExcluded', 'findPathStatus', 'partialPathAccepted'], ['start', 'end', 'sourceSolidClearanceMethod']);
    const corridor = placeDataArray(r.corridorRefs);
    if (r.reversible !== true || !anchors.has(from) || !anchors.has(to) || !samePoint(points[0], anchors.get(from)!) || !samePoint(points[points.length - 1], anchors.get(to)!)
      || !near(p.length, r.lengthMetres as number) || p.length <= 0 || proof.partialPathAccepted !== false || proof.allSourceSolidEnvelopesClear !== true
      || proof.groundWholeFootprintSupported !== true || proof.waterAndInteriorsExcluded !== true || !near(proof.lengthMetres, p.length)
      || JSON.stringify(proof.sourceGroundPolyline) !== JSON.stringify(r.sourceGroundPolyline) || JSON.stringify(proof.capsuleBottomPolyline) !== JSON.stringify(r.capsuleBottomPolyline)
      || JSON.stringify(proof.corridor) !== JSON.stringify(r.corridorRefs) || bodies.length !== points.length || !corridor.length || corridor.some(n => !Number.isSafeInteger(n) || (n as number) <= 0)
      || !samePoint(bodies[0], point(b.anchors[from].capsuleBottomPoint)) || !samePoint(bodies[bodies.length - 1], point(b.anchors[to].capsuleBottomPoint))
      || proof.findPathStatus !== 1073741824 || typeof proof.groundEdgeClearanceLowerBound !== 'number' || proof.groundEdgeClearanceLowerBound < b.capsule.radius + 1e-8
      || typeof proof.slopeLipschitzUpperBound !== 'number' || proof.slopeLipschitzUpperBound < 0 || proof.slopeLipschitzUpperBound > Math.tan(35 * Math.PI / 180)
      || typeof proof.capsuleBottomLiftMetres !== 'number' || proof.capsuleBottomLiftMetres < 0 || proof.capsuleBottomLiftMetres > .2) throw Error('Certified route geometry/endpoints do not match the binding.');
    for (let i = 0; i < points.length; i++) if (!near(points[i][0], bodies[i][0]) || !near(points[i][2], bodies[i][2]) || !near(bodies[i][1] - points[i][1], proof.capsuleBottomLiftMetres)) throw Error('Invalid capsule/ground projection.');
    certified.set(id, p);
  }
  const catalog = snapshot.definition.catalog, compiled = new Map<string, Path>();
  // An unused place identity/routine intention is not a physical placement.
  // Every executable route and every rendered initial endpoint must be bound.
  for (const use of catalog.uses) if (!['service', 'meet'].includes(use.kind) || use.requires.some(claim => {
    const resource = catalog.resources.find(r => r.id === claim.resourceId)!;
    return !['service', 'stance'].includes(resource.kind) || resource.capacity !== 1 || resource.anchorId !== catalog.places.find(p => p.id === use.placeId)!.anchorId;
  })) throw Error('Only standing exterior service/meeting uses at a single certified stance are supported.');
  for (const alias of data(options.routeBindings)) {
    placeDataRecord(alias, ['routeId', 'legs']); const id = placeId(alias.routeId), route = snapshot.definition.routes.find(r => r.id === id);
    if (!route || compiled.has(id)) throw Error('Unknown or duplicate household route binding.');
    const from = catalog.places.find(p => p.id === route.fromPlaceId)!.anchorId, to = catalog.places.find(p => p.id === route.toPlaceId)!.anchorId;
    if (!anchors.has(from) || !anchors.has(to)) throw Error('An unqualified place/forge cannot be presented.');
    let endpoint = from; const joined: Point[] = [];
    for (const leg of placeDataArray(alias.legs)) {
      const l = placeDataRecord(leg, ['certifiedRouteId', 'reverse']), p = certified.get(placeId(l.certifiedRouteId));
      if (!p || typeof l.reverse !== 'boolean' || endpoint !== (l.reverse ? p.to : p.from)) throw Error('Route legs must form a certified endpoint chain.');
      const points = l.reverse ? [...p.points].reverse() : p.points;
      for (let i = joined.length ? 1 : 0; i < points.length; i++) joined.push(points[i]); endpoint = l.reverse ? p.from : p.to;
    }
    if (endpoint !== to || !joined.length && from !== to) throw Error('Household route endpoints disagree with certified anchors.');
    if (!joined.length) joined.push(anchors.get(from)!, anchors.get(from)!);
    compiled.set(id, path(from, to, joined));
  }
  if (compiled.size !== snapshot.definition.routes.length) throw Error('Every household route needs explicit certified legs.');
  const capability = data(options.walkCapability), actorModelSha = sha(options.actorModelSha256); let walk = false;
  if (options.walkClipId !== null) placeId(options.walkClipId);
  if (capability.status === 'unavailable') placeDataRecord(capability, ['status']);
  else {
    placeDataRecord(capability, ['status', 'actorModelSha256', 'clipId', 'capsuleCompatibility']); sha(capability.actorModelSha256); placeId(capability.clipId);
    const proxy = placeDataRecord(capability.capsuleCompatibility, ['height', 'radius', 'qualified']);
    if (capability.status !== 'visually-qualified' || capability.actorModelSha256 !== actorModelSha || capability.clipId !== options.walkClipId
      || proxy.qualified !== true || proxy.height !== b.capsule.height || proxy.radius !== b.capsule.radius) throw Error('Walk visual/body/foot-proxy qualification is required.'); walk = true;
  }
  const frames: FrameRow[] = [], rows: Row[] = [], minimum: Point = [Infinity, Infinity, Infinity], maximum: Point = [-Infinity, -Infinity, -Infinity];
  const rendered = (data(options.renderedResidentIds) as unknown[]).map(placeId), envelopes = data(options.actorEnvelopes), envelopeIds = new Set<string>(), feet = new Map<string, Point>();
  if (!rendered.length || new Set(rendered).size !== rendered.length || rendered.some(id => !snapshot.actors.some(a => a.residentId === id))) throw Error('Explicit rendered resident IDs must be registered and distinct.');
  let envelopesFit = true;
  for (const e of envelopes) {
    placeDataRecord(e, ['residentId', 'min', 'max', 'footAnchor']); const id = placeId(e.residentId), low = point(e.min), high = point(e.max), foot = point(e.footAnchor);
    if (envelopeIds.has(id) || !rendered.includes(id) || low.some((n, i) => n >= high[i])) throw Error('Every actor needs one complete finite supplied envelope.'); envelopeIds.add(id); feet.set(id, foot);
    for (let i = 0; i < 3; i++) { low[i] -= foot[i]; high[i] -= foot[i]; }
    // A capsule is convex: containment of all AABB corners proves containment
    // of the caller's entire supplied envelope. Account for actual foot lift.
    for (const anchorId of anchors.keys()) {
      const a = b.anchors[anchorId], lift = a.capsuleBottomPoint[1] - a.sourceGroundPoint[1];
      for (const x of [low[0], high[0]]) for (const y0 of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
        const y = y0 - lift, dy = y < .28 ? y - .28 : y > 1.52 ? y - 1.52 : 0;
        if (y < 0 || y > 1.8 || x * x + z * z + dy * dy > .28 * .28 + 1e-10) envelopesFit = false;
      }
    }
    const radius = Math.hypot(Math.max(Math.abs(low[0]), Math.abs(high[0])), Math.max(Math.abs(low[2]), Math.abs(high[2])));
    const expand = (p: Point) => { minimum[0] = Math.min(minimum[0], p[0] - radius); minimum[1] = Math.min(minimum[1], p[1] + low[1]); minimum[2] = Math.min(minimum[2], p[2] - radius);
      maximum[0] = Math.max(maximum[0], p[0] + radius); maximum[1] = Math.max(maximum[1], p[1] + high[1]); maximum[2] = Math.max(maximum[2], p[2] + radius); };
    const initial = anchors.get(catalog.places.find(p => p.id === snapshot.definition.initialPlaces.find(a => a.residentId === id)!.placeId)!.anchorId);
    if (!initial) throw Error('A rendered initial endpoint needs a certified exterior anchor.'); expand(initial);
    for (const task of snapshot.definition.tasks) if (task.residentId === id) for (const p of compiled.get(task.routeId)!.points) expand(p);
  }
  if (envelopeIds.size !== rendered.length) throw Error('Missing actor bounds.');
  const frame = { clockSeconds: 0, paused: false, reducedMotion: false, residents: frames };
  let disposed = false, latch: ResidentRouteUnavailable | null = !envelopesFit ? 'actor-envelope-unqualified' : rendered.length > 1 ? 'crowd-unqualified' : null, error: string | null = null, lastFraction = 0, lastPresentedMinute = snapshot.events.world.elapsedSteps, wasPaused = false;
  let encoded = JSON.stringify(snapshot), definition = JSON.stringify(snapshot.definition);
  function target(s: HouseholdSimulation, row: Row): { path: Path | null; taskId: string | null; progress: number; duration: number; travelling: boolean; anchor: Point } {
    const actor = s.actors.find(a => a.residentId === row.frame.residentId)!;
    let taskId = actor.actionId;
    if (!taskId) for (let i = s.motion.length - 1; i >= 0; i--) { const task = s.definition.tasks.find(t => t.id === s.motion[i].taskId)!; if (task.residentId === actor.residentId) { taskId = task.id; break; } }
    const task = taskId ? s.definition.tasks.find(t => t.id === taskId)! : null, action = task ? s.actions.find(a => a.id === task.id)! : null;
    const route = task ? s.definition.routes.find(r => r.id === task.routeId)! : null;
    const anchor = anchors.get(catalog.places.find(p => p.id === (actor.placeId ?? route!.fromPlaceId))!.anchorId)!;
    return { path: route ? compiled.get(route.id)! : null, taskId, progress: action?.routeProgress ?? 0, duration: route?.travelMinutes ?? 1, travelling: action?.status === 'travelling', anchor };
  }
  for (const actor of snapshot.actors.filter(a => rendered.includes(a.residentId))) {
    const state: FrameRow = { residentId: actor.residentId, motion: 'idle', position: [0, 0, 0], yawRadians: 0 };
    const row: Row = { frame: state, path: null, taskId: null, progress: 0, duration: 1, from: 0, to: 0, travelling: false, anchor: [0, 0, 0], foot: feet.get(actor.residentId)!, facingA: [0, 0, 0], facingB: [0, 0, 0] };
    Object.assign(row, target(snapshot, row)); row.from = row.to = row.progress;
    pose(row, row.path ? row.path.length * row.progress / row.duration : 0);
    if (row.travelling && !walk) latch ??= 'walk-unavailable'; frames.push(state); rows.push(row);
  }
  const reason = (): ResidentRouteUnavailable | null => disposed ? 'disposed' : latch ?? (snapshot.events.world.pendingMilliseconds >= snapshot.events.world.stepMilliseconds ? 'catchup-pending' : null);
  frame.paused = reason() !== null;
  Object.freeze(frames);
  return {
    frame, bounds: Object.freeze({ min: Object.freeze(minimum), max: Object.freeze(maximum) }), interpolation: 'previous-to-current-committed-minute',
    get available() { return reason() === null; }, get reason() { return reason(); }, get error() { return error; },
    handoff(input) {
      if (disposed) return false;
      const checked = ownHouseholdSimulation(input); if (!checked.ok) { error = checked.error; return false; } const next = checked.snapshot;
      const nextEncoded = JSON.stringify(next), minute = snapshot.events.world.elapsedSteps, nextMinute = next.events.world.elapsedSteps;
      if (next.generation < snapshot.generation || nextMinute < minute || JSON.stringify(next.definition) !== definition
        || next.events.world.startedAt !== snapshot.events.world.startedAt || next.events.world.stepMilliseconds !== snapshot.events.world.stepMilliseconds || next.events.world.seed !== snapshot.events.world.seed
        || next.generation === snapshot.generation && nextEncoded !== encoded || next.motion.length < snapshot.motion.length
        || JSON.stringify(next.motion.slice(0, snapshot.motion.length)) !== JSON.stringify(snapshot.motion)
        || JSON.stringify(next.commands.slice(0, snapshot.commands.length)) !== JSON.stringify(snapshot.commands)
        || snapshot.actions.some(a => next.actions.find(n => n.id === a.id)!.routeProgress < a.routeProgress)) { error = 'Stale, rewritten or incompatible world handoff.'; return false; }
      if (next.generation === snapshot.generation) { error = null; return true; }
      const targets = rows.map(row => target(next, row));
      for (let i = 0; i < rows.length; i++) if (nextMinute === minute && (targets[i].taskId !== rows[i].taskId || targets[i].progress !== rows[i].progress)) { error = 'A command cannot rewrite committed route progress.'; return false; }
      if (nextMinute > minute + 1 || wasPaused && nextMinute !== minute) latch ??= 'restore-required';
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], next = targets[i];
        if (nextMinute !== minute) { row.from = next.taskId === row.taskId ? row.progress : next.progress; row.to = next.progress; }
        Object.assign(row, next); if (!walk && (row.travelling || row.from !== row.to)) latch ??= 'walk-unavailable';
      }
      snapshot = next; encoded = nextEncoded; if (nextMinute !== minute) lastFraction = 0; if (reason() !== null) frame.paused = true; error = null; return true;
    },
    update(phase) {
      if (disposed) return false;
      if (phase.generation !== snapshot.generation || phase.worldMinute !== snapshot.events.world.elapsedSteps || !Number.isFinite(phase.fractionalMinute) || phase.fractionalMinute < 0 || phase.fractionalMinute >= 1
        || !Number.isFinite(phase.clockSeconds) || phase.clockSeconds < 0 || typeof phase.paused !== 'boolean' || typeof phase.reducedMotion !== 'boolean' || phase.fractionalMinute < lastFraction) { error = 'Frame phase must match the committed world handoff.'; return false; }
      frame.clockSeconds = phase.clockSeconds; frame.reducedMotion = phase.reducedMotion;
      if (phase.paused) { frame.paused = true; wasPaused = true; error = null; return true; }
      if (wasPaused && (lastPresentedMinute !== phase.worldMinute || phase.fractionalMinute !== lastFraction)) latch ??= 'restore-required'; wasPaused = false;
      if (phase.reducedMotion) for (let i = 0; i < rows.length; i++) if (rows[i].travelling || rows[i].from !== rows[i].to) { latch ??= 'reduced-motion-transit'; break; }
      if (reason() !== null) { frame.paused = true; return false; }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], state = row.frame;
        pose(row, row.path ? row.path.length * (row.from + (row.to - row.from) * phase.fractionalMinute) / row.duration : 0);
        state.motion = row.path && row.path.length > 0 && row.from !== row.to ? 'walk' : 'idle';
      }
      frame.paused = false; lastFraction = phase.fractionalMinute; lastPresentedMinute = phase.worldMinute; error = null; return true;
    },
    dispose() { if (disposed) return; disposed = true; frame.paused = true; },
  };
}
