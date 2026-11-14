import fs from "node:fs";
import { EXRLoader } from "../../../main game/node_modules/three/examples/jsm/loaders/EXRLoader.js";
import { HalfFloatType } from "../../../main game/node_modules/three/build/three.module.js";
const [glb, exrFile] = process.argv.slice(2);
const exrBuf = fs.readFileSync(exrFile);
const t0 = performance.now();
const tex = new EXRLoader().setDataType(HalfFloatType).parse(exrBuf.buffer.slice(exrBuf.byteOffset, exrBuf.byteOffset + exrBuf.byteLength));
const decodeMs = performance.now() - t0;
const { data, width: W, height: H } = tex; const ch = data.length / (W * H);
const isZero = (x, y) => { const i = (y * W + x) * ch; return (data[i] & 0x7fff) === 0 && (data[i + 1] & 0x7fff) === 0 && (data[i + 2] & 0x7fff) === 0; };
let zero = 0, alphaZero = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (isZero(x, y)) zero++; if (ch === 4 && (data[(y * W + x) * 4 + 3] & 0x7fff) === 0) alphaZero++; }
console.log(JSON.stringify({ exr: exrFile.split("/").slice(-2).join("/"), decodeMs: Math.round(decodeMs), W, H, ch, dataBytes: data.byteLength, type: data.constructor.name, zeroRGBTexelsPct: +(100 * zero / (W * H)).toFixed(1), alphaZeroPct: +(100 * alphaZero / (W * H)).toFixed(1) }));
const fd = fs.openSync(glb, "r"); const head = Buffer.alloc(20); fs.readSync(fd, head, 0, 20, 0);
const jsonLen = head.readUInt32LE(12); const jb = Buffer.alloc(jsonLen); fs.readSync(fd, jb, 0, jsonLen, 20); const json = JSON.parse(jb.toString("utf8"));
const binOff = 20 + jsonLen + 8;
function readAcc(ai) { const a = json.accessors[ai]; const bv = json.bufferViews[a.bufferView]; const comp = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]; const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]; if (bv.byteStride && bv.byteStride !== comp * n) throw new Error("stride"); const len = a.count * comp * n; const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, binOff + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)); const ab = b.buffer.slice(b.byteOffset, b.byteOffset + len); return a.componentType === 5126 ? new Float32Array(ab) : a.componentType === 5125 ? new Uint32Array(ab) : a.componentType === 5123 ? new Uint16Array(ab) : new Uint8Array(ab); }
const tot = { area: 0, zeroCur: 0, zeroFlip: 0, tris: 0, trisZeroCur: 0, trisZeroFlip: 0, outside: 0 };
const rows = [];
for (const n of json.nodes) {
  if (n.mesh === undefined || n.extras?.cf_vlit || /MossShell/i.test(n.name ?? "")) continue;
  const s = n.scale ?? [1, 1, 1];
  const r = { name: n.name, tile: n.extras?.cf_lm_tile, area: 0, zeroCur: 0, zeroFlip: 0, tris: 0, umin: 9, umax: -9, vmin: 9, vmax: -9 };
  for (const p of json.meshes[n.mesh].primitives) {
    const uv = readAcc(p.attributes.TEXCOORD_1), pos = readAcc(p.attributes.POSITION), idx = readAcc(p.indices);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ax = pos[a * 3] * s[0], ay = pos[a * 3 + 1] * s[1], az = pos[a * 3 + 2] * s[2];
      const e1x = pos[b * 3] * s[0] - ax, e1y = pos[b * 3 + 1] * s[1] - ay, e1z = pos[b * 3 + 2] * s[2] - az;
      const e2x = pos[c * 3] * s[0] - ax, e2y = pos[c * 3 + 1] * s[1] - ay, e2z = pos[c * 3 + 2] * s[2] - az;
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x; const area = 0.5 * Math.hypot(cx, cy, cz);
      const u = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, v = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
      for (const k of [a, b, c]) { r.umin = Math.min(r.umin, uv[k * 2]); r.umax = Math.max(r.umax, uv[k * 2]); r.vmin = Math.min(r.vmin, uv[k * 2 + 1]); r.vmax = Math.max(r.vmax, uv[k * 2 + 1]); }
      r.tris++; r.area += area;
      if (u < 0 || u > 1 || v < 0 || v > 1) { tot.outside++; }
      const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
      const yCur = Math.min(H - 1, Math.max(0, Math.floor(v * H)));       // as the game samples: GL v -> data row
      const yFlip = Math.min(H - 1, Math.max(0, Math.floor((1 - v) * H)));
      if (isZero(x, yCur)) { r.zeroCur += area; tot.trisZeroCur++; }
      if (isZero(x, yFlip)) { r.zeroFlip += area; tot.trisZeroFlip++; }
    }
  }
  tot.area += r.area; tot.zeroCur += r.zeroCur; tot.zeroFlip += r.zeroFlip; tot.tris += r.tris; rows.push(r);
}
fs.closeSync(fd);
console.log(JSON.stringify({ glb: glb.split("/").slice(-2).join("/"), lightmappedNodes: rows.length, tris: tot.tris, outsideUV: tot.outside, areaZeroPct_asLoaded: +(100 * tot.zeroCur / tot.area).toFixed(2), areaZeroPct_ifFlippedV: +(100 * tot.zeroFlip / tot.area).toFixed(2), trisZero_asLoaded: tot.trisZeroCur, trisZero_ifFlipped: tot.trisZeroFlip }));
rows.sort((a, b) => b.zeroCur - a.zeroCur);
for (const r of rows.slice(0, +(process.argv[4] ?? 12))) console.log(r.name, "tris", r.tris, "area", r.area.toFixed(1), "zero%", (100 * r.zeroCur / r.area).toFixed(1), "flipZero%", (100 * r.zeroFlip / r.area).toFixed(1), "uv", [r.umin, r.umax, r.vmin, r.vmax].map(x => x.toFixed(3)).join(","), "tile", JSON.stringify(r.tile));
