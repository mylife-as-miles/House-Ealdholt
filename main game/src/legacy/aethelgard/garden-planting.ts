import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, SkinnedMesh, Vector2, Vector3, type Material, type Object3D } from 'three';
import { isEaldholtPondProbeSurface } from '../../../../shared/legacy/aethelgard/environment/pond-probe';
import { qualifyEaldholtPondShore } from '../../../../shared/legacy/aethelgard/environment/pond-shore';
import { GARDEN_SPECIES, createGardenBotanicalGeometry, planEaldholtGarden, type GardenSpecies,
  type GardenProfile, type GardenFootprint, type GardenCanopy } from '../../../../shared/legacy/aethelgard/environment/garden-planting';
import { patchVegetationWind } from '../../../../shared/legacy/aethelgard/environment/vegetation-wind';

/** Source: solstice-garden 03f0aef9c0f032105c973b97005a482e639032f2,
 * MIT © 2026 SamG-Coder; shared/environment/LICENSE.solstice.txt. Botanical
 * profiles and bed tiers are adapted, never its terrain or absolute site plan. */
export interface EaldholtGardenPlantingStats {
  readonly qualified:boolean;readonly holdReason:string|null;readonly profile:GardenProfile;
  readonly plants:number;readonly species:Readonly<Partial<Record<GardenSpecies,number>>>;
  readonly drawCalls:number;readonly triangles:number;readonly bufferBytes:number;readonly terrainTriangles:number;
  readonly blockedFootprints:number;readonly rejected:Readonly<Record<string,number>>;
  readonly pond:{readonly bounds:{readonly min:readonly [number,number];readonly max:readonly [number,number]};readonly height:number;readonly area:number}|null;
  readonly water:ReturnType<typeof planEaldholtGarden>['water']|null;
}
export type GardenWind = {readonly direction:readonly [number,number];readonly strength:number}|readonly [number,number];
export interface EaldholtGardenPlanting {
  /** Parent under sourceRoot: all placements are in the source model's metres. */
  readonly object:Group;readonly stats:EaldholtGardenPlantingStats;readonly anchor:readonly [number,number,number]|null;
  update(animationSeconds:number,animated:boolean,wind?:GardenWind):void;dispose():void;
}
type Role='pond'|'terrain'|'tree'|'cover'|'obstacle'|'generated';
function role(mesh:Mesh,root:Object3D):Exclude<Role,'pond'> {
  // Ownership outranks a descendant's generic terrain/vegetation role. Far
  // surfaces can span kilometres and must never enter this local support grid.
  for(let p:Object3D|null=mesh;p&&p!==root;p=p.parent){
    if(p.userData.crownfallGardenDynamic===true||p.userData.crownfallGardenPlanting||p.userData.crownfallRiverValley||p.userData.crownfallRiverWoodland
      ||p.userData.crownfallRiverMargin||p.userData.crownfallWoodlandUnderstory||p.userData.crownfallWoodlandPrototype
      ||p.userData.crownfallFarSurround||p.userData.crownfallFarSurroundBridge||p.userData.crownfallFarWoodland||p.userData.crownfallRegionalHorizon
      ||p.userData.crownfallRegionalGroundcover||p.userData.crownfallRegionalRocks||p.userData.crownfallRegionalShrub||p.userData.crownfallRegionalLandmarks
      ||p.userData.crownfallAtmosphere)return 'generated';
  }
  for(let p:Object3D|null=mesh;p&&p!==root;p=p.parent){
    const kind=p.userData.crownfallElderbloom?.kind;
    if(/^LandscapeComponent_\d+(?:_\d+)?$/.test(p.name))return 'terrain';
    if(kind==='tree'||/BlackAlder|(?:^|[_ -])(?:tree|oak|birch|fir)(?:[_ -]|$)/i.test(p.name))return 'tree';
    if(kind==='groundcover'||/Grass_Clumps|(?:^|[_ -])flower[_ -]|SM_vmcob|SM_vgzte/i.test(p.name))return 'cover';
  }return 'obstacle';
}
function visible(mesh:Object3D,root:Object3D){for(let p:Object3D|null=mesh;p;p=p.parent){if(!p.visible)return false;if(p===root)break;}return true;}

/** Same complete-draw/instance/source-frame requirements as pond-shore.ts.
 * Extraction is private to this owner because the material treatment's helper
 * is intentionally private. All coordinates pass its existing qualification. */
function extract(root:Object3D){
  root.updateWorldMatrix(true,true);
  const rootDeterminant=root.matrixWorld.determinant();
  if(!root.matrixWorld.elements.every(Number.isFinite)||!Number.isFinite(rootDeterminant)||rootDeterminant<=0)throw Error('Garden source transform is unsupported.');
  const inverse=new Matrix4().copy(root.matrixWorld).invert(),frame=new Matrix4(),instance=new Matrix4(),point=new Vector3(),
    pond:number[]=[],terrain:number[]=[],blockers:GardenFootprint[]=[],canopies:GardenCanopy[]=[],sources:Mesh[]=[];
  root.traverse(o=>{if(o instanceof Mesh&&visible(o,root)&&role(o,root)!=='generated')sources.push(o);});
  for(const mesh of sources){
    const kind=role(mesh,root),materials=Array.isArray(mesh.material)?mesh.material:[mesh.material],
      pondSlots=materials.map(m=>isEaldholtPondProbeSurface(m)&&m.visible),land=kind==='terrain';
    if(kind==='cover'&&!pondSlots.some(Boolean))continue;
    if(mesh instanceof SkinnedMesh||mesh.morphTargetInfluences?.length||mesh.geometry.morphAttributes.position?.length
      ||(mesh as Mesh&{isBatchedMesh?:boolean}).isBatchedMesh){
      if(land||pondSlots.some(Boolean))throw Error('Garden requires static pond and Landscape support.');
      // Animated actors do not provide a stable conservative authored footprint.
      throw Error('Garden obstacle has no static authored footprint.');
    }
    const geometry=mesh.geometry,p=geometry.getAttribute('position'),index=geometry.index;
    if(!p||p.itemSize!==3||!Number.isSafeInteger(p.count))throw Error('Garden source requires finite drawn XYZ.');
    const count=index?.count??p.count,draw=geometry.drawRange,groups=Array.isArray(mesh.material)?geometry.groups:[{start:0,count,materialIndex:0}],
      offsets:{offset:number;pond:boolean;wood:boolean}[]=[],seen=new Set<number>();
    for(const group of groups){const material=materials[group.materialIndex??0];if(!material)throw Error('Garden source draw material is absent.');
      if(!material.visible)continue;
      const start=Math.max(0,draw.start,group.start),end=Math.min(count,draw.start+draw.count,group.start+group.count);
      if(end<=start)continue;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start%3||(end-start)%3)throw Error('Garden source needs complete drawn triangles.');
      const wood=material.alphaTest===0&&!material.transparent&&!(material as MeshStandardMaterial).alphaMap&&!/leaf|leaves|foliage|canopy/i.test(material.name);
      for(let offset=start;offset<end;offset+=3){if(seen.has(offset))throw Error('Garden source draw groups overlap.');seen.add(offset);offsets.push({offset,pond:pondSlots[group.materialIndex??0],wood});}}
    const actors=mesh instanceof InstancedMesh?mesh.count:1;
    if(!Number.isSafeInteger(actors)||actors<0||mesh instanceof InstancedMesh&&actors>mesh.instanceMatrix.count)throw Error('Garden instance draw exceeds capacity.');
    for(let actor=0;actor<actors;actor++){
      frame.multiplyMatrices(inverse,mesh.matrixWorld);if(mesh instanceof InstancedMesh){mesh.getMatrixAt(actor,instance);frame.multiply(instance);}
      const determinant=frame.determinant();
      if(!frame.elements.every(Number.isFinite)||!Number.isFinite(determinant)||determinant===0)
        throw Error('Garden source actor transform is unsupported ('+(mesh.name||'unnamed')+' instance '+actor+').');
      const box=new Box3();
      for(const {offset,pond:isPond} of offsets){const target=isPond?pond:land?terrain:null;
        // Three flips front-face orientation for a mirrored actor. Reproduce
        // that only in our private triangle copy so the existing qualifier
        // sees the authored upward cap; the source index/positions stay exact.
        for(let corner=0;corner<3;corner++){const drawCorner=determinant<0&&corner>0?3-corner:corner,id=index?index.getX(offset+drawCorner):offset+drawCorner;
          if(!Number.isSafeInteger(id)||id<0||id>=p.count)throw Error('Garden source draw index is invalid.');
          point.fromBufferAttribute(p,id).applyMatrix4(frame);if(!point.toArray().every(Number.isFinite))throw Error('Garden source draw contains nonfinite coordinates.');
          // Remove only inverse-presentation roundoff (ten nanometres). Exact
          // ties must choose the same canonical cap edge in Desktop and Native.
          point.set(Math.round(point.x*1e8)/1e8,Math.round(point.y*1e8)/1e8,Math.round(point.z*1e8)/1e8);
          if(target)target.push(point.x,point.y,point.z);else box.expandByPoint(point);}}
      if(box.isEmpty()||land)continue;
      if(kind==='tree'){
        const x=(box.min.x+box.max.x)/2,z=(box.min.z+box.max.z)/2,radius=Math.min(10,Math.max(box.max.x-box.min.x,box.max.z-box.min.z)*.5);
        canopies.push({x,z,radius});
        // Trunk contact is reserved from the actual lowest drawn wood, rather
        // than treating the broad crown's whole box as ground occupation.
        const baseBox=new Box3();
        for(const {offset,pond:isPond,wood} of offsets)if(!isPond&&wood)for(let corner=0;corner<3;corner++){
          const id=index?index.getX(offset+corner):offset+corner;point.fromBufferAttribute(p,id).applyMatrix4(frame);
          if(point.y<=box.min.y+.5)baseBox.expandByPoint(point);}
        // Separate alpha foliage supplies canopy shade, while only the actual
        // opaque wood contributes root occupation. Its leaf skirt is not a
        // second, broad ground obstacle that erases all shade planting.
        if(!baseBox.isEmpty())blockers.push({minX:baseBox.min.x-.3,maxX:baseBox.max.x+.3,minZ:baseBox.min.z-.3,maxZ:baseBox.max.z+.3});
      }else blockers.push({minX:box.min.x-.35,maxX:box.max.x+.35,minZ:box.min.z-.35,maxZ:box.max.z+.35});
    }
  }
  return{outline:qualifyEaldholtPondShore(pond),terrain,blockers,canopies};
}

/** Optional, bounded visual dressing. It never edits source buffers/materials,
 * terrain, water, colliders, navigation or resident state. */
export function createEaldholtGardenPlanting(sourceRoot:Object3D,options:{profile?:GardenProfile}={}):EaldholtGardenPlanting {
  const profile=options.profile??'desktop',object=new Group();object.name='Ealdholt source-supported garden planting';
  object.userData.crownfallGardenPlanting={version:1,profile,sourceGeometryUntouched:true};
  const ownedGeometries:BufferGeometry[]=[],ownedMaterials:MeshStandardMaterial[]=[],ownedInstances:InstancedMesh[]=[];
  const uniforms={cfEnvironmentToSource:{value:new Matrix4()},cfEnvironmentSeconds:{value:0},cfWindStrength:{value:0},cfWindDirection:{value:new Vector2(.8,.6)}};
  let disposed=false,lastAnimatedSeconds:number|null=null;
  const release=()=>{for(const mesh of ownedInstances)mesh.dispose();for(const g of ownedGeometries)g.dispose();for(const m of ownedMaterials)m.dispose();
    ownedInstances.length=0;ownedGeometries.length=0;ownedMaterials.length=0;object.clear();};
  let stats:EaldholtGardenPlantingStats,anchor:readonly [number,number,number]|null=null;
  try{
    const source=extract(sourceRoot),plan=planEaldholtGarden({...source,profile}),counts:Partial<Record<GardenSpecies,number>>={};
    let triangles=0,bufferBytes=0;const matrix=new Matrix4();
    for(const species of GARDEN_SPECIES){const plants=plan.placements.filter(p=>p.species===species);if(!plants.length)continue;
      const botanical=createGardenBotanicalGeometry(species),geometry=new BufferGeometry();ownedGeometries.push(geometry);
      geometry.setAttribute('position',new Float32BufferAttribute(botanical.positions,3));geometry.setAttribute('color',new Float32BufferAttribute(botanical.colours,3));
      geometry.setIndex(Array.from(botanical.indices));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const material=new MeshStandardMaterial({color:0xffffff,vertexColors:true,side:DoubleSide,roughness:species.endsWith('lily')?.48:.8,metalness:0});
      material.name='Garden botanical PBR '+species;ownedMaterials.push(material);
      // Preserve the regular PBR seams and prior hook so the existing world
      // environment/GI clones can wrap this material in their normal order.
      if(!species.endsWith('lily')){const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey;
        material.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);patchVegetationWind(shader,uniforms,{root:[0,0,0],tip:[0,botanical.height,0],grass:true});};
        material.customProgramCacheKey=()=>priorKey.call(material)+':garden-wind-v1:'+species;}
      const batch=new InstancedMesh(geometry,material,plants.length);ownedInstances.push(batch);batch.name='Garden '+species+' source-supported instances';
      batch.castShadow=false;batch.receiveShadow=true;
      batch.userData.crownfallGardenPlanting={version:1,species,instances:plants.length,sourceSupported:true};
      if(!species.endsWith('lily'))batch.userData.crownfallVegetationWind={root:[0,0,0],tip:[0,botanical.height,0],grass:true};
      for(let i=0;i<plants.length;i++){const p=plants[i];matrix.makeRotationY(p.yaw).scale(new Vector3(p.scale,p.scale,p.scale));matrix.setPosition(p.x,p.y,p.z);batch.setMatrixAt(i,matrix);}
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();batch.boundingBox?.expandByScalar(.2);
      if(batch.boundingSphere)batch.boundingSphere.radius+=.2;object.add(batch);counts[species]=plants.length;
      triangles+=botanical.triangles*plants.length;
      bufferBytes+=Object.values(geometry.attributes).reduce((sum,a)=>sum+a.array.byteLength,0)+(geometry.index?.array.byteLength??0)+batch.instanceMatrix.array.byteLength;
    }
    stats=Object.freeze({qualified:true,holdReason:null,profile,plants:plan.placements.length,species:Object.freeze(counts),drawCalls:object.children.length,
      triangles,bufferBytes,terrainTriangles:plan.terrainTriangles,blockedFootprints:source.blockers.length,rejected:plan.rejected,
      pond:Object.freeze({bounds:source.outline.bounds,height:source.outline.height,area:source.outline.metrics.projectedArea}),water:plan.water});
    const x=(source.outline.bounds.min[0]+source.outline.bounds.max[0])/2,z=(source.outline.bounds.min[1]+source.outline.bounds.max[1])/2;
    anchor=Object.freeze([x,source.outline.height,z] as const);
  }catch(error){release();stats=Object.freeze({qualified:false,holdReason:error instanceof Error?error.message:String(error),profile,plants:0,species:Object.freeze({}),
    drawCalls:0,triangles:0,bufferBytes:0,terrainTriangles:0,blockedFootprints:0,rejected:Object.freeze({}),pond:null,water:null});}
  object.userData.crownfallGardenPlanting.stats=stats;
  return{object,stats,anchor,update(animationSeconds,animated,wind){
    if(disposed)return;
    // The supplied existing clock owns pause/reduced-motion. No Date, elapsed
    // wall-clock accumulator, timers, per-frame allocation or scene mutation.
    sourceRoot.updateWorldMatrix(true,false);const frame=sourceRoot.matrixWorld;
    const determinant=frame.determinant();
    if(!frame.elements.every(Number.isFinite)||!Number.isFinite(determinant)||determinant<=0){uniforms.cfWindStrength.value=0;return;}
    uniforms.cfEnvironmentToSource.value.copy(frame).invert();
    if(!animated||!Number.isFinite(animationSeconds)||lastAnimatedSeconds===animationSeconds)return;lastAnimatedSeconds=animationSeconds;
    uniforms.cfEnvironmentSeconds.value=animationSeconds;
    let x=.8,z=.6,strength=.3;
    if(wind){if('direction'in wind){x=wind.direction[0];z=wind.direction[1];strength=wind.strength;}
      else{x=wind[0];z=wind[1];strength=Math.min(1,Math.hypot(x,z)/5);}}
    const length=Math.hypot(x,z);if(!Number.isFinite(length)||!Number.isFinite(strength)||length<1e-8){uniforms.cfWindStrength.value=0;return;}
    uniforms.cfWindDirection.value.set(x/length,z/length);uniforms.cfWindStrength.value=Math.max(0,Math.min(1,strength));
  },dispose(){if(disposed)return;disposed=true;uniforms.cfWindStrength.value=0;object.removeFromParent();release();}};
}
