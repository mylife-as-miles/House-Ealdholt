# Adaptation source

Crownfall's world-rendering work studies and adapts algorithms from
[SamG-Coder/BakedVoxelLighting](https://github.com/SamG-Coder/BakedVoxelLighting),
revision `22f3dc468c951707ef46e07113758336e98257d5` (MIT, copyright 2026 SamG-Coder).

The full MIT notice is shipped at `assets/legacy/environment/licenses/BakedVoxelLighting-MIT.txt`
in both app asset sets. See `docs/legacy/environment/WORLD_RENDERING_INTEGRATION.md` for
module-level provenance and implemented versus outstanding work. Crownfall retains its authored
world, private source assets and r185 renderer; reference demonstration assets/world data are not copied.

Generated regional foliage normal RGB adapts `normal-map.js` and the
`normalKernel` in `native-kernels.js` at that same revision. Source-file SHA-256
digests are `afd4ef5b1158f411474db2829c4c35c2995f4554897d9a61e156e56033051f5e`
and `cfd8df654e6e0d053665b4692b47c0e6420e45ce4479915f1c2b2b4d740fcf81`.
The bounded CPU worker adaptation adds linear-sRGB alpha-weighted input,
strict existing-image provenance, renormalized mips and resource accounting.
It does not copy the reference's separate thin-material response-alpha
semantics into Crownfall's cutout-coverage atlas format, or invent an AO map.

The river broad-height field adapts cubic 2D corner interpolation and the
two-scale surface approach from `src/river-kernels.js` at that revision
(SHA-256 `652e15f9eb5798b63bcb450134682a382afe37f9ee3881ac557d8e37e245a529`).
Crownfall uses two fixed rotated octaves, bounded corner elevations and analytic
gradients without the reference texture bake or renderer. Its integer mixing
reuses the approach already present in Crownfall's cloud-density source. The
reference's demo terrain, hydrology and reflection passes are not imported.
