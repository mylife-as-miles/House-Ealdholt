/**
 * What the parts of the battlefield's look share (battlefield-look.ts builds the arena; arena-lava.ts, arena-surface.ts
 * and any further part each add one thing to it). A part is an ArenaFeature: it may patch the baked environment's
 * materials, the lit props' materials, supply the lava's material, add to the final grade pass, and move with time.
 */
import type * as THREE from "three";

/** The look's fog as shader chunks, for a material of a part's own (see lavaMaterial in arena-lava.ts for their use). */
export interface ArenaFog {
  uniforms: Record<string, THREE.IUniform>;
  /** Vertex shader: declarations, and the line that sets the fog position from `transformed` and `modelMatrix`. */
  parsVertex: string;
  vertex: string;
  /** Fragment shader: declarations, and the block that fogs `gl_FragColor`. */
  parsFragment: string;
  fragment: string;
}

/** The quality tier in force (battlefield-look.ts QUALITY): a part scales itself by it. */
export interface ArenaQuality {
  name: "auto" | "low" | "medium" | "high";
  scale: number; msaa: number; bloom: boolean; shadow: number; area: boolean; embers: number; dpr: number;
}

/**
 * A stretch of lava as a source of light, for whatever it lights. The lava part lists them when it is created
 * (ArenaContext.shared.emitters) and keeps their `level` moving; the part that lights the surfaces reads them.
 */
export interface ArenaEmitter {
  /** In the game's world: after the arena's 1/2.3 scale, the board's own units. */
  position: THREE.Vector3;
  /** How far across the lava is, in the same units. */
  radius: number;
  /** Linear colour of its light at level 1. */
  color: THREE.Color;
  /** Its brightness now, about 1, as it flickers. */
  level: number;
}
/** At most this many emitters are listed, so a shader can hold them in fixed arrays. */
export const ARENA_MAX_EMITTERS = 12;

export interface ArenaContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The arena's root. It is scaled by 1/2.3: positions in the look's files are Blender metres, the board's are not. */
  world: THREE.Group;
  setting: 1 | 2;
  quality(): ArenaQuality;
  fog: ArenaFog;
  /** The look's description of the Blender scene (gameport-look/look/setting<N>_inspect.json): lights, objects. */
  inspect: Record<string, unknown>;
  /** The sky panorama (equirectangular, HDR, with mips). */
  panorama: THREE.Texture;
  models: { arena: THREE.Object3D; environment: THREE.Object3D; extras: THREE.Object3D | null };
  reducedMotion(): boolean;
  /** What one part leaves for the others. Parts are created in the order battlefield-look.ts lists them. */
  shared: { emitters: ArenaEmitter[] };
}

/**
 * Additions to the final pass (grade + tone curve). Each string is GLSL placed in its main():
 *   warp    may change `vec2 uv` before the scene and its depth are read (heat shimmer);
 *   scene   may change `vec3 c`, the scene's linear colour, before the grade;
 *   final   may change `c` after the grade, before exposure and the tone curve.
 * In scope: `vUv`, `uv`, `c`, `depth`, `z` (metres along the view axis), `dir` (the pixel's world ray), `fwd`, `sky`.
 */
export interface ArenaGradeHook {
  uniforms?: Record<string, THREE.IUniform>;
  pars?: string;
  warp?: string;
  scene?: string;
  final?: string;
}

export interface ArenaFeature {
  /** Each material of the static, baked environment (unlit: albedo times baked light), before it is first compiled. */
  patchBaked?(material: THREE.MeshBasicMaterial, mesh: THREE.Mesh, info: { vertexLit: boolean }): void;
  /** Each lit material of the props the look lights in real time (board frame, creature, loose stones). */
  patchLit?(material: THREE.Material, mesh: THREE.Mesh): void;
  /** The material for a lava mesh (`heat` is its Blender material's, scaled by the look), or null to pass. */
  lavaMaterial?(mesh: THREE.Mesh, source: THREE.Material, heat: number): THREE.Material | null;
  grade?: ArenaGradeHook;
  /** The look's own lamps (the Blender scene's, by their names there), once they are made and before the first frame:
   * a part may retune them. Their visibility by tier stays battlefield-look.ts's. */
  lamps?(lamps: readonly THREE.Light[]): void;
  /** Once a frame: seconds since the arena started (0 with reduced motion) and since the last frame. */
  update?(time: number, delta: number): void;
  /** The match's opening (shared/play/match-opening.ts): `none` when the match is shown without one, `over` when it
   * has just ended or been skipped. Not called where the look is shown outside a match. */
  opening?(state: "none" | "over"): void;
  setQuality?(quality: ArenaQuality): void;
  dispose?(): void;
}

/**
 * Adds a change to a material's shader on top of any already there, and keeps its program cache key in step: two
 * materials share a program only when the same changes were made to both, in the same order. A change already made
 * under `key` is not made again. A material shared by several meshes is met once for each of them; without that
 * check its key grew one entry per mesh ("cf-look-fog|cf-look-fog|…"), so it never shared a program built for
 * another material, and was compiled on its own the first time it came into view.
 */
export function patchShader<T extends THREE.Material>(material: T, key: string,
  patch: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void): T {
  const made = (material.userData.cfShaderKeys as string[] | undefined) ?? [];
  if (made.includes(key)) return material;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => { previous.call(material, shader, renderer); patch(shader, renderer); };
  const keys = [...made, key];
  const cacheKey = keys.join("|");
  material.userData.cfShaderKeys = keys;
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
  return material;
}
