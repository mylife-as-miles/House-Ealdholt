import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {CLOUD_SAMPLE_GLSL} from '../../../../shared/legacy/aethelgard/environment/cloud-volume';

// Opt in on a browser-capable worker. This samples the real exported shader
// into a 1-pixel buffer; it creates no Three.js scene or visual acceptance image.
test('cloud coverage preserves empty air, smooth billow edges and unshadowed gaps in the actual WebGL2 sampler', {
  skip: process.env.CROWNFALL_VERIFY_CLOUD_GPU !== '1' && 'Set CROWNFALL_VERIFY_CLOUD_GPU=1 on a browser-capable worker.',
  timeout: 45_000,
}, async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CROWNFALL_CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage();
    // tsx preserves names with this helper inside serialized test callbacks.
    // Install it only on the disposable, blank numerical-test page.
    await page.evaluate('globalThis.__name = (fn) => fn');
    const result = await page.evaluate(shader => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const gl = canvas.getContext('webgl2', {antialias: false});
      if (!gl) throw Error('WebGL2 is required for the cloud shader readback.');
      const compile = (type: number, source: string) => {
        const object = gl.createShader(type)!; gl.shaderSource(object, source); gl.compileShader(object);
        if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(object) ?? 'Cloud shader compile failed.');
        return object;
      };
      const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
        void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`);
      const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        ${shader}
        uniform vec3 samplePoint; out vec4 result;
        void main(){result=vec4(cfCloudSample(samplePoint)*.5,cfCloudShadow(samplePoint*vec3(6000.,0.,6000.)),0.,1.);}`);
      const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? 'Cloud shader link failed.');
      const vao = gl.createVertexArray(), texture = gl.createTexture();
      gl.bindVertexArray(vao); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_3D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      // The first voxel is empty; the second is a half-density billow. Linear
      // sampling between them exercises the real texture edge, not a JS formula.
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 2, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0, 128]));
      for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, parameter, gl.LINEAR);
      for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, parameter, gl.CLAMP_TO_EDGE);
      const location = (name: string) => gl.getUniformLocation(program, name);
      gl.uniform1i(location('cfCloudDensity'), 0); gl.uniform3f(location('cfWorldSun'), 0, 1, 0);
      gl.uniform1f(location('cfSurfaceWeatherEnabled'), 1); gl.uniform2f(location('cfCloudOffset'), 0, 0);
      gl.disable(gl.DITHER);
      const pixel = new Uint8Array(4), coverageUniform = location('cfCloudCoverage'), pointUniform = location('samplePoint');
      function sample(x: number, coverage: number, y = .5) {
        gl!.uniform1f(coverageUniform, coverage); gl!.uniform3f(pointUniform, x, y, .5);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3); gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixel);
        return {density: pixel[0] * 2 / 255, shadow: pixel[1] / 255};
      }
      const coverages = [-1, 0, .3, .5, .8, 1, 2];
      const empty = coverages.map(coverage => ({coverage, ...sample(.25, coverage)}));
      const core = coverages.map(coverage => ({coverage, ...sample(.75, coverage)}));
      const edge = Array.from({length: 21}, (_, i) => sample(.25 + i * .005, 1).density);
      const outside = [-.01, 1.01].map(y => sample(.75, 1, y).density);
      const repeat = sample(1.25, 1);
      const error = gl.getError();
      gl.deleteTexture(texture); gl.deleteVertexArray(vao); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return {empty, core, edge, outside, repeat, error};
    }, CLOUD_SAMPLE_GLSL);
    assert.equal(result.error, 0, 'Shader sampling must finish without a WebGL error.');
    for (const sample of result.empty) {
      assert.equal(sample.density, 0, `Empty air must remain empty at coverage ${sample.coverage}.`);
      assert.equal(sample.shadow, 1, 'Empty air must not cast a cloud shadow.');
    }
    assert.equal(result.repeat.density, 0, 'Periodic texture coordinates preserve empty air.');
    assert.deepEqual(result.outside, [0, 0], 'Samples outside the authored cloud height remain empty.');
    assert.ok(Math.abs(result.core[3].density - 128 / 255) < 2 / 255, 'Half coverage preserves the source billow core.');
    assert.ok(result.core[5].density > result.core[3].density, 'Coverage still strengthens existing billows.');
    assert.ok(result.core[5].shadow < 1, 'Existing billows still cast cloud shadows.');
    assert.equal(result.core[0].density, result.core[1].density, 'Coverage clamps below zero.');
    assert.equal(result.core[5].density, result.core[6].density, 'Coverage clamps above one.');
    assert.equal(result.edge[0], 0); assert.ok(result.edge.at(-1)! > .25, 'The source edge reaches the billow interior.');
    for (let i = 1; i < result.edge.length; i++) {
      assert.ok(result.edge[i] >= result.edge[i - 1], 'A linear source edge must not develop a dark gap.');
      assert.ok(result.edge[i] - result.edge[i - 1] < .045, 'The trilinear edge must not jump into a full-strength slab.');
    }
  } finally {
    await browser.close();
  }
});

// This stays a numerical 1-pixel sampler. It never loads a world or records an image.
test('RG8 occurrence gates and actual producer columns agree with the exact live GLSL transfer', {
  skip: process.env.CROWNFALL_VERIFY_CLOUD_GPU !== '1' && 'Set CROWNFALL_VERIFY_CLOUD_GPU=1 on a browser-capable worker.',
  timeout: 60_000,
}, async () => {
  const {createCloudDensityVolume,cloudCoverageDensity}=await import('../../../../shared/legacy/aethelgard/environment/cloud-volume');
  const width=64,height=24,data=createCloudDensityVolume(width,height),coverages=[0,.22,.5,.78,.91,1];
  const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage();await page.evaluate('globalThis.__name = (fn) => fn');
    const result=await page.evaluate(({shader,bytes,width,height,coverages})=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const gl=canvas.getContext('webgl2',{antialias:false})!;if(!gl)throw Error('WebGL2 unavailable.');
      function compile(type:number,source:string){const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'Cloud compile failed');return s;}
      const vs=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}');
      const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;
${shader}
uniform vec2 column;uniform float testHeight;uniform int mode;out vec4 result;
void main(){
 if(mode>=2){vec3 p=vec3(column.x,testHeight,column.y);if(mode==2)p=cfCloudWorldPoint(p);result=vec4(cfCloudSunTransmission(p),0.,0.,1.);return;}
 if(mode==1){float d=cfCloudSample(vec3(column.x,.5,.5));result=vec4(d*.5,cfCloudSunTransmission(vec3(column.x*6000.,0.,3000.)),0.,1.);return;}
 float depth=0.;for(int y=0;y<${height};y++)depth+=cfCloudSample(vec3(column.x,(float(y)+.5)/${height}.,column.y))*(620./${height}.)*.009;
 result=vec4(1.-exp(-depth),0.,0.,1.);
}`);
      const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Cloud link failed');
      const vao=gl.createVertexArray(),texture=gl.createTexture();gl.bindVertexArray(vao);gl.useProgram(program);gl.bindTexture(gl.TEXTURE_3D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_R,gl.REPEAT);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      const loc=(name:string)=>gl.getUniformLocation(program,name);gl.uniform1i(loc('cfCloudDensity'),0);gl.uniform3f(loc('cfWorldSun'),0,1,0);gl.uniform2f(loc('cfCloudOffset'),0,0);gl.uniform1f(loc('cfSurfaceWeatherEnabled'),1);gl.disable(gl.DITHER);
      const pixel=new Uint8Array(4),samples:number[][]=[];
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,width,height,width,0,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array(bytes));gl.uniform1i(loc('mode'),0);
      for(const coverage of coverages){
        gl.uniform1f(loc('cfCloudCoverage'),coverage);const values:number[]=[];
        // 1,024 fixed, stratified actual-source columns (all 24 height samples).
        for(let z=0;z<width;z+=2)for(let x=0;x<width;x+=2){gl.uniform2f(loc('column'),(x+.5)/width,(z+.5)/width);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);values.push(pixel[0]/255);}
        samples.push(values);
      }
      // Densest source through every occurrence rank: zero must remove all of it;
      // full coverage must admit it all. The second channel costs no new sampler.
      const ranks=new Uint8Array(256*2);for(let i=0;i<256;i++){ranks[i*2]=255;ranks[i*2+1]=i;}
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,256,1,1,0,gl.RG,gl.UNSIGNED_BYTE,ranks);gl.uniform1i(loc('mode'),1);
      const endpoints:number[][]=[];
      for(const coverage of [0,1]){gl.uniform1f(loc('cfCloudCoverage'),coverage);const values:number[]=[];for(let i=0;i<256;i++){gl.uniform2f(loc('column'),(i+.5)/256,.5);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);values.push(pixel[0]*2/255);}endpoints.push(values);}
      gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,width,height,width,0,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array(bytes));
      const frame=[0,0,-2,0,0,3,0,0,.5,0,0,0,1500,40,-700,1];gl.uniformMatrix4fv(loc('cfCloudSourceToWorld'),false,frame);
      const length=Math.hypot(.3,1,.2);gl.uniform3f(loc('cfWorldSun'),.3/length,1/length,.2/length);gl.uniform1f(loc('cfCloudCoverage'),.78);
      const transformed:number[]=[],world:number[]=[];
      for(let i=0;i<64;i++){
        const x=i%8*300-1000,z=Math.floor(i/8)*300-1000;
        gl.uniform1i(loc('mode'),2);gl.uniform1f(loc('testHeight'),25);gl.uniform2f(loc('column'),x,z);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);transformed.push(pixel[0]/255);
        gl.uniform1i(loc('mode'),3);gl.uniform1f(loc('testHeight'),115);gl.uniform2f(loc('column'),1500+.5*z,-700-2*x);gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);world.push(pixel[0]/255);
      }
      const error=gl.getError();gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();return{samples,endpoints,transformed,world,error};
    },{shader:CLOUD_SAMPLE_GLSL,bytes:Array.from(data),width,height,coverages});
    assert.equal(result.error,0);assert.ok(result.endpoints[0].every(n=>n===0),'Zero weather coverage is cloud-free at every source rank, including dense source cores.');
    assert.ok(result.endpoints[1].every(n=>Math.abs(n-1.24)<2/255),'Full coverage admits every rank.');
    assert.ok(Math.max(...result.world)-Math.min(...result.world)>.05,'Transformed correspondence must span lit and cloud-shadowed locations.');
    for(let i=0;i<result.world.length;i++)assert.ok(Math.abs(result.world[i]-result.transformed[i])<=1/255,'Nonidentity source translation, rotation and scale must sample the same world cloud shadow.');
    let maxError=0;
    for(let c=0;c<coverages.length;c++){
      let at=0;
      for(let z=0;z<width;z+=2)for(let x=0;x<width;x+=2){
        let depth=0;for(let y=0;y<height;y++){const i=((z*height+y)*width+x)*2;depth+=cloudCoverageDensity(data[i]/255,data[i+1]/255,coverages[c])*(620/height)*.009;}
        const value=result.samples[c][at],cpu=1-Math.exp(-depth);maxError=Math.max(maxError,Math.abs(value-cpu));
        assert.ok(Math.abs(value-cpu)<2/255,'Actual GLSL/CPU column opacity agrees within RGBA8 numerical readback precision.');
        if(c===0)assert.equal(value,0);else assert.ok(value>=result.samples[c-1][at],'Every sampled column remains monotonic in actual GLSL.');at++;
      }
    }
    console.log('cloud-glsl-audit',JSON.stringify({columns:result.samples[0].length,height,maxError,coverages,occupied:result.samples.map(a=>a.filter(n=>n>.1).length/a.length)}));
  }finally{await browser.close();}
});
