/** WebGL adaptation of BakedVoxelLighting impostors.js captureSurface (MIT).
 * Capture only borrowed source geometry with owned unlit/normal materials.
 * One tile/pass is queued per frame; the live scene never changes parents. */
import {Box3, Color, Group, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoToneMapping,
  OrthographicCamera, Scene, Vector3, Vector4, WebGLRenderTarget, type BufferGeometry, type Material, type WebGLRenderer} from 'three';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationAtlasRecord} from '../../../../shared/legacy/aethelgard/environment/vegetation-atlas';
import {VegetationCaptureEmptyError} from '../../../../shared/legacy/aethelgard/environment/vegetation-capture-diagnostics';
import type {VegetationPreparationWorker} from './vegetation-worker';
export interface VegetationCapturePart {geometry: BufferGeometry; material: MeshStandardMaterial; frame: Matrix4; foliage: boolean}
const sourceBounds = new WeakMap<BufferGeometry, {version: number; box: Box3}>();

export async function captureVegetationAtlas(options: {renderer: WebGLRenderer; parts: readonly VegetationCapturePart[];
  views: 8 | 16; tileSize: 64 | 128; queue: WorldPreparationQueue; worker: VegetationPreparationWorker;
  signal: AbortSignal; priority: () => number; canopyOnly?: boolean; topDown?: boolean}): Promise<VegetationAtlasRecord> {
  const {renderer, queue, worker, signal, views, tileSize, priority} = options;
  signal.throwIfAborted();
  const parts = options.canopyOnly ? options.parts.filter(p => p.foliage) : options.parts;
  if (!parts.length) throw Error('No source surface for the requested vegetation capture.');
  const bounds = new Box3(), point = new Vector3();
  for (const part of parts) {
    const positions = part.geometry.getAttribute('position'), version = positions instanceof InterleavedBufferAttribute ? positions.data.version : positions.version;
    let cached = sourceBounds.get(part.geometry);
    if (!cached || cached.version !== version) {
      const box = version === 0 && part.geometry.boundingBox ? part.geometry.boundingBox.clone() : new Box3();
      if (box.isEmpty()) for (let start = 0; start < positions.count; start += 8192) {
        for (let i = start; i < Math.min(positions.count, start + 8192); i++) box.expandByPoint(point.fromBufferAttribute(positions, i));
        if (start + 8192 < positions.count) await new Promise(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
      }
      cached = {version, box}; sourceBounds.set(part.geometry, cached);
    }
    bounds.union(cached.box.clone().applyMatrix4(part.frame));
  }
  const centre = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
  const width = Math.hypot(size.x, size.z) * 1.08, height = (options.topDown ? Math.hypot(size.x, size.z) : size.y) * 1.08;
  if (![width, height].every(n => Number.isFinite(n) && n > 0 && n < 1e6)) throw Error('Unqualified vegetation capture bounds.');
  // Exported geometry can use centimetres beneath a scaled GLB node. Frame
  // the local prototype from its bounds instead of assuming metre-sized data.
  const radius = size.length() / 2, captureDistance = Math.max(10, radius * 3);
  const scene = new Scene(), object = new Group(); scene.add(object);
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .01, captureDistance + radius * 2 + 1);
  const normalToLocal = {value: new Matrix4()};
  const assignments = parts.map(part => {
    const source = part.material;
    const albedo = new MeshBasicMaterial({map: source.map, alphaMap: source.alphaMap, color: source.color,
      alphaTest: source.alphaTest, side: source.side, vertexColors: source.vertexColors, transparent: false, toneMapped: false, fog: false});
    const normal = new MeshStandardMaterial({map: source.map, alphaMap: source.alphaMap, alphaTest: source.alphaTest,
      normalMap: source.normalMap, normalMapType: source.normalMapType, normalScale: source.normalScale,
      vertexColors: source.vertexColors, side: source.side, transparent: false, toneMapped: false, fog: false});
    normal.onBeforeCompile = shader => {
      shader.uniforms.crownfallCaptureToLocal = normalToLocal;
      shader.fragmentShader = 'uniform mat4 crownfallCaptureToLocal;\n' + shader.fragmentShader;
      const seam = '#include <opaque_fragment>';
      if (shader.fragmentShader.split(seam).length !== 2) throw Error('Unsupported vegetation normal capture shader.');
      shader.fragmentShader = shader.fragmentShader.replace(seam, seam + '\ngl_FragColor=vec4(normalize(mat3(crownfallCaptureToLocal)*normal)*.5+.5,diffuseColor.a);');
    };
    normal.customProgramCacheKey = () => 'crownfall-vegetation-object-normal-capture-v1';
    const mesh = new Mesh<BufferGeometry, Material>(part.geometry, albedo); mesh.matrix.copy(part.frame); mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false; object.add(mesh); return {mesh, albedo, normal};
  });
  const target = new WebGLRenderTarget(tileSize, tileSize, {depthBuffer: true});
  const atlasWidth = tileSize * 4, atlasHeight = tileSize * views / 4;
  const channels = [new Uint8Array(atlasWidth * atlasHeight * 4), new Uint8Array(atlasWidth * atlasHeight * 4)];
  const pixels = new Uint8Array(tileSize * tileSize * 4), clear = new Color(), viewport = new Vector4(), scissor = new Vector4();
  try {
    for (let pass = 0; pass < 2; pass++) for (let view = 0; view < (options.topDown ? 1 : views); view++) {
      await queue.enqueue({bytes: pixels.byteLength, signal, priority, work: async () => {
        signal.throwIfAborted();
        for (const part of assignments) part.mesh.material = pass === 0 ? part.albedo : part.normal;
        const angle = view / views * Math.PI * 2;
        if (options.topDown) {camera.up.set(0, 0, -1); camera.position.set(centre.x, centre.y + captureDistance, centre.z);}
        else camera.position.set(centre.x + Math.sin(angle) * captureDistance, centre.y, centre.z + Math.cos(angle) * captureDistance);
        camera.lookAt(centre); camera.updateMatrixWorld(true); normalToLocal.value.copy(camera.matrixWorld);
        const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        renderer.getClearColor(clear); renderer.getViewport(viewport); renderer.getScissor(scissor);
        const alpha = renderer.getClearAlpha(), scissorTest = renderer.getScissorTest(), tone = renderer.toneMapping,
          xr = renderer.xr.enabled, shadow = renderer.shadowMap.enabled, auto = renderer.autoClear;
        const beforeCalls=renderer.info.render.calls,beforeTriangles=renderer.info.render.triangles;
        let submission={calls:0,triangles:0,autoReset:renderer.info.autoReset,frame:renderer.info.render.frame};
        const sourceDraws=parts.map(({geometry})=>({positions:geometry.getAttribute('position').count,indices:geometry.index?.count??null,drawStart:geometry.drawRange.start,drawCount:Number.isFinite(geometry.drawRange.count)?geometry.drawRange.count:'unbounded' as const}));
        let readback: ReturnType<WebGLRenderer['readRenderTargetPixelsAsync']>;
        try {
          renderer.xr.enabled = false; renderer.shadowMap.enabled = false; renderer.toneMapping = NoToneMapping;
          // The render target owns a viewport in physical atlas pixels.
          // setViewport uses logical pixels and would reapply renderScale/DPR.
          renderer.autoClear = true; renderer.setRenderTarget(target);
          renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear(); renderer.render(scene, camera);
          // Read immediately: the live world may render while this readback
          // awaits its fence. Respect the renderer's existing counter mode.
          submission={calls:renderer.info.render.calls-(renderer.info.autoReset?0:beforeCalls),triangles:renderer.info.render.triangles-(renderer.info.autoReset?0:beforeTriangles),autoReset:renderer.info.autoReset,frame:renderer.info.render.frame};
          readback = renderer.readRenderTargetPixelsAsync(target, 0, 0, tileSize, tileSize, pixels);
        } finally {
          renderer.setRenderTarget(previousTarget, face, mip); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
          renderer.setClearColor(clear, alpha); renderer.toneMapping = tone; renderer.xr.enabled = xr;
          renderer.shadowMap.enabled = shadow; renderer.autoClear = auto;
        }
        // Restore renderer state before yielding: the real scene and its input
        // keep running while the GPU fence is pending.
        await readback; signal.throwIfAborted();
        if (pass === 0) {
          let covered = false; for (let pixel = 3; pixel < pixels.length; pixel += 4) if (pixels[pixel] >= 82) {covered = true; break;}
          if (!covered) {
            let maximum=0,nonzeroPixels=0;for(let pixel=3;pixel<pixels.length;pixel+=4){maximum=Math.max(maximum,pixels[pixel]);if(pixels[pixel]>0)nonzeroPixels++;}
            throw new VegetationCaptureEmptyError({view,topDown:!!options.topDown,tileSize,
              parts:sourceDraws,
              submission,alpha:{maximum,nonzeroPixels,pixels:pixels.length/4},
              // Never consume shared errors here: village diagnostics owns them.
              webgl:{contextLost:renderer.getContext().isContextLost(),errorQueuePolled:false}});
          }
        }
        const ox = view % 4 * tileSize, oy = Math.floor(view / 4) * tileSize;
        for (let y = 0; y < tileSize; y++) channels[pass].set(pixels.subarray(y * tileSize * 4, (y + 1) * tileSize * 4), ((y + oy) * atlasWidth + ox) * 4);
        // A ground footprint has one orthographic view. Reuse it in the atlas
        // layout instead of issuing eight identical GPU renders/readbacks.
        if (options.topDown) for (let duplicate = 1; duplicate < views; duplicate++) {
          const dx = duplicate % 4 * tileSize, dy = Math.floor(duplicate / 4) * tileSize;
          for (let y = 0; y < tileSize; y++) channels[pass].set(pixels.subarray(y * tileSize * 4, (y + 1) * tileSize * 4), ((y + dy) * atlasWidth + dx) * 4);
        }
      }});
    }
    signal.throwIfAborted();
    return await worker.mips({schema: 1, views, tileSize, columns: 4, rows: views / 4,
      centre: [centre.x, centre.y, centre.z], extent: [width, height], colour: channels[0], normal: channels[1]});
  } finally {
    for (const part of assignments) {part.albedo.dispose(); part.normal.dispose();}
    object.clear(); scene.clear(); target.dispose();
  }
}
