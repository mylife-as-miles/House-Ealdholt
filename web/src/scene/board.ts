import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type { SquareId } from "../core/types";
import type { ArenaLook } from "./arena";
import {
  boardBorderTexture,
  marbleTexture,
  MARKER_ATLAS_GRID,
  MARKER_CELLS,
  markerAtlasTexture,
  markerCellOrigin,
  type MarkerCell,
} from "./textures";

export const TILE = 1.02;
export const BOARD_TOP = 0;

/** Metres between square centres on the arena's own Blender board (see {@link BoardView.setBakedBoard}). */
const BAKED_BOARD_PITCH = 2.3;

const FILES = "abcdefgh";

export type HighlightKind =
  | "select"
  | "move"
  | "capture"
  | "castle"
  | "promote"
  | "last"
  | "check"
  | "hint"
  | "enpassant"
  | "queued"
  | "aim";

/**
 * How one kind of square is marked.
 *
 * A marker is light and stone, not a sign laid on the board: a line cut into the tile with light running in it,
 * a pool of the same light lying on the stone around it, and, where a figure may stand on the square, some of that
 * light caught on the figure. The pool is laid on as light, so the stone's own grain, joints and shadows show
 * through it; a glow added on top of the tile washes them out and reads as a sticker.
 */
export interface MarkerStyle {
  /** The light's colour (sRGB). */
  color: number;
  /** The shape cut into the tile (see `markerAtlasTexture`). */
  inlay: MarkerCell;
  /** How brightly the cut line burns. */
  line: number;
  /** How white its core runs, 0 to 1. */
  hot: number;
  /** The shape of the light lying on the stone. */
  pool: MarkerCell;
  /** How strongly that light falls on the stone (each kind of tile takes it in its own way: see TILE_RESPONSE). */
  lift: number;
  /** How much of the light a figure standing on the square catches; 0 where no figure can stand. */
  figure: number;
  /** Light standing on the square, seen in the air above it; 0 for none. */
  shaft?: number;
}

/**
 * Each kind has its own shape as well as its own colour (the shapes are listed at `markerAtlasTexture`), so the
 * board reads without colour and without anything moving. Quiet moves are the calmest lights on the board and
 * the last move the faintest; a capture, a check and the selected piece are the ones that light a figure. Only
 * a promotion square has light standing on it: it lies on the far rank, behind the pawn that will take it, where
 * nothing drawn flat on the stone can be seen whole.
 *
 * `queued` and `aim` are a move asked for while the board was busy, in a colour no other marker has: a frame of
 * dashes round the piece that waits to go, and the square it is to go to (BoardView.setQueued).
 *
 * `enpassant` is the pawn a capture in passing takes, which does not stand where its captor lands: it is lit as a
 * capture is, on a shape of its own.
 */
export const MARKER_STYLES: Record<HighlightKind, MarkerStyle> = {
  select: { color: 0xffc46a, inlay: "select", line: 1.5, hot: 0.5, pool: "poolEdge", lift: 0.9, figure: 0.5 },
  move: { color: 0x6fe6c2, inlay: "move", line: 1.6, hot: 0.6, pool: "poolRound", lift: 0.9, figure: 0 },
  capture: { color: 0xff5a36, inlay: "capture", line: 1.9, hot: 0.45, pool: "poolEdge", lift: 0.65, figure: 0.5 },
  castle: { color: 0x6db6ff, inlay: "castle", line: 1.7, hot: 0.5, pool: "poolRound", lift: 0.9, figure: 0 },
  promote: { color: 0xcf8cff, inlay: "promote", line: 1.8, hot: 0.6, pool: "poolTile", lift: 1, figure: 0.3, shaft: 0.3 },
  last: { color: 0xe2a550, inlay: "last", line: 1.4, hot: 0.2, pool: "poolEdge", lift: 0.5, figure: 0 },
  check: { color: 0xff3524, inlay: "check", line: 2.1, hot: 0.5, pool: "poolRing", lift: 1.1, figure: 0.35 },
  hint: { color: 0x8fbcff, inlay: "hint", line: 1.5, hot: 0.5, pool: "poolRing", lift: 0.7, figure: 0.25 },
  enpassant: { color: 0xff5a36, inlay: "enpassant", line: 1.9, hot: 0.45, pool: "poolEdge", lift: 0.65, figure: 0.5 },
  queued: { color: 0x9a8cff, inlay: "queued", line: 1.7, hot: 0.5, pool: "poolEdge", lift: 0.7, figure: 0.4 },
  aim: { color: 0x9a8cff, inlay: "aim", line: 1.8, hot: 0.55, pool: "poolRound", lift: 0.8, figure: 0.3 },
};

/** The pointer's square and the keyboard cursor: the crispest mark on the board, so it is found at once. */
const CURSOR_STYLE: MarkerStyle = { color: 0xfff1d6, inlay: "cursor", line: 2, hot: 0.8, pool: "poolTile", lift: 0.5, figure: 0.4 };

/**
 * Coloured light shows differently on the two kinds of square, which stand some four stops apart.
 *
 * A dark tile has room above it: light lifts it, and the lift is what is seen. It needs far more of it than a pale
 * tile to show as much, and a lit line stands out on it so strongly that it wants less.
 *
 * A pale tile is already near the top of the picture. Lifted further it only whitens and the light's colour is
 * lost, and a white line on it is a white line on white. There the light shows as colour instead: the channels
 * that are not the light's are drawn down as its own are raised (`shift`, taken off the colour before it
 * multiplies the stone), so the tile takes the hue at about the brightness it had, and a line is held to a level
 * where it keeps its colour inside its dark channel.
 */
const TILE_RESPONSE = {
  pale: { lift: 1, shift: 0.45, line: 0.62, hot: 0.4 },
  dark: { lift: 2.6, shift: 0.08, line: 0.55, hot: 1 },
};

/** How dark an unreachable square goes while a piece is selected: shade, with the stone still showing in it. */
const SHROUD_OPACITY = 0.58;

/** Seconds a marker takes to come up and to go out. */
const MARKER_RISE = 0.2;
const MARKER_FALL = 0.12;
/** How far a marker's light drops before it comes up again when the eye is drawn back to it (BoardView.flare). */
const FLARE_DIP = 0.25;

/**
 * Pale stone dust in the arena's light (linear), thrown out where a figure lands or falls. It is drawn as dust is
 * seen: it covers what is under it and is itself lit, so it lightens a dark tile and barely changes a pale one.
 */
const DUST: [number, number, number] = [0.3, 0.27, 0.24];

/** The cursor, every square's marker and shade, and the rings of the blows and landings that can overlap. */
const OVER_CAPACITY = 160;
const POOL_CAPACITY = 80;
const DOME_CAPACITY = 68;
const SHAFT_CAPACITY = 8;

export function squareToWorld(square: SquareId, y = BOARD_TOP): THREE.Vector3 {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return new THREE.Vector3((file - 3.5) * TILE, y, (3.5 - (rank - 1)) * TILE);
}

export function worldToSquare(x: number, z: number): SquareId | null {
  const file = Math.round(x / TILE + 3.5);
  const rank = Math.round(3.5 - z / TILE) + 1;
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}`;
}

export function isLightSquare(square: SquareId): boolean {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}

/** Whether the board under a point is a pale square (as {@link isLightSquare}, for a figure between squares). */
export function isLightSquareAt(x: number, z: number): boolean {
  const file = Math.round(x / TILE + 3.5);
  const rank = Math.round(3.5 - z / TILE) + 1;
  return (((file + rank) % 2) + 2) % 2 === 0;
}

/** A light's colour as the shaders take it: linear, scaled so its strongest channel is 1. */
export function lightColour(hex: number): [number, number, number] {
  const colour = new THREE.Color(hex);
  const peak = Math.max(colour.r, colour.g, colour.b, 1e-4);
  return [colour.r / peak, colour.g / peak, colour.b / peak];
}

/** A tile knocked out of place by an impact, settling back with damped bounce. */
interface TileJolt {
  tile: THREE.Mesh;
  home: THREE.Vector3;
  /** Seconds elapsed; negative while the shock travels out to this tile. */
  age: number;
  strength: number;
  duration: number;
  seed: number;
}

/** The flash and shock of a capture on a square. */
interface ImpactWave {
  x: number;
  z: number;
  light: boolean;
  colour: [number, number, number];
  turn: number;
  age: number;
  duration: number;
  strength: number;
  /** How much of the flash on the stone shows, 0 to 1, and its tint against the default warm white. */
  flare: number;
  flareTint: [number, number, number];
  /** How much of the dust and the line of heat shows, 0 to 1. */
  ring: number;
  active: boolean;
}

/** Arrival on the square a figure just set down on: a breath of its side's light and the dust it kicks out. */
interface LandingRipple {
  x: number;
  z: number;
  light: boolean;
  colour: [number, number, number];
  turn: number;
  age: number;
  duration: number;
  strength: number;
  active: boolean;
}

/** The shade over a square the selected piece cannot reach. */
interface ShroudSlot {
  x: number;
  z: number;
  target: number;
  current: number;
  /** Seconds still to wait before this square starts fading. */
  delay: number;
}

interface HighlightSlot {
  x: number;
  z: number;
  light: boolean;
  /** The kind being shown, kept while it fades out; null once nothing is left of it. */
  kind: HighlightKind | null;
  /** False once the marker has been cleared and is going out. */
  wanted: boolean;
  /** How far up the marker is, 0 to 1. */
  level: number;
  /** Seconds still to wait before it starts to come up. */
  delay: number;
  /** Seconds since it started to come up. */
  age: number;
  pulse: boolean;
  phase: number;
  /** Turn about the square's centre, for a shape with a right way up. */
  turn: number;
}

/** One of the two marks of a queued move (BoardView.setQueued). */
interface QueuedMark {
  x: number;
  z: number;
  light: boolean;
  wanted: boolean;
  /** How far up the mark is, 0 to 1. */
  level: number;
  /** Seconds since it started to come up. */
  age: number;
}

const MARKER_VERTEX = /* glsl */ `
  attribute vec3 aCorner;
  attribute vec4 aPose;
  attribute vec4 aTint;
  attribute vec4 aCell;
  uniform float uCell;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vHot;
  varying float vPlain;
  void main() {
    // aPose: the square's centre (x, z), the mark's size and its turn. The picture's top lies towards rank 8.
    float c = cos(aPose.w);
    float s = sin(aPose.w);
    vec2 p = aCorner.xy * aPose.z;
    vec2 turned = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    // aCell: the atlas cell's corner, how much of the cell to span and the core's heat. A negative span is a mark
    // with no picture: the whole square, evenly (the shade over a square).
    vPlain = aCell.z < 0.0 ? 1.0 : 0.0;
    vUv = aCell.xy + (0.5 + (uv - 0.5) * max(aCell.z, 0.0)) * uCell;
    vTint = aTint;
    vHot = aCell.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aPose.x + turned.x, 0.0, aPose.y - turned.y, 1.0);
  }
`;

/** Lines, shade and dust: light added to the picture, over stone darkened where the mask says it is cut or covered. */
const OVER_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vHot;
  varying float vPlain;
  void main() {
    vec3 mask = texture2D(uAtlas, vUv).rgb;
    float peak = max(vTint.r, max(vTint.g, vTint.b));
    vec3 light = vTint.rgb * mask.r + mix(vTint.rgb, vec3(peak), 0.75) * (mask.b * vHot);
    gl_FragColor = vec4(light * (1.0 - vPlain), clamp(mix(mask.g, 1.0, vPlain) * vTint.a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Light on the stone. The blend multiplies what is already drawn by (1 + this), so the output is how much brighter
 * the surface becomes, channel by channel (and darker, where a channel is below nothing: see TILE_RESPONSE). Drawn
 * straight to the screen the picture is already display-encoded, where the same factor would brighten far more:
 * `uDirect` brings it back to about what it does in a linear buffer.
 */
const POOL_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uDirect;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vec3 gain = max(vTint.rgb * texture2D(uAtlas, vUv).r, vec3(-0.85));
    if (uDirect > 0.5) gain = pow(1.0 + gain, vec3(0.4545)) - 1.0;
    gl_FragColor = vec4(gain, 1.0);
  }
`;

const DOME_VERTEX = /* glsl */ `
  attribute vec3 aCorner;
  attribute vec4 aPose;
  attribute vec4 aTint;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vToEye;
  varying float vHeight;
  void main() {
    // aPose: the square's centre (x, z), the dome's radius and its height.
    vec4 view = modelViewMatrix * vec4(aPose.x + aCorner.x * aPose.z, aCorner.y * aPose.w, aPose.y + aCorner.z * aPose.z, 1.0);
    // A stretched sphere's normal: the sphere's, divided by the stretch along each axis.
    vNormal = normalMatrix * vec3(aCorner.x / aPose.z, aCorner.y / aPose.w, aCorner.z / aPose.z);
    vToEye = -view.xyz;
    vHeight = aCorner.y;
    vTint = aTint.rgb;
    gl_Position = projectionMatrix * view;
  }
`;

/**
 * The light a figure standing on a lit square catches. Only the near side of a low dome over the square is drawn,
 * multiplying whatever lies behind it: the figure's feet and legs, and the tile. It is strongest low and in the
 * middle and gone at the dome's top and outline, so it has no edge of its own.
 *
 * With SHAFT defined the same shape, drawn tall, is light standing in the air over a square: added to the picture
 * rather than multiplying it, so it shows against a dark arena as well as a bright one.
 */
const DOME_FRAGMENT = /* glsl */ `
  uniform float uDirect;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vToEye;
  varying float vHeight;
  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vToEye)), 0.0, 1.0);
    vec3 gain = vTint * (pow(facing, 1.5) * pow(1.0 - vHeight, 1.2));
    #ifdef SHAFT
      gl_FragColor = vec4(gain, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    #else
      gain = max(gain, vec3(-0.85));
      if (uDirect > 0.5) gain = pow(1.0 + gain, vec3(0.4545)) - 1.0;
      gl_FragColor = vec4(gain, 1.0);
    #endif
  }
`;

/**
 * One draw call's worth of marks: a shape repeated once per mark, with each mark's place, colour and atlas cell in
 * buffers that are refilled every frame and never reallocated.
 */
class MarkerLayer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly pose: Float32Array;
  private readonly tint: Float32Array;
  private readonly cell: Float32Array;
  private readonly attributes: THREE.InstancedBufferAttribute[];
  private count = 0;

  constructor(shape: THREE.BufferGeometry, readonly material: THREE.ShaderMaterial, private readonly capacity: number) {
    this.geometry.index = shape.index;
    // The shape rides in an attribute of its own and `position` is all zeros. A pass that draws the scene with a
    // material of its own (the depth for depth of field, the normals for ambient occlusion) knows nothing of the
    // marks' attributes: given the real shape as `position` it drew every mark as the bare shape standing at the
    // board's centre; given this, every triangle it draws has no area.
    const corner = shape.getAttribute("position");
    this.geometry.setAttribute("aCorner", corner);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(corner.count * 3), 3));
    this.geometry.setAttribute("uv", shape.getAttribute("uv"));
    this.pose = new Float32Array(capacity * 4);
    this.tint = new Float32Array(capacity * 4);
    this.cell = new Float32Array(capacity * 4);
    this.attributes = [this.pose, this.tint, this.cell].map((array) => new THREE.InstancedBufferAttribute(array, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aPose", this.attributes[0]);
    this.geometry.setAttribute("aTint", this.attributes[1]);
    this.geometry.setAttribute("aCell", this.attributes[2]);
    this.geometry.instanceCount = 0;
    // The layer stays in the scene with nothing in it. Its shader is then built with everything else under the
    // loading screen instead of on the first click, and a draw of no instances is skipped by the renderer.
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    // Whether the picture being drawn into is the screen itself (see POOL_FRAGMENT).
    this.mesh.onBeforeRender = (renderer) => {
      const direct = material.uniforms.uDirect;
      if (direct) direct.value = renderer.getRenderTarget() === null ? 1 : 0;
    };
  }

  begin(): void {
    this.count = 0;
  }

  /** Adds a mark: the four numbers of its pose, of its tint and of its cell (see the shaders). */
  add(p0: number, p1: number, p2: number, p3: number, t0: number, t1: number, t2: number, t3: number, c0 = 0, c1 = 0, c2 = 0, c3 = 0): void {
    if (this.count >= this.capacity) return;
    const i = this.count * 4;
    this.pose[i] = p0; this.pose[i + 1] = p1; this.pose[i + 2] = p2; this.pose[i + 3] = p3;
    this.tint[i] = t0; this.tint[i + 1] = t1; this.tint[i + 2] = t2; this.tint[i + 3] = t3;
    this.cell[i] = c0; this.cell[i + 1] = c1; this.cell[i + 2] = c2; this.cell[i + 3] = c3;
    this.count += 1;
  }

  end(): void {
    if (this.count === 0 && this.geometry.instanceCount === 0) return;
    this.geometry.instanceCount = this.count;
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The playing surface: 64 bevelled marble/basalt tiles on a carved base with a
 * bronze-trimmed, engraved border, plus the markers drawn on its squares.
 */
/** The baked tiles drawn as one (BoardView.batchBakedTiles): the tile meshes it copies, and their ids in it. */
interface BakedTileBatch {
  batch: THREE.BatchedMesh;
  meshes: THREE.Mesh[];
  ids: number[];
  /** True once the batch has the tiles' resting places. */
  settled: boolean;
}

const BATCH_INVERSE = new THREE.Matrix4();
const BATCH_MATRIX = new THREE.Matrix4();

export class BoardView {
  readonly group = new THREE.Group();
  readonly tiles: THREE.Mesh[] = [];

  private slots = new Map<SquareId, HighlightSlot>();
  private shrouds = new Map<SquareId, ShroudSlot>();
  /**
   * Light on the stone, then lines, shade and dust over it, then the light figures catch: three draw calls, and a
   * fourth while a promotion square is lit.
   */
  private pools: MarkerLayer;
  private over: MarkerLayer;
  private domes: MarkerLayer;
  private shafts: MarkerLayer;
  private cells = {} as Record<MarkerCell, [number, number]>;
  private colours = {} as Record<HighlightKind, [number, number, number]>;
  private cursorColour = lightColour(CURSOR_STYLE.color);
  private cursor = { x: 0, z: 0, light: false, wanted: false, level: 0 };
  /** A move asked for while the board was busy: the square its piece waits on and the square it is to go to. */
  private queued: Record<"queued" | "aim", QueuedMark> = {
    queued: { x: 0, z: 0, light: false, wanted: false, level: 0, age: 0 },
    aim: { x: 0, z: 0, light: false, wanted: false, level: 0, age: 0 },
  };
  private reducedMotion = false;
  /** Materials the arena theme repaints (tile contrast, base stone, trim). */
  private lightTileMaterial: THREE.MeshPhysicalMaterial;
  private darkTileMaterial: THREE.MeshPhysicalMaterial;
  private baseMaterial: THREE.MeshStandardMaterial | null = null;
  private borderMaterial: THREE.MeshStandardMaterial | null = null;
  private trimMaterial: THREE.MeshStandardMaterial | null = null;
  private arenaLook: ArenaLook | null = null;
  private presentationMode = false;
  private disposables: { dispose: () => void }[] = [];
  private elapsed = 0;
  private tileBySquare = new Map<SquareId, THREE.Mesh>();
  private jolts: TileJolt[] = [];
  private waves: ImpactWave[] = [];
  private waveCursor = 0;
  private landings: LandingRipple[] = [];
  private landingCursor = 0;
  /** The procedural base and bronze trim, hidden while the baked board stands in. */
  private frameMeshes: THREE.Mesh[] = [];
  /**
   * The arena's own board: its frame under `root`, its tiles re-parented onto the game tiles, and, where the tiles
   * share one material, `batch`: all 64 drawn in one call, each at its tile's place (see {@link batchBakedTiles}).
   */
  private bakedBoard: { root: THREE.Object3D; tiles: THREE.Object3D[]; batch: BakedTileBatch | null } | null = null;

  constructor() {
    this.group.name = "board";

    const lightMap = this.track(marbleTexture(false));
    const darkMap = this.track(marbleTexture(true));
    const lightMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: lightMap,
        bumpMap: lightMap,
        bumpScale: 0.018,
        color: 0xf6efe0,
        roughness: 0.22,
        metalness: 0.02,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      }),
    );
    const darkMaterial = this.track(
      new THREE.MeshPhysicalMaterial({
        map: darkMap,
        bumpMap: darkMap,
        bumpScale: 0.024,
        color: 0x23252c,
        roughness: 0.3,
        metalness: 0.12,
        clearcoat: 0.6,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.8,
      }),
    );

    this.lightTileMaterial = lightMaterial;
    this.darkTileMaterial = darkMaterial;

    const tileGeometry = this.track(new RoundedBoxGeometry(TILE * 0.97, 0.18, TILE * 0.97, 3, 0.035));

    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const light = isLightSquare(square);
        const tile = new THREE.Mesh(tileGeometry, light ? lightMaterial : darkMaterial);
        const position = squareToWorld(square, -0.09);
        tile.position.copy(position);
        tile.receiveShadow = true;
        tile.castShadow = false;
        tile.userData.square = square;
        tile.userData.home = position.clone();
        this.tileBySquare.set(square, tile);
        this.tiles.push(tile);
        this.group.add(tile);
      }
    }

    this.buildBase();

    const layers = this.buildMarkers();
    this.pools = layers.pools;
    this.over = layers.over;
    this.domes = layers.domes;
    this.shafts = layers.shafts;
    for (let i = 0; i < 4; i += 1) this.waves.push({ x: 0, z: 0, light: true, colour: [1, 1, 1], turn: 0, age: 0, duration: 0.6, strength: 1, flare: 1, flareTint: [1, 1, 1], ring: 1, active: false });
    for (let i = 0; i < 5; i += 1) this.landings.push({ x: 0, z: 0, light: true, colour: [1, 1, 1], turn: 0, age: 0, duration: 0.7, strength: 1, active: false });
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildBase(): void {
    const size = TILE * 8 + 1.5;
    const geometry = this.track(new RoundedBoxGeometry(size, 0.62, size, 4, 0.09));
    const stone = this.track(
      new THREE.MeshStandardMaterial({ color: 0x3b342b, roughness: 0.72, metalness: 0.25 }),
    );
    this.baseMaterial = stone;
    const top = this.track(
      new THREE.MeshStandardMaterial({
        map: this.track(boardBorderTexture()),
        color: 0xbfae8e,
        roughness: 0.55,
        metalness: 0.45,
        envMapIntensity: 1.1,
      }),
    );
    this.borderMaterial = top;
    const materials = [stone, stone, top, stone, stone, stone];
    const base = new THREE.Mesh(geometry, materials);
    base.position.y = -0.42;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    // Bronze trim: a thin torus-like frame catching bloom at grazing angles.
    const trimGeometry = this.track(new RoundedBoxGeometry(size + 0.18, 0.14, size + 0.18, 3, 0.06));
    const trim = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x8a6a33,
        roughness: 0.28,
        metalness: 0.95,
        emissive: 0x2a1a06,
        emissiveIntensity: 0.4,
        envMapIntensity: 1.4,
      }),
    );
    this.trimMaterial = trim;
    const trimMesh = new THREE.Mesh(trimGeometry, trim);
    trimMesh.position.y = -0.7;
    trimMesh.castShadow = true;
    this.group.add(trimMesh);
    this.frameMeshes.push(base, trimMesh);
  }

  /**
   * The layers every marker is drawn in, and the per-square state behind them. The markers have their own
   * materials and their own single texture; nothing is added to the stone's material.
   */
  private buildMarkers(): { pools: MarkerLayer; over: MarkerLayer; domes: MarkerLayer; shafts: MarkerLayer } {
    const atlas = this.track(markerAtlasTexture());
    for (const name of Object.keys(MARKER_STYLES) as HighlightKind[]) this.colours[name] = lightColour(MARKER_STYLES[name].color);
    for (const name of Object.keys(MARKER_CELLS) as MarkerCell[]) this.cells[name] = markerCellOrigin(name);

    // Light multiplies the stone: what is there, plus what is there times the light.
    const asLight = {
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
    } as const;
    const quad = new THREE.PlaneGeometry(1, 1);
    const pools = this.track(new MarkerLayer(quad, new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uCell: { value: 1 / MARKER_ATLAS_GRID }, uDirect: { value: 0 } },
      vertexShader: MARKER_VERTEX,
      fragmentShader: POOL_FRAGMENT,
      ...asLight,
    }), POOL_CAPACITY));
    // Lines and shade: the stone darkened by the mask's cover, then the line's light added.
    const over = this.track(new MarkerLayer(quad, new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uCell: { value: 1 / MARKER_ATLAS_GRID } },
      vertexShader: MARKER_VERTEX,
      fragmentShader: OVER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    }), OVER_CAPACITY));
    const dome = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const domes = this.track(new MarkerLayer(dome, new THREE.ShaderMaterial({
      uniforms: { uDirect: { value: 0 } },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      ...asLight,
    }), DOME_CAPACITY));
    const shafts = this.track(new MarkerLayer(dome, new THREE.ShaderMaterial({
      defines: { SHAFT: "" },
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }), SHAFT_CAPACITY));

    pools.mesh.name = "markers-pools";
    pools.mesh.position.y = BOARD_TOP + 0.006;
    pools.mesh.renderOrder = 2;
    over.mesh.name = "markers-over";
    over.mesh.position.y = BOARD_TOP + 0.014;
    over.mesh.renderOrder = 4;
    domes.mesh.name = "markers-figures";
    domes.mesh.position.y = BOARD_TOP + 0.016;
    domes.mesh.renderOrder = 5;
    shafts.mesh.name = "markers-shafts";
    shafts.mesh.position.y = BOARD_TOP + 0.016;
    shafts.mesh.renderOrder = 6;
    this.group.add(pools.mesh, over.mesh, domes.mesh, shafts.mesh);

    let index = 0;
    for (let rank = 1; rank <= 8; rank += 1) {
      for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
        const square = `${FILES[fileIndex]}${rank}`;
        const { x, z } = squareToWorld(square);
        this.slots.set(square, { x, z, light: isLightSquare(square), kind: null, wanted: false, level: 0, delay: 0, age: 0, pulse: false, phase: (index % 7) * 0.42, turn: 0 });
        this.shrouds.set(square, { x, z, target: 0, current: 0, delay: 0 });
        index += 1;
      }
    }
    return { pools, over, domes, shafts };
  }

  /**
   * With motion reduced the markers stand at their full, steady strength the moment they are set: nothing comes
   * up, breathes or spreads. Every marker is told apart by its shape, so nothing is lost.
   */
  setReducedMotion(active: boolean): void {
    this.reducedMotion = active;
  }

  /**
   * Shades every square except `reachable`, so the lit destinations read at once instead of competing with 64
   * evenly lit tiles. Pass `null` to lift the shade. `origin` staggers the fade so it closes in from the chosen piece.
   */
  setShroud(reachable: Iterable<SquareId> | null, origin?: SquareId): void {
    if (!reachable) {
      for (const slot of this.shrouds.values()) {
        slot.target = 0;
        slot.delay = 0;
      }
      return;
    }
    const lit = new Set<SquareId>(reachable);
    const originPosition = origin ? squareToWorld(origin) : null;
    for (const [square, slot] of this.shrouds) {
      const clear = lit.has(square);
      slot.target = clear ? 0 : SHROUD_OPACITY;
      slot.delay =
        clear || !originPosition
          ? 0
          : Math.min((squareToWorld(square).distanceTo(originPosition) / TILE) * 0.016, 0.12);
    }
  }

  /** Eases each square's shade and draws it: one square of plain shade, the stone's detail still showing in it. */
  private drawShroud(delta: number): void {
    for (const slot of this.shrouds.values()) {
      if (this.reducedMotion) {
        slot.delay = 0;
        slot.current = slot.target;
      } else if (slot.delay > 0) {
        slot.delay -= delta;
      } else if (Math.abs(slot.target - slot.current) < 0.002) {
        slot.current = slot.target;
      } else {
        // Closes in a touch slower than it lifts, so releasing feels snappy.
        const speed = slot.target > slot.current ? 8 : 13;
        slot.current += (slot.target - slot.current) * Math.min(1, delta * speed);
      }
      if (slot.current > 0.004) this.over.add(slot.x, slot.z, TILE, 0, 0, 0, 0, slot.current, 0, 0, -1, 0);
    }
  }

  /**
   * Arrival on a square: a breath of the side's light on the stone and a ring of dust rolling out from under the
   * figure's feet, and the tile takes a small dip. Softer and slower than {@link impact}: this is weight settling,
   * not a blow.
   */
  land(square: SquareId, color = 0xffd6a0, strength = 1): void {
    const centre = squareToWorld(square);
    const ripple = this.landings[this.landingCursor % this.landings.length];
    this.landingCursor += 1;
    ripple.age = 0;
    ripple.duration = 0.62 + strength * 0.16;
    ripple.strength = strength;
    ripple.active = true;
    ripple.x = centre.x;
    ripple.z = centre.z;
    ripple.light = isLightSquare(square);
    ripple.turn = Math.random() * Math.PI * 2;
    ripple.colour = lightColour(color);

    this.joltTiles(square, strength * 0.42, 1.4);
  }

  /**
   * Capture impact on a square: a white-hot flash on the stone that decays into a thin coloured shock running out
   * through a ring of dust, while the struck tile and its neighbours are jolted out of the board and bounce back.
   * `flare` dims the flash (0: none) and `ring` the dust and heat (0: none), so a fight watched from close in is not
   * outshone by its tile; `flareColor` tints the flash (warm white for steel and powder, a spell's own for a spell).
   */
  impact(square: SquareId, color = 0xff6a3c, strength = 1, flare = 1, ring = 1, flareColor = 0xfff3d2): void {
    // Neither a ring nor a flare (a library spell, which draws its own blow; a blade going into a body): the tiles only jolt.
    if (flare <= 0 && ring <= 0) { this.joltTiles(square, strength, 2.2); return; }
    const centre = squareToWorld(square);
    const wave = this.waves[this.waveCursor % this.waves.length];
    this.waveCursor += 1;
    wave.age = 0;
    wave.duration = 0.6;
    wave.strength = strength;
    wave.active = true;
    wave.x = centre.x;
    wave.z = centre.z;
    wave.light = isLightSquare(square);
    wave.turn = Math.random() * Math.PI;
    wave.colour = lightColour(color);
    wave.flare = Math.min(1, Math.max(0, flare));
    wave.ring = Math.min(1, Math.max(0, ring));
    const tint = new THREE.Color(flareColor), warm = new THREE.Color(0xfff3d2);
    wave.flareTint = [tint.r / warm.r, tint.g / warm.g, tint.b / warm.b];

    this.joltTiles(square, strength, 2.2);
  }

  /** Shock spreads outward: neighbours kick later and weaker than the centre. */
  private joltTiles(square: SquareId, strength: number, reach: number): void {
    if (strength <= 0) return;
    const origin = squareToWorld(square);
    for (const [target, tile] of this.tileBySquare) {
      const distance = squareToWorld(target).distanceTo(origin) / TILE;
      if (distance > reach) continue;
      const falloff = Math.max(0, 1 - distance / (reach + 0.2));
      const amount = strength * falloff * falloff;
      if (amount < 0.04) continue;
      this.jolts = this.jolts.filter((entry) => entry.tile !== tile);
      this.jolts.push({
        tile,
        home: (tile.userData.home as THREE.Vector3).clone(),
        age: -distance * 0.035,
        strength: amount,
        duration: 0.5 + distance * 0.06,
        seed: Math.random() * Math.PI * 2,
      });
    }
  }

  private updateJolts(delta: number): void {
    for (let i = this.jolts.length - 1; i >= 0; i -= 1) {
      const jolt = this.jolts[i];
      jolt.age += delta;
      if (jolt.age < 0) continue;
      const t = jolt.age / jolt.duration;
      if (t >= 1) {
        jolt.tile.position.copy(jolt.home);
        jolt.tile.rotation.set(0, 0, 0);
        this.jolts.splice(i, 1);
        continue;
      }
      // Damped oscillation: punched down first, then settling.
      const decay = Math.exp(-t * 6.5) * (1 - t);
      const swing = Math.sin(jolt.age * 34 + jolt.seed) * decay * jolt.strength;
      jolt.tile.position.set(
        jolt.home.x + Math.sin(jolt.age * 41 + jolt.seed) * decay * jolt.strength * 0.035,
        jolt.home.y - swing * 0.13,
        jolt.home.z + Math.cos(jolt.age * 38 + jolt.seed) * decay * jolt.strength * 0.035,
      );
      jolt.tile.rotation.set(swing * 0.05, 0, Math.cos(jolt.age * 30 + jolt.seed) * decay * jolt.strength * 0.05);
    }
  }

  /** Advances and draws the blows and landings in the air. With motion reduced only their light is shown. */
  private drawImpacts(delta: number): void {
    for (const ripple of this.landings) {
      if (!ripple.active) continue;
      ripple.age += delta;
      const t = ripple.age / ripple.duration;
      if (t >= 1) {
        ripple.active = false;
        continue;
      }
      const r = ripple.colour[0];
      const g = ripple.colour[1];
      const b = ripple.colour[2];
      // The side's light under the figure dies quicker than the dust travels, and is half way to white: it is
      // the stone catching light, not a coloured disc.
      const glowT = Math.min(1, ripple.age / (ripple.duration * 0.45));
      const tile = ripple.light ? TILE_RESPONSE.pale : TILE_RESPONSE.dark;
      const glow = Math.pow(1 - glowT, 2.1) * 1.7 * ripple.strength * tile.lift;
      if (glow > 0.004) {
        const shift = tile.shift * 0.5;
        this.pools.add(ripple.x, ripple.z, TILE * (1.1 + glowT * 0.5), 0, glow * (0.5 + r * 0.5 - shift), glow * (0.5 + g * 0.5 - shift), glow * (0.5 + b * 0.5 - shift), 0, this.cells.poolRound[0], this.cells.poolRound[1], 1, 0);
      }
      if (this.reducedMotion) continue;
      // The dust rolls out fast then coasts, thinning as it goes.
      const eased = 1 - Math.pow(1 - t, 3);
      const dust = Math.sin(Math.PI * Math.pow(t, 0.55)) * 0.5 * ripple.strength;
      this.over.add(ripple.x, ripple.z, TILE * (0.5 + eased * (1.2 + ripple.strength * 0.7)), ripple.turn + ripple.age * 0.35, DUST[0] * dust, DUST[1] * dust, DUST[2] * dust, dust * 0.7, this.cells.dust[0], this.cells.dust[1], 1, 0);
    }

    for (const wave of this.waves) {
      if (!wave.active) continue;
      wave.age += delta;
      const t = wave.age / wave.duration;
      if (t >= 1) {
        wave.active = false;
        continue;
      }
      const r = wave.colour[0];
      const g = wave.colour[1];
      const b = wave.colour[2];
      // The flash is a two-frame blowout: it peaks at once and is gone in under a fifth of a second.
      const flashT = Math.min(1, wave.age / 0.18);
      const flash = Math.pow(1 - flashT, 2) * wave.flare;
      const [fr, fg, fb] = wave.flareTint;
      if (flash > 0.004) {
        const lift = wave.light ? 1 : 2;
        this.pools.add(wave.x, wave.z, TILE * (1.4 + flashT * 0.8), 0, flash * 2.2 * lift * fr, flash * 1.9 * lift * fg, flash * 1.5 * lift * fb, 0, this.cells.poolRound[0], this.cells.poolRound[1], 1, 0);
        this.over.add(wave.x, wave.z, TILE * (0.8 + flashT * 0.9), 0, flash * 1.6 * fr, flash * 1.25 * fg, flash * 0.8 * fb, 0, this.cells.flash[0], this.cells.flash[1], 1, 1);
      }
      if (this.reducedMotion) continue;
      const eased = 1 - Math.pow(1 - t, 2.6);
      const fade = Math.pow(1 - t, 1.7);
      const dust = fade * 0.5 * wave.ring;
      const turn = wave.turn + wave.age * 0.6;
      this.over.add(wave.x, wave.z, TILE * (0.7 + eased * 3), turn, DUST[0] * dust, DUST[1] * dust, DUST[2] * dust, dust * 0.7, this.cells.dust[0], this.cells.dust[1], 1, 0);
      // The shock itself is a thin line of heat inside the dust, not a drawn ring: it is the faintest part.
      const shock = fade * 0.9 * wave.ring;
      this.over.add(wave.x, wave.z, TILE * (0.6 + eased * 3.2), turn, r * shock, g * shock, b * shock, 0, this.cells.shock[0], this.cells.shock[1], 1, 0.35);
    }
  }

  /**
   * Puts out the markers (all of them, or those of the given kinds). They fade rather than vanish, so a marker
   * cleared and set again in the same moment (the last move, after a selection is dropped) never blinks.
   */
  clearHighlights(kinds?: HighlightKind[]): void {
    if (!kinds) this.setShroud(null);
    for (const slot of this.slots.values()) {
      if (kinds && slot.kind && !kinds.includes(slot.kind)) continue;
      slot.wanted = false;
      slot.pulse = false;
    }
  }

  /**
   * Lights a square up. `delay` staggers the markers so a fan of legal moves spreads outward from the selected
   * piece instead of appearing all at once.
   */
  setHighlight(square: SquareId, kind: HighlightKind, pulse = false, delay = 0): void {
    const slot = this.slots.get(square);
    if (!slot) return;
    if (slot.kind !== kind) {
      slot.kind = kind;
      slot.level = 0;
      slot.age = 0;
      slot.delay = delay;
    }
    slot.wanted = true;
    slot.pulse = pulse;
    // A crown has a right way up: it faces the side promoting, White on the eighth rank and Black on the first.
    // So has the mark on a pawn taken in passing: its arrowheads point to the square its captor lands on, which
    // lies beyond it, toward the eighth rank when White captures (the pawn stands on the fifth) and the first
    // when Black does (it stands on the fourth).
    slot.turn = (kind === "promote" && square[1] === "1") || (kind === "enpassant" && square[1] === "4") ? Math.PI : 0;
  }

  /**
   * Marks a move a player has asked for while the board was busy (SceneEngine.holdTap, queueMove): a frame of
   * dashes round the piece that waits to go and, once it is chosen, the square it is to go to; null takes a mark
   * away. They are the board's own, apart from the squares' markers, so the move on stage, which puts those out
   * and relights them as it plays, leaves these be. Where motion is reduced they are simply there, and gone.
   */
  setQueued(from: SquareId | null, to: SquareId | null = null): void {
    this.placeQueued(this.queued.queued, from);
    this.placeQueued(this.queued.aim, to);
  }

  private placeQueued(mark: QueuedMark, square: SquareId | null): void {
    const slot = square ? this.slots.get(square) : null;
    if (!slot) {
      mark.wanted = false;
      return;
    }
    // On a new square it comes up afresh, catching as any marker does when it is lit.
    if (!mark.wanted || mark.x !== slot.x || mark.z !== slot.z) {
      mark.level = 0;
      mark.age = 0;
    }
    mark.x = slot.x;
    mark.z = slot.z;
    mark.light = slot.light;
    mark.wanted = true;
  }

  private drawQueued(kind: "queued" | "aim", delta: number): void {
    const mark = this.queued[kind];
    const still = this.reducedMotion;
    if (still) mark.level = mark.wanted ? 1 : 0;
    else if (!mark.wanted) mark.level = Math.max(0, mark.level - delta / MARKER_FALL);
    else {
      mark.level = Math.min(1, mark.level + delta / MARKER_RISE);
      mark.age += delta;
    }
    if (mark.level <= 0) return;
    // It waits: the slow breath of a square that asks for attention, both marks together.
    const breath = still ? 1 : 0.84 + (Math.sin(this.elapsed * 3.4) + 1) * 0.08;
    const catching = still || mark.age > MARKER_RISE * 2 ? 1 : 1 + 0.7 * Math.sin((Math.PI * mark.age) / (MARKER_RISE * 2));
    const level = mark.level * mark.level * (3 - 2 * mark.level);
    this.drawMarker(MARKER_STYLES[kind], this.colours[kind], mark.x, mark.z, mark.light, 0, level * breath, catching);
  }

  /**
   * Draws the eye back to a square that is already marked (the King in check, when a move that leaves it there is
   * refused): its light dips and comes up again, catching as it did when it was first lit. Nothing moves where
   * motion is reduced.
   */
  flare(square: SquareId): void {
    const slot = this.slots.get(square);
    if (!slot?.kind || !slot.wanted) return;
    slot.age = 0;
    slot.level = Math.min(slot.level, FLARE_DIP);
  }

  /** The square under the pointer, or under the keyboard cursor; null for none. */
  setHover(square: SquareId | null): void {
    if (!square) {
      this.cursor.wanted = false;
      return;
    }
    const slot = this.slots.get(square);
    if (!slot) return;
    this.cursor.x = slot.x;
    this.cursor.z = slot.z;
    this.cursor.light = slot.light;
    this.cursor.wanted = true;
  }

  /**
   * One marker: its pool of light on the stone, its cut line and, where a figure may stand, the light it catches.
   * `flare` brightens the line alone, for the moment it catches as it comes up.
   */
  private drawMarker(style: MarkerStyle, colour: [number, number, number], x: number, z: number, light: boolean, turn: number, strength: number, flare: number): void {
    const r = colour[0];
    const g = colour[1];
    const b = colour[2];
    const tile = light ? TILE_RESPONSE.pale : TILE_RESPONSE.dark;
    const lift = style.lift * strength * tile.lift;
    const pool = this.cells[style.pool];
    this.pools.add(x, z, TILE, 0, (r - tile.shift) * lift, (g - tile.shift) * lift, (b - tile.shift) * lift, 0, pool[0], pool[1], 1, 0);
    const line = style.line * strength * flare * tile.line;
    const inlay = this.cells[style.inlay];
    // The cut channel is what carries a line on pale stone. On a dark tile it would be darkness drawn on darkness,
    // so there it is kept faint: just enough to stop the line's glow from flattening the stone round it.
    this.over.add(x, z, TILE, turn, r * line, g * line, b * line, (light ? 0.85 : 0.35) * strength, inlay[0], inlay[1], 1, style.hot * tile.hot);
    if (style.figure > 0) {
      // A figure is neither pale stone nor dark: it takes the light part as colour, part as brightness.
      const caught = style.figure * strength;
      this.domes.add(x, z, TILE * 0.46, 0.62, (r - 0.2) * caught, (g - 0.2) * caught, (b - 0.2) * caught, 0);
    }
    if (style.shaft) {
      const standing = style.shaft * strength;
      this.shafts.add(x, z, TILE * 0.4, 1.9, r * standing, g * standing, b * standing, 0);
    }
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.updateJolts(delta);
    // The batched baked tiles follow their tiles while any is jolting, and once more as the last comes to rest.
    const batch = this.bakedBoard?.batch;
    if (batch && (this.jolts.length > 0 || !batch.settled)) {
      this.placeBakedTiles(batch);
      batch.settled = this.jolts.length === 0;
    }
    const still = this.reducedMotion;

    this.pools.begin();
    this.over.begin();
    this.domes.begin();
    this.shafts.begin();

    // Shade first: the lines and dust of the same layer are drawn over it.
    this.drawShroud(delta);

    for (const slot of this.slots.values()) {
      const kind = slot.kind;
      if (!kind) continue;
      if (still) {
        slot.delay = 0;
        slot.level = slot.wanted ? 1 : 0;
      } else if (!slot.wanted) {
        slot.level -= delta / MARKER_FALL;
      } else if (slot.delay > 0) {
        slot.delay -= delta;
      } else {
        slot.level = Math.min(1, slot.level + delta / MARKER_RISE);
        slot.age += delta;
      }
      if (slot.level <= 0) {
        if (!slot.wanted) slot.kind = null;
        continue;
      }
      // A slow breath, deeper on the squares that ask for attention. It never takes a marker below four fifths
      // of its strength: the breath is life in the light, not something the marker needs to be read.
      const wave = still ? 1 : (Math.sin(this.elapsed * (slot.pulse ? 5.6 : 3.4) + slot.phase) + 1) * 0.5;
      const breath = slot.pulse ? 0.8 + wave * 0.2 : 0.94 + wave * 0.06;
      // The line catches as it comes up: brighter for a moment, then settled.
      const catching = still || slot.age > MARKER_RISE * 2 ? 1 : 1 + 0.7 * Math.sin((Math.PI * slot.age) / (MARKER_RISE * 2));
      const level = slot.level * slot.level * (3 - 2 * slot.level);
      this.drawMarker(MARKER_STYLES[kind], this.colours[kind], slot.x, slot.z, slot.light, slot.turn, level * breath, catching);
    }

    // A queued move over the squares' own markers (the last move may lie under either of its squares).
    this.drawQueued("queued", delta);
    this.drawQueued("aim", delta);

    this.drawImpacts(delta);

    // The cursor last, so nothing is drawn over it.
    const cursor = this.cursor;
    if (still) cursor.level = cursor.wanted ? 1 : 0;
    else cursor.level = Math.max(0, Math.min(1, cursor.level + (cursor.wanted ? delta / 0.09 : -delta / 0.16)));
    if (cursor.level > 0) this.drawMarker(CURSOR_STYLE, this.cursorColour, cursor.x, cursor.z, cursor.light, 0, cursor.level, 1);

    this.pools.end();
    this.over.end();
    this.domes.end();
    this.shafts.end();
  }

  /**
   * Retunes the playing surface for an arena theme. The dark squares carry the
   * most weight here: near-black basalt swallows the obsidian army under low
   * light, so daylight themes lift them to a readable slate.
   */
  applyArena(look: ArenaLook): void {
    this.arenaLook = look;
    if (this.presentationMode) return;
    this.lightTileMaterial.color.setHex(look.board.light);
    this.darkTileMaterial.color.setHex(look.board.dark);
    this.baseMaterial?.color.setHex(look.board.base);
    this.borderMaterial?.color.setHex(look.board.border);
    this.trimMaterial?.color.setHex(look.board.trim);
  }

  /**
   * Title-screen material profile. The board remains legible as a crafted
   * object, but stops being the brightest, glossiest subject in the frame.
   */
  setPresentationMode(active: boolean): void {
    if (this.presentationMode === active) return;
    this.presentationMode = active;
    this.clearHighlights();
    this.setHover(null);
    if (active) {
      this.lightTileMaterial.color.setHex(0xbab09c);
      this.lightTileMaterial.roughness = 0.5;
      this.lightTileMaterial.clearcoat = 0.2;
      this.lightTileMaterial.envMapIntensity = 0.55;
      this.darkTileMaterial.color.setHex(0x34363b);
      this.darkTileMaterial.roughness = 0.57;
      this.darkTileMaterial.clearcoat = 0.16;
      this.darkTileMaterial.envMapIntensity = 0.5;
      if (this.trimMaterial) {
        this.trimMaterial.emissiveIntensity = 0;
        this.trimMaterial.roughness = 0.48;
      }
      return;
    }

    this.lightTileMaterial.roughness = 0.22;
    this.lightTileMaterial.clearcoat = 0.7;
    this.lightTileMaterial.envMapIntensity = 0.9;
    this.darkTileMaterial.roughness = 0.3;
    this.darkTileMaterial.clearcoat = 0.6;
    this.darkTileMaterial.envMapIntensity = 0.8;
    if (this.trimMaterial) {
      this.trimMaterial.emissiveIntensity = 0.4;
      this.trimMaterial.roughness = 0.28;
    }
    if (this.arenaLook) this.applyArena(this.arenaLook);
  }

  /**
   * Stands the arena's own board in for the procedural one: the Blender board with its marble, onyx, carved stone and
   * gold baked into textures (one `CFCL_Board_Tile_<square>` per square, plus base, border, bronze, plaques and inlay),
   * scaled so its squares land on {@link squareToWorld}. Each baked tile rides on its game tile, so impact jolts still
   * move it. The game tiles stop drawing but remain the pick targets; the markers, shade and impact effects draw over
   * the baked surface unchanged. The board owns the model from here: it is disposed when replaced,
   * on `null` (which brings the procedural board back) and in {@link dispose}.
   */
  setBakedBoard(model: THREE.Object3D | null): void {
    this.clearBakedBoard();
    const procedural = model === null;
    this.lightTileMaterial.visible = procedural;
    this.darkTileMaterial.visible = procedural;
    for (const mesh of this.frameMeshes) mesh.visible = procedural;
    if (!model) return;

    // Baked tiles are attached relative to the tiles' rest poses.
    for (const jolt of this.jolts) {
      jolt.tile.position.copy(jolt.home);
      jolt.tile.rotation.set(0, 0, 0);
    }
    this.jolts = [];
    const root = new THREE.Group();
    root.name = "board-baked";
    root.scale.setScalar(TILE / BAKED_BOARD_PITCH);
    root.add(model);
    this.group.add(root);
    this.group.updateMatrixWorld(true);
    const pairs: [THREE.Object3D, THREE.Mesh][] = [];
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.receiveShadow = true;
        mesh.castShadow = false;
      }
      const square = /^CFCL_Board_Tile_([a-h][1-8])$/.exec(object.name)?.[1];
      const tile = square ? this.tileBySquare.get(square) : undefined;
      if (tile) pairs.push([object, tile]);
    });
    for (const [object, tile] of pairs) tile.attach(object);
    const tiles = pairs.map(([object]) => object);
    this.bakedBoard = { root, tiles, batch: this.batchBakedTiles(tiles) };
  }

  /**
   * The 64 baked tiles as one draw (A-14): a BatchedMesh in the board's frame holds each tile's geometry, placed where
   * its tile mesh is, and the tile meshes stop drawing. They stay where they were, riding their game tiles, as the
   * places the batch copies while a jolt moves them. Left as separate meshes when the tiles do not share one material
   * or one layout of attributes.
   */
  private batchBakedTiles(tiles: THREE.Object3D[]): BakedTileBatch | null {
    const meshes: THREE.Mesh[] = [];
    for (const tile of tiles) tile.traverse((node) => { if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh); });
    if (meshes.length < 2) return null;
    const material = meshes[0].material;
    const layout = (geometry: THREE.BufferGeometry) => `${geometry.index ? "i" : "n"}:${Object.keys(geometry.attributes).sort().join(",")}`;
    const shape = layout(meshes[0].geometry);
    if (Array.isArray(material) || meshes.some((mesh) => mesh.material !== material || layout(mesh.geometry) !== shape || mesh.geometry.groups.length > 1)) return null;
    let vertices = 0, indices = 0;
    for (const mesh of meshes) { vertices += mesh.geometry.attributes.position.count; indices += mesh.geometry.index?.count ?? 0; }
    const batch = new THREE.BatchedMesh(meshes.length, vertices, Math.max(indices, 1), material);
    batch.name = "board-baked-tiles";
    batch.receiveShadow = true;
    batch.castShadow = false;
    const ids = meshes.map((mesh) => batch.addInstance(batch.addGeometry(mesh.geometry)));
    for (const mesh of meshes) mesh.visible = false;
    this.group.add(batch);
    const entry: BakedTileBatch = { batch, meshes, ids, settled: false };
    this.placeBakedTiles(entry);
    return entry;
  }

  /** Copies each baked tile's place into the batch. */
  private placeBakedTiles(entry: BakedTileBatch): void {
    this.group.updateWorldMatrix(true, false);
    const inverse = BATCH_INVERSE.copy(this.group.matrixWorld).invert();
    for (let index = 0; index < entry.meshes.length; index += 1) {
      const mesh = entry.meshes[index];
      mesh.updateWorldMatrix(true, false);
      entry.batch.setMatrixAt(entry.ids[index], BATCH_MATRIX.multiplyMatrices(inverse, mesh.matrixWorld));
    }
  }

  private clearBakedBoard(): void {
    if (!this.bakedBoard) return;
    if (this.bakedBoard.batch) {
      this.bakedBoard.batch.batch.removeFromParent();
      this.bakedBoard.batch.batch.dispose();
    }
    const resources = new Set<{ dispose: () => void }>();
    for (const part of [this.bakedBoard.root, ...this.bakedBoard.tiles]) {
      part.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        resources.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          resources.add(material);
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) resources.add(value);
          }
        }
      });
      part.removeFromParent();
    }
    for (const resource of resources) resource.dispose();
    this.bakedBoard = null;
  }

  dispose(): void {
    this.clearBakedBoard();
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.slots.clear();
    this.shrouds.clear();
    this.group.clear();
  }
}
