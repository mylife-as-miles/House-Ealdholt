/** Bounded CPU port of the combustion techniques in Leon Lin's MIT
 * procedural-fire/src/sim.js (95ab0a9003e20f1b0a5556ac14b401dfa0a37596).
 * Semi-Lagrangian advection, oxygen-limited reaction, soot oxidation, thermal
 * buoyancy and a fixed Jacobi projection are retained. This is deliberately
 * not the original WebGPU MacCormack/multigrid solver or a gameplay fire model. */
export interface ProceduralFireWeather {
  readonly wind: readonly [number, number]; readonly windStrength: number; readonly rain: number;
}
export const PROCEDURAL_FIRE_GRID = Object.freeze([16, 24, 16] as const);
export const PROCEDURAL_FIRE_STEP_SECONDS = 1 / 12;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (a: number, b: number, n: number) => { const t = clamp((n-a)/(b-a),0,1); return t*t*(3-2*t); };
export function normalizeProceduralFireWeather(weather?: ProceduralFireWeather | null, target = { windX: 0, windZ: 0, rain: 0 }) {
  const x = Number.isFinite(weather?.wind?.[0]) ? weather!.wind[0] : 0, z = Number.isFinite(weather?.wind?.[1]) ? weather!.wind[1] : 0;
  const length = Math.hypot(x,z), strength = Number.isFinite(weather?.windStrength) ? clamp(weather!.windStrength,0,1) : 0;
  target.windX = length > 1e-6 ? x/length*strength*.9 : 0; target.windZ = length > 1e-6 ? z/length*strength*.9 : 0;
  target.rain = Number.isFinite(weather?.rain) ? clamp(weather!.rain,0,1) : 0; return target;
}
export function createProceduralFireField() {
  const [nx,ny,nz] = PROCEDURAL_FIRE_GRID, count = nx*ny*nz, dx = 1/nx;
  let scalars = new Float32Array(count*4), nextScalars = new Float32Array(count*4);
  let velocity = new Float32Array(count*3), nextVelocity = new Float32Array(count*3);
  let pressure = new Float32Array(count), nextPressure = new Float32Array(count);
  const divergence = new Float32Array(count), reaction = new Float32Array(count);
  const cell = (x:number,y:number,z:number) => (clamp(z,0,nz-1)*ny+clamp(y,0,ny-1))*nx+clamp(x,0,nx-1);
  const source = new Float32Array(count), air = { windX: 0, windZ: 0, rain: 0 };
  let elapsed = 0, lastTime: number | null = null, accumulator = 0, disposed = false, steps = 0;
  let divergenceBefore = 0, divergenceAfter = 0, skippedSeconds = 0;
  // A bounded deterministic hot pilot is the initial condition. Every moving
  // frame thereafter is evolved by the same reaction/advection field.
  for (let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
    const i=cell(x,y,z), px=(x+.5)/nx-.5, pz=(z+.5)/nz-.5, py=(y+.5)/ny;
    const r=Math.hypot(px,pz), pilot=Math.max(0,1-r/(.25*(1-py)+.02))*Math.exp(-py*6);
    source[i]=(1-smooth(.1,.25,r))*(1-smooth(.04,.13,py));
    scalars[i*4]=.9*pilot; scalars[i*4+1]=.1*source[i]; scalars[i*4+2]=.14*pilot; scalars[i*4+3]=1-.8*source[i];
    velocity[i*3+1]=pilot*.35;
  }
  function measureDivergence(v:Float32Array):number {
    let sum=0;
    for(let z=1;z<nz-1;z++) for(let y=1;y<ny-1;y++) for(let x=1;x<nx-1;x++) {
      const vi=((z*ny+y)*nx+x)*3,d=(v[vi+3]-v[vi-3]+v[vi+nx*3+1]-v[vi-nx*3+1]
        +v[vi+nx*ny*3+2]-v[vi-nx*ny*3+2])/(2*dx);sum+=d*d;
    }
    return Math.sqrt(sum/((nx-2)*(ny-2)*(nz-2)));
  }
  function step(dt:number, weather?:ProceduralFireWeather|null):boolean {
    if(disposed||!Number.isFinite(dt)||dt<=0)return false;
    dt=Math.min(dt,PROCEDURAL_FIRE_STEP_SECONDS); normalizeProceduralFireWeather(weather,air); elapsed+=dt;
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
      const i=cell(x,y,z), si=i*4, vi=i*3, bx=x-dt*velocity[vi]/dx, by=y-dt*velocity[vi+1]/dx, bz=z-dt*velocity[vi+2]/dx;
      const outside=bx<0||bx>nx-1||by>ny-1||bz<0||bz>nz-1;
      let theta=0,fuel=0,soot=0,oxygen=outside?1:0,vx=outside?air.windX:0,vy=0,vz=outside?air.windZ:0;
      if(!outside){
        const ax=clamp(bx,0,nx-1),ay=clamp(by,0,ny-1),az=clamp(bz,0,nz-1),x0=Math.floor(ax),y0=Math.floor(ay),z0=Math.floor(az);
        const x1=Math.min(x0+1,nx-1),y1=Math.min(y0+1,ny-1),z1=Math.min(z0+1,nz-1),fx=ax-x0,fy=ay-y0,fz=az-z0;
        // One shared trilinear stencil for all seven advected channels.
        for(let ez=0;ez<2;ez++)for(let ey=0;ey<2;ey++)for(let ex=0;ex<2;ex++){
          const at=((ez?z1:z0)*ny+(ey?y1:y0))*nx+(ex?x1:x0),weight=(ex?fx:1-fx)*(ey?fy:1-fy)*(ez?fz:1-fz),qs=at*4,qv=at*3;
          theta+=scalars[qs]*weight;fuel+=scalars[qs+1]*weight;soot+=scalars[qs+2]*weight;oxygen+=scalars[qs+3]*weight;
          vx+=velocity[qv]*weight;vy+=velocity[qv+1]*weight;vz+=velocity[qv+2]*weight;
        }
      }
      const pulse=.72+.28*Math.sin(elapsed*2.7+x*.83+z*1.17), src=source[i]*pulse*(1-air.rain*.7);
      fuel=Math.max(fuel,.15*src); theta=Math.max(theta,.82*src); oxygen*=1-src*.65;
      // Integrate stiff reaction/radiative cooling with bounded local substeps.
      let temperature=293+1000*theta,totalHeat=0;
      const chemistryDt=dt/5;
      for(let chemistry=0;chemistry<5;chemistry++){
        const burn=Math.min(fuel,oxygen/4.7)*(1-Math.exp(-30*smooth(500,600,temperature)*chemistryDt));
        fuel-=burn;oxygen-=4.7*burn;
        const heat=Math.min(7700*burn,Math.max(2100-temperature,0));temperature+=heat;totalHeat+=heat;
        soot+=25*burn*smooth(1000,1400,temperature);
        soot*=Math.exp(-(30*(.25+oxygen)*smooth(1100,1400,temperature)+.4)*chemistryDt);
        temperature-=Math.min(.25*970*soot*(temperature*.001)**6,6000)*chemistryDt;
        temperature=293+Math.max(temperature-293,0)*Math.exp(-(3*(1-smooth(500,5000,heat/chemistryDt))+air.rain*2)*chemistryDt);
        fuel*=Math.exp(-.3*chemistryDt);oxygen+=(1-oxygen)*Math.min(1,.8*chemistryDt);
      }
      theta=(temperature-293)*.001;const heat=totalHeat;
      const height=(y+.5)/ny, gate=smooth(.03,.4,height);
      vx+=(air.windX*gate-vx)*dt*.6 + Math.sin(y*.7+z*.9-elapsed*2.1)*theta*dt*.25;
      vz+=(air.windZ*gate-vz)*dt*.6 + Math.cos(y*.8+x*.7-elapsed*1.6)*theta*dt*.25;
      vy+=26.8*theta*dt; vy=Math.max(vy,src*.25);
      const sponge=smooth(0,2,Math.min(x,nx-1-x,z,nz-1-z))*(1-smooth(ny-3,ny-1,y));
      nextScalars[si]=clamp(theta*sponge,0,1.807); nextScalars[si+1]=clamp(fuel*sponge,0,1);
      nextScalars[si+2]=clamp(soot*sponge,0,2); nextScalars[si+3]=clamp(1-(1-oxygen)*sponge,0,1);
      nextVelocity[vi]=clamp(vx,-3,3); nextVelocity[vi+1]=y===0?Math.max(0,vy):clamp(vy,-3,3); nextVelocity[vi+2]=clamp(vz,-3,3);
      reaction[i]=clamp(heat/dt/10000,0,1);
    }
    const scalarSwap=scalars;scalars=nextScalars;nextScalars=scalarSwap;
    const velocitySwap=velocity;velocity=nextVelocity;nextVelocity=velocitySwap;
    divergenceBefore=measureDivergence(velocity); pressure.fill(0);
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
      const i=cell(x,y,z), bottom=y===0?-velocity[i*3+1]:velocity[cell(x,y-1,z)*3+1];
      divergence[i]=(velocity[cell(x+1,y,z)*3]-velocity[cell(x-1,y,z)*3]+velocity[cell(x,y+1,z)*3+1]-bottom
        +velocity[cell(x,y,z+1)*3+2]-velocity[cell(x,y,z-1)*3+2])/(2*dx);
    }
    // Six bounded sweeps reduce compressibility; no converged/multigrid or
    // gas-expansion pressure claim is made for this compatibility backend.
    for(let sweep=0;sweep<6;sweep++) {
      for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
        const i=cell(x,y,z), sum=(x?pressure[i-1]:0)+(x<nx-1?pressure[i+1]:0)+(z?pressure[i-nx*ny]:0)
          +(z<nz-1?pressure[i+nx*ny]:0)+(y?pressure[i-nx]:pressure[i])+(y<ny-1?pressure[i+nx]:0);
        nextPressure[i]=(sum-dx*dx*divergence[i])/6;
      }
      const pressureSwap=pressure;pressure=nextPressure;nextPressure=pressureSwap;
    }
    for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
      const i=cell(x,y,z), vi=i*3;
      velocity[vi]-=((x<nx-1?pressure[i+1]:0)-(x?pressure[i-1]:0))/(2*dx);
      velocity[vi+1]-=((y<ny-1?pressure[i+nx]:0)-(y?pressure[i-nx]:pressure[i]))/(2*dx);
      velocity[vi+2]-=((z<nz-1?pressure[i+nx*ny]:0)-(z?pressure[i-nx*ny]:0))/(2*dx);
      if(y===0)velocity[vi+1]=Math.max(0,velocity[vi+1]);
    }
    divergenceAfter=measureDivergence(velocity); steps++; return true;
  }
  return {
    step,
    /** One bounded visual step at most; long stalls are rebased rather than
     * replayed in a burst. This clock never owns canonical burning/damage. */
    advance(time:number,reducedMotion:boolean,weather?:ProceduralFireWeather|null):boolean {
      if(disposed||!Number.isFinite(time))return false;
      if(lastTime===null||time<lastTime||reducedMotion){lastTime=time;accumulator=0;return false;}
      const delta=Math.max(0,time-lastTime);lastTime=time;
      if(delta>1){skippedSeconds+=delta;accumulator=0;return false;}
      accumulator+=delta;
      if(accumulator+1e-8<PROCEDURAL_FIRE_STEP_SECONDS)return false;
      skippedSeconds+=Math.max(0,accumulator-PROCEDURAL_FIRE_STEP_SECONDS); accumulator=0;
      return step(PROCEDURAL_FIRE_STEP_SECONDS,weather);
    },
    /** RGBA8: temperature above ambient/1807K, soot/2, reaction/10000K/s,
     * oxygen. Slices use4×4 tiles with texel-centre sampling to avoid bleed. */
    writeAtlas(target:Uint8Array,collapsed=false):void {
      const width=collapsed?nx:nx*4,height=collapsed?ny:ny*4;
      if(target.length!==width*height*4)throw Error('Fire atlas does not match its bounded grid.');
      for(let z=0;z<(collapsed?1:nz);z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) {
        let theta=0,soot=0,heat=0,oxygen=0;
        for(let depth=collapsed?0:z;depth<(collapsed?nz:z+1);depth++) {
          const i=cell(x,y,depth); theta=Math.max(theta,scalars[i*4]); soot+=scalars[i*4+2]; heat=Math.max(heat,reaction[i]);oxygen+=scalars[i*4+3];
        }
        if(collapsed){soot/=nz;oxygen/=nz;}
        const offset=((Math.floor(z/4)*ny+y)*width+(z%4)*nx+x)*4;
        target[offset]=Math.round(clamp(theta/1.807,0,1)*255);target[offset+1]=Math.round(clamp(soot/2,0,1)*255);
        target[offset+2]=Math.round(heat*255);target[offset+3]=Math.round(oxygen*255);
      }
    },
    get diagnostics(){
      let fuel=0,heat=0,soot=0,maxSpeed=0;
      for(let i=0;i<count;i++){fuel+=scalars[i*4+1];heat+=scalars[i*4];soot+=scalars[i*4+2];maxSpeed=Math.max(maxSpeed,Math.hypot(velocity[i*3],velocity[i*3+1],velocity[i*3+2]));}
      return Object.freeze({backend:'cpu-combustion-3d' as const,grid:PROCEDURAL_FIRE_GRID,cells:count,steps,elapsedSeconds:elapsed,
        simulationHz:12,maximumStepsPerUpdate:1,chemistrySubsteps:5,maximumChemistryStepSeconds:1/60,pressureIterations:6,divergenceBefore,divergenceAfter,fuel,heat,soot,maxSpeed,skippedSeconds,disposed});
    },
    dispose(){if(disposed)return;disposed=true;scalars.fill(0);velocity.fill(0);reaction.fill(0);lastTime=null;accumulator=0;},
  };
}
