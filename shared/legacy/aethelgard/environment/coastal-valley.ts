import { sampleEaldholtRiverPalette, createEaldholtRiverValleyBuffers, type EaldholtRiverValleyBuffers, type EaldholtTerrainEdges, type EaldholtValleyMesh } from './river-valley';

type Point = [number, number, number];
type Vertex = { p: Point; uv: [number, number]; colour: Point };
export interface EaldholtCoastalShape {
  sourceMinX: number; sourceMaxX: number; sourceMinZ: number; sourceMaxZ: number;
  coastX: number; coastAmplitude: number; seaLevel: number; margin: number;
  mouthLowZ: number; mouthHighZ: number; mouthExtraWidth: number; inletReach: number;
  seaMinX: number; seaMinZ: number; seaMaxZ: number;
  /** Runtime model-derived samples, never geographic coordinates. */
  coastSamples: Float32Array; channelSamples: Float32Array;
}
export interface EaldholtCoastalValleyBuffers {
  land: EaldholtValleyMesh; channel: EaldholtValleyMesh; sea: EaldholtValleyMesh;
  /** Compatibility alias for existing paired-bank woodland and margin intake. */
  water: EaldholtValleyMesh;
  /** Static approximation from actual bank/coast distance and height above the
   * nearest water stage; not groundwater, simulated flooding or a depth pass. */
  landWetness: Float32Array;
  shape: EaldholtCoastalShape;
  bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  triangles: number; bufferBytes: number; sourceJoinVertices: number;
}
export interface EaldholtCoastalInspectionView {
  position: readonly [number, number, number]; target: readonly [number, number, number]; fov: number;
}

/** Inspect the inlet obliquely from its opposite bank. The source settlement
 * and wooded near shore stay ahead of this observer instead of behind a
 * water-only sea-facing view. Profile-derived anchors keep the smaller Native
 * channel in frame. These are observer poses, not geographic compass bearings,
 * an embodied avatar or a claim of regional world scale. */
export function createEaldholtCoastalInspectionView(shape: EaldholtCoastalShape): EaldholtCoastalInspectionView {
  const span = shape.sourceMaxX - shape.sourceMinX;
  const cameraX = shape.sourceMaxX - span * .08;
  const targetX = Math.max(shape.coastX + .01, shape.sourceMinX + span * .14);
  const cameraRow = sectionAt(shape.channelSamples, cameraX), targetRow = sectionAt(shape.channelSamples, targetX);
  if (!cameraRow || !targetRow || cameraX <= targetX) throw Error('A continuing inlet is required for its inspection view.');
  const extraWidth = shape.mouthExtraWidth * (1 - smooth(shape.coastX, shape.coastX + shape.inletReach, cameraX));
  const outerZ = shape.sourceMaxZ + shape.margin + extraWidth, farBankZ = cameraRow[1] + 1.8;
  if (outerZ <= farBankZ) throw Error('A dry opposite inlet bank is required for its inspection view.');
  // The widened mouth moves the real outer-land contour too. Observe between
  // the far bank and that contour, rather than accidentally sitting over a
  // broad small-profile mouth. The wider oblique view retains source woodland
  // to the right and continuing water/sea to the left without moving the house.
  return { position: [cameraX, cameraRow[2] + Math.max(12, span * .12), mix(farBankZ, outerZ, .65)],
    target: [targetX, targetRow[2] + 1.5, mix(targetRow[0], targetRow[1], .18)], fov: 64 };
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return { p: a.p.map((v, c) => mix(v, b.p[c], t)) as Point,
    uv: [mix(a.uv[0], b.uv[0], t), mix(a.uv[1], b.uv[1], t)], colour: a.colour.map((v, c) => mix(v, b.colour[c], t)) as Point };
}
function clip(poly: Vertex[], distance: (v: Vertex) => number): Vertex[] {
  const result: Vertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = distance(a), db = distance(b), insideA = da >= 0, insideB = db >= 0;
    if (insideA) result.push(a); if (insideA !== insideB) result.push(interpolate(a, b, da / (da - db)));
  }
  return result.filter((v, i) => Math.hypot(v.p[0] - result[(i + result.length - 1) % result.length].p[0], v.p[2] - result[(i + result.length - 1) % result.length].p[2]) > 1e-7);
}
function coastAt(samples: Float32Array, z: number): number {
  if (z <= samples[0]) return samples[1]; const end = samples.length - 2; if (z >= samples[end]) return samples[end + 1];
  for (let i = 2; i < samples.length; i += 2) if (z <= samples[i]) return mix(samples[i - 1], samples[i + 1], (z - samples[i - 2]) / (samples[i] - samples[i - 2]));
  return samples[end + 1];
}
function sectionAt(samples: Float32Array, x: number): [number, number, number] | null {
  if (x < samples[0] || x > samples[samples.length - 4]) return null;
  for (let i = 4; i < samples.length; i += 4) if (x <= samples[i]) { const t = (x - samples[i - 4]) / (samples[i] - samples[i - 4]); return [mix(samples[i - 3], samples[i + 1], t), mix(samples[i - 2], samples[i + 2], t), mix(samples[i - 1], samples[i + 3], t)]; }
  return [samples[samples.length - 3], samples[samples.length - 2], samples[samples.length - 1]];
}
export function sampleEaldholtCoastalWater(shape: EaldholtCoastalShape, x: number, z: number): { kind: 'sea' | 'channel'; level: number } | null {
  if (x >= shape.seaMinX && x <= coastAt(shape.coastSamples, z) && z >= shape.seaMinZ && z <= shape.seaMaxZ) return { kind: 'sea', level: shape.seaLevel };
  const section = sectionAt(shape.channelSamples, x); return section && z >= section[0] && z <= section[1] ? { kind: 'channel', level: section[2] } : null;
}

export function sampleEaldholtCoastalShoreDistance(shape: EaldholtCoastalShape, x: number, z: number): { distance:number; level:number } {
  let nearest = Infinity, level = shape.seaLevel;
  function segment(ax: number, az: number, al: number, bx: number, bz: number, bl: number) {
    const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz, t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
    const distance = Math.hypot(x - ax - t * dx, z - az - t * dz); if (distance < nearest) { nearest = distance; level = mix(al, bl, t); }
  }
  for (let i = 2; i < shape.coastSamples.length; i += 2) {
    const a = shape.coastSamples[i - 2], b = shape.coastSamples[i], midpoint = (a + b) / 2;
    if (midpoint > shape.mouthLowZ && midpoint < shape.mouthHighZ) continue;
    segment(shape.coastSamples[i - 1], a, shape.seaLevel, shape.coastSamples[i + 1], b, shape.seaLevel);
  }
  for (let i = 4; i < shape.channelSamples.length; i += 4) for (const bank of [1, 2]) segment(shape.channelSamples[i - 4], shape.channelSamples[i - 4 + bank], shape.channelSamples[i - 1], shape.channelSamples[i], shape.channelSamples[i + bank], shape.channelSamples[i + 3]);
  return { distance: nearest, level };
}

/** Bank-based wetness keeps low ground far from water dry. Open-water chunk
 * edges and the sea/channel join are not shorelines. No shader loop is needed. */
export function sampleEaldholtCoastalWetness(shape: EaldholtCoastalShape, x: number, y: number, z: number): number {
  const coveringWater = sampleEaldholtCoastalWater(shape, x, z); if (coveringWater && y <= coveringWater.level) return 1;
  const {distance:nearest,level}=sampleEaldholtCoastalShoreDistance(shape,x,z);
  return Math.max(0, Math.min(1, (1 - smooth(.05, .9, Math.max(0, y - level))) * (1 - smooth(.25, 3.2, nearest))));
}

/** A generic local coastline, inlet and continuing river. Presentation axes
 * express no regional name, map position, compass bearing or exact world scale.
 * The supplied outside-only base is immutable; original terrain is never
 * generated, displaced, clipped or covered inside its source envelope. */
export function createEaldholtCoastalValleyBuffers(edges: EaldholtTerrainEdges, profile: 'desktop' | 'quest' = 'desktop', base: EaldholtRiverValleyBuffers = createEaldholtRiverValleyBuffers(edges, profile)): EaldholtCoastalValleyBuffers {
  const margin = profile === 'quest' ? 30 : 70, span = edges.maxX - edges.minX;
  if (!(span > 0) || base.water.positions.length < 12 || base.water.positions.length % 6) throw Error('Coastal valley requires an existing paired channel and source envelope.');
  const oldSections = new Float32Array(base.water.positions.length / 3 * 2);
  for (let i = 0, j = 0; i < base.water.positions.length; i += 6, j += 4) {
    const p = base.water.positions; if (Math.abs(p[i] - p[i + 3]) > 1e-5) throw Error('Expected same-X paired river banks.');
    oldSections[j] = p[i]; oldSections[j + 1] = Math.min(p[i + 2], p[i + 5]); oldSections[j + 2] = Math.max(p[i + 2], p[i + 5]); oldSections[j + 3] = (p[i + 1] + p[i + 4]) / 2;
  }
  const coastX = Math.fround(edges.minX - Math.min(margin * .6, Math.max(margin * .35, span * .1))), mouth = sectionAt(oldSections, coastX);
  if (!mouth) throw Error('Model-derived coast lies outside the original river strip.');
  const mouthExtraWidth = margin * .72, inletReach = Math.max(margin, Math.min(span * .62, margin * 2.2));
  const extraAt = (x: number) => mouthExtraWidth * (1 - smooth(coastX, coastX + inletReach, x));
  const section = (x: number): [number, number, number] => { const source = sectionAt(oldSections, x); if (!source) throw Error('River section is unsupported.'); return [source[0], source[1] + extraAt(x), source[2]]; };
  const first = section(coastX), seaLevel = Math.fround(first[2]), mouthLowZ = Math.fround(first[0]), mouthHighZ = Math.fround(first[1]), channelValues: number[] = [coastX, mouthLowZ, mouthHighZ, seaLevel];
  for (let i = 0; i < oldSections.length; i += 4) if (oldSections[i] > coastX + 1e-5) { const row = section(oldSections[i]); channelValues.push(oldSections[i], ...row); }
  const channelSamples = Float32Array.from(channelValues), coastAmplitude = margin * .07;
  const seaLowZ = base.bounds.min[2], seaHighZ = base.bounds.max[2] + mouthExtraWidth + margin * .25;
  const zValues = Array.from({ length: 65 }, (_, i) => Math.fround(mix(seaLowZ, seaHighZ, i / 64)));
  zValues.push(mouthLowZ, mouthHighZ, Math.fround(mouthLowZ - 3), Math.fround(mouthHighZ + 3));
  const seaRows = [...new Set(zValues)].sort((a, b) => a - b), coastValues: number[] = [];
  for (const z of seaRows) { const distance = Math.max(mouthLowZ - z, z - mouthHighZ, 0), variation = .55 + .25 * Math.sin(z * .061 + .2) + .15 * Math.sin(z * .137 + 1.1); coastValues.push(z, Math.fround(coastX - coastAmplitude * variation * smooth(3, 15, distance))); }
  const coastSamples = Float32Array.from(coastValues), shape: EaldholtCoastalShape = { sourceMinX: edges.minX, sourceMaxX: edges.maxX, sourceMinZ: edges.minZ, sourceMaxZ: edges.maxZ,
    coastX, coastAmplitude, seaLevel, margin, mouthLowZ, mouthHighZ, mouthExtraWidth, inletReach, coastSamples, channelSamples,
    seaMinX: Math.fround(coastX - margin * 1.5), seaMinZ: seaRows[0], seaMaxZ: seaRows[seaRows.length - 1] };
  const beachHeight = (z: number) => { const t = (z - mouthLowZ) / (mouthHighZ - mouthLowZ); return seaLevel - (t > 0 && t < 1 ? .9 * Math.sin(Math.PI * t) : 0); };
  const sourceVertices: Vertex[] = [];
  for (let i = 0; i < base.land.positions.length; i += 3) {
    const x = base.land.positions[i], sourceZ = base.land.positions[i + 2], old = sectionAt(oldSections, x); if (!old) throw Error('Base land exceeds channel longitudinal support.');
    const change = extraAt(x), width = old[1] - old[0], z = sourceZ <= old[0] ? sourceZ : sourceZ <= old[1] ? sourceZ + change * (sourceZ - old[0]) / width : sourceZ + change;
    let y = base.land.positions[i + 1], colour = Array.from(base.land.colours.subarray(i, i + 3)) as Point;
    if (x < edges.minX) { const shore = coastAt(coastSamples, z), blend = smooth(0, 1, (edges.minX - x) / (edges.minX - shore)); y = mix(y, beachHeight(z), blend); const wet = 1 - smooth(.02, .9, Math.max(0, y - seaLevel)); colour = colour.map((v, c) => mix(v, [.061, .054, .039][c], wet)) as Point; }
    sourceVertices.push({ p: [x, y, z], uv: [x / 2, -z / 2], colour });
  }
  const vertices: Vertex[] = [], indices: number[] = [], cache = new Map<string, number>();
  function add(vertex: Vertex): number {
    const p = vertex.p.map(Math.fround) as Point, key = p.join(':'); const found = cache.get(key); if (found !== undefined) return found;
    const id = vertices.length; vertices.push({ ...vertex, p }); cache.set(key, id); return id;
  }
  function triangle(a: Vertex, b: Vertex, c: Vertex): void {
    const pa = a.p.map(Math.fround), pb = b.p.map(Math.fround), pc = c.p.map(Math.fround), ny = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
    if (Math.abs(ny) < 1e-8) return; if (ny > 0) indices.push(add(a), add(b), add(c)); else indices.push(add(a), add(c), add(b));
  }
  function fan(poly: Vertex[]): void {
    if (poly.length < 3) return;
    const center: Vertex = { p: [0, 0, 0], uv: [0, 0], colour: [0, 0, 0] };
    for (const v of poly) { for (let c = 0; c < 3; c++) { center.p[c] += v.p[c] / poly.length; center.colour[c] += v.colour[c] / poly.length; } for (let c = 0; c < 2; c++) center.uv[c] += v.uv[c] / poly.length; }
    for (let i = 0; i < poly.length; i++) triangle(center, poly[i], poly[(i + 1) % poly.length]);
  }
  const minimumCoast = Math.min(...coastSamples.filter((_, i) => i % 2 === 1));
  for (let i = 0; i < base.land.indices.length; i += 3) {
    const face = [sourceVertices[base.land.indices[i]], sourceVertices[base.land.indices[i + 1]], sourceVertices[base.land.indices[i + 2]]];
    const minX = Math.min(...face.map(v => v.p[0])), maxX = Math.max(...face.map(v => v.p[0]));
    if (minX >= coastX) { triangle(...face as [Vertex, Vertex, Vertex]); continue; }
    if (maxX < minimumCoast) continue;
    const minZ = Math.min(...face.map(v => v.p[2])), maxZ = Math.max(...face.map(v => v.p[2]));
    for (let row = 1; row < seaRows.length; row++) {
      const lowZ = seaRows[row - 1], highZ = seaRows[row]; if (highZ < minZ || lowZ > maxZ) continue;
      let poly = clip(clip(face, v => v.p[2] - lowZ), v => highZ - v.p[2]); if (poly.length < 3) continue;
      poly = clip(poly, v => v.p[0] - coastAt(coastSamples, v.p[2]));
      // A Float32 slab intersection can land a few micrometres off the same
      // coastal cut. Canonicalize its X as well as height before welding;
      // otherwise near-coincident cuts can acquire overlapping stitched fans.
      for (const v of poly) if (Math.abs(v.p[0] - coastAt(coastSamples, v.p[2])) < 1e-5) { v.p[0] = coastAt(coastSamples, v.p[2]); v.p[1] = beachHeight(v.p[2]); v.colour = [.061, .054, .039]; }
      fan(poly);
    }
  }
  // Conform slab cuts on neighboring original outside-land faces. All inserted
  // points lie on the already authored surface; the source boundary is untouched.
  const candidates = vertices.map((v, i) => ({ v, i })).filter(({ v }) => v.p[0] < edges.minX - 1e-5), stitched: number[] = [];
  const initialTriangles = indices.length / 3;
  for (let at = 0; at < indices.length; at += 3) {
    const face = indices.slice(at, at + 3), perimeter: number[] = []; let split = false;
    for (let e = 0; e < 3; e++) {
      const ai = face[e], bi = face[(e + 1) % 3], a = vertices[ai].p, b = vertices[bi].p, d = b.map((v, c) => v - a[c]), length = d.reduce((n, v) => n + v * v, 0), cuts: { id: number; t: number }[] = [];
      perimeter.push(ai); if (Math.min(a[0], b[0]) >= edges.minX) continue;
      for (const { v, i } of candidates) {
        if (i === ai || i === bi || v.p[0] < Math.min(a[0], b[0]) - 1e-5 || v.p[0] > Math.max(a[0], b[0]) + 1e-5 || v.p[2] < Math.min(a[2], b[2]) - 1e-5 || v.p[2] > Math.max(a[2], b[2]) + 1e-5) continue;
        const t = v.p.reduce((n, p, c) => n + (p - a[c]) * d[c], 0) / length;
        if (t <= 1e-6 || t >= 1 - 1e-6 || Math.hypot(...v.p.map((p, c) => p - a[c] - t * d[c])) > 1e-5) continue; cuts.push({ id: i, t });
      }
      cuts.sort((a, b) => a.t - b.t); let previous = -1; for (const cut of cuts) if (cut.t - previous > 1e-6) { perimeter.push(cut.id); previous = cut.t; split = true; }
    }
    if (!split) { stitched.push(...face); continue; }
    const center = interpolate(interpolate(vertices[face[0]], vertices[face[1]], .5), vertices[face[2]], 1 / 3), id = add(center);
    for (let i = 0; i < perimeter.length; i++) { const a = vertices[id].p, b = vertices[perimeter[i]].p, c = vertices[perimeter[(i + 1) % perimeter.length]].p, ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); if (ny > 1e-8) stitched.push(id, perimeter[i], perimeter[(i + 1) % perimeter.length]); }
  }
  if (stitched.length / 3 > initialTriangles + 4000) throw Error('Coastal shore stitching exceeded its bounded correction budget.');
  const land = refineEaldholtCoastalTransitions(finish(vertices, stitched), shape), channel = waterStrip(channelSamples, 'channel', shape), sea = waterStrip(coastSamples, 'sea', shape);
  const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
  for (const mesh of [land, channel, sea]) for (let i = 0; i < mesh.positions.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], mesh.positions[i + c]); max[c] = Math.max(max[c], mesh.positions[i + c]); }
  const landWetness = Float32Array.from({ length: land.positions.length / 3 }, (_, i) => sampleEaldholtCoastalWetness(shape, land.positions[i * 3], land.positions[i * 3 + 1], land.positions[i * 3 + 2]));
  const triangles = [land, channel, sea].reduce((n, mesh) => n + mesh.indices.length / 3, 0), bufferBytes = landWetness.byteLength + [land, channel, sea].reduce((n, mesh) => n + mesh.positions.byteLength + mesh.normals.byteLength + mesh.uv.byteLength + mesh.colours.byteLength + mesh.indices.byteLength, 0);
  if (triangles >= 15000 || bufferBytes >= 1024 * 1024) throw Error('Coastal surround exceeds the triangle/buffer budget.');
  return { land, channel, water: channel, sea, landWetness, shape, triangles, bufferBytes, bounds: { min, max }, sourceJoinVertices: base.sourceJoinVertices };
}

function waterStrip(samples: Float32Array, kind: 'channel' | 'sea', shape: EaldholtCoastalShape): EaldholtValleyMesh {
  const vertices: Vertex[] = [], indices: number[] = [], width = kind === 'channel' ? 4 : 2;
  for (let i = 0; i < samples.length; i += width) {
    const pair: Point[] = kind === 'channel' ? [[samples[i], samples[i + 3], samples[i + 1]], [samples[i], samples[i + 3], samples[i + 2]]]
      : [[shape.seaMinX, shape.seaLevel, samples[i]], [samples[i + 1], shape.seaLevel, samples[i]]];
    for (const p of pair) vertices.push({ p, uv: [p[0] / 2, -p[2] / 2], colour: [1, 1, 1] });
    if (i) { const a = vertices.length - 4, b = a + 1, c = a + 2, d = a + 3; if (kind === 'channel') indices.push(a, b, c, b, d, c); else indices.push(a, c, b, b, c, d); }
  }
  return finish(vertices, indices);
}

function finish(source: Vertex[], rawIndices: number[]): EaldholtValleyMesh {
  const used = [...new Set(rawIndices)].sort((a, b) => a - b), remap = new Map(used.map((id, index) => [id, index])), vertices = used.map(id => source[id]);
  if (vertices.length > 65535) throw Error('Coastal mesh exceeds Uint16 indexing.');
  const positions = Float32Array.from(vertices.flatMap(v => v.p)), uv = Float32Array.from(vertices.flatMap(v => v.uv)), colours = Float32Array.from(vertices.flatMap(v => v.colour)), indices = Uint16Array.from(rawIndices.map(id => remap.get(id)!)), normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3, ab = [0, 1, 2].map(k => positions[b + k] - positions[a + k]), ac = [0, 1, 2].map(k => positions[c + k] - positions[a + k]), n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (n[1] <= 0 || !n.every(Number.isFinite)) throw Error('Coastal face is not a finite upward surface.');
    for (const id of [a, b, c]) for (let k = 0; k < 3; k++) normals[id + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) { const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]); if (!(length > 0)) throw Error('Coastal normal has no supporting face.'); for (let k = 0; k < 3; k++) normals[i + k] /= length; }
  return { positions, normals, uv, colours, indices };
}

/** Conforming, shape-preserving transition contours. Original seam tuples and
 * every existing position/normal stay exact. New attributes sample the actual
 * shoreline instead of stretching damp soil across a whole coarse bank face. */
export function refineEaldholtCoastalTransitions(land:EaldholtValleyMesh,shape:EaldholtCoastalShape):EaldholtValleyMesh {
  type V={p:Point;n:Point;c:Point;uv:[number,number];field:number;source:number;edge:string|null};
  const contours=[3.2,4.5,6,8],vertices:V[]=[],edgeCounts=new Map<string,number>();
  const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  for(let i=0;i<land.positions.length;i+=3){const x=land.positions[i],z=land.positions[i+2],distance=sampleEaldholtCoastalShoreDistance(shape,x,z).distance;
    vertices.push({p:[x,land.positions[i+1],z],n:Array.from(land.normals.subarray(i,i+3))as Point,c:Array.from(land.colours.subarray(i,i+3))as Point,
      uv:[land.uv[i/3*2],land.uv[i/3*2+1]],field:sampleEaldholtCoastalWater(shape,x,z)?-distance:distance,source:i/3,edge:null});
  }
  for(let i=0;i<land.indices.length;i+=3)for(let j=0;j<3;j++){const k=key(land.indices[i+j],land.indices[i+(j+1)%3]);edgeCounts.set(k,(edgeCounts.get(k)??0)+1);}
  if([...edgeCounts.values()].some(count=>count>2))throw Error('Nonmanifold coastal transition input.');
  const cuts=new Map<string,number>(),edgeCuts=new Map<string,{id:number;t:number}[]>(),triangles:number[][]=[];
  function originalEdge(a:number,b:number):string|null {
    const u=vertices[a],v=vertices[b];if(u.source>=0&&v.source>=0)return key(u.source,v.source);
    for(const [left,right]of [[u,v],[v,u]])if(left.edge&&(right.edge===left.edge||right.source>=0&&left.edge.split(':').map(Number).includes(right.source)))return left.edge;
    return null;
  }
  function make(p:Point,n:Point,field:number,edge:string|null):number {
    const point=p.map(Math.fround)as Point,length=Math.hypot(...n),normal=n.map(v=>v/length)as Point;
    const distance=sampleEaldholtCoastalShoreDistance(shape,point[0],point[2]).distance;
    const id=vertices.length;vertices.push({p:point,n:normal,c:sampleEaldholtRiverPalette(point[0],point[2],distance,normal[1]),
      uv:[point[0]/2,-point[2]/2],field,source:-1,edge});return id;
  }
  function cut(a:number,b:number,level:number):number {
    if(Math.abs(vertices[a].field-level)<1e-9)return a;if(Math.abs(vertices[b].field-level)<1e-9)return b;
    const edge=originalEdge(a,b);if(!edge)throw Error('Transition intersection escaped its original triangle edge.');
    const idKey=`${edge}|${level}`,cached=cuts.get(idKey);if(cached!==undefined)return cached;
    const [ai,bi]=edge.split(':').map(Number),u=vertices[ai],v=vertices[bi];
    // The nearest bank may change along an edge at the widened mouth. Locate
    // the real distance contour rather than interpolating endpoint distances.
    let lo=0,hi=1;const positive=u.field>=level;
    for(let step=0;step<20;step++){const t=(lo+hi)/2,x=mix(u.p[0],v.p[0],t),z=mix(u.p[2],v.p[2],t),d=sampleEaldholtCoastalShoreDistance(shape,x,z).distance;
      const field=sampleEaldholtCoastalWater(shape,x,z)?-d:d;if((field>=level)===positive)lo=t;else hi=t;}
    const t=(lo+hi)/2,p=u.p.map((n,k)=>mix(n,v.p[k],t))as Point,n=u.n.map((n,k)=>mix(n,v.n[k],t))as Point,id=make(p,n,level,edge);
    cuts.set(idKey,id);const list=edgeCuts.get(edge)??[];list.push({id,t});edgeCuts.set(edge,list);return id;
  }
  function half(poly:number[],level:number,below:boolean):number[] {
    const output:number[]=[];
    for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],insideA=below?vertices[a].field<=level:vertices[a].field>=level,insideB=below?vertices[b].field<=level:vertices[b].field>=level;
      if(insideA)output.push(a);if(insideA!==insideB)output.push(cut(a,b,level));}
    return output.filter((id,i)=>id!==output[(i+output.length-1)%output.length]);
  }
  function triangle(a:number,b:number,c:number,output:number[][]):void {
    const p=vertices[a].p,q=vertices[b].p,r=vertices[c].p,up=(q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2]);
    if(Math.abs(up)>1e-8)output.push(up>0?[a,b,c]:[a,c,b]);
  }
  for(let at=0;at<land.indices.length;at+=3){const face=Array.from(land.indices.subarray(at,at+3));
    // A contour may reach the finite boundary, but never splits an existing
    // source/coast/outer seam edge. Neighbouring interior cuts conform below.
    const blocked=face.some((a,j)=>{const b=face[(j+1)%3];return edgeCounts.get(key(a,b))===1&&contours.some(level=>level>Math.min(vertices[a].field,vertices[b].field)+1e-8&&level<Math.max(vertices[a].field,vertices[b].field)-1e-8);});
    if(blocked||Math.min(...face.map(id=>vertices[id].p[0]))<shape.coastX+.001){triangles.push(face);continue;}
    let remainder=face;
    for(const level of contours){if(remainder.length<3)break;const lower=half(remainder,level,true);for(let i=1;i<lower.length-1;i++)triangle(lower[0],lower[i],lower[i+1],triangles);remainder=half(remainder,level,false);}
    for(let i=1;i<remainder.length-1;i++)triangle(remainder[0],remainder[i],remainder[i+1],triangles);
  }
  const indices:number[][]=[];
  for(const face of triangles){const perimeter:number[]=[];
    for(let j=0;j<3;j++){const a=face[j],b=face[(j+1)%3],edge=originalEdge(a,b);perimeter.push(a);if(!edge)continue;
      const [ai,bi]=edge.split(':').map(Number),u=vertices[ai],v=vertices[bi],axis=Math.abs(v.p[0]-u.p[0])>Math.abs(v.p[2]-u.p[2])?0:2;
      const t=(id:number)=>(vertices[id].p[axis]-u.p[axis])/(v.p[axis]-u.p[axis]),ta=t(a),tb=t(b);
      const between=(edgeCuts.get(edge)??[]).filter(c=>c.id!==a&&c.id!==b&&c.t>Math.min(ta,tb)+1e-7&&c.t<Math.max(ta,tb)-1e-7).sort((a,b)=>(a.t-b.t)*Math.sign(tb-ta));
      perimeter.push(...between.map(c=>c.id));
    }
    if(perimeter.length===3){indices.push(face);continue;}
    const p=[0,0,0]as Point,n=[0,0,0]as Point;for(const id of face)for(let k=0;k<3;k++){p[k]+=vertices[id].p[k]/3;n[k]+=vertices[id].n[k]/3;}
    const centre=make(p,n,face.reduce((sum,id)=>sum+vertices[id].field/3,0),null);
    for(let i=0;i<perimeter.length;i++)triangle(centre,perimeter[i],perimeter[(i+1)%perimeter.length],indices);
  }
  if(vertices.length>65535||indices.length>land.indices.length/3+4096)throw Error(`Coastal transitions exceed their finite refinement budget: ${indices.length-land.indices.length/3} extra triangles, ${vertices.length} vertices.`);
  // Existing tuples are copied exactly, including all boundary normals/UVs.
  // New normals follow the original shading field; geometry support is planar.
  const output={positions:Float32Array.from(vertices.flatMap(v=>v.p)),normals:Float32Array.from(vertices.flatMap(v=>v.n)),
    colours:Float32Array.from(vertices.flatMap(v=>v.c)),uv:Float32Array.from(vertices.flatMap(v=>v.uv)),indices:Uint16Array.from(indices.flat())};
  return output;
}
