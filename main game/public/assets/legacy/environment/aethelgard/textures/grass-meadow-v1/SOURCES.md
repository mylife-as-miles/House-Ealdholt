# Grass001 meadow material

Created using [Grass001 from ambientCG](https://ambientcg.com/a/Grass001), licensed under [Creative Commons CC0 1.0 Universal](https://docs.ambientcg.com/license/). The CC0 legal code, source and derivative hashes, official API records and processing metadata are included.

This is an authored procedural PBR material. The official asset page and v3 API identify that technique; `provenance.json` records a conflicting v2 display label. The official page states an approximate 1.4 × 1.4 metre tile, matching the API’s 140 × 140 centimetre dimensions. The renderer retains this authored scale.

It provides the green layer on generated exterior terrain. Original Elderbloom village materials and the existing earth, wet shore and rock layers retain their separate ownership. This material complements the requested Poly Haven collections and comes from ambientCG.

Desktop uses 1024px maps with exact decoded source albedo RGB. Quest uses 512px maps with albedo filtered in linear light. OpenGL normal vectors are filtered and normalized. ORM packs source occlusion and roughness in R/G and dielectric metallic zero in B. Lossless WebP derivatives preserve source rows; all three maps use `flipY=false`. No hue, tint or saturation correction is applied.

Original downloads remain outside the repository. The official archive byte count was verified; its SHA-256 was recorded locally because the API publishes no independent cryptographic checksum. `provenance.json` records the source URLs, archive and map hashes, scale evidence, licence and processing.

Calculated RGBA8 storage with full mip chains is 16,777,212 bytes on Desktop and 4,194,300 bytes on Quest for the three maps. These are allocation estimates, not physical-device measurements.
