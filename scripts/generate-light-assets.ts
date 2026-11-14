/**
 * Generates the lighter copies listed in shared/menu/derived-assets.ts from the supplied originals in
 * `main game/public`, and records them in derived-assets.json (path, original, both SHA-256 hashes, settings).
 *
 *   node main-game-vr/node_modules/tsx/dist/cli.mjs scripts/generate-light-assets.ts [--source <public root>] [--out <public root>] [--only <kind>]
 *
 * --source reads the originals from another public folder (default: `main game/public`).
 * --out writes the copies and the manifest under another folder that mirrors the public paths (default: the
 * desktop public folder itself). The Quest app receives the `quest/` copies through scripts/sync-menu-assets.mjs.
 * Needs sharp (root devDependency) for images and ffmpeg with libx264 on PATH for the film.
 * Everything here is derived from the project's own supplied files; nothing is sent anywhere.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  DERIVED_ASSETS_MANIFEST, MENU_SORCERER_MODEL, PLAY_CARD_ART_WIDTH, QUEST_MENU_ART_MAX, SORCERER_KEPT_CLIPS,
  derivedAssetPlan, type DerivedAssetManifest, type DerivedAssetRecord,
} from '../shared/menu/derived-assets.ts';
import { encodeWoff2 } from './woff2-encode.mjs';
import { slimGlb } from './glb-slim.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name: string) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
const sourceRoot = resolve(argument('--source') ?? resolve(repository, 'main game/public'));
const outRoot = resolve(argument('--out') ?? sourceRoot);
const only = argument('--only');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const IMAGE_SETTINGS = { desktop: { width: PLAY_CARD_ART_WIDTH, quality: 82 }, quest: { maxSize: QUEST_MENU_ART_MAX, quality: 85 } } as const;
const MODEL_SETTINGS = {
  desktop: { keepAnimations: SORCERER_KEPT_CLIPS, images: { Crownfall_Normal_4K: { maxSize: 1024, quality: 92 }, Crownfall_RoughnessMetallic_4K: { maxSize: 1024, quality: 90 } } },
  quest: { keepAnimations: SORCERER_KEPT_CLIPS, images: { Crownfall_Normal_4K: { maxSize: 1024, quality: 92 }, Crownfall_RoughnessMetallic_4K: { maxSize: 1024, quality: 90 }, Crownfall_BaseColor_4K: { maxSize: 1024, quality: 90 } } },
} as const;
const FILM_SETTINGS = { width: 1280, height: 720, codec: 'libx264', profile: 'high', crf: 23, preset: 'slow', audio: 'copied from the source' } as const;

const encodeImage = async (bytes: Buffer, mimeType: string, options: { maxSize: number; quality: number }) => {
  if (mimeType !== 'image/webp') throw new Error(`Expected WebP model maps, found ${mimeType}`);
  return sharp(bytes).resize({ width: options.maxSize, height: options.maxSize, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
    .webp({ quality: options.quality, effort: 6, smartSubsample: true }).toBuffer();
};

async function make(entry: ReturnType<typeof derivedAssetPlan>[number], source: Buffer): Promise<{ bytes: Buffer; settings: Record<string, unknown> }> {
  if (entry.kind === 'woff2') return { bytes: encodeWoff2(source), settings: { format: 'woff2', transforms: 'null (tables unchanged)', brotliQuality: 11 } };
  if (entry.kind === 'image') {
    const image = sharp(source), metadata = await image.metadata();
    if (entry.app === 'desktop') {
      const { width, quality } = IMAGE_SETTINGS.desktop;
      const bytes = await image.resize({ width, withoutEnlargement: true, kernel: 'lanczos3' }).webp({ quality, effort: 6 }).toBuffer();
      const size = await sharp(bytes).metadata();
      return { bytes, settings: { from: [metadata.width, metadata.height], size: [size.width, size.height], quality } };
    }
    const { maxSize, quality } = IMAGE_SETTINGS.quest;
    const bytes = await image.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' }).webp({ quality, effort: 6 }).toBuffer();
    const size = await sharp(bytes).metadata();
    return { bytes, settings: { from: [metadata.width, metadata.height], size: [size.width, size.height], quality } };
  }
  if (entry.kind === 'model') {
    const settings = MODEL_SETTINGS[entry.path === MENU_SORCERER_MODEL ? 'desktop' : 'quest'];
    const { glb, report } = await slimGlb(source, { keepAnimations: settings.keepAnimations, images: settings.images, encodeImage });
    return { bytes: glb, settings: { clips: report.clips, images: Object.fromEntries(Object.entries(settings.images).map(([name, value]) => [name, value])), accessors: report.accessors, geometry: 'unchanged (Draco mesh copied byte for byte)' } };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'crownfall-film-'));
  try {
    const input = join(scratch, 'in.mp4'), output = join(scratch, 'out.mp4');
    writeFileSync(input, source);
    const { width, height, crf, preset, profile } = FILM_SETTINGS;
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale=${width}:${height}:flags=lanczos`, '-c:v', 'libx264', '-profile:v', profile, '-level', '4.0', '-pix_fmt', 'yuv420p',
      '-preset', preset, '-crf', String(crf), '-threads', '1', '-c:a', 'copy', '-movflags', '+faststart',
      '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', output]);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', output], { encoding: 'utf8' }));
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    const [num, den] = String(video.r_frame_rate).split('/').map(Number);
    return { bytes: readFileSync(output), settings: { ...FILM_SETTINGS, width: video.width, height: video.height, framesPerSecond: num / den, durationSeconds: Number(probe.format.duration), codecs: `${video.codec_name} ${video.profile}` } };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const manifestPath = join(outRoot, DERIVED_ASSETS_MANIFEST);
const previous: DerivedAssetManifest | null = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const records: DerivedAssetRecord[] = [];
for (const entry of derivedAssetPlan()) {
  const source = readFileSync(join(sourceRoot, entry.source)), sourceSha256 = sha256(source);
  const kept = previous?.files.find((file) => file.path === entry.path);
  const destination = join(outRoot, entry.path);
  // Unchanged originals keep their copies (the film encode is slow); --only remakes one kind.
  if (kept && kept.sourceSha256 === sourceSha256 && existsSync(destination) && sha256(readFileSync(destination)) === kept.sha256 && (!only || only !== entry.kind)) {
    records.push(kept);
    continue;
  }
  if (only && only !== entry.kind && kept) { records.push(kept); continue; }
  const { bytes, settings } = await make(entry, source);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  records.push({ path: entry.path, app: entry.app, source: entry.source, sourceSha256, sha256: sha256(bytes), bytes: bytes.length, settings });
  console.log(`${entry.path}: ${source.length} -> ${bytes.length} bytes`);
}
const manifest: DerivedAssetManifest = { version: 1, generator: 'scripts/generate-light-assets.ts', files: records };
mkdirSync(outRoot, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${records.length} records to ${manifestPath}`);
