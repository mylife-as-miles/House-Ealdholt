/**
 * Floating rank badges — the little crests that hang over the figures a player
 * could not otherwise tell apart.
 *
 * Each badge is a canvas-drawn piece of worked metal: a heater shield for
 * White, a stepped sun disc for Black, enamelled in the side's colour inside a
 * bevelled bezel, with a chess silhouette raised on it. Textures are cached per
 * kind + faction (12 in total) and shared by every sprite, so the whole set
 * costs a dozen small textures.
 */

import * as THREE from "three";

import type { Faction, PieceKind } from "../core/types";

const SIZE = 256;

interface BadgeTheme {
  /** The bezel's metal, on its lit side and its shaded side. */
  rimLight: string;
  rimDark: string;
  /** The enamel field, at its lit centre and at its edge. */
  field: string;
  fieldEdge: string;
  /** The raised device: its face, top to bottom, the light along its upper edges and the shade under it. */
  glyph: string;
  glyphLow: string;
  glyphLight: string;
  glyphShade: string;
}

/**
 * Each crest is flooded with its own side's field, so it carries the same
 * azure/ember code as the light under the figure's feet and on its silhouette,
 * and each has its own shape, so the code survives without colour.
 *
 * The colours are those of an object in the arena, not of a sign on the screen:
 * steel and deep blue enamel for White, brass and oxblood for Black, no glow
 * around the plate and nothing at full brightness but a thin catch-light on the
 * device. A crest that shone read as a sticker on a realistic scene; a dark
 * plate with a pale device reads as well at badge size and sits in the picture.
 */
const THEMES: Record<Faction, BadgeTheme> = {
  w: {
    rimLight: "#dfe5ee",
    rimDark: "#5d6877",
    field: "#27467a",
    fieldEdge: "#121f3a",
    glyph: "#e8edf4",
    glyphLow: "#b9c3d1",
    glyphLight: "#ffffff",
    glyphShade: "rgba(4,10,24,0.8)",
  },
  b: {
    rimLight: "#ecc98d",
    rimDark: "#74501f",
    field: "#742017",
    fieldEdge: "#300a06",
    glyph: "#f4dfb4",
    glyphLow: "#d2b27c",
    glyphLight: "#fff7df",
    glyphShade: "rgba(22,4,2,0.8)",
  },
};

/** Badge width in world units (1 unit = one board square). */
export const BADGE_SCALE: Record<PieceKind, number> = {
  p: 0.31,
  // The officer ranks stand a fifth of a square over the pawns (see `PIECE_HEIGHT`),
  // and a pawn-sized crest over a champion read as an undersized sticker.
  n: 0.37,
  b: 0.37,
  r: 0.37,
  q: 0.38,
  k: 0.4,
};

/** Height above the figure's crown where its badge hangs: close, so it belongs to its figure. */
export const BADGE_LIFT = 0.24;

/** How solid a crest is at rest, where it shows at all. */
export const CREST_REST = 0.92;

/**
 * A figure's crest shows in full while one board square, stood on end where the figure is, is under this fraction
 * of the picture's height, and is gone once it is over the second. From where a game is played that is the far half
 * of the board: the opponent's figures, a few dozen pixels tall.
 */
const CREST_SHOWN_UNDER = 0.095;
const CREST_GONE_OVER = 0.125;

/**
 * How much of its crest a figure shows at rest, 0 to 1, from how large it is drawn (`unit`: the height on screen of
 * one board square stood on end at the figure, as a fraction of the picture's height).
 *
 * A crest is there to tell small figures apart. Over a figure large enough to be known by its own shape it is
 * clutter on a realistic scene, and thirty-two of them hid the armies they labelled. So a crest fades out as its
 * figure grows on screen (towards the camera, or as the camera closes in) and comes back as it shrinks. The
 * selected figure and the one under the pointer show theirs whatever their size (see PieceView).
 */
export function crestPresence(unit: number): number {
  const t = Math.max(0, Math.min(1, (unit - CREST_SHOWN_UNDER) / (CREST_GONE_OVER - CREST_SHOWN_UNDER)));
  return 1 - t * t * (3 - 2 * t);
}

function canvas2d(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  return { canvas, ctx };
}

// --------------------------------------------------------------- plaque shapes

/** Gothic heater crest — the ivory kingdom's shield. */
function heaterPlate(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(16, 20);
  ctx.quadraticCurveTo(50, 10, 84, 20);
  ctx.lineTo(84, 52);
  ctx.quadraticCurveTo(84, 80, 50, 93);
  ctx.quadraticCurveTo(16, 80, 16, 52);
  ctx.closePath();
}

/** Stepped sun disc — the Sun Empire's obsidian medallion. */
function sunPlate(ctx: CanvasRenderingContext2D): void {
  const cx = 50;
  const cy = 51;
  const outer = 38;
  const inner = 32;
  const steps = 12;
  ctx.beginPath();
  for (let i = 0; i < steps * 2; i += 1) {
    const angle = (i / (steps * 2)) * Math.PI * 2 - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------- piece glyphs

function pedestal(ctx: CanvasRenderingContext2D, top: number): void {
  ctx.moveTo(31, top);
  ctx.lineTo(69, top);
  ctx.lineTo(75, top + 9);
  ctx.lineTo(25, top + 9);
  ctx.closePath();
}

function pawnGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(50, 33, 11, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(38, 45);
  ctx.lineTo(62, 45);
  ctx.lineTo(59, 52);
  ctx.lineTo(41, 52);
  ctx.closePath();
  ctx.moveTo(42, 52);
  ctx.quadraticCurveTo(38, 63, 34, 70);
  ctx.lineTo(66, 70);
  ctx.quadraticCurveTo(62, 63, 58, 52);
  ctx.closePath();
  pedestal(ctx, 70);
}

function rookGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(29, 24);
  ctx.lineTo(38, 24);
  ctx.lineTo(38, 31);
  ctx.lineTo(45, 31);
  ctx.lineTo(45, 24);
  ctx.lineTo(55, 24);
  ctx.lineTo(55, 31);
  ctx.lineTo(62, 31);
  ctx.lineTo(62, 24);
  ctx.lineTo(71, 24);
  ctx.lineTo(71, 41);
  ctx.lineTo(29, 41);
  ctx.closePath();
  ctx.moveTo(35, 41);
  ctx.lineTo(65, 41);
  ctx.lineTo(62, 69);
  ctx.lineTo(38, 69);
  ctx.closePath();
  pedestal(ctx, 69);
}

function knightGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(36, 71);
  ctx.quadraticCurveTo(33, 55, 37, 44);
  ctx.lineTo(26, 41);
  ctx.quadraticCurveTo(21, 39, 25, 34);
  ctx.lineTo(37, 27);
  ctx.lineTo(38, 15);
  ctx.lineTo(47, 24);
  ctx.lineTo(52, 14);
  ctx.lineTo(58, 25);
  ctx.quadraticCurveTo(73, 34, 71, 52);
  ctx.quadraticCurveTo(69, 64, 63, 71);
  ctx.closePath();
  pedestal(ctx, 71);
}

function bishopGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(50, 17, 5, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(50, 22);
  ctx.quadraticCurveTo(69, 36, 65, 52);
  ctx.lineTo(35, 52);
  ctx.quadraticCurveTo(31, 36, 50, 22);
  ctx.closePath();
  ctx.moveTo(36, 54);
  ctx.lineTo(64, 54);
  ctx.lineTo(61, 61);
  ctx.lineTo(39, 61);
  ctx.closePath();
  ctx.moveTo(40, 61);
  ctx.lineTo(60, 61);
  ctx.lineTo(63, 70);
  ctx.lineTo(37, 70);
  ctx.closePath();
  pedestal(ctx, 70);
}

function crownGlyph(ctx: CanvasRenderingContext2D, king: boolean): void {
  ctx.beginPath();
  if (king) {
    ctx.moveTo(46, 10);
    ctx.lineTo(54, 10);
    ctx.lineTo(54, 16);
    ctx.lineTo(60, 16);
    ctx.lineTo(60, 23);
    ctx.lineTo(54, 23);
    ctx.lineTo(54, 30);
    ctx.lineTo(46, 30);
    ctx.lineTo(46, 23);
    ctx.lineTo(40, 23);
    ctx.lineTo(40, 16);
    ctx.lineTo(46, 16);
    ctx.closePath();
    ctx.moveTo(31, 32);
    ctx.lineTo(69, 32);
    ctx.lineTo(65, 46);
    ctx.lineTo(35, 46);
    ctx.closePath();
  } else {
    ctx.moveTo(30, 47);
    ctx.lineTo(30, 22);
    ctx.lineTo(40, 36);
    ctx.lineTo(50, 18);
    ctx.lineTo(60, 36);
    ctx.lineTo(70, 22);
    ctx.lineTo(70, 47);
    ctx.closePath();
    for (const [x, y] of [
      [30, 20],
      [50, 16],
      [70, 20],
    ]) {
      ctx.moveTo(x + 4, y);
      ctx.arc(x, y, 4, 0, Math.PI * 2);
    }
  }
  ctx.moveTo(34, 48);
  ctx.lineTo(66, 48);
  ctx.lineTo(63, 56);
  ctx.lineTo(37, 56);
  ctx.closePath();
  ctx.moveTo(38, 56);
  ctx.quadraticCurveTo(35, 64, 33, 70);
  ctx.lineTo(67, 70);
  ctx.quadraticCurveTo(65, 64, 62, 56);
  ctx.closePath();
  pedestal(ctx, 70);
}

const GLYPHS: Record<PieceKind, (ctx: CanvasRenderingContext2D) => void> = {
  p: pawnGlyph,
  r: rookGlyph,
  n: knightGlyph,
  b: bishopGlyph,
  q: (ctx) => crownGlyph(ctx, false),
  k: (ctx) => crownGlyph(ctx, true),
};

// ------------------------------------------------------------ tactical tokens

/** Token diameter in world units (1 unit = one board square) per kind. */
export const TOKEN_SCALE: Record<PieceKind, number> = {
  p: 0.64,
  // Officers are royal-sized on the 3D board; the flat map keeps the same two
  // tiers so switching views does not re-rank the army.
  n: 0.81,
  b: 0.81,
  r: 0.82,
  q: 0.84,
  k: 0.9,
};

interface TokenTheme {
  /** Radial plate gradient, centre → edge. */
  plateIn: string;
  plateOut: string;
  rim: string;
  hairline: string;
  glyph: string;
  /** Faction halo bleeding out past the rim. */
  halo: string;
  notch: string;
}

const TOKEN_THEMES: Record<Faction, TokenTheme> = {
  w: {
    plateIn: "#eaf4ff",
    plateOut: "#7fa8d8",
    rim: "#bfe0ff",
    hairline: "#1d3f78",
    glyph: "#0d2246",
    halo: "rgba(122,168,255,0.55)",
    notch: "#2f5c9c",
  },
  b: {
    plateIn: "#8e2413",
    plateOut: "#3d0d07",
    rim: "#ffa365",
    hairline: "#ffd0a8",
    glyph: "#fff0dd",
    halo: "rgba(255,96,64,0.55)",
    notch: "#a83d1c",
  },
};

/**
 * Overhead counter for the flat tactical view: a carved stone disc in faction
 * livery with the rank silhouette stamped into it. Read straight down, so the
 * plate carries all the identity the sculpt normally would.
 */
export function tacticalTokenTexture(kind: PieceKind, faction: Faction): THREE.CanvasTexture {
  const key = `token_${faction}${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const theme = TOKEN_THEMES[faction];
  const { canvas, ctx } = canvas2d();
  ctx.scale(SIZE / 100, SIZE / 100);

  // Faction halo so the two armies separate from a glance at the whole board.
  const halo = ctx.createRadialGradient(50, 50, 30, 50, 50, 50);
  halo.addColorStop(0, theme.halo);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 100, 100);

  // Plate: lit from the upper left so the disc has a little relief.
  const plate = ctx.createRadialGradient(41, 39, 4, 50, 50, 41);
  plate.addColorStop(0, theme.plateIn);
  plate.addColorStop(1, theme.plateOut);
  ctx.beginPath();
  ctx.arc(50, 50, 40, 0, Math.PI * 2);
  ctx.fillStyle = plate;
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Four carved notches on the diagonals — reads as tooled metal from above.
  ctx.fillStyle = theme.notch;
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    ctx.save();
    ctx.translate(50 + Math.cos(angle) * 37, 50 + Math.sin(angle) * 37);
    ctx.rotate(angle);
    ctx.fillRect(-3.2, -1.4, 6.4, 2.8);
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(50, 50, 40, 0, Math.PI * 2);
  ctx.strokeStyle = theme.rim;
  ctx.lineWidth = 3.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(50, 50, 34.5, 0, Math.PI * 2);
  ctx.strokeStyle = theme.hairline;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.save();
  ctx.translate(50, 51);
  ctx.scale(0.72, 0.72);
  ctx.translate(-50, -50);
  ctx.shadowColor = faction === "w" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 2.5;
  ctx.shadowOffsetY = faction === "w" ? -1 : 1;
  ctx.fillStyle = theme.glyph;
  GLYPHS[kind](ctx);
  ctx.fill("nonzero");
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

// -------------------------------------------------------------------- texture

const cache = new Map<string, THREE.CanvasTexture>();

/** Cached badge texture for one kind + faction. */
export function rankBadgeTexture(kind: PieceKind, faction: Faction): THREE.CanvasTexture {
  const key = `${faction}${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const theme = THEMES[faction];
  const { canvas, ctx } = canvas2d();
  ctx.scale(SIZE / 100, SIZE / 100);

  const plate = faction === "w" ? heaterPlate : sunPlate;
  /** The plate's outline drawn smaller about its middle, for the lines inside the bezel. */
  const inset = (scale: number): void => {
    ctx.translate(50, 51);
    ctx.scale(scale, scale);
    ctx.translate(-50, -51);
    plate(ctx);
  };

  // The enamel field, lit from the upper left. Its shadow, a little below it, is the only thing drawn outside
  // the metal: it keeps the plate's edge against a pale tile without a halo.
  const field = ctx.createRadialGradient(40, 34, 3, 50, 52, 48);
  field.addColorStop(0, theme.field);
  field.addColorStop(1, theme.fieldEdge);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  // Canvas shadows are measured in canvas pixels, whatever the drawing scale.
  ctx.shadowBlur = 4 * (SIZE / 100);
  ctx.shadowOffsetY = 1.5 * (SIZE / 100);
  plate(ctx);
  ctx.fillStyle = field;
  ctx.fill();
  ctx.restore();

  // A sheen across the enamel, as glass over colour has.
  ctx.save();
  plate(ctx);
  ctx.clip();
  const sheen = ctx.createLinearGradient(22, 14, 62, 64);
  sheen.addColorStop(0, "rgba(255,255,255,0.2)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.03)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 100, 100);
  ctx.restore();

  // The bezel: one band of metal, bright where the light meets it and dark where it turns away, with a dark line
  // at its outer and inner edge so it stands up from the field.
  ctx.lineJoin = "round";
  const metal = ctx.createLinearGradient(22, 12, 78, 92);
  metal.addColorStop(0, theme.rimLight);
  metal.addColorStop(0.5, theme.rimDark);
  metal.addColorStop(0.8, theme.rimLight);
  metal.addColorStop(1, theme.rimDark);
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 6;
  plate(ctx);
  ctx.stroke();
  ctx.strokeStyle = metal;
  ctx.lineWidth = 4.4;
  plate(ctx);
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 0.9;
  inset(0.9);
  ctx.stroke();
  ctx.restore();

  // The device is raised: shade under it, light along its upper edges, then its own face. It sits slightly high
  // inside the crest so its pedestal does not collide with the rounded bottom of the plate.
  ctx.save();
  ctx.translate(50, faction === "w" ? 49 : 51);
  ctx.scale(0.62, 0.62);
  ctx.translate(-50, -50);
  const raised = (dx: number, dy: number, style: string | CanvasGradient): void => {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.fillStyle = style;
    GLYPHS[kind](ctx);
    ctx.fill("nonzero");
    ctx.restore();
  };
  raised(1.6, 2.4, theme.glyphShade);
  raised(-0.9, -1.2, theme.glyphLight);
  const face = ctx.createLinearGradient(0, 12, 0, 80);
  face.addColorStop(0, theme.glyph);
  face.addColorStop(1, theme.glyphLow);
  raised(0, 0, face);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/** Frees every cached badge texture (engine teardown only). */
export function disposeRankBadgeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
