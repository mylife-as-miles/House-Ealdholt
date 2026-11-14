import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createNpcDialogueHandler} from './handler';
import {createLocalDailyQuota} from './local-quota';

const MAX_INPUT=8192;
function localPort():number {const raw=process.env.NPC_AI_LOCAL_PORT??'8788';const value=Number(raw);if(!/^\d+$/.test(raw)||!Number.isInteger(value)||value<1024||value>65535)throw Error('Local port must be 1024–65535.');return value;}
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const TYPES:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.wasm':'application/wasm','.mp4':'video/mp4','.mp3':'audio/mpeg','.woff2':'font/woff2','.woff':'font/woff'};

/** Loopback-only demo. Do not expose this listener through a proxy or public tunnel. */
export async function startLocalNpcServer() {
  const port=localPort(),origin=`http://127.0.0.1:${port}`;
  const root=await realpath(resolve(ROOT,'main game/dist'));
  const rawLimit=process.env.NPC_AI_LOCAL_DAILY_LIMIT??'20';
  if(!/^\d+$/.test(rawLimit))throw Error('Invalid local daily limit.');
  const quota=createLocalDailyQuota(resolve(ROOT,'private-assets/npc-ai-local-quota.json'),Number(rawLimit));
  const provider=process.env.NPC_AI_PROVIDER==='near-ai'?'near-ai':process.env.NPC_AI_PROVIDER===undefined||process.env.NPC_AI_PROVIDER==='anthropic'?'anthropic':undefined;
  const key=provider==='near-ai'?process.env.NEARAI_API_KEY:provider==='anthropic'?process.env.ANTHROPIC_API_KEY:undefined;
  const handler=createNpcDialogueHandler({enabled:process.env.NPC_AI_ENABLED==='true',provider,apiKey:key,
    security:{authenticate:async()=>({id:'local-owner'}),consumeQuota:quota}});
  const server=createServer(async(req,res)=>{
    try {
      if(req.socket.remoteAddress!=='127.0.0.1'&&req.socket.remoteAddress!=='::1'&&req.socket.remoteAddress!=='::ffff:127.0.0.1'){res.writeHead(403).end();return;}
      if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
      const url=new URL(req.url??'/',origin);
      if(url.origin!==origin){res.writeHead(403).end();return;}
      if(url.pathname==='/api/npc-dialogue'){
        const chunks:Buffer[]=[];let size=0;
        for await(const raw of req){const chunk=Buffer.from(raw);size+=chunk.length;if(size>MAX_INPUT){res.writeHead(413).end();return;}chunks.push(chunk);}
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
        const response=await handler(new Request(url,{method:req.method??'GET',headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
        const outgoing:Record<string,string>={};response.headers.forEach((value,name)=>{outgoing[name]=value;});res.writeHead(response.status,outgoing);res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
      const pathname=decodeURIComponent(url.pathname),candidate=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
      if(candidate!==root&&!candidate.startsWith(root+sep)){res.writeHead(403).end();return;}
      let actual:string,info;try{actual=await realpath(candidate);if(actual!==root&&!actual.startsWith(root+sep)){res.writeHead(403).end();return;}info=await stat(actual);}catch{res.writeHead(404).end();return;}
      if(!info.isFile()){res.writeHead(404).end();return;}
      const headers:Record<string,string>={'content-type':TYPES[extname(actual).toLowerCase()]??'application/octet-stream','accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff'};
      let start=0,end=info.size-1,status=200;
      if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'content-range':`bytes */${info.size}`}).end();return;}if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0){res.writeHead(416,{'content-range':`bytes */${info.size}`}).end();return;}start=Math.max(0,info.size-suffix);}else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){res.writeHead(416,{'content-range':`bytes */${info.size}`}).end();return;}status=206;headers['content-range']=`bytes ${start}-${end}/${info.size}`;}
      headers['content-length']=String(end-start+1);res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}
      const stream=createReadStream(actual,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
    } catch {if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise<void>((resolvePromise,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolvePromise();});});
  return {server,origin};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){startLocalNpcServer().then(({origin})=>console.log(`Local House Ealdholt: ${origin} (never expose this server publicly)`)).catch(error=>{console.error((error as NodeJS.ErrnoException).code==='EADDRINUSE'?'Local port is already in use. Set NPC_AI_LOCAL_PORT to another loopback port.':'Could not start the local NPC server. Verify the production build and local quota settings.');process.exitCode=1;});}
