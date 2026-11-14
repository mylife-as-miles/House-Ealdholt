import type { EaldholtLandformLand, EaldholtLandformRect, EaldholtLandformSurface } from './bank-landform';
import type { EaldholtContinuityBounds } from './coastal-continuity';
export interface EaldholtOuterWater extends EaldholtLandformSurface {
  readonly normals: ArrayLike<number>; readonly colours: ArrayLike<number>; readonly uv: ArrayLike<number>;
  readonly across: ArrayLike<number>; readonly halfWidth: ArrayLike<number>;
}
export interface EaldholtOuterContinuationInput {
  readonly land: EaldholtLandformLand; readonly sea: EaldholtOuterWater; readonly channel: EaldholtLandformSurface;
  readonly sourceEnvelope: EaldholtLandformRect; readonly fullBounds: EaldholtContinuityBounds; readonly profile: 'desktop' | 'quest';
}
export interface EaldholtOuterMesh {
  readonly positions: Float32Array; readonly normals: Float32Array; readonly colours: Float32Array;
  readonly uv: Float32Array; readonly indices: Uint16Array; readonly sourceVertex: Int32Array;
}
export interface EaldholtOuterLandformDiagnostics {
  readonly mode:'relief'|'continuation'|'unchanged';
  /** Whole-face corridor for relief only; Native's appended dry strip retains
   * its independent18m shoreline clearance. Relief and added geometry coexist. */
  readonly protectedShoreWidth:number; readonly protectedTriangles:number;
  readonly movedVertices:number; readonly addedVertices:number; readonly addedTriangles:number; readonly extendedSegments:number;
  /** Added XZ footprint area in working model units squared, not surface area. */
  readonly projectedAreaAdded:number; readonly extraGpuBytes:number;
  /** Additional relief relative to the generated surface before shaping,
   * including Native's existing apron and already-appended dry strip. */
  readonly maximumRaise:number|null; readonly maximumLower:number|null;
  readonly minimumChangedShoreDistance:number|null; readonly maximumChangedSlope:number|null; readonly maximumExtension:number;
}
export interface EaldholtOuterContinuationBuffers {
  readonly land: EaldholtOuterMesh & { readonly wetness: Float32Array };
  readonly sea: EaldholtOuterMesh & { readonly across: Float32Array; readonly halfWidth: Float32Array };
  readonly bounds: EaldholtContinuityBounds; readonly triangles: number; readonly bufferBytes: number;
  readonly southWidth: number; readonly westWidth: number; readonly landSegments: number; readonly seaSegments: number;
  readonly landContourRows: 3|4; readonly landform:EaldholtOuterLandformDiagnostics;
}
type Point = [number, number, number];
type Vertex = { p: Point; n: Point; c: Point; uv: [number, number]; scalar: number; half: number; source: number; seam: boolean };
const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
function read(surface: EaldholtLandformLand | EaldholtOuterWater, water: boolean): Vertex[] {
  const count = surface.positions.length / 3, scalars = water ? (surface as EaldholtOuterWater).across : (surface as EaldholtLandformLand).wetness;
  if (!Number.isInteger(count) || count < 3 || count > 65535 || surface.normals.length !== count * 3 || surface.colours.length !== count * 3
    || surface.uv.length !== count * 2 || scalars.length !== count || !surface.indices.length || surface.indices.length % 3
    || (water && (surface as EaldholtOuterWater).halfWidth.length !== count)) throw Error('Incomplete outer-continuation surface.');
  const vertices: Vertex[] = [];
  for (let i = 0; i < count; i++) {
    const p: Point = [surface.positions[i * 3], surface.positions[i * 3 + 1], surface.positions[i * 3 + 2]];
    const n: Point = [surface.normals[i * 3], surface.normals[i * 3 + 1], surface.normals[i * 3 + 2]];
    const c: Point = [surface.colours[i * 3], surface.colours[i * 3 + 1], surface.colours[i * 3 + 2]], uv: [number, number] = [surface.uv[i * 2], surface.uv[i * 2 + 1]];
    const scalar = scalars[i], half = water ? (surface as EaldholtOuterWater).halfWidth[i] : -1;
    if (![...p, ...n, ...c, ...uv, scalar, half].every(Number.isFinite) || n[1] <= 0 || scalar < 0
      || (!water && scalar > 1) || (water && half !== -1)
      || Math.abs(uv[0] - p[0] / 2) > .00005 || Math.abs(uv[1] + p[2] / 2) > .00005) throw Error('Invalid outer-continuation source frame.');
    vertices.push({ p, n, c, uv, scalar, half, source: i, seam: true });
  }
  for (let i = 0; i < surface.indices.length; i++) if (!Number.isInteger(surface.indices[i]) || surface.indices[i] < 0 || surface.indices[i] >= count) throw Error('Invalid outer-continuation index.');
  return vertices;
}
function outerLoop(vertices: Vertex[], indices: ArrayLike<number>): number[] {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = indices[i + j], b = indices[i + (j + 1) % 3], key = edgeKey(a, b), edge = edges.get(key);
    if (edge) { if (++edge.count > 2) throw Error('Nonmanifold outer-continuation land.'); } else edges.set(key, { a, b, count: 1 });
  }
  const next = new Map<number, number>();
  for (const edge of edges.values()) if (edge.count === 1) { if (next.has(edge.a)) throw Error('Branching outer-continuation boundary.'); next.set(edge.a, edge.b); }
  const loops: number[][] = [];
  while (next.size) {
    const start = next.keys().next().value as number, loop: number[] = []; let at = start;
    do { loop.push(at); const to = next.get(at); if (to === undefined) throw Error('Open outer-continuation boundary.'); next.delete(at); at = to; } while (at !== start);
    loops.push(loop);
  }
  const area = (loop: number[]) => Math.abs(loop.reduce((n, id, i) => { const a = vertices[id].p, b = vertices[loop[(i + 1) % loop.length]].p; return n + a[0] * b[2] - b[0] * a[2]; }, 0));
  loops.sort((a, b) => area(b) - area(a)); if (!loops.length) throw Error('Missing outer-continuation boundary.'); return loops[0];
}
class Builder {
  readonly vertices: Vertex[] = []; readonly indices: number[] = []; private readonly cache = new Map<string, number>();
  add(vertex: Vertex): number {
    const key = `${vertex.seam ? 'seam' : 'outer'}:${vertex.source}`, old = this.cache.get(key); if (old !== undefined) return old;
    const id = this.vertices.length; this.vertices.push(vertex); this.cache.set(key, id); return id;
  }
  quad(a: Vertex, b: Vertex, c: Vertex, d: Vertex): void {
    for (const tri of [[a, b, c], [b, d, c]]) {
      const [p, q, r] = tri.map(v => v.p), up = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
      if (Math.abs(up) <= 1e-8) continue; const ids = tri.map(v => this.add(v)); this.indices.push(...(up > 0 ? ids : [ids[0], ids[2], ids[1]]));
    }
  }
  finish(): EaldholtOuterMesh {
    if (!this.indices.length || this.vertices.length > 65535) throw Error('Invalid outer-continuation output.');
    const sums = new Float64Array(this.vertices.length * 3);
    for (let i = 0; i < this.indices.length; i += 3) {
      const ids = this.indices.slice(i, i + 3), [a, b, c] = ids.map(id => this.vertices[id].p), ab = b.map((v, k) => v - a[k]), ac = c.map((v, k) => v - a[k]);
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      if (!n.every(Number.isFinite) || n[1] <= 0) throw Error('Non-upward outer continuation.');
      for (const id of ids) for (let k = 0; k < 3; k++) sums[id * 3 + k] += n[k];
    }
    for (let i = 0; i < this.vertices.length; i++) if (!this.vertices[i].seam) {
      const length = Math.hypot(sums[i * 3], sums[i * 3 + 1], sums[i * 3 + 2]); if (!(length > 0)) throw Error('Unsupported outer-continuation vertex.');
      this.vertices[i].n = [sums[i * 3] / length, sums[i * 3 + 1] / length, sums[i * 3 + 2] / length];
    }
    return { positions: Float32Array.from(this.vertices.flatMap(v => v.p)), normals: Float32Array.from(this.vertices.flatMap(v => v.n)),
      colours: Float32Array.from(this.vertices.flatMap(v => v.c)), uv: Float32Array.from(this.vertices.flatMap(v => v.uv)),
      indices: Uint16Array.from(this.indices), sourceVertex: Int32Array.from(this.vertices.map(v => v.seam ? v.source : -1)) };
  }
}
type Segment = readonly [number, number, number, number];
function coastSegments(sea: Vertex[], channel: EaldholtLandformSurface): Segment[] {
  const p = channel.positions;
  if (p.length < 12 || p.length % 6 || !Array.from(p).every(Number.isFinite)) throw Error('Outer continuation needs the complete inlet opening.');
  const channelRows = Array.from({ length: p.length / 6 }, (_, i) => {
    const at = i * 6; if (Math.abs(p[at] - p[at + 3]) > .0005) throw Error('Invalid outer-continuation channel frame.');
    return [p[at], Math.min(p[at + 2], p[at + 5]), Math.max(p[at + 2], p[at + 5])];
  }).sort((a, b) => a[0] - b[0]);
  const mouth = channelRows[0], coast = sea.filter((_, i) => i % 2 === 1).sort((a, b) => a.p[2] - b.p[2]), segments: Segment[] = [];
  if (coast.length < 2 || Math.abs(Math.max(...coast.map(v => v.p[0])) - mouth[0]) > .001) throw Error('Sea and inlet opening do not join.');
  for (let i = 1; i < coast.length; i++) {
    const a = coast[i - 1].p, b = coast[i].p;
    if (b[2] <= a[2]) throw Error('Unordered outer-continuation coast.');
    // The open mouth is not a shoreline, nor is the finite ocean limit.
    for (const [lo, hi] of [[a[2], Math.min(b[2], mouth[1])], [Math.max(a[2], mouth[2]), b[2]]]) if (hi > lo) {
      const x = (z: number) => a[0] + (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]); segments.push([x(lo), lo, x(hi), hi]);
    }
  }
  if (!segments.length) throw Error('No physical coastline for outer continuation.'); return segments;
}
function shoreDistance(x: number, z: number, segments: Segment[]): number {
  let distance = Infinity;
  for (const [ax, az, bx, bz] of segments) {
    const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance;
}
/** Outside-only, finite continuation of the actual southern mainland and
 * western ocean. It preserves every source buffer and shoreline. +X east/-Z
 * north is a working design frame, never geographic coordinates. */
export function createEaldholtOuterContinuationBuffers(input: EaldholtOuterContinuationInput): EaldholtOuterContinuationBuffers {
  const { sourceEnvelope: source, fullBounds: full, profile } = input;
  if (!['desktop', 'quest'].includes(profile) || ![source.minX, source.maxX, source.minZ, source.maxZ, ...full.min, ...full.max].every(Number.isFinite)
    || source.minX >= source.maxX || source.minZ >= source.maxZ || full.min.some((v, i) => v >= full.max[i])) throw Error('Invalid outer-continuation envelope.');
  const land = read(input.land, false), sea = read(input.sea, true), loop = outerLoop(land, input.land.indices);
  if (sea.length % 2) throw Error('Outer continuation requires paired sea rows.');
  const westX = sea[0].p[0], level = sea[0].p[1], coastX = Math.max(...sea.filter((_, i) => i % 2 === 1).map(v => v.p[0]));
  if (coastX >= source.minX) throw Error('Outer continuation requires the existing western sea.');
  for (let i = 0; i < sea.length; i += 2) if (Math.abs(sea[i].p[0] - westX) > .0005 || sea[i + 1].p[0] <= westX
    || Math.abs(sea[i].p[2] - sea[i + 1].p[2]) > .0005 || Math.abs(sea[i].p[1] - level) > .0005 || Math.abs(sea[i + 1].p[1] - level) > .0005
    || (i && sea[i].p[2] <= sea[i - 2].p[2])) throw Error('Invalid flat open-ocean boundary.');
  const segments = coastSegments(sea, input.channel);
  for (const vertex of sea) if (Math.abs(vertex.scalar - shoreDistance(vertex.p[0], vertex.p[2], segments)) > .0001) throw Error('Existing sea shore attributes do not match its physical coastline.');
  const southWidth = profile === 'quest' ? 32 * 30 / 70 : 32, westWidth = profile === 'quest' ? 20 : 90, taper = profile === 'quest' ? 45 * 30 / 70 : 45;
  const landBuilder = new Builder(), seaBuilder = new Builder(); let landSegments = 0;
  const landContourRows = 3 as const, span = source.maxX - source.minX;
  const south = (vertex: Vertex, row: number): Vertex => {
    const along = (vertex.p[0] - source.minX) / span, t = row / landContourRows;
    // Broad, unequal bays in the dry perimeter replace the straight apron.
    // These are local modelling fractions, not regional map coordinates.
    const widthWave = .58 + .26 * Math.sin(along * 5.4 + .35) + .16 * Math.sin(along * 11.1 + 1.25);
    const desired = southWidth * smooth((vertex.p[0] - coastX) / taper) * (.68 + .32 * widthWave);
    const limit = profile === 'quest' ? Math.min(vertex.p[2] + desired, full.max[2] - .5) : vertex.p[2] + desired;
    const depth = Math.max(0, limit - vertex.p[2]), z = Math.fround(vertex.p[2] + depth * t);
    if (z <= vertex.p[2] + .00001) return vertex;
    const tangent = Math.max(-.45, Math.min(.45, -vertex.n[2] / vertex.n[1]));
    const shoulder = .65 + .35 * Math.cos(along * 4.6 + .8);
    const edgeWave = .45 * Math.sin(along * 5.1 + .2) + .25 * Math.sin(along * 10.3 + 1.3);
    // Broad shallow masses read at inlet distance, while the borrowed source
    // seam stays exact. Cap height rather than flattening a future tree crown.
    const relief = Math.min(3.5, depth * .12) * Math.sin(Math.PI * t) * shoulder + depth * .07 * t * t * edgeWave;
    const floor = Math.min(vertex.p[1], Math.max(full.min[1] + .0001, level + .1001));
    const ceiling = Math.max(vertex.p[1], full.max[1] - .0001);
    const y = Math.fround(Math.max(floor, Math.min(ceiling, vertex.p[1] + tangent * depth * t * (1 - t) ** 2 + relief)));
    // Distinct ring identities weld adjacent segments without collapsing the
    // three contours onto one cached outer vertex. sourceVertex stays -1.
    return { ...vertex, p: [vertex.p[0], y, z], uv: [vertex.uv[0], Math.fround(-z / 2)],
      scalar: 0, source: vertex.source + row * land.length, seam: false };
  };
  for (let i = 0; i < loop.length; i++) {
    const a = land[loop[i]], b = land[loop[(i + 1) % loop.length]];
    if (Math.abs(a.p[0] - b.p[0]) <= .01 || (a.p[2] + b.p[2]) / 2 <= source.maxZ || Math.min(a.p[1], b.p[1]) <= level + .1) continue;
    let previousA = a, previousB = b, extended = false;
    for (let row = 1; row <= landContourRows; row++) {
      const c = south(a, row), d = south(b, row);
      if (c === a && d === b) continue;
      landBuilder.quad(previousA, previousB, c, d); previousA = c; previousB = d; extended = true;
    }
    if (extended) landSegments++;
  }
  const west = (vertex: Vertex): Vertex => {
    const x = Math.fround(vertex.p[0] - westWidth);
    return { ...vertex, p: [x, vertex.p[1], vertex.p[2]], uv: [Math.fround(vertex.uv[0] + (x - vertex.p[0]) / 2), vertex.uv[1]],
      scalar: Math.fround(shoreDistance(x, vertex.p[2], segments)), seam: false };
  };
  for (let i = 2; i < sea.length; i += 2) seaBuilder.quad(sea[i - 2], sea[i], west(sea[i - 2]), west(sea[i]));
  const landBase = landBuilder.finish(), seaBase = seaBuilder.finish();
  const baselineLand = { ...landBase, wetness: Float32Array.from(landBuilder.vertices.map(v => v.scalar)) };
  const seaOutput = { ...seaBase, across: Float32Array.from(seaBuilder.vertices.map(v => v.scalar)), halfWidth: Float32Array.from(seaBuilder.vertices.map(v => v.half)) };
  const countGpuBytes=(land:MainlandSurface)=>[land.positions,land.normals,land.colours,land.uv,land.indices,land.wetness,
    seaOutput.positions,seaOutput.normals,seaOutput.colours,seaOutput.uv,seaOutput.indices,seaOutput.across,seaOutput.halfWidth].reduce((n,a)=>n+a.byteLength,0);
  const ownerBudget={triangles:(baselineLand.indices.length+seaOutput.indices.length)/3,bufferBytes:countGpuBytes(baselineLand)};
  const physicalShore=physicalShoreline(input.channel.positions,input.sea.positions);
  // The6m relief corridor protects complete shore faces. It does not alter
  // the bank owner's26m/18m corridors or Native's outside-only18m strip guard.
  const reliefCorridor={width:6,blendWidth:profile==='quest'?8:12},nativeContinuationClearance=18;
  let landOutput:MainlandSurface,landform:EaldholtOuterLandformDiagnostics;
  if(profile==='desktop'){
    const shaped=shapeMainlandRelief(baselineLand,physicalShore,full,reliefCorridor,coastX,source.maxZ),r=shaped.report;landOutput=shaped.mesh;
    landform={mode:r.changedVertices?'relief':'unchanged',protectedShoreWidth:reliefCorridor.width,protectedTriangles:r.protectedFaces,
      movedVertices:r.changedVertices,addedVertices:0,addedTriangles:0,extendedSegments:0,projectedAreaAdded:0,extraGpuBytes:0,
      maximumRaise:r.maximumRaise,maximumLower:r.maximumLower,minimumChangedShoreDistance:r.minimumChangedClearance,maximumChangedSlope:r.changedFaces?r.maximumChangedSlope:null,maximumExtension:0};
  }else{
    const extended=appendNativeMainland(baselineLand,physicalShore,full,nativeContinuationClearance,ownerBudget),r=extended.report;const shaped=shapeMainlandRelief(extended.mesh,physicalShore,full,reliefCorridor,coastX,source.maxZ),s=shaped.report;landOutput=shaped.mesh;
    landform={mode:s.changedVertices?'relief':r.addedVertices?'continuation':'unchanged',protectedShoreWidth:reliefCorridor.width,protectedTriangles:s.protectedFaces,
      movedVertices:s.changedVertices,addedVertices:r.addedVertices,addedTriangles:r.addedTriangles,extendedSegments:r.selectedSegments,projectedAreaAdded:r.areaGrowth,extraGpuBytes:r.additionalGpuBytes,
      maximumRaise:s.maximumRaise,maximumLower:s.maximumLower,minimumChangedShoreDistance:s.minimumChangedClearance,maximumChangedSlope:s.changedFaces?s.maximumChangedSlope:null,maximumExtension:r.maximumExtension};
  }
  const finalLandContourRows:3|4=landform.addedVertices?4:3;
  const triangles = (landOutput.indices.length + seaOutput.indices.length) / 3;
  // Count unique uploaded arrays; sourceVertex is temporary CPU seam evidence,
  // never a GPU attribute. Projected UV channels alias the same array.
  const bufferBytes = [landOutput.positions, landOutput.normals, landOutput.colours, landOutput.uv, landOutput.indices, landOutput.wetness,
    seaOutput.positions, seaOutput.normals, seaOutput.colours, seaOutput.uv, seaOutput.indices, seaOutput.across, seaOutput.halfWidth].reduce((n, a) => n + a.byteLength, 0);
  if (triangles > 640 || bufferBytes > 65536) throw Error('Outer continuation exceeded the bounded ring budget.');
  const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
  for (const output of [landOutput, seaOutput]) for (let i = 0; i < output.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], output.positions[i + k]); max[k] = Math.max(max[k], output.positions[i + k]);
  }
  return { land: landOutput, sea: seaOutput, bounds: { min, max }, triangles, bufferBytes, southWidth, westWidth, landSegments, seaSegments: sea.length / 2 - 1, landContourRows:finalLandContourRows, landform };
}

/** Exact whole-triangle clearance, including shoreline endpoints inside a
 * face. Point-only checks cannot protect an entire riparian support plane. */
type PlanarPoint=readonly[number,number];type PhysicalShoreSegment=readonly[PlanarPoint,PlanarPoint];
const cross=(a:PlanarPoint,b:PlanarPoint,c:PlanarPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function pointSegment(p:PlanarPoint,a:PlanarPoint,b:PlanarPoint){const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/l)):0;return(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dz)**2;}
function intersects(a:PlanarPoint,b:PlanarPoint,c:PlanarPoint,d:PlanarPoint){if(Math.max(a[0],b[0])+1e-8<Math.min(c[0],d[0])||Math.max(c[0],d[0])+1e-8<Math.min(a[0],b[0])||Math.max(a[1],b[1])+1e-8<Math.min(c[1],d[1])||Math.max(c[1],d[1])+1e-8<Math.min(a[1],b[1]))return false;return cross(a,b,c)*cross(a,b,d)<=1e-12&&cross(c,d,a)*cross(c,d,b)<=1e-12;}
function inside(p:PlanarPoint,t:PlanarPoint[]){if(Math.abs(cross(t[0],t[1],t[2]))<1e-12)return false;const s=t.map((a,i)=>cross(a,t[(i+1)%3],p));return s.every(v=>v>=-1e-8)||s.every(v=>v<=1e-8);}
export function ealdholtTriangleShoreDistanceSquared(t:PlanarPoint[],segments:readonly PhysicalShoreSegment[]){let minimum=Infinity;for(const[a,b]of segments){if(inside(a,t)||inside(b,t))return 0;for(let i=0;i<3;i++){const c=t[i],d=t[(i+1)%3];if(intersects(a,b,c,d))return 0;minimum=Math.min(minimum,pointSegment(c,a,b),pointSegment(a,c,d),pointSegment(b,c,d));}}return minimum;}
function physicalShoreline(channel:ArrayLike<number>,sea:ArrayLike<number>):PhysicalShoreSegment[]{const rows=[];for(let i=0;i<channel.length;i+=6)rows.push({x:channel[i],low:Math.min(channel[i+2],channel[i+5]),high:Math.max(channel[i+2],channel[i+5])});rows.sort((a,b)=>a.x-b.x);const coast=[];for(let i=3;i<sea.length;i+=6)coast.push([sea[i],sea[i+2]]as PlanarPoint);coast.sort((a,b)=>a[1]-b[1]);const segments:PhysicalShoreSegment[]=[];for(let i=1;i<coast.length;i++){const a=coast[i-1],b=coast[i];for(const[lo,hi]of[[a[1],Math.min(b[1],rows[0].low)],[Math.max(a[1],rows[0].high),b[1]]])if(hi>lo){const at=(z:number):PlanarPoint=>[a[0]+(b[0]-a[0])*(z-a[1])/(b[1]-a[1]),z];segments.push([at(lo),at(hi)]);}}for(let i=1;i<rows.length;i++)for(const side of['low','high']as const)segments.push([[rows[i-1].x,rows[i-1][side]],[rows[i].x,rows[i][side]]]);return segments;}

type MainlandSurface={positions:Float32Array;normals:Float32Array;colours:Float32Array;uv:Float32Array;indices:Uint16Array;sourceVertex:Int32Array;wetness:Float32Array};
type MainlandBounds={min:readonly number[];max:readonly number[]};
type MainlandBudget={triangles:number;bufferBytes:number};
function validateMainland(base:MainlandSurface,segments:PhysicalShoreSegment[],bounds:MainlandBounds,width:number){
 if(!bounds||bounds.min.length!==3||bounds.max.length!==3||![...bounds.min,...bounds.max,width].every(Number.isFinite)||width<=0||bounds.min.some((v,i)=>v>=bounds.max[i]))throw Error('Invalid mainland envelope/corridor.');
 if(!Array.isArray(segments)||!segments.length)throw Error('A finite nonempty physical shoreline is required.');
 for(const segment of segments)if(!Array.isArray(segment)||segment.length!==2||segment.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))||segment[0].every((v,i)=>v===segment[1][i]))throw Error('A finite nonempty physical shoreline is required.');
 const count=base?.positions?.length/3;
 if(!Number.isSafeInteger(count)||count<3||count>65535||base.normals?.length!==count*3||base.colours?.length!==count*3||base.uv?.length!==count*2||base.sourceVertex?.length!==count||base.wetness?.length!==count||!base.indices?.length||base.indices.length%3)throw Error('Invalid mainland surface/cardinality or Uint16 range.');
 for(const array of[base.positions,base.normals,base.colours,base.uv,base.wetness])if(!Array.from(array).every(Number.isFinite))throw Error('Nonfinite mainland attribute.');
 for(let id=0;id<count;id++)if(base.normals[id*3+1]<=0||!Number.isSafeInteger(base.sourceVertex[id])||base.sourceVertex[id]<-1||base.wetness[id]<0||base.wetness[id]>1)throw Error('Invalid mainland support attribute.');
 if(Array.from(base.indices).some(id=>!Number.isSafeInteger(id)||id<0||id>=count))throw Error('Invalid mainland index.');
 for(let at=0;at<base.indices.length;at+=3){const[a,b,c]=[base.indices[at]*3,base.indices[at+1]*3,base.indices[at+2]*3],p=base.positions,up=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2]);if(!Number.isFinite(up)||up<=1e-8)throw Error('Mainland support needs nondegenerate upward triangles.');}
}
function measuredMainlandBounds(mesh:MainlandSurface){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let at=0;at<mesh.positions.length;at++) {min[at%3]=Math.min(min[at%3],mesh.positions[at]);max[at%3]=Math.max(max[at%3],mesh.positions[at]);}return{min,max};}
function enforceMainlandBudget(base:MainlandSurface,verticesAdded:number,trianglesAdded:number,owner?:MainlandBudget){
 const landBytes=[base.positions,base.normals,base.colours,base.uv,base.indices,base.wetness].reduce((n,a)=>n+a.byteLength,0),budget=owner??{triangles:base.indices.length/3,bufferBytes:landBytes};
 if(!Number.isSafeInteger(budget.triangles)||budget.triangles<base.indices.length/3||!Number.isSafeInteger(budget.bufferBytes)||budget.bufferBytes<landBytes)throw Error('Invalid full mainland owner budget.');
 if(budget.triangles+trianglesAdded>640||budget.bufferBytes+verticesAdded*48+trianglesAdded*6>65536)throw Error('Mainland candidate exceeded the final owner budget.');
 return owner?'whole-owner':'land-only; enclosing owner must include sea';
}
function appendNativeMainland(base:MainlandSurface,segments:PhysicalShoreSegment[],bounds:MainlandBounds,corridorWidth:number,ownerBudget?:MainlandBudget){
 validateMainland(base,segments,bounds,corridorWidth);enforceMainlandBudget(base,0,0,ownerBudget);
 const p=base.positions,oldCount=p.length/3,key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`,edgeCounts=new Map<string,number>(),maxZ=new Map<number,number>();
 for(let i=0;i<p.length;i+=3)maxZ.set(p[i],Math.max(maxZ.get(p[i])??-Infinity,p[i+2]));
 for(let i=0;i<base.indices.length;i+=3)for(let j=0;j<3;j++){const k=key(base.indices[i+j],base.indices[i+(j+1)%3]);edgeCounts.set(k,(edgeCounts.get(k)??0)+1);}
 const at=(id:number):PlanarPoint=>[p[id*3],p[id*3+2]],room=(id:number)=>Math.max(0,bounds.max[2]-.5-p[id*3+2]);
 // Test a thin nondegenerate strip at the old dry edge, not only its endpoints.
 const edgeClearance=(a:PlanarPoint,b:PlanarPoint)=>Math.sqrt(ealdholtTriangleShoreDistanceSquared([a,b,[a[0],a[1]+.0001]],segments));
 let selected=[...edgeCounts].filter(([,count])=>count===1).map(([k])=>k.split(':').map(Number)as[number,number]).filter(([a,b])=>base.sourceVertex[a]<0&&base.sourceVertex[b]<0&&Math.abs(p[a*3]-p[b*3])>.01&&p[a*3+2]>=maxZ.get(p[a*3])!-.0001&&p[b*3+2]>=maxZ.get(p[b*3])!-.0001&&Math.min(room(a),room(b))>.5&&edgeClearance(at(a),at(b))>corridorWidth+.25);
 const widths=new Map<number,number>();
 function calculate(){const degree=new Map<number,number>();for(const[a,b]of selected){degree.set(a,(degree.get(a)??0)+1);degree.set(b,(degree.get(b)??0)+1);}widths.clear();
  for(const[id,count]of degree){const x=p[id*3],t=(x-bounds.min[0])/(bounds.max[0]-bounds.min[0]);widths.set(id,count===2?Math.min(12,room(id))*(.82+.18*Math.sin(t*4.8+.2)):0);}}
 calculate();
 for(let pass=0;pass<3;pass++){const before=selected.length;selected=selected.filter(([a,b])=>{const c:PlanarPoint=[p[a*3],p[a*3+2]+(widths.get(a)??0)],d:PlanarPoint=[p[b*3],p[b*3+2]+(widths.get(b)??0)];return Math.sqrt(ealdholtTriangleShoreDistanceSquared([at(a),at(b),c],segments))>corridorWidth+.1&&Math.sqrt(ealdholtTriangleShoreDistanceSquared([at(b),d,c],segments))>corridorWidth+.1;});calculate();if(before===selected.length)break;}
 if(!selected.length||![...widths.values()].some(width=>width>.001))return{mesh:base,report:{status:'unchanged-no-eligible-edge',selectedSegments:0,addedVertices:0,addedTriangles:0,additionalGpuBytes:0,areaGrowth:0,areaMeasure:'projected-XZ',minimumClearance:null,maximumSlope:0,extensionXRange:null,maximumExtension:0,fullBoundsPreserved:true,bounds:measuredMainlandBounds(base),budgetScope:enforceMainlandBudget(base,0,0,ownerBudget)}};
 const positions=Array.from(p),normals=Array.from(base.normals),colours=Array.from(base.colours),uv=Array.from(base.uv),source=Array.from(base.sourceVertex),wetness=Array.from(base.wetness),indices=Array.from(base.indices),cache=new Map<number,number>();
 const eligibleX=selected.flatMap(ids=>ids.map(id=>p[id*3])),lo=Math.min(...eligibleX),hi=Math.max(...eligibleX);
 function extended(id:number){const width=widths.get(id)??0;if(width<=.001)return id;const old=cache.get(id);if(old!==undefined)return old;
  const x=p[id*3],z=Math.fround(p[id*3+2]+width),u=(x-lo)/Math.max(1,hi-lo),lobe=(c:number,r:number)=>Math.exp(-(((u-c)/r)**2));
  const delta=(1.1*lobe(.27,.2)+.7*lobe(.77,.23)-.35*lobe(.52,.13))*Math.min(1,width/6),y=Math.fround(Math.max(bounds.min[1]+.001,Math.min(bounds.max[1]-.001,p[id*3+1]+delta)));
  const next=positions.length/3;if(next>=65535)throw Error('Mainland continuation exceeded Uint16 vertex capacity.');if(![x,y,z].every(Number.isFinite))throw Error('Nonfinite mainland continuation vertex.');positions.push(x,y,z);normals.push(...Array.from(base.normals.slice(id*3,id*3+3)));colours.push(...Array.from(base.colours.slice(id*3,id*3+3)));uv.push(x/2,-z/2);source.push(-1);wetness.push(0);cache.set(id,next);return next;}
 function tri(a:number,b:number,c:number){const p=(id:number,k:number)=>positions[id*3+k],up=(p(b,2)-p(a,2))*(p(c,0)-p(a,0))-(p(b,0)-p(a,0))*(p(c,2)-p(a,2));if(Math.abs(up)>1e-8)indices.push(...(up>0?[a,b,c]:[a,c,b]));}
 for(const[a,b]of selected){const c=extended(a),d=extended(b);tri(a,b,c);tri(b,d,c);}
 const addedTriangles=(indices.length-base.indices.length)/3,sums=new Float64Array(positions.length);
 let area=0,minimumClearance=Infinity,maximumSlope=0;
 for(let i=base.indices.length;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]],points=ids.map(id=>[positions[id*3],positions[id*3+2]]as PlanarPoint);minimumClearance=Math.min(minimumClearance,Math.sqrt(ealdholtTriangleShoreDistanceSquared(points,segments)));
  const[a,b,c]=ids.map(id=>positions.slice(id*3,id*3+3)),ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];area+=n[1]/2;maximumSlope=Math.max(maximumSlope,Math.hypot(n[0],n[2])/n[1]);for(const id of ids)if(id>=oldCount)for(let k=0;k<3;k++)sums[id*3+k]+=n[k];}
 for(let id=oldCount;id<positions.length/3;id++){const length=Math.hypot(sums[id*3],sums[id*3+1],sums[id*3+2]);if(!Number.isFinite(length)||length<=1e-12)throw Error('Unsupported mainland continuation normal.');for(let k=0;k<3;k++)normals[id*3+k]=sums[id*3+k]/length;}
 const mesh={positions:Float32Array.from(positions),normals:Float32Array.from(normals),colours:Float32Array.from(colours),uv:Float32Array.from(uv),indices:Uint16Array.from(indices),sourceVertex:Int32Array.from(source),wetness:Float32Array.from(wetness)};
 const budgetScope=enforceMainlandBudget(base,positions.length/3-oldCount,addedTriangles,ownerBudget);
 return{mesh,report:{status:'continued',areaMeasure:'projected-XZ',bounds:measuredMainlandBounds(mesh),budgetScope,selectedSegments:selected.length,addedVertices:positions.length/3-oldCount,addedTriangles,additionalGpuBytes:(positions.length/3-oldCount)*48+addedTriangles*6,areaGrowth:area,minimumClearance,maximumSlope,extensionXRange:[lo,hi],maximumExtension:Math.max(0,...widths.values()),fullBoundsPreserved:positions.every((value,i)=>value>=bounds.min[i%3]&&value<=bounds.max[i%3])}};
}

/** Shape owned mainland only: preserve complete relief-corridor faces and exact
 * source joins, then form unequal positive shoulders with a lower saddle. */
function shapeMainlandRelief(base:MainlandSurface,segments:PhysicalShoreSegment[],bounds:MainlandBounds,corridor:{width:number;blendWidth:number},coastX:number,sourceMaxZ:number){
 validateMainland(base,segments,bounds,corridor?.width);if(![corridor.blendWidth,coastX,sourceMaxZ].every(Number.isFinite)||corridor.blendWidth<=0||coastX>=bounds.max[0]||sourceMaxZ>=bounds.max[2])throw Error('Invalid mainland relief dimensions.');
 const positions=base.positions.slice(),normals=base.normals.slice(),protectedVertices=new Set<number>(),protectedFaces:number[]=[],p=base.positions,ix=base.indices;
 for(let at=0;at<ix.length;at+=3){const ids=[ix[at],ix[at+1],ix[at+2]],tri=ids.map(id=>[p[id*3],p[id*3+2]]as PlanarPoint);
  if(Math.sqrt(ealdholtTriangleShoreDistanceSquared(tri,segments))<=corridor.width+.0001){protectedFaces.push(at/3);ids.forEach(id=>protectedVertices.add(id));}}
 // Derive the taper from actual owned seam/perimeter columns. The first
 // generated ring cannot acquire a full-height rise at its untouched join.
 const columns=new Map<number,{seam:number;end:number}>();
 for(let id=0;id<p.length/3;id++){
  const x=p[id*3],z=p[id*3+2],column=columns.get(x)??{seam:-Infinity,end:-Infinity};
  if(base.sourceVertex[id]>=0)column.seam=Math.max(column.seam,z);
  column.end=Math.max(column.end,z);columns.set(x,column);
 }
 const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);},changed=new Set<number>();let maximumRaise=0,maximumLower=0;
 for(let id=0;id<positions.length/3;id++)if(base.sourceVertex[id]<0&&!protectedVertices.has(id)){
  const x=p[id*3],z=p[id*3+2],u=(x-coastX)/(bounds.max[0]-coastX),v=(z-sourceMaxZ)/(bounds.max[2]-sourceMaxZ),distance=Math.sqrt(Math.min(...segments.map(([a,b])=>pointSegment([x,z],a,b))));
  const lobe=(cx:number,cz:number,rx:number,rz:number)=>Math.exp(-(((u-cx)/rx)**2+((v-cz)/rz)**2));
  // Two broad unequal mainland shoulders, with a connecting lower saddle.
  // Coordinates are normalized to actual coast/source/full terrain extents.
  const column=columns.get(x)!;if(!Number.isFinite(column.seam)||!(column.end>column.seam))throw Error('Missing actual mainland source-edge column.');
  const joinWeight=smooth((z-column.seam)/(column.end-column.seam));
  const delta=(3.4*lobe(.28,.62,.28,.47)+2.1*lobe(.76,.78,.26,.45))*joinWeight*smooth((distance-corridor.width)/corridor.blendWidth);
  const y=Math.fround(Math.max(bounds.min[1]+.001,Math.min(bounds.max[1]-.001,p[id*3+1]+delta)));
  if(y===p[id*3+1])continue;positions[id*3+1]=y;changed.add(id);maximumRaise=Math.max(maximumRaise,y-p[id*3+1]);maximumLower=Math.max(maximumLower,p[id*3+1]-y);
 }
 const sums=new Float64Array(positions.length);let changedFaces=0,minimumChangedClearance=Infinity,maximumChangedSlope=0;
 for(let at=0;at<ix.length;at+=3){const ids=[ix[at],ix[at+1],ix[at+2]],a=Array.from(positions.slice(ids[0]*3,ids[0]*3+3)),b=Array.from(positions.slice(ids[1]*3,ids[1]*3+3)),c=Array.from(positions.slice(ids[2]*3,ids[2]*3+3)),ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  if(n[1]<=0)throw Error('Non-upward candidate apron.');for(const id of ids)for(let k=0;k<3;k++)sums[id*3+k]+=n[k];
  if(ids.some(id=>changed.has(id))){changedFaces++;minimumChangedClearance=Math.min(minimumChangedClearance,Math.sqrt(ealdholtTriangleShoreDistanceSquared(ids.map(id=>[positions[id*3],positions[id*3+2]]as PlanarPoint),segments)));maximumChangedSlope=Math.max(maximumChangedSlope,Math.hypot(n[0],n[2])/n[1]);}
 }
 for(const id of changed){const length=Math.hypot(sums[id*3],sums[id*3+1],sums[id*3+2]);if(!Number.isFinite(length)||length<=1e-12)throw Error('Unsupported mainland relief normal.');for(let k=0;k<3;k++)normals[id*3+k]=sums[id*3+k]/length;}
 return{mesh:{...base,positions,normals},protectedFaces,report:{changedVertices:changed.size,changedFaces,protectedFaces:protectedFaces.length,maximumRaise,maximumLower,minimumChangedClearance:changedFaces?minimumChangedClearance:null,maximumChangedSlope,areaGrowth:0,areaMeasure:'projected-XZ',bounds:measuredMainlandBounds({...base,positions,normals}),addedTriangles:0,additionalGpuBytes:0,fullBoundsPreserved:Array.from(positions).every((v,i)=>v>=bounds.min[i%3]&&v<=bounds.max[i%3])}};
}
