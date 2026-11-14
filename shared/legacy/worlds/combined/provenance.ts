/** Public asset provenance only. Technical generator names are not world canon. */
export const COMBINED_WORLD_SOURCES=Object.freeze({
 temple:Object.freeze({repository:'https://github.com/Leonxlnx/golden-temple',commit:'97fd9ec35ee5c0f02769addb4e35cb5e22f951dd',license:'MIT',status:'included'}),
 monolith:Object.freeze({repository:'https://github.com/Leonxlnx/monolithwilds',commit:'02dbcd3e790c21861dfecb47f4d9e23cccee35ec',license:'MIT',status:'included'}),
 athenaion:Object.freeze({repository:'https://github.com/Leonxlnx/athenaion',commit:'9b8bd23b39c458a50fb1201037360047781c45b5',license:'MIT',status:'included'}),
 alpine:Object.freeze({repository:'https://github.com/Leonxlnx/procedural-alpine-lake',commit:'b84c254b3fa533b8c992eb685e1127a92702da21',license:'Permission reported by creator; written record pending',status:'not-included',publicationBlocked:true}),
});
export type CombinedBuildingKind='hall'|'cottage'|'storehouse'|'archive'|'herald'|'pavilion'|'ruin-arch';
export interface CombinedBuildingSpec {id:string;kind:CombinedBuildingKind;width:number;depth:number;height?:number}
export interface CombinedSourceInfo {source:string;generator:string;objects:number;meshes:number;triangles:number;instances:number}
