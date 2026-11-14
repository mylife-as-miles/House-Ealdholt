import { expect, it } from 'vitest';
import { dryContactMaterial } from './contactMaterial';
import type { ImpactQuery } from '../gore/ImpactResolver';
const hit: ImpactQuery = { attacker: { kind: 'p', kingdom: 'sun', weapon: 'spear' },
  defender: { kind: 'p', kingdom: 'ivory', shield: 'iron' }, contact: { anchor: 'torso' }, power: 1, outcome: 'glance' };
it('uses the existing authored armour/breach policy instead of inventing a second injury path', () => {
  expect(dryContactMaterial(hit)).toBe('steel');
  expect(dryContactMaterial({ ...hit, outcome: 'kill' })).toBeNull();
  expect(dryContactMaterial({ ...hit, defender: { kind: 'p', kingdom: 'sun' } })).toBeNull();
  expect(dryContactMaterial({ ...hit, contact: { anchor: 'shield' }, defender: { kind: 'p', kingdom: 'sun', shield: 'wood' } })).toBe('wood');
  expect(dryContactMaterial({ ...hit, contact: { anchor: 'shield' }, outcome: 'kill' })).toBe('iron');
});
