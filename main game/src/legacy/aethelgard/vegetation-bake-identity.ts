import {InterleavedBufferAttribute, Matrix3, type BufferGeometry, type Texture} from 'three';
import type {VegetationCapturePart} from './vegetation-atlas-capture';
import {worldBakeDigest} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';
/** Hash capture inputs, never runtime UUIDs or live environment illumination.
 * Texture pixels are required: mutable URLs/names alone cannot validate a bake.
 * Unsupported/tainted image sources fail to ordinary nonpersistent capture. */
export function createVegetationBakeIdentity() {
  const geometries = new WeakMap<BufferGeometry, {signature: string; references: unknown[]; digest: Promise<string>}>();
  const textures = new WeakMap<Texture, {version: number; image: unknown; digest: Promise<string>}>();
  async function textureIdentity(texture: Texture | null): Promise<unknown> {
    if (!texture) return null;
    const image = texture.image as {width?: unknown; height?: unknown; data?: unknown} | null;
    if (!image || typeof image.width !== 'number' || typeof image.height !== 'number'
      || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 16777216) throw Error('Texture has no bounded readable capture source.');
    const {width, height} = image;
    const old = textures.get(texture);
    const digest = old?.version === texture.version && old.image === texture.image ? old.digest : (async () => {
      let pixels: ArrayBufferView;
      if (ArrayBuffer.isView(image.data)) pixels = image.data;
      else {
        if (typeof OffscreenCanvas === 'undefined') throw Error('Texture pixel hashing is unavailable; use nonpersistent capture.');
        const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', {willReadFrequently: true});
        if (!context) throw Error('Texture pixel hashing context is unavailable.');
        context.drawImage(image as CanvasImageSource, 0, 0); pixels = context.getImageData(0, 0, width, height).data;
      }
      return worldBakeDigest(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
    })();
    textures.set(texture, {version: texture.version, image: texture.image, digest});
    const matrix = texture.matrixAutoUpdate ? new Matrix3().setUvTransform(texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y, texture.rotation, texture.center.x, texture.center.y) : texture.matrix;
    return [await digest, width, height,
      texture.type, texture.format, texture.internalFormat, texture.colorSpace, texture.flipY, texture.channel, texture.wrapS, texture.wrapT,
      texture.minFilter, texture.magFilter, texture.anisotropy, texture.premultiplyAlpha, [...matrix.elements]];
  }
  async function geometryIdentity(geometry: BufferGeometry): Promise<string> {
    const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
    const signature = attributes.map(([name, a]) => [name, a instanceof InterleavedBufferAttribute ? a.data.version : a.version, a.count, a.itemSize, a.normalized].join(':')).join('|') + ':' + (geometry.index?.version ?? -1);
    const references = [...attributes.map(([, a]) => a), geometry.index];
    const old = geometries.get(geometry); if (old?.signature === signature && old.references.every((a, i) => a === references[i])) return old.digest;
    const digest = (async () => {
      const channels = [];
      for (const [name, attribute] of attributes) {
        const values = attribute instanceof InterleavedBufferAttribute ? attribute.data.array : attribute.array;
        channels.push([name, attribute.itemSize, attribute.normalized, attribute instanceof InterleavedBufferAttribute ? [attribute.offset, attribute.data.stride] : null,
          values.constructor.name, await worldBakeDigest(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))]);
      }
      const index = geometry.index?.array;
      return worldBakeDigest(new TextEncoder().encode(JSON.stringify([channels, index ? [index.constructor.name, await worldBakeDigest(new Uint8Array(index.buffer, index.byteOffset, index.byteLength))] : null])));
    })();
    geometries.set(geometry, {signature, references, digest}); return digest;
  }
  return async (parts: readonly VegetationCapturePart[]) => {
    const records = [];
    for (const {geometry, material, frame, foliage} of parts) {
      const record:unknown[]=[await geometryIdentity(geometry), geometry.drawRange, geometry.groups, ...frame.elements.map(n => Math.round(n * 1e7) / 1e7), foliage,
        material.color.toArray(), material.alphaTest, material.side, material.vertexColors, material.normalMapType, material.normalScale.toArray(),
        await textureIdentity(material.map), await textureIdentity(material.alphaMap), await textureIdentity(material.normalMap)];
      // Opt in only for the generated regional restoration. Untagged authored,
      // PP3, Forest01 and scanned input records retain their exact prior bytes.
      const generated=material.userData.crownfallGeneratedFoliageNormalIdentity;
      if(typeof generated==='string'&&generated.length>0)record.push(['generated-foliage-normal',generated]);
      records.push(record);
    }
    return worldBakeDigest(new TextEncoder().encode(JSON.stringify(records)));
  };
}
