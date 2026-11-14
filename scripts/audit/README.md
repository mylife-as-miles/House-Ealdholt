# Audit scripts

Small read-only scripts behind `docs/GAME_AUDIT_FIX_PLAN.md`. Each prints what it finds and changes nothing. Run
them from the repository root. Each finding in the plan names the script that shows it, so run it before and
after a fix.

## `match/`: chess match rules (no browser)

Run with `main-game-vr/node_modules/.bin/tsx scripts/audit/match/<file>`. They load the real
`web/src/core/gameController.ts` with a stand-in Worker.

| Script | Shows | Finding |
| --- | --- | --- |
| `undo.mts` | Undo after the computer's first move leaves nobody to move; undo changes state before its checks | M-02, M-13 |
| `clock-during-animation.mts` | The clock runs during a move animation; a stalemate is scored as a timeout | M-03 |
| `disposed-and-paused.mts` | A disposed match keeps playing; resuming a paused AI battle plays a stale move | M-04, M-05 |
| `snapshot-cost.mts` | Cost of one state snapshot at 20, 60, 120 and 200 plies | M-07 |
| `search-cost.mts` | Depth and time of the Medium and Hard search; cost of move generation | M-08, M-21 |
| `replay-capture-cost.mts` | Time to build the replay at the end of a game | M-19 |

When a finding is fixed, turn its script into a unit test (see T-04) and delete the script.

## `arena/`: arena files (no browser)

Run with `node scripts/audit/arena/<file> <paths>`. The arena files live in `main game/public/gameport/` and are
not in Git.

| Script | Arguments | Shows | Finding |
| --- | --- | --- | --- |
| `glb-stats.mjs` | one `.glb` | Sizes, triangles, attributes, materials, hidden MossShell meshes | A-03, A-11, A-12, A-24 |
| `largest-meshes.mjs` | one `.glb` | Meshes by triangle count, with size and distance from the board | A-04 |
| `unused-images.mjs` | one or more `.glb` | Which embedded images reach the GPU and which never do | A-06 |
| `lightmap-sampling.mjs` | a `.glb`, its `.exr`, optional row count | Share of lit area that reads a black texel, as loaded and flipped | A-02, A-23 |
| `duplicate-bytes.mjs` | one or more `.glb` | Identical buffer views inside a file | A-13 |
| `shared-bytes.mjs` | two `.glb` | Bytes two files have in common | A-13 |

## Browser scripts

These live in `main game/scripts/` because they use its Playwright install and boot helpers. Usage is in each
file's header.

- `audit-runtime-probe.mjs`: drives the built game and records bytes, draw calls, triangles, heap, WebGL contexts
  and errors for each step.
- `audit-lightmap-ab.mjs`: screenshots Eclipse as shipped and with the light texture flipped (A-02).
