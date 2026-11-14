// Lighter copies of a GLB for the menu backdrops (U-05, Q-09): keep only the clips that play, re-encode chosen
// images smaller, and drop the bytes nothing references any more. Mesh data (including Draco-compressed
// primitives) is copied unchanged, so geometry, skin and the kept clips are byte-identical to the source.

const JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('Not a glTF 2.0 binary');
  let offset = 12, json, bin = Buffer.alloc(0);
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4), chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8'));
    else if (type === BIN_CHUNK) bin = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

export function writeGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const header = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0), 8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0); jsonHead.writeUInt32LE(JSON_CHUNK, 4);
  binHead.writeUInt32LE(binChunk.length, 0); binHead.writeUInt32LE(BIN_CHUNK, 4);
  return Buffer.concat([header, jsonHead, jsonChunk, ...(binChunk.length ? [binHead, binChunk] : [])]);
}

const accessorByteLength = (accessor) => {
  const component = COMPONENT_BYTES[accessor.componentType], count = TYPE_COUNT[accessor.type];
  if (!component || !count) throw new Error(`Unsupported accessor layout: ${accessor.componentType} ${accessor.type}`);
  return accessor.count * component * count;
};

/**
 * @param {Buffer} source GLB bytes.
 * @param {{ keepAnimations: readonly string[], images?: Record<string, { maxSize: number, quality: number }>,
 *   encodeImage?: (bytes: Buffer, mimeType: string, options: { maxSize: number, quality: number }) => Promise<Buffer> }} options
 *   `images` is keyed by image name; `encodeImage` returns the replacement bytes in the same format.
 */
export async function slimGlb(source, options) {
  const { json: original, bin } = readGlb(source);
  const json = structuredClone(original);
  if (json.buffers?.length > 1 || json.buffers?.some((buffer) => buffer.uri)) throw new Error('Only single-buffer GLBs are supported');
  const animations = (json.animations ?? []).filter((animation) => options.keepAnimations.includes(animation.name));
  const missing = options.keepAnimations.filter((name) => !animations.some((animation) => animation.name === name));
  if (missing.length) throw new Error(`GLB lacks the clips to keep: ${missing.join(', ')}`);
  json.animations = animations;
  if (!json.animations.length) delete json.animations;

  // Every accessor still referenced, in source order.
  const used = new Set();
  const use = (index) => { if (Number.isInteger(index)) used.add(index); };
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    Object.values(primitive.attributes).forEach(use); use(primitive.indices);
    for (const target of primitive.targets ?? []) Object.values(target).forEach(use);
  }
  for (const skin of json.skins ?? []) use(skin.inverseBindMatrices);
  for (const animation of animations) for (const sampler of animation.samplers) { use(sampler.input); use(sampler.output); }
  const accessorOrder = [...used].sort((a, b) => a - b), accessorMap = new Map(accessorOrder.map((old, index) => [old, index]));
  const remap = (index) => { if (!accessorMap.has(index)) throw new Error(`Accessor ${index} was dropped while still referenced`); return accessorMap.get(index); };
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(primitive.attributes[key]);
    if (Number.isInteger(primitive.indices)) primitive.indices = remap(primitive.indices);
    for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = remap(target[key]);
    // Draco's own attribute ids are decoder slots, not accessor indices: they stay as they are.
  }
  for (const skin of json.skins ?? []) if (Number.isInteger(skin.inverseBindMatrices)) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
  for (const animation of animations) for (const sampler of animation.samplers) { sampler.input = remap(sampler.input); sampler.output = remap(sampler.output); }
  json.accessors = accessorOrder.map((index) => structuredClone(original.accessors[index]));
  if (json.accessors.some((accessor) => accessor.sparse)) throw new Error('Sparse accessors are not supported');

  // New binary: views referenced by images or extensions are copied whole; views that only hold accessors keep
  // just the byte ranges those accessors still read.
  const chunks = [];
  let length = 0;
  const append = (bytes, alignment = 0) => {
    const pad = ((alignment - length) % 4 + 4) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    const start = length;
    chunks.push(bytes); length += bytes.length;
    return start;
  };
  const views = [], viewMap = new Map();
  const wholeView = (index, replacement) => {
    const view = original.bufferViews[index];
    const bytes = replacement ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const next = { ...view, buffer: 0, byteOffset: append(bytes), byteLength: bytes.length };
    views.push(next);
    return views.length - 1;
  };
  const encodedImages = [];
  for (const [imageIndex, image] of (json.images ?? []).entries()) {
    if (!Number.isInteger(image.bufferView)) continue;
    const view = original.bufferViews[image.bufferView], setting = options.images?.[image.name];
    let bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    if (setting) {
      if (!options.encodeImage) throw new Error('Image settings need an encodeImage function');
      bytes = await options.encodeImage(Buffer.from(bytes), image.mimeType, setting);
      encodedImages.push({ name: image.name, before: view.byteLength, after: bytes.length });
    }
    image.bufferView = wholeView(image.bufferView, bytes);
  }
  const extensionViews = new Set();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    const draco = primitive.extensions?.KHR_draco_mesh_compression;
    if (draco) extensionViews.add(draco.bufferView);
  }
  for (const index of [...extensionViews].sort((a, b) => a - b)) viewMap.set(index, wholeView(index));
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    const draco = primitive.extensions?.KHR_draco_mesh_compression;
    if (draco) draco.bufferView = viewMap.get(draco.bufferView);
  }
  const byView = new Map();
  for (const accessor of json.accessors) if (Number.isInteger(accessor.bufferView)) {
    if (!byView.has(accessor.bufferView)) byView.set(accessor.bufferView, []);
    byView.get(accessor.bufferView).push(accessor);
  }
  for (const [index, accessors] of [...byView].sort((a, b) => a[0] - b[0])) {
    const view = original.bufferViews[index], base = view.byteOffset ?? 0;
    if (view.byteStride && accessors.length) {
      // Interleaved data: keep the whole view rather than reason about strides.
      const next = wholeView(index);
      for (const accessor of accessors) accessor.bufferView = next;
      continue;
    }
    // Merge the ranges still read into segments, and copy each at the same alignment modulo four.
    const ranges = accessors.map((accessor) => [accessor.byteOffset ?? 0, (accessor.byteOffset ?? 0) + accessorByteLength(accessor)]).sort((a, b) => a[0] - b[0]);
    const segments = [];
    for (const [start, end] of ranges) {
      const last = segments.at(-1);
      if (last && start <= last.end) last.end = Math.max(last.end, end); else segments.push({ start, end });
    }
    // The view starts on four bytes; each segment keeps its source offset modulo four inside the view, so every
    // typed array three.js makes over the sliced view stays aligned.
    append(Buffer.alloc(0));
    const viewStart = length;
    let cursor = viewStart;
    for (const segment of segments) {
      const at = append(bin.subarray(base + segment.start, base + segment.end), segment.start);
      segment.offset = at - viewStart;
      cursor = at + segment.end - segment.start;
    }
    views.push({ buffer: 0, byteOffset: viewStart, byteLength: cursor - viewStart, ...(view.target ? { target: view.target } : {}) });
    const next = views.length - 1;
    for (const accessor of accessors) {
      const start = accessor.byteOffset ?? 0, segment = segments.find((item) => start >= item.start && start < item.end);
      accessor.bufferView = next;
      accessor.byteOffset = segment.offset + start - segment.start;
    }
  }
  json.bufferViews = views;
  const newBin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: newBin.length + (4 - newBin.length % 4) % 4 }];
  return { glb: writeGlb(json, newBin), report: { clips: animations.map((animation) => animation.name), accessors: [original.accessors.length, json.accessors.length], images: encodedImages, bytes: [source.length, newBin.length] } };
}
