/** Original render-only contact shading for the source estate. One instanced
 * draw, no geometry/placement collision, shadow render target or house state. */
export function createEstateContact(T:any,buildings:readonly {x:number;z:number;width:number;depth:number;yaw:number}[],trees:readonly {x:number;z:number;scale:number}[],groundAt:(x:number,z:number)=>number){
 const size=48,data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),alpha=Math.pow(Math.max(0,1-d),1.5);const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(alpha*255);}
 const texture=new T.DataTexture(data,size,size,T.RGBAFormat);texture.needsUpdate=true;texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;
 const material=new T.MeshBasicMaterial({map:texture,color:'#382d21',opacity:.4,transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 const geometry=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),mesh=new T.InstancedMesh(geometry,material,buildings.length+trees.length),matrix=new T.Object3D();let index=0;
 for(const item of buildings){matrix.position.set(item.x,groundAt(item.x,item.z)+.055,item.z);matrix.rotation.y=item.yaw;matrix.scale.set(item.width*1.35,1,item.depth*1.35);matrix.updateMatrix();mesh.setMatrixAt(index++,matrix.matrix);}
 for(const item of trees){matrix.position.set(item.x,groundAt(item.x,item.z)+.045,item.z);matrix.rotation.y=0;matrix.scale.set(2.5*item.scale,1,2.5*item.scale);matrix.updateMatrix();mesh.setMatrixAt(index++,matrix.matrix);}
 mesh.name='Original estate ground contact';mesh.instanceMatrix.needsUpdate=true;mesh.renderOrder=1;mesh.raycast=()=>{};mesh.userData.sourceAsset={repository:'Crownfall original rendering',generator:'radial contact shading'};
 return{root:mesh,dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();texture.dispose();}};
}
