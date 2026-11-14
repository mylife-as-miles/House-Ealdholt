// dressWorld against both platforms' real Three runtimes. Only this test imports them directly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as DESKTOP from '../../../main game/node_modules/three/build/three.module.js';
import * as QUEST from '../../../main-game-vr/node_modules/three/build/three.module.js';
import { getBannerholdBlueprint } from '../environment/blueprint';
import { environmentFixture } from '../environment/fixtures';
import { atlasTile, HERALDRY_ATLAS_SIZE } from '../environment/heraldry/atlas';
import type { HeraldrySlot } from '../environment/heraldry/atlas';
import { EXTERNAL_HOUSES } from '../content/houses';
import { NATION_ORDER } from '../content/nations';
import { rasterizeHeraldry } from '../heraldry/raster';
import type { LegacySceneState } from '../environment-contract';
import type { NationId } from '../types';
import { HERALDRY as ALPINE } from './alpine-lake/banners';
import { HERALDRY as ATHENAION } from './athenaion/banners';
import { WORLD_KINGDOM_STYLE, worldAtlasHeraldry } from './crownfall';
import { disposeSourceTree, dressWorld } from './dressing.js';
import type { WorldHeraldry } from './dressing.js';
import { HERALDRY as TEMPLE } from './golden-temple/banners';
import { HERALDRY as MONOLITH } from './monolithwilds/banners';

type Three = typeof DESKTOP;
const RUNTIMES: [string, Three][] = [['desktop', DESKTOP], ['quest', QUEST as unknown as Three]];

// Establishing views and Quest staging scales, from each build.js, index.ts and source-environment.ts.
const WORLDS: { id: string; heraldry: WorldHeraldry; view: { position: number[]; target: number[]; fov: number }; extent: { width: number; depth: number; height: number } }[] = [
  { id: 'golden-temple', heraldry: TEMPLE, view: { position: [44.45, 2.8, 21], target: [-30, 9.8, -9], fov: 46 }, extent: { width: 160, depth: 150, height: 58 } },
  { id: 'monolith-wilds', heraldry: MONOLITH, view: { position: [-1000, 330, 1250], target: [414, 140, -627], fov: 55 }, extent: { width: 5200, depth: 5200, height: 1800 } },
  { id: 'athenaion', heraldry: ATHENAION, view: { position: [210, 125, 320], target: [12, 43, -24], fov: 44 }, extent: { width: 580, depth: 620, height: 155 } },
  { id: 'alpine-lake', heraldry: ALPINE, view: { position: [24, 18, 365], target: [0, 105, -620], fov: 48 }, extent: { width: 1800, depth: 2150, height: 720 } },
];

function house(id: string): LegacySceneState {
  const definition = EXTERNAL_HOUSES.find(h => h.id === id)!;
  return { ...environmentFixture('founded', definition.nationId), bannerName: definition.name, heraldry: definition.heraldry };
}
function asset(T: Three, heraldry?: WorldHeraldry) {
  const root = new T.Group();
  return { root, view: { position: [0, 2, 50] as const, target: [0, 2, 0] as const, fov: 45 }, landmarks: [{ id: 'banner-hall', position: [0, 0, 0] }, { id: 'muster-grounds', position: [5, 0, 0] }, { id: 'war-record', position: [-5, 0, 0] }, { id: 'heralds-station', position: [0, 0, 5] }], extent: { center: [0, 0, 0] as const, width: 160, depth: 150, height: 58 }, heraldry } as never as Parameters<typeof dressWorld>[1] & { root: InstanceType<Three['Group']> };
}
function tile(data: Uint8ClampedArray, slot: HeraldrySlot) {
  const t = atlasTile(slot, 'banner'), out = new Uint8ClampedArray(t.w * t.h * 4), W = HERALDRY_ATLAS_SIZE.width;
  for (let y = 0; y < t.h; y++) out.set(data.subarray(((t.y + y) * W + t.x) * 4, ((t.y + y) * W + t.x + t.w) * 4), y * t.w * 4);
  return out;
}
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  return n;
}
const pixels = (dressing: ReturnType<typeof dressWorld>) => (dressing.texture as { image: { data: Uint8ClampedArray } }).image.data;

for (const [name, T] of RUNTIMES) {
  test(`${name}: the player's banner is the house's exact raster, and changes with the house`, () => {
    const a = house('house-ombreval'), b = house('house-qarathun'), world = asset(T);
    const dressing = dressWorld(T, world, a), texture = dressing.texture as InstanceType<Three['DataTexture']>;
    const { w, h } = atlasTile('player', 'banner');
    assert.deepEqual(tile(pixels(dressing), 'player'), rasterizeHeraldry(a.heraldry!, { width: w, height: h, aspect: 'banner' }).data);
    const before = tile(pixels(dressing), 'player'), version = texture.version;
    dressing.setState(b);
    const after = tile(pixels(dressing), 'player');
    assert.deepEqual(after, rasterizeHeraldry(b.heraldry!, { width: w, height: h, aspect: 'banner' }).data);
    assert.ok(differing(before, after) > w * h / 4, 'two houses produce visibly different cloth');
    assert.ok(texture.version > version, 'a new house uploads the atlas');
    dressing.dispose();
  });

  test(`${name}: status changes do not re-upload heraldry`, () => {
    const a = house('house-ombreval'), dressing = dressWorld(T, asset(T), a), texture = dressing.texture as InstanceType<Three['DataTexture']>, version = texture.version;
    dressing.setState({ ...a, unreadNotices: 9, chronicleCount: 4, heraldry: { ...a.heraldry! } });
    assert.equal(texture.version, version);
    dressing.dispose();
  });

  test(`${name}: texture is filtered, mipmapped and sRGB`, () => {
    const dressing = dressWorld(T, asset(T), house('house-ombreval')), texture = dressing.texture as InstanceType<Three['DataTexture']>;
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.minFilter, T.LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, T.LinearFilter);
    assert.equal(texture.colorSpace, T.SRGBColorSpace);
    assert.equal(texture.flipY, true);
    assert.ok(atlasTile('player', 'banner').w >= 256, 'each banner keeps at least 256 texels across');
    dressing.dispose();
  });

  test(`${name}: dispose releases everything and restores the source's meshes and colours`, () => {
    const source = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ name: 'source stone', color: '#ffffff' }));
    const cloth = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ name: 'sourceCloth' }));
    const world = asset(T, { hideMaterials: ['sourceCloth'], tint: { amount: .5 }, sites: [
      { id: 'a', kind: 'wall', heraldry: 'player', position: [0, 5, 0], facing: 180, width: 2, lamp: true },
      { id: 'b', kind: 'standard', heraldry: 'crown', position: [4, 0, 0], width: 2, pole: 6 },
    ] });
    world.root.add(source, cloth);
    const dressing = dressWorld(T, world, house('house-ombreval'));
    assert.equal(cloth.visible, false, 'source cloth comes down');
    assert.notEqual(source.material.color.getHexString(), 'ffffff', 'kingdom finish applied');
    const group = dressing.group as InstanceType<Three['Group']>, released = new Map<object, number>(), track = (x: { addEventListener(t: 'dispose', f: () => void): void }) => { released.set(x, 0); x.addEventListener('dispose', () => released.set(x, released.get(x)! + 1)); };
    track(dressing.texture as never);
    const meshes: InstanceType<Three['Mesh']>[] = [];
    group.traverse(o => { const m = o as InstanceType<Three['Mesh']>; if (m.isMesh) { meshes.push(m); track(m.geometry as never); track(m.material as never); } });
    assert.ok(meshes.length >= 3);
    dressing.dispose();
    for (const [resource, count] of released) assert.equal(count, 1, `${(resource as { name?: string }).name ?? resource.constructor.name} disposed once`);
    assert.equal(group.parent, null);
    assert.equal(group.children.length, 0);
    assert.equal(world.root.children.includes(group), false);
    assert.equal(cloth.visible, true);
    assert.equal(source.material.color.getHexString(), 'ffffff');
    const version = (dressing.texture as InstanceType<Three['DataTexture']>).version;
    dressing.setState(house('house-qarathun'));
    assert.equal((dressing.texture as InstanceType<Three['DataTexture']>).version, version, 'late state is ignored');
    dressing.dispose();
    for (const [, count] of released) assert.equal(count, 1, 'second dispose is harmless');
  });

  test(`${name}: animating costs one uniform, with no geometry upload`, () => {
    const dressing = dressWorld(T, asset(T), house('house-ombreval')), group = dressing.group as InstanceType<Three['Group']>;
    const cloth = group.children.find(o => o.name === 'Crownfall / cloth') as InstanceType<Three['Mesh']>, position = cloth.geometry.attributes.position as InstanceType<Three['BufferAttribute']>, version = position.version, normals = cloth.geometry.attributes.normal as InstanceType<Three['BufferAttribute']>, normalVersion = normals.version;
    const shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: '' };
    (cloth.material as { onBeforeCompile(s: unknown): void }).onBeforeCompile(shader);
    assert.match(shader.vertexShader, /aCloth/); assert.match(shader.vertexShader, /objectNormal = normalize/); assert.match(shader.vertexShader, /transformed \+= normal/);
    for (let i = 0; i < 50; i++) dressing.update(i / 60, true);
    assert.equal(position.version, version);
    assert.equal(normals.version, normalVersion);
    assert.ok(shader.uniforms.uClothTime.value > 0);
    assert.equal(shader.uniforms.uClothAmount.value, 1);
    dressing.update(1, false);
    assert.equal(shader.uniforms.uClothAmount.value, 0, 'reduced motion stills the cloth');
    dressing.dispose();
  });

  test(`${name}: without per-world data each landmark still gets a standard`, () => {
    const dressing = dressWorld(T, asset(T), house('house-ombreval'));
    assert.equal(dressing.stats().sites, 4);
    dressing.dispose();
  });
}

test('every nation has its own trim, lamp and national cloth, matching the original Bannerhold', () => {
  const T = DESKTOP, seen = new Set<string>();
  for (const nation of NATION_ORDER) {
    const palette = getBannerholdBlueprint(nation).atmosphere.palette, style = WORLD_KINGDOM_STYLE[nation];
    assert.equal(style.crownField, palette.crownField);
    assert.equal(style.crownBorder, palette.crownBorder);
    seen.add(style.crownField);
  }
  assert.equal(seen.size, 4, 'the four national cloths differ');
  const dressing = dressWorld(T, asset(T), environmentFixture('founded', 'korvenia'));
  const group = dressing.group as InstanceType<Three['Group']>;
  const color = (name: string) => ((group.children.find(o => o.name === name) as InstanceType<Three['Mesh']>).material as { color: InstanceType<Three['Color']> }).color.getHexString();
  const trim: Record<string, string> = {}, lamp: Record<string, string> = {}, crown: Record<string, Uint8ClampedArray> = {};
  for (const nation of NATION_ORDER) {
    dressing.setState(environmentFixture('founded', nation));
    trim[nation] = color('Crownfall / trim'); lamp[nation] = color('Crownfall / lamps'); crown[nation] = tile(pixels(dressing), 'crown');
  }
  assert.equal(new Set(Object.values(trim)).size, 4);
  assert.equal(new Set(Object.values(lamp)).size, 4);
  for (const a of NATION_ORDER) for (const b of NATION_ORDER) if (a < b) assert.ok(differing(crown[a], crown[b]) > 1000, `${a} and ${b} cloth differ`);
  dressing.dispose();
});

test('a house with no banner yet shows undyed cloth, not a stale house', () => {
  const T = DESKTOP, dressing = dressWorld(T, asset(T), house('house-ombreval'));
  dressing.setState(environmentFixture('unfounded', 'solforiz'));
  const cloth = tile(pixels(dressing), 'player');
  for (const [i, undyed] of [0x8f, 0x87, 0x7b].entries()) assert.ok(Math.abs(cloth[i] - undyed) <= 4, `channel ${i}: ${cloth[i]}`);
  assert.equal(worldAtlasHeraldry(environmentFixture('unfounded', 'solforiz')).player, null);
  dressing.dispose();
});

test('disposeSourceTree still releases a whole tree', () => {
  const T = DESKTOP, root = new T.Group(), mesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial()); let n = 0;
  mesh.geometry.addEventListener('dispose', () => n++); mesh.material.addEventListener('dispose', () => n++); root.add(mesh); new T.Group().add(root);
  disposeSourceTree(root);
  assert.equal(n, 2); assert.equal(root.parent, null);
});

// Screen-space guards use the establishing camera at a desktop canvas, and Quest's staged scale.
function project(view: { position: number[]; target: number[]; fov: number }, p: readonly number[]) {
  const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - b[i]), dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const unit = (a: number[]) => { const l = Math.hypot(...a); return a.map(v => v / l); };
  const f = unit(sub(view.target, view.position)), right = unit([-f[2], 0, f[0]]), up = [right[2] * f[1] - right[1] * f[2], right[0] * f[2] - right[2] * f[0], right[1] * f[0] - right[0] * f[1]];
  const d = sub(p, view.position), depth = dot(d, f), focal = 360 / Math.tan(view.fov * Math.PI / 360);
  return { x: 640 + dot(d, right) / depth * focal, y: 360 - dot(d, up) / depth * focal, pxPerMetre: focal / depth, depth };
}
function clothTop(site: WorldHeraldry['sites'][number], grow = 1) {
  return site.kind === 'wall' ? site.position : [site.position[0], site.position[1] + site.pole! * grow, site.position[2]];
}

for (const world of WORLDS) {
  const { sites } = world.heraldry;
  test(`${world.id}: placement data is well formed`, () => {
    const ids = new Set(sites.map(s => s.id));
    assert.equal(ids.size, sites.length, 'site ids are unique');
    assert.ok(sites.some(s => s.heraldry === 'player'), 'shows the house');
    assert.ok(sites.some(s => s.heraldry === 'crown'), 'shows the nation');
    for (const s of sites) {
      assert.ok(s.width > 0, s.id);
      const drop = s.height ?? s.width * 1.5;
      if (s.kind === 'standard') assert.ok(s.pole! > drop, `${s.id}: the hem clears the ground`);
      else assert.equal(typeof s.facing, 'number', `${s.id}: wall cloth faces out from its wall`);
      if (s.heraldry === 'player') assert.equal(s.height, undefined, `${s.id}: house arms keep their proportions`);
    }
  });

  test(`${world.id}: stays inside the dressing budget`, () => {
    for (const [, T] of RUNTIMES) for (const relief of [false, true]) {
      const dressing = dressWorld(T, { ...asset(T, world.heraldry), view: world.view } as never, house('house-ombreval'), { relief }), { draws, triangles } = dressing.stats();
      assert.ok(draws <= 20, `${draws} draws`);
      assert.ok(triangles <= 5000, `${triangles} triangles`);
      dressing.dispose();
    }
  });

  test(`${world.id}: house banners are legible from the establishing view`, () => {
    const house = sites.filter(s => s.heraldry === 'player').map(s => ({ s, at: project(world.view, clothTop(s)) }));
    const onScreen = house.filter(({ s, at }) => at.depth > 0 && at.x > 0 && at.x < 1280 && at.y > 0 && at.y + (s.width * 1.5) * at.pxPerMetre < 720);
    const readable = onScreen.filter(({ s, at }) => s.width * at.pxPerMetre >= 16 && s.width * 1.5 * at.pxPerMetre >= 24);
    assert.ok(readable.length >= 2, `${readable.length} house banners read at 1280x720`);
  });

  test(`${world.id}: house banners are legible in Quest's staged miniature`, () => {
    const scale = Math.min(2.4 / world.extent.width, 1.85 / world.extent.depth, .65 / world.extent.height);
    // The world centre is staged 1.3 m out and about 0.8 m below the eye: at least 1.5 m away.
    const degrees = sites.filter(s => s.heraldry === 'player').map(s => Math.atan2(s.width * 1.5 * (s.relief ?? world.heraldry.reliefScale ?? 1) * scale, 1.5) * 180 / Math.PI);
    assert.ok(degrees.filter(d => d >= 1).length >= 2, `${degrees.map(d => d.toFixed(2)).join(', ')} degrees`);
  });
}
