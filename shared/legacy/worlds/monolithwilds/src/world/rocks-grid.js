// Fast approximate ground heights for bulk placement queries.
//
// Reuses the terrain module's 9 m world grid (ctx.terrain.grid: heightAt() sampled at
// x0 + i * step, stored as Float32) when it is available. Without it (e.g. `terrain-basic` test
// runs) the same lattice is filled lazily with heightAt(), so the values — and therefore every
// placement decision — are identical either way. Exact heightAt() stays in use for the anchor
// point of each object; the grid answers "what does the land look like around here".

const N = 1025;
const X0 = -4600;
const STEP = 9200 / 1024;

export function createHeightGrid(ctx) {
  const tg = ctx.terrain?.grid;
  const shared = !!(tg && tg.n === N && tg.x0 === X0 && tg.z0 === X0 && Math.abs(tg.step - STEP) < 1e-9 && tg.data?.length === N * N);
  const data = shared ? tg.data : new Float32Array(N * N);
  const filled = shared ? null : new Uint8Array(N * N);
  const H = ctx.heightAt;
  let computed = 0;

  const node = (i, j) => {
    const k = j * N + i;
    if (filled && !filled[k]) {
      data[k] = H(X0 + i * STEP, X0 + j * STEP);
      filled[k] = 1;
      computed++;
    }
    return data[k];
  };

  /** Bilinear height from the lattice (clamped to the world square). */
  function at(x, z) {
    let fx = (x - X0) / STEP;
    let fz = (z - X0) / STEP;
    fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const a = node(i, j) + (node(i + 1, j) - node(i, j)) * tx;
    const b = node(i, j + 1) + (node(i + 1, j + 1) - node(i, j + 1)) * tx;
    return a + (b - a) * tz;
  }

  return {
    at,
    shared,
    get computed() {
      return computed;
    },
  };
}
