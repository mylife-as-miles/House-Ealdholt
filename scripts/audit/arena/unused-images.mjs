import fs from "node:fs";
for (const file of process.argv.slice(2)) {
const fd = fs.openSync(file, "r"); const head = Buffer.alloc(20); fs.readSync(fd, head, 0, 20, 0);
const jsonLen = head.readUInt32LE(12); const jb = Buffer.alloc(jsonLen); fs.readSync(fd, jb, 0, jsonLen, 20); const json = JSON.parse(jb.toString("utf8")); fs.closeSync(fd);
const combos = {}; const usedImages = { gpu: new Set(), decodedOnly: new Set() }; let vlitNoColor = 0, lmWithColor = 0; const matInstances = { vlit: 0, lm: 0 }; const vlitUniqueSrc = new Set();
let visTris = 0, visPrims = 0, lmTris = 0, vlitTris = 0, maskPrims = 0, maskTris = 0;
const imgOf = (ti) => ti === undefined ? undefined : json.textures[ti].source;
for (const n of json.nodes) {
  if (n.mesh === undefined) continue; const moss = /MossShell/i.test(n.name ?? "");
  for (const p of json.meshes[n.mesh].primitives) {
    const m = json.materials[p.material]; const pbr = m.pbrMetallicRoughness ?? {};
    const hasColor = p.attributes.COLOR_0 !== undefined; const tris = json.accessors[p.indices].count / 3;
    const imgs = { base: imgOf(pbr.baseColorTexture?.index), mr: imgOf(pbr.metallicRoughnessTexture?.index), n: imgOf(m.normalTexture?.index) };
    const key = `${moss ? "MOSS " : ""}vlit=${n.extras?.cf_vlit ?? "-"} lm_mode=${n.extras?.cf_lm_mode} base=${imgs.base !== undefined ? "tex(uv" + (pbr.baseColorTexture.texCoord ?? 0) + ")" : "none"} mr=${imgs.mr !== undefined} nrm=${imgs.n !== undefined} color0=${hasColor} alpha=${m.alphaMode ?? "OPAQUE"}`;
    combos[key] ??= { prims: 0, tris: 0, mats: new Set() }; combos[key].prims++; combos[key].tris += tris; combos[key].mats.add(p.material);
    if (moss) { for (const i of Object.values(imgs)) if (i !== undefined) usedImages.decodedOnly.add(i); continue; }
    visTris += tris; visPrims++;
    if (m.alphaMode === "MASK") { maskPrims++; maskTris += tris; }
    if (n.extras?.cf_vlit) { vlitTris += tris; matInstances.vlit++; vlitUniqueSrc.add(p.material); if (!hasColor) vlitNoColor++; if (imgs.base !== undefined) usedImages.gpu.add(imgs.base); for (const i of [imgs.mr, imgs.n]) if (i !== undefined) usedImages.decodedOnly.add(i); }
    else { lmTris += tris; if (hasColor) lmWithColor++; for (const i of Object.values(imgs)) if (i !== undefined) usedImages.gpu.add(i); }
  }
}
for (const i of usedImages.gpu) usedImages.decodedOnly.delete(i);
console.log("=====", file.split("/").slice(-2).join("/"));
for (const [k, v] of Object.entries(combos)) console.log(String(v.prims).padStart(4), String(v.tris).padStart(8), "mats:" + v.mats.size, k);
console.log(JSON.stringify({ visiblePrims: visPrims, visibleTris: visTris, lightmappedTris: lmTris, vertexLitTris: vlitTris, vlitPrimsWithoutCOLOR_0: vlitNoColor, lmPrimsWithCOLOR_0: lmWithColor, vlitMaterialInstancesCreated: matInstances.vlit, vlitUniqueSourceMaterials: vlitUniqueSrc.size, imagesTotal: json.images.length, imagesUploadedToGPU: [...usedImages.gpu].sort((a, b) => a - b), imagesDecodedButNeverRendered: [...usedImages.decodedOnly].sort((a, b) => a - b), maskPrims, maskTris }));
}
