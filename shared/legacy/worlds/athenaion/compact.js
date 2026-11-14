/** Vertex clustering LOD for the original scene geometry. Removes sub-pixel
 * mouldings rather than removing buildings, terrain or authored placements.
 * Attribute averages preserve source auxiliary material/UV channels. */
export function createGeometryCompactor(THREE,profile,{preserveNormalCreases=false}={}){
  const cache=new Map();
  return function compact(geometry,name=''){
    // Thousands of sub-pixel balusters keep every authored placement but use a
    // bounded solid post in the miniature; the continuous rails stay original.
    if(/weeds/i.test(name)&&profile==='quest'){
      const key='weeds:'+geometry.uuid;if(cache.has(key))return cache.get(key);
      geometry.computeBoundingBox();const box=geometry.boundingBox,c=box.getCenter(new THREE.Vector3()),h=box.max.y-box.min.y;
      const out=new THREE.BufferGeometry();
      out.setAttribute('position',new THREE.Float32BufferAttribute([box.min.x,box.min.y,c.z,box.max.x,box.min.y,c.z,c.x,box.min.y+h,c.z,c.x,box.min.y,box.min.z,c.x,box.min.y,box.max.z,c.x,box.min.y+h,c.z],3));out.computeVertexNormals();
      for(const [attribute,a]of Object.entries(geometry.attributes))if(!out.getAttribute(attribute)&&!a.isInstancedBufferAttribute){const values=new Float32Array(6*a.itemSize);for(let i=0;i<values.length;i++)values[i]=a.getComponent(0,i%a.itemSize);out.setAttribute(attribute,new THREE.BufferAttribute(values,a.itemSize));}
      cache.set(key,out);return out;
    }
    if(/baluster/i.test(name)&&profile==='quest'){
      const key='baluster:'+geometry.uuid;if(cache.has(key))return cache.get(key);
      geometry.computeBoundingBox();const bb=geometry.boundingBox,size=bb.getSize(new THREE.Vector3()),center=bb.getCenter(new THREE.Vector3());
      const post=new THREE.BoxGeometry(size.x,size.y,size.z).translate(center.x,center.y,center.z);post.clearGroups();
      for(const [attribute,a]of Object.entries(geometry.attributes))if(!post.getAttribute(attribute)&&!a.isInstancedBufferAttribute){const out=new Float32Array(post.getAttribute('position').count*a.itemSize);for(let i=0;i<out.length;i++)out[i]=a.getComponent(0,i%a.itemSize);post.setAttribute(attribute,new THREE.BufferAttribute(out,a.itemSize));}
      cache.set(key,post);return post;
    }
    // Desktop keeps turned balusters, with the rings a metre-tall part can show at landmark distance.
    if(/baluster/i.test(name)&&profile==='desktop'){
      const key='baluster:'+geometry.uuid;if(cache.has(key))return cache.get(key);
      const p=geometry.getAttribute('position');geometry.computeBoundingBox();const bb=geometry.boundingBox,cx=(bb.min.x+bb.max.x)/2,cz=(bb.min.z+bb.max.z)/2;
      const levels=new Map();for(let i=0;i<p.count;i++){const y=Math.round(p.getY(i)*1e4)/1e4;levels.set(y,Math.max(levels.get(y)??0,Math.hypot(p.getX(i)-cx,p.getZ(i)-cz)));}
      const profileRings=[...levels.entries()].sort((a,b)=>a[0]-b[0]);
      // Keep the ends and the rings where the outline turns most.
      const keep=new Set([0,profileRings.length-1]);
      while(keep.size<6&&keep.size<profileRings.length){
        const ordered=[...keep].sort((a,b)=>a-b);let bestRing=-1,bestError=-1;
        for(let s=0;s<ordered.length-1;s++){const[a,b]=[ordered[s],ordered[s+1]];for(let i=a+1;i<b;i++){const t=(profileRings[i][0]-profileRings[a][0])/(profileRings[b][0]-profileRings[a][0]||1),error=Math.abs(profileRings[i][1]-(profileRings[a][1]+(profileRings[b][1]-profileRings[a][1])*t));if(error>bestError){bestError=error;bestRing=i;}}}
        if(bestRing<0)break;keep.add(bestRing);
      }
      const rings=[...keep].sort((a,b)=>a-b).map(i=>profileRings[i]),sides=6,positions=[],indices=[];
      for(const[y,r]of rings)for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2;positions.push(cx+Math.cos(a)*r,y,cz+Math.sin(a)*r);}
      for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){const a=j*sides+i,b=j*sides+(i+1)%sides;indices.push(a,a+sides,b,b,a+sides,b+sides);}
      const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));out.setIndex(indices);out.computeVertexNormals();
      const count=out.getAttribute('position').count;
      for(const [attribute,a]of Object.entries(geometry.attributes))if(!out.getAttribute(attribute)&&!a.isInstancedBufferAttribute){const values=new Float32Array(count*a.itemSize);for(let i=0;i<values.length;i++)values[i]=a.getComponent(0,i%a.itemSize);out.setAttribute(attribute,new THREE.BufferAttribute(values,a.itemSize));}
      out.computeBoundingBox();out.computeBoundingSphere();cache.set(key,out);return out;
    }
    if(cache.has(geometry))return cache.get(geometry);
    const position=geometry.getAttribute('position');
    if(!position||position.count<24){const result=preserveNormalCreases?repairInvalidNormals(THREE,geometry):geometry;cache.set(geometry,result);return result;}
    geometry.computeBoundingBox();const box=geometry.boundingBox;
    const span=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z);
    const cell=profile==='quest'?Math.max(.06,Math.min(1.2,span/28)):Math.max(.015,Math.min(.35,span/90));
    const attrs=Object.entries(geometry.attributes).filter(([,a])=>!a.isInstancedBufferAttribute&&a.count===position.count);
    const map=new Map(),remap=new Uint32Array(position.count),sums=Object.fromEntries(attrs.map(([name])=>[name,[]])),counts=[];
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      // Thin opposing faces may share a position cell, but must never average
      // their normals to zero. Coarse directional sectors also retain actual
      // hard edges while allowing same-surface microgeometry to simplify.
      const normal=geometry.getAttribute('normal'),sector=preserveNormalCreases&&normal?`,n${Math.round(normal.getX(i)*2)},${Math.round(normal.getY(i)*2)},${Math.round(normal.getZ(i)*2)}`:'';
      const key=`${Math.round(x/cell)},${Math.round(y/cell)},${Math.round(z/cell)}${sector}`;
      let index=map.get(key);
      if(index===undefined){index=map.size;map.set(key,index);counts.push(0);for(const [name,a]of attrs)for(let c=0;c<a.itemSize;c++)sums[name].push(0);}
      remap[i]=index;counts[index]++;
      for(const [name,a]of attrs)for(let c=0;c<a.itemSize;c++)sums[name][index*a.itemSize+c]+=a.getComponent(i,c);
    }
    const source=geometry.index?.array,faces=source?.length??position.count,indices=[],groups=[];
    for(const group of geometry.groups.length?geometry.groups:[{start:0,count:faces,materialIndex:0}]){
      const start=indices.length;
      for(let i=group.start;i<Math.min(faces,group.start+group.count);i+=3){const a=remap[source?source[i]:i],b=remap[source?source[i+1]:i+1],c=remap[source?source[i+2]:i+2];if(a!==b&&b!==c&&a!==c)indices.push(a,b,c);}
      if(geometry.groups.length)groups.push({start,count:indices.length-start,materialIndex:group.materialIndex});
    }
    if(indices.length>=faces*.98){const result=preserveNormalCreases?repairInvalidNormals(THREE,geometry):geometry;cache.set(geometry,result);return result;}
    const out=new THREE.BufferGeometry();
    for(const [name,a]of attrs){
      const array=new Float32Array(sums[name]);for(let i=0;i<counts.length;i++)for(let c=0;c<a.itemSize;c++)array[i*a.itemSize+c]/=counts[i];
      if(name==='normal')for(let i=0;i<array.length;i+=3){const length=Math.hypot(array[i],array[i+1],array[i+2])||1;array[i]/=length;array[i+1]/=length;array[i+2]/=length;}
      out.setAttribute(name,new THREE.BufferAttribute(array,a.itemSize));
    }
    out.setIndex(indices);for(const group of groups)out.addGroup(group.start,group.count,group.materialIndex);out.computeBoundingBox();out.computeBoundingSphere();const result=preserveNormalCreases?repairInvalidNormals(THREE,out):out;if(result!==out)out.dispose();cache.set(geometry,result);cache.set(result,result);return result;
  };
}

/** A valid adjacent geometric face supplies the normal for a degenerate input
 * frame. Choose its largest-area face rather than cancelling opposing faces. */
export function repairInvalidNormals(THREE,geometry){
 const normal=geometry.getAttribute('normal'),position=geometry.getAttribute('position');if(!normal||!position)return geometry;
 const invalid=[];for(let i=0;i<normal.count;i++){const length=Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i));if(!Number.isFinite(length)||length<1e-10)invalid.push(i);}if(!invalid.length)return geometry;
 const result=geometry.clone(),out=result.getAttribute('normal'),wanted=new Set(invalid),best=new Map(),index=geometry.index?.array,count=index?.length??position.count,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3();
 for(let i=0;i<count;i+=3){const ids=[index?index[i]:i,index?index[i+1]:i+1,index?index[i+2]:i+2];if(!ids.some(id=>wanted.has(id)))continue;a.fromBufferAttribute(position,ids[0]);b.fromBufferAttribute(position,ids[1]).sub(a);c.fromBufferAttribute(position,ids[2]).sub(a);cross.crossVectors(b,c);const area=cross.lengthSq();if(!Number.isFinite(area)||area<1e-20)continue;for(const id of ids)if(wanted.has(id)&&area>(best.get(id)?.area??0))best.set(id,{area,normal:cross.clone().normalize()});}
 for(const id of invalid){const n=best.get(id)?.normal??new THREE.Vector3(0,1,0);out.setXYZ(id,n.x,n.y,n.z);}return result;
}
