/** Transport rejected/future JSON without applying a current feature's schema
 * limits. This does not validate or activate it. Use an iterative plain-data
 * copy so deep/large future fields survive beside unrelated save progress,
 * while accessors, cycles and non-JSON objects never execute during saving. */
export function copyObserverJSON(value:unknown):unknown {
  type Frame={input:object;output:any;keys:readonly string[];index:number};
  const active=new WeakSet<object>(),stack:Frame[]=[];
  function allocate(input:unknown):unknown {
    if(input===null||typeof input==='string'||typeof input==='boolean'||typeof input==='number'&&Number.isFinite(input))return input;
    if(!input||typeof input!=='object')throw Error('Preserved observer fields must contain finite JSON data.');
    if(active.has(input))throw Error('Preserved observer fields cannot contain cycles.');
    const array=Array.isArray(input),prototype=Object.getPrototypeOf(input);
    if(prototype!==(array?Array.prototype:Object.prototype)&&prototype!==null)throw Error('Preserved observer records must be plain JSON data.');
    const ownKeys=Reflect.ownKeys(input),keys:string[]=[];
    if(array&&ownKeys.length!==(input as unknown[]).length+1)throw Error('Preserved JSON arrays cannot contain holes/extra fields.');
    for(const key of ownKeys){
      if(array&&key==='length')continue;
      if(typeof key!=='string')throw Error('Preserved JSON cannot contain symbol keys.');
      if(array&&(!/^(0|[1-9]\d*)$/u.test(key)||Number(key)>=(input as unknown[]).length))throw Error('Preserved JSON arrays cannot contain extra fields.');
      const descriptor=Object.getOwnPropertyDescriptor(input,key)!;
      if(!descriptor.enumerable||!('value'in descriptor))throw Error('Preserved JSON cannot contain accessors/non-enumerable fields.');
      keys.push(key);
    }
    const output=array?[]:{};active.add(input);stack.push({input,output,keys,index:0});return output;
  }
  const output=allocate(value);
  while(stack.length){
    const frame=stack[stack.length-1];
    if(frame.index===frame.keys.length){active.delete(frame.input);stack.pop();continue;}
    const key=frame.keys[frame.index++],descriptor=Object.getOwnPropertyDescriptor(frame.input,key)!;
    const child=allocate(descriptor.value);
    Object.defineProperty(frame.output,key,{value:child,enumerable:true,writable:true,configurable:true});
  }
  return output;
}
