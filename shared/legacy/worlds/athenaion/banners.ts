import type { WorldHeraldry } from '../dressing.js';
/**
 * The source's own banner slots (build.js `engine.slots.banner`, from vendor/acropolis and
 * vendor/aqueducts), which the adapter left empty when the owl flags came out. Each keeps its
 * slot's anchor and facing. House cloth keeps the heraldry's 1:1.5 proportion, enlarged where the
 * wall has room to read from the establishing view; national cloth keeps the slot's own long drop.
 * The two pedestals and the island standard are Crownfall's additions to this view.
 */
const crownSlot = (id: string, position: readonly [number, number, number], facing: number, width: number, height: number) =>
  ({ id, kind: 'wall' as const, heraldry: 'crown' as const, position, facing, width, height });
const houseSlot = (id: string, position: readonly [number, number, number], facing: number, width: number) =>
  ({ id, kind: 'wall' as const, heraldry: 'player' as const, position, facing, width });
export const HERALDRY: WorldHeraldry = {
  // Finish on the marble and masonry only; the terrain, roofs, ships and sails keep their colours.
  tint: { amount: .24, exclude: /^(?!.*(marble|ashlar|cityStone|cityPlaster|acro-paving|acro-tread)).*$/i },
  clothLift: .2,
  reliefScale: 1.25,
  sites: [
    // Stair bastions, either side of the great stair (acro-bastion, 3.4 x 11 m).
    houseSlot('bastion-east', [40.2, 30.46, 38.02], 180, 9),
    houseSlot('bastion-west', [7.8, 30.46, 38.02], 180, 9),
    // The western colossus bastion (acro-colossus-bastion, 4.9 x 13.5 m).
    houseSlot('colossus-bastion', [-63.3, 111.65, 181.1], 90, 8.6),
    // Temple front: peristyle bays (temple-peristyle) and podium bays (acro-podium).
    crownSlot('temple-east', [28.66, 77.8, -30.04], 180, 2.4, 7.5),
    crownSlot('temple-west', [11.34, 77.8, -30.04], 180, 2.4, 7.5),
    crownSlot('podium-1', [2.83, 64.53, -22.78], 180, 2.7, 7.4),
    crownSlot('podium-2', [9.48, 64.53, -22.78], 180, 2.7, 7.4),
    crownSlot('podium-3', [30.52, 64.53, -22.78], 180, 2.7, 7.4),
    crownSlot('podium-4', [37.17, 64.53, -22.78], 180, 2.7, 7.4),
    // Aqueduct bridge tower and pier (bridge-tower, bridge-pier).
    houseSlot('aqueduct-tower', [-46.72, 32, 2.48], 181, 5.6),
    crownSlot('aqueduct-pier', [-59.43, 22.15, .58], 181, 2.2, 6.6),
    crownSlot('aqueduct-pier-far', [-195.9, 22.15, -2.33], 181, 2.2, 6.7),
    // Terrace stoa bays (stoa).
    crownSlot('stoa-1', [114.28, 26.48, 34.68], 180, 2.1, 2.86),
    crownSlot('stoa-2', [105.26, 26.48, 34.68], 180, 2.1, 2.86),
    crownSlot('stoa-3', [96.23, 26.48, 34.68], 180, 2.1, 2.86),
    // Gate towers at the stair foot (gate-tower).
    houseSlot('stair-gate', [38.56, 7.1, 96.5], 90, 2.3),
    // The two king monuments' pedestals, south faces.
    { id: 'pedestal-west', kind: 'wall', heraldry: 'player', position: [-10, 72.6, -26.95], facing: 180, width: 8.2 },
    { id: 'pedestal-east', kind: 'wall', heraldry: 'player', position: [50, 67.6, -25.55], facing: 180, width: 8.4 },
    // Beside the island tholos, over the water.
    { id: 'island', kind: 'standard', heraldry: 'player', position: [4, 6.5, 124], width: 10, pole: 26 },
  ],
};
