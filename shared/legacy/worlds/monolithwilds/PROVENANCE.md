# Monolith Wilds source integration

Source: https://github.com/Leonxlnx/monolithwilds at commit `02dbcd3e790c21861dfecb47f4d9e23cccee35ec` (MIT, full notice in LICENSE).

This is the actual source site plan and world graph: the 9.2 km basin, great lake, canyon, escarpment, forest/rock/ruin systems and all eleven monument builders. It does not include upstream UI, controls, touring, music or audio. Upstream narrative labels remain technical source metadata rather than approved Crownfall canon; Crownfall's existing four Legacy labels are the player destinations.

Adaptations: Three imports use the consuming application's namespace; BufferGeometryUtils calls use a local namespace-safe implementation; fog patches stay local to these materials; procedural coordinates can be transformed back to source metres when the world becomes a Quest miniature; renderer/animation-loop ownership remains with Crownfall. The expensive sky PMREM refresh is delegated to the consuming renderer. Quest reduces terrain refinement and vegetation density while retaining the source world layout.

No physical headset performance or comfort has been established by this source port. GPU rendering and native hand interaction must be verified by the consuming app.

## Runtime geometry adaptation

All seven world systems and all eleven source monuments are retained at their original placements. Crownfall derives mesh LOD from those generated source vertices; it does not replace the architecture with generic props. The original basin, canyon, lake and distant terrain remain present, with the miniature framed around a 5.2 km hero region.

Quest uses a coarser terrain triangle index grid, lower source forest density (12 m placement grid versus 7.4 m), coarser hanging-garden leaf clumps and larger honeycomb detail cells. `source-lod.js` then welds vertices per connected surface on an absolute cell: 2.4 m in the Quest geometry profile (roughly one pixel on the miniature at 1.5 m, assuming 20 pixels per degree) and 1.2 m in the desktop profile (under 2 pixels at 1280x720 beyond 500 m, about 8 at the closest landmark zoom). Custom-shader, transparent, per-vertex-payload and runtime-placed geometry keeps its source vertices, so the instance/interleaved buffers and source animation semantics stay live. `verify-lod.mjs` checks these guards on fixtures and on the built world. These choices need rendered review before a visual-quality claim.

CPU generation measurement (offscreen GPU texture bakes explicitly stubbed, no pixel/shader/FPS claim): Quest approximately 3.11M potential triangles, Desktop approximately 4.45M, both including the orrery's 297k, and about 214 potential mesh draws in either profile. Both exceed the budgets in docs/legacy/PERFORMANCE.md; correct source geometry costs this much. Actual visible geometry and GPU draws differ with frustum and batching. CPU generation measured roughly 14–17 seconds on the development host. Those numbers are not physical Quest performance or cold-start evidence.
