/** Adapted from SamG-Coder/solstice-garden, copyright (c) 2026 SamG-Coder, MIT.
 * Pinned 03f0aef9c0f032105c973b97005a482e639032f2:
 * crates/solstice-render/particles/{motes,fireflies}.particles;
 * shaders/particles/common.wgsl; shaders/common/{noise,math}.wgsl.
 * Full notice: ./LICENSE.solstice.txt. Fixed pools replace the source GPU emitter;
 * the flash curve, curl field and exact drag integration below retain its math.
 */
export interface GardenLifeFrame {
  readonly animationSeconds: number;
  readonly daylight: number;
  readonly wind: readonly [number, number];
  readonly windStrength: number;
  readonly reducedMotion: boolean;
  readonly rain?: number;
  readonly active?: boolean;
  readonly paused?: boolean;
}

export const GARDEN_PARTICLE_SOURCE = 'SamG-Coder/solstice-garden@03f0aef9c0f032105c973b97005a482e639032f2';
export const GARDEN_FIREFLY_FLASHES = [0,0,.05,1,.11,0,.27,0,.32,1,.4,0,.55,0,.6,1,.66,0,.83,0,.88,1,.95,0,1,0] as const;
export const clampGardenUnit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function gardenSmooth(a: number, b: number, n: number) { const t = clampGardenUnit((n-a)/(b-a)); return t*t*(3-2*t); }
export function solsticeFireflyFlash(age: number) {
  const t = clampGardenUnit(age);
  for (let i=2; i<GARDEN_FIREFLY_FLASHES.length; i+=2) {
    const right=GARDEN_FIREFLY_FLASHES[i];
    if (t<=right) { const left=GARDEN_FIREFLY_FLASHES[i-2], a=GARDEN_FIREFLY_FLASHES[i-1], b=GARDEN_FIREFLY_FLASHES[i+1]; return a+(b-a)*(t-left)/(right-left); }
  }
  return 0;
}
export function solsticePcg(value: number) {
  const state=(Math.imul(value,747796405)+2891336453)>>>0;
  const word=Math.imul((state>>>((state>>>28)+4))^state,277803737)>>>0;
  return ((word>>>22)^word)>>>0;
}
function unit(value: number) { return (solsticePcg(value)>>>8)/16777216; }

/** Source gradient_noise's value and analytic derivative; no temporary vectors. */
export function solsticeGradientNoise(x:number,y:number,z:number,seed:number,out:Float64Array) {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
  const ux=fx*fx*fx*(fx*(fx*6-15)+10),uy=fy*fy*fy*(fy*(fy*6-15)+10),uz=fz*fz*fz*(fz*(fz*6-15)+10);
  const dx=fx*fx*30*(fx*(fx-2)+1),dy=fy*fy*30*(fy*(fy-2)+1),dz=fz*fz*30*(fz*(fz-2)+1);
  out.fill(0);
  for (let k=0;k<8;k++) {
    const a=k&1,b=(k>>>1)&1,c=(k>>>2)&1;
    const h=solsticePcg((ix+a+solsticePcg((iy+b+solsticePcg((iz+c+seed)>>>0))>>>0))>>>0);
    const gx=unit(h)*2-1,gy=unit(solsticePcg(h))*2-1,gz=unit(solsticePcg(solsticePcg(h)))*2-1;
    const value=gx*(fx-a)+gy*(fy-b)+gz*(fz-c),wx=a?ux:1-ux,wy=b?uy:1-uy,wz=c?uz:1-uz,w=wx*wy*wz;
    out[0]+=value*w;
    out[1]+=gx*w+value*(a?dx:-dx)*wy*wz;
    out[2]+=gy*w+value*wx*(b?dy:-dy)*wz;
    out[3]+=gz*w+value*wx*wy*(c?dz:-dz);
  }
}

export function createGardenParticlePool(kind:'motes'|'fireflies',count:number,seed:number) {
  const fireflies=kind==='fireflies',positions=new Float32Array(count*3),velocities=new Float32Array(count*3);
  const ages=new Float32Array(count),lifetimes=new Float32Array(count),sizes=new Float32Array(count),alpha=new Float32Array(count);
  const a=new Float64Array(4),b=new Float64Array(4),c=new Float64Array(4);
  let randomState=seed>>>0,previous:number|undefined;
  const random=()=>{randomState=solsticePcg(randomState);return unit(randomState);};
  function spawn(i:number,initial=false) {
    const j=i*3;
    positions[j]=(random()-.5)*(fireflies?56:46);positions[j+1]=(random()-.5)*(fireflies?1.5:5)+(fireflies?1:3);positions[j+2]=(random()-.5)*(fireflies?48:38);
    lifetimes[i]=(fireflies?20:24)+random()*8;ages[i]=initial?random()*lifetimes[i]:0;
    sizes[i]=(fireflies?.012:.003)+random()*(fireflies?.008:.004);
    // Source's cone=180 is a sphere; motes cone=90 is an upward hemisphere.
    const cosTheta=fireflies?1-2*random():random(),sinTheta=Math.sqrt(Math.max(0,1-cosTheta*cosTheta)),phi=random()*Math.PI*2;
    const speed=(fireflies?.12:.03)*(1+(random()*2-1)*(fireflies?.6:.8));
    velocities[j]=Math.cos(phi)*sinTheta*speed;velocities[j+1]=cosTheta*speed;velocities[j+2]=Math.sin(phi)*sinTheta*speed;
  }
  for(let i=0;i<count;i++)spawn(i,true);
  return {positions,sizes,alpha,count,
    update(frame:GardenLifeFrame,moving:boolean) {
      const now=Number.isFinite(frame.animationSeconds)?frame.animationSeconds:0;
      const elapsed=previous===undefined?0:now-previous;previous=moving?now:undefined;
      // Clock seeks and resume do not replay missed particle work.
      const seconds=moving&&elapsed>0&&elapsed<=.25?elapsed:0,steps=Math.max(1,Math.ceil(seconds/(1/30))),h=seconds/steps;
      const drag=fireflies?.8:1.5,decay=Math.exp(-drag*h),f=(1-decay)/drag,g=(h-f)/drag;
      for(let i=0;i<count;i++) {
        const j=i*3;
        for(let s=0;s<steps&&seconds>0;s++) {
          const time=now-seconds+s*h,x=positions[j],y=positions[j+1],z=positions[j+2],scale=fireflies?1.6:3,change=fireflies?.35:.15;
          solsticeGradientNoise(x/scale+time*change,y/scale+time*change,z/scale+time*change,0x68bc21eb,a);
          solsticeGradientNoise(x/scale+time*change,y/scale+time*change,z/scale+time*change,0x02e5be93,b);
          solsticeGradientNoise(x/scale+time*change,y/scale+time*change,z/scale+time*change,0x967a889b,c);
          const curl=fireflies?.3:.1;
          let mx=(c[2]-b[3])*curl,my=(a[3]-c[1])*curl,mz=(b[1]-a[2])*curl;
          if(!fireflies) {
            solsticeGradientNoise(x*.02+time*.3,y*.02,z*.02,0x1b873593,a);
            const speed=Math.log(Math.max(y,.5)/.03)/Math.log(10/.03)*(1+.3*a[0])*.5*clampGardenUnit(frame.windStrength);
            mx+=frame.wind[0]*speed;mz+=frame.wind[1]*speed;
          }
          const ax=mx*drag,ay=my*drag,az=mz*drag;
          positions[j]+=velocities[j]*f+ax*g;positions[j+1]+=velocities[j+1]*f+ay*g;positions[j+2]+=velocities[j+2]*f+az*g;
          velocities[j]=velocities[j]*decay+ax*f;velocities[j+1]=velocities[j+1]*decay+ay*f;velocities[j+2]=velocities[j+2]*decay+az*f;
        }
        ages[i]+=seconds;if(ages[i]>=lifetimes[i])spawn(i);
        const t=ages[i]/lifetimes[i];alpha[i]=fireflies?solsticeFireflyFlash(t):Math.min(1,t/.08,(1-t)/.08)*.9;
      }
      return seconds>0;
    }
  };
}
