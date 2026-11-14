import fs from "node:fs";
const file = process.argv[2];
const fd = fs.openSync(file, "r"); const head = Buffer.alloc(20); fs.readSync(fd, head, 0, 20, 0);
const jsonLen = head.readUInt32LE(12); const jb = Buffer.alloc(jsonLen); fs.readSync(fd, jb, 0, jsonLen, 20); const json = JSON.parse(jb.toString("utf8")); fs.closeSync(fd);
const rows = [];
let gmin = [1e9, 1e9, 1e9], gmax = [-1e9, -1e9, -1e9];
for (const n of json.nodes) { if (n.mesh === undefined) continue; const m = json.meshes[n.mesh]; let tris = 0, verts = 0; let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const p of m.primitives) { tris += json.accessors[p.indices].count / 3; const a = json.accessors[p.attributes.POSITION]; verts += a.count; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]); } }
  const s = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0];
  const size = max.map((v, i) => Math.abs((v - min[i]) * s[i]));
  for (let i = 0; i < 3; i++) { gmin[i] = Math.min(gmin[i], t[i] - size[i]); gmax[i] = Math.max(gmax[i], t[i] + size[i]); }
  rows.push({ name: n.name, tris, verts, prims: m.primitives.length, size: size.map(v => +v.toFixed(1)), t: t.map(v => +v.toFixed(1)), dist: +Math.hypot(t[0], t[2]).toFixed(0), vlit: n.extras?.cf_vlit, dec: n.extras?.cfcl_decimated_from, asset: n.extras?.cfcl_asset, role: n.extras?.Crownfall_role ?? n.extras?.geology_role });
}
rows.sort((a, b) => b.tris - a.tris);
for (const r of rows.slice(0, +(process.argv[3] ?? 14))) console.log(JSON.stringify(r));
console.log("approx world bounds (export metres, before 1/2.3)", gmin.map(v => +v.toFixed(0)), gmax.map(v => +v.toFixed(0)));
// tris by distance band from origin (export metres)
const bands = [[0, 15], [15, 40], [40, 100], [100, 300], [300, 1e9]]; for (const [a, b] of bands) { const sel = rows.filter(r => r.dist >= a && r.dist < b); console.log(`dist ${a}-${b}m: nodes ${sel.length}, tris ${sel.reduce((s, r) => s + r.tris, 0)}`); }
// duplicates: meshes with identical tri+vert counts
const sig = {}; for (const r of rows) { const k = r.tris + ":" + r.verts; (sig[k] ??= []).push(r.name); }
const dups = Object.entries(sig).filter(([, v]) => v.length > 1); console.log("groups of nodes with identical tri/vertex counts (instancing candidates):", dups.length, "covering nodes:", dups.reduce((s, [, v]) => s + v.length, 0), "tris:", dups.reduce((s, [k, v]) => s + (+k.split(":")[0]) * v.length, 0)); for (const [k, v] of dups.sort((a, b) => b[1].length * +b[0].split(":")[0] - a[1].length * +a[0].split(":")[0]).slice(0, 8)) console.log("  ", k, "x" + v.length, v.slice(0, 3).join(", "));
