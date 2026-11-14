# Golden Temple source-world adaptation

Upstream: https://github.com/Leonxlnx/golden-temple
Pinned source: `97fd9ec35ee5c0f02769addb4e35cb5e22f951dd`
Author: Leon Lin, MIT. Full license: `LICENSE.golden-temple.txt`.

This is the real source campus, not an architectural prop added to Bannerhold. The imported dependency closure contains the actual site layout, courtyard terrain and surrounding mountains/forests, source pond and shoreline/lotus/koi, main hall, five-storey pagoda, arched bridge, perimeter corridors/gate/bell tower/side halls/pavilion, lanterns/bells and hero vegetation. The independent offline-film interior/SDF religious statue module, source UI, controls, film render loop, music and source post pipeline are excluded. Crownfall owns the interaction flow, current house heraldry, nation styling, lighting, camera and XR viewer.

Public Three geometry addons (BufferGeometryUtils, RoundedBoxGeometry, ConvexGeometry and ConvexHull) are copied from Crownfall's installed Three r185 package with `LICENSE.three.txt`. Every runtime Three import resolves through the consuming app's `crownfall-world-three` adapter; there is no second Three runtime.

Adaptations:

- Add `buildWorld` as a scene-owned lifecycle; no extra animation loop or renderer.
- Preserve the site plan, all main source modules and architectural silhouettes. Topology- and seam-aware vertex clustering is limited to ordinary opaque geometry; alpha-cutout, deforming, interleaved and shader-encoded payloads remain protected. Distributed instance thinning, fewer rounded-bevel segments and omission of tertiary bark twigs reduce triangle counts without relocating the campus. Quest prop helpers reduce their own analytic samples before encoding material attributes: petal bands retain three samples per petal and four rows, roof caps use four-by-four top grids, lathe rings use at most twelve radial samples, and ornamental tubes use four radial/eight curve samples. Generic callback grids are unchanged. These reductions do not establish compliance with the Quest geometry budget. Sampling profiles reduce courtyard mesh density, radial far terrain, forest spacing, foliage cards and leaf atlas size. Quest also disables source planar water reflection and source wind. The real water/shoreline material remains.
- Expose per-material inverse-root and source-camera uniforms so procedural grain remains in source metres when the scene is miniaturized. Local source calculations are returned through a per-material forward matrix before projection; point/spot intensity and range scale with the miniature. Only authored shader hooks use the source camera. Rasterization, shadows and Three lighting retain true model/view matrices.
- Surface failed terrain/pond modules as errors instead of reporting partial success.
- Repair non-finite and negative texels in the planar mirror before its mips are built. The source film renderer never showed them; here they became white blocks in the water.
- Dispose source render targets, geometry, materials, textures and callbacks.

The source's global ShaderChunk fog installer and ambient-volume installer are not used. Source patched materials receive the original height/aerial helper and final fog locally, with an independent density multiplier of 1; the pond uses the same helper for reflection compensation. No global ShaderChunk is changed. Ordinary Crownfall materials continue to use platform-native scene fog. CPU/module graph checks do not establish GPU performance or physical Quest comfort.
