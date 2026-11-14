/** Miles's 9 November expansion: added scenery surrounds the authored village.
 * Counts address deterministic placements, never simultaneous full-detail draws.
 * Source actors, water geography, collision and resident state stay independent. */
export const EALDHOLT_REGIONAL_WORLD = Object.freeze({
  version: 'ealdholt-solstice-woodland-v7-root-contact',
  villageEdge: Object.freeze({minimumSetback: 3, woodlandDepth: 100}),
  additionalTrees: 56287,
  additionalShrubs: 8192,
  additionalGroundcover: 8192,
  additionalRocks: 4096,
  tileMetres: 128,
  maximumTreesPerCell: 768,
  maximumResidentDetailCells: Object.freeze({desktop: 12, native: 3}),
  forestExtent: Object.freeze({east: 4200, north: 2600, south: 1800}),
  landmarks: Object.freeze({
    westernFort: Object.freeze({id: 'western-coast-fort', minimumVillageDistance: 650, footprintRadius: 140}),
    templeRuins: Object.freeze({id: 'distant-temple-ruins', minimumVillageDistance: 1600, footprintRadius: 55}),
  }),
});
