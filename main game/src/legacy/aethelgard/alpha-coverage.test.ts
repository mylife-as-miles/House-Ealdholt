import assert from "node:assert/strict";
import { test } from "node:test";
import { alphaCoverage, preserveAlphaCoverage } from "./alpha-coverage";

function rgba(alphas: number[]): Uint8ClampedArray {
  return Uint8ClampedArray.from(alphas.flatMap((alpha, index) => [31 + index, 89 + index, 137 + index, alpha]));
}

test("minified leaf alpha regains the measured coverage without changing RGB or input", () => {
  const source = rgba([0, 24, 40, 56, 71, 89, 111, 128]);
  const before = source.slice();
  const corrected = preserveAlphaCoverage(source, .333299994, .5);
  assert.equal(alphaCoverage(source, .333299994), 3 / 8);
  assert.equal(corrected.coverage, .5);
  assert.ok(corrected.scale > 1);
  assert.equal(corrected.pixels[3], 0);
  assert.deepEqual(source, before);
  for (let index = 0; index < source.length; index++) if (index % 4 !== 3) assert.equal(corrected.pixels[index], source[index]);
});

test("already correct levels are byte-exact and require no alpha scaling", () => {
  const source = rgba([0, 32, 190, 255]);
  const corrected = preserveAlphaCoverage(source, .333299994, .5);
  assert.equal(corrected.scale, 1);
  assert.deepEqual(corrected.pixels, source);
});

test("tiny tied alpha levels report an honest residual instead of fabricating coverage", () => {
  const corrected = preserveAlphaCoverage(rgba([36]), .333299994, .51);
  assert.equal(corrected.coverage, 1);
  assert.equal(corrected.absoluteError, .49);
  assert.equal(corrected.pixelCount, 1);
  const transparent = preserveAlphaCoverage(rgba([0]), .333299994, .51);
  assert.equal(transparent.coverage, 0);
  assert.equal(transparent.absoluteError, .51);
  assert.equal(transparent.pixels[3], 0);
});

test("histogram choice is at least as close as every achievable rounded alpha scale", () => {
  const source = rgba([0, 11, 11, 24, 39, 54, 54, 83, 110, 170, 255]);
  for (const cutoff of [.2, .333299994, .8, 1]) for (const target of [0, .13, .5, .82, 1]) {
    const corrected = preserveAlphaCoverage(source, cutoff, target);
    for (let boundary = 1; boundary <= 255; boundary++) {
      const candidate = source.slice(), scale = (Math.ceil(cutoff * 255) - .5 + 1e-7) / boundary;
      for (let index = 3; index < candidate.length; index += 4) candidate[index] = Math.min(255, Math.round(candidate[index] * scale));
      assert.ok(corrected.absoluteError <= Math.abs(alphaCoverage(candidate, cutoff) - target) + 1e-12);
    }
  }
});

test("invalid cutoffs, empty data and impossible target ranges are rejected", () => {
  assert.throws(() => alphaCoverage(new Uint8ClampedArray(), .3), RangeError);
  assert.throws(() => alphaCoverage(rgba([0]), 0), RangeError);
  assert.throws(() => preserveAlphaCoverage(rgba([0]), .3, 1.01), RangeError);
});
