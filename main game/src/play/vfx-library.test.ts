import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VFX_ATLASES, type VfxAtlas, type VfxEffectId } from "../../../web/src/scene/vfx/library";
import type { FlipbookTier } from "../../../web/src/scene/vfx/flipbookCore";
// Type-only: keeps the renderer module inside the desktop typecheck without loading Three.js here.
import type { FlipbookSystem, FlipbookSystemOptions } from "../../../web/src/scene/vfx/flipbook";

const ROOT = fileURLToPath(new URL("../../public/assets/play/vfx/", import.meta.url));

interface ManifestAtlas {
  id: VfxEffectId;
  frames: number;
  cols: number;
  rows: number;
  fps: number;
  loop: boolean;
  pivot: [number, number];
  additive: number;
  files: Record<FlipbookTier, string>;
  bytes: Record<FlipbookTier, number>;
  cell: Record<FlipbookTier, number>;
  atlas: Record<FlipbookTier, [number, number]>;
  pack: string;
  /** Crownfall's own simulations: the script and preset that made the frames. */
  sim?: string;
}
interface Manifest {
  license: string;
  source: { page: string; statement: string };
  packs: { name: string; url: string; sha256: string; bytes: number }[];
  own_simulations: { id: string; license: string; solver: string; scripts: string[]; reproduce: string };
  atlases: ManifestAtlas[];
}

const manifest = JSON.parse(readFileSync(`${ROOT}manifest.json`, "utf8")) as Manifest;

test("the VFX manifest and the code's atlas table agree", () => {
  assert.deepEqual(manifest.atlases.map((atlas) => atlas.id).sort(), Object.keys(VFX_ATLASES).sort());
  for (const baked of manifest.atlases) {
    const atlas: VfxAtlas = VFX_ATLASES[baked.id];
    assert.equal(atlas.frames, baked.frames, baked.id);
    assert.equal(atlas.cols, baked.cols, baked.id);
    assert.equal(atlas.rows, baked.rows, baked.id);
    assert.equal(atlas.loop, baked.loop, baked.id);
    assert.equal(atlas.fps, baked.fps, baked.id);
    assert.equal(atlas.additive, baked.additive, baked.id);
    assert.deepEqual([...atlas.pivot], baked.pivot, baked.id);
    assert.deepEqual({ ...atlas.files }, baked.files, baked.id);
  }
});

test("every atlas file is committed at the size the manifest records, and stays small", () => {
  let total = 0;
  for (const baked of manifest.atlases) {
    for (const tier of ["desktop", "quest"] as const) {
      const path = ROOT + baked.files[tier];
      assert.ok(existsSync(path), path);
      assert.equal(statSync(path).size, baked.bytes[tier], path);
      assert.deepEqual(baked.atlas[tier], [baked.cols * baked.cell[tier], baked.rows * baked.cell[tier]]);
      // RIFF....WEBP
      const head = readFileSync(path).subarray(0, 12);
      assert.equal(head.toString("latin1", 0, 4) + head.toString("latin1", 8, 12), "RIFFWEBP", path);
      total += baked.bytes[tier];
    }
    assert.equal(baked.cell.desktop, 256);
    assert.equal(baked.cell.quest, 128);
  }
  assert.ok(total < 4 * 1024 * 1024, `atlases total ${total} bytes`);
});

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const OWN = ["dust", "scuff", "smokePuff", "smoke"];

test("provenance: CC0 packs with a hash each, or one of our own simulations with its script committed", () => {
  assert.equal(manifest.license, "CC0-1.0");
  assert.match(manifest.source.page, /^https:\/\/jangafx\.com\//);
  assert.match(manifest.source.statement, /CC0 \(Public Domain\)/);
  for (const pack of manifest.packs) {
    assert.match(pack.url, /^https:\/\/www\.mediafire\.com\/file\//);
    assert.match(pack.sha256, /^[0-9a-f]{64}$/);
    assert.ok(pack.bytes > 0);
  }
  const names = new Set(manifest.packs.map((pack) => pack.name));
  const own = manifest.own_simulations;
  assert.match(own.solver, /Mantaflow/);
  for (const script of own.scripts) assert.ok(existsSync(REPO + script), script);
  const presets = readFileSync(`${REPO}scripts/vfx/sim_gas.py`, "utf8");
  for (const baked of manifest.atlases) {
    if (baked.pack !== own.id) { assert.ok(names.has(baked.pack), `${baked.id} comes from ${baked.pack}`); assert.equal(baked.sim, undefined); continue; }
    // "scripts/vfx/sim_gas.py <effect>": the script is committed and has that preset.
    const [script, effect] = (baked.sim ?? "").split(" ");
    assert.ok(own.scripts.includes(script), `${baked.id}: ${baked.sim}`);
    assert.ok(presets.includes(`'${effect}': dict(`), `${baked.id}: no preset ${effect}`);
  }
  // Dust, the scuff, powder smoke and the mist are ours: none of them is cut from the ground explosion any more.
  assert.deepEqual(manifest.atlases.filter((baked) => baked.pack === own.id).map((baked) => baked.id).sort(), [...OWN].sort());
  assert.ok(existsSync(fileURLToPath(new URL("../../public/licenses/JangaFX-EmberGen-VDB-CC0.txt", import.meta.url))));
});

test("the renderer's public surface is what the integration notes promise", () => {
  // Compile-time only: these fail the typecheck, not the run, if the API drifts.
  type Surface = Pick<FlipbookSystem, "group" | "spawn" | "play" | "release" | "update" | "setQuality" | "setGround" | "setDepth" | "clear" | "dispose" | "preload">;
  const options: FlipbookSystemOptions = { baseUrl: "assets/play/vfx/", quality: "high" };
  const surface: Surface | null = null;
  assert.equal(surface, null);
  assert.equal(options.quality, "high");
});
