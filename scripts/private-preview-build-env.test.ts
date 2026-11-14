import assert from 'node:assert/strict';
import test from 'node:test';
import { stripPrivatePreviewBuildInputs } from './private-preview-build-env';

test('build scrubs shell and dotenv preview inputs before Vite/SDK environment serialization', () => {
  const environment = { VITE_ELDERBLOOM_PREVIEW_URL: 'operator-only-url', VITE_PUBLIC_THEME: 'dark', PATH: '/tools' };
  const loaded = { VITE_ELDERBLOOM_POND_PROBES: 'operator-only-config', VITE_ELDERBLOOM_FUTURE_INPUT: 'future-private-input', VITE_PUBLIC_THEME: 'light' };
  const before = structuredClone(loaded);
  stripPrivatePreviewBuildInputs('build', environment, loaded);
  const serialized = JSON.stringify({ ...loaded, ...environment });
  assert.doesNotMatch(serialized, /operator-only|future-private/);
  assert.equal(environment.VITE_PUBLIC_THEME, 'dark'); assert.equal(environment.PATH, '/tools');
  assert.deepEqual(loaded, before);
});

test('serve preserves private operator inputs for the explicitly enabled local preview', () => {
  const environment = { VITE_ELDERBLOOM_PREVIEW_URL: 'operator-only-url' }, before = structuredClone(environment);
  stripPrivatePreviewBuildInputs('serve', environment, { VITE_ELDERBLOOM_POND_PROBES: 'operator-only-config' });
  assert.deepEqual(environment, before);
});
