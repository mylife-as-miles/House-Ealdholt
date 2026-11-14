import {
  CHARGES, CHARGE_LABELS, DIVISIONS, DIVISION_LABELS, ORDINARIES, ORDINARY_LABELS,
  TINCTURES, cloneHeraldry, defaultHeraldry, tinctureClass, tinctureLabel,
} from '../content/heraldry';
import type { Heraldry, Tincture } from '../types';
import { chooseInheritedBannerDesign, type InheritedBannerDraft } from './entry-draft';

export const INHERITED_BANNER_PARTS = ['division', 'field0', 'field1', 'ordinary', 'ordinaryTincture', 'charge', 'chargeTincture'] as const;
export type InheritedBannerPart = typeof INHERITED_BANNER_PARTS[number];
const cycle = <T>(values: readonly T[], value: T, step: 1 | -1): T => values[(values.indexOf(value) + step + values.length) % values.length];
function contrast(value: Tincture): Tincture { return TINCTURES.find(item => tinctureClass(item) !== tinctureClass(value)) ?? value; }

/** An explicit editing action creates a working design when none is chosen.
 * This does not declare the national preset to be the house's historical crest. */
export function cycleInheritedBannerPart(draft: InheritedBannerDraft, part: InheritedBannerPart, step: 1 | -1): InheritedBannerDraft {
  const current = draft.heraldry ?? defaultHeraldry('aethelgard');
  const next = cloneHeraldry(current as Heraldry);
  switch (part) {
    case 'division':
      next.division = cycle(DIVISIONS, next.division, step);
      if (next.division !== 'plain' && next.field[0] === next.field[1]) next.field = [next.field[0], contrast(next.field[0])];
      break;
    case 'field0':
      next.field = [cycle(TINCTURES, next.field[0], step), next.field[1]];
      if (next.division === 'plain') next.field = [next.field[0], next.field[0]];
      break;
    case 'field1': next.field = [next.field[0], cycle(TINCTURES, next.field[1], step)]; break;
    case 'ordinary': next.ordinary = cycle(ORDINARIES, next.ordinary, step); break;
    case 'ordinaryTincture': next.ordinaryTincture = cycle(TINCTURES, next.ordinaryTincture, step); break;
    case 'charge': next.charge = cycle(CHARGES, next.charge, step); break;
    case 'chargeTincture': next.chargeTincture = cycle(TINCTURES, next.chargeTincture, step); break;
  }
  const result = chooseInheritedBannerDesign(draft, next);
  return result.ok ? result.draft : draft;
}

export function describeInheritedBannerPart(heraldry: Readonly<Heraldry>, part: InheritedBannerPart): string {
  switch (part) {
    case 'division': return DIVISION_LABELS[heraldry.division];
    case 'field0': return tinctureLabel(heraldry.field[0]);
    case 'field1': return tinctureLabel(heraldry.field[1]);
    case 'ordinary': return ORDINARY_LABELS[heraldry.ordinary];
    case 'ordinaryTincture': return tinctureLabel(heraldry.ordinaryTincture);
    case 'charge': return CHARGE_LABELS[heraldry.charge];
    case 'chargeTincture': return tinctureLabel(heraldry.chargeTincture);
  }
}
