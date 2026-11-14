/** Failure facts contain no pixels or GL error-queue reads. The world renderer
 * retains ownership of context errors while an atlas fence is pending. */
export interface VegetationCaptureDiagnostics {
 readonly view:number;
 readonly topDown:boolean;
 readonly tileSize:number;
 readonly parts:readonly {positions:number;indices:number|null;drawStart:number;drawCount:number|'unbounded'}[];
 readonly submission:{calls:number;triangles:number;autoReset:boolean;frame:number};
 readonly alpha:{maximum:number;nonzeroPixels:number;pixels:number};
 readonly webgl:{contextLost:boolean;errorQueuePolled:false};
}
export class VegetationCaptureEmptyError extends Error {
 constructor(readonly diagnostics:VegetationCaptureDiagnostics){
  super('Source vegetation capture view '+diagnostics.view+' is empty; retain the resident source LOD. Capture facts: '+JSON.stringify(diagnostics));
  this.name='VegetationCaptureEmptyError';
 }
}
