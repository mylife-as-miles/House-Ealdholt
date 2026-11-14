/** Canonical CC0 grass-map contract. Pure metadata only; no fetch or renderer. */
export type EaldholtValleyGrassProfile = 'desktop' | 'quest';
export type EaldholtValleyGrassRole = 'albedo' | 'normal' | 'orm';
export interface EaldholtValleyGrassFile { readonly file:string;readonly size:512|1024;readonly bytes:number;readonly sha256:string }
export interface EaldholtValleyGrassManifest {
  readonly profile:EaldholtValleyGrassProfile;readonly assetId:'leafy_grass'|'forrest_ground_01'|'Grass001';readonly sourceUrl:string;
  readonly size:512|1024;readonly meanLuminance:number;readonly tileMetres:1.4|2;
  readonly files:Readonly<Record<EaldholtValleyGrassRole,EaldholtValleyGrassFile>>;
  readonly downloadBytes:number;readonly gpuBytesWithMipsEstimate:number;
}
export const EALDHOLT_VALLEY_GRASS_CACHE_KEY = ':cc0-ground-grass-scale-v3';
export function ealdholtGrassMipBytes(size:number):number {
  if(size!==512&&size!==1024)throw Error('Invalid canonical grass size.');
  let bytes=0;for(let level=size;level>=1;level/=2)bytes+=level*level*4;return bytes*3;
}
function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid canonical grass manifest object.');
  return value as Record<string,unknown>;
}
function field(value:unknown,key:string):unknown {
  const descriptor=Object.getOwnPropertyDescriptor(record(value),key);
  if(!descriptor||!('value'in descriptor))throw Error('Invalid canonical grass manifest field.');return descriptor.value;
}
export function readEaldholtValleyGrassManifest(value:unknown,profile:EaldholtValleyGrassProfile):EaldholtValleyGrassManifest {
  if(profile!=='desktop'&&profile!=='quest')throw Error('Invalid canonical grass profile.');
  const assetId=field(value,'assetId');
  if(assetId!=='leafy_grass'&&assetId!=='forrest_ground_01'&&assetId!=='Grass001')throw Error('Invalid canonical grass source identity.');
  const sourceUrl=assetId==='Grass001'?'https://ambientcg.com/a/Grass001':`https://polyhaven.com/a/${assetId}`,tileMetres=assetId==='Grass001'?1.4:2;
  if(field(value,'version')!==1||field(value,'licence')!=='CC0-1.0'||field(value,'sourceUrl')!==sourceUrl||field(value,'tileMetres')!==tileMetres)throw Error('Invalid canonical grass source contract.');
  const entry=field(field(value,'profiles'),profile),size=profile==='desktop'?1024:512,mean=field(entry,'meanLuminance');
  if(field(entry,'size')!==size||typeof mean!=='number'||!Number.isFinite(mean)||mean<=0||mean>1)throw Error('Invalid canonical grass luminance or dimensions.');
  const sourceFiles=field(entry,'files'),files={}as Record<EaldholtValleyGrassRole,EaldholtValleyGrassFile>;
  for(const role of['albedo','normal','orm']as const){const item=field(sourceFiles,role),file=field(item,'file'),bytes=field(item,'bytes'),sha256=field(item,'sha256');
    if(file!==`grass-${profile}-${role}-${size}.webp`||field(item,'size')!==size||typeof bytes!=='number'||!Number.isSafeInteger(bytes)||bytes<=0||bytes>32*1024*1024||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid canonical grass file contract.');
    files[role]={file,size,bytes,sha256};
  }
  return{profile,assetId,sourceUrl,size,meanLuminance:mean,tileMetres,files,
    downloadBytes:files.albedo.bytes+files.normal.bytes+files.orm.bytes,gpuBytesWithMipsEstimate:ealdholtGrassMipBytes(size)};
}
