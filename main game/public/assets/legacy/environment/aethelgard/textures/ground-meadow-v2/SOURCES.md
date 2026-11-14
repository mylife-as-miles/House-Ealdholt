# Forest Ground 01 — Ealdholt meadow ground layer

Powered by Poly Haven. Forest Ground 01 — Rob Tuytel: https://polyhaven.com/a/forrest_ground_01 . CC0-1.0; official licence https://polyhaven.com/license ; the asset page declares CC0 1.0 Universal. Legal code is included in CC0-1.0.txt.

Green-dominant meadow sward: grass, straw, twigs and protected litter (albedo chroma graded, see modifications). Photographed as a 2 m tile. Intake date 2026-11-06. Maps (only those the valley shader samples): desktop albedo 1024 px, normal 1024 px; quest albedo 512 px, normal 256 px. sRGB albedo, OpenGL normals (renormalized) and linear ARM (R=AO, G=roughness, B=metallic) stay aligned; configure flipY=false.

Modifications: Albedo chroma graded (living-sward v2): a hard vegetation mask selects blades and straw; they move by one linear-chromaticity offset toward the photo's own strongest living greens until the tile mean (G-R)/Y is 0.3889 (no lower than the village atlas olive 0.3889); per-pixel linear luminance preserved; litter, soil, twigs and crevices bit-identical. Normal map unmodified.

Source URLs, fixed official MD5/size checks, source and derived SHA-256 hashes, licence evidence and processing are in provenance.json and manifest.json. Original downloads remain outside the repository. Reproduce with node scripts/prepare-ealdholt-woodland-ground.mjs fetch PRIVATE_INTAKE_DIRECTORY, then node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY . Full mip-chain RGBA8 byte figures are estimates, not GPU or headset measurements. Nothing loads at runtime unless an integration explicitly requests this folder.
