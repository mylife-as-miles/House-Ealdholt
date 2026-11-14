/** Independent scalar reference for height/gradient and signal checks. This
 * test-only code is not a simulation, renderer or runtime water fallback. */
const F=.45,A=.0176,C=.9238795325,S=-.3826834324;
export function riverCorner(x:number,y:number):number{
  let h=(Math.imul(x,0x9e3779b9)^Math.imul(y,0x85ebca6b)^0xc2b2ae35)>>>0;
  h=(h^(h>>>16))>>>0;h=Math.imul(h,0x7feb352d)>>>0;h=(h^(h>>>15))>>>0;
  h=Math.imul(h,0x846ca68b)>>>0;h=(h^(h>>>16))>>>0;return h>>>31;
}
function noise(x:number,y:number):readonly[number,number,number]{
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),
    du=6*fx*(1-fx),dv=6*fy*(1-fy),a=riverCorner(ix,iy),b=riverCorner(ix+1,iy),c=riverCorner(ix,iy+1),d=riverCorner(ix+1,iy+1);
  return[(a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v,((b-a)*(1-v)+(d-c)*v)*du,((c-a)*(1-u)+(d-b)*u)*dv];
}
export function riverBroad(x:number,y:number){
  const a=noise((.8*x+.6*y)*F+.23,(-.6*x+.8*y)*F+.17),b=noise((C*x+S*y)*F*2+.37,(-S*x+C*y)*F*2+.19);
  return{height:A*(2*(.65*a[0]+.35*b[0])-1),gradient:[2*A*(.65*(.8*a[1]-.6*a[2])*F+.35*(C*b[1]-S*b[2])*F*2),
    2*A*(.65*(.6*a[1]+.8*a[2])*F+.35*(S*b[1]+C*b[2])*F*2)] as const};
}
export function riverV6Broad(x:number,y:number){
  const da=.17*x+.39*y+.4,db=-.21*x+.29*y+1.7,a=x*1.45+1.1*Math.sin(da)+.65*Math.sin(db);
  return{height:.015*Math.sin(a),gradient:[(1.45+.187*Math.cos(da)-.1365*Math.cos(db))*Math.cos(a)*.015,
    (.429*Math.cos(da)+.1885*Math.cos(db))*Math.cos(a)*.015] as const};
}
export function riverFine(x:number,y:number){
  const d=-.21*x+.29*y+1.7,b=x*3.7-y*1.15+.8*Math.sin(d+.9);
  return{height:.0032*Math.sin(b),gradient:[(3.7-.168*Math.cos(d+.9))*Math.cos(b)*.0032,
    (-1.15+.232*Math.cos(d+.9))*Math.cos(b)*.0032] as const};
}
export const riverHeight=(x:number,y:number)=>riverBroad(x,y).height+riverFine(x,y).height;
export function derivative(f:(x:number,y:number)=>number,x:number,y:number,axis:number,epsilon=1e-5){
  return axis===0?(f(x+epsilon,y)-f(x-epsilon,y))/(2*epsilon):(f(x,y+epsilon)-f(x,y-epsilon))/(2*epsilon);
}
/** Parseval-normalized power around the former broad carrier. Independent of
 * amplitude, so reducing water strength cannot masquerade as removing bands. */
export function carrierPower(values:readonly number[],step:number){
  const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
  const data=values.map((v,i)=>(v-mean)*(.5-.5*Math.cos(2*Math.PI*i/(n-1)))),energy=data.reduce((a,b)=>a+b*b,0);
  let power=0;for(let k=1;k<n/2;k++){
    if(Math.abs(k/(n*step)-1.45/(2*Math.PI))>.06)continue;
    let re=0,im=0;for(let i=0;i<n;i++){const t=2*Math.PI*k*i/n;re+=data[i]*Math.cos(t);im-=data[i]*Math.sin(t);}power+=re*re+im*im;
  }
  return energy===0?0:2*power/(n*energy);
}
