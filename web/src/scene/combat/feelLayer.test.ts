import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { EffectsSystem, ShakeSystem } from "../effects";

// The effects' sprite maps are painted on a canvas, and these tests run without a page.
vi.mock("../textures", async () => {
  const { Texture } = await import("three");
  const texture = () => new Texture();
  return { sparkTexture: texture, radialTexture: texture, smokeTexture: texture };
});
import type { PieceView } from "../pieces";
import { CombatFeel, kingdomOf } from "./feelLayer";
import { FEEL, KICK_SECONDS } from "./feel";

/** A fighter as the feel layer sees it: a board anchor, the model group under it, and a weapon whose point can move. */
function fighter(arsenal: "kingdom" | "sun" | "empire" | "kwind" = "kingdom") {
  const container = new THREE.Group(), visual = new THREE.Group();
  container.add(visual);
  const tip = new THREE.Vector3(0.3, 0.5, 0), grip = new THREE.Vector3(0, 0.5, 0);
  const piece = {
    container, visual, arsenal, kind: "p", isSlain: false,
    weaponLine: (outTip: THREE.Vector3, outGrip: THREE.Vector3) => { outTip.copy(tip); outGrip.copy(grip); return true; },
  };
  return { piece: piece as unknown as PieceView, tip, raw: piece };
}

function layer(options: { reduced?: boolean; low?: boolean } = {}) {
  const effects = new EffectsSystem(), shake = new ShakeSystem(), group = new THREE.Group();
  const feel = new CombatFeel({ effects, shake, group, lowDetail: () => !!options.low, reducedMotion: () => !!options.reduced });
  return { feel, effects, shake, group };
}

afterEach(() => { delete (globalThis as { __crownfallCombatFeel?: unknown }).__crownfallCombatFeel; });

describe("the combat feel layer in the scene", () => {
  it("holds the board on a blow, shudders the body that took it, and puts it back exactly", () => {
    const { feel, shake } = layer(), { piece } = fighter();
    expect(feel.begin()).toBe(true);
    const shape = feel.impact("kill", piece, new THREE.Vector3(1, 0, 0), 0.85, "p")!;
    expect(shape.freeze).toBeGreaterThan(0.05);
    // Held: the board gets a sliver of each frame while the hold lasts.
    expect(feel.timeScale(1 / 60, false)).toBeLessThan(0.05);
    let moved = 0;
    for (let i = 0; i < 30; i += 1) {
      feel.update(1 / 60, 1 / 60 * feel.timeScale(1 / 60, false));
      shake.update(1 / 60, 1 / 60);
      moved = Math.max(moved, piece.visual.position.length());
    }
    // It moved along the blow, never more than its amplitude, and is back at rest when the shudder is over.
    expect(moved).toBeGreaterThan(0.002); expect(moved).toBeLessThanOrEqual(shape.shudder * 1.06 + 1e-9);
    expect(piece.visual.position.length()).toBe(0);
    expect(feel.timeScale(1 / 60, false)).toBe(1);
  });

  it("kicks the camera along the blow on real time, and lets it settle", () => {
    const { feel, shake } = layer(), { piece } = fighter();
    feel.begin();
    feel.impact("kill", piece, new THREE.Vector3(0, 0, 1), 1, "p");
    // The board is held (no board time passes), but the camera still moves.
    let peak = 0;
    for (let t = 0; t < 0.1; t += 1 / 60) { shake.update(0, 1 / 60); peak = Math.max(peak, shake.offset.z); }
    expect(peak).toBeGreaterThan(0.015);
    for (let t = 0; t < KICK_SECONDS; t += 1 / 60) shake.update(0, 1 / 60);
    expect(shake.offset.length()).toBe(0);
  });

  it("does nothing under reduced motion, nor when switched off for a before/after check", () => {
    const reduced = layer({ reduced: true }), { piece } = fighter();
    expect(reduced.feel.begin()).toBe(false);
    expect(reduced.feel.impact("kill", piece, new THREE.Vector3(1, 0, 0), 1, "p")).toBeNull();
    expect(reduced.feel.timeScale(1 / 60, false)).toBe(1);
    reduced.shake.update(1 / 60, 1 / 60);
    expect(reduced.shake.offset.length()).toBe(0);
    (globalThis as { __crownfallCombatFeel?: unknown }).__crownfallCombatFeel = false;
    const off = layer();
    expect(off.feel.begin()).toBe(false);
    expect(off.feel.impact("clash", piece, new THREE.Vector3(1, 0, 0), 1, "p")).toBeNull();
    off.feel.swing(piece, 0.5);
    for (let i = 0; i < 10; i += 1) off.feel.update(1 / 60, 1 / 60);
    expect(off.group.children.every(child => (child as THREE.Mesh).geometry.drawRange.count === 0)).toBe(true);
  });

  it("draws a trail only while the weapon moves fast against the body, in its kingdom's colour, and fades it", () => {
    const { feel, group } = layer(), { piece, tip } = fighter("kwind");
    expect(kingdomOf(piece)).toBe("kwind");
    feel.begin();
    feel.swing(piece, 0.3);
    const mesh = group.children.find(child => child.name === "weapon-trail") as THREE.Mesh;
    // A still weapon (a wind-up, a guard) leaves nothing.
    for (let i = 0; i < 6; i += 1) feel.update(1 / 60, 1 / 60);
    const colors = () => Array.from((mesh.geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array);
    expect(Math.max(...colors())).toBe(0);
    // A thrust: the point drives out at 3 squares a second.
    for (let i = 0; i < 8; i += 1) { tip.x += 3 / 60; feel.update(1 / 60, 1 / 60); }
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    const bright = colors();
    // Cyan for Kwind-09's arc steel: blue and green well above red.
    expect(Math.max(...bright.filter((_, i) => i % 3 === 2))).toBeGreaterThan(Math.max(...bright.filter((_, i) => i % 3 === 0)));
    // The blow lands: the trail stops growing and is gone within its life.
    feel.endSwing(piece, 0);
    for (let t = 0; t < FEEL.trail.life + 0.05; t += 1 / 60) feel.update(1 / 60, 1 / 60);
    expect(mesh.geometry.drawRange.count).toBe(0);
  });

  it("clears everything at once when the board is rebuilt", () => {
    const { feel, group } = layer(), { piece, tip } = fighter();
    feel.begin();
    feel.impact("kill", piece, new THREE.Vector3(1, 0, 0), 1.2, "r");
    feel.swing(piece, 0.5);
    for (let i = 0; i < 5; i += 1) { tip.x += 0.05; feel.update(1 / 60, 1 / 60); }
    feel.clear();
    expect(piece.visual.position.length()).toBe(0);
    expect(feel.timeScale(1 / 60, false)).toBe(1);
    expect(group.children.every(child => (child as THREE.Mesh).geometry.drawRange.count === 0)).toBe(true);
    feel.dispose();
    expect(group.children.length).toBe(0);
  });

  it("throws sparks along the blow when asked to", () => {
    const effects = new EffectsSystem();
    effects.spawnBurst(new THREE.Vector3(), 0xffffff, 40, { direction: new THREE.Vector3(1, 0, 0), spread: 0.3, speed: 2, gravity: 0 });
    // The burst is the last thing spawnBurst adds (the contact and trail objects come first).
    const points = effects.group.children[effects.group.children.length - 1] as THREE.Points;
    const before = Float32Array.from((points.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array);
    effects.update(0.05);
    const after = (points.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    let forward = 0;
    for (let i = 0; i < 40; i += 1) if (after[i * 3] - before[i * 3] > 0) forward += 1;
    expect(forward).toBe(40);
    effects.dispose();
  });
});
