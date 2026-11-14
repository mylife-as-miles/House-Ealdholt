/** Stable, periodic advection from the saved clock. Weather adds a bounded,
 * smooth wind offset rather than multiplying elapsed time by a changing wind.
 * Sky, surface shadows and water reflections all sample this same phase. */
const wrap=(v:number)=>((v%6000)+6000)%6000;
export function updateCloudOffset(target:{x:number;y:number},seconds:number,wind:readonly[number,number],strength:number,reducedMotion:boolean){
 if(!Number.isFinite(seconds)||!wind.every(Number.isFinite)||!Number.isFinite(strength))throw Error('Invalid cloud motion clock or wind.');
 target.x=reducedMotion?0:wrap(seconds*3.1+wind[0]*strength*60);
 target.y=reducedMotion?0:wrap(seconds*1.1+wind[1]*strength*60);
}
