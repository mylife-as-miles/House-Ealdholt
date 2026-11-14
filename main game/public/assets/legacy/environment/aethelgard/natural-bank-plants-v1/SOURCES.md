# Natural bank plants

Poly Haven A Verdant Trail, Rico Cilliers, CC0-1.0: https://polyhaven.com/a/grass_medium_02 and https://polyhaven.com/a/shrub_03 . Official licence: https://polyhaven.com/license . Only grass_medium_02_e and shrub_03_b are included. No demonstration world or original settlement data is imported.

Geometry, normals and UVs retain exact source accessor values and natural uniform proportions. Catalogue display offsets are omitted. Provider16-bit Alpha PNGs normalize by round(value/257), then join the matching JPEG albedo. Colour filters in alpha-weighted linear light; original OpenGL normals renormalize and ARM filters linearly. All map rows retain source orientation, glTF flipY=false. Runtime uses explicit coverage-preserving RGBA mip views; MASK0.5 deliberately replaces original grass BLEND for cutout rendering. Tiny final mips choose the closest possible coverage, including transparent rather than opaque1x1 cards. No colour tint, generated anatomy or novel plant geometry.

Desktop256px and Native128px are separate derivatives. Original files, official size/MD5 and SHA256 evidence remain in the private source intake; public source hashes, material/accessor/mip hashes and conservative source CPU/GPU residency estimates are in manifest.json. These are accounting estimates, not hardware measurements.

Rebuild: node scripts/environment/build-natural-riparian.mjs PRIVATE_SOURCE_INTAKE NEW_OUTPUT_DIRECTORY .
