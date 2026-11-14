# Original Showcase stage

The exhibition stage is original procedural work for Crownfall. Its six chess-piece
silhouettes, board, exhibition surrounds, vertex colours, materials, dust shader and
move interpolation were authored in this repository. No ArtStation model, texture,
shader or other external art asset was downloaded or copied for this implementation.

The four arena artwork references are the user's previously supplied images, already
present at `main game/public/assets/environments/card-{new,resume,load,browse}.webp`
and mirrored by the existing asset sync. The images remain unchanged. The stage
surrounds are small original artwork-inspired displays: stone arcade, blue gateway,
timber gallery and faceted crystal spires. They are not walkable recreations of the
images. Existing repository artwork provenance and redistribution decisions continue
to apply to those source images; this implementation makes no new ownership claim.

`stage-data.ts` contains the canonical indexed geometry, colour palette, scene
composition descriptors and numeric animation state. `stage-graph.ts` connects that
state to a narrow rendering interface. `stage-reflections.ts` supplies an original 128×64 lighting map made from a
procedural sky gradient and two soft exhibition light fields; it is not an external
HDRI. The reflection texture is shared by the materials and disposed with the model.
`stage-particles.ts` supplies the same original
ambient shader to both adapters. `stage-surface.ts` supplies original fine grain,
subtle stone veins, roughness variation and a bounded analytic foot-contact
occlusion field on the receiving board material. It uses one preallocated 64-entry
uniform array; it adds no shadow card, downloaded texture or render pass. These modules import no Three implementation and do not
allocate geometry or chess engines at module evaluation.

Desktop uses its own `three` dependency. Quest uses `@iwsdk/core`. The Quest model
factory is lazy and parentless; the stage bridge owns one ECS transform entity under
the existing experience anchor. Quality changes replace only its owned child model.
The tooling-only preview manifest must never be imported by production startup.

Starting-position geometry costs, excluding native/HTML UI and the menu creature:

| Quality | Mesh draws | Maximum arena triangles | Ambient points |
| --- | ---: | ---: | ---: |
| Low | 41 | 20,812 | 0 |
| Medium | 41 | 27,724 | 28 |
| High | 41 | 34,636 | 56 |

Medium and High add one point draw when motion is enabled. Last-move highlights add
two draws; a checked king adds one. `getStats()` reports stage scope explicitly.
The coherent art pass added chamfered stone foundations, recessed wood border
panels, narrow brass inlay, and connected arena architecture. The final pass adds a quiet solid receding floor,
four bounded arena-specific architectural silhouettes, natural edge fading and
light falloff. The desktop camera fits only the primary table; decorative background
meshes are excluded from framing. Quest compresses and places this decorative group
farther behind the native left aperture, preserving the stationary table and controls.
These counts are
geometry budgets, not measured headset frame rate or comfort.

Piece IDs, positions and move metadata come from validated Showcase record frames.
The stage implements no chess rules and writes no game, campaign or Legacy state.
Adjacent related frames interpolate; seeks and unrelated imported positions snap.
Captures exit briefly, promotion changes the role geometry, and castling follows the
two stable piece IDs. Pausing freezes numeric motion. Reduced motion places pieces
immediately and hides ambient points. Quest never moves the tracked viewer.

The native stage uses a closed-form perspective fit on comfort changes. The
smallest shared aperture is design x105–825/y188–484, with 12 design pixels of
internal margin. The solver includes all four arena geometries, the native
compressed background, every-square piece/knight-arc and dust envelopes. It
chooses a uniform scale and anchor translation only; the existing .48rad tilt
and tracked viewer are preserved. Every support vertex remains at least 45 mm
behind the UI plane. A source regression projects every point independently for
54 combinations of 100/125/150% text, 1.2/1.5/1.8 m distance, seated/standing and
low/middle/high panel offsets. `getStats().placement` reports projected bounds,
edge margins and near-plane gap. Real native captures remain the final visual
acceptance; these mathematical checks do not certify a physical headset.

Quest adds one separately owned static presentation backing: a two-triangle plane
50 mm beyond the farthest fitted model point. Its original dark/teal gradient,
quiet receding floor lines and light falloff frame the same table without changing
its accepted fit. Per-eye ray/plane clipping follows the actual UI aperture, so the
coordinated transparent native border stays aligned during stereo rendering and
modest head movement. Comfort changes update the backing dimensions; the viewer
never moves. Hiding or disposing Showcase also releases this separate ECS entity,
geometry and shader. This adds one draw and two triangles on Quest only (42 mesh
draws / maximum 34,638 triangles, plus the optional ambient point draw). Native UI
border rendering is separate from these stage counts. The backing is excluded
from the model fit and does not enter the desktop or menu cold-start graph.
