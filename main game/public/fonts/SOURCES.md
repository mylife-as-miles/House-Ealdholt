# Local font provenance

`NotoSerif-Regular.ttf` is the unchanged Noto Serif Regular font, Version 2.004,
from the environment's `fonts-noto-core` package. Its embedded copyright is
“Copyright 2015 Google LLC. All Rights Reserved.” The source copy was
`/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf`.

- Upstream: https://github.com/notofonts/noto-fonts
- Licence: SIL Open Font License 1.1, included in `OFL-NotoSerif.txt`.
- Size: 588,876 bytes.
- SHA-256: `9d7583b7dc9e812afd32a14280c5cac3160012efe50c8d08938f4fea266ff67f`.

The font is used for secondary Legacy house display headings. It is served locally; the
application does not request a remote font. Canonical files in this directory
are mirrored into Quest by `scripts/sync-menu-assets.mjs`.

The existing Barlow and Barlow Condensed faces retain their licence in
`OFL-Barlow.txt` and remain the menu, body and control fonts.

## Geist Serif Regular masthead

`GeistSerif-Regular.ttf` is the unchanged static Regular (400) face from
Vercel's `geist-font` release `v1.9.2`, pinned to commit
`ef2597cfc42f4797676df105517ccc0a1cfa6569`.

- Source: https://github.com/vercel/geist-font/blob/v1.9.2/fonts/GeistSerif/ttf/GeistSerif-Regular.ttf
- Copyright: Copyright 2026 The Geist Project Authors.
- Licence: SIL Open Font License 1.1, included verbatim in `OFL-GeistSerif.txt`.
- Size: 167,052 bytes.
- SHA-256: `22c4da0b51f73840378a0a6ea74d018c6e5b476475b01a5f15a3a306f798c9d5`.
- Exact source, upstream Git blob identifiers and notice hashes are recorded in
  `GeistSerif-provenance.json`.

This display face is reserved for the large Legacy masthead, including its
Native context titles. Smaller headings, body text, dialogue and controls retain
their existing typography.
It is self-hosted and mirrored through the existing canonical asset sync; the
Next.js `next/font` wrapper and variable font are not used.

## WOFF2 copies

The seven `*.woff2` files beside the Barlow TTFs are lossless WOFF2 encodings of those same TTFs (every font table
kept unchanged), made by `scripts/generate-light-assets.ts` (`scripts/woff2-encode.mjs`). They carry the TTFs'
licence (SIL Open Font License 1.1, no Reserved Font Name). `fonts.css` lists them first, with the TTFs as fallback.
