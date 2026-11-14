import assert from "node:assert/strict";
import { test } from "node:test";
import { HERALDRY_PRESETS } from "../content/heraldry";
import { defaultHeraldryRaster } from "../environment/heraldry/adapter";
import { rasterizeHeraldry } from "../heraldry/raster";

test("environment standards use the same heraldry as the player's banner", () => {
  for (const aspect of ["shield", "banner", "pennant"] as const) {
    const request = { width: 40, height: 48, aspect };
    const heraldry = HERALDRY_PRESETS.korvenia[0].heraldry;
    assert.deepEqual(defaultHeraldryRaster.rasterize(heraldry, request), rasterizeHeraldry(heraldry, request));
  }
});
