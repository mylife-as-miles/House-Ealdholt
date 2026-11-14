import type { ScreenAnchor } from '../environment-contract';
/** A point is placeable only when the actual rendered world receives input there.
 * This follows live opaque panes/popovers instead of guessed sidebar widths. */
export function settlementPointVisible(canvas:HTMLCanvasElement,point:ScreenAnchor|null):boolean {
 if(!point?.visible)return false;const bounds=canvas.getBoundingClientRect();
 if(bounds.width<=0||bounds.height<=0||point.x<0||point.y<0||point.x>bounds.width||point.y>bounds.height)return false;
 return canvas.ownerDocument.elementFromPoint(bounds.left+point.x,bounds.top+point.y)===canvas;
}
/** Explicit Show plot chooses an unobstructed world region. It never opens or
 * closes a pane, moves the preview, or changes the camera's orbit/zoom. */
export function unobstructedSettlementPoint(canvas:HTMLCanvasElement):{x:number;y:number}|null {
 const bounds=canvas.getBoundingClientRect();if(bounds.width<=0||bounds.height<=0)return null;
 const candidates=[.5,.4,.6,.3,.7,.2,.8];
 for(const y of [.5,.4,.6,.3,.7])for(const x of candidates){const point={x:bounds.width*x,y:bounds.height*y,visible:true};if(settlementPointVisible(canvas,point))return{x:point.x,y:point.y};}
 return null;
}
