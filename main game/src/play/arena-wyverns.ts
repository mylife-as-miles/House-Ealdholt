/**
 * A flock of wyverns flying round the arena (the creator: "have wyvern a lot of them to be really flying round the
 * arena"). Where each flies is worked out in arena-wyverns-flight.ts: young ones gliding low through the corners of the
 * play cameras' pictures, adults on wide circuits over the spires, the moat and the far lands, all clear of everything
 * standing and never between any of the match's cameras and the board. This file draws them.
 *
 * The beast is "main game/public/models/crownfall-wyvern.glb" ("Zagmatorah - An Ancient Dragon" by Seth Santos,
 * CC BY 4.0; see the CREDITS file beside it), the model the Queen's rite flies (web/src/scene/rites/wyvern.ts). Its one
 * clip, Fly_Cycle, is a single wingbeat. Rather than an AnimationMixer and 113 bones each, the flock reads the cycle
 * once at load into 36 skinning poses, and each wyvern's skeleton blends the two poses either side of its wings' place
 * in the beat straight into its bone texture, and only when it is drawn. All wyverns share the model's geometry,
 * textures and two materials; each has its own skeleton. None casts a shadow. A wyvern out of the camera's view is not
 * drawn at all: from the play cameras, which look down on the board, that is all the adults and most of the young.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadGltf } from "../../../web/src/scene/gltfQueue";
import { patchShader, type ArenaContext, type ArenaFeature, type ArenaQuality } from "./arena-kit";
import { arenaTier } from "./arena-surface-data";
import { FLOCK_SEED, FLOCK_SIZE, STILL_AT, buildFlight, flightSample, hiddenFrom, planFlock, type Flight, type Vec3 } from "./arena-wyverns-flight";


// The model's own numbers, as the Queen's rite measured them (rites/wyvern.ts): its widest wingspan in Fly_Cycle, the
// middle of its trunk in its own space (it faces -Z there, +Y up), and how many poses of the cycle are kept.
const MODEL_WINGSPAN = 25.9;
const MODEL_CENTRE = new THREE.Vector3(0, 3.8, 0.6);
const POSES = 36;

/** What lights the flock beyond the arena's own lamps, per setting: a rim from the sky, and the lava's glow from below. */
const SKY_RIM = { 1: new THREE.Color(0.42, 0.3, 0.22), 2: new THREE.Color(0.3, 0.24, 0.62) };
const LAVA_GLOW = new THREE.Color(2.2, 0.62, 0.16);

const LIGHT_PARS = /* glsl */ `
uniform vec3 uWyRim, uWyLava;`;

/** The sky's own brightness in the look, per setting (battlefield-look.ts: the sky dome's gain, P.sky). */
const SKY_GAIN = { 1: 1, 2: 0.3 };
// The look's haze colour is the sky panorama blurred wide (eclipse, corona and all), so a far wyvern seen against the
// dark sky would be lifted toward a pale grey and read as a ghost. Seen against the sky (looking above the horizon), a
// wyvern is fogged no brighter than the sky just behind it, so far ones stay dark shapes on it. Put into the look's own
// fog block just before it eases the haze to the near fog colour.
const SILHOUETTE_ANCHOR = "fogCol = mix(uFogNear, fogCol,";
const SILHOUETTE = /* glsl */ `
  vec3 wyBehind = textureLod( uFogMap, panoUv( normalize( fd ) ), 2.0 ).rgb * uWySky;
  fogCol = mix( fogCol, min( fogCol, wyBehind * 0.85 ), smoothstep( -0.02, 0.06, normalize( fd ).y ) );
  `;
// Added to the emitted light of both materials. The rim keeps a dark beast readable against the sky (Violet Night's
// sky is nearly as dark as it is); the glow is the moat's lava lighting the belly of one that dives low over it. Both
// use the world position the look's fog already passes (vFogWorld, Blender metres).
const LIGHT_FRAGMENT = /* glsl */ `
{
  vec3 wyN = normalize( normal );
  vec3 wyWorldN = inverseTransformDirection( wyN, viewMatrix );
  float wyRim = pow( 1.0 - clamp( abs( dot( wyN, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 3.0 );
  totalEmissiveRadiance += uWyRim * wyRim * ( 0.35 + 0.65 * ( 0.5 + 0.5 * wyWorldN.y ) );
  float wyOut = length( vFogWorld.xz ) / 2.3;
  float wyMoat = smoothstep( 38.0, 46.0, wyOut ) * ( 1.0 - smoothstep( 70.0, 80.0, wyOut ) );
  float wyLow = 1.0 - smoothstep( 4.0, 26.0, vFogWorld.y / 2.3 );
  totalEmissiveRadiance += uWyLava * diffuseColor.rgb * max( 0.0, -wyWorldN.y ) * wyMoat * wyLow;
}`;

interface Wyvern {
  flight: Flight;
  group: THREE.Group;
  skeleton: THREE.Skeleton;
  /** Where its wings are in Fly_Cycle (0..1), for its skeleton to pose when it is drawn. */
  phase: number;
  /** Radius of a sphere round its trunk that holds all of it, board units. */
  reach: number;
  /** When the opening's lift begins to come off (Flight.sample): by default as though the opening were over at
   * OPENING_OVER[0]; once told, after the opening, or -Infinity where there was none. */
  liftStart: number | undefined;
}

function disposeModel(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.dispose();
  });
  for (const texture of textures) {
    // the loader decodes the model's images to bitmaps, which hold memory until closed (as environment.ts does)
    (texture.source.data as { close?: () => void } | undefined)?.close?.();
    texture.dispose();
  }
}

/**
 * The flock as an arena part. It is awaited where battlefield-look.ts lists its parts, so the flock is in the scene
 * from the first frame and its shaders are built under the loading screen with everything else. A model that cannot
 * be loaded leaves the arena without wyverns, never without its look.
 */
export async function createArenaWyverns(context: ArenaContext): Promise<ArenaFeature> {
  let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
  try {
    gltf = await loadGltf(new GLTFLoader(), `${import.meta.env.BASE_URL}models/crownfall-wyvern.glb`);
  } catch (cause) {
    console.warn("[battlefield] the wyverns' model could not be loaded; the arena has no flock", cause);
    return {};
  }
  try {
    return buildFlock(context, gltf);
  } catch (cause) {
    console.warn("[battlefield] the wyverns could not be built; the arena has no flock", cause);
    disposeModel(gltf.scene);
    return {};
  }
}

function buildFlock(context: ArenaContext, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): ArenaFeature {
  const { renderer, scene, camera, world } = context;
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((object) => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh); });
  const named = (name: string) => {
    const mesh = meshes.find((candidate) => (candidate.material as THREE.Material).name === name);
    if (!mesh) throw new Error(`the wyvern model has no ${name} mesh`);
    return mesh;
  };
  // The eyes are left out: a far wyvern's eye is a pixel at most, and it would cost a draw of its own.
  const skin = named("DragonSkin"), wing = named("DragonWing");
  const bones = skin.skeleton.bones, inverses = skin.skeleton.boneInverses, count = bones.length;
  if (wing.skeleton.bones.some((bone, index) => bone !== bones[index])) throw new Error("the wyvern's meshes have different skeletons");

  // Fly_Cycle read once: each pose is every bone's skinning matrix (its place now times its bind inverse) with the
  // model at rest at the origin. Its keys are at 24 a second, 36 to the beat, so these are its own keyframes.
  const clip = THREE.AnimationClip.findByName(gltf.animations, "Fly_Cycle") ?? gltf.animations[0];
  if (!clip) throw new Error("the wyvern model has no flight clip");
  const poses = new Float32Array(POSES * count * 16);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const offset = new THREE.Matrix4();
  for (let k = 0; k < POSES; k++) {
    action.time = (k / POSES) * clip.duration;
    mixer.update(0);
    model.updateMatrixWorld(true);
    for (let i = 0; i < count; i++) offset.multiplyMatrices(bones[i].matrixWorld, inverses[i]).toArray(poses, (k * count + i) * 16);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  const stride = count * 16;
  const writePose = (phase: number, out: Float32Array) => {
    const at = (((phase % 1) + 1) % 1) * POSES, k0 = Math.floor(at) % POSES, k1 = (k0 + 1) % POSES, w = at - Math.floor(at);
    const a = k0 * stride, b = k1 * stride;
    for (let i = 0; i < stride; i++) out[i] = poses[a + i] + (poses[b + i] - poses[a + i]) * w;
  };

  // Two materials for the whole flock, made from the model's own, darkened like the Queen's beast (charcoal hide,
  // oxblood wings) so the flock reads as the same kind of creature. Everything that decides their shaders is set here,
  // before they are first drawn.
  const rim = SKY_RIM[context.setting];
  const prepare = (source: THREE.Material, tint: THREE.Color, rimShare: number) => {
    const material = (source as THREE.MeshStandardMaterial).clone();
    material.color.copy(tint);
    const uniforms = { uWyRim: { value: rim.clone().multiplyScalar(rimShare) }, uWyLava: { value: LAVA_GLOW.clone() } };
    const { fog } = context;
    // the look's haze as battlefield-look.ts withFog lays it on the arena's own lit props, kept no brighter than the
    // sky behind (if the look's fog block ever changes shape, the haze is laid on as it is)
    const fogged = fog.fragment.includes(SILHOUETTE_ANCHOR)
      ? fog.fragment.replace(SILHOUETTE_ANCHOR, SILHOUETTE + SILHOUETTE_ANCHOR) : fog.fragment;
    patchShader(material, "cf-wyvern-fog", (shader) => {
      Object.assign(shader.uniforms, fog.uniforms, { uWySky: { value: SKY_GAIN[context.setting] } });
      shader.vertexShader = shader.vertexShader
        .replace("#include <fog_pars_vertex>", fog.parsVertex).replace("#include <fog_vertex>", fog.vertex);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <fog_pars_fragment>", `${fog.parsFragment}\nuniform float uWySky;`)
        .replace("#include <fog_fragment>", fogged);
    });
    patchShader(material, "cf-wyvern-light", (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${LIGHT_PARS}`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${LIGHT_FRAGMENT}`);
    });
    return material;
  };
  // (darker than the Queen's: the arena's sky fill and haze lift them, and at 0.2 a young one over the lava read pale grey)
  const hide = prepare(skin.material as THREE.Material, new THREE.Color(0.12, 0.095, 0.1), 1);
  const membrane = prepare(wing.material as THREE.Material, new THREE.Color(0.22, 0.08, 0.075), 1.15);
  // cut out rather than blended, so the membranes sort against everything as the Queen's do
  membrane.transparent = false;
  membrane.alphaTest = 0.35;
  membrane.depthWrite = true;
  membrane.side = THREE.DoubleSide;
  membrane.roughness = Math.max(membrane.roughness, 0.7);
  const textures = new Set<THREE.Texture>();
  for (const material of [hide, membrane]) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);

  // The arena's root is in Blender metres scaled by 1/2.3; the flock's root undoes that, so it works in board units.
  const root = new THREE.Group();
  root.name = "arena-wyverns";
  root.scale.setScalar(2.3);
  const turnAround = new THREE.Matrix4().makeRotationY(Math.PI);
  const toCentre = new THREE.Matrix4().makeTranslation(-MODEL_CENTRE.x, -MODEL_CENTRE.y, -MODEL_CENTRE.z);
  const wyverns: Wyvern[] = planFlock(FLOCK_SEED).map((spec) => {
    const flight = buildFlight(spec);
    const group = new THREE.Group();
    // the group's frame: +Z the nose, +Y the back, +X the left wing (as rites/wyvern.ts); the model faces -Z
    const holder = new THREE.Matrix4().makeScale(spec.span / MODEL_WINGSPAN, spec.span / MODEL_WINGSPAN, spec.span / MODEL_WINGSPAN)
      .multiply(turnAround).multiply(toCentre);
    const skeleton = new THREE.Skeleton(bones, inverses);
    const wyvern: Wyvern = { flight, group, skeleton, phase: 0, reach: 0.8 * spec.span, liftStart: undefined };
    // The renderer asks each skeleton for its bones once a frame, and only when one of its meshes is drawn. This one
    // never looks at the bones: it blends the two kept poses either side of the wings' place in the beat.
    skeleton.update = () => {
      writePose(wyvern.phase, skeleton.boneMatrices!);
      if (skeleton.boneTexture) skeleton.boneTexture.needsUpdate = true;
    };
    for (const [source, material] of [[skin, hide], [wing, membrane]] as const) {
      const mesh = new THREE.SkinnedMesh(source.geometry, material);
      // Detached: the poses were taken with the model at the origin, and the mesh's own matrix carries them to the
      // wyvern's place in the sky.
      mesh.bind(skeleton, source.bindMatrix);
      mesh.bindMode = THREE.DetachedBindMode;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(holder, source.bindMatrix);
      // the bounds three.js would test are the bind pose's; the flock tests its own sphere instead
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    group.visible = false;
    root.add(group);
    return wyvern;
  });
  // only once all of it is built, so a model that fails part way leaves nothing in the arena
  world.add(root);

  let active = FLOCK_SIZE[arenaTier(context.quality())];
  let enabled = true;
  // a 1 x 1 target of the arena's own kind: shaders built while one is bound match the ones drawn into the look's
  // scene target (linear output, no tone mapping)
  const probe = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  let compiled = false, waited = 0;
  // three.js turns the look's PCFSoftShadowMap into PCFShadowMap the first time it draws shadows; a shader built before
  // that would be for the other kind and never used. Build once the kind has settled (or after a few frames regardless).
  const settled = () => !(renderer.shadowMap.enabled && renderer.shadowMap.type === THREE.PCFSoftShadowMap);
  const compile = () => {
    compiled = true;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(probe);
    renderer.compile(root, camera, scene);
    renderer.setRenderTarget(previous);
    for (const texture of textures) renderer.initTexture(texture);
  };

  const sample = flightSample();
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const forward = new THREE.Vector3(), left = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
  const roll = new THREE.Quaternion(), FORWARD = new THREE.Vector3(0, 0, 1), WORLD_UP = new THREE.Vector3(0, 1, 0);
  const stats = { drawn: 0, guarded: 0 };
  const eye: Vec3 = [0, 0, 0], eyeWorld = new THREE.Vector3(), ndc = new THREE.Vector3();
  const inView = (point: Vec3) => {
    ndc.set(point[0], point[1], point[2]).applyMatrix4(view);
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1;
  };
  let clock = 0;

  // Development only: lets a capture script switch the flock off and on to time it, hold it at one moment of its flight
  // (as reduced motion does at 0) while the camera moves, look at one place in the wingbeat, and read where each is.
  let held: number | null = null, posed: number | null = null;
  const debug = window as unknown as { __crownfallArenaWyverns?: unknown };
  if (import.meta.env.DEV) {
    debug.__crownfallArenaWyverns = { root, wyverns, stats, active: () => active,
      enable(on: boolean) { enabled = on; }, hold(time: number | null) { held = time; }, pose(phase: number | null) { posed = phase; } };
  }

  return {
    update(lookTime) {
      // with motion reduced the look's clock stands at 0; the flock stands still where the play cameras each see one
      const time = held ?? (context.reducedMotion() ? STILL_AT : lookTime);
      clock = lookTime;
      // The first frames are drawn under the loading screen with every light in place: the flock's shaders and textures
      // are built then, whether or not a wyvern is in view yet, so none appears later with a stall.
      if (!compiled && (settled() || ++waited > 3)) compile();
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      camera.getWorldPosition(eyeWorld);
      eye[0] = eyeWorld.x; eye[1] = eyeWorld.y; eye[2] = eyeWorld.z;
      let drawn = 0, guarded = 0;
      for (let i = 0; i < wyverns.length; i++) {
        const wyvern = wyverns[i];
        if (!enabled || i >= active) { wyvern.group.visible = false; continue; }
        // with motion reduced there is no opening, so no lift
        wyvern.flight.sample(time, sample, context.reducedMotion() ? -Infinity : wyvern.liftStart);
        const [x, y, z] = sample.position;
        sphere.center.set(x, y, z);
        sphere.radius = wyvern.reach;
        let seen = frustum.intersectsSphere(sphere);
        // never in front of the board, nor close in front of the lens, whatever the camera (arena-wyverns-flight.ts)
        if (seen && hiddenFrom(eye, sample, wyvern.flight.spec.span, wyvern.flight.spec.young, inView)) { seen = false; guarded++; }
        wyvern.group.visible = seen;
        if (!seen) continue;
        drawn++;
        wyvern.group.position.set(x, y, z);
        forward.set(sample.forward[0], sample.forward[1], sample.forward[2]);
        left.crossVectors(WORLD_UP, forward).normalize();
        up.crossVectors(forward, left);
        wyvern.group.quaternion.setFromRotationMatrix(basis.makeBasis(left, up, forward));
        wyvern.group.quaternion.multiply(roll.setFromAxisAngle(FORWARD, sample.bank));
        wyvern.phase = posed ?? sample.phase;
      }
      stats.drawn = drawn;
      stats.guarded = guarded;
    },
    opening(state) {
      // no opening: the young fly their own circuits from now (this is said under the loading screen); one just over:
      // each comes down when it next may
      for (const wyvern of wyverns) {
        wyvern.liftStart = state === "none" ? -Infinity : wyvern.flight.liftStartAfter(clock);
      }
    },
    setQuality(quality: ArenaQuality) {
      active = FLOCK_SIZE[arenaTier(quality)];
      // a new tier can light the arena with a different set of lamps, which needs the shaders built again
      compiled = false;
      waited = 0;
    },
    dispose() {
      root.removeFromParent();
      for (const wyvern of wyverns) wyvern.skeleton.dispose();
      hide.dispose();
      membrane.dispose();
      probe.dispose();
      disposeModel(model);
      if (import.meta.env.DEV) delete debug.__crownfallArenaWyverns;
    },
  };
}
