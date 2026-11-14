// Shared source-world Crownfall dressing. Supplied Three namespace is platform-owned.
// Each world names where cloth hangs (<world>/banners.js). Everything here shares one
// atlas and a handful of merged meshes, so the dressing costs a few draw calls however
// many banners a world has, and a house change only re-uploads the atlas.
import { fillHeraldryAtlas } from '../environment/heraldry/adapter';
import { atlasUv, HERALDRY_ATLAS_SIZE } from '../environment/heraldry/atlas';
import { WORLD_KINGDOM_STYLE, worldAtlasHeraldry, worldAtlasKey } from './crownfall';

/** Height of the banner raster for a width of 1 (shared heraldry's banner aspect). */
const BANNER_ASPECT = 1.5;
const DEFAULT_TINT = { amount: .1, exclude: /sky|water|leaf|folia|grass|tree|flower|glass|fire|glow|cloud|moon|sun/ };

/** Compass bearing to a unit outward normal: 0 faces -Z (north), 90 faces +X (east). */
function facingNormal(deg) {
  const a = deg * Math.PI / 180;
  return [Math.sin(a), Math.cos(a) * -1];
}

class MeshAccumulator {
  positions = [];
  normals = [];
  indices = [];
  extra = {};
  vertex(x, y, z, nx, ny, nz) { this.positions.push(x, y, z); this.normals.push(nx, ny, nz); return this.positions.length / 3 - 1; }
  /** Upright box with flat normals; `side` is the horizontal unit direction of its sx edge. */
  box(cx, cy, cz, side, sx, sy, sz) {
    const [ax, az] = side, bx = -az, bz = ax;
    for (const s of [1, -1]) {
      this.quad([cx + s * ax * sx / 2, cz + s * az * sx / 2], [bx, bz], sz, cy, sy, [s * ax, 0, s * az], -s);
      this.quad([cx + s * bx * sz / 2, cz + s * bz * sz / 2], [ax, az], sx, cy, sy, [s * bx, 0, s * bz], s);
      const a = this.vertex(cx - ax * sx / 2 - bx * sz / 2, cy + s * sy / 2, cz - az * sx / 2 - bz * sz / 2, 0, s, 0);
      const b = this.vertex(cx + ax * sx / 2 - bx * sz / 2, cy + s * sy / 2, cz + az * sx / 2 - bz * sz / 2, 0, s, 0);
      const c = this.vertex(cx + ax * sx / 2 + bx * sz / 2, cy + s * sy / 2, cz + az * sx / 2 + bz * sz / 2, 0, s, 0);
      const d = this.vertex(cx - ax * sx / 2 + bx * sz / 2, cy + s * sy / 2, cz - az * sx / 2 + bz * sz / 2, 0, s, 0);
      if (s > 0) this.indices.push(a, c, b, a, d, c); else this.indices.push(a, b, c, a, c, d);
    }
  }
  quad([cx, cz], [ux, uz], width, cy, height, n, winding) {
    const a = this.vertex(cx - ux * width / 2, cy - height / 2, cz - uz * width / 2, ...n);
    const b = this.vertex(cx + ux * width / 2, cy - height / 2, cz + uz * width / 2, ...n);
    const c = this.vertex(cx + ux * width / 2, cy + height / 2, cz + uz * width / 2, ...n);
    const d = this.vertex(cx - ux * width / 2, cy + height / 2, cz - uz * width / 2, ...n);
    if (winding > 0) this.indices.push(a, b, c, a, c, d); else this.indices.push(a, c, b, a, d, c);
  }
  /** Tapered n-sided pole from y0 to y1. */
  pole(x, y0, y1, z, r0, r1, sides = 6) {
    const base = this.positions.length / 3;
    for (let i = 0; i <= sides; i++) {
      const t = i / sides * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      this.vertex(x + c * r0, y0, z + s * r0, c, 0, s);
      this.vertex(x + c * r1, y1, z + s * r1, c, 0, s);
    }
    for (let i = 0; i < sides; i++) { const a = base + i * 2; this.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  /** Eight-faced gem: finials and lamps. Taller than wide when `stretch` is above one. */
  gem(x, y, z, r, stretch = 1) {
    const top = [x, y + r * stretch, z], bottom = [x, y - r * stretch, z];
    const ring = [[r, 0], [0, r], [-r, 0], [0, -r]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 4];
      for (const [apex, sign] of [[top, 1], [bottom, -1]]) {
        const nx = (ax + bx) / r, nz = (az + bz) / r, ny = sign / Math.max(.2, stretch), l = Math.hypot(nx, ny, nz);
        const p = this.vertex(apex[0], apex[1], apex[2], nx / l, ny / l, nz / l);
        const q = this.vertex(x + ax, y, z + az, nx / l, ny / l, nz / l);
        const w = this.vertex(x + bx, y, z + bz, nx / l, ny / l, nz / l);
        if (sign > 0) this.indices.push(p, w, q); else this.indices.push(p, q, w);
      }
    }
  }
  build(T) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new T.BufferAttribute(new Float32Array(this.normals), 3));
    for (const [name, { data, size }] of Object.entries(this.extra)) g.setAttribute(name, new T.BufferAttribute(new Float32Array(data), size));
    g.setIndex(this.indices);
    return g;
  }
}

/**
 * Cloth hanging from its top edge at (x, y, z), facing the outward normal. Width runs along
 * the cloth, -Y hangs down; the same layout as the original Bannerhold's clothPanel, with
 * vertical pleats so a large hanging still reads as cloth rather than a poster.
 */
function pushCloth(acc, uv, x, y, z, normal, width, height, motion, seed, cols, rows) {
  const [nx, nz] = normal, ux = nz, uz = -nx;
  const [u0, v0, u1, v1] = uv;
  const base = acc.positions.length / 3;
  const pleats = 3;
  const depth = width * .018, sag = width * .018;
  acc.extra.uv ??= { data: [], size: 2 };
  acc.extra.aCloth ??= { data: [], size: 3 };
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const phase = u * pleats * Math.PI * 2 + seed;
      const out = Math.sin(u * Math.PI) * sag * v + Math.sin(phase) * depth * (.35 + .65 * v);
      const slope = Math.cos(phase) * depth * pleats * Math.PI * 2 / width * (.35 + .65 * v);
      const off = .012 * width + out, l = Math.hypot(1, slope);
      const px = x + ux * (u - .5) * width + nx * off, pz = z + uz * (u - .5) * width + nz * off;
      acc.vertex(px, y - v * height, pz, (nx - ux * slope) / l, 0, (nz - uz * slope) / l);
      acc.extra.uv.data.push(u0 + (u1 - u0) * u, v1 - (v1 - v0) * v);
      // Weight grows toward the free hem; phase travels across and down the cloth.
      acc.extra.aCloth.data.push(motion * width * Math.min(1, v * 1.1) * (.6 + .4 * Math.abs(u - .5) * 2), seed + u * 4.4 + v * 1.9, motion > 0 ? .34 : 0);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    acc.indices.push(d, e, b, d, b, a);
  }
}

/** Without per-world data: one standard per landmark, sized for the world. */
function landmarkSites(asset) {
  const scale = Math.max(.6, Math.min(2.8, asset.extent.width / 180));
  return asset.landmarks.map(l => ({ id: l.id, kind: 'standard', heraldry: 'player', position: l.position, width: 2.3 * scale, pole: 7 * scale }));
}

function clothShader(uniforms) {
  return shader => {
    shader.uniforms.uClothTime = uniforms.time;
    shader.uniforms.uClothAmount = uniforms.amount;
    shader.vertexShader = 'attribute vec3 aCloth;\nuniform float uClothTime;\nuniform float uClothAmount;\n' + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float clothWave = uClothTime + aCloth.y;
        objectNormal = normalize(objectNormal + normalize(cross(vec3(0., 1., 0.), objectNormal)) * cos(clothWave) * aCloth.z * uClothAmount);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += normal * sin(clothWave) * aCloth.x * uClothAmount;`);
  };
}

/** `relief`: the host shows this world as a miniature (Quest), where banners need more world size to read. */
export function dressWorld(T, asset, state, { relief = false } = {}) {
  const config = asset.heraldry ?? {};
  const sites = config.sites ?? landmarkSites(asset);
  const group = new T.Group(); group.name = 'Crownfall / house standards';

  const { width: atlasW, height: atlasH } = HERALDRY_ATLAS_SIZE;
  const pixels = new Uint8ClampedArray(atlasW * atlasH * 4);
  const texture = new T.DataTexture(pixels, atlasW, atlasH, T.RGBAFormat);
  texture.name = 'Crownfall house heraldry';
  texture.colorSpace = T.SRGBColorSpace;
  texture.flipY = true;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.anisotropy = 4;

  const clothUniforms = { time: { value: 0 }, amount: { value: 0 } };
  const clothMaterial = new T.MeshStandardMaterial({
    name: 'Crownfall cloth', map: texture, side: T.DoubleSide, roughness: .88, metalness: 0, alphaTest: .5,
    // A little of the cloth's own colour, standing in for light through the weave: heraldry
    // has to hold its tinctures when a world's sun sits behind the banner.
    emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: config.clothLift ?? .18, envMapIntensity: config.clothEnv ?? .55,
  });
  clothMaterial.onBeforeCompile = clothShader(clothUniforms);
  clothMaterial.customProgramCacheKey = () => 'crownfall-cloth-1';
  const metal = new T.MeshStandardMaterial({ name: 'Crownfall trim', metalness: .65, roughness: .42 });
  const timber = new T.MeshStandardMaterial({ name: 'Crownfall pole', roughness: .85 });
  const lamp = new T.MeshBasicMaterial({ name: 'Crownfall lamp' });

  const cloth = new MeshAccumulator(), poles = new MeshAccumulator(), trim = new MeshAccumulator(), lamps = new MeshAccumulator();
  const [vx, , vz] = asset.view.position;
  sites.forEach((site, index) => {
    const [x, y, z] = site.position;
    const grow = relief ? site.relief ?? config.reliefScale ?? 1 : 1;
    const width = site.width * grow, height = (site.height ?? site.width * BANNER_ASPECT) * grow;
    const normal = site.facing == null
      ? (() => { const dx = vx - x, dz = vz - z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; })()
      : facingNormal(site.facing);
    const along = [normal[1], -normal[0]];
    const tile = atlasUv(site.heraldry ?? 'player', 'banner');
    // Plain cloth from the middle of the tile, for valances that are not heraldic in proportion.
    const uv = site.plain ? [tile[0] + (tile[2] - tile[0]) * .25, tile[1] + (tile[3] - tile[1]) * .3, tile[2] - (tile[2] - tile[0]) * .25, tile[3] - (tile[3] - tile[1]) * .2] : tile;
    const seed = index * 1.37;
    if (site.kind === 'wall') {
      pushCloth(cloth, uv, x, y, z, normal, width, height, site.motion ?? .012, seed, 9, 6);
      const rod = width * .035;
      trim.box(x + normal[0] * rod, y + rod * .4, z + normal[1] * rod, along, width * 1.08, rod, rod);
      if (site.lamp) for (const s of [-1, 1]) lamps.gem(x + along[0] * s * width * .58 + normal[0] * rod, y + rod * .4, z + along[1] * s * width * .58 + normal[1] * rod, width * .05);
    } else {
      const top = y + site.pole * grow, bar = width * .04;
      poles.pole(x, y - Math.max(.3, site.pole * grow * .04), top, z, Math.max(.05, width * .03), Math.max(.035, width * .018));
      trim.box(x + normal[0] * bar, top - bar * 1.4, z + normal[1] * bar, along, width * 1.1, bar, bar);
      trim.gem(x, top + width * .1, z, width * .055, 2.2);
      lamps.gem(x, top + width * .32, z, width * .1);
      pushCloth(cloth, uv, x + normal[0] * bar, top - bar * 1.6, z + normal[1] * bar, normal, width, height, site.motion ?? .05, seed, 9, 6);
    }
  });
  const parts = [
    [cloth, clothMaterial, 'Crownfall / cloth', true],
    [poles, timber, 'Crownfall / poles', true],
    [trim, metal, 'Crownfall / trim', true],
    [lamps, lamp, 'Crownfall / lamps', false],
  ];
  const owned = [];
  for (const [acc, material, name, shadows] of parts) {
    if (!acc.indices.length) continue;
    const mesh = new T.Mesh(acc.build(T), material);
    mesh.name = name; mesh.castShadow = shadows; mesh.receiveShadow = shadows; mesh.frustumCulled = false;
    group.add(mesh); owned.push(mesh);
  }

  // The source's own cloth comes down where the house's cloth goes up.
  const hide = config.hideMaterials ? new Set(config.hideMaterials) : null;
  const hidden = [];
  // Materials the kingdom finish touches, with their source colours.
  const tint = config.tint === null ? null : { ...DEFAULT_TINT, ...config.tint };
  const tinted = new Map();
  asset.root.traverse(object => {
    const materials = object.material ? Array.isArray(object.material) ? object.material : [object.material] : [];
    if (hide && materials.some(m => hide.has(m.name))) { hidden.push([object, object.visible]); object.visible = false; }
    if (!tint) return;
    for (const m of materials) {
      if (!m.color || m.isShaderMaterial || tinted.has(m)) continue;
      if (tint.exclude.test(`${object.name} ${m.name}`.toLowerCase())) continue;
      tinted.set(m, m.color.clone());
    }
  });

  let atlasKey = null, nation = null, disposed = false;
  function setState(next) {
    if (disposed) return;
    state = next;
    const heraldry = worldAtlasHeraldry(next), key = worldAtlasKey(heraldry);
    if (key !== atlasKey) { atlasKey = key; fillHeraldryAtlas(pixels, heraldry); texture.needsUpdate = true; }
    if (next.nationId === nation) return;
    nation = next.nationId;
    const style = WORLD_KINGDOM_STYLE[nation];
    metal.color.set(style.trim);
    timber.color.set(style.pole);
    lamp.color.set(style.glow).multiplyScalar(config.lampGain ?? 1.4);
    if (tint) {
      const stone = new T.Color(style.stone);
      for (const [m, base] of tinted) m.color.copy(base).lerp(stone, tint.amount);
    }
  }
  setState(state);
  asset.root.add(group);

  let triangles = 0;
  for (const mesh of owned) triangles += mesh.geometry.index.count / 3;
  return {
    group,
    texture,
    setState,
    update(time, motion) { clothUniforms.time.value = time * 1.3; clothUniforms.amount.value = motion ? 1 : 0; },
    stats() { return { sites: sites.length, draws: owned.length, triangles, tinted: tinted.size, hidden: hidden.length }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [m, base] of tinted) m.color.copy(base);
      tinted.clear();
      for (const [object, visible] of hidden) object.visible = visible;
      hidden.length = 0;
      for (const mesh of owned) mesh.geometry.dispose();
      for (const m of [clothMaterial, metal, timber, lamp]) m.dispose();
      texture.dispose();
      group.clear();
      group.removeFromParent();
    },
  };
}
export function disposeSourceTree(root){
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of(o.material?Array.isArray(o.material)?o.material:[o.material]:[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);for(const u of Object.values(m.uniforms??{}))if(u?.value?.isTexture)textures.add(u.value);}});
  for(const x of textures)x.dispose();for(const x of materials)x.dispose();for(const x of geometries)x.dispose();root.removeFromParent();
}
