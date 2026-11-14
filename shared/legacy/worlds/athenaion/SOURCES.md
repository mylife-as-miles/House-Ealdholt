# Athenaion source adaptation

Source: https://github.com/Leonxlnx/athenaion
Pinned commit: `9b8bd23b39c458a50fb1201037360047781c45b5`.
Author: Leon Lin. MIT notice retained in `LICENSE`.

This adapter uses the actual source heightfield and surface-net terrain, temples, complete acropolis terraces/staircases/retaining walls, aqueducts, city/harbour, tree system, water/waterfalls and sky. It does not contain Crownfall's previous castle scene. Original world placements and major architectural silhouettes remain the scene's composition.

Crownfall adaptations:

- The offline renderer/shot loop, CSM/global shader modifications, source browser UI and music are excluded. The host owns rendering, navigation and house state.
- Source deity colossi are recast at their original positions as neutral chess-king monuments. Source owl flags and religious inscriptions are excluded; the host supplies the actual house's heraldry.
- Renderer-specific objects resolve through `crownfall-world-three`, owned separately by the desktop and Quest adapters.
- Source procedural material coordinates are retained through per-material source-space uniforms; actual XR projection remains physical.
- Runtime terrain meshing uses the source geography without cache/download URL assumptions. Finer tessellation is used on desktop. Vertex-clustering LOD reduces microgeometry without removing building placements; Quest balusters retain all placements with bounded post geometry, and tiny decorative weed prototypes use coarse blade triangles.
- The Quest profile plans terrain by distance from the site (8 m cells there) instead of by the film's cameras, so the lagoon, canyon and cliffs survive its coarser mesh.
- Static architecture is merged by material after compaction (`merge.js`), replacing the source's spatial chunk draws. Geometry is unchanged by the merge. Spatial chunks stay coarser on desktop, where the camera can close in on one landmark.
- Source water depth, foam, FFT ripples and waterfall systems remain. Planar recursive reflection is disabled on both platforms. The FFT, height capture and cloud noise resolutions are reduced for interactive use.
- Film-only foreground sets, sculpted deity/head close-ups and extra hero microflora are excluded. The environment is the source world adapted for Crownfall, rather than the entire film renderer.

`vendor/compat/BufferGeometryUtils.js` and `vendor/compat/Pass.js` are from the installed Three.js r185 MIT distribution. Its notice is retained as `THREE-LICENSE`. They resolve through the same per-app namespace, avoiding a second live Three runtime.

Geometry smoke checks are not physical Quest performance, GPU rendering or comfort verification. The host must perform visual and interaction QA, including final complete-scene counts after trees and water are installed.
