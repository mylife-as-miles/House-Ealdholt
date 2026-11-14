import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EALDHOLT_VILLAGE_POPULATION as POP } from '../../../../../shared/legacy/aethelgard/characters/village-population';
import { ResidentWatchList } from './ResidentWatchList';
import type { VillagePopulationResidentState } from '../../../../../shared/legacy/aethelgard/characters/village-population-runtime';

test('Watch exposes and selects all100 registered identities with shared labels, including both source patrol spearmen', () => {
  const before = JSON.stringify(POP), selected: string[] = [];
  const element = ResidentWatchList({ followId: 'ealdholt-garrison-spearman', stateOf: () => undefined, overlayFor: () => undefined,
    onFollow: id => selected.push(id) });
  const html = renderToStaticMarkup(element);
  const ids = [...html.matchAll(/data-observer-watch="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 100); assert.equal(new Set(ids).size, 100);
  assert.deepEqual(ids, POP.residents.map(row => row.id));
  for (const id of ['ealdholt-spearman-husband', 'ealdholt-garrison-spearman', 'ealdholt-house-steward', 'ealdholt-house-messenger', 'ealdholt-thatcher'])
    assert.ok(ids.includes(id), `${id} remains a selectable villager`);
  const rows = element.props.children;
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].props.children[0].props.children, POP.residents[i].label);
    assert.equal(rows[i].props['aria-pressed'], POP.residents[i].id === 'ealdholt-garrison-spearman');
    rows[i].props.onClick();
  }
  assert.deepEqual(selected, ids); assert.equal(JSON.stringify(POP), before);
});

test('ordinary Watch rows retain raid and away wording without changing their routine state', () => {
  const ids = ['ealdholt-spearman-husband', 'ealdholt-house-messenger'];
  const rows = ids.map(id => {
    const resident = POP.residents.find(row => row.id === id)!, slot = resident.registry.routine[0];
    return { residentId: id, tier: resident.fidelityTier, activity: slot.activity, roleClip: null,
      availableRoleClips: resident.appearance.motion.roleClips, scheduledPlaceId: slot.placeId, placeId: null,
      fromPlaceId: resident.homePlaceId, slotIndex: 0, slotStartMinute: slot.startMinute, slotEndMinute: slot.endMinute,
      status: 'unmapped', reason: 'route-unmapped', position: null, yawRadians: 0, moving: false, presentable: false } satisfies VillagePopulationResidentState;
  });
  const before = JSON.stringify(rows);
  const html = renderToStaticMarkup(<ResidentWatchList followId={null} stateOf={id => rows.find(row => row.residentId === id)} onFollow={() => {}}
    overlayFor={id => { const row = rows.find(candidate => candidate.residentId === id); return row ? {
      residentId: id, scheduledPlaceId: row.scheduledPlaceId, slotIndex: row.slotIndex,
      activity: id === ids[0] ? 'Shelters from the raiders.' : 'Travels to the market.', alarm: id === ids[0], away: id === ids[1] } : undefined; }} />);
  assert.match(html, /shelters from the raiders/); assert.match(html, /travels to the market/);
  assert.equal(JSON.stringify(rows), before);
});
