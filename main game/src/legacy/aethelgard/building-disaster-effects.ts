import {Color,Group,InstancedBufferAttribute,InstancedBufferGeometry,Mesh,NormalBlending,PlaneGeometry,PointLight,ShaderMaterial,Vector2,Vector3,type Camera} from 'three';
import type {BuildingFireRecord} from '../../../../shared/legacy/aethelgard/observer/building-conflagration';
import type {SourceBuilding} from '../../../../shared/legacy/aethelgard/observer/building-damage-catalogue';
import {buildingDamageKey} from '../../../../shared/legacy/aethelgard/observer/building-damage';
import {BUILDING_DISASTER_VERTEX as VERTEX,BUILDING_DISASTER_FIRE as FIRE,BUILDING_DISASTER_SMOKE as SMOKE} from '../../../../shared/legacy/aethelgard/observer/building-disaster-shaders';
import type {WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import type {ProceduralFireRuntime} from './procedural-fire-runtime';

function batch(capacity:number,fragment:string,smoke:boolean,fire:ProceduralFireRuntime){
 const quad=new PlaneGeometry(1,1),geometry=new InstancedBufferGeometry();
 geometry.index=quad.index;geometry.setAttribute('position',quad.getAttribute('position'));geometry.setAttribute('uv',quad.getAttribute('uv'));
 const points=new Float32Array(capacity*4),values=new Float32Array(capacity*2);
 const position=new InstancedBufferAttribute(points,4),value=new InstancedBufferAttribute(values,2);
 geometry.setAttribute('cfDisasterPosition',position);geometry.setAttribute('cfDisasterValue',value);geometry.instanceCount=0;
 const uniforms={...fire.uniforms,cfDisasterScale:{value:1},cfDisasterSeconds:{value:0},cfDisasterWind:{value:new Vector2()},cfDisasterDaylight:{value:1}};
 const material=new ShaderMaterial({name:smoke?'Source building smoke':'Source building combustion',vertexShader:VERTEX,fragmentShader:fragment,uniforms,
  defines:smoke?{CF_DISASTER_SMOKE:''}:{},transparent:true,depthTest:true,depthWrite:false,blending:NormalBlending,premultipliedAlpha:!smoke,toneMapped:true});
 const mesh=new Mesh(geometry,material);mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.userData.iwsdkPreviewBounds='exclude';mesh.renderOrder=smoke?2:4;
 return{mesh,geometry,material,uniforms,points,values,position,value,capacity,dispose(){geometry.dispose();quad.dispose();material.dispose();}};
}

/** Presentation of the source-bound fire reducer. One borrowed combustion field
 * serves the hearths and every building; this owner creates no simulation clock.
 * Fixed light slots keep shader light counts stable as houses catch/extinguish. */
export function createBuildingDisasterEffects(input:{readonly fire:ProceduralFireRuntime;readonly buildings:()=>readonly SourceBuilding[];readonly maxBuildings?:number;readonly maxLights?:number}){
 const maxBuildings=Math.max(1,Math.min(32,Math.floor(input.maxBuildings??16))),maxLights=Math.max(0,Math.min(4,Math.floor(input.maxLights??4)));
 const object=new Group();object.name='Source-bound building fire and smoke';object.userData.iwsdkPreviewBounds='exclude';
 const flames=batch(maxBuildings*8,FIRE,false,input.fire),smoke=batch(maxBuildings*6,SMOKE,true,input.fire);object.add(smoke.mesh,flames.mesh);
 const lights=Array.from({length:maxLights},(_,i)=>{const light=new PointLight(0xff8028,0,24,2);light.name='Building fire light '+i;light.castShadow=false;light.userData.crownfallDisasterLight=true;object.add(light);return light;});
 const world=new Vector3(),eye=new Vector3(),scale=new Vector3(),colour=new Color(0xff8028);
 const localLights:{position:readonly[number,number,number];radius:number;radiance:readonly[number,number,number]}[]=[];
 let disposed=false,lastSelection='',lastCatalogue:readonly SourceBuilding[]|null=null,catalogue=new Map<string,SourceBuilding>();
 const active:{record:BuildingFireRecord;building:SourceBuilding;strength:number;distance:number}[]=[];
 const diagnostics={burningBuildings:0,shownBuildings:0,flameCards:0,smokeCards:0,lightSlots:maxLights,activeLights:0,sourceBindingsHeld:0,staticGIHasOriginalOccupancy:true};
 return{object,lights,localLights,diagnostics,
  update(records:readonly BuildingFireRecord[],state:WorldEnvironmentState|null,seconds:number,camera:Camera,reducedMotion:boolean){
   if(disposed)return;
   const source=input.buildings();if(source!==lastCatalogue){lastCatalogue=source;catalogue=new Map(source.map(b=>[buildingDamageKey(b.binding),b]));lastSelection='';}
   camera.getWorldPosition(eye);object.updateWorldMatrix(true,false);object.getWorldScale(scale);
   active.length=0;diagnostics.sourceBindingsHeld=0;
   for(const record of records){if(record.phase!=='burning'||record.intensity<=0)continue;const building=catalogue.get(buildingDamageKey(record.binding));
    if(!building||building.binding.siteIndex!==record.binding.siteIndex){diagnostics.sourceBindingsHeld++;continue;}
    world.fromArray(building.position).applyMatrix4(object.matrixWorld);active.push({record,building,strength:Math.min(1,record.intensity/1000),distance:world.distanceToSquared(eye)});
   }
   active.sort((a,b)=>a.distance-b.distance||a.building.binding.buildingId.localeCompare(b.building.binding.buildingId));
   diagnostics.burningBuildings=active.length;
   const shown=active.slice(0,maxBuildings);diagnostics.shownBuildings=shown.length;
   const selection=shown.map(e=>buildingDamageKey(e.record.binding)+':'+e.strength).join('|');
   if(lastSelection!==selection){
    let f=0,s=0;
    for(const {building,strength} of shown){const b=building.bounds,c=building.position,dx=b.max[0]-b.min[0],dz=b.max[2]-b.min[2],height=b.max[1]-b.min[1];
     for(let j=0;j<8;j++){const side=j%4,u=j<4?.28:.72,x=side===0?b.min[0]-.07:side===1?b.max[0]+.07:b.min[0]+dx*u,z=side===2?b.min[2]-.07:side===3?b.max[2]+.07:b.min[2]+dz*u;
      const size=Math.max(1.5,Math.min(4,height*.65));flames.points.set([x,b.min[1]+height*(j<4?.26:.56),z,size],f*4);flames.values.set([strength,(j*.173)%1],f*2);f++;}
     for(let j=0;j<6;j++){smoke.points.set([c[0],b.max[1]-.5,c[2],Math.max(2.5,Math.min(5,Math.max(dx,dz)*.6))],s*4);smoke.values.set([strength,j/6],s*2);s++;}
    }
    flames.geometry.instanceCount=f;smoke.geometry.instanceCount=s;for(const b of [flames,smoke]){b.position.needsUpdate=true;b.value.needsUpdate=true;}
    lastSelection=selection;
   }
   for(const b of [flames,smoke]){b.uniforms.cfDisasterScale.value=Math.abs(scale.x);b.uniforms.cfDisasterSeconds.value=reducedMotion?0:seconds;
    (b.uniforms.cfDisasterWind.value as Vector2).set((state?.wind[0]??1)*(state?.windStrength??.2),(state?.wind[1]??0)*(state?.windStrength??.2));b.uniforms.cfDisasterDaylight.value=state?.daylight??1;b.mesh.visible=shown.length>0;}
   localLights.length=0;diagnostics.activeLights=0;
   for(let i=0;i<lights.length;i++){const light=lights[i],entry=shown[i];if(!entry){light.intensity=0;continue;}
    const b=entry.building.bounds,p=entry.building.position;light.position.set(p[0],b.min[1]+Math.min(2.5,(b.max[1]-b.min[1])*.4),p[2]);
    light.intensity=70*entry.strength;light.distance=Math.max(12,Math.min(28,Math.max(b.max[0]-b.min[0],b.max[2]-b.min[2])*2))*Math.abs(scale.x);
    localLights.push({position:[light.position.x,light.position.y,light.position.z],radius:light.distance/Math.max(.0001,Math.abs(scale.x)),radiance:[colour.r*entry.strength*5,colour.g*entry.strength*5,colour.b*entry.strength*5]});diagnostics.activeLights++;}
   diagnostics.flameCards=flames.geometry.instanceCount;diagnostics.smokeCards=smoke.geometry.instanceCount;
  },
  dispose(){if(disposed)return;disposed=true;object.removeFromParent();flames.dispose();smoke.dispose();object.clear();localLights.length=0;for(const light of lights)light.dispose();},
 };
}
export type BuildingDisasterEffects=ReturnType<typeof createBuildingDisasterEffects>;
