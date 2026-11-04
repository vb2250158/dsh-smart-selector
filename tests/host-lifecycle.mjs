/** Keyless real Core integration; application CLI/Web acceptance is separate. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

assert(process.env.DSH_SOURCE_ROOT, 'Set DSH_SOURCE_ROOT to the built supported DSH checkout.');
const core = fs.realpathSync(process.env.DSH_SOURCE_ROOT);
const plugin = path.resolve(import.meta.dirname, '..');
const tempRoot = fs.realpathSync(os.tmpdir());
const out = fs.mkdtempSync(path.join(tempRoot, 'dsh-selector-lifecycle-'));
const native = (group, name) => pathToFileURL(path.join(core, 'packages', group, name, 'lib/index.js')).href;
const { boot } = await import(native('boot', 'app-boot'));
const { provideCmdline } = await import(native('boot', 'cmdline'));
let ctx;
try {
  const home = path.join(out, 'home');
  const profile = path.join(home, 'profiles', 'synthetic-lifecycle');
  const stage = path.join(out, 'candidate');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(path.join(stage, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'node_modules/@deepseek-ai'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ type: 'module' }));
  fs.copyFileSync(path.join(plugin, 'lib/index.js'), path.join(stage, 'lib/index.js'));
  const peers = { llm: 'llm', tools: 'core', 'system-prompt': 'core', skill: 'skill' };
  for (const [name, group] of Object.entries(peers)) {
    fs.symlinkSync(path.join(core, 'packages', group, name), path.join(stage, 'node_modules/@deepseek-ai/dsh-' + name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const name of ['cordis', 'schemastery']) {
    const installed = [path.join(core, 'node_modules/@deepseek-ai', name), path.join(core, 'packages/core/tools/node_modules/@deepseek-ai', name)].find(file => fs.existsSync(file));
    assert(installed, `Built Core peer not installed: ${name}`);
    fs.symlinkSync(fs.realpathSync(installed), path.join(stage, 'node_modules/@deepseek-ai', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const modules = [['llm', 'llm'], ['core', 'session'], ['session', 'session-projection'], ['core', 'system-prompt'], ['core', 'tools'],
    ['core', 'tool-executor-native'], ['core', 'agent'], ['core', 'agent-loop'], ['llm', 'token-meter'], ['skill', 'skill'],
    ['boot', 'config-editor'], ['settings', 'settings'], ['credentials', 'credentials-local']];
  const rows = modules.map(([group, name]) => ({ id: name, name: native(group, name),
    ...(name === 'agent-loop' ? { config: { agents: [] } } : {}),
    ...(name === 'credentials-local' ? { config: { dshHome: home, watch: false } } : {}) }));
  const rules = [{ id: 'qa-after', enabled: true, phase: 'after', input: 'tool-results', candidateSource: 'none',
    questionSource: 'configured', question: 'Select add for the synthetic result.', questionType: 'choice', threshold: 0,
    options: [{ id: 'add', label: 'Add', action: { type: 'append-reminder', text: 'QA_REMINDER' } }, { id: 'none', label: 'None', action: { type: 'none', text: '' } }] },
  { id: 'qa-catalog', enabled: true, phase: 'skill-catalog', input: 'current-context-text', candidateSource: 'event-params', candidateParameterKey: 'skills',
    questionSource: 'configured', question: 'Select the relevant synthetic skill.', questionType: 'noul', threshold: 0,
    selectionMode: 'top', selectionValue: '1', selectionAction: 'prune', options: [] }];
  rows.push({ id: 'candidate-smart-selector', name: pathToFileURL(path.join(stage, 'lib/index.js')).href,
    config: { enabled: true, provider: 'fixture', model: 'ordinary-judge', nativeJev: false, decisionApi: { enabled: false }, maxContextCharacters: 512, rules } });
  const fixturePath = path.join(out, 'fixture.mjs');
  fs.writeFileSync(fixturePath, `import { createLifecycleFixture } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, 'fixtures/host-lifecycle-provider.mjs')).href)};
const fixture = await createLifecycleFixture(${JSON.stringify({ core, out })});
export const name = fixture.name;
export const inject = fixture.inject;
export const apply = fixture.apply;
`);
  rows.push({ id: 'qa-fixture', name: pathToFileURL(fixturePath).href });
  const exit = Promise.withResolvers();
  const readyListeners = new Set();
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'synthetic-lifecycle', private: true,
    dependencies: {}, dsh: { profile: { bundles: [] } } }));
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]));
  fs.writeFileSync(path.join(out, 'cordis.yml'), JSON.stringify(rows));
  ctx = await boot('selector-lifecycle-test', path.join(out, 'cordis.yml'), [], async root => {
    root.provide('profileContext', { name: 'synthetic-lifecycle', dir: profile, patchPath: path.join(profile, 'cordis.patch.yml'),
      installAnchor: core, startedBundles: [], cwd: out, home, overlays: [] });
    provideCmdline(root, { args: [], exit: code => exit.resolve(code), ready: { onReady(listener) {
      readyListeners.add(listener); return () => readyListeners.delete(listener);
    } } });
  });
  for (const listener of [...readyListeners]) listener();
  readyListeners.clear();
  assert.equal(await exit.promise, 0, 'See the synthetic Core assertions above.');
  const result = JSON.parse(fs.readFileSync(path.join(out, 'core-result.json'), 'utf8'));
  assert.equal(result.pass, true);
  assert.equal(result.cases.length, 4);
  await ctx.fiber.dispose();
  ctx = undefined;
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'fixture-disposed.json'), 'utf8')).disposed, true);
  console.log(JSON.stringify(result));
} finally {
  if (ctx) await ctx.fiber.dispose();
  const resolvedOutput = fs.realpathSync(out);
  assert.equal(path.dirname(resolvedOutput), tempRoot, 'Recursive cleanup must stay inside the allocated temp root.');
  assert(path.basename(resolvedOutput).startsWith('dsh-selector-lifecycle-'));
  fs.rmSync(resolvedOutput, { recursive: true, force: true });
}
