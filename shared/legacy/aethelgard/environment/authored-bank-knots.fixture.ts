import {createEaldholtCoastalValleyBuffers} from './coastal-valley';
import type {EaldholtTerrainEdges} from './river-valley';
/** Test-only recorded source-envelope facts from the existing source audit
 * (actual123-terrain-geometry-audit.json, SHA256 d11d19c893def3551086787e2b276f3346a0e80843aca53d5160ac683549daf6).
 * Channel positions depend on these bounds, never boundary terrain heights.
 * No GLB, scene, authored world replacement or render is created by this fixture. */
export function recordedEaldholtChannelSamples(profile:'desktop'|'quest'='desktop',edgeHeight=0):Float32Array{
 const e={minX:-50.3999977,maxX:63.73794049068675,minZ:-50.3999977,maxZ:101.7839352344893};
 const z=()=>[[e.minZ,edgeHeight],[e.maxZ,edgeHeight]]as const,x=()=>[[e.minX,edgeHeight],[e.maxX,edgeHeight]]as const;
 const edges:EaldholtTerrainEdges={...e,west:z(),east:z(),north:x(),south:x()};
 // Invoke the actual geometry generator, then retain only its immutable shape
 // samples. Unused CPU land buffers are not a scene or an asset.
 return createEaldholtCoastalValleyBuffers(edges,profile).shape.channelSamples;
}
