/** Public r185 GLBufferAttribute bridge for paged WebGL2 uploads. Derived CPU
 * geometry stays detached until every page is resident. Borrowed GLB buffers
 * are never rewritten and COPY_WRITE_BUFFER leaves Three's VAO state alone. */
import {BufferGeometry, GLBufferAttribute, type BufferAttribute, type WebGLRenderer} from 'three';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

/** The largest buffer page one preparation job uploads (L-10). */
export const UPLOAD_PAGE_BYTES = 1024 * 1024;

export async function uploadWorldGeometry(source: BufferGeometry, renderer: WebGLRenderer, queue: WorldPreparationQueue,
  signal: AbortSignal, priority: () => number) {
  signal.throwIfAborted();
  const context = renderer.getContext();
  if (!('COPY_WRITE_BUFFER' in context)) throw Error('Paged geometry requires WebGL2; retain the source LOD.');
  const gl = context as WebGL2RenderingContext, buffers: WebGLBuffer[] = [], geometry = new BufferGeometry();
  let disposed = false, bytes = 0, pages = 0;
  const dispose = () => {
    if (disposed) return; disposed = true; geometry.dispose();
    // Three removes registered external attributes on geometry disposal. A
    // cancelled or never-drawn geometry still owns buffers it never registered.
    // deleteBuffer is also valid for a created handle that was cancelled before
    // its first bind (isBuffer is false in that case), and for deleted handles.
    for (const buffer of buffers) gl.deleteBuffer(buffer);
  };
  async function upload(attribute: BufferAttribute, index: boolean): Promise<BufferAttribute> {
    const array = attribute.array;
    if (!(array instanceof Float32Array || index && (array instanceof Uint16Array || array instanceof Uint32Array))) throw Error('Unsupported derived GPU attribute layout.');
    const buffer = gl.createBuffer(); if (!buffer) throw Error('GPU buffer allocation failed; retain the source LOD.');
    buffers.push(buffer); bytes += array.byteLength;
    await queue.enqueue({bytes: 0, signal, priority, work() {
      if (index) {
        // WebGL2 classifies element buffers on their first bind. Creating one
        // through COPY_WRITE_BUFFER first makes its later index bind invalid.
        // Use a private VAO so Three's current element binding stays intact.
        const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING), vao = gl.createVertexArray();
        if (!vao) throw Error('Index upload VAO allocation failed; retain the source LOD.');
        try {gl.bindVertexArray(vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);}
        finally {gl.bindVertexArray(previousVao); gl.deleteVertexArray(vao);}
      }
      const previous = gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);
      try {gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer); gl.bufferData(gl.COPY_WRITE_BUFFER, array.byteLength, gl.STATIC_DRAW);}
      finally {gl.bindBuffer(gl.COPY_WRITE_BUFFER, previous);}
    }});
    const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    // Pages of up to 1 MiB (L-10: 64 KiB pages, one a frame, held the village to about 2–4 MiB of geometry a second),
    // never more than the queue lets one frame upload.
    const pageBytes = Math.min(UPLOAD_PAGE_BYTES, queue.frameBytes);
    for (let offset = 0; offset < raw.length; offset += pageBytes) {
      const page = raw.subarray(offset, Math.min(raw.length, offset + pageBytes));
      await queue.enqueue({bytes: page.byteLength, signal, priority, work() {
        const previous = gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);
        try {gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer); gl.bufferSubData(gl.COPY_WRITE_BUFFER, offset, page); pages++;}
        finally {gl.bindBuffer(gl.COPY_WRITE_BUFFER, previous);}
      }});
    }
    const type = array instanceof Float32Array ? gl.FLOAT : array instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
    return new GLBufferAttribute(buffer, type, attribute.itemSize, array instanceof Uint16Array ? 2 : 4, attribute.count, attribute.normalized) as unknown as BufferAttribute;
  }
  try {
    if (!source.boundingBox || !source.boundingSphere) throw Error('Derived GPU geometry needs qualified CPU bounds.');
    geometry.boundingBox = source.boundingBox.clone(); geometry.boundingSphere = source.boundingSphere.clone();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (!('array' in attribute)) throw Error('Interleaved derived uploads must be packed before publication.');
      geometry.setAttribute(name, await upload(attribute as BufferAttribute, false));
    }
    if (source.index) geometry.setIndex(await upload(source.index, true));
    for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
    signal.throwIfAborted(); return {geometry, bytes, pages, dispose};
  } catch (cause) {dispose(); throw cause;}
}
