/** Draw-call reduction for the static source architecture. Runs after geometry compaction, so a
 * merged mesh holds exactly the triangles the separate meshes held. Merging the source's chunks
 * before compaction fails: GeoBuilder.toMesh quantises each chunk's positions to its own extent,
 * and compact.js clusters in those normalised units, so a larger chunk means a coarser cluster in
 * metres (see the quantised branch below).
 *
 * Only unmoving, opaque, single-material meshes are merged, by material and vertex layout: those
 * at the identity transform, and quantised chunks, whose translate-and-scale restores metres and
 * is baked in here. `bakeTransforms` also bakes any other placement: for modules that animate
 * nothing and shade in world space only, since aqueduct stone reads object coordinates and the
 * city moves its flames and boats. World-space shading sees the same positions either way.
 * `cell` keeps coarse spatial groups for profiles whose camera can move in close enough for
 * culling to matter, and `ignoreShadows` is for profiles with no shadow pass, where the flags
 * change nothing. */
export function mergeStaticMeshes(THREE,roots,{cell=Infinity,ignoreShadows=false,bakeTransforms=false,maxVertices=4e6,skip=()=>false}={}){
  const identity=new THREE.Matrix4().identity().elements,tolerance=1e-6;
  const isIdentity=matrix=>matrix.elements.every((value,index)=>Math.abs(value-identity[index])<tolerance);
  // translate and positive uniform scale, as GeoBuilder.toMesh produces
  const isQuantised=(geometry,matrix)=>{
    if(!geometry.getAttribute('position').normalized)return false;
    const e=matrix.elements;
    return e[0]>0&&Math.abs(e[0]-e[5])<tolerance*e[0]&&Math.abs(e[0]-e[10])<tolerance*e[0]&&[1,2,3,4,6,7,8,9,11].every(i=>Math.abs(e[i])<tolerance)&&Math.abs(e[15]-1)<tolerance;
  };
  // positions always merge as 32-bit metres, whatever each source stored
  const layoutOf=geometry=>Object.entries(geometry.attributes).filter(([name])=>name!=='position').sort(([a],[b])=>a<b?-1:1).map(([name,a])=>`${name}:${a.itemSize}:${a.array.constructor.name}:${a.normalized?1:0}`).join();
  const box=new THREE.Box3(),centre=new THREE.Vector3();
  const mergeable=mesh=>{
    if(!mesh.isMesh||mesh.isInstancedMesh||mesh.isBatchedMesh||mesh.isSkinnedMesh||skip(mesh))return false;
    const geometry=mesh.geometry,material=mesh.material;
    if(!geometry?.getAttribute('position')||geometry.isInstancedBufferGeometry||Array.isArray(material)||!material||material.isShaderMaterial)return false;
    if(material.transparent||material.depthWrite===false||mesh.frustumCulled===false||mesh.renderOrder!==0||mesh.visible===false||mesh.children.length||mesh.onBeforeRender!==THREE.Object3D.prototype.onBeforeRender)return false;
    if(mesh.morphTargetInfluences||Object.keys(geometry.morphAttributes??{}).length)return false;
    if(geometry.drawRange.start!==0||Number.isFinite(geometry.drawRange.count))return false;
    if(Object.values(geometry.attributes).some(a=>a.isInterleavedBufferAttribute||a.isInstancedBufferAttribute))return false;
    // Merged vertices are in world metres, so the mesh they join must sit at the identity too.
    if(!mesh.parent||!isIdentity(mesh.parent.matrixWorld))return false;
    if(isIdentity(mesh.matrixWorld)||isQuantised(geometry,mesh.matrixWorld))return true;
    return bakeTransforms&&Math.abs(mesh.matrixWorld.determinant())>1e-12;
  };
  const buckets=new Map(),users=new Map();
  for(const root of roots){
    root.updateMatrixWorld(true);
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      users.set(mesh.geometry,(users.get(mesh.geometry)??0)+1);
      if(!mergeable(mesh))return;
      let spatial='';
      if(Number.isFinite(cell)){
        const geometry=mesh.geometry;if(!geometry.boundingBox)geometry.computeBoundingBox();
        box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld).getCenter(centre);spatial=`|${Math.floor(centre.x/cell)},${Math.floor(centre.z/cell)}`;
      }
      const shadows=ignoreShadows?'':[mesh.castShadow,mesh.receiveShadow,mesh.customDepthMaterial?.uuid??'',mesh.customDistanceMaterial?.uuid??''].join('|');
      const key=[mesh.material.uuid,shadows,layoutOf(mesh.geometry)].join('|')+spatial;
      let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket=[]);bucket.push(mesh);
    });
  }
  let before=0,after=0;
  const out=[];
  for(const bucket of buckets.values()){
    if(bucket.length<2)continue;
    for(const part of splitByVertices(bucket,maxVertices)){
      if(part.length<2)continue;
      const geometry=concat(THREE,part),first=part[0];
      const merged=new THREE.Mesh(geometry,first.material);
      merged.name=`merged:${first.material.name||first.name}:${part.length}`;
      merged.castShadow=first.castShadow;merged.receiveShadow=first.receiveShadow;
      merged.userData.castShadow=first.userData.castShadow;merged.userData.receiveShadow=first.userData.receiveShadow;
      if(first.customDepthMaterial)merged.customDepthMaterial=first.customDepthMaterial;
      if(first.customDistanceMaterial)merged.customDistanceMaterial=first.customDistanceMaterial;
      const parent=first.parent;
      for(const mesh of part){
        mesh.removeFromParent();
        const left=users.get(mesh.geometry)-1;users.set(mesh.geometry,left);
        if(left===0)mesh.geometry.dispose();
      }
      parent.add(merged);out.push(merged);before+=part.length;after++;
    }
  }
  return {merged:out,before,after};
}
function splitByVertices(meshes,limit){
  const parts=[];let part=[],vertices=0;
  for(const mesh of meshes){
    const count=mesh.geometry.getAttribute('position').count;
    if(part.length&&vertices+count>limit){parts.push(part);part=[];vertices=0;}
    part.push(mesh);vertices+=count;
  }
  if(part.length)parts.push(part);
  return parts;
}
function concat(THREE,meshes){
  const geometries=meshes.map(mesh=>mesh.geometry),first=geometries[0],out=new THREE.BufferGeometry();
  let vertices=0,indices=0;
  for(const geometry of geometries){
    const count=geometry.getAttribute('position').count;
    vertices+=count;indices+=geometry.index?geometry.index.count:count;
  }
  const positions=new Float32Array(vertices*3),point=new THREE.Vector3();let written=0;
  for(const mesh of meshes){
    const source=mesh.geometry.getAttribute('position');
    for(let i=0;i<source.count;i++,written+=3){point.fromBufferAttribute(source,i).applyMatrix4(mesh.matrixWorld);positions[written]=point.x;positions[written+1]=point.y;positions[written+2]=point.z;}
  }
  out.setAttribute('position',new THREE.BufferAttribute(positions,3));
  for(const [name,attribute] of Object.entries(first.attributes)){
    if(name==='position')continue;
    const array=new attribute.array.constructor(vertices*attribute.itemSize);let offset=0;
    for(const geometry of geometries){const source=geometry.getAttribute(name);array.set(source.array.length===source.count*source.itemSize?source.array:source.array.subarray(0,source.count*source.itemSize),offset);offset+=source.count*source.itemSize;}
    out.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize,attribute.normalized));
  }
  const normals=out.getAttribute('normal');
  if(normals){
    const toWorld=new THREE.Matrix3();let base=0;
    for(const mesh of meshes){
      const count=mesh.geometry.getAttribute('position').count;
      const e=mesh.matrixWorld.elements,plain=[1,2,4,6,8,9].every(k=>Math.abs(e[k])<1e-9)&&e[0]>0&&Math.abs(e[0]-e[5])<1e-9*e[0]&&Math.abs(e[0]-e[10])<1e-9*e[0];
      if(plain){base+=count;continue;}// translate and uniform scale leave normals as they are
      toWorld.getNormalMatrix(mesh.matrixWorld);
      for(let i=base;i<base+count;i++){point.fromBufferAttribute(normals,i).applyMatrix3(toWorld).normalize();normals.setXYZ(i,point.x,point.y,point.z);}
      base+=count;
    }
  }
  const index=vertices>65535?new Uint32Array(indices):new Uint16Array(indices);
  let write=0,base=0;
  for(const mesh of meshes){
    const geometry=mesh.geometry,count=geometry.getAttribute('position').count,source=geometry.index?.array,n=source?geometry.index.count:count,mirrored=mesh.matrixWorld.determinant()<0;
    // A mirroring placement turns triangles over: swap two corners to keep them facing out.
    for(let i=0;i<n;i+=3){
      const a=(source?source[i]:i)+base,b=(source?source[i+1]:i+1)+base,c=(source?source[i+2]:i+2)+base;
      index[write++]=a;index[write++]=mirrored?c:b;index[write++]=mirrored?b:c;
    }
    base+=count;
  }
  out.setIndex(new THREE.BufferAttribute(index,1));
  out.computeBoundingBox();out.computeBoundingSphere();
  return out;
}
