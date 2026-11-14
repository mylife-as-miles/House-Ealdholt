# Original Crownfall estate water

The public estate water is original Crownfall code. The `alpine.js` filename,
`createAlpineWater` factory alias and `alpine` diagnostic field remain only for
compatibility with existing estate consumers. The canonical factory is
`createCrownfallEstateWater`.

No code, shader excerpts, optical constants, noise functions, photographs or
renders from Leon Lin's `procedural-alpine-lake` repository are bundled here.
The previously prepared local adaptation and its exact provenance are retained
privately outside Git. The reported permission has no recorded redistribution
scope, so that adaptation remains excluded from publication.

The replacement uses the consuming application's Three namespace, a two-triangle
surface and `MeshPhysicalMaterial`. It borrows the project's shared analytic
pond ripples. That helper's footprint filtering adapts MIT-licensed
ZyFou/ProceduralTerrains code; the exact revision and full notice are recorded in
`shared/legacy/aethelgard/environment/PROCEDURAL_TERRAINS_SOURCES.md`.

Source-frame matrices preserve wave placement under rotated/scaled miniatures.
The bounded local clock freezes with reduced motion, and disposal owns only the
surface geometry and material. No texture, reflection target, renderer, light,
audio system or animation loop is created. The camera diagnostic remains in
source metres. The existing environment supplies PBR sky illumination; actual
scene reflections, depth refraction and underwater scattering are not included.

The legacy look object is validated and copied for API compatibility. Its
`inScatter` triple supplies the water's linear base colour; the remaining legacy
sky/bed/scattering fields are retained only as metadata and do not recreate the
excluded optical shader.

CPU tests check namespaces, ownership, source transforms, clock freeze/resume,
parameter validation and exclusion of upstream source. They do not prove shader
compilation, pixels, frame rate, physical Quest comfort or hand interaction.
