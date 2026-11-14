# Procedural Terrains adaptations

Source: https://github.com/ZyFou/ProceduralTerrains

Reviewed revision: `8349b2c8c8637f355bfe17e01c76807d41994407` (5 November 2026).

The Hoskins hash and quintic noise interpolation in `atmosphere.ts` adapt
`src/engine/sky/cloudGLSL.js`. The derivative footprint filter in
`water-ripples.ts` adapts `waterBandFilter` from
`src/engine/water/waterWavesGLSL.js`. The bounded texture bake, dome rendering,
pond wave selection, lifecycle and platform adapters are Crownfall code.

These adaptations do not include the terrain studio, volumetric ray marcher,
planar reflections, depth refraction, underwater effects, or third-party assets.
The pond still uses static sky illumination: it does not reflect the actual trees.

## Upstream MIT licence

Copyright (c) 2026 ZyFou

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense,
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
