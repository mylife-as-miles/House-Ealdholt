# Crownfall source-world environment provenance

The original Bannerhold remains a separate option. The three licensed source worlds below replace its settlement/terrain entirely when selected: they do not append props to the old castle. Their original site plans, landscapes, main architecture, water and vegetation are retained, with native Crownfall navigation and actual house heraldry. Display names remain replaceable art-direction labels, not new canonical locations or political rank upgrades.

| World | Pinned upstream source | Included source composition |
| --- | --- | --- |
| Temple Terraces | [Golden Temple](https://github.com/Leonxlnx/golden-temple), `97fd9ec35ee5c0f02769addb4e35cb5e22f951dd` | Original grounds, hall, pagoda, pond/shoreline, bridge, corridors, gate, side halls and vegetation |
| Monolith Wilds | [Monolith Wilds](https://github.com/Leonxlnx/monolithwilds), `02dbcd3e790c21861dfecb47f4d9e23cccee35ec` | Original basin, terrain, lake/canyon, vegetation and all eleven monuments |
| Citadel Terraces | [Athenaion](https://github.com/Leonxlnx/athenaion), `9b8bd23b39c458a50fb1201037360047781c45b5` | Original terrain, temples, acropolis terraces/stairs, aqueducts, city/harbour, trees, water and sky |

Full upstream MIT notices and Three.js geometry-helper notice accompany this file. Detailed port provenance lives alongside each source tree in `shared/legacy/worlds/`. Source UI, audio, camera flythroughs and offline film renderers are excluded. Religious colossi/decorations are omitted or recast as Crownfall chess monuments. Source banners are replaced by the actual house's rasterized heraldry; visual scene selection never changes Legacy saves or game results.

Desktop and Quest use separate platform-owned Three namespaces. Source shader coordinates stay in source metres while Quest rasterization uses the native viewer's true physical projection. Geometry detail/foliage reduction retains the source layout and main silhouettes. CPU generation/LOD counts are not evidence of actual Quest frame rate, comfort or tracking quality; those require physical hardware testing.

## Integration status

These full-world ports are unfinished previews. They have not passed the established Quest geometry/draw budgets or physical-headset acceptance. The corrected Temple profile alone retains a CPU-estimated 7,710,489 triangles and 262 potential draws; this is not an accepted Quest asset. Software XR testing reached My Legacy with real emulated hand input but timed out initializing the source environment, including after a reduced contact-foam bake. A normal-detail Temple desktop capture initialized but did not finish. CPU geometry tests and successful application builds do not establish those missing visual, loading or performance passes. The original Bannerhold remains a separate option.

## Alpine Lake

[procedural-alpine-lake](https://github.com/Leonxlnx/procedural-alpine-lake), inspected at `b84c254b3fa533b8c992eb685e1127a92702da21`, has no identified reuse license. Its code, shaders, renders, reference photographs, music and other assets are not redistributed. Crownfall's Alpine Lake is an independent glacial-valley rebuild with continuous mountains, lake, forests and twin falls, using original code. Direct source incorporation remains pending the author's reuse permission.

## Elderbloom rendering techniques

The active Crownfall environment integration adapts HLOD handoffs, source-surface captures,
coverage mips and bounded preparation from [BakedVoxelLighting](https://github.com/SamG-Coder/BakedVoxelLighting)
at `22f3dc468c951707ef46e07113758336e98257d5`. Its full MIT notice is in
`BakedVoxelLighting-MIT.txt`. Its demonstration world/assets and renderer are not imported.
Crownfall remains on its separate r185 Desktop/Native rendering paths.

Derived tree-index preparation uses the existing MIT meshoptimizer 1.1.1 dependency in a dedicated
worker (no additional Three graph, compressed asset decoder or renderer upgrade). This extends its
previous build-only use to cancellable derived geometry work. The original GLB attribute buffers,
collision/navigation data and actor placement remain authoritative. See `meshoptimizer-MIT.txt`.


## Shared village water and fire

- [Open Water](https://github.com/Leonxlnx/open-water), pinned to
  `3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8`, Copyright (c) 2026 Leonxlnx,
  MIT notice: `open-water-MIT.txt`. The wave spectrum, Stockham FFT and foam
  techniques are adapted to Crownfall's existing Three.js renderer and source-space
  water materials. Upstream audio recordings are separately licensed and are excluded.
- [Procedural Fire](https://github.com/Leonxlnx/procedural-fire), pinned to
  `95ab0a9003e20f1b0a5556ac14b401dfa0a37596`, Copyright (c) 2026 Leon Lin,
  MIT notice: `procedural-fire-MIT.txt`. Combustion/transport and blackbody colour
  techniques feed a bounded shared fire field using Crownfall's existing clock and
  renderer. The compatible CPU/slice-card adaptation is not the standalone WebGPU
  engine or a full scene-depth volume renderer.

Existing water geography, imported materials, source hearth anchors and damage/save
rules remain Crownfall-owned. Rendering does not create flood or fire-damage events.


The current water port publishes spectral normals/roughness and accumulated foam;
it preserves the authored surface geometry rather than tessellating/displacing it.
Unsupported floating-point hardware and active stereo/subview viewports which cannot
be restored through the public renderer API use the existing animated analytic water
fallback. The FFT path can resume once the caller returns to a restorable view state.
Fire is explicitly a CPU 3D field with a 2.5D depth-tested card representation, not
scene-depth-aware volume raymarching. Physical Quest and target-GPU performance remain
unmeasured; shader/numerical tests are not that evidence.
