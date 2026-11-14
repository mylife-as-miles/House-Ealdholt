import { SETTLEMENT_SUN_DIRECTION } from '../../environment/settlement/lighting.ts';
/**
 * Actual Leon Lin source architecture, adapted for Crownfall's fixed lots and
 * estate editor. Athenaion 9b8bd23b39c458a50fb1201037360047781c45b5 and
 * Golden Temple 97fd9ec35ee5c0f02769addb4e35cb5e22f951dd are MIT licensed;
 * their notices remain beside the vendored source. No substitute mesh kit.
 * Source attributes and procedural surface hooks are retained intact.
 */
import * as SOURCE_THREE from 'crownfall-world-three';
import { buildHouse } from '../athenaion/vendor/city/buildings.js';
import { GeoBuilder } from '../athenaion/vendor/city/geobuilder.js';
import { RNG, hashString } from '../athenaion/vendor/core/rng.js';
import { createGeometryCompactor } from '../athenaion/compact.js';
import { plasterMaterial, PLASTER_ATTRS } from '../athenaion/vendor/materials/plaster.js';
import { terracottaMaterial, ROOF_ATTRS } from '../athenaion/vendor/materials/terracotta.js';
import { cityStoneMaterial, cityGoldMaterial, STONE_ATTRS } from '../athenaion/vendor/city/stone.js';
import { shipWoodMaterial, WOOD_ATTRS } from '../athenaion/vendor/city/shipmats.js';
import { Builder } from '../golden-temple/upstream/core/geom.js';
import { materials as templeMaterials, std, PROC } from '../golden-temple/upstream/core/materials.js';
import { G as templeUniforms } from '../golden-temple/upstream/core/env.js';
import { LB, buildIx } from '../golden-temple/upstream/world/buildings-kit.js';
import { hallBuilding } from '../golden-temple/upstream/world/buildings-halls.js';

const ATHENAION = Object.freeze({ repository: 'https://github.com/Leonxlnx/athenaion', commit: '9b8bd23b39c458a50fb1201037360047781c45b5', license: 'MIT' });
const TEMPLE = Object.freeze({ repository: 'https://github.com/Leonxlnx/golden-temple', commit: '97fd9ec35ee5c0f02769addb4e35cb5e22f951dd', license: 'MIT' });
const CITY_SOURCE = Object.freeze({ id: 'athenaion-city-house', ...ATHENAION, path: 'src/city/buildings.js', generator: 'buildHouse' });
const HALL_SOURCE = Object.freeze({ id: 'golden-temple-timber-hall', ...TEMPLE, path: 'src/world/buildings-halls.js', generator: 'hallBuilding' });
const HALL_APPROACH_SOURCE = Object.freeze({ id: 'golden-temple-crownfall-hall-approach', ...TEMPLE, path: 'src/world/buildings-kit.js', generator: 'LB.box (original Crownfall paired landing, low edge and bench arrangement)' });
const PAVILION_SOURCE = Object.freeze({ id: 'golden-temple-timber-pavilion', ...TEMPLE, path: 'src/world/buildings-halls.js', generator: 'hallBuilding (open pavilion parameters)' });
const KINDS = new Set(['hall', 'cottage', 'storehouse', 'archive', 'herald', 'pavilion']);
const ROOF_FAMILIES = Object.freeze({ slate: '#416574', patina: '#597360', copper: '#986b4c' });
// These supplement, rather than replace, the upstream tile colouring. The
// original shader still supplies its tile variation, weathering, normals and AO.
const ESTATE_ROOF_COLOR = /* glsl */ `
// Crownfall roof finish: after source tile colour, before physical lighting.
if (kind >= 0 && kind <= 2) {
  float estateLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 estateFinish = uCrownfallRoofTint * clamp(estateLuma / 0.155, 0.38, 1.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, estateFinish, 0.94);
  if (kind == 0) {
    // Broad, derivative-filtered courses remain legible from the estate camera;
    // the original barrel-tile detail remains visible when approaching a roof.
    float estateCourse = vRoof.y / 0.82;
    float estateAA = max(fwidth(estateCourse), 0.012);
    float estateJoint = 1.0 - smoothstep(0.035, 0.035 + estateAA, abs(fract(estateCourse + 0.5) - 0.5));
    float estateFade = 1.0 - smoothstep(0.36, 0.85, estateAA);
    diffuseColor.rgb *= 1.0 - 0.22 * estateJoint * estateFade;
  }
}
`;

function countGeometry(group) {
  let triangles = 0, meshes = 0;
  const attributes = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    for (const name of Object.keys(object.geometry.attributes)) attributes.add(name);
  });
  return { meshes, triangles, attributes: [...attributes].sort() };
}

/** Only geometry is fitted. Authored facade/tile coordinates stay in source
 * metres, and uniform fitting avoids distorting columns or their normal frames.
 * Y=0 is the ground datum; source foundations intentionally continue below it. */
function fitPrototype(T, group, width, depth, height) {
  group.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(group), size = bounds.getSize(new T.Vector3());
  if (![size.x, size.y, size.z, bounds.max.y].every(Number.isFinite) || Math.min(size.x, size.z) <= 0) throw new Error('Source architecture returned invalid bounds');
  const scale = Math.min(width * .96 / size.x, depth * .96 / size.z, height / Math.max(bounds.max.y, .1));
  const matrix = new T.Matrix4().makeScale(scale, scale, scale);
  matrix.setPosition(-(bounds.min.x + bounds.max.x) * .5 * scale, 0, -(bounds.min.z + bounds.max.z) * .5 * scale);
  group.traverse(object => {
    if (!object.isMesh) return;
    object.geometry.applyMatrix4(matrix);
    object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
  });
  group.updateMatrixWorld(true);
  const fitted = new T.Box3().setFromObject(group);
  const mass = group.userData.sourceFootprints?.[0];
  return { scale, min: fitted.min.toArray(), max: fitted.max.toArray(), ...(mass ? { wallWidthCoverage: mass.hw * 2 * scale / width, wallDepthCoverage: mass.hd * 2 * scale / depth } : {}) };
}

export function createArchitectureKit({ THREE: T, profile = 'desktop' }) {
  if (!T || !(new SOURCE_THREE.Group() instanceof T.Object3D)) throw new Error('Source architecture must use the consuming Three namespace');
  const prototypes = new Map(), ownedMaterials = new Map(), templateMaterials = new Set();
  let disposed = false, builds = 0;
  const uniforms = {
    uCrownfallSourceInverse: { value: new T.Matrix4() },
    uCrownfallSourceRoot: { value: new T.Matrix4() },
    uCrownfallSourceScale: { value: 1 },
    uCrownfallSourceCamera: { value: new T.Vector3(0, 100, 100) },
    uCrownfallAerialDensity: { value: 0 },
    uTime: { value: 0 }, uShot: { value: -1 }, uWindStrength: { value: 0 },
    uWindDir: { value: templeUniforms.uWindDir.value.clone() },
    uSunDir: { value: new T.Vector3(...SETTLEMENT_SUN_DIRECTION) },
    uSunColor: { value: templeUniforms.uSunColor.value.clone() },
  };

  /** Cached source materials are borrowed read-only; only these explicit clones
   * belong to this kit. Three.Material.clone alone does not copy shader hooks. */
  function ownMaterial(source, temple = false, roofFamily = null) {
    const key = `${source.uuid}:${temple ? 'temple' : 'city'}:${roofFamily ?? 'source'}`;
    if (ownedMaterials.has(key)) return ownedMaterials.get(key);
    const material = source.clone(), before = source.onBeforeCompile;
    const originalKey = source.customProgramCacheKey.bind(source);
    material.name = `Crownfall source / ${source.name || source.type}${roofFamily ? ` / ${roofFamily}` : ''}`;
    material.fog = false; // The compact estate owns its atmosphere; no source fog installer.
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      if (temple) Object.assign(shader.uniforms, uniforms);
      if (roofFamily) {
        // material.color is overwritten by the source shader. Grade its final
        // albedo instead, on this kit-owned clone only, preserving source hooks.
        if (!shader.fragmentShader.includes('diffuseColor.rgb = col;')) throw new Error('Source roof colour hook changed');
        shader.uniforms.uCrownfallRoofTint = { value: new T.Color(ROOF_FAMILIES[roofFamily]) };
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uCrownfallRoofTint;');
        shader.fragmentShader = shader.fragmentShader.replace('diffuseColor.rgb = col;', `diffuseColor.rgb = col;\n${ESTATE_ROOF_COLOR}`);
      }
    };
    material.customProgramCacheKey = () => `${originalKey()}|crownfall-owned-estate-${temple ? 'temple' : 'city'}-${roofFamily ?? 'source'}-v2`;
    material.userData = { ...material.userData, crownfallSourceMaterial: true, sourceNamespace: 'crownfall-world-three', ...(roofFamily ? { crownfallRoofFamily: roofFamily } : {}) };
    ownedMaterials.set(key, material);
    return material;
  }

  function cityPrototype(spec, seed) {
    const player = spec.id === 'preview' || /^estate-/.test(spec.id);
    const recipe = player ? (spec.kind === 'storehouse' ? 1 : 0) : seed % 3;
    const roofFamily = ['slate', 'copper', 'patina'][recipe];
    const style = {
      archetype: spec.kind === 'cottage' ? 'cottage' : 'house',
      storeys: spec.kind === 'herald' ? 2 : 1, storeyHeight: spec.kind === 'herald' ? 2.7 : 2.95,
      pitchMin: spec.kind === 'cottage' ? 42 : 38, pitchMax: spec.kind === 'cottage' ? 48 : 43,
      roof: ['gableZ', 'gableX', 'hip'][recipe], roofFamily,
      plasterFamily: ['lime', 'ochre', 'sand'][recipe], copperRoof: true,
      plinthHeight: spec.kind === 'herald' ? .72 : .60, quoins: true,
      stoneGroundFloor: spec.kind === 'herald', allowRoofExtra: false,
      windowStyle: spec.kind === 'herald' ? 'framed' : 'shutter', allowAnnex: false, allowYard: false,
    };
    const height = spec.height ?? (spec.kind === 'storehouse' ? 8.6 : 8.7);
    // Hipped roofs need broader source wall masses on the new 6m square lots.
    // These real source seeds were measured to retain >=75% lot-width coverage.
    const pool = style.roof === 'hip' ? [2, 8, 67, 139, 61, 7, 23, 29, 109] : [139, 61, 7, 23, 29, 109];
    const offset = seed % pool.length;
    let selected = null, selectedScore = -Infinity;
    // This bounded source-seed choice runs only when creating an archetype,
    // never per cursor position. Rejecting tower-like fits preserves usable lot mass.
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const candidateSeed = pool[(offset + attempt) % pool.length];
      const B = {
        plaster: new GeoBuilder(PLASTER_ATTRS), roof: new GeoBuilder(ROOF_ATTRS),
        stone: new GeoBuilder(STONE_ATTRS), wood: new GeoBuilder(WOOD_ATTRS), gold: new GeoBuilder({}),
      };
      const context = {
        B, ground: () => 0, gardens: [], slots: { urn: [], tree: [] }, crownfallArchitecture: style,
        district: () => ({ centre: .1, harbour: .1, edge: .9 }),
      };
      const lot = { x: 0, z: 0, w: spec.width, d: spec.depth, rot: 0, seed: player ? .314159 : (seed >>> 0) / 4294967296, row: false };
      const footprint = buildHouse(context, lot, new RNG(candidateSeed));
      const materials = { plaster: plasterMaterial(), roof: terracottaMaterial(), stone: cityStoneMaterial(), wood: shipWoodMaterial(), gold: cityGoldMaterial() };
      const group = new T.Group(); group.name = `Athenaion source ${style.roof} estate house`;
      for (const [part, builder] of Object.entries(B)) {
        const geometry = builder.toGeometry();
        if (!geometry.attributes.position.count) { geometry.dispose(); continue; }
        const mesh = new T.Mesh(geometry, ownMaterial(materials[part], false, part === 'roof' ? roofFamily : null));
        mesh.name = `Athenaion source ${part}`; mesh.castShadow = profile !== 'quest'; mesh.receiveShadow = true;
        group.add(mesh);
      }
      group.userData.sourceFootprints = footprint;
      group.userData.sourceAsset = CITY_SOURCE; group.userData.sourceProvenance = [CITY_SOURCE];
      group.userData.sourceSelectedSeed = candidateSeed; group.userData.sourceCrownfallArchitecture = style;
      const box = new T.Box3().setFromObject(group), size = box.getSize(new T.Vector3());
      const fit = Math.min(spec.width * .96 / size.x, spec.depth * .96 / size.z, height / Math.max(box.max.y, .1));
      const coverage = footprint[0] ? footprint[0].hw * 2 * fit / spec.width : 0;
      const depthCoverage = footprint[0] ? footprint[0].hd * 2 * fit / spec.depth : 0;
      const score = Math.min(coverage, depthCoverage) + coverage * .35;
      if (score > selectedScore) {
        selected?.traverse(object => object.geometry?.dispose()); selected = group; selectedScore = score;
      } else group.traverse(object => object.geometry?.dispose());
      if (coverage >= .75 && depthCoverage >= .7 && box.max.y <= 10.5) break;
    }
    return selected;
  }

  function hallPrototype(pavilion = false) {
    // Reuse the real source hall generator with fewer bays, one bracket tier,
    // wider rafter spacing and its own low-detail roof settings. The curved
    // tiled roof, lattice, columns and joinery remain authored source geometry.
    const M = templeMaterials();
    const tileVC = std({ color: 0xffffff, roughness: .42, metalness: .12, vertexColors: true }, PROC.roofTile());
    tileVC.name = 'source compact hall tile'; templateMaterials.add(tileVC);
    const K = {
      red: M.woodRaw, col: M.woodRaw, beam: M.woodRaw, rafter: M.woodRaw, wood: M.woodRaw,
      redDark: M.woodDark, soffit: M.woodDark, gold: M.bronze, cap: M.bronze, capPaint: M.bronze,
      gib: M.bronze, tile: M.roofTile, tileVC, plaster: M.plaster, lattice: M.latticeGreen,
      stone: M.granite, stoneClean: M.graniteClean, floorX: M.woodFloorX, floorZ: M.woodFloorZ,
      black: M.blackLacquer, bronze: M.bronze, woodRaw: M.woodRaw, dark: M.woodDark, rope: M.woodRaw, kanagu: M.bronze,
    };
    const builder = new Builder(), indexed = new Map(), lb = new LB(builder, new T.Matrix4(), indexed);
    // Source side-hall podium/steps, reduced with the same source box primitive.
    lb.box(K.stone, pavilion ? 3.6 : 9, .55, pavilion ? 3.6 : 6.2, [0, .275, 0], [0, 0, 0], .03);
    for (let i = 0; i < 3; i++) lb.box(K.stoneClean, pavilion ? 1.2 : 2.8, (i + 1) * .18, pavilion ? .22 : .38, [0, (i + 1) * .09, (pavilion ? 1.8 : 3.1) + (2 - i) * (pavilion ? .18 : .36)], [0, 0, 0], .012);
    if (!pavilion) {
      // A Crownfall arrangement of the actual source carpentry/stone primitive,
      // fitted entirely under the existing hall eaves and beside its central
      // steps. These share the hall's existing material buckets; the protected
      // lot, fitted main mass, traversal and every player-placeable stay intact.
      for (const side of [-1, 1]) {
        const x = side * 3.15;
        lb.box(K.stoneClean, 1.8, .17, .82, [x, .085, 3.22], [0, 0, 0], .025);
        lb.box(K.stone, 1.64, .50, .26, [x, .42, 3.5], [0, 0, 0], .025);
        lb.box(K.stoneClean, 1.8, .12, .34, [x, .73, 3.5], [0, 0, 0], .025);
        // Timber seats lie on the podium between the outer pair of source
        // columns, rather than floating over or occupying the approach steps.
        for (const end of [-1, 1]) lb.box(K.wood, .15, .34, .35, [x + end * .59, .72, 2.89], [0, 0, 0], .012);
        lb.box(K.wood, 1.6, .12, .44, [x, .95, 2.89], [0, 0, 0], .025);
      }
    }
    hallBuilding(lb, K, {
      xs: pavilion ? [-1.25, 1.25] : [-4.2, -1.4, 1.4, 4.2], zs: pavilion ? [-1.25, 1.25] : [-2.3, 0, 2.3], colR: pavilion ? .12 : .17, y0: .55, yct: pavilion ? 2.5 : 3.8,
      walls: (side, i) => pavilion ? 'open' : side === 'front' && i === 1 ? 'door' : 'window',
      BS: { tiers: 1, proj: [.36, .62], armH: .11, armW: .11, blockH: .08, daito: [.24, .14], mak: [.16, .1], wall: [.65, .85], inner: false, goldCaps: true, goldMak: false, goldDaito: false, K: { wood: K.red, gold: K.cap } },
      ov: pavilion ? .55 : .95, liftL: .28, roofRise: pavilion ? 1.35 : 2.5, ovG: .38, tileP: pavilion ? .5 : .42, tileDetail: 0,
      sp: pavilion ? .65 : .55, lo: true, twoTier: false, inter: false, gableLattice: !pavilion, infill: !pavilion,
      ridge: { w: .4, h: .34, layers: 2, capR: .08, drop: .25 },
      hip: { w: .24, h: .2, layers: 2, capR: .06, drop: .14 },
    });
    const group = builder.build({ name: pavilion ? 'Golden Temple source open timber pavilion' : 'Golden Temple source compact timber hall' });
    buildIx(indexed, group);
    const beforeLod = countGeometry(group).triangles;
    const compact = createGeometryCompactor(T, 'desktop', { preserveNormalCreases: true });
    group.traverse(object => {
      if (!object.isMesh) return;
      // Existing source-world LOD retains position, normal, UV and vertex colour
      // channels while reducing sub-pixel carpentry/roof microgeometry. This is
      // the conservative profile on both platforms, rather than a replacement.
      const original = object.geometry, reduced = compact(original, 'source timber component');
      if (reduced !== original) { object.geometry = reduced; original.dispose(); }
      object.material = ownMaterial(object.material, true);
      object.castShadow = profile !== 'quest'; object.receiveShadow = true;
    });
    group.userData.sourceAsset = pavilion ? PAVILION_SOURCE : HALL_SOURCE;
    group.userData.sourceProvenance = pavilion ? [PAVILION_SOURCE] : [HALL_SOURCE, HALL_APPROACH_SOURCE];
    if (!pavilion) group.userData.crownfallArrangement = 'paired landing edges and timber benches within the existing hall lot';
    group.userData.sourceLod = { adapter: 'athenaion/compact.js', profile: 'desktop', beforeTriangles: beforeLod, triangles: countGeometry(group).triangles };
    return group;
  }

  function archetype(spec) {
    // A player ghost and its saved estate object must be the same model.
    // Fixed authored lots may use their stable IDs for source house variation.
    const player = spec.id === 'preview' || /^estate-/.test(spec.id);
    const variant = player ? `player-${spec.kind}` : spec.id;
    const seed = player && (spec.kind === 'cottage' || spec.kind === 'storehouse') ? 23 : hashString(`crownfall-source-${spec.kind}-${variant}`);
    const height = spec.height ?? (spec.kind === 'hall' ? 13 : spec.kind === 'pavilion' ? 5 : spec.kind === 'storehouse' ? 8.6 : 8.7);
    const key = `${spec.kind}:${spec.width}:${spec.depth}:${height}:${seed}`;
    return { key, seed, height };
  }

  return {
    build(spec) {
      if (disposed) throw new Error('The source architecture kit was disposed');
      if (!spec || !KINDS.has(spec.kind) || typeof spec.id !== 'string' || ![spec.width, spec.depth, spec.height ?? 1].every(v => Number.isFinite(v) && v > 0) || spec.width > 60 || spec.depth > 60) throw new Error('Invalid source architecture dimensions');
      const { key, seed, height } = archetype(spec);
      if (!prototypes.has(key)) {
        const root = spec.kind === 'hall' || spec.kind === 'pavilion' ? hallPrototype(spec.kind === 'pavilion') : cityPrototype(spec, seed);
        const bounds = fitPrototype(T, root, spec.width, spec.depth, height);
        root.userData.sourceAssetId = `${root.userData.sourceAsset.id}:${key}`;
        root.userData.sourceFit = bounds;
        prototypes.set(key, root);
      }
      const source = prototypes.get(key), group = source.clone(true);
      group.traverse(object => { if (object.isMesh) object.geometry = object.geometry.clone(); });
      group.userData = { ...group.userData, sourceGeometryOwner: 'caller', sourceMaterialOwner: 'architecture-kit' };
      builds++;
      return group;
    },
    stats() {
      return { profile, builds, prototypes: prototypes.size, ownedMaterials: ownedMaterials.size, components: [...prototypes.values()].map(root => ({ assetId: root.userData.sourceAssetId, source: root.userData.sourceAsset, ...countGeometry(root), bounds: root.userData.sourceFit })) };
    },
    setSourceTransform(inverse, forward, eye) {
      if (disposed) return;
      uniforms.uCrownfallSourceInverse.value.copy(inverse);
      uniforms.uCrownfallSourceRoot.value.copy(forward);
      uniforms.uCrownfallSourceScale.value = forward.getMaxScaleOnAxis();
      if (eye) uniforms.uCrownfallSourceCamera.value.copy(eye);
    },
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set();
      for (const root of prototypes.values()) root.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      for (const geometry of geometries) geometry.dispose();
      for (const material of ownedMaterials.values()) material.dispose();
      for (const material of templateMaterials) material.dispose();
      prototypes.clear(); ownedMaterials.clear(); templateMaterials.clear();
    },
  };
}
