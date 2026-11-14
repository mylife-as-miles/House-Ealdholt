import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FlipbookSystem } from "./flipbook";
import { FLIPBOOK_BUDGET, FLIPBOOK_FIELD, FLIPBOOK_STRIDE } from "./flipbookCore";
import { VFX_ATLASES, VFX_RECIPES, type VfxEffectId } from "./library";
import { vfxCue, type VfxFlags } from "./wiring";

/** A loader whose images never arrive: the pools and buffers are what is under test. */
const loader = { loadAsync: () => new Promise<THREE.Texture>(() => undefined) } as unknown as THREE.TextureLoader;
const system = (quality: "low" | "medium" | "high" | "ultra" = "high") => new FlipbookSystem({ baseUrl: "vfx/", quality, loader });
const layer = (vfx: FlipbookSystem, effect: VfxEffectId) => vfx.group.children.find(child => child.name === `flipbook:${effect}`) as THREE.InstancedMesh;
/** The floats of every live slot of an atlas. */
function slots(vfx: FlipbookSystem, effect: VfxEffectId): number[][] {
  const mesh = layer(vfx, effect);
  const data = (mesh.geometry.getAttribute("aTransform") as THREE.InterleavedBufferAttribute).data.array as Float32Array;
  const out: number[][] = [];
  for (let slot = 0; slot < data.length / FLIPBOOK_STRIDE; slot++) {
    const row = Array.from(data.subarray(slot * FLIPBOOK_STRIDE, (slot + 1) * FLIPBOOK_STRIDE));
    if (row[FLIPBOOK_FIELD.timing + 2] > 0) out.push(row);
  }
  return out;
}
const flags = (over: Partial<VfxFlags> = {}): VfxFlags => ({ quality: "high", reducedMotion: false, tactical: false, menuBoard: false, ...over });

describe("the scene's flipbook system, as the duels drive it", () => {
  it("plays a whole recipe, or only its first sprites when asked", () => {
    const vfx = system();
    vfx.play("fallDust", new THREE.Vector3(1, 0, 2));
    expect(vfx.active).toBe(VFX_RECIPES.fallDust.length);
    vfx.play("arcaneBurst", new THREE.Vector3(), { parts: 2 });
    expect(vfx.active).toBe(VFX_RECIPES.fallDust.length + 2);
    vfx.play("arcaneBurst", new THREE.Vector3(), { parts: 0 });
    expect(vfx.active).toBe(VFX_RECIPES.fallDust.length + 2);
    vfx.dispose();
  });

  it("holds a still puff under reduced motion: one frame, no drift, growth or spin, gone in half a second", () => {
    const vfx = system();
    const cue = vfxCue("fall", flags({ reducedMotion: true }))!;
    vfx.play(cue.recipe, new THREE.Vector3(0, 0, 0), { scale: cue.scale, alpha: cue.alpha, parts: cue.parts, still: cue.still, direction: new THREE.Vector3(1, 0, 0) });
    const [puff, ...rest] = slots(vfx, "dust");
    expect(rest).toHaveLength(0);
    const motion = puff.slice(FLIPBOOK_FIELD.motion, FLIPBOOK_FIELD.motion + 4);
    expect(motion).toEqual([0, 0, 0, 0]);
    expect(puff[FLIPBOOK_FIELD.timing + 1]).toBe(0);                         // frames per second
    expect(puff[FLIPBOOK_FIELD.timing + 2]).toBeLessThanOrEqual(0.5);         // life
    expect(puff[FLIPBOOK_FIELD.timing + 3]).toBeGreaterThan(0);               // a frame part-way in, not the empty first one
    expect(puff[FLIPBOOK_FIELD.timing + 3]).toBeLessThan(VFX_ATLASES.dust.frames - 1);
    expect(puff[FLIPBOOK_FIELD.look + 1]).toBe(0);                            // spin
    expect(puff[FLIPBOOK_FIELD.fade]).toBeGreaterThan(0);
    expect(puff[FLIPBOOK_FIELD.fade + 1]).toBeGreaterThan(0);
    vfx.update(0.51);
    expect(vfx.active).toBe(0);
    vfx.dispose();
  });

  it("drifts musket smoke along the shot, in the powder's colour", () => {
    const vfx = system();
    const aim = new THREE.Vector3(0, 0, -1);
    vfx.play("musketSmoke", new THREE.Vector3(0, 0.6, 0), { direction: aim, tint: new THREE.Color(0.5, 0.5, 0.5) });
    const [billow] = slots(vfx, "smokePuff");
    expect(billow[FLIPBOOK_FIELD.motion + 2]).toBeLessThan(0);
    expect(billow[FLIPBOOK_FIELD.motion]).toBe(0);
    expect(billow[FLIPBOOK_FIELD.tint]).toBeCloseTo(VFX_RECIPES.musketSmoke[0].tint[0] * 0.5, 5);
    vfx.dispose();
  });

  it("dims lit smoke by the scene's light and fire by its own measure, blending the two for soot and fireball", () => {
    const vfx = system();
    vfx.play("fallDust", new THREE.Vector3(), { light: 0.25, glow: 0.5, parts: 1 });
    vfx.play("arcaneBurst", new THREE.Vector3(), { light: 0.25, glow: 0.5, parts: 2 });
    const [dust] = slots(vfx, "dust"), [flare] = slots(vfx, "flare"), [soot] = slots(vfx, "explosion");
    expect(dust[FLIPBOOK_FIELD.tint]).toBeCloseTo(VFX_RECIPES.fallDust[0].tint[0] * 0.25, 5);
    // Additive 1: the glow. The arcane recipe overrides the explosion's additive to 1 as well.
    expect(flare[FLIPBOOK_FIELD.tint + 2]).toBeCloseTo(VFX_RECIPES.arcaneBurst[1].tint[2] * 0.5, 5);
    expect(soot[FLIPBOOK_FIELD.tint + 2]).toBeCloseTo(VFX_RECIPES.arcaneBurst[0].tint[2] * 0.5, 5);
    // The blast keeps the atlas's own blend (0.35): 0.65 of the light and 0.35 of the glow.
    vfx.clear();
    vfx.play("blast", new THREE.Vector3(), { light: 0.25, glow: 0.5 });
    expect(slots(vfx, "explosion")[0][FLIPBOOK_FIELD.tint]).toBeCloseTo(VFX_RECIPES.blast[0].tint[0] * (0.65 * 0.25 + 0.35 * 0.5), 5);
    // No light given: as baked.
    vfx.clear();
    vfx.play("fallDust", new THREE.Vector3(), { parts: 1 });
    expect(slots(vfx, "dust")[0][FLIPBOOK_FIELD.tint]).toBeCloseTo(VFX_RECIPES.fallDust[0].tint[0], 5);
    vfx.dispose();
  });

  it("recolours every layer of a burst in the one colour, each at its own brightness", () => {
    const vfx = system();
    const colour = new THREE.Color(0.57, 0.9, 1);
    vfx.play("arcaneBurst", new THREE.Vector3(), { colour, glow: 0.5 });
    const layers = [...slots(vfx, "explosion"), ...slots(vfx, "flare")];
    expect(layers).toHaveLength(VFX_RECIPES.arcaneBurst.length);
    for (const layer of layers) {
      const blue = layer[FLIPBOOK_FIELD.tint + 2];
      // Blue is each layer's strongest channel and the colour's: the layer keeps its brightness and takes the hue.
      expect(VFX_RECIPES.arcaneBurst.some((part) => Math.abs(part.tint[2] * 0.5 - blue) < 1e-5)).toBe(true);
      expect(layer[FLIPBOOK_FIELD.tint] / blue).toBeCloseTo(0.57, 5);
      expect(layer[FLIPBOOK_FIELD.tint + 1] / blue).toBeCloseTo(0.9, 5);
    }
    // Without a colour the recipe's own tints stand.
    vfx.clear();
    vfx.play("arcaneBurst", new THREE.Vector3(), { parts: 1 });
    expect(slots(vfx, "explosion")[0][FLIPBOOK_FIELD.tint]).toBeCloseTo(VFX_RECIPES.arcaneBurst[0].tint[0], 5);
    vfx.dispose();
  });

  it("gives the mist loop an end of its own, so nothing has to be released", () => {
    const vfx = system();
    const cue = vfxCue("mist", flags(), { army: "sun", seconds: 1 })!;
    vfx.play(cue.recipe, new THREE.Vector3(), { scale: cue.scale, alpha: cue.alpha, parts: cue.parts, life: cue.life });
    expect(vfx.active).toBe(3);
    vfx.update(cue.life - 0.05);
    expect(vfx.active).toBe(3);
    vfx.update(0.1);
    expect(vfx.active).toBe(0);
    vfx.dispose();
  });

  it("is empty after clear (Undo, reset), a preset change and dispose, and reports its budget", () => {
    const vfx = system("medium");
    expect(vfx.capacity).toBe(FLIPBOOK_BUDGET.medium.instances);
    const at = new THREE.Vector3();
    for (const recipe of ["fallDust", "stepDust", "musketSmoke", "spellBurst", "arcaneBurst", "blast", "solforizMist"] as const) vfx.play(recipe, at);
    expect(vfx.active).toBeGreaterThan(10);
    vfx.clear();
    expect(vfx.active).toBe(0);
    for (const effect of ["dust", "smokePuff", "explosion", "flare", "smoke"] as const) expect(slots(vfx, effect)).toHaveLength(0);
    vfx.play("fallDust", at);
    vfx.setQuality("low");
    expect(vfx.active).toBe(0);
    expect(vfx.capacity).toBe(FLIPBOOK_BUDGET.low.instances);
    vfx.play("fallDust", at);
    vfx.dispose();
    expect(vfx.active).toBe(0);
    expect(vfx.play("fallDust", at)).toBe(-1);
  });

  it("never grows past the preset's pool, however many captures run together", () => {
    const vfx = system("low");
    const at = new THREE.Vector3();
    for (let i = 0; i < 40; i++) vfx.play("fallDust", at);
    expect(vfx.active).toBe(FLIPBOOK_BUDGET.low.instances);
    expect(layer(vfx, "dust").count).toBe(FLIPBOOK_BUDGET.low.instances);
    vfx.dispose();
  });
});
