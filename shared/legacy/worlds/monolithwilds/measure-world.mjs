// CPU generation only. GPU-only offscreen texture bakes are no-ops, so this
// measures geometry/resources, not pixels, frame rate, comfort or shader validity.
import { registerHooks } from 'node:module';
import { writeFile } from 'node:fs/promises';
if(!process.env.CROWNFALL_THREE_MODULE)throw Error('Set CROWNFALL_THREE_MODULE');
registerHooks({resolve(s,c,n){return n(s==='crownfall-world-three'?process.env.CROWNFALL_THREE_MODULE:s,c);}});
const THREE=await import('crownfall-world-three');
globalThis.window={location:{search:''},innerHeight:480};globalThis.location=window.location;
const renderer={domElement:{width:640,height:480},coordinateSystem:THREE.WebGLCoordinateSystem,xr:{enabled:false},shadowMap:{autoUpdate:false},capabilities:{isWebGL2:true},toneMappingExposure:1,autoClear:true,getContext(){return{getExtension:()=>null,RENDERER:0,getParameter:()=> 'CPU geometry measurement'};},getDrawingBufferSize(v){return v.set(640,480);},getRenderTarget(){return null;},setRenderTarget(){},getActiveCubeFace(){return 0;},getActiveMipmapLevel(){return 0;},render(){},getClearColor(c){return c.set(0);},getClearAlpha(){return 1;},setClearColor(){},clear(){},readRenderTargetPixels(_r,_x,_y,_w,_h,data){data.fill(0);}};
const {buildWorld}=await import('./build.js');const profile=process.argv[2]||'quest';const start=performance.now();
const world=await buildWorld({THREE,scene:new THREE.Scene(),renderer,camera:new THREE.PerspectiveCamera(55,4/3,.1,30000),profile,nationId:'korvenia',onProgress:(p,id)=>console.log(`${Math.round(p*100)}% ${id}`)});
const report={profile,buildMs:Math.round(performance.now()-start),...world.sourceStats(),lod:world.lodReport,modules:world.builtModules,limits:'CPU geometry only; offscreen GPU texture bakes stubbed. No rendered-image, headset FPS or comfort pass.'};console.log(JSON.stringify(report,null,2));if(process.env.CROWNFALL_WORLD_REPORT)await writeFile(process.env.CROWNFALL_WORLD_REPORT,JSON.stringify(report,null,2)+'\n');world.dispose();
