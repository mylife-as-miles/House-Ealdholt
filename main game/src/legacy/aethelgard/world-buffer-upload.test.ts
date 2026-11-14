import assert from 'node:assert/strict';
import test from 'node:test';
import {BufferAttribute, BufferGeometry, type WebGLRenderer} from 'three';
import {uploadWorldGeometry} from './world-buffer-upload';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';

test('derived uploads are paged, keep qualified bounds and delete owned buffers after cancellation', async () => {
  const source = new BufferGeometry(), values = new Float32Array(20000 * 3); values[3] = 20;
  source.setAttribute('position', new BufferAttribute(values, 3)); source.computeBoundingBox(); source.computeBoundingSphere();
  source.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const queue = createWorldPreparationQueue(() => {}, 64, 64 * 1024), controller = new AbortController();
  let binding: unknown = {}, largest = 0, vao: unknown = {}; const previous = binding, priorVao = vao, live = new Set<object>(), firstTargets = new Map<object, number>();
  const gl = {COPY_WRITE_BUFFER: 1, COPY_WRITE_BUFFER_BINDING: 2, STATIC_DRAW: 3, FLOAT: 4, UNSIGNED_SHORT: 5, UNSIGNED_INT: 6,
    VERTEX_ARRAY_BINDING: 7, ELEMENT_ARRAY_BUFFER: 8, createVertexArray: () => ({}), bindVertexArray: (v: unknown) => {vao = v;}, deleteVertexArray() {},
    createBuffer() {const b = {}; live.add(b); return b;}, isBuffer: (b: object) => live.has(b), deleteBuffer: (b: object) => live.delete(b),
    getParameter(target: number) {return target === gl.VERTEX_ARRAY_BINDING ? vao : binding;},
    bindBuffer(target: number, b: object) {if (b && !firstTargets.has(b)) firstTargets.set(b, target); if (target === gl.COPY_WRITE_BUFFER) binding = b;}, bufferData() {},
    bufferSubData(_target: number, _offset: number, page: Uint8Array) {largest = Math.max(largest, page.byteLength);}};
  const renderer = {getContext: () => gl} as unknown as WebGLRenderer;
  const pending = uploadWorldGeometry(source, renderer, queue, controller.signal, () => 0);
  let done = false; void pending.then(() => {done = true;});
  for (let i = 0; i < 40 && !done; i++) {queue.step(); await new Promise(resolve => setTimeout(resolve, 0));}
  const gpu = await pending; assert.equal(gpu.pages, 5); assert.equal(largest, 65536); assert.equal(binding, previous); assert.equal(vao, priorVao);
  assert.equal(firstTargets.get((gpu.geometry.index as unknown as {buffer: object}).buffer), gl.ELEMENT_ARRAY_BUFFER,
    'index buffers must first bind as elements, preserving the current Three VAO');
  assert.equal((gpu.geometry.getAttribute('position') as unknown as {isGLBufferAttribute: boolean}).isGLBufferAttribute, true);
  assert.ok(gpu.geometry.boundingBox!.equals(source.boundingBox!)); assert.equal(source.getAttribute('position').array, values);
  gpu.dispose(); gpu.dispose(); assert.equal(live.size, 0);
  const cancelled = uploadWorldGeometry(source, renderer, queue, controller.signal, () => 0), rejected = assert.rejects(cancelled, /abort|Obsolete/i);
  controller.abort(); queue.step(); await rejected; assert.equal(live.size, 0); queue.dispose(); source.dispose();
});
