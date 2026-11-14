import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2] || process.env.CROWNFALL_GAMEPORT_SOURCE;
if (!source) throw new Error('Pass the game-port source folder as the first argument.');
const target = resolve(dirname(fileURLToPath(import.meta.url)), '../main game/public/gameport');
const hash = async (file) => { const h = createHash('sha256'); for await (const data of createReadStream(file)) h.update(data); return h.digest('hex'); };
for (const setting of ['scene-01', 'scene-02']) {
  const destination = resolve(target, setting);
  await mkdir(destination, { recursive: true });
  for (const part of ['arena', 'environment']) for (const ext of ['glb', 'exr']) {
    const file = resolve(source, ext === 'glb' ? 'exports' : 'lightmaps', setting === 'scene-02' ? setting : '.', `${part}.${ext}`);
    const handle = await open(file);
    const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0); const { size } = await handle.stat(); await handle.close();
    const magic = ext === 'glb' ? Buffer.from('glTF') : Buffer.from([0x76, 0x2f, 0x31, 0x01]);
    if (!header.equals(magic)) throw new Error(`Not a binary ${ext}: ${file}`);
    const output = resolve(destination, `${part}.${ext}`), digest = await hash(file);
    let previous; try { previous = await hash(output); } catch { /* First installation. */ }
    if (previous !== digest) await copyFile(file, output);
    if (await hash(output) !== digest) throw new Error(`Copy verification failed: ${output}`);
    console.log(`${setting}/${part}.${ext}: ${size} bytes, SHA256 verified`);
  }
}
