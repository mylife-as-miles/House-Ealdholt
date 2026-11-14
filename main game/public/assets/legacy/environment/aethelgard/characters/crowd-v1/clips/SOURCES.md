# Ealdholt crowd clip libraries (working placeholder)

Shared motion for the crowd residents, one clips-only GLB per body archetype, built by
`scripts/characters/build_clip_library.py` and published by `scripts/characters/publish_clip_libraries.py`. Role labels
only; nothing here is integrated yet (docs/legacy/claude-integration/characters/clip-library-README.md).

| Archetype | File | Clips | Size | Reference stature |
| --- | --- | --- | --- | --- |
| adult-male | crowd-clips-adult-male-v1.glb | 112 | 2.39 MiB | 173.5 cm |
| adult-female | crowd-clips-adult-female-v1.glb | 102 | 2.23 MiB | 159.7 cm |
| adolescent | crowd-clips-adolescent-v1.glb | 57 | 1.27 MiB | 150.7 cm |
| child | crowd-clips-child-v1.glb | 38 | 0.86 MiB | 119.5 cm |
| elder-male | crowd-clips-elder-male-v1.glb | 33 | 0.74 MiB | 168.2 cm |
| elder-female | crowd-clips-elder-female-v1.glb | 33 | 0.73 MiB | 151.6 cm |

All six: 8.22 MiB.

## Sources and licences

* **100STYLE** (CC BY 4.0): 100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, doi:10.1145/3522618. Retargeted, trimmed, straightened, blended, time-scaled, loop-closed and foot-locked. Takes used: Elated/Elated_FW.bvh, Heavyset/Heavyset_FW.bvh, LimpLeft/LimpLeft_FW.bvh, Neutral/Neutral_FR.bvh, Neutral/Neutral_FW.bvh, Neutral/Neutral_ID.bvh, Old/Old_FW.bvh, Proud/Proud_FW.bvh, Proud/Proud_ID.bvh, WalkingStickLeft/WalkingStickLeft_FW.bvh, WalkingStickLeft/WalkingStickLeft_ID.bvh. Locomotion, idles and every clip built
  from them (walk variants, run, stick and crutch walks, idles, talk, start and stop clips, carry and patrol walks over the walk)
  carry this attribution. Legal code: CC-BY-4.0.txt.
* **MakeHuman** (CC0-1.0, mpfb2 data at commit 6ff1eb358f6c1959ced77e79e6dd2406d9a71f49): base mesh, macro targets, 64-bone rig
  and weights from which each archetype's reference skeleton is built. Legal code: CC0-1.0.txt.
* **Original Crownfall work**: every role loop, enter and exit, talk and look layers, seated clips, stick and crutch solving and
  the start/stop synthesis.
* No Fab, Mixamo, MetaHuman, SMPL, CMU or unclear-terms motion. Per-file SHA-256: provenance.json; per-clip source, duration,
  loop flag, joins, root travel, props and measured quality: manifest.json. Software-rendered review captures are not headset
  or performance evidence.
