import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, ShapeUtils, Vector2,
  type Object3D } from 'three';

export interface EaldholtDistantCoastPreview {
  /** Added draws/triangles; bufferBytes includes the owned foreground clone. */
  readonly object: Object3D; readonly drawCalls: 2; readonly triangles: number; readonly bufferBytes: number;
  readonly bounds: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  readonly joins: { landSegments: number; seaSegments: number; riverSegments: number };
  readonly reachMetres: number;
  dispose(): void;
}
type Point = [number, number, number];
type Vertex = { p: Point; n: Point; uv: [number, number]; c: Point; wet: number; across: number; half: number; keepNormal: boolean };
type Surface = { mesh: Mesh; geometry: BufferGeometry; vertices: Vertex[]; indices: number[] };
const foregroundBases = new WeakMap<BufferGeometry, BufferGeometry>();
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const close = (a: number, b: number, epsilon = .002) => Math.abs(a - b) <= epsilon;
const pointKey = (p: Point) => p.map(Math.fround).join(':');
function read(mesh: Mesh, water: boolean, geometry = mesh.geometry): Surface {
  if (Array.isArray(mesh.material) || !(mesh.material instanceof MeshStandardMaterial)) throw Error('Distant coast requires one borrowed standard PBR material per surface.');
  if (mesh.position.lengthSq() || mesh.quaternion.x || mesh.quaternion.y || mesh.quaternion.z || mesh.quaternion.w !== 1
    || mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1) throw Error('Distant coast expects source surfaces in the valley-local frame.');
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv'), colour = geometry.getAttribute('color'), index = geometry.getIndex();
  const wet = geometry.getAttribute('ealdholtShoreWetness'), across = geometry.getAttribute('ealdholtWaterAcross'), half = geometry.getAttribute('ealdholtWaterHalfWidth');
  if (!position || position.itemSize !== 3 || !normal || normal.count !== position.count || !uv || uv.count !== position.count
    || !colour || colour.count !== position.count || !index || index.count % 3
    || (water ? !across || !half || across.count !== position.count || half.count !== position.count : !wet || wet.count !== position.count)) throw Error('Distant coast requires the complete owned valley vertex contract.');
  const vertices: Vertex[] = [];
  for (let i = 0; i < position.count; i++) {
    const value: Vertex = { p: [position.getX(i), position.getY(i), position.getZ(i)], n: [normal.getX(i), normal.getY(i), normal.getZ(i)],
      uv: [uv.getX(i), uv.getY(i)], c: [colour.getX(i), colour.getY(i), colour.getZ(i)],
      wet: wet?.getX(i) ?? 0, across: across?.getX(i) ?? 0, half: half?.getX(i) ?? -1, keepNormal: true };
    if (![...value.p, ...value.n, ...value.uv, ...value.c, value.wet, value.across, value.half].every(Number.isFinite)) throw Error('Nonfinite distant-coast intake.');
    for (const name of ['uv1', 'uv2', 'uv3']) { const other = geometry.getAttribute(name); if (!other || other.count !== position.count || other.getX(i) !== value.uv[0] || other.getY(i) !== value.uv[1]) throw Error('Distant coast requires the current shared projected UV frame.'); }
    vertices.push(value);
  }
  const indices = Array.from({ length: index.count }, (_, i) => index.getX(i));
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)) throw Error('Invalid distant-coast source indices.');
  return { mesh, geometry, vertices, indices };
}
function rows(surface: Surface, axis: 0 | 2): [Vertex, Vertex][] {
  const groups = new Map<number, Vertex[]>();
  for (const vertex of surface.vertices) { const key = vertex.p[axis], group = groups.get(key); if (group) group.push(vertex); else groups.set(key, [vertex]); }
  return [...groups].sort(([a], [b]) => a - b).map(([, group]) => {
    if (group.length !== 2) throw Error('Distant coast needs the original paired water strip.');
    group.sort((a, b) => a.p[axis === 0 ? 2 : 0] - b.p[axis === 0 ? 2 : 0]);
    return group as [Vertex, Vertex];
  });
}
function outerBoundary(surface: Surface): number[] {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < surface.indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = surface.indices[i + j], b = surface.indices[i + (j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const edge = edges.get(key); if (edge) { if (++edge.count > 2) throw Error('Nonmanifold distant-coast source.'); } else edges.set(key, { a, b, count: 1 });
  }
  const next = new Map<number, number>();
  for (const edge of edges.values()) if (edge.count === 1) { if (next.has(edge.a)) throw Error('Branching distant-coast boundary.'); next.set(edge.a, edge.b); }
  const loops: number[][] = [];
  while (next.size) {
    const start = next.keys().next().value as number, loop: number[] = []; let current = start;
    do { loop.push(current); const to = next.get(current); if (to === undefined) throw Error('Open distant-coast source boundary.'); next.delete(current); current = to; } while (current !== start);
    loops.push(loop);
  }
  const area = (loop: number[]) => Math.abs(loop.reduce((n, id, i) => { const a = surface.vertices[id].p, b = surface.vertices[loop[(i + 1) % loop.length]].p; return n + a[0] * b[2] - b[0] * a[2]; }, 0));
  loops.sort((a, b) => area(b) - area(a)); if (!loops.length) throw Error('Missing distant-coast outer boundary.'); return loops[0];
}
function newVertex(x: number, y: number, z: number, water: boolean, half = -1, across = 0): Vertex {
  return { p: [Math.fround(x), Math.fround(y), Math.fround(z)], n: [0, 1, 0], uv: [Math.fround(x / 2), Math.fround(-z / 2)],
    c: water ? [1, 1, 1] : [.063, .080, .034], wet: 0, across: Math.fround(across), half: Math.fround(half), keepNormal: false };
}
function average(vertices: Vertex[]): Vertex {
  const result = newVertex(0, 0, 0, false); result.c = [0, 0, 0]; result.uv = [0, 0];
  for (const vertex of vertices) { for (let i = 0; i < 3; i++) { result.p[i] += vertex.p[i] / vertices.length; result.c[i] += vertex.c[i] / vertices.length; } for (let i = 0; i < 2; i++) result.uv[i] += vertex.uv[i] / vertices.length; result.wet += vertex.wet / vertices.length; result.across += vertex.across / vertices.length; }
  result.half = vertices[0].half; return result;
}

type BankSample = { distance: number; level: number; along: number; side: number };
function bankSampler(water: readonly Surface[]): (x: number, z: number) => BankSample {
  const river = rows(water[0], 0), sea = rows(water[1], 2);
  return (x, z) => {
    let sample: BankSample = { distance: Infinity, level: sea[0][0].p[1], along: x, side: 1 };
    if (x >= river[0][0].p[0] && x <= river[river.length - 1][0].p[0]) {
      for (let i = 1; i < river.length; i++) if (x <= river[i][0].p[0]) {
        const a = river[i - 1], b = river[i], t = (x - a[0].p[0]) / (b[0].p[0] - a[0].p[0]);
        const low = mix(a[0].p[2], b[0].p[2], t), high = mix(a[1].p[2], b[1].p[2], t), side = z < (low + high) / 2 ? -1 : 1;
        sample = { distance: side < 0 ? low - z : z - high, level: mix(a[0].p[1], b[0].p[1], t), along: x, side }; break;
      }
    }
    if (z >= sea[0][1].p[2] && z <= sea[sea.length - 1][1].p[2]) {
      for (let i = 1; i < sea.length; i++) if (z <= sea[i][1].p[2]) {
        const a = sea[i - 1][1].p, b = sea[i][1].p, coast = mix(a[0], b[0], (z - a[2]) / (b[2] - a[2]));
        if (x - coast < sample.distance) sample = { distance: x - coast, level: a[1], along: z, side: 1 }; break;
      }
    }
    return sample;
  };
}

/** Shared-edge bisection preserves the original face order wherever unchanged.
 * Only broad interior bank faces gain transverse support; locked contact faces
 * and all single-sided boundary edges remain exact, without T-junctions. */
function refineBanks(vertices: Vertex[], faces: number[][], locked: Set<number>, sample: (x: number, z: number) => BankSample): void {
  type Edge = { a: number; b: number; faces: Set<number>; score: number; t: number };
  const edges = new Map<string, Edge>(), candidates = new Set<Edge>();
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const up = (a: Point, b: Point, c: Point) => (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  function rank(edge: Edge): void {
    candidates.delete(edge);
    if (edge.faces.size !== 2 || [...edge.faces].some(id => locked.has(id))) return;
    const a = vertices[edge.a].p, b = vertices[edge.b].p, left = sample(a[0], a[2]), right = sample(b[0], b[2]);
    edge.t = .5; let cut = false;
    for (const limit of [.5, 4]) if ((left.distance < limit - .0001 && right.distance > limit + .0001)
      || (right.distance < limit - .0001 && left.distance > limit + .0001)) {
      let low = 0, high = 1;
      for (let step = 0; step < 24; step++) {
        const t = (low + high) / 2, value = sample(mix(a[0], b[0], t), mix(a[2], b[2], t)).distance;
        if ((value < limit) === (left.distance < limit)) low = t; else high = t;
      }
      edge.t = (low + high) / 2; cut = true; break;
    }
    const point = a.map((value, i) => Math.fround(mix(value, b[i], edge.t))) as Point, mid = sample(point[0], point[2]);
    if ((!cut && (mid.distance <= .5 || mid.distance >= 4)) || point[1] <= mid.level + .01) return;
    for (const id of edge.faces) {
      const face = faces[id], j = face.findIndex((v, i) => key(v, face[(i + 1) % 3]) === key(edge.a, edge.b));
      const p = vertices[face[j]].p, q = vertices[face[(j + 1) % 3]].p, r = vertices[face[(j + 2) % 3]].p;
      if (up(p, point, r) <= 1e-7 || up(point, q, r) <= 1e-7) return;
    }
    const span = Math.abs(left.distance - right.distance), length = Math.hypot(a[0] - b[0], a[2] - b[2]);
    edge.score = cut ? 1e6 + length : Math.max(0, span - .65) * 3 + Math.max(0, length - 2.8);
    if (edge.score > 0) candidates.add(edge);
  }
  function add(id: number): void {
    const face = faces[id];
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], k = key(a, b);
      let edge = edges.get(k); if (!edge) { edge = { a, b, faces: new Set(), score: 0, t: .5 }; edges.set(k, edge); }
      edge.faces.add(id); rank(edge);
    }
  }
  function remove(id: number): void {
    const face = faces[id];
    for (let j = 0; j < 3; j++) {
      const k = key(face[j], face[(j + 1) % 3]), edge = edges.get(k)!;
      edge.faces.delete(id); candidates.delete(edge);
      if (!edge.faces.size) edges.delete(k); else rank(edge);
    }
  }
  for (let id = 0; id < faces.length; id++) add(id);
  for (let pass = 0; pass < 900 && candidates.size; pass++) {
    let edge: Edge | null = null;
    for (const candidate of candidates) if (!edge || candidate.score > edge.score) edge = candidate;
    if (!edge) break;
    const owners = [...edge.faces], a = vertices[edge.a], b = vertices[edge.b], t = edge.t, midpoint = average([a, b]), mid = vertices.length;
    midpoint.p = a.p.map((value, i) => Math.fround(mix(value, b.p[i], t))) as Point;
    midpoint.n = a.n.map((value, i) => mix(value, b.n[i], t)) as Point;
    midpoint.c = a.c.map((value, i) => mix(value, b.c[i], t)) as Point;
    midpoint.uv = a.uv.map((value, i) => mix(value, b.uv[i], t)) as [number, number];
    midpoint.wet = mix(a.wet, b.wet, t); midpoint.keepNormal = true;
    vertices.push(midpoint);
    for (const id of owners) remove(id);
    for (const id of owners) {
      const face = faces[id], j = face.findIndex((a, i) => key(a, face[(i + 1) % 3]) === key(edge!.a, edge!.b));
      const a = face[j], b = face[(j + 1) % 3], c = face[(j + 2) % 3];
      faces[id] = [a, mid, c]; const extra = faces.length; faces.push([mid, b, c]); add(id); add(extra);
    }
  }
}

/** Accepted R4 surface, evaluated only at its original vertices. In particular,
 * subdivision must never resample this broad field beneath the woodland. */
function foregroundLandR4(land: Surface, outer: number[], water: readonly Surface[]): BufferGeometry {
  const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < land.indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = land.indices[i + j], b = land.indices[i + (j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const found = edgeCounts.get(key); if (found) found.count++; else edgeCounts.set(key, { a, b, count: 1 });
  }
  const fixed = new Set<number>();
  for (const edge of edgeCounts.values()) if (edge.count === 1) { fixed.add(edge.a); fixed.add(edge.b); }
  const outside = new Set(outer), inner = [...fixed].filter(id => !outside.has(id));
  if (!inner.length) throw Error('Foreground land requires the existing village opening.');
  const minX = Math.min(...inner.map(id => land.vertices[id].p[0])), maxX = Math.max(...inner.map(id => land.vertices[id].p[0]));
  const minZ = Math.min(...inner.map(id => land.vertices[id].p[2])), maxZ = Math.max(...inner.map(id => land.vertices[id].p[2]));
  const waterLevel = Math.max(...water.flatMap(surface => surface.vertices.map(vertex => vertex.p[1])));
  const weights = new Float32Array(land.vertices.length);
  const geometry = land.geometry.clone(), positions = geometry.getAttribute('position'), colours = geometry.getAttribute('color');
  for (const name of ['uv1', 'uv2', 'uv3']) geometry.setAttribute(name, geometry.getAttribute('uv'));
  for (let i = 0; i < land.vertices.length; i++) {
    const source = land.vertices[i], [x, y, z] = source.p;
    if (fixed.has(i) || source.wet > .015 || y <= waterLevel + .05) continue;
    const sourceDistance = Math.hypot(Math.max(minX - x, x - maxX, 0), Math.max(minZ - z, z - maxZ, 0));
    let edgeDistanceSquared = Infinity;
    for (let j = 0; j < outer.length; j++) {
      const a = land.vertices[outer[j]].p, b = land.vertices[outer[(j + 1) % outer.length]].p;
      const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
      const t = length ? clamp(((x - a[0]) * dx + (z - a[2]) * dz) / length) : 0;
      edgeDistanceSquared = Math.min(edgeDistanceSquared, (x - a[0] - t * dx) ** 2 + (z - a[2] - t * dz) ** 2);
    }
    const influence = smooth((sourceDistance - 2) / 13) * smooth((Math.sqrt(edgeDistanceSquared) - 2) / 13);
    const dry = smooth((y - waterLevel - .05) / 1.15), weight = influence * dry;
    if (weight <= 0) continue;
    weights[i] = weight;
    const cluster = clamp(.48 + .29 * Math.sin(x / 27 + .6 * Math.sin(z / 41)) + .26 * Math.cos(z / 22 - x / 63));
    const relief = Math.max(0, .4 + .58 * Math.sin(x / 31 + z / 67) + .45 * Math.cos(z / 25 - x / 73));
    positions.setY(i, y + relief * weight);
    const grass = smooth((cluster - .24) / .52);
    const stone = smooth((.5 + .5 * Math.sin(x / 42 - z / 37) - .72) / .28) * (1 - grass) * .48;
    const soil: Point = [.071, .049, .029], turf: Point = [.035, .064, .025], rock: Point = [.091, .096, .082];
    const shade = .91 + .16 * cluster;
    for (let c = 0; c < 3; c++) {
      const colour = mix(mix(soil[c], turf[c], grass), rock[c], stone) * shade;
      colours.setComponent(i, c, mix(source.c[c], colour, influence * .9));
    }
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < land.vertices.length; i++) {
    if (!weights[i]) normals.setXYZ(i, ...land.vertices[i].n);
    if (![positions.getY(i), colours.getX(i), colours.getY(i), colours.getZ(i), normals.getX(i), normals.getY(i), normals.getZ(i)].every(Number.isFinite)
      || normals.getY(i) <= 0) { geometry.dispose(); throw Error('Foreground clone must retain finite upward land.'); }
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
function foregroundLand(land: Surface, outer: number[], water: readonly Surface[]): BufferGeometry {
  const baseline = foregroundLandR4(land, outer, water);
  try {
    const r4 = read(land.mesh, false, baseline), vertices = r4.vertices;
    const faces = Array.from({ length: r4.indices.length / 3 }, (_, i) => r4.indices.slice(i * 3, i * 3 + 3));
    const sample = bankSampler(water), locked = new Set<number>(), fixed = new Set<number>();
    const edges = new Map<string, { a: number; b: number; count: number }>();
    for (const face of faces) for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`, edge = edges.get(key);
      if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
    }
    for (const edge of edges.values()) if (edge.count === 1) { fixed.add(edge.a); fixed.add(edge.b); }
    for (let id = 0; id < faces.length; id++) if (faces[id].some(i => {
      const p = vertices[i].p, bank = sample(p[0], p[2]);
      return bank.distance <= .5 && p[1] <= bank.level + .01;
    })) locked.add(id);
    refineBanks(vertices, faces, locked, sample);
    // Every face touching unmodified dry land stays on its exact R4 plane.
    // This includes the full support under crowns, not merely their roots.
    const eligible = new Uint8Array(vertices.length); eligible.fill(1);
    const inside = (p: Point) => { const d = sample(p[0], p[2]).distance; return d >= .5 - .0001 && d <= 4 + .0001; };
    for (let id = 0; id < faces.length; id++) {
      const points = faces[id].map(i => vertices[i].p);
      const probes = [...points, ...points.map((p, j) => p.map((v, k) => (v + points[(j + 1) % 3][k]) / 2) as Point),
        points[0].map((_, k) => points.reduce((sum, p) => sum + p[k] / 3, 0)) as Point];
      if (locked.has(id) || !probes.every(inside)) for (const i of faces[id]) eligible[i] = 0;
    }
    for (let i = 0; i < vertices.length; i++) {
      if (!eligible[i] || fixed.has(i)) continue;
      const vertex = vertices[i], [x, y, z] = vertex.p, bank = sample(x, z);
      const across = clamp((bank.distance - .5) / 3.5), taper = Math.sin(Math.PI * across) ** 2;
      if (taper < .000001 || y <= bank.level + .01) continue;
      const patch = clamp(.5 + .3 * Math.sin(bank.along / 12 + bank.side * .7) + .2 * Math.sin(bank.along / 5.7));
      vertex.p[1] = Math.fround(y + taper * (.22 + .24 * patch));
      const grass = smooth((across - .18 - .23 * patch) / .55), stone = (1 - grass) * patch * .17;
      const loam: Point = [.052, .040, .026], turf: Point = [.034, .064, .025], rock: Point = [.084, .083, .068];
      vertex.c = vertex.c.map((value, c) => mix(value, mix(mix(loam[c], turf[c], grass), rock[c], stone), taper * .95)) as Point;
      vertex.wet = mix(vertex.wet, (1 - grass) * .46, taper * .8); vertex.keepNormal = false;
    }
    const builder = new Builder(); builder.vertices = vertices; builder.indices = faces.flat();
    return builder.finish(false);
  } finally { baseline.dispose(); }
}

class Builder {
  vertices: Vertex[] = []; indices: number[] = []; private cache = new Map<string, number>();
  add(vertex: Vertex): number {
    const key = [pointKey(vertex.p), ...vertex.uv, ...vertex.c, vertex.wet, vertex.across, vertex.half].join(':');
    const found = this.cache.get(key); if (found !== undefined) return found;
    const id = this.vertices.length; this.vertices.push(vertex); this.cache.set(key, id); return id;
  }
  triangle(a: Vertex, b: Vertex, c: Vertex): void {
    const up = (b.p[2] - a.p[2]) * (c.p[0] - a.p[0]) - (b.p[0] - a.p[0]) * (c.p[2] - a.p[2]);
    if (Math.abs(up) < 1e-8) return;
    if (up > 0) this.indices.push(this.add(a), this.add(b), this.add(c)); else this.indices.push(this.add(a), this.add(c), this.add(b));
  }
  quad(a: Vertex, b: Vertex, c: Vertex, d: Vertex): void { this.triangle(a, b, c); this.triangle(b, d, c); }
  polygon(raw: Vertex[], terrain: (vertex: Vertex) => Vertex, spacing: number): void {
    const start = this.indices.length;
    const polygon = raw.filter((vertex, i) => pointKey(vertex.p) !== pointKey(raw[(i + raw.length - 1) % raw.length].p));
    const coarse = ShapeUtils.triangulateShape(polygon.map(v => new Vector2(v.p[0], v.p[2])), []);
    for (const face of coarse) {
      const corners = face.map(id => polygon[id]), perimeter: Vertex[] = []; let split = false;
      for (let e = 0; e < 3; e++) {
        const a = corners[e], b = corners[(e + 1) % 3], dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2], length = dx * dx + dz * dz;
        perimeter.push(a); const cuts: { vertex: Vertex; t: number }[] = [];
        for (const vertex of polygon) {
          const t = ((vertex.p[0] - a.p[0]) * dx + (vertex.p[2] - a.p[2]) * dz) / length;
          if (t <= 1e-7 || t >= 1 - 1e-7 || Math.hypot(vertex.p[0] - a.p[0] - t * dx, vertex.p[2] - a.p[2] - t * dz) > .0001) continue;
          cuts.push({ vertex, t });
        }
        cuts.sort((a, b) => a.t - b.t); let previous = -1;
        for (const cut of cuts) if (cut.t - previous > 1e-7) { perimeter.push(cut.vertex); previous = cut.t; split = true; }
      }
      if (!split) this.triangle(corners[0], corners[1], corners[2]);
      else { const centre = terrain(average(corners)); for (let i = 0; i < perimeter.length; i++) this.triangle(centre, perimeter[i], perimeter[(i + 1) % perimeter.length]); }
    }
    // Split shared interior edges together. Boundary edges, including every
    // original seam segment, remain exact and cannot acquire T-junctions.
    const faces: number[][] = [];
    for (let i = start; i < this.indices.length; i += 3) faces.push(this.indices.slice(i, i + 3));
    this.indices.length = start;
    const turn = (a: number, b: number, c: number) => { const p = this.vertices[a].p, q = this.vertices[b].p, r = this.vertices[c].p; return (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]); };
    const oriented = (a: number, b: number, c: number) => turn(a, b, c) > 0 ? [a, b, c] : [a, c, b];
    // Spend the bounded sample budget on visible land relief first. Shared
    // interior edges are still split together; source seam edges never move.
    const anchor = average(polygon.filter(vertex => vertex.keepNormal));
    const samples = new Map<string, { vertex: Vertex; weight: number }>();
    for (let pass = 0; pass < 650; pass++) {
      const edges = new Map<string, { a: number; b: number; faces: number[]; length: number }>();
      for (let i = 0; i < faces.length; i++) for (let j = 0; j < 3; j++) {
        const a = faces[i][j], b = faces[i][(j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`, found = edges.get(key);
        if (found) found.faces.push(i);
        else { const p = this.vertices[a].p, q = this.vertices[b].p; edges.set(key, { a, b, faces: [i], length: Math.hypot(p[0] - q[0], p[2] - q[2]) }); }
      }
      let longest: { a: number; b: number; faces: number[]; length: number } | undefined, priority = 0;
      for (const edge of edges.values()) if (edge.faces.length === 2 && edge.length > spacing) {
        const key = edge.a < edge.b ? `${edge.a}:${edge.b}` : `${edge.b}:${edge.a}`;
        let sample = samples.get(key);
        if (!sample) {
          const a = this.vertices[edge.a], b = this.vertices[edge.b], vertex = terrain(average([a, b]));
          const distance = Math.hypot(vertex.p[0] - anchor.p[0], vertex.p[2] - anchor.p[2]);
          const bend = Math.abs(vertex.p[1] - (a.p[1] + b.p[1]) / 2);
          sample = { vertex, weight: (1 + Math.min(8, bend * .45)) / (1 + (distance / 620) ** 3) }; samples.set(key, sample);
        }
        const area = edge.faces.reduce((sum, i) => sum + Math.abs(turn(faces[i][0], faces[i][1], faces[i][2])), 0), score = edge.length * Math.sqrt(area) * sample.weight;
        if (score > priority) { priority = score; longest = edge; }
      }
      if (!longest) break;
      const key = longest.a < longest.b ? `${longest.a}:${longest.b}` : `${longest.b}:${longest.a}`;
      const mid = this.add(samples.get(key)!.vertex);
      for (const i of longest.faces) {
        const face = faces[i], j = face.findIndex((a, j) => (a === longest!.a && face[(j + 1) % 3] === longest!.b) || (a === longest!.b && face[(j + 1) % 3] === longest!.a));
        const a = face[j], b = face[(j + 1) % 3], c = face[(j + 2) % 3];
        faces[i] = oriented(a, mid, c); faces.push(oriented(mid, b, c));
      }
    }
    for (const face of faces) this.triangle(...face.map(id => this.vertices[id]) as [Vertex, Vertex, Vertex]);
  }
  finish(water: boolean): BufferGeometry {
    if (!this.indices.length || this.vertices.length >= 65536) throw Error('Distant-coast mesh exceeds its bounded indexing contract.');
    const positions = Float32Array.from(this.vertices.flatMap(v => v.p)), normals = new Float32Array(positions.length);
    const uv = new BufferAttribute(Float32Array.from(this.vertices.flatMap(v => v.uv)), 2), geometry = new BufferGeometry();
    for (let i = 0; i < this.indices.length; i += 3) {
      const a = this.indices[i] * 3, b = this.indices[i + 1] * 3, c = this.indices[i + 2] * 3;
      const ab = [0, 1, 2].map(k => positions[b + k] - positions[a + k]), ac = [0, 1, 2].map(k => positions[c + k] - positions[a + k]);
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      if (!(n[1] > 0) || !n.every(Number.isFinite)) throw Error('Distant-coast face must be finite and upward.');
      for (const id of [a, b, c]) for (let k = 0; k < 3; k++) normals[id + k] += n[k];
    }
    for (let i = 0; i < this.vertices.length; i++) {
      const length = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]); if (!(length > 0)) throw Error('Unsupported distant-coast vertex.');
      for (let k = 0; k < 3; k++) normals[i * 3 + k] = this.vertices[i].keepNormal ? this.vertices[i].n[k] : normals[i * 3 + k] / length;
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3)); geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('color', new BufferAttribute(Float32Array.from(this.vertices.flatMap(v => v.c)), 3));
    for (const name of ['uv', 'uv1', 'uv2', 'uv3']) geometry.setAttribute(name, uv);
    if (water) { geometry.setAttribute('ealdholtWaterAcross', new BufferAttribute(Float32Array.from(this.vertices.map(v => v.across)), 1)); geometry.setAttribute('ealdholtWaterHalfWidth', new BufferAttribute(Float32Array.from(this.vertices.map(v => v.half)), 1)); }
    else geometry.setAttribute('ealdholtShoreWetness', new BufferAttribute(Float32Array.from(this.vertices.map(v => v.wet)), 1));
    geometry.setIndex(new BufferAttribute(Uint16Array.from(this.indices), 1)); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
  }
}

/** Opt-in Desktop landform study. Extend the real open boundary into continuous
 * mainland/ocean, without covering the source village or its finite inlet.
 * Everything remains valley-local; names/axes imply no regional georeference.
 * Add the result inside the valley group before material adaptation. This adds
 * real geometry/bounds, never a framing exclusion, fog patch or alpha skirt.
 * While active, the existing generated land uses an owned foreground clone.
 * Dispose before the valley owner; the borrowed original is restored only if
 * this diagnostic still owns that mesh's geometry. */
export function createEaldholtDistantCoastPreview(valley: Object3D, options: { reachMetres?: number } = {}): EaldholtDistantCoastPreview {
  if (valley.userData.crownfallRiverValley?.profile !== 'desktop') throw Error('Distant coast is a Desktop-only diagnostic; Native staging is unchanged.');
  const reach = options.reachMetres ?? 1200;
  if (!Number.isFinite(reach) || reach < 900 || reach > 3000) throw Error('Distant-coast reach must extend beyond the current Desktop far plane.');
  const find = (pattern: RegExp) => { const mesh = valley.children.find(value => value instanceof Mesh && pattern.test(value.name)); if (!(mesh instanceof Mesh)) throw Error('Missing distant-coast source surface.'); return mesh; };
  const landSource = find(/outside village valley/), baseGeometry = foregroundBases.get(landSource.geometry) ?? landSource.geometry;
  const land = read(landSource, false, baseGeometry), channel = read(find(/regional river surface/), true), sea = read(find(/open sea surface/), true);
  if (channel.mesh.material !== sea.mesh.material) throw Error('Distant sea/river must borrow the same existing water material.');
  const seaRows = rows(sea, 2), channelRows = rows(channel, 0), outer = outerBoundary(land);
  const seaLevel = seaRows[0][0].p[1], westX = seaRows[0][0].p[0], farWestX = Math.fround(westX - reach), end = channelRows[channelRows.length - 1];
  if (seaRows.some(row => row.some(v => !close(v.p[1], seaLevel) || v.half !== -1) || !close(row[0].p[0], westX))) throw Error('Distant coast needs the current flat paired sea boundary.');
  const coastX = (z: number) => { for (let i = 1; i < seaRows.length; i++) if (z <= seaRows[i][1].p[2]) { const a = seaRows[i - 1][1].p, b = seaRows[i][1].p; return mix(a[0], b[0], (z - a[2]) / (b[2] - a[2])); } return seaRows[seaRows.length - 1][1].p[0]; };
  const coastal = outer.filter(id => close(land.vertices[id].p[0], coastX(land.vertices[id].p[2])));
  if (coastal.length < 2) throw Error('Distant mainland cannot identify the actual coastline endpoints.');
  coastal.sort((a, b) => land.vertices[a].p[2] - land.vertices[b].p[2]); const north = coastal[0], south = coastal[coastal.length - 1];
  const endpoint = (point: Point) => { const id = outer.find(id => close(land.vertices[id].p[0], point[0]) && close(land.vertices[id].p[2], point[2])); if (id === undefined) throw Error('Missing actual land/river endpoint seam.'); return id; };
  const near = endpoint(end[0].p), far = endpoint(end[1].p);
  const walk = (direction: number) => { const path = [north]; let i = outer.indexOf(north); while (path[path.length - 1] !== south) { i = (i + direction + outer.length) % outer.length; path.push(outer[i]); if (path.length > outer.length) throw Error('Invalid distant land path.'); } return path; };
  const paths = [walk(1), walk(-1)], path = paths.find(ids => ids.includes(near) && ids.includes(far));
  if (!path || path.indexOf(near) >= path.indexOf(far)) throw Error('Distant coast cannot preserve the open inland channel.');
  const northLand = path.slice(0, path.indexOf(near) + 1).map(id => land.vertices[id]);
  const southLand = path.slice(path.indexOf(far)).map(id => land.vertices[id]);
  const bedEdge = path.slice(path.indexOf(near), path.indexOf(far) + 1).map(id => land.vertices[id]);
  if (bedEdge.length < 3 || bedEdge.some(v => !close(v.p[0], end[0].p[0])) || Math.min(...bedEdge.map(v => v.p[1])) >= end[0].p[1] - .1) throw Error('A real submerged source river bed is required.');
  const distances = [0, .02, .05, .1, .18, .3, .45, .65, 1].map(value => value * reach);
  const coastDistances = [0, .018, .04, .07, .105, .15, .21, .28, .36, .46, .58, .72, .86, 1].map(value => value * reach);
  const coastLine = (direction: -1 | 1): Vertex[] => {
    const at = direction < 0 ? 0 : seaRows.length - 1, neighbour = seaRows[at - direction][1].p, source = seaRows[at][1];
    const slope = (source.p[0] - neighbour[0]) / (source.p[2] - neighbour[2]);
    return coastDistances.map((distance, i) => {
      if (!i) return source;
      const z = source.p[2] + direction * distance;
      const scale = Math.min(1.2, reach / 1200), d = distance / scale;
      const lobe = (at: number, width: number, depth: number) => depth * Math.exp(-(((d - at) / width) ** 2));
      // Unequal headlands and an intervening cove continue the real shoreline.
      // The far reach bounds the model; it does not push all relief beyond view.
      const shape = direction < 0 ? lobe(260, 180, -135) + lobe(510, 150, 120) + lobe(870, 290, -170)
        : lobe(330, 220, -95) + lobe(690, 190, 95) + lobe(1080, 330, -125);
      const drift = slope * direction * distance * Math.exp(-distance / 100)
        + smooth(distance / 85) * scale * (shape + 13 * Math.sin(d / 75 + direction));
      return newVertex(source.p[0] + drift, seaLevel, z, true, -1, 0);
    });
  };
  const northCoast = coastLine(-1), southCoast = coastLine(1), landBuilder = new Builder(), waterBuilder = new Builder();
  const westRows = seaRows.map(row => [row[0], { ...newVertex(farWestX, seaLevel, row[0].p[2], true), across: Math.fround(row[0].across + reach) }] as [Vertex, Vertex]);
  for (let i = 1; i < westRows.length; i++) waterBuilder.quad(westRows[i - 1][0], westRows[i - 1][1], westRows[i][0], westRows[i][1]);
  const seaCap = (coast: Vertex[], endpoint: number) => {
    let previous = [westRows[endpoint][1], seaRows[endpoint][0], seaRows[endpoint][1]];
    for (const shore of coast.slice(1)) {
      const oceanX = Math.min(westX, shore.p[0] - (seaRows[endpoint][1].p[0] - westX));
      const current = [newVertex(farWestX, seaLevel, shore.p[2], true, -1, shore.p[0] - farWestX),
        newVertex(oceanX, seaLevel, shore.p[2], true, -1, shore.p[0] - oceanX), shore];
      for (let i = 0; i < 2; i++) waterBuilder.quad(previous[i], previous[i + 1], current[i], current[i + 1]); previous = current;
    }
  };
  seaCap(northCoast, 0); seaCap(southCoast, seaRows.length - 1);
  const sourceLevel = end[0].p[1], sourceCentre = (end[0].p[2] + end[1].p[2]) / 2, halfWidth = (end[1].p[2] - end[0].p[2]) / 2;
  const riverRows: [Vertex, Vertex][] = [end], bedRows: Vertex[][] = [bedEdge];
  for (const distance of distances.slice(1)) {
    const x = end[0].p[0] + distance, drift = 18 * (1 - Math.exp(-distance / 240)) * Math.sin(distance / 420), centre = sourceCentre + drift;
    riverRows.push([newVertex(x, sourceLevel, centre - halfWidth, true, halfWidth, -halfWidth), newVertex(x, sourceLevel, centre + halfWidth, true, halfWidth, halfWidth)]);
    bedRows.push(bedEdge.map(source => { const vertex = newVertex(x, source.p[1], source.p[2] + drift, false); vertex.c = source.c; vertex.wet = source.wet; return vertex; }));
  }
  for (let i = 1; i < riverRows.length; i++) {
    waterBuilder.quad(riverRows[i - 1][0], riverRows[i - 1][1], riverRows[i][0], riverRows[i][1]);
    for (let j = 1; j < bedEdge.length; j++) landBuilder.quad(bedRows[i - 1][j - 1], bedRows[i - 1][j], bedRows[i][j - 1], bedRows[i][j]);
  }
  const coastline = [...[...northCoast].reverse(), ...seaRows.slice(1, -1).map(row => row[1]), ...southCoast];
  const extendedCoastX = (z: number) => {
    for (let i = 1; i < coastline.length; i++) if (z <= coastline[i].p[2]) { const a = coastline[i - 1].p, b = coastline[i].p; return mix(a[0], b[0], clamp((z - a[2]) / (b[2] - a[2]))); }
    return coastline[coastline.length - 1].p[0];
  };
  const minX = Math.min(...land.vertices.map(v => v.p[0])), maxX = Math.max(...land.vertices.map(v => v.p[0]));
  const minZ = Math.min(...land.vertices.map(v => v.p[2])), maxZ = Math.max(...land.vertices.map(v => v.p[2]));
  const formScale = Math.min(1.2, Math.max(.9, reach / 1200));
  const mound = (x: number, z: number, cx: number, cz: number, rx: number, rz: number, height: number) =>
    height * Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
  const northHeadlandZ = minZ - 290 * formScale, southHeadlandZ = maxZ + 310 * formScale;
  const terrain = (vertex: Vertex): Vertex => {
    const [x, y, z] = vertex.p, inset = Math.max(0, x - extendedCoastX(z));
    const distance = Math.hypot(Math.max(minX - x, x - maxX, 0), Math.max(minZ - z, z - maxZ, 0)), blend = smooth(distance / 115);
    const centre = sourceCentre + 18 * (1 - Math.exp(-Math.max(0, x - end[0].p[0]) / 240)) * Math.sin(Math.max(0, x - end[0].p[0]) / 420);
    const valley = smooth((Math.abs(z - centre) - halfWidth) / 105);
    // Separate rounded masses, with real lower saddles, rather than one long
    // mountain wall or a coloured flat apron. The sea and river remain low.
    const northMass = mound(x, z, extendedCoastX(northHeadlandZ) + 225, northHeadlandZ, 245, 235, 82)
      + mound(x, z, maxX + 305, minZ - 95, 270, 210, 48)
      + mound(x, z, maxX + 230, minZ - 730 * formScale, 340, 285, 39);
    const southMass = mound(x, z, extendedCoastX(southHeadlandZ) + 205, southHeadlandZ, 290, 205, 62)
      + mound(x, z, maxX + 535, maxZ + 405 * formScale, 285, 325, 54);
    const roll = 6 + 3.1 * Math.sin(x / 260 + z / 510) + 2.4 * Math.sin(z / 175 - x / 620);
    const height = mix(sourceLevel - .6, seaLevel + smooth(inset / 115) * (Math.max(2, roll) + northMass + southMass), valley);
    const value = newVertex(x, mix(y, height, blend), z, false);
    // Muted woodland colour follows the shoulders of the actual raised forms;
    // this is distant canopy massing, without new near-village tree instances.
    const woods = smooth(inset / 120) * (.38 + .44 * smooth((height - seaLevel - 4) / 38))
      * (.85 + .15 * Math.sin(x / 110 - z / 145));
    const shade = 1 + .08 * Math.sin(x / 125 + z / 180), ground = [.067, .078, .041], woodland = [.034, .052, .030];
    value.c = vertex.c.map((c, i) => mix(c, mix(ground[i], woodland[i], woods) * shade, blend)) as Point;
    value.wet = mix(vertex.wet, 1 - smooth((value.p[1] - seaLevel) / 1.1), blend); return value;
  };
  const coastLand = (vertex: Vertex): Vertex => {
    const seam = [land.vertices[north], land.vertices[south]].find(v => pointKey(v.p) === pointKey(vertex.p)); if (seam) return seam;
    const value = newVertex(vertex.p[0], seaLevel, vertex.p[2], false); value.c = [.061, .054, .039]; value.wet = 1; return value;
  };
  const farX = end[0].p[0] + reach, northZ = northCoast[northCoast.length - 1].p[2], southZ = southCoast[southCoast.length - 1].p[2];
  const spacing = Math.min(85, reach / 14), corner = (z: number) => terrain(newVertex(farX, 4.4, z, false));
  const outerRun = (a: Vertex, b: Vertex): Vertex[] => {
    const steps = Math.ceil(Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / spacing);
    return Array.from({ length: steps + 1 }, (_, i) => i === 0 ? a : i === steps ? b : terrain(newVertex(mix(a.p[0], b.p[0], i / steps), mix(a.p[1], b.p[1], i / steps), mix(a.p[2], b.p[2], i / steps), false)));
  };
  const northShore = [...northCoast].reverse().map(coastLand), southShore = southCoast.map(coastLand), northCorner = corner(northZ), southCorner = corner(southZ);
  const lastBed = bedRows[bedRows.length - 1], lastSouthBed = lastBed[lastBed.length - 1];
  landBuilder.polygon([...northLand, ...bedRows.slice(1).map(row => row[0]), ...outerRun(lastBed[0], northCorner).slice(1), ...outerRun(northCorner, northShore[0]).slice(1, -1), ...northShore], terrain, spacing);
  const southTail = seaRows.filter(row => row[1].p[2] > land.vertices[south].p[2] + .0001).map(row => coastLand(row[1]));
  landBuilder.polygon([...southLand, ...southTail, ...southShore.slice(1), ...outerRun(southShore[southShore.length - 1], southCorner).slice(1), ...outerRun(southCorner, lastSouthBed).slice(1, -1), ...[...bedRows].reverse().map(row => row[row.length - 1])], terrain, spacing);
  const geometries: BufferGeometry[] = [];
  try {
    const landGeometry = landBuilder.finish(false); geometries.push(landGeometry);
    const waterGeometry = waterBuilder.finish(true); geometries.push(waterGeometry);
    const foregroundGeometry = foregroundLand(land, outer, [channel, sea]); geometries.push(foregroundGeometry);
    const extensionTriangles = (landBuilder.indices.length + waterBuilder.indices.length) / 3;
    const foregroundTriangles = foregroundGeometry.index!.count / 3 - baseGeometry.index!.count / 3;
    const triangles = extensionTriangles + foregroundTriangles;
    const bytes = (geometry: BufferGeometry) => { const arrays = new Set<ArrayBufferView>(); for (const attribute of Object.values(geometry.attributes)) if ('array' in attribute) arrays.add(attribute.array); if (geometry.index) arrays.add(geometry.index.array); return [...arrays].reduce((n, value) => n + value.byteLength, 0); };
    const extensionBytes = bytes(landGeometry) + bytes(waterGeometry), foregroundBytes = bytes(foregroundGeometry);
    const foregroundBytesAdded = foregroundBytes - bytes(baseGeometry), bufferBytes = extensionBytes + foregroundBytes;
    if (extensionTriangles > 4000 || foregroundTriangles < 0 || foregroundTriangles > 1800 || extensionBytes >= 256 * 1024
      || foregroundBytesAdded < 0 || foregroundBytesAdded > 54000 || bufferBytes > 512 * 1024) throw Error('Distant coast exceeds its diagnostic geometry budget.');
    const landMesh = new Mesh(landGeometry, land.mesh.material), waterMesh = new Mesh(waterGeometry, sea.mesh.material);
    landMesh.name = 'Ealdholt distant mainland diagnostic'; waterMesh.name = 'Ealdholt distant sea and continuing river diagnostic';
    landMesh.userData.crownfallElderbloom = { kind: 'terrain' }; waterMesh.userData.crownfallElderbloom = { kind: 'water' };
    landMesh.castShadow = waterMesh.castShadow = false; landMesh.receiveShadow = land.mesh.receiveShadow; waterMesh.receiveShadow = false;
    const object = new Group(); object.name = 'Ealdholt Desktop Distant Coast Preview'; object.add(landMesh, waterMesh);
    object.userData.crownfallDistantCoastPreview = { schema: 4, desktopOnly: true, georeferenced: false, sourceGeometryUntouched: true, borrowedMaterials: true, optInLandformStudy: true,
      foregroundClone: { trianglesAdded: foregroundTriangles, drawCallsAdded: 0, bufferBytes: foregroundBytes, bufferBytesAdded: foregroundBytesAdded, extensionBytes, extensionTriangles,
        bounds: { min: foregroundGeometry.boundingBox!.min.toArray(), max: foregroundGeometry.boundingBox!.max.toArray() } } };
    const bounds = new Box3().union(landGeometry.boundingBox!).union(waterGeometry.boundingBox!); let disposed = false;
    foregroundBases.set(foregroundGeometry, baseGeometry); landSource.geometry = foregroundGeometry;
    return { object, drawCalls: 2, triangles, bufferBytes, reachMetres: reach,
      joins: { landSegments: northLand.length + southLand.length + bedEdge.length - 3, seaSegments: seaRows.length + 1, riverSegments: 1 },
      bounds: { min: bounds.min.toArray() as Point, max: bounds.max.toArray() as Point },
      dispose() { if (disposed) return; disposed = true; object.removeFromParent(); object.clear();
        if (landSource.geometry === foregroundGeometry) landSource.geometry = baseGeometry;
        foregroundBases.delete(foregroundGeometry); for (const geometry of geometries) geometry.dispose(); } };
  } catch (error) { for (const geometry of geometries) geometry.dispose(); throw error; }
}
