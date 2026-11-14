import {
  buildingDamageKey, buildingRebuildAvailability, BUILDING_REBUILD_TIMBER, BUILDING_REBUILD_LABOUR_MINUTES,
  type BuildingDamageBinding, type VillageBuildingDamageState,
} from '../../../../../shared/legacy/aethelgard/observer/building-damage';

export interface BuildingRebuildPanelProps {
  state: VillageBuildingDamageState | null;
  unavailable: boolean;
  pending?:boolean;
  canReach(binding: BuildingDamageBinding): boolean;
  onRebuild(buildingKey: string, crewId: string): void;
}

/** Only damaged buildings add controls to the existing observer panel. Costs
 * and progress come from the saved rules; this view never grants resources. */
export function BuildingRebuildPanel({state, unavailable, pending, canReach, onRebuild}: BuildingRebuildPanelProps) {
  if (unavailable) return <section className="obs-group" aria-label="Building recovery" data-building-recovery="held">
    <h3 className="obs-legend">Buildings</h3><p className="obs-quiet">Building recovery could not be loaded. Repairs are held.</p>
  </section>;
  if (!state || !state.buildings.some(building => building.condition !== 'sound')) return null;
  return <section className="obs-group" aria-label="Rebuilding" data-building-recovery="active">
    <h3 className="obs-legend">Rebuilding</h3>
    <p className="obs-quiet">{state.timber} timber · builders work 08:00–18:00</p>
    {state.buildings.filter(building => building.condition !== 'sound').map(building => {
      const key = buildingDamageKey(building.binding), reachable = canReach(building.binding);
      const crew = state.crews.find(candidate => buildingRebuildAvailability(state, key, candidate.id).available)
        ?? state.crews.find(candidate => candidate.assignedBuildingKey === key) ?? state.crews[0];
      const eligibility = buildingRebuildAvailability(state, key, crew?.id ?? '');
      return <div key={key} className="obs-raid-live" data-building-condition={building.condition}>
        <div className="obs-raid-head"><strong>{building.label}</strong><span>{building.condition === 'burned' ? 'Burned' : 'Rebuilding'}</span></div>
        {!reachable ? <p className="obs-quiet">This building is unavailable in the current village.</p>
          : building.rebuild ? <>
            <progress aria-label={`Rebuilding ${building.label}`} value={building.rebuild.labourDone} max={building.rebuild.labourRequired} />
            <small className="obs-quiet">{crew?.houseLabel ?? 'Repair party'} · {Math.floor(building.rebuild.labourDone / building.rebuild.labourRequired * 100)}%</small>
          </> : <>
            <button type="button" className="obs-row" data-nav data-observer-rebuild={building.binding.buildingId}
              disabled={pending||!eligibility.available} onClick={() => crew && onRebuild(key, crew.id)}>Rebuild</button>
            <p className="obs-quiet">{eligibility.available
              ? `${BUILDING_REBUILD_TIMBER} timber · ${BUILDING_REBUILD_LABOUR_MINUTES} worker-minutes · ${crew!.houseLabel}`
              : eligibility.reason}</p>
          </>}
      </div>;
    })}
  </section>;
}
