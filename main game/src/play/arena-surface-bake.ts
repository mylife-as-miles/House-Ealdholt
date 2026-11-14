/** The low tier's way of lighting the baked environment: the sky's fill and the lava's light are added to the bake
 * itself, once, when the arena starts, so the frames after it cost nothing more than before. For the lightmapped
 * meshes the light is drawn into their lightmap on the GPU (each mesh laid out flat by its lightmap coordinates); for
 * the vertex-lit meshes it is added to their vertex colours. The lava's light is then still (it does not flicker). */
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

const LUMA = [0.2126, 0.7152, 0.0722];
const WHITE = new THREE.Color(1, 1, 1);

/** What a mesh needs for its share of the bake. */
export interface BakeMesh {
  mesh: THREE.Mesh;
  /** Which stretches of lava reach it, one bit each. */
  mask: number;
  /** How much of the light it takes: 0 for metal (no diffuse light), less than 1 for the moss shells. */
  share: number;
  /** Its material's colour and colour map: on a pale surface the added light eases off (`paleEase`). */
  color?: THREE.Color;
  map?: THREE.Texture | null;
}

/**
 * Returns a copy of `lightmap` with light added to every texel the meshes cover. `pars` declares
 * `vec3 cfBakedLight(vec3 position, vec3 normal, int mask)`: the light arriving at a place, in the lightmap's units;
 * `uniforms` are what it reads. A texel keeps `floor` of that light where the lightmap is black, rising with the
 * logarithm of the lightmap's value to all of it at 2^hi (see arenaOpenness in arena-surface-data.ts). Where the
 * lightmap is bright the added light eases off (by `ease` per unit of baked light) and what is left of it takes the
 * lightmap's own colour, as in the per-pixel shader: added in full, it turned pale stone chalky. The caller owns the
 * returned target.
 */
export function bakeLightIntoLightmap(renderer: THREE.WebGLRenderer, lightmap: THREE.Texture, meshes: readonly BakeMesh[],
  options: { pars: string; uniforms: Record<string, THREE.IUniform>; floor: number; lo: number; hi: number; ease?: number; paleEase?: number }): THREE.WebGLRenderTarget {
  const { width, height } = lightmap.image as { width: number; height: number };
  const target = () => new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  // 1. the light alone, each mesh drawn flat in lightmap space (alpha marks the texels a mesh covers)
  const own = { uCfBakeMask: { value: 0 }, uCfBakeShare: { value: 1 }, uCfBakeMap: { value: null as THREE.Texture | null },
                uCfBakeHasMap: { value: 0 }, uCfBakeColor: { value: new THREE.Color(1, 1, 1) }, uCfBakePale: { value: options.paleEase ?? 0 } };
  const flat = new THREE.ShaderMaterial({
    uniforms: { ...options.uniforms, ...own },
    vertexShader: /* glsl */ `
      attribute vec2 uv1; varying vec3 vP, vN; varying vec2 vUv0;
      void main() {
        vP = (modelMatrix * vec4(position, 1.0)).xyz; vN = mat3(modelMatrix) * normal; vUv0 = uv;
        gl_Position = vec4(uv1 * 2.0 - 1.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vP, vN; varying vec2 vUv0; uniform int uCfBakeMask; uniform float uCfBakeShare, uCfBakeHasMap, uCfBakePale;
      uniform sampler2D uCfBakeMap; uniform vec3 uCfBakeColor;
      ${options.pars}
      void main() {
        // on a pale surface the light eases off, as in the per-pixel shader (pale stone went chalky)
        vec3 albedo = (uCfBakeHasMap > 0.5 ? texture2D(uCfBakeMap, vUv0).rgb : vec3(1.0)) * uCfBakeColor;
        float pale = 1.0 / (1.0 + max(dot(albedo, vec3(${LUMA.join(", ")})) - 0.12, 0.0) * uCfBakePale);
        gl_FragColor = vec4(cfBakedLight(vP, normalize(vN), uCfBakeMask) * (uCfBakeShare * pale), 1.0);
      }`,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  for (const entry of meshes) {
    if (!entry.mesh.geometry.attributes.uv1) continue;
    const twin = new THREE.Mesh(entry.mesh.geometry, flat);
    twin.matrixAutoUpdate = false;
    twin.matrixWorldAutoUpdate = false;
    twin.matrixWorld.copy(entry.mesh.matrixWorld);
    twin.frustumCulled = false;
    twin.onBeforeRender = () => {
      own.uCfBakeMask.value = entry.mask; own.uCfBakeShare.value = entry.share;
      own.uCfBakeMap.value = entry.map ?? null; own.uCfBakeHasMap.value = entry.map ? 1 : 0;
      own.uCfBakeColor.value.copy(entry.color ?? WHITE);
      flat.uniformsNeedUpdate = true;
    };
    scene.add(twin);
  }
  const light = target(), spread = target(), result = target();
  // 2. spread the light two texels past each mesh's edge: a lightmap is read between texels, and a texel just outside
  // a mesh would otherwise bring an unlit seam in. 3. add it to the lightmap.
  const pass = new FullScreenQuad();
  const dilate = new THREE.ShaderMaterial({
    uniforms: { tLight: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2(1 / width, 1 / height) } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D tLight; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tLight, vUv);
        if (c.a < 0.5) {
          vec4 sum = vec4(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 n = texture2D(tLight, vUv + vec2(float(x), float(y)) * uTexel);
            if (n.a > 0.5) sum += vec4(n.rgb, 1.0);
          }
          c = sum.a > 0.0 ? vec4(sum.rgb / sum.a, 1.0) : vec4(0.0);
        }
        gl_FragColor = c;
      }`,
    depthTest: false, depthWrite: false,
  });
  const add = new THREE.ShaderMaterial({
    uniforms: { tLight: { value: null as THREE.Texture | null }, tLightmap: { value: lightmap }, uFloor: { value: options.floor },
                uOpen: { value: new THREE.Vector2(options.lo, options.hi) }, uEase: { value: options.ease ?? 0 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D tLight, tLightmap; uniform float uFloor, uEase; uniform vec2 uOpen; varying vec2 vUv;
      void main() {
        vec3 baked = texture2D(tLightmap, vUv).rgb;
        float lum = max(dot(baked, vec3(${LUMA.join(", ")})), 0.0);
        // dark in the bake means little of the sky reaches the place
        float open = mix(uFloor, 1.0, clamp((log2(max(lum, 1e-7)) - uOpen.x) / (uOpen.y - uOpen.x), 0.0, 1.0));
        float ease = 1.0 / (1.0 + lum * uEase);
        vec3 light = texture2D(tLight, vUv).rgb;
        vec3 hue = mix(vec3(1.0), min(max(baked, 0.0) / max(lum, 1e-5), vec3(4.0)), 0.4);
        light = mix(light, dot(light, vec3(${LUMA.join(", ")})) * hue, 1.0 - ease);
        gl_FragColor = vec4(baked + light * (open * ease), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const before = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, alpha: renderer.getClearAlpha(), color: renderer.getClearColor(new THREE.Color()) };
  // the spread reads single texels
  light.texture.minFilter = light.texture.magFilter = spread.texture.minFilter = spread.texture.magFilter = THREE.NearestFilter;
  try {
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(light); renderer.render(scene, camera);
    pass.material = dilate;
    dilate.uniforms.tLight.value = light.texture; renderer.setRenderTarget(spread); pass.render(renderer);
    dilate.uniforms.tLight.value = spread.texture; renderer.setRenderTarget(light); pass.render(renderer);
    pass.material = add;
    add.uniforms.tLight.value = light.texture; renderer.setRenderTarget(result); pass.render(renderer);
  } finally {
    renderer.setRenderTarget(before.target);
    renderer.autoClear = before.autoClear;
    renderer.setClearColor(before.color, before.alpha);
    scene.clear();
    light.dispose(); spread.dispose(); flat.dispose(); dilate.dispose(); add.dispose(); pass.dispose();
  }
  // the copy stands in for the lightmap: same coordinates (the second UV set), same meaning
  result.texture.channel = lightmap.channel;
  result.texture.colorSpace = lightmap.colorSpace;
  result.texture.name = `${lightmap.name || "lightmap"} + arena light`;
  return result;
}

/**
 * Adds light to a vertex-lit mesh's colours. The colours hold baked light divided by `scale` ("light"), or, where
 * `albedo` is given, base colour times light divided by `scale`; there `albedo` gives the brightness and the colour
 * half its hue (the colour's hue is the surface's, but also the baked light's: orange beside the lava). `light` writes the light arriving at a place with a normal, in world space;
 * `open` turns the baked light's luminance into the share of it that lands. The colours become half floats so that
 * the sum keeps its precision. Where the baked light is bright the added light eases off (by `ease` per unit of
 * baked light) and turns toward the colour's own hue, and where the albedo is known and pale it eases off too (by
 * `paleEase` per unit of albedo above 0.12), as in the per-pixel shader.
 */
export function addLightToVertexColours(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, options: {
  scale: number; albedo: readonly number[] | null; open(luma: number): number; ease?: number; paleEase?: number;
  light(position: THREE.Vector3, normal: THREE.Vector3, out: number[]): void;
}): boolean {
  const colors = geometry.attributes.color as THREE.BufferAttribute | undefined;
  const positions = geometry.attributes.position as THREE.BufferAttribute | undefined;
  const normals = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  if (!colors || !positions || !normals) return false;
  const size = colors.itemSize, count = colors.count;
  const out = new Uint16Array(count * size);
  const m = matrixWorld.elements, nm = new THREE.Matrix3().getNormalMatrix(matrixWorld).elements;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), light = [0, 0, 0], albedo = [1, 1, 1];
  const albedoLuma = options.albedo ? Math.max(1e-4, LUMA[0] * options.albedo[0] + LUMA[1] * options.albedo[1] + LUMA[2] * options.albedo[2]) : 1;
  // The arena's vertex-lit meshes hold some two million vertices: read their arrays directly where they are plain
  // (they are, as the loader leaves them), and through the attributes' accessors where they are not.
  const plain = (attribute: THREE.BufferAttribute) => !(attribute as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute;
  const pa = plain(positions) && !positions.normalized ? positions.array : null, ps = positions.itemSize;
  const na = plain(normals) && !normals.normalized ? normals.array : null, ns = normals.itemSize;
  const ca = plain(colors) ? colors.array : null;
  const cs = !colors.normalized ? 1 : ca instanceof Uint16Array ? 1 / 65535 : ca instanceof Uint8Array ? 1 / 255 : 0;
  for (let i = 0; i < count; i++) {
    if (pa) {
      const x = pa[i * ps], y = pa[i * ps + 1], z = pa[i * ps + 2];
      p.set(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    } else p.fromBufferAttribute(positions, i).applyMatrix4(matrixWorld);
    if (na) {
      const x = na[i * ns], y = na[i * ns + 1], z = na[i * ns + 2];
      const nx = nm[0] * x + nm[3] * y + nm[6] * z, ny = nm[1] * x + nm[4] * y + nm[7] * z, nz = nm[2] * x + nm[5] * y + nm[8] * z;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz || 1);
      n.set(nx * inv, ny * inv, nz * inv);
    } else n.fromBufferAttribute(normals, i).applyMatrix3(new THREE.Matrix3().fromArray(nm)).normalize();
    options.light(p, n, light);
    const r = ca && cs ? ca[i * size] * cs : colors.getX(i), g = ca && cs ? ca[i * size + 1] * cs : colors.getY(i), b = ca && cs ? ca[i * size + 2] * cs : colors.getZ(i);
    const own = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    if (options.albedo) {
      if (own > 1e-6) {
        albedo[0] = albedoLuma * (0.5 + 0.5 * Math.min(Math.max(r, 0) / own, 3));
        albedo[1] = albedoLuma * (0.5 + 0.5 * Math.min(Math.max(g, 0) / own, 3));
        albedo[2] = albedoLuma * (0.5 + 0.5 * Math.min(Math.max(b, 0) / own, 3));
      } else {
        albedo[0] = options.albedo[0]; albedo[1] = options.albedo[1]; albedo[2] = options.albedo[2];
      }
    }
    // the baked light: the colour times the scale, over the albedo where the colour holds both
    const baked = own * options.scale / albedoLuma, ease = 1 / (1 + baked * (options.ease ?? 0));
    if (ease < 1 && own > 1e-6) {
      const lum = LUMA[0] * light[0] + LUMA[1] * light[1] + LUMA[2] * light[2];
      light[0] += (lum * (0.6 + 0.4 * Math.min(Math.max(r, 0) / own, 4)) - light[0]) * (1 - ease);
      light[1] += (lum * (0.6 + 0.4 * Math.min(Math.max(g, 0) / own, 4)) - light[1]) * (1 - ease);
      light[2] += (lum * (0.6 + 0.4 * Math.min(Math.max(b, 0) / own, 4)) - light[2]) * (1 - ease);
    }
    const pale = options.albedo ? 1 / (1 + Math.max(LUMA[0] * albedo[0] + LUMA[1] * albedo[1] + LUMA[2] * albedo[2] - 0.12, 0) * (options.paleEase ?? 0)) : 1;
    const share = options.open(baked) * ease * pale / options.scale;
    out[i * size] = THREE.DataUtils.toHalfFloat(r + light[0] * share * albedo[0]);
    out[i * size + 1] = THREE.DataUtils.toHalfFloat(g + light[1] * share * albedo[1]);
    out[i * size + 2] = THREE.DataUtils.toHalfFloat(b + light[2] * share * albedo[2]);
    if (size === 4) out[i * size + 3] = THREE.DataUtils.toHalfFloat(colors.getW(i));
  }
  geometry.setAttribute("color", new THREE.Float16BufferAttribute(out, size));
  return true;
}
