import {REGIONAL_ROOT_CONTACTS} from './regional-root-contact-data';
import {SCANNED_SHRUB_VARIANT,type ScannedShrubCohortSource} from './scanned-shrub-policy';

/** Small CC0 derivative pair from Poly Haven; raw Poly Haven/Fab sources are not
 * bundled. Source and licence audit remains attached to the asset manifest. */
export const SCANNED_SHRUB_ASSET_PATH='assets/legacy/environment/aethelgard/polyhaven-shrub02-b-v1/';
export const SCANNED_SHRUB_NATIVE_ASSET_ID='ealdholt-regional-scanned-shrub';
export const SCANNED_SHRUB_ASSETS={
  "desktop": {
    "file": "shrub02-b-desktop-1024-draco.glb",
    "sha256": "dac726332205f4712a36caa571ce22c1d845148514b8adb13978476f24916958",
    "bytes": 2161916,
    "textureBytes": 16777212,
    "geometryBytes": 178104,
    "preset": "desktop-1024"
  },
  "native": {
    "file": "shrub02-b-native-512-draco.glb",
    "sha256": "9f50ad5da831f7fe1deaf22f4400e399a6f50a2a5aeac1229a2a4f98655afbd3",
    "bytes": 1023936,
    "textureBytes": 4194300,
    "geometryBytes": 178104,
    "preset": "native-512"
  }
} as const;
export const SCANNED_SHRUB_SOURCE_IDENTITY={
  "sourceAsset": "shrub_02",
  "sourceVariant": "shrub_02_b",
  "sourceGltfSha256": "99de0a70fe88ad414615cc8d8e020617c8512e2abfe08b911b153a6fcc40d93e",
  "sourceAlphaSha256": "5c2c31bac311051db77443e1780078403c2df0a832c40fe6ed7bcd982695cdf0",
  "derivativeVersion": "crownfall-polyhaven-shrub02b-alpha8-draco-lossless-v1"
} as const;
export const SCANNED_SHRUB_MEASURED={
 min:[-0.5499357420897621, -0.008060193753604396, -0.5163181260662121],max:[0.5602986529805386, 1.4982524614139106, 0.7635986596152445],height:1.506312655167515,
 canopyRadius:0.9211704844017186,contactRadius:0.23665213104140292,
 points:[[-0.16848677375139565, 0.021662639062347805, -0.06701088497676372], [-0.16502959640245032, 0.013416164594636931, -0.07406495922043127], [0.10262582080872418, 0.015446489077845845, -0.21324205033194785], [0.11329215180652219, 0.01783574673689375, -0.16918874280346732], [0.1075917201603467, 0.010387961969188696, -0.1335301667780191], [0.01770518839726564, 0.01948891511394058, 0.005311248030236002], [0.015217916163032676, 0.019868939930390503, 0.007010838168239979], [0.012040769216186697, 0.021545110492090902, 0.006640212405224551], [-0.16495891689928688, 0.020141088953115865, -0.0650112282659395]],triangles:5242,vertices:3600,
} as const;
export function scannedShrubAssetMetadataMatches(value:unknown,native=false):boolean{
 if(!value||typeof value!=='object')return false;const metadata=value as Record<string,unknown>;
 return Object.entries(SCANNED_SHRUB_SOURCE_IDENTITY).every(([key,value])=>metadata[key]===value)
  &&metadata.texturePreset===SCANNED_SHRUB_ASSETS[native?'native':'desktop'].preset;
}
export function scannedShrubCohortSource(native=false):ScannedShrubCohortSource{
 const measured=SCANNED_SHRUB_MEASURED,baseY=REGIONAL_ROOT_CONTACTS.bramble.baseY,dy=baseY-measured.min[1];
 return{variant:SCANNED_SHRUB_VARIANT,sourceSha256:SCANNED_SHRUB_ASSETS[native?'native':'desktop'].sha256,
  height:measured.height,canopyRadius:measured.canopyRadius,windReach:measured.height*.018,
  contact:{baseY,radius:measured.contactRadius,points:measured.points.map(p=>[p[0],p[1]+dy,p[2]] as const)}};
}
