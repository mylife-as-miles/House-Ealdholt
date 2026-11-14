import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ContactEffects } from './contactEffects';
import type { ContactFxInput } from '../../../../shared/play/contact-vfx';
const impact: ContactFxInput = { id: 'contact', seed: 1, point: { x: 0, y: .8, z: 0 },
  normal: { x: 1, y: 0, z: 0 }, material: 'wood', quality: 'low', strength: 1, groundY: 0 };
describe('bounded material contact rendering', () => {
  it('uploads emission attributes once; subsequent motion changes only the shader clock', () => {
    const fx = new ContactEffects(32), geometry = fx.object.geometry, attributes = geometry.attributes;
    expect(fx.emit(impact)).toBe(6);
    const version = (attributes.position as THREE.BufferAttribute).version, copy = [...attributes.position.array];
    fx.update(.1); fx.update(.1);
    expect((attributes.position as THREE.BufferAttribute).version).toBe(version);
    expect([...attributes.position.array]).toEqual(copy);
    expect((fx.object.material as THREE.ShaderMaterial).uniforms.time.value).toBe(.2);
    expect(fx.emit(impact)).toBe(0);
    fx.update(2);
    expect(fx.object.visible).toBe(false);
    fx.dispose();
  });
  it('retains fixed geometry under a long capture streak and clears on rewind', () => {
    const fx = new ContactEffects(32), geometry = fx.object.geometry, positions = geometry.getAttribute('position').array;
    for (let i = 0; i < 300; i++) fx.emit({ ...impact, id: `move-${i}` });
    expect(geometry.drawRange.count).toBe(32);
    expect(geometry.getAttribute('position').array).toBe(positions);
    fx.clear();
    expect(geometry.drawRange.count).toBe(0);
    expect(fx.emit(impact)).toBe(6);
    fx.dispose(); fx.dispose();
    expect(fx.emit({ ...impact, id: 'after-disposal' })).toBe(0);
  });
  it('rejects malformed events without poisoning the same event ID for retry', () => {
    const fx = new ContactEffects(16);
    expect(() => fx.emit({ ...impact, point: { x: NaN, y: 0, z: 0 } })).toThrow();
    expect(fx.emit(impact)).toBe(6);
    fx.update(NaN); fx.update(-1);
    expect((fx.object.material as THREE.ShaderMaterial).uniforms.time.value).toBe(0);
    fx.dispose();
  });
});
