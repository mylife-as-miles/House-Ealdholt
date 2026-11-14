/** Original low-resolution exhibition lighting, not an external HDRI or artwork. */
export function stageReflectionPixels():Uint8Array {
  const pixels=new Uint8Array(128*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<128;x++){
    const u=x/128,v=y/63,sky=Math.max(0,1-v*1.1);
    const wrap=(a:number,b:number)=>Math.min(Math.abs(a-b),1-Math.abs(a-b));
    const warm=Math.exp(-Math.pow(wrap(u,.18)/.12,6)-Math.pow((v-.28)/.16,6));
    const cool=Math.exp(-Math.pow(wrap(u,.69)/.09,6)-Math.pow((v-.35)/.18,6));
    const horizon=Math.exp(-Math.pow((v-.5)/.07,2))*.11;
    const r=.07+sky*.23+warm*.60+cool*.22+horizon,g=.10+sky*.25+warm*.54+cool*.40+horizon,b=.12+sky*.27+warm*.43+cool*.46+horizon;
    const i=(y*128+x)*4;pixels[i]=Math.min(255,Math.round(r*255));pixels[i+1]=Math.min(255,Math.round(g*255));pixels[i+2]=Math.min(255,Math.round(b*255));pixels[i+3]=255;
  }return pixels;
}
