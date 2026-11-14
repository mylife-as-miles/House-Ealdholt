/** Stable non-secret source identity. Full GLB SHA-256/profile/producer revision
 * remain the authority. This128-bit content fingerprint shortens actor keys;
 * EVERY duplicate key is held by the catalogue, including true duplicate actors,
 * so a hash collision can never choose a different building silently. */
export function buildingSourceFingerprint(bytes:ArrayLike<number>):string {
 let a=0x811c9dc5,b=0x9e3779b9,c=0x85ebca6b,d=0xc2b2ae35;
 for(let i=0;i<bytes.length;i++){const v=bytes[i];a=Math.imul(a^v,0x01000193);b=Math.imul(b^v,0x85ebca77);c=Math.imul(c^v,0xc2b2ae3d);d=Math.imul(d^v,0x27d4eb2f);}
 return[a,b,c,d].map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
export function buildingSourcePartId(name:string,geometryFingerprint:string,frame:readonly number[],ordinal:number):string {
 if(frame.length!==16||!frame.every(Number.isFinite)||!Number.isSafeInteger(ordinal)||ordinal<0)throw Error('Invalid source part identity.');
 const canonical=new ArrayBuffer(128),view=new DataView(canonical);frame.forEach((v,i)=>view.setFloat64(i*8,v===0?0:v,true));
 return`${name}:${geometryFingerprint}:${buildingSourceFingerprint(new Uint8Array(canonical))}:${ordinal}`;
}
