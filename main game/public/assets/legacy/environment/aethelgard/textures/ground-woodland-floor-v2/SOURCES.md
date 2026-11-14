# Forest Leaves 03 — Ealdholt woodland ground layer

Powered by Poly Haven. Forest Leaves 03 — Rob Tuytel, Dimitrios Savva: https://polyhaven.com/a/forest_leaves_03 . CC0-1.0; official licence https://polyhaven.com/license ; the asset page declares CC0 1.0 Universal. Legal code is included in CC0-1.0.txt.

Woodland floor leaf litter, cooled toward olive-grey; the valley shader adds a living moss/herb term under canopy. Photographed as a 2.3 m tile. Intake date 2026-11-06. Maps (only those the valley shader samples): desktop albedo 1024 px; quest albedo 512 px. sRGB albedo, OpenGL normals (renormalized) and linear ARM (R=AO, G=roughness, B=metallic) stay aligned; configure flipY=false.

Modifications: Albedo litter cooled: every pixel moves 0.28 of the way from the tile's mean chromaticity toward olive-grey, with per-pixel linear luminance preserved.

Source URLs, fixed official MD5/size checks, source and derived SHA-256 hashes, licence evidence and processing are in provenance.json and manifest.json. Original downloads remain outside the repository. Reproduce with node scripts/prepare-ealdholt-woodland-ground.mjs fetch PRIVATE_INTAKE_DIRECTORY, then node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY . Full mip-chain RGBA8 byte figures are estimates, not GPU or headset measurements. Nothing loads at runtime unless an integration explicitly requests this folder.
