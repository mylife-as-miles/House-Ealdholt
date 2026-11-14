// Checks the delivered module graph, rather than assuming import() split it.
// Run after both production builds. No browser or development fixtures load.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'main game/package.json'));
const ts = require('typescript');
const fixtureMarker = 'House Vesperine';
// The house name is also a normal founding suggestion. Only this tape ID
// distinguishes fixture records from legitimate content in the lazy screen.
const fixtureTapeMarker = 'fixture-captive-1';
const results = [];
for (const app of ['main game', 'main-game-vr']) {
  const dist = join(root, app, 'dist');
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map((match) => match[1]);
  assert.ok(entries.length, `${app}: production entry exists`);
  const startup = new Set();
  const visit = async (url, owner = join(dist, 'index.html')) => {
    const path = url.startsWith('/') ? join(dist, url) : resolve(dirname(owner), url);
    if (startup.has(path)) return;
    startup.add(path);
    const code = await readFile(path, 'utf8');
    assert.ok(!code.includes(fixtureMarker), `${app}: fixture data leaked into startup`);
    assert.ok(!/\/(?:LegacyScreen|legacy-experience|fixtures)-[^/]+\.js$/.test(path), `${app}: Legacy is eager`);
    assert.ok(!/\/(?:Showcase|showcase-experience)-[^/]+\.js$/.test(path), `${app}: Showcase is eager`);
    assert.ok(!code.includes('crownfall.showcase.replays.v1'), `${app}: Showcase rules/archive leaked into startup`);
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const dependency = statement.moduleSpecifier.text;
        assert.ok(dependency.startsWith('.'), `${app}: unexpected unbundled dependency ${dependency}`);
        await visit(dependency, path);
      }
    }
  };
  for (const entry of entries) await visit(entry);
  const assets = await readdir(join(dist, 'assets'));
  const showcase = assets.filter((path) => /^(?:Showcase|showcase-experience)-.*\.js$/.test(path));
  assert.equal(showcase.length, 1, `${app}: Showcase has its own lazy chunk`);
  // Bundlers may extract the archive into a shared lazy storage chunk. Verify
  // its actual dependency graph and startup isolation instead of its filename.
  const showcaseGraph = new Map();
  const visitShowcase = async (path) => {
    if (showcaseGraph.has(path)) return;
    const code = await readFile(path, 'utf8');
    showcaseGraph.set(path, code);
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const dependency = statement.moduleSpecifier.text;
        assert.ok(dependency.startsWith('.'), `${app}: unexpected unbundled Showcase dependency ${dependency}`);
        await visitShowcase(resolve(dirname(path), dependency));
      }
    }
  };
  await visitShowcase(join(dist, 'assets', showcase[0]));
  const archiveModules = [...showcaseGraph].filter(([, code]) => code.includes('crownfall.showcase.replays.v1')).map(([path]) => path);
  assert.ok(archiveModules.length, `${app}: Showcase lazy graph contains its archive`);
  for (const path of archiveModules) assert.ok(!startup.has(path), `${app}: Showcase archive is isolated from startup`);
  const fixtures = assets.filter((path) => /^fixtures-.*\.js$/.test(path));
  assert.equal(fixtures.length, 1, `${app}: development fixtures have their own chunk`);
  assert.ok((await readFile(join(dist, 'assets', fixtures[0]), 'utf8')).includes(fixtureTapeMarker), `${app}: fixture chunk contains the preview tapes`);
  for (const file of assets.filter((path) => path.endsWith('.js') && !fixtures.includes(path))) {
    const code = await readFile(join(dist, 'assets', file), 'utf8');
    assert.ok(!code.includes(fixtureTapeMarker), `${app}: fixture records leaked outside their lazy chunk (${file})`);
  }
  results.push({ app, startupModules: startup.size, fixtureChunk: fixtures[0], showcaseChunk: showcase[0], passed: true });
}
console.log(JSON.stringify({ passed: true, checks: results }, null, 2));
