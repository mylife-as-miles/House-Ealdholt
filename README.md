# House Ealdholt

A standalone desktop entry for Crownfall's My Legacy village, built from the existing Ealdholt source and authored Elderbloom environment. It uses the inherited village, the 100-resident roster and saved simulation, rather than a replacement scene.

The source combines Crownfall's `codex/ealdholt-open-water-procedural-fire` at `54aa7b1dd50eb777b01caf75cbcbdd98af4e3aef` (including PR #14, `d678838bf89b8e91ccde15d031b6a27f164db739`) with later `main` work at `a8e9d8013eef0d24c7166f7a845d5cd2248d650b`. The standalone adds a production entry and source-qualified population loading. Original Crownfall source remains separate.

## Setup and run

You need Node 20.19 or later, npm, the GitHub CLI, and an account authorized to read the private `mylife-as-miles/Crownfall` repository and its Elderbloom release. Authenticate with `gh auth login` using your own account; do not put credentials in this project.

```sh
npm ci
npm --prefix 'main game' ci
mkdir -p private-assets/elderbloom
gh release download elderbloom-village-2026-11-06 --repo mylife-as-miles/Crownfall --dir private-assets/elderbloom --skip-existing
npm run assets:village:verify
npm run assets:house:install
npm run build
npm run preview
```

Open the local URL printed by Vite. The release installer verifies every downloaded file against the pinned SHA-256 manifest. The second installer obtains the exact source-qualified resident site, the original loading image and the user-supplied soundtrack from private Crownfall Git objects and verifies their hashes; it will not overwrite a mismatched existing file. No credential is embedded in the client. The build checks the model, matching pond probe and resident site and fails if they are missing or changed.

The desktop GLB is 174,285,136 bytes (about 166 MiB), SHA-256 `3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28`. The population site is SHA-256 `fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475`. The latter is retrieved from Crownfall's private asset branch; the private release itself does not contain it. The download commands require authorized access to both.

The model, baked reflection, source-derived site, village loading image and soundtrack are excluded from the public Git repository. The `dist` output **does contain** the private model, reflection, site, loading image and soundtrack and must only be shared or hosted in accordance with their licences and access terms. The Elderbloom release's `LICENSE-USE.md` states its Fab Standard License and NoAI restrictions; it is not a standalone open asset library. The user-supplied music has its own provenance and is not relicensed by the code licence.

## Existing systems and limits

The renderer uses the authored village model and existing terrain, pond, woodland and surrounding environment. My Legacy retains its views, observer controls, clock, weather, saves, households and resident simulation, plus source-bound fire response, building damage and rebuilding code. The roster and simulation represent 100 people; rendering uses a smaller, changing set of character models. Many jobs, interiors and physical interactions remain unqualified, and a simulated routine is not proof that a villager visibly performed it. The original source replay established a burn-to-rebuild sequence in a deterministic fixture; this standalone has not visually demonstrated that entire sequence. Quest hardware and physical-device performance are not verified by this desktop package.

`npm run typecheck` and `npm run test:core` run the desktop typecheck and focused population, presentation and emergency-site tests. An optional actual-source test can be run after setup:

```sh
CROWNFALL_BUILDING_EMERGENCY_SOURCE_GLB="$PWD/private-assets/elderbloom/elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb" \
CROWNFALL_BUILDING_EMERGENCY_SITE_JSON="$PWD/private-assets/elderbloom/ealdholt-population-desktop-fresh-exterior-v4-tall-commuting.json" \
node --import tsx 'main game/src/legacy/aethelgard/building-emergency-sites.test.ts'
```

## Credits

Crownfall code retains its [MIT licence](LICENSE). Third-party notices remain alongside the assets, including `main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/SOURCES.md`, its `clips/SOURCES.md`, and the regional and texture provenance files. The 100STYLE-derived motion clips are CC BY 4.0 and credit Ian Mason, Sebastian Starke and Taku Komura. MakeHuman and Poly Haven sources include CC0 material; the respective licence texts and notices are retained. Fonts retain their SIL Open Font License notices in `main game/public/fonts`.

## Verification (14 November 2026)

A clean copy of the public files, with the authenticated private assets installed locally, passed the desktop production build and `npm run test:core`. The original-source emergency test above passed all 10 tests against the pinned desktop model and site, including its source-bound long projection and checkpoint. Additional navigation, workplace, clock and reconstruction test modules passed; paired desktop/Quest fire presentation tests passed in the combined Crownfall checkout. The standalone omits the Quest runtime, so those paired Quest tests are not runnable in the desktop-only package.

A fresh headless Chromium session fetched the original model, pond probe, site, resident models and clip libraries successfully. The population reported 100 registered people in 25 households, with three character actors ready in the observed frame. Main-camera diagnostics recorded four resident draw calls, as well as authored architecture and terrain submissions. The clock advanced normally. These counts establish asset loading and render submissions; they do not establish completed work interactions, an end-to-end visible fire and rebuild, smooth animation, or physical-device performance.

For an additional local visibility check, an instrumented copy rendered the same frame at 320×180 with the population on, off and on again. One RGB pixel differed between on and off while matching between both on renders; no pixels changed between the on renders. This establishes a small population contribution in that view, not a recognizable close-up or a motion/occupation proof. The comparison ran locally; no village image was uploaded.
