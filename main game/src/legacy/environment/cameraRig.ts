// Cinematic camera rig: authored framings from the blueprint, restrained orbit and
// zoom within each framing's limits, critically damped input, eased transitions,
// and collision against building volumes and the terrain so the camera never clips.

import * as THREE from "three";
import type { CameraFraming } from "../../../../shared/legacy/environment/blueprint/types";
import type { Collider, TerrainField } from "../../../../shared/legacy/environment/kernel/mesh";
import { sampleField } from "../../../../shared/legacy/environment/kernel/mesh";

const DEG = Math.PI / 180;

interface Orbit {
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

interface Limits {
  yaw: [number, number];
  pitch: [number, number];
  distance: [number, number];
}

function bearing(dx: number, dz: number): number {
  const b = Math.atan2(dx, -dz) / DEG;
  return b < 0 ? b + 360 : b;
}

function shortest(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function smoother(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private framings = new Map<string, { orbit: Orbit; limits: Limits; seconds: number }>();
  private current: Orbit = { target: new THREE.Vector3(), yaw: 0, pitch: 20, distance: 100, fov: 40 };
  private desired: Orbit = { target: new THREE.Vector3(), yaw: 0, pitch: 20, distance: 100, fov: 40 };
  private limits: Limits = { yaw: [-30, 30], pitch: [2, 30], distance: [50, 200] };
  private transition: { from: Orbit; to: Orbit; t: number; seconds: number } | null = null;
  private colliders: Collider[] = [];
  private field: TerrainField | null = null;
  private groundSampler: ((x: number, z: number) => number | null) | null = null;
  private safeDistance = Infinity;
  private panBounds = { minX:-80, maxX:80, minZ:-80, maxZ:80 };
  private aerial = false;
  private roofClearance = 24;
  reducedMotion = false;
  activeId = "establishing";
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.4, 14000);
  }

  setWorld(framings: readonly CameraFraming[], colliders: Collider[], field: TerrainField): void {
    this.framings.clear();
    for (const f of framings) this.addFraming(f);
    this.colliders = colliders.filter((c) => c.blocksCamera);
    this.field = field;
    this.groundSampler = null;
    this.roofClearance = Math.max(18,...this.colliders.map(c=>c.center[1]+c.halfExtents[1]+6));
    this.panBounds = {minX:field.originX+12,maxX:field.originX+field.cellSize*(field.columns-1)-12,minZ:field.originZ+12,maxZ:field.originZ+field.cellSize*(field.rows-1)-12};
  }
  /** Settlement cameras see rooftops from above. A roof may occlude the pivot;
   * that is not a reason to collapse a200m aerial orbit to an actor's boom. */
  setAerialMode(enabled:boolean):void {this.aerial=enabled;this.safeDistance=Infinity;}
  setPanBounds(bounds:{minX:number;maxX:number;minZ:number;maxZ:number}):void {this.panBounds={...bounds};}
  /** Screen drag translated onto the ground plane; existing damping owns motion. */
  panPixels(dx:number,dy:number,height:number):void {
    if(this.transition){this.copy(this.desired,this.current);this.transition=null;}
    const d=this.desired,scale=2*Math.tan(d.fov*DEG/2)*d.distance/Math.max(1,height),yaw=d.yaw*DEG;
    const horizontal=-dx*scale,depth=dy*scale/Math.max(.35,Math.sin(d.pitch*DEG));
    d.target.x=Math.max(this.panBounds.minX,Math.min(this.panBounds.maxX,d.target.x-Math.cos(yaw)*horizontal-Math.sin(yaw)*depth));
    d.target.z=Math.max(this.panBounds.minZ,Math.min(this.panBounds.maxZ,d.target.z-Math.sin(yaw)*horizontal+Math.cos(yaw)*depth));
  }
  /** Explicit relocation preserves the user's orbit and zoom. */
  frameTarget(point:{x:number;y:number;z:number},instant=false):void {
    this.desired.target.set(point.x,point.y+1,point.z);
    if(this.transition)this.transition.to.target.copy(this.desired.target);
    if(instant){this.current.target.copy(this.desired.target);this.transition=null;this.safeDistance=Infinity;this.apply(0,true);}
  }

  /** Source-world adapters provide their real collision volumes and ground. */
  setCollisionWorld(colliders: readonly Collider[], sampleHeight?: (x: number, z: number) => number | null): void {
    this.colliders = colliders.filter(c => c.blocksCamera);
    this.field = null;
    this.groundSampler = sampleHeight ?? null;
  }

  /** Adds or replaces a framing (blueprint framings, or development views from the harness). */
  addFraming(f: CameraFraming): void {
    {
      const dx = f.position[0] - f.target[0], dy = f.position[1] - f.target[1], dz = f.position[2] - f.target[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const yaw = bearing(dx, dz);
      const pitch = Math.asin(dy / dist) / DEG;
      const orbit: Orbit = { target: new THREE.Vector3(f.target[0], f.target[1], f.target[2]), yaw, pitch, distance: dist, fov: f.fovDeg };
      const limits: Limits = {
        yaw: [yaw + f.orbit.yawDeg[0], yaw + f.orbit.yawDeg[1]],
        pitch: [Math.min(f.orbit.pitchDeg[0], pitch), Math.max(f.orbit.pitchDeg[1], pitch)],
        distance: [Math.min(f.orbit.distance[0], dist), Math.max(f.orbit.distance[1], dist)],
      };
      this.framings.set(f.id, { orbit, limits, seconds: f.transitionSeconds });
    }
  }

  has(id: string): boolean {
    return this.framings.has(id);
  }

  /** Jump or ease to a framing. */
  focus(id: string, instant = false): void {
    const f = this.framings.get(id);
    if (!f) return;
    this.activeId = id;
    this.limits = { yaw: [...f.limits.yaw] as [number, number], pitch: [...f.limits.pitch] as [number, number], distance: [...f.limits.distance] as [number, number] };
    const to: Orbit = { target: f.orbit.target.clone(), yaw: f.orbit.yaw, pitch: f.orbit.pitch, distance: f.orbit.distance, fov: f.orbit.fov };
    if (instant) {
      this.copy(this.current, to);
      this.copy(this.desired, to);
      this.transition = null;
      this.safeDistance = Infinity;
      this.apply(1 / 60, true);
      return;
    }
    const seconds = this.reducedMotion ? 0.35 : f.seconds;
    this.transition = { from: this.clone(this.current), to, t: 0, seconds };
    this.copy(this.desired, to);
  }

  /** Orbit/zoom input in degrees and a zoom factor (relative), clamped to the framing. */
  orbitBy(dYaw: number, dPitch: number, zoomFactor = 1): void {
    if (this.transition) return;
    const d = this.desired;
    d.yaw = Math.min(Math.max(d.yaw + dYaw, this.limits.yaw[0]), this.limits.yaw[1]);
    d.pitch = Math.min(Math.max(d.pitch + dPitch, this.limits.pitch[0]), this.limits.pitch[1]);
    d.distance = Math.min(Math.max(d.distance * zoomFactor, this.limits.distance[0]), this.limits.distance[1]);
  }

  /** Gamepad/keyboard nudges: normalised fractions of the framing's ranges. */
  nudge(yaw: number, pitch: number, zoom = 0): void {
    const yr = this.limits.yaw[1] - this.limits.yaw[0];
    const pr = this.limits.pitch[1] - this.limits.pitch[0];
    this.orbitBy(yaw * yr * 0.08, pitch * pr * 0.08, Math.exp(zoom * 0.12));
  }

  private clone(o: Orbit): Orbit {
    return { target: o.target.clone(), yaw: o.yaw, pitch: o.pitch, distance: o.distance, fov: o.fov };
  }

  private copy(out: Orbit, o: Orbit): void {
    out.target.copy(o.target);
    out.yaw = o.yaw;
    out.pitch = o.pitch;
    out.distance = o.distance;
    out.fov = o.fov;
  }

  get transitioning(): boolean {
    return this.transition !== null;
  }

  /** A controlled actor supplies only a target; normal orbit limits and camera
   * collision continue to apply. This never changes a Quest viewer pose. */
  followTarget(point: { x: number; y: number; z: number }, instant = false): void {
    if (this.activeId !== "exploration") {
      this.addFraming({ id: "exploration" as CameraFraming["id"], label: "House envoy", position: [point.x - 10, point.y + 15, point.z + 14], target: [point.x, point.y + 1, point.z], fovDeg: 42, orbit: { yawDeg: [-160, 160], pitchDeg: [30, 76], distance: [15, 100] }, composition: "Follow the selected house member", transitionSeconds: .8 });
      this.focus("exploration", this.reducedMotion);
    }
    this.desired.target.set(point.x, point.y + 1, point.z);
    if (this.transition) this.transition.to.target.copy(this.desired.target);
    if (instant) { this.current.target.copy(this.desired.target); this.transition = null; this.safeDistance = Infinity; this.apply(0, true); }
  }

  /** Advances transitions and damping, resolves collisions and updates the camera. */
  apply(dt: number, snap = false): void {
    const c = this.current;
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / Math.max(tr.seconds, 0.001));
      const k = smoother(tr.t);
      c.target.lerpVectors(tr.from.target, tr.to.target, k);
      c.yaw = tr.from.yaw + shortest(tr.from.yaw, tr.to.yaw) * k;
      c.pitch = tr.from.pitch + (tr.to.pitch - tr.from.pitch) * k;
      // Distance eases in log space so long pull-backs feel even.
      c.distance = Math.exp(Math.log(tr.from.distance) + (Math.log(tr.to.distance) - Math.log(tr.from.distance)) * k);
      c.fov = tr.from.fov + (tr.to.fov - tr.from.fov) * k;
      if (tr.t >= 1) this.transition = null;
    } else {
      const a = snap ? 1 : 1 - Math.exp(-dt * 7);
      const d = this.desired;
      c.target.lerp(d.target, a);
      c.yaw += shortest(c.yaw, d.yaw) * a;
      c.pitch += (d.pitch - c.pitch) * a;
      c.distance += (d.distance - c.distance) * a;
      c.fov += (d.fov - c.fov) * a;
    }
    if(this.aerial&&this.field){c.target.y=sampleField(this.field,c.target.x,c.target.z)+1.5;this.desired.target.y=sampleField(this.field,this.desired.target.x,this.desired.target.z)+1.5;}
    // Position from the orbit, then pull in front of any blocking volume.
    const h = Math.cos(c.pitch * DEG) * c.distance;
    const want = this.tmp.set(c.target.x + Math.sin(c.yaw * DEG) * h, c.target.y + Math.sin(c.pitch * DEG) * c.distance, c.target.z - Math.cos(c.yaw * DEG) * h);
    const hit = this.aerial ? c.distance : this.blockedDistance(c.target, want, c.distance);
    const k = snap ? 1 : 1 - Math.exp(-dt * 10);
    this.safeDistance = hit < this.safeDistance ? hit : this.safeDistance + (hit - this.safeDistance) * k;
    const dist = Math.min(c.distance, this.safeDistance);
    const dir = this.tmp2.subVectors(want, c.target).normalize();
    const pos = this.camera.position.copy(c.target).addScaledVector(dir, dist);
    if(this.aerial&&pos.y<this.roofClearance)pos.y=this.roofClearance;
    if (this.field) {
      const g = sampleField(this.field, pos.x, pos.z) + 1.6;
      if (pos.y < g) pos.y = g;
    }
    const sourceGround = this.groundSampler?.(pos.x, pos.z);
    if (sourceGround != null && Number.isFinite(sourceGround) && pos.y < sourceGround + 1.6) pos.y = sourceGround + 1.6;
    this.camera.fov = c.fov;
    this.camera.lookAt(c.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Distance along target→camera at which the segment first enters a collider (minus a margin). */
  private blockedDistance(target: THREE.Vector3, pos: THREE.Vector3, dist: number): number {
    let best = dist;
    const dx = pos.x - target.x, dy = pos.y - target.y, dz = pos.z - target.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    for (const c of this.colliders) {
      // Ray in the box's local frame.
      const ox = target.x - c.center[0], oy = target.y - c.center[1], oz = target.z - c.center[2];
      const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
      const lx = ox * cs + oz * sn, lz = -ox * sn + oz * cs;
      const dlx = ux * cs + uz * sn, dlz = -ux * sn + uz * cs;
      const he = c.halfExtents;
      // Skip boxes that contain the target (the framed building itself).
      if (Math.abs(lx) <= he[0] && Math.abs(oy) <= he[1] && Math.abs(lz) <= he[2]) continue;
      let tmin = 0, tmax = len;
      const slab = (o: number, d: number, e: number): boolean => {
        if (Math.abs(d) < 1e-6) return Math.abs(o) <= e;
        let t1 = (-e - o) / d, t2 = (e - o) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        return tmin <= tmax;
      };
      if (!slab(lx, dlx, he[0]) || !slab(oy, uy, he[1]) || !slab(lz, dlz, he[2])) continue;
      if (tmin > 0.5 && tmin < best) best = Math.max(2, tmin - 1.2);
    }
    return best;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
