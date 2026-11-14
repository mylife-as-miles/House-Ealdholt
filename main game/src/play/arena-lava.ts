/** The arena's lava: its pools, its rivers and the abyss under the board (the meshes named *Lava* in the look's
 * extras). One part of the battlefield's look; see arena-kit.ts for how a part joins it.
 *
 * The look's lava meshes are rebuilt here when the part is created, inside their own footprints
 * (arena-lava-geometry.ts), and all drawn with one shader (arena-lava-material.ts; the abyss has its own copy of the
 * material). The lava is listed as light for the other parts (context.shared.emitters); what leaves its surface is in
 * arena-lava-fx.ts. */
import * as THREE from "three";
import { ARENA_MAX_EMITTERS, type ArenaContext, type ArenaEmitter, type ArenaFeature, type ArenaQuality } from "./arena-kit";
import {
  buildPool, buildRiver, buildSheetPart, chooseGlowSources, cutStrip, drapeStrip, insideLoop, ladderRails, mergeSurfaces, plainSurface,
  poolShape, poolShore, readSheet, refineStrip, riverFalls, scatterOnSurface, seeded, sheetGlowSources, sheetHeightLookup, weld,
  smoothstep, type GlowSource, type Landing, type LavaSurface, type PoolOptions, type PoolShape, type River, type Vec3,
} from "./arena-lava-geometry";
import { createLavaEffects, type LavaEffectPlaces } from "./arena-lava-fx";
import { createGround, poolGround, rasterTriangle, sampleField, type Ground } from "./arena-lava-ground";
import { createCrustTexture, createLavaMaterial, lavaGlow, skyLight, surfaceGeometry } from "./arena-lava-material";

/** The look's brightness for lava unless its `lava` parameter says otherwise (battlefield-look.ts P.lava). */
const LOOK_GAIN = 0.35;
/** A lava material's heat as the look reads it from the material's name, before the look's own gain. */
function namedHeat(name: string): number {
  const found = /glow(\d+)p(\d+)_heat(\d+)p(\d+)/.exec(name);
  return found ? Math.min(1.6, Number(`${found[3]}.${found[4]}`) / 2.2) : 0.6;
}
/** The look's tiers as the lava scales itself by them: low is the tier with the area lamps off, high the one
 * antialiased four times over (battlefield-look.ts QUALITY). */
export function lavaTier(quality: ArenaQuality): "low" | "medium" | "high" {
  return !quality.area ? "low" : quality.msaa >= 4 ? "high" : "medium";
}
/** A pattern metre on the abyss is this much of a metre: its crust is old and thick, with plates twice a pool's. */
const ABYSS_TILE = 0.45;
/** The colour of lava's light at the heat of the look's hottest material and the look's default gain (linear). */
const LIGHT = lavaGlow(0.8).multiplyScalar(0.5);
/** A pool's lava stands and crusts over: it is a little cooler than the same lava running. */
const POOL_HEAT = 0.85;
/** The share of the abyss's hot channels taken to show as light: most of their run is under the arena's floor. */
const ABYSS_SHOWN = 0.12;
/** The least heat the abyss is drawn with. The look's coldest lava material (heat 0.16) covers most of the abyss and
 * would be black crust; the Cycles render lit it with lamps the game leaves out (see the LavaUnder lamps in
 * battlefield-look.ts). Far below, it should still show dull red veins between its plates. */
const ABYSS_LEAST_HEAT = 0.4;
/** A pool's lava is held where the ground is within this many metres under its surface. The look's pool discs reach
 * out over the abyss in places; there the ground is five metres down and more. */
const POOL_DEPTH = 3;

export interface ArenaLavaPlaces {
  pools: { shape: PoolShape; upwelling: Vec3; heat: number; ground: PoolOptions["ground"] }[];
  rivers: River[];
  /** Where a river's lava arrives in the abyss or in a pool. */
  landings: Landing[];
  /** The abyss's surface under a point, metres, or null where it has none. */
  abyssHeight: (x: number, z: number, reach?: number) => number | null;
}

export function createArenaLava(context: ArenaContext): ArenaFeature {
  const { fog, world } = context;
  const began = performance.now();
  const took: Record<string, number> = {};
  const mark = (name: string, since: number) => { took[name] = Math.round(performance.now() - since); };
  const crust = createCrustTexture(context.renderer);
  mark("crust", began);
  const material = createLavaMaterial(fog, crust, context.setting);
  skyLight(context.panorama, material.uniforms.uSkyLight.value);
  // The abyss's own copy: the same shader (so the same program) and the very same uniforms, but for one that says
  // it is the abyss.
  const deep = createLavaMaterial(fog, crust, context.setting);
  for (const name of ["uTime", "uGain", "uDetail", "uSky", "uSkyLight"]) deep.uniforms[name] = material.uniforms[name];
  deep.uniforms.uDeep.value = 1;
  const deepMeshes = new Set<THREE.Mesh>();
  const geometries: THREE.BufferGeometry[] = [];
  const prepared = new Set<THREE.Mesh>();
  const places: ArenaLavaPlaces = { pools: [], rivers: [], landings: [], abyssHeight: () => null };
  const sources: GlowSource[] = [];

  const extras = context.models.extras;
  // The extras are not in the arena yet, so a mesh's world matrix here is its place in the look's own metres.
  extras?.updateMatrixWorld(true);
  const fromRoot = extras ? new THREE.Matrix4().copy(extras.matrixWorld).invert() : new THREE.Matrix4();
  const materialName = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? "";
  const inMetres = (mesh: THREE.Mesh) => {
    const toMetres = new THREE.Matrix4().multiplyMatrices(fromRoot, mesh.matrixWorld);
    const position = (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).clone().applyMatrix4(toMetres);
    return { positions: position.array as Float32Array, index: mesh.geometry.index ? (mesh.geometry.index.array as ArrayLike<number>) : null, toMetres };
  };
  // Development only: each rebuilt mesh's own geometry and the look's heat for it (see the handle further down).
  const originals: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; heat: number }[] = [];
  const give = (mesh: THREE.Mesh, surface: LavaSurface, toMetres: THREE.Matrix4) => {
    const geometry = surfaceGeometry(surface, new THREE.Matrix4().copy(toMetres).invert());
    if (import.meta.env.DEV) originals.push({ mesh, geometry: mesh.geometry, heat: 0 });
    mesh.geometry = geometry;
    geometries.push(geometry);
    prepared.add(mesh);
  };
  const plain = (mesh: THREE.Mesh, heat: number) => {
    const { positions, index, toMetres } = inMetres(mesh);
    const normal = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    give(mesh, plainSurface(positions, normal ? (normal.clone().transformDirection(toMetres).array as Float32Array) : null, index, heat), toMetres);
  };

  if (extras) {
    const lava: THREE.Mesh[] = [];
    extras.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material) && (/Lava/.test(mesh.name) || /Lava/.test(materialName(mesh)))) lava.push(mesh);
    });
    const named = (pattern: RegExp) => lava.filter((mesh) => pattern.test(mesh.name) || pattern.test(mesh.parent?.name ?? ""));

    // the abyss first: the rivers end where they reach its surface
    const abyss = named(/AbyssLava/);
    const sheetParts: { surface: LavaSurface; points: Vec3[]; remap: Uint32Array }[] = [];
    if (abyss.length) {
      const parts = abyss.map((mesh) => ({ ...inMetres(mesh), heat: namedHeat(materialName(mesh)) }));
      const sheet = readSheet(parts);
      abyss.forEach((mesh, i) => {
        const surface = buildSheetPart(sheet, i, parts[i], ABYSS_TILE, ABYSS_LEAST_HEAT);
        sheetParts.push({ surface, points: sheet.welded.points, remap: sheet.remaps[i] });
        give(mesh, surface, parts[i].toMetres);
        deepMeshes.add(mesh);
      });
      places.abyssHeight = sheetHeightLookup(sheet.welded.points);
      sources.push(...sheetGlowSources(sheet, { shown: ABYSS_SHOWN }));
    }
    mark("abyss", began);

    const random = seeded(context.setting * 977 + 5);
    const pools = named(/LavaPool/).map((mesh) => {
      const { positions, index, toMetres } = inMetres(mesh);
      return { mesh, toMetres, shape: poolShape(weld(positions, index)), heat: namedHeat(materialName(mesh)) };
    });
    const rivers = named(/LavaRiver/).map((mesh) => {
      const { positions, index, toMetres } = inMetres(mesh);
      return { mesh, toMetres, rails: ladderRails(weld(positions, index)), heat: namedHeat(materialName(mesh)) };
    });
    // the ground under each pool and each river, a metre past it all round: in cells of 12 cm for a pool, whose
    // shore is read from it, and 20 cm for a river, which is only laid on it
    const groundUnder = (points: Vec3[], cell: number) => {
      const xs = points.map((p) => p[0]), zs = points.map((p) => p[2]);
      return createGround(Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1, cell);
    };
    const grounds = pools.map(({ shape }) => (shape ? groundUnder(shape.rim, 0.12) : null));
    const riverGrounds = rivers.map(({ rails }) => (rails ? groundUnder([...rails.left, ...rails.right], 0.2) : null));
    const groundBegan = performance.now();
    layGround([context.models.arena, context.models.environment], [...grounds, ...riverGrounds].filter((ground): ground is Ground => ground !== null));
    mark("ground", groundBegan);
    pools.forEach(({ mesh, toMetres, shape, heat }, i) => {
      if (!shape) { plain(mesh, heat); return; }
      const ground = poolGround(grounds[i]!, shape.level, POOL_DEPTH);
      const pool = buildPool(shape, { heat: heat * POOL_HEAT, seed: Math.floor(random() * 1e6), ground });
      give(mesh, pool, toMetres);
      places.pools.push({ shape, upwelling: pool.upwelling, heat, ground });
      sources.push({ kind: "pool", position: [pool.upwelling[0], shape.level + 0.3, pool.upwelling[2]], radius: shape.radius, power: shape.area * heat });
    });

    // a river stops where it goes under the abyss's surface or into a pool: what was drawn beyond is under lava
    const covered = (p: Vec3) => {
      const lake = places.abyssHeight(p[0], p[2], 3);
      if (lake !== null && p[1] < lake + 0.2) return true;
      return places.pools.some(({ shape, ground }) => p[1] < shape.level + 0.45 && insideLoop(p[0], p[2], shape.rim) && (!ground || ground.held(p[0], p[2]) >= 0));
    };
    rivers.forEach(({ mesh, toMetres, rails, heat }, at) => {
      if (!rails) { plain(mesh, heat); return; }
      const ground = riverGrounds[at]!;
      const draped = drapeStrip(refineStrip(rails, 0.4), (x, z) => sampleField(ground, ground.height, x, z, -Infinity));
      const stretches = cutStrip(draped, covered)
        .map(({ strip, cutStart, cutEnd }, i) => buildRiver(strip, { heat, cutStart, cutEnd, offset: at * 31.7 + i * 13.3, seed: at * 16 + i + 1 }));
      if (!stretches.length) { mesh.visible = false; prepared.add(mesh); return; }
      give(mesh, mergeSurfaces(stretches), toMetres);
      places.rivers.push(...stretches);
      for (const river of stretches) { places.landings.push(...river.landings); sources.push(...riverGlowSources(river, heat)); }
      // The pit a river lands in: the abyss's lava lies open to the sky there (the ground under the river's own
      // footprint is below the lava), stirred up and bright. Counted from the ground laid for the river.
      const feet = stretches.flatMap((river) => river.landings).filter((landing) => {
        const lake = places.abyssHeight(landing.position[0], landing.position[2], 3);
        return lake !== null && Math.abs(lake - landing.position[1]) < 0.6;
      });
      if (feet.length) {
        let area = 0, x = 0, y = 0, z = 0;
        for (let j = 0; j < ground.rows; j++) for (let i = 0; i < ground.columns; i++) {
          const cx = ground.x0 + (i + 0.5) * ground.cell, cz = ground.z0 + (j + 0.5) * ground.cell;
          const foot = feet.find((landing) => Math.hypot(cx - landing.position[0], cz - landing.position[2]) < 7);
          if (!foot || ground.height[j * ground.columns + i] > foot.position[1] - 0.2) continue;
          const cell = ground.cell * ground.cell;
          area += cell; x += cx * cell; y += foot.position[1] * cell; z += cz * cell;
        }
        if (area > 4) sources.push({ kind: "abyss", position: [x / area, y / area + 0.3, z / area], radius: Math.sqrt(area / Math.PI), power: area * 1.1 });
      }
    });
    // where a river lands in the abyss the abyss's own lava is stirred up: fresh and hot for a few metres round
    for (const { surface, points, remap } of sheetParts) {
      for (let i = 0; i < remap.length; i++) {
        const p = points[remap[i]];
        for (const landing of places.landings) {
          if (Math.abs(p[1] - landing.position[1]) > 1.5) continue;
          const reach = 2.4 + landing.halfWidth;
          const fresh = (0.35 + 0.65 * landing.steep) * (1 - smoothstep(0.3 * reach, reach, Math.hypot(p[0] - landing.position[0], p[2] - landing.position[2])));
          if (fresh > surface.state[i * 4 + 3]) { surface.state[i * 4 + 3] = fresh; surface.state[i * 4] = Math.max(surface.state[i * 4], fresh); }
        }
      }
    }
    for (const mesh of lava) if (!prepared.has(mesh)) plain(mesh, namedHeat(materialName(mesh)));
  }

  // the lava as light for the other parts: the stretches that matter most to the board, in the board's units
  const unit = world.scale.x;
  const flicker: { emitter: ArenaEmitter; phase: number }[] = [];
  for (const source of chooseGlowSources(sources, ARENA_MAX_EMITTERS)) {
    const heat = source.power / (Math.PI * source.radius * source.radius);
    const emitter: ArenaEmitter = {
      position: new THREE.Vector3(...source.position).multiplyScalar(unit), radius: source.radius * unit,
      color: LIGHT.clone().multiplyScalar(heat), level: 1,
    };
    context.shared.emitters.push(emitter);
    flicker.push({ emitter, phase: flicker.length * 2.399 });
  }
  const flickerAt = (time: number) => {
    // lava does not flicker like flame: a slow swell, and a little faster unrest on top
    for (const { emitter, phase } of flicker) {
      emitter.level = 1 + 0.07 * Math.sin(time * 0.63 + phase) + 0.04 * Math.sin(time * 1.9 + phase * 2.7) + 0.02 * Math.sin(time * 4.7 + phase * 5.1);
    }
  };
  flickerAt(0);

  const effects = createLavaEffects(context, effectPlaces(places, seeded(context.setting * 389 + 3)), crust);
  let gain = 1;
  const setGain = (next: number) => {
    if (Math.abs(next - gain) < 1e-6) return;
    for (const { emitter } of flicker) emitter.color.multiplyScalar(next / gain);
    gain = next;
    material.uniforms.uGain.value = gain;
    effects.setGain(gain);
  };
  const sharpest = crust.anisotropy;
  const applyQuality = (quality: ArenaQuality) => {
    const tier = lavaTier(quality);
    material.uniforms.uDetail.value = tier === "low" ? 0 : 1;
    effects.setTier(tier);
    // anisotropic filtering keeps the cracks sharp at a low angle; the low tier is drawn at lower resolution anyway
    const anisotropy = tier === "low" ? 1 : sharpest;
    if (crust.anisotropy !== anisotropy) { crust.anisotropy = anisotropy; crust.needsUpdate = true; }
  };
  applyQuality(context.quality());
  // Development only: lets a capture script read the lava's places, try other values in its uniforms, and put the
  // old lava back on the same meshes to compare frame times.
  const debug = window as unknown as { __crownfallArenaLava?: unknown };
  if (import.meta.env.DEV) {
    debug.__crownfallArenaLava = { material, deep, places, emitters: context.shared.emitters, fog, grade: effects.grade, originals,
                                   took: { ...took, all: Math.round(performance.now() - began) } };
  }

  return {
    lavaMaterial(mesh, source, heat) {
      const named = namedHeat(source.name);
      if (!prepared.has(mesh)) plain(mesh, named);
      if (import.meta.env.DEV) for (const original of originals) if (original.mesh === mesh) original.heat = heat;
      // the look scales every lava material's heat by one gain; the lava's brightness follows it
      setGain(heat / named / LOOK_GAIN);
      return deepMeshes.has(mesh) ? deep : material;
    },
    grade: effects.grade,
    update(time) {
      material.uniforms.uTime.value = time;
      flickerAt(time);
      effects.update(time);
    },
    setQuality: applyQuality,
    dispose() {
      effects.dispose();
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      material.dispose();
      deep.dispose();
      crust.dispose();
      for (const original of originals) original.geometry.dispose();
      originals.length = 0;
      if (import.meta.env.DEV) delete debug.__crownfallArenaLava;
    },
  };
}

/** Where the lava's effects go (arena-lava-fx.ts), from the lava's places. */
function effectPlaces(places: ArenaLavaPlaces, random: () => number): LavaEffectPlaces {
  const out: LavaEffectPlaces = { halos: [], bubbles: [], splashes: [], sparks: [], heat: [] };
  const inOpenPool = (p: Vec3) => places.pools.find(({ shape }) => Math.abs(p[1] - shape.level) < 1 && insideLoop(p[0], p[2], shape.rim));
  for (const { shape, upwelling, ground } of places.pools) {
    // how far the open lava reaches round the place it wells up; a pool wholly under rock shows nothing
    const open = poolShore(shape, ground, upwelling[0], upwelling[2]);
    if (open < 0.15) continue;
    out.halos.push({ position: [upwelling[0], shape.level + 0.25, upwelling[2]], radius: 1.4 + 1.3 * open, height: 1.1 + open, strength: 0.7 });
    out.heat.push({ position: [upwelling[0], shape.level, upwelling[2]], radius: 1 + 1.5 * open, strength: 0.8 });
    // bubbles in the open lava, more in a larger pool
    const xs = shape.rim.map((p) => p[0]), zs = shape.rim.map((p) => p[2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const found: { position: Vec3; radius: number }[] = [];
    let hits = 0;
    for (let tries = 0; tries < 300; tries++) {
      const x = x0 + (x1 - x0) * random(), z = z0 + (z1 - z0) * random();
      const shore = insideLoop(x, z, shape.rim) ? poolShore(shape, ground, x, z) : 0;
      if (shore < 0.3) continue;
      hits++;
      if (found.length < 6 && found.every((b) => Math.hypot(b.position[0] - x, b.position[2] - z) > 0.7)) {
        found.push({ position: [x, shape.level, z], radius: Math.min(0.2, 0.07 + 0.35 * (shore - 0.3) * (0.4 + 0.6 * random())) });
      }
    }
    const openArea = (hits / 300) * (x1 - x0) * (z1 - z0);
    out.bubbles.push(...found.slice(0, Math.max(2, Math.min(6, Math.round(openArea / 2)))));
  }
  for (const river of places.rivers) {
    for (const fall of riverFalls(river)) {
      const height = Math.abs(fall.top[1] - fall.foot[1]);
      const middle: Vec3 = [(fall.top[0] + fall.foot[0]) / 2, (fall.top[1] + fall.foot[1]) / 2, (fall.top[2] + fall.foot[2]) / 2];
      out.halos.push({ position: middle, radius: 1.3 + 2 * fall.halfWidth, height: height / 2 + 1, strength: 0.6 });
      out.heat.push({ position: middle, radius: 1.2 + fall.halfWidth, strength: 0.6 });
      // a fall that ends in the river's cut end lands in other lava, and is counted with the landings below
      if (!fall.footAtEnd) out.splashes.push({ position: fall.foot, halfWidth: fall.halfWidth, strength: 0.8 });
    }
    const count = Math.max(6, Math.min(24, Math.round(river.flowAlong.arc[river.middle.length - 1] * 1.2)));
    const across = river.positions.length / 3 / river.middle.length;
    for (const place of scatterOnSurface(river, count, random, (vertex) => 0.15 + river.flowAlong.steep[Math.floor(vertex / across)])) {
      out.sparks.push({ position: place.position, normal: place.normal });
    }
  }
  for (const landing of places.landings) {
    if (landing.steep < 0.35) continue;
    const pool = inOpenPool(landing.position);
    if (pool && poolShore(pool.shape, pool.ground, landing.position[0], landing.position[2]) < 0.15) continue;
    out.splashes.push({ position: landing.position, halfWidth: landing.halfWidth, strength: landing.steep });
    if (pool) continue;
    // the abyss is stirred up round a landing: bubbles there too
    for (let i = 0; i < 3; i++) {
      const angle = random() * Math.PI * 2, far = 0.9 + 1.5 * random();
      const x = landing.position[0] + Math.cos(angle) * far, z = landing.position[2] + Math.sin(angle) * far;
      const height = places.abyssHeight(x, z, 3);
      if (height !== null) out.bubbles.push({ position: [x, height + 0.02, z], radius: 0.1 + 0.12 * random() });
    }
  }
  for (const splash of out.splashes) {
    out.halos.push({ position: [splash.position[0], splash.position[1] + 0.4, splash.position[2]], radius: 2.2 + 2 * splash.halfWidth, height: 1.9 + splash.halfWidth, strength: 0.9 * splash.strength });
    out.heat.push({ position: splash.position, radius: 2, strength: splash.strength });
  }
  return out;
}

/**
 * Lays the arena's static meshes over the grounds (the highest surface over each cell). Leaves and other cut-out
 * meshes are passed over: they hold no lava.
 */
function layGround(models: THREE.Object3D[], grounds: Ground[]) {
  if (!grounds.length) return;
  const box = new THREE.Box3(), toMetres = new THREE.Matrix4(), fromRoot = new THREE.Matrix4();
  const reaches = (ground: Ground, minX: number, minZ: number, maxX: number, maxZ: number) =>
    maxX >= ground.x0 && minX <= ground.x0 + ground.columns * ground.cell && maxZ >= ground.z0 && minZ <= ground.z0 + ground.rows * ground.cell;
  // one box round all the grounds: most of the arena's triangles are nowhere near any of them
  const allX0 = Math.min(...grounds.map((g) => g.x0)), allX1 = Math.max(...grounds.map((g) => g.x0 + g.columns * g.cell));
  const allZ0 = Math.min(...grounds.map((g) => g.z0)), allZ1 = Math.max(...grounds.map((g) => g.z0 + g.rows * g.cell));
  for (const model of models) {
    model.updateMatrixWorld(true);
    fromRoot.copy(model.matrixWorld).invert();
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material || material.transparent || material.alphaTest > 0) return;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      toMetres.multiplyMatrices(fromRoot, mesh.matrixWorld);
      box.copy(geometry.boundingBox!).applyMatrix4(toMetres);
      const near = grounds.filter((ground) => reaches(ground, box.min.x, box.min.z, box.max.x, box.max.z));
      const position = geometry.getAttribute("position");
      if (!near.length || !(position instanceof THREE.BufferAttribute) || position.normalized) return;
      // the mesh's own arrays, read directly: there are millions of corners to get through
      const local = position.array, e = toMetres.elements, p = new Float32Array(position.count * 3);
      for (let i = 0; i < p.length; i += 3) {
        const x = local[i], y = local[i + 1], z = local[i + 2];
        p[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const index = geometry.index ? geometry.index.array : null;
      const corners = index ? index.length : position.count;
      for (let i = 0; i + 2 < corners; i += 3) {
        const a = (index ? index[i] : i) * 3, b = (index ? index[i + 1] : i + 1) * 3, c = (index ? index[i + 2] : i + 2) * 3;
        const ax = p[a], bx = p[b], cx = p[c];
        const minX = ax < bx ? (ax < cx ? ax : cx) : bx < cx ? bx : cx, maxX = ax > bx ? (ax > cx ? ax : cx) : bx > cx ? bx : cx;
        if (maxX < allX0 || minX > allX1) continue;
        const az = p[a + 2], bz = p[b + 2], cz = p[c + 2];
        const minZ = az < bz ? (az < cz ? az : cz) : bz < cz ? bz : cz, maxZ = az > bz ? (az > cz ? az : cz) : bz > cz ? bz : cz;
        if (maxZ < allZ0 || minZ > allZ1) continue;
        for (const ground of near) {
          if (reaches(ground, minX, minZ, maxX, maxZ)) rasterTriangle(ground, ax, p[a + 1], az, bx, p[b + 1], bz, cx, p[c + 1], cz);
        }
      }
    });
  }
}

/** A river as light: its falls each as one source at their middle, and the rest of it as another. */
function riverGlowSources(river: River, heat: number): GlowSource[] {
  const { middle, halfWidth, flowAlong } = river;
  const sources: GlowSource[] = [];
  const gather = (falling: boolean) => {
    let from = -1;
    for (let i = 0; i <= middle.length; i++) {
      const within = i < middle.length && (flowAlong.steep[i] > 0.5) === falling;
      if (within && from < 0) from = i;
      if (!within && from >= 0) {
        let area = 0;
        const sum: Vec3 = [0, 0, 0];
        for (let k = from; k < i; k++) {
          const span = (flowAlong.arc[Math.min(i - 1, k + 1)] - flowAlong.arc[Math.max(from, k - 1)]) / 2;
          const a = span * 2 * halfWidth[k];
          area += a; sum[0] += middle[k][0] * a; sum[1] += middle[k][1] * a; sum[2] += middle[k][2] * a;
        }
        if (area > 1.5) {
          sources.push({ kind: falling ? "fall" : "river", position: [sum[0] / area, sum[1] / area, sum[2] / area],
                         radius: Math.sqrt(area / Math.PI), power: area * heat * (falling ? 1.3 : 0.9) });
        }
        from = -1;
      }
    }
  };
  gather(true); gather(false);
  return sources;
}
