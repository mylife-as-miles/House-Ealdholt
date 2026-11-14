import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const taskRoot = dirname(fileURLToPath(import.meta.url));
const folder = resolve(taskRoot, '../private-assets/elderbloom');
const report = JSON.parse(await readFile(resolve(folder, 'installation.json'), 'utf8'));
if (!report.verified) throw new Error('Verify the village pack before serving it.');
const expected = JSON.parse(await readFile(resolve(taskRoot, 'private-village-release.json'), 'utf8'));
const allowed = new Set(expected.assets.map(asset => asset.name));
const types = { glb: 'model/gltf-binary', json: 'application/json', hdr: 'application/octet-stream', md: 'text/plain; charset=utf-8' };
const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' }); response.end(); return; }
  if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405); response.end(); return; }
  try {
    const name = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1:4188').pathname.slice(1));
    if (!allowed.has(name)) { response.writeHead(404); response.end(); return; }
    const file = resolve(folder, name), details = await stat(file);
    response.writeHead(200, {
      'Content-Type': types[name.split('.').pop()] || 'application/octet-stream',
      'Content-Length': details.size, 'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
server.listen(4188, '127.0.0.1', () => console.log('Verified local village assets ready at http://127.0.0.1:4188/'));
