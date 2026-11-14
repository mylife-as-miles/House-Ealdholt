/** Deterministic geometric two-bone solve. Presentation only; the caller keeps
 * the real actor root fixed and independently measures the resulting full skin. */
export type GuardPoint = readonly [number,number,number];
const sub=(a:GuardPoint,b:GuardPoint):GuardPoint=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const len=(a:GuardPoint)=>Math.hypot(...a);
const dot=(a:GuardPoint,b:GuardPoint)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const scale=(a:GuardPoint,n:number):GuardPoint=>[a[0]*n,a[1]*n,a[2]*n];
const add=(a:GuardPoint,b:GuardPoint):GuardPoint=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export function solveGuardTwoBone(a:GuardPoint,b:GuardPoint,c:GuardPoint,target:GuardPoint):{elbow:GuardPoint;tip:GuardPoint}|null{
 if(![...a,...b,...c,...target].every(Number.isFinite))return null;
 const upper=len(sub(b,a)),lower=len(sub(c,b)),toward=sub(target,a),distance=len(toward);
 if(upper<1e-5||lower<1e-5||distance<1e-5||distance>upper+lower-1e-6||distance<Math.abs(upper-lower)+1e-6)return null;
 const direction=scale(toward,1/distance),previous=sub(b,a),side=sub(previous,scale(direction,dot(previous,direction))),sideLength=len(side);
 if(sideLength<1e-5)return null;
 const cos=(upper*upper+distance*distance-lower*lower)/(2*upper*distance);
 const along=scale(direction,cos*upper),bend=scale(side,Math.sqrt(Math.max(0,1-cos*cos))*upper/sideLength);
 return{elbow:add(a,add(along,bend)),tip:target};
}
