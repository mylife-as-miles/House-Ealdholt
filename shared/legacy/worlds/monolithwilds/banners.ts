import type { WorldHeraldry } from '../dressing.js';
/**
 * The establishing camera hovers 237 m over the south-western hills, so the near ridge is
 * 800 m away and the monuments 1-3 km: everything here is monumental, as the monuments are.
 * Standards line the ridge either side of the Stair and the Observatory, not over them.
 * Heights are this world's heightAt() at each foot (src/core/terrain-height.js).
 */
export const HERALDRY: WorldHeraldry = {
  reliefScale: 2.2,
  clothLift: .22,
  // Marble and dressed stone on the monuments take the finish; rock and terrain keep their colour.
  tint: { amount: .2, exclude: /^(?!.*(marble|stone|sandstone)).*$/i },
  sites: [
    { id: 'ridge-west', kind: 'standard', heraldry: 'player', position: [-840, 98.1, 610], width: 36, pole: 110 },
    { id: 'ridge-stair', kind: 'standard', heraldry: 'crown', position: [-760, 85.3, 690], width: 32, pole: 100 },
    { id: 'ridge-lake', kind: 'standard', heraldry: 'player', position: [-600, 106.3, 800], width: 34, pole: 105 },
    { id: 'ridge-east', kind: 'standard', heraldry: 'crown', position: [-300, 104.7, 900], width: 36, pole: 110 },
    { id: 'ridge-far-east', kind: 'standard', heraldry: 'player', position: [-180, 94, 1000], width: 34, pole: 105 },
    // By the Wardens, the Cloister cliff and the Descending Temple's mesa, for their landmark views.
    { id: 'wardens', kind: 'standard', heraldry: 'player', position: [-250, 14.6, -720], width: 50, pole: 150, relief: 1 },
    { id: 'cloister', kind: 'standard', heraldry: 'crown', position: [-1180, 86, -1200], width: 50, pole: 150, relief: 1 },
    { id: 'descending-temple', kind: 'standard', heraldry: 'player', position: [-560, 89.1, 1420], width: 24, pole: 70 },
    // Behind the Observatory's dome from this view, in its flooded precinct; the cloth flies clear above it.
    { id: 'observatory', kind: 'standard', heraldry: 'crown', position: [455, -5, 80], width: 80, pole: 245, relief: 1 },
  ],
};
