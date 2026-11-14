// Active-visit presentation foundation only: no Date, timers, storage, missed
// events, task completion, rewards, upkeep, standing or chess consequences.
export interface PeopleLifeClock {readonly activeMilliseconds:number;readonly dayLengthMilliseconds:number}
export type PeopleLifeVisitState='active'|'paused'|'hidden'|'away';
export interface PeopleLifeClockStep {readonly elapsedMilliseconds:number;readonly state:PeopleLifeVisitState}
export interface PeopleLifeDay {readonly dayIndex:number;readonly dayMinute:number}
/** A host supplies short measured active frames. Large deltas are refused,
 * never interpreted as an offline visit or silently consumed on return. */
export const PEOPLE_LIFE_MAX_STEP_MILLISECONDS=1000;
function shape(value:unknown,keys:readonly string[]):boolean {
  return value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Reflect.ownKeys(value).length===keys.length
    &&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable===true&&'value'in d;});
}
function valid(clock:PeopleLifeClock):boolean {
  return shape(clock,['activeMilliseconds','dayLengthMilliseconds'])&&Number.isSafeInteger(clock.activeMilliseconds)&&clock.activeMilliseconds>=0
    &&Number.isSafeInteger(clock.dayLengthMilliseconds)&&clock.dayLengthMilliseconds>=1440;
}
/** Day length is an explicit presentation choice, not an imposed real timer. */
export function createPeopleLifeClock(dayLengthMilliseconds:number):PeopleLifeClock {
  const clock={activeMilliseconds:0,dayLengthMilliseconds};if(!valid(clock))throw Error('Supply a safe active-day duration of at least 1440ms.');
  return Object.freeze(clock);
}
export function stepPeopleLifeClock(clock:PeopleLifeClock,step:PeopleLifeClockStep):PeopleLifeClock {
  if(!valid(clock)||!shape(step,['elapsedMilliseconds','state'])||!Number.isSafeInteger(step.elapsedMilliseconds)||step.elapsedMilliseconds<0
    ||!['active','paused','hidden','away'].includes(step.state))throw Error('Invalid active-visit clock step.');
  if(step.state!=='active'||step.elapsedMilliseconds===0)return Object.freeze({activeMilliseconds:clock.activeMilliseconds,dayLengthMilliseconds:clock.dayLengthMilliseconds});
  if(step.elapsedMilliseconds>PEOPLE_LIFE_MAX_STEP_MILLISECONDS)throw Error('Large active steps cannot catch up offline time.');
  const activeMilliseconds=clock.activeMilliseconds+step.elapsedMilliseconds;
  if(!Number.isSafeInteger(activeMilliseconds))throw Error('Active-visit duration exceeds its safe range.');
  return Object.freeze({activeMilliseconds,dayLengthMilliseconds:clock.dayLengthMilliseconds});
}
export function getPeopleLifeDay(clock:PeopleLifeClock):PeopleLifeDay {
  if(!valid(clock))throw Error('Invalid active-visit clock.');
  return Object.freeze({dayIndex:Math.floor(clock.activeMilliseconds/clock.dayLengthMilliseconds),
    dayMinute:(clock.activeMilliseconds%clock.dayLengthMilliseconds)/clock.dayLengthMilliseconds*1440});
}
