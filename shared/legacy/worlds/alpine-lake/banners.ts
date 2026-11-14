import type { WorldHeraldry } from '../dressing.js';
/**
 * Crownfall's own valley has no source hanging points, so the house's standards line both
 * shores toward the far falls, on the meadow behind the shore boulders. Ground heights
 * come from this world's height(); see build.js.
 */
export const HERALDRY: WorldHeraldry = {
  // Seen as a miniature on Quest, 46 m of cloth is 4 cm.
  reliefScale: 2.4,
  clothLift: .12,
  // Only the shore granite takes the finish; the valley's rock, snow and forest keep their colour.
  tint: { amount: .22, exclude: /^(?!.*granite).*$/ },
  sites: [
    // West shore, near to far.
    { id: 'west-near', kind: 'standard', heraldry: 'player', position: [-128, 6.6, 150], width: 9, pole: 22 },
    { id: 'west-hut', kind: 'standard', heraldry: 'crown', position: [-142, 9.4, 40], width: 10, pole: 26 },
    { id: 'west-far', kind: 'standard', heraldry: 'player', position: [-106, 18, -120], width: 12, pole: 34 },
    // Either side of the lake's far end, clear of the forest's height.
    { id: 'far-west', kind: 'standard', heraldry: 'crown', position: [-60, 3.5, -640], width: 30, pole: 75, relief: 1.5 },
    { id: 'far-east', kind: 'standard', heraldry: 'player', position: [60, 3.5, -640], width: 30, pole: 75, relief: 1.5 },
    // East shore, far to near. The nearest stands clear of the lone foreground tree.
    { id: 'east-far', kind: 'standard', heraldry: 'crown', position: [110, 13.4, -60], width: 12, pole: 34 },
    { id: 'east-mid', kind: 'standard', heraldry: 'player', position: [138, 5.9, 110], width: 11, pole: 28 },
    { id: 'east-near', kind: 'standard', heraldry: 'crown', position: [90, 8, 262], width: 5, pole: 16, relief: 3.6 },
    // By the herald's hut, for its landmark view.
    { id: 'herald-hut', kind: 'standard', heraldry: 'crown', position: [-120, 8, 325], width: 5, pole: 13, relief: 3.6 },
  ],
};
