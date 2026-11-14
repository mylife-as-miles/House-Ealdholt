import { resolveImpact, type ImpactQuery } from '../gore/ImpactResolver';
import type { ContactMaterial } from '../../../../shared/play/contact-vfx';

/** Reuse the Gore Director's authored rig surface/breach table. This returns
 * dry VFX only and cannot create an injury or another blood event. */
export function dryContactMaterial(query: ImpactQuery): ContactMaterial | null {
  const impact = resolveImpact(query);
  if (impact.response === 'blood') return null;
  if (impact.material === 'mail' || impact.material === 'plate') return impact.response === 'sparks' ? 'steel' : null;
  if (impact.material === 'stone') return 'stone';
  return impact.response === 'sparks' || impact.response === 'splinters' ? impact.material as ContactMaterial : null;
}
