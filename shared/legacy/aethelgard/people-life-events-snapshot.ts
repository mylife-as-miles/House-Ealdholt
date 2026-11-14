// Standalone experiment round-trip only. No storage slot, inherited-save
// migration, wall-clock query or catch-up occurs during parsing/serialization.
import { ownPeopleLifeEventsSnapshot, type PeopleLifeEventsResult, type PeopleLifeEventsSnapshot } from './people-life-events';
export function serializePeopleLifeEventsSnapshot(snapshot:PeopleLifeEventsSnapshot):{readonly ok:true;readonly json:string}|{readonly ok:false;readonly error:string} {
  const result=ownPeopleLifeEventsSnapshot(snapshot);return result.ok?{ok:true,json:JSON.stringify(result.snapshot)}:result;
}
export function parsePeopleLifeEventsSnapshot(json:string):PeopleLifeEventsResult {
  if(typeof json!=='string')return{ok:false,error:'Supply a serialized people-life snapshot.'};
  try{return ownPeopleLifeEventsSnapshot(JSON.parse(json));}catch{return{ok:false,error:'The people-life snapshot is not valid JSON data.'};}
}
