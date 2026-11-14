import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { SceneEngine } from "./sceneEngine";
import { TweenManager } from "./tween";

/** Lets everything waiting on a turn of the view that has just ended run. */
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

describe("turns of the view that meet", () => {
  /** The scene's own camera turns over a real tween clock. */
  function turningScene() {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 6.4, 8.6);
    const flips: boolean[] = [];
    const scene = Object.assign(Object.create(SceneEngine.prototype), {
      camera, controls: { target: new THREE.Vector3(0, 0.35, 0), enabled: true }, tweens: new TweenManager(),
      interactive: true, reducedMotion: false, orbiting: false, orbitRun: null, flipping: false, flipWaiting: false, cameraFlipped: false, disposed: false,
      callbacks: { onCameraFlipped: (flipped: boolean) => flips.push(flipped) },
    });
    const call = (name: string, ...args: unknown[]) => Reflect.apply(Reflect.get(SceneEngine.prototype, name), scene, args);
    const run = async (seconds: number) => { scene.tweens.update(seconds); await settle(); };
    return { scene, camera, flips, call, run };
  }

  it("follows Flip board with the turn to the next player when the flip is pressed in a move's last moment", async () => {
    const { scene, camera, flips, call, run } = turningScene();
    call("flipCamera");
    expect(flips).toEqual([true]);
    await run(0.5);
    // The move ends while the flip is still turning: its swing waits, where it used to be left out.
    let swung = false;
    const swing = (call("swingCamera") as Promise<void>).then(() => { swung = true; });
    await run(0.5);
    expect(camera.position.z).toBeCloseTo(-8.6, 4);
    expect(swung).toBe(false);
    expect(scene.orbiting).toBe(true);
    await run(1.2); await swing;
    // Round twice: the next player reads the board from the far side, which is what "flipped" says.
    expect(camera.position.z).toBeCloseTo(8.6, 4);
    expect(camera.position.x).toBeCloseTo(0, 4);
    expect(scene.cameraFlipped).toBe(true);
    expect(scene.orbiting).toBe(false);
    expect(scene.orbitRun).toBeNull();
  });

  it("makes a Flip board pressed during the turn to the next player follow it, and a second press during a flip no second flip", async () => {
    const { scene, camera, flips, call, run } = turningScene();
    const swing = call("swingCamera") as Promise<void>;
    await run(0.4);
    call("flipCamera"); call("flipCamera");
    expect(flips).toEqual([]);
    await run(0.8); await swing;
    expect(flips).toEqual([true]);
    expect(scene.orbiting).toBe(true);
    // Pressed again while its own turn is under way: ignored, as it always was.
    call("flipCamera");
    await run(1);
    expect(flips).toEqual([true]);
    expect(camera.position.z).toBeCloseTo(8.6, 4);
    expect(scene.orbiting).toBe(false);
  });

  it("hands the view back after a flip pressed while a scripted move held it, once that move has ended (M-22)", async () => {
    const { scene, call, run } = turningScene();
    // A scripted move (moveCameraTo) holds the view: its controls are off until it ends.
    scene.controls.enabled = false; scene.cameraScripted = true;
    call("flipCamera");
    await run(0.4);
    // The move ends first and frees the view, as moveCameraTo does.
    scene.cameraScripted = false; scene.controls.enabled = true;
    await run(1);
    // The flip used to put back what it found (off), and the view stayed locked for the match.
    expect(scene.orbiting).toBe(false);
    expect(scene.controls.enabled).toBe(true);
  });

  it("leaves the view to a scripted camera that is still holding it when a flip ends", async () => {
    const { scene, call, run } = turningScene();
    call("flipCamera");
    await run(0.4);
    // A script takes the camera in the middle of the flip (the ending's view, a duel): it hands the view back itself.
    scene.cameraScripted = true;
    await run(1);
    expect(scene.controls.enabled).toBe(false);
  });
});
