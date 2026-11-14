// Crownfall runtime adapter over Athenaion's original terrain plan + surface-net mesher.
// No generated-file fetches or film-camera cache assumptions. Source geography is retained.
import * as THREE from 'crownfall-world-three';
import { planChunks, planSiteChunks } from '../terrain/lod.js';
import { groupResults, packGroups, unpackGroups } from '../terrain/meshpack.js';
import { groupGeometry } from '../terrain/meshgeo.js';
import { MeshPool } from '../terrain/pool.js';
import { terrainMaterial, TERRAIN_UNIFORMS } from '../terrain/material.js';
import { SHOTS } from '../world/shots.js';
import * as L from '../world/layout.js';
import { WEST_CRAG, HILLTOPS, MOUNT_NOTCH } from '../world/heightfield.js';
export async function build(engine) {
  const quest=engine.crownfallProfile==='quest';
  const leaves=quest?planSiteChunks({rootSize:16384,center:[0,-4096],site:[15,20],floor:8,ratio:16,maxCell:256}):planChunks([SHOTS[0],SHOTS[2],SHOTS[6]],{rootSize:16384,center:[0,-4096],K:8,coarseFactor:4,minCell:1,nearMinCell:1,maxCell:256});
  const pool=new MeshPool(2);
  let results;
  try {results=await Promise.all(leaves.map(l=>pool.run({x0:l.x0,z0:l.z0,n:l.n,cell:l.cell,ext:1})));}
  finally {pool.dispose();}
  const groups=unpackGroups(packGroups(groupResults(leaves,results)));
  // Quest's sparse trees leave the far bare-ground patches exposed as pale flecks across the plain.
  TERRAIN_UNIFORMS.uTBare.value=quest?.3:1;
  const material=terrainMaterial(),root=new THREE.Group();root.name='athenaion-terrain';
  for(const g of groups){const mesh=new THREE.Mesh(groupGeometry(g),material);mesh.name='terrain:'+g.key;mesh.castShadow=g.cell<=8;mesh.receiveShadow=true;root.add(mesh);}
  engine.add(root);
  engine.registry.terrain={root,material,groups:groups.length,sites:{templeMount:{center:L.HILL_TEMPLE.center,top:L.HILL_TEMPLE.top,summitRadius:48,notch:MOUNT_NOTCH},westCrag:{center:WEST_CRAG.center,top:WEST_CRAG.top},hilltops:HILLTOPS.map(t=>({center:t.c,top:t.top,radius:t.rf}))}};
}
