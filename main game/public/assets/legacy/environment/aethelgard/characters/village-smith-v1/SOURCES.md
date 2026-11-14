# Village smith resident (working placeholder)

First resident of the proposed smithy household (role label only; no name, history or private canon). Built by
`scripts/characters/build_resident.py` from the recipe `scripts/characters/recipes/village-smith.json`;
published by `scripts/characters/publish_resident.py`. Nothing here is integrated into the village yet;
see docs/legacy/claude-integration/characters/ and shared/legacy/aethelgard/characters/household-art-sets.ts.

## Levels (measured from the exported files)

| Level | File | Triangles | Materials | Joints | Morph targets | Max map | Decoded maps (RGBA8 + mips, estimate) | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| desktop-lod0 | village-smith-desktop-lod0.glb | 24,889 | 4 | 64 | 44 | 2048 | 67.0 MiB | 4.87 MiB |
| desktop-lod1 | village-smith-desktop-lod1.glb | 7,655 | 1 | 64 | 44 | 1024 | 7.0 MiB | 1.17 MiB |
| props | village-smith-props.glb | 5,556 | 1 | 0 | 0 | 1024 | 7.3 MiB | 0.25 MiB |
| props-quest | village-smith-props-quest.glb | 3,432 | 1 | 0 | 0 | 512 | 1.8 MiB | 0.15 MiB |
| quest | village-smith-quest.glb | 5,815 | 1 | 64 | 44 | 1024 | 7.0 MiB | 1.01 MiB |

## Sources and licences

* **MakeHuman** base mesh, shape targets, 64-bone rig and weights, region data
  (mpfb2 data at commit 6ff1eb358f6c1959ced77e79e6dd2406d9a71f49): CC0-1.0, MakeHuman team. MPFB2 program code
  (GPL-3.0) was not executed or redistributed. Legal code: CC0-1.0.txt.
* **makehuman_system_assets** (skin diffuse, high-poly eyes, teeth, tongue, eyelashes):
  CC0-1.0, makehuman_system; pack sha256 b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107.
* **faceunits01** (30 of 52 ARKit-style targets) and **visemes02** (14 visemes): CC0-1.0, Mika Suominen.
* **Poly Haven** (CC0-1.0, https://polyhaven.com/license): brown_leather: Rob Tuytel; caban: Rico Cilliers, colormass; cross_pein_hammer: Tics; fabric_leather_02: Rob Tuytel; poly_wool_herringbone: Rico Cilliers, colormass; rough_linen: Rico Cilliers, colormass.
  Powered by Poly Haven. The hammer is used as modelled; fabrics are recoloured and baked.
* **100STYLE** (idle, walk; files Neutral/Neutral_FW.bvh, Neutral/Neutral_ID.bvh): 100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, doi:10.1145/3522618. Retargeted, trimmed, straightened, loop-closed and foot-locked. Licence: CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/); the legal code is in CC-BY-4.0.txt.
* **Original Crownfall work**: garments, hair/beard/brow cards and strand atlas, weathering and procedural materials, tongs, anvil, stump, workpiece, the hammering loop, talk and face clips.

## Where each clip comes from

* `idle`: 100STYLE capture (CC BY 4.0), retargeted; feet grounded on the walk's stance, sway and weight shift added by Crownfall.
* `walk`: 100STYLE capture (CC BY 4.0), retargeted, straightened, re-aimed, loop-closed and foot-locked by Crownfall.
* `walk_start`: Crownfall-built from this resident's 100STYLE-derived idle and walk (CC BY 4.0 attribution applies).
* `walk_stop`: Crownfall-built from this resident's 100STYLE-derived walk and idle (CC BY 4.0 attribution applies).
* `work_hammer`: original Crownfall keyframes and IK; the standing or seated base pose starts from this resident's 100STYLE-derived idle.
* `work_enter`: original Crownfall keyframes and IK (round 2) from this resident's 100STYLE-derived idle (or the seated rest) into the work loop.
* `work_exit`: original Crownfall keyframes and IK (round 2) from the work loop back to this resident's 100STYLE-derived idle (or the seated rest).
* `talk`: Crownfall-built from this resident's 100STYLE-derived idle with original head and open-hand gestures (CC BY 4.0 attribution applies).
* `face_blink`: original Crownfall face clips (face joints only).
* `face_gaze`: original Crownfall face clips (face joints only).
* `face_jaw`: original Crownfall face clips (face joints only).

Exact source files, SHA-256 hashes, frame ranges and modifications: provenance.json. Measured
budgets, clips (durations, stride, root travel, contacts), the face-joint convention and prop
sockets: manifest.json. Download date for every source: 2026-11-06. Software-rendered review
captures are not headset or performance evidence.
