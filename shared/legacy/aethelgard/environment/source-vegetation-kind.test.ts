import assert from 'node:assert/strict';
import test from 'node:test';
import {identifySourceVegetation} from './source-vegetation-kind';
test('tagged source cells and compact export roots qualify without duplicating generated parts or hidden prototypes', () => {
  assert.equal(identifySourceVegetation('custom-oak', {crownfallElderbloom: {kind: 'tree', cellSize: 16}}, false), 'tree');
  assert.equal(identifySourceVegetation('SM_BlackAlder_Forest_05_PP3', {}, true), 'tree');
  assert.equal(identifySourceVegetation('S_Grass_Clumps_rbojr_Var2_lod1', {}, true), 'groundcover');
  assert.equal(identifySourceVegetation('SM_BlackAlder_Forest_05_PP3', {}, false), null);
  assert.equal(identifySourceVegetation('SM_BlackAlder_Forest_05_PP3', {crownfallWoodlandPrototype: {schema: 1}}, true), null);
  assert.equal(identifySourceVegetation('Tree-engraved-house-door', {}, true), null);
});
