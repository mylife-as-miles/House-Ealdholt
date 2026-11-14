# Pawn combat authoring

The two clips-only libraries extend Crownfall's existing Ivory and Obsidian Pawn
rigs. They do not contain replacement meshes, textures or demonstration scenes.
Sixteen clips per faction provide three attacks, three defenses, three staggers,
three deaths, two ready poses and two recoveries. Other classes keep their
existing animations until separately authored and verified.

`build_combat_library.py` uses Blender 4.3.2 and the exact original named joint
frames. It samples the existing idle/death source, authors distinct skeletal
motion, constrains the real prop sockets at contact, and exports each clip.
Blender Action pose markers become GLB animation extras. Those extras feed the
same runtime event API as the JSON sidecar exporter from PR #3. Foot lift/plant
events follow the baked foot trajectories, rather than guessed attack fractions.

## Rebuild

Install the existing app dependencies first. Keep the source cache and Blender
scratch outside Git. Example paths below are local private workspace paths.

```sh
node scripts/chess/fetch_combat_sources.mjs --cache /workspace/private-assets/pawn-sources
blender --background --factory-startup --python-exit-code 1 --python scripts/chess/build_combat_library.py -- --sources /workspace/private-assets/pawn-sources/manifest.json --sockets web/src/assets/chess/combat-v1/prop-sockets.json --output web/src/assets/chess/combat-v1 --scratch /workspace/private-assets/pawn-authoring --classes wp,bp
node main-game-vr/node_modules/tsx/dist/cli.mjs scripts/chess/verify_pawn_contacts.mts --sources /workspace/private-assets/pawn-sources/manifest.json --report /workspace/private-assets/pawn-contacts.json
```

The fetcher verifies every original source's length and SHA-256 against committed
manifests. The bake checks those hashes and socket/rig identity before working.
Outputs record the generator hash, source URLs/hashes, socket-input hash and each
clip's actual event frames. Rebuild both factions whenever the generator changes.
Binary-identical Blender output across different versions is not guaranteed.

The committed `prop-sockets.json` pins measurements from the real polearm and
shield geometry, the original idle torso and the independently authored
`defend.block` guard pose. If props, their attachments or that defense change,
regenerate it with the checker's `--export-sockets <path> --calibrate-defenses`
options, then rebake and remeasure both factions. Without `--calibrate-defenses`,
the checker can bootstrap a nominal idle-only target before any clips exist.

The `.blend` scratch files contain the authored Action markers. To export a
sidecar from an existing Action, use `scripts/export-blender-animation-events.py`
with its exact Action name. List that sidecar in `PieceAnimationSet.events` only
after exporting it. Missing/invalid optional sidecars retain legacy playback.

### Korvenia's and Kwind-09's Pawns (`ep`, `kp`)

**Since 10 November 2026, all four Pawns bake from `prop-sockets-kingdoms.json`.**
- Solforiz's Pawn was regenerated, so `bp` and its opponent `wp` were refitted to each other.
- `prop-sockets.json` keeps the original wp/bp measurements; nothing bakes from it now (`combat-v2` moved to `prop-sockets-kingdoms.json` when it was rebuilt for the four kingdoms).
- Export, bake and measure with `--classes wp,bp,ep,kp`.
- `bp`'s sources are now `main game/public/models/solforiz/p-{rigged,idle,attack,death}.glb`, and `ep`'s are
  `main game/public/models/korvenia/p-{rigged,idle,thrust,death}.glb`.
- `fetch_combat_sources.mjs` still restores only the Aethelgard Pawn's Rork sources.

The same unchanged generator bakes these from each army's own Pawn rig:
- Korvenia's sources are the four files named in `combat-v1/ep.json` `sources` (rigged, combat stance, thrust slash,
  knock down);
- Kwind-09's are `main game/public/models/kwind09/p-{rigged,idle,attack,death}.glb`.

`fetch_combat_sources.mjs` knows only `wp`/`bp`, so list these rows in your private manifest by hand (class, role, url,
sha256, bytes, path), with the hashes from the sidecars. Neither Pawn carries a shield. The checker gives each a
`forearm_guard` socket on the left hand, about 11.5% of the body height in front of the fist, and measures them against
the Aethelgard Pawn:

```sh
node main-game-vr/node_modules/tsx/dist/cli.mjs scripts/chess/verify_pawn_contacts.mts --sources <manifest> --export-sockets web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json --calibrate-defenses --classes ep,kp
blender --background --factory-startup --python-exit-code 1 --python scripts/chess/blender5_action_shim.py -- scripts/chess/build_combat_library.py --sources <manifest> --sockets web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json --output web/src/assets/chess/combat-v1 --scratch <scratch> --classes ep,kp
node main-game-vr/node_modules/tsx/dist/cli.mjs scripts/chess/verify_pawn_contacts.mts --sources <manifest> --report <report> --classes ep,kp
```

Export the sockets, bake, then export again: the second export should change nothing. If it does, bake once more.

Blender 5 removed `Action.fcurves`, and the v1 generator reads it. `blender5_action_shim.py` restores a read-only view of
it and runs the generator file unchanged, so `generatorSha256` still matches. Blender 4.x needs no shim. A rig the
library pins (`SOURCE_RIGS`) that changes, as Korvenia's will when its new figures land, needs this rebake.

## Library v2: retargeted CC0 animations

`combat-v2/` sits beside `combat-v1/` and is what Pawn duels are played on, for all four kingdoms. Its motion comes
from CC0 packs instead of authored keyframes; see `docs/play/COMBAT_LIBRARY_V2.md` for the
clip list, the beat table, the retarget method and the limits.

```sh
node scripts/chess/fetch_combat_sources.mjs --cache /workspace/private-assets/pawn-sources
node scripts/chess/fetch_combat_animation_sources.mjs --cache /workspace/private-assets/cc0-animations
blender --background --factory-startup --python-exit-code 1 --python scripts/chess/build_combat_library_v2.py -- --sources <manifest> --animations /workspace/private-assets/cc0-animations --sockets web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json --output web/src/assets/chess/combat-v2 --scratch /workspace/private-assets/combat-v2-bake --classes wp,bp,ep,kp
blender --background --factory-startup --python scripts/chess/render_combat_previews.py -- --sources <manifest> --library web/src/assets/chess/combat-v2 --sockets web/src/assets/chess/combat-v1/prop-sockets-kingdoms.json --output /workspace/private-assets/combat-v2-previews --classes wp,bp
npm run test:play
```

`<manifest>` is the same private source manifest as v1's: `fetch_combat_sources.mjs` writes the `wp` rows, and the
`bp`, `ep` and `kp` rows (class, role, url, sha256, bytes, path) point at `main game/public/models/{solforiz,korvenia,kwind09}`
with the hashes from `combat-v1/{bp,ep,kp}.json` `sources`. All four rigs bake from `prop-sockets-kingdoms.json`, like
v1. A regenerated Pawn rig needs its v1 rebake first (sockets), then this one. `PROPS` in `combat_retarget.py` mirrors
each Pawn's props in `weapons.ts`; the preview renderer draws stand-in spear and shield only, so it suits `wp,bp`.

Both Python scripts also run without a Blender binary, as `python script.py -- ...` in an
environment with the `bpy` module (the v2 library was baked with bpy 5.2.3 LTS).

- `fetch_combat_animation_sources.mjs` restores the three packs from itch.io (free, no
  account) and refuses anything whose SHA-256 differs from `combat-v2/provenance.json`.
- `build_combat_library_v2.py` imports `build_combat_library.py` for the scene, GLB merge and
  marker export, so keep both; `combat_retarget.py` is the bpy-free numeric core. The
  sidecars' `generatorSha256` covers all three files: rebake all four rigs after changing any.
- `render_combat_previews.py` needs Cycles on CPU only (no display, no GPU).

The CC0 packs are public domain; the retargeted channels in `combat-v2/` carry no third-party
restriction. The Pawn rigs they are bound to stay under the project's existing asset rights.

## Provenance and rights

The original source URLs and SHA-256 hashes are in `web/src/assets/chess/combat-v1/{wp,bp}.json`.
The source characters and original animation channels remain subject to the
project's existing asset rights; these derivatives do not grant a new CC0 or
third-party redistribution licence. No reference repository's characters or
copyrighted demonstration assets are included.

PR #3 (`eec3d7d7405a5fca99914351ab82dd84b731a428`) supplied the
`animationContacts.ts` contract, marker sidecar exporter and rig-alias/hierarchy
checks. Integration adapts them to one analytic solver and the new embedded
events. The initial Pawn work did not merge that PR's unrelated audio branch. The later
kingdom integration at `45eaee5` now preserves the kingdom branch's audio mix;
no second IK or audio system is added and no release is published here.

## Verification scope

Unit checks bind all clips to the original joint hierarchy and verify markers,
finite channels, unchanged limb translations/scales, different attack/fall
poses, replay tokens and IK restoration. The headless prop check loads the
original skinned figures and actual equipped weapons (textures are omitted in
memory only), and measures contact residuals in **board-world units**.
These checks do not establish visual quality or performance in the Play arena.
Physical Quest validation and class-by-class contact authoring remain separate.
