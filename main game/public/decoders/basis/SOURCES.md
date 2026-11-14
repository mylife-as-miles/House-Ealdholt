# Local Basis Universal runtime

`basis_transcoder.js` and `basis_transcoder.wasm` are unchanged copies from the
installed Three.js **0.185.1** package (`examples/jsm/libs/basis/`). They are served
from Crownfall's own static directory for both development and production.
This avoids development URLs resolving through a shared `node_modules` realpath
outside Vite's filesystem allowlist. No filesystem allowlist was broadened.

Package source: https://registry.npmjs.org/three/-/three-0.185.1.tgz
Package integrity: `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==`

Three's original Basis README is retained as `README-Three-Basis.md`. The
transcoder is licensed under Apache 2.0; the full upstream licence and required
attribution notice are retained in `LICENSE-Basis.txt` and `NOTICE-Basis.txt`.
Three's MIT licence is included as `LICENSE-Three.txt`.

Licence sources (retrieved 11 November 2026):

- https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE
- https://github.com/BinomialLLC/basis_universal/blob/master/NOTICE

`manifest.json` records SHA-256 digests and byte counts for these copies. This
directory contains decoder infrastructure, not Megascans models or textures,
and grants no rights to Fab assets. No new Fab asset is imported by this change.
Native continues to use IWSDK's asset manager and supported decoder ownership;
this addition does not replace its Three.js alias or renderer.
