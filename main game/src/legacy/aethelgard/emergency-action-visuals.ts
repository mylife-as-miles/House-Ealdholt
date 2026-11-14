import { BufferAttribute, BufferGeometry, CircleGeometry, DoubleSide, Group, Line, LineBasicMaterial,
  Matrix4, Mesh, MeshBasicMaterial, Points, PointsMaterial, Vector3, type Object3D } from 'three';
import type { ResidentAnimationEvent, ResidentAnimationExecutionSnapshot } from '../../../../shared/legacy/aethelgard/characters/resident-animation-execution';

type XYZ = readonly [number, number, number];
export type EmergencyVisualPhase = 'evacuating' | 'sheltered' | 'to-water' | 'drawing-water' | 'to-fire'
  | 'delivering-water' | 'returning-home' | 'to-repair' | 'repairing' | 'held';
/** The actual actor, not a copied pose or a separately spawned effect character. */
export interface EmergencyActionActor {
  readonly residentId: string; readonly model: Object3D; readonly activeMotion: string;
  readonly animationExecution?: ResidentAnimationExecutionSnapshot;
  readonly status?: 'ready' | 'unavailable-motion'; readonly fadingFrom?: string | null;
}
/** Borrowed, cached by the presenter. Geometry, rig and props retain their existing owner. */
export interface EmergencyHeldProp {
  readonly residentId: string; readonly rigId: string; readonly sourceAssetId: string;
  readonly clipId: string; readonly kind: 'bucket' | 'repair-tool'; readonly node: Object3D;
  readonly actor: EmergencyActionActor;
  /** Metres in the actual prop node's glTF frame. Water centre or striking edge. */
  readonly point: XYZ; readonly radiusMetres: number; readonly completeEnvelopeQualified: true;
  /** Original bucket handle vertex; used only for a source-qualified well rope. */
  readonly handlePoint?: XYZ;
}
/** Existing published workpiece placed by the actor's ordinary prop owner.
 * This borrowed surface is construction equipment, never an original wall. */
export interface EmergencyWorkpiece {
  readonly residentId: string; readonly sourceAssetId: string; readonly clipId: string;
  readonly node: Object3D; readonly actor: EmergencyActionActor;
  readonly point: XYZ; readonly radiusMetres: number;
}
/** Borrowed source template for station qualification before an actor is drawn.
 * Loading it creates no character, placed prop, duty, contact or work credit. */
export interface EmergencyRepairEquipment {
  readonly residentId: string; readonly assetPath: string; readonly sourceSha256: string;
  readonly template: Object3D; readonly localPlacementMatrix: readonly number[];
  readonly localContactPoint: XYZ; readonly placementScale: number;
  readonly clipId: 'work_chisel'; readonly contactMarkerSeconds: readonly number[];
  readonly files: Readonly<Record<string, string>>;
}
/** Source-owner proof for this exact current resident/station. transferBounds
 * includes the entire rope/water tube and excludes unrelated source geometry.
 * The renderer checks containment; it cannot issue the clearance proof itself. */
export interface EmergencyActionStation {
  readonly id: string; readonly sourceId: string; readonly frame: Object3D; readonly sourceActor: Object3D;
  readonly kind: 'water-source' | 'fire-surface' | 'repair-surface'; readonly position: XYZ;
  readonly residentStandPosition: XYZ; readonly maxStandDistanceMetres: number;
  readonly maxToolReachMetres: number; readonly clearanceQualified: true;
  readonly transferBounds: { readonly min: XYZ; readonly max: XYZ };
  /** Current actor-owned construction equipment; absent for original sources. */
  readonly workpiece?: EmergencyWorkpiece;
  /** Source-owner certified rope bends, excluding start and contact endpoint. */
  readonly sourceWaypoints?: readonly XYZ[];
  /** Fixed pose0 handle used by the source owner's tube-clearance calculation. */
  readonly sourceStartPoint?: XYZ;
}
export interface EmergencyActionVisualRecord {
  readonly residentId: string; readonly incidentId: string; readonly phase: EmergencyVisualPhase;
  readonly qualified: boolean; readonly waterUnits: number; readonly prop: EmergencyHeldProp | null;
  readonly stationId?: string | null; readonly contactSourceActor?: string | null;
  readonly station?: EmergencyActionStation | null;
  /** Cosmetic contact event from the actual evaluated animation owner. */
  readonly contactEvent?: ResidentAnimationEvent | null;
}
export interface EmergencyActionVisualFrame {
  /** Existing world presentation clock. No Date, timer, save or reducer is read. */
  readonly clockSeconds: number; readonly paused: boolean; readonly reducedMotion: boolean;
  readonly residents: readonly EmergencyActionVisualRecord[];
}
export interface EmergencyActionVisuals {
  readonly object: Group; readonly disposed: boolean;
  readonly diagnostics: { readonly activeResidents: number; readonly waterSurfaces: number;
    readonly sourceTransfers: number; readonly repairContacts: number; readonly capacity: number };
  update(frame: EmergencyActionVisualFrame): void; dispose(): void;
}

const EVERYDAY_SHA = '7136c2a4f0e88504352021ef81444deccdd21c47431de2ebdcf207cdd63626bc';
const CRAFT_SHA = '9295ac763d90a7622b90d32f7d7f6e590a627481984f5680e5cd4932b6895873';
const WORKPLACE_SHA = 'e0fba22ea8442981124d53973427a37849c638d015c2de16288c53fcad394548';
const BUCKET_HANDLE: XYZ = [-.0045252577401697636, -.0048614684492349625, -.0006830719066783786];
export interface EmergencyBucketPose0 {
  readonly clipId: 'carry_bucket_walk'; readonly sampleSeconds: 0;
  /** Root-local source metres, including the published resident placementScale. */
  readonly mouth: XYZ; readonly handle: XYZ; readonly files: Readonly<Record<string, string>>;
}
const BUCKET_POSES: Readonly<Record<string, EmergencyBucketPose0>> = Object.freeze({
  'ealdholt-brewster': Object.freeze({ clipId: 'carry_bucket_walk', sampleSeconds: 0,
    mouth: [-.24509184998821343, .612538943909392, .02743824127235283] as XYZ,
    handle: [-.2410912225327925, .7508260308083063, -.0009571523178922986] as XYZ,
    files: Object.freeze({
      'crowd-v1/residents/ealdholt-brewster.json': '33c7111b5eace0f7e437c6265a1b19a5fd28efe73205db6c8a4642a55681207f',
      'crowd-v1/residents/ealdholt-brewster.glb': 'dceb7b3ad2c00775e61eb35cf71082daa50fd14314a96e2885abec98d1a193f9',
      'crowd-v1/clips/crowd-clips-adult-female-v1.glb': '11a56b603c38996184275a2bf18eb1e30b9872aaae2296e00997fc48b16b39be',
      'crowd-v1/props/crowd-props-everyday-v1.glb': EVERYDAY_SHA,
    }) }),
  'ealdholt-swineherd': Object.freeze({ clipId: 'carry_bucket_walk', sampleSeconds: 0,
    mouth: [-.31396755815673816, .6839284232408913, .13405415388392863] as XYZ,
    handle: [-.30932876734160564, .8445409095889115, .10107215357028755] as XYZ,
    files: Object.freeze({
      'crowd-v1/residents/ealdholt-swineherd.json': '4f6b57d155e3796669d27822da15eab2f3f1658a5f905b4d22453a5aa7be6063',
      'crowd-v1/residents/ealdholt-swineherd.glb': 'c3412424009968e83dde87bc6d0119b2dd5f12cd27dd641edc84b984ef985678',
      'crowd-v1/clips/crowd-clips-adult-male-v1.glb': 'ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5',
      'crowd-v1/props/crowd-props-everyday-v1.glb': EVERYDAY_SHA,
    }) }),
  'ealdholt-hall-groom': Object.freeze({ clipId: 'carry_bucket_walk', sampleSeconds: 0,
    mouth: [-0.3303727387030664, 0.7196645016112284, 0.14105864380754435] as XYZ,
    handle: [-0.3254915655179665, 0.8886691825286585, 0.1063532945176558] as XYZ,
    files: Object.freeze({
      'crowd-v1/residents/ealdholt-hall-groom.glb': '3949b658d38ebe331d6e3912c4cd2c0a36a2f871be285cb2de326774bc2d0053',
      'crowd-v1/residents/ealdholt-hall-groom.json': '412a63e407ad9d2f2045d596c5252542d1f511e97cec1ab9528ce592b1c5cf41',
      'crowd-v1/clips/crowd-clips-adult-male-v1.glb': 'ecbb7f4646cb008ea06b02fa46029948e37ff826dd00bdcb6cac021a70d124e5',
      'crowd-v1/props/crowd-props-everyday-v1.glb': '7136c2a4f0e88504352021ef81444deccdd21c47431de2ebdcf207cdd63626bc',
    }) }),
});
/** Original bytes + pose0 were measured by the published-source CPU test. A
 * changed body, metadata, library or kit invalidates this derived contact. */
export function emergencyBucketPose0(residentId: string, files: Readonly<Record<string, string>>): EmergencyBucketPose0 | null {
  const pose = BUCKET_POSES[residentId];
  return pose && Object.entries(pose.files).every(([path, sha]) => files[path] === sha) ? pose : null;
}
/** Original published stone-block vertices reach y=.96, while the chisel's
 * authored edge enters the stone at y=.86. The .12m contact tolerance covers
 * that cut; it is not permission for a tool to reach a distant village wall. */
export function emergencyWorkpieceSocket(prop: string, sourceSha256: string): {
  readonly clipId: 'work_chisel'; readonly nodeName: 'prop_stone_block';
  readonly point: XYZ; readonly radiusMetres: number; readonly impactSeconds: readonly number[];
} | null {
  return prop === 'stone-block' && sourceSha256 === WORKPLACE_SHA ? {
    clipId: 'work_chisel', nodeName: 'prop_stone_block', point: [0, .96, 0], radiusMetres: .08,
    impactSeconds: [.6, 1.2, 1.8, 2.4],
  } : null;
}
/** Bucket opening measured from unchanged kit vertices: rim y=-.150..-.160,
 * inner radius >.09m. Water remains 5mm below the rim. Tool points come from
 * actual published kit frame. The chisel's kitMatrix already applies KIT_ALIGN;
 * its original iron tip is glTF y=.16, not the contract's pre-alignment +Y=.22. */
export function emergencyPropSocket(prop: string, sourceSha256: string): {
  readonly kind: EmergencyHeldProp['kind']; readonly point: XYZ; readonly radiusMetres: number; readonly handlePoint?: XYZ;
} | null {
  if (prop === 'bucket' && sourceSha256 === EVERYDAY_SHA)
    return { kind: 'bucket', point: [0, -.165, -.0015], radiusMetres: .085, handlePoint: BUCKET_HANDLE };
  if (prop === 'hammer-small' && sourceSha256 === CRAFT_SHA)
    return { kind: 'repair-tool', point: [0, -.04, -.28], radiusMetres: .025 };
  if (prop === 'chisel' && sourceSha256 === CRAFT_SHA)
    return { kind: 'repair-tool', point: [0, .16, 0], radiusMetres: .012 };
  return null;
}
const finite3 = (p: XYZ) => p.length === 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
function descendant(node: Object3D, parent: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) if (current === parent) return true;
  return false;
}
function visible(node: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) if (!current.visible) return false;
  return true;
}
function sceneRoot(node: Object3D): Object3D { while (node.parent) node = node.parent; return node; }
function validProp(record: EmergencyActionVisualRecord): record is EmergencyActionVisualRecord & { prop: EmergencyHeldProp } {
  const prop = record.prop, execution = prop?.actor.animationExecution;
  return !!(record.qualified && record.residentId && record.incidentId && prop && prop.completeEnvelopeQualified
    && prop.rigId && prop.sourceAssetId && prop.residentId === record.residentId && prop.actor.residentId === record.residentId
    && prop.actor.status === 'ready' && !prop.actor.fadingFrom && execution?.ownerId === record.residentId
    && execution.clipId === prop.clipId && execution.requestedMotion === prop.actor.activeMotion
    && (execution.state === 'playing' || execution.state === 'completed')
    && execution.hold !== 'disposed' && execution.hold !== 'clip-unavailable' && execution.hold !== 'root-motion-unqualified'
    && finite3(prop.point) && Number.isFinite(prop.radiusMetres) && prop.radiusMetres > 0 && prop.radiusMetres <= .12
    && descendant(prop.node, prop.actor.model) && visible(prop.node)
    && (prop.kind === 'bucket' ? prop.clipId === 'carry_bucket_walk'
      : prop.clipId === 'work_hammer_bench' || prop.clipId === 'work_chisel'));
}
type Slot = { readonly root: Group; readonly surface: Mesh; readonly rope: Line; readonly stream: Line;
  readonly droplets: Points; readonly dust: Points; readonly linePositions: Float32Array; readonly ropePositions: Float32Array;
  readonly drops: Float32Array; readonly flecks: Float32Array; lastContactKey: string; contactClock: number;
  residentId: string; incidentId: string; seenFrame: number };
const POINTS = 8, SEGMENTS = 12, MAX_ROPE_WAYPOINTS = 3;

/** Fixed pool in the existing scene. No actor transform, held prop, source,
 * animation timeline, water credit or repair progress is mutated here. */
export function createEmergencyActionVisuals(options: { readonly maxResidents?: number } = {}): EmergencyActionVisuals {
  const capacity = options.maxResidents ?? 12;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 32) throw Error('Emergency effect capacity must be 1..32.');
  const object = new Group(); object.name = 'Resident emergency action effects'; object.userData.iwsdkPreviewBounds = 'exclude';
  const circle = new CircleGeometry(1, 12);
  const waterMaterial = new MeshBasicMaterial({ color: 0x72b9c6, transparent: true, opacity: .78, side: DoubleSide, depthWrite: false });
  const ropeMaterial = new LineBasicMaterial({ color: 0x806d48 });
  const streamMaterial = new LineBasicMaterial({ color: 0xb1dde6, transparent: true, opacity: .85, depthWrite: false });
  const dropMaterial = new PointsMaterial({ color: 0xc3e8ec, size: .025, sizeAttenuation: true, transparent: true, opacity: .85, depthWrite: false });
  const dustMaterial = new PointsMaterial({ color: 0x9d8871, size: .03, sizeAttenuation: true, transparent: true, opacity: .65, depthWrite: false });
  const geometries: BufferGeometry[] = [circle], slots: Slot[] = [];
  for (let i = 0; i < capacity; i++) {
    const root = new Group(), surface = new Mesh(circle, waterMaterial), linePositions = new Float32Array((SEGMENTS + 1) * 3);
    const ropePositions = new Float32Array((MAX_ROPE_WAYPOINTS + 2) * 3), drops = new Float32Array(POINTS * 3), flecks = new Float32Array(POINTS * 3);
    const makeGeometry = (data: Float32Array) => { const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(data, 3)); geometries.push(g); return g; };
    const rope = new Line(makeGeometry(ropePositions), ropeMaterial), stream = new Line(makeGeometry(linePositions), streamMaterial);
    const droplets = new Points(makeGeometry(drops), dropMaterial), dust = new Points(makeGeometry(flecks), dustMaterial);
    root.name = 'Emergency action slot ' + i; surface.name = 'Existing held bucket water'; rope.name = 'Qualified well rope';
    stream.name = 'Qualified controlled water spill'; droplets.name = 'Source contact water droplets'; dust.name = 'Evaluated repair contact flecks';
    surface.matrixAutoUpdate = false; root.add(surface, rope, stream, droplets, dust); object.add(root);
    for (const item of root.children) { item.visible = false; item.frustumCulled = false; item.castShadow = false; }
    slots.push({ root, surface, rope, stream, droplets, dust, linePositions, ropePositions, drops, flecks,
      lastContactKey: '', contactClock: -Infinity, residentId: '', incidentId: '', seenFrame: -1 });
  }
  const inverse = new Matrix4(), transform = new Matrix4(), localSurface = new Matrix4().makeRotationX(-Math.PI / 2);
  const start = new Vector3(), end = new Vector3(), stand = new Vector3(), point = new Vector3(), sample = new Vector3(), localStart = new Vector3();
  const workpiecePoint = new Vector3();
  let disposed = false, lastClock: number | null = null, frameSerial = 0, activeResidents = 0, waterSurfaces = 0, sourceTransfers = 0, repairContacts = 0;
  const diagnostics = { get activeResidents() { return activeResidents; }, get waterSurfaces() { return waterSurfaces; },
    get sourceTransfers() { return sourceTransfers; }, get repairContacts() { return repairContacts; }, capacity };
  function inCorridor(station: EmergencyActionStation, p: Vector3, pad: number): boolean {
    const b = station.transferBounds;
    return finite3(b.min) && finite3(b.max) && p.x - pad >= b.min[0] && p.y - pad >= b.min[1] && p.z - pad >= b.min[2]
      && p.x + pad <= b.max[0] && p.y + pad <= b.max[1] && p.z + pad <= b.max[2];
  }
  function sourceContact(record: EmergencyActionVisualRecord & { prop: EmergencyHeldProp }): EmergencyActionStation | null {
    const station = record.station, prop = record.prop, placement = prop.actor.model.parent;
    if (!station || !placement || !station.clearanceQualified || station.id !== record.stationId
      || station.sourceActor.name !== record.contactSourceActor || !station.sourceId || !finite3(station.position)
      || !finite3(station.residentStandPosition)
      || sceneRoot(station.frame) !== sceneRoot(object) || sceneRoot(prop.node) !== sceneRoot(object)
      || !Number.isFinite(station.maxStandDistanceMetres) || station.maxStandDistanceMetres < 0 || station.maxStandDistanceMetres > .5
      || !Number.isFinite(station.maxToolReachMetres) || station.maxToolReachMetres <= 0 || station.maxToolReachMetres > 4) return null;
    station.frame.updateWorldMatrix(true, false); placement.updateWorldMatrix(true, false); prop.node.updateWorldMatrix(true, false);
    if (!station.frame.matrixWorld.elements.every(Number.isFinite) || Math.abs(station.frame.matrixWorld.determinant()) < 1e-12
      || !prop.node.matrixWorld.elements.every(Number.isFinite)) return null;
    // Construction equipment belongs to the existing character prop owner, not
    // the source village hierarchy. Permit that separate parent only for the
    // pinned published piece and its actual, currently evaluated contact point.
    if (station.workpiece) {
      const piece = station.workpiece, socket = emergencyWorkpieceSocket('stone-block', WORKPLACE_SHA);
      if (station.kind !== 'repair-surface' || prop.kind !== 'repair-tool' || prop.clipId !== 'work_chisel'
        || piece.node !== station.sourceActor || piece.actor !== prop.actor || piece.residentId !== record.residentId
        || piece.clipId !== prop.clipId || !piece.sourceAssetId.endsWith('/crowd-props-workplace-v1.glb@' + WORKPLACE_SHA)
        || station.sourceId !== piece.sourceAssetId || piece.node.name !== socket!.nodeName
        || !finite3(piece.point) || piece.point.some((n, i) => n !== socket!.point[i])
        || !descendant(piece.node, prop.actor.model) || !visible(piece.node) || sceneRoot(piece.node) !== sceneRoot(object)) return null;
      piece.node.updateWorldMatrix(true, false);
      if (!piece.node.matrixWorld.elements.every(Number.isFinite)) return null;
      workpiecePoint.fromArray(piece.point).applyMatrix4(piece.node.matrixWorld); station.frame.worldToLocal(workpiecePoint);
      if (workpiecePoint.distanceTo(point.fromArray(station.position)) > .02) return null;
    } else if (!descendant(station.sourceActor, station.frame)) return null;
    stand.setFromMatrixPosition(placement.matrixWorld); station.frame.worldToLocal(stand); point.fromArray(station.residentStandPosition);
    if (stand.distanceTo(point) > station.maxStandDistanceMetres) return null;
    const bentRope = record.phase === 'drawing-water' && station.kind === 'water-source' && station.sourceWaypoints !== undefined;
    if (station.sourceWaypoints !== undefined && (!bentRope || prop.kind !== 'bucket' || !prop.handlePoint
      || !finite3(prop.handlePoint) || prop.handlePoint.some((n, i) => n !== BUCKET_HANDLE[i])
      || !prop.sourceAssetId.endsWith('/crowd-props-everyday-v1.glb@' + EVERYDAY_SHA)
      || station.sourceWaypoints.length > MAX_ROPE_WAYPOINTS || !station.sourceStartPoint || !finite3(station.sourceStartPoint))) return null;
    start.fromArray(bentRope ? prop.handlePoint! : prop.point).applyMatrix4(prop.node.matrixWorld);
    localStart.copy(start); station.frame.worldToLocal(localStart); end.fromArray(station.position);
    if (localStart.distanceTo(end) > station.maxToolReachMetres || !inCorridor(station, localStart, .08) || !inCorridor(station, end, .08)) return null;
    if (bentRope) {
      if (localStart.distanceTo(point.fromArray(station.sourceStartPoint!)) > .02) return null;
      workpiecePoint.copy(localStart); let length = 0;
      for (const waypoint of station.sourceWaypoints!) {
        if (!finite3(waypoint)) return null;
        point.fromArray(waypoint); if (!inCorridor(station, point, .08)) return null;
        length += workpiecePoint.distanceTo(point); workpiecePoint.copy(point);
      }
      if (length + workpiecePoint.distanceTo(end) > station.maxToolReachMetres) return null;
    }
    end.applyMatrix4(station.frame.matrixWorld); return station;
  }
  return { object, diagnostics, get disposed() { return disposed; },
    update(frame) {
      if (disposed) return;
      activeResidents = 0; waterSurfaces = 0; sourceTransfers = 0; repairContacts = 0;
      for (const slot of slots) for (const child of slot.root.children) child.visible = false;
      frameSerial++; if (!Number.isSafeInteger(frameSerial)) { frameSerial = 0; for (const slot of slots) slot.seenFrame = -1; }
      if (!Number.isFinite(frame.clockSeconds) || frame.clockSeconds < 0) return;
      const clock = frame.paused ? lastClock ?? frame.clockSeconds : frame.clockSeconds;
      const rewound = lastClock !== null && clock < lastClock; lastClock = clock; object.updateWorldMatrix(true, false);
      if (!object.matrixWorld.elements.every(Number.isFinite) || Math.abs(object.matrixWorld.determinant()) < 1e-12) return;
      inverse.copy(object.matrixWorld).invert();
      for (const record of frame.residents) {
        if (activeResidents === capacity) break;
        if (!validProp(record) || sceneRoot(record.prop.node) !== sceneRoot(object)) continue;
        let slot: Slot | null = null;
        for (const candidate of slots) if (candidate.residentId === record.residentId) { slot = candidate; break; }
        if (slot?.seenFrame === frameSerial) continue;
        if (!slot) for (const candidate of slots) {
          if (candidate.seenFrame === frameSerial) continue;
          let reserved = false;
          for (const other of frame.residents) if (other.residentId === candidate.residentId) { reserved = true; break; }
          if (!reserved) { slot = candidate; break; }
        }
        if (!slot) for (const candidate of slots) if (candidate.seenFrame !== frameSerial) { slot = candidate; break; }
        if (!slot) continue;
        const prop = record.prop; activeResidents++; slot.seenFrame = frameSerial;
        if (slot.residentId !== record.residentId || slot.incidentId !== record.incidentId || rewound) { slot.lastContactKey = ''; slot.contactClock = -Infinity; }
        slot.residentId = record.residentId; slot.incidentId = record.incidentId; prop.node.updateWorldMatrix(true, false);
        if (!prop.node.matrixWorld.elements.every(Number.isFinite)) continue;
        if (prop.kind === 'bucket' && record.waterUnits > 0 && Number.isFinite(record.waterUnits)
          && (record.phase === 'to-fire' || record.phase === 'delivering-water')) {
          transform.makeTranslation(prop.point[0], prop.point[1], prop.point[2]); transform.multiply(localSurface); transform.scale(point.setScalar(prop.radiusMetres));
          slot.surface.matrix.copy(inverse).multiply(prop.node.matrixWorld).multiply(transform); slot.surface.matrixWorldNeedsUpdate = true;
          slot.surface.visible = true; waterSurfaces++;
        }
        const station = sourceContact(record); if (!station) continue;
        // Point sprite sizes are world units, unlike the source-space vertex
        // offsets above. Preserve their physical scale in Native miniatures.
        const sourceScale = station.frame.matrixWorld.getMaxScaleOnAxis();
        dropMaterial.size = .025 * sourceScale; dustMaterial.size = .03 * sourceScale;
        const drawing = prop.kind === 'bucket' && record.phase === 'drawing-water' && station.kind === 'water-source';
        const spilling = prop.kind === 'bucket' && record.phase === 'delivering-water' && record.waterUnits > 0 && station.kind === 'fire-surface';
        // A well rope does not authorize a long jet from a carrying pose.
        if ((drawing || spilling) && (!spilling || localStart.distanceTo(point.fromArray(station.position)) <= .65
          && station.position[1] <= localStart.y - .03)) {
          start.applyMatrix4(inverse); end.applyMatrix4(inverse);
          const data = drawing ? slot.ropePositions : slot.linePositions, count = drawing ? 1 : SEGMENTS;
          if (drawing && station.sourceWaypoints) {
            start.toArray(data, 0);
            for (let i = 0; i < station.sourceWaypoints.length; i++) sample.fromArray(station.sourceWaypoints[i])
              .applyMatrix4(station.frame.matrixWorld).applyMatrix4(inverse).toArray(data, (i + 1) * 3);
            end.toArray(data, (station.sourceWaypoints.length + 1) * 3); slot.rope.geometry.setDrawRange(0, station.sourceWaypoints.length + 2);
          } else { for (let i = 0; i <= count; i++) { sample.lerpVectors(start, end, i / count); sample.toArray(data, i * 3); }
            if (drawing) slot.rope.geometry.setDrawRange(0, 2); }
          const line = drawing ? slot.rope : slot.stream; line.geometry.getAttribute('position').needsUpdate = true; line.visible = true;
          if (!frame.reducedMotion) {
            for (let i = 0; i < POINTS; i++) {
              const u = (clock * 1.7 + i / POINTS) % 1, angle = i * 2.39996;
              sample.fromArray(station.position); sample.x += Math.cos(angle) * .055 * u; sample.z += Math.sin(angle) * .055 * u;
              sample.y += Math.sin(u * Math.PI) * .055;
              sample.applyMatrix4(station.frame.matrixWorld).applyMatrix4(inverse).toArray(slot.drops, i * 3);
            }
            slot.droplets.geometry.getAttribute('position').needsUpdate = true; slot.droplets.visible = true;
          }
          sourceTransfers++;
        }
        if (prop.kind !== 'repair-tool' || record.phase !== 'repairing' || station.kind !== 'repair-surface'
          || localStart.distanceTo(point.fromArray(station.position)) > .12 || frame.paused || frame.reducedMotion) continue;
        const event = record.contactEvent, execution = prop.actor.animationExecution!;
        if (event?.ownerId === record.residentId && event.requestId === execution.requestId && event.clipId === prop.clipId
          && event.motion === prop.actor.activeMotion && event.kind === 'marker' && event.markerKind === 'contact'
          && event.state === 'playing' && event.hold === 'none' && event.markerId) {
          const key = event.requestId + ':' + event.loop + ':' + event.markerId;
          if (!Number.isFinite(event.seconds) || Math.abs(execution.evaluatedTimeSeconds - event.seconds) > .12) continue;
          if (key !== slot.lastContactKey) { slot.lastContactKey = key; slot.contactClock = clock; }
        }
        const age = clock - slot.contactClock; if (age < 0 || age > .22) continue;
        for (let i = 0; i < POINTS; i++) {
          const angle = i * 2.39996, reach = age * (.1 + i * .011);
          sample.fromArray(station.position); sample.x += Math.cos(angle) * reach; sample.z += Math.sin(angle) * reach;
          sample.y += age * (.35 + i * .015) - 2 * age * age;
          sample.applyMatrix4(station.frame.matrixWorld).applyMatrix4(inverse).toArray(slot.flecks, i * 3);
        }
        slot.dust.geometry.getAttribute('position').needsUpdate = true; slot.dust.visible = true; repairContacts++;
      }
    },
    dispose() {
      if (disposed) return; disposed = true; object.removeFromParent(); object.clear();
      for (const geometry of geometries) geometry.dispose();
      waterMaterial.dispose(); ropeMaterial.dispose(); streamMaterial.dispose(); dropMaterial.dispose(); dustMaterial.dispose();
      activeResidents = 0; waterSurfaces = 0; sourceTransfers = 0; repairContacts = 0;
    },
  };
}
