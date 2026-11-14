export interface SourceGrassSite {
  /** Measured world-space base of an exported source grass clump. */
  origin: readonly [number, number, number];
  /** Horizontal half-diagonal of that clump's transformed mesh bounds. */
  footprintRadius: number;
}

/** Compact support from real plant placements. This infers vegetation presence;
 * it does not recover the missing terrain paint or declare a road/water mask.
 * Spatial buckets and a finite support bound keep the offline bake bounded. */
export function sourceGrassDensity(sites: readonly SourceGrassSite[]) {
  const maxRadius = 2.5, minRadius = 0.3, verticalTolerance = 0.65;
  if (sites.length > 100_000) throw new RangeError('Source plant intake exceeds the bounded bake limit.');
  const buckets = new Map<string, { x:number; y:number; z:number; radius:number }[]>();
  const unique = new Set<string>();
  for (const site of sites) {
    if(site.origin.length!==3 || !site.origin.every(Number.isFinite) || !Number.isFinite(site.footprintRadius) || site.footprintRadius<=0) throw new RangeError('Invalid measured source grass site.');
    const [x,y,z]=site.origin;
    const id=site.origin.map(value=>Math.round(value*100)).join(',');
    if(unique.has(id)) continue;
    unique.add(id);
    const key=`${Math.floor(x/maxRadius)},${Math.floor(z/maxRadius)}`;
    const list=buckets.get(key)??[];
    list.push({x,y,z,radius:Math.max(minRadius,Math.min(maxRadius,site.footprintRadius))});
    buckets.set(key,list);
  }
  return {
    sites: unique.size,
    maxRadiusMetres: maxRadius,
    verticalToleranceMetres: verticalTolerance,
    at(x:number,y:number,z:number):number {
      if(![x,y,z].every(Number.isFinite)) throw new RangeError('Ground sample must be finite.');
      const gx=Math.floor(x/maxRadius),gz=Math.floor(z/maxRadius);
      let coverage=0;
      for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++) {
        for(const site of buckets.get(`${gx+dx},${gz+dz}`)??[]) {
          // Raised planters/roofs cannot tint a distant ground plane beneath.
          const dy=Math.abs(y-site.y);
          if(dy>=verticalTolerance) continue;
          const q=((x-site.x)**2+(z-site.z)**2)/site.radius**2;
          if(q>=1) continue;
          const height=1-(dy/verticalTolerance)**2;
          coverage+=(1-q)**2*height**2;
        }
      }
      return 1-Math.exp(-coverage);
    },
  };
}
