import fs from "node:fs";
const file = process.argv[2];
const fd = fs.openSync(file, "r");
const size = fs.fstatSync(fd).size;
const head = Buffer.alloc(20);
fs.readSync(fd, head, 0, 20, 0);
const magic = head.toString("ascii", 0, 4), version = head.readUInt32LE(4), total = head.readUInt32LE(8);
const jsonLen = head.readUInt32LE(12), jsonType = head.toString("ascii", 16, 20);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
const json = JSON.parse(jsonBuf.toString("utf8"));
const binHeaderOff = 20 + jsonLen;
const bh = Buffer.alloc(8); fs.readSync(fd, bh, 0, 8, binHeaderOff);
const binLen = bh.readUInt32LE(0); const binOff = binHeaderOff + 8;
const out = { file, size, magic, version, total, jsonLen, jsonType, binLen };
out.asset = json.asset;
out.extensionsUsed = json.extensionsUsed; out.extensionsRequired = json.extensionsRequired;
out.scenes = json.scenes?.length; out.nodes = json.nodes?.length; out.meshes = json.meshes?.length;
out.materials = json.materials?.length; out.textures = json.textures?.length; out.images = json.images?.length;
out.samplers = json.samplers?.length; out.accessors = json.accessors?.length; out.bufferViews = json.bufferViews?.length;
out.animations = json.animations?.length; out.skins = json.skins?.length; out.cameras = json.cameras?.length;
// primitives
let prims = 0, tris = 0, verts = 0; const modes = {}; const attrSets = {}; const idxTypes = {};
const primsPerMat = {}; let primNoIndex = 0;
const meshTris = [];
const posAccessors = new Set(); const idxAccessors = new Set();
for (const [mi, m] of (json.meshes ?? []).entries()) {
  let mt = 0;
  for (const p of m.primitives) {
    prims++;
    const mode = p.mode ?? 4; modes[mode] = (modes[mode] ?? 0) + 1;
    const pos = json.accessors[p.attributes.POSITION];
    const key = Object.keys(p.attributes).sort().join(","); attrSets[key] = (attrSets[key] ?? 0) + 1;
    let t;
    if (p.indices !== undefined) { const ia = json.accessors[p.indices]; t = ia.count / 3; idxTypes[ia.componentType] = (idxTypes[ia.componentType] ?? 0) + 1; idxAccessors.add(p.indices); }
    else { t = pos.count / 3; primNoIndex++; }
    if (mode === 4) { tris += t; mt += t; }
    if (!posAccessors.has(p.attributes.POSITION)) { verts += pos.count; posAccessors.add(p.attributes.POSITION); }
    primsPerMat[p.material ?? -1] = (primsPerMat[p.material ?? -1] ?? 0) + 1;
    if (p.extensions) out.primExt = Object.keys(p.extensions);
  }
  meshTris.push({ mi, name: m.name, prims: m.primitives.length, tris: mt });
}
out.primitives = prims; out.triangles = tris; out.uniqueVertices = verts; out.modes = modes; out.attrSets = attrSets; out.idxComponentTypes = idxTypes; out.primNoIndex = primNoIndex;
out.uniquePositionAccessors = posAccessors.size;
// nodes referencing meshes (instances)
let meshNodes = 0; const meshUse = {}; let instTris = 0; let instPrims = 0;
const nameHits = { MossShell: 0 }; let mossTris = 0, mossPrims = 0, mossNodes=[];
const parentOf = {}; for (const [i, n] of (json.nodes ?? []).entries()) for (const c of n.children ?? []) parentOf[c] = i;
function underMoss(i) { let c = i; while (c !== undefined) { if (/MossShell/i.test(json.nodes[c].name ?? "")) return true; c = parentOf[c]; } return false; }
let vlitNodes = 0; const extrasKeys = {};
for (const [i, n] of (json.nodes ?? []).entries()) {
  if (n.extras) for (const k of Object.keys(n.extras)) extrasKeys[k] = (extrasKeys[k] ?? 0) + 1;
  if (n.mesh !== undefined) {
    meshNodes++; meshUse[n.mesh] = (meshUse[n.mesh] ?? 0) + 1;
    instTris += meshTris[n.mesh].tris; instPrims += meshTris[n.mesh].prims;
    if (underMoss(i)) { mossTris += meshTris[n.mesh].tris; mossPrims += meshTris[n.mesh].prims; mossNodes.push(n.name); }
    if (n.extras?.cf_vlit) vlitNodes++;
  }
  if (n.extensions) out.nodeExt = Object.keys(n.extensions);
}
out.meshNodes = meshNodes; out.drawCallsIfAllVisible = instPrims; out.instancedTriangles = instTris;
out.meshesUsedMoreThanOnce = Object.values(meshUse).filter((c) => c > 1).length;
out.maxMeshReuse = Math.max(0, ...Object.values(meshUse));
out.moss = { nodes: mossNodes.length, prims: mossPrims, tris: mossTris, sample: mossNodes.slice(0, 5) };
out.nodeExtrasKeys = extrasKeys; out.vlitNodes = vlitNodes;
const meshExtras = {}; for (const m of json.meshes ?? []) if (m.extras) for (const k of Object.keys(m.extras)) meshExtras[k] = (meshExtras[k] ?? 0) + 1;
out.meshExtrasKeys = meshExtras;
// top meshes by tris
out.topMeshes = meshTris.sort((a, b) => b.tris - a.tris).slice(0, 12);
out.primsHistogram = { lt100: 0, lt1k: 0, lt10k: 0, lt100k: 0, ge100k: 0 };
// materials
const mats = (json.materials ?? []).map((m, i) => ({ i, name: m.name, base: m.pbrMetallicRoughness?.baseColorTexture?.index, baseFactor: m.pbrMetallicRoughness?.baseColorFactor, mr: m.pbrMetallicRoughness?.metallicRoughnessTexture?.index, metal: m.pbrMetallicRoughness?.metallicFactor, rough: m.pbrMetallicRoughness?.roughnessFactor, normal: m.normalTexture?.index, occ: m.occlusionTexture?.index, emis: m.emissiveTexture?.index, emisF: m.emissiveFactor, alpha: m.alphaMode, cutoff: m.alphaCutoff, ds: m.doubleSided, ext: m.extensions ? Object.keys(m.extensions) : undefined, prims: primsPerMat[i] ?? 0, tc: [m.pbrMetallicRoughness?.baseColorTexture?.texCoord, m.normalTexture?.texCoord, m.occlusionTexture?.texCoord] }));
out.materialsDetail = mats;
// images
const imgs = [];
for (const [i, im] of (json.images ?? []).entries()) {
  const rec = { i, name: im.name, mime: im.mimeType, uri: im.uri ? im.uri.slice(0, 40) : undefined };
  if (im.bufferView !== undefined) {
    const bv = json.bufferViews[im.bufferView];
    rec.bytes = bv.byteLength;
    const off = binOff + (bv.byteOffset ?? 0);
    const b = Buffer.alloc(Math.min(bv.byteLength, 65536)); fs.readSync(fd, b, 0, b.length, off);
    if (b[0] === 0x89 && b[1] === 0x50) { rec.fmt = "png"; rec.w = b.readUInt32BE(16); rec.h = b.readUInt32BE(20); rec.bitDepth = b[24]; rec.colorType = b[25]; }
    else if (b[0] === 0xff && b[1] === 0xd8) { rec.fmt = "jpeg"; let p = 2; while (p < b.length - 9) { if (b[p] !== 0xff) { p++; continue; } const mk = b[p + 1]; if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { rec.h = b.readUInt16BE(p + 5); rec.w = b.readUInt16BE(p + 7); rec.comps = b[p + 9]; break; } p += 2 + b.readUInt16BE(p + 2); } }
    else if (b.toString("ascii", 0, 4) === "RIFF") { rec.fmt = "webp"; }
    else if (b[0] === 0xab && b.toString("ascii", 1, 4) === "KTX") { rec.fmt = "ktx2"; rec.w = b.readUInt32LE(20); rec.h = b.readUInt32LE(24); }
    else rec.fmt = "unknown:" + b.slice(0, 8).toString("hex");
  }
  imgs.push(rec);
}
out.imagesDetail = imgs;
out.imageBytesTotal = imgs.reduce((s, r) => s + (r.bytes ?? 0), 0);
out.texturesDetail = (json.textures ?? []).map((t, i) => ({ i, source: t.source, sampler: t.sampler, ext: t.extensions ? Object.keys(t.extensions) : undefined }));
out.samplersDetail = json.samplers;
// buffer usage by accessor type
const byAttr = {};
function accBytes(a) { const comp = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]; const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]; return a.count * comp * n; }
const seenAcc = new Set();
for (const m of json.meshes ?? []) for (const p of m.primitives) { for (const [k, ai] of Object.entries(p.attributes)) { if (seenAcc.has(ai)) continue; seenAcc.add(ai); const a = json.accessors[ai]; const key = `${k}:${a.componentType}:${a.type}${a.normalized ? ":norm" : ""}`; byAttr[key] = (byAttr[key] ?? 0) + accBytes(a); } if (p.indices !== undefined && !seenAcc.has(p.indices)) { seenAcc.add(p.indices); const a = json.accessors[p.indices]; const key = `INDEX:${a.componentType}`; byAttr[key] = (byAttr[key] ?? 0) + accBytes(a); } }
out.geometryBytesByAttribute = byAttr;
out.geometryBytesTotal = Object.values(byAttr).reduce((s, v) => s + v, 0);
// prim size histogram
for (const m of json.meshes ?? []) for (const p of m.primitives) { const t = p.indices !== undefined ? json.accessors[p.indices].count / 3 : json.accessors[p.attributes.POSITION].count / 3; const h = out.primsHistogram; if (t < 100) h.lt100++; else if (t < 1000) h.lt1k++; else if (t < 10000) h.lt10k++; else if (t < 100000) h.lt100k++; else h.ge100k++; }
fs.closeSync(fd);
if (process.argv[3] === "full") console.log(JSON.stringify(out, null, 1));
else { const { materialsDetail, imagesDetail, texturesDetail, samplersDetail, ...rest } = out; console.log(JSON.stringify(rest, null, 1)); }
