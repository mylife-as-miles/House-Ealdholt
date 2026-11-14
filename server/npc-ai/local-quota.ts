import {mkdir, open, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Local-demo, single-process global cap. Public deployments need an authenticated,
 * atomic shared quota service, not this filesystem implementation. */
export function createLocalDailyQuota(file:string,limit:number,now:()=>Date=()=>new Date()) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Local daily limit must be between 1 and 100.');
  let queue:Promise<void>=Promise.resolve();
  return async():Promise<boolean>=>{
    let result=false;
    const current=queue.then(async()=>{
      await mkdir(dirname(file),{recursive:true,mode:0o700});
      const lockPath=`${file}.lock`;let lock:Awaited<ReturnType<typeof open>>|null=null;
      for(let attempt=0;attempt<50;attempt++){try{lock=await open(lockPath,'wx',0o600);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await new Promise(resolve=>setTimeout(resolve,10));}}
      if(!lock)throw Error('Local quota is busy; requests are held.');
      try {
      const time=now(),day=time.toISOString().slice(0,10),window=Math.floor(time.getTime()/60000);let record:{day:string;used:number;window:number;windowUsed:number}|null=null;
      try {
        const raw:unknown=JSON.parse(await readFile(file,'utf8'));
        if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Bad quota');
        const value=raw as Record<string,unknown>;
        if(Object.keys(value).length!==4||typeof value.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.used)||(value.used as number)<0||(value.used as number)>100||!Number.isSafeInteger(value.window)||(value.window as number)<0||!Number.isSafeInteger(value.windowUsed)||(value.windowUsed as number)<0||(value.windowUsed as number)>5)throw Error('Bad quota');
        record={day:value.day,used:value.used as number,window:value.window as number,windowUsed:value.windowUsed as number};
      } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Local quota state is invalid; requests are held.');}
      if(record&&(record.day>day||record.window>window))throw Error('Local quota clock is behind recorded state; requests are held.');
      const used=record?.day===day?record.used:0,windowUsed=record?.window===window?record.windowUsed:0;if(used>=limit||windowUsed>=5)return;
      const temp=`${file}.${randomUUID()}.tmp`;
      try{await writeFile(temp,JSON.stringify({day,used:used+1,window,windowUsed:windowUsed+1}),{flag:'wx',mode:0o600});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
      result=true;
      } finally {await lock.close();await unlink(lockPath);}
    });
    queue=current.catch(()=>{});await current;return result;
  };
}
