# Showcase runtime

Desktop and Quest share the validated timeline and replay archive. Desktop also captures completed matches, renders their original arena/pieces, and spectates the gameplay engine. See [the match replay contract](../../docs/PLAY_REPLAYS.md) for platform adaptation and explicit Legacy eligibility.
Import `ShowcaseSession` inside the adapter's lazy Showcase entry point. Its
`chess.js` dependency must remain outside the main menu boot chunk. This viewer
does not import the protected game, apply house consequences or use game saves.

`generate()` runs seeded, legal computer self-play. Browser generation, archive
validation and replay construction run in owned module Workers; no large
synchronous browser fallback is permitted. Pure Node tests use the same jobs
with event-loop yields. Exhibitions cap at 96 half-moves. The default
1.2 seconds per move targets at most 115.2 seconds at normal speed; stalled
render frames deliberately delay playback instead of skipping moves.
The policy is a bounded tactical heuristic, not a competitive chess engine.
Generation prepares a paused record; the visible adapter explicitly starts it.

`snapshot` and `subscribe()` expose immutable records and complete board frames.
`load()` and `import()` return operation promises, exposing an `opening` phase.
`cancelOpening()` cancels only the pending record operation. Worker results are
refrozen after structured clone before publication.
`update(seconds)` advances playback; `seek`, `step`, `setSpeed` and `setArena`
are independent of rendering. Piece identities survive castling, en passant and
promotion. A seek pauses playback. `setSuspended(true)` pauses and cancels work
while preserving the record and position. Unsuspending never resumes by itself.
Call `dispose()` only when the owning viewer is permanently released.

Computed results come from the final board. A move-limit exhibition has result
`*`. Imported nonterminal PGN results are separate `declaredResult` claims;
terminal contradictions are rejected. PGN imports use strict legal main-line SAN
parsing and canonical export. Variations are not played. Portable JSON format
`crownfall-showcase-replay`, version 1, stores one compact PGN entry; imported
frames, results and move counts are ignored and reconstructed from legal moves.

The archive key is `crownfall.showcase.replays.v1`, separate from preferences and
Legacy. At most 12 replays are stored. Failed writes retain visit-only records
with explicit failure state; failed persistent deletions retain the saved entry.
Malformed or future-version archives are preserved and never overwritten by a
save. Observed external edits require reload before writing. These guards do
not provide cross-tab transactions or cloud synchronization. Adapters own delete
confirmation and platform-specific file import/export controls.

Existing archive hydration exposes `storage: 'loading'` and `session.ready`.
`reloadArchive()` returns an operation promise. Save, delete and import cannot
write while validation is pending. Suspension/disposal terminates workers and
token guards ignore late responses; a visible import dialog should pause the
timeline rather than lifecycle-suspend its session.

Run `npm run test:showcase` from the repository root for domain and stage checks.
Browser tests and physical headset input/performance checks remain separate.
