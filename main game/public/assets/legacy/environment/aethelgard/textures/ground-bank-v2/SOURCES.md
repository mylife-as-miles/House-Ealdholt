# Brown Mud Rocks 01 — Ealdholt bank ground layer

Powered by Poly Haven. Brown Mud Rocks 01 — Rob Tuytel: https://polyhaven.com/a/brown_mud_rocks_01 . CC0-1.0; official licence https://polyhaven.com/license ; the asset page declares CC0 1.0 Universal. Legal code is included in CC0-1.0.txt.

Exposed riverbank: brown mud with loose stones and scattered weeds (matte when dry; the shader adds wet gloss at the waterline). Photographed as a 1.3 m tile. Intake date 2026-11-06. Maps (only those the valley shader samples): desktop albedo 1024 px, normal 1024 px, orm 1024 px; quest albedo 512 px, normal 256 px, orm 256 px. sRGB albedo, OpenGL normals (renormalized) and linear ARM (R=AO, G=roughness, B=metallic) stay aligned; configure flipY=false.

Modifications: ARM roughness remapped to 0.7 + 0.27 x source (dry bank soil is matte; the shader adds wet gloss). AO, metallic, albedo and normal unmodified.

Source URLs, fixed official MD5/size checks, source and derived SHA-256 hashes, licence evidence and processing are in provenance.json and manifest.json. Original downloads remain outside the repository. Reproduce with node scripts/prepare-ealdholt-woodland-ground.mjs fetch PRIVATE_INTAKE_DIRECTORY, then node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY . Full mip-chain RGBA8 byte figures are estimates, not GPU or headset measurements. Nothing loads at runtime unless an integration explicitly requests this folder.
