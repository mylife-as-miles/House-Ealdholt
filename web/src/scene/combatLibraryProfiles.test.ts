import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadCombatAnimationLibrary, COMBAT_LIBRARY_V2_VERSION } from './combatAnimationLibrary';
import { COMBAT_LIBRARY_VERSION } from '../../../shared/play/combat-sequences';
import { PieceView } from './pieces';

function loader() {
  const requested: string[] = [], gltf = new GLTFLoader();
  const reader = { async loadAsync(url: string) {
    const source = /combat-v([12])\/(wp|bp|ep|kp)\.glb/.exec(url);
    if (!source) throw Error('Unexpected animation source: ' + url);
    const relative = `src/assets/chess/combat-v${source[1]}/${source[2]}.glb`;
    requested.push(relative);
    const bytes = readFileSync(resolve(process.cwd(), relative));
    return gltf.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } } as unknown as GLTFLoader;
  return { reader, requested };
}

for (const archetype of ['wp', 'bp', 'ep', 'kp']) it(`${archetype} retains genuine v1 duplicate motions beside its source-qualified v2 default`, async () => {
  const source = loader(), library = await loadCombatAnimationLibrary(archetype, source.reader);
  expect(source.requested).toEqual([`src/assets/chess/combat-v2/${archetype}.glb`, `src/assets/chess/combat-v1/${archetype}.glb`]);
  expect([...library!.versions!.keys()]).toEqual([COMBAT_LIBRARY_V2_VERSION, COMBAT_LIBRARY_VERSION]);
  for (const variants of library!.versions!.values()) expect([...variants.values()].every(variant => variant.metadata.archetype === archetype)).toBe(true);
  const original = library!.versions!.get(COMBAT_LIBRARY_VERSION)!.get('attack.thrust')!;
  const current = library!.versions!.get(COMBAT_LIBRARY_V2_VERSION)!.get('attack.thrust')!;
  expect(library!.get('attack.thrust')).toBe(current);
  expect(original.clip).not.toBe(current.clip);
  expect(original.metadata.version).toBe(COMBAT_LIBRARY_VERSION);
  expect(current.metadata.version).toBe(COMBAT_LIBRARY_V2_VERSION);
  expect(original.metadata.duration).not.toBe(current.metadata.duration);

  // Exercise the actual PieceView installer/selector with a real Three mixer;
  // no renderer, stand-in scene or visual correctness claim is involved.
  const figure = Object.assign(Object.create(PieceView.prototype), {
    mixer: new THREE.AnimationMixer(new THREE.Group()), variants: new Map(), actions: new Map(),
    combatVersions: new Map(), combatLibraryVersion: null, activeOneShot: null,
  }) as PieceView;
  figure.installCombatLibrary(library!);
  expect(figure.selectCombatLibrary(COMBAT_LIBRARY_VERSION)).toBe(true);
  expect(figure.combatClipInfo('attack.thrust')!.duration).toBe(original.clip.duration);
  expect(figure.hasCombatVariant('attack.jab')).toBe(false);
  expect(figure.selectCombatLibrary(COMBAT_LIBRARY_V2_VERSION)).toBe(true);
  expect(figure.combatClipInfo('attack.thrust')!.duration).toBe(current.clip.duration);
  expect(figure.hasCombatVariant('attack.jab')).toBe(true);
  expect(figure.hasCombatVariant('attack.bash-thrust'), 'v2 retains its explicitly supported v1 supplement').toBe(true);
  expect(figure.selectCombatLibrary('unqualified-library')).toBe(false);
  expect(figure.combatClipInfo('attack.thrust')!.duration).toBe(current.clip.duration);
});
