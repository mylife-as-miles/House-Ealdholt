/**
 * The ground round a pool of lava, seen from above: the height of the highest surface over each cell of a small grid.
 * The look's pools are flat discs laid over the terrain. Where the terrain stands above a disc it hides the lava, and
 * that line is the pool's real shore; where the terrain falls away under a disc (one reaches out over the abyss)
 * there is nothing to hold lava at all. Both are read from this grid when the pools are rebuilt
 * (arena-lava-geometry.ts buildPool). Plain numbers, no WebGL.
 */

export interface Ground {
  x0: number; z0: number;
  /** Metres across one cell. */
  cell: number;
  columns: number; rows: number;
  /** The highest surface over each cell's centre, or -Infinity where there is none. */
  height: Float32Array;
}

export function createGround(x0: number, z0: number, x1: number, z1: number, cell: number): Ground {
  const columns = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((z1 - z0) / cell));
  return { x0, z0, cell, columns, rows, height: new Float32Array(columns * rows).fill(-Infinity) };
}

/** Lays one triangle over the grid: every cell whose centre it covers takes its height there, if that is higher. */
export function rasterTriangle(ground: Ground, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number): void {
  const { x0, z0, cell, columns, rows, height } = ground;
  const minX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell - 0.5)), maxX = Math.min(columns - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell - 0.5));
  const minZ = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell - 0.5)), maxZ = Math.min(rows - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell - 0.5));
  if (minX > maxX || minZ > maxZ) return;
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  // a wall seen from above is a line: it covers no cell's centre
  if (Math.abs(det) < 1e-9) return;
  for (let j = minZ; j <= maxZ; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = minX; i <= maxX; i++) {
      const x = x0 + (i + 0.5) * cell;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, w = 1 - u - v;
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
      const y = u * ay + v * by + w * cy;
      if (y > height[j * columns + i]) height[j * columns + i] = y;
    }
  }
}

/** Metres from each cell's centre to the nearest cell chosen by `chosen` (0 in a chosen cell). */
export function distanceToCells(ground: Ground, chosen: (height: number) => boolean): Float32Array {
  const { columns, rows, cell, height } = ground;
  const field = new Float32Array(columns * rows);
  for (let i = 0; i < field.length; i++) field[i] = chosen(height[i]) ? 0 : Infinity;
  const diagonal = Math.SQRT2 * cell;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= columns || j >= rows ? Infinity : field[j * columns + i]);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    field[j * columns + i] = Math.min(field[j * columns + i], at(i - 1, j) + cell, at(i, j - 1) + cell, at(i - 1, j - 1) + diagonal, at(i + 1, j - 1) + diagonal);
  }
  for (let j = rows - 1; j >= 0; j--) for (let i = columns - 1; i >= 0; i--) {
    field[j * columns + i] = Math.min(field[j * columns + i], at(i + 1, j) + cell, at(i, j + 1) + cell, at(i + 1, j + 1) + diagonal, at(i - 1, j + 1) + diagonal);
  }
  return field;
}

/** A field of the grid at a point, blended from the four cells round it. Outside the grid it is `outside`. */
export function sampleField(ground: Ground, field: Float32Array, x: number, z: number, outside = Infinity): number {
  const { x0, z0, cell, columns, rows } = ground;
  const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5;
  if (fx < -0.5 || fz < -0.5 || fx > columns - 0.5 || fz > rows - 0.5) return outside;
  const i0 = Math.min(columns - 1, Math.max(0, Math.floor(fx))), j0 = Math.min(rows - 1, Math.max(0, Math.floor(fz)));
  const i1 = Math.min(columns - 1, i0 + 1), j1 = Math.min(rows - 1, j0 + 1);
  const tx = Math.min(1, Math.max(0, fx - i0)), tz = Math.min(1, Math.max(0, fz - j0));
  const a = field[j0 * columns + i0], b = field[j0 * columns + i1], c = field[j1 * columns + i0], d = field[j1 * columns + i1];
  // a cell with nothing to measure to is infinitely far: take the nearer cell's word instead of blending with it
  const pick = (p: number, q: number, t: number) => (Number.isFinite(p) && Number.isFinite(q) ? p + (q - p) * t : t < 0.5 ? p : q);
  return pick(pick(a, b, tx), pick(c, d, tx), tz);
}

/**
 * What the ground makes of a pool whose surface is at `level`: for any point, metres to the nearest rock standing in
 * the lava, and metres to the nearest place with nothing under the lava within `deep` metres (negative inside such a
 * place, by how far in it is).
 */
export function poolGround(ground: Ground, level: number, deep: number): { rock(x: number, z: number): number; held(x: number, z: number): number } {
  const rock = distanceToCells(ground, (height) => height >= level - 0.03);
  const toVoid = distanceToCells(ground, (height) => height < level - deep);
  const toHeld = distanceToCells(ground, (height) => height >= level - deep);
  return {
    rock: (x, z) => sampleField(ground, rock, x, z),
    held: (x, z) => {
      const out = sampleField(ground, toVoid, x, z);
      return out > 0 ? out : -sampleField(ground, toHeld, x, z, 0);
    },
  };
}
