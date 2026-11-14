# Private static pond probe preparation

The runtime adapters optionally load a configured private probe. No actual
village probe has been baked or visually qualified by this integration change.
Captured HDR files and their metadata belong in private
asset storage, outside Git. Source geometry and texture pixels are not embedded
in the helpers or tests.

The intended result is a **baked local reflection** containing the fixed scene's
trees and shore, not a live reflection pass. It will have near-shore parallax
errors away from its single capture point and will not follow moving clouds,
people, fire, lighting changes or geometry changes. It does not establish a
visual score or headset performance.

## Authoring hook owned by the Desktop factory

Call `captureEaldholtPondProbe(renderer, scene, options)` from the real Desktop
factory after model, exterior, dressing, lighting, neutral fill and shadows have
been assembled. Use a separate non-XR authoring renderer. The helper refuses an
XR-enabled or presenting renderer; it never changes XR state.

The factory must prepare full static vegetation visibility before its normal
camera-specific plant culling runs. Set the active static cloud/fire state and
verify shadow coverage from the pond. Nothing in this helper resets culling or
changes global lighting, the tracked camera or the scene background. Pass the
actual source-model root, its private file SHA-256 and an explicit lighting
revision that also identifies the procedural exterior/dressing assembly. Change
that revision when any captured assembly or lighting changes, even if the GLB
hash is unchanged. The helper measures the verified pond geometry to find its capture
point and orient its axes in the model's source frame. It hides only verified
pond/trough surface meshes for the capture. Mixed opaque/water material meshes
are refused rather than hiding adjacent props.

The one-shot helper creates a public `CubeCamera` and half-float cube render
target, then copies raw linear radiance into a float equirectangular target. It
requires `EXT_color_buffer_float`. Readback is serialized as a standard Radiance
RGBE `.hdr`, not a tonemapped or gamma-encoded PNG. Renderer target, cube face,
mipmap, viewport, scissor, clear state, tone mapping, exposure, output color space
and surface visibility are restored, including when capture/readback throws.
Only temporary capture resources are disposed.

Use profile `desktop` for 1024×512 (256-pixel cube faces), `quest` for 512×256
(128-pixel faces). Quest's probe should be authored from its actual private
geometry/LOD and assembled dressing, not assumed identical to Desktop. The source
hash and lighting revision in the returned metadata must match the eventual
runtime binding.

For a narrow browser export, root can attach one DEV-only authoring action that
calls this helper, then offers `new Blob([result.hdrBytes],
{type:'application/octet-stream'})` as a download and the JSON metadata as a
second download. Use an explicit private output destination and remove/revoke
the temporary links/object URLs afterward. Do not expose `scene`, `renderer`,
asset mutation, arbitrary evaluation or a persistent capture API on `window`.
The Native runtime has no capture hook. The Desktop factory's DEV-only
`authorPondProbe` option bypasses configured runtime probes so an earlier
reflection cannot feed back into a new bake.

## Private runtime configuration

Supply `VITE_ELDERBLOOM_POND_PROBES` to each Vite process as JSON text. It is
DEV-only and keyed by `desktop` and/or `quest`. Each configured profile requires
`modelUrl`, `modelSha256`, `lightingVersion`, `hdrUrl` and `metadataUrl`.
The URLs must be absolute immutable loopback assets with `.glb`, `.hdr` and
`.json` suffixes. Root supplies the actual private values after qualification;
do not commit the environment string, private files or source positions.

The model URL must exactly match the selected preview asset URL. Source
provenance comes from immutable URLs and root's offline served-file hash checks;
the Native adapter does not hash or re-download cached GLB bytes at runtime.
Metadata is requested only on preview entry, with cancellation, no redirects
and no cache. Its source hash, lighting revision, radiance format and profile
dimensions must match the configured identity. Desktop fetches the HDR then
uses the public `HDRLoader.loadAsync` Blob path with half-float output; Native
registers one lazy `HDRTexture` descriptor and uses public AssetManager loading.

A missing profile retains the existing sky-lit pond. Configured load or identity
errors fail preview setup and expose its Retry path; they never report a bound
reflection. Invalid private configuration cannot break Home's manifest.
Diagnostics expose probe status/material count and the loaded texture's actual
loader source, profile, dimensions, format, type, colour space, mapping and
`flipY`, without exposing the scene or renderer. Desktop owns and disposes its
loaded texture after restoring the pond material; Native always borrows the
SDK texture. An in-flight cancelled Desktop load releases its late texture.

## Runtime binding order and ownership

Load the private HDR once and treat it as borrowed. Desktop can use the public
`HDRLoader` with root-owned caching. Native should register `AssetType.HDRTexture`
and call `loadEaldholtBorrowedPondProbeById`, which delegates only to public
`AssetManager.loadHDRTextureById`. The SDK owns that cached texture; cancellation
must not dispose it. The caller must still reject a stale preview/entity
generation after awaiting the load.

Use a linear HDR equirectangular reflection texture with the matching profile
dimensions. The binding refuses LDR, wrong dimensions and stale source/lighting
identities. It does not mutate the texture, call a live probe, change
`scene.environment`, or set global lighting. Public PBR environment-map handling
generates the appropriate PMREM for each adapter; a baked engine-specific CubeUV
atlas is not shared between engine versions.

Apply `applyEaldholtBorrowedPondProbe` **after the existing water look but before
neutral fill**. It clones only verified pond materials and preserves their
source-metre ripple hooks, IOR, roughness and other PBR properties. Trough, river,
sea and building materials keep their existing bindings. The default local gain
is 1 and needs visual calibration, replacing the incomplete static-sky gain .16.
The binding preserves source roughness by default, including zero-roughness
calibration mirrors. The configured village factories explicitly pass the shared
selected baseline roughness `.24` only when a local probe is bound. The selected
normal multiplier is `1`, preserving the inherited normal amplitude. The more
reflective `.10` roughness and reduced `.12` normal comparisons scored worse in
actual Desktop captures and were reverted. Optional overrides remain available
for isolated authoring; a successful binding is not visual acceptance.
These settings change only owned pond clones. The normal map, IOR, Fresnel
settings and analytic ripple amplitude/clock are preserved. Diagnostics record
both the selected multiplier and the actual clone scale(s).
Source materials, other water surfaces and zero-roughness calibration callers
remain unchanged unless they explicitly pass an override.

Both neutral-fill adapters honor
`skipsEaldholtProbeNeutralFill(material.userData)`. The capture already contains
neutral-lit scene radiance, so another 70% neutral mix would be incorrect. These
adapters also keep direct light unchanged. An already-neutralized pond
material is refused instead of attempting to unpatch its shader.

Call the binding's `update()` after miniature rotation, zoom/recentering and
before drawing. Its public material render callback also refreshes rotation;
both use preallocated matrices/Eulers and indexed arrays. Probe orientation
follows the whole model root; scale and translation do not rotate a distant
environment. Root owns any future parallax correction. Dispose this binding
before the water-look owner; it restores exact material assignments and disposes
only its own clones. Neither borrowed maps nor the probe texture are disposed.

## Qualification still required

1. Bake privately using the complete actual factory; verify finite nonblack HDR
   pixels and hash/lighting metadata. Compare a standard HDR-loader roundtrip.
2. Capture the same pond view with static sky, then local probe, at identical
   exposure/lighting. Identify actual canopy/shore landmarks in the reflection;
   do not label sky variation as tree reflection.
3. With a cardinally marked synthetic probe first, verify +X/+Z/−X/−Z and poles.
   Then rotate the Native miniature by a quarter turn and return it. The same
   tree/shore landmarks must remain tied to the village. CPU basis tests alone
   cannot prove cube/equirectangular handedness or the final rendered PMREM.
4. Repeat at the actual pond camera and a close angle to reveal single-probe
   parallax limits. Check both target LODs. Re-run pause/navigation/re-entry and
   saved-data checks after runtime integration; capture itself stays outside XR.
5. Measure runtime texture/PMREM allocations and physical Quest frame time.
   Approximate budgets are 1 MiB raw HDR plus 1.5 MiB PMREM for Quest, and 4 MiB
   raw HDR plus 6 MiB PMREM for Desktop (RGBA16F, excluding renderer bookkeeping
   and possible cache copies). Authoring additionally uses cube/readback targets
   and CPU float buffers, so it is not a headset runtime feature.

Public source/API grounding:

- [CubeCamera](https://threejs.org/docs/pages/CubeCamera.html)
- [WebGLCubeRenderTarget](https://threejs.org/docs/pages/WebGLCubeRenderTarget.html)
- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [MeshStandardMaterial environment map and rotation](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)
- [IWSDK AssetManager](https://iwsdk.dev/api/core/classes/AssetManager.html)

The shader projection, RGBE writer, binding and tests are original project code.
The engine is used through public APIs; no engine internals or proprietary source
pixel data are copied into this preparation.
