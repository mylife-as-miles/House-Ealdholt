/** Only derived L2 wood changes. Capture identities and the existing L1
 * simplifier policy remain unchanged. Error is relative to Meshoptimizer's
 * source-position scale; actor scale and projection matter for pixel error. */
export const VEGETATION_BRANCH_L2={version:'wood-l2-root-attributes-v1',ratio:.12,error:.008,minimumSaving:.1,minimumSourceTriangles:256}as const;
export function acceptVegetationBranchL2(sourceTriangles:number,l1Triangles:number,l2Triangles:number,error:number){
 return [sourceTriangles,l1Triangles,l2Triangles].every(n=>Number.isSafeInteger(n)&&n>0)&&sourceTriangles>=VEGETATION_BRANCH_L2.minimumSourceTriangles&&Number.isFinite(error)&&error>=0&&error<=VEGETATION_BRANCH_L2.error+1e-7&&l2Triangles<=sourceTriangles&&l2Triangles<=l1Triangles*(1-VEGETATION_BRANCH_L2.minimumSaving);
}
