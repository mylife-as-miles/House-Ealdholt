/** A source-derived far-grass surface field. Inputs are captured source patches
 * and their existing actor frames; this never scatters or moves vegetation.
 * Filtering is linear and premultiplied until the final texture is published. */
export interface GrassGroundPatch {
  readonly id: string;
  readonly matrix: readonly number[];
  readonly bounds: readonly [number, number, number, number]; // local x/z
  readonly pixels: Uint8Array;
  readonly normals: Uint8Array;
  readonly size: number;
  /** Local authored base, rather than the clump's canopy centre. */
  readonly groundY?: number;
}
export interface GrassGroundField {
  readonly resolution: number;
  readonly bounds: readonly [number, number, number, number];
  readonly colour: Uint8Array;
  readonly normal: Uint8Array;
  readonly height: Float32Array;
  readonly sourcePatches: number;
}
export function buildGrassGroundField(input: {
  readonly resolution: number; readonly bounds: readonly [number, number, number, number];
  readonly patches: readonly GrassGroundPatch[];
}): GrassGroundField {
  const {resolution, bounds} = input, [x0, z0, x1, z1] = bounds;
  if (![64, 128, 256, 512].includes(resolution) || !bounds.every(Number.isFinite) || x1 <= x0 || z1 <= z0 ||
      input.patches.length > 65536) throw Error('Invalid far-grass field budget.');
  const colour = new Float32Array(resolution * resolution * 4), normal = new Float32Array(colour.length), height = new Float32Array(resolution * resolution);
  const dx = (x1 - x0) / resolution, dz = (z1 - z0) / resolution;
  const ordered = [...input.patches].sort((a, b) => a.id.localeCompare(b.id));
  let visited = 0;
  for (let index = 0; index < ordered.length; index++) {
    const patch = ordered[index], m = patch.matrix, b = patch.bounds;
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1 || !patch.id || index > 0 && ordered[index - 1].id === patch.id || m.length !== 16 || !m.every(Number.isFinite) ||
        ![16, 32, 64, 128].includes(patch.size) || patch.pixels.length !== patch.size * patch.size * 4 ||
        patch.normals.length !== patch.pixels.length || patch.groundY !== undefined && !Number.isFinite(patch.groundY) ||
        !b.every(Number.isFinite) || b[2] <= b[0] || b[3] <= b[1]) throw Error('Invalid source grass patch.');
    const determinant = m[0] * m[10] - m[8] * m[2];
    if (Math.abs(determinant) < 1e-10) throw Error('Source grass patch has a collapsed terrain footprint.');
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let corner = 0; corner < 4; corner++) {
      const x = corner & 1 ? b[2] : b[0], z = corner & 2 ? b[3] : b[1];
      const wx = m[0] * x + m[8] * z + m[12], wz = m[2] * x + m[10] * z + m[14];
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
    }
    const loX = Math.max(0, Math.floor((minX - x0) / dx)), hiX = Math.min(resolution - 1, Math.floor((maxX - x0) / dx));
    const loZ = Math.max(0, Math.floor((minZ - z0) / dz)), hiZ = Math.min(resolution - 1, Math.floor((maxZ - z0) / dz));
    visited += Math.max(0, hiX - loX + 1) * Math.max(0, hiZ - loZ + 1);
    if (visited > 16777216) throw Error('Far-grass raster work exceeds its worker budget.');
    // Cofactors transform the captured source normal correctly under nonuniform
    // scale, yaw, slope and lean. Translation never participates in normals.
    const cofactor = [m[5] * m[10] - m[9] * m[6], m[9] * m[2] - m[1] * m[10], m[1] * m[6] - m[5] * m[2],
      m[8] * m[6] - m[4] * m[10], m[0] * m[10] - m[8] * m[2], m[4] * m[2] - m[0] * m[6],
      m[4] * m[9] - m[8] * m[5], m[8] * m[1] - m[0] * m[9], m[0] * m[5] - m[4] * m[1]];
    const determinant3 = m[0] * cofactor[0] + m[4] * cofactor[1] + m[8] * cofactor[2];
    if (Math.abs(determinant3) < 1e-10) throw Error('Source grass normal frame is singular.');
    const sign = determinant3 < 0 ? -1 : 1;
    for (let z = loZ; z <= hiZ; z++) for (let x = loX; x <= hiX; x++) {
      const wx = x0 + (x + .5) * dx - m[12], wz = z0 + (z + .5) * dz - m[14];
      const lx = (m[10] * wx - m[8] * wz) / determinant, lz = (-m[2] * wx + m[0] * wz) / determinant;
      const u = (lx - b[0]) / (b[2] - b[0]), v = 1 - (lz - b[1]) / (b[3] - b[1]);
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const sample = (Math.min(patch.size - 1, Math.floor(v * patch.size)) * patch.size + Math.floor(u * patch.size)) * 4;
      const alpha = patch.pixels[sample + 3] / 255, dst = (z * resolution + x) * 4;
      if (!alpha) continue;
      const baseY = m[1] * lx + m[5] * (patch.groundY ?? 0) + m[9] * lz + m[13];
      if (!Number.isFinite(Math.fround(baseY))) throw Error('Source grass height exceeds its field budget.');
      height[z * resolution + x] = baseY * alpha + height[z * resolution + x] * (1 - alpha);
      for (let channel = 0; channel < 3; channel++) colour[dst + channel] = patch.pixels[sample + channel] / 255 * alpha + colour[dst + channel] * (1 - alpha);
      colour[dst + 3] = alpha + colour[dst + 3] * (1 - alpha);
      const nx = patch.normals[sample] / 127.5 - 1, ny = patch.normals[sample + 1] / 127.5 - 1, nz = patch.normals[sample + 2] / 127.5 - 1;
      const tx = sign * (cofactor[0] * nx + cofactor[1] * ny + cofactor[2] * nz), ty = sign * (cofactor[3] * nx + cofactor[4] * ny + cofactor[5] * nz),
        tz = sign * (cofactor[6] * nx + cofactor[7] * ny + cofactor[8] * nz), length = Math.hypot(tx, ty, tz) || 1;
      normal[dst] = tx / length * alpha + normal[dst] * (1 - alpha); normal[dst + 1] = ty / length * alpha + normal[dst + 1] * (1 - alpha);
      normal[dst + 2] = tz / length * alpha + normal[dst + 2] * (1 - alpha);
    }
  }
  const rgb = new Uint8Array(colour.length), normals = new Uint8Array(colour.length);
  for (let i = 0; i < colour.length; i += 4) {
    const alpha = colour[i + 3], length = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
    height[i / 4] /= Math.max(alpha, 1e-8);
    for (let channel = 0; channel < 3; channel++) {rgb[i + channel] = Math.round(colour[i + channel] / Math.max(alpha, 1e-8) * 255); normals[i + channel] = Math.round((normal[i + channel] / length * .5 + .5) * 255);}
    rgb[i + 3] = normals[i + 3] = Math.round(alpha * 255);
  }
  return {resolution, bounds, colour: rgb, normal: normals, height, sourcePatches: ordered.length};
}
