/** Preparation can service the existing queue without dirtying a static world.
 * Visible publication and the final settled graph still request a real draw. */
export type WorldEnvironmentChangeReason = 'visual' | 'preparation' | 'ready';
export function createWorldEnvironmentChangeHandler(options:{prepare():void;render():void}) {
  return (reason:WorldEnvironmentChangeReason='visual') => {
    if(reason==='preparation')options.prepare();else options.render();
  };
}
