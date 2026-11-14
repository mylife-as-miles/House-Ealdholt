/** An explicit source-bound community task, not a profession or asset rewrite.
 * Axe/block matrices are the exact published adult-male woodcutter contract.
 * Fresh actual Mason skin/prop samples supply conservative unplaced bounds. */
import type {CrowdResidentMeta} from './crowd-binding';
import type {CrowdClipPresentation} from './crowd-presentation';
import {EALDHOLT_WOOD_WORKPLACE_CANDIDATE as measured} from './ealdholt-wood-workplace-candidate';
import {EALDHOLT_POPULATION_ASSET_SHA256} from './population-asset-integrity';

export const COMMUNITY_WOOD_RESIDENT='ealdholt-master-mason';
export const COMMUNITY_WOOD_CLIP='work_chop_wood';
export const COMMUNITY_WOOD_ENTER='work_chop_wood_enter';
export const COMMUNITY_WOOD_EXIT='work_chop_wood_exit';
/** Authored event in the pinned adult-male clips/manifest.json, not a clip fraction. */
export const COMMUNITY_WOOD_IMPACTS=Object.freeze([1.12]);
const CRAFT='crowd-v1/props/crowd-props-craft-v1.glb',WORKPLACE='crowd-v1/props/crowd-props-workplace-v1.glb';
const work: CrowdClipPresentation=Object.freeze({
 held:Object.freeze([Object.freeze({prop:'axe',kit:'craft',node:'prop_axe',bone:'hand_r',matrix:Object.freeze([-.0521,.9937,-.099,0,.8146,.0996,.5714,0,.5777,-.0509,-.8147,0,.1646,.1143,.1423,1])})]),
 placed:Object.freeze([Object.freeze({prop:'chopping-block',kit:'workplace',node:'prop_chopping_block',bone:null,matrix:Object.freeze([1,0,0,0,0,1,0,0,0,0,1,0,0,0,.9672,1])})]),hidesRest:Object.freeze([]),
});
export const COMMUNITY_WOOD_PROP_CONTRACT=work;
export function communityWoodCrowdMeta(meta:CrowdResidentMeta):CrowdResidentMeta{
 if(meta.residentId!==COMMUNITY_WOOD_RESIDENT)return meta;
 if(meta.archetype!=='adult-male'||meta.placementScale!==.9937||!meta.presentation)throw Error('Community timber work requires the exact published Mason rig/scale.');
 for(const[path,sha]of Object.entries(measured.workFiles))if(EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha)throw Error('Community timber source file identity drifted.');
 for(const[key,path]of Object.entries({craft:CRAFT,workplace:WORKPLACE}))if(meta.presentation.kits[key]&&meta.presentation.kits[key]!==path)throw Error('Community timber kit ID conflicts with the existing actor.');
 const props=[...meta.props];for(const extra of[{id:'axe',kit:'craft',socket:'hand_r'},{id:'chopping-block',kit:'workplace',socket:'workplace'}]){
  const old=props.find(p=>p.id===extra.id);if(old&&(old.kit!==extra.kit||old.socket!==extra.socket))throw Error('Community timber prop ID conflicts with an existing item.');if(!old)props.push(Object.freeze(extra));
 }
 const byClip={...meta.envelopes?.byClip};
 for(const name of[COMMUNITY_WOOD_CLIP,COMMUNITY_WOOD_ENTER,COMMUNITY_WOOD_EXIT]as const){
  const evidence=measured.workClipMeasurements[name],radius=evidence.radiusMetres/meta.placementScale,top=evidence.heightMetres/meta.placementScale,bottom=(evidence.minimumBodyYMetres-.05)/meta.placementScale;
  byClip[name]=Object.freeze({min:Object.freeze([-radius,bottom,-radius])as readonly[number,number,number],max:Object.freeze([radius,top,radius])as readonly[number,number,number]});
 }
 return Object.freeze({...meta,motion:Object.freeze({...meta.motion,roleClips:Object.freeze([...new Set([...meta.motion.roleClips,COMMUNITY_WOOD_CLIP])])}),props:Object.freeze(props),
  presentation:Object.freeze({...meta.presentation,kits:Object.freeze({...meta.presentation.kits,craft:CRAFT,workplace:WORKPLACE}),clips:Object.freeze({...meta.presentation.clips,[COMMUNITY_WOOD_CLIP]:work,[COMMUNITY_WOOD_ENTER]:work,[COMMUNITY_WOOD_EXIT]:work})}),
  envelopes:Object.freeze({byClip:Object.freeze(byClip),gated:meta.envelopes?.gated===true})});
}
