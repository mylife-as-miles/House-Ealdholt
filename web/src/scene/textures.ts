import * as THREE from "three";

/**
 * Procedural CC0-free textures. Everything is painted into canvases at boot so
 * the game ships without texture downloads and still gets marble veining,
 * pitted basalt, engraved rank/file labels and soft particle sprites.
 */

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, alpha: number, random = Math.random): void {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    data[i + 3] = Math.max(0, Math.min(255, data[i + 3] * alpha + 255 * (1 - alpha)));
  }
  ctx.putImageData(image, 0, 0);
}

/** Soft veined marble. `dark` swaps to basalt colouring. */
export function marbleTexture(dark: boolean): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = dark ? "#191a20" : "#e9e2d2";
  ctx.fillRect(0, 0, size, size);
  const random = seededRandom(dark ? 0x0b5a17 : 0xc0ffee);

  // Broad tonal blotches.
  for (let i = 0; i < 26; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = 40 + random() * 150;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = dark ? 40 + random() * 25 : 205 + random() * 40;
    gradient.addColorStop(0, `rgba(${tone},${tone},${tone + (dark ? 6 : 0)},0.35)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Veins: random walks with tapering width.
  const veins = dark ? 8 : 16;
  for (let v = 0; v < veins; v += 1) {
    let x = random() * size;
    let y = random() * size;
    let angle = random() * Math.PI * 2;
    ctx.strokeStyle = dark ? "rgba(96,102,120,0.22)" : "rgba(120,116,104,0.34)";
    ctx.lineWidth = 0.6 + random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 60 + Math.floor(random() * 60);
    for (let s = 0; s < steps; s += 1) {
      angle += (random() - 0.5) * 0.7;
      x += Math.cos(angle) * 7;
      y += Math.sin(angle) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  grain(ctx, size, dark ? 16 : 12, 1, random);
  return toTexture(canvas);
}

/** Rough castle flagstone floor with mortar joints. */
export function flagstoneTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  const random = seededRandom(0xa1de004);
  ctx.fillStyle = "#35322e";
  ctx.fillRect(0, 0, size, size);

  const cell = size / 4;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const offset = row % 2 === 0 ? 0 : cell / 2;
      const x = (col * cell + offset) % size;
      const y = row * cell;
      const shade = 62 + random() * 28;
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
      ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.fillRect(x + 3, y + 3, cell - 6, 3);
    }
  }
  grain(ctx, size, 20, 1, random);
  return toTexture(canvas);
}

/** Bronze-trimmed border with engraved a–h / 1–8 labels, mapped to the base top. */
export function boardBorderTexture(): THREE.CanvasTexture {
  const size = 1024;
  const { canvas, ctx } = createCanvas(size);
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

  ctx.fillStyle = "#221d17";
  ctx.fillRect(0, 0, size, size);

  // Carved stone ring.
  const border = size * 0.085;
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#4a4136");
  gradient.addColorStop(0.5, "#332c24");
  gradient.addColorStop(1, "#241f19");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Bronze inlay line.
  ctx.strokeStyle = "#8a6a34";
  ctx.lineWidth = 6;
  ctx.strokeRect(border * 0.55, border * 0.55, size - border * 1.1, size - border * 1.1);
  ctx.strokeStyle = "rgba(214,178,102,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(border * 0.55 + 5, border * 0.55 + 5, size - border * 1.1 - 10, size - border * 1.1 - 10);

  // Inner well (hidden by the tiles, kept dark).
  ctx.fillStyle = "#0e0c0a";
  ctx.fillRect(border, border, size - border * 2, size - border * 2);

  const inner = size - border * 2;
  const step = inner / 8;
  ctx.font = `600 ${Math.floor(border * 0.52)}px "Cinzel", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 8; i += 1) {
    const centre = border + step * (i + 0.5);
    const engrave = (text: string, x: number, y: number): void => {
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(text, x + 2, y + 2);
      ctx.fillStyle = "rgba(212,175,105,0.85)";
      ctx.fillText(text, x, y);
    };
    engrave(files[i], centre, border * 0.5);
    engrave(files[i], centre, size - border * 0.5);
    engrave(String(8 - i), border * 0.5, centre);
    engrave(String(8 - i), size - border * 0.5, centre);
  }

  grain(ctx, size, 14, 1);
  return toTexture(canvas, 1);
}

/** Radial falloff used for contact shadows and glow discs. */
export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.55, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The band painted on the tile under a figure, marking which army it belongs to.
 *
 * Colour alone is not enough: it has to survive a dark hall, a bloom pass, a
 * phone screen and a colour-blind player, so each army also gets its **own
 * shape** — the kingdoms' plain double band against the empire's spiked sun
 * collar. Read at a glance from any camera height, and the two never blur into
 * one another the way two tinted glows do.
 *
 * Drawn in white so a single canvas per shape can be tinted per faction.
 */
export function factionRingTexture(shape: "band" | "sunburst"): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  // Floor wash: the tile takes a *breath* of the army's colour, no more. This is
  // the one part of the mark that sits directly beneath the figure, so anything
  // brighter bounces up the legs and hem and starts recolouring the sculpt — and
  // it is the widest part too, so it is what fills the frame when thirty-two of
  // them are on screen. Kept faint and pulled in tight (0.46 → 0.4 of the tile):
  // enough to lift a figure off ivory marble, not enough to paint the square.
  const wash = ctx.createRadialGradient(c, c, size * 0.06, c, c, size * 0.4);
  wash.addColorStop(0, "rgba(255,255,255,0.12)");
  wash.addColorStop(0.6, "rgba(255,255,255,0.05)");
  wash.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  const radius = size * 0.375;

  // Bleed first, hard edge second — the band keeps a crisp line even under bloom.
  // The bleed is the halo the bloom pass grabs hold of, so it is narrow and faint;
  // the crisp line under it does the reading, and a *thin* bright line is easier
  // to read than a thick soft one.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = size * 0.07;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = size * 0.032;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (shape === "band") {
    // Second, thinner band inside it: two concentric lines, no teeth.
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = size * 0.014;
    ctx.beginPath();
    ctx.arc(c, c, size * 0.285, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Spiked collar: twelve tapered rays outside the band. Shorter than the
    // kingdoms' bleed is wide, so the two shapes stay different at a glance
    // without the empire's mark covering more of its tile.
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    const inner = size * 0.4;
    const outer = size * 0.472;
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const spread = 0.055;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
      ctx.lineTo(c + Math.cos(angle - spread) * inner, c + Math.sin(angle - spread) * inner);
      ctx.lineTo(c + Math.cos(angle + spread) * inner, c + Math.sin(angle + spread) * inner);
      ctx.closePath();
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// ----------------------------------------------------------------------------------------------- board markers
//
// The markers on the squares are drawn as light and stone, not as signs laid over the board: each is a line cut into
// the tile with light running in it, over a pool of the same light lying on the stone around it. One atlas holds
// every picture, so the board draws all of its markers in three draw calls however many squares are lit, four while
// a promotion square is lit (see BoardView).
//
// A cell is not a colour picture. Its three channels are three masks, which the board's shaders combine:
//   red    where the light is: the lit line and the glow that spreads from it (in a pool cell, how strongly the
//          stone there is lit)
//   green  where the stone is cut away or covered: the dark channel a line sits in, dust
//   blue   the hottest part of a line, drawn nearer white
// The colour comes from the board, square by square, so a picture carries only its shape.

/** Cells along each side of the marker atlas. Each cell is 256 pixels, so every level of detail keeps to whole cells. */
export const MARKER_ATLAS_GRID = 5;

/** Where each picture sits in the atlas: [column, row], counted from the top-left of the canvas. */
export const MARKER_CELLS = {
  select: [0, 0],
  move: [1, 0],
  capture: [2, 0],
  castle: [3, 0],
  promote: [0, 1],
  last: [1, 1],
  check: [2, 1],
  hint: [3, 1],
  cursor: [0, 2],
  poolRound: [1, 2],
  poolTile: [2, 2],
  poolEdge: [3, 2],
  dust: [0, 3],
  shock: [1, 3],
  flash: [2, 3],
  poolRing: [3, 3],
  enpassant: [4, 2],
  queued: [4, 0],
  aim: [4, 1],
} as const;

export type MarkerCell = keyof typeof MARKER_CELLS;

/** The lower-left corner of a cell in texture coordinates; a cell is 1 / MARKER_ATLAS_GRID across. */
export function markerCellOrigin(cell: MarkerCell): [number, number] {
  const [column, row] = MARKER_CELLS[cell];
  return [column / MARKER_ATLAS_GRID, 1 - (row + 1) / MARKER_ATLAS_GRID];
}

const MASK_GLOW = "255,0,0";
const MASK_GROOVE = "0,255,0";
const MASK_HOT = "0,0,255";

/**
 * One inlaid line, or with `filled` one inlaid shape: the channel cut for it, the light in the channel, the glow it
 * spreads over the stone and its hot core. `trace` adds the path; `width` is the lit line's width in cell units
 * (a cell is 100 across). The canvas must be compositing with "lighter", so each mask adds up on its own channel.
 */
function inlay(ctx: CanvasRenderingContext2D, trace: () => void, width: number, filled = false): void {
  const stroke = (mask: string, alpha: number, lineWidth: number): void => {
    ctx.strokeStyle = `rgba(${mask},${alpha})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    trace();
    ctx.stroke();
  };
  const fill = (mask: string, alpha: number): void => {
    ctx.fillStyle = `rgba(${mask},${alpha})`;
    ctx.beginPath();
    trace();
    ctx.fill();
  };
  // The channel is wider than the light in it, so on pale stone a dark lip shows either side of the line. That lip
  // is what makes the line read as cut into the tile rather than printed on it, and at a distance it is what
  // carries the line at all: light on pale stone has little room above it.
  stroke(MASK_GROOVE, 0.9, width * 3);
  if (filled) fill(MASK_GROOVE, 0.9);
  // The glow: wide and faint down to narrow and strong. Strokes stand in for a blur, which not every canvas has.
  for (const [spread, alpha] of [[7.5, 0.03], [5, 0.05], [3.2, 0.09], [2, 0.18]] as const) stroke(MASK_GLOW, alpha, width * spread);
  if (filled) fill(MASK_GLOW, 1);
  stroke(MASK_GLOW, 1, width);
  stroke(MASK_HOT, 1, width * 0.45);
  if (filled) fill(MASK_HOT, 0.6);
}

function smooth(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * The atlas of board markers (see the note above for what its channels mean).
 *
 * Every kind of square has its own shape, so the board can be read without colour, and none of them needs to move
 * to be read:
 *   select   a double frame round the whole tile          move     a dot in a small ring at the centre
 *   capture  a wedge in each corner                       castle   chevrons pointing apart along the rank
 *   promote  a crown as wide as the tile                  last     a short bar at the middle of each edge
 *   check    a ring of thorns                             hint     a ring of beads
 *   cursor   an open bracket at each corner, outside every other shape
 *   queued   a frame of dashes, open at the corners       aim      an arrowhead in from each edge, a small ring
 *   enpassant  a stroke in from each corner, and an arrowhead at each side toward where the capturing pawn lands
 * Shapes meant for a square with a figure on it keep to the tile's edge, where the figure does not hide them. The
 * crown reaches the tile's sides for the same reason: a pawn about to promote stands in front of its square and,
 * from where its player sits, hides the middle of it.
 */
export function markerAtlasTexture(): THREE.CanvasTexture {
  const cell = 256;
  const { canvas, ctx } = createCanvas(cell * MARKER_ATLAS_GRID);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(0x51ab0a2d);
  const TAU = Math.PI * 2;

  // Soft masks are computed a pixel at a time: x and y run -0.5 to 0.5 across the cell, r is the distance from its
  // centre. `shade` writes the three masks, each 0 to 1, into `out`.
  const out = [0, 0, 0];
  const mask = (name: MarkerCell, shade: (x: number, y: number, r: number, angle: number) => void): void => {
    const [column, row] = MARKER_CELLS[name];
    const image = ctx.createImageData(cell, cell);
    for (let py = 0; py < cell; py += 1) {
      for (let px = 0; px < cell; px += 1) {
        const x = (px + 0.5) / cell - 0.5;
        const y = (py + 0.5) / cell - 0.5;
        out[0] = out[1] = out[2] = 0;
        shade(x, y, Math.hypot(x, y), Math.atan2(y, x));
        const i = (py * cell + px) * 4;
        image.data[i] = Math.round(Math.max(0, Math.min(1, out[0])) * 255);
        image.data[i + 1] = Math.round(Math.max(0, Math.min(1, out[1])) * 255);
        image.data[i + 2] = Math.round(Math.max(0, Math.min(1, out[2])) * 255);
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, column * cell, row * cell);
  };

  // Light lying on the stone, shaped by where it comes from: round under a mark at the centre, along the rim for
  // a mark cut round the tile's edge, a ring for a ring, the whole tile for the cursor. Each fades to nothing
  // before the edge of its cell.
  mask("poolRound", (_x, _y, r) => {
    out[0] = Math.pow(1 - smooth(0.03, 0.47, r), 1.4);
  });
  mask("poolTile", (x, y, r) => {
    const inside = (1 - smooth(0.33, 0.47, Math.abs(x))) * (1 - smooth(0.33, 0.47, Math.abs(y)));
    out[0] = inside * (0.72 + 0.28 * (1 - smooth(0, 0.5, r)));
  });
  mask("poolRing", (_x, _y, r) => {
    out[0] = Math.exp(-(((r - 0.35) / 0.09) ** 2)) * (1 - smooth(0.44, 0.495, r));
  });
  mask("poolEdge", (x, y) => {
    const edge = Math.max(Math.abs(x), Math.abs(y));
    out[0] = (0.14 + 0.86 * smooth(0.14, 0.38, edge)) * (1 - smooth(0.41, 0.485, edge));
  });
  // The flash of a blow: light with a white heart.
  mask("flash", (_x, _y, r) => {
    out[0] = (1 - smooth(0, 0.48, r)) ** 2;
    out[2] = (1 - smooth(0, 0.24, r)) ** 2;
  });
  // Dust kicked out along the stone: a broken ring, both lit (red) and covering what is under it (green).
  const lobes = [random() * TAU, random() * TAU, random() * TAU];
  mask("dust", (_x, _y, r, angle) => {
    const broken = 0.62 + 0.2 * Math.sin(angle * 3 + lobes[0]) + 0.14 * Math.sin(angle * 7 + lobes[1]) + 0.08 * Math.sin(angle * 13 + lobes[2]);
    const ring = Math.exp(-(((r - 0.35) / 0.06) ** 2)) * broken * (1 - smooth(0.44, 0.495, r));
    out[0] = ring;
    out[1] = ring;
  });
  // The shock of a blow: a thin hot rim, the fading wake inside it and a few thrown shards.
  const shards = random() * TAU;
  mask("shock", (_x, _y, r, angle) => {
    const rim = Math.exp(-(((r - 0.4) / 0.018) ** 2));
    const wake = r < 0.4 ? 0.26 * Math.exp(-(((r - 0.34) / 0.06) ** 2)) : 0;
    const thrown = 0.5 * Math.max(0, Math.sin(angle * 9 + shards)) ** 6 * Math.exp(-(((r - 0.37) / 0.05) ** 2));
    out[0] = (rim + wake + thrown) * (1 - smooth(0.45, 0.495, r));
    out[2] = rim * 0.8;
  });

  // The cut shapes are drawn with the canvas adding, in a cell 100 units across.
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const draw = (name: MarkerCell, paint: () => void): void => {
    const [column, row] = MARKER_CELLS[name];
    ctx.save();
    ctx.beginPath();
    ctx.rect(column * cell, row * cell, cell, cell);
    ctx.clip();
    ctx.translate(column * cell, row * cell);
    ctx.scale(cell / 100, cell / 100);
    paint();
    ctx.restore();
  };
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  draw("select", () => {
    inlay(ctx, () => ctx.roundRect(11, 11, 78, 78, 3.5), 2.1);
    inlay(ctx, () => ctx.roundRect(16.5, 16.5, 67, 67, 2), 0.8);
  });

  draw("move", () => {
    inlay(ctx, () => ctx.arc(50, 50, 8, 0, TAU), 1.3, true);
    inlay(ctx, () => ctx.arc(50, 50, 19, 0, TAU), 1.5);
  });

  draw("capture", () => {
    for (const [sx, sy] of corners) {
      const x = 50 + sx * 39;
      const y = 50 + sy * 39;
      inlay(ctx, () => {
        ctx.moveTo(x, y);
        ctx.lineTo(x - sx * 19, y);
        ctx.lineTo(x, y - sy * 19);
        ctx.closePath();
      }, 1.3, true);
    }
  });

  draw("castle", () => {
    for (const direction of [-1, 1]) {
      for (const [tip, half, width] of [[38, 12, 2.2], [25, 9, 1.5]] as const) {
        const x = 50 + direction * tip;
        inlay(ctx, () => {
          ctx.moveTo(x - direction * half * 0.85, 50 - half);
          ctx.lineTo(x, 50);
          ctx.lineTo(x - direction * half * 0.85, 50 + half);
        }, width);
      }
    }
    inlay(ctx, () => {
      ctx.moveTo(41, 50);
      ctx.lineTo(59, 50);
    }, 1.5);
  });

  draw("promote", () => {
    // The crown points up the canvas: the board turns it to face the side that is promoting.
    inlay(ctx, () => {
      ctx.moveTo(17, 68);
      ctx.lineTo(12, 30);
      ctx.lineTo(33, 51);
      ctx.lineTo(50, 21);
      ctx.lineTo(67, 51);
      ctx.lineTo(88, 30);
      ctx.lineTo(83, 68);
      ctx.closePath();
    }, 1.5, true);
    inlay(ctx, () => ctx.rect(17, 74, 66, 6.5), 1.2, true);
  });

  draw("last", () => {
    for (const [ax, ay] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = 50 + ax * 38.5;
      const y = 50 + ay * 38.5;
      inlay(ctx, () => {
        ctx.moveTo(x - ay * 11, y - ax * 11);
        ctx.lineTo(x + ay * 11, y + ax * 11);
      }, 1.7);
    }
  });

  draw("check", () => {
    inlay(ctx, () => ctx.arc(50, 50, 35, 0, TAU), 2.4);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * TAU + TAU / 16;
      inlay(ctx, () => {
        ctx.moveTo(50 + Math.cos(angle - 0.085) * 36.5, 50 + Math.sin(angle - 0.085) * 36.5);
        ctx.lineTo(50 + Math.cos(angle) * 45, 50 + Math.sin(angle) * 45);
        ctx.lineTo(50 + Math.cos(angle + 0.085) * 36.5, 50 + Math.sin(angle + 0.085) * 36.5);
        ctx.closePath();
      }, 1, true);
    }
  });

  draw("hint", () => {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * TAU;
      inlay(ctx, () => ctx.arc(50 + Math.cos(angle) * 36, 50 + Math.sin(angle) * 36, 2.9, 0, TAU), 0.9, true);
    }
  });

  // A move asked for while the board was busy (BoardView.setQueued). Dashes say "not yet": the frame round the piece
  // that waits to go is broken where the selected piece's is whole.
  const sides: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  draw("queued", () => {
    for (const [ax, ay] of sides) {
      for (const along of [-23, 0, 23]) {
        const x = 50 + ax * 37 - ay * along;
        const y = 50 + ay * 37 + ax * along;
        inlay(ctx, () => {
          ctx.moveTo(x + ay * 6, y - ax * 6);
          ctx.lineTo(x - ay * 6, y + ax * 6);
        }, 1.8);
      }
    }
  });

  // ...and where it is to go: an arrowhead in from each edge, which shows round a figure standing there to be taken,
  // and a small ring at the centre of a square that is empty.
  draw("aim", () => {
    for (const [ax, ay] of sides) {
      const x = 50 + ax * 39;
      const y = 50 + ay * 39;
      inlay(ctx, () => {
        ctx.moveTo(x - ay * 10, y + ax * 10);
        ctx.lineTo(50 + ax * 27, 50 + ay * 27);
        ctx.lineTo(x + ay * 10, y - ax * 10);
      }, 1.9);
    }
    inlay(ctx, () => ctx.arc(50, 50, 6.5, 0, TAU), 1.3);
  });

  // The pawn a capture in passing takes. It does not stand where its captor lands, so its own square is struck
  // through from the corners, clear of the figure, and an arrowhead at each side points on to the square beyond it,
  // where the captor lands. They are at the sides because the captor's player looks at this pawn from behind the
  // captor: the far edge, which the landing square lies past, is the one the pawn's own body hides. They point up
  // the canvas: the board turns them to the side that is capturing.
  draw("enpassant", () => {
    for (const [sx, sy] of corners) {
      inlay(ctx, () => {
        ctx.moveTo(50 + sx * 27, 50 + sy * 27);
        ctx.lineTo(50 + sx * 41, 50 + sy * 41);
      }, 2.1);
    }
    for (const x of [11.5, 88.5]) {
      inlay(ctx, () => {
        ctx.moveTo(x - 6.5, 56);
        ctx.lineTo(x, 47);
        ctx.lineTo(x + 6.5, 56);
      }, 1.6);
    }
  });

  draw("cursor", () => {
    for (const [sx, sy] of corners) {
      const x = 50 + sx * 42.5;
      const y = 50 + sy * 42.5;
      inlay(ctx, () => {
        ctx.moveTo(x - sx * 15, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * 15);
      }, 2);
    }
  });
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  // Masks, not colours: read as they were written.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The light a figure stands in, marking which side it fights for: a faint wash under it and a thin band round it,
 * drawn white for the figure to tint and lay on the stone as light (see PieceView).
 *
 * The band has a shape as well as a colour, so the two sides can be told apart without colour: a second, finer band
 * inside White's, a collar of short rays outside Black's.
 */
export function groundLightTexture(shape: "band" | "sunburst"): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  // The wash is widest and sits under the figure, so it is the faintest part: enough to lift a figure off its tile.
  const wash = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.47);
  wash.addColorStop(0, "rgba(255,255,255,0.26)");
  wash.addColorStop(0.55, "rgba(255,255,255,0.13)");
  wash.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  const ring = (radius: number, width: number, alpha: number): void => {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = size * width;
    ctx.beginPath();
    ctx.arc(c, c, size * radius, 0, Math.PI * 2);
    ctx.stroke();
  };
  // A soft shoulder either side of the band, then the band itself: the line does the reading.
  ring(0.365, 0.085, 0.12);
  ring(0.365, 0.048, 0.2);
  ring(0.365, 0.026, 0.95);

  if (shape === "band") {
    ring(0.285, 0.014, 0.66);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    const inner = size * 0.385;
    const outer = size * 0.452;
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const spread = 0.05;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
      ctx.lineTo(c + Math.cos(angle - spread) * inner, c + Math.sin(angle - spread) * inner);
      ctx.lineTo(c + Math.cos(angle + spread) * inner, c + Math.sin(angle + spread) * inner);
      ctx.closePath();
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The shadow a figure's weight leaves where it meets the stone: darkest under the feet and thinning steadily
 * outward, with no flat middle. A disc of even darkness with a soft rim reads as a grey plate under the figure.
 */
export function contactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0,0,0,0.9)");
  gradient.addColorStop(0.22, "rgba(0,0,0,0.68)");
  gradient.addColorStop(0.45, "rgba(0,0,0,0.36)");
  gradient.addColorStop(0.7, "rgba(0,0,0,0.12)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft dot sprite for embers, dust and impact sparks. */
export function sparkTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,226,168,0.85)");
  gradient.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Expanding shockwave ring used on the square where a capture lands: a hot
 * white rim with a soft inner bloom and a few radial shards.
 */
export function shockwaveTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const ring = ctx.createRadialGradient(c, c, size * 0.16, c, c, size * 0.5);
  ring.addColorStop(0, "rgba(255,255,255,0)");
  ring.addColorStop(0.55, "rgba(255,255,255,0.1)");
  ring.addColorStop(0.82, "rgba(255,255,255,0.95)");
  ring.addColorStop(0.93, "rgba(255,255,255,0.35)");
  ring.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, size, size);

  // Radial shards give the wave a shattered, debris-thrown feel.
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2 + 0.2;
    const inner = size * (0.3 + Math.random() * 0.1);
    const outer = size * (0.44 + Math.random() * 0.05);
    ctx.lineWidth = size * (0.008 + Math.random() * 0.012);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
    ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Churned battlefield earth: dark mud, cracks, gravel and wet patches. */
export function mudTexture(): THREE.CanvasTexture {
  const size = 512;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = "#2a2219";
  ctx.fillRect(0, 0, size, size);

  // Broad tonal patches of drier and wetter ground.
  for (let i = 0; i < 40; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 30 + Math.random() * 120;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const wet = Math.random() > 0.5;
    gradient.addColorStop(0, wet ? "rgba(18,15,12,0.55)" : "rgba(74,62,45,0.4)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cart ruts and cracks.
  for (let i = 0; i < 26; i += 1) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = "rgba(12,10,8,0.5)";
    ctx.lineWidth = 0.8 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 40; s += 1) {
      angle += (Math.random() - 0.5) * 0.5;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Gravel and trampled stones.
  for (let i = 0; i < 420; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.6 + Math.random() * 2.4;
    const tone = 40 + Math.random() * 46;
    ctx.fillStyle = `rgba(${tone},${tone - 6},${tone - 14},0.7)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  grain(ctx, size, 30, 1);
  return toTexture(canvas);
}

/** Heraldic camp cloth: base colour with a chevron band and stitched seams. */
export function clothTexture(base: string, accent: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = accent;
  ctx.fillRect(0, size * 0.52, size, size * 0.12);

  // Chevrons.
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.035;
  for (let i = -1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, size * (0.16 + i * 0.26));
    ctx.lineTo(size * 0.5, size * (0.28 + i * 0.26));
    ctx.lineTo(size, size * (0.16 + i * 0.26));
    ctx.stroke();
  }

  // Vertical weave shading so the cloth catches light unevenly.
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.09})`;
    ctx.fillRect(x, 0, 2, size);
  }

  grain(ctx, size, 18, 1);
  return toTexture(canvas);
}

/** Puffy soft-edged blob used for smoke plumes drifting off the pyres. */
export function smokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(150,142,132,0.5)");
  gradient.addColorStop(0.45, "rgba(104,98,92,0.24)");
  gradient.addColorStop(1, "rgba(60,56,52,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // A couple of offset lobes keep the puffs from reading as perfect circles.
  for (let i = 0; i < 5; i += 1) {
    const x = size * (0.3 + Math.random() * 0.4);
    const y = size * (0.3 + Math.random() * 0.4);
    const r = size * (0.14 + Math.random() * 0.16);
    const lobe = ctx.createRadialGradient(x, y, 0, x, y, r);
    lobe.addColorStop(0, "rgba(160,152,142,0.22)");
    lobe.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Fine-grain powder smoke: what leaves a *rifled* barrel rather than a musket.
 *
 * A rifle's charge is small, tight-patched and burns almost completely, so the
 * bank it leaves is pale ash-grey and thin enough to see the hall through —
 * where {@link smokeTexture} is the dirty, soot-heavy bloom of a smoothbore
 * volley. Kept high-key and low-alpha on purpose: the tint is multiplied by the
 * sprite colour, so the texture must not carry the darkness itself.
 */
export function fineSmokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(238,241,244,0.34)");
  gradient.addColorStop(0.38, "rgba(214,219,224,0.15)");
  gradient.addColorStop(0.72, "rgba(190,196,203,0.05)");
  gradient.addColorStop(1, "rgba(180,186,193,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Wispier and more of them than the musket blob: a rifle's smoke tears apart
  // into threads instead of rolling as one lump.
  for (let i = 0; i < 7; i += 1) {
    const x = size * (0.26 + Math.random() * 0.48);
    const y = size * (0.26 + Math.random() * 0.48);
    const r = size * (0.08 + Math.random() * 0.13);
    const lobe = ctx.createRadialGradient(x, y, 0, x, y, r);
    lobe.addColorStop(0, "rgba(246,248,250,0.13)");
    lobe.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A blade arc: a thin crescent of light, hot on its leading edge and trailing
 * off to nothing, drawn once and swept through a body on a heavy strike.
 */
export function crescentTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  // The sweep: a wide stroke around most of a circle, thinning as it goes.
  const steps = 46;
  const from = -Math.PI * 0.78;
  const to = Math.PI * 0.32;
  ctx.lineCap = "round";
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const angle = from + (to - from) * t;
    // Hot and fat at the leading edge, feathering out along the trail.
    const fade = Math.pow(1 - t, 1.5);
    const radius = size * (0.4 - t * 0.03);
    const width = size * (0.012 + fade * 0.055);
    ctx.strokeStyle = `rgba(255,255,255,${(0.1 + fade * 0.9).toFixed(3)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(c, c, radius, angle - 0.05, angle + 0.05);
    ctx.stroke();
  }

  // Glint at the tip of the swing, where the steel is moving fastest.
  const tipX = c + Math.cos(from) * size * 0.4;
  const tipY = c + Math.sin(from) * size * 0.4;
  const glint = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, size * 0.1);
  glint.addColorStop(0, "rgba(255,255,255,0.95)");
  glint.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The wall of a column of light: brightest where it meets the floor, thinning
 * as it climbs out of frame, with faint vertical striations so it reads as
 * falling light rather than a plastic tube.
 */
export function pillarTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, size, 0, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.42)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * size;
    const width = size * (0.01 + Math.random() * 0.05);
    ctx.fillStyle = `rgba(0,0,0,${(0.1 + Math.random() * 0.25).toFixed(3)})`;
    ctx.fillRect(x, 0, width, size);
  }
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Muzzle flash: a white-hot core inside a ragged star of burning powder. Drawn
 * once and billboarded, so a shot reads from every camera angle on the board.
 *
 * The star is deliberately *overdriven* — a broad plateau of pure white across
 * the middle third rather than a single bright pixel at the centre. Two reasons.
 * First, the bloom pass only picks up what already clips at 1, so a flash built
 * as a polite gradient blooms on a handful of pixels and reads as a dull spark.
 * Second, the round that leaves this bore is now a real sculpt drawn several
 * calibres wide: a flame narrower and dimmer than the ball it launches makes the
 * shot look like the ball was dropped rather than fired.
 */
export function muzzleFlashTexture(): THREE.CanvasTexture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size);
  const c = size / 2;

  const halo = ctx.createRadialGradient(c, c, 0, c, c, size * 0.5);
  // Flat white out to a fifth of the radius: this is the part that clips and
  // therefore the part the bloom pass actually sees.
  halo.addColorStop(0, "rgba(255,255,255,1)");
  halo.addColorStop(0.2, "rgba(255,255,251,1)");
  halo.addColorStop(0.34, "rgba(255,244,198,0.82)");
  halo.addColorStop(0.54, "rgba(255,198,104,0.42)");
  halo.addColorStop(0.78, "rgba(255,138,44,0.16)");
  halo.addColorStop(1, "rgba(255,110,30,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "lighter";

  // Powder does not burn in a circle: uneven petals of flame off the bore. They
  // now reach almost to the edge of the sprite, so the flame has a ragged
  // silhouette at its full drawn width instead of a soft ball in the middle.
  const petals = 13;
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2 + Math.random() * 0.34;
    const reach = size * (0.31 + Math.random() * 0.18);
    const width = size * (0.035 + Math.random() * 0.045);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const petal = ctx.createLinearGradient(0, 0, reach, 0);
    petal.addColorStop(0, "rgba(255,255,244,1)");
    petal.addColorStop(0.3, "rgba(255,238,178,0.72)");
    petal.addColorStop(0.62, "rgba(255,196,96,0.34)");
    petal.addColorStop(1, "rgba(255,140,48,0)");
    ctx.fillStyle = petal;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(reach, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Three long primary jets: where the charge actually vents. Thin, near-white
  // and running to the sprite edge, they are what makes the flash read as an
  // explosion escaping a tube rather than as a glowing blob.
  for (let i = 0; i < 3; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const reach = size * (0.44 + Math.random() * 0.06);
    const width = size * 0.022;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const jet = ctx.createLinearGradient(0, 0, reach, 0);
    jet.addColorStop(0, "rgba(255,255,255,1)");
    jet.addColorStop(0.5, "rgba(255,246,206,0.5)");
    jet.addColorStop(1, "rgba(255,170,70,0)");
    ctx.fillStyle = jet;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(reach, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // A second pass of pure white over the middle, stacked additively, so the
  // core is genuinely blown out rather than merely bright.
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.17);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.6, "rgba(255,252,235,0.7)");
  core.addColorStop(1, "rgba(255,240,200,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Motion smear along a round's line of travel: opaque at the nose, gone at the
 * tail, with a bright thread down the middle.
 *
 * Mapped onto the tapered cone that trails a shot, so the streak fades along
 * its length rather than ending in a hard edge. A shot crossing a hall in half
 * a second is a few pixels wide — this smear is the only thing that gives the
 * eye something to follow, which is why it carries a hot core rather than a
 * flat wash.
 */
export function tracerTexture(): THREE.CanvasTexture {
  const width = 32;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.clearRect(0, 0, width, height);

  // Cylinder UVs run 0 at the tail to 1 at the nose, so the gradient is built
  // bottom-up: nothing where the smear dies, solid where the metal is.
  const along = ctx.createLinearGradient(0, height, 0, 0);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.34, "rgba(255,255,255,0.1)");
  along.addColorStop(0.74, "rgba(255,255,255,0.42)");
  along.addColorStop(1, "rgba(255,255,255,0.92)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, width, height);

  // A hotter thread down the axis of the smear — the centre of a blurred body
  // is always brighter than its edges.
  const core = ctx.createLinearGradient(0, 0, width, 0);
  core.addColorStop(0, "rgba(255,255,255,0)");
  core.addColorStop(0.5, "rgba(255,255,255,0.5)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Vertical light-shaft gradient (bright at the window, fading to the floor). */
export function shaftTexture(): THREE.CanvasTexture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size);
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, "rgba(255,224,170,0.55)");
  gradient.addColorStop(0.45, "rgba(255,206,140,0.18)");
  gradient.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
