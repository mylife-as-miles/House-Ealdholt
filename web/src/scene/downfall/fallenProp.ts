import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";

/**
 * A weapon let fall from a beaten figure's hand, to the stone beside it.
 *
 * It rests exactly on the floor: its resting height is read from its own vertices (the corners of its convex
 * hull, whatever touches first however it is turned), so it lies neither in the stone nor above it, flat side down, its long axis along the line
 * the plan chose (downfallPlan.ts `placeFallenProps`). It gets there by falling: it drops under gravity from
 * the hand, turning toward flat with one end lower, slaps down onto the stone, bounces once a little and lies
 * still. Every instant is a function of the time since it left the hand, so Skip and a replay land it in the
 * same place. Nothing goes below the floor at any instant.
 */

const DIRECTIONS: THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) if (x || y || z) out.push(new THREE.Vector3(x, y, z).normalize());
  return out;
})();

/** World units a second squared: a 1.48-unit King is about 1.85 m tall. */
export const FALL_GRAVITY = 8;
/** How far above the stone its lowest point rests: enough to keep it out of the floor's depth, no more. */
export const REST_GAP = 0.0015;
const SLAP = 0.09, BOUNCE = 0.24;

/**
 * The vertices that bound `root` in 26 directions, in `root`'s own frame: its extents, for measuring it. With
 * `hull`, the corners of its convex hull too: whatever touches the floor first however it is turned is one of them
 * (the 26 alone missed a tilted shield's rim by a centimetre). Skinned meshes are not props; they are skipped.
 */
export function supportPoints(root: THREE.Object3D, hull = false): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new THREE.Matrix4();
  const best = DIRECTIONS.map(() => ({ score: -Infinity, point: new THREE.Vector3() }));
  const all: THREE.Vector3[] = [];
  const point = new THREE.Vector3();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (node as THREE.SkinnedMesh).isSkinnedMesh) return;
    const position = mesh.geometry?.getAttribute("position");
    if (!position) return;
    toRoot.multiplyMatrices(inverse, mesh.matrixWorld);
    const stride = Math.max(1, Math.floor(position.count / 6000));
    for (let i = 0; i < position.count; i += stride) {
      point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      if (hull) all.push(point.clone());
      for (let d = 0; d < DIRECTIONS.length; d += 1) {
        const score = point.dot(DIRECTIONS[d]);
        if (score > best[d].score) { best[d].score = score; best[d].point.copy(point); }
      }
    }
  });
  const unique: THREE.Vector3[] = [];
  const add = (corner: THREE.Vector3) => { if (!unique.some(p => p.distanceToSquared(corner) < 1e-12)) unique.push(corner.clone()); };
  for (const entry of best) if (entry.score > -Infinity) add(entry.point);
  if (hull && all.length >= 4) {
    try {
      for (const face of new ConvexHull().setFromPoints(all).faces) {
        let edge = face.edge;
        do { add(edge.head().point); edge = edge.next; } while (edge !== face.edge);
      }
    } catch { /* flat: its 26 extremes are its corners */ }
  }
  return unique;
}

/** Hulls already found, by what the prop is and how it is built: a kingdom's Pawns all let fall the same spear. */
const HULLS = new Map<string, readonly THREE.Vector3[]>();

/**
 * The shape with every corner of its hull, for its fall and its rest (exact, so no vertex goes below the stone).
 * Found once per kind of prop (`kind`, with its measured extents), when its first one falls.
 */
export function withHull(shape: PropShape, root: THREE.Object3D, kind: string): PropShape {
  const key = `${kind}|${shape.points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`).join(";")}`;
  let points = HULLS.get(key);
  if (!points) {
    points = supportPoints(root, true);
    if (HULLS.size > 128) HULLS.clear();
    HULLS.set(key, points);
  }
  return { ...shape, points };
}

export interface PropShape {
  readonly points: readonly THREE.Vector3[];
  /** Their middle, in the prop's frame. */
  readonly centre: THREE.Vector3;
  /** Which of the prop's own axes is its length, and which its thinnest. */
  readonly longAxis: 0 | 1 | 2;
  readonly thinAxis: 0 | 1 | 2;
  /** World extents along its length and across it (at the scale it is drawn). */
  readonly length: number;
  readonly width: number;
}

export function measureProp(root: THREE.Object3D): PropShape | null {
  const points = supportPoints(root);
  if (points.length < 2) return null;
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3()), scale = root.getWorldScale(new THREE.Vector3());
  const world = [size.x * scale.x, size.y * scale.y, size.z * scale.z];
  const order = [0, 1, 2].sort((a, b) => world[b] - world[a]) as (0 | 1 | 2)[];
  return { points, centre: box.getCenter(new THREE.Vector3()), longAxis: order[0], thinAxis: order[2], length: world[order[0]], width: world[order[1]] };
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The orientation it rests in: long axis along `yaw`, thinnest axis up, each the way round nearest to `from`, but on
 * the side it can lie on: a shield lies on its rim, never balanced on its boss.
 */
export function restingQuaternion(shape: PropShape, from: THREE.Quaternion, yaw: number): THREE.Quaternion {
  const along = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const currentLong = AXES[shape.longAxis].clone().applyQuaternion(from), currentThin = AXES[shape.thinAxis].clone().applyQuaternion(from);
  const basis: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  basis[shape.longAxis].copy(along).multiplyScalar(currentLong.dot(along) < 0 ? -1 : 1);
  const side = stableSide(shape);
  basis[shape.thinAxis].copy(UP).multiplyScalar(side ?? (currentThin.y < 0 ? -1 : 1));
  const middle = 3 - shape.longAxis - shape.thinAxis;
  // Keep the frame right-handed: x cross y = z.
  const next = (axis: number) => (axis + 1) % 3;
  if (next(shape.longAxis) === shape.thinAxis) basis[middle].crossVectors(basis[shape.longAxis], basis[shape.thinAxis]);
  else basis[middle].crossVectors(basis[shape.thinAxis], basis[shape.longAxis]);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(basis[0], basis[1], basis[2]));
}

/**
 * Which way up its thinnest axis must point for it to lie steady (+1, -1), or null when either side will do: the
 * side it lies on must touch the stone across most of its breadth, not at one point (a shield's boss).
 */
function stableSide(shape: PropShape): 1 | -1 | null {
  const thin = shape.thinAxis, others = [0, 1, 2].filter(axis => axis !== thin);
  const spread = (sign: 1 | -1) => {
    // Lying with the thin axis `sign` up, the side that touches is the far end of the thin axis the other way.
    const depth = (p: THREE.Vector3) => -sign * p.getComponent(thin);
    const low = Math.max(...shape.points.map(depth));
    const touching = shape.points.filter(p => low - depth(p) < 0.004);
    let span = 0;
    for (const axis of others) span = Math.max(span, Math.max(...touching.map(p => p.getComponent(axis))) - Math.min(...touching.map(p => p.getComponent(axis))));
    return span;
  };
  const up = spread(1), down = spread(-1), breadth = Math.max(up, down);
  if (breadth < 1e-6 || Math.abs(up - down) < 0.25 * breadth) return null;
  return up > down ? 1 : -1;
}

/** The lowest world height of the prop's support points with the root at `position`, turned `rotation`, at `scale`. */
export function lowestPoint(shape: PropShape, position: THREE.Vector3, rotation: THREE.Quaternion, scale: number, scratch = new THREE.Vector3()): number {
  let low = Infinity;
  for (const point of shape.points) low = Math.min(low, scratch.copy(point).multiplyScalar(scale).applyQuaternion(rotation).y + position.y);
  return low;
}

export interface FallContact { readonly at: number; readonly strength: number; }

/** One prop's fall from the hand to the stone. Pure in time: `pose(t)` for any `t` since it left the hand. */
export class PropFall {
  readonly rest = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  readonly duration: number;
  readonly contacts: readonly FallContact[];
  private readonly start = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly tilted = new THREE.Quaternion();
  private readonly wobbleAxis = new THREE.Vector3();
  private readonly drop: number;
  private readonly scale: number;
  private readonly centre: THREE.Vector3;
  private readonly scratch = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  /**
   * @param shape  the prop's measured support points
   * @param from   its world position and orientation as it leaves the hand, and its world scale
   * @param spot   where its middle comes to rest on the floor, and the line its length lies along
   * @param ground the floor's height
   */
  constructor(private readonly shape: PropShape, from: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number },
    spot: { x: number; z: number; yaw: number }, private readonly ground: number) {
    this.scale = from.scale;
    this.centre = shape.centre.clone().multiplyScalar(from.scale);
    this.start.position.copy(from.position); this.start.quaternion.copy(from.quaternion);
    const rest = restingQuaternion(shape, from.quaternion, spot.yaw);
    this.rest.quaternion.copy(rest);
    const middle = this.centre.clone().applyQuaternion(rest);
    this.rest.position.set(spot.x - middle.x, 0, spot.z - middle.z);
    this.rest.position.y = ground + REST_GAP - lowestPoint(shape, new THREE.Vector3(0, 0, 0), rest, from.scale);
    // Just before it lands it is not yet flat: the end that hangs lower meets the stone first.
    const along = AXES[shape.longAxis].clone().applyQuaternion(rest);
    const startAlong = AXES[shape.longAxis].clone().applyQuaternion(from.quaternion);
    this.wobbleAxis.crossVectors(UP, along).normalize();
    const lowerEnd = startAlong.y * Math.sign(startAlong.dot(along) || 1) < 0 ? 1 : -1;
    this.tilted.setFromAxisAngle(this.wobbleAxis, 0.26 * lowerEnd).multiply(rest);
    const fallHeight = Math.max(0, from.position.y + this.centre.clone().applyQuaternion(from.quaternion).y - (this.rest.position.y + middle.y));
    this.drop = THREE.MathUtils.clamp(Math.sqrt((2 * fallHeight) / FALL_GRAVITY), 0.16, 0.7);
    this.duration = this.drop + SLAP + BOUNCE;
    this.contacts = [{ at: this.firstTouch(), strength: 1 }];
  }

  /**
   * The instant it strikes the stone: the first moment its lowest point reaches the floor (the end that hangs lower,
   * a little before its middle comes down). Its one sound (a clang and the rattle of it settling) starts there. A
   * prop already touching as it leaves the hand (a pike's butt on the stone) strikes when it slaps down flat.
   */
  private firstTouch(): number {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), floor = this.ground + REST_GAP + 1e-6;
    const touching = (t: number) => { this.free(t, p, q); return lowestPoint(this.shape, p, q, this.scale) <= floor; };
    if (touching(0)) return this.drop + SLAP * 0.5;
    // Through the fall and, if it comes down flat without an end first, the slap that lays it flat on the stone.
    const step = 1 / 240, last = this.drop + SLAP;
    let hi = -1;
    for (let t = step; t < last + step; t += step) if (touching(Math.min(t, last))) { hi = Math.min(t, last); break; }
    if (hi < 0) return last;
    let lo = Math.max(0, hi - step);
    for (let i = 0; i < 24; i += 1) { const mid = (lo + hi) / 2; if (touching(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  /** Where the prop's root is `t` seconds after it left the hand (world). */
  pose(t: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    if (t >= this.duration) { position.copy(this.rest.position); quaternion.copy(this.rest.quaternion); return; }
    this.free(t, position, quaternion);
    // Never into the stone: whatever touches first holds the rest up.
    const low = lowestPoint(this.shape, position, quaternion, this.scale);
    if (low < this.ground + REST_GAP) position.y += this.ground + REST_GAP - low;
  }

  /** Its path through the air before the stone holds it up. */
  private free(t: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    if (t >= this.duration) { position.copy(this.rest.position); quaternion.copy(this.rest.quaternion); return; }
    const restMiddle = this.scratch.copy(this.centre).applyQuaternion(this.rest.quaternion).add(this.rest.position);
    const restX = restMiddle.x, restZ = restMiddle.z, restY = restMiddle.y;
    if (t < this.drop) {
      const u = Math.max(0, t) / this.drop;
      quaternion.slerpQuaternions(this.start.quaternion, this.tilted, u * u);
      const startMiddle = this.scratch.copy(this.centre).applyQuaternion(this.start.quaternion).add(this.start.position);
      const height = startMiddle.y - (startMiddle.y - restY) * u * u;
      const middle = this.scratch.set(THREE.MathUtils.lerp(startMiddle.x, restX, u), height, THREE.MathUtils.lerp(startMiddle.z, restZ, u));
      position.copy(middle).sub(this.centreIn(quaternion));
    } else if (t < this.drop + SLAP) {
      const u = (t - this.drop) / SLAP;
      quaternion.slerpQuaternions(this.tilted, this.rest.quaternion, u * u);
      position.set(restX, restY, restZ).sub(this.centreIn(quaternion));
    } else {
      const u = (t - this.drop - SLAP) / BOUNCE;
      const hop = Math.sin(Math.PI * Math.min(1, u / 0.82)) * (1 - u) * 0.03 * this.shape.length;
      this.q.setFromAxisAngle(this.wobbleAxis, Math.sin(Math.PI * Math.min(1, u / 0.82)) * 0.05 * (1 - u));
      quaternion.copy(this.q).multiply(this.rest.quaternion);
      position.set(restX, restY + hop, restZ).sub(this.centreIn(quaternion));
    }
  }

  private centreIn(quaternion: THREE.Quaternion): THREE.Vector3 {
    return this.offset.copy(this.centre).applyQuaternion(quaternion);
  }
}
