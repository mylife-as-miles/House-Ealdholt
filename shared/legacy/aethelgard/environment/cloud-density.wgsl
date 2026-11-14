// MIT copyright SamG-Coder. Original BakedVoxelLighting billow architecture.
// Crownfall RG8 occurrence layout uses integer seeds shared with its CPU source.
fn cloudField(p:vec3f)->vec2f {
 let q=p.xz*8.;let cell=floor(q);var shape=0.;
 for(var z:i32=-1;z<=1;z++){for(var x:i32=-1;x<=1;x++){
  let id=cell+vec2f(f32(x),f32(z));let w=id-floor(id/8.)*8.;
  let cx=.1+cloudUnit(u32(w.x),0u,u32(w.y),0x243f6a88u)*.8;
  let cz=.1+cloudUnit(u32(w.x),1u,u32(w.y),0x243f6a88u)*.8;
  let rx=.37+cloudUnit(u32(w.x),2u,u32(w.y),0x243f6a88u)*.14;
  let rz=.35+cloudUnit(u32(w.x),3u,u32(w.y),0x243f6a88u)*.18;
  shape=max(shape,max(0.,1.-length(vec3f((q-id-vec2f(cx,cz))/vec2f(rx,rz),(p.y-.23)/.21))));
  let count=3+i32(floor(cloudUnit(u32(w.x),4u,u32(w.y),0x243f6a88u)*5.));
  for(var l:i32=0;l<7;l++){
   if(l>=count){break;}let n=u32(8+l*6);
   let a=cloudUnit(u32(w.x),n,u32(w.y),0x243f6a88u);
   let b=cloudUnit(u32(w.x),n+1u,u32(w.y),0x243f6a88u);
   let radius=vec2f(.20+cloudUnit(u32(w.x),n+2u,u32(w.y),0x243f6a88u)*.20,.20+cloudUnit(u32(w.x),n+3u,u32(w.y),0x243f6a88u)*.20);
   let cy=.24+cloudUnit(u32(w.x),n+4u,u32(w.y),0x243f6a88u)*.32;
   let ry=.15+cloudUnit(u32(w.x),n+5u,u32(w.y),0x243f6a88u)*.13;
   let d=vec3f((q-id-vec2f(cx,cz)-(vec2f(a,b)-.5)*.6)/radius,(p.y-cy)/ry);
   shape=max(shape,max(0.,1.-length(d)));
  }
 }}
 var v=vec3f(p.x*32.,p.y*8.,p.z*32.);var noise=0.;var amplitude=.55;var period=32.;
 for(var octave:i32=0;octave<3;octave++){
  let c=floor(v);var f=fract(v);f=f*f*(vec3f(3.)-2.*f);var value=0.;
  for(var z:i32=0;z<2;z++){for(var y:i32=0;y<2;y++){for(var x:i32=0;x<2;x++){
   let o=vec3f(f32(x),f32(y),f32(z));var id=c+o;
   id=vec3f(id.x-floor(id.x/period)*period,id.y,id.z-floor(id.z/period)*period);
   let h=cloudUnit(u32(id.x),u32(id.y),u32(id.z),0x6d2b79f5u);let w=mix(vec3f(1.)-f,f,o);value+=h*w.x*w.y*w.z;
  }}}
  noise+=value*amplitude;amplitude*=.5;v*=2.;period*=2.;
 }
 let density=smoothstep(.025,.16,shape-(1.-noise)*.42)*smoothstep(.015,.13,p.y)*(1.-smoothstep(.78,.98,p.y));
 return vec2f(density,f32(cloudWeatherByte(p.xz))/255.);
}
fn cloudHash(x:u32,y:u32,z:u32,seed:u32)->u32 {
 var h=(x*0x9e3779b1u) ^ (y*0x85ebca77u) ^ (z*0xc2b2ae3du) ^ seed;
 h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;return h^(h>>16u);
}
fn cloudUnit(x:u32,y:u32,z:u32,seed:u32)->f32{return f32(cloudHash(x,y,z,seed)>>8u)/16777216.;}
fn cloudEaseByte(f:f32)->u32 {let n=u32(round(f*256.));return(n*n*(768u-2u*n)+32768u)/65536u;}
fn cloudMixByte(a:u32,b:u32,t:u32)->u32{return(a*(256u-t)+b*t+128u)/256u;}
fn cloudWeatherByte(p:vec2f)->u32 {
 let q=p*4.;let c=floor(q);let f=fract(q);let sx=cloudEaseByte(f.x);let sz=cloudEaseByte(f.y);
 let x0=u32(c.x-floor(c.x/4.)*4.);let z0=u32(c.y-floor(c.y/4.)*4.);
 let x1=(x0+1u)%4u;let z1=(z0+1u)%4u;
 let a=cloudHash(x0,0u,z0,0xb7e15162u)>>24u;let b=cloudHash(x1,0u,z0,0xb7e15162u)>>24u;
 let d=cloudHash(x0,0u,z1,0xb7e15162u)>>24u;let e=cloudHash(x1,0u,z1,0xb7e15162u)>>24u;
 return cloudMixByte(cloudMixByte(a,b,sx),cloudMixByte(d,e,sx),sz);
}
