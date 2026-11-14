import { describe, expect, it } from "vitest";

import { isLightSquare, isLightSquareAt, lightColour, MARKER_STYLES, squareToWorld, TILE, type HighlightKind } from "./board";
import { MARKER_ATLAS_GRID, MARKER_CELLS, markerCellOrigin, type MarkerCell } from "./textures";

const KINDS = Object.keys(MARKER_STYLES) as HighlightKind[];

describe("board markers", () => {
  it("gives every kind of square its own shape, so the board reads without colour", () => {
    const shapes = KINDS.map((kind) => MARKER_STYLES[kind].inlay);
    expect(new Set(shapes).size).toBe(KINDS.length);
    // The cursor's shape belongs to no kind: it has to be found on top of any of them.
    expect(shapes).not.toContain("cursor");
  });

  it("draws every shape and every pool from a cell of the atlas", () => {
    for (const kind of KINDS) {
      expect(MARKER_CELLS[MARKER_STYLES[kind].inlay]).toBeDefined();
      expect(MARKER_CELLS[MARKER_STYLES[kind].pool]).toBeDefined();
    }
  });

  it("keeps the last move the faintest light and quiet moves below the squares that need attention", () => {
    const { last, move, capture, check, select } = MARKER_STYLES;
    for (const kind of KINDS) if (kind !== "last") expect(MARKER_STYLES[kind].line).toBeGreaterThan(last.line);
    expect(move.line).toBeLessThan(capture.line);
    expect(capture.line).toBeLessThan(check.line);
    // Light falls on a figure only where one can stand: never on an empty destination.
    expect(move.figure).toBe(0);
    expect(select.figure).toBeGreaterThan(0);
    expect(capture.figure).toBeGreaterThan(0);
  });

  it("lays the atlas out as a grid of distinct cells", () => {
    const names = Object.keys(MARKER_CELLS) as MarkerCell[];
    const seen = new Set<string>();
    for (const name of names) {
      const [column, row] = MARKER_CELLS[name];
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(MARKER_ATLAS_GRID);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(MARKER_ATLAS_GRID);
      seen.add(`${column},${row}`);
    }
    expect(seen.size).toBe(names.length);
    // Textures are read bottom-up: the canvas's top row is the highest v.
    expect(markerCellOrigin("select")).toEqual([0, 1 - 1 / MARKER_ATLAS_GRID]);
    expect(markerCellOrigin("dust")).toEqual([0, 1 - 4 / MARKER_ATLAS_GRID]);
    expect(markerCellOrigin("queued")).toEqual([(MARKER_ATLAS_GRID - 1) / MARKER_ATLAS_GRID, 1 - 1 / MARKER_ATLAS_GRID]);
  });

  it("marks a queued move in a colour and in shapes no other square has", () => {
    const { queued, aim, select } = MARKER_STYLES;
    expect(queued.color).toBe(aim.color);
    for (const kind of KINDS) if (kind !== "queued" && kind !== "aim") expect(MARKER_STYLES[kind].color).not.toBe(queued.color);
    // The piece that waits is lit as the selected piece is, and so is a figure standing where it is to go.
    expect(queued.figure).toBeGreaterThan(0);
    expect(aim.figure).toBeGreaterThan(0);
    expect(queued.inlay).not.toBe(select.inlay);
  });

  it("marks a pawn taken in passing as a capture, on a shape of its own", () => {
    const { enpassant, capture } = MARKER_STYLES;
    expect(enpassant.color).toBe(capture.color);
    expect(enpassant.inlay).not.toBe(capture.inlay);
    expect(enpassant.figure).toBe(capture.figure);
  });

  it("knows the colour of the square under any point on the board", () => {
    for (const file of "abcdefgh") {
      for (let rank = 1; rank <= 8; rank += 1) {
        const square = `${file}${rank}`;
        const { x, z } = squareToWorld(square);
        expect(isLightSquareAt(x, z)).toBe(isLightSquare(square));
        // Anywhere on the tile, not only at its centre.
        expect(isLightSquareAt(x + TILE * 0.4, z - TILE * 0.4)).toBe(isLightSquare(square));
      }
    }
    // Off the board the pattern simply continues: a figure walking on from the side has an answer too.
    expect(isLightSquareAt(squareToWorld("a1").x - TILE, squareToWorld("a1").z)).toBe(!isLightSquare("a1"));
  });

  it("scales a light's colour so its strongest channel is one", () => {
    for (const kind of KINDS) {
      const colour = lightColour(MARKER_STYLES[kind].color);
      expect(Math.max(...colour)).toBeCloseTo(1, 6);
      expect(Math.min(...colour)).toBeGreaterThanOrEqual(0);
    }
    // Linear, not the hex's own numbers: half-bright sRGB grey is about a fifth as much light.
    expect(lightColour(0xff8080)[1]).toBeCloseTo(0.2159, 3);
  });
});
