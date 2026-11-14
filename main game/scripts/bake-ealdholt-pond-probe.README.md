# Private pond probe authoring

Root runs this script in a separate authoring browser. Private source-qualified
probes have been baked for both selected geometry profiles. Reuse the already
owned Desktop Vite server; the default app origin remains `http://127.0.0.1:5173`.
Set `EALDHOLT_POND_PROBE_APP_ORIGIN=http://127.0.0.1:4191` to reuse the current
owned server on 4191 instead. This optional setting accepts only a simple HTTP
origin at `127.0.0.1`, `localhost` or `[::1]`, with an optional valid port and
no credentials, path (including a trailing slash), query or fragment. The
baker never starts a Vite server.
The optimized GLB server must provide browser CORS access from loopback. Use the
actual current source URL, not an original/full-source download.

From the repository root, after assigning `EALDHOLT_QUEST_MODEL_URL` to the
current loopback Quest GLB URL:

```sh
node "main game/scripts/bake-ealdholt-pond-probe.mjs" \
  --profile quest \
  --model-url "$EALDHOLT_QUEST_MODEL_URL" \
  --output /workspace/private-assets/elderbloom/pond-probes/quest-coastal-v3-r1-001 \
  --lighting-version ealdholt-daylight-coastal-v3-r1
```

Use `--profile desktop`, a Desktop GLB URL and a different NEW output directory
for Desktop. Geometry filename/profile mismatch is refused. Quest uses low
quality and its Quest exterior profile; Desktop uses high. Never substitute
Quest-size pixels on Desktop geometry and call that a Quest-scene bake.

The script streams/hashes the served GLB before and after capture, enforces the
256 MiB optimized-model limit, refuses redirects and original/nonlocal sources,
and creates only a new private directory with no symlinks or overwrite. It runs
a separate headless Chromium browser with an inactive non-XR factory, using only
the narrow `authorPondProbe` callback. Only transient result data crosses the
page boundary; no scene/renderer/capture method is exposed on `window`.
It requests only `--disable-dev-shm-usage` as an additional launch argument and
does not explicitly select GL, ANGLE or SwiftShader. `CHROMIUM_PATH` selects an
explicit executable when set; otherwise Playwright selects its bundled browser.
Qualification records that selection and `requestedAdditionalBrowserArgs`.
Playwright also supplies its default arguments, which may include sandbox-related
flags, so the requested list is not the complete command line and does not
establish a lack of security overrides or a particular graphics backend.

Output is `pond-probe-PROFILE.hdr`, its `.metadata.json` and `qualification.json`.
Qualification uses the public installed Three HDRLoader with FloatType and
records actual dimensions, finite/nonnegative radiance, linear range, luminance
variance, nonblack pixel count, hashes and errors. Flat/black captures fail.
Browser and temporary harness server close in `finally`. Input servers and the
normal Desktop app server remain owned by root. Capture failure is recorded
privately and does not replace any existing probe.

These checks establish format and varied radiance. The selected private Desktop
panorama has been inspected for local canopy/shore content; separate GPU cardinal
checks pass for both engines and Native's actual AssetManager HDR loading path.
Those checks do not establish pleasing pond appearance, parallax accuracy or
equivalence between Desktop authoring light and the Native world lighting.

## Separate cardinal/quarter-turn GPU calibration

Both adapters now have an unimported `pond-probe-calibration.ts` exporting
`runEaldholtPondProbeCalibration(renderer, profile = 'quest')`. Root supplies a
dedicated renderer from the same namespace: Desktop `three`, Native
`@iwsdk/core`. Native's original procedural float DataTexture uses public Core
APIs and no raw asset loader. The module asserts actual `REVISION === '185'` and
the renderer constructor namespace, and refuses XR-enabled/presenting renderers.

The function renders an original metallic mirror plane with the verified pond
role through the existing local-probe binding. It reads a FloatType target at
three poses:

1. Identity root/camera: the center reflection must be source −Z (yellow).
2. Root +90° with fixed camera: it must be source +X (red).
3. Root and camera both +90°: it must return to source −Z (yellow).

Five further camera positions check source +X, −X, +Z, +Y and −Y, so every
cardinal is read from the GPU. The diagnostic plane is double-sided solely to
allow the −Y underside sample; this does not change production pond materials.

It returns actual linear RGB samples, normalized channel errors, the quarter-turn
covariance error and `passed`. Root must record the returned JSON and assert
`passed === true` for each engine. A valid run should have per-pose maximum
normalized error below .08 and covariance error below .02. The source panorama
contains distinct colours for every cardinal and both poles; shared CPU tests
also verify their UV placement. The helper restores render target,
viewport/scissor state and disposes only its own diagnostic resources.

This is engine/asset calibration, not an XR session, UI input test, actual HDR
asset-loading test, real pond reflection/parallax validation or headset frame
time measurement. Actual SDK HDR-loader flip/mapping must be checked separately
after a private probe is registered and loaded through AssetManager.
