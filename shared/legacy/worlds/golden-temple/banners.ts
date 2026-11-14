import type { WorldHeraldry } from '../dressing.js';
/**
 * House cloth on the temple grounds. See SOURCES.md for the source campus; coordinates are
 * upstream/layout.js's. The hall's two source banners and its valance become the house's,
 * in the same bays. The standards stand on the plaza and the far shore, clear of the pagoda.
 */
export const HERALDRY: WorldHeraldry = {
  hideMaterials: ['hallCloth_black', 'hallCloth_white'],
  // Source lacquer and gilt are written in GLSL, so a colour tint only dulls the hall.
  tint: null,
  clothLift: .3,
  clothEnv: .4,
  sites: [
    // Source hanging points: hall.js bays 2 and 4, over the porch stair.
    { id: 'hall-bay-2', kind: 'wall', heraldry: 'player', position: [5.55, 5.85, -13.06], facing: 180, width: 2.1, lamp: true },
    { id: 'hall-bay-4', kind: 'wall', heraldry: 'player', position: [14.45, 5.85, -13.06], facing: 180, width: 2.1, lamp: true },
    { id: 'hall-valance', kind: 'wall', heraldry: 'crown', plain: true, position: [10, 6.14, -12.98], facing: 180, width: 11, height: .62 },
    // West of the porch, between the column lines under the skirt roof.
    { id: 'hall-west-bay', kind: 'wall', heraldry: 'crown', position: [-1.14, 7.7, -13.3], facing: 180, width: 3, lamp: true },
    // Plaza and pond shore. Faces the establishing camera.
    { id: 'plaza-east', kind: 'standard', heraldry: 'player', position: [18, 0, 4], width: 2.1, pole: 8.5 },
    { id: 'plaza-west', kind: 'standard', heraldry: 'crown', position: [1, 0, -2.5], width: 2.4, pole: 9 },
    { id: 'pagoda-west', kind: 'standard', heraldry: 'player', position: [-38, 0, 6], width: 3.2, pole: 13 },
    // Either side of the south gate's inner stair, off this view until the camera turns.
    { id: 'gate-east', kind: 'standard', heraldry: 'player', position: [16, 0, 41], width: 2, pole: 7 },
    { id: 'gate-west', kind: 'standard', heraldry: 'player', position: [4, 0, 41], width: 2, pole: 7 },
    { id: 'far-shore', kind: 'standard', heraldry: 'crown', position: [-28, 0, 31], width: 3, pole: 12 },
  ],
};
