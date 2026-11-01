import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { SettingsSchema } from '../src/settings.mjs';
import { fileURLToPath } from 'node:url';

// Exercise component callbacks without a DOM; browser/theme acceptance runs separately.
async function loadComponent(file, extra = {}) {
  const output = await build({ entryPoints: [fileURLToPath(new URL(`../src/client/${file}.tsx`, import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.module.css': 'empty' },
    external: ['react', '@deepseek-ai/dsh-client-ui-primitives'] });
  const states = []; let cursor = 0; let effects = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useMemo: calculate => calculate(),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useRef: value => { const index = cursor++; return states[index] ??= { current: value }; },
    useEffect(effect, deps) { const index = cursor++, previous = states[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => {
        previous?.cleanup?.(); states[index] = { deps, cleanup: effect() };
      }); } };
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, AbortController, structuredClone, fetch: async () => ({ json: async () => ({ events: [], adapters: [] }) }),
    require: name => name === 'react' ? react : { Button: 'Button', Input: 'Input', Menu: 'Menu', Modal: 'Modal', Switch: 'Switch' }, ...extra });
  return props => { cursor = 0; effects = []; let tree = module.exports[file](props); while (typeof tree.type === 'function') tree = tree.type(tree.props); for (const effect of effects) effect(); return tree; };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.props?.children)];
}
const rule = { id: 'rule-one', enabled: true, title: 'Rule', description: '', phase: 'before', input: 'latest-user-message',
  candidateSource: 'none', selectionMode: 'top', selectionValue: '10', selectionAction: 'prune', questionSource: 'configured', question: 'Check?', thresholdPercent: '80',
  options: [{ id: 'yes', label: 'Yes', action: { type: 'inject-context', text: 'kept' } }, { id: 'no', label: 'No', action: { type: 'none', text: '' } }] };

test('changing question type preserves configured option identities and actions', async () => {
  const render = await loadComponent('SmartSelectorRuleEditor'); let changed;
  const tree = render({ rule, editing: true, writable: true, canSave: true, update: value => { changed = value; } });
  const picker = nodes(tree).find(node => node.type?.name === 'QuestionTypePicker');
  assert.equal(picker.props.value, 'choice');
  picker.props.onChange('score');
  assert.equal(changed.questionType, 'score');
  assert.equal(changed.options, rule.options);
  assert.equal(changed.options[0].action.text, 'kept');
  const candidate = render({ rule: { ...rule, candidateSource: 'custom-list' }, editing: true });
  assert.equal(nodes(candidate).find(node => node.type?.name === 'QuestionTypePicker').props.value, 'noul');
});

test('switching a multi-option rule to yes/no retains its options and prevents save', async () => {
  const render = await loadComponent('SmartSelectorRuleEditor');
  const current = { ...rule, questionType: 'noul', options: [...rule.options, { id: 'third', label: 'Third', action: { type: 'none', text: '' } }] };
  const tree = render({ rule: current, editing: true, writable: true, canSave: true });
  const modal = nodes(tree).find(node => node.type === 'Modal');
  const save = nodes(modal.props.footer).find(node => node.type === 'Button' && node.props.variant === 'primary');
  assert.equal(save.props.disabled, true);
  assert.equal(current.options.length, 3);
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
});

test('the test page sends each chosen question type through the same endpoint', async () => {
  const requests = [];
  const render = await loadComponent('SmartSelectorTestPage', { fetch: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) });
    return { ok: true, json: async () => ({ ok: false, error: 'fixture' }) };
  } });
  const props = { model: { provider: 'fixture', model: 'text' }, onBack() {} };
  for (const questionType of ['choice', 'noul', 'score']) {
    let tree = render(props);
    nodes(tree).find(node => node.type?.name === 'QuestionTypePicker').props.onChange(questionType);
    tree = render(props);
    nodes(tree).find(node => node.type === 'textarea').props.onChange({ currentTarget: { value: 'Test content' } });
    nodes(tree).find(node => node.type === 'Input').props.onChange({ currentTarget: { value: 'Test question' } });
    tree = render(props);
    nodes(tree).find(node => node.type === 'Button' && node.props.variant === 'primary').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.at(-1).body.questionType, questionType);
    assert.equal(requests.at(-1).url, '/api/dsh-smart-selector/test');
  }
});

test('changing model cancels the in-flight test and discards its late result', async () => {
  let requestSignal, resolveRequest;
  const render = await loadComponent('SmartSelectorTestPage', { fetch: (_url, request) => {
    requestSignal = request.signal; return new Promise(resolve => { resolveRequest = resolve; });
  } });
  const props = { model: { provider: 'fixture', model: 'old' }, onBack() {} };
  let tree = render(props);
  nodes(tree).find(node => node.type === 'textarea').props.onChange({ currentTarget: { value: 'Synthetic' } });
  nodes(tree).find(node => node.type === 'Input').props.onChange({ currentTarget: { value: 'Check?' } });
  tree = render(props);
  nodes(tree).find(node => node.type === 'Button' && node.props.variant === 'primary').props.onClick();
  const next = { ...props, model: { provider: 'fixture', model: 'new' } };
  render(next);
  assert.equal(requestSignal.aborted, true);
  resolveRequest({ ok: true, json: async () => ({ ok: true, value: { questionType: 'choice', question: 'old response', options: [] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes(render(next)).some(node => node.props['aria-label'] === '测试结果'), false);
});


test('shared model picker reports failed saves, retries atomically and leaves rules intact', async () => {
  const render = await loadComponent('SmartSelectorSettingsSection');
  const value = SettingsSchema({ provider: 'old', model: 'retired', presetVersion: 1 });
  const beforeRules = JSON.stringify(value.rules);
  let rejectSave = true;
  const writes = [];
  const scope = { subscribe: () => () => {}, getSnapshot: () => ({ value, status: 'ready', writable: true }),
    mutate: async operations => { writes.push(operations); if (rejectSave) throw new Error('Synthetic save failure'); for (const operation of operations) value[operation.path[0]] = operation.value; } };
  const SharedPicker = () => null;
  const props = { scope, loadCatalog: async () => ({ groups: [], failures: [] }), modelPicker: { subscribe: () => () => {}, getSnapshot: () => SharedPicker } };
  let tree = render(props);
  const picker = nodes(tree).find(node => node.type === SharedPicker);
  assert.deepEqual(JSON.parse(JSON.stringify(picker.props.current)), { provider: 'old', model: 'retired' });
  assert.equal(await picker.props.select({ provider: 'openrouter', model: 'openai/gpt-6-luna-decisions' }), false);
  assert.equal(value.model, 'retired');
  tree = render(props);
  assert.ok(JSON.stringify(tree).includes('Synthetic save failure'));
  rejectSave = false;
  assert.equal(await nodes(tree).find(node => node.type === SharedPicker).props.select({ provider: 'openrouter', model: 'openai/gpt-6-luna-decisions' }), true);
  assert.equal(value.provider, 'openrouter');
  assert.equal(value.model, 'openai/gpt-6-luna-decisions');
  assert.equal(writes.length, 2);
  assert.equal(JSON.stringify(value.rules), beforeRules);
  assert.deepEqual(JSON.parse(JSON.stringify(value.messageModel)), { provider: 'old', model: 'retired' });
});

test('missing shared picker leaves rule editing available and gives an upgrade action', async () => {
  const render = await loadComponent('SmartSelectorSettingsSection');
  const value = SettingsSchema({ presetVersion: 1 });
  const tree = render({ scope: { subscribe: () => () => {}, getSnapshot: () => ({ value, status: 'ready', writable: true }) },
    loadCatalog: async () => ({ groups: [], failures: [] }), modelPicker: { subscribe: () => () => {}, getSnapshot: () => undefined } });
  assert.ok(JSON.stringify(tree).includes('0.1.18'));
  assert.ok(nodes(tree).some(node => node.type === 'Button' && node.props.children.includes('添加规则') && !node.props.disabled));
  assert.equal(nodes(tree).some(node => node.type === 'Menu'), false);
});
