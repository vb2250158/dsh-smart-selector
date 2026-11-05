/** Keyless official Skill registry/tool-skill pipeline; CLI/Web acceptance is separate. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

assert(process.env.DSH_SOURCE_ROOT, 'Set DSH_SOURCE_ROOT to the built supported DSH checkout.');
const core = fs.realpathSync(process.env.DSH_SOURCE_ROOT);
const plugin = path.resolve(import.meta.dirname, '..');
const entry = path.resolve(process.env.DSH_SELECTOR_ENTRY ?? path.join(plugin, 'lib/index.js'));
const tempRoot = fs.realpathSync(os.tmpdir());
const out = fs.mkdtempSync(path.join(tempRoot, 'dsh-catalog-lifecycle-'));
const native = (group, name) => pathToFileURL(path.join(core, 'packages', group, name, 'lib/index.js')).href;
const { boot } = await import(native('boot', 'app-boot'));
const { provideCmdline } = await import(native('boot', 'cmdline'));
let ctx;
try {
  const home = path.join(out, 'home'), profile = path.join(home, 'profiles', 'synthetic-catalog'), stage = path.join(out, 'candidate');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(path.join(stage, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'node_modules/@deepseek-ai'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.copyFileSync(entry, path.join(stage, 'lib/index.js'));
  for (const [name, group] of Object.entries({ llm: 'llm', tools: 'core', 'system-prompt': 'core', skill: 'skill' })) {
    fs.symlinkSync(path.join(core, 'packages', group, name), path.join(stage, 'node_modules/@deepseek-ai/dsh-' + name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const name of ['cordis', 'schemastery']) {
    const installed = [path.join(core, 'node_modules/@deepseek-ai', name), path.join(core, 'packages/core/tools/node_modules/@deepseek-ai', name)].find(file => fs.existsSync(file));
    assert(installed, `Built Core peer not installed: ${name}`);
    fs.symlinkSync(fs.realpathSync(installed), path.join(stage, 'node_modules/@deepseek-ai', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const rows = [['llm', 'llm'], ['core', 'session'], ['session', 'session-projection'], ['core', 'system-prompt'], ['core', 'tools'],
    ['core', 'tool-executor-native'], ['core', 'agent'], ['core', 'agent-loop'], ['llm', 'token-meter'], ['skill', 'skill'],
    ['boot', 'config-editor'], ['settings', 'settings'], ['credentials', 'credentials-local'], ['fs', 'fs-local'], ['session', 'working-directory']]
    .map(([group, name]) => ({ id: name, name: native(group, name),
      ...(name === 'agent-loop' ? { config: { agents: [] } } : {}),
      ...(name === 'credentials-local' ? { config: { dshHome: home, watch: false } } : {}),
      ...(name === 'fs-local' ? { config: { cwd: out } } : {}),
      ...(name === 'working-directory' ? { config: { defaultDirectory: out } } : {}) }));
  const rule = { id: 'qa-catalog', enabled: true, phase: 'skill-catalog', input: 'current-context-text',
    candidateSource: 'event-params', candidateParameterKey: 'skills', questionSource: 'configured', question: 'Score each synthetic skill.',
    questionType: 'noul', threshold: 0, selectionMode: 'score-above', selectionValue: '50', selectionAction: 'prune', options: [] };
  rows.push({ id: 'candidate-smart-selector', name: pathToFileURL(path.join(stage, 'lib/index.js')).href,
    config: { enabled: true, provider: 'fixture', model: 'ordinary-judge', nativeJev: false, decisionApi: { enabled: false }, maxContextCharacters: 512, rules: [rule] } });
  // Explicit injection preserves the production ordering: selector surrounds the official producer waterfall.
  rows.push({ id: 'tool-skill', name: native('skill', 'tool-skill'), inject: ['smartSelector'] });
  const fixture = path.join(out, 'fixture.mjs');
  fs.writeFileSync(fixture, `import { createCatalogFixture } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, 'fixtures/host-catalog-provider.mjs')).href)};
const fixture = await createCatalogFixture(${JSON.stringify({ core, out, rule })});
export const name = fixture.name;
export const inject = fixture.inject;
export const apply = fixture.apply;
`);
  rows.push({ id: 'qa-fixture', name: pathToFileURL(fixture).href });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'synthetic-catalog', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }));
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]));
  fs.writeFileSync(path.join(out, 'cordis.yml'), JSON.stringify(rows));
  const exit = Promise.withResolvers(), ready = new Set();
  ctx = await boot('selector-catalog-test', path.join(out, 'cordis.yml'), [], async root => {
    root.provide('profileContext', { name: 'synthetic-catalog', dir: profile, patchPath: path.join(profile, 'cordis.patch.yml'),
      installAnchor: core, startedBundles: [], cwd: out, home, overlays: [] });
    provideCmdline(root, { args: [], exit: code => exit.resolve(code), ready: { onReady(listener) { ready.add(listener); return () => ready.delete(listener); } } });
  });
  for (const listener of [...ready]) listener();
  ready.clear();
  const code = await exit.promise;
  const result = JSON.parse(fs.readFileSync(path.join(out, 'catalog-result.json'), 'utf8'));
  console.log(JSON.stringify({ candidateSha256: createHash('sha256').update(fs.readFileSync(path.join(stage, 'lib/index.js'))).digest('hex'), ...result }));
  assert.equal(code, 0, 'Official catalog lifecycle assertions failed.');
  assert.equal(result.pass, true);
  assert.deepEqual(result, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'expected/host-catalog-lifecycle.json'), 'utf8')));
  await ctx.fiber.dispose();
  ctx = undefined;
  const disposal = JSON.parse(fs.readFileSync(path.join(out, 'catalog-disposed.json'), 'utf8'));
  assert.equal(disposal.providersAborted, true);
} finally {
  if (ctx) await ctx.fiber.dispose();
  const resolvedOutput = fs.realpathSync(out);
  assert.equal(path.dirname(resolvedOutput), tempRoot);
  assert(path.basename(resolvedOutput).startsWith('dsh-catalog-lifecycle-'));
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
}
