import { cp, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Each app's production build copies only the public files that app requests (Q-10, T-06, L-07). Vite copies the
 * whole public folder by default; this plugin turns that off for builds and copies the folder itself, leaving out
 * the paths below. Development is untouched: the dev server still serves everything.
 *
 * Every rule names what requests the files instead, or why nothing does, so a new reader can check it. When a file
 * left out here is needed after all, the request fails loudly in the built app; add it back by narrowing the rule.
 */
export type BuildApp = 'desktop' | 'quest';
export interface PublicBuildRule { readonly prefix?: string; readonly pattern?: RegExp; readonly reason: string }
export interface PublicBuildContext {
  /** True when this build ships the licensed release village (scripts/release-village-build.ts). */
  readonly shipsVillage: boolean;
}

/** The village's own public files: reached only through the village route, which a build without the release
 * village cannot take (shared/legacy/aethelgard/visit-route.ts returns null for it in production). */
const VILLAGE_FILES: readonly PublicBuildRule[] = [
  { prefix: 'assets/legacy/environment/aethelgard/', reason: 'village scenery, residents and ground textures (village route only)' },
];

export function publicBuildRules(app: BuildApp, context: PublicBuildContext): readonly PublicBuildRule[] {
  const village = context.shipsVillage ? [] : VILLAGE_FILES;
  if (app === 'desktop') return [
    { prefix: 'quest/', reason: 'Quest-only light copies (shared/menu/derived-assets.ts)' },
    { prefix: 'fonts/locales/', reason: 'Quest text-atlas fonts (main-game-vr/src/locale-fonts.ts); desktop CSS uses system CJK fonts (MenuLocale.css)' },
    { prefix: 'derived-assets.json', reason: 'build-time record of the generated copies (read by check:sync only)' },
    ...village,
    ...(context.shipsVillage ? [] : [{ prefix: 'assets/legacy/ealdholt-loading.webp', reason: 'village loading screen art (AethelgardPreview only)' }]),
  ];
  return [
    { pattern: /^fonts\/[^/]+\.woff2$/u, reason: 'desktop CSS fonts; the Quest builds text atlases from the TTFs' },
    { prefix: 'models/crownfall-sorcerer.glb', reason: 'the Quest backdrop loads quest/models/crownfall-sorcerer.glb (main-game-vr/src/assets.ts)' },
    { prefix: 'video/crownfall-end-credits.mp4', reason: 'the Quest plays the 720p encode under quest/video (CREDITS_FILM_QUEST)' },
    { prefix: 'assets/play/kingdoms/', reason: 'desktop match flags (NationsReveal, MatchOpening, MatchHud)' },
    { prefix: 'assets/play/vfx/', reason: 'desktop match effects' },
    { pattern: /^assets\/play\/scene-0\d(-card)?\.webp$/u, reason: 'desktop match setup cards (MatchSetup); the Quest draws the -selection and -overview captures' },
    { prefix: 'decoders/basis/', reason: 'no Quest asset is KTX2; the Quest GLTF loader only uses decoders/draco' },
    ...village,
  ];
}

export function excludedFromBuild(path: string, rules: readonly PublicBuildRule[]): PublicBuildRule | undefined {
  const normalized = path.split(sep).join('/').replace(/^\/+/u, '');
  return rules.find((rule) => (rule.prefix !== undefined && (normalized === rule.prefix || (rule.prefix.endsWith('/') && normalized.startsWith(rule.prefix))))
    || (rule.pattern !== undefined && rule.pattern.test(normalized)));
}

async function measure(path: string): Promise<{ files: number; bytes: number }> {
  const info = await stat(path);
  if (!info.isDirectory()) return { files: 1, bytes: info.size };
  let files = 0, bytes = 0;
  for (const child of await readdir(path)) { const inner = await measure(join(path, child)); files += inner.files; bytes += inner.bytes; }
  return { files, bytes };
}

interface ResolvedConfig { command: 'build' | 'serve'; publicDir: string; root: string; build: { outDir: string }; plugins: readonly { name: string; api?: unknown }[] }

/** The Vite plugin both apps use: `publicBuildFilter('desktop')`. List it after releaseVillagePlugin. */
export function publicBuildFilter(app: BuildApp, log: (line: string) => void = (line) => console.log(line)) {
  let config: ResolvedConfig | null = null;
  return {
    name: 'crownfall-public-build-filter',
    apply: 'build' as const,
    config() { return { build: { copyPublicDir: false } }; },
    configResolved(resolved: ResolvedConfig) { config = resolved; },
    async writeBundle(output: { dir?: string }) {
      if (!config?.publicDir) return;
      const village = config.plugins.find((plugin) => plugin.name === 'crownfall-release-village')?.api as { shipsVillage?: () => boolean } | undefined;
      const rules = publicBuildRules(app, { shipsVillage: village?.shipsVillage?.() ?? false });
      const source = config.publicDir, destination = output.dir ?? resolve(config.root, config.build.outDir);
      const left = new Map<PublicBuildRule, { files: number; bytes: number }>();
      await cp(source, destination, {
        recursive: true, dereference: true, force: false, errorOnExist: false,
        filter: async (path) => {
          const rel = relative(source, path);
          if (!rel) return true;
          const rule = excludedFromBuild(rel, rules);
          if (!rule) return true;
          const size = await measure(path), tally = left.get(rule) ?? { files: 0, bytes: 0 };
          left.set(rule, { files: tally.files + size.files, bytes: tally.bytes + size.bytes });
          return false;
        },
      });
      for (const [rule, tally] of left) log(`public build filter (${app}): left out ${rule.prefix ?? rule.pattern} — ${rule.reason} (${tally.files} files, ${(tally.bytes / 1048576).toFixed(1)} MB)`);
    },
  };
}
