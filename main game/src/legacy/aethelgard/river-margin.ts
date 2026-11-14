import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Sphere, Vector3, type Material, type Object3D } from 'three';
import { createEaldholtRiverMarginPlacements, createEaldholtRiverOutcropBuffers, EALDHOLT_RIVER_MARGIN, type EaldholtMarginPlacement } from '../../../../shared/legacy/aethelgard/environment/river-margin';
import type { EaldholtWoodlandSurface } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import type { EaldholtBorrowedSurfaceMaps } from './ground-albedo-detail';

export interface EaldholtRiverMargin {
  readonly object:Object3D;readonly triangles:number;readonly drawCalls:number;readonly instanceCount:number;
  readonly grassInstanceCount:number;readonly stoneInstanceCount:number;readonly sourceGrassFamily:string|null;
  readonly grassTrianglesPerClump:number;readonly grassBudgetLimited:boolean;readonly limit:string|null;
  readonly stoneFormsPerGroup:3;readonly stoneTrianglesPerGroup:180;readonly sourceRockFamily:null;readonly ownedGeometryBytes:number;
  readonly bounds:{min:readonly[number,number,number];max:readonly[number,number,number]}|null;
  dispose():void;
}
type GrassFamily={mesh:InstancedMesh;bounds:Box3;triangles:number;name:string;material:Material};

/** Removable local shore dressing. Borrow one COMPLETE one-primitive source
 * grass family, plus one original three-form outcrop geometry. Source actors, geometry,
 * grass materials/maps and supplied rock maps stay untouched. Add before real
 * composite bounds and neutral-light material cloning; dispose neutral first. */
export function createEaldholtRiverMargin(privateModel:Object3D,valley:Object3D,rock?:EaldholtBorrowedSurfaceMaps,options:{profile?:'desktop'|'quest'}={}):EaldholtRiverMargin {
  const quest=options.profile==='quest',profile=quest?'quest':'desktop',settings=EALDHOLT_RIVER_MARGIN[profile],budget=settings.maximumTriangles;
  privateModel.updateWorldMatrix(true,true);valley.updateWorldMatrix(true,true);
  const inverseRoot=new Matrix4().copy(privateModel.matrixWorld).invert(),point=new Vector3(),village=new Box3();
  function geometryBounds(mesh:Mesh){const box=new Box3(),positions=mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)box.expandByPoint(point.fromBufferAttribute(positions,i));return box;}
  privateModel.traverse(object=>{
    if(!(object instanceof Mesh)||!/^LandscapeComponent_\d+(?:_\d+)?$/.test(object.name))return;
    const frame=new Matrix4().multiplyMatrices(inverseRoot,object.matrixWorld),positions=object.geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++)village.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(frame));
  });
  if(village.isEmpty())throw Error('River margin needs the original village terrain envelope.');
  const seen=new Set<Object3D>(),families:GrassFamily[]=[];
  privateModel.traverse(candidate=>{
    if(!(candidate instanceof InstancedMesh)||candidate.count<1||!/Grass_Clumps/i.test(candidate.name))return;
    let owner:Object3D=candidate;while(owner.parent&&owner.parent!==privateModel&&/Grass_Clumps/i.test(owner.parent.name))owner=owner.parent;
    if(seen.has(owner))return;seen.add(owner);const parts:Mesh[]=[];owner.traverse(child=>{if(child instanceof Mesh)parts.push(child);});
    if(parts.length!==1||parts[0]!==candidate||!candidate.geometry.getAttribute('position')||!candidate.geometry.getAttribute('normal'))return;
    const source=candidate.geometry,material=Array.isArray(candidate.material)?candidate.material.length===1?candidate.material[0]:null:candidate.material;
    const count=source.index?.count??source.getAttribute('position').count;
    if(!material||source.drawRange.start!==0||source.drawRange.count<count||count%3||!count)return;
    const bounds=geometryBounds(candidate),height=bounds.max.y-bounds.min.y;
    if(bounds.isEmpty()||height<=0||height>.7)return;
    families.push({mesh:candidate,bounds,triangles:count/3,name:owner.name.replace(/_cell_-?\d+_-?\d+$/,''),material});
  });
  families.sort((a,b)=>a.triangles-b.triangles||a.name.localeCompare(b.name));const family=families[0];
  const land=valley.children.find(object=>object instanceof Mesh&&/outside village valley/.test(object.name))as Mesh|undefined;
  const water=valley.children.find(object=>object instanceof Mesh&&/regional river surface/.test(object.name))as Mesh|undefined;
  if(!land||!water)throw Error('River margin needs actual valley land and paired water geometry.');
  let attached=false;for(let current:Object3D|null=valley;current;current=current.parent)if(current===privateModel)attached=true;
  if(valley.parent&&!attached)throw Error('River valley belongs to a different source-model owner.');
  const inverseSurface=attached?inverseRoot:new Matrix4();
  function surface(mesh:Mesh):EaldholtWoodlandSurface{
    const positions=mesh.geometry.getAttribute('position'),data=new Float64Array(positions.count*3),frame=new Matrix4().multiplyMatrices(inverseSurface,mesh.matrixWorld);
    for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(frame);data[i*3]=point.x;data[i*3+1]=point.y;data[i*3+2]=point.z;}
    return{positions:data,indices:mesh.geometry.index?.array??Uint32Array.from({length:positions.count},(_,i)=>i)};
  }
  const outcrop=createEaldholtRiverOutcropBuffers(),stoneTarget=settings.stoneTarget,grassTarget=settings.grassTarget,stoneTriangles=outcrop.triangles;
  const maximumGrass=family?Math.max(0,Math.min(grassTarget,Math.floor((budget-stoneTarget*stoneTriangles)/family.triangles))):0;
  const grassRadius=family?Math.hypot(Math.max(Math.abs(family.bounds.min.x),Math.abs(family.bounds.max.x)),Math.max(Math.abs(family.bounds.min.y),Math.abs(family.bounds.max.y)),Math.max(Math.abs(family.bounds.min.z),Math.abs(family.bounds.max.z))):0;
  const placements=createEaldholtRiverMarginPlacements({land:surface(land),water:surface(water),village:{minX:village.min.x,maxX:village.max.x,minZ:village.min.z,maxZ:village.max.z},grassRadius,stoneRadius:outcrop.footprintRadius,maximumGrass,maximumStones:stoneTarget,profile});
  const object=new Group();object.name='House Ealdholt River Margin';
  const owned:InstancedMesh[]=[],bounds=new Box3(),matrix=new Matrix4(),rotation=new Quaternion(),alignment=new Quaternion(),normal=new Vector3(),up=new Vector3(0,1,0),scale=new Vector3();
  function instance(mesh:InstancedMesh,sourceBounds:Box3,list:EaldholtMarginPlacement[],grass:boolean){
    const box=new Box3();list.forEach((p,i)=>{
      rotation.setFromAxisAngle(up,p.yaw);
      normal.set(...p.normal);alignment.setFromUnitVectors(up,normal);rotation.premultiply(alignment);
      point.set(p.x,p.y,p.z).addScaledVector(normal,-sourceBounds.min.y*p.scale-(grass?.008:.12*p.scale));
      scale.setScalar(p.scale);matrix.compose(point,rotation,scale);mesh.setMatrixAt(i,matrix);box.union(sourceBounds.clone().applyMatrix4(matrix));
    });
    mesh.instanceMatrix.needsUpdate=true;mesh.boundingBox=box;mesh.boundingSphere=box.getBoundingSphere(new Sphere());mesh.castShadow=false;mesh.receiveShadow=true;object.add(mesh);owned.push(mesh);bounds.union(box);
  }
  if(family&&placements.grass.length){const mesh=new InstancedMesh(family.mesh.geometry,family.material,placements.grass.length);mesh.name='Ealdholt shore source grass';instance(mesh,family.bounds,placements.grass,true);}
  let pebble:BufferGeometry|null=null,pebbleMaterial:MeshStandardMaterial|null=null;
  if(placements.stones.length){
    pebble=new BufferGeometry();pebble.setAttribute('position',new BufferAttribute(outcrop.positions,3));pebble.setAttribute('normal',new BufferAttribute(outcrop.normals,3));pebble.setAttribute('uv',new BufferAttribute(outcrop.uv,2));pebble.setIndex(new BufferAttribute(outcrop.indices,1));
    const uv=pebble.getAttribute('uv');for(const name of ['uv1','uv2','uv3'])pebble.setAttribute(name,uv);
    pebbleMaterial=new MeshStandardMaterial({name:'Ealdholt original damp-bank outcrops',color:0xffffff,metalness:0,roughness:.94,map:rock?.albedo??null,normalMap:rock?.normal??null,roughnessMap:rock?.orm??null,metalnessMap:rock?.orm??null,aoMap:rock?.orm??null,aoMapIntensity:.8});pebbleMaterial.normalScale.set(.35,.35);
    const mesh=new InstancedMesh(pebble,pebbleMaterial,placements.stones.length);mesh.name='Ealdholt original three-form bank outcrops';instance(mesh,geometryBounds(mesh),placements.stones,false);
  }
  const triangles=placements.grass.length*(family?.triangles??0)+placements.stones.length*stoneTriangles;
  if(triangles>budget)throw Error('Whole river-margin family exceeded the triangle budget.');
  const grassBudgetLimited=!family||quest||maximumGrass<grassTarget;
  const limit=!family?'No complete bounded single-primitive source grass family; stones only.':grassBudgetLimited?'Whole source grass retained; profile budget and dry-bank support limit clump count.':null;
  object.userData.crownfallRiverMargin={wholeGrassFamily:true,sourceActorsUntouched:true,borrowedSourceGeometryAndMaps:true,grassInstanceCount:placements.grass.length,stoneInstanceCount:placements.stones.length,stoneFormsPerGroup:3,stoneTrianglesPerGroup:180};
  let disposed=false;
  return{object,triangles,drawCalls:owned.length,instanceCount:placements.grass.length+placements.stones.length,grassInstanceCount:placements.grass.length,stoneInstanceCount:placements.stones.length,
    sourceGrassFamily:family?.name??null,grassTrianglesPerClump:family?.triangles??0,grassBudgetLimited,limit,stoneFormsPerGroup:3,stoneTrianglesPerGroup:180,sourceRockFamily:null,ownedGeometryBytes:placements.stones.length?outcrop.byteLength:0,bounds:bounds.isEmpty()?null:{min:bounds.min.toArray()as[number,number,number],max:bounds.max.toArray()as[number,number,number]},
    dispose(){if(disposed)return;disposed=true;object.removeFromParent();for(const mesh of owned)mesh.dispose();object.clear();owned.length=0;pebble?.dispose();pebbleMaterial?.dispose();},
  };
}
