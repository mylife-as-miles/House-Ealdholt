/** One blueprint-space sun direction for the original estate and its owned
 * source adapters. Calibrated platform intensities remain unchanged. */
export const SETTLEMENT_LIGHTING=Object.freeze({
 sun:Object.freeze({bearingDeg:310,elevationDeg:53,colour:'#fff0d2',intensity:.86}),
 native:Object.freeze({skyColour:'#d3dfdf',groundColour:'#635740',hemisphereIntensity:1.1,keyIntensity:1.8,keyDistance:Math.hypot(70,140,90)}),
});
const bearing=SETTLEMENT_LIGHTING.sun.bearingDeg*Math.PI/180,elevation=SETTLEMENT_LIGHTING.sun.elevationDeg*Math.PI/180;
export const SETTLEMENT_SUN_DIRECTION:readonly[number,number,number]=Object.freeze([Math.sin(bearing)*Math.cos(elevation),Math.sin(elevation),-Math.cos(bearing)*Math.cos(elevation)]);
