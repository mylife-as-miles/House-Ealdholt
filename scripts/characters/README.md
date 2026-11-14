# Resident character pipeline

Working placeholder (6 November 2026). Builds one Ealdholt resident from CC0 and CC BY sources
in headless Blender, exports desktop and Quest GLBs, and publishes them with provenance. The
first resident is the village smith of the proposed smithy household
(`shared/legacy/aethelgard/characters/household-casting.ts`). Role labels only; no names or canon.

## Inputs (private intake, never committed)

Copy `sources.example.json` outside the repository and point it at:

| Key | Contents | Licence |
| --- | --- | --- |
| `mpfbData` | MakeHuman data folder of mpfb2 at `6ff1eb3` (base mesh, targets, rigs, weights, region JSON) | CC0-1.0 (assets only; the GPL add-on code is not used) |
| `systemAssets` | unzipped `makehuman_system_assets_cc0.zip` | CC0-1.0 |
| `facePacks` | unzipped `faceunits01.zip` and `visemes02.zip` | CC0-1.0 |
| `style100` | 100STYLE `Neutral/Neutral_FW.bvh` and `Neutral/Neutral_ID.bvh` | CC BY 4.0 |
| `polyhaven` | output of `python3 scripts/characters/intake_polyhaven.py NEW_DIR` | CC0-1.0 |

## Build, review, publish

```sh
# PY is a Python with the bpy module (Blender 5.2 LTS) and Pillow
PY -I scripts/characters/build_resident.py --sources PRIVATE/sources.json \
   --recipe scripts/characters/recipes/village-smith.json --out NEW_BUILD_DIR
node scripts/characters/review/render-resident.mjs PLAN.json EVIDENCE_DIR   # three.js renders of the GLBs
CC_BY_LEGALCODE=PATH/cc-by-4.0-legalcode.txt python3 scripts/characters/publish_resident.py \
   --sources PRIVATE/sources.json --recipe scripts/characters/recipes/village-smith.json --build NEW_BUILD_DIR
```

Stages (each saves `work/NN-stage.blend`; `--stages a,b` resumes from the previous checkpoint):

| Stage | Module | Work |
| --- | --- | --- |
| body | `lib/body.py`, `lib/mh.py`, `lib/teeth.py` | MakeHuman macro + detail targets; 64-bone CC0 rig renamed to neutral names with face joints (`face_jaw`, `face_eye_l/r`, `face_lid_upper_l/r`, `face_lid_lower_l/r`) re-rolled to a known frame and four skirt bones; 30 ARKit + 14 viseme morphs; fitted eyes (rigid to eye joints, never-visible backs removed), authored dental arches fitted to the CC0 teeth positions (rounded crowns, scalloped gums, throat occluder, rigid per-arch morphs; a low set for LOD1/Quest), tongue, lashes (on the lids); MakeHuman's CC0 low-poly proxy fitted as the LOD1/Quest head source |
| groom | `lib/groom.py` | strand atlas drawn procedurally (root darkening per resident); scalp and beard cards bound to the head (weights and morphs follow the face) with every card corner lifted at least 0.6 mm clear of the skin; brows as two to three layers of small hair-clump cards along the growth pattern, ending at the orbital rim, coloured from the hair; paint masks for the skin bake |
| garments | `lib/garments.py`, `lib/outfits.py` | smith: original undershirt, tunic (shell draped to the torso hull, rolled cuffs, neckband), skirt tube on skirt bones, trousers, banded leg wraps, turnshoes, glove, leather apron with neck strap, belt and pouch; spinner, child and elder outfits in `outfits.py` (shells, skirt and cloak tubes, head-cloths, hood, vest); shoulder capes and shawls are generated quad grids hanging from the neck (`capelet`) with their own grid UVs (kept by the texture stage), weighted like the body at the collar and like the layer beneath lower down; outer garments (cloak, aprons, shawl) settled with Blender's cloth solver in the rest pose and kept as geometry (`garments.drape`); head-cloths stand off the skull with gathered folds and a rolled edge; covered skin deleted (under the spinner's ankle-length skirts down to the ankle, closed by leg wraps) |
| props | `lib/props.py`, `lib/props_household.py` | Poly Haven cross-pein hammer (frame from the geometry of its ends: butt at the origin, face toward -Z); original tongs, workpiece, profile-modelled anvil and stump with worn procedural materials; household kits (spindle, bellows set and coal-bed hearth, stick, knife, Poly Haven basket, buckets, spoon, bowl, stool, mallet) |
| textures | `lib/textures.py` | Cycles bakes: weathered skin in a repacked atlas (no baked AO; normal outliers on compressed faces flattened; the lid-to-brow area recoloured to the forehead's tone with its own shading kept, a lid crease, lash line and toned waterline; the brow base painted per texel from a baked position map; atlas outside the islands filled from the nearest islands), cloth atlas from recoloured fabrics with wear (overlap-free unwrap repacked after per-face fixes, smooth shading by angle before the bake), eyes/mouth atlas (widened pupils, shaded sclera, drawn teeth); four meshes, four materials; groom faces sorted from the head outward for blended drawing |
| motion | `lib/motion.py`, `lib/stage_motion.py`, `lib/motion_household.py`, `lib/locomotion.py`, `lib/idle_talk.py`, `lib/stick.py`, `lib/mechanisms.py`, `lib/transitions.py`, `lib/face_rig.py` | 100STYLE retarget (path straightened and re-aimed along its chord and the pelvis and shoulder facing, in-place, loop closed, head pitch corrected); `locomotion.py` grounds the walk: stance windows from sole heights, an authored heel-to-toe roll locked to one ground anchor per stance and carried with the root travel, pelvis drop where a leg would over-reach, swing clearance, toe-out, and synthesizes walk_start and walk_stop from the resident's own walk and idle (exact end poses, per-frame root travel); `idle_talk.py` grounds the idle on the walk's stance and builds talk on it, each with a per-resident style (`IDLE_STYLES`: sway cycles and weight-shift windows; `TALK_STYLES`: the smith's thumb at the belt and beats, the spinner's clasped hands, the child's quick offers and fidget, the elder leaning on her stick without gestures); `stage_motion.seal_locomotion_joins` eases walk_start and walk_stop into the frames they join so each join is exact and carries its velocity; original work loops by IK (the smith's impacts on frames, the hammer face on the strike point; the bellows lever on its pivot; the spindle pinch on the shaft; the carving blade on the spoon); `stick.py` plants the elder's stick (the mesh's own grip-to-tip length) 19 cm outside the left ankle and 24 cm ahead of the right heel as that heel strikes, sets it down vertically and lifts it straight up before the shaft can reach the cloak's front edge (measured from the cloak), puts the tip's rim on the ground and solves the grip; `mechanisms.py` keys the bellows (lever, chain, top board, pleats) and the spindle's spin as props-file clips named like the body clip, with the spinner's yarn as its own node (`prop_spindle_yarn`, paid out by scale, turned by the smallest rotation so it never spins); `transitions.py` builds `work_enter` and `work_exit` for each resident (exact at both joins; feet step between the stances; hands take each hand prop from a resting copy and put it back, with the hand prop exactly on the copy at the swap time listed in `propSwaps`); `face_rig.py` authors the LOD1/Quest heads' lid and jaw weights from their lid and lip loops, ray-tests the eyeball through the closed lids from three views and strengthens the lid weights wherever it still shows, and calibrates the closed-lid and jaw angles; body clips never key face joints; Tier A face clips use the calibration |
| lods | `lib/stage_lods.py` | LOD0 limb decimation to the triangle budget (face untouched); LOD1 and Quest: the head is the fitted CC0 proxy (authored eye, nose and mouth loops; atlas coordinates projected onto the LOD0 skin; welded to the body at a neck seam by edge splits), the body below decimated with inner layers under whole garments removed or sunk and garment boundary loops protected, eyeballs keep their iris cap, the low dental arches and throat occluder kept whole; islands rescaled (face and eyes denser) and repacked, LOD0 maps transferred by emission and normal bakes of the object's own material (no ray transfer); alpha-tested scalp and beard cards with coverage-preserving downsized strands (long ribbons halved in segments, brow and lash cards dropped) |
| export | `lib/stage_export.py`, `lib/glb_prune.py`, `lib/measure.py` | GLBs (named clips, LINEAR transform tracks), then pruned: rest-constant channels removed (rotations compared normalised), keys that interpolation reproduces within 0.03 degrees / 0.1 mm dropped, face channels only in face clips; props baked into one atlas material per platform (`-props.glb` 1k, `-props-quest.glb` 512 px, big models halved), static workplace props merged into one mesh (`workplace_static`), mechanisms kept as nodes with their clips, `aside` props (the elder's resting stick) at the props root and girdle rests under hips sockets; per-level, per-clip animated envelopes for the actor owner (`lib/envelopes.py`: every body clip skinned at every frame from Blender's own pose evaluation, face-morph vertices padded by their 16 largest deltas, widened by half the largest per-frame travel); measurements |

## Conventions

* Face joints: local +X points to the character's left; +X pitch looks down / closes the upper lid /
  opens the lower lid / opens the jaw; +Z yaws the eyes toward the character's right. The frames are
  identical in Blender and in the exported glTF (the export converts axes at the root joint only).
* Clips start at t = 0 and the last key equals the first for loops. In-place locomotion reports its
  stride, speed and removed root travel in `manifest.json`. One-shot clips (walk_start, walk_stop, sit_down,
  stand_up, work_enter, work_exit) end exactly on the pose they join; play them once and hold the last frame (a looping
  three.js action sampled at exactly its duration wraps to frame 0). Clip events (`impactSeconds`, `pullSeconds`,
  `draftSeconds`, `twirlSeconds`, `strokeSeconds`) and face cues are in the manifest and in `household-art-sets.ts`;
  `strokeSeconds` marks the end of each cut (the blade rides the spoon for the 0.35 s before it).
* Work transitions: `workTransitions` in the manifest names each resident's entry and exit clips, the clip they start
  from (`idle`, or `sit` for the elder) and the prop swaps (`seconds`, `node`, `to`: `hand` or `rest`, plus nodes that
  travel `with` it); `restingProps` lists each hand prop's resting copy and the bone it rides (none: the resident root
  frame, like the workplace; `hips`: a girdle socket that moves with her). Hide one and show the other at the listed
  time; the workplace stays where it was placed.
* Mechanism clips live in the props files under the body clip's name (`propClips`): play them on the attached props
  at the body clip's time. `scripts/characters/review/render-resident.mjs` does this for the evidence.
* Props GLBs (`-props.glb` desktop, `-props-quest.glb` Quest; same node names, one atlas material each):
  `socket_hand_r`/`socket_hand_l` (per prop for the household kits) children carry hand-joint-local grips
  (attach the child to the joint and keep its local transform); `workplace` holds the merged static workplace
  (`workplace_static`) and any mechanism nodes in the resident's root frame for the work pose.
* The review harness draws residents on a neutral studio backdrop or in daylight over a plain untextured
  ground plane; it draws no stand-in terrain, village or scene geometry (environment work is paused).
* Layer check: `PY -I scripts/characters/review/penetration_check.py BUILD_DIR --out BUILD_DIR/penetration.json` samples
  every body clip on LOD0 and counts skin and outward-facing garment vertices that come out through the garment
  covering them in the rest pose (every pose bone reset first), and those nearer than the 3 mm margin. Hand pairs
  (gloves, mitts, skin weighted to the hands) are listed under `handClips`; each worst frame records `restCentre`,
  where on the resting figure it happens. A count is a departure from the rest-pose layering, not always a visible
  fault. The same pass tests each hand against the posed outer garments (`posedHands`: a hand with at least three
  vertices on each side of the cloth crosses it) and the elder's held stick, sampled every centimetre along the shaft,
  against every garment (`heldStick`: fails when more than 5 cm of shaft is inside cloth in any sampled frame).
  `publish_resident.py` copies the through counts, the posed-hand counts and the held-stick result into the manifest
  when the file exists.
* LOD hair: cards are thinned whole (`cardFraction`), long ribbons lose every other segment (`ribbonPasses`), and the
  strand atlas is downsized keeping its alpha-test coverage (`hairAlphaCutoff`); `hairCoverageBoost`,
  `hairToneFlatten` and `hairVertexColour` tune a level whose few cards read as straw or a patchwork.
* Evidence (renders, sequences, metrics) stays outside the repository. Software-rendered captures are
  not headset or performance evidence.

## Crowd level (population residents)

Working placeholder (7 November 2026). The 96 crowd residents of `shared/legacy/aethelgard/characters/village-population.ts`
are built by a separate, much cheaper path at one crowd level (EALDHOLT_POPULATION_ART.md section 4: about 3,500
triangles, one material over one 512 atlas, the 64-joint rig, no morphs, no clips). The four smithy residents keep the
household pipeline above.

```sh
# recipes: one JSON per crowd resident, generated from the population data (deterministic)
main-game-vr/node_modules/.bin/tsx scripts/characters/crowd_recipes.ts RECIPE_DIR
# residents (about 8 s each, single process; --only id,id for a subset) and the seven shared prop kits
PY -I scripts/characters/crowd_build.py --sources PRIVATE/sources.json --recipes RECIPE_DIR --out BUILD_DIR [--only ...]
PY -I scripts/characters/crowd_build.py --sources PRIVATE/sources.json --recipes RECIPE_DIR --out BUILD_DIR --props
# publish into crowd-v1/ (gated; merges manifest.json and provenance.json, keeps the motion builder's entries)
python3 scripts/characters/crowd_publish.py --sources PRIVATE/sources.json --recipes RECIPE_DIR --build BUILD_DIR [--only ...] [--props]
# the population art registry (generated data behind shared/legacy/aethelgard/characters/village-population-art.ts)
main-game-vr/node_modules/.bin/tsx scripts/characters/population_art_registry.ts [--check]
node scripts/sync-legacy-environment-assets.mjs     # the git-ignored Quest mirror, before npm run check:sync
main-game-vr/node_modules/.bin/tsx --test scripts/characters/crowd-assets.test.ts shared/legacy/aethelgard/characters/village-population-art.test.ts
# review renders of many residents with their library clips and kit props (evidence outside the repository)
main-game-vr/node_modules/.bin/tsx scripts/characters/review/population-evidence-plan.ts CHARACTERS_DIR PLAN.json [--set overview,lineups,closeups,quest,walks,poses,strips]
node scripts/characters/review/render-population.mjs PLAN.json EVIDENCE_DIR
```

All 96 crowd residents are built and published (population generator, 7 November; figures in
`EALDHOLT_POPULATION_ART.md` section 13). Changes made while reviewing the full population: shoe soles laid on the ground
(`crowd_lod.ground_soles`; they rested 0.6 to 9.7 mm above it); no hair mass or braid under coifs, hoods, head-cloths and
veils (they came through as blotches and stripes), and a hood built with any cape when the headwear is a hood; hoods keep
their own 380-triangle share (`lod.hoodTriangles`); the kettle-helmet brim at the brow with the dome below it cut away
(it crossed the eyes); a narrower loose-hair sheet; flour, stain and soot marks fine, soft-edged and kept to the working
zone (flour on the front only), never on headwear (`textures._mark` gained optional `soft` and `front` keys whose
defaults keep the household output); darker mail (`mail` slot); calmer cloak and long-mantle flare; shawls pointed at the
back with longer open front ends, the elder women's in the accent dye; aprons weighted from the gown beneath
(`crowd_outfits._rebind_to_layers`; the gown and apron showed through each other when stooping); a deterministic
per-resident cut (hem, ease, sleeves, flare); and
`crowd_lod.remove_hidden_layers` also removes the front and sides of the hose under short skirts (10 cm kept above the
hem), the tunic under capes (sleeves kept), the gambeson under mail and the mail under the surcoat, which came through
in the stooping and reaching loops.

Art fixer round (8 November): every kit of five or more residents has three to five **cut variants**
(`crowd_outfits.CUTS`, ids in `POPULATION_OUTFIT_KITS[].cuts`; a long-sleeved under-tunic for sleeveless jerkins and jacks,
a sleeveless overgown with its own shorter skirt, a kilted front hem over the shift, a long bib apron, a hip-length
cloak, per-resident cloak length); **headwear shapes and tones** (`POPULATION_HEADWEAR_SHAPES`, `POPULATION_HEADWEAR_TONES`;
knotted tails, lappets, rolled band, chin tie, liripipe, rolled brim, peaked cap, nape tails, veil over the crown, wide
or narrow hat; linen in four tones or the accent dye, felt caps in the main or secondary dye, slot `headwear` coloured
from the recipe); short hair with 1 to 3 cm of volume and a fringe (flat under caps and helmets); garment and headwear
decimation that keeps every boundary loop (`crowd_lod.decimate_protected`: hems, cuffs, necklines, rims); headwear shells
cleaned of non-manifold faces and shards (`clean_shell`, `drop_shards`) and the build gate `headwearCovers`
(`crowd_lod.headwear_gate`: at least 95 percent of the scalp covered from above and four isometric directions under full
covers, no shard islands, no stray faces); the gown under an apron, the tunic under a jerkin or overgown and the mail
under a cape removed with a margin only at the cover's side edges; the shirt kept only at the cuffs; garments pushed
outside the skin after decimation; flour and stone dust as a soft gradient (`textures._mark` shape `gradient`) and leather
and hessian tiled larger at flatter contrast. Prop kits gained per-hand parts, contract-frame tools, four workplaces,
six trade goods and three carry goods (`lib/crowd_props.py`); `review/silhouette_overlap.py` measures the silhouette
clone risk and `crowd_publish.py --silhouettes OUT.json` gates on it.

| Module | Work |
| --- | --- |
| `lib/crowd_skeleton.py` | Six archetype reference skeletons (mirror of `POPULATION_ARCHETYPE_SPECS`; the build refuses a recipe whose reference differs), uniform scale fit about the ground point, `build_reference(src, archetype)` for the clip libraries |
| `lib/crowd_body.py` | Resident shaped with its macro and head-region targets, scaled by 1/s onto the archetype skeleton (body joints identical across the archetype), face joints from its own head, low-poly CC0 eyes, mouth marks |
| `lib/crowd_outfits.py` | The 24 outfit kits as layer recipes on the household garment primitives (shells, skirt tubes weighted to thighs and shins, capelet capes, shawls, mantles, cloaks and hooded capes, aprons, belts, wraps, mail, surcoat); bands painted, not modelled; inner layers culled to what can show; covered skin deleted (torso, upper arms and clothed legs always; elsewhere by rays with a margin at the covering piece's edge) |
| `lib/crowd_hair.py` | 13 hair styles as offset scalp shells with volume and noise (ponytail, braid, twin braids, bun and a back sheet as generated parts), full beards as shells (short beards, moustaches and stubble are painted), 11 headwear shapes; hair under headwear deleted |
| `lib/crowd_lod.py` | Eye sockets removed and the mouth bag split into a dark cavity (the lid and lip loops stay boundary loops for `face_rig.py`); skin decimated with the face protected until the head has at least 900 triangles; garments and hair share the rest by surface area; layers restacked and hidden faces removed after decimation |
| `lib/crowd_textures.py` | One 512 atlas: skin from the CC0 MakeHuman texture (family-mix and tone tint, painted brows, lash line, lips, beard shadow and beards, wind-burn, age spots, freckles, flour, stained hands, scar), garments from the Poly Haven fabrics recoloured to the natural-dye palette with wear, hair streaks, metal, straw; smart-projected `AtlasUV` with the face at four times the texel density, Cycles diffuse-colour bake, gutters filled from the nearest islands |
| `lib/crowd_export.py` | One skinned mesh, one double-sided material, WebP atlas, no clips or morphs; resident manifest with `placementScale`, joint residual, face calibration, measured budgets and gates |
| `lib/crowd_props.py` | 81 props in seven kit GLBs (one 512 atlas each: grain swatches plus the Poly Haven bucket, bowl, stool, hammer and wicker albedos), part nodes `prop_<id>_<part>` for two-handed props; frames in the module docstring (workplace props: the resident stands on their +Y side) |

Pairing at runtime: `template = { scene: residentGltf.scene, animations: clipLibraryGltf.animations }` with
`placement.scale = placementScale` (the clip libraries are the motion builder's `crowd-clips-<archetype>-v1.glb`).

After `crowd_publish.py` (which now runs it, and the character tests) or after `publish_clip_libraries.py`, run
`main-game-vr/node_modules/.bin/tsx scripts/characters/crowd_motion_publish.ts` (motion and runtime fixer, 8 November):
it writes into every published resident JSON the population's motion (role-loop variants included), the prop
presentation the crowd adapters attach (`shared/.../crowd-presentation.ts`: grips per clip, workplace props and goods,
the stool under seated clips, worn props at rest) and per-clip envelopes gated against the skinned mesh sampled at
60 frames a second (`envelopeGate`; the adapters pass them as trusted to an owner with patch 8). `--check` reports a
stale JSON without writing. About 3.5 s a resident, 6 minutes for 96. Clip libraries: `build_clip_library.py --clips
CLIPS.json` for each archetype (`{archetype: clip ids}` from the population's clip libraries), then
`publish_clip_libraries.py`; role loops in `lib/motion_roles.py` (variants, grips and props), base clips and the crowd
toe clearance in `lib/motion_library.py`, grips to kit nodes in `lib/motion_library_manifest.py` (`KIT_ALIGN`).
Disk: a resident build directory without `--keep-blend` is about 0.7 MB (GLB, atlas PNG, two JSON files).
