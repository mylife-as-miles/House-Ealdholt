# Aethelgard photographic terrain reconstruction

Powered by Poly Haven. These two photographic PBR sets are CC0 1.0 assets. This replaces missing landscape surface treatment; it does not recover Elderbloom's Unreal landscape painting. Existing procedural fallback textures remain separate.

- Stony Dirt Path — eye-candy.xyz: https://polyhaven.com/a/stony_dirt_path
- Rock Surface — Amal Kumar: https://polyhaven.com/a/rock_surface

Official asset licence: https://polyhaven.com/license . CC0 legal code is included in CC0-1.0.txt. Source API/download URLs, authors, official MD5 checks, original/derived SHA-256 hashes and processing metadata are recorded in provenance.json and manifest.json. No ArtStation or other showcase images are redistributed.

Offline preparation preserves image row orientation, linearly downsamples sRGB albedo, renormalizes OpenGL normals, and packs source AO/Roughness into R/G with dielectric metallic B=0. Desktop uses 1024px maps. Quest uses 512px albedo and 256px data maps. Generated UV1 atlas colour/masks and source terrain geometry are not changed. Shader detail should preserve atlas hue and use the matching profile's measured linear mean.

Reproduce with: node scripts/prepare-aethelgard-photographic-ground.mjs SOURCE_DOWNLOAD_DIRECTORY NEW_OUTPUT_DIRECTORY

Texture sizes and memory figures are metadata estimates, not a physical Quest performance pass.
