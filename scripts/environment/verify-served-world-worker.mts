import {verifyServedWorldWorker} from './served-world-worker';
const values=process.argv.slice(2),option=(name:string,fallback:string)=>{const index=values.indexOf(name);return index<0?fallback:values[index+1]??fallback;};
const app=option('--app','desktop');if(app!=='desktop'&&app!=='native')throw Error('--app must be desktop or native.');
const result=await verifyServedWorldWorker({baseUrl:option('--url','http://127.0.0.1:4191'),repoRoot:option('--repo',process.cwd()),app});
console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
