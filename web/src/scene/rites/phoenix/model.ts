/**
 * The phoenix's body: the rigged model "main game/public/models/crownfall-phoenix.glb", "phoenix bird" by
 * NORBERTO-3D (https://sketchfab.com/norberto3d), CC BY 4.0, via Sketchfab
 * (https://sketchfab.com/3d-models/phoenix-bird-844ba0cf144a413ea92c779f18912042). Its CREDITS.md beside it says
 * what was changed. phoenix/modelRig.ts holds its numbers; this loads it, burns it, and poses it.
 *
 * As the wyvern (rites/wyvern.ts): the GLB is fetched once through the shared download window (gltfQueue) and each
 * rite clones it with SkeletonUtils, scrubs its one flight clip ("Take 001") to the plan's wingbeats, and lays its
 * own poses over the clip on the bones: the wings held up over its back coming through the seal and seizing the
 * piece, swept back in the swoop, flared as it brakes, and their stroke drawn in where the board is near; the legs
 * thrown forward to seize, then hanging under it with the feet closed on the body; the beak open as it cries.
 *
 * Its painted feathers are dark embers here, lit by the arena; what burns is drawn over them as light, from one
 * temperature (phoenix/fire.ts): the painter's own glow (the emissive maps: the crest, the eyes of the tail plumes,
 * the edges of the primaries) burns hottest, the paint's light parts warmer than its dark, fire crawls over the body
 * in noise that sticks to it, and its outline glows. All of it is pushed through the match's gain (vfxGlow), and by
 * day (uDay) the fire keeps to what burns hottest while the rest stays dark, so it holds against the bright 360
 * skies. Its feathers are cut out, not blended, so it writes depth and sorts against everything in the match.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadGltf, type LoadedGltf } from "../../gltfQueue";
import { FIRE, FIRE_NOISE, SEAL_CUT } from "./fire";
import { PHOENIX_BONES, PHOENIX_MODEL, PHOENIX_MODEL_URL, clipShare, strokeRoom, type ModelFlame } from "./modelRig";
import { phoenixFlap, type PhoenixFlap, type PhoenixPlan, type PhoenixWingbeat } from "./phoenixFlight";
import { hovering, legShape, wingShape, type PhoenixPose } from "./phoenixForm";

/** The GLB, loaded once a page and kept: every phoenix clones it. A failed load is tried again by the next rite. */
let source: Promise<LoadedGltf> | null = null;
export function loadPhoenixModel(): Promise<LoadedGltf> {
  if (!source) {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    const pending = loadGltf(new GLTFLoader(), `${base}${PHOENIX_MODEL_URL}`);
    pending.catch(() => { if (source === pending) source = null; });
    source = pending;
  }
  return source;
}

/** Layered pose angles, radians, tuned by eye on the bench. */
const TUNE = {
  /** The wings swept back at the shoulder for the swoop, and coming through the seal. */
  sweep: 0.6,
  /** Legs: the shin straightened as they reach and hang, the feet thrown open, and clenched on what they hold. */
  reachShin: -0.45,
  hangShin: -0.3,
  open: -0.5,
  clench: 0.75,
  /** How far apart the feet close, either side of what they hold, and how far ahead of the hips they hang. */
  apart: 0.16,
  ahead: 0.25,
  jaw: 0.45,
  /** The stroke drawn in while it hovers with the body. */
  hoverStroke: 0.25,
};

const v3 = () => new THREE.Vector3();
/** What the painted feathers are multiplied by: dark embers, lit only by the arena and the fire over them. */
const DARK = [0.1, 0.04, 0.028] as const;

export class PhoenixModel {
  /** At the bird's middle, turned to its frame; the model hangs from it. */
  readonly object = new THREE.Group();
  /** Resolves true when the model is in, false when it could not be had (the rite then draws the bird in code). */
  readonly ready: Promise<boolean>;
  readonly stats = { triangles: 0, drawCalls: 0, bones: 0 };
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly level = new Map<THREE.Object3D, THREE.Quaternion>();
  private wingBones: THREE.Object3D[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly own: Record<string, THREE.IUniform>;
  private disposed = false;
  private readonly flap: PhoenixFlap = { amount: 0, phase: 0, power: 1, index: -1 };
  private readonly basis = new THREE.Matrix4();
  private readonly axes = [v3(), v3(), v3()];
  private readonly qA = new THREE.Quaternion();
  private readonly qB = new THREE.Quaternion();
  private readonly pA = v3();
  private readonly pB = v3();
  private readonly pC = v3();
  private readonly pD = v3();
  private readonly pE = v3();
  private readonly pF = v3();
  private readonly pG = v3();
  private readonly pH = v3();
  private readonly target = v3();
  private readonly identity = new THREE.Quaternion();
  private readonly X = new THREE.Vector3(1, 0, 0);
  private readonly Y = new THREE.Vector3(0, 1, 0);
  private readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(shared: Record<string, THREE.IUniform>, private readonly unit: number) {
    this.object.name = "phoenix-model";
    this.object.visible = false;
    this.own = { ...shared, uBurn: { value: 1 }, uGlowOn: { value: 1 }, uPhxScale: { value: 0.0176 * unit } };
    this.ready = loadPhoenixModel().then((gltf) => { if (this.disposed) return false; this.adopt(gltf); return true; }, () => false);
  }

  get loaded(): boolean { return this.model !== null; }

  private adopt(gltf: LoadedGltf): void {
    const cloned = cloneSkinned(gltf.scene);
    cloned.scale.multiplyScalar(this.unit);
    this.model = cloned;
    this.object.add(cloned);
    cloned.traverse((object) => {
      if (object.name && !this.bones.has(object.name)) this.bones.set(object.name, object);
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // the bounds are the bind pose's; the bird is posed far from them
      mesh.frustumCulled = false;
      const index = mesh.geometry.getIndex();
      this.stats.triangles += (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
      this.stats.drawCalls += 1;
      mesh.material = this.burn(mesh.material as THREE.MeshStandardMaterial);
    });
    cloned.traverse((object) => { if ((object as THREE.Bone).isBone) this.stats.bones += 1; });
    const clip = THREE.AnimationClip.findByName(gltf.animations, "Take 001") ?? gltf.animations[0];
    if (clip) {
      this.mixer = new THREE.AnimationMixer(cloned);
      this.action = this.mixer.clipAction(clip);
      this.action.play();
    }
    // The wings at level on the way down: what the stroke is drawn in toward where there is no room for all of it.
    this.wingBones = [...this.bones.keys()].filter((name) => /_Wing_\d/.test(name)).map((name) => this.bones.get(name)!);
    this.scrub(PHOENIX_MODEL.level);
    for (const bone of this.wingBones) this.level.set(bone, bone.quaternion.clone());
  }

  /** The model's material, burnt: its painting dark, its fire drawn over it (see the header). */
  private burn(original: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const mine = original.clone();
    // the painting's own colours are put out (its greens read olive in the arenas' light): only its light and dark
    // are kept, as embers
    mine.color.setRGB(1, 1, 1);
    mine.emissive.setRGB(0, 0, 0);
    mine.metalness = 0;
    mine.roughness = 0.85;
    // cut out rather than blended: it sorts against everything and writes depth
    mine.transparent = false;
    mine.alphaTest = 0.4;
    mine.depthWrite = true;
    mine.side = THREE.DoubleSide;
    const uniforms = this.own;
    mine.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vPhxWorld;\nvarying vec3 vPhxModel;")
        .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n\tvPhxWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvPhxModel = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vPhxWorld;\nvarying vec3 vPhxModel;\nuniform float uTime, uGain, uBurn, uGlowOn, uPhxScale;\nfloat phxPaint;\n${FIRE_NOISE}\n${FIRE}\n${SEAL_CUT}`)
        .replace("#include <map_fragment>", `#include <map_fragment>
	phxPaint = clamp( dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) ), 0.0, 1.0 );
	diffuseColor.rgb = vec3( ${DARK.map((v) => v.toFixed(3)).join(", ")} ) * ( 0.45 + 0.9 * phxPaint );`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
	{
		float phxMolten = sealCut( vPhxWorld );
		vec3 phxPainted = texture2D( emissiveMap, vEmissiveMapUv ).rgb;
		float phxGlow = max( phxPainted.r, max( phxPainted.g, phxPainted.b ) );
		// fire crawling over it, in noise that sticks to the bird (its bind pose, in scene units)
		vec3 phxP = vPhxModel * uPhxScale;
		float phxCrawl = fNoise( vec2( phxP.x * 0.9 + uTime * 2.4, phxP.y * 1.1 + phxP.z * 0.7 ) ) * 0.6 + fNoise( vec2( phxP.x * 2.3 + uTime * 4.1, phxP.z * 2.0 - uTime ) ) * 0.4;
		float phxRim = pow( 1.0 - clamp( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ), 0.0, 1.0 ), 2.0 );
		// veins of fire through dark embers: the crawl sharpened, the painter's glow and the paint's light parts hotter,
		// and the outline, where the eye looks through the most of it
		float phxVein = smoothstep( 0.35, 0.95, phxCrawl );
		float phxHeat = uBurn * ( 0.1 + 0.42 * phxGlow + 0.14 * phxPaint + 0.62 * phxVein * phxVein + 0.36 * phxRim ) + 0.4 * phxMolten;
		// by night the bird smoulders and its veins blaze; by day the fire keeps to what burns hottest and the rest stays dark
		float phxLit = mix( smoothstep( 0.22, 0.66, phxHeat ), smoothstep( 0.34, 0.8, phxHeat ), uDay );
		totalEmissiveRadiance += fire( phxHeat ) * phxLit * 0.8 * uGain * uGlowOn;
	}`);
    };
    mine.customProgramCacheKey = () => "crownfall-phoenix-fire";
    this.materials.push(mine);
    return mine;
  }

  /** Sets the clip to `share` of the way through a beat. */
  private scrub(share: number): void {
    if (!this.mixer || !this.action) return;
    this.action.time = (((share % 1) + 1) % 1) * PHOENIX_MODEL.beat;
    this.mixer.update(0);
  }

  /** The product of the rotations from the bird's frame down to a bone's parent. */
  private chain(bone: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    let parent = bone.parent;
    while (parent && parent !== this.object) { out.premultiply(parent.quaternion); parent = parent.parent; }
    return out;
  }

  /** Turns a bone about an axis given in the bird's own frame (+Z its beak, +Y its back, +X its left). */
  private turn(name: string, axis: THREE.Vector3, angle: number): void {
    const bone = this.bones.get(name);
    if (!bone || Math.abs(angle) < 1e-5) return;
    this.chain(bone, this.qA);
    this.qB.setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(this.qA).premultiply(this.qB).premultiply(this.qA.invert());
  }

  /**
   * Poses the bird at `t`: where the plan's pose has it (its middle, its frame, drawn into the sun as it becomes the
   * sun), its clip scrubbed to the wingbeat, and the rite's own poses laid over the clip.
   */
  pose(plan: PhoenixPlan, beats: readonly PhoenixWingbeat[], t: number, pose: PhoenixPose): void {
    if (!this.model) return;
    const T = plan.timeline, unit = this.unit, c = pose.collapse, pull = Math.pow(1 - c, 1.5), sun = plan.sun;
    this.object.visible = pose.shown > 0.001;
    if (!this.object.visible) return;
    const [x, y, z] = this.axes;
    x.fromArray(pose.left); y.fromArray(pose.up); z.fromArray(pose.forward);
    this.object.quaternion.setFromRotationMatrix(this.basis.makeBasis(x, y, z));
    this.object.position.set(sun.x + (pose.centre[0] - sun.x) * pull, sun.y + (pose.centre[1] - sun.y) * pull, sun.z + (pose.centre[2] - sun.z) * pull);
    this.object.scale.setScalar(1 - 0.75 * c);
    this.own.uBurn.value = 0.95 * pose.heat;

    // The clip, at the wingbeat.
    const shape = wingShape(plan, t), flap = phoenixFlap(beats, t, this.flap);
    this.scrub(clipShare(flap, shape));
    // Its stroke drawn in toward level where the board is near, and while it labours with the body.
    const hover = hovering(plan, t);
    const room = strokeRoom(pose.centre[1] - plan.boardTop, unit) * (1 - TUNE.hoverStroke * hover);
    if (room < 0.999) for (const bone of this.wingBones) bone.quaternion.slerp(this.level.get(bone)!, 1 - room);
    // Swept back for the swoop and coming through the seal.
    const sweep = shape.fold * TUNE.sweep;
    for (const wing of PHOENIX_BONES.wings) this.turn(wing.arm[0], this.Y, -sweep * wing.sign);

    // The legs: thrown forward at the victim's chest to seize it with the feet open, then hanging straight down
    // under the body as it carries, the feet closed on what they hold.
    const legs = legShape(plan, t);
    for (const leg of PHOENIX_BONES.legs) {
      const [, calf, foot] = leg.bones;
      this.turn(calf, this.X, legs.reach * TUNE.reachShin + legs.hang * TUNE.hangShin);
      this.turn(foot, this.X, (1 - legs.clutch) * TUNE.open + legs.clutch * (legs.reach + legs.hang > 0.05 ? TUNE.clench : 0.3));
    }
    if (legs.reach + legs.hang > 1e-3) {
      this.object.updateMatrixWorld(true);
      const hips = this.pC.set(0, 0, 0);
      for (const leg of PHOENIX_BONES.legs) hips.add(this.bones.get(leg.bones[0])!.getWorldPosition(this.pA));
      hips.multiplyScalar(0.5);
      const side = this.pD.set(pose.left[0], 0, pose.left[2]).normalize();
      const ahead = this.pE.set(pose.forward[0], 0, pose.forward[2]).normalize();
      for (const leg of PHOENIX_BONES.legs) {
        const [thigh, , foot] = leg.bones;
        // what the legs reach for: the victim's chest; and where they hang: straight down under the hips
        const reachAt = this.pF.set(plan.chest.x, plan.chest.y, plan.chest.z).addScaledVector(side, TUNE.apart * leg.sign * unit);
        const hangAt = this.pG.copy(hips).addScaledVector(side, TUNE.apart * leg.sign * unit).addScaledVector(ahead, TUNE.ahead * unit);
        hangAt.y -= 4 * unit;
        const weight = legs.reach + legs.hang;
        this.target.copy(reachAt).multiplyScalar(legs.reach / weight).addScaledVector(hangAt, legs.hang / weight);
        this.aim(thigh, foot, this.target, Math.min(1, weight));
      }
    }
    // The beak open as it cries.
    this.turn(PHOENIX_BONES.jaw, this.X, Math.min(1, pose.cry) * TUNE.jaw);
    this.object.updateMatrixWorld(true);
    void T;
  }

  /**
   * Turns a bone (in the world) so that what hangs from it at `tip` points at `target`, by `weight` of the way:
   * the leg keeps its own bend and swings whole at the hip.
   */
  private aim(boneName: string, tipName: string, target: THREE.Vector3, weight: number): void {
    const bone = this.bones.get(boneName), tip = this.bones.get(tipName);
    if (!bone || !tip || !bone.parent || weight <= 0) return;
    bone.getWorldPosition(this.pA);
    tip.getWorldPosition(this.pB);
    const now = this.pB.sub(this.pA).normalize(), want = this.pH.copy(target).sub(this.pA).normalize();
    this.qB.setFromUnitVectors(now, want);
    if (weight < 1) this.qB.slerp(this.identity, 1 - weight);
    bone.parent.getWorldQuaternion(this.qA);
    bone.quaternion.premultiply(this.qA).premultiply(this.qB).premultiply(this.qA.invert());
    bone.updateMatrixWorld(true);
  }

  /** Where its closed feet hold a body: midway between them, a little under. */
  socket(out: THREE.Vector3): THREE.Vector3 {
    const left = this.bones.get(PHOENIX_BONES.legs[0].bones[2]), right = this.bones.get(PHOENIX_BONES.legs[1].bones[2]);
    if (!left || !right) return out.copy(this.object.position);
    left.getWorldPosition(this.pA); right.getWorldPosition(this.pB);
    return out.addVectors(this.pA, this.pB).multiplyScalar(0.5).addScaledVector(this.Y, -PHOENIX_MODEL.grip * this.unit * this.object.scale.x);
  }

  /** Where a flame standing on the model is now. Returns false when one of its bones is missing. */
  flame(flame: ModelFlame, out: THREE.Vector3): boolean {
    const a = this.bones.get(flame.from), b = this.bones.get(flame.to);
    if (!a || !b) return false;
    a.getWorldPosition(this.pA); b.getWorldPosition(this.pB);
    out.copy(this.pA).lerp(this.pB, flame.at);
    return true;
  }

  /** Turns its drawn glow off (to measure it) or on. */
  setGlow(on: boolean): void { this.own.uGlowOn.value = on ? 1 : 0; }

  dispose(): void {
    this.disposed = true;
    this.object.removeFromParent();
    this.mixer?.stopAllAction();
    for (const material of this.materials) material.dispose();
    this.model?.traverse((object) => { const mesh = object as THREE.SkinnedMesh; if (mesh.isSkinnedMesh) mesh.skeleton.dispose(); });
  }
}
