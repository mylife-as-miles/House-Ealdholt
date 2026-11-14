# Crownfall main game menu

A separate React + TypeScript + Vite app for the supplied menu references, with a three-tile Home screen and four-card Play screen. Run from this folder:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. `npm run build` checks TypeScript and produces `dist/`. `npm run preview` serves that build.

The layout targets desktop and landscape phones. The creature sits behind the menu as requested. Play offers CLASSIC, LOCAL DUEL, CHAPTERS and ONLINE DUEL in the supplied artwork order. Classic and Local Duel open battlefield setup and launch playable chess after loading. Chapters opens its chapter grid; Online Duel retains its unavailable-state preview. The former demo-save creation/resume UI is removed; existing browser data is left untouched. Home, Play, Showcase and Settings form the top navigation. Showcase provides local AI exhibitions, original 3D arena stages and a device-local replay archive; menu context and selection are preserved. Arrow keys select Play cards and wrap; Home/End chooses the first/last card. Enter activates, Escape goes back, and Q/E switches sections. Settings persist on this browser. Low quality disables shader particles; ambient motion and OS reduced motion stop animation.

## Classic and Local Duel

Classic plays against the computer; Local Duel is two humans on this device. Select Setting 1 (Eclipse) or Setting 2 (Violet Night), choose a clock and, for Classic, computer strength and side, then Start. The existing Crownfall loading screen reports preparation and offers Back to setup; failures offer Retry. The clock and computer start only when the pieces and selected battlefield are ready.

Fresh clones can install the verified runtime assets from the [GitHub Release](https://github.com/mylife-as-miles/Crownfall/releases/tag/gameport-2026-11-03), from the repository root:

```sh
node scripts/install-gameport-release.mjs
```

This checks the pinned manifest and all eight file hashes before installing. `--verify-only` checks existing files. The release contains the tested exports; to refresh from the artist's working files instead:

```powershell
node scripts/sync-gameport-assets.mjs "C:\Users\MILES\Documents\Codex\2026-10-23\using-blender-through-blender-mcp-create\work\claude_environment\game-port"
```

The installer copies and verifies the eight GLB/EXR files into `public/gameport/scene-01/` and `scene-02/`. These large binaries are local and excluded from Git; rerun after the artist replaces the source files. The game supplies the pieces and procedural lava/atmosphere; the board is the arena's own baked Blender board from the look package (`look/board/board.glb`, see `docs/PLAY_LOOK_PORT.md`), with the procedural board as the fallback. Board square indexing is unchanged. Baked scenery uses the supplied lightmaps and vertex lighting without environment lighting. MossShell overlays remain hidden pending a corrected bake; zero-valued black regions remain in the supplied lightmaps. Geometry and textures still need web compression and polygon reduction before a production release.

Desktop mouse and keyboard are supported in the match: click pieces/squares, or use arrows and Enter/Space; Q/R/B/N chooses promotion. Match controls include Undo, Flip board, Resign and Rematch. This gameplay port is desktop only; Quest mode previews state that immersive chess is unavailable.

`node scripts/verify-play.mjs` runs real-asset browser checks for both settings, legal local turns and a computer response. Run with the desktop dev server available on port 5173.

## Desktop and Quest updates

This folder is the desktop/landscape adapter. Shared menu data, modal copy, typography/palette and geometry come from `../shared/menu/`. The native hands-first Quest adapter lives in `../main-game-vr/`. Build both through the repository-root `npm run build`; run `npm run check:sync` to catch stale generated UI or asset copies. Desktop settings remain mouse/keyboard/controller based; Quest uses separate hand/comfort preferences and headset-managed frame timing.

## Loading and readiness

Crownfall opens with the supplied portal environment, an original crown/orbit seal, restrained motes and the King’s Gambit wordmark. The wordmark waits for its real font before appearing, avoiding a fallback-font width jump. A small branded HTML shell covers the interval before the application JavaScript starts.

The menu mounts behind an inert loading overlay. Artwork must decode, the font group must settle, and the sorcerer must finish transfer, decoding, rig/Idle setup and its first successful rendered frame before the automatic reveal. The progress rail reports resource-preparation units; the transfer status reports actual known model bytes. Unknown-size transfers use an indeterminate rail. There is no simulated percentage or artificial minimum loading time. The 360ms exit is visual motion only; OS and in-app reduced motion make it immediate.

Asset failures show Retry/Continue controls. A failed model can retry without changing preferences or silently restarting the menu; it can also continue with the illustration. Failed artwork/fonts retry through a fresh document so their actual UI resources are retried too. Long transfers offer an optional Continue after 12 seconds; choosing it does not claim completion, and the existing model may finish in the background. Loading input cannot activate menu options; held keys/controller buttons must be released before they can activate the newly revealed menu.

`artifacts/loading/` contains actual supplied-GLB loading captures, unknown-size/recovery states and an untrimmed handoff recording. The capture streams the real file at a 1MiB boundary to make a reproducible loading state; it does not fabricate its progress. The recording discloses lower scene rendering settings for software capture. `verify-loading.mjs` separately exercises controlled lightweight GLB, texture, artwork and font fixtures. ArtStation was consulted for composition inspiration; no additional external artwork was imported.

## Home screen

Home uses one 298 × 434 tile on the left and two 298 × 215 tiles stacked on the right, with four-pixel gaps, at 1280 × 720. The full grid is 600 × 434 pixels. My Legacy is the tall tile, Chronicles is upper right, and Herald Board is lower right. The supplied king and portal images use centered cover crops; Chronicles contains the complete four-region map, retaining its context. Only the exact supplied titles appear on the tiles. There are no invented descriptions, statistics, story entries or news feeds.

My Legacy opens its own screen (see My Legacy below). Chronicles opens its archive destination; Herald Board retains its unavailable-state dialog. Home selection and the last right-hand row are remembered across navigation. Left/right moves between columns; up/down moves between the stacked tiles. Home/End selects the first/last tile. Keyboard, pointer and controller selection keep focus aligned. Settings returns to its originating screen. Back from Home returns to Play; Back from Play retains the Home confirmation.

`src/home-content.ts` configures the three content slots, image fit and supported actions. The original JPEGs are preserved byte-for-byte outside Git under `/workspace/crownfall-home-originals/`. Separate full-resolution WebP delivery copies are in `public/assets/home/`; mapping, hashes and display fits are in `artifacts/home-artwork.json`. The private Page and reference image remain unchanged and outside the repository.

## My Legacy

Home → My Legacy opens a full-stage 3D screen, not a dialog. The top navigation fades, and the sorcerer and particles pause and hide without unloading the decoded model, so the menu returns exactly as it was. The Legacy code and its renderer load lazily on first entry and then stay mounted while the menu shows, with the renderer paused and the hidden screen skipping style and layout work (`content-visibility: hidden`). Back (Escape, the configured Back key, controller B or the always-visible Return to Home control) unwinds dialog → close-up → inspection → overview → Home and restores focus to the My Legacy tile. Chess comes first: every Legacy screen also offers Play in its footer, which leaves My Legacy for the Play tab with the Classic card selected. An error boundary keeps any Legacy failure (a chunk that cannot be downloaded, or an exception while a Legacy screen renders) inside the Legacy layer: it shows "My Legacy could not open" with Retry and Return to Home, Home and Play keep working, and Retry (or coming back to My Legacy) downloads the screen again under a fresh URL, because browsers keep failed module fetches for the life of the page.

`src/legacy/environment-provider.ts` discovers the environment workflow's `src/legacy/environment/createLegacyEnvironment.ts` with a lazy `import.meta.glob` (see `docs/legacy/WORKFLOWS.md`). Without it, the gameplay stand-in in `src/legacy/standin/` renders: neutral ground, simple landmark markers and a small "Environment stand-in" caption. It is a placeholder, not the Bannerhold art. `?legacyStandIn` forces the stand-in. The screen talks to either renderer only through `src/legacy/environment-contract.ts`.

The shared Legacy domain in `../shared/legacy/` owns the rules, persistence and presentation; this app stores the save in `localStorage` (`crownfall.legacy.save`). `?legacy=fresh` starts a labelled guest session that neither reads nor writes the stored banner. `?legacyPreview=<id>` opens a development preview: fixture data, labelled on every surface and never saved; an unknown id lists the real previews. An unreadable save, or one from a newer version, opens a recovery panel and is left untouched; Raise a new banner asks for confirmation, and only the new banner's first save replaces the old record.

The founding ceremony offers four nations, a validated banner name with Suggest, arms (division, field, ordinary, charge and tinctures, or presets) with a live 2D preview while the 3D banner updates, and an optional motto. The review step states what will be saved (or that a guest banner is not saved), so Raise the banner founds directly, saves the founding and plays a short banner-raising beat. Keyboard only, controller only and mouse all complete it.

In the Bannerhold, HTML labels follow the four 3D landmarks, and a Next step strip names the next step toward a Muster match (name your Pawn at the Muster Grounds, answer the rival's challenge, then ready and awaiting the board) with a direct jump to the landmark that holds it; the same step is the primary action of the Banner Hall and the War Record, and of the Muster Grounds once a nomination stands. Hover or focus highlights a landmark; selecting it moves the camera and opens a docked inspection panel. The Banner Hall shows identity, arms, nation, rank, recognition, honours and hall development; Dissolve banner (with confirmation) waits behind a Manage banner disclosure. The Muster Grounds lead with the house's side of the formation: sixteen pieces in the colours of the houses that field them, with the player's one piece in the banner's colours; its pawn row is the file choice, and claimed files carry the holding house's mark. Member rows and the representative card show each person's origin, and Nominate stays above the fold at 1280 × 720. The War Record lists the ledger, conflicts and unresolved matters, with honest empty states. The Herald's Station holds notices with the sending house's stance beside its seal, and the formal challenge with its wager as stated terms (the shared `LEGACY_TEXT.wagerTerms`, as on Quest); accepting it before a Pawn is named says so and offers the Muster Grounds, and accepting shows "Awaiting the board", because matches are not connected to My Legacy in this build. After a result, at most two aftermath messages appear, with a note that the War Record keeps every fact.

Input: mouse hover and click, drag to orbit and wheel to zoom; the configured keyboard bindings (directions select landmarks spatially, Select, Back, First/Last, and Previous/Next tab cycle landmarks and panels); and a standard controller (left stick or D-pad, A, B, LB/RB, right stick to orbit, triggers to zoom). Focus stays visible. Saved or OS reduced motion removes camera moves and transitions. The quality preset, render scale and frame limit apply to the Legacy renderer. If frame pacing stays slow (the median interval between back-to-back rendered frames, sampled during camera moves, highlight fades and drag, wheel or stick motion, above 25 ms or one and a half periods of the frame limit, over at least 60 samples after an 8-second grace), the preset steps down once for the page and says so once; the saved setting is not changed. Pacing includes GPU-bound frames, which render-submission time alone cannot show. Panel backdrop blur is kept for the High preset only. The Gamepad API is polled only while a pad is connected. `?legacyStats` exposes `window.__legacyStats()` for measurement.

`node scripts/verify-legacy.mjs` checks these flows with Playwright (`CHROMIUM_PATH` defaults to `/opt/pw-browsers/chromium`; `CROWNFALL_LEGACY_ONLY=entry,founding,…` runs named sections). Its `boundary` section blocks the Legacy screen chunk and checks that Home and Play keep working and that Retry recovers; its `chessfirst` section records launch timings with and without a saved banner, the actions from every Legacy screen back to Play, and that the web chess app's entry imports no Legacy module (`chess-first.json`). Its opt-in `perf` section follows `docs/legacy/PERFORMANCE.md`, attributes each long task from the trace (renderer thread time, waits on the GPU process, what the GPU process was doing) and is meant for a `npm run preview` server. `node scripts/capture-legacy.mjs --out <dir>` writes screenshots (default `artifacts/legacy/latest/`). Controller checks use a mocked standard Gamepad API, not physical hardware. WebGL here is software-rendered (SwiftShader), so recorded frame times do not represent real GPUs.

## Chronicles recovery

If the 3D view cannot load, the flat painting keeps the same approved records and Back controls. A shared notice explains the failure and asks the viewer to return Home and reopen Chronicles to retry. The broader archive hall and later collections are still in progress; see [the current checkpoint](../docs/chronicles/WORK_STATUS.md).

The focused production check is `CROWNFALL_TEST_URL=http://localhost:5196 node scripts/verify-chronicles-fallback.mjs` with the built app served on that URL. It disables WebGL only in its browser session and verifies the visible notice, record content, layout and Back at 1280×720 and 844×390. Fresh results and captures are in [artifacts/chronicles/recovery-2026-10-30/](artifacts/chronicles/recovery-2026-10-30/).

## Chapters

The Chapters card opens a dedicated five-column selector matching the supplied reference: fourteen equal landscape tiles arranged 5–5–4, at x105/y112 with a 936×420px grid at 1280×720. There are no inter-tile gutters or carousel. The selected tile has an amber border/title; locked artwork is subdued, with a centered lock. The top navigation fades away, the existing scene defocuses, and Back returns to the selected Chapters card in Play.

The slots are numbered Chapter 01–14 because final campaign titles and dedicated artwork have not been supplied. Existing approved environment artwork fills the thumbnails. Slots 01/02 open honest chapter previews; 03–14 are locked preview slots. This configuration is not player progression: no campaign is launched, no chapters are unlocked, and no save records change. Locked activation only announces its unavailable state. Keyboard/controller navigation can still inspect every slot, clamps edges, and remembers the preferred fifth column across the short last row. Preview Back restores the same tile; Q/E and bumpers keep the selector in Play's navigation context.

`src/chapters-content.ts` configures the slots and spatial navigation. `artifacts/chapters/` contains actual-GLB selector screenshots at 1280×720, 1920×1080 and 844×390, selected-lock states and navigation verification. Its earlier preview images and flow recording predate the shared modal treatment; use `artifacts/modals/` for current chapter preview and dialog-flow visuals. The reference image remains outside the repository. The earlier full-menu recording in `artifacts/motion/` predates this selector and the common modal; its selector and dialog steps are historical. The Chapters recording shows selector navigation, while the latest modal recording shows current dialogs. Capture performance settings are disclosed in `captures.json`.

## Showcase and motion

Showcase has three working destinations: AI Battles spectates the same controller, search worker, pieces and baked environments as playable chess. Arenas explores the two actual match environments. Match Replays saves up to twelve completed matches, exhibitions or imported PGN/JSON records; open, playback controls, export and confirmed deletion work on this device. Completed Classic and Local Duel matches offer Watch Replay and Save Replay on results, preserving actual moves, pieces, setting, opponents, mode, result and date. See [the replay contract](../docs/PLAY_REPLAYS.md) for platform limits and Legacy completion rules. There is no online service. Back returns through the Showcase overview to its originating menu. Rules and stage code are lazy-loaded. See [shared runtime limits](../shared/showcase/README.md) and [stage provenance](../shared/showcase/STAGE.md).

Screen changes use a short fade and directional glide, with restrained card staggering. The exit view is a noninteractive DOM snapshot, keeping incoming refs and state live without duplicate React trees. Interrupted changes settle on the latest request, with no queued tour of skipped screens. The nav highlight moves between fixed tab bounds. Selection/press feedback, changing descriptions, arena-image crossfades, background defocus and native dialog enter/exit complete the motion. Both the OS reduced-motion preference and the in-app switch remove this choreography immediately. Scrollbars use recessed bronze rails and amber thumbs while retaining native scrolling.

`artifacts/showcase-functional/` contains current exhibition, arena and replay captures and browser verification at desktop and landscape sizes. `artifacts/showcase/` records the earlier preview-only implementation. `artifacts/motion/menu-transitions.webm` records the menu sequence; its renderer settings and preparation trim are disclosed in `recording.json`. Browser motion checks do not establish physical-device GPU performance. Visual review uses the user's subjective 9/10 target.

## Shared modals

The Chronicles and Herald Board destinations, mode previews, chapter previews and Return to Home use one native `MenuDialog` matching the supplied modal reference: a transparent borderless surface over the dark defocused scene, a centered compact amber heading, centered muted copy, and small outlined A Confirm / B Cancel actions. The content sits above the vertical midpoint, retaining the reference’s deliberate spacing while longer disclosures wrap and landscape text stays readable. There is no separate boxed panel, eyebrow, corner close icon or repeated footer.

Confirm acknowledges informational previews; Return to Home confirms navigation to Home. Cancel, Escape, the configured Back binding and controller B dismiss without changing the destination. Focus remains trapped in the dialog and returns to the selected originating card. Left/right, custom bindings and controller navigation reach the actions; Q/E and bumpers cannot switch the menu behind an open dialog. Held Select/Back keys and held A/B buttons cannot accidentally repeat confirmations. The animated creature remains mounted behind the blur. Dialog fades honor both saved and OS reduced motion.

The screenshot supplies the common visual treatment; existing settings retain immediate local persistence rather than adding a new Apply Changes transaction. The loading/recovery screen retains its dedicated readiness flow. `artifacts/modals/` contains desktop/landscape captures, the current modal flow recording and common-dialog checks.

## Settings

Settings opens a six-tile hub: General, Controls, Input, Video, Audio and Credits. At 1280 × 720 the contiguous grid is 900 × 438 pixels, with 300 × 219 tiles. The four top navigation buttons keep 24-pixel gaps regardless of selection. Detail pages use a scrollable options list, selected amber row, a description column and a blurred scene, matching the supplied references. Back returns from a detail page to its selected category, then to the originating Home or Play screen.

General offers English (the only available translation), ambient motion and control prompts. Controls edits the actual menu keyboard bindings, checks conflicts, reserves Tab for focus, supports capture cancellation and restores defaults. Escape always works as a fallback back action. Input shows the standard controller mapping and connection status: left stick/D-pad navigation, A select, B back, LB/RB tabs, Y reset editable settings. The controller diagram describes menu actions rather than unimplemented character controls.

Video changes the actual particle density, internal scene resolution (50–100%), and scene frame limit (unlimited/30/60/120). Overall Quality applies a preset to resolution and particles; separately edited values display Custom. Fullscreen uses the browser Fullscreen API when permitted, reports refusal and follows actual fullscreen changes; screen resolution follows the browser viewport. Unavailable renderer systems are not offered as placeholder knobs. Text and card artwork stay at full CSS resolution. Changing render scale, frame limit or motion retains the decoded creature and renderer.

Audio uses the shared original procedural score and menu feedback, with independent music/effects levels and switches plus Master Volume. Test Sound plays through those actual controls, so zero volume or disabled effects stay silent. Playback reports its current browser state and any blocked-audio error; another real selection can retry. One gesture-unlocked graph is retained across menu routes, pauses on hidden pages and closes on unmount. Audio Output is read-only because the operating system chooses it. No dialogue system is advertised.

Credits describes the supplied assets, technology and included licenses. Old preferences acquire the new audio fields without losing existing controls. Changes apply immediately; saved/this-visit-only feedback reflects actual storage success, and General offers a save retry when storage fails. Reset Defaults asks for confirmation with Cancel selected, restores only the current category and leaves saved banners and unrelated settings untouched. Hiding control prompts retains the actual Back/Select/Reset buttons.

Settings verification is in `artifacts/settings/`. Run `node scripts/verify-settings.mjs` for interactions, persistence, layout and actual WebAudio signal/mute checks; `node scripts/verify-settings-failures.mjs` covers storage/fullscreen/audio recovery. `node scripts/capture-settings.mjs` captures the supplied GLB. Physical controller hardware, speakers and physical-device GPU performance are not established by browser simulation.

## Environment artwork

The four cards use the user's supplied JPEGs in attachment order. The originals were retrieved from the private ChatGPT Page through authorized file reads, materialized under `/workspace/crownfall-card-originals/`, and verified against the supplied byte counts and source SHA-256 values before conversion. Originals are preserved outside the Git checkout; only separate optimized WebP delivery copies are used by the app. The private Page and its sharing settings are unchanged.

| Card | Supplied original | Crop focus |
| --- | --- | --- |
| Classic | `288933.jpg` | Ferris wheel and luminous ruined landscape |
| Local Duel | `288939.jpg` | Blue gateway and floating architecture |
| Chapters | `288943.jpg` | Timber bridges and distant arches |
| Online Duel | `289365.jpg` | Crystal cliffs, dragons, and towers |

All four source images are 2048 × 1143. Delivery copies retain those dimensions and are stored at `public/assets/environments/card-{new,resume,load,browse}.webp`. The images are cropped by CSS to their focal points; no regenerated artwork is substituted. `artifacts/card-artwork.json` records the mapping, source/delivery checksums and focal positions. Library identifiers and the private Page references remain in the executor-local originals' provenance file rather than the public repository.

All four cards (CLASSIC / LOCAL DUEL / CHAPTERS / ONLINE DUEL) are visible together in one fixed row. Original card dimensions are restored to 197 × 298 pixels at 1280 × 720, with four-pixel gaps and an 800-pixel row. Titles and supporting text remain live HTML above the image layer. Headings use self-hosted Barlow at weight 600: about 18.67px at 1280px, 14px at 960px, with an 11px landscape floor. Selected titles share the amber border accent; inactive titles use muted gray. The typography reference was inspected from the supplied image and preserved outside Git. Cards identify intended chess modes; Chapters opens the selector below, while activation dialogs disclose that this standalone menu is not connected to gameplay or online services. Exact UI copy and typography evidence are in `artifacts/menu-copy.json` and `artifacts/card-typography.json`. The row has no carousel controls, scroll snapping, drag or wheel handlers. Keyboard and controller navigation move focus between the four cards without scrolling.

## Creature asset

The default creature is the actual user-supplied **`Crownfall_Sorcerer_Digits_v3_1(1).glb`**, delivered as `public/models/crownfall-sorcerer.glb`. Its PBR material retains the supplied aged-gold and emerald textures. The menu selects the named **Idle** clip; Attack and Threat_Cast are retained in the file but do not play in the menu. The creature renders behind the cards with warm directional lighting and a teal rim. Its final presentation is another 5% larger than the approved tilted pose (9.2% above the original size), with the same 7.45° turn toward the cards and 2.58° left lean. The whole rig, including all four arms, follows this parent transform; the bone animation is unchanged. The model-center offset keeps the crown inside the frame. A final +0.055-world-unit parent lift exposes more of the face above the cards; the existing ±0.012 idle sway adds to that anchor. Matched direction captures are in `artifacts/creature-direction/`; the size comparison is in `artifacts/creature-size/`. The final upward adjustment, sampled Idle bounds and calibration captures are in `artifacts/creature-height/`.

The supplied 19,382,272-byte file was optimized to 4,217,336 bytes using 2048px WebP textures and Draco geometry compression. All 80,910 triangles, 142 joints and three clips are preserved; no simplification or animation resampling was applied. The original upload is not overwritten. Required Draco decoders are self hosted in `public/decoders/draco/`, so this model needs no external decoder service.

`src/effects/creature-config.ts` controls the default model URL. `?model=/models/alternate.glb` previews another asset and `?model=none` previews the illustration fallback. Framing and lighting are in `src/CreatureStage.tsx`. Idle loops continuously at its authored speed (about 3.04 seconds per loop), including across Home, Play, Showcase, Settings and Chapters. Animation follows elapsed foreground time rather than the number of frames rendered, so a lower scene frame rate does not slow the rig. Switching motion preferences pauses or resumes the existing renderer without downloading or decoding the model again. Hidden tabs pause without a pose jump when resumed. Both saved Ambient Motion off and OS reduced motion are honored. `artifacts/creature-motion/` contains the current actual-GLB recording, moving-pose captures and timing/navigation verification. A temporary reference-derived illustration remains visible while the model loads, or if model loading or WebGL fails.

Fonts are self hosted Barlow under the included SIL Open Font License. The bundled Draco distribution includes its Apache license.

`src/Atmosphere.tsx` uses custom GLSL shaders for additive teal and gold particles, with CSS wisps and drifting feather SVGs. Effects clean up resources on unmount. Rive is not required for these effects.

## Browser verification

With the dev server running:

```sh
npm test
node scripts/verify-layout.mjs
node scripts/verify-home.mjs
node scripts/verify-copy.mjs
node scripts/verify-model.mjs
node scripts/verify-creature-motion.mjs
node scripts/verify-settings.mjs
node scripts/verify-loading.mjs
node scripts/verify-showcase.mjs
node scripts/verify-chapters.mjs
node scripts/verify-motion.mjs
node scripts/verify-modals.mjs
node scripts/verify-legacy.mjs
node scripts/verify-render-controls.mjs
node scripts/verify-framing.mjs
```

Tests use Playwright and `/usr/bin/chromium`; set `CHROMIUM_PATH` for another Chromium installation and `CROWNFALL_TEST_URL` for another server. Current screenshots and verification results are saved in `artifacts/`. Copy checks cover the remaining preview dialogs at desktop and landscape sizes, including the mode and chapter previews, without horizontal clipping. Settings and Showcase detail layouts are verified in their dedicated suites. The visual critic reviews actual browser screenshots; scores are subjective and distinct from automated functionality checks. The current layout is the restored four-visible-card row. Files in `artifacts/carousel/` and archived visual reviews document the superseded carousel iteration; its recording predates the final creature transform. Software WebGL verification does not establish physical-device GPU performance.

`verify-framing.mjs` requires the Vite development server (`CROWNFALL_FRAMING_URL`, default `http://localhost:5173`). It intercepts the development module only inside its Playwright session to seek exact Idle poses and project actual skinned vertices. It writes no production debug hooks. The probe checks authored Idle key times and midpoints against independent ambient sway/yaw extremes, with geometric crown/face/eye proxies and calibration images. Dense sampled bounds are supporting evidence rather than a continuous mathematical guarantee or semantic face detection.
