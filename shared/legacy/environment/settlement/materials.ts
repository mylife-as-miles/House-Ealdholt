import type { MaterialDefinition,TextureSetId } from '../materials/types';
const texture=(key:string):TextureSetId|null=>key==='settlement-ground'?'grass':key==='settlement-path'?'earth':key==='settlement-timber'?'timber':key==='settlement-bark'?'bark':key==='settlement-plaster'?'plaster':key==='settlement-stone'?'rubble':key.startsWith('settlement-roof-')?(key.endsWith('rust')?'shingle':'slate'):key==='settlement-leaf'?'foliage':null;
const standard=(key:string,color:string,roughness=.9):MaterialDefinition=>{const map=texture(key);return{key,label:key.replace('settlement-','').replace(/-/g,' '),shading:'standard',color,roughness,metalness:0,texture:map,textureScale:key==='settlement-ground'?3.2:key==='settlement-timber'?1.4:2,uvSpace:'world',normalScale:map==='slate'?.5:map==='timber'?.45:.24,quest:{color,textured:!!map}};};
export const SETTLEMENT_MATERIALS:readonly MaterialDefinition[]=[
 standard('settlement-ground','#ffffff'),standard('settlement-path','#c6a265'),
 standard('settlement-plaster','#d6c6a0'),
 standard('settlement-timber','#5d422d'),standard('settlement-stone','#acaaa1'),standard('settlement-bark','#61432f'),
 standard('settlement-roof-blue','#304e68'),standard('settlement-roof-green','#405b48'),standard('settlement-roof-rust','#83472e'),
 {...standard('settlement-leaf','#ffffff'),shading:'foliage'},
 {...standard('settlement-window','#e2bb6f'),emissive:{color:'#d5a15a',intensity:.18}},
 {...standard('settlement-water','#75acbd',.3),shading:'water'},
];
