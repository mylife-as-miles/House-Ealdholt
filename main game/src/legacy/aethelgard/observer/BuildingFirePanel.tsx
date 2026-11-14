import type {BuildingDamageBinding} from '../../../../../shared/legacy/aethelgard/observer/building-damage';
import {buildingDamageKey,BUILDING_REBUILD_TIMBER,BUILDING_REBUILD_LABOUR_MINUTES} from '../../../../../shared/legacy/aethelgard/observer/building-damage';
import type {BuildingConflagrationState} from '../../../../../shared/legacy/aethelgard/observer/building-conflagration';
import type {BuildingLocalRebuildOrder} from '../../../../../shared/legacy/aethelgard/observer/building-disaster-session';

export interface BuildingFirePanelProps {
  fire:BuildingConflagrationState|null;
  orders:readonly BuildingLocalRebuildOrder[];
  timber:number;
  pending:boolean;
  unavailable:boolean;
  label(binding:BuildingDamageBinding):string;
  workers(binding:BuildingDamageBinding):readonly string[];
  workerName(id:string):string;
  onInspect(binding:BuildingDamageBinding):void;
  onRebuild(binding:BuildingDamageBinding,workers:readonly string[]):void;
}

/** Existing observer surfaces show consequences and actual funded local work.
 * This panel neither advances labour nor grants stock or disaster events. */
export function BuildingFirePanel(props:BuildingFirePanelProps) {
  const {fire,orders,timber,pending,unavailable}=props;
  if(unavailable)return <section className="obs-group" data-building-fire="held" aria-label="Building fires">
    <h3 className="obs-legend">Buildings</h3><p className="obs-quiet">Building recovery is held. The saved record is preserved.</p>
  </section>;
  const damaged=fire?.buildings.filter(row=>row.phase!=='sound')??[];
  if(!damaged.length)return null;
  return <section className="obs-group" data-building-fire="active" aria-label="Building fires">
    <h3 className="obs-legend">Buildings</h3>
    <p className="obs-quiet">{timber} timber</p>
    {damaged.map(row=>{
      const key=buildingDamageKey(row.binding),name=props.label(row.binding);
      const order=orders.find(candidate=>buildingDamageKey(candidate.binding)===key&&candidate.completedAtMinute===null);
      const workers=props.workers(row.binding),burning=row.phase==='burning';
      const reason=pending?'The village is catching up.':burning?'The fire must be out first.':order?null:
        timber<BUILDING_REBUILD_TIMBER?`Needs ${BUILDING_REBUILD_TIMBER} timber.`:!workers.length?'No builder has a safe, equipped worksite.':null;
      return <div key={key} className="obs-raid-live" data-building-fire-phase={row.phase} data-building-id={row.binding.buildingId}>
        <div className="obs-raid-head"><strong>{name}</strong><span>{burning?'Burning':order?'Rebuilding':row.collapsedAtMinute!==null?'Ruined':'Damaged'}</span></div>
        <button type="button" className="obs-row" data-nav data-observer-inspect-building={row.binding.buildingId}
          onClick={()=>props.onInspect(row.binding)}>View</button>
        {order?<>
          <progress aria-label={`Rebuilding ${name}`} value={row.repairLabour} max={BUILDING_REBUILD_LABOUR_MINUTES}/>
          <small className="obs-quiet">{order.workerIds.map(props.workerName).join(' · ')} · {Math.floor(row.repairLabour/BUILDING_REBUILD_LABOUR_MINUTES*100)}%</small>
        </>:<>
          <button type="button" className="obs-row" data-nav data-observer-local-rebuild={row.binding.buildingId}
            disabled={!!reason} onClick={()=>props.onRebuild(row.binding,workers)}>Rebuild</button>
          <p className="obs-quiet">{reason??`${BUILDING_REBUILD_TIMBER} timber · local builders`}</p>
        </>}
      </div>;
    })}
  </section>;
}
