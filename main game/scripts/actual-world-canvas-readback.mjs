// Read the existing application's completed canvas. No renderer/scene substitute.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

export function actualWorldCanvasExpression(timeout) {
  assert.ok(Number.isInteger(timeout) && timeout >= 1000 && timeout <= 60000);
  return `(() => {
    const world = document.querySelector('.ealdholt-preview[aria-hidden="false"] .ealdholt-world');
    const canvas = world?.querySelector('canvas');
    if (!world || !canvas || world.dataset.modelReady !== 'true') throw Error('Actual prepared world canvas is unavailable.');
    const before = Number(world.dataset.renderFrames), view = world.dataset.selectedView;
    if (!Number.isSafeInteger(before) || canvas.width < 1 || canvas.height < 1) throw Error('Actual frame dimensions/counter are unavailable.');
    return new Promise((resolve, reject) => {
      let settled = false, timer, captured = null;
      const observer = new MutationObserver(() => {
        if (settled) return;
        try {
          if (!captured) {
            const frame = Number(world.dataset.renderFrames);
            if (frame <= before) return;
            if (world.dataset.selectedView !== view) throw Error('View changed while requesting actual canvas frame.');
            // Preserve immediate SAME-frame pixels and metadata before the
            // default drawing buffer can be discarded by compositing. This
            // explicit one-time readback can wait; continuous diagnostics do not.
            const dataUrl = canvas.toDataURL('image/png');
            const residentFollow = JSON.parse(world.dataset.worldResidentFollow || 'null');
            if (residentFollow && residentFollow.canvasFrame !== frame) throw Error('Selected-resident trace belongs to a different canvas frame.');
            captured = { dataUrl, frame, selectedView: view, width: canvas.width, height: canvas.height,
              evidence: 'actual-application-canvas-after-existing-render-without-ui',
              populationDrawn: Number(world.dataset.populationDrawn || 0),
              populationVisualRevision: JSON.parse(world.dataset.populationSnapshot || 'null')?.visualRevision ?? null,
              residentFollow,
              drawAttribution: JSON.parse(world.dataset.worldDrawAttribution || 'null'),
              bankMaterial: JSON.parse(world.dataset.worldBankMaterial || 'null'),
              regionalForest: JSON.parse(world.dataset.regionalForest || 'null'),
              environment: JSON.parse(world.dataset.worldEnvironment || 'null'),
              camera: { position: world.dataset.cameraPosition, target: world.dataset.cameraTarget },
              gpu: JSON.parse(world.dataset.worldGpuFrame || 'null') };
          }
          const glDiagnostics = JSON.parse(world.dataset.worldGlDiagnostics || 'null');
          const completion = glDiagnostics?.completed;
          if (!completion || completion.canvasFrame < captured.frame) return;
          if (completion.canvasFrame !== captured.frame) throw Error('GPU diagnostic completion belongs to a different canvas frame.');
          if (completion.status !== 'clean' || completion.errors?.length || glDiagnostics.errors?.length)
            throw Error('Captured world frame has no clean completed GPU diagnostic.');
          if (captured.residentFollow && completion.rendererFrame !== captured.residentFollow.rendererFrame)
            throw Error('GPU diagnostic completion belongs to a different renderer submission.');
          if (captured.drawAttribution && completion.rendererFrame !== captured.drawAttribution.frame)
            throw Error('GPU completion and frozen draw attribution differ.');
          if (captured.bankMaterial?.status === 'ready' && completion.rendererFrame !== captured.bankMaterial.frame)
            throw Error('GPU completion and frozen bank material evidence differ.');
          settled = true; observer.disconnect(); clearTimeout(timer);
          resolve({ ...captured, glDiagnostics });
        } catch (error) { settled = true; observer.disconnect(); clearTimeout(timer); reject(error); }
      });
      timer = setTimeout(() => { settled = true; observer.disconnect(); reject(Error('No actual canvas frame within readback bound.')); }, ${timeout});
      observer.observe(world, { attributes: true, attributeFilter: ['data-render-frames', 'data-world-gl-diagnostics'] });
    });
  })()`;
}

export function decodeActualWorldCanvasResult(value) {
  const { dataUrl, ...evidence } = value ?? {};
  assert.equal(evidence.evidence, 'actual-application-canvas-after-existing-render-without-ui');
  assert.ok(Number.isSafeInteger(evidence.frame) && evidence.frame > 0);
  assert.ok([evidence.width,evidence.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192));
  const diagnostics = evidence.glDiagnostics, completion = diagnostics?.completed;
  assert.equal(diagnostics?.version, 'completed-world-frame-gl-errors-v1');
  assert.equal(completion?.status, 'clean'); assert.equal(completion.canvasFrame, evidence.frame);
  assert.ok(Number.isSafeInteger(completion.rendererFrame) && completion.rendererFrame > 0);
  assert.deepEqual(completion.errors, []); assert.deepEqual(diagnostics.errors, []);
  if (evidence.residentFollow) assert.equal(completion.rendererFrame, evidence.residentFollow.rendererFrame);
  if (evidence.drawAttribution) assert.equal(completion.rendererFrame, evidence.drawAttribution.frame);
  if (evidence.bankMaterial?.status === 'ready') assert.equal(completion.rendererFrame, evidence.bankMaterial.frame);
  assert.ok(typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,'));
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.ok(bytes.length >= 33);
  assert.deepEqual([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  assert.equal(bytes.toString('ascii',12,16),'IHDR');
  assert.equal(bytes.readUInt32BE(16),evidence.width);
  assert.equal(bytes.readUInt32BE(20),evidence.height);
  return { bytes,evidence };
}

export async function captureActualWorldCanvas(session,file,timeout=45000) {
  const expression=actualWorldCanvasExpression(timeout);let timer;
  try {
    const response=await Promise.race([
      session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}),
      // A busy software-rendered frame can delay command dispatch before the
      // in-page observer starts its own next-frame deadline. Bound those two
      // waits separately; neither requests a replacement or synthetic render.
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Actual canvas readback response timed out.')),2*timeout+5000);}),
    ]);
    if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
    const {bytes,evidence}=decodeActualWorldCanvasResult(response.result.value);
    await writeFile(file,bytes,{mode:0o600,flag:'wx'});
    return {...evidence,bytes:bytes.length,file};
  } finally {clearTimeout(timer);}
}
