import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { addLightToVertexColours } from "./arena-surface-bake";
import { airTexels, ambientCubeFromPanorama, arenaLightAt, arenaTier, detailTexels, emittersFromInspect, emittersReaching, evenedCube, surfaceKind, tintedCube, arenaOpenness, type ArenaLightModel, type Rgb } from "./arena-surface-data";

const luma = (color: Rgb) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];

/** A panorama as the look stores it: rows upward, u = 0.5 looking along -z. `paint` gets the direction of a texel. */
function panorama(width: number, height: number, paint: (x: number, y: number, z: number) => Rgb) {
  const data = new Float32Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const theta = ((row + 0.5) / height - 0.5) * Math.PI, phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
      const [r, g, b] = paint(Math.sin(phi) * Math.cos(theta), Math.sin(theta), -Math.cos(phi) * Math.cos(theta));
      data.set([r, g, b, 1], (row * width + column) * 4);
    }
  }
  return (index: number) => data[index];
}

test("an even sky lights every face of the ambient cube alike", () => {
  const cube = ambientCubeFromPanorama(128, 64, panorama(128, 64, () => [0.2, 0.3, 0.4]), { ceiling: 10, step: 1 });
  for (const face of cube.faces) {
    assert.ok(Math.abs(face[0] - 0.2) < 1e-3 && Math.abs(face[1] - 0.3) < 1e-3 && Math.abs(face[2] - 0.4) < 1e-3, String(face));
  }
  assert.ok(Math.abs(cube.horizon[1] - 0.3) < 1e-3);
});

test("a sky bright toward -z lights the -z face most, the +z face least, and the sides and the top alike", () => {
  const decode = panorama(256, 128, (_x, _y, z) => (z < 0 ? [1, 1, 1] : [0, 0, 0]));
  const [px, nx, py, ny, pz, nz] = ambientCubeFromPanorama(256, 128, decode, { ceiling: 10, step: 1 }).faces.map(luma);
  assert.ok(nz > 0.99 && pz < 0.01, `${nz} ${pz}`);
  for (const side of [px, nx, py, ny]) assert.ok(Math.abs(side - 0.5) < 0.02, String(side));
});

test("the eclipse's limb is clipped before it is averaged in", () => {
  // a small, very bright patch straight along -z
  const decode = panorama(256, 128, (x, y, z) => (z < -0.995 ? [500, 500, 500] : [0.1, 0.1, 0.1]));
  const clipped = ambientCubeFromPanorama(256, 128, decode, { ceiling: 2, step: 1 }).faces[5];
  const raw = ambientCubeFromPanorama(256, 128, decode, { ceiling: 1000, step: 1 }).faces[5];
  assert.ok(luma(raw) > 1 && luma(clipped) < 0.12, `${luma(raw)} ${luma(clipped)}`);
});

test("evening the cube draws the faces' brightnesses together and keeps their colours", () => {
  const cube = { faces: [[0.2, 0.1, 0.05], [0.2, 0.1, 0.05], [0.1, 0.1, 0.1], [0, 0, 0], [0.05, 0.05, 0.1], [0.8, 0.4, 0.2]] as [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb], horizon: [0.3, 0.2, 0.1] as Rgb };
  assert.deepEqual(evenedCube(cube, 0, 2).faces.map((face) => +luma(face).toFixed(6)), cube.faces.map((face) => +luma(face).toFixed(6)));
  const half = evenedCube(cube, 0.5, 2).faces, full = evenedCube(cube, 1, 2).faces;
  // the anchor face stays; brighter faces come down toward it, dimmer ones up
  assert.ok(Math.abs(luma(half[2]) - luma(cube.faces[2])) < 1e-9);
  assert.ok(luma(half[5]) < luma(cube.faces[5]) && luma(half[5]) > luma(cube.faces[2]));
  assert.ok(luma(half[4]) > luma(cube.faces[4]) && luma(half[4]) < luma(cube.faces[2]));
  assert.ok(Math.abs(luma(full[5]) - luma(cube.faces[2])) < 1e-9);
  // hue: the ratio of channels is the face's own
  assert.ok(Math.abs(half[5][0] / half[5][2] - 4) < 1e-9);
  assert.equal(luma(half[3]), 0);
});

test("tinting the cube turns a face's colour toward the fog's by its share and keeps its brightness", () => {
  const cube = { faces: [[0.2, 0.1, 0.05], [0.2, 0.1, 0.05], [0.1, 0.1, 0.1], [0.3, 0, 0], [0.05, 0.05, 0.1], [0.8, 0.4, 0.2]] as [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb], horizon: [0.3, 0.2, 0.1] as Rgb };
  const tinted = tintedCube(cube, [0.5, 0.5, 1], [0, 0.5, 1, 0, 0.25, 0.25]).faces;
  for (let face = 0; face < 6; face++) assert.ok(Math.abs(luma(tinted[face]) - luma(cube.faces[face])) < 1e-9, `face ${face}`);
  assert.deepEqual(tinted[0], cube.faces[0]);
  // a full share takes the fog's hue outright: blue twice red
  assert.ok(Math.abs(tinted[2][2] / tinted[2][0] - 2) < 1e-9);
  // a half share lies between: the warm face has cooled
  assert.ok(tinted[1][2] / tinted[1][0] > cube.faces[1][2] / cube.faces[1][0]);
});

test("the look's pools and rivers stand in as lava; the abyss terrain does not", () => {
  const inspect = { objects: { lava: {
    CFCL_Terrain_AbyssLava: { center_gl: [1, -11, 7], size: [300, 308, 11] },
    CFCL_LavaPool_00: { center_gl: [-23, 2.3, -46], size: [9.2, 6.9, 0] },
    CFCL_LavaRiver_01: { center_gl: [46, -1.15, -34.5], size: [23, 11.5, 6.9] },
    CFCL_LavaPool_broken: { size: [1, 1, 1] },
  } } };
  const lava = emittersFromInspect(inspect, 1 / 2.3);
  assert.equal(lava.length, 2);
  assert.deepEqual(lava[0].at.map((v) => +v.toFixed(3)), [-10, 1, -20]);
  assert.ok(Math.abs(lava[0].radius - 0.25 * (9.2 + 6.9) / 2.3) < 1e-9);
  assert.ok(Math.abs(lava[1].radius - 0.25 * (23 + 11.5) / 2.3) < 1e-9);
  assert.deepEqual(emittersFromInspect({}, 1), []);
});

test("a mesh is lit by the lava whose reach touches its bounds, nearest first", () => {
  const emitters = [
    { position: { x: 0, y: 0, z: 0 }, radius: 1 },
    { position: { x: 10, y: 0, z: 0 }, radius: 1 },
    { position: { x: 30, y: 0, z: 0 }, radius: 2 },
    { position: { x: 100, y: 0, z: 0 }, radius: 1 },
  ];
  // a mesh of radius 2 at x = 12: 10 away from the first (beyond 5 radii), touching the second, 16 from the third
  assert.deepEqual(emittersReaching(emitters, { x: 12, y: 0, z: 0 }, 2, 5, 12), [1]);
  // a wide mesh takes in the first three, in order of the gap in radii, and the limit cuts the list
  assert.deepEqual(emittersReaching(emitters, { x: 12, y: 0, z: 0 }, 9, 5, 12), [1, 0, 2]);
  assert.deepEqual(emittersReaching(emitters, { x: 12, y: 0, z: 0 }, 9, 5, 2), [1, 0]);
  assert.deepEqual(emittersReaching(emitters, { x: 0, y: 50, z: 0 }, 1, 5, 12), []);
});

test("a baked material's name says what it is made of", () => {
  assert.equal(surfaceKind("CFCL_RitualFloor_Obsidian.002 slab").name, "obsidian");
  assert.equal(surfaceKind("CFCL_Arch_BronzeAged.001").name, "metal");
  assert.equal(surfaceKind("CFCL_Bronze_ScanManacle.001").metal, 1);
  assert.equal(surfaceKind("CFCL_Moss.003 CFCL_Veg_MossCushion_B").name, "plant");
  // the moss shells over the dais's floor take a small share of the fill
  assert.equal(surfaceKind("CFCL_Moss.002 CFCL_Veg_CFCL_Arch_DaisFloor_MossShell").name, "moss");
  assert.ok(surfaceKind("CFCL_Moss.002 CFCL_Veg_CFCL_Arch_DaisFloor_MossShell").fill < 0.5 && surfaceKind("CFCL_Moss.003").fill === 1);
  assert.equal(surfaceKind("CFCL_Meshy_coral_tree.001").name, "leaf");
  assert.equal(surfaceKind("CFCL_Root.002").name, "wood");
  assert.equal(surfaceKind("CFCL_BoneStone_Scan_2.001").name, "bone");
  assert.equal(surfaceKind("CFCL_Basalt__columns0.003").name, "basalt");
  assert.equal(surfaceKind("CFCL_PBR_Ashlar.001").name, "stone");
  assert.equal(surfaceKind("").name, "stone");
  // plants are their own detail; stone takes all of it
  assert.ok(surfaceKind("CFCL_Sedge.002").detail < 0.5 && surfaceKind("CFCL_PBR_MasonryBlocks.001").detail === 1);
});

test("the quality tiers map to the three feature sets", () => {
  const quality = { scale: 1, msaa: 0, bloom: false, shadow: 0, embers: 0, dpr: 1 };
  assert.equal(arenaTier({ ...quality, name: "low", area: false }), 0);
  assert.equal(arenaTier({ ...quality, name: "medium", area: true }), 1);
  assert.equal(arenaTier({ ...quality, name: "high", area: true }), 2);
  // auto runs the low set on integrated graphics (no area lamps) and the medium set otherwise
  assert.equal(arenaTier({ ...quality, name: "auto", area: false }), 0);
  assert.equal(arenaTier({ ...quality, name: "auto", area: true }), 1);
});

test("the detail texels repeat without a seam, are the same every time, and sit in range", () => {
  const size = 64, texels = detailTexels(size);
  assert.equal(texels.length, size * size * 4);
  assert.deepEqual(detailTexels(size), texels);
  const mean = [0, 0, 0, 0];
  for (let i = 0; i < texels.length; i++) mean[i & 3] += texels[i] / (size * size * 255);
  // grain and slopes about the middle, the surface mostly flat (cracks and pits are few)
  assert.ok(Math.abs(mean[0] - 0.5) < 0.08, `grain ${mean[0]}`);
  assert.ok(Math.abs(mean[1] - 0.5) < 0.03 && Math.abs(mean[2] - 0.5) < 0.03, `slope ${mean[1]} ${mean[2]}`);
  assert.ok(mean[3] > 0.8, `flat ${mean[3]}`);
  // the step across the tile's edge is no rougher than the steps inside it (grain channel)
  const step = (a: number, b: number) => { let sum = 0; for (let row = 0; row < size; row++) sum += Math.abs(texels[(row * size + a) * 4] - texels[(row * size + b) * 4]); return sum / size; };
  let inside = 0;
  for (let column = 1; column < size; column++) inside = Math.max(inside, step(column - 1, column));
  assert.ok(step(size - 1, 0) <= inside, `${step(size - 1, 0)} > ${inside}`);
});

test("the air's noise fills its range and repeats without a seam", () => {
  const size = 32, texels = airTexels(size);
  assert.equal(texels.length, size * size * 4);
  for (const channel of [0, 1, 2]) {
    let low = 255, high = 0;
    for (let i = channel; i < texels.length; i += 4) { low = Math.min(low, texels[i]); high = Math.max(high, texels[i]); }
    assert.ok(low === 0 && high === 255, `channel ${channel}: ${low}-${high}`);
  }
  const step = (a: number, b: number) => { let sum = 0; for (let row = 0; row < size; row++) sum += Math.abs(texels[(row * size + a) * 4] - texels[(row * size + b) * 4]); return sum / size; };
  let inside = 0;
  for (let column = 1; column < size; column++) inside = Math.max(inside, step(column - 1, column));
  assert.ok(step(size - 1, 0) <= inside);
});

const model: ArenaLightModel = {
  faces: [[1, 0, 0], [0.5, 0, 0], [0, 1, 0], [0, 0.25, 0], [0, 0, 1], [0, 0, 0.5]],
  fill: 2, farShare: 0.5, near: [0, 0, 10, 20], board: [1, 0, 2, 0.25], lava: 1, reach: 3,
  emitters: [{ x: 0, y: -1, z: 0, radius: 2, color: [1, 0.5, 0] }, { x: 100, y: 0, z: 0, radius: 1, color: [9, 9, 9] }],
};

test("the fill follows the normal, and falls to the far ruins' share away from the arena", () => {
  const out = [0, 0, 0];
  arenaLightAt(model, 0, { x: 5, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, out);
  assert.deepEqual(out, [0, 2, 0]);
  arenaLightAt(model, 0, { x: 5, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, out);
  assert.deepEqual(out, [0, 0.5, 0]);
  // a normal between two axes takes the square of each component of each face
  arenaLightAt(model, 0, { x: 5, y: 0, z: 0 }, { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }, out);
  assert.ok(Math.abs(out[0] - 1) < 1e-9 && out[1] === 0 && Math.abs(out[2] - 0.5) < 1e-9, String(out));
  // beyond the outer distance: the far share; half way: between the two
  arenaLightAt(model, 0, { x: 30, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, out);
  assert.deepEqual(out, [0, 1, 0]);
  arenaLightAt(model, 0, { x: 0, y: 5, z: 15 }, { x: 0, y: 1, z: 0 }, out);
  assert.ok(Math.abs(out[1] - 1.5) < 1e-9, String(out));
});

test("the floor at the board's foot gets less of the fill; the board's top and the floor further out get all of it", () => {
  const up = { x: 0, y: 1, z: 0 }, out = [0, 0, 0];
  // the test board is 1 wide each way, its top at 0, shading 2 out from its foot down to a quarter
  arenaLightAt(model, 0, { x: 1, y: -1, z: 0 }, up, out);
  assert.ok(Math.abs(out[1] - 0.5) < 1e-9, String(out));
  arenaLightAt(model, 0, { x: 2, y: -1, z: 0 }, up, out);
  assert.ok(Math.abs(out[1] - 2 * (0.25 + 0.75 * 0.5)) < 1e-9, String(out));
  arenaLightAt(model, 0, { x: 3.5, y: -1, z: 0 }, up, out);
  assert.ok(Math.abs(out[1] - 2) < 1e-9, String(out));
  arenaLightAt(model, 0, { x: 1, y: 0.2, z: 0 }, up, out);
  assert.ok(Math.abs(out[1] - 2) < 1e-9, String(out));
});

test("lava lights what stands above it and faces it, only within its reach, and only when it is named", () => {
  const up = { x: 0, y: 1, z: 0 }, down = { x: 0, y: -1, z: 0 }, none = [0, 0, 0], lit = [0, 0, 0];
  const above = { x: 0, y: 1, z: 0 };
  arenaLightAt(model, 0, above, down, none);
  arenaLightAt(model, 1, above, down, lit);
  // 2 above a lava of radius 2: strength r2 / (d2 + r2) = 0.5, faded by (1 - 4/36)^2, fully facing
  const expected = 0.5 * (1 - 4 / 36) ** 2;
  assert.ok(Math.abs(lit[0] - none[0] - expected) < 1e-3 && Math.abs(lit[1] - none[1] - 0.5 * expected) < 1e-3, `${lit} ${none}`);
  // a face turned away gets none, a place below the lava gets none, a place past the reach gets none
  arenaLightAt(model, 1, above, up, lit);
  arenaLightAt(model, 0, above, up, none);
  assert.deepEqual(lit, none);
  arenaLightAt(model, 1, { x: 0, y: -3, z: 0 }, up, lit);
  arenaLightAt(model, 0, { x: 0, y: -3, z: 0 }, up, none);
  assert.deepEqual(lit, none);
  arenaLightAt(model, 1, { x: 0, y: 6, z: 0 }, down, lit);
  arenaLightAt(model, 0, { x: 0, y: 6, z: 0 }, down, none);
  assert.deepEqual(lit, none);
  // the second emitter is far away: naming it changes nothing here
  arenaLightAt(model, 3, above, down, none);
  arenaLightAt(model, 1, above, down, lit);
  assert.deepEqual(none, lit);
});

test("light added to vertex colours keeps what was baked, lands by the bake's openness, and keeps the colour's hue", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // as the files have them: 16-bit RGBA, the first vertex unlit, the second lit
  geometry.setAttribute("color", new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 65535, 13107, 13107, 13107, 65535, 0, 0, 0, 65535]), 4, true));
  const seen: number[][] = [], asked: number[] = [];
  const done = addLightToVertexColours(geometry, new THREE.Matrix4().makeScale(2, 2, 2), {
    scale: 8, albedo: null, open: (luma) => { asked.push(luma); return luma > 0 ? 1 : 0.5; },
    light: (position, normal, out) => { seen.push([position.x, position.y, position.z, normal.x, normal.y, normal.z]); out[0] = 0.8; out[1] = 0.4; out[2] = 0; },
  });
  assert.equal(done, true);
  // places and normals arrive in world space, the normal still of unit length; openness is asked of the baked light
  assert.deepEqual(seen[1], [2, 0, 0, 0, 1, 0]);
  assert.ok(asked[0] === 0 && Math.abs(asked[1] - 0.2 * 8) < 1e-3, String(asked));
  const color = geometry.attributes.color;
  assert.equal(color.itemSize, 4);
  assert.equal(color.getW(1), 1);
  // unlit vertex: half the light (its openness), over the scale
  assert.ok(Math.abs(color.getX(0) - 0.8 * 0.5 / 8) < 1e-3 && Math.abs(color.getY(0) - 0.4 * 0.5 / 8) < 1e-3 && color.getZ(0) === 0);
  // lit vertex: what was there plus all of the light, over the scale
  assert.ok(Math.abs(color.getX(1) - (0.2 + 0.8 / 8)) < 2e-3, String(color.getX(1)));
  // colour-times-light meshes: an unlit vertex takes the given albedo; a lit one takes half its own hue, at that
  // brightness
  geometry.setAttribute("color", new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 65535, 6553, 13107, 0, 65535, 0, 0, 0, 65535]), 4, true));
  addLightToVertexColours(geometry, new THREE.Matrix4(), { scale: 8, albedo: [0.1, 0.2, 0.3], open: () => 1, light: (_p, _n, out) => { out[0] = out[1] = out[2] = 1; } });
  const tinted = geometry.attributes.color;
  assert.ok(Math.abs(tinted.getY(0) - 0.2 / 8) < 1e-4);
  const albedoLuma = 0.2126 * 0.1 + 0.7152 * 0.2 + 0.0722 * 0.3, own = 0.2126 * 0.1 + 0.7152 * 0.2;
  const half = (channel: number) => albedoLuma * (0.5 + 0.5 * channel / own) / 8;
  const addedR = tinted.getX(1) - 0.1, addedG = tinted.getY(1) - 0.2, addedB = tinted.getZ(1);
  assert.ok(Math.abs(addedR - half(0.1)) < 1e-3 && Math.abs(addedG - half(0.2)) < 1e-3 && Math.abs(addedB - half(0)) < 1e-3, `${addedR} ${addedG} ${addedB}`);
  // greener than grey, less green than the vertex colour itself
  assert.ok(addedG / addedR > 1 && addedG / addedR < 2);
  // where the bake is bright, easing gives less of the light, turned toward the colour's own hue
  const warm = new THREE.BufferGeometry();
  warm.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  warm.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0], 3));
  const bright = () => new THREE.BufferAttribute(new Uint16Array([39321, 19660, 6553, 65535]), 4, true);
  const added = (ease: number) => {
    warm.setAttribute("color", bright());
    addLightToVertexColours(warm, new THREE.Matrix4(), { scale: 8, albedo: null, open: () => 1, ease, light: (_p, _n, out) => { out[0] = 0.5; out[1] = 0.5; out[2] = 0.5; } });
    const c = warm.attributes.color;
    return [c.getX(0) - 0.6, c.getY(0) - 0.3, c.getZ(0) - 0.1];
  };
  const plain = added(0), eased = added(3);
  assert.ok(Math.abs(plain[0] - plain[2]) < 1e-3, String(plain));
  assert.ok(eased[0] + eased[1] + eased[2] < (plain[0] + plain[1] + plain[2]) / 4, String(eased));
  assert.ok(eased[0] > eased[1] && eased[1] > eased[2], String(eased));
  // a pale albedo (where the colour holds colour times light) eases the light off too; with no albedo given, nothing
  const unlit = () => new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 65535]), 4, true);
  const withAlbedo = (paleEase: number, albedo: number[] | null) => {
    warm.setAttribute("color", unlit());
    addLightToVertexColours(warm, new THREE.Matrix4(), { scale: 8, albedo, open: () => 1, paleEase, light: (_p, _n, out) => { out[0] = out[1] = out[2] = 1; } });
    return warm.attributes.color.getY(0);
  };
  assert.ok(Math.abs(withAlbedo(3, [0.3, 0.3, 0.3]) - withAlbedo(0, [0.3, 0.3, 0.3]) / (1 + 0.18 * 3)) < 1e-3);
  assert.ok(Math.abs(withAlbedo(3, [0.1, 0.1, 0.1]) - withAlbedo(0, [0.1, 0.1, 0.1])) < 1e-4);
  assert.equal(withAlbedo(3, null), withAlbedo(0, null));
  // a mesh without colours is left alone
  assert.equal(addLightToVertexColours(new THREE.BufferGeometry(), new THREE.Matrix4(), { scale: 8, albedo: null, open: () => 1, light: () => {} }), false);
});

test("openness rises with the logarithm of the baked light, from the floor to all", () => {
  const lo = Math.log2(0.0004), hi = Math.log2(0.05);
  assert.equal(arenaOpenness(0, 0.25, lo, hi), 0.25);
  assert.equal(arenaOpenness(0.0004, 0.25, lo, hi), 0.25);
  assert.equal(arenaOpenness(0.05, 0.25, lo, hi), 1);
  assert.equal(arenaOpenness(3, 0.25, lo, hi), 1);
  // half way in log terms
  assert.ok(Math.abs(arenaOpenness(Math.sqrt(0.0004 * 0.05), 0.25, lo, hi) - 0.625) < 1e-9);
  // a tenth of the light reads clearly darker, not almost the same
  assert.ok(arenaOpenness(0.012, 0.25, lo, hi) - arenaOpenness(0.0012, 0.25, lo, hi) > 0.3);
  assert.equal(arenaOpenness(-0.01, 0, lo, hi), 0);
});
