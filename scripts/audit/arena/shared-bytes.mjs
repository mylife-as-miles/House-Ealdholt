import fs from "node:fs"; import crypto from "node:crypto";
function load(file) { const fd = fs.openSync(file, "r"); const head = Buffer.alloc(20); fs.readSync(fd, head, 0, 20, 0); const jl = head.readUInt32LE(12); const jb = Buffer.alloc(jl); fs.readSync(fd, jb, 0, jl, 20); const json = JSON.parse(jb.toString("utf8")); const binOff = 20 + jl + 8;
  const kind = {}; for (const m of json.meshes) for (const p of m.primitives) { for (const [k, a] of Object.entries(p.attributes)) kind[json.accessors[a].bufferView] = k; kind[json.accessors[p.indices].bufferView] = "INDEX"; } for (const im of json.images ?? []) kind[im.bufferView] = "IMAGE";
  const out = new Map(); for (const [i, bv] of json.bufferViews.entries()) { const b = Buffer.alloc(bv.byteLength); fs.readSync(fd, b, 0, bv.byteLength, binOff + (bv.byteOffset ?? 0)); const h = crypto.createHash("md5").update(b).digest("hex"); out.set(h, { kind: kind[i] ?? "?", bytes: bv.byteLength }); } fs.closeSync(fd); return out; }
const [a, b] = process.argv.slice(2).map(load);
const shared = {}, onlyA = {}, onlyB = {};
for (const [h, v] of a) { const t = b.has(h) ? shared : onlyA; t[v.kind] = (t[v.kind] ?? 0) + v.bytes; }
for (const [h, v] of b) if (!a.has(h)) onlyB[v.kind] = (onlyB[v.kind] ?? 0) + v.bytes;
const mb = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / 1e6).toFixed(1)]));
const sum = o => +(Object.values(o).reduce((s, v) => s + v, 0) / 1e6).toFixed(1);
console.log(JSON.stringify({ identicalMB: sum(shared), identicalByKind: mb(shared), onlyInFirstMB: sum(onlyA), onlyInFirst: mb(onlyA), onlyInSecondMB: sum(onlyB), onlyInSecond: mb(onlyB) }));
// internal duplicates within second file
