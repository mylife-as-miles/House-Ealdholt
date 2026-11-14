import assert from 'node:assert/strict';
import test from 'node:test';
import {patchEaldholtRiverFlow, EALDHOLT_RIVER_FLOW_PROGRAM_KEY} from '../aethelgard/environment/river-flow-shader';
import {patchEaldholtWaterRipples} from '../aethelgard/environment/water-ripples';
import {patchEaldholtWaterShoreColor, EALDHOLT_WATER_SHORE_CACHE_KEY} from '../aethelgard/environment/water-shore-color';
import {patchWorldEnvironmentMaterial} from '../aethelgard/environment/environment-material-shader';

function fixture() {
  const shader = {uniforms:{} as Record<string,{value:unknown}>, vertexShader:'#include <common>\n#include <begin_vertex>',
    fragmentShader:'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>'};
  patchEaldholtWaterRipples(shader, {time:{value:0}, metresPerWorldUnit:{value:1}, worldToSource:{value:{}}, sourceToWorldRotation:{value:{}}});
  return shader;
}

test('river field consumes the already-declared contact in either weather order without new uniforms or resources', () => {
  for (const weatherFirst of [false, true]) {
    const shader = fixture();
    if (weatherFirst) patchWorldEnvironmentMaterial(shader, {}, false, true);
    patchEaldholtWaterShoreColor(shader);
    const vertex = shader.vertexShader, uniforms = {...shader.uniforms}, samplers = (shader.fragmentShader.match(/\bsampler\w*\s/g) ?? []).length;
    patchEaldholtRiverFlow(shader);
    assert.equal(shader.vertexShader, vertex, 'The field cannot change water positions or source transforms.');
    assert.deepEqual(shader.uniforms, uniforms, 'The same clock/frame/shore uniforms remain owned by their existing systems.');
    assert.equal((shader.fragmentShader.match(/\bsampler\w*\s/g) ?? []).length, samplers, 'No new texture binding.');
    if (!weatherFirst) patchWorldEnvironmentMaterial(shader, {}, false, true);
    const declaration = shader.fragmentShader.indexOf('float ealdholtShoreContact =');
    const use = shader.fragmentShader.indexOf('ealdholtRiverField = cfRiverSurface(');
    const roughness = shader.fragmentShader.indexOf('roughnessFactor = max(roughnessFactor, .24');
    assert.ok(declaration >= 0 && use > declaration, 'Compile-time ordering must not read a later shore declaration.');
    assert.ok(roughness > use && roughness < shader.fragmentShader.indexOf('#include <lights_physical_fragment>'));
    assert.ok(shader.fragmentShader.indexOf('roughnessFactor=mix(roughnessFactor,.31,cfRain*.6);') < roughness);
    const before = structuredClone(shader); patchEaldholtRiverFlow(shader); assert.deepEqual(shader, before);
  }
});

test('missing source/contact or unsupported PBR seams reject atomically instead of compiling a partial water material', () => {
  const unqualified = fixture();
  unqualified.fragmentShader += '\n#ifdef CROWNFALL_COASTAL_WATER_SHORE_COLOR\n#endif';
  const original = structuredClone(unqualified);
  assert.throws(() => patchEaldholtRiverFlow(unqualified), /shore attributes/); assert.deepEqual(unqualified, original);
  for (const seam of ['#include <common>', '#include <normal_fragment_maps>', '#include <lights_physical_fragment>']) {
    for (const replacement of ['', seam + '\n' + seam]) {
      const shader = fixture(); patchEaldholtWaterShoreColor(shader);
      shader.fragmentShader = shader.fragmentShader.replace(seam, replacement); const before = structuredClone(shader);
      assert.throws(() => patchEaldholtRiverFlow(shader), /standard PBR/); assert.deepEqual(shader, before);
    }
  }
});

test('river program identity advances independently of existing shore, static occupancy and authored geometry', () => {
  assert.equal(EALDHOLT_RIVER_FLOW_PROGRAM_KEY, ':ealdholt-downstream-river-flow:v7-bounded-2d-broad');
  assert.equal(EALDHOLT_WATER_SHORE_CACHE_KEY, ':ealdholt-original-shore-colour:v3-contact');
  const shader = fixture(); patchEaldholtWaterShoreColor(shader); patchEaldholtRiverFlow(shader);
  assert.match(shader.fragmentShader, /if \(vEaldholtWaterShore\.y > 0\.\)/);
  assert.doesNotMatch(shader.fragmentShader, /along\*2\.1|crossway\*2\.3|dot\(vEaldholtWaterSourcePosition\.xz,flow\)/);
  assert.match(shader.fragmentShader, /max\(abs\(dFdx\(phase\)\), abs\(dFdy\(phase\)\)\)/);
  assert.match(shader.fragmentShader, /coord = vec2\(-p\.x, shore\.x\)/);
});

test('phase filtering never differentiates a derivative-built tangent or velocity', () => {
  const shader=fixture();patchEaldholtWaterShoreColor(shader);patchEaldholtRiverFlow(shader);
  const start=shader.fragmentShader.indexOf('vec4 cfRiverSurface('),end=shader.fragmentShader.indexOf('\n}',start);
  const body=shader.fragmentShader.slice(start,end);
  const phases=body.slice(0,body.indexOf('vec4 field = mix(b, a, blend);'));
  assert.ok(phases.length>0);
  assert.match(phases,/float velocity = speed;/);
  assert.doesNotMatch(phases.replace(/\/\/[^\n]*/g,''),/\bflow\b|cfDownstream|cfRiverSourceGradient|dFd[xy]|fwidth/,
    'Advected q and its phase inputs must be built only from raw source/shore/time values.');
  assert.doesNotMatch(body,/cfRiverSourceGradient\(p, (?:velocity|speed|flow)/);
  assert.match(body,/cfRiverSourceGradient\(p, shore\.y\) - sign\(shore\.x\) \* cfRiverSourceGradient\(p, shore\.x\)/);
  assert.deepEqual([...shader.fragmentShader.matchAll(/cfRiverSourceGradient\(p,\s*([^)]*)\)/g)].map(match=>match[1].trim()),
    ['p.y - across','shore.y','shore.x'],'Every source-gradient operand must be an original linear source/shore varying.');
  const expression=body.match(/float bankSpeedShear = ([\d.\s/*()+-]*bankSpeedT[\d.\s/*()+-]*bankSpeedT[\d.\s/*()+-]*);/)?.[1];
  assert.ok(expression,'The analytic speed derivative must be an explicit scalar polynomial.');
  // Evaluate the emitted scalar polynomial on the CPU, independently of any
  // GPU derivative implementation. Compare with finite differences of speed.
  const emittedShear=new Function('bankSpeedT',`return ${expression};`) as (t:number)=>number;
  const speed=(bank:number)=>{const t=Math.max(0,Math.min(1,bank/4));return .25+.9*t*t*(3-2*t);};
  for(const bank of [-2,0,.1,.7,1.3,2,3,3.9,4,7]){
    const h=1e-5,finite=(speed(bank+h)-speed(bank-h))/(2*h),actual=emittedShear(Math.max(0,Math.min(1,bank/4)));
    assert.ok(Math.abs(actual-finite)<1e-6,`bank ${bank}: speed shear must include the smoothstep/4 scale.`);
  }
  for(const row of [{x:8,z:6,centre:.3,width:.2},{x:-12,z:1.2,centre:-.4,width:-.15},{x:3,z:0,centre:0,width:0}]){
    const at=(x:number,z:number)=>speed(5+row.width*x-Math.abs(z-row.centre*x));
    const across=row.z-row.centre*row.x,bank=5+row.width*row.x-Math.abs(across),shear=emittedShear(Math.max(0,Math.min(1,bank/4)));
    const expected=[(row.width+Math.sign(across)*row.centre)*shear,-Math.sign(across)*shear],h=1e-5;
    const finite=[(at(row.x+h,row.z)-at(row.x-h,row.z))/(2*h),(at(row.x,row.z+h)-at(row.x,row.z-h))/(2*h)];
    for(let i=0;i<2;i++)assert.ok(Math.abs(expected[i]-finite[i])<1e-6,'Raw width and bank-offset gradients must include both channel sides.');
  }
});
