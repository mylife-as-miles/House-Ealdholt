/**
 * A body burst apart: which bones go with which piece, the figure's skin cut
 * into those pieces with the open ends closed, and how each piece is thrown.
 *
 * Pure: typed arrays in, typed arrays out. No three.js and no Jolt, so the
 * cut is tested in Node on the same code the browser runs.
 */
import type { QualityPreset } from "../../quality";
import { mapRig, type RigJoint } from "../ragdoll/ragdollPlan";
import { add, clamp, hash01, length, qConj, qRotate, scale, sub, unit, type Q4, type V3 } from "../physics/math";

/**
 * Pieces of a burst body, by quality preset.
 *  - low: 6 (head, trunk, two arms, two legs), blood where 2 of them land.
 *  - medium: 8 (the legs come apart at the knee), blood at 3 landings.
 *  - high and ultra: 11 (the arms at the elbow, the trunk at the waist) plus what the figure was holding, blood at 4 landings.
 */
export const GIB_BUDGET: Readonly<Record<QualityPreset, { level: 0 | 1 | 2; props: boolean; landings: number }>> = {
  low: { level: 0, props: false, landings: 2 },
  medium: { level: 1, props: false, landings: 3 },
  high: { level: 2, props: true, landings: 4 },
  ultra: { level: 2, props: true, landings: 4 },
};
/** A figure with no skeleton is cut across into this many slabs, bottom to top. */
export const GIB_SLABS = 4;

export interface GibPieces {
  names: string[];
  /** For each joint, the piece it goes with. */
  owner: Int16Array;
  /** For each piece, the joint whose frame it keeps (the box is squared to it). */
  root: number[];
}

/** Which piece each bone goes with. Null for a skeleton with no pelvis, head, arms or legs to tell apart. */
export function gibPieces(joints: readonly RigJoint[], level: 0 | 1 | 2): GibPieces | null {
  const { key, spine } = mapRig(joints);
  if (key.hips === undefined || key.head === undefined || key.armL === undefined || key.armR === undefined || key.upLegL === undefined || key.upLegR === undefined) return null;
  const names: string[] = ["trunk"], root: number[] = [key.hips];
  const starts = new Map<number, number>();
  const piece = (name: string, joint: number | undefined) => { if (joint === undefined || starts.has(joint)) return; starts.set(joint, names.length); names.push(name); root.push(joint); };
  piece("head", key.neck ?? key.head);
  for (const side of ["L", "R"] as const) {
    piece(`arm${side}`, key[`arm${side}`]);
    piece(`leg${side}`, key[`upLeg${side}`]);
    if (level >= 1) piece(`shin${side}`, key[`leg${side}`]);
    if (level >= 2) piece(`foreArm${side}`, key[`foreArm${side}`]);
  }
  // The trunk parts at the waist: the pelvis keeps the first spine joint, the chest takes the rest.
  if (level >= 2 && spine.length > 1) { names[0] = "pelvis"; piece("chest", spine[1]); }
  const owner = Int16Array.from(joints.map((_, index) => { for (let at = index; at >= 0; at = joints[at].parent) { const found = starts.get(at); if (found !== undefined) return found; } return 0; }));
  return { names, owner, root };
}

export interface SkinSource {
  /** World positions of the skin as it is posed now, three a vertex. */
  positions: Float32Array;
  /** World normals, three a vertex. */
  normals: Float32Array;
  /** Two a vertex, or null. */
  uvs: Float32Array | null;
  /** Triangles; null for a mesh drawn without an index. */
  index: ArrayLike<number> | null;
  /** The piece each vertex goes with. */
  owner: ArrayLike<number>;
}

export interface GibGeometry {
  piece: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  index: Uint32Array;
  /** The first `skin` indices are the figure's own surface; the remaining `cap` close the cuts. */
  skin: number; cap: number;
  /** Other pieces this one was cut from. */
  neighbours: number[];
}

/** Vertices closer than this are one point when cuts are matched across a UV seam. Scene units. */
const WELD = 2e-4;

/**
 * Cuts a posed skin into its pieces. A triangle goes with the piece most of
 * its corners belong to. Wherever two pieces were joined, each gets a cap: a
 * fan from the middle of the cut to its edge, so no piece is open to look
 * into. Pieces that own no triangle are left out.
 */
export function splitSkin(source: SkinSource, pieces: number): GibGeometry[] {
  const { positions, normals, uvs, owner } = source;
  const triangles = (source.index ? source.index.length : positions.length / 3) / 3 | 0;
  const corner = (t: number, k: number) => source.index ? source.index[t * 3 + k] : t * 3 + k;
  // Weld by position: the same point on either side of a seam is one point of a cut.
  const welded = new Int32Array(positions.length / 3), seen = new Map<string, number>();
  for (let v = 0; v < welded.length; v += 1) {
    const id = `${Math.round(positions[v * 3] / WELD)},${Math.round(positions[v * 3 + 1] / WELD)},${Math.round(positions[v * 3 + 2] / WELD)}`;
    let at = seen.get(id);
    if (at === undefined) { at = seen.size; seen.set(id, at); }
    welded[v] = at;
  }
  const pieceOf = new Int16Array(triangles);
  for (let t = 0; t < triangles; t += 1) {
    const a = owner[corner(t, 0)], b = owner[corner(t, 1)], c = owner[corner(t, 2)];
    pieceOf[t] = b === c ? b : a;
  }
  // Every edge, by its welded ends, with the pieces of the triangles on it.
  const edges = new Map<number, number[]>(), points = seen.size;
  const edgeKey = (a: number, b: number) => a < b ? a * points + b : b * points + a;
  for (let t = 0; t < triangles; t += 1) for (let k = 0; k < 3; k += 1) {
    const id = edgeKey(welded[corner(t, k)], welded[corner(t, (k + 1) % 3)]);
    const list = edges.get(id);
    if (list) list.push(pieceOf[t]); else edges.set(id, [pieceOf[t]]);
  }

  const out: GibGeometry[] = [];
  for (let piece = 0; piece < pieces; piece += 1) {
    const remap = new Map<number, number>(), P: number[] = [], N: number[] = [], U: number[] = [], index: number[] = [];
    const vertex = (v: number): number => {
      let at = remap.get(v);
      if (at === undefined) {
        at = P.length / 3; remap.set(v, at);
        P.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); N.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        if (uvs) U.push(uvs[v * 2], uvs[v * 2 + 1]);
      }
      return at;
    };
    /** Cut edges of this piece, by the piece on the other side: [from, to] in this piece's own winding. */
    const cuts = new Map<number, [number, number][]>();
    for (let t = 0; t < triangles; t += 1) {
      if (pieceOf[t] !== piece) continue;
      for (let k = 0; k < 3; k += 1) {
        const a = corner(t, k), b = corner(t, (k + 1) % 3);
        index.push(vertex(a));
        const other = edges.get(edgeKey(welded[a], welded[b]))!.find(found => found !== piece);
        if (other === undefined) continue;
        const list = cuts.get(other);
        if (list) list.push([a, b]); else cuts.set(other, [[a, b]]);
      }
    }
    if (!index.length) continue;
    const skin = index.length;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < P.length; i += 3) { cx += P[i]; cy += P[i + 1]; cz += P[i + 2]; }
    const middle: V3 = [cx / (P.length / 3), cy / (P.length / 3), cz / (P.length / 3)];
    for (const list of cuts.values()) {
      // One cut may be several separate loops (both shoulders against the chest): each gets its own fan.
      const loop = new Map<number, number>();
      const find = (v: number): number => { let at = v; while (loop.get(at)! !== at) at = loop.get(at)!; loop.set(v, at); return at; };
      for (const [a, b] of list) { const wa = welded[a], wb = welded[b]; if (!loop.has(wa)) loop.set(wa, wa); if (!loop.has(wb)) loop.set(wb, wb); loop.set(find(wa), find(wb)); }
      const fans = new Map<number, [number, number][]>();
      for (const edge of list) { const id = find(welded[edge[0]]); const fan = fans.get(id); if (fan) fan.push(edge); else fans.set(id, [edge]); }
      for (const fan of fans.values()) {
        if (fan.length < 3) continue;
        let x = 0, y = 0, z = 0;
        for (const [a] of fan) { x += positions[a * 3]; y += positions[a * 3 + 1]; z += positions[a * 3 + 2]; }
        const hub: V3 = [x / fan.length, y / fan.length, z / fan.length], facing = unit(sub(hub, middle));
        const cap = (px: number, py: number, pz: number): number => { const at = P.length / 3; P.push(px, py, pz); N.push(facing[0], facing[1], facing[2]); if (uvs) U.push(0, 0); return at; };
        const centre = cap(hub[0], hub[1], hub[2]);
        // Wound the other way round from the skin it closes, so the cap faces out of the cut.
        for (const [a, b] of fan) index.push(cap(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]), cap(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]), centre);
      }
    }
    out.push({
      piece, positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: uvs ? Float32Array.from(U) : null,
      index: Uint32Array.from(index), skin, cap: index.length - skin, neighbours: [...cuts.keys()].sort((a, b) => a - b),
    });
  }
  return out;
}

/** For a figure with no skeleton: the slab each vertex is in, cut across its height (`low` to `high`; by default the mesh's own). */
export function slabOwners(positions: Float32Array, slabs: number, low = Infinity, high = -Infinity): Uint8Array {
  if (!(high > low)) for (let i = 1; i < positions.length; i += 3) { low = Math.min(low, positions[i]); high = Math.max(high, positions[i]); }
  const span = Math.max(1e-6, high - low), owner = new Uint8Array(positions.length / 3);
  for (let v = 0; v < owner.length; v += 1) owner[v] = Math.max(0, Math.min(slabs - 1, Math.floor((positions[v * 3 + 1] - low) / span * slabs)));
  return owner;
}

/** The box, squared to `rotation`, that holds every point given: its centre (world) and half its sides. */
export function fitBox(clouds: readonly Float32Array[], rotation: Q4): { centre: V3; half: V3 } {
  const into = qConj(rotation), low: V3 = [Infinity, Infinity, Infinity], high: V3 = [-Infinity, -Infinity, -Infinity];
  for (const cloud of clouds) for (let i = 0; i < cloud.length; i += 3) {
    const local = qRotate(into, [cloud[i], cloud[i + 1], cloud[i + 2]]);
    for (let k = 0; k < 3; k += 1) { low[k] = Math.min(low[k], local[k]); high[k] = Math.max(high[k], local[k]); }
  }
  if (!Number.isFinite(low[0])) return { centre: [0, 0, 0], half: [0.01, 0.01, 0.01] };
  const middle: V3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
  return { centre: qRotate(rotation, middle), half: [(high[0] - low[0]) / 2, (high[1] - low[1]) / 2, (high[2] - low[2]) / 2] };
}

/** Moves world points and normals into the frame of a box at `centre` turned by `rotation`, in place. */
export function intoFrame(positions: Float32Array, normals: Float32Array, centre: V3, rotation: Q4): void {
  const into = qConj(rotation);
  for (let i = 0; i < positions.length; i += 3) {
    const p = qRotate(into, [positions[i] - centre[0], positions[i + 1] - centre[1], positions[i + 2] - centre[2]]), n = qRotate(into, [normals[i], normals[i + 1], normals[i + 2]]);
    positions[i] = p[0]; positions[i + 1] = p[1]; positions[i + 2] = p[2]; normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2];
  }
}

/** How a burst of power 1 throws its pieces. Scene units and radians a second. */
export const BURST = {
  /** Speed away from the blast, for the nearest piece and the furthest. */
  speed: [1.3, 0.7] as const,
  /** Up, on top: pieces arc, they do not skid. */
  lift: [1.0, 1.7] as const,
  /** Tumble. */
  spin: 9,
  /**
   * Nothing is thrown faster than this, whatever the power. At the world's scale it carries a piece about two
   * squares at most: the first filming, at 4.2, sent arms to the far edge of the board.
   */
  cap: 2.4,
} as const;

/**
 * The velocity and tumble of piece `index` of a burst at `blast`: away from
 * the blast, harder the closer it was, with a seeded scatter so no two bursts
 * and no two pieces match, and the same seed always throws the same way.
 */
export function burstVelocity(centre: V3, blast: V3, power: number, reach: number, seed: number, index: number): { velocity: V3; spin: V3 } {
  const away = sub(centre, blast), distance = length(away), near = 1 - clamp(distance / Math.max(1e-6, reach), 0, 1);
  // A piece right on the blast has no "away": it goes where its number sends it.
  const turn = hash01(seed, index, 0) * Math.PI * 2;
  const flat = unit([away[0], 0, away[2]], [Math.cos(turn), 0, Math.sin(turn)]);
  const jitter = (hash01(seed, index, 1) - 0.5) * 0.9, cos = Math.cos(jitter), sin = Math.sin(jitter);
  const heading: V3 = [flat[0] * cos - flat[2] * sin, 0, flat[0] * sin + flat[2] * cos];
  const force = clamp(power, 0.4, 2);
  const speed = (BURST.speed[1] + (BURST.speed[0] - BURST.speed[1]) * near) * (0.75 + 0.5 * hash01(seed, index, 2)) * force;
  const lift = (BURST.lift[0] + (BURST.lift[1] - BURST.lift[0]) * hash01(seed, index, 3)) * Math.sqrt(force);
  let velocity = add(scale(heading, speed), [0, lift, 0]);
  if (length(velocity) > BURST.cap) velocity = scale(velocity, BURST.cap / length(velocity));
  const spin: V3 = [(hash01(seed, index, 4) - 0.5) * 2 * BURST.spin, (hash01(seed, index, 5) - 0.5) * BURST.spin, (hash01(seed, index, 6) - 0.5) * 2 * BURST.spin];
  return { velocity, spin };
}
